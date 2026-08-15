# Act II Forest — deleting what the journey cannot see (2026-08)

> **STATUS: PLANNED, with the central claim already MEASURED THREE WAYS.** Not implemented.
> The owner's observation — *"many of the trees are not even seen from the spline path"* — is
> correct, and the number is larger than it sounds: **44% of the forest can be removed with
> 0.00% of pixels changing at four rail stations**, worth 0.20 ms at the shoreline. The evidence
> is in §2; the plan is what to build so that saving is safe to keep.

**Goal.** Stop paying for trees the journey can never see, without touching a single tree it
can. Act II's camera is on a rail — that is a strong constraint most games do not have, and it
makes an offline visibility solution both possible and exact.

**Provenance.** 2026-08-15, following two owner-directed reductions already shipped (canopy
clearings, far-side thinning) and an aerial in which the owner marked the far right of the
island. Scripts for every figure below are in the session scratchpad
(`rail-visibility.mjs`, `rail-visibility2.mjs`, `make-vis-mask.mjs`).

---

## 1. Why the rail changes the question

A normal open world has to assume the camera can go anywhere, so unseen geometry is a
statistical argument: *probably* nobody looks there. Act II is not that. The camera is pinned
to a spline for the whole act, and the terrain is a fixed height field. "Can this tree ever be
seen" is therefore not a heuristic — it is a **decidable geometric fact**, computable offline
to whatever margin we choose.

That is the whole plan. Everything else is about making the answer conservative enough to
trust, and keeping it honest when the world changes underneath it.

## 2. The measurement (three independent ways, all agreeing)

Camera model: eye on the rail at `ODYSSEY_EYE_RAIL_OFFSET_Y` (−16), looking along the tangent,
fov 60, 16:9 — the same model the graded playground rig uses, i.e. the documented review
instrument. 420 stations sampled across p 0.09–0.62. Occlusion by ray-marching the height field.

### 2a. How much of the forest the rail can see

| set | trees | share |
|---|---|---|
| ever inside the shipped **frustum** | 3,995 | 30.7% |
| ever above the rail's **horizon** (any look direction, fov ignored) | 6,842 | 52.6% |
| **occluded from every rail point, whatever the camera does** | **6,160** | **47.4%** |

The middle row is the one that matters. It ignores the frustum entirely and asks only whether
terrain blocks the line of sight — so it is independent of fov, pitch, look-ahead, damping, any
cinematic-director override, and any future camera edit. **Nearly half the forest is behind a
ridge from every point on the journey.**

Both never-seen sets are **100% `far` LOD**. Not one hero or mid tree is in either. That is the
single most reassuring number here: the trees this plan deletes are the ones already judged too
distant to detail.

### 2b. What a conservative mask actually removes

Built with deliberate slack — canopy tested at 13 u (taller than any stage), terrain required to
exceed the sightline by 6 u before it counts as blocking, and the result dilated by one cell so
a tree at the edge of a visible cell counts as visible:

**5,760 trees culled (44.3%)**, by species: subalpine-fir 3,412 · gold-birch 2,109 ·
cypress-spike 231 · **workhorse-pine 7 · shore-broadleaf 1 · red-maple 0 · pink-blossom 0**.

The near-camera species are untouched — 8 trees between them. The cull falls almost entirely on
the two species that carpet the far interior.

### 2c. The proof: captures, not arithmetic

The mask was applied through a temporary patch (since reverted) and four rail stations captured
against the full forest, same seed, same time:

| station | trees | pixels changed | mean delta |
|---|---|---|---|
| p=0.225 shoreline | 13,015 → 7,248 | **0.00%** | 0.00 |
| p=0.34 meadow | " | **0.00%** | 0.00 |
| p=0.42 massif | " | 0.01% | 1.19 |
| p=0.50 ascent | " | **0.00%** | 0.00 |

Three stations are bit-identical. The fourth changes one pixel in ten thousand — the mask is
very slightly tight somewhere on that sightline, which §4 addresses by widening the margin
rather than by accepting it.

### 2d. What it is worth

Lane B, shoreline station, `--low-power`, one thermal window:

| | p50 | p95 | margin vs 10.6 max |
|---|---|---|---|
| current | 10.16 | 10.49 | 0.11 |
| **with the cull** | **9.96** | **10.35** | **0.25** |

**−0.20 ms p50 / −0.14 ms p95**, and it more than doubles the station's headroom. Note this is
the station where the far-side thinning measured *nothing*: that removal was off-camera at this
station, while this one reaches into chunks the camera is actually drawing. Stations facing the
island's interior should gain more; nobody has measured those yet.

## 3. Why this beats the other reduction levers

| lever | removes | risk | verdict |
|---|---|---|---|
| **rail-visibility cull** | 44% | none by construction — the pixels are identical | **the plan** |
| more far-side thinning | tunable | thins what IS seen; the owner already tuned this twice | exhausted as a first lever |
| cutting `FOREST_LOD_BUDGET.far` (24 tris) | ~proportional | touches every visible far tree; the budget was raised to 24 on evidence | later, and only with captures |
| billboards/impostors for far trees | — | **dead end here**: this repo MEASURED opaque geometry beating billboards ~20x and penalises alpha/discard | rejected |
| canopy proxies (merge distant stands into blobs) | large | changes the silhouette, which is what a forest's read IS | Wave 6 at best |

The ordering is not a preference. A cull that provably changes nothing dominates every lever
that changes something, and it should be spent *before* any lever that trades look for cost.

## 4. The design

**An offline-baked visibility mask, committed as data.**

- A script (`scripts/bake-forest-visibility.mjs`) samples the rail densely, ray-marches the
  height field, and writes a bitmask over the island's bounding box. At 256² over the plantable
  extent that is 35 u per cell and **8 KB packed** — small enough to commit as a generated
  module beside the species table.
- `scatterZonedForest` consults it exactly where the far-side thin already sits: before the
  species pick, so a culled site costs nothing at all.
- **Conservatism is a parameter, not a hope**: canopy height, blocking margin and dilation
  radius are named constants in the baker, and §2c's 0.01% station is the signal to widen them
  (canopy 13 → 16 u, dilation 1 → 2 cells) until every station is bit-identical.

**Why a baked mask rather than computing it at load:** the honest version of this test is
millions of ray-marches. It belongs where the tiling noise and the relief already are — done
once, offline, by a script whose output is reviewable.

## 5. The risks, and what each one needs

1. **The mask goes stale if the rail or the height field moves.** This is the one that will
   actually bite. The baker must stamp a checksum of the rail samples plus the height field's
   defining constants into the generated module, and a test must recompute that checksum and
   fail when it drifts. A stale visibility mask deletes trees that ARE visible, and it does so
   silently — exactly the defect class this repo has shipped before with dead levers.
2. **The camera might not be as pinned as I assume.** §2's safe set ignores the frustum
   entirely, so director overrides and look-ahead are already covered. What is NOT covered is
   the camera leaving the rail's *position*. The repo research agent was asked precisely this
   and had not reported when this plan was written — **it must be answered before Wave 1.**
3. **Analytic height vs drawn height.** The march uses `odysseyWorldHeight`; the renderer draws
   a baked, morphing clipmap. Silhouettes differ slightly. The 6 u blocking margin exists for
   this; the capture gate is what proves it sufficient.
4. **Anything else that reads tree positions.** The forest casts no shadow (sun visibility is
   baked from terrain only) and nothing reflects it, so removal is local to the draw. To be
   confirmed, not assumed.
5. **Future content that puts a camera somewhere new.** The mask must be regenerable in one
   command, and the plan says so out loud rather than treating it as permanent.

## 6. Waves

**Wave 0 — the baker and the guard.** Write `scripts/bake-forest-visibility.mjs`; generate the
module; add the checksum guard test. Nothing culls yet. Gate: the generated mask reproduces
§2b's counts.

**Wave 1 — the cull, behind a flag.** `?odysseyWorldNoVisCull=1` restores the full forest
(ADR-0015: one flag from restoration). Gate: **all four stations bit-identical**, widening the
baker's margins until they are — the 0.01% at p=0.42 is a fail, not a pass.

**Wave 2 — measure and re-baseline.** Lane B pairs at the shoreline AND at a station facing the
interior. Gate: no station regresses; ledger updated with both.

**Wave 3 — spend or bank the saving.** 0.20 ms is real budget. It can fund the aerial-perspective
work that is still open, or simply restore the margin. Owner's call.

## 7. Owner decisions

- **D1:** ship the cull at the conservative margin (44%), or push further toward the
  frustum-only set (69%)? The frustum set is 25 points larger and depends on the camera model
  being right — it is a different risk class, not a different number.
- **D2:** does anything in Act II ever move the camera off the rail's *position*? If yes, the
  safe set shrinks and §5.2 becomes the gating question.
- **D3:** what to do with the 0.20 ms — bank it against the tight p95 margin, or spend it on the
  far-saturation/aerial work.

## 8. Files

| file | change |
|---|---|
| `scripts/bake-forest-visibility.mjs` | NEW — the offline baker |
| `src/rendering/odyssey/world/odyssey-forest-visibility.js` | NEW (generated) — mask + checksum |
| `src/rendering/odyssey/world/odyssey-forest-scatter.js` | one cull line beside the far-side thin |
| `src/rendering/odyssey/world/odyssey-forest-visibility.test.js` | NEW — checksum guard, counts, near-species floor |
| `src/rendering/odyssey/OdysseyBoardController.js` | `odysseyWorldNoVisCull` restore flag |
| `perf-budgets.json` | re-baseline at Wave 2 |
