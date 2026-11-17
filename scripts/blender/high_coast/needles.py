"""Needle sprays for the High Coast's Scots pines and Norway spruces.

A Scots pine carries its needles as bottlebrush shoots: a twig's end forks into a leader and a
whorl of side shoots that all turn up to the light, each clothed in short stiff needles swept
forward, with the older needles still standing along the twig behind them. Seen from twenty
metres a needle is finer than a pixel; what reads is the brush (a fuzzy upturned finger, light
on top, dark beneath) and the cloud the brushes of one branch end make together.

The old pine's brushes are ribbons: three slim strips crossed about the shoot's axis, their UVs
laid for a drawn bottlebrush (the theme's needle texture: u across the brush, v from its foot to
its tip), so the needles themselves are lines of that drawing, cut out by its coverage. The
forest's brushes, which are only ever baked into sprites from vertex colour, are serrated blades
instead (real geometry): toothed from every side.

Spray space matches the Fall grove: +Y runs along the twig, +Z is the lit upper side, +X is
across. Vertex colour: R = distance from the shoot (0 on the twig, 1 at the needle tips; on a
ribbon, 0 at the shoot's foot and 1 at its tip), G = per-shoot random id, B = shade inside the
spray, A = 1 on needles / 0 on wood.
"""

import math

import numpy as np

from fall_grove.foliage import SprayBuilder
from fall_grove.skeleton import normalize
from golden_forest import needles as golden

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])


def _brush(builder, base, direction, length, needle, shade, blades=2, segments=6, upturn=0.28, taper=0.1,
           sweep=0.8, serration=0.46):
    """One bottlebrush shoot from `base`: `blades` serrated blades crossed about its axis.

    `needle` is the needle length, `shade` the (base, tip) tone, `upturn` how far the shoot
    bends toward the lit side (+Z) by its tip.
    """
    rng = builder.rng
    direction = normalize(np.asarray(direction, dtype=float))
    ridge = golden._polyline(np.asarray(base, dtype=float), direction, length, segments + 1, bend=Z * upturn)
    reference = Z if abs(direction[2]) < 0.9 else X
    side = normalize(np.cross(direction, reference))
    other = np.cross(direction, side)
    start = float(rng.uniform(0, math.pi))
    for blade in range(blades):
        angle = start + math.pi * blade / blades
        up = side * math.cos(angle) + other * math.sin(angle)
        # A blade whose face looks down is in the brush's own shade.
        facing = 0.82 + 0.18 * abs(float(up[2]))
        golden._strip(builder, ridge, up, needle * float(rng.uniform(0.9, 1.1)), 0.0,
                      (shade[0] * facing, shade[1] * facing), serration=serration, taper=taper, sweep=sweep)


def _ribbon(builder, ridge, up, half, shade, rid):
    """A flat strip along `ridge`, `half` wide to each side, facing `up`: u across, v along."""
    ridge = np.asarray(ridge, dtype=float)
    count = len(ridge)
    positions = []
    colors = []
    uvs = []
    for index in range(count):
        tangent = normalize(ridge[min(index + 1, count - 1)] - ridge[max(index - 1, 0)])
        across = normalize(np.cross(tangent, up))
        t = index / (count - 1)
        tone = shade[0] + (shade[1] - shade[0]) * t
        for side in (-1.0, 1.0):
            positions.append(ridge[index] + across * side * half)
            colors.append((t, rid, tone, 1.0))
            uvs.append((0.5 + 0.5 * side, t))
    positions = np.array(positions)
    triangles = []
    for index in range(count - 1):
        a = index * 2
        b = a + 2
        triangles.extend(((a, a + 1, b), (a + 1, b + 1, b)))
    normals = np.zeros_like(positions)
    for i, j, k in triangles:
        normals[[i, j, k]] += np.cross(positions[j] - positions[i], positions[k] - positions[i])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.where(lengths > 1e-9, normals / np.maximum(lengths, 1e-9), up)
    flip = (normals @ up) < 0
    normals[flip] = -normals[flip]
    builder._append(positions, normals, np.array(uvs), np.array(colors), triangles)
    builder.leaves += 1


def _card_brush(builder, base, direction, length, half, shade, upturn=0.28, segments=2, blades=3):
    """One bottlebrush shoot as `blades` ribbons crossed about its axis (see the module's head)."""
    rng = builder.rng
    direction = normalize(np.asarray(direction, dtype=float))
    ridge = golden._polyline(np.asarray(base, dtype=float), direction, length, segments + 1, bend=Z * upturn)
    reference = Z if abs(direction[2]) < 0.9 else X
    side = normalize(np.cross(direction, reference))
    other = np.cross(direction, side)
    start = float(rng.uniform(0, math.pi))
    rid = float(rng.random())
    for blade in range(blades):
        angle = start + math.pi * blade / blades
        up = side * math.cos(angle) + other * math.sin(angle)
        facing = 0.82 + 0.18 * abs(float(up[2]))
        _ribbon(builder, ridge, up, half * float(rng.uniform(0.9, 1.1)), (shade[0] * facing, shade[1] * facing), rid)


def pine_cards(seed, whorl=4, years=3):
    """The old pine's branch end: three years of a twig's growth. Each year's node carries a
    whorl of side shoots that lean out and turn up (the older the longer), the twig itself is
    clothed between them, and the leader runs on from the last (ribbons, see the head)."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    twig = np.array([[0.0, 0.0, 0.0], [0.012, 0.15, 0.012], [-0.008, 0.3, 0.045], [0.0, 0.44, 0.1]])
    builder.twig(twig, 0.017, sides=3, shade=0.5)
    # The twig's own needles of the years before (shorter, darker).
    _card_brush(builder, twig[0] + Y * 0.04, normalize(twig[3] - twig[0]), 0.42, 0.055, (0.42, 0.6), upturn=0.1)
    for year in range(years):
        node = twig[year + 1]
        age = years - 1 - year                       # 0 this year's whorl
        start = float(rng.uniform(0, math.tau))
        count = whorl if age == 0 else max(2, whorl - 1)
        for index in range(count):
            azimuth = start + math.tau * (index + float(rng.uniform(-0.18, 0.18))) / count
            # The whorl opens round the twig; every shoot leans out and then climbs.
            out = X * math.cos(azimuth) + Z * math.sin(azimuth)
            lean = float(rng.uniform(0.62, 0.95)) + 0.12 * age
            direction = normalize(Y * (1.0 - 0.35 * lean) + out * lean + Z * 0.2)
            under = 0.5 + 0.5 * max(0.0, float(out[2]) * 0.6 + 0.4)
            dim = 1.0 - 0.16 * age
            _card_brush(builder, node - Y * float(rng.uniform(0.0, 0.03)), direction,
                        float(rng.uniform(0.2, 0.28)) * (1.0 + 0.3 * age), 0.062,
                        ((0.62 * under + 0.1) * dim, (0.72 + 0.28 * under) * dim),
                        upturn=float(rng.uniform(0.4, 0.62)))
    # The leader runs on along the twig and turns up.
    _card_brush(builder, twig[3] - Y * 0.02, normalize(Y * 0.9 + Z * 0.32), float(rng.uniform(0.26, 0.34)), 0.066,
                (0.74, 1.0), upturn=0.4)
    return builder


def pine_shoots(seed, lod=0, whorl=4):
    """A pine branchlet's end as serrated blades (the forest's sprays, baked into its sprites)."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    blades = 2
    segments = 6 if lod == 0 else 4
    twig = np.array([[0.0, 0.0, 0.0], [0.012, 0.13, 0.012], [-0.008, 0.26, 0.04], [0.0, 0.38, 0.085]])
    if lod == 0:
        builder.twig(twig, 0.016, sides=3, shade=0.5)
    # Last year's needles still stand along the twig behind the whorl (shorter, darker).
    _brush(builder, twig[1], normalize(twig[3] - twig[1]), 0.25, 0.062, (0.46, 0.62), blades=blades,
           segments=4, upturn=0.1, taper=0.0, sweep=0.7)
    node = twig[3]
    # The leader runs on along the twig and turns up.
    _brush(builder, node, normalize(Y * 0.9 + Z * 0.32), float(rng.uniform(0.26, 0.34)), 0.074, (0.74, 1.0),
           blades=blades, segments=segments, upturn=0.4)
    start = float(rng.uniform(0, math.tau))
    for index in range(whorl):
        azimuth = start + math.tau * (index + float(rng.uniform(-0.18, 0.18))) / whorl
        # The whorl opens round the twig; every shoot leans out and then climbs.
        out = X * math.cos(azimuth) + Z * math.sin(azimuth)
        lean = float(rng.uniform(0.62, 0.95))
        direction = normalize(Y * (1.0 - 0.35 * lean) + out * lean + Z * 0.2)
        under = 0.5 + 0.5 * max(0.0, float(out[2]) * 0.6 + 0.4)
        _brush(builder, node - Y * float(rng.uniform(0.0, 0.03)), direction, float(rng.uniform(0.2, 0.3)), 0.07,
               (0.62 * under + 0.1, 0.72 + 0.28 * under), blades=blades, segments=segments,
               upturn=float(rng.uniform(0.4, 0.62)))
    return builder


def pine_bough(seed, lod=1):
    """A coarser branch end for the forest's pines: fewer, longer brushes (baked into sprites only)."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    twig = np.array([[0.0, 0.0, 0.0], [0.01, 0.16, 0.02], [0.0, 0.32, 0.07]])
    _brush(builder, twig[0], normalize(twig[2] - twig[0]), 0.34, 0.085, (0.5, 0.7), blades=2, segments=3,
           upturn=0.12, taper=0.0, sweep=0.6)
    node = twig[2]
    _brush(builder, node, normalize(Y * 0.9 + Z * 0.35), 0.3, 0.105, (0.76, 1.0), blades=3, segments=4, upturn=0.34)
    start = float(rng.uniform(0, math.tau))
    for index in range(5):
        azimuth = start + math.tau * (index + float(rng.uniform(-0.2, 0.2))) / 5
        out = X * math.cos(azimuth) + Z * math.sin(azimuth)
        lean = float(rng.uniform(0.7, 1.05))
        under = 0.5 + 0.5 * max(0.0, float(out[2]) * 0.6 + 0.4)
        _brush(builder, node, normalize(Y * (1.0 - 0.35 * lean) + out * lean + Z * 0.2),
               float(rng.uniform(0.22, 0.3)), 0.1, (0.6 * under + 0.1, 0.72 + 0.28 * under), blades=2, segments=3,
               upturn=float(rng.uniform(0.3, 0.5)))
    return builder


SPRAY_BUILDERS = {
    # The old pine's own sprays: variant 0 a full whorl, variant 1 a sparser one.
    "pine_shoots": lambda index: pine_cards(7100 + index * 13, whorl=4 if index == 0 else 3),
    # The forest's, baked into its sprites: never shipped as meshes.
    "pine_bough": lambda index: pine_shoots(7300 + index * 17, lod=1, whorl=5 if index == 0 else 4),
    "spruce_bough": lambda index: golden.spruce_bough(7500 + index * 19, lod=1, hang=1.0 if index == 0 else 0.55),
}
# The sprays the theme draws as meshes (the rest only stand in the bake).
SHIPPED = ("pine_shoots",)
# How far a spray reaches from its site, as a share of the site scale (for occlusion hulls).
SPRAY_REACH = {"pine_shoots": 0.6, "pine_bough": 0.62, "spruce_bough": 0.62}
# What a spray's `leaves` count: brush blades (pines) or shoot strips (spruce).
SPRAY_UNITS = {"pine_shoots": "ribbons", "pine_bough": "blades", "spruce_bough": "strips"}
