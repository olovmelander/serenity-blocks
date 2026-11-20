"""Join shipped levels, the static pass and the benchmark into one row per orb, with a transparent
human-difficulty index (HDI). usage: python final.py levels.json static.json raw.jsonl out.json"""
import collections
import json
import math
import statistics
import sys

sys.path.insert(0, __import__('os').path.dirname(__file__))
from restar import stars_for  # noqa: E402

levels_path, static_path, raw_path, out_path = sys.argv[1:5]
levels = {lv['id']: lv for lv in json.load(open(levels_path, encoding='utf-8'))}
static = {r['id']: r for r in json.load(open(static_path, encoding='utf-8'))}
rows = [json.loads(line) for line in open(raw_path, encoding='utf-8')]

PROXIES = {'novice': ('stacker', 'deliberate'), 'regular': ('stacker', 'native'),
           'skilled': ('cascade', 'steady'), 'expert': ('expert', 'native'), 'quad': ('quad', 'native')}
TIER_OF = {}
for lv in levels.values():
    if lv['mechanics'].get('versus'):
        TIER_OF[lv['id']] = lv['mechanics']['versus']['botDifficulty']


def ms(level):
    speed = 4 + (level - 1) * 5 if level <= 10 else 50 + (level - 10) * 3
    return max(10, 2880 // speed)


def STAR(r):
    # normal orbs stop at the goal: score their stars offline with the game's rules, so star and extra-goal edits
    # need no re-run (restar.py reproduces every recorded result); showcase orbs keep the stars earned after the lap
    s = stars_for(levels[r['levelId']], r)
    if s is not None:
        return s
    if levels[r['levelId']].get('victoryLapPolicy') == 'showcase':
        return r.get('stars')
    return r.get('goalStars', r.get('stars'))


def med(v):
    v = [x for x in v if x is not None]
    return statistics.median(v) if v else None


groups = collections.defaultdict(list)
for r in rows:
    groups[(r['levelId'], r['profileId'], r['cadenceId'])].append(r)
by_level = collections.defaultdict(list)
for r in rows:
    by_level[r['levelId']].append(r)

out = {}
for lid in sorted(levels):
    lv = levels[lid]
    st = static[lid]
    e = {'id': lid, 'name': lv['name'], 'chapter': lv['chapter'], 'role': lv.get('role')}
    px = {}
    for name, key in PROXIES.items():
        rs = groups.get((lid,) + key, [])
        wins = [r for r in rs if r['outcome'] == 'win']
        px[name] = {
            'n': len(rs), 'wins': len(wins),
            'losses': dict(collections.Counter(r['reason'] for r in rs if r['outcome'] != 'win')),
            'pieces': med([(r.get('goalMetrics') or {}).get('piecesPlaced') for r in wins]),
            'lines': med([(r.get('goalMetrics') or {}).get('lines') for r in wins]),
            'score': med([(r.get('goalMetrics') or {}).get('score') for r in wins]),
            'seconds': med([r.get('goalReachedAtSeconds') for r in wins]),
            'stars': dict(collections.Counter(str(STAR(r)) for r in wins)),
            'chainMax': max([((r.get('metrics') or {}).get('maxCascadeDepth') or 0) for r in rs] or [0]),
            'quads': med([(r.get('goalMetrics') or {}).get('quads') for r in wins]),
        }
    e['proxies'] = px
    allr = by_level[lid]
    e['n'] = len(allr)
    e['winRate'] = round(sum(r['outcome'] == 'win' for r in allr) / max(1, len(allr)), 3)
    allw = [r for r in allr if r['outcome'] == 'win']
    e['starsAll'] = {s: round(sum(1 for r in allw if STAR(r) == s) / max(1, len(allw)), 2) for s in (1, 2, 3)}
    # the best three-star rate any single policy/cadence reached (a tier no policy reaches is out of reach)
    best3 = 0.0
    best2 = 0.0
    for (glid, prof, cad), rs in groups.items():
        if glid != lid or not rs:
            continue
        best3 = max(best3, sum(1 for r in rs if r['outcome'] == 'win' and STAR(r) == 3) / len(rs))
        best2 = max(best2, sum(1 for r in rs if r['outcome'] == 'win' and (STAR(r) or 0) >= 2) / len(rs))
    e['best3'] = round(best3, 2)
    # three stars are free when the novice proxy's clears, replayed at a regular person's 1 piece a second, earn
    # them on at least 4 of 5 seeds (a time star then measures a person, not the bot's speed)
    nov = groups.get((lid, 'stacker', 'deliberate'), [])
    hum = [stars_for(lv, r, human_pps=1.0) for r in nov]
    e['free3'] = bool(nov) and hum[0] is not None and sum(1 for h in hum if h == 3) >= max(1, len(nov) - 1)
    if nov and lv['victory']['primary']['type'] == 'time':
        # survival (phase 3): three stars are free when the novice proxy outlasts the three-star time anyway
        e['free3'] = sum(1 for r in nov if STAR(r) == 3) >= max(1, len(nov) - 1)
    e['best2'] = round(best2, 2)
    # pieces a typical human would need: the regular proxy's, else skilled, else any
    pieces = next((px[n]['pieces'] for n in ('regular', 'skilled', 'novice', 'expert') if px[n]['pieces']), None)
    if lv['victory']['primary']['type'] == 'cascade' and px['skilled']['pieces']:
        pieces = px['skilled']['pieces']          # the cascade-aware proxy builds the way a person would
    if lv['victory']['primary']['type'] == 'combo' and px['skilled']['pieces']:
        pieces = px['skilled']['pieces']
    if lv['victory']['primary']['type'] == 'quads' and px['quad']['pieces']:
        pieces = px['quad']['pieces']             # a Quad goal is judged on the player who builds for Quads
    e['pieces'] = pieces
    lines_at_goal = next((px[n]['lines'] for n in ('regular', 'skilled', 'novice', 'expert') if px[n]['lines']), 0) or 0
    # fastest gravity reached on the way to 1 star
    sp = lv['mechanics']['speed']
    mods = lv['modifiers'].get('active', [])
    start = st['s0']
    if sp.get('levelProgression'):
        mult = (ms(sp.get('startLevel') or 1) / sp['fixedDropInterval']) if sp.get('fixedDropInterval') else 1
        if 'speed-up' in mods:
            mult *= 1.5
        end = ms((sp.get('startLevel') or 1) + int(lines_at_goal // 15)) / mult
    else:
        end = start
    e['msStart'], e['msEnd'] = round(start), round(end)
    fail = lv['victory']['failure']
    e['clockPPS'] = round(pieces / fail['value'], 2) if (pieces and fail['type'] == 'time') else None
    for tier in ('two', 'three'):
        t = (lv.get('stars') or {}).get(tier, {}).get('time')
        e[f'{tier}PPS'] = round(pieces / t, 2) if (pieces and t) else None
    e['minutesAt1pps'] = round(pieces / 60, 1) if pieces else None
    # --- HDI: transparent, human-facing heuristic (0-10) ---
    if lid in TIER_OF:
        tier = TIER_OF[lid]
        botloss = sum(px[n]['n'] - px[n]['wins'] for n in ('novice', 'regular', 'skilled')) / max(1, sum(px[n]['n'] for n in ('novice', 'regular', 'skilled')))
        hdi = min(10, 0.9 * tier + 3 * botloss)
        parts = {'rivalTier': tier, 'proxyLossShare': round(botloss, 2)}
    else:
        g = max(0.0, min(5.0, math.log2(450 / max(30, end)) * 1.6))
        c = max(0.0, min(4.0, ((e['clockPPS'] or 0) - 0.3) * 4)) if e['clockPPS'] else 0.0
        length = max(0.0, min(2.0, ((pieces or 0) / 60 - 3) / 3))
        judges = ('quad',) if lv['victory']['primary']['type'] == 'quads' and px['quad']['n'] else (
            ('skilled',) if lv['victory']['primary']['type'] == 'combo' else ('novice', 'regular'))
        loss = sum(px[n]['n'] - px[n]['wins'] for n in judges) / max(1, sum(px[n]['n'] for n in judges))
        k = 3 * loss
        # bots plan cascades with a reachability search; people have to learn to build them, so a
        # cascade goal carries its own construction load that grows with the count asked for
        primary = lv['victory']['primary']
        build = (1.0 + 0.12 * primary['target']) if primary['type'] == 'cascade' else 0.0
        hdi = min(10, g + c + length + k + build)
        parts = {'gravity': round(g, 1), 'clock': round(c, 1), 'length': round(length, 1), 'proxyLoss': round(k, 1),
                 'build': round(build, 1)}
    e['hdi'] = round(hdi, 1)
    e['hdiParts'] = parts
    e['metaDifficulty'] = lv['metadata']['difficulty']
    e['band'] = (lv['metadata'].get('difficultyModel') or {}).get('band')
    if lv['victory']['primary']['type'] == 'score':
        e['pointsPerPiece'] = {n: round(px[n]['score'] / px[n]['pieces']) for n in px if px[n]['score'] and px[n]['pieces']}
    out[lid] = e

json.dump(out, open(out_path, 'w'), indent=1)

print(f"{'#':>3} {'name':19s} {'role':9s} HDI  meta  ms(start>end) pcs  min@1  clk  2*   3*   win  nov reg skl exp   stars1/2/3")
prev = None
for lid, e in out.items():
    px = e['proxies']
    w = ' '.join(f"{px[n]['wins']}/{px[n]['n']}" for n in ('novice', 'regular', 'skilled', 'expert'))
    jump = ''
    if prev is not None and levels[lid]['chapter'] == levels[lid - 1]['chapter']:
        d = e['hdi'] - prev
        if abs(d) >= 2.5:
            jump = f' <{d:+.1f}'
    prev = e['hdi']
    s = e['starsAll']
    print(f"{lid:3d} {e['name'][:19]:19s} {e['role']:9s} {e['hdi']:4.1f}  {e['metaDifficulty']:>3}   {e['msStart']:>4}>{e['msEnd']:<4}  {e['pieces'] or '-':>4} {e['minutesAt1pps'] or '-':>5} "
          f"{e['clockPPS'] or '':>4} {e['twoPPS'] or '':>4} {e['threePPS'] or '':>4} {e['winRate']:.2f}  {w}  {s[1]:.2f}/{s[2]:.2f}/{s[3]:.2f}{jump}")
