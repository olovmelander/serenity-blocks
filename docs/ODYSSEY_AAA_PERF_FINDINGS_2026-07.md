# Odyssey — AAA performance findings & plan (measured, 2026-07-26)

> Goal: Odyssey should **load fast and feel smooth** on a high-end laptop (RTX 5080).
> This is a *measured* investigation — every number below is a real capture on the RTX
> 5080 via the perf-session lane (visible window = real GPU; see the compile-cost doc for
> the capability note). Load is the dominant problem; steady scroll is already smooth.

## 1. The measured reality (RTX 5080, cold fresh, post octave-cut)

| Axis | Result | Verdict |
|---|---|---|
| **Load → board-visible** | **~6.4 s** | too long (AAA wants < ~3 s to interactive) |
| — startup buckets (ms) | renderer 630 · creates 926 · path 25 · nodes 797 · post+director 481 · **compiles 1946** · warmup 544 (total 5498; +~874 overlay/fade → 6372 board-visible) | |
| — compile-breakdown (ms) | **ch1=3763** · ch2=835 · corridor=275 · breach=165 | earth-core dominates |
| **Warm scroll** (travel through chapters) | p50 9.7 · p95 19 · max 23 · **0 spikes >33 ms** | **smooth ✅** |
| **Seam transition** | p50 7.9 · p95 12 · **max 205 ms** (2 spikes: 205, 84) | hitches ⚠️ |
| **Post-reveal** | 66–73 long tasks (bg chapter loading blocking main) | early interaction janky ⚠️ |

Steady idle is p95 ~7 ms (committed baseline). **The problem is not steady-state frame
rate — it's (a) the ~6.4 s load and (b) the first several seconds after reveal.**

## 2. Critical-path analysis — WHY load is 6.4 s

The startup buckets are **sequential trace segments that sum to the total**. The
per-chapter `compileAsync` is launched during the create loop (`compilePool.push`,
OdysseyBoardController.js:624) and **awaited at the barrier** (`await Promise.all`,
:760), then warm-up (:768), then reveal (:771-772). So the GPU compile overlaps the CPU
create/node/post work, and the `compiles` bucket (1946 ms) is the **un-overlapped tail**.

**earth-core's compile (ch1=3763 ms) > all pre-barrier CPU work (renderer+creates+nodes+post
≈ 2834 ms), so the compile is the critical path.** Consequence, verified by the numbers:
- Reducing CPU buckets (creates/nodes/particles) does **not** cut load — it just exposes
  more compile tail (the compile still has to finish). Confirmed compile-gated.
- The barrier already can't defer the neighbor usefully: ch2/corridor/breach all finish
  long before ch1 (the earlier OD-05 finding — barrier split is a no-op cold-fresh).
- **The only real load cuts are: (a) reduce earth-core's compile, or (b) progressive
  reveal** (reveal on a cheaper earth-core, stream full detail in post-reveal).

## 3. What's landed (this investigation)

- **earth-core `moltenRockField` fbm 4→3 octaves** (`899b1bb5`) — rigorous back-to-back
  A/B: ch1 **4211 → 2737 ms (~1.47 s / ~35 %)** off the compile critical path; screenshot
  A/B showed no visible change. *This is the single biggest landed win.*
- **Per-item compile instrumentation** (`b8ab70dd`) — `[OdysseyStartup] compile-breakdown`, a permanent regression canary; it's how ch1 was isolated.
- **Perf-lane capability**: `--screenshot` (`fdaa3a32`) + anti-throttle switches
  (`f5625e6a`) — the measure→change→re-measure→screenshot loop is now self-serve on the
  real GPU. (Variance note: cold ch1 ranges ~2700–3800 ms run-to-run; always A/B back-to-back.)

## 4. Ranked next levers (measured impact, risk, measurability)

| # | Lever | Cuts | Est. impact | Risk | Measurable? |
|---|---|---|---|---|---|
| **1** | **Bake earth-core `moltenRockField` → noise texture** (replace remaining ~30 `mx_noise_float` with 1–2 `texture()` samples) | compiles (ch1) | **~0.5–1.0 s** more off ch1 | **high** (visual) | yes — compile A/B + screenshot A/B (both self-serve now) |
| **2** | **Progressive reveal** — reveal on a lightweight earth-core (fewer materials / a "cold" LOD), swap to full detail post-reveal behind the existing crossfade | compiles + warmup (critical path) | **large** (~2–3 s to *interactive*) | **high** (arch + visual) | yes — board-visible before/after |
| **3** | **Frame-health-gate the post-reveal bg-load** — `frameHealthBudgetMs` 33→~16 (real 60 fps headroom, not 30), fix the 8 s starvation escape to a cheap unit, adaptive inter-step spacing (OdysseyBoardController.js:401,966,985) | post-reveal jank | kills most of the 66–73 long-task hitches during early interaction | low (scheduling, no render change) | needs a **post-reveal-scroll scenario** (scroll *before* clean-runtime) — harness add |
| **4** | **Prioritize next-chapter breach/warm** so the first seam doesn't compile on-screen (the 205 ms transition spike is a first-transition compile) | transition hitch | removes the 205 ms seam spike | med | yes — transition scenario |
| **5** | **Tier-gate octave counts by quality** (earth-core + shared noise) | compiles (Low/Med only) | broadens the win to weaker GPUs; no Extreme change | low | yes |

## 4a. The seam hitch — ROOT CAUSE + FIX (landed & verified 2026-07-27)

**FIXED.** The background render-warm fails for ch3/5/8 (`setPipeline(undefined)`) — an
intermittent WebGPU compile-vs-warm **race** (the group `compileAsync` resolves but a
pipeline variant isn't ready when the warm renders). The old code caught the throw and
marked the chapter `_renderWarmed=true` **anyway**, so it compiled on-screen on first
visit = the spike. Fix (`_renderWarmChapterOffscreen` now returns success; the sweep
**re-queues** a failed warm up to 5× instead of falsely flagging it done). **Verified,
back-to-back committed captures:** the race reproduces (`render-warm failed for chapter 3`)
**and the retry completes it**, giving transition **max 20–29 ms, 0 spikes** — vs
**205 ms + 2 spikes** before. Load is unaffected (the warm is post-reveal).

Residual (separate, cosmetic): ch3 (surface-world) + ch8 (urban-dreams) still log
`THREE.TSL: normal not found` — a `normalView` material on a normal-less geometry (three
falls back). Not the smoothness bug (ch5 races without it); worth a cleanup pass
(`computeVertexNormals` on the culprit geometry, per the precedent at
surface-world.tsl.js:1365). The `--diag` / `?odysseyWarmProbe=1` flag un-gates the
`_probeWarmFailure` culprit-namer for that.

### Original diagnosis (retained)

The 205 ms transition spike is **not** un-warmed streaming — it's a **bug**: the
background render-warm **fails** for chapters **3, 5, 8**:

```
[OdysseyBoard] Background render-warm failed for chapter 5: setPipeline … not of type 'GPURenderPipeline'
```

`_renderWarmChapterOffscreen` (OdysseyBoardController.js:1184) does one
`renderer.render(scene, camera)` with the chapter visible; it throws `setPipeline(undefined)`,
is caught (:1204), but `env._renderWarmed = true` is set **anyway** (:1153) — so the chapter
is flagged warm while its real pipeline was never built → it **compiles on-screen on first
visit** = the spike. **Correlated:** ch3 (surface-world) + ch8 (urban-dreams) flood
`THREE.TSL: Vertex attribute "normal" not found on geometry` at create — a material sampling
normals on a geometry with no `normal` attribute, i.e. a pipeline-variant the group
`compileAsync` didn't build. **Fix direction:** find the normal-less-geometry/normal-material
combo in surface-world/urban-dreams (the `_probeWarmFailure` probe at :1236 names it, but is
gated to `?odysseyAAA=1` and doesn't fire under `odysseyPerfRun`; un-gate it for `--diag`
captures), add the missing normal attribute or drop the normal read, and stop marking
`_renderWarmed=true` on a thrown warm. **Impact:** removes the seam hitches for the ~3 affected
chapters — the biggest *smoothness* win. Risk: med (material/geometry change → screenshot A/B).

## 5. Recommended sequence

1. **Lever 1 (bake)** — biggest *safe-to-verify* load win now that screenshot A/B is
   self-serve. Do it in the playground/perf-screenshot loop: bake `moltenRockField`,
   compile A/B (expect ch1 well under 2 s), screenshot A/B for look parity.
2. **Lever 3 (post-reveal gate)** — needs a small harness add: a `scroll-early` scenario
   that scrolls *immediately* after reveal (skip `waitForCleanRuntime`) so the post-reveal
   jank is measurable; then tighten the gate and A/B the long-task count.
3. **Lever 4 (seam prewarm)** — kill the 205 ms transition spike.
4. **Lever 2 (progressive reveal)** — the architectural swing for a true AAA cold start,
   once the cheaper wins are banked and measured.

**Everything here is now measurable + verifiable locally** (perf-session `--screenshot` +
the per-item compile trace + the anti-throttle switches). The discipline: A/B back-to-back
(git-stash), and screenshot-A/B any visual change.

## 6. The loading-overlay "freeze" — root cause + PARTIAL FIX (2026-07-27)

**Symptom (user):** starting Odyssey, the loading overlay's stars/dots/rings freeze
instead of animating while the mode loads.

**Diagnosis (chrome-devtools MCP on the RTX 5080, in-page rAF + `getComputedStyle(overlay)`
sampler + screenshot bursts):**
- The overlay is shown (`_showOdysseyUI` → `showCinematicLoadingOverlay('ODYSSEY')`,
  opacity 0, fade-in scheduled via a double-rAF) and then `onActivate` goes **straight**
  into the cold WebGPU board build (`_showBoardView` → `_initializeOdysseyBoard` →
  `boardController.initialize`). The chain to the first real paint-yield (`renderer.init`)
  is **all microtask awaits**, so the browser never paints the overlay until *after* the
  build — the user sees a **frozen mode-select menu** (confirmed: burst screenshots during
  load show the menu + the earth-core lava behind it, `perfMonitor last: ~5920ms`, i.e. a
  single multi-second rAF gap; the "ODYSSEY" overlay is not yet visible).
- `setCinematicLoadingOverlayBuilding` (the main.js theme-path "hide the motion during the
  build" workaround) is **not wired on the Odyssey path**, so on Odyssey the animations are
  never hidden — they genuinely freeze.
- The build already yields between coarse steps (`_yieldToMain`, double-rAF), but the
  sampler shows the whole build as ~one 4–6 s rAF gap: the **earth-core (ch1) shader
  compile (~3.1 s)** saturates the GPU process, and while a WebGPU pipeline compile owns
  the GPU, **BeginFrame/vsync is starved → the compositor cannot present** → even
  compositor (transform/opacity) animations freeze. Corroborated: `Page.captureScreenshot`
  could not return a frame *during* the block — every burst shot resolved only *post*-block.

**Landed (partial) — `8ed24d2`:** `waitForCinematicLoadingOverlayPresented()` (3 rAFs + a
macrotask, 250 ms rAF-starvation safety net, headless guard) awaited in `onActivate`
**before** `_showBoardView`. Now the overlay paints + commits its compositor animations
*before* the build. Verified: overlay reaches `opacity 1` and animates at ~6 ms frame gaps
**before** the build's block (was: frozen menu, overlay never visible). Fixes the
wrong-screen / "hung menu" half.

**Residual (NOT fixed):** the ~3.1 s earth-core-compile window still freezes the overlay
(GPU/BeginFrame starvation — no on-page animation, compositor or main-thread, can run while
the GPU compiles for seconds). This is the **same compile-gated bottleneck as §2** — the
only real fixes are the **Lever 1 bake** (cut ch1's compile so the freeze is short) or a
**menu-idle board pre-warm** (compile earth-core in the background while the player is on
the menu, so entering Odyssey finds the pipeline already built — moves the stall out of the
click, but costs menu-time GPU/memory and needs its own lifecycle). Both are focused
follow-ups; do them in the perf-session/playground loop, not bolted onto an overlay change.
