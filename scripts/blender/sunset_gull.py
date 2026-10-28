"""Sunset's gull, modelled, rigged and animated in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sunset_gull.py -- \
        --out src/themes/sunset/sunset-gull-model.js [--preview <dir>]

or from a live Blender (the MCP): `runpy.run_path(<this file>, run_name="sunset_gull")["show"]()`
builds the same bird, its rig and its actions in a scene of its own ("SunsetGull"), leaves every
other scene alone, and plays the wingbeat.

A common gull (fiskmås), the bird of a northern sea's summer evening: white head, body and tail,
a soft grey back and upper wing, black wingtips with white mirrors, a slim yellow bill. The theme
calls a skein of them across the low sun, 30 to 120 px across, so the shape is built for the
silhouette that names a gull at a distance: long narrow wings bent at the wrist (a broad arm, a
long pointed hand swept back to a sharp tip), a round head carried close, a short square tail.
About 1,500 triangles, real size (1.33 m span); the theme scales it.

The rig is nine bones: the body, the head, the tail, and the arm, forearm and hand of each wing.
Every vertex follows at most two of them (smooth bands either side of each joint, widened toward
the trailing edge, which swings furthest when the wing folds). The actions are keyframed on the
armature: "Flap", one wingbeat (a full downstroke with the wing open and pronated; an upstroke
with the elbow and wrist flexed and the hand swept back and trailing, flicked up at the top; the
body rising on the downstroke, the head held level) and "Glide" (the gull's crank: the arm raised,
the hand lowered). The key poses are written below as joint angles and turned into bone
keyframes; Blender's own interpolation (cyclic, smooth) makes the cycle between them.

The export samples Blender's evaluated rig: FLAP_ROWS evenly spaced poses of the wingbeat, then
the glide, each bone as a rotation (quaternion) and a translation in the game's frame (x the
bird's left, y up, z forward; in Blender it faces -Y with its left wing on +X, as a rigged
character does), with each bone's parent and joint. The theme (sunset-birds.js) blends two rows
and the glide joint by joint for every bird and skins each vertex to two bones. The module also
carries a few vertices' positions as Blender itself deformed them, so the tests can hold the
theme's skinning to Blender's rig.

Deterministic: the same script writes the same file, headless or from the live session.
"""

import base64
import json
import math
import sys
from array import array
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

TAG = "[sunset-gull]"
SCENE = "SunsetGull"

# ── Plumage (sRGB hex → linear) ───────────────────────────────────────────────


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PLUMAGE = {
    "white": lin("#f2f3f3"),
    "belly": lin("#e9eaeb"),
    "mantle": lin("#a3acb6"),       # the common gull's soft grey back and upper wing
    "mantleDeep": lin("#939ca7"),
    "edge": lin("#eceef0"),         # the white trailing edge of the arm
    "black": lin("#17171a"),        # the wingtips
    "mirror": lin("#eceeef"),       # the white mirrors near the tip
    "under": lin("#eef0f1"),
    "underFlight": lin("#c9ced4"),  # the flight feathers' grey undersides
    "bill": lin("#d8c84e"),
    "eye": lin("#1c1a17"),
}


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def interp(points, s):
    """Piecewise y(s) through sorted (s, y) points, eased by a cosine per span."""
    if s <= points[0][0]:
        return points[0][1]
    for (s0, y0), (s1, y1) in zip(points, points[1:]):
        if s <= s1:
            t = (s - s0) / (s1 - s0)
            t = 0.5 - 0.5 * math.cos(math.pi * t)
            return y0 + (y1 - y0) * t
    return points[-1][1]


# ── The rig (game frame: x the bird's left, y up, z forward; metres) ──────────

BONES = ["body", "head", "tail", "arm.L", "fore.L", "hand.L", "arm.R", "fore.R", "hand.R"]
PARENT = {"head": "body", "tail": "body", "arm.L": "body", "fore.L": "arm.L", "hand.L": "fore.L",
          "arm.R": "body", "fore.R": "arm.R", "hand.R": "fore.R"}
BODY_PIVOT = (0.0, 0.010, 0.0)
HEAD_PIVOT = (0.0, 0.024, 0.088)
TAIL_PIVOT = (0.0, 0.013, -0.100)
# The wing is authored along s (its station tables below) and drawn out to `reach(s)`: a gull's
# long wings, longer than the tables' first draft (the skein is seen side-on, at 20 to 120 px,
# where long narrow wings and a slim body are what name it).
STRETCH = (0.665 - 0.030) / (0.600 - 0.030)


def reach(s):
    return 0.030 + (s - 0.030) * STRETCH


SHOULDER = (reach(0.040), 0.024, 0.030)
ELBOW = (reach(0.150), 0.022, 0.010)
WRIST = (reach(0.270), 0.020, 0.062)
TIP = (reach(0.600), 0.016, -0.083)
BONE_ENDS = {
    "body": (BODY_PIVOT, (0.0, 0.010, 0.075)),
    "head": (HEAD_PIVOT, (0.0, 0.026, 0.170)),
    "tail": (TAIL_PIVOT, (0.0, 0.012, -0.200)),
    "arm.L": (SHOULDER, ELBOW),
    "fore.L": (ELBOW, WRIST),
    "hand.L": (WRIST, TIP),
}
for _side in ("arm", "fore", "hand"):
    _a, _b = BONE_ENDS[f"{_side}.L"]
    BONE_ENDS[f"{_side}.R"] = ((-_a[0], _a[1], _a[2]), (-_b[0], _b[1], _b[2]))

# The bands over which a wing vertex passes from one bone to the next (|x|, m): a centre and a
# half width that widens with the vertex's distance from the joint along the chord (the trailing
# edge swings furthest), and for the hand a centre that runs out behind the wrist, as the line
# between the primaries and the secondaries does, so the folding hand does not drag the
# forearm's trailing edge in over itself.
ARM_BAND = (0.052, 0.020, 0.0, 0.020, 0.0)        # centre, half width, widening, most, run out
FORE_BAND = (0.150, 0.030, 0.30, 0.068, 0.0)
HAND_BAND = (0.270, 0.022, 0.32, 0.066, 0.30)


def band(spec, s, dz):
    centre, half, widen, most, run = spec
    h = min(half + widen * abs(dz), most)
    c = centre + run * max(0.0, -dz)
    return smooth(c - h, c + h, s)


def wing_skin(s, z, side):
    """Two bones and the first one's weight for a wing vertex at |x| = s, z."""
    t1 = band(ARM_BAND, s, 0.0)
    t2 = band(FORE_BAND, s, z - ELBOW[2])
    t3 = band(HAND_BAND, s, z - WRIST[2])
    suffix = ".L" if side > 0 else ".R"
    chain = [("body", 1 - t1), ("arm" + suffix, t1 * (1 - t2)), ("fore" + suffix, t2 * (1 - t3)),
             ("hand" + suffix, t3)]
    chain.sort(key=lambda bw: -bw[1])
    (b0, w0), (b1, w1) = chain[0], chain[1]
    total = w0 + w1
    return (b0, b1, w0 / total if total > 0 else 1.0)


def body_skin(z):
    head = smooth(0.072, 0.102, z)
    tail = smooth(-0.098, -0.128, z)
    if head > 0:
        return ("head", "body", head)
    if tail > 0:
        return ("tail", "body", tail)
    return ("body", "head", 1.0)


# ── The mesh, built as plain lists in the game frame ──────────────────────────

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.skins = []     # per vertex: (bone, bone, weight of the first)
        self.colours = []   # per vertex: (r, g, b, thin)

    def vert(self, p, colour, thin, skin):
        self.verts.append(tuple(float(v) for v in p))
        self.skins.append(skin)
        self.colours.append((colour[0], colour[1], colour[2], thin))
        return len(self.verts) - 1

    def part(self):
        return len(self.faces)

    def loft(self, rings, close_start=None, close_end=None):
        """Join rings of equal length into a tube. close_*: a vertex index to fan the end to."""
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                self.faces.append((a[i], a[j], b[j], b[i]))
        if close_start is not None:
            r = rings[0]
            for i in range(n):
                self.faces.append((close_start, r[(i + 1) % n], r[i]))
        if close_end is not None:
            r = rings[-1]
            for i in range(n):
                self.faces.append((close_end, r[i], r[(i + 1) % n]))

    def orient(self, first, inside):
        """Turn the faces since `first` outward (away from the point `inside`) if they face in."""
        votes = 0.0
        for f in self.faces[first:]:
            p = [Vector(self.verts[i]) for i in f]
            n = (p[1] - p[0]).cross(p[2] - p[0])
            c = sum(p, Vector()) / len(p)
            votes += n.dot(c - Vector(inside(c)))
        if votes < 0:
            self.faces[first:] = [tuple(reversed(f)) for f in self.faces[first:]]

    def triangles(self):
        out = []
        for f in self.faces:
            for k in range(1, len(f) - 1):
                out.append((f[0], f[k], f[k + 1]))
        return out


# Body and head in one: z, half width, top, bottom, centre height.
BODY = [
    (0.152, 0.008, 0.008, 0.007, 0.031),
    (0.146, 0.017, 0.018, 0.014, 0.033),
    (0.136, 0.025, 0.026, 0.019, 0.034),
    (0.121, 0.028, 0.029, 0.021, 0.034),
    (0.105, 0.026, 0.026, 0.022, 0.031),
    (0.089, 0.022, 0.021, 0.023, 0.024),
    (0.071, 0.027, 0.024, 0.028, 0.014),
    (0.046, 0.035, 0.029, 0.036, 0.008),
    (0.012, 0.039, 0.031, 0.038, 0.005),
    (-0.028, 0.037, 0.029, 0.034, 0.006),
    (-0.066, 0.031, 0.025, 0.026, 0.009),
    (-0.100, 0.026, 0.020, 0.018, 0.012),
    (-0.126, 0.016, 0.012, 0.010, 0.014),
]
BODY_RING = 12


def body_colour(z, up, side):
    """up: -1 belly .. 1 back."""
    c = mix(PLUMAGE["white"], PLUMAGE["belly"], smooth(0.0, -0.7, up))
    back = smooth(0.35, 0.75, up) * smooth(0.075, 0.04, z) * smooth(-0.12, -0.07, z)
    c = mix(c, PLUMAGE["mantle"], back)
    # A dark eye a little behind the bill, high on the head.
    if 0.124 < z < 0.140 and 0.25 < up < 0.75 and abs(side) > 0.55:
        c = PLUMAGE["eye"]
    return c


def build_body(b):
    first = b.part()
    rings = []
    for z, wx, top, bottom, cy in BODY:
        ring = []
        for i in range(BODY_RING):
            a = 2 * math.pi * i / BODY_RING
            ca, sa = math.cos(a), math.sin(a)
            x = wx * math.copysign(abs(ca) ** 0.9, ca)
            y = cy + (top if sa > 0 else bottom) * math.copysign(abs(sa) ** 0.9, sa)
            ring.append(b.vert((x, y, z), body_colour(z, sa, ca), 0.0, body_skin(z)))
        rings.append(ring)
    rings.reverse()  # tail to head, so the loft runs forward
    rump = b.vert((0, BODY[-1][4], BODY[-1][0] - 0.006), PLUMAGE["white"], 0.0, body_skin(BODY[-1][0]))
    face = b.vert((0, BODY[0][4], BODY[0][0] + 0.003), PLUMAGE["white"], 0.0, body_skin(BODY[0][0]))
    b.loft(rings, close_start=rump, close_end=face)
    b.orient(first, lambda c: (0.0, interp([(z, cy) for z, _, _, _, cy in reversed(BODY)], c.z), c.z))


# A slim bill, a little drooped: z, half width, top, bottom, centre height.
BILL = [
    (0.143, 0.0080, 0.0086, 0.0076, 0.0305),
    (0.156, 0.0058, 0.0066, 0.0062, 0.0292),
    (0.168, 0.0046, 0.0054, 0.0060, 0.0277),
    (0.179, 0.0033, 0.0042, 0.0036, 0.0262),
]
BILL_RING = 8


def build_bill(b):
    first = b.part()
    rings = []
    for z, wx, top, bottom, cy in BILL:
        ring = []
        for i in range(BILL_RING):
            a = 2 * math.pi * i / BILL_RING
            ca, sa = math.cos(a), math.sin(a)
            ring.append(b.vert((wx * ca, cy + (top if sa > 0 else bottom) * sa, z), PLUMAGE["bill"], 0.0,
                               ("head", "body", 1.0)))
        rings.append(ring)
    tip = b.vert((0, 0.0246, 0.186), PLUMAGE["bill"], 0.0, ("head", "body", 1.0))
    b.loft(rings, close_end=tip)
    b.orient(first, lambda c: (0.0, interp([(z, cy) for z, _, _, _, cy in BILL], c.z), c.z))


# Tail: a short square fan, a flattened lens: z, half width, centre height.
TAIL = [(-0.094, 0.024, 0.013), (-0.125, 0.034, 0.014), (-0.158, 0.043, 0.013), (-0.188, 0.049, 0.012),
        (-0.207, 0.051, 0.011), (-0.214, 0.047, 0.011)]
TAIL_RING = 10
TAIL_HALF_THICK = 0.0055


def build_tail(b):
    first = b.part()
    rings = []
    for k, (z, wx, cy) in enumerate(TAIL):
        thin = smooth(0.0, 2.0, k)
        thick = TAIL_HALF_THICK * (1.6 - 0.75 * smooth(0, 3, k))
        ring = []
        for i in range(TAIL_RING):
            a = 2 * math.pi * i / TAIL_RING
            ca, sa = math.cos(a), math.sin(a)
            skin = ("tail", "body", smooth(-0.092, -0.125, z))
            ring.append(b.vert((wx * math.copysign(abs(ca) ** 0.6, ca), cy + thick * sa, z), PLUMAGE["white"],
                               thin, skin))
        rings.append(ring)
    rings.reverse()
    end = b.vert((0, TAIL[-1][2], TAIL[-1][0] - 0.003), PLUMAGE["white"], 0.8, ("tail", "body", 1.0))
    root = b.vert((0, TAIL[0][2], TAIL[0][0] + 0.010), PLUMAGE["white"], 0.0, ("body", "tail", 1.0))
    b.loft(rings, close_start=end, close_end=root)
    b.orient(first, lambda c: (0.0, interp([(z, cy) for z, _, cy in reversed(TAIL)], c.z), c.z))


# Wings: stations along the span (|x|, m), dense at the joints so the skin bends smoothly.
STATIONS = [0.030, 0.046, 0.064, 0.090, 0.120, 0.150, 0.180, 0.212, 0.242, 0.262, 0.280, 0.302, 0.334,
            0.374, 0.418, 0.462, 0.502, 0.536, 0.564, 0.586, 0.600]
# Leading and trailing edges (z) along the span: the wrist (carpal) is the forward-most point, the
# hand's leading edge sweeps back to a sharp tip, the trailing edge runs nearly straight.
LEADING = [(0.030, 0.058), (0.130, 0.064), (0.230, 0.070), (0.270, 0.073), (0.320, 0.064), (0.400, 0.036),
           (0.480, 0.004), (0.540, -0.032), (0.580, -0.062), (0.600, -0.082)]
TRAILING = [(0.030, -0.084), (0.130, -0.096), (0.230, -0.094), (0.270, -0.089), (0.330, -0.084),
            (0.420, -0.082), (0.500, -0.082), (0.560, -0.083), (0.600, -0.0835)]
THICKNESS = [(0.030, 0.14), (0.150, 0.12), (0.270, 0.09), (0.450, 0.06), (0.600, 0.03)]
# Chord fractions (leading edge 0 → trailing edge 1).
CHORD = [0.0, 0.03, 0.11, 0.27, 0.50, 0.76, 1.0]


def wing_centre(s):
    return 0.022 - 0.007 * (s / 0.6)


def airfoil(c, t, x):
    """Camber line and half-thicknesses above and below it, as metres along a chord c."""
    camber = 0.05 * 4 * x * (1 - x)
    yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    yt *= 1 - smooth(0.45, 1.0, x) * 0.85  # the feathered back half is thin
    return camber * c, yt * c, yt * c * 0.4


def wing_colour(s, x, upper):
    """s: |x| along the span; x: chord fraction 0 LE .. 1 TE."""
    tip = smooth(0.470, 0.505, s)
    if upper:
        base = mix(PLUMAGE["mantle"], PLUMAGE["mantleDeep"], smooth(0.1, 0.45, s))
        base = mix(base, PLUMAGE["edge"], smooth(0.74, 0.92, x) * smooth(0.46, 0.38, s))
        black = mix(base, PLUMAGE["black"], tip)
        # Two white mirrors toward the tip.
        mirror = smooth(0.548, 0.560, s) * smooth(0.584, 0.572, s) * smooth(0.62, 0.32, x)
        mirror += smooth(0.512, 0.522, s) * smooth(0.538, 0.528, s) * smooth(0.55, 0.85, x) * 0.8
        return mix(black, PLUMAGE["mirror"], min(1.0, mirror))
    base = mix(PLUMAGE["under"], PLUMAGE["underFlight"], smooth(0.35, 0.65, x) * smooth(0.28, 0.42, s))
    return mix(base, PLUMAGE["black"], smooth(0.50, 0.54, s) * 0.92)


def build_wing(b, side):
    """side = 1 the bird's left (+x), -1 its right."""
    first = b.part()
    rings = []
    for s in STATIONS:
        le = interp(LEADING, s)
        te = interp(TRAILING, s)
        c = le - te
        cy = wing_centre(s)
        t = interp(THICKNESS, s)
        ring = []
        order = [(x, True) for x in CHORD] + [(x, False) for x in reversed(CHORD[1:-1])]
        for x, upper in order:
            camber, up, down = airfoil(c, t, x)
            y = cy + camber + (up if upper else -down)
            z = le - x * c
            thin = smooth(0.30, 0.70, x) * (0.55 + 0.45 * smooth(0.30, 0.55, s))
            ring.append(b.vert((side * reach(s), y, z), wing_colour(s, x, upper or x in (0.0, 1.0)), thin,
                               wing_skin(s, z, side)))
        rings.append(ring)
    root = b.vert((side * reach(STATIONS[0]), wing_centre(0), -0.013), PLUMAGE["white"], 0.0,
                  wing_skin(0.0, 0.0, side))
    tip = b.vert((side * reach(STATIONS[-1] + 0.003), wing_centre(0.6), -0.0835), PLUMAGE["black"], 0.6,
                 wing_skin(0.603, -0.0835, side))
    b.loft(rings, close_start=root, close_end=tip)
    b.orient(first, lambda c: (c.x, wing_centre(abs(c.x)), interp(LEADING, abs(c.x)) * 0.5
                               + interp(TRAILING, abs(c.x)) * 0.5))


def build_mesh():
    b = Builder()
    build_body(b)
    build_bill(b)
    build_tail(b)
    build_wing(b, 1)
    build_wing(b, -1)
    return b


# ── The poses: joint angles (degrees, the left wing on +x; the right mirrors it)
#
# sh_elev   the arm raised about the body's long axis (+ the wingtip up)
# sh_sweep  the arm swung back about the vertical (+ the tip back)
# sh_twist  the wing's leading edge turned down (pronation, +)
# el_flex   the elbow folded (the wrist drawn in and forward)
# wr_fold   the hand swung back about the wrist (the upstroke's flexed wrist)
# wr_elev   the hand raised about the wrist, relative to the arm
# wr_twist  the hand's leading edge turned down, relative to the arm
# bob       the body raised (mm); pitch: its nose up (degrees); tail: the tail raised (degrees)
JOINTS = ["sh_elev", "sh_sweep", "sh_twist", "el_flex", "wr_fold", "wr_elev", "wr_twist", "bob", "pitch", "tail"]

# One wingbeat from the top of the stroke. The downstroke takes 55 % of it.
FLAP_KEYS = [
    (0.000, dict(sh_elev=40, sh_sweep=4, sh_twist=-2, el_flex=14, wr_fold=22, wr_elev=16, wr_twist=-4,
                 bob=-7, pitch=1.0, tail=2)),
    (0.120, dict(sh_elev=28, sh_sweep=-2, sh_twist=4, el_flex=4, wr_fold=6, wr_elev=9, wr_twist=2,
                 bob=-5, pitch=0.5, tail=1)),
    (0.250, dict(sh_elev=8, sh_sweep=-6, sh_twist=8, el_flex=0, wr_fold=0, wr_elev=3, wr_twist=6,
                 bob=2, pitch=-0.6, tail=-1)),
    (0.385, dict(sh_elev=-18, sh_sweep=-4, sh_twist=8, el_flex=0, wr_fold=0, wr_elev=-2, wr_twist=6,
                 bob=8, pitch=-1.0, tail=-2)),
    (0.500, dict(sh_elev=-30, sh_sweep=0, sh_twist=4, el_flex=4, wr_fold=6, wr_elev=-8, wr_twist=2,
                 bob=8, pitch=-0.5, tail=-1)),
    (0.600, dict(sh_elev=-26, sh_sweep=6, sh_twist=-4, el_flex=22, wr_fold=30, wr_elev=-17, wr_twist=-6,
                 bob=4, pitch=0.5, tail=1)),
    (0.720, dict(sh_elev=-7, sh_sweep=12, sh_twist=-8, el_flex=30, wr_fold=42, wr_elev=-21, wr_twist=-10,
                 bob=-2, pitch=1.2, tail=2)),
    (0.860, dict(sh_elev=22, sh_sweep=10, sh_twist=-6, el_flex=27, wr_fold=38, wr_elev=-6, wr_twist=-8,
                 bob=-7, pitch=1.4, tail=2.5)),
]
GLIDE = dict(sh_elev=18, sh_sweep=6, sh_twist=2, el_flex=12, wr_fold=16, wr_elev=-28, wr_twist=0,
             bob=0, pitch=0.0, tail=-2)

CYCLE_FRAMES = 24      # Blender frames in one wingbeat (24 fps: a second a beat in the viewport)
FLAP_ROWS = 24         # wingbeat poses the export samples (the glide follows them)


# ── Forward kinematics: the deform of every bone (game frame, rest-relative) ──

def _t(p):
    return Matrix.Translation(Vector(p))


def _rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def _ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def _rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def _about(pivot, rot):
    return _t(pivot) @ rot @ _t([-v for v in pivot])


MIRROR = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))


def deforms(pose):
    """bone → 4×4 deform (game frame) for a pose dict."""
    d = {}
    body = _t((0.0, pose["bob"] / 1000.0, 0.0)) @ _about(BODY_PIVOT, _rx(-pose["pitch"]))
    d["body"] = body
    # The head is held level and steady while the body rises and falls under it.
    d["head"] = body @ _t((0.0, -0.7 * pose["bob"] / 1000.0, 0.0)) @ _about(HEAD_PIVOT, _rx(pose["pitch"]))
    d["tail"] = body @ _about(TAIL_PIVOT, _rx(-pose["tail"]))
    arm = body @ _about(SHOULDER, _rz(pose["sh_elev"]) @ _ry(pose["sh_sweep"]) @ _rx(pose["sh_twist"]))
    fore = arm @ _about(ELBOW, _ry(-pose["el_flex"]))
    hand = fore @ _about(WRIST, _ry(pose["wr_fold"]) @ _rz(pose["wr_elev"]) @ _rx(pose["wr_twist"]))
    d["arm.L"], d["fore.L"], d["hand.L"] = arm, fore, hand
    # The right wing mirrors the left about the body's plane (applied to the body-relative part).
    inv = body.inverted()
    for name in ("arm", "fore", "hand"):
        d[f"{name}.R"] = body @ MIRROR @ (inv @ d[f"{name}.L"]) @ MIRROR
    return d


# ── Game frame ↔ Blender (Z up, the bird faces -Y) ────────────────────────────

G2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
B2G = G2B.inverted()


def to_b(p):
    return (p[0], -p[2], p[1])


def to_g(p):
    return (p[0], p[2], -p[1])


# ── Blender: the mesh, the rig and the actions ────────────────────────────────

def _link(scene, obj):
    scene.collection.objects.link(obj)


def build_objects(scene):
    built = build_mesh()
    mesh = bpy.data.meshes.new("SunsetGull")
    mesh.from_pydata([to_b(v) for v in built.verts], [], [tuple(f) for f in built.faces])
    mesh.update()
    col = mesh.color_attributes.new("plumage", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(built.colours):
        col.data[i].color = (c[0], c[1], c[2], 1.0)
    for poly in mesh.polygons:
        poly.use_smooth = True
    gull = bpy.data.objects.new("SunsetGull", mesh)
    _link(scene, gull)

    arm_data = bpy.data.armatures.new("SunsetGullRig")
    arm_data.display_type = "STICK"
    rig = bpy.data.objects.new("SunsetGullRig", arm_data)
    _link(scene, rig)
    rig.show_in_front = True

    window = getattr(bpy.context, "window", None)
    if window is not None:
        window.scene = scene
    view_layer = scene.view_layers[0]
    for o in [o for o in view_layer.objects if o is not None]:
        o.select_set(False)
    view_layer.objects.active = rig
    rig.select_set(True)
    with bpy.context.temp_override(scene=scene, view_layer=view_layer, active_object=rig, object=rig):
        bpy.ops.object.mode_set(mode="EDIT")
        for name in BONES:
            eb = arm_data.edit_bones.new(name)
            head, tail = BONE_ENDS[name]
            eb.head = Vector(to_b(head))
            eb.tail = Vector(to_b(tail))
            eb.roll = 0.0
        for name, parent in PARENT.items():
            arm_data.edit_bones[name].parent = arm_data.edit_bones[parent]
            arm_data.edit_bones[name].use_connect = False
        bpy.ops.object.mode_set(mode="OBJECT")

    for name in BONES:
        gull.vertex_groups.new(name=name)
    for i, (b0, b1, w0) in enumerate(built.skins):
        gull.vertex_groups[b0].add([i], w0, "REPLACE")
        if w0 < 1.0:
            gull.vertex_groups[b1].add([i], 1.0 - w0, "ADD")
    mod = gull.modifiers.new("Rig", "ARMATURE")
    mod.object = rig
    mod.use_vertex_groups = True
    gull.parent = rig
    return built, gull, rig


def _basis(rig, name, d):
    """The pose bone's basis (local) matrix that puts the bone at deform `d` (Blender frame)."""
    bone = rig.data.bones[name]
    ml = bone.matrix_local
    parent = PARENT.get(name)
    rel = d[name] if parent is None else d[parent].inverted() @ d[name]
    return ml.inverted() @ rel @ ml


def _blender_deforms(pose):
    return {k: G2B @ v @ B2G for k, v in deforms(pose).items()}


def _fcurves(action):
    try:
        return list(action.fcurves)
    except AttributeError:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.extend(bag.fcurves)
        return out


def key_action(rig, name, keys, cycle):
    """Keyframe `keys` [(phase, pose)] as action `name`; cyclic when `cycle`."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    previous = {}
    frames = []
    for phase, pose in keys:
        frame = 1 + phase * CYCLE_FRAMES
        frames.append(frame)
        d = _blender_deforms(pose)
        for bone in BONES:
            pb = rig.pose.bones[bone]
            pb.rotation_mode = "QUATERNION"
            loc, rot, _ = _basis(rig, bone, d).decompose()
            if bone in previous and previous[bone].dot(rot) < 0:
                rot = -rot
            previous[bone] = rot
            pb.location = loc
            pb.rotation_quaternion = rot
            pb.keyframe_insert("location", frame=frame, group=bone)
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=bone)
    if cycle:
        # Close the loop with the first pose again, then let Blender's cyclic smoothing join it.
        d = _blender_deforms(keys[0][1])
        for bone in BONES:
            pb = rig.pose.bones[bone]
            loc, rot, _ = _basis(rig, bone, d).decompose()
            if previous[bone].dot(rot) < 0:
                rot = -rot
            pb.location = loc
            pb.rotation_quaternion = rot
            pb.keyframe_insert("location", frame=1 + CYCLE_FRAMES, group=bone)
            pb.keyframe_insert("rotation_quaternion", frame=1 + CYCLE_FRAMES, group=bone)
        for fc in _fcurves(action):
            fc.modifiers.new("CYCLES")
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"
            fc.update()
    return action


def build_rig_and_actions(scene):
    built, gull, rig = build_objects(scene)
    glide = key_action(rig, "Glide", [(0.0, GLIDE)], cycle=False)
    flap = key_action(rig, "Flap", FLAP_KEYS, cycle=True)
    rig.animation_data.action = flap
    scene.frame_start = 1
    scene.frame_end = CYCLE_FRAMES
    scene.render.fps = 24
    return built, gull, rig, {"Flap": flap, "Glide": glide}


# ── Sampling Blender's evaluated rig ──────────────────────────────────────────

def _set_frame(scene, frame):
    whole = math.floor(frame)
    scene.frame_set(int(whole), subframe=frame - whole)


def sample_rows(scene, rig, actions):
    """FLAP_ROWS wingbeat poses then the glide: per row, per bone (q xyzw, t xyz) in the game frame."""
    rows = []
    rig.animation_data.action = actions["Flap"]
    for i in range(FLAP_ROWS):
        _set_frame(scene, 1 + i * CYCLE_FRAMES / FLAP_ROWS)
        rows.append(_read_pose(scene, rig))
    rig.animation_data.action = actions["Glide"]
    _set_frame(scene, 1)
    rows.append(_read_pose(scene, rig))
    rig.animation_data.action = actions["Flap"]
    _set_frame(scene, 1)
    return rows


def _read_pose(scene, rig):
    depsgraph = scene.view_layers[0].depsgraph
    ev = rig.evaluated_get(depsgraph)
    out = []
    for name in BONES:
        pb = ev.pose.bones[name]
        d_b = pb.matrix @ rig.data.bones[name].matrix_local.inverted()
        d_g = B2G @ d_b @ G2B
        loc, rot, scale = d_g.decompose()
        if max(abs(s - 1.0) for s in scale) > 1e-4:
            raise RuntimeError(f"{TAG} bone {name} is scaled: {tuple(scale)}")
        out.append((rot.x, rot.y, rot.z, rot.w, loc.x, loc.y, loc.z))
    return out


def evaluated_positions(scene, gull):
    depsgraph = scene.view_layers[0].depsgraph
    ev = gull.evaluated_get(depsgraph)
    m = ev.to_mesh()
    pts = [to_g(tuple(v.co)) for v in m.vertices]
    ev.to_mesh_clear()
    return pts


def skin_twin(rest, skin, row):
    """The theme's vertex stage, in Python: two bones, quaternion + translation each."""
    out = []
    for p, (b0, b1, w0) in zip(rest, skin):
        acc = Vector((0.0, 0.0, 0.0))
        for bone, w in ((b0, w0), (b1, 1.0 - w0)):
            if w <= 0:
                continue
            qx, qy, qz, qw, tx, ty, tz = row[BONES.index(bone)]
            acc += (Quaternion((qw, qx, qy, qz)) @ Vector(p) + Vector((tx, ty, tz))) * w
        out.append(tuple(acc))
    return out


# ── The module the theme imports ──────────────────────────────────────────────

QUANT = 1e-4  # metres per unit of the stored positions


def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def check_vertices(built):
    """A handful of telling vertices: both wingtips, the bill's tip, the tail, the wrist's trailing edge."""
    verts = built.verts

    def nearest(target):
        return min(range(len(verts)), key=lambda i: sum((verts[i][k] - target[k]) ** 2 for k in range(3)))

    return [nearest((reach(0.603), 0.011, -0.0835)), nearest((-reach(0.603), 0.011, -0.0835)),
            nearest((0.0, 0.0246, 0.186)), nearest((0.0, 0.011, -0.217)), nearest((reach(0.27), 0.02, -0.089)),
            nearest((reach(0.15), 0.03, -0.096))]


def write_module(path, built, rows, checks):
    tris = built.triangles()
    positions = [int(round(c / QUANT)) for v in built.verts for c in v]
    index = [i for t in tris for i in t]
    skin = []
    for b0, b1, w0 in built.skins:
        skin.extend((BONES.index(b0), BONES.index(b1), int(round(w0 * 255)), 0))
    colours = []
    for r, g, b, thin in built.colours:
        colours.extend(int(round(max(0.0, min(1.0, x)) * 255)) for x in (r, g, b, thin))
    poses = [round(x, 6) for row in rows for bone in row for x in (*bone[:4], *bone[4:], 1.0)]
    span = max(v[0] for v in built.verts) - min(v[0] for v in built.verts)
    length = max(v[2] for v in built.verts) - min(v[2] for v in built.verts)
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Sunset's gull: GENERATED by scripts/blender/sunset_gull.py (do not edit by hand).",
        " *",
        " * A common gull modelled, rigged and animated in Blender. Game frame: x the bird's left,",
        " * y up, z forward; metres, real size. `positions` are Int16 in units of `quant` metres;",
        " * `index` Uint16 triangles; `skin` Uint8 (bone, bone, the first one's weight / 255, 0);",
        " * `colours` Uint8 linear plumage (r, g, b, thin feather / 255). `poses` is rows of",
        " * bones of (qx, qy, qz, qw, tx, ty, tz, 1): `flapRows` evenly spaced poses of one",
        " * wingbeat from the top of the stroke, then the glide: each bone's deform, rest to pose.",
        " * `parents` and `pivots` (each bone's joint at rest) let the theme blend rows joint by",
        " * joint. `checks` are vertices as Blender's own rig deformed them at some rows (the tests).",
        " */",
        "export const SUNSET_GULL = Object.freeze({",
        f"    bones: {json.dumps(BONES)},",
        f"    span: {round(span, 4)},",
        f"    length: {round(length, 4)},",
        f"    quant: {QUANT},",
        f"    vertexCount: {len(built.verts)},",
        f"    triangleCount: {len(tris)},",
        f"    flapRows: {FLAP_ROWS},",
        f"    parents: {json.dumps([BONES.index(PARENT[b]) if b in PARENT else -1 for b in BONES])},",
        f"    pivots: {json.dumps([[round(c, 6) for c in BONE_ENDS[b][0]] for b in BONES])},",
        f"    positions: '{b64('h', positions)}',",
        f"    index: '{b64('H', index)}',",
        f"    skin: '{b64('B', skin)}',",
        f"    colours: '{b64('B', colours)}',",
        f"    poses: '{b64('f', poses)}',",
        f"    checks: {json.dumps(checks, separators=(',', ':'))},",
        "});",
        "",
    ]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


def export(scene, built, gull, rig, actions, path):
    rows = sample_rows(scene, rig, actions)
    rest = built.verts
    picks = check_vertices(built)
    checks = []
    worst = 0.0
    for row_index in (0, 6, 12, 18, FLAP_ROWS):
        if row_index < FLAP_ROWS:
            rig.animation_data.action = actions["Flap"]
            _set_frame(scene, 1 + row_index * CYCLE_FRAMES / FLAP_ROWS)
        else:
            rig.animation_data.action = actions["Glide"]
            _set_frame(scene, 1)
        blender = evaluated_positions(scene, gull)
        twin = skin_twin(rest, built.skins, rows[row_index])
        worst = max(worst, max((Vector(a) - Vector(b)).length for a, b in zip(blender, twin)))
        for v in picks:
            checks.append({"vertex": v, "row": row_index, "at": [round(c, 5) for c in blender[v]]})
    rig.animation_data.action = actions["Flap"]
    _set_frame(scene, 1)
    if worst > 1e-4:
        raise RuntimeError(f"{TAG} the twin strays from Blender's rig by {worst * 1000:.3f} mm")
    write_module(path, built, rows, checks)
    print(f"{TAG} wrote {path}: {len(built.verts)} vertices, {len(built.triangles())} triangles, "
          f"twin within {worst * 1000:.4f} mm")
    return rows


# ── Previews (Workbench, orthographic lineups) ────────────────────────────────

PREVIEW_PHASES = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]


def _baked_copy(scene, gull, name):
    depsgraph = scene.view_layers[0].depsgraph
    mesh = bpy.data.meshes.new_from_object(gull.evaluated_get(depsgraph))
    obj = bpy.data.objects.new(name, mesh)
    return obj


def previews(scene, gull, rig, actions, out_dir, collection_name="SunsetGullPreview"):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    col = bpy.data.collections.get(collection_name) or bpy.data.collections.new(collection_name)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    poses = []
    rig.animation_data.action = actions["Flap"]
    for ph in PREVIEW_PHASES:
        _set_frame(scene, 1 + ph * CYCLE_FRAMES)
        poses.append((f"flap {ph:.3f}", _baked_copy(scene, gull, f"pv flap {ph:.3f}")))
    rig.animation_data.action = actions["Glide"]
    _set_frame(scene, 1)
    poses.append(("glide", _baked_copy(scene, gull, "pv glide")))
    rig.animation_data.action = actions["Flap"]
    _set_frame(scene, 1)

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.015, 0.012, 0.012)
    scene.display.shading.show_object_outline = False
    world = scene.world or bpy.data.worlds.new("SunsetGullWorld")
    scene.world = world
    world.color = (0.95, 0.45, 0.16)
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"

    hidden = [o for o in (gull, rig)]
    for o in hidden:
        o.hide_render = True
    cam_data = bpy.data.cameras.get("SunsetGullPreviewCam") or bpy.data.cameras.new("SunsetGullPreviewCam")
    cam = bpy.data.objects.get("SunsetGullPreviewCam") or bpy.data.objects.new("SunsetGullPreviewCam", cam_data)
    if cam.name not in col.objects:
        col.objects.link(cam)
    scene.camera = cam
    files = []
    views = {
        # name: camera direction (Blender frame, toward the bird), up, lineup axis, spacing
        "side": (Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)), 0.75),
        "front": (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)), 1.45),
        "below": (Vector((-0.94, 0.0, 0.34)).normalized(), Vector((0, 0, 1)), Vector((0, 1, 0)), 0.75),
        "top": (Vector((0, 0, -1)), Vector((0, -1, 0)), Vector((1, 0, 0)), 1.35),
    }
    for view, (direction, up, axis, gap) in views.items():
        for o in list(col.objects):
            if o.type == "MESH":
                col.objects.unlink(o)
        for k, (_, obj) in enumerate(poses):
            obj.location = axis * (k - (len(poses) - 1) / 2) * gap
            col.objects.link(obj)
        right = direction.cross(up).normalized()
        true_up = right.cross(direction).normalized()
        rot = Matrix((right, true_up, -direction)).transposed().to_quaternion()
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = rot
        cam.location = -direction * 6.0
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = gap * len(poses) * 1.04
        scene.render.resolution_x = 1800
        scene.render.resolution_y = int(1800 * 0.75 / gap * 0.28) if view in ("side", "below") else 420
        scene.render.resolution_percentage = 100
        path = out / f"gull-{view}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        files.append(str(path))
    for o in hidden:
        o.hide_render = False
    return files


# ── Entry points ──────────────────────────────────────────────────────────────

def show(preview_dir=None, export_path=None):
    """Live Blender (the MCP): the bird in a scene of its own; nothing else touched."""
    old = bpy.data.scenes.get(SCENE)
    if old is not None:
        for o in list(old.objects):
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Armature):
                    bpy.data.armatures.remove(data)
                elif isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)
        for name in ("Flap", "Glide"):
            a = bpy.data.actions.get(name)
            if a is not None and a.users <= 1:
                bpy.data.actions.remove(a)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(SCENE)
    built, gull, rig, actions = build_rig_and_actions(scene)
    report = {"vertices": len(built.verts), "triangles": len(built.triangles())}
    if export_path:
        export(scene, built, gull, rig, actions, export_path)
        report["export"] = export_path
    if preview_dir:
        report["previews"] = previews(scene, gull, rig, actions, preview_dir)
        col = bpy.data.collections.get("SunsetGullPreview")
        if col is not None:
            col.hide_viewport = True
    _set_frame(scene, 1)
    return report


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        if a == "--preview":
            preview_dir = argv[i + 1]
    # The same scene of its own the live session builds, so both write the same file.
    scene = bpy.data.scenes.new(SCENE)
    built, gull, rig, actions = build_rig_and_actions(scene)
    if out:
        export(scene, built, gull, rig, actions, out)
    if preview_dir:
        previews(scene, gull, rig, actions, preview_dir)


if __name__ == "__main__":
    main()
