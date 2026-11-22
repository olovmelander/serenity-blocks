"""Odyssey's Act II broadleaves, grown in Blender: the shore broadleaf, the gold birch, the red maple
and the blossom tree, three specimens each, at the forest's three tiers.

Run headless (nothing in an open Blender session is touched):

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_trees.py -- \
        --out src/rendering/odyssey/world/odyssey-forest-models.js [--preview <dir>]

or, in a container without Blender, with Blender as a Python module (`pip install bpy==5.2.4`):

    python scripts/blender/odyssey/odyssey_trees.py --out ... [--preview <dir>]

WHAT THE PROCEDURAL CROWN COULD NOT DO. The world's own builder (world/odyssey-forest-geometry.js)
seats a broadleaf's crown on a fixed ring of puffs round a straight trunk: four limbs from one fork,
the same five masses at the same heights on every tree, so a stand reads as a row of lollipops on
bare sticks. Here each tree is GROWN: a trunk that leans and recovers, scaffold limbs that leave
it at their own heights and angles and fork again, and the foliage gathers where the branches end.
So the masses are where the wood carries them, a different number and size on each tree, with
sky and limbs between them, and the crown comes down the trunk the way an open-grown tree's does.

THE OUTPUT CONTRACT IS THE FOREST'S, unchanged (see FOREST_LEAF_CARD in the geometry module and the
forest tests): leaf cards first, six vertices a card at its centre, then the bark as CCW-outward
triangles; `aVert` = (depth in the crown or bark occlusion, height in crown, card flag + size /
sizeMax or 0 for bark, height above ground / total height, 0 on the far tier). Each mass is dressed
the way the procedural crown dresses a puff: at hero five or six cards round its outer side and one
on its top, at mid one card a mass, at far five merged masses. The card's normal is the crown
ellipsoid's, as there, so the forest's light reads a grown crown exactly as it reads a puffed one.

WHAT BLENDER DOES. Each specimen's cards and wood are built as one Blender mesh and its sky is
measured by ray casting against it (mathutils BVH): a card or a bark vertex deep under the crown
sees little sky and is shaded as such, where the procedural crown can only guess from the radius.
`--preview` renders the roster with Cycles (CPU) for review.

Tree units are the forest's: the procedural builder's height and crown width for the same species
(the world scales both by FOREST_WORLD_SCALE). Deterministic: the same script writes the same file.
"""

import argparse
import base64
import json
import math
import sys
from pathlib import Path

import bpy  # noqa: F401  (Blender first: it brings mathutils with it)
import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))

from fall_grove.skeleton import GOLDEN, UP, Envelope, Tree, grow_curve, normalize  # noqa: E402

TAG = "[odyssey-trees]"
QUANT = 1.0 / 4096.0      # tree units per unit of a stored position (int16: +-8 units)
CARD_FLAG = 2             # FOREST_LEAF_CARD.flag
CARD_SIZE_MAX = 4.0       # FOREST_LEAF_CARD.sizeMax
VARIANTS = 3              # the world picks one of three per (species, tier) bucket
BUDGET = {"hero": 560, "mid": 90, "far": 24}   # FOREST_LOD_BUDGET

# The species, in the forest's tree units. `height` and `reach` are what the procedural builder
# measures for the mature stage (total height; the crown's horizontal reach from the axis), so a
# grown tree stands as tall and as wide as the one it replaces and the world's shade plate, culling
# radii and scatter spacing all still hold. `floor` is where the crown starts (a share of the
# height): lower than the procedural crown's 0.48-0.49, because an open-grown broadleaf keeps its
# lower limbs. `trunk` the radius at the root, `fork` where the scaffold leaves the trunk.
SPECIES = {
    "S1-shore-broadleaf": dict(
        height=2.768, reach=1.44, floor=0.22, trunk=0.085, fork=(0.17, 0.24), limbs=(4, 6),
        limb_tilt=(34, 66), masses=(9, 11), mass_r=(0.44, 0.60), dome=0.96, leader=False, spread=1.0,
        lean=0.05,
    ),
    "S4-gold-birch": dict(
        height=3.334, reach=1.15, floor=0.22, trunk=0.062, fork=(0.22, 0.28), limbs=(7, 9),
        limb_tilt=(34, 56), masses=(10, 12), mass_r=(0.32, 0.44), dome=1.1, leader=True, spread=0.92,
        lean=0.07,
    ),
    "S6-red-maple": dict(
        height=2.706, reach=1.54, floor=0.2, trunk=0.075, fork=(0.15, 0.22), limbs=(4, 6),
        limb_tilt=(40, 72), masses=(9, 11), mass_r=(0.44, 0.60), dome=0.9, leader=False, spread=1.1,
        lean=0.05,
    ),
    "S7-pink-blossom": dict(
        height=2.78, reach=1.59, floor=0.2, trunk=0.07, fork=(0.14, 0.2), limbs=(4, 6),
        limb_tilt=(46, 76), masses=(9, 11), mass_r=(0.42, 0.58), dome=0.8, leader=False, spread=1.18,
        lean=0.06,
    ),
}

# How each tier dresses a mass (FOREST_LEAF_CARD.hero / mid / far, the same numbers).
HERO_PER_MASS = 4
HERO_CAP = 1.35
HERO_SEAT = 0.55
HERO_SIZE = 0.62
MID_SIZE = 1.08
FAR_SIZE = 1.15
FAR_MASSES = 5


def _direction(tilt_degrees, azimuth):
    tilt = math.radians(tilt_degrees)
    return np.array([math.sin(tilt) * math.cos(azimuth), math.cos(tilt), math.sin(tilt) * math.sin(azimuth)])


# -- growth -----------------------------------------------------------------------------------------


class Mass:
    """One foliage mass: where a group of branch ends gathers."""

    __slots__ = ("centre", "radius", "host")

    def __init__(self, centre, radius, host):
        self.centre = np.asarray(centre, dtype=float)
        self.radius = float(radius)
        self.host = host          # the branch that carries it (its wood ends in the mass)


def _kmeans(points, weights, count, rng, iterations=24):
    """Weighted k-means (deterministic for a given rng). Returns centres and labels."""
    points = np.asarray(points, dtype=float)
    count = max(1, min(count, len(points)))
    # Farthest-point seeding, from the heaviest point.
    order = [int(np.argmax(weights))]
    distance = np.linalg.norm(points - points[order[0]], axis=1)
    while len(order) < count:
        pick = int(np.argmax(distance * (0.75 + 0.5 * rng.random(len(points)))))
        order.append(pick)
        distance = np.minimum(distance, np.linalg.norm(points - points[pick], axis=1))
    centres = points[order].copy()
    labels = np.zeros(len(points), dtype=int)
    for _ in range(iterations):
        d = np.linalg.norm(points[:, None, :] - centres[None, :, :], axis=2)
        labels = np.argmin(d, axis=1)
        for k in range(count):
            member = labels == k
            if member.any():
                w = weights[member][:, None]
                centres[k] = (points[member] * w).sum(axis=0) / w.sum()
    return centres, labels


def grow_broadleaf(species_id, variant):
    """Grow one specimen in raw units; `normalise` fits it to the species' height and reach."""
    spec = SPECIES[species_id]
    seed = 7919 * (list(SPECIES).index(species_id) + 1) + 104729 * (variant + 1)
    tree = Tree(f"{species_id}#{variant}", seed)
    rng = tree.rng
    height = 10.0                                   # raw units; normalised later
    reach = height * spec["reach"] / spec["height"]
    floor = height * spec["floor"]
    fork = height * float(rng.uniform(*spec["fork"]))
    lean = np.array([rng.uniform(-1, 1) * spec["lean"], 1.0, rng.uniform(-1, 1) * spec["lean"]])
    trunk_len = (height * 0.94) if spec["leader"] else fork + height * 0.04
    trunk_pts = grow_curve(rng, [0.0, 0.0, 0.0], lean, trunk_len, 9 if spec["leader"] else 5,
                           wander=0.05, lift=0.15, kink=0.06)
    trunk = tree.add_branch(trunk_pts, 1.0, 0.18 if not spec["leader"] else 0.06, 0, flex=0.06, sides=6,
                            power=0.8)
    crown_mid = (floor + height) * 0.5
    tree.envelope = Envelope([0.0, crown_mid + height * 0.02, 0.0],
                             [reach * spec["spread"], (height - floor) * 0.5 * spec["dome"] + height * 0.05,
                              reach * spec["spread"] * 0.96], rng, lumpiness=0.22, flat_bottom=0.62)

    # The scaffold: limbs leaving the trunk at their own heights (round the fork, or up the leader).
    limbs = []
    count = int(rng.integers(spec["limbs"][0], spec["limbs"][1] + 1))
    azimuth0 = float(rng.uniform(0, math.tau))
    for index in range(count):
        if spec["leader"]:
            t = 0.34 + 0.6 * (index + rng.uniform(0.15, 0.85)) / count
        else:
            t = 0.78 + 0.22 * (index + rng.uniform(0.1, 0.9)) / count
        origin, _, _ = trunk.sample(min(t, 0.995))
        azimuth = azimuth0 + index * GOLDEN + float(rng.uniform(-0.35, 0.35))
        tilt = float(rng.uniform(*spec["limb_tilt"]))
        if spec["leader"]:
            length = reach * float(rng.uniform(0.55, 0.85)) * (1.15 - 0.6 * t)
        else:
            length = math.hypot(reach * float(rng.uniform(0.62, 0.92)), (height - origin[1]) * 0.55)
        pts = grow_curve(rng, origin, _direction(tilt, azimuth), length, 7, wander=0.12,
                         sag=0.08 if not spec["leader"] else 0.32, lift=0.3, kink=0.12)
        pts = tree.envelope.clip(pts, 1.04)
        radius = (0.62 if not spec["leader"] else 0.34) * float(rng.uniform(0.85, 1.05))
        limbs.append(tree.add_branch(pts, radius, 0.06, 1, parent=trunk, attach_t=t, flex=0.25, sides=4,
                                     power=0.9))
    # No limb hangs below the crown's floor: cut a sagging one where it crosses it.
    def keep_up(branch, low):
        below = np.nonzero(branch.points[1:, 1] < low)[0]
        if len(below):
            cut = max(2, int(below[0]) + 1)
            branch.points = branch.points[:cut]
            branch.radii = branch.radii[:cut]
            seg = np.linalg.norm(np.diff(branch.points, axis=0), axis=1)
            branch.arc = np.concatenate([[0.0], np.cumsum(seg)])
            branch.length = float(branch.arc[-1])
        return branch

    for limb in limbs:
        keep_up(limb, floor * 0.85)
    # Branches off each limb (level 2): where the masses gather.
    branches = []
    for limb in limbs:
        branches += tree.ramify(limb, 2, count=int(rng.integers(2, 4)), span=(0.35, 0.95), length=(0.45, 0.75),
                                angle=(28, 52), radius=0.55, tip_radius=0.03, wander=0.14, sag=0.06, lift=0.45,
                                steps=4, flex=0.3, sides=3, rise=(0.1, 0.7), min_length=0.8, clip=1.06)
    for branch in branches:
        keep_up(branch, floor * 0.85)
    if spec["leader"]:
        # The leader's own top: a mass at the crown's head.
        branches.append(trunk)
    tips = []
    for branch in limbs + branches:
        end = branch.points[-1]
        tips.append((end, branch))
        for t in ((0.45, 0.72) if branch.level == 1 else (0.7,)):
            mid, _, _ = branch.sample(t)
            tips.append((mid, branch))
    points = np.array([p for p, _ in tips])
    weights = np.array([1.0 + 0.6 * (b.level == 2) for _, b in tips])
    n_masses = int(rng.integers(spec["masses"][0], spec["masses"][1] + 1))
    centres, labels = _kmeans(points, weights, n_masses, rng)
    masses = []
    crown_centre = tree.envelope.centre
    for k, centre in enumerate(centres):
        member = [tips[i][1] for i in range(len(tips)) if labels[i] == k]
        if not member:
            continue
        # The mass sits a little outside the branch ends (foliage clothes the wood), and is bigger
        # where more branch ends gather.
        outward = normalize(centre - crown_centre + np.array([0.0, 0.25, 0.0]))
        size = float(rng.uniform(*spec["mass_r"])) * (0.9 + 0.08 * min(len(member), 4))
        size *= height / spec["height"]             # species units -> raw units
        centre = centre + outward * size * 0.25
        # Never below the crown's floor: a mass is carried by wood, it does not lie on the ground.
        centre[1] = max(centre[1], floor + size * 0.55)
        host = max(member, key=lambda b: (b.level, b.length))
        masses.append(Mass(centre, size, host))
    tree.masses = masses
    tree.meta = dict(species=species_id, variant=variant, height=height, reach=reach, floor=floor)
    return tree


def normalise(tree, species_id):
    """Scale a grown specimen to the species' height and reach (x/z and y separately)."""
    spec = SPECIES[species_id]
    top = max(m.centre[1] + m.radius * 0.86 for m in tree.masses)
    top = max(top, max(float(b.points[:, 1].max()) for b in tree.branches))
    reach = 0.0
    for m in tree.masses:
        reach = max(reach, math.hypot(m.centre[0], m.centre[2]) + m.radius)
    sy = spec["height"] / top
    sxz = spec["reach"] / max(reach, 1e-6)
    # Card radii follow the mean of the two scales, so a mass stays round.
    sr = math.sqrt(sy * sxz)
    scale = np.array([sxz, sy, sxz])
    for b in tree.branches:
        b.points = b.points * scale
        b.radii = b.radii * sr * 0.1
    for m in tree.masses:
        m.centre = m.centre * scale
        m.radius = m.radius * sr
    # Radii: the trunk's root radius is the species' (the raw tree's root radius is 1).
    trunk_scale = spec["trunk"] / max(tree.branches[0].radii[0], 1e-6)
    for b in tree.branches:
        b.radii = b.radii * trunk_scale
    tree.height = spec["height"]
    floor = min(m.centre[1] - m.radius * 0.6 for m in tree.masses)
    tree.crown_floor = max(0.12 * spec["height"], floor)
    tree.crown_top = spec["height"]
    return tree


# -- the tiers --------------------------------------------------------------------------------------


def crown_frame(masses):
    """The crown ellipsoid the forest's light reads: centre (mass-weighted) and reach across and up."""
    w = np.array([m.radius ** 3 for m in masses])
    c = np.array([m.centre for m in masses])
    centre = (c * w[:, None]).sum(axis=0) / w.sum()
    return centre


def hero_cards(masses, rng):
    """Five cards round each mass's outer side (a golden spiral over a cap) and one on its top."""
    cards = []
    centre = crown_frame(masses)
    for m in masses:
        out = m.centre - centre
        out[1] = max(out[1], 0.0) + m.radius * 0.6
        out = normalize(out)
        ref = np.array([0.0, 1.0, 0.0]) if abs(out[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
        t = normalize(np.cross(ref, out))
        b = np.cross(out, t)
        twist = float(rng.uniform(0, math.tau))
        for j in range(HERO_PER_MASS):
            f = (j + 0.5) / HERO_PER_MASS
            polar = math.acos(1 - f * (1 - math.cos(HERO_CAP)))
            az = twist + j * 2.39996
            d = out * math.cos(polar) + (t * math.cos(az) + b * math.sin(az)) * math.sin(polar)
            seat = m.centre + d * m.radius * HERO_SEAT * np.array([1.0, 0.86, 1.0])
            cards.append((seat, m.radius * HERO_SIZE * float(rng.uniform(0.9, 1.1))))
        cards.append((m.centre + np.array([0.0, m.radius * 0.42, 0.0]), m.radius * 0.5))
    return cards


def merge_masses(masses, count, rng):
    """`count` masses standing for the crown's: weighted k-means by volume, radius covering members."""
    pts = np.array([m.centre for m in masses])
    w = np.array([m.radius ** 3 for m in masses])
    centres, labels = _kmeans(pts, w, count, rng)
    out = []
    for k, c in enumerate(centres):
        member = [masses[i] for i in range(len(masses)) if labels[i] == k]
        if not member:
            continue
        r = max(float(np.linalg.norm(m.centre - c)) * 0.55 + m.radius for m in member)
        out.append(Mass(c, r, member[0].host))
    return out


def tube_mesh(points, radii, sides, rings):
    """A tube along a polyline resampled to `rings` rings: shared ring vertices with radial normals,
    and CCW-outward triangles as indices into them."""
    points = np.asarray(points, dtype=float)
    radii = np.asarray(radii, dtype=float)
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    total = max(arc[-1], 1e-6)
    ts = np.linspace(0.0, total, rings)
    pts = np.stack([np.interp(ts, arc, points[:, k]) for k in range(3)], axis=1)
    rad = np.interp(ts, arc, radii)
    tangents = np.array([normalize(t) for t in np.gradient(pts, axis=0)])
    # Parallel-transport frames, so the tube does not twist.
    ref = np.array([1.0, 0.0, 0.0]) if abs(tangents[0][1]) > 0.9 else UP
    n = normalize(np.cross(tangents[0], ref))
    positions, normals = [], []
    for i, tg in enumerate(tangents):
        if i > 0:
            n = normalize(n - tg * float(np.dot(n, tg)))
        b = np.cross(tg, n)
        for s_ in range(sides):
            a = math.tau * s_ / sides
            radial = n * math.cos(a) + b * math.sin(a)
            positions.append(pts[i] + radial * rad[i])
            normals.append(radial)
    positions = np.array(positions)
    normals = np.array(normals)
    index = []
    for i in range(rings - 1):
        for s_ in range(sides):
            a0 = i * sides + s_
            a1 = i * sides + (s_ + 1) % sides
            b0 = a0 + sides
            b1 = a1 + sides
            for tri in ((a0, b1, a1), (a0, b0, b1)):
                p0, p1, p2 = positions[tri[0]], positions[tri[1]], positions[tri[2]]
                face = np.cross(p1 - p0, p2 - p0)
                if float(np.dot(face, normals[tri[0]] + normals[tri[1]] + normals[tri[2]])) < 0:
                    tri = (tri[0], tri[2], tri[1])
                index.extend(tri)
    return positions, normals, np.array(index, dtype=np.int64)


def bark_for(tree, lod, budget):
    """The wood a tier draws: trunk and limbs at mid, the branches that carry the masses at hero."""
    parts = []
    trunk = tree.branches[0]
    if lod == "hero":
        parts.append((trunk, 6, 5))
        for b in tree.branches[1:]:
            if b.level == 1:
                parts.append((b, 4, 4))
        hosts = {id(m.host) for m in tree.masses}
        for b in tree.branches[1:]:
            if b.level == 2 and id(b) in hosts:
                parts.append((b, 3, 3))
    elif lod == "mid":
        parts.append((trunk, 4, 3))
        limbs = sorted((b for b in tree.branches[1:] if b.level == 1), key=lambda b: -b.length)
        for b in limbs[:5]:
            parts.append((b, 3, 2))
    positions, normals, index = [], [], []
    used = 0
    base = 0
    for b, sides, rings in parts:
        cost = 2 * sides * (rings - 1)
        if used + cost > budget:
            continue
        p, n, idx = tube_mesh(b.points, b.radii, sides, rings)
        positions.append(p)
        normals.append(n)
        index.append(idx + base)
        base += len(p)
        used += cost
    if not positions:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0, dtype=np.int64)
    return np.concatenate(positions), np.concatenate(normals), np.concatenate(index)


# -- Blender: the sky each card and bark vertex sees ---------------------------------------------------


def sky_visibility(card_list, bark_positions, bark_normals, bark_index, rays=48):
    """Ray-cast each card centre and bark vertex against the specimen built as a Blender mesh."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    verts, faces = [], []
    for centre, size in card_list:
        # A card as a crossed pair of discs (eight triangles), so rays see it from any side.
        base = len(verts)
        for axis in (np.array([1.0, 0.0, 0.0]), np.array([0.0, 0.0, 1.0])):
            first = len(verts)
            verts.append(tuple(centre))
            for k in range(6):
                a = math.tau * k / 6
                offset = axis * math.cos(a) * size * 0.8 + UP * math.sin(a) * size * 0.8
                verts.append(tuple(centre + offset))
            for k in range(6):
                faces.append((first, first + 1 + k, first + 1 + (k + 1) % 6))
        del base
    first = len(verts)
    verts += [tuple(p) for p in bark_positions]
    for f in range(0, len(bark_index), 3):
        faces.append((first + int(bark_index[f]), first + int(bark_index[f + 1]), first + int(bark_index[f + 2])))
    bvh = BVHTree.FromPolygons(verts, faces, epsilon=0.0)
    golden = math.pi * (3.0 - math.sqrt(5.0))
    dirs = []
    for i in range(rays):
        y = 1.0 - (i + 0.5) / rays          # upper hemisphere only
        r = math.sqrt(max(0.0, 1.0 - y * y))
        dirs.append(Vector((math.cos(golden * i) * r, y, math.sin(golden * i) * r)))

    def seen(origin, nudge):
        free = 0.0
        total = 0.0
        for d in dirs:
            w = d.y
            total += w
            hit = bvh.ray_cast(Vector(origin) + d * nudge, d, 12.0)
            if hit[0] is None:
                free += w
        return free / max(total, 1e-6)

    card_vis = [seen(centre, size * 0.85) for centre, size in card_list]
    bark_vis = []
    for i in range(len(bark_positions)):
        p = bark_positions[i] + bark_normals[i] * 0.02
        bark_vis.append(seen(p, 0.01))
    return np.array(card_vis), np.array(bark_vis)


# -- assembly -------------------------------------------------------------------------------------


def build_tier(tree, species_id, lod, rng):
    spec = SPECIES[species_id]
    if lod == "hero":
        masses = tree.masses
        cards = hero_cards(masses, rng)
    elif lod == "mid":
        masses = tree.masses
        cards = [(m.centre.copy(), m.radius * MID_SIZE) for m in masses]
    else:
        masses = merge_masses(tree.masses, FAR_MASSES, rng)
        cards = [(m.centre.copy(), m.radius * FAR_SIZE) for m in masses]
    card_budget = 2 * len(cards)
    bark_p, bark_n, bark_i = (np.zeros((0, 3)), np.zeros((0, 3)), np.zeros(0, dtype=np.int64)) if lod == "far" \
        else bark_for(tree, lod, BUDGET[lod] - card_budget - 4)
    centre = crown_frame(tree.masses)
    reach_h = max(1e-3, max(math.hypot(c[0] - centre[0], c[2] - centre[2]) + s for c, s in cards))
    reach_v = max(1e-3, max(abs(c[1] - centre[1]) + s * 0.8 for c, s in cards))
    card_vis, bark_vis = sky_visibility(cards, bark_p, bark_n, bark_i)
    total_h = spec["height"]
    floor = tree.crown_floor
    crown_h = max(1e-3, total_h - floor)
    out_cards = []
    for (c, size), vis in zip(cards, card_vis):
        o = c - centre
        n = np.array([o[0] / reach_h ** 2, o[1] / reach_v ** 2, o[2] / reach_h ** 2])
        n = normalize(n) if np.linalg.norm(n) > 1e-9 else UP.copy()
        depth_shape = min(1.0, math.sqrt((o[0] / reach_h) ** 2 + (o[1] / reach_v) ** 2 + (o[2] / reach_h) ** 2))
        # The ray-cast sky shares the depth with the shape: a card the crown hides is deeper.
        depth = min(1.0, max(0.0, 0.55 * depth_shape + 0.45 * float(vis)))
        along = min(1.0, max(0.0, (c[1] - floor) / crown_h))
        size = min(float(size), CARD_SIZE_MAX * 0.999)
        out_cards.append((c, n, depth, along, size))
    ao = 0.18 + 0.24 * bark_vis if len(bark_vis) else bark_vis
    return dict(cards=out_cards, bark_p=bark_p, bark_n=bark_n, bark_i=bark_i, bark_ao=ao, total_h=total_h,
                crown_w=spec["reach"], centre_y=float(centre[1]), floor=float(floor), crown_h=float(crown_h))


# -- encoding ---------------------------------------------------------------------------------------


def b64(array):
    return base64.b64encode(np.ascontiguousarray(array).tobytes()).decode("ascii")


def encode_tier(tier):
    cards = tier["cards"]
    cp = np.round(np.array([c[0] for c in cards]) / QUANT).astype(np.int16) if cards else np.zeros((0, 3), np.int16)
    cn = np.round(np.array([c[1] for c in cards]) * 127).astype(np.int8) if cards else np.zeros((0, 3), np.int8)
    cv = np.array([[round(c[2] * 255), round(c[3] * 255), round(c[4] / CARD_SIZE_MAX * 255)] for c in cards],
                  dtype=np.uint8) if cards else np.zeros((0, 3), np.uint8)
    bp = np.round(tier["bark_p"] / QUANT).astype(np.int16)
    bn = np.round(np.clip(tier["bark_n"], -1, 1) * 127).astype(np.int8)
    ba = np.round(np.clip(tier["bark_ao"], 0, 1) * 255).astype(np.uint8) if len(tier["bark_p"]) else np.zeros(0, np.uint8)
    bi = tier["bark_i"].astype(np.uint16)
    triangles = len(cards) * 2 + len(bi) // 3
    return {
        "triangles": int(triangles),
        "cardCount": len(cards),
        "barkVertices": int(len(tier["bark_p"])),
        "barkIndices": int(len(bi)),
        "totalH": round(tier["total_h"], 4),
        "crownW": round(tier["crown_w"], 4),
        "centreY": round(tier["centre_y"], 4),
        "crownFloor": round(tier["floor"], 4),
        "crownH": round(tier["crown_h"], 4),
        "cardPositions": b64(cp),
        "cardNormals": b64(cn),
        "cardData": b64(cv),
        "barkPositions": b64(bp),
        "barkNormals": b64(bn),
        "barkAo": b64(ba),
        "barkIndex": b64(bi),
    }


def build_all():
    models = {}
    stats = {}
    for species_id in SPECIES:
        variants = []
        for variant in range(VARIANTS):
            tree = normalise(grow_broadleaf(species_id, variant), species_id)
            rng = np.random.default_rng(1009 * (variant + 1) + len(species_id))
            tiers = {}
            for lod in ("hero", "mid", "far"):
                tier = build_tier(tree, species_id, lod, rng)
                enc = encode_tier(tier)
                if enc["triangles"] > BUDGET[lod]:
                    raise SystemExit(f"{TAG} {species_id}#{variant} {lod}: {enc['triangles']} triangles "
                                     f"over the {BUDGET[lod]} budget")
                tiers[lod] = enc
                stats.setdefault(species_id, []).append((variant, lod, enc["triangles"], enc["cardCount"]))
            variants.append(tiers)
            variants[-1]["_tree"] = tree
        models[species_id] = variants
    return models, stats


def write_module(models, out_path):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Odyssey's Act II broadleaves: GENERATED by scripts/blender/odyssey/odyssey_trees.py (do not edit",
        " * by hand). Three grown specimens a species, each at the forest's three tiers, in the forest's",
        " * tree units; decoded into the forest's vertex layout by world/odyssey-forest-models-decode.js.",
        " *",
        " * Per tier: `cardPositions` Int16 x3 in units of `quant`; `cardNormals` Int8 x3 (/127);",
        " * `cardData` Uint8 x3 (depth in the crown, height in crown, size / sizeMax, all /255);",
        " * `barkPositions` Int16 x3 and `barkNormals` Int8 x3 per vertex, `barkIndex` Uint16 CCW-outward",
        " * triangles over them;",
        " * `barkAo` Uint8 (/255) the sky the wood sees under its crown, measured by ray casting.",
        " */",
        f"export const ODYSSEY_FOREST_MODELS = Object.freeze({{",
        f"    version: 1,",
        f"    quant: {QUANT!r},",
        f"    sizeMax: {CARD_SIZE_MAX!r},",
        f"    species: Object.freeze({{",
    ]
    for species_id, variants in models.items():
        lines.append(f"        '{species_id}': Object.freeze([")
        for tiers in variants:
            lines.append("            Object.freeze({")
            for lod in ("hero", "mid", "far"):
                enc = tiers[lod]
                body = ", ".join(f"{k}: {json.dumps(v)}" for k, v in enc.items())
                lines.append(f"                {lod}: Object.freeze({{ {body} }}),")
            lines.append("            }),")
        lines.append("        ]),")
    lines += ["    }),", "});", ""]
    Path(out_path).write_text("\n".join(lines), encoding="utf-8")


# -- preview (Cycles, CPU) ------------------------------------------------------------------------------

PREVIEW = {"samples": 24, "width": 1600, "height": 900}


def render_preview(models, out_dir):
    import bpy

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(PREVIEW["samples"])
    scene.render.resolution_x = int(PREVIEW["width"])
    scene.render.resolution_y = int(PREVIEW["height"])
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.74, 0.9, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.4
    sun.rotation_euler = (math.radians(50), 0.0, math.radians(35))
    scene.collection.objects.link(sun)
    colours = {
        "S1-shore-broadleaf": (0.175, 0.270, 0.078), "S4-gold-birch": (0.52, 0.435, 0.125),
        "S6-red-maple": (0.40, 0.072, 0.042), "S7-pink-blossom": (0.47, 0.30, 0.43),
    }

    def material(name, rgb):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1.0)
        mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
        return mat

    bark_mat = material("bark", (0.10, 0.065, 0.04))
    ground = bpy.data.meshes.new("ground")
    ground.from_pydata([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)], [], [(0, 1, 2, 3)])
    gobj = bpy.data.objects.new("ground", ground)
    gobj.data.materials.append(material("grass", (0.09, 0.2, 0.045)))
    scene.collection.objects.link(gobj)
    for row, (species_id, variants) in enumerate(models.items()):
        leaf_mat = material(species_id, colours[species_id])
        for col, tiers in enumerate(variants):
            tree = tiers["_tree"]
            x0 = (col - 1) * 4.4 + (row % 2) * 1.2
            y0 = (row - 1.5) * 7.0
            tier = build_tier(tree, species_id, "hero", np.random.default_rng(5))
            mesh = bpy.data.meshes.new(f"{species_id}-{col}-bark")
            verts = [(p[0] + x0, -(p[2]) + y0, p[1]) for p in tier["bark_p"]]
            bi = tier["bark_i"]
            faces = [(int(bi[i]), int(bi[i + 1]), int(bi[i + 2])) for i in range(0, len(bi), 3)]
            mesh.from_pydata(verts, [], faces)
            obj = bpy.data.objects.new(mesh.name, mesh)
            obj.data.materials.append(bark_mat)
            scene.collection.objects.link(obj)
            for c, _, depth, _, size in tier["cards"]:
                bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=size * 0.72,
                                                      location=(c[0] + x0, -c[2] + y0, c[1]))
                ob = bpy.context.active_object
                ob.scale = (1.0, 1.0, 0.82)
                ob.data.materials.append(leaf_mat)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.location = (0.0, -34.0, 16.0)
    cam.rotation_euler = (math.radians(66), 0.0, 0.0)
    cam.data.lens = 40
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = str(out_dir / "odyssey-trees-roster.png")
    bpy.ops.render.render(write_still=True)
    print(f"{TAG} preview {scene.render.filepath}")


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--preview", default=None)
    parser.add_argument("--preview-samples", type=int, default=24)
    parser.add_argument("--preview-size", default="1600x900")
    args = parser.parse_args(argv)
    models, stats = build_all()
    for species_id, rows in stats.items():
        print(TAG, species_id, " ".join(f"v{v}:{lod}={tri}t/{cards}c" for v, lod, tri, cards in rows))
    clean = {k: [{lod: t[lod] for lod in ("hero", "mid", "far")} for t in v] for k, v in models.items()}
    write_module(clean, args.out)
    print(f"{TAG} wrote {args.out}")
    if args.preview:
        PREVIEW["samples"] = args.preview_samples
        PREVIEW["width"], PREVIEW["height"] = (int(v) for v in args.preview_size.split("x"))
        render_preview(models, args.preview)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(argv)
