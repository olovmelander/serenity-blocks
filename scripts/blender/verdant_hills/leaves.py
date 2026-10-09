"""Leaf sprays for Verdant Hills: the pedunculate oak.

An oak leaf is obovate, broadest beyond its middle, with three or four rounded lobes a side
and deep, rounded sinuses between them; it sits almost stalkless on the shoot. The leaves
crowd at the end of each year's growth, so a shoot ends in a rosette. The hero wears
`oak_spray`: a stiff, angular twig with a rosette at its end, one or two on short side
shoots and a few leaves along it. The field trees wear the lighter `oak_tuft`: one domed
rosette of plainer leaves on a short stalk.

Spray space matches the Fall grove: +Y runs along the twig, +Z is the lit side, +X is
across. Vertex colour: R = distance from the leaf base (flutter weight), G = per-leaf
random id, B = shade inside the spray, A = 1 on leaves / 0 on wood.
"""

import math

import numpy as np

from fall_grove.foliage import SprayBuilder
from fall_grove.skeleton import GOLDEN, normalize

from .species import FIELD_FOLIAGE, HERO_FOLIAGE

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])

# The right-hand half of a leaf from the stalk (0, 0) to the tip (0, 1): for each stretch of
# the midrib, where it starts, the rim points of the lobe it carries, and the sinus that
# ends the lobe (None on the last, which runs to the tip). Mirrored for the left half.
OAK_LOBES = {
    0: [(0.0, [(0.15, 0.12)], (0.07, 0.22)),
        (0.22, [(0.26, 0.31), (0.28, 0.4)], (0.11, 0.48)),
        (0.48, [(0.33, 0.57), (0.32, 0.67)], (0.13, 0.75)),
        (0.75, [(0.21, 0.87)], None)],
    1: [(0.0, [(0.21, 0.2)], (0.1, 0.4)),
        (0.4, [(0.33, 0.6), (0.2, 0.86)], None)],
}
OAK_WIDTH = 0.9


def oak_leaf(lod=0, fold=0.2, droop=0.14, wave=0.03):
    """Vertices (x, y, z), UVs and triangles of one unit-length oak leaf.

    The blade is two strips hung on the midrib, so it folds along it and each lobe is a
    little fan of its own: a deep sinus never has to be bridged from the stalk.
    """
    lobes = OAK_LOBES[lod]
    flat = []                     # (x, y, lobe index or -1 on the midrib and in a sinus)
    triangles = []

    def vertex(x, y, lobe=-1):
        flat.append((x, y, lobe))
        return len(flat) - 1

    ribs = [vertex(0.0, start) for start, _rim, _sinus in lobes]
    tip = vertex(0.0, 1.0)
    for side in (1.0, -1.0):
        previous = None
        for index, (_start, rim, sinus) in enumerate(lobes):
            chain = [] if previous is None else [previous]
            chain += [vertex(side * x * OAK_WIDTH, y, index) for x, y in rim]
            following = tip if sinus is None else vertex(side * sinus[0] * OAK_WIDTH, sinus[1])
            chain.append(following)
            for first, second in zip(chain, chain[1:]):
                triangles.append((ribs[index], first, second) if side > 0 else (ribs[index], second, first))
            if sinus is not None:
                triangles.append((ribs[index], following, ribs[index + 1]) if side > 0
                                 else (ribs[index], ribs[index + 1], following))
            previous = following
    extent = max(abs(x) for x, _y, _lobe in flat)
    vertices = []
    uvs = []
    for x, y, lobe in flat:
        # Folded along the midrib, curled toward the tip, and the lobes ripple a little.
        ripple = wave * (1.0 if lobe % 2 else -1.0) if lobe >= 0 else 0.0
        vertices.append((x, y, fold * abs(x) - droop * y * y * 0.6 - 0.12 * x * x + ripple))
        uvs.append((0.5 + 0.5 * x / extent, y))
    return np.array(vertices), np.array(uvs), np.array(triangles)


def _along(twig, t):
    """Point and unit direction at share `t` of a polyline of equal segments."""
    segments = len(twig) - 1
    scaled = min(max(t, 0.0), 1.0) * segments
    segment = min(int(scaled), segments - 1)
    local = scaled - segment
    return twig[segment] * (1.0 - local) + twig[segment + 1] * local, normalize(twig[segment + 1] - twig[segment])


def _rosette(builder, template, point, axis, count, leaf_size, splay=(42.0, 82.0), shade=(0.78, 1.0), flatten=0.5):
    """Leaves crowded round the end of a shoot, opening like a hand toward the light (+Z)."""
    rng = builder.rng
    axis = normalize(axis)
    across = normalize(np.cross(axis, Z))
    lit = np.cross(across, axis)
    start = float(rng.uniform(0, math.tau))
    for index in range(count):
        azimuth = start + index * GOLDEN + float(rng.uniform(-0.3, 0.3))
        share = index / max(1, count - 1)
        # The first leaves stand nearly along the shoot; the later ones lie back round it.
        tilt = math.radians(splay[0] + (splay[1] - splay[0]) * share + float(rng.uniform(-8.0, 8.0)))
        radial = across * math.cos(azimuth) + lit * math.sin(azimuth) * flatten
        radial = normalize(radial + lit * 0.12)
        direction = normalize(axis * math.cos(tilt) + radial * math.sin(tilt))
        facing = normalize(Z + radial * 0.4 + rng.normal(size=3) * 0.22)
        size = leaf_size * float(rng.uniform(0.82, 1.18)) * (1.0 - 0.18 * share)
        builder.leaf(template, point + direction * leaf_size * float(rng.uniform(0.02, 0.08)), direction, facing, size,
                     shade=shade[0] + (shade[1] - shade[0]) * float(rng.random()),
                     twist=float(rng.uniform(-0.45, 0.45)), cup=float(rng.uniform(-0.03, 0.09)))


def oak_spray(seed, leaves=17, length=0.74, leaf_size=0.215, side_shoots=2):
    """The hero's spray: a stiff zig-zag twig, a rosette at its end and on each short side shoot."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = oak_leaf(0)
    segments = 4
    sign = 1.0 if rng.random() < 0.5 else -1.0
    twig = [np.zeros(3)]
    for index in range(1, segments + 1):
        # Elbows to alternate sides; the twig lifts gently toward the light.
        elbow = 0.0 if index == segments else sign * 0.03 * (1.0 if index % 2 else -1.0)
        twig.append(np.array([elbow, length * index / segments, 0.02 * index + float(rng.uniform(-0.01, 0.01))]))
    twig = np.array(twig)
    builder.twig(twig, 0.011, sides=3, shade=0.5)
    tip_axis = normalize(twig[-1] - twig[-2])
    crowded = 6 if leaves >= 16 else 5
    spare = leaves - crowded
    shoots = []
    for index in range(side_shoots):
        t = (0.34, 0.62)[index] if side_shoots > 1 else 0.5
        origin, forward = _along(twig, t)
        side = sign * (1.0 if index % 2 == 0 else -1.0)
        direction = normalize(forward * 0.62 + X * side * 0.78 + Z * float(rng.uniform(0.0, 0.16)))
        reach = float(rng.uniform(0.24, 0.32))
        elbow = origin + direction * reach * 0.55 + forward * 0.02
        end = origin + direction * reach + forward * 0.05
        builder.twig(np.array([origin, elbow, end]), 0.008, sides=3, shade=0.5)
        shoots.append((end, normalize(end - elbow)))
    per_shoot = [4 if spare - 4 * len(shoots) >= 2 else 3] * len(shoots)
    for (end, direction), count in zip(shoots, per_shoot):
        _rosette(builder, template, end, direction, count, leaf_size * 0.94, splay=(35.0, 80.0), shade=(0.72, 0.95))
    # The leaves left over stand singly along the outer half of the twig.
    single = spare - sum(per_shoot)
    start = float(rng.uniform(0, math.tau))
    for index in range(single):
        t = 0.3 + 0.6 * (index + float(rng.uniform(0.2, 0.8))) / max(1, single)
        origin, forward = _along(twig, t)
        azimuth = start + index * GOLDEN
        radial = normalize(X * math.cos(azimuth) + Z * (0.25 + 0.5 * math.sin(azimuth)))
        direction = normalize(forward * 0.55 + radial * 0.85)
        builder.leaf(template, origin + direction * leaf_size * 0.06, direction,
                     normalize(Z + radial * 0.3 + rng.normal(size=3) * 0.2), leaf_size * float(rng.uniform(0.75, 1.0)),
                     shade=0.7 + 0.2 * float(rng.random()), twist=float(rng.uniform(-0.4, 0.4)),
                     cup=float(rng.uniform(-0.03, 0.08)))
    _rosette(builder, template, twig[-1], tip_axis, crowded, leaf_size, splay=(20.0, 84.0), shade=(0.82, 1.0))
    return builder


def oak_tuft(seed, leaves=11, leaf_size=0.4):
    """The far level of detail: one domed rosette of plain, two-lobed leaves on a short stalk."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = oak_leaf(1, fold=0.16, droop=0.2, wave=0.0)
    heart = np.array([float(rng.uniform(-0.03, 0.03)), 0.5, 0.1])
    builder.twig(np.array([np.zeros(3), heart * np.array([1.0, 0.55, 0.4]), heart]), 0.014, sides=3, shade=0.5)
    start = float(rng.uniform(0, math.tau))
    for index in range(leaves):
        azimuth = start + math.tau * (index + float(rng.uniform(-0.3, 0.3))) / leaves
        ring = 0.3 + 0.7 * ((index * 0.618) % 1.0)
        outward = np.array([math.cos(azimuth), math.sin(azimuth) * 0.9 + 0.12, 0.0])
        direction = normalize(outward + Z * (0.28 - 0.62 * ring + float(rng.uniform(-0.12, 0.12))))
        base = heart + outward * 0.07 * ring + Z * float(rng.uniform(-0.06, 0.06))
        facing = normalize(np.array([outward[0] * 0.45, outward[1] * 0.3, 1.0]) + rng.normal(size=3) * 0.16)
        builder.leaf(template, base, direction, facing, leaf_size * float(rng.uniform(0.82, 1.15)),
                     shade=0.74 + 0.26 * ring, twist=float(rng.uniform(-0.4, 0.4)), cup=float(rng.uniform(0.0, 0.1)))
    return builder


SPRAY_BUILDERS = {
    # Variant 0 is the fuller twig (two side shoots), variant 1 a lighter one (a single side shoot).
    HERO_FOLIAGE: lambda index: oak_spray(6500 + index * 13, leaves=17 if index == 0 else 14,
                                          length=0.74 if index == 0 else 0.68, side_shoots=2 if index == 0 else 1),
    FIELD_FOLIAGE: lambda index: oak_tuft(6700 + index * 17, leaves=11 if index == 0 else 9),
}
# How far a spray reaches from its site, as a share of the site scale (for occlusion hulls).
SPRAY_REACH = {HERO_FOLIAGE: 0.52, FIELD_FOLIAGE: 0.6}
# What counts a spray's leaves in its record.
SPRAY_UNITS = {HERO_FOLIAGE: "leaves", FIELD_FOLIAGE: "leaves"}
