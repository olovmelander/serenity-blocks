"""Phase 1 and 1b benchmark gates (docs/ODYSSEY_LEVEL_DESIGN_AUDIT_2026-11.md §5.6) on a joined analysis.
usage: gates.py <levels.json> <final.json>   (final.json from final.py on the run's raw rows)"""
import json
import sys

L = {lv['id']: lv for lv in json.load(open(sys.argv[1], encoding='utf-8'))}
F = {int(k): v for k, v in json.load(open(sys.argv[2])).items()}


def rate(e, proxy):
    p = e['proxies'][proxy]
    return p['wins'] / p['n'] if p['n'] else None


results = []


def gate(name, ok, detail):
    results.append((name, ok, detail))


solo = [i for i in sorted(L) if not L[i]['mechanics'].get('versus')]
quad_goals = [i for i in solo if L[i]['victory']['primary']['type'] == 'quads']
# Pass 2 (D9): a chain goal of 4+ waves is a technique goal like a Quad goal. The novice proxy stacks without reading
# gravity, so it is judged by the cascade player (the skilled gate below) and at human pace instead.
chain_goals = [i for i in solo if L[i]['victory']['primary']['type'] == 'combo' and L[i]['victory']['primary']['target'] >= 4]
bosses = [i for i in solo if L[i].get('role') == 'boss']

miss = [(i, rate(F[i], 'novice')) for i in solo if i not in quad_goals and i not in chain_goals
        and rate(F[i], 'novice') < (0.6 if i in bosses else 0.8)]
gate('novice >= 80% (bosses >= 60%), Quad and 4-wave chain goals excepted', not miss, miss)
miss = [(i, rate(F[i], 'quad')) for i in quad_goals if rate(F[i], 'quad') < 0.6]
gate('Quad proxy >= 60% on Quad goals', not miss, miss)
miss = [(i, rate(F[i], 'skilled')) for i in solo if i not in quad_goals and rate(F[i], 'skilled') < 0.8]
gate('skilled >= 80% on every other solo orb', not miss, miss)
miss = [(i, F[i]['best3']) for i in solo if not (0.3 <= F[i]['best3'] <= 1.0)]
gate('best policy three-star rate 30-100%', not miss, miss)
# Survival orbs (phase 3) are judged by the person model instead: bots slide pieces at full speed during the lock
# delay, so the novice proxy outlasts any ramp (docs: §5.10).
survival = [i for i in solo if L[i]['victory']['primary']['type'] == 'time']
miss = [i for i in solo if F[i].get('free3') and i not in survival]
gate('no free three stars (regular pace replay)', not miss, miss)
rises = []
for i in solo:
    if i > 1 and L[i]['chapter'] == L[i - 1]['chapter']:
        rises.append((round(F[i]['hdi'] - F[i - 1]['hdi'], 1), i))
worst = max(rises)
gate('no index rise above 3 within a chapter', worst[0] <= 3, worst)
walls = [i for i in solo if F[i]['hdi'] >= 8]
gate('no solo walls (index >= 8)', not walls, walls)

duels = [i for i in sorted(L) if L[i]['mechanics'].get('versus')]
ch8 = [i for i in duels if L[i]['chapter'] == 8][0]
gate('chapter 8 rival: skilled >= 60% and regular >= 20%',
     rate(F[ch8], 'skilled') >= 0.6 and rate(F[ch8], 'regular') >= 0.2,
     {k: f"{F[ch8]['proxies'][k]['wins']}/{F[ch8]['proxies'][k]['n']}" for k in ('novice', 'regular', 'skilled', 'expert')})
mid = [i for i in duels if L[i]['chapter'] in (5, 6, 7)]
miss = [(i, rate(F[i], 'regular')) for i in mid if rate(F[i], 'regular') < 0.4]
gate('chapter 5-7 rivals: regular >= 40%', not miss, miss)

for name, ok, detail in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail if not ok or isinstance(detail, (tuple, dict)) else ''}")
print(sum(ok for _, ok, _ in results), 'of', len(results), 'gates pass')
