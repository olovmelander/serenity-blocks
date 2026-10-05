"""How crystals grow: bursts from a common root. Pure numpy (no bpy).

A crystal is a hexagonal prism of `height` (root to shoulder) with a termination of
`tip` above it, radii `radius` x `depth`, standing on its root at `position` along the
+y axis of `quat`. The runtime shader and the bake stand-ins use the same record.
"""

import math

import numpy as np

GOLDEN = math.pi * (3.0 - math.sqrt(5.0))
UP = np.array([0.0, 1.0, 0.0])

#: Mineral families; the index is shared with the runtime palette and the baked channels.
FAMILIES = ("aqua", "amethyst", "sapphire", "rose", "amber")


def quat_from_axis_angle(axis, angle):
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / max(np.linalg.norm(axis), 1e-12)
    half = angle * 0.5
    return np.array([*(axis * math.sin(half)), math.cos(half)])


def quat_multiply(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def quat_rotate(q, v):
    xyz = np.asarray(q[:3])
    v = np.asarray(v, dtype=np.float64)
    t = 2.0 * np.cross(xyz, v)
    return v + q[3] * t + np.cross(xyz, t)


def quat_between(source, target):
    """Shortest rotation taking unit vector `source` to unit vector `target`."""
    source = np.asarray(source, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    d = float(np.dot(source, target))
    if d < -0.999999:
        axis = np.cross(source, [1.0, 0.0, 0.0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(source, [0.0, 0.0, 1.0])
        return quat_from_axis_angle(axis, math.pi)
    q = np.array([*np.cross(source, target), 1.0 + d])
    return q / np.linalg.norm(q)


def grow_cluster(rng, root, axis, count, height, radius, family, spread=0.75, accent=None, glow=1.0, lean=None,
                 group=0, slim=1.0):
    """Grow one burst. Returns a list of crystal dicts, tallest first.

    `lean` tilts the leading crystal: a (x, y, z) direction blended into the axis.
    `slim` > 1 makes needle-like crystals (taller for the same radius is `height`'s job;
    slim narrows the skirt crystals only).
    """
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / np.linalg.norm(axis)
    frame = quat_between(UP, axis)
    root = np.asarray(root, dtype=np.float64)
    crystals = []
    for index in range(count):
        rank = 0.0 if count == 1 else index / (count - 1)
        azimuth = index * GOLDEN + rng.random() * 0.9
        side = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        if index == 0:
            incline = (rng.random() - 0.5) * 0.08
        else:
            incline = spread * (0.28 + 0.72 * math.sqrt(rank)) * (0.7 + rng.random() * 0.5)
        tilt = quat_from_axis_angle([side[2], 0.0, -side[0]], incline)
        direction = quat_rotate(frame, quat_rotate(tilt, UP))
        if index == 0 and lean is not None:
            direction = direction + np.asarray(lean, dtype=np.float64)
            direction = direction / np.linalg.norm(direction)
        taper = 1.0 - 0.66 * rank ** 0.8
        tall = height * taper * (0.72 + rng.random() * 0.5)
        wide = radius * (1.0 - 0.5 * rank) * (0.72 + rng.random() * 0.5) / (slim if index else 1.0)
        reach = 0.0 if index == 0 else radius * (0.55 + rank * 1.9) * (0.7 + rng.random() * 0.6)
        offset = quat_rotate(frame, side * reach)
        orientation = quat_multiply(quat_between(UP, direction), quat_from_axis_angle(UP, rng.random() * math.tau))
        # Roots sit below the surface so a base is never seen.
        sink = wide * (0.9 + incline * 1.2)
        position = root + offset - direction * sink
        chosen = family
        if accent is not None and index > 0 and rng.random() < 0.2:
            chosen = accent
        crystals.append({
            "position": position,
            "quat": orientation,
            "radius": wide,
            "depth": wide * (0.78 + rng.random() * 0.3),
            "height": tall + sink,
            "tip": wide * (1.1 + rng.random() * 1.5),
            "apex": ((rng.random() - 0.5) * 0.62, (rng.random() - 0.5) * 0.62),
            "family": chosen,
            "glow": glow * (0.75 + rng.random() * 0.5),
            "seed": rng.random(),
            "group": group,
            "rank": rank,
        })
    return crystals


def crystal_tip(crystal):
    """World position of the apex."""
    tau_height = crystal["height"] + crystal["tip"]
    local = np.array([crystal["apex"][0] * crystal["radius"], tau_height, crystal["apex"][1] * crystal["depth"]])
    return crystal["position"] + quat_rotate(crystal["quat"], local)


def crystal_mesh(crystal):
    """Closed triangle mesh of one crystal (vertices (14, 3), faces (24, 3)) for the bake."""
    corner_radius = 1.0 / math.cos(math.pi / 6.0)
    ring = [((index + 0.5) / 6.0) * math.tau for index in range(6)]
    local = []
    for y in (0.0, crystal["height"]):
        for angle in ring:
            local.append([math.cos(angle) * corner_radius * crystal["radius"], y,
                          math.sin(angle) * corner_radius * crystal["depth"]])
    local.append([crystal["apex"][0] * crystal["radius"], crystal["height"] + crystal["tip"],
                  crystal["apex"][1] * crystal["depth"]])
    local.append([0.0, 0.0, 0.0])
    points = np.array([crystal["position"] + quat_rotate(crystal["quat"], p) for p in local])
    faces = []
    for index in range(6):
        nxt = (index + 1) % 6
        faces += [[nxt, index, 6 + index], [nxt, 6 + index, 6 + nxt], [6 + nxt, 6 + index, 12], [index, nxt, 13]]
    return points, np.array(faces, dtype=np.int64)
