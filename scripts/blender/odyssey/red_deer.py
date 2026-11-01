"""Odyssey's island deer: a red deer hind, modelled and rigged procedurally in headless Blender.

    blender -b --factory-startup --python scripts/blender/odyssey/red_deer.py -- \
        --out src/rendering/odyssey/assets/chapter-03/deer/red-deer.glb [--preview <dir>]

The herd grazes the glade on the rise above the chapter-3 shore, seen from the rail 120 to 240 metres
off and drawn at three times life (like the rest of the act's life), so a hind is some twenty-five to
fifty pixels tall at the withers on a 1440p screen. What has to read is the silhouette and the value: a long, slender neck carried high
or swung down to the grass, a long narrow head with big ears, a deep chest over long thin legs, a
short tail in a pale rump patch; the summer coat a warm red-brown, the neck and legs greyer.

How it is made (the meshing is the Grainfields horse's, scripts/blender/grainfields/horse_sdf.py):

- **Shape.** A signed distance field of ellipsoids and round cones joined by smooth unions: the
  barrel, the chest and brisket, the withers and the shoulders, the loins, croup, quarters and
  thighs; the neck; the head as cranium, jowl, a long face and a soft muzzle, the eyes; the ears,
  cupped; each leg a tube through its joints (forearm or gaskin, knee or hock, cannon, fetlock) to a
  small cloven hoof; the short tail. The legs are a little thicker than life (`LEG_THICKEN`) so that,
  drawn small, they stay solid lines rather than flickering threads.
- **Mesh.** The field's left half is sampled on a grid, polygonised with surface nets, projected
  onto the zero set, decimated in Blender with a quadric edge collapse, cleaned of folds and
  mirrored, so the deer is exactly symmetric.
- **Skeleton.** Twenty-five bones (BONES): the root, the pelvis and the chest; two neck bones, the
  head, the ears; each fore leg's humerus, forearm, cannon and hoof; each hind leg's femur, tibia,
  cannon and hoof; the tail. Every bone rests aligned with the deer's own axes (x left, y up, z
  forward), so a pose is a rotation of each bone about its head in its parent's frame (R = Ry Rz Rx).
- **Skin.** Up to four bones a vertex (`_BONES`, `_WEIGHTS`): each part follows its chain with blends
  at the joints, fades into the trunk across a band, and the weights are smoothed over the mesh.
- **Paint.** COLOR_0 = (pale, dark, grey, sky seen): the buff rump patch, the pale belly and the
  inside of the legs and ears; the hooves, the nose, the eyes and the tail's dark top; the greyer
  neck, head and legs; ambient occlusion traced through the field.

Frame: metres at real size, +z forward (toward the head), +y up, the hooves on y = 0, the body
centred on x = 0; the deer faces +z, so its left side is +x. No external asset is used.
"""

import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from grainfields.horse_sdf import (  # noqa: E402
    X_AXIS, Z_AXIS, Ellipsoid, HalfSpace, RoundCone, Tube, Union,
    _grid, _neighbours, _point, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)
from grainfields.horse import occlusion  # noqa: E402

TAG = "[odyssey-deer]"
NAME = "red-deer"
SPECIES = "Red deer (Cervus elaphus), a hind"
GENERATOR = "Serenity Blocks - Odyssey red deer (scripts/blender/odyssey/red_deer.py)"
SCHEMA_VERSION = 1
VOXEL = 0.011
TARGET_TRIANGLES = 1800
LEG_THICKEN = 1.3

PARTS = {"body": 0, "neck": 1, "head": 2, "frontLeft": 3, "frontRight": 4, "hindLeft": 5, "hindRight": 6,
         "tail": 7, "earLeft": 8, "earRight": 9}

# Where the legs stand (z of the front and hind cannons) and how far apart (x).
FRONT_Z = 0.40
HIND_Z = -0.58
FORE_X = 0.105
HIND_X = 0.11

# The head's frame: from the poll, s forward along the face (52 degrees below the horizontal), t
# toward the forehead, x across. A long, narrow head, 0.40 m from the poll to the nose.
POLL = _point(1.52, 0.72)
HEAD_PITCH = math.radians(52.0)
HEAD_FORWARD = np.array([0.0, -math.sin(HEAD_PITCH), math.cos(HEAD_PITCH)])
HEAD_UP = np.array([0.0, math.cos(HEAD_PITCH), math.sin(HEAD_PITCH)])


def head_point(s, t, x=0.0):
    return POLL + s * HEAD_FORWARD + t * HEAD_UP + np.array([x, 0.0, 0.0])


def _ear_base(side):
    return head_point(0.0, 0.03, 0.05 * side)


def _ear_direction(side):
    # Up, out and a little back: the alert hind's ears.
    return _unit(np.array([0.70 * side, 0.64, -0.28]))


def _bone_table():
    """(name, parent, head) in an order where every parent comes before its children."""
    bones = [
        ("root", None, (0.0, 0.88, -0.05)),
        ("pelvis", "root", (0.0, 0.95, -0.30)),
        ("chest", "root", (0.0, 0.95, 0.18)),
        ("neck0", "chest", (0.0, 1.00, 0.42)),
        ("neck1", "neck0", (0.0, 1.22, 0.58)),
        ("head", "neck1", tuple(float(v) for v in POLL)),
        ("earL", "head", tuple(float(v) for v in _ear_base(1.0))),
        ("earR", "head", tuple(float(v) for v in _ear_base(-1.0))),
        ("tail", "pelvis", (0.0, 1.03, -0.66)),
    ]
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x = FORE_X * side
        bones += [
            ("humerus" + tag, "chest", (x, 0.95, 0.34)),
            ("forearm" + tag, "humerus" + tag, (x, 0.74, 0.43)),
            ("foreCannon" + tag, "forearm" + tag, (x, 0.40, FRONT_Z)),
            ("foreHoof" + tag, "foreCannon" + tag, (x, 0.095, FRONT_Z)),
        ]
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x = HIND_X * side
        bones += [
            ("femur" + tag, "pelvis", (x, 0.95, -0.40)),
            ("tibia" + tag, "femur" + tag, (x * 1.1, 0.78, -0.35)),
            ("hindCannon" + tag, "tibia" + tag, (x, 0.48, HIND_Z)),
            ("hindHoof" + tag, "hindCannon" + tag, (x, 0.095, HIND_Z)),
        ]
    return bones


BONES = _bone_table()
BONE_INDEX = {name: index for index, (name, _parent, _head) in enumerate(BONES)}
BONE_HEADS = np.array([head for _name, _parent, head in BONES], dtype=np.float64)
BONE_PARENTS = np.array([-1 if parent is None else BONE_INDEX[parent] for _name, parent, _head in BONES])


def joint(name):
    return BONE_HEADS[BONE_INDEX[name]]


# -- the legs -----------------------------------------------------------------------------
def _front_leg(side):
    x = FORE_X * side
    z = FRONT_Z
    k = LEG_THICKEN
    return Union([
        # The forearm, muscled under the elbow and lean above the knee; the point of the elbow.
        Tube([_point(0.80, z + 0.035, x), _point(0.62, z + 0.012, x), _point(0.42, z, x)],
             [0.062 * k, 0.044 * k, 0.03 * k], squash_axis=X_AXIS, squash=0.86),
        Ellipsoid(_point(0.75, z - 0.045, x * 1.02), (0.036, 0.045, 0.045)),
        # The knee, the long thin cannon, the fetlock and the small pointed hoof.
        Ellipsoid(_point(0.40, z, x), (0.029 * k, 0.034 * k, 0.033 * k)),
        Tube([_point(0.39, z - 0.002, x), _point(0.11, z - 0.004, x)], [0.021 * k, 0.019 * k],
             squash_axis=X_AXIS, squash=0.85),
        Ellipsoid(_point(0.095, z - 0.004, x), (0.023 * k, 0.026 * k, 0.027 * k)),
        RoundCone(_point(0.075, z + 0.004, x), _point(0.016, z + 0.036, x), 0.021 * k, 0.026 * k),
    ], k=0.022)


def _hind_leg(side):
    x = HIND_X * side
    z = HIND_Z
    k = LEG_THICKEN
    return Union([
        # The gaskin from the stifle down and back to the hock, its muscle behind.
        Tube([_point(0.82, z + 0.22, x * 1.15), _point(0.66, z + 0.09, x), _point(0.49, z + 0.004, x)],
             [0.085, 0.056 * k, 0.034 * k], squash_axis=X_AXIS, squash=0.8),
        Ellipsoid(_point(0.70, z + 0.07, x), (0.045, 0.07, 0.085), along=(0.0, 0.62, 0.78)),
        # The hock and its point.
        Ellipsoid(_point(0.48, z, x), (0.03 * k, 0.04 * k, 0.042 * k)),
        Ellipsoid(_point(0.505, z - 0.042, x), (0.02 * k, 0.03 * k, 0.022 * k)),
        # The cannon, the fetlock and the hoof.
        Tube([_point(0.47, z - 0.002, x), _point(0.11, z + 0.002, x)], [0.022 * k, 0.019 * k],
             squash_axis=X_AXIS, squash=0.85),
        Ellipsoid(_point(0.095, z + 0.002, x), (0.023 * k, 0.026 * k, 0.027 * k)),
        RoundCone(_point(0.075, z + 0.006, x), _point(0.016, z + 0.034, x), 0.021 * k, 0.026 * k),
    ], k=0.022)


# -- the deer -----------------------------------------------------------------------------
def design():
    """The hind as a distance field, and the landmarks the paint and the skin use."""
    body = Union([
        # A deep chest over a slimmer barrel, the belly tucked up toward the flank.
        Ellipsoid(_point(0.87, -0.06), (0.185, 0.215, 0.48)),
        Ellipsoid(_point(0.80, -0.02), (0.17, 0.16, 0.32)),
        Ellipsoid(_point(0.88, 0.28), (0.17, 0.235, 0.22)),
        (Ellipsoid(_point(0.75, 0.34), (0.11, 0.11, 0.13)), 0.08),
        # The withers, and the shoulders sloping down and forward from them.
        (Ellipsoid(_point(1.03, 0.25), (0.09, 0.08, 0.20)), 0.1),
        *[(Ellipsoid(_point(0.92, 0.34, 0.085 * s), (0.08, 0.15, 0.11), along=(0.0, 0.85, 0.52)), 0.08)
          for s in (1.0, -1.0)],
        # The loins, a little below the withers and the croup.
        Ellipsoid(_point(0.99, -0.14), (0.14, 0.08, 0.30)),
        # The quarters, the croup falling to the tail, the thighs and the buttocks.
        Ellipsoid(_point(0.90, -0.45), (0.18, 0.21, 0.23)),
        (Ellipsoid(_point(1.02, -0.42), (0.12, 0.09, 0.21), along=(0.0, 0.25, 0.97)), 0.1),
        *[(Ellipsoid(_point(0.81, -0.49, 0.105 * s), (0.075, 0.16, 0.12)), 0.08) for s in (1.0, -1.0)],
        (Ellipsoid(_point(0.90, -0.60), (0.12, 0.14, 0.08)), 0.08),
    ], k=0.1).tag(PARTS["body"])

    # The neck: long and slender, rising at about 40 degrees from the chest to the poll, deeper at
    # its base, the throat line straight.
    neck = Tube([_point(0.98, 0.38), _point(1.13, 0.50), _point(1.29, 0.60), _point(1.44, 0.68),
                 _point(1.53, 0.71)],
                [0.145, 0.112, 0.088, 0.074, 0.07], squash_axis=X_AXIS, squash=[0.72, 0.74, 0.78, 0.8, 0.82],
                k=0.03).tag(PARTS["neck"])

    head = Union([
        Ellipsoid(head_point(0.06, -0.035), (0.072, 0.075, 0.095), along=HEAD_FORWARD),     # cranium
        Ellipsoid(head_point(0.08, -0.095), (0.058, 0.07, 0.085), along=HEAD_FORWARD),      # jowl
        RoundCone(head_point(0.11, -0.04), head_point(0.35, -0.055), 0.062, 0.037,
                  (X_AXIS, 0.82)),                                                          # face
        Ellipsoid(head_point(0.37, -0.066), (0.034, 0.04, 0.042), along=HEAD_FORWARD),      # muzzle
        Ellipsoid(head_point(0.355, -0.095), (0.024, 0.022, 0.03), along=HEAD_FORWARD),     # chin
        *[Ellipsoid(head_point(0.10, -0.004, 0.066 * s), (0.016, 0.018, 0.022), along=HEAD_FORWARD)
          for s in (1.0, -1.0)],                                                            # eyes
    ], k=0.035).tag(PARTS["head"])

    # Big ears, the first thing the silhouette needs: leaf-shaped and cupped (thin front to back).
    ears = []
    for side, part in ((1.0, PARTS["earLeft"]), (-1.0, PARTS["earRight"])):
        base = _ear_base(side)
        direction = _ear_direction(side)
        across = _unit(np.array(Z_AXIS) - direction * direction[2])
        ear = Tube([base, base + 0.09 * direction, base + 0.205 * direction], [0.038, 0.05, 0.014],
                   squash_axis=across, squash=0.42, k=0.01).tag(part)
        for leaf in ear.leaves():
            leaf.ear = True
        ears.append(ear)

    # The short tail, held down over the rump patch.
    tail = Tube([_point(1.04, -0.64), _point(0.98, -0.685), _point(0.90, -0.70)], [0.042, 0.038, 0.022],
                squash_axis=X_AXIS, squash=0.8, k=0.01).tag(PARTS["tail"])

    legs = []
    for leg, name in zip([_front_leg(1.0), _front_leg(-1.0), _hind_leg(1.0), _hind_leg(-1.0)],
                         ("frontLeft", "frontRight", "hindLeft", "hindRight")):
        leg.tag(PARTS[name])
        legs.append(leg)

    root = HalfSpace(Union([
        (body, 0.0), (neck, 0.09), (head, 0.06), *[(ear, 0.02) for ear in ears],
        *[(leg, 0.06) for leg in legs], (tail, 0.03),
    ]), axis=1)
    landmarks = dict(
        muzzle=head_point(0.40, -0.066),
        eyes=[head_point(0.10, -0.004, 0.066 * s) for s in (1.0, -1.0)],
        nose=head_point(0.39, -0.05),
        tailRoot=_point(1.04, -0.64),
        # The neck's axis (y, z) from its base to the poll.
        neckAxis=((0.98, 0.38), (1.53, 0.71)),
    )
    return root, landmarks


# -- regions, weights, paint ----------------------------------------------------------------
def regions(shape, positions, triangles):
    """Each vertex's part: the part of the nearest primitive, then cleaned by its neighbours'
    votes so that no stray vertex of one part sits inside another."""
    leaves = shape.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    parts = np.array([leaves[i].part for i in np.argmin(distances, axis=1)])
    neighbours = _neighbours(len(positions), triangles)
    for _ in range(3):
        votes = parts.copy()
        for v, around in enumerate(neighbours):
            if len(around) < 3:
                continue
            values, counts = np.unique(parts[around], return_counts=True)
            best = values[np.argmax(counts)]
            if best != parts[v] and counts.max() >= 0.6 * len(around):
                votes[v] = best
        parts = votes
    return parts


def _segment_t(points, a, b):
    """How far along a -> b each point lies (0..1, clamped)."""
    ab = np.asarray(b) - np.asarray(a)
    return np.clip(((points - a) @ ab) / max(ab @ ab, 1e-12), 0.0, 1.0)


def _chain(y, joints, names, band):
    """Weights down a leg chain by height: each joint blends its two bones over +-band."""
    out = {}
    count = len(names)
    # Joint heights from the top, e.g. [elbow, knee, fetlock] between [humerus, forearm, cannon, hoof].
    upper = np.ones_like(y)
    for j, height in enumerate(joints):
        below = _smoothstep(height + band, height - band, y)  # 0 above the joint, 1 below
        out[names[j]] = upper * (1.0 - below)
        upper = upper * below
    out[names[count - 1]] = upper
    return out


def skin(positions, parts, triangles, smoothing=4):
    """Four bones a vertex: each part along its chain, faded into the trunk, smoothed over the mesh."""
    count = len(positions)
    weights = np.zeros((count, len(BONES)))
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]

    def put(mask, name, value):
        weights[mask, BONE_INDEX[name]] += value[mask] if np.ndim(value) else value

    # The trunk: the chest forward, the pelvis behind, the root between.
    trunk = np.isin(parts, [PARTS["body"]])
    w_chest = _smoothstep(-0.02, 0.28, z)
    w_pelvis = _smoothstep(-0.12, -0.40, z)
    w_root = np.clip(1.0 - w_chest - w_pelvis, 0.0, 1.0)
    put(trunk, "chest", w_chest)
    put(trunk, "pelvis", w_pelvis)
    put(trunk, "root", w_root)

    # The neck from its base (on the chest) to the poll; the head whole.
    neck = parts == PARTS["neck"]
    (y0, z0), (y1, z1) = ((0.98, 0.38), (1.53, 0.71))
    t = _segment_t(positions[:, 1:], np.array([y0, z0]), np.array([y1, z1]))
    w_base = _smoothstep(0.18, 0.0, t)
    w_head = _smoothstep(0.82, 1.0, t)
    w_n1 = _smoothstep(0.25, 0.65, t) * (1.0 - w_head)
    w_n0 = np.clip(1.0 - w_base - w_head - w_n1, 0.0, 1.0)
    put(neck, "chest", w_base * 0.6)
    put(neck, "neck0", w_n0 + w_base * 0.4)
    put(neck, "neck1", w_n1)
    put(neck, "head", w_head)
    put(parts == PARTS["head"], "head", 1.0)
    put(parts == PARTS["earLeft"], "earL", 1.0)
    put(parts == PARTS["earRight"], "earR", 1.0)

    # The tail, rooted in the pelvis.
    tail = parts == PARTS["tail"]
    w_tail = _smoothstep(-0.63, -0.68, z)
    put(tail, "tail", w_tail)
    put(tail, "pelvis", 1.0 - w_tail)

    # The legs: down their chains, the top faded into the trunk across a band.
    for tag in ("L", "R"):
        fore = parts == PARTS["frontLeft" if tag == "L" else "frontRight"]
        chain = _chain(y, [0.74, 0.40, 0.095],
                       ["humerus" + tag, "forearm" + tag, "foreCannon" + tag, "foreHoof" + tag], 0.035)
        into = _smoothstep(0.80, 0.92, y)  # 1 = the trunk
        for name, value in chain.items():
            put(fore, name, value * (1.0 - into))
        put(fore, "chest", into)
        hind = parts == PARTS["hindLeft" if tag == "L" else "hindRight"]
        chain = _chain(y, [0.78, 0.48, 0.095],
                       ["femur" + tag, "tibia" + tag, "hindCannon" + tag, "hindHoof" + tag], 0.035)
        into = _smoothstep(0.84, 0.96, y)
        for name, value in chain.items():
            put(hind, name, value * (1.0 - into))
        put(hind, "pelvis", into)

    # The trunk over the tops of the legs follows them a little (the shoulder and the thigh).
    for tag, side in (("L", 1.0), ("R", -1.0)):
        near_fore = trunk & (x * side > 0.04) & (y < 0.92)
        reach = _smoothstep(0.92, 0.72, y) * _smoothstep(0.20, 0.36, z) * _smoothstep(0.60, 0.46, z)
        weights[near_fore, BONE_INDEX["humerus" + tag]] += 0.6 * reach[near_fore]
        near_hind = trunk & (x * side > 0.04) & (y < 0.96)
        reach = _smoothstep(0.96, 0.70, y) * _smoothstep(-0.26, -0.40, z) * _smoothstep(-0.74, -0.56, z)
        weights[near_hind, BONE_INDEX["femur" + tag]] += 0.6 * reach[near_hind]

    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
    # Smoothed over the mesh (each vertex half itself, half its neighbours), never across the
    # left/right legs (they do not touch) and never onto a bone no neighbour carries.
    neighbours = _neighbours(count, triangles)
    for _ in range(smoothing):
        mean = np.stack([weights[around].mean(axis=0) if len(around) else weights[v]
                         for v, around in enumerate(neighbours)])
        weights = 0.5 * weights + 0.5 * mean
    # The four strongest, quantised to bytes that sum to 255.
    order = np.argsort(-weights, axis=1)[:, :4]
    top = np.take_along_axis(weights, order, axis=1)
    top /= np.maximum(top.sum(axis=1, keepdims=True), 1e-9)
    quant = np.floor(top * 255.0).astype(np.int64)
    quant[:, 0] += 255 - quant.sum(axis=1)
    return order.astype(np.uint8), quant.astype(np.uint8)


def paint(shape, landmarks, positions, normals, parts):
    """COLOR_0 = (pale, dark, grey, sky seen)."""
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    legs = np.isin(parts, [PARTS["frontLeft"], PARTS["frontRight"], PARTS["hindLeft"], PARTS["hindRight"]])
    ears = np.isin(parts, [PARTS["earLeft"], PARTS["earRight"]])
    # Pale: the buff rump patch round the tail, the belly and the insides of the legs and ears.
    rump = _smoothstep(-0.50, -0.62, z) * _smoothstep(0.66, 0.78, y) * _smoothstep(0.16, 0.08, np.abs(x))
    belly = _smoothstep(0.70, 0.62, y) * (parts == PARTS["body"]) * _smoothstep(0.0, -0.6, normals[:, 1])
    inside = legs * _smoothstep(0.0, -0.8, normals[:, 0] * np.sign(x + 1e-9)) * _smoothstep(0.85, 0.55, y) * 0.6
    ear_in = ears * np.clip((positions - 0.0) @ np.array([0.0, 0.0, 1.0]) * 0.0 + _smoothstep(0.2, 0.9, normals[:, 2]),
                            0.0, 1.0) * 0.7
    pale = np.clip(np.maximum.reduce([rump, belly * 0.7, inside, ear_in]), 0.0, 1.0)
    # Dark: the hooves, the nose, the eyes, the tail's top and the ears' rims.
    hooves = legs * _smoothstep(0.075, 0.055, y)
    nose = _smoothstep(0.06, 0.025, np.linalg.norm(positions - landmarks["nose"], axis=1))
    eyes = np.maximum.reduce([_smoothstep(0.03, 0.016, np.linalg.norm(positions - e, axis=1))
                              for e in landmarks["eyes"]])
    tail_top = (parts == PARTS["tail"]) * _smoothstep(-0.2, 0.6, normals[:, 1] + normals[:, 2] * 0.0)
    ear_rim = ears * _smoothstep(0.10, 0.17, np.linalg.norm(positions - head_point(0.0, 0.03), axis=1)) * 0.6
    dark = np.clip(np.maximum.reduce([hooves, nose, eyes, tail_top * 0.8, ear_rim]), 0.0, 1.0)
    # Grey: the neck and head greyer than the body, and the legs below the knee and hock.
    neck_grey = np.isin(parts, [PARTS["neck"], PARTS["head"]]) * 0.75
    leg_grey = legs * _smoothstep(0.52, 0.36, y) * 0.8
    grey = np.clip(np.maximum(neck_grey, leg_grey), 0.0, 1.0)
    # Sky seen: rays traced through the field (the horse's occlusion), ground included.
    seen = occlusion(shape, positions, normals, rays=20, reach=0.7, ground=0.7)
    return np.stack([pale, dark, grey, seen], axis=1)


# -- the build ----------------------------------------------------------------------------
class Deer:
    def __init__(self, positions, normals, colors, triangles, parts, bones, weights, stats, landmarks):
        self.positions, self.normals, self.colors, self.triangles = positions, normals, colors, triangles
        self.parts, self.bones, self.weights, self.stats, self.landmarks = parts, bones, weights, stats, landmarks

    def measures(self):
        body = self.positions[self.parts == PARTS["body"]]
        withers = body[(body[:, 2] > 0.1) & (body[:, 2] < 0.4)]
        return dict(withersHeight=float(withers[:, 1].max()), length=float(np.ptp(self.positions[:, 2])),
                    height=float(self.positions[:, 1].max()))

    def skeleton(self):
        return [dict(name=name, parent=int(BONE_PARENTS[index]), head=[round(float(v), 4) for v in head])
                for index, (name, _parent, head) in enumerate(BONES)]

    def record(self):
        return dict(name=NAME, species=SPECIES, triangles=int(len(self.triangles)),
                    vertices=int(len(self.positions)), bones=len(BONES),
                    **{key: round(value, 4) for key, value in self.measures().items()})


def build(studio, voxel=VOXEL, target=TARGET_TRIANGLES):
    """Polygonise and decimate the left half, mirror it, then paint and skin the whole deer."""
    started = time.time()
    shape, landmarks = design()
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    positions, triangles = decimate(studio, dense, dense_triangles, target // 2)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    parts = regions(shape, positions, triangles)
    colors = paint(shape, landmarks, positions, normals, parts)
    bones, weights = skin(positions, parts, triangles)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_triangles=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=folds, total_s=round(time.time() - started, 1))
    point = lambda value: [round(float(v), 4) for v in value]  # noqa: E731
    marks = dict(muzzle=point(landmarks["muzzle"]), eyes=[point(p) for p in landmarks["eyes"]],
                 headForward=point(HEAD_FORWARD), headUp=point(HEAD_UP))
    deer = Deer(positions, normals, colors, triangles, parts, bones, weights, stats, marks)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s deer %s -> %d tris %d verts (%d folds); x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s %.1fs" % (
        TAG, "x".join(str(n) for n in stats["grid"]), stats["triangles"], stats["vertices"], folds,
        low[0], high[0], low[1], high[1], low[2], high[2],
        {key: round(value, 3) for key, value in deer.measures().items()}, stats["total_s"]), flush=True)
    return deer


def write(path, deer):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("deer", {
        "POSITION": (deer.positions, False),
        "NORMAL": (glb.quantize_unit(deer.normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(deer.colors, np.uint8), True),
        "_BONES": (deer.bones, True),
        "_WEIGHTS": (deer.weights, True),
    }, indices=deer.triangles)
    low, high = deer.positions.min(axis=0), deer.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=SCHEMA_VERSION, **deer.record(),
        skeleton=deer.skeleton(),
        color={"r": "pale (rump patch, belly, inner legs and ears)", "g": "dark (hooves, nose, eyes, tail top)",
               "b": "grey (neck, head, lower legs)", "a": "sky seen (ambient occlusion)"},
        skin={"_BONES": "four bone indices / 255", "_WEIGHTS": "their weights (sum 1)",
              "pose": "each bone rests aligned with the deer's axes; a pose turns it about its head (R = Ry Rz Rx)"},
        landmarks=deer.landmarks,
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


# -- poses and previews (never shipped) ----------------------------------------------------
def rotation(rx=0.0, ry=0.0, rz=0.0):
    """Ry . Rz . Rx: pitch about the bone's x first, then roll, then yaw (the runtime's order)."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, sz, 0], [-sz, cz, 0], [0, 0, 1]])
    return Ry @ Rz @ Rx


def pose_matrices(local, offset=(0.0, 0.0, 0.0)):
    count = len(BONES)
    world_r = np.zeros((count, 3, 3))
    world_t = np.zeros((count, 3))
    for index, (name, _parent, _head) in enumerate(BONES):
        L = rotation(*local.get(name, (0.0, 0.0, 0.0)))
        parent = BONE_PARENTS[index]
        if parent < 0:
            world_r[index] = L
            world_t[index] = BONE_HEADS[index] + np.asarray(offset)
        else:
            world_r[index] = world_r[parent] @ L
            world_t[index] = world_t[parent] + world_r[parent] @ (BONE_HEADS[index] - BONE_HEADS[parent])
    matrices = np.zeros((count, 3, 4))
    matrices[:, :, :3] = world_r
    matrices[:, :, 3] = world_t - np.einsum("bij,bj->bi", world_r, BONE_HEADS)
    return matrices


def skin_vertices(deer, matrices):
    w = deer.weights.astype(np.float64) / 255.0
    out_p = np.zeros_like(deer.positions)
    out_n = np.zeros_like(deer.normals)
    for k in range(4):
        M = matrices[deer.bones[:, k].astype(np.int64)]
        out_p += w[:, k:k + 1] * (np.einsum("nij,nj->ni", M[:, :, :3], deer.positions) + M[:, :, 3])
        out_n += w[:, k:k + 1] * np.einsum("nij,nj->ni", M[:, :, :3], deer.normals)
    return out_p, out_n / np.maximum(np.linalg.norm(out_n, axis=1), 1e-9)[:, None]


POSES = {
    "alert": {},
    "graze": dict(root=(0.06, 0, 0), neck0=(2.0, 0, 0), neck1=(0.0, 0, 0), head=(-1.5, 0, 0), earL=(0.25, 0, -0.2),
                  earR=(0.25, 0, 0.2), humerusL=(-0.14, 0, 0), humerusR=(-0.01, 0, 0)),
    "walk": dict(neck0=(0.05, 0, 0), humerusL=(-0.32, 0, 0), forearmL=(-0.3, 0, 0),
                 foreCannonL=(1.0, 0, 0), foreHoofL=(0.45, 0, 0), humerusR=(0.2, 0, 0),
                 femurL=(0.25, 0, 0), femurR=(-0.3, 0, 0), tibiaR=(0.4, 0, 0), hindCannonR=(-0.7, 0, 0),
                 hindHoofR=(0.5, 0, 0), tail=(0.15, 0, 0)),
    "look": dict(neck0=(-0.06, 0.3, 0), neck1=(0.0, 0.35, 0), head=(0.08, 0, 0), earL=(0, 0, 0.3)),
}

COAT = np.array([0.30, 0.13, 0.05])
PALE = np.array([0.72, 0.60, 0.42])
GREY = np.array([0.22, 0.17, 0.13])
DARK = np.array([0.03, 0.025, 0.02])


def _albedo(colors):
    pale, dark, grey, seen = (colors[:, i:i + 1] for i in range(4))
    base = COAT * (1 - grey) + GREY * grey
    base = base * (1 - pale) + PALE * pale
    base = base * (1 - dark) + DARK * dark
    return np.clip(base * (0.45 + 0.55 * seen), 0.0, 1.0)


def previews(deer, directory):
    import bpy
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    studio.setup_preview(sun_direction=(-0.46, 0.36, 0.61), sun_strength=4.0, sky=(0.5, 0.62, 0.8), sky_strength=0.8)
    colours = _albedo(deer.colors)
    ground = studio.mesh_object("ground", np.array([[-9, 0, -9], [9, 0, -9], [9, 0, 9], [-9, 0, 9]], dtype=float),
                                np.array([[0, 2, 1], [0, 3, 2]]))
    ground.data.materials.append(studio.material("grass", vertex_color=False, base=(0.09, 0.2, 0.05)))
    material = studio.material("deer", roughness=0.85)
    objects = []
    for index, (name, local) in enumerate(POSES.items()):
        p, n = skin_vertices(deer, pose_matrices(local))
        p = p + np.array([(index - 1.5) * 0.8, 0.0, -(index - 1.5) * 2.2])
        obj = studio.mesh_object("deer_" + name, p, deer.triangles, colors=colours)
        obj.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(n)])
        obj.data.materials.append(material)
        objects.append(obj)
    studio.render(directory / "deer-poses.png", eye=(7.5, 2.6, 2.0), target=(0.0, 0.7, 0.0), lens=40,
                  size=(1000, 560), samples=16)
    studio.render(directory / "deer-side.png", eye=(9.0, 1.0, 0.0), target=(0.0, 0.75, 0.0), lens=55,
                  size=(1000, 560), samples=16)
    # A small far view to judge the silhouette near game size (upscaled x6 for the eye).
    studio.render(directory / "deer-game.png", eye=(55.0, 26.0, 30.0), target=(0.0, 0.7, 0.0), lens=50,
                  size=(240, 135), samples=16)
    big = bpy.data.images.load(str(directory / "deer-game.png"))
    w, h = big.size
    pixels = np.array(big.pixels[:], dtype=np.float32).reshape(h, w, 4)
    up = np.repeat(np.repeat(pixels, 6, axis=0), 6, axis=1)
    out = bpy.data.images.new("deer-game-x6", w * 6, h * 6, alpha=True)
    out.pixels.foreach_set(up.reshape(-1))
    out.filepath_raw = str(directory / "deer-game-x6.png")
    out.file_format = "PNG"
    out.save()
    studio.dispose()


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {}
    for key, value in zip(arguments[::2], arguments[1::2]):
        options[key.lstrip("-")] = value
    out = Path(options.get("out", "red-deer.glb"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Odyssey - Deer Atelier"
    studio_module.PREFIX = "SODY_"
    studio = studio_module.Studio()
    try:
        deer = build(studio)
        out.parent.mkdir(parents=True, exist_ok=True)
        size = write(out, deer)
        print("%s wrote %s (%d bytes) %s" % (TAG, out, size, json.dumps(deer.record())), flush=True)
    finally:
        studio.dispose()
    if options.get("preview"):
        previews(deer, Path(options["preview"]))
        print("%s previews in %s" % (TAG, options["preview"]), flush=True)


if __name__ == "__main__":
    main()
