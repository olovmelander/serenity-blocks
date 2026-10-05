"""Tree recipes for the Sakura Twilight grove.

The growth primitives, the wood mesher and the scaffold helpers are the Fall grove's
(scripts/blender/fall_grove); this module only says what a cherry is: a short, leaning,
low-forking bole under a broad parasol (Somei-Yoshino), or arching ribs from which long
strands hang to the ground (shidare-zakura, the weeping cherry).
"""

import math

import numpy as np

from fall_grove.skeleton import UP, Envelope, Tree, grow_curve, normalize
# The scaffold helpers are private to the Fall recipes but are exactly what a cherry needs.
from fall_grove.species import _add_roots, _direction, _foliate, _leaders
from fall_grove.wood import buttress_profile


def hero_yoshino(seed, reach=-1.0, name="sakura-hero-spreading"):
    """An old Somei-Yoshino: a leaning, fissured bole and one long bough over the water."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.66
    fork = float(rng.uniform(3.6, 4.0))
    trunk_points = grow_curve(rng, [0.0, -0.4, 0.0], [0.22 * reach, 1.0, 0.06], fork + 0.4, 8, wander=0.07,
                              kink=0.2)
    trunk = tree.add_branch(trunk_points, radius, 0.5, 0, phase=float(rng.random()), flex=0.04, sides=16,
                            power=0.7)
    lobes = _add_roots(tree, trunk, radius, 5, reach=(1.6, 3.0), seed_azimuth=float(rng.uniform(0, math.tau)))
    tree.envelope = Envelope([1.4 * reach, 10.2, 0.2], [9.6, 4.6, 8.8], rng, lumpiness=0.2, flat_bottom=0.7)
    # Each scaffold limb is steered to its own place on the parasol, so none wanders down
    # across the trunk or into the view the tree is there to frame.
    limbs = []
    centre, radii = tree.envelope.centre, tree.envelope.radii
    start = float(rng.uniform(0, math.tau))
    for index in range(7):
        azimuth = start + index * math.tau / 7.0 + rng.uniform(-0.25, 0.25)
        attach = 1.0 - 0.04 * index
        origin, _, _ = trunk.sample(attach)
        outward = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        goal = centre + outward * radii * 0.86 + UP * radii[1] * (0.85 if index == 0 else 0.35)
        points = grow_curve(rng, origin - UP * 0.3, _direction(12.0 if index == 0 else rng.uniform(32, 58), azimuth),
                            rng.uniform(8.0, 11.0), 11, wander=0.1, lift=0.2, pull=goal, pull_gain=1.6, kink=0.2)
        points = tree.envelope.clip(points, 1.03)
        limbs.append(tree.add_branch(points, 0.36 * (1.0 - 0.06 * index), 0.035, 1, parent=trunk, attach_t=attach,
                                     flex=0.2, sides=10, power=0.9))
    # One long bough reaches level over the water toward the clearing.
    toward = 0.0 if reach > 0 else math.pi
    origin, _, parent_radius = trunk.sample(0.86)
    goal = origin + np.array([math.cos(toward) * 11.0, 2.6, 1.5])
    points = grow_curve(rng, origin, _direction(74.0, toward + 0.12), 11.0, 12, wander=0.08, sag=0.1, lift=0.25,
                        pull=goal, pull_gain=1.3, kink=0.16)
    limbs.append(tree.add_branch(points, parent_radius * 0.5, 0.03, 1, parent=trunk, attach_t=0.86, flex=0.22,
                                 sides=9, power=0.9))
    _foliate(tree, limbs, (10, 14), (7, 11), 0.36, (1.0, 1.4), droop=0.22, branch_sag=0.05, twig_sag=0.12)
    tree.thin_sites(0.34)
    tree.meta = dict(species="sakura", role="hero", habit="spreading", height=14.6, trunkRadius=radius,
                     foliage="blossom_spray", reach=reach)
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.45, flare_height=0.9, lobe_gain=0.6,
                                          lobe_height=0.8, flute=0.06, seed=seed % 7)
    return tree


def _hang_strands(tree, carriers, spacing, length, floor=(1.3, 2.6)):
    """Pendulous shoots: they leave a limb, give in to their own weight and hang."""
    rng = tree.rng
    strands = []
    for carrier in carriers:
        count = max(2, int(round(carrier.length / spacing)))
        for index in range(count):
            t = 0.28 + 0.72 * (index + rng.uniform(0.15, 0.85)) / count
            origin, tangent, parent_radius = carrier.sample(t)
            reach = min(origin[1] - rng.uniform(*floor), rng.uniform(*length))
            if reach < 1.0:
                continue
            heading = normalize(tangent * 0.45 + np.array([rng.normal() * 0.1, -0.9, rng.normal() * 0.1]))
            points = grow_curve(rng, origin, heading, reach, 8, wander=0.03, sag=1.3)
            strands.append(tree.add_branch(points, min(parent_radius * 0.45, 0.022), 0.004, 3, parent=carrier,
                                           attach_t=t, flex=0.85, sides=3, power=0.8))
    return strands


def hero_weeping(seed, reach=1.0, name="sakura-hero-weeping"):
    """A venerable weeping cherry: a cascade of blossom hanging from arching ribs."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.74
    fork = float(rng.uniform(4.2, 4.8))
    trunk_points = grow_curve(rng, [0.0, -0.4, 0.0], [-0.1 * reach, 1.0, 0.04], fork + 0.4, 8, wander=0.06,
                              kink=0.2)
    trunk = tree.add_branch(trunk_points, radius, 0.56, 0, phase=float(rng.random()), flex=0.04, sides=18,
                            power=0.7)
    lobes = _add_roots(tree, trunk, radius, 6, reach=(1.8, 3.4), seed_azimuth=float(rng.uniform(0, math.tau)))
    tree.envelope = Envelope([0.9 * reach, 10.6, 0.2], [9.4, 6.0, 8.8], rng, lumpiness=0.16, flat_bottom=1.3)
    limbs = _leaders(tree, trunk, 7, (7.5, 10.5), (24, 58), 0.4, wander=0.1, lift=0.14, kink=0.18, clip=1.0,
                     sides=10, flex=0.16, upright=10.0)
    ribs = []
    for limb in limbs:
        ribs.extend(tree.ramify(limb, 2, count=int(rng.integers(6, 9)), span=(0.3, 0.98), length=(0.38, 0.6),
                                angle=(42, 74), radius=0.5, tip_radius=0.02, wander=0.1, sag=1.1, lift=0.0,
                                steps=8, flex=0.35, sides=6, kink=0.1, taper_length=0.4, clip=1.2))
    strands = _hang_strands(tree, ribs + limbs, 0.5, (3.0, 7.6), floor=(1.2, 2.8))
    for strand in strands:
        tree.add_sites(strand, max(2, int(round(strand.length / 0.42))), span=(0.06, 1.0), scale=(0.95, 1.35),
                       droop=0.0, spread=0.12, variants=2, jitter=0.08)
    for rib in ribs:
        tree.add_sites(rib, max(2, int(round(rib.length / 0.6))), span=(0.3, 1.0), scale=(0.95, 1.3),
                       droop=0.9, spread=0.2, variants=2, jitter=0.12)
    tree.thin_sites(0.34)
    tree.meta = dict(species="sakura", role="hero", habit="weeping", height=16.4, trunkRadius=radius,
                     foliage="blossom_strand", reach=reach)
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.5, flare_height=1.0, lobe_gain=0.65,
                                          lobe_height=0.9, flute=0.07, seed=seed % 5)
    return tree


def grove_yoshino(seed, name="sakura-grove", height=9.5, spread=1.0):
    """A cherry for the middle distance: a low fork and a flat-topped parasol of pom-poms."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.3
    fork = height * rng.uniform(0.2, 0.27)
    trunk_points = grow_curve(rng, [0.0, -0.3, 0.0], [rng.uniform(-0.14, 0.14), 1.0, rng.uniform(-0.1, 0.1)],
                              fork + 0.3, 7, wander=0.05, kink=0.15)
    trunk = tree.add_branch(trunk_points, radius, 0.2, 0, phase=float(rng.random()), flex=0.08, sides=9,
                            power=0.8)
    lobes = [(float(rng.uniform(0, math.tau)), 0.4, 0.6) for _ in range(4)]
    crown_radius = height * 0.52 * spread
    crown_depth = height - fork
    tree.envelope = Envelope([0.0, fork + crown_depth * 0.56, 0.0],
                             [crown_radius, crown_depth * 0.5, crown_radius * 0.95], rng, lumpiness=0.22,
                             flat_bottom=0.5)
    limbs = _leaders(tree, trunk, int(rng.integers(5, 7)), (crown_depth * 0.85, crown_depth * 1.1), (34, 68),
                     0.15, wander=0.1, lift=0.22, kink=0.16, clip=1.0, sides=6, flex=0.25, upright=12.0)
    for height_t in (0.72, 0.88):
        origin, _, parent_radius = trunk.sample(height_t)
        points = grow_curve(rng, origin, _direction(rng.uniform(62, 80), rng.uniform(0, math.tau)),
                            crown_radius * rng.uniform(0.85, 1.1), 8, wander=0.09, sag=0.3, lift=0.5, kink=0.12)
        points = tree.envelope.clip(points, 1.08)
        limbs.append(tree.add_branch(points, parent_radius * 0.48, 0.018, 1, parent=trunk, attach_t=height_t,
                                     flex=0.28, sides=6, power=0.9))
    _foliate(tree, limbs, (6, 9), (4, 7), 0.44, (1.05, 1.5), hero=False, branch_length=(0.36, 0.6), droop=0.2,
             branch_sag=0.1, twig_sag=0.2)
    tree.thin_sites(0.42)
    tree.meta = dict(species="sakura", role="grove", habit="spreading", height=height, trunkRadius=radius,
                     foliage="blossom_clump")
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.45, flare_height=0.55, lobe_gain=0.35,
                                          lobe_height=0.45, flute=0.03, seed=seed % 9)
    return tree


def grove_weeping(seed, name="sakura-grove-weeping", height=8.5):
    """A young weeping cherry: a fountain of garlands for the shoreline."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.26
    fork = height * rng.uniform(0.34, 0.4)
    trunk_points = grow_curve(rng, [0.0, -0.3, 0.0], [rng.uniform(-0.1, 0.1), 1.0, rng.uniform(-0.08, 0.08)],
                              fork + 0.3, 7, wander=0.05, kink=0.12)
    trunk = tree.add_branch(trunk_points, radius, 0.18, 0, phase=float(rng.random()), flex=0.08, sides=9,
                            power=0.8)
    lobes = [(float(rng.uniform(0, math.tau)), 0.4, 0.6) for _ in range(4)]
    crown_radius = height * 0.5
    tree.envelope = Envelope([0.0, height * 0.62, 0.0], [crown_radius, height * 0.4, crown_radius * 0.95], rng,
                             lumpiness=0.16, flat_bottom=1.3)
    limbs = _leaders(tree, trunk, int(rng.integers(5, 7)), (height * 0.42, height * 0.56), (26, 60), 0.14,
                     wander=0.1, lift=0.1, kink=0.14, clip=1.0, sides=6, flex=0.2, upright=8.0)
    ribs = []
    for limb in limbs:
        ribs.extend(tree.ramify(limb, 2, count=int(rng.integers(3, 6)), span=(0.35, 0.98), length=(0.4, 0.62),
                                angle=(44, 74), radius=0.5, tip_radius=0.014, wander=0.1, sag=1.1, lift=0.0,
                                steps=7, flex=0.35, sides=4, taper_length=0.4, clip=1.2))
    strands = _hang_strands(tree, ribs + limbs, 0.8, (1.8, 4.2), floor=(0.9, 1.9))
    for strand in strands:
        tree.add_sites(strand, max(2, int(round(strand.length / 0.6))), span=(0.06, 1.0), scale=(1.2, 1.7),
                       droop=0.0, spread=0.12, variants=2, jitter=0.1)
    tree.thin_sites(0.5)
    tree.meta = dict(species="sakura", role="grove", habit="weeping", height=height, trunkRadius=radius,
                     foliage="blossom_strand")
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.4, flare_height=0.5, lobe_gain=0.3,
                                          lobe_height=0.4, flute=0.02, seed=seed % 9)
    return tree


RECIPES = {
    "sakura-hero-weeping": lambda: hero_weeping(8803, reach=1.0, name="sakura-hero-weeping"),
    "sakura-hero-spreading": lambda: hero_yoshino(6127, reach=-1.0, name="sakura-hero-spreading"),
    "sakura-grove-a": lambda: grove_yoshino(1409, name="sakura-grove-a", height=9.5, spread=1.0),
    "sakura-grove-b": lambda: grove_yoshino(2531, name="sakura-grove-b", height=11.0, spread=0.92),
    "sakura-grove-c": lambda: grove_yoshino(3643, name="sakura-grove-c", height=8.0, spread=1.14),
    "sakura-grove-weeping": lambda: grove_weeping(4759, name="sakura-grove-weeping", height=8.5),
}
