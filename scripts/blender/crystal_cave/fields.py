"""The cavern as two height fields over the floor plan, in game coordinates.

x is right, y is up, z points at the player (the camera sits at +z and looks down -z).
Air is the space between `floor(x, z)` and `ceiling(x, z)`; where the ceiling dips to the
floor there is rock — walls, columns and the ends of the hall all come from that. Pure
numpy (no bpy), so the plan can be reasoned about and reused by placement and tests.
"""

from functools import lru_cache

import numpy as np

POOL_LEVEL = -7.0
#: Plan extent: x min, x max, z min, z max.
PLAN = (-78.0, 78.0, -132.0, 46.0)
#: The skylight: a chimney through the vault. Plan centre and radius.
SKYLIGHT = {"x": -36.0, "z": -50.0, "radius": 5.4}


@lru_cache(maxsize=None)
def lattice(shape, seed):
    return np.random.default_rng(seed).random(shape, dtype=np.float64)


def _fade(t):
    return t * t * (3.0 - 2.0 * t)


def value_noise2(x, z, frequency, seed, size=64):
    """Tiling bilinear value noise in [0, 1]."""
    grid = lattice((size, size), seed)
    px = np.asarray(x, dtype=np.float64) * frequency
    pz = np.asarray(z, dtype=np.float64) * frequency
    ix = np.floor(px).astype(np.int64)
    iz = np.floor(pz).astype(np.int64)
    fx = _fade(px - ix)
    fz = _fade(pz - iz)
    x0, x1 = ix % size, (ix + 1) % size
    z0, z1 = iz % size, (iz + 1) % size
    return ((grid[z0, x0] * (1 - fx) + grid[z0, x1] * fx) * (1 - fz)
            + (grid[z1, x0] * (1 - fx) + grid[z1, x1] * fx) * fz)


def value_noise3(points, frequency, seed, size=48):
    """Tiling trilinear value noise in [0, 1] for an (n, 3) array."""
    grid = lattice((size, size, size), seed)
    p = np.asarray(points, dtype=np.float64) * frequency
    i = np.floor(p).astype(np.int64)
    f = _fade(p - i)
    i0 = i % size
    i1 = (i + 1) % size
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]

    def corner(ax, ay, az):
        return grid[az, ay, ax]

    c00 = corner(i0[:, 0], i0[:, 1], i0[:, 2]) * (1 - fx) + corner(i1[:, 0], i0[:, 1], i0[:, 2]) * fx
    c10 = corner(i0[:, 0], i1[:, 1], i0[:, 2]) * (1 - fx) + corner(i1[:, 0], i1[:, 1], i0[:, 2]) * fx
    c01 = corner(i0[:, 0], i0[:, 1], i1[:, 2]) * (1 - fx) + corner(i1[:, 0], i0[:, 1], i1[:, 2]) * fx
    c11 = corner(i0[:, 0], i1[:, 1], i1[:, 2]) * (1 - fx) + corner(i1[:, 0], i1[:, 1], i1[:, 2]) * fx
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz


def fbm2(x, z, frequency, seed, octaves=4):
    total = np.zeros(np.broadcast(x, z).shape)
    weight = 0.5
    norm = 0.0
    for octave in range(octaves):
        total += value_noise2(x, z, frequency * (2 ** octave), seed + octave * 17) * weight
        norm += weight
        weight *= 0.5
    return total / norm


def fbm3(points, frequency, seed, octaves=4):
    total = np.zeros(len(points))
    weight = 0.5
    norm = 0.0
    for octave in range(octaves):
        total += value_noise3(points, frequency * (2 ** octave), seed + octave * 13) * weight
        norm += weight
        weight *= 0.5
    return total / norm


def smoothstep(low, high, value):
    t = np.clip((np.asarray(value, dtype=np.float64) - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _curve(z, points):
    """Smooth interpolation through (z, value) control points given in descending z."""
    zs = np.array([p[0] for p in points], dtype=np.float64)[::-1]
    vs = np.array([p[1] for p in points], dtype=np.float64)[::-1]
    z = np.asarray(z, dtype=np.float64)
    index = np.clip(np.searchsorted(zs, z) - 1, 0, len(zs) - 2)
    t = np.clip((z - zs[index]) / (zs[index + 1] - zs[index]), 0.0, 1.0)
    return vs[index] + (vs[index + 1] - vs[index]) * _fade(t)


# Half-width of the hall on each side of the centre line, front to back.
_LEFT = [(46, 0.0), (40, 21.0), (22, 23.0), (6, 29.0), (-10, 42.0), (-28, 54.0), (-52, 60.0),
         (-76, 47.0), (-98, 31.0), (-114, 19.0), (-126, 0.0)]
_RIGHT = [(46, 0.0), (40, 22.0), (22, 24.0), (6, 31.0), (-10, 44.0), (-30, 50.0), (-56, 55.0),
          (-80, 43.0), (-100, 29.0), (-114, 18.0), (-126, 0.0)]
# Height of the vault above the pool along the centre line.
_VAULT = [(46, 14.0), (30, 26.0), (8, 30.0), (-12, 35.0), (-34, 41.0), (-60, 45.0), (-86, 39.0),
          (-106, 31.0), (-120, 20.0), (-126, 10.0)]

#: Columns: floor and vault meet. (x, z, radius)
COLUMNS = [(-33.0, -30.0, 3.2), (36.0, -44.0, 3.6), (-14.0, -74.0, 2.8), (21.0, -82.0, 3.0),
           (-47.0, -66.0, 3.4), (44.0, -18.0, 2.6)]
#: Islands that break the pool. (x, z, radius, height above water)
ISLANDS = [(-7.5, -40.0, 5.5, 1.3), (11.0, -63.0, 6.5, 1.6), (-24.0, -58.0, 7.0, 1.1), (3.0, -96.0, 9.0, 2.2)]


def wall_distance(x, z):
    """Approximate distance into the hall from its nearest side wall (negative in rock)."""
    x = np.asarray(x, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)
    wobble = (fbm2(x * 0.0 + 11.0, z, 0.035, 5) - 0.5) * 14.0
    left = _curve(z, _LEFT) + wobble + (fbm2(x, z, 0.06, 9) - 0.5) * 7.0
    right = _curve(z, _RIGHT) - wobble * 0.6 + (fbm2(x, z, 0.06, 23) - 0.5) * 7.0
    # Two alcoves give the side thirds of the picture somewhere deep to look into.
    left = left + 13.0 * np.exp(-((z + 34.0) / 11.0) ** 2)
    right = right + 12.0 * np.exp(-((z + 56.0) / 12.0) ** 2)
    return np.where(x < 0.0, left + x, right - x)


def _scatter(seed, count, region):
    rng = np.random.default_rng(seed)
    x0, x1, z0, z1 = region
    return np.column_stack([rng.uniform(x0, x1, count), rng.uniform(z0, z1, count), rng.random(count),
                            rng.random(count)])


@lru_cache(maxsize=None)
def stalactites():
    """(x, z, radius, length) of every hanging formation, deterministic."""
    items = []
    for x, z, a, b in _scatter(71, 420, (-70.0, 70.0, -122.0, 36.0)):
        density = fbm2(np.array([x]), np.array([z]), 0.05, 301)[0]
        if density < 0.47:
            continue
        length = 1.2 + (a ** 2.2) * 9.5
        items.append((x, z, 0.5 + length * (0.1 + b * 0.09), length))
    # A few authored giants hang into the top of the picture.
    items += [(-9.0, -14.0, 1.9, 13.0), (12.5, -20.0, 1.7, 11.0), (-21.0, -6.0, 1.5, 8.5), (25.0, -9.0, 1.6, 9.5),
              (4.0, -38.0, 2.1, 15.0), (-16.0, -44.0, 1.8, 12.0), (30.0, -30.0, 1.8, 12.5), (-38.0, -18.0, 1.6, 10.0),
              (1.0, 6.0, 1.3, 6.0), (-13.0, 12.0, 1.2, 5.0), (15.0, 9.0, 1.3, 5.5)]
    return items


@lru_cache(maxsize=None)
def stalagmites():
    """(x, z, radius, height) of every standing formation."""
    items = []
    for x, z, a, b in _scatter(137, 300, (-70.0, 70.0, -120.0, 30.0)):
        density = fbm2(np.array([x]), np.array([z]), 0.06, 417)[0]
        if density < 0.5:
            continue
        height = 0.8 + (a ** 2.0) * 6.5
        items.append((x, z, 0.55 + height * (0.13 + b * 0.1), height))
    return items


def _cones(x, z, items, power):
    total = np.zeros(np.broadcast(x, z).shape)
    for cx, cz, radius, length in items:
        near = (np.abs(x - cx) < radius * 2.6) & (np.abs(z - cz) < radius * 2.6)
        if not near.any():
            continue
        r = np.hypot(x[near] - cx, z[near] - cz) / (radius * 2.6)
        # A flared root that narrows quickly to a long point.
        profile = np.clip(1.0 - r, 0.0, 1.0) ** power
        total[near] = np.maximum(total[near], length * profile)
    return total


def fields(x, z):
    """Return (floor, ceiling) heights for plan coordinates, as arrays."""
    x = np.asarray(x, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)
    inside = wall_distance(x, z)

    # ---- floor: a bank under each wall falling to a pool that deepens to the middle.
    shore = 12.5 + (fbm2(x, z, 0.045, 61) - 0.5) * 9.0
    bank = np.clip(1.0 - inside / shore, 0.0, 1.6)
    rough = (fbm2(x, z, 0.16, 77) - 0.5)
    ground = POOL_LEVEL + 0.25 + 3.1 * bank ** 1.25 + rough * 1.1 * smoothstep(0.0, 0.5, bank)
    basin = POOL_LEVEL - 0.25 - 5.2 * smoothstep(0.0, 11.0, inside - shore) + rough * 0.7
    floor = np.where(inside < shore, ground, basin)
    for cx, cz, radius, height in ISLANDS:
        mound = np.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (radius * radius))
        floor = np.maximum(floor, POOL_LEVEL - 4.0 + (4.0 + height) * mound + rough * 0.5)
    # Rock in the lower corners of the picture frames the player's view.
    for cx, cz, radius, top in ((-17.5, 21.0, 7.5, -0.6), (18.5, 20.0, 7.0, -1.4)):
        mound = np.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (radius * radius))
        floor = np.maximum(floor, POOL_LEVEL - 2.0 + (top - POOL_LEVEL + 2.0) * mound)
    floor = floor + _cones(x, z, stalagmites(), 1.7) * smoothstep(-2.0, 3.0, shore - inside + 6.0 * rough)

    # ---- vault: an arch from wall to wall, lumpy, hung with stalactites.
    span = np.maximum(_curve(z, _LEFT) + _curve(z, _RIGHT), 1.0) * 0.5
    rise = np.clip(inside / (span * 0.72), 0.0, 1.0)
    arch = np.sqrt(np.clip(1.0 - (1.0 - rise) ** 2, 0.0, 1.0))
    vault = _curve(z, _VAULT) * (0.82 + 0.36 * fbm2(x, z, 0.03, 91))
    ceiling = POOL_LEVEL + 1.5 + vault * arch + (fbm2(x, z, 0.11, 131) - 0.5) * 4.2 * arch
    ceiling = ceiling - _cones(x, z, stalactites(), 1.9) * smoothstep(0.1, 0.5, arch)
    chimney = np.exp(-((x - SKYLIGHT["x"]) ** 2 + (z - SKYLIGHT["z"]) ** 2) / (SKYLIGHT["radius"] ** 2))
    ceiling = ceiling + 46.0 * smoothstep(0.25, 0.9, chimney)

    # ---- columns: pull the vault down and the floor up until they meet.
    for cx, cz, radius in COLUMNS:
        r = np.hypot(x - cx, z - cz) / radius
        column = np.clip(1.25 - r * 0.42, 0.0, 1.0) ** 2.2
        waist = (floor + ceiling) * 0.5
        floor = floor + (waist - floor + 0.8) * column
        ceiling = ceiling - (ceiling - waist + 0.8) * column

    # ---- seal: outside the hall the vault is below the floor.
    ceiling = np.where(inside < 0.0, np.minimum(ceiling, floor - 1.0), ceiling)
    return floor, ceiling
