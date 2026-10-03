# Core UI performance, pass 3 — 2026-10-03

This pass implements the findings audited after the [core performance follow-up](CORE_UI_PERFORMANCE_FOLLOWUP_2026-10.md), against baseline commit `b52959f`. It covers menus, HUDs, shared audio, replay seeking, score storage and Phaser presentation CPU work. Theme implementations, Three.js/WebGPU rendering and Odyssey chapter graphics are unchanged.

## Implemented improvements

| Finding | Result and preservation constraints |
|---|---|
| Online opponent HUD rebuilt unchanged frags, card styles and garbage segments every presentation frame. | Cache owned nodes and displayed values. Segment invalidation includes rendered line color/order/type and total amount; equal-total changes remain visible. Child/card replacement, removal, death, waiting and disconnection transitions remain supported. Interpolated boards and authoritative garbage timing are unchanged. |
| Spectator spotlight measured unchanged geometry every animation frame. | Cache stage/panel/card ownership and size only after resize, visibility, header/selection or binding invalidation. Observers retire on replacement/disposal. Size changes also invalidate the bitmap so a resized spotlight redraws. |
| Next-piece refresh destroyed three canvases and measured each after appending it. | Retain independent per-container slots and models, batch size reads, and redraw changed piece/style/size/DPR values. Shared viewport events and ResizeObserver own resizing. Context restoration and calls to the exported `drawPiece` API invalidate retained state. Generic multiplayer previews snapshot consumed style values, including in-place edits, and retain animated glow behavior. |
| Stat updates restarted each pulse using a separate synchronous layout read. | Update all affected values, remove pulse classes together, read layout once and restart the same existing animations. Pulse conditions, text, severity classes and keyframes remain unchanged. |
| Infinity minimap repeatedly rebuilt static background texture, CRT lines, labels and gradients. | Cache the background and CRT raster layers plus label/gradient preparation. Scan the top row once and stop at the first occupied row. Keep the scanline, viewport pulse, layer order and 16 ms cadence. Paint translucent labels/build directly to preserve exact pixel rounding. Hidden updates retain the model; reopening catches up and cancels obsolete hide timers. |
| Stationary Phaser pieces regenerated their body/gloss because they share a layer with the animated ghost. | Retain a bounded numeric body/gloss command segment in the same Graphics object. The ghost, animated pieces and small rim continue through their original paths. All numeric commands, order and Graphics layer count remain identical; no new GPU rendering layer is introduced. |
| Every Phaser frame scanned all locked pieces to discover animations. | Retain active candidates with owner/grid/array/version/length and explicit dirty invalidation; preserve zero-offset starters and compact completed candidates without reordering. Animation timing and simulation writers remain unchanged. |
| Partial blind overlays rebuilt throughout their constant-opacity plateau. | Retain the existing blind layer while effective alpha and geometry are unchanged. Fade, expiry, field/partial mode, garbage, board version, viewport and dimensions invalidate it. |
| Dirty stack redraws repeated the same color calculation for adjacent cells. | Share shade samples by color and visible row boundary. Preserve the full command stream, contour topology and ordering. |
| Explicit replay seeks refreshed every invisible intermediate board/stat state and monopolized browser tasks. | Preserve every input, simulation, physics and checkpoint boundary; batch presentation to seek completion and yield after 120 operations or an 8 ms work budget. Exact token/state/demo/callback ownership fences continuation and cancellation. Latest pause/resume requests are retained without pausing seek simulation. Normal playback and fast-forward callback cadence remain unchanged. |
| Leaderboard tab requests overlapped and older responses overwrote newer tabs. | Share pending requests by account/cache key, capture request inputs and fence presentation by panel generation/view/board/owner. Stale results can fill their own cache. Modal hide, replacement and disposal retire UI work. |
| Concurrent music startup loaded the manifest and populated controls twice. | Share a pending manifest load and one initialization per SoundManager owner. Cleanup retires late continuations; fallback and later retries remain supported. |
| Local score saving used six transactions and read every retained record during trimming. | One atomic transaction stores scores/history, retains 100/50 entries via key cursors and updates aggregates. Descending index/primary-key tie ordering and IDs are preserved. Notifications occur after commit; failures roll back all stores and concurrent saves serialize their aggregates. No schema migration. |
| Shared performance counters sorted and summarized the rolling window every sample. | Keep every raw sample and latest counter, resolve exact summaries once when read, and reuse them until the next sample. Reports retain the same averages, medians, maxima and sample order, including collection while the overlay is closed. Summary properties are now enumerable getters; no production caller writes them. |
| Breathing UI rewrote unchanged labels, dots, ring styles and colors. | Cache component-owned presentation values and dot nodes. Hidden progress retains its latest model and catches up on show. Hold phases omit identical writes; inhale/exhale values, phases, colors and existing progress transitions continue unchanged. |

## Verified reductions

The [consolidated evidence](CORE_UI_PERFORMANCE_PASS3_2026-10.json) includes baseline/current operations, repeated probes, preservation results and final source fingerprints. These are operation counts, not measured whole-game FPS or GPU gains.

| Matched workload | Before | After |
|---|---:|---:|
| Garbage-segment creations: four unchanged opponent boards, 60 updates | 960 | 16 |
| Opponent color style assignments, same workload | 1,440 | 24 |
| Spotlight geometry reads after sizing, 120 unchanged calls | 240 | 0 |
| Canvas creations / draws: 60 equivalent synchronous next-queue refreshes | 180 / 180 | 3 / 3 |
| Slot size reads, same synchronous queue workload | 360 | 6 |
| Layout reads for five changed nonrate stats | 5 | 1 |
| Minimap background dot arcs: 60 warm unchanged updates | 20,880 | 0 |
| Minimap fill rectangles, same workload | 6,000 | 540 |
| Minimap gradients, same workload | 120 | 60 |
| Stationary Phaser body/gloss builds over 120 frames | 120 each | 1 each |
| Settled-piece animation checks: 1,000 pieces, 120 frames | 120,000 | 1,000 |
| Blind-plateau clears / rectangles: 50 cells, 120 frames | 120 / 6,000 | 1 / 50 |
| Color shade calculations: 200 same-color stack cells | 400 | 21 |
| Board/stat presentation calls during a seeded five-second seek | 304 each | 1 each |
| Transactions for one local score save | 6 | 1 |
| Full records read / key rows visited while trimming filled score/history stores | 152 / 0 | 0 / 4 |
| Manifest fetches / option insertions during two overlapping startups | 2 / 120 | 1 / 60 |
| Counter sorts during 240 collected samples with no summary consumer | 480 | 0 |
| Dot queries / style assignments for 100 identical breathing progress callbacks | 100 / 6,200 | 1 / 62 |
| Style assignments during 240 constant breathing hold callbacks | 2,880 | 12 |

Queue counts cover 60 consecutive synchronous refreshes; the initial asynchronous ResizeObserver notification is outside that counted workload.

Warm minimap counts deliberately retain 480 text draws: rasterizing the translucent labels/build together introduced tiny alpha rounding differences, so those layers still paint directly. Current nine-case Canvas2D comparisons have zero differing RGBA channels, including in-place board edits, fractional viewport movement, replacement, resize and row extent/offset changes. Paired preview screenshots also match.

Opponent browser checks cover 11 HUD markup cases and seven pinned-phase canvas cases. Resize-reference comparisons explicitly redraw the baseline after recording its pre-existing stale bitmap behavior. Next-preview/multiplayer cases include empty slots, ordering, DPR, resizing, color and context restoration. Breathing checks compare phase/ring/color/progress/dot presentation and hidden-to-visible catch-up. Browser checks report zero errors.

Installed Phaser Graphics methods produce identical complete numeric command streams across ghost pulses, garbage animation, movement, shape/style edits, fractional/clipped pieces, blind transitions and dirty stacks. The stationary fixture retains four Graphics objects and 204 numeric values per frame. This reduces CPU command construction; it does not claim fewer GPU commands or GPU time.

Replay comparisons preserve full canonical snapshot hashes and ordered command/spawn/hit-stop logs. The seeded five-second seek retains all 313 input/simulation boundaries while presentation falls to one update; the clear/perfect-clear/level-up seek retains 300 boundaries while its 291 presentations fall to one. Queued timers execute before seek completion. Native IndexedDB checks also verify retention, tied IDs, aggregates, synchronous/asynchronous rollback and 20 concurrent saves.

## Validation and limits

After the runtime source freeze, **469 test files / 5,015 tests pass**, including **117 added regressions**. Production build and boot closure, typecheck, TypeScript coverage ratchet, lint ratchet, architecture fitness, dependency boundaries, theme lifecycle audit, existing performance budget gate, development release gates, production dependency audit, shipped IP strings and final Pages artifact checks pass. The production audit reports zero vulnerabilities. Lint errors fall from 1,253 to 1,241 and the ratchet is lowered; no architecture baseline is raised.

Movement, gravity, rotation, collision, lock delay, input repeat and stacking rules are unchanged. The shared top-row lookup preserves its existing return semantics. Preservation tests establish state/command/pixel parity within the recorded workloads; subjective play feel and whole-game frame times still require a device playtest/profile.

This pass does not migrate replay metadata into a separate IndexedDB store, replace the long frame-history array with a ring, or rewrite stack flood-fill coordinates. Those are further opportunities that need separate evidence/compatibility work. Theme and GPU profiling remain outside scope.

The retained [shared operation probe](../reports/core-ui-pass3/shared-work-probe.mjs) compares the baseline and candidate directly. Run `node reports/core-ui-pass3/shared-work-probe.mjs` to reproduce its counter, breathing and top-row work counts.
