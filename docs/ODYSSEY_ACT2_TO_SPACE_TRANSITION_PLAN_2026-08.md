# Odyssey — the Act II → Space transition (5→6) overhaul (2026-08)

**Status: AUDITED 2026-08-16, NOT STARTED.** Owner asked for a visual + technical audit of
the Act II → deep space seam and a plan to perfect it. This document is that audit and
that plan. Every number below is measured from an in-game graded capture or read out of
the shipped code — nothing here is an estimate.

**One-line finding:** the seam is not badly *tuned*, it is badly *sequenced*. Four
independent schedules govern the handoff, they finish at four different places spread over
0.068 of global progress, and the LAST thing to happen is a **binary visibility flip** of
the entire Act II world. That flip is the cliff, and no amount of colour-bridge tuning can
hide it.

---

## 0. Scope and vocabulary

- **Act II** = the One World (chapters 3/4/5 — island, mountains, sky drift), a single
  continuous world group, not three dioramas.
- **Space** = chapter 6, `cosmic-expanse`, a diorama OUTSIDE One World by decision
  (One World plan §3.0.1 — do not "fix" the suppression).
- **The seam** = the 5→6 boundary at **p = 0.648**.
- Chapter boundaries, derived from level data (`deriveOdysseyChapterPositions`):
  ch4 0.389 · **ch5 0.556** · **ch6 0.648** · ch7 0.815.

---

## 1. THE VISUAL AUDIT (measured, in-game, graded)

`node scripts/run-electron.mjs scripts/odyssey-chapter-capture.mjs --seam 5-6`, High/WebGPU,
1280×720, 9 phase-locked samples spanning p = 0.618 → 0.678. Mean frame luma
(0.2126R + 0.7152G + 0.0722B):

| p | seamProgress | activeChapter | luma | Δ |
|---|---|---|---|---|
| 0.6180 | 0.000 | 5 | 133.7 | — |
| 0.6280 | 0.035 | 5 | 180.9 | **+47.3** |
| 0.6380 | 0.210 | 5 | 196.4 | +15.5 |
| 0.6420 | 0.317 | 5 | 198.2 | +1.8 |
| 0.6480 | 0.500 | **6** | 184.1 | −14.1 |
| 0.6520 | 0.624 | 6 | 175.8 | −8.3 |
| 0.6580 | 0.790 | 6 | 154.8 | −21.1 |
| 0.6680 | 0.965 | 6 | 115.5 | −39.3 |
| 0.6780 | — (done) | 6 | **26.2** | **−89.3** |

### What the frames actually show

1. **p 0.618 → 0.642 — the transition runs BACKWARDS.** The frame *brightens by 64.5 luma*
   (133.7 → 198.2) over the first half of the seam window. Four consecutive frames are the
   same composition: looking up at a white cloud ceiling with a cliff at the left edge.
   Nothing communicates "leaving the world".
2. **p 0.648 — the boundary is visually invisible.** `activeChapter` flips 5→6 and the
   frame changes by −14 luma. The single most important beat in the journey passes
   unmarked.
3. **p 0.658 → 0.668 — the teal wash.** The Act II cloud deck recolours toward teal/green
   under the 5→6 colour bridge. The clouds are still unmistakably *clouds* — soft, lit,
   cumulus-shaped.
4. **p 0.678 — the cliff.** −89.3 luma in 0.010 of progress. The entire Act II world
   disappears between two samples. What remains is near-black with the recoloured cloud
   masses gone, leaving green aurora blobs against the void.

**74 % of the total luma change (128 of 172 points) happens in the final 0.020 of a
0.060-wide seam window.** That is the defect, stated numerically.

---

## 2. THE TECHNICAL AUDIT

### 2.1 The four schedules, and where each one ends

| # | mechanism | source | starts | ends |
|---|---|---|---|---|
| 1 | Earth ignite (`SUMMIT_EARTH_REVEAL`) | `cosmic-expanse.js:182` | 0.610 | 0.634 |
| 2 | Chapter ecotone crossfade (`seamProgress`) | `ChapterEnvironmentManager` | 0.618 | **0.670** |
| 3 | Space content gate (`spaceGateBand` 0.06) | `cosmic-expanse.js:190` | 0.648 | **0.658** |
| 4 | **One World act gate** (binary) | `odyssey-world-act-gate.js:29` | — | **0.678** |

Derivations (so a future re-layout can re-check them):
- `summitStart = ch6 − (ch6 − ch5) × 0.41 = 0.648 − 0.092×0.41 = 0.6103`
- `summitEnd = ch6 − 0.092×0.15 = 0.6342`
- `gateEnd = ch6 + (ch7 − ch6) × 0.06 = 0.648 + 0.167×0.06 = 0.6580`
- `worldOff = ch6 + ONE_WORLD_ACT_MARGIN = 0.648 + 0.03 = 0.6780`

### 2.2 ROOT CAUSE — the act gate is a boolean, and it fires last

```js
// src/rendering/odyssey/world/odyssey-world-act-gate.js
export const ONE_WORLD_ACT_MARGIN = 0.03;
export function isWorldVisibleAtProgress(progress, actStart, actEnd) {
    return progress > (actStart - ONE_WORLD_ACT_MARGIN)
        && progress < (actEnd + ONE_WORLD_ACT_MARGIN);
}
```

Consumed at `OdysseyBoardController.js:2666` as a straight `.visible` write. There is **no
opacity ramp on the One World group at all** — it is on, then it is off.

This gate is *correct and load-bearing*: it exists because the world group's `.visible` was
never written and Act II's ocean painted over Chapter 1's magma cathedral (captured at
p=0.051). **It must not be removed.** But it was written as a *correctness* backstop and is
currently also doing duty as the *artistic* end of Act II, which it was never designed for.

The chapter crossfade finishes at 0.670. The world keeps drawing, at full opacity, for
another 0.008 — and then snaps off. Everything the seam machinery does is undone by one
boolean eight thousandths of the journey later.

### 2.3 Why the colour bridge cannot fix this

`SEAM_56_AURORA_BRIDGE` lerps sky/fog/ambient through a deep teal midpoint over
`SEAM_56_COLOUR_HALF_WIDTH = 0.07`. It is working — that is the teal wash at 0.658–0.668.
But it grades the *atmosphere*, not the world's geometry. The cloud deck, ground and
god-rays keep their own albedo and keep drawing until the boolean. Grading a surface that
then vanishes does not make it recede.

The module's own docstring already states the law that applies here:

> *"Do not reintroduce a midpoint between identical endpoints — if a seam reads badly, the
> endpoints disagree and that is the bug."*

Here the endpoints are legitimately different (day sky → void). The bug is not the
midpoint; it is that one endpoint is reached by a step function.

### 2.4 Secondary findings

- **F1 — the seam brightens before it darkens.** +64.5 luma over 0.618→0.642. Partly the
  camera cresting into open sky, partly the earth ignite adding light. Whatever the cause,
  the first half of a "descent into night" reads as a sunrise.
- **F2 — alpha crossfade between unequal luminances is perceptually back-loaded.** Act II
  ≈195, space ≈26. A 50 % alpha blend still reads ≈110, i.e. "bright sky". A linear
  crossfade therefore *always* looks like a late collapse, even with no cliff.
- **F3 — cloud silhouettes survive to the last frame.** At p=0.668 the sky is full of
  cumulus shapes; at 0.678 there are none. Real atmosphere thins, recedes and loses
  contrast with altitude; this deck holds full form and then leaves.
- **F4 — the hero reads as set dressing.** The gas giant is fully present by p=0.634 but at
  the shipped framing it is a small striped disc, visually indistinguishable from a level
  orb. The "see the earth from the summit" beat does not land.
- **F5 — `spaceGateBand` is very tight.** Space content goes 0→100 % over 0.010 of global
  progress (0.648→0.658), which is 1/6 the width of the chapter crossfade it sits inside.
- **F6 — schedule fragility.** Three of the four schedules are expressed as fractions of
  chapter spans and one is an absolute constant (`ONE_WORLD_ACT_MARGIN`). A future layout
  change moves three of them and not the fourth.

### 2.5 A hazard found while tracing this, worth its own check

`getActiveOdysseyChapterPositions()` is the single source the seam staging reads
(`cosmic-expanse.js:1642`). It is derived correctly from level data at module load
(ch5 = 0.556), **but `setOdysseyPathLayout(this.presentationLayout)` overwrites it at
runtime** (`OdysseyBoardController.js:602`, `:3077`), and the presentation layout can be
fed a `layoutOverride`. A stale saved layout would silently shift `summitStart` — at
ch5 = 0.500 instead of 0.556 the earth ignite would begin at p = 0.587 rather than 0.610,
23 thousandths early. A previously-noted boot log reporting ch4/ch5 as 0.352/0.500 matches
that signature exactly. **Not reproduced in this audit** (the derived values are correct);
flagged for Wave 0 to prove one way or the other.

---

## 3. DESIGN — what "seamless" should mean here

The goal is not to make the change *smaller*. Leaving a world for deep space *should* be
the biggest visual event in the journey. The goal is to make it **monotonic, front-loaded,
and authored** — one continuous statement rather than a plateau and a cut.

Three principles:

1. **Nothing may pop.** Every system that stops contributing must reach zero by a ramp, and
   the correctness gate must only ever flip something that is already invisible.
2. **The perceptual midpoint belongs at the boundary.** Because of F2, "half the alpha"
   is not "half the change". The schedule should be authored against *measured luma*, with
   p = 0.648 landing near the midpoint of the luma curve, not at 92 % of its brightness.
3. **The world should recede, not vanish.** Altitude reads as thinning and desaturation —
   the cloud deck losing contrast and scale, the ground losing detail — not as full-fidelity
   geometry switching off.

---

## 4. WAVES

Every wave ends with: seam capture → luma curve re-measured → tests green → this plan
annotated at the claim.

### Wave 0 — Instrument before touching anything
- A seam-schedule test that pins all four endpoints (0.610 / 0.618–0.670 / 0.658 / 0.678)
  as *derived* values, so any future re-layout that desynchronises them fails loudly.
- A luma-monotonicity check over the capture: assert no single sample-to-sample step
  exceeds N luma, and that the curve is monotonically decreasing after the boundary.
  This is the metric the whole overhaul is judged by, so it lands first.
- **Settle §2.5**: log `getActiveOdysseyChapterPositions()` at boot on a clean profile and
  with a saved layout override. If a stale override can shift the seam, that is a bug in
  its own right and it outranks everything else here.

### Wave 1 — Kill the cliff (the one that matters)
- Give the One World group a **progress-driven opacity/dissolve ramp** that reaches 0 at
  or before `actEnd + margin`. The binary gate stays exactly as it is, as the correctness
  backstop it was written to be — it will simply never again be the thing the eye sees.
- ⚠️ The world's materials must be checked for the `opacityNode` dead-write trap before
  assuming `material.opacity` does anything (ch6 paid for this twice; see its trap
  register). A dithered dissolve on the opaque queue is likely the right instrument, as it
  was for the ch6 nebula field.
- Gate: the −89.3 step is gone; no step exceeds the Wave 0 threshold.

### Wave 2 — Re-phase the schedule
- Move the perceptual midpoint onto the boundary: widen `spaceGateBand` (F5) so space
  arrives *across* the crossfade rather than in its first sixth, and pull the world's new
  fade earlier so the two overlap properly.
- Fix F1: the first half of the seam must not brighten. Either retime the earth ignite or
  let the sky begin losing its top end before the boundary.
- Gate: luma curve monotonic from p=0.63 onward, midpoint within ±0.005 of 0.648.

### Wave 3 — The ascent read (the part that makes it *impactful*, not just smooth)
- Atmospheric thinning (F3): the cloud deck loses contrast, saturation and apparent scale
  with progress rather than holding full form to the end.
- Stars before dark: the near-star tier already exists in ch6 and is deliberately *not*
  baked precisely so it can appear before the sky goes (recorded in the ch6 Wave 2
  deviation). Wire it into the ascent so the first stars arrive while there is still blue.
- Make the hero land (F4): the "earth from the summit" beat needs apparent size or framing,
  not just opacity. **Owner decision D3.**
- Gate: reference-driven review against blessed refs, per chapter convention.

### Wave 4 — Grade, measure, close
- Full 5→6 capture review, value-band checks, the four suites (fog-optout, framing,
  staging, layout), Lane B at a seam station, ledger + doc sweep.

---

## 5. BUDGET

No seam-specific perf cell exists. The seam is the one place in the journey where **two
full environments are co-present**, so it is the worst-case frame by construction and
deserves its own Lane B cell. Wave 0 creates it with a NULL baseline until measured.

⚠️ Wave 1 makes the world *fade* rather than disappear, which means it is drawn (at
non-zero cost) for longer than today. That cost must be measured, not assumed — a dithered
opaque dissolve keeps it out of the blend queue but does not make it free.

---

## 6. OWNER DECISIONS

- **D1 (gates Wave 1):** is a dissolve acceptable on the world, or must the recession be
  purely optical (fog/contrast) with no dithered edge? The dissolve is cheaper and proven
  in ch6; the optical route is prettier and dearer.
- **D2 (gates Wave 2):** how big should this beat be? "Smooth" and "impactful" pull in
  opposite directions — a monotonic 0.06-wide fade is smooth but undramatic. My
  recommendation: keep the total magnitude, front-load it, and buy the drama back in Wave 3.
- **D3 (gates Wave 3):** does the gas giant get to be *big* at the summit? Making it land
  means changing its apparent size, which touches the Wave-4-approved hero framing and the
  solved `APPROACH` NDC fits.
- **D4:** bless a reference frame for "leaving atmosphere" so Wave 3 can be judged against
  something rather than argued about.

---

## 7. TRAP REGISTER (paid for elsewhere; this work must not re-buy them)

- `material.opacity` is a **dead write** wherever `opacityNode` exists — re-arm it with the
  `materialOpacity` node or stage on a private uniform (ch6 Wave 5).
- `scene.fog` erases a distant material's own colour; check `material.fog` FIRST when
  something reads right in the rig and washed in game (**recurred 4×**).
- The chapter-capture harness **deletes its artifact folder unless `--keep`** — copy the
  first set aside before capturing the second half of any A/B.
- **Do not frame-diff two capture runs**: the run-to-run noise floor is ~23 % of pixels at
  low threshold and ~1.2 % even at a hard threshold. Threshold hard AND restrict to the
  object under test.
- Never edit the tree while a capture runs — HMR tears the board down and yields
  byte-identical frames with null sidecars (the tell is station mtimes collapsing).
- Read the plan's own design section for which light/key/schedule is authoritative before
  auditing against a constant you assumed (ch6 Wave 6 burned a full capture A/B on this).
