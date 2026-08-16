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
- Chapter boundaries, derived from level data (`deriveOdysseyChapterPositions`), verified
  2026-08-16 by importing the real modules (NOT by parsing the source — see §2.5):
  `[0, 0.093, 0.204, 0.352, 0.5, 0.648, 0.815, 0.944, 1]`, i.e.
  ch4 0.352 · **ch5 0.500** · **ch6 0.648** · ch7 0.815.

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
| 1 | Earth ignite (`SUMMIT_EARTH_REVEAL`) | `cosmic-expanse.js:182` | **0.587** | **0.626** |
| 2 | Chapter ecotone crossfade (`seamProgress`) | `ChapterEnvironmentManager` | 0.618 | **0.670** |
| 3 | Space content gate (`spaceGateBand` 0.06) | `cosmic-expanse.js:190` | 0.648 | **0.658** |
| 4 | **One World act gate** (binary) | `odyssey-world-act-gate.js:29` | — | **0.678** |

Derivations (so a future re-layout can re-check them):
- `summitStart = ch6 − (ch6 − ch5) × 0.41 = 0.648 − 0.148×0.41 = 0.5873`
- `summitEnd = ch6 − 0.148×0.15 = 0.6258`
- ⚠️ **The code's own comments at `cosmic-expanse.js:183-186` claim 0.610 and 0.634.**
  Those come from `skySpan = 0.648 − 0.556`, and **0.556 is not ch5's start** — it is level
  31's path position. Ch5 starts at level 28, p = 0.500. The CODE is correct (it derives
  from `chapterPositions` at runtime); only the comments are wrong, by 23 and 8
  thousandths. Anyone retiming this seam from the comments would be tuning against
  numbers that do not exist. Fixing the comments is a Wave 0 task.
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

- **F1 — the seam brightens before it darkens.** +64.5 luma over 0.618→0.642. **Not the
  earth ignite**: with the corrected schedule that ramp is ~91 % complete by the first
  captured frame (0.618), so the brightening is the camera cresting into open sky. The
  first half of a "descent into night" reads as a sunrise.
- **F2 — alpha crossfade between unequal luminances is perceptually back-loaded.** Act II
  ≈195, space ≈26. A 50 % alpha blend still reads ≈110, i.e. "bright sky". A linear
  crossfade therefore *always* looks like a late collapse, even with no cliff.
- **F3 — cloud silhouettes survive to the last frame.** At p=0.668 the sky is full of
  cumulus shapes; at 0.678 there are none. Real atmosphere thins, recedes and loses
  contrast with altitude; this deck holds full form and then leaves.
- **F4 — the hero reads as set dressing.** The gas giant is fully present by p=0.626 but at
  the shipped framing it is a small striped disc, visually indistinguishable from a level
  orb. The "see the earth from the summit" beat does not land.
- **F5 — `spaceGateBand` is very tight.** Space content goes 0→100 % over 0.010 of global
  progress (0.648→0.658), which is 1/6 the width of the chapter crossfade it sits inside.
- **F6 — schedule fragility.** Three of the four schedules are expressed as fractions of
  chapter spans and one is an absolute constant (`ONE_WORLD_ACT_MARGIN`). A future layout
  change moves three of them and not the fourth.

### 2.5 The chapter-position hazard: INVESTIGATED AND REFUTED

A prior note in this project claimed ch4/ch5 chapter positions had "drifted", with the boot
reporting 0.352/0.500 while level data said 0.389/0.556 — two disagreeing sources. **That is
wrong, and this audit settles it.** Verified by importing `LEVEL_CONFIGS`, `CHAPTER_CONFIGS`
and `deriveOdysseyChapterPositions` directly:

- every chapter's `levelRange` matches its `chapter:` fields — **all eight OK, no drift**;
- `deriveOdysseyChapterPositions()` returns
  `[0, 0.093, 0.204, 0.352, 0.5, 0.648, 0.815, 0.944, 1]`;
- so the boot's 0.352/0.500 **were the correct values all along**.

There is also no persistence path for a stale layout: no `localStorage` layout key exists,
and `layoutOverride` is only ever set in-memory by the editor apply path
(`OdysseyBoardController.js:3071`), so it cannot survive a reload.

⚠️ **METHOD NOTE, because this cost real time and produced a confidently wrong intermediate
result.** The "drift" was reproduced *from a regex over `levels.js`* — `id:\s*(\d+),.*?chapter:\s*(\d+)`
with DOTALL, which happily pairs one object's `id` with a *later* object's `chapter` and
produced a plausible, entirely fictional table (ch4 = 22-30, ch5 = 31-35). Acting on it
appeared to expose a difficulty "sawtooth" and a 5-level mis-assignment; all of it was an
artifact. **Derive facts about level data by importing the modules, never by parsing the
file.** The `__tmp-*.test.js` probe pattern is the cheap way to do that.

The 0.556 that appears in the seam's own code comments is level 31's position, which is what
made the false story feel corroborated. It is a stale comment, not a data bug (§2.2).

### 2.6 THE MOUNTAIN POP — owner-reported, and the same cliff wearing its worst face

> *"the mountain currently vanishes abruptly from one frame to another... we should fly past
> the mountain gracefully as we head into space."*

This is §2.2's binary act gate, seen on the largest object in frame. In the capture the
white massif holds the left edge through p=0.668 and is simply absent at 0.678. But
measuring the pathing turns it from "the gate is abrupt" into something worse:

**The camera never leaves Act II at all. It is deleted out from under it.**

| quantity | value |
|---|---|
| hero massif centre / radius / crown | `(-182.7, -1059.3)` · r=**603** · **y = 1017.5** |
| cloud deck base (tops ~1000-1085) | ~**898-940** |
| camera at the boundary p=0.648 | `(-184, 656, -593)` |
| camera at the act gate p=0.678 | `(-148, 688, -619)` |
| **apex of the ENTIRE Act II path** | **y = 729, at p = 0.718** |

At the moment Act II is switched off the camera is **330 u below the mountain's summit** and
only **442 u from its centre — inside the 603 u footprint** — and **~210 u below the cloud
base**. The Act II apex (729) never clears the crown (1017.5) or the cloud deck (~900)
*anywhere in the act*. That is why every frame in §1 looks up at a cloud **ceiling**: the
journey transitions to deep space from underneath the weather, while still inside a
mountain's skirt.

Worse, the clearance is **closing**, not opening. Ground under the rail rises 375 → 427 over
p 0.65→0.70 while the camera rises 658 → 711: clearance peaks at 291 u around p=0.67 and
then *shrinks*. The rail flies parallel to a rising mountainside into the boundary.

**Why one control point is responsible.** The seam sits in a single unbroken span:

| CP | position | governs p |
|---|---|---|
| 14 | (-211, 447, -504) | 0.515 |
| 15 | (-210, **622**, -572) | 0.621 |
| 16 | (-96, **733**, -654) | 0.722 |

There is **no control point between p=0.621 and p=0.722** — the whole 5→6 transition is
interpolated across one long, nearly-linear climb of 111 u over 0.10 of the journey. The
seam has no authored shape because nothing is authoring it.

**The owner's proposal is correct and this audit supports it quantitatively.** To fly *past*
the mountain rather than through its deletion, the rail must reach above the crown (1017.5)
and ideally above the cloud tops (~1085) before the boundary — a climb of roughly
**450-550 u that currently does not exist**.

⚠️ **BUT THE SPLINE ALONE WILL NOT KILL THE POP, and this is the one thing not to get wrong.**
Elevation changes the massif from a wall ahead into a landmass falling away below; it does
not change the fact that a still-visible object is removed by a boolean. Whatever remains in
frame at `actEnd + 0.03` still vanishes in one frame. **Wave 1B (the fade) and Wave 1A (the
ascent) are complementary, not alternatives** — the ascent makes the departure *earned*, the
fade makes it *seamless*. Shipping either alone leaves the report open.

### 2.7 WAVE 1A ATTEMPTED AND BACKED OUT — what the ascent actually costs

Built, measured, and reverted 2026-08-16. Nothing of it is shipped; all of it is here.

**The climb works, and it is cheap to author well.** Seven control points constructed from a
gradient schedule (76° easing to the corridor's own 24°, segment lengths converging on its
76 u spacing) plus a rigid translation of the whole space run. Measured: apex 729 → **1503**,
clearance stops closing and grows monotonically, and the turn rate through the seam
**improved** (14.45 → 9.05 °/step) because a kink was replaced by a longer arc. The level
re-map is solvable exactly: ids 1-28 hold their world seats to **0.029 u**.

**Three things it breaks, all real:**

1. **The corridor guard is arc-relative.** `odyssey-path-layout.test.js` bounds turn at
   3°/0.003 p. p is arc-normalised, so a longer journey makes the *same physical curve* read
   worse — the untouched ch6 corridor goes 2.39° → 3.06° on arithmetic alone. That bound
   wants re-expressing per unit ARC before any re-layout, or it will keep failing for the
   wrong reason.
2. **Chapter 6-8 must be re-mapped ARC-PRESERVING, not proportionally.** All the added length
   is before the boundary. A proportional re-map stretched the space run and pulled the known
   6→7 hairpin *inside* chapter 6, spiking its turn rate to **32.7°**. `new_p = (old_arc +
   added) / newTotal` keeps their extents exact.
3. **The forest occlusion cull mostly dies.** A rail high enough to clear the weather can see
   the whole island, and a mask can only cull what terrain hides: the cull fell from ~21 % of
   the forest to ~4.6 % (94.1 % of cells visible). That is ~1200 more trees standing in the
   act whose Lane B p95 is already closest to its ceiling. **Unmeasured** — it needs a Lane B
   pass, and it may be the real price of the ascent.

**And the thing that stopped it: THE CLOUD CEILING IS 1935, NOT 1085.**

The first attempt targeted 1085, read off four `A0x` specs. There are 52 masses, and the
`Z01-Z04` "overhead" group bases at **1470-1700 and tops at 1935** — with **Z02 sitting 35 u
laterally from the rail at the boundary**, i.e. directly above it. The capture after the
climb still showed a white ceiling, because the rail at 1503 was underneath Z02's 1610 base.

Solving the climb against the *measured* ceiling costs **+1725 arc (+98 %)**, which makes
chapter 5 **57 % of the whole journey**. That is not a transition, that is a new act.

**~~The cheap way through: move Z02 laterally, since only ONE mass roofs the rail.~~
TRIED 2026-08-16 AND FALSIFIED BY CAPTURE — reverted.** Moving Z02 300 u along the climb's
perpendicular changed the frames not at all, because the scan behind that recommendation
asked the wrong question. It tested whether a mass's horizontal FOOTPRINT contains the rail;
but the camera looks *up and forward*, so a mass 1,300 u away and 400 u up still fills the
top of frame. Counted properly, **26 of 52 masses top out above the rail**, and Z02 still
subtends ~40° from its new seat. The ceiling is the POPULATION, not one cloud, and no
single-mass edit can move it. Z02 was restored; authored art should not carry a change that
bought nothing.

**WHAT THE ASCENT DID ACHIEVE, and it is not nothing.** The capture shows the rail climbing
*through* the deck and breaking out: by **p≈0.755** the cloud tops are BELOW the horizon line
and the frame is open sky with the aurora above. That is the beat the owner asked for, and it
exists now where before the journey never rose above the weather at all. The frames that
still read as "ceiling" (p 0.71-0.744) are the climb *inside* the deck, which is correct.

**So the blocker was never the clouds — it is still §2.2.** The break-out lands at p≈0.755,
the boundary at 0.7401, and the One World is deleted at **0.7701** — one sample after the
payoff. The ascent buys a genuine "above the weather" moment and the act gate throws it away
a frame later. **Wave 1B is now the highest-value work in this plan, not Wave 1A.**

**Owner call needed on the journey-length trade** (D0): +626 arc takes chapter 5 from 14.8 %
to 37 % of the traversal. The levels are re-spaced, not added, exactly as directed — but the
sky becomes the longest act in the game.

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

### Wave 0 — Instrument before touching anything ✅ **DONE 2026-08-16**
- ✅ **`tests/unit/odyssey-seam-56-schedule.test.js`** (5 tests) pins all four endpoints as
  *derived* values — nothing is a literal, because Wave 1A deliberately re-maps every
  chapter's p→world and these assertions must survive that by re-deriving. It also asserts
  the ORDER (ignite → boundary → space gate → world off) and pins the cliff itself as
  current behaviour, so Wave 1B has a test that fails when the defect is fixed.
- ✅ **The seam continuity metric.** `frameLuma()` in the capture harness now records
  `meanLuma` into every frame sidecar (Rec.709 over the decoded bitmap — the harness is the
  only place that already holds pixels, so no PNG decoder is needed), and
  **`scripts/odyssey-seam-luma.mjs`** turns a capture into a pass/fail gate:

  ```
  node scripts/odyssey-seam-luma.mjs            # newest seam-5-6 capture
  ```

  **BASELINE, measured 2026-08-16 — the defect, as a failing command:**

  ```
  maxStep       -89.4 at p=0.6780   (limit 45)      <- the One World act gate
  tailShare     63.3% of movement in the last third (limit 50%)
  postBoundary  0 rising step(s) after p=0.648      (limit 0)   PASS
  FAIL: maxStep -89.4 exceeds 45; tailShare 63.3% exceeds 50%     exit 1
  ```

  The tool independently reproduced the hand-derived §1 curve to two decimals, which
  cross-validates the audit. Note the two tail figures measure different windows: §1's 74 %
  is the last **two** samples (0.020 of progress); the tool's 63.3 % is the last **third**
  of the steps, and that is the canonical gate number.
  ⚠️ Captures taken before this change carry no `meanLuma`; the tool exits 2 and says so
  rather than silently passing on an empty sample set.
- ~~Settle §2.5 (the suspected chapter-position drift).~~ **DONE during the audit —
  refuted.** No drift, no persistence path, boot values were correct. What remains is the
  small real defect it uncovered: **fix the wrong schedule comments at
  `cosmic-expanse.js:183-186`** (they claim 0.610/0.634; the truth is 0.587/0.626), so the
  next person to retime this seam is not reading fiction.

### Wave 1A — The ascent: fly past the mountain (owner-directed)
- **Elevate the rail through the ch5 tail.** Insert control points into the empty
  0.621→0.722 span so the climb is authored rather than interpolated. Target: clear the
  hero massif crown (1017.5) and the cloud tops (~1085) *before* p=0.648 — apex on the
  order of **1150-1250**, against today's 729.
- **Lift the remainder of the path with it.** CP17-19 currently sit at y 763-813; if only
  the ch5 tail rises, the camera *descends* on entering space. Space content is authored in
  the corridor frame and travels with the rail, so raising the tail and the space run
  together moves the diorama with the camera and leaves the One World where it is — which
  is precisely the "fly away from it" read being asked for.
- **Extend Act II's path** to hold the longer climb (the owner's point 2), and
  **redistribute the EXISTING levels** along it (point 3 — no new levels; ch5's 8 levels,
  ids 28-35, re-spaced over the longer sky run).
- ⚠️ **ARC LENGTH IS LOAD-BEARING.** Total is ~1767.65 and pinned by
  `src/rendering/odyssey/odyssey-path-layout.test.js`. Lengthening re-maps every chapter's p→world. The law from
  the ch6 lever-C scout applies verbatim: recompute ALL level positions so every other
  chapter lands on **identical world seats** (`p_new = old_arclength_to_seat / new_total`),
  then re-pin the test to the new total.
- ⚠️ **Re-solve the ch6 hero `APPROACH` NDC fits** — they are least-squares solutions
  against a camera replay, and a spline change invalidates the replay. Also re-check
  corridor smoothness (<3°), the 6→7 hairpin (rail turn 17.1°, aim-pitch floor), and Ch4's
  hero-peak clearance, which CP14/15 were tuned for.
- Gate: capture the seam again; the massif must read as *receding below* rather than
  *ahead*, and the cloud deck must pass beneath the camera before the boundary.

### Wave 1B — Kill the cliff (the one that matters)
- Give the One World group a **progress-driven opacity/dissolve ramp** that reaches 0 at
  or before `actEnd + margin`. The binary gate stays exactly as it is, as the correctness
  backstop it was written to be — it will simply never again be the thing the eye sees.
- ⚠️ The world's materials must be checked for the `opacityNode` dead-write trap before
  assuming `material.opacity` does anything (ch6 paid for this twice; see its trap
  register). A dithered dissolve on the opaque queue is likely the right instrument, as it
  was for the ch6 nebula field.
- Gate: the −89.3 step is gone; no step exceeds the Wave 0 threshold.

> **WAVE 1B OUTCOME (2026-08-16, `ccf33ceb`) — the boolean cliff is gone, and it uncovered
> the next one.**
>
> The One World now RECEDES before the gate fires. What fades is **colour, not alpha**: every
> world material is an unlit `MeshBasicNodeMaterial` with hand-authored colour and the module
> already carries `applyAerial` for the same reason, so pulling that colour toward the sky is
> what distance actually looks like — and it avoids every cost fading alpha would bring
> (nothing leaves the opaque queue, no render-order change, no blend state, and the
> `opacityNode`-is-a-dead-write trap never arises). One hook did it: `toOutput()` already
> wrapped 14 of the 16 `colorNode` sites. The ramp lives beside the gate in
> `odyssey-world-act-gate.js` because the two are one decision, and it is expressed in
> FRACTIONS so Wave 1A's re-layout carries it unedited. The gate is untouched and keeps its
> original correctness job.
>
> **MEASURED: the step at the act gate collapses from −89.3 to −13.1.** That specific defect —
> the mountain vanishing between two frames — is fixed. 13 new tests pin the contract
> (closed BEFORE the flag flips, exactly zero across all of Act II, monotonic, holds under a
> different layout). 3526/3526 green.
>
> **⚠️ THE SEAM METRIC STILL FAILS, and the reason is worth more than the fix.** A −91.5 step
> simply moved one sample earlier. Widening the ramp nearly 3× (lead 0.30 → 0.85) changed it
> only to −86.1, which is the diagnosis: **the departure fade is not what drops there.** The
> remaining cliff is the chapter ecotone crossfade behaving exactly as **F2** predicted —
> bright ch5 (~195 luma) alpha-blended against dark ch6 (~26) collapses perceptually late no
> matter how linear its alpha is. Wave 1B removed the system that was masking it.
>
> So Wave 2 is no longer optional polish; it is the remaining half of the cliff, and F2 tells
> it exactly what to do: re-shape the crossfade against MEASURED luma rather than alpha, and
> put the perceptual midpoint on the boundary.

> **WAVE 2 IS NOW ARITHMETIC, NOT TASTE (measured 2026-08-16).** Three different departure
> schedules were captured — lead 0.30/close 0.85, lead 0.85, and lead 0.55/close 0.0
> (staggered so the world finishes leaving before the crossfade starts). They score −91.5,
> −86.1 and −83.7. Moving the world fade around barely touches the cliff, which proves the
> world fade is not what drops there. **The chapter ecotone crossfade is.**
>
> Fitting the composite against the measured samples gives `luma ≈ 26 + 356 · w5`, where
> `w5 = 1 − smootherstep(raw)` is chapter 5's ecotone weight. From that:
>
> - to hold a per-0.01p step under the 45-luma budget, `w5` may move at most **0.126** per sample;
> - a monotonic 1 → 0 ramp across the seam's **0.060** width averages **0.167** per sample, and
>   its steepest point is necessarily worse than its average.
>
> **So no reshaping of the alpha curve can meet the budget.** It is not a curve problem. Two
> levers actually move it, and Wave 2 should pick one:
>
> 1. **Widen the 5→6 seam.** ≥0.079 for the average alone to fit, so realistically ~2× today's
>    0.06. ⚠️ `transition.seamWidth` for chapters 1 and 5 is also what `ONE_WORLD_ACT_MARGIN`
>    is documented to mirror, and the gate's own comment forbids raising that to 0.06 because
>    it reaches p=0.033 in Chapter 1. Widening the 5→6 seam therefore means giving the two act
>    edges INDEPENDENT margins first.
> 2. **Close the endpoint gap — the artist's answer, and F1's.** Chapter 5 arrives at the
>    boundary at ~198 luma against space's ~26. The seam brightens (+64.5) before it darkens,
>    which is backwards for a climb toward vacuum. If the sky loses its top end across the
>    ascent — as it physically should — the gap the crossfade has to carry shrinks and the
>    budget comes within reach without touching seam widths at all.
>
> Lever 2 is the recommendation: it fixes F1 and the cliff with one change, and it is the only
> one of the two that makes the transition more *correct* rather than merely smoother.

> **WAVE 2 PROGRESS (2026-08-16) — a bug of mine found, and the real culprit isolated.**
>
> **1. Wave 1B faded the world toward the WRONG COLOUR.** It passed `scene.fog.color`, on the
> reasoning that distant things take the sky's colour. True in atmosphere, wrong here:
> chapter 5's fog is `0xbcd8ec`, a bright pale blue at ~212 luma, so "receding" BRIGHTENED the
> world into a flat pale sheet — p=0.618 went from 133.8 to **197.8** luma. That is why
> widening the ramp, staggering it, and dimming chapter 5 all failed to move the cliff: the
> frame was saturated with fog-coloured world and none of those levers touched it. The rail is
> leaving the atmosphere, so the target is now the void it is entering (`0x05060f`).
> Result: `tailShare` **80.7 % → 61.1 %**, and p=0.618 back to 119.6.
>
> **2. THE LATE CLIFF IS THE SEAM CLOUD BANK.** Isolated by capturing with
> `?odysseyNoCloudBank=1`: the −81.5 step at p=0.668 **disappears** (−4.4), and `tailShare`
> collapses to **10.6 %**. The bank is a 300 u lens close in front of the camera whose density
> is a *squared* dead-banded triangle, so on the way out it dumps a full-screen cloud mass
> across two samples. It never "pops" — it reaches zero before its own visibility flag — but
> its exit is steep and it lands exactly where everything else is leaving.
>
> **So Wave 2's target is the bank's exit envelope, not the ecotone curve.** The earlier
> arithmetic (no alpha curve can carry a 356-K gap across a 0.060 seam) still stands and still
> rules out reshaping the crossfade alone — but the bank, not chapter 5's environment, is what
> supplies most of that K. Give it an ASYMMETRIC envelope: quick in, slow out, so its
> departure is spread across the space the world's recession has already vacated.
> ⚠️ Do not simply remove it — with the bank off the whole approach collapses to luma 3-10 at
> the boundary. It is carrying the frame; it just leaves too fast.
>
> ~~Also landed, UNVERIFIED: a narrow approach dim on chapter 5 (last 25 %, floor 0.35).~~
> **REMOVED 2026-08-16 after a chapter-5 capture showed why it could never work.** Its tail
> frames get BRIGHTER, not dimmer, across exactly the window the dim covers (local
> 0778 → 0889 → 1000 = 154.5 → 169.2 → 182.8 luma). Those frames are filled by the One World
> cloud deck and the seam bank; the dim only touched chapter 5's OWN sky materials, which are
> not what is bright there. It was 11 wrapped `colorNode` sites and a driver for a provable
> no-op, and it was only ever landed while the fog-colour bug was masking the measurement.
>
> **The lesson is the reusable part:** at the ch5 tail the frame is NOT chapter 5. Anything
> aimed at the handover's brightness has to target the world deck or the bank; dimming the
> chapter environment moves almost nothing.

> **WAVE 2 — THE TINT RE-BASE LANDED, AND THE NEXT BLOCKER IS THE METRIC'S OWN WINDOW.**
>
> What the eye sees is the PRODUCT `density * (1 - toVoid)`, and two decaying terms multiplied
> fall faster than either alone — which is why reshaping the exit density three different ways
> barely moved the spike. `toVoid` ended at 1.0, so the bank was 78 % void-tinted while it
> still had a third of its density left and the product collapsed mid-exit. Stretching the
> ramp's upper edge to 1.6 flattens the modelled worst step 0.272 → 0.198 (−27 %).
> **Measured: −83.0 → −72.7**, against a prediction of ~−68. The model is now trustworthy;
> across the session the spike has gone −89.3 → −81.4 → −83.0 → **−72.7**.
>
> **THE REMAINING LIMIT IS STRUCTURAL, AND IT IS PARTLY MINE.** The bank's window runs to
> boundary + 0.06 (p=0.708), but the seam capture — and therefore `endLuma` — stops at
> boundary + 0.03 (p=0.678). So only 3 of the bank's ~6 exit samples are ever seen, and the
> arithmetic is unforgiving:
>
> | exit spread over | density/sample | ≈ luma/sample |
> |---|---|---|
> | 3 samples (what the metric sees) | 0.333 | **~67** |
> | 6 samples | 0.167 | ~33 |
> | 12 samples | 0.083 | ~17 |
>
> **The bank alone forces ≥66-luma steps if it must be fully gone by p=0.678** — which is
> exactly the wall the last four attempts kept hitting. Every fix that gave it more room
> (asymmetric window, longer exit) then failed `endLuma`, because the metric judges a window
> narrower than the transition actually occupies.
>
> So the next move is NOT another envelope tweak. It is to widen the seam capture to cover the
> systems being measured — the harness derives its window from the ecotone's `seamWidth`
> (±0.03) while the bank legitimately spans ±0.06 — and only then decide whether the bank
> should leave inside 0.03 or be allowed the room it was authored with. ⚠️ Widening the window
> also means re-baselining every number in §1, so it is a deliberate act, not a tweak.

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

### Wave 1C — THE MASSIF FLYBY (owner-directed 2026-08-16, after playing Wave 1A)
Owner: *"Adjust the ascending path so it routes much closer to the mountainside,
bypassing the peak in close proximity"* — and, explicitly, **keep the cloud
transition** (the §8 limb hand-off is praised and is a hard gate here, not a casualty).

**The measured geometry (2026-08-16 eve).** The hero massif sits at (−182.7, −1059.3),
crown 1017.5, radius 603, cone exponent 1.7 — which makes it a narrow spire near the
top: its rock surface is only ~9 u from the axis at y=1000, ~60 u at y=900, ~115 u at
y=800. The Wave 1A ascent passes the crown at **~443 u abeam** at crown height
(ascent point 4, (−41.5, 1023.9, −639)) — the owner's screenshot shows exactly that:
a mountain admired from across the valley, not flown past.

**Why a nudge cannot do it (worked, not guessed):** with the ascent's endpoints and
total length FIXED (corridor join direction + 76 u spacing; the level re-map), the
climb's horizontal budget is ~549 u against a net 374 u of required displacement —
excursion capacity ≈ **87 u** toward the massif and back. Closest approach improves
443 → ~356 u: still a valley view. Hugging at 150–200 u needs ~270 u of approach —
**the ascent must grow again**, via the exact procedure 5ce1c909 proved: regenerate
the climb from a schedule (never nudge one point), then re-map — ids 1–28 nearest-point
world seats, 29–35 re-spaced along the climb, 36–59 arc-preserving so ch6–8 keep their
extents — and re-pin the total.

**The flyby design to regenerate from:**
- Heading schedule swings the mid-climb toward the massif's east flank, closest
  approach **150–200 u from the axis at y ≈ 950–1050** (rock is ≤ 60 u there — real
  clearance, real proximity; the deck bases at ~900 so the flyby happens at cloud-top
  height with the summit spire above), then arcs back out.
- The corridor join point (160.8, 1205.5, −719.5) and arrival direction stay
  BYTE-IDENTICAL — the translated space run must not move again.
- ⚠️ Verify the §8 cloud LIMB's anchoring before regenerating: if the limb is seated
  against the current rail line, the flyby bend re-routes the camera around it. The
  limb crossing is a gate ("keep the cloud transition"), same rank as the seam-luma
  gates.
- Re-solve the ch6 `APPROACH` NDC fits (again — any spline change invalidates the
  replay), re-run the corridor guard (arc-stepped), the world rail-clearance suite
  against the massif's own height function, hero framing, and all four §8.7 seam
  gates via `scripts/odyssey-seam-luma.mjs`.
- Gate: a seam capture in which the mountainside visibly SWEEPS PAST on one side of
  the frame during the climb — parallax against the rock face is the whole point —
  with the limb crossing and the space arrival unchanged.

> ⚠️ **Coordination note (2026-08-16): two sessions share this working tree.** The
> visibility fix below (`fbd8bc81`) was landed by the second session; the flyby was
> deliberately DESIGNED-NOT-BUILT in the same sitting because Wave 1A's gates had
> just been passed against the current geometry, and concurrent re-authoring of the
> same seven control points by two sessions is the shared-worktree failure mode the
> project has already paid for. Whichever session takes this wave: regenerate, never
> nudge, and land it as one commit.

> ### 1C ATTEMPTED, GEOMETRY SOLVED, BUILD BACKED OUT (2026-08-16 night)
> The flyby was built end-to-end, measured, and then **reverted** — the geometry is
> right and is preserved in `scripts/odyssey-ascent-flyby-*.mjs`; the re-map's blast
> radius is what stopped it. Everything below is measured, not estimated.
>
> **THE GEOMETRY THAT WORKS — apply this, do not re-derive it:**
> shift the space run by **(−60, 0, −350)** and regenerate the climb with a flyby
> waypoint 170 u from the massif axis on bearing 0.30, at y 1000, 8 resampled points.
> Result: **closest approach 442.7 → 141.7 u** at y 1052 (three times closer than the
> owner's 150–200 ask), climb bank **5.43°/5.3u** against a 3.47 baseline, ch6 corridor
> guard **IMPROVES to 3.76** (limit 5.2), ground clearance 46.4 (baseline 46.3),
> world-seat drift for ids 1–28 of **0.113 u**, total arc 2393.89 → **2532.66**.
>
> **WHY THE OBVIOUS VERSION IS IMPOSSIBLE (measured frontier, corridor frozen):**
> the massif sits ~443 u off *every* point of the climb, so reaching it and returning
> to a fixed cp20 forces a hairpin — 268 u costs a 12°/step corner, 203 u costs 14.4°,
> 165 u costs 19.7°. **Do not attempt a frozen-corridor flyby.** Letting the climb
> CONTINUE north and translating the space run removes the U-turn entirely; that is
> the whole trick, and it is Wave 1A's own pattern.
> The cloud limb needs no work: it is seated at `getOdysseyPathPointAt(boundary)`
> (`OdysseyBoardController.js:1946`), so it rides the moved rail — "keep the cloud
> transition" survives by construction.
>
> **WHAT BLOCKED THE LANDING — 13 tests across 6 files, all re-baselines, none a
> geometry defect:** massif `footY` ×5 (`odyssey-world-height.js:93,105,108,111,115`)
> are derived from `getChapterPathRange(3).center.y − 30`, whose drift budget is spent
> monotonically per re-authoring (0.0009 → 0.0261 → **0.0556** vs a 0.05 tolerance);
> forest scatter (4) and forest visibility (1); earth-core (1);
> ChapterEnvironmentManager (1); ch6 hero framing (2).
>
> **THE TRIAD IS ONE FIT, NOT THREE.** A feasibility sweep proved no single static
> `planetA` satisfies both the summit window and the boundary composition once the
> camera banks — the giant needs a pre-boundary keyframe, solved at
> **`planetSummit { x: 875, y: 175, z: −275 }`** (147 u from planetA, framed across all
> five derived stations). And `planetA` itself has **no feasible band** until the galaxy
> moves: measured entry ndc — planet −0.021, galaxy **0.286**, and the test needs
> planet > 0 *and* ≥0.3 clear of the galaxy, i.e. planet < −0.014. Re-solve
> `galaxyA` first, then `planetA`, then `planetSummit`
> (`scripts/odyssey-ch6-approach-resolve.mjs` does all three).
>
> **Solver traps already paid for:** `getPoint` (parameter) vs `getPointAt` (arc) — the
> mix-up left a 167 u gap into the frozen tail against 81 u elsewhere; projecting points
> BEHIND the camera returns large finite NDC that reads as a near-miss (seven ghost
> "solutions"); and both the summit stations and the arc-length window must be DERIVED,
> since scoring ch6 at its old p values on a longer curve reads 17° for a corridor
> nobody touched.

### Wave 1D — PREMATURE AURORA/BH: FIXED (`fbd8bc81`, 2026-08-16)
Owner report: the black hole and Northern Lights appear in the bright sky, disappear,
then reappear in space. Measured (ascent sweep probe, new
`scripts/odyssey-ch6-ascent-sweep-probe.mjs`): the planet-aurora crown ran eff
0.26 → 1.0 across p 0.62–0.74 while `spaceReveal` was 0 — its night mask knows the
PLANET's terminator, not the SKY, and during the ascent the planet's night side faces
the camera in daylight. The "disappear" beat is the cloud limb occluding it; the
"black hole" in the owner's screenshot is the path ribbon (the real BH measured 0 at
every pre-boundary station). Fix: one `uAuroraReveal` uniform through BOTH aurora
halves (the shared-contract principle), ticked to `spaceReveal` — the earth is the one
element allowed before the boundary; its aurora now arrives with the dark. Verified by
5 derived-station unit tests, the sweep probe, and a 0.68–0.80 seam capture.

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

- **D0 (gates Wave 1A, NEW):** the ascent re-times the whole journey. Redistributing ch5's
  levels along a longer sky path changes where every later level sits in `p`, and the
  arc-length re-pin touches a test that guards Ch1-Ch4 to 0.01 u. Confirm the appetite for
  a journey-wide re-map before the spline is touched — this is the largest-blast-radius
  change in the plan, and it is the one the owner has explicitly asked for.
- **D1 (gates Wave 1B):** is a dissolve acceptable on the world, or must the recession be
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

---

## 8. THE CLOUD BANK REWORK — measured A/B, and the design that survived it (2026-08-16)

### 8.1 Both failure states, measured on one tree

Two same-tree, post-ascent seam captures (`chapterPositions[5] = 0.7401` in both boot
blocks), differing only by `odysseyNoCloudBank=1`. Preserved as
`artifacts/odyssey/wave-v/arm-live-t9` and `arm-bankoff-t9`.

| p | bank OFF | bank ON | step OFF | step ON |
|---|---|---|---|---|
| 0.6801 | 78.73 | 79.19 | | |
| 0.6901 | 66.02 | 66.59 | −12.7 | −12.6 |
| 0.7001 | 44.22 | 45.07 | −21.8 | −21.5 |
| 0.7101 | 15.69 | 50.76 | −28.5 | **+5.7** |
| 0.7161 | 4.66 | 80.12 | −18.4 | **+48.9** |
| 0.7221 | 1.77 | 129.81 | −4.8 | **+82.8** |
| 0.7281 | 1.87 | 167.41 | +0.2 | +62.7 |
| 0.7341 | 2.56 | **188.17** | +1.2 | +34.6 |
| 0.7401 | 2.64 | 184.07 | +0.1 | −6.8 |
| 0.7441 | 41.13 | 176.65 | **+96.2** | −18.5 |
| 0.7501 | 37.86 | 153.20 | −5.4 | −39.1 |
| 0.7561 | 27.72 | 111.46 | −16.9 | −69.6 |
| 0.7621 | 24.99 | 59.53 | −4.5 | **−86.5** |
| 0.7701 | 19.16 | 10.92 | −7.3 | −60.8 |
| 0.7781 | 11.27 | 7.38 | −9.9 | −4.4 |
| 0.7861 | 11.05 | 8.58 | −0.3 | +1.5 |
| 0.7941 | 16.31 | 16.28 | **+6.6** | +9.6 |
| 0.8001 | 18.91 | 18.87 | **+4.3** | +4.3 |

**Findings that decide the design:**

1. The two arms are **identical to p=0.7001** (within 0.9 luma) and **identical again at
   p=0.7941/0.8001** (16.31/16.28, 18.91/18.87 — the bank contributes *literally zero*
   there, because at r=150 the eye is outside the shell: e=1.112 and 1.236).
2. **Bank-off's descent already passes.** Every step is inside the 45/0.01p budget.
3. Bank-off fails on exactly two things: a **dead zone** (luma <3 across p=0.7221→0.7401)
   and a **+96.2/0.01p pop** at 0.7441 where `spaceReveal` flips ch6 on.
4. **The bank is an occluder, not a light.** Its opacity is a hard-clamped 1.0 at both
   0.7401 and 0.7441 (t=0.5333, d=0.9333, `clamp(0.9333² × 1.25) = 1.0`). It is not adding
   brightness so much as **hiding the +96.2 pop**. ⚠️ Any change that makes it transparent
   *exposes* that pop — predicted ~+90/0.01p, worse than today's −86.5.

⚠️ **The correct model for this seam is `L = A·L_bank + (1−A)·B_measured`.** An additive
model over a fixed background gives wrong answers at the decisive step and was the single
reason one of three candidate designs had to be rejected.

### 8.2 Verdict: THE LIMB HAND-OFF

Full scored verdict, including the two rejected designs and their fatal flaws:
**`docs/research/act2-cloud-bank-rework-verdict-2026-08-16.json`**.

The governing insight: **space arriving after the boundary is a rise BY CONSTRUCTION**
unless something luminous is simultaneously falling. So the seam must be a *hand-off* —
a falling limb (the clouds you go past) against a rising cosmos — not a fade.

Rejected, with reasons worth keeping:
- **Delete the bank.** Breaks `expect(ch6).toBeLessThan(gateEnd)`
  (`odyssey-seam-56-schedule.test.js:101`) — an ORDERING invariant, not a tunable number.
  And it forfeits the owner's stated goal: *"go past the fluffy clouds out in space"*
  requires clouds to be gone past. A monotone fade to black is metric-green / brief-red.
- **Tune the existing bank in place.** At r=150 the FBM is sampled on a fixed object-space
  shell, so the noise is frozen while the eye moves through it — zero parallax, it
  dissolves around you rather than being passed.

### 8.3 Execution order (the order is load-bearing)

1. Time-locked three-arm baseline — both captures on disk had `fixedTime: null`.
2. **Fix the tail rises AT SOURCE.** `cosmic-expanse.js` `voidSkyOpacity` (:1785) and
   `fieldReveal` (:1797-1802) both multiply `entryState.nebulaReveal`, driven off a
   camera-y `approach` still climbing *inside* the sampled window. `Math.max(…, seamHandover)`.
3. **Widen `spaceGateBand` 0.06 → 0.16.** ⚠️ HARD CEILING 0.18004, from
   `worldOff = 0.7401 + ONE_WORLD_ACT_MARGIN(0.0222)`. 0.16 leaves 0.0025 of margin.
4. Let the world sky recede into the authored `edge-of-space` keyframe — `scriptP` caps at
   0.95, so the p=1.00 keyframe (skyHorizon `0x1b3f79`) has **never been sampled**.
5-7. Re-scale the bank to a limb shell (r 150 → 620, noise re-based), add an **elevation**
   mask (`normalize(positionWorld − cameraPosition).y`), retire the 1.25 gain that clamped
   it opaque, `alphaTest = 0.004`.
8. Free draws: `forceSinglePass` on the ch6 aurora bridge and streak motes (−4 draws).
9-11. Comment sweep, full gate, and the **never-measured** Lane B seam cell (`gpuMs` reads
   0 at all 18 stations today).

⚠️ **`scripts/odyssey-seam-luma.mjs` must be run with `--dir` AND `--boundary 0.7401`.**
The default 0.648 is the pre-ascent boundary and sits below the first station; and
`resolveDir()` returns the **alphabetically** last `seam-5-6*` directory, not the newest —
a new arm named `seam-5-6-v2` silently becomes the graded run.


### 8.7 CLOSED — all four gates pass, and the seam is priced for the first time

`arm-limb-v6`, scored with `--boundary 0.7401`:

| gate | audit baseline | v6 | limit |
|---|---|---|---|
| maxStep | −86.5 (wall) / +95.5 (no bank) | **−24.4** | 45 |
| tailShare | 31.3% | **11.8%** | 50% |
| postBoundary rises | 7 | **0** | 0 |
| endLuma | 18.9 | **19.7** | 60 |

**LANE B, MEASURED — the seam had never been priced.** `render.gpuMs` in the chapter-capture
sidecars reads 0 at all 18 stations and always did: that harness sends `odysseyOverlay=0`,
which makes `isOdysseyAAADebugEnabled()` false, so the renderer is built with
`trackTimestamp:false` and no query pool is ever created. ⚠️ **That zero is a constructor
default, not a measurement.** `scripts/odyssey-gpu-split.mjs` is the correct instrument and
now carries a `no-cloud-bank` lever.

    node scripts/run-electron.mjs scripts/odyssey-gpu-split.mjs --lane B --low-power \
      --quality Medium --seek 0.7401 --chapters 5,6 \
      --only baseline,no-cloud-bank,baseline-repeat --out <name>.json

| | frame p50 | bank's share | control (no bank) |
|---|---|---|---|
| alphaTest only | 8.32 ms | **3.86 ms** (46% of frame) | 4.46 ms |
| + `maskNode` | **6.23 ms** | **1.77 ms** | 4.46 ms |

Both runs: `baselineDriftMs: 0`, `baselineDriftVoidReason: null`, draws 54 vs 53 (exactly one,
so the lever is live rather than reporting innocence). The control landing on 4.46 ms in BOTH
runs is what makes them comparable.

⚠️ **`alphaTest` DOES NOT SAVE SHADER — it saves only blend.** NodeMaterial assigns `colorNode`
before the alphaTest discard, so all seven FBM octaves ran on every rasterised fragment
including the 40–55% of frame being thrown away. `material.maskNode` is emitted at the top of
`setupDiffuseColor`, ahead of `colorNode`; reading only `limbProfile` and the density uniform
(both noise-free) makes the discard happen before any noise is sampled. Worth **2.09 ms**, and
capture-verified image-identical: max station luma delta 0.893, inside the ~1.25–1.7 noise floor.

**THE WOBBLE — HYPOTHESIS REFUTED.** It was not "cloud lumps drifting past the horizon".
The limb's own contribution has exactly ONE turning point across 18 stations, and its
correlation with the mask's screen coverage is **−0.005**. The oscillation was chapter 6's
arrival curve beating against the bank's decay curve — two smooth unimodal curves whose peaks
sat 0.022 of p apart. Camera pitch (monotone 25.4°→14.9°) and shell position (monotone in,
monotone out, never exits) both ruled out.

**THE GREEN WALL WAS NOT THE NEBULA.** It is `createAuroraFilamentBridge` — the carried Ch5
aurora — and it carried a linear/sRGB authoring slip: `vec3(0.24, 1.0, 0.56)` commented
`#3DFF8E`, which actually linearises to `(0.047, 1.000, 0.270)`. ⚠️ **Fixing the slip makes it
MORE saturated, not less** — the shipped value was an accidentally pale green, and this was
mis-read once during the fix. The correction ships with a desaturation term
(`BRIDGE_CHROMA 0.55`) and a level trim (`BRIDGE_LEVEL 0.65`), because the hue fix alone
worsens the clash it was meant to solve.

