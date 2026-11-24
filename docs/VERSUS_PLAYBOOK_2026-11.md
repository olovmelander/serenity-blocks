# How strong people play Quadra versus

Written 2026-11-24 for the team building bots for Serenity Blocks versus. The reader is assumed to know this codebase and to have never played Quadra.

Every finding carries a mark:

- **[seen]** a page states it, or it was watched in footage (by the earlier repo notes, not again here).
- **[measured]** counted from the decoded recordings. The count is given as n.
- **[inferred]** my reading of the above.

The writer read player pages, player-facing texts, our own code and the decoded data. No source code of another game was read. Nothing here is a formula or a weight to copy.

## In short

- Everybody good builds the same weapon: an empty edge column, roofed early, with straights parked on the roof. It does not separate Stephen from strong opponents. [measured]
- What does: he fires 2.4 times as many chains of one- and two-row waves through garbage (1.00 against 0.42 per 100 pieces), in all three duels, and five times as many late (2.15 against 0.43). [measured]
- He passes up small clears (41% of two-row clears against 30%), takes fewer single lines (12% against 17%), and stands lower (11.5 against 12.3) at the same speed. [measured]
- High after a rise he fires in three pieces; low he waits six and gets larger fires than his rivals (30% of 5+ against 11%). Most of his deaths are with a loaded shaft under a blocked centre. [measured, inferred]
- Big fires seldom kill strong players. They are dug and sent back. [measured]
- Our hidden rows stop at 24, and our pieces fall much slower by default. [measured in our code]

## 1. The evidence

Ten recordings were rebuilt placement by placement: 20,003 placements by all players, 8,477 of them Stephen's, 2,025 fires of two or more lines, 230 deaths. The rebuilt lines, largest clears and deaths equal each recording's own scoreboard for every player but one, whose scoreboard entry is missing (premchai21). [measured]

| Recording | Date | Kind | Stephen's pieces | Result |
| --- | --- | --- | ---: | --- |
| stephen-vs-hfmich | 2001-01-12 | duel | 2,165 | 15 to 13 |
| stephen-vs-alex | 2001-01-13 | duel | 1,707 | 15 to 9 |
| 2v2andyzlip... | 2001-01-28 | five players | 296 | died 5 times, the others 5, 5, 5 and 6 |
| michvsn | 2001-02-11 | duel | 2,414 | 15 to 14 |
| dBowns... | 2001-04-01 | six players | 41 | joined late, died once |
| 20-liner | 2001-05-10 | five players | none | |
| 183k | 2001-07-25 | seven players | 203 | outlived everyone in four of four rounds [from death times] |
| 16linesingle | 2001-08-02 | alone | 391 | |
| show0690 | 2001-08-19 | alone | 952 | 19 deaths |
| show0376 | 2001-10-09 | eight players | 308 | outlived everyone in four of four rounds, no death [from death times] |

"Early" means January to April 2001, "late" means July to October 2001. That the names Stephen, StepheN and RZ***Stephen are one player is inferred. The turns per piece (0.85 to 0.95) and the share of corrected placements (12 to 16%) are nearly constant through all nine of his recordings. [measured]

What to keep in mind when reading the numbers:

- **Late Stephen is a small sample**: 511 pieces, 40 fires, 27 fires of five or more lines, eight rounds, and weaker and slower opponents. Where a table says "late" it is these 511 pieces only.
- The data file `pooled.txt` calls 807 pieces "Stephen, crowds". 296 of them are the January five-player game, so its crowd row mixes early and late. I recounted late on its own.
- Five of the fifteen originals were not rebuilt: the four 1999 demos store no garbage holes, and BuK's solo stores raw key presses only.
- Rows sent are right as totals but not per fire. 135 of 1,511 duel fires carry zero rows because the rows were booked on a later clear: Stephen's 12-line fire at 1557 s shows 0 and the two-line clear after it shows 12. For shares by size I use lines minus one. [measured]
- Drawn boards stop at height 28. Four fires were taller. `stephen-deaths.txt` draws 40 of his 43 deaths with opponents.
- The recordings do not hold the key-repeat timing (only single-frame presses are logged), the deal beyond the pieces placed, or what a player was looking at.

## 2. Words

- **Fire**: a placement that clears two or more lines, all waves counted. **Wave**: one step of it.
- **Shaft**: a column left empty while the rows beside it fill, so each row lacks one cell.
- **Roof** or **shelf**: the cell that closes the shaft from above. **Parked straight**: an I piece standing on the roof over the shaft.
- **Trigger**: the placement that clears the row holding the roof.
- **Shaft fire**: a fire of five or more lines whose biggest wave is four or more rows. **Chain fire**: five or more lines whose biggest wave is one or two rows. These two names are mine.
- **Dig**: clear rows that came from an opponent ("garbage rows").
- **Group names**: *opponents* are Alex, [HF]mich and [hf]michele in the three duels. *Strong crowd* is tom, Norm, Dada, dB, AdEpt, addicted and Sentinel (ten player-games, 3,028 pieces). *Ordinary crowd* is the other 17 player-games (2,301 pieces). *Crowd others* is both together (27 player-games, 5,329 pieces). *Late others* is the 13 player-games beside Stephen in 183k and show0376.

## 3. Per player

[measured], all of it. Times are seconds. "In play" is from the piece appearing to its lock.

| Player | Game | Pieces | Per min | In play | Lines per fire | Waves | 5+ fires /100 | 8+ /100 | Sent per piece | Sent per line | Singles | Stack | Dug per received | Deaths |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Stephen | hfmich duel | 2165 | 71 | 0.44 | 3.8 | 2.5 | 3.2 | 0.8 | 0.33 | 0.63 | 14% | 11.7 | 0.60 | 13 |
| [HF]mich | hfmich duel | 2132 | 70 | 0.45 | 3.5 | 2.2 | 2.6 | 0.7 | 0.31 | 0.59 | 16% | 12.3 | 0.55 | 15 |
| Stephen | alex duel | 1707 | 86 | 0.42 | 4.1 | 2.7 | 3.3 | 1.3 | 0.33 | 0.68 | 9% | 11.9 | 0.57 | 9 |
| Alex | alex duel | 1713 | 87 | 0.40 | 3.5 | 2.2 | 2.5 | 0.5 | 0.28 | 0.56 | 20% | 12.4 | 0.47 | 15 |
| StepheN | michvsn | 2414 | 85 | 0.41 | 3.8 | 2.5 | 3.1 | 1.0 | 0.37 | 0.65 | 12% | 11.1 | 0.66 | 14 |
| [hf]michele | michvsn | 2352 | 84 | 0.41 | 3.6 | 2.3 | 3.3 | 0.9 | 0.35 | 0.61 | 15% | 12.2 | 0.65 | 15 |
| StepheN | 5 players, Jan | 296 | 83 | 0.45 | 4.8 | 2.5 | 3.0 | 1.7 | 0.31 | 0.70 | 7% | 11.3 | 0.30 | 5 |
| RZ***Stephen | 183k | 203 | 103 | 0.34 | 7.1 | 4.1 | 4.9 | 3.0 | 0.44 | 0.83 | 7% | 11.5 | 0.55 | 1 |
| RZ***Stephen | show0376 | 308 | 102 | 0.33 | 5.8 | 3.8 | 5.5 | 2.6 | 0.36 | 0.65 | 7% | 11.5 | 0.84 | 0 |
| [hf]tom | 5 players, Jan | 305 | 88 | 0.40 | 4.0 | 2.4 | 3.0 | 1.3 | 0.23 | 0.65 | 12% | 10.9 | 0.25 | 5 |
| [hf]tom | 6 players, Apr | 464 | 77 | 0.38 | 5.0 | 3.0 | 3.9 | 1.1 | 0.36 | 0.73 | 11% | 11.0 | 0.56 | 2 |
| Norm | 5 players, Jan | 307 | 86 | 0.45 | 4.3 | 2.3 | 2.9 | 1.0 | 0.26 | 0.63 | 23% | 10.9 | 0.29 | 5 |
| Dada | 5 players, Jan | 251 | 73 | 0.60 | 4.0 | 2.4 | 2.8 | 1.2 | 0.24 | 0.64 | 8% | 11.5 | 0.22 | 5 |
| AdEpt | 183k | 151 | 89 | 0.40 | 4.9 | 2.5 | 3.3 | 2.0 | 0.26 | 0.60 | 11% | 12.7 | 0.13 | 4 |
| AdEpt | show0376 | 201 | 90 | 0.38 | 4.3 | 3.1 | 2.5 | 1.5 | 0.09 | 0.21 | 16% | 13.1 | 0.26 | 4 |
| addicted | show0376 | 212 | 83 | 0.42 | 4.5 | 2.7 | 2.8 | 1.9 | 0.14 | 0.33 | 20% | 13.7 | 0.26 | 4 |
| Sentinel | 20-liner | 459 | 75 | 0.51 | 3.4 | 2.4 | 1.7 | 0.9 | 0.25 | 0.56 | 16% | 12.2 | 0.31 | 4 |
| dB | 6 players, Apr | 401 | 72 | 0.42 | 3.1 | 2.1 | 1.2 | 0.0 | 0.25 | 0.60 | 21% | 11.9 | 0.17 | 8 |
| Ordinary crowd | 17 player-games | 2301 | 61 | 0.60 | 3.7 | 2.4 | 1.9 | 0.3 | 0.12 | 0.46 | 15% | 11.2 | 0.12 | 75 |

Rows sent per piece in games of seven and eight are small for everybody because attacks are cut in a crowd (section 5). [inferred] "Dug per received" counts rows that arrived just before a death, so players who die often look worse than they dig. [inferred]

## 4. Rhythm and hands

| [measured] | Between locks, 10% / median / 90% | In play, 10% / median / 90% | Corrected | Drop |
| --- | --- | --- | ---: | --- |
| Stephen, three duels | 0.32-0.34 / 0.54-0.58 / 1.31 | 0.23-0.25 / 0.41-0.44 / 0.82-0.87 | 12% | down key held on 91 to 98% of pieces |
| Stephen, late crowds | 0.25-0.26 / 0.45-0.47 / 1.04-1.10 | 0.15-0.22 / 0.33-0.34 / 0.62-0.67 | 13-14% | instant drop on 99 to 100% |
| Duel opponents | 0.34-0.36 / 0.55-0.62 / 1.21-1.30 | 0.25-0.28 / 0.40-0.45 / 0.80-0.88 | 14-19% | instant drop |
| AdEpt, late crowds | 0.33-0.34 / 0.52-0.53 / 1.07-1.22 | 0.24-0.26 / 0.38-0.40 / 0.79-0.80 | 24-34% | instant drop |

- Duel partners play at the same speed as each other: 71 and 70, 86 and 87, 85 and 84. Pace does not decide those duels. [measured]
- Late Stephen plays 102 a minute. Of the 13 late others the fastest is jojje at 95; AdEpt plays 89 and 90. Stephen's fastest tenth of pieces follow within 0.25 to 0.26 s, a burst rate of about 240 a minute. [measured]
- Between April and July 2001 he changed from holding the down key to the instant drop. Opponents who already used it in early 2001 were no faster than he was, so the key alone does not explain the extra 20 pieces a minute. [measured, the last part inferred]
- His first key comes a median 0.00 to 0.03 s after the piece appears. The decision was made on the preview. Ordinary players take 0.08 to 0.42 s in nine of their 17 player-games. [measured]
- He presses a side key 1.8 to 2.2 times per piece and turns 0.85 to 0.95 times. Corrected placements: 12% in the duels against 14 to 19% for his opponents; tom 18%, AdEpt 24 and 34%. [measured, as the data file labels a correction]
- Sliding a piece under an overhang is almost absent: 0.4% of Stephen's duel placements (n 6,286), 0.4% of his opponents' (n 6,197), 0.6% late (n 511). Everything is built to be dropped into. [measured]

## 5. Building, firing, waiting

### Fires

| [measured] | Stephen duels | Opponents | Stephen late | Crowd others | Stephen alone |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pieces / fires | 6,286 / 743 | 6,197 / 768 | 511 / 40 | 5,329 / 389 | 1,343 / 59 |
| Pieces per fire | 8.5 | 8.1 | 12.8 | 13.7 | 22.8 |
| Lines per fire / waves per fire | 3.9 / 2.5 | 3.5 / 2.3 | 6.3 / 3.9 | 3.9 / 2.4 | 5.7 / 4.0 |
| Fires of 5+ / of 8+, share | 27% / 9% | 23% / 6% | 68% / 35% | 30% / 9% | 53% / 31% |
| Lines cleared one at a time | 12% | 17% | 7% | 15% | 10% |
| Attack carried by fires of 5+ | 55% | 52% | 90% | 61% | - |
| Deaths per 100 pieces | 0.57 | 0.73 | 0.20 | 2.29 | 1.49 |

A fire of N lines sent N-1 rows in the duels whatever the number of waves: eight lines in two, three, four, five, six or eight waves all sent seven. [measured] In a crowd the rows are cut: the same nine lines delivered 5.0 rows as a round opener with seven players and 4.0 with eight, and eight rows once few were left alive. [measured, opening fires in 183k and show0376]

### Setups

For fires of five or more lines, just before the trigger:

| [measured] | Stephen duels | Opponents | Stephen late | Crowd others | Stephen alone |
| --- | ---: | ---: | ---: | ---: | ---: |
| n | 201 | 176 | 27 | 118 | 31 |
| Main shaft roofed / roofed and at an edge | 87% / 79% | 92% / 81% | 78% / 70% | 95% / 92% | 90% / 52% |
| Of all: left edge / right edge | 67% / 11% | 60% / 22% | 63% / 7% | 84% / 8% | 45% / 6% |
| One straight or more parked / two or more | 68% / 31% | 80% / 44% | 67% / 41% | 88% / 55% | 84% / 39% |
| First wave is one row | 79% | 81% | 78% | 88% | 94% |
| Biggest wave: rows / is the first wave | 3.8 / 14% | 4.0 / 6% | 3.9 / 22% | 4.2 / 6% | 3.2 / 13% |
| Roof to trigger, pieces: 10% / median / 90% | 4 / 12 / 23 | 3 / 12 / 22 | 5 / 15 / 21 | 4 / 13 / 20 | 5 / 19 / 31 |
| Tallest column: 10% / median / 90% | 11 / 16 / 22 | 12 / 17 / 22 | 10 / 17 / 24 | 13 / 18 / 23 | 13 / 18 / 22 |
| Shaft fires per 100 pieces | 1.57 | 1.58 | 2.15 | 1.44 | 0.82 |
| Chain fires per 100 pieces | 1.00 | 0.42 | 2.15 | 0.39 | 1.41 |
| Chain fires, share of these fires | 31% | 15% | 41% | 18% | 61% |

- For fires of eight or more, Stephen had two or more straights parked in 63% (duels, n 64) and 79% (late, n 14); opponents 76% (n 45). [measured]
- The board is a bowl with a tower on one wall. Mean column heights before his duel fires of 5+ are 15.3 on the left, 11.3 to 12.2 across columns 2 to 9, and 12.9 on the right. [measured]
- The roof is whatever piece hangs one cell over the edge. In his drawn fires with a roofed edge column (n 37): L 11, T 5, S 4, Z 2, O 2, J 1, and in 12 the roof was a garbage row with its own hole elsewhere. [measured]
- No piece is needed to fire. His triggers for 5+ in the duels (n 201): I 20%, L 19%, T 19%, J 13%, S 13%, Z 12%, O 3%. [measured] He leaves the roof row a gap several pieces can fill. [inferred]
- For fires of 8+ the stack stood above the visible 20 rows in 36% (n 64) of the duel cases and above 24 in 11%. A straight was never parked higher than rows 19 to 22 in any drawn board; only arriving rows lift a tower further. [measured, 209 drawn upright straights]

### The opening fire

| First fire after a (re)start [measured] | Lives / fired | Lines | Pieces, median | 5+ | 8+ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Stephen, duels | 39 / 39 | 6.6 | 25 | 69% | 44% |
| Opponents | 48 / 43 | 5.7 | 23 | 60% | 23% |
| AdEpt, tom, addicted, Norm | 30 / 24 | 7.5 | 26 | 92% | 58% |
| Crowd others | 149 / 99 | 5.4 | 22 | 60% | 23% |

Late Stephen's eight round openers were 9, 9, 13, 12 lines (183k) and 5, 9, 11, 9 (show0376), after 25 to 31 pieces. [measured, n 8] A good opener is common to strong players, not his alone.

### Passing up and taking

Share of placements where a clear of that size was on offer and the player cleared nothing:

| Best clear on offer [measured] | Stephen duels | Opponents | Stephen late | Crowd others |
| --- | ---: | ---: | ---: | ---: |
| 1 line | 56% of 861 | 53% of 1,087 | 61% of 46 | 52% of 569 |
| 2 lines | 41% of 433 | 30% of 486 | 68% of 22 | 36% of 233 |
| 3 lines | 30% of 241 | 24% of 223 | 62% of 13 | 35% of 112 |
| 4 lines | 27% of 168 | 17% of 109 | 3 of 4 | 24% of 67 |
| 5 to 7 lines | 35% of 211 | 32% of 198 | 46% of 26 | 38% of 134 |
| 8 or more | 28% of 88 | 25% of 64 | 48% of 27 | 27% of 51 |

He passes up two-row clears more than each opponent in all three duels (39 against 32%, 41 against 25%, 42 against 31%). One loaded board counts once per piece while he waits on it. Even eight or more on offer is left about a quarter of the time in duels. [measured]

### Rows arriving

| After three or more rows arrive [measured] | n | Pieces to next fire, median / mean | Within 2 pieces | Lines of that fire | 5+ | Rows dug by it |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Stephen, duels | 208 | 3 / 4.2 | 40% | 4.3 | 35% | 1.9 |
| Opponents | 257 | 3 / 4.1 | 40% | 3.7 | 25% | 1.5 |
| Stephen, late | 17 | 3 / 4.6 | 41% | 7.2 | 71% | 4.0 |
| Crowd others | 157 | 3 / 3.6 | 46% | 3.9 | 29% | 1.5 |

He answers no sooner than others. He answers with more, and how long he waits depends on the height after the rise (duels, Stephen then opponents): [measured]

| Tallest column after the rows | Pieces to fire | Lines | Fires of 5+ | n |
| --- | --- | --- | --- | --- |
| 16 or more | 3.0 / 3.6 | 5.3 / 4.1 | 49% / 33% | 81 / 108 |
| 11 to 15 | 4.1 / 4.4 | 3.5 / 3.5 | 21% / 21% | 71 / 112 |
| 10 or less | 5.8 / 4.8 | 3.8 / 2.8 | 30% / 11% | 56 / 37 |

Where the holes are: in 112 drawn arrivals around his fires and deaths (362 rows), 60% of the rows had a hole in column 1 or 10 and 13% had more than one hole. Of 37 arrivals of four or more rows, 32 had three or more holes in the same edge column. [measured, boards picked for their fires and deaths] Attack rows carry the hole where the sender's falling pieces landed, so a straight shaft sends a straight hole. [seen, FAQ; measured]

### Clean boards

Stephen emptied the board 8 times in 6,286 duel pieces, his opponents once in 6,197, nobody in 5,329 crowd pieces, he not at all late or alone. All eight were clears of two to six lines from boards 3 to 11 tall with no garbage on them. [measured] The extra rows were 1, 2, 2 and 3 for clears of 2, 3, 4 and 6 lines. [measured, n 8] It is a bonus taken when a low board offers it, not a plan. [inferred]

### Rows cleared by the opponent's rows

When rows arrive, loose pieces can drop into their holes and complete rows. That gave 96 of Stephen's 3,341 duel lines and 96 of his opponents' 3,325. [measured] The two largest clears in the whole set, Seb's 20 and dB's 19, were mostly this: neither placed a clear over seven lines, and at least 14 and 12 of the lines were completed by arriving rows. [measured] Both finished far behind in frags (five and one). [seen, repo notes]

### Deaths

| [measured] | Stephen duels | Opponents | Crowd others |
| --- | ---: | ---: | ---: |
| n | 36 | 45 | 122 |
| Tallest column / centre columns | 22.6 / 21.3 | 22.9 / 21.5 | 24.4 / 22.3 |
| Garbage rows on the board | 14.1 | 15.3 | 15.5 |
| Covered empty cells | 23.8 | 23.3 | 25.1 |
| Rows taken in the last ten pieces | 7.2 | 6.6 | 12.9 |
| Rows arrived with the last piece | 33% of deaths | 58% | 78% |
| Ten or more pieces since own last fire | 33% | 31% | 31% |

- Nobody died with the centre below 20 (0 of 230). A tall edge does not kill. [measured]
- Of his 33 drawn duel deaths, 23 held a roofed edge shaft of three or more one-gap rows and nine had three or more cells of straight standing on it. 18 took four or more rows in a single arrival within the last six placements. He mostly dies with the weapon loaded. [measured]
- The other ten had 7 to 16 garbage rows with holes in six to ten different columns. Only 35 of their 120 garbage rows (29%) had an edge hole, against 60% of the rows that arrive. He dies under scattered inner holes. [measured, the last part inferred]

### What kills

In the ten seconds before a duel death the killer had fired 5+ lines in 67% of cases, against 33 to 37% of all ten-second windows (Stephen's victims n 45, his own deaths n 36). [measured] But a big fire alone rarely kills a strong player: after Stephen's 22 fires of ten or more lines the victim was dead within ten seconds in 23% of cases, against 13% after fires of two to four lines (n 542). His 16-line fire in michvsn (15 rows by the size rule) came 222 s before michele's next death. [measured] The victim digs them and sends them back. Pressure kills, not one blow. [inferred]

## 6. How Stephen plays, step by step

1. **Open column, early roof.** From an empty board he keeps column 1 empty and builds column 2 up first. In the opener drawn as the roof goes on (183k, 33.5 s) column 2 stood 6 high, the middle 4 to 5 and the right 6 to 7 when a T went on with its arm over column 1 at row 8. The roof goes on after a median of 10 pieces (5 to 16, n 26 duel openers of 5+; 7 to 14 in his eight late openers) and the fire comes about 15 pieces later. Other covered cells are few: his six late openers without garbage had 9 to 12 covered cells, 7 to 9 of them the shaft. [measured]
2. **Roof.** The next T, L, S, Z, O or J that can hang one cell over column 1 goes there. [measured, section 5]
3. **Park and fill.** The straights that come go upright on the roof, usually one to three of them, while all other pieces fill columns 3 to 10 up to the roof row, leaving a gap of one to three cells in it. [measured from the drawings]
4. **Release.** Whatever piece fits completes the roof row. One row clears, the roof cell goes with it, the straights fall and clear four to nine rows at once. One to four lines follow from what lands. [measured from the drawings]
5. **Use what comes back.** The rows of everybody's opener arrive as he fires or just after. On the low board left over he builds 2 to 12 pieces onto the garbage with loose upright pieces above the holes, then fires a chain of one-row waves that unpicks the rows from the top. [measured from the drawings]
6. **When high, fire what there is.** At 16 or more he fires within three pieces on average. [measured]

### Example A. The shelf, 9 lines in 2 waves (show0376, 81.5 s)

`#` is the piece just placed, `<` marks a row being cleared, `=` is garbage, letters are piece kinds. Panels 1 to 4 are 12, 7, 4 and 0 placements before the fire.

```text
   roof is on     straight       straight       trigger (L)    wave 2: 8      after
18                               #.........     I.........
15                               #.........     I.........
14                #.........     I.........     I.........
12                #.........     I.........     I.#.......
11 .T........     #T........     IT........     IT#....Z..
10 TT........     TT........     TT........     TT##SSZZOO     .T........
 9 .T........     .T........     .T...T....     .T.SSTZ.OO     .TLSSTZZOO
 8 .I........     .I.T..L...     .I.TTTLLLL     .I.TTTLLLL     IILTTTLLLL<
 6 .I...#....     .ITTTTLLOO     .ITTTTLLOO     .ITTTTLLOO     IITTTTLLOO<
 4 .ITTLLLLTT     .ITTLLLLTT     .ITTLLLLTT     .ITTLLLLTT     IITTLLLLTT<
 2 .IZZSSSSTT     .IZZSSSSTT     .IZZSSSSTT     .IZZSSSSTT     IIZZSSSSTT<    .T........
 1 .IZSSSSTTT     .IZSSSSTTT     .IZSSSSTTT     .IZSSSSTTT     IIZSSSSTTT<    .TLSSTZZOO
```

The T roof covers rows 1 to 9 of column 1. Wave 1 is row 10 alone. The two straights then fall to the floor and clear rows 1 to 8 together. Rows 3, 5, 7, 13, 16 and 17 are left out of the drawing. [measured]

### Example B. Nine rows taken and returned (stephen-vs-alex, 156.3 s)

Panels 1 to 4 are 5, 4, 1 and 0 placements before the fire. The nine rows enter after the first.

```text
   9 rows due     rows are in    straight       trigger (L)    wave 2: 8      after
18                               #.........     I.........
15                               #.........     I.........
14                I.........     I.........     I.........
12                I#........     IL...L....     IL...L....
11                I#........     ILTTTL....     ILTTTL....
10                I##.T.....     ILLTTLL...     ILLTTLL###     .L...L....
 9                =======.==     =======.==     =======#==     .LTTTL....
 8 I.........     .=========     .=========     .=========     I=========<
 4 I.S.T.#...     .=========     .=========     .=========     I=========<
 2 ILSSOO#LLL     .=========     .=========     .=========     I=========<    .L...L....
 1 IL.SOO.LLL     .=========     .=========     .=========     I=========<    .LTTTL....
```

Rows 3, 5 to 7, 13, 16 and 17 are left out. Two straights were left standing on column 1 by his previous fire. Alex's nine rows came in below, eight with their hole in column 1. One more straight and a trigger across two rows clear ten lines, and the board is two rows high. [measured] Of his 14 largest early fires, eight came within two placements of 4 to 11 arriving rows. [measured, the 14 largest only, so not typical]

### Example C. The unpicking chain, 10 waves of one row (show0376, 202.3 s)

```text
   trigger (I)    wave 2: 1      wave 4: 1      wave 6: 1      wave 10: 1     after
18 I.........     I.........
17 I......TS.     I.........
16 IJJ...TTSS     I......TS.     I.........
15 IJI...IT.S     IJJ...TTSS     I.........
14 IJIL.#IIJJ     IJI...IT.S     I......T..
12 I.ILL#IIJZ     I.IL.IIIJ.     IJI....TSS     I.........
11 OOLLL#ZIZZ     I.ILLIIIJ.     IJIL.III.S     IJJ....TS.
10 OOLJJZZLZ.     OOLJJZZLZZ<    I.IL.IIIJJ     IJI...TTSS
 9 ======.===     ======.===     I.ILLIIIJ.     IJIL.I.T.S
 8 ========.=     ========.=     ========J=<    I.IL.IIIJJ     I.........
 7 .=========     .=========     .=========     I.ILLIIIJ.     I......TS.     I.........
 6 ======..==     ======..==     ======..==     ======II==<    IJJ...TTSS     I......TS.
 5 ==.=======     ==.=======     ==.=======     ==.=======     IJIL...T.S     IJJ...TTSS
 4 =====.====     =====.====     =====.====     =====.====     IJIL..IIJJ     IJIL...T.S
 3 .=========     .=========     .=========     .=========     I.ILLIIIJ.     IJIL..IIJJ
 2 =====.====     =====.====     =====.====     =====.====     =====I====<    I.ILLIIIJ.
 1 =========.     =========.     =========.     =========.     =========.     =========.
```

Rows 13 and 19 are left out. Nine garbage rows, holes in columns 7, 9, 1, 7-8, 3, 6, 1, 6 and 10 from the top. Above them stands a piece over each of those columns that is free to fall, mostly upright straights. The last straight, in column 6, completes row 11; each cleared row lets the next loose piece drop into the next hole. Eight garbage rows go; the row with the hole in column 10 stays. [measured]

The same happens on low boards: at 63.9 s in the same game, seven placements after his previous fire, he cleared six lines in six one-row waves through four garbage rows and kept two rows. [measured]

### Example D. Loaded and dead (five players, 266.3 s)

```text
   3 before       last piece (T)
20                I.........
18 I.........     I.........
14 I.........     I..Z......
13 I.........     I.ZZZ....#
12 I.........     LLZZZ.OO##
11 I...#.....     .LLZS.OOS#
10 LL.##.....     .LL.SSZZSS
 9 .LL#S...S.     .SLLZSZZZS
```

Rows 15 to 17, 19 and 1 to 8 are left out. Two straights stand on the L roof over ready rows. Row 12 lacks one cell, column 6. Six rows arrive with this piece, the centre goes from 14 to 20 and the next piece cannot appear. He had not fired in 25 pieces. [measured]

## 7. What separates him, and what does not

**Does not separate him from strong opponents** [measured]: the roofed edge shaft (79% against 81%), shaft fires per 100 pieces (1.57 against 1.58), parked straights (opponents have more), size of the first wave, pieces from roof to trigger, lines cleared per piece (0.52 each) and duel pace (80 against 79 a minute).

**Does separate him**, in the same direction in all three duels [measured]:

| | hfmich | alex | michvsn | pooled |
| --- | --- | --- | --- | --- |
| Chain fires per 100 pieces | 1.02 / 0.33 | 1.17 / 0.23 | 0.87 / 0.64 | 1.00 / 0.42 |
| Two-row clears passed up | 42 / 31% | 41 / 25% | 39 / 32% | 41 / 30% |
| Lines taken one at a time | 14 / 16% | 9 / 20% | 12 / 15% | 12 / 17% |
| Rows sent per line | 0.63 / 0.59 | 0.68 / 0.56 | 0.65 / 0.61 | 0.67 / 0.61 |
| Mean stack | 11.7 / 12.3 | 11.9 / 12.4 | 11.1 / 12.2 | 11.5 / 12.3 |
| Garbage rows dug per row received | 0.60 / 0.55 | 0.57 / 0.47 | 0.66 / 0.65 | 0.62 / 0.57 |

Read as one sentence: where his opponents clear garbage in ones and twos, he strings it into chains of one-row waves, so at the same speed he stands lower and gets more rows per line. [inferred] The margins are small. Rows sent per minute are 27.6 against 25.2, and he won the three duels by 2, 6 and 1 frag. The duel won by 1 is level play.

**From strong crowd players** (n 3,028): chains 0.36 per 100 pieces against his 1.00 in duels and 2.15 late, rows sent per line 0.60 against 0.67 and 0.74, two-row clears passed up 33% against 41% and 68%, singles 16% against 12% and 7%, digging 0.26 rows per row received against 0.62 and 0.69. Tom is the nearest: 1.04 chains per 100 pieces over two games. [measured]

**From ordinary players** (n 2,301): speed (61 a minute), thinking after the piece appears, corrections (24%), 0.27 lines per piece against 0.5, almost no 8+ fires (0.26 per 100 against 1.0), 0.46 rows per line, and 0.12 rows dug per row received. They build the same shaft: 84% of crowd others' fires of 5+ were a roofed left edge. They fire fewer and smaller ones, 43 of 5+ in 75 lives (0.57 a life). [measured]

**A contradiction to keep**: in the January five-player game the same man had one chain in nine fires of five or more, sent 25.5 rows a minute against tom's 20.7 and Norm's 22.7, and died as often as everyone. The chain habit is clear only in the duels (n 201) and late (n 27). [measured]

**What nearly beat him**

- *[hf]michele, 14 to 15*: the same shaft rate (1.79 per 100 against 1.74), the same speed, more chains than the other opponents (0.64 against 0.33 and 0.23), and digging as well as he does (0.65). [measured]
- *A lift at the wrong moment*: the shaft is loaded in 23 of 33 drawn deaths, and the rise blocks the centre before the trigger row is complete (Example D). [inferred from the drawings]
- *One huge attack on a low board*: at 382 s in michvsn a 15-row attack took him from 5 to 20 rows; he had no setup to answer with and died three placements later. [measured]
- *A crowd of equals*: all five January deaths had taken eight or more rows in the last ten pieces. [measured]

## 8. Duels, crowds, alone

| [measured] | Duels, early | Five players, Jan | Late crowds | Alone |
| --- | ---: | ---: | ---: | ---: |
| Pieces a minute | 80 | 83 | 102 | 70 |
| Lines per fire | 3.9 | 4.8 | 6.3 | 5.7 |
| Chain share of 5+ fires | 31% | 1 of 9 | 41% | 61% |
| Waves of five or more, share of 5+ fires | 18% | 1 of 9 | 48% | 55% |
| Pieces per death | 175 | 59 | 511 (1 death) | 67 |
| Rows received a minute | 24.6 | 38.2 | 29.2 | 0 |

What is him and what is the situation, late:

- *Him* [inferred]: the pace (his own early pace was 71 to 86, and the late others play 26 to 95), the chains (2.15 per 100 pieces against 0.43 for the late others), and the passing up of two- and three-row clears (66% of 35 against 38% of 84).
- *The situation* [measured]: attacks are cut in a crowd, so a small fire is worth little. With seven or eight players, two- to four-line fires delivered about one row each on average (n 76). That alone would push anyone to bigger fires. Rounds restart from empty boards, so eight of the 40 fires are openers. The opponents were slower and died first.
- *Alone* he plays for the score, not rows [inferred]. Many of his setups (column 3 or 2 main, S and Z stacked upright in two-high steps so that gaps alternate) clear one row per wave for up to 14 waves. That shape is in none of his 41 drawn versus fires. [measured] He died 19 times in 952 pieces there.

## 9. What pages and footage say

- *In-game tutorial* [seen]: blocks are solid and must be broken to fall; it shows two upright straights held over an open left column by an L, and the release; three next pieces are shown; blocks may stick out at the sides, the game ends when they reach the centre at the top; a double or more attacks.
- *Official manual* [seen]: rows waiting are taken when you drop your next block; a setting says how many lines are needed to attack; the repeat setting affects sideways movement and dropping. It points to strategy guides that the page does not link and the maker's site no longer has.
- *Player FAQ (DAC and roncli), multiplayer chapter* [seen through a search index; the site itself refused connections]: practise speed and send lines whenever possible; in games above three or four players a big build-up gets disrupted, so do it only if you can finish; keep a build-up until an opponent is nearly dead so the fire also takes the frag; holes in rows you send lie where your clearing blocks landed; a counter is to stack upright straights over the column the opponent's attack will come through, so one row clear returns their rows.
- *HELLFIRE clan page* [seen through a search index, page refused today]: recursive clearing broke the writer's old stacking; "greed is actually most of the time the way to win"; place Z pieces upright.
- *Two block-game wikis (their Quadra pages)* [seen]: three previews, no hold, instant drop, adjustable key repeat that is not kept across pieces, turns fire on key release, a 180-degree turn, short fixed delay before the next piece, peaks of 260 pieces a minute for a short time, a 324 "blocks per minute" record that the pages say is not real-time.
- *Footage, from the repo's earlier notes*: zirre's 14-line fire with a parked straight and garbage coming up under it, Polly's compilation with a central release, fawk's 2008 points run with 12-line fires and board clears. [seen by the notes' author; not re-watched here]

Agreements: the FAQ's counter is what Example B shows, and the drawings of three large early fires show a straight standing on column 10 before rows with 5 to 8 holes there arrived. [measured] The "greed" line agrees with the pass-up table.

Contradictions: the FAQ says send whenever possible; Stephen passes up 41% of two-row clears. The FAQ says a big build-up in a crowd is at risk; late Stephen opened with 9 to 13 lines in seven of eight rounds against six or seven opponents. The late others opened with five or more in 76% of the lives in which they fired at all (n 41), and lost. One page says there is no delay before the next piece, another a short fixed one. The recordings show 0.08 s (median, nearly all players). The wikis' peak of 260 pieces a minute fits his burst rate of 240, not his sustained 102.

Not found: any strategy guide, forum thread, interview or match footage beyond the above, in English, French, German, Swedish, Finnish or Russian searches. Nothing on Stephen beyond the HELLFIRE results.

## 10. Where it carries over to Serenity Blocks

The second column is [seen] or [measured] in sections 4, 5 and 9 unless marked otherwise. The third column was read in our code. The fourth is [inferred].

| Point | Recordings and pages | Ours (file) | Does the tactic carry? |
| --- | --- | --- | --- |
| Falling groups | Cells cleared split a piece; parts fall on their own | Same (`findConnectedComponents`, by piece id) | Yes |
| Rows of one attack | One solid mass that stays together; rows of separate attacks do not [measured in the rebuild: with every row a body of its own, 18 of 20,003 placements leave another board than the recording; with one body per attack, none. The difference is rare, and the drawings cannot show it: none of their 10,434 garbage segments hangs unsupported] | When this was written each row was its own body. Since 24 November the rows of one attack hold together in versus (`joinAttackRows`), and the game's own insertion gives 2,138 of 2,138 recorded rises | Yes |
| Parts of a cut body that touch again | Stay two bodies [measured: otherwise 32 of 20,003 placements leave another board] | Join again at the next clear, as they keep the piece's id | Rare: once per 625 placements. Forecast with our resolver |
| When rows enter | After the piece has locked and its chain has finished; several attacks can enter together [inferred: 183k, 70 s, eight rows at once when no rival attack in the seconds before was over 4] | All waiting rows at the next spawn (`main.js`, `spawnPiece`) | Yes |
| Waiting limit | Not seen | 20 rows (`VERSUS_MAX_PENDING_LINES`) | Test the cap |
| Rows sent | Lines minus one, waves do not matter; single lines send nothing (850 of 916 in the duels; the rest show rows booked late); rows completed by a settle are credited [measured] | Same, two lines smallest by default, settle clears credited | Yes |
| Crowd cut | 9 lines sent 5.0 with 7 alive, 4.0 with 8 | Only above four alive; local rooms hold four, online more | Duel tactics carry locally, crowd tactics only online |
| Clean bonus | 1, 2, 2, 3 rows for 2, 3, 4, 6 lines | Same at those sizes (`calculateGarbage`) | Yes |
| Death | Centre columns at 20 to 24, never under 20; a tall edge is safe | Blocked spawn only; spawn cells at heights 20 to 22 in the centre | Yes |
| Stack above 20 | Up to 31 rows seen at an edge (25 of 2,025 fires from above 24); no drawn clear above row 19 | Four hidden rows; cells lifted past row 24 are lost; rows above 20 never clear | Towers up to 22 by placement are the same (a straight fills rows 19 to 22 when parked at spawn height in both). Towers lifted past 24 lose their top, so his five early fires of 12+ (stacks 25 to 31) would all be cut. Keep parked cells plus the expected rise at 24 or under |
| Rotation | Classic left-handed rotation, 180 turn, no kicks mentioned [seen] | SRS-style kick table plus plain nudges one and two cells aside, 180 turn, up to four moves and turns queued during a chain | Ours allows more; tucks and turns near walls that never appear in the recordings are possible. Do not count on them |
| Key repeat | Adjustable, not kept across pieces; not recoverable from the recordings | 120 ms then 40 ms by default; a held direction carries to the next piece | Affects only speed |
| Fall speed | 11.9 rows a second (n 143, games pooled) | 1.4 rows a second at level 1, 11.9 at level 7; the match setting defaults to level 1 | Wait and adjust times are long at level 1; a full board leaves more time to place |
| Soft drop | 59 rows a second when held (0.59 rows per 1/100 s, n 1,278) | 20 rows a second (50 ms) | Ours slower; hard drop matters more |
| Lock | Not derivable | A resting piece locks at the next gravity step (up to 720 ms at level 1), no reset | Sliding under overhangs is easier in ours |
| Lock to next piece | 0.08 s median | Same tick, then a 30 ms freeze after a hard drop in fixed-tick rooms; 70 ms for a wave of four or more | Ours faster |
| Chain animation | Not derivable | 160 ms hold (80, 60 or 50% later) plus 20 ms per row of fall per wave; a six-wave chain takes about 1.2 s | Long chains delay rows arriving and cost tempo |
| Scoring | Pages: bigger clears pay more | Grows with the size and with waves; rows do not | Waves matter for score only |
| Deal | Not checked | Each piece drawn on its own in versus | Straights come 1 in 7 on average, not once per bag |
| Preview, hold | Three next pieces, no hold [seen] | Bots may use up to three next pieces, no hold | Yes |

## 11. What the data cannot answer

- How Stephen picks between chain and shaft before the rows arrive: no intent, only outcomes.
- How he would do against equals in a late crowd. He never meets one; AdEpt is the best of the rest.
- Whether hidden information (a rival's hole, waiting rows) changed his choices.
- Key repeat, locking time, the deal, and how long his chains took to play out.
- Numbers for blind, full blind and hot potato: none are in the recordings. The January game is named 2v2, but the data do not say whether teams were on.
- How much of the 8 of 8 rounds outlived is weak opposition. n is 8.

## 12. What this asks of a bot

Each row is a testable behaviour. The aim is Stephen's number where the sample is large enough to trust, and a range where it is not. Measure over at least 2,000 pieces against equal-strength opposition. The earlier bot numbers in the repo were measured on old versus rules and cannot be compared.

| # | Behaviour | Aim | From | How to test |
| ---: | --- | --- | --- | --- |
| 1 | Fires of 5+ lines from a roofed edge column, share | 70 to 80% | 79% (n 201), 70% (n 27); others 81 to 92% | Board before trigger |
| 2 | Chain fires (5+ lines, biggest wave 1 or 2 rows) per 100 pieces | 1.0 or more, share of 5+ fires about 30% | 1.00 (n 63), opponents 0.42 | Size of largest wave |
| 3 | Fires of 5+ lines with five or more waves, share | 18% duel, up to 48% | 18% (n 201), 48% (n 27) | Wave count |
| 4 | First wave of a 5+ fire is one row; the first wave is the biggest | about 80%; 14% or less | 79% and 14% (n 201) | Log waves |
| 5 | One straight or more parked at the fire | 65 to 70%; for 8+ fires two or more in 60 to 80% | 68% (n 201); 63% (n 64), 79% (n 14) | Count cells on the roof |
| 6 | Pieces from roof to trigger, median | 12 to 15 (10% 4, 90% 23) | n 175, n 21 | Time since roof |
| 7 | Trigger piece mix, no kind over 25% | I 20, L 19, T 19, J 13, S 13, Z 12, O 3% | n 201 | Log trigger |
| 8 | Opener: roof on at piece 10, first fire of a life at piece 25, 6 to 7 lines, 8+ in 40% | as stated | n 26 and n 39 duel lives | First roof and first fire |
| 9 | Two-row and three-row clears passed up | 40% and 30% | 41% (n 433), 30% (n 241); opponents 30% and 24% | Best clear on offer and nothing taken |
| 10 | Single lines, share of all lines | 12% or less | 12%; opponents 17% | Lines by size |
| 11 | Rows sent per line | 0.67 or more in duels | 0.67; opponents 0.61 | Totals |
| 12 | Mean stack in duels | 11 to 12 | 11.5; opponents 12.3 | Every piece |
| 13 | Rows dug per row received | 0.60 or more | 0.62; opponents 0.57 | Garbage rows cleared |
| 14 | Pieces from 3+ rows arriving to the next fire, median | 3 | 3 (n 208) | Arrival to next fire of 2+ |
| 15 | After a rise to 16 or more: pieces to fire and its size | 3.0 pieces, 5+ lines in half | 3.0, 49% (n 81) | Same |
| 16 | After a rise to 10 or less: do not rush | 5 to 6 pieces, 30% of 5+ | 5.8, 30% (n 56); opponents 4.8, 11% | Same |
| 17 | Tallest column before a 5+ fire, median | 16 to 17; above 20 for 8+ in a third | n 201, n 64 | Tallest column |
| 18 | Parked tower plus known rise at 24 or less | always | our rule, section 10 | Forecast |
| 19 | Deaths with three or more ready rows under a roofed edge | lower than his 70% | 23 of 33 drawn duel deaths | Board at death |
| 20 | A loose straight already standing over the column an attack will open (edge holes) | log it; Stephen had one in 13 of 32 drawn cases | FAQ; 37 drawn arrivals of 4+ rows | Opponent's board before the rows |
| 21 | Hold of 8+ lines on offer | fire most, wait about one in four | 28% passed (n 88) | On offer against taken |
| 22 | Tucks; clean boards | 0.5% or less; not planned for, 1 in 800 pieces | 0.4%; 8 (n 6,286) | Placement kind; count |
| 23 | Reaction to a piece | plan on the preview; first input within 30 ms | first key 0.00-0.03 s | Time to first input |
| 24 | Pace | 80 to 100 a minute is human; more is not needed to play like this | 80 duels, 102 late, bursts of 240 | Sustained rate |

Ideas behind the numbers, for the search:

- Rate a setup by whether several kinds of piece can trigger it, and by what falls where after the first wave. The biggest wave is the second or third in 72% of his duel fires of 5+ (n 201).
- A roof goes on about 15 pieces before its fire, far past any preview. The bot needs a value for a loaded shaft, not only a search that finds its fire.
- Plan on rows that are already waiting: a loaded board survives a rise up to 24 minus the tower, and arriving rows with holes in column 1 or 10 sit under the towers Stephen already builds.
- Watch the opponent's roofed edge column and parked straights. They show which column the next rows will have their holes in and about how many. The board is on screen; the bot controller reads only the opponent's headroom today (docs/BOT_SUPPORT_SEARCH_2026-11.md).
- For garbage with holes in different columns, value upright loose pieces standing one per hole, and a last piece that completes the top row. That is the chain fire, and the clearest measured difference.
- On a low board after a rise, delay the fire. On a high one, take it.
- Do not value a bigger single fire for its own sake. Strong victims dig it.
- Pace is not what our top bots lack: tier 10 was measured at 171 drops a minute (on the old rules, reports/gravity-bot-rebuild/expert-pace.md), against 80 to 102 here.
