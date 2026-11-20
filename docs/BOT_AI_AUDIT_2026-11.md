# How Serenity Blocks bots play gravity

18 November 2026 · Gameplay audit at `8dc68d825db61bc04e1cfb4e4c5a1f580ea3e138`

**Tier 10 already plays cascades. Its weakness is choosing the moves that build a deep one.** On eight 120-piece runs, 82 of its 108 clears had multiple waves. It had forecast 76 of those fires on an earlier piece. Yet it built four waves from empty within 16 pieces on only **2 of 40** openings. A slow player using the same dealt pieces and three visible previews reached **20 of 40**. On 40 fresh seeds the comparison was **1 versus 13**. Every counted search route ran through the real movement, lock and gravity code.

Two other findings affect how a stronger bot would play against a person. The stronger adjacent tier won between **50% and 91%** of decided local rounds. And on **887** decisions with garbage in its actual local queue, the controller saw the pending amount **zero times**. Construction, defense, difficulty and planning time each need their own target. [Rebuild plan](BOT_AI_REBUILD_PLAN_2026-11.md)

## What was measured

A **wave** is one batch of full rows removed before loose bodies settle again. Four rows removed together are one wave. A **fire** is the whole sequence produced by one lock. “Depth” in a garbage summary counts *rows*, while its `complexity` counts *waves*. This audit counts waves from `onLineClear`, score from `GameState`, and attack lines from `calculateGarbage(summary).getTotalLines()`. A six-row, two-wave fire and a four-row, four-wave fire therefore keep their own score and attack values. [Cascade resolver](../src/core/cascade-resolver.js) · [Scoring](../src/core/scoring.js) · [Garbage](../src/core/garbage.js)

| Panel | Deal, horizon and observation |
|---|---|
| Empty openings | Standard empty board, level 1, seeds 1001–1040, at most 16 locks. All ten shipped tiers and the benchmark expert. Search and lookahead variants use these same bags. |
| Longer play | Seeds 1001–1008 continue to 120 locks or top-out, eight runs per tier. Rates pool actual locks or lines. The first 16 locks overlap the opening panel. |
| Fresh openings | Seeds 62001–62040, 16 locks. The visible search settings were fixed before examining this panel. |
| Local ladder | Nine adjacent pairs, 16 shared bag seeds 33001–33016, both seat orders. Native tier pacing, standard garbage, virtual 60 Hz gravity and animation, first top-out or 150 seconds. An expired clock is a draw. |
| Defense | Live queue observations during the ladder, plus a repeatable six-row attack on 16 seeds at tiers 1, 4, 7 and 10. |
| Odyssey and CPU | Human-paced, three-frag rivals on the historical seed/style panel. Separately, two Electron renderer timing passes on identical board states. |

The solo tests execute the bot's legal action sequence once, check that each input succeeds and drain physics before the next decision. They use the game's seeded bag and a separate seeded decision stream. Animation waits and between-input gravity are skipped for these construction tests. The instant-lock bonus is fixed at 50 points per piece for reproducible gross score. Subtract 50 for clear-only score per piece. The ladder and rival tests include gravity, action cadence and animation time. The local ladder injects a shared seeded decision stream through `LocalBotManager`'s existing constructor. The shipping local mode supplies `Math.random` there, so the bag seed alone cannot reproduce a local match. Odyssey already seeds its rival decisions separately. [Solo instrument](../reports/bot-ai-audit-2026-11/solo.mjs) · [Local wiring](../src/core/game-modes/LocalMultiplayerMode.js) · [Odyssey rival](../src/core/odyssey/OdysseyBotMatch.js)

## The ten shipped tiers

The six entries in the spread are **counts of fires with exactly 1 / 2 / 3 / 4 / 5 / 6 waves**. A one-wave fire can clear multiple rows. “Later” is the percentage of *all cleared lines* removed after wave one. Top-outs are per eight long runs.

| Tier | Locks | Fire spread | Later lines / all | Later | Score / piece | Attack / piece | Top-outs |
|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | 767 | 49 / 29 / 16 / 2 / 0 / 0 | 77 / 197 | 39.1% | 162.4 | .132 | 5 |
| 2 | 880 | 70 / 45 / 8 / 3 / 0 / 0 | 82 / 249 | 32.9% | 164.9 | .140 | 3 |
| 3 | 960 | 19 / 68 / 28 / 3 / 0 / 0 | 156 / 318 | 49.1% | 204.4 | .208 | 0 |
| 4 | 960 | 30 / 73 / 20 / 2 / 0 / 0 | 141 / 314 | 44.9% | 190.6 | .197 | 0 |
| 5 | 960 | 58 / 49 / 19 / 8 / 1 / 0 | 131 / 315 | 41.6% | 213.2 | .188 | 0 |
| 6 | 960 | 60 / 55 / 15 / 4 / 2 / 0 | 121 / 320 | 37.8% | 208.1 | .192 | 0 |
| 7 | 960 | 33 / 45 / 23 / 8 / 0 / 0 | 150 / 328 | 45.7% | 221.8 | .228 | 0 |
| 8 | 960 | 33 / 47 / 24 / 6 / 2 / 0 | 150 / 317 | 47.3% | 220.4 | .214 | 0 |
| 9 | 960 | 26 / 48 / 28 / 4 / 0 / 1 | 151 / 321 | 47.0% | 223.4 | .223 | 0 |
| 10 | 960 | 26 / 50 / 24 / 7 / 0 / 1 | 152 / 326 | 46.6% | 230.3 | .227 | 0 |

### Planned setups and opportunistic fires

A fire gets **forecast credit** when an earlier no-clear placement's lookahead specifies the subsequent pieces, landing columns, rows, rotations and final wave count, and the bot actually follows that sequence. **Committed** is the subset where its persistent `machinePlan` was also active when the forecast was made. Each fire counts once. A missing forecast leaves intent unresolved. It can mean an intentional one-piece opportunity, an improvised recovery or a lucky board. Tiers 1 and 2 have no preview search capable of leaving this evidence. [Planner and commitment rule](../src/core/ai/puzzle-bot-controller.js) · [Measurement](../reports/bot-ai-audit-2026-11/solo.mjs)

| Tier | Multi-wave fires | Forecast | Committed | Without a matching forecast | Opening seeds reaching ≥3 / ≥4 waves, out of 40 |
|---:|---:|---:|---:|---:|---:|
| 1 | 47 | 0 | 0 | 47 | 7 / 0 |
| 2 | 56 | 0 | 0 | 56 | 4 / 0 |
| 3 | 99 | 70 | 0 | 29 | 7 / 0 |
| 4 | 95 | 72 | 51 | 23 | 4 / 0 |
| 5 | 77 | 63 | 33 | 14 | 6 / 0 |
| 6 | 76 | 57 | 33 | 19 | 3 / 0 |
| 7 | 76 | 59 | 33 | 17 | 12 / 2 |
| 8 | 79 | 65 | 38 | 14 | 11 / 2 |
| 9 | 81 | 69 | 39 | 12 | 10 / 1 |
| 10 | 82 | 76 | 47 | 6 | 7 / 2 |

Tier 10 cleared a lone row only 12 times in 960 locks. Its immediate simulation got the wave and total-line counts right on every selected placement in the long panel. The forecast records the last one or two pieces of construction. Its earlier intent is unknown. Tier 3 already scored a larger later-wave share than tier 10, while tier 10 earned more points and attack per piece. Each metric answers a different gameplay question.

## What the offline player can build

The offline beam expands reachable tetromino landings with this repo's Stillfall pathfinder and calls the **production `resolveCascade`** on each branch. It keeps individual body identities. Its cheap first ranking uses distributed material, height and the projected release from filling a near-full row. Synthetic fills only affect ordering. The more expensive ranking tests whole tetrominoes on the shortlisted boards, measures the strongest legal trigger and gives additional credit to a shape in the known preview. The visible player replans after each lock and can carry out a proved four-wave route within the visible queue. The hindsight player explores a whole 16-piece deal and returns its best witnessed prefix. Widths, deterministic tie order and node counts are in the instrument. [Offline player](../reports/bot-ai-audit-2026-11/search.mjs) · [Reachability](../src/core/stillfall/stillfall-reach.js) · [Independent action replay](../reports/bot-ai-audit-2026-11/witnesses.mjs)

| Policy on seeds 1001–1040 | Available information | ≥3 waves | ≥4 waves | ≥5 waves |
|---|---|---:|---:|---:|
| Shipped tier 10 | Current + two search plies, full-bag membership in two heuristics | 7 | 2 | 0 |
| Benchmark expert, construction goal | Current + two search plies | 12 | 3 | 0 |
| Visible beam, width 16, cheap ranking with the same shortlist | Current + three previews | 4 | 1 | 0 |
| **Visible beam, width 16, reachable-trigger ranking** | **Current + three previews** | **24** | **20** | **1** |
| Hindsight beam, width 128, cheap ranking | Full deal | 24 | 9 | 2 |
| Hindsight beam, width 48, reachable-trigger ranking | Full deal | 34 | 13 | 4 |

The visible comparison changes the shortlist's ranking while keeping its width and cap. The cheap control visited 527,817 legal branch placements. The reachable version visited 484,162, plus 89,435 successful row-trigger simulations and the landing enumerations needed to find them. The searches generate different subsequent boards. The visible version gained a four-wave opening on 19 seeds relative to shipped tier 10, shared one success, and lost one. The two hindsight beams and two visible strategies together establish that **at least 25 of these 40 deals** admit four waves within 16 locks. This is an attainable lower bound with fixed search budgets. The inventory limit is six rows from 64 cells.

| 16-lock panel | Policy | ≥4 waves | Score / piece | Attack / piece | Later lines / all | Top-outs |
|---|---|---:|---:|---:|---:|---:|
| Audit 40 | Shipped tier 10 | 2 | 98.8 | .055 | 31 / 59 | 0 |
| Audit 40 | Visible reachable-trigger search | 20 | 216.0 | .125 | 78 / 128 | 0 |
| Fresh 40 | Shipped tier 10 | 1 | 102.2 | .066 | 36 / 70 | 0 |
| Fresh 40 | Visible reachable-trigger search | 13 | 170.9 | .095 | 60 / 111 | 0 |

On fresh seeds the visible policy gained 12 successes, shared one and lost none. The spread from 20 to 13 matters when setting a shipping threshold. This experiment establishes an opening strategy. Pressure, sustained survival and real-time cost each need their own acceptance test.

The earlier refit recorded **13/40 reaching three or four waves** for the benchmark expert. Its retained driver takes a caller-provided seed list. The published handover gives the count and the seed-1004 demonstration, without enumerating all 40 seeds. Running the current driver on the explicit cohort above gave nine three-wave and three four-wave openings. Seed 1004 still produced three waves and passed its independent replay. The historical count and today's tier-10 count refer to different policies and thresholds. [Earlier audit §8.10](ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md#810-the-bots-weights-re-fitted-2026-11-04) · [Construction proof](../scripts/odyssey-benchmark/capabilities.mjs)

### Why useful builds disappear

1. **The first cut removes the build before lookahead can see the fire.** Tier 10 advances six roots and usually two children per future node. On the 20 successful visible traces, 133 of 255 no-clear moves leading up to the first four-wave fire ranked below sixth under the shipped immediate evaluation. The chain on seed 1003 finished with an I and five one-row waves. Across all 20 fires, *every* tetromino shape served as a trigger. Only one pre-fire board satisfied `triggerReady`, and only four had a positive staircase match. Choosing one edge pattern as the admission test discards most of these examples. [Controller](../src/core/ai/puzzle-bot-controller.js) · [Side-lane classification](../src/core/ai/side-cascade-analyzer.js)
2. **Static holes conflate recoverable payload with damage.** On those same 255 build moves, 228 left a hole outside the protected cell count and 121 left more holes than the top-ranked alternative. A score-only counterfactual kept everything else fixed. The shipped ranking admitted 122 of the 255 into the first six. Removing the hole charges admitted 110, removing the surface/height/well charges admitted 79, and removing both admitted 60. These terms help distinguish bad alternatives too. The evidence favors conditioning their cost on a proved release and retaining a survival cost. [Counterfactual definitions](../reports/bot-ai-audit-2026-11/witnesses.mjs)
3. **The latent probe misses legal discharges and credits impossible ones.** On all 640 pre-lock boards of the tier-10 opening panel, an exhaustive one-piece landing test found 120 boards with a two-wave trigger among the seven shapes. The existing probes recognized 51, missed 69 and predicted another 12 where no shape could do it. For three waves they recognized 6 of 22 with one false positive. With the actual current piece, 63 boards allowed two waves and the probes recognized 41 of those. The existing value chooses by total rows, uses a vertical edge I and at most two top-open row fills of one to three arbitrary cells, and disables latent evaluation throughout lookahead. In particular, `hasTrigger` is automatically true for a winning row-fill probe. A real piece can cover different gaps or disturb the falling bodies. [Latent model](../src/core/ai/latent-chain.js) · [Exhaustive comparison](../reports/bot-ai-audit-2026-11/probes.mjs)
4. **The controller can see a loaded board and still count its value several times.** It adds the standing board score again at each discounted ply. A hard override then selects immediate clears of four total rows, any clear under danger, or a clean of at least two rows. At high tiers the four-row override fires before the six-row target can distinguish those moves. Commitment can add 220 points for a matching rotation and nearby column and only originates on a recognized edge action or loaded lane. A full-bag `includes('I')` also affects two setup estimates despite the limited visible queue. The lookahead cache uses occupancy alone, which can identify boards with different body connectivity as equal. That last issue is a correctness risk identified in code. Its frequency was not measured. [Selection and cache](../src/core/ai/puzzle-bot-controller.js) · [Benchmark's connectivity key](../scripts/odyssey-benchmark/profiles.mjs)
5. **Competitive information and time are missing at the integration boundary.** The local and Odyssey queues live on the match object. The controller reads the player state. Local opponents also compute a whole plan on the frame their reaction delay expires. The ladder, pressure and timing measurements below quantify both effects. [Local manager](../src/core/ai/local-bot-manager.js) · [Odyssey match](../src/core/odyssey/OdysseyBotMatch.js)

An isolated change to the shipped tier-10 configuration confirms the first finding. Changing breadth from 12 to 24 advances 12 roots and up to four children. Adding a third preview while leaving breadth at 12 also improves opening construction. The cost figures count yielded placement evaluations. BFS, ranking and latent probes add work between yields.

| Tier-10 configuration | ≥3 / ≥4 wave seeds | Score / piece | Attack / piece | Evaluated placements / lock |
|---|---:|---:|---:|---:|
| Shipped, depth 2 / breadth 12 | 7 / 2 | 98.8 | .055 | 364 |
| Depth 3 / breadth 12 | 14 / 6 | 132.9 | .088 | 954 |
| Depth 2 / breadth 24 | 13 / 7 | 143.8 | .100 | 1,079 |

Two preview pieces are sometimes enough for the final steps of a four-wave chain. Broadening the admission cut at the same depth added more successes here than the third preview alone. The reachable-trigger search shows how to choose better roots before paying for more depth. [Paired lookahead runs](../reports/bot-ai-audit-2026-11/probes.mjs)

## What the evaluator rewards and penalizes

The current evaluator exports **five groups, 65 coefficients**. The five fitted board-shape values are one group. The other four cover adaptation, combos, realized or latent rewards, and survival. The table accounts for every coefficient using its source name. It records the direction of each term before pressure, aggression and other multipliers. [Evaluator and exact expressions](../src/core/ai/board-evaluator.js)

| Group | Coefficients | Effect on a gravity setup |
|---|---|---|
| Board shape, 5 | `landingHeight` −8.48, `erodedPieceCells` +6.1, `rowTransitions` −1.37, `columnTransitions` −8.17, `wellSums` −6.48 | High bridges, internal voids and vertical discontinuities pay immediately. Clearing source cells earns immediate credit. The fitted values came from this project's simulator. |
| Adaptation, 7 hole and well terms | `coveredHole` −8.5, `cavityCells` −7, `holeDepth` −0.7, `maxHoleDepth` −1.8, `rowsWithHoles` −5.4, `weightedHoles` −0.18, `deepWells` −2.4 | The same empty cell can contribute to several terms. A side-accessible overhang avoids the cavity surcharge but still pays the base. The depth measures even pull in different directions with row index. A supported edge cap protects some hole and well totals. Interior setups get no comparable exemption, and `maxHoleDepth` and `deepWells` still apply. |
| Adaptation, 5 shape and effort terms | `aggregateHeight` −0.32, `bumpiness` −0.22, `maxHeight` −0.65, `heightSpread` −0.45, `pathCost` −0.08 | Each step building uneven payload carries a cost. Long tucks also pay for real input effort. |
| Adaptation, 4 outcome and danger terms | `lineClear` +5.5, `cascadeDepth` +16, `perfectClear` +70, `topOutRisk` −42 | Reward lines, squared extra waves and an empty board. Roof occupancy deserves a separate survival cost. |
| Combo, 4 realized-wave terms | `cascadeChainDepthMultiplier` +38, `cascadeLateWaveBonus` +16, `cascadeLineScore` +1.1, `cascadeWeightedLines` +8 | Extra waves are already heavily rewarded. The +16 expression uses the largest wave size anywhere in the lock. The simulated line score is an additional handcrafted value. |
| Combo, 5 trigger terms | `accidentalTriggerPenalty` −6.5, `isolatedSingleClearPenalty` −16, `noClearSetupBonus` +6, `triggerPayloadBonus` +0.55, `triggerRowBonus` +7 | Discourage wasting a loaded board on a single. Near-complete rows with blocks above them earn credit every evaluated ply even when the piece cannot fire them. |
| Combo, 9 surface and growth terms | `edgePlatformBonus` +7, `emptySideLanePenalty` −13, `extremeCliffPenalty` −4, `intentionalStepScore` +4.5, `overdeepEmptyColumnPenalty` −18, `staircaseMatchBonus` +5, `staircaseAlternationPenalty` −5, `setupGrowth` +3, `verticalStepMatchScore` +12 | Select particular edge and staircase shapes and penalize others. Growth has a four-unit cap. Preview surface fit describes an outline and cannot certify the falling bodies. |
| Combo, 10 side-lane terms | `sideLaneBridgePlacementBonus` +20, `sideLaneIPayloadBonus` +14, `sideLaneIPlacementBonus` +24, `sideLanePlatformBonus` +7, `sideLanePlatformPlacementBonus` +16, `sideLanePotentialBonus` +4, `sideLaneStopperBonus` +13, `sideLaneStopperPlacementBonus` +14, `sideLaneTriggerBonus` +9, `sideLaneTriggerPlacementBonus` +40 | Reward both possessing and placing parts of the two mirrored edge setups. A failed probe discounts several terms on a board already classified as trigger-ready. |
| Reward, 6 | `projectedAttack` +9, `projectedScore` +0.018, `cleanRoute` +24, `latentDepth` +6, `latentAttack` +8, `latentNoTriggerScale` ×0.4 | Total lines and clean bonus predict gross standard attack. Latent depth counts rows. The estimated score uses one level-1 calculation for a whole lock. Live play scores each wave and applies the clean bonus at the end. |
| Survival, 6 shape terms | `ceilingPressure` −8.5, `dangerZoneCells` −4.2, `landingHeightPressure` −2.2, `lowSafeMargin` −12, `tallColumnCount` −2.8, `triggerDangerPenalty` −14 | A steep penalty near the roof is appropriate. Some of these terms charge the same high cells, so their joint scale matters when garbage is about to arrive. |
| Survival, 4 decision terms | `cascadeUnderPressureBonus` +32, `clearUnderPressureBonus` +20, `noClearUnderPressurePenalty` −22, `setupUnderPressurePenalty` −34 | Push danger decisions toward a clear. They work on board pressure even when the actual incoming queue is invisible. |

On the 640 shipped opening locks, the estimated clear score disagreed with the actual award on **9 of the 24 clearing locks**. On seed 1017 a two-wave, four-row lock was valued at 2,420 points and paid 1,595 before the lock bonus. The benchmark specialist already substitutes the resolver's actual score delta. This is a reason to align the target before fitting coefficients. The previous fit changed only the five shape weights, moved the best three-star rates on orbs 4 and 30 from 47% to 20% and 60% to 27%, and temporarily took the campaign from 9/9 gates to 8/9. Adding easier alternatives on those two orbs restored 9/9. [Benchmark scoring](../scripts/odyssey-benchmark/profiles.mjs) · [Refit record](ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md#810-the-bots-weights-re-fitted-2026-11-04)

## The ladder in a match

The numbers are first-top-out round wins and losses for the **higher** tier. The last column awards a draw half a win. Swapping seats controls update order. The two seats share a bag, so the 32 rounds contain 16 independent seed pairs. These are local competitive results, with the safety and action speed of each tier both in play. [Duel instrument](../reports/bot-ai-audit-2026-11/duel.mjs)

| Higher vs lower | Wins | Losses | Draws | Higher tier, points / rounds |
|---|---:|---:|---:|---:|
| 2 vs 1 | 14 | 12 | 6 | 53.1% |
| 3 vs 2 | 29 | 3 | 0 | 90.6% |
| 4 vs 3 | 16 | 16 | 0 | 50.0% |
| 5 vs 4 | 21 | 11 | 0 | 65.6% |
| 6 vs 5 | 21 | 11 | 0 | 65.6% |
| 7 vs 6 | 26 | 6 | 0 | 81.3% |
| 8 vs 7 | 24 | 8 | 0 | 75.0% |
| 9 vs 8 | 20 | 12 | 0 | 62.5% |
| 10 vs 9 | 27 | 5 | 0 | 84.4% |

Repeating all 288 rounds with the local line-impact hit stop enabled produced identical outcomes, placement counts and garbage measurements. The first preview arrives at tier 3. The full tactical controller switches on at tier 4. The second preview arrives at tier 7. Speed also changes at every step, so the ladder alone cannot assign the cliffs to preview depth. [Tier configuration](../src/core/ai/bot-difficulty.js)

**Mistakes are visible, but their distribution looks mechanical.** The scheduler issues legal actions at a fixed interval after a random spawn reaction. Tier 1 picked below its noisy first choice on 140/767 locks, tier 2 on 105/880. Of those alternatives, 69/140 and 56/105 respectively were at least three origin columns away from the first choice. The mistake sampler chooses a rank within a pool. It has no preference for stopping one column early. The count uses piece origins, so a rotation can also change the footprint. On the long panel, three tier-1 and three tier-2 multi-wave fires followed a sampled lower-ranked no-clear placement when the first-ranked no-clear alternative offered **no** legal next-piece landing with as many waves. These are concrete examples of a mistake creating a chain. All other unforecast fires retain their unknown attribution. Believability and fun still require people watching or playing. [Selection and scheduler](../src/core/ai/bot-input-scheduler.js) · [Matched alternative test](../reports/bot-ai-audit-2026-11/solo.mjs)

## Garbage timing and digging

Both local and Odyssey standard duels route outgoing rows to the opponent and drain incoming line bursts at spawn. The local attack router sends outgoing rows even when the attacker has incoming rows. The online FFA counter rule belongs to a different ruleset. The useful local decision is whether to clear headroom before the next rise, preserve a reachable fire through that rise, or attack first. The shipped policy has a spare-row danger gate and selects moves with neither arrival timing nor the opponent's headroom as inputs. [Attack router](../src/core/multi-player-state.js) · [Local spawn handling](../src/main.js) · [Odyssey spawn handling](../src/core/odyssey/OdysseyBotMatch.js)

The 288 local rounds produced 35,926 plans and 7,056 outgoing rows. Across the 887 plans with rows actually pending, the bot read zero pending rows every time. It still chose a clearing placement on 138 and its board-height gate reported danger on 124. During play, 1,191 locks reduced the number of garbage cells on the board before the next insertion. The bot can dig incidentally. These timings provide no evidence of a response to the queued amount.

The controlled test delivered two actual three-row attacks captured from tier 10 on seed 1001, together at the spawn following lock 13. The same packets went to each tier on seeds 1001–1016. Recovery counts garbage cells left after the initial settle, then checks the next 24 locks. The marker survives fragmentation. Depending on the receiving board, 36–54 marked cells survived insertion.

| Tier | Queue read correctly / 16 | Removed ≥ half / 16 | Removed all / 16 | Top-outs / 16 |
|---:|---:|---:|---:|---:|
| 1 | 0 | 2 | 2 | 1 |
| 4 | 0 | 3 | 2 | 0 |
| 7 | 0 | 4 | 2 | 0 |
| 10 | 0 | 4 | 4 | 0 |

On all 64 decisions, the normal tactical assessment was identical with the match queue full and empty. An audit-only observer reading the actual six rows on tier 10 flipped danger on three of 16 boards and changed the selected move on two. Wiring the queue is necessary. Its effect on survival must also be measured. [Pressure and recovery instrument](../reports/bot-ai-audit-2026-11/probes.mjs)

## Time spent on the playing thread

Electron 44.9.3, Chromium 152.0.7977.167, Ryzen 9 9955HX3D. Each pass measured one controller update with `performance.now()` in a hidden renderer. Eighteen fixtures came from real tier-10 games on seeds 1001–1006 at locks 0, 12 and 32. Timing includes BFS, ranking, latent probes and scheduler calls on active planning updates. An idle update does not contribute a zero. Timed controllers have inert input callbacks to keep the fixture identical. Warm-up preceded each pass, and the lane order was reversed on the second. Work counts and selected actions matched across both passes, both update cadences and both planning styles for each like tier and controller count. [Renderer instrument](../reports/bot-ai-audit-2026-11/timing.mjs) · [Host and fixtures](../reports/bot-ai-audit-2026-11/timing-host.cjs)

| Configuration | Active updates per pass | p95 ms, passes A / B | p99 ms, A / B | Largest ms, A / B | p95 ms after reaction deadline, A / B |
|---|---:|---:|---:|---:|---:|
| Tier 8, whole plan, 60 Hz, rival reaction cap | 18 | 48.6 / 48.3 | 48.6 / 48.3 | 48.6 / 48.3 | 17 / 17 |
| Tier 8, Odyssey's 2.5 units/ms, 60 Hz | 124 | 6.3 / 7.5 | 7.8 / 8.5 | 9.5 / 9.1 | 23 / 23 |
| Tier 8, Odyssey's 2.5 units/ms, 165 Hz | 326 | 3.6 / 3.8 | 4.2 / 4.6 | 5.3 / 6.5 | 20 / 20 |
| Tier 10, local whole plan, 60 Hz | 18 | 56.7 / 73.7 | 56.7 / 73.7 | 56.7 / 73.7 | 16 / 16 |
| Tier 10, trial with 2.5 units/ms, 60 Hz | 165 | 5.7 / 7.5 | 7.7 / 8.9 | 8.3 / 9.3 | 236 / 236 |
| Tier 10, trial with 2.5 units/ms, 165 Hz | 441 | 3.3 / 3.6 | 4.3 / 4.3 | 4.7 / 7.6 | 244 / 244 |
| Three simultaneous tier-10 local bots, 60 Hz | 27 | 139.1 / 150.5 | 148.3 / 170.6 | 148.3 / 170.6 | 16 / 16 |

The 60 Hz frame lasts 16.67 ms and the 165 Hz frame 6.06 ms. Local tier 10 exceeded a whole 60 Hz frame on 16/18 and 17/18 single-bot plans. In the three-bot stress case the counts were 25/27 and 27/27 active updates. Odyssey buys time with up to 160 game ms of reaction lead and 2.5 simulated placements per game ms. The measured tier-8 plans took 140–446 units and tier 10 took 192–655. Copying that scheduler directly to tier 10 buys smaller slices at the price of a roughly quarter-second late decision in the tail. Its yield comes after a placement. Generating reachability and ranking a candidate batch can still occupy a whole slice.

The deadline column is simulated game time rounded to milliseconds. In the synchronous lanes the game clock stops advancing while JavaScript blocks the frame, so that column understates real input latency there. These are CPU measurements on a shared development machine with no scene rendering in the instrument. A packaged match with rendering, multiple opponents and a quieter repeat is the release timing gate. [Sliced planner](../src/core/ai/puzzle-bot-controller.js) · [Timing evidence policy](adr/0016-perf-claims-require-a-verified-instrument.md)

The offline player that reached 20/40 used **293 and 296 ms per new plan at p95** in two Node runs on seeds 1001–1004. Each pass timed 59 new plans across 64 locks. Median times were 244 and 228 ms. Both runs reproduced the untimed moves and node counts. These samples time the search itself and exclude independent replay and locks that execute an already proved route. A production planner must recover part of this gain at a much smaller cost. [Offline timing instrument](../reports/bot-ai-audit-2026-11/search.mjs)

## Odyssey rivals and the campaign measuring tool

These are **proxy-player wins against the rival**. I reran the real Odyssey match, including its pace caps, gravity, queue and three-frag finish. The stacker and cascade profiles each played at regular and strong human cadence on 15001–15005. The last three rivals also played on 17001–17010. All 280 matches reached a win or loss. The prior column is the approved level-design reference, shown in regular / strong order. [Human-pace runner](../reports/bot-ai-audit-2026-11/rivals.mjs) · [D8 and the historical panel](ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md#836-rivals-at-human-pace-unchanged-by-pass-2)

| Orb and rival | Current tier | Previous regular / strong | Current regular | Current strong |
|---|---:|---:|---:|---:|
| 5 Cinder | 1 | 100% / 100% | 10/10 | 10/10 |
| 10 Coral | 2 | 100% / 100% | 10/10 | 10/10 |
| 18 Willow | 3 | 100% / 100% | 10/10 | 10/10 |
| 26 Frost | 4 | 100% / 100% | 9/10 | 10/10 |
| 34 Zephyr | 5 | 50% / 90% | 9/10 | 9/10 |
| 48 Nova | 6 | 60% / 90% | 21/30 | 30/30 |
| 56 Prism | 6 | 60% / 73% | 17/30 | 23/30 |
| 60 Neon | 8 | 27% / 63% | 4/30 | 14/30 |

Prism remains close to the D8 reference and Neon remains the hardest rival. Zephyr and Neon illustrate why a rebuild needs a paired run against the current game as well as the historical target. These samples contain simulated human-paced inputs. Actual player win probabilities require playtests or player data. [Rival caps and subtitle assembly](../src/core/odyssey/data/level-design-2026-11.js)

**Freeze the campaign benchmark profiles at this revision.** They measure the levels. The shipped rivals are opponents to calibrate. `stacker` and `quad` have their own utility, while `cascade`, `expert` and `duelist` use the shared evaluator. Even independently ranked profiles inherit planning, timing or tie-breaking code. Freezing the six names and weight literals alone would still allow the instrument to drift. Pin executable behavior, observation limit, decision stream, ranking, cadence and gate inputs. Replay the frozen player against each candidate rival. Keep changed live-policy scores in a separate comparison series. The 9/9 verdict over seeds 12001–12005, 13001–13005 and 16001–16005 is the documented historical result. This audit reran the rival panel and bot tests. A full campaign gate replay is the first control in the implementation plan. [Profiles](../scripts/odyssey-benchmark/profiles.mjs) · [Campaign evidence](ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md#810-the-bots-weights-re-fitted-2026-11-04)

The existing `chain` specialist values a new wave-depth record and uses three previews. `mastery-search` already carries connected bodies, score context, objectives, an observation-limited beam and an optional model of an unknown fifth piece. Its wall timeout and campaign completion objective make its default result a different experiment from the fixed-work empty-opening search above. The local multiplayer plan supplied legal input paths, the cascade tactics plan supplied the edge builder and danger gate, and the payload plan added the second probe. The documented three-seed gains from that probe justify keeping it as a cheap candidate-ordering signal during comparison. [Chain policy](../scripts/odyssey-benchmark/chain-policy.mjs) · [Mastery search](../scripts/odyssey-benchmark/mastery-search.mjs) · [Local plan](local-multiplayer-bot-ai-plan.md) · [Tactics plan](quadra-cascade-bot-tactics-plan.md) · [Payload plan](cascade-bot-payload-planning-plan.md)

## Reproducing the measurements

[Compressed per-seed evidence](../reports/bot-ai-audit-2026-11/evidence.json.gz) contains the complete panels, including every tier's denominators, search poses and wave vectors, paired seat results, rival outcomes and both timing passes. It is gzip-compressed JSON, readable with Python's standard `gzip` and `json` modules. The audit instruments import game code from the checkout in which they run. Use the revision at the top of this document to reproduce this baseline.

The scripts below run offline and write to new filenames. The first seed and count select contiguous bags. The solo driver continues seeds 1001–1008 to 120 locks on the tier panel. Repeat the tier command for 1–10 and the duel command for lower tiers 1–9. The expert and hindsight commands stop at their specified opening horizon or proof. There is no wall-clock cutoff on search decisions.

```powershell
$tools = 'reports/bot-ai-audit-2026-11'
node "$tools/solo.mjs" 10 1001 40 tier10.jsonl
node "$tools/solo.mjs" expert 1001 40 expert.jsonl
node "$tools/search.mjs" visible-shortlist 1001 40 16 shortlist.jsonl
node "$tools/search.mjs" visible-reachable 1001 40 16 visible.jsonl
node "$tools/search.mjs" visible-reachable 1001 4 16 search-time.jsonl --time
node "$tools/search.mjs" oracle 1001 40 128 hindsight.jsonl
node "$tools/search.mjs" oracle-reachable 1001 40 48 hindsight-reachable.jsonl
node "$tools/search.mjs" visible-reachable 62001 40 16 fresh.jsonl
node "$tools/solo.mjs" 10 62001 40 fresh-tier10.jsonl
node "$tools/witnesses.mjs" independent-replays.jsonl visible.jsonl fresh.jsonl hindsight.jsonl
node "$tools/probes.mjs" probe 1001 40 triggers.jsonl
node "$tools/probes.mjs" breadth 1001 40 original.jsonl 2 12
node "$tools/probes.mjs" breadth 1001 40 third-preview.jsonl 3 12
node "$tools/probes.mjs" breadth 1001 40 wider.jsonl 2 24
node "$tools/probes.mjs" dig 1001 16 dig10.jsonl 10
node "$tools/duel.mjs" 9 33001 16 duel9v10.jsonl
node "$tools/rivals.mjs" 5,10,18,26,34,48,56,60 cascade regular rivals.jsonl
```

For the defense panel use tiers 1, 4, 7 and 10. For the rival panel cross `stacker` and `cascade` with `regular` and `strong`. To reproduce CPU timing, run the following in a fresh PowerShell process with the local Electron binary. The host creates its own temporary profile.

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\node_modules\electron\dist\electron.exe reports/bot-ai-audit-2026-11/timing-host.cjs timing.json
```

The four colocated AI suites and the benchmark profile, chain-policy, authored-construction and Odyssey difficulty-balance suites passed **99/99** at the audit revision. The 400 tier runs were repeated with additional observational counters. Both seat orders on one local matchup and the visible search on seed 1039 also reproduced. The existing cascade diagnostic and live verification scripts still work as spot checks. They share one random stream between decisions and bags, and their default cohort differs. The verifier's largest `depth` is total lines, and its clean-attack counter checks `sendForClean`, while gameplay supplies `sendForPerfectClear`. Its printed hold/safe settings do not change the controller. Use the ledger above for matched attack or wave comparisons. [Original diagnostic](../scripts/diagnose-cascade-bot.mjs) · [Original live verifier](../scripts/verify-cascade-live.mjs)

The implementation plan sets the expected gains, acceptance tests and six owner decisions. [Rebuild plan](BOT_AI_REBUILD_PLAN_2026-11.md)
