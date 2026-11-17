"""Sunset's karst islands, modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sunset_islands.py -- \
        --out src/themes/sunset/sunset-islands-model.js [--preview <dir>]

or from a live Blender (the MCP): `runpy.run_path(<this file>, run_name="sunset_islands")["show"]()`
builds the same islands in a scene of its own ("SunsetIslands"), one object an island, and leaves
every other scene alone.

The sea stacks of the Andaman coast: limestone that stands straight out of the water, its foot
cut back by the sea into a dark notch, its walls leaning out over it in tiers, fluted and stained
by the rain, and a cap of jungle on every surface a tree can hold to. Four of them, real size in
metres, the waterline at y = 0, each a few metres deeper than the water so the sea cuts it clean:

    tower   a tall leaning tower with a lower shoulder (about 130 m high, 140 m across)
    ridge   a long island of three humps, one end a sheer cliff (about 80 m high, 450 m long)
    stack   a top-heavy needle with a rock at its foot (about 40 m)
    islet   a low rounded islet under jungle (about 25 m high, 120 m long)

The theme sees them from 1.2 to 8 km, 15 to 120 px tall and mostly against the light, so they
are built for the outline: no two alike, and each one's own from every side (the theme turns,
scales and mirrors them, so four shapes stand as fourteen islands).

How one is made. Its rock is an implicit solid sampled on a grid (numpy): a few upright lumps
with their own profiles, leaned and melted into one, then worked the way the weather works
limestone: broad swells and hollows, upright flutes, tiers that step back at a ledge and lean out
again above it, and the notch at the waterline. The jungle is a skin laid on the rock wherever it
faces up, heaped into crowns. The solid is turned into a mesh by surface nets, handed to Blender,
and brought down to the game's budget by Blender's Decimate modifier. Each vertex of the game
mesh then gets its paint (limestone, stain or jungle from the slope, the height and noise), an
ambient occlusion traced against the full mesh with Blender's BVH, and in alpha how much of it is
foliage. A few points round each foot are kept too: where a lamp could hang at dusk.

Blender is z up; the game is y up. `to_b` / `to_g` turn one into the other (a rotation, so the
faces keep their winding).

Deterministic: the same script writes the same file, headless or from the live session.
"""

import base64
import json
import math
import sys
from array import array
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

TAG = "[sunset-islands]"
SCENE = "SunsetIslands"
QUANT = 0.01  # metres per unit of the stored positions
SEA_FLOOR = -4.5  # the solids end this far under the water
KEEP_BELOW = -3.0  # faces wholly under this are never seen and are left out


# ── Colours (sRGB hex → linear) ───────────────────────────────────────────────

def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return np.array([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c])


ROCK = {
    "cream": lin("#c8b996"),   # clean limestone in the light
    "grey": lin("#938d80"),    # weathered faces
    "pale": lin("#ddd3bb"),    # fresh breaks, the undersides of tiers
    "ochre": lin("#c48a3a"),   # iron stains run down from the ledges
    "rust": lin("#9c5526"),
    "seep": lin("#35322d"),    # dark seepage where water comes out of the rock
    "wet": lin("#1b1917"),     # the notch, always wet
    "tide": lin("#565040"),    # the band the tide leaves above it
}
JUNGLE = {
    "deep": lin("#234a21"),
    "mid": lin("#3d6d2f"),
    "crown": lin("#6d993b"),
    "dry": lin("#93a04b"),
}


# ── Noise (numpy; its own hash, so the same everywhere) ───────────────────────

def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.int64).astype(np.uint64) * np.uint64(0x9E3779B1)
         + iy.astype(np.int64).astype(np.uint64) * np.uint64(0x85EBCA77)
         + iz.astype(np.int64).astype(np.uint64) * np.uint64(0xC2B2AE3D)
         + np.uint64(seed) * np.uint64(0x27D4EB2F)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(15)
    h = (h * np.uint64(0x2C1B3C6D)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(12)
    h = (h * np.uint64(0x297A2D39)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(15)
    return h.astype(np.float64) / 4294967296.0


def vnoise(x, y, z, seed):
    """Value noise, 0..1."""
    x0, y0, z0 = np.floor(x), np.floor(y), np.floor(z)
    fx, fy, fz = x - x0, y - y0, z - z0
    ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
    ix, iy, iz = x0.astype(np.int64), y0.astype(np.int64), z0.astype(np.int64)

    def corner(dx, dy, dz):
        return _hash(ix + dx, iy + dy, iz + dz, seed)

    x00 = corner(0, 0, 0) * (1 - ux) + corner(1, 0, 0) * ux
    x10 = corner(0, 1, 0) * (1 - ux) + corner(1, 1, 0) * ux
    x01 = corner(0, 0, 1) * (1 - ux) + corner(1, 0, 1) * ux
    x11 = corner(0, 1, 1) * (1 - ux) + corner(1, 1, 1) * ux
    y0v = x00 * (1 - uy) + x10 * uy
    y1v = x01 * (1 - uy) + x11 * uy
    return y0v * (1 - uz) + y1v * uz


def fbm(x, y, z, seed, octaves=4, gain=0.5):
    """Fractal value noise, 0..1 with its mean at 0.5."""
    total, amp, norm, f = 0.0, 1.0, 0.0, 1.0
    for o in range(octaves):
        total = total + vnoise(x * f + o * 17.3, y * f + o * 9.1, z * f + o * 31.7, seed + o * 101) * amp
        norm += amp
        amp *= gain
        f *= 2.03
    return total / norm


def worley(x, y, z, seed):
    """Distance to the nearest feature point of a jittered lattice (cells of 1), 0 at a point."""
    x0, y0, z0 = np.floor(x), np.floor(y), np.floor(z)
    ix, iy, iz = x0.astype(np.int64), y0.astype(np.int64), z0.astype(np.int64)
    best = np.full(np.shape(x), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cx, cy, cz = ix + dx, iy + dy, iz + dz
                px = cx + 0.15 + 0.7 * _hash(cx, cy, cz, seed)
                py = cy + 0.15 + 0.7 * _hash(cx, cy, cz, seed + 7)
                pz = cz + 0.15 + 0.7 * _hash(cx, cy, cz, seed + 13)
                d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2
                best = np.minimum(best, d)
    return np.sqrt(best)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    """A smooth minimum: two solids melted into one over `k` metres."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1 - h)


# ── The islands ───────────────────────────────────────────────────────────────

# Each island: its lumps, and how the weather worked it. Metres; the game's frame. A lump is an
# upright solid on an elliptical foot: `c` its centre (x, z), `r` its radii along and across,
# `turn` how far the foot is turned (degrees), `h` its height, `lean` how far it leans per metre
# of height (x, z), `flare` how much narrower its foot is than its body, `dome` where its top
# starts to close (a share of its height) and `power` how that top closes (2 round, less pointed,
# more square).
def lump(c, r, h, turn=0.0, lean=(0.0, 0.0), flare=0.1, dome=0.5, power=2.0):
    return {"c": c, "r": r, "h": h, "turn": turn, "lean": lean, "flare": flare, "dome": dome, "power": power}


ISLANDS = [
    {
        "name": "tower",
        "seed": 11,
        "voxel": 2.4,
        "triangles": 3000,
        "blend": 6.5,
        "lumps": [
            # The tower itself, leaning out over its right-hand foot.
            lump((9.0, 0.0), (36.0, 32.0), 123.0, turn=18, lean=(0.14, 0.02), flare=0.32, dome=0.6, power=2.1),
            # Its shoulder, lower and to the left.
            lump((-33.0, -5.0), (27.0, 30.0), 74.0, turn=-10, lean=(-0.07, 0.03), flare=0.26, dome=0.5,
                 power=1.9),
            # A pinnacle split off its right side, hanging out further still.
            lump((47.0, 9.0), (16.0, 15.0), 62.0, turn=0, lean=(0.2, 0.0), flare=0.36, dome=0.62, power=1.8),
            # A buttress on the near side.
            lump((8.0, 31.0), (22.0, 18.0), 44.0, turn=30, lean=(0.03, -0.04), flare=0.22, dome=0.3,
                 power=1.7),
        ],
        # Sea caves at the foot: centre (x, y, z) and radii.
        "caves": [
            ((-55.0, 1.0, 13.0), (11.0, 9.0, 10.0)),
            ((3.0, 1.0, -30.0), (10.0, 8.0, 10.0)),
            ((42.0, 1.5, 25.0), (8.0, 8.0, 9.0)),
        ],
        "notch": 8.0,
        "swell": (6.5, 44.0),
        "flutes": (4.2, 15.0),
        "tiers": (2.6, 31.0, 9.0),
        "canopy": (9.0, 15.0),
        "spine": [(9.0, 0.0), (-33.0, -5.0), (47.0, 9.0)],
    },
    {
        "name": "ridge",
        "seed": 23,
        "voxel": 3.0,
        "triangles": 3300,
        "blend": 14.0,
        "lumps": [
            # The high end: it is cut off sheer (see "cuts").
            lump((-138.0, 0.0), (74.0, 47.0), 76.0, lean=(-0.05, 0.03), flare=0.16, dome=0.2, power=1.8),
            lump((-30.0, 8.0), (66.0, 42.0), 40.0, turn=8, lean=(0.0, -0.03), flare=0.14, dome=0.15,
                 power=1.8),
            lump((84.0, -4.0), (58.0, 44.0), 61.0, turn=-6, lean=(0.06, 0.02), flare=0.16, dome=0.18,
                 power=1.55),
            # The low end, running down into the sea, and a rock off it.
            lump((168.0, 3.0), (46.0, 29.0), 20.0, turn=10, flare=0.0, dome=0.1, power=1.9),
            lump((238.0, -5.0), (14.0, 11.5), 17.0, lean=(0.06, 0.0), flare=0.1, dome=0.5, power=1.8),
        ],
        # The sheer end: everything beyond a plane that leans out over the water is gone.
        "cuts": [{"at": (-172.0, 0.0), "normal": (-1.0, 0.12), "lean": 0.13}],
        "caves": [((-166.0, 1.5, 6.0), (9.0, 9.0, 11.0)), ((60.0, 1.0, 36.0), (10.0, 7.0, 9.0))],
        "notch": 6.0,
        "swell": (6.0, 50.0),
        "flutes": (3.4, 16.0),
        "tiers": (2.2, 26.0, 8.0),
        "canopy": (9.0, 16.0),
        "spine": [(-138.0, 0.0), (-30.0, 8.0), (84.0, -4.0), (168.0, 3.0)],
    },
    {
        "name": "stack",
        "seed": 37,
        "voxel": 1.1,
        "triangles": 950,
        "blend": 3.0,
        "lumps": [
            lump((0.0, 0.0), (12.5, 10.5), 40.0, turn=25, lean=(0.15, -0.05), flare=0.44, dome=0.7, power=1.8),
            # A rock at its foot.
            lump((-21.0, 5.0), (7.5, 6.5), 11.0, lean=(-0.08, 0.0), flare=0.12, dome=0.45, power=1.8),
        ],
        "notch": 2.4,
        "swell": (2.2, 15.0),
        "flutes": (1.3, 6.0),
        "tiers": (0.9, 12.0, 3.0),
        "canopy": (4.6, 7.0),
        "spine": [(0.0, 0.0)],
    },
    {
        "name": "islet",
        "seed": 53,
        "voxel": 1.8,
        "triangles": 1500,
        "blend": 10.0,
        "lumps": [
            lump((-14.0, 0.0), (46.0, 27.0), 20.0, turn=6, flare=0.06, dome=0.0, power=2.1),
            lump((34.0, 3.0), (27.0, 19.0), 10.5, turn=-12, flare=0.06, dome=0.0, power=1.9),
        ],
        "notch": 3.0,
        "swell": (2.6, 28.0),
        "flutes": (1.2, 8.0),
        "tiers": (0.0, 12.0, 3.0),
        "canopy": (6.5, 15.0),
        "jungle_from": (3.5, 8.0),
        "spine": [(-14.0, 0.0), (34.0, 3.0)],
    },
]


def lump_field(spec, X, Y, Z):
    """One upright lump: metres outside its wall (negative inside), to first order."""
    cx, cz = spec["c"]
    xs = X - cx - spec["lean"][0] * np.maximum(Y, 0.0)
    zs = Z - cz - spec["lean"][1] * np.maximum(Y, 0.0)
    a = math.radians(spec["turn"])
    u = xs * math.cos(a) + zs * math.sin(a)
    w = -xs * math.sin(a) + zs * math.cos(a)
    ra, rb = spec["r"]
    q = np.sqrt((u / ra) ** 2 + (w / rb) ** 2)
    t = Y / spec["h"]
    # Narrower at the foot, its full width from half way up.
    body = 1.0 - spec["flare"] * (1.0 - smooth(0.0, 0.5, t))
    qb = q / body
    # Above the spring line the top closes like a (super)ellipse.
    rise = (1.0 - spec["dome"]) * spec["h"]
    s = np.maximum(t - spec["dome"], 0.0) * spec["h"] / rise
    p = spec["power"]
    r = (qb ** p + s ** p) ** (1.0 / p)
    # (r - 1) over its own gradient: metres, the same along the wall and over the top.
    safe = np.maximum(r, 1e-6)
    dq = (qb / safe) ** (p - 1.0)
    ds = (s / safe) ** (p - 1.0)
    gq = np.sqrt((u / ra ** 2) ** 2 + (w / rb ** 2) ** 2) / np.maximum(q, 1e-6)
    grad = np.sqrt((dq * gq / body) ** 2 + (ds / rise) ** 2)
    return (r - 1.0) / np.maximum(grad, 0.4 / max(ra, rb))


def rock_field(spec, X, Y, Z):
    """The bare limestone: the lumps melted together, then weathered."""
    seed = spec["seed"]
    f = None
    for part in spec["lumps"]:
        d = lump_field(part, X, Y, Z)
        f = d if f is None else smin(f, d, spec["blend"])
    # Broad swells and hollows: no wall is a ruled surface, no plan an ellipse.
    amp, scale = spec["swell"]
    f = f - amp * (fbm(X / scale, Y / (scale * 1.3), Z / scale, seed + 1, 3) * 2 - 1)
    # Tiers: at a ledge the wall steps back, then leans out again until the next one. The ledges
    # wander up and down round the island and come and go along it.
    step_in, step, wander = spec["tiers"]
    if step_in > 0:
        level = (Y + wander * (fbm(X / (scale * 1.4), Y / 300.0, Z / (scale * 1.4), seed + 2, 2) * 2 - 1)) / step
        fr = level - np.floor(level)
        here = smooth(0.38, 0.62, fbm(X / (scale * 0.9), Y / 200.0, Z / (scale * 0.9), seed + 9, 2))
        f = f + step_in * here * smooth(0.0, 0.26, fr) * (1 - fr) ** 1.3 * smooth(0.25, 0.9, level)
    # Flutes: upright ribs with rounded gullies between them, the rain's work.
    amp, scale = spec["flutes"]
    v = vnoise(X / scale, Y / (scale * 7.0), Z / scale, seed + 3)
    v2 = vnoise(X / (scale * 0.45), Y / (scale * 4.0), Z / (scale * 0.45), seed + 4)
    ribs = (1 - np.abs(2 * v - 1)) * 0.7 + (1 - np.abs(2 * v2 - 1)) * 0.3
    f = f - amp * (ribs - 0.55) * 2
    # The sea's notch: under the tide line the foot is cut back, so the wall overhangs the water.
    f = f + spec["notch"] * (1 - smooth(1.2, 8.5, Y))
    cuts_and_caves(spec, X, Y, Z, f)
    return f


def cuts_and_caves(spec, X, Y, Z, f):
    """A sheer end cut off by a leaning plane, and the caves the sea has hollowed at the foot (in place)."""
    seed = spec["seed"]
    for cut in spec.get("cuts", ()):
        nx, nz = cut["normal"]
        norm = math.hypot(nx, nz)
        ax, az = cut["at"]
        beyond = ((X - ax) * nx + (Z - az) * nz) / norm - cut["lean"] * Y
        rough = 5.0 * (fbm(Y / 22.0, Z / 22.0, X / 60.0, seed + 5, 3) * 2 - 1)
        np.maximum(f, beyond + rough, out=f)
    for (cx, cy, cz), (rx, ry, rz) in spec.get("caves", ()):
        # (An ellipsoid, in metres from its wall, a little ragged.)
        q = np.sqrt(((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 + ((Z - cz) / rz) ** 2)
        inside = (1.0 - q) * min(rx, ry, rz) + 1.5 * (fbm(X / 7.0, Y / 7.0, Z / 7.0, seed + 30, 2) * 2 - 1)
        np.maximum(f, inside, out=f)


def crown_field(spec, x, y, z):
    """The jungle's crowns: 1 at a clump's heart, 0 between clumps."""
    cell = spec["canopy"][1]
    return np.clip(1.25 - 1.75 * worley(x / cell, y / cell, z / cell, spec["seed"] + 8), 0.0, 1.0)


def canopy_field(spec, X, Y, Z, rock, h):
    """How deep the jungle lies on the rock here (metres): on what faces up, heaped into crowns."""
    seed = spec["seed"]
    gx, gy, gz = np.gradient(rock, h, edge_order=1)
    up = gy / np.maximum(np.sqrt(gx * gx + gy * gy + gz * gz), 1e-6)
    patch = fbm(X / 34.0, Y / 34.0, Z / 34.0, seed + 6, 3)
    # Tops and ledges hold trees; in places they hang on to steeper ground and spill over a rim.
    hold = smooth(0.3, 0.62, up + (patch - 0.5) * 0.8)
    # None in the spray near the water.
    lo, hi = spec.get("jungle_from", (5.5, 13.0))
    hold = hold * smooth(lo, hi, Y + (patch - 0.5) * 6.0)
    return spec["canopy"][0] * hold * (0.3 + 0.7 * crown_field(spec, X, Y, Z))


def island_grid(spec):
    """The grid one island is sampled on: its origin, its spacing and the three coordinate arrays."""
    h = spec["voxel"]
    lo = np.array([1e9, SEA_FLOOR - 2 * h, 1e9])
    hi = np.array([-1e9, 0.0, -1e9])
    for part in spec["lumps"]:
        r = max(part["r"])
        top = part["h"]
        for y in (0.0, top):
            cx = part["c"][0] + part["lean"][0] * y
            cz = part["c"][1] + part["lean"][1] * y
            lo = np.minimum(lo, [cx - r, lo[1], cz - r])
            hi = np.maximum(hi, [cx + r, top, cz + r])
    margin = spec["swell"][0] + spec["flutes"][0] * 2 + spec["canopy"][0] + 4 * h
    lo = lo - [margin, 0.0, margin]
    hi = hi + [margin, margin, margin]
    n = np.ceil((hi - lo) / h).astype(int) + 1
    axes = [lo[i] + h * np.arange(n[i]) for i in range(3)]
    X, Y, Z = np.meshgrid(*axes, indexing="ij")
    return lo, h, X, Y, Z


def solid_field(spec):
    lo, h, X, Y, Z = island_grid(spec)
    rock = rock_field(spec, X, Y, Z)
    canopy = canopy_field(spec, X, Y, Z, rock, h)
    f = rock - canopy
    # It ends a little under the water.
    f = np.maximum(f, SEA_FLOOR - Y)
    return {"origin": lo, "h": h, "f": f, "rock": rock, "canopy": canopy}


# ── Surface nets: the solid's skin as quads ───────────────────────────────────

def surface_nets(f, origin, h):
    """The zero surface of `f` (negative inside) as vertices and outward-facing quads."""
    nx, ny, nz = f.shape
    cx, cy, cz = nx - 1, ny - 1, nz - 1
    inside = f < 0

    def corner(a, o):
        return a[o[0]:o[0] + cx, o[1]:o[1] + cy, o[2]:o[2] + cz]

    pos = np.zeros((cx, cy, cz, 3))
    count = np.zeros((cx, cy, cz))
    corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    for a in corners:
        for axis in range(3):
            if a[axis] == 1:
                continue
            b = list(a)
            b[axis] = 1
            fa, fb = corner(f, a), corner(f, b)
            crossing = (fa < 0) != (fb < 0)
            t = np.where(crossing, fa / np.where(crossing, fa - fb, 1.0), 0.0)
            for c in range(3):
                pos[..., c] += np.where(crossing, a[c] + t * (b[c] - a[c]), 0.0)
            count += crossing
    active = count > 0
    ids = -np.ones((cx, cy, cz), dtype=np.int64)
    ids[active] = np.arange(int(active.sum()))
    cells = np.argwhere(active)
    verts = (cells + pos[active] / count[active][:, None]) * h + origin

    quads = []
    # An edge of the lattice that crosses the surface is shared by four cells: their vertices are
    # a quad. Which way it faces follows from which end of the edge is inside.
    # Along x.
    a = inside[:-1, 1:-1, 1:-1]
    b = inside[1:, 1:-1, 1:-1]
    e = np.argwhere(a != b)
    i, j, k = e[:, 0], e[:, 1] + 1, e[:, 2] + 1
    q = np.stack([ids[i, j - 1, k - 1], ids[i, j, k - 1], ids[i, j, k], ids[i, j - 1, k]], axis=1)
    flip = ~a[e[:, 0], e[:, 1], e[:, 2]]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    # Along y.
    a = inside[1:-1, :-1, 1:-1]
    b = inside[1:-1, 1:, 1:-1]
    e = np.argwhere(a != b)
    i, j, k = e[:, 0] + 1, e[:, 1], e[:, 2] + 1
    q = np.stack([ids[i - 1, j, k - 1], ids[i - 1, j, k], ids[i, j, k], ids[i, j, k - 1]], axis=1)
    flip = ~a[e[:, 0], e[:, 1], e[:, 2]]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    # Along z.
    a = inside[1:-1, 1:-1, :-1]
    b = inside[1:-1, 1:-1, 1:]
    e = np.argwhere(a != b)
    i, j, k = e[:, 0] + 1, e[:, 1] + 1, e[:, 2]
    q = np.stack([ids[i - 1, j - 1, k], ids[i, j - 1, k], ids[i, j, k], ids[i - 1, j, k]], axis=1)
    flip = ~a[e[:, 0], e[:, 1], e[:, 2]]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    quads = np.concatenate(quads, axis=0)
    if (quads < 0).any():
        raise RuntimeError(f"{TAG} the surface reaches the edge of its grid")
    return verts, quads


def sample(grid, origin, h, pts):
    """A grid field read at points (trilinear)."""
    g = (np.asarray(pts) - origin) / h
    shape = np.array(grid.shape)
    i0 = np.clip(np.floor(g).astype(int), 0, shape - 2)
    t = np.clip(g - i0, 0.0, 1.0)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = ((t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1])
                     * (t[:, 2] if dz else 1 - t[:, 2]))
                out = out + w * grid[i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz]
    return out


# ── Blender ───────────────────────────────────────────────────────────────────

def to_b(p):
    return (p[0], -p[2], p[1])


def to_g(p):
    return (p[0], p[2], -p[1])


def decimate(scene, name, verts, quads, triangles):
    """The full mesh as a Blender object, and what the Decimate modifier leaves of it."""
    mesh = bpy.data.meshes.new(f"{name}Full")
    mesh.from_pydata([to_b(v) for v in verts.tolist()], [], quads.tolist())
    mesh.update()
    obj = bpy.data.objects.new(f"{name} full", mesh)
    scene.collection.objects.link(obj)
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.use_collapse_triangulate = True
    # The faces under the water are thrown away afterwards: aim a little high, then trim.
    mod.ratio = min(1.0, triangles / (len(quads) * 2.0))
    # A scene of its own has no depsgraph until a frame is set on it.
    scene.frame_set(scene.frame_current)
    depsgraph = scene.view_layers[0].depsgraph
    ev = obj.evaluated_get(depsgraph)
    low = ev.to_mesh()
    low.calc_loop_triangles()
    out_verts = np.array([to_g(v.co) for v in low.vertices])
    out_tris = np.array([tuple(t.vertices) for t in low.loop_triangles], dtype=np.int64)
    ev.to_mesh_clear()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    return out_verts, out_tris


def trim(verts, tris):
    """Leave out what is never seen (faces wholly under the water) and the vertices nothing uses."""
    keep = (verts[tris][:, :, 1] > KEEP_BELOW).any(axis=1)
    tris = tris[keep]
    used = np.unique(tris)
    remap = -np.ones(len(verts), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return verts[used], remap[tris]


def vertex_normals(verts, tris):
    n = np.zeros_like(verts)
    face = np.cross(verts[tris[:, 1]] - verts[tris[:, 0]], verts[tris[:, 2]] - verts[tris[:, 0]])
    for c in range(3):
        np.add.at(n, tris[:, c], face)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)


def hemisphere(n):
    """`n` directions over a hemisphere about +z, cosine weighted (a spiral: the same every run)."""
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        r = math.sqrt(u)
        a = i * 2.39996323
        out.append((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u))))
    return out


def occlusion(bvh, verts, normals, reach, rays=40):
    """How open each vertex is to the sky and the sea round it (1 open, 0 shut in)."""
    dirs = hemisphere(rays)
    out = np.zeros(len(verts))
    for i in range(len(verts)):
        n = Vector(normals[i])
        ref = Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))
        t = n.cross(ref).normalized()
        b = n.cross(t)
        origin = Vector(verts[i]) + n * (reach * 0.02)
        seen = 0.0
        for dx, dy, dz in dirs:
            d = t * dx + b * dy + n * dz
            hit = bvh.ray_cast(origin, d, reach)
            if hit[0] is None:
                seen += 1.0
            else:
                # A wall a long way off shuts out less than one at arm's length.
                seen += (hit[3] / reach) ** 1.5 * 0.6
        out[i] = seen / len(dirs)
    return out


def paint(spec, field, verts, normals, ao):
    """Per vertex: linear albedo times the occlusion, and how much of it is jungle."""
    seed = spec["seed"]
    x, y, z = verts[:, 0], verts[:, 1], verts[:, 2]
    depth = sample(field["canopy"], field["origin"], field["h"], verts)
    jungle = smooth(0.45, 2.0, depth)
    ny = normals[:, 1]

    # The limestone: cream and weathered grey in broad patches, paler under the tiers.
    broad = fbm(x / 38.0, y / 26.0, z / 38.0, seed + 20, 3)
    rock = ROCK["cream"][None, :] * (1 - smooth(0.4, 0.66, broad))[:, None] \
        + ROCK["grey"][None, :] * smooth(0.4, 0.66, broad)[:, None]
    under = smooth(-0.05, -0.5, ny)[:, None]
    rock = rock * (1 - under * 0.55) + ROCK["pale"][None, :] * under * 0.55
    # Stains run straight down the walls: ochre and rust from the ledges, dark where water seeps.
    scale = spec["flutes"][1]
    run = vnoise(x / (scale * 0.8), y / (scale * 9.0), z / (scale * 0.8), seed + 21)
    run2 = vnoise(x / (scale * 0.5), y / (scale * 7.0), z / (scale * 0.5), seed + 22)
    wall = smooth(0.75, 0.35, np.abs(ny))
    ochre = (smooth(0.46, 0.74, run) * wall * (0.55 + 0.45 * smooth(0.3, 0.7, broad)))[:, None]
    rock = rock * (1 - ochre * 0.85) + (ROCK["ochre"] * 0.6 + ROCK["rust"] * 0.4)[None, :] * ochre * 0.85
    seep = (smooth(0.54, 0.82, run2) * wall * (0.45 + 0.55 * (1 - ao)))[:, None]
    rock = rock * (1 - seep * 0.88) + ROCK["seep"][None, :] * seep * 0.88
    # The notch: wet and dark, a duller band where the tide has been. (Taller than the sea
    # cuts it: at a kilometre and a half a true notch is under a pixel.)
    reach = spec["notch"] / 7.0
    tide = smooth(5.0 + 7.0 * reach, 2.0 + 4.0 * reach, y)[:, None]
    rock = rock * (1 - tide * 0.55) + ROCK["tide"][None, :] * tide * 0.55
    wet = smooth(2.0 + 5.0 * reach, 1.0 + 2.5 * reach, y)[:, None]
    rock = rock * (1 - wet * 0.92) + ROCK["wet"][None, :] * wet * 0.92

    # The jungle: deep green, the crowns lighter, a dry yellow-green here and there.
    crowns = crown_field(spec, x, y, z)
    tone = fbm(x / 24.0, y / 24.0, z / 24.0, seed + 23, 3)
    green = JUNGLE["deep"][None, :] * (1 - crowns)[:, None] + JUNGLE["mid"][None, :] * crowns[:, None]
    lit = (crowns * smooth(0.2, 0.8, ny))[:, None]
    green = green * (1 - lit * 0.55) + JUNGLE["crown"][None, :] * lit * 0.55
    dry = (smooth(0.62, 0.8, tone) * 0.5)[:, None]
    green = green * (1 - dry) + JUNGLE["dry"][None, :] * dry

    j = jungle[:, None]
    albedo = rock * (1 - j) + green * j
    # Occlusion: rock keeps a floor (the sea and the sky light a wall from every side); the
    # jungle's own depth is darker still between the crowns.
    shade = 0.3 + 0.7 * np.clip(ao, 0.0, 1.0) ** 1.25
    shade = shade * (1 - jungle * 0.3 * (1 - crowns))
    rgba = np.concatenate([albedo * shade[:, None], jungle[:, None]], axis=1)
    return np.clip(rgba, 0.0, 1.0)


def lamp_points(spec, bvh):
    """Points round the foot, just over the water, where a lamp could hang: the notch's wall."""
    points = []
    spine = spec["spine"]
    n = 14
    for k in range(n):
        a = 2 * math.pi * (k + 0.5) / n
        d = Vector((math.cos(a), 0.0, math.sin(a)))
        # From far out toward the lump of the spine that reaches furthest this way.
        cx, cz = max(spine, key=lambda c: c[0] * d.x + c[1] * d.z)
        height = 2.6 + 2.4 * ((k * 7) % 5) / 4
        origin = Vector((cx, height, cz)) + d * 600.0
        hit = bvh.ray_cast(origin, -d, 700.0)
        if hit[0] is None:
            continue
        p = hit[0] + d * 1.6
        points.append([round(p.x, 2), round(p.y, 2), round(p.z, 2)])
    return points


def build_island(scene, spec):
    """One island: its game mesh as arrays, its Blender object, and what was measured."""
    field = solid_field(spec)
    full_verts, quads = surface_nets(field["f"], field["origin"], field["h"])
    # Outward faces: the solid's volume is positive.
    centre = full_verts.mean(axis=0)
    shifted = full_verts - centre
    volume = 0.0
    for q in (quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]):
        volume += np.einsum("ij,ij->i", shifted[q[:, 0]], np.cross(shifted[q[:, 1]], shifted[q[:, 2]])).sum()
    if volume < 0:
        quads = quads[:, ::-1]
    bvh = BVHTree.FromPolygons([Vector(v) for v in full_verts.tolist()], quads.tolist())

    # Aim the Decimate modifier so that what is left above the water meets the budget.
    want = spec["triangles"]
    aim = want
    verts = tris = None
    for _ in range(6):
        low_verts, low_tris = decimate(scene, spec["name"], full_verts, quads, aim)
        verts, tris = trim(low_verts, low_tris)
        if abs(len(tris) - want) <= max(8, want * 0.012):
            break
        aim = int(round(aim * want / max(1, len(tris))))

    normals = vertex_normals(verts, tris)
    # The slope the paint goes by is the solid's own (the game mesh's facets are coarse).
    eps = field["h"] * 0.75
    grad = np.stack([
        sample(field["f"], field["origin"], field["h"], verts + np.array(e) * eps)
        - sample(field["f"], field["origin"], field["h"], verts - np.array(e) * eps)
        for e in ((1, 0, 0), (0, 1, 0), (0, 0, 1))
    ], axis=1)
    true_normals = grad / np.maximum(np.linalg.norm(grad, axis=1, keepdims=True), 1e-9)
    reach = max(14.0, 0.45 * max(part["h"] for part in spec["lumps"]))
    ao = occlusion(bvh, verts, normals, reach)
    rgba = paint(spec, field, verts, true_normals, ao)
    lamps = lamp_points(spec, bvh)

    mesh = bpy.data.meshes.new(f"SunsetIsland{spec['name'].title()}")
    mesh.from_pydata([to_b(v) for v in verts.tolist()], [], tris.tolist())
    mesh.update()
    col = mesh.color_attributes.new("paint", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(rgba.tolist()):
        col.data[i].color = (c[0], c[1], c[2], 1.0)
    mask = mesh.attributes.new("jungle", "FLOAT", "POINT")
    for i, c in enumerate(rgba.tolist()):
        mask.data[i].value = c[3]
    obj = bpy.data.objects.new(f"Island {spec['name']}", mesh)
    scene.collection.objects.link(obj)
    print(f"{TAG} {spec['name']}: {len(full_verts)} vertices in full, {len(verts)} vertices and {len(tris)} "
          f"triangles in the game, {round(float(verts[:, 1].max()), 1)} m high, "
          f"{round(float(verts[:, 0].max() - verts[:, 0].min()), 1)} x "
          f"{round(float(verts[:, 2].max() - verts[:, 2].min()), 1)} m, {len(lamps)} lamp points")
    return {
        "spec": spec, "object": obj, "verts": verts, "tris": tris, "rgba": rgba, "lamps": lamps,
    }


def build_islands(scene):
    return [build_island(scene, spec) for spec in ISLANDS]


# ── The module the theme imports ──────────────────────────────────────────────

def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def write_module(path, islands):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Sunset's karst islands: GENERATED by scripts/blender/sunset_islands.py (do not edit by hand).",
        " *",
        " * Limestone sea stacks modelled in Blender. Each shape in its own frame: metres, real size, y",
        " * up, the waterline at y = 0, its middle over the origin. `positions` are Int16 in units of",
        " * `quant` metres; `index` Uint16 triangles, facing outward; `colours` Uint8 linear albedo",
        " * times a baked ambient occlusion (r, g, b) and how much of the vertex is jungle (a / 255:",
        " * 0 bare rock, 1 foliage). `lamps` are points round the foot, just over the water, where a",
        " * light could hang at dusk. `radius` is the furthest any vertex stands from the y axis.",
        " */",
        "export const SUNSET_ISLANDS = Object.freeze({",
        f"    quant: {QUANT},",
        "    shapes: Object.freeze([",
    ]
    for island in islands:
        verts, tris, rgba = island["verts"], island["tris"], island["rgba"]
        if len(verts) >= 65536:
            raise RuntimeError(f"{TAG} {len(verts)} vertices do not fit a Uint16 index")
        positions = np.rint(verts / QUANT).astype(np.int64)
        if np.abs(positions).max() > 32767:
            raise RuntimeError(f"{TAG} {island['spec']['name']} does not fit Int16 at {QUANT} m")
        colours = np.rint(rgba * 255).astype(np.int64)
        size = verts.max(axis=0) - verts.min(axis=0)
        lines += [
            "        Object.freeze({",
            f"            name: '{island['spec']['name']}',",
            f"            vertexCount: {len(verts)},",
            f"            triangleCount: {len(tris)},",
            f"            height: {round(float(verts[:, 1].max()), 2)},",
            f"            size: {json.dumps([round(float(s), 2) for s in size])},",
            f"            radius: {round(float(np.hypot(verts[:, 0], verts[:, 2]).max()), 2)},",
            f"            lamps: {json.dumps(island['lamps'])},",
            f"            positions: '{b64('h', positions.reshape(-1).tolist())}',",
            f"            index: '{b64('H', tris.reshape(-1).tolist())}',",
            f"            colours: '{b64('B', colours.reshape(-1).tolist())}',",
            "        }),",
        ]
    lines += ["    ]),", "});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    total = sum(len(i["tris"]) for i in islands)
    print(f"{TAG} wrote {path}: {total} triangles, {Path(path).stat().st_size} bytes")
    return {"triangles": total, "bytes": Path(path).stat().st_size}


# ── Previews (Workbench, the paint as vertex colour) ──────────────────────────

def previews(scene, islands, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    world = scene.world or bpy.data.worlds.new("SunsetIslandsWorld")
    scene.world = world
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    cam_data = bpy.data.cameras.get("SunsetIslandsPreviewCam") or bpy.data.cameras.new("SunsetIslandsPreviewCam")
    cam = bpy.data.objects.get("SunsetIslandsPreviewCam") or bpy.data.objects.new("SunsetIslandsPreviewCam", cam_data)
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = "ORTHO"
    cam_data.clip_end = 4000

    def lit():
        shading.light = "STUDIO"
        shading.color_type = "VERTEX"
        shading.show_object_outline = False
        shading.show_cavity = False
        shading.show_shadows = True
        shading.shadow_intensity = 0.55
        scene.display.light_direction = (-0.45, 0.35, 0.82)
        world.color = (0.52, 0.66, 0.84)

    def silhouette():
        # Flat black against an evening sky, as the theme sees them at a low sun.
        shading.light = "FLAT"
        shading.color_type = "SINGLE"
        shading.single_color = (0.02, 0.016, 0.018)
        shading.show_shadows = False
        world.color = (0.95, 0.42, 0.14)

    def aim(centre, direction, scale):
        d = Vector(to_b(direction)).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.99 else Vector((0, 1, 0))
        right = up.cross(d).normalized()
        true_up = d.cross(right).normalized()
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = Matrix((right, true_up, d)).transposed().to_quaternion()
        cam.location = Vector(to_b(centre)) + d * 1500.0
        cam_data.ortho_scale = scale

    def render(name):
        path = out / f"{name}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        return str(path)

    files = []
    views = {
        # name: direction from the island to the camera (the game's frame)
        "side": (0.0, 0.03, 1.0),
        "back": (0.0, 0.03, -1.0),
        "end": (1.0, 0.03, 0.0),
        # From the sea, a quarter of the way round.
        "quarter": (-0.6, 0.03, 0.8),
        "three-quarter": (0.72, 0.34, 0.68),
    }
    for island in islands:
        for other in islands:
            other["object"].hide_render = other is not island
        verts = island["verts"]
        lo, hi = verts.min(axis=0), verts.max(axis=0)
        centre = ((lo[0] + hi[0]) / 2, (max(lo[1], 0.0) + hi[1]) / 2, (lo[2] + hi[2]) / 2)
        span = max(hi[0] - lo[0], hi[2] - lo[2], (hi[1] - 0.0) * 12 / 7)
        name = island["spec"]["name"]
        lit()
        for view, direction in views.items():
            aim(centre, direction, span * 1.12)
            files.append(render(f"islands-{name}-{view}"))
        silhouette()
        for view in ("side", "end", "quarter"):
            aim(centre, views[view], span * 1.12)
            files.append(render(f"islands-{name}-silhouette-{view}"))
    # All four on one sea at one scale, lit and in silhouette.
    cursor = 0.0
    for island in islands:
        obj = island["object"]
        obj.hide_render = False
        verts = island["verts"]
        obj.location = (cursor - float(verts[:, 0].min()), 0.0, 0.0)
        cursor += float(verts[:, 0].max() - verts[:, 0].min()) + 60.0
    width = cursor - 60.0
    scene.render.resolution_x = 2400
    lit()
    aim((width / 2, 48.0, 0.0), views["side"], width * 1.06)
    files.append(render("islands-all"))
    silhouette()
    files.append(render("islands-all-silhouette"))
    for island in islands:
        island["object"].location = (0.0, 0.0, 0.0)
    scene.render.resolution_x = 1200
    lit()
    return files


# ── Entry points ──────────────────────────────────────────────────────────────

def show(preview_dir=None, export_path=None):
    """Live Blender (the MCP): the islands in a scene of their own; nothing else touched."""
    old = bpy.data.scenes.get(SCENE)
    if old is not None:
        for o in list(old.objects):
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(SCENE)
    islands = build_islands(scene)
    # Side by side, so all four can be looked at.
    cursor = 0.0
    for island in islands:
        verts = island["verts"]
        report_x = cursor - float(verts[:, 0].min())
        cursor += float(verts[:, 0].max() - verts[:, 0].min()) + 60.0
        island["shown_at"] = report_x
    report = {"islands": [i["spec"]["name"] for i in islands]}
    if export_path:
        report.update(write_module(export_path, islands))
    if preview_dir:
        report["previews"] = previews(scene, islands, preview_dir)
    for island in islands:
        island["object"].location = (island["shown_at"], 0.0, 0.0)
    window = getattr(bpy.context, "window", None)
    if window is not None:
        window.scene = scene
    return report


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        if a == "--preview":
            preview_dir = argv[i + 1]
    # The same scene of its own the live session builds, so both write the same file.
    scene = bpy.data.scenes.new(SCENE)
    islands = build_islands(scene)
    if out:
        write_module(out, islands)
    if preview_dir:
        for f in previews(scene, islands, preview_dir):
            print(f"{TAG} preview {f}")


if __name__ == "__main__":
    main()
