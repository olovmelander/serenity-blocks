"""The eagle owl's limbs, grown into the two elders (src/themes/forest/forest-owl-perches.js).

The owl lives on dead limbs: a long one reaching out of the elder spruce toward the moon, a stout one
lower on the same trunk, a broken stub out of the elder pine over the knoll, another below it and one
high in its bare stretch. They are grown into the trees themselves, so the bark mesher, the bark masks,
the occlusion bake, the bark shader and the wind are the trees' own; only their shape is drawn here.

A dead spruce limb is grey and lichened. It leaves the trunk through a swollen collar, droops a little
and lifts again toward its tip, kinks at every node where a branchlet grew, and carries the stumps of
those branchlets in two rows along its flanks: most broken short, a few still long and forked. Its wood
is checked along the grain. It ends in a thin whip, or broken off in splinters. A pine's dead limbs are
stouter and shorter, with few side stumps, broken off. Where the owl sits (a seat) the top of the limb
is kept clear of stumps.

The generator's own dead stubs on these two trunks are dressed the same way (more sides, the checked
wood, a broken end), so the owl's limbs and the stubs beside them read as one tree's.

Every owl limb's centreline, its top and its seats go into the tree's extras (`owlLimbs`), in the
tree's own frame; scripts/forest/pack-owl-limbs.mjs places them in the world for the theme.
"""

import math

import numpy as np

from fall_grove.skeleton import UP, Branch, normalize
from fall_grove.wood import BARK_TILE_METRES, catmull_refine, fbm, grid_normals

# How finely a limb's axis is laid (metres between rings).
STEP = 0.04
# Kinds the bark mesher keeps with the trunk (drawn on every tier: the owl sits on them).
PERCH_KINDS = ("perch", "perch-twig")


def _limb(id, points, radius, seats, end="broken", sides=11, nodes=(0.08, 0.13), long_twigs=0.35,
          twig_scale=1.0, zigzag=1.6, replaces=None, seed=0):
    return dict(id=id, points=points, radius=radius, seats=seats, end=end, sides=sides, nodes=nodes,
                long_twigs=long_twigs, twig_scale=twig_scale, zigzag=zigzag, replaces=replaces, seed=seed)


# Each limb in its tree's frame (glTF Y-up metres, the trunk's foot at the origin): the axis's control
# points from inside the trunk out, the radius where it leaves the trunk and at its end, and its seats
# (the owl's places, as a share of the axis's length from its start inside the trunk).
OWL_LIMBS = {
    "spruce-elder": (
        # Out toward the moon at 4.6 m: from the eye the owl sits on it beside the moon's lower limb.
        _limb("home", [[-0.128, 4.634, 0.41], [0.03, 4.688, 0.831], [0.207, 4.681, 1.298], [0.383, 4.593, 1.766],
                       [0.542, 4.467, 2.186], [0.655, 4.43, 2.47]],
              radius=(0.086, 0.006), end="whip", seats=dict(limbIn=0.42, limb=0.565, limbOut=0.72), long_twigs=0.45,
              nodes=(0.07, 0.12), seed=11),
        # Lower on the trunk, out over the ferns: older, stouter, broken off.
        _limb("low", [[-0.058, 2.737, 0.203], [-0.136, 2.811, 0.797], [-0.214, 2.83, 1.392], [-0.292, 2.79, 1.986],
                      [-0.334, 2.735, 2.3]],
              radius=(0.08, 0.034), end="broken", seats=dict(lowIn=0.53, low=0.72), long_twigs=0.3,
              nodes=(0.07, 0.12), seed=12),
    ),
    "pine-elder": (
        # Out to the left of the pine over the knoll at 5.5 m.
        _limb("pine", [[0.256, 5.48, -0.208], [0.467, 5.532, -0.548], [0.704, 5.528, -0.931], [0.915, 5.46, -1.271],
                       [1.05, 5.4, -1.49]],
              radius=(0.074, 0.036), end="broken", seats=dict(pine=0.67), nodes=(0.2, 0.34), long_twigs=0.15,
              sides=9, zigzag=0.8, seed=21),
        # Below it, a shorter stub.
        _limb("pineLow", [[0.096, 3.38, -0.174], [0.101, 3.422, -0.574], [0.106, 3.418, -1.024], [0.11, 3.36, -1.374],
                          [0.112, 3.31, -1.6]],
              radius=(0.072, 0.034), end="broken", seats=dict(pineLow=0.67), nodes=(0.2, 0.34), long_twigs=0.15,
              sides=9, zigzag=0.8, seed=22),
        # High in the bare stretch, where the generator had a stub of its own (it takes that one's place).
        _limb("pineHigh", [[0.36, 8.35, -0.21], [0.193, 8.37, -0.405], [-0.055, 8.395, -0.69], [-0.3, 8.37, -0.97],
                           [-0.5, 8.31, -1.2]],
              radius=(0.07, 0.03), end="broken", seats=dict(pineHigh=0.67), nodes=(0.2, 0.34), long_twigs=0.15,
              sides=8, zigzag=0.8, replaces=(0.36, 8.35, -0.21), seed=23),
    ),
}


# -- the trunk -------------------------------------------------------------------------------
def trunk_at(trunk, height):
    """The trunk's centre and radius at a height (linear between its stations)."""
    ys = trunk.points[:, 1]
    index = int(np.clip(np.searchsorted(ys, height) - 1, 0, len(ys) - 2))
    span = ys[index + 1] - ys[index]
    t = 0.0 if span <= 1e-9 else float(np.clip((height - ys[index]) / span, 0.0, 1.0))
    centre = trunk.points[index] * (1 - t) + trunk.points[index + 1] * t
    radius = trunk.radii[index] * (1 - t) + trunk.radii[index + 1] * t
    return centre, float(radius)


def _attach_t(trunk, height):
    ys = trunk.points[:, 1]
    return float(np.clip((height - ys[0]) / max(ys[-1] - ys[0], 1e-6), 0.0, 1.0))


# -- the axis --------------------------------------------------------------------------------
def _resample(points, step):
    """A polyline through `points` (Catmull-Rom), resampled to rings `step` apart; and its arc."""
    dense, _ = catmull_refine(np.asarray(points, dtype=float), np.zeros(len(points)), 24)
    lengths = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(lengths)])
    total = float(arc[-1])
    count = max(4, int(math.ceil(total / step)))
    targets = np.linspace(0.0, total, count + 1)
    out = np.stack([np.interp(targets, arc, dense[:, k]) for k in range(3)], axis=1)
    return out, targets


def _frames(points):
    tangents = np.zeros_like(points)
    for index in range(len(points)):
        tangents[index] = normalize(points[min(index + 1, len(points) - 1)] - points[max(index - 1, 0)])
    sideways = np.array([normalize(np.cross(UP, t)) for t in tangents])
    upward = np.array([normalize(np.cross(t, s)) for t, s in zip(tangents, sideways)])
    return tangents, sideways, upward


def _surface_exit(points, arc, trunk):
    """How far along the axis it leaves the trunk's bark."""
    for index, point in enumerate(points):
        centre, radius = trunk_at(trunk, point[1])
        if math.hypot(point[0] - centre[0], point[2] - centre[2]) >= radius - 0.01:
            return float(arc[index])
    return float(arc[0])


# -- pieces of wood ---------------------------------------------------------------------------
def _flat_piece(positions, triangles, sway, phase, mask):
    """Flat-shaded triangles in the bark's vertex layout (torn wood keeps sharp edges)."""
    corners = np.asarray(positions, dtype=float)[np.asarray(triangles, dtype=np.int64).reshape(-1)]
    tri = corners.reshape(-1, 3, 3)
    face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    face = face / np.maximum(np.linalg.norm(face, axis=1, keepdims=True), 1e-12)
    normals = np.repeat(face, 3, axis=0)
    dominant = np.argmax(np.abs(normals), axis=1)
    first = np.where(dominant == 0, 2, 0)
    second = np.where(dominant == 1, 2, 1)
    rows = np.arange(len(corners))
    uvs = np.stack([corners[rows, first], corners[rows, second]], axis=1) / BARK_TILE_METRES
    colors = np.zeros((len(corners), 4))
    colors[:, 0] = sway
    colors[:, 1] = phase
    colors[:, 2] = 1.0
    colors[:, 3] = mask
    return corners, normals, uvs, colors, np.arange(len(corners))


def _oriented(positions, triangle, outward):
    a, b, c = (positions[i] for i in triangle)
    if np.dot(np.cross(b - a, c - a), outward) < 0:
        return (triangle[0], triangle[2], triangle[1])
    return triangle


def splinters(ring, centre, axis, rng, radius, long_side=None):
    """Close a broken end: a crown of splinters round a ragged pit (positions and triangles).

    `ring` is the tube's last ring (no seam duplicate), `axis` points out of the end. Most of the
    splinters are short; the side the limb tore from (`long_side`, a unit vector across the axis)
    keeps a few long ones.
    """
    ring = np.asarray(ring, dtype=float)
    count = len(ring)
    radial = ring - centre
    radial = radial - np.outer(radial @ axis, axis)
    lengths = radius * rng.uniform(0.15, 0.9, size=count)
    if long_side is not None:
        across = np.array([normalize(r) @ long_side for r in radial])
        lengths += radius * np.clip(across, 0.0, 1.0) ** 2 * rng.uniform(1.0, 2.6, size=count)
    tips = ring + np.outer(lengths, axis) - radial * rng.uniform(0.08, 0.35, size=(count, 1))
    following = np.roll(np.arange(count), -1)
    notch_depth = np.minimum(lengths, lengths[following]) * rng.uniform(0.0, 0.45, size=count)
    notches = ((ring + ring[following]) * 0.5 + np.outer(notch_depth, axis)
               - (radial + radial[following]) * 0.5 * rng.uniform(0.04, 0.14, size=(count, 1)))
    inner = (centre + radial * rng.uniform(0.3, 0.62, size=(count, 1))
             + np.outer(lengths * rng.uniform(-0.05, 0.4, size=count) - radius * rng.uniform(0.05, 0.4, size=count),
                        axis))
    core = centre - axis * radius * 0.25
    positions = np.concatenate([ring, tips, notches, inner, [core]])
    tip0, notch0, inner0, core_index = count, count * 2, count * 3, count * 4
    beyond = centre + axis * (float(lengths.max()) + radius * 6.0)
    triangles = []
    for c in range(count):
        n = int(following[c])
        outward = normalize(radial[c] + radial[n])
        for triangle in ((c, n, notch0 + c), (c, notch0 + c, tip0 + c), (n, tip0 + n, notch0 + c)):
            triangles.append(_oriented(positions, triangle, outward))
        for triangle in ((tip0 + c, notch0 + c, inner0 + c), (notch0 + c, tip0 + n, inner0 + n),
                         (notch0 + c, inner0 + n, inner0 + c), (inner0 + c, inner0 + n, core_index)):
            middle = (positions[triangle[0]] + positions[triangle[1]] + positions[triangle[2]]) / 3.0
            triangles.append(_oriented(positions, triangle, beyond - middle))
    return positions, triangles


def _cone_cap(ring, centre, axis, length):
    """Close a thin tube's end with a short cone."""
    ring = np.asarray(ring, dtype=float)
    count = len(ring)
    tip = centre + axis * length
    positions = np.concatenate([ring, [tip]])
    triangles = []
    for c in range(count):
        n = (c + 1) % count
        outward = normalize((ring[c] + ring[n]) * 0.5 - centre + axis * length * 0.5)
        triangles.append(_oriented(positions, (c, n, count), outward))
    return positions, triangles


def _merge(pieces):
    offset = 0
    out = [[], [], [], [], []]
    for positions, normals, uvs, colors, indices in pieces:
        out[0].append(positions)
        out[1].append(normals)
        out[2].append(uvs)
        out[3].append(colors)
        out[4].append(np.asarray(indices, dtype=np.int64).reshape(-1) + offset)
        offset += len(positions)
    return tuple(np.concatenate(part) for part in out)


def _dead_wood(species, positions, normals, mask_values, seed):
    """The species mask, turned to dead wood: lichened grey on a spruce, bare grey on a pine."""
    patch = fbm(positions, 5.5, 2, seed + 31)
    if species == "spruce":
        return np.clip(0.28 + 0.85 * mask_values + 0.55 * (patch - 0.5) + 0.12 * np.clip(normals[:, 1], 0.0, 1.0),
                       0.0, 1.0)
    return np.clip(0.4 * mask_values + 0.35 * np.clip(patch - 0.45, 0.0, 1.0), 0.0, 1.0)


def _finisher(species, seed, sides, end, rng_seed, record=None, checks=1.0, roughness=1.0, cap_length=0.0,
              collar=None):
    """The finishing pass for one tube: checked, knobbly wood, a broken or capped end, the mask."""

    def finish(positions, normals, uvs, colors, indices, columns, mask):
        rings = len(positions) // columns
        grid = positions.reshape(rings, columns, 3)
        centres = grid[:, :-1].mean(axis=1)
        out = grid.copy()
        theta = np.linspace(0.0, math.tau, columns)
        length_along = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(centres, axis=0), axis=1))])
        for ring in range(rings):
            offset = grid[ring] - centres[ring]
            radius = np.maximum(np.linalg.norm(offset, axis=1, keepdims=True), 1e-6)
            direction = offset / radius
            lump = fbm(grid[ring], 13.0, 2, seed + 7) - 0.5
            # Checks: grooves along the grain, wandering a little round the limb.
            wander = 2.2 * (fbm(np.array([[length_along[ring] * 2.6, 0.0, 0.0]]), 1.0, 2, seed + 13)[0] - 0.5)
            groove = np.clip((np.cos(theta * 5.0 + wander + seed) - 0.62) / 0.38, 0.0, 1.0) ** 2
            fine = np.clip((np.cos(theta * 11.0 - wander * 1.7 + seed * 0.7) - 0.8) / 0.2, 0.0, 1.0) ** 2
            scale = 1.0 + roughness * 0.1 * lump - checks * (0.07 * groove + 0.035 * fine)
            if collar is not None:
                # The collar swells most under the limb, where the trunk's wood has carried its weight.
                below = np.clip(-direction[:, 1], 0.0, 1.0)
                past = max(0.0, length_along[ring] - collar)
                scale = scale + 0.2 * below ** 1.5 * math.exp(-(past / 0.13) ** 2)
            out[ring] = centres[ring] + direction * radius * scale[:, None]
        moved = out.reshape(-1, 3)
        moved_normals = grid_normals(moved, rings, columns)
        if mask is not None:
            colors = colors.copy()
            colors[:, 3] = _dead_wood(species, moved, moved_normals, mask(moved, moved_normals), seed)
        pieces = [(moved, moved_normals, uvs, colors, indices)]
        last = out[-1, :-1]
        axis = normalize(centres[-1] - centres[-2])
        sway = float(colors[-1, 0])
        phase = float(colors[-1, 1])
        rng = np.random.default_rng(rng_seed)
        end_radius = float(np.mean(np.linalg.norm(last - centres[-1], axis=1)))
        if end == "broken":
            across = normalize(np.cross(axis, np.cross(UP, axis)) * rng.uniform(-1.0, 1.0)
                               + np.cross(UP, axis) * rng.uniform(-1.0, 1.0))
            cap_positions, triangles = splinters(last, centres[-1], axis, rng, end_radius, long_side=across)
            pieces.append(_flat_piece(cap_positions, triangles, sway, phase, 0.92 if species == "spruce" else 0.85))
        elif cap_length > 0.0:
            cap_positions, triangles = _cone_cap(last, centres[-1], axis, max(cap_length, end_radius * 0.8))
            pieces.append(_flat_piece(cap_positions, triangles, sway, phase, float(np.mean(colors[-columns:, 3]))))
        if record is not None:
            # The top of every ring, where the owl's toes close.
            record["tops"] = [round(float(v), 4) for v in out[:, :-1, 1].max(axis=1)]
            record["centres"] = [[round(float(v), 4) for v in c] for c in centres]
        return _merge(pieces)

    return finish


# -- growing ----------------------------------------------------------------------------------
def _radii(arc, surface, base, tip, end):
    total = float(arc[-1])
    out = np.zeros(len(arc))
    for index, s in enumerate(arc):
        past = max(0.0, s - surface)
        k = past / max(total - surface, 1e-6)
        radius = base + (tip - base) * k ** 0.8
        if end == "whip":
            # Stout where the owl sits, then a long thin tip.
            held = base * (1.0 - 0.5 * min(k, 0.8) ** 1.1)
            radius = held if k <= 0.8 else held + (tip - held) * ((k - 0.8) / 0.2) ** 0.7
        # The collar: the trunk's wood swells round the limb where it leaves the bark (the finishing
        # pass adds the heavier swelling underneath).
        radius *= 1.0 + 0.22 * math.exp(-(past / 0.17) ** 2)
        out[index] = radius
    return out


def _nodes(spec, surface, total, rng):
    """Where branchlets grew: alternately on the two flanks."""
    nodes = []
    s = surface + rng.uniform(0.05, 0.1)
    side = 1.0 if rng.random() < 0.5 else -1.0
    while s < total - 0.04:
        nodes.append((s, side))
        side = -side
        s += rng.uniform(*spec["nodes"])
    return nodes


def _rotate(vector, axis, angle):
    axis = normalize(axis)
    return (vector * math.cos(angle) + np.cross(axis, vector) * math.sin(angle)
            + axis * float(np.dot(axis, vector)) * (1.0 - math.cos(angle)))


def _zigzag(points, arc, nodes, surface, rng, amount=1.0):
    """Turn the axis a few degrees at every node, away from the branchlet it gave there.

    A limb grown a node at a time is a zigzag of short straight runs, never a smooth curve. The turns
    alternate with the branchlets, so the limb keeps its line; each eases in over a ring or two.
    """
    segments = np.diff(points, axis=0)
    out = [points[0]]
    yaw = pitch = 0.0
    yaw_goal = pitch_goal = 0.0
    k = 0
    for index, segment in enumerate(segments):
        s = arc[index]
        while k < len(nodes) and nodes[k][0] <= s:
            yaw_goal = -nodes[k][1] * math.radians(rng.uniform(2.5, 6.0)) * amount
            pitch_goal = math.radians(rng.uniform(-2.0, 2.6)) * amount
            k += 1
        if s >= surface:
            yaw += (yaw_goal - yaw) * 0.65
            pitch += (pitch_goal - pitch) * 0.65
        side = np.cross(UP, segment)
        turned = _rotate(segment, UP, yaw)
        if np.linalg.norm(side) > 1e-9:
            turned = _rotate(turned, side, pitch)
        out.append(out[-1] + turned)
    return np.array(out)


def _twigs(tree, spec, nodes, arc, surface, points, frames, radii, rng, sway, phase, species):
    """The stumps of the branchlets the limb once carried, in two rows along its flanks."""
    tangents, sideways, upward = frames
    total = float(arc[-1])
    seats = [u * total for u in spec["seats"].values()]
    # The owl sidles between its seats: that stretch keeps only short stumps, and none by its toes.
    walk = (min(seats) - 0.12, max(seats) + 0.12) if seats else (9.0, -9.0)
    made = []
    for s, side in nodes:
        near_seat = min((abs(s - seat) for seat in seats), default=9.0)
        index = int(np.clip(np.searchsorted(arc, s), 1, len(arc) - 1))
        origin = points[index]
        here = radii[index]
        k = (s - surface) / max(total - surface, 1e-6)
        on_walk = walk[0] <= s <= walk[1]
        # A long twig before a seat would reach forward into the owl's breast.
        before = bool(seats) and min(seats) - 0.45 <= s <= walk[1]
        long = rng.random() < spec["long_twigs"] * (0.5 + k) and not before
        if near_seat < 0.1:
            # By a seat only a nub on the underside of the flank, clear of the toes.
            length = rng.uniform(0.012, 0.03)
            rise = math.radians(rng.uniform(-55, -35))
        elif on_walk:
            length = rng.uniform(0.025, 0.07) * spec["twig_scale"]
            rise = math.radians(rng.uniform(-35, 0))
        elif before:
            length = rng.uniform(0.03, 0.09) * spec["twig_scale"]
            rise = math.radians(rng.uniform(-30, 10))
        elif long:
            length = rng.uniform(0.18, 0.5) * spec["twig_scale"] * (0.7 + 0.5 * k)
            rise = math.radians(rng.uniform(-14, 12))
        else:
            length = rng.uniform(0.04, 0.14) * spec["twig_scale"]
            rise = math.radians(rng.uniform(-22, 15))
        forward = math.radians(rng.uniform(45, 66) if species == "spruce" else rng.uniform(55, 80))
        lateral = sideways[index] * side * math.cos(rise) + upward[index] * math.sin(rise)
        direction = normalize(tangents[index] * math.cos(forward) + lateral * math.sin(forward))
        start = origin + direction * here * 0.3
        # A branchlet is slender for its limb; the stumps of the small ones slenderer still.
        share = 0.34 if long else (0.22 if (on_walk or before or near_seat < 0.1) else 0.28)
        base_radius = float(np.clip(here * share * (1.0 if species == "spruce" else 1.15), 0.0045, 0.02))
        steps = 5 if long else 2
        twig_points = [start]
        heading = direction.copy()
        for _ in range(steps):
            heading = normalize(heading + rng.normal(0.0, 0.12, 3) - UP * (0.06 if long else 0.0))
            twig_points.append(twig_points[-1] + heading * (length + here * 0.7) / steps)
        twig_points = np.array(twig_points)
        tip_radius = max(0.0028, base_radius * (0.3 if long else 0.8))
        twig_radii = np.linspace(base_radius, tip_radius, len(twig_points))
        # Its own little collar where it leaves the limb.
        twig_radii[0] *= 1.35
        twig = Branch(twig_points, twig_radii, 2, None, 0.0, phase, sway, 0.0, 5 if long else 4, "perch-twig")
        twig.detail = 1
        twig.finish = _finisher(species, int(rng.integers(1, 9999)), 5, "cap", int(rng.integers(1, 1 << 30)),
                                checks=0.0, roughness=0.6, cap_length=tip_radius * (0.8 if long else 0.35))
        tree.branches.append(twig)
        made.append(twig)
        if long:
            # A long one keeps a fork or two of its own.
            for _ in range(int(rng.integers(1, 4))):
                at = int(rng.integers(1, len(twig_points) - 1))
                fork_dir = normalize(normalize(twig_points[at] - twig_points[at - 1])
                                     + normalize(np.cross(UP, direction)) * rng.uniform(-0.9, 0.9)
                                     + UP * rng.uniform(-0.25, 0.3))
                fork_length = length * rng.uniform(0.18, 0.42)
                fork_points = np.array([twig_points[at], twig_points[at] + fork_dir * fork_length * 0.5,
                                        twig_points[at] + fork_dir * fork_length])
                fork_radius = max(0.0028, float(twig_radii[at]) * 0.72)
                fork = Branch(fork_points, np.linspace(fork_radius, 0.0024, 3), 3, twig, 0.0, phase, sway, 0.0, 3,
                              "perch-twig")
                fork.detail = 1
                fork.finish = _finisher(species, int(rng.integers(1, 9999)), 4, "cap", int(rng.integers(1, 1 << 30)),
                                        checks=0.0, roughness=0.4, cap_length=0.004)
                tree.branches.append(fork)
    return made


def grow_limb(tree, trunk, spec, species, out_records):
    rng = np.random.default_rng(9000 + spec["seed"])
    points, arc = _resample(spec["points"], STEP)
    surface = _surface_exit(points, arc, trunk)
    total = float(arc[-1])
    nodes = _nodes(spec, surface, total, rng)
    points = _zigzag(points, arc, nodes, surface, rng, amount=spec.get("zigzag", 1.0))
    # And a slow wander across its line.
    _tangents, sideways, _upward = _frames(points)
    wobble = (np.sin(arc * 2.7 + rng.uniform(0, math.tau)) * 0.016
              + np.sin(arc * 6.1 + rng.uniform(0, math.tau)) * 0.006) * np.clip((arc - surface) / 0.3, 0.0, 1.0)
    points = points + sideways * wobble[:, None]
    frames = _frames(points)
    radii = _radii(arc, surface, spec["radius"][0], spec["radius"][1], spec["end"])
    attach = _attach_t(trunk, points[0][1])
    sway = trunk.sway_at(attach)
    phase = trunk.phase
    record = dict(id=spec["id"], seats={k: round(float(v), 4) for k, v in spec["seats"].items()})
    twigs = _twigs(tree, spec, nodes, arc, surface, points, frames, radii, rng, sway, phase, species)
    limb = Branch(points, radii, 1, trunk, attach, phase, sway, 0.0, spec["sides"], "perch")
    limb.detail = 1
    limb.finish = _finisher(species, spec["seed"] * 17 + 3, spec["sides"], spec["end"], spec["seed"] * 7919 + 1,
                            record=record, cap_length=0.004, collar=surface)
    for twig in twigs:
        twig.parent = limb
    tree.branches.append(limb)
    record["radii"] = [round(float(r), 4) for r in radii]
    record["surface"] = round(surface / total, 4)
    out_records.append(record)
    return limb


def dress_stub(stub, species, seed):
    """The generator's own dead stub, meshed like the owl's limbs: more sides, checked wood, broken off."""
    stub.sides = 6
    stub.detail = 1
    radii = np.array(stub.radii, dtype=float)
    # Broken short rather than whittled to a point.
    stub.radii = np.maximum(radii, radii[0] * 0.38)
    stub.finish = _finisher(species, seed, 6, "broken", seed * 31 + 5)


def grow_into(tree, recipe):
    """Add the owl's limbs (and dress the dead stubs) of `recipe` to its grown tree; returns the tree."""
    species = tree.meta["species"]
    trunk = tree.branches[0]
    records = []
    for spec in OWL_LIMBS.get(recipe, ()):
        if spec["replaces"] is not None:
            base = np.array(spec["replaces"])
            tree.branches = [b for b in tree.branches
                             if not (b.kind == "stub" and np.linalg.norm(b.points[0] - base) < 0.15)]
        grow_limb(tree, trunk, spec, species, records)
    for index, branch in enumerate(tree.branches):
        if branch.kind == "stub":
            dress_stub(branch, species, 500 + index)
    if records:
        tree.meta["owlLimbs"] = records
    return tree
