"""Stellar Drift's drifting rocks: six bodies of the ringed giant's outer haze, sculpted by script.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/stellar_drift_rocks.py -- \
        --out src/themes/stellar-drift [--preview <dir>] [--only block,splinter]

The camera drifts in the thin haze beyond the rings, among what the rings shed: clean ice broken
along its cleavage, loose aggregates of ring ice, and the darker rock of captured moonlets. Every
design is built for its SILHOUETTE first, so the six read apart at thirty pixels:

    block     a cleaved block of ice: big flat fracture faces, broken corners, a stepped notch
    rubble    a rubble-pile chunk of ring ice: a dozen lumps loosely welded, deep seams between
    potato    a cratered rocky body, broad at one end, one great crater on its broad end
    binary    a contact binary: two lobes of unequal size touching at a narrow waist
    splinter  a long splinter of ice, five long faces tapering to a chisel tip
    slab      a flat plate of layered crust, its upper stratum broken back to a step

Each is a signed distance field evaluated with numpy (ellipsoids, half-spaces, smooth unions and
cuts, crater bowls with raised rims, value-noise lumps and grain), polygonised with surface nets
(scripts/blender/grainfields/horse_sdf.py), centred, and scaled to a bounding radius of one. The
fine mesh is decimated in Blender to three levels (a hero rock, a boulder, a chip), and every
vertex of every level is given what the theme shades it by, read from the FINE mesh:

    normal   the fine surface's normal, averaged over the vertex's neighbourhood (smooth)
    ao       ambient occlusion: cosine-weighted rays cast against the fine mesh
    crest    0 in a crevice, 0.5 on a flat, 1 on an exposed crest (where the dust lies)
    thin     how thin the body is under the vertex: 1 at a thin edge (where ice lets the sun
             through), 0 deep in its bulk

The flat-faced designs keep their faces at the finer levels: a vertex is split where two faces
part, so each face catches the sun on its own as the body turns.

The export is one module, src/themes/stellar-drift/stellar-drift-rock-models.js: base64 typed
arrays, no loader and no asset file. Deterministic: the same script and Blender write the same bytes.
"""

import base64
import json
import math
import sys
from array import array
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from grainfields.horse_sdf import surface_nets  # noqa: E402

TAG = "[stellar-drift-rocks]"
SCENE = "StellarDriftRocks"
MODULE = "stellar-drift-rock-models.js"

VOXEL = 0.0125
BOUND = 1.36
#: Triangles per level, and how far a vertex's bake reaches over the fine surface.
LEVELS = {
    "hero": {"triangles": 1100, "reach": 0.035},
    "boulder": {"triangles": 340, "reach": 0.075},
    "chip": {"triangles": 76, "reach": 0.2},
}
QUANT = 1.0 / 16384.0
AO_RAYS = 56
AO_REACH = 1.1
#: The bake's occlusion is gentle (open bodies); the theme wants seams and craters to read.
AO_GAIN = 2.6
CAVITY_RADIUS = 0.08
#: Rays cast into the body for its thickness, and the thicknesses that count as thin and as bulk.
THIN_RAYS = 24
THIN_EDGE = (0.22, 0.8)


# ── Noise (numpy) ─────────────────────────────────────────────────────────────

def _hash(ix, iy, iz, seed):
    mask = np.uint64(0xFFFFFFFF)
    h = ((ix & 0xFFFFFFFF).astype(np.uint64) * np.uint64(2654435761)
         + (iy & 0xFFFFFFFF).astype(np.uint64) * np.uint64(2246822519)
         + (iz & 0xFFFFFFFF).astype(np.uint64) * np.uint64(3266489917)
         + np.uint64((seed * 668265263 + 374761393) & 0xFFFFFFFF)) & mask
    h = ((h ^ (h >> np.uint64(15))) * np.uint64(2246822519)) & mask
    h = ((h ^ (h >> np.uint64(13))) * np.uint64(3266489917)) & mask
    h = h ^ (h >> np.uint64(16))
    return h.astype(np.float64) / 4294967295.0


def vnoise(p, seed):
    """Value noise in [-1, 1], one lattice cell per unit."""
    cell = np.floor(p).astype(np.int64)
    f = p - cell
    u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0)
    out = np.zeros(len(p))
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1.0 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1.0 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1.0 - u[:, 2]
                out += wx * wy * wz * _hash(cell[:, 0] + dx, cell[:, 1] + dy, cell[:, 2] + dz, seed)
    return out * 2.0 - 1.0


def fbm(p, seed, octaves=3, gain=0.5, lacunarity=2.03):
    total = np.zeros(len(p))
    amp = 1.0
    norm = 0.0
    q = p.copy()
    for o in range(octaves):
        total += amp * vnoise(q + 11.7 * o, seed + o * 97)
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


def sphere(p, centre, radius):
    return np.linalg.norm(p - np.asarray(centre, dtype=np.float64), axis=1) - radius


def plane(p, normal, offset):
    return p @ unit(normal) - offset


def land(field, direction, start=2.4):
    """Where a ray from far out along `direction` first meets the field's surface."""
    d = unit(direction)
    t = start
    for _ in range(96):
        t -= float(field((d * t)[None, :])[0]) * 0.8
    return d * t


class Craters:
    """Bowls with raised rims, added to a field as displacement."""

    def __init__(self):
        self.items = []

    def add(self, centre, radius, depth=0.32, rim=0.08):
        self.items.append((np.asarray(centre, dtype=np.float64), radius, depth, rim))

    def scatter(self, field, rng, count, radii, depth=(0.32, 0.44), avoid=()):
        placed = 0
        tries = 0
        while placed < count and tries < count * 40:
            tries += 1
            d = unit(rng.normal(size=3))
            radius = radii[0] + (radii[1] - radii[0]) * rng.random() ** 1.5
            at = land(field, d)
            clear = all(np.linalg.norm(at - c) > (r + radius) * 0.85 for c, r, _, _ in self.items)
            clear = clear and all(np.linalg.norm(at - np.asarray(c)) > r + radius for c, r in avoid)
            if not clear:
                continue
            self.add(at, radius, depth[0] + (depth[1] - depth[0]) * rng.random(), 0.06 + 0.05 * rng.random())
            placed += 1

    def displace(self, p):
        out = np.zeros(len(p))
        for centre, radius, depth, rim in self.items:
            rho = np.linalg.norm(p - centre, axis=1) / radius
            near = rho < 1.9
            if not near.any():
                continue
            r = rho[near]
            bowl = np.where(r < 1.0, (1.0 - r * r) ** 2, 0.0)
            lip = np.exp(-((r - 1.03) / 0.21) ** 2) * (1.0 - smoothstep(1.3, 1.9, r))
            out[near] += radius * (depth * bowl - rim * lip)
        return out


def grain(p, seed, scale=1.0):
    """The surface's fine relief: rubble at two scales."""
    return 0.018 * scale * fbm(p * 6.7, seed + 7, 2) + 0.008 * scale * vnoise(p * 16.0, seed + 9)


def frost(p, seed, scale=1.0):
    """Ice's relief: soft hummocks of frost, no sharp grit."""
    return 0.014 * scale * fbm(p * 5.1, seed + 3, 3)


def near_surface(d, band=0.2):
    return np.abs(d) < band


# ── The six designs ───────────────────────────────────────────────────────────

def design_block():
    # Three pairs of faces not square to one another: a cleaved block, not a brick.
    faces = [
        ((1.0, 0.14, -0.1), 0.8), ((-1.0, 0.06, 0.12), 0.72),
        ((0.12, 1.0, 0.18), 0.5), ((-0.16, -1.0, 0.04), 0.47),
        ((0.06, -0.22, 1.0), 0.5), ((0.14, 0.12, -1.0), 0.54),
    ]
    # Corners broken off along fresh planes.
    chips = [
        ((0.8, 0.78, 0.46), 0.84), ((-0.72, 0.66, -0.52), 0.78), ((0.74, -0.62, -0.64), 0.86),
        ((-0.8, -0.56, 0.62), 0.86), ((0.92, 0.08, 0.78), 0.9), ((-0.5, 0.9, 0.6), 0.74),
    ]
    # Shallow conchoidal dishes where flakes came away from two faces.
    scars = [((0.18, 1.98, 0.3), 1.52), ((-0.34, -0.42, 2.02), 1.57), ((-2.1, 0.3, -0.2), 1.42)]

    def base(p):
        d = np.full(len(p), -10.0)
        for normal, offset in faces + chips:
            d = smax(d, plane(p, normal, offset), 0.016)
        for centre, radius in scars:
            d = smax(d, -sphere(p, centre, radius), 0.012)
        # A step broken out of one end: it shows in the outline from most sides.
        notch = np.maximum(0.5 - p[:, 0], 0.16 - p[:, 1] + 0.12 * p[:, 2])
        return smax(d, -notch, 0.014)

    def field(p):
        d = base(p)
        m = near_surface(d)
        # Clean ice: frost only, and the faint lines of the cleavage across the faces.
        lines = 0.004 * np.sin((p[m] @ unit((0.3, 0.8, -0.5))) * 46.0 + 3.0 * vnoise(p[m] * 2.2, 113))
        d[m] += frost(p[m], 101, 0.6) + lines
        return d

    return field


def design_rubble():
    rng = np.random.default_rng(3203)
    clumps = [(np.zeros(3), np.array([0.56, 0.44, 0.5]), 0)]
    for k in range(12):
        d = unit(rng.normal(size=3) * (1.0, 0.72, 0.86))
        r = 0.22 + 0.17 * rng.random()
        at = d * (0.36 + 0.3 * rng.random() ** 0.8) * np.array([1.0, 0.8, 0.88])
        radii = r * np.array([1.0, 0.72 + 0.3 * rng.random(), 0.78 + 0.3 * rng.random()])
        clumps.append((at, radii, k + 1))

    def base(p):
        d = np.full(len(p), 10.0)
        for at, radii, k in clumps:
            lump = ellipsoid(p, at, radii) + 0.035 * fbm(p * 3.3 + k * 1.7, 211 + k, 2)
            # Welded loosely: seams between the lumps stay deep.
            d = smin(d, lump, 0.075)
        return d

    def field(p):
        d = base(p)
        m = near_surface(d)
        d[m] += frost(p[m], 223, 1.0) + 0.007 * vnoise(p[m] * 13.0, 227)
        return d

    return field


def design_potato():
    rng = np.random.default_rng(3307)

    def base(p):
        q = p.copy()
        q[:, 1] += 0.14 * p[:, 0] ** 2 - 0.05
        q[:, 2] += 0.05 * np.sin(p[:, 0] * 2.6 + 0.4)
        broad = ellipsoid(q, (0.26, 0.02, 0.0), (0.74, 0.58, 0.6))
        narrow = ellipsoid(q, (-0.46, -0.02, 0.03), (0.56, 0.4, 0.42))
        d = smin(broad, narrow, 0.42)
        return d + 0.12 * fbm(p * 1.25 + 4.2, 311, 2)

    craters = Craters()
    great = land(base, (0.75, 0.45, 0.48))
    craters.add(great, 0.44, depth=0.72, rim=0.07)
    craters.add(land(base, (-0.5, -0.6, -0.65)), 0.3, depth=0.6, rim=0.1)
    craters.add(land(base, (-0.1, 0.95, -0.3)), 0.25, depth=0.56, rim=0.1)
    craters.scatter(base, rng, 7, (0.1, 0.21), depth=(0.45, 0.6), avoid=[(great, 0.4)])

    def field(p):
        d = base(p)
        m = near_surface(d)
        d[m] += craters.displace(p[m]) + grain(p[m], 313)
        return d

    return field


def design_binary():
    rng = np.random.default_rng(3409)

    def base(p):
        big = ellipsoid(p, (-0.4, 0.0, 0.0), (0.6, 0.52, 0.5)) + 0.08 * fbm(p * 1.7 + 2.0, 401, 2)
        # The small lobe leans on the big one, turned a little and flattened the other way.
        q = p.copy()
        q[:, 0] = p[:, 0] * 0.95 - p[:, 1] * 0.3
        q[:, 1] = p[:, 1] * 0.95 + p[:, 0] * 0.3
        small = ellipsoid(q, (0.5, -0.12, 0.05), (0.44, 0.36, 0.4)) + 0.06 * fbm(p * 2.3 + 7.0, 409, 2)
        return smin(big, small, 0.09)

    craters = Craters()
    craters.add(land(base, (-0.9, 0.35, 0.5)), 0.3, depth=0.42, rim=0.09)
    craters.add(land(base, (0.9, -0.1, 0.5)), 0.2, depth=0.4, rim=0.1)
    craters.add(land(base, (-0.4, -0.5, -0.8)), 0.24, depth=0.38, rim=0.08)
    waist = (0.08, -0.04, 0.0)
    craters.scatter(base, rng, 6, (0.09, 0.17), avoid=[(waist, 0.26)])

    def field(p):
        d = base(p)
        m = near_surface(d)
        # The waist is smooth: the dust has run down into it from both lobes.
        rough = 1.0 - 0.7 * np.exp(-((p[m, 0] - 0.08) / 0.15) ** 2)
        d[m] += craters.displace(p[m]) + grain(p[m], 419) * rough
        return d

    return field


def design_splinter():
    faces = []
    for angle, offset, taper in ((12, 0.27, 0.08), (82, 0.22, 0.06), (148, 0.28, 0.09), (218, 0.21, 0.07),
                                 (288, 0.25, 0.08)):
        a = math.radians(angle)
        faces.append(((taper, math.cos(a), math.sin(a)), offset))
    cuts = faces + [
        # The chisel: two planes meeting in an edge at the tip.
        ((0.9, 0.42, -0.08), 0.84),
        ((0.9, -0.38, 0.22), 0.82),
        # The butt broke off obliquely.
        ((-1.0, 0.26, 0.34), 0.82),
    ]
    scars = [((0.1, 1.72, 0.54), 1.5), ((-0.3, -0.64, -1.68), 1.47)]

    def base(p):
        d = np.full(len(p), -10.0)
        for normal, offset in cuts:
            d = smax(d, plane(p, normal, offset), 0.014)
        for centre, radius in scars:
            d = smax(d, -sphere(p, centre, radius), 0.012)
        return d

    def field(p):
        d = base(p)
        m = near_surface(d)
        # Striations along its length: it grew, and broke, along the grain of the ice.
        ribs = 0.005 * np.sin(np.arctan2(p[m, 2], p[m, 1]) * 22.0 + 3.0 * vnoise(p[m] * 1.8, 503))
        d[m] += frost(p[m], 509, 0.45) + ribs
        return d

    return field


def design_slab():
    rng = np.random.default_rng(3613)
    angles = (4, 52, 104, 152, 200, 252, 306)
    reach = (0.96, 0.7, 0.66, 0.88, 0.78, 0.6, 0.74)
    # (Overlapping: two strata that only touch leave their shared face inside the union.)
    layers = ((-0.17, 0.0), (-0.04, 0.15))
    setback = [[float(x) for x in rng.uniform(-0.18, 0.02, len(angles))] for _ in layers]
    # The upper stratum has broken back a long way on one side: a step, seen in profile.
    setback[1][0] -= 0.3
    setback[1][1] -= 0.16

    def warp(p):
        q = p.copy()
        q[:, 1] -= 0.1 * p[:, 0] ** 2 - 0.06 * p[:, 2] + 0.02
        return q

    def base(p):
        q = warp(p)
        d = np.full(len(p), 10.0)
        for (lo, hi), back in zip(layers, setback):
            layer = np.abs(q[:, 1] - (lo + hi) * 0.5) - (hi - lo) * 0.5
            for angle, r, b in zip(angles, reach, back):
                a = math.radians(angle)
                edge = q[:, 0] * math.cos(a) + q[:, 2] * math.sin(a) - (r + b)
                # The break is ragged: the line wanders with the place along it.
                edge = edge + 0.032 * np.sin((q[:, 2] * math.cos(a) - q[:, 0] * math.sin(a)) * 8.0 + angle)
                layer = smax(layer, edge, 0.014)
            d = smin(d, layer, 0.012)
        return d

    craters = Craters()
    for direction, radius in (((0.25, 1.0, 0.15), 0.18), ((-0.5, 1.0, -0.2), 0.12), ((0.2, -1.0, -0.3), 0.16)):
        craters.add(land(base, direction), radius, depth=0.24, rim=0.05)

    def field(p):
        d = base(p)
        m = near_surface(d)
        q = warp(p[m])
        groove = np.maximum(0.0, 1.0 - np.abs(vnoise(q * (1.9, 0.3, 1.6) + 5.0, 619)) / 0.07)
        faces = smoothstep(0.1, 0.15, np.abs(q[:, 1]))
        d[m] += craters.displace(p[m]) + grain(p[m], 613, 0.75) + 0.02 * groove * groove * faces
        return d

    return field


DESIGNS = {
    "block": design_block,
    "rubble": design_rubble,
    "potato": design_potato,
    "binary": design_binary,
    "splinter": design_splinter,
    "slab": design_slab,
}


# ── Meshing ───────────────────────────────────────────────────────────────────

def polygonise(field):
    axis = np.arange(-BOUND, BOUND + VOXEL * 0.5, VOXEL)
    n = len(axis)
    grid = np.empty((n, n, n))
    yy, zz = np.meshgrid(axis, axis, indexing="ij")
    flat_y = yy.ravel()
    flat_z = zz.ravel()
    for start in range(0, n, 12):
        xs = axis[start:start + 12]
        p = np.empty((len(xs) * n * n, 3))
        p[:, 0] = np.repeat(xs, n * n)
        p[:, 1] = np.tile(flat_y, len(xs))
        p[:, 2] = np.tile(flat_z, len(xs))
        grid[start:start + len(xs)] = field(p).reshape(len(xs), n, n)
    return surface_nets(grid, axis, axis, axis)


def largest_piece(vertices, triangles):
    """Drop any crumb the noise left floating beside the body."""
    parent = np.arange(len(vertices))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in triangles:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[rc] = ra
    roots = np.array([find(i) for i in range(len(vertices))])
    keep = roots == np.bincount(roots).argmax()
    if keep.all():
        return vertices, triangles
    lookup = np.full(len(vertices), -1)
    lookup[keep] = np.arange(int(keep.sum()))
    tris = lookup[triangles]
    return vertices[keep], tris[(tris >= 0).all(axis=1)]


def vertex_normals(vertices, triangles):
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    normals = np.zeros_like(vertices)
    for i in range(3):
        np.add.at(normals, triangles[:, i], face)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)


def signed_volume(vertices, triangles):
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def normalise(vertices, triangles):
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    centre = ((a + b + c) / 3.0 * area[:, None]).sum(axis=0) / area.sum()
    out = vertices - centre
    return out / np.linalg.norm(out, axis=1).max()


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
    vertices = np.array([v.co[:] for v in mesh.vertices], dtype=np.float64)
    triangles = np.array([t.vertices[:] for t in mesh.loop_triangles], dtype=np.int64)
    bpy.data.meshes.remove(mesh)
    return vertices, triangles


def clean_object(scene, name, vertices, triangles):
    """The fine surface as one closed skin (a voxel remesh): what the levels are decimated from.

    Surface nets leave a pinched vertex wherever two faces of the field nearly touch (the slab's
    strata, the rubble's seams), and the collapse decimator cannot go below a count that keeps
    every pinch.
    """
    raw = mesh_object(scene, f"{name}.nets", vertices, triangles)
    mod = raw.modifiers.new("skin", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = VOXEL * 1.15
    mod.adaptivity = 0.0
    mod.use_smooth_shade = False
    skin_v, skin_t = _evaluated(scene, raw)
    mesh = raw.data
    bpy.data.objects.remove(raw, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    skin_v, skin_t = largest_piece(skin_v, skin_t)
    return mesh_object(scene, f"{name}.fine", skin_v, skin_t)


def decimated(scene, fine_obj, target):
    count = len(fine_obj.data.polygons)
    mod = fine_obj.modifiers.new("level", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, target / count)
    mod.use_collapse_triangulate = True
    vertices, triangles = _evaluated(scene, fine_obj)
    fine_obj.modifiers.remove(mod)
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


class Bake:
    """Samples of the fine surface: where, its normal, its occlusion, how proud and how thin."""

    def __init__(self, vertices, triangles):
        normals = vertex_normals(vertices, triangles)
        bvh = BVHTree.FromPolygons(vertices.tolist(), triangles.tolist())
        everything = KDTree(len(vertices))
        for i, v in enumerate(vertices):
            everything.insert(v, i)
        everything.balance()
        rng = np.random.default_rng(131)
        pick = np.sort(rng.permutation(len(vertices))[:min(len(vertices), 9000)])
        dirs = hemisphere(AO_RAYS)
        inward = hemisphere(THIN_RAYS)
        ao = np.empty(len(pick))
        crest = np.empty(len(pick))
        thick = np.empty(len(pick))
        for k, i in enumerate(pick):
            p = vertices[i]
            n = normals[i]
            t, b = frame(n)
            # Each sample turns the spiral by its own angle: no pattern is shared between them.
            turn = (i * 0.61803398875) % 1.0 * math.tau
            ct, st = math.cos(turn), math.sin(turn)
            start = Vector(p + n * 0.012)
            dark = 0.0
            for dx, dy, dz in dirs:
                x = dx * ct - dy * st
                y = dx * st + dy * ct
                hit = bvh.ray_cast(start, Vector(t * x + b * y + n * dz), AO_REACH)
                if hit[0] is not None:
                    dark += 1.0 - hit[3] / AO_REACH
            ao[k] = 1.0 - dark / AO_RAYS
            # Thickness: how far light entering here travels through the body before it leaves.
            inside = Vector(p - n * 0.006)
            through = 0.0
            for dx, dy, dz in inward:
                x = dx * ct - dy * st
                y = dx * st + dy * ct
                hit = bvh.ray_cast(inside, Vector(-(t * x + b * y + n * dz)), 2.4)
                through += hit[3] if hit[0] is not None else 2.4
            thick[k] = through / THIN_RAYS
            near = [j for _, j, _ in everything.find_range(p, CAVITY_RADIUS)]
            mean = vertices[near].mean(axis=0)
            # Proud of its neighbourhood (a crest) or sunk in it (a crevice).
            crest[k] = float((p - mean) @ n) / CAVITY_RADIUS
        self.points = vertices[pick]
        self.normals = normals[pick]
        self.ao = ao
        self.crest = crest
        self.thick = thick
        self.tree = KDTree(len(pick))
        for k, p in enumerate(self.points):
            self.tree.insert(p, k)
        self.tree.balance()

    def at(self, vertices, reach):
        """The bake at a level's vertices: a Gaussian mean over `reach` of the fine surface."""
        normals = np.empty_like(vertices)
        ao = np.empty(len(vertices))
        crest = np.empty(len(vertices))
        thick = np.empty(len(vertices))
        for i, v in enumerate(vertices):
            found = self.tree.find_range(v, reach * 1.6)
            if len(found) < 4:
                found = self.tree.find_n(v, 6)
            idx = np.array([k for _, k, _ in found])
            dist = np.array([d for _, _, d in found])
            w = np.exp(-(dist / reach) ** 2) + 1e-6
            n = (self.normals[idx] * w[:, None]).sum(axis=0)
            normals[i] = n / max(np.linalg.norm(n), 1e-9)
            ao[i] = min(1.0, max(0.1, 1.0 - (1.0 - float((self.ao[idx] * w).sum() / w.sum())) * AO_GAIN))
            crest[i] = float((self.crest[idx] * w).sum() / w.sum())
            thick[i] = float((self.thick[idx] * w).sum() / w.sum())
        return normals, ao, crest, thick


#: Designs whose flat faces meet at hard edges, and the angle (degrees) past which two faces part.
CREASES = {"block": 34.0, "splinter": 34.0, "slab": 44.0}
#: The levels that keep them. (A chip is a few pixels: its faces cannot show, and every split is
#: a vertex in every one of a hundred chips.)
CREASED_LEVELS = {"block": ("hero", "boulder"), "splinter": ("hero", "boulder"), "slab": ("hero",)}


def crease_split(model, angle):
    """Give every flat face its own normal: split a vertex where its faces part by more than `angle`."""
    vertices, triangles = model["vertices"], model["triangles"].copy()
    a, b, c = (vertices[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    area = np.linalg.norm(face, axis=1)
    face_n = face / np.maximum(area[:, None], 1e-12)
    limit = math.cos(math.radians(angle))
    corners = [[] for _ in vertices]
    for f, tri in enumerate(triangles):
        for k in range(3):
            corners[tri[k]].append((f, k))
    keys = ("vertices", "normals", "ao", "crest", "thin")
    out = {key: list(model[key]) for key in keys}
    for v, uses in enumerate(corners):
        groups = []
        for f, k in sorted(uses, key=lambda use: -area[use[0]]):
            for group in groups:
                if float(face_n[f] @ group[0]) > limit:
                    group[1].append((f, k))
                    break
            else:
                groups.append((face_n[f], [(f, k)]))
        if len(groups) < 2:
            continue
        for g, (_, members) in enumerate(groups):
            n = sum(face_n[f] * area[f] for f, _ in members)
            n = n / max(np.linalg.norm(n), 1e-12)
            if g == 0:
                out["normals"][v] = n
                continue
            index = len(out["vertices"])
            out["vertices"].append(vertices[v])
            out["normals"].append(n)
            for key in ("ao", "crest", "thin"):
                out[key].append(model[key][v])
            for f, k in members:
                triangles[f, k] = index
    model.update({key: np.array(value) for key, value in out.items()})
    model["triangles"] = triangles
    return model


def crest_unit(crest):
    """0 in a crevice, 0.5 on a flat, 1 on a crest."""
    return np.clip(0.5 + crest * 3.2, 0.0, 1.0)


def thin_unit(thick):
    """1 where the body is a thin edge, 0 in its bulk."""
    return 1.0 - smoothstep(THIN_EDGE[0], THIN_EDGE[1], thick)


# ── Build ─────────────────────────────────────────────────────────────────────

def build(scene, names):
    models = {level: [] for level in LEVELS}
    report = {}
    for name in names:
        fine_v, fine_t = polygonise(DESIGNS[name]())
        fine_v, fine_t = largest_piece(fine_v, fine_t)
        if signed_volume(fine_v, fine_t) < 0:
            fine_t = fine_t[:, ::-1].copy()
        fine_v = normalise(fine_v, fine_t)
        bake = Bake(fine_v, fine_t)
        fine_obj = clean_object(scene, name, fine_v, fine_t)
        report[name] = {"fine": [len(fine_v), len(fine_t)]}
        made = []
        for level, spec in LEVELS.items():
            vertices, triangles = decimated(scene, fine_obj, spec["triangles"])
            if signed_volume(vertices, triangles) < 0:
                triangles = triangles[:, ::-1].copy()
            normals, ao, crest, thick = bake.at(vertices, spec["reach"])
            model = {
                "design": name,
                "vertices": vertices,
                "triangles": triangles,
                "normals": normals,
                "ao": ao,
                "crest": crest_unit(crest),
                "thin": thin_unit(thick),
            }
            if level in CREASED_LEVELS.get(name, ()):
                model = crease_split(model, CREASES[name])
            models[level].append(model)
            made.append(model)
            report[name][level] = [len(model["vertices"]), len(triangles)]
        # A decimated level's vertices stand a little outside the fine surface: one scale for the
        # design's levels, so that the furthest vertex of any of them is at one.
        far = max(float(np.linalg.norm(model["vertices"], axis=1).max()) for model in made)
        for model in made:
            model["vertices"] = model["vertices"] / far
        fine_obj.hide_render = True
        print(TAG, name, json.dumps(report[name]), f"ao {bake.ao.min():.2f}..{bake.ao.max():.2f}",
              f"crest p5 {np.percentile(bake.crest, 5):.3f} p95 {np.percentile(bake.crest, 95):.3f}",
              f"thick p5 {np.percentile(bake.thick, 5):.3f} p50 {np.percentile(bake.thick, 50):.3f}")
    return models, report


# ── The module the theme imports ──────────────────────────────────────────────

def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def write_module(path, models, names):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Stellar Drift's rocks: GENERATED by scripts/blender/stellar_drift_rocks.py (do not edit by hand).",
        " *",
        " * Six bodies of the giant's outer haze sculpted by script in Blender (signed distance fields,",
        " * polygonised, decimated), each at three levels: `hero`, `boulder`, `chip`. Every model is",
        " * centred, with a bounding radius of one. `positions` are Int16 in units of `quant`; `normals`",
        " * Int8 (the fine surface's normal, smoothed, x127; a flat-faced design's faces keep their own);",
        " * `shade` Uint8 triples (ambient occlusion; crest: 0 in a crevice, 128 on a flat, 255 on an",
        " * exposed crest; thin: 255 at a thin edge, 0 in the bulk), all x255; `index` Uint16 triangles,",
        " * wound counter-clockwise seen from outside.",
        " */",
        "export const STELLAR_DRIFT_ROCK_MODELS = Object.freeze({",
        f"    quant: {QUANT!r},",
        f"    designs: {json.dumps(list(names))},",
    ]
    for level in LEVELS:
        lines.append(f"    {level}: [")
        for model in models[level]:
            positions = [int(round(c / QUANT)) for v in model["vertices"] for c in v]
            normals = [int(round(max(-1.0, min(1.0, c)) * 127)) for n in model["normals"] for c in n]
            shade = []
            for ao, crest, thin in zip(model["ao"], model["crest"], model["thin"]):
                shade.extend((int(round(max(0.0, min(1.0, ao)) * 255)), int(round(crest * 255)),
                              int(round(max(0.0, min(1.0, thin)) * 255))))
            index = [int(i) for t in model["triangles"] for i in t]
            lines += [
                "        {",
                f"            design: {json.dumps(model['design'])},",
                f"            vertexCount: {len(model['vertices'])},",
                f"            triangleCount: {len(model['triangles'])},",
                f"            positions: '{b64('h', positions)}',",
                f"            normals: '{b64('b', normals)}',",
                f"            shade: '{b64('B', shade)}',",
                f"            index: '{b64('H', index)}',",
                "        },",
            ]
        lines.append("    ],")
    lines += ["});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# ── Previews ──────────────────────────────────────────────────────────────────

#: Which designs are ice (the rest are rock), as the theme dresses them by default.
ICE = ("block", "rubble", "splinter")


def _lit(model, light, view):
    """The theme's shading, near enough to judge the bake by: one light, AO, dust, light through ice."""
    n = model["normals"]
    ndl = n @ light
    ice = model["design"] in ICE
    day = smoothstep(-0.03, 0.12, ndl) * np.clip(ndl, 0.0, 1.0)
    ao = model["ao"]
    rim = (1.0 - np.clip(n @ view, 0.0, 1.0)) ** 3
    behind = max(0.0, float(-(view @ light)))
    if ice:
        albedo = np.array([0.78, 0.86, 0.95])
        half = unit(light + view)
        glint = np.clip(n @ half, 0.0, 1.0) ** 60 * 1.6
        through = model["thin"] * (behind ** 2 * 0.9 + 0.12) * (1.0 - np.clip(ndl, 0.0, 1.0))
        value = albedo[None, :] * (day * (0.45 + 0.55 * ao))[:, None] + glint[:, None] \
            + np.array([0.35, 0.65, 0.9])[None, :] * through[:, None] + 0.05 * rim[:, None]
    else:
        albedo = np.array([0.24, 0.2, 0.17]) * (0.55 + 0.9 * model["crest"])[:, None]
        value = albedo * (day * (0.2 + 0.8 * ao * ao) * 1.8 + 0.03 * ao)[:, None] + 0.04 * rim[:, None]
    return np.clip(value, 0.0, 1.0)


def _preview_object(col, name, model, colour):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(model["vertices"].tolist(), [], model["triangles"].tolist())
    mesh.update()
    attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    rgba = np.ones((len(model["vertices"]), 4))
    rgba[:, :3] = colour[:, None] if colour.ndim == 1 else colour
    attr.data.foreach_set("color", rgba.ravel())
    mesh.color_attributes.active_color = attr
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    return obj


def _basis(direction, up=(0.0, 0.0, 1.0)):
    d = Vector(direction).normalized()
    right = d.cross(Vector(up)).normalized()
    true_up = right.cross(d).normalized()
    return d, right, true_up


def _upscale(path, factor):
    image = bpy.data.images.load(str(path))
    w, h = image.size
    px = np.array(image.pixels[:]).reshape(h, w, 4)
    big = np.repeat(np.repeat(px, factor, axis=0), factor, axis=1)
    out = bpy.data.images.new("upscaled", w * factor, h * factor, alpha=True)
    out.pixels = big.ravel().tolist()
    out.filepath_raw = str(path)
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(image)
    bpy.data.images.remove(out)


def previews(scene, models, out_dir):
    from mathutils import Euler, Matrix

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    col = bpy.data.collections.new("StellarDriftRocksPreview")
    scene.collection.children.link(col)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.show_object_outline = False
    scene.display.render_aa = "16"
    world = bpy.data.worlds.new("StellarDriftRocksWorld")
    scene.world = world
    scene.view_settings.view_transform = "Standard"
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("StellarDriftRocksCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("StellarDriftRocksCam", cam_data)
    col.objects.link(cam)
    scene.camera = cam
    files = []

    def shoot(name, rows, pixels_per_cell, background, colour_type, upscale=1):
        """`rows` = lists of (model, colour, turn about z, tip about x in degrees) laid out on a grid."""
        made = []
        direction, right, up = _basis((0.0, 1.0, 0.0))
        width = max(len(r) for r in rows)
        cell = 2.2
        for j, row in enumerate(rows):
            for i, (model, colour, turn, tip) in enumerate(row):
                obj = _preview_object(col, f"pv.{name}.{j}.{i}", model, colour)
                obj.rotation_euler = (math.radians(tip), 0.0, math.radians(turn))
                obj.location = right * ((i - (width - 1) / 2) * cell) + up * (((len(rows) - 1) / 2 - j) * cell)
                made.append(obj)
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = Matrix((right, up, -direction)).transposed().to_quaternion()
        cam.location = -direction * 20.0
        cam_data.ortho_scale = max(width, len(rows)) * cell
        cam_data.clip_end = 100.0
        scene.render.resolution_x = int(width * pixels_per_cell)
        scene.render.resolution_y = int(len(rows) * pixels_per_cell)
        scene.render.resolution_percentage = 100
        world.color = background
        scene.display.shading.color_type = colour_type
        scene.display.shading.single_color = (0.0, 0.0, 0.0)
        path = out / f"{name}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        for obj in made:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)
        if upscale > 1:
            _upscale(path, upscale)
        files.append(str(path))

    def turned(v, turn, tip):
        """A world direction in the frame of an object turned by (tip about x, then turn about z)."""
        return np.array(Euler((math.radians(tip), 0.0, math.radians(turn))).to_matrix().inverted() @ Vector(v))

    view_world = (0.0, -1.0, 0.0)
    poses = ((0, 0), (70, 20), (160, -25), (250, 60))

    def lit_rows(level, light_world):
        rows = []
        for turn, tip in poses:
            row = []
            for model in models[level]:
                light = turned(light_world, turn, tip)
                view = turned(view_world, turn, tip)
                row.append((model, _lit(model, unit(light), unit(view)), turn, tip))
            rows.append(row)
        return rows

    side = unit((-0.85, -0.35, 0.4))
    back = unit((-0.5, 0.82, 0.25))
    shoot("heroes-side-lit", lit_rows("hero", side), 300, (0.0, 0.0, 0.0), "VERTEX")
    shoot("heroes-back-lit", lit_rows("hero", back), 300, (0.0, 0.0, 0.0), "VERTEX")
    shoot("boulders-side-lit", lit_rows("boulder", side), 200, (0.0, 0.0, 0.0), "VERTEX")
    shoot("chips-side-lit", lit_rows("chip", side), 120, (0.0, 0.0, 0.0), "VERTEX")
    for key in ("ao", "crest", "thin"):
        rows = [[(m, m[key], turn, tip) for m in models["hero"]] for turn, tip in poses[:2]]
        shoot(f"heroes-{key}", rows, 260, (0.0, 0.0, 0.0), "VERTEX")
    # At thirty pixels, as black shapes on a pale sky: do the six read apart?
    black = [[(m, np.zeros(len(m["vertices"])), turn, tip) for m in models[level]] for level, (turn, tip) in
             (("hero", poses[0]), ("hero", poses[1]), ("boulder", poses[3]), ("boulder", poses[2]), ("chip", poses[0]))]
    shoot("silhouettes-30px", black, 34, (0.62, 0.72, 0.8), "SINGLE", upscale=8)
    lit_small = lit_rows("boulder", side)[:2] + lit_rows("chip", side)[:2]
    shoot("lit-30px", lit_small, 34, (0.0, 0.0, 0.0), "VERTEX", upscale=8)
    return files


# ── Entry ─────────────────────────────────────────────────────────────────────

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    names = list(DESIGNS)
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        if a == "--preview":
            preview_dir = argv[i + 1]
        if a == "--only":
            names = [n for n in argv[i + 1].split(",") if n in DESIGNS]
    scene = bpy.data.scenes.new(SCENE)
    models, report = build(scene, names)
    if out and len(names) == len(DESIGNS):
        path = Path(out) / MODULE
        write_module(path, models, names)
        print(TAG, "wrote", path, f"{path.stat().st_size / 1024:.1f} KiB")
    elif out:
        print(TAG, "--only builds previews; the module needs every design")
    if preview_dir:
        for f in previews(scene, models, preview_dir):
            print(TAG, "preview", f)
    print(TAG, json.dumps(report))


if __name__ == "__main__":
    main()
