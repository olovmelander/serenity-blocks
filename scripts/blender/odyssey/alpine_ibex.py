"""Odyssey's island ibex: an Alpine ibex, modelled and rigged procedurally in headless Blender.

    blender -b --factory-startup --python scripts/blender/odyssey/alpine_ibex.py -- \
        --out src/rendering/odyssey/assets/chapter-04/ibex/alpine-ibex.glb [--preview <dir>]

A few ibex live on the rock and scree at the massif's foot, seen from the rail 150 to 250 metres off
and drawn at three times life (like the rest of the act's life), so a buck is some fifteen to thirty
pixels tall at the shoulder on a 1440p screen. What has to read: a stocky, deep-chested body on short,
sturdy legs, a short thick neck, a short broad head, and on the buck the great horns sweeping back in
an arc; the summer coat a grey-brown, darker down the fronts of the legs and along the back, a pale
belly.

How it is made: the red deer's method and tools (`red_deer.py`, which reuses the Grainfields horse's
meshing): a signed distance field of ellipsoids, round cones and tubes, polygonised, decimated,
mirrored, painted, and skinned to the deer's own twenty-seven bones (the same names and chains, so
the herd code that poses the deer poses the ibex too).

- **Horns.** One model serves the buck, the nannies and the kid. Every horn vertex carries `_HORN`
  = (its horn's root, 1): the game scales each horn about its root per animal (a buck's full sweep, a
  nanny's short curved horn, a kid's buds). Skinned to the head.
- **Paint.** COLOR_0 = (pale, dark, brown, sky seen): the pale belly, the insides of the legs and the
  ears, the chin; the hooves, the nose, the eyes and the tail's tip dark; the darker brown down the
  fronts of the legs, along the back and on the chest; ambient occlusion traced through the field.
- **Previews** (never shipped): `--preview <dir>` renders the poses and close-ups, `--motion <json>
  --motion-out <dir>` frames of motion exported from the game's own solver.

Frame: metres at a nanny's size (about 0.8 m at the withers), +z forward, +y up, the hooves on y = 0,
the body centred on x = 0; the ibex faces +z, so its left side is +x. No external asset is used.
"""

import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
for path in (ROOT, HERE):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

import numpy as np  # noqa: E402

from grainfields.horse_sdf import (  # noqa: E402
    X_AXIS, Z_AXIS, Ellipsoid, HalfSpace, RoundCone, Tube, Union,
    _grid, _neighbours, _point, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)
from grainfields.horse import occlusion  # noqa: E402
import red_deer as kit  # noqa: E402

TAG = "[odyssey-ibex]"
NAME = "alpine-ibex"
SPECIES = "Alpine ibex (Capra ibex), at a nanny's size; horns scaled per animal"
GENERATOR = "Serenity Blocks - Odyssey Alpine ibex (scripts/blender/odyssey/alpine_ibex.py)"
SCHEMA_VERSION = 1
VOXEL = 0.0085
TARGET_TRIANGLES = 2200
LEG_THICKEN = 1.22

PARTS = {"body": 0, "neck": 1, "head": 2, "frontLeft": 3, "frontRight": 4, "hindLeft": 5, "hindRight": 6,
         "tail": 7, "earLeft": 8, "earRight": 9, "hornLeft": 10, "hornRight": 11}

FRONT_Z = 0.27
HIND_Z = -0.40
FORE_X = 0.085
HIND_X = 0.09

# The head: from the poll, s forward along the face (60 degrees below the horizontal: a goat carries
# its face steep), t toward the forehead, x across. Short and broad, 0.22 m from the poll to the nose.
POLL = _point(0.93, 0.46)
HEAD_PITCH = math.radians(60.0)
HEAD_FORWARD = np.array([0.0, -math.sin(HEAD_PITCH), math.cos(HEAD_PITCH)])
HEAD_UP = np.array([0.0, math.cos(HEAD_PITCH), math.sin(HEAD_PITCH)])


def head_point(s, t, x=0.0):
    return POLL + s * HEAD_FORWARD + t * HEAD_UP + np.array([x, 0.0, 0.0])


def _ear_base(side):
    return head_point(-0.005, 0.02, 0.042 * side)


def _ear_direction(side):
    # Small ears held out to the sides and a little back.
    return _unit(np.array([0.88 * side, 0.30, -0.36]))


def horn_root(side):
    return head_point(0.03, 0.045, 0.022 * side)


# The buck's horn as offsets from its root: up off the forehead, then sweeping back in a wide arc
# over the neck, a little outward, ~0.87 m along the curve; thick at the root, ridged to a point.
HORN_PATH = [(0.0, 0.0, 0.0), (0.010, 0.13, -0.03), (0.025, 0.26, -0.12), (0.045, 0.34, -0.27),
             (0.060, 0.33, -0.43), (0.070, 0.26, -0.56), (0.075, 0.17, -0.63)]
HORN_RADII = [0.042, 0.038, 0.032, 0.026, 0.019, 0.012, 0.006]


def _bone_table():
    """(name, parent, head) in an order where every parent comes before its children (the deer's)."""
    bones = [
        ("root", None, (0.0, 0.56, -0.05)),
        ("pelvis", "root", (0.0, 0.62, -0.26)),
        ("chest", "root", (0.0, 0.62, 0.14)),
        ("neck0", "chest", (0.0, 0.66, 0.30)),
        ("neck1", "neck0", (0.0, 0.75, 0.37)),
        ("neck2", "neck1", (0.0, 0.84, 0.42)),
        ("head", "neck2", tuple(float(v) for v in POLL)),
        ("jaw", "head", tuple(float(v) for v in head_point(0.06, -0.07))),
        ("earL", "head", tuple(float(v) for v in _ear_base(1.0))),
        ("earR", "head", tuple(float(v) for v in _ear_base(-1.0))),
        ("tail", "pelvis", (0.0, 0.69, -0.47)),
    ]
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x = FORE_X * side
        bones += [
            ("humerus" + tag, "chest", (x, 0.62, 0.23)),
            ("forearm" + tag, "humerus" + tag, (x, 0.44, 0.29)),
            ("foreCannon" + tag, "forearm" + tag, (x, 0.24, FRONT_Z)),
            ("foreHoof" + tag, "foreCannon" + tag, (x, 0.065, FRONT_Z)),
        ]
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x = HIND_X * side
        bones += [
            ("femur" + tag, "pelvis", (x, 0.62, -0.30)),
            ("tibia" + tag, "femur" + tag, (x * 1.1, 0.48, -0.24)),
            ("hindCannon" + tag, "tibia" + tag, (x, 0.29, HIND_Z)),
            ("hindHoof" + tag, "hindCannon" + tag, (x, 0.065, HIND_Z)),
        ]
    return bones


BONES = _bone_table()
BONE_INDEX = {name: index for index, (name, _parent, _head) in enumerate(BONES)}
BONE_HEADS = np.array([head for _name, _parent, head in BONES], dtype=np.float64)
BONE_PARENTS = np.array([-1 if parent is None else BONE_INDEX[parent] for _name, parent, _head in BONES])
assert [b[0] for b in BONES] == [b[0] for b in kit.BONES], "the ibex must carry the deer's skeleton"


def joint(name):
    return BONE_HEADS[BONE_INDEX[name]]


# -- the legs: short, sturdy, a goat's -------------------------------------------------------
def _front_leg(side):
    x = FORE_X * side
    z = FRONT_Z
    k = LEG_THICKEN
    return Union([
        Tube([_point(0.52, z + 0.03, x), _point(0.38, z + 0.012, x), _point(0.25, z, x)],
             [0.058 * k, 0.042 * k, 0.03 * k], squash_axis=X_AXIS, squash=0.86),
        Ellipsoid(_point(0.47, z - 0.04, x * 1.02), (0.034, 0.042, 0.042)),
        Ellipsoid(_point(0.24, z + 0.004, x), (0.03 * k, 0.034 * k, 0.034 * k)),
        Tube([_point(0.235, z - 0.002, x), _point(0.08, z - 0.002, x)], [0.021 * k, 0.019 * k],
             squash_axis=X_AXIS, squash=0.86),
        Ellipsoid(_point(0.065, z - 0.002, x), (0.023 * k, 0.025 * k, 0.026 * k)),
        RoundCone(_point(0.05, z + 0.004, x), _point(0.012, z + 0.03, x), 0.021 * k, 0.026 * k),
    ], k=0.02)


def _hind_leg(side):
    x = HIND_X * side
    z = HIND_Z
    k = LEG_THICKEN
    return Union([
        Tube([_point(0.56, z + 0.17, x * 1.15), _point(0.44, z + 0.07, x), _point(0.30, z + 0.004, x)],
             [0.08, 0.052 * k, 0.032 * k], squash_axis=X_AXIS, squash=0.8),
        Ellipsoid(_point(0.46, z + 0.06, x), (0.042, 0.06, 0.07), along=(0.0, 0.62, 0.78)),
        Ellipsoid(_point(0.29, z, x), (0.029 * k, 0.037 * k, 0.04 * k)),
        Ellipsoid(_point(0.31, z - 0.038, x), (0.019 * k, 0.028 * k, 0.02 * k)),
        Tube([_point(0.28, z - 0.002, x), _point(0.08, z + 0.002, x)], [0.022 * k, 0.019 * k],
             squash_axis=X_AXIS, squash=0.86),
        Ellipsoid(_point(0.065, z + 0.002, x), (0.023 * k, 0.025 * k, 0.026 * k)),
        RoundCone(_point(0.05, z + 0.006, x), _point(0.012, z + 0.03, x), 0.021 * k, 0.026 * k),
    ], k=0.02)


def _horn(side):
    root = horn_root(side)
    points = [root + np.array([dx * side, dy, dz]) for dx, dy, dz in HORN_PATH]
    return Tube(points, HORN_RADII, squash_axis=X_AXIS, squash=0.72, k=0.01)


# -- the ibex -------------------------------------------------------------------------------
def design():
    body = Union([
        # A deep, round barrel low between short legs; the chest deep behind the elbows.
        Ellipsoid(_point(0.55, -0.06), (0.15, 0.165, 0.34)),
        Ellipsoid(_point(0.55, 0.14), (0.15, 0.175, 0.19)),
        (Ellipsoid(_point(0.44, 0.20), (0.095, 0.10, 0.10)), 0.06),
        # The withers standing a little over the back (a goat's hump of shoulder), the shoulders.
        (Ellipsoid(_point(0.70, 0.12), (0.085, 0.085, 0.18)), 0.08),
        *[(Ellipsoid(_point(0.58, 0.20, 0.075 * s), (0.07, 0.12, 0.09), along=(0.0, 0.85, 0.52)), 0.06)
          for s in (1.0, -1.0)],
        Ellipsoid(_point(0.66, -0.12), (0.125, 0.07, 0.22)),
        # Quarters, a short croup falling to the tail, the thighs, the buttocks.
        Ellipsoid(_point(0.58, -0.30), (0.15, 0.16, 0.17)),
        (Ellipsoid(_point(0.67, -0.29), (0.10, 0.065, 0.15), along=(0.0, 0.2, 0.98)), 0.08),
        *[(Ellipsoid(_point(0.52, -0.33, 0.09 * s), (0.07, 0.13, 0.10)), 0.06) for s in (1.0, -1.0)],
        (Ellipsoid(_point(0.58, -0.41), (0.105, 0.11, 0.065)), 0.06),
    ], k=0.09).tag(PARTS["body"])

    # A short, thick neck carried up and forward.
    neck = Tube([_point(0.64, 0.24), _point(0.71, 0.31), _point(0.79, 0.37), _point(0.87, 0.42),
                 _point(0.92, 0.45)],
                [0.13, 0.10, 0.08, 0.068, 0.062], squash_axis=X_AXIS, squash=[0.72, 0.76, 0.8, 0.82, 0.84],
                k=0.03).tag(PARTS["neck"])

    head = Union([
        Ellipsoid(head_point(0.035, -0.02), (0.056, 0.058, 0.065), along=HEAD_FORWARD),     # cranium
        Ellipsoid(head_point(0.07, 0.006), (0.05, 0.026, 0.055), along=HEAD_FORWARD),       # forehead
        Ellipsoid(head_point(0.06, -0.065), (0.042, 0.05, 0.06), along=HEAD_FORWARD),       # cheek
        RoundCone(head_point(0.07, -0.03), head_point(0.19, -0.04), 0.047, 0.026,
                  (X_AXIS, 0.82)),                                                          # face
        Ellipsoid(head_point(0.20, -0.044), (0.022, 0.025, 0.024), along=HEAD_FORWARD),     # nose
        Ellipsoid(head_point(0.185, -0.062), (0.016, 0.014, 0.02), along=HEAD_FORWARD),     # chin
        *[Ellipsoid(head_point(0.07, -0.004, 0.047 * s), (0.016, 0.017, 0.02), along=HEAD_FORWARD)
          for s in (1.0, -1.0)],                                                            # eyes
    ], k=0.028).tag(PARTS["head"])

    ears = []
    for side, part in ((1.0, PARTS["earLeft"]), (-1.0, PARTS["earRight"])):
        base = _ear_base(side)
        direction = _ear_direction(side)
        across = _unit(np.array(Z_AXIS) - direction * direction[2])
        ear = Tube([base, base + 0.035 * direction, base + 0.07 * direction, base + 0.10 * direction],
                   [0.018, 0.028, 0.022, 0.008], squash_axis=across, squash=0.45, k=0.01).tag(part)
        ears.append(ear)

    horns = [_horn(1.0).tag(PARTS["hornLeft"]), _horn(-1.0).tag(PARTS["hornRight"])]

    # The short tail, turned up a little.
    tail = Tube([_point(0.70, -0.46), _point(0.715, -0.51), _point(0.70, -0.55)], [0.03, 0.028, 0.016],
                squash_axis=Z_AXIS, squash=0.7, k=0.01).tag(PARTS["tail"])

    legs = []
    for leg, name in zip([_front_leg(1.0), _front_leg(-1.0), _hind_leg(1.0), _hind_leg(-1.0)],
                         ("frontLeft", "frontRight", "hindLeft", "hindRight")):
        leg.tag(PARTS[name])
        legs.append(leg)

    root = HalfSpace(Union([
        (body, 0.0), (neck, 0.08), (head, 0.05), *[(ear, 0.015) for ear in ears],
        *[(horn, 0.012) for horn in horns], *[(leg, 0.05) for leg in legs], (tail, 0.025),
    ]), axis=1)
    landmarks = dict(
        muzzle=head_point(0.22, -0.044),
        eyes=[head_point(0.075, -0.004, 0.058 * s) for s in (1.0, -1.0)],
        nose=head_point(0.215, -0.036),
        chin=head_point(0.19, -0.07),
        tailRoot=_point(0.70, -0.46),
        neckAxis=((0.64, 0.24), (0.92, 0.45)),
        hornRoots=[horn_root(1.0), horn_root(-1.0)],
    )
    return root, landmarks


# -- weights and paint ----------------------------------------------------------------------
def skin(positions, parts, triangles, smoothing=4):
    """Four bones a vertex (the deer's scheme at the ibex's proportions); the horns ride the head."""
    count = len(positions)
    weights = np.zeros((count, len(BONES)))
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]

    def put(mask, name, value):
        weights[mask, BONE_INDEX[name]] += value[mask] if np.ndim(value) else value

    trunk = np.isin(parts, [PARTS["body"]])
    w_chest = _smoothstep(-0.02, 0.22, z)
    w_pelvis = _smoothstep(-0.10, -0.30, z)
    w_root = np.clip(1.0 - w_chest - w_pelvis, 0.0, 1.0)
    put(trunk, "chest", w_chest)
    put(trunk, "pelvis", w_pelvis)
    put(trunk, "root", w_root)

    neck = parts == PARTS["neck"]
    (y0, z0), (y1, z1) = ((0.64, 0.24), (0.92, 0.45))
    t = kit._segment_t(positions[:, 1:], np.array([y0, z0]), np.array([y1, z1]))
    knots = [(kit._segment_t(np.array([joint(n)[1:]]), np.array([y0, z0]), np.array([y1, z1]))[0]) for n in
             ("neck1", "neck2", "head")]
    chain = kit._chain(-t, [-knots[0], -knots[1], -knots[2]], ["neck0", "neck1", "neck2", "head"], 0.08)
    w_base = _smoothstep(0.26, 0.0, t)
    for name, value in chain.items():
        put(neck, name, value * (1.0 - 0.6 * w_base))
    put(neck, "chest", w_base * 0.6)
    head_part = parts == PARTS["head"]
    rel = positions - POLL
    s_h = rel @ HEAD_FORWARD
    t_h = rel @ HEAD_UP
    w_jaw = _smoothstep(-0.05, -0.068, t_h) * _smoothstep(0.06, 0.12, s_h)
    put(head_part, "head", 1.0 - w_jaw)
    put(head_part, "jaw", w_jaw)
    put(parts == PARTS["earLeft"], "earL", 1.0)
    put(parts == PARTS["earRight"], "earR", 1.0)
    put(np.isin(parts, [PARTS["hornLeft"], PARTS["hornRight"]]), "head", 1.0)

    tail = parts == PARTS["tail"]
    w_tail = _smoothstep(-0.45, -0.49, z)
    put(tail, "tail", w_tail)
    put(tail, "pelvis", 1.0 - w_tail)

    for tag in ("L", "R"):
        fore = parts == PARTS["frontLeft" if tag == "L" else "frontRight"]
        chain = kit._chain(y, [0.44, 0.24, 0.065],
                           ["humerus" + tag, "forearm" + tag, "foreCannon" + tag, "foreHoof" + tag], 0.03)
        into = _smoothstep(0.52, 0.62, y)
        for name, value in chain.items():
            put(fore, name, value * (1.0 - into))
        put(fore, "chest", into)
        hind = parts == PARTS["hindLeft" if tag == "L" else "hindRight"]
        chain = kit._chain(y, [0.48, 0.29, 0.065],
                           ["femur" + tag, "tibia" + tag, "hindCannon" + tag, "hindHoof" + tag], 0.03)
        into = _smoothstep(0.55, 0.64, y)
        for name, value in chain.items():
            put(hind, name, value * (1.0 - into))
        put(hind, "pelvis", into)

    for tag, side in (("L", 1.0), ("R", -1.0)):
        near_fore = trunk & (x * side > 0.035) & (y < 0.62)
        reach = _smoothstep(0.62, 0.46, y) * _smoothstep(0.12, 0.24, z) * _smoothstep(0.42, 0.32, z)
        weights[near_fore, BONE_INDEX["humerus" + tag]] += 0.6 * reach[near_fore]
        near_hind = trunk & (x * side > 0.035) & (y < 0.64)
        reach = _smoothstep(0.64, 0.46, y) * _smoothstep(-0.20, -0.30, z) * _smoothstep(-0.52, -0.40, z)
        weights[near_hind, BONE_INDEX["femur" + tag]] += 0.6 * reach[near_hind]

    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
    neighbours = _neighbours(count, triangles)
    horn = np.isin(parts, [PARTS["hornLeft"], PARTS["hornRight"]])
    for _ in range(smoothing):
        mean = np.stack([weights[around].mean(axis=0) if len(around) else weights[v]
                         for v, around in enumerate(neighbours)])
        weights = 0.5 * weights + 0.5 * mean
        # (A horn is rigid on the head: no smoothing pulls it toward the neck.)
        weights[horn] = 0.0
        weights[horn, BONE_INDEX["head"]] = 1.0
    order = np.argsort(-weights, axis=1)[:, :4]
    top = np.take_along_axis(weights, order, axis=1)
    top /= np.maximum(top.sum(axis=1, keepdims=True), 1e-9)
    quant = np.floor(top * 255.0).astype(np.int64)
    quant[:, 0] += 255 - quant.sum(axis=1)
    return order.astype(np.uint8), quant.astype(np.uint8)


def horn_attribute(positions, parts):
    """_HORN = (root x, y, z, 1) on a horn's vertices, (0, 0, 0, 0) elsewhere."""
    out = np.zeros((len(positions), 4), dtype=np.float32)
    for side, part in ((1.0, PARTS["hornLeft"]), (-1.0, PARTS["hornRight"])):
        mask = parts == part
        out[mask, :3] = horn_root(side)
        out[mask, 3] = 1.0
    return out


def paint(shape, landmarks, positions, normals, parts):
    """COLOR_0 = (pale, dark, brown, sky seen)."""
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    legs = np.isin(parts, [PARTS["frontLeft"], PARTS["frontRight"], PARTS["hindLeft"], PARTS["hindRight"]])
    fore = np.isin(parts, [PARTS["frontLeft"], PARTS["frontRight"]])
    ears = np.isin(parts, [PARTS["earLeft"], PARTS["earRight"]])
    horns = np.isin(parts, [PARTS["hornLeft"], PARTS["hornRight"]])
    body = parts == PARTS["body"]
    tail = parts == PARTS["tail"]
    # Pale: the belly and the insides of the legs, the insides of the ears, the chin and lips, a
    # pale patch under the tail.
    belly = _smoothstep(0.48, 0.40, y) * body * _smoothstep(0.1, -0.6, normals[:, 1])
    inside = legs * _smoothstep(0.0, -0.8, normals[:, 0] * np.sign(x + 1e-9)) * _smoothstep(0.55, 0.35, y) * 0.7
    ear_in = ears * _smoothstep(0.2, 0.9, normals[:, 2]) * 0.7
    chin = _smoothstep(0.045, 0.02, np.linalg.norm(positions - landmarks["chin"], axis=1)) * 0.5
    under_tail = body * _smoothstep(-0.2, -0.7, normals[:, 2]) * _smoothstep(-0.38, -0.46, z) \
        * _smoothstep(0.52, 0.60, y) * _smoothstep(0.70, 0.64, y) * _smoothstep(0.08, 0.04, np.abs(x)) * 0.8
    pale = np.clip(np.maximum.reduce([belly * 0.9, inside, ear_in, chin, under_tail]), 0.0, 1.0)
    # Dark: the hooves, the nose, the eyes, the tail's tip; the horns are coloured apart (see _HORN).
    hooves = legs * _smoothstep(0.05, 0.035, y)
    nose = _smoothstep(0.04, 0.018, np.linalg.norm(positions - landmarks["nose"], axis=1))
    eyes = np.maximum.reduce([_smoothstep(0.028, 0.016, np.linalg.norm(positions - e, axis=1))
                              for e in landmarks["eyes"]])
    tail_tip = tail * _smoothstep(-0.50, -0.545, z) * 0.85
    dark = np.clip(np.maximum.reduce([hooves, nose, eyes, tail_tip]), 0.0, 1.0)
    dark[horns] = 0.0
    # Brown (darker): down the fronts of the legs, the lower legs, along the back from the withers
    # to the tail, the chest's front and the throat.
    leg_front = legs * _smoothstep(-0.1, 0.6, normals[:, 2] * np.where(fore, 1.0, 0.6)) * _smoothstep(0.62, 0.45, y)
    shins = legs * _smoothstep(0.30, 0.18, y) * 0.7
    dorsal = (np.isin(parts, [PARTS["body"], PARTS["neck"]]) * _smoothstep(0.5, 0.9, normals[:, 1])
              * _smoothstep(0.66, 0.74, y) * _smoothstep(0.07, 0.03, np.abs(x)) * 0.8)
    chest = (np.isin(parts, [PARTS["body"], PARTS["neck"]]) * _smoothstep(0.3, 0.85, normals[:, 2])
             * _smoothstep(0.10, 0.22, z) * _smoothstep(0.70, 0.50, y) * 0.7)
    brown = np.clip(np.maximum.reduce([leg_front, shins, dorsal, chest]), 0.0, 1.0)
    brown[horns] = 0.0
    seen = occlusion(shape, positions, normals, rays=20, reach=0.6, ground=0.6)
    return np.stack([pale, dark, brown, seen], axis=1)


# -- the build ------------------------------------------------------------------------------
class Ibex:
    def __init__(self, positions, normals, colors, horn, triangles, parts, bones, weights, stats, landmarks):
        self.positions, self.normals, self.colors, self.horn = positions, normals, colors, horn
        self.triangles, self.parts, self.bones, self.weights = triangles, parts, bones, weights
        self.stats, self.landmarks = stats, landmarks

    def measures(self):
        body = self.positions[self.parts == PARTS["body"]]
        withers = body[(body[:, 2] > 0.0) & (body[:, 2] < 0.3)]
        horn = self.positions[self.horn[:, 3] > 0.5]
        return dict(withersHeight=float(withers[:, 1].max()), length=float(np.ptp(body[:, 2])),
                    height=float(self.positions[:, 1].max()), hornTop=float(horn[:, 1].max()))

    def skeleton(self):
        return [dict(name=name, parent=int(BONE_PARENTS[index]), head=[round(float(v), 4) for v in head])
                for index, (name, _parent, head) in enumerate(BONES)]

    def record(self):
        return dict(name=NAME, species=SPECIES, triangles=int(len(self.triangles)),
                    vertices=int(len(self.positions)), bones=len(BONES),
                    **{key: round(value, 4) for key, value in self.measures().items()})


def build(studio, voxel=VOXEL, target=TARGET_TRIANGLES):
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
    parts = kit.regions(shape, positions, triangles)
    colors = paint(shape, landmarks, positions, normals, parts)
    horn = horn_attribute(positions, parts)
    bones, weights = skin(positions, parts, triangles)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_triangles=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=folds, total_s=round(time.time() - started, 1))
    point = lambda value: [round(float(v), 4) for v in value]  # noqa: E731
    marks = dict(muzzle=point(landmarks["muzzle"]), eyes=[point(p) for p in landmarks["eyes"]],
                 headForward=point(HEAD_FORWARD), headUp=point(HEAD_UP),
                 hornRoots=[point(p) for p in landmarks["hornRoots"]])
    ibex = Ibex(positions, normals, colors, horn, triangles, parts, bones, weights, stats, marks)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s ibex %s -> %d tris %d verts (%d folds); x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s %.1fs" % (
        TAG, "x".join(str(n) for n in stats["grid"]), stats["triangles"], stats["vertices"], folds,
        low[0], high[0], low[1], high[1], low[2], high[2],
        {key: round(value, 3) for key, value in ibex.measures().items()}, stats["total_s"]), flush=True)
    return ibex


def write(path, ibex):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("ibex", {
        "POSITION": (ibex.positions, False),
        "NORMAL": (glb.quantize_unit(ibex.normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(ibex.colors, np.uint8), True),
        "_BONES": (ibex.bones, True),
        "_WEIGHTS": (ibex.weights, True),
        "_HORN": (ibex.horn.astype(np.float32), False),
    }, indices=ibex.triangles)
    low, high = ibex.positions.min(axis=0), ibex.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=SCHEMA_VERSION, **ibex.record(),
        skeleton=ibex.skeleton(),
        color={"r": "pale (belly, inner legs and ears, chin)", "g": "dark (hooves, nose, eyes, tail tip)",
               "b": "brown (fronts of the legs, back, chest)", "a": "sky seen (ambient occlusion)"},
        horn={"_HORN": "a horn vertex's root (x, y, z) and 1; 0 elsewhere. The game scales each horn about its root"},
        skin={"_BONES": "four bone indices / 255", "_WEIGHTS": "their weights (sum 1)",
              "pose": "each bone rests aligned with the ibex's axes; a pose turns it about its head (R = Ry Rz Rx)"},
        landmarks=ibex.landmarks,
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


# -- poses and previews (never shipped) ----------------------------------------------------
def pose_matrices(local, offset=(0.0, 0.0, 0.0)):
    count = len(BONES)
    world_r = np.zeros((count, 3, 3))
    world_t = np.zeros((count, 3))
    for index, (name, _parent, _head) in enumerate(BONES):
        L = kit.rotation(*local.get(name, (0.0, 0.0, 0.0)))
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


def with_horns(ibex, scale):
    """The model's positions with each horn scaled about its root (as the game does)."""
    p = ibex.positions.copy()
    mask = ibex.horn[:, 3] > 0.5
    roots = ibex.horn[mask, :3]
    p[mask] = roots + (p[mask] - roots) * scale
    return p


def skin_vertices(ibex, matrices, positions=None):
    positions = ibex.positions if positions is None else positions
    w = ibex.weights.astype(np.float64) / 255.0
    out_p = np.zeros_like(positions)
    out_n = np.zeros_like(ibex.normals)
    for k in range(4):
        M = matrices[ibex.bones[:, k].astype(np.int64)]
        out_p += w[:, k:k + 1] * (np.einsum("nij,nj->ni", M[:, :, :3], positions) + M[:, :, 3])
        out_n += w[:, k:k + 1] * np.einsum("nij,nj->ni", M[:, :, :3], ibex.normals)
    return out_p, out_n / np.maximum(np.linalg.norm(out_n, axis=1), 1e-9)[:, None]


POSES = {
    "alert": {},
    "graze": dict(root=(0.1, 0, 0), neck0=(1.5, 0, 0), neck1=(0.45, 0, 0), neck2=(0.35, 0, 0), head=(-1.9, 0, 0),
                  jaw=(0.06, 0, 0)),
    "look": dict(neck0=(-0.06, 0.18, 0), neck1=(0.0, 0.28, 0), neck2=(-0.05, 0.28, 0), head=(0.08, 0.18, 0),
                 earL=(0, 0.5, 0.1), earR=(0, 0.4, -0.1)),
    "leap": dict(root=(-0.25, 0, 0), neck0=(-0.15, 0, 0), humerusL=(-0.9, 0, 0), forearmL=(0, 0, 0),
                 foreCannonL=(1.9, 0, 0), humerusR=(-0.8, 0, 0), foreCannonR=(1.8, 0, 0),
                 femurL=(0.8, 0, 0), hindCannonL=(-0.4, 0, 0), femurR=(0.9, 0, 0), hindCannonR=(-0.3, 0, 0)),
}

COAT = np.array([0.36, 0.28, 0.19])
PALE = np.array([0.82, 0.76, 0.64])
BROWN = np.array([0.16, 0.11, 0.07])
DARK = np.array([0.03, 0.025, 0.02])
HORN = np.array([0.20, 0.17, 0.13])


def _albedo(ibex):
    pale, dark, brown, seen = (ibex.colors[:, i:i + 1] for i in range(4))
    base = COAT * (1 - brown) + BROWN * brown
    base = base * (1 - pale) + PALE * pale
    base = base * (1 - dark) + DARK * dark
    horn = ibex.horn[:, 3:4]
    base = base * (1 - horn) + HORN * horn
    return np.clip(base * (0.45 + 0.55 * seen), 0.0, 1.0)


def previews(ibex, directory):
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    studio.setup_preview(sun_direction=(-0.46, 0.36, 0.61), sun_strength=4.0, sky=(0.5, 0.62, 0.8), sky_strength=0.8)
    colours = _albedo(ibex)
    ground = studio.mesh_object("ground", np.array([[-9, 0, -9], [9, 0, -9], [9, 0, 9], [-9, 0, 9]], dtype=float),
                                np.array([[0, 2, 1], [0, 3, 2]]))
    ground.data.materials.append(studio.material("rock", vertex_color=False, base=(0.22, 0.21, 0.19)))
    material = studio.material("ibex", roughness=0.85)
    objects = []
    # The buck (full horns, 1.18x), a nanny (short horns), the kid (buds, 0.55x), and the buck's poses.
    cast = [("buck", 1.18, 1.0, "alert"), ("nanny", 1.0, 0.3, "alert"), ("kid", 0.55, 0.1, "alert"),
            ("buck-graze", 1.18, 1.0, "graze"), ("nanny-look", 1.0, 0.3, "look"), ("buck-leap", 1.18, 1.0, "leap")]
    for index, (name, size, horn, pose) in enumerate(cast):
        p, n = skin_vertices(ibex, pose_matrices(POSES[pose]), with_horns(ibex, horn))
        lift = 0.35 if pose == "leap" else 0.0
        p = p * size + np.array([(index - 2.5) * 0.25, lift, -(index - 2.5) * 1.6])
        obj = studio.mesh_object("ibex_" + name, p, ibex.triangles, colors=colours)
        obj.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(n)])
        obj.data.materials.append(material)
        objects.append(obj)
    studio.render(directory / "ibex-cast.png", eye=(7.0, 2.0, 0.5), target=(0.0, 0.55, 0.0), lens=38,
                  size=(1100, 560), samples=16)
    for obj in objects:
        obj.hide_render = True
    p, n = skin_vertices(ibex, pose_matrices(POSES["alert"]), with_horns(ibex, 1.0))
    single = studio.mesh_object("ibex_single", p * 1.18, ibex.triangles, colors=colours)
    single.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(n)])
    single.data.materials.append(material)
    views = {
        "close-side": ((3.4, 0.9, 0.1), (0.0, 0.8, 0.05), 50),
        "close-front34": ((2.0, 1.4, 2.6), (0.0, 0.85, 0.2), 50),
        "close-behind": ((-1.4, 1.3, -3.2), (0.0, 0.75, -0.2), 50),
        "close-head": ((1.0, 1.35, 1.1), (0.0, 1.15, 0.5), 50),
    }
    for name, (eye, target, lens) in views.items():
        studio.render(directory / ("ibex-%s.png" % name), eye=eye, target=target, lens=lens, size=(640, 480),
                      samples=16)
    studio.dispose()


def motion(ibex, spec_path, directory):
    """Frames of motion exported from the game's own solver (the pose table per frame), each with its
    camera; previews only."""
    import bpy
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    spec = json.loads(Path(spec_path).read_text())
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    studio.setup_preview(sun_direction=(-0.46, 0.36, 0.61), sun_strength=4.0, sky=(0.5, 0.62, 0.8), sky_strength=0.8)
    colours = _albedo(ibex)
    if spec.get("ground"):
        g = spec["ground"]
        ground = studio.mesh_object("ground", np.asarray(g["positions"], dtype=float), np.asarray(g["triangles"]))
    else:
        ground = studio.mesh_object("ground", np.array([[-60, 0, -60], [60, 0, -60], [60, 0, 60], [-60, 0, 60]],
                                                       dtype=float), np.array([[0, 2, 1], [0, 3, 2]]))
    ground.data.materials.append(studio.material("rock", vertex_color=False, base=(0.22, 0.21, 0.19)))
    material = studio.material("ibex", roughness=0.85)
    w = ibex.weights.astype(np.float64) / 255.0
    ids = ibex.bones.astype(np.int64)
    for index, frame in enumerate(spec["frames"]):
        for animal in frame["animals"]:
            table = np.asarray(animal["table"], dtype=np.float64).reshape(-1, 8)
            positions = with_horns(ibex, animal.get("horn", 1.0))
            mats = [kit._quat_matrix(row[:4]) for row in table]
            p = np.zeros_like(positions)
            n = np.zeros_like(ibex.normals)
            for k in range(4):
                R = np.stack([mats[i] for i in ids[:, k]])
                T = table[ids[:, k], 4:7]
                K = table[ids[:, k], 7:8]
                p += w[:, k:k + 1] * (np.einsum("nij,nj->ni", R, positions) * K + T)
                n += w[:, k:k + 1] * np.einsum("nij,nj->ni", R, ibex.normals)
            n /= np.maximum(np.linalg.norm(n, axis=1), 1e-9)[:, None]
            obj = studio.mesh_object("ibex_frame", p, ibex.triangles, colors=colours)
            obj.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(n)])
            obj.data.materials.append(material)
        cam = frame["camera"]
        studio.render(directory / ("f%04d.png" % index), eye=cam["eye"], target=cam["target"], lens=cam.get("lens", 50),
                      size=tuple(spec.get("size", (480, 300))), samples=8)
        for obj in [o for o in bpy.data.objects if o.name.startswith("ibex_frame")]:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)
    studio.dispose()


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {}
    for key, value in zip(arguments[::2], arguments[1::2]):
        options[key.lstrip("-")] = value
    out = Path(options.get("out", "alpine-ibex.glb"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Odyssey - Ibex Atelier"
    studio_module.PREFIX = "SODY_"
    studio = studio_module.Studio()
    try:
        ibex = build(studio)
        out.parent.mkdir(parents=True, exist_ok=True)
        size = write(out, ibex)
        print("%s wrote %s (%d bytes) %s" % (TAG, out, size, json.dumps(ibex.record())), flush=True)
    finally:
        studio.dispose()
    if options.get("preview"):
        previews(ibex, Path(options["preview"]))
        print("%s previews in %s" % (TAG, options["preview"]), flush=True)
    if options.get("motion"):
        motion(ibex, options["motion"], Path(options["motion-out"]))
        print("%s motion frames in %s" % (TAG, options["motion-out"]), flush=True)


if __name__ == "__main__":
    main()
