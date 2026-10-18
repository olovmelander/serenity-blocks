"""Preview renders and the far-belt sprite sheet for the Grainfields trees.

The shipped files carry shading data, not colour: the theme owns every material. The
previews (never shipped) paint that data with stand-in colours so a tree can be judged in
Blender before the runtime has a line of shader for it: one still per tree, and a line-up
of every tree from the distance the fields show them at.

`bake_impostors` is the Fall grove's sprite bake (same data, same tile records) with a
smaller tile: the belts it serves are 600 m to 3 km away, where a tree is a few dozen
pixels tall, so 256-pixel tiles keep several times the detail the screen can show.
"""

import numpy as np

import fall_grove_assets as grove

GRASS = (0.2, 0.2, 0.08)
SKY = (0.56, 0.6, 0.66)
BARK_LOOKS = {
    # (plain bark, bark where the species mask is 1)
    "birch": ((0.84, 0.82, 0.77), (0.07, 0.05, 0.05)),
    "spruce": ((0.18, 0.14, 0.12), (0.4, 0.43, 0.34)),
    "larch": ((0.24, 0.2, 0.17), (0.38, 0.2, 0.12)),
}
LEAF_PREVIEW = {
    "birch": [(0.3, 0.5, 0.12), (0.38, 0.56, 0.14), (0.26, 0.44, 0.1), (0.44, 0.6, 0.16)],
    "spruce": [(0.05, 0.11, 0.06), (0.07, 0.14, 0.07), (0.09, 0.16, 0.07), (0.06, 0.12, 0.07)],
    "larch": [(0.36, 0.52, 0.16), (0.42, 0.58, 0.18), (0.32, 0.46, 0.14), (0.46, 0.6, 0.2)],
}
IMPOSTOR_TILE_HEIGHT = 256


def _mix(low, high, share):
    return np.asarray(low, dtype=float) * (1.0 - share) + np.asarray(high, dtype=float) * share


def _remove(objects):
    import bpy
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def _ground(studio, extent=400.0):
    ground = studio.mesh_object("ground_preview", np.array(
        [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
        np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([GRASS], (4, 1)))
    ground.data.materials.append(studio.material("ground_preview", roughness=1.0))
    return ground


def _tree_objects(studio, grown, sprays, offset=(0.0, 0.0, 0.0)):
    """The bark and the realised sprays of one tree, painted with stand-in colours."""
    specimen = grown["tree"]
    positions, _normals, _uvs, colors, indices = grown["bark"]
    plain, masked = BARK_LOOKS[specimen.meta["species"]]
    bark_rgb = _mix(plain, masked, colors[:, 3:4]) * (0.3 + 0.7 * colors[:, 2:3])
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
    return [float(v) for v in low], [float(v) for v in high], int(len(leaf_indices) // 3)


def lineup(studio, stand, sprays, path, distance=120.0, eye_height=4.0, size=(1800, 640), samples=16, gap=3.0):
    """Every tree side by side, seen from `distance` metres at about the height of a lane."""
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
    objects.append(_ground(studio))
    centre = cursor * 0.5
    width = cursor * 1.04
    # Fit the row's width: the sensor is 36 mm wide.
    lens = 36.0 * distance / width
    target_height = tallest * 0.5
    studio.render(path, eye=(centre, eye_height, distance), target=(centre, target_height, 0.0), lens=lens,
                  size=size, samples=samples)
    _remove(objects)
    return path


def bake_impostors(studio, grown_trees, sprays, path, scratch, tile_height=IMPOSTOR_TILE_HEIGHT):
    """Front-elevation data sprites of the grove trees for the far belts (the Fall grove's bake).

    Each tile is fitted to its crown, so tiles differ in width; the manifest records every
    tile's pixel rectangle, its size in metres and where the trunk stands inside it.
    """
    import bpy
    from fall_grove.studio import dilate
    material = studio.data_material("impostor")
    renders = []
    tiles = []
    cursor = 0
    for grown in grown_trees:
        specimen = grown["tree"]
        positions, colors, indices = grove.impostor_mesh(grown, sprays)
        low = positions.min(axis=0)
        high = positions.max(axis=0)
        height = float(high[1]) * 1.04
        width = float(high[0] - low[0]) * 1.06
        tile_width = int(min(384, max(64, round(tile_height * width / height / 8.0) * 8)))
        width = height * tile_width / tile_height
        centre_x = float(low[0] + high[0]) * 0.5
        obj = studio.mesh_object(specimen.name + "_impostor", positions, indices, colors=colors, smooth=False)
        obj.data.materials.append(material)
        pixels = studio.render_orthographic(scratch / ("%s-impostor.png" % specimen.name),
                                            centre=(centre_x, height * 0.5, 0.0), width=width, height=height,
                                            size=(tile_width, tile_height), samples=24)
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        renders.append(dilate(pixels, iterations=12))
        tiles.append(dict(asset=specimen.name, species=specimen.meta["species"], x=cursor, pixels=tile_width,
                          width=width, height=height, trunk=-centre_x / width,
                          coverage=float((pixels[:, :, 3] > 0.5).mean())))
        cursor += tile_width
    atlas = np.zeros((tile_height, cursor, 4), dtype=np.float32)
    for tile, pixels in zip(tiles, renders):
        atlas[:, tile["x"]:tile["x"] + tile["pixels"]] = pixels
    studio.save_image(path, atlas)
    return dict(atlasWidth=cursor, atlasHeight=tile_height, tiles=tiles)


def impostor_contact(studio, sheet_path, path, background=SKY):
    """The sprite sheet painted for a human: shade as green or bark, composited on sky (never shipped)."""
    import bpy
    image = bpy.data.images.load(str(sheet_path), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    pixels = np.zeros(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    pixels = pixels.reshape(height, width, 4)
    shade, leaf, alpha = pixels[:, :, 0:1], pixels[:, :, 1:2], pixels[:, :, 3:4]
    green = np.array([0.2, 0.42, 0.1]) * (0.3 + 1.2 * shade)
    wood = np.array([0.7, 0.68, 0.64]) * (0.4 + 1.0 * shade)
    rgb = leaf * green + (1.0 - leaf) * wood
    rgb = rgb * alpha + np.array(background) * (1.0 - alpha)
    out = np.concatenate([np.clip(rgb, 0.0, 1.0), np.ones_like(alpha)], axis=2)
    studio.save_image(path, out.astype(np.float32), colour=True)
    return path
