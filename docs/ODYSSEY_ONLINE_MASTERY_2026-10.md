# Odyssey online mastery — 2026-10-07

## Scope and status

This development continuation adds replanning against the current falling piece
under authored gravity, independent replay of recorded input timestamps, and an
opt-in `structural-v1` setup strategy. It addresses the execution and geometry
gaps in the [targeted-mastery study](ODYSSEY_TARGETED_MASTERY_2026-10.md); the
[previous archive](benchmarks/2026-10-07-targeted/README.md) remains immutable.
Authored goals, scoring, gravity, opponents and finish rules are unchanged.

The implementation is committed as
`96b2364b6b7de8b1695ea6e9f73fdeba844dede6`. Seventy-four focused tests pass,
scoped lint is clean, and all non-test project gates pass. The full suite passes
**8,362 tests across 649 files** in 107.44 seconds. Source and analysis registration
froze at **2026-10-07 17:26:32.105 UTC**, before campaign outcomes. The frozen
analyses and separately identified recovery coverage are complete. No full mastery
witness qualifies. Independent raw audit and fresh archive verification pass.
The [packaged evidence ZIP](benchmarks/2026-10-07-online/README.md) contains 488
members and is 15,517,132 bytes, with SHA-256
`85acc2015a13b692043808d9036f434402763e37c5441f98a02a8af59c6d8cc3`.
Fresh extraction verifies every member's bytes and hash. Both frozen analyses and
the coverage report reproduce byte for byte; the raw audit passes again and matches
every field and input hash except its newly generated top-level `auditedAt` timestamp.
Runs remain development work on previously explored
seeds 9101–9103; confirmation seeds starting at 11001 remain untouched. No policy
adoption, balance retuning, human success probability or conclusion about player
enjoyment follows from this round alone.

## What the earlier timed paths failed to handle

A retrospective audit of the frozen `0ecb883` records examines all thirteen
interrupted timed paths and the five complete partial controls. It performs no new
search or gameplay. Each failed piece starts on exactly the candidate board with
matching previews, and every earlier completed board agrees. Gravity changes the
current falling piece during execution of commands planned without elapsed time:

| Orb | Automatic locks | Rejected horizontal moves | Rejected rotations | Complete partial controls |
| --- | --- | --- | --- | --- |
| 49 | 6 | 0 | 0 | 0 |
| 55 | 0 | 0 | 1 | 5 |
| 59 | 1 | 5 | 0 | 0 |

Each automatic lock follows two to six grounded soft-drop no-ops, with another
300–500 ms observed between the first such no-op and locking. The script spends
lock-delay time on descent commands after gravity has already grounded the piece.
All seven locks produce a different pose from the intended placement. The six
rejected commands occur one to eighteen rows below their untimed expected pose.
One orb-55 rotation fails after 130 correct completed pieces.

This identifies stale current-piece paths, not prior board drift. It motivates
observing the actual pose and finding a currently reachable path. Surviving with a
different placement does not prove recovery of the original intended tuck. Once
an online policy chooses a different earlier placement, it follows a different
trajectory; its later success cannot be labeled a rescue of a particular old
failure fixture.

The five complete controls all exhaust 192-piece orb-55 scripts below the primary
goal. All eighteen old timed records are primary-censored. Their false quality-
censor flags do not establish complete quality when no primary was acquired.
Reproduce the retrospective audit with:

```sh
python artifacts/odyssey-online-mastery-2026-10-07/failure-audit/audit.py
```

## A tighter orb-49 inventory bound

The earlier archive used a generous 240-cell upper bound for the standard board.
A fully drained pre-lock board has twenty visible rows with at most nine cells
each: a full visible row would already have cleared. Giving all four hidden rows
ten cells each yields at most `20 × 9 + 4 × 10 = 220` locked cells. The triggering
tetromino adds at most four, so the final cascade has **at most 224 cells** to
consume. Off-grid cells are clipped before gravity and cannot add inventory.

An eight-wave chain with five Quad waves needs at least
`10 × (8 + 3 × 5) = 230` cells. Therefore five final-chain Quads are excluded,
including the old seven-prior/five-final-Quad relaxation. Scoring still allows
at most nine Quads before the finishing cascade. Allocating the minimum required
twelve leaves these necessary lower bounds:

| Earlier Quads | Final-chain Quads | Minimum total lines | Minimum pieces from the empty start | Minimum cells in final chain |
| --- | --- | --- | --- | --- |
| 8 | 4 | 52 | 130 | 200 |
| 9 | 3 | 53 | 133 | 170 |

Extra Quads or waves only increase the required inventory. Thus **orb 49 needs at
least 130 placed pieces** for its full three-star conjunction, independent of
whether the geometry can be constructed. In the prior untimed context, fifty
lock-bonus points per piece make nine prior Quads acquire the primary too early;
the eight-prior/four-final allocation is the remaining arithmetic route. Timed
lock bonuses can be smaller, so that scoring exclusion is context-specific.

This is a stronger necessary bound, not a construction or impossibility proof for
the authored goal. It supersedes the loose 240-cell allocation in current
interpretation without rewriting the historical evidence. Orbs 55/59 retain their
source-derived minima of 155/140 pieces for exact three stars. Orb 55's additional
twenty-Quad bonus raises its combined minimum to 305 pieces; it is not required
by the three-star predicate. One eighteen-wave chain still counts as only one
cascade sequence.

## Online control and independent replay

The online policy observes the current board, actual falling-piece pose, metrics
and exactly three previews, then selects commands under the declared
reaction delay and action interval while normal gravity and lock delay advance.
The current revision restricts planner inputs through explicit allowlists.
Replanning and fallbacks remain bounded and recorded, including discarded decisions.
The controller replans after gravity changes the pose, a command is rejected, a
path is exhausted or a soft drop reaches a grounded stop. It preserves the spawn
reaction gate and executes at most one command per action interval. An automatic
lock clears the old plan and continues with the next piece.

Review found a gap in the old `observation-beam-v2` interface: its search driver
passed the seed through a spread of the full configuration into the planner's
second options argument. The planner did not read that field, and there is no
observed RNG or hidden-bag use, but the earlier strict statement that the planner
never received a seed exceeded what the API enforced. The v3 revision replaces
that pass-through with a budget-only option allowlist in both search and online
drivers, with getter-trap tests guarding the boundary. This hardens the API;
it does not relabel the immutable v2 archive as having enforced the newer contract.

An automatic lock is ordinary simulation behavior for an online policy; the same
event may invalidate a fixed script that expected a different final pose. Report
real terminal outcomes, legal surviving placements, rejected actions, interrupted
traces and resource limits separately. Different labels alone are not evidence of
an execution improvement.

Independent timestamp replay reconstructs the authored start and bag, replays the
recorded input times without calling the planner, and checks the resulting poses,
board connectivity, scores and cell conservation. It must preserve exact ordinary
auto-finish, settled primary-goal evaluation and live showcase continuation after
primary acquisition. A recorded command trace verifies an execution sequence;
the planner's information boundary remains a separate source/test property.
The online policy explicitly requests the live Finish action once primary victory
and the actual three-star predicate are both observed. It does not automatically
finish a won showcase at the acquisition deadline. Global node, decision, piece,
simulation-time or wall limits censor any remaining objective or quality window.
Timestamp replay checks accepted and rejected inputs, automatic locks, the stop
phase, final metrics and primary/quality flags without making new decisions.

The optional `structural-v1` strategy targets construction geometry explicitly.
It must be selected with `--setup-strategy structural-v1`; the default remains
`none`. At 49 it favors an edge well for I pieces until eight prior Quads, scoring
ready rows, shaft blockers, outside holes and the surface. It discourages incidental
clears and applies a soft penalty when an optimistic prefix-score floor exceeds
35,999; that floor uses a zero minimum lock bonus so it remains a lower bound under
timed play. It then favors stored material for the terminal chain.

At 55/59, the policy favors storage and preparation toward intermediate depths:
the smaller of the authored depth and `max(6, observed depth + 2)`. It discourages
discharging below the current milestone when the board is safe, then focuses on
distinct cascade sequences once the authored depth is reached. These are heuristic
preferences, not a necessary order or proof of a solution. The optional twenty-
Quad bonus at 55 is not added to the three-star objective. Actual commands remain
reachable and the authored evaluator remains authoritative. A promising geometry
score or prepared topology is not a legal assembled witness.

## Declared development coverage

The frozen protocol assigns **54 invocations** on the three previously explored
seeds 9101–9103:

| Cohort | Assigned tasks | Declared policy and limits |
| --- | --- | --- |
| Structural construction search | Nine: 49/55/59 × three seeds. | `structural-v1`; at most 192 pieces, beam eight, 240,000 total nodes, adaptive 2,400-node per-plan ceiling, one unknown-tail step, 240-second wall budget. |
| Independent untimed replay | Nine, one per retained structural trace. | Replay partial as well as successful traces; keep validity, trace completion, primary and exact mastery separate. |
| Online control | Eighteen: 49/55/59 × three seeds × 150/100 ms and 300/180 ms reaction/action intervals. | Setup strategy `none`; at most 192 pieces, beam eight, 720,000 total nodes, 1,200 nodes per plan, 2,048 decisions, 64 replans per piece, one unknown-tail step, 240-second wall and 1,800-second simulation limits. |
| Independent timestamp replay | Eighteen, one per retained online witness. | Replay recorded input timestamps without planning; 120-second wall budget. |

The source manifest contains 1,188 files with combined SHA-256
`bbb09217bd3cabab39750d9ec3052b4a1c42d2042486b02c96bc1f8c2f754501`.
The frozen analyzer SHA-256 is
`dbe79c2bb5af3903c1b75feb6a407ddce09afea4c0d84664cf08f21eba24b24d`.
Execution uses three concurrent workers on Node `v24.19.0`, Linux x64. The recorded
environment exposes five CPUs on an AMD EPYC 9V74 host; planner timing measurements
must retain that concurrency context. Registration, source snapshot, environment,
baseline evidence and analyzer are under
`artifacts/odyssey-online-mastery-2026-10-07/`.

The online policy records its hard-drop fallback when a piece reaches its replan
cap or no plan is available. Discarded plans and replans count toward declared
budgets. This is a development comparison of two distinct capabilities: untimed
structural construction and gravity-aware online execution with the setup strategy
disabled. It is not a crossed experiment of both strategies at both cadences.

Comparisons with old fixed scripts are descriptive and cross source revisions.
Include all old interrupted paths and complete partial controls when presenting
such comparisons; do not select only cases that now survive an old failure point.
No selected-prefix recovery fixture is an independent success-rate sample.
This is an experimental mastery-seeking policy that deliberately explores different
setups from earlier primary-goal profiles. Its primary-win count is not an ordinary-
player win rate or an overall difficulty calibration, even when execution is valid.

## Process interruption and separately registered recovery

The original runner session vanished and no benchmark workers remained. The exit
reason is unknown. At that point, 23 parent invocations had recoverable completed
output summaries, three were partial, and one original parent had not started.
The initial reconstructed journal lacked their exit observations, but the preserved
outer `run.log` explicitly records **exit code zero for all 23**. The owner reconciled
those observations into the final journal. Only the three interrupted exit codes
remain unknown. All partial configuration, progress and log files remain preserved.

The three interrupted online assignments are orb 55 / seed 9103 at both cadences
and orb 59 / seed 9103 at 150/100 ms. Their three original dependent timestamp
replays are explicitly skipped because usable parent witnesses are missing.
Untouched original work continues separately under the original registration.
The original 54 assignments must not be described as 54 completed invocations.

A separate recovery registration froze at **2026-10-07 18:15:38.964069 UTC** with
SHA-256 `211338caf9e5c3efdd2d0bcb5013fb37539cf32fd6504dedb5134a2bc2b0e129`.
It assigns exactly six tasks: retry those three interrupted parents and independently
replay each new timestamped witness. Source `96b2364`, runtime, seeds, policy, cadence and
all limits are unchanged; there are no parameter changes or outcome-based task
selections. The new files live under `recovery/` and do not replace the originals.

The frozen original and recovery analyses remain separate:

| Registration | Completed invocations | Interrupted/incomplete | Not executed |
| --- | --- | --- | --- |
| Original 54 | 48 | 3 parents | 3 dependent timestamp replays |
| Recovery 6 | 6 | 0 | 0 |

`combined-coverage.json` maps the 27 planned parent/replay pairs to **24 completed
original pairs and three completed recovery pairs**. This is coverage accounting,
not a pooled outcome cohort or replacement of the interrupted attempts. All fifteen
preserved partial files are unchanged. Retry progress matches every preserved
record: 130/130 for 55 steady, 76/76 for 55 deliberate and 28/28 for 59 steady.
These comparisons include metrics, simulated time, nodes, decisions and counters;
wall/CPU timing is excluded. They verify the recorded prefixes, not an unobserved
continuation of the interrupted originals. The main frozen analyzer is unchanged.

## Development results

All **27 completed parent/replay pairs** pass their relevant independent replay
checks: nine structural traces replay untimed, and eighteen completed online
observations replay from their recorded timestamps. The latter include fifteen
original pairs and three separately registered recovery pairs. Valid replay means
the recorded execution can be reproduced, not that its objective was achieved.

The separate raw auditor reports zero errors across **7,928 completed-lock
conservation/scoring checks and 34,514 command checks**. All nine untimed and
eighteen timestamp replay projections match exactly. The raw auditor was developed
during execution and recovery, with its timing disclosed in the evidence; it does
not replace the unchanged frozen analyzer. Both frozen analysis outputs and the
coverage output reproduce byte for byte after relocation.

The structural results, all in the original registration, are:

| Orb | Seeds 9101 / 9102 / 9103 | Recorded ending |
| --- | --- | --- |
| 49 | Six / seven / eight Quads; maximum chains 2 / 0 / 0. | All top out, at 114 / 122 / 126 pieces. |
| 55 | Maximum chains 6 / 5 / 5; exactly one cascade sequence each. | All exhaust 192 pieces below primary. |
| 59 | Maximum chains 5 / 0 / 0. | All top out, at 99 / 59 / 60 pieces. |

The eight-Quad result is **eight Quads before top-out**. It does not establish a
surviving terminal setup, a reachable finishing chain or overall mastery improvement.
No structural run reaches primary or the full three-star conjunction. The policy
remains experimental; stored material and deeper chains alone do not satisfy the
required joint score, Quad, depth and distinct-sequence conditions.

The completed online observations retain their cohort labels:

| Observation source | Primary wins | Real top-outs | Node-budget censors | Piece-budget censors | Full mastery |
| --- | --- | --- | --- | --- | --- |
| Original, 15 completed online runs | 3 | 2 | 5 | 5 | 0 |
| Recovery, 3 completed online runs | 0 | 0 | 1 | 2 | 0 |

Across the 18 covered online assignments this describes three primary wins, two
real top-outs and thirteen budget-censored observations. All three wins are orb 49
and one star: steady / 9101 at 63.32 simulated seconds, deliberate / 9102 at 85.40,
and deliberate / 9103 at 112.03. The two top-outs are also 49; all 55/59 observations
end at a node or piece limit before primary. Budget exhaustion is not a gameplay
defeat. No full three-star or computationally qualified real-time witness results.

This experimental mastery-seeking policy deliberately pursues different setups
from prior primary-goal profiles. Its three primary wins cannot estimate an
ordinary-player win rate or calibrate overall game difficulty. Online automatic
locks and recoverable rejected commands are not equivalent to old fixed-script
invalidations, and different trajectories do not establish rescue of an old tuck.

## Planning cost and timing limits

The first implementation pauses virtual gameplay time during planning. Gravity,
input cadence and deadlines advance in the simulated execution, but measured
planner CPU and wall time are **not charged to that clock**. Describe any result
as gravity-aware execution with computational feasibility unqualified. It cannot
show that an online solver or a person makes the decisions fast enough in real time.

Record per-decision wall and CPU cost, expanded nodes, observation pose/time,
planned command and actual input time. Keep these measurements separate from
simulated completion duration and report worker concurrency. The prior search's
approximately 169–432 ms median intervals between progress records included
planning, engine work, logging and contention; they were not isolated CPU timings.
The implementation records monotonic `plannerWallMs` and process `plannerCpuMs`
per decision and in aggregate, with `plannerWallTimeChargedToSimulation: false`
and `realtimePlanningFeasibility: "unverified"`.

For the 18 covered online observations, the recorded per-run median decision wall
cost ranges from **159.92 to 441.85 ms**, and median process CPU cost from
**166.32 to 504.44 ms**. These are ranges of per-run medians, not a pooled latency
estimate. Each run makes 270–602 planning decisions, with 78–460 gravity-triggered
replans. The coverage includes three separately labeled recovery observations and
retains the registered worker context. None of this computation advances the
simulation clock; the measured primary wins remain computationally unqualified.

A later charged-latency model would advance gravity and deadlines while planning,
respect the reaction/action gates, and discard commands for a piece that locks
before planning finishes. An artificial fixed delay is a scenario, not proof that
the actual solver meets that latency. This round's timestamp replay cannot validate
uncharged computation merely by reproducing the same inputs.

## Reproduction and reporting

The committed CLI exposes `online` and `replay-online` alongside the existing
search/replay commands. These examples reproduce the declared settings for one
development case; the frozen registration contains all 54 exact commands. Use new
output directories and retain every assigned result:

```sh
node scripts/odyssey-mastery.mjs search --level 49 --seed 9101 --setup-strategy structural-v1 --max-pieces 192 --beam-width 8 --max-nodes 240000 --nodes-per-plan 2400 --unknown-tail-depth 1 --wall-ms 240000 --output artifacts/odyssey-online-reproduction/structural-49-9101
node scripts/odyssey-mastery.mjs replay --candidate artifacts/odyssey-online-reproduction/structural-49-9101/candidate.json --mode untimed --wall-ms 120000 --output artifacts/odyssey-online-reproduction/replay-structural-49-9101
node scripts/odyssey-mastery.mjs online --level 49 --seed 9101 --setup-strategy none --timing-policy fixed-cadence --reaction-ms 150 --action-ms 100 --max-pieces 192 --beam-width 8 --max-nodes 720000 --nodes-per-plan 1200 --max-decisions 2048 --replans-per-piece 64 --unknown-tail-depth 1 --max-seconds 1800 --wall-ms 240000 --output artifacts/odyssey-online-reproduction/orb-49-seed-9101
node scripts/odyssey-mastery.mjs replay-online --witness artifacts/odyssey-online-reproduction/orb-49-seed-9101/witness.json --output artifacts/odyssey-online-reproduction/replay-orb-49-seed-9101
```

Retain every assigned run and witness, including interrupted or unsuccessful
attempts. A completed invocation is distinct from a valid replay, a completed
trace, primary victory, full three-star qualification and all-bonus completion.
No outcome is promoted to a fresh confirmation by reusing a development seed.

No human playtest has been run. Use the existing
[formative protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
and [blank player template](benchmarks/2026-10-07-targeted/player-playtest-template.csv)
to investigate learning, recovery beats, motivation and perceived challenge.

## Conditional next steps

The measured repeated planning motivates a separate experiment repairing the
command path to the already chosen
placement before running another full four-piece search. Recompute reachability
from the actual pose and remaining lock time; the intended target may no longer
be reachable. Retain a declared full-replan or legal fallback when repair fails,
and count all repair attempts and discarded work against the budget. This is a
proposed experiment, not an implemented or selected policy change.

Measure that decision path's wall and CPU cost, then run a separately frozen
charged-latency model in which planning time advances gravity, lock timers and
deadlines. Reduced planner cost would not by itself establish a complete mastery
witness. Structural improvements still need a legal assembled trace satisfying
the joint score, Quad, chain and sequence conditions, appropriate timed execution,
and formative player sessions before any claim about enjoyable challenge.

For orb 49, test whether preparing the earlier Quads and the final chain is
understandable and satisfying. Faster locks earn a larger positive bonus, which
can consume more score headroom before automatic finish; waiting can reduce that
bonus. Observe whether players feel pushed to wait and ask how that affects their
planning and enjoyment. This question follows from the rules and bounds, not
evidence that players dislike the interaction or that the authored goal is unfair.

## Evidence status

| Record | Status |
| --- | --- |
| Retrospective fixed-path audit | Complete; thirteen interrupted paths and five partial controls retained. |
| Tighter orb-49 bound | Independently reviewed; at most 224 final-cascade cells and at least 130 pieces for three stars. |
| Online control, structural strategy and timestamp replay | Committed as `96b2364`; 74 focused tests, all 8,362 tests in the full suite, clean scoped lint and all non-test gates pass. |
| Source/analysis freeze and development outcomes | Original: 48 completed, three interrupted, three skipped; separate recovery: six completed. All 27 covered parent/replay pairs pass their replay checks; no mastery witness. |
| Independent raw audit | Pass: zero errors, 7,928 completed-lock conservation/scoring checks, 34,514 command checks and exact replay projections. |
| Durable evidence archive | [Complete and independently verified](benchmarks/2026-10-07-online/README.md): all 488 members verified, both frozen analyses and coverage byte-identical; raw audit identical except its new `auditedAt`. |
