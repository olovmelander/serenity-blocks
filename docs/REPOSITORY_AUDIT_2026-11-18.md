# Repository audit and safe fixes — 2026-11-18

**Status:** final for this pass. A record, not a backlog: harvest the deferred items and owner
decisions into the [umbrella plan](ARCHITECTURAL_REMEDIATION_PLAN.md) before executing them.
Machine-readable companion: [`reports/repository-audit-2026-11-18/findings.json`](../reports/repository-audit-2026-11-18/findings.json)
(every finding with its scenario, evidence, verifier verdict and status). A later run of the
same audit prompt continues from that file.

- Repository: `olovmelander/serenity-blocks`
- Baseline: `2550976` (main, 2026-11-18)
- Audit branch: `ccr-f687f851-nuv4po`
- Scope: everything changed since the 2026-11-06 audit's baseline `04b0b613` (385 commits,
  678 source files) first, then older hot paths. Fixes are conservative: small, local, each with a
  regression test that failed on the original code. No gameplay rule, timing, balance or scoring
  change; no save-schema, replay or wire-protocol version change; no dependency change; nothing in
  `src/themes/` or `src/rendering/odyssey/` (no GPU here for the CLAUDE.md screenshot loop).

## Coverage and method

1. **Orient.** Read the architecture index, the ADRs, the umbrella plan's status tables and the
   four earlier repository audits (2026-10-03, 10-13, 10-22, 11-06), so nothing they recorded,
   fixed or decided is reported again.
2. **Baseline** on the untouched tree with the CI gate list (below).
3. **Discover**, read-only: eight parallel auditors, one per area — core rules and modes; input,
   menus and settings; saves, cloud and replays; multiplayer, Steam and Electron; lifecycle and
   resources; CPU performance; dead code, drift and the test estate; themes and Odyssey (CPU side
   only). Each had to open the code, trace callers and guards, state a concrete scenario, and grep
   the earlier records before reporting. 29 candidates.
4. **Verify**, adversarially: five fresh-context verifiers tried to refute each candidate against
   the real code and reproduced it independently — vitest harnesses driving the real modules (a
   jsdom page built from the real `index.html` for the menu bugs), and for every performance
   claim a measurement per ADR-0016 in headless Chromium 157 (the engine range Electron 44 ships)
   as well as Node 22. Result: 27 confirmed, 2 partly confirmed, none refuted; seven severities
   lowered after measurement or a narrower trigger; one further bug found during verification
   (A18-CORE-5). Three findings need an owner decision.
5. **Fix** what clears the bar, highest rank first, one concern per commit, in isolated
   worktrees; integrate; run the full gate list again and compare with the baseline; independent
   code review of the whole branch diff.

**Not covered.** No GPU (themes and Odyssey are report-only; the theme fixes below are measured
and proven output-identical but still need the screenshot loop on a GPU machine), no
authenticated Steam session or second account (the relay transport has still never run against
real Steam), no Windows desktop or packaged Electron run, no physical gamepad, no real-browser
visual check of the menu fixes (the routing is shown with the real modules on the real
`index.html` under jsdom). Not every file was read: the audit is broad coverage of changed and hot
paths, not a line-by-line review of 920 k lines.

## Baseline gates (untouched tree, `2550976`)

| Gate | Result |
|---|---|
| `npm run typecheck`, `ts-ratchet-check`, `lint:ci`, `architecture-fitness-check`, `audit:theme-lifecycle`, `check:boundaries` | pass |
| `npm test` | 1,473 files, 26,663 passed, 3 skipped (981 s) |
| `perf:budgets:gate`, `check:release-gates`, `check:ip-strings` | pass |
| `npm run build` | **out of memory** at Node's default 2,096 MB heap in this 16 GB container; passes with `NODE_OPTIONS=--max-old-space-size=6144` (66 s), boot closure OK |
| `check:pages-artifact` | pass after the build |

The build's heap need is an observation, not a regression: CI sets no heap option and passes, but
`vite build` now needs more than 2 GB of JavaScript heap, so a smaller machine or container hits the
same wall. Worth a `NODE_OPTIONS` line in the build script, or a look at what the transform holds.

## Results at a glance

30 verified findings: 1 P1, 5 P2, 24 P3. **21 fixed** on this branch (one of them partly), each
with a regression test that failed on the original code (pure deletions instead show no importer
and pass every test touching the module); **3 need an owner decision** (a fourth question, what `stars: 0` means, came out of A18-CORE-4); the rest are deferred with
a reason. Severity is the verified one; where the verifier lowered it, the reported one is noted
in the details.

| Rank | Id | Sev | What the player saw | Status |
|---|---|---|---|---|
| 1 | A18-UI-1 | P1 | After the first game, a controller could no longer use the main menu once Settings or Records had been opened there | fixed `73e57df` |
| 2 | A18-PERS-1 | P2 | A Steam account's first device never received Odyssey progress made on another device | fixed `f164137` |
| 3 | A18-CORE-1 | P2 | Pausing and resuming a replay during a line clear applied an input twice and skipped the next: the replay showed a different game | fixed `8b0adfc` |
| 4 | A18-UI-3 | P2 | Every return to the main menu jumped to Single Player, forgetting the mode just played | fixed `5d3695d` |
| 5 | A18-CORE-2 | P2 | Versus/duel/tide: garbage settling could complete a row nobody cleared; the victim's next lock was credited for it (lines, score, an attack) | **owner decision** |
| 6 | A18-THM-1 | P2 | Solar Eclipse: the flamingos made ~117 KB of garbage every frame at every tier | deferred (theme; patch proven output-identical) |
| 7 | A18-CORE-3 | P3 | Closing the pause sheet during a replay lost a gravity tick (replay could diverge) and resumed a replay paused from the bar | fixed `e8fb2b5` |
| 8 | A18-UI-2 | P3 | The controller press that set a binding also closed Settings and opened the Hub | fixed `d9f2204` |
| 9 | A18-UI-4 | P3 | Start from the Hub just after Settings gave way to it left a paused game with nothing on screen | fixed `1ab229b` |
| 10 | A18-LIFE-1 | P3 | Leaving the Odyssey mid-portal threw an error; a return portal left mid-way never finished | fixed `d8b89ba` |
| 11 | A18-DEAD-2 | P3 | Web build: hiding the tab during a return portal could drop the journey | fixed `ec77cc5` |
| 12 | A18-PERS-2 | P3 | An imported replay older than all 200 stored ones was deleted by its own save ("Replay imported.") | fixed `4cf6450` |
| 13 | A18-PERS-3 | P3 | The replay results sheet ranked a Single Player replay against Infinity runs too | fixed `beed964` |
| 14 | A18-CORE-4 | P3 | A starless Odyssey clear from an older build never granted its orb's theme or chapter bonus | fixed `b4dcf64` |
| 15 | A18-UI-5 | P3 | Stillfall: controller presses in another app undid or restarted the puzzle | fixed `8529028` |
| 16 | A18-UI-6 | P3 | LB/RB and Q/E in Settings over Records also switched the Records tab beneath | fixed `eb7388a` |
| 17 | A18-MP-2 | P3 | Online: a computer clock set back left joiners unanswered by the host | fixed `4d8847b` |
| 18 | A18-MP-1 | P3 | Online: with Steam's relays unreachable, every join failed as "the host did not answer" | **owner decision** |
| 19 | A18-PERF-4 | P3 | Local versus: each 3-4 player attack forced two synchronous layouts (~1.3 ms) | fixed `185d253` |
| 20 | A18-PERF-1 | P3 | The landing shadow rebuilt its layout every frame on every board | fixed `2ee5096` |
| 21 | A18-PERF-3 | P3 | Boot parsed ~51 KB of Odyssey return-portal code because of a 4-line import | fixed `1b6c4cf` |
| 22 | A18-THM-2 | P3 | Synthwave strollers (41 KB/frame), Winter's bear and fox, other rigs: garbage from array destructuring | deferred (theme; patch proven output-identical) |
| 23 | A18-CORE-5 | P3 | A pause that lasts until a replay's line clear ends skips that frame's inputs | fixed `a2b359c` (second pass) |
| 24 | A18-MP-3 | P3 | ADR-0023's relay session enforcement has no behavioural test | fixed `938f13c` (second pass) |
| 25 | A18-PERF-2 | P3 | Phaser's clear() regrows each board's command buffer every frame (~3.4 KB) | deferred (not worth it) |
| 26 | A18-DEAD-1 | P3 | Boot tests pinned a retired logo offset (-31 vs the shipped -36); 924 dead lines | fixed `bf6f737` |
| 27 | A18-DEAD-5 | P3 | ~230 lines of retired helpers with no callers; drifted level lookups | fixed `113541f` |
| 28 | A18-DEAD-4 | P3 | GARBAGE_RULES contradicted the real attack rule; the crowd handicap never applies | partly fixed `77c0681`; **owner decision** for the rest |
| 29 | A18-DEAD-3 | P3 | ADR-0022 leftovers (aurora builder, water membrane) | fixed `38e8491` (second pass; build byte-identical) |
| 30 | A18-DEAD-6 | P3 | composer-dispose.js kept alive only by its test | fixed `93712ff` (second pass; build byte-identical) |

Review follow-ups `4aa9245`: the independent review of the whole branch found no bug in the
fixes' intent but three real edges in them, fixed with tests that fail on the previous code (a
clock set back after a binding capture muted the menus; a stale debounce timer after the Hub's
handoff; a duplicated latch loop), plus one constant moved to a single home.

## Decisions for the owner

1. **A18-CORE-2, garbage that completes a row.** Both fixes change rules, and both must run the
   same on the online host and peer. *Recommendation:* clear such rows inside `applyGarbage`
   with no credit (no lines, score, level, combo or attack) and settle again, released as a
   rules-registry change. The alternative, stopping the settle from dropping a body into a
   garbage hole, leaves bodies hanging over holes and changes how the board looks.
2. **A18-MP-1, relays unreachable.** ADR-0023 promises "a clear message"; its implementation
   record limits that to the transport failing to open. A negative relay status is not terminal
   (Valve retries on the next query or connection), so refusing on it could block a player whose
   network has recovered. *Recommendation:* never block: when a join ends `host_unreachable`, or
   the host's session fails, while the relay status is negative, show the relay message instead
   of "the host did not answer", and give the host a non-blocking notice. Align the ADR wording.
3. **A18-DEAD-4, the crowd handicap.** `handicapCrowd` is always 0 (it needs more than four
   players, and online FFA never uses `MultiPlayerState`) but rides in the ADR-0014 resync sidecar
   and in replays. *Recommendation:* remove it with a compatibility note (the sidecar treats the
   field as optional, replay restore defaults to 0), unless 5-8 player online matches should get
   it — then wire it there instead.
4. **What `stars: 0` means.** The local loader keeps a starless clear as cleared (since `dd7e3b0`)
   and the collection now agrees (A18-CORE-4), but the cloud merge still drops 0-star completions
   on both sides, so the first cloud merge erases such a clear (recorded as deliberate on
   2026-11-06). *Recommendation:* treat it as a clear everywhere, including the cloud merge.
5. **Theme fixes A18-THM-1 and A18-THM-2.** Measured and proven output-identical (bone and pose
   tables bit-identical over 45,000 and 18,000 frames), but CLAUDE.md requires the screenshot loop
   for any theme change. Run them on a GPU machine. Swapping `Math.hypot` for `Math.sqrt` is *not*
   bit-identical (0.88 % of float32 fox posture values differ): keep `hypot`, or use an
   allocation-free replica of V8's algorithm.

## Second pass, same day: what could be done without a GPU

After the first merge (`1c72801`), everything left that needed no GPU, controller, Steam session or
owner decision:

- **A18-CORE-5** (`a2b359c`): a replay paused until a line clear ends keeps that frame's inputs
  queued for the resumed loop instead of counting refused ones as played (a 72-case pause sweep:
  2 diverged boards before, 0 after).
- **A18-MP-3** (`938f13c`): the relay session pump is its own pure module,
  `electron/relay-session-pump.js`, with behavioural tests; `steam-integration.js` only wires it.
  Each of 18 deliberate breaks of the logic and 7 of the wiring fails a test, and a differential
  run of the old and new code over 500 random scenarios matched on every one of 655,510 events.
- **A18-DEAD-3 and A18-DEAD-6** (`38e8491`, `93712ff`): the ADR-0022 leftovers and the unused
  composer helper are gone; the production build is byte-identical before and after (1,078 files,
  every SHA-256 equal), so the shipped game cannot change.
- **The journey transitions' frame-gap rule** is one helper (`23296c7`), so it cannot drift again.
- **False "That theme could not open" notices** (`5799010`, `b80cee7`): a theme step that Random,
  Drift, a Hub pick or the Random timer superseded is no longer reported as a failure, in Serenity
  or on the theme keys (N / Shift+N, LB/RB) in other modes.
- Two stale claims corrected in older records (`7c57edd`, and the three upgrade research note in
  `93712ff`); the architecture-fitness baselines locked in where they shrank.

Still open after this pass: the three owner decisions (A18-CORE-2, A18-MP-1, the crowd half of
A18-DEAD-4) and the question of what `stars: 0` means; the theme fixes A18-THM-1 and A18-THM-2,
which need the screenshot loop on a GPU machine; A18-PERF-2 (not worth it yet).

## Owner-reported after the pass: rapid theme changes (fixed `bfde129`)

*Report:* pressing the theme keys quickly (Serenity's arrows, Random) left a theme that "hangs and
does not start properly". Investigated two ways: the real ThemeManager with fake themes, and the
real built game in headed Chromium under Xvfb with WebGPU on SwiftShader. No switch stays stuck:
the latest-wins queue always drains. Two bugs, both reproduced in the real game:

- **A blank background after switching back.** An in-play switch crossfades and disposes the
  outgoing instance `THEME_CROSSFADE_MS` (2.5 s) later. Switching back to that theme inside the
  window built a fresh instance in the same container; the old instance's delayed disposal ran
  `BaseTheme.stop()`, which removed `.active` from that container under the new theme. The manager
  reported a healthy running theme while the screen showed nothing until the next switch.
  `performThemeSwitch` now disposes a fading instance of its target before building the new one
  (`_retireFadingTheme`).
- **A swallowed arrow press.** `SerenityWorldStepper` advanced its token only when a switch began,
  so a switch still running for an earlier press, settling within the new press's 420 ms delay,
  cleared the newer target: the bar named a theme that never started. Each press now advances the
  token.
- Also: a theme built behind the playing one that failed to start left its async-pipeline session
  open; it is ended now.

*Evidence:* `tests/unit/theme-switch-rapid.test.js` (four cases, each failing on the previous code).
In the real game, before the fix a held-completion run lost the second press and a Forest → Halcyon
→ Forest bounce ended black with `.theme-container.active` empty; after it, the second press
switched to its theme and the bounce ended on Forest, visible and rendering. Caveat: the fade case
was forced in that environment by stretching the fade-out timer to 25 s, because every build there
took longer than 2.5 s; on real hardware switching back is the fast case. Not changed: a switch
already running is never cancelled, so on a slow GPU the latest pick waits for that theme's start
(bounded by its 10 or 20 s timeout).

## Proposals (not executed)

- **One shared helper for the two journey transitions.** `JourneyEntryTransition` and
  `JourneyReturnTransition` share ~230 cloned lines; A18-DEAD-2 is the drift that caused a bug, and
  this branch's fixes had to land in both. Lift the frame clock, readiness hold, abort hold and
  teardown guards into `portal-gate.js` or a small base. The review also notes that the gap rule
  counts any frame step over 1 s, so a main thread blocked for more than a second at a time,
  again and again, would keep the hold from timing out; a `document.hidden` check would tell a
  hidden window from a slow frame. That is the entry's existing design, kept as is here.
- **A18-MP-3**: extract the relay session pump into a pure module with the transport, gate, clock
  and reporter injected, and test it behaviourally (accept only allowed members, close and report
  a not-relayed session, report an ended one, close all on leave). The verifier noted a case the
  test should pin: a closed not-relayed peer that keeps sending is accepted again within 200 ms
  and closed and reported again every second.
- **A shrink-only unused-exports ratchet** (proposed on 2026-10-22, item 19): this pass removed
  ~1,560 dead lines by hand; knip with this repo's glob registries as entries found them.
- **`vite build` heap**: see the baseline note above.

## Gates after the fixes

Same gate list on the final branch (`1b6c4cf`, all fixes and review follow-ups integrated), compared
with the baseline:

| Gate | Baseline `2550976` | Final `1b6c4cf` |
|---|---|---|
| typecheck, ts-ratchet, architecture fitness, theme lifecycle, boundaries | pass | pass |
| `lint:ci` | 432 errors (at ratchet), 2,385 warnings | 432 errors (at ratchet), 2,385 warnings |
| `npm test` | 1,473 files, 26,663 passed, 3 skipped | 1,479 files, 26,696 passed, 3 skipped |
| `perf:budgets:gate`, `check:release-gates` | pass | pass |
| `npm run build` (6 GB heap) + boot closure | pass; main static closure 1,337 KB | pass; main static closure **1,288 KB** |
| `check:ip-strings`, `check:pages-artifact` | pass | pass |

Every fix was also checked on its own: its regression test failed on the original code and
passed after, and the focused tests of every touched module passed before integration. A headless
Chromium boot of the built game (no GPU) showed the menu with no console or page errors before and
after the boot-path change, and every lazily loaded Odyssey chunk still evaluated. Not run: a
packaged Electron smoke, the GPU validation lanes, and anything needing Steam or a physical pad.

## Findings in detail

Each entry: id, verified severity, status (with the commit on this branch), the finding, where it
lives, what happens, and what the independent verifier did. Paths such as `verify/ui/...` name the
verifiers' scratch harnesses, which were not committed; the regression tests in each fix commit are
the durable evidence. Full fields (evidence with file:line, fix sketch, known-record check) are in
`findings.json`.

### Input, menus and settings

**A18-UI-1 · P1 · fixed (73e57df)** — After the first game, the main menu's controller handler is never re-armed; once Settings or Records is opened and closed on that menu, D-pad, A and B stop working  
`src/ui/gamepad-controller.js:858`

- *What happens:* Controller only: boot, play any mode, return to the main menu, open Settings (Start) or Records and close with B → D-pad/stick/A/B do nothing on the main menu; only Start and View work; a Steam invite toast stops answering A/B (isInLivePlay true). Even before a sheet, the second visit runs on the generic handler (no right-stick scroll, B no longer returns to mode list).
- *Verification (confirmed):* jsdom with the real index.html, GamepadController, ModalManager, setupModalUI, showHighScoresModal (verify/ui/p1-menu-rearm.test.mjs). First visit after Settings: routes {selection:3}, A clicked the card. Second visit after Start+B on Settings: flags {sel:false, nav:false}, routes {gameplay:9}, card clicks [], A/B/Down → rotate/hardDrop/softDrop. Records + B: same. Nothing in src re-sets the flags. Fix: ModalManager.show('start') enables game-mode selection; hide('start') disables it.

**A18-UI-2 · P3 (reported P2) · fixed (d9f2204)** — The pad press that finishes a binding capture also acts on Settings: View closes Settings and opens the Hub; Start/LB/RB/D-pad can close Settings, switch tab or move focus  
`src/ui/gamepad-controller.js:1633`

- *What happens:* Settings › Controls › Controller › Pause, A to listen, press View → binding saved, then the same held press closes Settings and opens the Serenity Hub (mid-run: resume then pause again). Start to bind Pause closes Settings ~1 in 6 times; LB/RB can switch tab; D-pad can move focus.
- *Verification (confirmed):* verify/ui/c2-capture-press.test.mjs with real handleGamepadBinding/GamepadController/ModalManager: Pause←View: bound, Settings closed, Hub toggled once; Pause←Start (interval first): Settings closed; RB: tab general→display. Binding always saved correctly; side effect only → P3. Fix: in processMenuNavigation treat listening OR data-capture-ended < 300 ms as capture-owned and latch hub/start too.

**A18-UI-3 · P2 · fixed (5d3695d)** — The controller's 100 ms first-focus pass runs on every main-menu show, even with no pad connected, and moves focus to the first mode card, so the menu forgets the remembered mode  
`src/ui/gamepad-controller.js:1606`

- *What happens:* Play Odyssey/Infinity and return to the main menu (or boot with a remembered mode): 100 ms after ModalManager.show('start'), enableMenuNavigation focuses getFirstFocusableElement() = #single-player-card-btn regardless of pads or current focus → Single Player becomes current (stage/light/world switch, hover blip); Records then opens on Single Player. main-menu's 160 ms focusCurrentForKeys then refocuses 'single'.
- *Verification (confirmed):* verify/ui/c3-first-focus.test.mjs, real main-menu.js (lastMode odyssey), no pad: current odyssey at 90 ms → single at 120 ms; keyboard user same. Fix: in the timer return when getMenuSheet() is null (main-menu.js places its own focus). Related: processGameModeSelection's unfocused branch focuses gameModeCards[selectedGameModeIndex||0], not the .is-current card.

**A18-UI-4 · P3 · fixed (1ab229b)** — Start from the Hub within 500 ms of opening Settings closes the Hub but Settings never opens: game stays paused with nothing on screen  
`src/ui/gamepad-controller.js:3195`

- *What happens:* In a run: Start (Settings opens, 500 ms cooldown armed), View (Settings closes, Hub opens), Start again within 500 ms → Hub closes without resuming, toggleSettings hits the cooldown and returns; paused game with no Hub and no Settings.
- *Verification (confirmed):* verify/ui/c4-hub-start-cooldown.test.mjs: second Start at ~350 ms → hub closed, settings not visible, paused; at ~650 ms opens. Soft lock (another Start/Escape recovers). Fix: clear _toggleCooldown before toggleSettings in the Hub branch.

**A18-UI-5 · P3 · fixed (8529028)** — Stillfall's own pad loop ignores window focus: with 'Pause when the game loses focus' off, presses made in another app undo, restart or advance the puzzle  
`src/ui/stillfall/stillfall-hud.js:591`

- *What happens:* Focus-pause off, Stillfall puzzle on the board, alt-tab with the game window still visible and use the controller elsewhere: LB undoes, RB restarts, A after a solve loads the next puzzle.
- *Verification (confirmed):* verify/ui/c5-stillfall-unfocused.test.mjs, real installStillfallHud with hasFocus false: sent ['undo','restart','next']; main controller 0 calls. Needs non-default setting + visible unfocused window. Fix: skip actions when document.hidden or !hasFocus (keep updating padPrev).

**A18-UI-6 · P3 · fixed (eb7388a)** — LB/RB (and Q/E) in Settings opened over Records also switch the Records tab hidden beneath  
`src/ui/gamepad-controller.js:1842`

- *What happens:* Records open, Start opens Settings over it, RB → Settings changes tab and so does Records underneath (re-reads scores); after closing Settings Records shows a different mode. Keyboard Q/E does the same.
- *Verification (confirmed):* verify/ui/c6-tabs-under-settings.test.mjs: pad RB {single,general}→{infinity,display}; keyboard E → {odyssey,audio}. Fix: return after Settings branch in switchMainTab; Records Q/E listener returns when #settings-modal visible.


### Saves, cloud and replays

**A18-PERS-1 · P2 · fixed (f164137)** — Steam Cloud: a first device with no Odyssey save keeps an Odyssey upload stuck forever, blocking every later Odyssey download to it  
`src/core/steam/steam-cloud-sync.js:365`

- *What happens:* First cloud device A has no Odyssey save. First sync finds no manifest → _pushAllLocal queues odyssey.json → _flushUploadEntries' Odyssey branch gets null from _exportOdyssey() and throws ('could not be preserved'); entry is re-queued and persisted. Device B uploads Odyssey progress. A restarts: _syncFile(odyssey.json) sees the pending entry, _flushPendingUploads throws again, returns at 461 without downloading. A's local Odyssey save never arrives: fresh journey at Orb 1, menu/Records show no progress, breath worlds stay locked, until A's first own Odyssey save.
- *Verification (confirmed):* verify/gameplay/p1-cloud-odyssey-stuck.test.js (real SteamCloudSyncManager + OdysseyStateManager, in-memory cloud): A pending ['odyssey.json'] forever, local save null, completedLevels 0 after B uploads 2; fresh device control downloads both. Precondition near-universal for a new player's first device. Fix: Odyssey branch with local null: apply remote via _applyOdyssey if it parses (then drop/ack), drop if both absent; keep throw when the remote read itself fails (lifetime tests rely on it). No data loss; heals on A's first Odyssey save.

**A18-PERS-2 · P3 (reported P2) · fixed (4cf6450)** — An imported replay older than every stored replay is deleted by the retention prune of its own save, while the sheet says 'Replay imported.'  
`src/core/demo/DemoManager.js:96`

- *What happens:* At MAX_STORED_DEMOS=200 (every Single Player game auto-saves a replay), importing a replay file keeps its original timestamp; saveDemo adds row 201, _pruneOldDemos walks index('timestamp') oldest-first and deletes the just-imported row. demo-browser reports 'Replay imported.' but it's gone. Exporting a PB replay to keep it and re-importing later is exactly the failing case.
- *Verification (confirmed):* verify/gameplay/p2-import-pruned.test.js: import id 201, loadDemo(201) undefined, rows 200. Fix: prune in save order via store.openCursor() over autoIncrement ids (no schema change); replay-storage-transaction.test.js harness needs store.openCursor. Downgraded: niche, only at the 200 cap, source file untouched.

**A18-PERS-3 · P3 (reported P2) · fixed (beed964)** — Replay results rank and career stats mix Infinity runs into Single Player (getRank/getStatistics without a mode)  
`src/ui/modals.js:615`

- *What happens:* showDemoCompleteModal (Single Player replays only) calls highScoreManager.getRank(score) with no mode → counts all modes; Career/session cards use lifetime totals across modes. A player with 60 Infinity runs ≥90k watching their 50k Single Player best replay sees 'Rank #61' instead of 'New record', and Infinity-mixed career figures. The game-over modal ranks per mode (modals.js:405-406).
- *Verification (confirmed):* verify/gameplay/p3-demo-rank-mode.test.js: getRank called with no mode → 'Rank #61'; career mixes 90,059 Infinity best. Fix: mode as in showGameOverModal; getRank(score,{mode}); statisticsForMode. Display only → P3.


### Core rules and modes

**A18-CORE-1 · P2 · fixed (8b0adfc)** — Replay: resuming while a line clear is still animating starts a second frame loop; recorded inputs are applied twice and the next one skipped  
`src/core/demo/DemoPlayer.js:247`

- *What happens:* Replay at ≤1x; a lock clears a line; _loop awaits _advanceTo → _waitForPhysics while the cascade pacer waits ~250-600 ms/wave; animationId is already null. Viewer pauses and resumes in that window (double-click play/pause, two pad A presses, pause sheet open/close). resumePlayback → _scheduleLoop checks only animationId → second _loop with same seekToken. Both read demo.inputs[currentInputIndex] before either increments: one input applied twice, next skipped; replay diverges; runtime checkpoints capture the diverged board.
- *Verification (confirmed):* verify/gameplay/c1-demo-double-loop.test.js (real DemoPlayer/GameState/hardDrop/pacer, fake timers): same-frame inputs → move:1 applied twice, rotate:left never; digest 39520102 vs 9763456b. Any concurrent loop also rewrites the replay clock (first spawn after clear at sim 159.7 vs 303 ms; score 381 vs 386). Regression from b58561c. Fix must be token-scoped (a plain boolean can stall after seek()/startPlayback retire a loop): _runningLoopToken set in _loop, cleared in finally only if equal and before its own reschedule; _scheduleLoop returns while _runningLoopToken === seekToken. Separate older issue: a pause lasting until the cascade ends lets _advanceTo count same-frame inputs as applied while isPaused rejects them.

**A18-CORE-2 · P2 · deferred: owner decision** — Garbage settling can complete a row that nothing clears; the victim's next lock clears it and is credited for it  
`src/core/garbage.js:712`

- *What happens:* Local versus (and Odyssey duels / rising tide via applyGarbage): a one-column body resting in column c; garbage rows with their hole in c arrive; settleFloatingBlocksAfterGarbage drops the body into the aligned holes completing rows; linesAfterInsertion reports them but every caller ignores it. Full rows sit uncleared until the victim's next lock, which clears them as the victim's own clear: lines, score, level, Odyssey line goals, and an outgoing attack.
- *Verification (confirmed):* verify/gameplay/c2-garbage-settle-full-row.test.js: 1x2 body + hole at col 3 → fullRowsOnBoard [23]; next unrelated drop → lines 0→1, score 0→325, attack sent. Well case: 4 full rows → credited 4-line clear. Also affects online FFA host and peer (ffa-p2p-game-state.js:1642, :3374). Either fix is a rules change (clear without credit, deterministic on host and peer; or stop settle into garbage holes) and breaks garbage-boundary holeMask-0 cases.
- *Needs an owner decision.*

**A18-CORE-3 · P3 · fixed (e8fb2b5)** — Resuming Single Player during a replay drops one gravity tick and un-pauses a replay the viewer had paused  
`src/core/game-modes/SinglePlayerMode.js:484`

- *What happens:* (a) Pause sheet open/close during a replay: BaseGameMode.onResume sets lastTime = performance.now() (wall clock) but replay lastTime is sim time → next updateGame delta = 0 → that tick's gravity/lock timer/hit-stop lost; each pause/resume shifts gravity phase by one tick → replay can diverge. (b) If paused via the bar's play/pause first, closing the sheet resumes playback anyway while the icon still shows paused.
- *Verification (confirmed):* verify/gameplay/c3b-trace.test.js: after resume lastTime = wall clock, a frame's gravity lost; c3-resume-gravity-tick.test.js: 1 of 91 move timings gives a different board and score. At 2x/4x the delta becomes a clamped 50 ms burst instead. (b) playback resumes after the viewer paused it; the icon catches up within 100 ms (claim about the icon was wrong). Fix: in SinglePlayerMode.onResume keep the replay clock when isPlayingDemo; resume the demo only if the mode paused it.

**A18-CORE-4 · P3 · fixed (b4dcf64)** — A saved 0-star Odyssey clear counts as cleared for progress but never grants its orb's theme or the chapter 1/4 reward themes  
`src/core/progression/theme-collection-model.js:71`

- *What happens:* Legacy save with a well-formed stars:0 completion (kept on load since dd7e3b0): map shows cleared, next orb opens; ThemeCollectionService.getValidCompletedLevels only accepts 1-3 stars → theme never granted, status says 'Complete Odyssey orb N', chapter 1/4 rewards (thermal-bloom, painted-ages) never fire. Current campaign can't produce new 0-star clears.
- *Verification (confirmed):* verify/gameplay/c4-zero-star-collection.test.js: v5 save with orbs 1-5 at stars 0 → owned [forest], orb1 status 'Complete Odyssey orb 1'; at stars 1 owns 6 themes + thermal-bloom. Fix: getValidCompletedLevels uses normalizeOdysseyCompletion(completion,{minStars:0}). Cloud merge (1-3 both sides) erases the 0-star clear itself on first merge — a related, recorded-as-deliberate sibling.

**A18-CORE-5 · P3 · deferred: separate concern from A18-CORE-1** — Replay: a pause that lasts until a line clear ends makes the replay skip that frame's recorded inputs while counting them as applied  
`src/core/demo/DemoPlayer.js:466`

- *What happens:* Single Player replay at 0.5x or 1x: a hard drop clears a line and the viewer pauses (bar, pad, Escape or focus loss) until the cascade has finished. The in-flight _advanceTo resumes with gameState.isPaused true; its same-frame recorded inputs are refused (core move/rotate and SinglePlayerMode._applyCommand reject while paused) but currentInputIndex still advances, so they are skipped for good and the replay diverges from the recorded game.
- *Verification (confirmed):* Reproduced by the verifier on the real DemoPlayer/GameState/pacer under fake timers (digest a71ae2eb vs 9763456b). Not independently re-verified by a second agent; deferred to keep the CORE-1 fix to one concern.


### Multiplayer, Steam and Electron

**A18-MP-1 · P3 (reported P2) · deferred: owner decision** — Relay network unreachable is never surfaced: lobbies are created/joined and fail as 'host did not answer', contrary to ADR-0023  
`src/core/steam/steam-networking.js:427`

- *What happens:* Steam client and lobbies work but Valve's SDR relays are unreachable (e.g. firewall blocks relay UDP). The relay transport opens, networkMode stays 'relay'; GetRelayNetworkStatus reports Failed/CannotTry → steam:getNetworkTransport returns {mode:'relay', relayNetwork:'failed'}; _requireRelayTransport refuses only mode==='unavailable', so createLobby/joinLobby proceed. Joiner: every attempt ends 'The host did not answer...' after ~10 s. Host: waiting room stays empty. ADR-0023 promises a clear message.
- *Verification (confirmed):* relayNetwork is computed and returned but nothing acts on it (verify/mp/describe-relay-status.mjs: every relay status → message null, lobbyAllowed true). Negative availability states are not terminal (a query or connection attempt triggers a retry), so hard-refusing on a stale 'failed'/'cannot-try' could block a recovered player. ADR-0023 Consequences promise a clear message; ONLINE_RELAY_TRANSPORT limits 'unavailable' to the transport failing to open — docs disagree. Safer fixes: force a retry and poll before refusing, or never block and swap in the relay message when a join ends host_unreachable while relayNetwork is negative. Correction: InitRelayNetworkAccess returns void (nothing to check). Privacy unaffected.
- *Needs an owner decision.*

**A18-MP-2 · P3 · fixed (4d8847b)** — Relay session pump throttled on Date.now(): a backward clock step stops accepting and checking sessions until the clock catches up  
`electron/steam-integration.js:494`

- *What happens:* System clock steps back by Δ (time sync after resume, manual change, VM restore) while hosting/in a lobby: relayAcceptedAt/relayCheckedAt stay in the future, so no AcceptSessionWithUser and no session-state reads for Δ. Joiners time out 'host did not answer'; host-handover claimant not accepted; broken sessions not reported; 'connected but not relayed → close' guard paused.
- *Verification (confirmed):* vm harness slicing the real pumpRelaySessions (verify/mp/pump-clock.mjs): after a 60 s backward step, 0 accepts in 10 s; new member first accepted after 60.03 s; broken session reported after 60 s. Timestamps only written in the pump, never reset. Fix: performance.now() for both throttles (one file, negligible risk).

**A18-MP-3 · P3 · deferred: extraction (M) of code never run against real Steam** — ADR-0023 session enforcement (pumpRelaySessions / closeRelaySessions / relay read-send branches) has no behavioural test, only source regexes  
`electron/steam-integration.js:491`

- *What happens:* Regressions in accept-only-allowed, close-and-report not-relayed sessions, report ended sessions, close all on leave/create/join/quit would pass CI.
- *Verification (confirmed):* No test imports steam-integration.js or drives its handlers; all touching tests are readFileSync + regex. Extract pump + relayPeers into a pure module with injected transport/gate/members/now/report/log, keep log lines for the two-account test. Note for the test: a closed not-relayed peer that keeps sending is re-accepted within 200 ms and re-closed/reported every second.


### Lifecycle and resources

**A18-LIFE-1 · P3 · fixed (d8b89ba)** — Portal gate: dispose() during an in-flight off-thread run tears it down twice; the second teardown resizes the transferred canvas (InvalidStateError; the return transition's play() then never resolves)  
`src/rendering/transitions/JourneyEntryTransition.js:741`

- *What happens:* Odyssey map: click an orb → JourneyEntryTransition.play() hands its canvas to the worker (transferControlToOffscreen). If Odyssey is deactivated in the first ~0.8 s (quit, GPU-loss route-out, Steam invite), onDeactivate disposes the transition: dispose() calls abort('dispose') (async finish) then teardown() synchronously, which nulls run.remote. finish's finally → fadeOutAndTeardown → teardown(run) again 240 ms later; run.remote is null so it reaches canvas.width = 0 on the transferred canvas → InvalidStateError thrown from a timer. JourneyReturnTransition has the same pattern (teardown 639-661) but its finally calls teardown directly, so the throw rejects with no handler and play() never resolves (returnToOdysseyWorld never clears _boardReturnOperation).
- *Verification (confirmed):* Headless Chromium 157 with real classes, real Worker and real transferControlToOffscreen: entry dispose → uncaught InvalidStateError from the timer; return dispose → unhandled rejection, play() pending (with 0-3 awaits before dispose in onDeactivate). Fix: never size a handed-over canvas (handedOver flag / drop the canvas ref) and make teardown idempotent; Return.finish teardown in try/finally so resolve always fires.


### CPU performance

**A18-PERF-1 · P3 (reported P2) · fixed (2ee5096)** — The new landing shadow allocates ~5.6 KB of garbage per frame per board (regression from ~1.6 KB for the old ghost)  
`src/rendering/board-look.js:167`

- *What happens:* Every presented frame of every Phaser board while a piece falls (single player, Odyssey, Infinity, local versus 2-4 boards). landingShadowRects rebuilds rects from scratch each frame though they depend only on shape and hidden-row clip. Board update() went ~5.4 KB → ~9.9 KB garbage/frame (+83%): ~306 KB/s at 60 Hz per board, ~1.2 MB/s with 4 boards. CPU time ~unchanged (~2-3 µs); cost is GC pressure; any hitch suspected, not measured.
- *Verification (confirmed):* Hot every frame on every board. Node 22 reproduces 5.6 KB/call, but in headless Chromium 157 (Electron 44's engine range) drawLandingShadow is 1.77 KB → 0.05 KB patched, and whole update() HEAD 5,694 B vs old ghost 5,058 B vs patched 3,913 B: regression ≈ +0.64 KB/frame (+13%). Patch (rect topology cached per shape+clip with _getPieceGeometry's snapshot check; inline alpha) bit-identical over 13,105 configurations and 240-frame streams for T/I/S. Scripts verify/perf/landing-shadow-bench.mjs, browser-scene-bench.cjs.

**A18-PERF-2 · P3 (reported P3) · deferred: not worth a Phaser-internal writer without a measured GC pause** — pieceGraphics.clear() every frame discards the command buffer backing store → ~4 KB regrowth garbage per board per frame  
`src/rendering/phaser/base-board-scene.js:230`

- *What happens:* Every frame, every board, every mode (present at baseline too). Phaser clear() sets commandBuffer.length = 0 which releases V8 backing store; 160-200 pushes regrow it: ~4.2 KB/frame per board.
- *Verification (confirmed):* ~3.4 KB/frame per board in Node and Chromium. A naive retained writer changed the command streams (drawCurrentPiece slices commandBuffer mid-frame); a correct one needs Phaser internals and a cursor for every reader (M). Poor cost/benefit without a measured GC pause: report only.

**A18-PERF-3 · P3 · fixed (1b6c4cf)** — Boot loads ~55 KB (min) of Odyssey return-transition code because the map input imports a 4-line predicate  
`src/ui/odyssey/odyssey-map-input.js:11`

- *What happens:* Every launch: main.js → gamepad-controller.js:26 → odyssey-map-input.js:11 → odyssey-world-return.js → JourneyReturnTransition → portal-gate(-matter, -remote), odyssey-journey-ending, odyssey-flow-answers, odyssey-level-session... 12 modules (~141 KB source, ~55 KB min) reachable from main only through this import, which needs only isOdysseyWorldInterlude (~10 lines, no imports). Boot parse/compile cost suspected few ms; not measured in browser.
- *Verification (confirmed):* es-module-lexer closure: 214 → 202 modules without the edge; 12 modules 144,488 B source / 54,320 B minified; strings present in the built main chunk. ~1.6 ms compile+evaluate in Node (CPU lower bound). Fix: dependency-free leaf for the two predicates, re-exported; validate with build, boot closure and an Electron smoke (TDZ warning in vite.config.js). check-boot-closure can't see it (chunk names only): add a static-graph unit test.

**A18-PERF-4 · P3 · fixed (185d253)** — Local versus showAttack interleaves layout reads and DOM writes per target → forced synchronous layouts in 3-4 player attacks  
`src/ui/local-versus-hud.js:561`

- *What happens:* 3-4 player local versus, every clear that sends lines: each target after the first reads getBoundingClientRect after the previous iteration appended a streak and started animations → forced layout (2 extra per attack in 4-player). Suspected 0.2-2 ms each; unmeasured.
- *Verification (confirmed):* Chromium 157 with real index.html + stylesheets: 2 forced style+layout passes per 3-target attack (~1.3 ms); showAttack median 1.6-2.1 ms vs 0.2-0.3 ms read-first; cssText identical. Fix in local-versus-hud.js only.


### Themes and Odyssey (CPU side)

**A18-THM-1 · P2 · deferred: theme file, needs the GPU screenshot loop** — Solar Eclipse flamingos: writeBirds allocates ~117 KB every frame and re-plans both flights from scratch every frame  
`src/themes/solar-eclipse/solar-eclipse-flamingo-flight.js:764`

- *What happens:* Solar Eclipse at High/Ultra/Extreme (flock 18-20, flight 12; flock always drawn): writeBirds allocates ~117 KB/frame and 0.137 ms CPU whether or not a flight is airborne (~7 MB/s garbage at 60 fps). Patched copy: 6.4 KB and 0.065 ms with identical bone table.
- *Verification (confirmed):* Chromium 157: 117.4 KB/frame, 118 µs airborne (78 KB quiet); at every tier (Minimal 8/6 … Extreme 20/12). Patched (rotate index reads, allocation-free replica of V8 Math.hypot, lowestToe scratch, plans cached on values) 27.5 KB / 79 µs; report=null 23 KB. Bone tables bit-identical over 45,000 frames incl. slot boundaries, pinned flight, aspect change. Math.sqrt is not bit-equal to Math.hypot (use the replica for strict identity).

**A18-THM-2 · P3 · deferred: theme files, needs the GPU screenshot loop** — Synthwave strollers and shared fox rig: per-frame posing allocates via array destructuring in qRotate and cycleCurve (41 KB/frame on the pier); STATIC_STARTUP_AUDIT's 'solve allocates nothing' does not hold  
`src/themes/shared/fox-rig.js:51`

- *What happens:* Synthwave Sunset Extreme (16 people): 41 KB/frame (~2.5 MB/s), 0.093 ms CPU. Same qRotate/Math.hypot every frame for Winter's polar bear (8.5 KB/frame) and arctic fox (4.8 KB/frame), Sakura Twilight foxes, Verdant Hills sheep.
- *Verification (confirmed):* Chromium 157: StrollerLife.write ×16 41.2 KB → 7.5 KB with qRotate index reads + closure-free cycleCurve + LIMBS index reads; pose table bit-identical over 18,000 frames. Arctic fox 3,591 → 2,086 B/call bit-identical. Swapping Math.hypot for Math.sqrt is NOT bit-identical (0.88% of float32 posture values differ): leave hypot or use an exact replica.


### Dead code, drift and tests

**A18-DEAD-1 · P3 (reported P2) · fixed (bf6f737)** — Retired boot-warp scene (924 lines) survives only through tests and a playground harness; boot tests mock the live overlay with the retired -31 px offset (live code uses -36)  
`src/ui/boot-warp-transition-scene.js:95`

- *What happens:* Boot overlay is boot-aurora-scene.js since 2026-10-15; the old warp scene and intro-noise-lib.js are reached only by the logo-warp-transition playground effect and tests. boot-warp-handoff.test.js:1415-1450 tests warpFovAt (never called by boot); fallback layout it.each (:599, :614) checks against retired DEFAULT_MARK_OFFSET_Y_PX (-31); boot-warp-handoff.test.js:140-144 and startup-animation-reliability.test.js:128-140 mock boot-aurora-scene.js with AURORA_LOGO_OFFSET_Y -31 while the real module says -36 → the suite pins a value the game doesn't use and cannot catch a regression of the real offset/FOV. startup-ident-hold.js:20-21 REPLICA_GLOW copied from the retired scene; playground-parameters documents logo-warp-transition params.
- *Verification (confirmed):* Scene (787) and intro-noise-lib (137) dead; playground effect logo-warp-transition dev-only harness. boot-warp-handoff copy with the mock at the real -36 → 3 fallback-layout tests fail (expected 369, got 364): the suite pins the retired constant. Safe order: tests read the real constant; drop warpFovAt block; delete effect + playground-parameters entries in the same commit (url-parameter-catalog test checks paths); update scripts/playground-phase-capture.mjs default; delete scene + noise lib; fix comments. P3: the real offset drives only the resize fallback.

**A18-DEAD-2 · P3 (reported P2) · fixed (ec77cc5)** — JourneyReturnTransition is a drifted copy of JourneyEntryTransition missing the entry's 2026-10-23 fixes: a hidden window during the return hold still aborts with blackout-timeout  
`src/rendering/transitions/JourneyReturnTransition.js:320`

- *What happens:* ~230 identical lines (7 jscpd clone blocks). Entry's frameAt moves blackoutTriggeredAt forward by frame gaps >1 s (HOLD_PAUSE_GAP_MS; fixed alt-tab 'orb took too long' 2026-10-23, pinned by journey-entry-transition.test.js:179). Return's tick (:320-330) lacks it; updateReadiness (:372-385) aborts 'blackout-timeout' after maxBlackoutHoldMs 7200. onBlackoutReached awaits a board rebuild (~3.5-4.2 s) then waitForAnimationFrames(2), which can't finish while rAF is stopped → hide/minimise during a return (web: tab switch) → abort → _fallbackToBoardAfterReturnAbort ends the journey. Also lacks remaining-hold budget, holdWhileAborting, fadeOutAndTeardown (abort freezes then cuts).
- *Verification (partly):* Drift real (7 clone blocks, 231 lines; no pause-gap rule, no hold budget, no abort hold/fade). Reproduced on the real class: 10 s frame gap with prep pending → 'blackout-timeout' on first frame back; entry control does not abort. Mechanism narrower: waitForAnimationFrames has a 120 ms timer fallback, default return keeps the board resident; abort needs prep still pending (rebuild return, double-rAF warm-ups) in a hidden web-build tab. Electron runs rAF at full rate even minimised (backgroundThrottling:false). Fix: port the HOLD_PAUSE_GAP_MS rule into Return.tick (better: shared helper).

**A18-DEAD-3 · P3 · deferred: Odyssey files (report-only here)** — ADR-0022 leftovers: the chapter 3/4 aurora curtain builder and the Ch2→Ch3 water membrane outlived the retired scenes  
`src/rendering/odyssey/chapter-environments/shared/mountain-aurora.js:100`

- *What happens:* createMountainAuroraBackdrop, resolveMountainAuroraPreviewOpacity, SURFACE_WORLD_AURORA_PREVIEW_* and private helpers (~165 lines TSL) had consumers surface-world.js/mountain-peaks.js (deleted); only MOUNTAIN_AURORA_CURTAIN_CONFIGS is read (OdysseyLayoutEditor.js:36, 713). odyssey-water-surface.tsl.js (289 lines) consumers deleted; only importer is playground effect odyssey-unified-water.
- *Verification (confirmed):* All listed items dead; MOUNTAIN_AURORA_CURTAIN_CONFIGS read only by the DEV-only layout editor. Six live comments cite the water-surface file. Safe now; extend the 'old scenes stay gone' test. No visible change.

**A18-DEAD-4 · P3 · partly fixed (77c0681): dead constants and applyCrowdHandicap removed; the crowd half needs a decision** — Garbage rules that do nothing: GARBAGE_RULES contradicts the live attack formula, and the crowd handicap is computed and serialised but never applied  
`src/core/garbage.js:366`

- *What happens:* constants.js:212 GARBAGE_RULES {1:1,...} ('1:1 pattern') vs live calculateGarbage depth-1 rows; nothing reads it. applyCrowdHandicap has no caller; accumulateHandicapStamps only from local versus (≤4 players) while CROWD_THRESHOLD is 4 → handicapCrowd always 0; online FFA never accumulates. Inert field carried in GameState, demo snapshots and resync sidecar. HANDICAP_LEVELS unused.
- *Verification (confirmed):* GARBAGE_RULES, HANDICAP_LEVELS, applyCrowdHandicap: zero references (safe now). handicapCrowd always 0 (≤4 players; online FFA never uses MultiPlayerState) but carried in the ADR-0014 resync sidecar and demo snapshots: removing it or wiring it for online FFA is an owner decision.
- *Needs an owner decision.*

**A18-DEAD-5 · P3 · fixed (113541f)** — Retired classic-loop and Odyssey-data helpers in core/ui/rendering with zero callers, tests included (~230 lines); levels.js lookups have drifted from LevelRegistry  
`src/core/game.js:1579`

- *What happens:* Leftovers from the retired main.js loop and pre-LevelRegistry Odyssey data access; read as live API; levels.js getChapterStartLevel lacks registry fallback, getPreviousLevel(1) returns undefined vs registry null.
- *Verification (partly):* All dead except getAvailableSongs (asserted by sound-manager-track-initialization.test.js:30/77: test-only). Drift confirmed (getChapterStartLevel fallback; getPreviousLevel(1) undefined vs null). Also InfinityMode.js:1508-1512 boardScene.showScorePopup guard is dead (no scene defines it). Re-run knip after deleting (private helpers may orphan).

**A18-DEAD-6 · P3 · deferred: theme files (report-only here)** — themes/shared/composer-dispose.js is kept alive only by its own test; its one possible consumer (Wolfhour's legacy EffectComposer path) is unreachable  
`src/themes/shared/composer-dispose.js:26`

- *What happens:* No runtime caller; only EffectComposer in src is Wolfhour's legacy path, unreachable because wolfhour always builds a WebGPURenderer (usesNodeMaterials always true). The test guards a helper the game never runs; extra pin for three upgrades.
- *Verification (confirmed):* Only importer is its test; Wolfhour always uses WebGPURenderer; BaseTheme.disposeComposer already does the same loop. Not in ADR-0018's contract-test list. Safe to delete with its test; THREE_UPGRADE_RESEARCH 'helper still required' is stale.

