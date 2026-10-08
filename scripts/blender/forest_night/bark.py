"""Bark meshes for the firefly-night forest.

The tubes, UVs and the first three vertex-colour channels are the Fall grove's
(R = how far the wind may carry the vertex, G = the limb's phase, B = ambient occlusion,
baked afterwards). What differs here:

* an elder's trunk is meshed finely where the camera stands - 24 sides, a ring about every
  12 cm through the root flare - and coarsely up in the crown; a birch's white stem gets
  12 sides and a ring every 20 cm so it can carry its scars;
* a surface root is stood up into a ridge where it leaves the trunk;
* alpha is a species mask. Spruce: moss and lichen, heavier than the Golden Forest's and
  gathered on the tops of the roots. Pine: the Golden Forest mask unchanged (0 on grey
  plated bark, 1 on the thin orange bark above). Birch: 1 on dark bark - the rough black
  base, the scar under every limb, the brown twigs - and 0 on white bark.
"""

import math

import numpy as np

from fall_grove.skeleton import Branch
from fall_grove.wood import MeshData, catmull_refine, fbm, grid_normals, tube
from golden_forest import conifers

HERO_TRUNK_SIDES = 24
BIRCH_TRUNK_SIDES = 12


def refine_curve(points, radii, factors):
    """Catmull-Rom refinement with its own factor for every segment."""
    points = np.asarray(points, dtype=float)
    radii = np.asarray(radii, dtype=float)
    padded = np.vstack([points[0] * 2 - points[1], points, points[-1] * 2 - points[-2]])
    out_points = []
    out_radii = []
    for index in range(len(points) - 1):
        p0, p1, p2, p3 = padded[index], padded[index + 1], padded[index + 2], padded[index + 3]
        factor = int(factors[index])
        for step in range(factor):
            t = step / factor
            out_points.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                                     + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
            out_radii.append(radii[index] * (1 - t) + radii[index + 1] * t)
    out_points.append(points[-1])
    out_radii.append(radii[-1])
    return np.array(out_points), np.array(out_radii)


def dense_base(branch, levels):
    """A copy of a trunk with rings packed into its foot.

    `levels` is a list of (height, factor): a segment that starts below `height` is split
    into `factor` pieces; the last entry's factor applies to everything above.
    """
    factors = []
    for index in range(len(branch.points) - 1):
        low = branch.points[index][1]
        factor = levels[-1][1]
        for height, value in levels[:-1]:
            if low < height:
                factor = value
                break
        factors.append(factor)
    points, radii = refine_curve(branch.points, branch.radii, factors)
    return Branch(points, radii, branch.level, branch.parent, branch.attach_t, branch.phase, branch.sway0,
                  branch.flex, branch.sides, branch.kind)


def spruce_mask(height, seed, strength=1.0):
    """Moss and lichen on spruce bark.

    The Golden Forest's lichen mask (the shaded side, thinning with height) scaled by
    `strength`, plus a moss sock in patches: the lowest two metres of the trunk, and
    whatever faces the sky down there, which is the tops of the roots.
    """
    lichen = conifers.bark_mask("spruce", height, seed)

    def mask(positions, normals):
        fine = fbm(positions, 3.6, 2, seed + 5)
        patch = fbm(positions, 1.9, 3, seed + 9)
        foot = np.clip(1.0 - positions[:, 1] / 1.9, 0.0, 1.0)
        upward = np.clip((normals[:, 1] - 0.05) / 0.6, 0.0, 1.0)
        moss = np.clip(foot * 0.6 + upward * np.sqrt(foot) * 0.9, 0.0, 1.0) * np.clip((patch - 0.47) * 5.5, 0.0, 1.0)
        moss = moss * (0.7 + 0.6 * fine) * min(1.0, strength - 0.2)
        return np.clip(lichen(positions, normals) * strength + moss, 0.0, 1.0)
    return mask


def birch_mask(tree, seed):
    """1 on a birch's dark bark, 0 on the white.

    Returned as a function of (branch, positions, ring radii per vertex): the rough black
    foot, a chevron scar under every limb and under the limbs it has shed, and bark that
    darkens to brown as a stem thins to a twig.
    """
    rng = np.random.default_rng(seed)
    trunk = tree.branches[0]
    scars = []
    for branch in tree.branches:
        if branch.level == 1 and branch.parent is trunk:
            origin, _, _ = trunk.sample(branch.attach_t)
            outward = branch.points[min(2, len(branch.points) - 1)] - origin
            scars.append((origin, math.atan2(outward[2], outward[0]), 1.0))
    crown_start = min((scar[0][1] for scar in scars), default=tree.meta["height"] * 0.3)
    for _ in range(10):
        level = float(rng.uniform(1.4, max(1.6, crown_start)))
        origin, _, _ = trunk.sample((level + 0.3) / (tree.meta["height"] + 0.3))
        scars.append((origin, float(rng.uniform(0, math.tau)), float(rng.uniform(0.7, 1.0))))

    def mask(branch, positions, radii):
        noise = fbm(positions, 1.4, 3, seed)
        fine = fbm(positions * np.array([1.0, 6.0, 1.0]), 2.2, 2, seed + 3)
        thin = np.clip((0.05 - radii) / 0.03, 0.0, 1.0)
        dark = thin * thin * (3.0 - 2.0 * thin)
        if branch.level == 0:
            foot = np.clip(1.0 - (positions[:, 1] - 0.25) / (1.1 + 0.9 * noise), 0.0, 1.0)
            dark = np.maximum(dark, foot * foot * (3.0 - 2.0 * foot))
            for origin, scar_azimuth, strength in scars:
                local = np.arctan2(positions[:, 2] - origin[2], positions[:, 0] - origin[0])
                turn = np.arctan2(np.sin(local - scar_azimuth), np.cos(local - scar_azimuth))
                drop = origin[1] - positions[:, 1]
                # The scar hangs under the limb and spreads like a moustache as it falls.
                width = 0.42 + 1.3 * np.clip(drop, 0.0, 0.5)
                chevron = np.exp(-(turn / width) ** 2) * np.exp(-((drop - 0.12) / 0.24) ** 2)
                dark = np.maximum(dark, np.clip(strength * chevron * 1.4, 0.0, 1.0))
            # Lenticel bands: thin horizontal streaks the vertex spacing can only hint at.
            dark = np.maximum(dark, np.clip((fine - 0.64) * 3.0, 0.0, 0.35))
        return np.clip(dark, 0.0, 1.0)
    return mask


def ridge(positions, branch, refine, columns):
    """Stand a surface root's tube up into a ridge.

    Where the root leaves the trunk it is `branch.tall` times taller than it is wide; it
    rounds out along its length. Returns the moved positions and their normals.
    """
    rings = len(positions) // columns
    centres, _radii = catmull_refine(branch.points, branch.radii, refine)
    centres = np.repeat(centres, columns, axis=0)
    stretch = 1.0 + (branch.tall - 1.0) * (1.0 - np.linspace(0.0, 1.0, rings)) ** 2
    offset = positions - centres
    offset[:, 1] *= np.repeat(stretch, columns)
    moved = centres + offset
    return moved, grid_normals(moved, rings, columns)


def _ring_radii(rings, columns, radii):
    return np.repeat(np.asarray(radii, dtype=float), columns)[:rings * columns]


def build_wood(tree, hero=False, seed=3, lichen=1.0):
    """Mesh every branch into one bark mesh (limbs last, so a tier can stop at the trunk and roots)."""
    mesh = MeshData()
    species = tree.meta["species"]
    height = tree.meta["height"]
    birch = birch_mask(tree, seed) if species == "birch" else None
    if species == "spruce":
        mask = spruce_mask(height, seed, strength=lichen)
    elif species == "birch":
        mask = None
    else:
        mask = conifers.bark_mask(species, height, seed)
    ordered = sorted(tree.branches, key=lambda branch: branch.level >= 1 and branch.kind != "root")
    mesh.core_indices = 0
    for branch in ordered:
        profile = getattr(tree, "trunk_profile", None) if branch.level == 0 else None
        source = branch
        sides = None
        if branch.level == 0:
            if hero:
                source = dense_base(branch, [(1.3, 12), (3.2, 6), (9.0, 3), (math.inf, 2)])
                sides = HERO_TRUNK_SIDES
                refine = 1
            elif species == "birch":
                # The white stem is the whole point of a birch: enough vertices to carry its scars.
                sides = BIRCH_TRUNK_SIDES
                refine = 6
            else:
                refine = 2
        elif branch.kind == "root":
            refine = 2
        else:
            # A hero's limbs curve smoothly; the twigs up in its crown are too far away to tell.
            refine = int(getattr(branch, "detail", 2 if (hero and branch.level == 1) else 1))
        positions, normals, uvs, colors, indices = tube(source, sides=sides, refine=refine, profile=profile,
                                                        moss=mask)
        columns = (sides or source.sides) + 1
        rings = len(positions) // columns
        if getattr(branch, "tall", 1.0) != 1.0:
            positions, normals = ridge(positions, source, refine, columns)
            if mask is not None:
                colors[:, 3] = mask(positions, normals)
        if birch is not None:
            _points, radii = catmull_refine(source.points, source.radii, refine)
            colors[:, 3] = birch(branch, positions, _ring_radii(rings, columns, radii))
        mesh.append(positions, normals, uvs, colors, indices)
        if branch.level == 0 or branch.kind == "root":
            mesh.core_indices = mesh.triangles * 3
    return mesh
