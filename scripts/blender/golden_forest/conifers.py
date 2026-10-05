"""Conifer recipes for the Golden Forest lake: Norway spruce, Scots pine and a dead snag.

Built on the Fall grove's skeleton primitives. A spruce keeps one straight leader to the
top and carries whorls of limbs that droop under their fronds and turn up at the tip; a
pine holds a bare, curving trunk under a broken umbrella of crooked limbs.
"""

import math

import numpy as np

from fall_grove.skeleton import GOLDEN, UP, Envelope, Site, Tree, grow_curve, normalize
from fall_grove.species import _add_roots, _direction
from fall_grove.wood import MeshData, buttress_profile, fbm, tube


def _spruce_boughs(tree, limb, crown_t, size):
    """Clothe one limb in overlapping bough sections, largest at its root, down to its tip."""
    rng = tree.rng
    s = 0.16
    while s < 0.97:
        point, tangent, _ = limb.sample(s)
        scale = size * (1.0 - 0.42 * s) * float(rng.uniform(0.88, 1.16)) * (0.62 + 0.38 * (1.0 - crown_t))
        across = normalize(np.cross(tangent, UP))
        forward = normalize(tangent + across * float(rng.uniform(-0.16, 0.16)))
        top = normalize(UP - forward * float(np.dot(UP, forward)) + across * float(rng.uniform(-0.12, 0.12)))
        # Low in the crown the curtains hang long; near the spire they are short.
        variant = 0 if rng.random() < 0.95 - crown_t * 0.9 else 1
        tree.sites.append(Site(point, forward, top, scale, limb.sway_at(s) + 0.1,
                               (limb.phase + float(rng.uniform(-0.05, 0.05))) % 1.0,
                               variant=variant, hue=float(rng.random()), branch_level=1))
        s += scale * 0.6 / max(limb.length, 0.5)


def spruce(seed, name, height=24.0, role="grove", crown_base=0.14, spread=1.0, lean=(0.0, 0.0)):
    """A Norway spruce. `crown_base` is where the living crown starts, as a share of the height."""
    tree = Tree(name, seed)
    rng = tree.rng
    hero = role == "hero"
    radius = 0.1 + height * (0.0165 if hero else 0.0145)
    heading = np.array([lean[0] + rng.uniform(-0.02, 0.02), 1.0, lean[1] + rng.uniform(-0.02, 0.02)])
    points = grow_curve(rng, [0.0, -0.45, 0.0], heading, height + 0.45, 26 if hero else 16, wander=0.012,
                        lift=0.12)
    trunk = tree.add_branch(points, radius, 0.02, 0, phase=float(rng.random()), flex=0.22,
                            sides=14 if hero else 8, power=0.92)
    lobes = []
    if hero:
        lobes = _add_roots(tree, trunk, radius, 5, reach=(1.5, 2.6), seed_azimuth=float(rng.uniform(0, math.tau)))
    spacing = 0.66 if hero else 0.94
    reach = height * (0.2 if hero else 0.185) * spread
    start = crown_base * height
    whorls = max(4, int((height * 0.975 - start) / spacing))
    azimuth = float(rng.uniform(0, math.tau))
    size = 1.55 if hero else 2.3
    for whorl in range(whorls):
        level = start + (whorl + float(rng.uniform(-0.25, 0.25))) * spacing
        t = (level + 0.45) / (height + 0.45)
        crown_t = whorl / max(1, whorls - 1)
        arms = 5 + int(rng.integers(-1, 2))
        for _ in range(arms):
            azimuth += GOLDEN + float(rng.uniform(-0.35, 0.35))
            origin, _, parent_radius = trunk.sample(t + float(rng.uniform(-0.004, 0.004)))
            length = (reach * (1.0 - crown_t) ** 0.78 + 0.45) * float(rng.uniform(0.78, 1.12))
            if crown_t < 0.18 and rng.random() < 0.35:
                length *= float(rng.uniform(0.4, 0.7))          # old limbs low down are broken short
            tilt = 112.0 - 52.0 * crown_t ** 0.85 + float(rng.uniform(-7, 7))
            limb_points = grow_curve(rng, origin, _direction(tilt, azimuth), length, 7, wander=0.045,
                                     sag=0.55 * (1.0 - crown_t) + 0.08, lift=0.55 + 0.25 * (1.0 - crown_t))
            limb = tree.add_branch(limb_points, min(parent_radius * 0.42, 0.05 + 0.012 * length), 0.006, 1,
                                   parent=trunk, attach_t=t, flex=0.5, sides=5 if hero else 3, power=0.9)
            _spruce_boughs(tree, limb, crown_t, size)
    # The leader: a spire of short upright shoots.
    for index in range(6 if hero else 4):
        t = 1.0 - 0.014 * index
        point, tangent, _ = trunk.sample(t)
        outward = _direction(90.0, azimuth + index * GOLDEN)
        forward = normalize(tangent * (0.95 - 0.1 * index) + outward * (0.2 + 0.16 * index))
        tree.sites.append(Site(point - tangent * 0.2, forward, normalize(outward + UP * 0.3),
                               size * 0.34 * (1.0 + 0.2 * index), trunk.sway_at(t) + 0.1, trunk.phase,
                               variant=1, hue=float(rng.random()), branch_level=0))
    tree.envelope = Envelope([0.0, start + (height - start) * 0.45, 0.0],
                             [reach, (height - start) * 0.55, reach], rng, lumpiness=0.08)
    tree.meta = dict(species="spruce", role=role, height=height, trunkRadius=radius,
                     foliage="spruce_frond" if hero else "spruce_bough", crownBase=start)
    if not lobes:
        lobes = [(float(rng.uniform(0, math.tau)), 0.45, 0.5) for _ in range(4)]
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.42, flare_height=0.8, lobe_gain=0.34,
                                          lobe_height=0.6, flute=0.02, seed=seed % 7)
    return tree


def pine(seed, name, height=22.0, role="grove", crown=0.6, lean=(0.0, 0.0)):
    """A Scots pine: a long bare trunk that leans and recovers, crowned by crooked limbs and tufts."""
    tree = Tree(name, seed)
    rng = tree.rng
    hero = role == "hero"
    radius = 0.12 + height * 0.0135
    heading = np.array([lean[0], 1.0, lean[1]])
    points = grow_curve(rng, [0.0, -0.45, 0.0], heading, height * 0.94 + 0.45, 18, wander=0.03, lift=0.34,
                        kink=0.05)
    trunk = tree.add_branch(points, radius, 0.1, 0, phase=float(rng.random()), flex=0.16,
                            sides=14 if hero else 8, power=0.75)
    lobes = []
    if hero:
        lobes = _add_roots(tree, trunk, radius, 5, reach=(1.4, 2.4), seed_azimuth=float(rng.uniform(0, math.tau)))
    top = points[-1]
    crown_radius = height * 0.25
    tree.envelope = Envelope([top[0], height * 0.84, top[2]], [crown_radius, height * 0.18, crown_radius], rng,
                             lumpiness=0.24, flat_bottom=0.8)
    spacing = 0.62 if hero else 0.95
    scale = (1.05, 1.5) if hero else (1.6, 2.3)
    limbs = []
    count = int(rng.integers(10, 13)) if hero else int(rng.integers(8, 11))
    base_azimuth = float(rng.uniform(0, math.tau))
    for index in range(count):
        rise = (index + float(rng.uniform(0.1, 0.9))) / count
        t = crown + (0.985 - crown) * rise
        origin, _, parent_radius = trunk.sample(t)
        azimuth = base_azimuth + index * GOLDEN + float(rng.uniform(-0.4, 0.4))
        tilt = float(rng.uniform(62, 88)) - 34.0 * rise
        length = height * float(rng.uniform(0.17, 0.27)) * (1.12 - 0.5 * rise)
        limb_points = grow_curve(rng, origin, _direction(tilt, azimuth), length, 8, wander=0.11, sag=0.16,
                                 lift=0.6, kink=0.2)
        limb_points = tree.envelope.clip(limb_points, 1.1)
        limbs.append(tree.add_branch(limb_points, parent_radius * 0.5, 0.02, 1, parent=trunk, attach_t=t,
                                     flex=0.3, sides=7 if hero else 5, power=0.85))
    for limb in limbs:
        branches = tree.ramify(limb, 2, count=int(rng.integers(6, 9)) if hero else int(rng.integers(5, 8)),
                               span=(0.22, 0.97), length=(0.34, 0.6), angle=(35, 68), radius=0.5,
                               tip_radius=0.014, wander=0.14, sag=0.05, lift=0.5, steps=5, flex=0.35,
                               sides=4 if hero else 3, rise=(0.0, 0.9), kink=0.1, min_length=0.8, clip=1.12)
        tree.add_sites(limb, max(2, int(round(limb.length * 0.4 / spacing))), span=(0.55, 1.0), scale=scale,
                       droop=-0.3, spread=0.5, variants=2, jitter=0.3)
        for branch in branches:
            twigs = tree.ramify(branch, 3, count=int(rng.integers(3, 6)) if hero else int(rng.integers(2, 4)),
                                span=(0.25, 0.95), length=(0.35, 0.6), angle=(30, 65), radius=0.5,
                                tip_radius=0.008, wander=0.16, sag=0.0, lift=0.45, steps=3, flex=0.35, sides=3,
                                rise=(0.1, 0.9), min_length=0.5, clip=1.15)
            tree.add_sites(branch, max(2, int(round(branch.length * 0.7 / spacing))), span=(0.4, 1.0),
                           scale=scale, droop=-0.3, spread=0.5, variants=2, jitter=0.3)
            for twig in twigs:
                tree.add_sites(twig, 1, span=(0.6, 1.0), scale=scale, droop=-0.3, spread=0.5, variants=2,
                               jitter=0.25)
    tree.add_sites(trunk, 4, span=(0.97, 1.0), scale=scale, droop=-0.6, spread=0.6, variants=2, jitter=0.4)
    tree.thin_sites(spacing * 0.62)
    # Dead stubs on the bare trunk: what is left of the limbs the crown outgrew.
    for _ in range(int(rng.integers(3, 6))):
        t = float(rng.uniform(0.24, crown - 0.03))
        origin, _, parent_radius = trunk.sample(t)
        stub = grow_curve(rng, origin, _direction(float(rng.uniform(70, 96)), float(rng.uniform(0, math.tau))),
                          float(rng.uniform(0.5, 1.7)), 3, wander=0.1)
        tree.add_branch(stub, parent_radius * 0.22, 0.012, 1, parent=trunk, attach_t=t, flex=0.05, sides=4,
                        kind="stub")
    tree.meta = dict(species="pine", role=role, height=height, trunkRadius=radius,
                     foliage="pine_tuft" if hero else "pine_clump", crownBase=crown * height)
    if not lobes:
        lobes = [(float(rng.uniform(0, math.tau)), 0.45, 0.5) for _ in range(4)]
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.36, flare_height=0.7, lobe_gain=0.3,
                                          lobe_height=0.55, flute=0.03, seed=seed % 5)
    return tree


def snag(seed, name="snag", height=13.0):
    """A long-dead pine: silver wood, a snapped top and a few bare, twisted limbs."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.3
    points = grow_curve(rng, [0.0, -0.4, 0.0], [0.07, 1.0, -0.03], height + 0.4, 12, wander=0.03, kink=0.1)
    trunk = tree.add_branch(points, radius, 0.09, 0, phase=float(rng.random()), flex=0.04, sides=9, power=0.8)
    azimuth = float(rng.uniform(0, math.tau))
    for index in range(8):
        t = 0.42 + 0.52 * (index + float(rng.uniform(0.1, 0.9))) / 8
        origin, _, parent_radius = trunk.sample(t)
        azimuth += GOLDEN
        limb_points = grow_curve(rng, origin, _direction(float(rng.uniform(52, 92)), azimuth),
                                 float(rng.uniform(1.4, 4.2)) * (1.25 - t), 6, wander=0.16, sag=0.1, lift=0.5,
                                 kink=0.3)
        limb = tree.add_branch(limb_points, parent_radius * 0.4, 0.014, 1, parent=trunk, attach_t=t, flex=0.05,
                               sides=5)
        tree.ramify(limb, 2, count=int(rng.integers(1, 4)), span=(0.3, 0.9), length=(0.3, 0.6), angle=(35, 70),
                    radius=0.5, tip_radius=0.008, wander=0.2, sag=0.0, lift=0.3, steps=4, flex=0.05, sides=3,
                    min_length=0.4, kink=0.2)
    tree.meta = dict(species="snag", role="prop", height=height, trunkRadius=radius, foliage=None)
    tree.trunk_profile = buttress_profile(radius, [(0.4, 0.5, 0.6), (2.6, 0.5, 0.5), (4.6, 0.5, 0.6)], flare=0.4,
                                          flare_height=0.6, lobe_gain=0.3, lobe_height=0.5, flute=0.05, seed=3)
    return tree


def bark_mask(species, height, seed):
    """Vertex-colour alpha for conifer bark.

    Pine: 0 on the grey, plated lower trunk rising to 1 on the thin orange bark of the
    upper trunk and limbs. Spruce and snag: lichen, thicker on the shaded side and low down.
    """
    def mask(positions, normals):
        noise = fbm(positions, 0.7, 3, seed)
        fine = fbm(positions, 3.6, 2, seed + 5)
        if species == "pine":
            rise = np.clip((positions[:, 1] / height - 0.24) / 0.32, 0.0, 1.0)
            return np.clip(rise * rise * (3.0 - 2.0 * rise) + (noise - 0.5) * 0.5, 0.0, 1.0)
        low = np.clip(1.0 - positions[:, 1] / (height * 0.5), 0.0, 1.0)
        shaded = np.clip(0.55 + 0.45 * normals[:, 2], 0.0, 1.0)
        return np.clip((0.25 + 0.75 * low) * shaded * np.clip((noise - 0.34) * 2.6, 0.0, 1.0)
                       * (0.7 + 0.6 * fine), 0.0, 1.0)
    return mask


def build_wood(tree, hero=False, seed=3):
    """Mesh every branch of a conifer into one bark mesh (limbs last, so a tier can skip them)."""
    mesh = MeshData()
    mask = bark_mask(tree.meta["species"], tree.meta["height"], seed)
    ordered = sorted(tree.branches, key=lambda branch: branch.level >= 1 and branch.kind != "root")
    mesh.core_indices = 0
    for branch in ordered:
        refine = 1
        if branch.level == 0:
            refine = 3 if hero else 2
        elif hero:
            refine = 2
        profile = getattr(tree, "trunk_profile", None) if branch.level == 0 else None
        mesh.append(*tube(branch, refine=refine, profile=profile, moss=mask))
        if branch.level == 0 or branch.kind == "root":
            mesh.core_indices = mesh.triangles * 3
    return mesh


RECIPES = {
    "spruce-hero": lambda: spruce(8101, "spruce-hero", height=31.0, role="hero", crown_base=0.07, lean=(0.012, 0.0)),
    "pine-hero": lambda: pine(8203, "pine-hero", height=24.0, role="hero", crown=0.5, lean=(-0.16, -0.04)),
    "spruce-grove-a": lambda: spruce(8307, "spruce-grove-a", height=24.0, crown_base=0.12),
    "spruce-grove-b": lambda: spruce(8419, "spruce-grove-b", height=28.5, crown_base=0.22, spread=0.9),
    "spruce-grove-c": lambda: spruce(8521, "spruce-grove-c", height=18.5, crown_base=0.08, spread=1.12),
    "spruce-grove-d": lambda: spruce(8627, "spruce-grove-d", height=22.0, crown_base=0.3, spread=0.84),
    "pine-grove-a": lambda: pine(8701, "pine-grove-a", height=22.0, crown=0.6, lean=(0.08, 0.03)),
    "pine-grove-b": lambda: pine(8809, "pine-grove-b", height=18.0, crown=0.52, lean=(-0.12, 0.06)),
}
