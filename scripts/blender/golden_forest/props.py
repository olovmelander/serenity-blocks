"""Shore props for the Golden Forest lake: a clinker rowboat, a jetty, boulders and a snag.

Each builder returns (positions, normals, uvs, colours, indices) in glTF space (metres,
+Y up). Vertex colour: R = per-part tone, G = per-part random id, B = ambient occlusion
(baked afterwards), A = a material mask (lichen on stone and dead wood, wear on timber).
The boat floats with its waterline at y = 0 and its bow toward -Z; the jetty runs from the
bank at z = 0 out to z = -8.5 with its deck 0.55 m above the water.
"""

import math

import numpy as np

from fall_grove.wood import fbm

from . import conifers


class Parts:
    """Accumulates indexed triangles; normals are rebuilt per part so edges stay crisp."""

    def __init__(self, seed):
        self.rng = np.random.default_rng(seed)
        self.positions = []
        self.normals = []
        self.colors = []
        self.indices = []
        self.count = 0

    def add(self, positions, triangles, tone=None, mask=0.0, smooth=True):
        positions = np.asarray(positions, dtype=float)
        triangles = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
        if not smooth:
            positions = positions[triangles.reshape(-1)]
            triangles = np.arange(len(positions)).reshape(-1, 3)
        normals = np.zeros_like(positions)
        for a, b, c in triangles:
            normals[[a, b, c]] += np.cross(positions[b] - positions[a], positions[c] - positions[a])
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = normals / np.maximum(lengths, 1e-9)
        colors = np.zeros((len(positions), 4))
        colors[:, 0] = self.rng.uniform(0.25, 1.0) if tone is None else tone
        colors[:, 1] = self.rng.random()
        colors[:, 2] = 1.0
        colors[:, 3] = mask
        self.positions.append(positions)
        self.normals.append(normals)
        self.colors.append(colors)
        self.indices.append(triangles.reshape(-1) + self.count)
        self.count += len(positions)

    def box(self, centre, size, yaw=0.0, pitch=0.0, tone=None, mask=0.0):
        half = np.asarray(size, dtype=float) * 0.5
        corners = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], dtype=float) * half
        if pitch:
            cosine, sine = math.cos(pitch), math.sin(pitch)
            corners = corners @ np.array([[1, 0, 0], [0, cosine, sine], [0, -sine, cosine]])
        if yaw:
            cosine, sine = math.cos(yaw), math.sin(yaw)
            corners = corners @ np.array([[cosine, 0, -sine], [0, 1, 0], [sine, 0, cosine]])
        faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        triangles = []
        for a, b, c, d in faces:
            triangles.extend(((a, b, c), (a, c, d)))
        self.add(corners + np.asarray(centre, dtype=float), triangles, tone=tone, mask=mask, smooth=False)

    def post(self, x, z, low, high, radius, sides=8, tone=None, mask=0.0):
        rings = []
        for y, scale in ((low, 1.0), (high, 0.92)):
            for side in range(sides):
                angle = math.tau * side / sides
                rings.append((x + math.cos(angle) * radius * scale, y, z + math.sin(angle) * radius * scale))
        rings.append((x, high + radius * 0.25, z))
        triangles = []
        for side in range(sides):
            a = side
            b = (side + 1) % sides
            triangles.extend(((a, a + sides, b), (b, a + sides, b + sides), (a + sides, 2 * sides, b + sides)))
        self.add(rings, triangles, tone=tone, mask=mask)

    def arrays(self):
        positions = np.concatenate(self.positions)
        return (positions, np.concatenate(self.normals), np.zeros((len(positions), 2)),
                np.concatenate(self.colors), np.concatenate(self.indices))


def _hull_point(u, s, inner=False):
    """A point on the starboard half of the hull: u runs stern..bow (-1..1), s keel..gunwale."""
    beam = 0.76 * max(0.0, 1.0 - abs(u) ** 2.6) ** 0.62
    sheer = 0.4 + 0.2 * abs(u) ** 2.2
    keel = -0.2 + 0.5 * abs(u) ** 4
    angle = s * math.pi * 0.5
    x = beam * math.sin(angle) ** 0.75
    y = keel + (sheer - keel) * (1.0 - math.cos(angle)) ** 0.9
    if inner:
        return np.array([x * 0.94, y + 0.022 * (1.0 - s), u * 2.16])
    return np.array([x, y, u * 2.2])


def rowboat():
    """A double-ended clinker rowboat with three thwarts and its oars shipped."""
    parts = Parts(4101)
    stations = 20
    strakes = 5
    rows = 3
    us = [math.sin((index / stations * 2.0 - 1.0) * math.pi * 0.5) for index in range(stations + 1)]
    for side in (1.0, -1.0):
        mirror = np.array([side, 1.0, 1.0])
        # Outer skin: one separate band per strake, each standing proud of the one above.
        for strake in range(strakes):
            band = []
            for row in range(rows):
                s = (strake + row / (rows - 1)) / strakes
                proud = 0.016 * (1.0 - row / (rows - 1))
                for u in us:
                    point = _hull_point(u, s)
                    point[0] += proud * (1.0 - abs(u) ** 3)
                    band.append(point * mirror)
            triangles = []
            columns = stations + 1
            for row in range(rows - 1):
                for column in range(stations):
                    a = row * columns + column
                    b = a + 1
                    c = a + columns
                    d = c + 1
                    triangles.extend(((a, c, b), (b, c, d)) if side > 0 else ((a, b, c), (b, d, c)))
            parts.add(band, triangles, tone=0.45 + 0.1 * strake + 0.06 * parts.rng.random(), mask=0.2)
        # Inner skin and the gunwale that caps the two.
        inner = []
        for row in range(7):
            for u in us:
                inner.append(_hull_point(u, row / 6.0, inner=True) * mirror)
        triangles = []
        columns = stations + 1
        for row in range(6):
            for column in range(stations):
                a = row * columns + column
                b = a + 1
                c = a + columns
                d = c + 1
                triangles.extend(((a, b, c), (b, d, c)) if side > 0 else ((a, c, b), (b, c, d)))
        parts.add(inner, triangles, tone=0.36, mask=0.5)
        rail = []
        for u in us:
            outer = _hull_point(u, 1.0) * mirror
            inside = _hull_point(u, 1.0, inner=True) * mirror
            rail.extend((outer + np.array([side * 0.012, 0.02, 0.0]), inside + np.array([-side * 0.012, 0.02, 0.0])))
        triangles = []
        for column in range(stations):
            a = column * 2
            triangles.extend(((a, a + 2, a + 1), (a + 1, a + 2, a + 3)) if side > 0
                             else ((a, a + 1, a + 2), (a + 1, a + 3, a + 2)))
        parts.add(rail, triangles, tone=0.72, mask=0.1)
    for u in (-0.5, -0.02, 0.46):
        width = 2.0 * _hull_point(u, 0.72, inner=True)[0]
        parts.box([0.0, 0.2, u * 2.2], [width, 0.03, 0.24], tone=0.62, mask=0.35)
    for side in (1.0, -1.0):
        yaw = side * 0.05
        parts.box([side * 0.22, 0.245, 0.1], [0.04, 0.04, 2.5], yaw=yaw, tone=0.78, mask=0.15)
        parts.box([side * 0.16, 0.245, -1.45], [0.14, 0.014, 0.62], yaw=yaw, tone=0.82, mask=0.15)
    return parts.arrays()


def jetty():
    """A weathered plank jetty on round posts, with one tall mooring post at its end."""
    parts = Parts(4203)
    rng = parts.rng
    length = 8.5
    deck = 0.55
    z = -0.08
    while z > -length:
        width = 0.13 + rng.uniform(0.0, 0.035)
        parts.box([rng.uniform(-0.03, 0.03), deck + rng.uniform(-0.006, 0.006), z - width * 0.5],
                  [1.5 + rng.uniform(-0.06, 0.1), 0.035, width], yaw=rng.uniform(-0.02, 0.02),
                  mask=rng.uniform(0.0, 0.6))
        z -= width + 0.014
    for x in (-0.55, 0.55):
        parts.box([x, deck - 0.09, -length * 0.5], [0.09, 0.14, length], tone=0.3, mask=0.4)
    for index in range(5):
        along = -0.5 - index * (length - 0.9) / 4
        for x in (-0.7, 0.7):
            tall = index == 4 and x > 0
            parts.post(x, along, -1.6, deck + (0.62 if tall else 0.1) + rng.uniform(0.0, 0.08),
                       0.075 + rng.uniform(0.0, 0.012), tone=0.34, mask=0.7)
        parts.box([0.0, deck - 0.2, along], [1.5, 0.1, 0.07], tone=0.28, mask=0.5)
    return parts.arrays()


def _icosphere(subdivisions):
    golden = (1.0 + 5.0 ** 0.5) / 2.0
    vertices = [(-1, golden, 0), (1, golden, 0), (-1, -golden, 0), (1, -golden, 0), (0, -1, golden),
                (0, 1, golden), (0, -1, -golden), (0, 1, -golden), (golden, 0, -1), (golden, 0, 1),
                (-golden, 0, -1), (-golden, 0, 1)]
    vertices = [np.array(v, dtype=float) / np.linalg.norm(v) for v in vertices]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
             (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11),
             (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(subdivisions):
        cache = {}

        def midpoint(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                point = vertices[a] + vertices[b]
                vertices.append(point / np.linalg.norm(point))
                cache[key] = len(vertices) - 1
            return cache[key]

        split = []
        for a, b, c in faces:
            ab, bc, ca = midpoint(a, b), midpoint(b, c), midpoint(c, a)
            split.extend(((a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)))
        faces = split
    return np.array(vertices), np.array(faces)


def boulder(seed, size=(1.6, 1.0, 1.25)):
    """An ice-rounded granite boulder: a sphere pushed about by noise, broad and settled."""
    directions, faces = _icosphere(3)
    lumps = fbm(directions * 1.3 + seed, 1.0, 3, seed)
    facets = fbm(directions * 3.4 + seed, 1.0, 2, seed + 9)
    radius = 0.72 + 0.42 * lumps + 0.12 * facets
    positions = directions * radius[:, None] * np.asarray(size)
    positions[:, 1] = np.where(positions[:, 1] < 0, positions[:, 1] * 0.45, positions[:, 1])
    normals = np.zeros_like(positions)
    for a, b, c in faces:
        normals[[a, b, c]] += np.cross(positions[b] - positions[a], positions[c] - positions[a])
    normals = normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)
    colors = np.zeros((len(positions), 4))
    colors[:, 0] = np.clip(0.35 + 0.65 * fbm(positions, 0.8, 3, seed + 3), 0.0, 1.0)
    colors[:, 1] = fbm(positions, 5.0, 2, seed + 4)
    colors[:, 2] = 1.0
    lichen = fbm(positions, 1.6, 3, seed + 5)
    colors[:, 3] = np.clip((lichen - 0.42) * 3.2, 0.0, 1.0) * np.clip(normals[:, 1] * 1.4 + 0.25, 0.0, 1.0)
    return positions, normals, np.zeros((len(positions), 2)), colors, faces.reshape(-1)


def snag():
    """The dead pine, written as a plain mesh: it carries no foliage."""
    tree = conifers.snag(4307)
    positions, normals, uvs, colors, indices = conifers.build_wood(tree, hero=True, seed=11).arrays()
    return positions, normals, uvs, colors, indices


PROP_BUILDERS = {
    "rowboat": rowboat,
    "jetty": jetty,
    "boulder_a": lambda: boulder(11, (1.7, 1.0, 1.3)),
    "boulder_b": lambda: boulder(23, (1.2, 1.15, 1.0)),
    "boulder_c": lambda: boulder(37, (2.3, 0.8, 1.5)),
    "snag": snag,
}
# Props that stand on the ground get a floor under them for the occlusion bake.
GROUNDED = {"boulder_a", "boulder_b", "boulder_c", "snag"}
