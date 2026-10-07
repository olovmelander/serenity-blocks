# Odyssey longer mastery development evidence — 2026-10-07

This record supports the [longer mastery study](../../ODYSSEY_LONG_MASTERY_2026-10.md).
The registration freezes twelve serial online parents and twelve independent
timestamp replays on development seeds 9101/9102 for orbs 49/55/59. Each parent
uses measured-wall planning latency and either `none` or experimental
`reachable-v1` repair. The 192-piece ceiling exceeds the necessary inventory
minima of 130/155/140 pieces; it does not establish a legal or timely construction.
No authored goals, production rules or defaults change.

The design checkpoint is `509f1e7a5a50e60bf9dc33e6f059194098ef25ee`.
Registration froze at **2026-10-07 19:23:33.640 UTC** with SHA-256
`e0c4f5bc737a29033b2064b3a4ebb08fc299a4481a32a77faa8d78b7eb441def`.
The source hash is
`8f901fade30cb15ef16e73567ba69dd8928240220c40305f985cb8bd2a99ebda`,
unchanged from the preceding latency study. Execution uses Node `v24.19.0`,
Linux x64. Parents run serially in balanced policy order; replays follow with at
most three workers. Measured costs retain their host/load context.

All **24 assigned invocations complete with observed exit code zero** and all
**twelve independent timestamp replays pass**. The parents produce one one-star
primary win, four top-outs, four missed acquisition deadlines and three budget
censors (two piece limits, one wall limit). No full three-star witness qualifies.
No showcase primary is acquired. The sole win is orb 49 / seed 9102 / repair.
Orb 49 / seed 9101 / repair remains a top-out with no primary acquisition despite
its final score of 36,033 and raw one-star field; the terminal lock's 44 bonus
points do not override the recorded loss.

Independent raw audit passes with zero errors: **3,460 completed-lock conservation/
scoring checks, 17,736 command checks, 18,266 computation-window checks and 1,776
repaired-target checks**, counting parents and replays. The unique repair parents
contain **888 completed exact-target locks**. All six descriptive pairs have fewer
full planning calls and lower simulated compute occupancy with repair, but
different trajectories and stop reasons prevent an overall speedup or gameplay
claim. Full per-goal residuals and all censors remain in `analysis.json`.

All 98 focused tests pass again. The prior 8,386-test full-suite pass is inherited
validation on unchanged source, not a new full-suite run. The archive also retains
a separate portable arithmetic review of selected prior structural traces; these
retrospective inputs are not additional observations in the new cohort.

The durable [evidence ZIP](evidence.zip) contains **243 members** and is
**15,074,281 bytes**, with SHA-256:

```text
b60f6010a5db0059f378d5d3a1bd20b25bf4cb0accb092059483f6cdc0a318cd
```

The external [manifest](manifest.json) records the archive checksum, every
member's size/hash and final independent verification at
**2026-10-07 19:54:47.058632 UTC**. Fresh extraction verifies the archive and all
243 members. The frozen analysis and separate construction diagnostic reproduce
byte for byte; the independent raw audit matches every field and input hash except
the newly generated top-level `auditedAt` timestamp. The archive retains final
terminal-boundary and construction audit reports, including fourteen prior input
files matched to their original archive and 920 prior-lock arithmetic checks.
Those retrospective checks are separate from the new twelve-parent cohort.
Raw working evidence is under `artifacts/odyssey-long-mastery-2026-10-07/`.

This study remains development evidence. All failures, censors and per-goal
residuals must remain visible; a primary win is distinct from full three-star
mastery, and an exact replay is distinct from satisfying either goal. No human
sessions or fresh-seed confirmation are included. The existing
[formative protocol](../../ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol)
and [blank player template](../2026-10-07-targeted/player-playtest-template.csv)
remain separate from synthetic results.

## Reproduction

Use the [study's CLI example](../../ODYSSEY_LONG_MASTERY_2026-10.md#reproduction-interface)
for a new measured-wall run on the frozen source. Re-measured durations can change
its trajectory. Exact timestamp replay instead consumes the saved schedule.
Neither an ad hoc rerun nor a changed budget joins the registered cohort.

From the repository root, extract into a new directory and regenerate outputs
without replacing the archived originals:

```sh
sha256sum docs/benchmarks/2026-10-07-long/evidence.zip
python3 -m zipfile -e docs/benchmarks/2026-10-07-long/evidence.zip /tmp/odyssey-long-evidence
python3 /tmp/odyssey-long-evidence/analyze.py --self-test
python3 /tmp/odyssey-long-evidence/analyze.py --output /tmp/odyssey-long-analysis.regenerated.json
python3 /tmp/odyssey-long-evidence/independent-audit/audit.py --self-test
python3 /tmp/odyssey-long-evidence/independent-audit/audit.py --output /tmp/odyssey-long-audit.regenerated.json
python3 /tmp/odyssey-long-evidence/construction-review/residual-bounds.py > /tmp/odyssey-long-construction.regenerated.json
cmp /tmp/odyssey-long-evidence/analysis.json /tmp/odyssey-long-analysis.regenerated.json
cmp /tmp/odyssey-long-evidence/construction-review/residual-bounds.json /tmp/odyssey-long-construction.regenerated.json
python3 - <<'PY'
import json
from pathlib import Path
original = json.loads(Path('/tmp/odyssey-long-evidence/independent-audit/result-audit.json').read_text())
regenerated = json.loads(Path('/tmp/odyssey-long-audit.regenerated.json').read_text())
original.pop('auditedAt')
regenerated.pop('auditedAt')
assert original == regenerated
print('Independent audit matches except auditedAt.')
PY
```

Use fresh output paths. Python's standard library and Node are required; Node is
used only for JavaScript JSON serialization in the independent replay hash check.
These analysis commands do not require the live repository, its dependencies or
new gameplay. The frozen analysis and construction diagnostic are deterministic
for their archived inputs. The raw audit regenerates only its top-level
`auditedAt` timestamp.
