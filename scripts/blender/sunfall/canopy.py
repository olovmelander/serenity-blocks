"""The jungle on the doline floor: where the crowns stand, and the crown shapes themselves.

Crowns are placed by dart throwing with a truncated power-law radius (many small crowns,
a few large ones), overlapping a little as rainforest crowns do, with light gaps where a
low-frequency field says the forest is open, and a few emergents standing clear of the
canopy. Each crown variant is a cauliflower: a squashed head of smoothly united sub-clumps,
polygonised from a distance field so the clumps meet in creases, not intersections.
"""

import numpy as np

from . import layout as L
from .field import floor_height
from .mesh import polygonise
from .noise import fbm3, smin

CROWN_VARIANTS = 6


def _inside_floor(x, z):
    c = L.CHAMBER
    cx, cz = c["center"]
    rx, rz = c["radii"]
    r = np.sqrt(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2)
    p = L.PASSAGE
    ax, az = p["a"]
    bx, bz = p["b"]
    abx, abz = bx - ax, bz - az
    s = np.clip(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0.0, 1.0)
    h = np.hypot(x - (ax + abx * s), z - (az + abz * s))
    in_passage = (h < 0.62 * (p["half_width"][0] + (p["half_width"][1] - p["half_width"][0]) * s)) & (s < 0.55)
    return (r < 0.9) | in_passage, r


def plan_canopy(seed=0x53554E46, count=7000, near_cut=95.0, log=print):
    """Return an (n, 8) float array: x, y_top, z, radius, height, variant, tone, kind."""
    rng = np.random.default_rng(seed & 0xFFFFFFFF)
    lo_r, hi_r, alpha = 3.4, 13.5, 2.1
    cell = 6.0
    grid = {}
    out = []
    xmin, xmax = -430.0, 360.0
    zmin, zmax = -930.0, -40.0
    attempts = 0
    while len(out) < count and attempts < count * 90:
        attempts += 1
        x = rng.uniform(xmin, xmax)
        z = rng.uniform(zmin, zmax)
        ok, r_plan = _inside_floor(np.array([x]), np.array([z]))
        if not ok[0]:
            continue
        if np.hypot(x, z) < near_cut:
            continue
        # Light gaps and the thinning toward the walls and the passage.
        openness = fbm3(np.array([x / 85.0]), np.array([0.0]), np.array([z / 85.0]), 3, seed=91)[0]
        edge = float(np.clip((r_plan[0] - 0.72) / 0.18, 0.0, 1.0))
        if openness < 0.36 or rng.random() < edge * 0.75:
            continue
        u = rng.random()
        radius = (lo_r ** (1 - alpha) + u * (hi_r ** (1 - alpha) - lo_r ** (1 - alpha))) ** (1.0 / (1 - alpha))
        kind = 1.0 if rng.random() < 0.035 else 0.0
        if kind:
            radius = rng.uniform(9.5, 15.0)
        ix, iz = int(np.floor(x / cell)), int(np.floor(z / cell))
        reach = int(np.ceil((radius + hi_r) / cell))
        blocked = False
        for dx in range(-reach, reach + 1):
            for dz in range(-reach, reach + 1):
                for j in grid.get((ix + dx, iz + dz), ()):
                    ox, oz, orr = out[j][0], out[j][2], out[j][3]
                    if np.hypot(ox - x, oz - z) < 0.64 * (orr + radius):
                        blocked = True
                        break
                if blocked:
                    break
            if blocked:
                break
        if blocked:
            continue
        ground = float(floor_height(np.array([x]), np.array([z]))[0])
        lo_h, hi_h = L.CANOPY["emergent_height"] if kind else L.CANOPY["tree_height"]
        size_bias = (radius - lo_r) / (hi_r - lo_r)
        height = lo_h + (hi_h - lo_h) * float(np.clip(0.35 * size_bias + 0.65 * rng.random(), 0.0, 1.0))
        variant = float(rng.integers(0, CROWN_VARIANTS))
        tone = rng.random()
        grid.setdefault((ix, iz), []).append(len(out))
        out.append([x, ground + height, z, radius, height, variant, tone, kind])
    log(f"[sunfall] canopy: {len(out)} crowns from {attempts} darts")
    return np.asarray(out, dtype=np.float64)


def crown_field(x, y, z, seed):
    """A unit crown: a squashed head of sub-clumps (top near y = 0, the head spans y in [-1, 0])."""
    rng = np.random.default_rng(1000 + seed)
    # Main head: an ellipsoid a little under the top.
    head = np.sqrt((x / 0.92) ** 2 + ((y + 0.48) / 0.48) ** 2 + (z / 0.92) ** 2) - 1.0
    phi = head * 0.45
    clumps = 9 + int(rng.integers(0, 6))
    for _ in range(clumps):
        a = rng.uniform(0.0, np.pi * 2.0)
        lift = rng.uniform(0.15, 0.95)
        rr = rng.uniform(0.32, 0.86)
        cx = np.cos(a) * rr
        cz = np.sin(a) * rr
        cy = -0.42 + lift * 0.34 * (1.0 - 0.55 * rr)
        rad = rng.uniform(0.26, 0.44) * (1.15 - 0.35 * rr)
        s = np.sqrt((x - cx) ** 2 + ((y - cy) / 0.82) ** 2 + (z - cz) ** 2) - rad
        phi = smin(phi, s, 0.09)
    # Leaf-mass lumps: crisp at this scale, the shader does the leaves.
    lumps = (fbm3(x * 7.0 + seed * 3.1, y * 7.0, z * 7.0, 3, seed=200 + seed) - 0.5) * 0.09
    phi = phi + lumps
    # Open the underside: crowns are dark and ragged below, never a closed ball.
    phi = np.maximum(phi, -(y + 0.82) * 0.6)
    return phi


def crown_mesh(seed, voxel=0.035):
    lo = np.array([-1.35, -1.05, -1.35])
    hi = np.array([1.35, 0.3, 1.35])
    dims = np.ceil((hi - lo) / voxel).astype(int) + 1
    xs = lo[0] + np.arange(dims[0]) * voxel
    ys = lo[1] + np.arange(dims[1]) * voxel
    zs = lo[2] + np.arange(dims[2]) * voxel
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    grid = crown_field(X, Y, Z, seed).astype(np.float32)
    # The field is negative inside the crown (solid): VDB normals then face out of it.
    points, faces = polygonise(grid, lo, voxel)
    top = points[:, 1].max()
    points[:, 1] -= top  # the crown's top at y = 0
    return points, faces
