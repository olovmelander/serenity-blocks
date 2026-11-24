"""
The light inside a cloud, solved once (Odyssey's clouds, 2026-11-24).

The world's sun never moves (chapter-profile.js ODYSSEY_WORLD_SUN), so what it does inside a cloud can be
worked out offline, with the scattering a real-time march cannot afford. On a coarse grid a shape carries

  sun (4)   the sun's light arriving, for the shape turned 0, 90, 180 and 270 degrees about up: straight
            light and several orders of scattering (each deeper-reaching and weaker, Wrenninge's sum), then
            diffused through the body, so a lit flank glows into its neighbours and a shaded one is never black
  sky       how much of the sky's dome reaches it
  ground    how much of what comes up from the sea and the land
  body      how deep in the cloud it is (0 outside .. 1 in its heart): a thin edge lets light through
"""

import math

import numpy as np

from field import blur, resample, sample

SUN = np.array([-0.875, 0.259, 0.408])
SUN = SUN / np.linalg.norm(SUN)
EXTINCTION = 34.0      # optical depth across one width of solid cloud


def turned(v, quarter):
    """A world direction in the frame of a shape turned `quarter` right angles about up."""
    a = -quarter * math.pi / 2
    # A shape turned by +t sees the world turned by -t. (The game turns x, z by: x c + z s, z c - x s.)
    c, s = math.cos(a), math.sin(a)
    return np.array([v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s])


def depth_toward(dens, cell, d, steps=26, reach=0.75):
    """The optical depth from every cell along `d`."""
    nx, ny, nz = dens.shape
    I, J, K = np.meshgrid(np.arange(nx), np.arange(ny), np.arange(nz), indexing='ij')
    out = np.zeros(dens.shape, np.float32)
    # Finer near the cell, coarser away from it.
    t0 = 0.0
    for s in range(steps):
        t1 = reach * ((s + 1) / steps) ** 1.6
        t = (t0 + t1) / 2
        out += (sample(dens, I + d[0] * t / cell[0], J + d[1] * t / cell[1], K + d[2] * t / cell[2]) * (t1 - t0)).astype(np.float32)
        t0 = t1
    return out * EXTINCTION


def scattered(tau, octaves=5, a=0.62, b=0.36):
    out, w = 0.0, 0.0
    for o in range(octaves):
        out = out + a ** o * np.exp(-tau * b ** o)
        w += a ** o
    return out / w


def directions(n, up):
    i = np.arange(n) + 0.5
    z = 1 - i / n
    phi = i * 2.399963
    r = np.sqrt(1 - z * z)
    d = np.stack([r * np.cos(phi), z, r * np.sin(phi)], 1)
    if not up:
        d[:, 1] *= -1
    return d


def solve(sdf, box, n):
    """`sdf` on the sculpting grid (units of the shape's width) -> (sun x 4, sky, ground, body) on `n`."""
    f = resample(sdf, [m * 2 for m in n])
    dens = np.clip(0.5 - f / 0.030, 0, 1)
    dens = dens.reshape(n[0], 2, n[1], 2, n[2], 2).mean(axis=(1, 3, 5)).astype(np.float32)
    cell = [b / m for b, m in zip(box, n)]
    suns = []
    for q in range(4):
        tau = depth_toward(dens, cell, turned(SUN, q))
        direct = scattered(tau)
        # Diffused: the light a body of cloud hands on to itself, from where there is more of it.
        w = dens + 0.02
        soft = blur(direct * w, 2.2) / np.maximum(blur(w, 2.2), 1e-3)
        suns.append(np.clip(direct * 0.72 + soft * 0.28, 0, 1))
    sky = np.zeros(dens.shape, np.float32)
    total = 0.0
    for d in directions(18, True):
        w = 0.35 + 0.65 * d[1]
        sky += (w * scattered(depth_toward(dens, cell, d, 14, 0.55) * 0.55, 3, 0.6, 0.4)).astype(np.float32)
        total += w
    sky /= total
    ground = np.zeros(dens.shape, np.float32)
    total = 0.0
    for d in directions(12, False):
        w = 0.35 - 0.65 * d[1]
        ground += (w * np.exp(-depth_toward(dens, cell, d, 12, 0.45) * 0.45)).astype(np.float32)
        total += w
    ground /= total
    body = np.clip(blur(dens, 1.6), 0, 1)
    # Off the body the light is its surface's (a skin sample leans on the cells outside it).
    solid = dens > 0.06
    for field in suns + [sky, ground]:
        w = solid.astype(np.float32)
        fill = field * w
        for _ in range(3):
            bw = blur(w, 1.2)
            fill = np.where(w > 0.5, fill, blur(fill, 1.2) / np.maximum(bw, 1e-3))
            w = np.maximum(w, (bw > 0.02).astype(np.float32))
        field[...] = np.where(solid, field, np.clip(fill * 0.85 + field * 0.15, 0, 1))
    return suns, sky, ground, body
