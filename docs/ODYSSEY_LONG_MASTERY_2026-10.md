# Odyssey longer mastery study — 2026-10-07

## Scope and frozen protocol

This development protocol follows the [64-piece planning-latency screen](ODYSSEY_PLANNING_LATENCY_2026-10.md).
It extends the existing online policy to a 192-piece ceiling while charging
measured planning time to the game clock. Experimental `reachable-v1` path repair
is compared with the retained `none` control on orbs 49, 55 and 59. The question
is whether these bounded policies demonstrate the exact joint three-star goals,
and where they stop short when given enough nominal piece supply to clear the
known necessary inventory bounds.

The design checkpoint is committed as `509f1e7`, and source/protocol registration
froze at **2026-10-07 19:23:33.640 UTC** before execution. The committed
implementation from `a5068da` is retained without a new solver, production-rule
change, authored retune or default-policy adoption. All **24 assigned invocations
complete with observed exit code zero**, and all **twelve independent timestamp
replays pass**. No full three-star witness qualifies. One parent acquires primary;
four top out, four miss an acquisition deadline and three remain budget-censored.
The frozen analysis reports no goal-evidence errors. Independent raw audit and
fresh archive verification both pass.

The source snapshot at `509f1e7a5a50e60bf9dc33e6f059194098ef25ee` has combined
SHA-256 `8f901fade30cb15ef16e73567ba69dd8928240220c40305f985cb8bd2a99ebda`,
unchanged from the preceding latency study. Registration SHA-256 is
`e0c4f5bc737a29033b2064b3a4ebb08fc299a4481a32a77faa8d78b7eb441def`;
the frozen analyzer SHA-256 is
`43ca556e7d016477f66198ea646556f861f81c5e01da33cfb2c07cbb34afb5e7`.
The recorded runtime is Node `v24.19.0`, Linux x64. The immutable registration and
raw evidence are under `artifacts/odyssey-long-mastery-2026-10-07/`; the durable
record belongs at [the longer-study archive](benchmarks/2026-10-07-long/README.md).

All **98 focused tests pass again** before this freeze. The preceding full-suite
result of **8,386 tests across 650 files** is inherited validation on the unchanged
source, not a newly rerun full-suite result for this study.

The previous 64-piece screen could not supply the full requirements even with
perfect play. A 192-piece ceiling exceeds the necessary minima of **130 / 155 /
140 pieces** for orbs 49 / 55 / 59. This removes that particular budget obstruction;
it does not prove legal geometry, timely execution or feasibility within these
search budgets. A run can end or exhaust another budget well before 192 pieces.
Orb 55's optional twenty-Quad bonus would require at least **305 pieces** jointly
with three stars; it is not part of the exact three-star predicate or this target.

Seeds **9101 and 9102** are reused development data. Confirmation seeds starting
at 11001 remain reserved. This small study does not estimate ordinary-player
success rates, human enjoyment or the whole journey's difficulty curve.
Measured-wall durations are measured again, so these longer runs need not extend
the exact trajectories of the earlier 64-piece runs, even with the same seeds
and unchanged policy. Earlier outcomes provide context; they are not pooled with
this study or used as a matched comparison of policy effectiveness.

## Exact authored goals and finish behavior

The targets are the effective authored conditions returned by the level data and
star evaluator, including their existing overrides. Raw source literals before
those overrides are not the runtime target.

| Orb | Primary acquisition | Exact three stars | Finish behavior |
| --- | --- | --- | --- |
| 49 | Score at least 36,000. | Score at least 36,000, twelve Quads, one chain of at least eight waves. | Ordinary automatic finish after the winning cascade resolves. |
| 55 | Score at least 250,000 within 480 seconds. | Score at least 500,000, thirty-five cascade sequences, one chain of at least eighteen waves. | Showcase may continue after timely primary acquisition. |
| 59 | Score at least 160,000 within 210 seconds. | Score at least 260,000, twenty-five cascade sequences, one chain of at least twelve waves. | Showcase may continue after timely primary acquisition. |

At 55/59, the explicit `maxCascadeDepth` fields of ten/seven still apply, but their
`combo` fields of eighteen/twelve are stronger: both receive the same cascade-wave
ordinal. A cascade sequence is a lock that produces at least two clear waves;
an eighteen-wave chain is one sequence, not eighteen. Stars require their joint
predicate, not a sum of separately achieved fractions or optional bonus counts.

Primary acquisition is checked after the cascade's physics settles. A score
crossing inside an unfinished cascade does not establish a timely win; qualification
at the exact deadline wins the tie. Once a showcase primary has been acquired,
the acquisition deadline does not become a live post-win limit. The online policy
may request Finish at actual three-star qualification. All final readings drain
pending physics according to the existing bounded execution contract.

## Declared development coverage

The study assigns **24 CLI invocations**: twelve online parents and twelve
independent timestamp replays. The parents cross three orbs (49/55/59), two seeds
(9101/9102) and two path-repair policies (`none`/`reachable-v1`). Every parent uses
`measured-wall` latency and `setupStrategy: none`; this is not a structural-search
or fixed-delay comparison.

| Setting | Declared value |
| --- | --- |
| Piece ceiling | 192 completed placements |
| Total plan-plus-repair node ceiling | 1,440,000 |
| Full-plan beam width / nodes per call | Eight / 1,200 |
| Unknown-tail surrogate depth | One, after the current piece and exactly three visible previews |
| Decisions / replans per piece | 4,096 / 64 |
| Repair nodes per attempt | 4,096 |
| Spawn reaction / action interval | 150 ms / 100 ms |
| Simulated-time ceiling | 1,800 seconds |
| Parent wall-time ceiling | 360,000 ms |
| Independent replay wall-time ceiling | 120,000 ms |

Parents run **serially**, with repair order balanced across the six orb/seed pairs.
In registered pair order, the first policy is: 49/9101 `none`, 55/9101 repair,
59/9101 `none`, 49/9102 repair, 55/9102 `none`, 59/9102 repair. Each partner follows
immediately. Independent replays run afterward with at most three workers. Host,
load and process observations accompany execution. No concurrent tests or other
benchmark work are scheduled
while measured-wall parents run. Serial execution reduces campaign contention;
it does not establish an otherwise idle host or remove wall-clock variability.

The recorded wall duration of every full plan and repair attempt advances the
ordinary legacy loop in virtual 60 Hz steps, including gravity, automatic locks
and deadlines. `planningChargedMs` is the nominal requested duration;
`planningElapsedMs` is actual occupied simulation time after frame quantization
and interruptions. Wall time and process CPU are separate measurements. Beam
transitions and repair BFS states are different work units; their node counts are
resource accounting, not interchangeable efficiency measurements.

The spatial repair can find a path to the retained exact placement yet become
stale while it computes or executes. Accepted repair results and complete repaired
locks at the target remain distinct. The recorded path, actual input timing and
resulting simulation state determine what happened. An independent replay uses
the saved computation schedule and commands without calling or remeasuring the
planner. It validates that schedule, not browser scheduling or human input skill.

## Reporting and qualification

Retain every assignment, launch and observed exit code, including errors,
interruptions, rejected commands and failed repairs. Do not overwrite or silently
retry an original observation. Any recovery needs a separate declared cohort.
The source snapshot, frozen analyzers, runner journal, raw configurations, traces,
results, independent audit and validation records belong in the durable archive.

For each parent, report the stop reason, completed pieces, elapsed time, primary
acquisition/time, final star predicate, score, lines, Quads, cascade sequences and
maximum chain depth. Include **per-condition three-star residuals**, not only a
single progress score. Primary shortfall and deadline status are separate from
mastery shortfall. A primary win can have unfinished three-star observation; a
false quality-censor flag before primary acquisition does not imply full quality.

A piece, node, decision, simulated-time or wall-time cutoff before primary is a
censored primary observation. A verified top-out or missed acquisition deadline
is an observed terminal failure of that policy execution. A budget cutoff after
primary preserves the win while censoring further showcase quality. Never pool
those categories into an ordinary-player failure rate. A replay pass is evidence
of reproducible execution even when the policy loses or exhausts a budget.

Report all six repair/control pairs, keeping differing trajectories, durations and
stopping points visible. Numerical paired comparisons require both parents to be
complete and valid with their corresponding exact independent replays. Include
full-plan and repair calls, wall/CPU cost, nominal charge, actual occupied time,
nodes, stale/failed/accepted repairs and completed exact-target locks. Fewer full
plans alone does not establish speedup, better gameplay or a useful mastery policy.
No significance test or default-adoption threshold is selected for this study.

## Development results

All twelve parent traces have complete, valid independent schedule replays, so all
six assigned repair/control pairs qualify for descriptive comparison. The single
primary win is **orb 49 / seed 9102 / repair**, at 123.83 simulated seconds, with
one star. No showcase primary is acquired, so no post-primary showcase quality
window is observed. The three pre-primary budget censors are two piece limits
and one wall limit; none should be counted as an observed future loss or survival.

| Orb | Seed | Repair | Stop reason | Pieces | Simulated seconds | Final drained score | Quads / sequences / depth |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 49 | 9101 | None | Top-out | 158 | 242.88 | 35,833 | 0 / 7 / 3 |
| 49 | 9101 | `reachable-v1` | Top-out | 121 | 119.73 | 36,033 | 0 / 7 / 5 |
| 49 | 9102 | None | Top-out | 132 | 312.57 | 35,580 | 0 / 9 / 5 |
| 49 | 9102 | `reachable-v1` | Primary goal, one star | 139 | 123.83 | 36,361 | 1 / 9 / 4 |
| 55 | 9101 | None | Acquisition deadline | 170 | 480.00 | 32,725 | 0 / 16 / 3 |
| 55 | 9101 | `reachable-v1` | Piece-budget censor | 192 | 184.87 | 69,690 | 0 / 23 / 4 |
| 55 | 9102 | None | Wall-budget censor | 103 | 460.12 | 42,458 | 0 / 15 / 4 |
| 55 | 9102 | `reachable-v1` | Piece-budget censor | 192 | 192.43 | 63,966 | 0 / 17 / 5 |
| 59 | 9101 | None | Acquisition deadline | 122 | 210.02 | 112,003 | 0 / 7 / 9 |
| 59 | 9101 | `reachable-v1` | Top-out | 87 | 104.58 | 12,068 | 0 / 4 / 3 |
| 59 | 9102 | None | Acquisition deadline | 128 | 210.02 | 26,391 | 0 / 11 / 3 |
| 59 | 9102 | `reachable-v1` | Acquisition deadline | 186 | 210.02 | 86,642 | 0 / 19 / 6 |

The orb-49 / 9101 repair trace illustrates why final score is insufficient for
classification. It records `primaryReached: false` and a top-out, although its
final drained score is 36,033 and its raw `timedStars` field is one. The prior
lock ends at 35,989; the terminal lock 121 adds 44 fast-lock points at the top-out
timestamp. There is no earlier qualifying lock. Final score or a raw star field
does not override that terminal loss. Similarly, a zero score residual is not
proof of timely acquisition or a qualified mastery witness.
The 210.02-second entries reflect the ordinary frame-stepped deadline observation;
they do not extend the authored 210-second acquisition limit.

The full per-field predicates remain in `analysis.json`. The effective three-star
shortfalls from the final drained metrics are:

| Orb / seed / repair | Primary score shortfall | Three-star score shortfall | Missing Quads or sequences | Missing effective chain waves |
| --- | ---: | ---: | --- | ---: |
| 49 / 9101 / none | 167 | 167 | 12 Quads | 5 |
| 49 / 9101 / repair | 0; primary not acquired | 0 | 12 Quads | 3 |
| 49 / 9102 / none | 420 | 420 | 12 Quads | 3 |
| 49 / 9102 / repair | 0; primary acquired | 0 | 11 Quads | 4 |
| 55 / 9101 / none | 217,275 | 467,275 | 19 sequences | 15 |
| 55 / 9101 / repair | 180,310 | 430,310 | 12 sequences | 14 |
| 55 / 9102 / none | 207,542 | 457,542 | 20 sequences | 14 |
| 55 / 9102 / repair | 186,034 | 436,034 | 18 sequences | 13 |
| 59 / 9101 / none | 47,997 | 147,997 | 18 sequences | 3 |
| 59 / 9101 / repair | 147,932 | 247,932 | 21 sequences | 9 |
| 59 / 9102 / none | 133,609 | 233,609 | 14 sequences | 9 |
| 59 / 9102 / repair | 73,358 | 173,358 | 6 sequences | 6 |

These are separate unmet conditions, not an additive distance to a solution.
Orb 59's nine-wave control chain meets its explicit seven-wave depth field but
still misses the stronger twelve-wave combo field, sequence count, score and
primary deadline. Orb 55's two repair runs reach 192 pieces yet leave large
score, sequence and depth gaps. Clearing the initial inventory floor did not
supply a working joint construction.

Repair uses fewer full plans and less actual simulated compute occupancy in all
six observed pairs:

| Orb / seed | Full plans, none → repair | Repair attempts | Actual compute occupancy, none → repair |
| --- | --- | ---: | --- |
| 49 / 9101 | 804 → 122 | 652 | 143.80 → 43.90 s |
| 49 / 9102 | 989 → 142 | 649 | 205.65 → 49.73 s |
| 55 / 9101 | 943 → 192 | 226 | 378.42 → 80.53 s |
| 55 / 9102 | 895 → 192 | 243 | 379.60 → 88.05 s |
| 59 / 9101 | 645 → 90 | 585 | 122.17 → 39.90 s |
| 59 / 9102 | 633 → 190 | 941 | 123.02 → 70.25 s |

The different trajectories, durations and stops prevent a general speedup or
gameplay-quality inference. Orb 59 / 9101 makes the tradeoff explicit: the control
misses its deadline after a nine-wave chain, while repair tops out earlier with
three waves and much less score. These are policy observations, not player rates.

Across the six repair runs, 3,296 attempts produce 2,468 accepted results and
**888 completed repaired locks at their exact targets**. Accepted results can be
superseded before a lock; the ratio is not a probability of repair success.
Per-run median full-plan wall durations range from **139.67 to 397.73 ms** across
all twelve parents; repair medians range from **0.115 to 0.321 ms** across the six
repair parents. These host-specific samples describe different computations and
are not live browser performance measurements. The complete costs, discarded
computations, automatic locks and target checks remain in the raw record.

## Reproduction interface

The existing single-run CLI can execute the declared settings:

```sh
node scripts/odyssey-mastery.mjs online --level 49 --seed 9101 \
  --max-pieces 192 --beam-width 8 --max-nodes 1440000 --nodes-per-plan 1200 \
  --unknown-tail-depth 1 --setup-strategy none --timing-policy fixed-cadence \
  --max-decisions 4096 --replans-per-piece 64 --repair-nodes 4096 \
  --reaction-ms 150 --action-ms 100 --max-seconds 1800 --wall-ms 360000 \
  --path-repair reachable-v1 --planning-latency measured-wall \
  --output /tmp/odyssey-long-repair

node scripts/odyssey-mastery.mjs replay-online \
  --witness /tmp/odyssey-long-repair/witness.json \
  --wall-ms 120000 --output /tmp/odyssey-long-repair-replay
```

Use new output directories. Select `--path-repair none` for the control; the exact
frozen registration remains authoritative for study commands, order, runtime and
source. New measured-wall runs can produce different schedules; exact independent
replay instead uses the saved schedule. An ad hoc rerun or a modified budget is
not a new observation in this frozen cohort or a fresh-seed confirmation.

## Independent audit and durable record

The independent auditor was prepared and snapshotted before this registration or
outcome review. It imports neither the frozen main analyzer nor game/planner code
and launches no gameplay. All twelve parent/replay execution projections match;
the audit reports zero errors across **3,460 completed-lock conservation/scoring
checks, 17,736 command checks, 18,266 computation-window checks and 1,776 repaired-
target checks**. These counts include parents and replays: there are 1,730 unique
parent locks, 9,133 parent computation windows and 888 completed repaired target
locks. Rechecking the same execution is not a second gameplay observation.

No interruption, recovery, seed replacement or silent retry was needed. The
durable record preserves every assignment and observed exit, all raw inputs and
results, full per-condition residuals, source/runtime snapshots, frozen analysis,
independent audit, validation records and the separate prior-trace construction
diagnostic. The [evidence archive](benchmarks/2026-10-07-long/README.md) contains
**243 members** in a **15,074,281-byte** ZIP with SHA-256
`b60f6010a5db0059f378d5d3a1bd20b25bf4cb0accb092059483f6cdc0a318cd`.
Fresh independent verification at **2026-10-07 19:54:47.058632 UTC** checks the
archive and every member's size/hash. Extracted analysis and the construction
diagnostic reproduce byte for byte; the independent raw audit matches every field
and input hash except its new top-level `auditedAt` value. The external manifest
records those checks. The archive includes final terminal-boundary and
construction audits, fourteen prior input files matched to their original ZIP
and 920 prior-lock arithmetic checks; those remain retrospective evidence.

## Retrospective construction diagnosis

The orb-49 final chain must follow its earlier Quad prefix without ordinary finish
firing too soon. The [224-cell terminal bound](ODYSSEY_ONLINE_MASTERY_2026-10.md#a-tighter-orb-49-inventory-bound)
excludes five Quads inside an eight-wave chain; eight earlier Quads plus four
terminal Quads is one arithmetic route, not a constructed witness.
For 55/59, depth and sequence counts require different work: a deep single chain
does not supply the many separate cascade sequences. Increasing only a generic
search ceiling does not resolve either legal construction problem.

A separate arithmetic review preserves seven prior `structural-v1` traces from
source `96b2364`: the only orb-49 run reaching eight prior Quads, plus all three
previous seeds at each showcase. Its selection is retrospective and declared;
these are not additional observations from the current measured-wall study.
The portable diagnostic, exact input bytes and source review are retained under
`construction-review/` in the evidence archive. The current policy and source
remain unchanged.

That earlier orb-49 seed-9103 path becomes impossible **under its untimed +50
lock-bonus context** at lock 121, before its top-out at 126. It has score 35,400,
eight Quads and 144 cells. Supplying the 200 cells for a relaxed four-Quad terminal
chain needs at least fourteen more locks, thirteen before the trigger. Their
bonuses alone force preterminal score to at least 36,050, beyond automatic finish.
A ninth earlier Quad also exceeds the remaining score headroom; a five-Quad
terminal chain exceeds board capacity. This excludes continuation of that state
under that scoring assumption, not timed play or the authored level. Timed locks
can award less; a timed bound must use a separately justified minimum bonus.

At orb 55, all three earlier structural traces already exceed their remaining
sequence-trigger budget at lock 159: they still need 34 distinct sequences, with
only 33 future locks in a 192-piece experiment. Their material-only bounds fail
later, at locks 175/181/179. By contrast, all three orb-59 traces top out while
the optimistic material bound still passes. Sufficient cells alone neither reserve
enough separate triggering pieces nor establish safe geometry.

The next construction method should track a feasibility envelope after every
settled lock: remaining trigger slots, required clear cells, missing depth, primary
history and deadline slack, plus orb-49 preterminal score headroom. Keep the bounds
active through all setup phases. Any exclusion must be sound for its timing and
scoring context; an unproven geometric estimate remains a preference. Then search
for legally built release structures with recorded component support dependencies,
wave order, trigger and reachable inputs, retaining candidates that preserve the
different remaining goal resources. A prepared cell diagram is only a fixture;
the witness must still be built from the authored start using actual tetrominoes,
legal observations and production physics.

At orb 55's fixed level 12, an eighteen-wave chain already guarantees at least
795,300 points from single-line waves alone; the joint problem still needs 35
distinct sequences and timely primary acquisition. A separate thirteen-wave
primary chain, later eighteen-wave chain and 33 other two-wave sequences requires
at least 183 pieces in a relaxed inventory calculation. A fixed primary-first
depth stage can therefore consume most of this study's budget. Prefer a
state-specific scoring route instead of adding that intermediate target blindly.
These arithmetic implications are not observed new chains or construction proofs.

## Player questions

The existing [formative player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
and [blank session template](benchmarks/2026-10-07-targeted/player-playtest-template.csv)
remain usable. They record build, experience group, control device, attempt,
completion, stars, active time, stop reason, goal understanding, challenge,
frustration, retry intent and open notes. Keep natural progression separate from
checkpoint sessions, record hints and unfinished sessions, and observe interested
players' star attempts after primary completion. The notes fields can capture
specific construction understanding and any deliberate waiting at orb 49.

For orb 49, ask whether preparing earlier Quads and a finishing chain is clear and
satisfying, and whether score headroom or fast-lock bonuses make players feel
pushed to wait. Also test whether reaching the score on a lock whose next spawn
tops out matches players' expectations. The recorded terminal behavior is
verified; its clarity and perceived fairness need separate player evidence and
do not establish a bug or a decision to change finish rules. At 55/59, distinguish
reaching the primary in time from choosing
to continue the showcase. These are questions for real playtests; no participant
sessions, opinions, recruitment or human calibration are supplied by this study.

Any next policy or balance intervention should follow the remaining demonstrated
gap, with changed targets, methods and budgets declared before new outcomes are
examined. A legal full witness would establish one construction under its recorded
conditions. It would still leave learnability, satisfying challenge and the
progression curve to the separate player evidence.
