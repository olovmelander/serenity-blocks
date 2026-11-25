"""
What the massif's form may not do (2026-11-25).

  the rail   the camera rides within ~40 u of the rail; the ground under and round it must stay well clear.
             A cap over every post: the lowest of (rail y - clear - slope x horizontal distance beyond reach)
             over the rail's rows. The world's own test holds 20 u under the rail itself.
  the foot   the form is laid over the island only inside the massif: a mask fading it out across the lower
             skirt, so the meadows, the tarn, the forest's floor and the animals' ground keep their height.
"""

import numpy as np

from terrain import smoothstep


def rail_cap(grid, rail, clear=46.0, reach=60.0, slope=2.2, box_pad=600.0):
    """The highest the ground may stand at every post. rail: rows (p, x, y, z)."""
    X = grid.X
    Z = grid.Z
    x0, x1 = X.min() - box_pad, X.max() + box_pad
    z0, z1 = Z.min() - box_pad, Z.max() + box_pad
    r = rail[(rail[:, 1] > x0) & (rail[:, 1] < x1) & (rail[:, 3] > z0) & (rail[:, 3] < z1)]
    cap = np.full(X.shape, 1e9)
    fx = X.ravel()
    fz = Z.ravel()
    out = cap.ravel()
    chunk = 20000
    for c0 in range(0, fx.size, chunk):
        dx = fx[c0:c0 + chunk, None] - r[None, :, 1]
        dz = fz[c0:c0 + chunk, None] - r[None, :, 3]
        d = np.sqrt(dx * dx + dz * dz)
        lim = r[None, :, 2] - clear + slope * np.maximum(d - reach, 0)
        out[c0:c0 + chunk] = lim.min(axis=1)
    return out.reshape(X.shape)


def air_cap(grid, air, clear=40.0, reach=20.0, slope=2.2):
    """The same cap under the air things fly through (rows x, y, z): the summit's vultures' column."""
    if air.size == 0:
        return np.full(grid.X.shape, 1e9)
    rows = np.stack([np.zeros(len(air)), air[:, 0], air[:, 1], air[:, 2]], 1)
    return rail_cap(grid, rows, clear=clear, reach=reach, slope=slope)


def foot_mask(grid, apex, base):
    """1 over the massif, 0 at its foot. Wider east and west, where the shoulders stand."""
    U = grid.X - apex[0]
    V = grid.Z - apex[1]
    th = np.arctan2(V, U)
    reach = 545 + 95 * np.abs(np.cos(th)) - 25 * np.clip(np.sin(th), 0, 1)
    d = np.sqrt(U * U + V * V)
    m = smoothstep(reach, reach - 150, d)
    # never over the meadows' level, whatever the distance
    m *= smoothstep(312, 345, base)
    # and nothing at the plate's own border (a clamped sampler reads its edge)
    n = grid.n
    e = np.minimum.reduce([np.arange(n)[None, :].repeat(n, 0), np.arange(n)[:, None].repeat(n, 1),
                           (n - 1 - np.arange(n))[None, :].repeat(n, 0), (n - 1 - np.arange(n))[:, None].repeat(n, 1)])
    m *= smoothstep(4, 20, e)
    return m
