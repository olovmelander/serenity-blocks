"""Grainfields' geese: a Taiga bean goose (Anser fabalis fabalis), authored procedurally.

Lapporten's Sami name, Cuonjavaggi, is the goose valley, and the bean goose is the goose of both
of the theme's worlds: it breeds in the birch and bog country under the Lapland gate and rests in
its thousands on the Hokkaido stubble on its way south. A dark goose for its size: a long dark
brown neck and head, a long black bill with an orange band, grey-brown upperparts scaled with
pale fringes, a paler breast, a white vent and a white band over a dark, white-tipped tail; the
wings long and broad, the flight feathers blackish, the underwing dark.

Built as plain lists in the bird's frame (metres, real size: 0.80 m long, 1.60 m span; x to the
bird's LEFT, y up, z forward, the shoulders near the origin), so the same module is used by the
headless asset build (grainfields_assets.py --only goose), by the live Blender session the model
was designed in (`show()` builds a posed lineup in a scene of its own) and by its previews.

There is no skeleton. The wings are folded in the theme's vertex stage (grainfields-geese.js)
about two hinges, the shoulder and the wrist, whose pivots and authored poses go into the asset
manifest; each vertex carries in `_WING` how much each hinge moves it (arm, hand, tip: 0..1,
eased across a band at each joint so the skin bends instead of creasing) and, in its fourth
channel, how far it belongs to the head (which holds still while the body heaves with the
wingbeat). `fold()` below is the deformation, line for line the shader's.

Vertex colours are scene-linear plumage; alpha marks thin feather (1) against body (0), which
the theme lets the low sun shine through. Deterministic: the same script writes the same file.
"""

import math

import numpy as np

TAG = "[grainfields-goose]"
FILE = "grainfields-goose.glb"


# -- plumage (sRGB hex -> linear) -----------------------------------------------------------------


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PLUMAGE = {
    "head": lin("#3e3229"),          # the dark chocolate head
    "neck": lin("#4a3c32"),
    "throat": lin("#56473b"),
    "bill": lin("#1f1c1b"),          # black at the base and the nail
    "band": lin("#e08530"),          # the orange band across the bill
    "breast": lin("#7b6a5a"),
    "belly": lin("#8d7e6d"),
    "flank": lin("#6c5a4b"),         # barred darker along the sides
    "fringe": lin("#93826f"),        # the pale fringes that scale the upperparts
    "mantle": lin("#5e4f44"),
    "rump": lin("#463b33"),
    "white": lin("#efebe5"),         # the vent, the undertail and the band over the tail
    "tail": lin("#4a423c"),
    "tailTip": lin("#e4dfd7"),
    "coverts": lin("#6d6054"),       # the upperwing coverts, grey-brown
    "greater": lin("#7a6c5e"),
    "flight": lin("#342e2a"),        # the blackish flight feathers
    "primaries": lin("#2f2a27"),
    "under": lin("#4a423c"),         # the dark underwing coverts
    "underFlight": lin("#5d5751"),   # the flight feathers from below, a little paler
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


def fringes(u, period, width=0.28):
    """0..1 bands across a run of feathers: 1 on each feather's pale edge."""
    f = (u / period) % 1.0
    return smooth(1.0 - width, 1.0 - width * 0.35, f) * (1.0 - smooth(0.97, 1.0, f))


# -- the rig: two hinges per wing (left wing, +x; the right mirrors it) ------------------------------

SPAN = 1.60
LENGTH = 0.80
SHOULDER = (0.072, 0.036, 0.050)
WRIST = (0.372, 0.036, 0.118)
# The bands over which each hinge takes hold (|x|, m), eased from 0 to 1 across them: at the
# leading edge, and (the _TE bands) at the trailing edge, where the skin lies far from the joint and
# moves the most, so it bends over a longer run there instead of tearing (the inner secondaries
# follow the folding hand part of the way, as a real wing's do).
ARM_BAND = (0.064, 0.200)
ARM_BAND_TE = (0.064, 0.250)
HAND_BAND = (0.345, 0.398)
HAND_BAND_TE = (0.285, 0.445)
TIP_BAND = (0.600, 0.790)
# The head's share of the body (it holds still while the body heaves): along z, m.
HEAD_BAND = (0.170, 0.330)


def _band(le, te, x):
    return (le[0] + (te[0] - le[0]) * x, le[1] + (te[1] - le[1]) * x)


def wing_weights(ax, x=0.0):
    """Hinge weights at |x| = ax along the span, x the chord fraction (0 leading edge, 1 trailing)."""
    x = max(0.0, min(1.0, x))
    return (smooth(*_band(ARM_BAND, ARM_BAND_TE, x), ax), smooth(*_band(HAND_BAND, HAND_BAND_TE, x), ax),
            smooth(*TIP_BAND, ax))


# -- the mesh, built as plain lists in the bird's frame -------------------------------------------


class Builder:
    def __init__(self):
        self.verts = []
        self.tris = []
        self.wings = []     # per vertex: (arm, hand, tip, head)
        self.colours = []   # per vertex: (r, g, b, thin)
        self.shells = []    # (first vertex, end vertex, first tri, end tri) per closed part

    def begin(self):
        self._shell = (len(self.verts), len(self.tris))

    def end(self):
        v0, t0 = self._shell
        self.shells.append((v0, len(self.verts), t0, len(self.tris)))

    def vert(self, p, colour, thin=0.0, wing=(0.0, 0.0, 0.0), head=0.0):
        self.verts.append(tuple(float(v) for v in p))
        self.wings.append((wing[0], wing[1], wing[2], head))
        self.colours.append((colour[0], colour[1], colour[2], thin))
        return len(self.verts) - 1

    def quad(self, a, b, c, d):
        self.tris.append((a, b, c))
        self.tris.append((a, c, d))

    def loft(self, rings, close_start=None, close_end=None, closed=True):
        """Join rings of equal length into a tube; close_*: a vertex to fan an end to."""
        n = len(rings[0])
        span = n if closed else n - 1
        for a, b in zip(rings, rings[1:]):
            for i in range(span):
                j = (i + 1) % n
                self.quad(a[i], a[j], b[j], b[i])
        if close_start is not None:
            r = rings[0]
            for i in range(span):
                self.tris.append((close_start, r[(i + 1) % n], r[i]))
        if close_end is not None:
            r = rings[-1]
            for i in range(span):
                self.tris.append((close_end, r[i], r[(i + 1) % n]))


def head_share(z):
    return smooth(*HEAD_BAND, z)


def ring(cx, cy, z, wx, top, bottom, count, colour_of, power=0.9, **kwargs):
    """An egg-shaped ring: half width wx, top over and bottom under the centre height cy."""
    out = []
    for i in range(count):
        a = 2 * math.pi * i / count
        ca, sa = math.cos(a), math.sin(a)
        x = cx + wx * math.copysign(abs(ca) ** power, ca)
        y = cy + (top if sa > 0 else bottom) * math.copysign(abs(sa) ** power, sa)
        out.append((x, y, z, ca, sa))
    return out


# Body: a heavy spindle from the tail's base to the breast.
# z, half width, top, bottom, centre height
BODY = [
    (-0.262, 0.027, 0.018, 0.018, 0.012),
    (-0.236, 0.044, 0.030, 0.032, 0.009),
    (-0.196, 0.064, 0.042, 0.051, 0.004),
    (-0.135, 0.085, 0.053, 0.074, -0.003),
    (-0.065, 0.099, 0.062, 0.092, -0.007),
    (0.005, 0.103, 0.066, 0.098, -0.009),
    (0.070, 0.093, 0.065, 0.097, -0.007),
    (0.118, 0.071, 0.056, 0.079, -0.003),
    (0.150, 0.050, 0.046, 0.057, 0.000),
    (0.168, 0.038, 0.039, 0.045, 0.001),
]
BODY_RING = 18


def body_colour(z, ca, sa):
    """sa: -1 belly .. 1 back; ca: across (the flanks are where |ca| is large)."""
    up = sa
    # Underneath: the breast pale brown, the belly paler, the vent and undertail white.
    under = mix(PLUMAGE["breast"], PLUMAGE["belly"], smooth(0.08, -0.05, z))
    under = mix(under, PLUMAGE["white"], smooth(-0.10, -0.17, z) * smooth(0.0, -0.45, up))
    # The flanks barred darker; the back scaled with pale fringes.
    flank = mix(PLUMAGE["flank"], PLUMAGE["fringe"], 0.55 * fringes(-z, 0.034))
    back = mix(PLUMAGE["mantle"], PLUMAGE["fringe"], 0.4 * fringes(-z, 0.03, 0.22))
    back = mix(back, PLUMAGE["rump"], smooth(-0.13, -0.19, z))
    # The white band over the tail (the uppertail coverts) across the rump's end.
    back = mix(back, PLUMAGE["white"], smooth(-0.200, -0.214, z) * smooth(-0.262, -0.250, z) * 0.95)
    side = mix(under, flank, smooth(-0.55, -0.05, up) * smooth(0.12, 0.04, z) * smooth(-0.21, -0.12, z))
    col = mix(side, back, smooth(0.05, 0.45, up))
    # The breast's front runs into the dark neck.
    return mix(col, PLUMAGE["neck"], smooth(0.12, 0.165, z))


def build_body(b):
    b.begin()
    rings = []
    for z, wx, top, bottom, cy in BODY:
        r = []
        for x, y, zz, ca, sa in ring(0.0, cy, z, wx, top, bottom, BODY_RING, None):
            r.append(b.vert((x, y, zz), body_colour(z, ca, sa), 0.0, head=head_share(z)))
        rings.append(r)
    rump = b.vert((0, BODY[0][4], BODY[0][0] - 0.006), PLUMAGE["white"], 0.0)
    front = b.vert((0, BODY[-1][4], BODY[-1][0] + 0.004), PLUMAGE["neck"], 0.0, head=head_share(0.17))
    b.loft(rings, close_start=rump, close_end=front)
    b.end()


# The neck and head, one tube: the neck long and straight, held a little low; a rounded head
# with a sloping forehead running into the long bill.
# z, half width, top, bottom, centre height
NECK = [
    (0.120, 0.045, 0.047, 0.056, 0.000),
    (0.165, 0.037, 0.040, 0.046, 0.000),
    (0.215, 0.029, 0.032, 0.036, -0.002),
    (0.265, 0.0255, 0.029, 0.031, -0.004),
    (0.312, 0.0245, 0.029, 0.029, -0.006),
    (0.345, 0.0262, 0.032, 0.028, -0.006),
    (0.372, 0.0290, 0.037, 0.026, -0.005),
    (0.397, 0.0280, 0.036, 0.024, -0.006),
    (0.418, 0.0222, 0.028, 0.020, -0.008),
    (0.432, 0.0160, 0.018, 0.016, -0.010),
]
NECK_RING = 14


def neck_colour(z, sa):
    col = mix(PLUMAGE["neck"], PLUMAGE["head"], smooth(0.30, 0.36, z))
    return mix(col, PLUMAGE["throat"], smooth(-0.2, -0.8, sa) * smooth(0.15, 0.22, z) * smooth(0.34, 0.28, z) * 0.6)


def build_neck(b):
    b.begin()
    rings = []
    for z, wx, top, bottom, cy in NECK:
        r = []
        for x, y, zz, ca, sa in ring(0.0, cy, z, wx, top, bottom, NECK_RING, None, power=0.95):
            r.append(b.vert((x, y, zz), neck_colour(z, sa), 0.0, head=head_share(z)))
        rings.append(r)
    back = b.vert((0, NECK[0][4], NECK[0][0] - 0.004), PLUMAGE["neck"], 0.0, head=head_share(0.12))
    face = b.vert((0, NECK[-1][4], NECK[-1][0] + 0.003), PLUMAGE["head"], 0.0, head=1.0)
    b.loft(rings, close_start=back, close_end=face)
    b.end()


# The bill: deep at the base, long, flattened toward the tip; the nail hooks a little.
# z, half width, top, bottom, centre height
BILL = [
    (0.424, 0.0138, 0.0128, 0.0108, -0.0105),
    (0.442, 0.0118, 0.0102, 0.0090, -0.0122),
    (0.460, 0.0104, 0.0080, 0.0076, -0.0136),
    (0.476, 0.0094, 0.0064, 0.0064, -0.0146),
    (0.488, 0.0078, 0.0054, 0.0052, -0.0152),
    (0.496, 0.0050, 0.0044, 0.0036, -0.0160),
]
BILL_RING = 10


def bill_colour(z):
    band = smooth(0.446, 0.452, z) * smooth(0.486, 0.480, z)
    return mix(PLUMAGE["bill"], PLUMAGE["band"], band)


def build_bill(b):
    b.begin()
    rings = []
    for z, wx, top, bottom, cy in BILL:
        r = []
        for x, y, zz, ca, sa in ring(0.0, cy, z, wx, top, bottom, BILL_RING, None, power=0.8):
            r.append(b.vert((x, y, zz), bill_colour(z), 0.0, head=1.0))
        rings.append(r)
    base = b.vert((0, BILL[0][4], BILL[0][0] - 0.004), PLUMAGE["bill"], 0.0, head=1.0)
    tip = b.vert((0, -0.0168, 0.501), PLUMAGE["bill"], 0.0, head=1.0)
    b.loft(rings, close_start=base, close_end=tip)
    b.end()


# The tail: a short rounded fan, dark with a white tip; white beneath at its base.
# z, half width, centre height, half thickness
TAIL = [
    (-0.205, 0.040, 0.012, 0.016),
    (-0.240, 0.054, 0.012, 0.011),
    (-0.272, 0.064, 0.011, 0.008),
    (-0.298, 0.068, 0.010, 0.006),
    (-0.318, 0.062, 0.009, 0.005),
    (-0.332, 0.044, 0.009, 0.004),
]
TAIL_RING = 14


def tail_colour(z, sa):
    top = mix(PLUMAGE["tail"], PLUMAGE["tailTip"], smooth(-0.312, -0.322, z))
    top = mix(top, PLUMAGE["white"], smooth(-0.236, -0.222, z))
    bottom = mix(PLUMAGE["white"], PLUMAGE["tail"], smooth(-0.255, -0.285, z))
    bottom = mix(bottom, PLUMAGE["tailTip"], smooth(-0.312, -0.322, z))
    return mix(bottom, top, smooth(-0.3, 0.3, sa))


def build_tail(b):
    b.begin()
    rings = []
    for k, (z, wx, cy, thick) in enumerate(TAIL):
        thin = smooth(1.0, 4.0, k) * 0.6
        r = []
        for i in range(TAIL_RING):
            a = 2 * math.pi * i / TAIL_RING
            ca, sa = math.cos(a), math.sin(a)
            x = wx * math.copysign(abs(ca) ** 0.55, ca)
            y = cy + thick * sa
            r.append(b.vert((x, y, z), tail_colour(z, sa), thin))
        rings.append(r)
    root = b.vert((0, TAIL[0][2], TAIL[0][0] + 0.01), PLUMAGE["white"], 0.0)
    end = b.vert((0, TAIL[-1][2], TAIL[-1][0] - 0.003), PLUMAGE["tailTip"], 0.6)
    b.loft(rings, close_start=root, close_end=end)
    b.end()


# -- the wings: long and broad, the hand tapering to a rounded point ------------------------------

# Stations along the span (|x|, m), dense at the hinges so the skin bends smoothly.
STATIONS = [0.060, 0.078, 0.096, 0.115, 0.135, 0.170, 0.215, 0.265, 0.310, 0.345, 0.372, 0.398,
            0.440, 0.490, 0.540, 0.590, 0.635, 0.675, 0.710, 0.740, 0.764, 0.782, 0.794, 0.800]
# Leading and trailing edges (z, m) along the span: the wrist (carpal) is the forward-most point,
# the hand's leading edge sweeps back to the tip; the trailing edge runs almost straight.
LEADING = [(0.060, 0.106), (0.200, 0.116), (0.372, 0.136), (0.440, 0.129), (0.540, 0.100),
           (0.640, 0.056), (0.720, 0.008), (0.770, -0.030), (0.790, -0.054), (0.800, -0.080)]
TRAILING = [(0.060, -0.205), (0.200, -0.196), (0.330, -0.178), (0.372, -0.170), (0.440, -0.158),
            (0.540, -0.147), (0.640, -0.140), (0.720, -0.132), (0.770, -0.122), (0.790, -0.112),
            (0.800, -0.098)]
THICKNESS = [(0.060, 0.15), (0.200, 0.11), (0.372, 0.08), (0.540, 0.055), (0.800, 0.03)]
# Chord fractions (leading edge 0 -> trailing edge 1).
CHORD = [0.0, 0.02, 0.07, 0.15, 0.27, 0.41, 0.56, 0.71, 0.85, 1.0]


def wing_centre(s):
    return 0.036 - 0.006 * (s / SPAN * 2)


def airfoil(c, t, x):
    """Camber line and half-thicknesses over and under it, as metres along a chord c."""
    camber = 0.05 * 4 * x * (1 - x)
    yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    yt *= 1 - smooth(0.45, 1.0, x) * 0.85  # the feathered back half is thin
    return camber * c, yt * c, yt * c * 0.45


def wing_colour(s, x, upper):
    """s: |x| along the span; x: chord fraction 0 leading edge .. 1 trailing edge."""
    hand = smooth(0.36, 0.40, s)
    if upper:
        # Coverts over the front of the wing, scaled with pale fringes in rows; the greater
        # coverts' pale edge; the blackish flight feathers behind.
        coverts = mix(PLUMAGE["coverts"], PLUMAGE["fringe"], 0.35 * fringes(x, 0.13, 0.3) * (1 - hand))
        coverts = mix(coverts, PLUMAGE["greater"], smooth(0.36, 0.44, x) * smooth(0.56, 0.48, x) * (1 - hand))
        flight = mix(PLUMAGE["flight"], PLUMAGE["primaries"], hand)
        reach = 0.53 + (0.40 - 0.53) * hand
        col = mix(coverts, flight, smooth(reach, reach + 0.08, x))
        # The hand's coverts are greyer and shorter; the outer hand is all flight feather.
        return mix(col, PLUMAGE["primaries"], smooth(0.60, 0.72, s) * smooth(0.0, 0.2, x) * 0.6)
    under = mix(PLUMAGE["under"], PLUMAGE["underFlight"], smooth(0.40, 0.55, x))
    return mix(under, PLUMAGE["underFlight"], smooth(0.55, 0.70, s) * 0.7)


def build_wing(b, side):
    """side = 1 left (+x), -1 right."""
    b.begin()
    rings = []
    order = [(x, True) for x in CHORD] + [(x, False) for x in reversed(CHORD[1:])]
    # Upper surface LE -> TE, then the lower surface TE -> LE: the trailing edge is split (a
    # sharp edge), the leading edge is shared (round).
    for s in STATIONS:
        le = interp(LEADING, s)
        te = interp(TRAILING, s)
        c = le - te
        cy = wing_centre(s)
        t = interp(THICKNESS, s)
        r = []
        for x, upper in order:
            camber, up, down = airfoil(c, t, x)
            y = cy + camber + (up if upper else -down)
            z = le - x * c
            thin = smooth(0.35, 0.75, x) * (0.5 + 0.5 * smooth(0.25, 0.55, s))
            r.append(b.vert((side * s, y, z), wing_colour(s, x, upper), thin, wing_weights(s, x)))
        rings.append(r)
    root = b.vert((side * STATIONS[0], wing_centre(0), -0.04), PLUMAGE["under"], 0.0, wing_weights(0.0))
    tip = b.vert((side * (STATIONS[-1] + 0.002), wing_centre(0.8), -0.090), PLUMAGE["primaries"], 0.6,
                 wing_weights(0.803))
    b.loft(rings, close_start=root, close_end=tip)
    b.end()


def build():
    b = Builder()
    build_body(b)
    build_neck(b)
    build_bill(b)
    build_tail(b)
    for side in (1, -1):
        build_wing(b, side)
    return b


# -- the fold: the theme's vertex stage, in Python (for the previews and the tests) ---------------


def _rot(a, b, ang):
    c, s = math.cos(ang), math.sin(ang)
    return a * c - b * s, a * s + b * c


def fold(p, w, pose):
    """p: rest position (bird frame); w: (arm, hand, tip[, head]); pose: hinge angles (rad).

    lift:  the arm's elevation about the body's long axis (+ raises the wingtip)
    sweep: the arm swung back about the vertical (+ the tip goes back)
    bend:  the hand's elevation about the wrist, relative to the arm
    fold:  the hand swung back about the wrist (the upstroke's flexed wrist)
    curl:  the wingtip bent up under load (+), carried by the tip weight
    """
    side = 1.0 if p[0] >= 0 else -1.0
    u, y, z = abs(p[0]), p[1], p[2]
    arm, hand, tip = w[0], w[1], w[2]
    du, dy, dz = u - WRIST[0], y - WRIST[1], z - WRIST[2]
    du, dz = _rot(du, dz, -pose["fold"] * hand)
    du, dy = _rot(du, dy, pose["bend"] * hand + pose["curl"] * tip)
    u, y, z = WRIST[0] + du, WRIST[1] + dy, WRIST[2] + dz
    du, dy, dz = u - SHOULDER[0], y - SHOULDER[1], z - SHOULDER[2]
    du, dz = _rot(du, dz, -pose["sweep"] * arm)
    du, dy = _rot(du, dy, pose["lift"] * arm)
    return (side * (SHOULDER[0] + du), SHOULDER[1] + dy, SHOULDER[2] + dz)


def _pose(lift, sweep, bend, fold_, curl):
    return {"lift": lift, "sweep": sweep, "bend": bend, "fold": fold_, "curl": curl}


# The authored poses (radians). The cruise stroke: a goose's steady, fairly shallow beat with
# straight wings, the hand flexed back on the upstroke. The take-off stroke: deep and hard, the
# wings clapped high over the back and swept down and forward to meet nearly under the breast,
# the hand folded right back as it comes up. The theme builds each beat from four poses (top,
# mid downstroke, bottom, mid upstroke) and blends the take-off's into the cruise's.
POSES = {
    "rest": _pose(0.0, 0.0, 0.0, 0.0, 0.0),
    "glide": _pose(0.10, -0.02, -0.07, 0.06, 0.03),
    "top": _pose(0.60, 0.02, 0.16, 0.24, -0.04),
    "down": _pose(0.04, -0.10, -0.06, 0.05, 0.15),
    "bottom": _pose(-0.52, -0.06, -0.24, 0.12, 0.03),
    "up": _pose(0.04, 0.08, -0.20, 0.40, -0.05),
    "takeoffTop": _pose(1.10, 0.12, 0.40, 0.30, -0.08),
    "takeoffDown": _pose(0.08, -0.26, -0.04, -0.06, 0.22),
    "takeoffBottom": _pose(-0.98, -0.16, -0.30, 0.16, 0.05),
    "takeoffUp": _pose(0.12, 0.16, -0.34, 0.72, -0.06),
}


def rig():
    return {
        "frame": "x left, y up, z forward (metres, real size)",
        "span": SPAN,
        "length": LENGTH,
        "shoulder": list(SHOULDER),
        "wrist": list(WRIST),
        "armBand": list(ARM_BAND),
        "armBandTrailing": list(ARM_BAND_TE),
        "handBand": list(HAND_BAND),
        "handBandTrailing": list(HAND_BAND_TE),
        "tipBand": list(TIP_BAND),
        "headBand": list(HEAD_BAND),
        "poses": POSES,
    }


# -- the shipped arrays ---------------------------------------------------------------------------


class Model:
    def __init__(self, builder):
        self.builder = builder
        self.positions = np.array(builder.verts, dtype=np.float64)
        self.triangles = np.array(builder.tris, dtype=np.int64)
        self.wing = np.array(builder.wings, dtype=np.float64)
        self.colors = np.array(builder.colours, dtype=np.float64)
        self._orient()
        self.normals = vertex_normals(self.positions, self.triangles)

    def _orient(self):
        """Face every closed part outward (its signed volume positive)."""
        for v0, v1, t0, t1 in self.builder.shells:
            tris = self.triangles[t0:t1]
            p = self.positions
            a, b, c = p[tris[:, 0]], p[tris[:, 1]], p[tris[:, 2]]
            centre = p[v0:v1].mean(axis=0)
            volume = np.einsum("ij,ij->i", a - centre, np.cross(b - centre, c - centre)).sum()
            if volume < 0:
                self.triangles[t0:t1] = tris[:, [0, 2, 1]]

    def record(self):
        low, high = self.positions.min(axis=0), self.positions.max(axis=0)
        return dict(name="grainfields-goose", species="Taiga bean goose (Anser fabalis fabalis)",
                    triangles=int(len(self.triangles)), vertices=int(len(self.positions)),
                    span=round(float(high[0] - low[0]), 3), length=round(float(high[2] - low[2]), 3))


def vertex_normals(positions, triangles):
    a, b, c = positions[triangles[:, 0]], positions[triangles[:, 1]], positions[triangles[:, 2]]
    face = np.cross(b - a, c - a)  # area-weighted
    n = np.zeros_like(positions)
    for k in range(3):
        np.add.at(n, triangles[:, k], face)
    length = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(length, 1e-12)


def model():
    return Model(build())


def write(path, m, generator, schema_version):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=generator)
    wing = np.clip(m.wing, 0.0, 1.0)
    writer.add_mesh("goose", {
        "POSITION": (m.positions, False),
        "NORMAL": (glb.quantize_unit(m.normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(np.clip(m.colors, 0.0, 1.0), np.uint16), True),
        "_WING": (glb.quantize_unit(wing, np.uint8), True),
    }, indices=m.triangles)
    low, high = m.positions.min(axis=0), m.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=schema_version, **m.record(),
        color={"rgb": "scene-linear plumage", "a": "thin feather (1) or body (0)"},
        wing="arm, hand, tip hinge weights; w the head's share (it holds still as the body heaves)",
        frame="metres, real size: x the bird's left, y up, z forward",
        rig=rig(),
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


# -- Blender: posed lineups for design (the live session) and previews ----------------------------


def to_blender(p):
    """Bird frame (x left, y up, z forward) -> Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


def make_object(name, m, verts, collection):
    import bpy
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(v) for v in verts], [], [tuple(int(i) for i in t) for t in m.triangles])
    mesh.update()
    colour = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(m.colors):
        colour.data[i].color = (c[0], c[1], c[2], 1.0)
    mesh.color_attributes.active_color = colour
    mesh.color_attributes.render_color_index = 0
    mesh.shade_smooth()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def posed(m, pose):
    return [fold(v, w, pose) for v, w in zip(m.builder.verts, m.builder.wings)]


def show(scene_name="GrainfieldsGoose", poses=None, spacing=1.9):
    """Build a lineup of posed geese in a scene of its own (the user's scenes are not touched)."""
    import bpy
    scene = bpy.data.scenes.get(scene_name) or bpy.data.scenes.new(scene_name)
    for obj in list(scene.collection.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0 and isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
    m = model()
    names = poses or list(POSES)
    for k, name in enumerate(names):
        obj = make_object(f"goose-{k:02d}-{name}", m, posed(m, POSES[name]), scene.collection)
        obj.location = (k * spacing, 0.0, 0.0)
    return scene, m, names


def render_views(scene, out_dir, views, size=(1200, 520), ortho=None, mode="plumage", tag=""):
    """Workbench renders of the scene from each named direction; returns the written paths."""
    import bpy
    from mathutils import Vector
    from pathlib import Path
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.show_cavity = False
    scene.display.shading.show_backface_culling = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new(f"{scene.name}-sky")
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new(f"{scene.name}-cam", bpy.data.cameras.new(f"{scene.name}-cam"))
        scene.collection.objects.link(cam)
        scene.camera = cam
    cam.data.type = "ORTHO"
    meshes = sorted((o for o in scene.collection.objects if o.type == "MESH"), key=lambda o: o.name_full)
    meshes = [o for o in meshes if not o.hide_render]
    order = {o.name: k for k, o in enumerate(meshes)}
    spacing = 1.9
    width = spacing * len(meshes)
    scene.render.resolution_x, scene.render.resolution_y = size
    cam.data.ortho_scale = ortho or width
    if mode == "plumage":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "VERTEX"
        scene.world.color = (0.36, 0.34, 0.33)
    else:
        scene.display.shading.light = "FLAT"
        scene.display.shading.color_type = "SINGLE"
        scene.display.shading.single_color = (0.03, 0.025, 0.02)
        scene.world.color = (0.78, 0.74, 0.70)
    paths = []
    for vname, d in views.items():
        d = Vector(d).normalized()
        q = (-d).to_track_quat("-Z", "Y")
        # Spread the lineup across the picture (left to right in the order the poses were built).
        right = q @ Vector((1.0, 0.0, 0.0))
        for o in meshes:
            o.location = right * (order[o.name] - (len(meshes) - 1) * 0.5) * spacing
        cam.location = d * 8
        cam.rotation_euler = q.to_euler()
        path = out_dir / f"goose{tag}-{vname}-{mode}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        paths.append(str(path))
    return paths


# Blender frame: the goose faces -y, up is +z. Straight-down views lean a hair so "up" is defined.
VIEWS = {
    "side": (1.0, 0.0, 0.04),
    "top": (0.0, 0.001, 1.0),
    "below": (0.0, 0.25, -1.0),
    "front": (0.0, -1.0, 0.06),
    "behind": (0.0, 1.0, 0.25),
    "threeq": (0.65, -0.55, -0.35),
    "behind-below": (0.25, 0.9, -0.45),
}


def previews(m, out_dir):
    """Every pose from every view, in one scene of its own, then removed."""
    import bpy
    scene, _m, names = show("GrainfieldsGoosePreview")
    paths = render_views(scene, out_dir, VIEWS, size=(260 * len(names), 260))
    paths += render_views(scene, out_dir, VIEWS, size=(26 * len(names), 26), mode="silhouette", tag="-game")
    for obj in list(scene.collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.scenes.remove(scene)
    print(f"{TAG} previews: {names} x {list(VIEWS)}")
    return paths
