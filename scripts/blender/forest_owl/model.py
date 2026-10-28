"""Forest's eagle owl: its skeleton, its body as a distance field, its feathers, skin weights and plumage.

A Eurasian eagle owl (Bubo bubo), the great owl of the northern wood: a broad head with a flat crown
and two long ear tufts, a tawny facial disc rimmed in black, big orange eyes looking straight out of
it, a barrel of a body streaked dark on the breast and finely barred on the belly, feathered legs and
toes, black talons, and broad round wings whose flight feathers are barred dark on buff.

How it is made:

- The soft parts (body, head, face, legs, toes, bill, eyes) are a distance field round the rig's
  joints (the toolkit the Grainfields horse, Winter's bear and Fall's squirrel are made with), the
  left half polygonised with surface nets, decimated in Blender, cleaned and mirrored, so the owl is
  exactly symmetric.
- The wings and the tail are feathers: every primary, secondary, tertial and tail feather is a
  curved vane of its own on a bone of its own, the coverts lie over them in rows, and the leading
  edge of each wing is a lofted tube. A wing folds and fans by turning those bones, as a bird's does,
  so a feather never stretches.

Frame: metres at life size, glTF axes: +z forward (toward the bill), +y up, +x the owl's left. The
rest pose stands perched, the body upright (its axis POSTURE degrees above level), the feet on the
top of a branch at the origin, and both wings spread out sideways in the plane of the back (the
"flight frame": x along the wing, y dorsal, z along the body toward the head); the runtime folds them.
Every bone's rest rotation is the identity, so a rotation set at runtime reads in the owl's own frame.

Nothing here imports bpy at module level, so the field, the feathers and the weights can be built and
checked anywhere numpy runs.
"""

import math
import re

import numpy as np

from grainfields.horse_sdf import (
    Displace, Ellipsoid, HalfSpace, RoundCone, Tube, Union,
    _grid, _neighbours, _smoothstep, _unit, collapse_bad, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)

TAG = "[forest-owl]"
VOXEL = 0.0026
TARGET_TRIANGLES = 9000

# The body's axis (vent to nape) stands this far above level when perched.
POSTURE = 62.0
_P = math.radians(POSTURE)
AX_X = np.array([1.0, 0.0, 0.0])
AX_D = np.array([0.0, math.cos(_P), -math.sin(_P)])   # dorsal: the back, up and behind
AX_A = np.array([0.0, math.sin(_P), math.cos(_P)])    # along the body, toward the head
# Flight frame -> owl frame (columns: wing-out, dorsal, body axis).
R_FLIGHT = np.stack([AX_X, AX_D, AX_A], axis=1)

PARTS = {
    "body": 0, "head": 1, "face": 2, "eye": 3, "bill": 4, "legL": 5, "legR": 6,
    "toeL": 7, "toeR": 8, "claw": 9, "neck": 10,
}

# Plumage kinds, written into `_plumage.x` (kind / 16) for the shader.
KIND = {
    "body": 0, "face": 1, "eye": 2, "bill": 3, "claw": 4, "primary": 5, "secondary": 6, "covert": 7,
    "under": 8, "rectrix": 9, "tuft": 10, "lid": 11, "foot": 12, "arm": 13, "scapular": 14,
}


def P(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


def _mirror_x(p):
    return P(-p[0], p[1], p[2])


def flight(origin, dx, dy, dz):
    """A point given in the flight frame (wing-out, dorsal, body axis) from `origin`, in the owl frame."""
    return np.asarray(origin, dtype=np.float64) + R_FLIGHT @ np.array([dx, dy, dz], dtype=np.float64)


def fdir(dx, dy, dz):
    return _unit(R_FLIGHT @ np.array([dx, dy, dz], dtype=np.float64))


# -- the wing's plan (flight frame, left wing, metres from the shoulder) --------------------
SHOULDER = P(0.060, 0.352, -0.034)
ELBOW_F = (0.150, 0.0, -0.030)
WRIST_F = (0.325, 0.0, 0.006)
TIP_F = (0.455, 0.0, -0.006)

PRIMARIES = 10
SECONDARIES = 14
TERTIALS = 3
RECTRICES = 6  # each side
# Primary lengths p1 (inner, at the wrist) .. p10 (outer): a round owl's wing, p7 and p8 longest.
PRIMARY_LENGTH = [0.292, 0.305, 0.322, 0.344, 0.366, 0.386, 0.402, 0.400, 0.378, 0.334]
# Where each primary points in the spread wing: degrees from straight back toward the wingtip.
PRIMARY_ANGLE = [22.0, 28.5, 35.0, 41.5, 48.5, 55.5, 63.0, 70.5, 78.5, 87.0]
# The slotted tips: where the outer vane narrows (fraction of length; None = not emarginated).
PRIMARY_NOTCH = [None, None, None, None, None, 0.66, 0.6, 0.56, 0.54, 0.56]
TERTIAL_LENGTH = [0.218, 0.19, 0.158]
TERTIAL_ANGLE = [-9.0, -18.0, -28.0]
RECTRIX_LENGTH = [0.262, 0.262, 0.26, 0.256, 0.25, 0.24]
TAIL_BASE = P(0.0, 0.088, -0.078)
EYE = P(0.035, 0.481, 0.0935)
EYE_RADIUS = 0.0172
EYE_LOOK = _unit((0.16, -0.02, 1.0))
BILL_TIP = P(0.0, 0.437, 0.121)


def wing_points():
    s = SHOULDER
    return dict(shoulder=s, elbow=flight(s, *ELBOW_F), wrist=flight(s, *WRIST_F), tip=flight(s, *TIP_F))


def _lerp(a, b, t):
    return np.asarray(a) + (np.asarray(b) - np.asarray(a)) * t


def _sweep(angle_degrees):
    """A direction in the wing plane, `angle` degrees from straight back toward the wingtip (left wing)."""
    a = math.radians(angle_degrees)
    return fdir(math.sin(a), 0.0, -math.cos(a))


# -- the skeleton (rest pose) ---------------------------------------------------------------
def skeleton():
    """[(name, parent, head)]: every bone's joint in the rest pose (left side; right mirrored)."""
    w = wing_points()
    bones = [
        ("root", None, P(0.0, 0.215, 0.0)),
        ("pelvis", "root", P(0.0, 0.158, -0.02)),
        ("chest", "root", P(0.0, 0.285, 0.0)),
        ("neck0", "chest", P(0.0, 0.352, 0.004)),
        ("neck1", "neck0", P(0.0, 0.398, 0.012)),
        ("head", "neck1", P(0.0, 0.438, 0.02)),
        ("throat", "neck1", P(0.0, 0.405, 0.066)),
        ("tail", "pelvis", TAIL_BASE.copy()),
    ]
    for side, sfx in ((1.0, "L"), (-1.0, "R")):
        def S(p, side=side):
            return P(side * p[0], p[1], p[2])
        bones += [
            ("lid" + sfx, "head", S(EYE)),
            ("ear" + sfx, "head", S(P(0.05, 0.515, 0.052))),
        ]
        for i in range(RECTRICES):
            bones.append(("rectrix%s%d" % (sfx, i + 1), "tail", S(rectrix_root(i))))
        foot = P(0.05, 0.018, 0.024)
        bones += [
            ("thigh" + sfx, "pelvis", S(P(0.042, 0.148, -0.006))),
            ("shin" + sfx, "thigh" + sfx, S(P(0.047, 0.126, 0.044))),
            ("tarsus" + sfx, "shin" + sfx, S(P(0.05, 0.088, 0.012))),
            ("foot" + sfx, "tarsus" + sfx, S(foot)),
        ]
        for t, (direction, (a, b)) in enumerate(zip(TOE_DIRECTIONS, TOE_LENGTHS)):
            d = _unit(direction)
            bones.append(("toe%s%da" % (sfx, t + 1), "foot" + sfx, S(foot)))
            bones.append(("toe%s%db" % (sfx, t + 1), "toe%s%da" % (sfx, t + 1), S(foot + d * a)))
        bones += [
            ("humerus" + sfx, "chest", S(w["shoulder"])),
            ("ulna" + sfx, "humerus" + sfx, S(w["elbow"])),
            ("hand" + sfx, "ulna" + sfx, S(w["wrist"])),
            ("alula" + sfx, "hand" + sfx, S(_lerp(w["wrist"], w["tip"], 0.12) + AX_A * 0.012)),
        ]
        for i in range(PRIMARIES):
            bones.append(("primary%s%d" % (sfx, i + 1), "hand" + sfx, S(primary_root(i))))
        for i in range(SECONDARIES):
            bones.append(("secondary%s%d" % (sfx, i + 1), "ulna" + sfx, S(secondary_root(i))))
        for i in range(TERTIALS):
            bones.append(("tertial%s%d" % (sfx, i + 1), "humerus" + sfx, S(tertial_root(i))))
    return bones


def bone_names():
    return [b[0] for b in skeleton()]


def joints():
    return {name: head for name, _parent, head in skeleton()}


# Toes (left foot, rest: spread flat on the branch top): the hallux back, two forward, the outer one
# out to the side (an owl turns it back to perch with two toes each way).
TOE_DIRECTIONS = [(-0.12, 0.0, -1.0), (-0.32, 0.0, 1.0), (0.06, 0.0, 1.0), (0.85, 0.0, 0.5)]
TOE_LENGTHS = [(0.018, 0.015), (0.021, 0.017), (0.025, 0.019), (0.02, 0.016)]
CLAW_LENGTH = [0.032, 0.032, 0.034, 0.028]


def primary_root(i):
    w = wing_points()
    t = i / (PRIMARIES - 1)
    return _lerp(w["wrist"], w["tip"], t) - AX_A * 0.006 - AX_D * 0.0012 * (i - 4.5)


def secondary_root(i):
    w = wing_points()
    t = i / (SECONDARIES - 1)  # 0 at the wrist (s1), 1 at the elbow (s14)
    return _lerp(w["wrist"], w["elbow"], t) - AX_A * 0.008 + AX_D * (0.0012 * i + 0.0072)


def tertial_root(i):
    w = wing_points()
    return _lerp(w["elbow"], w["shoulder"], 0.12 + 0.2 * i) - AX_A * 0.008 + AX_D * (0.0012 * (SECONDARIES + i) + 0.0072)


def rectrix_root(i):
    return TAIL_BASE + AX_X * (0.005 + 0.0085 * i) + AX_D * (0.0016 * (RECTRICES - i))


# -- feathers ------------------------------------------------------------------------------
class Feather:
    """One vane: rooted at `root`, along `direction`, its dorsal side toward `normal`; `outer` is the
    side its narrow (leading) vane is on. Widths in metres; `notch` = where the outer vane narrows."""

    def __init__(self, bone, kind, root, direction, normal, length, width, outer_share=0.32,
                 notch=None, camber=0.18, droop=0.05, segments=8, across=2, seed=0.0, index=0, tip_round=0.42,
                 base=0.07):
        self.bone, self.kind = bone, kind
        self.root = np.asarray(root, dtype=np.float64)
        d = _unit(direction)
        n = np.asarray(normal, dtype=np.float64)
        n = _unit(n - d * (n @ d))
        self.direction, self.normal = d, n
        self.side = np.cross(n, d)  # left of the direction, seen from the dorsal side
        self.length, self.width = float(length), float(width)
        self.outer_share, self.notch, self.camber, self.droop = outer_share, notch, camber, droop
        self.segments, self.across, self.seed, self.index = segments, across, seed, index
        self.tip_round, self.base = tip_round, base
        self.outer_sign = 1.0

    def envelope(self, s):
        """Half-widths (outer, inner) at fraction s along the vane."""
        rise = _smoothstep(self.base * 0.6, self.base + 0.2, s)
        t0 = 1.0 - self.tip_round
        tip = np.where(s > t0, np.sqrt(np.clip(1.0 - ((s - t0) / max(self.tip_round, 1e-6)) ** 2, 0.0, 1.0)), 1.0)
        full = self.width * rise * tip
        outer = full * self.outer_share
        inner = full * (1.0 - self.outer_share)
        if self.notch is not None:
            cut = _smoothstep(self.notch - 0.04, self.notch + 0.06, s)
            outer = outer * (1.0 - 0.45 * cut)
            inner = inner * (1.0 - 0.18 * _smoothstep(self.notch - 0.12, self.notch - 0.02, s))
        return outer, inner

    def mesh(self):
        """(positions, triangles, uv): uv = (s along, v across: +1 outer edge, -1 inner edge)."""
        n_s, n_a = self.segments, self.across
        # Stations crowd toward the tip, so its round end is drawn round; the last is a point.
        u = np.linspace(0.0, 1.0, n_s + 1)
        s = 1.0 - (1.0 - u) ** 1.7
        outer, inner = self.envelope(s)
        vs = np.linspace(-1.0, 1.0, 2 * n_a + 1)
        rows = []
        uvs = []
        side = self.side * self.outer_sign
        for k in range(n_s + 1):
            along = self.root + self.direction * (s[k] * self.length)
            # The shaft bends down toward the tip; each vane curls down away from the shaft.
            along = along - self.normal * (self.droop * self.length * s[k] ** 2)
            for v in vs:
                half = outer[k] if v > 0 else inner[k]
                lateral = v * half
                curl = self.camber * (lateral ** 2) / max(self.width, 1e-6)
                rows.append(along + side * lateral - self.normal * curl)
                uvs.append((s[k], v))
        positions = np.array(rows)
        m = len(vs)
        tris = []
        for k in range(n_s):
            for j in range(m - 1):
                a, b = k * m + j, k * m + j + 1
                c, d = (k + 1) * m + j, (k + 1) * m + j + 1
                tris += [(a, c, b), (b, c, d)]
        triangles = np.array(tris, dtype=np.int64)
        # Wind so the dorsal side faces +normal.
        p0, p1, p2 = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
        face = np.cross(p1 - p0, p2 - p0)
        if (face @ self.normal).mean() < 0.0:
            triangles = triangles[:, [0, 2, 1]]
        return positions, triangles, np.array(uvs)


def _hash(*values):
    x = math.sin(sum(v * k for v, k in zip(values, (127.1, 311.7, 74.7, 269.5)))) * 43758.5453
    return x - math.floor(x)


def wing_feathers():
    """Every feather of the left wing, in the rest (spread) pose."""
    w = wing_points()
    dorsal = AX_D
    out = []
    # Primaries: the hand's fan.
    for i in range(PRIMARIES):
        width = 0.068 - 0.0018 * max(0, i - 5)
        out.append(Feather("primaryL%d" % (i + 1), "primary", primary_root(i), _sweep(PRIMARY_ANGLE[i]), dorsal,
                           PRIMARY_LENGTH[i], width, outer_share=0.27 if i < 9 else 0.18, notch=PRIMARY_NOTCH[i],
                           camber=0.16, droop=0.07, segments=10, across=2, seed=_hash(i, 1.0), index=i,
                           tip_round=0.36 if PRIMARY_NOTCH[i] is None else 0.3))
    # Secondaries along the forearm (s1 at the wrist), tertials near the elbow.
    for i in range(SECONDARIES):
        t = i / (SECONDARIES - 1)
        angle = 13.0 * (1.0 - t) - 2.5 * t
        length = 0.272 * (1.0 - t) + 0.252 * t
        out.append(Feather("secondaryL%d" % (i + 1), "secondary", secondary_root(i), _sweep(angle), dorsal, length,
                           0.066, outer_share=0.3, camber=0.15, droop=0.05, segments=9, across=2,
                           seed=_hash(i, 2.0), index=i, tip_round=0.45))
    for i in range(TERTIALS):
        out.append(Feather("tertialL%d" % (i + 1), "secondary", tertial_root(i), _sweep(TERTIAL_ANGLE[i]), dorsal,
                           TERTIAL_LENGTH[i], 0.07, outer_share=0.4, camber=0.2, droop=0.06, segments=8, across=2,
                           seed=_hash(i, 3.0), index=SECONDARIES + i, tip_round=0.5))
    # Greater coverts over the secondaries' bases, primary coverts over the primaries'.
    for i in range(SECONDARIES):
        t = i / (SECONDARIES - 1)
        angle = 13.0 * (1.0 - t) - 2.5 * t
        root = secondary_root(i) + AX_A * 0.014 + dorsal * 0.0105
        out.append(Feather("secondaryL%d" % (i + 1), "covert", root, _sweep(angle + 2.0), dorsal, 0.122, 0.058,
                           outer_share=0.42, camber=0.25, droop=0.12, segments=5, across=1,
                           seed=_hash(i, 4.0), index=i, tip_round=0.55))
    for i in range(PRIMARIES):
        root = primary_root(i) + AX_A * 0.012 + dorsal * 0.0085
        out.append(Feather("primaryL%d" % (i + 1), "covert", root, _sweep(PRIMARY_ANGLE[i] - 4.0), dorsal,
                           0.105 - 0.002 * i, 0.044, outer_share=0.4, camber=0.25, droop=0.1, segments=5, across=1,
                           seed=_hash(i, 5.0), index=i, tip_round=0.55))
    for i in range(TERTIALS):
        root = tertial_root(i) + AX_A * 0.014 + dorsal * 0.0105
        out.append(Feather("tertialL%d" % (i + 1), "covert", root, _sweep(TERTIAL_ANGLE[i] + 2.0), dorsal, 0.11, 0.06,
                           outer_share=0.42, camber=0.25, droop=0.12, segments=5, across=1,
                           seed=_hash(i, 4.5), index=SECONDARIES + i, tip_round=0.55))
    # Median and lesser coverts in rows along the arm, on the arm's bones.
    rows = [
        # (offset forward from the trailing line, length, width, count, dorsal lift)
        (0.034, 0.078, 0.042, 13, 0.0125),
        (0.050, 0.056, 0.036, 15, 0.0142),
        (0.062, 0.040, 0.03, 17, 0.0155),
    ]
    for r, (ahead, length, width, count, lift) in enumerate(rows):
        for k in range(count):
            t = (k + 0.5) / count
            # Along the arm from just outside the shoulder to the wrist, then a little way down the hand.
            if t < 0.36:
                a, b, f, bone = w["shoulder"], w["elbow"], t / 0.36, "humerusL"
                f = 0.25 + 0.75 * f
            elif t < 0.92:
                a, b, f, bone = w["elbow"], w["wrist"], (t - 0.36) / 0.56, "ulnaL"
            else:
                a, b, f, bone = w["wrist"], w["tip"], (t - 0.92) / 0.08 * 0.35, "handL"
            root = _lerp(a, b, f) - AX_A * 0.008 + AX_A * ahead + dorsal * lift
            angle = 6.0 + 10.0 * (t > 0.92) * ((t - 0.92) / 0.08)
            out.append(Feather(bone, "covert", root, _sweep(angle), dorsal, length, width, outer_share=0.45,
                               camber=0.3, droop=0.15, segments=4, across=1, seed=_hash(k, 6.0 + r), index=k,
                               tip_round=0.6, base=0.1))
    # Alula: three short stiff feathers at the bend of the wing, along the leading edge.
    for k in range(3):
        root = _lerp(w["wrist"], w["tip"], 0.1 + 0.03 * k) + AX_A * 0.02 + dorsal * (0.012 + 0.001 * k)
        out.append(Feather("alulaL", "covert", root, _sweep(112.0 - 8.0 * k), dorsal, 0.07 - 0.01 * k, 0.022,
                           outer_share=0.3, camber=0.15, droop=0.04, segments=5, across=1, seed=_hash(k, 9.0),
                           index=k, tip_round=0.5))
    # Under the wing: under coverts (pale), the mirror of the rows above.
    under = -dorsal
    for i in range(SECONDARIES):
        t = i / (SECONDARIES - 1)
        angle = 13.0 * (1.0 - t) - 2.5 * t
        root = secondary_root(i) + AX_A * 0.012 - dorsal * 0.0105
        out.append(Feather("secondaryL%d" % (i + 1), "under", root, _sweep(angle + 3.0), under, 0.11, 0.06,
                           outer_share=0.45, camber=0.2, droop=-0.08, segments=4, across=1, seed=_hash(i, 10.0),
                           index=i, tip_round=0.55))
    for i in range(PRIMARIES):
        root = primary_root(i) + AX_A * 0.01 - dorsal * 0.0085
        out.append(Feather("primaryL%d" % (i + 1), "under", root, _sweep(PRIMARY_ANGLE[i] - 3.0), under,
                           0.09, 0.044, outer_share=0.45, camber=0.2, droop=-0.08, segments=4, across=1,
                           seed=_hash(i, 11.0), index=i, tip_round=0.55))
    for k in range(14):
        t = (k + 0.5) / 14
        if t < 0.4:
            a, b, f, bone = w["shoulder"], w["elbow"], 0.3 + 0.7 * t / 0.4, "humerusL"
        else:
            a, b, f, bone = w["elbow"], w["wrist"], (t - 0.4) / 0.6, "ulnaL"
        root = _lerp(a, b, f) + AX_A * 0.04 - dorsal * 0.0125
        out.append(Feather(bone, "under", root, _sweep(4.0), under, 0.07, 0.045, outer_share=0.45, camber=0.25,
                           droop=-0.08, segments=4, across=1, seed=_hash(k, 12.0), index=k, tip_round=0.6,
                           base=0.1))
    return out


def tail_feathers():
    """The left half of the tail (rectrices fanned a little, the closed tail of a perched owl) and the
    coverts above and below their bases."""
    out = []
    for i in range(RECTRICES):
        angle = 2.5 + 3.2 * i
        direction = fdir(math.sin(math.radians(angle)), 0.0, -math.cos(math.radians(angle)))
        out.append(Feather("rectrixL%d" % (i + 1), "rectrix", rectrix_root(i), direction, AX_D, RECTRIX_LENGTH[i],
                           0.056, outer_share=0.36 if i < RECTRICES - 1 else 0.26, camber=0.12, droop=0.03,
                           segments=8, across=2, seed=_hash(i, 13.0), index=i, tip_round=0.42))
    for k in range(4):
        angle = 4.0 + 7.0 * k
        direction = fdir(math.sin(math.radians(angle)), 0.0, -math.cos(math.radians(angle)))
        root = TAIL_BASE + AX_X * (0.008 + 0.011 * k) + AX_D * 0.016 + AX_A * 0.016
        out.append(Feather("tail", "covert", root, direction, AX_D, 0.12 - 0.008 * k, 0.05, outer_share=0.45,
                           camber=0.3, droop=0.1, segments=5, across=1, seed=_hash(k, 14.0), index=k, tip_round=0.55))
        root = TAIL_BASE + AX_X * (0.008 + 0.011 * k) - AX_D * 0.012 + AX_A * 0.012
        out.append(Feather("tail", "under", root, direction, -AX_D, 0.13 - 0.01 * k, 0.05, outer_share=0.45,
                           camber=0.3, droop=-0.06, segments=4, across=1, seed=_hash(k, 15.0), index=k,
                           tip_round=0.6))
    return out


def scapulars():
    """Long soft feathers from the shoulder over the base of the wing (the top of a folded wing)."""
    out = []
    # Two rows lying down the back from below the nape (they are the body's, on the chest bone), the
    # outer ones over the top of the folded wing's base.
    for k in range(7):
        t = k / 6.0
        row = k % 2
        root = P(0.012 + 0.06 * t, 0.392 - 0.022 * row - 0.012 * t, -0.072 - 0.006 * t + 0.004 * row)
        direction = _unit((0.12 + 0.3 * t, -1.0, -0.04 - 0.1 * t))
        normal = _unit((0.25 * t, 0.05, -1.0))
        out.append(Feather("chest", "scapular", root, direction, normal, 0.13 - 0.012 * row, 0.062,
                           outer_share=0.45, camber=0.35, droop=0.1, segments=5, across=1,
                           seed=_hash(k, 16.0), index=k, tip_round=0.55))
    return out


def tufts():
    """The ear tufts: a sheaf of long narrow feathers from each brow corner, drawn together to a point,
    leaning out and a little back: the eagle owl's horns."""
    out = []
    base = P(0.05, 0.512, 0.054)
    tip = base + P(0.024, 0.078, -0.016)
    for k in range(7):
        lean = -1.0 + k / 3.0
        root = base + P(-0.009 * lean, -0.003 * abs(lean), 0.008 * lean)
        reach = tip + P(0.004 * lean, -0.012 * abs(lean), 0.004 * lean)
        direction = _unit(reach - root)
        normal = _unit((0.42, 0.05, 1.0))
        length = float(np.linalg.norm(reach - root))
        out.append(Feather("earL", "tuft", root, direction, normal, length, 0.0105, outer_share=0.45, camber=0.12,
                           droop=-0.08, segments=7, across=1, seed=_hash(k, 17.0), index=k, tip_round=0.5,
                           base=0.04))
    return out


def lid_mesh(segments=10, rings=5):
    """The left upper eyelid: a feathered cap over the top of the eye (open), turned down to blink."""
    up = _unit(np.array([0.0, 1.0, -0.25]))
    look = EYE_LOOK
    across = _unit(np.cross(up, look))
    r = EYE_RADIUS * 1.12
    positions, uvs = [], []
    for i in range(rings + 1):
        polar = math.radians(6.0 + 50.0 * i / rings)  # from the top of the eye down to just above the pupil
        for j in range(segments + 1):
            az = math.radians(-82.0 + 164.0 * j / segments)
            d = up * math.cos(polar) + math.sin(polar) * (look * math.cos(az) + across * math.sin(az))
            positions.append(EYE + d * r)
            uvs.append((i / rings, j / segments * 2.0 - 1.0))
    tris = []
    m = segments + 1
    for i in range(rings):
        for j in range(segments):
            a, b, c, d = i * m + j, i * m + j + 1, (i + 1) * m + j, (i + 1) * m + j + 1
            tris += [(a, b, c), (b, d, c)]
    positions = np.array(positions)
    triangles = np.array(tris, dtype=np.int64)
    p0, p1, p2 = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
    face = np.cross(p1 - p0, p2 - p0)
    centre_out = (p0 + p1 + p2) / 3.0 - EYE
    if (np.einsum("ij,ij->i", face, centre_out)).mean() < 0.0:
        triangles = triangles[:, [0, 2, 1]]
    return positions, triangles, np.array(uvs)


def arm_loft(stations=26, ring=10):
    """The leading edge of the left wing: a flattened tube from inside the shoulder to the hand's end."""
    w = wing_points()
    keys = [w["shoulder"] + AX_X * -0.02, w["shoulder"], w["elbow"], w["wrist"], w["tip"]]
    # Catmull-Rom through the joints.
    pts = [keys[0]] + keys + [keys[-1]]
    samples = []
    params = []
    for seg in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[seg - 1], pts[seg], pts[seg + 1], pts[seg + 2]
        n = max(2, stations // (len(pts) - 3))
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            samples.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
            params.append(seg - 1 + t)
    samples.append(keys[-1])
    params.append(len(keys) - 1.0)
    samples = np.array(samples)
    params = np.array(params)
    # Half-chord (toward the trailing edge) and half-thickness along the way: 0 inside, 1 shoulder,
    # 2 elbow, 3 wrist, 4 tip.
    chord = np.interp(params, [0, 1, 2, 3, 4], [0.03, 0.036, 0.03, 0.022, 0.006])
    thick = np.interp(params, [0, 1, 2, 3, 4], [0.026, 0.024, 0.017, 0.012, 0.004])
    positions, uvs, bones = [], [], []
    for k, c in enumerate(samples):
        tangent = samples[min(k + 1, len(samples) - 1)] - samples[max(k - 1, 0)]
        tangent = _unit(tangent - AX_D * (tangent @ AX_D))
        back = _unit(np.cross(AX_D, tangent))  # in the wing plane, toward the trailing edge
        if back @ AX_A > 0:
            back = -back
        for j in range(ring):
            a = 2.0 * math.pi * j / ring
            # The section: round at the leading edge, tapering to the trailing side.
            u, v = math.cos(a), math.sin(a)
            lead = 0.55 if u < 0 else 1.0
            positions.append(c + back * (chord[k] * (u * lead + 0.25)) + AX_D * (thick[k] * v))
            uvs.append((params[k] / 4.0, j / ring))
        bones.append(params[k])
    tris = []
    for k in range(len(samples) - 1):
        for j in range(ring):
            a, b = k * ring + j, k * ring + (j + 1) % ring
            c, d = (k + 1) * ring + j, (k + 1) * ring + (j + 1) % ring
            tris += [(a, c, b), (b, c, d)]
    positions = np.array(positions)
    triangles = np.array(tris, dtype=np.int64)
    # Outward winding.
    centre = np.repeat(samples, ring, axis=0)
    p0, p1, p2 = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
    face = np.cross(p1 - p0, p2 - p0)
    if np.einsum("ij,ij->i", face, (p0 + p1 + p2) / 3.0 - centre[triangles[:, 0]]).mean() < 0.0:
        triangles = triangles[:, [0, 2, 1]]
    return positions, triangles, np.array(uvs), np.repeat(np.array(bones), ring)


# -- the soft body ---------------------------------------------------------------------------
def _contour(x, y, z):
    """Soft scallops of contour feathers over the body, about -1..1."""
    return (0.55 * np.sin(y * 190.0 + 1.7 * np.sin(x * 70.0)) * np.sin(x * 160.0 + z * 90.0 + 0.4)
            + 0.3 * np.sin(y * 330.0 - z * 120.0) * np.sin(x * 280.0 + 1.1)
            + 0.15 * np.sin(z * 420.0 + y * 260.0))


def _fine(x, y, z):
    return np.sin(x * 520.0 + y * 310.0) * np.sin(z * 470.0 - y * 190.0)


TARSUS_TOP = P(0.05, 0.096, 0.016)


def design():
    """The soft owl as a distance field round its joints, and its landmarks."""
    J = joints()
    axis = AX_A
    # The body: a deep barrel, the breast full and forward, the back flatter, the belly fluffed low
    # over the legs. (The folded wings lie over the flanks: they are feathers, drawn over this.)
    body = Union([
        Ellipsoid(P(0.0, 0.222, 0.004), (0.124, 0.098, 0.15), along=axis),
        Ellipsoid(P(0.0, 0.292, 0.046), (0.11, 0.09, 0.088)),
        Ellipsoid(P(0.0, 0.168, 0.044), (0.11, 0.088, 0.088)),
        # The belly's plumage hangs low over the legs, as a skirt.
        Ellipsoid(P(0.0, 0.1, 0.036), (0.088, 0.06, 0.072)),
        Ellipsoid(P(0.0, 0.305, -0.034), (0.09, 0.064, 0.096), along=_unit((0.0, 0.85, -0.52))),
        Ellipsoid(P(0.0, 0.1, -0.048), (0.056, 0.05, 0.052)),
    ], k=0.035).tag(PARTS["body"])
    body = Displace(body, 0.0016, _contour)

    # The neck ruff: thick, the head sits on the shoulders.
    neck = RoundCone(P(0.0, 0.33, 0.006), P(0.0, 0.41, 0.018), 0.088, 0.086).tag(PARTS["neck"])

    # The head: broad, a flat crown, the facial disc a shallow dish framed by a ruff, brows over the eyes.
    cranium = Union([
        Ellipsoid(P(0.0, 0.46, 0.024), (0.098, 0.074, 0.08)),
        Ellipsoid(P(0.0, 0.493, 0.01), (0.088, 0.04, 0.07)),
    ], k=0.022).tag(PARTS["head"])
    ruff = []
    for side in (1.0, -1.0):
        # The rim of the disc down each side of the face, and the cheek below the eye.
        ruff.append(Ellipsoid(P(side * 0.075, 0.455, 0.074), (0.016, 0.064, 0.026), along=_unit((side * 0.5, 0.0, 0.86))))
        ruff.append(Ellipsoid(P(side * 0.046, 0.43, 0.082), (0.03, 0.017, 0.015)))
        # The brow over each eye, pale, sweeping out toward the tuft.
        ruff.append(Ellipsoid(P(side * 0.038, 0.503, 0.09), (0.03, 0.0085, 0.014),
                              along=_unit((side * 1.0, 0.36, -0.15))))
    disc = Union(ruff, k=0.012).tag(PARTS["face"])
    # Between the eyes: the bristled ridge that runs down to the bill.
    bristle = Ellipsoid(P(0.0, 0.468, 0.104), (0.016, 0.03, 0.017)).tag(PARTS["face"])
    head = Union([cranium, (disc, 0.016), (bristle, 0.01)], k=0.012)
    head = Displace(head, 0.0009, _fine)

    # The bill: a short hooked beak, mostly hidden in the bristles.
    bill = Union([
        RoundCone(P(0.0, 0.458, 0.112), P(0.0, 0.446, 0.121), 0.0085, 0.0055),
        RoundCone(P(0.0, 0.446, 0.121), BILL_TIP, 0.0055, 0.0022),
    ], k=0.004).tag(PARTS["bill"])

    eyes = Union([
        Ellipsoid(EYE, (EYE_RADIUS, EYE_RADIUS, EYE_RADIUS)),
        Ellipsoid(_mirror_x(EYE), (EYE_RADIUS, EYE_RADIUS, EYE_RADIUS)),
    ]).tag(PARTS["eye"])

    # Legs: the feathered tarsus below the belly, thick with plumage; the feathered toes; black talons.
    legs, toes, claws = [], [], []
    for side, part, toe_part in ((1.0, PARTS["legL"], PARTS["toeL"]), (-1.0, PARTS["legR"], PARTS["toeR"])):
        def S(p, side=side):
            return P(side * p[0], p[1], p[2])
        foot = S(J["footL"])
        # Feathered to the toes: a thick shaggy tarsus under a fluffed thigh.
        legs.append(Union([
            RoundCone(S(TARSUS_TOP), foot + P(0.0, 0.006, 0.002), 0.027, 0.022),
            Ellipsoid(S(P(0.048, 0.1, 0.03)), (0.036, 0.04, 0.038)),
        ], k=0.016).tag(part))
        for t, (direction, (a, b)) in enumerate(zip(TOE_DIRECTIONS, TOE_LENGTHS)):
            d = _unit(direction) * np.array([side, 1.0, 1.0])
            knuckle = foot + d * a
            end = knuckle + d * b
            toes.append(Tube([foot, knuckle, end], [0.0135, 0.0112, 0.0082], k=0.005).tag(toe_part))
            # The talon: a black hook curling down from the end of the toe.
            c1 = end + d * 0.012 + P(0.0, -0.002, 0.0)
            c2 = end + d * (CLAW_LENGTH[t] * 0.72) + P(0.0, -0.012, 0.0)
            c3 = end + d * (CLAW_LENGTH[t] * 0.86) + P(0.0, -0.024, 0.0)
            claws.append(Tube([end + d * 0.004, c1, c2, c3], [0.0042, 0.0036, 0.0024, 0.0007], k=0.002)
                         .tag(PARTS["claw"]))
    feet = Union([*[(t, 0.006) for t in toes]], k=0.006)

    whole = Union([
        body, (neck, 0.035), (head, 0.03), (bill, 0.004), (eyes, 0.002),
        *[(leg, 0.02) for leg in legs], (feet, 0.012), *[(c, 0.003) for c in claws],
    ])
    landmarks = dict(eyes=[EYE, _mirror_x(EYE)], eyeRadius=EYE_RADIUS, bill=BILL_TIP)
    return whole, landmarks


# -- weights --------------------------------------------------------------------------------
def chains():
    """Which bones each soft part bends with, as (bone, segment start, segment end)."""
    J = joints()
    out = {
        PARTS["body"]: [("pelvis", J["pelvis"] + P(0, -0.06, 0), J["pelvis"]), ("root", J["pelvis"], J["chest"]),
                        ("chest", J["chest"], J["neck0"]), ("neck0", J["neck0"], J["neck0"] + P(0, 0.02, 0)),
                        ("tail", J["tail"], J["tail"] + AX_A * -0.03)],
        PARTS["neck"]: [("chest", J["chest"], J["neck0"]), ("neck0", J["neck0"], J["neck1"]),
                        ("neck1", J["neck1"], J["head"]), ("throat", J["throat"], J["throat"] + P(0, -0.02, 0.01))],
        PARTS["head"]: [("neck1", J["neck1"], J["head"]), ("head", J["head"], J["head"] + P(0, 0.06, 0.03))],
        PARTS["face"]: [("head", J["head"], J["head"] + P(0, 0.06, 0.06)),
                        ("throat", J["throat"], J["throat"] + P(0, -0.01, 0.0))],
        PARTS["eye"]: [("head", J["head"], J["head"] + P(0, 0.05, 0.08))],
        PARTS["bill"]: [("head", J["head"], J["head"] + P(0, 0.02, 0.1))],
        PARTS["claw"]: [],
    }
    for sfx in ("L", "R"):
        out[PARTS["leg" + sfx]] = [("thigh" + sfx, J["thigh" + sfx], J["shin" + sfx]),
                                  ("shin" + sfx, J["shin" + sfx], J["tarsus" + sfx]),
                                  ("tarsus" + sfx, J["tarsus" + sfx], J["foot" + sfx])]
        out[PARTS["toe" + sfx]] = [("tarsus" + sfx, J["tarsus" + sfx], J["foot" + sfx])]
        for t in range(4):
            a, b = "toe%s%da" % (sfx, t + 1), "toe%s%db" % (sfx, t + 1)
            d = J[b] - J[a]
            out[PARTS["toe" + sfx]] += [(a, J[a], J[b]), (b, J[b], J[b] + d * 1.6)]
    return out


def _segment_distance(points, a, b):
    ab = b - a
    t = np.clip(((points - a) @ ab) / max(float(ab @ ab), 1e-12), 0.0, 1.0)
    return np.linalg.norm(points - (a + t[:, None] * ab[None, :]), axis=1)


def skin_weights(positions, triangles, parts, names, smooth_passes=4, power=5.0):
    """(N, 4) bone indices and (N, 4) weights for the soft body."""
    index = {name: i for i, name in enumerate(names)}
    J = joints()
    count = len(positions)
    dense = np.zeros((count, len(names)))
    table = chains()
    for part, chain in table.items():
        rows = np.nonzero(parts == part)[0]
        if not len(rows):
            continue
        if part == PARTS["claw"]:
            # Each talon rides on the nearest toe's tip bone.
            tips = [n for n in names if n.startswith("toe") and n.endswith("b")]
            d = np.stack([np.linalg.norm(positions[rows] - J[n], axis=1) for n in tips], axis=1)
            nearest = np.argmin(d, axis=1)
            for r, k in zip(rows, nearest):
                dense[r, index[tips[k]]] = 1.0
            continue
        points = positions[rows]
        distances = np.stack([_segment_distance(points, a, b) for _name, a, b in chain], axis=1)
        w = 1.0 / np.maximum(distances, 0.002) ** power
        w /= w.sum(axis=1, keepdims=True)
        for column, (name, _a, _b) in enumerate(chain):
            dense[rows, index[name]] += w[:, column]
    neighbours = _neighbours(count, triangles)
    claw_rows = parts == PARTS["claw"]
    for _ in range(smooth_passes):
        mean = np.stack([dense[around].mean(axis=0) if len(around) else dense[v] for v, around in enumerate(neighbours)])
        mixed = 0.5 * dense + 0.5 * mean
        mixed[claw_rows] = dense[claw_rows]
        dense = mixed
    order = np.argsort(-dense, axis=1)[:, :4]
    weights = np.take_along_axis(dense, order, axis=1)
    weights[weights < 0.01] = 0.0
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
    return order.astype(np.int64), weights


# -- parts, occlusion and plumage -------------------------------------------------------------
def regions(shape, positions):
    leaves = shape.leaves()
    best = np.full(len(positions), np.inf)
    parts = np.zeros(len(positions), dtype=np.int64)
    for leaf in leaves:
        d = leaf.eval(positions)
        closer = d < best
        best[closer] = d[closer]
        parts[closer] = leaf.part
    left = positions[:, 0] >= 0.0
    for a, b in (("legL", "legR"), ("toeL", "toeR")):
        parts = np.where((parts == PARTS[b]) & left, PARTS[a], parts)
        parts = np.where((parts == PARTS[a]) & ~left, PARTS[b], parts)
    return parts


def occlusion(shape, positions, normals, rays=36, reach=0.16):
    """The share of the sky each vertex of the soft body sees past the owl itself."""
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
    start = positions + normals * 0.0015
    for d in local:
        direction = tangent * d[0] + bitangent * d[1] + normals * d[2]
        t = np.full(count, 0.0025)
        alive = np.ones(count, dtype=bool)
        blocked = np.zeros(count)
        for _ in range(24):
            if not alive.any():
                break
            rows = np.nonzero(alive)[0]
            p = start[rows] + direction[rows] * t[rows, None]
            field = shape.eval(p)
            hit = field < 0.0006
            blocked[rows[hit]] = 1.0
            t[rows] += np.maximum(field, 0.0015)
            alive[rows[hit]] = False
            alive &= t < reach
        seen += 1.0 - blocked
    return np.clip(seen / rays, 0.0, 1.0)


def srgb(hex_colour):
    c = np.array([(hex_colour >> 16) & 255, (hex_colour >> 8) & 255, hex_colour & 255], dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


PLUMAGE = dict(
    back=srgb(0x5b3e26), mantle=srgb(0x6e4b2c), breast=srgb(0xb88550), belly=srgb(0xc29a68),
    throat=srgb(0xe6dccb), disc=srgb(0xb4874f), rim=srgb(0x2a1c13), brow=srgb(0xd8c4a0),
    crown=srgb(0x5e4128), eye=srgb(0xf06d10), bill=srgb(0x2a2a2d), claw=srgb(0x121010), foot=srgb(0xc8a677),
    flight=srgb(0x6a4a2c), flightUnder=srgb(0xcdb48c), covert=srgb(0x5a3c24), under=srgb(0xd2bc96),
    tail=srgb(0x6e4f30), tuft=srgb(0x34241a), arm=srgb(0x5a3c24),
)


def paint_body(shape, landmarks, positions, normals, parts):
    """COLOR_0 = linear albedo + the sky the vertex sees; _plumage = (kind/16, along, across, seed)."""
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    C = PLUMAGE
    albedo = np.tile(C["breast"], (len(positions), 1))

    def lay(colour, amount):
        nonlocal albedo
        amount = np.clip(amount, 0.0, 1.0)[:, None]
        albedo = albedo * (1.0 - amount) + colour * amount

    nz, ny = normals[:, 2], normals[:, 1]
    front = _smoothstep(-0.15, 0.45, nz)
    lay(C["back"], (1.0 - front) * np.isin(parts, (PARTS["body"], PARTS["neck"])))
    lay(C["belly"], front * _smoothstep(0.24, 0.12, y) * (parts == PARTS["body"]))
    lay(C["mantle"], (1.0 - front) * _smoothstep(0.26, 0.36, y) * np.isin(parts, (PARTS["body"], PARTS["neck"])))
    head = np.isin(parts, (PARTS["head"], PARTS["face"], PARTS["neck"]))
    lay(C["crown"], head * _smoothstep(0.2, -0.3, nz) * _smoothstep(0.38, 0.44, y))
    # The facial disc: tawny, its rim black down the sides, the brows pale, the white throat below.
    face = (parts == PARTS["face"]) | ((parts == PARTS["head"]) & (nz > 0.45))
    lay(C["disc"], face * 1.0)
    rim_band = (parts == PARTS["face"]) * _smoothstep(0.052, 0.072, np.abs(x)) * _smoothstep(0.3, 0.75, np.abs(normals[:, 0]))
    lay(C["rim"], 0.85 * rim_band)
    brow = (parts == PARTS["face"]) * _smoothstep(0.494, 0.504, y) * _smoothstep(0.08, 0.5, nz)
    lay(C["brow"], 0.8 * brow)
    throat = np.isin(parts, (PARTS["neck"], PARTS["face"], PARTS["body"])) * _smoothstep(0.35, 0.75, nz) \
        * _smoothstep(0.36, 0.4, y) * _smoothstep(0.445, 0.425, y) * _smoothstep(0.05, 0.02, np.abs(x))
    lay(C["throat"], throat)
    legs = np.isin(parts, (PARTS["legL"], PARTS["legR"], PARTS["toeL"], PARTS["toeR"]))
    lay(C["foot"], legs * 1.0)
    lay(C["eye"], (parts == PARTS["eye"]) * 1.0)
    lay(C["bill"], (parts == PARTS["bill"]) * 1.0)
    lay(C["claw"], (parts == PARTS["claw"]) * 1.0)

    sky = occlusion(shape, positions, normals)
    kind = np.full(len(positions), KIND["body"], dtype=np.float64)
    kind[face] = KIND["face"]
    kind[parts == PARTS["eye"]] = KIND["eye"]
    kind[parts == PARTS["bill"]] = KIND["bill"]
    kind[parts == PARTS["claw"]] = KIND["claw"]
    kind[legs] = KIND["foot"]
    # For the body, `along` and `across` hold how much of each pattern it wears (the shader draws them
    # from the rest position): along = bold streaks (upper breast), across = fine bars (belly).
    streak = front * _smoothstep(0.12, 0.2, y) * _smoothstep(0.38, 0.33, y) * (parts == PARTS["body"])
    bars = front * _smoothstep(0.3, 0.18, y) * (parts == PARTS["body"]) + legs * 0.5
    seed = np.zeros(len(positions))
    plumage = np.stack([kind / 16.0, np.clip(streak, 0, 1), np.clip(bars, 0, 1), seed], axis=1)
    colors = np.concatenate([np.clip(albedo, 0.0, 1.0), sky[:, None]], axis=1)
    return colors, plumage


# -- building it ------------------------------------------------------------------------------
FACE = ("head", "face", "eye", "bill")
FACE_SHARE = 0.32


def _collapse(studio, positions, triangles, free, target):
    import bpy
    obj = studio.mesh_object("owl_dense", positions, triangles)
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
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1), loops.reshape(-1, 3)


def decimate(studio, shape, positions, triangles, target, face_share=FACE_SHARE):
    face_parts = [PARTS[name] for name in FACE]

    def face_of(points, tris):
        on_face = np.isin(regions(shape, points), face_parts)
        return on_face, on_face[tris].all(axis=1)

    on_face, face_tris = face_of(positions, triangles)
    positions, triangles = _collapse(studio, positions, triangles, ~on_face,
                                     int(face_tris.sum()) + int(target * (1.0 - face_share)))
    on_face, face_tris = face_of(positions, triangles)
    rest = len(triangles) - int(face_tris.sum())
    positions, triangles = _collapse(studio, positions, triangles, on_face, rest + int(target * face_share))
    return positions, triangles


class Piece:
    """A run of the owl's mesh: positions, normals, triangles, colours, plumage, bone indices and weights."""

    def __init__(self, positions, normals, triangles, colors, plumage, joints_index, weights):
        self.positions, self.normals, self.triangles = positions, normals, triangles
        self.colors, self.plumage, self.joints, self.weights = colors, plumage, joints_index, weights


def _rigid(count, bone_index):
    j = np.zeros((count, 4), dtype=np.int64)
    j[:, 0] = bone_index
    w = np.zeros((count, 4))
    w[:, 0] = 1.0
    return j, w


def feather_piece(feathers, names, mirror_x=False):
    """All `feathers` as one piece (rigid on their bones); mirrored onto the right side if asked."""
    index = {name: i for i, name in enumerate(names)}
    ps, ns, ts, cs, pl, js, ws = [], [], [], [], [], [], []
    offset = 0
    for f in feathers:
        positions, triangles, uv = f.mesh()
        normal = np.tile(f.normal, (len(positions), 1))
        # Each vertex's normal: the vane's own curl tilts it a little across.
        bone = f.bone
        if mirror_x:
            positions = positions * np.array([-1.0, 1.0, 1.0])
            normal = normal * np.array([-1.0, 1.0, 1.0])
            triangles = triangles[:, [0, 2, 1]]
            bone = mirror_name(bone)
        kind = KIND[f.kind]
        base = {
            "primary": PLUMAGE["flight"], "secondary": PLUMAGE["flight"], "covert": PLUMAGE["covert"],
            "under": PLUMAGE["under"], "rectrix": PLUMAGE["tail"], "tuft": PLUMAGE["tuft"],
            "scapular": PLUMAGE["mantle"],
        }[f.kind]
        sky = {"under": 0.55, "covert": 0.9, "scapular": 0.9, "tuft": 0.95}.get(f.kind, 0.85)
        # Near the root a feather is shut away under the ones over it.
        sky_v = sky * (0.55 + 0.45 * _smoothstep(0.0, 0.45, uv[:, 0]))
        colour = np.concatenate([np.tile(base, (len(positions), 1)), sky_v[:, None]], axis=1)
        plumage = np.stack([np.full(len(positions), kind / 16.0), uv[:, 0], uv[:, 1] * 0.5 + 0.5,
                            np.full(len(positions), f.seed)], axis=1)
        j, w = _rigid(len(positions), index[bone])
        ps.append(positions)
        ns.append(normal)
        ts.append(triangles + offset)
        cs.append(colour)
        pl.append(plumage)
        js.append(j)
        ws.append(w)
        offset += len(positions)
    return Piece(np.concatenate(ps), np.concatenate(ns), np.concatenate(ts), np.concatenate(cs),
                 np.concatenate(pl), np.concatenate(js), np.concatenate(ws))


def mirror_name(name):
    """The right side's bone for a left one (humerusL -> humerusR, primaryL3 -> primaryR3); central bones as they are."""
    return re.sub(r"L([0-9]*)$", lambda m: "R" + m.group(1), name)


def arm_piece(names, mirror_x=False):
    index = {name: i for i, name in enumerate(names)}
    positions, triangles, uv, params = arm_loft()
    normals = np.zeros_like(positions)
    face = np.cross(positions[triangles[:, 1]] - positions[triangles[:, 0]],
                    positions[triangles[:, 2]] - positions[triangles[:, 0]])
    for c in range(3):
        np.add.at(normals, triangles[:, c], face)
    normals /= np.maximum(np.linalg.norm(normals, axis=1), 1e-12)[:, None]
    sfx = "R" if mirror_x else "L"
    if mirror_x:
        positions = positions * np.array([-1.0, 1.0, 1.0])
        normals = normals * np.array([-1.0, 1.0, 1.0])
        triangles = triangles[:, [0, 2, 1]]
    # Weights along the arm: chest inside the shoulder, humerus, ulna, hand, blended over the joints.
    stops = [("chest", 0.0), ("humerus" + sfx, 1.0), ("ulna" + sfx, 2.0), ("hand" + sfx, 3.0)]
    j = np.zeros((len(positions), 4), dtype=np.int64)
    w = np.zeros((len(positions), 4))
    for v, p in enumerate(params):
        weights = []
        for name, start in stops:
            # Each bone owns [start, next start), with a 0.12 blend each side of a joint.
            nxt = start + 1.0 if start < 3.0 else 9.0
            a = _smoothstep(start - 0.12, start + 0.12, p) if start > 0.0 else 1.0
            b = 1.0 - (_smoothstep(nxt - 0.12, nxt + 0.12, p) if nxt < 9.0 else 0.0)
            weights.append(float(a * b))
        weights = np.array(weights)
        weights /= max(weights.sum(), 1e-9)
        order = np.argsort(-weights)[:4]
        for slot, k in enumerate(order):
            j[v, slot] = index[stops[k][0]]
            w[v, slot] = weights[k]
    colour = np.concatenate([np.tile(PLUMAGE["arm"], (len(positions), 1)), np.full((len(positions), 1), 0.8)], axis=1)
    plumage = np.stack([np.full(len(positions), KIND["arm"] / 16.0), uv[:, 0], uv[:, 1],
                        np.zeros(len(positions))], axis=1)
    return Piece(positions, normals, triangles, colour, plumage, j, w)


def lid_piece(names, mirror_x=False):
    index = {name: i for i, name in enumerate(names)}
    positions, triangles, uv = lid_mesh()
    normals = positions - EYE
    normals /= np.linalg.norm(normals, axis=1)[:, None]
    sfx = "R" if mirror_x else "L"
    if mirror_x:
        positions = positions * np.array([-1.0, 1.0, 1.0])
        normals = normals * np.array([-1.0, 1.0, 1.0])
        triangles = triangles[:, [0, 2, 1]]
    colour = np.concatenate([np.tile(PLUMAGE["disc"], (len(positions), 1)), np.full((len(positions), 1), 0.85)], axis=1)
    plumage = np.stack([np.full(len(positions), KIND["lid"] / 16.0), uv[:, 0], uv[:, 1] * 0.5 + 0.5,
                        np.zeros(len(positions))], axis=1)
    j, w = _rigid(len(positions), index["lid" + sfx])
    return Piece(positions, normals, triangles, colour, plumage, j, w)


def merge(pieces):
    offset = 0
    tris = []
    for p in pieces:
        tris.append(p.triangles + offset)
        offset += len(p.positions)
    cat = lambda attr: np.concatenate([getattr(p, attr) for p in pieces])  # noqa: E731
    return Piece(cat("positions"), cat("normals"), np.concatenate(tris), cat("colors"), cat("plumage"),
                 cat("joints"), cat("weights"))


class Owl:
    def __init__(self, whole, body_triangles, stats):
        self.positions, self.normals, self.triangles = whole.positions, whole.normals, whole.triangles
        self.colors, self.plumage, self.joints, self.weights = whole.colors, whole.plumage, whole.joints, whole.weights
        self.body_triangles = body_triangles
        self.stats = stats


def body_piece(studio, voxel=VOXEL, target=TARGET_TRIANGLES, log=print):
    shape, landmarks = design()
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
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
    colors, plumage = paint_body(shape, landmarks, positions, normals, parts)
    names = bone_names()
    joints_index, weights = skin_weights(positions, triangles, parts, names)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense=len(dense_triangles), triangles=len(triangles),
                 folds=int(folds), parts={name: int((parts == i).sum()) for name, i in PARTS.items()})
    log("%s body %s" % (TAG, stats))
    return Piece(positions, normals, triangles, colors, plumage, joints_index, weights), stats


def build(studio, voxel=VOXEL, target=TARGET_TRIANGLES, log=print):
    """The whole owl in its rest pose: the soft body, then both wings, the tail, the tufts and the lids."""
    import time
    started = time.time()
    names = bone_names()
    body, body_stats = body_piece(studio, voxel, target, log)
    left = wing_feathers() + tail_feathers() + scapulars() + tufts()
    pieces = [
        body,
        feather_piece(left, names), feather_piece(left, names, mirror_x=True),
        arm_piece(names), arm_piece(names, mirror_x=True),
        lid_piece(names), lid_piece(names, mirror_x=True),
    ]
    whole = merge(pieces)
    low, high = whole.positions.min(axis=0), whole.positions.max(axis=0)
    stats = dict(body=body_stats, feathers=len(left) * 2, vertices=len(whole.positions),
                 triangles=len(whole.triangles), bones=len(names),
                 low=[round(float(v), 4) for v in low], high=[round(float(v), 4) for v in high],
                 seconds=round(time.time() - started, 1))
    log("%s %s" % (TAG, stats))
    return Owl(whole, len(body.triangles), stats)
