"""Garden furniture and the mountain for the Sakura Twilight grove.

Hard-surface props are modelled directly as arrays (lathes, convex solids, swept sections),
so nothing here needs a Blender operator; Blender only bakes their ambient occlusion.

Vertex colour: RGB = surface colour (linear), A = ambient occlusion (filled by the bake).
TEXCOORD_0: x = how much the surface glows (paper, lit windows), y = 0..1 height inside the
glowing part, so the runtime can seat the flame low in a lantern.

Coordinates are glTF Y-up metres with each prop standing on the origin.
"""

import math

import numpy as np

from fall_grove.wood import fbm

STONE = (0.30, 0.29, 0.27)
MOSS = (0.085, 0.14, 0.05)
VERMILION = (0.6, 0.075, 0.03)
LACQUER = (0.016, 0.015, 0.018)
WOOD = (0.085, 0.052, 0.036)
ROOF = (0.04, 0.045, 0.055)
PAPER = (0.92, 0.8, 0.62)
GILT = (0.5, 0.33, 0.09)


def _oriented(positions, triangles, reference):
    """Wind triangles so they face away from `reference` (valid for convex solids)."""
    triangles = np.asarray(triangles, dtype=np.int64).reshape(-1, 3).copy()
    a, b, c = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
    normal = np.cross(b - a, c - a)
    inward = np.einsum("ij,ij->i", normal, (a + b + c) / 3.0 - np.asarray(reference, dtype=float)) < 0
    triangles[inward] = triangles[inward][:, [0, 2, 1]]
    return triangles


def mossy(base, seed=0, amount=0.8, scale=2.4):
    """Stone that moss has taken on its upward faces and in its damp hollows."""
    base = np.asarray(base, dtype=float)

    def colour(positions, normals):
        noise = fbm(positions, scale, 3, seed)
        fine = fbm(positions, scale * 5.0, 2, seed + 9)
        upward = np.clip((normals[:, 1] - 0.1) / 0.8, 0.0, 1.0)
        cover = np.clip((noise - 0.42) * 3.4, 0.0, 1.0) * (0.25 + 0.75 * upward) * amount
        tone = base[None, :] * (0.72 + 0.5 * fine[:, None])
        return tone * (1.0 - cover[:, None]) + np.asarray(MOSS)[None, :] * (0.7 + 0.6 * fine[:, None]) * cover[:, None]
    return colour


class Model:
    """Accumulates the parts of one prop."""

    def __init__(self):
        self.positions = []
        self.normals = []
        self.colors = []
        self.glow = []
        self.indices = []
        self.count = 0

    def add(self, positions, triangles, colour, emissive=0.0, smooth=False, glow_range=None):
        positions = np.asarray(positions, dtype=float)
        triangles = np.asarray(triangles, dtype=np.int64).reshape(-1, 3)
        a, b, c = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
        face = np.cross(b - a, c - a)
        area = np.linalg.norm(face, axis=1)
        keep = area > 1e-9
        triangles, face, area = triangles[keep], face[keep], area[keep]
        if smooth:
            normals = np.zeros_like(positions)
            for corner in range(3):
                np.add.at(normals, triangles[:, corner], face)
            lengths = np.linalg.norm(normals, axis=1, keepdims=True)
            normals = normals / np.maximum(lengths, 1e-12)
            vertices = positions
            index = triangles
        else:
            vertices = positions[triangles.reshape(-1)]
            normals = np.repeat(face / area[:, None], 3, axis=0)
            index = np.arange(len(vertices)).reshape(-1, 3)
        if callable(colour):
            rgb = np.clip(colour(vertices, normals), 0.0, 1.0)
        else:
            rgb = np.tile(np.asarray(colour, dtype=float), (len(vertices), 1))
        glow = np.zeros((len(vertices), 2))
        glow[:, 0] = emissive
        if glow_range is not None:
            low, high = glow_range
            glow[:, 1] = np.clip((vertices[:, 1] - low) / max(high - low, 1e-6), 0.0, 1.0)
        self.positions.append(vertices)
        self.normals.append(normals)
        self.colors.append(np.concatenate([rgb, np.ones((len(vertices), 1))], axis=1))
        self.glow.append(glow)
        self.indices.append(index.reshape(-1) + self.count)
        self.count += len(vertices)
        return self

    # -- primitives ---------------------------------------------------------------------
    def lathe(self, profile, sides, colour, origin=(0.0, 0.0, 0.0), phase=0.0, shape=None, **kwargs):
        """Revolve `profile` [(radius, y)...] about the Y axis.

        Walk the profile from the bottom of the axis outward, up the outside and back in
        to the top of the axis: faces then look outward. `shape(side, ring, radius, y)` may
        return an adjusted (radius, y) for one vertex (upturned roof corners).
        """
        rings = len(profile)
        positions = np.zeros((rings, sides, 3))
        for ring, (radius, y) in enumerate(profile):
            for side in range(sides):
                angle = phase + math.tau * side / sides
                r, height = (radius, y) if shape is None else shape(side, ring, radius, y)
                positions[ring, side] = (origin[0] + r * math.cos(angle), origin[1] + height,
                                         origin[2] + r * math.sin(angle))
        triangles = []
        for ring in range(rings - 1):
            for side in range(sides):
                a = ring * sides + side
                b = ring * sides + (side + 1) % sides
                triangles.extend(((a, a + sides, b), (b, a + sides, b + sides)))
        return self.add(positions.reshape(-1, 3), triangles, colour, **kwargs)

    def solid(self, low_ring, high_ring, colour, caps=True, **kwargs):
        """A convex solid between two matching polygons (box, frustum, wedge)."""
        low_ring = np.asarray(low_ring, dtype=float)
        high_ring = np.asarray(high_ring, dtype=float)
        count = len(low_ring)
        positions = np.concatenate([low_ring, high_ring])
        triangles = []
        for index in range(count):
            following = (index + 1) % count
            triangles.extend(((index, following, count + index), (following, count + following, count + index)))
        if caps:
            for offset in (0, count):
                triangles.extend((offset, offset + index, offset + index + 1) for index in range(1, count - 1))
        return self.add(positions, _oriented(positions, triangles, positions.mean(axis=0)), colour, **kwargs)

    def box(self, centre, size, colour, **kwargs):
        cx, cy, cz = centre
        hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
        low = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz + hz),
               (cx - hx, cy - hy, cz + hz)]
        high = [(x, cy + hy, z) for x, _, z in low]
        return self.solid(low, high, colour, **kwargs)

    def rod(self, start, end, radius_start, radius_end, sides, colour, **kwargs):
        """A tapered round bar between two points."""
        start = np.asarray(start, dtype=float)
        end = np.asarray(end, dtype=float)
        axis = end - start
        axis = axis / np.linalg.norm(axis)
        reference = np.array([0.0, 0.0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        u = np.cross(axis, reference)
        u = u / np.linalg.norm(u)
        w = np.cross(axis, u)
        circle = [u * math.cos(math.tau * side / sides) + w * math.sin(math.tau * side / sides)
                  for side in range(sides)]
        return self.solid([start + radial * radius_start for radial in circle],
                          [end + radial * radius_end for radial in circle], colour, **kwargs)

    def sweep(self, path, width, height, colour, up=(0.0, 1.0, 0.0), **kwargs):
        """A rectangular section (width across, height along `up`) carried along a path."""
        path = np.asarray(path, dtype=float)
        up = np.asarray(up, dtype=float)
        rings = []
        for index, point in enumerate(path):
            tangent = path[min(index + 1, len(path) - 1)] - path[max(index - 1, 0)]
            tangent = tangent / np.linalg.norm(tangent)
            side = np.cross(tangent, up)
            side = side / np.linalg.norm(side)
            rise = np.cross(side, tangent)
            rings.append([point + side * a * width * 0.5 + rise * b * height * 0.5
                          for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
        for index in range(len(rings) - 1):
            positions = np.concatenate([rings[index], rings[index + 1]])
            triangles = []
            for corner in range(4):
                following = (corner + 1) % 4
                triangles.extend(((corner, following, 4 + corner), (following, 4 + following, 4 + corner)))
            if index == 0:
                triangles.extend(((0, 1, 2), (0, 2, 3)))
            if index == len(rings) - 2:
                triangles.extend(((4, 5, 6), (4, 6, 7)))
            self.add(positions, _oriented(positions, triangles, positions.mean(axis=0)), colour, **kwargs)
        return self

    def arrays(self):
        """positions, normals, glow (as UVs), colours, indices."""
        return (np.concatenate(self.positions), np.concatenate(self.normals), np.concatenate(self.glow),
                np.concatenate(self.colors), np.concatenate(self.indices))

    @property
    def triangles(self):
        return int(sum(len(chunk) for chunk in self.indices) // 3)


def _firebox(model, y0, y1, radius, colour, sides=6, phase=0.0, post=0.055):
    """A lit paper core behind corner posts, between two frames."""
    model.lathe([(0.0, y0), (radius * 0.84, y0), (radius * 0.84, y1), (0.0, y1)], sides, PAPER, phase=phase,
                emissive=1.0, glow_range=(y0, y1))
    for index in range(sides):
        angle = phase + math.tau * index / sides
        x, z = radius * math.cos(angle), radius * math.sin(angle)
        model.rod((x, y0, z), (x, y1, z), post, post, 4, colour)
    frame = (y1 - y0) * 0.1
    for low in (y0, y1 - frame):
        model.lathe([(radius * 0.8, low), (radius * 1.08, low), (radius * 1.08, low + frame),
                     (radius * 0.8, low + frame)], sides, colour, phase=phase)


def stone_lantern():
    """A Kasuga-style lantern (tōrō): plinth, shaft, platform, firebox, roof and jewel."""
    model = Model()
    stone = mossy(STONE, seed=3)
    phase = math.radians(30.0)
    model.lathe([(0.0, 0.0), (0.46, 0.0), (0.46, 0.12), (0.37, 0.2), (0.2, 0.3), (0.0, 0.3)], 6, stone, phase=phase)
    model.lathe([(0.0, 0.28), (0.125, 0.28), (0.115, 0.6), (0.152, 0.62), (0.152, 0.7), (0.115, 0.72),
                 (0.125, 1.05), (0.0, 1.05)], 10, stone, smooth=True)
    model.lathe([(0.0, 1.03), (0.17, 1.03), (0.35, 1.17), (0.37, 1.17), (0.37, 1.25), (0.0, 1.25)], 6, stone,
                phase=phase)
    _firebox(model, 1.25, 1.62, 0.25, mossy(STONE, seed=5, amount=0.4), phase=phase)

    def eaves(side, ring, radius, y):
        # Alternate vertices are the six corners: they reach further and turn up.
        if ring in (1, 2):
            return (radius * 1.12, y + 0.055) if side % 2 == 0 else (radius * 0.95, y)
        return radius, y
    model.lathe([(0.0, 1.6), (0.52, 1.6), (0.55, 1.65), (0.36, 1.77), (0.2, 1.88), (0.1, 1.94), (0.0, 1.94)], 12,
                mossy(STONE, seed=8, amount=1.0), phase=phase, shape=eaves)
    model.lathe([(0.0, 1.92), (0.06, 1.93), (0.088, 1.99), (0.062, 2.06), (0.022, 2.11), (0.0, 2.15)], 8, stone,
                smooth=True)
    return model


def snow_lantern():
    """A low, wide-roofed yukimi-dōrō that stands on splayed legs at the water's edge."""
    model = Model()
    stone = mossy(STONE, seed=13)
    for index in range(3):
        angle = math.tau * index / 3.0 + math.radians(90.0)
        direction = np.array([math.cos(angle), 0.0, math.sin(angle)])
        path = [direction * 0.46 + np.array([0.0, -0.1, 0.0]), direction * 0.4 + np.array([0.0, 0.22, 0.0]),
                direction * 0.25 + np.array([0.0, 0.44, 0.0])]
        model.sweep(path, 0.11, 0.1, stone, up=np.cross(direction, (0.0, 1.0, 0.0)))
    phase = math.radians(30.0)
    model.lathe([(0.0, 0.4), (0.31, 0.4), (0.33, 0.47), (0.0, 0.47)], 6, stone, phase=phase)
    _firebox(model, 0.47, 0.74, 0.22, stone, phase=phase, post=0.045)
    model.lathe([(0.0, 0.72), (0.64, 0.72), (0.68, 0.76), (0.42, 0.88), (0.15, 0.97), (0.0, 0.98)], 14,
                mossy(STONE, seed=17, amount=1.0))
    model.lathe([(0.0, 0.96), (0.07, 0.97), (0.09, 1.03), (0.03, 1.1), (0.0, 1.12)], 8, stone, smooth=True)
    return model


def paper_lantern():
    """A chōchin hanging from the origin: ribbed paper between two lacquered rings."""
    model = Model()
    model.rod((0.0, 0.0, 0.0), (0.0, -0.36, 0.0), 0.006, 0.006, 3, LACQUER)
    top, bottom, bulge = -0.36, -0.9, 0.2
    model.lathe([(0.0, bottom), (0.1, bottom), (0.1, bottom + 0.035), (0.0, bottom + 0.035)], 10, LACQUER)
    profile = []
    steps = 9
    for step in range(steps + 1):
        angle = math.radians(-72.0 + 144.0 * step / steps)
        rib = 1.0 + (0.035 if step % 2 else 0.0)
        profile.append((bulge * math.cos(angle) * rib + 0.03,
                        (top + bottom) * 0.5 + (top - bottom - 0.07) * 0.5 * math.sin(angle) / math.sin(math.radians(72.0))))
    model.lathe(profile, 12, PAPER, smooth=True, emissive=1.0, glow_range=(bottom, top))
    model.lathe([(0.0, top - 0.035), (0.1, top - 0.035), (0.1, top), (0.0, top)], 10, LACQUER)
    model.rod((0.0, bottom, 0.0), (0.0, bottom - 0.2, 0.0), 0.018, 0.004, 4, VERMILION)
    return model


def torii():
    """A vermilion gate (myōjin style) meant to stand with its feet in the lake."""
    model = Model()
    for side in (-1.0, 1.0):
        model.rod((side * 2.1, -1.4, 0.0), (side * 2.0, 4.5, 0.0), 0.215, 0.17, 12, VERMILION, smooth=True)
        model.rod((side * 2.105, -1.4, 0.0), (side * 2.09, 0.6, 0.0), 0.235, 0.228, 12, LACQUER, smooth=True)
    model.box((0.0, 3.52, 0.0), (5.7, 0.3, 0.18), VERMILION)
    model.box((0.0, 4.0, 0.0), (0.24, 0.66, 0.15), VERMILION)
    steps = 10
    span = np.linspace(-1.0, 1.0, steps + 1)
    model.sweep([(x * 2.8, 4.47 + 0.2 * x * x, 0.0) for x in span], 0.3, 0.3, VERMILION)
    model.sweep([(x * 3.2, 4.74 + 0.3 * x * x, 0.0) for x in span], 0.46, 0.22, LACQUER)
    return model


def _onion(model, origin, scale, colour):
    model.lathe([(0.0, 0.0), (0.5 * scale, 0.02 * scale), (0.42 * scale, 0.3 * scale), (0.7 * scale, 0.62 * scale),
                 (0.44 * scale, 1.0 * scale), (0.1 * scale, 1.36 * scale), (0.0, 1.5 * scale)], 8, colour,
                origin=origin, smooth=True)


def bridge(span=9.2, rise=1.55, width=2.2):
    """A drum bridge (taiko-bashi): an arched deck between vermilion rails."""
    model = Model()
    steps = 16
    half = span * 0.5
    xs = np.linspace(-half, half, steps + 1)

    def arch(x, lift=0.0):
        return rise * (1.0 - (x / half) ** 2) + lift
    model.sweep([(x, arch(x), 0.0) for x in xs], width, 0.12, WOOD)
    edge = width * 0.5 - 0.06
    for side in (-1.0, 1.0):
        z = side * edge
        model.sweep([(x, arch(x, -0.2), z) for x in xs], 0.16, 0.3, VERMILION)
        model.sweep([(x, arch(x, 0.52), z) for x in xs], 0.07, 0.07, VERMILION)
        model.sweep([(x, arch(x, 0.92), z) for x in xs], 0.1, 0.09, VERMILION)
        for index in range(0, steps + 1, 2):
            x = xs[index]
            main = index in (0, steps)
            height = 1.3 if main else 0.98
            size = 0.2 if main else 0.13
            model.box((x, arch(x) + height * 0.5 - 0.05, z), (size, height, size), VERMILION)
            if main:
                _onion(model, (x, arch(x) + height - 0.05, z), 0.17, LACQUER)
        for x in (-half * 0.5, half * 0.5):
            model.rod((x, -2.2, z), (x, arch(x, -0.3), z), 0.13, 0.12, 8, WOOD, smooth=True)
    return model


def pagoda(storeys=5):
    """A five-storied pagoda for the far shore: a stack of deep eaves under a ringed spire."""
    model = Model()
    body = (0.17, 0.035, 0.022)
    model.box((0.0, 0.3, 0.0), (5.4, 0.6, 5.4), STONE)
    y = 0.6
    for storey in range(storeys):
        half = 1.5 - 0.17 * storey
        height = 1.55 - 0.07 * storey
        model.box((0.0, y + height * 0.5, 0.0), (half * 2, height, half * 2), body)
        # Shoji behind a railing: a low band of lamplight round every storey.
        model.box((0.0, y + height * 0.5, 0.0), (half * 2 + 0.03, height * 0.26, half * 2 + 0.03), PAPER,
                  emissive=0.5, glow_range=(y + height * 0.37, y + height * 0.63))
        model.box((0.0, y + 0.1, 0.0), (half * 2 + 0.5, 0.1, half * 2 + 0.5), body)
        eave = half * 2.25
        base = y + height

        def eaves(side, ring, radius, level, eave=eave):
            # Odd vertices are the four corners of a square plan; the eave corners turn up.
            if side % 2:
                lift = 0.42 if ring in (1, 2) else 0.0
                return radius * math.sqrt(2.0), level + lift * (radius / eave) ** 2
            return radius, level
        model.lathe([(0.0, base - 0.05), (eave, base - 0.05), (eave * 1.03, base + 0.05), (eave * 0.6, base + 0.4),
                     (half * 0.8, base + 0.72), (0.0, base + 0.72)], 8, ROOF, shape=eaves)
        y = base + 0.6
    model.lathe([(0.0, y), (0.34, y), (0.4, y + 0.3), (0.12, y + 0.5), (0.0, y + 0.5)], 8, GILT, smooth=True)
    model.rod((0.0, y + 0.4, 0.0), (0.0, y + 4.2, 0.0), 0.075, 0.04, 6, GILT)
    for ring in range(7):
        level = y + 0.9 + ring * 0.4
        size = 0.36 - ring * 0.028
        model.lathe([(0.0, level), (size, level), (size, level + 0.08), (0.0, level + 0.08)], 8, GILT)
    _onion(model, (0.0, y + 4.1, 0.0), 0.16, GILT)
    return model, y + 4.4


def _icosphere(level):
    t = (1.0 + math.sqrt(5.0)) / 2.0
    vertices = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
                (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    vertices = [np.array(v, dtype=float) / math.sqrt(1.0 + t * t) for v in vertices]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
             (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11),
             (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(level):
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


def rock(seed, size=(1.0, 0.62, 0.85)):
    """A weathered shoreline boulder, mossed on top."""
    model = Model()
    directions, faces = _icosphere(2)
    relief = 0.62 + 0.62 * fbm(directions + seed * 3.1, 0.95, 3, seed) + 0.14 * fbm(directions, 3.4, 2, seed + 4)
    positions = directions * relief[:, None] * np.asarray(size)[None, :]
    # A flat, buried foot.
    positions[:, 1] = np.maximum(positions[:, 1], -0.18 * size[1])
    positions[:, 1] += 0.08 * size[1]
    model.add(positions, _oriented(positions, faces, positions.mean(axis=0)), mossy(STONE, seed=seed, amount=1.0, scale=1.6),
              smooth=True)
    return model


def water_lantern():
    """A tōrō-nagashi float: a paper box on a little raft."""
    model = Model()
    model.box((0.0, 0.02, 0.0), (0.44, 0.04, 0.44), WOOD)
    model.box((0.0, 0.2, 0.0), (0.28, 0.32, 0.28), PAPER, emissive=1.0, glow_range=(0.04, 0.36))
    for x, z in ((-0.145, -0.145), (0.145, -0.145), (0.145, 0.145), (-0.145, 0.145)):
        model.box((x, 0.2, z), (0.022, 0.34, 0.022), WOOD)
    model.box((0.0, 0.37, 0.0), (0.31, 0.018, 0.31), WOOD)
    return model


def sky_lantern():
    """A paper sky lantern, open below where its flame burns."""
    model = Model()
    model.lathe([(0.2, 0.0), (0.24, 0.16), (0.3, 0.5), (0.27, 0.68), (0.14, 0.76), (0.0, 0.78)], 10, PAPER,
                smooth=True, emissive=1.0, glow_range=(0.0, 0.78))
    return model


def fuji(rings=58, sectors=168, seed=11, base_radius=2.4):
    """The mountain: a unit-high cone with eroded gullies and a snow cap.

    Vertex colour: R = snow, G = relief shade (dark in the gullies), B = height (1 at the
    summit). The runtime lights it; nothing here is baked colour.
    """
    rng = np.random.default_rng(seed)
    t = np.linspace(0.0, 1.0, rings) ** 1.2                      # 0 at the crater rim, 1 at the foot
    theta = np.linspace(0.0, math.tau, sectors, endpoint=False)
    grid_t, grid_theta = np.meshgrid(t, theta, indexing="ij")
    crater = 0.04
    radius = crater + (1.0 - crater) * grid_t
    height = 0.76 * (1.0 - grid_t) ** 2.25 + 0.24 * (1.0 - grid_t)
    # Gullies: ridged waves around the cone whose count grows down the slope.
    gully = np.zeros_like(grid_t)
    total = 0.0
    for count, weight in ((9, 1.0), (17, 0.7), (31, 0.45), (57, 0.25)):
        phase = rng.uniform(0, math.tau)
        twist = rng.uniform(-1.6, 1.6)
        wave = np.abs(np.sin(0.5 * (count * grid_theta + phase + twist * grid_t * 2.0)))
        fade = np.clip((grid_t - 0.02 * count / 9.0) * 6.0, 0.0, 1.0)
        gully += weight * (1.0 - wave) ** 1.6 * fade
        total += weight
    gully /= total
    slope = np.sin(math.pi * np.clip(grid_t, 0.0, 1.0) ** 0.62)
    height -= gully * slope * 0.052
    # A jagged crater rim and a shoulder (the Hōei crater) on one flank.
    rim = np.exp(-(grid_t / 0.05) ** 2)
    height += rim * (0.012 * np.sin(grid_theta * 7.0 + 1.3) + 0.008 * np.sin(grid_theta * 13.0 + 4.0))
    shoulder = np.exp(-((grid_theta - 2.1) / 0.32) ** 2 - ((grid_t - 0.33) / 0.09) ** 2)
    height -= shoulder * 0.035
    radius = radius * (1.0 + 0.05 * np.sin(grid_theta * 3.0 + 0.7) * grid_t + 0.03 * np.sin(grid_theta * 5.0 + 2.9) * grid_t)
    positions = np.stack([radius * np.cos(grid_theta) * base_radius, height,
                          radius * np.sin(grid_theta) * base_radius], axis=2).reshape(-1, 3)
    # Snow lies above a ragged line and lingers in the gullies below it.
    line = (0.3 + 0.04 * np.sin(grid_theta * 5.0 + 0.4) + 0.028 * np.sin(grid_theta * 11.0 + 2.2)
            + 0.018 * np.sin(grid_theta * 23.0 + 1.0))
    snow = np.clip((line + 0.05 - grid_t) / 0.09, 0.0, 1.0)
    # Short tongues only: a long one reads as a drip from this far away.
    streak = np.clip((gully - 0.46) * 2.4, 0.0, 1.0) * np.clip((0.5 - grid_t) / 0.2, 0.0, 1.0)
    snow = np.clip(np.maximum(snow, streak), 0.0, 1.0)
    shade = np.clip(1.0 - gully * 0.85 * slope, 0.0, 1.0)
    colours = np.stack([snow, shade, 1.0 - grid_t, np.ones_like(grid_t)], axis=2).reshape(-1, 4)
    triangles = []
    for ring in range(rings - 1):
        for sector in range(sectors):
            a = ring * sectors + sector
            b = ring * sectors + (sector + 1) % sectors
            triangles.extend(((a, b, a + sectors), (b, b + sectors, a + sectors)))
    summit = len(positions)
    positions = np.concatenate([positions, [[0.0, float(height[0].mean()) - 0.012, 0.0]]])
    colours = np.concatenate([colours, [[1.0, 0.8, 1.0, 1.0]]])
    triangles.extend((summit, (sector + 1) % sectors, sector) for sector in range(sectors))
    triangles = np.array(triangles)
    a, b, c = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
    face = np.cross(b - a, c - a)
    # The mountain is a height field: every face must look up.
    down = face[:, 1] < 0
    triangles[down] = triangles[down][:, [0, 2, 1]]
    face[down] = -face[down]
    normals = np.zeros_like(positions)
    for corner in range(3):
        np.add.at(normals, triangles[:, corner], face)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    return positions, normals, colours, triangles.reshape(-1)


PROPS = {
    "stone_lantern": stone_lantern,
    "snow_lantern": snow_lantern,
    "paper_lantern": paper_lantern,
    "torii": torii,
    "bridge": bridge,
    "pagoda": lambda: pagoda()[0],
    "rock_a": lambda: rock(21, (1.0, 0.62, 0.85)),
    "rock_b": lambda: rock(34, (0.8, 0.8, 0.7)),
    "rock_c": lambda: rock(55, (1.2, 0.45, 0.9)),
    "water_lantern": water_lantern,
    "sky_lantern": sky_lantern,
}
# Props that glow are lit from inside; their occlusion bake must not darken the paper.
UNOCCLUDED = ("paper_lantern", "water_lantern", "sky_lantern")
