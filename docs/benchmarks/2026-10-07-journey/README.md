# Odyssey journey diagnostics — 2026-10-07

This archive preserves the follow-up to the [journey difficulty review](../../ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md).
It contains **344 registered attempts**: 120 orb-6 baseline, 120 corrected, eighty
chapter-6 rhythm observations and twenty-four production-opponent duel observations.
These are diagnostics and preservation checks, not a human difficulty calibration or
a statistical tuning confirmation.

`evidence.zip` retains the original `artifacts/odyssey-journey-audit-2026-10-07/` paths.
`manifest.json` records the archive hash, every member's size/hash, exact run revisions
and validation. The bundle includes the registration, raw measurements, configs,
capabilities, interactive HTML reports, standalone analysis, environment record,
validation record and source patch. Benchmark logs and full test output are retained;
redundant generated summaries and duplicate analysis output are omitted.

## Findings

- Orb 6's custom 800 ms opening previously reverted to 120 ms after fifteen lines.
  Proportional progression now gives approximately 635.76 ms while preserving score
  level advancement, the twenty-line goal, stars and other orbs. Matched results are
  109→110 wins out of 120, no lost baseline wins and identical stars in all 109 pairs
  that won in both conditions. The sole gain is Quad/steady seed 7005.
- Chapter-6 orbs 43/45/46/47 finish 16/17/20/18 of twenty attempts. Recovery wins are
  shorter, but recovery is not automatic for this strategy. No tuning was selected
  from this descriptive cohort.
- With the shipped opponent's full queue, cascade/steady wins three of three at each
  tier 1–6, one of three at tier 7, and zero of three at tier 8. The player policy
  retains three previews. Three seeds per tier demonstrate examples, not calibrated
  difficulty or a reason to change tiers or seven-frag matches.
- All 344 attempts are terminal, with no runtime errors or primary/quality censors.
  Do not pool different profiles, cadences, levels, old restricted-opponent evidence
  or these diagnostic seeds into a confirmatory human or gameplay win rate.

## Reproduce the analysis

From the repository root, extract into a fresh directory (no npm install required):

```bash
python -m zipfile -e docs/benchmarks/2026-10-07-journey/evidence.zip /tmp/odyssey-journey-evidence
python /tmp/odyssey-journey-evidence/artifacts/odyssey-journey-audit-2026-10-07/analyze.py
```

`analyze.py` verifies the expected unique keys and matched conditions before producing
`analysis.json`. It uses standard-library Python. Its p90 values use the nearest-rank
method; the general benchmark HTML report uses interpolated quantiles. Open the four
extracted `report.html` files directly in a browser.

For gameplay replay, use a separate checkout of main commit
`ca3884e70a868f1ff346ec0ca851476fb53481ef`. The before run uses that source unchanged.
Apply the archived `source.patch` for the corrected source (originally committed as
`23a7abb3b7aa78b1995ec59686dadf4b3b2b8b49`). Use Node 24.19.0 on Linux x64 and each
recorded config's policies, cadences, seeds and budgets, with a fresh output directory.
The patch includes regression tests and the opponent/report correction as well as
orb-6 initialization. The exact source hashes are recorded in every config; replaying
under a different Git HEAD cannot resume an existing checkpoint even if source bytes
match. A new run does not constitute independent confirmation of the same seeds.

The prior Windows evidence remains in `../2026-10-07/`; its application, harness,
runtime and duel knowledge policy are different. Historical orb-59 comparisons must
use that archive's frozen source, not the current 210-second baseline.

## Verify integrity

```bash
python - <<'PY'
from pathlib import Path
from hashlib import sha256
import json, zipfile
base = Path('docs/benchmarks/2026-10-07-journey')
manifest = json.loads((base / 'manifest.json').read_text())
archive = base / 'evidence.zip'
assert sha256(archive.read_bytes()).hexdigest() == manifest['archive']['sha256']
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert set(bundle.namelist()) == {member['path'] for member in manifest['members']}
    for member in manifest['members']:
        data = bundle.read(member['path'])
        assert len(data) == member['bytes']
        assert sha256(data).hexdigest() == member['sha256']
print('Archive and all member hashes verified')
PY
```
