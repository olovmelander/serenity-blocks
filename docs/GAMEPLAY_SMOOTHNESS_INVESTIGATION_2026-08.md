# Gameplay smoothness investigation — "laggy stacking / slow cascades at 100+ FPS"

**Date:** 2026-08-09
**Reported symptom:** "Over 100 FPS but stacking, clearing, combos and cascading feel laggy.
Cascades fall and clear slowly. Works well in many themes, sluggish in some."
**Verdict:** The FPS number is wrong, the real problem is the frame-time *tail*, and the
gameplay animation + input code multiplies that tail instead of absorbing it.

---

## 0. TL;DR

Three independent defects stack on top of each other:

1. **You are not running at 114 FPS.** The counter averages *reciprocals*, which inflates it
   ~2×. Your own screenshot proves it: it shows `avgFrameTime = 17.2ms` (= 58 fps of real
   throughput) next to `114.0 FPS`.
2. **The frame-time tail is brutal and it is GPU-side, not JS.** Measured live in Stillwater:
   p50 = 8.4ms but p99 = 108.6ms, max = 154.5ms, with **zero `longtask` entries**. Stalls
   arrive as back-to-back ~100ms pairs.
3. **The clear/cascade animation is frame-quantized, so it multiplies the tail.** Every stage
   of a line clear costs *at least one whole frame*. At your p95 (72ms) a clear that should
   take ~270ms takes ~940ms. That is precisely "the cascades fall and clear in a slow and
   laggy way".

Plus: unclamped `delta` makes the piece **teleport** after every stall, which is the
"laggy while stacking" half of the complaint.

The good news: at a *steady* 60fps the animation timing is already frame-rate independent
(verified by arithmetic below). Nothing needs 200fps. The tail is the whole problem.

---

## 1. The FPS counter is inflated ~2×

`src/utils/performance-monitor.js:428-436, 480`

```js
const fps = 1000 / frameTime;          // instantaneous
this.fpsHistory.push(fps);
...
this.metrics.avgFPS = this.calculateAverage(this.fpsHistory);   // mean of RECIPROCALS
```

and the overlay renders `avgFPS` as the headline number (`:1359`, `:1457`).

`mean(1/t) ≥ 1/mean(t)` (Jensen), and the gap explodes for a bimodal distribution — which is
exactly what we have (many 8ms frames + a few 100ms frames). The fast frames dominate the
average while contributing almost nothing to wall-clock time.

**Proof from the reported screenshot itself:**

| Overlay field | Value | Implication |
|---|---|---|
| `FPS` (avgFPS) | 114.0 | mean of reciprocals |
| `Frame:` (avgFrameTime) | 17.2ms | **true throughput = 1000/17.2 = 58.1 fps** |
| p95 / p99 | 72.2ms / 108.8ms | the actual tail |

The two numbers on the same panel disagree by 2×. `Frame:` and the percentiles are the honest
ones. `0 - 833 fps range` is the same artifact (min/max of instantaneous reciprocals).

**Consequence:** every perf decision made against this counter has been made against a number
that hides exactly the frames that hurt. Fix this first, or you cannot trust any A/B.

---

## 2. The stalls are GPU-side, not JavaScript

Measured live (Chrome, RTX 5080, Stillwater, active gameplay, independent rAF probe — not the
app's own instrumentation):

```
samples 485   throughput 82 fps   mean 12.2ms
p50 8.4   p90 12.6   p95 16.7   p99 108.6   max 154.5
longTasks: 0        longTaskMax: 0
```

**Zero long tasks with 108-154ms frames.** A multi-frame rAF gap with no long task means the
main thread was idle and waiting — GPU / compositor `BeginFrame` starvation. This codebase has
already identified and documented this exact signature during the boot-warp work.

Spike distribution (17 spikes in 5s):

```
spikes at ms: 896, 1002, 1223, 1461, 1565, 1820, 1929, 2273, 2379, 2695, 2801, ...
gaps:         106,  221,  238,  104,  255,  109,  344,  106,  316,  106, ...
```

They come in **pairs ~105ms apart** (two consecutive ~100ms frames = a ~200ms freeze), with the
pairs recurring every 200-350ms. During that window roughly half of wall-clock time is spent
frozen — while the FPS counter happily reports triple digits.

**Steady state is fine on this hardware.** After warm-up, Stillwater at 2137×1167 measured
p50 4.2ms / p99 12.6ms / 190-200fps. Switching *to* Stillwater produced a single 195ms spike.
This points at **pipeline (shader) creation and first-use of effects**, not at sustained
per-frame cost — consistent with "some themes feel sluggish": the themes with more bespoke
lock/combo/clear materials have more pipelines to create, and they get created *during play,
on the frames where you clear lines*.

> Status: strongly indicated, not yet nailed on the reporter's machine. §6 lists the
> confirmation step.

Also found while measuring: a **fullscreen `cursor-trail-canvas` at 2565×1401** compositing
every frame (`customCursorEnabled: true` by default), plus leftover 300×150 canvases from
previously-loaded themes still in the DOM.

---

## 3. Why a frame-time tail turns into *slow cascades*

This is the mechanism that converts "occasional bad frame" into "the whole cascade feels like
mud". It is the core finding.

`src/core/physics.js:35-55`

```js
function waitForAnimationFrame(durationMs) {
    ...
    const tick = (now) => {
        const elapsed = now - start;
        if (elapsed >= durationMs) resolve();
        else raf(tick);
    };
    raf(tick);
}
```

Every step resolves **only on an rAF callback**, so its real cost is `ceil(d / F) * F`
where `F` is the current frame time. Minimum one whole frame per step, always.

The clear sequence (`physics.js:753-800`) is:

| Step | Nominal | Count |
|---|---|---|
| Flash stage 1 | 30ms × speedMul | 1 |
| Flash stage 2 | 20ms × speedMul | 1 |
| Flash stage 3 | 20ms × speedMul | 1 |
| Gravity row step (`physics.js:145`, `:225`) | **16ms** | **one per row of fall** |

Cost of a 10-row cascade as a function of frame time:

| Frame time | Flash | Gravity (10 rows) | **Total** |
|---|---|---|---|
| 16.7ms (steady 60fps) | 100ms | 167ms | **267ms** ✅ |
| 4.2ms (steady 240Hz) | 100ms | 167ms | **267ms** ✅ |
| 72ms (your p95) | 216ms | 720ms | **936ms** ❌ 3.5× |
| 108ms (your p99) | 324ms | 1080ms | **1404ms** ❌ 5.3× |

Two things follow, and both matter:

- **At a steady frame rate the timing is already frame-rate independent.** 60Hz and 240Hz
  produce an identical 267ms cascade. Your instinct is right: this game does not need 200fps.
- **The animation degrades in proportion to the *worst* frames, not the average.** One 108ms
  frame does not cost you 108ms of cascade — it costs you 108ms *per remaining step*. That is
  why the cascade specifically "falls and clears in a slow and laggy way" rather than just
  hitching once.

### Measured A/B (fix landed 2026-08-09)

18-row cascade, timed from `hardDrop` until `isProcessingPhysics` clears, with a
busy-wait injected into every frame to synthesise the stall. Nominal timeline is
70ms flash + 18 × 16ms gravity = **358ms**. Median of 5 runs.

| Injected frame stall | Before | After | |
|---|---|---|---|
| none | 552ms | **362ms** | tracks nominal |
| 80ms | 3689ms | **373ms** | **9.9× faster** |
| 150ms | 6617ms | **479ms** | **13.8× faster** |

Before, cascade duration scaled linearly with frame time — a 150ms frame turned a
0.36s cascade into 6.6 seconds. After, it stays within ~1.3× of nominal even when
every single frame takes 150ms.

Side effect of the same quantization: the "progressive cascade speedup"
(`speedMultiplier` 1.0 → 0.8 → 0.6 → 0.5, `physics.js:749`) is **dead code at 60Hz** — 30ms and
24ms both round up to 2 frames, so cascades 2-4 are not actually faster.

---

## 4. Unclamped delta → the piece teleports after every stall

`src/core/game.js:1366`

```js
const delta = Math.max(0, safeTime - previousTime);   // no upper clamp
```

fed straight into

```js
window.inputController.updateDAS(delta);                       // :1395
processAutoDrop(gameState, delta, playDropCallback, ...);      // :1402
```

`src/core/das.js:advanceDas` then does exactly what it says on the tin:

```js
// Massive lag spike: execute the owed catch-up repeats now.
while (state.intervalAccumulator >= dasInterval) {
    state.intervalAccumulator -= dasInterval;
    act();
}
```

With `dasInterval = 40ms` (the current setting), a 108ms frame fires **~3 moves in one frame**.
Held left → nothing happens for 100ms → the piece jumps 3 columns. Gravity does the same thing
via `processAutoDrop`.

This is the "laggy while stacking" half of the report, and for a competitive game it is the
most damaging defect in this document: the input model is not just delayed, it is
*non-deterministic under load*.

---

## 5. Structural contributors

**5a. Simulation is coupled 1:1 to render frames.** Verified live:
`usingHybridLoop: false`, `_fixedTickEnabled: false` → the plain
`gameLoop` rAF path (`game.js:1437`). One logic update per rendered frame, with whatever delta
the GPU happened to hand us.

The codebase *already has* the fix built and switched off: `src/core/fixed-tick-clock.js` +
`src/core/game-modes/single-player-fixed-tick.js` (canonical 60Hz clock), reachable via
`_fixedTickEnabled` — documented as "Default-off canonical clock (§5.3)"
(`SinglePlayerMode.js:99`).

**5b. `Target Frame Rate: 60` caps nothing in single-player.**
`FrameRateController.shouldProcessFrame()` has **no call sites outside its own file**, and
`BaseTheme.shouldRenderFrame()` (`base-theme.js:1145-1170`) only handles pause / background-
reduce — there is no FPS gate. `needsHybridMode()` is `targetFPS > monitorRefreshRate`, which
is `60 > 240 = false`, so the hybrid path is skipped too.

Net: on a 240Hz display the theme does a **full 3D render every vsync — 240 renders/sec** while
the simulation only needs 60. That is ~4× the necessary GPU work, and it is why there is no
headroom left to absorb a pipeline-creation stall. Raising the frame rate is currently the
thing *preventing* the frame rate from being stable.

**5c. Input is polled once per rAF.** Input latency floor = current frame time (72ms at p95).

---

## 6. Recommended fix order

Ordered by (impact on felt smoothness) ÷ (risk). Items 1-4 are small and mostly local.

| # | Fix | Where | Why | Status |
|---|---|---|---|---|
| 1 | Report `1000 / avgFrameTime`, not `mean(1/t)`. Show the 1% low instead of a min/max "range". | `performance-monitor.js` | Unblocks every measurement below. Currently you are tuning against a number that hides the problem. | **DONE** |
| 2 | Clamp `delta` before DAS/gravity (`MAX_SIMULATION_DELTA_MS = 50`). | `game.js` | Kills the teleporting piece — the worst competitive defect. | **DONE** |
| 3 | Make the clear/cascade animation **time-based**, not step-gated: one shared timeline for the whole sequence, absolute per-step deadlines, catch-up instead of a frame per step. | `physics.js` (`createAnimationPacer`) | Converts "5× slower cascade" into "cascade drops a frame". Measured 9.9–13.8× above. | **DONE** |
| 4 | Gate theme rendering to the target FPS in `shouldRenderFrame()`. | `base-theme.js` + `theme-frame-pacer.js` | Reclaims GPU headroom on high-refresh displays, so a compile stall has slack to hide in. | **DONE** — §9 |
| 5 | Turn on the canonical 60Hz fixed-tick clock for single-player. | `SinglePlayerMode.js:99, 931` | Already built; decouples simulation from render permanently. Do it *after* 4 so the effect is measurable. | open |
| 6 | Prewarm gameplay-effect pipelines. | `warm-hidden-drawables.js` + `stillwater-theme.js` | Targets the actual spike source. | **Stillwater DONE** — §10 |
| 7 | Skip/reduce the fullscreen cursor-trail canvas during gameplay. | custom cursor | 4MP of per-frame 2D compositing for a cosmetic effect. | open |

Fixes 1-3 are pinned by `tests/unit/gameplay-frame-tail-hardening.test.js` (15 tests;
8 of them fail against the pre-fix code, 7 are invariants guarding against
over-correction — sim clock and hit-stop stay on real elapsed time, `onGravityStep`
still fires once per row, seeking still resolves synchronously).

### Confirming the spike source on the reporter's machine

Fix #1 first, then in-game with the overlay open:

```js
window.perfMonitor.getSpikes()        // ring buffer of >33ms frames, with context
window.perfMonitor.getLongTasks?.()   // if empty while spikes are non-empty → GPU-side, not JS
```

If spikes cluster on the first few line clears / first combo of a session and long tasks stay
empty, that confirms pipeline creation (fix #6). If they are evenly spread and scale with
resolution, it is fill-rate and the fix is per-theme cost reduction at Extreme quality.

---

## 7. Measurement appendix

Environment: Chrome (dev server `localhost:5173`), RTX 5080 Laptop, WebGPU, Stillwater theme,
single-player, `usingHybridLoop:false`, `_fixedTickEnabled:false`, `targetFrameRate:60`,
`effectQuality:'Extreme'`, monitor 240Hz.

| Scenario | throughput | p50 | p95 | p99 | max | >33ms | longtasks |
|---|---|---|---|---|---|---|---|
| Stillwater, gameplay, first 5s after theme switch | 82 fps | 8.4 | 16.7 | 108.6 | 154.5 | 17 | **0** |
| Stillwater, warm, 50 forced tetris clears over 20s | 117 fps | 8.4 | 12.6 | 12.9 | 25.1 | 0 | 0 |
| Wolfhour, idle, warm | 201 fps | 4.2 | — | 12.5 | 20.9 | — | 0 |
| Nothing rendering (theme paused) | 200 fps | 4.2 | — | 12.6 | 16.6 | — | 0 |
| Switch to Stillwater (cold) | 191 fps | 4.2 | — | 12.6 | **195.2** | — | 0 |

Note "wolfhour idle" ≈ "nothing rendering" ≈ 4.2ms = exactly one 240Hz vsync: on this hardware
the steady-state render fits the budget. The problem is entirely in the transient stalls and in
how §3/§4 amplify them.

Caveats: this machine renders at 2137×1167 (theme clamps pixel ratio); the report is from
fullscreen 2560×1600 with the perf overlay on and 6 theme switches in-session, so absolute
per-frame cost there is higher than measured here. The *mechanisms* in §1, §3, §4 and §5 are
code-level facts and are resolution-independent.

---

## 8. Cascade feel — Quadra calibration (2026-08-09, follow-up)

Fixing §3 revealed a second problem. Once the animation stopped stretching under load it
started hitting its *authored* constants exactly — and those were too fast. Reported as
"the cascade is too fast", with Quadra named as the reference.

### What Quadra actually does

Read from `C:/Users/olovm/repositories/quadra/source`. Quadra runs a **fixed 10ms tick
(100 Hz)**, decoupled from render, with a catch-up accumulator clamped at 300ms
(`quadra.cc` `main_loop`: `while (acc >= 10) { acc -= 10; overmind.step(); }`) — the same
shape as our pacer. The clear is a three-module state machine in `player.cc`:

| Stage | Module | Ticks | Wall clock |
|---|---|---|---|
| Detect + remove completed rows | `Player_check_line` | 1 | 10ms |
| **Hold / flash** | `Player_flash_lines` (`:738`) | **16** | **160ms** |
| Connectivity scan (moves nothing) | `Player_check_link` `anim==0` | 1 | 10ms |
| **Fall, one row** | `Player_check_link` `anim==1` | **2 per row** | **20ms/row** |
| Final no-op pass + landing sound | `Player_check_link` | 2 | 20ms |

Three findings that shaped the fix:

1. **The fall is constant 20ms/row — no easing, no acceleration.** We were at 16ms/row.
2. **The hold is 160ms and visually loud.** `blit_flash` (`canvas.cc:862`) fills each cleared
   row with a solid bar across the full board width, strobing brightness 255/200.
3. **There is no sub-cell interpolation anywhere in the cascade.** The `smooth` flag is read
   at exactly two places (`canvas.cc:964`, `:972`) and governs only the *player's active
   piece*. Settled and falling blocks draw on the 18px grid. **Quadra's satisfying cascade is
   pure timing.** Our blocks are grid-snapped too, so no renderer work was required.

### Two real bugs this surfaced in our code

- **The per-cell clear flash never rendered.** `physics.js` wrote `.alpha` onto the
  `cloneBoardGrid` scratch, which only `callbacks.updateBoard` sees — and every definition of
  that callback is an empty no-op (`main.js:3390`, `:4633`), while the renderer draws from
  `gameState.boardGrid` (`base-board-scene.js:814`). The visible clear effect was always
  `triggerLineClearFlash` (`shared-effects.js:262`), an additive full-width stripe per row —
  our equivalent of Quadra's bar — tweened over `220 + index*40`ms. **The board was collapsing
  out from under a stripe that was still playing.** The dead alpha code is now removed and the
  hold is long enough for the stripe to read.
- **No beat between removal and collapse.** Nothing repainted between `removeClearedLines` and
  the first gravity step, so the first frame after the hold already had the stack moved down a
  row — cause and effect on the same frame. Quadra gets this beat free from its
  connectivity-scan tick. Added as `settleLead` (`markBoardDirty` + draw + 20ms).

### Constants

```
LINE_CLEAR_HOLD_MS = 160   // Quadra Player_flash_lines: 16 ticks
SETTLE_LEAD_MS     =  20   // Quadra check_link scan tick — rows gone, stack still hanging
GRAVITY_STEP_MS    =  20   // Quadra check_link: 2 ticks/row, constant
SETTLE_TAIL_MS     =  20   // Quadra's final no-op pass — the collapse lands
```

Wave budget = `200 + 20R` ms. The per-wave `speedMultiplier` (1.0 / 0.8 / 0.6 / 0.5) is kept —
Quadra has no cascade speed-up, but deep chains are spectacle here and the wave payload already
carries the multiplier, so wave 1 is Quadra-exact and later waves tighten.

### Measured (RTX 5080, single-player, medians of 5)

| Rows fallen | Measured | Target `200+20R` | Quadra `190+20R` |
|---|---|---|---|
| 1 | 227ms | 220 | 210 |
| 5 | 304ms | 300 | 290 |
| 10 | 408ms | 400 | 390 |
| 18 | 568ms | 560 | 550 |
| 20 | 603ms | 600 | 590 |

Frame-rate independence from §3 is preserved — 18-row cascade with busy-wait stalls injected
into every frame:

| Injected stall | Duration |
|---|---|
| none | 568ms |
| 80ms | 605ms |
| 150ms | 634ms |

(+12% at 150ms frames. Before the §3 pacer, the same case took 6617ms.)

### Rejected: sub-cell interpolated falling

Considered and dropped. Quadra has none in the cascade path, so it is not needed for the
reference feel; and it would require moving falling groups onto `pieceGraphics`, whose shading
and rim treatment differ from `drawBoardFromGrid` (per-piece diagonal ±0.18 and per-piece rim
vs board-global vertical ±0.1 and fused-region rim) — the stack would visibly shatter for the
duration of the fall and pop on landing. It also cannot key off `cell.id`, which is not unique
after a clear (`cascade-helpers.js:118` assigns `pieceId: cellData.id` to every fragment).

### Open / by hand

- Feel is subjective and the four constants above are the tuning knobs. `GRAVITY_STEP_MS` is
  the one to move first; `LINE_CLEAR_HOLD_MS` second.
- **Not implemented:** Quadra scales its landing sound by total fall distance
  (`player.cc`: `i = -500 + tombe * 50`, capped at 0). We fire no sound on cascade settle at
  all — `onCascadeComplete` is consumed only by InfinityMode. Cheap, and it is a real part of
  why Quadra's collapse feels weighty.
- Above level 40 our piece gravity (`constants.js:142-151`) is faster than 20ms/row, so the
  collapse stops reading as faster than a drop. Quadra has the same crossover. Documented, not
  fixed — a level-dependent cascade rate is exactly what Quadra refuses to have.

---

## 9. Theme render cap (fix #4, 2026-08-09)

§5b established that `Target Frame Rate` capped nothing: `shouldProcessFrame()` has no call
sites outside its own file, and `BaseTheme.shouldRenderFrame()` only handled pause and
background-reduce. Every theme therefore rendered a full 3D scene once per vsync — 240 draws
per second on a 240Hz panel for a 60Hz simulation.

New leaf module `src/themes/theme-frame-pacer.js` (pure, renderer-free) with the decision wired
into `BaseTheme.shouldRenderFrame()`, so it applies to every theme at once — they all call that
method from their own loops, and Stillwater's override delegates to `super`.

### The rule, and why the obvious one is wrong

A plain `elapsed >= 1000 / targetFps` gate drops the effective rate **below** the target at any
cadence that does not divide evenly into it: a 165Hz cadence against a 60fps target renders
every 3rd frame = 55fps, and a GPU-bound 90Hz cadence renders every 2nd = 45fps — worse than
not capping at all.

The rule used instead is a one-frame look-ahead: **skip only if the next frame would still land
inside the target interval.** If waiting would overshoot the deadline, this frame is the closest
we can get, so render now.

| Cadence | Target | Result | Behaviour |
|---|---|---|---|
| 240Hz | 60fps | every 4th frame = 60fps | caps, −75% draws |
| 144Hz | 60fps | every 2nd frame = 72fps | caps, −50% draws |
| 165Hz | 60fps | every 2nd frame = 82.5fps | caps, never below target |
| 90Hz | 60fps | every frame = 90fps | declines to cap |
| 60Hz | 60fps | every frame | no-op |
| 240Hz | 30fps | every 8th frame = 30fps | caps, −87% draws |

Because the look-ahead uses the *observed* cadence rather than declared display metadata, a loop
whose rAF has already slowed below the target stops being gated automatically — no oscillation,
no dependence on refresh-rate detection being correct. Cost is exactly one unpaced frame at loop
start, before two calls have been seen; `restartRenderLoop()` resets the estimate.

Escape hatch: `?noThemeFpsCap=1` or `localStorage.setItem('serenity.noThemeFpsCap','1')`.

### Measured (in-game, Wolfhour, single-player)

| Target Frame Rate | Loop cadence | Theme renders/sec | GPU work removed |
|---|---|---|---|
| Unlimited | 121.5 Hz | 121.5 | — |
| **60 fps** | 137.9 Hz | **74.7** | **39%** |
| 30 fps | 156.7 Hz | 33.0 | 73% |

The loop cadence *rises* as the cap tightens (121.5 → 137.9 → 156.7 Hz) — that is the reclaimed
headroom showing up directly: less GPU work per frame means rAF is serviced more often. On a
240Hz display the 60fps cap lands on every 4th frame for an exact 75% saving.

Verified visually: themes render correctly with the cap active, no dropped or corrupted frames.

Pinned by `tests/unit/theme-frame-pacer.test.js` (17 tests covering every cadence above, plus
same-frame idempotence, clock-jump rejection, and reset).

---

## 10. First-use pipeline compilation (fix #6, 2026-08-09)

§2 hypothesised that the stalls were pipeline creation but never proved it. This section proves
it, names the mechanism, and fixes it for Stillwater.

### Measured, before any fix

Each gameplay-effect path costs a large stall the **first** time it runs; every repeat is free.

| Event (Stillwater) | First use | Repeats |
|---|---|---|
| single line clear | **187.9ms** | 16.7–20.9ms |
| triple line clear | **171.3ms** | 12.6–16.8ms |
| 2-wave cascade | **79.3ms** | 16.7–20.9ms |
| Wolfhour, all of the above | no spike | — |

Two qualifiers make this conclusive:

- **Zero `longtask` entries.** The main thread was idle — GPU-side, not JS.
- **`renderer.info.memory` geometries and textures delta = 0.** *Nothing is allocated.* That
  eliminates asset loading and leaves shader/pipeline compilation, which those counters do not
  track.

Wolfhour ran **first** in the same page, warming every shared Phaser path, and Stillwater still
spiked afterwards — so the compiles are theme-side, not the shared board layer. That is the
mechanism behind "works well for many themes, sluggish in some".

### The mechanism

`Renderer._projectObject()` (three r181) opens with `if (object.visible === false) return;`, and
**`compileAsync()` builds its work list through that same traversal**. An FX mesh parked at
`visible = false` is therefore invisible to every warm-up the codebase has. Its pipeline is
created by the *synchronous* `device.createRenderPipeline()` on the first frame it is revealed;
Dawn compiles in the GPU process, which starves BeginFrame without producing a JS long task.

Stillwater parks exactly three, in `rendering/stillwater-reactions.js`, and they map one-to-one
onto the measurements:

| Mesh | Parked | Revealed by | Explains |
|---|---|---|---|
| reaction motes (`InstancedMesh`, also `count = 0`) | `:210` | `spawnMotes` `:489` | first single clear |
| moon shafts | `:296` | `spawnShaft` `:523`, gated `lineCount >= 3` | first triple — and why *double* never spiked |
| lake rune | `:422` | `triggerRune` `:549` | first cascade/echo |

Compounding it: `warmRuntime` skipped `compileAsync` **entirely** when MRT is on
(`if (!usesMrt)`), and `useMRT: useBloom` — so on the bloom tiers (High/Ultra/Extreme, where the
measurement was taken) Stillwater precompiled *nothing*.

### The fix

New pure leaf `src/themes/shared/warm-hidden-drawables.js`:

- `revealHiddenDrawables(roots, {camera, limit, onUnreachable})` — reveals hidden drawables under
  declared roots, walking **up to the root** (`_projectObject` bails on the first invisible
  *ancestor*, so a leaf-only reveal warms nothing), clearing `frustumCulled` (the warm render
  culls against a stale frustum), and bumping `InstancedMesh.count 0 -> 1` (a count-0 instance
  draws nothing). Returns an idempotent `restore()`. It writes only `visible`, `frustumCulled`
  and `count` — none of which is part of a render object's identity, so revealing cannot change
  which pipeline the live frame later asks for.
- `waitForSubmittedGpuWork(renderer, timeoutMs)` — `queue.onSubmittedWorkDone()`, the only real
  GPU fence left in r181. Without it the stall merely relocates onto the first visible frames.

`BaseTheme` gains `getWarmupRoots()` (default `[]`) and `usesMrtScenePass()` (default `false`),
so all other themes are untouched. Stillwater declares its reaction root through the runtime.

**The ordering in `warmRuntime` is load-bearing** and is pinned by a source-order test:

```
runtime.update()  ->  compileAsync (non-MRT tiers only)  ->  REVEAL
                  ->  renderRuntime('warmup')  ->  restore()  ->  GPU fence
```

The reveal is deliberately **not** live across `compileAsync`. That call binds no render target,
so it would bake a one-output shader under a cache key carrying no target component, which then
gets reused for the two-attachment pass — the documented poisoned-cache black screen. Warming
instead through the theme's own `postProcessing.render()` means the compile context *is* the live
frame's context, so an arity mismatch is unrepresentable. Same shape as the proven
`black-hole-theme.js:3344 prewarmPipelines()` and `ocean-gameplay-effects.js prepareForCompile()`.

No gameplay side effects: the reveal never calls `spawnMotes`/`spawnShaft`/`triggerRune`, emits
no events, and runs before `runtime.attach(eventBus)`. Every revealed draw is dormant
(`alive = 0` -> opacity 0, motes zero-area), so nothing paints.

Escape hatch / A-B lever: `?stillwaterReactionWarm=0`, or
`localStorage.setItem('serenity.stillwaterReactionWarm','0')` for packaged Electron.

### Verification — measured A/B

Instrument: `renderer._pipelines.caches.size`. `renderer.info.memory` counts only geometries
and textures, which is exactly why the original capture showed a zero delta across a 187.9ms
spike. Two legs, separate document loads, booting straight into Stillwater.

| | Leg A `?stillwaterReactionWarm=0` | Leg B (fix) |
|---|---|---|
| `warmedReactionDraws` | 0 | **3** — exactly the three parked meshes |
| `warmUnreachableDraws` | — | **0** — all camera-reachable |
| pipeline cache after warm | 77 | **80** — exactly **+3** |
| `usesMrtScenePass()` | true | true |
| new console errors | — | none |

The three pipelines that previously compiled on the first line clear, first triple and first
cascade are now created during the masked warm window. Reproduced across three separate loads.

Poison check passed: no console message containing `targets[`, and the only WebGPU errors
present (`copyFramebufferToTexture` format mismatch and a `depthBuffer` sample-count mismatch,
both from the atmosphere soft-particle path) appear **identically in Leg A**, so they are
pre-existing and unrelated. They are worth their own ticket.

**Still not measured: the in-game spike collapse.** That needs a line clear, and the dev
browser crashed on game start after hours of heavy WebGPU work. The pipeline-cache delta is
strong evidence (those exact pipelines are now pre-created), but the frame-time confirmation
should be run on a fresh session: play a single clear, a triple and a cascade with
`window.perfMonitor.getSpikes()` open, on each leg. Leg A should show 70-200ms spikes on first
use; Leg B should show none. `getLongTaskSummary().count` must be 0 in both.

### Why there is no GPU fence

The plan called for `queue.onSubmittedWorkDone()` after the warm render, so the compile could
not relocate onto the first visible frames. It was implemented, measured, and **removed**:
awaiting it yields control for ~200-400ms while the warm render's command buffer is still in
flight, and activation rebuilds render targets underneath it. That produced a reproducible
`Destroyed texture [Texture "depthBuffer"] used in a submit` uncaptured WebGPU error, caught by
`GPUResilience`.

Isolated by A/B: reveal ON + fence ON → error present (2/2 runs). Reveal ON + fence OFF →
`warmedReactionDraws` still 3, pipeline cache still 80, error gone. The reveal is the fix; the
fence only decided when we stop waiting for Dawn. A source test now asserts
`waitForSubmittedGpuWork` does not appear in `warmRuntime`. The helper remains exported and
unit-tested for other callers. If the first visible frames are ever measured to spike, the
correct remedy is to hold the activation mask across an extra rendered frame.

### Honest limitations

- **The 79.3ms cascade number is not attributed.** `triggerRune` is reachable only via B2B echo,
  perfect clear, or combo >= 10. The harness that produced 79.3ms generated an ordinary 2-wave
  cascade, which may not reach it. The fix warms *every* hidden drawable under the declared root
  rather than a named list, so it is covered iff the cause is a Stillwater draw parked invisible.
  If Leg B still spikes on the cascade, the theory was incomplete there.
- **The first real event is not literally free.** The warm frame draws with dormant instance data,
  so the first event still performs the first attribute upload — expect a small residual.
- **Only Stillwater is fixed.** The hook exists for any theme, but adopting one is only cheap
  where a masked warm window already exists (stillwater, koi-pond, moonlit-forest). `lunara` is
  structurally identical and warmed by nothing.
- **Shape-B themes need different work.** A reveal cannot warm what does not exist yet.
  `stellar-velocity` builds an entire GPU **compute** pool on the first line clear
  (`initializeBurstComputePool`), and `device.createComputePipeline` has no async variant in r181.
  `neon-dusk`, `chiral-gold`, `cosmic-noir`, `neon-district` share that shape. Those need lazy
  construction hoisted to scene build first.
- **`wolfhour.prewarmReactiveMaterials` is a no-op** — `visible = true; visible = false;` in
  consecutive statements with no render between, then `compileAsync` after visibility is already
  false. Wolfhour measured clean for unrelated reasons (`useMRT: false`, a credit-paced spawn
  queue, `starBurst` warming on every lock). Worth repairing so it does what it claims.
- **Two pre-existing latent black-screen exposures** remain: `ocean-theme.js:1289` and
  `OdysseyMode.js:2694` both call bare `compileAsync(scene, camera)` with no target bound while
  their themes can be on `useMRT: true` presets. Separate ticket.
