"""Preview renders and the forest's sprite sheets for the High Coast trees.

The shipped files carry shading data, not colour: the theme owns every material. The previews
(never shipped) paint that data with stand-in colours so a tree can be judged in Blender before
the runtime has a line of shader for it: one still per tree, the old pine through the theme's
own lens, and the sprite sheets lit from one side.

The forest stands 500 m to 7 km from the eye, where a tree is five to sixty pixels tall, so it
is drawn as sprites. `bake_sprites` renders every forest tree, and small groups of them, in
front elevation into two sheets with the same layout:

  data     R = shade (sky visibility and the spray's own shading), G = 1 on needles / 0 on
           wood, B = the spray's hue seed (needles) or the bark's species mask (wood),
           A = coverage.
  normals  RGB = the crown's normal in the sprite's frame (x right, y up, z toward the eye),
           A = coverage. A crown is lit as a mass, so a needle's normal is its site's open
           direction blended with the crown's own shape, not the needle's facet.

With the normals the theme lights each sprite by the hour's sun: a crown has a lit side and
a shaded one, as a far forest does.
"""

import math

import numpy as np

import fall_grove_assets as grove
from fall_grove.skeleton import normalize

ROCK = (0.4, 0.37, 0.35)
SKY = (0.5, 0.62, 0.8)
BARK_LOOKS = {
    # (plain bark, bark where the species mask is 1)
    "pine": ((0.2, 0.15, 0.12), (0.62, 0.3, 0.14)),
    "spruce": ((0.18, 0.14, 0.12), (0.34, 0.36, 0.3)),
}
DEAD_WOOD = (0.5, 0.5, 0.47)
LEAF_PREVIEW = {
    "pine": [(0.09, 0.17, 0.07), (0.11, 0.2, 0.08), (0.08, 0.15, 0.07), (0.12, 0.21, 0.09)],
    "spruce": [(0.05, 0.11, 0.06), (0.07, 0.14, 0.07), (0.09, 0.16, 0.07), (0.06, 0.12, 0.07)],
}
SPRITE_TILE_HEIGHT = 256
# Clear texels on each side of a tile, so a small mip never reads its neighbour.
SPRITE_GUTTER = 12
# Groups of forest trees baked as one sprite each: (asset, x, z, mirrored, scale).
SPRITE_GROUPS = {
    "group-pines": [("pine-coast-a", -7.0, 0.0, False, 1.0), ("pine-coast-c", -2.0, -2.6, True, 1.0),
                    ("pine-coast-b", 3.2, 1.6, False, 1.0), ("pine-coast-d", 8.4, -1.2, True, 0.95)],
    "group-mixed": [("pine-coast-c", -8.4, -1.0, False, 0.94), ("spruce-coast-a", -3.6, 1.2, False, 0.9),
                    ("pine-coast-d", 1.2, -2.2, True, 1.08), ("spruce-coast-b", 5.6, 1.0, True, 1.0),
                    ("pine-coast-a", 10.4, -0.6, False, 0.96)],
    "group-spruces": [("spruce-coast-c", -5.4, 0.0, False, 0.96), ("spruce-coast-b", -1.2, 1.8, True, 0.92),
                      ("pine-coast-a", 3.6, -2.0, False, 0.9), ("spruce-coast-a", 7.6, 0.6, True, 0.84)],
}
# The theme's own view of the old pine (src/themes/high-coast/high-coast-core.js): the eye's
# place in the tree's frame, the rest pitch, and the lens of a 16:9 frame 40 degrees tall.
VIEW_EYE = (0.0, 6.6, 20.8)
VIEW_BEARING = 24.1
VIEW_PITCH = -8.5
VIEW_LENS = 27.8


def _mix(low, high, share):
    return np.asarray(low, dtype=float) * (1.0 - share) + np.asarray(high, dtype=float) * share


def _remove(objects):
    import bpy
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def _ground(studio, extent=400.0, colour=ROCK):
    ground = studio.mesh_object("ground_preview", np.array(
        [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
        np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([colour], (4, 1)))
    ground.data.materials.append(studio.material("ground_preview", roughness=1.0))
    return ground


def _tree_objects(studio, grown, sprays, offset=(0.0, 0.0, 0.0)):
    """The bark and the realised sprays of one tree, painted with stand-in colours."""
    specimen = grown["tree"]
    positions, _normals, _uvs, colors, indices = grown["bark"]
    plain, masked = BARK_LOOKS[specimen.meta["species"]]
    bark_rgb = _mix(plain, masked, colors[:, 3:4])
    if grown.get("wood") is not None:
        bark_rgb = _mix(bark_rgb, DEAD_WOOD, grown["wood"][:, 0:1])
    bark_rgb = bark_rgb * (0.3 + 0.7 * colors[:, 2:3])
    shift = np.asarray(offset, dtype=float)
    bark = studio.mesh_object(specimen.name + "_bark_preview", positions + shift, indices, colors=bark_rgb)
    bark.data.materials.append(studio.material("bark_preview", roughness=0.95))
    leaf_positions, leaf_colors, leaf_indices = grove.realised_foliage(grown, sprays)
    leaves = studio.mesh_object(specimen.name + "_leaves_preview", leaf_positions + shift, leaf_indices,
                                colors=leaf_colors, smooth=False)
    leaves.data.materials.append(studio.material("leaf_preview", roughness=0.6, emission=0.25))
    return [bark, leaves], leaf_positions, leaf_indices


def tree(studio, grown, sprays, path, eye=None, target=None, lens=30.0, size=(820, 900), samples=12):
    """One still of a tree with its sprays realised on their sites."""
    objects, leaf_positions, leaf_indices = _tree_objects(studio, grown, sprays)
    objects.append(_ground(studio))
    height = grown["tree"].meta["height"]
    distance = height * 1.75
    studio.render(path, eye=eye or (distance * 0.12, height * 0.22, distance * 0.8),
                  target=target or (0.0, height * 0.46, 0.0), lens=lens, size=size, samples=samples)
    _remove(objects)
    low, high = leaf_positions.min(axis=0), leaf_positions.max(axis=0)
    return leaf_positions, [float(v) for v in low], [float(v) for v in high], int(len(leaf_indices) // 3)


def view(studio, grown, sprays, path, size=(1280, 720), samples=16, lens=VIEW_LENS, pitch=VIEW_PITCH,
         eye=VIEW_EYE):
    """The old pine as the theme's lens holds it: from the eye's place, at the rest pitch."""
    objects, _positions, _indices = _tree_objects(studio, grown, sprays)
    objects.append(_ground(studio))
    bearing = math.radians(VIEW_BEARING)
    tilt = math.radians(pitch)
    forward = np.array([math.sin(bearing) * math.cos(tilt), math.sin(tilt), -math.cos(bearing) * math.cos(tilt)])
    eye = np.asarray(eye, dtype=float)
    studio.render(path, eye=tuple(eye), target=tuple(eye + forward * 20.0), lens=lens, size=size, samples=samples)
    _remove(objects)
    return path


def close(studio, grown, sprays, path, eye, target, lens=50.0, size=(900, 900), samples=16):
    """A close still (the bole, a limb's end)."""
    objects, _positions, _indices = _tree_objects(studio, grown, sprays)
    objects.append(_ground(studio))
    studio.render(path, eye=eye, target=target, lens=lens, size=size, samples=samples)
    _remove(objects)
    return path


def lineup(studio, stand, sprays, path, distance=120.0, eye_height=4.0, size=(1800, 640), samples=16, gap=3.0):
    """Every forest tree side by side, seen from `distance` metres."""
    objects = []
    cursor = 0.0
    tallest = 0.0
    for grown in stand:
        low, high = grown["tree"].bounds()
        half = max(abs(low[0]), abs(high[0]), abs(low[2]), abs(high[2])) + 1.0
        cursor += half
        made, _positions, _indices = _tree_objects(studio, grown, sprays, offset=(cursor, 0.0, 0.0))
        objects.extend(made)
        cursor += half + gap
        tallest = max(tallest, float(high[1]))
    objects.append(_ground(studio, colour=(0.12, 0.16, 0.08)))
    centre = cursor * 0.5
    width = cursor * 1.04
    lens = 36.0 * distance / width
    studio.render(path, eye=(centre, eye_height, distance), target=(centre, tallest * 0.5, 0.0), lens=lens,
                  size=size, samples=samples)
    _remove(objects)
    return path


# ── The forest's sprites ─────────────────────────────────────────────────────────────

def _crown_normal(specimen, positions):
    """The crown's own shape as a normal: out from its hull's centre (a spruce's leans up its cone)."""
    envelope = specimen.envelope
    local = (positions - envelope.centre) / envelope.radii
    if specimen.meta["species"] == "spruce":
        radial = positions.copy()
        radial[:, 1] = 0.0
        lengths = np.maximum(np.linalg.norm(radial, axis=1, keepdims=True), 1e-6)
        local = radial / lengths * 0.86 + np.array([0.0, 0.5, 0.0])
    lengths = np.maximum(np.linalg.norm(local, axis=1, keepdims=True), 1e-6)
    return local / lengths


def sprite_mesh(grown, sprays, offset=(0.0, 0.0, 0.0), mirrored=False, scale=1.0):
    """Bark and realised foliage as one mesh with two colour sets: shading data and normals."""
    specimen = grown["tree"]
    kind = specimen.meta["foliage"]
    positions, normals, _uvs, colors, indices = grown["bark"]
    all_positions = [positions]
    all_data = [np.stack([0.25 + 0.5 * colors[:, 2], np.zeros(len(positions)), colors[:, 3]], axis=1)]
    all_normals = [normals]
    all_indices = [indices.reshape(-1)]
    count = len(positions)
    site_positions = np.array([site.position for site in specimen.sites])
    shape = _crown_normal(specimen, site_positions)
    for variant in range(grove.SPRAY_VARIANTS):
        spray_positions, spray_normals, _u, spray_colors, spray_indices = sprays["%s_%d" % (kind, variant)]
        for index, site in enumerate(specimen.sites):
            if site.variant % grove.SPRAY_VARIANTS != variant:
                continue
            frame = grown["frames"][index]
            world = (frame @ (spray_positions * site.scale).T).T + site.position
            leaf = spray_colors[:, 3]
            shade = (0.28 + 0.72 * grown["sky"][index]) * spray_colors[:, 2]
            mass = normalize(grown["bent"][index] * 0.55 + shape[index] * 0.45)
            facet = (frame @ spray_normals.T).T
            crown = mass[None, :] * 0.8 + facet * 0.2
            crown = crown / np.maximum(np.linalg.norm(crown, axis=1, keepdims=True), 1e-6)
            all_positions.append(world)
            all_data.append(np.stack([np.where(leaf > 0.5, shade, 0.3), leaf, np.full(len(world), site.hue)],
                                     axis=1))
            all_normals.append(crown)
            all_indices.append(spray_indices.reshape(-1) + count)
            count += len(world)
    positions = np.concatenate(all_positions) * scale
    normals = np.concatenate(all_normals)
    if mirrored:
        positions = positions * np.array([-1.0, 1.0, 1.0])
        normals = normals * np.array([-1.0, 1.0, 1.0])
    # Seen from the front: a normal that looks away is the far side of a round crown.
    normals[:, 2] = np.abs(normals[:, 2])
    return (positions + np.asarray(offset, dtype=float), np.concatenate(all_data),
            np.clip(normals * 0.5 + 0.5, 0.0, 1.0), np.concatenate(all_indices))


def bake_sprites(studio, grown_trees, sprays, data_path, normal_path, scratch, tile_height=SPRITE_TILE_HEIGHT,
                 gutter=SPRITE_GUTTER):
    """Front-elevation sprites of the forest's trees and of small groups of them (see the module's head)."""
    import bpy
    from fall_grove.studio import dilate
    material = studio.data_material("sprite")
    by_name = {grown["tree"].name: grown for grown in grown_trees}
    subjects = []
    for grown in grown_trees:
        subjects.append((grown["tree"].name, grown["tree"].meta["species"], 1,
                         [sprite_mesh(grown, sprays)]))
    for name, members in SPRITE_GROUPS.items():
        if any(asset not in by_name for asset, *_rest in members):
            continue
        kinds = {by_name[asset]["tree"].meta["species"] for asset, *_rest in members}
        parts = [sprite_mesh(by_name[asset], sprays, offset=(x, 0.0, z), mirrored=mirrored, scale=scale)
                 for asset, x, z, mirrored, scale in members]
        subjects.append((name, kinds.pop() if len(kinds) == 1 else "mixed", len(members), parts))
    tiles = []
    renders = []
    cursor = 0
    for name, species, trees, parts in subjects:
        positions = np.concatenate([part[0] for part in parts])
        data = np.concatenate([part[1] for part in parts])
        normals = np.concatenate([part[2] for part in parts])
        offsets = np.cumsum([0] + [len(part[0]) for part in parts[:-1]])
        indices = np.concatenate([part[3] + shift for part, shift in zip(parts, offsets)])
        low = positions.min(axis=0)
        high = positions.max(axis=0)
        height = float(high[1]) * 1.04
        width = float(high[0] - low[0]) * 1.06
        tile_width = int(min(640, max(64, round(tile_height * width / height / 8.0) * 8)))
        width = height * tile_width / tile_height
        centre_x = float(low[0] + high[0]) * 0.5
        sheets = []
        for label, colours in (("data", data), ("normal", normals)):
            obj = studio.mesh_object("%s_%s" % (name, label), positions, indices, colors=colours, smooth=False)
            obj.data.materials.append(material)
            pixels = studio.render_orthographic(scratch / ("%s-%s.png" % (name, label)),
                                                centre=(centre_x, height * 0.5, 0.0), width=width, height=height,
                                                size=(tile_width, tile_height), samples=24)
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)
            sheets.append(pixels)
        coverage = float((sheets[0][:, :, 3] > 0.5).mean())
        renders.append([dilate(sheet, iterations=12) for sheet in sheets])
        tiles.append(dict(asset=name, species=species, trees=trees, x=cursor + gutter, pixels=tile_width,
                          width=width, height=height, trunk=-centre_x / width if trees == 1 else 0.0,
                          coverage=coverage))
        cursor += tile_width + gutter * 2
    for index, path in enumerate((data_path, normal_path)):
        atlas = np.zeros((tile_height, cursor, 4), dtype=np.float32)
        if index == 1:
            atlas[:, :, :3] = (0.5, 0.5, 1.0)
        for tile, sheets in zip(tiles, renders):
            start = tile["x"]
            atlas[:, start:start + tile["pixels"]] = sheets[index]
            # The gutters carry the tile's edge colour and no cover.
            atlas[:, start - gutter:start, :3] = sheets[index][:, :1, :3]
            atlas[:, start + tile["pixels"]:start + tile["pixels"] + gutter, :3] = sheets[index][:, -1:, :3]
        studio.save_image(path, atlas)
    return dict(atlasWidth=cursor, atlasHeight=tile_height, gutter=gutter, tiles=tiles)


def sprite_contact(studio, data_path, normal_path, path, sun=(-0.55, 0.5, 0.67), background=SKY):
    """The sprite sheets lit from one side and composited on sky, for a human (never shipped)."""
    import bpy

    def read(file_path):
        image = bpy.data.images.load(str(file_path), check_existing=False)
        image.colorspace_settings.name = "Non-Color"
        width, height = image.size
        pixels = np.zeros(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        return pixels.reshape(height, width, 4)

    data = read(data_path)
    normal = read(normal_path)[:, :, :3] * 2.0 - 1.0
    shade, leaf, seed, alpha = data[:, :, 0:1], data[:, :, 1:2], data[:, :, 2:3], data[:, :, 3:4]
    light = normalize(np.asarray(sun, dtype=float))
    lit = np.clip((normal @ light)[:, :, None] * 0.75 + 0.25, 0.0, 1.0)
    green = np.array([0.1, 0.19, 0.08]) * (0.35 + 0.65 * shade) * (0.35 + 1.9 * lit)
    wood = _mix(np.array([0.2, 0.15, 0.12]), np.array([0.62, 0.3, 0.14]), seed) * (0.3 + 1.2 * shade) * (
        0.4 + 1.2 * lit)
    rgb = leaf * green + (1.0 - leaf) * wood
    rgb = rgb * alpha + np.array(background) * (1.0 - alpha)
    out = np.concatenate([np.clip(rgb, 0.0, 1.0) ** (1.0 / 2.2), np.ones_like(alpha)], axis=2)
    studio.save_image(path, out.astype(np.float32), colour=True)
    return path
