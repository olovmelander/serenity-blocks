# Handover: local versus bots that play like strong players

24 November 2026, branch `feature/bots-versus`. For whoever works on the bots next. Background: [playbook](VERSUS_PLAYBOOK_2026-11.md) (how strong people play, from decoded recordings), [audit](BOT_VERSUS_AUDIT_2026-11.md) (the bots before this work), [plan and decisions](BOT_VERSUS_PLAN_2026-11.md), [a chain and a full match, drawn](BOT_VERSUS_REPLAY_2026-11.md). A second round on 25 November (Last Standing, the opening, the left wall) is at the end: [round two](#round-two-25-november-2026-last-standing-the-opening-the-left-wall). A third on 26 November (what Stephen's placements price, a search that finishes, the pace held): [round three](#round-three-26-november-2026-stephens-prices-a-search-that-finishes-the-pace-held).

## What changed in the game

| Change | Where |
| --- | --- |
| Versus play: a board is worth the largest clear it has ready and what it has put by on an edge column (rows beside it, roof, parked straights); a clear is worth its rows, more the bigger; the whole plan is chosen at once. All tiers, local versus, standard well, attacks on | `src/core/ai/versus-evaluation.js`, hooks in `gravity-search.js` (`config.versusPlay`) |
| Kill tests: the fewest rows that would block an opponent's next piece, from their spawn columns and what is waiting for them | `rowsToBlockSpawn`, `LocalBotManager.versusOutlook`, `MultiPlayerState.attackOutlook` |
| The match's smallest attacking clear; the hot potato (nothing counts while nobody holds it, a holder counts rows, the rest aim at the holder) | `versusOutlook`, `versusReward` |
| Blind: the more of the stack's surface is hidden, the more often a piece lands a column or a turn off, by tier | `BLIND_SLIP` in `gravity-bot-controller.js` |
| Three- and four-bot rooms share the planning two bots get (2.5 steps a millisecond for experts) | `gravityPlanningRate(count, tier, fairShare)` |
| Towers on an edge column no longer count as "near the roof" | `nearRoof` in `gravity-search.js` |
| Nothing is set down above the spawn rows or above the piece; after three refused inputs a piece falls where it is | `steadyLandings`, `refusals` |
| Tier 10 thinks 158 to 178 ms; ladder levers re-fitted | `local-bot-manager.js` |
| Rows of one attack enter as one solid (a versus rule, for people too) | `joinAttackRows`, ADR-0024 |
| The hot potato's order is drawn from the match seed | `MultiPlayerState.updateHotPotato`, ADR-0025 |

Odyssey rivals, Last Standing and peaceful matches keep the old play: `versusWeights` is null there and no path they take changed. (Round two brought Last Standing over.)

## Results

Tier 10 against the decoded Stephen. Bot: 24 live duels of equals, 350001 and on (unused by any fit). Stephen: three duels, 6,286 pieces.

| | Stephen | Tier 10 now | Tier 10 before |
| --- | ---: | ---: | ---: |
| Pieces a minute (per match) | 80 | 162 (158-168) | 151 |
| Lines a fire | 3.9 | 4.0 | 2.75 |
| Fires of 5+ per 100 pieces | 3.2 | 4.9 | 1.0 |
| Fires of 8+ per 100 | 1.02 | 0.96 | 0.04 |
| 5+ fires from a roofed edge column | 79% | 76% | 15% |
| A straight parked at such a fire | 68% | 62% | - |
| Big waves (four or more rows) per 100 | 1.57 | 1.44 | 0.02 |
| Chain fires (no wave over two rows) per 100 | 1.00 | 1.99 | 0.89 |
| Boards with a straight parked on a roofed shaft | 20% | 17% | 0.5% |
| Rows sent a piece / a line | 0.35 / 0.65 | 0.45 / 0.69 | 0.30 / 0.49 |
| Single lines, share of lines | 12% | 7% | - |
| Two-row clears passed up | 41% | 51% | 32% |
| Pieces from 3+ rows arriving to the next fire, median | 3 | 4 | - |
| Tallest column, mean | 11.5 | 11.4 | 8.4 |

Where it still differs: the first fire of a life comes at piece 12 with about 4 lines, his at piece 25 with 6.6. It passes up more two-row clears than he does, and fires a chain twice as often. Both make it stronger, not more like him.

| Against the old tier 10 (unused seeds) | Result |
| --- | --- |
| 96 five-minute duels, seats swapped | 558 : 114 frags; led 92, lost 1, tied 3; 32 reached seven frags |
| One new among three old, 24 rooms of three | most frags alone in 24 |
| One new among three old, 24 rooms of four | most frags alone in 22 |

Rooms of equals, tier 10, 24 each: duels all reached seven frags in 326 s on average (none of 24 did before in ten minutes), three-player 94 s, four-player 55 s. Speed in those rooms 154-170 and 154-195 a minute while alive. Frags credited 96 to 98% of deaths (69% before in duels).

### Ladder

Free-for-all to seven frags, ten-minute limit, both seat orders, 72 unused seeds (144 games) a pair. Points count a lead at the limit as a win and a tie as half.

| Pair | Higher to 7 | Lower to 7 | Time limit | Frags | Points (95%) |
| --- | ---: | ---: | ---: | --- | --- |
| 10-9 | 97 | 47 | 0 | 871:583 | 67% (59-74) |
| 9-8 | 96 | 46 | 2 | 788:498 | 67% (59-74) |
| 8-7 | 94 | 36 | 14 | 736:392 | 70% (62-77) |
| 7-6 | 74 | 34 | 36 | 698:422 | 66% (58-73) |
| 6-5 | 70 | 34 | 40 | 653:421 | 62% (54-70) |
| 5-4 | 59 | 27 | 58 | 642:377 | 65% (57-72) |
| 4-3 | 49 | 12 | 83 | 610:321 | 71% (63-77) |
| 3-2 | 32 | 11 | 101 | 493:286 | 64% (56-71) |
| 2-1 | 18 | 3 | 123 | 376:233 | 61% (53-69) |

Before: 71, 78, 71, 68, 57, 65, 65, 58, 52%. The seeds were new for this run; earlier runs on other seeds set the levers. Every tier plays the same style; a lower one sees fewer pieces, searches less, errs more and is slower. Against the old tier with the same number, frags over 32 five-minute games each (before the last lever change): tier 9 146:52, 8 120:56, 7 98:29, 6 94:31, 5 82:27, 4 71:25, 3 55:28, 2 46:25, 1 29:29. So tiers 2 to 9 are stronger than before; new 5 sits between old 6 and 7, and new 8 is level with old 9.

### Other modes (tier 10, 16 rooms each)

| Mode | Decided in ten minutes | Rows arriving a piece, now (before) |
| --- | ---: | ---: |
| Smallest attack 3 / 4 / 5 | 16 / 16 / 16 (0 before) | 0.41 / 0.37 / 0.31 (0.21 / 0.07 / 0.02) |
| Hot potato, two players | 0 of 16 (0 before), 105 frags | 0.11 (0.10) |
| Hot potato, four players | 15 of 16, mean 454 s | 0.12 (0.07) |
| Blind, two players | 0 of 16, 5 frags; nothing arrives as rows | - |
| Blind, three players | 0 of 16 | - |

Blind is a slip, not a memory model: rows a piece do not measure it. It is the part most worth a person's eye.

### Cost and safety

- Planning, real game in headless Chrome (30 fps target, machine otherwise idle), per animation frame: 0.13 ms mean and 2.0 ms at 99% in a duel of tier 10s; 0.15 and 2.2 ms with four. Before, on the same machine headless only: 0.12 ms mean per tick.
- Nine of nine campaign gates, 280 of 280 rival games and 4,500 of 4,500 campaign attempts identical to before this work, on commit `0568fe096`. (A first run had one attempt differ: an innocent regrouping of a floating-point sum in the old path. The sum order is now kept, with a comment.) After that commit only the ladder levers in `local-bot-manager.js` changed, which Odyssey does not use.
- Our insertion of attack rows reproduces 2,138 of 2,138 recorded rises.
- The unit suite passes (28,157 tests) except `local-versus-cameras` "watches a clear out of sight until its cascade settles", which passes alone and fails the same way in a full run on clean main `adfe5199e` on this machine. Types, lint ratchet, architecture fitness, boundaries, build and the other CI gates pass.

## How to repeat and re-fit

Attacks to play against are recorded and kept outside the repo: set `VERSUS_ATTACKS` to the file.

- `node reports/bots-versus-2026-11/style-run.mjs <first seed> <count> '{"pieces":300,"versusWeights":{...}}'`: how one board plays, in the playbook's terms, and how far from its targets.
- `FIT_DEATH=18 FIT_CAP=0.33 node reports/bots-versus-2026-11/fit.mjs out.jsonl 50 30 30 start.json`: the weights. It scores rows sent and survival against the recorded attacks up to a cap, then closeness to the player's numbers. 25 to 30 s a generation on 30 workers. Check candidates on seeds the fit never saw; the fit's own seeds are not a measure.
- `record.mjs`, `tables.mjs`, `ladder.mjs`: rooms, pooled tables, ladder. Seat overrides (last argument) test one seat: `'{"1":{"versusWeights":null}}'` is the old bot.
- `seeded-rooms.mjs check`: 13 seeded rooms. `write` after a change that is meant.
- `replay-fire.mjs`, `match-log.mjs`: draw a build and log a match.

Traps met here: sums in the old search path must keep their order; a slow seat plus an edge tower can aim above the spawn rows forever (fixed, with a test); a fit that rewards survival alone stands low and fires small; a bot that scores potential by size and reward by rows never fires when only rows count (the hot potato's holder).

## Open

1. **Five-person playtest.** These are different bots; the playtest should be on them. Tiers 2 to 9 are stronger than their old numbers.
2. **Whole-display stalls.** Planning grew by about two times in a duel and four in a four-bot room, still small on this machine. Not measured on a slow one, and not in Electron: this pass used a browser, not the desktop app.
3. **Blind** is a first version. **Hot potato** duels still end at the time limit.
4. The opener and the share of two-row clears passed up (above).
5. Parts of a cut body that touch again stay apart in the recordings and join in ours (one board in 625 placements). Left alone: Odyssey and the puzzles use the same gravity.
6. The numbers of ADR-0025 (blind times, potato targets) and the 20-row limit are still from the source reading (plan, decision 5).
7. BuK's solo recording and the four 1999 demos are not decoded (raw keys; no garbage holes).

## Round two, 25 November 2026: Last Standing, the opening, the left wall

Branch `feature/bots-stephen`. Three changes to the play, and a new measure: how often the bot puts a piece on exactly the cells a recorded player chose, from the same board, piece, next three pieces and waiting rows.

| Change | Where |
| --- | --- |
| Last Standing (Infinity wells) plays the versus evaluation at every tier. The roof of the well is the danger instead of the spawn rows; the kill test counts the rows that would lift a tower through the roof; a clear is held back only while the roof is far | `rowsToRoof`, `roofRows` in `versusValue` and `versusCalm`, `LocalBotManager.playsVersus` and `versusOutlook` |
| Last Standing seats keep the local ladder's hands. Tier 10 reads a new piece in 136 to 156 ms there (158 to 178 in the standard well), to hold 150 pieces a minute in rooms of equals | `LAST_STANDING_EXPERT_REACTION_MS` in `local-bot-manager.js` |
| The opening: until a life's first fire of five lines or more, a clear under six lines costs extra. It ends after 34 pieces, or when the spawn columns and the waiting rows pass 13 | `versusOpening`, `opener` in `VERSUS_WEIGHTS`, `life` in `gravity-bot-controller.js` |
| The left wall: a shelf on the right wall counts 0.45 of one on the left | `right` in `VERSUS_WEIGHTS` |

The other weights are round one's. Peaceful Infinity matches and Odyssey rivals keep the older play.

### Results

Same cells as the recorded player, tier 10 without mistakes or slips:

| Positions | Now | Round one's weights | The old play |
| --- | ---: | ---: | ---: |
| Stephen, all 8,454 | 42.2% | 42.4% | 33.5% |
| Stephen, his clears of two or more (857) | 58.0% | 60.4% | 72.1% |
| The other players, 11,442 | 42.8% | - | - |

The agreement did not move in this round. A fit with the agreement in its score (three runs, 13 to 30 generations) did worse on his unseen games than round one's weights (43.5 to 43.8% against 44.8% on about 2,700 unseen positions), and it lost fire size. Twelve changes of one or two weights all landed within 0.2 points of the start. From his own boards (4,227 positions of three games) he clears on 17.7% of pieces and the bot on 11.6%: it builds where he takes a small clear (313 positions, against 95 the other way). That gap is in what the evaluation sees, not in its weights.

| | Stephen | Now | Round one |
| --- | ---: | ---: | ---: |
| First fire of a life: lines, at piece (solo runs against recorded attacks) | 6.6 at 25 | 5.8 at 17 | 4.6 at 12 |
| Open column of a 5+ fire, left wall / right wall (solo runs, left of the two) | 86% | 83% | 71% |
| The same in the 96 live duels below, left / right | 67% / 11% | 52% / 29% | 47% / 35% |
| Pieces a minute, 24 live duels of equals | 80 | 161 | 162 |
| Lines a fire, live duels | 3.9 | 3.8 | 4.0 |
| Rows sent a piece / a line | 0.35 / 0.65 | 0.45 / 0.68 | 0.45 / 0.69 |

Against round one's weights, same seeds, seats swapped: 96 five-minute duels, frags 475 : 421, led 45, lost 35, tied 16. One new among three, 24 rooms of four: 118 frags against 93 a seat. Level, within the noise.

Rooms of equals, tier 10, 24 each (seeds 402001 and on): duels all reached seven frags, 351 s on average, 161 pieces a minute; three players 82 s, 168 a minute; four players 54 s, 176 a minute.

Ladder, standard well, 128 games a pair (seeds 403001 and on, both seat orders), no lever changed:

| Pair | Higher to 7 | Lower to 7 | Time limit | Frags | Points (95%) |
| --- | ---: | ---: | ---: | --- | --- |
| 10-9 | 92 | 36 | 0 | 796:499 | 72% (64-79) |
| 9-8 | 88 | 39 | 1 | 712:448 | 69% (60-76) |
| 8-7 | 89 | 25 | 14 | 700:293 | 74% (66-81) |
| 7-6 | 69 | 29 | 30 | 627:359 | 68% (59-75) |
| 6-5 | 61 | 33 | 34 | 592:377 | 66% (58-74) |
| 5-4 | 59 | 24 | 45 | 588:325 | 67% (59-75) |
| 4-3 | 49 | 9 | 70 | 556:292 | 67% (58-74) |
| 3-2 | 32 | 5 | 91 | 454:244 | 60% (51-68) |
| 2-1 | 16 | 2 | 110 | 368:164 | 68% (59-75) |

### Last Standing

Tier 10 against the tier 10 that shipped (older planner, its pace), 60-row well, seats swapped: the new seat was last standing in 24 of 24, 50 s on average.

| | New tier 10 | Shipped tier 10 |
| --- | ---: | ---: |
| Pieces a minute in a room of equals (against the other) | 155-158 (195) | 110-111 (112) |
| Rows sent a piece, room of equals | 0.54-0.57 | 0.21 |
| Fires of 5+ per 100 pieces | 5.0-5.6 | 1.0 |
| 5+ fires from a roofed edge column | 60-80% | 38-47% |
| Inputs refused per 100 pieces | 0 | 0 |

Ladder, 60-row well, ten-minute limit, 24 games a pair, both seat orders:

| Pair | Higher last standing | Lower | Undecided | Points | Mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10-9 | 22 | 1 | 1 | 94% | 219 s |
| 9-8 | 19 | 4 | 1 | 81% | 196 s |
| 8-7 | 16 | 4 | 4 | 75% | 237 s |
| 7-6 | 11 | 6 | 7 | 60% | 352 s |
| 6-5 | 15 | 5 | 4 | 71% | 307 s |
| 5-4 | 14 | 8 | 2 | 63% | 311 s |
| 4-3 | 13 | 9 | 2 | 58% | 356 s |
| 3-2 | 15 | 8 | 1 | 65% | 330 s |
| 2-1 | 12 | 10 | 2 | 54% | 350 s |

Rooms of equals in the default 100-row well, six each:

| Room | Now | Shipped |
| --- | --- | --- |
| Two tier 10 | 4 of 6 decided in ten minutes, 489 s | 6 of 6, 166 s |
| Three tier 10 | 114 s (46-243) | - |
| Four tier 10 | 36 s (27-49) | 99 s (72-134) |
| Four tier 7 | 240 s | - |
| Two tier 5 | 4 of 6 decided, 427 s | - |
| Four tier 3 | 278 s | - |

A duel of tier 10s lasts longer than before, because both clear what arrives. A room of four ends in about a third of the time: every seat sends to the three others, and each takes in about 140 rows in half a minute.

### Cost and safety

- Planning in the real game (headless Chrome, machine otherwise idle), per animation frame: a Last Standing duel of tier 10s 0.23 ms mean and 1.2 ms at 99%; four tier 10s 0.45 ms and 3.6 ms, 34 ms the longest frame. The standard well in the same run: 0.15 and 2.1 ms in a duel, 0.15 and 2.2 ms with four.
- In the simulator (idle machine) four tier 10s in Last Standing cost 0.7 to 1.8 ms a step on average and 6 to 15 ms at 99%; the play that shipped cost 1.3 to 2.2 and 13 to 25 ms. A duel: 0.6 to 0.7 and 4 to 5 ms, against 0.7 to 0.8 and 10 ms.
- Real game, both modes, 40 s a room: no console errors from the game (headless Chrome refuses to autoplay music, and the game notes that Last Standing runs on the legacy clock). Tier 10 placed 164 to 173 pieces a minute in standard rooms and 164 to 168 in a Last Standing duel.
- 280 of 280 rival games and 4,500 of 4,500 campaign attempts identical to the run kept from before round one. The run was on `7a60df3ea` with the final weights in place; Odyssey does not read the versus weights. The nine campaign gates were not run again: their input is the same.
- The unit suite passes (28,142 tests) except `local-versus-cameras` "watches a clear out of sight until its cascade settles", which passes alone and fails the same way in a full run on clean main (round one, above). A first full run, made while the campaign run and the rooms loaded the machine, also timed out in four files that have nothing to do with bots (`breath-safety-gate`, `capture-process-cleanup`, `display-settings-apply`, `theme-registry-lifecycle-acceptance`); they pass alone and in the second full run.
- Types, the TS ratchet, the lint ratchet, architecture fitness, theme lifecycle, boundaries, performance budgets, release gates, IP strings and the build pass.
- Sixteen seeded rooms (`seeded-rooms.mjs`), three of them Last Standing, replay the same twice.

### How to repeat

The recorded positions are kept outside the repo: set `VERSUS_POSITIONS` to the file.

- `node reports/bots-versus-2026-11/agree.mjs <name> [tier] [limit] ['{"versusWeights":{...}}' | old | -] [game pattern]`: agreement with one player. Import it only from a file whose name does not end in `agree.mjs`, or its command line runs.
- `node reports/bots-versus-2026-11/infinity-rooms.mjs <out.jsonl> <first seed> <count> <seconds> <well rows> <tiers> [seat overrides]` and `infinity-tables.mjs <dir>`: Last Standing rooms and their tables. `'{"1":{"shipped":true}}'` is tier 10 as it shipped.
- `fit.mjs` now takes the agreement into its score (`FIT_AGREE`, 1.5 by default; 0 leaves it out). One candidate sees 1,200 positions a generation, which is too few to tell one point of agreement.

### Open after round two

1. **The left wall in live duels** is at 52 to 55% against his 67%. Dropping the right shelf to 0.12, and counting a ready clear on the right wall for less, both left it there (53 to 56%). Rows arriving decide where the open column ends up more than the shelf's worth does.
2. **The opening** is at 5.8 lines by piece 17 against his 6.6 by piece 25. It costs under heavy early pressure: against recorded attacks at 0.75 rows a piece, 24.8 deaths per 1,000 pieces against 20.4 without it.
3. **Small clears.** He takes them where the bot builds (above). The next gain in agreement is there.
4. **Four tier 10s in Last Standing** finish a 100-row well in about 36 s. Worth a person's eye: is the top tier too much in a full room?
5. **Tier 10's speed in Last Standing** is 155 to 158 a minute among equals and 195 against a seat that sends little.
6. Lower tiers show the left wall less (tier 4: 38% left, 41% right).

Items 1, 3, 4, 5 and 6 moved in round three, below.

## Round three, 26 November 2026: Stephen's prices, a search that finishes, the pace held

Branch `feature/bots-stephen-3`. The owner asked for the bots to keep being audited and improved toward the best possible play, Stephen's way, in the standard well and in Last Standing.

### What his placements price

Every legal placement of the piece in each of his 8,454 recorded positions was scored two ways by the bot itself: the value of the board right after it (versusValue plus versusReward), and the best its four-piece search finds from it. A conditional logit then asked what picks his placement, held out by game (nine games, each left out in turn).

| What picks the placement | Same cells as Stephen, unseen games |
| --- | ---: |
| The bot as it played (round two) | 42.2% |
| The bot's value of the board after the piece | 44.8% |
| The bot's four-piece search | 31.1% |
| Both | 45.6% |
| Both, with each part of the value priced afresh and the new measures below | 48.4% |
| The same and the search | 49.6% |
| The other players, the last two lines' model without the search | 55.0% (48.7% the value alone) |

His prices, in the bot's own points (the value's weight on each part, against round two's):

| Part | Round two | Stephen |
| --- | ---: | ---: |
| A row sent / its square | 40 / 28 | 191 / 13 |
| A single, a clear of two or three | charged 5, 2.5 | paid 182, 83 |
| A small clear on a calm board | charged 7.8 a line short of five | paid 170 |
| The opening (each line short of six) | charged 300 | charged 81 |
| Bumpiness / height of the spawn columns | 12.5 / 5 | 44 / 23 |
| A cell on the board | +0.28 | -18 |
| A change between filled and empty, down a column / along a row | - | -138 / -28 |
| Each row the right wall's column stands below its neighbours | - | -77 |
| An inner column three or more below both neighbours | - | -82 |
| A clear of one to four, each line per garbage row on the board | - | +25 |

He keeps a lower, smoother, cleaner board than the bot, takes small clears freely, above all with garbage in the well, and keeps the right wall full. The search finds what a price pays for four pieces deep: the board and ready-row parts at a quarter of his price lowered agreement (39.5%, 40.1%), and the surface at his full price cost fire size and lost (below). Every term went in at a quarter of his price.

### What changed

| Change | Where |
| --- | --- |
| The surface: column and row transitions, deep inner wells, a well on the right wall, a quarter of his price | `colTrans`, `rowTrans`, `wellsMid`, `wellRight` in `VERSUS_WEIGHTS`, `surface()` |
| The clears in the standard well, a quarter of his price: more for a row sent, a little less for a very big fire, singles and small clears paid (more with garbage on the board), the opening shorter | `attack`, `attackSquare`, `single`, `small`, `patience`, `opener`, `big`, `clearGarbage`, `clearHigh`; `versusContext` |
| Last Standing keeps round two's prices for clears: "calm" there is the roof's distance, nearly always far, and paying for small clears on a calm board bought singles all game (two tier 10s sent 0.09 rows a piece) | `LAST_STANDING_VERSUS_WEIGHTS`, `LocalBotManager` |
| The ready-clear test skips a settle that cannot beat the best found: blocks keep their columns as they fall, so a clear takes at most as many lines as the emptiest column then has cells. The same choices (every agreement count identical on 2,114 positions), about a third of the time a planning unit on standard boards | `versusValue` |
| Versus seats plan with twice the share they had, and at 0.7 units a ms near the roof (0.35). Last Standing rooms of three or four bots keep the older share: their tall towers make every settle dear | `VERSUS_PLANNING`, `VERSUS_ROOF_PLANNING`, `gravityPlanningRate`, `roofPlanningRate` |
| Tier 10 sets pieces down at most 171 times a minute on average (three quicker pieces in a row allowed), in every room and both wells. It reads a piece in 150 to 170 ms in the standard well (158 to 178) and 126 to 146 ms in Last Standing (136 to 156) | `minDropIntervalMs`, `PACE_BURST`, `TOP_TIER_MIN_DROP_MS`, `EXPERT_REACTION_MS`, `LAST_STANDING_EXPERT_REACTION_MS` |

Odyssey rivals and peaceful matches keep their play: they do not read the versus weights, and their planning rates are unchanged.

### Results

Against round two's bot (its weights, its planning share and near-roof rate; both seats on the same hands and pace limit), fresh seeds, seats swapped:

| | New | Round two | Undecided or tied |
| --- | ---: | ---: | ---: |
| Standard well, 192 five-minute duels: games led | 181 | 7 | 4 tied (95.3% of the points; frags 677 : 129) |
| Last Standing, 48 duels, 60-row well, ten minutes: last standing | 24 | 0 | 24 |

How it got there (96 duels each unless noted; each line against the line it builds on):

| Step | Points |
| --- | ---: |
| Surface at 0.15 / 0.25 / 0.35 / 0.5 / 1 of his price, against round two | 47.9 / 67.2 / 60.9 / 50.0 / 43.2% |
| Surface at 0.25, 192 fresh duels | 56.5% (frags 794 : 672) |
| Twice the planning, round two's weights | 72.9% |
| Surface 0.25, twice the planning, near-roof 0.7 / no near-roof cut / three times and 1.05 | 89.6 / 89.6 / 94.3% |
| Clears at 0.25 against that bot, 192 fresh duels / at 0.5 | 72.4% (frags 323 : 176) / 58.9% |

Same cells as the recorded player, all positions:

| | Round two | Now | Planning as a duel seat does |
| --- | ---: | ---: | ---: |
| Stephen, 8,454 | 42.2% | 43.9% | 43.7% |
| Stephen's clears of two or more (857) | 58.0% | 66.6% | 63.7% |
| The other players, 11,442 | 42.8% | - | 43.7% |

The left wall, open column of a 5+ fire (left of the two walls): duels of tier 10s 66% left, 11% right (85%; Stephen's live duels 67%, 11%; round two 52%, 29%); rooms of four 42%, 28%; tier 4 56%, 14% (round two 38%, 41%).

Ladder, standard well, 48 games a pair (seeds 590001 and on, both seat orders), ten-minute limit:

| Pair | Higher to 7 | Lower to 7 | Time limit | Frags | Points (95%) |
| --- | ---: | ---: | ---: | --- | --- |
| 10-9 | 2 | 0 | 46 | 85:16 | 69% (55-80) |
| 9-8 | 7 | 1 | 40 | 114:41 | 71% (57-82) |
| 8-7 | 8 | 0 | 40 | 129:32 | 70% (56-81) |
| 7-6 | 0 | 0 | 48 | 86:51 | 62% (47-74) |
| 6-5 | 3 | 0 | 45 | 126:70 | 56% (42-69) |
| 5-4 | 6 | 2 | 40 | 154:80 | 66% (51-77) |
| 4-3 | 11 | 0 | 37 | 152:75 | 59% (45-72) |
| 3-2 | 3 | 0 | 45 | 112:76 | 56% (42-69) |
| 2-1 | 3 | 0 | 45 | 122:63 | 62% (47-74) |

Ladder, Last Standing, 60-row well, 16 games a pair (higher last standing / lower / undecided): 10-9 2/0/14, 9-8 9/2/5, 8-7 12/1/3, 7-6 8/5/3, 6-5 7/4/5, 5-4 8/2/6, 4-3 8/2/6, 3-2 7/5/4, 2-1 7/5/4.

Rooms of equal tier 10s:

| Room | Pieces a minute (seats) | Length | Round two |
| --- | --- | --- | --- |
| Standard, two (12 games) | 158 (153-162) | none to seven in 300 s | 161, 351 s to seven |
| Standard, three | 156 (144-167) | 96 s | 168, 82 s |
| Standard, four | 163 (142-173) | 54 s | 176, 54 s |
| Last Standing, two, 100 rows (6) | 153-155 | none decided in ten minutes | 155-158, 4 of 6 decided |
| Last Standing, four, 100 rows (6) | 146-157 | 33 to 600 s | 36 s |

Duels of the new bots are calmer: between tier 10s a player dies about every 3.8 minutes (Stephen's recorded duels: every 2.2), and most ladder games reach the ten-minute limit.

### Cost and safety

- A planning unit on recorded duel boards: 37.5 µs before, 13.7 µs after the settle skip; its slowest 21.7 ms before, 1.45 ms after (busy machine; same units).
- The real game in headless Chrome, 30 fps, 40 s a room, planning per animation frame mean / 99% / longest: standard duel 0.12 / 2.2 / 17.5 ms; standard four 0.23 / 4.2 / 13.2; Last Standing duel 0.28 / 2.1 / 6.7; Last Standing four 0.38 / 3.1 / 7.6 (round two: 0.15 / 2.1, 0.15 / 2.2, 0.23 / 1.2, 0.45 / 3.6 / 34). Console: only headless Chrome refusing to autoplay music and Last Standing's note that it runs on the legacy clock.
- The simulator, per game tick, mean / 99%: standard duel 0.24 / 1.28 ms before, 0.26 / 1.86 after; four 0.30 / 1.23, 0.48 / 2.13; the Last Standing four at its kept share 0.98 / 5.95 against 0.83 / 5.58. Doubled, that room went to 1.50 / 11.4 (37 ms longest), which is why it keeps the older share.
- Sixteen seeded rooms rewritten (`seeded-rooms.mjs write`) and replayed the same in two other processes.
- Odyssey: 280 of 280 rival games end as stored, on the final code; 4,500 of 4,500 campaign attempts identical to round two's run, field by field (run on the first commit of the round; the second changes nothing Odyssey reads).
- The unit suite: 28,808 passed. Four files failed in the full run and pass alone: `display-settings-apply`, `capture-process-cleanup` and `protocol-wire-source-contract` timed out while the Odyssey campaign ran beside the suite; `local-versus-cameras` fails the same way on clean main in full runs (round one). Types, the TS ratchet, the lint ratchet (at its baseline), architecture fitness, theme lifecycle, boundaries, performance budgets, release gates, IP strings and the build pass.

### What did not work

- His prices at full strength through the search: the board and ready-row parts lowered agreement (39.5%, 40.1% at a quarter); the surface at full price lost the duels (43.2%) with smaller fires.
- The shelf's own column left out of the transitions: 3.1% and 13.0% of the points. Its roof then hides whatever is dumped under it.
- The clears in Last Standing (above).
- Eight quicker pieces allowed instead of three: Last Standing did not speed up (its pace is clear time), and single seats in rooms of four reached 185 a minute.
- A trap: the board context first shared its name with the reward context inside the search loop, so every run with the garbage and height clear terms read the wrong object; those runs were thrown away and measured again. The lint ratchet caught it.

### How to repeat

The study and the run scripts are kept outside the repo with the recordings (round3 in the private folder); they read `VERSUS_POSITIONS`. In the repo: `AGREE_DUEL=1 node reports/bots-versus-2026-11/agree.mjs stephen` plans as a duel seat does; record.mjs and infinity-rooms.mjs take a seat's `units` (times its planning share) and `roofRate`; infinity-rooms.mjs takes `@file`.

### Open after round three

1. **Last Standing 10-9** is flat in a 60-row well: tier 10 finished tier 9 in 2 of 16 games within ten minutes, 14 undecided (round two: 22 of 24). Tier 9 got the same doubled planning.
2. **Calmer duels.** Fewer deaths than Stephen's games and most ladder games run to the limit. Worth a person's eye: does a duel of tier 10s feel too long?
3. **Three times the planning** gained about five more points over twice; the real game's standard four would then plan about 6 ms at 99%.
4. **Agreement** is 43.9%; a one-piece model reaches 48 to 50% on unseen games. The gap is the search applying one-piece prices four pieces deep: the next step is a fit through the search, not more weight sweeps.
5. **Last Standing rooms of three or four bots** plan at the older share; an exact skip that works on tall towers would let them have more.
6. **Pace.** Room means 156 to 163 (standard) and 146 to 157 (Last Standing four, whose short games are mostly clearing); single seats in crowded rooms 142 to 173.
7. The opening was not measured again (`opener` 300 to 245 in the standard well). Nothing here has been played by a person.
