"""Fall's red squirrel: its skeleton, its body as a distance field, the mesh, skin weights and coat.

A Eurasian red squirrel in its autumn coat, drawn a little toward the storybook: a rusty back,
a cream belly with a clean line along the flanks, a big round head with large dark eyes in a pale
ring, long ear tufts, and a plume of a tail as long as the body. It is made the way the Grainfields
horse and Winter's bear are (scripts/blender/grainfields/horse_sdf.py): ellipsoids and round cones
joined by smooth unions round the rig's own joints, the left half polygonised with surface nets,
decimated in Blender (the face kept finer than the plume), cleaned of folds and mirrored, so the
squirrel is exactly symmetric. The plume is built of locks of hair, so its outline is a run of soft
points rather than a smooth sausage.

Frame: metres at life size (the theme draws it larger), glTF axes: +z forward (toward the nose),
+y up, +x the squirrel's left; the paws stand on y = 0. Nothing here imports bpy at module level, so
the field and the weights can be built and checked anywhere numpy runs.
"""

import math

import numpy as np

from grainfields.horse_sdf import (
    Displace, Ellipsoid, HalfSpace, RoundCone, Tube, Union,
    _grid, _neighbours, _smoothstep, _unit, collapse_bad, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)

TAG = "[fall-squirrel]"
VOXEL = 0.0014
TARGET_TRIANGLES = 10000

PARTS = {
    "body": 0, "head": 1, "jaw": 2, "earL": 3, "earR": 4, "eye": 5, "tail": 6,
    "frontL": 7, "frontR": 8, "hindL": 9, "hindR": 10, "nose": 11,
}


def P(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


def _mirror_x(p):
    return P(-p[0], p[1], p[2])


# -- the skeleton (bind pose) -------------------------------------------------------------
# Standing on all fours, alert: the hind legs folded under big haunches (hip, knee forward,
# heel back, the long foot flat), the forelegs straight under the chest, the head up, and the tail
# held straight back and up (the clips curl it). Every bone's rest frame is the squirrel's own
# (x left, y up, z forward), so a clip's rotations are about the animal's axes.
TAIL_BASE = P(0.0, 0.072, -0.086)
TAIL_DIR = _unit((0.0, 0.6, -0.8))
TAIL_STEP = 0.033
TAIL_BONES = 7
# The plume's radius at each tail joint (and the tip), and its core's.
PLUME = [0.012, 0.022, 0.031, 0.037, 0.0395, 0.038, 0.032, 0.018]
CORE = [0.0085, 0.012, 0.0155, 0.0175, 0.018, 0.017, 0.014, 0.008]


def _tail_joint(i):
    return TAIL_BASE + TAIL_DIR * (TAIL_STEP * i)


def skeleton():
    """[(name, parent, head, tip)]: `head` is the joint; `tip` ends the segment the bone weights."""
    bones = [
        ("root", None, P(0.0, 0.0, 0.0), P(0.0, 0.066, -0.050)),
        ("hips", "root", P(0.0, 0.066, -0.050), P(0.0, 0.075, -0.010)),
        ("spine", "hips", P(0.0, 0.075, -0.010), P(0.0, 0.076, 0.027)),
        ("chest", "spine", P(0.0, 0.076, 0.027), P(0.0, 0.083, 0.054)),
        ("neck", "chest", P(0.0, 0.083, 0.054), P(0.0, 0.097, 0.070)),
        ("head", "neck", P(0.0, 0.097, 0.070), P(0.0, 0.095, 0.127)),
        ("jaw", "head", P(0.0, 0.090, 0.088), P(0.0, 0.085, 0.113)),
    ]
    for side, sfx in ((1.0, "L"), (-1.0, "R")):
        def S(x, y, z, side=side):
            return P(side * x, y, z)
        bones.append(("ear" + sfx, "head", S(0.0145, 0.117, 0.071), S(0.024, 0.163, 0.062)))
    for i in range(TAIL_BONES):
        bones.append(("tail%d" % i, "hips" if i == 0 else "tail%d" % (i - 1), _tail_joint(i), _tail_joint(i + 1)))
    for side, sfx in ((1.0, "L"), (-1.0, "R")):
        def S(x, y, z, side=side):
            return P(side * x, y, z)
        bones += [
            ("shoulder" + sfx, "chest", S(0.010, 0.080, 0.030), S(0.020, 0.055, 0.035)),
            ("arm" + sfx, "shoulder" + sfx, S(0.020, 0.055, 0.035), S(0.021, 0.033, 0.029)),
            ("fore" + sfx, "arm" + sfx, S(0.021, 0.033, 0.029), S(0.019, 0.011, 0.041)),
            ("hand" + sfx, "fore" + sfx, S(0.019, 0.011, 0.041), S(0.019, 0.003, 0.057)),
            ("thigh" + sfx, "hips", S(0.020, 0.062, -0.052), S(0.030, 0.040, -0.024)),
            ("shin" + sfx, "thigh" + sfx, S(0.030, 0.040, -0.024), S(0.028, 0.0135, -0.067)),
            ("foot" + sfx, "shin" + sfx, S(0.028, 0.0135, -0.067), S(0.026, 0.003, -0.020)),
        ]
    return bones


def joints():
    return {name: head for name, _parent, head, _tip in skeleton()}


def tips():
    return {name: tip for name, _parent, _head, tip in skeleton()}


# -- fur ----------------------------------------------------------------------------------
def _coat(x, y, z):
    """Short tufts over the body: a few interfering waves, about -1..1 (scaled to a squirrel)."""
    return (0.5 * np.sin(x * 260.0 + 1.3 * np.sin(z * 110.0)) * np.sin(y * 230.0 + 0.7) * np.sin(z * 190.0 + x * 60.0)
            + 0.3 * np.sin(x * 520.0 + y * 340.0) * np.sin(z * 450.0 - y * 140.0)
            + 0.2 * np.sin(y * 780.0 + z * 320.0) * np.sin(x * 690.0 + 2.1))


def _tail_frame():
    across = np.array([1.0, 0.0, 0.0])
    back = _unit(np.cross(TAIL_DIR, across))  # the tail's dorsal side, square to its length
    return across, back


def _tail_station(s):
    """Where on the tail's axis, and its plume and core radius, `s` metres from the root."""
    f = float(np.clip(s / TAIL_STEP, 0.0, TAIL_BONES))
    i = int(min(TAIL_BONES - 1, math.floor(f)))
    t = f - i
    plume = PLUME[i] * (1.0 - t) + PLUME[i + 1] * t
    core = CORE[i] * (1.0 - t) + CORE[i + 1] * t
    return TAIL_BASE + TAIL_DIR * s, plume, core


def _plume_radius(s):
    f = np.clip(np.asarray(s, dtype=np.float64) / TAIL_STEP, 0.0, TAIL_BONES - 1e-6)
    i = np.floor(f).astype(np.int64)
    t = f - i
    radii = np.array(PLUME)
    return radii[i] * (1.0 - t) + radii[i + 1] * t


def _hash(*values):
    x = math.sin(sum(v * k for v, k in zip(values, (127.1, 311.7, 74.7, 269.5)))) * 43758.5453
    return x - math.floor(x)


def tail_locks():
    """The plume as locks of hair, laid like a feather: broad soft locks leave the core on each side and
    sweep back toward the tip, a smaller run along its top and underside, and a brush at the end. Their
    rounded ends make a scalloped outline (a storybook squirrel's tail) rather than a smooth sausage."""
    across, back = _tail_frame()
    locks = []
    length = TAIL_STEP * TAIL_BONES
    # The side locks, the two sides out of step.
    for side in (1.0, -1.0):
        s = 0.010 + (0.0075 if side < 0 else 0.0)
        n = 0
        while s < length - 0.03:
            centre, plume, core = _tail_station(s)
            lift = 0.55 * (_hash(n, side, 1.0) - 0.5)
            radial = _unit(across * side + back * lift)
            direction = _unit(radial + TAIL_DIR * (1.05 + 0.3 * _hash(n, side, 2.0)))
            base = centre + radial * core * 0.2
            reach = plume * (1.25 + 0.25 * _hash(n, side, 3.0))
            width = 0.0062 + 0.0055 * min(1.0, plume / 0.037)
            locks.append(RoundCone(base, base + direction * reach, width, width * 0.5, squash=(back, 0.62)))
            s += 0.0115 + 0.003 * _hash(n, side, 4.0)
            n += 1
    # Along the top and the underside: shorter locks that give the plume its depth.
    for side in (1.0, -1.0):
        s = 0.02 + (0.006 if side < 0 else 0.0)
        n = 0
        while s < length - 0.035:
            centre, plume, core = _tail_station(s)
            sway = 0.5 * (_hash(n, side, 5.0) - 0.5)
            radial = _unit(back * side + across * sway)
            direction = _unit(radial + TAIL_DIR * 1.4)
            base = centre + radial * core * 0.2
            reach = plume * 0.95
            width = 0.0055 + 0.004 * min(1.0, plume / 0.037)
            locks.append(RoundCone(base, base + direction * reach, width, width * 0.55, squash=(across, 0.75)))
            s += 0.016
            n += 1
    # The tip: a soft brush of locks gathered to a rounded point.
    end, _plume_r, _core_r = _tail_station(length - 0.03)
    for k in range(7):
        a = k * 2.0 * math.pi / 7.0 + 0.3
        radial = across * math.cos(a) + back * (0.7 * math.sin(a))
        base = end + radial * 0.006
        locks.append(RoundCone(base, base + _unit(TAIL_DIR + radial * 0.5) * 0.034, 0.0105, 0.004,
                               squash=(back, 0.75)))
    return locks


def _plume(x, y, z):
    """Fine strands over the locks: long streaks along the tail, about -1..1."""
    across, back = _tail_frame()
    rel_x, rel_y, rel_z = x - TAIL_BASE[0], y - TAIL_BASE[1], z - TAIL_BASE[2]
    s = rel_x * TAIL_DIR[0] + rel_y * TAIL_DIR[1] + rel_z * TAIL_DIR[2]
    u = rel_x * across[0] + rel_y * across[1] + rel_z * across[2]
    v = rel_x * back[0] + rel_y * back[1] + rel_z * back[2]
    angle = np.arctan2(v, u)
    return 0.6 * np.sin(angle * 31.0 + 2.0 * np.sin(s * 40.0)) * np.sin(s * 120.0 + angle * 3.0) \
        + 0.4 * np.sin(angle * 53.0 - s * 70.0)


def _tufts(x, y, z):
    """The ear tufts: a few long wisps."""
    return np.sin(x * 900.0 + z * 400.0) * np.sin(y * 300.0)


# -- the squirrel -------------------------------------------------------------------------
EYE = P(0.0168, 0.1055, 0.0935)
EYE_RADII = (0.0066, 0.0079, 0.0079)
EYE_LOOK = _unit((0.78, 0.06, 0.62))
NOSE = P(0.0, 0.0955, 0.1225)


def design():
    """The squirrel as a distance field round its joints, and its landmarks."""
    J = joints()
    T = tips()
    # Trunk: haunches (big: a squirrel is all spring), a round belly, a deep chest, a short neck.
    body = Union([
        Ellipsoid(P(0.0, 0.063, -0.052), (0.031, 0.034, 0.037)),
        Ellipsoid(P(0.0, 0.067, -0.014), (0.029, 0.030, 0.035)),
        Ellipsoid(P(0.0, 0.071, 0.024), (0.025, 0.027, 0.029)),
        RoundCone(P(0.0, 0.077, 0.040), P(0.0, 0.092, 0.066), 0.020, 0.0175),
        # The haunch swells over each thigh.
        Ellipsoid(P(0.020, 0.056, -0.048), (0.017, 0.026, 0.031), along=(0.25, -0.55, 0.8)),
        Ellipsoid(P(-0.020, 0.056, -0.048), (0.017, 0.026, 0.031), along=(-0.25, -0.55, 0.8)),
        # A tuck of fur where the tail springs from the rump.
        Ellipsoid(P(0.0, 0.072, -0.083), (0.015, 0.016, 0.015)),
    ], k=0.016).tag(PARTS["body"])
    body = Displace(body, 0.0011, _coat)

    # Head: big and round (a squirrel's head is a third of its charm), full cheeks, a short blunt
    # muzzle and a button nose; the chin is the jaw's.
    cranium = Ellipsoid(P(0.0, 0.1035, 0.081), (0.0235, 0.0225, 0.0265)).tag(PARTS["head"])
    cheeks = Union([
        Ellipsoid(P(0.0135, 0.0905, 0.090), (0.0125, 0.0125, 0.0165)),
        Ellipsoid(P(-0.0135, 0.0905, 0.090), (0.0125, 0.0125, 0.0165)),
    ], k=0.006).tag(PARTS["head"])
    muzzle = RoundCone(P(0.0, 0.0975, 0.094), P(0.0, 0.0945, 0.117), 0.0145, 0.0080).tag(PARTS["head"])
    brow = Ellipsoid(P(0.0, 0.1115, 0.095), (0.014, 0.0085, 0.0145)).tag(PARTS["head"])
    chin = Ellipsoid(P(0.0, 0.0855, 0.101), (0.009, 0.0065, 0.0135)).tag(PARTS["jaw"])
    nose = Ellipsoid(NOSE, (0.0055, 0.0044, 0.0044)).tag(PARTS["nose"])
    head = Union([cranium, (cheeks, 0.012), (muzzle, 0.011), (brow, 0.01), (chin, 0.006), (nose, 0.004)], k=0.01)
    head = Displace(head, 0.0005, _coat)

    # Eyes: large, round, set to the sides and a little forward; they stand slightly proud.
    eyes = Union([
        Ellipsoid(EYE, EYE_RADII, along=EYE_LOOK),
        Ellipsoid(_mirror_x(EYE), EYE_RADII, along=EYE_LOOK * np.array([-1.0, 1.0, 1.0])),
    ]).tag(PARTS["eye"])

    # Ears: rounded leaves, cupped, each crowned with a long dark tuft (the autumn coat's).
    ears = []
    for side, part in ((1.0, PARTS["earL"]), (-1.0, PARTS["earR"])):
        base = P(side * 0.0135, 0.115, 0.072)
        top = P(side * 0.0182, 0.1315, 0.0695)
        leaf = RoundCone(base, top, 0.0078, 0.0056, squash=((0.0, 0.0, 1.0), 0.5))
        root = top + P(0.0, -0.002, 0.0)
        tuft = Union([
            Tube([root, P(side * 0.0200, 0.1445, 0.0665), P(side * 0.0222, 0.1585, 0.0625)],
                 [0.0050, 0.0040, 0.0013], squash_axis=(0.0, 0.0, 1.0), squash=0.75, k=0.003),
            Tube([root, P(side * 0.0158, 0.1435, 0.0675), P(side * 0.0142, 0.1535, 0.0655)],
                 [0.0040, 0.0030, 0.0011], squash_axis=(0.0, 0.0, 1.0), squash=0.75, k=0.003),
            Tube([root, P(side * 0.0245, 0.1415, 0.0675), P(side * 0.0285, 0.1500, 0.0645)],
                 [0.0038, 0.0028, 0.0011], squash_axis=(0.0, 0.0, 1.0), squash=0.75, k=0.003),
        ], k=0.003)
        ears.append(Union([leaf, (Displace(tuft, 0.0005, _tufts), 0.003)], k=0.003).tag(part))

    # Forelegs: straight under the chest, small paws turned a little in.
    front = []
    for side, sfx, part in ((1.0, "L", PARTS["frontL"]), (-1.0, "R", PARTS["frontR"])):
        shoulder, elbow, wrist, toes = J["arm" + sfx], J["fore" + sfx], J["hand" + sfx], T["hand" + sfx]
        upper = Ellipsoid(0.5 * (J["shoulder" + sfx] + shoulder) + P(side * 0.002, -0.005, 0.0),
                          (0.011, 0.017, 0.014), along=(0.2 * side, -1.0, 0.1))
        leg = Tube([shoulder, elbow, wrist], [0.0095, 0.0068, 0.0052], k=0.005)
        paw = Ellipsoid(0.55 * wrist + 0.45 * toes + P(0.0, -0.002, 0.0), (0.0062, 0.0040, 0.0105),
                        along=_unit(toes - wrist + P(0.0, 0.004, 0.0)))
        front.append(Union([upper, (leg, 0.007), (paw, 0.004)], k=0.006).tag(part))

    # Hind legs: a big thigh in the haunch; a slim shin to the heel, then the long flat foot.
    hind = []
    for side, sfx, part in ((1.0, "L", PARTS["hindL"]), (-1.0, "R", PARTS["hindR"])):
        knee, heel, toes = J["shin" + sfx], J["foot" + sfx], T["foot" + sfx]
        thigh = Ellipsoid(0.5 * (J["thigh" + sfx] + knee) + P(side * 0.003, 0.0, -0.004), (0.0145, 0.024, 0.0185),
                          along=_unit(knee - J["thigh" + sfx]))
        shin = Tube([knee, heel], [0.0085, 0.0056], k=0.004)
        foot = Ellipsoid(0.5 * (heel + toes) + P(0.0, -0.0028, 0.0), (0.0072, 0.0048, 0.0265),
                         along=_unit(toes - heel))
        hind.append(Union([thigh, (shin, 0.008), (foot, 0.006)], k=0.006).tag(part))

    # The tail: a slim core and the locks of the plume round it.
    stations = [_tail_joint(i) for i in range(TAIL_BONES + 1)]
    stations[-1] = stations[-1] - TAIL_DIR * 0.01
    core = Tube(stations, CORE, k=0.01)
    plume = Union([core] + [(lock, 0.009) for lock in tail_locks()], k=0.009)
    tail = Displace(plume, 0.0004, _plume).tag(PARTS["tail"])

    whole = Union([
        body, (head, 0.012), (eyes, 0.002), *[(ear, 0.004) for ear in ears], *[(leg, 0.012) for leg in front],
        *[(leg, 0.014) for leg in hind], (tail, 0.012),
    ])
    landmarks = dict(eyes=[EYE, _mirror_x(EYE)], eyeRadius=EYE_RADII[2], nose=NOSE, neck=J["neck"],
                     tailBase=TAIL_BASE)
    return whole, landmarks


# -- weights ------------------------------------------------------------------------------
def chains():
    """Which bones each part bends with, as (bone, segment start, segment end)."""
    J, T = joints(), tips()
    seg = lambda name: (name, J[name], T[name])  # noqa: E731
    out = {
        PARTS["body"]: [seg("hips"), seg("spine"), seg("chest"), seg("neck"),
                        ("head", J["head"], J["head"] + P(0.0, 0.004, 0.02))],
        PARTS["head"]: [("neck", J["neck"], J["head"]), seg("head")],
        PARTS["jaw"]: [("head", J["head"], J["jaw"]), seg("jaw")],
        PARTS["nose"]: [seg("head")],
        PARTS["eye"]: [seg("head")],
        PARTS["tail"]: [("hips", J["hips"], J["tail0"])] + [seg("tail%d" % i) for i in range(TAIL_BONES)],
    }
    for sfx in ("L", "R"):
        out[PARTS["ear" + sfx]] = [("head", J["head"], J["ear" + sfx]), seg("ear" + sfx)]
        out[PARTS["front" + sfx]] = [("chest", J["chest"], J["shoulder" + sfx]), seg("shoulder" + sfx),
                                    seg("arm" + sfx), seg("fore" + sfx), seg("hand" + sfx)]
        out[PARTS["hind" + sfx]] = [("hips", J["hips"], J["thigh" + sfx]), seg("thigh" + sfx), seg("shin" + sfx),
                                   seg("foot" + sfx)]
    return out


def _segment_distance(points, a, b):
    ab = b - a
    t = np.clip(((points - a) @ ab) / max(float(ab @ ab), 1e-12), 0.0, 1.0)
    return np.linalg.norm(points - (a + t[:, None] * ab[None, :]), axis=1)


def skin_weights(positions, triangles, parts, bone_names, smooth_passes=4, power=5.0):
    """(N, 4) bone indices and (N, 4) weights: each part's chain by inverse distance, smoothed over the
    mesh so the seams between parts bend together, at most four bones a vertex."""
    index = {name: i for i, name in enumerate(bone_names)}
    count = len(positions)
    dense = np.zeros((count, len(bone_names)))
    for part, chain in chains().items():
        rows = np.nonzero(parts == part)[0]
        if not len(rows):
            continue
        points = positions[rows]
        distances = np.stack([_segment_distance(points, a, b) for _name, a, b in chain], axis=1)
        w = 1.0 / np.maximum(distances, 0.0015) ** power
        w /= w.sum(axis=1, keepdims=True)
        for column, (name, _a, _b) in enumerate(chain):
            dense[rows, index[name]] += w[:, column]
    neighbours = _neighbours(count, triangles)
    for _ in range(smooth_passes):
        mean = np.stack([dense[around].mean(axis=0) if len(around) else dense[v] for v, around in enumerate(neighbours)])
        dense = 0.5 * dense + 0.5 * mean
    order = np.argsort(-dense, axis=1)[:, :4]
    weights = np.take_along_axis(dense, order, axis=1)
    weights[weights < 0.01] = 0.0
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
    return order.astype(np.int64), weights


# -- parts, occlusion and paint ----------------------------------------------------------
def regions(shape, positions):
    """The part of each vertex: that of the nearest primitive, legs kept to their own side."""
    leaves = shape.leaves()
    leaf_parts = np.array([leaf.part for leaf in leaves])
    best = np.full(len(positions), np.inf)
    parts = np.zeros(len(positions), dtype=np.int64)
    for leaf, part in zip(leaves, leaf_parts):
        d = leaf.eval(positions)
        closer = d < best
        best[closer] = d[closer]
        parts[closer] = part
    left = positions[:, 0] >= 0.0
    for a, b in (("frontL", "frontR"), ("hindL", "hindR"), ("earL", "earR")):
        parts = np.where((parts == PARTS[b]) & left, PARTS[a], parts)
        parts = np.where((parts == PARTS[a]) & ~left, PARTS[b], parts)
    return parts


def occlusion(shape, positions, normals, rays=40, reach=0.12, ground=0.6):
    """The share of the sky each vertex sees past the squirrel itself (and, partly, the ground)."""
    count = len(positions)
    k = np.arange(rays) + 0.5
    r = np.sqrt(k / rays)
    phi = k * math.pi * (3.0 - math.sqrt(5.0))
    local = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1.0 - r * r)], axis=1)
    helper = np.where(np.abs(normals[:, 1:2]) < 0.9, np.array([[0.0, 1.0, 0.0]]), np.array([[1.0, 0.0, 0.0]]))
    tangent = np.cross(helper, normals)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1), 1e-9)[:, None]
    bitangent = np.cross(normals, tangent)
    seen = np.zeros(count)
    start = positions + normals * 0.0012
    for d in local:
        direction = tangent * d[0] + bitangent * d[1] + normals * d[2]
        down = direction[:, 1] < -1e-6
        t_ground = np.where(down, start[:, 1] / np.maximum(-direction[:, 1], 1e-6), np.inf)
        t = np.full(count, 0.002)
        alive = np.ones(count, dtype=bool)
        blocked = np.zeros(count)
        for _ in range(28):
            if not alive.any():
                break
            rows = np.nonzero(alive)[0]
            p = start[rows] + direction[rows] * t[rows, None]
            field = shape.eval(p)
            hit = field < 0.0005
            blocked[rows[hit]] = 1.0
            t[rows] += np.maximum(field, 0.0012)
            grounded = ~hit & (t[rows] >= t_ground[rows]) & (t_ground[rows] < reach)
            blocked[rows[grounded]] = ground
            alive[rows[hit | grounded]] = False
            alive &= t < reach
        seen += 1.0 - blocked
    return np.clip(seen / rays, 0.0, 1.0)


def srgb(hex_colour):
    """A design colour (sRGB hex) as linear RGB."""
    c = np.array([(hex_colour >> 16) & 255, (hex_colour >> 8) & 255, hex_colour & 255], dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


COAT = dict(
    back=srgb(0x9c4419), rust=srgb(0xb8561f), flank=srgb(0xc56a2a), cream=srgb(0xf0e6d0), ring=srgb(0xeadcc0),
    eye=srgb(0x120b09), nose=srgb(0x3d2420), tuft=srgb(0x5e2410), tail=srgb(0xa9461a), tailTip=srgb(0xdb8a40),
    paw=srgb(0xc87a46), inner=srgb(0xd9a684),
)


def paint(shape, landmarks, positions, normals, parts):
    """COLOR_0 = the coat's linear RGB and the sky it sees; _fur = (fur length, light through it, eye, tuft)."""
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    nx, ny, nz = normals[:, 0], normals[:, 1], normals[:, 2]
    C = COAT
    albedo = np.tile(C["rust"], (len(positions), 1))
    trunk = np.isin(parts, (PARTS["body"], PARTS["head"], PARTS["jaw"]))

    def lay(colour, amount):
        nonlocal albedo
        amount = np.clip(amount, 0.0, 1.0)[:, None]
        albedo = albedo * (1.0 - amount) + colour * amount

    # Back darker along the spine, flanks warmer.
    lay(C["back"], _smoothstep(0.55, 0.95, ny) * _smoothstep(0.016, 0.0, np.abs(x)) * trunk)
    lay(C["flank"], 0.6 * _smoothstep(0.6, 0.1, ny) * trunk)
    # The cream underside: belly, chest and throat, the chin and the insides of the legs. The line on
    # the flanks is clean (a red squirrel's is).
    under = _smoothstep(-0.12, -0.42, ny) * (parts == PARTS["body"]) * _smoothstep(-0.075, -0.05, z)
    throat = (_smoothstep(0.35, 0.75, nz) * _smoothstep(0.02, -0.25, ny) * (parts == PARTS["body"])
              * _smoothstep(0.02, 0.04, z))
    chin = (parts == PARTS["jaw"]) * _smoothstep(0.3, -0.2, ny)
    lips = (parts == PARTS["head"]) * _smoothstep(0.104, 0.114, z) * _smoothstep(0.094, 0.088, y)
    legs = np.isin(parts, (PARTS["frontL"], PARTS["frontR"], PARTS["hindL"], PARTS["hindR"]))
    inner_leg = legs * _smoothstep(0.2, -0.6, nx * np.sign(x + 1e-9)) * _smoothstep(0.06, 0.03, y)
    lay(C["cream"], np.maximum.reduce([under, throat, chin, lips * 0.8, inner_leg * 0.75]))
    # Paws a lighter orange.
    paws = legs * _smoothstep(0.022, 0.008, y)
    lay(C["paw"], 0.7 * paws)
    # The pale ring round each eye, then the eye itself and the nose.
    eye_d = np.min([np.linalg.norm(positions - e, axis=1) for e in landmarks["eyes"]], axis=0)
    radius = landmarks["eyeRadius"]
    lay(C["ring"], (parts == PARTS["head"]) * _smoothstep(radius + 0.0045, radius + 0.0012, eye_d))
    eye = (parts == PARTS["eye"]).astype(np.float64)
    lay(C["eye"], eye)
    nose = (parts == PARTS["nose"]).astype(np.float64)
    lay(C["nose"], nose)
    # Ears: rust outside, a paler inside; the tufts dark, darkest at their tips.
    ear = np.isin(parts, (PARTS["earL"], PARTS["earR"]))
    tuft = ear * _smoothstep(0.131, 0.140, y)
    lay(C["inner"], 0.6 * ear * (1.0 - tuft) * _smoothstep(0.1, 0.6, nz))
    lay(C["tuft"] * 0.55, tuft * _smoothstep(0.148, 0.159, y))
    lay(C["tuft"], tuft * (1.0 - _smoothstep(0.148, 0.159, y)))
    # Tail: rust, the locks golden toward their tips (the outside of the plume).
    tail = (parts == PARTS["tail"]).astype(np.float64)
    rel = positions - TAIL_BASE
    s = rel @ TAIL_DIR
    out = np.linalg.norm(rel - s[:, None] * TAIL_DIR[None, :], axis=1) / np.maximum(_plume_radius(s), 1e-3)
    lock = _smoothstep(0.55, 1.1, out) * tail
    lay(C["tail"] * (0.85 + 0.15 * _smoothstep(0.02, 0.12, s))[:, None], tail * (1.0 - 0.6 * lock))
    lay(C["tailTip"], tail * 0.6 * lock)

    sky = occlusion(shape, positions, normals)
    # Fur: none on the eyes and nose, short on the face and paws, long on the tail and tufts.
    face = (parts == PARTS["head"]) * _smoothstep(0.088, 0.112, z)
    fur = 0.55 * np.ones(len(positions))
    fur = fur * (1.0 - 0.5 * face) * (1.0 - 0.6 * paws)
    fur = np.where(tail > 0.5, 0.75 + 0.25 * lock, fur)
    fur = np.where(tuft > 0.5, 1.0, fur)
    fur = fur * (1.0 - eye) * (1.0 - nose)
    # How much light gets through: thin ears and tufts most, the plume's locks, the rest a little.
    through = np.where(ear, 0.9, 0.25)
    through = np.where(tail > 0.5, 0.45 + 0.55 * lock, through)
    through = through * (1.0 - eye) * (1.0 - nose)
    colors = np.concatenate([np.clip(albedo, 0.0, 1.0), sky[:, None]], axis=1)
    fur_attr = np.stack([np.clip(fur, 0.0, 1.0), np.clip(through, 0.0, 1.0), eye, tuft.astype(np.float64)], axis=1)
    return colors, fur_attr


# -- building it ---------------------------------------------------------------------------
FACE = ("head", "jaw", "eye", "nose", "earL", "earR")
# Of the half's triangle budget, the share the face keeps (it reads in close-ups; the plume is lumps).
FACE_SHARE = 0.3


def _collapse(studio, positions, triangles, free, target):
    """Quadric edge collapse in Blender of the vertices marked `free` only, toward `target` triangles.

    (Blender's collapse never moves a vertex of weight 0 in its vertex group; partial weights did not
    spare a part in any useful measure, so the face and the rest are decimated in turn.)"""
    import bpy
    obj = studio.mesh_object("squirrel_dense", positions, triangles)
    group = obj.vertex_groups.new(name="free")
    group.add([int(i) for i in np.nonzero(free)[0]], 1.0, "REPLACE")
    modifier = obj.modifiers.new("decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = min(1.0, target / float(len(triangles)))
    modifier.use_collapse_triangulate = True
    modifier.vertex_group = "free"
    modifier.vertex_group_factor = 1.0
    depsgraph = studio.layer.depsgraph
    depsgraph.update()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    mesh.calc_loop_triangles()
    co = np.zeros(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    loops = np.zeros(len(mesh.loop_triangles) * 3, dtype=np.int64)
    mesh.loop_triangles.foreach_get("vertices", loops)
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(data)
    bpy.data.meshes.remove(mesh)
    # Blender (x, y back, z up) -> glTF (x, y up, z forward).
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1), loops.reshape(-1, 3)


def decimate(studio, shape, positions, triangles, target, face_share=FACE_SHARE):
    """The body, legs and plume decimated with the face held, then the face with the rest held."""
    face_parts = [PARTS[name] for name in FACE]

    def face_of(points, tris):
        parts = regions(shape, points)
        on_face = np.isin(parts, face_parts)
        # A triangle is the face's when all three of its corners are.
        return on_face, on_face[tris].all(axis=1)

    on_face, face_tris = face_of(positions, triangles)
    rest_target = int(target * (1.0 - face_share))
    positions, triangles = _collapse(studio, positions, triangles, ~on_face, int(face_tris.sum()) + rest_target)
    on_face, face_tris = face_of(positions, triangles)
    rest = len(triangles) - int(face_tris.sum())
    positions, triangles = _collapse(studio, positions, triangles, on_face, rest + int(target * face_share))
    return positions, triangles


class Squirrel:
    def __init__(self, positions, normals, triangles, parts, colors, fur, joints_index, weights, stats):
        self.positions, self.normals, self.triangles, self.parts = positions, normals, triangles, parts
        self.colors, self.fur, self.joints, self.weights, self.stats = colors, fur, joints_index, weights, stats


def build(studio, voxel=VOXEL, target=TARGET_TRIANGLES, log=print):
    """Polygonise and decimate the left half, mirror it, then sort it into parts, weight and paint it."""
    import time
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
    positions, triangles = decimate(studio, shape, dense, dense_triangles, target // 2)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions, eps=0.0006)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    parts = regions(shape, positions)
    colors, fur = paint(shape, landmarks, positions, normals, parts)
    names = [bone[0] for bone in skeleton()]
    joints_index, weights = skin_weights(positions, triangles, parts, names)
    low, high = positions.min(axis=0), positions.max(axis=0)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=int(folds), meshNormals=int(disagree.sum()),
                 low=[round(float(v), 4) for v in low], high=[round(float(v), 4) for v in high],
                 parts={name: int((parts == i).sum()) for name, i in PARTS.items()},
                 seconds=dict(field=round(sampled - started, 1), nets=round(netted - sampled, 1),
                              total=round(time.time() - started, 1)))
    log("%s %s" % (TAG, stats))
    return Squirrel(positions, normals, triangles, parts, colors, fur, joints_index, weights, stats)


# -- the acorn ------------------------------------------------------------------------------
ACORN_COAT = dict(nut=srgb(0x9a6a2e), nutTip=srgb(0x5d3a1a), cap=srgb(0x6b4a2a), capDark=srgb(0x3e2a17),
                  stalk=srgb(0x4a3018))


def acorn_shape():
    """An acorn in its own frame (metres; +y from the cup to the point): a glossy nut in a scaly cup."""
    nut = Union([
        Ellipsoid(P(0.0, 0.0, 0.0), (0.0068, 0.0092, 0.0068)),
        RoundCone(P(0.0, 0.004, 0.0), P(0.0, 0.0108, 0.0), 0.0045, 0.0009),
    ], k=0.003)
    cap = Displace(Union([
        Ellipsoid(P(0.0, -0.0042, 0.0), (0.0079, 0.0050, 0.0079)),
        RoundCone(P(0.0, -0.0075, 0.0), P(0.0, -0.0115, 0.0005), 0.0014, 0.0009),
    ], k=0.0015), 0.00035, lambda x, y, z: np.sin(x * 1800.0) * np.sin(z * 1800.0) * np.sin(y * 900.0))
    return nut, cap


def build_acorn(studio, voxel=0.00045, target=420):
    """The acorn's mesh: (positions, normals, colours (linear RGB + sky), triangles), in its own frame."""
    nut, cap = acorn_shape()
    whole = Union([nut, (cap, 0.0008)])
    xs, ys, zs = _grid(whole, voxel)
    field = whole.eval_block(xs, ys, zs)
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(whole, dense, iterations=2, limit=voxel)
    positions, triangles = _collapse(studio, dense, dense_triangles, np.ones(len(dense), dtype=bool), target)
    positions = project(whole, positions, iterations=3, limit=voxel)
    grad = gradient(whole, positions, eps=0.0002)
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    y = positions[:, 1]
    on_cap = cap.eval(positions) < nut.eval(positions)
    nut_colour = ACORN_COAT["nut"] * (1.0 - _smoothstep(0.004, 0.0105, y)[:, None] * 0.6) \
        + ACORN_COAT["nutTip"] * (_smoothstep(0.004, 0.0105, y)[:, None] * 0.6)
    scales = (0.5 + 0.5 * np.sin(positions[:, 0] * 1800.0) * np.sin(positions[:, 2] * 1800.0))[:, None]
    cap_colour = ACORN_COAT["cap"] * (1.0 - scales * 0.5) + ACORN_COAT["capDark"] * (scales * 0.5)
    colour = np.where(on_cap[:, None], cap_colour, nut_colour)
    sky = np.clip(0.75 + 0.25 * normals[:, 1], 0.0, 1.0)
    return positions, normals, np.concatenate([colour, sky[:, None]], axis=1), triangles
