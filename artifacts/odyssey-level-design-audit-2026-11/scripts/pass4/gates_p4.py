"""Pass 4 gates on a joined analysis: the seven solo gates of passes 1-3, and the two rival gates restated in the
game's own levels (docs/ODYSSEY_LEVEL_DESIGN_PASS4_2026-11.md, D31).
usage: gates_p4.py <levels.json> <final.json> [rival-levels.json]   (rival-levels.json from level-gates.mjs)"""
import json
import sys

L = {lv['id']: lv for lv in json.load(open(sys.argv[1], encoding='utf-8'))}
F = {int(k): v for k, v in json.load(open(sys.argv[2])).items()}
R = {int(k): v for k, v in json.load(open(sys.argv[3], encoding='utf-8')).items()} if len(sys.argv) > 3 else None


def rate(e, proxy):
    p = e['proxies'][proxy]
    return p['wins'] / p['n'] if p['n'] else None


results = []


def gate(name, ok, detail):
    results.append((name, ok, detail))


solo = [i for i in sorted(L) if not L[i]['mechanics'].get('versus')]
quad_goals = [i for i in solo if L[i]['victory']['primary']['type'] == 'quads']
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

if R is not None:
    # The rivals are measured with a local versus bot of each level in the player's well (rival-levels.mjs).
    duels = [i for i in sorted(L) if L[i]['mechanics'].get('versus')]
    last = duels[-1]

    def share(orb, level, key='wins'):
        cell = R[orb]['cells'][str(level)]
        return cell[key] / cell['n']

    even = {i: (R[i]['evenAt'] if R[i]['evenAt'] is not None else 99) for i in duels}
    detail = {'even at': even[last], 'level 5 wins': round(share(last, 5), 2),
              'undecided at level 6': round(share(last, 6, 'undecided'), 2)}
    gate('last rival: even between levels 6 and 7.5, level 5 wins <= 25%, undecided at level 6 <= 10%',
         6 <= even[last] <= 7.5 and share(last, 5) <= 0.25 and share(last, 6, 'undecided') <= 0.10, detail)
    # The climb: from chapter 4 on no rival is easier than the one before it, and none is harder than the last.
    late = [i for i in duels if L[i]['chapter'] >= 4]
    order = [even[i] for i in late]
    miss = [(late[n], order[n]) for n in range(1, len(order)) if order[n] < order[n - 1] or order[n] > order[-1]]
    gate('rivals from chapter 4: each even at a level no lower than the rival before, none above the last', not miss,
         miss or {i: even[i] for i in late})

for name, ok, detail in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail if not ok or isinstance(detail, (tuple, dict)) else ''}")
print(sum(ok for _, ok, _ in results), 'of', len(results), 'gates pass')
