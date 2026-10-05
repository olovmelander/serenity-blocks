"""Original Serenity Blocks Sakura Twilight assets, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sakura_twilight_assets.py -- \
        --out src/themes/sakura-twilight/assets [--only trees,blossoms,props,fuji,impostors] \
        [--recipes sakura-grove-a,...] [--preview reports/sakura-twilight/preview] [--no-bake]

The cherry trees grow with the Fall grove's skeleton, wood and GLB modules
(scripts/blender/fall_grove) from the recipes in sakura_grove/species.py; blossom sprays,
garden furniture and the mountain are built as arrays in sakura_grove. Blender bakes the
ambient occlusion and renders the far-shore sprite sheet. No external assets are fetched,
so every output is project-owned. Coordinates are glTF Y-up metres.
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

import fall_grove_assets as grove_tools  # noqa: E402
from fall_grove import glb, skeleton, wood  # noqa: E402
from sakura_grove import blossoms, props, species  # noqa: E402

SCHEMA_VERSION = grove_tools.SCHEMA_VERSION
SPRAY_VARIANTS = grove_tools.SPRAY_VARIANTS
SPRAY_BUILDERS = {
    "blossom_spray": lambda index: blossoms.blossom_spray(7100 + index * 13),
    "blossom_strand": lambda index: blossoms.blossom_strand(7300 + index * 17),
    "blossom_clump": lambda index: blossoms.blossom_clump(7500 + index * 19),
}
SPRAY_REACH = {"blossom_spray": 0.6, "blossom_strand": 0.55, "blossom_clump": 0.6}
# The Fall tools size a tree's occluders and data sprites from this table.
grove_tools.SPRAY_REACH.update(SPRAY_REACH)
BLOSSOM_PREVIEW = np.array([(1.0, 0.62, 0.74), (1.0, 0.76, 0.84), (0.98, 0.5, 0.66), (1.0, 0.86, 0.9)])
GENERATOR = "Serenity Blocks - Sakura Twilight (Blender authoring)"


def log(message):
    print("[sakura] " + message, flush=True)


def visibility(positions, radius, opacity):
    """Sky visibility and bent normals, in slices so a weeping crown fits in memory."""
    count = len(positions)
    if count <= 2600:
        return skeleton.foliage_visibility(positions, radius, opacity=opacity)
    rays = skeleton.sphere_directions(96)
    log_keep = math.log(max(1e-6, 1.0 - opacity))
    upper = rays[:, 1] > 0.0
    weight = np.clip(rays[upper, 1], 0.0, 1.0) + 0.25
    sky = np.zeros(count)
    bent = np.zeros((count, 3))
    for start in range(0, count, 700):
        delta = positions[None, :, :] - positions[start:start + 700, None, :]
        distance_sq = np.einsum("ijk,ijk->ij", delta, delta)
        transmittance = np.ones((len(delta), len(rays)))
        for ray_index, ray in enumerate(rays):
            along = delta @ ray
            hit = (along > radius * 0.35) & (along < 14.0) & (distance_sq - along * along < radius * radius)
            transmittance[:, ray_index] = np.exp(log_keep * hit.sum(axis=1))
        sky[start:start + 700] = (transmittance[:, upper] * weight).sum(axis=1) / weight.sum()
        bent[start:start + 700] = transmittance @ rays
    lengths = np.linalg.norm(bent, axis=1, keepdims=True)
    bent = np.where(lengths > 1e-6, bent / np.maximum(lengths, 1e-6), np.array([0.0, 1.0, 0.0]))
    return sky, bent


def grow(recipe):
    """Grow one specimen and derive everything that needs no Blender."""
    started = time.time()
    tree = species.RECIPES[recipe]()
    hero = tree.meta["role"] == "hero"
    weeping = tree.meta["habit"] == "weeping"
    # A weeping cherry is its hanging shoots: they are drawn at every tier.
    bark = wood.build_wood(tree, hero=hero, trunk_profile=getattr(tree, "trunk_profile", None),
                           moss_seed=len(recipe), twig_level=4 if weeping else 3, include_twigs=hero or weeping)
    positions = np.array([site.position for site in tree.sites])
    radius = SPRAY_REACH[tree.meta["foliage"]] * float(np.mean([site.scale for site in tree.sites]))
    sky, bent = visibility(positions, radius * 0.8, 0.24)
    sky = np.clip(sky / max(1e-4, float(np.percentile(sky, 90))), 0.0, 1.0)
    low, high = positions.min(axis=0), positions.max(axis=0)
    log("%-22s branches=%4d bark_tris=%6d sites=%5d sky=%.2f..%.2f crown x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f  %.1fs" % (
        recipe, len(tree.branches), bark.triangles, len(tree.sites), sky.min(), sky.mean(),
        low[0], high[0], low[1], high[1], low[2], high[2], time.time() - started))
    return dict(tree=tree, bark=bark.arrays(), positions=positions, sky=sky, bent=bent,
                frames=grove_tools.site_frames(tree.sites), hero=hero,
                core_indices=int(bark.core_indices or bark.triangles * 3))


def mesh_attributes(positions, normals, uvs, colors):
    return {
        "POSITION": (positions, False),
        "NORMAL": (glb.quantize_unit(normals, np.int8), True),
        "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
        "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
    }


def write_blossoms(path):
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for kind, build in SPRAY_BUILDERS.items():
        for variant in range(SPRAY_VARIANTS):
            builder = build(variant)
            positions, normals, uvs, colors, indices = builder.arrays()
            name = "%s_%d" % (kind, variant)
            record = dict(flowers=builder.flowers, triangles=builder.triangles)
            writer.add_mesh(name, mesh_attributes(positions, normals, uvs, colors), indices=indices, extras=record)
            summary[name] = record
    singles = {
        "petal": blossoms.single_petal(1),
        "petal_far": blossoms.single_petal(2),
        "flower": blossoms.single_flower(),
    }
    for name, (positions, normals, uvs, colors, indices) in singles.items():
        record = dict(flowers=1 if name == "flower" else 0, triangles=int(len(indices) // 3))
        writer.add_mesh(name, mesh_attributes(positions, normals, uvs, colors), indices=indices, extras=record)
        summary[name] = record
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, variants=SPRAY_VARIANTS, meshes=summary))
    writer.write(path)
    return summary


def bake_prop_ao(studio, name, arrays):
    """Cycles AO into the alpha of a prop's colours, over a ground slab for contact shade."""
    import bpy
    positions, normals, glow, colors, indices = arrays
    obj = studio.mesh_object("prop_" + name, positions, indices)
    extent = 40.0
    ground = studio.mesh_object("prop_ground", np.array([[-extent, 0.0, -extent], [extent, 0.0, -extent],
                                                         [extent, 0.0, extent], [-extent, 0.0, extent]]),
                                np.array([[0, 2, 1], [0, 3, 2]]))
    try:
        ao = np.clip(studio.bake_vertex_ao(obj, distance=2.5, samples=48), 0.0, 1.0) ** 0.85
        colors = colors.copy()
        colors[:, 3] = np.clip(0.1 + 0.9 * ao, 0.0, 1.0)
    finally:
        for item in (obj, ground):
            mesh = item.data
            bpy.data.objects.remove(item, do_unlink=True)
            bpy.data.meshes.remove(mesh)
    return positions, normals, glow, colors, indices


def build_props(studio, bake):
    built = {}
    for name, build in props.PROPS.items():
        arrays = build().arrays()
        if bake and name not in props.UNOCCLUDED:
            arrays = bake_prop_ao(studio, name, arrays)
        built[name] = arrays
        log("prop %-14s triangles=%5d ao=%.2f..%.2f" % (name, len(arrays[4]) // 3, arrays[3][:, 3].min(),
                                                      arrays[3][:, 3].mean()))
    return built


def write_props(path, built):
    writer = glb.GlbWriter(generator=GENERATOR)
    summary = {}
    for name, (positions, normals, glow, colors, indices) in built.items():
        low, high = positions.min(axis=0), positions.max(axis=0)
        record = dict(triangles=int(len(indices) // 3), boundsMin=[round(float(v), 3) for v in low],
                      boundsMax=[round(float(v), 3) for v in high])
        writer.add_mesh(name, mesh_attributes(positions, normals, glow, colors), indices=indices, extras=record)
        summary[name] = record
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, meshes=summary))
    writer.write(path)
    return summary


def write_fuji(path):
    positions, normals, colors, indices = props.fuji()
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("fuji", {
        "POSITION": (positions, False),
        "NORMAL": (glb.quantize_unit(normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
    }, indices=indices)
    record = dict(triangles=int(len(indices) // 3), height=1.0, baseRadius=float(np.abs(positions[:, [0, 2]]).max()))
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, **record))
    writer.write(path)
    return record


# -- previews (not shipped) ---------------------------------------------------------------
def realised_blossom(grown, sprays):
    """Every spray of one tree as a single mesh."""
    tree = grown["tree"]
    kind = tree.meta["foliage"]
    all_positions, all_colors, all_indices = [], [], []
    offset = 0
    for variant in range(SPRAY_VARIANTS):
        positions, _normals, _uvs, colors, indices = sprays["%s_%d" % (kind, variant)]
        for index, site in enumerate(tree.sites):
            if site.variant % SPRAY_VARIANTS != variant:
                continue
            world = (grown["frames"][index] @ (positions * site.scale).T).T + site.position
            tint = BLOSSOM_PREVIEW[int(site.hue * len(BLOSSOM_PREVIEW)) % len(BLOSSOM_PREVIEW)]
            tint = tint * (0.3 + 0.7 * grown["sky"][index])
            petal = colors[:, 3:4]
            heart = 0.6 + 0.4 * colors[:, 0:1]
            rgb = petal * tint * colors[:, 2:3] * heart + (1.0 - petal) * np.array([0.1, 0.07, 0.06])
            all_positions.append(world)
            all_colors.append(rgb)
            all_indices.append(indices.reshape(-1) + offset)
            offset += len(world)
    return np.concatenate(all_positions), np.concatenate(all_colors), np.concatenate(all_indices)


def remove(objects):
    import bpy
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def ground_preview(studio, extent=80.0, colour=(0.12, 0.2, 0.1)):
    ground = studio.mesh_object("ground_preview", np.array(
        [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
        np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([colour], (4, 1)))
    ground.data.materials.append(studio.material("ground_preview", roughness=1.0))
    return ground


def preview_tree(studio, grown, sprays, path):
    tree = grown["tree"]
    positions, _normals, _uvs, colors, indices = grown["bark"]
    shade = colors[:, 2:3]
    moss = colors[:, 3:4]
    bark_rgb = (np.array([0.16, 0.12, 0.11]) * (1 - moss) + np.array([0.16, 0.24, 0.08]) * moss) * (0.3 + 0.7 * shade)
    bark = studio.mesh_object(tree.name + "_bark_preview", positions, indices, colors=bark_rgb)
    bark.data.materials.append(studio.material("bark_preview", roughness=0.95))
    petal_positions, petal_colors, petal_indices = realised_blossom(grown, sprays)
    petals = studio.mesh_object(tree.name + "_blossom_preview", petal_positions, petal_indices, colors=petal_colors,
                                smooth=False)
    petals.data.materials.append(studio.material("blossom_preview", roughness=0.6, emission=0.3))
    ground = ground_preview(studio)
    height = tree.meta["height"]
    distance = height * 2.0
    studio.render(path, eye=(distance * 0.14, height * 0.2, distance * 0.82), target=(0.0, height * 0.46, 0.0),
                  lens=30.0, size=(900, 860), samples=10)
    remove((bark, petals, ground))


def preview_props(studio, built, path):
    objects = [ground_preview(studio, colour=(0.2, 0.22, 0.2))]
    cursor = -13.0
    for name, (positions, _normals, glow, colors, indices) in built.items():
        low, high = positions.min(axis=0), positions.max(axis=0)
        width = float(high[0] - low[0])
        lift = 1.6 if name == "paper_lantern" else 0.0
        placed = positions + np.array([cursor - low[0], lift, 0.0])
        rgb = colors[:, :3] * colors[:, 3:4] + glow[:, 0:1] * np.array([1.0, 0.55, 0.2]) * 0.8
        obj = studio.mesh_object("preview_" + name, placed, indices, colors=rgb, smooth=False)
        obj.data.materials.append(studio.material("prop_preview_" + name, roughness=0.8, emission=0.35))
        objects.append(obj)
        cursor += width + 0.9
    centre = (cursor - 13.0) * 0.5
    studio.render(path, eye=(centre, 9.0, 46.0), target=(centre, 6.5, 0.0), lens=34.0, size=(1800, 900), samples=24)
    remove(objects)


def preview_fuji(studio, path):
    positions, _normals, colors, indices = props.fuji()
    snow = colors[:, 0:1]
    rgb = (np.array([0.16, 0.17, 0.26]) * (1 - snow) + np.array([0.9, 0.9, 0.95]) * snow) * colors[:, 1:2]
    obj = studio.mesh_object("preview_fuji", positions, indices, colors=rgb)
    obj.data.materials.append(studio.material("fuji_preview", roughness=0.9))
    studio.render(path, eye=(0.6, 0.35, 6.4), target=(0.0, 0.4, 0.0), lens=50.0, size=(1200, 520), samples=16)
    remove((obj,))


IMPOSTOR_HEIGHT = 320


def bake_impostors(studio, grown_trees, sprays, path, scratch):
    """Front-elevation data sprites of the grove trees for the far shore.

    The Fall bake caps a tile at 512 px, which crops a cherry's parasol; here every tile is
    as wide as its crown. The manifest records each tile's pixel rectangle, its size in
    metres and where the trunk stands inside it.
    """
    from fall_grove.studio import dilate
    material = studio.data_material("impostor")
    renders = []
    tiles = []
    cursor = 0
    for grown in grown_trees:
        tree = grown["tree"]
        positions, colors, indices = grove_tools.impostor_mesh(grown, sprays)
        low, high = positions.min(axis=0), positions.max(axis=0)
        height = float(high[1]) * 1.05
        tile_width = int(math.ceil(IMPOSTOR_HEIGHT * float(high[0] - low[0]) * 1.06 / height / 16.0) * 16)
        width = height * tile_width / IMPOSTOR_HEIGHT
        centre_x = float(low[0] + high[0]) * 0.5
        obj = studio.mesh_object(tree.name + "_impostor", positions, indices, colors=colors, smooth=False)
        obj.data.materials.append(material)
        pixels = studio.render_orthographic(scratch / ("%s-impostor.png" % tree.name),
                                            centre=(centre_x, height * 0.5, 0.0), width=width, height=height,
                                            size=(tile_width, IMPOSTOR_HEIGHT), samples=24)
        remove((obj,))
        # The dilation wraps at the image edge, so it runs inside a transparent frame.
        pad = 16
        framed = np.zeros((IMPOSTOR_HEIGHT + 2 * pad, tile_width + 2 * pad, 4), dtype=np.float32)
        framed[pad:-pad, pad:-pad] = pixels
        renders.append(dilate(framed, iterations=12)[pad:-pad, pad:-pad])
        tiles.append(dict(asset=tree.name, habit=tree.meta["habit"], x=cursor, pixels=tile_width, width=width,
                          height=height, trunk=-centre_x / width,
                          coverage=float((pixels[:, :, 3] > 0.5).mean())))
        cursor += tile_width
    atlas = np.zeros((IMPOSTOR_HEIGHT, cursor, 4), dtype=np.float32)
    for tile, pixels in zip(tiles, renders):
        atlas[:, tile["x"]:tile["x"] + tile["pixels"]] = pixels
    studio.save_image(path, atlas)
    return dict(atlasWidth=cursor, atlasHeight=IMPOSTOR_HEIGHT, tiles=tiles)


def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None, scratch_dir=None):
    """Build the assets into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "blossoms", "props", "fuji", "impostors"))
    if preview_dir:
        preview_dir = Path(preview_dir).expanduser().resolve()
        preview_dir.mkdir(parents=True, exist_ok=True)
    records = []
    studio = studio_module.Studio()
    try:
        if preview_dir:
            studio.setup_preview(sun_direction=(0.45, 0.5, 0.75), sun_strength=3.4, sky=(0.5, 0.56, 0.72),
                                 sky_strength=1.0)
        sprays = {"%s_%d" % (kind, variant): build(variant).arrays()
                  for kind, build in SPRAY_BUILDERS.items() for variant in range(SPRAY_VARIANTS)}
        if "blossoms" in wanted:
            path = output_dir / "sakura-blossoms.glb"
            summary = write_blossoms(path)
            records.append(grove_tools.file_record(path, kind="blossoms", meshes=summary))
            log("blossoms " + json.dumps(summary))
        if "props" in wanted:
            built = build_props(studio, bake)
            path = output_dir / "sakura-props.glb"
            records.append(grove_tools.file_record(path, kind="props", meshes=write_props(path, built)))
            if preview_dir:
                preview_props(studio, built, preview_dir / "props.png")
        if "fuji" in wanted:
            path = output_dir / "sakura-fuji.glb"
            records.append(grove_tools.file_record(path, kind="mountain", **write_fuji(path)))
            if preview_dir:
                preview_fuji(studio, preview_dir / "fuji.png")
        grove = []
        if "trees" in wanted or "impostors" in wanted:
            for recipe in (recipes or species.RECIPES):
                grown = grow(recipe)
                if bake:
                    grove_tools.bake_bark_ao(studio, grown)
                tree = grown["tree"]
                if tree.meta["role"] == "grove":
                    grove.append(grown)
                if "trees" in wanted:
                    path = output_dir / ("%s.glb" % recipe)
                    grove_tools.write_tree(path, grown)
                    records.append(grove_tools.file_record(
                        path, kind="tree", species=tree.meta["species"], role=tree.meta["role"],
                        habit=tree.meta["habit"], sites=len(tree.sites),
                        barkTriangles=int(len(grown["bark"][4]) // 3)))
                if preview_dir:
                    preview_tree(studio, grown, sprays, preview_dir / ("%s.png" % recipe))
        if "impostors" in wanted and grove:
            scratch = Path(scratch_dir or (output_dir / ".scratch")).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            path = output_dir / "sakura-impostors.png"
            layout = bake_impostors(studio, grove, sprays, path, scratch)
            records.append(grove_tools.file_record(path, kind="impostors", **layout))
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
        raise SystemExit("usage: blender -b --factory-startup --python sakura_twilight_assets.py -- --out <dir>")
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
    log("wrote %d assets, %.1f KB" % (len(manifest["assets"]), sum(a["bytes"] for a in manifest["assets"]) / 1024))


if __name__ == "__main__":
    _main()
