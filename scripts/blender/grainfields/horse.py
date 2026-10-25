"""The Grainfields herd's horse: a Hokkaido native horse (Dosanko), modelled and rigged procedurally.

Built by scripts/blender/grainfields_assets.py (`--only horse`). The horse lives in ripe
barley twenty to fifty metres from a low camera, so what has to read first is the silhouette
over the grain, often against the light: the line of the back from the withers to the croup,
the thick arched neck under a heavy mane that falls in locks to both sides, the large
straight-profiled head with its broad forehead, heavy jowl and small cupped ears, and the full
tail falling from the dock in locks. The breed is stocky: short, strong legs under a deep
barrel; withers about 1.35 m.

How it is made:

- **Shape.** A signed distance field (horse_sdf.py) of ellipsoids and round cones joined by
  polynomial smooth unions: the barrel, chest, shoulders and their points, withers, back, the
  points of the hip and the buttock, croup, quarters, stifles and thighs; the neck under its
  crest; the head as cranium, flat forehead, jowls, face, muzzle, lips, jaw bars, eyes and brows;
  cupped ears; four legs of forearm or gaskin, elbow, knee or hock, cannon, fetlock with its
  feather, pastern and hoof. The mane and the forelock are locks laid on the neck and the
  forehead (each falls from the crest and is projected onto the skin as it goes), the tail a
  fall of locks from the dock; the hair is lumpy with strands.
- **Mesh.** The field's left half is sampled on a 7 mm grid, polygonised with surface nets,
  projected onto the zero set, decimated in Blender with a quadric edge collapse, cleaned of
  folds and mirrored, so the whole horse is exactly symmetric.
- **Skeleton.** Thirty-eight bones (BONES): the root, the pelvis and the chest; three neck
  bones, the head at the atlas, the jaw, the ears; each fore leg's scapula, humerus, forearm,
  cannon, pastern and hoof; each hind leg's femur, tibia, cannon, pastern and hoof; six down
  the tail. Every bone rests aligned with the horse's own axes (x left, y up, z forward), so a
  pose is a rotation of each bone about its head in its parent's frame.
- **Skin.** Up to four bones a vertex (`_BONES`, `_WEIGHTS`): a leg follows its segments with
  narrow blends at the joints and fades into the trunk across a band of skin; the shoulder and
  the upper arm, the thigh and the upper gaskin carry the body's skin over them; the trunk
  bends between the pelvis, the root and the chest; the neck along its three bones, the head
  whole beyond the atlas, the jowls with the jaw; the tail down its chain.
- **Paint.** COLOR_0 = (hair, points, light, occlusion): the mane, forelock, tail and feathers;
  the legs below the knees and hocks; a pale belly and muzzle; ambient occlusion from the
  field. `_MASK` = (hoof, skin, flutter, ear): the horn, the dark skin of the nostrils and lips,
  how freely the hair moves in the wind (0 at its roots, 1 at the tips) and the inside of the
  ears. The eyes and the nostrils are smaller than the mesh's vertices are apart: the file
  carries where they are (`landmarks`) and the fragment stage draws them.

Frame: metres, +z forward (toward the head), +y up, the hooves on y = 0, the body centred on
x = 0. The horse faces +z, so its left side is +x.
"""

import math
import time

import numpy as np

from grainfields.horse_sdf import (
    VOXEL, X_AXIS, Z_AXIS, Displace, Ellipsoid, HalfSpace, RoundCone, Tube, Union,
    _grid, _neighbours, _point, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)

TAG = "[grainfields]"
NAME = "grainfields-horse"
BREED = "Hokkaido native horse (Dosanko)"
# Regions the paint and the skin work by (internal: the file carries bones, not regions).
REGIONS = {"body": 0, "neck": 1, "frontLeft": 2, "frontRight": 3, "hindLeft": 4, "hindRight": 5, "tail": 6}
TARGET_TRIANGLES = 9000

# Where the legs stand (z of the front and hind cannons) and how far apart (x).
FRONT_Z = 0.445
HIND_Z = -0.698
FORE_X = 0.14
HIND_X = 0.15

# The head's frame: from the poll, s forward along the face (48 degrees below the horizontal),
# t toward the forehead, x across; a large head, 0.64 m from the poll to the lips.
POLL = _point(1.80, 1.04)
HEAD_PITCH = math.radians(48.0)
HEAD_FORWARD = np.array([0.0, -math.sin(HEAD_PITCH), math.cos(HEAD_PITCH)])
HEAD_UP = np.array([0.0, math.cos(HEAD_PITCH), math.sin(HEAD_PITCH)])
HEAD_SCALE = 1.06


def head_point(s, t, x=0.0):
    return POLL + HEAD_SCALE * (s * HEAD_FORWARD + t * HEAD_UP + np.array([x, 0.0, 0.0]))


def head_radii(*values):
    return tuple(HEAD_SCALE * value for value in values)


def _ear_base(side):
    return head_point(0.0, 0.035, 0.06 * side)


def _ear_direction(side):
    return _unit((0.2 * side, 0.95, 0.22))


# -- the skeleton -------------------------------------------------------------------------
def _bone_table():
    """(name, parent, head) in an order where every parent comes before its children."""
    tmj = head_point(0.10, -0.095)
    bones = [
        ("root", None, (0.0, 1.00, -0.05)),
        ("pelvis", "root", (0.0, 1.12, -0.30)),
        ("chest", "root", (0.0, 1.12, 0.18)),
        ("neck0", "chest", (0.0, 1.10, 0.48)),
        ("neck1", "neck0", (0.0, 1.33, 0.68)),
        ("neck2", "neck1", (0.0, 1.55, 0.84)),
        ("head", "neck2", (0.0, 1.745, 0.97)),
        ("jaw", "head", tuple(float(v) for v in tmj)),
        ("earL", "head", tuple(float(v) for v in _ear_base(1.0))),
        ("earR", "head", tuple(float(v) for v in _ear_base(-1.0))),
    ]
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x = FORE_X * side
        bones += [
            ("scapula" + tag, "chest", (0.12 * side, 1.19, 0.43)),
            ("humerus" + tag, "scapula" + tag, (x, 0.99, 0.62)),
            ("forearm" + tag, "humerus" + tag, (x, 0.82, 0.45)),
            ("foreCannon" + tag, "forearm" + tag, (x, 0.415, FRONT_Z)),
            ("forePastern" + tag, "foreCannon" + tag, (x, 0.118, FRONT_Z - 0.003)),
            ("foreHoof" + tag, "forePastern" + tag, (x, 0.05, FRONT_Z + 0.028)),
        ]
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x = HIND_X * side
        bones += [
            ("femur" + tag, "pelvis", (x, 0.97, -0.60)),
            ("tibia" + tag, "femur" + tag, (0.17 * side, 0.75, -0.46)),
            ("hindCannon" + tag, "tibia" + tag, (x, 0.49, HIND_Z)),
            ("hindPastern" + tag, "hindCannon" + tag, (x, 0.118, HIND_Z)),
            ("hindHoof" + tag, "hindPastern" + tag, (x, 0.05, HIND_Z + 0.024)),
        ]
    tail = [(1.22, -0.78), (1.13, -0.86), (1.00, -0.905), (0.82, -0.94), (0.62, -0.955), (0.42, -0.965)]
    for index, (y, z) in enumerate(tail):
        bones.append(("tail%d" % index, "pelvis" if index == 0 else "tail%d" % (index - 1), (0.0, y, z)))
    return bones


BONES = _bone_table()
BONE_INDEX = {name: index for index, (name, _parent, _head) in enumerate(BONES)}
BONE_HEADS = np.array([head for _name, _parent, head in BONES], dtype=np.float64)
BONE_PARENTS = np.array([-1 if parent is None else BONE_INDEX[parent] for _name, parent, _head in BONES])


def joint(name):
    return BONE_HEADS[BONE_INDEX[name]]


# -- shape helpers ------------------------------------------------------------------------
def _mane_locks(x, y, z):
    # Symmetric in x, so the mesh stays mirror-symmetric.
    return np.sin(47.0 * y - 19.0 * z + 0.7) * np.cos(23.0 * x) * np.sin(29.0 * z + 11.0 * y + 1.9)


def _tail_strands(x, y, z):
    return np.cos(61.0 * x) * (0.55 + 0.45 * np.sin(17.0 * y + 31.0 * z))


def _hash(index, salt=0.0):
    value = math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
    return value - math.floor(value)


def _crest_offsets(line, offsets):
    """Stations moved off a (y, z) polyline along its upper-back normal by `offsets`."""
    line = np.asarray(line, dtype=np.float64)
    out = []
    for index, (y, z) in enumerate(line):
        before = line[max(0, index - 1)]
        after = line[min(len(line) - 1, index + 1)]
        tangent = _unit(after - before)
        normal = np.array([tangent[1], -tangent[0]])  # (dy, dz) -> up and back
        out.append(_point(y + normal[0] * offsets[index], z + normal[1] * offsets[index]))
    return out


def _along_polyline(line, t):
    """The point a share `t` of the way along a polyline of 3D points."""
    line = np.asarray(line, dtype=np.float64)
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))])
    at = t * lengths[-1]
    index = int(np.clip(np.searchsorted(lengths, at) - 1, 0, len(line) - 2))
    span = max(lengths[index + 1] - lengths[index], 1e-9)
    return line[index] + (line[index + 1] - line[index]) * (at - lengths[index]) / span


def _laid_lock(skin, start, direction, length, r0, r1, stations=5, lie=0.75, curl=None):
    """A lock of hair from `start` falling along `direction`, laid on `skin` as it goes."""
    points = [np.asarray(start, dtype=np.float64)]
    radii = [r0]
    step = length / (stations - 1)
    heading = _unit(direction)
    for k in range(1, stations):
        f = k / (stations - 1)
        if curl is not None:
            heading = _unit(heading + curl * step)
        p = points[-1] + heading * step
        radius = r0 + (r1 - r0) * f
        on = project(skin, p[None, :], iterations=4, limit=0.05)[0]
        normal = _unit(gradient(skin, on[None, :])[0])
        p = on + normal * radius * lie
        points.append(p)
        radii.append(radius)
    return Tube(points, radii, k=0.012)


# -- the legs -----------------------------------------------------------------------------
def _front_leg(side):
    x = FORE_X * side
    z = FRONT_Z
    leg = Union([
        # The forearm, muscled under the elbow and lean above the knee; the point of the elbow.
        Ellipsoid(_point(0.76, z + 0.015, x), (0.08, 0.088, 0.15), along=(0.0, 1.0, 0.04)),
        Tube([_point(0.88, z + 0.01, x), _point(0.62, z + 0.005, x), _point(0.45, z, x)], [0.085, 0.07, 0.05],
             squash_axis=X_AXIS, squash=0.86),
        Ellipsoid(_point(0.835, z - 0.065, x * 1.02), (0.05, 0.06, 0.06)),
        # The knee (carpus), flat in front.
        Ellipsoid(_point(0.415, z, x), (0.054, 0.058, 0.056)),
        # The cannon, narrow from the front, the fetlock, the sloping pastern and the hoof.
        Tube([_point(0.40, z - 0.002, x), _point(0.15, z - 0.003, x)], [0.046, 0.043], squash_axis=X_AXIS,
             squash=0.8),
        Ellipsoid(_point(0.118, z - 0.003, x), (0.05, 0.053, 0.06)),
        Ellipsoid(_point(0.095, z - 0.03, x), (0.042, 0.044, 0.042)),
        Tube([_point(0.115, z, x), _point(0.06, z + 0.027, x)], [0.039, 0.043]),
        RoundCone(_point(0.072, z + 0.031, x), _point(0.012, z + 0.047, x), 0.048, 0.066),
    ], k=0.03)
    # The feather: a tuft of hair behind the fetlock.
    feather = Displace(Ellipsoid(_point(0.1, z - 0.048, x), (0.036, 0.042, 0.046), along=(0.0, -0.5, -0.87)),
                       0.006, _tail_strands)
    return leg, feather


def _hind_leg(side):
    x = HIND_X * side
    z = HIND_Z
    leg = Union([
        # The gaskin from the stifle down and back to the hock, with its muscle behind.
        Tube([_point(0.80, z + 0.25, x * 1.12), _point(0.66, z + 0.13, x), _point(0.50, z + 0.005, x)],
             [0.105, 0.085, 0.058], squash_axis=X_AXIS, squash=0.78),
        Ellipsoid(_point(0.72, z + 0.12, x), (0.062, 0.08, 0.12), along=(0.0, 0.66, 0.75)),
        # The hock and its point.
        Ellipsoid(_point(0.49, z + 0.002, x), (0.05, 0.066, 0.068)),
        Ellipsoid(_point(0.53, z - 0.058, x), (0.032, 0.045, 0.034)),
        # The cannon, the fetlock, the pastern and the hoof.
        Tube([_point(0.47, z - 0.002, x), _point(0.15, z + 0.002, x)], [0.047, 0.043], squash_axis=X_AXIS,
             squash=0.8),
        Ellipsoid(_point(0.118, z + 0.002, x), (0.05, 0.053, 0.059)),
        Ellipsoid(_point(0.095, z - 0.024, x), (0.042, 0.044, 0.042)),
        Tube([_point(0.115, z - 0.002, x), _point(0.06, z + 0.022, x)], [0.038, 0.042]),
        RoundCone(_point(0.072, z + 0.026, x), _point(0.012, z + 0.042, x), 0.046, 0.063),
    ], k=0.03)
    feather = Displace(Ellipsoid(_point(0.1, z - 0.044, x), (0.034, 0.04, 0.044), along=(0.0, -0.5, -0.87)),
                       0.006, _tail_strands)
    return leg, feather


def _pair(make):
    return [make(1.0), make(-1.0)]


# -- the horse ----------------------------------------------------------------------------
def design():
    """The horse as a distance field, and the landmarks the paint and the skin use."""
    body = Union([
        # The deep barrel and the round belly under it.
        Ellipsoid(_point(0.97, -0.03), (0.29, 0.31, 0.50)),
        Ellipsoid(_point(0.85, -0.06), (0.28, 0.2, 0.38)),
        # The girth and the chest, the shoulders sloping up to the withers, and their points.
        Ellipsoid(_point(0.99, 0.26), (0.26, 0.30, 0.28)),
        Ellipsoid(_point(0.99, 0.52), (0.20, 0.24, 0.22)),
        *[(Ellipsoid(_point(1.12, 0.48, 0.10 * s), (0.15, 0.12, 0.29), along=(0.0, 0.60, -0.80)), 0.1)
          for s in (1.0, -1.0)],
        *[(Ellipsoid(_point(1.0, 0.655, 0.125 * s), (0.07, 0.085, 0.075)), 0.07) for s in (1.0, -1.0)],
        (Ellipsoid(_point(1.215, 0.30), (0.10, 0.115, 0.22), along=(0.0, 0.25, 0.97)), 0.1),
        # A broad, flat back and loins, a little below the withers and the croup.
        Ellipsoid(_point(1.165, -0.08), (0.22, 0.11, 0.33)),
        # The quarters, the croup falling to the tail, the points of the hip and the buttock,
        # the stifles and the thighs down to the gaskins.
        Ellipsoid(_point(1.04, -0.49), (0.275, 0.27, 0.31)),
        (Ellipsoid(_point(1.195, -0.42), (0.19, 0.115, 0.27), along=(0.0, 0.30, 0.95)), 0.1),
        *[(Ellipsoid(_point(1.11, -0.30, 0.2 * s), (0.055, 0.06, 0.07)), 0.08) for s in (1.0, -1.0)],
        *[(Ellipsoid(_point(0.80, -0.42, 0.17 * s), (0.085, 0.115, 0.10)), 0.08) for s in (1.0, -1.0)],
        *[(Ellipsoid(_point(0.88, -0.63, 0.14 * s), (0.14, 0.14, 0.21), along=(0.0, -0.848, 0.53)), 0.08)
          for s in (1.0, -1.0)],
    ], k=0.12).tag(REGIONS["body"])

    # The neck: a deep, tapering core at about 47 degrees under an arched crest.
    core = Tube([_point(1.10, 0.54), _point(1.25, 0.70), _point(1.40, 0.84), _point(1.53, 0.95), _point(1.64, 1.04)],
                [0.25, 0.215, 0.178, 0.152, 0.132], squash_axis=X_AXIS, squash=[0.76, 0.76, 0.78, 0.8, 0.84],
                k=0.03)
    crest_line = [(1.33, 0.28), (1.485, 0.46), (1.62, 0.66), (1.72, 0.86), (1.79, 1.01)]
    crest_radii = [0.10, 0.10, 0.09, 0.08, 0.07]
    crest = Tube(_crest_offsets(crest_line, [-r for r in crest_radii]), crest_radii, squash_axis=X_AXIS,
                 squash=0.9, k=0.03)

    # A pony's big head, but no longer than it is: a broad, flat forehead, a heavy round jowl, a
    # straight face that keeps its width down to a square, soft muzzle.
    head_shape = Union([
        Ellipsoid(head_point(0.11, -0.05), head_radii(0.125, 0.12, 0.15), along=HEAD_FORWARD),      # cranium
        Ellipsoid(head_point(0.15, 0.0), head_radii(0.12, 0.045, 0.13), along=HEAD_FORWARD),        # forehead
        Ellipsoid(head_point(0.12, -0.18), head_radii(0.118, 0.15, 0.15), along=HEAD_FORWARD),      # jowls
        RoundCone(head_point(0.20, -0.045), head_point(0.44, -0.055), *head_radii(0.102, 0.082),
                  (X_AXIS, 0.82)),                                                                   # face
        Ellipsoid(head_point(0.47, -0.08), head_radii(0.072, 0.078, 0.074), along=HEAD_FORWARD),    # muzzle
        Ellipsoid(head_point(0.515, -0.104), head_radii(0.06, 0.038, 0.045), along=HEAD_FORWARD),   # upper lip
        Ellipsoid(head_point(0.465, -0.14), head_radii(0.045, 0.032, 0.048), along=HEAD_FORWARD),   # chin
        RoundCone(head_point(0.20, -0.225, 0.045), head_point(0.43, -0.13, 0.035), *head_radii(0.05, 0.034)),
        RoundCone(head_point(0.20, -0.225, -0.045), head_point(0.43, -0.13, -0.035), *head_radii(0.05, 0.034)),
        *[Ellipsoid(head_point(0.13, -0.005, 0.104 * s), head_radii(0.022, 0.026, 0.03), along=HEAD_FORWARD)
          for s in (1.0, -1.0)],                                                                     # eyes
        *[Ellipsoid(head_point(0.11, 0.026, 0.095 * s), head_radii(0.022, 0.013, 0.04), along=HEAD_FORWARD)
          for s in (1.0, -1.0)],                                                                     # brows
    ], k=0.045)

    # Small ears for the head, but the first thing a silhouette needs: up, a little forward and
    # out, leaf-shaped and cupped (thin front to back).
    ears = []
    for side in (1.0, -1.0):
        base = _ear_base(side)
        direction = _ear_direction(side)
        across = _unit(np.array(Z_AXIS) - direction * direction[2])
        ears.append(Tube([base, base + 0.07 * direction, base + 0.148 * direction], [0.044, 0.04, 0.01],
                         squash_axis=across, squash=0.55, k=0.01))
    ears = Union(ears)
    for leaf in ears.leaves():
        leaf.ear = True

    neck_skin = Union([(core, 0.0), (crest, 0.08), (head_shape, 0.07)])

    # The mane: a ridge of hair on the crest and locks falling from it down both sides of the
    # neck, longest mid-neck, each laid on the skin.
    mane_line = [_point(y, z) for y, z in [(1.39, 0.35)] + crest_line[1:]]
    root_line = _crest_offsets([(p[1], p[2]) for p in mane_line], [0.012] * 5)
    ridge = Tube(root_line, [0.035, 0.05, 0.058, 0.058, 0.05], k=0.02)
    locks = []
    count = 13
    for index in range(count):
        t = 0.02 + 0.96 * index / (count - 1)
        start = _along_polyline(root_line, t) + np.array([0.03, 0.0, 0.0])
        length = (0.11 + 0.15 * math.sin(math.pi * t) ** 0.6) * (0.85 + 0.3 * _hash(index))
        direction = (0.42, -1.0, -0.12 - 0.1 * _hash(index, 1.0))
        locks.append(_laid_lock(neck_skin, start, direction, length, 0.042, 0.011))
    mane = Displace(Union([ridge, *[(lock, 0.02) for lock in locks]], k=0.02), 0.006, _mane_locks)

    # The forelock falls from between the ears over the forehead toward the eyes.
    forelocks = [_laid_lock(head_shape, head_point(-0.02, 0.085, x), HEAD_FORWARD - 0.25 * HEAD_UP, length,
                            0.036, 0.01, stations=4)
                 for x, length in ((0.0, 0.23), (0.028, 0.2), (-0.028, 0.2))]
    forelock = Displace(Union([(lock, 0.015) for lock in forelocks]), 0.005, _mane_locks)

    # The tail: the dock arches off the croup; the hair springs from its end full and falls in locks
    # that part toward their ends. Below the dock it hangs clear of the buttocks and the hocks (a
    # few centimetres behind them: hair welded to the skin would tear it as the tail lifts), so it
    # lifts and swishes on its own.
    dock = Tube([_point(1.24, -0.72), _point(1.17, -0.83), _point(1.07, -0.875)], [0.065, 0.058, 0.05])
    fall = Tube([_point(1.15, -0.865), _point(1.06, -0.95), _point(0.92, -1.015), _point(0.73, -1.035),
                 _point(0.56, -1.04), _point(0.46, -1.04)], [0.058, 0.085, 0.104, 0.1, 0.084, 0.058],
                squash_axis=Z_AXIS, squash=0.55, k=0.02)
    tail_locks = []
    for x, dz, end in ((0.02, -0.01, 0.27), (0.045, 0.015, 0.31), (0.05, -0.03, 0.36), (0.074, 0.0, 0.42),
                       (0.028, -0.04, 0.3), (0.062, 0.02, 0.38)):
        top = _point(0.86, -1.035 + dz, x * 0.6)
        mid = _point(0.6, -1.045 + dz * 1.2, x * 0.9)
        tip = _point(end, -1.048 + dz * 1.4, x * 1.25)
        tail_locks.append(Tube([top, mid, tip], [0.05, 0.04, 0.009], squash_axis=Z_AXIS, squash=0.8, k=0.012))
    hair = Displace(Union([fall, *[(lock, 0.025) for lock in tail_locks]]), 0.008, _tail_strands)

    neck = Union([
        (core, 0.0), (crest, 0.08), (head_shape, 0.07), (ears, 0.025),
    ]).tag(REGIONS["neck"])
    for leaf in ears.leaves():
        leaf.ear = True
    mane.tag(REGIONS["neck"], hair=True)
    forelock.tag(REGIONS["neck"], hair=True)
    tail = Union([dock.tag(REGIONS["tail"], hair=True), (hair.tag(REGIONS["tail"], hair=True), 0.04)])
    fronts = [_front_leg(1.0), _front_leg(-1.0)]
    hinds = [_hind_leg(1.0), _hind_leg(-1.0)]
    legs = []
    for (leg, feather), name in zip(fronts + hinds, ("frontLeft", "frontRight", "hindLeft", "hindRight")):
        leg.tag(REGIONS[name])
        feather.tag(REGIONS[name], hair=True)
        legs.append(Union([leg, (feather, 0.03)]))
    root = HalfSpace(Union([
        (body, 0.0), (neck, 0.1), (mane, 0.045), (forelock, 0.02),
        *[(leg, 0.07) for leg in legs], (tail, 0.025),
    ]), axis=1)
    landmarks = dict(
        muzzle=head_point(0.545, -0.08),
        nostrils=[head_point(0.505, -0.045, 0.056 * s) for s in (1.0, -1.0)],
        mouth=head_point(0.53, -0.125),
        eyes=[head_point(0.13, -0.005, 0.104 * s) for s in (1.0, -1.0)],
        # The middle of each eye's surface (where the bulge stands out of the head).
        eye_poles=[head_point(0.135, -0.003, 0.104 * s + 0.024 * s) for s in (1.0, -1.0)],
        # The mane's roots run along the crest; the forelock's between the ears.
        mane_root=np.array(root_line),
        forelock_root=head_point(-0.02, 0.085),
        # The neck leaves the body through a plane from the front of the withers down to the
        # foot of the jugular groove (above the point of the shoulder): (y, z) pairs.
        neckBase=((1.35, 0.29), (1.04, 0.80)),
        frontCut=0.80,      # a front leg's part ends under the elbow
        hindCut=0.86,       # a hind leg's part ends at the stifle
        frontPoints=(0.50, 0.40),   # dark points fade in below the knee
        hindPoints=(0.57, 0.47),    # ... and below the hock
        coronet=(0.085, 0.06),      # the horn of the hoof below the coronet
        rig=dict(
            # A leg's weight fades out up into the body over these heights.
            frontBand=(0.80, 0.98), hindBand=(0.86, 1.04),
            # The neck's axis (y, z) from its base to the atlas; the head's plane from behind the
            # poll to the throat.
            neckAxis=((1.195, 0.545), (1.745, 0.97)),
            headPlane=((1.86, 0.98), (1.48, 0.93)),
            # The tail from its root down to its end (heights).
            tailSpan=(1.24, 0.27),
        ),
    )
    return root, landmarks


# -- regions, masks and occlusion ---------------------------------------------------------
def _clean_parts(parts, neighbours, passes=3):
    """Vote away stray vertices, then keep each part to one connected region."""
    parts = parts.copy()
    for _ in range(passes):
        updated = parts.copy()
        for vertex, around in enumerate(neighbours):
            if not len(around):
                continue
            values, counts = np.unique(parts[around], return_counts=True)
            if np.count_nonzero(parts[around] == parts[vertex]) * 3 < len(around):
                updated[vertex] = values[np.argmax(counts)]
        parts = updated
    for part in np.unique(parts):
        seen = np.zeros(len(parts), dtype=bool)
        regions = []
        for start in np.nonzero(parts == part)[0]:
            if seen[start]:
                continue
            region, stack = [], [start]
            seen[start] = True
            while stack:
                vertex = stack.pop()
                region.append(vertex)
                for other in neighbours[vertex]:
                    if not seen[other] and parts[other] == part:
                        seen[other] = True
                        stack.append(other)
            regions.append(region)
        regions.sort(key=len, reverse=True)
        for region in regions[1:]:
            around = np.concatenate([neighbours[v] for v in region])
            around = around[parts[around] != part]
            if len(around):
                values, counts = np.unique(parts[around], return_counts=True)
                parts[region] = values[np.argmax(counts)]
    return parts


def _plane_distance(positions, top, low):
    """Signed distance (metres) from the (y, z) line through `top` and `low`; positive ahead (+z)."""
    (top_y, top_z), (low_y, low_z) = top, low
    normal = np.array([low_z - top_z, top_y - low_y])
    normal /= np.linalg.norm(normal)
    return (positions[:, 1] - top_y) * normal[0] + (positions[:, 2] - top_z) * normal[1]


def _segment_distance(points, a, b):
    """Distance from each point to the segment a-b (3D)."""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    ab = b - a
    t = np.clip(((points - a) @ ab) / max(ab @ ab, 1e-12), 0.0, 1.0)
    return np.linalg.norm(points - (a + t[:, None] * ab), axis=1)


def _polyline_distance(points, line):
    return np.min([_segment_distance(points, line[i], line[i + 1]) for i in range(len(line) - 1)], axis=0)


def regions(shape, landmarks, positions, triangles):
    """Which region each vertex belongs to, by the nearest primitive (cleaned into one piece each)."""
    leaves = shape.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    leaf_parts = np.array([leaf.part for leaf in leaves])
    hair = np.array([leaf.hair for leaf in leaves])
    y = positions[:, 1]
    claim = distances.copy()
    for column, part in enumerate(leaf_parts):
        if part in (REGIONS["frontLeft"], REGIONS["frontRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["frontCut"])
        elif part in (REGIONS["hindLeft"], REGIONS["hindRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["hindCut"])
    parts = leaf_parts[np.argmin(claim, axis=1)]
    # Between the neck and the body the boundary is the plane at the base of the neck.
    (top_y, top_z), (low_y, low_z) = landmarks["neckBase"]
    ahead = (positions[:, 1] - top_y) * (low_z - top_z) + (positions[:, 2] - top_z) * (top_y - low_y) > 0.0
    trunk = np.isin(parts, (REGIONS["body"], REGIONS["neck"]))
    parts = np.where(trunk, np.where(ahead, REGIONS["neck"], REGIONS["body"]), parts)
    # The mane is the neck's wherever it lies.
    nearest = np.argmin(distances, axis=1)
    parts = np.where(hair[nearest] & (leaf_parts[nearest] == REGIONS["neck"]), REGIONS["neck"], parts)
    parts = _clean_parts(parts, _neighbours(len(positions), triangles))
    return parts, distances


def occlusion(shape, positions, normals, rays=24, reach=0.9, ground=0.6):
    """Ambient occlusion: the share of the sky over each vertex's skin that the horse (and, a little,
    the ground under it) hides, by rays sphere-traced through the field over a cosine-weighted
    hemisphere. (The smooth unions under-measure distance, so a field's own depth test would darken
    every rounded surface alike.)"""
    count = len(positions)
    # A fixed set of directions round +z, cosine-weighted (a Fibonacci spiral on the disc, lifted).
    k = np.arange(rays) + 0.5
    r = np.sqrt(k / rays)
    phi = k * math.pi * (3.0 - math.sqrt(5.0))
    local = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1.0 - r * r)], axis=1)
    # Each vertex's frame about its normal.
    helper = np.where(np.abs(normals[:, 1:2]) < 0.9, np.array([[0.0, 1.0, 0.0]]), np.array([[1.0, 0.0, 0.0]]))
    tangent = np.cross(helper, normals)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1), 1e-9)[:, None]
    bitangent = np.cross(normals, tangent)
    seen = np.zeros(count)
    start = positions + normals * 0.004
    for d in local:
        direction = tangent * d[0] + bitangent * d[1] + normals * d[2]
        # Where the ray meets the ground (beyond reach when it climbs).
        down = direction[:, 1] < -1e-6
        t_ground = np.where(down, start[:, 1] / np.maximum(-direction[:, 1], 1e-6), np.inf)
        t = np.full(count, 0.012)
        alive = np.ones(count, dtype=bool)
        blocked = np.zeros(count)
        for _ in range(28):
            if not alive.any():
                break
            index = np.nonzero(alive)[0]
            p = start[index] + direction[index] * t[index, None]
            field = shape.eval(p)
            hit = field < 0.002
            blocked[index[hit]] = 1.0
            t[index] += np.maximum(field, 0.006)
            # The ground hides part of what lies under it.
            grounded = ~hit & (t[index] >= t_ground[index]) & (t_ground[index] < reach)
            blocked[index[grounded]] = ground
            alive[index[hit | grounded]] = False
            alive &= t < reach
        seen += 1.0 - blocked
    return np.clip(seen / rays, 0.0, 1.0)


def paint(shape, landmarks, positions, normals, parts, distances):
    """COLOR_0 = (hair, points, light, occlusion); _MASK = (hoof, skin, flutter, ear)."""
    leaves = shape.leaves()
    hair = np.array([leaf.hair for leaf in leaves])
    leaf_parts = np.array([leaf.part for leaf in leaves])
    y = positions[:, 1]
    hairiness = _smoothstep(0.012, -0.012, distances[:, hair].min(axis=1) - distances[:, ~hair].min(axis=1))
    front = np.isin(parts, (REGIONS["frontLeft"], REGIONS["frontRight"]))
    hind = np.isin(parts, (REGIONS["hindLeft"], REGIONS["hindRight"]))
    points = np.where(front, _smoothstep(*landmarks["frontPoints"], y), 0.0)
    points = np.where(hind, _smoothstep(*landmarks["hindPoints"], y), points)
    muzzle = _smoothstep(0.19, 0.08, np.linalg.norm(positions - landmarks["muzzle"], axis=1))
    eyes = np.min([np.linalg.norm(positions - eye, axis=1) for eye in landmarks["eyes"]], axis=0)
    around_eyes = _smoothstep(0.06, 0.035, eyes) * 0.25
    belly = _smoothstep(0.86, 0.7, y) * _smoothstep(-0.1, -0.6, normals[:, 1]) * (parts == REGIONS["body"])
    light = np.maximum(np.maximum(muzzle, belly), around_eyes) * (1.0 - hairiness) * (1.0 - points)
    ao = occlusion(shape, positions, normals)
    colors = np.stack([hairiness, points, light, ao], axis=1)

    legs = front | hind
    hoof = legs * _smoothstep(*landmarks["coronet"], y)
    nostril = np.min([np.linalg.norm(positions - n, axis=1) for n in landmarks["nostrils"]], axis=0)
    lips = _smoothstep(0.075, 0.035, np.linalg.norm(positions - landmarks["mouth"], axis=1))
    skin = np.maximum(_smoothstep(0.028, 0.012, nostril), lips * 0.85) * (parts == REGIONS["neck"])
    # Hair moves the more freely the farther from where it grows.
    mane = _smoothstep(0.03, 0.2, _polyline_distance(positions, landmarks["mane_root"]))
    fore = _smoothstep(0.04, 0.2, np.linalg.norm(positions - landmarks["forelock_root"], axis=1))
    tail_top, tail_end = landmarks["rig"]["tailSpan"]
    along_tail = np.clip((tail_top - y) / (tail_top - tail_end), 0.0, 1.0)
    nearest = leaf_parts[np.argmin(distances, axis=1)]
    flutter = np.where(parts == REGIONS["tail"], _smoothstep(0.25, 0.9, along_tail),
                       np.where(nearest == REGIONS["neck"], np.minimum(mane, fore), 0.25))
    flutter = flutter * hairiness
    # The inside of the ears: the ear's skin facing forward, out of its cup.
    ear_leaf = np.array([getattr(leaf, "ear", False) for leaf in leaves])
    ear_near = _smoothstep(0.006, -0.004, distances[:, ear_leaf].min(axis=1) - distances[:, ~ear_leaf].min(axis=1))
    facing = np.max([normals @ _unit((0.25 * side, 0.1, 1.0)) for side in (1.0, -1.0)], axis=0)
    ear = ear_near * _smoothstep(0.15, 0.6, facing) * _smoothstep(0.05, 0.11, positions[:, 1] - _ear_base(1.0)[1])
    masks = np.stack([hoof, skin, flutter, ear], axis=1)
    print("%s horse masks: skin %d verts, hoof %d, hair %d, inner ear %d" % (
        TAG, int((skin > 0.5).sum()), int((hoof > 0.5).sum()), int((hairiness > 0.5).sum()), int((ear > 0.5).sum())))
    return colors, masks


# -- the skin -----------------------------------------------------------------------------
def _root_weights(landmarks, positions, distances, leaves, parts):
    """How far each vertex follows its region's root bone rather than the trunk (0..1)."""
    R = landmarks["rig"]
    y = positions[:, 1]
    leaf_parts = np.array([leaf.part for leaf in leaves])
    leg_ids = [REGIONS[name] for name in ("frontLeft", "frontRight", "hindLeft", "hindRight")]

    def nearest(part):
        return distances[:, leaf_parts == part].min(axis=1)

    def others(part):
        # Nearer this part than what it could tear from: the trunk, and the tail hanging by the hocks
        # (a leg is never joined to another leg, so their nearness does not count).
        exclude = leg_ids if part in leg_ids else [part]
        return distances[:, ~np.isin(leaf_parts, exclude)].min(axis=1)

    weights = np.zeros((len(positions), 7))
    for name in ("frontLeft", "frontRight", "hindLeft", "hindRight"):
        part = REGIONS[name]
        low, high = R["frontBand"] if name.startswith("front") else R["hindBand"]
        side = 1.0 if name.endswith("Left") else -1.0
        own = (positions[:, 0] * side) > -0.02
        # (Soft over a wide margin: the skin must stretch over several vertices, not one edge.) Below
        # the elbow or the stifle the leg is free of the trunk, however near the belly it hangs.
        # (A function of the field alone, the same on both sides of where the regions part.)
        free_below = (0.8, 0.68) if name.startswith("front") else (0.74, 0.62)
        nearer = others(part) - nearest(part)
        soft = np.maximum(_smoothstep(-0.06, 0.16, nearer), _smoothstep(*free_below, y) * _smoothstep(-0.06, 0.0, nearer))
        weights[:, part] = soft * _smoothstep(high, low, y) * own
    neck_plane = _plane_distance(positions, *landmarks["neckBase"])
    trunk_or_neck = np.isin(parts, (REGIONS["body"], REGIONS["neck"]))
    # (Wide, and widest along the crest: grazing swings the neck nearly two radians about a base deep
    # in the chest, and the skin over the withers stretches the whole way.)
    crest = _smoothstep(1.2, 1.38, positions[:, 1])
    weights[:, REGIONS["neck"]] = _smoothstep(-0.13 - 0.12 * crest, 0.15, neck_plane) * trunk_or_neck
    tail_top, tail_end = R["tailSpan"]
    along_tail = np.clip((tail_top - y) / (tail_top - tail_end), 0.0, 1.0)
    # (Only up by the dock does the skin blend into the croup: lower down the hair is the tail's.)
    tail_soft = np.maximum(_smoothstep(-0.07, 0.1, others(REGIONS["tail"]) - nearest(REGIONS["tail"])),
                           _smoothstep(0.08, 0.2, along_tail) * (parts == REGIONS["tail"]))
    weights[:, REGIONS["tail"]] = tail_soft * _smoothstep(0.0, 0.07, along_tail) * (parts != REGIONS["neck"])
    best = np.argmax(weights, axis=1)
    root = weights[np.arange(len(positions)), best]
    rigged = np.where(root > 0.002, best, REGIONS["body"])
    root = np.where(rigged == REGIONS["body"], 0.0, root)
    return rigged, root


def _chain(u, knots):
    """Smooth hat weights along u over ordered knots: a partition of unity (one column per knot)."""
    n = len(knots)
    out = np.zeros((len(u), n))
    for i in range(n):
        rise = _smoothstep(knots[i - 1], knots[i], u) if i > 0 else np.ones(len(u))
        fall = 1.0 - _smoothstep(knots[i], knots[i + 1], u) if i < n - 1 else np.ones(len(u))
        out[:, i] = np.where(u <= knots[i], rise, fall)
    return out


def _below(y, at, half):
    """How far below a joint at height `at` a point lies (0 above the blend, 1 under it)."""
    return _smoothstep(at + half, at - half, y)


def skin(landmarks, positions, distances, leaves, parts, triangles, smoothing=6):
    """Each vertex's bones and weights: (indices N x 4, weights N x 4 summing to 1)."""
    count = len(positions)
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    side = np.where(x >= 0.0, 1.0, -1.0)
    tag = np.where(x >= 0.0, "L", "R")
    rigged, r = _root_weights(landmarks, positions, distances, leaves, parts)
    W = np.zeros((count, len(BONES)))
    rows = np.arange(count)

    def add(bone_names, values, mask=None):
        """Add weights to each vertex's own-side bone (`bone_names` per vertex or one name)."""
        names = np.broadcast_to(np.asarray(bone_names), (count,))
        columns = np.array([BONE_INDEX[name] for name in names])
        values = np.asarray(values, dtype=np.float64) * (1.0 if mask is None else mask)
        np.add.at(W, (rows, columns), values)

    def sided(stem):
        return np.char.add(stem, tag)

    # ── The trunk's share: the shoulder and the upper arm, the thigh and the upper gaskin carry the
    # skin over them; the rest bends between the pelvis, the root and the chest. ──
    trunk = 1.0 - r
    lateral = np.abs(x)
    yz = positions.copy()
    yz[:, 0] = 0.0

    def flank(a, b, near, far):
        return (1.0 - _smoothstep(near, far, _segment_distance(yz, a, b)))

    mirrored = lambda point: point * np.array([0.0, 1.0, 1.0])  # noqa: E731
    scapula_top = _point(1.30, 0.33)
    shoulder = mirrored(joint("humerusL"))
    elbow = mirrored(joint("forearmL"))
    hip = mirrored(joint("femurL"))
    stifle = mirrored(joint("tibiaL"))
    hock = mirrored(joint("hindCannonL"))
    scap = flank(scapula_top, shoulder, 0.07, 0.17) * _smoothstep(0.04, 0.13, lateral) * 0.85
    hum = flank(shoulder, elbow, 0.05, 0.14) * _smoothstep(0.05, 0.13, lateral) * 0.9
    hum *= _smoothstep(1.06, 0.95, y)
    fem = flank(hip, stifle, 0.09, 0.24) * _smoothstep(0.05, 0.15, lateral) * 0.85
    tib = flank(stifle, stifle + 0.45 * (hock - stifle), 0.04, 0.12) * _smoothstep(0.05, 0.13, lateral) * 0.9
    fore_share = np.maximum(scap, hum)
    hind_share = np.maximum(fem, tib)
    limb = np.minimum(0.95, fore_share + hind_share)
    scale = np.where(fore_share + hind_share > 1e-6, limb / np.maximum(fore_share + hind_share, 1e-6), 0.0)
    add(sided("scapula"), trunk * scale * np.where(hum >= scap, 0.0, scap))
    add(sided("humerus"), trunk * scale * np.where(hum >= scap, hum, 0.0))
    add(sided("femur"), trunk * scale * np.where(tib > fem, 0.0, fem))
    add(sided("tibia"), trunk * scale * np.where(tib > fem, tib, 0.0))
    spine = _chain(z, [-0.42, -0.05, 0.28])
    rest = trunk * (1.0 - limb)
    add("pelvis", rest * spine[:, 0])
    add("root", rest * spine[:, 1])
    add("chest", rest * spine[:, 2])

    # ── The legs: rigid segments with narrow blends at the joints ──
    front = np.isin(rigged, (REGIONS["frontLeft"], REGIONS["frontRight"]))
    hind = np.isin(rigged, (REGIONS["hindLeft"], REGIONS["hindRight"]))
    e = _below(y, joint("forearmL")[1], 0.05)
    k = _below(y, joint("foreCannonL")[1], 0.04)
    f = _below(y, joint("forePasternL")[1], 0.04)
    c = _below(y, joint("foreHoofL")[1] + 0.012, 0.014)
    fr = r * front
    add(sided("humerus"), fr * (1.0 - e))
    add(sided("forearm"), fr * e * (1.0 - k))
    add(sided("foreCannon"), fr * k * (1.0 - f))
    add(sided("forePastern"), fr * f * (1.0 - c))
    add(sided("foreHoof"), fr * c)
    hock_y, hock_z = joint("hindCannonL")[1], joint("hindCannonL")[2]
    st = _below(y, joint("tibiaL")[1], 0.06)
    # The point of the hock (the calcaneus, behind and above the joint) goes with the cannon.
    hk = np.maximum(_below(y, hock_y, 0.045),
                    _smoothstep(hock_z - 0.02, hock_z - 0.06, z) * _below(y, hock_y + 0.085, 0.025))
    hf = _below(y, joint("hindPasternL")[1], 0.04)
    hc = _below(y, joint("hindHoofL")[1] + 0.012, 0.014)
    hr = r * hind
    add(sided("femur"), hr * (1.0 - st))
    add(sided("tibia"), hr * st * (1.0 - hk))
    add(sided("hindCannon"), hr * hk * (1.0 - hf))
    add(sided("hindPastern"), hr * hf * (1.0 - hc))
    add(sided("hindHoof"), hr * hc)

    # ── The neck along its bones, the head whole beyond the atlas, the jowls with the jaw ──
    neck = rigged == REGIONS["neck"]
    R = landmarks["rig"]
    (base_y, base_z), (top_y, top_z) = R["neckAxis"]
    axis = np.array([top_y - base_y, top_z - base_z])
    progress = ((y - base_y) * axis[0] + (z - base_z) * axis[1]) / (axis @ axis)
    # (The plane parts the head from the neck only as deep as the head goes: below the jowls, in the
    # head's own frame, the throat is the neck's.)
    rel = positions - POLL
    s = (rel @ HEAD_FORWARD) / HEAD_SCALE
    t = (rel @ HEAD_UP) / HEAD_SCALE
    head_side = _smoothstep(-0.1, 0.1, _plane_distance(positions, *R["headPlane"])) * _smoothstep(-0.42, -0.32, t)
    chain = _chain(progress, [-0.1, 0.38, 0.72, 1.0])
    head_w = np.maximum(chain[:, 3], head_side)
    neck_w = chain[:, :3] * (1.0 - head_w)[:, None]
    jaw_line = -0.095 - (s - 0.10) * (0.015 / 0.42)
    # (Below the jaw line, but no lower than the jaw's own edge: the throat under it is the neck's.)
    jaw = (_smoothstep(jaw_line + 0.014, jaw_line - 0.014, t) * _smoothstep(-0.36, -0.28, t)
           * _smoothstep(0.0, 0.07, s) * head_w)
    leaf_parts = np.array([leaf.part for leaf in leaves])
    ear_leaf = np.array([getattr(leaf, "ear", False) for leaf in leaves])
    ear_distance = distances[:, ear_leaf].min(axis=1)
    head_distance = distances[:, (leaf_parts == REGIONS["neck"]) & ~ear_leaf].min(axis=1)
    ear = _smoothstep(-0.004, 0.02, head_distance - ear_distance) * head_w
    nr = r * neck
    add("neck0", nr * neck_w[:, 0])
    add("neck1", nr * neck_w[:, 1])
    add("neck2", nr * neck_w[:, 2])
    add("head", nr * np.maximum(0.0, head_w - jaw - ear))
    add("jaw", nr * jaw)
    add(sided("ear"), nr * ear)

    # ── The tail down its chain ──
    tail = rigged == REGIONS["tail"]
    heights = [joint("tail%d" % i)[1] for i in range(6)]
    tail_chain = _chain(-y, [-h for h in heights])
    for i in range(6):
        add("tail%d" % i, r * tail * tail_chain[:, i])

    # Smoothed over the mesh, so no edge spans a jump in what its ends follow (a short edge across
    # one would stretch many times its length); each side's limbs stay on their own side.
    neighbours = _neighbours(count, triangles)
    rigid = W.copy()
    for _ in range(smoothing):
        W = 0.5 * W + 0.5 * np.stack([W[around].mean(axis=0) if len(around) else W[v]
                                      for v, around in enumerate(neighbours)])
    # (Below the elbows the legs keep their own joints' blends, and the horn of the hoof stays rigid on
    # its bone; a trace left far from its bone is dropped.)
    keep = _smoothstep(0.5, 0.66, y)[:, None]
    W = rigid * (1.0 - keep) + W * keep
    W = np.where(W < 0.02 * W.max(axis=1, keepdims=True), 0.0, W)
    sides = np.array([1.0 if name.endswith("L") else -1.0 if name.endswith("R") else 0.0 for name, _p, _h in BONES])
    wrong_side = (sides[None, :] * x[:, None]) < -0.02
    W = np.where(wrong_side, 0.0, W)
    # Four bones a vertex: the heaviest, renormalised.
    order = np.argsort(-W, axis=1)[:, :4]
    picked = np.take_along_axis(W, order, axis=1)
    picked = np.where(picked > 1e-3, picked, 0.0)
    total = picked.sum(axis=1, keepdims=True)
    picked = np.where(total > 1e-6, picked / np.maximum(total, 1e-6), np.array([[1.0, 0.0, 0.0, 0.0]]))
    order = np.where(total > 1e-6, order, BONE_INDEX["root"])
    # Quantise to bytes that sum to exactly 255 (the remainder to the heaviest).
    quantised = np.round(picked * 255.0).astype(np.int64)
    quantised[:, 0] += 255 - quantised.sum(axis=1)
    indices = np.where(quantised > 0, order, 0).astype(np.uint8)
    return indices, quantised.astype(np.uint8), rigged


# -- posing (the runtime's skinning, for previews and checks) ------------------------------
def rotation(rx=0.0, ry=0.0, rz=0.0):
    """Ry . Rz . Rx: pitch about the bone's x first, then roll, then yaw (the runtime's order)."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, sz, 0], [-sz, cz, 0], [0, 0, 1]])
    return Ry @ Rz @ Rx


def pose_bones(local, offset=(0.0, 0.0, 0.0)):
    """Skinning matrices (B x 3 x 4) for local rotations {bone: (rx, ry, rz)} and a root offset."""
    count = len(BONES)
    world_r = np.zeros((count, 3, 3))
    world_t = np.zeros((count, 3))
    for index, (name, _parent, head) in enumerate(BONES):
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


def skin_vertices(positions, normals, indices, weights, matrices):
    w = weights.astype(np.float64) / 255.0
    out_p = np.zeros_like(positions)
    out_n = np.zeros_like(normals)
    for k in range(4):
        M = matrices[indices[:, k]]
        out_p += w[:, k:k + 1] * (np.einsum("nij,nj->ni", M[:, :, :3], positions) + M[:, :, 3])
        out_n += w[:, k:k + 1] * np.einsum("nij,nj->ni", M[:, :, :3], normals)
    return out_p, out_n / np.maximum(np.linalg.norm(out_n, axis=1), 1e-9)[:, None]


# -- the build ----------------------------------------------------------------------------
class Horse:
    def __init__(self, positions, normals, colors, masks, triangles, parts, bones, weights, stats, landmarks):
        self.positions, self.normals, self.colors, self.masks = positions, normals, colors, masks
        self.triangles, self.parts, self.bones, self.weights, self.stats = triangles, parts, bones, weights, stats
        self.landmarks = landmarks

    def measures(self):
        body = self.positions[self.parts == REGIONS["body"]]
        # The withers: the highest coat (not the mane) over the shoulders.
        coat = self.positions[(self.colors[:, 0] < 0.5) & (self.colors[:, 1] < 0.5)]
        withers = coat[(coat[:, 2] > 0.15) & (coat[:, 2] < 0.35)]
        return dict(withersHeight=float(withers[:, 1].max()), bodyLength=float(np.ptp(body[:, 2])),
                    length=float(np.ptp(self.positions[:, 2])), height=float(self.positions[:, 1].max()))

    def skeleton(self):
        return [dict(name=name, parent=int(BONE_PARENTS[index]), head=[round(float(v), 4) for v in head])
                for index, (name, _parent, head) in enumerate(BONES)]

    def record(self):
        return dict(name=NAME, breed=BREED, triangles=int(len(self.triangles)), vertices=int(len(self.positions)),
                    bones=len(BONES), **{key: round(value, 4) for key, value in self.measures().items()})


def build(studio, voxel=VOXEL, target=TARGET_TRIANGLES):
    """Polygonise and decimate the left half, mirror it, then paint and skin the whole horse."""
    started = time.time()
    shape, landmarks = design()
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    sampled = time.time()
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    netted = time.time()
    positions, triangles = decimate(studio, dense, dense_triangles, target // 2)
    decimated = len(triangles)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    # The soles stand exactly on the ground.
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    # A sliver whose corners' normals turn against its own face (where the field creases faster than
    # the mesh) takes the mesh's normals at its corners.
    for _ in range(3):
        a, b, c = (positions[triangles[:, i]] for i in range(3))
        summed = normals[triangles[:, 0]] + normals[triangles[:, 1]] + normals[triangles[:, 2]]
        inward = (np.cross(b - a, c - a) * summed).sum(axis=1) <= 0.0
        if not inward.any():
            break
        corners = np.unique(triangles[inward])
        usable = np.linalg.norm(flat[corners], axis=1) > 0.5
        normals[corners[usable]] = flat[corners[usable]]
        if not usable.all():
            # (Where the mesh's own normal cancels out, the triangle's face decides.)
            face = np.cross(b - a, c - a)[inward]
            for t, tri in enumerate(triangles[inward]):
                for v in tri:
                    if np.linalg.norm(flat[v]) <= 0.5:
                        normals[v] = face[t] / max(np.linalg.norm(face[t]), 1e-12)
    parts, distances = regions(shape, landmarks, positions, triangles)
    colors, masks = paint(shape, landmarks, positions, normals, parts, distances)
    bones, weights, parts = skin(landmarks, positions, distances, shape.leaves(), parts, triangles)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_vertices=len(dense), dense_triangles=len(dense_triangles),
                 half_triangles=decimated, vertices=len(positions), triangles=len(triangles), folds=folds,
                 mesh_normals=int(disagree.sum()), field_s=sampled - started, nets_s=netted - sampled,
                 total_s=time.time() - started)
    point = lambda value: [round(float(v), 4) for v in value]  # noqa: E731
    shading = dict(
        muzzle=point(landmarks["muzzle"]),
        eyes=[point(p) for p in landmarks["eye_poles"]],
        nostrils=[point(p) for p in landmarks["nostrils"]],
        headForward=point(HEAD_FORWARD), headUp=point(HEAD_UP),
    )
    horse = Horse(positions, normals, colors, masks, triangles, parts, bones, weights, stats, shading)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s horse grid %s half dense %d tris -> %d -> mirrored %d tris %d verts (%d folds, %d mesh normals); "
          "x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s  field %.1fs nets %.1fs total %.1fs" % (
              TAG, "x".join(str(n) for n in stats["grid"]), stats["dense_triangles"], stats["half_triangles"],
              stats["triangles"], stats["vertices"], stats["folds"], stats["mesh_normals"],
              low[0], high[0], low[1], high[1], low[2], high[2],
              {key: round(value, 3) for key, value in horse.measures().items()}, stats["field_s"], stats["nets_s"],
              stats["total_s"]), flush=True)
    return horse


def write(path, horse, generator, schema_version):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=generator)
    writer.add_mesh("horse", {
        "POSITION": (horse.positions, False),
        "NORMAL": (glb.quantize_unit(horse.normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(horse.colors, np.uint8), True),
        "_MASK": (glb.quantize_unit(horse.masks, np.uint8), True),
        "_BONES": (horse.bones, False),
        "_WEIGHTS": (horse.weights, True),
    }, indices=horse.triangles)
    low, high = horse.positions.min(axis=0), horse.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=schema_version, **horse.record(),
        skeleton=horse.skeleton(),
        color={"r": "hair (mane, forelock, tail, feathers)", "g": "points (the legs below the knees and hocks)",
               "b": "light (belly, muzzle, round the eyes)", "a": "ambient occlusion"},
        mask={"r": "hoof", "g": "dark skin (nostrils, lips)", "b": "hair's freedom (0 root, 1 tip)",
              "a": "the inside of the ears"},
        landmarks=horse.landmarks,
        skin={"_BONES": "four bone indices", "_WEIGHTS": "their weights (sum 1)",
              "pose": "each bone rests aligned with the horse's axes; a pose turns it about its head"},
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


# -- previews (never shipped) -------------------------------------------------------------
COAT = np.array([0.16, 0.065, 0.025])       # bay
POINTS = np.array([0.018, 0.012, 0.01])     # black mane, tail and legs
MEALY = np.array([0.3, 0.2, 0.12])          # the pale muzzle and belly
HOOF = np.array([0.05, 0.045, 0.04])
EYE = np.array([0.01, 0.008, 0.008])
SKIN = np.array([0.03, 0.025, 0.025])
REGION_COLOURS = np.array([
    (0.5, 0.5, 0.5), (0.85, 0.22, 0.04), (0.08, 0.25, 0.9), (0.05, 0.7, 0.8),
    (0.15, 0.65, 0.12), (0.85, 0.72, 0.05), (0.7, 0.12, 0.7),
])

# Test poses (local rotations, radians): the skin must fold cleanly at every joint.
POSES = {
    "gallop-reach": dict(
        chest=(-0.06, 0, 0), pelvis=(0.08, 0, 0), neck0=(0.25, 0, 0), neck1=(0.1, 0, 0), head=(-0.15, 0, 0),
        scapulaL=(-0.22, 0, 0), humerusL=(-0.35, 0, 0), forearmL=(-0.45, 0, 0), foreCannonL=(0.35, 0, 0),
        forePasternL=(0.15, 0, 0),
        scapulaR=(0.15, 0, 0), humerusR=(0.2, 0, 0), forearmR=(-0.9, 0, 0), foreCannonR=(1.9, 0, 0),
        forePasternR=(0.9, 0, 0),
        femurL=(0.45, 0, 0), tibiaL=(0.15, 0, 0), hindCannonL=(0.25, 0, 0), hindPasternL=(0.2, 0, 0),
        femurR=(0.2, 0, 0), tibiaR=(0.35, 0, 0), hindCannonR=(-0.8, 0, 0), hindPasternR=(0.9, 0, 0),
        tail0=(0.9, 0, 0), tail1=(0.3, 0, 0), tail2=(0.25, 0, 0), tail3=(0.2, 0, 0), tail4=(0.15, 0, 0),
        earL=(0.4, 0, 0.2), earR=(0.4, 0, -0.2),
    ),
    "gallop-gathered": dict(
        chest=(0.06, 0, 0), pelvis=(-0.1, 0, 0), neck0=(-0.1, 0, 0), head=(0.1, 0, 0),
        humerusL=(0.15, 0, 0), forearmL=(-0.7, 0, 0), foreCannonL=(1.6, 0, 0), forePasternL=(0.8, 0, 0),
        humerusR=(0.25, 0, 0), forearmR=(-0.4, 0, 0), foreCannonR=(1.0, 0, 0), forePasternR=(0.6, 0, 0),
        femurL=(-0.55, 0, 0), tibiaL=(0.35, 0, 0), hindCannonL=(-0.9, 0, 0), hindPasternL=(0.7, 0, 0),
        femurR=(-0.45, 0, 0), tibiaR=(0.3, 0, 0), hindCannonR=(-0.7, 0, 0), hindPasternR=(0.5, 0, 0),
        tail0=(0.6, 0, 0), tail1=(0.25, 0, 0), tail2=(0.2, 0, 0),
    ),
    "graze": dict(
        neck0=(0.5, 0.1, 0), neck1=(0.45, 0.08, 0), neck2=(0.35, 0.05, 0), head=(0.3, 0, 0), jaw=(0.12, 0.02, 0),
        humerusL=(-0.12, 0, 0), forearmL=(0.0, 0, 0), earL=(0.3, 0, 0.35), earR=(0.0, 0, -0.1),
        tail0=(0.1, 0.25, 0), tail1=(0, 0.2, 0), tail2=(0, 0.15, 0),
    ),
    "rest": dict(
        pelvis=(0.0, 0, 0.05), neck0=(0.35, 0, 0), neck1=(0.12, 0, 0), head=(0.3, 0, 0), jaw=(0.04, 0, 0),
        femurR=(-0.08, 0, 0), tibiaR=(0.05, 0, 0), hindCannonR=(-0.32, 0, 0), hindPasternR=(1.0, 0, 0),
        hindHoofR=(0.35, 0, 0), earL=(0.15, 0, 0.75), earR=(0.15, 0, -0.75),
    ),
}


def _coat(colors, masks, positions=None, landmarks=None):
    hair, points, light, ao = (colors[:, i:i + 1] for i in range(4))
    hoof, skin_mask, ear = masks[:, 0:1], masks[:, 1:2], masks[:, 3:4]
    eye = np.zeros_like(hoof)
    if positions is not None and landmarks:
        pole = np.min([np.linalg.norm(positions - np.array(p), axis=1) for p in landmarks["eyes"]], axis=0)
        eye = _smoothstep(0.03, 0.018, pole)[:, None]
    coat = COAT * (1.0 - light) + MEALY * light
    coat = coat * (1.0 - np.maximum(hair, points)) + POINTS * np.maximum(hair, points)
    coat = coat * (1.0 - skin_mask) + SKIN * skin_mask
    coat = coat * (1.0 - hoof) + HOOF * hoof
    coat = coat * (1.0 - eye) + EYE * eye
    coat = coat * (1.0 - 0.7 * ear)
    return coat * (0.35 + 0.65 * ao)


def _turned(points, heading_degrees, offset=(0.0, 0.0, 0.0)):
    """Rotate about y so the horse's +z turns `heading_degrees` toward +x, then move it."""
    angle = math.radians(heading_degrees)
    c, s = math.cos(angle), math.sin(angle)
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    return np.stack([x * c + z * s, y, -x * s + z * c], axis=1) + np.asarray(offset)


def previews(horse, directory):
    import bpy
    from mathutils import Vector
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    started = time.time()
    lights = []

    def horse_object(name, colours, heading=0.0, offset=(0.0, 0.0, 0.0), material=None, positions=None,
                     normals=None):
        positions = horse.positions if positions is None else positions
        normals = horse.normals if normals is None else normals
        obj = studio.mesh_object(name, _turned(positions, heading, offset), horse.triangles, colors=colours)
        obj.data.normals_split_custom_set_from_vertices([tuple(n) for n in to_blender(_turned(normals, heading))])
        obj.data.materials.append(material or studio.material(name, roughness=0.72))
        return obj

    def flat(name, colour):
        material = studio.track(bpy.data.materials.new(studio_module.PREFIX + name))
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        nodes.clear()
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = (*colour, 1.0)
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(emission.outputs["Emission"], output.inputs["Surface"])
        return material

    def quad(name, corners, material):
        obj = studio.mesh_object(name, np.asarray(corners, dtype=np.float64), np.array([[0, 1, 2], [0, 2, 3]]))
        obj.data.materials.append(material)
        return obj

    def sky(colour, strength):
        world = studio.scene.world
        world.use_nodes = True
        background = world.node_tree.nodes["Background"]
        background.inputs["Color"].default_value = (*colour, 1.0)
        background.inputs["Strength"].default_value = strength

    def sun(toward, strength, colour=(1.0, 0.82, 0.6)):
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        lights.clear()
        data = bpy.data.lights.new(studio_module.PREFIX + "horse_sun", "SUN")
        data.energy = strength
        data.color = colour
        data.angle = math.radians(2.0)
        light = bpy.data.objects.new(studio_module.PREFIX + "horse_sun", data)
        studio.scene.collection.objects.link(light)
        direction = _unit(to_blender(np.array([toward]))[0])
        light.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
        lights.append(light)

    def remove(objects):
        for obj in objects:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)

    try:
        ground_material = studio.material("horse_ground", roughness=1.0)
        extent = 40.0
        ground = studio.mesh_object("horse_ground", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([[0.32, 0.25, 0.12]], (4, 1)))
        ground.data.materials.append(ground_material)
        coat_colours = _coat(horse.colors, horse.masks, horse.positions, horse.landmarks)
        coat = horse_object("horse_coat", coat_colours)
        sky((0.55, 0.6, 0.68), 0.8)
        sun((0.55, 0.62, 0.55), 3.6)
        studio.render(directory / "horse-side.png", eye=(6.0, 1.0, 0.3), target=(0.0, 0.98, 0.3), lens=52.0,
                      size=(1400, 900), samples=32)
        studio.render(directory / "horse-three-quarter.png", eye=(4.3, 1.5, 4.5), target=(0.0, 0.95, 0.25),
                      lens=48.0, size=(1200, 1000), samples=32)
        studio.render(directory / "horse-head.png", eye=(1.5, 1.95, 2.6), target=(0.0, 1.6, 1.1), lens=50.0,
                      size=(900, 900), samples=32)
        studio.render(directory / "horse-head-side.png", eye=(2.2, 1.6, 1.2), target=(0.0, 1.55, 1.2), lens=50.0,
                      size=(900, 900), samples=32)
        studio.render(directory / "horse-head-front.png", eye=(0.25, 1.75, 3.2), target=(0.0, 1.55, 1.2), lens=60.0,
                      size=(900, 900), samples=32)
        studio.render(directory / "horse-rear.png", eye=(-3.2, 1.6, -4.4), target=(0.0, 0.95, -0.2), lens=48.0,
                      size=(1000, 900), samples=32)
        # Against the light: the sun low behind the horse, a pale sky.
        sky((0.8, 0.8, 0.76), 1.0)
        sun((-0.92, 0.2, 0.2), 5.0, colour=(1.0, 0.72, 0.42))
        studio.render(directory / "horse-backlit.png", eye=(6.3, 0.85, -0.6), target=(0.0, 1.12, 0.3), lens=48.0,
                      size=(1400, 900), samples=32)
        remove([coat])

        # The test poses through the runtime's own skinning.
        sky((0.55, 0.6, 0.68), 0.8)
        sun((0.55, 0.62, 0.55), 3.6)
        for name, local in POSES.items():
            posed, posed_normals = skin_vertices(horse.positions, horse.normals, horse.bones, horse.weights,
                                                 pose_bones(local))
            obj = horse_object("horse_" + name, coat_colours, positions=posed, normals=posed_normals)
            studio.render(directory / ("pose-%s.png" % name), eye=(6.0, 1.0, 0.3), target=(0.0, 0.95, 0.3),
                          lens=50.0, size=(1200, 800), samples=24)
            studio.render(directory / ("pose-%s-34.png" % name), eye=(4.0, 1.3, 4.2), target=(0.0, 0.85, 0.1),
                          lens=46.0, size=(1000, 860), samples=24)
            remove([obj])

        parts = horse_object("horse_parts", REGION_COLOURS[horse.parts])
        sky((0.6, 0.62, 0.66), 0.9)
        sun((0.5, 0.7, 0.6), 3.0, colour=(1.0, 1.0, 1.0))
        studio.render(directory / "horse-regions.png", eye=(4.4, 1.6, 4.4), target=(0.0, 0.9, 0.0), lens=46.0,
                      size=(1000, 860), samples=16)
        remove([parts])
        # Each vertex's heaviest bone, in a colour of its own.
        palette = np.array([[(math.sin(i * 2.4) * 0.5 + 0.5), (math.sin(i * 1.7 + 2.0) * 0.5 + 0.5),
                             (math.sin(i * 3.1 + 4.0) * 0.5 + 0.5)] for i in range(len(BONES))]) * 0.85 + 0.05
        blended = sum(palette[horse.bones[:, k]] * (horse.weights[:, k:k + 1] / 255.0) for k in range(4))
        bones = horse_object("horse_bones", blended)
        studio.render(directory / "horse-bones.png", eye=(4.4, 1.6, 4.4), target=(0.0, 0.9, 0.0), lens=46.0,
                      size=(1000, 860), samples=16)
        studio.render(directory / "horse-bones-rear.png", eye=(-4.2, 1.4, -4.6), target=(0.0, 0.9, -0.1),
                      lens=46.0, size=(1000, 860), samples=16)
        remove([bones])
        masked = horse_object("horse_masks", np.clip(horse.masks[:, [0, 1, 3]] * 0.85 + horse.masks[:, 2:3] * 0.4,
                                                     0, 1) + 0.05)
        studio.render(directory / "horse-masks.png", eye=(1.5, 1.95, 2.6), target=(0.0, 1.6, 1.1), lens=50.0,
                      size=(900, 900), samples=16)
        remove([masked])
        occluded = horse_object("horse_ao", np.repeat(horse.colors[:, 3:4], 3, axis=1) * 0.8)
        studio.render(directory / "horse-ao.png", eye=(4.4, 0.9, 3.6), target=(0.0, 0.95, 0.25), lens=46.0,
                      size=(1000, 760), samples=16)
        remove([occluded])

        # The herd as the camera sees it: thirty metres off, the barley 0.95 m tall in front.
        remove([ground])
        black = flat("horse_black", (0.012, 0.01, 0.01))
        barley = flat("horse_barley", (0.6, 0.47, 0.22))
        herd = [horse_object("horse_herd_%d" % index, np.zeros((len(horse.positions), 3)), heading=heading,
                             offset=(0.0, 0.0, offset), material=black)
                for index, (heading, offset) in enumerate(((0.0, -5.4), (40.0, -1.8), (140.0, 1.8), (90.0, 5.4)))]
        band = quad("horse_barley_band", [[1.6, 0.0, -30.0], [1.6, 0.0, 30.0], [1.6, 0.95, 30.0], [1.6, 0.95, -30.0]],
                    barley)
        sky((0.8, 0.81, 0.8), 1.0)
        studio.render(directory / "horse-silhouette-barley.png", eye=(30.0, 1.7, 0.0), target=(0.0, 1.05, 0.0),
                      lens=36.0 * 30.0 / 15.0, size=(1600, 520), samples=16)
        remove(herd + [band])
    finally:
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        studio.dispose()
    print("%s horse previews in %s  %.1fs" % (TAG, directory, time.time() - started), flush=True)
