"""Print the paired ladder, rival and packaged renderer measurements from the released ledger."""
from collections import defaultdict
import argparse
import gzip
import json
from pathlib import Path
import random
import statistics
from frame_metrics import percentile, planning_gates

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('ledger', nargs='?', type=Path, default=Path(__file__).with_name('evidence.json.gz'))
parser.add_argument('--reviews', nargs='+', type=Path, help='One downloaded response file per independent player')
parser.add_argument('--calibration', action='store_true', help='Also print complete motor-rate selection panels')
args = parser.parse_args()
path = args.ledger
with gzip.open(path, 'rt', encoding='utf-8') as stream:
    ledger = json.load(stream)

if args.reviews:
    completed, yes, plays, seen = 0, 0, [], set()
    for response_path in args.reviews:
        data = json.loads(response_path.read_text(encoding='utf-8'))
        if data.get('studyId') != ledger['reviewVerification']['studyId']:
            raise ValueError(f'The response in {response_path} is for a different set of movement clips')
        signature = json.dumps(data, sort_keys=True)
        if signature in seen:
            raise ValueError(f'Duplicate review in {response_path}')
        seen.add(signature)
        ratings = {r['clip']: r['rating'] for r in data['responses']}
        if set(ratings) == set(range(1,9)) and all(r in ('Yes','No','Unsure') for r in ratings.values()):
            completed += 1
            yes += sum(r == 'Yes' for r in ratings.values())
        if data.get('playFeedback'):
            plays.append(data['playFeedback'])
    percent = 100 * yes / (8 * completed) if completed else 0
    print(f'The blind movement study recorded {completed} complete respondents and {yes}/{8*completed} plausible ratings ({percent:.1f}%).')
    print('Plausibility gate', 'passed' if completed >= 5 and percent >= 70 else 'open')
    for play in plays:
        print(f'Direct play at tier {play["tier"]} received a {play["fun"]} rating. {play["note"]}')


def paired_outcome(control, candidate, criterion):
    old = {r['seed']: criterion(r) for r in control}
    new = {r['seed']: criterion(r) for r in candidate}
    if old.keys() != new.keys():
        raise ValueError('Unpaired opening or defense seeds')
    pairs = [int(new[k]) - int(old[k]) for k in sorted(old)]
    rng = random.Random(20261118)
    samples = [sum(rng.choices(pairs,k=len(pairs))) for _ in range(10000)]
    return (f'{sum(old.values())} → {sum(new.values())}/{len(pairs)}, '
            f'+{pairs.count(1)}/−{pairs.count(-1)}, net {sum(pairs):+d} '
            f'[{percentile(samples,.025):+d}, {percentile(samples,.975):+d}] bags')


for panel in ('scheduledAudit','scheduledSealed'):
    section = ledger['openings']
    print(panel, paired_outcome(section[panel+'Control'], section[panel],
                               lambda run: any(len(fire)-1 >= 4 for fire in run['fires'])))
for metric in ('half','all'):
    section = ledger['defense']
    print('Six-row recovery', metric, paired_outcome(section['scheduledControl'], section['scheduled'],
          lambda run: run[metric] is not None and run[metric] <= 24))


def ladder(rows):
    scores, draws = defaultdict(lambda: defaultdict(list)), defaultdict(int)
    censored, wins = defaultdict(int), defaultdict(int)
    for result in rows:
        task, row = result['task'], result['row']
        tier = task['tier']
        winner = row['winner']
        scores[tier][task['seed']].append(0.5 if winner is None else int(winner == tier + 1))
        draws[tier] += winner is None
        wins[tier] += winner == tier + 1
        censored[tier] += bool(row.get('censored') or (winner is None and 'lost' in row and not any(row['lost'])))
    for tier, seeds in sorted(scores.items()):
        if any(len(points) != 2 for points in seeds.values()):
            raise ValueError(f'Missing seat for tier {tier}')
        pairs = [statistics.mean(points) for _, points in sorted(seeds.items())]
        rng = random.Random(91101 + tier)
        resampled = [100 * sum(rng.choices(pairs, k=len(pairs))) / len(pairs) for _ in range(5000)]
        losses = 2*len(pairs) - draws[tier] - wins[tier]
        print(f'{tier:2d}–{tier+1:<2d}  {100*statistics.mean(pairs):5.2f}%  '
              f'[{percentile(resampled,.025):5.2f}, {percentile(resampled,.975):5.2f}]  '
              f'{wins[tier]} higher wins / {losses} lower wins / {draws[tier]-censored[tier]} draws / '
              f'{censored[tier]} censored')


for name in ('finalFirstKO', 'finalFresh', 'upperConfirmation', 'borderlineFirst', 'finalFrags', 'reservedFrags','finalCommonHands'):
    print('\n' + name)
    ladder(ledger['localMatches'][name])
for name in ('frozen','live','reservedFrozen','reservedLive'):
    races = ledger['localDefaultFrags'][name]
    print(f"\nDefault seven-frag series {name}, {races['adjudication']['rounds']} real rounds")
    ladder(races['races'])
print('\nCompleted series on the reserved bags, active-play minutes at median / p90')
for label, races in [('frozen three',ledger['localMatches']['reservedControl']),
                     ('live three',ledger['localMatches']['reservedFrags']),
                     ('frozen seven',ledger['localDefaultFrags']['reservedFrozen']['races']),
                     ('live seven',ledger['localDefaultFrags']['reservedLive']['races'])]:
    for tier in (None,1,5,9):
        cells = [r['row'] for r in races if tier is None or r['task']['tier']==tier]
        durations = [sum(g['ticksPlayed'] for g in cell['rounds'])/3600
                     for cell in cells if cell['winner'] is not None]
        print(f'{label} {str(tier or "all"):>3}  {len(durations)}/{len(cells)} completed  '
              f'{percentile(durations,.5):.2f} / {percentile(durations,.9):.2f} min')
for policy in ('control','live'):
    for finish in ('three','seven'):
        print(f'\nConfirmation of tier 10 versus 9 on 112501–112600, {policy}, {finish} frags')
        ladder(ledger['upperSeriesConfirmation'][policy][finish])
print('\nFirst KO on the reserved three-frag bags, same 150-second cutoff')
first_rounds = []
for record in ledger['localMatches']['reservedFrags']:
    first = record['row']['rounds'][0]
    first_rounds.append({'task':record['task'], 'row':{
        'winner':first['winner'] if first['ticksPlayed'] <= 9000 else None,
        'censored':first['ticksPlayed'] > 9000 or not any(first['lost'])}})
ladder(first_rounds)


def match_points(rows):
    points = {}
    for sample in rows:
        task = sample['task']
        key = task['tier'], task['seed'], task['swap']
        if key in points:
            raise ValueError(f'Duplicate pairing {key}')
        winner = sample['row']['winner']
        points[key] = 0.5 if winner is None else int(winner == task['tier'] + 1)
    return points


if args.calibration:
    calibration = ledger['localCalibration']
    variants = [('initial', {'Holdout':calibration['heldOut'], 'Races':calibration['frags'],
                 'First':calibration['firstKO'], 'Fresh':calibration['fresh'],
                 'Native120':calibration['native120'], 'Native200':calibration['native200']})]
    variants.extend((name,calibration[name]) for name in ('jointRoofFit','independentFit','smoothFit','judgmentFit',
                                                           'alignedJudgmentFit','expandedFit'))
    for name, variant in variants:
        print('\n' + name)
        for panel in ('Holdout','Races','First','Fresh'):
            points = match_points(variant[panel])
            print(panel, [round(100*statistics.mean(v for k,v in points.items() if k[0] == i),2) for i in range(1,10)])
        for panel in ('Native120','Native200'):
            print(panel, [sum(r['row']['topOut'] for r in variant[panel] if r['task']['tier'] == i) for i in range(1,10)])

match_panels = {**ledger['localMatches'], **{
    'seven-' + name:ledger['localDefaultFrags'][name]['races']
    for name in ('frozen','live','reservedFrozen','reservedLive')}}
for old_name, new_name in [('controlFirstKO', 'finalFirstKO'), ('controlFrags', 'finalFrags'),
                           ('borderlineFirstControl','borderlineFirst'),
                           ('reservedControl','reservedFrags'), ('finalCommonHands','finalFirstKO'),
                           ('seven-frozen','seven-live'), ('seven-reservedFrozen','seven-reservedLive')]:
    old = match_points(match_panels[old_name])
    new = match_points(match_panels[new_name])
    if old.keys() != new.keys():
        raise ValueError('Different bags or seats in ' + new_name)
    print(f'\nIdentical bags and seats, {old_name} → {new_name}')
    for tier in sorted({k[0] for k in old}):
        keys = [k for k in old if k[0] == tier]
        by_bag = defaultdict(list)
        for k in keys:
            by_bag[k[1]].append(new[k]-old[k])
        differences = [statistics.mean(values) for _,values in sorted(by_bag.items())]
        randomizer = random.Random(94101 + tier)
        bootstrap = [100 * sum(randomizer.choices(differences,k=len(differences))) / len(differences) for _ in range(5000)]
        print(f'{tier:2d}–{tier+1:<2d}  {100*statistics.mean(old[k] for k in keys):5.2f}% → '
              f'{100*statistics.mean(new[k] for k in keys):5.2f}%, {len(keys)} matches, '
              f'paired difference [{percentile(bootstrap,.025):+.2f}, {percentile(bootstrap,.975):+.2f}] percentage points')

print('\nNative 120-piece build attribution, forecast / sampled-mistake-enabled / other observed cascades')
for policy, runs in ledger['nativeAttribution'].items():
    print(policy)
    for tier in range(1,11):
        subset = [run for run in runs if run['tier'] == tier]
        print(tier, *[sum(r[k] for r in subset) for k in ('forecast','mistakeEnabled','opportunity')])

print('\nVisible queued rows on adopted moves (correct / pending decisions / immediate clears)')
for name in ('controlFirstKO','beforeLocalStylesFirst','finalFirstKO'):
    by_tier = defaultdict(list)
    for record in ledger['localMatches'][name]:
        for tier, seat in zip(record['row']['tiers'], record['row']['stats'],strict=True):
            by_tier[tier].append(seat)
    def queue_totals(seats):
        return [sum(seat[k] for seat in seats) for k in ('queueSeen','queuedPlans','firedQueued')]
    print(name, 'all', *queue_totals([seat for seats in by_tier.values() for seat in seats]),
          'expert', *queue_totals(by_tier[10]))

print('\nNative 200-piece survival, clear depths and realized rewards')
for name in ('controlScheduled200', 'allScheduled200'):
    print(name, 'tier / deaths / censored / locks / fires of depth 1,2,3,4,5+ / later lines / score and attack per piece')
    for tier in range(1,11):
        runs = [r for r in ledger['longRuns'][name] if r['tier'] == tier]
        locks = sum(r['locks'] for r in runs)
        waves = [fire[1:] for r in runs for fire in r['fires']]
        counts = [sum(min(5,len(fire)) == depth for fire in waves) for depth in range(1,6)]
        later = sum(sum(fire[1:]) for fire in waves)
        lines = sum(map(sum,waves))
        deaths = sum(r['topOut'] for r in runs)
        print(f'{tier:2d}  {deaths:2d}/{len(runs)-deaths:2d}  {locks:4d}  {counts}  {later}/{lines}  '
              f'{sum(r["score"] for r in runs)/locks:.1f}  {sum(r["attack"] for r in runs)/locks:.3f}')

print('\nFresh proxy wins, frozen → live, and paired flips')
def encounters(rows):
    return {(r['id'], r['cadence'], r['profile'], r['seed']): r['outcome'] == 'win' for r in rows}


for control_name, live_name in [('historicalControl', 'finalHistorical'), ('disjointControl', 'finalFresh'),
                                ('confirmationControl', 'finalConfirmation'),
                                ('novaRepeatControl', 'novaRepeatLive')]:
    control = encounters(ledger['rivals'][control_name])
    live = encounters(ledger['rivals'][live_name])
    if live.keys() != control.keys():
        raise ValueError('Unmatched human-pace panel ' + live_name)
    print(live_name)
    for orb, cadence in sorted({key[:2] for key in live}):
        keys = [k for k in live if k[:2] == (orb, cadence)]
        gain = sum(live[k] and not control[k] for k in keys)
        loss = sum(control[k] and not live[k] for k in keys)
        print(f'{orb:2d} {cadence:<7}  {sum(control[k] for k in keys):2d} → '
              f'{sum(live[k] for k in keys):2d}/{len(keys)}  +{gain}/−{loss}')

def missed_by_segment(run, segments):
    intervals = run['intervals']
    width = sum(intervals) / segments
    threshold = 2000/run['requestedHz'] - .25
    counts = [0] * segments
    elapsed = 0
    for dt in intervals:
        elapsed += dt
        if dt >= threshold:
            counts[min(segments-1, int(elapsed/width))] += 1
    return counts


print('\nPackaged render. Requested, median and mean delivered Hz (live/replay), planning and whole active '
      'bot updates on planning frames p95/p99/max in ms, maximum on other frames, first-plan and recovery p95, '
      'over-frame planning/active/other, long display intervals '
      'live/replay (>2 frames + 0.25 ms), all two-refresh intervals live/replay (≥2 frames − 0.25 ms), '
      'two-refresh intervals overlapping planning, matching labelled-board checks, '
      'roughly one-minute segments with more two-refresh intervals live than on replay, '
      'median system CPU live/replay with the number of half-minute samples')
frame_gates = defaultdict(list)
reference = ledger['rendererReference']
host_load = defaultdict(list)
for sample in ledger['referenceHostLoad']:
    host_load[sample['capture']].append(sample['systemBusy'])
for name, run in sorted(ledger['renderer'].items()):
    if not name.startswith((reference+'-render-', reference+'-mixed-')) or name.endswith('-replay'):
        continue
    tape = ledger['renderer'][name + '-replay']
    hz = run['requestedHz']
    def costs(key):
        return '/'.join(f'{percentile(run[key],q):.1f}' for q in (.95, .99, 1))
    def checks(r):
        return {(x[0], x[1]): x[2:] for x in r['checks']}
    a, b = checks(run), checks(tape)
    shared = a.keys() & b.keys()
    stalls = [sum(ms > 2000/hz + .25 for ms in r['intervals']) for r in (run, tape)]
    missed = [r['stalls'] + r['nearTwoFrames'] for r in (run,tape)]
    median = '/'.join(f'{1000/statistics.median(r["intervals"]):.0f}' for r in (run, tape))
    mean = '/'.join(f'{1000/statistics.mean(r["intervals"]):.1f}' for r in (run, tape))
    segments = 10 if name.startswith(reference+'-render-') else 2
    live_segments, tape_segments = (missed_by_segment(r,segments) for r in (run,tape))
    excess_segments = sum(a>b for a,b in zip(live_segments,tape_segments,strict=True))
    busy_samples = [host_load[key] for key in (name, name+'-replay')]
    load_text = ' / '.join(f'{statistics.median(values):.1%} ({len(values)})' if values else 'unobserved'
                           for values in busy_samples)
    print(f'{name:<25} {hz:3d} {median:<7} {mean:<11} {costs("times"):<15} {costs("activeUpdates"):<15} '
          f'{run["maxExecutionUpdate"]:5.1f} '
          f'{percentile(run["lateness"],.95):5.1f} {percentile(run["recoveries"],.95):5.1f} '
          f'{sum(x>1000/hz for x in run["times"])}/{sum(x>1000/hz for x in run["activeUpdates"])}/'
          f'{run["executionOverFrame"]}  '
          f'{stalls[0]}/{stalls[1]}  {len(missed[0])}/{len(missed[1])}  '
          f'{sum(event[4]>0 for event in missed[0])}/{len(missed[0])}  '
          f'{sum(a[k]==b[k] for k in shared)}/{len(shared)}  {excess_segments}/{segments}  {load_text}')
    if name.startswith(reference+'-render-'):
        gates = planning_gates(run)
        gates['no extra two-refresh display intervals'] = len(missed[0]) <= len(missed[1])
        gates['all frame gates'] = all(gates.values())
        for measure,passed in gates.items():
            frame_gates[measure].append((name,passed))
for measure, observations in frame_gates.items():
    failed = [name for name,passed in observations if not passed]
    print(f'{measure}  {len(observations)-len(failed)}/{len(observations)}')
    if failed:
        print('  Outside the gate in ' + ', '.join(failed))

print('\nPresentation clock trial after the background game workers finished')
for room,condition in ledger['presentationClockTrial']['conditions'].items():
    result = condition['results']
    print(room, 'advanced' if result['advance'] else 'kept timer')
    for r in result['rows']:
        print(f"{r['clock']} pass {r['pass']}  planning p95/p99/max {r['p95']:.1f}/{r['p99']:.1f}/{r['maximum']:.1f} ms  "
              f"two-refresh live/replay {r['liveMisses']}/{r['tapeMisses']}  "
              f"system CPU {r['liveBusy']:.0%}/{r['tapeBusy']:.0%}  "
              f"common {r['matchedInputs']} inputs and {r['matchedClockChecks']} labelled boards")


print('\nPressure fixtures, six boards per condition. p95 / p99 / maximum update in ms and worst first-plan lateness')
def pressure_order(row):
    return row['tier'], row['kind'], row['hz'], row['repeat'], row.get('clock',''), row.get('prepare',False)


for version,group in [('control',ledger['roofTriggerSearch']), ('candidate',ledger['betweenTickSearch'])]:
    for row in sorted(group['pressure']['rows'],key=pressure_order):
        costs = ' / '.join(f'{percentile(row["times"],p):.1f}' for p in (.95,.99,1))
        clock = ('prepared' if row['prepare'] else 'fixed') if 'prepare' in row else 'isolated'
        print(f"{version:<9} {clock:<8} T{row['tier']:<2} {row['kind']:<9} {row['hz']:3d} Hz, "
              f"pass {row['repeat']+1}, {costs} ms, {max(row['latencies'])} ms late")

profile = ledger['fourExpertThreadSamples']['events']
source_locations = ledger['fourExpertThreadSamples']['sourceLocations']['sources']
def readable_sample(location):
    source = source_locations.get(location)
    return f"{source['file']}:{source['line']}" if source else location


print(f"\nFour-expert renderer profile, {profile['sampleCount']:,} samples at {profile['sampleIntervalUs']} µs. "
      f"{len(profile['events'])} over-frame planning updates, {len(profile['wholeUpdates'])} over-frame bot updates.")
for event in profile['longestDisplayIntervals']:
    locations = [(readable_sample(key), count) for key,count in list(event['sampledLocations'].items())[:3]]
    print(f"Round {event['round']}, tick {event['tick']}, interval {event['ms']:.1f} ms, "
          f"planning {event['planningMs']:.1f} ms, {event['samples']} samples, "
          f"largest unsampled gap {event['largestUnsampledMs']:.1f} ms, most frequent locations {locations}")

drop = ledger['fourExpertThreadSamples']['hardDropEffectTrial']['results']
print(f"\nCold hard-drop effects in four real boards, {drop['commands']} common inputs and {drop['boards']} labelled checks.")
for r in drop['rows']:
    print(f"Pass {r['pass']} {r['name']}, first kit {r['firstCold']:.1f} ms, first effect {r['firstDrop']:.1f} ms, "
          f"median first effect across four seats {r['medianFirstDrop']:.1f} ms, {r['overFrame']}/4 over a frame.")
