# World-Class Stability and Performance Plan

## Purpose

This document replaces a generic hardening outline with a repo-specific plan for making Serenity Blocks more stable, more performant, and closer to a world-class implementation standard.

It is based on:

- direct repository review of the current implementation
- current platform guidance from Electron, Phaser, Three.js, MDN WebGPU/Web Audio docs, and Vite docs
- the current architecture of Serenity Blocks: Phaser board rendering, Three.js theme rendering, raw WebGL composition, Electron desktop runtime, Steam integration, lazy-loaded themes, and custom input/runtime systems

## Executive Assessment

The codebase already has several strong foundations:

- lazy-loaded theme caching and LRU management in `src/themes/theme-manager.js`
- centralized GPU loss monitoring in `src/utils/gpu-context-resilience.js`
- explicit theme base cleanup patterns in `src/themes/base-theme.js`
- Phaser-first rendering and scene partitioning
- a meaningful benchmark and test surface in `tests/README.md`

However, the current implementation still has a few architectural gaps that prevent it from being "gold standard":

1. Shared renderer ownership is not clearly separated from theme-owned resources.
2. Timing authority is still split across gameplay, input, and online systems.
3. Theme lifecycle behavior is not enforced uniformly across all themes.
4. Electron security and process-boundary hardening are not at production-grade standards yet.
5. Steam packet handling and snapshot queue responsibilities are conflated.
6. Observability exists, but it is not yet structured as a release-quality fault/telemetry system.

The right path is not a broad rewrite. It is a focused hardening program that stabilizes the runtime contract, reduces undefined behavior, and adds deterministic validation around the most failure-prone systems.

## Key Findings From The Current Repo

### 1. Renderer ownership is too destructive during theme switches

In `src/themes/theme-manager.js`, routine theme switches call `this.webglRenderer.cleanup()` during normal transitions. In `src/rendering/renderer.js`, `cleanup()` tears down resize listeners, context monitoring, tracked GPU managers, and renderer state.

That is appropriate for final destruction, but too aggressive for ordinary theme swaps. It increases the odds of broken resumes, stale references, and unnecessary GPU churn.

### 2. Raw WebGL context restore is only partially rebuilt

`src/rendering/renderer.js` rebuilds shader programs on WebGL restore, but shared buffers, manager state, and any renderer-owned reusable resources are not restored under one explicit reinitialization contract.

World-class behavior here requires a clean distinction between:

- renderer boot resources
- per-theme resources
- per-frame transient resources

### 3. Frame skip logic can stall the self-scheduled render loop

In `src/rendering/renderer.js`, `renderFrame()` returns early when frame skipping is active before scheduling the next frame. In the self-driven loop path, that can stop rendering entirely instead of skipping only one frame.

This is a correctness bug, not just a performance issue.

### 4. Online state broadcast timing is not actually time-based

`src/core/game-modes/OnlineMultiplayerMode.js` defines a `SYNC_INTERVAL` and accumulates delta time, but the actual send condition is `frame % 30 === 0`.

That means the effective network cadence changes with display refresh rate and runtime stalls. A 144 Hz machine, a 60 Hz laptop, and a throttled background case will not behave consistently.

### 5. Steam networking mixes incoming baseline state with outgoing backpressure state

`src/core/steam/steam-networking.js` uses `snapshotQueues` both for:

- last-received snapshot baselines for delta decoding
- pending outgoing snapshot queue / backpressure state

Those are different responsibilities and should not live in the same map. The current design creates avoidable correctness risk and makes debugging packet behavior harder.

### 6. Main/renderer boundaries are too permissive

The app ships a preload bridge in `electron/preload.js`, but `electron/main.js` still creates the BrowserWindow with `nodeIntegration: true` and `contextIsolation: false`.

Renderer code in multiple places still relies on `window.require('electron')`, including `src/core/steam/steam-networking.js`, `src/core/steam/steam-service.js`, `src/core/display-manager.js`, and `src/main.js`.

That is not a production-grade Electron boundary.

### 7. Theme lifecycle contracts are defined centrally but not enforced uniformly

`src/themes/base-theme.js` gives the project a good shared lifecycle foundation, but there are still gaps:

- global context-restored behavior is broad and can over-trigger theme rebuilds
- ad hoc window listeners still exist in themes instead of always using tracked registration
- some theme cleanup paths are custom and not guaranteed to call `super.cleanup()`

`src/themes/wolfhour/wolfhour-theme.js` is the biggest example because it has custom device-loss handling and a custom cleanup path that does not obviously complete the base cleanup contract.

### 8. Input timing is improved but still not fully unified under one authoritative simulation clock

`src/ui/controls.js` and `src/ui/gamepad-controller.js` both now use `requestAnimationFrame`-driven accumulation instead of legacy timer loops, which is better than timer-based DAS. But input repeat is still managed in separate controller loops instead of being owned by the core gameplay tick.

For a top-tier puzzle game, input repeat, gravity, lock timing, replay, and online simulation should all derive from the same simulation authority.

### 9. Performance monitor overlay visibility is decoupled from monitor lifetime

`src/main.js` hides the overlay via `hidePerformanceOverlay()`, but does not disable monitoring. That is not necessarily wrong, but it means the monitor can remain active when the UI implies it is "off". The monitor needs clearer operating modes:

- disabled
- collecting/no overlay
- collecting/overlay visible

### 10. Build strategy is good in spirit but needs deployment resilience work

`vite.config.js` already chunks Phaser, Three.js, themes, and modes. That is directionally good. However:

- every theme becoming its own chunk can create operational fragility with a very large chunk graph
- the app does not appear to handle `vite:preloadError`
- production sourcemaps are enabled with no stated release policy

## What "World-Class" Means For This Game

For Serenity Blocks, a world-class implementation should guarantee:

- no major leaks or resource growth across long theme-switch and mode-switch sessions
- deterministic input and simulation timing independent of monitor refresh rate
- graceful recovery from WebGL/WebGPU faults where possible, and fast fallback where not
- crash containment between renderer, main process, GPU process, and Steam/native integration
- a secure Electron boundary suitable for shipping
- stable online packet cadence, reproducible sync behavior, and observable backpressure
- automated validation for scene restart, theme restart, suspend/resume, alt-tab, controller hotplug, and long soaks

## Gold-Standard Principles To Adopt

### One authority per domain

- one simulation clock
- one renderer ownership model
- one packet contract
- one lifecycle contract for all themes

### Recovery beats heroics

When a GPU path or theme fails, recover into a simpler known-good state rather than trying to preserve every feature path.

### Measure first, then optimize

Performance work should be guided by p50/p95/p99 frame times, hitch counts, queue backpressure, and resource counts, not just average FPS.

### Degrade deliberately

Quality reduction should be policy-driven, based on sustained pressure, device loss history, battery/thermal state, and GPU capability tiers.

## The Plan

## Phase 0 - Correctness Bugs And Runtime Safety Nets

Goal: remove the highest-risk correctness issues before deeper optimization.

### Actions

1. Fix online sync cadence in `src/core/game-modes/OnlineMultiplayerMode.js`.
   - Replace frame-count broadcasting with elapsed-time scheduling.
   - Use accumulator-based send timing with clamped catch-up.
   - Keep host UI updates independent from snapshot cadence.

2. Fix the render-loop frame-skip bug in `src/rendering/renderer.js`.
   - Always schedule the next frame before early return in self-driven mode.
   - Add a regression test or benchmark harness assertion for frame skipping.

3. Split `snapshotQueues` in `src/core/steam/steam-networking.js` into two maps.
   - `incomingSnapshotBaselines`
   - `outgoingSnapshotState`
   - Make packet responsibilities explicit.

4. Unify the Steam P2P payload contract between `electron/main.js` and `src/core/steam/steam-networking.js`.
   - Stop implicit JSON shape assumptions at both ends.
   - Add explicit envelope versioning and binary/non-binary handling rules.

### Exit Criteria

- online snapshot send rate is time-based and stable on 60/120/144 Hz displays
- frame skip no longer stalls renderer scheduling
- incoming/outgoing snapshot state can be reasoned about independently

## Phase 1 - Renderer Ownership And GPU Lifecycle Hardening

Goal: make theme switching and context recovery robust.

### Actions

1. Split `WebGLRenderer.cleanup()` into two explicit layers in `src/rendering/renderer.js`.
   - `clearThemeResources()` for theme swap
   - `destroy()` or `cleanup()` for final renderer teardown

2. Stop using full renderer teardown during routine theme switching in `src/themes/theme-manager.js`.
   - theme switch should free theme-owned layers, particle systems, textures, and listeners
   - shared renderer state, resize hooks, and context monitoring should stay alive

3. Introduce explicit renderer-owned boot/rebuild routines.
   - `initSharedPrograms()`
   - `initSharedBuffers()`
   - `rebuildAfterContextRestore()`

4. On WebGL restore, rebuild all renderer-owned resources, not just shader programs.

5. Add a capability/fallback policy layer for Three/WebGPU themes.
   - full path
   - reduced path (no compute / reduced post)
   - minimal path (static or lightweight background)

6. For WebGPU paths, add:
   - `device.lost` recovery to reacquire device when appropriate
   - `uncapturederror` logging
   - `pushErrorScope`/`popErrorScope` around risky initialization paths
   - shader compilation diagnostics via `getCompilationInfo()` in development and CI

### Why

MDN explicitly recommends treating `GPUDevice.lost` as a normal lifecycle event and recreating all resources on a replacement device. Three.js also requires explicit disposal of textures, materials, geometries, render targets, and `ImageBitmap` CPU resources.

### Exit Criteria

- switching between heavy themes does not destroy shared renderer infrastructure
- WebGL context restoration fully rebuilds renderer-owned state
- WebGPU device loss falls back or reinitializes cleanly

## Phase 2 - Theme Lifecycle Standardization

Goal: make every theme obey the same contract.

### Actions

1. Formalize the theme contract:
   - `init()` loads static definitions only
   - `start()` binds renderer/managers and creates runtime resources
   - `pause()` suspends active work without destroying resources
   - `resume()` resumes only if safe, otherwise signals restart required
   - `stop()` stops loops and unregisters transient resources
   - `cleanup()` performs terminal disposal and must call `super.cleanup()`

2. Create a theme lifecycle audit script.
   - detect themes that override `cleanup()` without `super.cleanup()`
   - detect raw `window.addEventListener` usage instead of tracked registration
   - detect untracked timers and RAF handles

3. Narrow the global context-restored behavior in `src/themes/base-theme.js`.
   - only rebuild when the restored resource belongs to the active renderer/theme
   - avoid broad global recovery listeners triggering redundant scene rebuilds

4. Make `resume()` semantics explicit.
   - `resume()` returns `true` only if all required runtime state is still valid
   - otherwise ThemeManager performs a full restart path

5. Start with heavy/high-risk themes:
   - `src/themes/wolfhour/wolfhour-theme.js`
   - `src/themes/sky-children/sky-children-theme.js`
   - `src/themes/sky-children-v2/sky-children-v2-theme.js`
   - `src/themes/ice-temple/`
   - `src/themes/nebula-flow/`

### Phaser Alignment

Phaser scene guidance strongly favors explicit shutdown cleanup for resources and listeners that survive restarts. The same principle should apply to theme runtimes.

### Exit Criteria

- every theme passes lifecycle audit checks
- theme pause/resume/stop/restart behavior is consistent under visibility changes and mode switches

## Phase 3 - Timing And Simulation Unification

Goal: make input, gameplay, replay, and networking timing deterministic.

### Actions

1. Make one runtime clock authoritative for gameplay simulation.
   - core simulation should own gravity, lock delay, DAS/ARR repeat, and replay timing
   - `requestAnimationFrame` remains the presentation driver, not the gameplay authority

2. Move keyboard and gamepad repeat into the gameplay update path.
   - controllers produce current input state
   - simulation consumes state plus elapsed time
   - remove duplicated repeat ownership from peripheral loops

3. Clamp catch-up after stalls.
   - avoid overfiring moves/drops after tab switches, overlay interruptions, or debug pauses

4. Define clear hidden-tab behavior.
   - single-player: pause or controlled reduce mode
   - online multiplayer: keep network heartbeat alive, but pause local visual-only work where possible

5. Use `AudioContext.currentTime` and scheduled parameters only for audio timing.
   - keep audio scheduling independent from gameplay step ownership

### Why

Page Visibility guidance and browser background policies make it unsafe to rely on independent timers or background tab assumptions for correctness.

### Exit Criteria

- identical DAS/ARR behavior regardless of monitor refresh rate
- no bursty over-input after focus loss or frame stalls
- replay and online timing have a cleaner deterministic foundation

## Phase 4 - Electron Boundary, Crash Resilience, And Desktop Runtime Hardening

Goal: make the desktop shell ship-ready.

### Actions

1. Move fully to preload-mediated APIs.
   - wire `electron/preload.js` into `electron/main.js`
   - migrate renderer calls away from `window.require('electron')`
   - expose only narrow, named APIs per domain

2. Change BrowserWindow defaults to production-safe settings.
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - enable sandboxing where compatible with the app architecture

3. Validate all IPC senders for privileged channels.

4. Add runtime fault hooks in main process.
   - `app.on('render-process-gone')`
   - `app.on('child-process-gone')`
   - `webContents.on('render-process-gone')`
   - `webContents.on('unresponsive')`
   - `webContents.on('responsive')`

5. Add `crashReporter.start()` early in app startup.
   - include app version, build channel, GPU adapter/vendor, quality tier, active theme, active mode

6. Use `powerMonitor` for runtime policy changes.
   - suspend/resume handling
   - on-battery behavior
   - speed-limit-change behavior
   - thermal state change quality demotion where supported

7. Revisit dual Steam runtime initialization.
   - clearly document why both `steamworks.js` and `ez-steam-api` are needed
   - if possible, isolate responsibilities by service boundary rather than runtime overlap

### Why

Electron's own security guidance strongly recommends context isolation, preload bridges, limited API exposure, and sender validation. Its app/webContents/crashReporter docs also support adding process-loss and crash handling early.

### Exit Criteria

- no renderer code needs `window.require('electron')`
- privileged APIs are only reachable through audited preload bridges
- process crashes and GPU process failures are observable and recoverable to a safe state

## Phase 5 - Steam Networking And Online Match Robustness

Goal: make the online layer resilient under real-world conditions.

### Actions

1. Version the full online envelope contract.
   - protocol version
   - match id / nonce
   - message type
   - sequence and ordering semantics
   - payload encoding type

2. Separate packet classes by reliability policy.
   - reliable control and match events
   - unreliable state snapshots
   - explicit resend/resync triggers where needed

3. Add queue telemetry.
   - per-peer pending snapshot state
   - drop counts
   - resync counts
   - decode failures
   - disconnect reasons

4. Add transport fault scenarios to soak tests.
   - packet loss
   - packet duplication
   - delayed snapshots
   - host migration policy, or explicit non-support policy

5. If long-term Steam architecture evolves, prefer a clearer transport abstraction so Steam-specific delivery is not fused to game-state serialization rules.

### Exit Criteria

- online packet flow is debuggable from metrics and logs
- snapshot baseline state cannot interfere with outgoing send state
- refresh rate does not affect online replication cadence

## Phase 6 - Build, Asset Delivery, And Theme Loading Resilience

Goal: preserve fast startup while reducing deployment/runtime brittleness.

### Actions

1. Keep the gameplay shell hot and stable.
   - core startup path should not depend on large theme-specific code unless needed

2. Revisit per-theme chunk granularity.
   - some themes may still warrant isolated chunks
   - others may be better grouped by technology family or weight profile
   - optimize for startup stability and cache behavior, not just theoretical code splitting

3. Add `vite:preloadError` recovery handling.
   - reload or recover on stale dynamic import references after deploy/update

4. Define a source map policy.
   - keep full sourcemaps in internal/dev channels
   - decide whether production builds should ship full maps, hidden maps, or upload-only maps

5. Add bundle health checks.
   - startup shell size
   - number of dynamic chunks
   - biggest theme chunk sizes
   - duplicated Three/Phaser-dependent utility code

### Why

Vite explicitly provides `vite:preloadError` handling for stale dynamic import scenarios, which matters in a heavily lazy-loaded app.

### Exit Criteria

- stale chunk references recover cleanly
- startup chunk graph is intentional and measurable

## Phase 7 - Audio Runtime Hardening

Goal: preserve responsive audio without letting it destabilize the frame budget.

### Actions

1. Reserve `AudioWorklet` for timing-critical or custom DSP work.
   - procedural tones or latency-sensitive synthesis should move there when main-thread jitter matters

2. Keep analysis workloads bounded.
   - frequency analysis and beat detection should run at capped rates
   - analysis should degrade or suspend in hidden/reduced modes when appropriate

3. Ensure all audio scheduling uses parameter scheduling where possible.
   - avoid main-thread timing jitter for audible events

4. Add device-change and suspend/resume handling for the audio engine.

### Why

MDN guidance for AudioWorklet and Web Audio best practices supports using the audio rendering thread for low-latency custom processing and keeping heavy nonessential work off the main thread.

### Exit Criteria

- audio remains stable across alt-tab, suspend/resume, and hidden states
- analyzer workloads do not meaningfully perturb the frame budget

## Phase 8 - Observability, Soak Testing, And Release Gates

Goal: make regressions visible before players find them.

### Actions

1. Define a standard telemetry schema.
   - app version / build channel
   - mode / theme
   - quality tier
   - GPU vendor / renderer / adapter limits
   - WebGPU/WebGL fallback path
   - context loss and recovery events
   - crash-free session metric
   - frame-time percentiles
   - theme-switch hitch duration
   - snapshot backlog / drop stats

2. Split performance monitor modes.
   - disabled
   - collecting without overlay
   - collecting with overlay

3. Expand soak coverage.
   - repeated theme switching
   - repeated mode switching
   - alt-tab loops
   - suspend/resume
   - controller connect/disconnect
   - Steam offline/online transitions
   - audio device change
   - overlay open/close if Steam overlay is active

4. Add leak trend tests for:
   - renderer.info counts
   - custom WebGL resource counts
   - live theme instances
   - active listeners/timers per theme
   - heap growth trends over long runs

5. Add release gates.

### Release Gates

- p95 frame time within target budget on target hardware tiers
- no monotonic GPU resource growth across 200+ heavy theme swaps
- no unrecovered renderer/GPU process failures in soak campaign
- no theme that fails lifecycle audit rules
- no online cadence drift tied to refresh rate
- no renderer-side direct Electron access remaining

## Priority File List

These files should be the first implementation targets:

- `src/rendering/renderer.js`
- `src/themes/theme-manager.js`
- `src/themes/base-theme.js`
- `src/themes/wolfhour/wolfhour-theme.js`
- `src/core/game-modes/OnlineMultiplayerMode.js`
- `src/core/steam/steam-networking.js`
- `src/core/steam/steam-service.js`
- `src/core/display-manager.js`
- `src/ui/controls.js`
- `src/ui/gamepad-controller.js`
- `src/utils/performance-monitor.js`
- `electron/main.js`
- `electron/preload.js`
- `vite.config.js`

## Recommended Delivery Order

### Sprint 1

- fix online sync cadence
- fix renderer frame-skip scheduling bug
- split incoming/outgoing snapshot state
- stop full renderer destruction on routine theme switches

### Sprint 2

- add renderer boot vs theme-cleanup separation
- wire preload and migrate away from `window.require`
- lock down BrowserWindow security settings
- add crash/process-loss hooks

### Sprint 3

- standardize theme lifecycle and audit the heavy themes
- harden WebGPU/WebGL recovery and fallback policy
- split performance monitor operating modes

### Sprint 4

- unify input repeat under gameplay timing
- expand soak automation and leak detection
- add deployment resilience and build-graph cleanup

## Research Notes

This plan aligns with the following external guidance:

- Electron security guidance: prefer preload bridges, context isolation, sender validation, and limited API exposure
- Electron runtime APIs: use crashReporter early; observe `render-process-gone`, `child-process-gone`, `unresponsive`, and power events
- Phaser scene lifecycle guidance: treat scenes as restartable units and free resources on shutdown
- Three.js disposal guidance: explicitly dispose geometries, materials, textures, render targets, passes, and close `ImageBitmap` resources when applicable
- MDN WebGPU guidance: treat `GPUDevice.lost` as expected lifecycle, recreate resources on replacement devices, inspect shader compilation info, and capture uncaptured errors
- MDN Page Visibility guidance: background tabs throttle timers and rAF, so correctness must not depend on naive background timing assumptions
- MDN Web Audio guidance: use AudioWorklet for low-latency custom processing and keep main-thread timing pressure low
- Vite build guidance: handle `vite:preloadError` for dynamic import failures after deploy/update

## Final Recommendation

Do not pursue isolated micro-optimizations first.

The biggest win now is architectural hardening:

- make ownership explicit
- make timing authoritative
- make lifecycle contracts enforceable
- make failure and fallback behavior observable

Once those are in place, optimization work will be safer, easier to validate, and far less likely to introduce regressions.
