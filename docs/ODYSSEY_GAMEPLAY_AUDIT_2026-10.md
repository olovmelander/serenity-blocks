# Odyssey orb gameplay audit — 2026-10-07

Scope: gameplay inside each orb, its objectives, board presentation and HUD, and one Beat the Bot variant per chapter. Chapter environments, journey geometry, level IDs, themes, chapter boundaries and the 59-orb route are preserved. This records the user-requested gameplay work; the architectural remediation plan remains the umbrella roadmap.

## Findings and fixes

| Finding | Resulting behavior |
| --- | --- |
| Timed failure ignored board top-out; a delayed goal could win after expiry. | Top-out fails timed levels. Goals strictly after the deadline fail; a goal exactly at the deadline wins the tie. |
| Every orb entered a victory lap despite authored `victoryLapPolicy: 'none'`. | Normal orbs end after their complete cascade settles. The four showcase orbs retain their optional lap and have a clickable Finish button. |
| Higher star tiers required extra primary-goal progress after a no-lap orb should already have ended. | No-lap tiers use the completion target and retain quality gates. Goal-only higher tiers gain time gates. Showcase tiers retain extended targets. |
| Star calculations skipped bonus requirements; no-top-out bonuses always passed. | Stars require the actual earned bonus count. Top-out and duel death counters govern no-top-out bonuses. HUD previews use the same evaluated bonuses. |
| Score evaluation could lag behind a just-finished cascade. | Solo completion reads the live score after physics settles. Match results use the cumulative human score across rounds. |
| Explicit Infinity speed progression could be ignored; Standard mechanics claimed cascades were disabled. | Explicit true/false progression is honored. Rule descriptions reflect the shared Quadra cascade physics actually used by all three base modes. |
| The session fence sat inside metric wrappers. | A retired attempt cannot update even its own old metrics. Duel callbacks additionally belong to one round generation. |
| A two-board drain could exit early when one physics promise rejected. | Both boards settle before replacement, including the rejection path. Retirement stops the bot and prevents a pending round reset. |
| A late cascade could receive credit for a player who had already died. | The attacker is captured at the first death notification and restored before the batch awards frags. Both directions have regressions, including a potential seventh-frag race. |
| Legacy Infinity/hybrid spawning followed the presentation camera, allowing false top-outs after paused exploration. | Both clock policies use the board-derived spawn anchor. The initial window accounts for actual seeded garbage, preserving authored first spawns. Real scene scrolling followed by immediate hard drops and cascades is covered for orbs 39 and 55. |
| Tall-orb minimap clicks read the wrong event field, corrupting the camera; live dragging did not pause gameplay. | Navigation reads a finite `targetRow`, centers and clamps against the real board. Exploration holds gameplay and resumes only its own pause. Retired maps are fenced and listeners removed. |
| A detached result/failure dialog could consume the next mode's first Space press. | Outcome views have idempotent disposal, release capture listeners and focus timers, and ignore detached-view keys. Exact-attempt retirement disposes its view and settles the cancelled outcome promise. |
| Odyssey's authored preview counts expanded the queue beyond the shared three-piece design. | Following the user's clarification, every orb and both duel wells display exactly three upcoming pieces. Legacy authored counts cannot enlarge the queue; the underlying piece bags remain intact. |
| Tiny HUD labels, unclear timer wording, missing line star requirements and stale instructions. | A readable Keystone HUD shows the goal, elapsed/time-left labels, quality tiers, a folded level guide and pause state. Resolved numeric instructions were checked across all 59 orbs. |
| Every bot appeared as "Chapter challenger" and results lost the opponent's identity. | Each chapter authors a distinct bot name. The match retains it across rounds and publishes it with snapshots and results; the goal, opponent plate, scoreboard, accessible board label, level instructions and outcome use that same name. |
| Phone layouts placed the tall-board minimap outside the screen and buried the lap Finish action. | The map fits beside the human well. During a lap, Finish follows the goal in the phone HUD and a compact completion status keeps the piece queue visible. |

## Beat the Bot

| Chapter | Orb | Existing title | Bot name | Bot tier |
| --- | --- | --- | --- | --- |
| 1 | 4 | Molten Flow | Cinder | 1 |
| 2 | 9 | Stillwater Sanctuary | Coral | 2 |
| 3 | 17 | Sakura Twilight | Willow | 3 |
| 4 | 26 | Moonrise Summit | Frost | 4 |
| 5 | 33 | Ethereal Heights | Zephyr | 5 |
| 6 | 44 | Comet Chase | Nova | 6 |
| 7 | 53 | Chromatic Impasto | Prism | 7 |
| 8 | 58 | Electric Nights | Neon | 8 |

Each replaces an existing orb before the chapter finale. Both players have an empty standard 20-row well, identical seeded bags and fixed 1000 ms gravity; the existing bot tiers supply the difficulty progression. No inherited solo speed modifier, opening garbage, timer or victory lap applies to these matches.

The existing `MultiPlayerState` owns attacks, pending garbage, deaths and frag attribution. The real `PuzzleBotController` places pieces through the shared game/physics functions. Garbage arrives before the victim's next piece spawns. A top-out ends the round; it awards a frag to the last attacker, while an unaided self top-out awards no frag. Both boards drain, take a brief intermission and restart together, retaining the match counters. First to seven wins; simultaneous seventh frags produce a draw and offer a retry. One star requires the win, two allow up to three human deaths, and three allow up to one.

The compact opponent well uses the canonical MultiplayerBoardScene to observe the real bot board, with its colored ghost, next queue, garbage meter and shared Phaser effects. The HUD shows both frag scores, the current round and each pending garbage count. Pause holds both boards, the bot scheduler and the intermission; resume reanchors both board clocks. Match success/failure use the campaign's existing progress, result and in-place retry flow. Existing saves retain their progress and unlocked route.

`OdysseyBotMatch` is headless and owns no timer or DOM. The extracted gameplay-loop helper uses Odyssey's existing `FrameRateController` for duels. Bot attempts use the legacy clock as a unit even when the experimental fixed-tick flag is requested; later solo attempts keep the activation's fixed-clock policy and result restrictions. This follows ADR-0012's existing unsupported-variant fallback contract and introduces no new simulation driver.

## Shared board design and effect parity

The follow-up audit found that Odyssey already used BoardScene and SharedEffects, but never enabled their current well styling or the shared responsive solo layout. It therefore retained the older rounded card, gray ghost and board sizing. The opponent was a basic canvas preview, and tall-board theme events did not include the visible effect origin.

| Finding | Resulting behavior |
| --- | --- |
| Odyssey did not opt into the current well presentation. | Every orb uses the shared open-top well, colored landing ghost, slate garbage blocks and viewport-sized board. The three-piece next queue remains outside the well. |
| Duel opponents lacked the canonical board renderer and effects. | A render-only Phaser MultiplayerBoardScene observes the existing bot state. It renders the same pieces and ghost and receives real locks, drops, clears, cascades, attacks, garbage arrivals, knockouts and wins. It never advances gameplay. |
| Tall-board theme effects used world rows without a visible origin. | Lock, clear and hard-drop events include the actual viewport origin and Odyssey source/level context. Presentation camera scrolling does not change simulation anchors. |
| Legacy hard drops applied board motion twice; rejected rotations still moved the well. | Both clock policies use one dip/bounce per hard drop. Only accepted moves and rotations apply the current shared motion tuning. |
| Runtime garbage and duel results were missing visual hooks. | Successfully applied garbage triggers the victim's arrival effect. The first top-out plays one knockout, and credited round/match wins play the shared celebrations. |
| Only the bot had a visual garbage meter; the human well relied on HUD text. | Both duel wells now show a quiet empty track beside the left wall, filling upward from their actual pending attack queues. The shared Local Multiplayer scale is 20 lines, with brighter fill at eight or more. HUD text retains the exact line count. Human meter ownership follows HUD show/hide/destroy, so solo orbs and other modes cannot retain it. |
| Knockout veils and win fireworks could outlive the 900 ms round intermission. | SharedEffects now owns those moments' objects, emitters, timers and tweens. Round cleanup removes them and fences already queued callbacks, preserving unrelated scene work. |
| Quality, reduced motion and covered-board handling were incomplete. | Both wells honor effect quality and reduced motion; the opponent follows the shared frame-rate policy. Pause and the global covering-modal path hold their presentation. Settings listeners, pending renderer boots and obsolete round callbacks are disposed or fenced. |
| Existing phone rules squeezed the well and overlapped the bot in landscape. | Portrait uses a compact bottom goal dock; short landscape uses the side ledger. Desktop, portrait and landscape preserve the piece queue, goal and both duel wells. Tall minimaps follow the human well's size. |

The layout and presentation adapters keep DOM and renderer ownership outside headless gameplay. Round resets clear transient effects while retaining the renderers. Replacement and cancelled renderer preparation are tied to the exact attempt. No chapter shader, world geometry or new simulation driver was introduced.

## Verification

Final checks on 2026-10-07:

- `npm test -- --reporter=dot --maxWorkers=2`: **633 files, 8,082 tests passed**.
- Production build and boot-closure gate, TypeScript check and dependency boundaries passed.
- Lint ratchet passed at 813 existing errors, with no new errors or fatal parse failures.
- Architecture fitness passed including new, untracked modules. OdysseyMode shrank to 4,785 lines and core DOM reads to 432; no ceiling increased.
- Desktop, phone portrait and short-landscape browser checks passed, including actual input, clears, bot placement, round reset, pause/Hub cover, retry and mode-switch cleanup. Final browser console: zero errors or warnings. The temporary server and browser fixture were released.

The later three-preview correction passed 66 focused tests covering the shared queue, Odyssey layouts, HUD/opponent, campaign configuration and level entry, plus production build/boot closure, TypeScript, scoped source lint and whole-worktree architecture checks. Fresh Standard/orb 16 and duel/orb 4 desktop/phone captures in `artifacts/odyssey-three-previews/` verify exactly three visible previews per well, actual hard-drop queue advancement and zero console errors/warnings. Earlier screenshots showing four or five previews reflect the previous revision; current queue rendering always retains exactly three slots.

The garbage-meter follow-up passed 46 focused tests, including four new regressions for real pending queues and round resets, independent counts, HUD visibility, and exact-node cleanup. Production build/boot closure, TypeScript, scoped lint and whole-worktree architecture fitness also passed. Desktop and phone captures in `artifacts/odyssey-garbage-meters/` verify both empty tracks, real queued attacks of four and nine lines, applied garbage draining both counts and fills to zero, hide/show without duplicates, and removal of both meters on switching to Single Player. Each well retains exactly three previews. The final browser console had zero errors or warnings, and the temporary server and browser fixture were released. The focused test log is `artifacts/odyssey-board-parity/garbage-meter-tests.log`.

The named-opponent follow-up passed 71 focused tests covering the campaign, match lifecycle, HUD, level entry, difficulty and outcome views. All eight authored names are checked, including retention through a real round reset, final result and fresh retry. Production build/boot closure, TypeScript, scoped source/test lint and whole-worktree architecture fitness passed. Browser captures in `artifacts/odyssey-bot-names/` verify Cinder and Neon in their real chapter 1 and 8 matches on desktop and phone, plus short landscape. The goal, opponent plate, scoreboard and accessible labels agree with the match snapshot/result; Cinder remains named after a round reset and retry, and switching chapters replaces the displayed name. Named failure/victory screens and mode-switch disposal passed. Both meters and the three-piece queues remain visible. The final browser console had zero errors or warnings, and the temporary server and browser fixture were released. Test logs are `artifacts/odyssey-bot-names-ui-tests.log` and `artifacts/odyssey-board-parity/bot-name-tests.log`.

Meaningful regressions cover all three base modes through real cascading physics; deadline and bonus/star behavior; actual human quad attacks reaching the bot queue; seeded round fairness; both seventh-frag outcomes and draws; retirement and rejected-promise drains; paused intermissions; late-attack attribution; camera-independent spawning after real paused exploration and cascades; minimap pause ownership, invalid events and cleanup; detached outcome keys and exact-attempt view disposal; preview-count changes; one-shot campaign persistence and retry; fixed-clock fallback; and result/HUD contracts. Presentation regressions additionally cover viewport event origins, accepted input motion and one hard-drop impulse under both clocks, live quality/reduced-motion settings, exact-attempt observer boot cancellation, stale visual callback fencing, layout ownership, and disposal of both wells' moments at the actual 900 ms round boundary even without a camera color filter.

Browser evidence is recorded under ignored `artifacts/odyssey-orb-ui/` (initial gameplay/HUD pass) and `artifacts/odyssey-board-parity/` (final shared board/effects pass). Gameplay was prepared directly through the production mode, avoiding a full journey capture on the integrated GPU. The final parity pass used Phaser WebGL at Minimal quality, desktop 1440×900, phone portrait 390×844 and landscape 844×390. Its summary indexes 15 verified screenshots and 15 runtime probes. Captures check Standard/timed/tall orbs, a live bot, pause, match results and retry. The final pass additionally checks short landscape, real keyboard locks/clears, natural bot placement and queue advancement, both scenes' Hub cover, and removal of old knockout/win objects immediately after the production round barrier restarts play. Phone sizes are emulated viewports. Quad/cascade stacks are seeded fixtures with actual input, pooled piece identity and production physics. Match terminal captures use credited-knockout fixtures through the production barrier; they do not represent naturally played complete seven-frag matches. This validates gameplay UI and effect wiring; it makes no new claim about High-quality or chapter GPU performance or changes to world art.

Bot strength rises through tiers 1–8. Subjective difficulty calibration still benefits from human play through the whole campaign; the tests establish the rules and progression rather than a claimed human win rate.
