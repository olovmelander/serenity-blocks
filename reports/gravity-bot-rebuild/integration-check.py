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
from statistics import median
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


def search_trial(directory, name):
    result = read_json(directory / name)
    for method in result['methods']:
        method['path'] = Path(method['path'].replace('\\', '/')).name
    return result


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
        'plannerSpike': {
            'protocol': read_json(directory / 'nov20-solo-test-protocol.json'),
            'scheduled': read_json(directory / 'nov20-solo-spike-60.json'),
            'freshProcesses': {p.stem.removeprefix('nov20-case-'): read_json(p)
                               for p in sorted(directory.glob('nov20-case-*.json'))},
            'allocationTrial': search_trial(directory, 'nov20-root-allocation-ab.json'),
            'landingIndexTrial': search_trial(directory, 'nov20-indexed-search-ab.json'),
            'renderer': [read_json(directory / f'nov20-render-round11-{i}.json') for i in range(1, 5)],
        },
        'renderer': {key: read_json(directory / f'integrated-render-{key}.json') for key, _, _ in cases()},
        'release': {
            'build': read_json(directory / 'nov20-release-build.json'),
            'parsedScripts': read_json(directory / 'nov20-release-scripts.json'),
            'renderer': {key: read_json(directory / f'release-render-{key}.json')
                         for key, _, _ in cases() if key.startswith('1-')},
        },
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


def check_game(previous, current, room, hz, manifest, seconds=600):
    runtime = current['runtime']
    if (current['buildManifestSha256'] != manifest or current['requestedHz'] != hz or current['replay']
            or current['elapsed'] < seconds * 1000 or not current['sharedTexturePaints'] or current['checkFormat'] != 'body-v1'
            or current['boards'] != previous['boards'] or current['clock'] != previous['clock']
            or any(runtime[k] != previous['runtime'][k] for k in ('cpu', 'electron', 'chromium', 'renderer'))
            or runtime['mainPriority'] != 0 or runtime['rendererPriority'] != 0):
        raise ValueError('Invalid live packaged measurement')
    if room == 'odyssey':
        if current['rivalTier'] != previous['rivalTier'] or current['activeTicks'] < seconds * 45:
            raise ValueError('Insufficient active play with the same authored Odyssey rival')
    elif current['botCount'] != int(room):
        raise ValueError('Unexpected local opponent count')
    if len(current['overBudget']) != sum(ms > 1000 / hz for ms in current['times']):
        raise ValueError('Frame timestamps disagree with the recorded over-budget events')
    count = min(len(r['inputs']) for r in (previous, current))
    boards = [{(c[0], c[1]): c[2:] for c in r['checks']} for r in (previous, current)]
    common = boards[0].keys() & boards[1].keys()
    expected_boards = max(map(len, boards)) if seconds == 600 else len(boards[1])
    if (not count or previous['inputs'][:count] != current['inputs'][:count] or not common
            or len(common) < .95 * expected_boards or any(boards[0][k] != boards[1][k] for k in common)):
        raise ValueError('Seeded inputs or labelled boards differ after integration')
    if seconds < 600 and (count != len(current['inputs']) or len(common) != len(boards[1]) or len(common) < seconds // 30):
        raise ValueError('Incomplete input or board parity with the longer game')
    return count, len(common)


def check_spike(before, evidence, manifest):
    event, = before['overBudget']
    coordinate = event['round'], event['tick']
    expected_inputs = [item for item in before['inputs'] if item[0] == event['round']]
    expected_checks = [item for item in before['checks'] if item[0] == event['round']]
    scheduled = evidence['scheduled']
    if scheduled['events'] != [event] or len(scheduled['rounds']) != 60:
        raise ValueError('Scheduled investigation does not reproduce the original frame')
    costs = []
    for result in scheduled['rounds']:
        call, = [c for c in result['calls'] if c['tick'] == event['tick']]
        if (result['round'] != event['round'] or call['locks'] != event['locks'] or call['pending'] != event['pendingRows']
                or result['matchedInputs'] != sum(i[2] <= result['ticks'] for i in expected_inputs)
                or result['matchedChecks'] != sum(c[1] <= result['ticks'] for c in expected_checks)):
            raise ValueError('Scheduled replay differs at the recorded turn')
        costs.append(call['ms'])
    print(f'Original {event["planningMs"]:.1f} ms frame at {coordinate}; 60 exact-schedule call times'
          f' (median / p95 / max): {median(costs):.3f} / {percentile(costs, .95):.3f} / {max(costs):.3f} ms')
    for run in evidence['renderer']:
        focus = run['focus']
        call, = focus['calls']
        if ((focus['round'], focus['tick']) != coordinate or (call['locks'], call['pending']) != (event['locks'], event['pendingRows'])
                or run['buildManifestSha256'] != manifest or run['replay'] or run['requestedHz'] != 165 or run['elapsed'] < 16000
                or not run['sharedTexturePaints'] or run['overBudget'] or run['runtime']['rendererPriority'] != 0
                or run['inputs'] != expected_inputs[:len(run['inputs'])] or not run['checks'] or run['checks'][-1][1] <= event['tick']
                or run['checks'] != expected_checks[:len(run['checks'])]):
            raise ValueError('Focused packaged run differs in its measured state, budget or inputs')
        print(f'  Packaged round: {call["ms"]:.1f} ms on the selected tick, {max(run["times"]):.1f} ms maximum,'
              f' {len(run["inputs"])} matching inputs and {len(run["checks"])} labelled checkpoints')


def check_release(measured, release):
    proof = release['parsedScripts']
    manifest = release['build']['manifestSha256']
    parsed = {script for run in measured['renderer'].values() for script in run['loadedScripts']}
    rows = proof['scripts']
    if (proof['measuredManifest'] != measured['build']['manifestSha256'] or proof['candidateManifest'] != manifest
            or parsed != {row['measured'] for row in rows}
            or any(r['status'] not in ('identical', 'dependency filenames only')
                   or r['normalizedSha256'][0] != r['normalizedSha256'][1] for r in rows)):
        raise ValueError('A script exercised in the measured game changed after the upstream sync')
    files = {row['candidate'] for row in rows}
    totals = Counter()
    print('Release script comparison:', dict(Counter(row['status'] for row in rows)))
    for key, room, hz in cases():
        if not key.startswith('1-'):
            continue
        game = release['renderer'][key]
        inputs, boards = check_game(measured['renderer'][key], game, room, hz, manifest, seconds=120)
        if not game['loadedScripts'] or set(game['loadedScripts']) - files:
            raise ValueError(f'Unverified script loaded in release game {key}')
        failed = [g for g, passed in planning_gates(game).items() if not passed]
        if failed:
            raise ValueError(f'Release game {key} exceeded its planning budget: {failed}')
        times = game['times']
        totals.update(frames=len(times), inputs=inputs, boards=boards)
        print(f'  {key}: {len(times)} active frames, p95 / p99 / max {percentile(times,.95):.1f} / '
              f'{percentile(times,.99):.1f} / {max(times):.1f} ms, {inputs} inputs, {boards} boards')
    print('Release totals:', dict(totals))


def verify(reference, current):
    compare_campaign(reference['campaign']['remapped-gates']['raw'], current['campaign'],
                     current['levelIntegration']['upstreamRetuned'])
    if reference['coldProcessReplay'] != current['coldProcessReplay']:
        raise ValueError('Cold-process replay hashes changed')
    check_spike(reference['renderer']['prefetched-render-2-1-165'], current['plannerSpike'], current['build']['manifestSha256'])
    totals = Counter()
    reference_failures = []
    release_failures = []
    print('Pass/room/Hz      active frames    p95    p99    max    late p95    paired inputs / boards')
    for key, room, hz in cases():
        before = reference['renderer']['prefetched-render-' + key]
        run = current['renderer'][key]
        inputs, boards = check_game(before, run, room, hz, current['build']['manifestSha256'])
        for failures, data in [(reference_failures, before), (release_failures, run)]:
            for gate, passed in planning_gates(data).items():
                if not passed:
                    failures.append((key, gate))
        times = run['times']
        totals.update(frames=len(times), inputs=inputs, boards=boards)
        print(f'{key:<17} {len(times):>8}   {percentile(times,.95):>4.1f}   {percentile(times,.99):>4.1f}'
              f'   {max(times):>4.1f}       {percentile(run["lateness"],.95):>4.1f}      {inputs:>5} / {boards}')
    print('Integrated totals:', dict(totals))
    print('Pre-integration planning gate misses:', reference_failures)
    if release_failures:
        raise ValueError(f'Integrated planning gates outside budget: {release_failures}')
    check_release(current, current['release'])


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
