"""Nimbus Veil's albatross, modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/nimbus_veil_albatross.py -- \
        --out src/themes/nimbus-veil [--preview <dir>]

It writes ONE generated module, src/themes/nimbus-veil/nimbus-veil-albatross-model.js (no .glb and
no file to load), holding the bird as the flight over the cloud sea sees it:

  very long, narrow wings (three metres from tip to tip and a quarter of a metre wide) that come
  to a point, held all but straight with the hands a little lowered; a stout white body; a round
  head with a dark brow through the eye and a long bill, hooked at its end; a short tail. White
  below and on the head, the back and the rump; the wings slate above, joined by a dark saddle
  across the back; the underwing white with a dark margin, broad along its leading edge and at the
  tip; the tail grey; the bill straw yellow with a rose tip.

On screen a far bird is 30 to 60 px from wingtip to wingtip and a near one up to 220 px, so the
shape is built for its silhouette at the small size and for few triangles: the head, the bill and
the tail are a little stouter than life. Game frame, metres, real size: x the bird's LEFT, y up,
z forward, the shoulders near the origin.

No skeleton. Each vertex carries four shares the theme's vertex stage reads (`rig`):

  arm    how much of the shoulder's turn the vertex takes (0 on the body, 1 past the hinge band)
  hand   how much of the wrist's turn the outer wing takes
  tail   how much of the tail's fan and twist the vertex takes (0 at its root, 1 at its tip)
  shade  how open the vertex is to the sky (the belly between the wings is a little darker)

and a colour (`colours`: linear r, g, b and `thin`, how much sun a feather lets through).

The two wing hinges are lines along the body (z) through `SHOULDER` and `WRIST` (|x|, y); the bands
they take hold over are eased, and wider at the trailing edge (which lies far behind the hinge).
The tail fans about the body's axis (its vertices move out sideways) and twists about it through
`TAIL` (z of its root, y of the axis). `pose()` below is the vertex stage's twin; the module
carries a few vertices as it poses them (`checks`), so the theme's tests hold its own twin to this
file, and `stretch()` holds every authored pose to no torn or bunched edge.

Blender does the mesh work: the rings are joined into quads, triangulated and given their smooth
normals there, and `--preview` renders orthographic lineups (Workbench) of the bird gliding,
banking and beating, each also at game size (the bird 30, 50 and 90 px across, enlarged eight
times) against the sky and against the cloud.

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

TAG = "[nimbus-veil-albatross]"
SCENE = "NimbusVeilAlbatross"
MODULE = "nimbus-veil-albatross-model.js"


# ── Small maths ──────────────────────────────────────────────────────────────

def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


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


PLUMAGE = {
    "white": lin("#f2efe8"),        # the head, the breast, the belly, the rump
    "cream": lin("#ece4d2"),        # the nape and the flanks: a shade warmer
    "slate": lin("#33353e"),        # the wings from above
    "saddle": lin("#3b3d46"),       # the back between them: a shade greyer
    "edge": lin("#24252c"),         # the wing's leading edge and its tip
    "lining": lin("#efece6"),       # the underwing
    "margin": lin("#2b2c33"),       # the underwing's dark border
    "tail": lin("#4a4c56"),         # the tail from above
    "undertail": lin("#8f9099"),
    "brow": lin("#3a3a40"),         # the smudge through the eye
    "bill": lin("#e2b673"),
    "billtip": lin("#d88a66"),
}

PARTS = ["body", "head", "bill", "wing", "tail"]


# ── The mesh, built as plain lists in the game frame ──────────────────────────

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.colours = []   # per vertex: (r, g, b, thin)
        self.rig = []       # per vertex: (arm, hand, tail, shade)
        self.parts = []     # per vertex: index into PARTS

    def vert(self, p, colour, part, thin=0.0, arm=0.0, hand=0.0, tail=0.0, shade=1.0):
        self.verts.append(tuple(float(v) for v in p))
        self.colours.append((colour[0], colour[1], colour[2], thin))
        self.rig.append((arm, hand, tail, shade))
        self.parts.append(PARTS.index(part))
        return len(self.verts) - 1

    def mark(self):
        return len(self.faces)

    def loft(self, rings, close_start=None, close_end=None, skip=()):
        """Join rings of equal length into a tube (not across the pairs in `skip`); close_*: a vertex to fan an end to."""
        n = len(rings[0])
        pairs = [(i, (i + 1) % n) for i in range(n) if i not in skip]
        for a, b in zip(rings, rings[1:]):
            for i, j in pairs:
                self.faces.append((a[i], a[j], b[j], b[i]))
        if close_start is not None:
            r = rings[0]
            for i, j in pairs:
                self.faces.append((close_start, r[j], r[i]))
        if close_end is not None:
            r = rings[-1]
            for i, j in pairs:
                self.faces.append((close_end, r[i], r[j]))

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

    def facing(self, face, direction):
        """Add one face, wound so it faces `direction`."""
        p = [Vector(self.verts[i]) for i in face]
        n = (p[1] - p[0]).cross(p[2] - p[0])
        self.faces.append(tuple(face) if n.dot(Vector(direction)) >= 0 else tuple(reversed(face)))


# The body, the neck and the head in one spindle, from the tail's root forward: z, half width, top
# over and bottom under the centre, the centre's height, the part, and what the back, the upper
# flanks, the lower flanks and the underside wear. A dark saddle crosses the back between the
# wings; the rump and everything forward of the shoulders is white; the brow runs through the eye.
W, C, S, B = "white", "cream", "saddle", "brow"
BODY = [
    (-0.330, 0.052, 0.030, 0.036, 0.012, "body", W, W, W, W),
    (-0.240, 0.086, 0.060, 0.070, 0.008, "body", W, W, W, W),
    (-0.130, 0.108, 0.086, 0.100, 0.004, "body", S, C, W, W),
    (-0.010, 0.118, 0.098, 0.112, 0.000, "body", S, S, W, W),
    (0.100, 0.114, 0.094, 0.106, -0.002, "body", S, C, W, W),
    (0.190, 0.094, 0.080, 0.086, -0.002, "body", C, W, W, W),
    (0.255, 0.068, 0.062, 0.062, 0.004, "body", W, W, W, W),
    (0.310, 0.060, 0.060, 0.054, 0.012, "head", W, W, W, W),
    (0.360, 0.062, 0.062, 0.052, 0.016, "head", W, B, W, W),
    (0.405, 0.046, 0.042, 0.040, 0.010, "head", W, B, W, W),
    (0.438, 0.026, 0.022, 0.026, 0.002, "bill", "bill", "bill", "bill", "bill"),
    (0.520, 0.019, 0.016, 0.020, -0.006, "bill", "bill", "bill", "bill", "bill"),
]
# The bill ends in a hook: its tip lies under the line of the bill.
BILL_TIP = (0.585, -0.034)
BODY_RING = 8


def build_body(b):
    first = b.mark()
    rings = []
    for z, wx, top, bottom, cy, part, on_back, on_shoulder, on_flank, below in BODY:
        row = []
        for i in range(BODY_RING):
            a = math.pi / 2 + 2 * math.pi * i / BODY_RING
            ca, sa = math.cos(a), math.sin(a)
            x = wx * math.copysign(abs(ca) ** 0.7, ca)
            y = cy + (top if sa >= 0 else bottom) * math.copysign(abs(sa) ** 0.85, sa)
            wear = on_back if sa > 0.75 else (below if sa < -0.75 else (on_shoulder if sa > 0 else on_flank))
            # The belly between the wings is a little shaded (the wings stand over it).
            shade = 0.86 + 0.14 * smooth(-0.6, 0.3, sa)
            row.append(b.vert((x, y, z), PLUMAGE[wear], part, shade=shade))
        rings.append(row)
    rump = b.vert((0.0, BODY[0][4], BODY[0][0] - 0.03), PLUMAGE["white"], "body")
    tip = b.vert((0.0, BILL_TIP[1], BILL_TIP[0]), PLUMAGE["billtip"], "bill")
    b.loft(rings, close_start=rump, close_end=tip)
    centres = sorted((row[0], row[4]) for row in BODY)
    b.orient(first, lambda c: (0.0, interp(centres, c.z), c.z))


# ── The tail ─────────────────────────────────────────────────────────────────

# Short and a little rounded: one flat plate, a face above and a face below (their own vertices, so
# each keeps its normal). Rows down its length: z, half width, the centre's lift over the edges.
TAIL = (-0.310, 0.014)   # z of the root (where the fan and the twist begin), y of the axis
TAIL_ROWS = [
    (-0.310, 0.062, 0.010),
    (-0.400, 0.098, 0.012),
    (-0.490, 0.110, 0.010),
    (-0.550, 0.078, 0.006),
]
TAIL_TIP = -0.585
# How far a full fan (fan = 1) spreads the tail's edge beyond the modelled half fan: x times (1 + gain).
FAN_GAIN = 0.6


def build_tail(b):
    length = TAIL[0] - TAIL_TIP
    for up in (1.0, -1.0):
        colour = PLUMAGE["tail"] if up > 0 else PLUMAGE["undertail"]
        rows = []
        for z, wx, lift in TAIL_ROWS:
            along = (TAIL[0] - z) / length
            share = smooth(0.0, 0.8, along)
            row = []
            for side in (1.0, 0.0, -1.0):
                y = TAIL[1] + (lift if side == 0.0 else 0.0) + 0.002 * up
                # The root is the rump's white, the rest the tail's grey.
                tone = mix(PLUMAGE["white"], colour, smooth(0.0, 0.3, along))
                row.append(b.vert((side * wx, y, z), tone, "tail", thin=0.6, tail=share,
                                  shade=1.0 if up > 0 else 0.94))
            rows.append(row)
        tip = b.vert((0.0, TAIL[1] + 0.002 * up, TAIL_TIP), colour, "tail", thin=0.8, tail=1.0,
                     shade=1.0 if up > 0 else 0.94)
        for a, c in zip(rows, rows[1:]):
            for k in (0, 1):
                b.facing((a[k], a[k + 1], c[k + 1], c[k]), (0.0, up, 0.0))
        last = rows[-1]
        for k in (0, 1):
            b.facing((last[k], last[k + 1], tip), (0.0, up, 0.0))


# ── The wings ─────────────────────────────────────────────────────────────────

SPAN = 3.10
# The two hinges, lines along z: the shoulder and the wrist (|x|, y).
SHOULDER = (0.105, 0.046)
WRIST = (0.930, 0.046)
WING_Y = 0.046
# Stations along the span (|x|, m), three in each hinge's band so the wing bends instead of creasing.
STATIONS = [0.080, 0.150, 0.250, 0.420, 0.620, 0.790, 0.880, 0.930, 0.990, 1.090, 1.230, 1.370, 1.480, 1.535]
# Long and narrow. The leading edge runs all but straight to the wrist, then the hand sweeps back
# and tapers to a point.
LEADING = [(0.080, 0.120), (0.420, 0.150), (0.930, 0.165), (1.230, 0.105), (1.480, -0.010), (1.535, -0.060)]
TRAILING = [(0.080, -0.215), (0.250, -0.150), (0.620, -0.105), (0.930, -0.085), (1.230, -0.090), (1.480, -0.105),
            (1.535, -0.110)]
THICKNESS = [(0.080, 0.050), (0.420, 0.036), (0.930, 0.024), (1.535, 0.010)]
# A wing's section: (chord share, side: 1 over and -1 under, share of the thickness). The trailing
# edge is two vertices in one place (a sharp edge: the top's normal stays up, the underside's
# down); the leading edge is one (a round edge). The underwing's dark margin lies ahead of
# `MARGIN` of the chord along the leading edge.
MARGIN = 0.26
SECTION = [(0.0, 0.0, 0.0), (MARGIN, 1.0, 1.0), (0.55, 1.0, 0.86), (1.0, 1.0, 0.0),
           (1.0, -1.0, 0.0), (0.55, -1.0, 0.86), (MARGIN, -1.0, 1.0)]
TRAILING_PAIR = 3   # the pair (3, 4) has no face: the two trailing vertices coincide
# The bands over which a wing vertex passes to a hinge: (from, to) at the leading edge and at the
# trailing edge (|x|, m), eased between by how far back on the chord the vertex lies.
ARM_BAND = ((0.080, 0.230), (0.080, 0.300))
HAND_BAND = ((0.860, 1.000), (0.760, 1.110))


def band(spec, s, behind):
    (l0, l1), (t0, t1) = spec
    k = max(0.0, min(1.0, behind))
    return smooth(l0 + (t0 - l0) * k, l1 + (t1 - l1) * k, s)


def wing_colour(s, share, face):
    """Slate above, darker toward the tip; white below, with a dark margin along the leading edge and at the tip."""
    tipward = smooth(1.18, 1.46, s)
    if face == 0.0:
        return PLUMAGE["edge"]
    if face > 0:
        return mix(PLUMAGE["slate"], PLUMAGE["edge"], 0.55 * tipward + 0.2 * smooth(0.0, 0.3, 0.3 - share))
    lead = 1.0 - smooth(MARGIN - 0.10, MARGIN + 0.06, share)
    trail = smooth(0.90, 1.0, share) * 0.8
    dark = max(lead, trail, tipward)
    return mix(PLUMAGE["lining"], PLUMAGE["margin"], dark)


def build_wing(b, side):
    """side = 1 the bird's left (+x), -1 its right."""
    first = b.mark()
    rings = []
    for s in STATIONS:
        le = interp(LEADING, s)
        te = interp(TRAILING, s)
        chord = le - te
        thick = interp(THICKNESS, s)
        ring = []
        for share, face, thickness in SECTION:
            z = le - share * chord
            camber = 0.06 * chord * 4 * share * (1 - share)
            y = WING_Y + camber + (thickness * thick * (0.62 if face > 0 else -0.38))
            # The flight feathers (the back of the wing, and all of the hand) are thin.
            thin = smooth(0.3, 0.75, share) * (0.4 + 0.6 * smooth(0.6, 1.1, s))
            ring.append(b.vert((side * s, y, z), wing_colour(s, share, face), "wing", thin=thin,
                               arm=band(ARM_BAND, s, share), hand=band(HAND_BAND, s, share),
                               shade=0.95 if face < 0 else 1.0))
        rings.append(ring)
    end = SPAN / 2
    tip = b.vert((side * end, WING_Y, (interp(LEADING, end) + interp(TRAILING, end)) / 2 - 0.012),
                 PLUMAGE["edge"], "wing", thin=1.0, arm=1.0, hand=1.0)
    b.loft(rings, close_end=tip, skip=(TRAILING_PAIR,))
    b.orient(first, lambda c: (c.x, WING_Y + 0.004, (interp(LEADING, abs(c.x)) + interp(TRAILING, abs(c.x))) / 2))


def build_albatross():
    b = Builder()
    build_body(b)
    build_tail(b)
    build_wing(b, 1)
    build_wing(b, -1)
    return b


# ── The vertex stage's twin ───────────────────────────────────────────────────

def _turn(a, b, angle):
    c, s = math.cos(angle), math.sin(angle)
    return a * c - b * s, a * s + b * c


def pose(p, rig, arm=0.0, hand=0.0, fan=0.0, twist=0.0):
    """A vertex with the wing turned `arm` radians at the shoulder and `hand` at the wrist (+ up: the
    wrist first), the tail fanned by `fan` (-1 closed .. 1 wide) and twisted `twist` radians about the body's axis."""
    x, y, z = p
    side = 1.0 if x >= 0 else -1.0
    du, dy = _turn(abs(x) - WRIST[0], y - WRIST[1], hand * rig[1])
    du, dy = _turn(du + WRIST[0] - SHOULDER[0], dy + WRIST[1] - SHOULDER[1], arm * rig[0])
    x1 = side * (du + SHOULDER[0]) * (1.0 + FAN_GAIN * fan * rig[2])
    y1 = dy + SHOULDER[1]
    tx, ty = _turn(x1, y1 - TAIL[1], twist * rig[2])
    return (tx, ty + TAIL[1], z)


# What the previews show, as (arm, hand, fan, twist): the theme's own glide and its slow beats run
# through these (nimbus-veil-albatross-flight.js: albatrossWings).
POSES = [
    ("glide", 0.06, -0.15, -0.4, 0.0),
    ("flat", 0.0, 0.0, 0.0, 0.0),
    ("loaded", 0.16, -0.10, 0.3, 0.0),
    ("up", 0.38, -0.30, -0.2, 0.0),
    ("down", -0.26, 0.10, -0.2, 0.0),
    ("steer", 0.10, -0.16, 1.0, 0.5),
]


def stretch(built):
    """The worst an edge of the mesh is stretched or bunched by any authored pose (ratios to its modelled length)."""
    edges = set()
    for f in built.faces:
        for i in range(len(f)):
            a, c = f[i], f[(i + 1) % len(f)]
            edges.add((min(a, c), max(a, c)))
    worst = [1.0, 1.0]
    for _, arm, hand, fan, twist in POSES:
        posed = [pose(p, r, arm, hand, fan, twist) for p, r in zip(built.verts, built.rig)]
        for a, c in edges:
            rest = (Vector(built.verts[a]) - Vector(built.verts[c])).length
            if rest < 1e-4:
                continue
            now = (Vector(posed[a]) - Vector(posed[c])).length
            worst[0] = min(worst[0], now / rest)
            worst[1] = max(worst[1], now / rest)
    return worst


# ── Blender: join, triangulate, normals ───────────────────────────────────────

def to_b(p):
    """Game frame → Blender (Z up, the bird faces -Y, its left wing on +X): a rotation, so the winding stands."""
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


def stored(built, i):
    """Vertex i and its shares as the module stores them (so the checks hold to the last bit)."""
    return tuple(round(c / QUANT) * QUANT for c in built.verts[i]), tuple(byte(x) / 255 for x in built.rig[i])


def checks(built):
    """A few telling vertices as the twin poses them: both wingtips, a wrist, an inner wing, the tail's edge and tip, the bill."""
    out = []

    def nearest(target):
        return min(range(len(built.verts)), key=lambda i: sum((built.verts[i][k] - target[k]) ** 2 for k in range(3)))

    targets = ((1.55, WING_Y, -0.09), (-1.55, WING_Y, -0.09), (0.93, WING_Y, -0.08), (0.42, WING_Y, -0.12),
               (0.11, TAIL[1], -0.49), (0.0, TAIL[1], TAIL_TIP), (0.0, BILL_TIP[1], BILL_TIP[0]))
    for target in targets:
        i = nearest(target)
        for arm, hand, fan, twist in ((0.38, -0.30, 1.0, 0.5), (-0.26, 0.10, -0.4, -0.3)):
            p, r = stored(built, i)
            out.append({"vertex": i, "arm": arm, "hand": hand, "fan": fan, "twist": twist,
                        "at": [round(c, 5) for c in pose(p, r, arm, hand, fan, twist)]})
    return out


def write_module(path, built, mesh):
    triangles, normals = read_mesh(mesh)
    xs = [v[0] for v in built.verts]
    zs = [v[2] for v in built.verts]
    positions = [int(round(c / QUANT)) for v in built.verts for c in v]
    if max(abs(p) for p in positions) > 32767:
        raise RuntimeError(f"{TAG} the bird does not fit the stored positions")
    least, most = stretch(built)
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Nimbus Veil's albatross: GENERATED by scripts/blender/nimbus_veil_albatross.py (do not edit",
        " * by hand). To write it again, byte for byte:",
        " *",
        " *     blender --background --factory-startup --python scripts/blender/nimbus_veil_albatross.py -- \\",
        " *         --out src/themes/nimbus-veil",
        " *",
        " * The bird gliding, modelled in Blender. Game frame: x the bird's left, y up, z forward; metres,",
        " * real size. `positions` Int16 in units of `quant` metres, `normals` Int8 (/ 127), `colours`",
        " * Uint8 (linear r, g, b and `thin`: how much sun a feather lets through; / 255), `rig` Uint8",
        " * (arm, hand, tail, shade; / 255: how much of the shoulder's turn, of the wrist's turn and of",
        " * the tail's fan and twist a vertex takes, and how open it is to the sky), `partOf` Uint8 (an",
        " * index into `parts`), `index` Uint16 triangles. `shoulder` and `wrist` are the wing's two",
        " * hinges (|x|, y: lines along z); `tail` is the z of the tail's root and the y of the axis it",
        " * twists about, `fanGain` how far a full fan spreads it. `poses` are the previews' (arm, hand,",
        " * fan, twist: radians, + up; fan -1 closed .. 1 wide); `stretch` is the least and the most any",
        " * edge is stretched by them; `checks` are vertices as the script's own twin of the vertex stage",
        " * poses them (the tests).",
        " */",
        "export const NIMBUS_VEIL_ALBATROSS = Object.freeze({",
        f"    quant: {QUANT},",
        f"    parts: {json.dumps(PARTS)},",
        f"    shoulder: {json.dumps(list(SHOULDER))},",
        f"    wrist: {json.dumps(list(WRIST))},",
        f"    tail: {json.dumps(list(TAIL))},",
        f"    fanGain: {FAN_GAIN},",
        f"    vertexCount: {len(built.verts)},",
        f"    triangleCount: {len(triangles)},",
        f"    span: {round(max(xs) - min(xs), 4)},",
        f"    length: {round(max(zs) - min(zs), 4)},",
        f"    poses: {json.dumps({name: [arm, hand, fan, twist] for name, arm, hand, fan, twist in POSES})},",
        f"    stretch: {json.dumps([round(least, 4), round(most, 4)])},",
        f"    positions: '{b64('h', positions)}',",
        f"    normals: '{b64('b', [int(round(c * 127)) for n in normals for c in n])}',",
        f"    colours: '{b64('B', [byte(x) for c in built.colours for x in c])}',",
        f"    rig: '{b64('B', [byte(x) for r in built.rig for x in r])}',",
        f"    partOf: '{b64('B', built.parts)}',",
        f"    index: '{b64('H', [i for t in triangles for i in t])}',",
        f"    checks: {json.dumps(checks(built), separators=(',', ':'))},",
        "});",
        "",
    ]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"{TAG} {len(built.verts)} vertices, {len(triangles)} triangles, span {max(xs) - min(xs):.3f} m, "
          f"length {max(zs) - min(zs):.3f} m, edges stretched {least:.3f} to {most:.3f}")
    print(f"{TAG} wrote {path}")


# ── Previews (Workbench, orthographic lineups; each also at game size) ────────

GAME_PX = (30, 50, 90)    # the bird's span on screen, pixels
ENLARGE = 8


def enlarge(path, out, times):
    """Write `path` again `times` larger, every pixel a square (no smoothing): what the game shows, readable."""
    import numpy as np
    image = bpy.data.images.load(str(path))
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    big = np.repeat(np.repeat(pixels.reshape(h, w, 4), times, axis=0), times, axis=1)
    result = bpy.data.images.new("NimbusVeilAlbatrossEnlarged", w * times, h * times, alpha=True)
    result.pixels.foreach_set(big.ravel())
    result.filepath_raw = str(out)
    result.file_format = "PNG"
    result.save()
    bpy.data.images.remove(image)
    bpy.data.images.remove(result)


def previews(scene, built, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    row = [(name, [pose(p, r, arm, hand, fan, twist) for p, r in zip(built.verts, built.rig)])
           for name, arm, hand, fan, twist in POSES]
    for obj in scene.collection.objects:
        obj.hide_render = True
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_object_outline = False
    shading.show_cavity = False
    world = bpy.data.worlds.new("NimbusVeilAlbatrossWorld")
    scene.world = world
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    cam_data = bpy.data.cameras.new("NimbusVeilAlbatrossPreviewCam")
    cam = bpy.data.objects.new("NimbusVeilAlbatrossPreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = "ORTHO"
    files = []
    views = {
        # name: the camera's direction (Blender frame: the bird flies toward -Y), its up, the lineup's axis
        "below": (Vector((0, 0, 1)), Vector((0, -1, 0)), Vector((1, 0, 0))),
        "above": (Vector((0, 0, -1)), Vector((0, -1, 0)), Vector((1, 0, 0))),
        "above-side": (Vector((-0.70, 0.36, -0.62)).normalized(), Vector((0, 0, 1)), Vector((0.46, 0.89, 0)).normalized()),
        "below-side": (Vector((-0.74, 0.30, 0.60)).normalized(), Vector((0, 0, 1)), Vector((0.38, 0.92, 0)).normalized()),
        "side": (Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))),
        "front": (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))),
    }
    skies = {"sky": (0.36, 0.44, 0.78), "cloud": (0.93, 0.80, 0.72)}
    for view, (direction, up, axis) in views.items():
        spacing = 1.9 if view == "side" else 3.6
        objects = []
        for k, (label, verts) in enumerate(row):
            obj = bpy.data.objects.new(f"pv {label}", make_mesh(f"pv {label}", built, verts))
            obj.location = axis * (k - (len(row) - 1) / 2) * spacing
            scene.collection.objects.link(obj)
            objects.append(obj)
        right = direction.cross(up).normalized()
        true_up = right.cross(direction).normalized()
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = Matrix((right, true_up, -direction)).transposed().to_quaternion()
        cam.location = -direction * 14.0
        width = spacing * len(row) * 1.04
        cam_data.ortho_scale = width
        jobs = [("", 1800, "sky", 0)]
        for px in GAME_PX:
            jobs += [(f"-game{px}-{sky}", round(width / SPAN * px), sky, px) for sky in skies]
        for suffix, pixels, sky, px in jobs:
            world.color = skies[sky]
            scene.render.resolution_x = pixels
            scene.render.resolution_y = max(8, round(pixels * (0.12 if view in ("side", "front") else 0.26)))
            scene.render.resolution_percentage = 100
            path = out / f"albatross-{view}{suffix}.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True, scene=scene.name)
            if suffix:
                enlarge(path, path, ENLARGE)
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
    built = build_albatross()
    mesh = make_mesh("NimbusVeilAlbatross", built)
    scene.collection.objects.link(bpy.data.objects.new("NimbusVeilAlbatross", mesh))
    if out:
        path = Path(out)
        write_module(path if path.suffix == ".js" else path / MODULE, built, mesh)
    if preview_dir:
        for file in previews(scene, built, preview_dir):
            print(f"{TAG} preview {file}")


if __name__ == "__main__":
    main()
