# Bots for the new versus: plan and decisions

24 November 2026. For the owner's approval; nothing here is built in the game. Evidence: [the audit](BOT_VERSUS_AUDIT_2026-11.md) and [the playbook](VERSUS_PLAYBOOK_2026-11.md). Numbers below are measured unless marked as an estimate.

## Where we stand

Today's expert wins by speed. It places 151 pieces a minute against Stephen's 80 to 102, and gets 0.49 rows out of every line it clears. Stephen gets 0.65. It fires twos and threes, never loads a shelf, and is planning-starved in rooms of three and four. The evaluation it uses was fitted for score and for waves, and versus pays neither: rows are lines minus one.

A rough evaluation that counts lines, inside the same planning budget and at the same speed, beat it 566 frags to 52. So the top is far from its ceiling, and the work is the evaluation, the planning share and the ladder under it.

## Ranked changes

Gains are against today's expert unless said otherwise.

| # | Change | Evidence | Expected gain | Success mark | Risk and cost |
| ---: | --- | --- | --- | --- | --- |
| 1 | **A versus evaluation for tiers 8 to 10**: value the largest clear a filled row would give, value attack by rows with a bonus for size, count garbage rows as rows like any other, and choose by the whole plan instead of "dig first, then fire at two rows, then most waves". Built on the existing beam search and landing code | Prototype 0.43 rows a piece against 0.28, deaths 3.7 against 7 per 1,000; 95 of 96 five-minute duels led | Attack per piece +40 to +50%; the five-minute duel goes from even to one-sided | Rows sent per piece 0.40 or more at 150+ pieces a minute; leads 85% of five-minute games against today's expert on seeds not used in fitting; four-wave chain openings and solo score per piece unchanged, because Odyssey keeps the old evaluation | Two times the planning time per piece (3.1 against 1.4 ms); must be measured on a slow machine |
| 2 | **Shelf-park-release in versus**: a separate value for a roofed edge shaft, its rows one cell short, and straights parked over it, held to a minimum share of fires | Shelf prototype 301:19 against today's expert and 258:316 against the free one; edge-roofed fires 52% of its 5+ fires, against Stephen's 79% and today's 15% | It looks like the players and keeps 92 of 96 leads against today's expert; loses to the free version 258:316 | At tier 10: roofed edge column in 60% or more of 5+ fires; a straight parked in 50% or more; shaft fires 1.0 per 100 or more; rows per line 0.65 or more | Decision 2 |
| 3 | **A fair planning share in three- and four-bot rooms** | No rows arriving: an expert dies every 272 pieces in four-bot rooms, 588 in three. Same total as two bots: rows a piece 0.17 to 0.26 | Four-bot rooms stop starving; attack per piece +55%, at 153 pieces a minute instead of 170 | Self-inflicted deaths in a no-attack four-bot room under one per 2,000 pieces; tier 10 at 150+ pieces a minute in all room sizes; planning under 1.5 ms per tick at the 99% on the slow machine | More work per frame; needs the slow-machine check in step 4 below |
| 4 | **Real kill tests instead of the old ones**: would these rows block the next piece, given the opponent's visible board and the holes of the attack I am sending? And does my own board survive the rows that are waiting? | One finishing shot in three kills nobody; three panics in ten survive; unused with three or more players | Not measured. Small in duels, larger in rooms of three or more, where finishing is unused | Finishing shots that end somebody within three seconds: 85% or more; in three- and four-player rooms it is used | Depends on change 1; the prototype removed both and won without them |
| 5 | **Crowd play**: weigh attack against safety by how many opponents are alive, since each of them gets the whole attack; take a frag's credit when an opponent is nearly buried (the old FAQ says the same) | One free prototype among three experts was first to seven in 4 of 4 rooms; attacks of 3 rows reach 9 rows in a four-player room | Not measured on its own; the fit for rooms of two, three and four replaces one shared fit | Against today's experts in rooms of three and four, 50% or more of frags on held-out seeds; deaths without a frag under 10% (now 16 to 31%) | Needs three pressure levels in the fit |
| 6 | **Attack by the match's rules**: smallest attacking clear; the crowd and mode multipliers | With a smallest attack of 4 and 5, rows arriving fall to a quarter and a fifteenth of normal | Bots actually attack in those modes | Rows arriving per piece with a smallest attack of 4: at least 60% of normal | Low |
| 7 | **Danger by the spawn cells and the rise that is waiting**, not by the tallest column | The rules say so: nobody in 230 recorded deaths had the centre below 20. The test showed no gain (0.45 against 0.43 rows a piece, within noise) because the prototype builds low | Unknown until the shelf style stands tall | Shelf-style tier 10 does not lose strength when towers stand at 20 to 24 | Low |
| 8 | **Random-piece risk**: value a shot by the pieces that can make it, weighing the five or so shapes that do, and a straight one in seven | The search already sees three previews; openings fell from 16 to 9 of 40 with random deals | Not measured; a few percent | Four-wave openings within 16 pieces: 12 or more of 40; trigger pieces no kind over 25% | Low; after change 1 |
| 9 | **Ladder re-fit**: tiers 1 to 9 on the shipped rules, free-for-all, with speed, previews and mistake rates as today's levers | Now: 9-8 is the steepest (78%), 3-2 and 2-1 nearly flat (58%, 52%) | Every step between 58 and 72% | Each of the nine steps 58 to 72% over 100 games in both seat orders, the 9-8 step at most 70%, decided or tied share reported | Any speed change re-fits it. Heavy: runs in the background |
| 10 | **Modes**: bots forget hidden cells within limits set by tier (a person does not remember a full board); hold the potato's attacks for when it counts; watch the opponent's board | Blind does not affect them at all; a potato holder's attacks are spent early | Blind and potato become real matches for bots and fair against people | In blind rooms, a bot's rows a piece fall by 10% (tier 10) to 40% (tier 3); potato four-player rooms: attacks of the holder reach their target | Needs a model of memory; decision 6 |

Changes 1 and 3 come first and everything else is measured on top of them.

## Order of work, after approval

1. Branch and worktree are ready (`feature/bots-versus`).
2. Rules decisions that shift every number: 4 (rows of one attack) and 5 (limits).
3. Evaluation (1), with kill tests (4), crowd play (5), the match's rules (6) and the spawn danger (7). A/B each change on identical seeds and on held-out seeds.
4. Planning share (3) and a slow-machine check (a throttled run first; the real answer is a device).
5. Shelf value (2), then random-piece risk (8).
6. Fit tiers 8 to 10, then refit the ladder (9). Then the modes (10).
7. A board-by-board replay of a chain and one full match, then the handover.
8. Sync with main, all tests, then the merge only when you say so.

## Decisions

Say yes, no, or another choice. My recommendation is marked.

**1. Build on the line-counting evaluation in change 1?** *Yes.* Speed stays at 150+. The cost is about double the planning time.

**2. How much of the shelf in tier 10?**
- A. Free: the strongest, chains and few singles. 566:52 against today, 316:258 against the shelf version. Looks like Stephen's chains, not his towers.
- B. Shelf held to a minimum (*recommended*). 301:19 against today, 258:316 against the free version. Looks like the players you know.
- C. Each tier 10 seat draws one of the two by its seed, so a room shows both.

**3. Equal planning in rooms of three and four?** *Yes.* It costs tier 10 about 17 pieces a minute there (170 to 153) and it stays above 150.

**4. Rows of one attack hold together, as in the game you want to match?** *Yes, before the bots are fitted.* **Approved and done 24 November.** It is measured from the recordings, not from source. Correction: I first wrote that separate rows give 437 impossible placements and that the change makes digging harder. Those were mostly knock-on errors of one wrong board. Counted afresh after each difference, separate rows give another board in 18 of 20,003 placements, so the change is right and rare.

**5. The numbers that came from the source reading** (ADR-0024 says they are due to be replaced):
- Attack sizes, the crowd cut, settle credit and frag credit are confirmed by the recordings. *Keep.* The crowd cut can be written simply: each player alive above four takes one row off. Rows sent, frags and play stay the same; only online rooms with more than four are touched.
- The limit of 20 waiting rows: no recording tests it and no bot room ever reached it. *Keep at 20, with our own reason: one visible board.*
- Blind times, full blind times and potato targets: in no recording. Choosing other numbers on paper would be guesswork. *Keep, set them by playtest, and say so in the ADR.*

**6. Blind: should bots forget?** *Yes, by tier.* Today they see everything under blind, so blind is free for them and unfair for you. If not, we say in the setup screen that bots see in the dark.

**7. The 20 visible rows plus 4 hidden.** The players' stacks reach 31 rows. Ours lose cells past row 24. *Leave it.* It touches rendering, the save format and the network. The bots must keep parked towers plus the waiting rise at 24 or less. Raise it later if you want the towers.

**8. Hot potato seeding.** *Yes, seed the order from the match seed* (small). Otherwise it cannot be replayed.

**9. The tiers below 8.** Today they differ mostly in speed. *Same style at every tier, with fewer previews, slower hands and more mistakes*, so a beginner meets a shelf too. The other choice is the old small-fire style for tiers 1 to 4, which is easier to beat and less like anyone.

**10. Speed ceiling.** Tier 10 stays at 150+ as you asked, up to 171 in crowds. People peak at about 100, 240 in a burst. *Keep.* If you want it to play like a strong person rather than beat one, tell me and I will cap it and re-fit the ladder.

**11. The two open checks.** The five-person playtest: these bots change enough that the playtest should wait for this work and be done on it; before that it would judge the wrong bots. The whole-display stalls: planning grows by about two times in a duel and four times in a four-bot room, still under 1.5 ms at the 99% on this machine. It does not close the stalls, and it must be re-measured on a slow machine before we call it done.

**12. Halves of a cut body that touch again** (new, measured while doing 4). In the recordings they stay two bodies; in ours they join at the next clear. It changes one board in 625 placements. *Leave it*: the same gravity code serves solo, Odyssey and the puzzles, and their levels were tuned on it.

**Answers, 24 November 2026.** Yes to 1 (as part of 2), 2 (B, the shelf: "keep the 151-171 pieces speed but should have Stephen's way of playing"), 4, 6, 9 and 10. Not answered: 3, 5, 7, 8, 11 and 12. Their recommendations are kept (5, 7, 11, 12 change nothing; 3 and 8 are part of the bots' work and reported when done).

## What would make me stop and ask

- A change costs tier 10's 150 pieces a minute, or the shelf share you choose in decision 2.
- The campaign gates or the rival outcomes move in any way.
- The ladder cannot be made even without changing speeds.

## Not in this plan

Online bots (there are none), Infinity's Last Standing rules, changes to Odyssey orbs, new sounds or visuals.
