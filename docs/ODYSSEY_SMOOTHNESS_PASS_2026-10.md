# Odyssey smoothness pass (2026-10-19)

**Ask (owner):** Odyssey at a consistent 130+ fps on Extreme on the RTX 3070 laptop, with no
micro-stutter: moving along the path, entering and leaving orbs, crossing chapters, starting the
mode. No visual quality traded for it. Borrow what worked in the theme performance passes.

**Target, in this machine's numbers:** the laptop's display delivers frames at ~131.6 Hz (not the
165 Hz Windows reports; [machine display cadence]), so "130+" means a presented frame on every
display refresh: a 7.6 ms budget for main thread and GPU together, at Extreme, 1600x852, 4x scene
MSAA, render scale 1.0.

## Instrument

A scratch Electron probe that plays the mode the owner's way (Extreme, cap 144 = every refresh, the
display's work area, WebGPU on the RTX via `force_high_performance_gpu`), one process per run under
the shared GPU lock. Per phase it records: every present of every WebGPU canvas
(`GPUCanvasContext.getCurrentTexture` hook, so the map and the level theme are told apart), the
main-thread time of each animation frame (rAF wrapper), sync/async pipeline creations with labels,
long animation frames with script attribution, the camera's progress per frame, the renderer pixel
ratio, and (with `?odysseyGpuProfile=1`) GPU time per second of travel from resolved timestamp
queries. Phases: `start` (menu click to 10 s after the board is active), `idle`, `orb` (glide,
enter, play 6 s, return), `jump` (glide across a chapter boundary), `travel` (wheel scroll
p 0.02 -> 0.99 in 30 s), `rush` (start, then travel 1.5 s after the reveal, before the background
loader has built chapters 6-8), `shots` (screenshots at fixed positions). CPU profiles
(`Profiler`) and Chromium traces (`contentTracing`, GPU + Dawn categories) per phase on request.

The probe is `scripts/odyssey-feel-probe.mjs` (usage in its header), read with
`scripts/odyssey-feel-report.mjs <run dir> --v --bins`, arms compared with
`scripts/odyssey-feel-ab.mjs --dir=<runs> --base=a,b --fix=c,d`; `scripts/cpuprofile-bursts.mjs`
names what ran inside each long main-thread stretch of a profile, `scripts/trace-long-slices.mjs`
what ran inside the GPU process's long tasks of a trace. Example:
`node scripts/run-electron.mjs scripts/odyssey-feel-probe.mjs --baseUrl=http://127.0.0.1:5431
--out=<dir> --profile=<abs dir> --phases=start,idle,orb,jump,travel --orbs=1,16`.

Every comparison ran against a frozen `origin/main` worktree on its own dev server, so no edit could
reach a baseline run; arms were interleaved. Steady-state readings were checked on mains power
(`Win32_Battery` status 2) with no other Electron or headless Chrome on the GPU.

## What the baseline showed

Steady state was never the problem. At Extreme the map's GPU time was **0.3-1.9 ms** per frame in
every chapter (pixel ratio 1.0, 4x MSAA), and the main thread spent **~2.5 ms** per frame, 97% of
it in three's render submission (scene pass ~1.15 ms, bloom's eight small passes ~0.7 ms). Idle on
the map held 131 fps. Everything the owner feels as stutter was a discrete hitch:

| Moment (baseline, warm shader cache) | Worst frame | Cause |
|---|---|---|
| ~4 s after the map appears | 1,511 ms, then 651 ms | the menu theme (Forest) built and compiled behind the live map |
| after the reveal | 869 + 500 ms | ch6 sky backdrop baked on the CPU between live frames |
| path travel, p 0.12 | 835 ms (47 sync pipelines) | a resolution step re-created every scene pipeline |
| ch1 -> ch2 glide | 124 ms (5 sync pipelines) | the same, one step earlier |
| orb entry (heavy theme, Fall) | 828 ms glide, 467 ms entry | resolution step; theme first frame + a 390 ms image task |
| orb entry (any) | 72 ms | Phaser waiting on its first shader links |
| whole session | render scale 1.0 -> 0.65 | adaptive resolution reading hitches as GPU load |
| rush (scroll right after start) | 776 / 720 / 665 ms (56 sync) | chapters 5-8 drawn before their warm, compiled synchronously |

## Root causes and fixes

1. **Menu-theme prewarm behind the map** (`src/main.js`, `src/themes/theme-manager.js`,
   `src/utils/startup-warm.js`). The first-entry warm stands down when a theme becomes active, but
   Odyssey keeps the themes suspended while its map renders, so a player who entered Odyssey within
   a few seconds of the menu got the whole Forest build (scene, shadow rig, first frame) on the live
   map. `prewarmTheme` takes a `standDown()` predicate checked at every checkpoint, and the
   first-entry warm is skipped outright while Odyssey is the current mode.

2. **Adaptive resolution** (`composition/OdysseyAdaptiveQuality.js`, `OdysseyBoardController.js`).
   Pressure was "p95 of the last 60 frames over 1.14x budget": 0.46 s at 131 Hz, so three compile
   frames were pressure, and recovery is slow, so the scale walked down for the session. Worse, a
   step below 0.95 wraps the output in the RCAS sharpen pass, which renders the scene pass one
   level deeper; three keys every scene pipeline by that render context, so **every step created
   all scene pipelines again, synchronously** (the 835 ms freeze). Now: the board resolves a GPU
   timestamp every 250 ms on WebGPU and the controller vetoes any step down while the GPU's p90 is
   under 60% of the budget; with or without GPU samples a step needs sustained pressure (p75 over
   the gate, a quarter of a 180-frame window). Measured result: scale 1.0 through every run.

3. **Post output variants** (`odyssey-post/odyssey-tsl-pipeline.js`). All lens/bloom variants shared
   one `RenderPipeline` and swapped its `outputNode`; three then rebuilt the quad material and
   released the previous variant's pipeline, so every bloom on/off and lens edge compiled 2-3
   pipelines on a live frame, after the variants had been warmed. Each binding now keeps its own
   `RenderPipeline` (a swap is a pointer). Separately, three's `BloomNode.setup()` re-flags its
   high-pass and composite materials and pushes a fresh set of blur materials every time a graph
   containing it is built; the pipeline now runs it once and later graphs read its output texture.

4. **Ch6 backdrop bake** (`chapter-environments/odyssey-cosmic-backdrop*.js`). The 1024x512 field
   was baked "sliced", 4 ms slices between `setTimeout(0)` ticks, which left too little of a 7.6 ms
   frame for ~0.9 s. It bakes in a module Worker now (the themes' bake-worker pattern), the page
   path stays as the fallback (tests, no Worker), output byte-identical.

5. **Earth Core noise bake** (`shared/odyssey-baked-noise.js`). 8 hashes and closures per texel over
   96^3 texels (~210 ms at the first entry) became a table-driven loop with the same arithmetic in
   the same order: ~40 ms, pinned bit-identical against the old loop by test.

6. **Ch7 lens variants** warm under the loading cover with the lean pair instead of on the live map a
   few seconds after the reveal (two sync composite compiles, 87-93 ms).

7. **Orb entry** (`OdysseyMode.js`, `rendering/phaser/phaser-parallel-shaders.js`,
   `ui/cinematic-loading-surface.js`, `themes/theme-manager.js`).
   - While the entry tunnel covers the board, Phaser links new shaders in parallel
     (`render.skipUnreadyShaders` with `KHR_parallel_shader_compile`, opened at the blackout, closed
     at the reveal); outside that window nothing changes.
   - The tunnel's loading lease asks for a node-build budget (5 ms per task), so the covered
     theme's first frame builds its materials over several frames instead of all at once, as the
     in-play theme switch already did. Opt-in per lease; the menu's mode-entry overlay is unchanged.
   - Before the reveal, the entry waits (within the tunnel's hold) for that covered session to
     settle, so the reveal lands on a complete frame.

8. **The live map creates pipelines async after the reveal** (`OdysseyBoardController.js`,
   `rendering/async-render-pipelines.js`). A player who scrolls on from the reveal reaches chapters
   5-8 before their warm; every first draw then compiled synchronously on the GPU process. The map
   now runs the themes' async-pipeline session from the reveal on, with a 4 ms node-build budget for
   draws into the scene pass. Draws into the canvas (the final composite) are never deferred
   (`exemptCanvasDraws`), and the offscreen render-warm runs outside the budget (`withoutBudget`).
   The pre-reveal warm stays synchronous, so the first frame is whole. Screenshots every 400 ms
   through a rush showed no missing sky or objects at the seams.

9. **Live compiles two at a time** (`OdysseyBoardController._compileWidth`). After the reveal the
   main thread no longer exceeded ~7 ms, but the deferred One World / chapter compiles ran six
   `compileAsync` launches at once; their node builds yield with `scheduler.yield`, whose
   continuations go ahead of the frame, and the GPU process compiled back to back. Same-build A/B
   via `?odysseyCompileWidth` (start phase, two rounds, interleaved): frames over 20 ms in the
   10 s after the reveal 29 / 32 at width 6, 15 / 11 at width 2, 12 / 9 at width 1; fps 121 ->
   126.5 at 2. Width 1 delayed the map by 0.4 s (the pre-reveal fan-out shares the knob), so live
   compiles use 2 and the pre-reveal fan-out keeps the module default.

## Results

Interleaved runs, two per arm (base = `origin/main` af241437 in its own worktree; now = this
branch), Extreme, cap 144, warm shader cache, mains power, same Electron profile. Worst frame is the
largest gap between two presents of that canvas.

| Moment | Worst frame, base (ms) | Worst frame, now (ms) | Frames > 50 ms, base | now | Sync pipeline creations, base | now |
|---|---|---|---|---|---|---|
| First 10 s after the map appears | 777 / 782 | 65 / 76 | 10 / 8 | 5 / 5 | 21 / 21 | 0 / 0 |
| Idle on the map | 8.9 / 8.8 | 8.9 / 28.7 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Glide to an orb (ch1) | 21.9 / 14.3 | 13.3 / 24.1 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Glide ch1 -> ch3 | 860 | 12.4 / 14.2 | 5 | 0 / 0 | 38 | 0 / 0 |
| Orb entry, Fall (level theme) | 426 | 57 / 58 | 1 | 1 / 1 | 2 | 2 / 2 |
| Orb entry, Cinder Drift (level theme) | 253 / 249 | 246 / 239 | 6 / 6 | 3 / 3 | 1 / 1 | 1 / 1 |
| Orb exit (map) | 49 / 22 | 23 / 20 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Path travel p 0.02 -> 0.99, 30 s | 835 / 102 | 17 / 12 | 5 / 5 | 0 / 0 | 47 / 13 | 0 / 0 |
| Rush: travel from 1.5 s after the reveal | 777 / 866 | 22 | 15 / 15 | 0 | 56 / 56 | 0 |
| Render scale at the end of the session | 0.65 / 0.7 | 1.0 / 1.0 | | | | |

Path travel now holds 130.8-131.3 presents per second over the whole journey (the display's rate)
with no frame over 50 ms; the rush run went from 111 fps with 15 frames over 50 ms to 130 fps with
none (its worst main-thread frame 772 ms -> 13 ms). Steady state did not move (it was never the
problem): main thread ~2.3-2.9 ms per frame, GPU 0.3-1.9 ms.

Visual check: screenshots at eight path positions (one per chapter) on both trees match; the one
difference first seen (ch7) is the warp tunnel's own colour cycle, which changes second to second
in both. Frames every 400 ms through a rush (async pipelines and the live build budget on) show
no missing sky, planets or city at the 5->6, 6->7 and 7->8 crossings.

## Still open

- **The level theme's final composite compiles synchronously at every orb entry** (~80 ms of DXC on
  the GPU process, behind the tunnel). It is exempt from the async path on purpose (queued last, a
  heavy theme's composite once landed ~13 s late). DXC ran although the profile's shader cache was
  warm: worth checking whether themes bake per-session constants into shader text, which would make
  every cache lookup miss.
- **First raster of the gameplay UI** behind the tunnel (~107 ms Skia raster flush on the GPU
  process ~0.7 s before the reveal).
- **Theme-specific entry costs**: Cinder Drift's `createFieldTexture` step (37 ms), Fall parsing an
  asset in a fetch callback (~160 ms).
- **Chapters are still created in one synchronous call** (`ChapterEnvironmentManager.createChapterEnvironment`);
  a stepped build (the themes' `buildWorldBreathing`) would remove the remaining 40-90 ms frames in
  a rush.
- **Load time to the map** (~2.0-2.5 s): orb-icon blits (`getImageData`, ~250 ms), corridor haze
  bake (~110 ms), director and One World setup. Under the loading overlay, so wait time rather than
  stutter.

## Switches (rollback / A/B)

`?odysseyAdaptiveGpuTiming=0` (controller on frame time alone), `?odysseyAsyncPipelines=0` (live map
creates pipelines synchronously), `?odysseyDisableAdaptiveQuality=1` (no adaptive quality at all),
`?noThemeWarm=1` (no first-entry theme warm), `?themeWarmAsync=0` (no async loading surfaces),
`?odysseyCompileWidth=<n>` (concurrent compiles, pre-reveal and live alike).

## Tests added or changed

`odyssey-adaptive-quality` (GPU veto, stale samples, sustained rule both ways, recovery with GPU
headroom), `odyssey-tsl-pipeline-sharpen` (one RenderPipeline per binding, eviction, dispose),
`odyssey-baked-noise` (bit-identical to the old loop), `odyssey-board-live-async-pipelines`,
`async-render-build-budget` (canvas exemption, `withoutBudget`), `theme-prewarm-async`
(`standDown` before and during a warm; per-lease build budget), `startup-warm-odyssey`,
`odyssey-mode-level-entry` and `odyssey-journey-flow` (budgeted entry lease).
