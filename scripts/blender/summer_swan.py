"""Summer's swans, modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/summer_swan.py -- \
        --out src/themes/summer [--preview <dir>]

It writes ONE generated module, src/themes/summer/summer-swan-model.js (no .glb: the theme's
asset folder is pinned to its twelve files), holding three shapes of the lake's mute swans:

  afloat   an adult on the water: the full rounded body riding high, cut a hand under the
           waterline so it sits IN the lake, the folded wings arched a little over the back, the
           long neck in its S, the head carried bill down, an orange bill with its black knob
  cygnet   a grey, downy, short-necked young one (afloat only)
  flying   the same bird on the wing: the neck stretched straight out, the feet trailing under
           the tail, long broad wings spread flat (the theme beats them about two hinges)

On screen an adult is 18 to 40 px long, so the shapes are built for the silhouette that names a
swan at that size: the neck's curve, the raised wings, the clean white. Game frame, metres, real
size: x the bird's left, y up (the waterline at y = 0 for the two afloat shapes), z forward.

No skeleton. Each vertex carries four shares the theme's vertex stage reads (`rig`):

  wing   afloat: how much of a wing-raise the vertex takes (the folded wings lift like sails);
         flying: how much of the shoulder's turn (0 on the body, 1 past the hinge band)
  hand   flying: how much of the wrist's turn the outer wing takes
  neck   afloat: how much of a head-dip (0 at the neck's root, 1 at the head)
  shade  how open the vertex is to the sky (the hull near the water and the groove between the
         wings are darker)

and a colour (`colours`: linear r, g, b and `thin`, how much low sun a feather lets through).
`pose_afloat` and `pose_flying` below are the vertex stage's twins; the module carries a few
vertices as they pose them (`checks`), so the theme's tests hold its own twin to this file.

Blender does the mesh work: the rings are joined into quads, triangulated and given their smooth
normals there, and `--preview` renders orthographic lineups of the poses (Workbench).

Deterministic: the same script writes the same file.
"""

import base64
import json
import math
import sys
from array import array
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

TAG = "[summer-swan]"
SCENE = "SummerSwan"
MODULE = "summer-swan-model.js"


# ── Small maths ──────────────────────────────────────────────────────────────

def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


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


def catmull(points, f):
    """The uniform Catmull-Rom curve through `points` (tuples) at index `f` (0 .. len - 1)."""
    n = len(points) - 1
    f = max(0.0, min(float(n), f))
    i = min(int(f), n - 1)
    u = f - i
    p0, p1, p2, p3 = points[max(i - 1, 0)], points[i], points[i + 1], points[min(i + 2, n)]
    return tuple(
        0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u ** 3)
        for a, b, c, d in zip(p0, p1, p2, p3))


PLUMAGE = {
    "white": lin("#f4f3ef"),
    "cream": lin("#f0ece2"),        # the head and upper neck, a touch warmer
    "groove": lin("#e3e1db"),
    "bill": lin("#e4631a"),
    "black": lin("#141416"),
    "leg": lin("#252527"),
    "down": lin("#a59e96"),         # a cygnet's grey down
    "downDark": lin("#89837c"),
    "downPale": lin("#cfcac2"),
    "cygnetBill": lin("#48484e"),
}

PARTS = ["body", "neck", "head", "bill", "wing", "feet"]


# ── The mesh, built as plain lists in the game frame ──────────────────────────

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.colours = []   # per vertex: (r, g, b, thin)
        self.rig = []       # per vertex: (wing, hand, neck, shade)
        self.parts = []     # per vertex: index into PARTS

    def vert(self, p, colour, part, thin=0.0, wing=0.0, hand=0.0, neck=0.0, shade=1.0):
        self.verts.append(tuple(float(v) for v in p))
        self.colours.append((colour[0], colour[1], colour[2], thin))
        self.rig.append((wing, hand, neck, shade))
        self.parts.append(PARTS.index(part))
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
        """Turn the faces since `first` outward (away from the point `inside(c)`) if they face in."""
        votes = 0.0
        for f in self.faces[first:]:
            p = [Vector(self.verts[i]) for i in f]
            n = (p[1] - p[0]).cross(p[2] - p[0])
            c = sum(p, Vector()) / len(p)
            votes += n.dot(c - Vector(inside(c)))
        if votes < 0:
            self.faces[first:] = [tuple(reversed(f)) for f in self.faces[first:]]


def hull(b, stations, ring, steps, look, part="body", px=0.85, qt=0.82, qb=0.7):
    """
    A body: stations (z, half width, top, bottom, widest height, lobe) resampled to `steps` rings
    of `ring` points, each a closed section (round above, a flatter hull below, two wing lobes
    either side of the spine where `lobe` > 0). `look(z, up, across, lobe_share)` gives a vertex
    its colour and shares as a dict.
    """
    first = b.part()
    rings = []
    centres = []
    for k in range(steps):
        z, w, top, bottom, mid, lobe = catmull(stations, k * (len(stations) - 1) / (steps - 1))
        row = []
        for i in range(ring):
            a = math.pi / 2 + 2 * math.pi * i / ring
            ca, sa = math.cos(a), math.sin(a)
            u = abs(ca) ** px
            x = w * math.copysign(u, ca)
            share = 0.0
            if sa >= 0:
                y = mid + (top - mid) * sa ** qt
                # Two folded wings arched over the back, a groove along the spine between them.
                bump = math.exp(-((u - 0.58) / 0.3) ** 2) - 0.5 * math.exp(-(u / 0.25) ** 2)
                share = bump * smooth(0.0, 0.5, sa)
                y += lobe * share
            else:
                y = mid - (mid - bottom) * (-sa) ** qb
            row.append(b.vert((x, y, z), part=part, **look(z, y, sa, u, lobe, share)))
        rings.append(row)
        centres.append((z, mid))
    zf, _, tf, bf, mf, _ = stations[0]
    zl, _, tl, bl, ml, _ = stations[-1]
    front = b.vert((0.0, (tf + bf) / 2, zf + 0.012), part=part, **look(zf, (tf + bf) / 2, 0.0, 0.0, 0.0, 0.0))
    back = b.vert((0.0, (tl + bl) / 2, zl - 0.035), part=part, **look(zl, (tl + bl) / 2, 0.0, 0.0, 0.0, 0.0))
    b.loft(rings, close_start=front, close_end=back)
    ordered = sorted(centres)
    b.orient(first, lambda c: (0.0, interp(ordered, c.z), c.z))
    return rings


def tube(b, spine, samples, ring, look):
    """
    A neck, head and bill in one: `spine` is control points (z, y, half width, half height) in the
    bird's middle plane, `samples` the indices along it where a ring stands, each ring square to
    the spine. `look(f, dorsal, across)` gives a vertex its part, colour, shares and `lift` (m
    pushed out along the ring's own radius: the bill's knob). The last sample is the tip.
    """
    first = b.part()
    rings = []
    centres = []
    for f in samples[:-1]:
        z, y, rx, ry = catmull(spine, f)
        za, ya, _, _ = catmull(spine, max(0.0, f - 0.02))
        zb, yb, _, _ = catmull(spine, min(len(spine) - 1.0, f + 0.02))
        ty, tz = yb - ya, zb - za
        length = math.hypot(ty, tz) or 1.0
        ny, nz = tz / length, -ty / length   # the dorsal side: the nape, the crown, the bill's ridge
        row = []
        for i in range(ring):
            a = 2 * math.pi * i / ring
            ca, sa = math.cos(a), math.sin(a)
            v = look(f, sa, ca)
            lift = v.pop("lift", 0.0)
            r = ry + lift
            row.append(b.vert((rx * ca, y + r * sa * ny, z + r * sa * nz), **v))
        rings.append(row)
        centres.append((z, y))
    z, y, _, _ = catmull(spine, samples[-1])
    v = look(samples[-1], 0.0, 0.0)
    v.pop("lift", None)
    tip = b.vert((0.0, y, z), **v)
    b.loft(rings, close_end=tip)

    def inside(c):
        best = min(centres, key=lambda q: (q[0] - c.z) ** 2 + (q[1] - c.y) ** 2)
        return (0.0, best[1], best[0])

    b.orient(first, inside)
    return rings


# The head and bill along the bill's own line (s) and square to it (h): the crown, the cranium,
# the face, the bill's root, its middle, its fore part and the nail (half width, half height).
HEAD = [
    (0.000, 0.000, 0.041, 0.044),
    (0.044, 0.012, 0.045, 0.047),
    (0.084, 0.008, 0.037, 0.040),
    (0.110, 0.003, 0.031, 0.033),
    (0.148, -0.002, 0.027, 0.017),
    (0.186, -0.006, 0.021, 0.010),
    (0.206, -0.008, 0.010, 0.005),
]


def head_points(z0, y0, pitch_degrees, scale=1.0):
    p = math.radians(pitch_degrees)
    return [(z0 + (s * math.cos(p) - h * math.sin(p)) * scale, y0 + (s * math.sin(p) + h * math.cos(p)) * scale,
             rx * scale, ry * scale) for s, h, rx, ry in HEAD]


def adult_neck_look(crown, neck_weight):
    """A vertex of an adult's neck, head or bill at spine index f (the crown at index `crown`)."""
    def look(f, dorsal, across):
        g = f - crown
        w = neck_weight(f)
        if g < 2.93:
            # White, a little cream toward the head; a black eye and the black skin before it.
            colour = mix(PLUMAGE["white"], PLUMAGE["cream"], smooth(crown - 4.0, crown, f))
            side = abs(across) > 0.9
            brow = abs(across) > 0.6 and dorsal > 0.5
            if (abs(g - 2.0) < 0.05 and side) or (abs(g - 2.6) < 0.05 and (side or brow)):
                colour = PLUMAGE["black"]
            part = "neck" if g < 0 else "head"
            return dict(colour=colour, part=part, neck=w, shade=1.0)
        if g < 3.05:
            # The bill's black root, rising into the knob on the forehead.
            return dict(colour=PLUMAGE["black"], part="bill", neck=w, lift=0.014 if dorsal > 0.9 else 0.0)
        if g > 5.75:
            return dict(colour=PLUMAGE["black"], part="bill", neck=w)
        knob = dorsal > 0.9 and g < 3.3
        colour = PLUMAGE["black"] if knob else PLUMAGE["bill"]
        lift = 0.021 if knob else (0.007 if dorsal > 0.9 and g < 3.7 else 0.0)
        return dict(colour=colour, part="bill", neck=w, lift=lift)
    return look


def head_samples(crown):
    """Where the rings of a head stand, from its crown: close pairs where a colour turns."""
    return [crown + g for g in (0.0, 0.5, 1.0, 1.5, 2.0, 2.6, 2.92, 3.0, 3.1, 3.6, 4.0, 5.0, 5.7, 5.8, 6.0)]


# ── The adult afloat ──────────────────────────────────────────────────────────

# z, half width, top, bottom, widest height, wing lobe (the waterline is y = 0).
AFLOAT_BODY = [
    (0.410, 0.050, 0.118, -0.014, 0.050, 0.000),
    (0.370, 0.112, 0.176, -0.066, 0.050, 0.000),
    (0.290, 0.170, 0.226, -0.098, 0.045, 0.004),
    (0.170, 0.208, 0.256, -0.110, 0.040, 0.026),
    (0.030, 0.228, 0.284, -0.115, 0.040, 0.058),
    (-0.110, 0.228, 0.304, -0.110, 0.045, 0.080),
    (-0.250, 0.200, 0.308, -0.090, 0.060, 0.088),
    (-0.370, 0.150, 0.286, -0.052, 0.090, 0.070),
    (-0.455, 0.096, 0.254, 0.004, 0.130, 0.030),
    (-0.520, 0.058, 0.236, 0.082, 0.165, 0.000),
    (-0.590, 0.034, 0.238, 0.166, 0.204, 0.000),
]
# The tail's tip, past the last station: cocked up a little, as a mute swan carries it.
AFLOAT_TAIL_TIP = (-0.665, 0.224)
# The neck's S, from inside the breast to the crown: z, y, half width, half height.
AFLOAT_NECK = [
    (0.232, 0.128, 0.118, 0.124),
    (0.290, 0.238, 0.090, 0.097),
    (0.328, 0.345, 0.066, 0.072),
    (0.330, 0.450, 0.054, 0.058),
    (0.302, 0.540, 0.047, 0.051),
    (0.275, 0.620, 0.043, 0.046),
    (0.268, 0.695, 0.040, 0.043),
    (0.285, 0.752, 0.039, 0.042),
]
AFLOAT_CROWN = (0.322, 0.786)
AFLOAT_BILL_PITCH = -22.0
# The head and bill are drawn a little large, so they still read at 20 px.
HEAD_SCALE = 1.12
# Where the neck turns when the head dips (y, z), and how far a raised wing vertex goes (x out, y, z).
AFLOAT_NECK_PIVOT = (0.200, 0.270)
WING_RAISE = (0.035, 0.105, -0.025)


def afloat_body_look(z, y, sa, u, lobe, share):
    wing = max(0.0, share) * min(1.0, lobe / 0.08) if sa > 0.2 else 0.0
    colour = mix(PLUMAGE["white"], PLUMAGE["groove"], smooth(0.0, -0.4, share) * min(1.0, lobe / 0.04))
    # The hull darkens toward the water it sits in; the groove between the wings is a little shaded.
    shade = 0.5 + 0.5 * smooth(-0.02, 0.16, y)
    shade *= 1.0 - 0.22 * smooth(0.0, -0.4, share) * min(1.0, lobe / 0.04)
    # The tail's feathers, past the body, are thin too.
    thin = max(0.55 * wing, 0.6 * smooth(-0.5, -0.58, z))
    return dict(colour=colour, thin=thin, wing=wing, shade=shade)


def build_afloat():
    b = Builder()

    def look(z, y, sa, u, lobe, share):
        v = afloat_body_look(z, y, sa, u, lobe, share)
        v["part"] = "wing" if v["wing"] > 0 else "body"
        return v

    # The hull's own part is given per vertex (the folded wings are the part that can lift).
    first = b.part()
    rings = []
    centres = []
    steps, ring = 17, 12
    for k in range(steps):
        z, w, top, bottom, mid, lobe = catmull(AFLOAT_BODY, k * (len(AFLOAT_BODY) - 1) / (steps - 1))
        lobe = max(0.0, lobe)
        row = []
        for i in range(ring):
            a = math.pi / 2 + 2 * math.pi * i / ring
            ca, sa = math.cos(a), math.sin(a)
            u = abs(ca) ** 0.85
            x = w * math.copysign(u, ca)
            share = 0.0
            if sa >= 0:
                y = mid + (top - mid) * sa ** 0.82
                bump = math.exp(-((u - 0.58) / 0.3) ** 2) - 0.5 * math.exp(-(u / 0.25) ** 2)
                share = bump * smooth(0.0, 0.5, sa)
                y += lobe * share
            else:
                y = mid - (mid - bottom) * (-sa) ** 0.7
            row.append(b.vert((x, y, z), **look(z, y, sa, u, lobe, share)))
        rings.append(row)
        centres.append((z, mid))
    zf, _, tf, bf, _, _ = AFLOAT_BODY[0]
    front = b.vert((0.0, (tf + bf) / 2, zf + 0.012), PLUMAGE["white"], "body", shade=0.8)
    back = b.vert((0.0, AFLOAT_TAIL_TIP[1], AFLOAT_TAIL_TIP[0]), PLUMAGE["white"], "body", thin=0.6)
    b.loft(rings, close_start=front, close_end=back)
    ordered = sorted(centres)
    b.orient(first, lambda c: (0.0, interp(ordered, c.z), c.z))

    spine = AFLOAT_NECK + head_points(*AFLOAT_CROWN, AFLOAT_BILL_PITCH, HEAD_SCALE)
    crown = len(AFLOAT_NECK)
    samples = [0.5 * k for k in range(2 * crown)] + head_samples(crown)
    tube(b, spine, samples, 8, adult_neck_look(crown, lambda f: smooth(0.4, crown - 0.5, f)))
    return b


# ── The cygnet ────────────────────────────────────────────────────────────────

CYGNET_BODY = [
    (0.168, 0.032, 0.078, 0.004, 0.035, 0.0),
    (0.130, 0.072, 0.108, -0.032, 0.030, 0.0),
    (0.060, 0.097, 0.132, -0.046, 0.030, 0.0),
    (-0.030, 0.102, 0.142, -0.046, 0.032, 0.0),
    (-0.110, 0.086, 0.128, -0.036, 0.040, 0.0),
    (-0.170, 0.050, 0.102, -0.004, 0.050, 0.0),
]
CYGNET_NECK = [
    (0.100, 0.085, 0.052, 0.052),
    (0.128, 0.140, 0.042, 0.044),
    (0.146, 0.190, 0.037, 0.039),
    (0.160, 0.226, 0.038, 0.040),
]
CYGNET_HEAD = [
    (0.178, 0.246, 0.043, 0.044),
    (0.206, 0.248, 0.040, 0.040),
    (0.232, 0.238, 0.024, 0.022),
    (0.254, 0.229, 0.017, 0.011),
    (0.268, 0.223, 0.008, 0.004),
]
CYGNET_NECK_PIVOT = (0.095, 0.105)


def build_cygnet():
    b = Builder()

    def body_look(z, y, sa, u, lobe, share):
        colour = mix(PLUMAGE["down"], PLUMAGE["downDark"], smooth(0.2, 0.9, sa))
        colour = mix(colour, PLUMAGE["downPale"], smooth(-0.1, -0.7, sa) + smooth(0.08, 0.16, z) * 0.6)
        return dict(colour=colour, thin=0.25 * smooth(0.3, 0.9, sa), shade=0.55 + 0.45 * smooth(-0.01, 0.08, y))

    hull(b, CYGNET_BODY, 8, 8, body_look)

    crown = len(CYGNET_NECK)
    spine = CYGNET_NECK + CYGNET_HEAD

    def look(f, dorsal, across):
        g = f - crown
        w = smooth(0.2, crown - 0.3, f)
        if g < 1.6:
            colour = mix(PLUMAGE["downPale"], PLUMAGE["down"], smooth(-0.3, 0.6, dorsal))
            if abs(g - 0.5) < 0.05 and abs(across) > 0.9:
                colour = PLUMAGE["black"]
            return dict(colour=colour, part="neck" if g < 0 else "head", neck=w, thin=0.2)
        return dict(colour=PLUMAGE["cygnetBill"], part="bill", neck=w)

    samples = [0.0, 1.0, 2.0, 3.0, crown, crown + 0.5, crown + 1.0, crown + 1.55, crown + 1.65, crown + 2.0,
               crown + 3.0, crown + 4.0]
    tube(b, spine, samples, 6, look)
    return b


# ── The adult on the wing ─────────────────────────────────────────────────────

# z, half width, top, bottom, widest height, (no lobes): the body's long axis lies along z at y = 0.
FLYING_BODY = [
    (0.400, 0.062, 0.056, -0.066, 0.000, 0.0),
    (0.340, 0.096, 0.086, -0.096, 0.000, 0.0),
    (0.240, 0.136, 0.116, -0.126, 0.000, 0.0),
    (0.100, 0.160, 0.130, -0.146, 0.000, 0.0),
    (-0.040, 0.160, 0.126, -0.146, 0.000, 0.0),
    (-0.180, 0.140, 0.106, -0.126, 0.000, 0.0),
    (-0.300, 0.106, 0.082, -0.090, 0.000, 0.0),
    (-0.400, 0.074, 0.052, -0.050, 0.004, 0.0),
    (-0.470, 0.066, 0.024, -0.016, 0.008, 0.0),
    (-0.530, 0.046, 0.016, 0.004, 0.011, 0.0),
]
FLYING_NECK = [
    (0.300, 0.000, 0.086, 0.086),
    (0.400, -0.004, 0.068, 0.070),
    (0.500, -0.010, 0.054, 0.056),
    (0.600, -0.016, 0.046, 0.048),
    (0.700, -0.020, 0.041, 0.043),
    (0.780, -0.020, 0.039, 0.042),
]
FLYING_CROWN = (0.840, -0.016)
FLYING_BILL_PITCH = -8.0
# The two hinges, lines along z: the shoulder and the wrist (|x|, y).
SHOULDER = (0.150, 0.050)
WRIST = (0.640, 0.046)
WING_Y = 0.050
# Stations along the span (|x|, m), dense at the hinges so the wing bends smoothly.
STATIONS = [0.085, 0.120, 0.150, 0.180, 0.215, 0.270, 0.360, 0.460, 0.550, 0.600, 0.640, 0.680, 0.730, 0.810,
            0.900, 0.980, 1.050, 1.100, 1.135]
LEADING = [(0.085, 0.270), (0.300, 0.305), (0.550, 0.335), (0.640, 0.338), (0.750, 0.315), (0.950, 0.235),
           (1.060, 0.140), (1.135, 0.030)]
TRAILING = [(0.085, -0.140), (0.300, -0.125), (0.550, -0.095), (0.750, -0.085), (0.950, -0.085),
            (1.060, -0.060), (1.135, -0.020)]
THICKNESS = [(0.085, 0.046), (0.300, 0.036), (0.640, 0.026), (0.950, 0.016), (1.135, 0.008)]
# The wing's very tip (|x|, z).
WING_TIP = (1.158, 0.004)
# Leading edge, two points over the top, the trailing edge, two points back underneath:
# (chord share, side, share of the wing's thickness).
CHORD = [(0.0, 0.0, 0.0), (0.12, 1.0, 0.5), (0.48, 1.0, 0.36), (1.0, 0.0, 0.0), (0.48, -1.0, 0.30), (0.12, -1.0, 0.42)]
# The bands over which a wing vertex passes to a hinge: centre, half width, widening with the
# distance behind the wing's leading edge (the trailing feathers bend over a longer run), most.
ARM_BAND = (SHOULDER[0], 0.045, 0.10, 0.075)
HAND_BAND = (WRIST[0], 0.060, 0.14, 0.110)


def band(spec, s, behind):
    centre, half, widen, most = spec
    h = min(half + widen * max(0.0, behind), most)
    return smooth(centre - h, centre + h, s)


def build_wing(b, side):
    """side = 1 the bird's left (+x), -1 its right."""
    first = b.part()
    rings = []
    for s in STATIONS:
        le = interp(LEADING, s)
        te = interp(TRAILING, s)
        chord = le - te
        thick = interp(THICKNESS, s)
        ring = []
        for share, face, thickness in CHORD:
            z = le - share * chord
            camber = 0.03 * chord * 4 * share * (1 - share)
            y = WING_Y + camber + face * thickness * thick
            behind = le - z
            # The flight feathers (the back of the wing, and all of the hand) let the low sun through.
            thin = smooth(0.2, 0.7, share) * (0.55 + 0.45 * smooth(0.45, 0.75, s))
            colour = mix(PLUMAGE["white"], PLUMAGE["groove"], 0.5 * smooth(0.5, 1.0, share) * (face < 0))
            ring.append(b.vert((side * s, y, z), colour, "wing", thin=thin,
                               wing=band(ARM_BAND, s, behind), hand=band(HAND_BAND, s, behind),
                               shade=0.9 if face < 0 else 1.0))
        rings.append(ring)
    tip = b.vert((side * WING_TIP[0], WING_Y, WING_TIP[1]), PLUMAGE["white"], "wing", thin=1.0, wing=1.0, hand=1.0)
    b.loft(rings, close_end=tip)
    b.orient(first, lambda c: (c.x, WING_Y + 0.006, (interp(LEADING, abs(c.x)) + interp(TRAILING, abs(c.x))) / 2))


def build_foot(b, side):
    """A black foot trailing under the tail: the shank, then the folded web."""
    first = b.part()
    rows = [(-0.200, -0.100, 0.014, 0.012), (-0.320, -0.084, 0.013, 0.011), (-0.420, -0.062, 0.026, 0.008),
            (-0.500, -0.044, 0.030, 0.006)]
    rings = []
    for z, y, rx, ry in rows:
        rings.append([b.vert((side * 0.062 + rx * ca, y + ry * sa, z), PLUMAGE["leg"], "feet")
                      for ca, sa in ((1, 0), (0, 1), (-1, 0), (0, -1))])
    root = b.vert((side * 0.062, -0.100, -0.180), PLUMAGE["leg"], "feet")
    tip = b.vert((side * 0.062, -0.040, -0.530), PLUMAGE["leg"], "feet")
    b.loft(rings, close_start=root, close_end=tip)
    b.orient(first, lambda c: (side * 0.062, interp([(-0.5, -0.044), (-0.2, -0.1)], c.z), c.z))


def build_flying():
    b = Builder()

    def body_look(z, y, sa, u, lobe, share):
        return dict(colour=PLUMAGE["white"], thin=0.5 * smooth(-0.42, -0.5, z), shade=0.86 + 0.14 * smooth(-0.5, 0.3, sa))

    hull(b, FLYING_BODY, 10, 12, body_look, qb=0.82)
    spine = FLYING_NECK + head_points(*FLYING_CROWN, FLYING_BILL_PITCH, HEAD_SCALE)
    crown = len(FLYING_NECK)
    samples = [float(k) for k in range(crown)] + head_samples(crown)
    tube(b, spine, samples, 8, adult_neck_look(crown, lambda f: 0.0))
    build_wing(b, 1)
    build_wing(b, -1)
    build_foot(b, 1)
    build_foot(b, -1)
    return b


# ── The vertex stage's twins ──────────────────────────────────────────────────

def _turn(a, b, angle):
    c, s = math.cos(angle), math.sin(angle)
    return a * c - b * s, a * s + b * c


def pose_afloat(p, rig, pivot, lift=0.0, dip=0.0):
    """An afloat vertex with its wings raised by `lift` (0..1) and its head dipped `dip` radians."""
    x, y, z = p
    wing, _, neck, _ = rig
    side = 1.0 if x >= 0 else -1.0
    x += side * WING_RAISE[0] * wing * lift
    y += WING_RAISE[1] * wing * lift
    z += WING_RAISE[2] * wing * lift
    # The neck turns forward and down about its root: +dip takes the head toward the water.
    dz, dy = _turn(z - pivot[1], y - pivot[0], -dip * neck)
    return (x, pivot[0] + dy, pivot[1] + dz)


def pose_flying(p, rig, arm=0.0, hand=0.0):
    """A flying vertex with the wing turned `arm` radians at the shoulder and `hand` at the wrist (+ up)."""
    x, y, z = p
    wing, outer, _, _ = rig
    side = 1.0 if x >= 0 else -1.0
    du, dy = _turn(abs(x) - WRIST[0], y - WRIST[1], hand * outer)
    du, dy = _turn(du + WRIST[0] - SHOULDER[0], dy + WRIST[1] - SHOULDER[1], arm * wing)
    return (side * (du + SHOULDER[0]), dy + SHOULDER[1], z)


# ── Blender: join, triangulate, normals ───────────────────────────────────────

def to_b(p):
    """Game frame → Blender (Z up, the bird faces -Y, its left wing on +X)."""
    return (p[0], -p[2], p[1])


def to_g(p):
    return (p[0], p[2], -p[1])


def make_mesh(name, built, verts=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_b(v) for v in (verts or built.verts)], [], [tuple(f) for f in built.faces])
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(mesh)
    bm.free()
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()
    col = mesh.color_attributes.new("plumage", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(built.colours):
        col.data[i].color = (c[0], c[1], c[2], 1.0)
    mesh.color_attributes.active_color = col
    if len(mesh.vertices) != len(built.verts):
        raise RuntimeError(f"{TAG} {name}: Blender changed the vertex count")
    return mesh


def read_mesh(mesh):
    """Triangles and smooth vertex normals as Blender made them (game frame)."""
    triangles = []
    for poly in mesh.polygons:
        if len(poly.vertices) != 3:
            raise RuntimeError(f"{TAG} a face of {mesh.name} is not a triangle")
        triangles.append(tuple(poly.vertices))
    normals = []
    for i in range(len(mesh.vertices)):
        n = Vector(to_g(tuple(mesh.vertex_normals[i].vector)))
        if not math.isfinite(n.length) or n.length < 1e-6:
            n = Vector((0.0, 1.0, 0.0))
        normals.append(tuple(n.normalized()))
    return triangles, normals


# ── The module the theme imports ──────────────────────────────────────────────

QUANT = 2e-4  # metres per unit of the stored positions


def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def byte(x):
    return int(round(max(0.0, min(1.0, x)) * 255))


def shape_lines(key, built, triangles, normals, extra):
    xs = [v[0] for v in built.verts]
    ys = [v[1] for v in built.verts]
    zs = [v[2] for v in built.verts]
    positions = [int(round(c / QUANT)) for v in built.verts for c in v]
    if max(abs(p) for p in positions) > 32767:
        raise RuntimeError(f"{TAG} {key} does not fit the stored positions")
    lines = [
        f"        {key}: Object.freeze({{",
        f"            vertexCount: {len(built.verts)},",
        f"            triangleCount: {len(triangles)},",
        f"            length: {round(max(zs) - min(zs), 4)},",
        f"            span: {round(max(xs) - min(xs), 4)},",
        f"            height: {round(max(ys), 4)},",
    ]
    lines += [f"            {name}: {json.dumps(value)}," for name, value in extra.items()]
    lines += [
        f"            positions: '{b64('h', positions)}',",
        f"            normals: '{b64('b', [int(round(c * 127)) for n in normals for c in n])}',",
        f"            colours: '{b64('B', [byte(x) for c in built.colours for x in c])}',",
        f"            rig: '{b64('B', [byte(x) for r in built.rig for x in r])}',",
        f"            parts: '{b64('B', built.parts)}',",
        f"            index: '{b64('H', [i for t in triangles for i in t])}',",
        "        }),",
    ]
    return lines


def stored(built, i):
    """Vertex i and its shares as the module stores them (so the checks hold to the last bit)."""
    return tuple(round(c / QUANT) * QUANT for c in built.verts[i]), tuple(byte(x) / 255 for x in built.rig[i])


def checks(shapes):
    """A few telling vertices as the twins pose them: a wingtip, a wrist, the bill's tip, a wing lobe."""
    out = []

    def nearest(built, target, where=lambda i: True):
        return min((i for i in range(len(built.verts)) if where(i)),
                   key=lambda i: sum((built.verts[i][k] - target[k]) ** 2 for k in range(3)))

    flying = shapes["flying"]
    for target in ((WING_TIP[0], WING_Y, WING_TIP[1]), (-WING_TIP[0], WING_Y, WING_TIP[1]), (0.64, 0.05, -0.1),
                   (0.2, 0.05, -0.14), (0.0, -0.03, 1.07)):
        i = nearest(flying, target)
        for arm, hand in ((0.6, 0.3), (-0.45, -0.25)):
            p, r = stored(flying, i)
            out.append({"shape": "flying", "vertex": i, "arm": arm, "hand": hand,
                        "at": [round(c, 5) for c in pose_flying(p, r, arm, hand)]})
    afloat = shapes["afloat"]
    lobe = max(range(len(afloat.verts)), key=lambda i: afloat.rig[i][0])
    for i in (nearest(afloat, (0.0, 0.70, 0.52)), nearest(afloat, (0.04, 0.62, 0.275)), lobe):
        for lift, dip in ((1.0, 0.0), (0.4, 1.3)):
            p, r = stored(afloat, i)
            out.append({"shape": "afloat", "vertex": i, "lift": lift, "dip": dip,
                        "at": [round(c, 5) for c in pose_afloat(p, r, AFLOAT_NECK_PIVOT, lift, dip)]})
    cygnet = shapes["cygnet"]
    i = nearest(cygnet, (0.0, 0.223, 0.268))
    p, r = stored(cygnet, i)
    out.append({"shape": "cygnet", "vertex": i, "lift": 0.0, "dip": 1.1,
                "at": [round(c, 5) for c in pose_afloat(p, r, CYGNET_NECK_PIVOT, 0.0, 1.1)]})
    return out


def write_module(path, shapes, meshes):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Summer's swans: GENERATED by scripts/blender/summer_swan.py (do not edit by hand).",
        " *",
        " * Three shapes of the lake's mute swans, modelled in Blender: `afloat` (an adult on the",
        " * water, cut a hand under the waterline at y = 0), `cygnet` (a grey young one) and `flying`",
        " * (the adult on the wing, wings spread flat). Game frame: x the bird's left, y up, z",
        " * forward; metres, real size. Per shape: `positions` Int16 in units of `quant` metres,",
        " * `normals` Int8 (/ 127), `colours` Uint8 (linear r, g, b and `thin`: how much low sun a",
        " * feather lets through; / 255), `rig` Uint8 (wing, hand, neck, shade; / 255: how much of a",
        " * wing-raise or of the shoulder's turn, of the wrist's turn and of a head-dip a vertex",
        " * takes, and how open it is to the sky), `parts` Uint8 (an index into `parts`), `index`",
        " * Uint16 triangles. `shoulder` and `wrist` are the flying wing's hinges (|x|, y), `neck` an",
        " * afloat shape's neck root (y, z), `raise` how far a raised wing vertex goes (x out, y, z).",
        " * `checks` are vertices as the script's own twins of the vertex stage pose them (the tests).",
        " */",
        "export const SUMMER_SWAN = Object.freeze({",
        f"    quant: {QUANT},",
        f"    parts: {json.dumps(PARTS)},",
        f"    shoulder: {json.dumps(list(SHOULDER))},",
        f"    wrist: {json.dumps(list(WRIST))},",
        f"    raise: {json.dumps(list(WING_RAISE))},",
        "    shapes: Object.freeze({",
    ]
    extras = {
        "afloat": {"neck": list(AFLOAT_NECK_PIVOT)},
        "cygnet": {"neck": list(CYGNET_NECK_PIVOT)},
        "flying": {},
    }
    for key in ("afloat", "cygnet", "flying"):
        triangles, normals = read_mesh(meshes[key])
        lines += shape_lines(key, shapes[key], triangles, normals, extras[key])
    lines += [
        "    }),",
        f"    checks: {json.dumps(checks(shapes), separators=(',', ':'))},",
        "});",
        "",
    ]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    for key in ("afloat", "cygnet", "flying"):
        print(f"{TAG} {key}: {len(shapes[key].verts)} vertices, {len(meshes[key].polygons)} triangles")
    print(f"{TAG} wrote {path}")


# ── Previews (Workbench, orthographic lineups) ────────────────────────────────

def previews(scene, shapes, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    afloat, cygnet, flying = shapes["afloat"], shapes["cygnet"], shapes["flying"]

    def posed(built, fn):
        return [fn(p, r) for p, r in zip(built.verts, built.rig)]

    lineups = {
        "afloat": [
            ("rest", afloat, None),
            ("raised", afloat, posed(afloat, lambda p, r: pose_afloat(p, r, AFLOAT_NECK_PIVOT, 1.0, 0.0))),
            ("dip half", afloat, posed(afloat, lambda p, r: pose_afloat(p, r, AFLOAT_NECK_PIVOT, 0.0, 0.9))),
            ("dip", afloat, posed(afloat, lambda p, r: pose_afloat(p, r, AFLOAT_NECK_PIVOT, 0.0, 1.9))),
            ("cygnet", cygnet, None),
            ("cygnet dip", cygnet, posed(cygnet, lambda p, r: pose_afloat(p, r, CYGNET_NECK_PIVOT, 0.0, 1.3))),
        ],
        "flying": [
            ("flat", flying, None),
            ("top", flying, posed(flying, lambda p, r: pose_flying(p, r, 0.66, -0.25))),
            ("down", flying, posed(flying, lambda p, r: pose_flying(p, r, 0.1, 0.35))),
            ("bottom", flying, posed(flying, lambda p, r: pose_flying(p, r, -0.45, 0.1))),
            ("up", flying, posed(flying, lambda p, r: pose_flying(p, r, 0.1, -0.45))),
        ],
    }
    for obj in scene.collection.objects:
        obj.hide_render = True
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_object_outline = False
    shading.show_cavity = True
    world = bpy.data.worlds.new("SummerSwanWorld")
    scene.world = world
    world.color = (0.10, 0.16, 0.24)
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    cam_data = bpy.data.cameras.new("SummerSwanPreviewCam")
    cam = bpy.data.objects.new("SummerSwanPreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = "ORTHO"
    files = []
    views = {
        # name: the camera's direction (Blender frame), its up, the lineup's axis
        "side": (Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))),
        "front": (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))),
        "top": (Vector((0, 0, -1)), Vector((0, -1, 0)), Vector((1, 0, 0))),
        "quarter": (Vector((-0.74, 0.56, -0.37)).normalized(), Vector((0, 0, 1)), Vector((0.6, 0.8, 0)).normalized()),
    }
    for name, row in lineups.items():
        gap = 1.5 if name == "afloat" else 2.7
        for view, (direction, up, axis) in views.items():
            objects = []
            spacing = gap if not (name == "afloat" and view == "front") else 0.9
            if name == "flying" and view == "side":
                spacing = 1.9
            for k, (label, built, verts) in enumerate(row):
                obj = bpy.data.objects.new(f"pv {name} {label}", make_mesh(f"pv {name} {label}", built, verts))
                obj.location = axis * (k - (len(row) - 1) / 2) * spacing
                scene.collection.objects.link(obj)
                objects.append(obj)
            right = direction.cross(up).normalized()
            true_up = right.cross(direction).normalized()
            cam.rotation_mode = "QUATERNION"
            cam.rotation_quaternion = Matrix((right, true_up, -direction)).transposed().to_quaternion()
            cam.location = -direction * 12.0 + Vector((0, 0, 0.3 if name == "afloat" else 0.0))
            cam_data.ortho_scale = spacing * len(row) * 1.05
            scene.render.resolution_x = 1800
            scene.render.resolution_y = 520 if name == "afloat" or view == "side" else 760
            scene.render.resolution_percentage = 100
            path = out / f"swan-{name}-{view}.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True, scene=scene.name)
            files.append(str(path))
            for obj in objects:
                mesh = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                bpy.data.meshes.remove(mesh)
    return files


# ── Entry point ───────────────────────────────────────────────────────────────

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
    shapes = {"afloat": build_afloat(), "cygnet": build_cygnet(), "flying": build_flying()}
    meshes = {key: make_mesh(f"SummerSwan {key}", built) for key, built in shapes.items()}
    for key, mesh in meshes.items():
        scene.collection.objects.link(bpy.data.objects.new(f"SummerSwan {key}", mesh))
    if out:
        path = Path(out)
        write_module(path if path.suffix == ".js" else path / MODULE, shapes, meshes)
    if preview_dir:
        for file in previews(scene, shapes, preview_dir):
            print(f"{TAG} preview {file}")


if __name__ == "__main__":
    main()
