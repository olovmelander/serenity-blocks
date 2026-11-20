# Gravity-first opponents

Feature branch `feature/gravity-bots`, measured against `8dc68d825db61bc04e1cfb4e4c5a1f580ea3e138`. The live policy uses public pieces, body connectivity, real wave score and outgoing garbage. The campaign measuring instrument has its own pinned entry point. [Audit](BOT_AI_AUDIT_2026-11.md) · [Approved plan](BOT_AI_REBUILD_PLAN_2026-11.md)

## Release checks

| Check | Result on the candidate |
|---|---|
| Expert builds, score and attack | **Passed.** Four-wave fires on 16/40 audit and 19/40 sealed openings. The native-paced expert earned 268.4 points and sent .254 rows per piece over the original eight long games. |
| Survival and defense | **Passed.** Deaths fell from 100 to 28 in 400 native-paced games. Every tier held or improved its original survival count. The expert survived all 16 six-row attacks and removed at least half the marked rows on 13. |
| Local difficulty | On the reserved 100-bag panel, **9/9 adjacent pairs** met the 55–70% target in both three- and seven-frag matches. On the established seven-frag panel, tier 10 earned 70.50% against tier 9. Completed seven-frag series on the reserved panel lasted a median of **16.3 minutes**, up from 9.6. |
| Campaign balance | **9/9 gates** with the pinned player profiles and remapped rivals. Every historical human-pace proxy stayed inside the approved tolerance. The original orb goals and reward requirements apply. |
| Frame cost | In the first pass, all 124,757 active planning frames fit their display budgets. All eight games met the percentile and response targets. Three of eight had at most as many two-refresh intervals as their matched replay. The reverse-order pass is in progress. |
| Repeatability | The supported local fixed clock matched 3,403 inputs, 267 waves and 134 outgoing events across two fresh processes at 60 and 165 Hz. The end of this handover names the special rules that still use the original wall clock. |
| Human appearance and fun | Far-off sampled mistakes fell to 0/58 at tier 1 and 4/67 at tier 2. The blind study is ready for five independent reviewers. Direct-play fun ratings are outstanding. |

## What the expert actually does

| Tier 10, standard board | Frozen | Gravity policy |
|---|---:|---:|
| Four waves by lock 16, audit bags 1001–1040 | 2/40 | 16/40 |
| Four waves by lock 16, sealed bags | 2/40 | 19/40 |
| Native score per piece, eight bags × 120 pieces | 225.1 | 268.4 |
| Gross attack per piece, same 960 pieces | .227 | .254 |
| Lines from wave two onward | 46.6% | 62.8% |
| Multi-wave fires proved on an earlier lock | 76 | 106 |
| Native score / gross attack per piece, 40 fresh bags × 200 pieces | 234.4 / .240 | 275.7 / .252 |
| Deaths on those 8,000 pieces | 0 | 0 |
| Cleared half the marked six-row attack within 24 locks | 4/16 | 13/16 |
| Cleared the entire marked attack within 24 locks | 4/16 | 12/16 |

On seed **1006**, the expert builds from an empty board and fires four waves with lock 13. The live local seat earns 4,628 cumulative points and sends three rows. The replay shows the tick of every accepted command, the forecast before the trigger, and each intervening wave. The 40 audit and 40 sealed openings reproduced their construction counts at native pace with zero rejected commands in 1,280 locks. [Board-by-board replay and reproduction command](BOT_AI_CHAIN_REPLAY_2026-11.md)

The original 13/40 mark includes three-wave fires. Under the four-wave rule the frozen expert reached 2/40 and the slow offline search demonstrated 20/40 on the same audit deals. The live planner recovered 14 of that observed 18-bag gap. [Offline ceiling and original chain spread](BOT_AI_AUDIT_2026-11.md)

The new winners on the audit bags were 1006, 1007, 1008, 1011, 1012, 1013, 1014, 1016, 1017, 1022, 1024, 1025, 1030, 1032, 1033 and 1037. Both original winners, 1001 and 1038, lost their opening fire. On the sealed panel 18 bags gained the fire and one lost it. Seed 303489 cleared five separate one-row waves on lock 14. The four-wave mark counts distinct bags. Survival runs end at the stated piece cap or death. A forecast requires a previously recorded legal pose sequence followed by the observed wave depth. Gross attack is the sum at the game's outgoing callback. The sealed seed list was committed to SHA-256 `5983ab51d0b488ccfa69e648ed2dc4e608ce7ac60ddf89dfe6ac56f2ad191d3d` before the fit. [Seed-level measurements](../reports/gravity-bot-rebuild/evidence.json.gz)

The native score includes the local input scheduler, gravity, hit-stop and elapsed-time lock bonuses. The fresh 8,000-piece run used bags 92101–92140. For comparison with the original weight fit, the audit's common 50-point lock bonus gave 230.3 → 283.8 score per piece on the eight-bag panel. The separate 40-bag simulation with that convention scored 237.3 → 296.2 and sent .236 → .252 rows per piece. [Scheduled seat](../reports/gravity-bot-rebuild/recorded-seat.mjs) · [Opening and survival runner](../reports/gravity-bot-rebuild/live-openings.mjs)

Resampling whole paired bags 10,000 times gives a 95% interval of **+7 to +21 audit bags** around the net gain of 14, and **+10 to +24 sealed bags** around the net gain of 17. At six incoming rows, eleven bags gained a half-dig and two lost one. Eleven gained a full dig and three lost one. The corresponding net-gain intervals are +3 to +14 and +1 to +14 bags out of 16. [Paired scorecard](../reports/gravity-bot-rebuild/scorecard.py)

## Changes that earned their cost

| Paired experiment | Outcome and decision |
|---|---|
| New beam without legal trigger ranking → whole-piece trigger ranking | Four-wave openings rose from 3/40 to 10/40. On 640 shipped-policy boards, two probes recognized 51/104 visible-shape two-wave releases and added 12 false positives. Testing real poses recognized 103/104, with 103/103 positive claims correct. A future straight-drop test can miss a tuck. The actual root uses full reachable landings. |
| Joint fit with 17 active coefficients | 28 vectors played 8 training bags × 56 pieces. Finalists played 12 disjoint selection bags × 72. Vector 7 won both mode utilities. Width 12 then reached 15/40, width 16 reached 19/40 with the longer work allowance. Fit seeds were 77201–77208, selection seeds 78401–78412. Fits ran below normal priority with four workers. |
| Lower per-tick work and a legal checkpoint | Matched opening results at single-bot allowances of 1.2, 1.4 and 1.8 units/ms were 12, 16 and 19. One or two local bots share 1.4 units/ms. Three and four share 0.65. At those three- and four-seat allowances the same expert fired a four-wave opening on 4/40 and 3/40 bags. A 48-entry occupancy cache accelerates movement. Reusing a discharge proof also requires matching body connectivity, the public pieces, pressure and reward context. |
| Read incoming rows and reward exposing real garbage holes | Queue observation alone gave an early candidate 3/16 half-digs. Rewarding exposure of the holes raised it to 12/16. The final scheduler saw the pending six rows on all 16 decisions and cleared half on 13/16. It fully cleared 12/16 and sent 135 rows after insertion, against 4/16 full digs and 106 rows for the original expert. Suppressing the queue signal in the final policy gave 13/16 half, 12/16 full and 138 outgoing. Most of the gain comes from how the bot plays the garbage on the board. Neither policy topped out. |
| Preserve a proved shot before garbage enters | On seed 1011 a four-wave trigger was already reachable when the attack arrived. The game inserts the six rows at the following spawn. Paying that shot first raised full digs from 11/16 to 12/16 against the preceding queue-aware policy, with the final cell recovered 21 locks after insertion. That choice traded two outgoing rows across the panel, 137 → 135. Any proof extending past the insertion is discarded. |
| Fire a payable attack after rebuilding material | The initial fitted search held too long between deep fires. Once eight lines have cleared, the versus policy may release from a stock of 24 cells. On the paired long panel the release rose from 234 to 243 outgoing rows per 960 pieces. |
| Recover before the central spawn area closes | Shortening the ordinary search near the roof cost tiers 8, 9 and 10 eight, one and one lives on 40 extended bags. Waiting until only three rows remained and then protecting the centre cost eight, four and one. The two-preview defender now starts with ten free rows, and three-preview defenders with eight. They rank the space for the next spawn and the points a real clear will pay. All three survived the original 40 and a further 40 bags, each to 200 pieces. |
| Learn reusable arrangements from successful builds | Twelve mirror-normalized local arrangements were learned from 114 pre-fire boards and 1,104 other training boards. On separate bags 62001–62040 the shortlist tie-breaker reached 22/40 with and without it, using the same work allowance. The live planner uses the original shortlist. |
| Add a goal specialist for solo Odyssey goals | Giving the gravity player an explicit goal tied its ordinary policy at 13/15 on orb 52 and 15/15 on orb 58. All eight authored rival encounters use the frag objective. The original experiment and its reproduction driver remain in commit `00a4aee41`. |

The forecast test and the setup experiment use the game’s own tetrominoes, gravity and scores. The synthetic fill is confined to ordering candidate boards. A recorded forecast uses whole pieces. [Planner](../src/core/ai/gravity-search.js) · [Shared gravity resolver](../src/core/stillfall/stillfall-cascade.js) · [Fit](../reports/gravity-bot-rebuild/fit.mjs) · [Pattern trial](../reports/gravity-bot-rebuild/patterns.mjs)

On the 1,800 paired first-top-out matches, the final policy read the correct incoming count on **37,960/37,960** decisions under attack and chose an immediate clear on 10,595. Tier 10 saw 3,515/3,515 and cleared on 1,049. The frozen controller saw 0/5,964 on the same bags and 0/887 in the original audit. Before calibrating local styles, the gravity policy saw 38,781/38,781. The seed-1011 dig above measures what a particular defensive choice achieved.

## Survival, construction and movement across the ladder

This first comparison isolates board judgment before local hand-speed and reading calibration. Each cell gives the frozen result followed by the gravity policy. The 120-lock panel uses bags 1001–1008. The extended survival panel uses bags 90101–90140. Every surviving game was censored at the piece limit. Points and attack below use the common audit lock-bonus policy and pool the locks actually played. [Paired simulator](../reports/gravity-bot-rebuild/run.mjs)

| Tier | Top-outs / 8 at 120 | Top-outs / 40 at 200 | Score/piece at 120 | Gross attack/piece at 120 | Later-wave lines at 120 | Forecast fires at 120 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 5 → 4 | 37 → 32 | 162 → 160 | .132 → .111 | 39% → 32% | 0 → 5 |
| 2 | 3 → 0 | 35 → 13 | 165 → 200 | .140 → .195 | 33% → 40% | 0 → 47 |
| 3 | 0 → 0 | 2 → 0 | 204 → 231 | .208 → .208 | 49% → 48% | 70 → 62 |
| 4 | 0 → 0 | 5 → 0 | 191 → 194 | .197 → .172 | 45% → 42% | 72 → 88 |
| 5 | 0 → 0 | 2 → 2 | 213 → 232 | .188 → .198 | 42% → 53% | 63 → 68 |
| 6 | 0 → 0 | 1 → 0 | 208 → 250 | .192 → .234 | 38% → 63% | 57 → 91 |
| 7 | 0 → 0 | 0 → 0 | 222 → 240 | .228 → .194 | 46% → 58% | 59 → 73 |
| 8 | 0 → 0 | 0 → 0 | 220 → 268 | .214 → .204 | 47% → 55% | 65 → 91 |
| 9 | 0 → 0 | 0 → 0 | 223 → 265 | .223 → .214 | 47% → 58% | 69 → 93 |
| 10 | 0 → 0 | 0 → 0 | 230 → 284 | .227 → .254 | 47% → 63% | 76 → 106 |

Gravity can move a piece while an opponent is positioning it or checking its landing. The table below uses the final local scheduler, slot-specific reading and hand speed, and real elapsed-time lock score. At 200 locks, 28 of 400 games ended in a top-out, down from 100. Tiers 4–10 survived all 40 bags each. Tier 10 also survived a further 40 bags starting at 92101. Pooling the locks played gives each tier’s score, attack and later-wave share. [Native seed runner](../reports/gravity-bot-rebuild/live-openings.mjs)

| Tier | Deaths, 8 × 120, old → new | Deaths, 40 × 200, old → new | Fires of depth 1 / 2 / 3 / 4 / 5+, at 200 | Lines in wave 2+, at 200 | Score/piece at 200 | Attack/piece at 200 | Proven / mistake-enabled / other fires, at 120, old → new |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 8 → 1 | 40 → 18 | 312 / 418 / 116 / 27 / 8 | 43.7% | 157.7 | 0.192 | 0 / 0 / 20 → 59 / 0 / 21 |
| 2 | 7 → 0 | 39 → 5 | 348 / 636 / 145 / 26 / 10 | 44.2% | 169.8 | 0.198 | 0 / 0 / 31 → 88 / 0 / 23 |
| 3 | 1 → 0 | 16 → 5 | 410 / 341 / 277 / 48 / 9 | 47.2% | 191.2 | 0.208 | 49 / 0 / 19 → 56 / 0 / 23 |
| 4 | 1 → 0 | 2 → 0 | 354 / 584 / 248 / 40 / 8 | 47.6% | 193.6 | 0.203 | 61 / 0 / 16 → 105 / 0 / 17 |
| 5 | 0 → 0 | 2 → 0 | 394 / 269 / 408 / 52 / 16 | 50.6% | 215.9 | 0.213 | 79 / 0 / 16 → 62 / 0 / 18 |
| 6 | 0 → 0 | 1 → 0 | 302 / 293 / 435 / 71 / 19 | 55.8% | 234.5 | 0.216 | 62 / 0 / 24 → 90 / 0 / 5 |
| 7 | 0 → 0 | 0 → 0 | 228 / 154 / 506 / 81 / 25 | 57.7% | 248.6 | 0.230 | 65 / 0 / 20 → 68 / 0 / 8 |
| 8 | 0 → 0 | 0 → 0 | 350 / 349 / 410 / 87 / 18 | 55.1% | 242.8 | 0.221 | 69 / 0 / 18 → 92 / 0 / 5 |
| 9 | 0 → 0 | 0 → 0 | 102 / 224 / 571 / 84 / 24 | 62.5% | 271.4 | 0.250 | 71 / 0 / 13 → 97 / 0 / 4 |
| 10 | 0 → 0 | 0 → 0 | 70 / 208 / 567 / 97 / 24 | 63.4% | 280.6 | 0.252 | 76 / 0 / 6 → 106 / 0 / 2 |

A proven construction requires an earlier no-clear lock, every predicted pose through the eventual trigger, and the exact realized rows in every wave. The mistake counter checks whether the preceding sampled placement reached its chosen lock and whether the ordinary alternative could have produced the same depth on the next piece. No multi-wave fire in the native panel passed that narrower mistake test. The final group includes opportunities with insufficient evidence to attribute intent. Tier 10 proved 106 of its 108 multi-wave fires, and tier 1 proved 59 of 80. [Native attribution and counterfactual replay](../reports/gravity-bot-rebuild/native-intent.mjs)

The local input scheduler produced these measurements on eight bags per tier. Reaction is measured from spawn to first applied input. The 10th, median and 90th percentiles of commands per piece were 2 / 4 / 7 at tier 1 and 2 / 4 / 6 at the four other measured tiers. Every attempted command in this panel reached the engine.

| Tier | Reaction in ms, 10th / median / 90th | Attempted commands | Rejected / recovered at next command | Repeated failed command |
|---:|---:|---:|---:|---:|
| 1 | 567 / 567 / 800 | 3,357 | 14 / 14 | 0 |
| 2 | 483 / 500 / 700 | 3,437 | 11 / 11 | 0 |
| 4 | 333 / 350 / 517 | 3,321 | 6 / 6 | 0 |
| 7 | 250 / 250 / 333 | 3,164 | 0 / 0 | 0 |
| 10 | 217 / 250 / 283 | 3,243 | 0 / 0 | 0 |

At tiers 1 and 2, **0/58 and 4/67** sampled lower-ranked choices moved three or more origin columns away. The audit observed 69/140 and 56/105. The observer counted calls to the existing random stream to distinguish a sampled error from a deliberate discharge. The blind review contains eight 18-second clips from tiers 1–6, including five with the same six-row attack. The ≥70% plausibility threshold requires at least five independent people who rate all eight clips. “Unsure” counts in the denominator. The form records what moved each judgment and accepts a separate fun rating after direct play. No human responses have been collected. `scorecard.py --reviews` checks the clip-set fingerprint in each downloaded file. [Open the blind study](../reports/gravity-bot-rebuild/blind-review.html) · [Input measurements](../reports/gravity-bot-rebuild/movement.mjs)

## Local versus at playing speed

The stronger tier earned 55–70% of first-knockout match points for **all nine pairs**, up from three with the frozen policy. On the second block eight pairs met the band. Tier 3 scored 54.75% against tier 2, half a match point short of 55% over 200 rounds. A separate 100-bag repeat of the three upper pairs returned 56.75%, 56.75% and 68.75%. [Matched game runner](../reports/gravity-bot-rebuild/validation.mjs)

Tier 3 earned **57.75%** against tier 2 on another 100 untouched bags, 112001–112100, with the seats swapped. The frozen tier 3 earned 82.50% on those same seats. The new policy won 86 rounds and shared the points on 59. Across its three 100-bag blocks it earned 337 of 600 match points, or **56.17%**. The repeat used the committed local settings. [Confirmation and original results](../reports/gravity-bot-rebuild/evidence.json.gz)

Each block plays both seat orders on 100 bags. A round still active at 150 seconds earns each seat half a point. No simultaneous losses occurred on the first two blocks. The table gives the 95% interval from 5,000 resamples of whole bags, retaining both seats. The equal-hands column fixes both seats at 180 ms per input and 200–300 ms reaction while retaining their normal seeded board reading. Five of the nine pairs met the band with equal hands. [Per-bag observations, uncertainty and censored counts](../reports/gravity-bot-rebuild/scorecard.py)

| Tiers | Frozen first KO, 91101 | Live first KO, 91101 | Live 95% interval | Still playing / 200 | Live first KO, 91501 | Live, equal hands, 91101 |
|---|---:|---:|---:|---:|---:|---:|
| 1–2 | 56.00% | 61.50% | 56.50–66.50% | 52 | 57.50% | 51.25% |
| 2–3 | 90.25% | 56.00% | 50.50–61.50% | 70 | 54.75% | 59.50% |
| 3–4 | 67.25% | 57.50% | 52.75–62.25% | 56 | 64.75% | 49.50% |
| 4–5 | 73.50% | 59.75% | 54.25–65.25% | 37 | 58.75% | 64.50% |
| 5–6 | 66.50% | 63.25% | 57.75–68.75% | 51 | 63.50% | 61.50% |
| 6–7 | 78.50% | 59.50% | 54.75–64.25% | 62 | 61.75% | 63.25% |
| 7–8 | 72.50% | 58.50% | 53.75–63.25% | 70 | 60.00% | 53.75% |
| 8–9 | 72.50% | 56.50% | 52.25–60.50% | 58 | 56.00% | 57.00% |
| 9–10 | 71.00% | 61.75% | 56.25–67.25% | 79 | 61.75% | 49.25% |

Before the local style fit, all nine pairs landed in band on the first knockout, yet the stronger opponents earned 77.5–90.25% of match points to three frags. Those same bots played 6,972 real rounds in 1,800 full matches on 94101–94200. There were 37 draws or censored races. The game’s frag adjudicator reproduced every winner. This discrepancy motivated the whole-match calibration.

### Calibrating whole matches

The first joint hand-speed fit played 672 complete three-frag races on 12 training bags in both seats. Its ten rates put seven of nine full-match pairs in band on a fresh 32-bag block. Only two held that band on the established 100-bag full-match panel. Tier 4 also gained six deaths over the original two on the 40-bag survival check. That rules out the first fit. Giving a slower seat its practiced input timing near its own roof reduced tier 4 to one death. A second fit ran 2,688 races on 48 training bags. Its independent 40-bag results for pairs 4–5, 5–6 and 6–7 were still 83.75%, 88.75% and 85%. Survival during garbage pressure was an active constraint on the difficulty fit. [Rate-grid fitter](../reports/gravity-bot-rebuild/ladder-fit.mjs)

The next 4,800 races allowed a more knowledgeable player to act more deliberately than its neighbor. Each pair played all measured combinations of hand speeds, in both seats on 32 training bags. One selection used the measured cell means directly. Another estimated each speed's contribution using four bag folds and interpolated only between measured speeds. The judgment trials used the same training deals to play every combination of two practiced reading levels. Their activation probabilities were selected from the expected outcomes across the two seats. The first-knockout and full-race objectives each targeted 62.5% higher-tier points. The campaign and sealed opening bags were excluded from this fit. [Pace estimates](../reports/gravity-bot-rebuild/pace-surface.py) · [Judgment fit](../reports/gravity-bot-rebuild/style-fit.mjs)

Each fit had its own fresh full-match block. Each bag was played twice with the seats swapped. Several hand-speed fits appeared stronger on a small sample than on the 100-bag regression panel.

| Local behavior under test | Fresh bags | Adjacent pairs within 55–70% | Higher-tier points across pairs |
|---|---:|---:|---:|
| Hand speed fitted on 12 bags | 86701–86732 | 7/9 | 59.4–74.2% |
| Fitted speed and ordinary movement near the roof | 87301–87340 | 4/9 | 62.5–88.8% |
| Independently fitted hand speed at each tier | 88201–88240 | 2/9 | 60.6–78.8% |
| Same speed grid with four-fold pooling | 89401–89440 | 4/9 | 55.0–79.4% |
| Move into place early and deliberate before dropping | 88601–88640 | 3/9 | 58.8–80.0% |
| Overlapping board-reading skill, ordinary hand timing near the roof | 87501–87540 | 4/9 | 62.5–73.8% |
| Overlapping reading skill and deliberate drop timing, fitted on 32 bags | 88351–88390 | 8/9 | 57.5–71.25% |
| Same behavior with 128 additional training bags | 86801–86840 | 7/9 | 58.8–74.4% |

The last family played all judgment combinations over 32 bags, totaling 2,176 matches. Another 128 training bags assigned each pairing once per four-bag group, in both seats, adding 2,304 matches. On those same 4,480 races both fits put all 18 training estimates in band. The expanded fit reduced the combined loss from 0.01935 to 0.01714. It also held every native survival limit. The committed selection is `68d4088a0`. The 100-bag block starting at 89801 was reserved before either fit consumed its final test. [Training and held-out records](../reports/gravity-bot-rebuild/evidence.json.gz)

For a local series, tiers 1–9 read the board two tiers ahead on **75%, 60%, 45%, 30%, 25%, 25%, 0%, 30% and 50%** of seeded seats, capped at tier 10. A separate draw varies their hands around **108, 126, 133, 218, 292, 290, 350, 460 and 620 actions per minute**. The seat lines the piece up at its practiced movement speed and can spend up to 1.8 seconds checking the landing before hard drop. Gravity and attacks continue during that wait. Both draws persist through every round. Tier 10 uses its ordinary expert judgment and hands throughout. Named rivals keep their authored pace. An unused lobby slot contributes no planning work or clock ownership. [Local seat selection](../src/core/ai/local-bot-manager.js) · [Movement and reaction timing](../src/core/ai/gravity-bot-controller.js)

On bags 94101–94200 the final local policy put **9/9** pairs in band on the complete three-frag race, up from **1/9** with the frozen policy. The higher tier earned 57.75–69.75% of match points across the nine pairings. The frozen range was 67–94%. The new opponents played 6,572 rounds in 1,800 matches. Seventy-three series reached the observation limit and earned half a point. The original opponents played 7,015 rounds and all 1,800 series finished. An independent tally using the local match rule reproduced the results. [Race runner and independent adjudication](../reports/gravity-bot-rebuild/validation.mjs)

### The local lobby's seven-frag default

The local lobby opens at seven credited frags. The three-frag results above describe a selectable shorter series. The default-match comparison carries the earned frags forward from each recorded round and plays the remaining rounds on their ordinary round seeds. It uses the local winning rule, a 600-second limit on a single round and a 35-round limit on the series. A censored match earns half a point. The separate first-round measurements stop at 150 seconds. [Lobby default](../src/ui/local-match-config-modal.js) · [Real match winner](../src/core/game-modes/local-match-rules.js) · [Race and continuation runner](../reports/gravity-bot-rebuild/validation.mjs)

The 4,480 training matches took 38,696 real rounds to reach a result or a cutoff. The committed chances put **all 27 training estimates** in band across the first knockout, three frags and seven frags. The seven-frag estimates ranged from 59.63% to 67.72%. The selection protocol kept the original chances. Before opening this fit, the protocol was amended to allow a default-match gain to preserve an already successful short ladder. Both rules selected the same policy. [Recorded selection protocol and alternatives](../reports/gravity-bot-rebuild/evidence.json.gz)

At the seven-frag finish, **8/9 adjacent pairs** met the band on 94101–94200 and **9/9** on the reserved 89801–89900. On the first block tier 10 earned 70.50% against tier 9, one match point above the 70% limit. On the reserved block it earned 64.25%. The two blocks played 16,007 and 15,868 real rounds. In 131 and 102 matches respectively, one round reached the 600-second cutoff. The independent game-rule tally agreed on all 3,600 series. The same two blocks met the three-frag band on **9/9** pairs each. [Paired matches and uncertainty](../reports/gravity-bot-rebuild/scorecard.py)

The top pair played 100 further bags in both seats on 112501–112600. Tier 10 earned **80.50% → 69.75% at three frags** and **95.00% → 68.25% at seven frags**. The frozen expert won 190 of the 200 seven-frag series, and the new expert won 128 with 17 censored. A 95% interval resampling whole bags spans 61.50–74.75% for the new policy at seven frags. Its three seven-frag blocks together gave tier 10 **406 of 600 match points (67.67%)**.

The complete frozen controls put **zero of nine adjacent pairs** in band at seven frags on either block. On the reserved bags, frozen tier 3 won every series against tier 2, and tier 7 earned 99% of the points against tier 6. Their new shares were 63.25% and 64.00%. Each percentage below pools 100 bags played in both seats. The interval resamples whole bags. [Seed-level matches and scorecard](../reports/gravity-bot-rebuild/scorecard.py)

| Higher tier vs lower | Three frags, 94101 | Three frags, 89801 | Seven frags, 94101 | Seven frags, 89801 | New seven-frag 95% interval, 89801 |
|---|---:|---:|---:|---:|---:|
| 2 vs 1 | 67.00% → 62.50% | 74.00% → 64.00% | 78.00% → 66.00% | 84.00% → 65.75% | 61.25–70.25% |
| 3 vs 2 | 94.00% → 67.50% | 96.50% → 65.50% | 100.00% → 67.00% | 100.00% → 63.25% | 58.50–68.00% |
| 4 vs 3 | 79.50% → 64.50% | 73.00% → 59.50% | 86.50% → 66.25% | 85.50% → 62.50% | 57.75–67.50% |
| 5 vs 4 | 83.00% → 66.00% | 79.00% → 64.75% | 94.50% → 66.50% | 91.50% → 69.00% | 64.00–74.00% |
| 6 vs 5 | 78.00% → 67.50% | 76.50% → 64.75% | 90.00% → 68.75% | 88.00% → 66.25% | 61.75–70.75% |
| 7 vs 6 | 92.00% → 67.50% | 93.00% → 59.75% | 99.00% → 69.25% | 99.00% → 64.00% | 59.75–68.25% |
| 8 vs 7 | 80.50% → 64.25% | 84.00% → 63.00% | 93.50% → 64.25% | 97.50% → 62.50% | 58.75–66.50% |
| 9 vs 8 | 87.50% → 57.75% | 88.00% → 59.75% | 98.00% → 63.25% | 97.00% → 58.50% | 54.50–62.25% |
| 10 vs 9 | 88.50% → 69.75% | 86.00% → 68.00% | 94.50% → 70.50% | 92.50% → 64.25% | 58.00–70.25% |

| Format and first bag | Pairs in band, old → new | Rounds played, old → new | Censored series, old → new |
|---|---:|---:|---:|
| Three frags, 94101 | 1/9 → 9/9 | 7,015 → 6,572 | 0 → 73 |
| Three frags, 89801 | 0/9 → 9/9 | 6,958 → 6,505 | 0 → 52 |
| Seven frags, 94101 | 0/9 → 8/9 | 17,608 → 16,007 | 0 → 131 |
| Seven frags, 89801 | 0/9 → 9/9 | 17,585 → 15,868 | 0 → 102 |

Closer odds come with longer local matches. On the reserved bags the median completed seven-frag series took **9.57 → 16.32 minutes** of active board time. The 90th percentile rose from **19.39 to 31.98 minutes**. Tier 10 versus tier 9 moved from 3.35 to 18.77 minutes at median, while tier 2 versus tier 1 moved from 20.52 to 18.80. For three frags the pooled median and 90th percentile changed from 3.73 / 7.71 to 6.61 / 13.01 minutes. These figures exclude countdowns, victory animations and censored series. The longer end of the range merits direct play feedback. [Duration and completion counts](../reports/gravity-bot-rebuild/scorecard.py)

## Odyssey rivals and the campaign instrument

The campaign instrument is pinned at `8dc68d825`. Its entry point checks out the executable policy, level data, original opponents, cadence and simulation rules together. The rival comparison substitutes the authored opponent on all 600 rival cells, keeping each proxy player, seed and cadence. The other 3,900 cells are shared. The 60 orbs use the original goals, stars, gravity and player-facing pace requirements. “Regular” and “strong” in the human-pace trial are input cadences for two simulated player policies. [Frozen benchmark command](../scripts/odyssey-benchmark/frozen-campaign.mjs) · [Campaign gates](../reports/gravity-bot-rebuild/campaign-gates.py)

**All nine campaign gates passed** on six reports covering the November 4 archive, the frozen instrument, the remapped rivals, the local calibration, the high-stack optimization and the final build. Each current report contains 4,500 distinct attempts on 12001–12005, 13001–13005 and 16001–16005. Nine wall-clock interruptions in the earlier runs were replayed to a simulated outcome. Each of the final three repeats replayed all 600 authored rival cells and reused the 3,900 solo cells. All gameplay fields in each set of 4,500 records matched the preceding remap. The largest eligible within-chapter rise was 2.8 at orb 47 in every report. The final chapter’s skilled proxy is exactly at its nine-win floor. [Full gate verdicts, levels and attempts](../reports/gravity-bot-rebuild/evidence.json.gz)

| Rival orb | Novice | Regular | Skilled | Expert | Quad |
|---:|---:|---:|---:|---:|---:|
| 5 | 15 → 15 | 15 → 15 | 15 → 15 | 15 → 15 | 15 → 15 |
| 10 | 15 → 15 | 15 → 15 | 15 → 15 | 15 → 15 | 15 → 15 |
| 18 | 15 → 15 | 15 → 15 | 15 → 15 | 15 → 15 | 14 → 15 |
| 26 | 13 → 15 | 15 → 15 | 15 → 15 | 15 → 15 | 14 → 11 |
| 34 | 11 → 10 | 15 → 14 | 14 → 14 | 15 → 15 | 11 → 13 |
| 48 | 7 → 9 | 11 → 14 | 15 → 12 | 15 → 15 | 7 → 10 |
| 56 | 9 → 5 | 13 → 9 | 14 → 14 | 15 → 15 | 8 → 10 |
| 60 | 2 → 1 | 5 → 4 | 11 → 9 | 15 → 15 | 9 → 1 |

Each count is wins per **15** with the same frozen player. The Quad profile on Neon shows the largest loss, eight wins. The Quad gate applies to authored Quad goals. Neon's primary objective is frags.

The archived November 4 inputs give 9/9 gates. On orb 60 their regular and skilled design proxies won 3/15 and 12/15. With the original bots at the audit revision, those counts are 5/15 and 11/15. On seed 12004 the skilled player switched from a win to a loss. Replaying 35 selected cells at the November 4 refit and separately restoring only the preceding garbage-insertion rule at the audit revision reproduced the same 35 historical outcomes. Commit `133001a3d` made a newly completed row settle immediately when garbage enters, without crediting a player clear. This explains a measurable change predating the bot branch. Human-pace counts below use their own, separately matched controls. [Garbage settle regression](../tests/unit/garbage-settle-clears.test.js) · [Historical refit and D8](ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md#810-the-bots-weights-re-fitted-2026-11-04)

Each entry gives **player wins at regular / strong pace**, original → remapped. The historical and 96101 panels informed calibration. The 97601 panel was reserved before selecting the late rival settings. All eight rivals meet both historical limits and the 10-point margin on 96101. On 97601, strong-paced players lost one more game to Nova than the three-win tolerance permits. Paired wins and losses can change even when the total is close. For example, against Neon on the historical strong panel, nine losses became wins and ten wins became losses. [Authored opponents](../src/core/odyssey/data/level-design-2026-11.js) · [Seeded human-pace runner](../reports/gravity-bot-rebuild/rivals.mjs)

| Orb and rival | Tier | Pace cap, APM | Historical regular / strong | 96101, each /32 | 97601, each /32 |
|---|---:|---:|---|---|---|
| 5 Cinder | 1 → 1 | 90 | 10/10 → 10/10, each /10 | 32/32 → 32/32 | — |
| 10 Coral | 2 → 2 | 120 | 10/10 → 10/10, each /10 | 32/32 → 32/32 | — |
| 18 Willow | 3 → 2 | 165 | 10/10 → 10/10, each /10 | 31/31 → 32/32 | — |
| 26 Frost | 4 → 4 | 230 | 9/10 → 10/9, each /10 | 29/31 → 31/31 | — |
| 34 Zephyr | 5 → 4 | 270 | 9/9 → 8/10, each /10 | 24/32 → 26/32 | — |
| 48 Nova | 6 → 5 | 300 | 21/30 → 23/29, each /30 | 19/29 → 21/28 | 19/29 → 20/25 |
| 56 Prism | 6 → 5 | 330 | 17/23 → 18/23, each /30 | 14/28 → 16/29 | 15/28 → 16/25 |
| 60 Neon | 8 → 6 | 340 | 4/14 → 3/13, each /30 | 3/14 → 4/13 | 5/16 → 2/14 |

Nova sometimes presses a threatened opponent earlier. Prism always looks for a release when digging and occasionally pays a small shot against a nearly full opponent. Each picks its playing style from a fixed seed at the beginning of the match. Neon recognizes a second public preview on 52% of spawns. The style draw is independent of the player’s profile and score. The published pace caps and reaction windows still govern their hands. [Rival controller](../src/core/odyssey/OdysseyBotMatch.js)

Campaign rule R8 now checks increasing authored hand speed, nondecreasing board-reading tier, ordered reaction windows, and the existing human limits of 360 APM and a 140 ms minimum reaction. The previous fixture required every tier 1–4 encounter to inherit local hands. Willow and Coral now share a reading tier and retain different authored paces. A separate regression pins the exact tier, hand speed and reaction window for every rival. [R8 campaign rule](../tests/unit/odyssey-campaign-design-rules.test.js) · [Exact authored settings](../tests/unit/odyssey-campaign-config.test.js)

Nova's one-win miss on the strong 97601 check prompted a predeclared repeat on another 32 untouched bags, 99301–99332, with exactly the same authored settings. Regular wins went **34 → 39/64**, strong wins **59 → 59/64**. Both meet the six-win limit on this larger panel. Pooling only the two post-selection blocks gives 53 → 59/96 regular and 88 → 84/96 strong. The earlier 25/32 strong result remains part of the evidence.

A separate frag-goal experiment gave the rival an earlier payable attack when its next credited KO would win and its opponent had at most ten free rows. On sixteen new bags played by both human-paced proxies, player wins changed **48 → 47/64** against Nova, **47 → 42/64** against Prism and **19 → 20/64** against Neon. Prism alone qualified for a longer test. On its historical regular panel that setting moved player wins from the frozen **17 to 20/30**. On the independent 97601 strong panel it moved them from **28 to 22/32**. Both exceed the approved tolerance. Prism keeps its ordinary pressure response. On the two additional sixteen-bag panels, 89051 and 90051, the ordinary Prism's regular counts were 14 → 21 and 21 → 16, each out of 32. Across all four larger Prism panels the frozen/live totals were 64 → 69/128 regular and 109 → 108/128 strong. The small-panel spread matters when estimating a human's win odds. [Frag-goal experiment](../reports/gravity-bot-rebuild/rivals.mjs)

Rival duration also varies at the preserved pace caps. On the 15 campaign bags, the native-cadence stacker spent a median of 7.1 → 5.4 minutes against Nova and 6.8 → 9.5 against Neon. The steady-cadence cascade player spent 3.0 → 3.4 minutes against Nova and 3.6 → 4.4 against Neon. These are simulated encounter times. [Campaign attempts](../reports/gravity-bot-rebuild/evidence.json.gz)

## Frame cost

The reference host ran Electron 44.9.3 and Chromium 152.0.7977.167 on a Ryzen 9 9955HX3D and RTX 5080 Laptop GPU, using ANGLE Direct3D 11. The packaged game drew to a 1280 × 720 offscreen window at normal Windows priority and delivered GPU shared textures. The display metric counts elapsed time between Chromium animation callbacks. A two-refresh interval is at least 33.08 ms at 60 Hz or 11.87 ms at 165 Hz, including the 0.25 ms timestamp tolerance. The scorecard also reports intervals beyond two refreshes plus 0.25 ms. Planner times measure elapsed work across all seats between callbacks. The complete active-update times also include applying each accepted input and the game effects it triggers. [Packaged renderer and timing boundaries](../reports/gravity-bot-rebuild/rendered-match.cjs)

The host restarted during the second three-expert 60 Hz replay on November 19. Seventeen complete recordings survived. On November 20 the recorder played the saved live input tape again from the beginning with the same packaged build. The archive preserves the 19 half-minute host-load samples from the interrupted attempt separately. This pair crosses desktop sessions.

On eight real opening deals played in both three- and four-expert rooms, 40% and 47% of completed search batches repeated the same public position. The opponents now share one copy of that work. Each seat spends its original number of logical ticks before acting. The cache includes the labelled board, active pose, public queue, pressure, reward context, weights and search allowance. Paired runs with sharing off and on exactly matched every decision, board, queue, score and final round tally. Two passes per deal took **3.19 → 2.08 seconds** of aggregate planning with three experts and **2.89 → 1.78 seconds** with four. Total process CPU across the same rounds fell from 6.00 → 3.66 and 4.36 → 3.53 seconds. [Paired multi-seat runner](../reports/gravity-bot-rebuild/shared-work.mjs)

The CPU profile put 52% of samples in the compact gravity resolver. Its new stable ordering visits fragments once per wave. Empty rows above the stack and fragments already supported by the floor can be skipped. On 8,246 near-full-row probes taken from real games, all four implementations gave identical wave vectors and labelled boards, including two six-wave cases. Eight rotated passes of 65,968 settles each took median CPU times of 476.5, 437.0, 398.5 and 390.0 ms as each optimization landed. A direct comparison with the production code took **469 → 367 ms**, a 22% reduction. Two further ways of settling falling groups gave the same boards but increased CPU time. On 48 real search roots, including 11 with garbage, reusing a fixed shape for quiet placements and scanning their ten column counts directly cut median CPU from **703 → 625 ms** per 144 searches. All 80 opening games matched their earlier outcomes byte for byte. [Gravity cost and equivalence](../reports/gravity-bot-rebuild/settle-cost.mjs) · [Whole-search comparison](../reports/gravity-bot-rebuild/search-cost.mjs)

Every clear takes one cell from each column, and falling bodies stay in their columns. The sparsest column therefore bounds the total rows a trigger can pay. When a reachable trigger fills a row and leaves only one cell available in some column, its reward is known exactly. The production search uses this fact to skip settled-board simulations for hypothetical discharges. On the same 48 roots, counting total material gave **672 → 641 ms**. Counting by column gave **625 → 547 ms** with identical rankings and proved routes. A separate direct comparison during the background fits gave a smaller **1,109 → 1,062 ms** gain. All 640 trigger-depth checks and all 80 native opening games matched the preceding policy. Reusing the resolver's input storage alone yielded 304.5 → 297.0 ms and was omitted. [Search and regression fixture](../src/core/ai/gravity-bot.test.js)

On the same 48 roots, updating the four cells of a retained quiet board gave 766 ms per 144 searches with both methods. Caching the height of the top garbage row gave 750 ms in that comparison. On the 11 attacked boards alone, updating the count of blocks above garbage holes gave 422 ms with both methods. Across all 48 roots that change cost 1,016 ms against 985 ms. These trials preserved every ranked root and predicted route. The implementation keeps the direct scan.

Precomputing the lowest shape cell in each column, encoding landings as integers and indexing releases by position took 735, 766 and 765 ms respectively against 750 ms on the same 48 roots. Combining all three took 749 ms. On the 8,246 gravity probes, retaining the final fragment ownership array and skipping reconstruction after a stationary wave cut the settle batch from 336.5 to 313 ms. Its whole-search comparison measured 765 against 750 ms. The measured differences on complete searches were at most 2.2%, so these variants were omitted.

Six real boards per condition were replayed in Electron at tier 10, with two passes per cadence. Columns give p95 / p99 in milliseconds of active isolated controller updates after the column bound landed. The first 60 Hz rubble pass exceeded the 4 ms p99 limit at 6.7 ms, against 7.1 ms in the previous build. All first-plan deadlines on these fixtures were met. Tier 3's clean-roof rescue reached 2.0 / 3.2 ms at 60 Hz and 0.8 / 1.3 ms at 165 Hz on its first pass. Deferring part of the first tick's work to the following reaction ticks increased the warm Infinity p99 from 2.1 to 5.7 ms in a paired trial. [Pressure runner](../reports/gravity-bot-rebuild/pressure-timing.mjs) · [Source of the pressure and Infinity fixtures](../reports/gravity-bot-rebuild/fixture-variants.mjs)

| Condition | 60 Hz, pass 1 | 60 Hz, pass 2 | 165 Hz, pass 1 | 165 Hz, pass 2 |
|---|---:|---:|---:|---:|
| Six-row attack | 1.4 / 6.7 | 0.8 / 1.8 | 0.5 / 0.7 | 0.3 / 0.4 |
| Garbage at the roof | 2.0 / 3.3 | 1.2 / 1.9 | 0.6 / 1.0 | 0.5 / 0.7 |
| Naturally built clean high stack | 0.3 / 1.0 | 0.2 / 0.4 | 0.2 / 0.3 | 0.2 / 0.2 |
| 44-row Infinity well | 1.7 / 2.6 | 1.3 / 3.1 | 0.7 / 1.2 | 0.6 / 0.9 |

Two ten-minute three-expert runs at 165 Hz bracketed the column optimization. Aggregate planning p95 / p99 was 0.7 / 1.4 ms in both. The largest updates were 6.6 and 8.4 ms, each the only planner update over one display frame. Intervals longer than two frames plus 0.25 ms counted 184 live versus 211 replay before the change, and 374 versus 574 after it. No planner update consumed a whole frame during any of those long intervals. The latter pair matched all 105 labelled-board checks. In a separate eight-minute diagnostic, Chromium took 775,488 thread samples and the planner stayed inside one frame on all 13,200 active updates. That trace supplies no CPU stack for the earlier spikes. [Packaged runner](../reports/gravity-bot-rebuild/rendered-match.cjs) · [Sample-to-frame comparison](../reports/gravity-bot-rebuild/frame-profile.py)

During a ten-minute three-expert match, two updates exceeded the 6.06 ms frame at 165 Hz. The first took 6.8 ms across five calls around ticks 1798–1799 of round one. Replaying the same 628 inputs and six labelled-board checks showed that the high-stack trigger test searched for landings after finding every possible trigger. It now stops once the actual movement search reaches their physical positions. Across 641 boards and all seven shapes, the two methods agreed on all 1,697 candidate positions, including 280 that could not be reached. In 40 alternating repetitions on the packaged V8 engine, the five calls took **3.24 → 1.76 ms at median**, **6.37 → 3.27 ms at p95** and **13.71 → 8.46 ms at maximum**. Four repetitions exceeded a frame before the change and two after it. On a broader panel of 48 roots the median CPU times were 1,235 and 1,234 ms for 144 searches. The second recorded spike took 7.0 ms in the game and 0.15 ms at median on its 423-input replay. [Reproduce the high-board comparison](../reports/gravity-bot-rebuild/roof-triggers.mjs) · [Replay the recorded input windows](../reports/gravity-bot-rebuild/replay-cost.mjs)

The mixed room paired tiers 1, 4 and 9 at 60 Hz for two minutes before the high-stack change. Live and input replay delivered 59.6 and 59.8 Hz and matched all 19 board, score and queue checks. Across 2,142 active updates, aggregate planning took 1.5 / 2.5 / 12.5 ms at p95 / p99 / maximum. The whole active bot updates took 1.8 / 3.4 / 12.8 ms. First-plan lateness was zero at p95, with a 930 ms maximum. An interrupted plan took up to 150 ms to recover. At the two-refresh threshold of 33.33 ms with a 0.25 ms measurement tolerance, the display missed 26 intervals live and 13 on replay. Eight of the 26 included planning. None of those planner calls used a full frame.

After the change, the same mixed room delivered **59.6 Hz** live and on tape. Its 2,156 active planner updates took **1.3 / 2.3 / 12.3 ms** and the full bot updates took **1.7 / 3.0 / 12.8 ms**. All 19 board and queue checks matched. The display recorded 23 two-refresh intervals live and 25 on tape, with 6 of the live intervals overlapping planning. First-plan lateness at p95 was zero, and recovery at p95 took 150 ms. This two-minute mixed-tier check supplements the ten-minute expert-room series.

A separate three-expert load test inherited the below-normal scheduling priority of the background fits. A 165 Hz request then delivered 95.6 Hz live and 78.8 Hz on the identical input replay. The planner exceeded 6.06 ms on four of 14,731 active updates, with a maximum of 10.1 ms. The mixed room and reference matrix use the ordinary Windows game priority. The ledger includes the priority, delivered frame intervals and labelled replay checks for each reference recording. [Packaged match measurement](../reports/gravity-bot-rebuild/rendered-match.cjs)

Caching the lowest score in the beam and delaying allocation reduced CPU time on 48 search roots from 672 to 641 ms. In an alternating replay of a real single-expert room, both paths reproduced all 4,074 inputs and 108 board checks. Across eight measured passes, the planner's median p95 improved from 1.174 to 1.159 ms, while the median of the worst frame rose from 3.06 to 3.54 ms. The live planner keeps the original shortlist implementation.

The first between-tick experiment replayed the actual input tapes against an ideal 165 Hz timing schedule. Each seat could prepare up to its next 60 Hz tick's share of pure search. The replay counted that work in the frame where it ran. Over four alternating measured passes, the single expert's p95 / p99 fell from 1.743 / 2.540 to 0.782 / 1.254 ms. Total process CPU rose from 5,922 to 6,007 ms per ten-minute game. With three experts the p95 fell from 0.367 to 0.189 ms and with four from 0.317 to 0.171 ms. All three rooms reproduced the same 28,113 input commands and 321 labelled boards.

In the first ten-minute single-expert capture at 165 Hz, 60,984 batches ran between ticks. The packaged game's aggregate p95 / p99 changed from **1.6 / 2.2 to 1.4 / 2.2 ms**. Its maximum rose from 4.7 to 5.9 ms. Every one of the 14,043 active updates fit within 6.06 ms. The new build's fixed-tick work by itself still had a 1.6 ms p95, and the between-tick work had a 1.0 ms p95. All 108 labelled checkpoints and the 4,073-command common prefix matched the earlier build.

Four alternating V8 passes then replayed the actual callback schedule from that capture. The on/off comparison matched every command, all 108 labelled checkpoints and the exact number of batches on all 5,903 preparation callbacks. Preparing between ticks reduced the median p95 from **1.727 to 1.183 ms** and p99 from **2.494 to 1.933 ms**. Process CPU rose from 5,875 to 5,992 ms. The median of each pass's worst frame rose from 5.55 to 6.68 ms. All frame costs include both kinds of work and group callbacks by the actual display frame. [Replay the recorded timing comparison](../reports/gravity-bot-rebuild/replay-cost.mjs)

The same single-expert game and its input replay delivered **162.8 and 163.1 Hz** and matched all 108 labelled-board checks. Using the two-refresh threshold with a 0.25 ms tolerance, the display missed 1,195 intervals live and 988 on tape. Of the 1,195 live intervals, 358 overlapped planning. At the stricter threshold above two frames plus 0.25 ms, the counts were 50 and 45. The previous build recorded 322 and 243 at the inclusive threshold on its matched pair.

On the final build, the 60 Hz mixed room with tiers 1, 4 and 9 delivered 59.8 Hz live and on replay. Planning took 0.9 / 1.5 / 9.6 ms at p95 / p99 / maximum. The full active bot updates took 1.2 / 2.1 / 10.0 ms. Both runs had 14 two-refresh intervals and agreed on all 19 board and queue checks. First-plan lateness at p95 was zero, and interrupted plans recovered in 150 ms at p95.

The recorded-schedule comparison also replayed all 10,427 inputs and 105 checkpoints from the three-expert match, and all 13,618 inputs and 108 checkpoints from the four-expert match. Values are medians of four alternating passes in the packaged V8 engine. The frame percentiles include all work on each active display frame. Process CPU includes the simulated game and verification.

| Room | Planner p95, off → on | Planner p99, off → on | Worst frame, off → on | Process CPU per ten-minute game, off → on |
|---|---:|---:|---:|---:|
| One expert | 1.727 → 1.183 ms | 2.494 → 1.933 ms | 5.554 → 6.681 ms | 5,875 → 5,992 ms |
| Three experts | 0.317 → 0.228 ms | 0.527 → 0.405 ms | 1.763 → 1.575 ms | 2,532 → 2,602 ms |
| Four experts | 0.143 → 0.099 ms | 0.255 → 0.177 ms | 1.044 → 0.737 ms | 1,594 → 1,547 ms |

### Pressure, roof and Infinity on the final build

The renderer replayed 24 boards after the fitting workers finished. The previous and final builds matched the choices, work counts and first-plan deadlines on all 192 isolated controller comparisons across tiers 3 and 10. With the fixed clock, enabling preparation also preserved all 96 paired expert choices and deadlines. Every first plan was ready on time. The 5,410 active isolated updates, 988 fixed-clock updates with preparation off, and 1,544 with it enabled all fit inside a display frame. Each table entry gives p95 / p99 elapsed update time in ms, first with preparation disabled and then enabled. At 60 Hz every callback owes a logical tick. At 165 Hz the intervening callbacks can share its work. [Pressure runner](../reports/gravity-bot-rebuild/pressure-timing.mjs) · [Measurements for both tiers](../reports/gravity-bot-rebuild/scorecard.py)

| Fixed expert, six boards per cell | 60 Hz first, off → on | 60 Hz repeat, off → on | 165 Hz first, off → on | 165 Hz repeat, off → on |
|---|---:|---:|---:|---:|
| Six-row attack | 0.4 / 0.5 → 0.4 / 0.7 | 0.4 / 0.6 → 0.4 / 0.6 | 0.4 / 0.6 → 0.2 / 0.3 | 0.4 / 0.5 → 0.2 / 0.3 |
| Garbage at the roof | 0.4 / 0.7 → 0.4 / 0.6 | 0.4 / 0.5 → 0.3 / 0.5 | 0.4 / 0.6 → 0.2 / 0.3 | 0.3 / 0.6 → 0.2 / 0.3 |
| Naturally built clean high stack | 0.2 / 0.2 → 0.2 / 0.3 | 0.1 / 0.2 → 0.2 / 0.2 | 0.2 / 0.9 → 0.1 / 0.2 | 0.2 / 1.1 → 0.1 / 0.1 |
| 44-row Infinity | 0.9 / 1.1 → 0.8 / 1.1 | 0.8 / 1.1 → 0.9 / 1.2 | 0.8 / 1.4 → 0.7 / 1.5 | 0.8 / 1.2 → 0.8 / 1.1 |

At tier 3 the six-row attack took 1.0 / 3.2 ms on the first isolated 60 Hz pass, against 1.1 / 2.9 in the previous build. The clean high-stack response took 0.8 / 1.4 and 0.6 / 1.2 on the two 60 Hz passes. The expert's isolated Infinity p99 was 1.7 and 1.2 ms at 60 Hz, and 0.5 ms on both 165 Hz passes.

### Local presentation clock

Odyssey already supports running its logic on the display callback when the target rate fits the monitor. After the background simulations finished, four local experts played the same two minutes at 165 Hz with each clock. Each run had its own action replay. Every start detected 165 Hz, every clock engaged as intended, and each order matched 2,429 inputs and all 23 labelled boards across clocks. The figures below include all intervals lasting at least two refreshes minus 0.25 ms. [Clock comparison runner](../reports/gravity-bot-rebuild/display-clock.mjs)

| Order and clock | Planner p95 / p99 / maximum, ms | Intervals, live / replay | Excess | Mean system CPU, live / replay |
|---|---:|---:|---:|---:|
| First, timer | 0.3 / 0.5 / 2.2 | 41 / 43 | −2 | 6.8% / 6.8% |
| First, display | 0.2 / 0.4 / 2.2 | 37 / 44 | −7 | 6.8% / 7.1% |
| Reversed, display | 0.2 / 0.4 / 2.3 | 47 / 44 | +3 | 6.9% / 6.9% |
| Reversed, timer | 0.3 / 0.5 / 2.5 | 40 / 43 | −3 | 7.0% / 7.1% |

The trial required the display clock to clear the planning limits, add zero intervals against its own tape, and reduce the excess by at least five in each order. The four live runs cleared the planning limits. The display clock improved the excess by five in the first order and worsened it by six in the second. Local matches retain their existing presentation clock.

### Where the four-seat renderer spent a long frame

In a separate ten-minute 165 Hz game Chromium recorded 1,006,012 renderer-thread samples at a requested 400 μs interval. The game delivered 164.5 Hz. All 39,108 planning updates stayed within one frame, with p95 / p99 / maximum of 0.3 / 0.5 / 3.5 ms. Three whole bot updates exceeded 6.06 ms. Their longest input was a hard drop in each case. All 172 JavaScript chunks in the build with hidden source maps matched the measured package byte for byte. The maps resolved 224 sampled locations across ten chunks. [CPU window attribution](../reports/gravity-bot-rebuild/frame-profile.py) · [Verified source locations](../reports/gravity-bot-rebuild/profile-sources.mjs)

| First-round tick | Aggregate bot update / planning | Longest applied input | Samples inside that input |
|---:|---:|---:|---|
| 12 | 13.2 / 0.0 ms | 13.0 ms | 24 of 45 in the board-effect ring texture painter, 3 in the hard-drop effect |
| 16 | 10.8 / 1.4 ms | 3.5 ms | 2 of 7 in the same painter |
| 702 | 6.2 / 0.0 ms | 6.0 ms | 24 across the actual drop, including cascade resolution and Phaser |

The longest displayed interval lasted 72.7 ms. Of its 128 renderer-thread samples, 86 landed inside Phaser's WebGL program completion. Another 60.6 ms interval included 61 samples in program completion and 24 in the ring painter. The 66.7 ms interval between them in the ranking had 109 of 118 samples in Chromium's idle state. Across the 16 longest intervals, 449 of 1,188 samples were idle and 302 were in program completion. The largest gap between samples was 1.7 ms. Six of the 16 intervals had measured bot planning, totaling 5.7 ms. A display interval spans several renderer activities, and idle samples leave the GPU and compositor work unobserved. [Hard-drop effect](../src/rendering/phaser/shared-effects.js) · [Procedural texture kit](../src/rendering/phaser/fx/fx-kit.js)

To test the ring's contribution, the renderer painted one quadrant, reflected its pixels, and reused the result for the four boards. A preliminary trial ran 24 fresh Electron V8 processes per variant using typed pixel buffers. The original, reflected and cached methods produced identical bytes. At p95 the first ring took 1.52, 1.16 and 1.28 ms respectively. Across four initializations the cached method used 1.35 ms for the rings against 2.47 ms originally.

Four fresh, unprofiled 45-second matches then timed the actual Phaser effects at 165 Hz. Each used the packaged game, four expert seats and the same observer. All 1,222 commands, eight board checks and nine real canvas texture hashes per seat matched across all four games. The first drop improved from **5.5 to 5.2 ms** in the first order and **5.8 to 5.2 ms** in reverse order. The median of the four seats' first drops moved from 1.70 to 1.35 ms and from 1.90 to 1.25 ms. All 16 first effects fit in one frame without the profiler. The trial required a 2 ms gain on both first-use measures in both orders. The production renderer keeps its existing texture kit. The ledger contains the candidate patches, timed inputs, RGBA hashes and reproduction drivers under `fourExpertThreadSamples.hardDropEffectTrial`. [First-use measurements](../reports/gravity-bot-rebuild/evidence.json.gz)

## Verification

At a simulated 165 Hz display cadence, the final policy exactly reproduced the prior build's 1,800 first-knockout matches, 1,800 three-frag series and 1,800 seven-frag series. The short races contained 6,572 rounds and the seven-frag continuation reached 16,007. The same comparison reproduced all 80 opening deals, all 80 native 120-lock games, all 400 native 200-lock games and the further 40 expert survival games. The ledger records a digest of each matched panel. The packaged runs above replay the real callback and input timings.

The final tree passed **682 tests across 43 focused files** covering the opponents, benchmark, movement, multiplayer clocks and campaign rules. TypeScript passed. The source lint comparison covered 22 changed files and found the same 37 errors and 12 warnings as the original revision. Vite built the production package in 39.73 seconds. Its entry loads three static chunks totaling 12 KB, and the main entry loads four totaling 1,291 KB. [Recorded checks](../reports/gravity-bot-rebuild/evidence.json.gz)

The native Windows full run passed **26,771 tests**, with 37 skipped. Two display assertions expect comma thousands separators. This host renders “8 025” and “48 210” in Swedish. A separate TTS recorder suite stopped when Windows denied its directory symlink. Each of those three files failed the same way on the original revision. The frozen benchmark command reproduced the expert's orb 49 seed-40 primary goal on lock 105. [Campaign construction regression](../tests/unit/odyssey-benchmark-authored-construction.test.js)

## Reproducing a run

Use a new output path for each comparison. Training, selection and final panels have separate seeds. The campaign wrapper checks out the exact local Git object in a temporary directory and runs the original JavaScript instrument against its original levels and opponents.

```powershell
node reports/gravity-bot-rebuild/run.mjs 10 1001 40 16 openings.jsonl
node reports/gravity-bot-rebuild/pressure.mjs dig 1001 16 dig.jsonl
node reports/gravity-bot-rebuild/pressure.mjs scheduledDig 1001 16 live-dig.jsonl
node reports/gravity-bot-rebuild/pressure.mjs scheduledControl 1001 16 old-dig.jsonl
node reports/gravity-bot-rebuild/patterns.mjs patterns.json
node reports/gravity-bot-rebuild/chain-demo.mjs 1006 chain.md
node reports/gravity-bot-rebuild/roof-triggers.mjs roof-triggers.json
node scripts/verify-cascade-live.mjs 16 10 1006
node scripts/verify-cascade-live.mjs 16 10 1006 --legacy
node scripts/diagnose-cascade-bot.mjs 16 10 1006
npm run benchmark:odyssey:frozen -- --levels 49 --profiles expert --samples 1 --seed-start 40 --output frozen-49
```

The parallel runners accept the local worker-pool path and a worker count. Run the scorecard against the checked-in ledger to print bag-clustered uncertainty, rival outcome flips and live/replay frame costs.

```powershell
$pool = 'C:/Users/olovm/serenity-blocks-private/bot-weights-fit-2026-11-03/pool.mjs'
node reports/gravity-bot-rebuild/validation.mjs $pool ladder '1,2,3,4,5,6,7,8,9' 91101 100 150 first-ko.jsonl 2
node reports/gravity-bot-rebuild/validation.mjs $pool frags '1,2,3,4,5,6,7,8,9' 94101 100 600 full-frags.jsonl 2
node reports/gravity-bot-rebuild/validation.mjs check-frags full-frags.jsonl adjudication.json
node reports/gravity-bot-rebuild/validation.mjs extend-frags $pool 7 default-frags.jsonl 2 full-frags.jsonl
node reports/gravity-bot-rebuild/validation.mjs check-frags default-frags.jsonl default-adjudication.json
node reports/gravity-bot-rebuild/validation.mjs $pool commonJudgment '1,2,3,4,5,6,7,8,9' 91101 100 150 ordinary-reading-equal-hands.jsonl 2
node reports/gravity-bot-rebuild/rivals.mjs $pool '48,56,60' '15001+5,17001+10' human-pace.jsonl - 2
node reports/gravity-bot-rebuild/traces.mjs cold-process.json
node reports/gravity-bot-rebuild/native-intent.mjs native-intent.jsonl live
node reports/gravity-bot-rebuild/native-intent.mjs original-intent.jsonl control
python reports/gravity-bot-rebuild/scorecard.py
python reports/gravity-bot-rebuild/scorecard.py --calibration
```

To run a new joint weight fit, start the four-worker process below normal priority. The original fit used the early planner recorded at `00a4aee41`. For campaign authoring, `npm run benchmark:odyssey` uses the working checkout. Use `benchmark:odyssey:frozen` for comparisons against the pinned instrument. For a playtest, `npm run dev -- --port 5187` opens a separate Vite instance. Choose Local Multiplayer and set the opposing seat to a bot at the desired tier. The [blind review](../reports/gravity-bot-rebuild/blind-review.html) accepts the direct-play response separately.

```powershell
$fit = Start-Process node -ArgumentList @('reports/gravity-bot-rebuild/fit.mjs', $pool, 'joint-fit.jsonl') -WindowStyle Hidden -PassThru
$fit.PriorityClass = 'BelowNormal'
```

The local calibration can also be rescored without replaying its training games. Export the JSON objects in `localCalibration.alignedJudgmentFit.training`, `localCalibration.expandedFit.additionalTraining` and `localDefaultFrags.training` from the ledger as one object per line in `factorial.jsonl`, `balanced.jsonl` and `seven.jsonl`. The first command below recomputes the first-KO and short-match fit. The second evaluates those fixed probabilities on the default finish and fits the same parameter family using all three outcomes.

```powershell
node reports/gravity-bot-rebuild/style-fit.mjs select factorial.jsonl short-fit.json balanced.jsonl
node reports/gravity-bot-rebuild/style-fit.mjs default-seven seven.jsonl default-fit.json short-fit.json factorial.jsonl balanced.jsonl
```

The packaged test plays the actual local match and the authored Neon encounter in Electron with offscreen shared-texture rendering. Each live run writes its control tape. A fresh game then plays those inputs and compares scores, piece counts, cell types, body connectivity and queued rows. The second pass reverses the order of the display rates. Each capture lasts ten real minutes. Running all 32 on one GPU takes about five hours and twenty minutes plus startup.

```powershell
npm run build
& .\reports\gravity-bot-rebuild\render-series.ps1 -OutputDirectory .\artifacts\gravity-render -BuildDirectory .\dist -FirstRate 165 -ThreeSeatSeconds 600 -OtherSeconds 600
```

The presentation-clock comparison plays both clock orders at the same Windows priority. Each live game gets its own input-only replay. The pressure runner measures both cold and warm updates on six real boards each for a six-row attack, high garbage, a clean high stack and Infinity.

```powershell
node reports/gravity-bot-rebuild/display-clock.mjs .\artifacts\clock-four-165 .\dist 4 165 120
& .\node_modules\electron\dist\electron.exe reports/bot-ai-audit-2026-11/timing-host.cjs .\artifacts\pressure.json reports/gravity-bot-rebuild/pressure-timing.mjs reports/gravity-bot-rebuild/fixture-variants.mjs | Out-Host
```

To collect CPU stacks in the packaged game, set a fresh destination for Chromium's renderer profile. The analysis maps its samples to measured planner calls, whole bot updates, individual inputs and the longest display intervals. This pass adds profiler overhead and has its own recording.

```powershell
$env:SERENITY_BOT_BUILD = (Resolve-Path .\dist).Path
$env:SERENITY_BOT_CPU_PROFILE = Join-Path (Resolve-Path .\artifacts).Path 'four-thread.json'
try {
    & .\node_modules\electron\dist\electron.exe reports/gravity-bot-rebuild/rendered-match.cjs .\artifacts\four-profiled.json 4 600 165 | Out-Host
    python -X utf8 reports/gravity-bot-rebuild/frame-profile.py .\artifacts\four-profiled.json $env:SERENITY_BOT_CPU_PROFILE .\artifacts\four-windows.json
    node .\node_modules\vite\bin\vite.js build --sourcemap hidden --outDir .\artifacts\gravity-profile-maps
    node reports/gravity-bot-rebuild/profile-sources.mjs .\artifacts\four-windows.json .\dist .\artifacts\gravity-profile-maps .\artifacts\four-sources.json
} finally {
    Remove-Item Env:SERENITY_BOT_BUILD, Env:SERENITY_BOT_CPU_PROFILE
}
```

To time the fixed ticks around a recorded overrun, run the replay driver inside the same Electron V8 engine. The driver checks the command prefix and labelled boards before returning each sample. A capture with every update inside the frame budget produces an empty event list.

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
try {
    & .\node_modules\electron\dist\electron.exe reports/gravity-bot-rebuild/replay-cost.mjs .\artifacts\gravity-render\packaged-1-3-165.json local-spikes.json 20
} finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE
}
```

The optional `frames` comparison replays every tick and the recorded callback schedule from a local expert room. It alternates four full passes with preparation enabled and disabled. Both sides must reproduce every recorded command and labelled checkpoint. The resulting costs include the work done between logical ticks.

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
try {
    & .\node_modules\electron\dist\electron.exe reports/gravity-bot-rebuild/replay-cost.mjs .\artifacts\gravity-render\packaged-1-1-165.json single-expert-ab.json 4 frames
} finally {
    Remove-Item Env:ELECTRON_RUN_AS_NODE
}
```

The historical expert opening on 1004, the orb 49 seed-40 goal drain and the seed-9101 Infinity chain continue to use the original policies. Standard seeded local bots and Odyssey rival moves change. Infinity keeps its roof-aware movement policy. Both local wells advance their clears and settle delays on the board clock. Odyssey also passes the exact 60 Hz tick duration to elapsed lock scoring. The regression tests compare real input dispositions, wave ticks, routed garbage, scores and body connectivity across 60 and 165 Hz, including catch-up during play and different wall-clock origins. [Local replay test](../tests/unit/local-multiplayer-fixed-mode.test.js) · [Odyssey clock test](../tests/unit/odyssey-bot-match.test.js) · [Controller parity tests](../src/core/ai/gravity-bot.test.js) · [Clock ownership](adr/0012-fixed-tick-overload-rebases-wall-time.md)

Twelve tier-and-bag combinations ran in two fresh processes, one at 60 Hz and one at 165 Hz, with a forced catch-up frame. The two processes matched all 841 decisions, 3,403 input dispositions, 267 waves, 134 outgoing events and 144 labelled-board checkpoints. The public-piece-only and held-board synchronous/sliced tests also cover the seeded mistakes at the lower tiers. The two command-line diagnostics use a separate decision stream from the bag and accept `--legacy` for the old policy on the identical deal. Seed 1006 produced a four-wave fire and three outgoing rows through the revised verifier. [Replay hashes](../reports/gravity-bot-rebuild/traces.mjs) · [Live diagnostic](../scripts/verify-cascade-live.mjs)

The local replay guarantee covers the default bot clock for supported matches. Hot Potato, time-limit matches, Infinity Last Man Standing, a forced variable clock and unavailable clock ownership use the existing wall-time fallback. Their human input and garbage arrival times can vary with rendering. The bag has its own random stream. Each seat draws its per-spawn recognition, reaction delay and placement mistake from its own decision stream. The variation between successive commands uses a separate timing stream. The pressure tests replay actual captured incoming rows. [Clock selection and fallback reasons](../src/core/game-modes/local-multiplayer-loop.js) · [Slot seed derivation](../src/core/ai/local-bot-manager.js)
