"""Tree recipes for the Fall grove.

Each recipe grows one specimen with the shared skeleton primitives and returns a Tree whose
`meta` records what the runtime needs (crown hull, height, foliage kind, trunk radius).
"""

import math

import numpy as np

from .skeleton import UP, Envelope, Tree, grow_curve
from .wood import buttress_profile


def _direction(tilt_degrees, azimuth):
    tilt = math.radians(tilt_degrees)
    return np.array([math.sin(tilt) * math.cos(azimuth), math.cos(tilt), math.sin(tilt) * math.sin(azimuth)])


def _add_roots(tree, trunk, trunk_radius, count, reach=(2.4, 4.4), seed_azimuth=0.0):
    """Buttress lobes on the trunk and the roots that continue them across the ground."""
    rng = tree.rng
    lobes = []
    for index in range(count):
        azimuth = seed_azimuth + math.tau * (index + rng.uniform(-0.28, 0.28)) / count
        strength = float(rng.uniform(0.6, 1.0))
        lobes.append((azimuth, float(rng.uniform(0.2, 0.34)), strength))
        outward = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        length = rng.uniform(*reach) * (0.6 + 0.5 * strength)
        points = grow_curve(rng, outward * trunk_radius * 0.6 + UP * 0.55, outward + UP * -0.1, length, 8,
                            wander=0.13)
        t = np.linspace(0.0, 1.0, len(points))
        # Roots ride the surface near the trunk and dive under the leaf litter further out.
        points[:, 1] = 0.5 * (1.0 - t) ** 1.7 - 0.5 * t + 0.05 * np.sin(t * 9.0 + index)
        tree.add_branch(points, trunk_radius * 0.44 * strength, 0.035, 1, parent=trunk, attach_t=0.0, phase=0.0,
                        flex=0.0, sides=7, power=0.85, kind="root")
    return lobes


def _foliate(tree, limbs, branch_count, twig_count, spacing, spray_scale, hero=True, variants=2,
             branch_length=(0.3, 0.52), twig_length=(0.3, 0.55), droop=0.35, branch_sag=0.16, twig_sag=0.3):
    """Clothe `limbs` in branches, twigs and spray sites spaced `spacing` metres apart."""
    rng = tree.rng
    for limb in limbs:
        branches = tree.ramify(limb, 2, count=int(rng.integers(*branch_count)), span=(0.2, 0.97),
                               length=branch_length, angle=(40, 68), radius=0.5, tip_radius=0.014, wander=0.13,
                               sag=branch_sag, lift=0.42, steps=7, flex=0.3, sides=6 if hero else 5, kink=0.08,
                               taper_length=0.5)
        tree.add_sites(limb, 2, span=(0.82, 1.0), scale=spray_scale, droop=droop, variants=variants)
        for branch in branches:
            if twig_count[1] > 0:
                twigs = tree.ramify(branch, 3, count=int(rng.integers(*twig_count)), span=(0.15, 0.98),
                                    length=twig_length, angle=(32, 66), radius=0.5, tip_radius=0.007,
                                    wander=0.17, sag=twig_sag, lift=0.16, steps=4, flex=0.3, sides=3,
                                    min_length=0.7, taper_length=0.35)
                for twig in twigs:
                    tree.add_sites(twig, max(1, int(round(twig.length / spacing))), span=(0.25, 1.0),
                                   scale=spray_scale, droop=droop, variants=variants)
                tree.add_sites(branch, max(1, int(round(branch.length * 0.4 / spacing))), span=(0.6, 1.0),
                               scale=spray_scale, droop=droop, variants=variants)
            else:
                tree.add_sites(branch, max(2, int(round(branch.length / spacing))), span=(0.3, 1.0),
                               scale=spray_scale, droop=droop, variants=variants)


def _leaders(tree, trunk, count, length, tilt, base_radius, wander=0.085, sag=0.0, lift=0.16, kink=0.14,
             clip=1.02, sides=11, flex=0.2, upright=10.0):
    """Scaffold limbs leaving the top of the trunk; the first climbs, the rest spread."""
    rng = tree.rng
    top = trunk.points[-1]
    limbs = []
    base_azimuth = float(rng.uniform(0, math.tau))
    for index in range(count):
        azimuth = base_azimuth + index * math.tau / max(1, count - 1) + rng.uniform(-0.3, 0.3)
        lean = upright if index == 0 else rng.uniform(*tilt)
        attach = 1.0 - 0.035 * index
        origin, _, _ = trunk.sample(attach)
        points = grow_curve(rng, origin - UP * 0.4, _direction(lean, azimuth), rng.uniform(*length), 11,
                            wander=wander, sag=sag if index else 0.0, lift=lift, kink=kink)
        points = tree.envelope.clip(points, clip)
        limbs.append(tree.add_branch(points, base_radius * (1.0 - 0.07 * index), 0.035, 1, parent=trunk,
                                     attach_t=attach, flex=flex, sides=sides, power=0.9))
    del top
    return limbs


def hero_maple(seed, reach=1.0, name="maple-hero"):
    """An ancient maple: flared, buttressed trunk, a spreading scaffold and long framing boughs."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 1.02
    fork = float(rng.uniform(6.0, 6.7))
    trunk_points = grow_curve(rng, [0.0, -0.45, 0.0], [-0.07 * reach, 1.0, 0.03], fork + 0.45, 9, wander=0.03)
    trunk = tree.add_branch(trunk_points, radius, 0.74, 0, phase=float(rng.random()), flex=0.06, sides=18,
                            power=0.7)
    lobes = _add_roots(tree, trunk, radius, 6, seed_azimuth=float(rng.uniform(0, math.tau)))
    tree.envelope = Envelope([1.6 * reach, 14.4, 0.3], [10.4, 8.4, 9.6], rng, lumpiness=0.17)
    limbs = _leaders(tree, trunk, 6, (10.0, 13.5), (34, 64), 0.5, sag=0.1)
    # The framing bough sweeps toward the clearing, sags under its own weight, then lifts.
    toward = 0.0 if reach > 0 else math.pi
    for height, azimuth, length, elevation in ((0.72, toward, 11.0, 14.0), (0.84, toward + math.pi + 0.9, 8.0, 28.0),
                                                (0.9, toward - 1.45, 7.4, 30.0), (0.8, toward + 1.3, 7.0, 24.0)):
        origin, _, parent_radius = trunk.sample(height)
        direction = _direction(90.0 - elevation, azimuth + rng.uniform(-0.2, 0.2))
        points = grow_curve(rng, origin, direction, length, 11, wander=0.075, sag=0.5, lift=0.85, kink=0.12)
        points = tree.envelope.clip(points, 1.15)
        limbs.append(tree.add_branch(points, parent_radius * 0.5, 0.03, 1, parent=trunk, attach_t=height,
                                     flex=0.24, sides=10, power=0.9))
    _foliate(tree, limbs, (10, 14), (7, 11), 0.48, (1.15, 1.6))
    tree.thin_sites(0.46)
    tree.meta = dict(species="maple", role="hero", height=22.0, trunkRadius=radius, foliage="maple_spray",
                     reach=reach)
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.5, flare_height=1.25, lobe_gain=0.6,
                                          lobe_height=1.05, seed=seed % 7)
    return tree


def hero_oak(seed, reach=-1.0, name="oak-hero"):
    """A squat, heavy-limbed oak whose crown spreads wider than it is tall."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 1.2
    fork = float(rng.uniform(4.4, 5.0))
    trunk_points = grow_curve(rng, [0.0, -0.45, 0.0], [0.05 * reach, 1.0, -0.03], fork + 0.45, 8, wander=0.04)
    trunk = tree.add_branch(trunk_points, radius, 0.9, 0, phase=float(rng.random()), flex=0.04, sides=20,
                            power=0.65)
    lobes = _add_roots(tree, trunk, radius, 7, reach=(2.8, 5.0), seed_azimuth=float(rng.uniform(0, math.tau)))
    tree.envelope = Envelope([0.9 * reach, 11.6, 0.0], [11.6, 7.0, 10.6], rng, lumpiness=0.2, flat_bottom=0.6)
    limbs = _leaders(tree, trunk, 7, (9.5, 12.5), (40, 70), 0.58, wander=0.12, sag=0.2, lift=0.26, kink=0.2,
                     clip=1.03, flex=0.17, upright=14.0)
    toward = 0.0 if reach > 0 else math.pi
    for height, azimuth, length, elevation in ((0.8, toward, 10.0, 20.0), (0.86, toward + 2.2, 7.6, 26.0)):
        origin, _, parent_radius = trunk.sample(height)
        points = grow_curve(rng, origin, _direction(90.0 - elevation, azimuth), length, 11, wander=0.1, sag=0.3,
                            lift=0.8, kink=0.18)
        points = tree.envelope.clip(points, 1.12)
        limbs.append(tree.add_branch(points, parent_radius * 0.5, 0.035, 1, parent=trunk, attach_t=height,
                                     flex=0.2, sides=10, power=0.9))
    _foliate(tree, limbs, (10, 14), (7, 11), 0.48, (1.1, 1.55), droop=0.2)
    tree.thin_sites(0.46)
    tree.meta = dict(species="oak", role="hero", height=18.5, trunkRadius=radius, foliage="oak_spray", reach=reach)
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.42, flare_height=1.0, lobe_gain=0.7,
                                          lobe_height=0.9, flute=0.05, seed=seed % 5)
    return tree


def grove_maple(seed, name="maple-grove", height=14.5, spread=1.0):
    """A full-crowned maple for the middle distance: clumped foliage on a clean branch frame."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.36
    fork = height * rng.uniform(0.26, 0.33)
    trunk_points = grow_curve(rng, [0.0, -0.3, 0.0], [rng.uniform(-0.06, 0.06), 1.0, rng.uniform(-0.05, 0.05)],
                              fork + 0.3, 7, wander=0.035)
    trunk = tree.add_branch(trunk_points, radius, 0.24, 0, phase=float(rng.random()), flex=0.1, sides=9,
                            power=0.8)
    lobes = [(float(rng.uniform(0, math.tau)), 0.4, 0.6) for _ in range(4)]
    crown_radius = height * 0.38 * spread
    tree.envelope = Envelope([0.0, fork + (height - fork) * 0.5, 0.0],
                             [crown_radius, (height - fork) * 0.58, crown_radius * 0.95], rng, lumpiness=0.2)
    limbs = _leaders(tree, trunk, int(rng.integers(5, 7)), ((height - fork) * 0.8, (height - fork) * 1.0),
                     (26, 60), 0.17, wander=0.09, lift=0.2, kink=0.1, clip=1.0, sides=6, flex=0.25, upright=6.0)
    for height_t in (0.7, 0.86):
        origin, _, parent_radius = trunk.sample(height_t)
        points = grow_curve(rng, origin, _direction(rng.uniform(58, 76), rng.uniform(0, math.tau)),
                            crown_radius * rng.uniform(0.85, 1.1), 8, wander=0.09, sag=0.3, lift=0.6)
        points = tree.envelope.clip(points, 1.08)
        limbs.append(tree.add_branch(points, parent_radius * 0.48, 0.018, 1, parent=trunk, attach_t=height_t,
                                     flex=0.28, sides=6, power=0.9))
    _foliate(tree, limbs, (6, 9), (3, 6), 0.62, (1.05, 1.5), hero=False, branch_length=(0.36, 0.6), droop=0.25)
    tree.thin_sites(0.6)
    tree.meta = dict(species="maple", role="grove", height=height, trunkRadius=radius, foliage="maple_clump")
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.45, flare_height=0.6, lobe_gain=0.35,
                                          lobe_height=0.5, flute=0.02, seed=seed % 9)
    return tree


def grove_birch(seed, name="birch-grove", height=16.5):
    """A silver birch: one slender white leader, ascending limbs, weeping golden strands."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.21
    lean = np.array([rng.uniform(-0.09, 0.09), 1.0, rng.uniform(-0.07, 0.07)])
    trunk_points = grow_curve(rng, [0.0, -0.3, 0.0], lean, height + 0.3, 14, wander=0.03, lift=0.12)
    trunk = tree.add_branch(trunk_points, radius, 0.02, 0, phase=float(rng.random()), flex=0.2, sides=9,
                            power=0.85)
    tree.envelope = Envelope([0.0, height * 0.66, 0.0], [height * 0.22, height * 0.4, height * 0.22], rng,
                             lumpiness=0.14, flat_bottom=0.9)
    limbs = []
    count = int(rng.integers(20, 27))
    start_azimuth = float(rng.uniform(0, math.tau))
    for index in range(count):
        t = 0.32 + 0.65 * (index + rng.uniform(0.1, 0.9)) / count
        origin, _, parent_radius = trunk.sample(t)
        azimuth = start_azimuth + index * 2.39996 + rng.uniform(-0.3, 0.3)
        length = height * (0.27 - 0.15 * t) * rng.uniform(0.85, 1.15)
        points = grow_curve(rng, origin, _direction(rng.uniform(34, 56), azimuth), length, 7, wander=0.08,
                            sag=0.75, lift=0.0)
        limbs.append(tree.add_branch(points, min(parent_radius * 0.5, 0.06), 0.008, 1, parent=trunk, attach_t=t,
                                     flex=0.4, sides=4, power=0.9))
    for limb in limbs:
        tree.add_sites(limb, max(3, int(round(limb.length / 0.42))), span=(0.25, 1.0), scale=(1.15, 1.75),
                       droop=1.5, spread=0.2, variants=2, jitter=0.14)
    tree.thin_sites(0.36)
    tree.meta = dict(species="birch", role="grove", height=height, trunkRadius=radius, foliage="birch_strand")
    tree.trunk_profile = buttress_profile(radius, [(0.0, 0.5, 0.4), (2.4, 0.5, 0.5), (4.4, 0.5, 0.4)], flare=0.3,
                                          flare_height=0.4, lobe_gain=0.2, lobe_height=0.3, flute=0.0, seed=1)
    return tree


RECIPES = {
    "maple-hero": lambda: hero_maple(7101, reach=1.0, name="maple-hero"),
    "oak-hero": lambda: hero_oak(4203, reach=-1.0, name="oak-hero"),
    "maple-grove-a": lambda: grove_maple(1107, name="maple-grove-a", height=14.5, spread=1.0),
    "maple-grove-b": lambda: grove_maple(2219, name="maple-grove-b", height=16.5, spread=0.9),
    "maple-grove-c": lambda: grove_maple(3323, name="maple-grove-c", height=12.0, spread=1.12),
    "birch-grove-a": lambda: grove_birch(5101, name="birch-grove-a", height=16.5),
    "birch-grove-b": lambda: grove_birch(5207, name="birch-grove-b", height=14.0),
}
