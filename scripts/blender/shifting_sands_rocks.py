"""Shifting Sands' sandstone formations: seven eroded landforms of the dune sea, sculpted by script.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/shifting_sands_rocks.py -- \
        --out src/themes/shifting-sands [--preview <dir>] [--only sentinel,arch]
        [--shots sil,lit,bake,clay,turn,game] [--draft] [--crease <degrees>]

(--only and --draft build previews only: the module needs all seven at full detail. --draft is a
coarser voxel for a quick look at a silhouette.)

The theme is a twin-sun dusk over a dune sea. Its rocks are red sandstone in level beds, and every
one is built for its SILHOUETTE first (the left-hand ones stand almost exactly against the suns):

    sentinel  butte  the hero: a monumental butte on a talus apron, a sheer jointed cliff, an
                     overhanging caprock with a broken rim, one cleft through it, and a finger of
                     rock standing off its -x end, joined to it by the talus only
    spireA    spire  a slender totem: stacked drums, a waisted neck, a wider cap rock
    spireB    spire  a thick blade with one thumb split off it by a cleft
    arch      arch   a natural arch through a rock fin: a lopsided window under a thinner span
    finA      fin    a low hogback: steep plates of rock on edge, a jagged crest line
    knobs     fin    a worn cluster of four fused knobs of different heights, two still capped
    cuesta    fin    a tilted slab of strata: a gentle back slope and a broken scarp

How a rock is made. Sandstone breaks along two things: its beds (level) and its joints (upright,
in two sets about square to one another). So a cliff here is a bundle of upright box columns
standing square to the joint sets, each leaning its own way by a degree and broken off at its own
bed; a hard bed stands out of every column as a ledge and a soft bed is cut back under it; joints
are V grooves down the faces and across the tops; the foot is an apron of talus (a height field
that falls away from the cliff's plan, ribbed down its slope, with a few low shale ledges) strewn
with fallen blocks. All of it is one signed distance field evaluated with numpy, polygonised with
surface nets (scripts/blender/grainfields/horse_sdf.py) only where the surface is, and decimated
in Blender to two levels of the same solid (`hi`, `lo`). Every vertex of a level is given what the
theme shades it by, read from the FINE field and mesh:

    normal   the fine surface's normal averaged over the vertex's neighbourhood (the gradient of
             the smoothed field), so decimation does not flatten the look; a vertex is split only
             where its faces part sharply (CREASE: on `lo` at an arris, on `hi` hardly ever)
    ao       ambient occlusion: cosine-weighted rays against the fine mesh and a ground at y = 0
    crest    0 in a crevice or joint, 0.5 on a flat face, 1 on an exposed edge or crown (how much
             of a small ball about the vertex is rock, the sand counted as rock)

Space: +y up, the foot (the sand) at y = 0, the highest point at y = 1, x and z in the same unit
(the rock's own height), the axis (x = z = 0) at the centroid of the footprint, the long axis along
x; the solid goes on down to y = -0.06 so that it never floats on uneven sand. `proxies` are
flat-topped vertical cylinders that stand in for the solid (shadows, keep-out), measured from the
`hi` mesh; `footprint` is the radius about the axis inside which the rock meets the sand.

The export is one module, src/themes/shifting-sands/shifting-sands-rock-models.js: base64 typed
arrays, no loader and no asset file. Deterministic: the same script and Blender write the same bytes.
"""

import base64
import json
import math
import sys
import time
from array import array
from pathlib import Path

import bpy
import numpy as np
from mathutils import Euler, Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from grainfields.horse_sdf import surface_nets  # noqa: E402

TAG = "[shifting-sands-rocks]"
SCENE = "ShiftingSandsRocks"
MODULE = "shifting-sands-rock-models.js"

QUANT = 1.0 / 8192.0
#: The solid goes this far below the sand (unit heights).
BURY = 0.06
#: Triangles per level (hi, lo), and the share of it the levels are cut to.
BUDGET = {
    "sentinel": (44000, 14000),
    "spireA": (9000, 3000),
    "spireB": (12000, 4000),
    "arch": (10000, 3500),
    "finA": (5000, 1800),
    "knobs": (7000, 2500),
    "cuesta": (5000, 1800),
}
BUDGET_SHARE = 0.905
#: The field is sampled in blocks of this many voxels a side, and only in blocks near the surface.
BLOCK = 4
#: No proxy cylinder is thinner than this (unit heights): a sliver casts nothing worth a test.
PROXY_MIN = 0.038
AO_RAYS = 64
AO_REACH = 0.24
AO_GAIN = 2.0
CREST_GAIN = 2.4
#: Faces that part by more than this (degrees) at a vertex each keep their own normal there. The
#: `hi` level is fine enough for smooth normals to hold an arris; `lo` is not. (A split vertex is
#: eleven bytes of the module.)
CREASE = {"hi": 75.0, "lo": 62.0}

#: How the game sees them (model space, the rock at yaw 0): the eye's direction from the rock.
EYE_RIGHT = (-0.51, 0.0, 0.86)
EYE_LEFT = (0.69, 0.0, 0.72)
SUN_A = (-0.506, 0.08, -0.859)
SUN_B = (-0.39, 0.19, -0.90)
#: Zone and height on a 1600 x 900 frame (pixels).
GAME = {
    "sentinel": (EYE_RIGHT, 260), "spireB": (EYE_RIGHT, 170), "spireA": (EYE_RIGHT, 130),
    "arch": (EYE_LEFT, 95), "knobs": (EYE_LEFT, 55), "finA": (EYE_LEFT, 50), "cuesta": (EYE_LEFT, 35),
}


# ── Noise (numpy) ─────────────────────────────────────────────────────────────

_LATTICE = np.random.default_rng(7919).random((64, 64, 64))


def P3(x, y, z):
    """Points from three coordinates (any of them may be a number)."""
    n = max(np.size(x), np.size(y), np.size(z))
    out = np.empty((n, 3))
    out[:, 0] = x
    out[:, 1] = y
    out[:, 2] = z
    return out


def vnoise(p, seed):
    """Value noise in [-1, 1], one lattice cell per unit (a fixed lattice, shifted by the seed)."""
    cell = np.floor(p)
    f = p - cell
    u = f * f * (3.0 - 2.0 * f)
    c = cell.astype(np.int64)
    x0 = (c[:, 0] + seed * 17 + 3) & 63
    y0 = (c[:, 1] + seed * 29 + 11) & 63
    z0 = (c[:, 2] + seed * 43 + 7) & 63
    x1, y1, z1 = (x0 + 1) & 63, (y0 + 1) & 63, (z0 + 1) & 63
    ux, uy, uz = u[:, 0], u[:, 1], u[:, 2]
    a = _LATTICE[x0, y0, z0] * (1.0 - ux) + _LATTICE[x1, y0, z0] * ux
    b = _LATTICE[x0, y1, z0] * (1.0 - ux) + _LATTICE[x1, y1, z0] * ux
    low = a * (1.0 - uy) + b * uy
    a = _LATTICE[x0, y0, z1] * (1.0 - ux) + _LATTICE[x1, y0, z1] * ux
    b = _LATTICE[x0, y1, z1] * (1.0 - ux) + _LATTICE[x1, y1, z1] * ux
    high = a * (1.0 - uy) + b * uy
    return (low * (1.0 - uz) + high * uz) * 2.0 - 1.0


def fbm(p, seed, octaves=3, gain=0.5, lacunarity=2.03):
    total = np.zeros(len(p))
    amp = 1.0
    norm = 0.0
    q = np.array(p, dtype=np.float64)
    for o in range(octaves):
        total += amp * vnoise(q + 11.7 * o, seed + o * 7)
        norm += amp
        amp *= gain
        q = q * lacunarity
    return total / norm


# ── Distance fields ───────────────────────────────────────────────────────────

def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def smin(a, b, k):
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def ellipsoid(p, centre, radii):
    """A close bound whose gradient is about one at the surface."""
    q = p - np.asarray(centre, dtype=np.float64)
    r = np.asarray(radii, dtype=np.float64)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class Beds:
    """Bedding: how far each bed stands proud of a cliff (+, a hard ledge) or is cut back (-), by
    height. A hard bed breaks square (an overhang under it); a soft one is a rounded hollow."""

    def __init__(self, layers, edge):
        self.layers = [(float(a), float(b), float(off)) for a, b, off in layers]
        self.edge = edge

    def __call__(self, y):
        out = np.zeros(len(y))
        for y0, y1, off in self.layers:
            e = self.edge if off > 0 else min(self.edge * 3.0, (y1 - y0) * 0.45)
            out += off * smoothstep(y0 - e, y0 + e, y) * (1.0 - smoothstep(y1 - e, y1 + e, y))
        return out


class Mass:
    """A cliff as a bundle of upright box columns, each leaning its own way and broken off at its
    own bed. `core` columns are the gross plan the talus falls away from."""

    def __init__(self, weld=0.006, crown=0.01, rough=0.007):
        self.items = []
        self.weld = weld
        self.crown = crown
        self.rough = rough

    def box(self, x, z, hu, hv, turn=0.0, top=1.0, lean=(0.0, 0.0), batter=0.02, tilt=(0.0, 0.0),
            bed=1.0, core=False, corner=0.0, floor=None, dome=0.0):
        a = math.radians(turn)
        self.items.append({
            "x": x, "z": z, "hu": hu, "hv": hv, "c": math.cos(a), "s": math.sin(a), "top": top,
            "lean": lean, "batter": batter, "tilt": tilt, "bed": bed, "core": core, "corner": corner,
            "floor": floor, "dome": dome,
            "reach": math.hypot(hu, hv) + abs(batter) * 1.2 + (abs(lean[0]) + abs(lean[1])) * 1.2 + 0.05,
        })
        return self

    @staticmethod
    def _plan(it, x, z, y):
        qx = x - it["x"] - it["lean"][0] * y
        qz = z - it["z"] - it["lean"][1] * y
        u = qx * it["c"] + qz * it["s"]
        v = qz * it["c"] - qx * it["s"]
        au = np.abs(u) - (it["hu"] - it["corner"])
        av = np.abs(v) - (it["hv"] - it["corner"])
        d2 = np.hypot(np.maximum(au, 0.0), np.maximum(av, 0.0)) + np.minimum(np.maximum(au, av), 0.0) - it["corner"]
        return d2, u, v

    def plan(self, x, z, y=0.3, core=True, blend=0.0):
        """The plan's distance in the flat (negative inside), at height y. `blend` rounds the
        valley between two separate rocks (the talus of one runs into the other's)."""
        d = np.full(len(x), 10.0)
        for it in self.items:
            if it["core"] or not core:
                d2, _, _ = self._plan(it, x, z, y)
                d = smin(d, d2 - it["batter"] * (it["top"] - y), blend)
        return d

    def foot(self, blend):
        """The plan a talus falls away from."""
        return lambda x, z: self.plan(x, z, blend=blend)

    def eval(self, p, bed):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        d = np.full(len(p), 10.0)
        x0, x1, z0, z1 = float(x.min()), float(x.max()), float(z.min()), float(z.max())
        # (No broken top is level: every crown is lumpy.)
        lump = self.rough * vnoise(P3(x * 9.0, 0.37, z * 9.0), 177) if self.rough else 0.0
        for it in self.items:
            # (A column that stands clear of this batch of points cannot shape it.)
            gx = max(x0 - it["x"], 0.0, it["x"] - x1)
            gz = max(z0 - it["z"], 0.0, it["z"] - z1)
            if math.hypot(gx, gz) > it["reach"] + 0.06:
                continue
            d2, u, v = self._plan(it, x, z, y)
            wall = d2 - it["batter"] * (it["top"] - y) - bed * it["bed"]
            cap = y - it["top"] + it["tilt"][0] * u + it["tilt"][1] * v + lump
            if it["dome"]:
                cap = cap + it["dome"] * (u * u + v * v)
            col = smax(wall, cap, self.crown)
            if it["floor"] is not None:
                col = smax(col, it["floor"] - y, self.crown * 0.6)
            d = smin(d, col, self.weld)
        return d


class Joints:
    """One set of upright joints: V grooves where each joint's plane meets the rock."""

    def __init__(self, rng, bearing, span, spacing, width, depth, seed, heights=(0.0, 1.0), wander=0.012):
        a = math.radians(bearing)
        self.c, self.s = math.cos(a), math.sin(a)
        self.seed = seed
        self.wander = wander
        self.items = []
        u = -span + rng.uniform(0.0, spacing[1])
        while u < span:
            w = rng.uniform(*width)
            dp = rng.uniform(*depth)
            lo, hi = -1.0, 3.0
            pick = rng.random()
            if pick < 0.22:
                lo = rng.uniform(heights[0] + 0.25 * (heights[1] - heights[0]), heights[0] + 0.65 * (heights[1] - heights[0]))
            elif pick < 0.4:
                hi = rng.uniform(heights[0] + 0.5 * (heights[1] - heights[0]), heights[0] + 0.85 * (heights[1] - heights[0]))
            self.items.append((u, w, dp, lo, hi))
            u += rng.uniform(*spacing)

    def carve(self, p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        u = x * self.c + z * self.s
        if self.wander:
            u = u + self.wander * vnoise(P3(y * 4.0, (z * self.c - x * self.s) * 1.6, u * 0.7), self.seed)
        out = np.zeros(len(p))
        for u0, w, dp, lo, hi in self.items:
            idx = np.nonzero(np.abs(u - u0) < w)[0]
            if not len(idx):
                continue
            profile = (1.0 - np.abs(u[idx] - u0) / w) ** 0.8
            yy = y[idx]
            fade = smoothstep(lo - 0.05, lo + 0.05, yy) * (1.0 - smoothstep(hi - 0.05, hi + 0.05, yy))
            out[idx] = np.maximum(out[idx], dp * profile * fade)
        return out


class Apron:
    """The talus at a rock's foot: a height field that falls away from the cliff's plan, ribbed and
    gullied down its slope, with a few low shale ledges that come and go round it."""

    def __init__(self, plan, reach, top, power=1.35, seed=1, wobble=0.12, ribs=0.02, rib_freq=6.0,
                 ledges=(), steep=0.74, toe=0.3, fans=0.0):
        self.plan = plan
        self.reach = reach
        self.top = top
        self.power = power
        self.seed = seed
        self.wobble = wobble
        self.ribs = ribs
        self.rib_freq = rib_freq
        self.ledges = ledges
        self.steep = steep
        self.toe = toe
        self.fans = fans

    def measure(self, x, z):
        """How far out of the plan a place is, and how far the talus reaches there."""
        di = np.maximum(self.plan(x, z), 0.0)
        reach = self.reach(x, z) if callable(self.reach) else self.reach
        reach = reach * (1.0 + self.wobble * vnoise(P3(x * 1.3, 0.5, z * 1.3), self.seed))
        return di, reach

    def height(self, x, z):
        di, reach = self.measure(x, z)
        t = di / reach
        top = self.top(x, z) if callable(self.top) else self.top
        fall = np.clip(1.0 - t, 0.0, 1.0)
        # (Part of the fall is straight: the toe meets the sand at an angle, not as a film on it.)
        h = top * (fall ** self.power * (1.0 - self.toe) + fall * self.toe)
        # Ribs and gullies run down the slope: noise that follows the foot of each slope line.
        e = 0.012
        gx = (self.plan(x + e, z) - self.plan(x - e, z)) / (2.0 * e)
        gz = (self.plan(x, z + e) - self.plan(x, z - e)) / (2.0 * e)
        ax = x - gx * di
        az = z - gz * di
        k = self.rib_freq
        n = vnoise(P3(ax * k + gx * 1.9, gz * 1.9 + 3.1, az * k), self.seed + 5)
        n2 = vnoise(P3(ax * k * 2.3 + gx * 3.3, gz * 3.3 + 7.7, az * k * 2.3), self.seed + 6)
        mid = np.sin(np.pi * np.clip(t, 0.0, 1.0)) ** 0.8
        n3 = vnoise(P3(ax * k * 5.1 + gx * 6.1, gz * 6.1 + 2.2, az * k * 5.1), self.seed + 8)
        h = h + self.ribs * (n + 0.45 * n2 + 0.22 * n3) * mid
        if self.fans:
            # Debris fans: broad lobes under the places the cliff sheds from.
            h = h + self.fans * vnoise(P3(ax * k * 0.36 + gx * 0.8, gz * 0.8 + 1.3, az * k * 0.36), self.seed + 7) * mid
        for i, (level, rise, width) in enumerate(self.ledges):
            mask = 0.5 + 0.5 * vnoise(P3(x * 2.6, level * 31.0, z * 2.6), self.seed + 11 + i)
            at = level * (1.0 + 0.22 * vnoise(P3(x * 1.7, 4.0 + level * 17.0, z * 1.7), self.seed + 21 + i))
            h = h + rise * smoothstep(0.42, 0.62, mask) * smoothstep(at - width, at + width, h)
        # Beyond the toe the solid goes straight down into the sand.
        return h - 3.0 * np.maximum(di - reach, 0.0)

    def field(self, p):
        return (p[:, 1] - self.height(p[:, 0], p[:, 2])) * self.steep


class Blocks:
    """Fallen blocks: rounded boxes lying askew."""

    def __init__(self, corner=0.2):
        self.items = []
        self.corner = corner

    def add(self, centre, half, rng, tip=0.5):
        rot = Euler((rng.uniform(-tip, tip), rng.uniform(0.0, math.tau), rng.uniform(-tip, tip)), "XYZ").to_matrix()
        half = np.asarray(half, dtype=np.float64)
        # Two corners broken off along planes of their own: a fallen block is no brick.
        chips = []
        for _ in range(2):
            n = unit(rng.normal(size=3))
            chips.append((n, float((np.abs(n) * half).sum()) * rng.uniform(0.5, 0.72)))
        self.items.append((np.asarray(centre, dtype=np.float64), half, np.array(rot), float(np.linalg.norm(half)) + 0.03, chips))

    def strew(self, rng, apron, bounds, count, size, band=(0.04, 0.9), bias=1.6, sink=0.3):
        """Blocks on the talus, more of them near the cliff's foot, each sunk a little into it."""
        placed = 0
        tries = 0
        while placed < count and tries < count * 80:
            tries += 1
            x = np.array([rng.uniform(bounds[0], bounds[1])])
            z = np.array([rng.uniform(bounds[2], bounds[3])])
            di, reach = apron.measure(x, z)
            t = float(di[0] / reach[0])
            keep = rng.random() < max(0.0, 1.0 - t) ** bias
            s = size[0] + (size[1] - size[0]) * rng.random() ** 2.4
            shape = np.array([1.0, 0.5 + 0.4 * rng.random(), 0.6 + 0.5 * rng.random()])
            if not (band[0] < t < band[1]) or not keep:
                continue
            half = s * shape
            y = float(apron.height(x, z)[0]) + half[1] * (1.0 - 2.0 * sink)
            self.add((x[0], y, z[0]), half, rng)
            placed += 1

    def union(self, d, p, k=0.004):
        if not self.items:
            return d
        lo = p.min(axis=0)
        hi = p.max(axis=0)
        for centre, half, rot, radius, chips in self.items:
            if np.any(centre + radius < lo) or np.any(centre - radius > hi):
                continue
            rel = p - centre
            idx = np.nonzero((rel * rel).sum(axis=1) < radius * radius)[0]
            if not len(idx):
                continue
            r = self.corner * float(half.min())
            local = rel[idx] @ rot
            q = np.abs(local) - (half - r)
            box = np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(q.max(axis=1), 0.0) - r
            for n, offset in chips:
                box = np.maximum(box, local @ n - offset)
            d[idx] = smin(d[idx], box, k)
        return d


def warp(p, seed, amount, scale=2.3):
    """Nothing in weathered rock is quite plane: bend the space a little before building in it."""
    q = p * scale
    out = p.copy()
    out[:, 0] += amount * vnoise(q + 3.3, seed)
    out[:, 1] += amount * 0.25 * vnoise(q + 17.1, seed + 1)
    out[:, 2] += amount * vnoise(q + 29.9, seed + 2)
    return out


def relief(q, seed, amount, grain=1.0):
    """The face's own relief: level bedding striae, runnels down the face, lumps."""
    striae = fbm(q * np.array([4.0, 12.0, 4.0]) * grain, seed, 2)
    runnels = vnoise(q * np.array([15.0, 2.4, 15.0]) * grain + 9.0, seed + 3)
    lumps = vnoise(q * 9.0 * grain + 5.0, seed + 5)
    return amount * (0.5 * striae + 0.6 * runnels + 0.4 * lumps)


def slot(q, at, bearing, width0, width1, bottom, top=1.02, seed=0, wander=0.012):
    """An upright cleft, wider at the top: negative inside it. `bearing` is across the cleft."""
    a = math.radians(bearing)
    c, s = math.cos(a), math.sin(a)
    x, y, z = q[:, 0] - at[0], q[:, 1], q[:, 2] - at[1]
    u = x * c + z * s
    along = z * c - x * s
    if wander:
        u = u + wander * vnoise(P3(y * 5.0, along * 3.0, 0.5), seed)
    half = width0 + (width1 - width0) * smoothstep(bottom, top, y) ** 0.8
    return np.maximum(np.abs(u) - half, bottom + 0.05 * np.abs(along) - y)


def finish(d, p):
    """Cut the solid off below the sand."""
    return np.maximum(d, -(p[:, 1] + BURY + 0.002))


def face_point(mass, bearing, y, start=1.6):
    """Where a level ray toward the axis from `bearing` (degrees) first meets the cliff at height y."""
    a = math.radians(bearing)
    c, s = math.cos(a), math.sin(a)
    r = start
    for _ in range(96):
        r -= 0.9 * float(mass.plan(np.array([c * r]), np.array([s * r]), y, core=False)[0])
    return c * r, s * r


# ── The seven designs ─────────────────────────────────────────────────────────
#
# A design returns { field, lo, hi, voxel, pad, cuts, kind }: the field (negative inside), the box
# it is sampled in, the voxel, how far the fine relief can move the surface, and the heights
# between which its proxies are measured.

def ring_of_buttresses(mass, rng, centre, radii, count, tops, joint=(4.0, 94.0), power=2.4,
                       width=(0.05, 0.11), depth=(0.07, 0.12), out=(-0.03, 0.045), skip=(), low=0.9, scar=0.3):
    """Buttress columns round a plan, most of them standing square to a joint set. A column that
    broke off below `low` ends in a slanting scar."""
    for i in range(count):
        a = math.tau * (i + rng.uniform(-0.3, 0.3)) / count
        deg = math.degrees(a) % 360.0
        ca, sa = math.cos(a), math.sin(a)
        px = radii[0] * math.copysign(abs(ca) ** (2.0 / power), ca)
        pz = radii[1] * math.copysign(abs(sa) ** (2.0 / power), sa)
        nx, nz = px / radii[0] ** 2, pz / radii[1] ** 2
        nl = math.hypot(nx, nz)
        nx, nz = nx / nl, nz / nl
        bearing = math.degrees(math.atan2(nz, nx))
        if rng.random() < 0.7:
            bearing = joint[0] + 90.0 * round((bearing - joint[0]) / 90.0)
        bearing += rng.uniform(-9.0, 9.0)
        w = rng.uniform(*width)
        dp = rng.uniform(*depth)
        e = rng.uniform(*out)
        top = tops(rng, deg)
        batter = rng.uniform(-0.01, 0.045)
        slant = 0.07 if top > low else scar
        tilt = (rng.uniform(-slant, slant), rng.uniform(-slant, slant))
        lean = (rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012))
        gain = rng.uniform(0.35, 1.2)
        if any(a0 <= deg <= a1 for a0, a1 in skip):
            continue
        mass.box(centre[0] + px + nx * (e - dp), centre[1] + pz + nz * (e - dp), dp, w, turn=bearing,
                 top=top, batter=batter, tilt=tilt, lean=lean, bed=gain)


def design_sentinel():
    v = 0.0066
    seed = 31
    rng = np.random.default_rng(4301)
    cap0, cap1 = 0.905, 0.955
    joint = (5.0, 96.0)
    mass = Mass(weld=0.006, crown=0.01)
    # The body: three great blocks.
    mass.box(0.0, 0.0, 0.32, 0.2, turn=joint[0], top=cap1, core=True)
    mass.box(-0.04, 0.02, 0.21, 0.25, turn=joint[0] - 6.0, top=cap1, core=True)
    mass.box(0.06, -0.02, 0.35, 0.125, turn=joint[0] + 5.0, top=cap1, core=True)
    # What is left of the bed above the caprock: the summit is no table.
    mass.box(-0.15, 0.04, 0.075, 0.07, turn=14.0, top=1.0, tilt=(0.06, -0.04))
    mass.box(-0.05, 0.0, 0.12, 0.11, turn=-4.0, top=0.979, tilt=(-0.03, 0.02))
    mass.box(-0.27, -0.03, 0.04, 0.05, turn=22.0, top=0.975)
    # Shoulders at the -x end: blocks that broke off lower.
    mass.box(-0.385, 0.09, 0.06, 0.085, turn=10.0, top=0.7, batter=0.04, tilt=(0.22, 0.1), bed=0.6)
    mass.box(-0.37, -0.12, 0.055, 0.07, turn=-4.0, top=0.83, batter=0.03, tilt=(0.15, -0.1), bed=0.8)

    def tops(r, deg):
        pick = r.random()
        if pick < 0.68:
            return cap1 + r.uniform(-0.004, 0.004)
        if pick < 0.86:
            return r.uniform(0.76, 0.86)
        return r.uniform(0.58, 0.72)

    # Few and broad: a cliff is walls between its joints, not a ring of flutes.
    ring_of_buttresses(mass, rng, (0.0, 0.0), (0.385, 0.285), 12, tops, joint=joint, width=(0.08, 0.19),
                       depth=(0.08, 0.14), out=(-0.035, 0.04), scar=0.26)
    # Slim columns standing just off the face.
    for bearing, gap, hu, hv, turn, top in ((58.0, 0.012, 0.034, 0.03, 8.0, 0.7), (255.0, 0.01, 0.03, 0.027, 3.0, 0.76)):
        x, z = face_point(mass, bearing, 0.5)
        a = math.radians(bearing)
        mass.box(x + math.cos(a) * (gap + hu), z + math.sin(a) * (gap + hu), hu, hv, turn=turn, top=top, batter=0.05,
                 tilt=(0.16, -0.1))
    # The finger: off the -x end, joined to the butte by the talus only.
    fx, fz = -0.7, -0.04
    mass.box(fx, fz, 0.055, 0.042, turn=24.0, top=0.45, core=True, batter=0.08, bed=0.4)
    mass.box(fx - 0.004, fz + 0.002, 0.043, 0.032, turn=16.0, top=0.665, batter=0.04, lean=(-0.02, 0.01), bed=0.5, tilt=(0.3, 0.1))
    mass.box(fx - 0.014, fz + 0.004, 0.029, 0.029, turn=30.0, top=0.752, batter=0.03, lean=(-0.02, 0.01), bed=0.5, tilt=(-0.25, 0.15))

    # Massive rock between a thin-bedded foot and the caprock: few beds cross the whole cliff.
    beds = Beds([
        (0.385, 0.405, 0.018), (0.43, 0.446, 0.012), (0.56, 0.585, -0.013), (0.71, 0.732, 0.012),
        (0.862, cap0, -0.022), (cap0, cap1, 0.024), (cap1, 0.968, -0.01), (0.968, 1.02, 0.01),
    ], v * 0.6)
    joints = [
        Joints(rng, joint[0], 0.52, (0.09, 0.3), (0.012, 0.019), (0.01, 0.03), seed + 1, heights=(0.3, 1.0)),
        Joints(rng, joint[1], 0.4, (0.09, 0.3), (0.012, 0.019), (0.01, 0.03), seed + 2, heights=(0.3, 1.0)),
    ]
    # Alcoves: arched hollows where slabs have spalled off the face, most of them at the cliff's foot.
    alcoves = []
    for bearing, y, wide, tall, deep in ((105.0, 0.37, 0.075, 0.17, 0.5), (40.0, 0.36, 0.06, 0.13, 0.45), (265.0, 0.37, 0.085, 0.15, 0.5),
                                         (318.0, 0.36, 0.07, 0.16, 0.5), (200.0, 0.37, 0.06, 0.12, 0.5)):
        x, z = face_point(mass, bearing, y + 0.1)
        a = math.radians(bearing)
        alcoves.append(((x + math.cos(a) * wide * deep, y, z + math.sin(a) * wide * deep), (wide, tall, wide)))

    # A bay in the face toward the eye: a slab the height of the cliff has come away.
    bx, bz = face_point(mass, 97.0, 0.5)
    ba = math.radians(97.0)

    def bay(q):
        u = (q[:, 2] - bz) * math.cos(ba) - (q[:, 0] - bx) * math.sin(ba)
        w = (q[:, 0] - bx) * math.cos(ba) + (q[:, 2] - bz) * math.sin(ba)
        u = u + 0.012 * vnoise(P3(q[:, 1] * 6.0, 0.4, u * 3.0), seed + 25)
        return np.maximum(np.maximum(np.abs(u) - 0.095, -(w + 0.05)), q[:, 1] - 0.79 + 7.0 * u * u)

    def reach(x, z):
        return 0.39 - 0.2 * np.exp(-(((x + 0.9) / 0.38) ** 2 + (z / 0.7) ** 2))

    def top(x, z):
        return (0.385 + 0.05 * vnoise(P3(x * 3.2, 0.3, z * 3.2), seed + 3)
                - 0.1 * np.exp(-(((x + 0.68) / 0.22) ** 2 + (z / 0.35) ** 2)))

    apron = Apron(mass.foot(0.16), reach, top, power=1.25, seed=seed + 4, ribs=0.034, rib_freq=6.5, fans=0.035,
                  ledges=((0.11, 0.03, 0.006), (0.19, 0.042, 0.007), (0.265, 0.03, 0.006)))
    blocks = Blocks()
    blocks.strew(rng, apron, (-1.1, 0.9, -0.8, 0.8), 70, (0.013, 0.036), bias=2.2)

    def field(p):
        q = warp(p, seed, 0.02, 2.8)
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        gain = np.clip(0.62 + 0.6 * vnoise(P3(x * 2.4, y * 0.8, z * 2.4), seed + 21), 0.15, 1.0)
        bed = beds(y) * gain
        # The caprock's rim is broken: here and there a block of it has gone.
        rim = smoothstep(0.2, 0.5, vnoise(P3(x * 7.0, 0.7, z * 7.0), seed + 22))
        bed = bed - 0.05 * rim * smoothstep(cap0 - 0.01, cap0 + 0.004, y)
        d = mass.eval(q, bed)
        for j in joints:
            d = d + j.carve(q)
        # The cleft, and the tower beyond it a bed lower than the rest.
        across = (x - 0.2) * math.cos(math.radians(28.0)) + z * math.sin(math.radians(28.0))
        roof = (1.1 - 0.235 * smoothstep(-0.01, 0.02, across) - 0.07 * smoothstep(0.345, 0.36, x + 0.3 * z) + 0.12 * z
                - 0.2 * smoothstep(0.05, 0.07, x - 0.25 * z) * (1.0 - smoothstep(-0.01, 0.02, across)))
        d = smax(d, y - roof, 0.01)
        d = smax(d, -slot(q, (0.2, 0.0), 28.0, 0.011, 0.046, 0.54, seed=seed + 23, wander=0.02), 0.008)
        d = smax(d, -bay(q), 0.012)
        for centre, radii in alcoves:
            d = smax(d, -ellipsoid(q, centre, radii), 0.01)
        d = smin(d, apron.field(q), 0.025)
        d = blocks.union(d, q)
        near = np.abs(d) < 0.05
        d[near] += relief(q[near], seed + 24, 0.0055)
        return finish(d, p)

    return {"field": field, "lo": (-1.2, -0.08, -0.86), "hi": (1.0, 1.04, 0.86), "voxel": v, "pad": 0.022,
            "cuts": (0.12, 0.345, 0.862), "kind": "butte"}


def surface_height(field, x, z, top=1.2):
    """How high a field's surface stands at (x, z), found from above."""
    ys = np.linspace(top, -BURY, 200)
    d = field(P3(np.full(len(ys), x), ys, np.full(len(ys), z)))
    inside = np.nonzero(d < 0.0)[0]
    if not len(inside) or inside[0] == 0:
        return 0.0
    k = inside[0]
    return float(ys[k - 1] + (ys[k] - ys[k - 1]) * d[k - 1] / (d[k - 1] - d[k]))


def design_spireA():
    v = 0.0062
    seed = 41
    rng = np.random.default_rng(4302)
    mass = Mass(weld=0.008, crown=0.012)
    lean = (0.035, -0.02)
    # A totem: a bundle of joint columns, each broken off at its own height (a stack of drums
    # would be a cairn), a thin neck of softer rock, and the cap rock on it.
    mass.box(0.0, 0.0, 0.13, 0.115, turn=8.0, top=0.71, core=True, batter=0.035, lean=lean, tilt=(0.06, -0.05))
    mass.box(-0.09, 0.03, 0.075, 0.09, turn=-10.0, top=0.6, core=True, batter=0.05, lean=lean, tilt=(-0.2, 0.1))
    mass.box(0.1, -0.02, 0.065, 0.085, turn=18.0, top=0.5, core=True, batter=0.06, lean=lean, tilt=(0.25, 0.0))
    mass.box(0.02, 0.1, 0.08, 0.05, turn=4.0, top=0.42, batter=0.07, lean=lean, tilt=(0.0, 0.25))
    mass.box(-0.02, -0.105, 0.085, 0.05, turn=-6.0, top=0.64, batter=0.05, lean=lean, tilt=(0.1, -0.2))
    mass.box(0.0, 0.0, 0.17, 0.15, turn=12.0, top=0.3, core=True, batter=0.1, lean=lean, tilt=(0.1, 0.1))
    mass.box(0.012, -0.005, 0.085, 0.078, turn=20.0, top=0.86, batter=0.02, lean=lean)
    # The cap: a slab set askew, one corner of it gone, a last block on top.
    mass.box(0.04, 0.005, 0.15, 0.12, turn=10.0, top=0.955, batter=-0.03, lean=lean, floor=0.82, tilt=(0.12, 0.06))
    mass.box(-0.035, 0.03, 0.09, 0.12, turn=-18.0, top=0.975, batter=-0.02, lean=lean, floor=0.85, tilt=(-0.08, 0.1))
    mass.box(0.065, -0.01, 0.07, 0.065, turn=34.0, top=1.0, batter=0.0, lean=lean, floor=0.9, tilt=(0.14, -0.1))
    beds = Beds([
        (0.3, 0.32, 0.012), (0.47, 0.5, -0.012), (0.62, 0.64, 0.01), (0.74, 0.8, -0.01), (0.9, 0.93, 0.01),
    ], v * 0.6)
    joints = [
        Joints(rng, 12.0, 0.3, (0.08, 0.18), (0.011, 0.016), (0.01, 0.028), seed + 1, heights=(0.2, 1.0)),
        Joints(rng, 100.0, 0.3, (0.08, 0.18), (0.011, 0.016), (0.01, 0.028), seed + 2, heights=(0.2, 1.0)),
    ]

    def top(x, z):
        return 0.23 + 0.03 * vnoise(P3(x * 3.0, 0.3, z * 3.0), seed + 3)

    apron = Apron(mass.plan, 0.2, top, power=1.25, seed=seed + 4, ribs=0.02, rib_freq=8.0, fans=0.02,
                  ledges=((0.09, 0.016, 0.006), (0.16, 0.016, 0.006)))
    blocks = Blocks()
    blocks.strew(rng, apron, (-0.5, 0.5, -0.5, 0.5), 18, (0.014, 0.036), bias=2.0)

    def field(p):
        q = warp(p, seed, 0.014, 3.0)
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        gain = np.clip(0.7 + 0.5 * vnoise(P3(x * 3.0, y * 1.1, z * 3.0), seed + 21), 0.3, 1.0)
        d = mass.eval(q, beds(y) * gain)
        for j in joints:
            d = d + j.carve(q)
        d = smin(d, apron.field(q), 0.02)
        d = blocks.union(d, q)
        near = np.abs(d) < 0.05
        d[near] += relief(q[near], seed + 24, 0.0055, 1.2)
        return finish(d, p)

    return {"field": field, "lo": (-0.56, -0.08, -0.54), "hi": (0.56, 1.04, 0.54), "voxel": v, "pad": 0.02,
            "cuts": (0.1, 0.24, 0.72, 0.84), "kind": "spire"}


def design_spireB():
    v = 0.0064
    seed = 51
    rng = np.random.default_rng(4303)
    mass = Mass(weld=0.007, crown=0.012)
    split = 26.0
    # The blade: a wall of joint blocks, tallest toward -x.
    mass.box(-0.07, 0.0, 0.16, 0.115, turn=3.0, top=0.95, core=True, batter=0.03)
    mass.box(-0.1, 0.01, 0.095, 0.125, turn=-6.0, top=1.0, core=True, batter=0.03, tilt=(0.05, 0.03))
    mass.box(0.0, -0.01, 0.07, 0.105, turn=8.0, top=0.968, batter=0.03, tilt=(-0.06, 0.02))
    mass.box(0.07, -0.02, 0.04, 0.085, turn=split, top=0.9, batter=0.02, tilt=(0.1, 0.0))
    mass.box(-0.2, 0.0, 0.05, 0.09, turn=12.0, top=0.87, batter=0.05, tilt=(0.14, 0.0))
    mass.box(-0.235, 0.015, 0.035, 0.06, turn=-8.0, top=0.66, batter=0.06, tilt=(0.2, 0.08))
    mass.box(-0.03, 0.095, 0.08, 0.035, turn=5.0, top=0.8, batter=0.04, tilt=(0.0, -0.15))
    mass.box(-0.12, -0.1, 0.06, 0.035, turn=-9.0, top=0.72, batter=0.05, tilt=(0.1, 0.15))
    mass.box(0.03, -0.095, 0.05, 0.03, turn=14.0, top=0.58, batter=0.05, tilt=(-0.1, 0.2))
    # The thumb: beyond a cleft the eye looks along.
    mass.box(0.22, 0.03, 0.05, 0.078, turn=split, top=0.6, core=True, batter=0.04)
    mass.box(0.224, 0.034, 0.043, 0.066, turn=split + 6.0, top=0.745, batter=0.02, lean=(0.02, 0.008), tilt=(-0.12, 0.08))
    mass.box(0.232, 0.02, 0.03, 0.042, turn=split - 12.0, top=0.775, batter=0.02, lean=(0.02, 0.008), tilt=(0.1, -0.1))
    beds = Beds([
        (0.33, 0.35, 0.012), (0.52, 0.545, -0.011), (0.7, 0.716, 0.009), (0.845, 0.875, -0.013), (0.875, 0.915, 0.013),
    ], v * 0.6)
    joints = [
        Joints(rng, 4.0, 0.34, (0.08, 0.2), (0.011, 0.016), (0.01, 0.028), seed + 1, heights=(0.28, 1.0)),
        Joints(rng, 95.0, 0.2, (0.08, 0.2), (0.011, 0.016), (0.01, 0.024), seed + 2, heights=(0.28, 1.0)),
    ]

    def top(x, z):
        return 0.3 + 0.03 * vnoise(P3(x * 3.0, 0.3, z * 3.0), seed + 3)

    apron = Apron(mass.foot(0.1), 0.22, top, power=1.25, seed=seed + 4, ribs=0.022, rib_freq=8.0, fans=0.02,
                  ledges=((0.11, 0.016, 0.006), (0.2, 0.016, 0.006)))
    blocks = Blocks()
    blocks.strew(rng, apron, (-0.6, 0.6, -0.5, 0.5), 22, (0.014, 0.038), bias=2.0)

    def field(p):
        q = warp(p, seed, 0.014, 3.0)
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        gain = np.clip(0.66 + 0.55 * vnoise(P3(x * 3.0, y * 1.0, z * 3.0), seed + 21), 0.2, 1.0)
        d = mass.eval(q, beds(y) * gain)
        for j in joints:
            d = d + j.carve(q)
        d = smax(d, -slot(q, (0.14, 0.0), split, 0.012, 0.042, 0.5, top=0.85, seed=seed + 23, wander=0.01), 0.008)
        d = smin(d, apron.field(q), 0.02)
        d = blocks.union(d, q)
        near = np.abs(d) < 0.05
        d[near] += relief(q[near], seed + 24, 0.0055, 1.2)
        return finish(d, p)

    return {"field": field, "lo": (-0.62, -0.08, -0.5), "hi": (0.62, 1.04, 0.5), "voxel": v, "pad": 0.02,
            "cuts": (0.3, 0.76), "kind": "spire"}


def design_arch():
    v = 0.0095
    seed = 61
    rng = np.random.default_rng(4304)
    mass = Mass(weld=0.012, crown=0.018)
    # The fin: a wall of joint blocks along x. Its skyline falls from the tower (+x) over the span
    # to a long tail (-x): slanting backs and one or two steps, never a stair.
    wall = (
        (-0.84, -0.64, 0.2, 0.075, -0.5), (-0.7, -0.4, 0.5, 0.09, -0.42), (-0.45, -0.22, 0.69, 0.1, -0.22),
        (-0.26, -0.02, 0.765, 0.1, -0.1), (-0.06, 0.16, 0.81, 0.098, -0.18), (0.12, 0.3, 0.87, 0.102, -0.04),
        (0.26, 0.5, 1.0, 0.115, 0.03), (0.46, 0.6, 0.86, 0.11, 0.12), (0.56, 0.72, 0.56, 0.1, 0.5), (0.66, 0.8, 0.26, 0.085, 0.4),
    )
    for x0, x1, top, half, slant in wall:
        mass.box((x0 + x1) * 0.5, rng.uniform(-0.014, 0.014), (x1 - x0) * 0.5, half, turn=rng.uniform(-5.0, 5.0),
                 top=top, core=True, batter=0.045, tilt=(slant, rng.uniform(-0.08, 0.08)))
    mass.box(0.37, 0.02, 0.07, 0.06, turn=18.0, top=1.0, batter=0.0, floor=0.955)
    mass.box(-0.42, 0.075, 0.07, 0.035, turn=-4.0, top=0.42, batter=0.06, tilt=(-0.3, 0.1))
    mass.box(0.55, -0.085, 0.06, 0.035, turn=7.0, top=0.5, batter=0.06, tilt=(0.3, -0.1))
    beds = Beds([
        (0.2, 0.225, 0.016), (0.33, 0.36, -0.014), (0.47, 0.495, 0.015), (0.6, 0.63, -0.014),
        (0.7, 0.725, 0.014), (0.84, 0.87, -0.014), (0.87, 0.92, 0.016),
    ], v * 0.6)
    joints = [
        Joints(rng, 3.0, 0.9, (0.1, 0.26), (0.017, 0.024), (0.014, 0.036), seed + 1, heights=(0.1, 1.0)),
    ]
    # The window: lopsided, its apex toward the tower; a long ramp on the tail's side, a steep jamb
    # under the tower.
    apex, left, right, sill, rise = 0.12, 0.5, 0.28, 0.04, 0.6

    def window(q, bed):
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        flare = 1.0 + 0.55 * np.abs(z)
        dx = x - apex
        a = np.where(dx < 0.0, left, right) * flare
        n = np.where(dx < 0.0, 1.75, 3.4)
        g = (np.abs(dx) / a) ** n + (np.maximum(y - sill, 0.0) / (rise * (1.0 + 0.2 * np.abs(z)))) ** 2.2
        hole = (np.sqrt(g) - 1.0) * 0.17 + bed * 0.7
        return np.maximum(hole, sill - y)

    def top(x, z):
        return 0.085 + 0.03 * vnoise(P3(x * 2.4, 0.3, z * 2.4), seed + 3)

    apron = Apron(mass.plan, 0.065, top, power=1.2, seed=seed + 4, ribs=0.012, rib_freq=5.0)
    blocks = Blocks()
    blocks.strew(rng, apron, (-0.95, 0.95, -0.3, 0.3), 14, (0.02, 0.05), band=(-1.0, 0.9), bias=0.5)

    def field(p):
        q = warp(p, seed, 0.016, 2.6)
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        gain = np.clip(0.7 + 0.5 * vnoise(P3(x * 2.4, y * 1.0, z * 2.4), seed + 21), 0.3, 1.0)
        bed = beds(y) * gain
        d = mass.eval(q, bed)
        for j in joints:
            d = d + j.carve(q)
        d = smax(d, -window(q, bed), 0.02)
        d = smin(d, apron.field(q), 0.02)
        d = blocks.union(d, q)
        near = np.abs(d) < 0.06
        d[near] += relief(q[near], seed + 24, 0.008, 0.8)
        return finish(d, p)

    return {"field": field, "lo": (-1.0, -0.08, -0.36), "hi": (1.0, 1.06, 0.36), "voxel": v, "pad": 0.03,
            "cuts": (0.62, 0.8), "kind": "arch"}


def design_finA():
    v = 0.0125
    seed = 71
    rng = np.random.default_rng(4305)
    dip = math.radians(56.0)
    cd, sd = math.cos(dip), math.sin(dip)
    half = 1.9
    # Plates of rock on edge, the hard ones standing out of the soft ones between them.
    plates = []
    s = 0.3
    for tau, gain in ((0.11, 1.0), (0.07, 0.7), (0.1, 0.84), (0.06, 0.45), (0.12, 0.6), (0.08, 0.26), (0.12, 0.36)):
        # Joints across the strike notch the crest; between two of them a plate has its own top.
        marks = [-half - 0.2]
        while marks[-1] < half + 0.2:
            marks.append(marks[-1] + rng.uniform(0.18, 0.6))
        marks = np.array(marks)
        count = len(marks) + 1
        plates.append({
            "s": s, "tau": tau, "gain": gain, "marks": marks,
            "lift": rng.uniform(-0.4, 0.12, count), "slope": rng.uniform(-0.55, 0.55, count),
            "notch": rng.uniform(0.12, 0.4, len(marks)), "width": rng.uniform(0.04, 0.07, len(marks)),
        })
        s -= tau
    wmax = 1.32 * (1.0 - plates[0]["s"] * cd) / sd
    grooves = plates[0]["marks"]

    def envelope(x):
        u = np.clip((x + half) / (2.0 * half), 0.0, 1.0)
        return u ** 1.5 * (1.0 - u) ** 0.8 / 0.3185

    def crest(plate, x):
        env = envelope(x)
        marks = plate["marks"]
        last = len(marks) - 1
        j = np.searchsorted(marks, x)
        mid = 0.5 * (marks[np.clip(j - 1, 0, last)] + marks[np.clip(j, 0, last)])
        w = wmax * plate["gain"] * env * (1.0 + plate["lift"][j]) + plate["slope"][j] * (x - mid) * env
        near = np.clip(j, 1, last)
        for k in (near - 1, near):
            w = w - plate["notch"][k] * np.maximum(0.0, 1.0 - np.abs(x - marks[k]) / plate["width"][k]) * (0.3 + env)
        return w - 0.55 * (1.0 - env) ** 2

    def base(q):
        x, y = q[:, 0], q[:, 1]
        z = q[:, 2] - 0.07 * np.sin(1.2 * x + 0.4) + 0.1
        st = y * cd - z * sd
        w = y * sd + z * cd
        d = np.full(len(q), 10.0)
        for plate in plates:
            body = np.maximum(st - plate["s"], plate["s"] - plate["tau"] - 0.004 - st)
            d = smin(d, smax(body, w - crest(plate, x), 0.02), 0.012)
        # Cross joints score the dip slope where they notch the crest.
        near = np.clip(np.searchsorted(grooves, x), 1, len(grooves) - 1)
        cut = np.zeros(len(q))
        for k in (near - 1, near):
            cut = np.maximum(cut, 0.028 * np.maximum(0.0, 1.0 - np.abs(x - grooves[k]) / 0.03))
        d = d + cut
        # Rubble against the scarp's foot: low, and rough.
        env = envelope(x)
        run = 0.2 + 0.12 * env
        scree = 0.22 * env * np.clip(1.0 - (z - 0.3) / run, 0.0, 1.0) ** 1.2
        scree = scree + 0.05 * fbm(P3(x * 3.2, 0.4, z * 4.5), seed + 3, 2) * env - 0.4 * (1.0 - env) ** 3 - 3.0 * np.maximum(z - 0.3 - run, 0.0)
        scree = np.where(z > 0.15, scree, -1.0)
        return smin(d, (y - scree) * 0.72, 0.03)

    blocks = Blocks()
    for x, z, size in ((0.6, 0.52, 0.075), (0.05, 0.5, 0.055), (-0.55, 0.43, 0.06), (1.1, 0.47, 0.05), (0.85, 0.6, 0.04),
                       (-0.1, 0.6, 0.045), (1.45, 0.38, 0.05)):
        y = surface_height(base, x, z)
        blocks.add((x, y + 0.25 * size, z), (size, size * rng.uniform(0.55, 0.8), size * rng.uniform(0.7, 1.0)), rng, tip=0.4)

    def field(p):
        q = warp(p, seed, 0.02, 1.6)
        d = blocks.union(base(q), q, 0.008)
        near = np.abs(d) < 0.08
        d[near] += relief(q[near], seed + 24, 0.012, 0.6)
        return finish(d, p)

    return {"field": field, "lo": (-2.15, -0.08, -0.85), "hi": (2.15, 1.2, 0.95), "voxel": v, "pad": 0.04,
            "cuts": (0.3,), "kind": "fin"}


def design_knobs():
    v = 0.0105
    seed = 81
    rng = np.random.default_rng(4306)
    mass = Mass(weld=0.02, crown=0.014, rough=0.012)
    # Four knobs on one pedestal. The two tall ones still carry their cap of harder rock (a slab
    # set askew on a neck); the others have lost theirs and are worn to stumps. None is round.
    mass.box(-0.13, -0.05, 0.16, 0.18, turn=10.0, top=0.6, core=True, corner=0.05, batter=0.1, tilt=(0.1, 0.05))
    mass.box(-0.08, -0.02, 0.19, 0.13, turn=-25.0, top=0.52, core=True, corner=0.05, batter=0.1, tilt=(-0.12, 0.0))
    mass.box(-0.11, -0.05, 0.115, 0.1, turn=30.0, top=0.8, corner=0.035, batter=0.05, tilt=(0.12, 0.06))
    mass.box(-0.1, -0.04, 0.08, 0.075, turn=12.0, top=0.93, corner=0.03, batter=0.03, lean=(0.03, 0.0))
    mass.box(-0.08, -0.04, 0.15, 0.115, turn=22.0, top=1.0, corner=0.012, batter=-0.04, floor=0.905, tilt=(0.14, -0.06))
    mass.box(-0.13, -0.02, 0.09, 0.1, turn=-15.0, top=0.975, corner=0.012, batter=-0.03, floor=0.915, tilt=(-0.12, 0.1))

    mass.box(-0.5, 0.05, 0.14, 0.13, turn=-14.0, top=0.47, core=True, corner=0.05, batter=0.1, tilt=(-0.1, 0.06))
    mass.box(-0.53, 0.07, 0.1, 0.15, turn=20.0, top=0.4, core=True, corner=0.05, batter=0.1)
    mass.box(-0.515, 0.05, 0.085, 0.08, turn=8.0, top=0.68, corner=0.03, batter=0.04, lean=(-0.03, 0.01))
    mass.box(-0.535, 0.055, 0.125, 0.1, turn=-20.0, top=0.76, corner=0.012, batter=-0.04, floor=0.665, tilt=(-0.18, 0.08))

    mass.box(0.27, 0.07, 0.14, 0.12, turn=16.0, top=0.42, core=True, corner=0.05, batter=0.1, dome=1.2)
    mass.box(0.29, 0.06, 0.09, 0.085, turn=-10.0, top=0.56, corner=0.04, batter=0.06, tilt=(0.18, 0.1), dome=2.0)

    mass.box(0.58, -0.04, 0.12, 0.11, turn=-22.0, top=0.28, core=True, corner=0.05, batter=0.12, dome=1.5)
    mass.box(0.56, -0.05, 0.07, 0.065, turn=14.0, top=0.37, corner=0.035, batter=0.08, tilt=(-0.22, 0.1), dome=2.0)
    beds = Beds([
        (0.19, 0.22, 0.018), (0.27, 0.33, -0.02), (0.4, 0.435, 0.02), (0.5, 0.58, -0.022),
        (0.62, 0.655, 0.016), (0.8, 0.87, -0.015),
    ], v * 0.6)
    joints = [
        Joints(rng, 20.0, 0.95, (0.12, 0.3), (0.02, 0.028), (0.014, 0.03), seed + 1, heights=(0.1, 1.0)),
        Joints(rng, 112.0, 0.4, (0.12, 0.3), (0.02, 0.028), (0.014, 0.03), seed + 2, heights=(0.1, 1.0)),
    ]

    def top(x, z):
        return 0.17 + 0.04 * vnoise(P3(x * 2.4, 0.3, z * 2.4), seed + 3)

    apron = Apron(mass.foot(0.1), 0.13, top, power=1.25, seed=seed + 4, ribs=0.014, rib_freq=5.0)
    blocks = Blocks()
    blocks.strew(rng, apron, (-0.95, 0.95, -0.5, 0.5), 10, (0.03, 0.055))

    def field(p):
        q = warp(p, seed, 0.03, 2.0)
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        gain = np.clip(0.75 + 0.45 * vnoise(P3(x * 2.2, y * 1.0, z * 2.2), seed + 21), 0.35, 1.0)
        d = mass.eval(q, beds(y) * gain)
        for j in joints:
            d = d + j.carve(q)
        d = smin(d, apron.field(q), 0.03)
        d = blocks.union(d, q)
        near = np.abs(d) < 0.06
        d[near] += relief(q[near], seed + 24, 0.01, 0.8)
        return finish(d, p)

    return {"field": field, "lo": (-0.98, -0.08, -0.52), "hi": (1.0, 1.08, 0.52), "voxel": v, "pad": 0.03,
            "cuts": (0.2, 0.5), "kind": "fin"}


def design_cuesta():
    v = 0.0125
    seed = 91
    rng = np.random.default_rng(4307)
    # The beds rise toward the far right-hand corner: the eye looks along the strike, so the slab
    # is a wedge in outline, its scarp in profile.
    rise = math.tan(math.radians(30.0))
    gx, gz = rise * 0.82, -rise * 0.57
    hx, hz = 0.62, -0.3
    plan = Mass()
    plan.box(-0.4, 0.0, 0.95, 0.42, turn=4.0, core=True)
    plan.box(0.25, 0.08, 0.4, 0.36, turn=-9.0, core=True)
    plan.box(0.3, -0.2, 0.36, 0.22, turn=11.0, core=True)
    plan.box(0.52, 0.16, 0.18, 0.15, turn=-16.0, core=True)
    plan.box(0.1, -0.4, 0.26, 0.1, turn=6.0, core=True)
    plan.box(-0.45, 0.4, 0.3, 0.09, turn=-5.0, core=True)
    beds = Beds([(0.19, 0.31, -0.07), (0.31, 0.43, 0.05)], v * 0.6)
    joints = [
        Joints(rng, 14.0, 1.4, (0.2, 0.45), (0.03, 0.04), (0.03, 0.07), seed + 1, heights=(-1.0, 2.0)),
        Joints(rng, 101.0, 0.8, (0.2, 0.45), (0.03, 0.04), (0.03, 0.07), seed + 2, heights=(-1.0, 2.0)),
    ]

    def base(q):
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        cap = np.minimum(1.0 + gx * (x - hx) + gz * (z - hz), 1.03)
        # Here and there the top bed has peeled back to the one under it.
        cap = cap - 0.045 * smoothstep(0.1, 0.25, vnoise(P3(x * 1.6, 0.2, z * 1.6), seed + 3))
        depth = cap - y
        gain = np.clip(0.75 + 0.45 * vnoise(P3(x * 1.8, 0.6, z * 1.8), seed + 21), 0.35, 1.0)
        scree = np.maximum(depth - 0.46, 0.0)
        off = beds(depth) * gain + 0.8 * scree + 0.25 * scree * scree
        off = off + 0.05 * vnoise(P3(x * 2.5, y * 2.0, z * 2.5), seed + 22) * smoothstep(0.46, 0.6, depth)
        d2 = plan.plan(x, z, 0.0)
        for j in joints:
            d2 = d2 + j.carve(q) * (1.0 - smoothstep(0.4, 0.5, depth))
        return smax((d2 - off) * 0.7, -depth * 0.86, 0.025)

    blocks = Blocks()
    for x, z, size in ((0.92, 0.02, 0.085), (0.86, -0.36, 0.06), (0.8, 0.36, 0.07), (1.0, -0.14, 0.05), (0.42, 0.6, 0.06),
                       (0.3, -0.72, 0.07), (0.66, -0.6, 0.05)):
        y = surface_height(base, x, z)
        blocks.add((x, y + 0.25 * size, z), (size, size * 0.6, size * 0.8), rng, tip=0.35)

    def field(p):
        q = warp(p, seed, 0.03, 1.5)
        d = blocks.union(base(q), q, 0.01)
        near = np.abs(d) < 0.08
        d[near] += relief(q[near], seed + 24, 0.012, 0.6)
        return finish(d, p)

    return {"field": field, "lo": (-1.75, -0.08, -1.3), "hi": (1.5, 1.1, 1.1), "voxel": v, "pad": 0.05,
            "cuts": (0.25, 0.6), "kind": "fin"}


DESIGNS = {
    "sentinel": design_sentinel,
    "spireA": design_spireA,
    "spireB": design_spireB,
    "arch": design_arch,
    "finA": design_finA,
    "knobs": design_knobs,
    "cuesta": design_cuesta,
}


# ── Meshing ───────────────────────────────────────────────────────────────────

def sample(design, voxel):
    """The field on a grid: evaluated block by block, and only in the blocks the surface is near."""
    lo, hi, field = design["lo"], design["hi"], design["field"]
    b = BLOCK
    blocks = [int(math.ceil((hi[i] - lo[i]) / voxel / b)) for i in range(3)]
    axes = [lo[i] + (np.arange(blocks[i] * b) + 0.5) * voxel for i in range(3)]
    centres_1d = [lo[i] + (np.arange(blocks[i]) + 0.5) * b * voxel for i in range(3)]
    gx, gy, gz = np.meshgrid(*centres_1d, indexing="ij")
    centres = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    coarse = np.concatenate([field(centres[i:i + 400000]) for i in range(0, len(centres), 400000)])
    reach = b * voxel * 0.5 * math.sqrt(3.0) * 1.3 + design["pad"]
    active = np.nonzero(np.abs(coarse) < reach)[0]
    grid = np.repeat(np.repeat(np.repeat(coarse.reshape(blocks), b, 0), b, 1), b, 2)
    view = grid.reshape(blocks[0], b, blocks[1], b, blocks[2], b).transpose(0, 2, 4, 1, 3, 5)
    off = (np.arange(b) + 0.5 - b / 2.0) * voxel
    ox, oy, oz = np.meshgrid(off, off, off, indexing="ij")
    offsets = np.stack([ox.ravel(), oy.ravel(), oz.ravel()], axis=1)
    batch = 5000
    for start in range(0, len(active), batch):
        ids = active[start:start + batch]
        points = (centres[ids][:, None, :] + offsets[None, :, :]).reshape(-1, 3)
        ix, iy, iz = np.unravel_index(ids, blocks)
        view[ix, iy, iz] = field(points).reshape(len(ids), b, b, b)
    return grid, axes, len(active) / max(1, len(centres))


def largest_piece(vertices, triangles):
    """Drop any crumb left floating beside the rock."""
    parent = list(range(len(vertices)))

    def find(i):
        root = i
        while parent[root] != root:
            root = parent[root]
        while parent[i] != root:
            parent[i], i = root, parent[i]
        return root

    for a, b, c in triangles.tolist():
        ra, rb, rc = find(a), find(b), find(c)
        if rb != ra:
            parent[rb] = ra
        if rc != ra:
            parent[find(rc)] = ra
    roots = np.array([find(i) for i in range(len(vertices))])
    keep = roots == np.bincount(roots).argmax()
    if keep.all():
        return vertices, triangles, 0
    lookup = np.full(len(vertices), -1)
    lookup[keep] = np.arange(int(keep.sum()))
    tris = lookup[triangles]
    return vertices[keep], tris[(tris >= 0).all(axis=1)], int((~keep).sum())


def signed_volume(vertices, triangles):
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def open_edges(triangles):
    """Edges that are not shared by exactly two triangles, each running the other way."""
    e = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    key = e[:, 0].astype(np.int64) * 1000003 + e[:, 1]
    back = e[:, 1].astype(np.int64) * 1000003 + e[:, 0]
    return int((~np.isin(key, back)).sum())


def mesh_object(scene, name, vertices, triangles):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices.tolist(), [], triangles.tolist())
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def _evaluated(scene, obj):
    layer = scene.view_layers[0]
    layer.update()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(layer.depsgraph))
    mesh.calc_loop_triangles()
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    tri = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("vertices", tri)
    bpy.data.meshes.remove(mesh)
    return co.reshape(-1, 3).astype(np.float64), tri.reshape(-1, 3).astype(np.int64)


def _remove(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)


def clean_object(scene, name, vertices, triangles, voxel):
    """The fine surface as one closed skin (a voxel remesh): what the levels are decimated from.

    Surface nets leave a pinched vertex wherever two faces of the field nearly touch (a joint, the
    seam under a ledge), and the collapse decimator cannot go below a count that keeps every pinch.
    """
    raw = mesh_object(scene, f"{name}.nets", vertices, triangles)
    mod = raw.modifiers.new("skin", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel * 1.1
    mod.adaptivity = 0.0
    mod.use_smooth_shade = False
    skin_v, skin_t = _evaluated(scene, raw)
    _remove(raw)
    skin_v, skin_t, _ = largest_piece(skin_v, skin_t)
    return mesh_object(scene, f"{name}.fine", skin_v, skin_t)


def decimated(scene, fine_obj, target):
    count = len(fine_obj.data.polygons)
    ratio = min(1.0, target / count)
    vertices = triangles = None
    for _ in range(3):
        mod = fine_obj.modifiers.new("level", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        vertices, triangles = _evaluated(scene, fine_obj)
        fine_obj.modifiers.remove(mod)
        if abs(len(triangles) - target) <= 0.015 * target:
            break
        ratio = min(1.0, ratio * target / len(triangles))
    # Vertices no triangle uses would be dead weight in the module.
    used = np.zeros(len(vertices), dtype=bool)
    used[triangles.ravel()] = True
    lookup = np.cumsum(used) - 1
    return vertices[used], lookup[triangles]


# ── The bake: what every vertex is shaded by ──────────────────────────────────

def hemisphere(count):
    """Cosine-weighted directions about +z (a spiral: the same set every run)."""
    out = []
    for i in range(count):
        u = (i + 0.5) / count
        phi = i * 2.399963229728653
        r = math.sqrt(u)
        out.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(1.0 - u)))
    return np.array(out)


def frame(normal):
    helper = np.array([0.0, 1.0, 0.0]) if abs(normal[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    t = np.cross(helper, normal)
    t /= np.linalg.norm(t)
    return t, np.cross(normal, t)


def blur(grid, half, passes):
    """A box blur run `passes` times along each axis: near enough a Gaussian."""
    out = grid
    for _ in range(passes):
        for axis in range(3):
            acc = out.copy()
            for k in range(1, half + 1):
                lead = [slice(None)] * 3
                lag = [slice(None)] * 3
                lead[axis] = slice(k, None)
                lag[axis] = slice(None, -k)
                acc[tuple(lead)] += out[tuple(lag)]
                acc[tuple(lag)] += out[tuple(lead)]
            acc /= 2 * half + 1
            out = acc
    return out


def trilinear(grid, origin, voxel, p):
    q = (p - origin) / voxel
    limit = np.array(grid.shape) - 2
    i = np.clip(np.floor(q).astype(np.int64), 0, limit)
    f = np.clip(q - i, 0.0, 1.0)
    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    c00 = grid[x, y, z] * (1.0 - fx) + grid[x + 1, y, z] * fx
    c10 = grid[x, y + 1, z] * (1.0 - fx) + grid[x + 1, y + 1, z] * fx
    c01 = grid[x, y, z + 1] * (1.0 - fx) + grid[x + 1, y, z + 1] * fx
    c11 = grid[x, y + 1, z + 1] * (1.0 - fx) + grid[x + 1, y + 1, z + 1] * fx
    return (c00 * (1.0 - fy) + c10 * fy) * (1.0 - fz) + (c01 * (1.0 - fy) + c11 * fy) * fz


class Bake:
    """The fine rock as the bake reads it: its field on the grid, and its mesh for the rays."""

    def __init__(self, grid, axes, voxel, vertices, triangles):
        self.origin = np.array([axes[0][0], axes[1][0], axes[2][0]])
        self.voxel = voxel
        near = np.clip(grid, -3.0 * voxel, 3.0 * voxel).astype(np.float32)
        self.soft = {"hi": blur(near, 1, 1), "lo": blur(near, 1, 2)}
        rock = (grid < 0.0).astype(np.float32)
        # (The sand counts as rock: where a wall meets it is a crevice, not an edge.)
        rock[:, axes[1] < 0.0, :] = 1.0
        self.rock = blur(rock, 2, 3)
        self.bvh = BVHTree.FromPolygons(vertices.tolist(), triangles.tolist())

    def normals(self, points, level):
        grid = self.soft[level]
        out = np.empty_like(points)
        for axis in range(3):
            step = np.zeros(3)
            step[axis] = self.voxel
            out[:, axis] = trilinear(grid, self.origin, self.voxel, points + step) - trilinear(grid, self.origin, self.voxel, points - step)
        length = np.linalg.norm(out, axis=1, keepdims=True)
        out = np.where(length > 1e-9, out / np.maximum(length, 1e-9), np.array([0.0, 1.0, 0.0]))
        return out

    def crest(self, points):
        return np.clip(0.5 + (0.5 - trilinear(self.rock, self.origin, self.voxel, points)) * CREST_GAIN, 0.0, 1.0)

    def ao(self, points, normals, rays):
        dirs = hemisphere(rays)
        out = np.empty(len(points))
        cast = self.bvh.ray_cast
        nearest = self.bvh.find_nearest
        lift = self.voxel * 0.8
        for i in range(len(points)):
            n = normals[i]
            hit = nearest(Vector(points[i]))
            p = np.array(hit[0]) if hit[0] is not None else points[i]
            t, b = frame(n)
            # Each vertex turns the spiral by its own angle: no pattern is shared between them.
            turn = (i * 0.61803398875) % 1.0 * math.tau
            ct, st = math.cos(turn), math.sin(turn)
            world = (np.outer(dirs[:, 0] * ct - dirs[:, 1] * st, t) + np.outer(dirs[:, 0] * st + dirs[:, 1] * ct, b)
                     + np.outer(dirs[:, 2], n))
            o = p + n * lift
            if o[1] < 0.002:
                o[1] = 0.002
            oy = float(o[1])
            start = Vector(o)
            dark = 0.0
            for dx, dy, dz in world.tolist():
                limit = AO_REACH
                if dy < -1e-6:
                    limit = min(limit, -oy / dy)
                found = cast(start, Vector((dx, dy, dz)), limit)
                if found[0] is not None:
                    dark += (1.0 - found[3] / AO_REACH) ** 1.5
                elif limit < AO_REACH:
                    dark += (1.0 - limit / AO_REACH) ** 1.5
            out[i] = 1.0 - AO_GAIN * dark / rays
        return np.clip(out, 0.04, 1.0)


def shade(bake, vertices, triangles, level, rays):
    """A level with what it is shaded by. A vertex is split where its faces part by more than
    CREASE (an arris between two cliff faces, the lip of a ledge): each side then keeps its own
    normal and occlusion, read from the fine rock a little way into that side. Elsewhere the
    surface is smooth."""
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    area = np.linalg.norm(face, axis=1)
    face_n = face / np.maximum(area[:, None], 1e-12)
    centroid = (a + b + c) / 3.0
    limit = math.cos(math.radians(CREASE[level]))
    corners = [[] for _ in vertices]
    for f, tri in enumerate(triangles.tolist()):
        for k in range(3):
            corners[tri[k]].append((f, k))
    out_t = triangles.copy()
    weld, group_n, inward = [], [], []
    for v, uses in enumerate(corners):
        groups = []
        for f, k in sorted(uses, key=lambda use: (-area[use[0]], use[0])):
            for group in groups:
                if float(face_n[f] @ group[0]) > limit:
                    group[1].append((f, k))
                    break
            else:
                groups.append((face_n[f], [(f, k)]))
        for _, members in groups:
            faces = [f for f, _ in members]
            w = area[faces]
            n = (face_n[faces] * w[:, None]).sum(axis=0)
            index = len(weld)
            weld.append(v)
            group_n.append(n / max(float(np.linalg.norm(n)), 1e-12))
            inward.append((centroid[faces] * w[:, None]).sum(axis=0) / max(float(w.sum()), 1e-12))
            for f, k in members:
                out_t[f, k] = index
    weld = np.array(weld)
    group_n = np.array(group_n)
    points = vertices[weld]
    probe = points + (np.array(inward) - points) * 0.3
    fine = bake.normals(probe, level)
    agree = (fine * group_n).sum(axis=1)
    normals = np.where((agree > 0.3)[:, None], fine * 0.6 + group_n * 0.4, group_n)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    ao = neighbour_mean(bake.ao(probe, normals, rays), out_t, 0.3)
    return {"vertices": points, "triangles": out_t, "normals": normals, "ao": ao, "crest": bake.crest(points), "weld": weld}


def neighbour_mean(values, triangles, weight):
    """Ease a per-vertex value toward the mean of its neighbours (a speck is not a feature)."""
    total = np.zeros(len(values))
    count = np.zeros(len(values))
    for a, b in ((0, 1), (1, 2), (2, 0)):
        np.add.at(total, triangles[:, a], values[triangles[:, b]])
        np.add.at(count, triangles[:, a], 1.0)
        np.add.at(total, triangles[:, b], values[triangles[:, a]])
        np.add.at(count, triangles[:, b], 1.0)
    return values * (1.0 - weight) + weight * total / np.maximum(count, 1.0)


# ── Proxies: the cylinders that stand in for the solid ────────────────────────

def section(vertices, triangles, y):
    """The cross-section at height y: its segments in (x, z)."""
    s = vertices[:, 1][triangles] - y
    above = s > 0
    count = above.sum(axis=1)
    crossing = (count == 1) | (count == 2)
    tris = triangles[crossing]
    s = s[crossing]
    above = above[crossing]
    rows = np.arange(len(tris))
    lone = np.where(above.sum(axis=1) == 1, np.argmax(above, axis=1), np.argmin(above, axis=1))
    i0 = tris[rows, lone]
    i1 = tris[rows, (lone + 1) % 3]
    i2 = tris[rows, (lone + 2) % 3]
    s0 = s[rows, lone]
    s1 = s[rows, (lone + 1) % 3]
    s2 = s[rows, (lone + 2) % 3]
    p = vertices[i0] + (vertices[i1] - vertices[i0]) * (s0 / (s0 - s1))[:, None]
    q = vertices[i0] + (vertices[i2] - vertices[i0]) * (s0 / (s0 - s2))[:, None]
    return p[:, [0, 2]], q[:, [0, 2]]


def raster(a, b, xs, zs):
    """A section filled on a grid (even-odd along x)."""
    mask = np.zeros((len(zs), len(xs)), dtype=bool)
    az, bz = a[:, 1], b[:, 1]
    for j, zv in enumerate(zs):
        cross = (az > zv) != (bz > zv)
        if not cross.any():
            continue
        t = (zv - az[cross]) / (bz[cross] - az[cross])
        xi = np.sort(a[cross, 0] + t * (b[cross, 0] - a[cross, 0]))
        mask[j] = np.searchsorted(xi, xs) % 2 == 1
    return mask


def components(mask):
    """The connected patches of a mask (4-connected), largest first."""
    seen = np.zeros_like(mask)
    out = []
    rows, cols = mask.shape
    for j0, i0 in zip(*np.nonzero(mask)):
        if seen[j0, i0]:
            continue
        stack = [(int(j0), int(i0))]
        seen[j0, i0] = True
        cells = []
        while stack:
            j, i = stack.pop()
            cells.append((j, i))
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nj, ni = j + dj, i + di
                if 0 <= nj < rows and 0 <= ni < cols and mask[nj, ni] and not seen[nj, ni]:
                    seen[nj, ni] = True
                    stack.append((nj, ni))
        out.append(np.array(cells))
    return sorted(out, key=lambda c: (-len(c), int(c[0][0]), int(c[0][1])))


def measure(vertices, triangles, cuts):
    """The footprint's centroid and radius, and the proxies: per tier (between two cuts) and per
    separate piece of the solid there, one or more upright cylinders { t0, t1, r, x, z }."""
    lo = vertices.min(axis=0)
    hi = vertices.max(axis=0)
    cell = max(hi[0] - lo[0], hi[2] - lo[2]) / 150.0
    xs = np.arange(lo[0] - cell, hi[0] + cell, cell)
    zs = np.arange(lo[2] - cell, hi[2] + cell, cell)
    marks = [-BURY] + [c for c in cuts if c < 1.0] + [1.0]
    proxies = []
    for t0, t1 in zip(marks, marks[1:]):
        slices = 8
        heights = [t0 + (t1 - t0) * (k + 0.5) / slices + 1.3e-5 for k in range(slices)]
        layers = np.array([raster(*section(vertices, triangles, y), xs, zs) for y in heights])
        solid = layers.sum(axis=0) >= slices // 2
        for cells in components(solid):
            area = len(cells) * cell * cell
            if area < math.pi * PROXY_MIN * PROXY_MIN:
                continue
            # How high this piece stands within the tier.
            share = layers[:, cells[:, 0], cells[:, 1]].mean(axis=1)
            filled = np.nonzero(share > 0.4)[0]
            b0 = t0 if filled[0] == 0 else t0 + (t1 - t0) * filled[0] / slices
            b1 = t1 if filled[-1] == slices - 1 else t0 + (t1 - t0) * (filled[-1] + 1) / slices
            pts = np.stack([xs[cells[:, 1]], zs[cells[:, 0]]], axis=1)
            centre = pts.mean(axis=0)
            cov = np.cov((pts - centre).T) if len(pts) > 2 else np.eye(2)
            values, vectors = np.linalg.eigh(cov)
            major = vectors[:, 1] if vectors[0, 1] >= 0 else -vectors[:, 1]
            along = (pts - centre) @ major
            length = float(along.max() - along.min()) + cell
            width = area / length
            # A long piece is a row of cylinders, none of them thinner than PROXY_MIN.
            count = int(min(4, max(1, round(length / (1.3 * width))), max(1, area // (math.pi * PROXY_MIN * PROXY_MIN))))
            if length < 1.7 * width:
                count = 1
            edges = np.linspace(along.min(), along.max() + 1e-9, count + 1)
            for k in range(count):
                part = pts[(along >= edges[k]) & (along < edges[k + 1])]
                if len(part) < 3:
                    continue
                c = part.mean(axis=0)
                r = math.sqrt(len(part) * cell * cell / math.pi) * 0.96
                if r < PROXY_MIN:
                    continue
                proxies.append({"t0": round(float(b0), 4), "t1": round(float(b1), 4), "r": round(r, 4),
                                "x": round(float(c[0]), 4), "z": round(float(c[1]), 4)})
    return proxies


def footprint_of(vertices, triangles):
    """The section at the sand: its centroid (x, z) and how far it reaches from the origin."""
    a, b = section(vertices, triangles, 1.3e-5)
    # (The centroid of a filled raster: the section's segments come in no order.)
    lo = np.minimum(a.min(axis=0), b.min(axis=0))
    hi = np.maximum(a.max(axis=0), b.max(axis=0))
    cell = max(hi[0] - lo[0], hi[1] - lo[1]) / 400.0
    xs = np.arange(lo[0] - cell, hi[0] + cell, cell)
    zs = np.arange(lo[1] - cell, hi[1] + cell, cell)
    mask = raster(a, b, xs, zs)
    jj, ii = np.nonzero(mask)
    centre = np.array([xs[ii].mean(), zs[jj].mean()])
    reach = float(max(np.hypot(a[:, 0], a[:, 1]).max(), np.hypot(b[:, 0], b[:, 1]).max()))
    return centre, reach


# ── Build ─────────────────────────────────────────────────────────────────────

def quantised(model):
    """The level as the module holds it (and as the game reads it back)."""
    q = np.rint(model["vertices"] / QUANT).astype(np.int64)
    tris = model["triangles"]
    a, b, c = (q[tris[:, i]] for i in range(3))
    alive = np.abs(np.cross(b - a, c - a)).sum(axis=1) > 0
    out = dict(model)
    out["positions"] = q
    out["triangles"] = tris[alive]
    out["vertices"] = q * QUANT
    return out


def build_one(scene, name, draft):
    clock = time.time()
    design = DESIGNS[name]()
    voxel = design["voxel"] * (1.6 if draft else 1.0)
    grid, axes, active = sample(design, voxel)
    t_field = time.time() - clock
    fine_v, fine_t = surface_nets(grid, *axes)
    fine_v, fine_t, crumbs = largest_piece(fine_v, fine_t)
    if signed_volume(fine_v, fine_t) < 0:
        fine_t = fine_t[:, ::-1].copy()
    print(TAG, name, "fine", len(fine_v), len(fine_t), fine_v.min(axis=0).round(3).tolist(), fine_v.max(axis=0).round(3).tolist(),
          f"field {t_field:.1f}s active {active:.3f}", flush=True)
    if open_edges(fine_t):
        # (An open skin has no inside: the remesh that follows would return shreds.)
        raise RuntimeError(f"{name}: the surface leaves the sampling box")
    bake = Bake(grid, axes, voxel, fine_v, fine_t)
    fine_obj = clean_object(scene, name, fine_v, fine_t, voxel)
    info = {"voxel": voxel, "grid": list(grid.shape), "active": round(active, 3), "fine": [len(fine_v), len(fine_t)],
            "crumbs": crumbs, "field_s": round(t_field, 1)}
    levels = {}
    for index, level in enumerate(("hi", "lo")):
        target = int(BUDGET[name][index] * BUDGET_SHARE)
        vertices, triangles = decimated(scene, fine_obj, target)
        print(TAG, name, level, len(vertices), len(triangles), vertices.min(axis=0).round(3).tolist(),
              vertices.max(axis=0).round(3).tolist(), f"{time.time() - clock:.1f}s", flush=True)
        if signed_volume(vertices, triangles) < 0:
            triangles = triangles[:, ::-1].copy()
        levels[level] = shade(bake, vertices, triangles, level, 24 if draft else AO_RAYS)
    _remove(fine_obj)
    # Into the module's space: the top at one, the axis at the footprint's centroid.
    centre = None
    entry = {"kind": design["kind"]}
    for level in ("hi", "lo"):
        model = levels[level]
        scale = 1.0 / float(model["vertices"][:, 1].max())
        vertices = model["vertices"] * scale
        if centre is None:
            centre, _ = footprint_of(vertices, model["triangles"])
            info["scale"] = round(scale, 5)
            info["centre"] = [round(float(c), 4) for c in centre]
        vertices[:, 0] -= centre[0]
        vertices[:, 2] -= centre[1]
        vertices[:, 1] = np.maximum(vertices[:, 1], -BURY)
        model["vertices"] = vertices
        model = quantised(model)
        # Checks: a closed skin, the right way out, the normals with the faces.
        tris = model["triangles"]
        a, b, c = (model["vertices"][tris[:, i]] for i in range(3))
        face = np.cross(b - a, c - a)
        agree = (face * (model["normals"][tris].sum(axis=1))).sum(axis=1) > 0
        info[level] = {
            "vertices": len(model["vertices"]), "triangles": len(tris), "open_edges": open_edges(model["weld"][tris]),
            "volume": round(signed_volume(model["vertices"], tris), 4), "normals_out": round(float(agree.mean()), 4),
            "y": [round(float(model["vertices"][:, 1].min()), 4), round(float(model["vertices"][:, 1].max()), 4)],
            "ao": [round(float(model["ao"].min()), 2), round(float(np.median(model["ao"])), 2)],
            "crest": [round(float(np.percentile(model["crest"], 5)), 2), round(float(np.percentile(model["crest"], 95)), 2)],
        }
        if len(model["vertices"]) > 65535:
            raise RuntimeError(f"{name} {level}: {len(model['vertices'])} vertices do not fit Uint16 indices")
        entry[level] = model
    hi = entry["hi"]
    entry["proxies"] = measure(hi["vertices"], hi["triangles"], design["cuts"])
    _, reach = footprint_of(hi["vertices"], hi["triangles"])
    entry["footprint"] = math.ceil(reach * 1000.0) / 1000.0
    info["extent"] = [[round(float(c), 3) for c in hi["vertices"].min(axis=0)], [round(float(c), 3) for c in hi["vertices"].max(axis=0)]]
    info["footprint"] = entry["footprint"]
    info["seconds"] = round(time.time() - clock, 1)
    print(TAG, name, json.dumps(info))
    print(TAG, name, "proxies", json.dumps(entry["proxies"]))
    return entry, info


# ── The module the theme imports ──────────────────────────────────────────────

def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def level_text(model):
    positions = model["positions"].ravel().tolist()
    normals = np.rint(np.clip(model["normals"], -1.0, 1.0) * 127.0).astype(np.int64).ravel().tolist()
    shade = np.stack([np.rint(np.clip(model["ao"], 0.0, 1.0) * 255.0), np.rint(np.clip(model["crest"], 0.0, 1.0) * 255.0)],
                     axis=1).astype(np.int64).ravel().tolist()
    index = model["triangles"].ravel().tolist()
    return ("{ " + f"vertexCount: {len(model['positions'])}, triangleCount: {len(model['triangles'])}, "
            f"positions: '{b64('h', positions)}', normals: '{b64('b', normals)}', shade: '{b64('B', shade)}', "
            f"index: '{b64('H', index)}'" + " }")


def write_module(path, built):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Shifting Sands' sandstone formations: GENERATED by scripts/blender/shifting_sands_rocks.py (do",
        " * not edit by hand).",
        " *",
        " * Seven eroded landforms sculpted by script in Blender (a signed distance field of jointed, bedded",
        " * rock on a talus apron, polygonised and decimated), each at two levels, `hi` and `lo`, of the",
        " * same solid. Space: +y up, the sand at y = 0, the highest point at y = 1, the solid going on down",
        " * to y = -0.06; x and z in the same unit, the axis at the centroid of the footprint, the long axis",
        " * along x. `positions` are Int16 xyz in units of `quant`; `normals` Int8 xyz (x127: the fine",
        " * surface's normal, smoothed; a vertex is split only where its faces part sharply); `shade` Uint8",
        " * pairs (ambient occlusion with the ground, 255 = open; crest: 0 in a crevice or joint, 128 on a",
        " * flat face, 255 on an exposed edge or crown); `index` Uint16 triangles, wound counter-clockwise",
        " * seen from outside. `proxies` are flat-topped upright cylinders { t0, t1, r, x, z } that stand in",
        " * for the solid, measured from the `hi` mesh, bottom first; `footprint` is the radius about the",
        " * axis inside which the rock meets the sand.",
        " */",
        "export const SHIFTING_SANDS_ROCK_MODELS = Object.freeze({",
        f"    quant: {QUANT!r},",
        "    models: {",
    ]
    for name in DESIGNS:
        entry = built[name]
        proxies = ", ".join("{ " + ", ".join(f"{k}: {p[k]!r}" for k in ("t0", "t1", "r", "x", "z")) + " }" for p in entry["proxies"])
        lines += [
            f"        {name}: {{",
            f"            kind: '{entry['kind']}',",
            f"            hi: {level_text(entry['hi'])},",
            f"            lo: {level_text(entry['lo'])},",
            f"            proxies: [{proxies}],",
            f"            footprint: {entry['footprint']!r},",
            "        },",
        ]
    lines += ["    },", "});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# ── Previews ──────────────────────────────────────────────────────────────────

def _to_blender(points):
    """Game space (+y up) to Blender's (+z up): the same handedness."""
    p = np.asarray(points, dtype=np.float64)
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


def _linear(value):
    """Display value to the linear value the view transform turns back into it."""
    value = np.clip(value, 0.0, 1.0)
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def lit_colour(model):
    """The theme's shading, near enough to judge the bake by: the two low suns, a violet sky fill,
    the sand's bounce, strata by height, the baked occlusion and crest. No cast shadows."""
    n = model["normals"]
    y = model["vertices"][:, 1]
    ao = model["ao"]
    crest = model["crest"]
    band = 0.5 + 0.5 * np.sin(y * 46.0 + 1.3 * np.sin(y * 17.0))
    rock = np.array([0.6, 0.27, 0.14])[None, :] * (0.8 + 0.34 * band)[:, None]
    slope = smoothstep(0.35, 0.75, n[:, 1])
    rock = rock * (1.0 - slope)[:, None] + np.array([0.62, 0.38, 0.22])[None, :] * slope[:, None]
    rock = rock * (0.66 + 0.68 * crest)[:, None]
    key = (np.clip(n @ unit(SUN_A), 0.0, 1.0)[:, None] * np.array([1.0, 0.5, 0.22]) * 2.3
           + np.clip(n @ unit(SUN_B), 0.0, 1.0)[:, None] * np.array([1.0, 0.82, 0.55]) * 0.7)
    fill = np.array([0.15, 0.13, 0.3])[None, :] * (0.55 + 0.45 * n[:, 1])[:, None]
    bounce = np.array([0.22, 0.12, 0.07])[None, :] * np.clip(0.35 - 0.65 * n[:, 1], 0.0, 1.0)[:, None]
    return np.clip(rock * (key * (0.3 + 0.7 * ao)[:, None] + (fill + bounce) * (ao * ao)[:, None]), 0.0, 1.0)


def _object(collection, name, model, colour=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(_to_blender(model["vertices"]).tolist(), [], model["triangles"].tolist())
    mesh.update()
    attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    rgba = np.ones((len(model["vertices"]), 4))
    if colour is not None:
        rgba[:, :3] = colour[:, None] if colour.ndim == 1 else colour
    attr.data.foreach_set("color", rgba.ravel())
    mesh.color_attributes.active_color = attr
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def _read(path):
    image = bpy.data.images.load(str(path))
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    bpy.data.images.remove(image)
    return px.reshape(h, w, 4)[::-1]


def _write(path, px):
    h, w = px.shape[:2]
    image = bpy.data.images.new("sheet", w, h, alpha=False)
    image.pixels.foreach_set(np.ascontiguousarray(px[::-1], dtype=np.float32).ravel())
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def _sheet(rows, gap=6, background=(0.35, 0.35, 0.35, 1.0)):
    """Images laid out in rows (each a list of arrays), top to bottom."""
    widths = [sum(im.shape[1] for im in row) + gap * (len(row) - 1) for row in rows]
    tall = [max(im.shape[0] for im in row) for row in rows]
    out = np.empty((sum(tall) + gap * (len(rows) - 1), max(widths), 4), dtype=np.float32)
    out[:] = background
    y = 0
    for row, h in zip(rows, tall):
        x = 0
        for im in row:
            out[y:y + im.shape[0], x:x + im.shape[1]] = im
            x += im.shape[1] + gap
        y += h + gap
    return out


SKY = {EYE_RIGHT: (0.42, 0.33, 0.5), EYE_LEFT: (1.0, 0.72, 0.4)}


def previews(scene, built, out_dir, shots):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    col = bpy.data.collections.new("ShiftingSandsRocksPreview")
    scene.collection.children.link(col)
    world = bpy.data.worlds.new("ShiftingSandsRocksWorld")
    scene.world = world
    scene.view_settings.view_transform = "Standard"
    try:
        scene.view_settings.look = "None"
    except Exception:
        pass
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    try:
        scene.render.image_settings.media_type = "IMAGE"
    except Exception:
        pass
    scene.render.image_settings.file_format = "PNG"
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.show_object_outline = False
    scene.display.render_aa = "16"
    cam_data = bpy.data.cameras.new("ShiftingSandsRocksCam")
    cam_data.type = "ORTHO"
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new("ShiftingSandsRocksCam", cam_data)
    cam.rotation_mode = "QUATERNION"
    col.objects.link(cam)
    scene.camera = cam
    files = []

    def shoot(path, model, colour, eye, px, mode, background, margin=0.06):
        """One rock seen level from `eye` (its direction from the rock), `px` pixels a unit height."""
        obj = _object(col, "pv", model, colour)
        e = Vector((eye[0], -eye[2], 0.0)).normalized()
        look = -e
        right = look.cross(Vector((0.0, 0.0, 1.0))).normalized()
        co = _to_blender(model["vertices"])
        u = co @ np.array(right)
        u0, u1 = float(u.min()) - margin, float(u.max()) + margin
        z0, z1 = -BURY - 0.02, 1.0 + margin
        cam.rotation_quaternion = look.to_track_quat("-Z", "Y")
        cam.location = right * ((u0 + u1) * 0.5) + Vector((0.0, 0.0, (z0 + z1) * 0.5)) + e * 60.0
        width, height = u1 - u0, z1 - z0
        cam_data.ortho_scale = max(width, height)
        scene.render.resolution_x = max(4, int(round(width * px)))
        scene.render.resolution_y = max(4, int(round(height * px)))
        world.color = background
        if mode == "clay":
            obj.data.polygons.foreach_set("use_smooth", [False] * len(obj.data.polygons))
            shading.light = "STUDIO"
            shading.color_type = "SINGLE"
            shading.single_color = (0.8, 0.62, 0.5)
            shading.show_cavity = True
            shading.cavity_type = "BOTH"
            shading.show_shadows = True
            shading.shadow_intensity = 0.55
            sun = unit(SUN_A) * np.array([1.0, 1.0, 1.0]) + np.array([0.0, 0.25, 0.0])
            scene.display.light_direction = Vector((sun[0], -sun[2], sun[1])).normalized()
        else:
            shading.light = "FLAT"
            shading.show_cavity = False
            shading.show_shadows = False
            shading.color_type = "SINGLE" if mode == "black" else "VERTEX"
            shading.single_color = (0.0, 0.0, 0.0)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        return _read(path)

    def turned(eye, degrees):
        a = math.radians(degrees)
        c, s = math.cos(a), math.sin(a)
        return (eye[0] * c + eye[2] * s, 0.0, -eye[0] * s + eye[2] * c)

    tmp = out / "_panel.png"
    for name, entry in built.items():
        eye, game_px = GAME[name]
        hi, lo = entry["hi"], entry["lo"]
        wide = float(np.ptp(hi["vertices"][:, 0])) + float(np.ptp(hi["vertices"][:, 2])) * 0.6
        px = int(min(560, max(260, 1500 / (wide + 0.2))))
        sky = SKY[eye]
        if "sil" in shots:
            rows = [[shoot(tmp, hi, None, eye, px, "black", sky), shoot(tmp, lo, None, eye, px, "black", sky)]]
            _write(out / f"{name}-sil.png", _sheet(rows))
            files.append(str(out / f"{name}-sil.png"))
        if "lit" in shots:
            rows = [[shoot(tmp, hi, lit_colour(hi), eye, px, "vertex", sky)], [shoot(tmp, lo, lit_colour(lo), eye, px, "vertex", sky)]]
            _write(out / f"{name}-lit.png", _sheet(rows))
            files.append(str(out / f"{name}-lit.png"))
        if "bake" in shots:
            rows = [[shoot(tmp, hi, _linear(hi["ao"]), eye, px, "vertex", (0.0, 0.0, 0.0))],
                    [shoot(tmp, hi, _linear(hi["crest"]), eye, px, "vertex", (0.0, 0.0, 0.0))]]
            _write(out / f"{name}-bake.png", _sheet(rows))
            files.append(str(out / f"{name}-bake.png"))
        if "clay" in shots:
            rows = [[shoot(tmp, hi, None, eye, px, "clay", (0.25, 0.25, 0.28))], [shoot(tmp, lo, None, eye, px, "clay", (0.25, 0.25, 0.28))]]
            _write(out / f"{name}-clay.png", _sheet(rows))
            files.append(str(out / f"{name}-clay.png"))
        if "turn" in shots:
            small = int(px * 0.55)
            rows = [[shoot(tmp, hi, None, turned(eye, a), small, "black", sky) for a in (-40.0, 0.0, 40.0)],
                    [shoot(tmp, hi, None, turned(eye, a), small, "black", sky) for a in (90.0, 180.0, 270.0)]]
            _write(out / f"{name}-turn.png", _sheet(rows))
            files.append(str(out / f"{name}-turn.png"))
    if "game" in shots:
        # At the size the player sees them, x4.
        rows = []
        for group in (("sentinel", "spireB", "spireA"), ("arch", "finA", "knobs", "cuesta")):
            names = [n for n in group if n in built]
            if not names:
                continue
            for level, mode in (("hi", "vertex"), ("lo", "vertex"), ("hi", "black")):
                row = []
                for n in names:
                    eye, game_px = GAME[n]
                    model = built[n][level]
                    colour = lit_colour(model) if mode == "vertex" else None
                    row.append(shoot(tmp, model, colour, eye, game_px, mode, SKY[eye], margin=0.04))
                rows.append(row)
        if rows:
            sheet = _sheet(rows, gap=3)
            _write(out / "contact-game-size.png", np.repeat(np.repeat(sheet, 4, axis=0), 4, axis=1))
            files.append(str(out / "contact-game-size.png"))
    if tmp.exists():
        tmp.unlink()
    return files


# ── Entry ─────────────────────────────────────────────────────────────────────

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    names = list(DESIGNS)
    shots = {"sil", "lit", "bake", "clay", "turn", "game"}
    draft = "--draft" in argv
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        if a == "--preview":
            preview_dir = argv[i + 1]
        if a == "--only":
            names = [n for n in argv[i + 1].split(",") if n in DESIGNS]
        if a == "--shots":
            shots = set(argv[i + 1].split(","))
        if a == "--crease":
            CREASE.update(hi=float(argv[i + 1]), lo=float(argv[i + 1]))
    scene = bpy.data.scenes.new(SCENE)
    built = {}
    report = {}
    for name in names:
        built[name], report[name] = build_one(scene, name, draft)
    if out and len(names) == len(DESIGNS) and not draft:
        path = Path(out) / MODULE
        write_module(path, built)
        print(TAG, "wrote", path, f"{path.stat().st_size / 1024:.1f} KiB")
    elif out:
        print(TAG, "--only and --draft build previews; the module needs every design at full detail")
    if preview_dir:
        for f in previews(scene, built, preview_dir, shots):
            print(TAG, "preview", f)


if __name__ == "__main__":
    main()
