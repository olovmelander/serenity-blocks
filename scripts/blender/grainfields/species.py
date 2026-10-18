"""Tree recipes for Grainfields: Japanese white birch, Ezo spruce and Japanese larch.

Hokkaido grain country at harvest. Larch (karamatsu, Larix kaempferi) stands in the
shelterbelts between the fields, white birch (shirakaba, Betula platyphylla var.
japonica) along the farm roads and the river, and Ezo spruce (Picea jezoensis) in dark
spires among them. Every tree is a grove tree, seen from 90 m to 3 km and never close,
so the recipes spend their sites on the silhouette and keep the count modest: the theme
draws a couple of hundred of them.

Built on the Fall grove's skeleton primitives (scripts/blender/fall_grove), the Golden
Forest's conifer helpers (scripts/blender/golden_forest) and the Summer meadow's birch
wood and spruce (scripts/blender/summer_meadow); nothing in those folders is changed.

Bark vertex colour: R = how far the wind may carry the vertex, G = the limb's phase,
B = ambient occlusion (baked afterwards), A = a species mask:
  birch  - dark bark, as Summer's: 1 on thin limbs and twigs, on the rough black foot of
           the stem and in the chevron under each limb; 0 on the chalk-white stem.
  spruce - lichen, as the Golden Forest's: thicker low down and on the shaded side.
  larch  - 0 on the thick, plated grey-brown bark of the lower bole, rising to 1 on the
           thin, flaking red-brown bark of the upper stem and the limbs (the Golden
           Forest's pine mask).
"""

import math

import numpy as np

from fall_grove.skeleton import GOLDEN, UP, Envelope, Site, Tree, grow_curve, normalize
# The scaffold helpers are private to the Fall recipes but are exactly what these trees need.
from fall_grove.species import _direction
from fall_grove.wood import MeshData, buttress_profile, tube
from golden_forest import conifers
from summer_meadow import species as summer

BIRCH_FOLIAGE = "birch_sprig"
SPRUCE_FOLIAGE = "spruce_frond"
LARCH_FOLIAGE = "larch_tuft"


# -- Japanese white birch -----------------------------------------------------------------
def shirakaba(seed, name, height=15.0, stems=1, spread=1.0, lean=(0.0, 0.0), crown_start=(0.34, 0.42)):
    """A Japanese white birch: tall chalk-white stems under an airy, upright oval crown.

    Less weeping than the Summer meadow's silver birch: the limbs climb at a steeper angle
    and barely sag, the shoots are held out rather than hung, and the crown sits high on a
    long clean stem. `stems` > 1 grows a clump from one stool, as shirakaba often stands.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.13 + 0.005 * height
    heading = np.array([lean[0] + rng.uniform(-0.03, 0.03), 1.0, lean[1] + rng.uniform(-0.03, 0.03)])
    leaders = []
    if stems > 1:
        # The stems part just above the stool and climb side by side, leaning a little apart.
        fork = height * float(rng.uniform(0.05, 0.08))
        path = grow_curve(rng, [0.0, -0.3, 0.0], heading, fork + 0.3, 4, wander=0.02)
        trunk = tree.add_branch(path, radius, radius * 0.84, 0, phase=float(rng.random()), flex=0.04, sides=10,
                                power=0.8)
        azimuth = float(rng.uniform(0, math.tau))
        for index in range(stems):
            share = 1.0 - 0.12 * index
            direction = _direction(5.0 + 4.0 * index + float(rng.uniform(-1.5, 1.5)),
                                   azimuth + index * math.tau / stems + float(rng.uniform(-0.3, 0.3)))
            path = grow_curve(rng, trunk.points[-1] - UP * 0.2, direction, (height - fork) * share + 0.2, 13,
                              wander=0.025, lift=0.25)
            leaders.append(tree.add_branch(path, radius * (0.66 - 0.06 * index), 0.018, 1, parent=trunk,
                                           attach_t=1.0, flex=0.22, sides=8, power=0.85, kind="leader"))
    else:
        path = grow_curve(rng, [0.0, -0.3, 0.0], heading, height + 0.3, 14, wander=0.025, lift=0.12)
        trunk = tree.add_branch(path, radius, 0.018, 0, phase=float(rng.random()), flex=0.2, sides=9, power=0.85)
        leaders.append(trunk)
    start = float(rng.uniform(*crown_start))
    crown_radius = height * 0.22 * spread
    tree.envelope = Envelope([0.0, height * (0.38 + 0.6 * start), 0.0],
                             [crown_radius, height * (0.62 - 0.6 * start) * 1.05, crown_radius], rng,
                             lumpiness=0.16, flat_bottom=0.85)
    axis = trunk.points[-1] if stems > 1 else None
    limbs = []
    for stem in leaders:
        count = int(rng.integers(11, 14)) if stems > 1 else int(rng.integers(23, 27))
        azimuth = float(rng.uniform(0, math.tau))
        for index in range(count):
            t = start + (0.96 - start) * (index + float(rng.uniform(0.1, 0.9))) / count
            share = (t - start) / (0.96 - start)
            origin, _, parent_radius = stem.sample(t)
            azimuth += GOLDEN + float(rng.uniform(-0.3, 0.3))
            # Upright: the low limbs spread at forty-odd degrees, the high ones climb.
            direction = _direction(float(rng.uniform(34, 50)) - 14.0 * share, azimuth)
            if axis is not None:
                outward = np.array([origin[0] - axis[0], 0.0, origin[2] - axis[2]])
                if np.linalg.norm(outward) > 0.15:
                    direction = normalize(direction + normalize(outward) * 0.5)
            # An oval crown, widest a third of the way up it and drawn in at the top.
            length = (height * (0.11 + 0.13 * math.sin(math.pi * share ** 0.75)) * (1.0 - 0.3 * share) * spread
                      * float(rng.uniform(0.85, 1.15)))
            path = grow_curve(rng, origin, direction, max(length, 0.8), 6, wander=0.07, sag=0.28, lift=0.1)
            limbs.append(tree.add_branch(path, min(parent_radius * 0.45, 0.05), 0.008, 2, parent=stem, attach_t=t,
                                         phase=float(rng.random()), flex=0.4, sides=4, power=0.9))
    for carrier in limbs:
        ribs = tree.ramify(carrier, 3, count=int(rng.integers(2, 4)), span=(0.35, 0.9), length=(0.35, 0.55),
                           angle=(30, 55), radius=0.5, tip_radius=0.006, wander=0.1, sag=0.45, lift=0.1, steps=4,
                           flex=0.4, sides=3, taper_length=0.4, min_length=0.6, clip=1.3)
        tree.add_sites(carrier, max(2, int(round(carrier.length / 0.55))), span=(0.25, 1.0), scale=(1.3, 1.8),
                       droop=0.55, spread=0.3, variants=2, jitter=0.15)
        for rib in ribs:
            tree.add_sites(rib, max(1, int(round(rib.length / 0.55))), span=(0.35, 1.0), scale=(1.3, 1.8),
                           droop=0.55, spread=0.3, variants=2, jitter=0.15)
    for stem in leaders:
        tree.add_sites(stem, 2, span=(0.93, 1.0), scale=(1.0, 1.3), droop=0.2, spread=0.4, variants=2, jitter=0.12)
    tree.thin_sites(0.37)
    tree.meta = dict(species="birch", role="grove", height=height, trunkRadius=radius, foliage=BIRCH_FOLIAGE,
                     crownBase=float(min(carrier.points[0][1] for carrier in limbs)), stems=int(stems))
    tree.trunk_profile = buttress_profile(radius, [(0.0, 0.5, 0.4), (2.4, 0.5, 0.5), (4.4, 0.5, 0.4)], flare=0.28,
                                          flare_height=0.4, lobe_gain=0.2, lobe_height=0.3, flute=0.0, seed=seed % 5)
    return tree


# -- Ezo spruce ---------------------------------------------------------------------------
def ezo_spruce(seed, name, height=19.0, crown_base=0.14, spread=0.66, lean=(0.0, 0.0)):
    """An Ezo spruce: the Summer meadow's spruce drawn in to a narrow, dense, dark spire.

    Summer's recipe (after the Golden Forest's): whorls of limbs that droop a little and
    turn up at the tips, sprays and whorl spacing following the height, the Golden Forest's
    bough sections along every limb. Changed for Picea jezoensis: `spread` narrows the
    whorls, each whorl carries six limbs or so instead of five, the whorls sit a little
    closer and the sections are a little larger, so the spire closes up; the limbs droop
    less. `crown_base` is where the living crown starts, as a share of the height.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.1 + height * 0.0135
    heading = np.array([lean[0] + rng.uniform(-0.02, 0.02), 1.0, lean[1] + rng.uniform(-0.02, 0.02)])
    points = grow_curve(rng, [0.0, -0.45, 0.0], heading, height + 0.45, 16, wander=0.012, lift=0.12)
    trunk = tree.add_branch(points, radius, 0.02, 0, phase=float(rng.random()), flex=0.22, sides=8, power=0.92)
    stature = (height / 24.0) ** 0.7
    spacing = 0.88 * stature
    size = 2.45 * stature
    reach = height * 0.185 * spread
    start = crown_base * height
    whorls = max(4, int((height * 0.975 - start) / spacing))
    azimuth = float(rng.uniform(0, math.tau))
    for whorl in range(whorls):
        level = start + (whorl + float(rng.uniform(-0.25, 0.25))) * spacing
        t = (level + 0.45) / (height + 0.45)
        crown_t = whorl / max(1, whorls - 1)
        arms = 6 + int(rng.integers(-1, 2))
        for _ in range(arms):
            azimuth += GOLDEN + float(rng.uniform(-0.35, 0.35))
            origin, _, parent_radius = trunk.sample(t + float(rng.uniform(-0.004, 0.004)))
            length = (reach * (1.0 - crown_t) ** 0.78 + 0.45 * stature) * float(rng.uniform(0.78, 1.12))
            if crown_t < 0.18 and rng.random() < 0.35:
                length *= float(rng.uniform(0.4, 0.7))          # old limbs low down are broken short
            tilt = 106.0 - 48.0 * crown_t ** 0.85 + float(rng.uniform(-6, 6))
            limb_points = grow_curve(rng, origin, _direction(tilt, azimuth), length, 7, wander=0.045,
                                     sag=0.45 * (1.0 - crown_t) + 0.08, lift=0.6 + 0.25 * (1.0 - crown_t))
            limb = tree.add_branch(limb_points, min(parent_radius * 0.42, 0.05 + 0.012 * length), 0.006, 1,
                                   parent=trunk, attach_t=t, flex=0.5, sides=3, power=0.9)
            conifers._spruce_boughs(tree, limb, crown_t, size)
    # The leader: a spire of short upright shoots.
    for index in range(4):
        t = 1.0 - 0.014 * index
        point, tangent, _ = trunk.sample(t)
        outward = _direction(90.0, azimuth + index * GOLDEN)
        forward = normalize(tangent * (0.95 - 0.1 * index) + outward * (0.2 + 0.16 * index))
        tree.sites.append(Site(point - tangent * 0.2 * stature, forward, normalize(outward + UP * 0.3),
                               size * 0.34 * (1.0 + 0.2 * index), trunk.sway_at(t) + 0.1, trunk.phase,
                               variant=1, hue=float(rng.random()), branch_level=0))
    tree.envelope = Envelope([0.0, start + (height - start) * 0.45, 0.0],
                             [reach, (height - start) * 0.55, reach], rng, lumpiness=0.08)
    tree.meta = dict(species="spruce", role="grove", height=height, trunkRadius=radius, foliage=SPRUCE_FOLIAGE,
                     crownBase=start)
    lobes = [(float(rng.uniform(0, math.tau)), 0.45, 0.5) for _ in range(4)]
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.42, flare_height=0.8, lobe_gain=0.34,
                                          lobe_height=0.6, flute=0.02, seed=seed % 7)
    return tree


# -- Japanese larch -----------------------------------------------------------------------
def larch(seed, name, height=21.0, crown_base=0.3, spread=1.0, lean=(0.0, 0.0), tier=1.45):
    """A Japanese larch of the shelterbelts: one straight bole to the top, an open broad cone.

    The limbs leave the stem in loose tiers `tier` metres apart (scaled with the tree),
    near horizontal low down and rising under the spire, sag a little and turn up at
    their ends. Flat sprays of branchlets leave them sideways, in the limb's own plane,
    and carry the soft tufts of needles; between the tiers the sky shows through.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.06 + height * 0.0095
    heading = np.array([lean[0] + rng.uniform(-0.015, 0.015), 1.0, lean[1] + rng.uniform(-0.015, 0.015)])
    points = grow_curve(rng, [0.0, -0.45, 0.0], heading, height + 0.45, 16, wander=0.01, lift=0.1)
    trunk = tree.add_branch(points, radius, 0.02, 0, phase=float(rng.random()), flex=0.2, sides=8, power=0.9)
    stature = (height / 21.0) ** 0.7
    spacing = tier * stature
    reach = height * 0.2 * spread
    start = crown_base * height
    tiers = max(5, int((height * 0.95 - start) / spacing))
    # The hull is generous: it only steers where the sprays face and trims stray branchlets.
    tree.envelope = Envelope([0.0, start + (height - start) * 0.4, 0.0],
                             [reach * 1.15, (height - start) * 0.62, reach * 1.15], rng, lumpiness=0.1,
                             flat_bottom=0.7)
    azimuth = float(rng.uniform(0, math.tau))
    limbs = []
    for index in range(tiers):
        level = start + (index + float(rng.uniform(-0.2, 0.2))) * spacing
        t = (level + 0.45) / (height + 0.45)
        crown_t = index / max(1, tiers - 1)
        arms = 5 + int(rng.integers(-1, 2))
        for _ in range(arms):
            azimuth += GOLDEN + float(rng.uniform(-0.4, 0.4))
            origin, _, parent_radius = trunk.sample(t + float(rng.uniform(-0.006, 0.006)))
            # A broad cone: long limbs at the foot of the crown, short ones under the spire.
            length = (reach * (1.0 - crown_t) ** 0.95 + 0.5 * stature) * float(rng.uniform(0.8, 1.12))
            tilt = 94.0 - 32.0 * crown_t ** 1.3 + float(rng.uniform(-5, 5))
            path = grow_curve(rng, origin, _direction(tilt, azimuth), length, 7, wander=0.05,
                              sag=0.3 * (1.0 - crown_t) + 0.06, lift=0.5 + 0.2 * (1.0 - crown_t))
            limbs.append(tree.add_branch(path, min(parent_radius * 0.4, 0.04 + 0.012 * length), 0.008, 1,
                                         parent=trunk, attach_t=t, flex=0.45, sides=4, power=0.9))
    size = (1.55, 2.15)
    for limb in limbs:
        sprays = tree.ramify(limb, 2, count=max(1, int(round(limb.length / 0.6))), span=(0.15, 0.92),
                             length=(0.3, 0.5), angle=(52, 78), radius=0.5, tip_radius=0.006, wander=0.08,
                             sag=0.22, lift=0.18, steps=4, flex=0.45, sides=3, rise=(-0.15, 0.2), taper_length=0.5,
                             min_length=0.45, clip=1.35)
        for spray in sprays:
            tree.add_sites(spray, max(1, int(round(spray.length / 0.8))), span=(0.35, 1.0), scale=size, droop=0.06,
                           spread=0.25, variants=2, jitter=0.1)
        tree.add_sites(limb, max(1, int(round(limb.length * 0.45 / 0.8))), span=(0.6, 1.0), scale=size, droop=0.04,
                       spread=0.2, variants=2, jitter=0.1)
    # The leader: a few upright shoots on the spire.
    for index in range(3):
        t = 1.0 - 0.02 * index
        point, tangent, _ = trunk.sample(t)
        outward = _direction(90.0, azimuth + index * GOLDEN)
        forward = normalize(tangent * (0.9 - 0.15 * index) + outward * (0.25 + 0.2 * index))
        tree.sites.append(Site(point - tangent * 0.4 * stature, forward, normalize(outward + UP * 0.3),
                               size[0] * 0.75 * (1.0 + 0.15 * index), trunk.sway_at(t) + 0.1, trunk.phase,
                               variant=1, hue=float(rng.random()), branch_level=0))
    tree.thin_sites(0.55 * stature)
    tree.meta = dict(species="larch", role="grove", height=height, trunkRadius=radius, foliage=LARCH_FOLIAGE,
                     crownBase=start)
    lobes = [(float(rng.uniform(0, math.tau)), 0.45, 0.5) for _ in range(4)]
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.36, flare_height=0.7, lobe_gain=0.28,
                                          lobe_height=0.5, flute=0.025, seed=seed % 7)
    return tree


def build_larch_wood(tree, seed=3):
    """The larch's bark mesh: the stem first (the core a low tier stops at), then the limbs.

    The Golden Forest's conifer wood with its pine mask, which grades from plated lower
    bole to thin upper bark exactly as a larch's does.
    """
    mesh = MeshData()
    mask = conifers.bark_mask("pine", tree.meta["height"], seed)
    ordered = sorted(tree.branches, key=lambda branch: branch.level >= 1 and branch.kind != "root")
    mesh.core_indices = 0
    for branch in ordered:
        refine = 2 if branch.level == 0 else 1
        profile = getattr(tree, "trunk_profile", None) if branch.level == 0 else None
        mesh.append(*tube(branch, refine=refine, profile=profile, moss=mask))
        if branch.level == 0 or branch.kind == "root":
            mesh.core_indices = mesh.triangles * 3
    return mesh


def build_wood(tree, hero=False, seed=3):
    """One bark mesh for any tree of the fields (the core of the mesh comes first)."""
    species = tree.meta["species"]
    if species == "birch":
        return summer.build_birch_wood(tree, hero=hero, seed=seed)
    if species == "larch":
        return build_larch_wood(tree, seed=seed)
    return conifers.build_wood(tree, hero=hero, seed=seed)


RECIPES = {
    "birch-grove-a": lambda: shirakaba(12107, "birch-grove-a", height=15.0),
    "birch-grove-b": lambda: shirakaba(12241, "birch-grove-b", height=12.5, spread=1.1, lean=(0.05, -0.02),
                                       crown_start=(0.34, 0.4)),
    "birch-grove-c": lambda: shirakaba(12373, "birch-grove-c", height=17.0, stems=3, spread=0.95),
    "spruce-grove-a": lambda: ezo_spruce(12503, "spruce-grove-a", height=19.0, crown_base=0.17),
    "spruce-grove-b": lambda: ezo_spruce(12617, "spruce-grove-b", height=22.0, crown_base=0.21, spread=0.6),
    "spruce-grove-c": lambda: ezo_spruce(12739, "spruce-grove-c", height=16.0, crown_base=0.16, spread=0.72),
    "larch-grove-a": lambda: larch(12811, "larch-grove-a", height=21.0, crown_base=0.32),
    "larch-grove-b": lambda: larch(12937, "larch-grove-b", height=24.0, crown_base=0.38, spread=0.9),
    "larch-grove-c": lambda: larch(13049, "larch-grove-c", height=18.0, crown_base=0.28, spread=1.08,
                                   lean=(0.03, 0.01)),
}
