"""
Grids, noises and distance fields for Odyssey's clouds (2026-11-24). Pure numpy and OpenVDB.
"""

import math

import numpy as np
import openvdb as vdb


def rng_of(seed):
    return np.random.RandomState(seed)


def unit(v):
    v = np.asarray(v, float)
    return v / max(1e-9, float(np.linalg.norm(v)))


def fib_sphere(n, rng, jitter=0.35):
    """`n` directions spread evenly over the sphere, each a little off its place."""
    i = np.arange(n) + 0.5
    z = 1 - 2 * i / n
    phi = i * 2.399963 + rng.uniform(0, 2 * math.pi)
    r = np.sqrt(np.maximum(0, 1 - z * z))
    d = np.stack([r * np.cos(phi), z, r * np.sin(phi)], 1)
    d += rng.normal(size=d.shape) * jitter * (2.0 / math.sqrt(n))
    return d / np.linalg.norm(d, axis=1, keepdims=True)


# ── noises ──

class Lattice:
    """A smooth value noise in three dimensions (a wrapped lattice)."""

    def __init__(self, seed, n=32):
        self.n = n
        self.g = rng_of(seed).uniform(-1, 1, size=(n, n, n)).astype(np.float32)

    def __call__(self, x, y, z):
        n = self.n
        out = np.zeros(np.broadcast(x, y, z).shape, np.float32)
        ix, iy, iz = np.floor(x).astype(int), np.floor(y).astype(int), np.floor(z).astype(int)
        fx, fy, fz = x - ix, y - iy, z - iz
        fx, fy, fz = (f * f * f * (f * (f * 6 - 15) + 10) for f in (fx, fy, fz))
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy) * (fz if dz else 1 - fz)
                    out += w * self.g[(ix + dx) % n, (iy + dy) % n, (iz + dz) % n]
        return out


def fbm(lat, x, y, z, octaves=3, gain=0.5):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        k = 2.0 ** o
        out = out + amp * lat(x * k + 7.3 * o, y * k + 3.1 * o, z * k - 5.7 * o)
        tot += amp
        amp *= gain
    return out / tot


def worley_tile(res, cells, seed):
    """Distance to the nearest feature point, tiling, `res` cubed, 0 at a point .. about 1."""
    rng = rng_of(seed)
    pts = rng.uniform(size=(cells, cells, cells, 3)).astype(np.float32)
    g = (np.arange(res) + 0.5) / res * cells
    X, Y, Z = np.meshgrid(g, g, g, indexing='ij')
    cx, cy, cz = np.floor(X).astype(int), np.floor(Y).astype(int), np.floor(Z).astype(int)
    best = np.full((res, res, res), 9.0, np.float32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                ix, iy, iz = cx + dx, cy + dy, cz + dz
                p = pts[ix % cells, iy % cells, iz % cells]
                d = (ix + p[..., 0] - X) ** 2 + (iy + p[..., 1] - Y) ** 2 + (iz + p[..., 2] - Z) ** 2
                np.minimum(best, d, out=best)
    return np.sqrt(best)


class Billow:
    """Billows at any place (an inverted Worley, not tiling): 1 at a billow's crown, 0 in the crease between."""

    def __init__(self, seed, n=24):
        self.n = n
        self.p = rng_of(seed).uniform(size=(n, n, n, 3)).astype(np.float32)

    def __call__(self, x, y, z):
        n = self.n
        ix, iy, iz = np.floor(x).astype(int), np.floor(y).astype(int), np.floor(z).astype(int)
        best = np.full(x.shape, 9.0, np.float32)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    jx, jy, jz = ix + dx, iy + dy, iz + dz
                    p = self.p[jx % n, jy % n, jz % n]
                    d = (jx + p[..., 0] - x) ** 2 + (jy + p[..., 1] - y) ** 2 + (jz + p[..., 2] - z) ** 2
                    np.minimum(best, d, out=best)
        return 1.0 - np.minimum(1.0, np.sqrt(best) / 0.95)


# ── fields ──

def grid(box, voxel):
    """Cell centres of a box (x centred, y from 0 up, z centred) at `voxel`: X, Y, Z and the counts."""
    n = [int(math.ceil(b / voxel)) for b in box]
    ax = [(np.arange(n[0]) + 0.5) * voxel - box[0] / 2, (np.arange(n[1]) + 0.5) * voxel, (np.arange(n[2]) + 0.5) * voxel - box[2] / 2]
    X, Y, Z = np.meshgrid(*ax, indexing='ij')
    return X.astype(np.float32), Y.astype(np.float32), Z.astype(np.float32), n


def union(X, Y, Z, balls, k, squash=1.0):
    """
    The melted union of balls (centre, radius): an exponential smooth minimum, the same whatever the order.
    Each ball only writes the cells it can matter to.
    """
    acc = np.zeros(X.shape, np.float64)
    reach = k * 9.0
    vx = float(X[1, 0, 0] - X[0, 0, 0])
    x0, y0, z0 = float(X[0, 0, 0]), float(Y[0, 0, 0]), float(Z[0, 0, 0])
    far = 0.6
    for c, r in balls:
        lo = [int(max(0, math.floor((c[i] - r - reach - o) / vx))) for i, o in enumerate((x0, y0, z0))]
        hi = [int(min(X.shape[i], math.ceil((c[i] + r + reach - o) / vx) + 1)) for i, o in enumerate((x0, y0, z0))]
        if any(h <= l for l, h in zip(lo, hi)):
            continue
        s = np.s_[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        d = np.sqrt((X[s] - c[0]) ** 2 + ((Y[s] - c[1]) / squash) ** 2 + (Z[s] - c[2]) ** 2) - r
        acc[s] += np.exp(-np.minimum(d, far) / k)
    return np.where(acc > 1e-12, -k * np.log(np.maximum(acc, 1e-12)), far).astype(np.float32)


def smax(a, b, k):
    h = np.clip(0.5 - 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h + k * h * (1 - h)


def redistance(f, voxel, reach):
    """A true signed distance (in the field's own units) from any field, clamped at `reach`."""
    f = np.pad(f, 2, constant_values=max(float(f.max()), reach))
    g = vdb.FloatGrid(float(f.max()))
    g.copyFromArray((f / voxel).astype(np.float32))
    pts, tris, quads = g.convertToPolygons(isovalue=0.0, adaptivity=0.0)
    half = reach / voxel
    ls = vdb.FloatGrid.createLevelSetFromPolygons(pts, triangles=tris, quads=quads, halfWidth=half)
    out = np.full(f.shape, half, np.float32)
    ls.copyToArray(out)
    # (Deep inside a level set holds its background with the sign of the last span: take the field's own.)
    out = np.where((f < 0) & (out > 0.5), -half, out)
    return np.clip(out[2:-2, 2:-2, 2:-2] * voxel, -reach, reach)


def resample(f, n):
    """Trilinear resample of a cell-centred grid to `n` cells an axis."""
    for ax, m in enumerate(n):
        s = f.shape[ax]
        t = np.clip((np.arange(m) + 0.5) / m * s - 0.5, 0, s - 1.0001)
        i = np.floor(t).astype(int)
        w = (t - i).reshape([-1 if a == ax else 1 for a in range(3)]).astype(np.float32)
        f = np.take(f, i, axis=ax) * (1 - w) + np.take(f, np.minimum(i + 1, s - 1), axis=ax) * w
    return f.astype(np.float32)


def sample(f, x, y, z, outside=0.0):
    """Trilinear reads at fractional cell indices."""
    nx, ny, nz = f.shape
    inside = (x > -0.5) & (y > -0.5) & (z > -0.5) & (x < nx - 0.5) & (y < ny - 0.5) & (z < nz - 0.5)
    x, y, z = np.clip(x, 0, nx - 1.001), np.clip(y, 0, ny - 1.001), np.clip(z, 0, nz - 1.001)
    i, j, k = x.astype(int), y.astype(int), z.astype(int)
    u, v, w = x - i, y - j, z - k
    out = 0
    for a in (0, 1):
        for b in (0, 1):
            for c in (0, 1):
                out = out + (u if a else 1 - u) * (v if b else 1 - v) * (w if c else 1 - w) * f[i + a, j + b, k + c]
    return np.where(inside, out, outside)


def blur(f, sigma):
    """A gaussian blur (cells), edges held."""
    r = int(math.ceil(sigma * 2.5))
    kx = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    kx /= kx.sum()
    for ax in range(3):
        p = np.pad(f, [(r, r) if a == ax else (0, 0) for a in range(3)], mode='edge')
        acc = 0
        for q, w in enumerate(kx):
            acc = acc + w * np.take(p, np.arange(q, q + f.shape[ax]), axis=ax)
        f = acc
    return f.astype(np.float32)
