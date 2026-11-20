"""Pack the paired rebuild ledger from a measurement directory and its campaign verdicts."""
import gzip
import hashlib
import json
from difflib import unified_diff
from io import TextIOWrapper
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile

source, output = map(Path, sys.argv[1:])
ledger = {'control': '8dc68d825db61bc04e1cfb4e4c5a1f580ea3e138', 'date': '2026-11-20'}


def read(name):
    path = source / name
    with path.open(encoding='utf-8') as stream:
        if path.suffix == '.jsonl':
            return list(map(json.loads, stream))
        return json.load(stream)


panels = {
    'openings': {'noLegalTriggers': 'nopot2', 'withLegalTriggers': 'full2', 'selectedWeights': 'fitted',
                 'wideSearch': 'v16', 'liveBudget': 'proofOpen', 'sealedControl': 'sealed-legacy', 'sealedLive': 'sealed-live',
                 'scheduledAudit': 'liveAuditOpen', 'scheduledSealed': 'liveSealedOpen',
                 'scheduledAuditControl': 'nativeOpenControl', 'scheduledSealedControl': 'nativeSealControl'},
    'training': {'jointFit': 'fit', 'earlyAttack': 'finalLong', 'sustainedAttack': 'proofLong'},
    'defense': {'queueOnly': 'dig0', 'rewardExposedHoles': 'dig1', 'live': 'payQueue', 'visibleTriggerTest': 'recall',
                'discardProvedShot': 'ship-pressure-aware', 'blindToQueue': 'payBlind',
                'scheduled': 'scheduledDig', 'scheduledBlind': 'scheduledBlind', 'scheduledControl': 'scheduledControl'},
    'longRuns': {'allTiers120': 'release120', 'tier3Release120': 'roof3orig', 'tier6Release120': 'cal3orig',
                 'control200': 'valid-legacy', 'allTiers200': 'longRelease', 'tier3Release200': 'survivalT3roof',
                 'tier6Release200': 'survivalCal3', 'scheduled120': 'ship-native120', 'scheduled120Control': 'native120Control',
                 'scheduled200': 'ship-native200', 'scheduled200Control': 'native200Control',
                 'beforeLocalStyles120': 'ship-all-native120', 'beforeLocalStyles200': 'ship-all-native200',
                 'allScheduled120': 'production-native120', 'allScheduled200': 'production-native200',
                 'controlScheduled120': 'oldNativeAll120', 'controlScheduled200': 'oldNativeAll200',
                 'shortenedSearch200': 'optimizedLong', 'lateSpawnDefense200': 'spawnRoom200',
                 'earlierSpawnDefense200': 'earlyRoom200', 'fullCleanSearch200': 'safeClean200',
                 'final120': 'ship-120', 'final200': 'ship-200', 'freshSpawnDefense': 'ship-extra-200'},
    'localMatches': {'firstKO': 'canonicalLadder', 'tier3Release': 'canonicalSafe', 'freshBorderline': 'canonicalFresh',
                     'commonPace': 'finalCommon', 'fullFrag': 'frag600', 'paceTrial': 'fragTempo', 'styleTrial': 'fragStyles',
                     'fullProfiles': 'fragProfiles', 'priorFirstKO': 'nativeMain', 'priorFresh': 'nativeExtra',
                     'controlFirstKO': 'oldPairedLadder', 'controlFrags': 'oldPairedFrags',
                     'executionStyle': 'executionStyle', 'executionStyleFirstKO': 'executionStyleKO',
                     'boundedTempo': 'boundedTempoFirst', 'boundedTempoFresh': 'boundedTempoFresh',
                     'boundedTempoFrags': 'boundedTempoRaces', 'compactTempo': 'compactFirst', 'compactFrags': 'compactFull',
                     'widerTempo': 'rallyFirst', 'widerTempoFrags': 'rallyFull',
                     'judgmentStyles': 'centeredFirst', 'judgmentStyleFrags': 'centeredRaces',
                     'beforeLocalStylesFirst': 'ship-first', 'beforeLocalStylesFresh': 'ship-fresh',
                     'beforeLocalStylesFrags': 'ship-frags', 'beforeLocalStylesUpper': 'upperHoldout',
                     'finalFirstKO': 'production-first', 'finalFresh': 'production-fresh',
                     'finalFrags': 'production-frags', 'reservedFrags': 'production-reserved',
                     'reservedControl': 'production-reserved-control', 'finalCommonHands': 'production-common',
                     'borderlineFirst': 'first-borderline-repeat', 'borderlineFirstControl': 'first-borderline-control',
                     'upperConfirmation': 'production-upper'},
    'rivals': {'originalTierTrialA': 'rvFinalA', 'originalTierTrialB': 'rvFinalB', 'historicalEarly': 'fixedD8Early',
               'willowRemap': 'willow2', 'historicalLate': 'finalD8Late', 'selectionA': 'fixedD8A',
               'selectionB': 'fixedD8B', 'selectionC': 'fixedD8C', 'prismD': 'prismD', 'prismE': 'prismE',
               'disjointControl': 'd8freshControl', 'disjointEarly': 'freshEarly', 'disjointWillowNeon': 'freshWillowNeon',
               'disjointNovaPrism': 'freshNovaPrism', 'finalHistorical': 'ship-rival-history',
               'finalFresh': 'ship-rival-fresh', 'finalConfirmation': 'ship-rival-confirm',
               'confirmationControl': 'lateBlindControl', 'novaRepeatControl': 'novaRepeatControl',
               'novaRepeatLive': 'novaRepeatLive', 'fixedBudgetLate': 'tickBalanceC',
               'calmAndPressure': 'judgmentA', 'alternativePressure': 'judgmentB',
               'opponentPressureA': 'finishA', 'opponentPressureB': 'finishB'},
    'appearance': {'initialMovement': 'canonicalMovement', 'beforeLocalStyles': 'ship-movement', 'movement': 'production-movement-final'},
    'goals': {'candidate': 'goalO', 'control': 'goalC'},
    'attribution': {'tier1': 'attribution1', 'tier2': 'attribution2', 'tier10': 'ship-attribute10'},
}
for section, files in panels.items():
    ledger[section] = {key: read(file + '.jsonl') for key, file in files.items()}
for name in ('allScheduled120','allScheduled200','controlScheduled120','controlScheduled200',
             'beforeLocalStyles120','beforeLocalStyles200'):
    ledger['longRuns'][name] = [record['row'] for record in ledger['longRuns'][name]]
audit = Path(__file__).resolve().parent.parent / 'bot-ai-audit-2026-11' / 'evidence.json.gz'
with gzip.open(audit, 'rt', encoding='utf-8') as original:
    historical = json.load(original)
ledger['rivals']['historicalControl'] = [
    {**row, 'id': row['levelId']} for row in historical['rivals']]
ledger['setupTrial'] = read('pattern-trial.json')
ledger['rivalCalibration'] = {}
for variant, samples in {'judgmentA': ['judgmentA', 'judgmentFresh'], 'finishA': ['finishA', 'finishFreshA'],
                         'novaPressure': ['novaPressure'], 'smallFinish': ['smallFinish', 'smallFinishFresh'],
                         'strongLook': ['strongLook', 'strongLookFresh'], 'middleReading': ['middleReading'],
                         'steadyReading': ['steadyReading'], 'extra-neon': ['extraNeon']}.items():
    ledger['rivalCalibration'][variant] = {'settings': read(variant + '.opt'),
                                         'runs': [row for sample in samples for row in read(sample + '.jsonl')]}
ledger['openings']['scheduledAudit'] = read('final-audit-open.jsonl')
ledger['openings']['scheduledSealed'] = read('final-sealed-open.jsonl')
ledger['coldProcessReplay'] = read('production-cold.json')
ledger['coldProcessBeforeLocalStyles'] = read('measured-cold.json')
ledger['timingFixtures'] = {'beforeAlignments': read('fixture1.json'), 'afterAlignments': read('alignTime.json'),
                            'readyBeforeExecution': read('readyTime.json'), 'localWorkLimit': read('finalFixture.json'),
                            'initialPressure': read('pressureTiming.json'), 'slicedPressure': read('stressSliced.json'),
                            'roofAndInfinity': read('stressFinal.json'), 'cleanRoofFullSearch': read('roofBefore.json'),
                            'cachedMovement': read('roofMemo.json'), 'beforeSettleOptimization': read('true-pressure.json'),
                            'afterSettleOptimization': read('measured-pressure.json'), 'afterColumnOptimization': read('final-pressure.json'),
                            'finalPressure': read('release-pressure.json'),
                            'firstSliceTrial': read('ramped-pressure.json')}
ledger['settleCost'] = {'profile': read('settle-hotspots.json'), 'stages': read('settle-speed.json'),
                        'production': read('final-settle-cost.json')}
for method, label in zip(ledger['settleCost']['production']['methods'], ('control', 'feature'), strict=True):
    method['path'] = label
ledger['settleCost']['alternativeFalls'] = read('vertical-settle-cost.json')
for method, label in zip(ledger['settleCost']['alternativeFalls']['methods'],
                         ('selected', 'multiRowDrop', 'verticalConstraints'), strict=True):
    method['path'] = label
ledger['sharedSearch'] = {'observations': read('shared-observations.json'), 'rounds': read('shared-expert-rounds.json')}
ledger['columnCost'] = {'stages': read('column-search-cost.json'), 'production': read('final-column-cost.json')}
for method, label in zip(ledger['columnCost']['production']['methods'], ('control', 'feature'), strict=True):
    method['path'] = label
ledger['columnBound'] = {'cellCountLimit': read('capacity-bound-cost.json'), 'perColumnLimit': read('min-column-bound-cost.json'),
                         'production': read('bound-production-cost.json'), 'storageTrial': read('probe-storage-cost.json'),
                         'visibleReleaseChecks': read('bound-recall.jsonl'), 'isolatedPressure': read('bound-pressure.json')}
ledger['columnBound']['retainedQuietBoards'] = read('reuse-quiet-cost.json')
ledger['columnBound']['garbageOnly'] = read('debris-only-cost.json')
ledger['columnBound']['garbageCover'] = read('debris-total-cost.json')
ledger['columnBound']['landingGeometry'] = read('landing-shapes-cost.json')
ledger['columnBound']['settledFragments'] = read('stable-support-cost.json')
ledger['columnBound']['fragmentSearch'] = read('fragment-search-cost.json')
ledger['roofTriggerSearch'] = {
    'allCandidatePoses': read('target-production-oracle.json'),
    'wholeSearch': read('target-production-search.json'),
    'rotatedAlternatives': read('paired-ffa-slice-stages.json'),
    'rotatedProduction': read('paired-ffa-slice-production.json'),
    'originalSpikes': read('matched-slices-three.json'),
    'originalFourSeats': read('matched-slices-1-4-165.json'),
    'wholeUpdateReplay': read('targeted-active-window.json'),
    'pressure': read('targeted-pressure.json'),
}
ledger['beamPruning'] = {
    'rankBound': read('beam-floor-cost.json'),
    'deferredCopies': read('deferred-copy-cost.json'),
    'singleExpertReplay': read('single-beam-cost.json'),
}
for key, labels in [('rankBound', ['control','initialFloor','refinedFloor','elidedAllocation']),
                    ('deferredCopies', ['control','deferredMove','deferredLabels','combined'])]:
    for method, label in zip(ledger['beamPruning'][key]['methods'], labels, strict=True):
        method['path'] = label
ledger['betweenTickSearch'] = {room: read(room+'-idle-steps.json') for room in ('single','three','four')}
ledger['betweenTickSearch']['recordedFrameComparisons'] = {
    n:read('prefetched-frame-ab-'+n+'.json') for n in ('1','3','4')}
ledger['betweenTickSearch']['pressure'] = read('prefetched-pressure.json')
for method, label in zip(ledger['roofTriggerSearch']['wholeSearch']['methods'], ('before','after'), strict=True):
    method['path'] = label
for variant, labels in [('cellCountLimit', ('control','virtual','both')), ('perColumnLimit', ('control','fullScan','earlyExit')),
                        ('production', ('control','feature')), ('storageTrial', ('control','borrowedStorage','fewerExtents')),
                        ('retainedQuietBoards', ('selected','incrementalQuiet','garbageRow','both')),
                        ('garbageOnly', ('selected','garbageRow','incrementalCover')),
                        ('garbageCover', ('selected','incrementalCover')),
                        ('landingGeometry', ('selected','bottomPerColumn','integerPosition','indexedTrigger','combined')),
                        ('settledFragments', ('selected','stationary','floor','readOwner','movedOnly')),
                        ('fragmentSearch', ('selected','readOwner'))]:
    for method, label in zip(ledger['columnBound'][variant]['methods'], labels, strict=True):
        method['path'] = label
seed_file = source / 'sealed-seeds.txt'
ledger['sealedSeeds'] = {'sha256': hashlib.sha256(seed_file.read_bytes()).hexdigest(), 'list': seed_file.read_text().splitlines()}
ledger['renderer'] = {path.stem: read(path.name) for pattern in ('matched-3-60*.json', 'release-1-3-60*.json', 'rated-*.json', 'duelclock-*.json', 'candidate-*.json')
                      for path in sorted(source.glob(pattern))}
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('ship-render-*.json'))})
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('final-render-*.json'))})
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('stable-render-*.json'))})
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('shared-render-*.json'))})
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('capacity-render-*.json'))})
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('bound-pair-*.json'))})
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('production-mixed-*.json'))})
for prefix in ('targeted-render-', 'targeted-mixed-', 'prefetched-render-', 'prefetched-mixed-'):
    ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob(prefix+'*.json'))})
ledger['roofTriggerSearch']['renderedSpikes'] = {
    path.stem: read(path.name) for path in sorted(source.glob('targeted-slices-*.json'))
    if path.stem != 'targeted-slices-complete'}
ledger['betweenTickSearch']['renderedSpikes'] = {
    path.stem:read(path.name) for path in sorted(source.glob('prefetched-slices-*.json'))
    if path.stem != 'prefetched-slices-complete'}
if len(ledger['betweenTickSearch']['renderedSpikes']) != 8 or read('prefetched-slices-complete.json')['errors']:
    raise ValueError('Missing local frame-window replays')
ledger['renderer'].update({path.stem: read(path.name) for path in sorted(source.glob('background-*.json'))
                           if path.stem.startswith(('background-render-','background-mixed-'))})
ledger['capturePriorityAudit'] = read('capture-priority-audit.json')
host_samples = read('reference-host-load.jsonl') + read('prefetched-host-load.jsonl')
interruption = read('nov20-interrupted-render.json')
completed_samples, interrupted_samples = [], []
for sample in host_samples:
    if sample['capture'] == interruption['capture'] and sample['toUtc'] < interruption['resumedProcessUtc']:
        interrupted_samples.append(sample)
    else:
        completed_samples.append(sample)
interruption['earlierHostLoad'] = interrupted_samples
ledger['rendererInterruptions'] = [interruption]
ledger['referenceHostLoad'] = completed_samples
ledger['rendererReference'] = 'prefetched'
ledger['presentationClockTrial'] = {
    'protocol':(source/'display-clock-protocol.txt').read_text(encoding='utf-8-sig'),
    'conditions':{},
}
previous_clock_qualified = True
for count, rate in [(4,165),(1,165),(3,60)]:
    folder = f'clock-comparison-{count}-{rate}'
    if not previous_clock_qualified:
        if (source/folder).exists():
            raise ValueError('Run found outside the clock comparison selection protocol')
        continue
    result = read(folder+'/summary.json')
    cases = {name:read(folder+'/'+name+'.json') for clock in ('timer','display') for p in (1,2)
             for name in (f'{clock}-{p}',f'{clock}-{p}-replay')}
    if len(result['rows'])!=4 or result['seats']!=count or result['hz']!=rate or result['duration']!=120:
        raise ValueError('Incomplete presentation clock trial in '+folder)
    for row in result['rows']:
        name = row['clock']+'-'+str(row['pass'])
        live,tape = cases[name],cases[name+'-replay']
        missed = lambda r:len(r['stalls'])+len(r['nearTwoFrames'])
        if (any(run['buildManifestSha256']!=result['manifest'] or run['requestedHz']!=rate
                or run['runtime']['mainPriority']!=0 for run in (live,tape))
                or row['liveMisses']!=missed(live) or row['tapeMisses']!=missed(tape)
                or row['excess']!=missed(live)-missed(tape) or not row['matchedInputs'] or not row['checks']):
            raise ValueError('Invalid presentation clock observations in '+name)
    ledger['presentationClockTrial']['conditions'][folder] = {'results':result,'recordings':cases}
    previous_clock_qualified = result['advance']
ledger['renderer']['rival-retry-smoke'] = read('rival-retry-smoke.json')
ledger['plannerCpuSamples'] = read('planner-overruns.json')
ledger['fourExpertThreadSamples'] = {
    'recording':read('prefetched-four-sampled.json'),
    'events':read('prefetched-four-profile-costs.json'),
    'sourceLocations':read('prefetched-four-sources.json'),
    'timelineSha256':hashlib.sha256((source/'prefetched-four-thread-profile.json').read_bytes()).hexdigest(),
}
profile = ledger['fourExpertThreadSamples']
if (profile['recording']['buildManifestSha256'] != profile['events']['buildManifestSha256']
        or profile['sourceLocations']['manifest'] != profile['recording']['buildManifestSha256']):
    raise ValueError('Mismatched build in sampled renderer activity')
for chunk, digest in profile['sourceLocations']['chunks'].items():
    if hashlib.sha256((source/'prefetched-matrix-dist'/'assets'/chunk).read_bytes()).hexdigest() != digest:
        raise ValueError('Different JavaScript for a mapped CPU sample in ' + chunk)
packaged_assets = source/'prefetched-matrix-dist'/'assets'
mapped_assets = source/'prefetched-profile-maps'/'assets'
chunks = {p.name for p in packaged_assets.glob('*.js')}
if chunks != {p.name for p in mapped_assets.glob('*.js')} or any(
        (packaged_assets/name).read_bytes() != (mapped_assets/name).read_bytes() for name in chunks):
    raise ValueError('Diagnostic source-map build changed the packaged JavaScript')
profile['sourceLocations']['byteIdenticalJavaScriptChunks'] = len(chunks)
kit_source = (source/'ring-original.mjs').read_text(encoding='utf-8')
drop = profile['hardDropEffectTrial'] = {
    'protocol':(source/'four-drop-protocol.txt').read_text(encoding='utf-8'),
    'kitFile':'src/rendering/phaser/fx/fx-kit.js',
    'controlSha256':hashlib.sha256(kit_source.encode()).hexdigest(),
    'variants':{name:''.join(unified_diff(kit_source.splitlines(keepends=True),
                (source/f'ring-{name}.mjs').read_text(encoding='utf-8').splitlines(keepends=True),
                fromfile='ring-original.mjs',tofile=f'ring-{name}.mjs')) for name in ('mirror','cached')},
    'harness':{name:(source/name).read_text(encoding='utf-8') for name in
               ('ring-first-use.mjs','drop-observer.mjs','four-drop-trial.cjs')},
    'coldV8':read('ring-cold-cost.json'),
    'results':read('four-drop-trial/summary.json'),
    'recordings':{f'{name}-{p}':read(f'four-drop-trial/{name}-{p}.json')
                  for name in ('original','cached') for p in (1,2)},
}
if len(drop['coldV8']['rows']) != 72 or len({r['digest'] for r in drop['coldV8']['rows']}) != 1:
    raise ValueError('Different pixel results across the first-use CPU comparisons')
pixels = drop['recordings']['original-1']['dropEffects']['pixels'][0]
for r in drop['results']['rows']:
    raw = drop['recordings'][f"{r['name']}-{r['pass']}"]
    costs = raw['dropEffects']
    if (len(pixels) != 9 or costs['pixels'] != [pixels]*4 or len(costs['inputs']) != 32 or len(costs['cold']) != 4
            or costs['inputs'][0]['ms'] != r['firstDrop'] or costs['cold'][0]['ms'] != r['firstCold']
            or raw['buildManifestSha256'] != profile['recording']['buildManifestSha256']):
        raise ValueError('Different real-game texture or first-drop measurements')
ledger['campaign'] = {}
ledger['campaignRuleReplay'] = {'historical': read('history-refit.jsonl'), 'priorGarbageSettle': read('history-prior-settle.jsonl'),
                                'frozenWallRetry': read('gate-wall-retry.jsonl') + [
                                    row for path in sorted(source.glob('frozen-*-retry.jsonl')) for row in read(path.name)]}
ledger['reviewVerification'] = read('study-production-check.json')
ledger['raceParity'] = read('race-production.json')
ledger['releasePolicy'] = read('release-policy.json')
ledger['localDefaultFrags'] = {}
for name,file in [('live','default-seven-live'),('frozen','default-seven-frozen'),
                  ('reservedLive','reserved-seven-live'),('reservedFrozen','reserved-seven-frozen')]:
    ledger['localDefaultFrags'][name] = {'races':read(file+'.jsonl'), 'adjudication':read(file+'-check.json')}
ledger['localDefaultFrags']['prefixVerification'] = {
    name:{method:read('seven-'+name+'-'+method+'.jsonl') for method in ('direct','continued')} for name in ('old','live')}
ledger['localDefaultFrags']['protocol'] = (source/'default-seven-protocol.txt').read_text(encoding='utf-8-sig')
ledger['localDefaultFrags']['training'] = read('training-seven.jsonl')
ledger['localDefaultFrags']['trainingComparison'] = read('training-seven-selection.json')
ledger['localDefaultFrags']['trainingDecision'] = read('seven-alternative-result.json')
ledger['upperSeriesConfirmation'] = {'protocol':(source/'upper-series-protocol.txt').read_text(encoding='utf-8')}
for policy in ('control','live'):
    ledger['upperSeriesConfirmation'][policy] = {
        'three':read('upper-series-'+policy+'-three.jsonl'),
        'seven':read('upper-series-'+policy+'-seven.jsonl'),
        'scoreboard':read('upper-series-'+policy+'-check.json')}
ledger['localDefaultFrags']['selectionRecords'] = {
    path.stem: read(path.name) for path in sorted(source.glob('seven-selection-*.jsonl'))}
ledger['beforeBetweenTickVerification'] = read('release-checks.json')
ledger['verification'] = read('prefetched-checks.json')
instrument = read('instrument-entry-orb49/raw.jsonl')
instrument_revision = read('instrument-entry-orb49/config.json')['revision']
if (int((source/'instrument-entry.exit').read_text()) != 0 or instrument_revision['head'] != ledger['control']
        or len(instrument) != 1 or instrument[0]['levelId'] != 49 or instrument[0]['seed'] != 40
        or instrument[0]['outcome'] != 'win'):
    raise ValueError('The published frozen benchmark command did not reproduce its control')
ledger['verification']['frozenCommand'] = {'revision':instrument_revision, 'record':instrument[0]}
ledger['nativeAttribution'] = {'frozen': read('intent-strict-control.jsonl'), 'live': read('intent-production.jsonl')}
ledger['localCalibrationProtocol'] = (source / 'ladder-protocol.txt').read_text(encoding='utf-8-sig')
ledger['borderlineFirstProtocol'] = (source / 'first-borderline-protocol.txt').read_text(encoding='utf-8-sig')
ledger['localCalibration'] = {
    'training': read('jointLadderFit.jsonl'), 'selection': read('fit-ladder.opt'),
    'heldOut': read('fitHoldout.jsonl'), 'firstKO': read('fitFirst.jsonl'), 'fresh': read('fitFresh.jsonl'),
    'frags': read('fitRaces.jsonl'), 'native120': read('fitNative120.jsonl'), 'native200': read('fitNative200.jsonl'),
    'roofTraining': read('jointRoofFit.jsonl'), 'roofTrial120': read('roofStyleShort.jsonl'),
    'roofTrial200': read('roofStyleSurvival.jsonl'),
}
for fit in ('jointRoofFit', 'independentFit'):
    ledger['localCalibration'][fit] = {
        'training': read(fit + '.jsonl'), 'selected': read(fit + '.opt'),
        **{panel: read(fit + panel + '.jsonl') for panel in ('Holdout','Races','First','Fresh','Native120','Native200')},
    }
ledger['localCalibration']['smoothFit'] = {'selected': read('smoothFit.opt'),
    **{p: read('smoothFit' + p + '.jsonl') for p in ('Holdout','Races','First','Fresh','Native120','Native200')}}
for fit in ('judgmentFit', 'alignedJudgmentFit'):
    ledger['localCalibration'][fit] = {'training': read(fit + '.jsonl'), 'selected': read(fit + '.opt'),
        **{p: read(fit + p + '.jsonl') for p in ('Holdout','Races','First','Fresh','Native120','Native200')}}
ledger['localCalibration']['expandedFit'] = {'additionalTraining': read('balancedHandTraining.jsonl'),
    'sharedTraining': 'alignedJudgmentFit', 'selected': read('expandedFit.opt'),
    **{p: read('expandedFit' + p + '.jsonl') for p in ('Holdout','Races','First','Fresh','Native120','Native200')}}
ledger['localCalibration']['alignedLanding'] = {
    'settings': read('align-hand.opt'), 'training': read('alignHandsTrain.jsonl'),
    'native120': read('alignHandsNative120.jsonl'), 'native200': read('alignHandsNative200.jsonl'),
    'widerSettings': read('align-broad.opt'), 'widerTraining': read('broadAlignedTrain.jsonl'),
    'widerNative200': read('broadAlignedSurvival.jsonl'), 'widerNative120': read('broadAlignedNative120.jsonl'),
    'widerHoldout': read('broadAlignedHoldout.jsonl'), 'widerFirst': read('broadAlignedFirst.jsonl'),
    'widerRaces': read('broadAlignedRaces.jsonl'),
}
ledger['rivalMatchPoint'] = {'protocol': (source / 'match-point-protocol.txt').read_text(encoding='utf-8-sig'),
                             'authored': read('matchPointA.jsonl'), 'earlierAttack': read('matchPointB.jsonl'),
                             'prismFollowup': read('prismMatchPoint.jsonl'), 'prismFrozen': read('prismPointReference.jsonl'),
                             'prismOrdinaryRepeat': read('prismPointAuthored.jsonl')}
ledger['novaRepeatProtocol'] = (source / 'nova-repeat-protocol.txt').read_text(encoding='utf-8')
for name in ('archive-crosscheck', 'frozen-gates', 'remapped-gates'):
    path = source / name
    ledger['campaign'][name] = {'verdict': (path / 'gates.txt').read_text(encoding='utf-8'), 'orbs': read(name + '/final.json')}
    if name != 'archive-crosscheck':
        ledger['campaign'][name]['raw'] = read(name + '/all15.jsonl')
        ledger['campaign'][name]['levels'] = read(name + '/levels.json')
release = read('release-gates/all15.jsonl')
previous = ledger['campaign']['remapped-gates']['raw']
def attempt_key(r):
    return r['levelId'], r['profileId'], r['cadenceId'], r['seed']
def gameplay(r):
    return {k: v for k, v in r.items() if k != 'wallMs'}
old = {attempt_key(r): gameplay(r) for r in previous}
differences = [attempt_key(r) for r in release if gameplay(r) != old[attempt_key(r)]]
ledger['campaign']['finalRivalRepeat'] = {'rawRivals': read('release-campaign-rivals.jsonl'),
    'verdict': (source / 'release-gates/gates.txt').read_text(encoding='utf-8'),
    'orbs': read('release-gates/final.json'), 'gameplayDifferences': differences}
targeted_campaign = read('targeted-gates/all15.jsonl')
ledger['campaign']['afterRoofTriggerSearch'] = {
    'rawRivals': read('targeted-campaign-rivals.jsonl'),
    'verdict': (source / 'targeted-gates/gates.txt').read_text(encoding='utf-8'),
    'orbs': read('targeted-gates/final.json'),
    'gameplayDifferences': [attempt_key(r) for r in targeted_campaign if gameplay(r) != old[attempt_key(r)]]}
prefetched_campaign = read('prefetched-gates/all15.jsonl')
ledger['campaign']['afterBetweenTickSearch'] = {
    'rawRivals':read('prefetched-campaign-rivals.jsonl'),
    'verdict':(source/'prefetched-gates/gates.txt').read_text(encoding='utf-8'),
    'orbs':read('prefetched-gates/final.json'),
    'gameplayDifferences':[attempt_key(r) for r in prefetched_campaign if gameplay(r) != old[attempt_key(r)]]}


def require_count(records, expected, identifier, label):
    identities = {identifier(record) for record in records}
    if len(records) != expected or len(identities) != expected:
        raise ValueError(f'{label} contains {len(records)} records and {len(identities)} identities, expected {expected}')


def pairing(record):
    task = record['task']
    return task['tier'], task['seed'], task['swap']


def identical_panel(name, source_records, replay_records, key, expected):
    for records in (source_records, replay_records):
        require_count(records, expected, key, name)
    original = {key(r):r for r in source_records}
    actual = {key(r):r for r in replay_records}
    if actual != original:
        raise ValueError('Different replay outcomes in ' + name)
    encoded = json.dumps([actual[k] for k in sorted(actual)],sort_keys=True,separators=(',',':')).encode()
    return {'rows':expected, 'sha256':hashlib.sha256(encoded).hexdigest()}


original_prefix = ledger['localMatches']['controlFrags']
timed_prefix = read('oldFullPrefixTicks.jsonl')
require_count(timed_prefix,360,pairing,'original first twenty bags with round ticks')
timed = {pairing(r):r['row'] for r in timed_prefix}
for record in original_prefix:
    original = record['row']
    observed = timed[pairing(record)]
    rounds = [{k:v for k,v in game.items() if k in previous}
              for game,previous in zip(observed['rounds'],original['rounds'],strict=True)]
    if {**observed, 'rounds': rounds} != original:
        raise ValueError('Different original race when measuring previously unrecorded ticks')
ledger['localMatches']['originalTwentyWithoutTicks'] = original_prefix
ledger['localMatches']['controlFrags'] = timed_prefix + read('oldFullRemainder.jsonl')
recovered_ticks = 0
for batch in (ledger['localDefaultFrags']['frozen']['races'],ledger['localDefaultFrags']['prefixVerification']['old']['continued']):
    for record in batch:
        for index,game in enumerate(record['row']['rounds']):
            if 'ticksPlayed' in game:
                continue
            replayed = timed[pairing(record)]['rounds'][index]
            if game != {k:v for k,v in replayed.items() if k != 'ticksPlayed'}:
                raise ValueError('Unmatched frozen round with missing tick observation')
            game['ticksPlayed'] = replayed['ticksPlayed']
            recovered_ticks += 1
ledger['localDefaultFrags']['roundTimesFromIndependentShorterReplay'] = recovered_ticks
for panel, expected in [('finalFirstKO',1800), ('finalFresh',1800), ('finalFrags',1800), ('reservedFrags',1800),
                        ('reservedControl',1800), ('finalCommonHands',1800),
                        ('borderlineFirst',200), ('borderlineFirstControl',200),
                        ('upperConfirmation',600), ('controlFirstKO',1800), ('controlFrags',1800)]:
    require_count(ledger['localMatches'][panel], expected, pairing, panel)
for name,three in [('live','finalFrags'),('frozen','controlFrags'),('reservedLive','reservedFrags'),('reservedFrozen','reservedControl')]:
    races = ledger['localDefaultFrags'][name]
    require_count(races['races'],1800,pairing,name+' default seven-frag races')
    prefix = {pairing(r):r['row']['rounds'] for r in ledger['localMatches'][three]}
    for r in races['races']:
        initial = prefix[pairing(r)]
        if r['task']['fragTarget'] != 7 or r['row']['rounds'][:len(initial)] != initial:
            raise ValueError('Different first rounds in the default frag match')
    if (races['adjudication']['matches'] != 1800 or not races['adjudication']['matched']
            or races['adjudication']['rounds'] != sum(len(r['row']['rounds']) for r in races['races'])):
        raise ValueError('Unverified default frag scoreboard')
for policy, verification in ledger['localDefaultFrags']['prefixVerification'].items():
    direct = {pairing(r):r['row'] for r in verification['direct']}
    if len(direct) != 36 or direct != {pairing(r):r['row'] for r in verification['continued']}:
        raise ValueError('Different fresh and continued seven-frag race for ' + policy)
for policy in ('control','live'):
    results = ledger['upperSeriesConfirmation'][policy]
    for target in ('three','seven'):
        require_count(results[target],200,pairing,'upper-pair '+target+' '+policy)
    prefixes = {pairing(r):r['row']['rounds'] for r in results['three']}
    for r in results['seven']:
        prefix = prefixes[pairing(r)]
        if r['row']['rounds'][:len(prefix)] != prefix:
            raise ValueError('Different first rounds on the upper-pair confirmation')
    if results['scoreboard'] != {'matches':200,'rounds':sum(len(r['row']['rounds']) for r in results['seven']),'matched':True}:
        raise ValueError('Different independent upper-pair scoreboard')
require_count(ledger['localDefaultFrags']['training'],4480,
              lambda r:(*pairing(r),*r['task']['practicedSlots']), 'default-match training')
for panel in ('scheduledAudit', 'scheduledSealed', 'scheduledAuditControl', 'scheduledSealedControl'):
    require_count(ledger['openings'][panel], 40, lambda row: row['seed'], panel)
for name in ('frozen-gates', 'remapped-gates'):
    require_count(ledger['campaign'][name]['raw'], 4500,
                  lambda r: (r['levelId'], r['profileId'], r['cadenceId'], r['seed']), name)
require_count(release, 4500, attempt_key, 'fourth campaign gate run')
require_count(ledger['campaign']['finalRivalRepeat']['rawRivals'], 600, attempt_key, 'final rival replays')
require_count(targeted_campaign, 4500, attempt_key, 'campaign after roof trigger optimization')
require_count(ledger['campaign']['afterRoofTriggerSearch']['rawRivals'], 600, attempt_key, 'optimized rival replays')
require_count(prefetched_campaign, 4500, attempt_key, 'campaign with between-tick search')
require_count(ledger['campaign']['afterBetweenTickSearch']['rawRivals'], 600, attempt_key, 'final authored rival rerun')
if differences or any(ledger['campaign'][phase]['gameplayDifferences'] for phase in ('afterRoofTriggerSearch','afterBetweenTickSearch')):
    raise ValueError('The release campaign differs from the remapped campaign')
repeats = ledger['roofTriggerSearch']['repeatedOutcomes'] = {}
for before,after,count in [('final-audit-open','targeted-audit-open',40),('final-sealed-open','targeted-sealed-open',40),
                           ('scheduledDig','targeted-dig',16),('bound-recall','targeted-recall',40),
                           ('production-first','targeted-first',1800),('production-frags','targeted-races',1800),
                           ('default-seven-live','targeted-default',1800),('production-native120','targeted-native120',80),
                           ('production-native200','targeted-native200',400)]:
    left, right = read(before+'.jsonl'), read(after+'.jsonl')
    key = pairing if 'task' in left[0] else lambda r:r['seed']
    repeats[after] = identical_panel(after, left, right, key, count)
expert_repeat = [{k:v for k,v in r['row'].items() if k!='tier'} for r in read('targeted-expert200.jsonl')]
repeats['expert200'] = identical_panel('fresh expert survival',read('ship-native200.jsonl'),expert_repeat,lambda r:r['seed'],40)
if (read('targeted-cold.json') != ledger['coldProcessReplay']
        or read('targeted-default-check.json') != ledger['localDefaultFrags']['live']['adjudication']):
    raise ValueError('Cold process replay or the optimized default-match adjudication changed')
prepared = ledger['betweenTickSearch']['repeatedOutcomes'] = {}
for panel,count in [('first',1800),('races',1800),('default',1800),('native120',80),('native200',400),('expert200',40),
                    ('audit-open',40),('sealed-open',40)]:
    before, after = (read(prefix+'-'+panel+'.jsonl') for prefix in ('targeted','prefetched'))
    if 'task' in after[0]:
        for record in after:
            if record['task'].pop('displayHz') != 165:
                raise ValueError('Wrong display cadence in '+panel)
        key = pairing
    else:
        key = lambda r:r['seed']
    prepared[panel] = identical_panel(panel, before, after, key, count)
if (read('prefetched-cold.json') != ledger['coldProcessReplay']
        or read('prefetched-default-check.json') != ledger['localDefaultFrags']['live']['adjudication']):
    raise ValueError('Between-tick preparation changed a replay or the adjudicated default finish')
for name in ('frozen','live'):
    require_count(ledger['nativeAttribution'][name],80,lambda r:(r['tier'],r['seed']), 'native intent ' + name)
    cohort = 'controlScheduled120' if name == 'frozen' else 'allScheduled120'
    matches = {(r['tier'],r['seed']):r for r in ledger['longRuns'][cohort]}
    for r in ledger['nativeAttribution'][name]:
        game = matches[r['tier'],r['seed']]
        observed = sum(len(fire) > 2 for fire in game['fires'])
        if (any(r[k] != game[k] for k in ('locks','topOut','score','attack','rejected'))
                or r['forecast'] + r['mistakeEnabled'] + r['opportunity'] != observed):
            raise ValueError('Native intent observer changed play or missed a fire')
for name in ('controlScheduled120','allScheduled120','controlScheduled200','allScheduled200'):
    count = 80 if name.endswith('120') else 400
    require_count(ledger['longRuns'][name],count,lambda r:(r['tier'],r['seed']), name)
for panel, expected in [('finalHistorical',280), ('finalFresh',512), ('finalConfirmation',192), ('novaRepeatLive',128)]:
    require_count(ledger['rivals'][panel], expected, lambda r: (r['id'], r['profile'], r['cadence'], r['seed']), panel)
for name in ('jointRoofFit', 'independentFit', 'smoothFit', 'judgmentFit', 'alignedJudgmentFit','expandedFit'):
    for panel, expected in [('Holdout',720), ('Races',1800), ('First',1800), ('Fresh',1800), ('Native120',72), ('Native200',360)]:
        require_count(ledger['localCalibration'][name][panel], expected, pairing, name + ' ' + panel)
selected = ledger['localCalibration'][ledger['releasePolicy']['family']]
for trial, production in [('First','finalFirstKO'),('Fresh','finalFresh'),('Races','finalFrags')]:
    reference = {pairing(r):r['row'] for r in selected[trial]}
    for record in ledger['localMatches'][production]:
        if reference[pairing(record)] != record['row']:
            raise ValueError(f'Normal local play diverged from the selected trial in {production} {pairing(record)}')
for trial, name in [('Native120','allScheduled120'),('Native200','allScheduled200')]:
    reference = {(r['tier'],r['seed']):r for r in ledger['longRuns'][name]}
    if any(reference[r['task']['tier'],r['task']['seed']] != r['row'] for r in selected[trial]):
        raise ValueError('Normal local survival diverged from selected trial in ' + trial)
if (len(ledger['localCalibration']['expandedFit']['additionalTraining']) != 2304
        or len(ledger['localCalibration']['alignedJudgmentFit']['training']) != 2176
        or not ledger['raceParity']['matched'] or ledger['raceParity']['matches'] != 1800
        or len(ledger['reviewVerification']['studyId']) != 64):
    raise ValueError('Incomplete training, frag adjudication or blind clip check')
def verify_pressure_runs(before, after):
    if len(before['fixtures']) != 24 or before['fixtures'] != after['fixtures']:
        raise ValueError('Different pressure boards across builds')
    kinds = ('rubble', 'roof', 'cleanRoof', 'infinity')
    def index(result, fixed, prepare=None):
        return {(r['repeat'],r['kind'],r['hz'],r['tier']):r for r in result['rows']
                if (r.get('clock') == 'fixed-local') == fixed and r.get('prepare') == prepare}
    def compare(a, b, tiers):
        keys = {(rep,kind,hz,tier) for rep in (0,1) for kind in kinds for hz in (60,165) for tier in tiers}
        if set(a) != keys or set(b) != keys:
            raise ValueError('Incomplete pressure conditions')
        for condition in keys:
            for key in ('choices','work','latencies'):
                if len(a[condition][key]) != 6 or a[condition][key] != b[condition][key]:
                    raise ValueError(f'Different {key} on pressure boards {condition}')
    compare(index(before,False), index(after,False), (3,10))
    compare(index(after,True,False), index(after,True,True), (10,))


verify_pressure_runs(ledger['roofTriggerSearch']['pressure'], ledger['betweenTickSearch']['pressure'])
manifests = set()
for repeat in (1,2):
    for mode in ('1','3','4','odyssey'):
        for hz in (60,165):
            key = f'prefetched-render-{repeat}-{mode}-{hz}'
            live, tape = ledger['renderer'][key], ledger['renderer'][key + '-replay']
            manifests.add(live['buildManifestSha256'])
            for setting in ('cpu','electron','chromium','renderer','mainPriority','rendererPriority'):
                if live['runtime'][setting] != tape['runtime'][setting]:
                    raise ValueError(f'Different renderer runtime setting {setting} in {key}')
            if (live['buildManifestSha256'] != tape['buildManifestSha256'] or live['checkFormat'] != 'body-v1'
                    or tape['checkFormat'] != 'body-v1' or not live['times'] or not tape['replay']
                    or not all(r['requestedHz'] == hz and r['sharedTexturePaints'] and r['runtime']['renderer']
                               and r['runtime']['mainPriority'] == 0 and r['runtime']['rendererPriority'] == 0
                               for r in (live,tape)) or min(live['elapsed'], tape['elapsed']) < 600000):
                raise ValueError('Invalid matched renderer recording ' + key)
            left = {(r[0],r[1]): r[2:] for r in live['checks']}
            right = {(r[0],r[1]): r[2:] for r in tape['checks']}
            shared = left.keys() & right.keys()
            if not shared or len(shared) < 0.95 * max(len(left),len(right)) or any(left[k] != right[k] for k in shared):
                raise ValueError('Different real game state in rendered action replay ' + key)
            if mode == 'odyssey' and min(live['activeTicks'],tape['activeTicks']) < 600 * 60 * 0.75:
                raise ValueError('Insufficient active rival play across retries in ' + key)
            for run in (live,tape):
                if (len(run['stalls']) + len(run['nearTwoFrames']) != sum(dt >= 2000/hz-.25 for dt in run['intervals'])
                        or len(run['overBudget']) != sum(ms > 1000/hz for ms in run['times'])):
                    raise ValueError('Inconsistent per-frame planner or missed-refresh attribution ' + key)
mixed = ledger['renderer']['prefetched-mixed-3-60']
mixed_tape = ledger['renderer']['prefetched-mixed-3-60-replay']
if (manifests != {mixed['buildManifestSha256']} or manifests != {ledger['verification']['packagedBuild']['manifestSha256']}
        or mixed_tape['buildManifestSha256'] != mixed['buildManifestSha256']
        or mixed['localTiers'] != [1,4,9] or mixed_tape['localTiers'] != mixed['localTiers']
        or not mixed_tape['replay'] or any(r['runtime']['mainPriority'] != 0 for r in (mixed,mixed_tape))
        or min(mixed['elapsed'],mixed_tape['elapsed']) < 120000):
    raise ValueError('Different packaged builds or invalid mixed-tier match')
mixed_checks = [{(c[0],c[1]):c[2:] for c in run['checks']} for run in (mixed,mixed_tape)]
shared = mixed_checks[0].keys() & mixed_checks[1].keys()
if (len(shared) < 0.95 * max(map(len,mixed_checks)) or not shared
        or any(mixed_checks[0][key] != mixed_checks[1][key] for key in shared)):
    raise ValueError('Different mixed-tier game state in the action replay')
cross_build = ledger['roofTriggerSearch']['packagedRepeats'] = {}
prepared_build = ledger['betweenTickSearch']['packagedRepeats'] = {}
for before, after in [('production-mixed-3-60', 'targeted-mixed-3-60'),
                      ('capacity-render-1-3-165', 'targeted-render-1-3-165'),
                      ('capacity-render-1-4-165', 'targeted-render-1-4-165'),
                      ('targeted-mixed-3-60','prefetched-mixed-3-60'),
                      *((f'targeted-render-1-{n}-165',f'prefetched-render-1-{n}-165') for n in [1,3,4,'odyssey'])]:
    earlier, optimized = (ledger['renderer'][key] for key in (before, after))
    checks = [{(c[0],c[1]):c[2:] for c in r['checks']} for r in (earlier,optimized)]
    common = checks[0].keys() & checks[1].keys()
    commands = min(len(earlier['inputs']), len(optimized['inputs']))
    if (not common or any(checks[0][key] != checks[1][key] for key in common)
            or not commands or earlier['inputs'][:commands] != optimized['inputs'][:commands]):
        raise ValueError('Different packaged game after high-stack movement optimization in '+after)
    repeats = prepared_build if after.startswith('prefetched-') else cross_build
    repeats[after] = {'matchedChecks':len(common), 'matchedInputPrefix':commands,
                          'inputLengths':[len(r['inputs']) for r in (earlier,optimized)]}
with NamedTemporaryFile(dir=output.parent, prefix=output.name+'.', delete=False) as temporary:
    path = Path(temporary.name)
try:
    with path.open('wb') as file:
        with gzip.GzipFile(fileobj=file, mode='wb', filename='', mtime=0, compresslevel=7) as compressed:
            with TextIOWrapper(compressed,encoding='utf-8') as stream:
                json.dump(ledger,stream,separators=(',', ':'),ensure_ascii=False)
    path.replace(output)
finally:
    path.unlink(missing_ok=True)
