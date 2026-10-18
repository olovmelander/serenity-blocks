"""Leaf and needle sprays for Grainfields.

All three are light sprays for trees seen from 90 m to 3 km:

- `birch_sprig`: a shirakaba twig of a dozen plain kite leaves. The Summer meadow's
  `birch_strand` (its leaf outline and builder), held out instead of hung: the twig only
  bows, and the leaves stand off it to the sides and toward the light.
- `spruce_frond`: the Golden Forest's light spruce bough section (lod 1), with shorter
  pendulous branchlets than Summer's, as an Ezo spruce carries them.
- `larch_tuft`: a larch branchlet with soft tufts of needles along it, one tuft per spur
  shoot. It is the Golden Forest's pine clump made small and many: each tuft is a burst of
  that clump's needle bundles (single kites), opening upward and outward from its spur.

Spray space matches the Fall grove: +Y runs along the twig, +Z is the lit side, +X is
across. Vertex colour: R = distance from the leaf base or the spur (flutter weight),
G = per-leaf or per-tuft random id, B = shade inside the spray, A = 1 on leaves and needles /
0 on wood.
"""

import math

import numpy as np

from fall_grove.foliage import SprayBuilder
from fall_grove.skeleton import GOLDEN, normalize, perpendicular, rotate_about
from golden_forest import needles
from summer_meadow.leaves import birch_leaf

from .species import BIRCH_FOLIAGE, LARCH_FOLIAGE, SPRUCE_FOLIAGE

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])


def _along(twig, t):
    """Point and unit direction at share `t` of a polyline of equal segments."""
    segments = len(twig) - 1
    scaled = min(max(t, 0.0), 1.0) * segments
    segment = min(int(scaled), segments - 1)
    local = scaled - segment
    return twig[segment] * (1.0 - local) + twig[segment + 1] * local, normalize(twig[segment + 1] - twig[segment])


def birch_sprig(seed, leaves=14, leaf_size=0.23, bow=0.08):
    """A white birch twig held out from its limb, its leaves spread to the sides and the sky."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = birch_leaf(1, fold=0.16, droop=0.1)
    segments = 4
    twig = [np.zeros(3)]
    heading = np.array([rng.uniform(-0.08, 0.08), 1.0, 0.02])
    for _ in range(segments):
        heading = normalize(heading + np.array([rng.uniform(-0.08, 0.08), 0.0, -bow]))
        twig.append(twig[-1] + heading * (1.0 / segments))
    twig = np.array(twig)
    builder.twig(twig, 0.01, sides=3, shade=0.5)
    for index in range(leaves):
        t = 0.12 + 0.88 * (index + rng.uniform(0.1, 0.9)) / leaves
        origin, forward = _along(twig, t)
        side = -1.0 if index % 2 else 1.0
        # Leaves stand out sideways and a little up, not hanging under the twig.
        axis = normalize(forward * 0.45 + np.array([side * rng.uniform(0.55, 1.0), 0.0, rng.uniform(-0.25, 0.3)]))
        facing = normalize(np.array([rng.uniform(-0.45, 0.45), rng.uniform(-0.4, 0.4), 1.0]))
        builder.leaf(template, origin + axis * leaf_size * 0.3, axis, facing, leaf_size * rng.uniform(0.8, 1.2),
                     shade=0.8 + 0.2 * t, twist=rng.uniform(-0.5, 0.5))
    return builder


def larch_tuft(seed, tufts=8, needles_per_tuft=6, droop=0.12):
    """A larch branchlet: soft tufts of needles on spur shoots, alternating along a short twig.

    The twig itself is left to the bark mesh (the branchlets the sprays sit on are modelled
    there); the spray is all needle, so it reads as a feathery mass with light between tufts.
    """
    builder = SprayBuilder(seed)
    rng = builder.rng
    twig = needles._polyline(np.zeros(3), normalize(np.array([rng.uniform(-0.05, 0.05), 1.0, 0.0])), 1.0, 7,
                             bend=Z * -droop)
    start = rng.uniform(0, math.tau)
    for index in range(tufts):
        t = 0.06 + 0.9 * (index + rng.uniform(0.25, 0.75)) / tufts
        origin, forward = _along(twig, t)
        side = -1.0 if index % 2 else 1.0
        spur = origin + X * side * rng.uniform(0.015, 0.05) + Z * 0.015
        # Each tuft opens like a shaving brush, up and out from its spur.
        axis = normalize(Z * 0.9 + X * side * rng.uniform(0.3, 0.6) + forward * 0.25 + rng.normal(size=3) * 0.08)
        size = rng.uniform(0.16, 0.2) * (1.0 - 0.3 * t)
        around = perpendicular(axis)
        offset = start + index * GOLDEN
        for needle in range(needles_per_tuft):
            radial = rotate_about(around, axis, offset + math.tau * (needle + rng.uniform(-0.2, 0.2)) / needles_per_tuft)
            cone = math.radians(rng.uniform(30, 62))
            direction = normalize(axis * math.cos(cone) + radial * math.sin(cone))
            needles._needle_bundle(builder, spur, direction, size * rng.uniform(0.82, 1.15), size * 0.3,
                                   0.6 + 0.4 * max(0.0, float(direction[2])), crossed=False)
    # needle bundles count themselves; the spray's unit is the tuft
    builder.leaves = tufts
    return builder


SPRAY_BUILDERS = {
    # Variant 0 is the fuller spray (low and outer crown), variant 1 a shorter, sparser one.
    BIRCH_FOLIAGE: lambda index: birch_sprig(14100 + index * 13, leaves=14 if index == 0 else 12),
    SPRUCE_FOLIAGE: lambda index: needles.spruce_bough(14300 + index * 17, lod=1, hang=(0.8, 0.45)[index]),
    LARCH_FOLIAGE: lambda index: larch_tuft(14500 + index * 19, tufts=8 if index == 0 else 7),
}
# How far a spray reaches from its site, as a share of the site scale (for occlusion hulls).
SPRAY_REACH = {BIRCH_FOLIAGE: 0.58, SPRUCE_FOLIAGE: 0.62, LARCH_FOLIAGE: 0.55}
# What counts a spray's leaves in its record: leaves on a birch, shoots on a spruce, tufts on a larch.
SPRAY_UNITS = {BIRCH_FOLIAGE: "leaves", SPRUCE_FOLIAGE: "shoots", LARCH_FOLIAGE: "tufts"}
