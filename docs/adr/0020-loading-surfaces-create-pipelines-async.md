# 0020 — While a loading surface is up, render pipelines (and boot compute pipelines) are created asynchronously

- **Status:** accepted
- **Date:** 2026-09-29
- **Plan hook:** `ARCHITECTURAL_REMEDIATION_PLAN.md` §4.7 (cold boot); instrument:
  `scripts/boot-smoothness-probe.mjs`, evidence in `reports/boot-smoothness/`. Builds on ADR-0016
  (verified instruments) and ADR-0018 (pinned three, private-API contract tests)

## Context

The studio ident, the boot warp and the cinematic loading overlay "froze" while the game loaded.
Measured in Electron 38 / Chromium 140 on the D3D12 machine (fresh, cold shader cache):

- A **synchronous** `device.createRenderPipeline` compiles on the GPU-process main thread, which
  also draws the display compositor. With an animated element on screen, one heavy shader
  created through `renderer.render()` froze **every** frame for 2.9 s — CSS transform/opacity
  animations included — with no JS long task. The same shader through `compileAsync`
  (`createRenderPipelineAsync`, compiled on Dawn's workers) kept the worst frame at 61–91 ms.
- A **renderer-main-thread** block does not freeze compositor CSS animations: six distinct frames
  were captured during a 2.5 s busy loop. (It does stop rAF-driven canvases.)
- Cold boot before this change: default theme — ident on screen 14.0 s, 9.9 s frozen, 40 sync
  pipelines (the intro's first frame, its PMREM bake, the boot warp prime); neon-district —
  22.6 s, 18.5 s frozen, 198 sync pipelines (the prewarm's live render frames).
- three r185 only reaches `createRenderPipelineAsync` through `compileAsync`, and has **no** async
  compute path (r186 adds `compileComputeAsync`).

Banvy (the golf app) keeps its boot screen moving the same way: compositor-only CSS for the boot
cover, and batched `compileAsync` before its render loop starts.

## Decision

1. **Boot screens animate with compositor-only CSS** (`transform` / `opacity`). The ident's hold
   (`.sb-lit`) runs orbit arcs, a glint, a glow breathe and a sheen instead of parking motion —
   but only when the warm behind it can create pipelines async. With no async path at all
   (rollback, no WebGPU adapter) the old static hold returns (`.sb-lit--static`, no orbit arcs),
   because a synchronous compile stalls the compositor itself; a warm on a dedicated
   synchronous renderer (classic WebGL / WebGL2 backend) pauses the loops in place from before its
   `start()` until it ends (`.sb-lit--paused`, `src/ui/startup-ident-hold.js`; what each theme
   turned out to be is remembered per device, so only a never-seen theme is paused through its
   first `start()` just in case). Before the match-cut the hold settles onto what the warp's
   replica draws (`.sb-warp-arming`, eased with Web Animations: Chromium starts no CSS
   transition when the same change removes the loop's animation).
2. **While a loading surface is up, a surface-owned renderer's live renders create render
   pipelines async** — `src/rendering/async-render-pipelines.js`: a session-scoped wrapper
   on `WebGPUBackend.prototype.createRenderPipeline` passes a promise sink to three's own async
   branch. The descriptor is still built from live render state, so targets, MRT, samples, call
   depth and draw side are correct by construction. A pending pipeline skips that object's draw
   while the surface covers it. Sessions: `ThemeManager.prewarmTheme` (kept after parking until
   the theme is idle), `ThemeManager.beginLoadingSurface()` for mode entry (kept past the overlay
   until the theme is idle), and the intro renderer until its pipelines settle.
   **Exempt, created synchronously:** PMREM / cube bakes (a skipped draw would bake black) and
   the final full-screen quad drawn to the canvas (while pending the whole frame is black, and it
   lands last on the async queue). Every post effect that is not its own pass is inlined into that
   quad, so a heavy grade/vignette chain is one short synchronous compile (measured 60-120 ms).
   **Mode entry keeps the overlay's calm-hold** (motion hidden) through a cold build's
   `start()` (createScene's PMREM bakes and first compute are synchronous), then gives the motion
   back if the theme builds async: known from earlier this session, or proven by its own armed
   session's first async pipeline. WebGL / shared-renderer themes never engage, so they keep the
   hold for their whole (synchronous) build. A theme that creates its own pipelines async off
   three's backend declares `buildsPipelinesAsync` (void-ember). The surface is only begun when
   an overlay actually covers the screen, and is `uncover()`ed when the overlay lifts: its
   sessions keep running, but themes started later (another mode's own reveal) are not armed.
3. **Boot surfaces create their compute pipelines async** through
   `src/rendering/webgpu-compute-pipeline-async.js`: the intro and the boot warp. Since r186.1,
   it delegates to native `compileComputeAsync`, verifies cached GPU pipeline readiness,
   and guards dispatch during node building and pending/failed pipeline creation.
   The r185 descriptor/create hook is removed. **Themes' live
   `renderer.compute()` stays synchronous**: a skipped dispatch would lose one-shot init kernels,
   the compute analogue of the PMREM hazard. Raw-WebGPU themes (void-ember) call the device's
   `create*PipelineAsync` themselves.
4. **Boot-owned renderers create their pipelines before they prime**: render pipelines through
   `compileAsync`, compute through `compileComputeAsync` (boot warp). The synchronous prime frames
   that follow hit those cached pipelines — except the small output quad (exempt, like the final
   composite) — and drain the GPU queue behind the ident; keep them.

## Consequences

- Cold boot after this change (same machine, quiet runs): default theme ~10-14 s on screen,
  ~1.0-1.8 s visibly frozen (mostly the page-load stall before the game starts and the exempt
  set), 5 sync / 35 async pipelines, 0 freezes in the warp window. neon-district: 2.9 s visibly
  frozen (15 sync / 211 async, vs 18.5 s frozen and 198 sync before) but ~33 s on screen (22.6 s
  before): the warp waits for the theme to go idle, and neon's own progressive shader prewarm
  (compileAsync sweeps plus warm-up renders) now competes with its async live pipelines for
  Dawn's workers. The ident keeps moving through it.
- On a cold mode entry the overlay waits (each step bounded) for the theme to be ready (up to 6 s,
  3 s when warm or under the rollback), then for its streamed content (building / background /
  deferred-material loads and scene creation, `waitForThemeContentLoaded`, up to 7.5 s), then for
  its pipelines to settle (at least 1.5 s, ~9 s for content plus settle together; event
  `mode_entry_pipelines_settle`). A pipeline-only settle read "quiet" before a cold neon-district
  had requested most of its city and lifted onto an empty scene. Past the budget the overlay lifts
  and late pipelines, still async under the retained session, appear a moment later. Measured
  cold neon-district entry: overlay moving throughout (after the calm-hold through `start()`),
  reveal onto the built city ~11.5 s after the click, 315 ms visibly frozen (10 sync / 185 async
  creates) — vs 102 sync creates behind a motion-hidden overlay before.
- Residual on an async entry: the exempt synchronous creates that arrive after motion is back —
  the final composite and PMREM bakes of content that loads later (neon-district's HDRI after
  its network load) — still stall the overlay briefly (worst visible frame ~290-430 ms).
  `mode_entry_pipelines_settle.calmReleasedAtMs` records when an early release happened; it is
  null when the hold lasted through the settle (a synchronous build).
- Async compiles contend for Dawn's worker pool (DXC is CPU-bound): total compile wall time can
  exceed the synchronous path's; the gain is that nothing freezes while it happens.
- Content created after a session ends compiles synchronously as before; themes that stream
  content later need their own busy flags (the retainer and mode entry wait for them).
- Main-thread TSL node builds are still synchronous inside the live render path; they stall
  rAF-driven canvases (the intro/warp), not CSS surfaces.

## Enforcement

- `tests/unit/async-render-pipelines-contract.test.js`, `tests/unit/three-r186-compute-pipeline-contract.test.js`:
  pin the r186.1 internals both helpers depend on (a three upgrade fails loudly; listed in ADR-0018).
- `tests/unit/async-render-pipelines.test.js`, `tests/unit/webgpu-compute-pipeline-async.test.js`,
  `tests/unit/theme-prewarm-async.test.js`, `tests/unit/intro-async-pipelines.test.js`,
  `tests/unit/boot-warp-handoff.test.js`: behaviour.
- `tests/unit/void-ember-async-pipelines.test.js`: the raw-WebGPU theme's own async creation.
- `tests/unit/startup-ident-hold.test.js`, `tests/unit/wait-for-theme-content-loaded.test.js`: the
  ident hold style and the mode-entry content wait.
- `scripts/boot-smoothness-probe.mjs`: the instrument — `identWindow.visibleFrozenMs` (GPU-process
  stalls, which freeze compositor CSS) vs `mainThreadOnlyMs`, sync/async pipeline counts,
  `--scenario=mode-entry` for loading overlays. Run one Electron process at a time on a quiet
  machine (ADR-0016). Reference runs: `reports/boot-smoothness/README.md`.
- Rollbacks: `?themeWarmAsync=0` (render pipelines, the loading-surface sessions and the mode-entry
  content wait, the boot warp's `compileAsync` prime, void-ember's render pipelines, and the
  ident's moving hold). The r185 `syncComputePipelines` rollback was retired with r186.1;
  both native compute compilation and void-ember's raw-WebGPU compute stay asynchronous.
