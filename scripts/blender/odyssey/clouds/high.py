"""
The high sky's sheets (Odyssey's clouds, 2026-11-24): one tiling picture, RGBA, data not colour.

  R  cirrus: ice falling from small heads, combed into tails down the wind (+x), curling as it goes
  G  altocumulus: a mackerel field's heights, cells in wave trains, gaps between the flocks
  B  a veil: cirrostratus, broad and soft, faintly fibrous
  A  where there is cloud at all (a slow patch noise, for thresholds)
"""

import numpy as np


def spectrum(n, seed, beta, stretch=1.0, lo=1, hi=None):
    """A tiling noise of power 1/f^beta, drawn out `stretch` times along x. Mean 0, deviation 1."""
    rng = np.random.RandomState(seed)
    f = np.fft.fft2(rng.normal(size=(n, n)))
    k = np.fft.fftfreq(n) * n
    ky, kx = np.meshgrid(k, k, indexing='ij')
    r = np.sqrt((kx * stretch) ** 2 + ky ** 2)
    amp = np.where(r > 0, np.maximum(r, 1) ** (-beta), 0)
    amp = np.where((r < lo) | ((hi is not None) & (r > (hi or 1e9))), 0, amp)
    out = np.real(np.fft.ifft2(f * amp))
    return (out - out.mean()) / out.std()


def bilinear(img, x, y):
    n = img.shape[0]
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    a, b = img[y0 % n, x0 % n], img[y0 % n, (x0 + 1) % n]
    c, d = img[(y0 + 1) % n, x0 % n], img[(y0 + 1) % n, (x0 + 1) % n]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def advect(img, u, v, steps, length, decay, rise=0.0):
    """What drifts down the flow: every place gathers what stands upwind of it, fading with the way."""
    n = img.shape[0]
    y, x = np.meshgrid(np.arange(n, dtype=float), np.arange(n, dtype=float), indexing='ij')
    acc = np.zeros_like(img)
    tot = 0.0
    h = length / steps
    for s in range(steps):
        w = np.exp(-decay * s / steps) * (1 - np.exp(-rise * (s + 0.5) / steps) if rise else 1.0)
        acc += w * bilinear(img, x, y)
        tot += w
        ux, vy = bilinear(u, x, y), bilinear(v, x, y)
        x = x - ux * h
        y = y - vy * h
    return acc / tot


def unitize(a, lo=1, hi=99):
    p, q = np.percentile(a, [lo, hi])
    return np.clip((a - p) / (q - p), 0, 1)


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def cirrus(n):
    swirl = spectrum(n, 11, 2.6, 1.0, 1, 9)
    gy, gx = np.gradient(swirl)
    # The wind, with slow curls in it.
    u = 1.0 + 62.0 * gy
    v = -62.0 * gx
    m = np.sqrt(u * u + v * v)
    u, v = u / m, v / m
    patch = smooth(0.25, 1.7, spectrum(n, 12, 1.35, 1.5, 2, 18))
    # Heads: bright tufts inside the patches, of every size.
    tuft = spectrum(n, 13, 0.85, 1.0, 5, 46)
    heads = smooth(0.7, 2.6, tuft) * patch
    short = advect(heads, u, v, 64, 150, 2.6, 6.0)
    tails = advect(heads, u, v, 72, 300, 2.2, 8.0)
    long_tails = advect(heads, u, v, 80, 520, 1.6, 8.0)
    # The comb: fibres finer than the tails, along the same flow, and never of one strength.
    fibre = unitize(advect(spectrum(n, 14, 0.35, 1.0, 24, 260), u, v, 56, 150, 0.3), 3, 97)
    comb = smooth(-1.2, 1.2, spectrum(n, 16, 1.6, 1.0, 2, 20))
    body = unitize(short, 35, 99.7) * 0.30 + unitize(tails, 30, 99.6) * 0.42 + unitize(long_tails, 25, 99.6) * 0.34
    out = body * (1 - 0.62 * comb * (1 - fibre))
    # Thin sheets the flocks stand in.
    sheet = smooth(0.2, 2.4, advect(spectrum(n, 15, 1.5, 1.0, 2, 50), u, v, 40, 190, 0.6) * 2.2) * smooth(-0.2, 1.4, spectrum(n, 12, 1.35, 1.5, 2, 18))
    return np.clip(out * 1.05 + sheet * (0.30 + 0.40 * fibre) * 0.36, 0, 1)


def worley(n, cells, seed, warpx, warpy):
    rng = np.random.RandomState(seed)
    pts = rng.uniform(size=(cells[1], cells[0], 2))
    y, x = np.meshgrid((np.arange(n) + 0.5) / n, (np.arange(n) + 0.5) / n, indexing='ij')
    gx = (x + warpx) * cells[0]
    gy = (y + warpy) * cells[1]
    cx, cy = np.floor(gx).astype(int), np.floor(gy).astype(int)
    d1 = np.full((n, n), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            ix, iy = cx + dx, cy + dy
            p = pts[iy % cells[1], ix % cells[0]]
            d1 = np.minimum(d1, (ix + p[..., 0] - gx) ** 2 + (iy + p[..., 1] - gy) ** 2)
    return np.sqrt(d1)


def altocumulus(n):
    wx = spectrum(n, 21, 2.4, 1.0, 1, 10) * 0.010
    wy = spectrum(n, 22, 2.4, 1.0, 1, 10) * 0.014
    cells = 1 - np.clip(worley(n, (34, 44), 23, wx, wy) / 0.80, 0, 1)
    small = 1 - np.clip(worley(n, (70, 90), 24, wx * 1.3, wy * 1.3) / 0.80, 0, 1)
    # Wave trains across the wind.
    x = (np.arange(n) + 0.5) / n
    gy, gx = np.meshgrid(x, x, indexing='ij')
    rolls = 0.5 + 0.5 * np.sin(2 * np.pi * (13 * gx + 3 * gy) + spectrum(n, 25, 2.2, 1.0, 1, 12) * 1.5)
    flock = smooth(-0.15, 1.2, spectrum(n, 26, 1.9, 1.3, 1, 7))
    h = (cells ** 1.2 * 0.72 + small * 0.28) * (0.55 + 0.45 * rolls)
    return np.clip(h * flock * 1.5, 0, 1)


def veil(n):
    swirl = spectrum(n, 31, 2.6, 1.0, 1, 6)
    gy, gx = np.gradient(swirl)
    u, v = 1.0 + 20 * gy, -20 * gx
    m = np.sqrt(u * u + v * v)
    a = advect(spectrum(n, 32, 1.5, 1.4, 1, 120), u / m, v / m, 48, 220, 0.4)
    return unitize(a, 2, 99)


def build(n=1024):
    out = np.stack([cirrus(n), altocumulus(n), veil(n), unitize(spectrum(n, 41, 1.8, 1.0, 1, 14), 2, 98)], -1)
    return out.astype(np.float32)
