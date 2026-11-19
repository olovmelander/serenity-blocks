"""Locate sampled CPU activity inside a packaged planner's over-frame calls."""
from bisect import bisect_left
from collections import Counter
from itertools import accumulate
from pathlib import Path
import json
import sys

recording_path, timeline_path, output_path = map(Path, sys.argv[1:])
run = json.loads(recording_path.read_text(encoding='utf-8'))
timeline = json.loads(timeline_path.read_text(encoding='utf-8'))
cpu = timeline['profile']
samples = cpu['samples']
timestamps = list(accumulate(cpu['timeDeltas'], initial=cpu['startTime']))[1:]
origin = timeline['navigationStart'] * 1_000_000
if len(samples) != len(timestamps) or not timestamps:
    raise ValueError('Incomplete Chromium thread profile')
nodes = {entry['id']: entry['callFrame'] for entry in cpu['nodes']}


def sample_name(node_id):
    frame = nodes[node_id]
    name = frame['functionName'] or '(anonymous)'
    if not frame['url']:
        return name
    return f"{name} {frame['url'].rsplit('/',1)[-1]}:{frame['lineNumber']+1}:{frame['columnNumber']+1}"


def sample_window(start_ms, duration_ms):
    start = origin + 1000 * start_ms
    end = start + 1000 * duration_ms
    if start < timestamps[0] or end > timestamps[-1]:
        raise ValueError('Frame and profiler clocks do not cover the same time interval')
    lo, hi = bisect_left(timestamps, start), bisect_left(timestamps, end)
    inside = timestamps[lo:hi]
    gaps = [b-a for a,b in zip([start]+inside, inside+[end])]
    counts = Counter(sample_name(node) for node in samples[lo:hi])
    return {'samples':hi-lo, 'largestUnsampledMs':max(gaps)/1000, 'sampledLocations':dict(counts.most_common())}


events = []
for event in run['overBudget']:
    window = sample_window(event['callStartMs'], event['longestCallMs'])
    events.append({**event, 'samplesInsideLongestCall':window.pop('samples'), **window})

whole = []
for event in run.get('wholeOverBudget', []):
    call_windows = {key:sample_window(event[key]['start'], event[key]['ms'])
                    for key in ('longestUpdate','longestInput') if event.get(key)}
    whole.append({**event, 'windows':call_windows})
stalls = [{**event, **sample_window(event['start'], event['ms'])}
          for event in run.get('longestDisplayIntervals', [])]

summary = {'requestedHz': run['requestedHz'], 'elapsedMs': run['elapsed'], 'activeUpdates': len(run['times']),
           'sampleIntervalUs': 400, 'sampleCount': len(timestamps), 'events': events,
           'wholeUpdates': whole, 'longestDisplayIntervals': stalls,
           'buildManifestSha256': run['buildManifestSha256']}
with output_path.open('x', encoding='utf-8') as output:
    json.dump(summary, output, indent=2)
