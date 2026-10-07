# Odyssey planning latency and path repair — 2026-10-07

The follow-up [192-piece mastery study](ODYSSEY_LONG_MASTERY_2026-10.md)
extends the measured-wall comparison and records exact goal residuals and
construction constraints. This document preserves the earlier 64-piece screen.

## Scope and implementation status

This development study follows the [online mastery continuation](ODYSSEY_ONLINE_MASTERY_2026-10.md).
That controller repeatedly recomputed a multi-piece plan when gravity changed the
current pose, while planning time did not advance the virtual game clock. The new
experiment separates two questions: whether a bounded repair can retain a chosen
placement, and how execution changes when the game clock advances during planning.

The implementation is committed and pushed as
`a5068da1fe578c7ec5d0af6f6edd2dcf2efc5a01`. All **98 focused tests** pass;
the full suite passes **8,386 tests across 650 files** in 107.45 seconds.
Scoped lint is clean, and the project's typecheck, TypeScript ratchet, lint CI,
boundaries, architecture and release gates pass. A retained real v1 witness also
passes independent replay with the new implementation; this compatibility check
is separate from the new study assignments.

Source and protocol registration froze at **2026-10-07 18:49:45.523 UTC**;
all **60 assigned invocations complete with observed exit code zero**, and all
**30 independent timestamp replays pass**. The frozen analysis and independent
raw audit and fresh multipart archive verification pass. Repair reduces
full-plan call counts in all fifteen descriptive pairs, but this is not a general
speedup or gameplay-quality result. The new options are
opt-in `reachable-v1` path repair and planning
latency modes `uncharged`, `fixed` and `measured-wall`. Defaults remain repair
`none` and latency `uncharged`. Authored levels, goals, scoring, gravity, opponents
and finish rules are unchanged.

This is an early execution screen, not a joint-mastery feasibility test or journey
balance experiment. Every parent run is capped at **64 placed pieces**, below the
source-derived necessary three-star minima of **130 / 155 / 140 pieces** for orbs
49 / 55 / 59. Even a perfectly executed trace at this limit cannot supply their
full three-star requirements. No production retune, default-policy adoption,
player success probability or conclusion about enjoyment follows from this screen.
Seeds 9101 and 9102 are previously explored development data; confirmation seeds
starting at 11001 remain reserved. No human sessions are included.

## Execution behavior

The planner continues to observe the authored board, current piece and exactly
three previews through the existing observation boundary. A full plan selects a
placement and command path. With `reachable-v1`, the controller may first search
for another legal path from the current pose to that selected placement before
spending another full multi-piece planning call. Repair is bounded work with its
own per-call cap and cost records; it also consumes the shared total node budget.
Failed and stale attempts remain in the evidence.

The repair mechanism, `exact-target-bfs-v1`, reads only the observed board and
current piece; it does not need the previews. Its breadth-first search uses
production collision, movement and rotation rules, validates canonical piece
shape and orientation, and targets the exact selected x/y/rotation/shape. A
successful path ends in hard drop. Symmetric footprints do not make different
rotation states interchangeable. Grounded soft-drop no-ops and no-op O-piece
quarter turns are excluded. Reachable, unreachable and budget-exhausted results
are distinct; admitted unique states, including the initial state, consume the
per-repair node cap.

A spatially reachable target is not necessarily achievable at the declared input
cadence before gravity or lock delay changes the situation. The old target may
become unreachable, and a repaired path may become stale during its own computation.
The controller must still react to the actual post-computation state. Retaining a
target and executing it legally is a mechanism check; a different later trajectory
does not prove rescue of a particular failed tuck from an earlier campaign.
Even the same landing geometry need not preserve elapsed-time-dependent lock
bonuses or other scoring history; the actual resulting game state is authoritative.

The latency modes apply to each full-plan or repair computation:

| Mode | Game-clock treatment | Interpretation |
| --- | --- | --- |
| `uncharged` | Planning does not advance simulated game time. | A control that retains the previous timing assumption. |
| `fixed` | Charge 200 ms per call in this protocol, including failed attempts. | A deterministic artificial-delay scenario, not a measured CPU cost. |
| `measured-wall` | Charge the recorded wall duration of that call. | A host- and load-dependent execution observation. |

Charged windows continue the ordinary legacy game loop at its normal virtual
60 Hz stepping, including gravity, automatic locks, acquisition deadlines and
finish rules. This is not the canonical `fixed60-v1` benchmark timing model.
Inputs retain the 150 ms per-spawn reaction delay and 100 ms action interval.
The inactive fixed-delay option is recorded as 200 ms in every configuration;
only `fixed` charges that value. Wall and process CPU measurements remain separate
from simulated elapsed time and the charged-delay total.

Positive latency releases the result on the first input frame after normal game
logic has advanced through `readyAtMs`. Locks and deadlines at readiness therefore
take priority. Frame quantization means a nominal 200 ms delay can occupy about
216.67 simulated milliseconds. `planningChargedMs` records the requested nominal
delay, including interrupted calls; `planningElapsedMs` records the actual
simulation time occupied, including frame quantization. An interrupted call can
have more nominal charged time than actual occupied time. Zero charge can release
on the same frame unless a wall-budget stop intervenes.

After a charged window, a computation result is discarded when its piece, board
or pose no longer agrees with the decision state. Only the same piece and board
can retain the exact target for a subsequent repair. Every repair attempt uses
the selected latency model, including failed attempts; a failure does not trigger
a recursive full search on that same frame. These delays and discarded results
remain part of the execution cost and resource accounting.

Independent v2 timestamp replay reconstructs the authored board and
bag and validates the recorded computation schedule and commands without invoking
or remeasuring the planner. Compatibility with existing v1 witnesses is retained.
The v2 projection binds candidate actions to the full computation schedule;
`trace.targetValidation` checks the actual repaired hard-drop target.
Replay validity, trace completion, actual terminal state, primary acquisition and
quality censoring remain separate. Automatic locks and rejected inputs are normal
execution events and do not, by themselves, invalidate an online witness.

Advancing a simulator through a recorded computation window is not a measurement
of browser scheduling, rendering, input responsiveness or live main-thread
performance. Serial measured-wall execution reduces campaign contention but does
not establish an otherwise idle machine. Neither a spatial path nor an exact
timestamp replay establishes human input feasibility or fair, satisfying play.

## Frozen development coverage

The frozen protocol under `artifacts/odyssey-planning-latency-2026-10-07/` assigns
**60 invocations**, with every parent receiving an independent timestamp replay:

| Phase | Online parents | Replays | Execution context |
| --- | ---: | ---: | --- |
| Uncharged / fixed 200 ms | 24: three orbs × two seeds × two repair policies × two latency modes. | 24 | At most three workers. |
| Measured wall | Six: three orbs × seed 9101 × two repair policies. | Six | Parents run serially after the deterministic phase; no concurrent tests or other benchmark work. |

The orbs are 49, 55 and 59. Repair policies are `none` and `reachable-v1`.
Every parent uses setup strategy `none`, beam width eight, one unknown-tail
surrogate step, at most 1,200 beam nodes per plan, 4,096 repair nodes per attempt,
360,000 total plan-plus-repair nodes, 1,024 decisions and 64 replans per piece.
The common ceilings are 64 pieces, 1,800 simulated seconds and 120,000 ms wall
time. Repair BFS nodes and beam-search transitions are different work units;
their counts must not be treated as interchangeable measures of efficiency.

The serial measured-wall order alternates which policy goes first: orb 49 runs
`none` first, orb 55 runs repair first, and orb 59 runs `none` first. Runtime, CPU,
load and process inventory are captured before and after that phase. These six
observations remain separate from the deterministic fixed-delay comparisons.

Registration SHA-256 is
`812dc8278b3c9d3dceae031ddcbb3539e8e1f46b4702282815867ede43d11e7e`.
The source manifest contains **1,189 files** with combined SHA-256
`8f901fade30cb15ef16e73567ba69dd8928240220c40305f985cb8bd2a99ebda`.
The frozen analyzer SHA-256 is
`60b2f0530777cddd20a2df9506fa03c7375c3c2e541f2548e028954678d69d7c`.
The recorded runtime is Node `v24.19.0`, Linux x64, on an AMD EPYC 9V74 host;
the environment reports five logical CPUs and four available for parallelism.
The three-worker deterministic phase and serial measured-wall parent phase
must accompany any planning-cost interpretation.

For each assigned repair pair, report pieces, simulated time, score, lines,
cascade sequences, maximum depth, Quads, rejected inputs, automatic locks,
fallbacks, full-plan and repair calls/nodes/wall/CPU cost, and charged delay.
Distinguish attempted, applied, rejected or unreachable, and stale repairs.
The `repairSuccesses` counter counts computational results accepted by the
controller, not necessarily complete repaired paths that land at their retained
target: gravity may invalidate a later command. Audit fully consumed repaired
paths whose actual lock pose matches the target separately.
Compare repair policies within an orb/seed/latency condition; compare uncharged
and fixed latency within each repair policy. Report all assigned pairs, including
incomplete or invalid observations, and require a complete verified parent plus
exact independent replay for numerical paired comparisons.

These are descriptive comparisons on development seeds, with no significance
test or adoption threshold. An exhausted budget before primary acquisition is a
censored primary observation, not a demonstrated player loss. This controller
seeks mastery-oriented setups; its primary count is not an ordinary-player win
rate or an overall difficulty estimate. A false quality-censor flag before any
primary acquisition is not evidence of a complete post-primary quality window.

## Reproduction interface

The committed single-run interface is:

```sh
node scripts/odyssey-mastery.mjs online --level 49 --seed 9101 \
  --max-pieces 64 --beam-width 8 --max-nodes 360000 --nodes-per-plan 1200 \
  --unknown-tail-depth 1 --setup-strategy none --timing-policy fixed-cadence \
  --max-decisions 1024 --replans-per-piece 64 --repair-nodes 4096 \
  --reaction-ms 150 --action-ms 100 --max-seconds 1800 --wall-ms 120000 \
  --path-repair reachable-v1 --planning-latency fixed --fixed-planning-ms 200 \
  --output /tmp/odyssey-latency-fixed-repair

node scripts/odyssey-mastery.mjs replay-online \
  --witness /tmp/odyssey-latency-fixed-repair/witness.json \
  --wall-ms 120000 --output /tmp/odyssey-latency-fixed-repair-replay
```

Use a new output directory for every invocation. Select `--path-repair none` for
the paired control. For `--planning-latency uncharged` or `measured-wall`, omit
`--fixed-planning-ms`; that flag is valid only with `fixed`. An ad hoc run is not
part of the registered study. Exact frozen commands and source fingerprints are
recorded in the registration. Reproduction requires that source revision, runtime
and those budgets; changed options create a different experiment.

## Development results

All 30 parents produce valid observed traces, with no runtime errors or missing
assignments. Every parent has a passing exact timestamp replay and is eligible
for the descriptive paired comparison.
There are **24 piece-budget censors, five node-budget censors and one real top-out**;
none acquires primary. False quality-censor flags do not imply a completed quality
window because no primary is acquired. No full mastery is observed, as expected
from this screen's deliberately insufficient piece supply; this says nothing new
about feasibility at an adequate budget.

| Latency | Repair | Parents | Piece censors | Node censors | Top-outs | Full-plan calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Uncharged | None | 6 | 6 | 0 | 0 | 1,293 |
| Uncharged | `reachable-v1` | 6 | 6 | 0 | 0 | 384 |
| Fixed 200 ms | None | 6 | 2 | 4 | 0 | 1,461 |
| Fixed 200 ms | `reachable-v1` | 6 | 5 | 0 | 1 | 377 |
| Measured wall, serial | None | 3 | 2 | 1 | 0 | 891 |
| Measured wall, serial | `reachable-v1` | 3 | 3 | 0 | 0 | 194 |

These are counts over the assigned runs, not equal-duration or equal-trajectory
workloads. All fifteen repair pairs have fewer full-plan calls, but their board
trajectories, elapsed time, stopping points and outcomes can differ. The six
uncharged pairs all reach 64 pieces, with mixed score/depth results. No percentage
speedup, quality improvement or population efficacy is inferred from these counts.

The distinction is concrete at **orb 49 / seed 9101 / fixed 200 ms**. The control
uses 301 full plans, then reaches its node cap after 34 pieces. Repair uses
48 full plans plus 324 repair attempts, then tops out after 46 pieces. Requested
compute delay rises from **60.20 to 74.40 seconds**; actual simulated occupancy
rises from **65.22 to 80.60 seconds**. The fixed model charges an inexpensive
repair call the same artificial 200 ms as a full plan. This is not a uniformly
better outcome, and a censor is not an observed survival or loss beyond its cap.

The serial measured-wall observations remain separate:

| Orb / seed 9101 | Pieces, none → repair | Ending, none → repair | Full-plan calls, none → repair | Actual compute occupancy, none → repair |
| --- | --- | --- | --- | --- |
| 49 | 32 → 64 | Node cap → piece cap | 301 → 65 | 64.97 → 30.32 s |
| 55 | 64 → 64 | Piece cap → piece cap | 302 → 64 | 116.72 → 28.02 s |
| 59 | 64 → 64 | Piece cap → piece cap | 288 → 65 | 62.03 → 32.70 s |

In those three repair-enabled runs, median repair wall durations are
**0.123 / 0.316 / 0.137 ms**, respectively. Across all six measured-wall runs,
per-run full-plan medians range from **173.84 to 367.57 ms**. These are host/load-
specific descriptions of different computations and trajectories, not a pooled
latency estimate or a live-browser performance qualification. Frame quantization
still makes actual simulated waiting larger than tiny measured repair durations.
The complete pair metrics and cost distributions remain in `analysis.json`.

Acceptance and actual target completion differ substantially:

| Repair-enabled latency | Attempts | Accepted results | Stale pose | No path | Completed repaired locks at exact target |
| --- | ---: | ---: | ---: | ---: | ---: |
| Uncharged, six runs | 894 | 894 | 0 | 0 | 299 |
| Fixed 200 ms, six runs | 1,616 | 1,057 | 548 | 11 | 313 |
| Measured wall, three runs | 988 | 606 | 380 | 2 | 190 |

The **802 actual target locks** support the repair mechanism under the recorded
simulator schedules. Several accepted repairs can belong to one piece, and an
accepted path may later be replaced; the accepted-to-lock ratio is not a repair
success probability. Charged-time stale results and failed attempts remain in
the cost totals. These observations do not establish recovery of any particular
older failed tuck or a reliable full mastery construction.

## Integrity and archive status

The freeze records committed source bytes, a full-path/NUL source hash,
runtime, environment, commands, protocol, analyzer dependencies and runner. The
runner verifies those records before execution and flushes and fsyncs an
append-only launch/completion/skip journal. There is no automatic retry or resume.
Interrupted files must be retained; any recovery requires a separate
registration and cohort, without overwriting original observations.

The analyzer retains every assignment and distinguishes runner observations,
CLI completion, source integrity, conservation checks, replay validity, terminal
reason and primary/quality censoring. A launch without a terminal event remains
interrupted with an unknown exit code; a result file cannot supply an invented
exit observation. Synthetic analyzer fixtures are excluded from campaign results.
Registration and frozen analysis code remain immutable after freeze. The
independent auditor was developed and snapshotted before registration or outcome
review; its development history is retained separately. It does not execute the
planner, repair search or game simulation.

Independent raw audit passes with zero errors: **3,564 completed-lock conservation
and scoring checks, 17,388 command checks, 16,196 computation-window checks and
1,604 exact repaired-target checks**. These counts include both parent and replay
records. The unique parent executions contain **1,782 completed locks, 8,098
computation windows and 802 completed repaired target locks**; parent and replay
checks must not be presented as distinct gameplay observations. All thirty
timestamp replay projections match. No interruption or recovery was needed.

The durable record is at
[the latency evidence archive](benchmarks/2026-10-07-latency/README.md).
The assembled ZIP contains **472 members**, is **133,744,966 bytes**, and has
SHA-256 `7c0bd1e968cd3797037876367a209d7a28ded180e215615b6959074827fe7929`.
It is stored as four ordered `evidence.zip.part-01` through `part-04` files because
the complete frozen validation fixtures exceed GitHub's single-file limit. The
external manifest records part and assembled checksums; the README gives exact
reassembly commands. Fresh independent verification at **19:06:41.358949 UTC**
checks all four parts, the assembled ZIP and every member's size and hash. The
frozen analysis reproduces byte for byte. The independent raw audit passes again
and matches every field and input hash except its new top-level `auditedAt` value.

## Next questions

Keep repair opt-in and retain the default uncharged control. The next controlled
mastery study should provide at least 192 pieces, keep exact authored three-star
goals, and compare experimental repair with a retained no-repair condition under
declared charged timing. A sufficient necessary cell budget does not prove a
solution exists; all control censors and full-goal residuals must remain explicit.
The separate terminal-Quad and deep-chain geometry problem still needs a legal
joint witness. This is not a recommendation to enlarge blind search budgets or
adopt a policy based on full-plan counts alone.

If isolating execution changes, use matched observed states, the same retained
target and recorded delay to examine readiness pose, remaining lock delay, safe
fallback and total occupied time. A future time-aware repair must revalidate
reachability; the current spatial search does not prove that its target survives
the wait. Browser scheduling and responsiveness require direct measurement in
their actual execution context. Continue the separate
[formative player protocol](ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
using the [blank template](benchmarks/2026-10-07-targeted/player-playtest-template.csv).
For orb 49, test whether the earlier-Quad plus finishing-chain plan is understandable
and satisfying, and whether the fast-lock score bonus makes players feel pushed
to wait before automatic finish. That is a rules-based design question, not a
finding of dissatisfaction or unfairness. No authored retune is justified by this
execution screen alone.
