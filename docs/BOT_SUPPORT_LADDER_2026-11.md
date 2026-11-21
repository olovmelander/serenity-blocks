# Native difficulty ladder

A same-speed duel answers whether one controller makes better placements. This experiment answers a separate player-facing question. At their normal local playing speeds, how often does the higher lobby tier beat its neighbour?

## First candidate

The top expert's two-seat search allowance improved. A nominal tier 9 seat draws expert judgment on some series, but the initial candidate gave those seats the smaller nominal tier 9 allowance. The first run was stopped after 487 completed series. The first 24 bags, 89801–89824, contain both seat orders on every pair for both versions. Percentages award one point for a series win and half for a draw or incomplete series.

| Higher tier vs lower | Three-frag higher-tier points, previous → first candidate | Seven-frag higher-tier points, previous → first candidate |
| --- | ---: | ---: |
| 7 vs 6 | 61.46% → 61.46% | 64.58% → 63.54% |
| 8 vs 7 | 64.58% → 60.42% | 64.58% → 59.38% |
| 9 vs 8 | 61.46% → 61.46% | 57.29% → 59.38% |
| 10 vs 9 | 72.92% → 90.62% | 67.71% → 94.79% |

Tier 10 gained 27.08 percentage points against tier 9 at seven frags, with a 95% interval of 15.62 to 38.54 points from matched bags. This identified a calibration problem. The reserved bags were excluded from the parameter search.

## Method

Each version plays its own adjacent pairs. Both seats receive the same bag in each round, then the whole series is repeated with the initial seat order swapped. The game supplies style draws, reaction windows, action intervals, input scheduling, garbage routing, frag credit and subsequent round seeds. The simulation advances at 60 Hz with the normal 165 Hz between-tick planning opportunities. No equal-speed lock barrier is used here.

The first-to-seven series has a 600-second limit per round and a 35-round limit overall. We also score the first-to-three prefix under its own 15-round limit. A series with an unfinished round is censored. A tied frag finish is a draw. The two seat orders for each bag stay together when resampling the candidate and previous results. Intervals use 5,000 seeded whole-bag bootstrap samples. The raw results record the sequence of deaths, last attackers and simulated tick count for every round. The Python reader independently reconstructs each finish from those records.

The previous controller is commit `11ee1ca099819cdcaeb770b9fb6baf922ea54fcc`. The native match runner and game-rule adjudicator come from each respective checkout. [Series driver](../reports/gravity-bot-rebuild/support-ladder.mjs) · [Independent score calculation](../reports/gravity-bot-rebuild/support-ladder.py)

## Calibration

The training block was 31011501–31011520, with forty series per adjacent pair after swapping the seats. The target was 55–70% higher-tier points in both frag formats. The selection criterion was the largest miss outside this band across the four tier 8/9 and 9/10 results. Mean squared distance from 62.5% broke ties. The comparison also checked the previous neighbour when a variant changed tier 8. The expert retained its own judgment, input rate and planning budget in every fit.

Local lobbies give some nominal tier 8 and 9 seats a practiced tier 10 judgment profile. These seats keep their nominal reaction window and physical style for the series. We compared giving only the practiced tier 9 seats the expert's two-seat search allowance with giving it to every tier 9 seat. We also tested changes to native action intervals and their seeded variation. The previous 100-bag panel and a new block of 40 bags starting at 32021701 were reserved for confirmation. The earlier 24-bag diagnostic had already exposed some of the original panel, so only the new block is wholly unseen.

| Tier 9 rate | Tier 9 action rate / spread | 8 vs 7, three / seven | 9 vs 8, three / seven | 10 vs 9, three / seven |
| --- | --- | ---: | ---: | ---: |
| Expert judgment only | 760 / 1.65 | — | 63.75 / 70.00% | 77.50 / 71.25% |
| 1.05 | 760 / 1.65 | — | 76.25 / 70.00% | 82.50 / 70.00% |
| 1.05 | 800 / 1.40 | — | 77.50 / 75.00% | 80.00 / 71.25% |
| 1.25 | 820 / 1.45 | — | 68.75 / 73.75% | 65.00 / 65.00% |
| 1.25 | 950 / 0.85 | — | 76.25 / 80.00% | 55.00 / 61.25% |
| **1.25** | **760 / 1.65** | **71.25 / 70.00%** | **66.25 / 72.50%** | **66.25 / 62.50%** |
| 1.25 plus the expert allowance for practiced tier 8 | 760 / 1.65 | 75.00 / 73.75% | 63.75 / 70.00% | 66.25 / 62.50% |

The fit took 640 seven-frag series. Giving practiced tier 8 a larger allowance narrowed its gap to tier 9 but pushed both its rates against tier 7 above the upper target. The selected policy changes just one two-seat search allowance. Its largest training miss was 2.50 points, compared with 5.00 for changing tier 8 as well. The selected setting was fixed before reading either confirmation panel. [Training configurations](../reports/gravity-bot-rebuild/support-ladder-fit.json)

## Original 100-bag panel

Each previous and candidate pairing played 200 series on 89801–89900. Seven of the eight candidate estimates fell within 55–70%. The exception was the expert's seven-frag result against tier 9 at 72.25%. Its increase over the previous controller was 8.00 points, with a paired 95% interval of 2.50–13.00. Fifty-one of those 200 candidate series reached the simulation limit.

| Higher tier vs lower | Frags | Previous | Candidate | Candidate wins / losses / censored | Candidate 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7 vs 6 | 3 | 59.75% | 60.00% | 115 / 75 / 10 | 55.25–64.75% |
| 7 vs 6 | 7 | 64.00% | 63.50% | 120 / 66 / 14 | 59.25–68.00% |
| 8 vs 7 | 3 | 63.00% | 64.00% | 122 / 66 / 12 | 59.75–68.25% |
| 8 vs 7 | 7 | 62.50% | 65.50% | 120 / 58 / 22 | 61.25–69.75% |
| 9 vs 8 | 3 | 59.75% | 68.75% | 130 / 55 / 15 | 64.50–73.00% |
| 9 vs 8 | 7 | 58.50% | 66.25% | 120 / 55 / 25 | 62.00–70.50% |
| 10 vs 9 | 3 | 68.00% | 69.75% | 127 / 48 / 25 | 63.00–75.75% |
| 10 vs 9 | 7 | 64.25% | 72.25% | 119 / 30 / 51 | 67.00–77.25% |

## Independent confirmation

All 40 fresh bags at 32021701–32021740 were played in both seats. The counts below are the higher tier's wins, losses and censored series. Every line has 80 series. Each displayed interval is a 95% whole-bag bootstrap interval for the candidate's points.

| Higher tier vs lower | Frags | Previous | Candidate | Wins / losses / censored | Candidate interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| 8 vs 7 | 3 | 64.38% | 66.25% | 52 / 26 / 2 | 58.75–73.75% |
| 8 vs 7 | 7 | 63.75% | 67.50% | 51 / 23 / 6 | 60.62–74.38% |
| 9 vs 8 | 3 | 60.00% | 72.50% | 56 / 20 / 4 | 65.00–80.00% |
| 9 vs 8 | 7 | 63.12% | 69.38% | 50 / 19 / 11 | 63.12–76.25% |
| 10 vs 9 | 3 | 70.62% | 71.25% | 54 / 20 / 6 | 61.25–81.25% |
| 10 vs 9 | 7 | 65.62% | 69.38% | 46 / 15 / 19 | 60.62–78.12% |

Four of the six point estimates fell within the target. The two short-format estimates exceeded 70% by 2.50 and 1.25 points. Tier 9 gained 12.50 points over tier 8 in the short format, with a paired 95% interval from 6.88 to 19.38, and 6.25 points in the long format, with an interval from 1.25 to 11.25. The expert's short and long estimates against tier 9 were within 0.63 and 3.75 points of the previous expert's. Nineteen of the eighty new seven-frag expert series were censored, so estimates of this gap depend on the fixed timeout convention.

## Reproduction

The archive holds 2,966 series records with 23,709 round records across the calibration, both comparison panels and parity checks. It includes the measured source identity, seat order, seed, tier, round length, knockouts, credited attackers and both adjudicated finishes. Swapping seats can change an outcome because the local playing style comes from the seat and the series seed. A 40-bag panel contains 80 observed series for each tier pair. [Compressed round records](../reports/gravity-bot-rebuild/support-ladder.jsonl.gz)

The original panel reuses 107 measured series between nominal tiers 6–8 from the first candidate. Reversing the single tier-9 condition in `a7b4a9254` reproduces the earlier policy fingerprint exactly. Both players in these series kept the same two-seat allowance, including when their practiced judgment profile differed. Reused records retain their measured policy hash. Each record identifies its reference commit and the fingerprints of the Blind preview logic and the reachability implementation.

The last movement change in `3801a3bfb` skips soft-drop expansion when enumerating landings for a canonical, high, centred spawn in an empty standard well. Its rotations, sideways inputs and hard drops already reach the full set of landing positions. We compared both implementations on bags 89801–89802, both seat orders and all four tier pairs. All 16 series reproduced the same 144 rounds, including time to elimination, deaths and credited attackers.

```sh
python -B reports/gravity-bot-rebuild/support-ladder.py reports/gravity-bot-rebuild/support-ladder.jsonl.gz --training --first 31011501 --count 20
python -B reports/gravity-bot-rebuild/support-ladder.py reports/gravity-bot-rebuild/support-ladder.jsonl.gz --first 89801 --count 24 --candidate initial
python -B reports/gravity-bot-rebuild/support-ladder.py reports/gravity-bot-rebuild/support-ladder.jsonl.gz --first 89801 --count 100
python -B reports/gravity-bot-rebuild/support-ladder.py reports/gravity-bot-rebuild/support-ladder.jsonl.gz --first 32021701 --count 40 --tiers 7 8 9
```

To play the original panel again, point the driver at a clean checkout of `11ee1ca09`. The final number is the number of concurrent background workers per version. A partial output file can resume when its policy, reachability and Blind fingerprints match the current code. A legacy file missing these fields requires a fresh output path.

```sh
node reports/gravity-bot-rebuild/support-ladder.mjs ../serenity-baseline native.jsonl 89801 100 4
node reports/gravity-bot-rebuild/support-ladder.mjs ../serenity-baseline training.jsonl 31011501 20 1 reports/gravity-bot-rebuild/support-ladder-fit.json
```
