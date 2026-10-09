"""Preview renders for the Verdant Hills pack (never shipped).

The shipped files carry shading data, not colour: the theme owns every material. These
previews paint that data with stand-in colours so a tree or a prop can be judged in
Blender before the runtime has a line of shader for it.
"""

import math

import numpy as np

import fall_grove_assets as grove

from .kit import CANVAS, CODES, DOOR, GLASS, IRON, LIMEWASH, SKIN, STONE, TAR, TIMBER, WHITE, WOOL

GRASS = (0.2, 0.34, 0.09)
LEAF_COLOURS = [(0.2, 0.42, 0.08), (0.26, 0.5, 0.1), (0.16, 0.36, 0.07), (0.32, 0.54, 0.12)]
# (plain bark, bark where the moss mask is 1)
BARK_LOOK = ((0.25, 0.21, 0.17), (0.3, 0.4, 0.13))


def _mix(low, high, share):
    """Blend two colours (or per-vertex colour arrays) by a per-vertex share."""
    return np.asarray(low, dtype=float) * (1.0 - share) + np.asarray(high, dtype=float) * share


def prop_colours(colors):
    """Stand-in colours for a prop's vertices from its tone, material code, occlusion and wear."""
    tone, occlusion, wear = colors[:, 0:1], colors[:, 2:3], colors[:, 3:4]
    code = np.round(colors[:, 1] * CODES).astype(int)
    rgb = np.zeros((len(colors), 3))
    looks = {
        TIMBER: _mix(_mix((0.2, 0.17, 0.14), (0.5, 0.47, 0.42), tone), (0.56, 0.56, 0.54), wear * 0.55),
        LIMEWASH: _mix(np.array((0.9, 0.89, 0.84))[None, :] * (0.84 + 0.16 * tone), (0.36, 0.4, 0.24), wear * 0.75),
        WHITE: _mix(np.array((0.93, 0.93, 0.9))[None, :] * (0.88 + 0.12 * tone), (0.55, 0.52, 0.46), wear * 0.6),
        TAR: _mix(_mix((0.03, 0.03, 0.035), (0.1, 0.1, 0.11), tone), (0.27, 0.27, 0.26), wear * 0.6),
        STONE: _mix(_mix((0.4, 0.38, 0.33), (0.76, 0.73, 0.66), tone), (0.4, 0.46, 0.2), wear * 0.6),
        GLASS: np.array((0.05, 0.08, 0.12))[None, :] + tone * np.array((0.06, 0.07, 0.09))[None, :],
        DOOR: _mix(np.array((0.1, 0.25, 0.3))[None, :] * (0.6 + 0.5 * tone), (0.3, 0.28, 0.24), wear * 0.6),
        CANVAS: _mix(np.array((0.86, 0.8, 0.66))[None, :] * (0.85 + 0.15 * tone), (0.55, 0.5, 0.4), wear * 0.6),
        WOOL: _mix(_mix((0.74, 0.72, 0.64), (0.96, 0.95, 0.9), tone), (0.5, 0.45, 0.34), wear * 0.7),
        SKIN: np.array((0.07, 0.06, 0.06))[None, :] * (0.7 + 0.7 * tone),
        IRON: _mix(np.array((0.07, 0.07, 0.08))[None, :] * (0.7 + 0.6 * tone), (0.32, 0.15, 0.07), wear * 0.7),
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


def _ground(studio, colour=GRASS, extent=120.0):
    ground = studio.mesh_object("ground_preview", np.array(
        [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
        np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([colour], (4, 1)))
    ground.data.materials.append(studio.material("ground_preview", roughness=1.0))
    return ground


def _prop_object(studio, name, arrays):
    positions, _normals, _uvs, colors, indices = arrays
    obj = studio.mesh_object("preview_" + name, positions, indices, colors=prop_colours(colors), smooth=False)
    obj.data.materials.append(studio.material("prop_preview", roughness=0.85, emission=0.12))
    return obj


def prop(studio, name, arrays, directory, grounded=True, views=None, size=(1200, 900), samples=24, extra=()):
    """Stills of one prop: a three-quarter view and the front elevation, plus any `views` asked for.

    `extra` are (name, arrays) of other props shown with it (the sails on the mill).
    """
    positions = arrays[0]
    objects = [_prop_object(studio, name, arrays)] + [_prop_object(studio, other, more) for other, more in extra]
    if grounded:
        objects.append(_ground(studio))
    every = np.concatenate([positions] + [more[0] for _other, more in extra])
    low, high = every.min(axis=0), every.max(axis=0)
    low[1] = max(low[1], 0.0) if grounded else low[1]
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
            grounded=True, extra=()):
    """One still of a prop from a named place (metres, in the prop's own space)."""
    objects = [_prop_object(studio, name, arrays)] + [_prop_object(studio, other, more) for other, more in extra]
    if grounded:
        objects.append(_ground(studio))
    path = directory / ("prop-%s-%s.png" % (name, label))
    studio.render(path, eye=eye, target=target, lens=lens, size=size, samples=samples)
    _remove(objects)
    return path


def spray(studio, name, arrays, directory, size=(900, 900), samples=24):
    """Two stills of one spray: its lit face and a raking view."""
    positions, _normals, _uvs, colors, indices = arrays
    leaf = colors[:, 3:4]
    rgb = leaf * np.array(LEAF_COLOURS[1]) * colors[:, 2:3] + (1.0 - leaf) * np.array([0.16, 0.12, 0.09])
    # Laid on the floor of the studio with its lit side up: spray +Y -> -Z, spray +Z -> +Y.
    laid = np.stack([positions[:, 0], positions[:, 2] + 1.0, -positions[:, 1] + 0.5], axis=1)
    obj = studio.mesh_object("preview_" + name, laid, indices, colors=rgb, smooth=False)
    obj.data.materials.append(studio.material("leaf_preview", roughness=0.6, emission=0.25))
    backdrop = _ground(studio, colour=(0.62, 0.66, 0.72), extent=30.0)
    written = []
    for label, eye in (("top", (0.0, 3.4, 0.01)), ("raking", (1.2, 1.75, 1.35))):
        path = directory / ("spray-%s-%s.png" % (name, label))
        studio.render(path, eye=eye, target=(0.0, 1.0, 0.0), lens=60.0, size=size, samples=samples)
        written.append(path)
    _remove((obj, backdrop))
    return written


def tree(studio, grown, sprays, path, eye=None, target=None, lens=30.0, size=(820, 900), samples=12, foliage=True):
    """One still of a tree with its sprays realised on their sites (or of its bare wood)."""
    specimen = grown["tree"]
    positions, _normals, _uvs, colors, indices = grown["bark"]
    plain, masked = BARK_LOOK
    bark_rgb = _mix(plain, masked, colors[:, 3:4]) * (0.3 + 0.7 * colors[:, 2:3])
    bark = studio.mesh_object(specimen.name + "_bark_preview", positions, indices, colors=bark_rgb)
    bark.data.materials.append(studio.material("bark_preview", roughness=0.95))
    objects = [bark, _ground(studio)]
    low = high = None
    triangles = 0
    if foliage:
        leaf_positions, leaf_colors, leaf_indices = grove.realised_foliage(grown, sprays)
        leaves = studio.mesh_object(specimen.name + "_leaves_preview", leaf_positions, leaf_indices, colors=leaf_colors,
                                    smooth=False)
        leaves.data.materials.append(studio.material("leaf_preview", roughness=0.6, emission=0.25))
        objects.append(leaves)
        low, high = leaf_positions.min(axis=0), leaf_positions.max(axis=0)
        triangles = int(len(leaf_indices) // 3)
    height = specimen.meta["height"]
    distance = height * 1.75
    studio.render(path, eye=eye or (distance * 0.12, height * 0.22, distance * 0.8),
                  target=target or (0.0, height * 0.46, 0.0), lens=lens, size=size, samples=samples)
    _remove(objects)
    if low is None:
        return None, None, 0
    return [float(v) for v in low], [float(v) for v in high], triangles
