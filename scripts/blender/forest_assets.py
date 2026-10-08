"""Original Serenity Blocks Forest ("the firefly night") assets, authored procedurally in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/forest_assets.py -- \
        --out src/themes/forest/assets [--only trees,foliage,impostors,props] \
        [--preview reports/forest-night/preview] [--recipes spruce-elder,birch-a] [--no-bake] \
        [--scratch <dir>]

An old-growth spruce glade for a camera that stands among the trunks: two elders to frame
it, old and young spruce, a pine and two birches for the far side, the needle, leaf and fern
geometry they share, a fallen trunk with its stump, boulders and a snag, and a sprite sheet
of the far trees. The trees are grown with the Fall grove's branching library
(scripts/blender/fall_grove) and the Golden Forest's conifers (scripts/blender/golden_forest)
and written in the same compact GLB layout: a bark mesh plus a point cloud of foliage sites
per tree. No external assets are fetched: every mesh and bake is generated here.
Coordinates in the written GLBs are glTF Y-up metres with each object's base at the origin.
"""

import json
from pathlib import Path
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

import fall_grove_assets as grove  # noqa: E402
from fall_grove import glb, skeleton  # noqa: E402
from forest_night import bark, props, sprays, trees  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
SPRAY_VARIANTS = grove.SPRAY_VARIANTS
GENERATOR = "Serenity Blocks - Forest firefly night (Blender authoring)"
TAG = "[forest-night]"
FOLIAGE_FILE = "forest-foliage.glb"
PROPS_FILE = "forest-props.glb"
IMPOSTOR_FILE = "forest-impostors.png"
# The far stand has eight silhouettes on its sheet (the Golden Forest has six), so each tile is
# a little shorter than the Fall grove's 448 px; the bake itself is the Fall grove's.
IMPOSTOR_HEIGHT = 384
# Seed of each specimen's bark mask; the elder wears more moss and lichen than anything else.
BARK = {
    "spruce-elder": dict(seed=41, lichen=1.5),
    "pine-elder": dict(seed=43),
    "spruce-old-a": dict(seed=47, lichen=1.15),
    "spruce-old-b": dict(seed=53, lichen=1.15),
    "spruce-old-c": dict(seed=59, lichen=1.15),
    "spruce-young-a": dict(seed=61),
    "spruce-young-b": dict(seed=67),
    "pine-old-a": dict(seed=71),
    "birch-a": dict(seed=73),
    "birch-b": dict(seed=79),
}

# The shared bake and preview helpers look sprays and preview colours up by kind and species.
grove.SPRAY_REACH.update(sprays.SPRAY_REACH)
grove.LEAF_PREVIEW.update({
    "spruce": [(0.1, 0.2, 0.08), (0.14, 0.26, 0.09), (0.2, 0.3, 0.1), (0.12, 0.22, 0.1)],
    "pine": [(0.16, 0.28, 0.1), (0.2, 0.32, 0.12), (0.24, 0.34, 0.12), (0.18, 0.3, 0.14)],
    "birch": [(0.3, 0.5, 0.12), (0.36, 0.56, 0.14), (0.42, 0.6, 0.18), (0.26, 0.46, 0.12)],
})


def grow(recipe):
    """Grow one specimen and derive everything that needs no Blender."""
    started = time.time()
    tree = trees.RECIPES[recipe]()
    hero = tree.meta["role"] == "hero"
    wood = bark.build_wood(tree, hero=hero, **BARK[recipe])
    positions = np.array([site.position for site in tree.sites])
    reach = sprays.SPRAY_REACH[tree.meta["foliage"]]
    radius = reach * float(np.mean([site.scale for site in tree.sites]))
    sky, bent = skeleton.foliage_visibility(positions, radius * 0.8, opacity=0.3)
    # The best-lit tenth of the crown defines full sky; the interior keeps its true ratio.
    sky = np.clip(sky / max(1e-4, float(np.percentile(sky, 90))), 0.0, 1.0)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s %-15s branches=%4d bark_tris=%6d core=%6d sites=%5d sky=%.2f..%.2f crown x %.1f..%.1f y %.1f..%.1f "
          "z %.1f..%.1f  %.1fs" % (
              TAG, recipe, len(tree.branches), wood.triangles, wood.core_indices // 3, len(tree.sites), sky.min(),
              sky.mean(), low[0], high[0], low[1], high[1], low[2], high[2], time.time() - started))
    return dict(tree=tree, bark=wood.arrays(), positions=positions, sky=sky, bent=bent,
                frames=grove.site_frames(tree.sites), hero=hero,
                core_indices=int(wood.core_indices or wood.triangles * 3))


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


def write_meshes(path, meshes, float_uvs, **extras):
    """A pack of named meshes: sprays (UVs inside the unit square) or props (UVs that tile)."""
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, (arrays, record) in meshes.items():
        positions, normals, uvs, colors, indices = arrays
        uv = (uvs.astype(np.float32), False) if float_uvs else (
            glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True)
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": uv,
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=record)
        summary[name] = record
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, meshes=summary, **extras))
    return writer.write(path), summary


def build_props(studio, bake=True):
    """Grow every prop and bake its occlusion with the prop standing on a ground plane."""
    built = {}
    for name, build in props.PROP_BUILDERS.items():
        positions, normals, uvs, colors, indices = build()
        if bake:
            import bpy
            obj = studio.mesh_object("prop_" + name, positions, indices)
            floor = None
            if name in props.GROUNDED:
                extent = 40.0
                floor = studio.mesh_object("prop_floor", np.array(
                    [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
                    np.array([[0, 2, 1], [0, 3, 2]]))
            try:
                ao = np.clip(studio.bake_vertex_ao(obj, distance=2.5, samples=32), 0.0, 1.0) ** 0.9
                colors = colors.copy()
                colors[:, 2] = np.clip(0.1 + 0.9 * ao, 0.0, 1.0)
            finally:
                for other in (obj, floor):
                    if other is not None:
                        mesh = other.data
                        bpy.data.objects.remove(other, do_unlink=True)
                        bpy.data.meshes.remove(mesh)
        low, high = positions.min(axis=0), positions.max(axis=0)
        record = dict(triangles=int(len(indices) // 3), boundsMin=[round(float(v), 4) for v in low],
                      boundsMax=[round(float(v), 4) for v in high])
        built[name] = ((positions, normals, uvs, colors, indices), record)
        print("%s prop %-10s tris=%5d  x %.2f..%.2f  y %.2f..%.2f  z %.2f..%.2f" % (
            TAG, name, record["triangles"], low[0], high[0], low[1], high[1], low[2], high[2]))
    return built


def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None, scratch_dir=None):
    """Build the glade's assets into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Forest - Night Atelier"
    studio_module.PREFIX = "SFOREST_"
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "foliage", "impostors", "props"))
    records = []
    studio = studio_module.Studio()
    preview = None
    sun = None
    if preview_dir:
        from forest_night import preview
        preview_dir = Path(preview_dir).expanduser().resolve()
        preview_dir.mkdir(parents=True, exist_ok=True)
        sun = studio.setup_preview(sun_direction=preview.FRONT, sun_strength=5.0, sky=(0.5, 0.5, 0.52))
    try:
        built = {}
        for kind, build in sprays.SPRAY_BUILDERS.items():
            for variant in range(SPRAY_VARIANTS):
                builder = build(variant)
                arrays = builder.arrays()
                low, high = arrays[0].min(axis=0), arrays[0].max(axis=0)
                built["%s_%d" % (kind, variant)] = (arrays, dict(
                    shoots=builder.leaves, triangles=builder.triangles,
                    boundsMin=[round(float(v), 4) for v in low], boundsMax=[round(float(v), 4) for v in high]))
        spray_arrays = {name: arrays for name, (arrays, _record) in built.items()}
        if "foliage" in wanted:
            path = output_dir / FOLIAGE_FILE
            _size, summary = write_meshes(path, built, float_uvs=False, variants=SPRAY_VARIANTS)
            records.append(grove.file_record(path, kind="foliage", variants=SPRAY_VARIANTS, meshes=summary))
            print(TAG, "foliage", json.dumps({name: record["triangles"] for name, record in summary.items()}))
            if preview:
                for name, arrays in spray_arrays.items():
                    preview.spray(studio, name, arrays, preview_dir / ("spray-%s.png" % name))
                preview.fern_clump(studio, [spray_arrays["fern_frond_0"], spray_arrays["fern_frond_1"]],
                                   preview_dir / "fern-clump.png")
                preview.fern_clump(studio, [spray_arrays["fern_frond_1"]], preview_dir / "fern-clump-far.png")
        stand = []
        if "trees" in wanted or "impostors" in wanted:
            for recipe in (recipes or trees.RECIPES):
                grown = grow(recipe)
                if bake:
                    grove.bake_bark_ao(studio, grown)
                tree = grown["tree"]
                if tree.meta["role"] == "grove":
                    stand.append(grown)
                if "trees" in wanted:
                    path = output_dir / ("%s.glb" % recipe)
                    write_tree(path, grown)
                    records.append(grove.file_record(path, kind="tree", species=tree.meta["species"],
                                                     role=tree.meta["role"], foliage=tree.meta["foliage"],
                                                     height=tree.meta["height"], sites=len(tree.sites),
                                                     barkTriangles=int(len(grown["bark"][4]) // 3)))
                if preview:
                    preview.tree(studio, grown, spray_arrays, preview_dir, sun)
        if "impostors" in wanted and stand:
            # The bake renders one PNG per tile on its way to the sheet; they do not belong in the pack.
            holder = None if scratch_dir else tempfile.TemporaryDirectory(prefix="forest-night-",
                                                                          ignore_cleanup_errors=True)
            scratch = Path(scratch_dir or holder.name).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            path = output_dir / IMPOSTOR_FILE
            fall_height = grove.IMPOSTOR_HEIGHT
            grove.IMPOSTOR_HEIGHT = IMPOSTOR_HEIGHT
            try:
                layout = grove.bake_impostors(studio, stand, spray_arrays, path, scratch)
            finally:
                grove.IMPOSTOR_HEIGHT = fall_height
                if holder is not None:
                    holder.cleanup()
            records.append(grove.file_record(path, kind="impostors", **layout))
        if "props" in wanted:
            path = output_dir / PROPS_FILE
            built_props = build_props(studio, bake=bake)
            _size, summary = write_meshes(path, built_props, float_uvs=True)
            records.append(grove.file_record(path, kind="props", meshes=summary))
            if preview:
                for name, (arrays, _record) in built_props.items():
                    preview.prop(studio, name, arrays, preview_dir / ("prop-%s.png" % name),
                                 stone=name.startswith("boulder"))
    finally:
        studio.dispose()
    return dict(schemaVersion=SCHEMA_VERSION, author="Serenity Blocks original procedural Blender authoring",
                license="MIT-project-local", glTFUpAxis="Y", assets=records)


def _main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {"out": None, "only": None, "preview": None, "recipes": None, "scratch": None, "no-bake": False}
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
        raise SystemExit("usage: blender -b --factory-startup --python forest_assets.py -- --out <dir>")
    manifest = build_assets(options["out"], only=options["only"].split(",") if options["only"] else None,
                            preview_dir=options["preview"], bake=not options["no-bake"],
                            recipes=options["recipes"].split(",") if options["recipes"] else None,
                            scratch_dir=options["scratch"])
    manifest_path = Path(options["out"]) / "asset-manifest.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"assets": []}
    merged = {entry["file"]: entry for entry in previous.get("assets", [])}
    merged.update({entry["file"]: entry for entry in manifest["assets"]})
    manifest["assets"] = [merged[name] for name in sorted(merged)]
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("%s wrote %d assets, %.1f KB" % (TAG, len(manifest["assets"]),
                                           sum(a["bytes"] for a in manifest["assets"]) / 1024))


if __name__ == "__main__":
    _main()
