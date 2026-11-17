"""Original Serenity Blocks High Coast trees, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/high_coast_assets.py -- \
        --out src/themes/high-coast/assets [--only trees,foliage,sprites] [--preview <dir>] \
        [--recipes pine-old] [--no-bake] [--scratch <dir>]

The old Scots pine on the summit knoll (scripts/blender/high_coast/species.py) is grown with the
Fall grove's branching library (scripts/blender/fall_grove) and written in the grove's compact
GLB layout: a bark mesh, a point cloud of foliage sites, and its needle sprays in one shared
file (scripts/blender/high_coast/needles.py). The forest's Scots pines and Norway spruces are
the Golden Forest's conifer recipes (scripts/blender/golden_forest) at the coast's sizes; they
stand half a kilometre and more from the eye, so they are written only as sprites: a sheet of
shading data and a sheet of normals, of single trees and of small groups
(scripts/blender/high_coast/preview.py). No external assets are fetched: every mesh and bake is
generated here. Coordinates in the written GLBs are glTF Y-up metres; the old pine stands in
the frame the theme places it in (+X the view's right, +Z toward the eye, the rock at y = 0).
"""

import json
import math
from pathlib import Path
import shutil
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

import fall_grove_assets as grove  # noqa: E402
from fall_grove import glb, skeleton  # noqa: E402
from high_coast import needles, preview, species  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
SPRAY_VARIANTS = grove.SPRAY_VARIANTS
GENERATOR = "Serenity Blocks - High Coast (Blender authoring)"
TAG = "[high-coast]"
FOLIAGE_FILE = "high-coast-foliage.glb"
SPRITE_FILE = "high-coast-trees.png"
SPRITE_NORMAL_FILE = "high-coast-trees-normal.png"
MANIFEST_FILE = "trees-manifest.json"

# The shared bake and preview helpers look sprays and preview colours up by kind.
grove.SPRAY_REACH.update(needles.SPRAY_REACH)
grove.LEAF_PREVIEW.update(preview.LEAF_PREVIEW)


def grow(recipe):
    """Grow one specimen and derive everything that needs no Blender."""
    started = time.time()
    tree = species.RECIPES[recipe]()
    hero = tree.meta["role"] == "hero"
    bark = species.build_wood(tree, hero=hero, seed=len(recipe))
    positions = np.array([site.position for site in tree.sites])
    reach = needles.SPRAY_REACH[tree.meta["foliage"]]
    radius = reach * float(np.mean([site.scale for site in tree.sites]))
    sky, bent = skeleton.foliage_visibility(positions, radius * 0.8, opacity=0.3)
    # The best-lit tenth of the crown defines full sky; the interior keeps its true ratio.
    sky = np.clip(sky / max(1e-4, float(np.percentile(sky, 90))), 0.0, 1.0)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s %-15s branches=%4d bark_tris=%6d sites=%5d sky=%.2f..%.2f crown x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f"
          "  %.1fs" % (TAG, recipe, len(tree.branches), bark.triangles, len(tree.sites), sky.min(), sky.mean(),
                       low[0], high[0], low[1], high[1], low[2], high[2], time.time() - started), flush=True)
    return dict(tree=tree, bark=bark.arrays(), wood=getattr(bark, "wood", None),
                level_indices=getattr(bark, "level_indices", None), positions=positions, sky=sky,
                bent=bent, frames=grove.site_frames(tree.sites), hero=hero,
                core_indices=int(bark.core_indices or bark.triangles * 3))


def crown_bearing(points):
    """The furthest right a point of the old pine stands in the theme's view (degrees of bearing)."""
    bearing = math.radians(preview.VIEW_BEARING)
    eye = np.asarray(preview.VIEW_EYE)
    # In the tree's frame the eye looks along (sin b, 0, -cos b) at bearing zero.
    forward = np.array([math.sin(bearing), 0.0, -math.cos(bearing)])
    right = np.array([math.cos(bearing), 0.0, math.sin(bearing)])
    delta = np.asarray(points) - eye
    return float(np.degrees(np.arctan2(delta @ right, delta @ forward)).max())


def write_tree(path, grown):
    tree = grown["tree"]
    positions, normals, uvs, colors, indices = grown["bark"]
    writer = glb.GlbWriter(generator=GENERATOR)
    attributes = {
        "POSITION": (positions, False),
        "NORMAL": (glb.quantize_unit(normals, np.int8), True),
        "TEXCOORD_0": (uvs.astype(np.float32), False),
        "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
    }
    if grown["wood"] is not None:
        attributes["_WOOD"] = (glb.quantize_unit(grown["wood"], np.uint8), True)
    writer.add_mesh("bark", attributes, indices=indices)
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
        barkLevelIndices=[int(v) for v in (grown["level_indices"] or [])],
        crownCentre=[float(v) for v in envelope.centre], crownRadii=[float(v) for v in envelope.radii],
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


def write_foliage(path, sprays):
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, (builder, arrays) in sprays.items():
        positions, normals, uvs, colors, indices = arrays
        extras = {needles.SPRAY_UNITS[name.rsplit("_", 1)[0]]: builder.leaves, "triangles": builder.triangles}
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=extras)
        summary[name] = extras
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, variants=SPRAY_VARIANTS, meshes=summary))
    return writer.write(path), summary


def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None, scratch_dir=None):
    """Build the coast's trees into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity High Coast - Atelier"
    studio_module.PREFIX = "SHCOAST_"
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "foliage", "sprites"))
    if preview_dir:
        preview_dir = Path(preview_dir).expanduser().resolve()
        preview_dir.mkdir(parents=True, exist_ok=True)
    records = []
    studio = studio_module.Studio()
    try:
        if preview_dir:
            # A high summer morning: the sun over the eye's right shoulder.
            studio.setup_preview(sun_direction=(0.55, 0.62, 0.56), sun_strength=4.6, sky=preview.SKY,
                                 sky_strength=1.0)
        built = {}
        for kind, build in needles.SPRAY_BUILDERS.items():
            for variant in range(SPRAY_VARIANTS):
                builder = build(variant)
                built["%s_%d" % (kind, variant)] = (builder, builder.arrays())
        sprays = {name: arrays for name, (_builder, arrays) in built.items()}
        if "foliage" in wanted:
            path = output_dir / FOLIAGE_FILE
            shipped = {name: entry for name, entry in built.items() if name.rsplit("_", 1)[0] in needles.SHIPPED}
            _size, summary = write_foliage(path, shipped)
            records.append(grove.file_record(path, kind="foliage", meshes=summary))
            print(TAG, "foliage", json.dumps(summary), flush=True)
        stand = []
        if "trees" in wanted or "sprites" in wanted:
            for recipe in (recipes or species.RECIPES):
                grown = grow(recipe)
                if bake:
                    grove.bake_bark_ao(studio, grown)
                tree = grown["tree"]
                hero = tree.meta["role"] == "hero"
                if not hero:
                    stand.append(grown)
                if hero and "trees" in wanted:
                    path = output_dir / ("%s.glb" % recipe)
                    write_tree(path, grown)
                    records.append(grove.file_record(path, kind="tree", species=tree.meta["species"],
                                                     role=tree.meta["role"], sites=len(tree.sites),
                                                     barkTriangles=int(len(grown["bark"][4]) // 3)))
                if preview_dir:
                    leaf_positions, low, high, triangles = preview.tree(studio, grown, sprays,
                                                                        preview_dir / ("%s.png" % recipe))
                    print("%s %-15s foliage tris=%7d x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f" % (
                        TAG, recipe, triangles, low[0], high[0], low[1], high[1], low[2], high[2]), flush=True)
                    if hero:
                        print("%s %-15s crown reaches bearing %.2f deg in the view" % (
                            TAG, recipe, crown_bearing(leaf_positions)), flush=True)
                        preview.view(studio, grown, sprays, preview_dir / ("%s-view.png" % recipe))
                        preview.view(studio, grown, sprays, preview_dir / ("%s-view-tall.png" % recipe),
                                     size=(540, 1170), lens=12.8, pitch=4.0)
                        preview.close(studio, grown, sprays, preview_dir / ("%s-bole.png" % recipe),
                                      eye=(1.5, 5.4, 9.5), target=(0.6, 4.4, 0.0), lens=42.0)
                        preview.close(studio, grown, sprays, preview_dir / ("%s-limb.png" % recipe),
                                      eye=(5.0, 7.2, 7.5), target=(5.2, 8.6, -1.0), lens=50.0)
            if preview_dir and stand:
                preview.lineup(studio, stand, sprays, preview_dir / "lineup.png", distance=120.0)
        if "sprites" in wanted and stand:
            # The sprite renders pass through files; unless a scratch folder is named they
            # go to a temporary one, so nothing but the pack is left beside the assets.
            scratch = Path(scratch_dir or tempfile.mkdtemp(prefix="high-coast-")).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            data_path = output_dir / SPRITE_FILE
            normal_path = output_dir / SPRITE_NORMAL_FILE
            try:
                layout = preview.bake_sprites(studio, stand, sprays, data_path, normal_path, scratch)
            finally:
                if not scratch_dir:
                    shutil.rmtree(scratch, ignore_errors=True)
            records.append(grove.file_record(data_path, kind="sprites", **layout))
            records.append(grove.file_record(normal_path, kind="sprite-normals"))
            print("%s sprites %d x %d px, tiles %s" % (TAG, layout["atlasWidth"], layout["atlasHeight"],
                                                       [(tile["asset"], tile["pixels"]) for tile in layout["tiles"]]),
                  flush=True)
            if preview_dir:
                preview.sprite_contact(studio, data_path, normal_path, preview_dir / "sprites-contact.png")
    finally:
        studio.dispose()
    return dict(schemaVersion=SCHEMA_VERSION, author="Serenity Blocks original procedural Blender authoring",
                license="Proprietary (project-owned)", glTFUpAxis="Y", assets=records)


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
        raise SystemExit("usage: blender -b --factory-startup --python high_coast_assets.py -- --out <dir>")
    started = time.time()
    manifest = build_assets(options["out"], only=options["only"].split(",") if options["only"] else None,
                            preview_dir=options["preview"], bake=not options["no-bake"],
                            recipes=options["recipes"].split(",") if options["recipes"] else None,
                            scratch_dir=options["scratch"])
    manifest_path = Path(options["out"]) / MANIFEST_FILE
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
