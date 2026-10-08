"""Tree recipes for the Summer meadow: silver birch and Norway spruce.

Built on the Fall grove's skeleton primitives and the Golden Forest's conifer helpers.
An old silver birch (Betula pendula) forks into a few ascending leaders whose limbs arch
over and let go of long pendulous shoots; a young one is a single slender white leader in
an airy, drooping crown. The spruce is the Golden Forest's, resized for a meadow edge.

Bark vertex colour: R = how far the wind may carry the vertex, G = the limb's phase,
B = ambient occlusion (baked afterwards), A = a species mask. On a birch the mask is
"dark bark": 1 on thin limbs and twigs (purple-brown, never white), on the roots and on
the rough black base of an old trunk, 0 on the smooth white trunk and leaders. On a
spruce it is lichen, as in the Golden Forest.
"""

import math

import numpy as np

from fall_grove.skeleton import GOLDEN, UP, Envelope, Site, Tree, grow_curve, normalize
# The scaffold helpers are private to the Fall recipes but are exactly what these trees need.
from fall_grove.species import _add_roots, _direction
from fall_grove.wood import MeshData, buttress_profile, catmull_refine, fbm, tube
from golden_forest import conifers

# Which spray each spruce wears. The hero carries the finely modelled section, the grove
# trees the light one (in the Golden Forest pack the two names are the other way round).
SPRUCE_HERO_FOLIAGE = "spruce_bough"
SPRUCE_GROVE_FOLIAGE = "spruce_frond"


def _smoothstep(low, high, value):
    t = np.clip((np.asarray(value, dtype=float) - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# -- silver birch -------------------------------------------------------------------------
def _hang_strands(tree, carriers, spacing, length, floor, level, start=0.3, radius=0.013, steps=6, shortest=1.0):
    """Pendulous shoots: they leave a limb, give in to their own weight and hang.

    Each stops `floor` metres above the ground at the latest, so the curtain has a ragged
    hem well clear of the grass; a shoot left shorter than `shortest` is not grown.
    """
    rng = tree.rng
    strands = []
    for carrier in carriers:
        count = max(1, int(round(carrier.length * (1.0 - start) / spacing)))
        for index in range(count):
            t = start + (1.0 - start) * (index + rng.uniform(0.15, 0.85)) / count
            origin, tangent, parent_radius = carrier.sample(t)
            reach = min(origin[1] - rng.uniform(*floor), rng.uniform(*length))
            if reach < shortest:
                continue
            heading = normalize(tangent * 0.4 + np.array([rng.normal() * 0.12, -0.9, rng.normal() * 0.12]))
            points = grow_curve(rng, origin, heading, reach, steps, wander=0.035, sag=1.3)
            strands.append(tree.add_branch(points, min(parent_radius * 0.5, radius), 0.004, level, parent=carrier,
                                           attach_t=t, flex=0.85, sides=3, power=0.8, kind="strand"))
    return strands


def hero_birch(seed, name="birch-hero", height=16.5):
    """An old weeping birch: a leaning, S-curved bole, three leaders and curtains of shoots."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.32
    fork = float(rng.uniform(5.5, 5.9))
    steps = 12
    t = np.linspace(0.0, 1.0, steps + 1)
    span = fork + 0.45
    # A gentle lean toward -X drawn as a slow S: out, nearly upright, then out again.
    points = np.stack([-0.5 * t ** 1.6 - 0.1 * np.sin(t * math.tau) * np.minimum(1.0, t / 0.2),
                       -0.45 + span * t,
                       0.06 * (np.sin(t * 3.3 + 0.8) - math.sin(0.8))], axis=1)
    points[1:] += rng.normal(size=(steps, 3)) * np.array([0.012, 0.0, 0.012])
    trunk = tree.add_branch(points, radius, 0.215, 0, phase=float(rng.random()), flex=0.05, sides=16, power=0.75)
    lobes = _add_roots(tree, trunk, radius, 5, reach=(0.7, 1.25), seed_azimuth=float(rng.uniform(0, math.tau)))
    top = trunk.points[-1]
    tree.envelope = Envelope([top[0] - 0.9, fork + (height - fork) * 0.5, 0.2],
                             [6.0, (height - fork) * 0.64, 5.2], rng, lumpiness=0.14, flat_bottom=1.2)
    # Leaders: the first carries the line of the trunk on, the others part from it and turn up.
    leaders = []
    for index, (tilt, azimuth, share, base) in enumerate(((10.0, math.pi + 0.1, 1.0, 0.15),
                                                          (22.0, -0.7, 0.87, 0.125),
                                                          (30.0, 2.25, 0.76, 0.105))):
        attach = 1.0 - 0.03 * index
        origin, _, _ = trunk.sample(attach)
        direction = _direction(tilt + float(rng.uniform(-3, 3)), azimuth + float(rng.uniform(-0.15, 0.15)))
        path = grow_curve(rng, origin - UP * 0.3, direction, (height - fork) * share + 0.25, 12, wander=0.05,
                          lift=0.2 if index else 0.1, kink=0.08)
        leaders.append(tree.add_branch(path, base, 0.015, 1, parent=trunk, attach_t=attach, flex=0.24, sides=10,
                                       power=0.95, kind="leader"))
    # Limbs: they leave a leader climbing, then arch over under their own weight. The crown
    # leans the way the trunk does, so they favour that side.
    limbs = []
    axis = top + np.array([0.7, 0.0, 0.0])

    def limb(parent, t, tilt, azimuth, length, sag, girth=0.07, bias=0.55):
        origin, _, parent_radius = parent.sample(t)
        direction = _direction(tilt, azimuth)
        outward = np.array([origin[0] - axis[0], 0.0, origin[2] - axis[2]])
        if bias and np.linalg.norm(outward) > 0.3:
            direction = normalize(direction + normalize(outward) * bias)
        path = grow_curve(rng, origin, direction, length, 8, wander=0.07, sag=sag, kink=0.08)
        limbs.append(tree.add_branch(path, min(parent_radius * 0.5, girth), 0.011, 2, parent=parent, attach_t=t,
                                     phase=float(rng.random()), flex=0.38, sides=6, power=0.9))

    # One long bough sweeps out over the meadow on the leaning side: the curtain the sun shines through.
    limb(leaders[0], 0.1, 66.0, math.pi - 0.25, 6.4, 0.5, girth=0.09, bias=0.0)
    azimuth = float(rng.uniform(0, math.tau))
    for index in range(2):
        azimuth += GOLDEN + float(rng.uniform(-0.3, 0.3))
        limb(trunk, 0.84 + 0.08 * index + float(rng.uniform(0.0, 0.04)), float(rng.uniform(44, 58)), azimuth,
             float(rng.uniform(3.4, 4.4)), 0.45)
    for leader, count in zip(leaders, (14, 11, 9)):
        azimuth = float(rng.uniform(0, math.tau))
        for index in range(count):
            t = 0.12 + 0.85 * (index + float(rng.uniform(0.15, 0.85))) / count
            azimuth += GOLDEN + float(rng.uniform(-0.4, 0.4))
            # High in the crown the limbs are short and keep climbing; low down they are long and arch right over.
            limb(leader, t, float(rng.uniform(40, 64)) - 10.0 * t, azimuth,
                 (4.6 - 2.8 * t) * float(rng.uniform(0.8, 1.15)), 0.8 - 0.4 * t)
    ribs = []
    for carrier in limbs:
        ribs.extend(tree.ramify(carrier, 3, count=int(rng.integers(3, 6)), span=(0.25, 0.97), length=(0.34, 0.58),
                                angle=(36, 68), radius=0.5, tip_radius=0.008, wander=0.1, sag=1.0, lift=0.0, steps=6,
                                flex=0.4, sides=4, taper_length=0.4, min_length=0.8, clip=1.25))
    # The curtains: shoots that hang up to six metres and stop well clear of the ground, so
    # the white trunk stands in the open beneath them.
    strands = _hang_strands(tree, limbs + ribs, 0.6, (3.0, 6.0), (3.5, 6.0), 4)
    for strand in strands:
        tree.add_sites(strand, max(2, int(round(strand.length / 0.8))), span=(0.04, 1.0), scale=(0.9, 1.25),
                       droop=0.0, spread=0.14, variants=2, jitter=0.07)
    for rib in ribs:
        tree.add_sites(rib, max(2, int(round(rib.length / 0.7))), span=(0.35, 1.0), scale=(0.85, 1.15), droop=1.1,
                       spread=0.25, variants=2, jitter=0.1)
    for carrier in limbs:
        tree.add_sites(carrier, 2, span=(0.8, 1.0), scale=(0.85, 1.15), droop=1.0, spread=0.3, variants=2, jitter=0.1)
    for leader in leaders:
        tree.add_sites(leader, 4, span=(0.82, 1.0), scale=(0.85, 1.1), droop=0.8, spread=0.4, variants=2, jitter=0.12)
    # Nothing hangs into the space under the crown: a spray is a metre long below its site.
    tree.sites = [site for site in tree.sites if site.position[1] > 3.6]
    tree.thin_sites(0.3)
    tree.meta = dict(species="birch", role="hero", height=height, trunkRadius=radius, foliage="birch_spray",
                     crownBase=float(min(carrier.points[0][1] for carrier in limbs)), fork=fork)
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.36, flare_height=0.45, lobe_gain=0.5,
                                          lobe_height=0.45, flute=0.025, seed=seed % 7)
    return tree


def grove_birch(seed, name="birch-grove", height=14.0, forked=False, spread=1.0, lean=(0.0, 0.0)):
    """A silver birch for the middle distance: slender white stems in an airy, drooping crown."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.145 + 0.005 * height
    heading = np.array([lean[0] + rng.uniform(-0.04, 0.04), 1.0, lean[1] + rng.uniform(-0.04, 0.04)])
    stems = []
    if forked:
        # Two stems from one stool: they part low and climb side by side.
        fork = height * float(rng.uniform(0.13, 0.18))
        path = grow_curve(rng, [0.0, -0.3, 0.0], heading, fork + 0.3, 5, wander=0.03)
        trunk = tree.add_branch(path, radius, radius * 0.82, 0, phase=float(rng.random()), flex=0.05, sides=10,
                                power=0.8)
        azimuth = float(rng.uniform(0, math.tau))
        for index, (share, tilt) in enumerate(((1.0, 9.0), (0.86, 15.0))):
            direction = _direction(tilt + float(rng.uniform(-2, 2)),
                                   azimuth + index * math.pi + float(rng.uniform(-0.3, 0.3)))
            path = grow_curve(rng, trunk.points[-1] - UP * 0.25, direction, (height - fork) * share + 0.25, 13,
                              wander=0.03, lift=0.22)
            stems.append(tree.add_branch(path, radius * (0.64 - 0.08 * index), 0.02, 1, parent=trunk, attach_t=1.0,
                                         flex=0.22, sides=8, power=0.85, kind="leader"))
        crown_start = 0.2
    else:
        path = grow_curve(rng, [0.0, -0.3, 0.0], heading, height + 0.3, 14, wander=0.03, lift=0.12)
        trunk = tree.add_branch(path, radius, 0.02, 0, phase=float(rng.random()), flex=0.2, sides=9, power=0.85)
        stems.append(trunk)
        crown_start = float(rng.uniform(0.28, 0.36))
    crown_radius = height * 0.24 * spread
    tree.envelope = Envelope([0.0, height * 0.64, 0.0], [crown_radius, height * 0.42, crown_radius], rng,
                             lumpiness=0.14, flat_bottom=0.9)
    axis = trunk.points[-1] if forked else None
    limbs = []
    for stem in stems:
        count = int(rng.integers(16, 20)) if forked else int(rng.integers(26, 32))
        azimuth = float(rng.uniform(0, math.tau))
        for index in range(count):
            t = crown_start + (0.97 - crown_start) * (index + float(rng.uniform(0.1, 0.9))) / count
            origin, _, parent_radius = stem.sample(t)
            azimuth += GOLDEN + float(rng.uniform(-0.3, 0.3))
            direction = _direction(float(rng.uniform(32, 56)), azimuth)
            if axis is not None:
                outward = np.array([origin[0] - axis[0], 0.0, origin[2] - axis[2]])
                if np.linalg.norm(outward) > 0.15:
                    direction = normalize(direction + normalize(outward) * 0.45)
            # The crown is an oval: widest a third of the way up it, drawn in at the top.
            share = (t - crown_start) / (0.97 - crown_start)
            length = (height * (0.12 + 0.13 * math.sin(math.pi * share ** 0.7)) * (1.0 - 0.35 * share) * spread
                      * float(rng.uniform(0.85, 1.15)))
            path = grow_curve(rng, origin, direction, max(length, 0.8), 7, wander=0.08, sag=0.75, lift=0.0)
            limbs.append(tree.add_branch(path, min(parent_radius * 0.5, 0.055), 0.008, 2, parent=stem, attach_t=t,
                                         phase=float(rng.random()), flex=0.4, sides=4, power=0.9))
    for carrier in limbs:
        ribs = tree.ramify(carrier, 3, count=3, span=(0.3, 0.92), length=(0.4, 0.62), angle=(35, 65), radius=0.5,
                           tip_radius=0.006, wander=0.1, sag=1.0, lift=0.0, steps=4, flex=0.4, sides=3,
                           taper_length=0.4, min_length=0.6, clip=1.3)
        tree.add_sites(carrier, max(3, int(round(carrier.length / 0.45))), span=(0.2, 1.0), scale=(1.1, 1.7),
                       droop=1.5, spread=0.2, variants=2, jitter=0.15)
        for rib in ribs:
            tree.add_sites(rib, max(2, int(round(rib.length / 0.5))), span=(0.3, 1.0), scale=(1.1, 1.7), droop=1.5,
                           spread=0.2, variants=2, jitter=0.15)
    for stem in stems:
        tree.add_sites(stem, 3, span=(0.93, 1.0), scale=(1.0, 1.4), droop=0.6, spread=0.5, variants=2, jitter=0.15)
    tree.thin_sites(0.36)
    tree.meta = dict(species="birch", role="grove", height=height, trunkRadius=radius, foliage="birch_strand",
                     crownBase=float(min(carrier.points[0][1] for carrier in limbs)), forked=bool(forked))
    tree.trunk_profile = buttress_profile(radius, [(0.0, 0.5, 0.4), (2.4, 0.5, 0.5), (4.4, 0.5, 0.4)], flare=0.3,
                                          flare_height=0.4, lobe_gain=0.2, lobe_height=0.3, flute=0.0, seed=seed % 5)
    return tree


def _dark_bark(branch, positions, ring_radius, ring_spacing, kids, seed, base_height):
    """The birch mask: 1 where the bark is dark (thin wood, roots, the old base, branch collars)."""
    if branch.kind == "root":
        return np.ones(len(positions))
    noise = fbm(positions, 2.2, 3, seed)
    dark = 1.0 - _smoothstep(0.02, 0.052, ring_radius + (noise - 0.5) * 0.02)
    if branch.level == 0:
        # Black fissures climb the base in ragged vertical tongues.
        streak = np.clip((fbm(positions * np.array([2.6, 0.5, 2.6]), 1.0, 3, seed + 3) - 0.5) * 2.6 + 0.5, 0.0, 1.0)
        line = base_height * (0.45 + 1.1 * streak)
        dark = np.maximum(dark, 1.0 - _smoothstep(line - 0.3, line + 0.3, positions[:, 1]))
    # The dark chevron a birch wears under every limb that leaves a white stem.
    for kid in kids:
        if kid.kind == "root":
            continue
        origin, tangent, radius = branch.sample(kid.attach_t)
        if radius < 0.05:
            continue
        direction = normalize(kid.points[1] - kid.points[0])
        radial = direction - tangent * float(np.dot(direction, tangent))
        if np.linalg.norm(radial) < 1e-4:
            continue
        size = 0.06 + 2.2 * float(kid.radii[0])
        along = max(size * 1.7, ring_spacing * 0.8)
        local = positions - (origin + normalize(radial) * radius - tangent * along * 0.35)
        axial = local @ tangent
        across = local - axial[:, None] * tangent
        distance = np.einsum("ij,ij->i", across, across) / (size * size) + (axial / along) ** 2
        dark = np.maximum(dark, 0.9 * np.exp(-distance))
    return np.clip(dark, 0.0, 1.0)


def build_birch_wood(tree, hero=False, seed=3):
    """Mesh every branch of a birch into one bark mesh.

    The white wood comes first (trunk, roots, leaders, and the scaffold limbs of the hero),
    so a low tier can stop drawing before the fine limbs and hanging shoots.
    """
    children = {}
    for branch in tree.branches:
        if branch.parent is not None:
            children.setdefault(id(branch.parent), []).append(branch)
    core_level = 2 if hero else 1

    def core(branch):
        return branch.level <= core_level or branch.kind == "root"

    mesh = MeshData()
    mesh.core_indices = 0
    for branch in sorted(tree.branches, key=lambda item: not core(item)):
        if branch.level == 0:
            refine = 3 if hero else 2
        elif branch.kind == "leader":
            refine = 3 if hero else 2
        elif hero and (branch.level == 2 or branch.kind == "root"):
            refine = 2
        else:
            refine = 1
        profile = getattr(tree, "trunk_profile", None) if branch.level == 0 else None
        positions, normals, uvs, colors, indices = tube(branch, refine=refine, profile=profile)
        _, radii = catmull_refine(branch.points, branch.radii, refine)
        ring_radius = np.repeat(radii, branch.sides + 1)
        colors[:, 3] = _dark_bark(branch, positions, ring_radius, branch.length / max(1, len(radii) - 1),
                                  children.get(id(branch), ()), seed, 1.25 if hero else 0.4)
        mesh.append(positions, normals, uvs, colors, indices)
        if core(branch):
            mesh.core_indices = mesh.triangles * 3
    return mesh


# -- Norway spruce ------------------------------------------------------------------------
def spruce(seed, name, height=18.0, role="grove", crown_base=0.14, spread=1.0, lean=(0.0, 0.0), radius=None):
    """A Norway spruce, after the Golden Forest's: whorls of limbs that droop and turn up.

    Sprays and whorl spacing follow the height, so a twelve-metre tree is not clothed in
    the boughs of a thirty-metre one. `crown_base` is where the living crown starts.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    hero = role == "hero"
    if radius is None:
        radius = 0.1 + height * 0.0135
    heading = np.array([lean[0] + rng.uniform(-0.02, 0.02), 1.0, lean[1] + rng.uniform(-0.02, 0.02)])
    points = grow_curve(rng, [0.0, -0.45, 0.0], heading, height + 0.45, 26 if hero else 16, wander=0.012,
                        lift=0.12)
    trunk = tree.add_branch(points, radius, 0.02, 0, phase=float(rng.random()), flex=0.22,
                            sides=14 if hero else 8, power=0.92)
    lobes = []
    if hero:
        lobes = _add_roots(tree, trunk, radius, 5, reach=(1.2, 2.2), seed_azimuth=float(rng.uniform(0, math.tau)))
    stature = (height / (31.0 if hero else 24.0)) ** 0.7
    spacing = (0.66 if hero else 0.94) * stature
    size = (1.85 if hero else 2.3) * stature
    reach = height * (0.2 if hero else 0.185) * spread
    start = crown_base * height
    whorls = max(4, int((height * 0.975 - start) / spacing))
    azimuth = float(rng.uniform(0, math.tau))
    for whorl in range(whorls):
        level = start + (whorl + float(rng.uniform(-0.25, 0.25))) * spacing
        t = (level + 0.45) / (height + 0.45)
        crown_t = whorl / max(1, whorls - 1)
        arms = 5 + int(rng.integers(-1, 2))
        for _ in range(arms):
            azimuth += GOLDEN + float(rng.uniform(-0.35, 0.35))
            origin, _, parent_radius = trunk.sample(t + float(rng.uniform(-0.004, 0.004)))
            length = (reach * (1.0 - crown_t) ** 0.78 + 0.45 * stature) * float(rng.uniform(0.78, 1.12))
            if crown_t < 0.18 and rng.random() < 0.35:
                length *= float(rng.uniform(0.4, 0.7))          # old limbs low down are broken short
            tilt = 112.0 - 52.0 * crown_t ** 0.85 + float(rng.uniform(-7, 7))
            limb_points = grow_curve(rng, origin, _direction(tilt, azimuth), length, 7, wander=0.045,
                                     sag=0.55 * (1.0 - crown_t) + 0.08, lift=0.55 + 0.25 * (1.0 - crown_t))
            limb = tree.add_branch(limb_points, min(parent_radius * 0.42, 0.05 + 0.012 * length), 0.006, 1,
                                   parent=trunk, attach_t=t, flex=0.5, sides=5 if hero else 3, power=0.9)
            conifers._spruce_boughs(tree, limb, crown_t, size)
    # The leader: a spire of short upright shoots.
    for index in range(6 if hero else 4):
        t = 1.0 - 0.014 * index
        point, tangent, _ = trunk.sample(t)
        outward = _direction(90.0, azimuth + index * GOLDEN)
        forward = normalize(tangent * (0.95 - 0.1 * index) + outward * (0.2 + 0.16 * index))
        tree.sites.append(Site(point - tangent * 0.2 * stature, forward, normalize(outward + UP * 0.3),
                               size * 0.34 * (1.0 + 0.2 * index), trunk.sway_at(t) + 0.1, trunk.phase,
                               variant=1, hue=float(rng.random()), branch_level=0))
    tree.envelope = Envelope([0.0, start + (height - start) * 0.45, 0.0],
                             [reach, (height - start) * 0.55, reach], rng, lumpiness=0.08)
    tree.meta = dict(species="spruce", role=role, height=height, trunkRadius=radius,
                     foliage=SPRUCE_HERO_FOLIAGE if hero else SPRUCE_GROVE_FOLIAGE, crownBase=start)
    if not lobes:
        lobes = [(float(rng.uniform(0, math.tau)), 0.45, 0.5) for _ in range(4)]
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.42, flare_height=0.8, lobe_gain=0.34,
                                          lobe_height=0.6, flute=0.02, seed=seed % 7)
    return tree


def build_wood(tree, hero=False, seed=3):
    """One bark mesh for any tree of the meadow (the core of the mesh comes first)."""
    if tree.meta["species"] == "birch":
        return build_birch_wood(tree, hero=hero, seed=seed)
    return conifers.build_wood(tree, hero=hero, seed=seed)


RECIPES = {
    "birch-hero": lambda: hero_birch(9103, "birch-hero", height=16.5),
    "birch-grove-a": lambda: grove_birch(9211, "birch-grove-a", height=14.5),
    "birch-grove-b": lambda: grove_birch(9323, "birch-grove-b", height=11.5, spread=1.12, lean=(0.05, 0.0)),
    "birch-grove-c": lambda: grove_birch(9437, "birch-grove-c", height=16.5, forked=True, spread=0.95),
    "spruce-hero": lambda: spruce(9501, "spruce-hero", height=21.0, role="hero", crown_base=0.27, radius=0.36,
                                  spread=1.06, lean=(0.012, 0.0)),
    "spruce-grove-a": lambda: spruce(9601, "spruce-grove-a", height=17.0, crown_base=0.2),
    "spruce-grove-b": lambda: spruce(9719, "spruce-grove-b", height=20.0, crown_base=0.22, spread=0.9),
    "spruce-grove-c": lambda: spruce(9811, "spruce-grove-c", height=12.5, crown_base=0.25, spread=1.15),
    "spruce-grove-d": lambda: spruce(9923, "spruce-grove-d", height=15.0, crown_base=0.28, spread=0.86),
}
