"""Replay the nine approved campaign gates using their private fit-handover runner.

Arguments are the gates/ tool directory, the pinned game checkout, a new output
directory and the raw benchmark JSONL files. Supports the historical Quad alias.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

parser = argparse.ArgumentParser(description=__doc__)
for arg in ('tools', 'checkout', 'output'):
    parser.add_argument(arg, type=Path)
parser.add_argument('inputs', nargs='+', type=Path)
parser.add_argument('--retry', action='append', default=[], type=Path,
                    help='Successful repeats of any interrupted frozen cells')
parser.add_argument('--rivals', action='append', default=[], type=Path,
                    help='Substitute the eight remapped opponents on the identical 600 player cells')
args = parser.parse_args()
tools, checkout, output = args.tools, args.checkout, args.output.resolve()
output.mkdir(exist_ok=False)
levels = output / 'levels.json'
static = output / 'static.json'
raw = output / 'all15.jsonl'
final = output / 'final.json'
subprocess.run(['node', tools / 'dump2.mjs', levels, checkout.resolve().as_posix() + '/'], check=True)
cadences = [('stacker', 'deliberate'), ('stacker', 'native'), ('cascade', 'steady'),
            ('expert', 'native'), ('quad', 'native')]
expected = {(orb, seed, profile, cadence)
            for start in (12001, 13001, 16001) for seed in range(start, start + 5)
            for orb in range(1, 61) for profile, cadence in cadences}

# The fit handover includes the schema its scorers read. In that archive
# orb 12's primary counts Quads and orb 6's first bonus counts Quads.
archived = {row['id']: row for row in json.loads((tools / 'archived-levels.json').read_text(encoding='utf-8'))}
quad_fields = {archived[12]['victory']['primary']['type']: 'quads',
               archived[6]['victory']['bonuses'][0]['type']: 'quad-count'}


def canonical_quad_fields(text):
    for old, current in quad_fields.items():
        for quote in ("'", '"'):
            text = text.replace(quote + old + quote, quote + current + quote)
    return text


def load_rows(sources):
    found = {}
    for source in sources:
        with source.open(encoding='utf-8') as lines:
            for line in lines:
                row = json.loads(canonical_quad_fields(line))
                key = tuple(row[x] for x in ('levelId', 'seed', 'profileId', 'cadenceId'))
                if key in found or key not in expected:
                    raise ValueError(f'Unexpected or duplicate attempt {key} in {source}')
                found[key] = row
    return found


def incomplete(row):
    return row['outcome'] == 'error' or row['reason'] == 'wall-budget'


rows = load_rows(args.inputs)
if rows.keys() != expected:
    raise ValueError(f'Found {len(rows)} of {len(expected)} distinct cells')
retries = load_rows(args.retry)
if retries.keys() != {key for key, row in rows.items() if incomplete(row)}:
    raise ValueError('Missing or extra retry for an interrupted frozen cell')
rows.update(retries)
if args.rivals:
    duel_ids = {level['id'] for level in json.loads(levels.read_text(encoding='utf-8')) if level['mechanics'].get('versus')}
    replacements = load_rows(args.rivals)
    if replacements.keys() != {key for key in expected if key[0] in duel_ids}:
        raise ValueError('The remap must cover every rival player cell exactly once')
    rows.update(replacements)
with raw.open('w', encoding='utf-8') as combined:
    for key, row in sorted(rows.items()):
        if incomplete(row):
            raise ValueError(f'Incomplete attempt {key} ({row["reason"]})')
        combined.write(json.dumps(row, separators=(',', ':')) + '\n')
with TemporaryDirectory(prefix='serenity-campaign-gates-') as scratch:
    # All four readers need the campaign's current Quad spelling, including
    # predicates on primary goals, bonus checks, metrics and the HDI judge.
    for script in ('static.py', 'restar.py', 'final.py', 'gates_p2.py'):
        code = (tools / script).read_text(encoding='utf-8')
        Path(scratch, script).write_text(canonical_quad_fields(code), encoding='utf-8')
    for script, args, name in [('static.py', [levels], 'static.txt'),
                               ('final.py', [levels, static, raw, final], 'final.txt'),
                               ('gates_p2.py', [levels, final], 'gates.txt')]:
        with (output / name).open('w', encoding='utf-8') as log:
            subprocess.run([sys.executable, '-I', '-X', 'utf8', Path(scratch, script), *args],
                           check=True, stdout=log)
print((output / 'gates.txt').read_text(encoding='utf-8'))
