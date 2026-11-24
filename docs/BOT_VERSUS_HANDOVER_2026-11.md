# Handover: local versus bots that play like strong players

24 November 2026, branch `feature/bots-versus`. For whoever works on the bots next. Background: [playbook](VERSUS_PLAYBOOK_2026-11.md) (how strong people play, from decoded recordings), [audit](BOT_VERSUS_AUDIT_2026-11.md) (the bots before this work), [plan and decisions](BOT_VERSUS_PLAN_2026-11.md), [a chain and a full match, drawn](BOT_VERSUS_REPLAY_2026-11.md).

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

Odyssey rivals, Last Standing and peaceful matches keep the old play: `versusWeights` is null there and no path they take changed.

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
