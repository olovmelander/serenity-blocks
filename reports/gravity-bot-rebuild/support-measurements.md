# Matched bot measurements, November 21

Tests use the shipped policy at `11ee1ca09` as the opponent. The current local manager supplies standard two-player targeting and garbage, each player sees its own previews, and both boards receive the same bag. Each seed is run with the new policy in each seat. The equal-speed driver sets both policies to the original expert's 170–250 ms reaction range and 850-input/minute interval. It waits for both legal routes before releasing their hard drops on the same 60 Hz simulation tick. Matching the piece keys and lock ticks prevents a shorter route or faster hand from winning this decision test. Production matches use normal unrestricted timing.

| Policy and bag block | Bags | Wins / losses | Timeouts / other censored | Match points | Whole-bag 95% interval |
|---|---:|---:|---:|---:|---:|
| Development, original two-bot search allowance | 40 | 17 / 18 | 44 / 1 | 49.38% | 41.25%–57.50% |
| Development, selected two-bot allowance | 40 | 23 / 10 | 46 / 1 | 58.13% | 49.38%–66.88% |
| Pre-fix policy on the first reserved block | 200 | 112 / 59 | 222 / 7 | 56.62% | 52.38%–60.75% |
| Final policy on that same block | 200 | 128 / 56 | 208 / 8 | 59.00% | 54.62%–63.12% |
| Final policy on previously unused bags 21930000–21930199 | 200 | 101 / 81 | 215 / 3 | 52.50% | 48.12%–56.88% |
| Preregistered final confirmation, bags 22180000 to 22180799 | 800 | 476 / 218 | 886 / 20 | 58.06% | 55.94%–60.12% |

The confirmation produced 71,631 outgoing rows and 84,826,586 score points for the new policy, against 65,914 rows and 79,987,672 points for the old policy. The new policy dug 447,463 garbage cells and the old policy dug 467,137.

The independent 800-bag confirmation used the same frozen policy, horizon and metric. All 1,600 games finished before the score was computed. Its 251,322 paired commanded placements had zero tick skew. [Prespecified analysis](support-confirmation.json)

Every 150-second timeout earns half a point. A naturally locking piece ends the comparison immediately. An actual top-out at that moment counts as a loss. Otherwise the round is censored for half a point. Intervals resample whole bags 5,000 times so the two seat orders stay together. Giving half a point for every natural lock, including terminal ones, produced 52.75% on the fresh block (48.50%–57.00%).

The fresh block paired 62,550 commanded locks per policy on identical ticks. The old and new bots sent 16,626 and 17,681 rows, scored 20,331,770 and 21,251,073, and dug 117,004 and 109,957 garbage cells. Opponents can receive different amounts of garbage. Total cells dug alone cannot identify which policy recovers better from the same position.

## Native execution

Sixteen bags per tier ran for one minute each against an idle human seat. Both builds used the regular sliced planner, normal timing variation, the ordinary local practice draw, and the same seeds (21420200–21420215). A 165 Hz presentation schedule supplied the usual between-tick search opportunities. First input to hard drop includes time spent moving and rotating.

| Tier | Old → new hard drops/min | Old → new inputs/min | Median first input to hard drop |
|---:|---:|---:|---:|
| 8 | 76.31 → 79.62 | 306.19 → 317.00 | 300 → 300 ms |
| 9 | 83.88 → 87.38 | 341.12 → 360.94 | 267 → 267 ms |
| 10 | 104.56 → 113.75 | 423.19 → 468.31 | 250 → 200 ms |

## Rendered frame times

Electron ran the production game for one minute per room on a GeForce RTX 5080 Laptop GPU, with Phaser boards, normal local matches and shared-texture offscreen rendering. The following release captures use the final optimized reachability search. Both command timing and complete board checkpoints were compared with the preceding implementation.

| Room | Requested / delivered Hz | Active planning frames | Planning p95 / p99 / max (ms) | Over budget | Display p99 / max (ms) | Median host CPU | Planning gates |
|---|---:|---:|---:|---:|---:|---:|---|
| Shipped, two experts | 165 / 156.9 | 2,130 | 0.8 / 1.4 / 5.6 | 0 | 12.2 / 96.9 | unmeasured | Passed |
| Shipped, four experts | 165 / 114.3 | 2,298 | 0.7 / 1.5 / 4.1 | 0 | 24.3 / 163.6 | unmeasured | Passed |
| Final, Tiers 9/10 | 165 / 163.5 | 3,040 | 0.7 / 1.0 / 2.9 | 0 | 6.2 / 78.7 | 28.4% | Passed |
| Final, Tiers 8/9/9/10 | 165 / 161.1 | 3,713 | 0.3 / 0.6 / 3.2 | 0 | 12.1 / 72.7 | 30.0% | Passed |
| Final, Two experts | 165 / 164.3 | 3,157 | 0.5 / 0.7 / 2.2 | 0 | 6.2 / 48.5 | 22.4% | Passed |
| Final, Four experts | 165 / 162.3 | 3,692 | 0.3 / 0.6 / 1.8 | 0 | 6.2 / 84.9 | 27.8% | Passed |
| Final, Four experts | 60 / 59.7 | 2,056 | 0.4 / 0.7 / 2.9 | 0 | 16.8 / 83.3 | 27.6% | Passed |

At 165 Hz the planning limits are 1.5 ms at p95, 2.5 ms at p99, and one refresh (6.06 ms) for the maximum. The 60 Hz limits are 2 ms, 4 ms and 16.67 ms respectively. P95 lateness of the first legal plan must fit one refresh. A long display interval includes rendering and other game work. The recorded difference in delivered refresh across host loads needs to be taken into account when comparing runs.

The five final release timings compare with 6,093 previously recorded commands and 47 matching body-labelled boards. The archive identifies the control recording for each room.

### Mixed rooms under CPU saturation

Before the empty-board optimization, the tier-9/tier-10 room at 100% median host CPU had three over-frame planning updates (p95 1.7 ms, p99 2.8 ms and maximum 12.1 ms). The four-seat tier-8/9/9/10 room at the same load had one 6.5 ms overrun. Pausing the ladder while other work still saturated the machine yielded median CPU of 96.2% and 89.0%. The two-seat maximum was 6.4 ms and the four-seat maximum 7.4 ms.

On the final optimized bundle at 100% median CPU the two-seat room recorded p95/p99/max of 1.5/2.4/6.5 ms, with one over-frame update on tick 3. Four mixed seats at 100% CPU measured 1.0/1.8/5.1 ms with zero overruns. The separate 10-second cold probes of the optimized bundle peaked at 5.4 ms (two seats) and 4.2 ms (four). The old 9/10 room's first two seat calls took 3.9 and 0.4 ms, and its initial ten-second maximum was 4.3 ms. Before the optimization, the new two-seat opening took 4.8 and 0.9 ms. Launch-to-launch variation matters when interpreting the first frame. The archive retains the first 16 calls of each bot for these probes and the original/current opening controls.

The earlier two-/four-expert release sample at 165 Hz and four-expert 60 Hz sample covered 8,418 active planning frames without an overrun. During the 60 Hz sample, median workstation CPU was 96%. Display intervals across these three runs reached 150 ms. The archive retains them as pre-optimization controls.

## Reproduction

Run the scorer from the repository root. The compressed archive contains the individual duel records, native-speed samples, final rendered-game recordings and the producing source fingerprints. The paired driver takes the path to a clean baseline checkout and rejects existing output files.

```sh
python -B reports/gravity-bot-rebuild/support-results.py archive reports/gravity-bot-rebuild/support-evidence.json.gz
node reports/gravity-bot-rebuild/support-duels.mjs ../serenity-baseline fresh.jsonl 21930000 200 150
node reports/gravity-bot-rebuild/support-speed.mjs . native-speed.jsonl 21420200 16 60
```

For rendered replication, run `npm run build` in each checkout and use its Electron executable to run `reports/gravity-bot-rebuild/rendered-match.cjs result.json 4 60 165`. Replace the seat count or refresh rate with the corresponding table entry. Set `SERENITY_BOT_TIERS=9,10` for the mixed two-seat room or `SERENITY_BOT_TIERS=8,9,9,10` for the mixed four-seat room. Clear that variable for expert-only rooms. The final release manifest was `6d13527c51e21855f5a1d3ed8658730fc14a80859d90d7307788a5601cf16c81`. The operating system and GPU affect timings. [Raw comparisons](support-evidence.json.gz) · [Timing gates](frame_metrics.py)
