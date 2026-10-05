"""Leaf and spray geometry for the Fall grove.

Leaves are real, lobed geometry (no alpha cards): a fan of triangles around the point where
the petiole meets the blade, folded along the midrib and curled toward the tip. A spray is
one twig carrying a handful of leaves and is the unit the canopy instances.

Spray space: +Y runs along the twig, +Z is the lit upper side, +X is across.
Vertex colour: R = distance from the leaf base (flutter weight), G = per-leaf random id,
B = shade inside the spray, A = 1 on leaves / 0 on wood.
"""

import math

import numpy as np

from .skeleton import normalize

# Right-hand outlines from the petiole joint (0, 0) to the tip (0, 1); mirrored for the left.
MAPLE_OUTLINES = {
    0: [(0.16, -0.10), (0.42, -0.06), (0.30, 0.10), (0.66, 0.28), (0.70, 0.52), (0.46, 0.46),
        (0.22, 0.44), (0.30, 0.72), (0.12, 0.74)],
    1: [(0.42, -0.06), (0.28, 0.12), (0.70, 0.50), (0.21, 0.44)],
    2: [(0.46, 0.02), (0.56, 0.46)],
}
BIRCH_OUTLINES = {
    0: [(0.30, 0.10), (0.39, 0.36), (0.22, 0.70)],
    1: [(0.38, 0.30)],
    2: [(0.38, 0.30)],
}
OAK_OUTLINES = {
    0: [(0.14, 0.06), (0.30, 0.16), (0.20, 0.28), (0.40, 0.42), (0.24, 0.54), (0.36, 0.72), (0.16, 0.84)],
    1: [(0.26, 0.14), (0.40, 0.44), (0.30, 0.74)],
    2: [(0.38, 0.40)],
}
SPECIES_OUTLINES = {"maple": MAPLE_OUTLINES, "birch": BIRCH_OUTLINES, "oak": OAK_OUTLINES}
SPECIES_WIDTH = {"maple": 0.86, "birch": 0.92, "oak": 0.9}


def leaf_template(species, lod, fold=0.24, droop=0.2):
    """Vertices (x, y, z), UVs and triangles of one unit-length leaf."""
    half = SPECIES_OUTLINES[species][lod]
    width = SPECIES_WIDTH[species]
    right = [(x * width, y) for x, y in half]
    left = [(-x, y) for x, y in reversed(right)]
    rim = right + [(0.0, 1.0)] + left
    extent = max(abs(x) for x, _ in rim)
    low = min(y for _, y in rim)
    vertices = [(0.0, 0.0, 0.0)]
    uvs = [(0.5, (0.0 - low) / (1.0 - low))]
    for x, y in rim:
        lift = fold * abs(x) - droop * max(0.0, y) ** 2 * 0.6 - 0.12 * x * x
        vertices.append((x, y, lift))
        uvs.append((0.5 + 0.5 * x / extent, (y - low) / (1.0 - low)))
    triangles = [(0, index, index + 1) for index in range(1, len(rim))]
    return np.array(vertices), np.array(uvs), np.array(triangles)


class SprayBuilder:
    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.positions = []
        self.normals = []
        self.uvs = []
        self.colors = []
        self.indices = []
        self.count = 0
        self.leaves = 0

    def _append(self, positions, normals, uvs, colors, triangles):
        self.positions.append(positions)
        self.normals.append(normals)
        self.uvs.append(uvs)
        self.colors.append(colors)
        self.indices.append(np.asarray(triangles).reshape(-1) + self.count)
        self.count += len(positions)

    def leaf(self, template, base, axis, normal, size, shade=1.0, twist=0.0, cup=0.0):
        vertices, uvs, triangles = template
        axis = normalize(np.asarray(axis, dtype=float))
        across = normalize(np.cross(axis, np.asarray(normal, dtype=float)))
        face = np.cross(across, axis)
        if twist:
            cosine, sine = math.cos(twist), math.sin(twist)
            across, face = across * cosine + face * sine, face * cosine - across * sine
        local = vertices.copy()
        local[:, 2] += cup * (local[:, 0] ** 2 + (local[:, 1] - 0.45) ** 2)
        world = (np.asarray(base, dtype=float) + size * (local[:, 0:1] * across + local[:, 1:2] * axis
                                                         + local[:, 2:3] * face))
        normals = np.zeros_like(world)
        for a, b, c in triangles:
            normals[[a, b, c]] += np.cross(world[b] - world[a], world[c] - world[a])
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = normals / np.maximum(lengths, 1e-9)
        if float(np.dot(normals.mean(axis=0), face)) < 0:
            normals = -normals
        reach = np.linalg.norm(vertices[:, :2], axis=1)
        colors = np.zeros((len(vertices), 4))
        colors[:, 0] = np.clip(reach / reach.max(), 0.0, 1.0)
        colors[:, 1] = self.rng.random()
        colors[:, 2] = shade * (0.72 + 0.28 * colors[:, 0])
        colors[:, 3] = 1.0
        self._append(world, normals, uvs.copy(), colors, triangles)
        self.leaves += 1

    def twig(self, points, radius, sides=3, shade=0.6):
        points = np.asarray(points, dtype=float)
        rings = len(points)
        positions = []
        normals = []
        for ring in range(rings):
            tangent = normalize(points[min(ring + 1, rings - 1)] - points[max(ring - 1, 0)])
            reference = np.array([0.0, 0.0, 1.0]) if abs(tangent[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
            u = normalize(np.cross(tangent, reference))
            w = np.cross(tangent, u)
            thickness = radius * (1.0 - 0.75 * ring / (rings - 1))
            for side in range(sides):
                angle = math.tau * side / sides
                radial = u * math.cos(angle) + w * math.sin(angle)
                positions.append(points[ring] + radial * thickness)
                normals.append(radial)
        triangles = []
        for ring in range(rings - 1):
            for side in range(sides):
                a = ring * sides + side
                b = ring * sides + (side + 1) % sides
                c = a + sides
                d = b + sides
                triangles.extend(((a, b, c), (b, d, c)))
        count = len(positions)
        colors = np.zeros((count, 4))
        colors[:, 2] = shade
        uvs = np.zeros((count, 2))
        self._append(np.array(positions), np.array(normals), uvs, colors, triangles)

    def arrays(self):
        return (np.concatenate(self.positions), np.concatenate(self.normals), np.concatenate(self.uvs),
                np.concatenate(self.colors), np.concatenate(self.indices))

    @property
    def triangles(self):
        return int(sum(len(chunk) for chunk in self.indices) // 3)


def maple_spray(seed, lod=0, nodes=5, leaf_size=0.30, wood=True):
    """A near-planar maple spray: opposite leaf pairs along a gently drooping twig."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = leaf_template("maple", lod)
    twig = [np.array([0.0, 0.0, 0.0])]
    heading = np.array([rng.uniform(-0.08, 0.08), 1.0, 0.06])
    for step in range(1, nodes + 2):
        heading = normalize(heading + np.array([rng.uniform(-0.12, 0.12), 0.0, -0.09 - 0.05 * step / nodes]))
        twig.append(twig[-1] + heading * (0.92 / (nodes + 1)))
    twig = np.array(twig)
    if wood:
        builder.twig(twig, 0.016, sides=3)
    for node in range(1, nodes + 1):
        origin = twig[node]
        forward = normalize(twig[min(node + 1, len(twig) - 1)] - twig[node - 1])
        progress = node / nodes
        for side in (-1.0, 1.0):
            splay = math.radians(rng.uniform(48, 78))
            across = np.array([side, 0.0, 0.0])
            axis = normalize(forward * math.cos(splay) + across * math.sin(splay)
                             + np.array([0.0, 0.0, rng.uniform(-0.38, 0.12)]))
            petiole = origin + axis * leaf_size * rng.uniform(0.28, 0.5)
            normal = normalize(np.array([rng.uniform(-0.3, 0.3) + side * 0.12, rng.uniform(-0.25, 0.25), 1.0]))
            size = leaf_size * rng.uniform(0.82, 1.18) * (1.0 - 0.18 * abs(progress - 0.55))
            builder.leaf(template, petiole, axis, normal, size, shade=0.78 + 0.22 * progress,
                         twist=rng.uniform(-0.35, 0.35), cup=rng.uniform(-0.05, 0.12))
    tip = twig[-1]
    forward = normalize(twig[-1] - twig[-2])
    builder.leaf(template, tip, normalize(forward + np.array([0.0, 0.0, -0.25])),
                 normalize(np.array([rng.uniform(-0.2, 0.2), 0.0, 1.0])), leaf_size * rng.uniform(1.0, 1.2),
                 shade=1.0, cup=0.06)
    return builder


def maple_clump(seed, lod=1, leaves=9, leaf_size=0.58):
    """A domed rosette of large leaves that reads as a foliage mass at mid distance."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = leaf_template("maple", lod, fold=0.2, droop=0.26)
    for index in range(leaves):
        azimuth = math.tau * (index + rng.uniform(-0.3, 0.3)) / leaves
        ring = 0.25 + 0.75 * ((index * 0.618) % 1.0)
        outward = np.array([math.cos(azimuth), math.sin(azimuth) * 0.82 + 0.22, 0.0])
        tilt = -0.15 - 0.55 * ring + rng.uniform(-0.15, 0.15)
        axis = normalize(outward + np.array([0.0, 0.0, tilt]))
        base = np.array([0.0, 0.42, 0.12]) + outward * 0.10 * ring + np.array([0.0, 0.0, rng.uniform(-0.1, 0.1)])
        normal = normalize(np.array([outward[0] * 0.45, outward[1] * 0.3, 1.0]) + rng.normal(size=3) * 0.16)
        builder.leaf(template, base, axis, normal, leaf_size * rng.uniform(0.8, 1.15),
                     shade=0.74 + 0.26 * ring, twist=rng.uniform(-0.4, 0.4), cup=rng.uniform(0.0, 0.1))
    return builder


def birch_strand(seed, lod=0, leaves=13, leaf_size=0.17, wood=True):
    """A weeping birch strand: small leaves trembling along a hanging twig."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = leaf_template("birch", lod, fold=0.16, droop=0.12)
    twig = [np.array([0.0, 0.0, 0.0])]
    heading = np.array([rng.uniform(-0.1, 0.1), 1.0, -0.05])
    segments = 7
    for step in range(1, segments + 1):
        heading = normalize(heading + np.array([rng.uniform(-0.1, 0.1), 0.0, -0.16]))
        twig.append(twig[-1] + heading * (1.0 / segments))
    twig = np.array(twig)
    if wood:
        builder.twig(twig, 0.009, sides=3, shade=0.5)
    for index in range(leaves):
        t = 0.14 + 0.86 * (index + rng.uniform(0.1, 0.9)) / leaves
        scaled = t * segments
        segment = min(int(scaled), segments - 1)
        local = scaled - segment
        origin = twig[segment] * (1 - local) + twig[segment + 1] * local
        forward = normalize(twig[segment + 1] - twig[segment])
        side = -1.0 if index % 2 else 1.0
        axis = normalize(forward * 0.35 + np.array([side * rng.uniform(0.55, 1.0), 0.0, rng.uniform(-0.75, -0.1)]))
        normal = normalize(np.array([rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 1.0]))
        builder.leaf(template, origin + axis * leaf_size * 0.3, axis, normal, leaf_size * rng.uniform(0.75, 1.2),
                     shade=0.8 + 0.2 * t, twist=rng.uniform(-0.6, 0.6))
    return builder


def oak_spray(seed, lod=0, leaves=11, leaf_size=0.27, wood=True):
    """A bunched oak spray: leaves crowd toward the tip of a short, stiff twig."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = leaf_template("oak", lod, fold=0.14, droop=0.16)
    twig = np.array([[0.0, 0.0, 0.0], [0.03, 0.34, 0.03], [-0.02, 0.66, 0.02], [0.02, 0.9, -0.03]])
    if wood:
        builder.twig(twig, 0.018, sides=3)
    for index in range(leaves):
        t = 0.3 + 0.7 * (index / max(1, leaves - 1)) ** 0.7
        scaled = t * (len(twig) - 1)
        segment = min(int(scaled), len(twig) - 2)
        local = scaled - segment
        origin = twig[segment] * (1 - local) + twig[segment + 1] * local
        azimuth = index * 2.4 + rng.uniform(-0.4, 0.4)
        radial = np.array([math.cos(azimuth), 0.0, math.sin(azimuth) * 0.7])
        axis = normalize(radial * (1.0 - 0.45 * t) + np.array([0.0, 0.5 + t * 0.8, -0.1]))
        normal = normalize(np.array([radial[0] * 0.3, -0.2, 1.0]) + rng.normal(size=3) * 0.2)
        builder.leaf(template, origin + axis * leaf_size * 0.12, axis, normal, leaf_size * rng.uniform(0.85, 1.2),
                     shade=0.76 + 0.24 * t, twist=rng.uniform(-0.5, 0.5), cup=rng.uniform(-0.04, 0.08))
    return builder


def single_leaf(species, lod, fold=0.24, droop=0.2):
    """One leaf centred for the falling-leaf and ground-litter systems (XY plane, +Z up)."""
    vertices, uvs, triangles = leaf_template(species, lod, fold=fold, droop=droop)
    centred = vertices.copy()
    centred[:, 1] -= 0.45
    normals = np.zeros_like(centred)
    for a, b, c in triangles:
        normals[[a, b, c]] += np.cross(centred[b] - centred[a], centred[c] - centred[a])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.maximum(lengths, 1e-9)
    if normals[:, 2].mean() < 0:
        normals = -normals
    reach = np.linalg.norm(vertices[:, :2], axis=1)
    colors = np.zeros((len(vertices), 4))
    colors[:, 0] = np.clip(reach / reach.max(), 0.0, 1.0)
    colors[:, 2] = 0.8 + 0.2 * colors[:, 0]
    colors[:, 3] = 1.0
    return centred, normals, uvs, colors, triangles.reshape(-1)
