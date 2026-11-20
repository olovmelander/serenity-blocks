"""Select local motor rates from paired training races, keeping bag folds together."""
from collections import defaultdict
from itertools import product
from pathlib import Path
import json
import math
import sys

source, destination = map(Path, sys.argv[1:])
rows = []
with source.open(encoding='utf-8') as stream:
    for line in stream:
        trial = json.loads(line)
        task, result = trial['task'], trial['row']
        tier, rates = task['tier'], task['nativeApm']
        first = result['rounds'][0]
        first_winner = first['winner'] if first['ticksPlayed'] <= 9000 else None
        points = tuple(0.5 if winner is None else int(winner == tier + 1)
                       for winner in (first_winner, result['winner']))
        rows.append((tier, rates[str(tier)], rates[str(tier + 1)], task['seed'], points))

if len(rows) != 4800 or {row[3] for row in rows} != set(range(86001,86033)):
    raise ValueError('Expected the complete independent motor-rate training grid')


def estimate(samples, raw_weight, effect_weight):
    totals = defaultdict(lambda: [0, 0.0, 0.0])
    cells = set()
    for tier, lower, higher, _, points in samples:
        cells.add((tier, lower, higher))
        for key in ((tier,lower,higher), (tier,lower,None), (tier,None,higher), (tier,None,None)):
            entry = totals[key]
            entry[0] += 1
            entry[1] += points[0]
            entry[2] += points[1]

    def mean(key, metric):
        entry = totals[key]
        return entry[metric + 1] / entry[0]

    predictions = {}
    for key in sorted(cells):
        tier, low, high = key
        values = []
        for metric in (0,1):
            average = mean((tier,None,None),metric)
            effect = mean((tier,low,None),metric) + mean((tier,None,high),metric) - 2 * average
            smooth = average + effect_weight * effect
            values.append(max(0, min(1, raw_weight * mean(key,metric) + (1 - raw_weight) * smooth)))
        predictions[key] = values
    return predictions


folds = [([r for r in rows if r[3] % 4 != fold], [r for r in rows if r[3] % 4 == fold]) for fold in range(4)]
scores = []
for raw_weight, effect_weight in product((0,0.25,0.5,0.75,1), (0.5,1)):
    error = 0
    for training, held in folds:
        predicted = estimate(training, raw_weight, effect_weight)
        for tier, low, high, _, points in held:
            error += sum((actual - model) ** 2 for actual, model in zip(points, predicted[tier,low,high]))
    scores.append((error / (2 * len(rows)), raw_weight, effect_weight))
_, raw_weight, effect_weight = min(scores)
fitted = estimate(rows, raw_weight, effect_weight)
measured = {tier: sorted({r[1] for r in rows if r[0] == tier}) for tier in range(1,10)}
measured[10] = [850]


def rates_between(values):
    expanded = set(values)
    for low, high in zip(values, values[1:]):
        for q in (0.25,0.5,0.75):
            expanded.add(round(math.exp((1-q)*math.log(low) + q*math.log(high))))
    return sorted(expanded)


def neighbors(choices, rate):
    if rate in choices:
        return [(rate,1)]
    lo = max(x for x in choices if x < rate)
    hi = min(x for x in choices if x > rate)
    weight = math.log(rate / lo) / math.log(hi / lo)
    return [(lo,1-weight), (hi,weight)]


def predict(tier, low, high):
    estimate = [0.0,0.0]
    for (lo, w1), (hi, w2) in product(neighbors(measured[tier],low), neighbors(measured[tier+1],high)):
        for i, value in enumerate(fitted[tier,lo,hi]):
            estimate[i] += value * w1 * w2
    return estimate


chains = {rate: (0, 0.0, [rate], []) for rate in rates_between(measured[1])}
for tier in range(1,10):
    advanced = {}
    for high in rates_between(measured[tier+1]):
        for low, (misses, cost, previous, panel) in sorted(chains.items()):
            first, frags = predict(tier, low, high)
            outside = [max(0,0.55-p,p-0.70) for p in (first,frags)]
            score = sum((p-0.625)**2 + 8*deviation**2 for p,deviation in zip((first,frags),outside))
            candidate = (misses + sum(d > 0 for d in outside), cost + score, previous + [high],
                         panel + [{'tier':tier, 'estimatedFirst':first, 'estimatedFrags':frags}])
            if high not in advanced or candidate[:2] < advanced[high][:2]:
                advanced[high] = candidate
    chains = advanced

misses, cost, rates, panel = chains[850]
with destination.open('x', encoding='utf-8') as file:
    json.dump({'rates': rates, 'nativeApm': dict(enumerate(rates,1)), 'steadyExpert': True, 'safeRoom': 10,
               'estimatedMisses': misses, 'penalty': cost, 'panel': panel, 'cv': scores,
               'rawWeight': raw_weight, 'effectWeight': effect_weight}, file, indent=2)
