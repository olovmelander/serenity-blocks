"""Preview renders for the firefly-night pack. Nothing here is shipped.

The Fall grove's preview shows a tree whole. This scene is seen from eye height among the
trunks, so an elder is also rendered the way the camera will meet it - its foot, roots and
lowest boughs from 1.7 m - and the sprays and props, which the tree preview never shows,
get renders of their own. Vertex-colour data is turned into plain daylight colours here so
the geometry and the masks can be judged by eye.
"""

import math
from pathlib import Path

import numpy as np

import fall_grove_assets as grove

BARK_PREVIEW = {
    # (bare bark, what the alpha mask paints over it)
    "spruce": ((0.2, 0.15, 0.12), (0.2, 0.3, 0.08)),
    "pine": ((0.26, 0.23, 0.21), (0.6, 0.3, 0.13)),
    "birch": ((0.86, 0.85, 0.8), (0.05, 0.045, 0.04)),
    "snag": ((0.46, 0.44, 0.42), (0.36, 0.4, 0.26)),
}
GROUND = (0.3, 0.2, 0.12)
# Direction toward the sun. The camera looks along -Z, so this lights what it sees.
FRONT = (-0.55, 0.5, 0.67)


def aim_sun(light, direction):
    """Turn the preview sun so it shines from `direction` (a glTF-space vector toward the sun)."""
    from mathutils import Vector

    from fall_grove.studio import to_blender
    toward = to_blender(np.array([direction]))[0]
    light.rotation_euler = Vector(toward / np.linalg.norm(toward)).to_track_quat("Z", "Y").to_euler()


def _remove(objects):
    import bpy
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def _ground(studio, name, level=0.0, extent=80.0):
    ground = studio.mesh_object(name, np.array([[-extent, level, -extent], [extent, level, -extent],
                                                [extent, level, extent], [-extent, level, extent]]),
                                np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([GROUND], (4, 1)))
    ground.data.materials.append(studio.material("ground_preview", roughness=1.0))
    return ground


def tree(studio, grown, sprays, directory, sun):
    """`<name>.png`; a hero also gets `-foot` (from eye height) and `-roots`, a birch `-stem`."""
    specimen = grown["tree"]
    name = specimen.name
    positions, _normals, _uvs, colors, indices = grown["bark"]
    bare, cover = (np.array(value) for value in BARK_PREVIEW[specimen.meta["species"]])
    mask = colors[:, 3:4]
    bark_rgb = (bare * (1 - mask) + cover * mask) * (0.3 + 0.7 * colors[:, 2:3])
    bark = studio.mesh_object(name + "_bark_preview", positions, indices, colors=bark_rgb)
    bark.data.materials.append(studio.material("bark_preview", roughness=0.95))
    leaf_positions, leaf_colors, leaf_indices = grove.realised_foliage(grown, sprays)
    leaves = studio.mesh_object(name + "_leaves_preview", leaf_positions, leaf_indices, colors=leaf_colors,
                                smooth=False)
    leaves.data.materials.append(studio.material("leaf_preview", roughness=0.6, emission=0.25))
    ground = _ground(studio, name + "_ground_preview")
    height = specimen.meta["height"]
    distance = height * 1.75
    directory = Path(directory)
    aim_sun(sun, FRONT)
    studio.render(directory / ("%s.png" % name), eye=(distance * 0.12, height * 0.22, distance * 0.8),
                  target=(0.0, height * 0.46, 0.0), lens=30.0, size=(820, 900), samples=10)
    if grown["hero"]:
        studio.render(directory / ("%s-foot.png" % name), eye=(4.5, 1.7, 10.5), target=(0.0, 3.4, 0.0), lens=20.0,
                      size=(900, 900), samples=12)
        studio.render(directory / ("%s-roots.png" % name), eye=(3.5, 3.4, 7.0), target=(0.0, 0.6, 0.0), lens=24.0,
                      size=(900, 700), samples=12)
    elif specimen.meta["species"] == "birch":
        studio.render(directory / ("%s-stem.png" % name), eye=(1.5, 1.7, 7.5), target=(0.0, 3.6, 0.0), lens=24.0,
                      size=(700, 900), samples=12)
    _remove((bark, leaves, ground))


def _spray_colors(colors, leaf=(0.2, 0.42, 0.12), wood=(0.16, 0.1, 0.07)):
    blade = colors[:, 3:4]
    return blade * np.array(leaf) * (0.3 + 0.7 * colors[:, 2:3]) + (1 - blade) * np.array(wood)


def _posed(positions, pitch=0.0, yaw=0.0):
    """Spray space (+Y forward, +Z upper side) -> the world: forward along +X, upper side up.

    `pitch` then lifts the forward axis toward +Y and `yaw` turns the result about +Y.
    """
    world = np.stack([positions[:, 1], positions[:, 2], positions[:, 0]], axis=1)
    cosine, sine = math.cos(pitch), math.sin(pitch)
    world = np.stack([world[:, 0] * cosine - world[:, 1] * sine, world[:, 0] * sine + world[:, 1] * cosine,
                      world[:, 2]], axis=1)
    cosine, sine = math.cos(yaw), math.sin(yaw)
    return np.stack([world[:, 0] * cosine + world[:, 2] * sine, world[:, 1],
                     -world[:, 0] * sine + world[:, 2] * cosine], axis=1)


def spray(studio, name, arrays, path, leaf=(0.2, 0.42, 0.12)):
    """One spray lying level, seen from above-front, so its outline and its faces both read."""
    positions, _normals, _uvs, colors, indices = arrays
    obj = studio.mesh_object(name + "_preview", _posed(positions) + np.array([0.0, 0.5, 0.0]), indices,
                             colors=_spray_colors(colors, leaf), smooth=False)
    obj.data.materials.append(studio.material("spray_preview", roughness=0.6, emission=0.2))
    ground = _ground(studio, name + "_ground", extent=20.0)
    studio.render(path, eye=(0.45, 1.75, 1.15), target=(0.45, 0.42, 0.0), lens=62.0, size=(900, 700), samples=12)
    _remove((obj, ground))


def fern_clump(studio, fronds, path, count=11, scale=0.95):
    """A shuttlecock of fronds the way the runtime is expected to plant them.

    Each frond is pitched up from the ground and turned about the vertical; its upper face
    looks into the clump, so the built-in arch carries the tip outward and over.
    """
    all_positions = []
    all_colors = []
    all_indices = []
    offset = 0
    rng = np.random.default_rng(12)
    for index in range(count):
        positions, _normals, _uvs, colors, indices = fronds[index % len(fronds)]
        pitch = math.radians(float(rng.uniform(52, 74)))
        yaw = index * math.radians(137.5) + float(rng.uniform(-0.2, 0.2))
        size = scale * float(rng.uniform(0.8, 1.15))
        world = _posed(positions * size, pitch=pitch, yaw=yaw)
        all_positions.append(world)
        all_colors.append(_spray_colors(colors, leaf=(0.16 + 0.06 * rng.random(), 0.4, 0.1)))
        all_indices.append(indices.reshape(-1) + offset)
        offset += len(world)
    obj = studio.mesh_object("fern_clump_preview", np.concatenate(all_positions), np.concatenate(all_indices),
                             colors=np.concatenate(all_colors), smooth=False)
    obj.data.materials.append(studio.material("fern_preview", roughness=0.6, emission=0.2))
    ground = _ground(studio, "fern_ground", extent=20.0)
    studio.render(path, eye=(0.5, 1.15, 2.3), target=(0.0, 0.42, 0.0), lens=50.0, size=(900, 760), samples=14)
    _remove((obj, ground))


def prop(studio, name, arrays, path, stone=False):
    """A prop in daylight: tone as bark-to-heartwood (or dark-to-light stone), moss green over it, AO as shade."""
    positions, _normals, _uvs, colors, indices = arrays
    tone = colors[:, 0:1]
    if stone:
        rgb = np.array([0.2, 0.2, 0.21]) * (1 - tone) + np.array([0.58, 0.56, 0.52]) * tone
    else:
        pale = np.clip((tone - 0.3) / 0.6, 0.0, 1.0)
        rgb = np.array([0.15, 0.1, 0.075]) * (1 - pale) + np.array([0.78, 0.63, 0.42]) * pale
    moss = colors[:, 3:4]
    rgb = (rgb * (1 - moss) + np.array([0.17, 0.33, 0.07]) * moss) * (0.22 + 0.78 * colors[:, 2:3])
    obj = studio.mesh_object(name + "_preview", positions, indices, colors=rgb)
    obj.data.materials.append(studio.material("prop_preview", roughness=0.9))
    ground = _ground(studio, name + "_ground", extent=40.0)
    low, high = positions.min(axis=0), positions.max(axis=0)
    centre = (low + high) * 0.5
    span = float(np.max(high - low))
    tall = (high[1] - low[1]) > 1.5 * max(high[0] - low[0], high[2] - low[2])
    if tall:
        eye = (centre[0] + span * 0.35, span * 0.3, centre[2] + span * 1.55)
        target = (centre[0], centre[1] * 0.95, centre[2])
    else:
        eye = (centre[0] - span * 0.55, max(1.5, span * 0.5), centre[2] + span * 1.15)
        target = (centre[0], max(0.1, centre[1] * 0.7), centre[2])
    studio.render(path, eye=eye, target=target, lens=35.0, size=(1000, 760), samples=14)
    _remove((obj, ground))
