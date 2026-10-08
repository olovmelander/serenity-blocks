"""Shared foliage for the firefly-night forest: needle sprays, birch strands and fern fronds.

The needle sprays are the Golden Forest builders and the birch strand is the Fall grove's,
each with seeds of its own. The fern frond is new.

Spray space is the Fall grove's for every mesh here: +Y runs forward along the twig (or the
frond's stalk) from an attachment point at the origin, +Z is the lit upper side, +X is
across. Needle and birch vertex colour: R = distance from the shoot or the leaf base (the
flutter weight), G = per-shoot or per-leaf random id, B = shade inside the spray,
A = 1 on needles and leaves / 0 on wood.

A fern frond leaves the origin along +Y with its upper face toward +Z, arches over toward
-Z and curls under at the tip; its pinnae spread along +-X. The stalk is one unit of arc
long. Vertex colour: R = how far along the frond the vertex is attached (0 at the base, 1
at the tip: the sway weight), G = per-pinna random id (0 on the stalk), B = shade (darker
toward the stalk and toward the base), A = 1 on the blade / 0 on the stalk. UV is the
frond pressed flat: u across it (0.5 on the stalk), v along it (0 at the base, 1 at the tip).
"""

import math

import numpy as np

from fall_grove import foliage
from fall_grove.foliage import SprayBuilder
from golden_forest import needles

X = np.array([1.0, 0.0, 0.0])


class _Frond:
    """The stalk's curve and the mapping from the flat frond onto it."""

    def __init__(self, arch, curl, sweep, twist, samples=96):
        self.twist = twist
        self.sweep = sweep
        s = np.linspace(0.0, 1.25, samples)
        fall = np.clip((s - 0.8) / 0.2, 0.0, 1.5)
        angle = arch * np.minimum(s, 1.0) ** 1.6 + curl * fall * fall * (3.0 - 2.0 * np.minimum(fall, 1.0))
        step = s[1] - s[0]
        tangent = np.stack([np.zeros(samples), np.cos(angle), -np.sin(angle)], axis=1)
        centre = np.concatenate([[np.zeros(3)], np.cumsum((tangent[:-1] + tangent[1:]) * 0.5 * step, axis=0)])
        self.s = s
        self.angle = angle
        self.centre = centre

    def frame(self, along):
        """Centre, across and upper-side normal of the stalk at arc position `along`."""
        along = float(np.clip(along, 0.0, self.s[-1]))
        centre = np.array([np.interp(along, self.s, self.centre[:, axis]) for axis in range(3)])
        angle = float(np.interp(along, self.s, self.angle))
        centre[0] += self.sweep * along * along
        normal = np.array([0.0, math.sin(angle), math.cos(angle)])
        roll = self.twist * along
        across = X * math.cos(roll) + normal * math.sin(roll)
        normal = normal * math.cos(roll) - X * math.sin(roll)
        return centre, across, normal

    def place(self, flat, lift=0.0):
        """A point of the flat frond (x across, y along the stalk) carried onto the arch."""
        centre, across, normal = self.frame(flat[1])
        return centre + across * flat[0] + normal * lift, normal


def _pinna(builder, frond, attach, side, length, half_width, stations, angle, serration, keel, extent):
    """One leaflet: a tapering blade with toothed edges, swept toward the frond's tip."""
    rng = builder.rng
    rid = float(rng.random())
    twist = float(rng.uniform(-0.3, 0.3))
    flat = []
    lifts = []
    shades = []
    # Midline stations run from the stalk to the leaflet's tip; the blade is widest near its foot.
    for station in range(stations):
        s = station / (stations - 1)
        heading = angle - math.radians(16.0) * s * abs(math.sin(angle))
        mid = np.array([side * math.sin(heading), math.cos(heading)])
        if station == 0:
            point = np.array([0.0, attach])
        else:
            point = point + mid * length / (stations - 1)
        swell = min(1.0, 0.5 + s / 0.2) * (1.0 - s) ** 0.72
        tooth = 1.0 if station % 2 else serration
        if station == 0:
            tooth = 1.0
        width = half_width * swell * tooth
        normal = np.array([-mid[1], mid[0]])
        # Teeth lean toward the tip of the leaflet; the notches between them sit back.
        nudge = mid * length / (stations - 1) * (0.22 if (station % 2 and station < stations - 1) else 0.0)
        # Leaflets rise a little from the stalk, then droop toward their tips.
        reach = abs(point[0]) / max(extent, 1e-6)
        lift = extent * (keel * reach - 1.8 * keel * reach * reach)
        if station == stations - 1:
            flat.append(point)
            lifts.append(lift)
            shades.append(s)
            break
        for edge in (-1.0, 1.0):
            flat.append(point + normal * width * edge + nudge)
            lifts.append(lift + twist * width * edge)
            shades.append(s)
    flat = np.array(flat)
    positions = np.zeros((len(flat), 3))
    upper = np.zeros((len(flat), 3))
    for index, point in enumerate(flat):
        positions[index], upper[index] = frond.place(point, lifts[index])
    triangles = []
    for station in range(stations - 2):
        a = station * 2
        triangles.extend(((a, a + 1, a + 2), (a + 1, a + 3, a + 2)))
    last = (stations - 2) * 2
    triangles.append((last, last + 1, last + 2))
    normals = np.zeros_like(positions)
    for i, j, k in triangles:
        normals[[i, j, k]] += np.cross(positions[j] - positions[i], positions[k] - positions[i])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.where(lengths > 1e-12, normals / np.maximum(lengths, 1e-12), upper)
    if float(np.sum(normals * upper)) < 0:
        normals = -normals
        triangles = [(i, k, j) for i, j, k in triangles]
    shades = np.array(shades)
    colors = np.zeros((len(flat), 4))
    # A leaflet rides on the stalk where it is attached; the apex blade is the stalk's own last stretch.
    colors[:, 0] = np.clip(flat[:, 1], 0.0, 1.0) if angle == 0.0 else np.clip(attach, 0.0, 1.0)
    colors[:, 1] = rid
    colors[:, 2] = (0.46 + 0.54 * shades ** 0.7) * (0.7 + 0.3 * min(1.0, attach))
    colors[:, 3] = 1.0
    builder._append(positions, normals, flat.copy(), colors, triangles)
    builder.leaves += 1


def _stalk(builder, frond, end, rings, radius, sides):
    """The stipe and rachis: a three-sided stem for the near frond, a flat ribbon for the far one."""
    positions = []
    normals = []
    flat = []
    shade = []
    for ring in range(rings):
        along = end * (ring / (rings - 1)) ** 0.85
        centre, across, normal = frond.frame(along)
        thickness = radius * (1.0 - 0.78 * ring / (rings - 1))
        if sides == 2:
            for edge in (-1.0, 1.0):
                positions.append(centre + across * thickness * edge)
                normals.append(normal)
                flat.append((thickness * edge, along))
                shade.append(along)
        else:
            for side in range(sides):
                turn = math.tau * side / sides + math.pi * 0.5
                radial = across * math.cos(turn) + normal * math.sin(turn)
                positions.append(centre + radial * thickness)
                normals.append(radial)
                flat.append((thickness * math.cos(turn), along))
                shade.append(along)
    triangles = []
    for ring in range(rings - 1):
        if sides == 2:
            a = ring * 2
            triangles.extend(((a, a + 1, a + 2), (a + 1, a + 3, a + 2)))
        else:
            for side in range(sides):
                a = ring * sides + side
                b = ring * sides + (side + 1) % sides
                triangles.extend(((a, a + sides, b), (b, a + sides, b + sides)))
    shade = np.array(shade)
    colors = np.zeros((len(positions), 4))
    colors[:, 0] = np.clip(shade, 0.0, 1.0)
    colors[:, 2] = 0.3 + 0.2 * np.clip(shade, 0.0, 1.0)
    builder._append(np.array(positions), np.array(normals), np.array(flat), colors, triangles)


def fern_frond(seed, lod=0):
    """One lady-fern frond: an arching stalk, leaflets in near-opposite pairs, a toothed, curling tip."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    frond = _Frond(arch=math.radians(float(rng.uniform(50, 58))), curl=math.radians(float(rng.uniform(62, 78))),
                   sweep=float(rng.uniform(-0.05, 0.05)), twist=float(rng.uniform(-0.25, 0.25)))
    pairs = 22 if lod == 0 else 18
    first, last = 0.13, 0.9
    longest = 0.2
    widest = 0.026 if lod == 0 else 0.032
    extent = longest * 0.98
    keel = 0.3
    if lod == 0:
        _stalk(builder, frond, 0.93, rings=10, radius=0.0075, sides=3)
    else:
        _stalk(builder, frond, 0.93, rings=7, radius=0.008, sides=2)
    for pair in range(pairs):
        along = first + (last - first) * (pair / (pairs - 1)) ** 0.94
        # Longest a third of the way up; short at the foot; tapering to nothing at the tip.
        if along < 0.34:
            profile = 0.42 + 0.58 * math.sin(math.pi * 0.5 * (along - first) / (0.34 - first))
        else:
            profile = (1.0 - (along - 0.34) / (1.0 - 0.34)) ** 1.15
        for side in (-1.0, 1.0):
            size = longest * profile * float(rng.uniform(0.92, 1.06))
            if lod == 0:
                stations = 6 if profile > 0.72 else (5 if profile > 0.4 else (4 if profile > 0.2 else 3))
            else:
                stations = 4 if profile > 0.6 else 3
            angle = math.radians(80.0 - 30.0 * along + float(rng.uniform(-4, 4)))
            offset = (last - first) / (pairs - 1) * (0.32 if side > 0 else 0.0)
            _pinna(builder, frond, along + offset, side, size, widest * (0.45 + 0.55 * profile ** 0.8), stations,
                   angle, 0.56 if lod == 0 else 0.6, keel, extent)
    # The apex: the stalk's last tenth is itself a toothed blade.
    _pinna(builder, frond, last + 0.01, 1.0, 1.0 - last + 0.02, 0.014, 6 if lod == 0 else 4, 0.0, 0.42, keel, extent)
    positions, normals, uvs, colors, indices = builder.arrays()
    # UVs were gathered as flat-frond coordinates; scale them into the unit square.
    flat = uvs.copy()
    reach = float(np.abs(flat[:, 0]).max())
    uvs = np.stack([0.5 + 0.5 * flat[:, 0] / reach, np.clip(flat[:, 1] / float(flat[:, 1].max()), 0.0, 1.0)],
                   axis=1)
    builder.positions, builder.normals, builder.uvs, builder.colors = [positions], [normals], [uvs], [colors]
    builder.indices = [indices]
    return builder


SPRAY_BUILDERS = {
    # Variant 0 hangs long (lower crown), variant 1 short (upper crown and near the ground).
    "spruce_frond": lambda index: needles.spruce_bough(7100 + index * 29, lod=0, hang=1.0 if index == 0 else 0.55),
    "spruce_bough": lambda index: needles.spruce_bough(7300 + index * 31, lod=1, hang=1.0 if index == 0 else 0.55),
    "pine_tuft": lambda index: needles.pine_clump(7500 + index * 37, lod=0),
    "pine_clump": lambda index: needles.pine_clump(7700 + index * 41, lod=1),
    "birch_strand": lambda index: foliage.birch_strand(7900 + index * 43, lod=0, leaves=16),
    # Not worn by a tree: variant 0 is the near frond, variant 1 the light one for the far ground.
    "fern_frond": lambda index: fern_frond(8100 + index * 47, lod=index),
}
# Kinds a tree's foliage sites refer to (the ferns are scattered by the runtime instead).
TREE_KINDS = ("spruce_frond", "spruce_bough", "pine_tuft", "pine_clump", "birch_strand")
# How far a spray reaches from its site, as a share of the site scale (for occlusion hulls).
SPRAY_REACH = dict(needles.SPRAY_REACH, birch_strand=0.6)
