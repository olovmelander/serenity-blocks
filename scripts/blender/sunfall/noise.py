"""Deterministic numpy noise for the Sunfall cave authoring (value noise, fBm, joint blocks).

Everything works on float32/float64 arrays of world coordinates in metres and is pure numpy,
so the same field can be evaluated on a voxel grid (the shell), on mesh vertices (detail)
or on a handful of points (tests).
"""

import numpy as np

_M32 = np.int64(0xFFFFFFFF)


def hash3(ix, iy, iz, seed=0):
    """Integer lattice hash to [0, 1). Inputs are int64 arrays."""
    h = (ix * np.int64(0x8DA6B343)) ^ (iy * np.int64(0xD8163841)) ^ (iz * np.int64(0xCB1AB31F))
    h = (h ^ np.int64(seed * 0x9E3779B1)) & _M32
    h ^= h >> 15
    h = (h * np.int64(0x2C1B3C6D)) & _M32
    h ^= h >> 12
    h = (h * np.int64(0x297A2D39)) & _M32
    h ^= h >> 15
    return (h & np.int64(0xFFFFFF)).astype(np.float32) * np.float32(1.0 / 0xFFFFFF)


def _fade(t):
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def vnoise3(x, y, z, seed=0):
    """Smooth value noise in [0, 1] with a quintic fade."""
    fx0 = np.floor(x)
    fy0 = np.floor(y)
    fz0 = np.floor(z)
    ix = fx0.astype(np.int64)
    iy = fy0.astype(np.int64)
    iz = fz0.astype(np.int64)
    u = _fade((x - fx0).astype(np.float32))
    v = _fade((y - fy0).astype(np.float32))
    w = _fade((z - fz0).astype(np.float32))
    c000 = hash3(ix, iy, iz, seed)
    c100 = hash3(ix + 1, iy, iz, seed)
    x00 = c000 + (c100 - c000) * u
    c010 = hash3(ix, iy + 1, iz, seed)
    c110 = hash3(ix + 1, iy + 1, iz, seed)
    x10 = c010 + (c110 - c010) * u
    c001 = hash3(ix, iy, iz + 1, seed)
    c101 = hash3(ix + 1, iy, iz + 1, seed)
    x01 = c001 + (c101 - c001) * u
    c011 = hash3(ix, iy + 1, iz + 1, seed)
    c111 = hash3(ix + 1, iy + 1, iz + 1, seed)
    x11 = c011 + (c111 - c011) * u
    y0 = x00 + (x10 - x00) * v
    y1 = x01 + (x11 - x01) * v
    return y0 + (y1 - y0) * w


# A fixed rotation between octaves so lattice axes never line up from one octave to the next.
_ROT = np.array([
    [0.00, 0.80, 0.60],
    [-0.80, 0.36, -0.48],
    [-0.60, -0.48, 0.64],
], dtype=np.float64)


def fbm3(x, y, z, octaves=4, seed=0, lacunarity=2.03, gain=0.5):
    """Fractal sum of value noise, normalised to about [0, 1]."""
    total = np.zeros_like(x, dtype=np.float32)
    amp = 1.0
    norm = 0.0
    px, py, pz = x, y, z
    for octave in range(octaves):
        total += vnoise3(px, py, pz, seed + octave * 31) * np.float32(amp)
        norm += amp
        amp *= gain
        qx = (_ROT[0, 0] * px + _ROT[0, 1] * py + _ROT[0, 2] * pz) * lacunarity
        qy = (_ROT[1, 0] * px + _ROT[1, 1] * py + _ROT[1, 2] * pz) * lacunarity
        qz = (_ROT[2, 0] * px + _ROT[2, 1] * py + _ROT[2, 2] * pz) * lacunarity
        px, py, pz = qx, qy, qz
    return total / np.float32(norm)


def blocks3(x, y, z, seed=0, edge=0.12):
    """Piecewise-constant cell values in [0, 1] with short soft steps between cells.

    Limestone breaks along bedding planes and two vertical joint sets, so the blocks a collapse
    leaves are cuboids: a lattice (rotated by the caller) with one value per cell reads as
    angular breakdown, where a smooth noise reads as a blob.
    """
    fx0 = np.floor(x)
    fy0 = np.floor(y)
    fz0 = np.floor(z)
    ix = fx0.astype(np.int64)
    iy = fy0.astype(np.int64)
    iz = fz0.astype(np.int64)

    def step(f):
        t = np.clip((f - (1.0 - edge)) / edge, 0.0, 1.0).astype(np.float32)
        return t * t * (3.0 - 2.0 * t)

    u = step(x - fx0)
    v = step(y - fy0)
    w = step(z - fz0)
    c000 = hash3(ix, iy, iz, seed)
    c100 = hash3(ix + 1, iy, iz, seed)
    c010 = hash3(ix, iy + 1, iz, seed)
    c110 = hash3(ix + 1, iy + 1, iz, seed)
    c001 = hash3(ix, iy, iz + 1, seed)
    c101 = hash3(ix + 1, iy, iz + 1, seed)
    c011 = hash3(ix, iy + 1, iz + 1, seed)
    c111 = hash3(ix + 1, iy + 1, iz + 1, seed)
    x00 = c000 + (c100 - c000) * u
    x10 = c010 + (c110 - c010) * u
    x01 = c001 + (c101 - c001) * u
    x11 = c011 + (c111 - c011) * u
    y0 = x00 + (x10 - x00) * v
    y1 = x01 + (x11 - x01) * v
    return y0 + (y1 - y0) * w


def smin(a, b, k):
    """Polynomial smooth minimum (union of air in a rock-positive field)."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    """Polynomial smooth maximum (intersection of air in a rock-positive field)."""
    return -smin(-a, -b, k)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)
