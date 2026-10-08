"""Leaf and needle sprays for the Summer meadow.

A birch leaf is triangular-ovate with a drawn-out point and a toothed margin; it hangs
from a slender stalk and never keeps still. The hero birch wears `birch_spray`: a hanging
twig about a metre long carrying real, serrated leaves. The birches of the middle distance
wear the lighter `birch_strand`. The spruce sections are the Golden Forest's.

Spray space matches the Fall grove: +Y runs along the twig (for a hanging shoot that is
down), +Z is the lit side, +X is across. Vertex colour: R = distance from the leaf base
(flutter weight; on a needle section, from the shoot to the needle tips), G = per-leaf
random id, B = shade inside the spray, A = 1 on leaves / 0 on wood.
"""

import math

import numpy as np

from fall_grove.foliage import SprayBuilder
from fall_grove.skeleton import GOLDEN, normalize
from golden_forest import needles

from .species import SPRUCE_GROVE_FOLIAGE, SPRUCE_HERO_FOLIAGE

X = np.array([1.0, 0.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])

# Right-hand outlines from the stalk (0, 0) to the tip (0, 1); mirrored for the left.
# Level 0 is broadest low down, with three teeth a side and a long point.
BIRCH_OUTLINES = {
    0: [(0.20, 0.02), (0.40, 0.16), (0.36, 0.25), (0.39, 0.33), (0.29, 0.44), (0.29, 0.54), (0.19, 0.64),
        (0.16, 0.76), (0.06, 0.88)],
    1: [(0.4, 0.2), (0.21, 0.64)],
}
BIRCH_WIDTH = 0.92


def birch_leaf(lod=0, fold=0.2, droop=0.14):
    """Vertices (x, y, z), UVs and triangles of one unit-length birch leaf."""
    right = [(x * BIRCH_WIDTH, y) for x, y in BIRCH_OUTLINES[lod]]
    left = [(-x, y) for x, y in reversed(right)]
    rim = right + [(0.0, 1.0)] + left
    extent = max(abs(x) for x, _ in rim)
    low = min(y for _, y in rim)
    vertices = [(0.0, 0.0, 0.0)]
    uvs = [(0.5, (0.0 - low) / (1.0 - low))]
    for x, y in rim:
        # Folded along the midrib, curled toward the tip.
        vertices.append((x, y, fold * abs(x) - droop * max(0.0, y) ** 2 * 0.6 - 0.12 * x * x))
        uvs.append((0.5 + 0.5 * x / extent, (y - low) / (1.0 - low)))
    triangles = [(0, index, index + 1) for index in range(1, len(rim))]
    return np.array(vertices), np.array(uvs), np.array(triangles)


def _along(twig, t):
    """Point and unit direction at share `t` of a polyline of equal segments."""
    segments = len(twig) - 1
    scaled = min(max(t, 0.0), 1.0) * segments
    segment = min(int(scaled), segments - 1)
    local = scaled - segment
    return twig[segment] * (1.0 - local) + twig[segment + 1] * local, normalize(twig[segment + 1] - twig[segment])


def birch_spray(seed, leaves=17, length=1.0, leaf_size=0.128):
    """A hanging birch twig: leaves on slender stalks all round it, each facing its own way."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = birch_leaf(0)
    segments = 6
    twig = [np.zeros(3)]
    heading = normalize(np.array([rng.uniform(-0.05, 0.05), 1.0, rng.uniform(-0.05, 0.05)]))
    for _ in range(segments):
        heading = normalize(heading + np.array([rng.uniform(-0.1, 0.1), 0.0, rng.uniform(-0.1, 0.1)]))
        twig.append(twig[-1] + heading * (length / segments))
    twig = np.array(twig)
    builder.twig(twig, 0.0065, sides=3, shade=0.5)
    start = rng.uniform(0, math.tau)
    for index in range(leaves):
        t = 0.05 + 0.95 * (index + rng.uniform(0.2, 0.8)) / leaves
        origin, forward = _along(twig, t)
        azimuth = start + index * GOLDEN + rng.uniform(-0.5, 0.5)
        radial = X * math.cos(azimuth) + Z * math.sin(azimuth)
        radial = normalize(radial - forward * float(np.dot(radial, forward)))
        # The blade hangs from its stalk, leaning out of the line of the twig.
        axis = normalize(forward + radial * rng.uniform(0.3, 0.85))
        base = origin + normalize(forward * 0.6 + radial) * leaf_size * rng.uniform(0.25, 0.45)
        facing = normalize(Z + radial * 0.6 + rng.normal(size=3) * 0.35)
        size = leaf_size * rng.uniform(0.8, 1.2) * (1.0 - 0.3 * max(0.0, t - 0.8) / 0.2)
        builder.leaf(template, base, axis, facing, size, shade=0.76 + 0.24 * rng.random(),
                     twist=rng.uniform(-0.5, 0.5), cup=rng.uniform(-0.04, 0.1))
    return builder


def birch_strand(seed, leaves=13, leaf_size=0.2):
    """The far level of detail: a drooping twig of a dozen plain kite-shaped leaves."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = birch_leaf(1, fold=0.16, droop=0.12)
    segments = 4
    twig = [np.zeros(3)]
    heading = np.array([rng.uniform(-0.1, 0.1), 1.0, -0.05])
    for _ in range(segments):
        heading = normalize(heading + np.array([rng.uniform(-0.1, 0.1), 0.0, -0.2]))
        twig.append(twig[-1] + heading * (1.0 / segments))
    twig = np.array(twig)
    builder.twig(twig, 0.01, sides=3, shade=0.5)
    for index in range(leaves):
        t = 0.12 + 0.88 * (index + rng.uniform(0.1, 0.9)) / leaves
        origin, forward = _along(twig, t)
        side = -1.0 if index % 2 else 1.0
        axis = normalize(forward * 0.4 + np.array([side * rng.uniform(0.55, 1.0), 0.0, rng.uniform(-0.75, -0.1)]))
        facing = normalize(np.array([rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 1.0]))
        builder.leaf(template, origin + axis * leaf_size * 0.3, axis, facing, leaf_size * rng.uniform(0.78, 1.2),
                     shade=0.8 + 0.2 * t, twist=rng.uniform(-0.6, 0.6))
    return builder


SPRAY_BUILDERS = {
    # Variant 0 is the fuller twig, variant 1 a shorter, sparser one.
    "birch_spray": lambda index: birch_spray(5100 + index * 13, leaves=18 if index == 0 else 15,
                                             length=1.0 if index == 0 else 0.9),
    "birch_strand": lambda index: birch_strand(5300 + index * 17),
    # Variant 0 hangs long (lower crown), variant 1 short (upper crown).
    SPRUCE_HERO_FOLIAGE: lambda index: needles.spruce_bough(5500 + index * 19, lod=0, hang=(1.0, 0.55)[index]),
    SPRUCE_GROVE_FOLIAGE: lambda index: needles.spruce_bough(5700 + index * 23, lod=1, hang=(1.0, 0.55)[index]),
}
# How far a spray reaches from its site, as a share of the site scale (for occlusion hulls).
SPRAY_REACH = {"birch_spray": 0.5, "birch_strand": 0.6, SPRUCE_HERO_FOLIAGE: 0.6, SPRUCE_GROVE_FOLIAGE: 0.62}
# What counts a spray's leaves in its record: leaves on a birch, shoots on a spruce.
SPRAY_UNITS = {"birch_spray": "leaves", "birch_strand": "leaves", SPRUCE_HERO_FOLIAGE: "shoots",
               SPRUCE_GROVE_FOLIAGE: "shoots"}
