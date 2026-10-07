# Odyssey targeted mastery evidence — 2026-10-07

This archive supports the [targeted mastery record](../../ODYSSEY_TARGETED_MASTERY_2026-10.md)
and [handover](../../ODYSSEY_BALANCE_HANDOVER_2026-10.md). It preserves nine bounded
development searches, nine independent untimed replays and eighteen timed replays.
All 36 invocations completed with verified source/configuration provenance.

## What changed and what was learned

The new offline solver searches the exact three-star conjunction, preserves ordinary
automatic completion and showcase continuation, and receives only the current piece
and three visible previews. Its additional unknown-piece search uses a declared
uniform seven-shape surrogate, not the actual hidden bag. Independent replay executes
recorded commands through production physics without calling the planner. Authored
targets, production scoring, gravity and default benchmark profiles are unchanged.

The source-derived inventory audit establishes necessary bounds:

| Target | Minimum pieces |
| --- | ---: |
| Orb 55 three stars | 155 |
| Orb 59 three stars | 140 |
| Orb 55 three stars plus every optional bonus | 305 |

Thus the previous 128-piece cap could not demonstrate full three-star completion at
55/59. Orb 49 has several relaxed routes requiring at least 128–133 pieces; its
score-triggered finish and lock bonuses constrain them further. These are arithmetic
bounds, not legal solutions. The new 192-piece budget removes some inventory
obstructions but does not guarantee enough search coverage or a reachable solution.

| Orb | Search maximum chain | Three-star chain target | Search termination |
| --- | ---: | ---: | --- |
| 49 | 5 | 8 | All three acquire primary before mastery, at 100/112/95 pieces |
| 55 | 6 | 18 | All three exhaust 192 pieces before primary |
| 59 | 7 | 12 | All three exhaust 192 pieces before primary |

All nine search traces pass their recorded checks with **zero prediction mismatches**.
All nine independent untimed replays complete with valid commands, matching boards
and conserved cells. Only orb 49 acquires primary in those untimed replays. None
demonstrates the full three-star conjunction.

Five of eighteen timed replays complete their recorded paths: all three orb-55
traces at 150 ms reaction / 100 ms action timing and two at 300 ms / 180 ms.
The other thirteen interrupt: seven automatic locks and six rejected commands.
All eighteen are **primary-censored**, including the five legal complete paths
that end before acquiring primary. Their raw `qualityCensored` flags are false
because no timed primary was reached; this is not complete showcase-quality evidence.
No timed mastery witness qualifies. These scripted-path failures do not establish
that an adaptive player or another policy cannot complete the levels.

The next useful work is timed replanning and targeted setup geometry: orb 49 needs
its Quads and deep chain in the finishing resolution; 55/59 need both enough cascade
sequences and a deep chain. No authored retune or default-policy adoption follows
from this development cohort. The existing player protocol remains necessary for
learning, retry motivation and enjoyable challenge. No human sessions were run.

## Frozen source and coverage

- Implementation: `0ecb8839c6542eae1cc1c6e5c7bba1af1c5749a3`.
- Freeze: `2026-10-07T16:55:15.064Z`, before these outcomes.
- Source SHA-256: `b76c97feb21a3fc04c55ce5fad7b1923e309824c374c523e6be3416d3c0d9c4a`.
- Runtime: Node `v24.19.0`, Linux x64; three concurrent processes.
- Development seeds: 9101–9103 for each orb. These seeds were previously inspected;
  this is not fresh confirmation. Seeds starting at 11001 remain reserved.
- Search: 192 pieces, beam width eight, 240,000 total nodes, at most 2,400 nodes per
  plan shared adaptively across remaining pieces, one unknown-shape tail, 240-second
  wall limit. No gameplay clock or competing gravity; maximum 50-point lock bonus.
- Replay: all nonempty traces, including unsuccessful ones; untimed plus both fixed
  cadences above, 1,800 simulated seconds and 120 wall seconds per invocation.
- Validation: **8,335 tests across 647 files pass**, including 47 new focused tests.
  Scoped lint, typecheck, TypeScript/lint ratchets, boundaries, architecture fitness
  and release checks pass. Repository lint remains at its existing baseline.

The ZIP includes the immutable registration/analyzer, all configs and raw results,
progress logs, source snapshot and patch, validation, source-derived bounds,
development variants and independent audit. The pre-execution analyzer check records
36 missing invocations before launch. Development smoke records disclose where full
traces were regenerated from the same initial source; they are not extra cohort samples.
The snapshot contains all 1,186 source files used by the recorded fingerprint.

## Reproduce and verify

`manifest.json` records the ZIP size/SHA-256 and every member's size/SHA-256.
The archive has **297 members**, **10,712,772 bytes**, and SHA-256:

```text
1a3397e635879e5d1ffd75068047b32c368adef7d3e5bae40abf7f82bfb79691
```

A fresh independent extraction verified every checksum and reproduced both
`analysis.json` and `independent-result-audit.json` byte for byte from archived
inputs. To verify the ZIP and member checksums again:

```bash
python3 - <<'PY'
from pathlib import Path
from hashlib import sha256
import json, zipfile
base = Path('docs/benchmarks/2026-10-07-targeted')
manifest = json.loads((base / 'manifest.json').read_text())
archive = base / manifest['archive']['path']
assert archive.stat().st_size == manifest['archive']['bytes']
assert sha256(archive.read_bytes()).hexdigest() == manifest['archive']['sha256']
members = {item['path']: item for item in manifest['files']}
with zipfile.ZipFile(archive) as bundle:
    names = bundle.namelist()
    assert len(names) == len(set(names)) == len(members)
    assert set(names) == set(members)
    for name in names:
        data = bundle.read(name)
        assert len(data) == members[name]['bytes']
        assert sha256(data).hexdigest() == members[name]['sha256']
print('Archive and all member checksums verified')
PY
```

From the repository root, extract to a fresh directory:

```bash
python3 -m zipfile -e docs/benchmarks/2026-10-07-targeted/evidence.zip /tmp/odyssey-targeted-evidence
python3 /tmp/odyssey-targeted-evidence/analyze.py --self-test
python3 /tmp/odyssey-targeted-evidence/analyze.py
python3 /tmp/odyssey-targeted-evidence/audit-results.py
```

The standard-library analyzer verifies archived source bytes, the frozen registration,
all task configurations, result hashes, replay inputs and recorded trace checks.
It separates legal traces, primary completion, exact star predicates, optional bonuses
and qualified timed witnesses. It does not rerun gameplay physics or certify human
feasibility. The independent audit and tests provide separate execution checks.

For gameplay reproduction, use a separate checkout of the implementation commit,
the recorded Node/runtime and commands in `registration.json`, with new output paths.
Alternatively apply `implementation.patch` to parent `d139369`; the snapshot provides
an independent source-byte check. Changing HEAD/runtime is a different recorded
configuration, and repeating these development seeds is not independent confirmation.
The existing benchmark archives retain their original source and budget meanings.

For actual player sessions, use the empty [recording template](player-playtest-template.csv)
with the [formative protocol](../../ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md#player-playtest-protocol).
Record one row per attempt, use pseudonymous player/session identifiers and preserve
the exact tested commit. Experience groups are new/occasional, regular or experienced;
challenge/frustration ratings use 1–5. Blank values mean unobserved, not failure or zero.
