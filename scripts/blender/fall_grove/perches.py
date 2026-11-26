"""The squirrel's near perches: a windfall and an old stump in the foreground of the Fall grove.

The two great trees stand fifteen and twenty metres from the eye, where a squirrel is fifty pixels
however it is drawn. So the grove has two things close to the eye for it to live on: on the right an
old tree the wind brought down long ago, lying along the floor as the floor lies, mossed over, two of
its dead side limbs still standing up from it at a slant (a lookout, and a shorter stub to leap to);
on the left the broken stump of another, wider than it is tall, a ragged break with a tall splinter on
its far side and a mossed seat in the middle, a dead bough leaning on the splinter, coppice shoots
still in leaf. Both stand on the floor as fall-terrain.js has it where they are placed. They are grown with the grove's own skeleton and wood
(skeleton.py, wood.py), so they take its bark, its moss and its baked occlusion.

`perch_limbs()` gives every limb the squirrel runs on (these, and the boughs of the two great trees it
uses) as centre lines with radii, and the flat places it can sit on, for the runtime
(src/themes/fall/fall-squirrel-limbs.js is written from it by scripts/blender/fall_perches.py).

Pure numpy, like skeleton.py.
"""

import math

import numpy as np

from .skeleton import UP, Envelope, Tree, grow_curve, normalize
from .wood import catmull_refine


def _snapped(seed, start, depth, flute=0.045, buttress=None):
    """A radius profile for wood that broke: past `start` of its length the end is splintered (the
    rim keeps tongues of wood and loses the rest), and the whole of it is a little out of round.
    `buttress(azimuth, point, t)` is multiplied in (a stump's flared foot)."""
    def profile(azimuth, point, t):
        scale = 1.0 + flute * math.sin(3.0 * azimuth + seed) + 0.03 * math.sin(7.0 * azimuth + 2.3 * seed + t * 9.0)
        if buttress is not None:
            scale *= buttress(azimuth, point, t)
        if t > start:
            u = (t - start) / (1.0 - start)
            tongue = 0.5 + 0.5 * math.sin(5.0 * azimuth + 1.7 * seed) * math.sin(2.0 * azimuth + seed)
            scale *= 1.0 - depth * u * (0.3 + 0.7 * tongue)
        return scale
    return profile


def _dead_limb(tree, parent, attach, points, base_radius, tip_radius, cap=0.07):
    """A dead limb: no bend in the wind, a blunt snapped end a squirrel can stand on."""
    points = np.asarray(points, dtype=float)
    heading = normalize(points[-1] - points[-2])
    points = np.concatenate([points, [points[-1] + heading * cap * 0.6, points[-1] + heading * cap]])
    limb = tree.add_branch(points, base_radius, tip_radius, 1, parent=parent, attach_t=attach, phase=0.0,
                           flex=0.0, sides=10, power=0.8)
    limb.sway0 = 0.0
    radii = np.array(limb.radii, dtype=float)
    radii[-2] = tip_radius * 0.72
    radii[-1] = 0.012
    limb.radii = radii
    return limb


def _shoot(tree, origin, direction, length, radius, sprays, scale):
    """A living shoot with a few sprays of leaves on it."""
    rng = tree.rng
    points = grow_curve(rng, origin, direction, length, 6, wander=0.1, sag=0.0, lift=0.5)
    shoot = tree.add_branch(points, radius, 0.008, 1, parent=tree.branches[0], attach_t=0.0, flex=0.45, sides=5,
                            power=0.9)
    tree.add_sites(shoot, sprays, span=(0.45, 1.0), scale=scale, droop=0.5, spread=0.3, variants=2, jitter=0.1)
    return shoot


# The floor under each perch, relative to the floor at its origin (where it stands), as
# src/themes/fall/fall-terrain.js has it where fall-composition.js places them: over a few metres it
# is nearly a plane. Measured 2026-11-26 (to about 2 cm); tests/unit/fall-squirrel.test.js holds the
# perches to the real floor, so a move of either perch shows there.
def _windfall_ground(x, z):
    return 0.0665 * x - 0.075 * z


def _stump_ground(x, z):
    return -0.06 * x + 0.01 * x * x - 0.008 * z


# The windfall, in its own frame: it lies along x, its root end toward +x (out of the frame on the
# right), its snapped end toward -x; the game's eye is toward +z.
WINDFALL_SINK = 0.28


def old_windfall(seed=8101, name="old-windfall"):
    """An old trunk the wind brought down: lying along the floor as the floor lies, sunk a quarter of
    its girth into the litter, tapering from the root end to a splintered break; two of its dead side
    limbs still stand up from it at a slant (a lookout and a shorter stub a leap away), two more broke
    off short."""
    tree = Tree(name, seed)
    rng = tree.rng
    root_radius, end_radius = 0.42, 0.32
    xs = np.linspace(3.3, -3.1, 13)
    zs = 0.12 * np.sin(xs * 0.55 + 0.4)
    taper = end_radius + (root_radius - end_radius) * (xs - xs[-1]) / (xs[0] - xs[-1])
    ys = np.array([_windfall_ground(x, z) for x, z in zip(xs, zs)]) + taper * (1.0 - WINDFALL_SINK) \
        + 0.015 * np.sin(xs * 2.3)
    line = np.stack([xs, ys, zs], axis=1)
    # Both ends closed: the root end sawn blunt (out of the frame), the break drawn in to a splintered
    # cone (the snapped profile tears its rings into tongues), so neither is an open tube.
    ahead = normalize(line[0] - line[1])
    behind = normalize(line[-1] - line[-2])
    points = np.concatenate([[line[0] + ahead * 0.08, line[0] + ahead * 0.05], line,
                             [line[-1] + behind * 0.12, line[-1] + behind * 0.26, line[-1] + behind * 0.38,
                              line[-1] + behind * 0.43]])
    radii = np.concatenate([[0.03, root_radius * 0.8], taper,
                            [end_radius * 0.85, end_radius * 0.6, end_radius * 0.25, 0.03]])
    trunk = tree.add_branch(points, root_radius, end_radius, 0, phase=float(rng.random()), flex=0.0, sides=18,
                            power=1.0)
    trunk.radii = radii
    tree.envelope = Envelope([0.5, 1.6, -0.4], [3.6, 1.8, 2.0], rng, lumpiness=0.1)

    def limb_from(t, azimuth_up, direction, length, base, tip, steps=6, kink=0.0, wander=0.035, lift=0.0):
        """A dead side limb leaving the log's bark at `t` (from the root end), `azimuth_up` radians round
        from the top toward the eye."""
        origin, tangent, radius = trunk.sample(t)
        side = normalize(np.cross(tangent, UP))
        if side[2] < 0:
            side = -side
        out = normalize(UP * math.cos(azimuth_up) + side * math.sin(azimuth_up))
        start = origin + out * (radius * 0.6)
        points = grow_curve(rng, start, direction, length, steps, wander=wander, kink=kink, lift=lift)
        return _dead_limb(tree, trunk, t, points, base, tip)

    # (t runs from the root end, out of the frame on the right, to the break; the frame holds about the
    # last half.) The lookout, near the break: leaning back away from the eye and a little toward the
    # root end (its top clear of the score panel), curving up toward the light it once grew to. (Bends
    # stay gentle: a limb that zigzags rises less than it runs and the squirrel takes it for a log.)
    lookout = limb_from(0.8, -0.2, [0.18, 1.0, -0.5], 2.0, 0.16, 0.065, steps=7, lift=0.35)
    # The stub, a leap from it toward the root end: shorter, slanting back away from the eye, square to
    # the log (leaning along it, it hung over the walk on its top).
    stub = limb_from(0.56, 0.15, [0.12, 1.0, -0.52], 1.15, 0.15, 0.07, steps=5, lift=0.25)
    # Two that broke off short: one low on the far side, driven into the litter as the tree came down,
    # and the stump of a branch on the near flank.
    limb_from(0.44, -1.5, [0.2, -0.55, -1.0], 0.75, 0.11, 0.06, steps=4, kink=0.0, wander=0.04)
    limb_from(0.68, 1.15, [-0.25, 0.35, 1.0], 0.32, 0.09, 0.06, steps=3, kink=0.0, wander=0.03)
    # A young maple come up by its root end, in the light the old tree left (out of the frame's way:
    # the windfall lies in front of the oak, and leaves here would hide the oak's trunk).
    _shoot(tree, np.array([2.5, _windfall_ground(2.5, -0.9), -0.9]), [0.05, 1.0, -0.15], 2.3, 0.045, 4, (0.8, 1.05))
    _shoot(tree, np.array([2.7, _windfall_ground(2.7, -1.0), -1.0]), [0.35, 1.0, -0.3], 1.5, 0.03, 3, (0.7, 0.9))
    tree.thin_sites(0.4)
    tree.meta = dict(species="maple", role="hero", height=3.2, trunkRadius=root_radius, foliage="maple_spray",
                     reach=0.0, perch="windfall")
    # (Only the break is torn: its last rings into long tongues of wood.)
    tree.trunk_profile = _snapped(seed % 9, start=0.94, depth=0.85)
    tree.perch_limbs = dict(trunk=trunk, lookout=lookout, stub=stub)
    return tree


# The stump, in its own frame: its base at the origin, the eye toward +z. Its lathe angle runs from +x
# toward -z (so a grid's faces look outward): far from the eye is a quarter turn round, at -z.
STUMP_RADIUS = 0.58
STUMP_RIM = 0.72
STUMP_SEAT = 0.69
# The splinters the break left standing (angle, height over the rim, half-width in radians): the tall
# one on the far side, which the dead bough rests on; lower ones round it.
STUMP_TEETH = ((math.radians(80.0), 0.36, 0.44), (math.radians(140.0), 0.15, 0.22),
               (math.radians(28.0), 0.12, 0.2), (math.radians(205.0), 0.06, 0.26),
               (math.radians(300.0), 0.05, 0.22))


def _stump_rim(theta, seed):
    """The height of the broken rim at lathe angle `theta`: a splinter is a broad wedge of wood with a
    ragged top, not a spike."""
    height = STUMP_RIM + 0.018 * math.sin(11.0 * theta + seed) + 0.012 * math.sin(23.0 * theta + 2.0 * seed)
    for centre, rise, width in STUMP_TEETH:
        delta = abs(math.atan2(math.sin(theta - centre), math.cos(theta - centre)))
        if delta < width:
            u = delta / width
            height += rise * (1.0 - u * u) ** 0.75 * (1.0 + 0.08 * math.sin(delta * 31.0 + seed))
    return height


def _stump_radius(theta, y, lobes, seed):
    """How far the stump's bark stands from its axis at angle `theta` and height `y`."""
    up = max(0.0, y)
    radius = STUMP_RADIUS * (1.0 - 0.06 * min(up, 1.2)) * (1.0 + 0.3 * math.exp(-up / 0.3))
    swell = 0.0
    for lobe_azimuth, lobe_width, lobe_strength in lobes:
        delta = math.atan2(math.sin(theta - lobe_azimuth), math.cos(theta - lobe_azimuth))
        swell += lobe_strength * math.exp(-(delta / lobe_width) ** 2)
    radius *= 1.0 + 0.6 * swell * math.exp(-up / 0.26)
    radius *= 1.0 + 0.04 * math.sin(3.0 * theta + seed) + 0.025 * math.sin(7.0 * theta + 1.3 * seed + y * 5.0)
    return radius


def _stump_body(lobes, seed, sides=48):
    """The stump's body as one lathe grid (rows bottom to rim, then over the break to the middle):
    positions, normals, uvs, colours and triangles, as wood.tube() gives them."""
    from .wood import BARK_SHEET_ASPECT, BARK_TILE_METRES, grid_normals, moss_mask
    columns = sides + 1
    wall = [(-0.35, 0.0), (0.0, 0.0), (0.06, 0.0), (0.14, 0.0), (0.25, 0.0), (0.38, 0.0), (0.52, 0.0), (0.64, 0.0),
            (None, 0.0)]  # (height, share across the top); None: the rim
    top = [(None, 0.06), (None, 0.16), (None, 0.3), (None, 0.45), (None, 0.62), (None, 0.8), (None, 1.0)]
    rows = wall + top
    positions = np.zeros((len(rows), columns, 3))
    for column in range(columns):
        theta = math.tau * (column % sides) / sides
        rim = _stump_rim(theta, seed)
        c, s = math.cos(theta), -math.sin(theta)
        rim_radius = _stump_radius(theta, rim, lobes, seed)
        for row, (height, share) in enumerate(rows):
            if share == 0.0:
                y = rim if height is None else min(height, rim - 0.02)
                radius = _stump_radius(theta, y, lobes, seed)
            else:
                # Over the break: a lip, then down the inside of a splinter to a dished, rotted seat.
                radius = rim_radius * (1.0 - share) * (1.0 - 0.06 * share)
                fall = smooth_step(0.04, 0.5, share)
                y = rim + (STUMP_SEAT - rim) * fall
                if share >= 0.6:
                    y = STUMP_SEAT - 0.012 * (1.0 - (share - 0.6) / 0.4)
            # (The foot follows the floor; the floor's slope fades out up the wall.)
            ground = 0.0
            if share == 0.0 and height is not None:
                ground = _stump_ground(radius * c, radius * s) * (1.0 - smooth_step(0.0, 0.3, height))
            positions[row, column] = (radius * c, y + ground, radius * s)
    flat = positions.reshape(-1, 3)
    normals = grid_normals(flat, len(rows), columns)
    # (The middle of the seat is the lathe's pole, where every face is a sliver: it faces up.)
    normals[-columns:] = (0.0, 1.0, 0.0)
    # UVs: round the bark in whole sheets, up it (and on over the break) at the sheet's aspect.
    repeats = max(1, int(round(math.tau * STUMP_RADIUS / BARK_TILE_METRES)))
    uvs = np.zeros((len(rows), columns, 2))
    for column in range(columns):
        travelled = 0.0
        for row in range(len(rows)):
            if row:
                travelled += float(np.linalg.norm(positions[row, column] - positions[row - 1, column]))
            uvs[row, column] = (column / sides * repeats, travelled / (BARK_SHEET_ASPECT * BARK_TILE_METRES))
    colors = np.zeros((len(rows) * columns, 4))
    colors[:, 2] = 1.0
    moss = moss_mask(seed, height=1.2, limb_tops=0.8)(flat, normals)
    # Moss thick over the rotted seat and the lip, where the rain stands.
    seat = np.zeros(len(rows) * columns)
    seat[len(wall) * columns:] = 0.85
    colors[:, 3] = np.clip(np.maximum(moss, seat * np.clip(normals[:, 1], 0.0, 1.0)), 0.0, 1.0)
    index = []
    for row in range(len(rows) - 1):
        for column in range(sides):
            a = row * columns + column
            b = a + 1
            c2 = a + columns
            d = c2 + 1
            index.extend((a, b, c2, b, d, c2))
    return flat, normals, uvs.reshape(-1, 2), colors, np.array(index)


def smooth_step(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def old_stump(seed=8203, name="old-stump"):
    """The broken stump of an old tree: wider than it is tall, flared into its roots, its top a ragged
    break with one tall splinter on the far side and a dished, mossed seat in the middle; a dead bough
    lies against it, its butt in the litter and its middle on the tall splinter; coppice shoots in leaf."""
    tree = Tree(name, seed)
    rng = tree.rng
    # A frame for what grows from it (the body is meshed by _stump_body, not as a tube).
    trunk = tree.add_branch(np.array([[0.0, 0.0, 0.0], [0.0, STUMP_RIM * 0.5, 0.0], [0.0, STUMP_RIM, 0.0]]),
                            STUMP_RADIUS, STUMP_RADIUS, 0, phase=float(rng.random()), flex=0.0, sides=8,
                            kind="frame")
    lobes = []
    start = float(rng.uniform(0, math.tau))
    for index in range(5):
        azimuth = start + math.tau * (index + rng.uniform(-0.25, 0.25)) / 5
        strength = float(rng.uniform(0.6, 1.0))
        lobes.append((azimuth, float(rng.uniform(0.22, 0.32)), strength))
        # (The lathe angle runs toward -z: a root leaves along (cos, -sin).)
        outward = np.array([math.cos(azimuth), 0.0, -math.sin(azimuth)])
        length = rng.uniform(1.3, 2.1) * (0.6 + 0.5 * strength)
        root = grow_curve(rng, outward * STUMP_RADIUS * 0.85 + UP * 0.3, outward + UP * -0.12, length, 7, wander=0.12)
        t = np.linspace(0.0, 1.0, len(root))
        ground = np.array([_stump_ground(p[0], p[2]) for p in root])
        root[:, 1] = ground + 0.28 * (1.0 - t) ** 1.7 - 0.12 * t + 0.03 * np.sin(t * 9.0 + index)
        tree.add_branch(root, STUMP_RADIUS * 0.42 * strength, 0.03, 1, parent=trunk, attach_t=0.0, phase=0.0,
                        flex=0.0, sides=8, power=0.85, kind="root")
    tree.extra_wood = [_stump_body(lobes, seed % 7)]
    tree.envelope = Envelope([0.0, 1.3, 0.0], [1.6, 1.3, 1.6], rng, lumpiness=0.1)
    # Coppice shoots from its foot, still in leaf: on its left, where they frame it (on the near side
    # they hid the seat from the eye; on the right the bough lies).
    for azimuth, lean, length, sprays in ((2.88, 0.35, 1.6, 4), (3.5, 0.5, 1.3, 3), (2.36, 0.45, 1.1, 2)):
        outward = np.array([math.cos(azimuth), 0.0, -math.sin(azimuth)])
        foot = outward * (STUMP_RADIUS * 1.15)
        foot[1] = _stump_ground(foot[0], foot[2]) + 0.05
        _shoot(tree, foot, outward * lean + UP, length, 0.035, sprays, (0.7, 1.0))
    tree.thin_sites(0.4)
    # The dead bough: on the far side, square to the stump's radius there, its underside on the tip of
    # the tall splinter, its butt sunk in the litter to the right, its snapped end standing out clear
    # to the left. (So nothing of it is over the seat, and it touches the stump where it rests.)
    tooth, rise, _width = STUMP_TEETH[0]
    radial = np.array([math.cos(tooth), 0.0, -math.sin(tooth)])
    along = np.array([radial[2], 0.0, -radial[0]])
    if along[0] < 0:
        along = -along
    # Where it rests: on the splinter's ridge (its outer edge, at its top), sunk a couple of
    # centimetres into it so the two meet; its butt 2 m off along the floor, sunk into the litter.
    ridge_height = _stump_rim(tooth, seed % 7)
    ridge_radius = _stump_radius(tooth, ridge_height, lobes, seed % 7)
    rest = radial * (ridge_radius - 0.02) + UP * ridge_height
    butt_xz = rest + along * 2.0
    bough_radius, bough_tip = 0.14, 0.075
    butt = np.array([butt_xz[0], _stump_ground(butt_xz[0], butt_xz[2]) + bough_radius * 0.45, butt_xz[2]])
    slope = normalize(rest - butt)
    # (The bough's own radius where it rests, about four fifths of the way along it.)
    resting = bough_tip + (bough_radius - bough_tip) * 0.2 ** 0.8
    lifted = rest + normalize(np.cross(np.cross(slope, UP), slope)) * (resting * 0.85)
    points = [butt + (lifted - butt) * f for f in (0.0, 0.25, 0.5, 0.75, 1.0)]
    points[1] = points[1] + UP * 0.02
    points[2] = points[2] + UP * 0.025
    points += [lifted + (lifted - butt) * f * 0.25 + UP * (-0.025 * f * f) for f in (0.5, 1.0)]
    lean = _dead_limb(tree, trunk, 0.9, np.array(points), bough_radius, bough_tip)
    tree.meta = dict(species="maple", role="hero", height=2.2, trunkRadius=STUMP_RADIUS, foliage="maple_spray",
                     reach=0.0, perch="stump")
    tree.perch_limbs = dict(lean=lean)
    tree.perch_pads = [dict(name="top", centre=[0.0, STUMP_SEAT + 0.002, 0.0], radius=0.26)]
    return tree


PERCH_RECIPES = {
    "old-windfall": lambda: old_windfall(),
    "old-stump": lambda: old_stump(),
}

# The boughs of the two great trees the squirrel runs on: the index of each in its tree's branches
# (the recipes are seeded, so these are the same boughs every time) and how far along it goes.
#
# Measured from the game's eye against the crowns' own sprays, only one of them is seen: a squirrel
# on any bough of the maple, or on the oak's others, is behind leaves all the way out (the crowns hang
# lower than their boughs). So the squirrel has the oak's rising bough, to where the leaves take it.
GREAT_BOUGHS = {
    "oak-hero": dict(riser=(14, 4.4)),
}


def _line(branch, reach=None, refine=3):
    """A limb's centre line as the bark is meshed round it (the same Catmull-Rom refinement), cut at
    `reach` metres: [[x, y, z, radius], ...]."""
    points, radii = catmull_refine(branch.points, branch.radii, refine)
    rows = []
    travelled = 0.0
    for index in range(len(points)):
        if index:
            travelled += float(np.linalg.norm(points[index] - points[index - 1]))
        rows.append([round(float(v), 4) for v in points[index]] + [round(float(radii[index]), 4)])
        if reach is not None and travelled >= reach:
            break
    return rows


def perch_limbs(recipes):
    """{asset: {limbs: {name: rows}, pads: [...], sway: {name: [sway0, flex, phase]}}} for the runtime."""
    out = {}
    for asset, boughs in GREAT_BOUGHS.items():
        tree = recipes[asset]()
        limbs = {}
        for name, (index, reach) in boughs.items():
            branch = tree.branches[index]
            if branch.level != 1 or branch.kind != "wood":
                raise ValueError("%s branch %d is not a bough" % (asset, index))
            limbs[name] = _line(branch, reach)
        out[asset] = dict(limbs=limbs, pads=[])
    for asset in PERCH_RECIPES:
        tree = recipes[asset]()
        limbs = {name: _line(branch) for name, branch in getattr(tree, "perch_limbs", {}).items()}
        out[asset] = dict(limbs=limbs, pads=getattr(tree, "perch_pads", []))
    return out
