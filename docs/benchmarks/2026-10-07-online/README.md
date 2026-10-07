# Odyssey online mastery evidence — 2026-10-07

This record supports the [online mastery study](../../ODYSSEY_ONLINE_MASTERY_2026-10.md)
and [current handover](../../ODYSSEY_BALANCE_HANDOVER_2026-10.md). The implementation
is committed as `96b2364b6b7de8b1695ea6e9f73fdeba844dede6`. Source/analysis
registration froze at **2026-10-07 17:26:32.105 UTC**. The frozen analyses and
separate recovery coverage are complete; no full mastery witness qualifies.
Independent raw audit and fresh-extraction verification pass. The complete archive
and its checksum are recorded below.

## Scope and interpretation

The new offline tooling combines two separately measured capabilities:

- Opt-in `structural-v1` search targets setup geometry under untimed construction,
  followed by independent untimed replay.
- Online control replans against the current falling piece under normal gravity
  and fixed command cadence, followed by independent recorded-timestamp replay.
  These runs use setup strategy `none`.

Authored goals, scoring, gravity, opponents and finish rules are unchanged. Exact
three-star conditions remain separate from optional bonus completion. A geometry
preference, a valid partial trace, primary victory and full mastery are distinct
outcomes. All assigned tasks must remain in the accounting, including runtime
errors, invalid traces, interruptions, top-outs and resource limits.

**Planner CPU and wall time are not charged to the virtual gameplay clock.**
Gravity-aware simulated execution therefore leaves real-time computational
feasibility unqualified. Timestamp replay checks the declared simulation and
recorded inputs; it cannot establish that planning fits the measured input interval.
Development seeds 9101–9103 were previously inspected. Seeds starting at 11001 are
reserved; this is not fresh confirmation, a retuning gate or human calibration.
No player sessions or conclusions about enjoyment are represented as measured data.

## Context carried forward

The retrospective failure audit examines the previous frozen campaign without
running new gameplay. All thirteen old interrupted paths begin the failed piece
on the expected board with matching previews. Seven automatic locks follow
redundant grounded soft drops; five horizontal moves and one rotation are rejected
after gravity moves the piece below its expected pose. Five complete partial
controls also remain below primary. These are fixed-script execution limits,
not measured player losses.

A tighter necessary orb-49 bound uses the fully drained board: twenty visible
rows can contain at most nine cells each, plus at most forty cells in hidden rows
and four in the triggering tetromino. Its final cascade has at most **224 cells**.
Five Quads in an eight-wave chain would require 230 cells, excluding the old
seven-prior/five-final allocation. The minimum full three-star inventory is now
**130 pieces**; the eight-prior/four-final allocation is still only arithmetic,
not a constructed solution. The earlier immutable archive retains its looser bound.

The old v2 driver also passed a seed field through its planner options. The planner
did not read it, and no hidden-bag use was observed, but the claim that the planner
never received a seed was stronger than that interface enforced. The new v3 drivers
use explicit budget-only option allowlists and getter-trap tests. This boundary
hardening is disclosed without rewriting the old archive.

## Declared coverage and source

| Cohort | Invocations | Declared limits |
| --- | ---: | --- |
| Structural search | 9 | Orbs 49/55/59 × seeds 9101–9103; 192 pieces, beam eight, 240,000 total nodes, adaptive 2,400-node per-plan ceiling, unknown tail one, 240-second wall budget. |
| Untimed replay | 9 | Every retained structural trace, including partial or unsuccessful traces. |
| Online control | 18 | The same orb/seed matrix at 150/100 and 300/180 ms reaction/action intervals; setup `none`, 192 pieces, beam eight, 720,000 total nodes, 1,200 per plan, 2,048 decisions, 64 replans per piece, unknown tail one, 240 wall seconds and 1,800 simulation seconds. |
| Timestamp replay | 18 | Every online witness without invoking planning; 120-second wall budget. |

The original planned total is **54 invocations**. Hard-drop fallbacks at the per-piece
replan cap or when no plan is available are recorded; abandoned decisions count
against their budgets. Comparisons to old fixed scripts span different source
revisions and are descriptive, not an efficacy estimate. A different online
trajectory is not proof of recovering a specific old target placement.

The online policy clears stale plans after automatic locks and can adapt after
rejected inputs. It requests the live Finish action only after primary and actual
three-star conditions are observed; acquisition deadlines do not end already won
showcases. Global resource limits censor remaining objectives or quality. Timestamp
replay verifies accepted/rejected inputs, automatic locks, stop phase and final
metrics without choosing new actions. Small injected development probes remain
separate from the 54 registered invocations.

The runner session later vanished with no benchmark processes remaining; the exact
exit reason is unknown. Twenty-three parent outputs had completed summaries;
the preserved outer `run.log` confirms observed exit code zero for all 23, correcting
the initial reconstructed journal's missing-exit assessment. Only the three
interrupted exits remain unknown. Partial files remain preserved, and the three dependent original
timestamp replays are explicitly skipped rather than called completed.

Separate recovery registration `211338caf9e5c3efdd2d0bcb5013fb37539cf32fd6504dedb5134a2bc2b0e129`
froze at **2026-10-07 18:15:38.964069 UTC**. It assigns three retry parents and
three timestamp replays: orb 55 / seed 9103 at both cadences and orb 59 / seed 9103
at 150/100 ms. Source, runtime, seeds and limits are unchanged. These six tasks
live under `recovery/`, do not overwrite original partials and are not a fresh
confirmation. Original and recovery accounting remain separate: the original 54
contain 48 completed, three incomplete and three not-executed tasks; all six recovery
tasks complete. The original 54 cannot be described as all completed.

All fifteen original partial files match their preserved hashes. Retry progress
matches 130/130, 76/76 and 28/28 original records, including metrics, simulated time,
nodes, decisions and counters; wall/CPU timings are excluded. No retry result is
substituted into an original interrupted row. The main frozen analyzer is unchanged.

The online policy seeks mastery setups and can behave differently from earlier
primary-goal profiles. Its primary-win count is not an ordinary-player success
rate or an overall game-difficulty calibration.

- Implementation: `96b2364b6b7de8b1695ea6e9f73fdeba844dede6`.
- Source/analysis freeze: `2026-10-07T17:26:32.105Z`, before outcomes.
- Source fingerprint: `bbb09217bd3cabab39750d9ec3052b4a1c42d2042486b02c96bc1f8c2f754501`, covering 1,188 files.
- Analyzer fingerprint: `dbe79c2bb5af3903c1b75feb6a407ddce09afea4c0d84664cf08f21eba24b24d`.
- Runtime: Node `v24.19.0`, Linux x64, three workers; the recorded environment
  exposes five CPUs on an AMD EPYC 9V74 host. Preserve this planner-timing context.
- Validation: 74 focused tests pass; scoped lint is clean and all non-test project
  gates pass. The full suite passes **8,362 tests across 649 files** in 107.44 seconds.
- Campaign results: separate original/recovery analyses and independent raw audit
  complete; final archive independently verified.

## Development results

Coverage contains **27 completed parent/replay pairs: 24 original and three
recovery pairs**, with all 27 replays passing their relevant evidence checks.
This mapping covers the assigned cases without pooling the two registrations.

Independent raw audit passes with zero errors, **7,928 completed-lock conservation/
scoring checks and 34,514 command checks**. All nine untimed and eighteen timestamp
replay projections match exactly. The raw auditor was developed during execution
and recovery and discloses its timing; it is separate from the unchanged frozen
analyzer. Both frozen analyses and the coverage output reproduce byte for byte
after relocation.

| Completed online observations | Primary wins | Real top-outs | Node-budget censors | Piece-budget censors | Full mastery |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original, 15 | 3 | 2 | 5 | 5 | 0 |
| Recovery, 3 | 0 | 0 | 1 | 2 | 0 |

The eighteen covered assignments yield three one-star primary wins, all at orb 49,
two top-outs and thirteen budget censors. No full three-star witness qualifies.
These mastery-seeking policy outcomes do not estimate ordinary-player performance.

| Structural search | Seeds 9101 / 9102 / 9103 | Ending |
| --- | --- | --- |
| Orb 49 | Quads 6 / 7 / 8; maximum depths 2 / 0 / 0. | All top out. |
| Orb 55 | Maximum depths 6 / 5 / 5; one cascade sequence each. | All exhaust 192 pieces below primary. |
| Orb 59 | Maximum depths 5 / 0 / 0. | All top out. |

The eight-Quad observation is **eight Quads before top-out**, not a surviving
terminal setup, a reachable finishing chain or overall mastery improvement.
All nine structural traces pass independent untimed replay checks, but none reaches
primary or full mastery. Keep structural-v1 experimental.

Across the covered online runs, per-run median decision wall costs range from
159.92 to 441.85 ms and CPU medians from 166.32 to 504.44 ms, with 78–460 gravity
replans per run. These are ranges of per-run summaries, not pooled latency estimates.
Planning remains uncharged to gameplay time. A separate path-repair and charged-
latency experiment is a possible next step; the intended old placement may no
longer be reachable. No real-time or human-feasibility claim is established.

The ZIP includes the immutable registration/analyzer, raw configs and
results, traces and timing telemetry, source snapshot and patch, validation logs,
development variants and retrospective failure audit. The external manifest
records the ZIP and member sizes/hashes.

## Reproduction and archive status

The [evidence ZIP](evidence.zip) contains **488 members**, is **15,517,132 bytes**,
and has SHA-256:

```text
85acc2015a13b692043808d9036f434402763e37c5441f98a02a8af59c6d8cc3
```

Fresh independent extraction verifies every member's bytes and hash. The original
and recovery frozen analyses plus `combined-coverage.json` regenerate byte for byte.
The raw audit passes again and matches every field and input hash except the new
top-level `auditedAt` timestamp, which is explicitly excluded from that comparison.
The external [manifest](manifest.json) records these exact verification facts.

Use the committed CLI examples in the
[online study](../../ODYSSEY_ONLINE_MASTERY_2026-10.md#reproduction-and-reporting)
for interface details. Final gameplay reproduction must use the frozen source,
runtime, commands and budgets in `registration.json`, with fresh output directories.
Changing source or limits creates a different experiment, and repeating these
development seeds does not make a confirmation sample.

The standard-library analyzer verifies the archived inputs and reports validity,
trace completion, primary outcomes and mastery separately. From a fresh extraction:

```sh
python3 -m zipfile -e docs/benchmarks/2026-10-07-online/evidence.zip /tmp/odyssey-online-evidence
python3 /tmp/odyssey-online-evidence/analyze.py --self-test
python3 /tmp/odyssey-online-evidence/analyze.py
python3 /tmp/odyssey-online-evidence/recovery/analyze.py
python3 /tmp/odyssey-online-evidence/coverage.py
python3 /tmp/odyssey-online-evidence/audit-results.py --repository "$PWD"
```

Run these commands from the repository root with the recorded Node runtime and
installed dependencies. The raw auditor uses verified frozen source to initialize
authored boards and can use that checkout's `node_modules`; it records a new
`auditedAt` timestamp on each run. The frozen analyses and coverage are deterministic
for the archived inputs.

For real player sessions, use the existing
[blank template](../2026-10-07-targeted/player-playtest-template.csv) with the
[formative protocol](../../ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol).
Keep human learning and motivation findings separate from synthetic execution.
