"""Odyssey's lowland birds: a herring gull, a barn swallow and a greylag goose (chapters 3-4).

Run headless (nothing in an open Blender session is touched):

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_birds.py -- \
        --out src/rendering/odyssey/composition/odyssey-bird-models.js [--preview <dir>]

The gulls wheel over the surf, the swallows hunt over the meadows and a skein of geese crosses the
massif (composition/odyssey-flights.js). In the game frame at 2560 x 1440 a gull is 20-55 px from
wingtip to wingtip, a swallow 7-36 px and a goose 9-35 px, so each bird is built for that size:
a few hundred triangles that get the silhouette (the planform with its wrist, the body's
volume, the bill, the tail), the plumage pattern the eye can still name at 30 px (the gull's
black wingtips with white mirrors on a grey mantle and white body, the swallow's blue-black
back, rust throat and long tail streamers, the goose's grey-brown barred back, pale forewing
and orange bill) and real normals for the act's light.

Built as plain lists in the bird's frame (metres, real size: x the bird's LEFT, y up, z forward,
the shoulders near the origin). Bodies, heads and bills are closed shells; wings and tails are
single sheets (the game draws them double-sided, with the plumage seen from above on one face
and from below on the other). There is no skeleton: each vertex carries how much the shoulder,
the wrist and the wingtip move it (eased across a band at each joint, the bands widening toward
the trailing edge, where the skin lies far from the joint), and the game folds the wings about
those two hinges in its vertex stage. `fold()` below is that deformation, line for line, and
`wing_pose()` the wingbeat; their parameters are written into the module so the game, the tests
and these previews run the same numbers.

The output is a JS module of base64 typed arrays (no fetch, no loader: the flights are built
synchronously with the board). Deterministic: the same script writes the same file.
"""

import base64
import json
import math
import sys
from array import array
from pathlib import Path

TAG = "[odyssey-birds]"
SCENE = "OdysseyBirds"
QUANT = 1e-4  # metres per unit of the stored positions


# -- plumage (sRGB hex -> linear) ------------------------------------------------------------------


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def srgb8(c):
    out = []
    for x in c:
        x = max(0.0, min(1.0, x))
        s = x * 12.92 if x <= 0.0031308 else 1.055 * (x ** (1 / 2.4)) - 0.055
        out.append(int(round(s * 255)))
    return out


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def interp(points, s):
    """Piecewise-linear y(s) through sorted (s, y) points."""
    if s <= points[0][0]:
        return points[0][1]
    for (s0, y0), (s1, y1) in zip(points, points[1:]):
        if s <= s1:
            return y0 + (y1 - y0) * (s - s0) / (s1 - s0)
    return points[-1][1]


# -- the mesh builder ------------------------------------------------------------------------------


class Builder:
    def __init__(self, name):
        self.name = name
        self.verts = []
        self.tris = []
        self.hinge = []    # per vertex: (arm, hand, tip, thin)
        self.top = []      # plumage seen from above (and the whole of a shell)
        self.under = []    # plumage seen from below (sheets); a shell's copy of `top`
        self.parts = []    # (first vertex, end vertex, first tri, end tri, "shell" | "sheet", name)

    def begin(self):
        self._part = (len(self.verts), len(self.tris))

    def end(self, kind, name):
        v0, t0 = self._part
        self.parts.append((v0, len(self.verts), t0, len(self.tris), kind, name))

    def vert(self, p, top, under=None, hinge=(0.0, 0.0, 0.0), thin=0.0):
        self.verts.append(tuple(float(v) for v in p))
        self.hinge.append((hinge[0], hinge[1], hinge[2], thin))
        self.top.append(list(top))
        self.under.append(list(under if under is not None else top))
        return len(self.verts) - 1

    def quad(self, a, b, c, d):
        self.tris.append((a, b, c))
        self.tris.append((a, c, d))

    def loft(self, rings, close_start=None, close_end=None):
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                self.quad(a[i], a[j], b[j], b[i])
        if close_start is not None:
            r = rings[0]
            for i in range(n):
                self.tris.append((close_start, r[(i + 1) % n], r[i]))
        if close_end is not None:
            r = rings[-1]
            for i in range(n):
                self.tris.append((close_end, r[i], r[(i + 1) % n]))

    # -- facing: shells outward, sheets up -----------------------------------------------------

    def orient(self):
        for v0, v1, t0, t1, kind, _name in self.parts:
            tris = self.tris[t0:t1]
            if kind == "shell":
                centre = [sum(self.verts[i][k] for i in range(v0, v1)) / (v1 - v0) for k in range(3)]
                vol = 0.0
                for a, b, c in tris:
                    pa, pb, pc = (sub(self.verts[i], centre) for i in (a, b, c))
                    vol += dot(pa, cross(pb, pc))
                flip = vol < 0
            else:
                ny = sum(cross(sub(self.verts[b], self.verts[a]), sub(self.verts[c], self.verts[a]))[1]
                         for a, b, c in tris)
                flip = ny < 0
            if flip:
                self.tris[t0:t1] = [(a, c, b) for a, b, c in tris]

    def normals(self):
        n = [[0.0, 0.0, 0.0] for _ in self.verts]
        for a, b, c in self.tris:
            f = cross(sub(self.verts[b], self.verts[a]), sub(self.verts[c], self.verts[a]))  # area-weighted
            for i in (a, b, c):
                for k in range(3):
                    n[i][k] += f[k]
        out = []
        for v in n:
            length = math.sqrt(dot(v, v)) or 1.0
            out.append([v[k] / length for k in range(3)])
        return out


def sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def ring(cy, z, wx, top, bottom, count, power=0.85):
    """An egg-shaped ring round the bird's long axis: (x, y, z, cos a, sin a) per vertex."""
    out = []
    for i in range(count):
        a = 2 * math.pi * i / count + math.pi / 2  # vertex 0 on the top centre line
        ca, sa = math.cos(a), math.sin(a)
        x = wx * math.copysign(abs(ca) ** power, ca)
        y = cy + (top if sa > 0 else bottom) * math.copysign(abs(sa) ** power, sa)
        out.append((x, y, z, ca, sa))
    return out


def shell(b, name, profile, count, colour_of, nose=None, tail=None, power=0.85):
    """A closed tube through `profile` rings (z, half width, top, bottom, centre height)."""
    b.begin()
    rings = []
    for z, wx, top, bottom, cy in profile:
        rings.append([b.vert((x, y, zz), colour_of(z, ca, sa)) for x, y, zz, ca, sa
                      in ring(cy, z, wx, top, bottom, count, power)])
    start = b.vert(tail[0], tail[1]) if tail else None
    end = b.vert(nose[0], nose[1]) if nose else None
    b.loft(rings, close_start=start, close_end=end)
    b.end("shell", name)


def cone(b, name, base_z, tip, base_y, half_w, half_h, colour_at, count=4):
    """A small pointed cone (a bill): a ring at base_z (inside the head) closed to the tip."""
    b.begin()
    r = []
    for i in range(count):
        a = 2 * math.pi * i / count + math.pi / 2
        r.append(b.vert((half_w * math.cos(a), base_y + half_h * math.sin(a), base_z), colour_at(0.0)))
    back = b.vert((0.0, base_y, base_z - 0.002), colour_at(0.0))
    point = b.vert(tip, colour_at(1.0))
    b.loft([r], close_start=back, close_end=point)
    b.end("shell", name)


# -- the wing: a sheet over stations along the span, the hand ending in one tip vertex --------------


def wing_weights(spec, ax, c):
    """Hinge weights at |x| = ax along the span; c the chord fraction (0 leading .. 1 trailing)."""
    def band(le, te):
        return (le[0] + (te[0] - le[0]) * c, le[1] + (te[1] - le[1]) * c)
    return (smooth(*band(spec["armBand"], spec["armBandTE"]), ax),
            smooth(*band(spec["handBand"], spec["handBandTE"]), ax),
            smooth(*spec["tipBand"], ax))


def build_wing(b, spec, side, colour_of):
    """side = 1 left (+x), -1 right. Upper colours face up; the sheet is drawn from both sides."""
    b.begin()
    chord = spec["chord"]
    rows = []
    for s, le, te in spec["planform"]:
        c_len = le - te
        row = []
        for c in chord:
            z = le - c * c_len
            y = spec["wingY"](s) + spec["camber"] * c_len * 4 * c * (1 - c)
            top, under = colour_of(s, c)
            thin = smooth(0.3, 0.9, c) * (0.4 + 0.6 * smooth(spec["wrist"][0], spec["tipBand"][1], s))
            row.append(b.vert((side * s, y, z), top, under, wing_weights(spec, s, c), thin))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        for j in range(len(chord) - 1):
            b.quad(ra[j], rb[j], rb[j + 1], ra[j + 1])
    ts, tz = spec["tip"]
    top, under = colour_of(ts, 0.5)
    tip = b.vert((side * ts, spec["wingY"](ts), tz), top, under, wing_weights(spec, ts, 0.5), 1.0)
    last = rows[-1]
    for j in range(len(chord) - 1):
        b.tris.append((last[j], tip, last[j + 1]))
    b.end("sheet", f"wing{'L' if side > 0 else 'R'}")


def build_sheet(b, name, points, tris, colour_of):
    """A small flat sheet (a tail): points (x, y, z) mirrored by the caller as needed."""
    b.begin()
    first = len(b.verts)
    for p in points:
        top, under = colour_of(p)
        b.vert(p, top, under, (0.0, 0.0, 0.0), 0.5)
    for t in tris:
        b.tris.append(tuple(first + i for i in t))
    b.end("sheet", name)


def mirrored(points):
    """Points given for x >= 0, plus their mirror images for the ones off the centre line.
    Returns (all points, index of each point's mirror)."""
    out = list(points)
    mirror = {}
    for i, (x, y, z) in enumerate(points):
        if abs(x) < 1e-9:
            mirror[i] = i
        else:
            mirror[i] = len(out)
            out.append((-x, y, z))
    return out, mirror


def tail_tris(right_tris, mirror):
    out = []
    for a, b, c in right_tris:
        out.append((a, b, c))
        out.append((mirror[a], mirror[c], mirror[b]))
    return out


# =================================================================================================
# THE HERRING GULL (Larus argentatus): 1.40 m span, 0.60 m long. White head, body and tail; a pale
# silver-grey mantle and upperwing with a white trailing edge; black wingtips with white mirrors;
# a white underwing whose primaries show dark at the tip; a yellow bill.
# =================================================================================================

GULL_PLUMAGE = {
    "white": lin("#eeeeec"),
    "body": lin("#e9e9e7"),
    "mantle": lin("#aab4bc"),
    "covert": lin("#b4bdc4"),
    "black": lin("#18181a"),
    "mirror": lin("#e6e6e4"),
    "underwing": lin("#e4e6e6"),
    "underFlight": lin("#cfd3d6"),
    "underTip": lin("#3a3a3d"),
    "bill": lin("#e8bd3c"),
    "billTip": lin("#d96a2a"),
}


def gull_body_colour(z, ca, sa):
    P = GULL_PLUMAGE
    # The grey mantle (back and scapulars) between the wings; white everywhere else.
    mantle = smooth(0.25, 0.65, sa) * smooth(-0.13, -0.08, z) * smooth(0.11, 0.06, z)
    return mix(P["body"], P["mantle"], mantle)


GULL = {
    "span": 1.40,
    "shoulder": (0.050, 0.022, 0.030),
    "wrist": (0.300, 0.022, 0.068),
    "armBand": (0.042, 0.120), "armBandTE": (0.042, 0.175),
    "handBand": (0.275, 0.325), "handBandTE": (0.190, 0.410),
    "tipBand": (0.500, 0.700),
    # |x|, leading edge z, trailing edge z: the wrist the forward-most point; the long narrow hand
    # sweeps back to a pointed tip.
    "planform": [
        (0.040, 0.070, -0.126), (0.100, 0.074, -0.120), (0.180, 0.078, -0.110), (0.250, 0.082, -0.100),
        (0.300, 0.085, -0.093), (0.360, 0.078, -0.088), (0.440, 0.058, -0.084), (0.520, 0.030, -0.083),
        (0.585, 0.000, -0.084), (0.640, -0.030, -0.087),
    ],
    "tip": (0.700, -0.080),
    "chord": [0.0, 0.25, 0.55, 0.82, 1.0],
    "camber": 0.035,
    "wingY": lambda s: 0.022 + 0.004 * (s / 0.7),
}


def gull_wing_colour(s, c):
    P = GULL_PLUMAGE
    # Above: grey coverts and flight feathers, a white trailing edge along the arm and inner hand,
    # the outer hand black with a white mirror near the tip.
    top = mix(P["covert"], P["mantle"], smooth(0.2, 0.6, c))
    top = mix(top, P["white"], smooth(0.80, 1.0, c) * smooth(0.56, 0.46, s) * 0.9)
    black = smooth(0.50, 0.575, s)
    top = mix(top, P["black"], black)
    mirror = smooth(0.61, 0.64, s) * smooth(0.69, 0.655, s) * smooth(0.3, 0.55, c)
    top = mix(top, P["mirror"], mirror * 0.95)
    # Below: white coverts, pale grey flight feathers, the black primaries' tips.
    under = mix(P["underwing"], P["underFlight"], smooth(0.35, 0.8, c))
    under = mix(under, P["underTip"], smooth(0.53, 0.60, s))
    under = mix(under, P["mirror"], mirror * 0.85)
    return top, under


def build_gull():
    b = Builder("gull")
    P = GULL_PLUMAGE
    # z, half width, top, bottom, centre height: the tail's base, the deep body, the breast, the
    # neck's waist, the rounded head, the face running into the bill.
    shell(b, "body", [
        (-0.150, 0.016, 0.013, 0.013, 0.012),
        (-0.105, 0.036, 0.030, 0.032, 0.008),
        (-0.040, 0.054, 0.045, 0.054, 0.002),
        (0.030, 0.058, 0.048, 0.058, 0.000),
        (0.092, 0.046, 0.044, 0.048, 0.006),
        (0.135, 0.029, 0.034, 0.032, 0.020),
        (0.178, 0.031, 0.036, 0.029, 0.028),
        (0.214, 0.017, 0.019, 0.016, 0.026),
    ], 8, gull_body_colour,
        tail=((0.0, 0.012, -0.160), P["white"]), nose=((0.0, 0.025, 0.222), P["white"]))
    cone(b, "bill", 0.205, (0.0, 0.019, 0.272), 0.024, 0.008, 0.009,
         lambda t: mix(P["bill"], P["billTip"], 0.4 * t))
    for side in (1, -1):
        build_wing(b, GULL, side, gull_wing_colour)
    # The tail: a short square white fan.
    pts, mirror = mirrored([(0.0, 0.014, -0.100), (0.030, 0.014, -0.100), (0.0, 0.012, -0.200),
                            (0.054, 0.012, -0.195), (0.0, 0.011, -0.232), (0.050, 0.011, -0.228)])
    build_sheet(b, "tail", pts, tail_tris([(0, 1, 3), (0, 3, 2), (2, 3, 5), (2, 5, 4)], mirror),
                lambda p: (P["white"], P["white"]))
    return b


# =================================================================================================
# THE BARN SWALLOW (Hirundo rustica): 0.33 m span, 0.18 m long with its streamers. Glossy steel
# blue-black above, a rust-red forehead and throat over a dark breast band, pale buff below; long
# swept wings; a deeply forked tail with long outer streamers.
# =================================================================================================

SWALLOW_PLUMAGE = {
    "back": lin("#1c2846"),
    "sheen": lin("#26386a"),
    "flight": lin("#1a1d2a"),
    "rust": lin("#8c3420"),
    "band": lin("#1e2640"),
    "belly": lin("#e3d2bf"),
    "underwing": lin("#b6aa98"),
    "underFlight": lin("#5d5852"),
    "tailUnder": lin("#3c3b44"),
    "bill": lin("#101012"),
}


def swallow_body_colour(z, ca, sa):
    P = SWALLOW_PLUMAGE
    back = mix(P["back"], P["sheen"], 0.5 * smooth(0.6, 1.0, sa) * smooth(-0.03, 0.0, z) * smooth(0.03, 0.0, z))
    # Underneath: the pale belly, the dark breast band, the rust throat; the rust forehead.
    under = mix(P["belly"], P["band"], smooth(0.012, 0.022, z))
    under = mix(under, P["rust"], smooth(0.030, 0.038, z))
    col = mix(under, back, smooth(-0.35, 0.15, sa))
    forehead = smooth(0.050, 0.058, z) * smooth(-0.6, 0.2, sa)
    return mix(col, P["rust"], forehead)


SWALLOW = {
    "span": 0.33,
    "shoulder": (0.010, 0.006, 0.014),
    "wrist": (0.042, 0.006, 0.022),
    "armBand": (0.008, 0.030), "armBandTE": (0.004, 0.044),
    "handBand": (0.036, 0.050), "handBandTE": (0.012, 0.068),
    "tipBand": (0.100, 0.165),
    # A short arm and a long sickle of a hand: the tip lies far behind the shoulder.
    "planform": [
        (0.008, 0.022, -0.020), (0.020, 0.025, -0.022), (0.032, 0.027, -0.022), (0.042, 0.028, -0.022),
        (0.060, 0.023, -0.024), (0.080, 0.013, -0.028), (0.100, 0.001, -0.033), (0.120, -0.013, -0.040),
        (0.140, -0.029, -0.048),
    ],
    "tip": (0.164, -0.064),
    "chord": [0.0, 0.35, 0.7, 1.0],
    "camber": 0.03,
    "wingY": lambda s: 0.006,
}


def swallow_wing_colour(s, c):
    P = SWALLOW_PLUMAGE
    top = mix(P["back"], P["flight"], smooth(0.25, 0.6, c) + smooth(0.05, 0.09, s))
    under = mix(P["underwing"], P["underFlight"], max(smooth(0.25, 0.6, c), smooth(0.045, 0.08, s)))
    return top, under


def build_swallow():
    b = Builder("swallow")
    P = SWALLOW_PLUMAGE
    shell(b, "body", [
        (-0.045, 0.006, 0.005, 0.006, 0.003),
        (-0.030, 0.011, 0.009, 0.011, 0.002),
        (-0.008, 0.0145, 0.012, 0.014, 0.000),
        (0.014, 0.0145, 0.012, 0.014, 0.001),
        (0.032, 0.0115, 0.011, 0.011, 0.003),
        (0.046, 0.0105, 0.010, 0.009, 0.005),
        (0.057, 0.0060, 0.006, 0.005, 0.004),
    ], 6, swallow_body_colour,
        tail=((0.0, 0.003, -0.050), P["back"]), nose=((0.0, 0.003, 0.068), P["bill"]))
    for side in (1, -1):
        build_wing(b, SWALLOW, side, swallow_wing_colour)
    # The forked tail: a notch at the centre, the outer feathers drawn out into long streamers.
    pts, mirror = mirrored([(0.0, 0.004, -0.030), (0.011, 0.004, -0.030), (0.0, 0.003, -0.060),
                            (0.018, 0.003, -0.057), (0.013, 0.003, -0.066), (0.022, 0.003, -0.072),
                            (0.027, 0.003, -0.127)])
    build_sheet(b, "tail", pts, tail_tris([(0, 1, 3), (0, 3, 2), (2, 3, 4), (3, 5, 4), (4, 5, 6)], mirror),
                lambda p: (P["back"], P["tailUnder"]))
    return b


# =================================================================================================
# THE GREYLAG GOOSE (Anser anser): 1.60 m span, 0.82 m long. Grey-brown, the back barred by pale
# feather edges, a paler breast and belly, white under the tail; the pale grey forewing against
# dark flight feathers, above and below; a long neck, a heavy body, an orange bill.
# =================================================================================================

GOOSE_PLUMAGE = {
    "head": lin("#857767"),
    "neck": lin("#7d6f60"),
    "mantle": lin("#6a5d50"),
    "fringe": lin("#a89a88"),
    "breast": lin("#968a7b"),
    "belly": lin("#bdb4a7"),
    "flank": lin("#73665a"),
    "white": lin("#ece8e1"),
    "rump": lin("#5c5249"),
    "tail": lin("#6a6158"),
    "forewing": lin("#a4aaa8"),
    "covert": lin("#867b6e"),
    "flight": lin("#3a3631"),
    "underwing": lin("#b2b3ae"),
    "underFlight": lin("#55514c"),
    "bill": lin("#e88a3a"),
    "nail": lin("#e7d8c4"),
}


def goose_body_colour(z, ca, sa):
    P = GOOSE_PLUMAGE
    # The barred back: alternate rings carry the pale feather edges (one bar a ring).
    bar = 1.0 if int(round((z + 0.30) / 0.065)) % 2 == 0 else 0.0
    back = mix(P["mantle"], P["fringe"], 0.42 * bar * smooth(0.12, -0.18, z))
    back = mix(back, P["rump"], smooth(-0.14, -0.20, z))
    # The flanks grey-brown, barred with pale edges too; the breast and the belly paler only
    # underneath, the vent white.
    flank = mix(P["flank"], P["fringe"], 0.3 * bar)
    under = mix(P["breast"], P["belly"], smooth(0.06, -0.08, z))
    under = mix(under, P["white"], smooth(-0.12, -0.20, z))
    side = mix(under, flank, smooth(-0.8, -0.35, sa))
    col = mix(side, back, smooth(0.15, 0.55, sa))
    return mix(col, P["neck"], smooth(0.11, 0.16, z))


def goose_neck_colour(z, ca, sa):
    P = GOOSE_PLUMAGE
    return mix(P["neck"], P["head"], smooth(0.30, 0.37, z))


GOOSE = {
    "span": 1.60,
    "shoulder": (0.072, 0.036, 0.050),
    "wrist": (0.372, 0.036, 0.118),
    "armBand": (0.064, 0.200), "armBandTE": (0.064, 0.255),
    "handBand": (0.345, 0.398), "handBandTE": (0.230, 0.500),
    "tipBand": (0.600, 0.790),
    # Long and broad, the carpal the forward-most point, the hand tapering to a blunt point.
    "planform": [
        (0.060, 0.106, -0.205), (0.140, 0.112, -0.200), (0.220, 0.118, -0.195), (0.300, 0.127, -0.184),
        (0.345, 0.133, -0.175), (0.398, 0.134, -0.166), (0.470, 0.122, -0.155), (0.560, 0.096, -0.147),
        (0.650, 0.051, -0.140), (0.720, 0.008, -0.132), (0.770, -0.030, -0.122),
    ],
    "tip": (0.800, -0.085),
    "chord": [0.0, 0.3, 0.62, 1.0],
    "camber": 0.04,
    "wingY": lambda s: 0.036 - 0.006 * (s / 0.8),
}


def goose_wing_colour(s, c):
    P = GOOSE_PLUMAGE
    # Above: the pale grey forewing (the lesser and median coverts, out over the hand's base),
    # grey-brown greater coverts edged pale, the dark flight feathers behind and at the hand.
    hand = smooth(0.36, 0.42, s)
    fore = mix(P["forewing"], P["covert"], smooth(0.25, 0.5, c) * (1 - hand * 0.6))
    top = mix(fore, P["flight"], smooth(0.55, 0.85, c) * (1 - hand) + hand * smooth(0.15, 0.45, c))
    top = mix(top, P["flight"], smooth(0.58, 0.70, s))
    # Below: pale grey coverts, dark flight feathers.
    under = mix(P["underwing"], P["underFlight"], max(smooth(0.3, 0.7, c), smooth(0.55, 0.68, s)))
    return top, under


def build_goose():
    b = Builder("goose")
    P = GOOSE_PLUMAGE
    shell(b, "body", [
        (-0.262, 0.027, 0.018, 0.018, 0.012),
        (-0.205, 0.060, 0.040, 0.048, 0.005),
        (-0.120, 0.088, 0.055, 0.078, -0.004),
        (-0.030, 0.102, 0.064, 0.096, -0.008),
        (0.050, 0.098, 0.066, 0.098, -0.008),
        (0.115, 0.072, 0.056, 0.079, -0.003),
        (0.160, 0.042, 0.042, 0.050, 0.001),
    ], 8, goose_body_colour,
        tail=((0.0, 0.012, -0.272), P["white"]), nose=((0.0, 0.002, 0.172), P["neck"]))
    shell(b, "neck", [
        (0.130, 0.040, 0.044, 0.050, 0.000),
        (0.215, 0.029, 0.032, 0.036, -0.002),
        (0.300, 0.0250, 0.029, 0.029, -0.005),
        (0.360, 0.0285, 0.036, 0.027, -0.005),
        (0.400, 0.0270, 0.034, 0.024, -0.006),
        (0.428, 0.0170, 0.020, 0.017, -0.009),
    ], 6, goose_neck_colour,
        tail=((0.0, 0.000, 0.120), P["neck"]), nose=((0.0, -0.010, 0.436), P["head"]), power=0.95)
    cone(b, "bill", 0.420, (0.0, -0.017, 0.498), -0.011, 0.012, 0.011,
         lambda t: mix(P["bill"], P["nail"], 0.3 * t))
    for side in (1, -1):
        build_wing(b, GOOSE, side, goose_wing_colour)
    # The tail: a short rounded fan, grey-brown with a white tip; white beneath.
    pts, mirror = mirrored([(0.0, 0.014, -0.200), (0.040, 0.014, -0.205), (0.0, 0.011, -0.300),
                            (0.062, 0.011, -0.285), (0.0, 0.010, -0.332), (0.044, 0.010, -0.322)])
    build_sheet(b, "tail", pts, tail_tris([(0, 1, 3), (0, 3, 2), (2, 3, 5), (2, 5, 4)], mirror),
                lambda p: (mix(P["tail"], P["white"], smooth(-0.31, -0.33, p[2])), P["white"]))
    return b


SPECS = {"gull": GULL, "swallow": SWALLOW, "goose": GOOSE}
BUILDERS = {"gull": build_gull, "swallow": build_swallow, "goose": build_goose}

# -- the wingbeat ---------------------------------------------------------------------------------
#
# A pose is five hinge angles (radians):
#   lift  the arm's elevation about the body's long axis (+ raises the wingtip)
#   sweep the arm swung back about the vertical (+ the tip goes back)
#   bend  the hand's elevation about the wrist, relative to the arm
#   fold  the hand swung back about the wrist
#   curl  the wingtip bent up (+), carried by the tip weight
#
# A beat at phase phi (0 the top of the stroke, pi the bottom): the arm's lift is L0 + LA cos phi,
# the hand's own elevation H0 + HA cos(phi - lag) (the outer wing lags the inner), the hand folds
# back on the upstroke and the tip curls up under the downstroke's load. A bird blends the beat
# with its glide pose by a weight (gull: a few slow beats now and then; swallow: bursts of fast
# beats with the wings swept back between; goose: steady deep beats, never a glide).

FLIGHT = {
    "gull": {
        "rate": 2.6,
        "glide": {"lift": 0.22, "sweep": 0.05, "bend": -0.42, "fold": 0.12, "curl": 0.06},
        "beat": {"lift": [0.10, 0.46], "hand": [-0.06, 0.58], "lag": 0.75, "fold": [0.06, 0.32],
                 "sweep": [0.03, 0.10], "curl": 0.14},
    },
    "swallow": {
        "rate": 6.5,
        "glide": {"lift": 0.06, "sweep": 0.34, "bend": -0.06, "fold": 0.44, "curl": 0.02},
        "beat": {"lift": [0.06, 0.58], "hand": [0.04, 0.64], "lag": 0.6, "fold": [0.14, 0.40],
                 "sweep": [0.04, 0.16], "curl": 0.10},
    },
    "goose": {
        "rate": 2.8,
        "glide": {"lift": 0.08, "sweep": 0.0, "bend": -0.06, "fold": 0.06, "curl": 0.03},
        "beat": {"lift": [0.06, 0.52], "hand": [0.0, 0.64], "lag": 0.75, "fold": [0.05, 0.28],
                 "sweep": [0.02, 0.07], "curl": 0.14},
    },
}


def wing_pose(kind, phi, weight):
    """The five hinge angles at beat phase `phi` blended with the glide pose by `weight` (0..1)."""
    f = FLIGHT[kind]
    g, k = f["glide"], f["beat"]
    up = max(0.0, -math.sin(phi)) ** 2
    lift = k["lift"][0] + k["lift"][1] * math.cos(phi)
    hand = k["hand"][0] + k["hand"][1] * math.cos(phi - k["lag"])
    beat = {
        "lift": lift,
        "sweep": k["sweep"][0] + k["sweep"][1] * up,
        "bend": hand - lift,
        "fold": k["fold"][0] + k["fold"][1] * up,
        "curl": k["curl"] * max(0.0, math.sin(phi)),
    }
    return {n: g[n] + (beat[n] - g[n]) * weight for n in g}


def _rot(a, b, ang):
    c, s = math.cos(ang), math.sin(ang)
    return a * c - b * s, a * s + b * c


def fold(spec, p, w, pose):
    """p: rest position (bird frame); w: (arm, hand, tip, ...); pose: hinge angles (rad)."""
    side = 1.0 if p[0] >= 0 else -1.0
    u, y, z = abs(p[0]), p[1], p[2]
    arm, hand, tip = w[0], w[1], w[2]
    wx, wy, wz = spec["wrist"]
    sx, sy, sz = spec["shoulder"]
    du, dy, dz = u - wx, y - wy, z - wz
    du, dz = _rot(du, dz, -pose["fold"] * hand)
    du, dy = _rot(du, dy, pose["bend"] * hand + pose["curl"] * tip)
    u, y, z = wx + du, wy + dy, wz + dz
    du, dy, dz = u - sx, y - sy, z - sz
    du, dz = _rot(du, dz, -pose["sweep"] * arm)
    du, dy = _rot(du, dy, pose["lift"] * arm)
    return (side * (sx + du), sy + dy, sz + dz)


PREVIEW_POSES = {
    "glide": (0.0, 0.0),
    "top": (0.0, 1.0),
    "down": (math.pi / 2, 1.0),
    "bottom": (math.pi, 1.0),
    "up": (3 * math.pi / 2, 1.0),
}


def stretch(b, spec, kind):
    """Worst edge stretch and squash over the beat (and the glide), against the rest pose."""
    edges = set()
    for t in b.tris:
        for i in range(3):
            a, c = t[i], t[(i + 1) % 3]
            edges.add((min(a, c), max(a, c)))
    rest = {e: math.dist(b.verts[e[0]], b.verts[e[1]]) for e in edges}
    worst_hi, worst_lo = 1.0, 1.0
    for k in range(24):
        for weight in (0.0, 0.5, 1.0):
            pose = wing_pose(kind, 2 * math.pi * k / 24, weight)
            moved = [fold(spec, v, w, pose) for v, w in zip(b.verts, b.hinge)]
            for e, r0 in rest.items():
                if r0 < 1e-6:
                    continue
                r = math.dist(moved[e[0]], moved[e[1]]) / r0
                worst_hi = max(worst_hi, r)
                worst_lo = min(worst_lo, r)
    return worst_hi, worst_lo


# -- the module the game imports ------------------------------------------------------------------


def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def record(kind, b, normals):
    spec = SPECS[kind]
    xs = [v[0] for v in b.verts]
    zs = [v[2] for v in b.verts]
    hi, lo = stretch(b, spec, kind)
    species = {"gull": "herring gull (Larus argentatus)", "swallow": "barn swallow (Hirundo rustica)",
               "goose": "greylag goose (Anser anser)"}[kind]
    return {
        "species": species,
        "span": round(max(xs) - min(xs), 4),
        "length": round(max(zs) - min(zs), 4),
        "vertexCount": len(b.verts),
        "triangleCount": len(b.tris),
        "shoulder": [round(c, 4) for c in spec["shoulder"]],
        "wrist": [round(c, 4) for c in spec["wrist"]],
        "flight": FLIGHT[kind],
        "stretch": [round(hi, 3), round(lo, 3)],
        "positions": b64("h", [int(round(c / QUANT)) for v in b.verts for c in v]),
        "normals": b64("b", [int(round(max(-1.0, min(1.0, c)) * 127)) for n in normals for c in n]),
        "index": b64("H", [i for t in b.tris for i in t]),
        "hinge": b64("B", [int(round(max(0.0, min(1.0, x)) * 255)) for h in b.hinge for x in h]),
        "top": b64("B", [x for c in b.top for x in srgb8(c)]),
        "under": b64("B", [x for c in b.under for x in srgb8(c)]),
    }


def write_module(path, built):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Odyssey's birds: GENERATED by scripts/blender/odyssey/odyssey_birds.py (do not edit by",
        " * hand). Modelled for the sizes they have in the game frame and folded by",
        " * composition/odyssey-bird-rig.js (the flights and the summit kettle draw them).",
        " *",
        " * Bird frame: metres, real size; x the bird's LEFT, y up, z forward. Per bird: `positions`",
        " * Int16 in units of `quant` metres; `normals` Int8 (/127); `index` Uint16 triangles; `hinge`",
        " * Uint8 (arm, hand, tip, thin feather) /255; `top` and `under` Uint8 sRGB plumage seen from",
        " * above and from below (a shell's are the same). `shoulder` and `wrist` are the hinges'",
        " * pivots; `flight` the wingbeat's numbers (see `wing_pose` in the script); `stretch` the",
        " * worst edge stretch and squash over the beat, as the script measured it.",
        " */",
        "export const ODYSSEY_BIRD_MODELS = Object.freeze({",
        f"    quant: {QUANT},",
    ]
    for kind, rec in built.items():
        lines.append(f"    {kind}: Object.freeze({{")
        for key, value in rec.items():
            if isinstance(value, str) and key not in ("species",):
                lines.append(f"        {key}: '{value}',")
            else:
                lines.append(f"        {key}: {json.dumps(value, separators=(', ', ': '))},")
        lines.append("    }),")
    lines += ["});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# -- Blender: objects, posed lineups and previews -------------------------------------------------


def to_blender(p):
    """Bird frame (x left, y up, z forward) -> Blender (x, -z, y): the bird faces -y, up +z."""
    return (p[0], -p[2], p[1])


def make_object(scene, name, b, verts, under=False):
    import bpy
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(v) for v in verts], [], [tuple(t) for t in b.tris])
    mesh.update()
    colour = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    source = b.under if under else b.top
    for i, c in enumerate(source):
        colour.data[i].color = (c[0], c[1], c[2], 1.0)
    mesh.color_attributes.active_color = colour
    mesh.color_attributes.render_color_index = 0
    mesh.shade_smooth()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def previews(built_meshes, out_dir):
    """Per bird, a sheet: poses down, views across (plumage), and the same at game size x8."""
    import bpy
    import numpy as np
    from mathutils import Vector

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.data.scenes.new(SCENE + "Preview")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.show_cavity = False
    scene.display.shading.show_backface_culling = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("sky")
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    views = {
        "top": Vector((0.0, 0.001, 1.0)), "below": Vector((0.0, 0.2, -1.0)),
        "front": Vector((0.0, -1.0, 0.08)), "side": Vector((1.0, 0.0, 0.06)),
        "threeq": Vector((0.6, -0.5, 0.45)), "threeqBelow": Vector((0.6, 0.45, -0.5)),
    }

    def shoot(vname, d, size, ortho, light):
        d = d.normalized()
        cam.location = d * 6
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = ortho
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.display.shading.light = light
        scene.display.shading.color_type = "VERTEX"
        scene.world.color = (0.42, 0.52, 0.62)
        path = out_dir / f"_tile-{vname}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(size[1], size[0], 4)
        bpy.data.images.remove(img)
        path.unlink()
        return px

    for kind, b in built_meshes.items():
        spec = SPECS[kind]
        ortho = spec["span"] * 1.15
        tiles = {}
        for pname, (phi, weight) in PREVIEW_POSES.items():
            pose = wing_pose(kind, phi, weight)
            verts = [fold(spec, v, w, pose) for v, w in zip(b.verts, b.hinge)]
            objs = [make_object(scene, f"{kind}-{pname}", b, verts),
                    make_object(scene, f"{kind}-{pname}-under", b, verts, under=True)]
            for vname, d in views.items():
                # The sheets' plumage from below is the "under" copy (Workbench has no per-face colour).
                below = d.z < 0
                objs[0].hide_render = below
                objs[1].hide_render = not below
                tiles[(pname, vname, "big")] = shoot(vname, d, (300, 200), ortho, "STUDIO")
                tiles[(pname, vname, "game")] = shoot(vname, d, (40, 27), ortho, "FLAT")
            for o in objs:
                mesh = o.data
                bpy.data.objects.remove(o, do_unlink=True)
                bpy.data.meshes.remove(mesh)
        pnames, vnames = list(PREVIEW_POSES), list(views)
        for mode, (tw, th), scale in (("big", (300, 200), 1), ("game", (40, 27), 6)):
            sheet = np.zeros((len(pnames) * th * scale, len(vnames) * tw * scale, 4), dtype=np.float32)
            for r, p in enumerate(pnames):
                for c, v in enumerate(vnames):
                    tile = tiles[(p, v, mode)]
                    if scale > 1:
                        tile = tile.repeat(scale, axis=0).repeat(scale, axis=1)
                    y0 = (len(pnames) - 1 - r) * th * scale  # Blender images are bottom-up
                    sheet[y0:y0 + th * scale, c * tw * scale:(c + 1) * tw * scale] = tile
            img = bpy.data.images.new(f"sheet-{kind}-{mode}", sheet.shape[1], sheet.shape[0], alpha=True)
            img.pixels[:] = sheet.ravel()
            img.filepath_raw = str(out_dir / f"{kind}-{mode}.png")
            img.file_format = "PNG"
            img.save()
        print(f"{TAG} {kind} previews: rows {pnames}, columns {vnames}")
    bpy.data.scenes.remove(scene)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {}
    for i, a in enumerate(argv):
        if a.startswith("--") and i + 1 < len(argv):
            opts[a[2:]] = argv[i + 1]
    built_meshes = {}
    records = {}
    for kind in ("gull", "swallow", "goose"):
        b = BUILDERS[kind]()
        b.orient()
        normals = b.normals()
        built_meshes[kind] = b
        records[kind] = record(kind, b, normals)
        rec = records[kind]
        print(f"{TAG} {kind}: {rec['triangleCount']} triangles, {rec['vertexCount']} vertices, "
              f"span {rec['span']} m, length {rec['length']} m, stretch {rec['stretch']}")
    try:
        import bpy
        scene = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
        for k, (kind, b) in enumerate(built_meshes.items()):
            obj = make_object(scene, f"odyssey-{kind}", b, b.verts)
            obj.location = (k * 2.0, 0.0, 0.0)
    except ImportError:
        pass
    if opts.get("out"):
        write_module(opts["out"], records)
        print(f"{TAG} wrote {opts['out']}")
    if opts.get("preview"):
        previews(built_meshes, opts["preview"])


if __name__ == "__main__":
    main()
