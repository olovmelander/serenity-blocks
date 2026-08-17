# Odyssey — Best-in-Class Performance Masterplan (2026-08-17)

**Goal:** a completely seamless, smooth, lag-free Odyssey — startup, drop-in, and the whole
traverse — engineered the way top-tier games do it, and **proven by numbers, not vibes**.

**Provenance.** This plan stands on three legs, all from 2026-08-17: (1) a measured
investigation with 6 shipped fixes (docs/ODYSSEY_LOADING_AND_FREEZE_PLAN_2026-08.md §1–17);
(2) two multi-agent code audits with every load-bearing claim adversarially line-verified
(16 agents, 0 refutations that survived); (3) an industry research sweep across UE5 PSO
precaching, Valve Fossilize, Insomniac's Spider-Man streaming, Decima, BotW/Zelda, God of War,
Metroid Prime, Ghost of Tsushima, and web/WebGPU-specific practice (three.js upstream issues,
Dawn source, PlayCanvas benchmarks, shipped-web-game postmortems).

---

## 0. Where we stand (measured, not estimated)

| Metric (validated harness, process-per-run, median [IQR]) | Today |
|---|---|
| Forward traverse stall, **patient** protocol (settle 12 s) | 1 795 ms [1 791–1 802], worst 487 ms, 5 gaps >100 ms |
| Forward traverse stall, **eager** protocol (settle 6 s) | ~7 500 ms, worst ~3 200 ms |
| Backward traverse stall | **0 ms [0–0]** — all first-visit cost, zero rendering-limit cost |
| Board visible | 4 388 ms [4 341–4 522] |
| First boot after an app update | +~1.4 s (Dawn pipeline cache keyed to build) |
| Validation errors / failed runs | 0 / 0 |

Already shipped this cycle: the render-warm sweep fixed (was structurally inert), async
post-format compiles, the background-gate fix (`_isScrollIdle`), the theme-warm collision
sequenced out, the travel gate (opt-in), golden-hash-pinned world bakes, and the
repeated-measures harness itself (±0.3 % IQR — sub-100 ms effects now resolvable).

**The one-sentence diagnosis:** every remaining hitch is *work arriving on a visible frame* —
chapter construction (2–3 s indivisible JS builds), first-visible-frame reveals of pre-existing
hidden objects, and pipeline compiles that escape warming. No shipping engine lets any of those
touch the frame, and neither will we.

---

## 1. The industry model — four pillars

**P0 — Measure like an engine team.** UE treats any runtime pipeline creation >20 ms as a
counted hitch; Valve validates shader caches against a *cleared* driver cache because the driver
cache produces false positives. We already rebuilt both lessons independently (the harness; the
"stale Dawn cache reads as cold" rule). Standing rules: every claim goes through the harness
(median+IQR, IQR overlap ⇒ NOT RESOLVED); backward-stall must stay 0; re-baseline on every
Electron bump (compile throughput is browser-build-dependent).

**P1 — Never build on the render thread.** Insomniac's AddToWorld runs micro-steps inside
`while (now < deadline)`; budgets are tiered by game state (Spider-Man: 2/4/10/50 ms); task
granularity is uniform so no single step can blow the slice; priority = f(distance in travel
direction, velocity); load/activate hysteresis prevents thrash. Our translation: chapter
construction becomes a step sequence driven by a budgeted scheduler, with `scheduler.yield()`
available unflagged in Electron 38.

**P2 — Never compile in view.** UE5 precaches speculatively at load and — critically — makes a
*miss* non-blocking: the object skips a few frames or renders in a fallback material until the
async compile lands. The frame never waits. On WebGPU the explicit pipeline-cache API does not
exist (spec dropped it); Dawn caches transparently per build (verified in Dawn source: real
VkPipelineCache / DXC blobs) — which is exactly why post-update first boots are cold. Our
translation: keep the compileAsync warm architecture (it *is* the UE structure), add the two
missing halves — a recorded warm **manifest** replayed deterministically behind cover, and
**object-granularity readiness gating** so anything that escapes warming pops in late instead of
hitching.

**P3 — Never let the player outrun readiness — and dress the wait.** Galaxy's launch star, God
of War's boat, Metroid Prime's door locks: all diegetic covers over readiness gates. What makes
a hold read as *intentional* rather than broken: eased settle onto a composed framing, ambient
motion that never stops, audio continuity, and a **minimum-hold floor** (Ghost of Tsushima pads
a beat rather than flicker it; if readiness is <~200 ms away, skip the ceremony entirely). Our
travel gate is the mechanism; this pillar is its costume.

---

## 2. The findings that make the plan concrete (all line-verified)

**F1 — The steady-state band (p = 0.03–0.14) is four named reveals + one recompile.** Fast-start
warms exactly ONE frame at p=0, so these pay their first real render mid-traverse: the steam
quench (p≈0.005), Earth Core's lava fall + splash (p≈0.031, hidden descendants), the **entire One
World group** (act gate at p≈0.043 — ~233 k-tri clipmap + five DataTextures), the
threshold/breach director (1→2 seam), and the bloom on/off output variant (never warmed under
fast-start). Forest chunk uploads land at p≈0.185–0.20, not in the band. A **motion warm** —
stepping renderFrame across p = 0→0.21 behind the overlay — covers every one of them.

**F2 — Two structural warming defects.** `_prewarmChapterEnvironment` and
`_renderWarmChapterOffscreen` do not reveal hidden descendants (unlike `_prewarmGroup`, which
deliberately does) — so any progress-gated sub-object is *unwarmable by design*. And the Batch5
30 Hz throttle both never engages in play (settle threshold below the auto-drift lag) *and* is
live during warm scrubs where it can skip seam work on a warm sample.

**F3 — Chapter creation is one unbroken synchronous block, and it is sliceable.** One await
(module load), then `def.create()` + 3–4 manager traversals + a forced `updateMatrixWorld(true)`
over all resident chapters. The factories are 100 % synchronous and allocation-only (zero asset
loads). Ch6 is the whale: a ~260 ms CPU backdrop bake (1024×512, ~42 M hash ops), an SDF nebula
sculpt (6 masses × 18-step raymarch), particle fills. Ch7/8: ~12–16 TSL builders each. The house
yield idiom already exists (`LevelNodeManager.createNodes(levelData, yieldFn = null)`).

**F4 — The consumer contract forbids partial registration.** Every consumer treats map presence
as "fully built"; two sites use *absence* as their only "not created" signal. Registration must
stay at the end; an in-flight dedupe is needed (a double-build race exists today); eviction can
free a still-building chapter (verified one-line bug).

**F5 — The startup chain hides a 700 ms overlap and a trace blind spot.** `createOdysseyWorld`
(~1 220 ms) has **zero dependency on the renderer** and can run concurrently with
`renderer.init()` (~700 ms). It also sits *outside every trace span* — the doc table that
attributed it to `creates` was wrong. ~400 ms of the 600 ms `nodes` step is double-rAF yield
latency, not work. The 865 ms overlay fade is compositor-only and gates nothing. All five world
bakes are worker-safe by construction; three are mutually independent; all construct their
DataTextures identically (mechanical compute/wrap split, protected by the golden-hash suite).

**F6 — 14 test files call the chapter factories synchronously** — so slicing must be opt-in at
the call site (sync when no yield function is provided), which the step-generator shape gives us
for free.

---

## 3. The plan

Each phase ships behind a flag, is judged on the named harness protocol, and only graduates to
default when its criterion is met with non-overlapping IQRs. Backward-stall = 0 and
validation-errors = 0 are standing gates on every phase.

### Phase A — Kill the band (the traverse stutter) · *days, low risk*

1. **Motion warm.** Replace fast-start's single p=0 sample with a short scrub p = 0→0.21
   (~8–10 renderFrame steps) behind the overlay — reusing the existing `_warmUpJourney` loop
   body. Covers all four F1 reveals + the forest crossing. Disable the Batch5 throttle during
   warm scrubs (F2b) so samples cannot silently skip seam work.
2. **Warm the bloom output variants** under fast-start (the F1 recompile).
3. **Reveal hidden descendants during warms** (F2a) — port `_prewarmGroup`'s deliberate
   deep-reveal into `_prewarmChapterEnvironment` / `_renderWarmChapterOffscreen`.
4. **Fix the trace blind spot** (F5) so the One World build appears in the startup summary.

**Criterion (patient):** forward stall ≤ 600 ms, worst gap ≤ 150 ms, gaps>100 ms ≤ 1.

### Phase B — Sliced chapter creation (the drop-in freeze) · *~1 week, medium risk*

The step-generator design, fixed by the verified constraints:

- Each ch6/7/8 factory becomes an authored **step sequence** (generator): one builder per step,
  the ch6 backdrop bake row-chunked into ~8 steps, the SDF sculpt per-mass. Two drivers: drain
  synchronously (no yieldFn — the 14 test files and any legacy caller unchanged), or drain under
  a **deadline loop** (`while (now < deadline) step()`) with budget tiers à la Spider-Man:
  ~5 ms/frame during play, ~50 ms/frame behind covers.
- Manager: registration stays at the end (F4); in-flight promise dedupe; the eviction
  still-building guard fixed; the per-create forced `updateMatrixWorld(true)` scoped to the new
  group only.
- Priority = signed p-distance in scroll direction (P1); creation tasks and the prewarm/warm
  queues merge into **one scheduler** with one budget, replacing the three setTimeout chains.

**Criterion (eager):** forward stall ≤ 2 500 ms, worst gap ≤ 500 ms, and no gap attributable to
creation (gap-at-p instrumentation added to the harness output).

### Phase C — Startup re-chain (time-to-board) · *days, low-medium risk*

1. Start `createOdysseyWorld` **concurrently** with `renderer.init()` (F5 — they share nothing);
   join before scene attach. (−~700 ms)
2. Cut the `nodes` yield latency (−~400 ms): batch by deadline, not by fixed count-plus-double-rAF.
3. Overlap the 865 ms overlay fade with the Phase A motion warm (the fade is compositor-only).
4. Overlay dismissal keyed on `queue.onSubmittedWorkDone()` rather than frame counts — correct
   on both the iGPU and the RTX tier.

**Criterion:** board visible ≤ 3 000 ms median (patient), no regression in eager stall.

### Phase D — World build off-thread · *~1 week, low risk (golden-protected)*

Compute/wrap split of the five bakes (mechanical — F5), then run the three independent bakes in
workers with transferable buffers, overlapped with renderer init. The golden-hash suite makes
"did the pixels move?" a byte-exact question. Target: the One World build's main-thread share
→ ~0; board visible ≤ 2 500 ms stretch goal.

### Phase E — Pipeline manifest + object-granularity readiness · *~1 week, medium risk*

1. **Recorded warm manifest** (the bundled-PSO-cache analog): the journey replay *is* the
   recording run — persist the ordered pipeline/material manifest; on first boot and on
   **detected app/Electron version change**, replay it behind an honest "optimizing…" moment
   (CoD/HZD pattern). Kills the post-update 1.4 s cold tax and any lazily-discovered compile.
2. **Object-level readiness gating** (UE5 proxy-delay analog): a per-material warm promise;
   until resolved the object stays invisible (or in a cheap already-warm fallback) — gate at
   object level, never per-pass. Converts every future warming escape into brief pop-in instead
   of a frame hitch. This is the systemic backstop that makes the whole system future-proof.

**Criterion (patient):** forward stall ≤ 250 ms, worst gap ≤ 120 ms, gaps>100 ms = 0 on second
boot; post-update boot shows zero mid-play pipeline creation.

### Phase F — The dressing + the flips · *design-led, parallel*

1. **Travel gate → default ON**, dressed per P3: eased settle onto a composed vista framing,
   ambient motion + audio continuity through the hold, a **minimum-hold floor** with
   skip-when-ready (<~200 ms ⇒ no ceremony), and a Galaxy-style release swoop. Optionally anchor
   at a diegetic threshold (the ch5→space limb/flyby at p 0.545–0.648 is a natural corridor).
2. **Eviction ON** via the Phase B scheduler (time-budgeted teardown through the same queue —
   never a synchronous chapter dispose at a boundary).
3. RC-9 (the 30 Hz position-work throttle) fixed properly — needs capture verification since it
   changes visible update cadence.
4. Then **three r186** (upgrade research already done): re-baseline everything; its compile-cost
   improvements land as free wins on top of a system that no longer depends on them.

---

## 4. Explicitly considered and rejected (for now)

- **Full renderer-in-worker (OffscreenCanvas).** Viable on Electron 38 in principle; a major
  refactor of a shipped app's whole UI/render boundary for a problem the scheduler + gating
  pillars solve at far lower risk. Revisit only if Phases A–E leave measurable main-thread cost.
- **Per-material compile slicing.** Measured dead end — the cost is not distributed per material
  (conserved-cost finding, plan doc §16).
- **"Hold the loading screen until everything is ready."** The anti-pattern this plan replaces:
  it trades the fast reveal for a ~19 s screen and still doesn't cover post-reveal discovery.
- **Precomputed shipped bake assets** (vs workers): same saving as Phase D, plus binary-asset
  drift risk; workers keep one source of truth.

## 5. Measurement discipline (standing law)

1. One GPU consumer at a time — concurrent session work attributes its cost to whoever awaits
   (the conserved-cost lesson).
2. Same build **and** same Dawn-cache state, or the comparison lies; post-update = cold.
3. Harness only (process-per-run), named protocol (patient/eager), median+IQR, IQR overlap ⇒
   NOT RESOLVED ⇒ add runs.
4. Standing regression gates: backward stall 0, validation errors 0, `bgRenderWarmComplete`
   reached, all chapters warmed.
5. Add **gap-at-p** to the harness run records (it currently keeps only summaries) so every
   future hitch is attributable to a path location by default.

## 6. End-state definition of "flawless"

| Metric | Today | End state |
|---|---|---|
| Board visible | 4.4 s | ≤ 2.5–3.0 s |
| Drop-in window (eager fwd stall) | 7.5 s | ≤ 2.5 s, no creation-attributable gap |
| Steady traverse (patient fwd stall) | 1.8 s | ≤ 250 ms, zero gaps >100 ms |
| Worst single frame, anywhere | 3.2 s | ≤ 120 ms |
| Backward traverse | 0 | 0 (standing gate) |
| Post-update first boot | +1.4 s cold + mid-play compiles | covered by "optimizing…" moment, zero mid-play compiles |
| Player can reach unready content | yes (gate opt-in) | never (gate default, dressed as a beat) |

That end state *is* the Galaxy standard, achieved the way Galaxy achieved it: not by being
cheaper, but by never letting construction, compilation, or readiness ever touch a visible frame.
