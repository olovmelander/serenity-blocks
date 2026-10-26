"""Winter's polar bear: modelled procedurally in Blender, round the joints of the theme's rig.

Run by scripts/winter/model-bear.mjs, which hands it the skeleton (src/themes/winter/winter-bear-rig.js)
as JSON, then skins what it writes to that skeleton and writes the asset:

    node scripts/winter/model-bear.mjs [--preview=<dir>]

or by hand (headless; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/winter_polar_bear.py -- \
        --skeleton <bones.json> --out <polar-bear-mesh.glb> [--preview <dir>]

The bear walks the frozen lake fifty to a hundred metres from the viewer, so what has to read is
its silhouette and its colour: a long, heavy body whose rump stands higher than its shoulders, a
long neck carrying a small, narrow head low, a Roman nose, small round ears set far back, thick
columns of legs ending in great flat paws, long hair hanging from the belly and the backs of the
forelegs, a stub of a tail. A big male: 1.32 m at the shoulder, 2.6 m from nose to tail.

How it is made (the meshing is the Grainfields horse's, scripts/blender/grainfields/horse_sdf.py):

- **Shape.** A signed distance field of ellipsoids and round cones joined by smooth unions: chest,
  withers, barrel, the hanging fur of the belly, haunches, rump, shoulder blades and thighs; the
  neck; the head as cranium, cheeks, a muzzle under a convex bridge, the nose pad, the lower jaw,
  small round ears and the eyes' brows; each leg a tube through its own joints (shoulder, elbow,
  wrist; hip, knee, heel), the long hair behind the forearm, a broad forepaw turned a little in, a
  long hind foot. The coat is lumpy: a few centimetres of tufted displacement over the whole.
- **Mesh.** The field's left half is sampled on a 1 cm grid, polygonised with surface nets,
  projected onto the zero set, decimated in Blender with a quadric edge collapse, cleaned of folds
  and mirrored, so the bear is exactly symmetric.
- **Parts.** Which part each vertex belongs to (body, head and neck, each leg, tail), by the
  nearest primitive, cleaned into one piece each: the skinning step weights by it.
- **Paint.** COLOR_0 = (pad, fur length, dark, sky seen): the black pads of the soles; how long
  the hair is (short on the face and the paws, long under the belly and behind the forelegs); the
  black nose, the eyes and the lips; ambient occlusion traced through the field.

Frame: metres, +z forward (toward the head), +y up, the paws on y = 0, the body centred on x = 0;
the bear faces +z, so its left side is +x. No external asset is used: the field is the model.
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

from grainfields.horse_sdf import (  # noqa: E402
    Displace, Ellipsoid, HalfSpace, RoundCone, Tube, Union, X_AXIS,
    _grid, _neighbours, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)

TAG = "[winter-bear]"
GENERATOR = "Serenity Blocks - Winter polar bear (scripts/blender/winter_polar_bear.py)"
VOXEL = 0.01
TARGET_TRIANGLES = 6400
PARTS = {"body": 0, "head": 1, "frontLeft": 2, "frontRight": 3, "hindLeft": 4, "hindRight": 5, "tail": 6}


def P(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


def _lumps(x, y, z):
    """Tufts in the coat: a few octaves of interfering waves, about -1..1."""
    return (0.5 * np.sin(x * 23.0 + 1.3 * np.sin(z * 9.0)) * np.sin(y * 19.0 + 0.7) * np.sin(z * 17.0 + x * 5.0)
            + 0.3 * np.sin(x * 47.0 + y * 31.0) * np.sin(z * 41.0 - y * 13.0)
            + 0.2 * np.sin(y * 71.0 + z * 29.0) * np.sin(x * 63.0 + 2.1))


# -- the bear -----------------------------------------------------------------------------
def design(J, M):
    """The bear as a distance field round the rig's joints `J` and marks `M`, and its landmarks."""
    # The trunk: chest, withers, barrel, the belly's hanging fur, haunches and rump; shoulder
    # blades and thighs swell its flanks. The back runs level from the withers and rises to a rump
    # a little higher than the shoulders.
    body = Union([
        Ellipsoid(P(0, 0.97, 0.36), (0.29, 0.36, 0.40)),
        (Ellipsoid(P(0, 1.10, 0.33), (0.24, 0.22, 0.30)), 0.12),
        Ellipsoid(P(0, 0.93, -0.12), (0.37, 0.37, 0.56)),
        (Ellipsoid(P(0, 0.71, -0.10), (0.29, 0.17, 0.47)), 0.1),
        Ellipsoid(P(0, 1.00, -0.60), (0.35, 0.38, 0.38)),
        (Ellipsoid(P(0, 1.16, -0.56), (0.26, 0.21, 0.33)), 0.12),
        *[(Ellipsoid(P(0.19 * s, 1.05, 0.45), (0.13, 0.25, 0.19), along=(0.0, 1.0, 0.35)), 0.1) for s in (1, -1)],
        *[(Ellipsoid(P(0.22 * s, 0.86, -0.62), (0.15, 0.30, 0.25), along=(0.0, 1.0, 0.25)), 0.1) for s in (1, -1)],
    ], k=0.16).tag(PARTS["body"])

    # The neck: long and thick, out of the chest and down a little to the back of the skull.
    neck = Tube([P(0, 1.05, 0.52), P(0, 1.07, 0.76), P(0, 1.035, 0.95), P(0, 1.01, 1.08)],
                [0.28, 0.225, 0.172, 0.138], squash_axis=X_AXIS, squash=[0.9, 0.88, 0.86, 0.88], k=0.04)
    # The head: small and long, a flat skull standing a little proud of the neck, a Roman nose
    # falling to the black pad, the lower jaw under it, small round ears far back and wide.
    nose = np.asarray(M["nose"], dtype=np.float64)
    head = Union([
        Ellipsoid(P(0, 1.055, 1.16), (0.132, 0.115, 0.155)),
        Ellipsoid(P(0, 0.975, 1.21), (0.132, 0.10, 0.12)),
        RoundCone(P(0, 1.0, 1.27), nose + P(0, 0.0, -0.05), 0.094, 0.05, (X_AXIS, 0.92)),
        Ellipsoid(P(0, 1.01, 1.37), (0.066, 0.055, 0.135), along=(0.0, -0.3, 1.0)),
        Ellipsoid(nose + P(0, -0.004, -0.028), (0.043, 0.034, 0.03)),
        RoundCone(P(0, 0.925, 1.19), P(0, 0.885, 1.43), 0.084, 0.04),
    ], k=0.05)
    ears = Union([
        Ellipsoid(np.asarray(M["ear"], dtype=np.float64) * np.array([s, 1.0, 1.0]), (0.05, 0.052, 0.028),
                  along=(0.0, 0.3, 1.0))
        for s in (1, -1)
    ])
    head_part = Union([(neck, 0.0), (head, 0.06), (ears, 0.025)]).tag(PARTS["head"])

    def front(side):
        s = 1.0 if side == "L" else -1.0
        shoulder, elbow, wrist = J["arm" + side], J["fore" + side], J["hand" + side]
        paw = np.asarray(M["paw" + ("FL" if side == "L" else "FR")], dtype=np.float64)
        return Union([
            Tube([shoulder + P(0, 0.04, 0.02), elbow], [0.165, 0.13]),
            # The forearm, deepest behind where the long hair hangs from it.
            Tube([elbow, (elbow + wrist) * 0.5 + P(0, 0, 0.005), wrist], [0.13, 0.112, 0.09],
                 squash_axis=(0.0, 0.0, 1.0), squash=[1.0, 1.12, 1.0]),
            (Ellipsoid(elbow * 0.55 + wrist * 0.45 + P(0.0, 0.0, -0.035), (0.09, 0.2, 0.09), along=(0.0, 1.0, -0.12)),
             0.09),
            # The forepaw: a broad round pad, turned a little in, its toes a lip of hair.
            (Ellipsoid(paw + P(-0.005 * s, 0.058, -0.06), (0.118, 0.07, 0.155), along=(-0.16 * s, 0.0, 1.0)), 0.09),
            (Ellipsoid(paw + P(-0.012 * s, 0.035, 0.02), (0.1, 0.045, 0.07), along=(-0.16 * s, 0.0, 1.0)), 0.03),
        ], k=0.07).tag(PARTS["frontLeft" if side == "L" else "frontRight"])

    def hind(side):
        s = 1.0 if side == "L" else -1.0
        hip, knee, heel = J["thigh" + side], J["shin" + side], J["hock" + side]
        paw = np.asarray(M["paw" + ("BL" if side == "L" else "BR")], dtype=np.float64)
        return Union([
            Tube([hip + P(-0.01 * s, -0.04, 0.0), knee], [0.2, 0.14]),
            Tube([knee, (knee + heel) * 0.5 + P(0, 0, -0.015), heel], [0.14, 0.11, 0.085]),
            (Ellipsoid(heel + P(0, -0.035, -0.03), (0.075, 0.07, 0.065)), 0.03),
            # The long hind foot, flat from the heel to the toes.
            (Ellipsoid(paw + P(0, 0.052, -0.06), (0.1, 0.06, 0.2), along=(-0.08 * s, 0.0, 1.0)), 0.05),
        ], k=0.07).tag(PARTS["hindLeft" if side == "L" else "hindRight"])

    legs = [front("L"), front("R"), hind("L"), hind("R")]
    tail = Ellipsoid(P(0, 1.04, -1.02), (0.065, 0.075, 0.09), along=(0.0, -0.45, -1.0)).tag(PARTS["tail"])

    whole = Union([(body, 0.0), (head_part, 0.12), *[(leg, 0.1) for leg in legs], (tail, 0.06)])
    coat = Displace(whole, 0.007, _lumps)
    root = HalfSpace(coat, axis=1)
    landmarks = dict(
        nose=nose,
        eyes=[np.asarray(M["eye"], dtype=np.float64) * np.array([s, 1.0, 1.0]) for s in (1, -1)],
        # Between the neck and the body the boundary is a plane from the withers down to the
        # front of the chest: (y, z) pairs.
        neckBase=((1.32, 0.56), (0.78, 0.78)),
        frontCut=0.82,      # a foreleg's part ends at about the elbow's top
        hindCut=0.84,       # a hind leg's at the stifle
    )
    return root, whole, landmarks


# -- parts, occlusion and paint ----------------------------------------------------------
def _clean_parts(parts, neighbours, passes=3):
    """Vote away stray vertices, then keep each part to one connected region."""
    parts = parts.copy()
    for _ in range(passes):
        updated = parts.copy()
        for vertex, around in enumerate(neighbours):
            if not len(around):
                continue
            values, counts = np.unique(parts[around], return_counts=True)
            if np.count_nonzero(parts[around] == parts[vertex]) * 3 < len(around):
                updated[vertex] = values[np.argmax(counts)]
        parts = updated
    for part in np.unique(parts):
        seen = np.zeros(len(parts), dtype=bool)
        regions = []
        for start in np.nonzero(parts == part)[0]:
            if seen[start]:
                continue
            region, stack = [], [start]
            seen[start] = True
            while stack:
                vertex = stack.pop()
                region.append(vertex)
                for other in neighbours[vertex]:
                    if not seen[other] and parts[other] == part:
                        seen[other] = True
                        stack.append(other)
            regions.append(region)
        regions.sort(key=len, reverse=True)
        for region in regions[1:]:
            around = np.concatenate([neighbours[v] for v in region])
            around = around[parts[around] != part]
            if len(around):
                values, counts = np.unique(parts[around], return_counts=True)
                parts[region] = values[np.argmax(counts)]
    return parts


def regions(shape, landmarks, positions, triangles):
    """Which part each vertex belongs to, by the nearest primitive (cleaned into one piece each)."""
    leaves = shape.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    leaf_parts = np.array([leaf.part for leaf in leaves])
    y = positions[:, 1]
    claim = distances.copy()
    for column, part in enumerate(leaf_parts):
        if part in (PARTS["frontLeft"], PARTS["frontRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["frontCut"])
        elif part in (PARTS["hindLeft"], PARTS["hindRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["hindCut"])
    parts = leaf_parts[np.argmin(claim, axis=1)]
    # A leg is its own side's.
    left = positions[:, 0] >= 0.0
    parts = np.where((parts == PARTS["frontRight"]) & left, PARTS["frontLeft"], parts)
    parts = np.where((parts == PARTS["frontLeft"]) & ~left, PARTS["frontRight"], parts)
    parts = np.where((parts == PARTS["hindRight"]) & left, PARTS["hindLeft"], parts)
    parts = np.where((parts == PARTS["hindLeft"]) & ~left, PARTS["hindRight"], parts)
    # Between the neck and the body the boundary is the plane at the base of the neck.
    (top_y, top_z), (low_y, low_z) = landmarks["neckBase"]
    ahead = (positions[:, 1] - top_y) * (low_z - top_z) + (positions[:, 2] - top_z) * (top_y - low_y) > 0.0
    trunk = np.isin(parts, (PARTS["body"], PARTS["head"]))
    parts = np.where(trunk, np.where(ahead, PARTS["head"], PARTS["body"]), parts)
    parts = _clean_parts(parts, _neighbours(len(positions), triangles))
    return parts, distances


def occlusion(shape, positions, normals, rays=32, reach=1.0, ground=0.65):
    """The share of the sky over each vertex that the bear (and, partly, the ice under it) hides, by
    rays sphere-traced through the field over a cosine-weighted hemisphere."""
    count = len(positions)
    k = np.arange(rays) + 0.5
    r = np.sqrt(k / rays)
    phi = k * math.pi * (3.0 - math.sqrt(5.0))
    local = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1.0 - r * r)], axis=1)
    helper = np.where(np.abs(normals[:, 1:2]) < 0.9, np.array([[0.0, 1.0, 0.0]]), np.array([[1.0, 0.0, 0.0]]))
    tangent = np.cross(helper, normals)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1), 1e-9)[:, None]
    bitangent = np.cross(normals, tangent)
    seen = np.zeros(count)
    start = positions + normals * 0.006
    for d in local:
        direction = tangent * d[0] + bitangent * d[1] + normals * d[2]
        down = direction[:, 1] < -1e-6
        t_ground = np.where(down, start[:, 1] / np.maximum(-direction[:, 1], 1e-6), np.inf)
        t = np.full(count, 0.015)
        alive = np.ones(count, dtype=bool)
        blocked = np.zeros(count)
        for _ in range(30):
            if not alive.any():
                break
            index = np.nonzero(alive)[0]
            p = start[index] + direction[index] * t[index, None]
            field = shape.eval(p)
            hit = field < 0.003
            blocked[index[hit]] = 1.0
            t[index] += np.maximum(field, 0.008)
            grounded = ~hit & (t[index] >= t_ground[index]) & (t_ground[index] < reach)
            blocked[index[grounded]] = ground
            alive[index[hit | grounded]] = False
            alive &= t < reach
        seen += 1.0 - blocked
    return np.clip(seen / rays, 0.0, 1.0)


def paint(shape, whole, landmarks, positions, normals, parts):
    """COLOR_0 = (pad, fur length, dark, sky seen), each 0..1."""
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    legs = np.isin(parts, (PARTS["frontLeft"], PARTS["frontRight"], PARTS["hindLeft"], PARTS["hindRight"]))
    # The soles: black pads under the paws (the forepaw's toes and palm, the hind foot's length).
    pad = legs * _smoothstep(0.035, 0.008, y) * _smoothstep(-0.2, -0.75, normals[:, 1])
    # The nose, the eyes and a dark line of lip.
    nose = landmarks["nose"]
    to_nose = np.linalg.norm((positions - nose) * np.array([1.0, 1.2, 0.85]), axis=1)
    eyes = np.min([np.linalg.norm((positions - eye) * np.array([1.0, 1.3, 0.75]), axis=1)
                   for eye in landmarks["eyes"]], axis=0)
    lip = (parts == PARTS["head"]) * _smoothstep(0.02, 0.006, np.abs(y - (0.905 - 0.12 * (z - 1.3)))) \
        * _smoothstep(1.3, 1.36, z) * _smoothstep(0.05, 0.02, np.abs(np.abs(x) - 0.042))
    dark = np.maximum.reduce([_smoothstep(0.05, 0.03, to_nose), _smoothstep(0.022, 0.012, eyes), lip * 0.7])
    # Hair: short on the face and the paws, longer on the body, longest hanging under the belly,
    # behind the forelegs and over the haunches.
    head = parts == PARTS["head"]
    face = head * _smoothstep(1.12, 1.3, z)
    belly = (parts == PARTS["body"]) * _smoothstep(0.8, 0.6, y)
    behind = np.isin(parts, (PARTS["frontLeft"], PARTS["frontRight"])) * _smoothstep(0.0, -0.6, normals[:, 2]) \
        * _smoothstep(0.15, 0.3, y)
    haunch = (parts == PARTS["body"]) * _smoothstep(-0.4, -0.8, z) * _smoothstep(0.75, 0.95, y)
    fur = 0.55 + 0.45 * np.maximum.reduce([belly, behind, haunch * 0.7])
    fur = fur * (1.0 - 0.55 * face) * (1.0 - 0.5 * legs * _smoothstep(0.2, 0.05, y))
    fur = fur * (0.85 + 0.15 * _lumps(x * 1.7, y * 1.7, z * 1.7)) * (1.0 - dark)
    sky = occlusion(whole, positions, normals)
    print("%s paint: dark %d verts, pads %d, sky seen %.2f..%.2f (mean %.2f)" % (
        TAG, int((dark > 0.5).sum()), int((pad > 0.5).sum()), sky.min(), sky.max(), sky.mean()), flush=True)
    return np.stack([pad, np.clip(fur, 0.0, 1.0), dark, sky], axis=1)


# -- building it ---------------------------------------------------------------------------
class Bear:
    def __init__(self, positions, normals, colors, triangles, parts, stats):
        self.positions, self.normals, self.colors = positions, normals, colors
        self.triangles, self.parts, self.stats = triangles, parts, stats

    def measures(self):
        body = self.positions[self.parts == PARTS["body"]]
        shoulders = body[(body[:, 2] > 0.2) & (body[:, 2] < 0.5)]
        rump = body[body[:, 2] < -0.4]
        return dict(shoulderHeight=float(shoulders[:, 1].max()), rumpHeight=float(rump[:, 1].max()),
                    length=float(np.ptp(self.positions[:, 2])), width=float(np.ptp(self.positions[:, 0])),
                    height=float(self.positions[:, 1].max()))


def build(studio, skeleton, voxel=VOXEL, target=TARGET_TRIANGLES):
    """Polygonise and decimate the left half, mirror it, then sort it into parts and paint it."""
    started = time.time()
    J = {bone[0]: np.array(bone[2:5], dtype=np.float64) for bone in skeleton["bones"]}
    M = skeleton["marks"]
    shape, whole, landmarks = design(J, M)
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    sampled = time.time()
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    netted = time.time()
    positions, triangles = decimate(studio, dense, dense_triangles, target // 2)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    # The soles are flat on the ice: their normals point straight down.
    normals[positions[:, 1] <= 1e-6] = np.array([0.0, -1.0, 0.0])
    parts, _distances = regions(whole, landmarks, positions, triangles)
    colors = paint(shape, whole, landmarks, positions, normals, parts)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_triangles=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=folds, mesh_normals=int(disagree.sum()),
                 field_s=sampled - started, nets_s=netted - sampled, total_s=time.time() - started)
    bear = Bear(positions, normals, colors, triangles, parts, stats)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s grid %s dense %d tris -> mirrored %d tris %d verts (%d folds, %d mesh normals); "
          "x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s; parts %s; field %.1fs nets %.1fs total %.1fs" % (
              TAG, "x".join(str(n) for n in stats["grid"]), stats["dense_triangles"], stats["triangles"],
              stats["vertices"], folds, stats["mesh_normals"], low[0], high[0], low[1], high[1], low[2], high[2],
              {key: round(value, 3) for key, value in bear.measures().items()},
              {name: int((parts == index).sum()) for name, index in PARTS.items()},
              stats["field_s"], stats["nets_s"], stats["total_s"]), flush=True)
    return bear


def write(path, bear):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("polar-bear", {
        "POSITION": (bear.positions, False),
        "NORMAL": (bear.normals.astype(np.float32), False),
        "COLOR_0": (glb.quantize_unit(bear.colors, np.uint8), True),
        "_PART": (bear.parts.astype(np.uint8), False),
    }, indices=bear.triangles, position_bits=32)
    writer.set_extras(dict(
        name="polar-bear", parts=PARTS, **{key: round(value, 4) for key, value in bear.measures().items()},
        triangles=int(len(bear.triangles)), vertices=int(len(bear.positions)),
        color={"r": "pad (the black soles)", "g": "fur length", "b": "dark (nose, eyes, lips)", "a": "sky seen"},
    ))
    return writer.write(path)


# -- previews (never shipped) -------------------------------------------------------------
PART_COLOURS = np.array([
    [0.85, 0.82, 0.74], [0.95, 0.55, 0.35], [0.3, 0.6, 0.95], [0.25, 0.85, 0.6],
    [0.85, 0.35, 0.8], [0.9, 0.85, 0.25], [0.6, 0.3, 0.2],
])


def previews(bear, directory):
    import bpy
    from mathutils import Vector
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    started = time.time()
    lights = []

    def bear_object(name, colours):
        obj = studio.mesh_object(name, bear.positions, bear.triangles, colors=colours)
        obj.data.normals_split_custom_set_from_vertices([tuple(n) for n in to_blender(bear.normals)])
        obj.data.materials.append(studio.material(name, roughness=0.8))
        return obj

    def sky(colour, strength):
        world = studio.scene.world
        world.use_nodes = True
        background = world.node_tree.nodes["Background"]
        background.inputs["Color"].default_value = (*colour, 1.0)
        background.inputs["Strength"].default_value = strength

    def sun(toward, strength, colour=(1.0, 0.95, 0.88)):
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        lights.clear()
        data = bpy.data.lights.new(studio_module.PREFIX + "bear_sun", "SUN")
        data.energy = strength
        data.color = colour
        data.angle = math.radians(2.0)
        light = bpy.data.objects.new(studio_module.PREFIX + "bear_sun", data)
        studio.scene.collection.objects.link(light)
        direction = _unit(to_blender(np.array([toward]))[0])
        light.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
        lights.append(light)

    def remove(objects):
        for obj in objects:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)

    try:
        extent = 30.0
        ground = studio.mesh_object("bear_ground", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([[0.55, 0.62, 0.72]], (4, 1)))
        ground.data.materials.append(studio.material("bear_ground", roughness=1.0))
        sees = bear.colors[:, 3:4]
        coat = np.array([[0.93, 0.88, 0.76]]) * (0.35 + 0.65 * sees)
        coat = coat * (1.0 - 0.92 * np.maximum(bear.colors[:, 2:3], bear.colors[:, 0:1]))
        obj = bear_object("bear_coat", coat)
        sky((0.55, 0.62, 0.75), 0.7)
        sun((0.5, 0.7, 0.45), 3.4)
        shots = {
            "side": dict(eye=(7.0, 1.0, 0.2), target=(0.0, 0.8, 0.2), lens=50.0, size=(1400, 800)),
            "three-quarter": dict(eye=(4.6, 1.8, 4.6), target=(0.0, 0.8, 0.2), lens=46.0, size=(1200, 900)),
            "front": dict(eye=(0.6, 1.2, 6.0), target=(0.0, 0.8, 0.3), lens=50.0, size=(900, 900)),
            "rear": dict(eye=(-3.2, 1.6, -5.0), target=(0.0, 0.85, -0.2), lens=46.0, size=(1000, 900)),
            "head": dict(eye=(1.4, 1.3, 2.4), target=(0.0, 1.0, 1.25), lens=55.0, size=(900, 900)),
            "head-side": dict(eye=(2.0, 1.05, 1.25), target=(0.0, 1.0, 1.25), lens=55.0, size=(900, 700)),
            "paws": dict(eye=(1.6, 0.35, 2.2), target=(0.0, 0.15, 0.3), lens=40.0, size=(1000, 700)),
        }
        for name, shot in shots.items():
            studio.render(directory / ("bear-%s.png" % name), samples=24, **shot)
        # As the game sees it: against the moon, from 3 m up, sixty metres off.
        sky((0.2, 0.25, 0.38), 0.6)
        sun((-0.35, 0.38, -0.85), 3.0, colour=(0.85, 0.9, 1.0))
        studio.render(directory / "bear-far.png", eye=(-18.0, 3.25, 57.0), target=(0.0, 0.9, 0.0), lens=420.0,
                      size=(800, 450), samples=24)
        remove([obj])
        parts = bear_object("bear_parts", PART_COLOURS[bear.parts])
        sky((0.6, 0.62, 0.66), 0.9)
        sun((0.5, 0.7, 0.6), 3.0, colour=(1.0, 1.0, 1.0))
        studio.render(directory / "bear-parts.png", eye=(4.6, 1.8, 4.6), target=(0.0, 0.8, 0.2), lens=46.0,
                      size=(1000, 760), samples=16)
        remove([parts])
        shade = bear_object("bear_ao", np.repeat(bear.colors[:, 3:4], 3, axis=1) * 0.85)
        studio.render(directory / "bear-ao.png", eye=(4.6, 0.9, 4.0), target=(0.0, 0.8, 0.2), lens=46.0,
                      size=(1000, 760), samples=16)
        remove([shade, ground])
    finally:
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        studio.dispose()
    print("%s previews in %s  %.1fs" % (TAG, directory, time.time() - started), flush=True)


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {}
    key = None
    for argument in arguments:
        if argument.startswith("--"):
            key = argument[2:]
            options[key] = True
        elif key:
            options[key] = argument
            key = None
    if "skeleton" not in options or "out" not in options:
        raise SystemExit("usage: blender --background --factory-startup --python winter_polar_bear.py -- "
                         "--skeleton <bones.json> --out <mesh.glb> [--preview <dir>]")
    skeleton = json.loads(Path(options["skeleton"]).read_text(encoding="utf-8"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Winter - Bear Atelier"
    studio_module.PREFIX = "SWBEAR_"
    studio = studio_module.Studio()
    try:
        bear = build(studio, skeleton, voxel=float(options.get("voxel", VOXEL)),
                     target=int(options.get("triangles", TARGET_TRIANGLES)))
    finally:
        studio.dispose()
    out = Path(options["out"]).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    size = write(out, bear)
    print("%s wrote %s (%d bytes)" % (TAG, out, size), flush=True)
    if options.get("preview") and options["preview"] is not True:
        previews(bear, Path(options["preview"]).expanduser().resolve())


if __name__ == "__main__":
    main()
