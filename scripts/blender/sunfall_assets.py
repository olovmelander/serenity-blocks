"""Sunfall's authored world: the doline chamber, the ledge and the jungle crowns, from Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sunfall_assets.py -- \
        --out src/themes/sunfall/assets [--voxel 2.5] [--scratch <dir>] [--preview <png>]

A path-traced preview from the theme's rest camera alone (the lab for composition and light):

    blender --background --factory-startup --python scripts/blender/sunfall_assets.py -- \
        --preview <png> [--station 1] [--voxel 3.5] [--samples 96] [--exposure 2.5] [--scratch <dir>]

The chamber is a distance field in numpy (scripts/blender/sunfall/field.py): a plan ellipse
whose vertical lower walls curve into a vault, a collapse skylight (the oculus) through a
thin roof, an arched passage running away to the right with a second, smaller skylight
(the far doline), bedding ledges, joint-bounded breakdown blocks and ribbed flowstone,
polygonised with OpenVDB. The foreground is a rimstone terrace (sunfall/ledge.py) and the
jungle a planned canopy of cauliflower crowns (sunfall/canopy.py). Cycles then bakes what
the theme's shaders cannot afford to trace into vertex colours: ambient occlusion, the sky
light that falls in through the two skylights, and the sunlight (direct and bounced off the
canopy) for each of the five sun stations. Nothing external is fetched.

Written files (glTF, Y-up metres, KHR_mesh_quantization):
  sunfall-shell.glb   the chamber in chunks (16-bit indices); COLOR_0 = (ao, sky, sun0, sun1),
                      _BAKE = (sun2, sun3, sun4, flowstone)
  sunfall-ledge.glb   the terrace; COLOR_0 as the shell, _BAKE = (sun2, sun3, sun4, moss)
  sunfall-crowns.glb  six unit crowns (COLOR_0 = ao, height) and the canopy plan as points
                      (POSITION = crown top, _CROWN = radius, height, variant + tone, kind)
  asset-manifest.json the layout, the light encoding, the floor height grid and the counts
"""

import argparse
import json
import math
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from fall_grove.glb import GlbWriter, quantize_unit  # noqa: E402
from sunfall import layout as L  # noqa: E402
from sunfall import scene as S  # noqa: E402
from sunfall.canopy import CROWN_VARIANTS, crown_mesh, plan_canopy  # noqa: E402
from sunfall.field import base_field, floor_height, flowstone_mask, geology, shell_field  # noqa: E402
from sunfall.ledge import ledge_mesh, moss_mask  # noqa: E402
from sunfall.mesh import orient_to_air, polygonise, sample_grid  # noqa: E402

TAG = "[sunfall]"
SCHEMA_VERSION = 1
GENERATOR = "Serenity Blocks - Sunfall (Blender authoring)"
LIGHT_STOPS = 12.0          # the baked light is stored as log2 over this many stops
CHUNK_VERTICES = 60000
CROWN_TRIS = 720
BEHIND_EYE_Z = 26.0         # faces wholly behind this z are never seen


def log(msg):
    print(f"{TAG} {msg}", flush=True)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--preview", default=None)
    ap.add_argument("--voxel", type=float, default=None)
    ap.add_argument("--station", type=int, default=1)
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--bake-samples", type=int, default=384)
    ap.add_argument("--exposure", type=float, default=2.5)
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--height", type=int, default=540)
    ap.add_argument("--fov", type=float, default=None)
    ap.add_argument("--pitch", type=float, default=None)
    ap.add_argument("--yaw", type=float, default=None)
    ap.add_argument("--haze", type=float, default=0.0011)
    ap.add_argument("--mist", type=float, default=0.004)
    ap.add_argument("--shell-vertices", type=int, default=72000)
    ap.add_argument("--no-canopy", action="store_true")
    ap.add_argument("--scratch", default=None)
    return ap.parse_args(argv)


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


# --------------------------------------------------------------------------- geometry

def build_shell(voxel, scratch=None):
    cache = Path(scratch) / f"sunfall-shell-{voxel:.2f}.npz" if scratch else None
    if cache and cache.exists():
        data = np.load(cache)
        log(f"shell from cache {cache.name}: {len(data['v'])} vertices, {len(data['f'])} triangles")
        return data["v"], data["f"]
    started = time.time()
    grid, origin = sample_grid(base_field, geology, L.DOMAIN["min"], L.DOMAIN["max"], voxel, log=log)
    points, faces = polygonise(grid, origin, voxel, adaptivity=0.0)
    faces = orient_to_air(points, faces, shell_field)
    # Nothing behind the eye's near wall is ever on screen.
    behind = np.all(points[faces][:, :, 2] > BEHIND_EYE_Z, axis=1)
    faces = faces[~behind]
    log(f"shell: {len(points)} vertices, {len(faces)} triangles in {time.time() - started:.1f} s")
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache, v=points, f=faces)
    return points, faces


def build_crowns(scratch=None):
    variants = []
    for seed in range(CROWN_VARIANTS):
        cache = Path(scratch) / f"sunfall-crown-{seed}.npz" if scratch else None
        if cache and cache.exists():
            d = np.load(cache)
            variants.append((d["v"], d["f"]))
            continue
        v, f = crown_mesh(seed)
        if cache:
            np.savez_compressed(cache, v=v, f=f)
        variants.append((v, f))
    return variants


def decimate(obj, ratio):
    if ratio >= 0.999:
        return
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = max(0.001, ratio)
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def crown_vertical_scale(radius, tone):
    return radius * (0.92 + 0.26 * tone)


def assemble(args, voxel):
    """The whole doline in a fresh scene: shell, ledge, crowns and trunks, materials, lights."""
    clear_scene()
    verts, faces = build_shell(voxel, args.scratch)
    shell = S.mesh_object("SunfallShell", verts, faces)
    decimate(shell, args.shell_vertices / max(1, len(verts)))
    shell.data.materials.append(S.principled("Limestone", (0.46, 0.44, 0.39), 0.88))
    log(f"shell decimated to {len(shell.data.vertices)} vertices")

    lv, lf, _moss = ledge_mesh()
    ledge = S.mesh_object("SunfallLedge", lv, lf)
    decimate(ledge, 0.30)
    ledge.data.materials.append(S.principled("Calcite", (0.62, 0.58, 0.50), 0.8))
    log(f"ledge: {len(ledge.data.vertices)} vertices")

    crowns, plan = [], np.zeros((0, 8))
    if not args.no_canopy:
        leaf = S.principled("Canopy", (0.10, 0.20, 0.06), 0.7, translucent=0.35)
        bark = S.principled("Bark", (0.20, 0.17, 0.13), 0.9)
        for i, (v, f) in enumerate(build_crowns(args.scratch)):
            obj = S.mesh_object(f"Crown{i}", v, f)
            decimate(obj, CROWN_TRIS / max(1, len(f)))
            obj.data.materials.append(leaf)
            # Parked far above the world: the AO bake of a crown must see only that crown.
            obj.location = (i * 12.0, 0.0, 5000.0)
            crowns.append(obj)
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.0, depth=1.0)
        trunk_src = bpy.context.active_object
        trunk_src.name = "Trunk"
        trunk_src.data.materials.append(bark)
        trunk_src.location = (-40.0, 0.0, 5000.0)
        plan = plan_canopy(log=log)
        rng = np.random.default_rng(5)
        coll = bpy.data.collections.new("Canopy")
        bpy.context.scene.collection.children.link(coll)
        for row in plan:
            x, top, z, radius, height, variant, tone, kind = row
            obj = bpy.data.objects.new("c", crowns[int(variant)].data)
            coll.objects.link(obj)
            obj.location = tuple(S.to_blender([[x, top, z]])[0])
            vs = crown_vertical_scale(radius, tone)
            obj.scale = (radius, radius, vs)
            obj.rotation_euler = (0.0, 0.0, rng.uniform(0, 6.283))
            t = bpy.data.objects.new("t", trunk_src.data)
            coll.objects.link(t)
            trunk_len = max(2.0, height - vs * 0.6)
            t.location = tuple(S.to_blender([[x, top - vs * 0.6 - trunk_len * 0.5, z]])[0])
            tr = 0.35 + radius * 0.035
            t.scale = (tr, tr, trunk_len)
    return shell, ledge, crowns, plan


# --------------------------------------------------------------------------- bakes

def _select_only(objs):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake(objs, name, kind, samples, pass_filter=None):
    scene = bpy.context.scene
    for o in objs:
        attr = o.data.color_attributes.get(name) or o.data.color_attributes.new(name, "FLOAT_COLOR", "POINT")
        o.data.color_attributes.active_color = attr
    _select_only(objs)
    scene.cycles.samples = samples
    scene.render.bake.target = "VERTEX_COLORS"
    started = time.time()
    if kind == "AO":
        bpy.ops.object.bake(type="AO")
    else:
        bpy.ops.object.bake(type="DIFFUSE", pass_filter=pass_filter or {"DIRECT", "INDIRECT"})
    log(f"bake {name} on {', '.join(o.name for o in objs)} in {time.time() - started:.1f} s")


def read_color(obj, name):
    attr = obj.data.color_attributes[name]
    out = np.empty(len(attr.data) * 4, dtype=np.float32)
    attr.data.foreach_get("color", out)
    rgb = out.reshape(-1, 4)[:, :3]
    return rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def bake_world(shell, ledge, crowns, samples):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    S.use_gpu(scene)
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    world = bpy.data.worlds.new("BakeSky")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    scene.world = world
    targets = [shell, ledge]

    # Ambient occlusion: the shell's crevices at about the size of a breakdown block.
    world.light_settings.distance = 9.0
    bake(targets, "ao", "AO", max(64, samples // 3))
    if crowns:
        world.light_settings.distance = 0.55
        for c in crowns:
            c.hide_render = False
        bake(crowns, "ao", "AO", max(64, samples // 3))

    # Sky: what falls in through the two skylights (direct and bounced), for a white sky.
    bg.inputs["Strength"].default_value = 1.0
    bake(targets, "sky", "DIFFUSE", samples)

    # Sunlight, one bake per station, with the sky off.
    bg.inputs["Strength"].default_value = 0.0
    for i, d in enumerate(L.STATIONS):
        sun = S.sun_lamp(d, strength=1.0)
        bake(targets, f"sun{i}", "DIFFUSE", samples)
        bpy.data.objects.remove(sun, do_unlink=True)


# --------------------------------------------------------------------------- export

def mesh_arrays(obj):
    mesh = obj.data
    n = len(mesh.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    nor = np.empty(n * 3, dtype=np.float32)
    mesh.vertex_normals.foreach_get("vector", nor)
    mesh.calc_loop_triangles()
    tri = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int64)
    mesh.loop_triangles.foreach_get("vertices", tri)
    mw = np.array(obj.matrix_world, dtype=np.float64)
    pts = co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3]
    nrm = nor.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    return S.from_blender(pts), S.from_blender(nrm), tri.reshape(-1, 3)


def encode_light(values, ceiling):
    """log2 over LIGHT_STOPS stops below `ceiling`, 0 = no light at all."""
    v = np.maximum(values, 0.0) / ceiling
    floor = 2.0 ** -LIGHT_STOPS
    q = (np.log2(np.maximum(v, floor)) + LIGHT_STOPS) / LIGHT_STOPS
    q = np.where(v <= floor, 0.0, q)
    return quantize_unit(np.clip(q, 0.0, 1.0), np.uint8)


def split_chunks(points, faces, limit=CHUNK_VERTICES):
    """Recursive bisection of the triangles by their centres until each part fits 16-bit indices."""
    out = []
    stack = [np.arange(len(faces))]
    centres = points[faces].mean(axis=1)
    while stack:
        ids = stack.pop()
        used = np.unique(faces[ids])
        if len(used) <= limit:
            out.append(ids)
            continue
        c = centres[ids]
        axis = int(np.argmax(c.max(axis=0) - c.min(axis=0)))
        median = np.median(c[:, axis])
        left = ids[c[:, axis] <= median]
        right = ids[c[:, axis] > median]
        stack.extend([left, right])
    return out


def add_lit_mesh(writer, name, points, normals, faces, ao, sky, suns, extra, ceilings):
    for k, ids in enumerate(split_chunks(points, faces)):
        sub = faces[ids]
        used, inverse = np.unique(sub, return_inverse=True)
        color = np.stack([
            quantize_unit(np.clip(ao[used], 0, 1), np.uint8),
            encode_light(sky[used], ceilings["sky"]),
            encode_light(suns[0][used], ceilings["sun"]),
            encode_light(suns[1][used], ceilings["sun"]),
        ], axis=1)
        bake2 = np.stack([
            encode_light(suns[2][used], ceilings["sun"]),
            encode_light(suns[3][used], ceilings["sun"]),
            encode_light(suns[4][used], ceilings["sun"]),
            quantize_unit(np.clip(extra[used], 0, 1), np.uint8),
        ], axis=1)
        writer.add_mesh(f"{name}{k}", {
            "POSITION": (points[used], False),
            "NORMAL": (quantize_unit(normals[used], np.int8), True),
            "COLOR_0": (color, True),
            "_BAKE": (bake2, True),
        }, indices=inverse.reshape(-1, 3))


def export(args, shell, ledge, crowns, plan, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    sp, sn, sf = mesh_arrays(shell)
    lp, ln, lf = mesh_arrays(ledge)
    s_ao, s_sky = read_color(shell, "ao"), read_color(shell, "sky")
    l_ao, l_sky = read_color(ledge, "ao"), read_color(ledge, "sky")
    s_sun = [read_color(shell, f"sun{i}") for i in range(len(L.STATIONS))]
    l_sun = [read_color(ledge, f"sun{i}") for i in range(len(L.STATIONS))]
    inside = sp[:, 1] < L.OCULUS["underside"] - 10.0
    ceilings = {
        "sky": float(np.percentile(np.concatenate([s_sky[inside], l_sky]), 99.7)) * 2.0,
        "sun": float(np.percentile(np.concatenate([np.concatenate(s_sun)[np.tile(inside, len(s_sun))],
                                                   np.concatenate(l_sun)]), 99.7)) * 2.0,
    }
    flow = flowstone_mask(sp[:, 0], sp[:, 1], sp[:, 2])
    # The decimated ledge no longer matches its grid: the moss is worked out on its own vertices.
    moss = moss_mask(lp[:, 0], lp[:, 2], lp[:, 1])

    shell_glb = GlbWriter(GENERATOR)
    shell_glb.set_extras({"schemaVersion": SCHEMA_VERSION, "kind": "shell"})
    add_lit_mesh(shell_glb, "Shell", sp, sn, sf, s_ao, s_sky, s_sun, flow, ceilings)
    shell_size = shell_glb.write(out_dir / "sunfall-shell.glb")
    ledge_glb = GlbWriter(GENERATOR)
    ledge_glb.set_extras({"schemaVersion": SCHEMA_VERSION, "kind": "ledge"})
    add_lit_mesh(ledge_glb, "Ledge", lp, ln, lf, l_ao, l_sky, l_sun, moss, ceilings)
    ledge_size = ledge_glb.write(out_dir / "sunfall-ledge.glb")

    crown_glb = GlbWriter(GENERATOR)
    crown_glb.set_extras({"schemaVersion": SCHEMA_VERSION, "kind": "crowns"})
    crown_records = []
    for i, obj in enumerate(crowns):
        cp, cn, cf = mesh_arrays(obj)
        cp = cp - S.from_blender([np.array(obj.location)])[0]
        ao = read_color(obj, "ao")
        h = np.clip(-cp[:, 1] / max(1e-3, -cp[:, 1].min()), 0, 1)
        color = np.stack([
            quantize_unit(np.clip(ao, 0, 1), np.uint8),
            quantize_unit(1.0 - h, np.uint8),
            np.zeros(len(cp), np.uint8),
            np.full(len(cp), 255, np.uint8),
        ], axis=1)
        crown_glb.add_mesh(f"Crown{i}", {
            "POSITION": (cp, False),
            "NORMAL": (quantize_unit(cn, np.int8), True),
            "COLOR_0": (color, True),
        }, indices=cf)
        crown_records.append({"name": f"Crown{i}", "vertices": int(len(cp)), "triangles": int(len(cf))})
    if len(plan):
        sites = plan[:, [0, 1, 2]].astype(np.float32)
        crown = np.stack([
            plan[:, 3],
            plan[:, 4],
            plan[:, 5] + np.clip(plan[:, 6], 0.0, 0.999),
            plan[:, 7],
        ], axis=1).astype(np.float32)
        crown_glb.add_mesh("CanopyPlan", {"POSITION": (sites, False), "_CROWN": (crown, False)},
                           mode=0, position_bits=32)
    crowns_size = crown_glb.write(out_dir / "sunfall-crowns.glb")

    # A coarse grid of the floor height (the canopy's ground), for the theme's height map.
    gx = np.linspace(-440.0, 380.0, 97)
    gz = np.linspace(-960.0, -20.0, 97)
    GX, GZ = np.meshgrid(gx, gz, indexing="xy")
    floor = floor_height(GX, GZ)
    manifest = {
        "schema": SCHEMA_VERSION,
        "generator": GENERATOR,
        "voxel": voxel_of(args),
        "light": {"stops": LIGHT_STOPS, "ceilings": ceilings},
        "layout": L.manifest(),
        "crownVerticalScale": [0.92, 0.26],
        "floorGrid": {
            "x": [float(gx[0]), float(gx[-1])],
            "z": [float(gz[0]), float(gz[-1])],
            "size": [len(gx), len(gz)],
            "heights": [round(float(v), 1) for v in floor.ravel()],
        },
        "files": {
            "sunfall-shell.glb": {"bytes": int(shell_size), "vertices": int(len(sp)), "triangles": int(len(sf))},
            "sunfall-ledge.glb": {"bytes": int(ledge_size), "vertices": int(len(lp)), "triangles": int(len(lf))},
            "sunfall-crowns.glb": {"bytes": int(crowns_size), "crowns": crown_records, "sites": int(len(plan))},
        },
    }
    text = json.dumps(manifest, indent=1)
    # The floor grid is data, not something to read: one line.
    start = text.index('"heights": [')
    end = text.index("]", start) + 1
    heights = json.dumps(manifest["floorGrid"]["heights"], separators=(",", ":"))
    text = text[:start] + '"heights": ' + heights + text[end:]
    (out_dir / "asset-manifest.json").write_text(text + "\n", encoding="utf-8")
    log(f"wrote shell {shell_size / 1e6:.2f} MB, ledge {ledge_size / 1e6:.2f} MB, crowns {crowns_size / 1e6:.2f} MB")


def voxel_of(args):
    if args.voxel:
        return args.voxel
    return 2.5 if args.out else 3.5


# --------------------------------------------------------------------------- preview

def add_preview_lights(args):
    station = L.STATIONS[max(0, min(len(L.STATIONS) - 1, args.station))]
    S.rest_camera(fov_deg=args.fov, pitch_deg=args.pitch, yaw_deg=args.yaw)
    S.sun_lamp(station, strength=7.0)
    S.sky_world(station, strength=0.9)
    if args.haze > 0:
        S.volume_box("Haze", (-430, -175, -960), (550, 150, 20), args.haze, anisotropy=0.55)
    if args.mist > 0:
        S.volume_box("ValleyMist", (-430, -150, -960), (550, -92, 20), args.mist, anisotropy=0.55)


def preview(args):
    started = time.time()
    device = S.render_preview(args.preview, args.width, args.height, args.samples, args.exposure)
    log(f"preview {args.preview} on {device} in {time.time() - started:.1f} s")


def main():
    args = parse_args()
    voxel = voxel_of(args)
    shell, ledge, crowns, plan = assemble(args, voxel)
    for c in crowns:
        c.hide_render = True
    if args.out:
        bake_world(shell, ledge, crowns, args.bake_samples)
        for c in crowns:
            c.hide_render = True
        export(args, shell, ledge, crowns, plan, Path(args.out))
    if args.preview:
        for obj in list(bpy.data.objects):
            if obj.type == "LIGHT":
                bpy.data.objects.remove(obj, do_unlink=True)
        add_preview_lights(args)
        preview(args)


main()
