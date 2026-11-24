"""
The spray families (Odyssey's forest, 2026-11-24): which sprays a family draws, its leaf colours for the
previews, and the tiles it fills in the leaf atlas.

  hero   sprays for the near trees' cards (one card, one twig with its leaves)
  mass   boughs for the middle distance (one card, a branch's worth of sprays)
"""

from sprays import (blossom_spray, cypress_spray, fern_frond, fir_bough, larch_spray, moss_tuft, leafy_spray, mass_spray, pine_tuft, spruce_bough,
                    willow_curtain)


def _oak(seed):
    return leafy_spray(seed, 'oak', leaf_len=0.25, leaf_w=0.27)


def _beech(seed):
    return leafy_spray(seed, 'ovate', leaf_len=0.19, leaf_w=0.21, per=12, twigs=10, fill=0.55)


def _birch(seed):
    return leafy_spray(seed, 'birch', leaf_len=0.145, leaf_w=0.18, twigs=13, per=12, droop=0.7, fill=0.35)


def _aspen(seed):
    return leafy_spray(seed, 'aspen', leaf_len=0.16, leaf_w=0.19, twigs=11, per=12, fill=0.4)


def _maple(seed):
    return leafy_spray(seed, 'maple', leaf_len=0.25, leaf_w=0.27, twigs=10, per=9, fill=0.5)


def _shrub(seed):
    return leafy_spray(seed, 'ovate', leaf_len=0.15, leaf_w=0.16, twigs=12, per=13, fill=0.6)


def _hawthorn(seed):
    return leafy_spray(seed, 'ovate', leaf_len=0.15, leaf_w=0.17, twigs=12, per=11, fill=0.5, flower=0.42)


def _willowtop(seed):
    return leafy_spray(seed, 'willow', leaf_len=0.27, leaf_w=0.28, twigs=12, per=12, droop=0.8, fill=0.6)


def _fern(seed):
    return fern_frond(seed)


def _bracken(seed):
    return fern_frond(seed, pinnae=13, kind='bracken', width=0.72)


# name -> (maker, hero variants, mass maker or None, mass variants, preview colour)
FAMILIES = {
    'oak': (_oak, 4, _oak, 2, (0.16, 0.30, 0.06)),
    'beech': (_beech, 4, _beech, 2, (0.13, 0.29, 0.07)),
    'birch': (_birch, 3, _birch, 2, (0.24, 0.38, 0.08)),
    'aspen': (_aspen, 3, _aspen, 2, (0.62, 0.42, 0.05)),
    'maple': (_maple, 3, _maple, 2, (0.50, 0.07, 0.03)),
    'cherry': (blossom_spray, 4, blossom_spray, 2, (0.75, 0.38, 0.50)),
    'willow': (willow_curtain, 3, None, 0, (0.28, 0.40, 0.10)),
    'willowtop': (_willowtop, 2, None, 0, (0.28, 0.40, 0.10)),
    'spruce': (spruce_bough, 4, None, 0, (0.05, 0.15, 0.08)),
    'fir': (fir_bough, 3, None, 0, (0.05, 0.17, 0.11)),
    'larch': (larch_spray, 3, None, 0, (0.28, 0.42, 0.12)),
    'pine': (pine_tuft, 4, pine_tuft, 2, (0.11, 0.24, 0.08)),
    'cypress': (cypress_spray, 3, None, 0, (0.06, 0.14, 0.06)),
    'shrub': (_shrub, 2, None, 0, (0.18, 0.30, 0.08)),
    'hawthorn': (_hawthorn, 2, None, 0, (0.20, 0.33, 0.10)),
    # the forest floor (2026-11-24): after the bark's three tiles, so nothing before them moved
    'fern': (_fern, 3, None, 0, (0.20, 0.38, 0.07)),
    'bracken': (_bracken, 2, None, 0, (0.26, 0.40, 0.07)),
    'moss': (moss_tuft, 2, None, 0, (0.16, 0.26, 0.04)),
}

# The bark's tiles stand where the first families end.
BARK_FIRST, BARK_COUNT = 61, 3

# The bark: three tiles at the atlas's end, and which each bark wears.
BARK_KINDS = ['rough', 'birch', 'plate']
BARK_TILES = {'brown': 61, 'oak': 61, 'grey': 61, 'dark': 61, 'cherry': 62, 'silver': 61, 'birch': 62, 'aspen': 62, 'pine': 63}

ATLAS_TILE = 128
ATLAS_COLS = 8
ATLAS_ROWS = 9


def atlas_plan():
    """[(family, 'hero'|'mass', variant, tile index)] in atlas order, and {family: {hero: (first, n), mass: (first, n)}}."""
    plan = []
    index = {}
    tile = 0
    for fam, (_maker, heroes, mass, masses, _c) in FAMILIES.items():
        index[fam] = {}
        if tile == BARK_FIRST:
            tile += BARK_COUNT
        index[fam]['hero'] = (tile, heroes)
        for k in range(heroes):
            plan.append((fam, 'hero', k, tile))
            tile += 1
        if masses:
            index[fam]['mass'] = (tile, masses)
            for k in range(masses):
                plan.append((fam, 'mass', k, tile))
                tile += 1
        else:
            index[fam]['mass'] = index[fam]['hero']
    assert tile <= ATLAS_COLS * ATLAS_ROWS, tile
    assert not any(BARK_FIRST <= p[3] < BARK_FIRST + BARK_COUNT for p in plan)
    return plan, index


def make_spray(fam, kind, variant):
    maker, _h, mass, _m, _c = FAMILIES[fam]
    seed = 100 + 37 * list(FAMILIES).index(fam) + variant
    if kind == 'hero':
        return maker(seed)
    return mass_spray(seed + 500, mass, count=8 if fam != 'cherry' else 7, shrink=0.50)
