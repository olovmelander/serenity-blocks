"""Tree skeletons for the Fall grove: growth curves, branching and foliage sites.

Pure numpy (no bpy) so growth can be unit-reasoned and reused by the bake stage.
Coordinates are glTF/three.js space: metres, +Y up, the tree base at the origin.
"""

import math

import numpy as np

UP = np.array([0.0, 1.0, 0.0])
GOLDEN = math.radians(137.50776)


def normalize(vector):
    length = float(np.linalg.norm(vector))
    return vector / length if length > 1e-9 else np.array(vector, dtype=float)


def perpendicular(vector):
    """Any unit vector perpendicular to `vector`, stable for near-vertical input."""
    reference = np.array([1.0, 0.0, 0.0]) if abs(vector[1]) > 0.92 else UP
    return normalize(np.cross(vector, reference))


def rotate_about(vector, axis, angle):
    axis = normalize(axis)
    cosine, sine = math.cos(angle), math.sin(angle)
    return vector * cosine + np.cross(axis, vector) * sine + axis * float(np.dot(axis, vector)) * (1.0 - cosine)


class Branch:
    """A polyline with radii. `sway0`/`flex` describe how far the wind may carry it."""

    def __init__(self, points, radii, level, parent=None, attach_t=0.0, phase=0.0, sway0=0.0, flex=0.3,
                 sides=6, kind="wood"):
        self.points = np.asarray(points, dtype=float)
        self.radii = np.asarray(radii, dtype=float)
        self.level = level
        self.parent = parent
        self.attach_t = attach_t
        self.phase = phase
        self.sway0 = sway0
        self.flex = flex
        self.sides = sides
        self.kind = kind
        segments = np.linalg.norm(np.diff(self.points, axis=0), axis=1)
        self.arc = np.concatenate([[0.0], np.cumsum(segments)])
        self.length = float(self.arc[-1])

    def sample(self, t):
        """Point, unit tangent and radius at normalised arc position t."""
        distance = min(max(t, 0.0), 1.0) * self.length
        index = int(np.searchsorted(self.arc, distance, side="right") - 1)
        index = min(max(index, 0), len(self.points) - 2)
        span = self.arc[index + 1] - self.arc[index]
        local = 0.0 if span < 1e-9 else (distance - self.arc[index]) / span
        point = self.points[index] * (1.0 - local) + self.points[index + 1] * local
        tangent = normalize(self.points[index + 1] - self.points[index])
        radius = self.radii[index] * (1.0 - local) + self.radii[index + 1] * local
        return point, tangent, float(radius)

    def sway_at(self, t):
        return self.sway0 + self.flex * (min(max(t, 0.0), 1.0) ** 1.35)


class Site:
    """A place where one foliage spray attaches."""

    __slots__ = ("position", "forward", "top", "scale", "sway", "phase", "variant", "hue", "branch_level")

    def __init__(self, position, forward, top, scale, sway, phase, variant=0, hue=0.5, branch_level=3):
        self.position = np.asarray(position, dtype=float)
        self.forward = normalize(np.asarray(forward, dtype=float))
        self.top = normalize(np.asarray(top, dtype=float))
        self.scale = float(scale)
        self.sway = float(sway)
        self.phase = float(phase)
        self.variant = int(variant)
        self.hue = float(hue)
        self.branch_level = int(branch_level)


class Envelope:
    """Irregular crown hull: an ellipsoid whose radius is modulated around the trunk."""

    def __init__(self, centre, radii, rng, lumpiness=0.16, flat_bottom=0.55):
        self.centre = np.asarray(centre, dtype=float)
        self.radii = np.asarray(radii, dtype=float)
        self.flat_bottom = flat_bottom
        self.terms = [(int(rng.integers(2, 6)), float(rng.uniform(0, math.tau)), float(rng.uniform(0.4, 1.0)) * lumpiness)
                      for _ in range(3)]

    def depth(self, point):
        """< 1 inside the hull, 1 on it, > 1 outside."""
        local = (np.asarray(point, dtype=float) - self.centre) / self.radii
        if local[1] < 0:
            local = local.copy()
            local[1] /= self.flat_bottom
        azimuth = math.atan2(local[2], local[0])
        lump = 1.0 + sum(amount * math.sin(count * azimuth + offset + local[1] * 1.7)
                         for count, offset, amount in self.terms)
        return float(np.linalg.norm(local)) / lump

    def clip(self, points, slack=1.0, keep=3):
        """Cut a growth path where it leaves the hull (limbs may start below the crown)."""
        entered = False
        for index in range(len(points)):
            outside = self.depth(points[index]) > slack
            if not outside:
                entered = True
            elif entered:
                return points[:max(keep, index)]
        return points


def grow_curve(rng, start, direction, length, steps, wander=0.1, sag=0.0, lift=0.0, pull=None, pull_gain=0.0,
               kink=0.0):
    """A wandering growth path. `sag` droops the middle, `lift` turns the tip to the light."""
    position = np.asarray(start, dtype=float).copy()
    heading = normalize(np.asarray(direction, dtype=float))
    drift = np.zeros(3)
    points = [position.copy()]
    step = length / steps
    for index in range(1, steps + 1):
        t = index / steps
        drift = drift * 0.68 + rng.normal(size=3) * 0.32
        heading = heading + drift * wander
        horizontal = math.hypot(heading[0], heading[2])
        heading[1] -= sag * horizontal * math.sin(math.pi * min(1.0, t * 1.1)) * 3.0 / steps
        heading[1] += lift * t * t * 3.0 / steps
        if pull is not None:
            heading = heading + normalize(np.asarray(pull, dtype=float) - position) * pull_gain / steps
        if kink > 0.0 and rng.random() < kink:
            heading = heading + rng.normal(size=3) * 0.32
        heading = normalize(heading)
        position = position + heading * step
        points.append(position.copy())
    return np.array(points)


def taper(base, tip, count, power=1.0):
    t = np.linspace(0.0, 1.0, count)
    return tip + (base - tip) * (1.0 - t) ** power


class Tree:
    """Accumulates branches and foliage sites for one specimen."""

    def __init__(self, name, seed):
        self.name = name
        self.rng = np.random.default_rng(seed)
        self.branches = []
        self.sites = []
        self.envelope = None
        self.meta = {}

    # -- wood ---------------------------------------------------------------------------
    def add_branch(self, points, base_radius, tip_radius, level, parent=None, attach_t=0.0, phase=None,
                   flex=0.3, sides=6, power=1.0, kind="wood"):
        points = np.asarray(points, dtype=float)
        if phase is None:
            phase = parent.phase if (parent is not None and level >= 2) else float(self.rng.random())
        sway0 = parent.sway_at(attach_t) if parent is not None else 0.0
        branch = Branch(points, taper(base_radius, tip_radius, len(points), power), level, parent, attach_t,
                        phase, sway0, flex, sides, kind)
        self.branches.append(branch)
        return branch

    def child_direction(self, parent, t, down_angle, azimuth=None, side=1.0, rise=0.2):
        """Direction for a child leaving `parent` at t.

        Upright parents spiral their children by `azimuth`; leaning parents spread them
        sideways in a plane (plagiotropic growth) with `rise` lifting them to the light.
        """
        _, tangent, _ = parent.sample(t)
        if abs(tangent[1]) > 0.8 and azimuth is not None:
            lateral = rotate_about(perpendicular(tangent), tangent, azimuth)
        else:
            sideways = normalize(np.cross(UP, tangent)) * side
            upward = normalize(np.cross(tangent, np.cross(UP, tangent)))
            lateral = normalize(sideways * math.cos(rise) + upward * math.sin(rise))
        return normalize(tangent * math.cos(down_angle) + lateral * math.sin(down_angle))

    def ramify(self, parent, level, count, span=(0.3, 0.97), length=(0.3, 0.5), angle=(40, 62), radius=0.55,
               tip_radius=0.012, wander=0.14, sag=0.1, lift=0.35, steps=7, flex=0.28, sides=5, rise=(-0.1, 0.6),
               taper_length=0.55, min_length=0.35, power=1.0, clip=1.05, kink=0.0):
        """Spawn `count` children along `parent`; lengths fade toward the parent tip."""
        rng = self.rng
        children = []
        start_azimuth = float(rng.uniform(0, math.tau))
        for index in range(count):
            t = span[0] + (span[1] - span[0]) * ((index + rng.uniform(0.15, 0.85)) / count)
            origin, _, parent_radius = parent.sample(t)
            side = 1.0 if index % 2 == 0 else -1.0
            direction = self.child_direction(parent, t, math.radians(rng.uniform(*angle)),
                                             azimuth=start_azimuth + index * GOLDEN, side=side,
                                             rise=float(rng.uniform(*rise)))
            reach = parent.length * rng.uniform(*length) * (1.0 - taper_length * t)
            reach = max(min_length, reach)
            points = grow_curve(rng, origin, direction, reach, steps, wander=wander, sag=sag, lift=lift, kink=kink)
            if self.envelope is not None:
                points = self.envelope.clip(points, slack=clip)
            if len(points) < 3:
                continue
            base = min(parent_radius * radius, parent_radius * 0.92)
            children.append(self.add_branch(points, base, tip_radius, level, parent, t, flex=flex, sides=sides,
                                            power=power))
        return children

    # -- foliage ------------------------------------------------------------------------
    def crown_centre(self):
        if self.envelope is not None:
            return self.envelope.centre
        if self.sites:
            return np.mean([site.position for site in self.sites], axis=0)
        return np.array([0.0, 8.0, 0.0])

    def add_sites(self, branch, count, span=(0.35, 1.0), scale=(0.9, 1.25), droop=0.35, spread=0.25,
                  variants=2, tip=True, jitter=0.18):
        rng = self.rng
        centre = self.crown_centre()
        positions = [span[0] + (span[1] - span[0]) * ((index + rng.uniform(0.2, 0.8)) / max(1, count))
                     for index in range(count)]
        if tip:
            positions.append(1.0)
        for t in positions:
            point, tangent, _ = branch.sample(t)
            outward = normalize(point - centre)
            side = normalize(np.cross(tangent, UP) + rng.normal(size=3) * 0.2)
            forward = normalize(tangent * (1.0 - spread) + outward * spread * 0.6
                                + side * rng.uniform(-spread, spread) - UP * droop * rng.uniform(0.4, 1.0))
            top = normalize(UP * 0.85 + outward * 0.4 + rng.normal(size=3) * 0.18)
            offset = (side * rng.uniform(-1, 1) + UP * rng.uniform(-0.6, 0.6)) * jitter
            self.sites.append(Site(point + offset, forward, top, rng.uniform(*scale), branch.sway_at(t) + 0.08,
                                   (branch.phase + rng.uniform(-0.04, 0.04)) % 1.0,
                                   variant=int(rng.integers(0, variants)), hue=float(rng.random()),
                                   branch_level=branch.level))

    def thin_sites(self, spacing):
        """Poisson-style thinning so sprays do not stack inside each other."""
        kept = []
        cells = {}
        order = self.rng.permutation(len(self.sites))
        for index in order:
            site = self.sites[index]
            key = tuple(np.floor(site.position / spacing).astype(int))
            crowded = False
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for other in cells.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                            if np.linalg.norm(other.position - site.position) < spacing:
                                crowded = True
                                break
                        if crowded:
                            break
                    if crowded:
                        break
                if crowded:
                    break
            if not crowded:
                cells.setdefault(key, []).append(site)
                kept.append(site)
        self.sites = kept
        return len(kept)

    def bounds(self):
        points = np.concatenate([branch.points for branch in self.branches]
                                + ([np.array([site.position for site in self.sites])] if self.sites else []))
        return points.min(axis=0), points.max(axis=0)


def sphere_directions(count):
    """Even directions on the unit sphere (Fibonacci lattice)."""
    index = np.arange(count) + 0.5
    polar = np.arccos(1.0 - 2.0 * index / count)
    azimuth = math.pi * (1.0 + 5.0 ** 0.5) * index
    return np.stack([np.sin(polar) * np.cos(azimuth), np.cos(polar), np.sin(polar) * np.sin(azimuth)], axis=1)


def foliage_visibility(positions, radius, opacity=0.42, directions=96, reach=14.0):
    """Sky visibility and bent normal for each foliage site.

    Every spray is treated as a soft sphere; a ray leaving one site loses `opacity` of its
    light for each other sphere it passes through. Returns (sky visibility 0..1, bent normal).
    """
    positions = np.asarray(positions, dtype=np.float64)
    count = len(positions)
    rays = sphere_directions(directions)
    delta = positions[None, :, :] - positions[:, None, :]          # i -> j
    distance_sq = np.einsum("ijk,ijk->ij", delta, delta)
    transmittance = np.ones((count, len(rays)))
    log_keep = math.log(max(1e-6, 1.0 - opacity))
    for ray_index, ray in enumerate(rays):
        along = delta @ ray                                          # (i, j)
        perpendicular_sq = distance_sq - along * along
        hit = (along > radius * 0.35) & (along < reach) & (perpendicular_sq < radius * radius)
        transmittance[:, ray_index] = np.exp(log_keep * hit.sum(axis=1))
    upper = rays[:, 1] > 0.0
    weight = np.clip(rays[upper, 1], 0.0, 1.0) + 0.25
    sky = (transmittance[:, upper] * weight).sum(axis=1) / weight.sum()
    bent = transmittance @ rays
    lengths = np.linalg.norm(bent, axis=1, keepdims=True)
    bent = np.where(lengths > 1e-6, bent / np.maximum(lengths, 1e-6), np.array([0.0, 1.0, 0.0]))
    return sky, bent
