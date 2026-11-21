# Expert drop speed in local versus

Tier 10 averaged **171.66 accepted hard drops per minute** against an idle seat over 16 two-minute bags. The previous expert averaged 113.75 on the same sequences. The new expert still spends at least 170 ms reading a new piece, has the same planning work allowance, and checks the chosen landing before dropping. The local reaction window is now 170–200 ms. Once the route is ready, a movement or rotation can follow the preceding input on the next 60 Hz simulation tick. The scheduler issues at most one command per tick. Hit stop, gravity, cascade settlement and garbage insertion keep their normal timing.

## Matched placements

Each bag from 22670000 through 22670015 ran for 7,200 ticks with 165 Hz opportunities for between-tick planning. The control used the preceding release's 170–250 ms reaction and 1,050 inputs/minute. Individual bag rates ranged from 168.5 to 173.0 drops/minute. The median time from first input to hard drop fell from 200 to 50 ms.

| Across 32 simulated minutes per policy | Previous expert | Faster expert |
| --- | ---: | ---: |
| Accepted hard drops | 3,640 | 5,493 |
| All accepted inputs per minute | 462.03 | 696.97 |
| Score | 1,041,937 | 1,586,227 |
| Outgoing garbage rows | 926 | 1,424 |
| Clears with at least four waves | 55 | 74 |
| Top-outs / rejected inputs | 0 / 0 | 0 / 0 |

All 3,640 shared locks matched in piece, column, row and rotation. All 3,624 shared locks with a subsequent lock on both recordings matched wave for wave. The shorter run's final lock on each bag could still be settling when capture ended. On the 40 audit openings, the new expert reproduced every clear sequence over 640 locks. It still made a four-wave opening on 16 bags by lock 16. On seed 1006 the same four waves fired on tick 214, previously tick 354. [Board-by-board replay](../../docs/BOT_AI_CHAIN_REPLAY_2026-11.md)

## Playing against the expert

In the packaged game a tier-10 bot against an idle human completed **167 accepted hard drops in 60.020 seconds** across three rounds. That is 166.94 drops per wall-clock minute with round transitions included, or 176.00 per minute spent playing. In a four-expert room at 165 Hz, the four seats made 163, 108, 152 and 114 accepted hard drops in one wall-clock minute. Their rates during play were 167.23, 168.09, 169.15 and 167.31 respectively. The second and fourth seats were eliminated early and watched the surviving boards. Playing time includes hit stop, settling cascades and garbage rises. It stops when the game stops advancing that seat.

The initial tuning trial illustrates why the rendered game matters. A two-tick movement interval reached 153.47 drops/minute on the native panel. All four seats in a rendered free-for-all fell below 150 between their first and last drops while alive. On the first round all four also played 63 drops at identical times because the narrower reaction window rounded to a single tick. The selected setting preserves seated timing variation across simulation ticks.

| Packaged room | Requested Hz | Active planning frames | Planner p95 / p99 / max, ms | Over-budget frames |
| --- | ---: | ---: | ---: | ---: |
| Expert vs idle human | 60 | 1,334 | 1.9 / 2.6 / 5.5 | 0 |
| Expert vs idle human | 165 | 2,354 | 1.2 / 1.8 / 3.4 | 0 |
| Four experts | 165 | 3,436 | 0.4 / 0.7 / 2.7 | 0 |
| Four experts on the final build | 60 | 2,241 | 0.5 / 0.7 / 5.4 | 0 |
| Tier 10 vs practiced tier 8 on the final build | 165 | 4,236 | 0.6 / 0.9 / 3.2 | 0 |
| Tiers 8, 9, 9 and 10 on the final build | 165 | 4,664 | 0.3 / 0.5 / 2.4 | 0 |

Against the practiced tier 8, the expert delivered 153 accepted drops in one minute and its opponent delivered 144. Both had time to finish a route before their reaction deadline at p95. Six of 298 first plans arrived more than one refresh late and the longest delay was 163 ms. These delays span multiple short planning updates. The frame-time gates measure the work charged to individual frames. The four-expert captures at 60 and 165 Hz reproduced all 2,146 controls and 11 labelled checkpoints.

## Upper difficulty ladder

Changing the top seat alone gave tier 10 **93.75%** of seven-frag match points against tier 9 on 12 side-swapped bags. The previous release earned 62.50% on those bags. A first recalibration brought the middle pair closer but gave tier 8 83.33% against tier 7 on a separate 24 bags, up from 69.79% on the previous release. Those 24 bags joined the development set for the next calibration.

The final local configuration gives the practiced style to 30% of tier 8 series and 65% of tier 9 series. Practiced tier 8 reads in 170–230 ms. Practiced tier 9 and every tier 10 read in 170–200 ms and can execute one input per fixed tick. The series seed determines the practice draw. A tier 7 seat whose seeded hand speed is already in the faster half now uses tier 8's ordinary hand rate, with its own reading time and judgment. Tiers 1–6 keep their previous configuration. Odyssey uses its authored rival caps.

On the original native speed panel (16 one-minute bags starting at 21420200), tiers 7 through 10 averaged **72.69, 86.19, 123.19 and 172.06** accepted drops/minute, previously 66.25, 79.62, 87.38 and 113.75. Individual tier 10 runs reached 169–175. Two tier 8 seats and seven tier 9 seats drew the practiced style on this small panel. The seven slower tier 7 seats reproduced their earlier action counts and execution timings.

On the 36 development bags, higher-tier seven-frag points were 65.28%, 75.00%, 66.67% and 70.83% for 7/6 through 10/9. Corresponding three-frag rates were 70.14%, 72.22%, 69.44% and 70.83%. The seven-frag comparison between tiers 7 and 6 reproduced its baseline rate. Each bag supplied both seat orders. Draws and unfinished series earn half a point.

The settings were then fixed. On the 48 previously unused bags 57184201–57184248, each revision played 96 native series per pair. The 9/8 step remains the steepest. Its three- and seven-frag rates exceed the 75% calibration bound by 1.56 and 1.04 percentage points. [All 768 paired series](expert-pace-ladder.jsonl.gz)

| Higher tier vs lower | Three frags, previous → final | Seven frags, previous → final |
| --- | ---: | ---: |
| 7 vs 6 | 61.98% → 65.10% | 58.33% → 60.42% |
| 8 vs 7 | 61.46% → 70.31% | 63.02% → 68.75% |
| 9 vs 8 | 68.23% → 76.56% | 68.23% → 76.04% |
| 10 vs 9 | 64.06% → 60.94% | 69.27% → 65.10% |

## Reproduction

The evidence archive contains the two native observations for every bag, the opening panels and the rendered input tapes with labelled board checkpoints. This command reproduces the native rates from accepted drops and elapsed ticks. [Raw measurements](expert-pace.json.gz)

```sh
python -B -c "import gzip,json; n=json.load(gzip.open('reports/gravity-bot-rebuild/expert-pace.json.gz'))['native']; print({p:3600*sum(r['drops'] for r in n['observations'] if r['policy']==p)/sum(r['ticks'] for r in n['observations'] if r['policy']==p) for p in n['policies']})"
```

From the checkout under test, run the native bags with `node reports/gravity-bot-rebuild/support-speed.mjs . speed.jsonl 22670000 16 120` and summarize with `python -B reports/gravity-bot-rebuild/support-results.py speed speed.jsonl`. Check out `a5879399b` in a separate worktree for the previous policy. The deterministic integration test runs a full in-game minute and counts hard drops accepted by the fixed simulation. [Speed driver](support-speed.mjs) · [Regression test](../../src/core/ai/gravity-bot.test.js)

Rescore the committed ladder rounds with `python -B reports/gravity-bot-rebuild/support-ladder.py reports/gravity-bot-rebuild/expert-pace-ladder.jsonl.gz --first 57184201 --count 48 --tiers 6 7 8 9`.

For a rendered match, use `npm run build` followed by `node_modules/.bin/electron reports/gravity-bot-rebuild/rendered-match.cjs four.json 4 60 60`. Run `python -B reports/gravity-bot-rebuild/support-results.py rendered four.json` for per-seat accepted drops, rates and planning gates. The last three arguments select the bot count, recording length in seconds and target refresh. Pin `SERENITY_BOT_TIERS=9,10` for the mixed duel and clear it for expert-only rooms.
