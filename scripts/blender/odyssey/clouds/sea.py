"""
The sea of clouds (Odyssey's clouds, 2026-11-24): a floor of cloud seen from above, as one tiling landscape.

  R  its height (0..1 of AMP)
  G  the sun's light on it: shadows raked across the deck by the world's one low sun, softened by the light a
     body of cloud hands on
  B  the sky it sees
  A  how firmly cloud stands there: the last places to thin, the first to gather

Pillows of every size melted together, each throwing billows as the heaps do (sculpt.py), over broad swells
and lanes. The tile is TILE units a side; the game reads it at x, z.
"""

import math

import numpy as np

from field import fib_sphere, rng_of, unit
from high import smooth, spectrum, unitize

TILE = 5200.0
AMP = 300.0
SUN = np.array([-0.875, 0.259, 0.408])


def splat(h, n, balls, k):
    """The upper surface of melted balls on a wrapping grid (metres): a smooth maximum."""
    cell = TILE / n
    acc = np.zeros((n, n))
    for x, y, z, r in balls:
        reach = r * 1.04
        m = int(math.ceil(reach / cell))
        i0, j0 = int(round(x / cell)), int(round(z / cell))
        ii = np.arange(i0 - m, i0 + m + 1)
        jj = np.arange(j0 - m, j0 + m + 1)
        dx = ii * cell - x
        dz = jj * cell - z
        q = r * r - (dx[None, :] ** 2 + dz[:, None] ** 2)
        top = np.where(q > 0, y + np.sqrt(np.maximum(q, 0)), -1e9)
        s = np.ix_(jj % n, ii % n)
        acc[s] += np.where(q > 0, np.exp(np.minimum((top - 200) / k, 60)), 0)
    out = np.where(acc > 0, 200 + k * np.log(np.maximum(acc, 1e-300)), 0)
    return np.maximum(h, out)


def wrap_blur(a, sigma):
    n = a.shape[0]
    k = np.fft.fftfreq(n) * n
    ky, kx = np.meshgrid(k, k, indexing='ij')
    g = np.exp(-2 * (math.pi * sigma / n) ** 2 * (kx * kx + ky * ky))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def build(n=1024):
    rng = rng_of(77)
    # Where the deck is thick and where it parts: broad swells, read with the masses.
    swell = unitize(spectrum(n, 51, 1.8, 1.0, 1, 12), 2, 98)
    at = lambda x, z: swell[int(z / TILE * n) % n, int(x / TILE * n) % n]
    # Pillows over the whole floor, sunk into one another: only their backs show.
    level0 = []
    for size, count, sunk in ((0.056, 190, 0.80), (0.036, 300, 0.74), (0.022, 420, 0.66)):
        for _ in range(count):
            x, z = rng.uniform(0, TILE, 2)
            sw = at(x, z)
            r = TILE * size * (0.7 + 0.6 * rng.uniform())
            level0.append((x, -r * sunk + 26 + 74 * sw, z, r))
    # Here and there a head stands up out of it.
    for _ in range(26):
        x, z = rng.uniform(0, TILE, 2)
        sw = at(x, z)
        if sw < 0.45:
            continue
        for _k in range(3):
            r = 70 + 70 * rng.uniform()
            level0.append((x + rng.normal() * 80, 60 + 60 * sw + r * 0.2 * rng.normal(), z + rng.normal() * 80, r))
    level1, level2 = [], []
    for x, y, z, r in level0:
        for d in fib_sphere(26, rng):
            if d[1] < 0.42 or y + d[1] * r < 14:
                continue
            rr = min(r * 0.34, 74) * (0.55 + 0.8 * rng.uniform())
            c = (x + d[0] * r * 0.90, y + d[1] * r * 0.90, z + d[2] * r * 0.90)
            level1.append((*c, rr))
            for e in fib_sphere(13, rng):
                if e[1] < 0.15:
                    continue
                level2.append((c[0] + e[0] * rr * 0.86, c[1] + e[1] * rr * 0.86, c[2] + e[2] * rr * 0.86, rr * 0.44 * (0.65 + 0.7 * rng.uniform())))
    base = 20 * swell
    h = splat(base, n, level0, 14.0)
    h = splat(h, n, level1, 9.0)
    h = splat(h, n, level2, 5.0)
    h = np.maximum(0, h)
    # No top is cut: the highest are drawn down softly.
    h = np.where(h > 190, 190 + (AMP - 194) * (1 - np.exp(-(h - 190) / (AMP - 194))), h)
    h = 0.8 * h + 0.2 * wrap_blur(h, 1.4)
    cell = TILE / n
    # The sun, raked: how far it stands clear of everything toward the sun, softened with distance.
    flat = math.hypot(SUN[0], SUN[2])
    sx, sz = SUN[0] / flat, SUN[2] / flat
    tan = SUN[1] / flat
    y, x = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
    light = np.ones((n, n))
    for s in range(1, 56):
        d = 7.0 * s ** 1.32
        fx, fz = x + sx * d / cell, y + sz * d / cell
        i0, j0 = np.floor(fx).astype(int), np.floor(fz).astype(int)
        u, v = fx - i0, fz - j0
        hh = ((h[j0 % n, i0 % n] * (1 - u) + h[j0 % n, (i0 + 1) % n] * u) * (1 - v)
              + (h[(j0 + 1) % n, i0 % n] * (1 - u) + h[(j0 + 1) % n, (i0 + 1) % n] * u) * v)
        clear = (h + d * tan - hh) / (16 + d * 0.20)
        light = np.minimum(light, smooth(-1.0, 1.0, clear))
    gz, gx = np.gradient(h, cell)
    wrapped = np.clip((-gx * SUN[0] + SUN[1] - gz * SUN[2]) / np.sqrt(1 + gx * gx + gz * gz) * 0.55 + 0.52, 0, 1)
    sun = (0.10 + 0.90 * light) * wrapped
    sun = unitize(0.56 * sun + 0.26 * wrap_blur(sun, 5) + 0.18 * wrap_blur(sun, 18), 0.5, 99.5)
    hollow = np.clip(0.5 + (h - wrap_blur(h, 9)) / 70 + (h - wrap_blur(h, 30)) / 170, 0, 1)
    sky = np.clip(0.30 + 0.70 * hollow, 0, 1)
    firm = np.clip(0.55 * unitize(wrap_blur(h, 22), 2, 98) + 0.30 * swell + 0.15 * unitize(spectrum(n, 54, 1.8, 1.0, 2, 40), 2, 98), 0, 1)
    print('sea', len(level0), len(level1), len(level2), 'h mean %.0f max %.0f' % (h.mean(), h.max()))
    return np.stack([h / AMP, sun, sky, unitize(firm, 0.5, 99.5)], -1).astype(np.float32)
