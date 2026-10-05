"""Original Serenity Blocks Golden Forest assets, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/golden_forest_assets.py -- \
        --out src/themes/golden-forest/assets [--only trees,foliage,impostors,props] \
        [--preview reports/golden-forest/preview] [--recipes spruce-hero,pine-hero] [--no-bake]

The conifers are grown with the Fall grove's branching library (scripts/blender/fall_grove)
and written in the same compact GLB layout: a bark mesh plus a point cloud of foliage
sites per tree, shared needle sprays, and a sprite sheet of the grove trees for the far
shore. No external assets are fetched: every mesh and bake is generated here.
Coordinates in the written GLBs are glTF Y-up metres with each object's base at the origin.
"""

import json
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

import fall_grove_assets as grove  # noqa: E402
from fall_grove import glb, skeleton  # noqa: E402
from golden_forest import conifers, needles, props  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
SPRAY_VARIANTS = grove.SPRAY_VARIANTS
GENERATOR = "Serenity Blocks - Golden Forest (Blender authoring)"
TAG = "[golden-forest]"

# The shared bake and preview helpers look sprays and preview colours up by kind.
grove.SPRAY_REACH.update(needles.SPRAY_REACH)
grove.LEAF_PREVIEW.update({
    "spruce": [(0.1, 0.2, 0.08), (0.14, 0.26, 0.09), (0.2, 0.3, 0.1), (0.12, 0.22, 0.1)],
    "pine": [(0.16, 0.28, 0.1), (0.2, 0.32, 0.12), (0.24, 0.34, 0.12), (0.18, 0.3, 0.14)],
})


def grow(recipe):
    """Grow one specimen and derive everything that needs no Blender."""
    started = time.time()
    tree = conifers.RECIPES[recipe]()
    hero = tree.meta["role"] == "hero"
    bark = conifers.build_wood(tree, hero=hero, seed=len(recipe))
    positions = np.array([site.position for site in tree.sites])
    reach = needles.SPRAY_REACH[tree.meta["foliage"]]
    radius = reach * float(np.mean([site.scale for site in tree.sites]))
    sky, bent = skeleton.foliage_visibility(positions, radius * 0.8, opacity=0.3)
    # The best-lit tenth of the crown defines full sky; the interior keeps its true ratio.
    sky = np.clip(sky / max(1e-4, float(np.percentile(sky, 90))), 0.0, 1.0)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s %-15s branches=%4d bark_tris=%6d sites=%5d sky=%.2f..%.2f crown x %.1f..%.1f y %.1f..%.1f  %.1fs" % (
        TAG, recipe, len(tree.branches), bark.triangles, len(tree.sites), sky.min(), sky.mean(),
        low[0], high[0], low[1], high[1], time.time() - started))
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


def write_foliage(path, sprays):
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, (builder, arrays) in sprays.items():
        positions, normals, uvs, colors, indices = arrays
        extras = dict(shoots=builder.leaves, triangles=builder.triangles)
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=extras)
        summary[name] = extras
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, variants=SPRAY_VARIANTS, meshes=summary))
    return writer.write(path), summary


def write_props(path, studio, bake=True):
    """Boat, jetty, boulders and the snag: plain meshes whose colour carries shading data."""
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
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
        extras = dict(triangles=int(len(indices) // 3))
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (uvs.astype(np.float32), False),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=extras)
        summary[name] = extras
        print("%s prop %-10s tris=%5d" % (TAG, name, extras["triangles"]))
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, meshes=summary))
    return writer.write(path), summary


def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None, scratch_dir=None):
    """Build the lake's assets into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Golden Forest - Atelier"
    studio_module.PREFIX = "SGOLD_"
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "foliage", "impostors", "props"))
    records = []
    studio = studio_module.Studio()
    try:
        built = {}
        for kind, build in needles.SPRAY_BUILDERS.items():
            for variant in range(SPRAY_VARIANTS):
                builder = build(variant)
                built["%s_%d" % (kind, variant)] = (builder, builder.arrays())
        sprays = {name: arrays for name, (_builder, arrays) in built.items()}
        if "foliage" in wanted:
            path = output_dir / "golden-forest-foliage.glb"
            _size, summary = write_foliage(path, built)
            records.append(grove.file_record(path, kind="foliage", meshes=summary))
            print(TAG, "foliage", json.dumps(summary))
        stand = []
        if "trees" in wanted or "impostors" in wanted:
            if preview_dir:
                studio.setup_preview(sun_direction=(-0.38, 0.2, -0.9), sun_strength=6.0, sky=(0.5, 0.42, 0.36))
            for recipe in (recipes or conifers.RECIPES):
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
                                                     role=tree.meta["role"], sites=len(tree.sites),
                                                     barkTriangles=int(len(grown["bark"][4]) // 3)))
                if preview_dir:
                    Path(preview_dir).mkdir(parents=True, exist_ok=True)
                    grove.preview(studio, grown, sprays, Path(preview_dir) / ("%s.png" % recipe))
        if "impostors" in wanted and stand:
            scratch = Path(scratch_dir or (output_dir / ".scratch")).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            path = output_dir / "golden-forest-impostors.png"
            layout = grove.bake_impostors(studio, stand, sprays, path, scratch)
            records.append(grove.file_record(path, kind="impostors", **layout))
        if "props" in wanted:
            path = output_dir / "golden-forest-props.glb"
            _size, summary = write_props(path, studio, bake=bake)
            records.append(grove.file_record(path, kind="props", meshes=summary))
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
        raise SystemExit("usage: blender -b --factory-startup --python golden_forest_assets.py -- --out <dir>")
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
