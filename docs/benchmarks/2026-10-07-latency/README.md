# Odyssey planning-latency evidence — 2026-10-07

This record supports the [planning-latency study](../../ODYSSEY_PLANNING_LATENCY_2026-10.md).
Implementation `a5068da1fe578c7ec5d0af6f6edd2dcf2efc5a01` is committed and pushed.
Source and protocol registration froze at **2026-10-07 18:49:45.523 UTC** before
campaign outcomes. **All 60 assigned invocations complete with observed exit code
zero, and all 30 independent timestamp replays pass.** The frozen analysis and
independent raw audit are complete. The full evidence archive is stored in four
ordered parts; fresh independent reassembly/extraction verification passes.

## Scope and registered coverage

This is an early execution screen of opt-in `reachable-v1` path repair and
`uncharged`, `fixed` and `measured-wall` planning latency. Defaults remain repair
`none` and latency `uncharged`; no authored rules or targets change. All parents
use the actual starting boards for orbs 49, 55 and 59, with three visible previews
and setup strategy `none`. Previously explored development seeds 9101 and 9102
are used; seeds starting at 11001 remain reserved.

| Phase | Parents | Independent timestamp replays | Execution |
| --- | ---: | ---: | --- |
| Uncharged / fixed 200 ms | 24: three orbs × two seeds × two repair policies × two latency modes. | 24 | At most three workers. |
| Measured wall | Six: three orbs × seed 9101 × two repair policies. | Six | Parents run serially after the deterministic phase, with no concurrent tests or other benchmark work. |

Each parent is limited to 64 pieces, beam eight, 1,200 nodes per full plan,
4,096 nodes per repair, 360,000 total plan-plus-repair nodes, 1,024 decisions,
64 replans per piece and one unknown-tail step. Reaction/action intervals are
150/100 ms. Simulation and wall ceilings are 1,800 seconds and 120,000 ms;
replays also have a 120,000 ms wall limit. Repair and beam nodes represent
different work units, so their counts cannot establish per-node efficiency.
Measured-wall ordering alternates the first policy across orbs and retains
before/after runtime, CPU, load and process inventories.

The **64-piece cap is below the necessary full three-star minima of 130 / 155 /
140 pieces** for orbs 49 / 55 / 59. This screen cannot test joint-mastery
feasibility. Primary acquisition, trace validity, complete execution and mastery
remain distinct. Budget exhaustion is a censor, not a measured player loss.
This mastery-oriented policy's primary count is not an ordinary-player win rate.
There are no human sessions, enjoyment findings or balance-retuning claims.

## Timing and repair interpretation

Fixed latency requests 200 ms on every full-plan or repair call, including failed
attempts. Measured-wall charges the recorded call duration and stays separate
from fixed-delay comparisons. Positive charge releases on the first input frame
after ordinary legacy-loop logic reaches readiness; gravity, locks and deadlines
continue and take priority. A nominal 200 ms call can occupy about 216.67 simulated
milliseconds because of frame quantization. `planningChargedMs` is nominal
requested time, including interrupted computations; `planningElapsedMs` is actual
occupied simulation time. These quantities can differ in either direction.
This uses normal virtual 60 Hz stepping, not canonical `fixed60-v1` timing.

Repair searches the current observed board and piece for an exact retained
placement using production movement and collision rules. Spatial reachability
does not guarantee timed execution or preserve time-dependent scoring history.
`repairSuccesses` counts computational results accepted by the controller;
fully consumed paths that actually lock at their retained target are audited
separately. Stale, failed and interrupted computations keep their recorded cost.
A changed trajectory does not prove rescue of a particular older failed tuck.

Independent v2 replay uses the recorded computation schedule and input timestamps
without invoking or remeasuring planning; v1 witness compatibility remains.
Valid simulator execution does not establish browser scheduling, main-thread
responsiveness, human input skill or fair and satisfying play. Serialized
measured-wall runs reduce campaign contention without proving an idle host.

## Source and validation

- Source commit: `a5068da1fe578c7ec5d0af6f6edd2dcf2efc5a01`.
- Freeze: `2026-10-07T18:49:45.523Z`.
- Registration SHA-256: `812dc8278b3c9d3dceae031ddcbb3539e8e1f46b4702282815867ede43d11e7e`.
- Source SHA-256: `8f901fade30cb15ef16e73567ba69dd8928240220c40305f985cb8bd2a99ebda`, covering 1,189 files.
- Analyzer SHA-256: `60b2f0530777cddd20a2df9506fa03c7375c3c2e541f2548e028954678d69d7c`.
- Runtime: Node `v24.19.0`, Linux x64, AMD EPYC 9V74 host; five logical CPUs,
  four reported available for parallelism. Retain the declared worker context.
- Validation: 98 focused tests pass, scoped lint is clean, and all non-test
  project gates pass. The full suite passes **8,386 tests across 650 files**
  in 107.45 seconds. A retained real v1 witness separately passes replay.

The frozen runner fsyncs each launch, completion and skip event. There is no
automatic retry or resume; any interruption remains in the denominator and
requires a separately registered recovery rather than replacing original files.
CLI completion alone does not establish a valid witness. The frozen analyzer
checks source/config/result/input integrity and retains runner status, source
validity, trace conservation, replay validity, termination and censoring separately.

The independent auditor was prepared and snapshotted before registration and
outcome review. Its development history and synthetic integrity fixtures are
retained separately from campaign observations. It does not execute the planner,
repair search or game simulation; its authored-board oracle is accepted only
when every production source fingerprint still matches. It checks recorded
costs, schedules, repair targets, completed-lock inventory/scoring, and the
independent timestamp replay projection.

## Development results

All 30 parent traces are valid, with no runtime errors, missing assignments,
interruptions or recovery. They produce **24 piece-budget censors, five node-budget
censors and one real top-out**, with no primary acquisition. False quality-censor
flags do not establish post-primary observation because primary is never acquired.
No full mastery is observed; the deliberately insufficient 64-piece supply makes
that an expected scope limit, not a feasibility finding.

| Latency / repair | Parents | Piece censors | Node censors | Top-outs | Full-plan calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Uncharged / none | 6 | 6 | 0 | 0 | 1,293 |
| Uncharged / repair | 6 | 6 | 0 | 0 | 384 |
| Fixed 200 ms / none | 6 | 2 | 4 | 0 | 1,461 |
| Fixed 200 ms / repair | 6 | 5 | 0 | 1 | 377 |
| Serial measured wall / none | 3 | 2 | 1 | 0 | 891 |
| Serial measured wall / repair | 3 | 3 | 0 | 0 | 194 |

Every one of the fifteen descriptive repair pairs uses fewer full-plan calls.
Different trajectories, durations and stopping points prevent treating this as
a general percentage speedup or quality improvement. At fixed orb 49 / seed 9101,
the control stops at its node cap after 34 pieces; repair tops out after 46.
Full plans fall from 301 to 48, but 324 repair calls increase actual compute
occupancy from **65.22 to 80.60 seconds**. Fixed latency is a sensitivity scenario
that charges each inexpensive repair the same 200 ms as a full plan.

Serial measured-wall observations stay separate. Orb 49's control reaches its
node cap at 32 pieces, while repair reaches the 64-piece cap. Both policies reach
64 pieces at 55 and 59. Actual compute occupancy, none → repair, is
**64.97 → 30.32 s / 116.72 → 28.02 s / 62.03 → 32.70 s** for 49/55/59.
These are host-specific observations with different exposure and trajectories;
they do not establish policy efficacy or live browser performance.

The unique parents contain **802 completed repaired locks at the exact retained
target**: 299 uncharged, 313 fixed and 190 measured-wall. Accepted computational
results total 894 / 1,057 / 606 in those arms; they are not completed-path counts.
Fixed and measured-wall arms also retain 548 / 380 stale-pose repairs and 11 / 2
no-path results. Multiple accepted repairs can belong to one piece. All failed
and stale attempts remain in the costs; the ratio is not a success probability.

Independent raw audit passes with zero errors and **3,564 lock conservation/scoring
checks, 17,388 command checks, 16,196 compute-window checks and 1,604 exact repaired-
target checks**, counting both parents and replays. Unique parent executions
contain 1,782 locks, 8,098 computation windows and 802 repaired target locks.
All thirty independent timestamp replay projections match. These doubled check
totals must not be presented as distinct gameplay observations. The frozen analysis
retains every repair and latency pair with complete metrics and cost distributions.

No default-policy adoption or authored retune is selected. A controlled study
with adequate piece supply, exact full goals, charged timing and retained repair/
no-repair conditions is a possible next step; a complete legal geometry witness
and separate human calibration remain necessary.

## Archive and verification

The assembled ZIP contains **472 members** and is **133,744,966 bytes**. Its SHA-256
is:

```text
7c0bd1e968cd3797037876367a209d7a28ded180e215615b6959074827fe7929
```

The complete frozen validation fixtures make this larger than GitHub's single-file
limit, so every input is retained in four ordered binary parts:

| Part | Bytes |
| --- | ---: |
| [evidence.zip.part-01](evidence.zip.part-01) | 41,943,040 |
| [evidence.zip.part-02](evidence.zip.part-02) | 41,943,040 |
| [evidence.zip.part-03](evidence.zip.part-03) | 41,943,040 |
| [evidence.zip.part-04](evidence.zip.part-04) | 7,915,846 |

The external [manifest](manifest.json) contains every part's size and SHA-256,
the assembled ZIP checksum and all member hashes. There is no tracked standalone
`evidence.zip`; concatenate parts in their listed order. Fresh independent
verification at **2026-10-07 19:06:41.358949 UTC** checks all four part sizes/hashes,
the assembled ZIP checksum and all 472 members' sizes/hashes. The frozen analysis
reproduces byte for byte. The independent raw audit passes again, matching all
fields and input hashes except the newly generated top-level `auditedAt` timestamp.
The manifest records these exact verification facts.

The ZIP contains registration, source and validation snapshots, raw
configs/results/traces, durable events and host observations, frozen analyzers,
independent audit inputs, validation logs and the separate v1 compatibility check.

## Reproduction

Use the committed CLI examples in the
[study](../../ODYSSEY_PLANNING_LATENCY_2026-10.md#reproduction-interface).
Exact registered commands, runtime, source and budgets are authoritative;
modified commands or repeated development seeds are not fresh confirmation.

From the repository root, reassemble the parts and compare the printed SHA-256
with the value above. A fresh extraction can reproduce the analysis and
independent audit without overwriting archived outputs:

```sh
cat docs/benchmarks/2026-10-07-latency/evidence.zip.part-* > /tmp/odyssey-latency-evidence.zip
sha256sum /tmp/odyssey-latency-evidence.zip
python3 -m zipfile -e /tmp/odyssey-latency-evidence.zip /tmp/odyssey-latency-evidence
python3 /tmp/odyssey-latency-evidence/analyze.py --self-test
python3 /tmp/odyssey-latency-evidence/analyze.py --output /tmp/odyssey-latency-analysis.regenerated.json
python3 /tmp/odyssey-latency-evidence/independent-audit/audit.py --self-test
python3 /tmp/odyssey-latency-evidence/independent-audit/audit.py --output /tmp/odyssey-latency-audit.regenerated.json
```

Use fresh output paths. Python's standard library and Node are required; Node
is used only for JavaScript JSON serialization in the independent replay hash
check. These analysis commands do not need the live repository, its dependencies
or new gameplay. The frozen analysis is deterministic for these archived inputs;
the raw audit regenerates its `auditedAt` timestamp on each run.

For future human sessions, retain the separate
[blank template](../2026-10-07-targeted/player-playtest-template.csv) and
[formative protocol](../../ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol).
