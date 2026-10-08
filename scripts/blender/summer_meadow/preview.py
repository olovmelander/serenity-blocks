"""Preview renders for the Summer pack (never shipped).

The shipped files carry shading data, not colour: the theme owns every material. These
previews paint that data with stand-in colours so a tree or a prop can be judged in
Blender before the runtime has a line of shader for it.
"""

import math

import numpy as np

import fall_grove_assets as grove

from .kit import ACCENT, CODES, FLOWER, GLASS, LEAF, RED, STONE, TILE, TIMBER, WHITE

FLOWER_HUES = np.array([(0.95, 0.94, 0.9), (0.98, 0.8, 0.12), (0.2, 0.32, 0.85), (0.92, 0.42, 0.62), (0.85, 0.1, 0.08),
                        (0.5, 0.3, 0.8), (0.98, 0.5, 0.1)])
GRASS = (0.13, 0.24, 0.07)


def _mix(low, high, share):
    """Blend two colours (or per-vertex colour arrays) by a per-vertex share."""
    return np.asarray(low, dtype=float) * (1.0 - share) + np.asarray(high, dtype=float) * share


def prop_colours(colors):
    """Stand-in colours for a prop's vertices from its tone, material code, occlusion and wear."""
    tone, occlusion, wear = colors[:, 0:1], colors[:, 2:3], colors[:, 3:4]
    code = np.round(colors[:, 1] * CODES).astype(int)
    rgb = np.zeros((len(colors), 3))
    looks = {
        TIMBER: _mix(_mix((0.17, 0.13, 0.1), (0.5, 0.45, 0.38), tone), (0.42, 0.42, 0.4), wear * 0.5),
        RED: _mix(np.array((0.44, 0.07, 0.045))[None, :] * (0.7 + 0.42 * tone), (0.3, 0.19, 0.16), wear * 0.55),
        WHITE: _mix(np.array((0.88, 0.87, 0.82))[None, :] * (0.86 + 0.14 * tone), (0.56, 0.55, 0.5), wear * 0.5),
        TILE: _mix(_mix((0.34, 0.11, 0.06), (0.68, 0.3, 0.15), tone), (0.2, 0.26, 0.1), wear * 0.7),
        STONE: _mix(_mix((0.24, 0.23, 0.22), (0.6, 0.57, 0.53), tone), (0.36, 0.4, 0.26), wear * 0.45),
        GLASS: np.array((0.05, 0.08, 0.12))[None, :] + tone * np.array((0.06, 0.07, 0.09))[None, :],
        ACCENT: np.array((0.06, 0.2, 0.16))[None, :] * (0.55 + 0.6 * tone),
        LEAF: _mix((0.04, 0.13, 0.03), (0.3, 0.52, 0.1), tone) * (0.75 + 0.25 * wear),
        FLOWER: _mix((0.95, 0.7, 0.08), FLOWER_HUES[np.minimum((tone[:, 0] * len(FLOWER_HUES)).astype(int),
                                                               len(FLOWER_HUES) - 1)],
                     np.clip((wear - 0.1) / 0.3, 0.0, 1.0)),
    }
    for value, look in looks.items():
        chosen = code == value
        rgb[chosen] = np.broadcast_to(look, rgb.shape)[chosen]
    return rgb * (0.22 + 0.78 * occlusion)


def _remove(objects):
    import bpy
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def _ground(studio, colour=GRASS, extent=90.0):
    ground = studio.mesh_object("ground_preview", np.array(
        [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
        np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([colour], (4, 1)))
    ground.data.materials.append(studio.material("ground_preview", roughness=1.0))
    return ground


def prop(studio, name, arrays, directory, grounded=True, views=None, size=(1200, 900), samples=24):
    """Stills of one prop: a three-quarter view and the front elevation, plus any `views` asked for."""
    positions, _normals, _uvs, colors, indices = arrays
    obj = studio.mesh_object("preview_" + name, positions, indices, colors=prop_colours(colors), smooth=False)
    obj.data.materials.append(studio.material("prop_preview", roughness=0.85, emission=0.12))
    objects = [obj]
    if grounded:
        objects.append(_ground(studio))
    low, high = positions.min(axis=0), positions.max(axis=0)
    low[1] = max(low[1], 0.0)
    centre = (low + high) * 0.5
    radius = float(np.linalg.norm(high - low)) * 0.5
    shots = {"34": (0.62, 0.3, 0.74), "front": (0.0, 0.1, 1.0)}
    shots.update(views or {})
    written = []
    for label, direction in shots.items():
        direction = np.asarray(direction, dtype=float)
        direction = direction / np.linalg.norm(direction)
        distance = radius / math.tan(math.radians(16.5))
        path = directory / ("prop-%s-%s.png" % (name, label))
        studio.render(path, eye=tuple(centre + direction * distance), target=tuple(centre), lens=50.0, size=size,
                      samples=samples)
        written.append(path)
    _remove(objects)
    return written


def closeup(studio, name, arrays, directory, label, eye, target, lens=50.0, size=(1200, 900), samples=24,
            grounded=True):
    """One still of a prop from a named place (metres, in the prop's own space)."""
    positions, _normals, _uvs, colors, indices = arrays
    obj = studio.mesh_object("preview_" + name, positions, indices, colors=prop_colours(colors), smooth=False)
    obj.data.materials.append(studio.material("prop_preview", roughness=0.85, emission=0.12))
    objects = [obj] + ([_ground(studio)] if grounded else [])
    path = directory / ("prop-%s-%s.png" % (name, label))
    studio.render(path, eye=eye, target=target, lens=lens, size=size, samples=samples)
    _remove(objects)
    return path


BARK_LOOKS = {
    # (plain bark, bark where the species mask is 1)
    "birch": ((0.82, 0.8, 0.74), (0.07, 0.05, 0.05)),
    "spruce": ((0.2, 0.15, 0.12), (0.42, 0.46, 0.34)),
}


def tree(studio, grown, sprays, path, eye=None, target=None, lens=30.0, size=(820, 900), samples=12):
    """One still of a tree with its sprays realised on their sites."""
    specimen = grown["tree"]
    positions, _normals, _uvs, colors, indices = grown["bark"]
    plain, masked = BARK_LOOKS[specimen.meta["species"]]
    bark_rgb = _mix(plain, masked, colors[:, 3:4]) * (0.3 + 0.7 * colors[:, 2:3])
    bark = studio.mesh_object(specimen.name + "_bark_preview", positions, indices, colors=bark_rgb)
    bark.data.materials.append(studio.material("bark_preview", roughness=0.95))
    leaf_positions, leaf_colors, leaf_indices = grove.realised_foliage(grown, sprays)
    leaves = studio.mesh_object(specimen.name + "_leaves_preview", leaf_positions, leaf_indices, colors=leaf_colors,
                                smooth=False)
    leaves.data.materials.append(studio.material("leaf_preview", roughness=0.6, emission=0.25))
    ground = _ground(studio)
    height = specimen.meta["height"]
    distance = height * 1.75
    studio.render(path, eye=eye or (distance * 0.12, height * 0.22, distance * 0.8),
                  target=target or (0.0, height * 0.46, 0.0), lens=lens, size=size, samples=samples)
    _remove((bark, leaves, ground))
    low, high = leaf_positions.min(axis=0), leaf_positions.max(axis=0)
    return [float(v) for v in low], [float(v) for v in high], int(len(leaf_indices) // 3)
