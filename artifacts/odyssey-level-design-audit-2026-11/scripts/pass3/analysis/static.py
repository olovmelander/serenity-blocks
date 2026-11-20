"""Static audit of the shipped Odyssey levels: speed in/out, clock pace, star structure, orphan bonuses,
repeats. Usage: python static.py levels.json > static.txt"""
import json
import sys
from pathlib import Path

L = json.load(open(sys.argv[1], encoding='utf-8'))


def ms(level):
    speed = 4 + (level - 1) * 5 if level <= 10 else 50 + (level - 10) * 3
    return max(10, 2880 // speed)


def speed_path(lv, lines_at_goal):
    """Effective ms/row at the start and after `lines_at_goal` lines (15 lines a level)."""
    sp = lv['mechanics']['speed']
    mods = lv['modifiers'].get('active', [])
    start_level = sp.get('startLevel') or 1
    fixed = sp.get('fixedDropInterval')
    prog = sp.get('levelProgression')
    mult = 1.0
    if 'speed-up' in mods:
        mult *= 1.5
    if fixed and prog:                       # proportional curve (orb 6 rule)
        mult *= ms(start_level) / fixed
    start = (fixed or ms(start_level)) / (1.5 if 'speed-up' in mods else 1)
    if 'slow-start' in mods:
        start = min(start * 1.5, 2000)
    if not prog:
        return start, start, start_level, start_level
    gained = int(lines_at_goal // 15)
    end_level = start_level + gained
    end = ms(end_level) / mult
    return start, end, start_level, end_level


def bonus_implied(b, cond):
    t = b.get('target') or 0
    if b['type'] == 'quad-count':
        return (cond.get('quads') or 0) >= t
    if b['type'] == 'cascade':
        return (cond.get('cascades') or 0) >= t
    if b['type'] in ('combo', 'max-cascade-depth'):
        return max(cond.get('combo') or 0, cond.get('maxCascadeDepth') or 0) >= t
    if b['type'] == 'time':
        return cond.get('time') is not None and cond['time'] <= t
    return False


rows = []
for lv in L:
    pr = lv['victory']['primary']
    fa = lv['victory']['failure']
    stars = lv.get('stars') or {}
    bonuses = lv['victory'].get('bonuses', [])
    lines_goal = pr['target'] if pr['type'] == 'lines' else None
    s0, s1, l0, l1 = speed_path(lv, lines_goal or 0)
    pace = ''
    if fa['type'] == 'time':
        if pr['type'] == 'lines':
            pace = f"{pr['target'] / fa['value'] * 60:.1f} lines/min"
        elif pr['type'] == 'score':
            pace = f"{pr['target'] / fa['value']:.0f} pts/s"
    uses_bonus_count = any('bonuses' in (stars.get(t) or {}) for t in ('one', 'two', 'three'))
    orphans = []
    for b in bonuses:
        if uses_bonus_count:
            continue
        if not any(bonus_implied(b, stars.get(t) or {}) for t in ('two', 'three')):
            orphans.append(f"{b['type']}{'=' + str(b.get('target')) if b.get('target') else ''}")
    tier_add = []
    for t in ('two', 'three'):
        c = dict(stars.get(t) or {})
        base = stars.get('one') or {}
        add = {k: v for k, v in c.items() if base.get(k) != v}
        tier_add.append(','.join(f'{k}={v}' for k, v in add.items()) or '-')
    rows.append({
        'id': lv['id'], 'ch': lv['chapter'], 'name': lv['name'], 'role': lv.get('role'), 'focus': lv.get('mechanicFocus'),
        'goal': f"{pr['type']}:{pr['target']}", 'fail': f"{fa['type']}:{fa.get('value')}",
        'mode': lv['mechanics']['baseMode'], 'rows': lv['mechanics']['board']['rows'], 'rub': lv['mechanics']['board']['startingRows'],
        's0': round(s0), 's1': round(s1), 'L0': l0, 'L1': l1, 'pace': pace, 'two': tier_add[0], 'three': tier_add[1],
        'orphans': orphans, 'diff': lv['metadata']['difficulty'], 'band': (lv['metadata'].get('difficultyModel') or {}).get('band'),
        'mods': lv['modifiers'].get('active', []), 'lap': lv.get('victoryLapPolicy'), 'boss': lv.get('chapterBoss'),
    })

for r in rows:
    sp = f"{r['s0']}" + (f"->{r['s1']}ms (L{r['L0']}->L{r['L1']})" if r['s1'] != r['s0'] else 'ms')
    print(f"#{r['id']:2d} c{r['ch']} {r['name'][:20]:20s} {r['role']:9s} {r['goal']:13s} {r['fail']:12s} {r['mode'][:3]} {r['rows']:3d}r rub{r['rub']:2d} "
          f"spd {sp:28s} {r['pace']:14s} 2*+[{r['two']}] 3*+[{r['three']}] orphan={r['orphans']} d{r['diff']}/{r['band']}")

# repeats: identical (goal, fail, mode, speed start) signatures
print('\nNear-identical pairs (same goal, fail, mode, start speed):')
sig = {}
for r in rows:
    k = (r['goal'], r['fail'], r['mode'], r['s0'], r['rub'])
    sig.setdefault(k, []).append(r['id'])
for k, ids in sig.items():
    if len(ids) > 1:
        print('  ', ids, k)
print('\nSame goal type back to back:')
for a, b in zip(rows, rows[1:]):
    if a['goal'].split(':')[0] == b['goal'].split(':')[0] and a['ch'] == b['ch']:
        print(f"   #{a['id']} {a['goal']} -> #{b['id']} {b['goal']}")
with Path(sys.argv[1]).with_name('static.json').open('w', encoding='utf-8') as dest:
    json.dump(rows, dest, indent=1)
