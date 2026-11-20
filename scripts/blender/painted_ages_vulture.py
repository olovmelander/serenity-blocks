"""Painted Ages' bearded vulture (lammergeier), modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/painted_ages_vulture.py -- \
        --out src/themes/painted-ages [--preview <dir>]

It writes ONE generated module, src/themes/painted-ages/painted-ages-vulture-model.js (no .glb and
no entry in the asset manifest), holding the bird as the overlook sees it soar over the badlands:

  long, fairly narrow wings that taper to a point, held flat with the hands a little lowered and
  the primaries parted into five fingers; a long wedge of a tail, widest two thirds of the way
  down and coming to a point (with the narrow wings, the species' signature against the sky); a
  small head on a short neck, the bill hooked down. Slate black wings, back and tail; the
  underwing's coverts blacker than its flight feathers; the breast and belly rust orange (the
  bird dyes them itself, bathing in red iron-oxide earth), paling to cream on the head, with the
  black mask through the eye that runs down into the beard.

On screen a far bird is 20 to 60 px from wingtip to wingtip and a near one up to 320 px, so the
shape is built for its silhouette at the small size and for few triangles: the head, the tail and
the fingers are a little stouter than life. Game frame, metres, real size: x the bird's LEFT, y up,
z forward, the shoulders near the origin.

No skeleton. Each vertex carries four shares the theme's vertex stage reads (`rig`):

  arm    how much of the shoulder's turn the vertex takes (0 on the body, 1 past the hinge band)
  hand   how much of the wrist's turn the outer wing takes
  tail   how much of the tail's fan and twist the vertex takes (0 at its root, 1 at its tip)
  shade  how open the vertex is to the sky (the belly between the wings is a little darker)

a colour (`colours`: linear r, g, b and `thin`, how much sun a feather lets through), and where it
lies on a feather (`feather`: the feather's number across the wing or the tail, the place along it,
and how strongly the feather shows: the fragment stage draws the pale shafts and the feathers'
edges from these when the bird is near enough to resolve them).

The two wing hinges are lines along the body (z) through `SHOULDER` and `WRIST` (|x|, y); the bands
they take hold over are eased, and wider at the trailing edge. The tail fans about the body's axis
(its vertices move out sideways) and twists about it through `TAIL` (z of its root, y of the axis).
`pose()` below is the vertex stage's twin; the module carries a few vertices as it poses them
(`checks`), so the theme's tests hold its own twin to this file.

Blender does the mesh work: the rings are joined into quads, triangulated and given their smooth
normals there, and `--preview` renders orthographic lineups (Workbench) of the bird soaring,
flapping and steering, each also at game size (the bird 20, 34 and 60 px across, enlarged eight
times) against the sky and against the rock.

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

TAG = "[painted-ages-vulture]"
SCENE = "PaintedAgesVulture"
MODULE = "painted-ages-vulture-model.js"


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
    "slate": lin("#2c2e37"),        # the wings, the back and the tail from above
    "covert": lin("#191a1e"),       # the underwing's coverts: the blackest of it
    "flight": lin("#33353d"),       # the flight feathers from below: a shade greyer
    "edge": lin("#1d1e23"),         # the wing's leading edge
    "rust": lin("#96491a"),         # the breast: iron oxide, bathed in
    "collar": lin("#58301a"),       # the dark band across the upper breast
    "belly": lin("#b57a3c"),        # paler down the belly and the trousers
    "cream": lin("#dcc8a0"),        # the head and the nape
    "mask": lin("#141417"),         # the line through the eye, down into the beard
    "bill": lin("#55504a"),
}

PARTS = ["body", "head", "bill", "wing", "tail"]


# ── The mesh, built as plain lists in the game frame ──────────────────────────

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.colours = []   # per vertex: (r, g, b, thin)
        self.rig = []       # per vertex: (arm, hand, tail, shade)
        self.feather = []   # per vertex: (feather number, along, strength)
        self.parts = []     # per vertex: index into PARTS

    def vert(self, p, colour, part, thin=0.0, arm=0.0, hand=0.0, tail=0.0, shade=1.0, feather=(0.0, 0.0, 0.0)):
        self.verts.append(tuple(float(v) for v in p))
        self.colours.append((colour[0], colour[1], colour[2], thin))
        self.rig.append((arm, hand, tail, shade))
        self.feather.append(tuple(float(v) for v in feather))
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


# The body, the short neck and the head in one spindle, from the tail's root forward: z, half
# width, top over and bottom under the centre, the centre's height, the part, and what the back,
# the shoulders (the upper flanks), the lower flanks and the underside wear. The back is slate from
# the rump to the shoulders; a dark collar crosses the upper breast; the neck and the head pale to
# cream; the face carries the mask through the eye, and the beard under the bill.
S, R, B, C, M, K = "slate", "rust", "belly", "cream", "mask", "collar"
BODY = [
    (-0.300, 0.080, 0.032, 0.040, 0.010, "body", S, S, S, B),
    (-0.215, 0.100, 0.058, 0.072, 0.006, "body", S, S, B, B),
    (-0.100, 0.118, 0.080, 0.098, 0.002, "body", S, S, B, B),
    (0.020, 0.126, 0.088, 0.108, 0.000, "body", S, S, R, R),
    (0.130, 0.118, 0.084, 0.100, -0.002, "body", S, S, R, R),
    (0.215, 0.090, 0.070, 0.080, -0.004, "body", S, R, K, K),
    (0.270, 0.064, 0.056, 0.058, -0.004, "body", C, R, R, R),
    (0.320, 0.056, 0.054, 0.050, 0.000, "head", C, C, C, C),
    (0.365, 0.058, 0.058, 0.050, 0.004, "head", C, M, C, C),
    (0.405, 0.042, 0.038, 0.042, -0.004, "head", C, M, C, M),
    (0.432, 0.024, 0.018, 0.028, -0.014, "bill", "bill", "bill", "bill", M),
]
BILL_TIP = (0.482, -0.040)
BODY_RING = 6


def build_body(b):
    first = b.mark()
    rings = []
    for z, wx, top, bottom, cy, part, on_back, on_shoulder, on_flank, below in BODY:
        row = []
        for i in range(BODY_RING):
            a = math.pi / 2 + 2 * math.pi * i / BODY_RING
            ca, sa = math.cos(a), math.sin(a)
            x = wx * math.copysign(abs(ca) ** 0.6, ca)
            y = cy + (top if sa >= 0 else bottom) * math.copysign(abs(sa) ** 0.8, sa)
            wear = on_back if sa > 0.75 else (below if sa < -0.75 else (on_shoulder if sa > 0 else on_flank))
            # The belly between the wings is a little shaded (the wings stand over it).
            shade = 0.84 + 0.16 * smooth(-0.6, 0.3, sa)
            row.append(b.vert((x, y, z), PLUMAGE[wear], part, shade=shade))
        rings.append(row)
    rump = b.vert((0.0, BODY[0][4], BODY[0][0] - 0.03), PLUMAGE["slate"], "body")
    tip = b.vert((0.0, BILL_TIP[1], BILL_TIP[0]), PLUMAGE["bill"], "bill")
    b.loft(rings, close_start=rump, close_end=tip)
    centres = sorted((row[0], row[4]) for row in BODY)
    b.orient(first, lambda c: (0.0, interp(centres, c.z), c.z))


# ── The tail ─────────────────────────────────────────────────────────────────

# A long wedge: the twelve feathers lie as one flat plate, a face above and a face below (their own
# vertices, so each keeps its normal). Rows down its length: z, half width, the centre's lift over
# the edges (a shallow roof). Widest two thirds of the way down, then in to a point.
TAIL = (-0.280, 0.012)   # z of the root (where the fan and the twist begin), y of the axis
TAIL_ROWS = [
    (-0.280, 0.086, 0.012),
    (-0.430, 0.185, 0.014),
    (-0.600, 0.262, 0.014),
    (-0.735, 0.172, 0.010),
]
TAIL_TIP = -0.855
TAIL_FEATHERS = 12
# How far a full fan (fan = 1) spreads the tail's edge beyond the modelled half fan: x times (1 + gain).
FAN_GAIN = 0.45


def build_tail(b):
    length = TAIL[0] - TAIL_TIP
    for up in (1.0, -1.0):
        colour = PLUMAGE["slate"] if up > 0 else PLUMAGE["flight"]
        rows = []
        for z, wx, lift in TAIL_ROWS:
            along = (TAIL[0] - z) / length
            share = smooth(0.0, 0.75, along)
            row = []
            for k, side in enumerate((1.0, 0.0, -1.0)):
                y = TAIL[1] + (lift if side == 0.0 else 0.0) + 0.002 * up
                row.append(b.vert((side * wx, y, z), colour, "tail", thin=0.75, tail=share,
                                  shade=1.0 if up > 0 else 0.94,
                                  feather=(TAIL_FEATHERS * (0.5 - 0.5 * side), along, 1.0)))
            rows.append(row)
        tip = b.vert((0.0, TAIL[1] + 0.002 * up, TAIL_TIP), colour, "tail", thin=0.9, tail=1.0,
                     shade=1.0 if up > 0 else 0.94, feather=(TAIL_FEATHERS * 0.5, 1.0, 1.0))
        for a, c in zip(rows, rows[1:]):
            for k in (0, 1):
                b.facing((a[k], a[k + 1], c[k + 1], c[k]), (0.0, up, 0.0))
        last = rows[-1]
        for k in (0, 1):
            b.facing((last[k], last[k + 1], tip), (0.0, up, 0.0))


# ── The wings ─────────────────────────────────────────────────────────────────

SPAN = 2.72
# The two hinges, lines along z: the shoulder and the wrist (|x|, y).
SHOULDER = (0.110, 0.050)
WRIST = (0.590, 0.050)
WING_Y = 0.050
# Stations along the span (|x|, m), three in each hinge's band so the wing bends instead of creasing.
STATIONS = [0.085, 0.160, 0.270, 0.410, 0.520, 0.590, 0.680, 0.830, 0.980]
# The wrist is the forward-most point; the arm is of even chord, the long hand sweeps back from the
# wrist and tapers, so the wing comes to a point.
LEADING = [(0.085, 0.150), (0.300, 0.190), (0.590, 0.250), (0.830, 0.165), (0.980, 0.050)]
TRAILING = [(0.085, -0.255), (0.270, -0.245), (0.520, -0.195), (0.680, -0.170), (0.830, -0.160), (0.980, -0.150)]
THICKNESS = [(0.085, 0.046), (0.300, 0.036), (0.590, 0.026), (0.980, 0.013)]
# A wing's section: (chord share, side: 1 over and -1 under, share of the thickness). The trailing
# edge is two vertices in one place (a sharp edge: the top's normal stays up, the underside's
# down); the leading edge is one (a round edge). Ahead of `COVERTS` of the chord lie the coverts
# (the underwing's are its blackest part), behind it the flight feathers.
COVERTS = 0.44
SECTION = [(0.0, 0.0, 0.0), (COVERTS - 0.05, 1.0, 1.0), (COVERTS + 0.05, 1.0, 0.84), (1.0, 1.0, 0.0),
           (1.0, -1.0, 0.0), (COVERTS + 0.05, -1.0, 0.84), (COVERTS - 0.05, -1.0, 1.0)]
TRAILING_PAIR = 3   # the pair (3, 4) has no face: the two trailing vertices coincide
# The bands over which a wing vertex passes to a hinge: (from, to) at the leading edge and at the
# trailing edge (|x|, m), eased between by how far back on the chord the vertex lies.
ARM_BAND = ((0.085, 0.250), (0.085, 0.330))
HAND_BAND = ((0.525, 0.660), (0.420, 0.790))
# Feathers across a wing, root to the hand's end (the fingers count on from them).
WING_FEATHERS = 18
# The hand ends in parted primaries ("fingers"), the middle one the longest, so the wing comes to
# a point: where along the hand's end each one roots (chord share), its angle from straight out
# (degrees, + forward), its length past the root and its width at the root; each tapers to a
# blunt tip `FINGER_TIP` of that wide.
FINGER_ROOT = 0.965
FINGERS = [
    (0.10, -8.0, 0.250, 0.072),
    (0.30, -13.0, 0.355, 0.080),
    (0.50, -19.0, 0.416, 0.082),
    (0.70, -27.0, 0.350, 0.082),
    (0.90, -38.0, 0.262, 0.076),
]
FINGER_TIP = 0.46


def band(spec, s, behind):
    (l0, l1), (t0, t1) = spec
    k = max(0.0, min(1.0, behind))
    return smooth(l0 + (t0 - l0) * k, l1 + (t1 - l1) * k, s)


def wing_colour(share, face):
    if face == 0.0:
        return PLUMAGE["edge"]
    back = smooth(COVERTS - 0.03, COVERTS + 0.03, share)
    if face > 0:
        return mix(PLUMAGE["edge"], PLUMAGE["slate"], 0.35 + 0.65 * back)
    return mix(PLUMAGE["covert"], PLUMAGE["flight"], back)


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
            camber = 0.05 * chord * 4 * share * (1 - share)
            y = WING_Y + camber + (thickness * thick * (0.62 if face > 0 else -0.38))
            # The flight feathers (the back of the wing, and all of the hand) are thin.
            thin = smooth(0.25, 0.7, share) * (0.45 + 0.55 * smooth(0.45, 0.8, s))
            along = WING_FEATHERS * (s - STATIONS[0]) / (FINGER_ROOT - STATIONS[0])
            ring.append(b.vert((side * s, y, z), wing_colour(share, face), "wing", thin=thin,
                               arm=band(ARM_BAND, s, share), hand=band(HAND_BAND, s, share),
                               shade=0.94 if face < 0 else 1.0,
                               feather=(along, share, smooth(COVERTS - 0.08, COVERTS + 0.08, share))))
        rings.append(ring)
    end = STATIONS[-1] + 0.016
    tip = b.vert((side * end, WING_Y, (interp(LEADING, end) + interp(TRAILING, end)) / 2 - 0.01),
                 PLUMAGE["slate"], "wing", thin=1.0, arm=1.0, hand=1.0,
                 feather=(WING_FEATHERS * 1.03, 0.5, 0.0))
    b.loft(rings, close_end=tip, skip=(TRAILING_PAIR,))
    b.orient(first, lambda c: (c.x, WING_Y + 0.004, (interp(LEADING, abs(c.x)) + interp(TRAILING, abs(c.x))) / 2))
    # The fingers: flat feathers, a face above and a face below (their own vertices, so each keeps
    # its own normal), each a hair higher than the one behind it as the primaries overlap.
    le = interp(LEADING, FINGER_ROOT)
    te = interp(TRAILING, FINGER_ROOT)
    for k, (share, angle, length, width) in enumerate(FINGERS):
        a = math.radians(angle)
        along = (math.cos(a), math.sin(a))        # (|x|, z) out along the feather
        across = (-math.sin(a), math.cos(a))      # toward its leading side
        root = (FINGER_ROOT, le - share * (le - te))
        y = WING_Y + 0.004 - 0.002 * k
        lift = 0.06 * length                      # the tips bend up a little under the load
        corners = []
        for u, w, dy in ((0.0, width, 0.0), (1.0, width * FINGER_TIP, lift)):
            for edge in (0.5, -0.5):
                corners.append((root[0] + along[0] * u * length + across[0] * edge * w, y + dy,
                                root[1] + along[1] * u * length + across[1] * edge * w, u, edge))
        for up in (1.0, -1.0):
            colour = PLUMAGE["slate"] if up > 0 else PLUMAGE["flight"]
            quad = [b.vert((side * x, yy, z), colour, "wing", thin=1.0, arm=1.0,
                           hand=band(HAND_BAND, x, 0.5), shade=1.0 if up > 0 else 0.94,
                           feather=(WING_FEATHERS + 2 * k + 1.0 - edge, u, 1.0))
                    for x, yy, z, u, edge in corners]
            b.facing((quad[0], quad[1], quad[3], quad[2]), (0.0, up, 0.0))


def build_vulture():
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


# What the previews show, as (arm, hand, fan, twist): the theme's own soaring and its slow flaps
# run through these (painted-ages-vulture-routes.js: vultureWings).
POSES = [
    ("soar", 0.05, -0.13, 0.0, 0.0),
    ("flat", 0.0, 0.0, 0.0, 0.0),
    ("up", 0.46, 0.10, -0.3, 0.0),
    ("down", -0.34, -0.30, -0.3, 0.0),
    ("steer", 0.05, -0.13, 1.0, 0.45),
    ("glide", 0.09, -0.24, -0.8, 0.0),
]


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
FEATHER_UNIT = 1 / 256  # a feather's number is stored in these


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

    targets = ((1.36, WING_Y, -0.05), (-1.36, WING_Y, -0.05), (0.59, WING_Y, -0.18), (0.27, WING_Y, -0.235),
               (0.262, TAIL[1], -0.60), (0.0, TAIL[1], TAIL_TIP), (0.0, BILL_TIP[1], BILL_TIP[0]))
    for target in targets:
        i = nearest(target)
        for arm, hand, fan, twist in ((0.46, 0.10, 1.0, 0.45), (-0.34, -0.30, -0.8, -0.3)):
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
    feather = []
    for f in built.feather:
        feather += [int(round(f[0] / FEATHER_UNIT)), int(round(max(0.0, min(1.0, f[1])) * 65535)),
                    int(round(max(0.0, min(1.0, f[2])) * 65535)), 0]
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Painted Ages' bearded vulture (lammergeier): GENERATED by scripts/blender/painted_ages_vulture.py",
        " * (do not edit by hand). To write it again, byte for byte:",
        " *",
        " *     blender --background --factory-startup --python scripts/blender/painted_ages_vulture.py -- \\",
        " *         --out src/themes/painted-ages",
        " *",
        " * The bird soaring, modelled in Blender. Game frame: x the bird's left, y up, z forward; metres,",
        " * real size. `positions` Int16 in units of `quant` metres, `normals` Int8 (/ 127), `colours`",
        " * Uint8 (linear r, g, b and `thin`: how much sun a feather lets through; / 255), `rig` Uint8",
        " * (arm, hand, tail, shade; / 255: how much of the shoulder's turn, of the wrist's turn and of",
        " * the tail's fan and twist a vertex takes, and how open it is to the sky), `feather` Uint16",
        " * (the feather's number across the wing or the tail in units of `featherUnit`, the place along",
        " * it and how strongly it shows, both / 65535, and a spare), `partOf` Uint8 (an index into",
        " * `parts`), `index` Uint16 triangles. `shoulder` and `wrist` are the wing's two hinges (|x|, y:",
        " * lines along z); `tail` is the z of the tail's root and the y of the axis it twists about,",
        " * `fanGain` how far a full fan spreads it. `poses` are the previews' (arm, hand, fan, twist:",
        " * radians, + up; fan -1 closed .. 1 wide); `checks` are vertices as the script's own twin of",
        " * the vertex stage poses them (the tests).",
        " */",
        "export const PAINTED_AGES_VULTURE = Object.freeze({",
        f"    quant: {QUANT},",
        f"    featherUnit: {FEATHER_UNIT},",
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
        f"    positions: '{b64('h', positions)}',",
        f"    normals: '{b64('b', [int(round(c * 127)) for n in normals for c in n])}',",
        f"    colours: '{b64('B', [byte(x) for c in built.colours for x in c])}',",
        f"    rig: '{b64('B', [byte(x) for r in built.rig for x in r])}',",
        f"    feather: '{b64('H', feather)}',",
        f"    partOf: '{b64('B', built.parts)}',",
        f"    index: '{b64('H', [i for t in triangles for i in t])}',",
        f"    checks: {json.dumps(checks(built), separators=(',', ':'))},",
        "});",
        "",
    ]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"{TAG} {len(built.verts)} vertices, {len(triangles)} triangles, span {max(xs) - min(xs):.3f} m, "
          f"length {max(zs) - min(zs):.3f} m")
    print(f"{TAG} wrote {path}")


# ── Previews (Workbench, orthographic lineups; each also at game size) ────────

GAME_PX = (20, 34, 60)    # the bird's span on screen, pixels
ENLARGE = 8


def enlarge(path, out, times):
    """Write `path` again `times` larger, every pixel a square (no smoothing): what the game shows, readable."""
    import numpy as np
    image = bpy.data.images.load(str(path))
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    big = np.repeat(np.repeat(pixels.reshape(h, w, 4), times, axis=0), times, axis=1)
    result = bpy.data.images.new("PaintedAgesVultureEnlarged", w * times, h * times, alpha=True)
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
    world = bpy.data.worlds.new("PaintedAgesVultureWorld")
    scene.world = world
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    cam_data = bpy.data.cameras.new("PaintedAgesVulturePreviewCam")
    cam = bpy.data.objects.new("PaintedAgesVulturePreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = "ORTHO"
    files = []
    views = {
        # name: the camera's direction (Blender frame: the bird flies toward -Y), its up, the lineup's axis
        "below": (Vector((0, 0, 1)), Vector((0, -1, 0)), Vector((1, 0, 0))),
        "above": (Vector((0, 0, -1)), Vector((0, -1, 0)), Vector((1, 0, 0))),
        "below-behind": (Vector((0.0, -0.80, 0.60)).normalized(), Vector((0, 0, 1)), Vector((1, 0, 0))),
        "below-side": (Vector((-0.74, 0.30, 0.60)).normalized(), Vector((0, 0, 1)), Vector((0.38, 0.92, 0)).normalized()),
        "side": (Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))),
        "front": (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))),
    }
    skies = {"sky": (0.30, 0.46, 0.80), "rock": (0.52, 0.25, 0.14)}
    for view, (direction, up, axis) in views.items():
        spacing = 2.0 if view == "side" else 3.2
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
            scene.render.resolution_y = max(8, round(pixels * (0.14 if view in ("side", "front") else 0.3)))
            scene.render.resolution_percentage = 100
            path = out / f"vulture-{view}{suffix}.png"
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
    built = build_vulture()
    mesh = make_mesh("PaintedAgesVulture", built)
    scene.collection.objects.link(bpy.data.objects.new("PaintedAgesVulture", mesh))
    if out:
        path = Path(out)
        write_module(path if path.suffix == ".js" else path / MODULE, built, mesh)
    if preview_dir:
        for file in previews(scene, built, preview_dir):
            print(f"{TAG} preview {file}")


if __name__ == "__main__":
    main()
