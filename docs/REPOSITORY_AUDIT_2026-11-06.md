# Repository audit and safe fixes — 2026-11-05/06

**Status:** initial audited fix batch verified locally and available in draft PR #358; scheduled follow-up passes remain pending. This is an evidence record, not a new architectural roadmap. The remaining observations require fresh reproduction and the existing architecture constraints before implementation.

- Repository: `olovmelander/serenity-blocks`
- Baseline: `04b0b613daae153dedffbef47fcba43817f30405`
- Audit branch: `audit/overnight-2026-11-05`
- Review: [draft PR #358](https://github.com/olovmelander/serenity-blocks/pull/358)
- Initial work began: 2026-11-05 22:26 UTC.
- Scope: conservative correctness, persistence, lifecycle, input, desktop, networking and tooling repairs. No gameplay balance, save-schema version, protocol policy, renderer architecture, shader, theme artwork, major dependency upgrade, release, main merge or deployment change.

## Coverage and method

Six parallel source audits covered gameplay and modes; persistence/settings/replays; UI and input; multiplayer transport; resource/audio/event lifecycles; and Electron/native integration. A separate tooling review covered build configuration, CI, release/artifact gates, performance evidence, and dependency advisories. Follow-up reviews covered startup and shutdown, and independently checked other auditors' diffs.

Changes were selected from concrete failure cases. Regression tests were run against the original implementation before fixes; compatibility tests were retained. Independent reviews caught additional same-instance lifecycle, recursive event, keyboard reachability, save-alias and upload-acknowledgment cases before integration. Real Chromium checks exercised DOM behavior, production menu/settings startup, and IndexedDB concurrency and rollback. Full baseline and changed-branch suites are recorded separately below.

This is broad coverage of active paths, not a claim to have reviewed every line or visually validated every theme. Tests of native APIs use mocks unless explicitly described otherwise. No authenticated Steam session, physical gamepad, Windows desktop, real GPU performance run or complete GPU scene sweep was performed.

## Completed fixes

### Desktop and native integration

1. **Focus restoration:** renderer focus handling now reads Electron's actual `{type, focused}` event shape. Returning to the window no longer remains incorrectly classified as hidden. The subscription is disposed during app cleanup.
2. **Cloud buffer boundaries:** typed-array and DataView writes honor their offset and length; a slice no longer uploads unrelated prefix/suffix bytes from its backing buffer.
3. **Native stat failures:** `setStat`, `setStatMax` and `incrementStat` return failure when Steam rejects `setInt`, instead of reporting a successful store of an unchanged stat.
4. **CPU-limit events:** the Electron speed-limit listener reads the single details object used by the pinned Electron version, restoring the actual numeric diagnostic value.
5. **Minimal desktop wrapper:** a process without the single-instance lock cannot create a window from ready/activate callbacks after requesting quit.

Commit: `bcbccdc`. Focused before/after: 10 failures reproduced; 95 related tests passed after fixes.

### Gameplay and mode ownership

1. **Ghost landing:** authoritative board adoption invalidates the ghost cache even when the active piece object is retained. Added and removed stack cells now produce the correct landing preview.
2. **Deferred Odyssey Finish:** a cascade's delayed finish can only finish its original still-active attempt.
3. **Mode lifecycle continuations:** stale activation/start/stop/deactivation completions no longer clear a replacement mode, suspend its theme, or emit an old mode object paired with a new ID. Old stop/deactivate completions also preserve a restarted/reactivated cached instance. Existing cleanup is still allowed to drain.
4. **Mode events:** a listener unsubscribing itself cannot skip the next listener in the current dispatch.

Commit: `88543ec`. Initial regressions reproduced 9 failures; 260 adjacent tests passed. Independent review added two same-instance cases; the subsequent manager/restore/finish run passed 20 tests.

### Persistence, settings, cloud sync and replays

1. **Reset defaults:** resetting settings creates independent sanitized binding maps. Editing reset bindings cannot mutate defaults used by future managers.
2. **Odyssey completions:** malformed/null records and fractional/out-of-range IDs no longer poison progress or count as earned clears. Numeric aliases are normalized; a valid canonical record wins over an alias so earned stars cannot be downgraded by collision.
3. **Odyssey counters:** invalid and negative aggregate counters normalize safely; valid fractional play time remains intact.
4. **Unreadable saves:** non-object Odyssey JSON enters the existing backup path before live state is modified.
5. **Atomic score imports:** reading, merging, trimming and replacing imported scores happen inside one readwrite transaction. An interleaved local save cannot be erased by an earlier import snapshot.
6. **Score identity:** local and cloud deduplication include game mode. Identical statistics from different modes survive, while absent legacy mode still means Single Player. Local replay links are preserved; foreign links remain stripped.
7. **Statistics conflicts:** the final transactional merge retains local games committed after the conflict snapshot.
8. **Controller layout conflicts:** each side is migrated with its own layout version before merge, and the result carries the current version. Customized current bindings are not mistaken for legacy defaults and swapped again.
9. **Cloud acknowledgments:** only the successful uploader records the acknowledged hash/document. Conflict handling no longer overwrites it with a stale snapshot or falsely acknowledges a failed upload.
10. **Replay durability:** save, delete and retention pruning resolve after transaction commit and reject aborts. A failed best-effort prune does not undo an already committed save.
11. **Replay input validation:** imported replay inputs must be an array before playback can receive them.

Commit: `bbd8ea3`. Final targeted validation: 214 tests across 22 files. Independent review and real IndexedDB evidence are recorded below.

### UI and input

1. **Hidden-tab keyboard recovery:** stale fixed-tick physical latches are dropped on return, so the first fresh key press is recognized. Existing hidden-state and repeated-key contracts remain intact.
2. **Gamepad loop ownership:** stopping or restarting polling from inside a callback cannot resurrect the old animation loop. RAF handle zero is treated as a valid handle.
3. **IME chat entry:** Enter/Escape during composition no longer send messages or blur the input while choosing a text candidate.
4. **Segmented selectors:** disabled controls/options remain disabled for keyboard input; arrows skip unavailable options; empty lists are safe. An enabled Tab entry remains available when the current selection is missing or disabled without silently changing the value.
5. **Native-control restoration:** destroying enhanced selectors restores their original accessibility and tab-order attributes.

Commit: `f705217`. Added 13 regressions; 206 related tests passed. Nine real Chromium DOM checks passed.

### Multiplayer transport

1. **Snapshot reset:** queued snapshot timers and pending deltas are retired with their old round/lobby baseline, preventing a delayed old delta from being sent under new session state.
2. **Best-effort Steam operations:** rejected lobby-status, peer-close and lobby-leave IPC promises are handled while local cleanup remains immediate.
3. **Unicode limits:** names/chat retain the existing UTF-16 limits without splitting an emoji's surrogate pair.
4. **Spectator chat:** host relays now reach spectators as well as players, preserving authenticated identity/rate limits and excluding the author.
5. **Steam initialization:** failed attempts remain retryable; simultaneous calls share one attempt. Cancelled activation cannot revive lobby UI or polling. A successfully initialized transport stays cached, with only the current activation rearming polling.

Commit: `35b78d7`. Added 16 regressions; 402 tests across 20 files passed. No protocol/version/expiry changes.

### Events, resources and audio

1. Deferred debounce/throttle/RAF listener failures now obey EventBus exception isolation and identify the original listener.
2. `off(event, handler)` cancels `once` subscriptions using the caller's handler.
3. Recursive emission cannot invoke the same `once` registration twice.
4. An immediate throttle delivery cancels an overdue trailing timer rather than delivering the payload twice.
5. Late asset loads cannot repopulate cleared/removed caches or erase tracking for replacement loads.
6. Falsy cached text/JSON values can be removed along with metadata and LRU entries.
7. Deferred startup tasks contain synchronous throws as well as rejected promises; cancellation accepts timer handle zero.
8. An old GPU-surface unregister callback cannot remove a newer registration using the same label.
9. Queued GPU recovery does not start after its registration has been retired. Existing self-rebuild failure handling remains intact.
10. AudioContext resume rejection is observed and logged; later resume attempts remain possible.
11. Dynamic-resolution policy reports no change when the clamped scale is already at its floor. Quality thresholds are unchanged.

Commit: `786d28c`. Added 28 cases, including 19 baseline failures. A broad resource/audio batch passed 159 tests; the final recursive-event follow-up passed 55 neighboring event tests. Small existing lint defects in touched code were also corrected.

### Startup and application cleanup

1. Asynchronous desktop startup telemetry rejection is caught without blocking renderer initialization.
2. An already-aborted startup wait still observes the already-started work it abandons, preventing a late unhandled rejection.
3. Application cleanup invokes existing gamepad and Steam-invite disposers before asynchronous mode teardown begins, stopping new input, subscriptions and queued invitations during teardown.

Commit: `4a9b8a0`. Baseline failures reproduced; 117 startup tests and 46 cleanup/controller tests passed.

### Build and validation tooling

1. **Portable boot gate:** root paths resolve correctly with spaces, Unicode and Windows drive letters.
2. **Complete boot evidence:** missing/unreadable chunks and dangling static manifest imports fail the gate instead of disappearing or counting as zero bytes. Size limits and lazy-import rules are unchanged.
3. **Budget document validation:** falsy JSON documents and array-shaped budget objects cannot bypass structural validation. Declared pending null budget values remain valid.
4. **Performance medians:** null/blank/boolean/array medians no longer become fake zero measurements. Valid legacy run data remains the fallback; real zeros and numeric strings still work.
5. **GPU scene/report completeness:** unknown filters fail before rendering; the expected chapter set derives from the registry. Empty, incomplete, duplicate, malformed or failing reports cannot pass the CI verdict.
6. **Fresh GPU verdicts:** the harness and workflow invalidate the previous report before startup, so an early crash cannot reuse an older successful result.
7. **CI without a native binary:** theme benchmark report helpers now resolve Electron only when launching a worker. Importing pure report code no longer attempts a binary download or prevents test collection after `npm ci --ignore-scripts`. The baseline full suite exposed this; a regression plus existing reducer tests passed 10/10 after repair.

Commits: `8d056d5`, `841ecd7`, `718d666`. Tooling regressions reproduced 12 failures before fixes; 20 budget/boot tests and 33 GPU coverage/report tests passed. The actual workflow shell was checked with a simulated Electron exit that left no report: it correctly failed rather than accepting a seeded stale success. No GPU sweep was required or claimed for these report/selection changes.

## Integration verification

The compact evidence ledger is [reports/repository-audit-2026-11-06/validation.json](../reports/repository-audit-2026-11-06/validation.json). It records the tested commit, environment, exact results and limits.

| Check | Initial integration result |
|---|---|
| Baseline full Vitest suite | 24,366 passed, 3 skipped, zero failed assertions; one file failed to import without the optional Electron binary |
| Changed-branch full Vitest suite | **24,529 passed, 3 skipped, zero failures across 1,368 files** |
| Type checking | Passed after source fixes |
| TypeScript coverage ratchet | Passed; no lost checked files |
| Lint ratchet | Passed final run: 432 errors, 1,999 warnings, zero fatal errors; ceiling lowered from 435 to 432 |
| Architecture ratchets | Passed; main and online-mode line ceilings lowered to lock in their reductions |
| Import boundaries | Passed: 2,121 modules / 7,781 dependencies |
| Theme lifecycle audit | Passed |
| Production build / boot closure | Final build passed: entry 3 chunks / 12 KB; main 4 chunks / 1,306 KB |
| IP-string and Pages-artifact gates | Passed after the final production build |
| Release gates | Passed in development mode; this is not release approval |
| Performance budget gate | Passed against committed evidence; no new performance measurement claimed |
| Production dependency audit | Zero vulnerabilities |
| Full dependency audit | Six development packages affected by one moderate minimatch advisory; no high/critical findings |
| Whitespace and source syntax checks | Passed for changed files |

Browser/storage evidence:

- Production `dist` booted in headless Chromium with the harness intro/warm-up skips, displayed all eight menu cards, and opened Controls settings. No uncaught exceptions occurred. Browser autoplay denials were logged because this harness did not provide a trusted user gesture; this is not a claim of complete audio playback validation.
- Enhanced selector tests passed nine real DOM checks for disabled choices, keyboard focus, reenable behavior and restored attributes.
- Real Chromium IndexedDB checks retained 22 expected score rows and 21 local-game statistics across 20 concurrent save/import pairs; preserved local replay links and mode identities; rolled back a failed import; and committed a replacement import correctly.
- A separate IndexedDB reproduction changed a phantom replay-save success after abort into a rejected save with no stored row.

Raw local logs, browser results and per-area notes live under `/workspace/serenity-audit/`. The durable ledger and this report carry the summarized evidence; local paths are not required to interpret the completed fixes.

## Remaining observations and next-pass priorities

These are investigations, not permission to implement architectural changes blindly. Existing ADRs and the umbrella plan still govern them.

1. **Save validation:** inspect Odyssey auxiliary fields (`bestScore`, `bestTime`, attempts, completed bonuses) and malformed cloud-only containers while preserving valid legacy data.
2. **Deferred app work:** reproduce late Steam Cloud manager adoption after app cleanup and first-gesture audio listeners surviving teardown; add ownership checks only with a concrete lifecycle harness.
3. **Already-started invites:** the existing invite disposer stops subscriptions/queued invitations but does not fence an already-awaiting friend lookup or lobby activation.
4. **Lazy mode selection:** overlapping mode-load requests can resolve out of order. A request-generation or serialization policy needs dedicated UI-flow testing; same-instance start ownership deserves further review beyond the repaired stop/deactivate continuations.
5. **Already-running GPU recovery:** a late failure may route out a replacement surface. Blanket registration checks would suppress legitimate self-rebuild failures, so explicit mode/recovery ownership is needed. Visual changes still require the repository's screenshot workflow.
6. **Capture-process cleanup:** the GPU harness's existing `ChildProcess.killed` check means signal sent, not process exited. npm/Windows process-tree shutdown needs isolated lifecycle tests before replacement.
7. **Steam hardware/API coverage:** native friend/leaderboard capabilities are absent in the pinned binding, borderless-window frame behavior needs platform work, and the two-machine protocol soak remains unperformed. `wireV2` currently expires 2026-12-31; older October references are historical, not a reason to alter policy.
8. **Cross-device statistics:** maximum merges cannot fully count independent concurrent games on different devices. A per-device counter/save-model change is beyond a safe incidental fix.
9. **Dependencies:** six development-only packaging dependencies are affected by a moderate minimatch advisory. npm proposes a breaking builder downgrade; no automatic downgrade/override was applied.
10. **Dormant paths:** legacy texture-cache and batching helpers have candidate weaknesses but no active consumers were established. Do not churn unused code without confirming live callers.

## Overnight continuation

Hourly follow-up audit passes and a morning summary were scheduled using the user's approximate 7.5-hour window. Each pass must read this report, avoid concurrent edits, extend coverage, preserve proof, and update the same branch/report. Scheduling is not proof of execution: subsequent runs must append their actual work and outcomes below. The morning report must distinguish completed changes from failed/skipped passes and unresolved risks.

### Pass log

- Initial pass: code fixes, independent reviews, full local suite and build/gates complete. The final local suite passed 24,529 tests with three skips across 1,368 files. GitHub CI is separately checking the branch; its static gates have passed and its full test/build result was still pending at this checkpoint. A managed-environment restart preserved files/commits but terminated the first changed-branch test process before it produced a result; the full run was restarted after the Electron-import fix. Main has not been merged or deployed.
