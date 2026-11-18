"""Offline star scoring with the game's rules (VictoryConditionEvaluator.calculateStars / evaluateBonuses).

Normal orbs stop at the goal, so a run's goal-time metrics decide its stars, and star times or extra goals can be
changed without re-running the benchmark. Showcase orbs and duels keep their recorded stars.

usage: restar.py check <levels.json> <raw.jsonl>      validate against recorded stars and flag stale runs
"""
import json
import sys


def gameplay_key(cfg):
    """The fields that change how an orb plays (stars and extra goals don't)."""
    b = cfg.get('board') or (cfg.get('mechanics') or {}).get('board') or {}
    sp = cfg.get('speed') or (cfg.get('mechanics') or {}).get('speed') or {}
    mods = cfg.get('modifiers')
    if isinstance(mods, dict):
        mods = mods.get('active', [])
    v = cfg['victory']
    return json.dumps([cfg.get('baseMode') or cfg['mechanics']['baseMode'], b.get('columns'), b.get('rows'),
                       b.get('startingRows') or 0, b.get('opening') or [], sp.get('startLevel'), bool(sp.get('levelProgression')),
                       sp.get('fixedDropInterval'), sp.get('doublingSeconds'), sorted(mods or []), v['primary'], {'type': v['failure'].get('type'), 'value': v['failure'].get('value')}],
                      sort_keys=True)


def bonus_met(bonus, m, won):
    t, x = bonus['type'], bonus.get('target')
    if t == 'no-singles':
        return m['singles'] == 0
    if t == 'time':
        return m['time'] <= x
    if t == 'max-cascade-depth':
        return m['maxCascadeDepth'] >= x
    if t == 'quad-count':
        return m['quads'] >= x
    if t == 'cascade':
        return m['cascades'] >= x
    if t == 'combo':
        return m['maxCombo'] >= x
    if t == 'no-top-out':
        return won and m['deaths'] == 0
    if t == 'pieces':
        return m['piecesPlaced'] <= x
    raise ValueError(t)


KEYMAP = {'combo': 'maxCombo', 'maxDeaths': 'deaths', 'survived': 'time'}


def meets(cond, m, nb):
    if not cond:
        return False
    for k, target in cond.items():
        if k == 'bonuses':
            if nb < target:
                return False
            continue
        val = m.get(KEYMAP.get(k, k), 0) or 0
        if k in ('time', 'maxDeaths'):
            if val > target:
                return False
        elif val < target:
            return False
    return True


def stars_for(level, row, human_pps=None):
    """Stars a run earns under `level`'s star rules. None means: use the recorded value."""
    if level['mechanics'].get('versus') or level.get('victoryLapPolicy') == 'showcase':
        return None
    if row['outcome'] != 'win' or not row.get('goalMetrics'):
        return 0
    m = dict(row['goalMetrics'])
    m['time'] = row.get('goalReachedAtSeconds', m.get('time'))
    if human_pps:
        m['time'] = m['piecesPlaced'] / human_pps   # the same run at a person's pace
    nb = sum(1 for b in level['victory'].get('bonuses') or [] if bonus_met(b, m, True))
    s = 0
    for i, tier in enumerate(('one', 'two', 'three'), 1):
        if meets((level.get('stars') or {}).get(tier), m, nb):
            s = i
    return s


if __name__ == '__main__' and sys.argv[1] == 'check':
    levels = {lv['id']: lv for lv in json.load(open(sys.argv[2], encoding='utf-8'))}
    rows = [json.loads(line) for line in open(sys.argv[3], encoding='utf-8')]
    same = diff = 0
    mism = []
    stale = set()
    for r in rows:
        lv = levels[r['levelId']]
        if gameplay_key(r['effectiveConfig']) != gameplay_key(lv):
            stale.add((r['levelId'], r['profileId'], r['cadenceId']))
            continue
        s = stars_for(lv, r)
        if s is None:
            continue
        if s == r['goalStars'] or (r['outcome'] != 'win' and not r['goalStars']):
            same += 1
        else:
            diff += 1
            mism.append((r['levelId'], r['profileId'], r['cadenceId'], s, r['goalStars']))
    print(f'stars reproduced {same}, differ {diff}', mism[:12])
    print('stale cells', sorted(stale))
