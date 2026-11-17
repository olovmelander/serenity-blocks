"""Tree recipes for the High Coast: the old pine on the summit and the forest's pines and spruces.

The old pine is a Scots pine as the High Coast grows them on bare granite, two or three
centuries old: a stout bole that leans out toward the light and kinks where it once lost its
leader, plated grey-brown bark low down and thin orange bark above, heavy limbs that leave the
trunk nearly level, wander, and turn up at their ends under flat-topped clouds of needles, and
the silver stubs and one bare limb of what the crown outgrew. It is authored in the frame the
theme stands it in: +X is the view's right (out over the coast), +Z is toward the eye, the rock
is y = 0. The lens holds its lower eleven metres, so the bole, the lowest limbs and the
underside of the crown are what the picture is made of.

The forest's trees are the Golden Forest's conifer recipes grown from other seeds at the sizes
the coast's forest has; they are only ever seen as sprites (preview.bake_sprites).
"""

import math

import numpy as np

from fall_grove.skeleton import GOLDEN, UP, Branch, Envelope, Tree, grow_curve, normalize
from fall_grove.species import _direction
from fall_grove.wood import MeshData, buttress_profile, catmull_refine, fbm, tube
from golden_forest import conifers

# ── The old pine ─────────────────────────────────────────────────────────────────────

# The bole's centre line: out toward the view, a kink at the old break, and on up.
OLD_TRUNK = [
    (0.0, -0.55, 0.0), (0.06, 0.6, 0.0), (0.16, 2.0, -0.03), (0.36, 3.6, -0.1), (0.66, 5.1, -0.22),
    (0.98, 6.5, -0.4), (1.12, 7.7, -0.56), (1.2, 8.7, -0.62), (1.52, 9.8, -0.6), (1.98, 11.0, -0.48),
    (2.36, 12.2, -0.36), (2.6, 13.3, -0.3), (2.72, 14.3, -0.3),
]
OLD_HEIGHT = 14.3
# Living limbs: height on the bole, azimuth (0 = the view's right, 90 = toward the eye), tilt
# from the vertical, length, radius at the bole, sag, lift.
OLD_LIMBS = [
    (7.1, -10.0, 81.0, 9.6, 0.175, 0.16, 0.8),        # the great limb, out over the coast
    (7.55, 158.0, 79.0, 5.6, 0.120, 0.16, 0.72),      # its fellow, out of the frame's left
    (8.05, 48.0, 77.0, 6.0, 0.130, 0.14, 0.74),       # toward the eye and right
    (8.6, -64.0, 75.0, 6.2, 0.120, 0.12, 0.72),       # away over the drop
    (9.2, 16.0, 73.0, 6.6, 0.125, 0.12, 0.72),
    (9.95, 212.0, 70.0, 5.0, 0.105, 0.1, 0.7),
    (10.45, 104.0, 68.0, 4.8, 0.100, 0.1, 0.7),
    (10.9, -34.0, 64.0, 5.6, 0.105, 0.08, 0.68),
    (11.4, 150.0, 60.0, 4.2, 0.090, 0.08, 0.66),
    (11.9, 62.0, 58.0, 4.4, 0.090, 0.06, 0.64),
    (12.4, -88.0, 54.0, 4.0, 0.080, 0.05, 0.6),
    (12.85, 236.0, 50.0, 3.4, 0.070, 0.04, 0.58),
    (13.3, 10.0, 46.0, 3.2, 0.066, 0.03, 0.55),
    (13.65, 126.0, 40.0, 2.7, 0.060, 0.02, 0.5),
]
# Dead wood: height, azimuth, tilt, length, radius, forks.
OLD_DEAD = [
    (5.55, 32.0, 84.0, 3.3, 0.1, 3),                  # the bare limb
    (6.45, 128.0, 92.0, 1.5, 0.06, 1),
    (4.25, 202.0, 96.0, 1.05, 0.058, 0),
    (3.1, -42.0, 84.0, 0.7, 0.055, 0),
    (2.25, 104.0, 88.0, 0.42, 0.05, 0),
    (4.9, -100.0, 90.0, 0.6, 0.05, 0),
]
# Where the plated bark gives way to the orange (metres up the bole).
OLD_BARK_TURN = (5.2, 9.0)


def _bole_radius(height):
    """An old bole: nearly a column under the crown, then each limb takes its share."""
    if height < 7.0:
        return 0.445 - 0.014 * max(0.0, height)
    share = min(1.0, (height - 7.0) / (OLD_HEIGHT - 7.0))
    return 0.062 + (0.347 - 0.062) * (1.0 - share) ** 0.85


def _t_at_height(branch, height):
    """Normalised arc position where `branch` passes `height`."""
    points = branch.points
    for index in range(len(points) - 1):
        low, high = points[index][1], points[index + 1][1]
        if low <= height <= high and high > low:
            local = (height - low) / (high - low)
            return float((branch.arc[index] + local * (branch.arc[index + 1] - branch.arc[index])) / branch.length)
    return 1.0


def _rock_roots(tree, trunk, radius, count, seed_azimuth):
    """Roots that grip the bare rock: they leave the flare and run out over the granite."""
    rng = tree.rng
    lobes = []
    for index in range(count):
        azimuth = seed_azimuth + math.tau * (index + float(rng.uniform(-0.3, 0.3))) / count
        strength = float(rng.uniform(0.62, 1.0))
        lobes.append((azimuth, float(rng.uniform(0.2, 0.32)), strength))
        outward = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        length = float(rng.uniform(0.95, 1.9)) * (0.6 + 0.5 * strength)
        points = grow_curve(rng, outward * radius * 0.5 + UP * 0.5, outward + UP * -0.1, length, 9, wander=0.3,
                            kink=0.25)
        t = np.linspace(0.0, 1.0, len(points))
        # High on the flare, then down onto the rock and along it, sinking only at the very end.
        points[:, 1] = 0.52 * (1.0 - t) ** 1.9 + 0.06 - 0.16 * t ** 3 + 0.025 * np.sin(t * 8.0 + index * 1.7)
        tree.add_branch(points, radius * 0.56 * strength, 0.035, 1, parent=trunk, attach_t=0.0, phase=0.0,
                        flex=0.0, sides=8, power=1.25, kind="root")
    return lobes


def _clothe(tree, limb, scale, spacing, branches=(9, 13), twigs=(5, 9)):
    """Branch a limb twice and stand spray sites along the ends: the clouds of an old pine.

    The side branches fan out level from the limb's outer two thirds and turn up, their twigs
    do the same, and the sprays stand along the twigs: a wide plate, flat beneath, domed above.
    """
    rng = tree.rng
    made = tree.ramify(limb, 2, count=int(rng.integers(*branches)), span=(0.24, 0.98), length=(0.3, 0.5),
                       angle=(42, 76), radius=0.46, tip_radius=0.012, wander=0.15, sag=0.03, lift=0.6, steps=7,
                       flex=0.35, sides=5, rise=(0.0, 0.7), kink=0.18, min_length=1.0, clip=1.6,
                       taper_length=0.42)
    tree.add_sites(limb, max(3, int(round(limb.length * 0.3 / spacing))), span=(0.7, 1.0), scale=scale,
                   droop=-0.5, spread=0.5, variants=2, jitter=0.22)
    for branch in made:
        ends = tree.ramify(branch, 3, count=int(rng.integers(*twigs)), span=(0.22, 0.97), length=(0.34, 0.6),
                           angle=(34, 70), radius=0.5, tip_radius=0.007, wander=0.17, sag=0.0, lift=0.55, steps=4,
                           flex=0.35, sides=3, rise=(0.05, 0.9), min_length=0.55, clip=1.7, taper_length=0.3)
        tree.add_sites(branch, max(2, int(round(branch.length * 0.6 / spacing))), span=(0.4, 1.0), scale=scale,
                       droop=-0.5, spread=0.5, variants=2, jitter=0.22)
        for twig in ends:
            tree.add_sites(twig, max(1, int(round(twig.length / spacing))), span=(0.3, 1.0), scale=scale,
                           droop=-0.5, spread=0.45, variants=2, jitter=0.16)
    return made


def old_pine(seed=20117, name="pine-old"):
    """The old pine on the summit knoll."""
    tree = Tree(name, seed)
    rng = tree.rng
    control = np.array(OLD_TRUNK, dtype=float)
    points, _ = catmull_refine(control, np.ones(len(control)), 2)
    trunk = tree.add_branch(points, 0.44, 0.062, 0, phase=float(rng.random()), flex=0.1, sides=18, power=0.7)
    trunk.radii = np.array([_bole_radius(float(point[1])) for point in points])
    lobes = _rock_roots(tree, trunk, 0.44, 6, seed_azimuth=float(rng.uniform(0, math.tau)))
    # The crown's hull only steers growth here (no limb is cut by it): it is wide and flat.
    tree.envelope = Envelope([1.7, 11.2, -0.3], [10.5, 5.2, 8.0], rng, lumpiness=0.12, flat_bottom=0.85)
    scale = (1.1, 1.55)
    spacing = 0.24
    for height, azimuth, tilt, length, radius, sag, lift in OLD_LIMBS:
        t = _t_at_height(trunk, height)
        origin, _, parent_radius = trunk.sample(t)
        heading = _direction(tilt, math.radians(azimuth))
        # A limb holds its course out from the bole (the pull) and only turns up toward its end.
        path = grow_curve(rng, origin, heading, length, 12, wander=0.13, sag=sag, lift=lift * 0.5, kink=0.3,
                          pull=origin + heading * length * 1.5 + UP * 0.8, pull_gain=1.6)
        limb = tree.add_branch(path, min(radius, parent_radius * 0.62), 0.03, 1, parent=trunk, attach_t=t,
                               flex=0.3, sides=10, power=0.8)
        # The lowest limbs are the ones the lens holds: they carry the fullest plates.
        low = height < 9.4
        _clothe(tree, limb, scale, spacing, branches=(12, 16) if low else (9, 13), twigs=(6, 10) if low else (5, 9))
    # The leader's own cloud.
    tree.add_sites(trunk, 9, span=(0.95, 1.0), scale=scale, droop=-0.6, spread=0.6, variants=2, jitter=0.5)
    tree.thin_sites(0.24)
    for height, azimuth, tilt, length, radius, forks in OLD_DEAD:
        t = _t_at_height(trunk, height)
        origin, _, parent_radius = trunk.sample(t)
        path = grow_curve(rng, origin, _direction(tilt, math.radians(azimuth)), length, 6 if length > 1.2 else 3,
                          wander=0.16, sag=0.12, lift=0.3, kink=0.3)
        dead = tree.add_branch(path, min(radius, parent_radius * 0.3), 0.016, 1, parent=trunk, attach_t=t,
                               flex=0.04, sides=7, power=0.7, kind="stub")
        for fork in range(forks):
            at = 0.45 + 0.4 * (fork + float(rng.uniform(0.2, 0.8))) / max(1, forks)
            start, tangent, fork_radius = dead.sample(at)
            side = normalize(np.cross(tangent, UP)) * (1.0 if fork % 2 == 0 else -1.0)
            prong = grow_curve(rng, start, normalize(tangent * 0.6 + side * 0.7 + UP * float(rng.uniform(0.1, 0.5))),
                               float(rng.uniform(0.5, 0.95)), 4, wander=0.2, lift=0.3, kink=0.3)
            tree.add_branch(prong, fork_radius * 0.6, 0.008, 2, parent=dead, attach_t=at, flex=0.04, sides=5,
                            kind="stub")
    # The bole's centre line and radius, for the shadow the theme lays on the summit.
    line = []
    for share in np.linspace(0.04, 1.0, 16):
        point, _, radius = trunk.sample(float(share))
        line.append([round(float(point[0]), 3), round(float(point[1]), 3), round(float(point[2]), 3),
                     round(radius, 3)])
    tree.meta = dict(species="pine", role="hero", height=OLD_HEIGHT, trunkRadius=0.44, foliage="pine_shoots",
                     crownBase=7.0, trunkLine=line)
    tree.trunk_profile = buttress_profile(0.44, lobes, flare=0.4, flare_height=0.5, lobe_gain=0.5,
                                          lobe_height=0.45, flute=0.03, seed=seed % 5)
    return tree


def old_bark_mask(seed):
    """Vertex-colour alpha for the old pine: 0 the plated bark of the bole, 1 the orange above."""
    low, high = OLD_BARK_TURN

    def mask(positions, _normals):
        noise = fbm(positions, 0.8, 3, seed)
        rise = np.clip((positions[:, 1] - low) / (high - low), 0.0, 1.0)
        return np.clip(rise * rise * (3.0 - 2.0 * rise) + (noise - 0.5) * 0.4 * np.sin(rise * math.pi), 0.0, 1.0)
    return mask


def _spare(branch):
    """A twig meshed from every other point of its path (its ends kept): half the rings."""
    keep = sorted(set(range(0, len(branch.points), 2)) | {len(branch.points) - 1})
    return Branch(branch.points[keep], branch.radii[keep], branch.level, branch.parent, branch.attach_t,
                  branch.phase, branch.sway0, branch.flex, branch.sides, branch.kind)


def build_old_wood(tree, seed=3):
    """The old pine's bark mesh: the bole and roots first, then the limbs, their branches and last
    the twigs (`level_indices`: where each ends in the index buffer, so a tier may stop early);
    `wood` carries what the theme needs besides (x = dead silver wood, y = how far the vertex
    follows the rock)."""
    mesh = MeshData()
    mask = old_bark_mask(seed)
    flags = []

    def rank(branch):
        return 0 if (branch.level == 0 or branch.kind == "root") else branch.level

    ordered = sorted(tree.branches, key=rank)
    mesh.core_indices = 0
    mesh.level_indices = [0, 0, 0, 0]
    for branch in ordered:
        if branch.level == 0:
            refine = 3
        elif branch.level == 1:
            refine = 2
        else:
            refine = 1
        profile = tree.trunk_profile if branch.level == 0 else None
        arrays = tube(_spare(branch) if branch.level >= 3 else branch, refine=refine, profile=profile, moss=mask)
        mesh.append(*arrays)
        positions = arrays[0]
        count = len(positions)
        dead = np.full(count, 1.0 if branch.kind == "stub" else 0.0)
        if branch.kind == "root":
            follow = np.ones(count)
        elif branch.level == 0:
            follow = np.clip(1.0 - (positions[:, 1] - 0.1) / 0.9, 0.0, 1.0)
        else:
            follow = np.zeros(count)
        flags.append(np.stack([dead, follow], axis=1))
        if branch.level == 0 or branch.kind == "root":
            mesh.core_indices = mesh.triangles * 3
        for level in range(min(rank(branch), 3), 4):
            mesh.level_indices[level] = mesh.triangles * 3
    mesh.wood = np.concatenate(flags)
    return mesh


# ── The forest ───────────────────────────────────────────────────────────────────────

def coast_pine(seed, name, height, crown=0.56, lean=(0.0, 0.0), spread=1.0):
    """A forest pine of the coast: a straight bare bole, orange above, under a dense rounded crown."""
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.1 + height * 0.012
    points = grow_curve(rng, [0.0, -0.45, 0.0], [lean[0], 1.0, lean[1]], height * 0.95 + 0.45, 16, wander=0.012,
                        lift=0.25)
    trunk = tree.add_branch(points, radius, 0.07, 0, phase=float(rng.random()), flex=0.16, sides=8, power=0.75)
    top = points[-1]
    crown_radius = height * 0.2 * spread
    tree.envelope = Envelope([top[0], height * (crown + (1.0 - crown) * 0.55), top[2]],
                             [crown_radius * 1.15, height * (1.0 - crown) * 0.6, crown_radius * 1.15], rng,
                             lumpiness=0.22, flat_bottom=0.75)
    scale = (2.0, 2.8)
    count = int(rng.integers(12, 16))
    start = float(rng.uniform(0, math.tau))
    for index in range(count):
        rise = (index + float(rng.uniform(0.1, 0.9))) / count
        t = crown + (0.97 - crown) * rise
        origin, _, parent_radius = trunk.sample(t)
        heading = _direction(float(rng.uniform(68, 86)) - 36.0 * rise,
                             start + index * GOLDEN + float(rng.uniform(-0.4, 0.4)))
        length = crown_radius * float(rng.uniform(0.85, 1.2)) * (1.1 - 0.55 * rise)
        path = grow_curve(rng, origin, heading, length, 8, wander=0.12, sag=0.12, lift=0.3, kink=0.2,
                          pull=origin + heading * length * 1.5 + UP * 0.6, pull_gain=1.4)
        limb = tree.add_branch(path, parent_radius * 0.5, 0.02, 1, parent=trunk, attach_t=t, flex=0.3, sides=5,
                               power=0.85)
        _clothe(tree, limb, scale, 0.5, branches=(6, 9), twigs=(3, 6))
    tree.add_sites(trunk, 6, span=(0.94, 1.0), scale=scale, droop=-0.6, spread=0.6, variants=2, jitter=0.6)
    tree.thin_sites(0.42)
    for _ in range(int(rng.integers(2, 5))):
        t = float(rng.uniform(0.3, crown - 0.03))
        origin, _, parent_radius = trunk.sample(t)
        stub = grow_curve(rng, origin, _direction(float(rng.uniform(70, 96)), float(rng.uniform(0, math.tau))),
                          float(rng.uniform(0.5, 1.5)), 3, wander=0.1)
        tree.add_branch(stub, parent_radius * 0.22, 0.012, 1, parent=trunk, attach_t=t, flex=0.05, sides=4,
                        kind="stub")
    tree.meta = dict(species="pine", role="grove", height=height, trunkRadius=radius, foliage="pine_bough",
                     crownBase=crown * height)
    lobes = [(float(rng.uniform(0, math.tau)), 0.45, 0.5) for _ in range(4)]
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.3, flare_height=0.6, lobe_gain=0.25,
                                          lobe_height=0.5, flute=0.02, seed=seed % 5)
    return tree


def coast_spruce(seed, name, height, crown_base, spread):
    tree = conifers.spruce(seed, name, height=height, role="grove", crown_base=crown_base, spread=spread)
    tree.meta["foliage"] = "spruce_bough"
    return tree


def build_wood(tree, hero=False, seed=3):
    """One bark mesh for any tree of the coast (the core of the mesh comes first)."""
    if tree.meta["role"] == "hero":
        return build_old_wood(tree, seed=seed)
    return conifers.build_wood(tree, hero=False, seed=seed)


RECIPES = {
    "pine-old": lambda: old_pine(),
    "pine-coast-a": lambda: coast_pine(21011, "pine-coast-a", height=17.5, crown=0.56, lean=(0.04, 0.02)),
    "pine-coast-b": lambda: coast_pine(21143, "pine-coast-b", height=13.5, crown=0.44, lean=(-0.07, 0.03),
                                       spread=1.25),
    "pine-coast-c": lambda: coast_pine(21269, "pine-coast-c", height=20.5, crown=0.62, lean=(0.02, -0.03),
                                       spread=0.9),
    "pine-coast-d": lambda: coast_pine(21377, "pine-coast-d", height=15.5, crown=0.5, lean=(0.1, -0.02),
                                       spread=1.1),
    "spruce-coast-a": lambda: coast_spruce(21383, "spruce-coast-a", height=21.0, crown_base=0.1, spread=0.92),
    "spruce-coast-b": lambda: coast_spruce(21491, "spruce-coast-b", height=16.5, crown_base=0.06, spread=1.08),
    "spruce-coast-c": lambda: coast_spruce(21587, "spruce-coast-c", height=24.0, crown_base=0.16, spread=0.8),
}
