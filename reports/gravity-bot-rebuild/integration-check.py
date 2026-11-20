"""Check packaged games and campaign outcomes after integrating an upstream revision.

Pass --collect to pack raw measurements. With just the two archives, repeat every
comparison from a checkout. The reference archive also contains both input-only
replay passes used for the separate display-interval comparison.
"""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

from frame_metrics import percentile, planning_gates


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def read_archive(path):
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        return json.load(stream)


def cases():
    for repeat in (1, 2):
        for room in ('1', '3', '4', 'odyssey'):
            for hz in (60, 165):
                yield f'{repeat}-{room}-{hz}', room, hz


def collect(directory):
    gates = directory / 'nov20-integrated-gates'
    return {
        'build': read_json(directory / 'nov20-build-source.json'),
        'levelIntegration': read_json(directory / 'nov20-level-integration.json'),
        'campaign': {
            'levels': read_json(gates / 'levels.json'),
            'orbs': read_json(gates / 'final.json'),
            'verdict': (gates / 'gates.txt').read_text(encoding='utf-8'),
            'attempts': [json.loads(line) for line in (gates / 'all15.jsonl').read_text(encoding='utf-8').splitlines()],
        },
        'coldProcessReplay': read_json(directory / 'nov20-cold-traces.json'),
        'renderer': {key: read_json(directory / f'integrated-render-{key}.json') for key, _, _ in cases()},
    }


def write_archive(data, destination):
    with NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
        path = Path(temporary.name)
    try:
        with path.open('wb') as file:
            with gzip.GzipFile(fileobj=file, mode='wb', filename='', mtime=0, compresslevel=7) as compressed:
                compressed.write(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        path.replace(destination)
    finally:
        path.unlink(missing_ok=True)


def attempt_key(row):
    return row['levelId'], row['seed'], row['profileId'], row['cadenceId']


def compare_campaign(previous, current, retuned):
    pairs = {attempt_key(row): row for row in previous}
    rows = current['attempts']
    if len(pairs) != 4500 or len(rows) != 4500 or pairs.keys() != {attempt_key(row) for row in rows}:
        raise ValueError('Expected 60 orbs, five player/cadence pairs and the 15 paired campaign seeds')
    changed, flips = Counter(), Counter()
    for row in rows:
        old = pairs[attempt_key(row)]
        # The CLI assigns a job number. The in-process runner has no job number.
        keys = (old.keys() | row.keys()) - {'attemptId', 'wallMs'}
        if any(old.get(k) != row.get(k) for k in keys):
            changed[row['levelId']] += 1
        if old['outcome'] != row['outcome']:
            flips[row['levelId']] += 1
    print('Changed gameplay records by orb:', dict(sorted(changed.items())))
    print('Changed win/loss outcomes by orb:', dict(sorted(flips.items())))
    print(current['verdict'].strip())
    if changed.keys() - set(retuned) or '9 of 9 gates pass' not in current['verdict']:
        raise ValueError('Unexpected campaign gameplay change or failed gate')


def check_game(previous, current, room, hz, manifest):
    runtime = current['runtime']
    if (current['buildManifestSha256'] != manifest or current['requestedHz'] != hz or current['replay']
            or current['elapsed'] < 600000 or not current['sharedTexturePaints'] or current['checkFormat'] != 'body-v1'
            or current['boards'] != previous['boards'] or current['clock'] != previous['clock']
            or any(runtime[k] != previous['runtime'][k] for k in ('cpu', 'electron', 'chromium', 'renderer'))
            or runtime['mainPriority'] != 0 or runtime['rendererPriority'] != 0):
        raise ValueError('Invalid live packaged measurement')
    if room == 'odyssey':
        if current['rivalTier'] != previous['rivalTier'] or current['activeTicks'] < 27000:
            raise ValueError('Insufficient active play with the same authored Odyssey rival')
    elif current['botCount'] != int(room):
        raise ValueError('Unexpected local opponent count')
    if len(current['overBudget']) != sum(ms > 1000 / hz for ms in current['times']):
        raise ValueError('Frame timestamps disagree with the recorded over-budget events')
    count = min(len(r['inputs']) for r in (previous, current))
    boards = [{(c[0], c[1]): c[2:] for c in r['checks']} for r in (previous, current)]
    common = boards[0].keys() & boards[1].keys()
    if (not count or previous['inputs'][:count] != current['inputs'][:count] or not common
            or len(common) < .95 * max(map(len, boards)) or any(boards[0][k] != boards[1][k] for k in common)):
        raise ValueError('Seeded inputs or labelled boards differ after integration')
    return count, len(common)


def verify(reference, current):
    compare_campaign(reference['campaign']['remapped-gates']['raw'], current['campaign'],
                     current['levelIntegration']['upstreamRetuned'])
    if reference['coldProcessReplay'] != current['coldProcessReplay']:
        raise ValueError('Cold-process replay hashes changed')
    totals = Counter()
    failures = []
    print('Pass/room/Hz      active frames    p95    p99    max    late p95    paired inputs / boards')
    for key, room, hz in cases():
        before = reference['renderer']['prefetched-render-' + key]
        run = current['renderer'][key]
        inputs, boards = check_game(before, run, room, hz, current['build']['manifestSha256'])
        for label, data in [('reference', before), ('integrated', run)]:
            for gate, passed in planning_gates(data).items():
                if not passed:
                    failures.append((label, key, gate))
        times = run['times']
        totals.update(frames=len(times), inputs=inputs, boards=boards)
        print(f'{key:<17} {len(times):>8}   {percentile(times,.95):>4.1f}   {percentile(times,.99):>4.1f}'
              f'   {max(times):>4.1f}       {percentile(run["lateness"],.95):>4.1f}      {inputs:>5} / {boards}')
    print('Integrated totals:', dict(totals))
    if failures:
        raise ValueError(f'Planning gates outside budget: {failures}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path, help='The pre-integration evidence.json.gz')
    parser.add_argument('integration', type=Path, help='The measured integration.json.gz')
    parser.add_argument('--collect', type=Path, help='Directory containing the integrated captures and campaign verdict')
    args = parser.parse_args()
    data = collect(args.collect) if args.collect else read_archive(args.integration)
    verify(read_archive(args.reference), data)
    if args.collect:
        write_archive(data, args.integration)
