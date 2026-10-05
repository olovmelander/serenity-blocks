"""Author the Crystal Cave asset pack (Blender 4.5 LTS, headless).

    blender --background --factory-startup --python scripts/blender/crystal_cave_assets.py -- \
        --out src/themes/crystal-cave/assets [--draft] [--preview <dir>]

One file, `cavern.glb`, holds everything the runtime draws that is not a shader:

* the cavern: a hall sculpted from two height fields, voxel-remeshed, given rock relief
  and decimated. Every vertex carries the light it receives, baked in Cycles with
  bounces: one channel per mineral family (the crystals of that family are the lamps),
  one for the pool, one for the skylight, and ambient occlusion — eight scalars, so the
  runtime can re-colour and pulse each source without re-lighting anything;
* the crystals, rooted on that rock by ray casts and grown as bursts;
* glow-worm points under the vault, and the places where water drips.

Nothing is downloaded: every vertex is generated here, so the pack is project-owned.
"""

import hashlib
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from crystal_cave import fields as F  # noqa: E402
from crystal_cave.growth import FAMILIES, crystal_mesh, crystal_tip, grow_cluster  # noqa: E402
from crystal_cave.layout import CLUSTERS, SPROUTS  # noqa: E402
from fall_grove.glb import GlbWriter, quantize_unit  # noqa: E402

SCHEMA = 1
UP = np.array([0.0, 1.0, 0.0])
#: The game camera the picture is composed for (landscape).
CAMERA = {"eye": (0.0, 4.0, 30.0), "target": (0.0, 2.0, -18.0), "fov": 55.0}
#: Nominal brightness of each baked source when the direction of light is estimated.
CHANNELS = (*FAMILIES, "pool", "sky", "occlusion")


def log(message, started=[time.time()]):  # noqa: B006 - a deliberate process-wide clock
    print("[crystal-cave] %6.1fs  %s" % (time.time() - started[0], message), flush=True)


# ---------------------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------------------
def air_volume(step):
    """A closed mesh around the air between the two height fields."""
    xs = np.arange(F.PLAN[0], F.PLAN[1] + step * 0.5, step)
    zs = np.arange(F.PLAN[2], F.PLAN[3] + step * 0.5, step)
    gx, gz = np.meshgrid(xs, zs)
    floor, ceiling = F.fields(gx, gz)
    opened = ceiling > floor + 0.25
    opened[0, :] = opened[-1, :] = opened[:, 0] = opened[:, -1] = False
    rows, columns = gx.shape
    bottom = np.arange(rows * columns).reshape(rows, columns)
    top = bottom.copy()
    top[opened] = rows * columns + np.arange(int(opened.sum()))
    vertices = np.concatenate([
        np.stack([gx.ravel(), floor.ravel(), gz.ravel()], axis=1),
        np.stack([gx[opened], ceiling[opened], gz[opened]], axis=1),
    ])
    a, b, c, d = (slice(None, -1), slice(None, -1)), (slice(None, -1), slice(1, None)), \
        (slice(1, None), slice(1, None)), (slice(1, None), slice(None, -1))
    live = opened[a] | opened[b] | opened[c] | opened[d]
    under = np.stack([bottom[a][live], bottom[b][live], bottom[c][live], bottom[d][live]], axis=1)
    over = np.stack([top[a][live], top[d][live], top[c][live], top[b][live]], axis=1)
    faces = np.concatenate([under, over])
    used, inverse = np.unique(faces, return_inverse=True)
    return vertices[used], inverse.reshape(faces.shape)


def rock_relief(points, air_normals):
    """How far each vertex is pushed into the air: lumps, ridges and bedding ledges."""
    wall = 1.0 - np.abs(air_normals[:, 1])
    lumps = (F.fbm3(points, 0.065, 201, 4) - 0.5) * 3.2
    ridged = (1.0 - np.abs(F.fbm3(points, 0.19, 233, 3) * 2.0 - 1.0) - 0.5) * 1.3
    bedding = points[:, 1] * 0.42 + (F.fbm3(points, 0.04, 251, 3) - 0.5) * 7.5
    phase = bedding - np.floor(bedding)
    ledge = F.smoothstep(0.0, 0.14, phase) * (1.0 - F.smoothstep(0.55, 1.0, phase)) - 0.45
    pebbles = (F.fbm3(points, 0.6, 271, 2) - 0.5) * 0.28
    # The pool bed and the banks stay calmer than the walls and the vault.
    floorness = F.smoothstep(0.55, 0.95, air_normals[:, 1])
    calm = 1.0 - 0.72 * floorness
    return (lumps + ridged) * calm + ledge * 0.44 * wall + pebbles


def sculpt(studio, draft):
    step = 0.6 if draft else 0.4
    voxel = 0.5 if draft else 0.32
    vertices, faces = air_volume(step)
    log("air volume: %d vertices, %d quads" % (len(vertices), len(faces)))
    air = studio.mesh_object("air", vertices, faces)
    studio.apply_modifier(air, "REMESH", mode="VOXEL", voxel_size=voxel, adaptivity=0.0, use_smooth_shade=True)
    points, triangles, normals = studio.read(air)
    log("remeshed at %.2f: %d vertices, %d triangles" % (voxel, len(points), len(triangles)))

    # Which way is air? Probe a little along the normal and ask the fields.
    probe = points + normals * 0.6
    floor, ceiling = F.fields(probe[:, 0], probe[:, 2])
    into_air = np.mean((probe[:, 1] > floor) & (probe[:, 1] < ceiling))
    sign = 1.0 if into_air > 0.5 else -1.0
    air_normals = normals * sign
    points = points + air_normals * rock_relief(points, air_normals)[:, None]
    studio.move(air, points)

    target = 60000 if draft else 150000
    ratio = min(1.0, target / max(1, len(triangles)))
    studio.apply_modifier(air, "DECIMATE", decimate_type="COLLAPSE", ratio=ratio)
    points, triangles, normals = studio.read(air)
    if sign < 0:
        triangles = triangles[:, ::-1].copy()
    normals = normals * sign
    bpy_remove(air)
    # Nothing behind the player is ever drawn.
    keep = ~np.all(points[triangles][:, :, 2] > CAMERA["eye"][2] + 9.0, axis=1)
    triangles = triangles[keep]
    used, inverse = np.unique(triangles, return_inverse=True)
    points, normals, triangles = points[used], normals[used], inverse.reshape(-1, 3)
    log("cavern: %d vertices, %d triangles (air normals %s)" % (
        len(points), len(triangles), "kept" if sign > 0 else "flipped"))
    return points, triangles, normals


def bpy_remove(obj):
    import bpy
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if data is not None and data.users == 0:
        bpy.data.meshes.remove(data)


# ---------------------------------------------------------------------------------------
# crystals
# ---------------------------------------------------------------------------------------
class Rock:
    """Ray casts against the finished cavern."""

    def __init__(self, points, triangles):
        from mathutils.bvhtree import BVHTree
        self.tree = BVHTree.FromPolygons(points.tolist(), triangles.tolist())

    def cast(self, origin, direction, reach=80.0):
        from mathutils import Vector
        direction = np.asarray(direction, dtype=np.float64)
        direction = direction / np.linalg.norm(direction)
        location, normal, _index, _distance = self.tree.ray_cast(Vector(origin), Vector(direction), reach)
        if location is None:
            return None
        normal = np.array(normal)
        if np.dot(normal, direction) > 0:
            normal = -normal
        return np.array(location), normal

    def drop(self, x, z, down=True):
        floor, ceiling = F.fields(np.array([x]), np.array([z]))
        middle = float(min(max(floor[0] + 5.0, (floor[0] + ceiling[0]) * 0.5), ceiling[0] - 1.0))
        return self.cast((x, middle, z), (0.0, -1.0, 0.0) if down else (0.0, 1.0, 0.0))


def unit(vector):
    vector = np.asarray(vector, dtype=np.float64)
    return vector / max(np.linalg.norm(vector), 1e-9)


def plant(rock):
    """Root every authored cluster on the rock and grow it. Returns the crystal list."""
    crystals = []
    missed = []
    for spec in CLUSTERS:
        rng = np.random.default_rng(spec["seed"] * 7919)
        if spec["kind"] == "floor":
            hit = rock.drop(spec["x"], spec["z"], True)
            towards = UP
        elif spec["kind"] == "ceiling":
            hit = rock.drop(spec["x"], spec["z"], False)
            towards = -UP
        else:
            hit = rock.cast(spec["origin"], spec["aim"])
            towards = -unit(spec["aim"]) * 0.6 + UP * 0.25
        if hit is None:
            missed.append(spec["seed"])
            continue
        root, normal = hit
        axis = unit(normal * 0.5 + towards) if spec["kind"] != "wall" else unit(normal * 0.7 + towards)
        crystals += grow_cluster(rng, root, axis, spec["count"], spec["height"], spec["radius"], spec["family"],
                                 spread=spec.get("spread", 0.75), accent=spec.get("accent"), glow=spec.get("glow", 1.0),
                                 lean=spec.get("lean"))
        # Druzy: a carpet of small points around the root.
        tangent = unit(np.cross(axis, [0.3, 0.1, 0.9]))
        bitangent = np.cross(axis, tangent)
        for _ in range(spec.get("druzy", 0)):
            angle = rng.random() * math.tau
            far = rng.random() ** 0.7
            reach = spec["radius"] * (1.3 + far * 4.2)
            start = root + (tangent * math.cos(angle) + bitangent * math.sin(angle)) * reach + axis * 3.5
            spot = rock.cast(start, -axis, 9.0)
            if spot is None:
                continue
            family = spec["family"] if rng.random() > 0.28 or spec.get("accent") is None else spec["accent"]
            crystals += grow_cluster(rng, spot[0], unit(spot[1] * 0.7 + axis), int(1 + rng.integers(0, 3)),
                                     (0.45 + rng.random() * 1.5) * (1.0 - 0.55 * far) * (0.6 + spec["radius"] * 0.3),
                                     0.14 + rng.random() * 0.24, family, spread=0.95, glow=spec.get("glow", 1.0) * 0.9)
    if missed:
        raise RuntimeError("clusters found no rock: %s" % missed)
    return crystals


def veins(rock, points, air_normals, count):
    """Small crystals seeded along noisy bands of the walls and vault."""
    rng = np.random.default_rng(90210)
    wall = 1.0 - np.abs(air_normals[:, 1]) * 0.55
    rich = F.fbm3(points, 0.085, 611, 3)
    chance = F.smoothstep(0.55, 0.7, rich) * wall
    chance = chance * (points[:, 2] < 24.0) * (points[:, 2] > -118.0) * (points[:, 1] > F.POOL_LEVEL + 0.4)
    if chance.sum() <= 0:
        return []
    chosen = rng.choice(len(points), size=min(count, int((chance > 0).sum())), replace=False, p=chance / chance.sum())
    hue = F.fbm3(points[chosen], 0.03, 733, 2)
    crystals = []
    for index, vertex in enumerate(chosen):
        family = int(np.clip((hue[index] - 0.3) / 0.4 * len(FAMILIES), 0, len(FAMILIES) - 1))
        axis = unit(air_normals[vertex] + (rng.random(3) - 0.5) * 0.5)
        crystals += grow_cluster(rng, points[vertex], axis, int(2 + rng.integers(0, 4)), 0.7 + rng.random() ** 2 * 2.6,
                                 0.2 + rng.random() * 0.3, family, spread=0.9, glow=0.9)
    return crystals


def sprouts(rock):
    """Crystals that only exist once play has grown them: group = site index + 1."""
    crystals = []
    sites = []
    for index, (x, z, family) in enumerate(SPROUTS):
        hit = rock.drop(x, z, True)
        if hit is None:
            continue
        rng = np.random.default_rng(4000 + index)
        root, normal = hit
        grown = grow_cluster(rng, root, unit(normal * 0.4 + UP), 5, 3.4 + rng.random() * 1.6, 0.5 + rng.random() * 0.16,
                             family, spread=0.85, glow=1.5, group=len(sites) + 1)
        crystals += grown
        sites.append({"x": round(float(root[0]), 3), "y": round(float(root[1]), 3), "z": round(float(root[2]), 3),
                      "family": int(family)})
    return crystals, sites


def emitter_objects(studio, crystals):
    """One lamp object per family, built from every crystal that is always present."""
    lamps = []
    for family in range(len(FAMILIES)):
        vertices, faces, glow = [], [], []
        offset = 0
        for crystal in crystals:
            if crystal["family"] != family or crystal["group"] != 0:
                continue
            points, triangles = crystal_mesh(crystal)
            vertices.append(points)
            faces.append(triangles + offset)
            glow.append(np.full(len(points), crystal["glow"]))
            offset += len(points)
        obj = studio.mesh_object("lamp-" + FAMILIES[family], np.concatenate(vertices), np.concatenate(faces),
                                 smooth=False)
        layer = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        values = np.repeat(np.concatenate(glow)[:, None], 4, axis=1).astype(np.float32)
        values[:, 3] = 1.0
        layer.data.foreach_set("color", values.reshape(-1))
        material = studio.emitter("lamp-" + FAMILIES[family])
        nodes = material.node_tree.nodes
        attribute = nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = "Col"
        material.node_tree.links.new(attribute.outputs["Color"], nodes["lamp"].inputs["Color"])
        obj.data.materials.append(material)
        lamps.append((obj, material))
    return lamps


# ---------------------------------------------------------------------------------------
# light
# ---------------------------------------------------------------------------------------
def skylight():
    floor, ceiling = F.fields(np.array([F.SKYLIGHT["x"]]), np.array([F.SKYLIGHT["z"]]))
    top = float(ceiling[0])
    position = (F.SKYLIGHT["x"], top - 6.0, F.SKYLIGHT["z"])
    target = (F.SKYLIGHT["x"] + 7.0, F.POOL_LEVEL, F.SKYLIGHT["z"] + 9.0)
    return {"position": position, "target": target, "angle": math.radians(11.0)}


def bake(studio, points, triangles, crystals, draft):
    """Returns an (n, 8) array: five families, pool, sky, occlusion (raw, unnormalised)."""
    samples = 64 if draft else 192
    cave = studio.mesh_object("cavern", points, triangles)
    cave.data.materials.append(studio.diffuse("rock", 0.42))
    lamps = emitter_objects(studio, crystals)

    span = [F.PLAN[0], F.PLAN[1], F.PLAN[2], F.PLAN[3]]
    y = F.POOL_LEVEL
    pool = studio.mesh_object("pool", [[span[0], y, span[2]], [span[1], y, span[2]], [span[1], y, span[3]],
                                       [span[0], y, span[3]]], [[0, 1, 2, 3]], smooth=False)
    pool_material = studio.emitter("pool")
    pool.data.materials.append(pool_material)
    pool.hide_render = True

    sky = skylight()
    lamp = studio.spot("skylight", sky["position"], sky["target"], 0.0, sky["angle"], blend=0.35, radius=1.6)

    result = np.zeros((len(points), 8), dtype=np.float64)
    for family, (_obj, material) in enumerate(lamps):
        studio.set_emission(material, 1.0)
        result[:, family] = studio.bake_irradiance(cave, samples=samples)
        studio.set_emission(material, 0.0)
        log("baked %s: mean %.4f max %.3f" % (FAMILIES[family], result[:, family].mean(), result[:, family].max()))
    pool.hide_render = False
    studio.set_emission(pool_material, 1.0)
    result[:, 5] = studio.bake_irradiance(cave, samples=samples)
    studio.set_emission(pool_material, 0.0)
    pool.hide_render = True
    log("baked pool: mean %.4f" % result[:, 5].mean())
    lamp.data.energy = 250000.0
    result[:, 6] = studio.bake_irradiance(cave, samples=samples * 2, bounces=4)
    lamp.data.energy = 0.0
    log("baked sky: mean %.4f max %.3f" % (result[:, 6].mean(), result[:, 6].max()))
    result[:, 7] = studio.bake_occlusion(cave, samples=96 if draft else 256, distance=9.0)
    log("baked occlusion: mean %.3f" % result[:, 7].mean())
    return result, cave, lamps, pool, pool_material, lamp


def smooth_over_mesh(values, triangles, count, passes=2):
    """A light Laplacian blur over the mesh: removes per-vertex Monte-Carlo noise."""
    edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    edges = np.concatenate([edges, edges[:, ::-1]])
    degree = np.bincount(edges[:, 0], minlength=count).astype(np.float64)
    out = values.copy()
    for _ in range(passes):
        total = np.zeros_like(out)
        np.add.at(total, edges[:, 0], out[edges[:, 1]])
        out = out * 0.5 + (total / np.maximum(degree, 1.0)[:, None]) * 0.5
    return out


def light_direction(points, normals, light, crystals):
    """Where most of each vertex's light comes from — lets the shader light fine relief."""
    direction = np.zeros((len(points), 3))
    for family in range(len(FAMILIES)):
        lamps = [c for c in crystals if c["family"] == family and c["group"] == 0 and c["height"] > 1.5]
        if not lamps:
            continue
        centres = np.array([c["position"] + (crystal_tip(c) - c["position"]) * 0.5 for c in lamps])
        weights = np.array([c["glow"] * c["radius"] * c["height"] for c in lamps])
        toward = np.zeros((len(points), 3))
        for start in range(0, len(points), 4096):
            chunk = points[start:start + 4096]
            delta = centres[None, :, :] - chunk[:, None, :]
            distance = np.maximum(np.linalg.norm(delta, axis=2), 1.5)
            toward[start:start + 4096] = np.sum(delta * (weights[None, :] / distance ** 3)[:, :, None], axis=1)
        length = np.maximum(np.linalg.norm(toward, axis=1, keepdims=True), 1e-9)
        direction += toward / length * light[:, family:family + 1]
    direction += np.array([0.0, -1.0, 0.0])[None, :] * light[:, 5:6] * 0.6
    sky = skylight()
    direction += unit(np.array(sky["position"]) - np.array(sky["target"]))[None, :] * light[:, 6:7]
    direction += normals * 1e-4
    return direction / np.maximum(np.linalg.norm(direction, axis=1, keepdims=True), 1e-9)


# ---------------------------------------------------------------------------------------
# points of interest
# ---------------------------------------------------------------------------------------
def glow_worms(points, air_normals, count):
    rng = np.random.default_rng(1234)
    vault = F.smoothstep(0.35, 0.8, -air_normals[:, 1]) * (points[:, 1] > 9.0) * (points[:, 2] < 26.0)
    colonies = F.smoothstep(0.5, 0.66, F.fbm3(points, 0.07, 911, 3))
    chance = vault * (0.04 + colonies)
    chosen = rng.choice(len(points), size=min(count, int((chance > 0).sum())), replace=False, p=chance / chance.sum())
    jitter = (rng.random((len(chosen), 3)) - 0.5) * 0.9
    spots = points[chosen] + jitter + air_normals[chosen] * 0.12
    params = np.stack([0.5 + rng.random(len(chosen)) * 0.9, rng.random(len(chosen)),
                       rng.random(len(chosen)), 0.2 + rng.random(len(chosen)) ** 2 * 1.6], axis=1)
    return spots, params


def drips(rock):
    """Stalactite tips over open water: where a drop leaves and where it lands."""
    found = []
    for x, z, radius, length in F.stalactites():
        if length < 4.5 or z > 20.0 or z < -100.0:
            continue
        floor, _ceiling = F.fields(np.array([x]), np.array([z]))
        if floor[0] > F.POOL_LEVEL - 0.4:
            continue
        hit = rock.cast((x, F.POOL_LEVEL + 0.5, z), (0.0, 1.0, 0.0))
        if hit is None:
            continue
        found.append([hit[0][0], hit[0][1], hit[0][2], length])
    found.sort(key=lambda item: -item[3])
    return np.array(found[:28], dtype=np.float64)


# ---------------------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------------------
def encode_light(light):
    """Normalise each channel to its bright end and store the square root in 8 bits."""
    scale = np.ones(8)
    encoded = np.zeros_like(light)
    for channel in range(8):
        if channel == 7:
            encoded[:, channel] = np.clip(light[:, channel], 0.0, 1.0)
            continue
        scale[channel] = max(float(np.percentile(light[:, channel], 99.6)), 1e-6)
        encoded[:, channel] = np.sqrt(np.clip(light[:, channel] / scale[channel], 0.0, 1.0))
    return quantize_unit(encoded, np.uint8), scale


def write_pack(out_dir, points, triangles, normals, light, direction, crystals, sites, worms, worm_params, drops):
    out_dir.mkdir(parents=True, exist_ok=True)
    writer = GlbWriter(generator="Serenity Blocks - Crystal Cave (Blender authoring)")
    encoded, scale = encode_light(light)
    writer.add_mesh("cavern", {
        "POSITION": (points, False),
        "NORMAL": (quantize_unit(normals, np.int8), True),
        "_LIGHT0": (encoded[:, 0:4], True),
        "_LIGHT1": (encoded[:, 4:8], True),
        "_LDIR": (quantize_unit(direction, np.int8), True),
    }, indices=triangles)
    writer.add_mesh("crystals", {
        "POSITION": (np.array([c["position"] for c in crystals], dtype=np.float32), False),
        "_QUAT": (np.array([c["quat"] for c in crystals], dtype=np.float32), False),
        "_DIMS": (np.array([[c["radius"], c["depth"], c["height"], c["tip"]] for c in crystals], dtype=np.float32), False),
        "_LOOK": (np.array([[c["apex"][0], c["apex"][1], c["family"], c["glow"]] for c in crystals], dtype=np.float32),
                  False),
        "_META": (np.array([[c["seed"], c["group"], c["rank"], 0.0] for c in crystals], dtype=np.float32), False),
    }, mode=0, position_bits=32)
    writer.add_mesh("glowworms", {
        "POSITION": (worms.astype(np.float32), False),
        "_PARAMS": (worm_params.astype(np.float32), False),
    }, mode=0, position_bits=32)
    if len(drops):
        writer.add_mesh("drips", {
            "POSITION": (drops[:, :3].astype(np.float32), False),
            "_PARAMS": (np.stack([drops[:, 3], np.zeros(len(drops)), np.zeros(len(drops)), np.zeros(len(drops))],
                                 axis=1).astype(np.float32), False),
        }, mode=0, position_bits=32)
    sky = skylight()
    extras = {
        "schemaVersion": SCHEMA,
        "poolLevel": F.POOL_LEVEL,
        "families": list(FAMILIES),
        "channels": list(CHANNELS),
        "lightScale": [round(float(v), 6) for v in scale],
        "skylight": {"position": [round(v, 3) for v in sky["position"]], "target": [round(v, 3) for v in sky["target"]],
                     "angle": round(sky["angle"], 5)},
        "camera": CAMERA,
        "sprouts": sites,
        "counts": {"vertices": int(len(points)), "triangles": int(len(triangles)), "crystals": int(len(crystals)),
                   "glowworms": int(len(worms)), "drips": int(len(drops))},
    }
    writer.set_extras(extras)
    path = out_dir / "cavern.glb"
    size = writer.write(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = {
        "schemaVersion": SCHEMA,
        "author": "Serenity Blocks (generated in Blender; no third-party source)",
        "license": "Project-owned",
        "glTFUpAxis": "Y",
        "assets": [{"file": "cavern.glb", "bytes": size, "sha256": digest, "kind": "cavern", **extras["counts"]}],
    }
    (out_dir / "asset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    return size


def preview(studio, directory, lamps, pool, pool_material, lamp):
    palette = [(0.03, 0.8, 0.64), (0.33, 0.11, 1.0), (0.03, 0.15, 1.0), (1.0, 0.1, 0.39), (1.0, 0.43, 0.07)]
    for family, (_obj, material) in enumerate(lamps):
        material.node_tree.links.clear()
        output = material.node_tree.nodes["Material Output"]
        material.node_tree.links.new(material.node_tree.nodes["lamp"].outputs["Emission"], output.inputs["Surface"])
        studio.set_emission(material, 2.2, palette[family])
    pool.hide_render = False
    studio.set_emission(pool_material, 0.05, (0.1, 0.8, 0.9))
    lamp.data.energy = 1500000.0
    lamp.data.color = (0.75, 0.86, 1.0)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    studio.render(directory / "preview-game.png", CAMERA["eye"], CAMERA["target"], CAMERA["fov"], samples=96,
                  exposure=1.5)
    studio.render(directory / "preview-hall.png", (-4.0, 16.0, 8.0), (4.0, 2.0, -70.0), 70.0, samples=96, exposure=1.5)


def build(out_dir, draft=False, preview_dir=None):
    from crystal_cave.studio import Studio
    studio = Studio()
    try:
        points, triangles, normals = sculpt(studio, draft)
        rock = Rock(points, triangles)
        crystals = plant(rock)
        log("planted %d crystals in %d clusters" % (len(crystals), len(CLUSTERS)))
        crystals += veins(rock, points, normals, 80 if draft else 200)
        grown, sites = sprouts(rock)
        crystals += grown
        log("with veins and %d sprout sites: %d crystals" % (len(sites), len(crystals)))
        light, _cave, lamps, pool, pool_material, lamp = bake(studio, points, triangles, crystals, draft)
        light[:, :7] = smooth_over_mesh(light[:, :7], triangles, len(points), passes=1 if draft else 2)
        direction = light_direction(points, normals, light, crystals)
        worms, worm_params = glow_worms(points, normals, 900 if draft else 3200)
        drops = drips(rock)
        size = write_pack(Path(out_dir), points, triangles, normals, light, direction, crystals, sites, worms,
                          worm_params, drops)
        log("wrote cavern.glb: %.2f MB, %d glow-worms, %d drips" % (size / 1048576, len(worms), len(drops)))
        if preview_dir:
            preview(studio, preview_dir, lamps, pool, pool_material, lamp)
            log("preview renders in %s" % preview_dir)
    finally:
        studio.dispose()


def _main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {"out": None, "preview": None, "draft": False}
    index = 0
    while index < len(arguments):
        key = arguments[index].lstrip("-")
        if key == "draft":
            options[key] = True
            index += 1
        else:
            options[key] = arguments[index + 1]
            index += 2
    if not options["out"]:
        raise SystemExit("usage: blender -b --factory-startup --python crystal_cave_assets.py -- --out <dir> [--draft]")
    build(options["out"], draft=options["draft"], preview_dir=options["preview"])


if __name__ == "__main__":
    _main()
