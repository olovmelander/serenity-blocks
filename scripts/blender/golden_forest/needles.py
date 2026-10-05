"""Needle sprays for the Golden Forest conifers.

Needles are real geometry, not alpha cards. A spruce bough section is a length of limb
roofed in forward-swept shoots, with a curtain of pendulous branchlets hanging beneath it;
a pine clump is a dome of bottle-brushes crowding the end of a twig. Against a low sun the
serrated edges are what read as needles.

Spray space matches the Fall grove: +Y runs along the limb, +Z is the lit upper side, +X is
across. Vertex colour: R = distance from the shoot (0 on the twig, 1 at the needle tips),
G = per-shoot random id, B = shade inside the spray, A = 1 on needles / 0 on wood.
"""

import math

import numpy as np

from fall_grove.foliage import SprayBuilder
from fall_grove.skeleton import normalize

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])
GOLDEN = math.radians(137.50776)


def _strip(builder, ridge, up, width, roof, shade, serration=0.5, taper=0.0, sweep=0.35):
    """A two-sided roof of needles along `ridge`; its outer edges zig-zag like a saw.

    `width` is the needle length, `roof` the angle each side falls away from the ridge,
    `taper` how far the width has shrunk by the tip (0 keeps it, 1 closes to a point) and
    `sweep` how far the needles lean forward along the shoot.
    """
    ridge = np.asarray(ridge, dtype=float)
    count = len(ridge)
    rid = builder.rng.random()
    positions = []
    colors = []
    uvs = []
    for index in range(count):
        tangent = normalize(ridge[min(index + 1, count - 1)] - ridge[max(index - 1, 0)])
        across = normalize(np.cross(tangent, up))
        lift = np.cross(across, tangent)
        t = index / (count - 1)
        tooth = 1.0 if index % 2 == 0 else serration
        reach = width * tooth * (1.0 - taper * t)
        if index == count - 1:
            reach *= 0.4
        tone = shade[0] + (shade[1] - shade[0]) * t
        positions.append(ridge[index])
        colors.append((0.0, rid, tone * 0.82, 1.0))
        uvs.append((0.5, t))
        for side in (-1.0, 1.0):
            outward = across * side * math.cos(roof) - lift * math.sin(roof) + tangent * sweep
            positions.append(ridge[index] + normalize(outward) * reach)
            colors.append((1.0, rid, tone, 1.0))
            uvs.append((0.5 + 0.5 * side, t))
    positions = np.array(positions)
    triangles = []
    for index in range(count - 1):
        a = index * 3
        b = a + 3
        triangles.extend(((a, a + 1, b), (a + 1, b + 1, b), (a, b, a + 2), (a + 2, b, b + 2)))
    normals = np.zeros_like(positions)
    for i, j, k in triangles:
        normals[[i, j, k]] += np.cross(positions[j] - positions[i], positions[k] - positions[i])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.where(lengths > 1e-9, normals / np.maximum(lengths, 1e-9), up)
    flip = (normals @ up) < 0
    normals[flip] = -normals[flip]
    builder._append(positions, normals, np.array(uvs), np.array(colors), triangles)
    builder.leaves += 1


def _polyline(start, direction, length, points, bend):
    """A shoot leaving `start`; `bend` (a vector) pulls it over quadratically toward its tip."""
    t = np.linspace(0.0, 1.0, points)[:, None]
    return np.asarray(start) + direction * length * t + np.asarray(bend) * length * t * t


def spruce_bough(seed, lod=0, hang=1.0):
    """One section of a spruce limb: a roof of side shoots and the curtain that hangs from it.

    `hang` scales the pendulous branchlets: long low in the crown, short near the spire.
    """
    builder = SprayBuilder(seed)
    rng = builder.rng
    segments = 8 if lod == 0 else 4
    ridge = _polyline(np.zeros(3), normalize(np.array([rng.uniform(-0.05, 0.05), 1.0, 0.02])), 1.0,
                      segments + 1, bend=Z * -0.1)
    if lod == 0:
        builder.twig(ridge[::2], 0.02, sides=3, shade=0.42)
    _strip(builder, ridge, Z, 0.36 if lod == 0 else 0.4, 0.42, (0.74, 1.0), serration=0.52, taper=0.3, sweep=0.55)
    tails = 9 if lod == 0 else 6
    for tail in range(tails):
        t = (tail + rng.uniform(0.2, 0.8)) / tails
        side = -1.0 if tail % 2 else 1.0
        scaled = t * segments
        segment = min(int(scaled), segments - 1)
        origin = ridge[segment] * (1 - (scaled - segment)) + ridge[segment + 1] * (scaled - segment)
        origin = origin + X * side * rng.uniform(0.04, 0.3) * (1.0 - 0.4 * t) + Z * -0.03
        direction = normalize(Z * -1.0 + Y * rng.uniform(0.05, 0.5) + X * side * rng.uniform(0.0, 0.35))
        length = rng.uniform(0.5, 0.85) * (1.0 - 0.3 * t) * hang
        # Each branchlet faces its own way so the curtain has depth from every side.
        yaw = rng.uniform(0, math.pi)
        facing = normalize(Y * math.cos(yaw) + X * math.sin(yaw))
        shoot = _polyline(origin, direction, length, 5 if lod == 0 else 3, bend=Y * rng.uniform(0.0, 0.14))
        _strip(builder, shoot, facing, (0.105 if lod == 0 else 0.13) * rng.uniform(0.85, 1.15), 0.3,
               (0.5 + 0.2 * rng.random(), 0.8 + 0.2 * rng.random()), serration=0.55, taper=0.75, sweep=0.5)
    return builder


def _needle_bundle(builder, base, direction, length, width, shade, crossed):
    """A bundle of pine needles as a slim kite (two kites crossed when `crossed`)."""
    rng = builder.rng
    direction = normalize(direction)
    reference = Z if abs(direction[2]) < 0.9 else X
    side = normalize(np.cross(direction, reference))
    start = rng.uniform(0, math.pi)
    rid = rng.random()
    for plane in range(2 if crossed else 1):
        angle = start + math.pi * 0.5 * plane
        across = side * math.cos(angle) + np.cross(direction, side) * math.sin(angle)
        base = np.asarray(base, dtype=float)
        mid = base + direction * length * 0.42
        positions = np.array([base, mid + across * width, mid - across * width, base + direction * length])
        normal = normalize(np.cross(direction, across))
        if normal[2] < 0:
            normal = -normal
        colors = np.array([(0.0, rid, shade * 0.7, 1.0), (0.6, rid, shade * 0.9, 1.0),
                           (0.6, rid, shade * 0.9, 1.0), (1.0, rid, shade, 1.0)])
        uvs = np.array([(0.5, 0.0), (1.0, 0.42), (0.0, 0.42), (0.5, 1.0)])
        builder._append(positions, np.tile(normal, (4, 1)), uvs, colors, [(0, 1, 2), (1, 3, 2)])
    builder.leaves += 1


def pine_clump(seed, lod=0):
    """A pine clump: long needle bundles bursting from the end of a twig like a sea urchin."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    twig = np.array([[0.0, 0.0, 0.0], [0.02, 0.2, 0.03], [-0.01, 0.4, 0.08]])
    if lod == 0:
        builder.twig(twig, 0.022, sides=3, shade=0.45)
    centre = twig[-1]
    bundles = 46 if lod == 0 else 30
    # The burst favours the way the twig points and the open sky above it.
    bias = normalize(np.array([0.0, 0.8, 0.6]))
    placed = 0
    index = 0
    while placed < bundles:
        index += 1
        polar = math.acos(1.0 - 2.0 * ((index * 0.61803) % 1.0))
        azimuth = index * GOLDEN
        direction = np.array([math.sin(polar) * math.cos(azimuth), math.cos(polar), math.sin(polar) * math.sin(azimuth)])
        facing = float(np.dot(direction, bias))
        if facing < -0.35 + 0.3 * rng.random():
            continue
        direction = normalize(direction + bias * 0.35 + rng.normal(size=3) * 0.08)
        length = rng.uniform(0.42, 0.62) * (0.8 + 0.2 * max(0.0, facing))
        _needle_bundle(builder, centre + direction * 0.04 - Y * rng.uniform(0.0, 0.14), direction, length,
                       (0.045 if lod == 0 else 0.07) * rng.uniform(0.8, 1.25), 0.62 + 0.38 * max(0.0, facing),
                       crossed=lod == 0)
        placed += 1
    return builder


SPRAY_BUILDERS = {
    # Variant 0 hangs long (lower crown), variant 1 short (upper crown).
    "spruce_frond": lambda index: spruce_bough(6100 + index * 13, lod=0, hang=1.0 if index == 0 else 0.55),
    "spruce_bough": lambda index: spruce_bough(6300 + index * 17, lod=1, hang=1.0 if index == 0 else 0.55),
    "pine_tuft": lambda index: pine_clump(6500 + index * 19, lod=0),
    "pine_clump": lambda index: pine_clump(6700 + index * 23, lod=1),
}
# How far a spray reaches from its site, as a share of the site scale (for occlusion hulls).
SPRAY_REACH = {"spruce_frond": 0.6, "spruce_bough": 0.62, "pine_tuft": 0.6, "pine_clump": 0.62}
