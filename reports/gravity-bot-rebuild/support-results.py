"""Summarize paired duels or an actual rendered-match.cjs timing capture."""
import argparse
import gzip
import json
import random
from collections import defaultdict
from pathlib import Path

from frame_metrics import percentile, planning_gates


def duels(rows, *, draw_on_natural_lock=False):
    bags = defaultdict(list)
    totals = [dict(locks=0, score=0, sent=0, dugCells=0) for _ in range(2)]
    outcomes = defaultdict(int)
    for row in rows:
        seat = row['candidate']
        deaths = [False, False] if draw_on_natural_lock and row.get('forcedLock') else row['lost']
        bags[row['seed']].append((seat, deaths))
        if row['maxLockSkew'] or row['samePiecePairs'] < 1 or len(set(row.get('commandedLocks', [row['samePiecePairs']]))) != 1:
            raise ValueError(f"Unequal placement speed on seed {row['seed']}")
        loser, opponent_loser = deaths[seat], deaths[1 - seat]
        outcome = 'simultaneous' if loser and opponent_loser else 'loss' if loser else 'win' if opponent_loser else 'timeout'
        if outcome == 'timeout' and row.get('forcedLock'):
            outcome = 'naturalLockCensor'
        outcomes[outcome] += 1
        for total, index in zip(totals, [1 - seat, seat]):
            for key in ('locks', 'sent', 'dugCells'):
                total[key] += row['stats'][index][key]
            total['score'] += row['scores'][index]
    paired = []
    for seed, pair in bags.items():
        if sorted(seat for seat, _ in pair) != [0, 1]:
            raise ValueError(f'Missing seat reversal for {seed}')
        subtotal = 0
        for seat, deaths in pair:
            subtotal += 0.5 if deaths[0] == deaths[1] else int(deaths[1 - seat])
        paired.append(subtotal / 2)
    rng = random.Random(277159)
    means = [sum(rng.choices(paired, k=len(paired))) / len(paired) for _ in range(5000)]
    return dict(seeds=len(paired), outcomes=dict(outcomes), seatSwappedPoints=sum(paired) / len(paired),
                pairedDrops=sum(row.get('commandedLocks', [row['samePiecePairs']])[0] for row in rows),
                bagBootstrap95=[percentile(means, .025), percentile(means, .975)], baseline=totals[0], candidate=totals[1])


def rendered(data):
    if data['replay'] or not data['sharedTexturePaints']:
        raise ValueError('Expected an actively rendered game')
    elapsed = data['elapsed'] / 60000
    times = data['times']
    if 'seatPlay' in data:
        drops = sum(seat['hardDrops'] for seat in data['seatPlay'])
    else:
        # Older tapes recorded attempts and have no acceptance field.
        drops = sum(event['action'] == 'hardDrop' for _, _, _, event in data['inputs'])
    result = dict(seats=data['botCount'], requestedHz=data['requestedHz'], deliveredHz=data['frames'] / (elapsed * 60),
                actions=len(data['inputs']), drops=drops, hardDropsPerSeatMinute=drops / (elapsed * data['botCount']),
                activeFrames=len(times), p95=percentile(times, .95), p99=percentile(times, .99),
                max=max(times), planningOver=len(data['overBudget']),
                twoRefresh=len(data['nearTwoFrames']) + len(data['stalls']), longStalls=len(data['stalls']),
                intervalP95=percentile(data['intervals'], .95), intervalP99=percentile(data['intervals'], .99),
                intervalMax=max(data['intervals']), rounds=data['rounds'], manifest=data['buildManifestSha256'],
                firstPlanLatenessP95=percentile(data['lateness'], .95), planningGates=planning_gates(data))
    if 'seatPlay' in data:
        result['acceptedHardDropsPerSeat'] = [
            dict(drops=seat['hardDrops'], perWallMinute=seat['hardDrops'] / elapsed,
                 perPlayingMinute=seat['hardDrops'] * 60000 / seat['playingMs'] if seat['playingMs'] else None)
            for seat in data['seatPlay']
        ]
    return result


def speed(rows):
    result = {}
    for tier in (8, 9, 10):
        games = [row for row in rows if row['tier'] == tier]
        minutes = sum(game['ticks'] for game in games) / 3600
        intervals = [ticks for game in games for ticks in game['executionTicks']]
        result[tier] = dict(bags=len(games), minutes=minutes,
                            dropsPerMinute=sum(game['drops'] for game in games) / minutes,
                            inputsPerMinute=sum(game['actions'] for game in games) / minutes,
                            medianFirstInputToDropMs=1000 * percentile(intervals, .5) / 60)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['duels', 'rendered', 'speed', 'archive'])
    parser.add_argument('inputs', nargs='+', type=Path)
    args = parser.parse_args()
    if args.mode in ('duels', 'speed'):
        summarize = duels if args.mode == 'duels' else speed
        print(json.dumps(summarize([json.loads(line) for f in args.inputs for line in f.read_text().splitlines()]), indent=2))
    elif args.mode == 'archive':
        for f in args.inputs:
            with gzip.open(f, 'rt', encoding='utf8') as stream:
                data = json.load(stream)
            results = {'duels': {k: duels(v) for k, v in data['duels'].items()},
                       'allNaturalLocksDrawn': duels(data['duels']['finalUnseen'], draw_on_natural_lock=True),
                       'speed': {k: speed(v) for k, v in data['speed'].items()},
                       'rendered': {k: rendered(v) for k, v in data['rendered'].items()}}
            print(json.dumps(results, indent=2))
    else:
        for f in args.inputs:
            print(f, json.dumps(rendered(json.loads(f.read_bytes())), indent=2))
