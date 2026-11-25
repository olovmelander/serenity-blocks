# Handover: local versus bots that play like strong players

24 November 2026, branch `feature/bots-versus`. For whoever works on the bots next. Background: [playbook](VERSUS_PLAYBOOK_2026-11.md) (how strong people play, from decoded recordings), [audit](BOT_VERSUS_AUDIT_2026-11.md) (the bots before this work), [plan and decisions](BOT_VERSUS_PLAN_2026-11.md), [a chain and a full match, drawn](BOT_VERSUS_REPLAY_2026-11.md). A second round on 25 November (Last Standing, the opening, the left wall) is at the end: [round two](#round-two-25-november-2026-last-standing-the-opening-the-left-wall).

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
