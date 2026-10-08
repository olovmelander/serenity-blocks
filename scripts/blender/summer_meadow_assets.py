"""Original Serenity Blocks Summer assets, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/summer_meadow_assets.py -- \
        --out src/themes/summer/assets [--only trees,foliage,impostors,props] \
        [--preview <dir>] [--recipes birch-hero,spruce-hero] [--no-bake] [--scratch <dir>]

A Swedish Midsummer's Eve by a lake: silver birches and Norway spruces grown with the Fall
grove's branching library (scripts/blender/fall_grove) and the Golden Forest's conifer
helpers (scripts/blender/golden_forest), written in the same compact GLB layout: a bark
mesh plus a point cloud of foliage sites per tree, shared leaf and needle sprays, and a
sprite sheet of the grove trees for the far shore. The red cottage, its boathouse, the
maypole, the jetty and the roundpole fence are modelled in scripts/blender/summer_meadow.
No external assets are fetched: every mesh and bake is generated here.
Coordinates in the written GLBs are glTF Y-up metres with each object's base at the origin.
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
from summer_meadow import kit, leaves, preview, props, species  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
SPRAY_VARIANTS = grove.SPRAY_VARIANTS
GENERATOR = "Serenity Blocks - Summer (Blender authoring)"
TAG = "[summer]"
FOLIAGE_FILE = "summer-foliage.glb"
IMPOSTOR_FILE = "summer-impostors.png"
PROPS_FILE = "summer-props.glb"

# The shared bake and preview helpers look sprays and preview colours up by kind.
grove.SPRAY_REACH.update(leaves.SPRAY_REACH)
grove.LEAF_PREVIEW.update({
    "birch": [(0.3, 0.52, 0.1), (0.38, 0.6, 0.12), (0.24, 0.44, 0.09), (0.46, 0.64, 0.14)],
    "spruce": [(0.1, 0.2, 0.08), (0.14, 0.26, 0.09), (0.2, 0.3, 0.1), (0.12, 0.22, 0.1)],
})


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


def _rounded(value):
    """Anchors for the manifest: plain lists and numbers, to the tenth of a millimetre."""
    if isinstance(value, dict):
        return {key: _rounded(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_rounded(item) for item in value]
    if isinstance(value, (bool, str)) or value is None:
        return value
    if isinstance(value, (int, np.integer)):
        return int(value)
    return round(float(value), 4) + 0.0       # (adding zero turns -0.0 into 0.0)


def _occlusion(studio, name, positions, indices, grounded):
    """Cycles ambient occlusion at every vertex of a mesh, over a floor if it stands on one."""
    import bpy
    obj = studio.mesh_object("prop_" + name, positions, indices)
    floor = None
    if grounded:
        extent = 40.0
        floor = studio.mesh_object("prop_floor", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]]))
    try:
        return np.clip(studio.bake_vertex_ao(obj, distance=2.5, samples=192), 0.0, 1.0)
    finally:
        for other in (obj, floor):
            if other is not None:
                mesh = other.data
                bpy.data.objects.remove(other, do_unlink=True)
                bpy.data.meshes.remove(mesh)


def bake_prop_ao(studio, name, arrays, grounded, structure=None):
    """Cycles ambient occlusion into the blue channel of a prop's colours.

    Trim takes the bake of the whole prop. The broad surfaces behind it (`structure`) are
    baked again without the trim: a wall has a vertex only at each corner of each opening,
    and the casing standing on that corner would otherwise darken a square metre of boards.
    """
    positions, normals, uvs, colors, indices = arrays
    ao = _occlusion(studio, name, positions, indices, grounded)
    if structure is not None and not structure.all() and structure.any():
        triangles = np.asarray(indices).reshape(-1, 3)
        kept = triangles[structure[triangles].all(axis=1)]
        remap = np.cumsum(structure) - 1
        ao[structure] = _occlusion(studio, name + "_structure", positions[structure], remap[kept], grounded)
    # Flat faces are built corner by corner: corners that share a place and a facing share
    # their shade, or every board would show its own seam.
    keys = np.concatenate([np.round(positions, 4), np.round(normals, 2)], axis=1)
    _groups, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = np.asarray(inverse).reshape(-1)
    ao = (np.bincount(inverse, weights=ao) / np.bincount(inverse))[inverse] ** 0.9
    colors = colors.copy()
    colors[:, 2] = np.clip(0.1 + 0.9 * ao, 0.0, 1.0)
    return positions, normals, uvs, colors, indices


def build_props(studio, bake=True):
    """Every prop as final arrays (occlusion baked) with its record for the manifest."""
    built = {}
    for name, build in props.PROP_BUILDERS.items():
        started = time.time()
        prop = build()
        arrays = prop.arrays
        if bake:
            arrays = bake_prop_ao(studio, name, arrays, prop.grounded, prop.structure)
        positions, _normals, _uvs, colors, indices = arrays
        low, high = positions.min(axis=0), positions.max(axis=0)
        codes = np.round(colors[:, 1] * kit.CODES).astype(int)
        record = dict(triangles=int(len(indices) // 3), vertices=int(len(positions)),
                      boundsMin=_rounded(low), boundsMax=_rounded(high), size=_rounded(high - low),
                      materials=sorted(kit.CODE_NAMES[code] for code in set(codes.tolist())),
                      anchors=_rounded(prop.anchors))
        built[name] = (arrays, record, prop.grounded)
        print("%s prop %-10s tris=%5d verts=%5d size %.2f x %.2f x %.2f  ao %.2f..%.2f  %.1fs" % (
            TAG, name, record["triangles"], record["vertices"], *(high - low), colors[:, 2].min(),
            colors[:, 2].mean(), time.time() - started), flush=True)
    return built


def write_props(path, built):
    """The props as plain meshes whose colour carries shading data; anchors ride in the extras."""
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, (arrays, record, _grounded) in built.items():
        positions, normals, uvs, colors, indices = arrays
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=record)
        summary[name] = record
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, materialCodes=list(kit.CODE_NAMES), uvMetres=kit.UV_SPAN,
                           meshes=summary))
    return writer.write(path), summary


def preview_props(studio, built, directory):
    for name, (arrays, _record, grounded) in built.items():
        preview.prop(studio, name, arrays, directory, grounded=grounded)
    cottage = built["cottage"][0]
    preview.closeup(studio, "cottage", cottage, directory, "porch", eye=(3.4, 1.7, 9.2), target=(0.3, 1.6, 2.9),
                    lens=42.0)
    preview.closeup(studio, "cottage", cottage, directory, "gable", eye=(13.5, 2.2, 5.5), target=(3.6, 3.0, 0.0),
                    lens=42.0)
    preview.closeup(studio, "cottage", cottage, directory, "back", eye=(-8.0, 5.5, -13.0), target=(0.0, 2.6, 0.0),
                    lens=42.0)
    maypole = built["maypole"][0]
    preview.closeup(studio, "maypole", maypole, directory, "wreath", eye=(2.6, 5.0, 4.2), target=(1.2, 5.3, 0.0),
                    lens=50.0)


def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None, scratch_dir=None):
    """Build the meadow's assets into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Summer - Atelier"
    studio_module.PREFIX = "SSUMMER_"
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "foliage", "impostors", "props"))
    if preview_dir:
        preview_dir = Path(preview_dir).expanduser().resolve()
        preview_dir.mkdir(parents=True, exist_ok=True)
    records = []
    studio = studio_module.Studio()
    try:
        if preview_dir:
            studio.setup_preview(sun_direction=(-0.62, 0.34, 0.6), sun_strength=5.0, sky=(0.5, 0.56, 0.68),
                                 sky_strength=0.9)
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
        if "props" in wanted:
            path = output_dir / PROPS_FILE
            finished = build_props(studio, bake=bake)
            _size, summary = write_props(path, finished)
            records.append(grove.file_record(path, kind="props", meshes=summary))
            if preview_dir:
                preview_props(studio, finished, preview_dir)
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
                    if grown["hero"]:
                        height = tree.meta["height"]
                        preview.tree(studio, grown, sprays, preview_dir / ("%s-detail.png" % recipe),
                                     eye=(-2.5, height * 0.34, height * 0.62), target=(-2.2, height * 0.5, 0.0),
                                     lens=38.0, size=(1000, 1000))
        if "impostors" in wanted and stand:
            # The sprite renders pass through files; unless a scratch folder is named they
            # go to a temporary one, so nothing but the pack is left beside the assets.
            scratch = Path(scratch_dir or tempfile.mkdtemp(prefix="summer-meadow-")).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            path = output_dir / IMPOSTOR_FILE
            try:
                layout = grove.bake_impostors(studio, stand, sprays, path, scratch)
            finally:
                if not scratch_dir:
                    shutil.rmtree(scratch, ignore_errors=True)
            records.append(grove.file_record(path, kind="impostors", **layout))
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
        raise SystemExit("usage: blender -b --factory-startup --python summer_meadow_assets.py -- --out <dir>")
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
