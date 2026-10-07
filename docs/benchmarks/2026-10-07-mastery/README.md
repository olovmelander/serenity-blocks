# Odyssey mastery and corrected-physics evidence — 2026-10-07

This archive supports the [balance handover](../../ODYSSEY_BALANCE_HANDOVER_2026-10.md)
and [journey difficulty review](../../ODYSSEY_JOURNEY_DIFFICULTY_2026-10.md).
It preserves **138 timed attempts and 100 untimed construction runs**, with the
campaigns before and after the cascade correction kept separate.

| Frozen source | Timed duels | Timed solo | Untimed construction |
| --- | --- | --- | --- |
| Before correction: `b89bbec` | 80; 41 wins, 39 bot losses | — | 50; 46 valid traces, four invalid from cell loss |
| After correction: `5078998` | 40; 20 wins, 20 bot losses | 18; 17 primary wins, one top-out | 50; all valid, including thirteen real top-outs |

All timed attempts resolve without runtime errors or primary censoring. These are
synthetic policy observations, not human difficulty calibration. The fresh post-fix
seeds differ from the pre-fix seeds; the campaigns are unpaired and must not be
pooled into an efficacy estimate. Instrumentation preflights, regression replays and
development variants are preserved separately and excluded from these totals.

## Findings and limits

The construction audit exposed a shared physics defect. Clearing a row moved
surviving fragments upward before gravity, creating overlaps that could discard
cells. Commit `5078998` preserves survivor coordinates until gravity moves them.
Four recorded failure fixtures now conserve cells in both legacy and resolved
physics. The full suite passes **8,288 tests across 644 files**, and the typecheck,
lint/TypeScript ratchets, import boundaries and architecture gates pass. Existing
repository lint findings remain at baseline; this is not a warning-free lint claim.

On corrected physics, authored expert/chain construction maxima are **4/6 waves
at orb 49, 5/7 at 55 and 4/5 at 59**. None demonstrates the effective three-star
chain requirements of 8/18/12 or full mastery. These bounded searches do not prove
impossibility. Untimed construction omits competing gravity and elapsed time and
receives the maximum lock bonus; even a successful witness would require subsequent
finite-speed validation. All fifty fresh traces pass their recorded validity checks;
validity does not mean the target was reached. Thirteen `chain` top-outs are valid
failed constructions.

The experimental `duelist` policy does not show useful early-duel improvement and
remains opt-in. Both corrected-engine policies win every sampled duel at orbs 4/9
and lose every sampled duel at 53/58. Its early successful-match medians and paired
attack yield are worse than `cascade`. No opponent or mastery retuning is selected.

The seventeen corrected-engine solo wins all have one observed star. All six orb-55
wins have an explicitly censored thirty-second quality window; their primary wins
remain valid. The five orb-59 wins end quality observation at the benchmark deadline.
Their raw `qualityCensored` flag is false under that recorded policy, but the window
does not cover complete live showcase play, which can continue until manual finish
or top-out. Neither observation establishes full higher-star fairness.

The old eleven-wave orb-59 witness and six-wave development example apply only to
pre-fix physics. The corrected engine changes actual cascades. Affected historical
demos/checkpoints may still load but diverge, and patched/unpatched multiplayer
peers are not guaranteed compatible: the repository has no complete simulation-
version gate. This work adds no unrelated file-format or wire-protocol version bump.

## Contents and provenance

`evidence.zip` contains **128 files**, **13,603,965 bytes**, with SHA-256:

```text
d8127c21581c94478db4e643ad430daca1e19b7a53ba0f4980afb9cf7bea34d3
```

`manifest.json` records the archive checksum, every member's size/checksum and the
independent verification result. The ZIP extracts directly to the evidence root.
Its `README.md` and `registration.json` preserve the original pre-fix registration;
`postfix/` holds the separately registered corrected-engine campaign. The bundle
includes raw attempts, construction traces, configs, HTML reports, registrations,
analyzers, source snapshots/patches, all explored development variants, arithmetic
star bounds, independent replay audits, browser captures and validation logs.

| Source property | Before correction | After correction |
| --- | --- | --- |
| Commit | `b89bbec18a7f73eacab83cd9f2f05d417e551c9a` | `50789988ae038f5f32214869d5d4941f06235686` |
| Application SHA-256 used by CLI | `d7b17304ea8fc3d395b1a0d47b5dc3d7846ace6f8c1087196b8b1b8f41cc8cb8` | `3d1e7e953bb3a42a8bf20418780d7099e5dd849982282fb9270141038273373f` |
| Fresh construction/duel seeds | Construction 10001–10005; duels 10001–10010 | 10101–10105; solo uses 10101–10103 |

Both use Node `v24.19.0`, Linux x64, and benchmark SHA-256
`c344f45980a57811339d9f3f370a5505385143fa185745a9130f9968607783f5`.
The pre-execution source ZIP contains 1,183 files. The post-fix source is that ZIP
plus `postfix/source-overlay.zip`, containing the single changed source file.

The original freeze script sorted path components instead of full relative path
strings, recording pre-fix application hash
`609a9fb190c44dba46fcc1fc7e0bc183a93e37056ef2e54bbe113fe52ea8ebb3`.
This discrepancy was found before outcome analysis. Both digests reproduce from
the same archived bytes under the respective orderings. The original registration
and analyzer remain unchanged. `provenance-correction.json` discloses the error;
`analyze-verified.py` verifies the source and substitutes only the CLI-compatible
hash in memory. It preserves `analysis-original.json` and checks that no recorded
measurement changes. The post-fix freeze uses CLI ordering from the outset.

## Verify and reproduce

From the repository root, this standard-library Python command verifies every
archived member, extracts into a fresh temporary directory and regenerates all
three analyses. No npm installation or live workspace source is required:

```bash
python3 - <<'PY'
from pathlib import Path, PurePosixPath
from hashlib import sha256
import json, subprocess, sys, tempfile, zipfile

base = Path('docs/benchmarks/2026-10-07-mastery')
manifest = json.loads((base / 'manifest.json').read_text())
archive = base / manifest['archive']['path']
assert archive.stat().st_size == manifest['archive']['bytes']
assert sha256(archive.read_bytes()).hexdigest() == manifest['archive']['sha256']
root = Path(tempfile.mkdtemp(prefix='odyssey-mastery-evidence-'))
members = {item['path']: item for item in manifest['files']}
assert len(members) == len(manifest['files'])
with zipfile.ZipFile(archive) as bundle:
    names = bundle.namelist()
    assert len(names) == len(set(names)) == len(members)
    assert set(names) == set(members)
    for name in names:
        path = PurePosixPath(name)
        assert not path.is_absolute() and '..' not in path.parts
        data = bundle.read(name)
        assert len(data) == members[name]['bytes']
        assert sha256(data).hexdigest() == members[name]['sha256']
    bundle.extractall(root)
outputs = ['analysis-original.json', 'analysis.json', 'postfix/analysis.json']
expected = {name: (root / name).read_bytes() for name in outputs}
# Remove only the extracted copy so the unchanged original analyzer also reruns.
(root / 'analysis-original.json').unlink()
subprocess.run([sys.executable, str(root / 'analyze-verified.py'),
                '--root', str(root)], check=True)
subprocess.run([sys.executable, str(root / 'postfix/analyze.py'),
                '--root', str(root / 'postfix')], check=True)
for name in outputs:
    assert (root / name).read_bytes() == expected[name], name
print('All member checksums match; all three analyses reproduce byte for byte.')
print('Extracted evidence:', root)
PY
```

This verification passed on a fresh extraction before the evidence was committed.
The analyzers verify recorded configuration, source and trace metadata; they do
not independently simulate every gameplay action. The recorded driver checks,
focused replay audits and regression tests provide that separate execution evidence.
Open the extracted cohort `report.html` files to inspect individual observations.

For a gameplay rerun, use a separate checkout of the appropriate full commit above,
Node 24.19.0 on Linux x64, and the exact commands in that campaign's immutable
`registration.json`. Use a new output directory. Source snapshots and patches are
retained for independent byte verification; changed revision or runtime metadata
must not resume an old checkpoint. Replaying these seeds is reproduction, not fresh
confirmation. Seeds starting at 11001 remain reserved for a separately registered
follow-up. The handover describes the next targeted solver and player-playtest work.
