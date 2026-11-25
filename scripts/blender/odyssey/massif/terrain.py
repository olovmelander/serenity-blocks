"""
Grids and noises for Odyssey's massif (2026-11-25). Pure numpy.

A grid is a square of n x n posts, row j along world z, column i along world x, `step` world units apart,
the first post at (x0, z0): the layout of ODYSSEY_SCULPT_PLATE and of scripts/odyssey-massif-export.mjs.
"""

import math

import numpy as np


class Grid:
    def __init__(self, n, x0, z0, step):
        self.n = n
        self.x0 = x0
        self.z0 = z0
        self.step = step
        g = np.arange(n, dtype=np.float64)
        self.X, self.Z = np.meshgrid(x0 + g * step, z0 + g * step)

    def ij(self, x, z):
        """World x, z to fractional post coordinates (i along x, j along z)."""
        return (np.asarray(x) - self.x0) / self.step, (np.asarray(z) - self.z0) / self.step


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smax(a, b, k):
    """Smooth maximum (polynomial), k world units of blend."""
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0.0, 1.0)
    return b + (a - b) * h + k * h * (1 - h)


def smin(a, b, k):
    return -smax(-a, -b, k)


class Noise2:
    """Smooth value noise on an unbounded lattice (hashed), quintic fade. Values in [0, 1]."""

    def __init__(self, seed):
        rng = np.random.RandomState(seed)
        self.perm = rng.permutation(1024).astype(np.int64)
        self.val = rng.uniform(0, 1, 1024).astype(np.float64)

    def _h(self, i, j):
        p = self.perm
        return self.val[p[(p[(i & 1023)] + j) & 1023]]

    def __call__(self, x, y):
        x = np.asarray(x, np.float64)
        y = np.asarray(y, np.float64)
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        fx = x - xi
        fy = y - yi
        ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        a = self._h(xi, yi)
        b = self._h(xi + 1, yi)
        c = self._h(xi, yi + 1)
        d = self._h(xi + 1, yi + 1)
        return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy


def fbm(noise, x, y, octaves=4, gain=0.5, lac=2.03):
    acc = np.zeros(np.broadcast(np.asarray(x), np.asarray(y)).shape)
    amp, tot, f = 1.0, 0.0, 1.0
    for o in range(octaves):
        acc = acc + amp * noise(x * f + o * 17.3, y * f - o * 9.1)
        tot += amp
        amp *= gain
        f *= lac
    return acc / tot


def ridged(noise, x, y, octaves=4, gain=0.5, lac=2.03):
    acc = np.zeros(np.broadcast(np.asarray(x), np.asarray(y)).shape)
    amp, tot, f = 1.0, 0.0, 1.0
    for o in range(octaves):
        n = noise(x * f + o * 31.7, y * f - o * 13.3)
        acc = acc + amp * (1 - np.abs(2 * n - 1))
        tot += amp
        amp *= gain
        f *= lac
    return acc / tot


def blur(a, sigma):
    """Separable gaussian, edges clamped. sigma in posts."""
    if sigma <= 0:
        return a.copy()
    r = max(1, int(math.ceil(sigma * 3)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    p = np.pad(a, r, mode='edge')
    out = np.zeros_like(p)
    for o, w in enumerate(k):
        out += w * np.roll(p, o - r, axis=1)
    p = out
    out = np.zeros_like(p)
    for o, w in enumerate(k):
        out += w * np.roll(p, o - r, axis=0)
    return out[r:-r, r:-r]


def gradient(h, step):
    """Central differences in world units: dh/dx (along i), dh/dz (along j)."""
    gx = np.zeros_like(h)
    gz = np.zeros_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) / (2 * step)
    gz[1:-1, :] = (h[2:, :] - h[:-2, :]) / (2 * step)
    gx[:, 0] = (h[:, 1] - h[:, 0]) / step
    gx[:, -1] = (h[:, -1] - h[:, -2]) / step
    gz[0, :] = (h[1, :] - h[0, :]) / step
    gz[-1, :] = (h[-1, :] - h[-2, :]) / step
    return gx, gz


def laplacian(h, k=1):
    """mean(4 neighbours k posts away) - centre: + in a hollow, - on a crest. Edges clamped."""
    p = np.pad(h, k, mode='edge')
    n = h.shape[0]
    m = (p[k:k + n, 0:n] + p[k:k + n, 2 * k:2 * k + n] + p[0:n, k:k + n] + p[2 * k:2 * k + n, k:k + n]) / 4
    return m - h


def bilinear(h, fi, fj):
    """Sample h at fractional posts (fi along x/columns, fj along z/rows), clamped."""
    n = h.shape[0]
    fi = np.clip(fi, 0, n - 1.000001)
    fj = np.clip(fj, 0, n - 1.000001)
    i = np.floor(fi).astype(np.int64)
    j = np.floor(fj).astype(np.int64)
    u = fi - i
    v = fj - j
    a = h[j, i]
    b = h[j, i + 1]
    c = h[j + 1, i]
    d = h[j + 1, i + 1]
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


def catmull_rom(points, per=12):
    """A smooth polyline through control points (rows of any width), `per` samples a span."""
    p = np.asarray(points, np.float64)
    p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for s in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[s - 1], p[s], p[s + 1], p[s + 2]
        for t in np.linspace(0, 1, per, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(p[-2])
    return np.asarray(out)
