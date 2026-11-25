"""The squirrel's near perches: a windfall and an old stump in the foreground of the Fall grove.

The two great trees stand fifteen and twenty metres from the eye, where a squirrel is fifty pixels
however it is drawn. So the grove has two things close to the eye for it to live on: on the right an
old tree the wind brought down long ago, mossed over, two of its dead limbs still standing up from it
(a lookout, and a shorter one to leap to); on the left the broken stump of another, hollowed at the
top, with a few coppice shoots still in leaf. They are grown with the grove's own skeleton and wood
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


# The windfall, in its own frame: it lies along x, its root end toward +x, half sunk in the litter.
WINDFALL_SUNK = 0.1


def old_windfall(seed=8101, name="old-windfall"):
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.5
    # Root end at +x (thick), snapped end at -x: it settled into the ground and bows a little.
    xs = np.linspace(3.3, -3.1, 11)
    points = np.stack([xs,
                       radius - WINDFALL_SUNK - 0.05 * np.cos(xs * 0.7) + 0.02 * np.sin(xs * 2.3),
                       0.16 * np.sin(xs * 0.55 + 0.4)], axis=1)
    trunk = tree.add_branch(points, radius, 0.33, 0, phase=float(rng.random()), flex=0.0, sides=18, power=0.85)
    tree.envelope = Envelope([-1.6, 1.7, -0.6], [2.2, 1.6, 1.6], rng, lumpiness=0.1)
    # The lookout: a dead limb standing up from near the snapped end, leaning back over the trunk.
    origin, _, _ = trunk.sample(0.8)
    lookout = _dead_limb(tree, trunk, 0.8, grow_curve(rng, origin + UP * 0.05, [0.12, 1.0, -0.1], 2.05, 6, wander=0.05,
                                                      lift=0.0), 0.2, 0.115)
    # The second limb: shorter, standing out to the side a jump away.
    origin, _, _ = trunk.sample(0.52)
    stub = _dead_limb(tree, trunk, 0.52, grow_curve(rng, origin + UP * 0.05, [-0.2, 1.0, 0.5], 1.25, 5, wander=0.05),
                      0.18, 0.11)
    # A young maple come up by its root end, in the light the old tree left (out of the frame's way:
    # the windfall lies in front of the oak, and leaves here would hide the oak's trunk).
    _shoot(tree, np.array([2.5, 0.0, -0.9]), [0.05, 1.0, -0.15], 2.3, 0.045, 4, (0.8, 1.05))
    _shoot(tree, np.array([2.7, 0.0, -1.0]), [0.35, 1.0, -0.3], 1.5, 0.03, 3, (0.7, 0.9))
    tree.thin_sites(0.4)
    tree.meta = dict(species="maple", role="hero", height=3.2, trunkRadius=radius, foliage="maple_spray", reach=0.0,
                     perch="windfall")
    tree.trunk_profile = _snapped(seed % 9, start=0.9, depth=0.55)
    tree.perch_limbs = dict(trunk=trunk, lookout=lookout, stub=stub)
    return tree


STUMP_TOP = 1.25
# (The leaning bough rests on the rim about here.)


def old_stump(seed=8203, name="old-stump"):
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.56
    heights = [-0.45, 0.0, 0.35, 0.7, 1.0, STUMP_TOP - 0.05, STUMP_TOP, STUMP_TOP + 0.012]
    points = np.array([[0.02 * math.sin(h * 2.0), h, 0.015 * math.cos(h * 3.0)] for h in heights])
    trunk = tree.add_branch(points, radius, 0.44, 0, phase=float(rng.random()), flex=0.0, sides=20, power=0.6)
    radii = np.array(trunk.radii, dtype=float)
    # The top closes over a hollow: the rim, then in to a low dome a squirrel can sit on.
    radii[-3:] = [0.45, 0.4, 0.03]
    trunk.radii = radii
    lobes = []
    start = float(rng.uniform(0, math.tau))
    for index in range(5):
        azimuth = start + math.tau * (index + rng.uniform(-0.25, 0.25)) / 5
        strength = float(rng.uniform(0.6, 1.0))
        lobes.append((azimuth, float(rng.uniform(0.22, 0.34)), strength))
        outward = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        length = rng.uniform(1.4, 2.4) * (0.6 + 0.5 * strength)
        root = grow_curve(rng, outward * radius * 0.6 + UP * 0.4, outward + UP * -0.1, length, 7, wander=0.12)
        t = np.linspace(0.0, 1.0, len(root))
        root[:, 1] = 0.36 * (1.0 - t) ** 1.7 - 0.4 * t + 0.04 * np.sin(t * 9.0 + index)
        tree.add_branch(root, radius * 0.4 * strength, 0.03, 1, parent=trunk, attach_t=0.0, phase=0.0, flex=0.0,
                        sides=7, power=0.85, kind="root")
    tree.envelope = Envelope([0.0, 1.5, 0.0], [1.6, 1.4, 1.6], rng, lumpiness=0.1)
    # Coppice shoots from its foot, still in leaf.
    for azimuth, lean, length, sprays in ((2.5, 0.35, 1.9, 4), (3.6, 0.5, 1.5, 3), (1.6, 0.45, 1.2, 2)):
        outward = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        _shoot(tree, outward * (radius * 1.05) + UP * 0.1, outward * lean + UP, length, 0.035, sprays, (0.7, 1.0))
    tree.thin_sites(0.4)

    def buttress(azimuth, point, _t):
        height = max(0.0, point[1])
        scale = 1.0 + 0.26 * math.exp(-height / 0.45)
        swell = 0.0
        for lobe_azimuth, lobe_width, lobe_strength in lobes:
            delta = math.atan2(math.sin(azimuth - lobe_azimuth), math.cos(azimuth - lobe_azimuth))
            swell += lobe_strength * math.exp(-(delta / lobe_width) ** 2)
        return scale * (1.0 + 0.48 * swell * math.exp(-height / 0.4))

    # A dead bough that came down across it: its butt on the ground by the path, its middle on the
    # stump's rim, its snapped end standing clear above: a way up, and somewhere to leap from.
    lean_points = np.array([[1.75, 0.06, 1.35], [1.25, 0.5, 1.02], [0.72, 0.96, 0.66], [0.28, 1.34, 0.36],
                            [-0.18, 1.66, 0.08], [-0.6, 1.92, -0.16], [-0.94, 2.1, -0.34]])
    lean = _dead_limb(tree, trunk, 0.9, lean_points, 0.15, 0.1)
    tree.meta = dict(species="maple", role="hero", height=2.6, trunkRadius=radius, foliage="maple_spray", reach=0.0,
                     perch="stump")
    tree.perch_limbs = dict(lean=lean)
    tree.trunk_profile = _snapped(seed % 7, start=0.8, depth=0.16, flute=0.06, buttress=buttress)
    tree.perch_pads = [dict(name="top", centre=[0.0, STUMP_TOP + 0.012, 0.0], radius=0.3)]
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
