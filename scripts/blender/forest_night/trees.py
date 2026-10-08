"""Tree recipes for the Forest theme's firefly night: Norway spruce, Scots pine, silver birch.

The scene is an old-growth glade seen from eye height, so the specimens are grown for two
jobs. The elders stand beside the camera and are read as trunk, root plate and the lowest
hanging boughs; the old and young trees stand across the glade and are read as silhouettes
against a moonlit sky.

Everything is built on the Fall grove's skeleton primitives. The pines are the Golden Forest
recipe with new seeds; the elder's wedge roots are swapped for the surface roots defined
here. The spruce is that module's spruce generalised - trunk girth and taper, forking
surface roots, whorl spacing, a thinned zone of long low boughs, dead stubs, a weather side -
so one function describes a 36 m elder and a 5 m sapling. The birch is the Fall grove's
birch with a set lean, a recovering stem and weeping twigs.
"""

import math

import numpy as np

from fall_grove.skeleton import GOLDEN, UP, Envelope, Site, Tree, grow_curve, normalize, rotate_about, taper
from fall_grove.species import _direction
from fall_grove.wood import buttress_profile
from golden_forest import conifers
from golden_forest.conifers import _spruce_boughs

BURIED = 0.45      # how far a conifer's trunk starts below the ground


def _root_heights(radii, start, dive_from):
    """Height of a root's axis along its length.

    It leaves the trunk as a ridge `start` metres up, settles until it lies half buried, and
    goes under for good over its last stretch.
    """
    t = np.linspace(0.0, 1.0, len(radii))
    dive = np.clip((t - dive_from) / (1.0 - dive_from), 0.0, 1.0)
    return start * (1.0 - t) ** 2.6 + radii * 0.25 - 0.03 - 0.4 * dive * dive * (3.0 - 2.0 * dive)


def surface_roots(tree, trunk, trunk_radius, count, reach=(2.6, 4.6), seed_azimuth=0.0, fork=0.6, ride=0.62,
                  inset=0.55, tall=1.8, thickness=0.42):
    """Buttress lobes and the roots that continue them over the ground, some of them forking.

    Unlike the Fall grove's roots, which dive as they leave the trunk, these stand up from it
    as ridges (`ride` is the height of the strongest root's axis at the trunk; the bark
    mesher makes them `tall` times taller than they are wide there), snake over the ground
    half buried, and only go under near their ends. A share of them (`fork`) split part-way
    out. `thickness` is a root's radius at the trunk as a share of the trunk's.
    Returns the lobes for `buttress_profile`.
    """
    rng = tree.rng
    lobes = []
    for index in range(count):
        azimuth = seed_azimuth + math.tau * (index + rng.uniform(-0.28, 0.28)) / count
        strength = float(rng.uniform(0.6, 1.0))
        lobes.append((azimuth, float(rng.uniform(0.24, 0.38)), strength))
        outward = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        length = float(rng.uniform(*reach)) * (0.6 + 0.5 * strength)
        points = grow_curve(rng, outward * trunk_radius * inset, outward, length, 12, wander=0.34)
        # A slow taper: the root is still stout where the ground closes over it, so it sinks rather than ends.
        radii = taper(trunk_radius * thickness * strength, 0.03, len(points), 0.9)
        points[:, 1] = _root_heights(radii, ride * strength, 0.56) + 0.025 * np.sin(np.arange(len(points)) + index)
        root = tree.add_branch(points, radii[0], 0.03, 1, parent=trunk, attach_t=0.0, phase=0.0, flex=0.0,
                               sides=8, power=0.9, kind="root")
        root.tall = tall
        if rng.random() < fork:
            at = float(rng.uniform(0.24, 0.42))
            origin, tangent, radius_here = root.sample(at)
            turn = math.radians(float(rng.uniform(28, 55))) * (1.0 if rng.random() < 0.5 else -1.0)
            heading = rotate_about(normalize(np.array([tangent[0], 0.0, tangent[2]])), UP, turn)
            branch_points = grow_curve(rng, origin, heading, length * (1.0 - at) * float(rng.uniform(0.6, 0.95)), 7,
                                       wander=0.3)
            branch_radii = taper(radius_here * 0.74, 0.025, len(branch_points), 0.9)
            lift = origin[1] - float(_root_heights(branch_radii, 0.0, 0.5)[0])
            branch_points[:, 1] = _root_heights(branch_radii, lift, 0.5)
            side = tree.add_branch(branch_points, branch_radii[0], 0.025, 1, parent=trunk, attach_t=0.0, phase=0.0,
                                   flex=0.0, sides=6, power=0.9, kind="root")
            side.tall = 1.0 + (tall - 1.0) * (1.0 - at) ** 2
    return lobes


def elder_pine(seed, name, height, crown, lean, roots):
    """The Golden Forest's hero pine, re-rooted: its wedge roots are swapped for ridged surface roots."""
    tree = conifers.pine(seed, name, height=height, role="hero", crown=crown, lean=lean)
    trunk = tree.branches[0]
    radius = tree.meta["trunkRadius"]
    tree.branches = [branch for branch in tree.branches if branch.kind != "root"]
    lobes = surface_roots(tree, trunk, radius, seed_azimuth=float(tree.rng.uniform(0, math.tau)), **roots)
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.52, flare_height=0.8, lobe_gain=0.55,
                                          lobe_height=0.7, flute=0.03, seed=seed % 5)
    return tree


def _dead_stubs(tree, trunk, count, band, height):
    """What is left of the limbs a closed forest shaded out: short, bare, pointing a little down."""
    rng = tree.rng
    for _ in range(count):
        level = float(rng.uniform(*band))
        t = (level + BURIED) / (height + BURIED)
        origin, _, parent_radius = trunk.sample(t)
        stub = grow_curve(rng, origin, _direction(float(rng.uniform(82, 108)), float(rng.uniform(0, math.tau))),
                          float(rng.uniform(0.5, 1.9)), 3, wander=0.1)
        tree.add_branch(stub, min(parent_radius * 0.2, 0.07), 0.012, 1, parent=trunk, attach_t=t, flex=0.05,
                        sides=4, kind="stub")


def spruce(seed, name, height=24.0, role="grove", crown_base=0.14, spread=1.0, lean=(0.0, 0.0), girth=1.0,
           roots=None, spacing=None, bough=None, tilt=(112.0, 52.0), droop=1.0, broken=0.35, low_zone=0.0,
           stubs=0, weather=0.0, power=0.92):
    """A Norway spruce. `crown_base` is where the living crown starts, as a share of the height.

    `girth` scales the trunk radius and `power` shapes its taper (lower holds the girth
    higher up), `roots` (keyword arguments for `surface_roots`) gives a hero its root
    plate, `spacing` is the distance between whorls and `bough` the size of a bough
    section. `tilt` is the angle of the lowest limbs from vertical and how far it closes by
    the spire; `droop` scales how much the limbs sag. Below `low_zone` (a share of the
    crown) the whorls are thinned to one or two long boughs that carry side branchlets.
    `stubs` dead stubs stand on the bare trunk, and `weather` shortens the limbs on one
    side of the tree.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    hero = role == "hero"
    young = height < 12.0
    radius = (0.1 + height * (0.0165 if hero else 0.0145)) * girth
    heading = np.array([lean[0] + rng.uniform(-0.02, 0.02), 1.0, lean[1] + rng.uniform(-0.02, 0.02)])
    points = grow_curve(rng, [0.0, -BURIED, 0.0], heading, height + BURIED, 26 if hero else (10 if young else 16),
                        wander=0.012, lift=0.12)
    trunk = tree.add_branch(points, radius, 0.02, 0, phase=float(rng.random()), flex=0.22,
                            sides=14 if hero else (6 if young else 8), power=power)
    lobes = []
    if roots:
        lobes = surface_roots(tree, trunk, radius, seed_azimuth=float(rng.uniform(0, math.tau)), **roots)
    spacing = spacing or (0.66 if hero else 0.94)
    reach = height * (0.2 if hero else 0.185) * spread
    start = crown_base * height
    whorls = max(4, int((height * 0.975 - start) / spacing))
    azimuth = float(rng.uniform(0, math.tau))
    size = bough or (1.55 if hero else 2.3)
    tip_length = min(0.45, height * 0.03)
    weather_side = float(rng.uniform(0, math.tau))
    for whorl in range(whorls):
        level = start + (whorl + float(rng.uniform(-0.25, 0.25))) * spacing
        t = (level + BURIED) / (height + BURIED)
        crown_t = whorl / max(1, whorls - 1)
        low = crown_t < low_zone
        arms = 5 + int(rng.integers(-1, 2))
        if low:
            arms = 1 + int(rng.integers(0, 2))
        for _ in range(arms):
            azimuth += GOLDEN + float(rng.uniform(-0.35, 0.35))
            origin, _, parent_radius = trunk.sample(t + float(rng.uniform(-0.004, 0.004)))
            length = (reach * (1.0 - crown_t) ** 0.78 + tip_length) * float(rng.uniform(0.78, 1.12))
            length *= 1.0 - weather * max(0.0, math.cos(azimuth - weather_side)) * (1.0 - 0.6 * crown_t)
            if not low and crown_t < 0.18 and rng.random() < broken:
                length *= float(rng.uniform(0.4, 0.7))          # old limbs low down are broken short
            angle = tilt[0] - tilt[1] * crown_t ** 0.85 + float(rng.uniform(-7, 7))
            sag = (0.55 * (1.0 - crown_t) + 0.08) * droop * (0.72 if low else 1.0)
            limb_points = grow_curve(rng, origin, _direction(angle, azimuth), length,
                                     7 if hero else (4 if young else 6), wander=0.045, sag=sag,
                                     lift=0.55 + 0.25 * (1.0 - crown_t))
            # A skirt rests on the ground instead of passing through it.
            limb_points[1:, 1] = np.maximum(limb_points[1:, 1], 0.14)
            detailed = low or (hero and crown_t < 0.3)
            limb = tree.add_branch(limb_points, min(parent_radius * 0.42, 0.05 + 0.012 * length), 0.006, 1,
                                   parent=trunk, attach_t=t, flex=0.5,
                                   sides=(6 if low else 5) if detailed else (4 if hero else 3), power=0.9)
            limb.detail = 2 if detailed else 1
            _spruce_boughs(tree, limb, crown_t, size)
            if low:
                # The long low boughs are fans: side branchlets, each under its own curtain.
                twigs = tree.ramify(limb, 2, count=int(rng.integers(5, 8)), span=(0.2, 0.86), length=(0.2, 0.34),
                                    angle=(36, 58), radius=0.45, tip_radius=0.006, wander=0.07, sag=0.4, lift=0.25,
                                    steps=5, flex=0.5, sides=3, rise=(-0.25, 0.05), min_length=0.9)
                for twig in twigs:
                    twig.detail = 1
                    _spruce_boughs(tree, twig, crown_t, size * 0.84)
    # The leader: a spire of short upright shoots.
    for index in range(6 if hero else 4):
        t = 1.0 - 0.014 * index
        point, tangent, _ = trunk.sample(t)
        outward = _direction(90.0, azimuth + index * GOLDEN)
        forward = normalize(tangent * (0.95 - 0.1 * index) + outward * (0.2 + 0.16 * index))
        tree.sites.append(Site(point - tangent * min(0.2, height * 0.012), forward, normalize(outward + UP * 0.3),
                               size * 0.34 * (1.0 + 0.2 * index), trunk.sway_at(t) + 0.1, trunk.phase,
                               variant=1, hue=float(rng.random()), branch_level=0))
    # Curtains that would hang into the ground are the short kind.
    for site in tree.sites:
        if site.position[1] < 0.8 * site.scale:
            site.variant = 1
    if stubs:
        _dead_stubs(tree, trunk, stubs, (max(1.6, start * 0.25), start * 0.96), height)
    tree.envelope = Envelope([0.0, start + (height - start) * 0.45, 0.0],
                             [reach, (height - start) * 0.55, reach], rng, lumpiness=0.08)
    tree.meta = dict(species="spruce", role=role, height=height, trunkRadius=radius,
                     foliage="spruce_frond" if hero else "spruce_bough", crownBase=start)
    if not lobes:
        lobes = [(float(rng.uniform(0, math.tau)), 0.45, 0.5) for _ in range(4)]
    if roots:
        tree.trunk_profile = buttress_profile(radius, lobes, flare=0.58, flare_height=1.05, lobe_gain=0.62,
                                              lobe_height=0.85, flute=0.03, seed=seed % 7)
    else:
        tree.trunk_profile = buttress_profile(radius, lobes, flare=0.42, flare_height=0.8 if not young else 0.3,
                                              lobe_gain=0.34, lobe_height=0.6 if not young else 0.25, flute=0.02,
                                              seed=seed % 7)
    return tree


def birch(seed, name, height=17.0, lean=(0.08, 0.03)):
    """A silver birch: a slender stem that leans and recovers, ascending limbs, weeping twigs.

    The Fall grove's birch with a set lean and one more order of growth: thin twigs that hang
    from the outer half of each limb and carry the leaf strands in chains.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.07 + height * 0.0078
    heading = np.array([lean[0] + rng.uniform(-0.03, 0.03), 1.0, lean[1] + rng.uniform(-0.03, 0.03)])
    trunk_points = grow_curve(rng, [0.0, -0.3, 0.0], heading, height + 0.3, 14, wander=0.035, lift=0.16)
    trunk = tree.add_branch(trunk_points, radius, 0.02, 0, phase=float(rng.random()), flex=0.2, sides=9,
                            power=0.85)
    centre, _, _ = trunk.sample(0.66)
    tree.envelope = Envelope([centre[0], height * 0.66, centre[2]], [height * 0.22, height * 0.4, height * 0.22],
                             rng, lumpiness=0.14, flat_bottom=0.9)
    crown = 0.32
    limbs = []
    count = int(rng.integers(20, 26))
    start_azimuth = float(rng.uniform(0, math.tau))
    for index in range(count):
        t = crown + (0.97 - crown) * (index + rng.uniform(0.1, 0.9)) / count
        origin, _, parent_radius = trunk.sample(t)
        azimuth = start_azimuth + index * GOLDEN + rng.uniform(-0.3, 0.3)
        length = height * (0.27 - 0.15 * t) * rng.uniform(0.85, 1.15)
        points = grow_curve(rng, origin, _direction(rng.uniform(34, 56), azimuth), length, 7, wander=0.08,
                            sag=0.75, lift=0.0)
        limbs.append(tree.add_branch(points, min(parent_radius * 0.5, 0.06), 0.008, 1, parent=trunk, attach_t=t,
                                     flex=0.4, sides=4, power=0.9))
    for limb in limbs:
        tree.add_sites(limb, max(2, int(round(limb.length / 0.5))), span=(0.3, 1.0), scale=(1.15, 1.7),
                       droop=1.5, spread=0.2, variants=2, jitter=0.14)
        twigs = tree.ramify(limb, 2, count=int(rng.integers(3, 6)), span=(0.38, 0.98), length=(0.3, 0.52),
                            angle=(55, 88), radius=0.4, tip_radius=0.004, wander=0.09, sag=1.5, lift=0.0, steps=3,
                            flex=0.45, sides=3, rise=(-0.9, -0.25), min_length=1.0, taper_length=0.3, clip=9.0)
        for twig in twigs:
            tree.add_sites(twig, 2, span=(0.3, 1.0), scale=(1.1, 1.6), droop=1.7, spread=0.14, variants=2,
                           jitter=0.1)
    tree.thin_sites(0.34)
    tree.meta = dict(species="birch", role="grove", height=height, trunkRadius=radius, foliage="birch_strand",
                     crownBase=crown * height)
    tree.trunk_profile = buttress_profile(radius, [(0.0, 0.5, 0.4), (2.4, 0.5, 0.5), (4.4, 0.5, 0.4)], flare=0.3,
                                          flare_height=0.4, lobe_gain=0.2, lobe_height=0.3, flute=0.0, seed=1)
    return tree


ELDER_ROOTS = dict(count=6, reach=(3.0, 5.0), fork=0.65, ride=0.5, thickness=0.5, tall=1.9)

RECIPES = {
    "spruce-elder": lambda: spruce(3301, "spruce-elder", height=36.0, role="hero", crown_base=0.225, girth=1.12,
                                   roots=ELDER_ROOTS, low_zone=0.13, stubs=6, lean=(-0.008, 0.006), power=0.78),
    "pine-elder": lambda: elder_pine(3413, "pine-elder", height=27.0, crown=0.62, lean=(0.045, -0.02),
                                     roots=dict(count=5, reach=(2.8, 4.6), fork=0.6, ride=0.42, thickness=0.52)),
    "spruce-old-a": lambda: spruce(3527, "spruce-old-a", height=31.0, crown_base=0.30, spread=0.88, stubs=7,
                                   weather=0.22),
    "spruce-old-b": lambda: spruce(3631, "spruce-old-b", height=27.0, crown_base=0.20, stubs=4, weather=0.32,
                                   lean=(0.012, -0.01)),
    "spruce-old-c": lambda: spruce(3739, "spruce-old-c", height=22.0, crown_base=0.10, spread=1.1),
    "spruce-young-a": lambda: spruce(3847, "spruce-young-a", height=9.0, crown_base=0.04, spread=1.2, girth=0.6,
                                     spacing=0.54, bough=1.25, tilt=(100.0, 46.0), droop=0.55, broken=0.0),
    "spruce-young-b": lambda: spruce(3943, "spruce-young-b", height=5.0, crown_base=0.04, spread=1.2, girth=0.55,
                                     spacing=0.42, bough=0.9, tilt=(98.0, 46.0), droop=0.5, broken=0.0),
    "pine-old-a": lambda: conifers.pine(4057, "pine-old-a", height=25.0, crown=0.66, lean=(0.06, 0.025)),
    "birch-a": lambda: birch(4159, "birch-a", height=17.5, lean=(0.09, 0.03)),
    "birch-b": lambda: birch(4261, "birch-b", height=16.0, lean=(-0.07, 0.05)),
}
