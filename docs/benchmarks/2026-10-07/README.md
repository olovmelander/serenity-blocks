# Odyssey benchmark evidence: 2026-10-07

[evidence.zip](evidence.zip) preserves the selected artifacts with their original
`artifacts/...` paths. [manifest.json](manifest.json) records each member's size,
SHA-256, provenance, run revision and archive validation.

The archive contains **72 files and 1,506 attempts**, occupies **1,231,709 bytes
(1.232 MB)**, and has SHA-256:

`2341863246e24b6039df6066f3dc06258e204cea1ec4f34bc81ee86dc5281563`

ZIP CRC integrity and all 72 member hashes passed. The 69 original files match their
source bytes exactly; three environment descriptors are derived and labeled below.
An isolated extraction reproduced the independent math, 440-record screen and
400-record holdout analyses without an npm install.

| Run | Attempts | Wins | Losses | Quality-limited flags |
| --- | ---: | ---: | ---: | ---: |
| Initial campaign | 531 | 490 | 41 | 15 |
| Focused screen | 440 | 380 | 60 | 2 |
| Cadence screen | 105 | 72 | 33 | 0 |
| Quad screen | 20 | 20 | 0 | 0 |
| Orb 59 holdout | 400 | 183 | 217 | 0 |
| Production reproduction | 10 | 7 | 3 | 0 |

Each run includes raw JSONL, config, capabilities, environment information and the
self-contained HTML report. The bundle also retains the independent preregistration
and reviews, final frozen-source snapshot, holdout fidelity/scope records, pre-adoption
configs, desktop/mobile PNGs and UI JSON. Production verification records **ten exact
semantic matches and 123 passing tests**, excluding only scenarioId, attemptId and
wallMs from the semantic comparison.

## Decision and limits

The fresh holdout supports **Orb 59's 210-second primary acquisition deadline only**:
Cascade wins rose from 9 to 59/100; Expert from 27 to 88/100, with no lost baseline
wins. All 50 primary improvements converted baseline deadline losses, acquiring the
goal after 180 and by 210 seconds. The registered fixed-three-family Holm test passes.
The 240-second variant, Orb 51 gravity changes and Orb 4 pacing changes remain excluded.

Higher-star fairness stays inconclusive: these policies do not validate the authored
combo 10/12 and cascade-depth 7 construction requirements. Keep all star/bonus thresholds.
The benchmark quality cutoff differs from the live manually finishable showcase; the
primary evidence does not justify adding an automatic showcase cutoff. Do not pool
cadences, policies, the older initial campaign or confirmation seeds. Synthetic results
do not estimate human completion probability or enjoyment.

Historical measurement used application hash
`259ef02511db27892ca3812be676b45518b261d5cbc910b8daad4369b930f407`.
The separately adopted application hash is
`c71cd90b4900de20d5dd52b906f06c68c39e28ba13cdf3fb1417c8825d0512ed`.

## Analyze after a fresh clone

Run from the repository root in PowerShell:

```powershell
Expand-Archive -LiteralPath 'docs/benchmarks/2026-10-07/evidence.zip' -DestinationPath '.'
node artifacts/odyssey-benchmark-nextpass-preregistration-2026-10-07/analyze.mjs verify-math
node artifacts/odyssey-benchmark-nextpass-preregistration-2026-10-07/analyze.mjs screen artifacts/odyssey-benchmark-focused-screen-2026-10-07 --completed
node artifacts/odyssey-benchmark-nextpass-preregistration-2026-10-07/analyze.mjs holdout artifacts/odyssey-benchmark-orb59-holdout-2026-10-07 --completed --nominations artifacts/odyssey-benchmark-nextpass-preregistration-2026-10-07/nominations.json
```

Open each extracted `report.html` directly in a browser. The independent reader uses
only Node built-ins; raw JSONL and configs also support independent analysis tools.
Read the extracted `independent-holdout-review.md` and `independent-holdout-gate-audit.json`
for the complete qualified recommendation and source attribution.

For executable historical replay, follow the frozen snapshot's extracted `manifest.json`
in a **separate checkout** at HEAD `d14b1c2364fdc0916e65ab930b164ab4213f0767`: apply
its saved application patch, then overlay its listed files. This snapshot preserves the
final screen/holdout implementation. The initial campaign's older harness hash and data
are retained, but its entire earlier executable harness is not claimed to be archived.
Do not overwrite the active workspace or silently replay against adopted source.

## Verify the handover

This standard-library Python check validates the ZIP and every member:

```powershell
@'
from pathlib import Path
from hashlib import sha256
import json, zipfile
base = Path('docs/benchmarks/2026-10-07')
manifest = json.loads((base / 'manifest.json').read_text(encoding='utf-8'))
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
'@ | python -
```

## Provenance and prepared follow-up

Cadence, Quad and production reproduction lacked original `environment.json` records.
Those three archive members are **post-hoc derived descriptors**, marked in both manifest
and file. Runtime/revision comes from the original run config; host context is explicitly
referenced from the nearby recorded holdout environment. They are not contemporaneous
captures and do not alter the source artifact directories.

The included `odyssey-benchmark-opponent-fidelity-2026-10-07` driver, README and
instrumentation smoke are **prepared follow-up tooling**, not completed duel evidence.
They support a future comparison of benchmark three-preview opponent planning with
production opponent queue knowledge; they do not authorize duel pacing changes.

Huge traces, duplicate summary/report.md outputs, logs and report server/browser checker
scripts are excluded. Original source artifacts were neither moved nor deleted.
