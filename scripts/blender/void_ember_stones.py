"""Void Ember's cinder belt: six asteroids, sculpted by script in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/void_ember_stones.py -- \
        --out src/themes/void-ember [--preview <dir>] [--only potato,shard]

The belt is the wreck of whatever once circled the ember, seen almost edge-on: its stones cross
the star's face as black shapes and stand round it as slivers of its light. So every design is
built for its SILHOUETTE first, and the six read apart at thirty pixels:

    potato   an elongated, bent body with a broad saddle crater across its waist
    binary   two lobes of unequal size joined at a smooth neck
    shard    a splinter with flat fracture faces, a chisel tip and two flake scars
    top      a spinning-top rubble pile: an equatorial ridge with boulders lying on it
    slab     a tabular piece of crust, three strata broken back to different lines
    bowl     a body with one giant bowl crater bitten out of it, a peak on its floor

Each is a signed distance field evaluated with numpy (ellipsoids, half-spaces, smooth unions and
cuts, crater bowls with raised rims, value-noise lumps and grain), polygonised with surface nets
(scripts/blender/grainfields/horse_sdf.py), centred, and scaled to a bounding radius of one. The
fine mesh is then decimated in Blender to three levels (a boulder, a stone, a piece of gravel) and
every vertex of every level is given what the theme shades it by, read from the FINE mesh:

    normal   the fine surface's normal, averaged over the vertex's neighbourhood (smooth)
    ao       ambient occlusion: cosine-weighted rays cast against the fine mesh
    crest    0 in a crevice, 0.5 on a flat, 1 on an exposed crest (where the dust lies)

The export is one module, src/themes/void-ember/void-ember-stone-models.js: base64 typed arrays,
no loader and no asset file. Deterministic: the same script and Blender write the same bytes.
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

TAG = "[void-ember-stones]"
SCENE = "VoidEmberStones"
MODULE = "void-ember-stone-models.js"

VOXEL = 0.0135
BOUND = 1.32
#: Triangles per level (a design may ask for its own), and how far a vertex's bake reaches.
LEVELS = {
    "boulder": {"triangles": 640, "reach": 0.06},
    "stone": {"triangles": 100, "reach": 0.15},
    "gravel": {"triangles": 34, "reach": 0.3},
}
#: The designs the gravel is cut from: at four pixels only "round" and "long" read apart.
GRAVEL_DESIGNS = ("potato", "shard")
QUANT = 1.0 / 16384.0
AO_RAYS = 56
AO_REACH = 1.1
#: The bake's occlusion is gentle (open bodies); the theme wants craters and necks to read.
AO_GAIN = 2.3
CAVITY_RADIUS = 0.085


# ── Noise (numpy) ─────────────────────────────────────────────────────────────

def _hash(ix, iy, iz, seed):
    mask = np.uint64(0xFFFFFFFF)
    h = ((ix & 0xFFFFFFFF).astype(np.uint64) * np.uint64(374761393)
         + (iy & 0xFFFFFFFF).astype(np.uint64) * np.uint64(668265263)
         + (iz & 0xFFFFFFFF).astype(np.uint64) * np.uint64(2246822519)
         + np.uint64((seed * 1013904223 + 12345) & 0xFFFFFFFF)) & mask
    h = ((h ^ (h >> np.uint64(13))) * np.uint64(1274126177)) & mask
    h = ((h ^ (h >> np.uint64(16))) * np.uint64(2654435761)) & mask
    h = h ^ (h >> np.uint64(15))
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


def fbm(p, seed, octaves=3, gain=0.5, lacunarity=2.07):
    total = np.zeros(len(p))
    amp = 1.0
    norm = 0.0
    q = p.copy()
    for o in range(octaves):
        total += amp * vnoise(q + 17.31 * o, seed + o * 101)
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

    def add(self, centre, radius, depth=0.3, rim=0.07):
        self.items.append((np.asarray(centre, dtype=np.float64), radius, depth, rim))

    def scatter(self, field, rng, count, radii, depth=(0.34, 0.46), avoid=()):
        placed = 0
        tries = 0
        while placed < count and tries < count * 40:
            tries += 1
            d = unit(rng.normal(size=3))
            radius = radii[0] + (radii[1] - radii[0]) * rng.random() ** 1.6
            at = land(field, d)
            clear = all(np.linalg.norm(at - c) > (r + radius) * 0.8 for c, r, _, _ in self.items)
            clear = clear and all(np.linalg.norm(at - np.asarray(c)) > r + radius for c, r in avoid)
            if not clear:
                continue
            self.add(at, radius, depth[0] + (depth[1] - depth[0]) * rng.random(), 0.07 + 0.05 * rng.random())
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
            lip = np.exp(-((r - 1.02) / 0.2) ** 2) * (1.0 - smoothstep(1.3, 1.9, r))
            out[near] += radius * (depth * bowl - rim * lip)
        return out


def grain(p, seed, scale=1.0):
    """The surface's fine relief: rubble at two scales."""
    return 0.02 * scale * fbm(p * 6.3, seed + 7, 2) + 0.009 * scale * vnoise(p * 15.0, seed + 9)


def near_surface(d, band=0.2):
    return np.abs(d) < band


# ── The six designs ───────────────────────────────────────────────────────────

def design_potato():
    rng = np.random.default_rng(1101)

    def base(p):
        q = p.copy()
        q[:, 1] += 0.2 * p[:, 0] ** 2 - 0.06
        q[:, 2] += 0.07 * np.sin(p[:, 0] * 2.2)
        d = ellipsoid(q, (0.0, 0.0, 0.0), (1.0, 0.55, 0.63))
        return d + 0.14 * fbm(p * 1.15 + 3.1, 11, 2)

    craters = Craters()
    saddle = land(base, (0.08, 1.0, 0.3))
    craters.add(saddle, 0.5, depth=0.46, rim=0.04)
    craters.add(land(base, (0.92, 0.15, -0.4)), 0.33, depth=0.44, rim=0.1)
    craters.add(land(base, (-0.55, -0.8, 0.3)), 0.35, depth=0.4, rim=0.09)
    craters.scatter(base, rng, 5, (0.14, 0.23), avoid=[(saddle, 0.42)])

    def field(p):
        d = base(p)
        m = near_surface(d)
        d[m] += craters.displace(p[m]) + grain(p[m], 13)
        return d

    return field


def design_binary():
    rng = np.random.default_rng(2303)

    def base(p):
        big = ellipsoid(p, (-0.37, -0.02, 0.0), (0.66, 0.46, 0.6)) + 0.09 * fbm(p * 1.6 + 5.0, 23, 2)
        # The small lobe sits a little askew on the big one, flattened the other way.
        q = p.copy()
        q[:, 1] = p[:, 1] * 0.94 + p[:, 2] * 0.34
        q[:, 2] = p[:, 2] * 0.94 - p[:, 1] * 0.34
        small = ellipsoid(q, (0.6, 0.1, 0.02), (0.42, 0.4, 0.31)) + 0.06 * fbm(p * 2.2 + 1.0, 29, 2)
        return smin(big, small, 0.11)

    craters = Craters()
    craters.add(land(base, (-0.75, 0.6, 0.35)), 0.32, depth=0.42, rim=0.09)
    craters.add(land(base, (1.0, 0.25, -0.3)), 0.21, depth=0.42, rim=0.1)
    craters.add(land(base, (-0.5, -0.7, -0.5)), 0.26, depth=0.4, rim=0.09)
    neck = (0.17, 0.0, 0.0)
    craters.scatter(base, rng, 5, (0.11, 0.19), avoid=[(neck, 0.3)])

    def field(p):
        d = base(p)
        m = near_surface(d)
        # The neck is the smooth, pale place where the dust has run down from both lobes.
        rough = 1.0 - 0.75 * np.exp(-((p[m, 0] - 0.17) / 0.16) ** 2)
        d[m] += craters.displace(p[m]) + grain(p[m], 31) * rough
        return d

    return field


def design_shard():
    side = []
    for angle, tilt, offset in ((18, 0.2, 0.22), (118, 0.15, 0.2), (202, 0.23, 0.19), (292, 0.18, 0.23), (66, 0.08, 0.27)):
        a = math.radians(angle)
        side.append(((tilt, math.cos(a), math.sin(a)), offset))
    cuts = side + [
        ((-1.0, 0.28, -0.16), 0.8),
        ((-0.62, -0.7, 0.34), 0.47),
        ((0.82, 0.5, 0.2), 0.72),
        ((0.55, -0.2, -0.8), 0.42),
    ]
    scars = [((0.15, 1.66, 0.45), 1.52), ((-0.35, -0.9, -1.55), 1.6)]

    def base(p):
        d = np.full(len(p), -10.0)
        for normal, offset in cuts:
            d = smax(d, plane(p, normal, offset), 0.018)
        for centre, radius in scars:
            d = smax(d, -sphere(p, centre, radius), 0.012)
        return d

    def field(p):
        d = base(p)
        m = near_surface(d)
        # Striations along the splinter's length, and very little grain: it is a clean break.
        ribs = 0.006 * np.sin(p[m, 1] * 38.0 + 4.0 * vnoise(p[m] * 2.0, 37)) * smoothstep(-0.2, 0.6, p[m, 0])
        d[m] += grain(p[m], 37, 0.45) + ribs
        return d

    return field


def design_top():
    rng = np.random.default_rng(4107)

    def base(p):
        rho = np.hypot(p[:, 0], p[:, 2])
        # Two cones base to base, their shared edge (the ridge) and their points rounded off.
        ay = np.sqrt(p[:, 1] ** 2 + 0.005)
        cone = rho * 0.6 + ay * 0.8 - 0.585
        body = smin(cone, sphere(p, (0.0, 0.0, 0.0), 0.5), 0.16)
        body = smax(body, ay - 0.52, 0.12)
        return body + 0.05 * fbm(p * 1.9 + 8.0, 41, 2)

    rocks = []
    for k in range(9):
        # Most of them lie where the slopes shed them: on the ridge. (Few and large: a small one
        # is a thorn once the mesh is decimated.)
        d = unit(rng.normal(size=3) * (1.0, 0.25 if k % 4 else 1.0, 1.0))
        radius = 0.12 + 0.09 * rng.random() ** 1.4
        at = land(base, d)
        rocks.append((at - unit(at) * radius * 0.42,
                      radius * np.array([1.0, 0.7 + 0.3 * rng.random(), 0.85 + 0.3 * rng.random()])))
    craters = Craters()
    craters.add(land(base, (0.6, 0.6, 0.42)), 0.26, depth=0.4, rim=0.09)
    craters.add(land(base, (-0.3, -0.75, 0.5)), 0.22, depth=0.38, rim=0.08)

    def field(p):
        d = base(p)
        m = near_surface(d, 0.26)
        q = p[m]
        dm = d[m] + craters.displace(q)
        for centre, radii in rocks:
            dm = smin(dm, ellipsoid(q, centre, radii), 0.045)
        d[m] = dm + grain(q, 43, 1.0)
        return d

    return field


def design_slab():
    rng = np.random.default_rng(5309)
    angles = (8, 58, 112, 168, 214, 262, 318)
    reach = (0.98, 0.72, 0.6, 0.93, 0.74, 0.58, 0.7)
    # (Overlapping: two strata that only touch leave their shared face inside the union.)
    layers = ((-0.19, -0.03), (-0.08, 0.08), (0.03, 0.18))
    setback = [[float(x) for x in rng.uniform(-0.2, 0.02, len(angles))] for _ in layers]
    # One corner of the top stratum has gone altogether: a step down, seen in profile.
    setback[2][0] -= 0.22
    setback[0][3] -= 0.2

    def warp(p):
        q = p.copy()
        q[:, 1] -= 0.11 * p[:, 0] ** 2 - 0.05 * p[:, 2] - 0.03
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
                edge = edge + 0.035 * np.sin((q[:, 2] * math.cos(a) - q[:, 0] * math.sin(a)) * 9.0 + angle)
                layer = smax(layer, edge, 0.014)
            d = smin(d, layer, 0.01)
        return d

    craters = Craters()
    for direction, radius in (((0.3, 1.0, 0.1), 0.2), ((-0.45, 1.0, -0.25), 0.13), ((0.1, -1.0, 0.2), 0.17)):
        craters.add(land(base, direction), radius, depth=0.24, rim=0.05)

    def field(p):
        d = base(p)
        m = near_surface(d)
        q = warp(p[m])
        # Old cracks across the faces: the ridges of a slow field, cut as shallow grooves.
        groove = np.maximum(0.0, 1.0 - np.abs(vnoise(q * (1.7, 0.3, 1.7) + 2.0, 53)) / 0.07)
        faces = smoothstep(0.1, 0.16, np.abs(q[:, 1]))
        d[m] += craters.displace(p[m]) + grain(p[m], 59, 0.7) + 0.022 * groove * groove * faces
        return d

    return field


def design_bowl():
    rng = np.random.default_rng(6701)
    axis = unit((0.2, 0.96, 0.18))
    side = unit(np.cross(axis, (0.0, 0.0, 1.0)))
    centre = axis * 0.56
    radius = 0.8

    def base(p):
        along = p @ axis
        d = ellipsoid(p, (0.0, 0.0, 0.0), (0.92, 0.9, 0.9)) + 0.08 * fbm(p * 1.4 + 2.0, 67, 2)
        # Half a shell: what is left of a body broken across, its break hollowed to a bowl.
        d = smax(d, along - 0.14 - 0.07 * fbm(p * 2.6 + 9.0, 73, 2), 0.05)
        hollow = sphere(p, centre, radius)
        d = smax(d, -hollow, 0.04)
        # One side of the rim has gone: a breach down to the floor.
        breach = ellipsoid(p, side * 0.86 + axis * 0.16, (0.34, 0.5, 0.26))
        d = smax(d, -breach, 0.06)
        peak = ellipsoid(p, centre - axis * (radius + 0.03), (0.2, 0.17, 0.21))
        return smin(d, peak, 0.08)

    craters = Craters()
    craters.scatter(base, rng, 6, (0.14, 0.3), avoid=[(centre, radius + 0.1)])

    def field(p):
        d = base(p)
        m = near_surface(d)
        d[m] += craters.displace(p[m]) + grain(p[m], 71)
        return d

    return field


DESIGNS = {
    "potato": design_potato,
    "binary": design_binary,
    "shard": design_shard,
    "top": design_top,
    "slab": design_slab,
    "bowl": design_bowl,
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
    vertices, triangles = surface_nets(grid, axis, axis, axis)
    return vertices, triangles


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
    keep_root = np.bincount(roots).argmax()
    keep = roots == keep_root
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
    strata), and the collapse decimator cannot go below a count that keeps every pinch.
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
    """Samples of the fine surface: where, its normal, its occlusion and how proud it stands."""

    def __init__(self, vertices, triangles):
        normals = vertex_normals(vertices, triangles)
        bvh = BVHTree.FromPolygons(vertices.tolist(), triangles.tolist())
        everything = KDTree(len(vertices))
        for i, v in enumerate(vertices):
            everything.insert(v, i)
        everything.balance()
        rng = np.random.default_rng(97)
        pick = np.sort(rng.permutation(len(vertices))[:min(len(vertices), 9000)])
        dirs = hemisphere(AO_RAYS)
        ao = np.empty(len(pick))
        crest = np.empty(len(pick))
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
            near = [j for _, j, _ in everything.find_range(p, CAVITY_RADIUS)]
            mean = vertices[near].mean(axis=0)
            # Proud of its neighbourhood (a crest) or sunk in it (a crevice).
            crest[k] = float((p - mean) @ n) / CAVITY_RADIUS
        self.points = vertices[pick]
        self.normals = normals[pick]
        self.ao = ao
        self.crest = crest
        self.tree = KDTree(len(pick))
        for k, p in enumerate(self.points):
            self.tree.insert(p, k)
        self.tree.balance()

    def at(self, vertices, reach):
        """The bake at a level's vertices: a Gaussian mean over `reach` of the fine surface."""
        normals = np.empty_like(vertices)
        ao = np.empty(len(vertices))
        crest = np.empty(len(vertices))
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
        return normals, ao, crest


#: Designs whose flat faces meet at hard edges, and the angle (degrees) past which two faces part.
CREASES = {"shard": 36.0, "slab": 44.0}
#: The levels that keep them. (A stone is ten to twenty-five pixels: the splinter's faces still
#: flash as it turns, the slab's strata do not show, and every split is a vertex in every stone.)
CREASED_LEVELS = {"shard": ("boulder", "stone"), "slab": ("boulder",)}


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
    out = {key: list(model[key]) for key in ("vertices", "normals", "ao", "crest")}
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
            out["ao"].append(model["ao"][v])
            out["crest"].append(model["crest"][v])
            for f, k in members:
                triangles[f, k] = index
    model.update({key: np.array(value) for key, value in out.items()})
    model["triangles"] = triangles
    return model


def crest_unit(crest):
    """0 in a crevice, 0.5 on a flat, 1 on a crest."""
    return np.clip(0.5 + crest * 3.2, 0.0, 1.0)


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
            if level == "gravel" and name not in GRAVEL_DESIGNS:
                continue
            vertices, triangles = decimated(scene, fine_obj, spec["triangles"])
            if signed_volume(vertices, triangles) < 0:
                triangles = triangles[:, ::-1].copy()
            normals, ao, crest = bake.at(vertices, spec["reach"])
            model = {
                "design": name,
                "vertices": vertices,
                "triangles": triangles,
                "normals": normals,
                "ao": ao,
                "crest": crest_unit(crest),
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
              f"crest p5 {np.percentile(bake.crest, 5):.3f} p95 {np.percentile(bake.crest, 95):.3f}")
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
        " * Void Ember's stones: GENERATED by scripts/blender/void_ember_stones.py (do not edit by hand).",
        " *",
        " * Six asteroids sculpted by script in Blender (signed distance fields, polygonised, decimated),",
        " * each at up to three levels: `boulder`, `stone`, `gravel`. Every model is centred, with a",
        " * bounding radius of one. `positions` are Int16 in units of `quant`; `normals` Int8 (the fine",
        " * surface's normal, smoothed, x127); `shade` Uint8 pairs (ambient occlusion, crest: 0 in a",
        " * crevice, 128 on a flat, 255 on an exposed crest), both x255; `index` Uint16 triangles, wound",
        " * counter-clockwise seen from outside.",
        " */",
        "export const VOID_EMBER_STONE_MODELS = Object.freeze({",
        f"    quant: {QUANT!r},",
        f"    designs: {json.dumps(list(names))},",
    ]
    for level in LEVELS:
        lines.append(f"    {level}: [")
        for model in models[level]:
            positions = [int(round(c / QUANT)) for v in model["vertices"] for c in v]
            normals = [int(round(max(-1.0, min(1.0, c)) * 127)) for n in model["normals"] for c in n]
            shade = []
            for ao, crest in zip(model["ao"], model["crest"]):
                shade.extend((int(round(max(0.0, min(1.0, ao)) * 255)), int(round(crest * 255))))
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

def _lit(model, light, view):
    """The theme's shading, near enough to judge the bake by: one light, AO, dust on the crests."""
    n = model["normals"]
    ndl = n @ light
    day = smoothstep(-0.05, 0.28, ndl) * (0.3 + 0.7 * np.clip(ndl, 0.0, 1.0))
    ao = model["ao"]
    albedo = 0.34 * (0.62 + 0.76 * model["crest"])
    rim = (1.0 - np.clip(n @ view, 0.0, 1.0)) ** 5
    behind = max(0.0, float(-(view @ light)))
    value = albedo * (day * (0.2 + 0.8 * ao) * 1.7 + 0.04 * ao) + rim * behind * 0.6
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
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    col = bpy.data.collections.new("VoidEmberStonesPreview")
    scene.collection.children.link(col)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.show_object_outline = False
    scene.display.render_aa = "16"
    world = bpy.data.worlds.new("VoidEmberStonesWorld")
    scene.world = world
    scene.view_settings.view_transform = "Standard"
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("VoidEmberStonesCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("VoidEmberStonesCam", cam_data)
    col.objects.link(cam)
    scene.camera = cam
    files = []

    def shoot(name, rows, pixels_per_cell, background, colour_type, upscale=1):
        """`rows` = lists of (model, colour, turn about z in degrees) laid out on a grid."""
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
        from mathutils import Matrix
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
        from mathutils import Euler
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
    shoot("boulders-side-lit", lit_rows("boulder", side), 300, (0.0, 0.0, 0.0), "VERTEX")
    shoot("boulders-back-lit", lit_rows("boulder", back), 300, (0.0, 0.0, 0.0), "VERTEX")
    shoot("stones-side-lit", lit_rows("stone", side), 200, (0.0, 0.0, 0.0), "VERTEX")
    shoot("gravel-side-lit", lit_rows("gravel", side), 200, (0.0, 0.0, 0.0), "VERTEX")
    for key in ("ao", "crest"):
        rows = [[(m, m[key], turn, tip) for m in models["boulder"]] for turn, tip in poses[:2]]
        shoot(f"boulders-{key}", rows, 300, (0.0, 0.0, 0.0), "VERTEX")
    # At the size the belt shows them, as black shapes on the star's face.
    black = [[(m, np.zeros(len(m["vertices"])), turn, tip) for m in models[level]] for level, (turn, tip) in
             (("boulder", poses[0]), ("boulder", poses[1]), ("boulder", poses[3]), ("stone", poses[0]), ("stone", poses[2]))]
    shoot("silhouettes-30px", black, 34, (1.0, 0.33, 0.04), "SINGLE", upscale=8)
    lit_small = lit_rows("boulder", side)[:2] + lit_rows("stone", side)[:2]
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
