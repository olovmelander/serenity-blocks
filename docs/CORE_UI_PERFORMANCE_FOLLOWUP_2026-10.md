# Core performance follow-up — 2026-10-03

This pass follows the [first menu/audio/Phaser audit](CORE_UI_PERFORMANCE_FIXES_2026-10.md), using main commit `6080857e4f223e3719ae470cffae8f33d6e463e5` as its baseline. It covers shared menus, audio, Phaser board CPU work, input, transport and storage. Theme implementations, Three.js and WebGPU rendering remain outside its scope. The accompanying cursor fix makes the hotspot follow input directly and lets stationary trails drain.

## Implemented findings

| Reachable bottleneck | Change |
|---|---|
| The global select observer rebuilt an enhanced list for every option mutation in a batch. Ancestor scrolling repeatedly measured its anchor. | Deduplicate changed selects and nested added roots. Overlay position updates share one animation frame and one anchor measurement; option hover uses delegated events. |
| Lobby requests could overlap, rebuild unchanged rows, or acquire a new interval after the menu closed. Repeated waiting-room opens orphaned timers and subscriptions. | One pending request per browser, fenced visibility generations, unchanged-row reuse, and explicit timer/subscription teardown. Focus remains on the existing Join button when lobby content is unchanged. |
| Online snapshots sorted players and rebuilt the Tab scoreboard while hidden. | Retain the latest player model and defer sorting/DOM rendering until visible. Opening displays the latest state once. |
| Hidden Sessions-tab progress performed repeated selectors and writes. External selections scanned every theme-browser card. | Hidden progress stores its latest model; visible progress uses cached nodes and changed-value writes. Selection updates the previous/current cards. Hidden search and thumbnail batches pause and resume on activation. |
| Countdown waits, delayed sounds, breathwork phase delays, voice callbacks and media preloads survived their owners. | Cancel and settle owned work on stop/replacement/disposal. Voice completion settles once. Cancelled countdowns clear their blocking presentation. Active sessions retain their progression and audio. |
| Muted effects still created delayed note timers; completed audio sources disconnected twice. | Suppress disabled triggers, own delayed notes centrally, and disconnect each graph node once. Existing note delays, synthesis and gain-at-play behavior remain intact. |
| Breathwork preloading started many media elements at once and duplicate requests did not share loads. Progress rescanned prior phase durations every 100 ms. | Share pending loads, cap global preload concurrency at four, release finished/cancelled media, and reuse duration prefixes for progress. Missing/hung loads remain retryable and bounded. |
| Moving Phaser pieces recomputed the same local gradients and allocated temporary rectangles. BoardJuice rewrote repeated formatted transforms. | Cache bounded piece style data with shape/style/clipping invalidation, reuse rectangle storage, and skip identical transforms while preserving spring timing. Unchanged view bands reuse their range; camera bounds update once. |
| Hit-stop callbacks referenced mutable scene clocks after scene restart. | Cancel pending restores during cleanup and restore only the captured clock/tween owners, including their original zero time scales. |
| Each gamepad poll reconverted unchanged gameplay bindings and merged Serenity bindings. Async P2P polling could overlap or dispatch after stop. | Cache binding values with replacement/in-place-edit invalidation. P2P polling keeps its 16 ms cadence with one in-flight drain per active generation and retirement checks around async reads/dispatch. |
| The replay browser retained every recording's inputs/checkpoints in card closures. Late list/delete completions rebuilt closed menus. | Request metadata-only cards, load full recordings for playback/sharing, append cards as one fragment, and reject hidden/stale refresh work. Full-list callers retain the original recording API. |
| Cloud score import used a clear transaction plus up to 100 sequential write transactions. FPS metrics rescanned history on every frame, and the hidden legacy FPS counter owned another RAF. | Replace scores in one atomic transaction, resolving only after commit and preserving old rows on failure. Aggregate history when a sample changes; use the existing enhanced performance overlay owner. |

## Verified work reductions

These probes load the actual baseline/current modules. Browser probes use isolated Chromium fixtures with real DOM/IndexedDB; Phaser uses a Graphics command recorder. Repeated menu probes agree. [Raw results and source fingerprints](CORE_UI_PERFORMANCE_FOLLOWUP_2026-10.json) record the instrument and workload.

| Workload | Baseline | Optimized |
|---|---:|---:|
| Select refreshes for 40 native option additions | 40 | 1 |
| Option-row insertions for that batch | 3,200 | 80 |
| Anchor measurements for 60 ancestor-scroll events | 120 | 1 |
| Hidden scoreboard rebuilds for 40 changed eight-player snapshots | 40 | 0 |
| Concurrent lobby requests from show plus 30 refresh calls | 31 | 1 |
| Lobby rebuilds for 30 equivalent snapshots | 30 | 1 |
| Waiting-room orphan intervals/subscriptions after repeated open/close | 1 each | 0 |
| Returned card data for 200 recordings, serialized bytes | 4,889,583 | 20,183 |
| Recording input/checkpoint entries retained by those cards | 101,600 | 0 |
| Write transactions for importing 100 scores | 101 | 1 |
| FPS-history traversals for 240 metric reads | 720 | 0 |
| Bilinear colour samples for 120 moving-piece draws | 1,920 | 16 |
| Distinct temporary rectangle objects for those draws | 960 | 1 |

All 3,840 Phaser Graphics commands in the moving-piece workload remain identical; eight additional shape/style/fractional/clipped cases also match. BoardJuice's sequence tests preserve every formatted transform and animation tick while omitting duplicate writes. Settled dropdown screenshots match byte-for-byte, with unchanged option values, disabled styling, keyboard behavior and placement. Browser probes report zero page errors.

The recording projection reduces retained data; IndexedDB still materializes each full record during listing. A separate metadata store/index is a possible later storage change. Returned JSON size is not a heap measurement. Operation counts establish avoided work, not a whole-game FPS gain or packaged Electron/GPU measurement. Actual device profiling is still needed to quantify frame-time improvements and rank the next bottleneck.

## Validation

After the implementation freeze, **459 test files / 4,898 tests pass**. This follow-up adds 96 regressions beyond the cursor fix's 11. Production build and boot closure, typecheck, TypeScript coverage ratchet, lint ratchet, architecture fitness, dependency boundaries, theme lifecycle audit, existing performance budgets, development release gates and production dependency audit pass. The production audit reports zero vulnerabilities. Lint errors fall from 1,261 to 1,253; the main-file line ceiling falls from 5,668 to 5,667. Both shrink-only baselines are lowered; none is raised.

Regression coverage includes input rebinding, fixed-tick routing, deferred transport reads and ordering, score rollback, replay menu cancellation, scene/style invalidation, hit-stop restoration, hidden presentation, countdown cancellation, media preload bounds, and one-shot voice completion. Independent reviews also checked ownership across the Hub, session/audio managers and scene restarts.
