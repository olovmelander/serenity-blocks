# Building the second clear first

On the two-row shaft below, both experts can create a roof. The previous expert abandons the useful continuation. The candidate predicts which piece will load the roof and which later piece will release it **before placing the roof**, then executes all three placements. These positions were constructed in Serenity to test decisions visible in the [player recordings](BOT_PLAYER_RECORDINGS_2026-11.md).

## A roof built two locks before the payoff

The current piece is I and the visible preview is I, J, L. Read each board from the top down. A dot is air. The right-hand groups B through J each occupy two cells vertically. K is a separate horizontal group. In the sequence below `r` marks the first I that makes the roof, `p` marks the parked I and `t` marks the J trigger.

```text
Before       Lock 1       Lock 2       Lock 3, before clear    Settled
                          p.........   p.........
                          p.........   p.........
                          p.........   p........t
                          p.........   p........t
....KKKK..   rrrrKKKK..   rrrrKKKK..   rrrrKKKKtt
.BCDEFGHIJ   .BCDEFGHIJ   .BCDEFGHIJ   .BCDEFGHIJ             p........t
.BCDEFGHIJ   .BCDEFGHIJ   .BCDEFGHIJ   .BCDEFGHIJ             p........t
```

The release clears floor row 3. The parked I and surviving J fragment settle, floor rows 1 and 2 clear together, and two cells from each piece remain. Two garbage rows are generated. The older controller also places a horizontal I across the gap, but its initial forecast shows no second wave. At the next lock it lays the second I horizontally across the center. The subsequent J leaves all three placements uncleared.

| Same-sequence test | Previous expert | Candidate expert |
| --- | --- | --- |
| I, I, J with L last in the opening preview | Three locks, zero lines, zero outgoing rows | Forecast and live result agree on one row followed by two. Two outgoing rows. |
| I, I, J with J last in the opening preview | First I lands in the middle, on top of K. No roof over the shaft and no clear in three locks. | Builds the roof, loads it and triggers the same one-plus-two clear. |
| Mirror the board and change the visible J and L to their mirror pieces | Builds the right-hand roof, then lays the second I horizontally. No clear in three locks. | Parks the second I against the right wall. L triggers from the left. Same waves and outgoing attack. |
| Four receiving rows, I, I, O, L | Roof, parked I, O trigger. One row followed by four, four outgoing rows. | Same inputs and result. The larger textbook clear was already within the previous expert's abilities. |

On the loaded two-row board, exhaustive checks of reachable landings distinguish the release from a covered hole. The ready J has a two-wave trigger. If the next piece is another I, every one of its 34 reachable poses clears zero rows on that lock. The bot cannot count the J payoff until the requisite piece is visible. That conclusion concerns the current lock and does not rule out a later release.

## A square and an elbow on the shelf

The receiving rows determine which piece belongs on the shelf. Widening both gaps to two cells makes room for an O. Widening only the upper gap leaves an L-shaped cavity. In both cases the expert chooses the horizontal I and forecasts the parked piece and the trigger before making that first placement. These are constructed Serenity positions.

| Board | Previous expert, same three pieces | Candidate expert, live result |
| --- | --- | --- |
| Two rectangular gaps, I then O then J | Sends the I vertically into the left gap, then places O in the middle. Three locks, 150 points, zero lines or attack. | Parks O on the left shelf. J clears floor row 3 from the right. The whole O falls and completes floor rows 1 and 2. Three locks, 1,195 points, two outgoing rows. |
| Stepped gap, I then L then O | Stands I vertically against the left wall above A, then adds L on the left. Three locks, 150 points, zero lines or attack. | Rotates L so its foot fits the wide upper gap and its long leg fits the two lower gaps. O clears floor row 4 from the right. Floor rows 1, 2 and 3 clear together. Three locks, 1,745 points, three outgoing rows. |

The stepped case below uses `p` for the parked L and `t` for its O trigger. Two cells from the O remain after the clear.

```text
Before        I makes shelf   L parked       O locks         Settled
                              pp........     pp........
                              .p........     .p........
                              .p........     .p......tt
....KKKK..    rrrrKKKK..      rrrrKKKK..     rrrrKKKKtt
..CDEFGHIJ    ..CDEFGHIJ      ..CDEFGHIJ     ..CDEFGHIJ
A.CDEFGHIJ    A.CDEFGHIJ      A.CDEFGHIJ     A.CDEFGHIJ
A.CDEFGHIJ    A.CDEFGHIJ      A.CDEFGHIJ     A.CDEFGHIJ      ........tt
```

The previous expert's three boards are below. Each `#` is a locked cell. Both experts place the final O at the right wall. The first two placements determine whether that O releases the three lower rows.

```text
Old I         Old L         Old O, settled     New O, settled
#.........    ##........    ##........
#.........    ##........    ##......##
#...####..    ###.####..    ###.######
#.########    #.########    #.########
#.########    #.########    #.########
#.########    #.########    #.########         ........##
```

## One board, two reasons to fire

This position already has a roof and a single fragment resting on its outside end. The active J can trigger immediately. It can also extend the setup, leaving room for the two I pieces in the preview. The visible preview is I, I, L in both runs.

```text
A.........
MMMMKKKK..
.BCDEFGHIJ
.BCDEFGHIJ
```

| Queued rows | Previous expert | Candidate expert | What the live board does |
| --- | --- | --- | --- |
| 0 | J extends right. The following I pieces lie horizontally. Zero waves over three locks. | J extends right, the first I parks vertically on A, and the second I triggers at the right wall. | Floor row 3 clears, then both bottom rows clear. Two outgoing rows. |
| 17 | Rotates the current J into the right end of the support and fires immediately. | Takes the same immediate release. | Floor row 3 clears, then one bottom row clears. One outgoing row. Both survive insertion. |

For the counterfactual, the harness presents zero pending rows to the candidate while actually delivering the same 17 rows after its J locks. It executes the identical safe-board inputs and tops out. This directly tests the cost of waiting.

## Recover and finish

Return to the first, unroofed board with the I, I, J, L opening. The fixtures change one public observation at a time.

- **Recover with 18 pending.** The previous controller places the first I horizontally in the middle, clears nothing and tops out when the burst arrives. The candidate sends the I vertically down the open left shaft. It clears the bottom two rows in one wave and sends one. All 18 incoming rows are then applied with their holes at the right wall. The next I goes to that newly visible wall and removes four garbage rows, sending three. The stack falls from 20 occupied rows high after the rise to 16.
- **Finish with no incoming rows.** An opposing board of five vertical straights at the wall reaches the top visible row. The controller receives its public headroom of zero. The previous controller spends its I on the roof and sends nothing. The candidate clears the two bottom rows immediately, generating one outgoing row. Applying that exact attack to the opponent's unchanged board triggers a real top-out. In a match, the opponent can still change its board before the garbage comes due.
- **Check hidden information.** Changing the bag after the three visible previews leaves the candidate's opening inputs and forecast identical. Moving the holes in the uninserted 18-row burst from the right to the left also leaves the first decision and forecast identical. The resulting live boards differ after insertion.

## Reproduce

The comparison uses tier 10 with identical starts, action randomness, and scoring. Every selected movement and hard drop must be accepted by the game, and the harness waits for physics to settle. A forecast records the active-piece route's selected continuation at the time that plan was made. The wave counts and cleared floor rows come from the game's line-clear callback. Attack comes from the game's garbage calculation. The fixtures isolate placement decisions from execution speed.

```sh
node reports/gravity-bot-rebuild/support-positions.mjs /path/to/checkout-at-11ee1ca09
npm test -- src/core/ai/gravity-support.test.js
```

The first command emits a JSON object per case with the tested and previous controller decisions, every input, the visible preview, the forecast, cleared floor rows, outgoing attack, settled board and any top-out. The optional checkout supplies the previous controller and its search. Both use the same live Serenity rules. [Fixture driver](../reports/gravity-bot-rebuild/support-positions.mjs) · [Regression tests](../src/core/ai/gravity-support.test.js)
