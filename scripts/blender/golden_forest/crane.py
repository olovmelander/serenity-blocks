"""Golden Forest's birds: the common crane (Grus grus), authored procedurally.

The crane is the bird of the Nordic lake at the golden hour: in late summer the families gather
at the shallow lakes and bogs to roost, circling down over the water in the evening light and
crossing the sky in long V's, trumpeting. In flight it is a long cross: the neck stretched
straight out ahead and a little low, the legs trailing straight out behind well past the tail,
and between them long, broad, rectangular wings whose hand ends in six or seven spread primary
"fingers". Ash grey; the flight feathers black (a black trailing edge and wingtip from above,
dark flight feathers behind pale grey coverts from below); the face, throat and foreneck black
with a broad white stripe from behind the eye down the neck, a red crown, a pale greenish bill
and black legs.

Built as plain lists in the bird's frame (metres, real size: 2.20 m span, 1.2 m bill to tail;
x to the bird's LEFT, y up, z forward, the shoulders near the origin), so the same module is used
by the headless asset build (golden_forest_assets.py --only crane), by the live Blender session
the bird was designed in (`show()` builds a posed lineup and an animated wingbeat in a scene of
its own) and by the tests' fold twin.

There is no skeleton. The wings are folded in the theme's vertex stage
(golden-forest-cranes.js) about two hinges, the shoulder and the wrist, whose pivots and authored
poses go into the asset manifest; each vertex carries in `_WING` how much each hinge moves it
(arm, hand, tip: 0..1, eased across a band at each joint so the skin bends instead of creasing)
and, in its fourth channel, how far it belongs to the head and neck (which hold their line while
the body heaves with the wingbeat). `fold()` below is the deformation, line for line the
shader's.

Vertex colours are scene-linear plumage; alpha marks thin feather (1) against body (0), which the
theme lets the low sun shine through. Deterministic: the same script writes the same file.
"""

import math

import numpy as np

TAG = "[golden-forest-crane]"
FILE = "golden-forest-crane.glb"


# -- plumage (sRGB hex -> linear) -----------------------------------------------------------------


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PLUMAGE = {
    "grey": lin("#8c9196"),          # the ash grey of the body
    "mantle": lin("#868684"),        # the back, a little browner (late-summer staining)
    "flank": lin("#7c8186"),
    "belly": lin("#959a9e"),
    "black": lin("#161617"),         # the face, the throat and the foreneck
    "white": lin("#e6e5e0"),         # the stripe from behind the eye down the neck
    "red": lin("#b0262a"),           # the bare red crown
    "bill": lin("#a49f7c"),          # pale greenish horn
    "neckGrey": lin("#82878b"),
    "coverts": lin("#979ca0"),       # the upperwing coverts, paler grey
    "greater": lin("#80858a"),
    "flight": lin("#1c1d1f"),        # the black secondaries
    "primaries": lin("#151618"),     # the black hand
    "under": lin("#aaaeb1"),         # the pale underwing coverts
    "underFlight": lin("#36383b"),   # the flight feathers from below, blackish grey
    "tail": lin("#7d8287"),
    "tailTip": lin("#1f2022"),       # the tail's black end
    "legs": lin("#1e1e1e"),
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

SPAN = 2.20
LENGTH = 1.21          # bill tip to tail tip; the feet trail a further 0.33 m
SHOULDER = (0.080, 0.040, 0.080)
WRIST = (0.540, 0.040, 0.150)
# The bands over which each hinge takes hold (|x|, m), eased from 0 to 1 across them: at the
# leading edge, and (the _TE bands) at the trailing edge, where the skin lies far from the joint and
# moves the most, so it bends over a longer run there instead of tearing (the inner secondaries
# follow the folding hand part of the way, as a real wing's do).
ARM_BAND = (0.070, 0.230)
ARM_BAND_TE = (0.070, 0.300)
HAND_BAND = (0.505, 0.580)
HAND_BAND_TE = (0.300, 0.800)
TIP_BAND = (0.760, 1.100)
# The neck and head's share of the body (they hold their line while the body heaves): along z, m.
HEAD_BAND = (0.150, 0.420)


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


def ring(cx, cy, z, wx, top, bottom, count, power=0.9):
    """An egg-shaped ring: half width wx, top over and bottom under the centre height cy."""
    out = []
    for i in range(count):
        a = 2 * math.pi * i / count
        ca, sa = math.cos(a), math.sin(a)
        x = cx + wx * math.copysign(abs(ca) ** power, ca)
        y = cy + (top if sa > 0 else bottom) * math.copysign(abs(sa) ** power, sa)
        out.append((x, y, z, ca, sa))
    return out


# Body: a slim spindle from the tail's base to the breast (a crane is all neck, legs and wing).
# z, half width, top, bottom, centre height
BODY = [
    (-0.275, 0.028, 0.020, 0.020, 0.024),
    (-0.245, 0.046, 0.032, 0.034, 0.018),
    (-0.195, 0.066, 0.046, 0.056, 0.012),
    (-0.125, 0.083, 0.057, 0.077, 0.005),
    (-0.045, 0.093, 0.064, 0.088, 0.001),
    (0.035, 0.094, 0.066, 0.090, -0.002),
    (0.105, 0.084, 0.062, 0.084, -0.005),
    (0.160, 0.064, 0.052, 0.068, -0.008),
    (0.200, 0.045, 0.041, 0.050, -0.011),
    (0.222, 0.036, 0.034, 0.041, -0.013),
]
BODY_RING = 16


def body_colour(z, ca, sa):
    """sa: -1 belly .. 1 back; ca: across (the flanks are where |ca| is large)."""
    under = mix(PLUMAGE["belly"], PLUMAGE["grey"], smooth(-0.05, 0.15, z))
    flank = PLUMAGE["flank"]
    back = mix(PLUMAGE["mantle"], PLUMAGE["grey"], 0.35 * fringes(-z, 0.04, 0.24))
    side = mix(under, flank, smooth(-0.6, 0.0, sa))
    col = mix(side, back, smooth(0.05, 0.5, sa))
    # The breast's front runs into the grey of the lower neck.
    return mix(col, PLUMAGE["neckGrey"], smooth(0.15, 0.21, z))


def build_body(b, rings_n=BODY_RING):
    b.begin()
    rings = []
    for z, wx, top, bottom, cy in BODY:
        r = []
        for x, y, zz, ca, sa in ring(0.0, cy, z, wx, top, bottom, rings_n):
            r.append(b.vert((x, y, zz), body_colour(z, ca, sa), 0.0, head=head_share(z)))
        rings.append(r)
    rump = b.vert((0, BODY[0][4], BODY[0][0] - 0.006), PLUMAGE["mantle"], 0.0)
    front = b.vert((0, BODY[-1][4], BODY[-1][0] + 0.004), PLUMAGE["neckGrey"], 0.0, head=head_share(0.22))
    b.loft(rings, close_start=rump, close_end=front)
    b.end()


# The neck and head, one tube: the neck long, thin and straight, held a little low; the small
# head with its flat crown running into the bill.
# z, half width, top, bottom, centre height
NECK = [
    (0.165, 0.044, 0.046, 0.053, -0.010),
    (0.210, 0.035, 0.037, 0.041, -0.015),
    (0.260, 0.027, 0.029, 0.032, -0.020),
    (0.315, 0.0225, 0.025, 0.027, -0.026),
    (0.375, 0.0205, 0.023, 0.025, -0.032),
    (0.435, 0.0195, 0.022, 0.024, -0.038),
    (0.495, 0.0195, 0.022, 0.023, -0.044),
    (0.550, 0.0205, 0.023, 0.023, -0.049),
    (0.592, 0.0230, 0.027, 0.024, -0.052),
    (0.625, 0.0262, 0.032, 0.025, -0.053),
    (0.655, 0.0250, 0.030, 0.023, -0.054),
    (0.680, 0.0195, 0.022, 0.019, -0.057),
    (0.697, 0.0135, 0.0145, 0.0135, -0.059),
]
NECK_RING = 12


def neck_colour(z, ca, sa):
    """The foreneck black, the hind neck and a stripe from behind the eye white, a red crown."""
    lower = PLUMAGE["neckGrey"]
    # Black below (the throat and foreneck) and white above (the hind neck), from the head down
    # two thirds of the neck; the line between runs down the side.
    pattern = mix(PLUMAGE["black"], PLUMAGE["white"], smooth(-0.25, 0.05, sa))
    col = mix(lower, pattern, smooth(0.27, 0.34, z))
    # The head: the face black ahead of the eye and below, the white stripe from behind the eye,
    # the red crown on top.
    face = mix(PLUMAGE["black"], PLUMAGE["white"], smooth(-0.1, 0.25, sa) * smooth(0.665, 0.635, z))
    col = mix(col, face, smooth(0.58, 0.61, z))
    crown = smooth(0.55, 0.85, sa) * smooth(0.600, 0.615, z) * smooth(0.672, 0.660, z)
    return mix(col, PLUMAGE["red"], crown)


def build_neck(b, rings_n=NECK_RING):
    b.begin()
    rings = []
    for z, wx, top, bottom, cy in NECK:
        r = []
        for x, y, zz, ca, sa in ring(0.0, cy, z, wx, top, bottom, rings_n, power=0.95):
            r.append(b.vert((x, y, zz), neck_colour(z, ca, sa), 0.0, head=head_share(z)))
        rings.append(r)
    back = b.vert((0, NECK[0][4], NECK[0][0] - 0.004), PLUMAGE["neckGrey"], 0.0, head=head_share(0.16))
    face = b.vert((0, NECK[-1][4], NECK[-1][0] + 0.003), PLUMAGE["black"], 0.0, head=1.0)
    b.loft(rings, close_start=back, close_end=face)
    b.end()


# The bill: straight, dagger-like, as long as the head.
# z, half width, top, bottom, centre height
BILL = [
    (0.692, 0.0110, 0.0118, 0.0102, -0.0595),
    (0.718, 0.0092, 0.0094, 0.0084, -0.0615),
    (0.744, 0.0075, 0.0076, 0.0068, -0.0632),
    (0.770, 0.0057, 0.0058, 0.0052, -0.0648),
    (0.790, 0.0038, 0.0040, 0.0036, -0.0660),
]
BILL_RING = 8


def build_bill(b, rings_n=BILL_RING):
    b.begin()
    rings = []
    for z, wx, top, bottom, cy in BILL:
        r = []
        for x, y, zz, ca, sa in ring(0.0, cy, z, wx, top, bottom, rings_n, power=0.85):
            r.append(b.vert((x, y, zz), PLUMAGE["bill"], 0.0, head=1.0))
        rings.append(r)
    base = b.vert((0, BILL[0][4], BILL[0][0] - 0.004), PLUMAGE["bill"], 0.0, head=1.0)
    tip = b.vert((0, -0.0672, 0.806), PLUMAGE["bill"], 0.0, head=1.0)
    b.loft(rings, close_start=base, close_end=tip)
    b.end()


# The tail: short and rounded, grey with a black end.
# z, half width, centre height, half thickness
TAIL = [
    (-0.225, 0.042, 0.020, 0.016),
    (-0.265, 0.064, 0.020, 0.011),
    (-0.305, 0.080, 0.019, 0.008),
    (-0.345, 0.086, 0.018, 0.006),
    (-0.378, 0.076, 0.017, 0.005),
    (-0.400, 0.050, 0.017, 0.004),
]
TAIL_RING = 12


def tail_colour(z):
    return mix(PLUMAGE["tail"], PLUMAGE["tailTip"], smooth(-0.335, -0.36, z))


def build_tail(b, rings_n=TAIL_RING):
    b.begin()
    rings = []
    for k, (z, wx, cy, thick) in enumerate(TAIL):
        thin = smooth(1.0, 4.0, k) * 0.6
        r = []
        for i in range(rings_n):
            a = 2 * math.pi * i / rings_n
            ca, sa = math.cos(a), math.sin(a)
            x = wx * math.copysign(abs(ca) ** 0.55, ca)
            y = cy + thick * sa
            r.append(b.vert((x, y, z), tail_colour(z), thin))
        rings.append(r)
    root = b.vert((0, TAIL[0][2], TAIL[0][0] + 0.01), PLUMAGE["tail"], 0.0)
    end = b.vert((0, TAIL[-1][2], TAIL[-1][0] - 0.003), PLUMAGE["tailTip"], 0.6)
    b.loft(rings, close_start=root, close_end=end)
    b.end()


# The legs: trailing straight back under the tail and well past it, the feet together.
# (z, x, y, radius) along each leg from the belly (the feathered thigh) to the toes.
LEG = [
    (-0.120, 0.034, -0.070, 0.020),
    (-0.200, 0.030, -0.060, 0.015),
    (-0.290, 0.024, -0.040, 0.0105),   # the "knee" (the ankle), under the tail
    (-0.420, 0.018, -0.024, 0.0080),
    (-0.560, 0.014, -0.014, 0.0074),
    (-0.640, 0.012, -0.010, 0.0085),   # the foot
    (-0.700, 0.011, -0.010, 0.0062),
    (-0.733, 0.010, -0.011, 0.0030),
]
LEG_RING = 6


def leg_colour(z):
    return mix(PLUMAGE["flank"], PLUMAGE["legs"], smooth(-0.15, -0.24, z))


def build_leg(b, side, rings_n=LEG_RING):
    b.begin()
    rings = []
    for z, x, y, r in LEG:
        rr = []
        for i in range(rings_n):
            a = 2 * math.pi * i / rings_n
            rr.append(b.vert((side * x + r * math.cos(a), y + r * math.sin(a) * 0.85, z), leg_colour(z), 0.0))
        rings.append(rr)
    root = b.vert((side * LEG[0][1], LEG[0][2], LEG[0][0] + 0.012), PLUMAGE["flank"], 0.0)
    toe = b.vert((side * LEG[-1][1], LEG[-1][2], LEG[-1][0] - 0.004), PLUMAGE["legs"], 0.0)
    b.loft(rings, close_start=root, close_end=toe)
    b.end()


# -- the wings: long and broad, the hand ending in spread primary "fingers" ---------------------

# Stations along the span (|x|, m), dense at the hinges so the skin bends smoothly; the hand's
# plate ends where the fingers part.
STATIONS = [0.065, 0.085, 0.110, 0.140, 0.180, 0.240, 0.310, 0.380, 0.440, 0.490, 0.520, 0.545,
            0.570, 0.610, 0.660, 0.715, 0.770, 0.815, 0.850]
# Leading and trailing edges (z, m) along the span: the wrist (carpal) is the forward-most point;
# the inner wing is broad (the long secondaries and tertials), its trailing edge nearly straight.
LEADING = [(0.065, 0.125), (0.200, 0.136), (0.400, 0.152), (0.540, 0.166), (0.640, 0.155),
           (0.760, 0.130), (0.850, 0.106)]
TRAILING = [(0.065, -0.312), (0.140, -0.292), (0.250, -0.266), (0.400, -0.252), (0.540, -0.244),
            (0.660, -0.230), (0.760, -0.214), (0.850, -0.200)]
THICKNESS = [(0.065, 0.13), (0.250, 0.10), (0.540, 0.07), (0.850, 0.045)]
# Chord fractions (leading edge 0 -> trailing edge 1).
CHORD = [0.0, 0.02, 0.07, 0.15, 0.27, 0.42, 0.58, 0.74, 0.88, 1.0]


def wing_centre(s):
    return 0.040 - 0.006 * (s / (SPAN * 0.5))


def airfoil(c, t, x):
    """Camber line and half-thicknesses over and under it, as metres along a chord c."""
    camber = 0.045 * 4 * x * (1 - x)
    yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    yt *= 1 - smooth(0.40, 1.0, x) * 0.85  # the feathered back half is thin
    return camber * c, yt * c, yt * c * 0.45


def wing_colour(s, x, upper):
    """s: |x| along the span; x: chord fraction 0 leading edge .. 1 trailing edge."""
    hand = smooth(0.50, 0.58, s)
    if upper:
        # Grey coverts over the front of the wing, the greater coverts' rows a shade darker; the
        # black secondaries behind (the trailing edge); the hand black but for its grey coverts.
        coverts = mix(PLUMAGE["coverts"], PLUMAGE["greater"], 0.4 * fringes(x, 0.12, 0.3))
        reach = 0.58 + (0.36 - 0.58) * hand
        col = mix(coverts, PLUMAGE["flight"], smooth(reach, reach + 0.10, x))
        # The tertials by the body stay grey (they fall over the back).
        col = mix(col, PLUMAGE["mantle"], smooth(0.16, 0.09, s) * smooth(0.5, 0.8, x))
        return mix(col, PLUMAGE["primaries"], smooth(0.60, 0.74, s))
    under = mix(PLUMAGE["under"], PLUMAGE["underFlight"], smooth(0.45, 0.60, x))
    under = mix(under, PLUMAGE["underFlight"], smooth(0.58, 0.72, s) * smooth(-0.2, 0.3, x))
    return under


def build_wing(b, side, stations=STATIONS, chord=CHORD):
    """side = 1 left (+x), -1 right."""
    b.begin()
    rings = []
    order = [(x, True) for x in chord] + [(x, False) for x in reversed(chord[1:])]
    # Upper surface LE -> TE, then the lower surface TE -> LE: the trailing edge is split (a
    # sharp edge), the leading edge is shared (round).
    for s in stations:
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
            thin = smooth(0.30, 0.70, x) * (0.5 + 0.5 * smooth(0.25, 0.60, s))
            r.append(b.vert((side * s, y, z), wing_colour(s, x, upper), thin, wing_weights(s, x)))
        rings.append(r)
    root = b.vert((side * stations[0], wing_centre(0), -0.08), PLUMAGE["under"], 0.0, wing_weights(0.0))
    end_s = stations[-1] + 0.004
    end = b.vert((side * end_s, wing_centre(end_s), (interp(LEADING, end_s) + interp(TRAILING, end_s)) * 0.5),
                 PLUMAGE["primaries"], 0.8, wing_weights(end_s, 0.5))
    b.loft(rings, close_start=root, close_end=end)
    b.end()


# The fingers: the outer primaries, parted at their tips. Each one roots inside the hand's plate
# and runs out to a rounded point. (root chord fraction along the plate's end, angle from straight
# out (+ forward, degrees), length beyond the plate, root width)
FINGERS = [
    (0.07, 10.0, 0.165, 0.066),
    (0.23, 2.0, 0.240, 0.074),
    (0.39, -6.0, 0.258, 0.076),
    (0.55, -14.0, 0.246, 0.076),
    (0.71, -22.0, 0.214, 0.074),
    (0.87, -31.0, 0.168, 0.068),
]
FINGER_STATIONS = [-0.06, 0.0, 0.30, 0.58, 0.78, 0.90, 0.97, 1.0]
FINGER_RING = 6


def build_finger(b, side, finger, stations=FINGER_STATIONS, rings_n=FINGER_RING):
    f, angle, length, width = finger
    s0 = STATIONS[-1] - 0.025
    le, te = interp(LEADING, s0), interp(TRAILING, s0)
    root = (s0, le - f * (le - te))
    a = math.radians(angle)
    along = (math.cos(a), math.sin(a))         # (|x|, z) direction out along the feather
    across = (-math.sin(a), math.cos(a))       # its leading side
    b.begin()
    rings = []
    for u in stations:
        # The vane narrows to a rounded tip; the outer web (leading side) is the narrower one.
        tipround = math.sqrt(max(0.0, 1.0 - max(0.0, (u - 0.62) / 0.40) ** 2))
        w = width * (1.0 - 0.30 * smooth(0.0, 1.0, u)) * max(tipround, 0.12)
        sx = root[0] + along[0] * u * length
        sz = root[1] + along[1] * u * length
        # Each finger bends up a little toward its tip (the load), more the longer it is.
        lift = 0.045 * length * u * u
        t = 0.008 * (1.0 - 0.6 * u)
        cy = wing_centre(sx) + lift
        r = []
        for i in range(rings_n):
            k = 2 * math.pi * i / rings_n
            ck, sk = math.cos(k), math.sin(k)
            off = w * 0.5 * ck * (0.75 if ck > 0 else 1.0)
            px = sx + across[0] * off
            pz = sz + across[1] * off
            py = cy + t * sk
            upper = sk >= 0
            col = PLUMAGE["primaries"] if upper else PLUMAGE["underFlight"]
            r.append(b.vert((side * px, py, pz), col, 1.0, wing_weights(px, 0.5)))
        rings.append(r)
    s_tip = root[0] + along[0] * (length + 0.006)
    tip = b.vert((side * s_tip, wing_centre(s_tip) + 0.045 * length,
                  root[1] + along[1] * (length + 0.006)), PLUMAGE["primaries"], 1.0, wing_weights(s_tip, 0.5))
    b.loft(rings, close_end=tip)
    # Close the root (it lies inside the hand's plate) with a fan of its own.
    first = rings[0]
    centre = b.vert((side * root[0], wing_centre(root[0]), root[1]), PLUMAGE["primaries"], 1.0,
                    wing_weights(root[0], 0.5))
    for i in range(rings_n):
        b.tris.append((centre, first[(i + 1) % rings_n], first[i]))
    b.end()


# Two levels of detail from the same lofts: the near bird, and the far one (most of the sky's,
# seen 8-25 px across), which keeps the silhouette (the fingers, the neck, the trailing legs)
# with a fraction of the triangles.
DETAIL = {
    "near": dict(body=12, neck=10, bill=6, tail=10, leg=5,
                 stations=[0.065, 0.090, 0.125, 0.180, 0.260, 0.350, 0.440, 0.500, 0.535, 0.565, 0.610,
                           0.680, 0.760, 0.820, 0.850],
                 chord=[0.0, 0.03, 0.10, 0.22, 0.40, 0.60, 0.80, 1.0],
                 finger_stations=FINGER_STATIONS, finger_ring=4),
    "far": dict(body=8, neck=6, bill=4, tail=6, leg=3,
                stations=[0.065, 0.150, 0.300, 0.470, 0.540, 0.620, 0.740, 0.850],
                chord=[0.0, 0.08, 0.35, 0.70, 1.0],
                finger_stations=[-0.06, 0.0, 0.50, 0.85, 1.0], finger_ring=3),
}


def build(detail="near"):
    d = DETAIL[detail]
    b = Builder()
    build_body(b, d["body"])
    build_neck(b, d["neck"])
    build_bill(b, d["bill"])
    build_tail(b, d["tail"])
    for side in (1, -1):
        build_leg(b, side, d["leg"])
        build_wing(b, side, d["stations"], d["chord"])
        for finger in FINGERS:
            build_finger(b, side, finger, d["finger_stations"], d["finger_ring"])
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
    curl:  the fingers bent up under load (+), carried by the tip weight
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


# The authored poses (radians). The cruise stroke: a crane's slow, stiff, fairly shallow downstroke
# and a quick upstroke with a flick of the hand at its top. Soaring: the wings spread flat and
# still, the hand a touch low and the fingers curled up under the load. The hard stroke (startled):
# deep, the wings raised high over the back and driven down and forward. The theme builds each beat
# from four poses (top, mid downstroke, bottom, mid upstroke).
POSES = {
    "rest": _pose(0.0, 0.0, 0.0, 0.0, 0.0),
    "soar": _pose(0.07, -0.03, -0.06, 0.0, 0.11),
    "glide": _pose(0.02, 0.06, -0.09, 0.14, 0.10),
    "top": _pose(0.58, 0.04, 0.26, 0.14, -0.08),
    "down": _pose(0.05, -0.08, -0.03, 0.02, 0.20),
    "bottom": _pose(-0.48, -0.05, -0.24, 0.10, 0.08),
    "up": _pose(-0.04, 0.10, -0.30, 0.30, -0.06),
    "hardTop": _pose(0.92, 0.12, 0.36, 0.18, -0.10),
    "hardDown": _pose(0.06, -0.20, -0.02, -0.04, 0.26),
    "hardBottom": _pose(-0.80, -0.12, -0.30, 0.14, 0.08),
    "hardUp": _pose(0.06, 0.16, -0.40, 0.40, -0.08),
}
# The beat's four poses in cycle order, and the share of the cycle the downstroke takes.
CYCLE = ("top", "down", "bottom", "up")
HARD_CYCLE = ("hardTop", "hardDown", "hardBottom", "hardUp")
DOWNSTROKE = 0.60


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
        "downstroke": DOWNSTROKE,
        "poses": POSES,
    }


# -- the beat in Python (the previews' animation; the theme's flight module is its twin) ----------


def stroke_warp(phase):
    """Map a uniform beat phase (0..1) to the stroke's own angle: the downstroke takes DOWNSTROKE."""
    p = phase % 1.0
    if p < DOWNSTROKE:
        return math.pi * p / DOWNSTROKE
    return math.pi + math.pi * (p - DOWNSTROKE) / (1.0 - DOWNSTROKE)


def beat_pose(phase, cycle=CYCLE):
    """The pose at a beat phase: X(a) = A + B cos a + C sin a + D sin^2 a through top (a = 0),
    mid-down (pi/2), bottom (pi) and mid-up (3 pi/2), round the cycle without a corner."""
    a = stroke_warp(phase)
    top, down, bottom, up = (POSES[k] for k in cycle)
    out = {}
    for key in top:
        A = 0.5 * (top[key] + bottom[key])
        B = 0.5 * (top[key] - bottom[key])
        C = 0.5 * (down[key] - up[key])
        D = 0.5 * (down[key] + up[key]) - A
        out[key] = A + B * math.cos(a) + C * math.sin(a) + D * math.sin(a) ** 2
    return out


# -- the shipped arrays ---------------------------------------------------------------------------


class Model:
    def __init__(self, builder, detail="near"):
        self.builder = builder
        self.detail = detail
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
        return dict(name="golden-forest-crane", species="Common crane (Grus grus)", detail=self.detail,
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


def model(detail="near"):
    return Model(build(detail), detail)


def write(path, models, generator, schema_version):
    """One GLB with a mesh per level of detail ("crane": near, "crane_far")."""
    from fall_grove import glb
    writer = glb.GlbWriter(generator=generator)
    summary = {}
    for m in models:
        name = "crane" if m.detail == "near" else "crane_" + m.detail
        writer.add_mesh(name, {
            "POSITION": (m.positions, False),
            "NORMAL": (glb.quantize_unit(m.normals, np.int8), True),
            "COLOR_0": (glb.quantize_unit(np.clip(m.colors, 0.0, 1.0), np.uint16), True),
            "_WING": (glb.quantize_unit(np.clip(m.wing, 0.0, 1.0), np.uint8), True),
        }, indices=m.triangles)
        summary[name] = dict(triangles=int(len(m.triangles)), vertices=int(len(m.positions)))
    near = models[0]
    low, high = near.positions.min(axis=0), near.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=schema_version, **near.record(), meshes=summary,
        color={"rgb": "scene-linear plumage", "a": "thin feather (1) or body (0)"},
        wing="arm, hand, tip hinge weights; w the head and neck's share (they hold as the body heaves)",
        frame="metres, real size: x the bird's left, y up, z forward",
        rig=rig(),
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path), summary


# -- Blender: posed lineups and the animated wingbeat for design (the live session) and previews --


def to_blender(p):
    """Bird frame (x left, y up, z forward) -> Blender (x, -z, y): the crane faces -y, up is +z."""
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


def heaved(m, pose, heave):
    """The fold, then the body lifted by `heave` m while the head and neck hold their line."""
    return [(x, y + heave * (1.0 - w[3]), z) for (x, y, z), w in zip(posed(m, pose), m.builder.wings)]


def clear_scene(scene):
    import bpy
    for obj in list(scene.collection.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0 and isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)


def show(scene_name="GoldenForestCrane", poses=None, spacing=2.6):
    """Build a lineup of posed cranes in a scene of its own (the user's scenes are not touched)."""
    import bpy
    scene = bpy.data.scenes.get(scene_name) or bpy.data.scenes.new(scene_name)
    clear_scene(scene)
    m = model()
    names = poses or list(POSES)
    for k, name in enumerate(names):
        obj = make_object(f"crane-{k:02d}-{name}", m, posed(m, POSES[name]), scene.collection)
        obj.location = (k * spacing, 0.0, 0.0)
    return scene, m, names


def animate(scene_name="GoldenForestCraneFlight", hz=2.3, fps=24, beats=4, samples=16, heave=0.018):
    """An animated crane in a scene of its own: the beat sampled into shape keys, each keyed in
    turn round the cycle, so the timeline plays the theme's wingbeat (loops; press play)."""
    import bpy
    scene = bpy.data.scenes.get(scene_name) or bpy.data.scenes.new(scene_name)
    clear_scene(scene)
    m = model()
    obj = make_object("crane-wingbeat", m, posed(m, POSES["rest"]), scene.collection)
    obj.shape_key_add(name="Basis", from_mix=False)
    keys = []
    for k in range(samples):
        phase = k / samples
        pose = beat_pose(phase)
        # The body rises on the downstroke and sinks on the upstroke (the head holds).
        h = heave * math.sin(stroke_warp(phase) - 0.6)
        key = obj.shape_key_add(name=f"beat-{k:02d}", from_mix=False)
        for i, v in enumerate(heaved(m, pose, h)):
            key.data[i].co = to_blender(v)
        keys.append(key)
    frames_per_beat = fps / hz
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = int(round(frames_per_beat * beats))
    for b in range(beats + 1):
        for k, key in enumerate(keys):
            centre = 1 + (b + k / samples) * frames_per_beat
            step = frames_per_beat / samples
            for f, v in ((centre - step, 0.0), (centre, 1.0), (centre + step, 0.0)):
                key.value = v
                key.keyframe_insert("value", frame=f)
    for fc in _fcurves(obj.data.shape_keys.animation_data.action):
        for point in fc.keyframe_points:
            point.interpolation = "LINEAR"
    return scene, obj


def _fcurves(action):
    """An action's F-curves, in the layered (Blender 4.4+) or the older layout."""
    if action is None:
        return []
    if hasattr(action, "layers") and len(action.layers):
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for slot in action.slots:
                    bag = strip.channelbag(slot)
                    if bag is not None:
                        out.extend(bag.fcurves)
        return out
    return list(getattr(action, "fcurves", []))


def render_views(scene, out_dir, views, size=(1200, 520), ortho=None, mode="plumage", tag="", spacing=2.6):
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
    cam.data.clip_end = 100
    meshes = sorted((o for o in scene.collection.objects if o.type == "MESH"), key=lambda o: o.name_full)
    meshes = [o for o in meshes if not o.hide_render]
    order = {o.name: k for k, o in enumerate(meshes)}
    width = spacing * len(meshes)
    scene.render.resolution_x, scene.render.resolution_y = size
    cam.data.ortho_scale = ortho or width
    if mode == "plumage":
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "VERTEX"
        scene.world.color = (0.36, 0.33, 0.30)
    else:
        scene.display.shading.light = "FLAT"
        scene.display.shading.color_type = "SINGLE"
        scene.display.shading.single_color = (0.03, 0.025, 0.02)
        scene.world.color = (0.80, 0.62, 0.44)
    paths = []
    for vname, d in views.items():
        d = Vector(d).normalized()
        q = (-d).to_track_quat("-Z", "Y")
        # Spread the lineup across the picture (left to right in the order the poses were built).
        right = q @ Vector((1.0, 0.0, 0.0))
        for o in meshes:
            o.location = right * (order[o.name] - (len(meshes) - 1) * 0.5) * spacing
        cam.location = d * 10
        cam.rotation_euler = q.to_euler()
        path = out_dir / f"crane{tag}-{vname}-{mode}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        paths.append(str(path))
    return paths


# Blender frame: the crane faces -y, up is +z. Straight-down views lean a hair so "up" is defined.
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
    scene, _m, names = show("GoldenForestCranePreview")
    paths = render_views(scene, out_dir, VIEWS, size=(260 * len(names), 260))
    paths += render_views(scene, out_dir, VIEWS, size=(22 * len(names), 22), mode="silhouette", tag="-game")
    clear_scene(scene)
    bpy.data.scenes.remove(scene)
    print(f"{TAG} previews: {names} x {list(VIEWS)}")
    return paths
