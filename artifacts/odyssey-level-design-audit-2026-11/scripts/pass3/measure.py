"""Rerun and score the 15-seed Odyssey audit. Pass an output directory and optionally --run."""
import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import median

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ANALYSIS = HERE / 'analysis'
sys.path.insert(0, str(ANALYSIS))
from restar import gameplay_key, stars_for

BLOCKS = (12001, 13001, 16001)
SEEDS = {seed for start in BLOCKS for seed in range(start, start + 5)}
GATES = [('stacker', 'deliberate'), ('stacker', 'native'), ('cascade', 'steady'),
         ('expert', 'native'), ('quad', 'native')]
HUMAN_PACES = ('human-casual', 'human-regular', 'human-strong')
BANDS = GATES + [(p, c) for p in ('stacker', 'cascade', 'quad') for c in HUMAN_PACES]


def jobs(orb=None):
    human_groups = [('orb', str(orb))] if orb else [('bulk', '1-46,48-54,56-60'), ('47', '47'), ('55', '55')]
    for start in BLOCKS:
        for profile in ('expert', 'cascade', 'stacker', 'quad'):
            cadences = ','.join(c for p, c in GATES if p == profile)
            yield f'gate-{start}-{profile}', start, profile, cadences, str(orb) if orb else 'all'
        for profile in ('cascade', 'quad', 'stacker'):
            for tag, levels in human_groups:
                yield f'pace-{start}-{profile}-{tag}', start, profile, ','.join(HUMAN_PACES), levels


def run_job(spec, out, workers):
    label, start, profile, cadences, levels = spec
    directory = out / label
    command = ['node', 'scripts/odyssey-benchmark.mjs', '--levels', levels, '--profiles', profile,
               '--cadences', cadences, '--seed-start', str(start), '--samples', '5',
               '--workers', str(workers), '--wall-ms', '600000', '--output', str(directory)]
    if (directory / 'capabilities.json').exists():
        command.append('--resume')
    with (out / (label + '.log')).open('a', encoding='utf-8') as log:
        subprocess.run(command, cwd=REPO, stdout=log, stderr=subprocess.STDOUT, check=True)
    print(f'Finished {label}', flush=True)


def read_jobs(out, orb_id=None):
    levels, groups, revisions = {}, defaultdict(dict), set()
    for label, start, profile, cadences, _ in jobs(orb_id):
        directory = out / label
        config = json.loads((directory / 'config.json').read_text(encoding='utf-8'))
        rev = config['revision']
        revisions.add((rev['head'], rev['applicationHash'], rev['benchmarkHash'], rev['runtime']['node']))
        if (config['seedStart'], config['samples'], config['profileIds'], set(config['cadenceIds']),
            config['maxSimSeconds'], config['maxPieces'], config['lapWindowSeconds']) != (
                start, 5, [profile], set(cadences.split(',')), 1800, 3000, None):
            raise ValueError(f'Unexpected benchmark settings in {label}')
        for item in config['effectiveLevels']:
            level = item['level']
            if item['scenarioId'] != 'baseline' or levels.setdefault(level['id'], level) != level:
                raise ValueError(f'Conflicting level configuration in {label}')
        count = 0
        with (directory / 'raw.jsonl').open(encoding='utf-8') as raw:
            for line in raw:
                row = json.loads(line)
                orb, p, c, seed = (row[k] for k in ('levelId', 'profileId', 'cadenceId', 'seed'))
                attempt = (orb, p, c, seed)
                cell = groups[orb, p, c]
                if (seed in cell or not start <= seed < start + 5 or orb not in config['levelIds']
                        or p != profile or c not in config['cadenceIds'] or row['scenarioId'] != 'baseline'
                        or row['outcome'] not in ('win', 'loss', 'censored')
                        or row['reason'] in ('wall-budget', 'worker_wall_budget', 'worker_exit')):
                    raise ValueError(f'Invalid attempt {attempt} in {label}')
                if gameplay_key(row['effectiveConfig']) != gameplay_key(levels[orb]):
                    raise ValueError(f'Stale gameplay parameters on {attempt}')
                if row['outcome'] == 'win' and row['stars'] not in (1, 2, 3):
                    raise ValueError(f'Invalid star award on {attempt}')
                scored = stars_for(levels[orb], row)
                if scored is not None and scored != (row['goalStars'] or 0):
                    raise ValueError(f'Independent star score differs on {attempt}')
                cell[seed] = row
                count += 1
        if count != config['plannedAttempts']:
            raise ValueError(f'Incomplete {label}: {count} of {config["plannedAttempts"]} attempts')
    orbs = {orb_id} if orb_id else set(range(1, 61))
    expected = {(orb, p, c) for orb in orbs for p, c in BANDS}
    if (len(revisions) != 1 or set(levels) != orbs or set(groups) != expected
            or any(set(cell) != SEEDS for cell in groups.values())):
        raise ValueError('Expected one revision and every selected orb/profile/cadence combination on all 15 seeds')
    revision = revisions.pop()
    print(f'Validated {len(expected) * len(SEEDS):,} attempts.', *revision, sep='\n')
    return levels, groups, revision


def counts(rows):
    return [sum(r['outcome'] == 'win' and r['stars'] >= tier for r in rows) for tier in (1, 2, 3)]


def write_rates(out, levels, groups):
    with (out / 'skill-bands.csv').open('w', encoding='utf-8', newline='') as dest:
        writer = csv.writer(dest, lineterminator='\n')
        writer.writerow(['orb', 'chapter', 'name', 'profile', 'cadence', 'attempts', 'clears',
                         'at_least_2_stars', 'three_stars', 'primary_censored', 'lap_censored',
                         'median_seconds_to_goal_on_clears', 'median_pieces_to_goal_on_clears',
                         *[f'{key}_{s}' for s in BLOCKS for key in ('clears', 'at_least_2', 'three_stars')]])
        for orb, level in sorted(levels.items()):
            for p, c in BANDS:
                cell = groups[orb, p, c]
                rows = list(cell.values())
                wins = [r for r in rows if r['outcome'] == 'win']
                seconds = round(median(r['goalReachedAtSeconds'] for r in wins), 1) if wins else ''
                pieces = median(r['goalMetrics']['piecesPlaced'] for r in wins) if wins else ''
                per_block = [n for start in BLOCKS for n in counts([cell[s] for s in range(start, start + 5)])]
                writer.writerow([orb, level['chapter'], level['name'], p, c, len(rows), *counts(rows),
                                 sum(bool(r['primaryCensored']) for r in rows),
                                 sum(bool(r['qualityCensored']) for r in rows), seconds, pieces, *per_block])


def analyze(script, *args):
    return subprocess.check_output([sys.executable, '-I', '-X', 'utf8', str(ANALYSIS / script),
                                    *map(str, args)], encoding='utf-8')


def report(out, levels, groups):
    level_path = out / 'levels.json'
    level_path.write_text(json.dumps([levels[n] for n in sorted(levels)], ensure_ascii=False), encoding='utf-8')
    analyze('static.py', level_path)
    write_rates(out, levels, groups)
    for label, seeds in [(str(s), range(s, s + 5)) for s in BLOCKS] + [('all15', sorted(SEEDS))]:
        raw, joined = out / f'{label}.jsonl', out / f'{label}-final.json'
        with raw.open('w', encoding='utf-8') as dest:
            for orb in sorted(levels):
                for p, c in GATES:
                    for seed in seeds:
                        dest.write(json.dumps(groups[orb, p, c][seed]) + '\n')
        analyze('final.py', level_path, out / 'static.json', raw, joined)
        verdict = analyze('gates_p2.py', level_path, joined)
        (out / f'{label}-gates.txt').write_text(verdict, encoding='utf-8')
        print(f'{label}  {verdict.splitlines()[-1]}', flush=True)
        if label == 'all15' and not verdict.rstrip().endswith('9 of 9 gates pass'):
            raise SystemExit(verdict)


def committed_application_hash(revision):
    tree = subprocess.check_output(['git', 'ls-tree', '-rz', revision, '--', 'src', 'package.json', 'package-lock.json'], cwd=REPO)
    files = {}
    for record in tree.split(b'\0'):
        if record:
            meta, path = record.split(b'\t', 1)
            if re.search(rb'\.(?:[cm]?[jt]s|json)$', path):
                files[path] = meta.split()[2]
    digest = hashlib.sha256()
    with subprocess.Popen(['git', 'cat-file', '--batch'], cwd=REPO, stdin=subprocess.PIPE, stdout=subprocess.PIPE) as blobs:
        for path, sha in sorted(files.items()):
            blobs.stdin.write(sha + b'\n')
            blobs.stdin.flush()
            _, kind, size = blobs.stdout.readline().split()
            if kind != b'blob':
                raise ValueError(f'Expected a source blob for {path!r}')
            digest.update(path + b'\0')
            digest.update(blobs.stdout.read(int(size)))
            if blobs.stdout.read(1) != b'\n':
                raise ValueError('Invalid git batch output')
        blobs.stdin.close()
    return digest.hexdigest()


def replace_orb(base, out, orb):
    levels, groups, previous = read_jobs(base)
    replacement, fresh, current = read_jobs(out, orb)
    if previous[2:] != current[2:]:
        raise ValueError('The benchmark and Node version must match across both cohorts')
    for head, app_hash, _, _ in (previous, current):
        if committed_application_hash(head) != app_hash:
            raise ValueError(f'The measured source differs from the committed application at {head}')
    # An orb-local correction can reuse other runs only when the gameplay implementation stayed put.
    source_paths = ['src', 'package.json', 'package-lock.json', 'scripts/odyssey-benchmark.mjs', 'scripts/odyssey-benchmark']
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=REPO, encoding='utf-8').strip()
    touched = set(git('diff', '--name-only', previous[0], current[0], '--', *source_paths).splitlines())
    allowed = {'src/core/odyssey/data/level-design-2026-11.js', 'src/core/odyssey/data/chapters.js'}
    if not touched <= allowed or git('diff', '--name-only', current[0], '--', *source_paths):
        raise ValueError(f'Gameplay implementation differs outside the measured orb data: {touched - allowed}')
    if git('ls-files', '--others', '--exclude-standard', '--', *source_paths):
        raise ValueError('Untracked implementation files invalidate a partial campaign remeasure')
    export = "import {LEVEL_CONFIGS} from './src/core/odyssey/data/levels.js';console.log(JSON.stringify(LEVEL_CONFIGS));"
    current_levels = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', export], cwd=REPO))
    if len(current_levels) != 60 or any(level != replacement.get(level['id'], levels[level['id']])
                                        for level in current_levels):
        raise ValueError('The current campaign differs from the per-orb configurations under test')
    provenance = {'retained': {'head': previous[0], 'applicationHash': previous[1], 'orbs': sorted(set(levels) - {orb})},
                  'remeasured': {'head': current[0], 'applicationHash': current[1], 'orbs': [orb]},
                  'benchmarkHash': current[2], 'node': current[3], 'changedSourceFiles': sorted(touched)}
    (out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    levels.update(replacement)
    groups.update(fresh)
    return levels, groups


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--run', action='store_true', help='run or resume the real gameplay benchmarks first')
    parser.add_argument('--jobs', type=int, default=2, help='simultaneous benchmark processes')
    parser.add_argument('--workers', type=int, default=2, help='simulation workers per benchmark process')
    parser.add_argument('--orb', type=int, choices=range(1, 61), metavar='1–60', help='remeasure a single corrected orb')
    parser.add_argument('--base', type=Path, help='previous complete 60-orb run for an orb-local correction')
    args = parser.parse_args()
    if min(args.jobs, args.workers) <= 0:
        parser.error('jobs and workers must be positive')
    if bool(args.orb) != bool(args.base):
        parser.error('--orb and --base must be supplied together')
    output = args.directory.resolve()
    if args.base and args.base.resolve() == output:
        parser.error('a corrected orb needs a separate output directory')
    if args.run:
        output.mkdir(parents=True, exist_ok=True)
        with ThreadPoolExecutor(max_workers=args.jobs) as pool:
            list(pool.map(lambda spec: run_job(spec, output, args.workers), jobs(args.orb)))
    if args.orb:
        levels, groups = replace_orb(args.base.resolve(), output, args.orb)
    else:
        levels, groups, _ = read_jobs(output)
    report(output, levels, groups)
