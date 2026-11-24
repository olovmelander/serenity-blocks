# Bots in the new versus: what was measured

Measured 24 November 2026 on `feature/bots-versus` (game code as on main `adfe5199e`). The players in the comparison are the ten decoded recordings described in [the playbook](VERSUS_PLAYBOOK_2026-11.md). The plan that follows from this is [BOT_VERSUS_PLAN_2026-11](BOT_VERSUS_PLAN_2026-11.md).

## In short

1. **The versus merge broke nothing in the campaign.** All nine gates pass. 280 of 280 rival games and 4,500 of 4,500 campaign attempts are identical before and after it.
2. **The new rules did not make the bots play worse per piece.** Tier 10 sent 0.299 rows a piece under the old rules and 0.301 under the new. Rounds are 8 to 31% shorter.
3. **The bots play a different game from strong people.** Tier 10 places 151 pieces a minute against Stephen's 80, but its average fire is 2.75 lines against 3.9. A wave of four or more rows, which is what the parked straights make, comes 0.02 times per 100 pieces against his 1.57. The shelf release is almost absent from bot versus.
4. **Three- and four-bot rooms are starved of planning.** Four experts get 27 planning steps a piece each, two get 212. With no rows arriving at all, an expert in a four-bot room still dies every 272 pieces.
5. **Free-for-all between equals drags.** None of 24 tier 10 duels reached seven frags in ten minutes. 31% of those deaths gave nobody a frag.
6. **Bots do not know four of the rules**: the smallest attacking clear, blind, full blind, and whose hot potato it is.
7. **The way in is the evaluation, not more computing.** Forty times the search with today's evaluation gives 0.37 rows a piece. A throwaway evaluation that counts lines, inside today's budget, gives 0.43 and beat today's tier 10 by 566 frags to 52 over 96 five-minute games.

## 1. Safety check

| Check | Result |
| --- | --- |
| Campaign gates on current code, 4,500 attempts | 9 of 9 pass |
| Same 4,500 attempts, current code against the commit before the versus merge (`81e65939e`) | 4,500 identical |
| 280 Odyssey rival games against their stored outcomes, on both commits | 280 and 280 match |
| Solo expert, 64 bags of 120 pieces | 355.8 points a piece on both commits, identical seed for seed |

The pinned campaign instrument carries its own copy of the rules and cannot see a change in shared code, so the comparison plays both commits on the same seeds instead.

## 2. The measuring tools

They built their own matches and kept the old rules. `reports/gravity-bot-rebuild/shipped-versus.mjs` now gives them the rules the game ships, and `SERENITY_BOT_RULES=pre-versus` keeps the old ones. Sixteen duels under `pre-versus` equal the untouched tools byte for byte.

`reports/bots-versus-2026-11/` holds the new ones: `record.mjs` (rooms, measured lock by lock), `tables.mjs`, `ladder.mjs`, their output in `tables.txt`, and `seeded-rooms.mjs` (13 seeded rooms, 7,527 locks, repeated exactly three times).

Which old seeded replays broke: the 40 openings are unchanged under the old rules (40 of 40 the same clears), and produce different pieces under the shipped rules, because pieces are no longer dealt from bags. The stored ladder and duel records are of the old rules and cannot be replayed under the new ones. The hot potato picks its holder with unseeded randomness in the game itself, so a local hot potato match cannot be replayed; the tool seeds it.

## 3. Old rules against new

One round, last one standing, five-minute limit, 24 seeds in both seat orders. A round nobody loses counts half.

| Pair | Old rules: points, time limit, length | New rules: points, time limit, length |
| --- | --- | --- |
| 10-9 | 72.9% (59-83), 4, 119 s | 64.6% (50-77), 0, 85 s |
| 9-8 | 65.6% (51-77), 3, 105 s | 76.0% (62-86), 1, 72 s |
| 8-7 | 68.8% (55-80), 6, 121 s | 71.9% (58-83), 3, 96 s |
| 7-6 | 51.0% (37-65), 3, 128 s | 64.6% (50-77), 2, 111 s |
| 6-5 | 61.5% (47-74), 3, 129 s | 63.5% (49-76), 1, 102 s |
| 5-4 | 54.2% (40-67), 2, 118 s | 52.1% (38-66), 0, 91 s |
| 4-3 | 60.4% (46-73), 2, 129 s | 57.3% (43-70), 1, 102 s |
| 3-2 | 54.2% (40-67), 0, 128 s | 67.7% (54-79), 1, 118 s |
| 2-1 | 57.3% (43-70), 1, 131 s | 45.8% (33-60), 0, 120 s |

With 48 games a pair the intervals of the two rule sets overlap for every pair.

The shipped default, free-for-all to seven frags with a ten-minute limit, 24 seeds in both seat orders:

| Pair | Higher first to 7 | Lower first | Time limit | Frags | Points (95%) |
| --- | ---: | ---: | ---: | --- | --- |
| 10-9 | 11 | 1 | 36 | 181:84 | 70.8% (57-82) |
| 9-8 | 23 | 1 | 24 | 231:66 | 78.1% (65-87) |
| 8-7 | 22 | 3 | 23 | 192:62 | 70.8% (57-82) |
| 7-6 | 11 | 1 | 36 | 146:74 | 67.7% (54-79) |
| 6-5 | 11 | 1 | 36 | 136:82 | 57.3% (43-70) |
| 5-4 | 3 | 1 | 44 | 133:70 | 64.6% (50-77) |
| 4-3 | 5 | 0 | 43 | 120:54 | 64.6% (50-77) |
| 3-2 | 0 | 0 | 48 | 83:56 | 58.3% (44-71) |
| 2-1 | 0 | 1 | 47 | 73:67 | 52.1% (38-66) |

Points count a lead at the time limit as a win and a tie as half. The baselines at seven frags were 60.4, 68.8, 76.0 and 65.1% for 7-6 to 10-9 on the old rules, in rounds without a time limit of this kind, so only the order compares: 9-8 is still the steepest step. The bottom is nearly flat.

## 4. What the old death rule does to them

Tiers 8 to 10 hold a "finishing shot" (rows that would lift the opponent's tallest column past the top) and a "panic" (waiting rows that would lift their own). Neither is how anyone dies now. Counted in 72 equal-tier duels of tiers 8, 9 and 10:

| | Plans | What followed |
| --- | ---: | --- |
| Plans whose attack met the finishing condition | 589 | the opponent died within three seconds in 394 (67%); 195 (33%) did not |
| Panic plans | 384 | the bot died within a second and a half in 268 (70%); 116 (30%) survived a rise the rule called fatal |

They are rare: one finishing shot per 285 pieces and one panic per 437. In rooms of three or more the finishing shot is never used, so an expert in a crowd does not know when an opponent can be finished.

In all, 31% of tier 10's deaths in duels gave nobody a frag (49 of 158), because the last attack's credit had run out. These are bots that buried themselves.

## 5. Random deals, tucks, inputs, openings

| | Old rules | New rules |
| --- | --- | --- |
| Four-wave opening within 16 pieces, 40 seeds | 16 (baseline 16) | 9 |
| Rejected inputs, tier 10 | 0 in 14,362 locks | 0 in 10,345 locks |
| Rejected inputs, tier 7 | 6 in 5,879 locks | 26 in 4,869 locks |
| Landings a straight drop cannot reach, tier 10 | 0.63 per 100 | 0.68 per 100 |

People tuck 0.4% of their pieces. Gravity locking costs the top tiers nothing. Random deals nearly halve the long openings, as a bag no longer promises every shape.

Speed: tier 10 places 151 pieces a minute in a duel and 166 to 171 in three- and four-bot rooms, measured headless with the game's own clock. The native 172 and 167 to 169 were measured before and need a display to repeat.

## 6. Rooms of two, three and four

Equal experts, free-for-all to seven frags, ten-minute limit, 24 rooms each:

| | Two | Three | Four |
| --- | ---: | ---: | ---: |
| Reached seven frags | 0 | 24 | 24 |
| Mean length | 600 s | 183 s | 91 s |
| Pieces a minute | 151 | 166 | 169 |
| Rows sent per piece | 0.30 | 0.19 | 0.17 |
| Rows in per minute | 44 | 58 | 80 |
| Deaths a minute per player | 0.33 | 2.13 | 3.34 |
| Deaths that gave nobody a frag | 31% | 18% | 16% |
| Rows sent that never entered a board | 1% | 6% | 9% |
| Rows dropped by the 20-row limit | 0 | 0 | 0 |

**The planning share.** `gravityPlanningRate` gives an expert 1.25 steps a millisecond in a duel, 0.22 with three bots and 0.16 with four. At 170 ms to think that is 212, 36 and 27 steps, which hardly covers the first ply. Blind matches show the cost alone, because no rows arrive there: two experts never died (54,798 pieces, no deaths). Three died every 588 pieces. In the four-player potato rooms before the potato's clock ran, no rows arrived either, and four died every 272 pieces.

Giving four bots the same total as two (3.85 times the share) raised rows sent per piece from 0.171 to 0.264 and rows sent per minute from 29 to 40, at 153 pieces a minute instead of 170 (8 seeds). Deaths stayed about the same (3.4 and 3.6 a minute) because everyone also attacked more.

A death costs 1.75 s and the board. Digging pays: a tier 10 duel gives 3.0 lines per 100 pieces from rows completed by a rise, against 1.5 for people.

## 7. The other modes

Tier 10, 16 seeds, ten-minute limit, seven frags:

| Mode | Decided | Deaths a minute | Rows arriving per piece | What it shows |
| --- | ---: | ---: | ---: | --- |
| Rows, two players | 0 | 0.33 | 0.291 | baseline |
| Smallest attack 3 lines | 0 | 0.22 | 0.205 | 46% of fires are still two lines and send nothing |
| Smallest attack 4 | 0 | 0.09 | 0.073 | 28% two lines; the attack is a quarter of normal |
| Smallest attack 5 | 0 | 0.01 | 0.019 | almost nobody attacks |
| Blind, full blind, two players | 0 | 0.00 | 0 | bots see every hidden cell; nothing happens to them |
| Blind, three players | 0 | 0.29 | 0 | one frag in 141 deaths; all self-inflicted |
| Hot potato, two players | 0 | 0.13 | 0.101 | attacks are spent when they deal nothing |
| Hot potato, four players | 16 | 1.22 | 0.067 | 102 of 390 deaths gave nobody a frag |

## 8. Bots against the decoded players

| | Stephen, duels | His opponents | Tier 10 | Tier 9 | Tier 8 | Tier 7 | Tier 5 | Tier 3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pieces | 6,286 | 6,197 | 71,804 | 58,094 | 37,836 | 30,049 | 25,986 | 16,402 |
| Pieces a minute | 80 | 79 | 151 | 132 | 101 | 67 | 55 | 35 |
| Lines a piece | 0.53 | 0.54 | 0.61 | 0.60 | 0.54 | 0.51 | 0.42 | 0.37 |
| Rows sent a piece | 0.35 | 0.32 | 0.30 | 0.30 | 0.26 | 0.23 | 0.18 | 0.18 |
| Rows sent a line | 0.65 | 0.59 | 0.49 | 0.49 | 0.48 | 0.46 | 0.44 | 0.49 |
| Lines a fire | 3.9 | 3.5 | 2.75 | 2.75 | 2.75 | 2.73 | 2.68 | 2.82 |
| Fires of 5+ per 100 pieces | 3.2 | 2.8 | 1.01 | 0.95 | 0.78 | 0.75 | 0.52 | 0.84 |
| Fires of 8+ per 100 | 1.02 | 0.73 | 0.04 | 0.05 | 0.02 | 0.04 | 0.01 | 0.04 |
| 5+ fires with no wave over two rows, per 100 | 1.00 | 0.42 | 0.89 | 0.85 | - | 0.60 | 0.37 | 0.49 |
| 5+ fires with a wave of four or more, per 100 | 1.57 | 1.58 | 0.02 | 0.01 | - | 0.04 | 0.04 | 0.13 |
| 5+ fires from a roofed edge column | 79% | 81% | 15% | 15% | 12% | 13% | 15% | 23% |
| Boards with a straight parked on a roofed shaft | 20% | 22% | 0.5% | 0.4% | 0.3% | 0.5% | 1.0% | 2.0% |
| Two-row clears passed up | 41% | 30% | 32% | 33% | 38% | 40% | 48% | 60% |
| Tallest column, mean | 11.5 | 12.3 | 8.4 | 8.3 | 8.1 | 9.6 | 10.1 | 10.8 |
| Deaths per 1,000 pieces | 5.7 | 7.3 | 2.2 | 2.5 | 4.4 | 4.8 | 7.2 | 9.8 |

Every column plays its own equals, so the deaths are not comparable across columns. What is: an expert bot gets 0.49 rows out of a line and good players 0.59 to 0.65, and it makes its attack from twos and threes.

When recorded human attacks (1,560 of them, drawn at the rate one arrives in a duel) are dropped on tier 10, it dies 4 to 7.5 times per 1,000 pieces (five seed sets), two to three times as often as against its own small attacks. Big attacks are what it has not met.

The tiers differ in speed and in how many pieces they lose, hardly in how they build. From tier 3 to tier 10 the average fire stays between 2.6 and 2.8 lines.

## 9. The ceiling

One board, versus feel, recorded attacks arriving at 0.33 rows a piece, 2,400 to 3,000 pieces a line. The rows a piece differ by about 0.01 from one set of seeds to the next.

| | Rows sent a piece | Deaths per 1,000 | Fire |
| --- | ---: | ---: | ---: |
| Today's tier 10 | 0.27 to 0.29 | 4 to 7.5 | 2.8 |
| Today's evaluation, 4 times the steps | 0.29 | 4.6 | 2.9 |
| 10 times the steps, wider beam | 0.35 | 2.1 | 3.0 |
| 40 times the steps, widest beam | 0.37 | 1.7 | 3.1 |
| Prototype evaluation, today's budget | 0.43 | 3.7 | 3.9 |
| Same, potentials removed (only "choose by the whole plan, rows count as rows") | 0.33 | 6.7 | 2.8 |
| Same, without "fill one row" potential | 0.38 | 4.7 | 3.1 |
| Same, without the trigger potential | 0.40 | 5.0 | 3.5 |
| Same, reward for size removed | 0.40 | 6.3 | 4.2 |
| Same, shaft terms removed | 0.43 | 3.7 | 3.7 |
| Same, danger by tallest column instead of the spawn columns | 0.45 | 2.7 | 3.7 |

Not significant at these sample sizes: the last two lines. The idea that the spawn columns, not the tallest, should rule the danger is right by the rules, but it did not show a gain here, because this prototype builds low. It should be measured again with the shelf style.

Head to head, five-minute duels, free-for-all, seven-frag goal, 48 seeds in both seat orders:

| | Frags | Games led | Reached seven | At the limit |
| --- | --- | --- | ---: | ---: |
| Free prototype against today's tier 10 | 566 : 52 | 95 of 96 | 37 | 59 |
| Shelf prototype against today's tier 10 | 301 : 19 | 92, 2 lost, 2 tied | 0 | 96 |
| Shelf against free | 258 : 316 | 28, 48 lost, 20 tied | 2 | 94 |

"Free" is fitted for rows and survival only. "Shelf" is the same search with the edge shaft and parked straights held fixed. Free plays Stephen's other strength, chains: 2.99 chain fires per 100 pieces against his 1.00, and 4% of its clears are singles. Shelf makes a roofed-edge fire of 52% of its 5+ fires and 0.23 shaft fires per 100, still far from his 1.57. Both outplay today's tier 10. Neither is a finished bot: no ladder, no crowd fit, one speed.

In four-player rooms one free prototype among three current experts was first to seven in four of four (small).

## 10. Frame cost

Headless, this machine (32 threads, otherwise idle), all bots of a room together, per 1/60 s tick, four 180-second games each:

| Room | Mean | 99% | 99.9% | Per piece |
| --- | ---: | ---: | ---: | ---: |
| Two experts, today | 0.12 ms | 0.69 | 1.07 | 1.4 ms |
| Two prototypes, same steps | 0.25 ms | 1.36 | 1.95 | 3.1 ms |
| Four experts, today | 0.06 ms | 0.30 | 0.53 | 0.4 ms |
| Four experts, the fair share | 0.13 ms | 0.60 | 0.97 | 0.9 ms |
| Four prototypes, the fair share | 0.28 ms | 1.21 | 1.63 | 1.9 ms |

It includes respawns and random pieces. Nothing here measures a slow machine or a drawn frame; the whole-display stalls were left open by the earlier work and this does not close them.

## 11. What the recordings say about our own rules

| Rule | In the recordings | In the game |
| --- | --- | --- |
| Rows sent = lines minus one, whatever the waves | yes, 1,400 fires with two players alive | same |
| Emptying the board adds 1, 2, 2, 3 rows for 2, 3, 4, 6 lines | yes, 8 cases | same |
| Rows completed by a rise count and attack | yes | same |
| With more than four alive, each extra player takes one row off | yes: with 5 alive one row off (63 of 69 fires), with 6, 7 and 8 alive two, three and four off (42 of 47) | stamps that come to the same for usual play |
| Frag credit of two per row, one off per placed piece | 129 of 129 frags in five crowd games; the other rules tried miscount 18 to 60 | same |
| Rows of one attack hold together; rows of separate attacks do not | yes, but it seldom shows: one body per row leaves another board in 18 of 20,003 placements | same since 24 November (`joinAttackRows`): 2,138 of 2,138 recorded rises reproduced, 2,129 before |
| Parts of a cut body that touch again stay two bodies | yes: joining them again leaves another board in 32 of 20,003 placements | **differs**: they join at the next clear |
| Cells above the visible 20 | stacks up to 31 | **differs**: 24 |
| Waiting rows limited to 20 | not testable (the largest pile that another placement follows is 17; larger ones, up to 24, came with the last piece before a death) | 20 |
| Blind times, potato targets | not in any recording | from the source reading |

The frag rule, the crowd cut and the attack sizes were known from the source reading before this check, so it confirms them and does not discover them. The last two rows of the table cannot be confirmed.

## 12. Limits

- The audit tools run headless on one machine. Speeds are the game's own clock, not a display.
- Sample sizes are 24 to 48 games a line; intervals are given where they matter. Every tie and time limit is in the tables.
- "Dies within three seconds" credits a shot that another cause may have made.
- The recorded attacks were drawn at random from three duels of 2001 and do not depend on the bot's board.
- Where I wrote about a technique, the numbers come from the decoded recordings and the fresh reader's playbook. I had read the reference game's rules on 22 November, so I did not write the playbook.
