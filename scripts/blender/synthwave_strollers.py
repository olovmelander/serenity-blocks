"""Synthwave Sunset's strollers: the people out on the pier, authored procedurally in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/synthwave_strollers.py -- \
        --out src/themes/synthwave-sunset/assets/strollers.glb [--preview <dir>]

A small cast for the evening on the pier, seen 10 to 30 px tall in a game frame, so each one is
built for its silhouette and its walk: three builds (a woman, a man, a child) with their own
proportions, and on them the shapes that tell people apart at a distance: a sundress and a wide
sun hat, a midi skirt and a bun, slacks and a ponytail, shorts and a cap, chinos, a light jacket
and a boater, and two children. About 900 triangles each.

Every figure is skinned to one skeleton of thirteen bones (the hips, the chest, the head, a thigh,
shin and foot a leg, an upper arm and forearm an arm), in its own frame: x to its left, y up, z
forward, metres, the soles on y = 0, standing straight with the arms hanging. Each vertex carries
two bones and the second one's weight in a custom attribute `_bones` (a, b, w), eased across a
band at every joint so the knees and elbows bend instead of creasing, and in `_paint` (slot, sky,
0) what it is (skin, hair, top, bottom, shoes, hat, hat band: the theme dresses every person in
colours of their own) and how open it is to the sky (the inside of an arm, under a brim). The
skeleton's rest joints ride on each figure as glTF extras (`joints`, 13 x 3 numbers); the theme
poses the bones about them on the CPU (synthwave-sunset-strollers.js) and skins every person in
one draw.

Deterministic: the same script writes the same file.
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy

TAG = "[synthwave-strollers]"

# ── The skeleton ──────────────────────────────────────────────────────────────

BONES = ("hips", "chest", "head", "thighL", "shinL", "footL", "thighR", "shinR", "footR",
         "armL", "forearmL", "armR", "forearmR")
PARENTS = (-1, 0, 1, 0, 3, 4, 0, 6, 7, 1, 9, 1, 11)
B = {name: i for i, name in enumerate(BONES)}
# Limbs a touch thicker than life: the figures are seen 10 to 30 px tall.
THICK = 1.08
SLOT = {"skin": 0, "hair": 1, "top": 2, "bottom": 3, "shoes": 4, "hat": 5, "band": 6}


def clamp01(x):
    return max(0.0, min(1.0, x))


def smooth(e0, e1, x):
    t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def catmull(keys, y):
    """Smooth interpolation through (y, *values) keys sorted by y (clamped at the ends)."""
    if y <= keys[0][0]:
        return keys[0][1:]
    if y >= keys[-1][0]:
        return keys[-1][1:]
    for i in range(len(keys) - 1):
        if keys[i][0] <= y <= keys[i + 1][0]:
            break
    k0 = keys[max(i - 1, 0)]
    k1 = keys[i]
    k2 = keys[i + 1]
    k3 = keys[min(i + 2, len(keys) - 1)]
    h = k2[0] - k1[0]
    t = (y - k1[0]) / h
    out = []
    for j in range(1, len(k1)):
        # Tangents scaled to the span (non-uniform keys), clamped at the ends.
        m1 = (k2[j] - k0[j]) / (k2[0] - k0[0]) * h if k2[0] != k0[0] else 0.0
        m2 = (k3[j] - k1[j]) / (k3[0] - k1[0]) * h if k3[0] != k1[0] else 0.0
        t2 = t * t
        t3 = t2 * t
        out.append((2 * t3 - 3 * t2 + 1) * k1[j] + (t3 - 2 * t2 + t) * m1
                   + (-2 * t3 + 3 * t2) * k2[j] + (t3 - t2) * m2)
    return tuple(out)


# ── The three builds (person frame: x left, y up, z forward; metres) ─────────────
# Joints: the hips (root), the chest (the spine's bend at the waist), the head (the top of the
# neck); the hip, knee and ankle heights and the hip's offset; the shoulder, elbow and wrist.
# torso: (y, half width, half depth, centre z) from the crotch up to the base of the neck.

BUILDS = {
    "woman": dict(
        height=1.68, root=0.93, waist=1.04, neck=1.47,
        hip=(0.085, 0.855), knee=0.47, ankle=0.075,
        shoulder=(0.152, 1.335, -0.008), elbow=(0.172, 1.065, -0.014), wrist=(0.184, 0.832, 0.0),
        torso=[
            (0.772, 0.07, 0.05, 0.0), (0.80, 0.152, 0.094, -0.006), (0.862, 0.17, 0.106, -0.013),
            (0.93, 0.162, 0.099, -0.009), (0.99, 0.137, 0.087, -0.001), (1.045, 0.12, 0.08, 0.003),
            (1.11, 0.128, 0.085, 0.008), (1.17, 0.139, 0.097, 0.017), (1.228, 0.146, 0.108, 0.021),
            (1.288, 0.15, 0.096, 0.008), (1.333, 0.165, 0.08, -0.004), (1.368, 0.143, 0.069, -0.01),
            (1.393, 0.085, 0.057, -0.01), (1.41, 0.042, 0.044, -0.008),
        ],
        neck_r=0.042, neck_span=(1.38, 1.5),
        head=dict(c=(0.0, 1.561, 0.012), r=(0.076, 0.117, 0.098)),
        leg=dict(thigh=0.087, knee=0.046, calf=0.052, ankle=0.03),
        arm=dict(upper=0.04, elbow=0.031, fore=0.033, wrist=0.023, hand=0.158),
        foot=dict(length=0.232, width=0.037, height=0.068),
        belt=1.0,
    ),
    "man": dict(
        height=1.79, root=0.995, waist=1.11, neck=1.575,
        hip=(0.094, 0.915), knee=0.505, ankle=0.08,
        shoulder=(0.178, 1.43, -0.01), elbow=(0.196, 1.14, -0.016), wrist=(0.206, 0.886, 0.0),
        torso=[
            (0.828, 0.072, 0.055, 0.0), (0.86, 0.152, 0.097, -0.006), (0.92, 0.162, 0.103, -0.01),
            (0.99, 0.156, 0.099, -0.006), (1.06, 0.15, 0.097, 0.002), (1.12, 0.15, 0.099, 0.008),
            (1.2, 0.159, 0.106, 0.012), (1.29, 0.173, 0.112, 0.014), (1.37, 0.181, 0.105, 0.006),
            (1.428, 0.199, 0.09, -0.006), (1.468, 0.166, 0.076, -0.012), (1.494, 0.098, 0.064, -0.012),
            (1.512, 0.054, 0.05, -0.01),
        ],
        neck_r=0.05, neck_span=(1.48, 1.6),
        head=dict(c=(0.0, 1.668, 0.012), r=(0.081, 0.124, 0.104)),
        leg=dict(thigh=0.091, knee=0.05, calf=0.057, ankle=0.033),
        arm=dict(upper=0.048, elbow=0.037, fore=0.039, wrist=0.027, hand=0.178),
        foot=dict(length=0.262, width=0.042, height=0.076),
        belt=1.045,
    ),
    "child": dict(
        height=1.2, root=0.65, waist=0.72, neck=1.0,
        hip=(0.064, 0.6), knee=0.33, ankle=0.055,
        shoulder=(0.114, 0.925, -0.006), elbow=(0.125, 0.755, -0.01), wrist=(0.132, 0.597, 0.0),
        torso=[
            (0.553, 0.05, 0.04, 0.0), (0.575, 0.104, 0.075, 0.0), (0.62, 0.112, 0.08, -0.005),
            (0.68, 0.107, 0.079, 0.004), (0.74, 0.106, 0.082, 0.012), (0.81, 0.109, 0.08, 0.009),
            (0.87, 0.117, 0.075, 0.003), (0.918, 0.126, 0.065, -0.005), (0.948, 0.101, 0.057, -0.008),
            (0.968, 0.048, 0.041, -0.006),
        ],
        neck_r=0.033, neck_span=(0.94, 1.03),
        head=dict(c=(0.0, 1.098, 0.01), r=(0.073, 0.1, 0.087)),
        leg=dict(thigh=0.06, knee=0.035, calf=0.039, ankle=0.024),
        arm=dict(upper=0.031, elbow=0.025, fore=0.026, wrist=0.019, hand=0.115),
        foot=dict(length=0.178, width=0.031, height=0.058),
        belt=0.7,
    ),
}


def joints_of(bd):
    """The thirteen rest joints, in BONES order."""
    hx, hy = bd["hip"]
    sx, sy, sz = bd["shoulder"]
    ex, ey, ez = bd["elbow"]
    out = {
        "hips": (0.0, bd["root"], 0.0),
        "chest": (0.0, bd["waist"], 0.0),
        "head": (0.0, bd["neck"], -0.004),
    }
    for side, s in (("L", 1.0), ("R", -1.0)):
        out["thigh" + side] = (hx * s, hy, 0.0)
        out["shin" + side] = (hx * s, bd["knee"], 0.004)
        out["foot" + side] = (hx * s, bd["ankle"], -0.004)
        out["arm" + side] = (sx * s, sy, sz)
        out["forearm" + side] = (ex * s, ey, ez)
    return [out[name] for name in BONES]


# ── The cast: one figure per outfit ───────────────────────────────────────────
# top: (cut, sleeves) — sleeves none | short | rolled | long; bottom: (kind, length) — skirt
# knee | midi, trousers ankle, shorts knee. A "dress" is top and skirt in the top's colour.

CAST = [
    dict(name="sundress", build="woman", top=("dress", "none"), bottom=("skirt", "knee"), hair="long", hat="sunhat"),
    dict(name="midi", build="woman", top=("blouse", "short"), bottom=("skirt", "midi"), hair="bun", hat=None),
    dict(name="slacks", build="woman", top=("tee", "short"), bottom=("trousers", "ankle"), hair="ponytail", hat=None),
    dict(name="shorts", build="man", top=("tee", "short"), bottom=("shorts", "knee"), hair="short", hat="cap"),
    dict(name="chinos", build="man", top=("shirt", "rolled"), bottom=("trousers", "ankle"), hair="short", hat=None),
    dict(name="boater", build="man", top=("jacket", "long"), bottom=("trousers", "ankle"), hair="short", hat="boater"),
    dict(name="boy", build="child", top=("tee", "short"), bottom=("shorts", "knee"), hair="short", hat=None),
    dict(name="girl", build="child", top=("dress", "short"), bottom=("skirt", "knee"), hair="pigtails", hat=None),
]


# ── The mesh, built as plain lists in the person's frame ─────────────────────────

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.bones = []   # per vertex: (a, b, w)
        self.slots = []   # per vertex: slot
        self.fronts = []  # per face: whether its winding was checked (all are)

    def vert(self, p, skin, slot):
        self.verts.append(tuple(float(c) for c in p))
        a, b, w = skin
        self.bones.append((float(a), float(b), float(clamp01(w))))
        self.slots.append(int(slot))
        return len(self.verts) - 1

    def loft(self, rings, skin, slot, ref, wrap=True, loop=False, cap_start=False, cap_end=False):
        """Join rings of equal length into a surface; orient it to face away from `ref` (a point
        inside, or a function of a face's centre giving the inside point)."""
        idx = [[self.vert(p, skin(p), slot) for p in ring] for ring in rings]
        n = len(rings[0])
        faces = []
        count = len(idx) if loop else len(idx) - 1
        for r in range(count):
            a_ring = idx[r]
            b_ring = idx[(r + 1) % len(idx)]
            for k in range(n if wrap else n - 1):
                j = (k + 1) % n
                faces.append([a_ring[k], a_ring[j], b_ring[j], b_ring[k]])
        # A cap fans its end ring to its centre (or to the point given); start and end wind
        # opposite ways so the whole shell keeps one orientation.
        for flag, ids, ring, first in ((cap_start, idx[0], rings[0], True), (cap_end, idx[-1], rings[-1], False)):
            if flag is False or flag is None:
                continue
            centre = tuple(flag) if isinstance(flag, tuple) else tuple(sum(p[i] for p in ring) / n for i in range(3))
            ci = self.vert(centre, skin(centre), slot)
            for k in range(n):
                j = (k + 1) % n
                faces.append([ci, ids[j], ids[k]] if first else [ci, ids[k], ids[j]])
        # Orient: most faces must face away from the inside.
        score = 0.0
        for f in faces:
            nrm = self.face_normal(f)
            c = self.face_centre(f)
            inside = ref(c) if callable(ref) else ref
            score += sum(nrm[i] * (c[i] - inside[i]) for i in range(3))
        if score < 0:
            faces = [list(reversed(f)) for f in faces]
        self.faces.extend(faces)

    def face_normal(self, f):
        p = [self.verts[i] for i in f]
        nx = ny = nz = 0.0
        for i in range(len(p)):
            a = p[i]
            b = p[(i + 1) % len(p)]
            nx += (a[1] - b[1]) * (a[2] + b[2])
            ny += (a[2] - b[2]) * (a[0] + b[0])
            nz += (a[0] - b[0]) * (a[1] + b[1])
        return (nx, ny, nz)

    def face_centre(self, f):
        p = [self.verts[i] for i in f]
        return tuple(sum(q[i] for q in p) / len(p) for i in range(3))


def ring_h(c, rx, rz, n, start=0.0, end=None):
    """A horizontal ring (or arc from `start` to `end`, radians from forward toward its left)."""
    if end is None:
        return [(c[0] + rx * math.sin(start + 2 * math.pi * k / n), c[1],
                 c[2] + rz * math.cos(start + 2 * math.pi * k / n)) for k in range(n)]
    return [(c[0] + rx * math.sin(start + (end - start) * k / (n - 1)), c[1],
             c[2] + rz * math.cos(start + (end - start) * k / (n - 1))) for k in range(n)]


def split_spans(ys, hems):
    """Sorted heights with the hems inserted, cut into spans at the hems."""
    lo, hi = min(ys), max(ys)
    cuts = sorted(h for h in hems if lo + 1e-4 < h < hi - 1e-4)
    allys = sorted(set([round(y, 6) for y in ys] + [round(h, 6) for h in cuts]))
    spans = [[]]
    for y in allys:
        spans[-1].append(y)
        if any(abs(y - h) < 1e-6 for h in cuts):
            spans.append([y])
    return [s for s in spans if len(s) > 1]


def densify(ys, step):
    out = [ys[0]]
    for a, b in zip(ys, ys[1:]):
        k = max(1, int(math.ceil((b - a) / step - 1e-6)))
        out.extend(a + (b - a) * i / k for i in range(1, k + 1))
    return out


# ── Skinning rules ────────────────────────────────────────────────────────────

def skin_torso(bd):
    sx, sy, _ = bd["shoulder"]

    def f(p):
        x, y, _z = p
        w = smooth(bd["waist"] - 0.08, bd["waist"] + 0.07, y)
        if y > sy - 0.1 and abs(x) > sx - 0.07:
            # The top of the shoulder follows the arm a little.
            arm = B["armL"] if x > 0 else B["armR"]
            return (B["chest"], arm, 0.45 * smooth(sx - 0.07, sx + 0.01, abs(x)) * smooth(sy - 0.1, sy - 0.03, y))
        return (B["hips"], B["chest"], w)
    return f


def skin_leg(bd, side):
    th, sh, ft = B["thigh" + side], B["shin" + side], B["foot" + side]
    hy = bd["hip"][1]
    ky = bd["knee"]
    ay = bd["ankle"]

    def f(p):
        y = p[1]
        if y > hy - 0.1:
            return (B["hips"], th, smooth(hy + 0.07, hy - 0.08, y))
        if y > ky + 0.06:
            return (th, sh, 0.0)
        if y > ky - 0.06:
            return (th, sh, smooth(ky + 0.05, ky - 0.05, y))
        if y > ay + 0.05:
            return (sh, ft, 0.0)
        return (sh, ft, smooth(ay + 0.045, ay - 0.005, y))
    return f


def skin_foot(bd, side):
    sh, ft = B["shin" + side], B["foot" + side]
    ay = bd["ankle"]

    def f(p):
        return (sh, ft, 1.0 - 0.6 * smooth(ay - 0.01, ay + 0.03, p[1]) * smooth(0.04, -0.02, p[2]))
    return f


def arm_param(bd, y):
    """0 at the shoulder, 1 at the wrist (by height)."""
    return (bd["shoulder"][1] - y) / (bd["shoulder"][1] - bd["wrist"][1])


def skin_arm(bd, side):
    up, fo = B["arm" + side], B["forearm" + side]
    fe = arm_param(bd, bd["elbow"][1])

    def f(p):
        t = arm_param(bd, p[1])
        if t < 0.16:
            return (B["chest"], up, smooth(-0.14, 0.12, t))
        if t < fe - 0.09:
            return (up, fo, 0.0)
        if t < fe + 0.09:
            return (up, fo, smooth(fe - 0.08, fe + 0.08, t))
        return (up, fo, 1.0)
    return f


def skin_neck(bd):
    lo, _hi = bd["neck_span"]

    def f(p):
        return (B["chest"], B["head"], smooth(lo + 0.02, bd["neck"] + 0.015, p[1]))
    return f


def skin_head(_bd):
    return lambda p: (B["head"], B["head"], 0.0)


def skin_hang(bd, top, bottom, share=1.0):
    """Hair that hangs from the head onto the back: the head's at the top, the chest's below."""
    return lambda p: (B["head"], B["chest"], share * smooth(top, bottom, p[1]))


def skin_skirt(bd, hem):
    hy = bd["hip"][1]

    def f(p):
        x, y, _z = p
        thigh = B["thighL"] if x > 0 else B["thighR"]
        w = 0.82 * smooth(hy - 0.02, hem, y) * smooth(0.0, 0.07, abs(x))
        return (B["hips"], thigh, w)
    return f


# ── Body parts ────────────────────────────────────────────────────────────────

def build_torso(b, bd, slot_at):
    keys = bd["torso"]
    ys = [k[0] for k in keys]
    hems = [bd["belt"]]
    skin = skin_torso(bd)
    spans = split_spans(ys, hems)
    for i, span in enumerate(spans):
        rings = []
        for y in span:
            rx, rz, zc = catmull(keys, y)
            rings.append(ring_h((0.0, y, zc), rx, rz, 10))
        mid = 0.5 * (span[0] + span[-1])
        b.loft(rings, skin, slot_at(mid), lambda c, y0=mid: (0.0, c[1], 0.0),
               cap_start=(i == 0), cap_end=(i == len(spans) - 1))


def build_neck(b, bd):
    lo, hi = bd["neck_span"]
    r = bd["neck_r"]
    rings = [ring_h((0.0, y, -0.006), r * (1.06 - 0.06 * (y - lo) / (hi - lo)), r * 0.95, 8)
             for y in (lo, lo + (hi - lo) * 0.5, hi)]
    b.loft(rings, skin_neck(bd), SLOT["skin"], lambda c: (0.0, c[1], -0.006))


def build_head(b, bd):
    c = bd["head"]["c"]
    rx, ry, rz = bd["head"]["r"]
    rings = []
    lats = [math.radians(a) for a in (160, 138, 114, 90, 66, 42, 20)]
    for phi in lats:
        s = math.sin(phi)
        below = smooth(90, 160, math.degrees(phi))
        # A jaw: the lower head narrows and comes forward a touch.
        sx = s * (1.0 - 0.2 * below)
        rings.append(ring_h((c[0], c[1] + ry * math.cos(phi), c[2] + 0.012 * below), rx * sx, rz * s * (1.0 - 0.08 * below), 10))
    b.loft(rings, skin_head(bd), SLOT["skin"], c, cap_start=True, cap_end=True)


def build_leg(b, bd, side, slot_at):
    s = 1.0 if side == "L" else -1.0
    hx, hy = bd["hip"]
    ky = bd["knee"]
    ay = bd["ankle"]
    lg = {k: v * THICK for k, v in bd["leg"].items()}
    # (y, r, centre z)
    keys = [
        (ay, lg["ankle"], -0.004),
        (ay + 0.06, lg["ankle"] * 1.12, -0.006),
        (ky - 0.27 * (ky - ay) / 0.4, lg["calf"] * 0.8, -0.008),
        (ky - 0.15 * (ky - ay) / 0.4, lg["calf"], -0.012),
        (ky - 0.06, lg["calf"] * 0.95, -0.006),
        (ky, lg["knee"], 0.004),
        (ky + 0.09, lg["knee"] * 1.2, 0.002),
        (hy - 0.2, lg["thigh"] * 0.84, 0.0),
        (hy - 0.07, lg["thigh"] * 0.96, -0.002),
        (hy + 0.0, lg["thigh"] * 0.8, -0.004),
    ]
    keys.sort()
    ys = [k[0] for k in keys]
    skin = skin_leg(bd, side)
    spans = split_spans(ys, slot_at("hems"))
    for i, span in enumerate(spans):
        rings = []
        for y in span:
            r, zc = catmull(keys, y)
            # Legs taper in toward the knees a little.
            x = s * (hx - 0.012 * smooth(hy, ky, y) + 0.004 * smooth(ky, ay, y) - 0.016 * smooth(hy - 0.08, hy, y))
            rings.append(ring_h((x, y, zc), r, r * 1.04, 8))
        mid = 0.5 * (span[0] + span[-1])
        b.loft(rings, skin, slot_at(mid), lambda c, x0=s * hx: (x0, c[1], 0.0),
               cap_start=(i == 0), cap_end=(i == len(spans) - 1))


def build_foot(b, bd, side):
    s = 1.0 if side == "L" else -1.0
    ft = bd["foot"]
    L = ft["length"]
    w = ft["width"]
    h = ft["height"]
    x0 = s * (bd["hip"][0] - 0.008)
    # (z, half width, half height, centre y), heel to toe.
    keys = [
        (-0.26 * L, w * 0.72, h * 0.42, h * 0.5),
        (-0.2 * L, w * 0.92, h * 0.62, h * 0.62),
        (-0.04 * L, w * 1.0, h * 0.72, h * 0.72),
        (0.2 * L, w * 1.12, h * 0.55, h * 0.55),
        (0.44 * L, w * 1.12, h * 0.42, h * 0.42),
        (0.64 * L, w * 0.95, h * 0.33, h * 0.33),
        (0.74 * L, w * 0.55, h * 0.24, h * 0.26),
    ]
    rings = []
    for z, hw, hh, yc in keys:
        rings.append([(x0 + hw * math.sin(2 * math.pi * k / 7), yc + hh * math.cos(2 * math.pi * k / 7), z) for k in range(7)])
    b.loft(rings, skin_foot(bd, side), SLOT["shoes"], lambda c: (x0, h * 0.45, c[2]), cap_start=True, cap_end=True)


def build_arm(b, bd, side, slot_at):
    s = 1.0 if side == "L" else -1.0
    sx, sy, sz = bd["shoulder"]
    ex, ey, ez = bd["elbow"]
    wx, wy, wz = bd["wrist"]
    am = {k: (v * THICK if k != "hand" else v) for k, v in bd["arm"].items()}
    fe = arm_param(bd, ey)
    # (t along shoulder..wrist, r)
    keys = [(-0.07, am["upper"] * 0.4), (-0.035, am["upper"] * 0.84), (0.03, am["upper"] * 1.0), (0.2, am["upper"]), (fe - 0.12, am["upper"] * 0.88),
            (fe, am["elbow"]), (fe + 0.14, am["fore"]), (0.85, am["fore"] * 0.82), (1.0, am["wrist"])]
    ts = [k[0] for k in keys]
    hems = [h for h in slot_at("sleeve")]
    skin = skin_arm(bd, side)

    def centre(t):
        if t <= fe:
            u = (t - 0.0) / fe
            return (s * lerp(sx, ex, u), lerp(sy, ey, u), lerp(sz, ez, u))
        u = (t - fe) / (1.0 - fe)
        return (s * lerp(ex, wx, u), lerp(ey, wy, u), lerp(ez, wz, u))

    spans = split_spans(ts, hems)
    for i, span in enumerate(spans):
        rings = []
        for t in span:
            (r,) = catmull(keys, t)
            c = centre(t)
            flat = 0.86 if t > fe else 1.0
            rings.append(ring_h(c, r * flat, r, 7))
        # Rings run down the arm (t grows as y falls): reverse so heights rise along the loft.
        mid = 0.5 * (span[0] + span[-1])
        b.loft(rings, skin, slot_at(mid), lambda c: centre(arm_param(bd, c[1])),
               cap_start=(i == 0), cap_end=(i == len(spans) - 1))
    # The hand: flat across (palm to the thigh), wide front to back, a slight curl.
    hl = am["hand"]
    w0 = am["wrist"]
    hl *= 0.86
    hand_keys = [(0.0, w0 * 0.72, w0 * 1.05, 0.0), (0.28, w0 * 0.66, w0 * 1.32, 0.003),
                 (0.6, w0 * 0.56, w0 * 1.26, 0.008), (0.86, w0 * 0.45, w0 * 0.92, 0.012), (1.0, w0 * 0.28, w0 * 0.45, 0.014)]
    rings = []
    for t, hx, hz, dz in hand_keys:
        c = (s * (wx + 0.006 * t), wy - hl * t, wz + dz)
        rings.append(ring_h(c, hx, hz, 6))
    hskin = skin_arm(bd, side)
    b.loft(rings, hskin, SLOT["skin"], lambda c: (s * wx, c[1], wz + 0.01), cap_start=True, cap_end=True)


# ── Clothes, hair, hats ───────────────────────────────────────────────────────

def skirt_hem(bd, length):
    return bd["knee"] - 0.035 if length == "knee" else bd["knee"] - 0.17


def build_skirt(b, bd, slot, length):
    keys = bd["torso"]
    top = bd["belt"] + 0.01
    hem = skirt_hem(bd, length)
    flare = (0.2, 0.19) if length == "knee" else (0.215, 0.205)
    if bd["height"] < 1.3:
        flare = (0.15, 0.14)
    # Above the hips it follows the body (a hair outside); below, an A-line out to the hem.
    widest = max(keys, key=lambda k: k[1])[0]
    rx_w, rz_w, zc_w = catmull(keys, widest)
    rows = []
    for y in densify([hem, widest - 0.05, widest, (widest + top) / 2, top], 0.09):
        if y >= widest:
            rx, rz, zc = catmull(keys, y)
            rows.append((y, rx + 0.009, rz + 0.009, zc))
        else:
            t = (widest - y) / (widest - hem)
            e = t ** 1.15
            rows.append((y, lerp(rx_w + 0.01, flare[0], e), lerp(rz_w + 0.01, flare[1], e), lerp(zc_w, 0.004, t)))
    rows.sort()
    rings = [ring_h((0.0, y, zc), rx, rz, 11) for y, rx, rz, zc in rows]
    b.loft(rings, skin_skirt(bd, hem), slot, lambda c: (0.0, c[1], 0.0))


def cap_rings(c, r, grow, phimax, n=12, k=5, lift=0.0):
    """A shell over the head from the crown down to phimax(theta) (degrees), radii grown by
    `grow` (m) at the crown tapering to a third at the edge."""
    rows = []
    for i in range(1, k + 1):
        row = []
        for j in range(n):
            th = 2 * math.pi * j / n
            phi = math.radians(phimax(th)) * i / k
            g = grow * (1.0 - 0.66 * i / k)
            x = c[0] + (r[0] + g) * math.sin(phi) * math.sin(th)
            y = c[1] + lift * (1 - i / k) + (r[1] + g) * math.cos(phi)
            z = c[2] + (r[2] + g) * math.sin(phi) * math.cos(th)
            row.append((x, y, z))
        rows.append(row)
    return rows


def hairline(front, side, back):
    def f(th):
        cth = math.cos(th)
        if cth >= 0:
            return lerp(side, front, cth)
        return lerp(side, back, -cth)
    return f


def build_hair(b, bd, style, hatted=False):
    c = bd["head"]["c"]
    r = bd["head"]["r"]
    slot = SLOT["hair"]
    head = skin_head(bd)
    if style == "short":
        rows = cap_rings(c, r, 0.005 if hatted else 0.016, hairline(56, 84, 104), n=10, lift=0.0 if hatted else 0.008)
    elif style == "pigtails":
        rows = cap_rings(c, r, 0.012, hairline(60, 96, 112), n=10)
    else:
        rows = cap_rings(c, r, 0.015, hairline(62, 98, 116), n=10, lift=0.006)
    top = (c[0], c[1] + r[1] + 0.016, c[2])
    b.loft(rows, head, slot, c, cap_start=top)

    sy = bd["shoulder"][1]
    if style == "long":
        # A curtain from the back of the head down over the shoulder blades, wider at its ends.
        rows = []
        end = sy - 0.14
        for y in densify([end, sy - 0.04, c[1] - r[1] * 0.75, c[1] - 0.02], 0.06):
            u = smooth(c[1] - 0.02, end, y)
            span = math.radians(lerp(78, 112, u))
            rx = lerp(r[0] + 0.018, 0.12, smooth(c[1] - r[1] * 0.75, end, y))
            rz = lerp(r[2] + 0.018, 0.1, smooth(c[1] - r[1] * 0.75, end, y))
            if c[1] - r[1] * 0.75 > y > sy - 0.04:
                rx = lerp(r[0] + 0.012, 0.1, smooth(c[1] - r[1] * 0.75, sy - 0.04, y))
            zc = lerp(c[2] - 0.004, -0.03, u)
            rows.append(ring_h((0.0, y, zc), rx, rz, 9, start=math.pi - span, end=math.pi + span))
        rows.sort(key=lambda ring: ring[0][1])
        b.loft(rows, skin_hang(bd, c[1] - 0.04, sy - 0.04), slot, lambda q: (0.0, q[1], q[2] + 0.06), wrap=False)
    elif style == "bun":
        bc = (0.0, c[1] + r[1] * 0.55, c[2] - r[2] * 0.82)
        rings = [ring_h((bc[0], bc[1] + 0.04 * math.cos(a), bc[2]), 0.044 * math.sin(a), 0.04 * math.sin(a), 8)
                 for a in (math.radians(v) for v in (155, 120, 85, 50, 22))]
        b.loft(rings, head, slot, bc, cap_start=True, cap_end=True)
    elif style == "ponytail":
        pts = [(0.0, c[1] + 0.045, c[2] - r[2] * 0.92), (0.0, c[1] - 0.005, c[2] - r[2] - 0.035),
               (0.0, c[1] - 0.1, c[2] - r[2] - 0.045), (0.0, c[1] - 0.2, c[2] - r[2] - 0.03)]
        tube_along(b, pts, [0.03, 0.033, 0.026, 0.009], skin_hang(bd, c[1] - 0.06, c[1] - 0.22, 0.6), slot, n=7)
    elif style == "pigtails":
        for s in (1.0, -1.0):
            pts = [(s * (r[0] + 0.002), c[1] + 0.005, c[2] - 0.035), (s * (r[0] + 0.03), c[1] - 0.035, c[2] - 0.045),
                   (s * (r[0] + 0.038), c[1] - 0.1, c[2] - 0.04), (s * (r[0] + 0.03), c[1] - 0.15, c[2] - 0.035)]
            tube_along(b, pts, [0.022, 0.024, 0.017, 0.007], skin_hang(bd, c[1] - 0.05, c[1] - 0.2, 0.5), slot, n=6)


def tube_along(b, pts, radii, skin, slot, n=7):
    rings = []
    for i, p in enumerate(pts):
        a = pts[max(i - 1, 0)]
        q = pts[min(i + 1, len(pts) - 1)]
        t = [q[k] - a[k] for k in range(3)]
        tl = math.sqrt(sum(v * v for v in t)) or 1.0
        t = [v / tl for v in t]
        ref = (1.0, 0.0, 0.0) if abs(t[0]) < 0.8 else (0.0, 0.0, 1.0)
        u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]
        ul = math.sqrt(sum(v * v for v in u))
        u = [v / ul for v in u]
        v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]]
        rr = radii[i]
        rings.append([tuple(p[k] + rr * (math.cos(2 * math.pi * j / n) * u[k] + math.sin(2 * math.pi * j / n) * v[k]) for k in range(3))
                      for j in range(n)])

    def inside(cc):
        best = min(pts, key=lambda p: sum((p[k] - cc[k]) ** 2 for k in range(3)))
        return best
    b.loft(rings, skin, slot, inside, cap_start=True, cap_end=True)


def build_hat(b, bd, kind):
    c = bd["head"]["c"]
    r = bd["head"]["r"]
    head = skin_head(bd)
    if kind == "sunhat":
        rows = cap_rings((c[0], c[1] + 0.012, c[2]), (r[0] * 1.08, r[1], r[2] * 1.06), 0.02, lambda th: 74, k=4)
        top = (c[0], c[1] + 0.012 + r[1] + 0.02, c[2])
        b.loft(rows, head, SLOT["hat"], c, cap_start=top)
        edge = rows[-1]
        yb = sum(p[1] for p in edge) / len(edge)
        rin_x = max(abs(p[0] - c[0]) for p in edge)
        rin_z = max(abs(p[2] - c[2]) for p in edge)
        out_r = 0.215
        prof = [(rin_x, rin_z, yb + 0.004), (out_r * 0.6 + rin_x * 0.4, out_r * 0.6 + rin_z * 0.4, yb - 0.008),
                (out_r, out_r * 0.97, yb - 0.038), (out_r - 0.004, out_r * 0.97 - 0.004, yb - 0.046),
                (out_r * 0.6 + rin_x * 0.4, out_r * 0.6 + rin_z * 0.4, yb - 0.016), (rin_x, rin_z, yb - 0.006)]
        rings = [ring_h((c[0], y, c[2]), rx, rz, 14) for rx, rz, y in prof]
        b.loft(rings, head, SLOT["hat"], lambda q: (c[0] + 0.6 * (q[0] - c[0]), yb - 0.02, c[2] + 0.6 * (q[2] - c[2])), loop=True)
        band = [ring_h((c[0], y, c[2]), rin_x + 0.003, rin_z + 0.003, 12) for y in (yb + 0.002, yb + 0.03)]
        b.loft(band, head, SLOT["band"], (c[0], yb + 0.016, c[2]))
    elif kind == "cap":
        grow = 0.011
        front = 64
        rows = cap_rings((c[0], c[1] + 0.004, c[2]), r, grow, hairline(front, 88, 100), k=4)
        top = (c[0], c[1] + 0.004 + r[1] + grow, c[2])
        b.loft(rows, head, SLOT["hat"], c, cap_start=top)
        g = grow * 0.34
        yb = c[1] + 0.004 + (r[1] + g) * math.cos(math.radians(front))
        rx = (r[0] + g) * math.sin(math.radians(front)) + 0.004
        rz = (r[2] + g) * math.sin(math.radians(front)) + 0.004
        span = math.radians(66)
        arcs = []
        for out, dy in ((0.0, 0.0), (0.045, -0.007), (0.085, -0.019)):
            arcs.append(ring_h((c[0], yb + dy, c[2]), rx + out * 0.5, rz + out, 9, start=-span, end=span))
        # Top surface and underside of the visor (a thin wedge).
        under = [[(p[0], p[1] - 0.006, p[2]) for p in arc] for arc in reversed(arcs)]
        b.loft(arcs + under, head, SLOT["hat"], lambda q: (c[0], yb - 0.003, c[2]), wrap=False)
    elif kind == "boater":
        yb = c[1] + r[1] * 0.38
        cr_x = r[0] + 0.022
        cr_z = r[2] + 0.022
        crown = [ring_h((c[0], y, c[2] - 0.004), cr_x, cr_z, 14) for y in (yb, yb + 0.03, yb + 0.084)]
        b.loft(crown[:2], head, SLOT["band"], (c[0], yb + 0.04, c[2]))
        b.loft(crown[1:], head, SLOT["hat"], (c[0], yb + 0.04, c[2]), cap_end=True)
        out_r = 0.155
        prof = [(cr_x, cr_z, yb + 0.003), (out_r, out_r * 0.98, yb - 0.004), (out_r, out_r * 0.98, yb - 0.011), (cr_x, cr_z, yb - 0.004)]
        rings = [ring_h((c[0], y, c[2] - 0.004), rx, rz, 18) for rx, rz, y in prof]
        b.loft(rings, head, SLOT["hat"], lambda q: (c[0] + 0.7 * (q[0] - c[0]), yb - 0.004, c[2] + 0.7 * (q[2] - c[2])), loop=True)


# ── A figure ──────────────────────────────────────────────────────────────────

def build_figure(spec):
    bd = BUILDS[spec["build"]]
    b = Builder()
    top_cut, sleeves = spec["top"]
    bottom_kind, bottom_len = spec["bottom"]
    dress = top_cut == "dress"
    ky = bd["knee"]
    ay = bd["ankle"]
    belt = bd["belt"]
    top_slot = SLOT["top"]
    low_slot = SLOT["top"] if dress else SLOT["bottom"]

    def torso_slot(y):
        return low_slot if y < belt else top_slot
    build_torso(b, bd, torso_slot)
    build_neck(b, bd)
    build_head(b, bd)

    if bottom_kind == "trousers":
        hem = ay + 0.035
    elif bottom_kind == "shorts":
        hem = ky + 0.07 if bd["height"] > 1.3 else ky + 0.04
    else:
        # Under a skirt the legs wear its colour down to its hem: a thigh swinging out against
        # the cloth reads as the cloth pushed out, not as a bare knee through it.
        hem = skirt_hem(bd, bottom_len)

    def leg_slot(arg):
        if arg == "hems":
            return [hem]
        return low_slot if (bottom_kind != "skirt" and arg > hem) else (low_slot if arg > hem else SLOT["skin"])
    for side in ("L", "R"):
        build_leg(b, bd, side, leg_slot)
        build_foot(b, bd, side)

    fe = arm_param(bd, bd["elbow"][1])
    sleeve_end = {"none": 0.02, "short": 0.36, "rolled": fe + 0.1, "long": 1.01}[sleeves]

    def arm_slot(arg):
        if arg == "sleeve":
            return [sleeve_end] if 0.0 < sleeve_end < 1.0 else []
        return top_slot if arg < sleeve_end else SLOT["skin"]
    for side in ("L", "R"):
        build_arm(b, bd, side, arm_slot)

    if bottom_kind == "skirt":
        build_skirt(b, bd, low_slot, bottom_len)
    build_hair(b, bd, spec["hair"], hatted=spec.get("hat") == "cap")
    if spec.get("hat"):
        build_hat(b, bd, spec["hat"])
    return b


# ── Sky seen: how open each vertex is (ray casts against the figure itself) ─────

def vertex_normals(b):
    acc = [[0.0, 0.0, 0.0] for _ in b.verts]
    for f in b.faces:
        n = b.face_normal(f)
        for i in f:
            for k in range(3):
                acc[i][k] += n[k]
    out = []
    for a in acc:
        ln = math.sqrt(sum(v * v for v in a)) or 1.0
        out.append(tuple(v / ln for v in a))
    return out


def sky_seen(b):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    tris = []
    for f in b.faces:
        for k in range(1, len(f) - 1):
            tris.append((f[0], f[k], f[k + 1]))
    tree = BVHTree.FromPolygons([Vector(v) for v in b.verts], tris)
    normals = vertex_normals(b)
    # Fixed directions over the upper sphere (a golden spiral), shared by every vertex.
    dirs = []
    count = 24
    for i in range(count):
        y = 1.0 - (i + 0.5) / count * 1.6
        rr = math.sqrt(max(0.0, 1.0 - y * y))
        a = i * 2.399963
        dirs.append(Vector((rr * math.cos(a), y, rr * math.sin(a))))
    out = []
    for p, n in zip(b.verts, normals):
        nv = Vector(n)
        origin = Vector(p) + nv * 0.004
        seen = 0.0
        total = 0.0
        for d in dirs:
            c = d.dot(nv)
            if c <= 0.05:
                continue
            # Weighted toward the sky above.
            w = c * (0.6 + 0.4 * max(0.0, d.y))
            total += w
            hit = tree.ray_cast(origin, d, 0.35)
            if hit[0] is None:
                seen += w
        out.append(seen / total if total > 0 else 1.0)
    return out


# ── Blender ───────────────────────────────────────────────────────────────────

def to_blender(p):
    """Person frame (x left, y up, z forward) → Blender (x, -z, y); glTF export maps it back."""
    return (p[0], -p[2], p[1])


def make_mesh(name, b, spec, sky):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(v) for v in b.verts], [], [tuple(f) for f in b.faces])
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    bones = mesh.attributes.new("_bones", "FLOAT_VECTOR", "POINT")
    paint = mesh.attributes.new("_paint", "FLOAT_VECTOR", "POINT")
    for i in range(len(b.verts)):
        bones.data[i].vector = b.bones[i]
        paint.data[i].vector = (float(b.slots[i]), round(0.5 + 0.5 * sky[i], 4), 0.0)
    mesh.shade_smooth()
    mesh.set_sharp_from_angle(angle=math.radians(62))
    bd = BUILDS[spec["build"]]
    obj["build"] = spec["build"]
    obj["height"] = bd["height"]
    obj["joints"] = [round(v, 5) for j in joints_of(bd) for v in j]
    obj["foot"] = bd["foot"]["length"]
    return obj


def export(objs, path):
    """Write the figures (the only objects in the scene when this runs)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    assert all(o.type == "MESH" for o in bpy.context.scene.objects) and len(objs) == len(bpy.context.scene.objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_morph=False,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="NONE",
        export_vertex_color="NONE",
        export_attributes=True,
        export_extras=True,
    )


def write_manifest(path, glb, figures):
    """Add (or replace) this file's entry; every other asset's entry is kept as it is."""
    data = glb.read_bytes()
    manifest = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {
        "schemaVersion": 1,
        "author": "Serenity Blocks original procedural Blender authoring",
        "license": "Proprietary (project-owned)",
        "glTFUpAxis": "Y",
        "assets": [],
    }
    entry = {
        "file": glb.name,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "kind": "people",
        "generator": "scripts/blender/synthwave_strollers.py",
        "triangles": sum(f["triangles"] for f in figures),
        "figures": figures,
        "bones": list(BONES),
        "parents": list(PARENTS),
        "slots": list(SLOT),
    }
    merged = {a["file"]: a for a in manifest["assets"]}
    merged[glb.name] = entry
    manifest["assets"] = [merged[name] for name in sorted(merged)]
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")


# ── Previews: the cast in a studio light, and as silhouettes at game size ─────────

PREVIEW = {
    0: (0.62, 0.42, 0.33), 1: (0.12, 0.08, 0.06), 2: (0.85, 0.35, 0.42), 3: (0.12, 0.2, 0.42),
    4: (0.9, 0.9, 0.88), 5: (0.85, 0.72, 0.45), 6: (0.5, 0.1, 0.12),
}


def previews(objs, builders, out_dir):
    import numpy as np
    from mathutils import Vector

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.show_cavity = False
    scene.world = bpy.data.worlds.new("sky")
    scene.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for obj, b in zip(objs, builders):
        col = obj.data.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
        for i, s in enumerate(b.slots):
            r, g, bl = PREVIEW[s]
            col.data[i].color = (r, g, bl, 1.0)
        obj.data.color_attributes.active_color = col
    # Blender frame: the person faces −y, up is +z.
    views = {"front": Vector((0.0, -1.0, 0.08)), "threeq": Vector((0.75, -0.66, 0.1)),
             "side": Vector((1.0, 0.0, 0.05)), "back": Vector((0.0, 1.0, 0.08))}
    out_dir.mkdir(parents=True, exist_ok=True)
    tiles = {}

    def shoot(obj, d, size, ortho, mode, centre):
        d = d.normalized()
        cam.location = Vector(centre) + d * 6
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = ortho
        scene.render.resolution_x, scene.render.resolution_y = size
        if mode == "studio":
            scene.display.shading.light = "STUDIO"
            scene.display.shading.color_type = "VERTEX"
            scene.world.color = (0.36, 0.30, 0.42)
        else:
            scene.display.shading.light = "FLAT"
            scene.display.shading.color_type = "SINGLE"
            scene.display.shading.single_color = (0.03, 0.02, 0.04)
            scene.world.color = (1.0, 0.42, 0.20)
        path = out_dir / "_tile.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(size[1], size[0], 4)
        bpy.data.images.remove(img)
        return px

    for obj in objs:
        for o in objs:
            o.hide_render = o is not obj
        centre = (0.0, 0.0, 0.9)
        for vname, d in views.items():
            tiles[(obj.name, vname, "studio")] = shoot(obj, d, (240, 420), 2.0, "studio", centre)
            # A 1.7 m person 28 px tall: the frame's 2.0 m is 33 px.
            tiles[(obj.name, vname, "game")] = shoot(obj, d, (19, 33), 2.0, "game", centre)
    names = [o.name for o in objs]
    vnames = list(views)
    for mode, (tw, th), scale in (("studio", (240, 420), 1), ("game", (19, 33), 6)):
        sheet = np.zeros((len(vnames) * th * scale, len(names) * tw * scale, 4), dtype=np.float32)
        for r, v in enumerate(vnames):
            for cidx, n in enumerate(names):
                tile = tiles[(n, v, mode)]
                if scale > 1:
                    tile = tile.repeat(scale, axis=0).repeat(scale, axis=1)
                y0 = (len(vnames) - 1 - r) * th * scale
                sheet[y0:y0 + th * scale, cidx * tw * scale:(cidx + 1) * tw * scale] = tile
        img = bpy.data.images.new(f"sheet-{mode}", sheet.shape[1], sheet.shape[0], alpha=True)
        img.pixels[:] = sheet.ravel()
        img.filepath_raw = str(out_dir / f"sheet-{mode}.png")
        img.file_format = "PNG"
        img.save()
    (out_dir / "_tile.png").unlink(missing_ok=True)
    print(f"{TAG} previews: columns {names}, rows {vnames}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--"):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                opts[key] = argv[i + 1]
                i += 2
                continue
            opts[key] = True
        i += 1
    out = Path(opts.get("out", "src/themes/synthwave-sunset/assets/strollers.glb"))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = []
    builders = []
    figures = []
    for spec in CAST:
        b = build_figure(spec)
        sky = sky_seen(b)
        tris = sum(len(f) - 2 for f in b.faces)
        obj = make_mesh(spec["name"], b, spec, sky)
        objs.append(obj)
        builders.append(b)
        figures.append({"name": spec["name"], "build": spec["build"], "triangles": tris, "vertices": len(b.verts)})
        print(f"{TAG} {spec['name']}: {len(b.verts)} vertices, {tris} triangles")
    if not opts.get("no-export"):
        export(objs, out)
        write_manifest(out.parent / "asset-manifest.json", out, figures)
        print(f"{TAG} wrote {out} ({out.stat().st_size} bytes)")
    if opts.get("preview"):
        previews(objs, builders, Path(opts["preview"]))


main()
