"""The foreground: a dry rimstone terrace descending from the near wall to a lip over the void.

Rimstone dams (gours) grow along the contour lines of a sloping flowstone floor: water that
once flowed down it deposited calcite where it spilled, so each pool is held by a raised,
scalloped rim at its downhill edge. Here the floor is the eye's own ledge (the eye stands a
few metres above it); its lip curves away from the eye at the frame's corners, so the gours
fill the bottom corners while the middle (behind the board) opens onto the void.
"""

import numpy as np

from .noise import fbm3, smoothstep

LEDGE_DOMAIN = {"x": (-62.0, 62.0), "z": (14.0, -60.0)}
STEP = 0.95          # metres of drop per pool
RIM = 0.30           # how far a dam's lip stands above the pool behind it


def lip_z(x):
    """Where the terrace ends (its z) along x: near the eye in the middle, far at the corners."""
    reach = np.maximum(-8.0 - 0.045 * x * x, -21.0)
    return reach + (fbm3(x / 9.0, x * 0.0, x * 0.0 + 3.0, 2, seed=301) - 0.5) * 6.0


def ledge_height(x, z):
    """Height of the terrace (and the cliff below its lip) at (x, z)."""
    base = -6.5 + 0.17 * z + 0.004 * x * x + (fbm3(x / 26.0, z * 0.0, z / 26.0, 2, seed=302) - 0.5) * 2.4
    warp = (fbm3(x / 7.5, z * 0.0, z / 7.5, 3, seed=303) - 0.5) * 2.6
    s = -base / STEP + warp
    k = np.floor(s)
    f = s - k
    pool = -k * STEP - f * STEP * 0.12
    rim = RIM * smoothstep(0.80, 0.94, f) * (1.0 - smoothstep(0.955, 0.995, f))
    spill = -STEP * smoothstep(0.955, 0.998, f)
    y = pool + rim + spill
    # Fine relief: popcorn calcite and dry crusts.
    y = y + (fbm3(x / 1.3, z * 0.0, z / 1.3, 3, seed=304) - 0.5) * 0.12
    lz = lip_z(x)
    beyond = np.clip(np.maximum(lz - z, np.abs(x) - 42.0), 0.0, None)
    cliff = -beyond * 9.0 - (fbm3(x / 4.0, z / 6.0, z * 0.0, 2, seed=305) - 0.5) * 3.0 * smoothstep(0.0, 3.0, beyond)
    y = y + cliff
    # Round the lip so it reads as a worn edge.
    y = y - 0.8 * (1.0 - smoothstep(0.0, 1.8, z - lz)) * smoothstep(-0.5, 0.0, z - lz)
    return np.maximum(y, -125.0)


def moss_mask(x, z, y):
    """Peacock spikemoss lives in the damp floors of the pools, in patches."""
    base = -6.5 + 0.17 * z + 0.004 * x * x
    warp = (fbm3(x / 7.5, z * 0.0, z / 7.5, 3, seed=303) - 0.5) * 2.6
    s = -base / STEP + warp
    f = s - np.floor(s)
    pool_floor = smoothstep(0.10, 0.30, f) * (1.0 - smoothstep(0.62, 0.80, f))
    patch = smoothstep(0.50, 0.66, fbm3(x / 3.2, z * 0.0, z / 3.2, 3, seed=306))
    near_lip = 1.0 - smoothstep(-6.0, 0.0, lip_z(x) - z)
    return np.clip(pool_floor * patch * (0.35 + 0.65 * near_lip), 0.0, 1.0)


def ledge_mesh(cell=0.35):
    """A regular grid over the ledge domain: (vertices, triangles, moss per vertex)."""
    x0, x1 = LEDGE_DOMAIN["x"]
    z0, z1 = LEDGE_DOMAIN["z"]
    nx = int(round((x1 - x0) / cell)) + 1
    nz = int(round((z0 - z1) / cell)) + 1
    xs = np.linspace(x0, x1, nx)
    zs = np.linspace(z0, z1, nz)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    Y = ledge_height(X, Z)
    verts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    idx = np.arange(nx * nz).reshape(nx, nz)
    a = idx[:-1, :-1].ravel()
    b = idx[1:, :-1].ravel()
    c = idx[1:, 1:].ravel()
    d = idx[:-1, 1:].ravel()
    # x increases along the first axis and z decreases along the second: (a, b, c) faces +y.
    faces = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)], axis=0)
    moss = moss_mask(X.ravel(), Z.ravel(), Y.ravel())
    return verts, faces, moss
