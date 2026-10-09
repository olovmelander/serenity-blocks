"""Tree recipes for Verdant Hills: an old open-grown English oak and three field trees.

Built on the Fall grove's skeleton primitives (branches, sites, the bark tubes), but grown
the other way round. An open-grown oak is read by its foliage masses: billowing "clouds"
with dark clefts between them through which the limbs and the sky show. So a recipe first
places the masses (`Cloud`), then grows the scaffold that feeds them, and last lets
`Canopy` fill every mass with angular shoots and hang the sprays on their tips.

Bark vertex colour: R = how far the wind may carry the vertex, G = the limb's phase,
B = ambient occlusion (baked afterwards), A = moss and lichen: on the weather side of the
bole (`WEATHER_SIDE`, low down and in patches), on the buttress roots and along the upper
faces of the heavy limbs; 0 on thin wood.
"""

import math

import numpy as np

from fall_grove.skeleton import (GOLDEN, UP, Branch, Envelope, Site, Tree, normalize, perpendicular, sphere_directions,
                                 taper)
# The root helper is private to the Fall recipes but is exactly what an old bole needs.
from fall_grove.species import _add_roots
from fall_grove.wood import MeshData, buttress_profile, catmull_refine, fbm, tube

# The side the rain is driven onto: the wind of these downs blows toward +X, and the bole
# is seen from +Z, so the moss shows on the left flank and round onto the front.
WEATHER_SIDE = normalize(np.array([-0.8, 0.0, 0.6]))
HERO_FOLIAGE = "oak_spray"
FIELD_FOLIAGE = "oak_tuft"
# How far along a spray its middle lies, as a share of the site's scale.
SPRAY_MIDDLE = 0.46


def _smoothstep(low, high, value):
    t = np.clip((np.asarray(value, dtype=float) - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _polar(azimuth, reach, height):
    """A point `reach` metres from the tree's axis at `azimuth` (from +X toward +Z)."""
    return np.array([math.cos(azimuth) * reach, height, math.sin(azimuth) * reach])


def _branch(tree, points, radii, level, parent=None, attach_t=0.0, phase=None, flex=0.2, sides=6, kind="wood"):
    """Add a branch whose radius is given point by point (the skeleton's own taper is one curve)."""
    if phase is None:
        phase = parent.phase if (parent is not None and level >= 2) else float(tree.rng.random())
    sway0 = parent.sway_at(attach_t) if parent is not None else 0.0
    branch = Branch(points, radii, level, parent, attach_t, phase, sway0, flex, sides, kind)
    tree.branches.append(branch)
    return branch


def _at_height(branch, height):
    """The share of a climbing branch's length at which it reaches `height`."""
    low, high = 0.0, 1.0
    for _ in range(30):
        middle = (low + high) * 0.5
        if branch.sample(middle)[0][1] < height:
            low = middle
        else:
            high = middle
    return (low + high) * 0.5


def zigzag(rng, start, end, segments, throw=0.3, arch=0.0, vertical=0.45):
    """An angular path: every joint is thrown to the other side of the straight line.

    This is the habit of an oak: a shoot dies back at its tip and a side bud takes over, so
    a branch is a run of short straight pieces with an elbow between each. `throw` is the
    sideways step as a share of a piece's length, `arch` bows the whole path upward.
    """
    start = np.asarray(start, dtype=float)
    end = np.asarray(end, dtype=float)
    span = end - start
    length = float(np.linalg.norm(span))
    axis = span / max(length, 1e-9)
    side = np.cross(axis, UP)
    side = perpendicular(axis) if np.linalg.norm(side) < 0.2 else normalize(side)
    lift = np.cross(side, axis)
    piece = length / segments
    sign = 1.0 if rng.random() < 0.5 else -1.0
    points = [start.copy()]
    for index in range(1, segments):
        t = (index + float(rng.uniform(-0.2, 0.2))) / segments
        sideways = side * sign * throw * piece * float(rng.uniform(0.6, 1.3))
        upward = lift * (float(rng.normal()) * throw * vertical * piece + arch * length * math.sin(math.pi * t))
        points.append(start + span * t + sideways + upward)
        sign = -sign
    points.append(end.copy())
    return np.array(points)


def limb_path(rng, start, end, crest, steps=12, meander=0.45, waves=1.5):
    """A heavy scaffold limb: it rises steeply, arches over at `crest` and reaches out.

    The line is a cubic drawn in the vertical plane through its ends, then thrown from side
    to side in slow waves: old limbs are sinuous, never straight.
    """
    start = np.asarray(start, dtype=float)
    end = np.asarray(end, dtype=float)
    flat = np.array([end[0] - start[0], 0.0, end[2] - start[2]])
    reach = float(np.linalg.norm(flat))
    out = flat / max(reach, 1e-9)
    side = np.cross(UP, out)
    first = start + out * reach * 0.14 + UP * (crest - 1.7 - start[1])
    second = start + out * reach * 0.62 + UP * (crest + 1.7 - start[1])
    phase = float(rng.uniform(0, math.tau))
    points = []
    for index in range(steps + 1):
        t = index / steps
        u = 1.0 - t
        point = u ** 3 * start + 3 * u * u * t * first + 3 * u * t * t * second + t ** 3 * end
        weight = math.sin(math.pi * t) ** 0.7
        point = point + side * meander * math.sin(math.tau * waves * t + phase) * weight
        point = point + UP * meander * 0.3 * math.sin(math.tau * waves * 1.3 * t + phase * 1.7) * weight
        if 0 < index < steps:
            point = point + rng.normal(size=3) * 0.05
        points.append(point)
    return np.array(points)


# -- foliage masses -----------------------------------------------------------------------
class Cloud:
    """One mass of foliage: a lumpy ellipsoid with a flattened underside."""

    def __init__(self, centre, radii, seed, lumps=0.18, flat=0.62):
        self.centre = np.asarray(centre, dtype=float)
        self.radii = np.asarray(radii, dtype=float)
        self.seed = int(seed)
        self.lumps = lumps
        self.flat = flat

    def surface(self, direction, share=1.0):
        """The point of the mass in `direction` from its centre, `share` of the way to its skin."""
        direction = normalize(np.asarray(direction, dtype=float))
        noise = float(fbm((direction * 1.7 + self.seed * 0.37)[None, :], 1.0, 2, self.seed)[0])
        local = direction * self.radii * (1.0 + self.lumps * (2.0 * noise - 1.0)) * share
        if local[1] < 0.0:
            local[1] *= self.flat
        return self.centre + local

    def depth(self, point):
        """< 1 inside the mass, 1 on its skin, > 1 outside (the lumps are ignored)."""
        local = (np.asarray(point, dtype=float) - self.centre) / self.radii
        if local[1] < 0.0:
            local = local.copy()
            local[1] /= self.flat
        return float(np.linalg.norm(local))

    @property
    def area(self):
        a, b, c = self.radii
        return 4.0 * math.pi * (((a * b) ** 1.6 + (a * c) ** 1.6 + (b * c) ** 1.6) / 3.0) ** (1.0 / 1.6)


class Canopy:
    """The foliage of one tree as masses, and the shoots that carry each mass's sprays."""

    def __init__(self, tree, floor=0.0, heart=None, hollow=1.0):
        self.tree = tree
        self.floor = floor
        # An old crown is bare inside: of the sprays that would face its `heart`, only the
        # share `hollow` is hung (the masses close toward the sky, not toward the bole).
        self.heart = None if heart is None else np.asarray(heart, dtype=float)
        self.hollow = hollow
        self.masses = []

    def add(self, cloud, feeders, density=1.0):
        """`feeders` are (branch, from share, to share): the wood the mass's shoots leave from."""
        self.masses.append((cloud, list(feeders), density))
        return cloud

    def _targets(self, spacing, inner, underside):
        """Where the middles of the sprays go: on the skin of each mass and a layer inside it."""
        rng = self.tree.rng
        found = []
        clouds = [cloud for cloud, _feeders, _density in self.masses]
        for index, (cloud, _feeders, density) in enumerate(self.masses):
            gap = spacing / math.sqrt(density)
            count = int(cloud.area / (gap * gap) * 1.5)
            yaw = float(rng.uniform(0, math.tau))
            cosine, sine = math.cos(yaw), math.sin(yaw)
            inward = None
            if self.heart is not None and np.linalg.norm(self.heart - cloud.centre) > float(cloud.radii.max()) * 1.2:
                inward = normalize(self.heart - cloud.centre)
            for direction in sphere_directions(count):
                direction = np.array([direction[0] * cosine - direction[2] * sine, direction[1],
                                      direction[0] * sine + direction[2] * cosine])
                if direction[1] < -0.25 and rng.random() > underside:
                    continue
                if inward is not None and float(np.dot(direction, inward)) > 0.3 and rng.random() > self.hollow:
                    continue
                share = float(rng.uniform(0.5, 0.78)) if rng.random() < inner else float(rng.uniform(0.86, 1.0))
                point = cloud.surface(direction, share)
                if point[1] < self.floor:
                    continue
                # Nothing is hung deep inside a neighbouring mass, where it would never be seen.
                if any(other.depth(point) < 0.6 for other in clouds if other is not cloud):
                    continue
                found.append((index, point, direction, gap))
        # Poisson-style thinning across every mass, so overlapping masses do not double up.
        kept = []
        cells = {}
        for order in rng.permutation(len(found)):
            index, point, direction, gap = found[order]
            key = tuple(np.floor(point / spacing).astype(int))
            crowded = False
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for other in cells.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                            if np.linalg.norm(other - point) < gap:
                                crowded = True
            if not crowded:
                cells.setdefault(key, []).append(point)
                kept.append((index, point, direction))
        kept.sort(key=lambda item: item[0])          # a stable sort: mass by mass, in the thinned order
        return kept

    def grow(self, spacing, scale, shoots=7, gather=0.45, inner=0.3, underside=0.6, droop=0.12, facing=0.45,
             variants=2, shoot_sides=4, twig_sides=3, shoot_flex=0.2, twig_flex=0.26, twig_radius=0.02, max_level=6):
        """Fill every mass: shoots from its feeders, twigs from those, and a spray on each tip.

        A spray's site is the tip of the twig that carries it; the spray itself reaches
        forward from there, so its middle lands on the target that asked for it. Tips within
        `gather` metres are shared: two or three sprays fan out from one shoot end, as the
        leaves of an oak crowd at the end of each year's growth.
        """
        tree = self.tree
        rng = tree.rng
        targets = self._targets(spacing, inner, underside)
        twigs = 0
        for index, (cloud, feeders, _density) in enumerate(self.masses):
            wood_points = []
            wood_owner = []

            def offer(branch, low, high, step=0.3):
                count = max(2, int(branch.length * (high - low) / step) + 1)
                for t in np.linspace(low, high, count):
                    wood_points.append(branch.sample(float(t))[0])
                    wood_owner.append((branch, float(t)))

            for branch, low, high in feeders:
                offer(branch, low, high)
            # Shoots: a few angular branches from the feeding limb to the body of the mass.
            yaw = float(rng.uniform(0, math.tau))
            for direction in sphere_directions(shoots):
                direction = normalize(np.array([direction[0] * math.cos(yaw) - direction[2] * math.sin(yaw),
                                                direction[1] * 0.8 + 0.25,
                                                direction[0] * math.sin(yaw) + direction[2] * math.cos(yaw)]))
                goal = cloud.surface(direction, float(rng.uniform(0.42, 0.6)))
                distances = np.linalg.norm(np.array(wood_points) - goal, axis=1)
                nearest = int(np.argmin(distances))
                if distances[nearest] < 0.6:
                    continue
                parent, t = wood_owner[nearest]
                origin, _, parent_radius = parent.sample(t)
                pieces = 2 if distances[nearest] < 1.2 else (3 if distances[nearest] < 2.4 else 4)
                path = zigzag(rng, origin, goal, pieces, throw=0.32, arch=0.04)
                shoot = tree.add_branch(path, max(0.016, min(parent_radius * 0.5, 0.06)), 0.012,
                                        min(parent.level + 1, max_level), parent=parent, attach_t=t,
                                        flex=shoot_flex, sides=shoot_sides, power=0.9, kind="shoot")
                offer(shoot, 0.3, 1.0, 0.25)
            # Sprays, nearest the wood first, so the twigs grow outward and fork as they go.
            mine = [(point, direction) for owner, point, direction in targets if owner == index]
            planned = []
            for point, direction in mine:
                size = float(rng.uniform(*scale))
                outward = normalize(point - cloud.centre)
                radial = np.array([point[0], 0.0, point[2]])
                radial = radial / max(float(np.linalg.norm(radial)), 1e-6)
                swirl = float(rng.uniform(0, math.tau))
                # The lit side of a spray turns to the sky and, by `facing`, to the outside of
                # its mass: flat sprays are seen edge on from the side, shingled ones close the crown.
                skyward = normalize(np.array([outward[0], max(outward[1], 0.0), outward[2]]) + UP * 1e-3)
                top = UP * (1.0 - facing) + skyward * facing + rng.normal(size=3) * 0.12
                top[1] = max(top[1], 0.2)
                top = normalize(top)
                forward = (outward * 0.6 + radial * 0.3 + np.array([math.cos(swirl), 0.0, math.sin(swirl)]) * 0.4
                           - UP * droop * float(rng.uniform(0.0, 2.0)))
                forward = forward - top * float(np.dot(forward, top))
                if np.linalg.norm(forward) < 0.15:
                    forward = perpendicular(top)
                forward = normalize(forward)
                base = point - forward * SPRAY_MIDDLE * size
                planned.append((base, forward, top, size, point))
            if not planned:
                continue
            wood = np.array(wood_points)
            reach = np.array([float(np.min(np.linalg.norm(wood - base, axis=1))) for base, *_ in planned])
            tips = []
            for order in np.argsort(reach, kind="stable"):
                base, forward, top, size, point = planned[order]
                branch, t, position = None, 1.0, None
                if tips:
                    spans = np.linalg.norm(np.array([tip[0] for tip in tips]) - base, axis=1)
                    close = int(np.argmin(spans))
                    if spans[close] < gather:
                        position, branch, t = tips[close]
                        forward = normalize(forward * 0.5 + normalize(point - position) * 0.5)
                if branch is None:
                    wood = np.array(wood_points)
                    distances = np.linalg.norm(wood - base, axis=1)
                    nearest = int(np.argmin(distances))
                    parent, parent_t = wood_owner[nearest]
                    origin, _, parent_radius = parent.sample(parent_t)
                    if distances[nearest] < 0.2:
                        branch, t, position = parent, parent_t, origin
                    else:
                        pieces = 1 if distances[nearest] < 0.55 else (2 if distances[nearest] < 1.3 else 3)
                        path = zigzag(rng, origin, base, pieces, throw=0.36) if pieces > 1 else np.array([origin, base])
                        branch = tree.add_branch(path, max(0.009, min(parent_radius * 0.55, twig_radius)), 0.006,
                                                 min(parent.level + 1, max_level), parent=parent, attach_t=parent_t,
                                                 flex=twig_flex, sides=twig_sides, power=0.9, kind="twig")
                        twigs += 1
                        t, position = 1.0, base
                        offer(branch, 0.5, 1.0, 0.3)
                    tips.append((position, branch, t))
                tree.sites.append(Site(position, forward, top, size, branch.sway_at(t) + 0.08,
                                       (branch.phase + float(rng.uniform(-0.04, 0.04))) % 1.0,
                                       variant=int(rng.integers(0, variants)), hue=float(rng.random()),
                                       branch_level=branch.level))
        # Shuffled, so a tier that draws every other site (or only the first thousand) thins
        # the whole crown evenly instead of losing a mass.
        tree.sites = [tree.sites[order] for order in rng.permutation(len(tree.sites))]
        return twigs


# -- the hero: an old open-grown English oak ----------------------------------------------
BOUGH_SWING_REACH = 5.0       # the rope swing hangs this far out along the bough


def _old_bole(base, seed):
    """An old bole is never a column: burrs and hollows ride on the buttress profile."""
    def profile(azimuth, point, t):
        height = max(0.0, point[1])
        lump = (0.05 * math.sin(3.0 * azimuth + 1.1 * height + seed)
                * math.sin(0.8 * height + 2.0 * azimuth + seed * 0.7)
                + 0.03 * math.sin(7.0 * azimuth - 1.9 * height + seed * 1.9))
        fade = 1.0 / (1.0 + (height / 5.5) ** 4)          # the leader above the crown break is plain
        return base(azimuth, point, t) * (1.0 + lump * fade)
    return profile


def hero_oak(seed, name="oak-hero", height=15.5):
    """Quercus robur grown in the open for three centuries: wider than it is tall.

    A massive short bole breaks at about three metres into five heavy, sinuous limbs that
    rise, arch over and reach out; each forks again into an upright leader and spreading
    branches, and every one of those ends in a mass of foliage. One long low bough leaves
    the bole toward +X and runs out nearly level for ten metres, bare for most of its
    length, with foliage at its end.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    radius = 0.8                  # at breast height: a girth of five metres
    fork = 3.1
    # -- the bole, carried on as a leaning central leader ---------------------------------
    levels = np.array([-0.45, 0.3, 1.0, 1.7, 2.4, 3.05, 3.7, 4.5, 5.5, 6.6, 7.7, 8.8, 9.8, 10.8, 11.7, 12.5])
    climb = np.clip((levels - fork) / (levels[-1] - fork), 0.0, 1.0)
    phase = float(rng.uniform(0, math.tau))
    ease = np.minimum(1.0, climb * 4.0)
    points = np.stack([-0.7 * climb ** 1.2 + 0.55 * np.sin(climb * 5.6 + phase) * ease,
                       levels,
                       -0.5 * climb + 0.5 * np.sin(climb * 4.6 + phase * 1.6) * ease], axis=1)
    points[1:6, 0] += rng.normal(size=5) * 0.02
    points[1:6, 2] += rng.normal(size=5) * 0.02
    # The bole swells under the crown break, where the limbs part: they leave its shoulder, not its side.
    girth = np.interp(levels, [-0.45, 1.3, 2.2, 3.05, 3.6, 4.1, 4.6, 5.4, 8.0, 10.5, 12.5],
                      [0.78, 0.72, 0.75, 0.96, 0.9, 0.66, 0.46, 0.36, 0.22, 0.12, 0.04])
    # The scaffold is stored already curved (three points to a span): a shoot that leaves a
    # limb is then set on the limb's true axis, not on the chord between two of its joints.
    trunk = _branch(tree, *catmull_refine(points, girth, 3), 0, flex=0.14, sides=18, kind="trunk")
    lobes = _add_roots(tree, trunk, 0.78, 7, reach=(2.0, 3.4), seed_azimuth=float(rng.uniform(0, math.tau)))
    tree.envelope = Envelope([0.3, 7.2, 0.0], [11.3, height - 7.2, 10.6], rng, lumpiness=0.12, flat_bottom=0.45)
    canopy = Canopy(tree, floor=4.0, heart=(0.0, 7.5, 0.0), hollow=0.45)
    number = [seed]

    def cloud(centre, radii, lumps=0.2):
        number[0] += 7
        radii = np.asarray(radii, dtype=float) * float(rng.uniform(0.82, 0.98))
        return Cloud(centre, radii, number[0], lumps=lumps)

    def feeder(parent, t, goal, girth_share=0.62, pieces=7, arch=0.05, sides=7):
        origin, _, parent_radius = parent.sample(t)
        path = zigzag(rng, origin, goal, pieces, throw=0.3, arch=arch)
        thickness = taper(parent_radius * girth_share, 0.03, len(path), 0.85)
        return _branch(tree, *catmull_refine(path, thickness, 2), 2, parent=parent, attach_t=t, flex=0.16,
                       sides=sides, kind="fork")

    # The leader ends in the broad, low mass that crowns the dome.
    crown = cloud(trunk.points[-1] + np.array([0.3, 0.95, 0.2]), (3.7, 1.85, 3.6))
    canopy.add(crown, [(trunk, 0.8, 1.0)])
    # -- five sectors: a scaffold limb, its upright fork and its spreading branches -------
    starts = [2.35, 2.75, 2.5, 2.9, 2.6]
    for index, degrees in enumerate((50.0, 120.0, 192.0, 262.0, 314.0)):
        azimuth = math.radians(degrees + float(rng.uniform(-5.0, 5.0)))
        outward = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        outer = cloud(_polar(azimuth + float(rng.uniform(-0.06, 0.06)), float(rng.uniform(7.9, 8.5)),
                             float(rng.uniform(6.5, 7.0))), (2.7, 1.8, 2.7))
        attach = _at_height(trunk, starts[index])
        heart = trunk.sample(attach)[0]
        origin = heart + outward * 0.2
        end = outer.centre - outward * 0.9 - UP * outer.radii[1] * 0.3
        path = limb_path(rng, origin, end, crest=float(rng.uniform(7.0, 7.6)), meander=float(rng.uniform(0.4, 0.6)),
                         waves=float(rng.uniform(1.2, 1.8)))
        # The limb starts deep in the bole, so its foot is never seen, and swells into a collar where it leaves.
        path = np.concatenate([[heart + outward * 0.06 - UP * 0.6], path])
        base = 0.4 - 0.02 * index
        arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
        t = arc / arc[-1]
        thickness = (0.035 + (base - 0.035) * (1.0 - t) ** 0.85) * (1.0 + 0.18 * np.exp(-((arc - 1.0) / 0.55) ** 2))
        thickness[0] = base * 0.7
        limb = _branch(tree, *catmull_refine(path, thickness, 3), 1, parent=trunk, attach_t=attach, flex=0.12,
                       sides=10, kind="limb")
        canopy.add(outer, [(limb, 0.72, 1.0)])
        # The upright fork: it leaves the limb low and climbs to the upper ring of the dome.
        upper = cloud(_polar(azimuth + 0.5 + float(rng.uniform(-0.1, 0.1)), float(rng.uniform(4.7, 5.3)),
                             float(rng.uniform(11.8, 12.3))), (2.8, 1.85, 2.8))
        fork_limb = feeder(limb, float(rng.uniform(0.27, 0.33)), upper.centre - UP * upper.radii[1] * 0.45,
                           girth_share=0.66, pieces=8, arch=-0.03, sides=8)
        canopy.add(upper, [(fork_limb, 0.7, 1.0)])
        # The shoulder: over the gap between this limb's end and the last sector's flank.
        shoulder = cloud(_polar(azimuth - 0.3 + float(rng.uniform(-0.08, 0.08)), float(rng.uniform(6.9, 7.5)),
                                float(rng.uniform(9.3, 9.9))), (2.8, 1.9, 2.8))
        branch = feeder(limb, float(rng.uniform(0.42, 0.48)), shoulder.centre - UP * shoulder.radii[1] * 0.4,
                        pieces=6, arch=0.04)
        canopy.add(shoulder, [(branch, 0.6, 1.0)])
        # The flank: low and out, between this limb's end and the next one's. The last
        # sector has none: that is where the long bough reaches out under the crown.
        if index != 4:
            flank = cloud(_polar(azimuth + 0.62 + float(rng.uniform(-0.06, 0.06)), float(rng.uniform(7.2, 7.8)),
                                 float(rng.uniform(5.9, 6.4))), (2.55, 1.65, 2.55))
            branch = feeder(limb, float(rng.uniform(0.58, 0.66)), flank.centre - UP * flank.radii[1] * 0.25,
                            pieces=6, arch=0.06)
            canopy.add(flank, [(branch, 0.6, 1.0)])
    # -- the long low bough ----------------------------------------------------------------
    stations = np.array([0.05, 0.25, 1.0, 2.0, 3.2, 4.2, BOUGH_SWING_REACH, 5.9, 7.0, 8.1, 9.1, 9.8, 10.3])
    heights = np.array([2.3, 2.9, 3.78, 4.45, 4.82, 4.94, 4.95, 4.93, 5.0, 5.18, 5.45, 5.72, 5.95])
    bough_phase = float(rng.uniform(0, math.tau))
    ease = np.clip((stations - 0.25) / 2.5, 0.0, 1.0)
    wander = (0.42 * np.sin(stations * 0.62 + bough_phase) * ease
              + 0.12 * np.sin(stations * 1.9 + bough_phase * 2.3) * ease)
    path = np.stack([stations, heights + 0.05 * np.sin(stations * 1.4 + bough_phase) * ease, wander], axis=1)
    bough_girth = np.interp(stations, [0.05, 0.25, 1.0, 3.0, 5.0, 7.5, 9.5, 10.3],
                            [0.3, 0.34, 0.35, 0.27, 0.2, 0.14, 0.07, 0.03])
    bough = _branch(tree, *catmull_refine(path, bough_girth, 3), 1, parent=trunk, attach_t=_at_height(trunk, 2.9),
                    flex=0.2, sides=10,
                    kind="bough")
    swing_index = int(np.argmin(np.abs(stations - BOUGH_SWING_REACH)))
    tangent = normalize(path[swing_index + 1] - path[swing_index - 1])
    under = normalize(-UP + tangent * float(np.dot(UP, tangent)))
    swing = path[swing_index] + under * bough_girth[swing_index]
    tip_mass = cloud(path[-1] + np.array([-0.55, 0.3, 0.25]), (1.95, 1.25, 1.75), lumps=0.16)
    canopy.add(tip_mass, [(bough, 0.84, 1.0)], density=1.25)
    side_goal = bough.sample(0.7)[0] + np.array([0.3, 0.75, -1.5])
    side_mass = cloud(side_goal + np.array([0.0, 0.2, -0.2]), (1.8, 1.15, 1.6), lumps=0.16)
    side_branch = feeder(bough, 0.58, side_goal, girth_share=0.6, pieces=4, arch=0.05, sides=6)
    canopy.add(side_mass, [(side_branch, 0.35, 1.0), (bough, 0.64, 0.8)], density=1.25)
    twigs = canopy.grow(spacing=0.517, scale=(1.1, 1.65), shoots=7, gather=0.5, facing=0.5)
    positions = np.array([site.position for site in tree.sites])
    tree.meta = dict(species="oak", role="hero", height=height, trunkRadius=radius, foliage=HERO_FOLIAGE,
                     crownBase=float(positions[:, 1].min()), fork=fork, masses=len(canopy.masses), twigs=int(twigs),
                     weatherSide=[float(v) for v in WEATHER_SIDE],
                     anchors=dict(swing=[float(v) for v in swing], boughTip=[float(v) for v in path[-1]],
                                  swingLimbRadius=float(bough_girth[swing_index])))
    tree.trunk_profile = _old_bole(buttress_profile(radius, lobes, flare=0.5, flare_height=0.85, lobe_gain=0.7,
                                                    lobe_height=0.9, flute=0.06, seed=seed % 7), seed % 11)
    return tree


# -- the trees of the middle distance -----------------------------------------------------
def field_tree(seed, name, height, clear, radii, shift=(0.0, 0.0), lean=(0.0, 0.0), central=False, spacing=0.72,
               rise=0.0):
    """A field tree: a clear bole and one full, round crown (the lollipop of the old icon).

    No spray is hung below `clear` (its leaves reach a foot lower). `radii` are the
    half-width, half-height and half-depth of the crown, `shift` how far its middle stands
    off the bole (a wind-shaped crown), and `central` keeps one leader right through it (the
    habit of a lime). `rise` trims the crown up or down so the top of the foliage lands on
    `height`.
    """
    tree = Tree(name, seed)
    rng = tree.rng
    radius = round(0.1 + 0.019 * height, 4)
    # The sprays stand half a metre proud of the mass, and `height` is the top of the foliage.
    centre = np.array([shift[0], height - 0.45 - radii[1] + rise, shift[1]])
    crown = Cloud(centre, radii, seed, lumps=0.14, flat=0.9)
    low = centre[1] - radii[1] * crown.flat
    top = (height - 0.45 - radii[1] * 0.45 + rise) if central else (low + radii[1] * 0.5)
    steps = 9 if central else 6
    t = np.linspace(0.0, 1.0, steps + 1)
    drift = float(rng.uniform(0, math.tau))
    points = np.stack([lean[0] * top * t + shift[0] * t ** 2 * (0.9 if central else 0.35)
                       + 0.07 * np.sin(t * 4.0 + drift) * t,
                       -0.3 + (top + 0.3) * t,
                       lean[1] * top * t + shift[1] * t ** 2 * (0.9 if central else 0.35)
                       + 0.07 * np.sin(t * 3.3 + drift * 1.7) * t], axis=1)
    if central:
        girth = 0.03 + (radius - 0.03) * (1.0 - t) ** 0.8
    else:
        # The bole keeps its girth to the crown break and closes over where the leaders part.
        girth = radius * np.interp(t, [0.0, 0.8, 1.0], [1.0, 0.76, 0.4])
    trunk = _branch(tree, points, girth, 0, flex=0.16 if central else 0.08, sides=9, kind="trunk")
    tree.envelope = Envelope(centre, radii, rng, lumpiness=0.1, flat_bottom=crown.flat)
    canopy = Canopy(tree, floor=clear)
    feeders = [(trunk, 0.6 if central else 0.8, 1.0)]
    azimuth = float(rng.uniform(0, math.tau))
    if central:
        # Limbs leave the leader all the way up: long and level low down, short and steep at the top.
        count = 9
        for index in range(count):
            share = (index + float(rng.uniform(0.2, 0.8))) / count
            level = low + 0.4 + (top - low - 0.8) * share
            attach = _at_height(trunk, level)
            origin, _, parent_radius = trunk.sample(attach)
            azimuth += GOLDEN + float(rng.uniform(-0.3, 0.3))
            rise = 0.15 + 0.75 * share
            goal = crown.surface(np.array([math.cos(azimuth), rise, math.sin(azimuth)]), 0.6)
            path = zigzag(rng, origin, goal, 4, throw=0.24, arch=0.06)
            limb = tree.add_branch(path, min(parent_radius * 0.55, 0.11), 0.02, 1, parent=trunk, attach_t=attach,
                                   flex=0.24, sides=5, power=0.9, kind="limb")
            feeders.append((limb, 0.3, 1.0))
    else:
        # The bole breaks into a handful of leaders: one climbs, the rest spread into the globe.
        count = 6
        for index in range(count):
            azimuth += math.tau / (count - 1) + float(rng.uniform(-0.25, 0.25))
            rise = 1.0 if index == 0 else float(rng.uniform(0.05, 0.75))
            spread = 0.25 if index == 0 else 1.0
            goal = crown.surface(np.array([math.cos(azimuth) * spread, rise, math.sin(azimuth) * spread]), 0.62)
            attach = 1.0 - 0.05 * index
            origin = trunk.sample(attach)[0] - UP * 0.15
            path = zigzag(rng, origin, goal, 5, throw=0.22, arch=0.1 if index else 0.0)
            limb = tree.add_branch(path, radius * (0.52 - 0.03 * index), 0.02, 1, parent=trunk, attach_t=attach,
                                   flex=0.2, sides=6, power=0.85, kind="limb")
            feeders.append((limb, 0.3, 1.0))
    canopy.add(crown, feeders)
    twigs = canopy.grow(spacing=spacing, scale=(1.25, 1.9), shoots=12, gather=0.75, inner=0.35, underside=0.8,
                        droop=0.08, facing=0.8, twig_radius=0.016)
    positions = np.array([site.position for site in tree.sites])
    tree.meta = dict(species="oak", role="field", height=height, trunkRadius=radius, foliage=FIELD_FOLIAGE,
                     crownBase=float(positions[:, 1].min()), fork=float(top), masses=1, twigs=int(twigs),
                     weatherSide=[float(v) for v in WEATHER_SIDE], anchors={})
    lobes = [(float(rng.uniform(0, math.tau)), 0.42, 0.55) for _ in range(4)]
    tree.trunk_profile = buttress_profile(radius, lobes, flare=0.4, flare_height=0.5, lobe_gain=0.3, lobe_height=0.4,
                                          flute=0.015, seed=seed % 9)
    return tree


# -- bark ---------------------------------------------------------------------------------
def _moss(branch, positions, normals, ring_radius, seed, bole_height):
    """The oak's mask: moss and lichen where the rain is driven and where the water lies."""
    noise = fbm(positions, 0.8, 3, seed)
    fine = fbm(positions, 4.2, 2, seed + 7)
    patches = np.clip((noise - 0.3) * 3.0, 0.0, 1.0)
    # The bole's moss is painted by place, not by branch: it runs unbroken over the feet of
    # the limbs that leave it, and stops where the bole's height does.
    facing = np.clip(0.5 + 0.5 * (normals @ WEATHER_SIDE), 0.0, 1.0) ** 1.4
    low = np.clip(1.0 - positions[:, 1] / bole_height, 0.0, 1.0) ** 0.7
    cover = low * (0.2 + 0.8 * facing) * patches * _smoothstep(0.05, 0.12, ring_radius)
    upward = np.clip((normals[:, 1] - 0.3) / 0.55, 0.0, 1.0)
    heavy = _smoothstep(0.06, 0.15, ring_radius)
    cover = cover + upward * heavy * np.clip((noise - 0.36) * 3.2, 0.0, 1.0) * 0.9
    return np.clip(cover * (0.65 + 0.7 * fine), 0.0, 1.0)


def build_wood(tree, hero=False, seed=3):
    """Mesh every branch of an oak into one bark mesh.

    The scaffold comes first (bole, roots, limbs and the bough), so a low tier can stop
    drawing before the forks, shoots and twigs.
    """
    def core(branch):
        return branch.level <= 1 or branch.kind == "root"

    mesh = MeshData()
    mesh.core_indices = 0
    bole_height = 4.4 if hero else 2.2
    for branch in sorted(tree.branches, key=lambda item: not core(item)):
        # The old oak's bole, limbs and forks were curved when they were grown; only its roots
        # and a field tree's bole are rounded here.
        if hero:
            refine = 2 if branch.kind == "root" else 1
        else:
            refine = 2 if branch.level == 0 else 1
        profile = getattr(tree, "trunk_profile", None) if branch.level == 0 else None
        positions, normals, uvs, colors, indices = tube(branch, refine=refine, profile=profile)
        _, radii = catmull_refine(branch.points, branch.radii, refine)
        colors[:, 3] = _moss(branch, positions, normals, np.repeat(radii, branch.sides + 1), seed, bole_height)
        mesh.append(positions, normals, uvs, colors, indices)
        if core(branch):
            mesh.core_indices = mesh.triangles * 3
    return mesh


RECIPES = {
    "oak-hero": lambda: hero_oak(6101, "oak-hero"),
    # a: the round-crowned oak of the icon; b: squat, its crown blown toward +X; c: a tall oval (a lime's habit).
    "oak-field-a": lambda: field_tree(6211, "oak-field-a", height=12.0, clear=2.85, radii=(4.5, 4.55, 4.4), rise=-0.3),
    "oak-field-b": lambda: field_tree(6323, "oak-field-b", height=9.5, clear=2.1, radii=(4.3, 3.45, 3.9),
                                      shift=(0.75, 0.0), lean=(0.035, 0.0), spacing=0.67, rise=0.3),
    "oak-field-c": lambda: field_tree(6437, "oak-field-c", height=14.0, clear=2.8, radii=(3.7, 5.6, 3.6),
                                      central=True, rise=0.2),
}
