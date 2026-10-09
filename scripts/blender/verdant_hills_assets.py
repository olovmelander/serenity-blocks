"""Original Serenity Blocks Verdant Hills assets, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/verdant_hills_assets.py -- \
        --out src/themes/verdant-hills/assets [--only trees,foliage,impostors,props] \
        [--preview <dir>] [--recipes oak-hero,oak-field-a] [--props wall,gate] [--no-bake] [--scratch <dir>]

A bright, windy day on rolling green downs: an old open-grown English oak and three round
field trees, grown mass by mass in scripts/blender/verdant_hills on the Fall grove's
branching library (scripts/blender/fall_grove) and written in the same compact GLB layout
as the Summer meadow's trees: a bark mesh plus a point cloud of foliage sites per tree,
shared leaf sprays, and a sprite sheet of all four trees for the far hills. The tower mill
and its sails, the drystone wall, the field gate, the bench, the outcrops, the sheep and
the fence post are modelled in scripts/blender/verdant_hills with the Summer meadow's kit.
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
from verdant_hills import kit, leaves, preview, props, species  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
SPRAY_VARIANTS = grove.SPRAY_VARIANTS
GENERATOR = "Serenity Blocks - Verdant Hills (Blender authoring)"
TAG = "[verdant]"
FOLIAGE_FILE = "verdant-foliage.glb"
IMPOSTOR_FILE = "verdant-impostors.png"
PROPS_FILE = "verdant-props.glb"
IMPOSTOR_HEIGHT = 448
IMPOSTOR_WIDEST = 704          # the old oak is half as wide again as it is tall

# The shared bake and preview helpers look sprays and preview colours up by kind.
grove.SPRAY_REACH.update(leaves.SPRAY_REACH)
grove.LEAF_PREVIEW.update({"oak": preview.LEAF_COLOURS})


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
    levels = {}
    for branch in tree.branches:
        levels[branch.kind] = levels.get(branch.kind, 0) + 1
    print("%s %-12s branches=%4d %s bark_tris=%6d sites=%5d sky=%.2f..%.2f crown x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f"
          "  %.1fs" % (TAG, recipe, len(tree.branches), json.dumps(levels, sort_keys=True), bark.triangles,
                       len(tree.sites), sky.min(), sky.mean(), low[0], high[0], low[1], high[1], low[2], high[2],
                       time.time() - started), flush=True)
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
    meta = dict(tree.meta)
    meta["anchors"] = _rounded(meta.get("anchors", {}))
    writer.set_extras(dict(
        schemaVersion=SCHEMA_VERSION, name=tree.name, **meta,
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
        low, high = positions.min(axis=0), positions.max(axis=0)
        extras = {leaves.SPRAY_UNITS[name.rsplit("_", 1)[0]]: builder.leaves, "triangles": builder.triangles,
                  "boundsMin": _rounded(low), "boundsMax": _rounded(high)}
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=extras)
        summary[name] = extras
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, variants=SPRAY_VARIANTS, meshes=summary))
    return writer.write(path), summary


# -- props --------------------------------------------------------------------------------
def _occlusion(studio, name, positions, indices, grounded, period=None):
    """Cycles ambient occlusion at every vertex of a mesh, over a floor if it stands on one.

    A prop that tiles along X (`period` metres) is baked between two copies of itself, so
    its ends are shaded as the middle of a run and not as the end of one.
    """
    import bpy
    obj = studio.mesh_object("prop_" + name, positions, indices)
    others = []
    if grounded:
        extent = 40.0
        others.append(studio.mesh_object("prop_floor", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]])))
    if period:
        for side in (-1.0, 1.0):
            others.append(studio.mesh_object("prop_neighbour", positions + np.array([side * period, 0.0, 0.0]),
                                             indices))
    try:
        return np.clip(studio.bake_vertex_ao(obj, distance=2.5, samples=192), 0.0, 1.0)
    finally:
        for other in [obj] + others:
            mesh = other.data
            bpy.data.objects.remove(other, do_unlink=True)
            bpy.data.meshes.remove(mesh)


def bake_prop_ao(studio, name, arrays, grounded, structure=None, period=None):
    """Cycles ambient occlusion into the blue channel of a prop's colours.

    Trim takes the bake of the whole prop. The broad surfaces behind it (`structure`) are
    baked again without the trim: a wall has a vertex only at each corner of each opening,
    and the casing standing on that corner would otherwise darken a square metre of wash.
    """
    positions, normals, uvs, colors, indices = arrays
    ao = _occlusion(studio, name, positions, indices, grounded, period)
    if structure is not None and not structure.all() and structure.any():
        triangles = np.asarray(indices).reshape(-1, 3)
        kept = triangles[structure[triangles].all(axis=1)]
        remap = np.cumsum(structure) - 1
        ao[structure] = _occlusion(studio, name + "_structure", positions[structure], remap[kept], grounded, period)
    # Flat faces are built corner by corner: corners that share a place and a facing share
    # their shade, or every board would show its own seam. On a prop that tiles, the two
    # ends are one place.
    place = np.round(positions, 4)
    if period:
        place[:, 0] = np.round(positions[:, 0] + period * 0.5, 4) % period
    keys = np.concatenate([place, np.round(normals, 2)], axis=1)
    _groups, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = np.asarray(inverse).reshape(-1)
    ao = (np.bincount(inverse, weights=ao) / np.bincount(inverse))[inverse] ** 0.9
    colors = colors.copy()
    colors[:, 2] = np.clip(0.1 + 0.9 * ao, 0.0, 1.0)
    return positions, normals, uvs, colors, indices


def build_props(studio, bake=True, names=None):
    """Every prop as final arrays (occlusion baked) with its record for the manifest."""
    built = {}
    for name, build in props.PROP_BUILDERS.items():
        if names and name not in names:
            continue
        started = time.time()
        prop = build()
        arrays = prop.arrays
        if bake:
            arrays = bake_prop_ao(studio, name, arrays, prop.grounded, prop.structure, prop.period)
        positions, _normals, _uvs, colors, indices = arrays
        low, high = positions.min(axis=0), positions.max(axis=0)
        codes = np.round(colors[:, 1] * kit.CODES).astype(int)
        record = dict(triangles=int(len(indices) // 3), vertices=int(len(positions)),
                      boundsMin=_rounded(low), boundsMax=_rounded(high), size=_rounded(high - low),
                      materials=sorted(kit.CODE_NAMES[code] for code in set(codes.tolist())),
                      anchors=_rounded(prop.anchors))
        built[name] = (arrays, record, prop.grounded)
        print("%s prop %-14s tris=%5d verts=%5d size %.2f x %.2f x %.2f  ao %.2f..%.2f  %.1fs" % (
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
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, materialCodes=list(kit.CODE_NAMES),
                           materialCodeScale=int(kit.CODES), uvMetres=kit.UV_SPAN, meshes=summary))
    return writer.write(path), summary


def preview_props(studio, built, directory):
    for name, (arrays, _record, grounded) in built.items():
        preview.prop(studio, name, arrays, directory, grounded=grounded)
    if "windmill" in built and "windmill_sails" in built:
        mill, record, _grounded = built["windmill"]
        sails = props.place_sails(built["windmill_sails"][0], record["anchors"])
        extra = [("windmill_sails", sails)]
        preview.prop(studio, "windmill-with-sails", mill, directory, extra=extra, size=(1000, 1200))
        preview.closeup(studio, "windmill", mill, directory, "stage", eye=(7.5, 2.4, 10.5), target=(0.0, 3.4, 0.0),
                        lens=40.0, extra=extra)
        preview.closeup(studio, "windmill", mill, directory, "cap", eye=(9.0, 10.0, 13.0), target=(0.0, 12.4, 0.5),
                        lens=50.0, extra=extra)
        preview.closeup(studio, "windmill", mill, directory, "door", eye=(2.2, 1.7, 8.5), target=(0.0, 1.6, 2.5),
                        lens=40.0)
    if "wall" in built:
        wall = built["wall"][0]
        run = [("wall", props.shifted(wall, (-4.0, 0.0, 0.0))), ("wall", props.shifted(wall, (4.0, 0.0, 0.0)))]
        if "wall_head" in built:
            run.append(("wall_head", props.shifted(built["wall_head"][0], (6.0, 0.0, 0.0))))
        preview.closeup(studio, "wall", wall, directory, "run", eye=(4.5, 1.5, 6.5), target=(1.5, 0.6, 0.0), lens=35.0,
                        extra=run)
        preview.closeup(studio, "wall", wall, directory, "near", eye=(1.2, 1.25, 2.3), target=(0.4, 0.62, 0.0),
                        lens=35.0, extra=run)
        preview.closeup(studio, "wall", wall, directory, "seam", eye=(2.0, 1.0, 2.6), target=(2.0, 0.6, 0.0), lens=40.0,
                        extra=run)


# -- sprite sheet -------------------------------------------------------------------------
def dilate(pixels, iterations=12, threshold=0.02):
    """Bleed colour into transparent texels so mip-mapped edges do not darken.

    The Fall grove's bleed, but it stops at the edges of the tile: a trunk standing on the
    bottom row is not carried round to the top one.
    """
    rgb = pixels[:, :, :3].copy()
    known = pixels[:, :, 3] > threshold
    rows, columns = known.shape
    for _ in range(iterations):
        padded_rgb = np.zeros((rows + 2, columns + 2, 3), dtype=rgb.dtype)
        padded_known = np.zeros((rows + 2, columns + 2), dtype=bool)
        padded_rgb[1:-1, 1:-1] = rgb
        padded_known[1:-1, 1:-1] = known
        total = np.zeros_like(rgb)
        weight = np.zeros(known.shape, dtype=np.float32)
        for shift_y in (0, 1, 2):
            for shift_x in (0, 1, 2):
                if shift_y == 1 and shift_x == 1:
                    continue
                near = padded_known[shift_y:shift_y + rows, shift_x:shift_x + columns]
                total += padded_rgb[shift_y:shift_y + rows, shift_x:shift_x + columns] * near[:, :, None]
                weight += near
        fill = (~known) & (weight > 0)
        rgb[fill] = total[fill] / weight[fill][:, None]
        known = known | fill
    result = pixels.copy()
    result[:, :, :3] = rgb
    return result


def bake_impostors(studio, grown_trees, sprays, path, scratch):
    """Front-elevation data sprites of the trees for the far hills.

    The Fall grove's bake with a wider limit: each tile is fitted to its crown, so tiles
    differ in width; the manifest records every tile's pixel rectangle, its size in metres
    and where the trunk stands inside it.
    """
    import bpy
    material = studio.data_material("impostor")
    tile_height = IMPOSTOR_HEIGHT
    renders = []
    tiles = []
    cursor = 0
    for grown in grown_trees:
        tree = grown["tree"]
        positions, colors, indices = grove.impostor_mesh(grown, sprays)
        low = positions.min(axis=0)
        high = positions.max(axis=0)
        height = float(high[1]) * 1.04
        width = float(high[0] - low[0]) * 1.06
        tile_width = int(min(IMPOSTOR_WIDEST, max(160, round(tile_height * width / height / 16.0) * 16)))
        width = height * tile_width / tile_height
        centre_x = float(low[0] + high[0]) * 0.5
        obj = studio.mesh_object(tree.name + "_impostor", positions, indices, colors=colors, smooth=False)
        obj.data.materials.append(material)
        pixels = studio.render_orthographic(scratch / ("%s-impostor.png" % tree.name),
                                            centre=(centre_x, height * 0.5, 0.0), width=width, height=height,
                                            size=(tile_width, tile_height), samples=24)
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        renders.append(dilate(pixels, iterations=12))
        tiles.append(dict(asset=tree.name, species=tree.meta["species"], role=tree.meta["role"], x=cursor,
                          pixels=tile_width, width=width, height=height, trunk=-centre_x / width,
                          coverage=float((pixels[:, :, 3] > 0.5).mean())))
        cursor += tile_width
    atlas = np.zeros((tile_height, cursor, 4), dtype=np.float32)
    for tile, pixels in zip(tiles, renders):
        atlas[:, tile["x"]:tile["x"] + tile["pixels"]] = pixels
    studio.save_image(path, atlas)
    return dict(atlasWidth=cursor, atlasHeight=tile_height, tiles=tiles)


def preview_tree(studio, grown, sprays, directory, recipe):
    low, high, triangles = preview.tree(studio, grown, sprays, directory / ("%s.png" % recipe))
    print("%s %-12s foliage tris=%7d x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f" % (
        TAG, recipe, triangles, low[0], high[0], low[1], high[1], low[2], high[2]), flush=True)
    if not grown["hero"]:
        return
    # The elevations the brief is judged by, the bare scaffold, and the views from the grass.
    wide = dict(lens=70.0, size=(1300, 900))
    preview.tree(studio, grown, sprays, directory / ("%s-front.png" % recipe), eye=(0.5, 5.0, 62.0),
                 target=(0.5, 7.6, 0.0), **wide)
    preview.tree(studio, grown, sprays, directory / ("%s-side.png" % recipe), eye=(62.0, 5.0, 0.0),
                 target=(0.0, 7.6, 0.0), **wide)
    preview.tree(studio, grown, sprays, directory / ("%s-back.png" % recipe), eye=(-30.0, 5.0, -54.0),
                 target=(0.0, 7.6, 0.0), **wide)
    preview.tree(studio, grown, sprays, directory / ("%s-wood.png" % recipe), eye=(0.5, 5.0, 62.0),
                 target=(0.5, 7.6, 0.0), foliage=False, **wide)
    preview.tree(studio, grown, sprays, directory / ("%s-wood-side.png" % recipe), eye=(40.0, 16.0, 40.0),
                 target=(0.0, 7.0, 0.0), foliage=False, lens=50.0, size=(1300, 900))
    preview.tree(studio, grown, sprays, directory / ("%s-under.png" % recipe), eye=(-4.5, 1.7, 9.5),
                 target=(3.5, 6.2, 0.0), lens=22.0, size=(1300, 900))
    preview.tree(studio, grown, sprays, directory / ("%s-bough.png" % recipe), eye=(4.0, 1.7, 12.0),
                 target=(6.0, 5.2, 0.0), lens=28.0, size=(1300, 900))
    preview.tree(studio, grown, sprays, directory / ("%s-bole.png" % recipe), eye=(-3.2, 1.6, 6.0),
                 target=(0.0, 2.3, 0.0), lens=32.0, size=(1000, 1000))


def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None, scratch_dir=None, prop_names=None):
    """Build the pack into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Verdant Hills - Atelier"
    studio_module.PREFIX = "SVERDANT_"
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
            # A high summer sun from the left and a little toward the viewer, under a bright sky.
            studio.setup_preview(sun_direction=(-0.55, 0.62, 0.5), sun_strength=5.0, sky=(0.5, 0.6, 0.78),
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
            if preview_dir:
                for name, arrays in sprays.items():
                    preview.spray(studio, name, arrays, preview_dir)
        if "props" in wanted:
            finished = build_props(studio, bake=bake, names=prop_names)
            if not prop_names:
                path = output_dir / PROPS_FILE
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
                stand.append(grown)
                if "trees" in wanted:
                    path = output_dir / ("%s.glb" % recipe)
                    write_tree(path, grown)
                    records.append(grove.file_record(path, kind="tree", species=tree.meta["species"],
                                                     role=tree.meta["role"], sites=len(tree.sites),
                                                     barkTriangles=int(len(grown["bark"][4]) // 3),
                                                     height=tree.meta["height"],
                                                     anchors=_rounded(tree.meta.get("anchors", {}))))
                if preview_dir:
                    preview_tree(studio, grown, sprays, preview_dir, recipe)
        if "impostors" in wanted and stand and not recipes:
            # The sprite renders pass through files; unless a scratch folder is named they
            # go to a temporary one, so nothing but the pack is left beside the assets.
            scratch = Path(scratch_dir or tempfile.mkdtemp(prefix="verdant-hills-")).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            path = output_dir / IMPOSTOR_FILE
            # The field trees first, the old oak last: its tile is the wide one.
            stand.sort(key=lambda grown: grown["hero"])
            try:
                layout = bake_impostors(studio, stand, sprays, path, scratch)
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
    options = {"out": None, "only": None, "preview": None, "recipes": None, "props": None, "scratch": None,
               "no-bake": False}
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
        raise SystemExit("usage: blender -b --factory-startup --python verdant_hills_assets.py -- --out <dir>")
    started = time.time()
    manifest = build_assets(options["out"], only=options["only"].split(",") if options["only"] else None,
                            preview_dir=options["preview"], bake=not options["no-bake"],
                            recipes=options["recipes"].split(",") if options["recipes"] else None,
                            scratch_dir=options["scratch"],
                            prop_names=options["props"].split(",") if options["props"] else None)
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
