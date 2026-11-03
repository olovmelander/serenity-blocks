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
        self.tail = []     # per vertex: how much the tail's spread and twist move it (0 root .. 1 tip)
        self.parts = []    # (first vertex, end vertex, first tri, end tri, "shell" | "sheet", name)

    def begin(self):
        self._part = (len(self.verts), len(self.tris))

    def end(self, kind, name):
        v0, t0 = self._part
        self.parts.append((v0, len(self.verts), t0, len(self.tris), kind, name))

    def vert(self, p, top, under=None, hinge=(0.0, 0.0, 0.0), thin=0.0, tail=0.0):
        self.verts.append(tuple(float(v) for v in p))
        self.hinge.append((hinge[0], hinge[1], hinge[2], thin))
        self.tail.append(float(tail))
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
    last = rows[-1]
    if spec.get("fingers"):
        # Splayed primaries (a soaring bird's slotted hand): from each pair of neighbouring chord
        # points of the last station a broad finger runs out to its own rounded tip. Neighbouring
        # fingers share their edge out to a seam point (`fingerSeam` of the way along), so they
        # touch there, with no slot; only beyond it does each narrow to a rounded tip, opening a
        # short, narrow slot as a griffon's outer primaries do. (Thin bars with open gaps all the
        # way in read as a black comb at 40-80 px: 2026-11-01 evening.)
        tips = spec["fingers"]
        n = len(tips)
        seam_at = spec["fingerSeam"]
        along, width = spec["fingerShoulder"]  # where the rounded tip begins, and its width there
        runs = []
        for j, (fs, fz) in enumerate(tips):
            a, e = b.verts[last[j]], b.verts[last[j + 1]]
            base = [(a[k] + e[k]) / 2 for k in range(3)]
            runs.append([side * fs - base[0], spec["wingY"](fs) - base[1], fz - base[2]])
        seams = []
        for k in range(n + 1):
            near = [runs[max(0, k - 1)], runs[min(n - 1, k)]]
            run = [(near[0][i] + near[1][i]) / 2 for i in range(3)]
            p0 = b.verts[last[k]]
            point = [p0[i] + run[i] * seam_at for i in range(3)]
            c = k / n
            top, under = colour_of(abs(point[0]), c)
            seams.append(b.vert(point, top, under, wing_weights(spec, abs(point[0]), c), 1.0))
        for j, (fs, fz) in enumerate(tips):
            c = (j + 0.5) / n
            top, under = colour_of(fs, c)
            a, e = b.verts[last[j]], b.verts[last[j + 1]]
            half = [(a[k] - e[k]) / 2 for k in range(3)]  # base centre -> the leading-edge side
            centre = [(a[k] + e[k]) / 2 + runs[j][k] * along for k in range(3)]
            w = wing_weights(spec, abs(centre[0]), c)
            lead = b.vert([centre[k] + half[k] * width for k in range(3)], top, under, w, 1.0)
            trail = b.vert([centre[k] - half[k] * width for k in range(3)], top, under, w, 1.0)
            tip = b.vert((side * fs, spec["wingY"](fs), fz), top, under, wing_weights(spec, fs, c), 1.0)
            b.quad(last[j], seams[j], seams[j + 1], last[j + 1])
            b.quad(seams[j], lead, trail, seams[j + 1])
            b.tris.append((lead, tip, trail))
    else:
        ts, tz = spec["tip"]
        top, under = colour_of(ts, 0.5)
        tip = b.vert((side * ts, spec["wingY"](ts), tz), top, under, wing_weights(spec, ts, 0.5), 1.0)
        for j in range(len(chord) - 1):
            b.tris.append((last[j], tip, last[j + 1]))
    b.end("sheet", f"wing{'L' if side > 0 else 'R'}")


def build_sheet(b, name, points, tris, colour_of, tail_of=None):
    """A small flat sheet (a tail): points (x, y, z) mirrored by the caller as needed. `tail_of(p)`
    is how much the tail's spread and twist carry the point (0 at its root .. 1 at its tip)."""
    b.begin()
    first = len(b.verts)
    for p in points:
        top, under = colour_of(p)
        b.vert(p, top, under, (0.0, 0.0, 0.0), 0.5, tail_of(p) if tail_of else 0.0)
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
    "tailY": 0.012,
}


def gull_wing_colour(s, c):
    P = GULL_PLUMAGE
    # Above: grey coverts and flight feathers, a white trailing edge along the arm and inner hand,
    # the outer hand black with a white mirror near the tip.
    top = mix(P["covert"], P["mantle"], smooth(0.2, 0.6, c))
    top = mix(top, P["white"], smooth(0.80, 1.0, c) * smooth(0.56, 0.46, s) * 0.9)
    # The black hand, the herring gull's mark at range (2026-11-03: begun a little further in, so
    # it still shows at 20-30 px).
    black = smooth(0.47, 0.55, s)
    top = mix(top, P["black"], black)
    mirror = smooth(0.61, 0.64, s) * smooth(0.69, 0.655, s) * smooth(0.3, 0.55, c)
    top = mix(top, P["mirror"], mirror * 0.95)
    # Below: white coverts, pale grey flight feathers, the black primaries' tips.
    under = mix(P["underwing"], P["underFlight"], smooth(0.35, 0.8, c))
    under = mix(under, P["underTip"], smooth(0.50, 0.58, s))
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
                lambda p: (P["white"], P["white"]), lambda p: smooth(0.10, 0.232, -p[2]))
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
    "tailY": 0.003,
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
                lambda p: (P["back"], P["tailUnder"]), lambda p: smooth(0.030, 0.110, -p[2]))
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
    "tailY": 0.011,
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
                lambda p: (mix(P["tail"], P["white"], smooth(-0.31, -0.33, p[2])), P["white"]),
                lambda p: smooth(0.20, 0.332, -p[2]))
    return b


# =================================================================================================
# THE GRIFFON VULTURE (Gyps fulvus): 2.60 m span, 1.0 m long - the summit kettle (chapter 5,
# composition/odyssey-summit-birds.js), 18-80 px across in the game frame. Long, broad, almost
# rectangular wings ending in six splayed primaries, a short square tail, a small pale head on a
# pale ruff. Sandy brown body and coverts against blackish flight feathers and tail; from below,
# a pale bar along the underwing coverts.
# =================================================================================================

VULTURE_PLUMAGE = {
    "body": lin("#9c7a55"),
    "under": lin("#866444"),
    "ruff": lin("#e2d8c6"),
    "head": lin("#d2cbbf"),
    "bill": lin("#5f5a55"),
    "covert": lin("#a88560"),
    "greater": lin("#8a6a4a"),
    "flight": lin("#2a231e"),
    "tail": lin("#2e2722"),
    "underCovert": lin("#7c5f43"),
    "underBar": lin("#c1a57f"),
    "underFlight": lin("#3a322c"),
}


def vulture_body_colour(z, ca, sa):
    P = VULTURE_PLUMAGE
    col = mix(P["under"], P["body"], smooth(-0.3, 0.4, sa))
    # The pale ruff round the neck's base.
    return mix(col, P["ruff"], smooth(0.20, 0.25, z))


def vulture_head_colour(z, ca, sa):
    P = VULTURE_PLUMAGE
    return mix(P["ruff"], P["head"], smooth(0.30, 0.36, z))


VULTURE = {
    "span": 2.60,
    "shoulder": (0.110, 0.010, 0.200),
    "wrist": (0.550, 0.010, 0.240),
    "armBand": (0.100, 0.260), "armBandTE": (0.080, 0.380),
    "handBand": (0.520, 0.600), "handBandTE": (0.380, 0.760),
    "tipBand": (0.860, 1.300),
    # Broad and nearly square to the wrist, the hand tapering a little to the slotted tip.
    "planform": [
        (0.100, 0.200, -0.420), (0.250, 0.220, -0.440), (0.400, 0.232, -0.442), (0.550, 0.240, -0.425),
        (0.700, 0.205, -0.385), (0.850, 0.150, -0.345), (0.960, 0.098, -0.305), (1.060, 0.058, -0.270),
    ],
    # Six fingers, leading edge to trailing edge: the middle ones the longest, fanned a little.
    "fingers": [(1.170, 0.050), (1.245, -0.008), (1.290, -0.072), (1.300, -0.140), (1.270, -0.205),
                (1.210, -0.268)],
    # Neighbouring fingers touch out to 45 % of their length; each rounded tip begins at 80 %,
    # 72 % as wide as the finger's base.
    "fingerSeam": 0.45,
    "fingerShoulder": (0.80, 0.72),
    "chord": [0.0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1.0],
    "camber": 0.03,
    "wingY": lambda s: 0.010,
    "tailY": 0.004,
}


def vulture_wing_colour(s, c):
    P = VULTURE_PLUMAGE
    hand = smooth(0.60, 0.78, s)
    # Above: sandy coverts over the front half, a darker row of greater coverts, the blackish
    # flight feathers behind and over the whole outer hand.
    top = mix(P["covert"], P["greater"], smooth(0.30, 0.45, c))
    top = mix(top, P["flight"], max(smooth(0.48, 0.62, c), hand))
    # Below: brown coverts with the pale bar, dark flight feathers.
    under = mix(P["underCovert"], P["underBar"], smooth(0.12, 0.25, c) * smooth(0.48, 0.36, c) * (1 - hand))
    under = mix(under, P["underFlight"], max(smooth(0.45, 0.58, c), hand))
    return top, under


def build_vulture():
    b = Builder("vulture")
    P = VULTURE_PLUMAGE
    shell(b, "body", [
        (-0.300, 0.040, 0.030, 0.030, 0.000),
        (-0.180, 0.100, 0.070, 0.090, 0.000),
        (-0.020, 0.140, 0.090, 0.120, -0.010),
        (0.120, 0.130, 0.090, 0.120, -0.010),
        (0.215, 0.090, 0.080, 0.090, 0.000),
        (0.265, 0.075, 0.075, 0.072, 0.012),
    ], 8, vulture_body_colour,
        tail=((0.0, 0.0, -0.315), P["body"]), nose=((0.0, 0.015, 0.285), P["ruff"]))
    shell(b, "head", [
        (0.255, 0.050, 0.050, 0.045, 0.020),
        (0.320, 0.040, 0.042, 0.038, 0.022),
        (0.375, 0.046, 0.048, 0.040, 0.028),
        (0.425, 0.030, 0.030, 0.026, 0.024),
    ], 6, vulture_head_colour,
        tail=((0.0, 0.020, 0.245), P["ruff"]), nose=((0.0, 0.022, 0.440), P["head"]), power=0.95)
    cone(b, "bill", 0.420, (0.0, 0.002, 0.500), 0.020, 0.014, 0.016, lambda t: P["bill"])
    for side in (1, -1):
        build_wing(b, VULTURE, side, vulture_wing_colour)
    # The tail: short, square, dark.
    pts, mirror = mirrored([(0.0, 0.004, -0.220), (0.080, 0.004, -0.220), (0.0, 0.004, -0.420),
                            (0.120, 0.004, -0.410), (0.0, 0.004, -0.500), (0.125, 0.004, -0.490)])
    build_sheet(b, "tail", pts, tail_tris([(0, 1, 3), (0, 3, 2), (2, 3, 5), (2, 5, 4)], mirror),
                lambda p: (P["tail"], P["tail"]), lambda p: smooth(0.22, 0.50, -p[2]))
    return b


SPECS = {"gull": GULL, "swallow": SWALLOW, "goose": GOOSE, "vulture": VULTURE}
BUILDERS = {"gull": build_gull, "swallow": build_swallow, "goose": build_goose, "vulture": build_vulture}

# -- the wingbeat: keyframed in Blender ------------------------------------------------------------
#
# A pose is five hinge angles (radians):
#   lift  the arm's elevation about the body's long axis (+ raises the wingtip)
#   sweep the arm swung back about the vertical (+ the tip goes back)
#   bend  the hand's elevation about the wrist, relative to the arm
#   fold  the hand swung back about the wrist
#   curl  the wingtip bent up (+), carried by the tip weight
# and the body's heave (metres, + up) against the beat.
#
# THE BEAT (2026-11-03) is a keyframed action per bird: each channel's keys over one beat (u in
# beats, 0 the top of the stroke), Bezier with auto-clamped handles on a cyclic F-curve (a Cycles
# modifier, so the ease runs through the seam). What the keys say, for every bird:
#   - the downstroke (0 .. `down` of the beat) is a little quicker than the upstroke, and the wing
#     sweeps it fully spread and a little forward, so the tip travels fast and far;
#   - after the bottom the wrist flexes: the hand folds back and trails low while the arm rises,
#     then reaches out again before the top, so the tip comes back up on a shorter path, behind:
#     seen from the side it draws a loop, not a pendulum's line;
#   - the hand lags the arm through the stroke; the tip bends up under the downstroke's load and
#     trails a little below on the way up;
#   - the body rises while the wings beat down and sinks while they come up (highest just after
#     the bottom of the stroke).
# The script samples the curves Blender evaluates and fits them with a short Fourier series
# (`HARMONICS` terms): smooth at every order, periodic, and cheap in the vertex stage. The game,
# the tests and these previews all evaluate the same coefficients (odyssey-bird-beats.js).

CHANNELS = ("lift", "sweep", "bend", "fold", "curl", "heave")
HARMONICS = 5
EAGLE_HARMONICS = 7
SAMPLES_PER_BEAT = 192

BEATS = {
    # Herring gull: slow, elastic, deep strokes; mostly it glides on bowed wings.
    "gull": {"rate": 2.6, "down": 0.42, "keys": {
        "lift": [(0.0, 0.58), (0.42, -0.38)],
        "bend": [(0.0, 0.06), (0.128, 0.14), (0.42, 0.02), (0.527, -0.16), (0.699, -0.48), (0.871, -0.22)],
        "fold": [(0.0, 0.10), (0.274, 0.03), (0.42, 0.06), (0.592, 0.34), (0.742, 0.40), (0.914, 0.20)],
        "sweep": [(0.0, 0.06), (0.219, -0.06), (0.42, 0.0), (0.678, 0.15)],
        "curl": [(0.037, 0.02), (0.201, 0.16), (0.383, 0.08), (0.592, -0.06), (0.85, -0.02)],
        "heave": [(0.055, -0.012), (0.527, 0.012)],
    }},
    # Barn swallow: quick, strong beats in bursts; the hand folds hard on the upstroke.
    "swallow": {"rate": 6.5, "down": 0.4, "keys": {
        "lift": [(0.0, 0.64), (0.4, -0.52)],
        "bend": [(0.0, 0.06), (0.124, 0.16), (0.4, 0.02), (0.509, -0.18), (0.673, -0.42), (0.869, -0.16)],
        "fold": [(0.0, 0.16), (0.249, 0.08), (0.4, 0.14), (0.564, 0.50), (0.716, 0.58), (0.913, 0.30)],
        "sweep": [(0.0, 0.10), (0.213, 0.0), (0.4, 0.04), (0.651, 0.24)],
        "curl": [(0.036, 0.02), (0.196, 0.12), (0.356, 0.06), (0.564, -0.04), (0.836, -0.01)],
        "heave": [(0.044, -0.004), (0.509, 0.004)],
    }},
    # Greylag goose: steady, deep, unbroken beats.
    "goose": {"rate": 2.8, "down": 0.44, "keys": {
        "lift": [(0.0, 0.54), (0.44, -0.46)],
        "bend": [(0.0, 0.04), (0.147, 0.12), (0.44, 0.0), (0.548, -0.14), (0.72, -0.38), (0.892, -0.14)],
        "fold": [(0.0, 0.08), (0.293, 0.04), (0.44, 0.06), (0.612, 0.26), (0.763, 0.30), (0.925, 0.16)],
        "sweep": [(0.0, 0.04), (0.229, -0.04), (0.44, 0.0), (0.698, 0.09)],
        "curl": [(0.046, 0.02), (0.22, 0.16), (0.403, 0.08), (0.612, -0.04), (0.871, -0.01)],
        "heave": [(0.055, -0.014), (0.537, 0.014)],
    }},
    # Griffon vulture: a rare, slow, heavy beat; the fingers bend up hard under it.
    "vulture": {"rate": 1.3, "down": 0.44, "keys": {
        "lift": [(0.0, 0.48), (0.44, -0.30)],
        "bend": [(0.0, 0.06), (0.147, 0.14), (0.44, 0.0), (0.548, -0.10), (0.72, -0.28), (0.892, -0.08)],
        "fold": [(0.0, 0.02), (0.33, 0.0), (0.462, 0.03), (0.655, 0.13), (0.785, 0.15), (0.935, 0.06)],
        "sweep": [(0.0, 0.02), (0.229, -0.03), (0.44, 0.0), (0.698, 0.05)],
        "curl": [(0.046, 0.14), (0.22, 0.28), (0.422, 0.20), (0.612, 0.04), (0.849, 0.08)],
        "heave": [(0.055, -0.02), (0.537, 0.02)],
    }},
}
# The golden eagle (composition/odyssey-eagle-flight.js poses its 26 joints in code): the shapes
# its joints are driven by, over one beat. height 1 at the top .. -1 at the bottom; fold 0..1 the
# hand swept back on the upstroke; push 0..1 the downstroke's drive (fingers bent up, hand twisted).
EAGLE_BEAT = {"rate": 1.6, "down": 0.44, "keys": {
    "height": [(0.0, 1.0), (0.44, -1.0)],
    "fold": [(0.0, 0.0), (0.383, 0.0), (0.481, 0.10), (0.627, 0.78), (0.751, 1.0), (0.896, 0.36)],
    "push": [(0.0, 0.0), (0.067, 0.12), (0.21, 1.0), (0.363, 0.40), (0.481, 0.0), (0.896, 0.0)],
}}
# The glide poses (no beat), held between beats.
GLIDE = {
    "gull": {"lift": 0.22, "sweep": 0.05, "bend": -0.42, "fold": 0.12, "curl": 0.06},
    "swallow": {"lift": 0.06, "sweep": 0.34, "bend": -0.06, "fold": 0.44, "curl": 0.02},
    "vulture": {"lift": 0.10, "sweep": 0.02, "bend": 0.05, "fold": 0.02, "curl": 0.12},
    "goose": {"lift": 0.08, "sweep": 0.0, "bend": -0.06, "fold": 0.06, "curl": 0.03},
}
# The tail's spread (x widened by 1 + spread at its tip) and twist (radians about the long axis at
# its tip) the game asks for at most (odyssey-flights.js, odyssey-summit-birds.js).
TAIL_LIMITS = {"spread": 0.34, "twist": 0.30}

CYCLES = {}       # kind -> {channel: coefficients}, filled by author_beats()
EAGLE_CYCLE = {}  # channel -> coefficients
FIT_ERROR = {}    # kind -> {channel: worst |key curve - series| over the beat}


def fourier_fit(values, harmonics):
    """[a0, a1, b1, a2, b2, ...] of a periodic sampled curve."""
    n = len(values)
    out = [sum(values) / n]
    for k in range(1, harmonics + 1):
        a = 2 / n * sum(v * math.cos(2 * math.pi * k * j / n) for j, v in enumerate(values))
        b = 2 / n * sum(v * math.sin(2 * math.pi * k * j / n) for j, v in enumerate(values))
        out += [a, b]
    return out


def fourier(coef, phi):
    """The series at phase `phi` (radians; 0 the top of the stroke)."""
    v = coef[0]
    for k in range(1, (len(coef) - 1) // 2 + 1):
        v += coef[2 * k - 1] * math.cos(k * phi) + coef[2 * k] * math.sin(k * phi)
    return v


def author_beats(scene=None):
    """Key each bird's beat in Blender (one Empty per bird, its channels as keyed custom
    properties on cyclic Bezier F-curves), sample what Blender evaluates and fit the series."""
    import bpy
    from bpy_extras import anim_utils
    scene = scene or bpy.context.scene
    frames = 48  # frames per beat in the actions (the review .blend's Graph Editor)

    def keyed(name, spec, location):
        ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, None)
        if ob.name not in scene.collection.objects:
            scene.collection.objects.link(ob)
        ob.location = location
        ob.empty_display_size = 0.2
        ob.animation_data_clear()
        for ch, keys in spec["keys"].items():
            # One beat's keys, closed one beat after the first (the cycle's seam).
            for u, v in list(keys) + [(keys[0][0] + 1.0, keys[0][1])]:
                ob[ch] = v
                ob.keyframe_insert(f'["{ch}"]', frame=u * frames)
        act = ob.animation_data.action
        act.name = f"{name}-beat"
        bag = anim_utils.action_get_channelbag_for_slot(act, ob.animation_data.action_slot)
        curves = {}
        for ch in spec["keys"]:
            fc = bag.fcurves.find(f'["{ch}"]')
            fc.modifiers.new("CYCLES")
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"
            fc.update()
            curves[ch] = fc
        return curves

    def sample(fc):
        return [fc.evaluate(frames * j / SAMPLES_PER_BEAT) for j in range(SAMPLES_PER_BEAT)]

    for i, (kind, spec) in enumerate(BEATS.items()):
        curves = keyed(f"beat-{kind}", spec, (i * 0.6 - 1.0, 0.0, -2.0))
        CYCLES[kind] = {}
        FIT_ERROR[kind] = {}
        for ch in CHANNELS:
            values = sample(curves[ch])
            coef = fourier_fit(values, HARMONICS)
            CYCLES[kind][ch] = coef
            FIT_ERROR[kind][ch] = max(abs(fourier(coef, 2 * math.pi * j / len(values)) - v)
                                      for j, v in enumerate(values))
    curves = keyed("beat-eagle", EAGLE_BEAT, (1.4, 0.0, -2.0))
    FIT_ERROR["eagle"] = {}
    for ch in EAGLE_BEAT["keys"]:
        values = sample(curves[ch])
        EAGLE_CYCLE[ch] = fourier_fit(values, EAGLE_HARMONICS)
        FIT_ERROR["eagle"][ch] = max(abs(fourier(EAGLE_CYCLE[ch], 2 * math.pi * j / len(values)) - v)
                                     for j, v in enumerate(values))
    return CYCLES


def wing_pose(kind, phi, weight):
    """The hinge angles (and heave) at beat phase `phi` blended with the glide pose by `weight`."""
    g = GLIDE[kind]
    out = {n: g[n] + (fourier(CYCLES[kind][n], phi) - g[n]) * weight for n in g}
    out["heave"] = fourier(CYCLES[kind]["heave"], phi) * weight
    return out


def tail_pose(spec, p, tail, spread, twist):
    """The tail fanned (x widened toward its tip) and twisted about the body's long axis."""
    if tail <= 0.0:
        return p
    x = p[0] * (1.0 + spread * tail)
    y0 = spec["tailY"]
    dy = p[1] - y0
    a = twist * tail
    c, s = math.cos(a), math.sin(a)
    return (x * c - dy * s, y0 + x * s + dy * c, p[2])


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
    """Worst edge stretch and squash over the beat, the glide and the tail's fan and twist,
    against the rest pose."""
    edges = set()
    for t in b.tris:
        for i in range(3):
            a, c = t[i], t[(i + 1) % 3]
            edges.add((min(a, c), max(a, c)))
    rest = {e: math.dist(b.verts[e[0]], b.verts[e[1]]) for e in edges}
    worst_hi, worst_lo = 1.0, 1.0
    tails = ((0.0, 0.0), (TAIL_LIMITS["spread"], TAIL_LIMITS["twist"]),
             (TAIL_LIMITS["spread"], -TAIL_LIMITS["twist"]))
    for k in range(24):
        for weight in (0.0, 0.5, 1.0):
            pose = wing_pose(kind, 2 * math.pi * k / 24, weight)
            for spread, twist in (tails if k % 6 == 0 else tails[:1]):
                moved = [fold(spec, tail_pose(spec, v, tl, spread, twist), w, pose)
                         for v, w, tl in zip(b.verts, b.hinge, b.tail)]
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
               "goose": "greylag goose (Anser anser)", "vulture": "griffon vulture (Gyps fulvus)"}[kind]
    return {
        "species": species,
        "span": round(max(xs) - min(xs), 4),
        "length": round(max(zs) - min(zs), 4),
        "vertexCount": len(b.verts),
        "triangleCount": len(b.tris),
        "shoulder": [round(c, 4) for c in spec["shoulder"]],
        "wrist": [round(c, 4) for c in spec["wrist"]],
        "tailY": spec["tailY"],
        "stretch": [round(hi, 3), round(lo, 3)],
        "positions": b64("h", [int(round(c / QUANT)) for v in b.verts for c in v]),
        "normals": b64("b", [int(round(max(-1.0, min(1.0, c)) * 127)) for n in normals for c in n]),
        "index": b64("H", [i for t in b.tris for i in t]),
        "hinge": b64("B", [int(round(max(0.0, min(1.0, x)) * 255)) for h in b.hinge for x in h]),
        "top": b64("B", [x for c in b.top for x in srgb8(c)]),
        "under": b64("B", [x for c in b.under for x in srgb8(c)]),
        "tail": b64("B", [int(round(max(0.0, min(1.0, x)) * 255)) for x in b.tail]),
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
        " * above and from below (a shell's are the same); `tail` Uint8 /255 how much the tail's fan",
        " * and twist carry a point. `shoulder` and `wrist` are the hinges' pivots, `tailY` the tail's",
        " * root height; `stretch` the worst edge stretch and squash over the beat, the glide and the",
        " * tail's fan and twist, as the script measured it. The wingbeat: odyssey-bird-beats.js.",
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


def r6(x):
    return round(x, 6) + 0.0


def write_beats_module(path):
    """The wingbeats the game folds the wings by (author_beats must have run)."""
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Odyssey's birds' wingbeats: GENERATED by scripts/blender/odyssey/odyssey_birds.py (do not",
        " * edit by hand). Each beat was keyframed in Blender (cyclic Bezier F-curves, auto-clamped",
        " * handles: see BEATS in the script) and fitted with a short Fourier series, so it is smooth",
        " * at every order and runs through its seam. A channel at beat phase phi (radians, 0 the top of",
        " * the stroke) is c[0] + sum over k of c[2k-1] cos(k phi) + c[2k] sin(k phi).",
        " *",
        " * Per bird: `rate` beats a second, `down` the share of the beat the downstroke takes, `glide`",
        " * the held pose between beats, `cycle` the channels (lift, sweep, bend, fold, curl: radians,",
        " * as odyssey-bird-rig.js folds them; heave: metres the body rises), `fit` the worst gap",
        " * between Blender's curve and the series. `eagle`: the shapes the eagle's joints follow",
        " * (odyssey-eagle-flight.js): height 1 top .. -1 bottom, fold and push 0..1.",
        " */",
        "export const ODYSSEY_BIRD_BEATS = Object.freeze({",
        f"    harmonics: {HARMONICS},",
        f"    channels: Object.freeze({json.dumps(list(CHANNELS))}),",
    ]
    for kind, spec in BEATS.items():
        lines.append(f"    {kind}: Object.freeze({{")
        lines.append(f"        rate: {spec['rate']},")
        lines.append(f"        down: {spec['down']},")
        lines.append(f"        glide: Object.freeze({json.dumps(GLIDE[kind], separators=(', ', ': '))}),")
        lines.append("        cycle: Object.freeze({")
        for ch in CHANNELS:
            lines.append(f"            {ch}: Object.freeze({json.dumps([r6(c) for c in CYCLES[kind][ch]], separators=(', ', ': '))}),")
        lines.append("        }),")
        fit = {ch: round(FIT_ERROR[kind][ch], 4) for ch in CHANNELS}
        lines.append(f"        fit: Object.freeze({json.dumps(fit, separators=(', ', ': '))}),")
        lines.append("    }),")
    lines.append("    eagle: Object.freeze({")
    lines.append(f"        harmonics: {EAGLE_HARMONICS},")
    lines.append(f"        down: {EAGLE_BEAT['down']},")
    lines.append("        cycle: Object.freeze({")
    for ch in EAGLE_BEAT["keys"]:
        lines.append(f"            {ch}: Object.freeze({json.dumps([r6(c) for c in EAGLE_CYCLE[ch]], separators=(', ', ': '))}),")
    lines.append("        }),")
    fit = {ch: round(FIT_ERROR["eagle"][ch], 4) for ch in EAGLE_BEAT["keys"]}
    lines.append(f"        fit: Object.freeze({json.dumps(fit, separators=(', ', ': '))}),")
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
        "behindBelow": Vector((0.25, 0.9, -0.45)),
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
                tiles[(pname, vname, "game")] = shoot(vname, d, (64, 43), ortho, "FLAT")
            for o in objs:
                mesh = o.data
                bpy.data.objects.remove(o, do_unlink=True)
                bpy.data.meshes.remove(mesh)
        pnames, vnames = list(PREVIEW_POSES), list(views)
        for mode, (tw, th), scale in (("big", (300, 200), 1), ("game", (64, 43), 4)):
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
    author_beats()
    for kind, fit in FIT_ERROR.items():
        print(f"{TAG} {kind} beat: worst fit " + ", ".join(f"{ch} {e:.4f}" for ch, e in fit.items()))
    for kind in ("gull", "swallow", "goose", "vulture"):
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
        beats = opts.get("beats") or str(Path(opts["out"]).parent / "odyssey-bird-beats.js")
        write_beats_module(beats)
        print(f"{TAG} wrote {beats}")
    if opts.get("preview"):
        previews(built_meshes, opts["preview"])


if __name__ == "__main__":
    main()
