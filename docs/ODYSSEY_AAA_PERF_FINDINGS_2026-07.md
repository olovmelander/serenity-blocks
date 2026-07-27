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

### 6a. Octave-cut lever is EXHAUSTED (13-agent adversarial workflow, 2026-07-27)

Before reaching for the risky bake, we ran a fan-out (4 material-group analyzers × per-cut
adversarial verifiers) over all 15 earth-core TSL pipelines to find *safe* instruction-count
cuts. **Key structural finding:** the local `fbm()` helper (earth-core.tsl.js ~L88) computes
its **3 base octaves UNCONDITIONALLY** and only gates the 4th on `if (octaves >= 4)`. So
`fbm(...,3) -> fbm(...,2)` is a **byte-identical no-op** (zero compile saving) — the "just cut
more octaves" idea is mostly a mirage. Every noise site is *already* at the 3-octave floor
except the two `createLavaFallTSL` streaks, which defaulted to 4 octaves; those were cut to 3
(landed `ccad529`, 2 snoise3 removed, screenshot-verified identical). **Net: the safe
mechanical octave lever is now spent** (~0.4 s, within run-to-run compile noise). Going below
3 octaves requires adding an `octaves >= 3` guard to `fbm()` and cutting at threshold-fed
sites (veinRidge/crustMap/cloud-density) — the verifiers flagged these as visible-banding
risks. So meaningful further compile reduction genuinely requires the **bake** (replace
moltenRockField's ~21 snoise3 with 1–2 texture() samples — big win, high visual risk) or the
**menu-idle pre-warm**. NB: cold ch1 compile is very noisy run-to-run (measured 3123 / 4053 /
5028 ms across three runs; the 5028 run had koi-pond WebGPU contention) — any compile A/B must
be back-to-back, and sub-0.5 s deltas are unmeasurable.

## 6b. The bake (moltenRockField noise → texture) — playground exploration, NOT shipped (2026-07-27)

Explored the Lever-1 bake in the playground (`src/playground/effects/earth-core-lava-bake.effect.js`
— a reusable A/B harness: two lit boulders, procedural `mx_noise_float` vs a baked tileable
3D-Perlin-noise `texture3D` lookup; `?variant=proc|baked|split`). Six screenshot-verified
iterations (RTX 5080, WebGPU): frequency-match (decouple period from grid → ~2 features/unit),
Float32 texture (kill Uint8 contour banding), Perlin's classic 12 isotropic gradients, then a
**hybrid** (bake only the forgiving low-freq layers, keep the sharp high-freq analytic).

**Finding — the bake works mechanically but is not a free lunch:**
- A tileable finite noise texture **cannot cheaply reproduce `mx_noise_float`'s statistics**
  (value distribution + spatial character). Every baked layer shifts the look:
  - the **vein** (`1-abs(fbm)` @×3.2) is the most sensitive — trilinear texture creasing (C0)
    becomes extra filaments the ridge amplifies; must stay analytic.
  - the **crust** (@×2.6) reads as a marbled/swirly character vs the procedural's finer speckle.
  - the **warp** (@×0.5) displaces the coordinate for *everything* downstream, so baking it
    changes the whole molten meander; the **rivers** shift molten coverage.
- Result at every stage: "molten rock, but a **distinguishably different** molten rock" in the
  bright isolated A/B (a torture test). In-scene the rocks are distant, ~70% near-black, dimly
  lit background framing, so the difference is *likely* imperceptible — but that is UNVERIFIED.

**Why it's not shipped:** shipping a distinguishable change to the signature earth-core lava on
an isolated-test basis is too risky. Two open costs also make the ROI unclear: (1) generating
the noise texture at load is ~0.5–1 s CPU (96³ Float32) which **offsets** the compile saving
unless baked offline to a KTX2 asset or generated on GPU; (2) moltenRockField is only 2 of ~15
ch1 pipelines, so a faithful bake of just it cuts only *part* of ch1 — a meaningful global cut
needs per-material bakes (lava-floor 18 noise, canopy 12, …).

**Definitive next step (focused session):** port the hybrid bake behind a DEFAULT-OFF flag
(`?earthCoreBakeNoise=1`, zero shipped risk), A/B the real earth-core scene in-browser, and
measure the compile delta back-to-back. Ship only if in-scene is imperceptible AND the net
(compile saving − texture-gen cost) is clearly positive. The playground harness is committed to
resume from.

## 6c. The bake — LANDED behind a DEFAULT-OFF flag + MEASURED shippable (2026-07-27)

Did exactly the §6b next step. `src/rendering/odyssey/chapter-environments/shared/odyssey-baked-noise.js`
(`buildTileableNoise3D`, ported from the playground harness) + earth-core's `moltenRockField`
now routes its **bulk** (warp/rivers/crust, ~18 of 21 snoise3) through the baked 3D-noise
texture under `?earthCoreBakeNoise=1`; the sharp **vein** stays analytic. Flag OFF = byte-identical
to today (`snBulk = snoise3`) → **zero shipped risk**.

**Measured (RTX 5080 WebGPU, back-to-back COLD runs, Dawn pipeline cache cleared each run):**

| bucket | procedural cold | baked cold | Δ |
|---|---|---|---|
| **compiles** (un-overlapped tail) | **2114 ms** | **1192 ms** | **−922 ms (−44%)** |
| board-init | 4941 ms | 3831 ms | −1110 ms |
| creates | 937 ms | 1158 ms | +221 ms (inline noise-texture gen) |

**Both §6b ship criteria met:** (1) **in-scene imperceptible** — procedural vs baked earth-core
A/B'd in-browser (reveal + rock-wall framings): the noise-pattern difference that was obvious on
the bright isolated boulder is **not** perceptible on the dark, distant, ~70%-near-black
background rock. (2) **net positive** — −922 ms compile, net −1.1 s board-init even paying the
+221 ms inline gen. NB: the saving is a COLD-cache phenomenon (warm Dawn-cache repeat launches
compile fast regardless) — so this improves the FIRST-launch earth-core freeze specifically.

**Status: DEFAULT-OFF, proven.** ⚠️ **The inline noise-texture gen (+221 ms) is a per-board-build
cost, but the −922 ms only helps COLD launches** (warm Dawn-cache repeat launches already compile
fast). So flipping default-on **with the inline gen would make the common WARM-cache repeat launch
~221 ms SLOWER** for ~0 benefit — a net regression on the common path. Therefore eliminating the
per-launch gen is **REQUIRED to ship (not optional)**:
- **(required)** replace the inline `buildTileableNoise3D` with either a pre-baked asset (a raw
  Float32 `.bin` or KTX2, ~14 MB for 96³ / far less compressed, loaded async once — mind the
  "odyssey assets untracked → git add" gotcha) OR GPU-generated noise (a compute/slice render at
  load, ~tens of ms, no shipped asset). Then the −922 ms is net on cold and there's no warm-cache
  penalty.
- **(then)** verify a couple more earth-core camera angles + the molten-pocket/obsidian-column
  material up close (the other `moltenRockField` consumer, seen at level entry), and flip
  `EARTH_CORE_BAKE_NOISE` default to on.

Net: the bake is a genuine COLD-first-launch win (imperceptible, −922 ms compile), but only worth
shipping once the noise is asset/GPU-sourced rather than CPU-generated per launch.
