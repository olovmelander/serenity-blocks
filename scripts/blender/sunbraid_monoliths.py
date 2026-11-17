"""Sunbraid's standing stones: eight monoliths, built by script in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sunbraid_monoliths.py -- \
        --out src/themes/sunbraid [--preview <dir>] [--only 0,3] [--shots sil,turn,lit,bake]

The valley's towers stand under three coloured suns that hang low in front of the eye, with almost
no fill. A plane lit so is one clean block of colour and an arris is where two colours meet, so
every stone here is made of PLANES: nothing is rounded and nothing is noisy. Each is built for its
silhouette first (the towers left of the board are seen against the suns), and the eight read apart
at sixty pixels:

    0  tower   the Organ (the hero): a jointed shaft on a stepped plinth, its columns broken off at
               different heights like organ pipes, a cleft of sky through the crown
    1  butte   the Table: a broad block with a second block set off to one side, a corner block gone
    2  tower   the Stair: three tiers set toward one side, sheer on one flank and stepped on the other
    3  mitten  the Mitten: a long shoulder stepping down away from one thick thumb
    4  tower   the Hoodoo: three slim tiers, a waisted neck and a wide cap rock
    5  butte   the Citadel: a tall massive block, its crown a stair of broken columns
    6  tower   the Needle: one slim setback, a block bitten out of its flank, a cap rock set askew
    7  mitten  the Fork: a blocky shoulder with a notch, its thumb split into two prongs

How a stone is made. A tier is a bundle of leaning prisms: a broad one on the tier's axis (its
body) and four to seven more standing against it like buttresses, each an irregular polygon of
cliff faces, each leaning its own way by a degree, each broken off at its own height, most with a
slanting scar across the top. The grooves where two prisms meet are the stone's joints. Each prism
is cut into beds: a hard bed stands out as a ledge, a soft bed is undercut, and a bed runs along
one flank only (a bed that rings the whole stone is a collar: a made thing). Every such run of a
prism is a convex solid (the intersection of half-spaces); fallen blocks lean against the foot;
missing blocks and clefts are convex bites. Blender fuses the solids and cuts the bites (booleans,
the Manifold solver), so every face of the result is a plane and every arris a line.

The fused skin is welded, every plane's faces merged into one, and cut along the ground (so that
there are vertices where the stone meets it). Each flat face is then triangulated on its own
(a constrained Delaunay triangulation): its edges cut into pieces, a lattice of points strewn
inside it, and on the `hi` level a row of points a fixed distance inside every arris, so that what
the bake finds along an arris fades over that width whatever the triangles. The piece length is the
finest that meets the level's triangle budget (`hi`, `lo`: the same solid, so the same silhouette).
Every vertex is given what the theme shades it by:

    normal   its plane's normal: vertices are split wherever planes meet, so planes shade flat
    ao       ambient occlusion: cosine-weighted rays against the solid and a ground plane at y = 0
    crest    0 in a crevice or joint, 0.5 on a flat face, 1 on an exposed arris or crown

Space: +y up, the foot at y = 0, the top at y = 1, x and z in the same unit (a tower's height); the
solid goes on down to y = -0.05 so that it never floats on uneven ground. The shadows in the game
are analytic (flat-topped vertical cylinders), so each variant's `proxies` are measured from the
finished mesh: per tier, its axis at the centroid of the cross-sections and its radius that of a
circle of the typical section's area.

The export is one module, src/themes/sunbraid/sunbraid-monolith-models.js: base64 typed arrays, no
loader and no asset file. Deterministic: the same script and Blender write the same bytes.
"""

import base64
import itertools
import json
import math
import sys
from array import array
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import delaunay_2d_cdt, tessellate_polygon
from mathutils.kdtree import KDTree

TAG = "[sunbraid-monoliths]"
SCENE = "SunbraidMonoliths"
MODULE = "sunbraid-monolith-models.js"

QUANT = 1.0 / 16384.0
#: The solid goes this far below the foot (unit heights).
BURY = 0.05
#: How far a column reaches into its neighbour across a joint, so that the two fuse.
JOINT = 0.004
#: The fallen blocks stay under this height.
TALUS = 0.08
#: Triangles per level. The module's size is the sum: the hero (0) and the near towers get the most.
BUDGET = {
    "hi": {0: 7000, 1: 4400, 2: 5600, 3: 4200, 4: 4600, 5: 4400, 6: 3700, 7: 3700},
    "lo": {0: 2100, 1: 1700, 2: 1900, 3: 1800, 4: 1700, 5: 1800, 6: 1500, 7: 1700},
}
#: Planes closer than this (degrees) share a vertex normal; the stones have no such faces by design.
SMOOTH = 7.0
#: The `hi` level has a row of vertices this far inside every arris: the width over which `crest`
#: and the occlusion of a joint fade there. The lattice inside a face is GRID edge-pieces apart.
RING = 0.013
GRID = 1.5
AO_RAYS = 96
AO_REACH = 0.24
AO_GAIN = 1.45
CREST_RADIUS = RING
#: What `crest` reads on a right-angled arris before the gain (two half-discs' mean).
CREST_ARRIS = 0.3
#: (The exact solver left stray inner faces where a bite met a bed; this one returns a closed skin.)
BOOLEAN_SOLVER = "MANIFOLD"
#: Vertices closer than this many quanta are welded before the faces are merged.
WELD = 2.0


# ── Planes and convex solids ──────────────────────────────────────────────────

def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def face(axis, bearing, reach, lean=0.0, height=0.0):
    """A cliff face as a half-space: its normal at `bearing` (degrees, from +x toward +z), standing
    `reach` from the axis at `height`, leaning back toward the axis by `lean` degrees as it rises."""
    b = math.radians(bearing)
    tilt = math.radians(lean)
    n = np.array([math.cos(b) * math.cos(tilt), math.sin(tilt), math.sin(b) * math.cos(tilt)])
    p = np.array([axis[0] + math.cos(b) * reach, height, axis[1] + math.sin(b) * reach])
    return n, float(n @ p), None


def level(y, up=True):
    """A bedding plane: everything below y (`up`) or above it. Its vertices get y exactly."""
    return np.array([0.0, 1.0 if up else -1.0, 0.0]), (y if up else -y), y


def convex(planes):
    """The solid inside every half-space (normal, offset, exact height or None): its vertices and
    its faces (loops wound counter-clockwise seen from outside), or None if nothing is left."""
    normals = np.array([unit(p[0]) for p in planes])
    offsets = np.array([p[1] / np.linalg.norm(p[0]) for p in planes])
    triples = np.array(list(itertools.combinations(range(len(planes)), 3)))
    systems = normals[triples]
    solvable = np.abs(np.linalg.det(systems)) > 1e-6
    triples = triples[solvable]
    if not len(triples):
        return None
    points = np.linalg.solve(systems[solvable], offsets[triples][:, :, None])[:, :, 0]
    points = points[(points @ normals.T - offsets < 1e-8).all(axis=1)]
    merged = []
    for p in points:
        if not any(np.abs(p - q).max() < 1e-7 for q in merged):
            merged.append(p)
    if len(merged) < 4:
        return None
    points = np.array(merged)
    on = np.abs(points @ normals.T - offsets) < 1e-7
    for k, plane in enumerate(planes):
        if plane[2] is not None:
            points[on[:, k], 1] = plane[2]
    faces = []
    for k in range(len(planes)):
        members = np.nonzero(on[:, k])[0]
        if len(members) < 3:
            continue
        n = normals[k]
        u = unit(np.cross((1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0), n))
        v = np.cross(n, u)
        rel = points[members] - points[members].mean(axis=0)
        loop = members[np.argsort(np.arctan2(rel @ v, rel @ u))]
        ring = points[loop]
        area = np.linalg.norm(np.cross(ring[1:-1] - ring[0], ring[2:] - ring[0]).sum(axis=0))
        if area > 1e-10:
            faces.append([int(i) for i in loop])
    if len(faces) < 4:
        return None
    # A closed solid: every edge runs once each way.
    edges = {}
    for loop in faces:
        for a, b in zip(loop, loop[1:] + loop[:1]):
            edges[(a, b)] = edges.get((a, b), 0) + 1
    if any(edges.get((b, a), 0) != 1 or count != 1 for (a, b), count in edges.items()):
        return None
    used = sorted({i for loop in faces for i in loop})
    lookup = {old: new for new, old in enumerate(used)}
    return points[used], [[lookup[i] for i in loop] for loop in faces]


def clip(polygon, n, d):
    """A plan polygon (points x, z) cut to the side n . p <= d."""
    out = []
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        sa = n[0] * a[0] + n[1] * a[1] - d
        sb = n[0] * b[0] + n[1] * b[1] - d
        if sa <= 0:
            out.append(a)
        if (sa < 0) != (sb < 0) and sa != sb:
            t = sa / (sa - sb)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def plan(sides, axis=(0.0, 0.0)):
    """The plan polygon of a ring of faces [bearing, reach, lean] at the height they are given for."""
    polygon = [(-9.0, -9.0), (9.0, -9.0), (9.0, 9.0), (-9.0, 9.0)]
    for bearing, reach, _ in sides:
        b = math.radians(bearing)
        n = (math.cos(b), math.sin(b))
        polygon = clip(polygon, n, reach + n[0] * axis[0] + n[1] * axis[1])
    return polygon


def plan_area(polygon):
    return 0.5 * abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(polygon, polygon[1:] + polygon[:1])))


def ring(rng, count, radius, turn=0.0, wobble=0.45, spread=0.08, lean=(0.6, 2.2)):
    """An irregular polygon of cliff faces: [bearing, reach, lean] each, unequal in width (`wobble`)
    and in reach (`spread`), with the area of a circle of `radius`."""
    bearings = turn + (np.arange(count) + (rng.random(count) - 0.5) * wobble) * 360.0 / count
    reach = 1.0 + (rng.random(count) * 2.0 - 1.0) * spread
    leans = lean[0] + (lean[1] - lean[0]) * rng.random(count)
    sides = [[float(b), float(r), float(t)] for b, r, t in zip(bearings, reach, leans)]
    scale = radius * math.sqrt(math.pi / plan_area(plan(sides)))
    for side in sides:
        side[1] *= scale
    return sides


def reach_of(sides, axis, bearing):
    """How far from the origin a ring's cliff stands along `bearing` (0 if the ray misses it)."""
    b = math.radians(bearing)
    d = (math.cos(b), math.sin(b))
    enter, leave = 0.0, 1e9
    for at, reach, _ in sides:
        a = math.radians(at)
        n = (math.cos(a), math.sin(a))
        along = n[0] * d[0] + n[1] * d[1]
        offset = reach + n[0] * axis[0] + n[1] * axis[1]
        if abs(along) < 1e-9:
            if offset < 0:
                return 0.0
            continue
        t = offset / along
        if along > 0:
            leave = min(leave, t)
        else:
            enter = max(enter, t)
    return leave if leave > enter else 0.0


# ── A stone: what a design gathers ────────────────────────────────────────────

class Stone:
    def __init__(self, variant, kind, seed):
        self.variant = variant
        self.kind = kind
        self.rng = np.random.default_rng(seed)
        self.solids = []
        self.bites = []
        #: Where the proxies part (the big setbacks), bottom to top.
        self.cuts = []

    def add(self, planes):
        solid = convex(planes)
        if solid is not None:
            self.solids.append(solid)
        return solid is not None

    def bite(self, planes):
        solid = convex(planes)
        if solid is not None:
            self.bites.append(solid)


def columns(stone, axis, sides, seeds, y0, tops, height, push=None, beds=(), gains=None,
            sway=2.0, lean_sway=0.35, joint_lean=1.0, trims=(), weights=None):
    """A tier: the ring `sides` round `axis`, split into columns (the Voronoi cells of `seeds`,
    given from the axis), each from y0 up to its own top.

    push    how far each column stands proud of (+) or behind (-) the ring
    beds    (from, to, step): between those heights every face stands out by `step` (a hard bed)
            or back by it (a soft bed, undercut); `gains[column][bed]` scales it per column.
            (from, to, step, bearing, spread): only the faces that look within `spread` degrees of
            `bearing` take it, so the bed runs along one flank and dies at an arris (a bed that
            rings the whole stone is a collar: a made thing)
    trims   (column or None, half-space): breaks (a corner gone, a slanting scar)
    weights grows (+) or shrinks (-) a column's cell against its neighbours
    """
    rng = stone.rng
    count = len(seeds)
    seeds = np.asarray(seeds, dtype=np.float64)
    push = push or [0.0] * count
    weights = weights or [0.0] * count
    bottoms = y0 if isinstance(y0, (list, tuple)) else [y0] * count
    tilt = {(i, j): (rng.random() * 2.0 - 1.0) * joint_lean for i in range(count) for j in range(i + 1, count)}
    for i in range(count):
        # The column's own faces: each a little off the ring's.
        own = [(b + (rng.random() * 2.0 - 1.0) * sway, r + push[i], t + (rng.random() * 2.0 - 1.0) * lean_sway)
               for b, r, t in sides]
        walls = []
        for j in range(count):
            if j == i:
                continue
            across = seeds[j] - seeds[i]
            span = float(np.hypot(*across))
            mid = (seeds[i] + seeds[j]) * 0.5 + across / span * (weights[i] - weights[j])
            lean = tilt[(min(i, j), max(i, j))] * (1.0 if i < j else -1.0)
            walls.append(face((axis[0] + mid[0], axis[1] + mid[1]),
                              math.degrees(math.atan2(across[1], across[0])), JOINT, lean, height))
        marks = sorted({bottoms[i], tops[i]} | {y for bed in beds for y in bed[:2] if bottoms[i] < y < tops[i]})
        def steps(mid):
            out = []
            for b, _, _ in own:
                total = 0.0
                for k, bed in enumerate(beds):
                    if not bed[0] < mid < bed[1]:
                        continue
                    if len(bed) > 3 and abs((b - bed[3] + 180.0) % 360.0 - 180.0) > bed[4]:
                        continue
                    total += bed[2] * (gains[i][k] if gains else 1.0)
                out.append(total)
            return out

        runs = []
        for lo, hi in zip(marks, marks[1:]):
            step = steps((lo + hi) * 0.5)
            if runs and all(abs(a - b) < 1e-9 for a, b in zip(runs[-1][2], step)):
                runs[-1][1] = hi
            else:
                runs.append([lo, hi, step])
        for lo, hi, step in runs:
            planes = [face(axis, b, r + d, t, height) for (b, r, t), d in zip(own, step)] + walls
            planes += [level(lo, False), level(hi, True)]
            planes += [plane for who, plane in trims if who is None or who == i]
            stone.add(planes)


def union_area(rings, cells=420):
    """The plan area that a set of (axis, sides) polygons covers together (sampled on a lattice)."""
    corners = np.array([p for axis, sides in rings for p in plan(sides, axis)])
    lo, hi = corners.min(axis=0), corners.max(axis=0)
    x, z = np.meshgrid(np.linspace(lo[0], hi[0], cells), np.linspace(lo[1], hi[1], cells), indexing="ij")
    inside = np.zeros(x.shape, dtype=bool)
    for axis, sides in rings:
        within = np.ones(x.shape, dtype=bool)
        for bearing, reach, _ in sides:
            b = math.radians(bearing)
            within &= math.cos(b) * (x - axis[0]) + math.sin(b) * (z - axis[1]) <= reach
        inside |= within
    return float(inside.mean() * (hi[0] - lo[0]) * (hi[1] - lo[1]))


def bundle(stone, axis, radius, y0, tops, turn=0.0, off=0.45, sizes=None, faces=None, turns=None,
           core=None, beds=(), gains=None, lean=(0.6, 2.0), height=None, jitter=0.3, tilt=(0.2, 0.9),
           tilts=None, breaks="some", spread=0.06):
    """A tier as a bundle of prisms standing round `axis`, fused where they overlap: one prism per
    entry of `tops` (its own height), set `off` of the tier's radius from the axis at even bearings
    from `turn`, `sizes` of the radius across, with `faces` sides each; `core` (size, top, faces)
    is the tier's body, a broader prism on the axis that the others stand against like buttresses.
    Together they cover the area of a circle of `radius`. The grooves where two prisms meet are
    the stone's joints.

    beds    as in `columns`; without `gains` a bed given a flank shows on every prism there, by
            more or less, and one given none shows on about two prisms in three
    tilt    every prism leans as a whole by so many degrees (a range), each its own way, so no
            two arrises are parallel; `tilts` gives them outright: (bearing, degrees) each
    breaks  a prism's top is broken: a slanting scar takes one side of it and leaves the rest
            flat. "some" breaks most of them at random, "none" none; or one entry per prism:
            None or (bearing from the prism's own, slope in degrees, how much of the top is left
            flat: 1 all of it, 0 half)

    Returns the prisms' rings [(axis, sides)] at the height they lean about, for the fallen blocks.
    """
    rng = stone.rng
    count = len(tops)
    tops = list(tops) + ([core[1]] if core else [])
    specs = []
    for i in range(len(tops)):
        middle = i >= count
        a = turn + (i + (rng.random() - 0.5) * jitter) * 360.0 / count
        d = 0.0 if middle else off * (0.88 + 0.24 * rng.random())
        size = core[0] if middle else sizes[i] if sizes else 0.44 + 0.1 * rng.random()
        n = core[2] if middle else faces[i] if faces else 4 + int(rng.random() * 2.0)
        # (A flat face looks outward, more or less: a prism set corner-out shows as a thin fin.)
        own = turns[i] if turns and not middle else (rng.random() - 0.5) * 150.0 / n
        sides = ring(rng, n, size, turn=a + own, wobble=0.4, spread=spread, lean=lean)
        lean_to = tilts[i] if tilts and not middle else (rng.random() * 360.0, tilt[0] + (tilt[1] - tilt[0]) * rng.random())
        # (The scar slopes down and outward: one that sloped along the cliff left a fin standing.)
        scar = (a + (rng.random() - 0.5) * 90.0, 16.0 + 22.0 * rng.random(), 0.25 + 0.55 * rng.random())
        chance = rng.random()
        if middle:
            broken = None
        elif breaks == "some":
            broken = scar if chance < 0.55 else None
        elif breaks == "none":
            broken = None
        else:
            broken = breaks[i] and (a + breaks[i][0], breaks[i][1], breaks[i][2])
        shows = []
        for bed in beds:
            much, chance_of = 0.7 + 0.6 * rng.random(), rng.random()
            shows.append(much if len(bed) > 3 or chance_of < 0.62 else 0.0)
        if gains:
            shows = [1.0] * len(beds) if middle else gains[i]
        specs.append([(d * math.cos(math.radians(a)), d * math.sin(math.radians(a))), sides, size, lean_to, broken, shows])
    scale = radius * math.sqrt(math.pi / union_area([(spec[0], spec[1]) for spec in specs]))
    bottoms = list(y0) + [min(y0)] if isinstance(y0, (list, tuple)) else [y0] * len(tops)
    pivot = height if height is not None else (min(bottoms) + max(tops)) * 0.5
    out = []
    for i, (centre, sides, size, lean_to, broken, shows) in enumerate(specs):
        centre = (axis[0] + centre[0] * scale, axis[1] + centre[1] * scale)
        # The prism's own lean: each face moves with its axis.
        drift = math.tan(math.radians(lean_to[1]))
        drift = (drift * math.cos(math.radians(lean_to[0])), drift * math.sin(math.radians(lean_to[0])))
        leaning = []
        for b, r, t in sides:
            across = math.cos(math.radians(b)) * drift[0] + math.sin(math.radians(b)) * drift[1]
            leaning.append([b, r * scale, math.degrees(math.atan(math.tan(math.radians(t)) - across))])
        trims = []
        if broken:
            b, slope = math.radians(broken[0]), math.radians(broken[1])
            n = np.array([math.cos(b) * math.sin(slope), math.cos(slope), math.sin(b) * math.sin(slope)])
            rise = tops[i] - pivot
            reach = broken[2] * size * scale * 0.9
            p0 = np.array([centre[0] + drift[0] * rise + math.cos(b) * reach, tops[i],
                           centre[1] + drift[1] * rise + math.sin(b) * reach])
            trims.append((None, (n, float(n @ p0), None)))
        columns(stone, centre, leaning, [(0.0, 0.0)], bottoms[i], [tops[i]], pivot, beds=beds,
                gains=[shows], sway=0.0, lean_sway=0.0, trims=trims)
        out.append((centre, leaning))
    return out


def foot_of(rings):
    """How far out a bundle's cliffs stand along a bearing from the origin."""
    return lambda bearing: max(reach_of(sides, axis, bearing) for axis, sides in rings)


def block_planes(centre, half, yaw=0.0, lean=0.0, roll=0.0, chips=(), floor=-BURY):
    """A block: a box of half-sizes (out, up, along) in its own frame, turned by `yaw` about the
    vertical, leaning by `lean` toward its own inner side, rolled by `roll`; `chips` are corners
    knocked off: (sign out, sign up, sign along, depth)."""
    y = math.radians(yaw)
    out = np.array([math.cos(y), 0.0, math.sin(y)])
    up = np.array([0.0, 1.0, 0.0])
    along = np.array([-math.sin(y), 0.0, math.cos(y)])
    tilt = math.radians(lean)
    out, up = math.cos(tilt) * out + math.sin(tilt) * up, math.cos(tilt) * up - math.sin(tilt) * out
    turn = math.radians(roll)
    up, along = math.cos(turn) * up + math.sin(turn) * along, math.cos(turn) * along - math.sin(turn) * up
    centre = np.asarray(centre, dtype=np.float64)
    planes = []
    for axis_vector, size in ((out, half[0]), (up, half[1]), (along, half[2])):
        planes.append((axis_vector, float(axis_vector @ centre) + size, None))
        planes.append((-axis_vector, float(-axis_vector @ centre) + size, None))
    for so, su, sa, depth in chips:
        n = unit(so * out + su * up + sa * along)
        corner = centre + np.sign(so) * half[0] * out + np.sign(su) * half[1] * up + np.sign(sa) * half[2] * along
        planes.append((n, float(n @ corner) - depth, None))
    if floor is not None:
        planes.append(level(floor, False))
    return planes


def scree(stone, foot, radius, clusters, size=1.0):
    """Fallen blocks against the foot: `clusters` of (bearing, how many, spread in degrees).

    `foot(bearing)` is how far out the cliff stands at the ground; `radius` the foot's radius (the
    blocks are sized by it and stay within about 1.3 of it, under TALUS high). They are blocks, as
    deep as they are wide: tipped against the cliff, a corner or two knocked off, part sunk.
    """
    rng = stone.rng
    for bearing0, count, spread in clusters:
        for k in range(count):
            bearing = bearing0 + ((k + 0.5) / count - 0.5) * spread + (rng.random() - 0.5) * spread * 0.35
            big = (1.0 - 0.5 * rng.random()) * size
            along = radius * (0.2 + 0.2 * rng.random()) * big
            out = radius * (0.11 + 0.06 * rng.random()) * big
            up = min(along, out * 1.7) * (0.75 + 0.6 * rng.random())
            lean = 6.0 + 30.0 * rng.random()
            roll = (rng.random() - 0.5) * 34.0
            yaw = bearing + (rng.random() - 0.5) * 50.0
            tilt, turn = math.radians(lean), math.radians(roll)
            # How high its highest corner stands over its centre.
            reach = up * math.cos(tilt) * math.cos(turn) + out * math.sin(tilt) + along * abs(math.sin(turn))
            y = min(reach * (0.25 + 0.45 * rng.random()), TALUS - reach)
            r = foot(bearing) + out * (0.35 + 0.5 * rng.random())
            b = math.radians(bearing)
            chips = []
            for sa in (-1.0, 1.0):
                if rng.random() < 0.7:
                    chips.append((0.5 + rng.random(), 0.6 + 0.8 * rng.random(), sa * (0.5 + rng.random()),
                                  min(out, along, up) * (0.4 + 0.5 * rng.random())))
            stone.add(block_planes((r * math.cos(b), y, r * math.sin(b)), (out, up, along), yaw, lean, roll, chips))


def slab(stone, foot, bearing, out, top, along, lean, yaw=0.0):
    """One slab that has slid off the cliff and leans against it."""
    tilt = math.radians(lean)
    tall = top * 0.5 + BURY
    b = math.radians(bearing)
    r = foot(bearing) + out + tall * math.sin(tilt) * 0.6
    reach = tall * math.cos(tilt) + out * math.sin(tilt)
    stone.add(block_planes((r * math.cos(b), top - reach, r * math.sin(b)), (out, tall, along),
                           bearing + yaw, lean, 0.0, [(0.4, 1.0, 1.0, out * 0.9)]))


# ── The eight designs ─────────────────────────────────────────────────────────

def cleft(stone, axis, bearing, width, bottom, flare=1.1, reach=0.4):
    """A joint widened to a slot of sky straight through the stone: it runs along `bearing` through
    `axis`, `width` across at `bottom` and wider above."""
    half = width * 0.5
    stone.bite([face(axis, bearing + 90.0, half, -flare, bottom), face(axis, bearing - 90.0, half, -flare * 0.8, bottom),
                face(axis, bearing, reach), face(axis, bearing + 180.0, reach), level(bottom, False), level(1.1, True)])


def gone(stone, centre, half, yaw):
    """A block gone from the stone: a square-cut bite."""
    stone.bite(block_planes(centre, half, yaw, floor=None))


def cap_rock(stone, axis, radius, y0, y1, faces=6, turn=0.0, lean=(-6.0, -2.0), wedge=None, scar=None):
    """A cap rock: one hard slab, wider than what carries it, its faces leaning out as they rise.

    wedge   (bearing, degrees): its underside slopes up toward that bearing, so it thins to a lip
    scar    (bearing, slope, how far from the axis): a corner of its top broken away
    """
    sides = ring(stone.rng, faces, radius, turn=turn, wobble=0.5, spread=0.1, lean=lean)
    trims = []
    if wedge:
        b, slope = math.radians(wedge[0]), math.radians(wedge[1])
        n = np.array([math.cos(b) * math.sin(slope), -math.cos(slope), math.sin(b) * math.sin(slope)])
        p0 = np.array([axis[0] - math.cos(b) * radius, y0, axis[1] - math.sin(b) * radius])
        trims.append((None, (n, float(n @ p0), None)))
    if scar:
        b, slope = math.radians(scar[0]), math.radians(scar[1])
        n = np.array([math.cos(b) * math.sin(slope), math.cos(slope), math.sin(b) * math.sin(slope)])
        p0 = np.array([axis[0] + math.cos(b) * scar[2], y1, axis[1] + math.sin(b) * scar[2]])
        trims.append((None, (n, float(n @ p0), None)))
    columns(stone, axis, sides, [(0.0, 0.0)], y0, tops=[y1], height=(y0 + y1) * 0.5, sway=0.0, lean_sway=0.0, trims=trims)
    return sides


def design_0():
    """The Organ (the hero, 300 m, beside the suns). Seen along its own x axis the cleft is sky."""
    s = Stone(0, "tower", 4201)
    plinth = bundle(s, (0.0, 0.0), 0.0945, -BURY, tops=[0.41, 0.36, 0.325, 0.395, 0.34, 0.375],
                    turn=20.0, sizes=[0.5, 0.52, 0.48, 0.52, 0.5, 0.48], core=(0.74, 0.378, 7), lean=(1.0, 2.2),
                    beds=[(0.18, 0.215, -0.006, 200.0, 100.0), (0.215, 0.235, 0.005, 200.0, 100.0)])
    axis = (0.004, 0.012)
    bundle(s, axis, 0.0735, 0.24, tops=[0.955, 0.9, 0.81, 0.845, 0.875, 1.0],
           turn=100.0, sizes=[0.52, 0.5, 0.52, 0.48, 0.52, 0.52], core=(0.74, 0.8, 6), lean=(0.5, 1.5), height=0.69,
           beds=[(0.5, 0.545, -0.005, 60.0, 110.0), (0.545, 0.565, 0.004, 60.0, 110.0), (0.69, 9.0, -0.004, 250.0, 80.0)])
    cleft(s, (0.0, -0.004), 0.0, 0.02, 0.69)
    s.cuts = [0.378, 0.86]
    reach = foot_of(plinth)
    scree(s, reach, 0.0945, [(215.0, 3, 70.0), (40.0, 3, 80.0), (130.0, 1, 0.0), (300.0, 2, 50.0)])
    slab(s, reach, 172.0, 0.006, 0.076, 0.026, 15.0, 8.0)
    return s


def design_1():
    """The Table: a broad block, a second block set off to one side under a hard cap, a corner block gone."""
    s = Stone(1, "butte", 4311)
    low = bundle(s, (0.0, 0.0), 0.33, -BURY, tops=[0.53, 0.48, 0.545, 0.46, 0.5],
                 turn=10.0, sizes=[0.6, 0.56, 0.62, 0.58, 0.6], core=(0.74, 0.516, 7), lean=(1.5, 3.6), tilt=(0.2, 1.0),
                 beds=[(0.2, 0.26, -0.018, 120.0, 100.0), (0.26, 0.29, 0.012, 120.0, 100.0)])
    axis = (0.05, -0.035)
    bundle(s, axis, 0.233, 0.4, tops=[1.0, 1.0, 1.0, 0.985],
           turn=40.0, sizes=[0.6, 0.56, 0.6, 0.58], core=(0.76, 1.0, 6), lean=(1.0, 2.6), tilt=(0.1, 0.7), height=0.75,
           beds=[(0.855, 0.925, -0.014, 60.0, 130.0), (0.925, 1.01, 0.016, 60.0, 130.0)], breaks="none")
    # A corner block gone from the table, and one from the lower rim.
    gone(s, (0.05 + 0.2, 0.93, -0.035 - 0.115), (0.11, 0.15, 0.1), -30.0)
    gone(s, (-0.31, 0.5, 0.06), (0.09, 0.11, 0.065), 168.0)
    s.cuts = [0.516]
    scree(s, foot_of(low), 0.33, [(100.0, 3, 50.0), (200.0, 2, 30.0), (280.0, 4, 70.0), (20.0, 2, 30.0)], 0.75)
    return s


def design_2():
    """The Stair: three tiers set toward one side, sheer on one flank and stepped on the other."""
    s = Stone(2, "tower", 4421)
    low = bundle(s, (0.0, 0.0), 0.112, -BURY, tops=[0.335, 0.375, 0.31, 0.36, 0.32],
                 turn=15.0, sizes=[0.54, 0.5, 0.56, 0.52, 0.54], core=(0.74, 0.347, 6), lean=(0.8, 2.0),
                 beds=[(0.16, 0.2, -0.007, -20.0, 100.0), (0.2, 0.222, 0.006, -20.0, 100.0)])
    # (The upper tiers stand toward bearing 165: the steps look the other way, toward the suns.)
    bundle(s, (-0.019, 0.005), 0.086, 0.24, tops=[0.59, 0.63, 0.565, 0.615, 0.58],
           turn=60.0, sizes=[0.54, 0.5, 0.56, 0.52, 0.54], core=(0.74, 0.602, 6), lean=(0.6, 1.6), height=0.47,
           beds=[(0.455, 0.49, -0.006, 200.0, 90.0)])
    bundle(s, (-0.031, 0.008), 0.0725, 0.5, tops=[1.0, 0.985, 0.955, 0.865, 0.93],
           turn=20.0, sizes=[0.54, 0.5, 0.56, 0.52, 0.54], core=(0.74, 0.975, 6), lean=(0.5, 1.4), height=0.8,
           beds=[(0.7, 0.745, -0.006, -30.0, 110.0), (0.745, 0.765, 0.005, -30.0, 110.0), (0.86, 9.0, -0.004, 150.0, 90.0)])
    gone(s, (0.066, 0.585, -0.016), (0.03, 0.05, 0.034), -15.0)
    s.cuts = [0.347, 0.602]
    scree(s, foot_of(low), 0.112, [(190.0, 3, 70.0), (300.0, 2, 50.0), (70.0, 2, 60.0)])
    return s


def design_3():
    """The Mitten: a long shoulder stepping down away from one thick thumb."""
    s = Stone(3, "mitten", 4531)
    # (The thumb stands at bearing 11: the shoulder's blocks are lower the further round from it.)
    low = bundle(s, (0.0, 0.0), 0.283, -BURY, tops=[0.328, 0.3, 0.245, 0.215, 0.24, 0.318],
                 turn=11.0, sizes=[0.54, 0.52, 0.54, 0.56, 0.52, 0.54], core=(0.74, 0.31, 7), lean=(1.5, 3.4), tilt=(0.2, 1.0),
                 beds=[(0.115, 0.165, -0.014, 150.0, 100.0), (0.165, 0.19, 0.01, 150.0, 100.0)])
    axis = (0.2088, 0.0415)
    thumb = bundle(s, axis, 0.088, -BURY, tops=[1.0, 0.955, 0.87, 0.915],
                   turn=50.0, sizes=[0.6, 0.56, 0.6, 0.56], core=(0.74, 0.93, 6), lean=(0.5, 1.6), height=0.66,
                   beds=[(0.45, 0.49, -0.006, 100.0, 110.0), (0.49, 0.512, 0.005, 100.0, 110.0), (0.62, 9.0, -0.005, 300.0, 90.0),
                         (0.79, 0.825, -0.006, 180.0, 100.0)])
    s.cuts = [0.25, 0.328]
    scree(s, foot_of(low + thumb), 0.283, [(150.0, 3, 50.0), (250.0, 3, 60.0), (60.0, 2, 40.0), (330.0, 2, 30.0)], 0.75)
    return s


def design_4():
    """The Hoodoo: three slim tiers, a waisted neck and a wide cap rock."""
    s = Stone(4, "tower", 4641)
    low = bundle(s, (0.0, 0.0), 0.0805, -BURY, tops=[0.305, 0.35, 0.29, 0.335],
                 turn=30.0, sizes=[0.6, 0.56, 0.6, 0.58], core=(0.74, 0.323, 6), lean=(1.0, 2.4),
                 beds=[(0.16, 0.2, -0.006, 200.0, 100.0)])
    bundle(s, (0.0048, -0.0036), 0.0605, 0.22, tops=[0.59, 0.57, 0.63, 0.56],
           turn=80.0, sizes=[0.6, 0.56, 0.6, 0.58], core=(0.74, 0.601, 6), lean=(0.8, 2.0), height=0.46,
           beds=[(0.42, 0.46, -0.005, 150.0, 110.0), (0.46, 0.48, 0.004, 150.0, 110.0)])
    bundle(s, (0.006, -0.005), 0.045, 0.5, tops=[0.94, 0.94, 0.9, 0.94],
           turn=140.0, off=0.4, sizes=[0.62, 0.58, 0.62, 0.6], lean=(0.8, 1.8), height=0.75, breaks="none",
           beds=[(0.8, 0.94, -0.006)], gains=[[1], [1], [0], [1]])
    # The cap: a small hard bed and a wide slab over it, out over the neck on one side (bearing 110).
    cap_rock(s, (0.01, -0.012), 0.05, 0.915, 0.948, faces=5, turn=10.0, lean=(-3.0, 0.0))
    cap_rock(s, (-0.001, 0.014), 0.07, 0.944, 1.0, faces=6, turn=25.0, lean=(-9.0, -3.0), scar=(290.0, 30.0, 0.03))
    s.cuts = [0.323, 0.601, 0.93]
    scree(s, foot_of(low), 0.0805, [(100.0, 3, 80.0), (250.0, 2, 50.0), (340.0, 2, 40.0)])
    return s


def design_5():
    """The Citadel: a tall massive block, its crown a stair of broken columns, a cleft in its wall."""
    s = Stone(5, "butte", 4751)
    low = bundle(s, (0.0, 0.0), 0.384, -BURY, tops=[0.62, 0.665, 0.585, 0.65, 0.6, 0.66],
                 turn=10.0, sizes=[0.56, 0.6, 0.54, 0.6, 0.56, 0.6], core=(0.76, 0.65, 8),
                 lean=(1.2, 3.0), tilt=(0.2, 0.9),
                 beds=[(0.15, 0.21, -0.018, 20.0, 100.0), (0.21, 0.24, 0.012, 20.0, 100.0), (0.42, 0.48, -0.016, 250.0, 90.0)])
    # (The crown steps down from bearing -125 to bearing 55: its risers look toward the suns.)
    axis = (-0.03, -0.03)
    bundle(s, axis, 0.252, 0.5, tops=[0.79, 0.715, 0.89, 1.0],
           turn=10.0, off=0.42, sizes=[0.72, 0.66, 0.7, 0.66], lean=(1.0, 2.6), tilt=(0.2, 1.0), height=0.82,
           beds=[(0.74, 0.775, -0.012, -60.0, 100.0)])
    cleft(s, (0.3, 0.2), 35.0, 0.03, 0.26, flare=2.0, reach=0.16)
    s.cuts = [0.65, 0.8, 0.9]
    scree(s, foot_of(low), 0.384, [(50.0, 4, 70.0), (160.0, 3, 50.0), (250.0, 2, 30.0), (320.0, 3, 40.0)], 0.7)
    return s


def design_6():
    """The Needle: one slim setback, a block bitten out of its flank, a cap rock set askew."""
    s = Stone(6, "tower", 4861)
    low = bundle(s, (0.0, 0.0), 0.0735, -BURY, tops=[0.345, 0.39, 0.325, 0.375],
                 turn=10.0, sizes=[0.6, 0.56, 0.6, 0.58], core=(0.74, 0.363, 6), lean=(1.0, 2.4),
                 beds=[(0.2, 0.235, -0.006, 100.0, 100.0)])
    axis = (-0.006, 0.008)
    bundle(s, axis, 0.0505, 0.26, tops=[0.9, 0.955, 0.86],
           turn=60.0, sizes=[0.62, 0.58, 0.62], core=(0.78, 0.955, 6), lean=(0.7, 1.6), height=0.66,
           beds=[(0.72, 0.76, -0.005, 220.0, 100.0)])
    # The cap: a slab that has slid half off toward bearing -143, thinning to a lip; the block gone
    # from the flank is on the other side (bearing 37): both show side on from where the eye stands.
    cap_rock(s, (-0.03, -0.01), 0.056, 0.948, 1.0, faces=5, turn=140.0, lean=(-4.0, 0.0), wedge=(-143.0, 16.0))
    gone(s, (-0.006 + 0.052, 0.585, 0.008 + 0.039), (0.044, 0.055, 0.07), 37.0)
    s.cuts = [0.363, 0.945]
    scree(s, foot_of(low), 0.0735, [(60.0, 2, 50.0), (180.0, 3, 70.0), (290.0, 2, 50.0)])
    return s


def design_7():
    """The Fork: a blocky shoulder with a notch, its thumb split into two prongs."""
    s = Stone(7, "mitten", 4971)
    low = bundle(s, (0.0, 0.0), 0.234, -BURY, tops=[0.411, 0.38, 0.35, 0.405, 0.365],
                 turn=-10.0, sizes=[0.58, 0.54, 0.58, 0.56, 0.6], core=(0.74, 0.4, 6), lean=(1.5, 3.2), tilt=(0.2, 1.0),
                 beds=[(0.13, 0.18, -0.012, 250.0, 100.0), (0.18, 0.205, 0.009, 250.0, 100.0)])
    axis = (0.1117, -0.105)
    # Two prongs side by side as the eye sees them (it stands at bearing -58: the cleft runs to it).
    thumb = bundle(s, axis, 0.0755, -BURY, tops=[1.0, 0.885, 0.84, 0.965],
                   turn=-13.0, off=0.42, sizes=[0.62, 0.6, 0.64, 0.6], lean=(0.5, 1.5), height=0.7,
                   beds=[(0.5, 0.54, -0.005, 0.0, 110.0), (0.54, 0.56, 0.004, 0.0, 110.0), (0.76, 0.79, -0.005, 200.0, 100.0)])
    cleft(s, axis, -58.0, 0.02, 0.62)
    gone(s, (-0.2, 0.42, 0.02), (0.07, 0.075, 0.06), 175.0)
    s.cuts = [0.411, 0.86]
    scree(s, foot_of(low + thumb), 0.234, [(120.0, 3, 60.0), (220.0, 2, 40.0), (20.0, 3, 50.0)], 0.8)
    return s


DESIGNS = (design_0, design_1, design_2, design_3, design_4, design_5, design_6, design_7)


# ── Fusing (Blender) ──────────────────────────────────────────────────────────

def _solid_object(collection, name, solid):
    vertices, faces = solid
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices.tolist(), [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def _drop(objects, collections=()):
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    for collection in collections:
        bpy.data.collections.remove(collection)


def fuse(scene, stone):
    """Every solid of the stone as one skin, the bites cut out of it: vertices and polygons."""
    name = f"stone{stone.variant}"
    made = []
    groups = []
    base = _solid_object(scene.collection, f"{name}.base", stone.solids[0])
    made.append(base)
    for label, solids, operation in (("add", stone.solids[1:], "UNION"), ("cut", stone.bites, "DIFFERENCE")):
        if not solids:
            continue
        group = bpy.data.collections.new(f"{name}.{label}")
        scene.collection.children.link(group)
        groups.append(group)
        made += [_solid_object(group, f"{name}.{label}.{i}", solid) for i, solid in enumerate(solids)]
        mod = base.modifiers.new(label, "BOOLEAN")
        mod.operand_type = "COLLECTION"
        mod.collection = group
        mod.operation = operation
        mod.solver = BOOLEAN_SOLVER
    layer = scene.view_layers[0]
    layer.update()
    mesh = bpy.data.meshes.new_from_object(base.evaluated_get(layer.depsgraph))
    vertices = np.array([v.co[:] for v in mesh.vertices], dtype=np.float64)
    polygons = [list(p.vertices) for p in mesh.polygons]
    bpy.data.meshes.remove(mesh)
    _drop(made, groups)
    return vertices, polygons


def canonical(vertices, polygons):
    """The same skin with its vertices and faces in an order that depends on nothing but itself."""
    order = np.lexsort((vertices[:, 2], vertices[:, 0], vertices[:, 1]))
    lookup = np.empty(len(vertices), dtype=np.int64)
    lookup[order] = np.arange(len(vertices))
    loops = []
    for polygon in polygons:
        loop = [int(lookup[i]) for i in polygon]
        k = loop.index(min(loop))
        loops.append(tuple(loop[k:] + loop[:k]))
    return vertices[order], sorted(loops)


def tidy(vertices, polygons):
    """Weld, and merge every plane's faces into one: the skin as flat faces (vertices, a loop per
    face, the plane each lies in, the planes' normals), cut along the ground so that it has
    vertices where the stone meets it, the floor of the buried part left out; and how many of its
    edges were not shared by exactly two faces (none, in a closed skin)."""
    bm = bmesh.new()
    made = [bm.verts.new(v) for v in vertices]
    for loop in polygons:
        try:
            bm.faces.new([made[i] for i in loop])
        except ValueError:
            pass
    # (Two quanta: what the module could not tell apart anyway. Wider, the weld tore a face open
    # and bent the small ones.)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=QUANT * WELD)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=QUANT)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.25), verts=bm.verts[:], edges=bm.edges[:],
                             use_dissolve_boundaries=False)
    # (A sliver welded shut is two faces back to back: neither is surface.)
    seen = {}
    for f in bm.faces:
        seen.setdefault(frozenset(v.index for v in f.verts), []).append(f)
    flaps = [f for group in seen.values() if len(group) > 1 for f in group]
    if flaps:
        bmesh.ops.delete(bm, geom=flaps, context="FACES")
    bm.normal_update()
    leaks = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    tag = bm.faces.layers.int.new("plane")
    normals = []
    for f in bm.faces:
        f[tag] = len(normals)
        normals.append(tuple(f.normal))
    floor = [f for f in bm.faces if all(v.co.y < -BURY + 1e-5 for v in f.verts)]
    bmesh.ops.delete(bm, geom=floor, context="FACES")
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=QUANT,
                           plane_co=(0.0, 0.0, 0.0), plane_no=(0.0, 1.0, 0.0))
    bm.verts.index_update()
    out_v = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    out_v[np.abs(out_v[:, 1]) < QUANT * 0.5, 1] = 0.0
    loops = [[v.index for v in f.verts] for f in bm.faces]
    planes = [f[tag] for f in bm.faces]
    bm.free()
    return out_v, loops, planes, np.array(normals, dtype=np.float64), leaks


def signed_volume(vertices, triangles):
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def open_edges(triangles):
    """Edges that do not run exactly once each way (the buried floor's rim aside, there are none)."""
    seen = {}
    for a, b, c in triangles:
        for e in ((a, b), (b, c), (c, a)):
            seen[e] = seen.get(e, 0) + 1
    return sum(1 for (a, b), n in seen.items() if n != 1 or seen.get((b, a), 0) != 1)


# ── Levels: the faces as triangles, to a budget ───────────────────────────────

def _within(outline, points):
    """Which of `points` lie inside the polygon `outline` (plan coordinates)."""
    x, y = points[:, 0][:, None], points[:, 1][:, None]
    x0, y0 = outline[:, 0][None, :], outline[:, 1][None, :]
    x1, y1 = np.roll(outline[:, 0], -1)[None, :], np.roll(outline[:, 1], -1)[None, :]
    rise = np.where(y1 == y0, 1e-300, y1 - y0)
    crossing = ((y0 > y) != (y1 > y)) & (x < (x1 - x0) * (y - y0) / rise + x0)
    return crossing.sum(axis=1) % 2 == 1


def _clearance(outline, points, which=None):
    """How far each of `points` is from the polygon's edges (those in `which`, or all)."""
    a, b = outline, np.roll(outline, -1, axis=0)
    if which is not None:
        a, b = a[which], b[which]
    if not len(a) or not len(points):
        return np.full(len(points), 1e9)
    ab = b - a
    t = ((points[:, None, :] - a[None]) * ab[None]).sum(axis=2) / np.maximum((ab * ab).sum(axis=1), 1e-30)[None]
    nearest = a[None] + np.clip(t, 0.0, 1.0)[:, :, None] * ab[None]
    return np.linalg.norm(points[:, None, :] - nearest, axis=2).min(axis=1)


def _inner_points(outline, hard, grid, ring):
    """The points strewn inside a face (plan coordinates): a row `ring` inside every arris (`hard`
    says which edges are), then a lattice `grid` apart."""
    hard = np.array(hard, dtype=bool)
    rows = []
    if ring:
        count = len(outline)
        for i in range(count):
            before, after = hard[i - 1], hard[i]
            if not (before or after):
                continue
            p = outline[i]
            d1 = p - outline[i - 1]
            d2 = outline[(i + 1) % count] - p
            l1, l2 = np.linalg.norm(d1), np.linalg.norm(d2)
            if l1 < 1e-9 or l2 < 1e-9:
                continue
            d1, d2 = d1 / l1, d2 / l2
            n1, n2 = np.array([-d1[1], d1[0]]), np.array([-d2[1], d2[0]])
            turn = d1[0] * d2[1] - d1[1] * d2[0]
            if not before:
                step = n2
            elif not after:
                step = n1
            elif turn > 0.05:
                # A corner of the face: the point as far from both edges.
                step = (n1 + n2) / (1.0 + float(n1 @ n2))
                if np.linalg.norm(step) > 3.0:
                    continue
            else:
                both = n1 + n2
                if np.linalg.norm(both) < 1e-6:
                    continue
                step = both / np.linalg.norm(both)
            rows.append(p + ring * step)
    kept = []
    if rows:
        rows = np.array(rows)
        fine = _within(outline, rows) & (_clearance(outline, rows, hard) > ring * 0.82)
        fine &= _clearance(outline, rows, ~hard) > ring * 0.4
        for q in rows[fine]:
            if all((q[0] - k[0]) ** 2 + (q[1] - k[1]) ** 2 > (ring * 0.6) ** 2 for k in kept):
                kept.append(q)
    lo, hi = outline.min(axis=0), outline.max(axis=0)
    if grid < max(hi - lo) * 2.0:
        step = grid * 0.8660254
        j0, j1 = math.floor(lo[1] / step), math.ceil(hi[1] / step)
        i0, i1 = math.floor(lo[0] / grid) - 1, math.ceil(hi[0] / grid) + 1
        jj, ii = np.meshgrid(np.arange(j0, j1 + 1), np.arange(i0, i1 + 1), indexing="ij")
        lattice = np.stack([((ii + 0.5 * (jj % 2)) * grid).ravel(), (jj * step).ravel()], axis=1)
        if len(lattice):
            fine = _within(outline, lattice) & (_clearance(outline, lattice) > max(grid * 0.5, (ring or 0.0) * 1.7))
            kept += list(lattice[fine])
    return np.array(kept).reshape(-1, 2)


def tessellate(vertices, loops, planes, normals, span, grid, ring):
    """Every face of the skin as triangles: (vertices, triangles, the plane of each).

    span    the faces' edges are cut into pieces no longer than this
    grid    points are strewn inside each face on a lattice this far apart
    ring    and a row of points stands this far inside every arris (None: no row), so that what
            the bake finds along an arris fades over that width, whatever the triangles
    """
    points = [tuple(v) for v in vertices]
    faces_of = {}
    for f, loop in enumerate(loops):
        for a, b in zip(loop, loop[1:] + loop[:1]):
            faces_of.setdefault((a, b) if a < b else (b, a), []).append(f)
    cuts, arris = {}, {}
    for key in sorted(faces_of):
        pa, pb = np.array(points[key[0]]), np.array(points[key[1]])
        pieces = max(1, math.ceil(float(np.linalg.norm(pb - pa)) / span - 1e-9))
        cuts[key] = list(range(len(points), len(points) + pieces - 1))
        points += [tuple(pa + (pb - pa) * (k / pieces)) for k in range(1, pieces)]
        owners = faces_of[key]
        # (The cut along the ground parts two faces of one plane: an edge, not an arris.)
        arris[key] = len(owners) != 2 or float(normals[planes[owners[0]]] @ normals[planes[owners[1]]]) < 0.9998
    triangles, owner = [], []
    for f, loop in enumerate(loops):
        n = unit(normals[planes[f]])
        u, v = frame(n)
        rim, hard = [], []
        for a, b in zip(loop, loop[1:] + loop[:1]):
            key = (a, b) if a < b else (b, a)
            between = cuts[key] if a < b else cuts[key][::-1]
            rim += [a] + between
            hard += [arris[key]] * (len(between) + 1)
        space = np.array([points[i] for i in rim])
        origin = space[0]
        outline = np.stack([(space - origin) @ u, (space - origin) @ v], axis=1)
        inner = _inner_points(outline, hard, grid, ring)
        first = len(points)
        points += [tuple(origin + u * q[0] + v * q[1]) for q in inner]
        flat = [Vector(q) for q in outline] + [Vector(q) for q in inner]
        made = delaunay_2d_cdt(flat, [], [list(range(len(rim)))], 1, 1e-9)
        ids = []
        for k, co in enumerate(made[0]):
            source = made[3][k]
            if source:
                ids.append(rim[source[0]] if source[0] < len(rim) else first + source[0] - len(rim))
            else:
                ids.append(len(points))
                points.append(tuple(origin + u * co[0] + v * co[1]))
        covered = 0.0
        found = []
        for tri in made[2]:
            if len(tri) != 3:
                continue
            a, b, c = (made[0][i] for i in tri)
            area = 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
            if abs(area) < 1e-14:
                continue
            covered += abs(area)
            found.append([ids[i] for i in (tri if area > 0 else tri[::-1])])
        whole = 0.5 * abs(float((outline[:, 0] * np.roll(outline[:, 1], -1) - np.roll(outline[:, 0], -1) * outline[:, 1]).sum()))
        if abs(covered - whole) > 1e-9 + 1e-4 * whole:
            # (Never seen; a face it cannot do is cut ear by ear instead.)
            found = [[rim[i] for i in tri] for tri in tessellate_polygon([[Vector(q) for q in space]])]
            found = [tri if float(np.cross(np.array(points[tri[1]]) - points[tri[0]], np.array(points[tri[2]]) - points[tri[0]]) @ n) > 0
                     else tri[::-1] for tri in found]
        triangles += found
        owner += [planes[f]] * len(found)
    return np.array(points), np.array(triangles, dtype=np.int64), np.array(owner, dtype=np.int64)


def to_budget(skin, budget, ring):
    """The finest triangles of the skin within `budget`: (vertices, triangles, planes, span, whether
    the arrises have their row of points)."""
    for row in ((RING, None) if ring else (None,)):
        coarse = tessellate(*skin, 9.0, 9.0, row)
        if len(coarse[1]) > budget:
            continue
        best, lo, hi = (coarse, 9.0), 0.012, 1.5
        for _ in range(11):
            mid = math.sqrt(lo * hi)
            made = tessellate(*skin, mid, mid * GRID, row)
            if len(made[1]) <= budget:
                best, hi = (made, mid), mid
            else:
                lo = mid
        return best[0] + (best[1], row is not None)
    raise RuntimeError(f"the solid alone has more triangles than the budget of {budget}")


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


class Bake:
    """The solid as the bake sees it: a ray caster (with the ground) and points strewn over it."""

    def __init__(self, vertices, triangles):
        ground = np.array([[-30.0, 0.0, -30.0], [30.0, 0.0, -30.0], [30.0, 0.0, 30.0], [-30.0, 0.0, 30.0]])
        n = len(vertices)
        self.bvh = BVHTree.FromPolygons(np.concatenate([vertices, ground]).tolist(),
                                        triangles.tolist() + [[n, n + 2, n + 1], [n, n + 3, n + 2]])
        self.dirs = hemisphere(AO_RAYS)
        self.cache = {}
        # Points strewn evenly over the surface (a fixed lattice folded into each triangle).
        a, b, c = (vertices[triangles[:, i]] for i in range(3))
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
        each = np.maximum(1, np.rint(area / (CREST_RADIUS * 0.22) ** 2).astype(np.int64))
        which = np.repeat(np.arange(len(triangles)), each)
        k = np.arange(len(which)) - np.repeat(np.cumsum(each) - each, each)
        u = ((k + 0.5) * 0.7548776662466927) % 1.0
        w = ((k + 0.5) * 0.5698402909980532) % 1.0
        fold = u + w > 1.0
        u[fold], w[fold] = 1.0 - u[fold], 1.0 - w[fold]
        self.points = a[which] + (b - a)[which] * u[:, None] + (c - a)[which] * w[:, None]
        self.weights = (area / each)[which]
        self.tree = KDTree(len(self.points))
        for i, p in enumerate(self.points):
            self.tree.insert(p, i)
        self.tree.balance()

    def ao(self, p, n):
        key = (round(p[0], 6), round(p[1], 6), round(p[2], 6), round(n[0], 3), round(n[1], 3), round(n[2], 3))
        if key in self.cache:
            return self.cache[key]
        t, b = frame(n)
        start = np.array(p) + n * 0.0015
        start[1] = max(start[1], 0.0012)
        start = Vector(start)
        dark = 0.0
        for dx, dy, dz in self.dirs:
            hit = self.bvh.ray_cast(start, Vector(t * dx + b * dy + n * dz), AO_REACH)
            if hit[0] is not None:
                dark += (1.0 - hit[3] / AO_REACH) ** 2
        value = min(1.0, max(0.06, 1.0 - AO_GAIN * dark / AO_RAYS))
        self.cache[key] = value
        return value

    def crest(self, p, n):
        found = self.tree.find_range(p, CREST_RADIUS)
        if len(found) < 3:
            return 0.5
        index = np.array([i for _, i, _ in found])
        w = self.weights[index]
        mean = (self.points[index] * w[:, None]).sum(axis=0) / w.sum()
        proud = float((np.array(p) - mean) @ n) / CREST_RADIUS
        return min(1.0, max(0.0, 0.5 + 0.5 * proud / CREST_ARRIS * 1.12))


def shade(bake, vertices, triangles, planes, plane_normals):
    """Split the vertices where planes meet and bake each: the model the module holds."""
    limit = math.cos(math.radians(SMOOTH))
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    corners = [[] for _ in vertices]
    for f, tri in enumerate(triangles):
        for k in range(3):
            corners[tri[k]].append((f, k))
    out_v, out_n, out_ao, out_crest = [], [], [], []
    out_t = triangles.copy()
    for v, uses in enumerate(corners):
        if not uses:
            continue
        # The planes that meet here, the biggest first; planes almost alike share a normal.
        weight = {}
        for f, _ in uses:
            weight[planes[f]] = weight.get(planes[f], 0.0) + area[f]
        groups = []
        for plane in sorted(weight, key=lambda q: (-weight[q], q)):
            n = plane_normals[plane]
            for group in groups:
                if float(n @ group["n"]) > limit:
                    group["planes"].add(plane)
                    group["sum"] = group["sum"] + n * weight[plane]
                    break
            else:
                groups.append({"n": n, "planes": {plane}, "sum": n * weight[plane]})
        whole = sum(unit(group["sum"]) for group in groups)
        whole = unit(whole) if np.linalg.norm(whole) > 1e-6 else unit(groups[0]["sum"])
        crest = bake.crest(vertices[v], whole)
        for group in groups:
            n = unit(group["sum"])
            index = len(out_v)
            out_v.append(vertices[v])
            out_n.append(n)
            out_ao.append(bake.ao(vertices[v], n))
            out_crest.append(crest)
            for f, k in uses:
                if planes[f] in group["planes"]:
                    out_t[f, k] = index
    return {
        "vertices": np.array(out_v),
        "normals": np.array(out_n),
        "ao": np.array(out_ao),
        "crest": np.array(out_crest),
        "triangles": out_t,
    }


def quantised(model):
    """The model as the module holds it (and as the game reads it back)."""
    q = np.rint(model["vertices"] / QUANT).astype(np.int64)
    tris = model["triangles"]
    a, b, c = (q[tris[:, i]] for i in range(3))
    across = np.cross(b - a, c - a)
    alive = np.abs(across).sum(axis=1) > 0
    # (Two solids can leave a sliver under a quantum wide between them; rounding may turn such a
    # triangle inside out, and a face looking inward is a hole. Wind it the way its plane looks.)
    inward = (across * model["normals"][tris[:, 0]]).sum(axis=1) < 0
    tris = tris.copy()
    tris[inward] = tris[inward][:, [0, 2, 1]]
    out = dict(model)
    out["positions"] = q
    out["turned"] = int((inward & alive).sum())
    out["triangles"] = tris[alive]
    out["vertices"] = q * QUANT
    return out


# ── Proxies: the cylinders that cast the shadows ──────────────────────────────

def section(vertices, triangles, y):
    """The cross-section at height y: its directed segments (the solid on their left seen from above)."""
    s = vertices[:, 1][triangles] - y
    above = s > 0
    count = above.sum(axis=1)
    crossing = (count == 1) | (count == 2)
    tris = triangles[crossing]
    s = s[crossing]
    above = above[crossing]
    # The lone vertex (the one on its own side of the plane) first.
    lone = np.where(above.sum(axis=1) == 1, np.argmax(above, axis=1), np.argmin(above, axis=1))
    i0 = tris[np.arange(len(tris)), lone]
    i1 = tris[np.arange(len(tris)), (lone + 1) % 3]
    i2 = tris[np.arange(len(tris)), (lone + 2) % 3]
    s0 = s[np.arange(len(tris)), lone]
    s1 = s[np.arange(len(tris)), (lone + 1) % 3]
    s2 = s[np.arange(len(tris)), (lone + 2) % 3]
    p = vertices[i0] + (vertices[i1] - vertices[i0]) * (s0 / (s0 - s1))[:, None]
    q = vertices[i0] + (vertices[i2] - vertices[i0]) * (s0 / (s0 - s2))[:, None]
    normal = np.cross(vertices[i1] - vertices[i0], vertices[i2] - vertices[i0])
    # Run each segment with the outside on its right: direction = up x normal.
    along = np.stack([normal[:, 2], -normal[:, 0]], axis=1)
    a = p[:, [0, 2]]
    b = q[:, [0, 2]]
    flip = ((b - a) * along).sum(axis=1) < 0
    a[flip], b[flip] = b[flip].copy(), a[flip].copy()
    return a, b


def section_measure(a, b):
    """Area and centroid (x, z) of a section."""
    cross = a[:, 0] * b[:, 1] - b[:, 0] * a[:, 1]
    area = 0.5 * cross.sum()
    if abs(area) < 1e-12:
        return 0.0, (0.0, 0.0)
    centre = ((a + b) * cross[:, None]).sum(axis=0) / (6.0 * area)
    return abs(float(area)), (float(centre[0]), float(centre[1]))


def section_reach(a, b, axis, bearings):
    """How far the section stands from `axis` along each bearing (its outermost edge)."""
    d = np.stack([np.cos(bearings), np.sin(bearings)], axis=1)
    pa = a - np.asarray(axis)
    e = b - a
    den = d[:, None, 0] * e[None, :, 1] - d[:, None, 1] * e[None, :, 0]
    den = np.where(np.abs(den) < 1e-12, 1e-12, den)
    t = (pa[None, :, 0] * e[None, :, 1] - pa[None, :, 1] * e[None, :, 0]) / den
    u = (pa[None, :, 0] * d[:, None, 1] - pa[None, :, 1] * d[:, None, 0]) / den
    hit = (t > 0) & (u >= 0) & (u <= 1)
    return np.where(hit, t, 0.0).max(axis=1)


def heights(t0, t1, count):
    return [t0 + (t1 - t0) * (k + 0.37) / count + 1.7e-5 for k in range(count)]


def proxies_of(model, cuts):
    """Per tier: { t0, t1, r, x, z } measured from the mesh, and how the mesh strays from it."""
    vertices, triangles = model["vertices"], model["triangles"]
    marks = [-BURY] + list(cuts) + [1.0]
    bearings = np.arange(72) * math.tau / 72.0
    proxies, strays = [], []
    for k, (t0, t1) in enumerate(zip(marks, marks[1:])):
        # (The fallen blocks are broad but low: the bottom tier is the cliff above them.)
        lo = max(t0, TALUS + 0.012) if k == 0 else t0
        slices = [section(vertices, triangles, y) for y in heights(lo, t1, 28)]
        measures = [section_measure(a, b) for a, b in slices]
        areas = np.array([m[0] for m in measures])
        typical = float(np.median(areas))
        weight = areas / areas.sum()
        x = float(sum(m[1][0] * w for m, w in zip(measures, weight)))
        z = float(sum(m[1][1] * w for m, w in zip(measures, weight)))
        r = math.sqrt(typical / math.pi) * 0.96
        proxy = {"t0": round(t0, 4), "t1": round(t1, 4), "r": round(r, 4), "x": round(x, 4), "z": round(z, 4)}
        reach = np.array([section_reach(a, b, (proxy["x"], proxy["z"]), bearings) for a, b in slices]) / proxy["r"] - 1.0
        strays.append({
            "out_max": round(float(reach.max()), 3),
            "out_p95": round(float(np.percentile(reach, 95)), 3),
            "in_p05": round(float(np.percentile(reach, 5)), 3),
            "in_min": round(float(reach.min()), 3),
            "area_min": round(float(areas.min() / typical), 3),
            "area_max": round(float(areas.max() / typical), 3),
        })
        proxies.append(proxy)
    # The foot: how high the fallen blocks stand past the cliff, and how far out.
    low = vertices[vertices[:, 1] < TALUS + 0.012]
    a, b = section(vertices, triangles, 0.002)
    foot = {
        "reach": round(float(np.hypot(low[:, 0] - proxies[0]["x"], low[:, 2] - proxies[0]["z"]).max() / (proxies[0]["r"] / 0.96)), 3),
        "ground_reach": round(float(section_reach(a, b, (proxies[0]["x"], proxies[0]["z"]), bearings).max() / (proxies[0]["r"] / 0.96)), 3),
    }
    return proxies, strays, foot


def profile(model, step=0.02):
    """The section's equal-area radius up the stone (to see where the setbacks are)."""
    out = []
    y = -BURY + 0.011
    while y < 1.0:
        area, centre = section_measure(*section(model["vertices"], model["triangles"], y + 1.3e-5))
        out.append((round(y, 3), round(math.sqrt(area / math.pi), 4), round(centre[0], 3), round(centre[1], 3)))
        y += step
    return out


# ── Build ─────────────────────────────────────────────────────────────────────

def build(scene, variants):
    built = {}
    report = {}
    for v in variants:
        stone = DESIGNS[v]()
        skin = tidy(*canonical(*fuse(scene, stone)))
        leaks, skin = skin[4], skin[:4]
        vertices, triangles, _ = tessellate(*skin, 9.0, 9.0, None)
        if signed_volume(vertices, triangles) < 0:
            raise RuntimeError(f"variant {v}: the fused solid is inside out")
        bake = Bake(vertices, triangles)
        entry = {"variant": v, "kind": stone.kind}
        info = {"solids": len(stone.solids), "bites": len(stone.bites), "planes": len(skin[3]),
                "solid_triangles": len(triangles), "open_edges": leaks}
        for name in ("hi", "lo"):
            lv, lt, lp, span, row = to_budget(skin, BUDGET[name][v], name == "hi")
            model = quantised(shade(bake, lv, lt, lp, skin[3]))
            entry[name] = model
            info[name] = {"vertices": len(model["vertices"]), "triangles": len(model["triangles"]),
                          "span": round(span, 4), "row": row, "turned": model["turned"],
                          "ao": [round(float(model["ao"].min()), 2), round(float(np.median(model["ao"])), 2)],
                          "y": [round(float(model["vertices"][:, 1].min()), 4), round(float(model["vertices"][:, 1].max()), 4)]}
        entry["proxies"], info["strays"], info["foot"] = proxies_of(entry["hi"], stone.cuts)
        info["proxies"] = entry["proxies"]
        info["profile"] = profile(entry["hi"])
        built[v] = entry
        report[v] = info
        print(TAG, v, stone.kind, json.dumps({k: info[k] for k in ("solids", "bites", "planes", "solid_triangles", "open_edges", "hi", "lo")}))
        print(TAG, v, "proxies", json.dumps(entry["proxies"]))
        print(TAG, v, "strays", json.dumps(info["strays"]), json.dumps(info["foot"]))
    return built, report


# ── The module the theme imports ──────────────────────────────────────────────

def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def level_lines(model, indent):
    positions = [int(c) for v in model["positions"] for c in v]
    normals = [int(round(max(-1.0, min(1.0, c)) * 127)) for n in model["normals"] for c in n]
    shades = []
    for ao, crest in zip(model["ao"], model["crest"]):
        shades.extend((int(round(max(0.0, min(1.0, ao)) * 255)), int(round(max(0.0, min(1.0, crest)) * 255))))
    index = [int(i) for t in model["triangles"] for i in t]
    return [
        f"{indent}vertexCount: {len(model['positions'])},",
        f"{indent}triangleCount: {len(model['triangles'])},",
        f"{indent}positions: '{b64('h', positions)}',",
        f"{indent}normals: '{b64('b', normals)}',",
        f"{indent}shade: '{b64('B', shades)}',",
        f"{indent}index: '{b64('H', index)}',",
    ]


def write_module(path, built):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Sunbraid's standing stones: GENERATED by scripts/blender/sunbraid_monoliths.py (do not edit by",
        " * hand).",
        " *",
        " * Eight monoliths built by script in Blender (convex solids fused by booleans, so that every",
        " * face is a plane), each at two levels, `hi` and `lo`, of the same solid. Space: +y up, the foot",
        " * at y = 0, the top at y = 1, the solid going on down to y = -0.05; x and z in the same unit.",
        " * `positions` are Int16 xyz in units of `quant`; `normals` Int8 xyz (x127, the plane's own:",
        " * vertices are split where planes meet); `shade` Uint8 pairs (ambient occlusion with the ground,",
        " * 255 = open; crest: 0 in a crevice or joint, 128 on a flat face, 255 on an exposed arris or",
        " * crown); `index` Uint16 triangles, wound counter-clockwise seen from outside. `proxies` are the",
        " * flat-topped vertical cylinders { t0, t1, r, x, z } that cast the stone's shadow, measured from",
        " * the `hi` mesh.",
        " */",
        "export const SUNBRAID_MONOLITH_MODELS = Object.freeze({",
        f"    quant: {QUANT!r},",
        "    variants: [",
    ]
    for v in sorted(built):
        entry = built[v]
        proxies = ", ".join("{ " + ", ".join(f"{k}: {p[k]!r}" for k in ("t0", "t1", "r", "x", "z")) + " }" for p in entry["proxies"])
        lines += [
            "        {",
            f"            variant: {v},",
            f"            kind: '{entry['kind']}',",
            f"            proxies: [{proxies}],",
        ]
        for name in ("hi", "lo"):
            lines.append(f"            {name}: {{")
            lines += level_lines(entry[name], "                ")
            lines.append("            },")
        lines.append("        },")
    lines += ["    ],", "});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# ── Previews ──────────────────────────────────────────────────────────────────

#: sunbraid-plan.js SPIRE_LAYOUT when this was written (variant, bearing, distance, height, turn):
#: only to aim the previews the way the game sees each stone.
LAYOUT = (
    (1, -33, 1100, 170, 0.4), (0, -24, 900, 300, 1.9), (4, -40, 1500, 260, 3.1), (3, -17, 1750, 230, 0.8),
    (5, -29, 3800, 220, 4.4), (5, 31, 1300, 190, 3.7), (2, 23.5, 1050, 300, 2.2), (6, 37, 2000, 260, 0.3),
    (7, 46, 2600, 240, 2.9), (1, 20, 4200, 210, 4.8), (3, -6, 5200, 260, 0.9), (6, 6, 3600, 260, 3.4),
    (2, 58, 1200, 280, 1.1), (4, -58, 1300, 270, 2.4),
)
SUNS_BEARING = -27.0
SUNS = (
    # colour, power, bearing off the group's centre, elevation (degrees)
    ((1.0, 0.27, 0.13), 1.12, 2.4, 7.6),
    ((0.16, 1.0, 0.4), 0.84, 0.0, 11.76),
    ((0.2, 0.36, 1.0), 1.04, -2.4, 7.6),
)


def eye_bearings(variant):
    """From which bearings (degrees, in the stone's own frame) the layout's towers of this shape are
    seen, the one nearest the suns first: [(bearing of the eye, bearing off the suns), ...]."""
    out = []
    for v, bearing, _, _, turn in LAYOUT:
        if v != variant:
            continue
        az = math.radians(bearing)
        wx, wz = -math.sin(az), math.cos(az)
        c, s = math.cos(turn), math.sin(turn)
        out.append((math.degrees(math.atan2(wx * s + wz * c, wx * c - wz * s)), bearing - SUNS_BEARING))
    return sorted(out, key=lambda item: abs(item[1]))


def _to_blender(points):
    """Game space (+y up) to Blender's (+z up): the same handedness."""
    p = np.asarray(points, dtype=np.float64)
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


def _object(collection, name, model, colour=None, material=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(_to_blender(model["vertices"]).tolist(), [], model["triangles"].tolist())
    mesh.update()
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    normals = _to_blender(np.rint(model["normals"] * 127.0) / 127.0)
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    mesh.normals_split_custom_set_from_vertices(normals.tolist())
    attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    rgba = np.ones((len(model["vertices"]), 4))
    if colour is not None:
        rgba[:, :3] = colour[:, None] if colour.ndim == 1 else colour
    attr.data.foreach_set("color", rgba.ravel())
    mesh.color_attributes.active_color = attr
    if material is not None:
        mesh.materials.append(material)
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


def _sheet(rows, gap=6, background=(0.5, 0.5, 0.5, 1.0)):
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


def _material(name, colour, baked):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 1.0
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.0
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    if baked:
        # The theme's cavity: the baked occlusion in the stone's colour (grey = ao).
        attr = nodes.new("ShaderNodeAttribute")
        attr.attribute_name = "Col"
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        # (A Mix node has one set of sockets per data type: 0 the factor, 6 and 7 the colours.)
        mix.inputs[0].default_value = 1.0
        mix.inputs[6].default_value = (*colour, 1.0)
        links.new(attr.outputs["Color"], mix.inputs[7])
        links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return mat


def previews(scene, built, out_dir, shots):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    col = bpy.data.collections.new("SunbraidMonolithsPreview")
    scene.collection.children.link(col)
    world = bpy.data.worlds.new("SunbraidMonolithsWorld")
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
    cam_data = bpy.data.cameras.new("SunbraidMonolithsCam")
    cam = bpy.data.objects.new("SunbraidMonolithsCam", cam_data)
    col.objects.link(cam)
    scene.camera = cam
    cam.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    files = []
    variants = sorted(built)

    def render(path, width, height):
        scene.render.resolution_x = int(width)
        scene.render.resolution_y = int(height)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)

    def clear(objects):
        for obj in objects:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)

    def workbench(colour_type, background):
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "FLAT"
        scene.display.shading.show_object_outline = False
        scene.display.shading.color_type = colour_type
        scene.display.shading.single_color = (0.0, 0.0, 0.0)
        scene.display.render_aa = "16"
        world.color = background

    def ortho_row(name, items, px, cell=1.0, top=1.08, bottom=0.0):
        """`items`: (model, colour or None, bearing of the eye) side by side, seen level."""
        made = []
        for i, (model, colour, bearing) in enumerate(items):
            obj = _object(col, f"pv.{name}.{i}", model, colour)
            obj.rotation_euler = (0.0, 0.0, math.radians(bearing - 90.0))
            obj.location = ((i - (len(items) - 1) / 2.0) * cell, 0.0, 0.0)
            made.append(obj)
        cam_data.type = "ORTHO"
        cam_data.sensor_fit = "AUTO"
        cam_data.shift_x = 0.0
        cam_data.shift_y = 0.0
        width, height = len(items) * cell, top - bottom
        cam_data.ortho_scale = max(width, height)
        cam_data.clip_end = 100.0
        cam.location = (0.0, -30.0, (top + bottom) / 2.0)
        path = out / f"{name}.png"
        render(path, round(width * px), round(height * px))
        clear(made)
        return path

    black = lambda model: None
    sky = (0.93, 0.9, 0.96)

    if "sil" in shots:
        # (a) As the game's first tower of each shape is seen, black on the sky, 300 px and 60 px tall.
        workbench("SINGLE", sky)
        rows = []
        for px in (300, 60):
            for level_name in ("hi", "lo"):
                items = [(built[v][level_name], None, eye_bearings(v)[0][0]) for v in variants]
                rows.append(_read(ortho_row(f"sil-{level_name}-{px}", items, px)))
        small = [np.repeat(np.repeat(r, 4, axis=0), 4, axis=1) for r in rows[2:]]
        _write(out / "silhouettes.png", _sheet([[rows[0]], [rows[1]], [rows[2]], [rows[3]], [small[0]], [small[1]]]))
        files.append(str(out / "silhouettes.png"))

    if "turn" in shots:
        # Each shape from eight bearings (every 45 degrees from the game's): no weak side.
        workbench("SINGLE", sky)
        rows = []
        for v in variants:
            first = eye_bearings(v)[0][0]
            items = [(built[v]["hi"], None, first + k * 45.0) for k in range(8)]
            slim = built[v]["kind"] == "tower"
            rows.append([_read(ortho_row(f"turn-{v}", items, 400 if slim else 200, cell=0.42 if slim else 1.0))])
        _write(out / "turnaround.png", _sheet(rows))
        files.append(str(out / "turnaround.png"))

    if "bake" in shots:
        workbench("VERTEX", (0.0, 0.0, 0.0))
        for key in ("ao", "crest"):
            rows = []
            for chunk in (variants[:4], variants[4:]):
                if not chunk:
                    continue
                for level_name in ("hi", "lo"):
                    items = [(built[v][level_name], built[v][level_name][key], eye_bearings(v)[-1][0]) for v in chunk]
                    rows.append([_read(ortho_row(f"bake-{key}-{level_name}-{chunk[0]}", items, 420, bottom=-0.05))])
            _write(out / f"bake-{key}.png", _sheet(rows))
            files.append(str(out / f"bake-{key}.png"))

    if "clay" in shots:
        # For judging the forms alone: one white light over the eye's left shoulder, a grey fill.
        scene.render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = 16
        world.use_nodes = True
        tree = world.node_tree
        for node in list(tree.nodes):
            tree.nodes.remove(node)
        output = tree.nodes.new("ShaderNodeOutputWorld")
        back = tree.nodes.new("ShaderNodeBackground")
        back.inputs["Color"].default_value = (0.3, 0.3, 0.33, 1.0)
        tree.links.new(back.outputs[0], output.inputs["Surface"])
        clay = _material("SunbraidMonolithsClay", (0.62, 0.6, 0.57), True)
        data = bpy.data.lights.new("SunbraidMonolithsKey", "SUN")
        data.energy = 1.9
        data.angle = math.radians(2.0)
        key = bpy.data.objects.new(data.name, data)
        key.rotation_mode = "QUATERNION"
        key.rotation_quaternion = Vector((-0.75, -0.5, 0.45)).to_track_quat("Z", "Y")
        col.objects.link(key)
        cam_data.type = "ORTHO"
        cam_data.sensor_fit = "AUTO"
        cam_data.shift_x = cam_data.shift_y = 0.0
        cam.location = (0.0, -30.0, 0.52)
        for v in variants:
            slim = built[v]["kind"] == "tower"
            cell = 0.46 if slim else 1.05
            first = eye_bearings(v)[0][0]
            made = []
            for k in range(4):
                obj = _object(col, f"pv.clay.{v}.{k}", built[v]["hi"], built[v]["hi"]["ao"] * 0.5 + 0.5, clay)
                obj.rotation_euler = (0.0, 0.0, math.radians(first + k * 90.0 - 90.0))
                obj.location = ((k - 1.5) * cell, 0.0, 0.0)
                made.append(obj)
            cam_data.ortho_scale = max(4 * cell, 1.14)
            px = 560 if slim else 300
            path = out / f"clay-{v}.png"
            render(path, round(4 * cell * px), round(1.14 * px))
            clear(made)
            files.append(str(path))
        bpy.data.objects.remove(key, do_unlink=True)
        bpy.data.lights.remove(data)

    if "lit" in shots:
        # (b) The way the game sees it: the eye at 0.23 of the height, three heights away, level;
        # a white floor; the three suns low, once behind the stone and once off to the left.
        try:
            scene.render.engine = "BLENDER_EEVEE"
        except TypeError:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        try:
            scene.eevee.taa_render_samples = 24
        except Exception:
            pass
        try:
            world.use_nodes = True
        except Exception:
            pass
        tree = world.node_tree
        for node in list(tree.nodes):
            tree.nodes.remove(node)
        output = tree.nodes.new("ShaderNodeOutputWorld")
        seen = tree.nodes.new("ShaderNodeBackground")
        seen.inputs["Color"].default_value = (0.66, 0.6, 0.74, 1.0)
        fill = tree.nodes.new("ShaderNodeBackground")
        fill.inputs["Color"].default_value = (0.075, 0.068, 0.09, 1.0)
        path_node = tree.nodes.new("ShaderNodeLightPath")
        mix = tree.nodes.new("ShaderNodeMixShader")
        tree.links.new(path_node.outputs["Is Camera Ray"], mix.inputs[0])
        tree.links.new(fill.outputs[0], mix.inputs[1])
        tree.links.new(seen.outputs[0], mix.inputs[2])
        tree.links.new(mix.outputs[0], output.inputs["Surface"])
        stone_mat = _material("SunbraidMonolithsStone", (0.9, 0.84, 0.76), True)
        floor_mat = _material("SunbraidMonolithsFloor", (0.92, 0.92, 0.9), False)
        floor_mesh = bpy.data.meshes.new("SunbraidMonolithsFloor")
        floor_mesh.from_pydata([(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)], [], [(0, 1, 2, 3)])
        floor_mesh.materials.append(floor_mat)
        floor = bpy.data.objects.new("SunbraidMonolithsFloor", floor_mesh)
        col.objects.link(floor)
        lamps = []
        for i, (colour, power, _, _) in enumerate(SUNS):
            data = bpy.data.lights.new(f"SunbraidMonolithsSun{i}", "SUN")
            data.color = colour
            data.energy = 3.1 * power
            data.angle = math.radians(1.6)
            lamp = bpy.data.objects.new(data.name, data)
            lamp.rotation_mode = "QUATERNION"
            col.objects.link(lamp)
            lamps.append(lamp)
        cam_data.type = "PERSP"
        cam_data.sensor_fit = "VERTICAL"
        cam_data.clip_start = 0.05
        cam_data.clip_end = 400.0
        frame_lo, frame_hi, eye, away = -0.2, 1.06, 0.23, 3.0
        cam_data.angle_y = 2.0 * math.atan((frame_hi - frame_lo) / 2.0 / away)
        height = 560
        cam_data.shift_y = ((frame_hi + frame_lo) / 2.0 - eye) / (frame_hi - frame_lo)
        cam_data.shift_x = 0.0
        cam.location = (0.0, -away, eye)

        def aim(off):
            for lamp, (_, _, bearing, elevation) in zip(lamps, SUNS):
                a = math.radians(off - bearing)
                e = math.radians(elevation)
                to_sun = Vector((-math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
                lamp.rotation_quaternion = to_sun.to_track_quat("Z", "Y")

        for v in variants:
            views = eye_bearings(v)
            rows = []
            for level_name in ("hi", "lo"):
                row = []
                for label, off, bearing in (("back", 20.0, views[0][0]), ("side", 60.0, views[-1][0])):
                    model = built[v][level_name]
                    obj = _object(col, f"pv.lit.{v}", model, model["ao"] * 0.4 + 0.6, stone_mat)
                    obj.rotation_euler = (0.0, 0.0, math.radians(bearing - 90.0))
                    aim(off)
                    path = out / f"lit-{v}-{label}-{level_name}.png"
                    render(path, 440 if built[v]["kind"] == "tower" else 700, height)
                    clear([obj])
                    row.append(_read(path))
                rows.append(row)
            _write(out / f"lit-{v}.png", _sheet(rows))
            files.append(str(out / f"lit-{v}.png"))
    return files


# ── Entry ─────────────────────────────────────────────────────────────────────

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    report_path = None
    variants = list(range(len(DESIGNS)))
    shots = {"sil", "turn", "lit", "bake"}
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        if a == "--preview":
            preview_dir = argv[i + 1]
        if a == "--only":
            variants = [int(n) for n in argv[i + 1].split(",") if n.strip().isdigit() and int(n) < len(DESIGNS)]
        if a == "--shots":
            shots = set(argv[i + 1].split(","))
        if a == "--report":
            report_path = argv[i + 1]
    scene = bpy.data.scenes.new(SCENE)
    built, report = build(scene, variants)
    if out and len(variants) == len(DESIGNS):
        path = Path(out) / MODULE
        write_module(path, built)
        print(TAG, "wrote", path, f"{path.stat().st_size / 1024:.1f} KiB")
    elif out:
        print(TAG, "--only builds previews; the module needs every variant")
    if report_path:
        Path(report_path).write_text(json.dumps(report, indent=1), encoding="utf-8", newline="\n")
    if preview_dir:
        for f in previews(scene, built, preview_dir, shots):
            print(TAG, "preview", f)


if __name__ == "__main__":
    main()
