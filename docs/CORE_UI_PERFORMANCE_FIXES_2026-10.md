# Core UI performance fixes — 2026-10-03

Scope: menus, audio, Phaser boards and their settings/lifecycle components. Theme implementations, Three.js and WebGPU rendering are outside this change.

## Implemented fixes

| Audit finding | Result |
|---|---|
| Stacked full-screen and panel blur | Shared menu scrims and menu shells use existing dark fills, gradients, borders and shadows without repeated backdrop sampling. Entrance motion uses opacity and transforms. |
| Continuous decorative repaint | Titles use static gradients; focus uses a solid accessible ring and opacity glow; pointer spotlights translate prepainted layers. Covered menu decoration pauses and resumes without replaying entrance animations. |
| Unchanged paused boards redraw | Paused/covered pausable boards reuse their existing graphics. Board changes, visible-row movement, style changes and resize still invalidate presentation. Competitive online play and Infinity exploration retain live presentation. |
| Player renderers survive local multiplayer exit | All P1–P4 games and aliases have one teardown owner. Cancellation retires partially created games before asynchronous startup can affect a replacement mode. |
| Scene shutdown listeners leak | Phaser shutdown/destroy events release style and resize listeners; restarted scenes recreate resources once. |
| Nominal FPS setting does not limit Phaser | Initial and live caps set `fps.limit` for every game. A shared presentation gate uses public TimeStep clock accounting to avoid the installed limiter's accumulated-delta errors and missed frames at matching refresh rates. Simulation clocks remain independent. |
| Duplicate Hub audio control IDs and gain writers | Hub controls use scoped, unique IDs. Settings preview drives the existing central gain owner once. |
| Settings/cloud work repeats on every input | Live preview compares touched values. Persistence settles after 180 ms and flushes on change, close, pagehide and disposal. Cloud payload export/hash runs after debounce for dirty categories, preserving newer local edits and exact retry payloads. |
| Hidden music progress interval | Progress tracking belongs to the active, visible, playing Music tab. Cached nodes, changed-label checks and transform progress avoid repeated DOM work. |
| Overlapping binding capture listeners/timers | One keyboard/gamepad capture owns polling and listeners; replacement, completion, timeout, close and disposal release it. |
| Procedural noise buffer churn | Noise beds reuse a bounded 4 MiB / 16-entry cache while each sound uses a fresh source, random offset and its existing envelope/filter. |
| Fade cancellation blocks track queue | Cancelled, replaced, muted, stopped and disposed fades settle their Promise and release obsolete work. |
| Unused waveform sampling | Removed the unconsumed time-domain fetch/buffer while preserving shared throttled frequency analysis. |
| Duplicate one-shot loading/unbounded lifetime | Concurrent requests share loads/decodes; cache is bounded to 16 MiB / 16 entries. Cleanup aborts loads, suppresses late results and releases sources/caches. |
| Per-frame contour construction | Piece topology and clipping variants reuse local-coordinate geometry, with translation at draw time and invalidation for in-place shape edits. |
| Transient Phaser/audio object ownership | Completed audio graphs disconnect. SharedEffects eviction destroys live oldest objects. App cleanup retires modes before disposing shared services. |

## Measured menu workload

Two runs per profile used the same 1280×720, DPR 1 software Chromium 153.0.8010.0 runner, with reversed condition order in the second run. The real HTML/CSS and ModalManager were loaded with application bootstrap scripts removed. Fonts settled before capture; each condition settled for 600 ms, then sampled frame intervals for 2.5 seconds. No build/tests ran during capture.

| Profile | Settings mean frame interval before | After |
|---|---:|---:|
| Browser CSS | 57.19 / 56.30 ms | 16.67 / 16.67 ms |
| Electron CSS class in Chromium | 54.44 / 55.18 ms | 16.67 / 16.67 ms |

Settings contains zero backdrop blur surfaces after the change. Covered start-menu infinite animations fall to zero and resume on uncover. Raw condition samples, task/layout counters and scope are in [CORE_UI_MENU_BENCHMARK_2026-10.json](CORE_UI_MENU_BENCHMARK_2026-10.json).

These values isolate menu rendering costs. They are not end-to-end game FPS, packaged Electron measurements or a prediction for another device. Full GPU game capture was unavailable in this runner; theme/GPU performance remains outside scope.

## Interaction and regression validation

Real browser UI checks verified 60 consecutive music-volume inputs produce 60 immediate gain previews, zero storage writes during the drag, and one final write on menu close. Hub volume changes update once and use unique IDs. Music tracking stops on pause, tab switch and Hub close, and resumes with playback. Replacing binding captures leaves one owner; menu close leaves none. Desktop Music Hub and 390-pixel-wide Settings screenshots were inspected; no page errors occurred.

Regression coverage exercises scene restart and listener removal, paused camera/board invalidation, cached geometry changes, actual installed Phaser TimeStep elapsed-time parity, renderer cancellation and cleanup, settings flushing/capture ownership, Music-tab timers, cloud concurrency/conflict guards, fade/queue cancellation, cache bounds and transient audio disconnection. The cap matrix advances actual Scene Clock timers and standalone TweenData with forwarded presentation deltas; native TweenManager uses its own wall clock.

Final validation: **448 test files / 4,791 tests pass**, including 71 added regressions. Production build and boot-closure check, typecheck, TypeScript coverage ratchet, lint ratchet, architecture fitness, dependency boundaries, theme lifecycle audit, existing performance budgets, development release gates and production dependency audit pass. Production dependency audit reports zero vulnerabilities. Lint and architecture ceilings were lowered to preserve the improvements; no baseline was raised.
