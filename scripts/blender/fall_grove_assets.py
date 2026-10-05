"""Original Serenity Blocks Fall grove assets, authored procedurally in Blender.

Run headless (preferred; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/fall_grove_assets.py -- \
        --out src/themes/fall/assets [--only trees,foliage,textures,props] [--preview reports/fall-grove/preview]

or inside a running Blender (for example through the MCP addon's execute_code):

    import runpy; runpy.run_path("scripts/blender/fall_grove_assets.py")["build_assets"]("<out dir>")

All work happens in a dedicated scene that is removed afterwards. No external assets are
fetched: every mesh, bake and texture is generated here, so the outputs are project-owned.
Coordinates in the written GLBs are glTF Y-up metres with each tree's base at the origin.
"""

import hashlib
import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

from fall_grove import foliage, glb, skeleton, species, wood  # noqa: E402

SCHEMA_VERSION = 1
SCALE_RANGE = 2.5      # spray scale is stored as scale / SCALE_RANGE in an unsigned byte
LEAF_PREVIEW = {
    "maple": [(0.86, 0.19, 0.08), (0.95, 0.42, 0.08), (0.98, 0.66, 0.14), (0.72, 0.1, 0.1)],
    "oak": [(0.74, 0.36, 0.1), (0.62, 0.26, 0.08), (0.86, 0.56, 0.16), (0.5, 0.2, 0.07)],
    "birch": [(0.99, 0.8, 0.2), (0.95, 0.68, 0.12), (0.9, 0.84, 0.3), (0.98, 0.74, 0.16)],
}
SPRAY_BUILDERS = {
    "maple_spray": lambda index: foliage.maple_spray(9100 + index * 13, lod=0),
    "maple_clump": lambda index: foliage.maple_clump(9300 + index * 17, lod=1, leaves=10, leaf_size=0.5),
    "oak_spray": lambda index: foliage.oak_spray(9500 + index * 19, lod=0),
    "birch_strand": lambda index: foliage.birch_strand(9700 + index * 23, lod=0),
}
SPRAY_VARIANTS = 2
SPRAY_REACH = {"maple_spray": 0.62, "maple_clump": 0.62, "oak_spray": 0.55, "birch_strand": 0.6}


def site_frames(sites):
    """Rotation matrices (columns X, Y = along the twig, Z = lit side) for foliage sites."""
    frames = np.zeros((len(sites), 3, 3))
    for index, site in enumerate(sites):
        forward = site.forward
        top = site.top - forward * float(np.dot(site.top, forward))
        if np.linalg.norm(top) < 1e-5:
            top = skeleton.perpendicular(forward)
        top = skeleton.normalize(top)
        frames[index, :, 0] = np.cross(forward, top)
        frames[index, :, 1] = forward
        frames[index, :, 2] = top
    return frames


def quaternions(frames):
    """Rotation matrices -> unit quaternions (x, y, z, w), w >= 0."""
    result = np.zeros((len(frames), 4))
    for index, m in enumerate(frames):
        trace = m[0, 0] + m[1, 1] + m[2, 2]
        if trace > 0:
            s = math.sqrt(trace + 1.0) * 2
            q = ((m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s)
        elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
            s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
            q = (0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s)
        elif m[1, 1] > m[2, 2]:
            s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
            q = ((m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s)
        else:
            s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
            q = ((m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s)
        q = np.array(q)
        if q[3] < 0:
            q = -q
        result[index] = q / np.linalg.norm(q)
    return result


def grow(recipe):
    """Grow one specimen and derive everything that needs no Blender."""
    started = time.time()
    tree = species.RECIPES[recipe]()
    hero = tree.meta["role"] == "hero"
    bark = wood.build_wood(tree, hero=hero, trunk_profile=getattr(tree, "trunk_profile", None),
                           moss_seed=len(recipe), include_twigs=hero)
    positions = np.array([site.position for site in tree.sites])
    reach = SPRAY_REACH[tree.meta["foliage"]]
    radius = reach * float(np.mean([site.scale for site in tree.sites]))
    sky, bent = skeleton.foliage_visibility(positions, radius * 0.8, opacity=0.3)
    # The best-lit tenth of the crown defines full sky; the interior keeps its true ratio.
    sky = np.clip(sky / max(1e-4, float(np.percentile(sky, 90))), 0.0, 1.0)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("[fall-grove] %-14s branches=%4d bark_tris=%6d sites=%5d sky=%.2f..%.2f crown x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f  %.1fs" % (
        recipe, len(tree.branches), bark.triangles, len(tree.sites), sky.min(), sky.mean(),
        low[0], high[0], low[1], high[1], low[2], high[2], time.time() - started))
    return dict(tree=tree, bark=bark.arrays(), positions=positions, sky=sky, bent=bent, frames=site_frames(tree.sites),
                hero=hero, core_indices=int(bark.core_indices or bark.triangles * 3))


def bake_bark_ao(studio, grown):
    """Cycles AO for the bark: crevices between roots, limb junctions, shade under the crown."""
    tree = grown["tree"]
    positions, normals, uvs, colors, indices = grown["bark"]
    bark = studio.mesh_object(tree.name + "_bark", positions, indices)
    # Sprays occlude as small spheres; a ground slab gives the trunk its contact shadow.
    ico = skeleton.sphere_directions(14)
    hull_positions = []
    hull_indices = []
    reach = SPRAY_REACH[tree.meta["foliage"]]
    for index, site in enumerate(tree.sites):
        centre = site.position + site.forward * reach * site.scale * 0.6
        ring = centre + ico * reach * site.scale * 0.55
        base = len(hull_positions) * 0 + index * len(ico)
        hull_positions.append(ring)
        # A coarse fan is enough: only its shadowing matters.
        for a in range(len(ico) - 2):
            hull_indices.append((base, base + a + 1, base + a + 2))
    occluder = studio.mesh_object(tree.name + "_crown", np.concatenate(hull_positions), np.array(hull_indices))
    extent = 60.0
    ground = studio.mesh_object(tree.name + "_ground", np.array([[-extent, 0.0, -extent], [extent, 0.0, -extent],
                                                                  [extent, 0.0, extent], [-extent, 0.0, extent]]),
                                np.array([[0, 2, 1], [0, 3, 2]]))
    try:
        ao = studio.bake_vertex_ao(bark, distance=5.0 if grown["hero"] else 3.0, samples=40 if grown["hero"] else 24)
        ao = np.clip(ao, 0.0, 1.0) ** 0.9
        colors = colors.copy()
        colors[:, 2] = np.clip(0.12 + 0.88 * ao, 0.0, 1.0)
        grown["bark"] = (positions, normals, uvs, colors, indices)
        grown["ao_range"] = (float(ao.min()), float(ao.mean()))
    finally:
        for obj in (bark, occluder, ground):
            mesh = obj.data
            import bpy
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)


def write_tree(path, grown):
    tree = grown["tree"]
    positions, normals, uvs, colors, indices = grown["bark"]
    writer = glb.GlbWriter()
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
        "_ROT": (glb.quantize_unit(quaternions(grown["frames"]), np.int16), True),
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


def write_foliage(path):
    writer = glb.GlbWriter()
    summary = {}
    for kind, build in SPRAY_BUILDERS.items():
        for variant in range(SPRAY_VARIANTS):
            builder = build(variant)
            positions, normals, uvs, colors, indices = builder.arrays()
            name = "%s_%d" % (kind, variant)
            writer.add_mesh(name, {
                "POSITION": (positions, False),
                "NORMAL": (glb.quantize_unit(normals, np.int8), True),
                "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
                "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
            }, indices=indices, extras=dict(leaves=builder.leaves, triangles=builder.triangles))
            summary[name] = dict(leaves=builder.leaves, triangles=builder.triangles)
    for name, species_name, lod in (("leaf_maple", "maple", 0), ("leaf_maple_far", "maple", 1),
                                    ("leaf_oak", "oak", 1), ("leaf_birch", "birch", 0)):
        positions, normals, uvs, colors, indices = foliage.single_leaf(species_name, lod)
        writer.add_mesh(name, {
            "POSITION": (positions, False),
            "NORMAL": (glb.quantize_unit(normals, np.int8), True),
            "TEXCOORD_0": (glb.quantize_unit(np.clip(uvs, 0.0, 1.0), np.uint16), True),
            "COLOR_0": (glb.quantize_unit(colors, np.uint8), True),
        }, indices=indices, extras=dict(leaves=1, triangles=int(len(indices) // 3)))
        summary[name] = dict(leaves=1, triangles=int(len(indices) // 3))
    writer.set_extras(dict(schemaVersion=SCHEMA_VERSION, variants=SPRAY_VARIANTS, meshes=summary))
    size = writer.write(path)
    return size, summary


def realised_foliage(grown, sprays):
    """Every spray of one tree as a single mesh (preview only)."""
    tree = grown["tree"]
    kind = tree.meta["foliage"]
    palette = np.array(LEAF_PREVIEW[tree.meta["species"]])
    all_positions = []
    all_colors = []
    all_indices = []
    offset = 0
    for variant in range(SPRAY_VARIANTS):
        positions, _normals, _uvs, colors, indices = sprays["%s_%d" % (kind, variant)]
        chosen = [index for index, site in enumerate(tree.sites) if site.variant % SPRAY_VARIANTS == variant]
        for index in chosen:
            site = tree.sites[index]
            world = (grown["frames"][index] @ (positions * site.scale).T).T + site.position
            tint = palette[int(site.hue * len(palette)) % len(palette)] * (0.35 + 0.65 * grown["sky"][index])
            leaf = colors[:, 3:4]
            rgb = leaf * tint * colors[:, 2:3] + (1.0 - leaf) * np.array([0.12, 0.08, 0.06])
            all_positions.append(world)
            all_colors.append(rgb)
            all_indices.append(indices.reshape(-1) + offset)
            offset += len(world)
    return np.concatenate(all_positions), np.concatenate(all_colors), np.concatenate(all_indices)


def preview(studio, grown, sprays, path):
    import bpy
    tree = grown["tree"]
    positions, _normals, _uvs, colors, indices = grown["bark"]
    shade = colors[:, 2:3]
    moss = colors[:, 3:4]
    bark_rgb = (np.array([0.2, 0.15, 0.12]) * (1 - moss) + np.array([0.2, 0.3, 0.08]) * moss) * (0.3 + 0.7 * shade)
    bark = studio.mesh_object(tree.name + "_bark_preview", positions, indices, colors=bark_rgb)
    bark.data.materials.append(studio.material("bark_preview", roughness=0.95))
    leaf_positions, leaf_colors, leaf_indices = realised_foliage(grown, sprays)
    leaves = studio.mesh_object(tree.name + "_leaves_preview", leaf_positions, leaf_indices, colors=leaf_colors,
                                smooth=False)
    leaves.data.materials.append(studio.material("leaf_preview", roughness=0.6, emission=0.25))
    ground = studio.mesh_object(tree.name + "_ground_preview", np.array(
        [[-80.0, 0.0, -80.0], [80.0, 0.0, -80.0], [80.0, 0.0, 80.0], [-80.0, 0.0, 80.0]]),
        np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([[0.3, 0.2, 0.12]], (4, 1)))
    ground.data.materials.append(studio.material("ground_preview", roughness=1.0))
    height = tree.meta["height"]
    distance = height * 1.75
    studio.render(path, eye=(distance * 0.12, height * 0.22, distance * 0.8), target=(0.0, height * 0.46, 0.0),
                  lens=30.0, size=(820, 900), samples=10)
    for obj in (bark, leaves, ground):
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)


IMPOSTOR_HEIGHT = 448


def impostor_mesh(grown, sprays):
    """Bark and realised foliage as one mesh whose colour stores shading data.

    R = shade (sky visibility and the spray's own shading), G = 1 on leaves / 0 on wood,
    B = the spray's hue seed. The runtime turns these into autumn colour per tree.
    """
    tree = grown["tree"]
    kind = tree.meta["foliage"]
    positions, _normals, _uvs, colors, indices = grown["bark"]
    bark_colors = np.stack([0.25 + 0.5 * colors[:, 2], np.zeros(len(positions)), 0.5 + 0.5 * colors[:, 3]], axis=1)
    all_positions = [positions]
    all_colors = [bark_colors]
    all_indices = [indices.reshape(-1)]
    offset = len(positions)
    for variant in range(SPRAY_VARIANTS):
        spray_positions, _n, _u, spray_colors, spray_indices = sprays["%s_%d" % (kind, variant)]
        for index, site in enumerate(tree.sites):
            if site.variant % SPRAY_VARIANTS != variant:
                continue
            world = (grown["frames"][index] @ (spray_positions * site.scale).T).T + site.position
            leaf = spray_colors[:, 3]
            shade = (0.28 + 0.72 * grown["sky"][index]) * spray_colors[:, 2]
            data = np.stack([np.where(leaf > 0.5, shade, 0.3), leaf, np.full(len(world), site.hue)], axis=1)
            all_positions.append(world)
            all_colors.append(data)
            all_indices.append(spray_indices.reshape(-1) + offset)
            offset += len(world)
    return np.concatenate(all_positions), np.concatenate(all_colors), np.concatenate(all_indices)


def bake_impostors(studio, grown_trees, sprays, path, scratch):
    """Front-elevation data sprites of the grove trees for the distant forest.

    Each tile is fitted to its crown, so tiles differ in width; the manifest records every
    tile's pixel rectangle, its size in metres and where the trunk stands inside it.
    """
    import bpy
    from fall_grove.studio import dilate
    material = studio.data_material("impostor")
    tile_height = IMPOSTOR_HEIGHT
    renders = []
    tiles = []
    cursor = 0
    for grown in grown_trees:
        tree = grown["tree"]
        positions, colors, indices = impostor_mesh(grown, sprays)
        low = positions.min(axis=0)
        high = positions.max(axis=0)
        height = float(high[1]) * 1.04
        width = float(high[0] - low[0]) * 1.06
        tile_width = int(min(512, max(160, round(tile_height * width / height / 16.0) * 16)))
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
        tiles.append(dict(asset=tree.name, species=tree.meta["species"], x=cursor, pixels=tile_width,
                          width=width, height=height, trunk=-centre_x / width,
                          coverage=float((pixels[:, :, 3] > 0.5).mean())))
        cursor += tile_width
    atlas = np.zeros((tile_height, cursor, 4), dtype=np.float32)
    for tile, pixels in zip(tiles, renders):
        atlas[:, tile["x"]:tile["x"] + tile["pixels"]] = pixels
    studio.save_image(path, atlas)
    return dict(atlasWidth=cursor, atlasHeight=tile_height, tiles=tiles)


def file_record(path, **extra):
    data = Path(path).read_bytes()
    return dict(file=Path(path).name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), **extra)


def build_assets(output_dir, only=None, preview_dir=None, bake=True, recipes=None, scratch_dir=None):
    """Build the grove assets into `output_dir`; returns a JSON-serialisable manifest."""
    from fall_grove import studio as studio_module
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    wanted = set(only or ("trees", "foliage", "impostors"))
    records = []
    studio = studio_module.Studio()
    try:
        sprays = {}
        if "foliage" in wanted or "impostors" in wanted or preview_dir:
            for kind, build in SPRAY_BUILDERS.items():
                for variant in range(SPRAY_VARIANTS):
                    sprays["%s_%d" % (kind, variant)] = build(variant).arrays()
        if "foliage" in wanted:
            path = output_dir / "fall-foliage.glb"
            _size, summary = write_foliage(path)
            records.append(file_record(path, kind="foliage", meshes=summary))
            print("[fall-grove] foliage", json.dumps(summary))
        grove = []
        if "trees" in wanted or "impostors" in wanted:
            if preview_dir:
                studio.setup_preview()
            for recipe in (recipes or species.RECIPES):
                grown = grow(recipe)
                if bake:
                    bake_bark_ao(studio, grown)
                tree = grown["tree"]
                if tree.meta["role"] == "grove":
                    grove.append(grown)
                if "trees" in wanted:
                    path = output_dir / ("%s.glb" % recipe)
                    write_tree(path, grown)
                    records.append(file_record(path, kind="tree", species=tree.meta["species"],
                                               role=tree.meta["role"], sites=len(tree.sites),
                                               barkTriangles=int(len(grown["bark"][4]) // 3)))
                if preview_dir:
                    Path(preview_dir).mkdir(parents=True, exist_ok=True)
                    preview(studio, grown, sprays, Path(preview_dir) / ("%s.png" % recipe))
        if "impostors" in wanted and grove:
            scratch = Path(scratch_dir or (output_dir / ".scratch")).resolve()
            scratch.mkdir(parents=True, exist_ok=True)
            path = output_dir / "fall-impostors.png"
            layout = bake_impostors(studio, grove, sprays, path, scratch)
            records.append(file_record(path, kind="impostors", **layout))
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
        raise SystemExit("usage: blender -b --factory-startup --python fall_grove_assets.py -- --out <dir>")
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
    print("[fall-grove] wrote %d assets, %.1f KB" % (len(manifest["assets"]),
                                                    sum(a["bytes"] for a in manifest["assets"]) / 1024))


if __name__ == "__main__":
    _main()
