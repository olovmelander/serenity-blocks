"""Compare renderer intervals in a real match and a replay of its own inputs."""
import argparse
import gzip
import json
import statistics
from pathlib import Path

from frame_metrics import percentile, planning_gates


def display_counts(run):
    hz = run['requestedHz']
    intervals = run['intervals']
    long = sum(ms > 2000 / hz + .25 for ms in intervals)
    missed = sum(ms >= 2000 / hz - .25 for ms in intervals)
    events = run['stalls'] + run['nearTwoFrames']
    if long != len(run['stalls']) or missed != len(events):
        raise ValueError('Recorded frame events disagree with their timestamps')
    return {
        'twoRefresh': missed,
        'longer': long,
        'duringPlanning': sum(event[4] > 0 for event in events),
        'hz': 1000 / statistics.mean(intervals),
    }


def compare(live, replay):
    keys = ('buildManifestSha256', 'requestedHz', 'clock', 'boards', 'botCount', 'rivalTier', 'gameUrl', 'runtime')
    if any(live.get(key) != replay.get(key) for key in keys):
        raise ValueError('Different build, room, renderer or clock in the live and replay runs')
    if live['replay'] or not replay['replay'] or not live['inputs'] or replay['times']:
        raise ValueError('Expected a live match and its input-only replay')
    for run in (live, replay):
        if (run['checkFormat'] != 'body-v1' or not run['sharedTexturePaints'] or
                run['runtime']['mainPriority'] != 0 or run['runtime']['rendererPriority'] != 0):
            raise ValueError('Expected a normal-priority rendered game with body-labelled checkpoints')
    if abs(live['elapsed'] - replay['elapsed']) > 1000:
        raise ValueError('Recording durations differ by more than one second')

    def checkpoints(run):
        rows = run['checks']
        board = {(r[0], r[1]): r[2:] for r in rows}
        if len(board) != len(rows):
            raise ValueError('Duplicate checkpoint in a recording')
        return board

    before, after = checkpoints(live), checkpoints(replay)
    common = before.keys() & after.keys()
    if not common or len(common) < .95 * max(len(before), len(after)) or any(before[k] != after[k] for k in common):
        raise ValueError('The recorded game and replay do not agree at their labelled checkpoints')
    return {
        'inputs': len(live['inputs']), 'boards': len(common),
        'liveBoards': len(before), 'replayBoards': len(after),
        'live': display_counts(live), 'replay': display_counts(replay),
        'planningFrames': len(live['times']), 'planningP95': percentile(live['times'], .95),
        'planningP99': percentile(live['times'], .99), 'planningMax': max(live['times']),
        'planningOver': len(live['overBudget']), 'planningBudgets': planning_gates(live),
    }


def print_pair(label, live, replay):
    result = compare(live, replay)
    a, b = result['live'], result['replay']
    print(f"{label}: {a['twoRefresh']} / {b['twoRefresh']} two-refresh intervals "
          f"({a['twoRefresh'] - b['twoRefresh']:+d}), {a['hz']:.1f} / {b['hz']:.1f} delivered Hz, "
          f"{result['boards']} matching boards, {result['inputs']} recorded inputs, "
          f"planning p95/p99/max {result['planningP95']:.1f}/{result['planningP99']:.1f}/{result['planningMax']:.1f} ms, "
          f"{result['planningOver']} over a frame")
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('live', nargs='?', type=Path, help='A live rendered-match.cjs JSON file')
    parser.add_argument('replay', nargs='?', type=Path, help='The corresponding input-only replay JSON')
    parser.add_argument('--archive', type=Path, default=Path(__file__).with_name('display-followup.json.gz'))
    args = parser.parse_args()
    if (args.live is None) != (args.replay is None):
        parser.error('Supply both the live file and its replay')
    if args.live:
        print_pair(args.live.name, json.loads(args.live.read_bytes()), json.loads(args.replay.read_bytes()))
    else:
        with gzip.open(args.archive, 'rt', encoding='utf8') as source:
            ledger = json.load(source)
        games = [case['live'] for case in ledger['pairs']]
        expected = {(room, hz) for room in (1, 3, 4, 'Neon') for hz in (60, 165)}
        measured = {(run.get('botCount') or 'Neon', run['requestedHz']) for run in games}
        if len(games) != len(expected) or measured != expected or any(run['buildManifestSha256'] != ledger['manifest'] for run in games):
            raise ValueError('Archive does not cover all eight rooms and refresh rates on its stated manifest')
        print('Measured revision', ledger['revision'])
        for case in ledger['pairs']:
            print_pair(case['label'], case['live'], case['replay'])
