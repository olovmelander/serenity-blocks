"""Original Serenity Blocks Grainfields trees and horse, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/grainfields_assets.py -- \
        --out src/themes/grainfields/assets [--only trees,foliage,impostors,horse] \
        [--preview <dir>] [--recipes larch-grove-a,birch-grove-b] [--no-bake] [--scratch <dir>]

The horse alone (about ten seconds; `--preview` adds half a minute of stills):

    blender --background --factory-startup --python scripts/blender/grainfields_assets.py -- \
        --out src/themes/grainfields/assets --only horse [--preview <dir>]

Hokkaido grain country at harvest: Japanese larch in the shelterbelts, Japanese white
birch along the lanes and Ezo spruce among them, grown with the Fall grove's branching
library (scripts/blender/fall_grove), the Golden Forest's conifer and needle helpers
(scripts/blender/golden_forest) and the Summer meadow's birch wood and spruce
(scripts/blender/summer_meadow), and written in the Summer pack's compact GLB layout: a bark
mesh plus a point cloud of foliage sites per tree, the shared sprays in one file, and a
sprite sheet of the trees for the far belts. Every tree is a grove tree (seen from 90 m to
3 km), so there are no heroes and no props. The herd's horse, a Hokkaido native horse
(Dosanko), is a distance field of ellipsoids and round cones polygonised and decimated to
one mesh of about five thousand triangles, painted with the part ids, masks and pivots the
theme poses it by (scripts/blender/grainfields/horse.py). No external assets are fetched:
every mesh and bake is generated here. Coordinates in the written GLBs are glTF Y-up metres
with each tree's base at the origin; the horse faces +z with its hooves on y = 0.
"""

import json
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
from grainfields import horse, leaves, preview, species  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
SPRAY_VARIANTS = grove.SPRAY_VARIANTS
GENERATOR = "Serenity Blocks - Grainfields (Blender authoring)"
TAG = "[grainfields]"
FOLIAGE_FILE = "grainfields-foliage.glb"
IMPOSTOR_FILE = "grainfields-impostors.png"
HORSE_FILE = "grainfields-horse.glb"

# The shared bake and preview helpers look sprays and preview colours up by kind.
grove.SPRAY_REACH.update(leaves.SPRAY_REACH)
grove.LEAF_PREVIEW.update(preview.LEAF_PREVIEW)


def grow(recipe):
    """Grow one specimen and derive everything that needs no Blender."""
    started = time.time()
    tree = species.RECIPES[recipe]()
    hero = tree.meta["role"] == "hero"
    bark = species.build_wood(tree, hero=hero, seed=len(recipe))
    positions = np.array([site.position for site in tree.sites])
    reach = leaves.SPRAY_REACH[tree.meta["foliage"]]
    radius = reach * float(np.mean([site.scale for site in tree.sites]))
    sky, bent = skeleton.foliage_visibility(positions, radius * 0.8, opacity=0.3)
    # The best-lit tenth of the crown defines full sky; the interior keeps its true ratio.
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


def write_foliage(path, sprays):
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, (builder, arrays) in sprays.items():
        positions, normals, uvs, colors, indices = arrays
        extras = {leaves.SPRAY_UNITS[name.rsplit("_", 1)[0]]: builder.leaves, "triangles": builder.triangles}
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
    """Build the fields' trees into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Grainfields - Atelier"
    studio_module.PREFIX = "SGRAIN_"
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "foliage", "impostors", "horse"))
    if preview_dir:
        preview_dir = Path(preview_dir).expanduser().resolve()
        preview_dir.mkdir(parents=True, exist_ok=True)
    records = []
    studio = studio_module.Studio()
    try:
        if preview_dir:
            # A low, warm sun under a storm-grey sky.
            studio.setup_preview(sun_direction=(-0.7, 0.3, 0.55), sun_strength=4.5, sky=preview.SKY,
                                 sky_strength=1.0)
        built = {}
        for kind, build in leaves.SPRAY_BUILDERS.items():
            for variant in range(SPRAY_VARIANTS):
                builder = build(variant)
                built["%s_%d" % (kind, variant)] = (builder, builder.arrays())
        sprays = {name: arrays for name, (_builder, arrays) in built.items()}
        if "foliage" in wanted:
            path = output_dir / FOLIAGE_FILE
            _size, summary = write_foliage(path, built)
            records.append(grove.file_record(path, kind="foliage", meshes=summary))
            print(TAG, "foliage", json.dumps(summary), flush=True)
        stand = []
        if "trees" in wanted or "impostors" in wanted:
            for recipe in (recipes or species.RECIPES):
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
                    low, high, triangles = preview.tree(studio, grown, sprays, preview_dir / ("%s.png" % recipe))
                    print("%s %-15s foliage tris=%7d x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f" % (
                        TAG, recipe, triangles, low[0], high[0], low[1], high[1], low[2], high[2]), flush=True)
            if preview_dir and stand:
                preview.lineup(studio, stand, sprays, preview_dir / "lineup-near.png", distance=95.0)
                preview.lineup(studio, stand, sprays, preview_dir / "lineup-far.png", distance=260.0,
                               eye_height=6.0, size=(1200, 300), samples=12)
        if "impostors" in wanted and stand:
            # The sprite renders pass through files; unless a scratch folder is named they
            # go to a temporary one, so nothing but the pack is left beside the assets.
            scratch = Path(scratch_dir or tempfile.mkdtemp(prefix="grainfields-")).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            path = output_dir / IMPOSTOR_FILE
            try:
                layout = preview.bake_impostors(studio, stand, sprays, path, scratch)
            finally:
                if not scratch_dir:
                    shutil.rmtree(scratch, ignore_errors=True)
            records.append(grove.file_record(path, kind="impostors", **layout))
            print("%s impostors %d x %d px, tiles %s" % (TAG, layout["atlasWidth"], layout["atlasHeight"],
                                                         [tile["pixels"] for tile in layout["tiles"]]), flush=True)
            if preview_dir:
                preview.impostor_contact(studio, path, preview_dir / "impostors-contact.png")
        if "horse" in wanted:
            model = horse.build(studio)
            path = output_dir / HORSE_FILE
            horse.write(path, model, generator=GENERATOR, schema_version=SCHEMA_VERSION)
            records.append(grove.file_record(path, kind="horse", **model.record()))
            if preview_dir:
                horse.previews(model, preview_dir)
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
        raise SystemExit("usage: blender -b --factory-startup --python grainfields_assets.py -- --out <dir>")
    started = time.time()
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
    print("%s wrote %d assets, %.1f KB in %.0f s" % (TAG, len(manifest["assets"]),
                                                    sum(a["bytes"] for a in manifest["assets"]) / 1024,
                                                    time.time() - started))


if __name__ == "__main__":
    _main()
