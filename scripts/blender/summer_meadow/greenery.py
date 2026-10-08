"""Midsummer greenery for the Summer props: birch sprigs, meadow flowers, garlands, wreaths.

A garland is a rope of birch twigs: a thin dark core (the leaves you cannot see between)
shingled with sprigs of three leaves that lie along it and lift at their tips. Each leaf is
a folded kite, which is what a birch leaf comes to at this size; each flower a shallow,
scalloped disc around a raised eye.

Leaves (material code 7): tone = the leaf's own brightness, wear = 0 at the stalk to 1 at
the tip (a flutter weight), UV = (across, along) the leaf, 0..1.
Flowers (material code 8): tone = the flower's hue seed, wear = 0 at the eye to 1 at the
petal tips, UV = a disc around (0.5, 0.5). The meadow has seven kinds of flower, so a hue
seed is always the middle of one of seven equal bands: (kind + 0.5) / 7.
"""

import math

import numpy as np

from fall_grove.skeleton import GOLDEN

from .kit import FLOWER, LEAF, X, Y, smooth_normals, unit

LEAF_UVS = np.array([(0.5, 0.0), (1.0, 0.36), (0.5, 1.0), (0.0, 0.36)])
LEAF_WEAR = np.array([0.0, 0.55, 1.0, 0.55])
LEAF_TRIANGLES = np.array([(0, 1, 2), (0, 2, 3)])
PETALS = 5
FLOWER_KINDS = 7


def hue_of(kind):
    """The hue seed of one of the meadow's seven kinds of flower."""
    return (int(kind) % FLOWER_KINDS + 0.5) / FLOWER_KINDS


def leaf(kit, base, axis, facing, size, tone):
    """One folded kite leaf from `base` along `axis`, its upper side toward `facing`."""
    axis = unit(axis)
    across = np.cross(axis, facing)
    if np.linalg.norm(across) < 1e-6:
        across = np.cross(axis, Y if abs(axis[1]) < 0.9 else X)
    across = unit(across)
    face = np.cross(across, axis)
    base = np.asarray(base, dtype=float)
    shoulder = base + axis * size * 0.36 + face * size * 0.08
    positions = np.array([base, shoulder + across * size * 0.4, base + axis * size - face * size * 0.05,
                          shoulder - across * size * 0.4])
    normals = smooth_normals(positions, LEAF_TRIANGLES)
    triangles = LEAF_TRIANGLES
    if float(np.dot(normals.sum(axis=0), face)) < 0:
        normals = -normals
        triangles = LEAF_TRIANGLES[:, [0, 2, 1]]
    kit.mesh(positions, triangles, normals, LEAF_UVS, LEAF, tone=tone, wear=LEAF_WEAR)


def sprig(kit, base, outward, direction, size, leaves=3, tone=None, lift=(0.12, 0.6), fan=1.2):
    """A cluster of leaves sharing a stalk.

    The leaves lie over a surface that faces `outward`, fanned about `direction` across it
    and lifted off it at their tips, so each shows its face to whoever looks at the surface.
    """
    rng = kit.rng
    outward = unit(outward)
    direction = np.asarray(direction, dtype=float)
    direction = direction - outward * float(np.dot(direction, outward))
    if np.linalg.norm(direction) < 1e-6:
        direction = np.cross(outward, Y if abs(outward[1]) < 0.9 else X)
    direction = unit(direction)
    side = np.cross(outward, direction)
    if tone is None:
        tone = float(rng.uniform(0.3, 1.0))
    for index in range(leaves):
        swing = (index - (leaves - 1) * 0.5) * fan / max(1, leaves - 1) + float(rng.uniform(-0.3, 0.3))
        axis = unit(direction * math.cos(swing) + side * math.sin(swing) + outward * float(rng.uniform(*lift)))
        facing = unit(outward + rng.normal(size=3) * 0.3)
        leaf(kit, base, axis, facing, size * float(rng.uniform(0.78, 1.22)),
             float(np.clip(tone + rng.uniform(-0.15, 0.15), 0.0, 1.0)))


def flower(kit, centre, facing, radius, hue=None):
    """A meadow flower: a scalloped disc of five petals around a raised eye."""
    rng = kit.rng
    facing = unit(facing)
    side = np.cross(facing, Y)
    if np.linalg.norm(side) < 1e-6:
        side = np.cross(facing, X)
    side = unit(side)
    rise = np.cross(side, facing)
    centre = np.asarray(centre, dtype=float)
    start = float(rng.uniform(0, math.tau))
    positions = [centre + facing * radius * 0.2]
    uvs = [(0.5, 0.5)]
    wear = [0.0]
    for index in range(PETALS * 2):
        angle = start + math.pi * index / PETALS
        reach = radius if index % 2 == 0 else radius * 0.68
        positions.append(centre + (side * math.cos(angle) + rise * math.sin(angle)) * reach)
        uvs.append((0.5 + 0.5 * math.cos(angle) * reach / radius, 0.5 + 0.5 * math.sin(angle) * reach / radius))
        wear.append(1.0 if index % 2 == 0 else 0.6)
    positions = np.array(positions)
    count = PETALS * 2
    triangles = np.array([(0, 1 + index, 1 + (index + 1) % count) for index in range(count)])
    normals = smooth_normals(positions, triangles)
    if float(np.dot(normals.sum(axis=0), facing)) < 0:
        normals = -normals
        triangles = triangles[:, [0, 2, 1]]
    kit.mesh(positions, triangles, normals, np.array(uvs), FLOWER,
             tone=hue_of(rng.integers(0, FLOWER_KINDS)) if hue is None else hue, wear=np.array(wear))


def _resample(path, spacing):
    """Points every `spacing` metres along a polyline, with the unit tangent at each."""
    path = np.asarray(path, dtype=float)
    segments = np.linalg.norm(np.diff(path, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(segments)])
    count = max(2, int(round(arc[-1] / spacing)) + 1)
    points = []
    tangents = []
    for distance in np.linspace(0.0, arc[-1], count):
        index = int(min(max(np.searchsorted(arc, distance, side="right") - 1, 0), len(path) - 2))
        local = (distance - arc[index]) / max(segments[index], 1e-9)
        points.append(path[index] * (1.0 - local) + path[index + 1] * local)
        tangents.append(unit(path[index + 1] - path[index]))
    return np.array(points), np.array(tangents)


def garland(kit, path, core=0.05, spacing=0.085, leaf_size=0.15, lean=(0.0, -0.3, 0.0), closed=False, sides=5,
            leaves=3, bias=None):
    """Clothe a path in birch sprigs around a dark leafy core.

    `lean` pulls the sprigs one way along the garland (gravity, mostly); `bias` (a
    direction) turns more of them toward the side the garland is seen from.
    """
    rng = kit.rng
    path = np.asarray(path, dtype=float)
    looped = np.concatenate([path, path[:1]]) if closed else path
    length = float(np.linalg.norm(np.diff(looped, axis=0), axis=1).sum())
    rings, _ = _resample(looped, min(0.24, length / 12.0) if closed else 0.24)
    if closed:
        rings = rings[:-1]
    radii = core * (0.75 + 0.5 * rng.random(len(rings)))
    # The core is the shaded inside of the garland: low tone, and the bake darkens it further.
    kit.tube(rings, radii, sides, LEAF, tone=float(rng.uniform(0.04, 0.14)), wear=0.0, closed=closed,
             cap_start=not closed, cap_end=not closed, lumpy=0.3)
    points, tangents = _resample(looped, spacing)
    if closed:
        points, tangents = points[:-1], tangents[:-1]
    azimuth = float(rng.uniform(0, math.tau))
    for point, tangent in zip(points, tangents):
        azimuth += GOLDEN + float(rng.uniform(-0.5, 0.5))
        reference = Y if abs(tangent[1]) < 0.9 else X
        u = unit(np.cross(tangent, reference))
        w = np.cross(tangent, u)
        radial = u * math.cos(azimuth) + w * math.sin(azimuth)
        if bias is not None and float(np.dot(radial, bias)) < -0.2 and rng.random() < 0.5:
            radial = unit(radial + np.asarray(bias) * 1.2)
            radial = unit(radial - tangent * float(np.dot(radial, tangent)))
        around = np.cross(tangent, radial)
        direction = (tangent * float(rng.uniform(-1.0, 1.0)) + around * float(rng.uniform(-0.7, 0.7))
                     + np.asarray(lean, dtype=float))
        sprig(kit, point + radial * core * 0.85, radial, direction, leaf_size, leaves=leaves)


def ring_path(centre, normal, radius, segments=20):
    """A circle of `segments` points around `centre`, lying across `normal`."""
    normal = unit(normal)
    side = unit(np.cross(Y, normal)) if abs(normal[1]) < 0.9 else X
    rise = np.cross(normal, side)
    centre = np.asarray(centre, dtype=float)
    return np.array([centre + (side * math.cos(math.tau * index / segments)
                               + rise * math.sin(math.tau * index / segments)) * radius
                     for index in range(segments)]), side, rise


def wreath(kit, centre, normal, radius, core=0.055, spacing=0.07, leaf_size=0.15, flowers=16, back_flowers=3,
           flower_size=0.062, leaves=3, first_kind=0):
    """A midsummer wreath: a hoop of birch leaves studded with meadow flowers on its face.

    The flowers go round the seven kinds in turn (three places on at each step, so no two
    neighbours match), starting from `first_kind`.
    """
    rng = kit.rng
    normal = unit(normal)
    path, side, rise = ring_path(centre, normal, radius)
    garland(kit, path, core=core, spacing=spacing, leaf_size=leaf_size, lean=(0.0, -0.15, 0.0), closed=True,
            bias=normal, leaves=leaves)
    centre = np.asarray(centre, dtype=float)
    kind = first_kind
    for count, sign in ((flowers, 1.0), (back_flowers, -1.0)):
        start = float(rng.uniform(0, math.tau))
        for index in range(count):
            angle = start + math.tau * (index + float(rng.uniform(-0.3, 0.3))) / max(1, count)
            radial = side * math.cos(angle) + rise * math.sin(angle)
            lift = float(rng.uniform(0.0, 0.7))
            facing = unit(normal * sign + radial * lift)
            position = (centre + radial * (radius + core * 1.5 * lift * float(rng.uniform(0.3, 1.0)))
                        + facing * (core * 1.3 + leaf_size * 0.3))
            flower(kit, position, facing, flower_size * float(rng.uniform(0.8, 1.25)), hue=hue_of(kind))
            kind += 3
