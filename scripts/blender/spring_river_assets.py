"""Original Serenity Blocks Spring assets, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/spring_river_assets.py -- \
        --out src/themes/spring/assets [--only trees,foliage,rocks] [--preview <dir>] \
        [--recipes birch-hero,spruce-hero] [--no-bake]

A Norrland river in its spring flood. The silver birches are the Summer meadow's recipes
(scripts/blender/summer_meadow) in first leaf: they wear young "mouse-ear" sprays, small
folded leaves sparse enough that the purple-brown twigs still show through them, so a birch
reads as a green haze over its branches. The Norway spruces are the meadow's. The granite is
new: faceted boulders for the rapids and the banks, slabs for the crag the eye stands on, and
jointed cliff faces for the gorge either side of the fall. Every file is written in the
meadow's compact GLB layout (a bark mesh plus a point cloud of foliage sites per tree, shared
sprays, plain meshes whose colours carry shading data), so the theme owns every material.
Coordinates are glTF Y-up metres with each object's base at the origin.
"""

import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

import fall_grove_assets as grove  # noqa: E402
from fall_grove import glb, skeleton  # noqa: E402
from fall_grove.foliage import SprayBuilder  # noqa: E402
from fall_grove.skeleton import GOLDEN, normalize  # noqa: E402
from summer_meadow import leaves as meadow_leaves  # noqa: E402
from summer_meadow import preview, species  # noqa: E402
from summer_meadow.species import SPRUCE_GROVE_FOLIAGE, SPRUCE_HERO_FOLIAGE  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
SPRAY_VARIANTS = grove.SPRAY_VARIANTS
GENERATOR = "Serenity Blocks - Spring (Blender authoring)"
TAG = "[spring]"
FOLIAGE_FILE = "spring-foliage.glb"
ROCKS_FILE = "spring-rocks.glb"

X = np.array([1.0, 0.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])


# -- young birch sprays ----------------------------------------------------------------------
def _along(twig, t):
    """Point and unit direction at share `t` of a polyline of equal segments."""
    segments = len(twig) - 1
    scaled = min(max(t, 0.0), 1.0) * segments
    segment = min(int(scaled), segments - 1)
    local = scaled - segment
    return twig[segment] * (1.0 - local) + twig[segment + 1] * local, normalize(twig[segment + 1] - twig[segment])


def birch_young(seed, leaves=22, length=0.85, leaf_size=0.05):
    """A hanging birch twig in first leaf: small folded leaves, more of them toward the tip."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = meadow_leaves.birch_leaf(0, fold=0.34, droop=0.08)
    segments = 6
    twig = [np.zeros(3)]
    heading = normalize(np.array([rng.uniform(-0.06, 0.06), 1.0, rng.uniform(-0.06, 0.06)]))
    for _ in range(segments):
        heading = normalize(heading + np.array([rng.uniform(-0.12, 0.12), 0.0, rng.uniform(-0.12, 0.12)]))
        twig.append(twig[-1] + heading * (length / segments))
    twig = np.array(twig)
    builder.twig(twig, 0.005, sides=3, shade=0.45)
    start = rng.uniform(0, math.tau)
    for index in range(leaves):
        # The buds break first toward the shoot's tip.
        t = 0.2 + 0.8 * ((index + rng.uniform(0.2, 0.8)) / leaves) ** 0.7
        origin, forward = _along(twig, t)
        azimuth = start + index * GOLDEN + rng.uniform(-0.6, 0.6)
        radial = X * math.cos(azimuth) + Z * math.sin(azimuth)
        radial = normalize(radial - forward * float(np.dot(radial, forward)))
        axis = normalize(forward + radial * rng.uniform(0.5, 1.1))
        base = origin + normalize(forward * 0.5 + radial) * leaf_size * rng.uniform(0.15, 0.3)
        facing = normalize(Z + radial * 0.8 + rng.normal(size=3) * 0.4)
        # Young leaves: the tip ones are the newest and smallest.
        size = leaf_size * rng.uniform(0.75, 1.25) * (1.0 - 0.35 * max(0.0, t - 0.75) / 0.25)
        builder.leaf(template, base, axis, facing, size, shade=0.8 + 0.2 * rng.random(),
                     twist=rng.uniform(-0.6, 0.6), cup=rng.uniform(0.0, 0.14))
    return builder


def birch_young_strand(seed, leaves=16, leaf_size=0.075):
    """The far level of detail: a drooping twig of small plain leaves."""
    builder = SprayBuilder(seed)
    rng = builder.rng
    template = meadow_leaves.birch_leaf(1, fold=0.22, droop=0.08)
    segments = 4
    twig = [np.zeros(3)]
    heading = np.array([rng.uniform(-0.1, 0.1), 1.0, -0.05])
    for _ in range(segments):
        heading = normalize(heading + np.array([rng.uniform(-0.1, 0.1), 0.0, -0.18]))
        twig.append(twig[-1] + heading * (0.85 / segments))
    twig = np.array(twig)
    builder.twig(twig, 0.008, sides=3, shade=0.45)
    for index in range(leaves):
        t = 0.25 + 0.75 * (index + rng.uniform(0.1, 0.9)) / leaves
        origin, forward = _along(twig, t)
        side = -1.0 if index % 2 else 1.0
        axis = normalize(forward * 0.4 + np.array([side * rng.uniform(0.55, 1.0), 0.0, rng.uniform(-0.75, -0.1)]))
        facing = normalize(np.array([rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), 1.0]))
        builder.leaf(template, origin + axis * leaf_size * 0.3, axis, facing, leaf_size * rng.uniform(0.75, 1.2),
                     shade=0.82 + 0.18 * t, twist=rng.uniform(-0.6, 0.6))
    return builder


SPRAY_BUILDERS = {
    # Variant 0 is the fuller twig, variant 1 a shorter, sparser one.
    "birch_young": lambda index: birch_young(6100 + index * 13, leaves=24 if index == 0 else 18,
                                             length=0.85 if index == 0 else 0.7),
    "birch_young_strand": lambda index: birch_young_strand(6300 + index * 17),
    SPRUCE_HERO_FOLIAGE: meadow_leaves.SPRAY_BUILDERS[SPRUCE_HERO_FOLIAGE],
    SPRUCE_GROVE_FOLIAGE: meadow_leaves.SPRAY_BUILDERS[SPRUCE_GROVE_FOLIAGE],
}
# The meadow's birch sprays, as worn in spring.
SPRING_FOLIAGE = {"birch_spray": "birch_young", "birch_strand": "birch_young_strand"}
SPRAY_REACH = {"birch_young": 0.45, "birch_young_strand": 0.55, SPRUCE_HERO_FOLIAGE: 0.6, SPRUCE_GROVE_FOLIAGE: 0.62}
SPRAY_UNITS = {"birch_young": "leaves", "birch_young_strand": "leaves", SPRUCE_HERO_FOLIAGE: "shoots",
               SPRUCE_GROVE_FOLIAGE: "shoots"}
grove.SPRAY_REACH.update(SPRAY_REACH)
grove.LEAF_PREVIEW.update({
    "birch": [(0.42, 0.6, 0.12), (0.5, 0.66, 0.16), (0.36, 0.54, 0.1), (0.56, 0.7, 0.18)],
    "spruce": [(0.1, 0.2, 0.08), (0.14, 0.26, 0.09), (0.2, 0.3, 0.1), (0.12, 0.22, 0.1)],
})

RECIPES = {
    "birch-hero": lambda: species.hero_birch(9104, "birch-hero", height=15.5),
    "birch-grove-a": lambda: species.grove_birch(9212, "birch-grove-a", height=13.5),
    "birch-grove-b": lambda: species.grove_birch(9324, "birch-grove-b", height=10.5, spread=1.12, lean=(0.05, 0.0)),
    "birch-grove-c": lambda: species.grove_birch(9438, "birch-grove-c", height=15.5, forked=True, spread=0.95),
    "spruce-hero": lambda: species.spruce(9502, "spruce-hero", height=22.0, role="hero", crown_base=0.22, radius=0.38,
                                          spread=1.0, lean=(0.01, 0.0)),
    "spruce-grove-a": lambda: species.spruce(9602, "spruce-grove-a", height=18.0, crown_base=0.2),
    "spruce-grove-b": lambda: species.spruce(9720, "spruce-grove-b", height=21.0, crown_base=0.22, spread=0.9),
    "spruce-grove-c": lambda: species.spruce(9812, "spruce-grove-c", height=13.0, crown_base=0.25, spread=1.15),
}


def grow(recipe):
    """Grow one specimen in its spring dress and derive everything that needs no Blender."""
    started = time.time()
    tree = RECIPES[recipe]()
    tree.meta["foliage"] = SPRING_FOLIAGE.get(tree.meta["foliage"], tree.meta["foliage"])
    hero = tree.meta["role"] == "hero"
    bark = species.build_wood(tree, hero=hero, seed=len(recipe))
    positions = np.array([site.position for site in tree.sites])
    reach = SPRAY_REACH[tree.meta["foliage"]]
    radius = reach * float(np.mean([site.scale for site in tree.sites]))
    sky, bent = skeleton.foliage_visibility(positions, radius * 0.8, opacity=0.25)
    sky = np.clip(sky / max(1e-4, float(np.percentile(sky, 90))), 0.0, 1.0)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s %-15s branches=%4d bark_tris=%6d sites=%5d sky=%.2f..%.2f crown x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f"
          "  %.1fs" % (TAG, recipe, len(tree.branches), bark.triangles, len(tree.sites), sky.min(), sky.mean(),
                       low[0], high[0], low[1], high[1], low[2], high[2], time.time() - started), flush=True)
    return dict(tree=tree, bark=bark.arrays(), positions=positions, sky=sky, bent=bent,
                frames=grove.site_frames(tree.sites), hero=hero,
                core_indices=int(bark.core_indices or bark.triangles * 3))


def write_tree(path, grown):
    tree = grown["tree"]
    positions, normals, uvs, colors, indices = grown["bark"]
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("bark", {
        "POSITION": (positions, False),
        "NORMAL": (glb.quantize_unit(normals, np.int8), True),
        "TEXCOORD_0": (uvs.astype(np.float32), False),
        "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
    }, indices=indices)
    sites = tree.sites
    params = np.stack([np.array([site.scale for site in sites]) / SCALE_RANGE, grown["sky"],
                       np.clip([site.sway for site in sites], 0.0, 1.0), [site.phase for site in sites]], axis=1)
    bent = np.concatenate([grown["bent"], (np.array([[site.hue] for site in sites]) * 2.0 - 1.0)], axis=1)
    kind = np.array([[site.variant, site.branch_level, 0, 0] for site in sites], dtype=np.uint8)
    writer.add_mesh("sites", {
        "POSITION": (grown["positions"], False),
        "_ROT": (glb.quantize_unit(grove.quaternions(grown["frames"]), np.int16), True),
        "_PARAMS": (glb.quantize_unit(params, np.uint8), True),
        "_BENT": (glb.quantize_unit(bent, np.int8), True),
        "_KIND": (kind, False),
    }, mode=0)
    low, high = tree.bounds()
    envelope = tree.envelope
    writer.set_extras(dict(
        schemaVersion=SCHEMA_VERSION, name=tree.name, **tree.meta,
        scaleRange=SCALE_RANGE, sites=len(sites), barkTriangles=int(len(indices) // 3),
        barkCoreIndices=int(grown["core_indices"]),
        crownCentre=[float(v) for v in envelope.centre], crownRadii=[float(v) for v in envelope.radii],
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


def write_foliage(path, built):
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, (builder, arrays) in built.items():
        positions, normals, uvs, colors, indices = arrays
        extras = {SPRAY_UNITS[name.rsplit("_", 1)[0]]: builder.leaves, "triangles": builder.triangles}
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=extras)
        summary[name] = extras
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, variants=SPRAY_VARIANTS, meshes=summary))
    return writer.write(path), summary


# -- granite ---------------------------------------------------------------------------------
def _icosphere(detail):
    """Unit icosphere: vertices (n, 3) and triangles (m, 3), wound outward."""
    t = (1.0 + 5 ** 0.5) / 2.0
    verts = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
             (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
             (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11),
             (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    verts = [np.array(v, dtype=float) / np.linalg.norm(v) for v in verts]
    for _ in range(detail):
        cache = {}
        nxt = []

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                m = verts[a] + verts[b]
                verts.append(m / np.linalg.norm(m))
                cache[key] = len(verts) - 1
            return cache[key]

        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nxt += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = nxt
    return np.array(verts), np.array(faces, dtype=np.int64)


def _noise3(p, seed):
    """Smooth value noise in 3D (numpy, per point), roughly in [-1, 1]."""
    rng = np.random.default_rng(seed)
    table = rng.random(4096)

    def hash3(i, j, k):
        h = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791)
        return table[np.abs(h) % 4096]

    i0 = np.floor(p).astype(np.int64)
    f = p - i0
    u = f * f * (3.0 - 2.0 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * hash3(i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz)
    return out * 2.0 - 1.0


def _fbm3(p, seed, octaves=4):
    total = 0.0
    amp = 0.5
    norm = 0.0
    for octave in range(octaves):
        total = total + amp * _noise3(p * (2.03 ** octave), seed + octave * 7)
        norm += amp
        amp *= 0.5
    return total / norm


def _vertex_normals(positions, faces):
    normals = np.zeros_like(positions)
    a, b, c = positions[faces[:, 0]], positions[faces[:, 1]], positions[faces[:, 2]]
    face_n = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(normals, faces[:, k], face_n)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)


def granite(seed, size=(2.0, 1.3, 1.7), facets=7, detail=4, bury=0.2):
    """A granite block: the shape a few fracture planes leave, its edges worn round by noise.

    Colours: R = pale lichen (where the stone is up and open), G = moss (up-facing, low and
    damp), B = ambient occlusion (baked afterwards), A = a per-stone tone.
    """
    rng = np.random.default_rng(seed)
    dirs, faces = _icosphere(detail)
    # Fracture planes: random normals; each cuts the unit ball at its own depth.
    normals = rng.normal(size=(facets, 3))
    normals[:, 1] *= 0.7
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    depths = rng.uniform(0.62, 0.92, size=facets)
    # Radius along each direction: the nearest plane (a convex block), softened.
    cos = dirs @ normals.T
    hits = np.where(cos > 0.05, depths[None, :] / np.maximum(cos, 0.05), 10.0)
    k = 14.0
    r = -np.log(np.sum(np.exp(-k * hits), axis=1) + np.exp(-k * 1.0)) / k
    r = np.minimum(r, 1.0)
    p = dirs * r[:, None]
    p += dirs * (0.06 * _fbm3(dirs * 2.2, seed + 1) + 0.025 * _fbm3(dirs * 7.0, seed + 2))[:, None]
    positions = p * np.array(size)[None, :] * 0.5
    # Sit it in the ground: flatten the underside and drop it `bury` of its height.
    floor = -size[1] * 0.5 * (1.0 - 2.0 * bury)
    positions[:, 1] = np.maximum(positions[:, 1], floor)
    positions[:, 1] -= floor
    vnormals = _vertex_normals(positions, faces)
    up = np.clip(vnormals[:, 1], 0.0, 1.0)
    lichen = np.clip(0.5 + 0.9 * _fbm3(positions * 1.7, seed + 3) + 0.3 * up, 0.0, 1.0)
    moss = np.clip(up * (1.0 - positions[:, 1] / max(size[1], 1e-3)) * (0.6 + 0.8 * _fbm3(positions * 2.4, seed + 4)), 0.0, 1.0)
    tone = np.full(len(positions), rng.uniform(0.3, 0.9))
    colors = np.stack([lichen, moss, np.ones(len(positions)), tone], axis=1)
    uvs = np.stack([positions[:, 0] + positions[:, 2], positions[:, 1]], axis=1) / 4.0
    return positions, vnormals, uvs, colors, faces.reshape(-1)


def cliff(seed, width=14.0, height=9.0, depth=3.0, columns=46, rows=34):
    """A jointed granite face: a grid pushed out and back by vertical joints and ledges."""
    rng = np.random.default_rng(seed)
    u = np.linspace(0.0, 1.0, columns + 1)
    v = np.linspace(0.0, 1.0, rows + 1)
    uu, vv = np.meshgrid(u, v)
    x = (uu - 0.5) * width
    y = vv * height
    # Joints: blocks of random width, each standing a little forward or back.
    cuts = np.sort(rng.uniform(0.0, 1.0, size=7))
    block = np.searchsorted(cuts, uu)
    offsets = rng.uniform(-0.45, 0.45, size=len(cuts) + 1)[block]
    ledges = 0.25 * np.floor(vv * rng.uniform(3.0, 5.0)) * rng.uniform(-1, 1)
    pts = np.stack([x, y, np.zeros_like(x)], axis=2).reshape(-1, 3)
    bulge = depth * (0.35 * offsets.reshape(-1) + 0.12 * ledges.reshape(-1)
                     + 0.25 * _fbm3(pts * np.array([0.35, 0.25, 0.35]), seed + 1)
                     + 0.08 * _fbm3(pts * 1.4, seed + 2))
    # Lean back as it rises, and round the base into the scree.
    pts[:, 2] = bulge - 0.12 * pts[:, 1] + 0.6 * np.exp(-pts[:, 1] / 0.8)
    positions = pts
    faces = []
    for j in range(rows):
        for i in range(columns):
            a = j * (columns + 1) + i
            b = a + 1
            c = a + columns + 1
            d = c + 1
            faces += [(a, b, d), (a, d, c)]
    faces = np.array(faces, dtype=np.int64)
    vnormals = _vertex_normals(positions, faces)
    up = np.clip(vnormals[:, 1], 0.0, 1.0)
    lichen = np.clip(0.45 + 0.8 * _fbm3(positions * 0.9, seed + 3), 0.0, 1.0)
    moss = np.clip(up * (0.5 + 0.9 * _fbm3(positions * 1.3, seed + 4)), 0.0, 1.0)
    tone = np.clip(0.55 + 0.4 * _fbm3(positions * 0.2, seed + 5), 0.0, 1.0)
    colors = np.stack([lichen, moss, np.ones(len(positions)), tone], axis=1)
    uvs = np.stack([positions[:, 0], positions[:, 1]], axis=1) / 4.0
    return positions, vnormals, uvs, colors, faces.reshape(-1)


ROCK_BUILDERS = {
    "boulder_0": lambda: granite(7101, size=(2.2, 1.4, 1.8), facets=7),
    "boulder_1": lambda: granite(7203, size=(1.6, 1.1, 1.5), facets=6),
    "boulder_2": lambda: granite(7307, size=(3.0, 1.6, 2.3), facets=8),
    "boulder_3": lambda: granite(7411, size=(1.2, 0.9, 1.1), facets=6, detail=3),
    "boulder_4": lambda: granite(7513, size=(2.6, 1.9, 2.0), facets=9),
    "slab_0": lambda: granite(7617, size=(7.0, 1.4, 5.0), facets=6, bury=0.45),
    "slab_1": lambda: granite(7719, size=(5.0, 1.1, 4.0), facets=7, bury=0.45),
    "cliff_0": lambda: cliff(7821),
    "cliff_1": lambda: cliff(7923, width=11.0, height=12.0),
}


def bake_rock_ao(studio, name, arrays):
    """Cycles ambient occlusion into the blue channel, over a floor."""
    import bpy
    positions, normals, uvs, colors, indices = arrays
    obj = studio.mesh_object("rock_" + name, positions, np.asarray(indices).reshape(-1, 3))
    extent = 40.0
    floor = studio.mesh_object("rock_floor", np.array(
        [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
        np.array([[0, 2, 1], [0, 3, 2]]))
    try:
        ao = np.clip(studio.bake_vertex_ao(obj, distance=2.0, samples=128), 0.0, 1.0)
    finally:
        for other in (obj, floor):
            mesh = other.data
            bpy.data.objects.remove(other, do_unlink=True)
            bpy.data.meshes.remove(mesh)
    colors = colors.copy()
    colors[:, 2] = np.clip(0.12 + 0.88 * ao, 0.0, 1.0)
    return positions, normals, uvs, colors, indices


def write_rocks(path, built):
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, arrays in built.items():
        positions, normals, uvs, colors, indices = arrays
        low, high = positions.min(axis=0), positions.max(axis=0)
        record = dict(triangles=int(len(indices) // 3), vertices=int(len(positions)),
                      boundsMin=[round(float(v), 4) for v in low], boundsMax=[round(float(v), 4) for v in high])
        writer.add_mesh(name, {
            "POSITION": (positions.astype(np.float32), False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (uvs.astype(np.float32), False),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=np.asarray(indices, dtype=np.uint32), extras=record)
        summary[name] = record
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, meshes=summary))
    return writer.write(path), summary


# -- the pack --------------------------------------------------------------------------------
def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None):
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Spring - Atelier"
    studio_module.PREFIX = "SSPRING_"
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "foliage", "rocks"))
    if preview_dir:
        preview_dir = Path(preview_dir).expanduser().resolve()
        preview_dir.mkdir(parents=True, exist_ok=True)
    records = []
    studio = studio_module.Studio()
    try:
        if preview_dir:
            studio.setup_preview(sun_direction=(-0.55, 0.42, 0.62), sun_strength=5.0, sky=(0.52, 0.6, 0.74),
                                 sky_strength=0.9)
        built = {}
        for kind, build in SPRAY_BUILDERS.items():
            for variant in range(SPRAY_VARIANTS):
                builder = build(variant)
                built["%s_%d" % (kind, variant)] = (builder, builder.arrays())
        sprays = {name: arrays for name, (_builder, arrays) in built.items()}
        if "foliage" in wanted:
            path = output_dir / FOLIAGE_FILE
            _size, summary = write_foliage(path, built)
            records.append(grove.file_record(path, kind="foliage", meshes=summary))
            print(TAG, "foliage", json.dumps(summary), flush=True)
        if "rocks" in wanted:
            rocks = {}
            for name, build in ROCK_BUILDERS.items():
                started = time.time()
                arrays = build()
                if bake:
                    arrays = bake_rock_ao(studio, name, arrays)
                rocks[name] = arrays
                print("%s rock %-9s tris=%6d  %.1fs" % (TAG, name, len(arrays[4]) // 3, time.time() - started),
                      flush=True)
            path = output_dir / ROCKS_FILE
            _size, summary = write_rocks(path, rocks)
            records.append(grove.file_record(path, kind="rocks", meshes=summary))
        if "trees" in wanted:
            for recipe in (recipes or RECIPES):
                grown = grow(recipe)
                if bake:
                    grove.bake_bark_ao(studio, grown)
                tree = grown["tree"]
                path = output_dir / ("%s.glb" % recipe)
                write_tree(path, grown)
                records.append(grove.file_record(path, kind="tree", species=tree.meta["species"],
                                                 role=tree.meta["role"], sites=len(tree.sites),
                                                 barkTriangles=int(len(grown["bark"][4]) // 3)))
                if preview_dir:
                    preview.tree(studio, grown, sprays, preview_dir / ("%s.png" % recipe))
    finally:
        studio.dispose()
    return dict(schemaVersion=SCHEMA_VERSION, author="Serenity Blocks original procedural Blender authoring",
                license="MIT-project-local", glTFUpAxis="Y", assets=records)


def _main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {"out": None, "only": None, "preview": None, "recipes": None, "no-bake": False}
    index = 0
    while index < len(arguments):
        key = arguments[index].lstrip("-")
        if key == "no-bake":
            options[key] = True
            index += 1
        else:
            options[key] = arguments[index + 1]
            index += 2
    if not options["out"]:
        raise SystemExit("usage: blender -b --factory-startup --python spring_river_assets.py -- --out <dir>")
    started = time.time()
    manifest = build_assets(options["out"], only=options["only"].split(",") if options["only"] else None,
                            preview_dir=options["preview"], bake=not options["no-bake"],
                            recipes=options["recipes"].split(",") if options["recipes"] else None)
    manifest_path = Path(options["out"]) / "asset-manifest.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"assets": []}
    merged = {entry["file"]: entry for entry in previous.get("assets", [])}
    merged.update({entry["file"]: entry for entry in manifest["assets"]})
    manifest["assets"] = [merged[name] for name in sorted(merged)]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("%s wrote %d assets, %.1f KB in %.0f s" % (TAG, len(manifest["assets"]),
                                                    sum(a["bytes"] for a in manifest["assets"]) / 1024,
                                                    time.time() - started))


if __name__ == "__main__":
    _main()
