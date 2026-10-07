# Odyssey longer mastery study — 2026-10-07

## Scope and protocol checkpoint

This development protocol follows the [64-piece planning-latency screen](ODYSSEY_PLANNING_LATENCY_2026-10.md).
It extends the existing online policy to a 192-piece ceiling while charging
measured planning time to the game clock. Experimental `reachable-v1` path repair
is compared with the retained `none` control on orbs 49, 55 and 59. The question
is whether these bounded policies demonstrate the exact joint three-star goals,
and where they stop short when given enough nominal piece supply to clear the
known necessary inventory bounds.

This checkpoint declares the design before its source/protocol registration and
execution. It contains no new study outcomes. The committed implementation from
`a5068da` is retained without a new solver, production-rule change, authored
retune or default-policy adoption. Source, runtime, commands, reporting code and
assignment order will be frozen before execution; their exact fingerprints belong
in the final study record and durable evidence archive.

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

Parents run **serially**, with repair order balanced across the six orb/seed pairs
and the exact order declared in registration. Host, load and process observations
accompany execution. No concurrent tests or other benchmark work are scheduled
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

## Construction and player questions

The orb-49 final chain must follow its earlier Quad prefix without ordinary finish
firing too soon. The [224-cell terminal bound](ODYSSEY_ONLINE_MASTERY_2026-10.md#a-tighter-orb-49-inventory-bound)
excludes five Quads inside an eight-wave chain; eight earlier Quads plus four
terminal Quads is one arithmetic route, not a constructed witness.
For 55/59, depth and sequence counts require different work: a deep single chain
does not supply the many separate cascade sequences. Increasing only a generic
search ceiling does not resolve either legal construction problem.

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
pushed to wait. At 55/59, distinguish reaching the primary in time from choosing
to continue the showcase. These are questions for real playtests; no participant
sessions, opinions, recruitment or human calibration are supplied by this study.

Any next policy or balance intervention should follow the remaining demonstrated
gap, with changed targets, methods and budgets declared before new outcomes are
examined. A legal full witness would establish one construction under its recorded
conditions. It would still leave learnability, satisfying challenge and the
progression curve to the separate player evidence.
