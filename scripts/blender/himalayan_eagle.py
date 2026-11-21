"""Himalayan Peak's golden eagle, authored procedurally in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/himalayan_eagle.py -- \
        --out src/themes/himalayan-peak/assets/eagle.glb [--preview <dir>]

A soaring adult golden eagle with layered coverts, overlapping secondaries, slotted primaries,
golden hackles and a barred tail. One skinned mesh serves distant thermals and near passes.
The GLB includes one wingbeat. In the theme it blends with a procedural glide and tail trim.
Each joint's local axes match the bird's (x left, y up, z forward).

Vertex colours are scene-linear RGB plumage; alpha marks thin feather (1) against body (0), which
the theme's shader lets the sun shine through when the bird is between the eye and the light.
Real size (2.1 m span); the theme scales it. Deterministic: the same script writes the same file.
"""

import math
import sys
from pathlib import Path

import bpy

TAG = "[himalayan-eagle]"

# ── Plumage (sRGB hex → linear) ───────────────────────────────────────────────


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PLUMAGE = {
    "body": lin("#563b2b"),
    "belly": lin("#614636"),
    "trousers": lin("#785b43"),
    "nape": lin("#c48c38"),
    "crown": lin("#9c7034"),
    "face": lin("#72523a"),
    "cere": lin("#d9a93a"),
    "bill": lin("#3a3c44"),
    "billTip": lin("#202126"),
    "covert": lin("#7a5a39"),      # the adult's pale tawny bar across the upper wing
    "wingUp": lin("#3a2b1f"),
    "flightUp": lin("#33291f"),
    "flightTip": lin("#1f1812"),
    "wingDown": lin("#664b37"),
    "flightDown": lin("#a28e78"),   # grey, faintly barred flight feathers under the wing
    "fingerUp": lin("#2a2019"),
    "fingerDown": lin("#88735f"),
    "tail": lin("#5a4b3e"),
    "tailUnder": lin("#98826c"),
    "tailBand": lin("#261d17"),
}


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def interp(points, s):
    """Piecewise-linear y(s) through sorted (s, y) points, smoothed by a cosine ease per span."""
    if s <= points[0][0]:
        return points[0][1]
    for (s0, y0), (s1, y1) in zip(points, points[1:]):
        if s <= s1:
            t = (s - s0) / (s1 - s0)
            t = 0.5 - 0.5 * math.cos(math.pi * t)
            return y0 + (y1 - y0) * t
    return points[-1][1]


# ── The mesh, built as plain lists in the bird's frame (x left, y up, z forward) ──

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.weights = []   # per vertex: {bone: weight}
        self.colours = []   # per vertex: (r, g, b, thin)
        self.vanes = []     # local feather coordinates (length, across the web); -1 isolates bare parts

    def vert(self, p, weights, colour, thin, vane=(-1, 0.5)):
        self.verts.append(tuple(p))
        total = sum(weights.values()) or 1.0
        self.weights.append({k: v / total for k, v in weights.items() if v > 1e-4})
        self.colours.append((colour[0], colour[1], colour[2], thin))
        self.vanes.append(vane)
        return len(self.verts) - 1

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


def chain(*pairs):
    """Weights along a chain of bones: pairs of (bone, blend into it 0..1)."""
    out = {}
    left = 1.0
    for idx, (bone, into_next) in enumerate(pairs):
        if idx == len(pairs) - 1:
            out[bone] = left
        else:
            out[bone] = left * (1 - into_next)
            left *= into_next
    return out


# ── Body ──────────────────────────────────────────────────────────────────────

# z, half width, top, bottom, centre height
BODY = [
    (0.252, 0.020, 0.020, 0.018, 0.031),
    (0.236, 0.031, 0.033, 0.028, 0.035),
    (0.208, 0.039, 0.042, 0.035, 0.037),
    (0.174, 0.038, 0.040, 0.036, 0.031),
    (0.138, 0.039, 0.040, 0.042, 0.019),
    (0.094, 0.058, 0.054, 0.063, 0.007),
    (0.045, 0.083, 0.068, 0.083, 0.0),
    (-0.020, 0.094, 0.071, 0.088, 0.0),
    (-0.090, 0.085, 0.064, 0.086, 0.0),
    (-0.155, 0.068, 0.050, 0.076, 0.0),
    (-0.210, 0.049, 0.034, 0.046, 0.006),
    (-0.255, 0.034, 0.020, 0.022, 0.010),
    (-0.285, 0.024, 0.012, 0.012, 0.012),
]
BODY_RING = 18


def body_weights(z):
    neck = smooth(0.075, 0.125, z)
    head = smooth(0.150, 0.190, z)
    tail = smooth(-0.200, -0.262, z)
    if tail > 0:
        return {"root": 1 - tail, "tail": tail}
    return chain(("root", neck), ("neck", head), ("head", 0))


def body_colour(z, up, side):
    """up: -1 belly .. 1 back; side: 0 centre .. 1 flank."""
    if z > 0.16:   # head
        c = mix(PLUMAGE["face"], PLUMAGE["crown"], smooth(-0.2, 0.6, up))
        return mix(c, PLUMAGE["nape"], smooth(0.2, 0.8, up) * smooth(0.225, 0.17, z))
    if z > 0.07:   # neck: the golden hackles over the back of it
        gold = smooth(-0.3, 0.5, up) * smooth(0.06, 0.15, z)
        return mix(PLUMAGE["body"], PLUMAGE["nape"], gold)
    if up < -0.2 and -0.19 < z < -0.07:
        return mix(PLUMAGE["belly"], PLUMAGE["trousers"], smooth(-0.3, -0.8, up))
    return mix(PLUMAGE["body"], PLUMAGE["belly"], smooth(0.0, -0.6, up))


def build_body(b):
    rings = []
    for z, wx, top, bottom, cy in BODY:
        ring = []
        for i in range(BODY_RING):
            a = 2 * math.pi * i / BODY_RING
            ca, sa = math.cos(a), math.sin(a)
            # A softened superellipse: fuller than an ellipse across the back.
            x = wx * math.copysign(abs(ca) ** 0.85, ca)
            y = cy + (top if sa > 0 else bottom) * math.copysign(abs(sa) ** 0.9, sa)
            ring.append(b.vert((x, y, z), body_weights(z), body_colour(z, sa, abs(ca)), 0.0))
        rings.append(ring)
    tail_end = b.vert((0, BODY[-1][4], BODY[-1][0] - 0.008), body_weights(-0.3), PLUMAGE["body"], 0.0)
    face = b.vert((0, BODY[0][4], BODY[0][0] + 0.004), body_weights(0.3), PLUMAGE["face"], 0.0)
    b.loft(rings, close_start=face, close_end=tail_end)
    return rings[0]


def build_bill(b, face_ring):
    # The bill grows out of the face ring: cere, then a heavy hook.
    sections = [
        (0.252, 0.017, 0.019, 0.031, "cere"),
        (0.268, 0.014, 0.016, 0.029, "cere"),
        (0.282, 0.011, 0.013, 0.024, "bill"),
        (0.293, 0.007, 0.010, 0.016, "bill"),
        (0.298, 0.004, 0.006, 0.007, "billTip"),
    ]
    n = 10
    rings = []
    for z, wx, h, cy, key in sections:
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            ring.append(b.vert((wx * math.cos(a), cy + h * math.sin(a), z), {"head": 1}, PLUMAGE[key], 0.0))
        rings.append(ring)
    tip = b.vert((0, -0.004, 0.294), {"head": 1}, PLUMAGE["billTip"], 0.0)
    b.loft(rings, close_end=tip)
    # Close the back of the bill against the face (it sits inside the head).
    back = b.vert((0, 0.031, 0.246), {"head": 1}, PLUMAGE["cere"], 0.0)
    b.loft([rings[0]], close_start=back)


# ── Wings ─────────────────────────────────────────────────────────────────────

# Semi-span s (m, from the body's midline), leading and trailing edge z.
LEADING = [(0.04, 0.080), (0.20, 0.112), (0.40, 0.133), (0.55, 0.146), (0.68, 0.132), (0.80, 0.100)]
TRAILING = [(0.04, -0.170), (0.13, -0.262), (0.28, -0.312), (0.44, -0.312), (0.55, -0.290),
            (0.66, -0.235), (0.80, -0.120)]
STATIONS = [0.04, 0.09, 0.15, 0.22, 0.29, 0.36, 0.43, 0.50, 0.56, 0.62, 0.68, 0.74, 0.79]
CHORD = [0.0, 0.035, 0.11, 0.26, 0.48, 0.72, 1.0]      # fractions along the chord, LE → TE
SHOULDER = (0.055, 0.035, 0.050)
ELBOW = (0.270, 0.034, 0.072)
WRIST = (0.550, 0.030, 0.100)


def wing_centre(s):
    return 0.035 - 0.008 * s


def thickness(s):
    return interp([(0.04, 0.15), (0.25, 0.11), (0.5, 0.075), (0.74, 0.05)], s)


def wing_weights(s):
    return chain(("root", smooth(0.045, 0.12, s)), ("arm", smooth(0.22, 0.32, s)),
                 ("fore", smooth(0.50, 0.60, s)), ("hand", 0))


def sided_weights(s, side):
    sfx = "L" if side > 0 else "R"
    return {(k + sfx if k != "root" else k): v for k, v in wing_weights(s).items()}


def wing_colour(s, x, upper):
    """x: chord fraction 0 LE .. 1 TE."""
    flight = smooth(0.42, 0.62, x)
    tip = smooth(0.82, 1.0, x)
    if upper:
        base = mix(PLUMAGE["wingUp"], PLUMAGE["covert"], smooth(0.10, 0.2, s) * smooth(0.55, 0.42, s)
                   * smooth(0.04, 0.12, x) * smooth(0.48, 0.34, x))
        return mix(mix(base, PLUMAGE["flightUp"], flight), PLUMAGE["flightTip"], tip)
    base = PLUMAGE["wingDown"]
    return mix(mix(base, PLUMAGE["flightDown"], flight), PLUMAGE["flightTip"], tip * 0.8)


def airfoil(c, t, x):
    """Camber line and half-thicknesses above and below it, as fractions of the chord."""
    camber = 0.055 * 4 * x * (1 - x)
    yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    yt *= 1 - smooth(0.55, 1.0, x) * 0.85  # the feathered back half is thin
    return camber * c, yt * c, yt * c * 0.35


def build_wing(b, side):
    """side = 1 left (+x), -1 right."""
    rings = []
    for s in STATIONS:
        le = interp(LEADING, s)
        te = interp(TRAILING, s)
        c = le - te
        cy = wing_centre(s)
        t = thickness(s)
        w = sided_weights(s, side)
        ring = []
        # Loop: LE, upper surface to TE, lower surface back toward the LE.
        order = [(x, True) for x in CHORD] + [(x, False) for x in reversed(CHORD[1:-1])]
        for x, upper in order:
            # The closed leading wing ends in the roots of the overlapping secondaries.
            x = x * (0.68 + 0.32 * smooth(0.56, 0.74, s))
            camber, up, down = airfoil(c, t, x)
            y = cy + camber + (up if upper else -down)
            z = le - x * c
            thin = smooth(0.40, 0.65, x)
            # On exposed mantle skin the small contour feathers continue the adjacent rows.
            ring.append(b.vert((side * s, y, z), w, wing_colour(s, x, upper), thin,
                               (2 + x, s * 24 - x * 0.58)))
        if side < 0:
            ring.reverse()
        rings.append(ring)
    # The ring order runs one way round on the left wing, so the loft's normals face out; the
    # right wing's mirrored rings are reversed above to keep them facing out too.
    root_cap = b.vert((side * STATIONS[0], wing_centre(0), -0.04), sided_weights(0.0, side), PLUMAGE["body"], 0.0)
    tip_cap = b.vert((side * (STATIONS[-1] + 0.01), wing_centre(0.75) + 0.004, -0.02),
                     sided_weights(0.75, side), PLUMAGE["flightUp"], 0.5)
    b.loft(rings, close_start=root_cap, close_end=tip_cap)


# The seven fingered primaries, leading (0) to trailing (6): angle back from the span axis
# (degrees) and length (m). Their roots lie on a line across the hand.
FINGERS = [(-3, 0.307), (0.5, 0.391), (5, 0.440), (12.5, 0.448), (17, 0.422), (26, 0.371), (34, 0.292)]
FINGER_ROOT_A = (0.600, 0.118)   # (s, z) of the leading finger's root, deep in the hand
FINGER_ROOT_B = (0.580, -0.150)  # and the trailing one's
FINGER_U = [0.0, 0.20, 0.42, 0.62, 0.80, 0.90, 0.95, 0.982, 0.996, 1.0]
FINGER_W = [0.080, 0.086, 0.085, 0.076, 0.058, 0.048, 0.039, 0.026, 0.014, 0.0]


def finger_root(j):
    f = j / (len(FINGERS) - 1)
    s = FINGER_ROOT_A[0] + (FINGER_ROOT_B[0] - FINGER_ROOT_A[0]) * f
    z = FINGER_ROOT_A[1] + (FINGER_ROOT_B[1] - FINGER_ROOT_A[1]) * f
    return s, z


def build_fingers(b, side):
    sfx = "L" if side > 0 else "R"
    for j, (deg, length) in enumerate(FINGERS):
        s0, z0 = finger_root(j)
        a = math.radians(deg)
        dx, dz = math.cos(a), -math.sin(a)        # along the feather (span-ward, then back)
        nx, nz = math.sin(a), math.cos(a)         # across it, toward the leading side
        y0 = wing_centre(s0) + 0.004 + 0.0025 * (j - 3)
        bone = f"f{j}{sfx}"
        rings = []
        for u, w in zip(FINGER_U[:-1], FINGER_W[:-1]):
            cx = s0 + dx * length * u
            cz = z0 + dz * length * u + 0.032 * math.sin(math.pi * u) * (0.5 + j * 0.09)
            cy = y0 + 0.016 * u * u
            t = 0.009 * (1 - u) + 0.003
            weights = {f"hand{sfx}": 1 - smooth(0.0, 0.3, u), bone: smooth(0.0, 0.3, u)}
            # The leading vane is narrow, the trailing one wide (as on a real primary).
            lead, trail = w * 0.32, w * 0.68
            tip_dark = smooth(0.6, 1.0, u)
            up = mix(PLUMAGE["fingerUp"], PLUMAGE["flightTip"], tip_dark)
            down = mix(PLUMAGE["fingerDown"], PLUMAGE["flightTip"], tip_dark * 0.8)
            shaft = mix(up, PLUMAGE["covert"], 0.30 * (1 - 0.7 * tip_dark))
            pts = [
                (cx + nx * lead, cy, cz + nz * lead, up),
                (cx + nx * w * 0.1, cy + t * 0.92, cz + nz * w * 0.1, up),
                (cx, cy + t, cz, shaft),
                (cx - nx * w * 0.11, cy + t * 0.86, cz - nz * w * 0.11, up),
                (cx - nx * trail, cy - 0.001, cz - nz * trail, up),
                (cx, cy - t * 0.5, cz, down),
            ]
            ring = [b.vert((side * px, py, pz), weights, col, 1.0, (u, across))
                    for (px, py, pz, col), across in zip(pts, (1.0, 0.66, 0.5, 0.41, 0.0, 0.5))]
            if side < 0:
                ring.reverse()
            rings.append(ring)
        tipx, tipz = s0 + dx * length, z0 + dz * length
        tip = b.vert((side * tipx, y0 + 0.016, tipz), {bone: 1}, PLUMAGE["flightTip"], 1.0, (1, 0.5))
        base = b.vert((side * (s0 - dx * 0.01), y0, z0 - dz * 0.01), {f"hand{sfx}": 1},
                      PLUMAGE["fingerUp"], 1.0, (0, 0.5))
        b.loft(rings, close_start=base, close_end=tip)

    # Primary coverts run with the hand, crossing the change in direction from the
    # forearm's secondaries. Their tips travel with the primary they cover as it flexes.
    for under in (False, True):
        for j, (angle, length) in enumerate(FINGERS):
            s0, z0 = finger_root(j)
            a = math.radians(angle + 4.5)
            dx, dz = math.cos(a), -math.sin(a)
            nx, nz = -dz, dx
            depth = -1 if under else 1
            colours = (PLUMAGE["wingDown"], PLUMAGE["fingerDown"]) if under else (PLUMAGE["wingUp"], PLUMAGE["covert"])
            col = mix(*colours, 0.17 + 0.11 * math.sin(j * 2.4 + 0.3))

            def covert(u, v, h):
                dist = -0.087 + (0.104 + length * (0.46 + 0.07 * math.cos(j))) * u
                s = s0 + dx * dist + nx * v
                z = z0 + dz * dist + nz * v
                le = interp(LEADING, s)
                chord = le - interp(TRAILING, s)
                camber, top, bottom = airfoil(chord, thickness(s), max(0, min(1, (le - z) / chord)))
                cy = wing_centre(s) + camber + (-bottom if under else top)
                feather_y = wing_centre(s0) + 0.004 + 0.0025 * (j - 3) + depth * 0.01
                hand = smooth(0.66, 0.85, s)
                cy += (feather_y - cy) * hand + depth * (-0.005 + 0.011 * smooth(0.05, 0.60, u) + h)
                finger = smooth(0.61, 0.85, s) * smooth(0.32, 0.90, u)
                weights = {k: w * (1 - finger) for k, w in sided_weights(s, side).items()}
                weights[f"f{j}{sfx}"] = finger
                edge = smooth(0.61, 1.0, u) * (0.12 if under else 0.18)
                return b.vert((side * s, cy, z), weights, mix(col, colours[1], edge), 0.36,
                              (max(0, u), 0.5 + v / 0.076))

            rings = []
            for u, width in [(0, 0.005), (0.26, 0.055), (0.62, 0.079), (0.86, 0.070), (0.97, 0.034)]:
                rings.append([covert(u, -width * 0.55, 0), covert(u, 0, 0.002),
                              covert(u, width * 0.45, -0.0008), covert(u, 0, -0.0015)])
            b.loft(rings, close_start=covert(-0.01, 0, 0), close_end=covert(1, 0, -0.001))


# A secondary is anchored along the forearm, reaches back toward the tail, and turns
# into a rounded scallop at the trailing edge. The smaller coverts tile its upper half.
def build_wing_layers(b, side):
    rows = (
        # count, first/last span station, root/tip chord fraction, width, relief, underside
        (15, 0.074, 0.681, 0.30, 1.015, 0.080, 0.0025, False),
        (16, 0.077, 0.720, 0.14, 0.73, 0.079, 0.0048, False),
        (17, 0.082, 0.741, 0.02, 0.49, 0.072, 0.0041, False),
        (17, 0.080, 0.710, 0.10, 0.62, 0.077, 0.0035, True),
    )
    profile = [(0.0, 0.06), (0.30, 0.72), (0.63, 1.0), (0.84, 0.94), (0.96, 0.61)]
    for row, (count, first, last, root, end, breadth, relief, under) in enumerate(rows):
        for j in range(count):
            origin = first + (last - first) * j / (count - 1)
            length = end + math.sin(j * 3.81 + row) * 0.017 - (0.12 if row else 0) * smooth(0.48, 0.73, origin)
            sweep = 0.165 * smooth(0.26, 0.71, origin) - 0.066
            # A broad warm shoulder merges into the dark hand; each vane has a pale outer edge.
            tawny = (1 - smooth(0.38, 0.71, origin)) * (0.31 if row == 1 else 0.12)
            upper = mix(PLUMAGE["wingUp"], PLUMAGE["covert"], tawny + 0.12 * (1 + math.sin(j * 1.9)))
            lower = PLUMAGE["flightDown"]
            if under:
                upper = mix(PLUMAGE["wingDown"], PLUMAGE["trousers"], 0.32 + 0.15 * math.cos(j * 2.3))

            def feather_vertex(u, across, height, colour):
                s = max(0.036, origin + sweep * u * (0.65 + 0.35 * u) + across)
                x = root + (length - root) * u - across * 1.10
                le = interp(LEADING, s)
                chord = le - interp(TRAILING, s)
                camber, top, bottom = airfoil(chord, thickness(s), min(1, max(0, x)))
                # Root and rachis emerge from the skin. Exposed pointed roots read as scales.
                emergence = smooth(0.24, 0.70 if row == 2 else 0.54, u)
                offset = -0.014 * (1 - emergence) + (relief + height) * emergence
                y = wing_centre(s) + camber + (-bottom - offset if under else top + offset)
                return b.vert((side * s, y, le - chord * x), sided_weights(s, side),
                              colour, 0.78 if row == 0 else 0.32,
                              (max(0, u), 0.5 + across / breadth))

            rings = []
            for u, width in profile:
                dark_bar = (0.35 + 0.31 * math.cos(u * 20 + origin * 6)) if row == 0 else 0
                vane = mix(upper, PLUMAGE["flightTip"], dark_bar)
                edge = mix(vane, PLUMAGE["covert"], 0.10 + 0.14 * u)
                shaft = mix(vane, PLUMAGE["covert"], 0.25)
                w = width * breadth
                ring = [feather_vertex(u, -0.46 * w, 0, edge),
                        feather_vertex(u, -0.05 * w, 0.0037, vane),
                        feather_vertex(u, 0, 0.0042, shaft),
                        feather_vertex(u, 0.09 * w, 0.0032, vane),
                        feather_vertex(u, 0.54 * w, -0.0015, vane)]
                underside = mix(lower, PLUMAGE["wingDown"], dark_bar)
                if row == 0:
                    ring.extend([feather_vertex(u, 0.40 * w, -0.0035, underside),
                                 feather_vertex(u, -0.32 * w, -0.0045, underside)])
                else:
                    ring.append(feather_vertex(u, 0, -0.005, underside))
                rings.append(ring)
            b.loft(rings, close_start=feather_vertex(-0.018, 0, 0, upper),
                   close_end=feather_vertex(1, 0.001, -0.002, edge))


def oval(b, centre, radii, bone, colour, segments=10):
    cx, cy, cz = centre
    rx, ry, rz = radii
    rings = []
    for fraction in (-0.83, -0.42, 0, 0.42, 0.83):
        r = math.sqrt(1 - fraction * fraction)
        rings.append([b.vert((cx + rx * math.cos(i * math.tau / segments) * r, cy + fraction * ry,
                              cz + rz * math.sin(i * math.tau / segments) * r), {bone: 1}, colour, 0)
                      for i in range(segments)])
    b.loft(rings, close_start=b.vert((cx, cy - ry, cz), {bone: 1}, colour, 0),
           close_end=b.vert((cx, cy + ry, cz), {bone: 1}, colour, 0))


def build_details(b):
    for side in (1, -1):
        # Supraorbital ridge, amber iris, pupil and the nares in the cere.
        for x, y, z, radii, key in [
            (0.034, 0.046, 0.218, (0.006, 0.009, 0.012), "face"),
            (0.039, 0.046, 0.218, (0.0028, 0.0065, 0.0068), "nape"),
            (0.041, 0.046, 0.219, (0.0019, 0.0042, 0.0045), "billTip"),
            (0.034, 0.054, 0.218, (0.008, 0.0042, 0.017), "crown"),
            (0.014, 0.034, 0.265, (0.0016, 0.0021, 0.004), "billTip"),
        ]:
            oval(b, (side * x, y, z), radii, "head", PLUMAGE[key])
        # Feathered tarsi lie close to the belly, toes curled back under them.
        oval(b, (side * 0.047, -0.061, -0.113), (0.031, 0.035, 0.081), "root", PLUMAGE["trousers"])
        for i in range(3):
            x = side * (0.041 + i * 0.006)
            oval(b, (x, -0.077, -0.184 + i * 0.002), (0.005, 0.006, 0.024), "root", PLUMAGE["crown"], 7)
            oval(b, (x, -0.072, -0.199 + i * 0.002), (0.0034, 0.006, 0.009), "root", PLUMAGE["billTip"], 6)

    # Pointed golden hackles laid over the nape. The tips part at the neck when the head turns.
    for row in range(3):
        for j in range(11):
            a = (j - 5) * 0.23 + (row % 2) * 0.10
            z = 0.202 - row * 0.030
            def surface(z_at, angle, raise_by, col):
                wx, top, cy = [interp(sorted((p[0], p[k]) for p in BODY), z_at) for k in (1, 2, 4)]
                x = math.copysign(abs(math.sin(angle)) ** 0.85, math.sin(angle)) * (wx + raise_by)
                y = cy + (top + raise_by) * math.cos(angle) ** 0.9
                return b.vert((x, y, z_at), body_weights(z_at), col, 0)
            gold = mix(PLUMAGE["crown"], PLUMAGE["nape"], 0.30 + 0.38 * (1 + math.sin(j * 2 + row)))
            base = surface(z, a, 0.001, PLUMAGE["crown"])
            l = surface(z - 0.018, a - 0.12, 0.0022, gold)
            r = surface(z - 0.018, a + 0.12, 0.0022, PLUMAGE["crown"])
            mid = surface(z - 0.021, a, 0.0046, gold)
            tip = surface(z - 0.047, a * 1.045, 0.004, PLUMAGE["nape"])
            b.faces.extend([(base, mid, l), (mid, tip, l), (base, r, mid), (mid, r, tip)])

    # Scapulars cloak the wing roots. Short breast feathers wrap round the breast rather
    # than sitting on a flat card; each follows the same skin weights as the torso below.
    sections = [sorted((p[0], p[k]) for p in BODY) for k in (1, 2, 3, 4)]
    for row in range(6):
        z = 0.113 - row * 0.046
        for j in range(16):
            a = (j + (row % 2) * 0.5) * math.tau / 16
            if abs(math.sin(a)) > 0.90 and row < 3:
                continue
            base_col = PLUMAGE["belly"] if math.cos(a) < 0 else PLUMAGE["body"]
            tip_col = mix(base_col, PLUMAGE["covert"], 0.09 + 0.08 * (1 + math.sin(j * 2.8 + row)))
            def shell(z_at, angle, h, col):
                wx, top, bottom, cy = [interp(section, z_at) for section in sections]
                ca, sa = math.cos(angle), math.sin(angle)
                x = math.copysign(abs(sa) ** 0.85, sa) * (wx + h)
                y = cy + math.copysign(abs(ca) ** 0.90, ca) * ((top if ca > 0 else bottom) + h)
                return b.vert((x, y, z_at), body_weights(z_at), col, 0)
            base = shell(z, a, -0.003, base_col)
            l = shell(z - 0.035, a - 0.20, 0.0009, base_col)
            r = shell(z - 0.035, a + 0.20, 0.0009, base_col)
            mid = shell(z - 0.040, a, 0.0023, tip_col)
            tip = shell(z - 0.067 - 0.006 * math.sin(j), a, 0.002, tip_col)
            b.faces.extend([(base, mid, l), (mid, tip, l), (base, r, mid), (mid, r, tip)])

TAIL_FEATHERS = 12
TAIL_SPREAD = math.radians(15)    # half the fan's opening at rest; the rig opens it further
TAIL_BASE = (0.0, 0.013, -0.235)
TAIL_U = [0.0, 0.25, 0.36, 0.49, 0.62, 0.74, 0.85, 0.94, 0.977, 0.994, 1.0]


def build_tail(b):
    for k in range(TAIL_FEATHERS):
        f = k / (TAIL_FEATHERS - 1) * 2 - 1        # -1 right .. 1 left
        phi = f * TAIL_SPREAD
        length = 0.335 - 0.058 * f * f + 0.007 * math.sin(k * 2.13)               # gently rounded
        dx, dz = math.sin(phi), -math.cos(phi)
        nx, nz = math.cos(phi), math.sin(phi)
        x0 = TAIL_BASE[0] + f * 0.022
        y0 = TAIL_BASE[1] - 0.0008 * abs(k - 5.5)    # the outer feathers lie under the centre ones
        side = abs(f)
        bone = "tailL" if f > 0 else "tailR"
        rings = []
        for u in TAIL_U[:-1]:
            cx, cz = x0 + dx * length * u, TAIL_BASE[2] + dz * length * u
            w = (0.058 - 0.009 * u) * math.sqrt(max(0, 1 - smooth(0.925, 1, u)))
            t = 0.006 * (1 - u) + 0.002
            band = max(0.82 * smooth(0.76 + 0.07 * f * f, 0.91, u), 0.57 * (0.5 + 0.5 * math.cos(37 * u + abs(f))))
            up = mix(PLUMAGE["tail"], PLUMAGE["tailBand"], band)
            down = mix(PLUMAGE["tailUnder"], PLUMAGE["tailBand"], band * 0.85)
            weights = {"tail": 1 - side, bone: side}
            pts = [
                (cx + nx * w / 2, y0, cz + nz * w / 2, up),
                (cx, y0 + t, cz, up),
                (cx - nx * w / 2, y0, cz - nz * w / 2, up),
                (cx, y0 - t, cz, down),
            ]
            rings.append([b.vert((px, py, pz), weights, col, 1.0) for px, py, pz, col in pts])
        # A round tip: two extra points short of the end, then the end.
        cx, cz = x0 + dx * length, TAIL_BASE[2] + dz * length
        tip = b.vert((cx, y0, cz), {"tail": 1 - side, bone: side}, PLUMAGE["tailBand"], 1.0)
        base = b.vert((x0 - dx * 0.01, y0, TAIL_BASE[2] - dz * 0.01), {"tail": 1}, PLUMAGE["tail"], 1.0)
        b.loft(rings, close_start=base, close_end=tip)


# ── Skeleton (bird frame) ─────────────────────────────────────────────────────

def skeleton():
    bones = [
        ("root", None, (0.0, 0.020, -0.020)),
        ("neck", "root", (0.0, 0.020, 0.100)),
        ("head", "neck", (0.0, 0.035, 0.175)),
        ("tail", "root", TAIL_BASE),
        ("tailL", "tail", TAIL_BASE),
        ("tailR", "tail", TAIL_BASE),
    ]
    for side, sfx in ((1, "L"), (-1, "R")):
        bones.append((f"arm{sfx}", "root", (side * SHOULDER[0], SHOULDER[1], SHOULDER[2])))
        bones.append((f"fore{sfx}", f"arm{sfx}", (side * ELBOW[0], ELBOW[1], ELBOW[2])))
        bones.append((f"hand{sfx}", f"fore{sfx}", (side * WRIST[0], WRIST[1], WRIST[2])))
        for j in range(len(FINGERS)):
            s, z = finger_root(j)
            bones.append((f"f{j}{sfx}", f"hand{sfx}", (side * s, wing_centre(s) + 0.004, z)))
    return bones


# ── Blender ───────────────────────────────────────────────────────────────────

def to_blender(p):
    """Bird frame (x left, y up, z forward) → Blender (x, -z, y); glTF export maps it back."""
    return (p[0], -p[2], p[1])


def build_scene(builder, bones, empty=True):
    if empty:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    arm_data = bpy.data.armatures.new("EagleRig")
    arm = bpy.data.objects.new("EagleRig", arm_data)
    scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head in bones:
        eb = arm_data.edit_bones.new(name)
        h = to_blender(head)
        eb.head = h
        eb.tail = (h[0], h[1], h[2] + 0.03)   # every bone points up: identity rest rotation
        eb.roll = 0.0
        if parent:
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")

    mesh = bpy.data.meshes.new("Eagle")
    mesh.from_pydata([to_blender(v) for v in builder.verts], [], builder.faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new("Eagle", mesh)
    scene.collection.objects.link(obj)

    colour = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(builder.colours):
        colour.data[i].color = c
    mesh.color_attributes.active_color = colour

    vane_uv = mesh.uv_layers.new(name="Feather")
    for loop in mesh.loops:
        along, across = builder.vanes[loop.vertex_index]
        vane_uv.data[loop.index].uv = (along, 1 - across)

    groups = {name: obj.vertex_groups.new(name=name) for name, _, _ in bones}
    for i, weights in enumerate(builder.weights):
        for bone, w in weights.items():
            groups[bone].add([i], w, "REPLACE")

    # Every part is a closed shell: let Blender face each one outward.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh.shade_smooth()
    mesh.set_sharp_from_angle(angle=math.radians(62))

    obj.parent = arm
    mod = obj.modifiers.new("Rig", "ARMATURE")
    mod.object = arm
    return arm, obj


def export(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        use_active_scene=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_optimize_animation_keep_anim_armature=False,
        export_morph=False,
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_rest_position_armature=True,
        export_def_bones=False,
        export_leaf_bone=False,
        export_extras=False,
    )


def pose(arm, angles):
    """angles: {bone: (x, y, z) degrees} about the bird's own axes (bone frames are the rig's)."""
    from mathutils import Euler
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
    for name, (x, y, z) in angles.items():
        # Bone local axes: x = bird x, y = bird y (up), z = bird z (forward).
        arm.pose.bones[name].rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ")
    bpy.context.view_layer.update()


def soar_pose(dihedral=7, curl=10, spread=14):
    # A turn about +y swings a feather that points back (−z) toward −x: the left half opens
    # with a negative turn.
    angles = {"tailL": (0, -spread, 0), "tailR": (0, spread, 0)}
    for sfx, sign in (("L", 1), ("R", -1)):
        angles[f"arm{sfx}"] = (0, 0, sign * dihedral)
        angles[f"hand{sfx}"] = (0, 0, sign * -2)
        for j in range(len(FINGERS)):
            angles[f"f{j}{sfx}"] = (0, sign * (j - 3) * 1.5, sign * curl * (0.6 + 0.1 * j))
    return angles


def flap_pose(beat):
    """beat: 1 = top of the upstroke, -1 = bottom of the downstroke."""
    angles = {"tailL": (0, -10, 0), "tailR": (0, 10, 0)}
    up = max(beat, 0)
    for sfx, sign in (("L", 1), ("R", -1)):
        angles[f"arm{sfx}"] = (0, sign * -12 * up, sign * 38 * beat)
        angles[f"fore{sfx}"] = (0, sign * -20 * up, sign * 6 * beat)
        angles[f"hand{sfx}"] = (-14 * up, sign * 26 * up, sign * 14 * beat)
        for j in range(len(FINGERS)):
            angles[f"f{j}{sfx}"] = (0, sign * -(j - 3) * 2 * up, sign * (8 - 10 * beat) * 0.7)
    return angles


def animate(arm):
    """One fully articulated power stroke. The theme samples it only during a bout."""
    scene = bpy.context.scene
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 0, 24
    def height(p):
        p %= 1
        return math.cos(math.pi * p / 0.44) if p < 0.44 else -math.cos(math.pi * (p - 0.44) / 0.56)
    for frame in range(25):
        p = frame / 24
        recovery = math.sin(math.pi * max(0, p - 0.44) / 0.56) ** 2
        push = math.sin(math.pi * min(p, 0.44) / 0.44)
        angles = {}
        for sfx, sign in (("L", 1), ("R", -1)):
            angles[f"arm{sfx}"] = (0, sign * (-5 * push + 13 * recovery), sign * (4 + 38 * height(p)))
            angles[f"fore{sfx}"] = (0, sign * 15 * recovery, sign * (-3 + 7 * height(p - 0.045)))
            angles[f"hand{sfx}"] = (7 * push - 17 * recovery, sign * (26 * recovery - 4),
                                    sign * (17 * height(p - 0.10)))
            for j in range(len(FINGERS)):
                lag = p - 0.10 - j * 0.006
                angles[f"f{j}{sfx}"] = (recovery * (j - 2), sign * (j - 3) * (1.2 + 1.9 * recovery),
                                        sign * ((8 + j * 0.9) * push - 5 * height(lag)))
        pose(arm, angles)
        for name in angles:
            arm.pose.bones[name].keyframe_insert(data_path="rotation_euler", frame=frame, group=name)
    arm.animation_data.action.name = "Ridge Wingbeat"
    scene.frame_set(0)


def previews(arm, obj, out_dir):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_cavity = False
    scene.world = bpy.data.worlds.new("sky")
    scene.world.color = (0.62, 0.68, 0.78)
    scene.render.resolution_x = 520
    scene.render.resolution_y = 360
    scene.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.4
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    from mathutils import Vector
    # Blender frame: the bird faces −y. Straight up and down views lean a hair so "up" is defined.
    views = {
        "top": Vector((0, 0.001, 1)), "below": Vector((0, 0.001, -1)), "front": Vector((0, -1, 0.0001)),
        "side": Vector((1, 0, 0)), "threeq": Vector((0.6, -0.55, 0.35)), "under": Vector((-0.5, 0.6, -0.5)),
    }
    poses = {"bind": {}, "soar": soar_pose(), "up": flap_pose(1), "down": flap_pose(-1)}
    out_dir.mkdir(parents=True, exist_ok=True)
    for pname, angles in poses.items():
        pose(arm, angles)
        for vname, d in views.items():
            d = d.normalized()
            cam.location = d * 4
            # The camera looks down its −z with its y up.
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = str(out_dir / f"{pname}-{vname}.png")
            bpy.ops.render.render(write_still=True)
    pose(arm, {})


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
    out = Path(opts.get("out", "src/themes/himalayan-peak/assets/eagle.glb"))

    b = Builder()
    face_ring = build_body(b)
    build_bill(b, face_ring)
    build_details(b)
    for side in (1, -1):
        build_wing(b, side)
        build_wing_layers(b, side)
        build_fingers(b, side)
    build_tail(b)
    bones = skeleton()
    arm, obj = build_scene(b, bones)
    tris = sum(len(f) - 2 for f in b.faces)
    print(f"{TAG} {len(b.verts)} vertices, {tris} triangles, {len(bones)} bones")
    if opts.get("preview"):
        previews(arm, obj, Path(opts["preview"]))
    animate(arm)
    export(out)
    print(f"{TAG} wrote {out}")


main()
