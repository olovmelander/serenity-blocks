# Repository audit and safe fixes — 2026-11-05/06

**Status:** final. Four audit passes are recorded on PR #358. Passes 1–3 also passed GitHub CI. Pass 4 closes the bounded follow-ups and one pass-3 regression; its CI runs separately after push. The open items below need design decisions and are not incidental fixes. This is an evidence record, not a new architectural roadmap.

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

### Continuation pass 2: save records and lifecycle ownership

Five disjoint audits added 78 regression/control cases, including 53 demonstrated pre-fix failures. Independent save review caught additional date coercion and legacy-container cases before integration. The fixes preserve save versions, gameplay rules, invitation queue policy and existing shutdown grace periods.

| Area / commit | Reproduced defect and resulting behavior | Focused verification |
|---|---|---|
| Deferred startup — `b5c01a6` | A late Steam Cloud import could construct and publish a manager after app cleanup. First-gesture audio listeners also survived teardown. The import checks existing cleanup ownership; click/keyboard listeners share an abort signal retired synchronously by cleanup. | 4 new cases, 2 pre-fix failures; 161 neighboring tests passed |
| Invitations / native subscriptions — `3f4f82d` | Pending friend lookup, activation and visible-toast callbacks could act after destruction. Acceptance also used match state captured when the toast appeared. Retired callbacks are inert; acceptance checks current match state. Explicit transport shutdown releases both native peer-event subscriptions, including partial registration. | 12 new cases, 9 pre-fix failures; 512 neighboring tests passed |
| Cached-mode starts — `8eb5273` | An old theme/audio wait could announce a newer run twice, or its rejection could stop the restarted cached instance. Each accepted managed start now owns its post-await work and rollback. Original errors still reach their callers, and owned failed starts still roll back. | 8 new cases, 5 pre-fix failures; 122 neighboring tests passed; independent review reran all 21 manager tests |
| Capture processes — `392ebd3` | Eight scripts treated `ChildProcess.killed` as proof of exit, so a child ignoring SIGTERM never received the intended SIGKILL. They now inspect actual exit/signal state, preserving 600/800 ms grace and existing Windows taskkill branches. | 14 new cases, 8 pre-fix failures with real subprocesses; 48 neighboring tests passed; fixture children reaped |
| Odyssey records — `6f28388` | Invalid optional score/time/attempt/bonus fields could poison the next completion or erase good cloud data. Malformed maps, unlock lists and counters now normalize without losing valid earned clears. The v1 array-map loophole is closed. Invalid date types and out-of-range timestamps cannot overwrite a valid completion date or throw during merge. | 40 new cases, 29 pre-fix failures; 196 neighboring tests passed; independent frozen-input and symmetric merge checks |

Compatibility controls retain sparse legacy records, numeric zeros, fractional times, theme history, unknown metadata, supported numeric/ISO dates, and New Journey replacement precedence. The historical zero-time comparison convention is unchanged. Cloud-manager disposal and descendant process-tree shutdown were deferred from pass 2 and addressed in pass 3 below. Broader mode selection ordering and direct mode starts remain open.

### Continuation pass 3: cloud durability and retirement

Five further batches add 56 regression/control cases, including 41 demonstrated pre-fix failures. Reviews found and repaired a cached-retry acknowledgment edge case, dropped local events during asynchronous record imports, and duplicate initialization before the code was frozen.

| Area / commit | Resulting behavior | Focused verification |
|---|---|---|
| Cloud retries — `d6ef92c` | Every unacknowledged batch entry survives a rewritten restart ledger, including entries waiting behind another upload. Newer queued entries take precedence. Successful uploads acknowledge only the edit revisions in their payload; cached retries retain those original revisions. Old downloads cannot overwrite edits waiting in the batch. | 12 new cases; 8 fail on original baseline; 142 neighboring tests pass; independent retry/restart and same/different-key checks |
| Cloud retirement — `76f9d99` | Cleanup stops passive timers/triggers immediately, captures final settings/mode saves, then releases local subscriptions. Late passive reads cannot start new applies. Explicit final flush, first-read protection and remote unions remain usable. Async record imports no longer suppress real local-save events. Repeated initialization is idempotent. | 17 new cases; 14 pre-fix failures; 174 neighboring tests pass; two independent reviews exercise 10 grouped lifecycle/uploader scenarios |
| Cached-mode activation — `2c4849e` | An old activation cannot reannounce or clear a reactivated cached instance. Already-active no-ops and current owned failures preserve their existing behavior; original errors still reach callers. | 6 new cases; 2 pre-fix failures; 58 neighboring tests pass |
| Replay ownership — `3ab977c` | Frame handle zero is scheduled/cancelled correctly; retired callbacks cannot enter a restarted replay. Invalid finite checkpoint command indexes are ignored, preserving replay from a valid earlier state. Delayed deletion cannot focus a closed replay sheet. | 10 new cases; 7 pre-fix failures; 163 neighboring tests pass, including deterministic playback/seek compatibility |
| Capture descendants — `1d52a7d` | Eight POSIX capture launchers own explicit process groups, so cleanup reaches a server after its npm/npx wrapper exits. Arbitrary children retain direct-child behavior; repeated cleanup cannot resignal an old group. Commands, arguments, environment and Windows branches are preserved. | 11 new cases; 10 pre-fix failures; 59 neighboring tests pass; independent 25-case check and two actual Vite stop/restart cycles prove port release/reuse |

The pending-upload format remains version 1; revision ownership is process-local. Existing outbound IPC and record transactions may finish after retirement, while passive follow-up is fenced. The two-second desktop quit limit is unchanged. POSIX process-group validation is not native Windows validation. No gameplay, replay clock, save version, visual, dependency or protocol policy change is included.

### Continuation pass 4: finalization

Two batches close the remaining bounded findings and one regression introduced in pass 3. They add 21 cases, 16 of which fail before the fix.

| Area / commit | Resulting behavior | Focused verification |
|---|---|---|
| Replay checkpoint structure — `5ef7f7f` | When a replay loads, each checkpoint is checked for the shapes that restore and the next spawn rely on: piece shape rows and position, locked-piece and queue entries, board rows, and counter/state records. An unusable checkpoint is dropped at load, so a seek replays from an earlier checkpoint or the seed. It no longer throws part-way through restore, leaves `isSeeking` set, or fails on the next spawn. Absent optional fields keep their legacy defaults. Terminal checkpoints with no current piece and matching Infinity checkpoints still restore. An Infinity checkpoint in a non-Infinity session still rejects as a rule mismatch. | 14 new cases covering all eight recorded malformed shapes, an earlier-checkpoint fallback and five compatibility controls; 9 fail on the pass-3 code. All 200 tests in the 20 files that use replay snapshots pass. |
| Capture-server signals — `c9f2f2a` | Pass 3's owned process groups are detached, which also moves the server out of the terminal's session. A terminal Ctrl+C or hang-up then ended only the harness, and Vite kept its strict port. The plain spawn used before pass 3 stopped the server in both cases. The shared helper now forwards SIGINT, SIGTERM and SIGHUP, plus an ordinary exit, to every group it still owns. If the harness has no handler of its own, it still ends by the same signal; a harness that handles the signal itself keeps doing so. `odyssey-gpu-split.mjs` now uses the owned start and the awaited, escalating stop, where it used to signal the npx wrapper once and quit immediately. Windows taskkill branches are unchanged. | 7 new cases using real subprocesses, all failing before the fix: the signal from the harness's process group or to the harness reaches the server, exit cleanup works, the harness's own Ctrl+C handler is respected, and gpu-split joins both existing script lists. 32 capture-process tests pass. A standalone reproduction showed the regression: before pass 3, SIGINT and SIGHUP stopped the server; at pass 3 they did not. |

No gameplay, replay clock, save version, visual, dependency or protocol change is included. The replay validator changes only which saved checkpoints a seek may start from. The seed and earlier valid checkpoints remain the deterministic path, as the pass-3 fallback experiment showed.

### Independent review and follow-up fixes

After pass 4, four independent reviewers read the complete production diff against `04b0b61`, divided into persistence/cloud, mode/replay lifecycle, UI/events/multiplayer and Electron/tooling. They were given the code and the baseline, not the audit's conclusions. Together they made about 2,500 focused test runs (some overlapping), plus replay round-trip simulations and checks against real repository data. None found a blocker. Each area was judged safe to merge, with most changes fixing real bugs and the rest harmless hardening.

Five findings were fixed, each with tests that fail before the fix (8 cases in total):

| Finding / commit | Resolution |
|---|---|
| Local Odyssey load dropped well-formed 0-star clears (pass 2) — `dd7e3b0` | Local saves kept these before this branch, and the save format documents 0–3 stars. Older builds could record such a clear when a one-star tier asked for more than clearing the level. Local load now accepts 0–3 stars and still rejects damaged records. Cloud merging keeps its existing 1–3 rule, unchanged from main. |
| A checkpoint refused by session rules still made a seek reject, and a paused scrub left playback frozen — `d741361` | A refused checkpoint is never adopted. It is logged and dropped, and the seek replays from an earlier checkpoint or the seed. Seek now restarts the frame loop whenever playback is active. The freeze was already present on main. |
| `focus-pause.js` read the same wrong runtime-event shape fixed in `main.js` — `7d50c99` | It now reads `event.focused`, the shape `electron/main.js` sends. Its test used the wrong shape too and now uses the real one. |
| Spectator chat relay sent twice to a peer on both rosters — `809322a` | The spectator loop skips peers already reached by the player broadcast. |
| Capture-helper signal forwarding (pass 4) replaced Electron's clean quit, could be disabled by a second module copy, and rethrew EPERM — `294b3fa` | Electron's main process keeps its own signal handling and relies on the exit hook. This was checked under Electron 44 with xvfb: Ctrl+C, SIGTERM and SIGHUP each quit cleanly and stop the server. One registry is shared per process, and EPERM counts as already gone. |

Reviewed and left as they are (all minor):

- The click-time invitation re-check can queue a "Join" silently or join a "Queue" at once; both avoid worse outcomes.
- Snapshot send-rate state now resets per round.
- A mode-manager stop guard treats an empty slot like a replacement; no caller reaches this.
- Signalling a group number after it has emptied carries a theoretical PID-reuse risk.
- The command-line GPU gate ignores a local scene filter.
- One GPU coverage test became tautological.
- Quitting during a brand-new cloud's first full upload leaves later files unqueued until their next save; a crash in the baseline does the same.

The persistence reviewer also noted that main's cloud merge already drops 0-star clears; that remains unchanged.

## Integration verification

The [initial evidence ledger](../reports/repository-audit-2026-11-06/validation.json), [pass 2 ledger](../reports/repository-audit-2026-11-06/pass-02-validation.json), [pass 3 ledger](../reports/repository-audit-2026-11-06/pass-03-validation.json) and [pass 4 ledger](../reports/repository-audit-2026-11-06/pass-04-validation.json) record tested commits, environment, exact results and limits.

**Pass 4 integration:** code `c9f2f2a` ran **24,687 cases across 1,380 files: 24,683 passed, 3 skipped, 1 failed**, in 680.76 seconds. The 21-case increase matches the added cases. The one failure is the wall-clock micro-benchmark in `tests/unit/half-float.test.js`, which compares two single timings. It measured 78.30 ms against a 75.06 ms bound while every worker was busy. The audit branch does not change that test or its source, and it passed 3 of 3 runs on its own. Typecheck, TypeScript/lint/architecture ratchets, boundaries, theme lifecycle, release (development mode), performance-budget, production dependency audit and whitespace checks passed. Lint remains 432 errors / 1,999 warnings / zero fatal errors; no ceiling was raised. `vite build` ran out of Node 22's default heap in this container. With `NODE_OPTIONS=--max-old-space-size=6144` it passed in 42.41 seconds: entry 3 chunks / 12 KB, main 4 chunks / 1,308 KB (1 KB more than pass 3), and boot closure, IP-string and Pages-artifact gates passed. CI uses Node 24. No browser smoke was rerun, because pass 4 changes only replay checkpoint selection and Node capture tooling.

**Pass 3 integration:** code `76f9d99` passed **24,663 tests, 3 skipped, zero failures across 1,379 files** in 510.49 seconds. The increase matches all 56 added cases. Typecheck, TypeScript/lint/architecture ratchets, boundaries, theme lifecycle, development release, performance budgets, build/boot closure, IP strings, Pages artifact and whitespace checks passed. Lint remains 432 errors / 1,999 warnings / zero fatal errors; no architecture ceiling increased. The 42.20-second build retains entry 3 chunks / 12 KB and main 4 chunks / 1,307 KB. Chromium passed menu/settings startup and initialized cloud cleanup: four local and two passive subscriptions retired, all three timer handles cleared, zero uncaught exceptions. The same no-gesture autoplay errors and canceled media request remain recorded limitations. Actual Vite start/stop cycles released and reused the strict port twice. Independent reviews covered cloud retries, final flush unions and capture ownership. No introduced test failure was found.

**Pass 2 integration:** code `6f28388` passed **24,607 tests, 3 skipped, zero failures across 1,373 files** in 505.59 seconds. The 78-test increase matches the added cases. Typecheck, TypeScript/lint/architecture ratchets, boundaries, theme lifecycle, development release gates, performance-budget checks, build, boot closure, IP strings, Pages artifact and whitespace checks all passed. Lint remains 432 errors / 1,999 warnings / zero fatal errors at its existing ceiling; architecture ceilings were not increased. The production build took 44.85 seconds, with entry 3 chunks / 12 KB and main 4 chunks / 1,307 KB. Chromium again opened all eight menu cards and Controls settings with no uncaught exceptions; three no-gesture autoplay errors and one canceled media request are recorded, not presented as full audio validation. No new failing suite was introduced. The table below retains the initial-pass comparison.

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

Pass 2's [cloud lifetime/retry evidence](../reports/repository-audit-2026-11-06/pass-02-deferred-cloud.json) records the original defects repaired in pass 3. Pass 3's [deferred evidence](../reports/repository-audit-2026-11-06/pass-03-deferred.json) preserves four caller-flow, fourteen replay-snapshot and ten partial-initialization scenarios, their original-baseline comparisons, compatibility controls and reproduction instructions.

1. **Cloud follow-up:** the pass-2 retry/lifetime findings are repaired in pass 3, including cached retries and waiting-batch read protection. Authentic two-device/offline/quit interruption validation remains unperformed. In-flight IPC and already-started record transactions may finish by design; teardown cannot promise network delivery within the unchanged quit budget. Unacknowledged work remains durable for the next session.
2. **Partial app initialization:** actual-method harnesses reproduce late manager construction, UI wiring and deferred work after explicit cleanup at five setup await boundaries; an inner `initializeManagers` return alone still lets outer `init` continue. Failed Phaser/audio initialization also lacks rollback. Real degraded-path adoption closures accept an app after an earlier pagehide. These outcomes match the original baseline; the completed-init cleanup control passes. Ordinary bootstrap installs teardown only after initialization/adoption, so normal quit reachability and browser BFCache behavior are not established. A repair needs ownership across bootstrap, outer initialization, partial allocations and late publication, rather than isolated guards.
3. **Replay snapshot structure:** resolved in pass 4 (`5ef7f7f`). All eight malformed piece, board, queue and counter shapes recorded in the pass-3 deferred evidence are now dropped at load, and a seek replays from an earlier valid checkpoint or the seed. Compatibility and Infinity-policy controls still pass. Values inside well-shaped containers (for example, an unknown shape key in the next-piece queue) are not checked further.
4. **Mode-entry intent:** pass 3 fixes the cached-instance activation completion case. Four complete main-callback reproductions still show pre-existing races on original baseline and current code: a late settings load restores an older selection/UI; an old stop continuation deactivates the newer mode; stale demo startup sends its payload to Serenity; an old card error dismisses a newer loading overlay and reopens the menu. Shared intent must begin before caller awaits, scope stop/deactivate/start to the requested instance, and guard caller success/error presentation. Silent manager early returns are insufficient. Direct mode starts, terminal cleanup during import, and in-progress invite activation also require that explicit contract; preserve legitimate rollback and conditional configuration startup.
5. **Already-running GPU recovery:** a late failure may route out a replacement surface. Blanket registration checks would suppress legitimate self-rebuild failures, so explicit mode/recovery ownership is needed. Visual changes still require the repository's screenshot workflow.
6. **Remaining capture paths:** pass 4 moves `odyssey-gpu-split.mjs` onto the owned-group helper. It also fixes a pass-3 regression: Ctrl+C and terminal hang-up had stopped reaching detached servers. Native Windows process-tree behavior remains unverified. Descendants that deliberately create a separate session are outside the tested group contract. An uncatchable SIGKILL of the harness still leaves its detached group running.
7. **Steam hardware/API coverage:** native friend/leaderboard capabilities are absent in the pinned binding, borderless-window frame behavior needs platform work, and the two-machine protocol soak remains unperformed. `wireV2` currently expires 2026-12-31; older October references are historical, not a reason to alter policy.
8. **Cross-device statistics:** maximum merges cannot fully count independent concurrent games on different devices. A per-device counter/save-model change is beyond a safe incidental fix.
9. **Dependencies:** six development-only packaging dependencies are affected by a moderate minimatch advisory. npm proposes a breaking builder downgrade; no automatic downgrade/override was applied.
10. **Dormant paths:** legacy texture-cache and batching helpers have candidate weaknesses but no active consumers were established. Do not churn unused code without confirming live callers.
11. **Shipping metadata:** the development release gate still warns that `PRIVACY_POLICY.md` lacks a contact address. A store build needs the owner’s real contact information; no address was invented.

## Overnight continuation

Hourly follow-up audit passes and a morning summary were scheduled using the user's approximate 7.5-hour window. Each pass must read this report, avoid concurrent edits, extend coverage, preserve proof, and update the same branch/report. Scheduling is not proof of execution: subsequent runs must append their actual work and outcomes below. The morning report must distinguish completed changes from failed/skipped passes and unresolved risks.

### Pass log

- Initial pass: code fixes, independent reviews, full local suite and build/gates complete. The final local suite passed 24,529 tests with three skips across 1,368 files. GitHub CI is separately checking the branch; its static gates have passed and its full test/build result was still pending at this checkpoint. A managed-environment restart preserved files/commits but terminated the first changed-branch test process before it produced a result; the full run was restarted after the Electron-import fix. Main has not been merged or deployed.
- Pass 2 began 2026-11-05 23:38 UTC. Confirmed initial head `6aba8f4` passed GitHub run `42126922863`: test and build succeeded, deployment skipped. Five additional safe fix batches are committed through `6f28388`, with 78 new cases and 53 pre-fix failures reproduced. Integrated verification finished at 23:53 UTC: 24,607 passed / 3 skipped / zero failures across 1,373 files; build, all applicable gates and Chromium menu/settings smoke passed. The same draft PR is updated. Remote CI for this new checkpoint remains separate from these local results. Read-only follow-up recorded two pre-existing cloud retry/acknowledgment defects and lifetime gaps, with identical original-baseline reproductions, as the next pass’s priority. No merge or deployment.
- Pass 3 began 2026-11-06 00:34 UTC. Confirmed pass-2 head `37ebd98` passed GitHub run `42132957249`: test and build succeeded, deployment skipped. Five new fix batches are committed through `76f9d99`, with 56 new cases and 41 pre-fix failures. Integrated verification finished at 01:00 UTC: 24,663 passed / 3 skipped / zero failures across 1,379 files; all applicable gates, build, Chromium startup/cloud cleanup and real Vite port-release checks passed. Read-only follow-up preserves original-baseline comparisons for actual caller flows, malformed replay snapshots and partial initialization. The same draft PR is updated; remote CI for this checkpoint is separate from these local results. No merge or deployment.
- No scheduled pass ran after pass 3: the branch's last overnight commit is `a086b27` at 01:02 UTC, and the hourly follow-ups and morning summary left no commits or report entries. Pass 4 is a manual finalization run on 2026-11-06 from about 06:25 UTC.
- Pass 4: confirmed pass-3 head `a086b27` passed GitHub run `42141148319` (test and build succeeded, deployment skipped). Two batches are committed through `c9f2f2a`, with 21 new cases and 16 pre-fix failures. They close the replay snapshot finding, move the last capture script onto owned groups, and fix the pass-3 Ctrl+C/hang-up regression. Integrated verification and gates are recorded above. No merge or deployment.

### Final summary

**Completed and verified:** four passes and an independent review, 35 commits on top of baseline `04b0b61`. Across them: desktop/native correctness; persistence, cloud retry and record sanitizing; mode, replay, input and event lifecycle ownership; multiplayer transport cleanup; startup/teardown containment; replay checkpoint validation; and validation-gate and capture-tooling hardening. Each fix comes with regression tests that were run against the code before the fix. The initial pass records its pre-fix failures per area above; passes 2–4 recorded 53, 41 and 16. Passes 1–3 passed GitHub test/build CI; pass 4's CI runs after push.

**Did not run:** every scheduled pass after pass 3, including the morning summary, until this manual finalization. No authenticated Steam session, physical controller, Windows desktop, native Windows process-tree check, two-device cloud run or real GPU performance run was performed in any pass.

**Open risks, each needing a design decision:** mode-entry intent ordering across caller awaits (item 4), partial app-initialization ownership and rollback (item 2), already-running GPU recovery ownership (item 5), cross-device statistics counting (item 8), the development-only minimatch advisory (item 9) and the privacy-policy contact address (item 11). Their reproductions and original-baseline comparisons are in the deferred-evidence files.

**Observed, not fixed:** the High Coast `half-float` micro-benchmark can fail under full parallel load because it compares single wall-clock timings.

**Independent review:** four reviewers, one per area, found no blockers. Five findings were fixed with regression tests (see *Independent review and follow-up fixes*); the remaining minor items are listed there.
