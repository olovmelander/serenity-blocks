"""Solar Eclipse's flamingos, modelled, rigged and animated in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/solar_eclipse_flamingo.py -- \
        --out src/themes/solar-eclipse/solar-eclipse-flamingo-model.js [--preview <dir>]

or from a live Blender (the MCP): `runpy.run_path(<this file>, run_name="se_flamingo")["show"]()`
builds the same bird, its rig and its actions in a scene of its own ("SolarEclipseFlamingo") and
leaves every other scene alone.

A greater flamingo, the bird of the flooded salt flat: pale pink body, a long thin neck, a small
head on a heavy bill bent down at its middle (black from the bend), long pink-grey legs, long
narrow wings whose coverts are coral pink and whose flight feathers, primaries and secondaries
alike, are black. The theme shows it at totality against the bright band of the horizon, 6 to 30
px tall, so the shape is built for the silhouettes that name a flamingo at that size: in flight
the long flying cross (the neck stretched straight forward, the legs trailing straight back past
the tail, the wings beating in the middle); standing, a small body held high on two stilts with
the neck in its S. Real size (a 1.55 m span). Nothing in the scene stands nearer than about 110 m,
where the bird is under 30 px across, so it is cut lean: 544 triangles (an eight-sided body, the
neck, bill and legs four-sided tubes with rings only where they bend, a wing of eight stations and
a six-point section that still splits the coral coverts from the black flight feathers).

The rig is sixteen bones: the body; four neck segments and the head; the leg (tibiotarsus) and
shank (tarsometatarsus, the foot at its end) of each side; the arm, forearm and hand of each
wing. Every vertex follows at most two of them. The rest pose is the bird on the wing. The
poses are written below as joint angles and turned into bone keyframes: "Flap" (one wingbeat,
cyclic), "Walk" (one stride, cyclic), and single poses: "Glide", "Stand", "FeedL" and "FeedR"
(the head down in the water, swept to either side), "Alert" (the neck straight up), "Stretch"
(the wing salute: both wings raised and opened) and "Rest" (on one leg). A folded wing is the
same wing turned flat against the flank and scaled down about the shoulder (bones may scale,
uniformly), so no skinned fold ever crosses itself.

The export samples Blender's evaluated rig: FLAP_ROWS poses of the wingbeat, WALK_ROWS of the
stride, then the single poses, each bone as a rotation (quaternion), a translation and a scale in
the game's frame (x the bird's left, y up, z forward; in Blender it faces -Y with its left wing
on +X). The theme (solar-eclipse-flamingo-flight.js) blends rows joint by joint for every bird
and skins each vertex to two bones. Each vertex also carries its own half-thickness (mm): the
theme widens the neck, legs, bill and wings to at least a pixel, so they never break up into
sub-pixel sparkle far off. The module carries a few vertices as Blender itself deformed them,
so the tests can hold the theme's skinning to Blender's rig.

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

TAG = "[se-flamingo]"
SCENE = "SolarEclipseFlamingo"

# ── Plumage (sRGB hex → linear) ───────────────────────────────────────────────


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PLUMAGE = {
    "pale": lin("#f3cfcc"),        # the body's pale pink
    "body": lin("#efb3b2"),        # back and flanks, a little deeper
    "breast": lin("#f1bdbb"),
    "neck": lin("#efbcbc"),
    "coverts": lin("#e8566f"),     # the wing's coral-pink coverts
    "lesser": lin("#f0899a"),      # the leading edge's paler pink
    "under": lin("#df4d68"),       # the underwing's coverts
    "black": lin("#141315"),       # primaries and secondaries
    "leg": lin("#c58d93"),         # pink-grey legs
    "knee": lin("#a87479"),
    "bill": lin("#ead0cc"),
    "billTip": lin("#1a1718"),
    "eye": lin("#e8d27a"),
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

BONES = ["body", "neck0", "neck1", "neck2", "neck3", "head", "leg.L", "shank.L", "leg.R", "shank.R",
         "arm.L", "fore.L", "hand.L", "arm.R", "fore.R", "hand.R"]
PARENT = {"neck0": "body", "neck1": "neck0", "neck2": "neck1", "neck3": "neck2", "head": "neck3",
          "leg.L": "body", "shank.L": "leg.L", "leg.R": "body", "shank.R": "leg.R",
          "arm.L": "body", "fore.L": "arm.L", "hand.L": "fore.L",
          "arm.R": "body", "fore.R": "arm.R", "hand.R": "fore.R"}

BODY_PIVOT = (0.0, 0.0, 0.0)
NECK_Y = 0.035
NECK_JOINTS = [0.215, 0.36, 0.50, 0.64, 0.78]   # z of neck0's base … the head's joint
HEAD_END = 0.87
HIP = (0.045, -0.065, -0.04)
ANKLE = (0.040, -0.066, -0.36)
TOE = (0.034, -0.068, -0.74)                      # the foot's tip (the shank's end)
SHOULDER = (0.075, 0.070, 0.100)
ELBOW = (0.290, 0.070, 0.090)
WRIST = (0.470, 0.070, 0.110)
TIP = (0.780, 0.066, -0.020)


def _mx(p):
    return (-p[0], p[1], p[2])


BONE_ENDS = {
    "body": (BODY_PIVOT, (0.0, 0.0, 0.15)),
    "head": ((0.0, NECK_Y, NECK_JOINTS[4]), (0.0, NECK_Y, HEAD_END)),
    "leg.L": (HIP, ANKLE),
    "shank.L": (ANKLE, TOE),
    "leg.R": (_mx(HIP), _mx(ANKLE)),
    "shank.R": (_mx(ANKLE), _mx(TOE)),
    "arm.L": (SHOULDER, ELBOW),
    "fore.L": (ELBOW, WRIST),
    "hand.L": (WRIST, TIP),
    "arm.R": (_mx(SHOULDER), _mx(ELBOW)),
    "fore.R": (_mx(ELBOW), _mx(WRIST)),
    "hand.R": (_mx(WRIST), _mx(TIP)),
}
for _k in range(4):
    BONE_ENDS[f"neck{_k}"] = ((0.0, NECK_Y, NECK_JOINTS[_k]), (0.0, NECK_Y, NECK_JOINTS[_k + 1]))


def neck_skin(z):
    """Two bones and the first one's weight along the neck, the head and the body's front."""
    chain = ["body", "neck0", "neck1", "neck2", "neck3", "head"]
    joints = NECK_JOINTS
    half = [0.022, 0.03, 0.03, 0.03, 0.022]
    for k, zj in enumerate(joints):
        if z < zj + half[k]:
            w = smooth(zj - half[k], zj + half[k], z)
            return (chain[k], chain[k + 1], 1.0 - w) if w < 0.5 else (chain[k + 1], chain[k], w)
    return ("head", "neck3", 1.0)


def leg_skin(along, side):
    """`along`: metres from the hip down the leg (the shank begins at the ankle)."""
    sfx = ".L" if side > 0 else ".R"
    knee = math.dist(HIP, ANKLE)
    hip_w = smooth(-0.01, 0.05, along)
    if along < 0.05:
        return ("leg" + sfx, "body", hip_w) if hip_w >= 0.5 else ("body", "leg" + sfx, 1 - hip_w)
    w = smooth(knee - 0.018, knee + 0.018, along)
    return ("leg" + sfx, "shank" + sfx, 1 - w) if w < 0.5 else ("shank" + sfx, "leg" + sfx, w)


# Wing skin bands (|x|, m): centre, half width, widening with the distance from the joint along
# the chord (the trailing edge swings furthest), the most it widens to.
ARM_BAND = (0.092, 0.016, 0.0, 0.016)
FORE_BAND = (ELBOW[0], 0.026, 0.25, 0.06)
HAND_BAND = (WRIST[0], 0.022, 0.28, 0.06)


def band(spec, s, dz):
    centre, half, widen, most = spec
    h = min(half + widen * abs(dz), most)
    return smooth(centre - h, centre + h, s)


def wing_skin(s, z, side):
    t1 = band(ARM_BAND, s, 0.0)
    t2 = band(FORE_BAND, s, z - ELBOW[2])
    t3 = band(HAND_BAND, s, z - WRIST[2])
    sfx = ".L" if side > 0 else ".R"
    chain = [("body", 1 - t1), ("arm" + sfx, t1 * (1 - t2)), ("fore" + sfx, t2 * (1 - t3)), ("hand" + sfx, t3)]
    chain.sort(key=lambda bw: -bw[1])
    (b0, w0), (b1, w1) = chain[0], chain[1]
    total = w0 + w1
    return (b0, b1, w0 / total if total > 0 else 1.0)


# ── The mesh, built as plain lists in the game frame ──────────────────────────

THICK = 255  # a vertex never widened (the body)
# What a vertex is part of (the colour's fourth byte): the body is solid; a wing is a PLATE (the
# theme widens it to a pixel, seen edge on); the neck, head, bill and legs are TUBES (widened to a
# pixel and drawn as thin as they truly are: the extra width is let through).
SOLID = 255
PLATE = 128
TUBE = 0


class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.skins = []     # per vertex: (bone, bone, weight of the first)
        self.colours = []   # per vertex: (r, g, b, kind: SOLID, PLATE or TUBE)
        self.radius = []    # per vertex: its half-thickness in mm (THICK: never widened)

    def vert(self, p, colour, skin, radius_m=None, kind=None):
        self.verts.append(tuple(float(v) for v in p))
        self.skins.append(skin)
        if kind is None:
            kind = SOLID if radius_m is None else TUBE
        self.colours.append((colour[0], colour[1], colour[2], kind))
        mm = THICK if radius_m is None else int(max(1, min(THICK - 1, round(radius_m * 1000))))
        self.radius.append(mm)
        return len(self.verts) - 1

    def part(self):
        return len(self.faces)

    def loft(self, rings, close_start=None, close_end=None):
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
        """Turn the faces since `first` outward (away from the point `inside(c)`) if they face in."""
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


def frame_at(points, i):
    """A ring's two axes at station i of a polyline: across (level when it can be) and over."""
    a = Vector(points[max(0, i - 1)])
    b = Vector(points[min(len(points) - 1, i + 1)])
    t = (b - a).normalized()
    ref = Vector((0.0, 1.0, 0.0)) if abs(t.y) < 0.9 else Vector((0.0, 0.0, 1.0))
    across = ref.cross(t).normalized()
    over = t.cross(across).normalized()
    return across, over


def nearest_on(points):
    def inside(c):
        best = None
        for p0, p1 in zip(points, points[1:]):
            a, b = Vector(p0), Vector(p1)
            ab = b - a
            k = max(0.0, min(1.0, (c - a).dot(ab) / max(ab.length_squared, 1e-12)))
            q = a + ab * k
            if best is None or (c - q).length < (c - best).length:
                best = q
        return tuple(best)
    return inside


def tube(b, stations, sides, look, skin, cap_start=True, cap_end=True, squash=0.85):
    """Rings round a polyline. stations: (point, half width, half height); look(i, sa) → colour."""
    first = b.part()
    points = [s[0] for s in stations]
    rings = []
    for i, (p, hw, hh) in enumerate(stations):
        across, over = frame_at(points, i)
        ring = []
        for k in range(sides):
            a = 2 * math.pi * (k + 0.5) / sides
            ca, sa = math.cos(a), math.sin(a)
            q = Vector(p) + across * (hw * math.copysign(abs(ca) ** squash, ca)) \
                + over * (hh * math.copysign(abs(sa) ** squash, sa))
            ring.append(b.vert(q, look(i, sa), skin(i), min(hw, hh)))
        rings.append(ring)
    start = end = None
    if cap_start:
        a, c = Vector(points[0]), Vector(points[1])
        tip = a - (c - a).normalized() * min(stations[0][1], stations[0][2]) * 0.6
        start = b.vert(tip, look(0, 0.0), skin(0), min(stations[0][1], stations[0][2]))
    if cap_end:
        a, c = Vector(points[-1]), Vector(points[-2])
        tip = a + (a - c).normalized() * min(stations[-1][1], stations[-1][2]) * 0.6
        end = b.vert(tip, look(len(stations) - 1, 0.0), skin(len(stations) - 1),
                     min(stations[-1][1], stations[-1][2]))
    b.loft(rings, close_start=start, close_end=end)
    b.orient(first, nearest_on(points))


# Body: z, half width, top, bottom, centre height (tail at the back, the neck's root in front).
BODY = [
    (0.232, 0.030, 0.030, 0.030, 0.036),
    (0.170, 0.084, 0.080, 0.092, 0.011),
    (0.080, 0.111, 0.109, 0.115, 0.000),
    (-0.030, 0.113, 0.111, 0.107, 0.001),
    (-0.140, 0.093, 0.091, 0.077, 0.012),
    (-0.240, 0.050, 0.046, 0.032, 0.024),
    (-0.330, 0.012, 0.009, 0.007, 0.029),
]
BODY_RING = 8


def body_colour(z, up):
    c = mix(PLUMAGE["pale"], PLUMAGE["body"], smooth(0.1, 0.7, up))
    return mix(c, PLUMAGE["breast"], smooth(0.12, 0.2, z))


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
            ring.append(b.vert((x, y, z), body_colour(z, sa), neck_skin(z)))
        rings.append(ring)
    rings.reverse()  # tail to front, so the loft runs forward
    rump = b.vert((0, BODY[-1][4], BODY[-1][0] - 0.006), PLUMAGE["body"], neck_skin(BODY[-1][0]))
    front = b.vert((0, BODY[0][4], BODY[0][0] + 0.004), PLUMAGE["breast"], neck_skin(BODY[0][0]))
    b.loft(rings, close_start=rump, close_end=front)
    b.orient(first, lambda c: (0.0, interp([(z, cy) for z, _, _, _, cy in reversed(BODY)], c.z), c.z))


# The neck and head along z (the rest pose is the bird on the wing): z, half width, half height.
# A ring at every joint and one between, so the S bends smoothly; the head's three at the end.
NECK = [
    (0.200, 0.036, 0.036), (0.262, 0.026, 0.028), (0.360, 0.019, 0.021), (0.430, 0.0175, 0.0195),
    (0.500, 0.0165, 0.0185), (0.570, 0.016, 0.018), (0.640, 0.016, 0.018), (0.710, 0.017, 0.0195),
    (0.776, 0.021, 0.024), (0.815, 0.027, 0.029), (0.858, 0.022, 0.026),
]
TUBE_SIDES = 4


def build_neck(b):
    stations = [((0.0, NECK_Y, z), hw, hh) for z, hw, hh in NECK]

    def look(i, sa):
        return mix(PLUMAGE["breast"], PLUMAGE["neck"], smooth(0.22, 0.3, NECK[i][0]))

    tube(b, stations, TUBE_SIDES, look, lambda i: neck_skin(NECK[i][0]), cap_start=True, cap_end=False)


# The bill: thick at its base, bent down at its middle, black from the bend (z, y, hw, hh).
BILL = [
    (0.852, 0.036, 0.017, 0.023), (0.910, 0.032, 0.012, 0.017), (0.945, 0.012, 0.0088, 0.0115),
    (0.958, -0.021, 0.0046, 0.0055),
]


def build_bill(b):
    stations = [((0.0, y, z), hw, hh) for z, y, hw, hh in BILL]

    def look(i, sa):
        return PLUMAGE["billTip"] if i >= 2 else PLUMAGE["bill"]

    tube(b, stations, TUBE_SIDES, look, lambda i: ("head", "neck3", 1.0), cap_start=False, cap_end=True)


def build_leg(b, side):
    """The leg and shank in the rest pose (trailing straight back), a foot at the end."""
    hip, ankle, toe = (Vector(p) for p in (HIP, ANKLE, TOE))
    if side < 0:
        hip, ankle, toe = (Vector(_mx(p)) for p in (HIP, ANKLE, TOE))
    knee = (ankle - hip).length
    path = []
    # (fraction along the whole leg, half width, half height)
    profile = [(0.00, 0.016, 0.016), (0.10, 0.011, 0.011), (0.40, 0.0095, 0.0095), (0.457, 0.013, 0.013),
               (0.51, 0.0095, 0.0095), (0.88, 0.0085, 0.0085), (0.95, 0.019, 0.006), (1.00, 0.012, 0.004)]
    total = knee + (toe - ankle).length
    for f, hw, hh in profile:
        along = f * total
        if along <= knee:
            p = hip + (ankle - hip) * (along / knee)
        else:
            p = ankle + (toe - ankle) * ((along - knee) / (toe - ankle).length)
        path.append((tuple(p), hw, hh, along))
    stations = [(p, hw, hh) for p, hw, hh, _ in path]

    def look(i, sa):
        along = path[i][3]
        c = PLUMAGE["leg"]
        return mix(c, PLUMAGE["knee"], smooth(0.04, 0.0, abs(along - knee)))

    tube(b, stations, TUBE_SIDES, look, lambda i: leg_skin(path[i][3], side), cap_start=True, cap_end=True)


# Wings: stations along the span (|x|, m), one at each joint and one between.
STATIONS = [0.075, 0.150, 0.290, 0.380, 0.470, 0.600, 0.720, 0.780]
# Leading and trailing edges (z) along the span: long narrow wings, the hand tapering to a
# rounded tip.
LEADING = [(0.075, 0.140), (0.200, 0.142), (0.300, 0.138), (0.470, 0.148), (0.560, 0.124), (0.650, 0.082),
           (0.720, 0.044), (0.760, 0.012), (0.780, -0.010)]
TRAILING = [(0.075, -0.062), (0.180, -0.098), (0.300, -0.106), (0.470, -0.100), (0.580, -0.090),
            (0.680, -0.070), (0.740, -0.050), (0.780, -0.026)]
THICKNESS = [(0.075, 0.12), (0.300, 0.10), (0.470, 0.08), (0.650, 0.05), (0.780, 0.03)]
# Chord fractions (leading edge 0 → trailing edge 1): the coverts end between the second and third.
CHORD = [0.0, 0.3, 0.6, 1.0]
WING_Y = 0.070


def wing_centre(s):
    return WING_Y - 0.006 * (s / 0.78)


def airfoil(c, t, x):
    camber = 0.04 * 4 * x * (1 - x)
    yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    yt *= 1 - smooth(0.45, 1.0, x) * 0.85
    return camber * c, yt * c, yt * c * 0.4


def wing_colour(s, x, upper):
    """s: |x| along the span; x: chord fraction 0 LE .. 1 TE. Coverts pink, flight feathers black."""
    hand = smooth(0.46, 0.50, s)
    covert_edge = 0.46 * (1 - hand) + 0.30 * hand
    covert_edge *= 1 - smooth(0.56, 0.64, s)    # past the primary coverts: all primary
    black = smooth(covert_edge - 0.04, covert_edge + 0.04, x) if covert_edge > 0.02 else 1.0
    if upper:
        base = mix(PLUMAGE["lesser"], PLUMAGE["coverts"], smooth(0.02, 0.18, x))
    else:
        base = PLUMAGE["under"]
    return mix(base, PLUMAGE["black"], black)


def build_wing(b, side):
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
            half = max(0.0015, (up + down) * 0.5)
            ring.append(b.vert((side * s, y, z), wing_colour(s, x, upper or x in (0.0, 1.0)),
                               wing_skin(s, z, side), half, PLATE))
        rings.append(ring)
    root = b.vert((side * STATIONS[0], wing_centre(0), 0.03), PLUMAGE["body"], wing_skin(0.0, 0.0, side), 0.02,
                  PLATE)
    tip = b.vert((side * (STATIONS[-1] + 0.004), wing_centre(0.78), -0.022), PLUMAGE["black"],
                 wing_skin(0.784, -0.022, side), 0.002, PLATE)
    b.loft(rings, close_start=root, close_end=tip)
    b.orient(first, lambda c: (c.x, wing_centre(abs(c.x)), interp(LEADING, abs(c.x)) * 0.5
                               + interp(TRAILING, abs(c.x)) * 0.5))


def build_mesh():
    b = Builder()
    build_body(b)
    build_neck(b)
    build_bill(b)
    build_leg(b, 1)
    build_leg(b, -1)
    build_wing(b, 1)
    build_wing(b, -1)
    return b


# ── The poses: joint angles (degrees) ─────────────────────────────────────────
#
# body     bob (m, up), surge (m, forward), pitch (nose up, degrees)
# neck     n0 … n3: each neck segment's turn up (nose up) from the one before; yaw: the neck's
#          root turned to the bird's left; head: the head's turn up
# legs     hipL / hipR: the leg swung down from trailing straight back (90: straight down);
#          kneeL / kneeR: the shank folded back at the ankle
# wings    sh_elev (the arm raised), sh_sweep (swung back), sh_twist (leading edge down), el_flex
#          (the elbow folded), wr_fold (the hand swung back), wr_elev (the hand raised),
#          wr_twist (its leading edge down), scale (the whole wing about the shoulder); a pose
#          may give `wingR` for the right wing, else it mirrors the left
DEFAULTS = dict(bob=0.0, surge=0.0, pitch=0.0, n0=0.0, n1=0.0, n2=0.0, n3=0.0, yaw=0.0, head=0.0,
                hipL=0.0, kneeL=0.0, hipR=0.0, kneeR=0.0)
WING_DEFAULTS = dict(sh_elev=0.0, sh_sweep=0.0, sh_twist=0.0, el_flex=0.0, wr_fold=0.0, wr_elev=0.0,
                     wr_twist=0.0, scale=1.0)

# On the wing: the neck stretched forward and drooping a little, the bill bent down, the legs
# trailing straight back a touch below the body's line.
FLIGHT = dict(n0=-6, n1=-1, n2=0.5, n3=1.5, head=-10, hipL=7, hipR=7, kneeL=-3, kneeR=-3)
# One wingbeat from the top of the stroke; the downstroke takes half of it. Quick, fairly deep
# strokes with straight wings: a flamingo flaps more than it glides.
FLAP_KEYS = [
    (0.000, dict(sh_elev=44, sh_sweep=2, sh_twist=-2, el_flex=8, wr_fold=10, wr_elev=10, wr_twist=-4,
                 bob=-0.008, pitch=1.0)),
    (0.125, dict(sh_elev=30, sh_sweep=-2, sh_twist=4, el_flex=2, wr_fold=4, wr_elev=6, wr_twist=2,
                 bob=-0.005, pitch=0.5)),
    (0.250, dict(sh_elev=6, sh_sweep=-5, sh_twist=8, el_flex=0, wr_fold=0, wr_elev=2, wr_twist=6,
                 bob=0.002, pitch=-0.5)),
    (0.375, dict(sh_elev=-22, sh_sweep=-4, sh_twist=8, el_flex=0, wr_fold=0, wr_elev=-3, wr_twist=6,
                 bob=0.008, pitch=-1.0)),
    (0.500, dict(sh_elev=-36, sh_sweep=0, sh_twist=4, el_flex=4, wr_fold=4, wr_elev=-8, wr_twist=2,
                 bob=0.008, pitch=-0.5)),
    (0.625, dict(sh_elev=-27, sh_sweep=5, sh_twist=-4, el_flex=14, wr_fold=18, wr_elev=-12, wr_twist=-6,
                 bob=0.004, pitch=0.5)),
    (0.750, dict(sh_elev=-5, sh_sweep=9, sh_twist=-8, el_flex=20, wr_fold=26, wr_elev=-12, wr_twist=-8,
                 bob=-0.002, pitch=1.0)),
    (0.875, dict(sh_elev=25, sh_sweep=7, sh_twist=-6, el_flex=16, wr_fold=20, wr_elev=0, wr_twist=-6,
                 bob=-0.007, pitch=1.2)),
]
GLIDE = dict(sh_elev=4, sh_sweep=3, sh_twist=2, el_flex=6, wr_fold=6, wr_elev=-3, wr_twist=0)

# Standing: the body high on straight legs, the wing folded flat along the flank and scaled into
# it, the neck in its S, the bill hanging.
FOLDED = dict(sh_elev=-9, sh_sweep=101, sh_twist=-80, el_flex=0, wr_fold=0, wr_elev=0, wr_twist=0, scale=0.5)
S_NECK = dict(n0=72, n1=36, n2=-42, n3=-52, head=-26)
LEGS_DOWN = dict(hipL=90, kneeL=0, hipR=90, kneeR=0)
STAND = dict(pitch=-2, **S_NECK, **LEGS_DOWN)
# One stride from the left foot set down ahead; the swing leg's shank folds well back.
WALK_KEYS = [
    (0.00, dict(hipL=101, kneeL=2, hipR=78, kneeR=12, bob=-0.012, n0=70, n1=37, n2=-41, n3=-52, head=-24)),
    (0.25, dict(hipL=90, kneeL=0, hipR=97, kneeR=64, bob=0.004, n0=73, n1=35, n2=-42, n3=-53, head=-26)),
    (0.50, dict(hipL=78, kneeL=12, hipR=101, kneeR=2, bob=-0.012, n0=70, n1=37, n2=-41, n3=-52, head=-24)),
    (0.75, dict(hipL=97, kneeL=64, hipR=90, kneeR=0, bob=0.004, n0=73, n1=35, n2=-42, n3=-53, head=-26)),
]
# Feeding: the body tipped forward, the neck down, the head upside down in the water sweeping.
FEED = dict(pitch=-30, n0=-50, n1=-10, n2=-4, n3=-6, head=-78, hipL=116, kneeL=46, hipR=112, kneeR=42)
ALERT = dict(pitch=6, n0=80, n1=5, n2=-1, n3=-6, head=-74, **LEGS_DOWN)
STRETCH = dict(pitch=4, n0=74, n1=10, n2=-4, n3=-10, head=-58, **LEGS_DOWN)
SALUTE = dict(sh_elev=58, sh_sweep=-6, sh_twist=8, el_flex=10, wr_fold=14, wr_elev=-8, wr_twist=0)
REST = dict(pitch=0, n0=56, n1=48, n2=-26, n3=-50, head=-34, hipL=90, kneeL=0, hipR=120, kneeR=165)

CYCLE_FRAMES = 24
FLAP_ROWS = 16
WALK_ROWS = 8
SINGLE = ["Glide", "Stand", "FeedL", "FeedR", "Alert", "Stretch", "Rest"]


def single_pose(name):
    """name → (pose dict, left wing dict, right wing dict or None)."""
    if name == "Glide":
        return {**DEFAULTS, **FLIGHT}, {**WING_DEFAULTS, **GLIDE}, None
    if name == "Stand":
        return {**DEFAULTS, **STAND}, {**WING_DEFAULTS, **FOLDED}, None
    if name in ("FeedL", "FeedR"):
        return {**DEFAULTS, **FEED, "yaw": 24 if name == "FeedL" else -24}, {**WING_DEFAULTS, **FOLDED}, None
    if name == "Alert":
        return {**DEFAULTS, **ALERT}, {**WING_DEFAULTS, **FOLDED}, None
    if name == "Stretch":
        return {**DEFAULTS, **STRETCH}, {**WING_DEFAULTS, **SALUTE}, None
    if name == "Rest":
        return {**DEFAULTS, **REST}, {**WING_DEFAULTS, **FOLDED}, None
    raise KeyError(name)


def flap_key(phase_pose):
    wing = {k: v for k, v in phase_pose.items() if k in WING_DEFAULTS}
    body = {k: v for k, v in phase_pose.items() if k not in WING_DEFAULTS}
    return {**DEFAULTS, **FLIGHT, **body}, {**WING_DEFAULTS, **wing}, None


def walk_key(phase_pose):
    return {**DEFAULTS, **STAND, **phase_pose}, {**WING_DEFAULTS, **FOLDED}, None


# ── Forward kinematics: the deform of every bone (game frame, rest-relative) ──

def _t(p):
    return Matrix.Translation(Vector(p))


def _rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def _ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def _rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def _about(pivot, m):
    return _t(pivot) @ m @ _t([-v for v in pivot])


MIRROR = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))


def _wing_chain(body, w):
    arm = body @ _about(SHOULDER, _rz(w["sh_elev"]) @ _ry(w["sh_sweep"]) @ _rx(w["sh_twist"])
                        @ Matrix.Scale(w["scale"], 4))
    fore = arm @ _about(ELBOW, _ry(-w["el_flex"]))
    hand = fore @ _about(WRIST, _ry(w["wr_fold"]) @ _rz(w["wr_elev"]) @ _rx(w["wr_twist"]))
    return arm, fore, hand


def deforms(pose, wing_l, wing_r=None):
    """bone → 4×4 deform (game frame) for a pose."""
    d = {}
    body = _t((0.0, pose["bob"], pose["surge"])) @ _about(BODY_PIVOT, _rx(-pose["pitch"]))
    d["body"] = body
    parent = body
    for k in range(4):
        pivot = (0.0, NECK_Y, NECK_JOINTS[k])
        turn = _rx(-pose[f"n{k}"])
        if k == 0:
            turn = _ry(pose["yaw"]) @ turn
        parent = parent @ _about(pivot, turn)
        d[f"neck{k}"] = parent
    d["head"] = parent @ _about((0.0, NECK_Y, NECK_JOINTS[4]), _rx(-pose["head"]))
    for sfx, sign in (("L", 1), ("R", -1)):
        hip = HIP if sign > 0 else _mx(HIP)
        ankle = ANKLE if sign > 0 else _mx(ANKLE)
        leg = body @ _about(hip, _rx(-pose[f"hip{sfx}"]))
        d[f"leg.{sfx}"] = leg
        d[f"shank.{sfx}"] = leg @ _about(ankle, _rx(pose[f"knee{sfx}"]))
    d["arm.L"], d["fore.L"], d["hand.L"] = _wing_chain(body, wing_l)
    right = _wing_chain(body, wing_r or wing_l)
    inv = body.inverted()
    for name, m in zip(("arm", "fore", "hand"), right):
        d[f"{name}.R"] = body @ MIRROR @ (inv @ m) @ MIRROR
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
    mesh = bpy.data.meshes.new("SolarEclipseFlamingo")
    mesh.from_pydata([to_b(v) for v in built.verts], [], [tuple(f) for f in built.faces])
    mesh.update()
    col = mesh.color_attributes.new("plumage", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(built.colours):
        col.data[i].color = (c[0], c[1], c[2], 1.0)
    for poly in mesh.polygons:
        poly.use_smooth = True
    bird = bpy.data.objects.new("SolarEclipseFlamingo", mesh)
    _link(scene, bird)

    arm_data = bpy.data.armatures.new("SolarEclipseFlamingoRig")
    arm_data.display_type = "STICK"
    rig = bpy.data.objects.new("SolarEclipseFlamingoRig", arm_data)
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
        bird.vertex_groups.new(name=name)
    for i, (b0, b1, w0) in enumerate(built.skins):
        bird.vertex_groups[b0].add([i], w0, "REPLACE")
        if w0 < 1.0:
            bird.vertex_groups[b1].add([i], 1.0 - w0, "ADD")
    mod = bird.modifiers.new("Rig", "ARMATURE")
    mod.object = rig
    mod.use_vertex_groups = True
    bird.parent = rig
    return built, bird, rig


def _basis(rig, name, d):
    bone = rig.data.bones[name]
    ml = bone.matrix_local
    parent = PARENT.get(name)
    rel = d[name] if parent is None else d[parent].inverted() @ d[name]
    return ml.inverted() @ rel @ ml


def _blender_deforms(pose):
    return {k: G2B @ v @ B2G for k, v in deforms(*pose).items()}


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


def _key_pose(rig, pose, frame, previous):
    d = _blender_deforms(pose)
    for bone in BONES:
        pb = rig.pose.bones[bone]
        pb.rotation_mode = "QUATERNION"
        loc, rot, scale = _basis(rig, bone, d).decompose()
        if bone in previous and previous[bone].dot(rot) < 0:
            rot = -rot
        previous[bone] = rot
        pb.location = loc
        pb.rotation_quaternion = rot
        pb.scale = scale
        pb.keyframe_insert("location", frame=frame, group=bone)
        pb.keyframe_insert("rotation_quaternion", frame=frame, group=bone)
        pb.keyframe_insert("scale", frame=frame, group=bone)


def key_action(rig, name, keys, cycle):
    """Keyframe `keys` [(phase, pose triple)] as action `name`; cyclic when `cycle`."""
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    previous = {}
    for phase, pose in keys:
        _key_pose(rig, pose, 1 + phase * CYCLE_FRAMES, previous)
    if cycle:
        _key_pose(rig, keys[0][1], 1 + CYCLE_FRAMES, previous)
        for fc in _fcurves(action):
            fc.modifiers.new("CYCLES")
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"
            fc.update()
    return action


def build_rig_and_actions(scene):
    built, bird, rig = build_objects(scene)
    actions = {}
    for name in SINGLE:
        actions[name] = key_action(rig, name, [(0.0, single_pose(name))], cycle=False)
    actions["Walk"] = key_action(rig, "Walk", [(p, walk_key(k)) for p, k in WALK_KEYS], cycle=True)
    actions["Flap"] = key_action(rig, "Flap", [(p, flap_key(k)) for p, k in FLAP_KEYS], cycle=True)
    rig.animation_data.action = actions["Flap"]
    scene.frame_start = 1
    scene.frame_end = CYCLE_FRAMES
    scene.render.fps = 24
    return built, bird, rig, actions


# ── Sampling Blender's evaluated rig ──────────────────────────────────────────

def _set_frame(scene, frame):
    whole = math.floor(frame)
    scene.frame_set(int(whole), subframe=frame - whole)


def row_plan():
    """The rows the export samples: (action, frame) each."""
    plan = [("Flap", 1 + i * CYCLE_FRAMES / FLAP_ROWS) for i in range(FLAP_ROWS)]
    plan += [("Walk", 1 + i * CYCLE_FRAMES / WALK_ROWS) for i in range(WALK_ROWS)]
    plan += [(name, 1) for name in SINGLE]
    return plan


def _apply(scene, rig, actions, action, frame):
    rig.animation_data.action = actions[action]
    _set_frame(scene, frame)


def sample_rows(scene, rig, actions):
    rows = []
    for action, frame in row_plan():
        _apply(scene, rig, actions, action, frame)
        rows.append(_read_pose(scene, rig))
    _apply(scene, rig, actions, "Flap", 1)
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
        if max(scale) - min(scale) > 1e-4:
            raise RuntimeError(f"{TAG} bone {name} is not scaled evenly: {tuple(scale)}")
        out.append((rot.x, rot.y, rot.z, rot.w, loc.x, loc.y, loc.z, scale.x))
    return out


def evaluated_positions(scene, bird):
    depsgraph = scene.view_layers[0].depsgraph
    ev = bird.evaluated_get(depsgraph)
    m = ev.to_mesh()
    pts = [to_g(tuple(v.co)) for v in m.vertices]
    ev.to_mesh_clear()
    return pts


def skin_twin(rest, skin, row):
    """The theme's vertex stage, in Python: two bones, quaternion + translation + scale each."""
    out = []
    for p, (b0, b1, w0) in zip(rest, skin):
        acc = Vector((0.0, 0.0, 0.0))
        for bone, w in ((b0, w0), (b1, 1.0 - w0)):
            if w <= 0:
                continue
            qx, qy, qz, qw, tx, ty, tz, s = row[BONES.index(bone)]
            acc += ((Quaternion((qw, qx, qy, qz)) @ Vector(p)) * s + Vector((tx, ty, tz))) * w
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
    """A handful of telling vertices: both wingtips, the bill's tip, both feet, the neck's middle."""
    verts = built.verts

    def nearest(target):
        return min(range(len(verts)), key=lambda i: sum((verts[i][k] - target[k]) ** 2 for k in range(3)))

    return [nearest((0.784, 0.064, -0.022)), nearest((-0.784, 0.064, -0.022)), nearest((0.0, -0.024, 0.960)),
            nearest((0.034, -0.068, -0.745)), nearest((-0.034, -0.068, -0.745)), nearest((0.0, 0.055, 0.505))]


def write_module(path, built, rows, checks, plan):
    tris = built.triangles()
    positions = [int(round(c / QUANT)) for v in built.verts for c in v]
    index = [i for t in tris for i in t]
    skin = []
    for (b0, b1, w0), mm in zip(built.skins, built.radius):
        skin.extend((BONES.index(b0), BONES.index(b1), int(round(w0 * 255)), mm))
    colours = []
    for r, g, b, kind in built.colours:
        colours.extend(int(round(max(0.0, min(1.0, x)) * 255)) for x in (r, g, b))
        colours.append(kind)
    poses = [round(x, 6) for row in rows for bone in row for x in bone]
    span = max(v[0] for v in built.verts) - min(v[0] for v in built.verts)
    length = max(v[2] for v in built.verts) - min(v[2] for v in built.verts)
    names = {}
    for i, (action, _) in enumerate(plan):
        names.setdefault(action, i)
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Solar Eclipse's flamingo: GENERATED by scripts/blender/solar_eclipse_flamingo.py (do not",
        " * edit by hand).",
        " *",
        " * A greater flamingo modelled, rigged and animated in Blender. Game frame: x the bird's left,",
        " * y up, z forward; metres, real size, the rest pose on the wing. `positions` are Int16 in units",
        " * of `quant` metres; `index` Uint16 triangles; `skin` Uint8 (bone, bone, the first one's",
        " * weight / 255, the vertex's half-thickness in mm, 255 = never widened); `colours` Uint8",
        " * linear plumage (r, g, b, kind: 255 solid, 128 a wing's plate, 0 a thin tube). `poses` is",
        " * rows of bones of (qx, qy, qz, qw, tx, ty, tz, s): each bone's deform, rest to pose (a turn,",
        " * a move and an even scale). `rows` names where each",
        " * action's rows begin (Flap and Walk are cycles of `flapRows` and `walkRows`). `parents` and",
        " * `pivots` (each bone's joint at rest) let the theme blend rows joint by joint; `toes` are the",
        " * feet's tips at rest. `checks` are vertices as Blender's own rig deformed them at some rows.",
        " */",
        "export const SE_FLAMINGO = Object.freeze({",
        f"    bones: {json.dumps(BONES)},",
        f"    span: {round(span, 4)},",
        f"    length: {round(length, 4)},",
        f"    quant: {QUANT},",
        f"    vertexCount: {len(built.verts)},",
        f"    triangleCount: {len(tris)},",
        f"    flapRows: {FLAP_ROWS},",
        f"    walkRows: {WALK_ROWS},",
        f"    rows: {json.dumps(names, separators=(', ', ': '))},",
        f"    rowCount: {len(rows)},",
        f"    parents: {json.dumps([BONES.index(PARENT[b]) if b in PARENT else -1 for b in BONES])},",
        f"    pivots: {json.dumps([[round(c, 6) for c in BONE_ENDS[b][0]] for b in BONES])},",
        f"    toes: {json.dumps([[round(c, 6) for c in TOE], [round(c, 6) for c in _mx(TOE)]])},",
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


def export(scene, built, bird, rig, actions, path):
    rows = sample_rows(scene, rig, actions)
    plan = row_plan()
    rest = built.verts
    picks = check_vertices(built)
    checks = []
    worst = 0.0
    for row_index, (action, frame) in enumerate(plan):
        _apply(scene, rig, actions, action, frame)
        blender = evaluated_positions(scene, bird)
        twin = skin_twin(rest, built.skins, rows[row_index])
        worst = max(worst, max((Vector(a) - Vector(b)).length for a, b in zip(blender, twin)))
        if row_index in (0, 5, 10, FLAP_ROWS + 2, FLAP_ROWS + WALK_ROWS + 1, FLAP_ROWS + WALK_ROWS + 2,
                         FLAP_ROWS + WALK_ROWS + 5):
            for v in picks:
                checks.append({"vertex": v, "row": row_index, "at": [round(c, 5) for c in blender[v]]})
    _apply(scene, rig, actions, "Flap", 1)
    if worst > 1e-4:
        raise RuntimeError(f"{TAG} the twin strays from Blender's rig by {worst * 1000:.3f} mm")
    write_module(path, built, rows, checks, plan)
    print(f"{TAG} wrote {path}: {len(built.verts)} vertices, {len(built.triangles())} triangles, "
          f"{len(rows)} rows, twin within {worst * 1000:.4f} mm")
    return rows


def report_shape(rows, built):
    """Numbers to stand the poses by: feet, head and bill heights per row."""
    plan = row_plan()
    bill = check_vertices(built)[2]
    out = []
    for i, (action, frame) in enumerate(plan):
        row = rows[i]
        pts = skin_twin([built.verts[bill]], [built.skins[bill]], row)
        toes = []
        for sfx, toe in (("L", TOE), ("R", _mx(TOE))):
            qx, qy, qz, qw, tx, ty, tz, s = row[BONES.index(f"shank.{sfx}")]
            toes.append(((Quaternion((qw, qx, qy, qz)) @ Vector(toe)) * s + Vector((tx, ty, tz))).y)
        head = row[BONES.index("head")]
        out.append(f"{action}@{frame:.2f}: toes {min(toes):+.3f} {max(toes):+.3f} bill {pts[0][1]:+.3f} "
                   f"(over the low toe {pts[0][1] - min(toes):+.3f}) head joint y {head[5]:+.3f}")
    print(TAG + "\n  " + "\n  ".join(out))


# ── Previews (Workbench, orthographic lineups) ────────────────────────────────

def _baked_copy(scene, bird, name):
    depsgraph = scene.view_layers[0].depsgraph
    mesh = bpy.data.meshes.new_from_object(bird.evaluated_get(depsgraph))
    return bpy.data.objects.new(name, mesh)


def previews(scene, bird, rig, actions, out_dir, collection_name="SolarEclipseFlamingoPreview"):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    col = bpy.data.collections.get(collection_name) or bpy.data.collections.new(collection_name)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    flight = []
    for ph in [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]:
        _apply(scene, rig, actions, "Flap", 1 + ph * CYCLE_FRAMES)
        flight.append(_baked_copy(scene, bird, f"pv flap {ph:.3f}"))
    _apply(scene, rig, actions, "Glide", 1)
    flight.append(_baked_copy(scene, bird, "pv glide"))
    ground = []
    for name in ["Stand", "Alert", "FeedL", "FeedR", "Stretch", "Rest"]:
        _apply(scene, rig, actions, name, 1)
        ground.append(_baked_copy(scene, bird, f"pv {name}"))
    for ph in [0.0, 0.25, 0.5, 0.75]:
        _apply(scene, rig, actions, "Walk", 1 + ph * CYCLE_FRAMES)
        ground.append(_baked_copy(scene, bird, f"pv walk {ph:.2f}"))
    _apply(scene, rig, actions, "Flap", 1)

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_object_outline = False
    world = scene.world or bpy.data.worlds.new("SolarEclipseFlamingoWorld")
    scene.world = world
    world.color = (0.55, 0.22, 0.07)
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    for o in (bird, rig):
        o.hide_render = True
    cam_data = bpy.data.cameras.get("SEFlamingoCam") or bpy.data.cameras.new("SEFlamingoCam")
    cam = bpy.data.objects.get("SEFlamingoCam") or bpy.data.objects.new("SEFlamingoCam", cam_data)
    if cam.name not in col.objects:
        col.objects.link(cam)
    scene.camera = cam
    cam_data.type = "ORTHO"
    files = []

    def shoot(objs, direction, up, axis, gap, name, width, height, scale_extra=1.04, colour="VERTEX"):
        for o in list(col.objects):
            if o.type == "MESH":
                col.objects.unlink(o)
        for k, obj in enumerate(objs):
            obj.location = axis * (k - (len(objs) - 1) / 2) * gap
            col.objects.link(obj)
        right = direction.cross(up).normalized()
        true_up = right.cross(direction).normalized()
        rot = Matrix((right, true_up, -direction)).transposed().to_quaternion()
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = rot
        centre = Vector((0, 0, -0.08)) if objs is ground else Vector((0, 0, 0))
        cam.location = centre - direction * 8.0
        cam_data.ortho_scale = gap * len(objs) * scale_extra
        scene.display.shading.color_type = colour
        scene.display.shading.single_color = (0.02, 0.012, 0.012)
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        path = out / f"flamingo-{name}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        files.append(str(path))

    side = Vector((-1, 0, 0))
    up = Vector((0, 0, 1))
    shoot(flight, side, up, Vector((0, 1, 0)), 2.1, "flight-side", 1800, 300)
    shoot(flight, Vector((0, 1, 0)), up, Vector((1, 0, 0)), 1.8, "flight-front", 1800, 280)
    shoot(flight, Vector((0, 0, -1)), Vector((0, -1, 0)), Vector((1, 0, 0)), 1.8, "flight-top", 1800, 260)
    shoot(ground, side, up, Vector((0, 1, 0)), 1.0, "ground-side", 1800, 260)
    shoot(ground, Vector((-0.6, 0.8, 0.0)).normalized(), up, Vector((0.8, 0.6, 0)), 1.0, "ground-three", 1800, 260)
    # Game size: a 1.55 m span is ~25 px at 120 m; render the lineups that small (judge ×8).
    shoot(flight, Vector((-0.97, 0.0, 0.05)).normalized(), up, Vector((0, 1, 0)), 2.1, "flight-game",
          int(9 * 2.1 / 1.55 * 25), 40, colour="SINGLE")
    shoot(flight, Vector((-0.70, 0.70, 0.05)).normalized(), up, Vector((0.7, 0.7, 0)), 2.1, "flight-game-oblique",
          int(9 * 2.1 / 1.55 * 25), 40, colour="SINGLE")
    shoot(ground, side, up, Vector((0, 1, 0)), 1.0, "ground-game", int(10 * 1.0 / 1.3 * 11), 16, colour="SINGLE")
    for o in (bird, rig):
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
        for name in ["Flap", "Walk"] + SINGLE:
            a = bpy.data.actions.get(name)
            if a is not None and a.users <= 1:
                bpy.data.actions.remove(a)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(SCENE)
    built, bird, rig, actions = build_rig_and_actions(scene)
    report = {"vertices": len(built.verts), "triangles": len(built.triangles())}
    if export_path:
        export(scene, built, bird, rig, actions, export_path)
        report["export"] = export_path
    if preview_dir:
        report["previews"] = previews(scene, bird, rig, actions, preview_dir)
        col = bpy.data.collections.get("SolarEclipseFlamingoPreview")
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
    scene = bpy.data.scenes.new(SCENE)
    built, bird, rig, actions = build_rig_and_actions(scene)
    if out:
        rows = export(scene, built, bird, rig, actions, out)
        report_shape(rows, built)
    if preview_dir:
        previews(scene, bird, rig, actions, preview_dir)


if __name__ == "__main__":
    main()
