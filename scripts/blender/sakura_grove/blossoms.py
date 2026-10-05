"""Blossom geometry for the Sakura Twilight grove.

Cherry blossom is real geometry, like the Fall grove's leaves (no alpha cards): five
notched petals to a flower, a few flowers to an umbel, a few umbels to a twig. A spray is
the unit the canopy instances.

Spray space is the one fall_grove.foliage uses: +Y runs along the twig, +Z is the lit upper
side, +X is across.
Vertex colour: R = distance along a petal from the flower's heart (0) to its tip (1),
G = per-flower random id, B = shade inside the spray, A = 1 on petals / 0 on wood.
"""

import math

import numpy as np

from fall_grove.foliage import SprayBuilder
from fall_grove.skeleton import normalize, perpendicular

# Right-hand outline of one petal from its claw (0, 0) toward the tip; mirrored for the left.
PETAL_HALF = {
    0: [(0.20, 0.24), (0.36, 0.56), (0.30, 0.86), (0.13, 1.0)],
    1: [(0.34, 0.55), (0.14, 1.0)],
    2: [(0.36, 0.58)],
}
# Where the midrib meets the rim: below 1 cuts the notch a cherry petal ends in.
PETAL_NOTCH = {0: 0.87, 1: 0.86, 2: 1.0}
PETAL_WIDTH = 0.36


def petal_template(lod, cup=0.26, curl=0.16):
    """Vertices (x, y, z), UVs and triangles of one unit-length petal."""
    right = PETAL_HALF[lod]
    left = [(-x, y) for x, y in reversed(right)]
    rim = right + [(0.0, PETAL_NOTCH[lod])] + left
    vertices = [(0.0, 0.0, 0.0)]
    uvs = [(0.5, 0.0)]
    for x, y in rim:
        # Cupped across its width and rolled back a little toward the tip.
        lift = cup * 0.3 * (x / PETAL_WIDTH) ** 2 - curl * 0.3 * y * y
        vertices.append((x, y, lift))
        uvs.append((0.5 + 0.5 * x / PETAL_WIDTH, y))
    triangles = [(0, index, index + 1) for index in range(1, len(rim))]
    return np.array(vertices), np.array(uvs), np.array(triangles)


class BlossomBuilder(SprayBuilder):
    """A SprayBuilder that knows how to open a five-petalled flower."""

    def __init__(self, seed):
        super().__init__(seed)
        self.flowers = 0

    def flower(self, template, centre, facing, size, shade=1.0, openness=0.3, spin=0.0):
        """`openness` is the angle (radians) the petals rise out of the flower's plane."""
        facing = normalize(np.asarray(facing, dtype=float))
        u = perpendicular(facing)
        w = np.cross(facing, u)
        identity = float(self.rng.random())
        centre = np.asarray(centre, dtype=float)
        for index in range(5):
            angle = spin + index * math.tau / 5.0
            radial = u * math.cos(angle) + w * math.sin(angle)
            axis = normalize(radial * math.cos(openness) + facing * math.sin(openness))
            normal = normalize(facing * math.cos(openness) - radial * math.sin(openness))
            self.leaf(template, centre + radial * size * 0.05, axis, normal, size, shade=shade)
            self.colors[-1][:, 1] = identity
        self.flowers += 1


def _zigzag_twig(rng, nodes, length, lean=0.05, kink=0.2, sink=0.05):
    """Cherry twigs change direction at every bud."""
    twig = [np.zeros(3)]
    heading = np.array([rng.uniform(-0.08, 0.08), 1.0, lean])
    for step in range(1, nodes + 2):
        side = 1.0 if step % 2 else -1.0
        heading = normalize(heading + np.array([side * rng.uniform(0.3, 1.0) * kink, 0.0,
                                                rng.uniform(-0.5, 0.5) * kink - sink]))
        twig.append(twig[-1] + heading * (length / (nodes + 1)))
    return np.array(twig)


def _ring_frame(forward):
    u = perpendicular(forward)
    return u, np.cross(forward, u)


def blossom_spray(seed, lod=1, nodes=4, petal=0.088, wood=True):
    """A flowering twig for the near trees: an umbel of open flowers at every bud."""
    builder = BlossomBuilder(seed)
    rng = builder.rng
    template = petal_template(lod)
    twig = _zigzag_twig(rng, nodes, 1.0)
    if wood:
        builder.twig(twig, 0.013, sides=3, shade=0.55)
    for node in range(1, nodes + 2):
        origin = twig[node]
        forward = normalize(twig[min(node + 1, len(twig) - 1)] - twig[node - 1])
        u, w = _ring_frame(forward)
        tip = node == nodes + 1
        count = 3 if tip else int(rng.integers(2, 4))
        start = float(rng.uniform(0, math.tau))
        progress = node / (nodes + 1)
        for index in range(count):
            azimuth = start + index * math.tau / count + rng.uniform(-0.35, 0.35)
            radial = u * math.cos(azimuth) + w * math.sin(azimuth)
            # Flowers stand out around the twig and lean a little toward its tip.
            facing = normalize(radial + forward * rng.uniform(0.0, 0.7 if tip else 0.45)
                               + np.array([0.0, 0.0, 0.2]))
            centre = origin + radial * petal * rng.uniform(0.75, 1.5) + forward * petal * rng.uniform(-0.5, 0.5)
            builder.flower(template, centre, facing, petal * rng.uniform(0.85, 1.2),
                           shade=0.74 + 0.26 * progress, openness=rng.uniform(0.1, 0.5),
                           spin=rng.uniform(0, math.tau))
    return builder


def blossom_strand(seed, lod=1, flowers=12, petal=0.082, wood=True):
    """A hanging garland for the weeping cherries: flowers all the way down a slender twig."""
    builder = BlossomBuilder(seed)
    rng = builder.rng
    template = petal_template(lod)
    segments = 6
    twig = [np.zeros(3)]
    heading = np.array([rng.uniform(-0.06, 0.06), 1.0, rng.uniform(-0.06, 0.06)])
    for _ in range(segments):
        heading = normalize(heading + np.array([rng.uniform(-0.09, 0.09), 0.0, rng.uniform(-0.09, 0.09)]))
        twig.append(twig[-1] + heading * (1.0 / segments))
    twig = np.array(twig)
    if wood:
        builder.twig(twig, 0.008, sides=3, shade=0.5)
    start = float(rng.uniform(0, math.tau))
    for index in range(flowers):
        t = 0.05 + 0.95 * (index + rng.uniform(0.15, 0.85)) / flowers
        scaled = t * segments
        segment = min(int(scaled), segments - 1)
        local = scaled - segment
        origin = twig[segment] * (1 - local) + twig[segment + 1] * local
        forward = normalize(twig[segment + 1] - twig[segment])
        u, w = _ring_frame(forward)
        azimuth = start + index * 2.39996 + rng.uniform(-0.3, 0.3)
        radial = u * math.cos(azimuth) + w * math.sin(azimuth)
        # A hanging flower looks outward and down the strand.
        facing = normalize(radial + forward * rng.uniform(0.1, 0.6))
        builder.flower(template, origin + radial * petal * rng.uniform(0.7, 1.3), facing,
                       petal * rng.uniform(0.85, 1.2), shade=0.72 + 0.28 * t,
                       openness=rng.uniform(0.12, 0.5), spin=rng.uniform(0, math.tau))
    return builder


def blossom_clump(seed, lod=2, flowers=10, petal=0.15):
    """A pom-pom of large simple flowers that reads as a mass of blossom at mid distance."""
    builder = BlossomBuilder(seed)
    rng = builder.rng
    template = petal_template(lod, cup=0.2, curl=0.1)
    for index in range(flowers):
        # Even directions over the upper two thirds of a ball, opened toward the lit side.
        y = 1.0 - (index + 0.5) / flowers * 1.55
        ring = math.sqrt(max(0.0, 1.0 - y * y))
        azimuth = index * 2.39996 + rng.uniform(-0.25, 0.25)
        outward = normalize(np.array([ring * math.cos(azimuth), ring * math.sin(azimuth) * 0.9 + 0.1, y]))
        centre = np.array([0.0, 0.5, 0.06]) + outward * np.array([0.3, 0.36, 0.22]) * rng.uniform(0.75, 1.1)
        facing = normalize(outward + rng.normal(size=3) * 0.22)
        builder.flower(template, centre, facing, petal * rng.uniform(0.8, 1.15),
                       shade=0.66 + 0.34 * (0.5 + 0.5 * outward[2]), openness=rng.uniform(0.1, 0.42),
                       spin=rng.uniform(0, math.tau))
    return builder


def single_petal(lod, cup=0.3, curl=0.2):
    """One petal centred for the falling-petal and drift systems (XY plane, +Z up)."""
    vertices, uvs, triangles = petal_template(lod, cup=cup, curl=curl)
    centred = vertices.copy()
    centred[:, 1] -= 0.5
    normals = np.zeros_like(centred)
    for a, b, c in triangles:
        normals[[a, b, c]] += np.cross(centred[b] - centred[a], centred[c] - centred[a])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.maximum(lengths, 1e-9)
    if normals[:, 2].mean() < 0:
        normals = -normals
    colors = np.zeros((len(vertices), 4))
    colors[:, 0] = np.clip(vertices[:, 1], 0.0, 1.0)
    colors[:, 2] = 0.82 + 0.18 * colors[:, 0]
    colors[:, 3] = 1.0
    return centred, normals, uvs, colors, triangles.reshape(-1)


def single_flower(seed=5, lod=1, petal=0.5):
    """A whole open flower lying in the XY plane (+Z up), for blossom adrift on the water."""
    builder = BlossomBuilder(seed)
    builder.flower(petal_template(lod), np.zeros(3), np.array([0.0, 0.0, 1.0]), petal, openness=0.16)
    return builder.arrays()
