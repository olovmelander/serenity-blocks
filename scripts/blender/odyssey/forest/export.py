"""
Writing the trees out for the game (Odyssey's forest, 2026-11-24).

world/odyssey-forest-models.js: every specimen's near and middle tiers as quantised blocks in one
base64 string, the atlas plan, and the far views' frames. Game axes: x = blender x, y = blender z,
z = -blender y. The decoder is world/odyssey-forest-models-decode.js.

  card (24 bytes)   int16 x5: centre xyz / Q, half length / Q, half width / Q (10)
                    int8 x3: growth axis; int8 x3: mass normal; int8 x3: crown direction (9)
                    uint8: sky it sees, tile, its own random, unused x2 (5)
  bark vertex (12)  int16 x3 position / Q; int8 x3 normal; uint8 sky it sees; uint8 x2 round, up (0..31)
  bark index        uint16, CCW outward
"""

import base64
import json
import math

import numpy as np

import bake
import families
from growth import farthest_points, rng_of, sky_visibility, unit, wood_mesh

Q = 1 / 1024
BARK_LIST = ['brown', 'oak', 'grey', 'birch', 'aspen', 'dark', 'cherry', 'pine', 'silver']


def game(v):
    v = np.asarray(v, float)
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def hero_cards(t, index):
    rng = rng_of(sum(ord(ch) for ch in t.name) + 11)
    n = len(t.c)
    tile = np.zeros(n, int)
    for i in range(n):
        first, count = index[t.fam[i]]['hero']
        tile[i] = first + rng.randint(count)
    # Nearest the heart first, so a tier that draws fewer cards keeps a closed crown: an order in
    # which every prefix covers the crown evenly.
    order = cover_order(t)
    d = (t.c - t.crown_mid) / t.crown_half
    return {'c': t.c[order], 'a': t.a[order], 'n': t.n[order], 'd': np.clip(d[order], -1, 1), 'hl': t.hl[order], 'hw': t.hw[order],
            'ao': t.ao[order], 'tile': tile[order], 'rnd': rng.uniform(size=n)[order]}


def cover_order(t):
    if len(t.c) == 0:
        return np.zeros(0, int)
    return farthest_points(t.c, len(t.c), weight=(t.hl * t.hw) ** 0.35) if len(t.c) < 2 else full_order(t.c, (t.hl * t.hw) ** 0.35)


def full_order(p, w):
    n = len(p)
    first = int(np.argmax(w))
    chosen = [first]
    d = np.linalg.norm(p - p[first], axis=1)
    left = np.ones(n, bool)
    left[first] = False
    for _ in range(n - 1):
        s = np.where(left, (d + 1e-6) * w, -1)
        k = int(np.argmax(s))
        chosen.append(k)
        left[k] = False
        d = np.minimum(d, np.linalg.norm(p - p[k], axis=1))
    return np.array(chosen)


def mid_cards(t, index):
    n = len(t.c)
    count = min(t.mid_count, n)
    if count == 0:
        return None
    if count == n:
        return hero_cards(t, index)
    rng = rng_of(sum(ord(ch) for ch in t.name) + 23)
    fam = np.array(t.fam)
    pick = farthest_points(t.c, count, weight=(t.hl * t.hw) ** 0.5)
    owner = np.linalg.norm(t.c[:, None] - t.c[pick][None], axis=2).argmin(axis=1)
    out = {k: [] for k in ('c', 'a', 'n', 'd', 'hl', 'hw', 'ao', 'tile', 'rnd')}
    roofed = {'spruce', 'fir', 'larch', 'willow', 'cypress', 'fern', 'bracken', 'moss'}
    for g, seed in enumerate(pick):
        mine = np.nonzero(owner == g)[0]
        # Only its own kind is merged into it (a willow's top is not its curtains).
        same = mine[fam[mine] == fam[seed]]
        mine = same if len(same) else np.array([seed])
        area = float((t.hl[mine] * t.hw[mine]).sum())
        w = (t.hl[mine] * t.hw[mine])[:, None]
        c = (t.c[mine] * w).sum(0) / w.sum()
        f = fam[seed]
        if f in roofed:
            # A bough stays a bough: the seed's own, longer and fuller.
            c = c * 0.45 + t.c[seed] * 0.55
            hl = t.hl[seed] * 1.12
            hw = min(max(t.hw[seed], area * 0.62 / hl), hl * {'cypress': 0.6, 'fern': 0.84}.get(f, 0.95))
            if t.up[seed] > 0.86:
                # A spire's tip stays a point: it does not grow fat on the boughs below it.
                hw = min(hw, t.hw[seed] * 1.25)
            a = t.a[seed]
        else:
            s = math.sqrt(area * 0.66)
            spread = float(np.linalg.norm(t.c[mine] - c, axis=1).max()) if len(mine) > 1 else 0.0
            s = min(s, max(t.hl[mine].max(), spread * 0.85 + t.hl[mine].mean() * 0.75))
            s = max(s, t.hl[mine].mean())
            hl = hw = s
            a = unit((t.a[mine] * w).sum(0) + 1e-6)
        first, cnt = index[f]['mass']
        out['c'].append(c)
        out['a'].append(a)
        out['n'].append(unit((t.n[mine] * w).sum(0) + 1e-6))
        out['d'].append(np.clip((c - t.crown_mid) / t.crown_half, -1, 1))
        out['hl'].append(hl)
        out['hw'].append(hw)
        out['ao'].append(float((t.ao[mine] * w[:, 0]).sum() / w.sum()))
        out['tile'].append(first + rng.randint(cnt))
        out['rnd'].append(rng.uniform())
    return {k: np.array(v) for k, v in out.items()}


def bark(t, budget, sides, tol, min_r, seed=0):
    v, n, al, tr, rd = wood_mesh(t.sk, t.r, budget, sides, t.flare, tol=tol, min_r=min_r, seed=seed)
    if len(t.c):
        rel_ao = []
        C = t.c
        R = (t.hl + t.hw) / 2
        rng = rng_of(3)
        rays = 40
        u = rng.uniform(size=rays)
        phi = np.arange(rays) * 2.39996
        z = np.sqrt(1 - 0.94 * u)
        s = np.sqrt(np.maximum(0, 1 - z * z))
        D = np.stack([s * np.cos(phi), s * np.sin(phi), z], axis=1)
        for p in v:
            rel = C - p
            tca = rel @ D.T
            d2 = np.sum(rel * rel, axis=1)[:, None] - tca * tca
            half = np.sqrt(np.maximum(0, (R * 0.85)[:, None] ** 2 - d2))
            chord = np.maximum(0, tca + half) - np.maximum(0, tca - half)
            tau = (chord / R[:, None]).sum(axis=0) * 0.5
            rel_ao.append(float(np.mean(np.exp(-tau))))
        ao = np.array(rel_ao)
    else:
        ao = np.ones(len(v))
    # The foot, where the grass is.
    ao = ao * (0.55 + 0.45 * np.clip(v[:, 2] / 0.9, 0, 1))
    return v, n, ao, tr, al


def shade_shapes(t):
    """The crown as a few ellipsoids [x, y, z, across, up] in game axes, for its shadow on the ground."""
    if not len(t.c):
        return []
    w = t.hl * t.hw
    z = t.c[:, 2]
    tall = (z.max() - z.min()) / max(1e-3, 2 * t.reach)
    bands = 5 if tall > 1.6 else 3 if tall > 0.5 else 2
    edges = np.quantile(z, np.linspace(0, 1, bands + 1))
    out = []
    for k in range(bands):
        m = (z >= edges[k]) & (z <= edges[k + 1])
        if m.sum() < 2:
            continue
        c = (t.c[m] * w[m][:, None]).sum(0) / w[m].sum()
        r = np.linalg.norm(t.c[m][:, :2] - c[:2], axis=1) + t.hw[m] * 0.55
        across = float(np.quantile(r, 0.85))
        up = float((edges[k + 1] - edges[k]) / 2 + t.hl[m].mean() * 0.45)
        out.append([c[0], c[2], -c[1], across, up])
    return [[round(float(x), 3) for x in s] for s in out]


def pack_cards(cards):
    n = len(cards['c'])
    c = np.rint(game(cards['c']) / Q)
    hl = np.rint(cards['hl'] / Q)
    hw = np.rint(cards['hw'] / Q)
    assert np.abs(c).max() < 32767
    pos = np.concatenate([c, hl[:, None], hw[:, None]], 1).astype('<i2')
    i8 = lambda v: np.clip(np.rint(game(v) * 127), -127, 127).astype('i1')
    u8 = lambda v: np.clip(np.rint(v), 0, 255).astype('u1')
    tail = np.stack([u8(cards['ao'] * 255), u8(cards['tile']), u8(cards['rnd'] * 255), np.zeros(n, 'u1'), np.zeros(n, 'u1')], 1)
    rows = [pos[i].tobytes() + i8(cards['a'])[i].tobytes() + i8(cards['n'])[i].tobytes() + i8(cards['d'])[i].tobytes() + tail[i].tobytes()
            for i in range(n)] if n < 4 else _rows(pos, i8(cards['a']), i8(cards['n']), i8(cards['d']), tail)
    return b''.join(rows) if isinstance(rows, list) else rows


def _rows(pos, a, n, d, tail):
    m = np.concatenate([pos.view('u1').reshape(len(pos), 10), a.view('u1'), n.view('u1'), d.view('u1'), tail], 1)
    return m.astype('u1').tobytes()


BARK_SPAN = 11.0      # metres of wood one bark tile covers up the stem


def pack_bark(v, n, ao, tr, al):
    p = np.rint(game(v) / Q).astype('<i2')
    nn = np.clip(np.rint(game(n) * 127), -127, 127).astype('i1')
    a = np.clip(np.rint(ao * 255), 0, 255).astype('u1')
    u = np.clip(np.rint(al[:, 0] * 31), 0, 31)
    w = np.clip(np.rint(al[:, 1] / BARK_SPAN * 31), 0, 31)
    uv = np.stack([u, w], 1).astype('u1')
    vb = np.concatenate([p.view('u1').reshape(len(p), 6), nn.view('u1'), a[:, None], uv], 1).tobytes()
    ib = tr.astype('<u2').ravel().tobytes()
    return vb, ib


def export(trees, js_path, atlas_info, far_info):
    plan, index = families.atlas_plan()
    blob = bytearray()

    def push(b):
        while len(blob) % 4:
            blob.append(0)
        at = len(blob)
        blob.extend(b)
        return at

    specs = []
    for t in trees:
        rec = {'id': t.name, 'species': t.species, 'stage': t.stage, 'bark': BARK_LIST.index(t.bark), 'height': round(t.height, 3),
               'reach': round(t.reach, 3), 'trunkR': round(float(t.r[0]), 3), 'shade': shade_shapes(t),
               'fam': max(set(t.fam), key=t.fam.count) if t.fam else ''}
        for lod, cards, budget, sides, tol, min_r in (
                ('hero', hero_cards(t, index) if len(t.c) else None, t.wood_budget, t.trunk_sides, 0.10, 0.030),
                ('mid', mid_cards(t, index) if len(t.c) else None, 34 if t.height > 8 else 6 if t.stage == 'fern' else 18,
                 3 if t.stage == 'fern' else 4, 0.5, 0.0 if t.stage == 'fern' else 0.07)):
            v, n, ao, tr, al = bark(t, budget, sides, tol, min_r, seed=len(t.name))
            vb, ib = pack_bark(v, n, ao, tr, al)
            rec[lod] = {'cards': len(cards['c']) if cards else 0, 'cardAt': push(pack_cards(cards)) if cards else 0,
                        'barkVerts': len(v), 'barkAt': push(vb), 'barkIndices': int(tr.size), 'indexAt': push(ib)}
        specs.append(rec)
    far = None
    if far_info:
        far = {'azimuths': bake.FAR_AZ, 'elevations': list(bake.FAR_EL), 'tile': bake.FAR_TILE, 'cols': bake.FAR_COLS, 'rows': far_info['rows'],
               'curve': far_info['curve'], 'specimens': far_info['info']}
    head = {'version': 2, 'quant': Q, 'cardBytes': 24, 'barkBytes': 12,
            'atlas': {'cols': families.ATLAS_COLS, 'rows': families.ATLAS_ROWS, 'tile': families.ATLAS_TILE, 'curve': atlas_info['curve'] if atlas_info else [0.5],
                      'families': {f: {'hero': list(index[f]['hero']), 'mass': list(index[f]['mass'])} for f in index}},
            'barks': BARK_LIST, 'barkTiles': families.BARK_TILES, 'far': far, 'specimens': specs}
    text = ['/* eslint-disable */\n/**\n * Odyssey\'s trees: GENERATED by scripts/blender/odyssey/odyssey_forest.py (do not edit by hand).\n'
            ' * Every specimen\'s near and middle tiers, the leaf atlas plan and the far views\' frames; decoded by\n'
            ' * world/odyssey-forest-models-decode.js, which documents the layout.\n */\nexport const ODYSSEY_FOREST_MODELS = ']
    body = json.dumps(head, separators=(',', ':'))
    body = body.replace('{"id"', '\n{"id"').replace('"specimens":[', '"specimens":[')
    text.append(body[:-1] + ',\n"data":"' + base64.b64encode(bytes(blob)).decode() + '"};\n')
    with open(js_path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(''.join(text))
    return {'bytes': len(blob), 'specimens': len(specs),
            'hero': {s['id']: [s['hero']['cards'], s['hero']['barkIndices'] // 3] for s in specs},
            'mid': {s['id']: [s['mid']['cards'], s['mid']['barkIndices'] // 3] for s in specs}}
