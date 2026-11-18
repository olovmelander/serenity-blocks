"""Sakura Twilight's cranes: the red-crowned crane (tancho), modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sakura_crane.py -- \
        --out src/themes/sakura-twilight [--preview <dir>]

It writes ONE generated module, src/themes/sakura-twilight/sakura-crane-model.js (no .glb and no
entry in the asset manifest: the theme's asset folder stays as it is), holding the bird on the
wing as the garden sees it cross the night sky:

  the neck stretched straight out ahead and a little low, the long legs trailing together well
  past the tail, long broad wings spread flat whose hand ends in five parted primaries. Snow
  white; the neck and face black with a white nape, the crown red, and the secondaries and
  tertials black: the trailing inner half of each wing, above and below. In flight that black
  trailing edge on a white bird is the species' signature, and it is the one marking that still
  reads when the bird is thirty pixels across.

On screen a bird is 20 to 45 px from wingtip to wingtip, so the shape is built for the silhouette
at that size and for few triangles: the neck, the legs and the fingers are half again as stout as
life, so the black line of the neck ahead and of the legs behind still holds a pixel there. Game frame, metres, real size: x the bird's LEFT, y up, z forward, the shoulders near
the origin.

No skeleton. Each vertex carries four shares the theme's vertex stage reads (`rig`):

  arm    how much of the shoulder's turn the vertex takes (0 on the body, 1 past the hinge band)
  hand   how much of the wrist's turn the outer wing takes
  shade  how open the vertex is to the sky (the belly between the legs is a little darker)
  -      unused (0)

and a colour (`colours`: linear r, g, b and `thin`, how much moonlight a feather lets through).
The two hinges are lines along the body (z) through `SHOULDER` and `WRIST` (|x|, y); the bands
they take hold over are eased, and wider at the trailing edge, where the skin lies far from the
joint and would crease. `pose()` below is the vertex stage's twin; the module carries a few
vertices as it poses them (`checks`), so the theme's tests hold its own twin to this file.

Blender does the mesh work: the rings are joined into quads, triangulated and given their smooth
normals there, and `--preview` renders orthographic lineups of the wingbeat (Workbench), each also
at game size (the bird 30 px across, enlarged eight times) on a night sky and on moonlit snow.

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

TAG = "[sakura-crane]"
SCENE = "SakuraCrane"
MODULE = "sakura-crane-model.js"


# ── Small maths ──────────────────────────────────────────────────────────────

def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


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


PLUMAGE = {
    "white": lin("#f1f0ec"),
    "black": lin("#17171a"),        # the neck, the face, the secondaries and tertials
    "red": lin("#c0242a"),          # the bare crown
    "bill": lin("#a39c72"),         # olive horn
    "leg": lin("#222225"),
}

PARTS = ["body", "neck", "head", "bill", "wing", "legs"]


# ── The mesh, built as plain lists in the game frame ──────────────────────────

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.colours = []   # per vertex: (r, g, b, thin)
        self.rig = []       # per vertex: (arm, hand, shade, 0)
        self.parts = []     # per vertex: index into PARTS

    def vert(self, p, colour, part, thin=0.0, arm=0.0, hand=0.0, shade=1.0):
        self.verts.append(tuple(float(v) for v in p))
        self.colours.append((colour[0], colour[1], colour[2], thin))
        self.rig.append((arm, hand, shade, 0.0))
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


# The body and the short white tail in one spindle, tail first: z, half width, top over and bottom
# under the centre, the centre's height. A crane is all neck, legs and wing: the body is slim.
BODY = [
    (-0.470, 0.058, 0.007, 0.007, 0.024),
    (-0.400, 0.082, 0.014, 0.014, 0.022),
    (-0.330, 0.076, 0.040, 0.040, 0.018),
    (-0.230, 0.104, 0.068, 0.080, 0.010),
    (-0.090, 0.124, 0.086, 0.106, 0.003),
    (0.040, 0.126, 0.090, 0.112, 0.000),
    (0.140, 0.108, 0.080, 0.098, -0.004),
    (0.215, 0.076, 0.060, 0.070, -0.010),
]
BODY_RING = 6


def build_body(b):
    first = b.mark()
    rings = []
    for z, wx, top, bottom, cy in BODY:
        row = []
        for i in range(BODY_RING):
            a = math.pi / 2 + 2 * math.pi * i / BODY_RING
            ca, sa = math.cos(a), math.sin(a)
            x = wx * math.copysign(abs(ca) ** 0.6, ca)
            y = cy + (top if sa >= 0 else bottom) * math.copysign(abs(sa) ** 0.8, sa)
            # The belly is a little shaded (the legs and the wings stand over it).
            shade = 0.86 + 0.14 * smooth(-0.6, 0.3, sa)
            row.append(b.vert((x, y, z), PLUMAGE["white"], "body", thin=0.5 * smooth(-0.36, -0.44, z), shade=shade))
        rings.append(row)
    tail = b.vert((0.0, BODY[0][4], BODY[0][0] - 0.035), PLUMAGE["white"], "body", thin=0.6)
    breast = b.vert((0.0, BODY[-1][4], BODY[-1][0] + 0.02), PLUMAGE["white"], "body")
    b.loft(rings, close_start=tail, close_end=breast)
    centres = sorted((z, cy) for z, _, _, _, cy in BODY)
    b.orient(first, lambda c: (0.0, interp(centres, c.z), c.z))


# The neck, the head and the bill, one tube of four-sided rings (top, left, bottom, right): z, half
# width, top, bottom, centre height, then what the top, the sides and the bottom wear. The neck is
# black to its root, the nape white from behind the eye, the crown red, the face black.
W, K, R, H = "white", "black", "red", "bill"
NECK = [
    (0.190, 0.066, 0.060, 0.066, -0.010, W, W, W, "neck"),
    (0.285, 0.052, 0.050, 0.054, -0.018, K, K, K, "neck"),
    (0.430, 0.046, 0.046, 0.048, -0.026, K, K, K, "neck"),
    (0.600, 0.043, 0.044, 0.045, -0.034, W, K, K, "neck"),
    (0.740, 0.043, 0.045, 0.044, -0.040, W, K, K, "neck"),
    (0.790, 0.050, 0.057, 0.046, -0.040, R, W, K, "head"),
    (0.838, 0.049, 0.055, 0.044, -0.042, R, K, K, "head"),
    (0.876, 0.036, 0.036, 0.034, -0.046, K, K, K, "head"),
    (0.900, 0.024, 0.024, 0.022, -0.049, H, H, H, "bill"),
    (0.975, 0.016, 0.015, 0.014, -0.053, H, H, H, "bill"),
]
BILL_TIP = (1.045, -0.056)


def build_neck(b):
    first = b.mark()
    rings = []
    for z, wx, top, bottom, cy, on_top, on_side, below, part in NECK:
        rings.append([
            b.vert((0.0, cy + top, z), PLUMAGE[on_top], part),
            b.vert((wx, cy, z), PLUMAGE[on_side], part),
            b.vert((0.0, cy - bottom, z), PLUMAGE[below], part),
            b.vert((-wx, cy, z), PLUMAGE[on_side], part),
        ])
    root = b.vert((0.0, NECK[0][4], NECK[0][0] - 0.02), PLUMAGE["white"], "neck")
    tip = b.vert((0.0, BILL_TIP[1], BILL_TIP[0]), PLUMAGE["bill"], "bill")
    b.loft(rings, close_start=root, close_end=tip)
    centres = sorted((row[0], row[4]) for row in NECK)
    b.orient(first, lambda c: (0.0, interp(centres, c.z), c.z))


# The legs, trailing together straight back under the tail and well past it: z, height, half
# width, half thickness. The feathered thighs are white, the long shanks and the feet black.
LEGS = [
    (-0.130, -0.082, 0.056, 0.030, W),
    (-0.330, -0.050, 0.046, 0.024, K),
    (-0.600, -0.032, 0.042, 0.021, K),
    (-0.800, -0.028, 0.046, 0.020, K),
]
LEGS_TIP = (-0.935, -0.027)


def build_legs(b):
    first = b.mark()
    rings = []
    for z, y, wx, wy, wear in LEGS:
        colour = PLUMAGE["white"] if wear == W else PLUMAGE["leg"]
        rings.append([
            b.vert((0.0, y + wy, z), colour, "legs", shade=0.9),
            b.vert((wx, y, z), colour, "legs", shade=0.9),
            b.vert((0.0, y - wy, z), colour, "legs", shade=0.9),
            b.vert((-wx, y, z), colour, "legs", shade=0.9),
        ])
    root = b.vert((0.0, LEGS[0][1], LEGS[0][0] + 0.03), PLUMAGE["white"], "legs", shade=0.9)
    toes = b.vert((0.0, LEGS_TIP[1], LEGS_TIP[0]), PLUMAGE["leg"], "legs", shade=0.9)
    b.loft(rings, close_start=root, close_end=toes)
    centres = sorted((row[0], row[1]) for row in LEGS)
    b.orient(first, lambda c: (0.0, interp(centres, c.z), c.z))


# ── The wings ─────────────────────────────────────────────────────────────────

SPAN = 2.40
# The two hinges, lines along z: the shoulder and the wrist (|x|, y).
SHOULDER = (0.100, 0.046)
WRIST = (0.600, 0.046)
WING_Y = 0.046
# Stations along the span (|x|, m), three in each hinge's band so the wing bends instead of creasing.
STATIONS = [0.070, 0.140, 0.240, 0.400, 0.525, 0.600, 0.680, 0.820, 0.960]
# The wrist is the forward-most point; the inner wing is broad (the long secondaries and tertials).
LEADING = [(0.070, 0.150), (0.300, 0.172), (0.600, 0.200), (0.820, 0.165), (0.960, 0.110)]
TRAILING = [(0.070, -0.365), (0.240, -0.340), (0.525, -0.292), (0.680, -0.268), (0.820, -0.235), (0.960, -0.180)]
THICKNESS = [(0.070, 0.046), (0.300, 0.038), (0.600, 0.028), (0.960, 0.014)]
# A wing's section: (chord share, side: 1 over and -1 under, share of the thickness). The trailing
# edge is two vertices in one place (a sharp edge: the top's normal stays up, the underside's
# down); the leading edge is one (a round edge). Behind `BLACK` of the chord the feathers are the
# black secondaries, as far out as the wrist; the pair of rows either side of it keeps the line crisp.
BLACK = 0.56
SECTION = [(0.0, 0.0, 0.0), (BLACK - 0.04, 1.0, 1.0), (BLACK + 0.04, 1.0, 0.86), (1.0, 1.0, 0.0),
           (1.0, -1.0, 0.0), (BLACK + 0.04, -1.0, 0.86), (BLACK - 0.04, -1.0, 1.0)]
TRAILING_PAIR = 3   # the pair (3, 4) has no face: the two trailing vertices coincide
# Where the black ends along the span: all of the arm, fading out just past the wrist.
SECONDARIES = (0.615, 0.675)
# The bands over which a wing vertex passes to a hinge: (from, to) at the leading edge and at the
# trailing edge (|x|, m), eased between by how far back on the chord the vertex lies.
ARM_BAND = ((0.070, 0.215), (0.070, 0.300))
HAND_BAND = ((0.535, 0.665), (0.420, 0.800))
# The hand ends in parted primaries ("fingers"), white on this crane: where along the hand's end
# each one roots (chord share), its angle from straight out (degrees, + forward), its length past
# the root and its width at the root; each tapers to a blunt tip `FINGER_TIP` of that wide.
FINGER_ROOT = 0.930
FINGERS = [
    (0.08, 14.0, 0.170, 0.085),
    (0.29, 5.0, 0.240, 0.095),
    (0.50, -6.0, 0.272, 0.095),
    (0.71, -18.0, 0.228, 0.095),
    (0.92, -32.0, 0.180, 0.088),
]
FINGER_TIP = 0.5


def band(spec, s, behind):
    (l0, l1), (t0, t1) = spec
    k = max(0.0, min(1.0, behind))
    return smooth(l0 + (t0 - l0) * k, l1 + (t1 - l1) * k, s)


def wing_colour(s, share):
    black = smooth(BLACK - 0.02, BLACK + 0.02, share) * (1.0 - smooth(SECONDARIES[0], SECONDARIES[1], s))
    return [PLUMAGE["white"][i] + (PLUMAGE["black"][i] - PLUMAGE["white"][i]) * black for i in range(3)]


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
            thin = smooth(0.25, 0.7, share) * (0.5 + 0.5 * smooth(0.45, 0.75, s))
            ring.append(b.vert((side * s, y, z), wing_colour(s, share), "wing", thin=thin,
                               arm=band(ARM_BAND, s, share), hand=band(HAND_BAND, s, share),
                               shade=0.94 if face < 0 else 1.0))
        rings.append(ring)
    end = STATIONS[-1] + 0.018
    tip = b.vert((side * end, WING_Y, (interp(LEADING, end) + interp(TRAILING, end)) / 2 - 0.01),
                 PLUMAGE["white"], "wing", thin=1.0, arm=1.0, hand=1.0)
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
        lift = 0.05 * length                      # the tips bend up a little under the load
        corners = []
        for u, w, dy in ((0.0, width, 0.0), (1.0, width * FINGER_TIP, lift)):
            for edge in (0.5, -0.5):
                corners.append((root[0] + along[0] * u * length + across[0] * edge * w, y + dy,
                                root[1] + along[1] * u * length + across[1] * edge * w))
        for up in (1.0, -1.0):
            quad = [b.vert((side * x, yy, z), PLUMAGE["white"], "wing", thin=1.0, arm=1.0,
                           hand=band(HAND_BAND, x, 0.5), shade=1.0 if up > 0 else 0.94)
                    for x, yy, z in corners]
            b.facing((quad[0], quad[1], quad[3], quad[2]), (0.0, up, 0.0))


def build_crane():
    b = Builder()
    build_body(b)
    build_neck(b)
    build_legs(b)
    build_wing(b, 1)
    build_wing(b, -1)
    return b


# ── The vertex stage's twin ───────────────────────────────────────────────────

def _turn(a, b, angle):
    c, s = math.cos(angle), math.sin(angle)
    return a * c - b * s, a * s + b * c


def pose(p, rig, arm=0.0, hand=0.0):
    """A vertex with the wing turned `arm` radians at the shoulder and `hand` at the wrist (+ up): the wrist first."""
    x, y, z = p
    side = 1.0 if x >= 0 else -1.0
    du, dy = _turn(abs(x) - WRIST[0], y - WRIST[1], hand * rig[1])
    du, dy = _turn(du + WRIST[0] - SHOULDER[0], dy + WRIST[1] - SHOULDER[1], arm * rig[0])
    return (side * (du + SHOULDER[0]), dy + SHOULDER[1], z)


# The wingbeat's four quarters, a glide and the flat rest pose, as (arm, hand): the theme's own
# beat runs through these (sakura-crane-routes.js: craneWingbeat).
POSES = [
    ("top", 0.58, 0.09),
    ("down", 0.06, 0.20),
    ("bottom", -0.46, -0.29),
    ("up", 0.06, -0.40),
    ("glide", 0.10, -0.14),
    ("flat", 0.0, 0.0),
]


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


def stored(built, i):
    """Vertex i and its shares as the module stores them (so the checks hold to the last bit)."""
    return tuple(round(c / QUANT) * QUANT for c in built.verts[i]), tuple(byte(x) / 255 for x in built.rig[i])


def checks(built):
    """A few telling vertices as the twin poses them: both wingtips, a wrist, an inner wing, the bill's tip."""
    out = []

    def nearest(target):
        return min(range(len(built.verts)), key=lambda i: sum((built.verts[i][k] - target[k]) ** 2 for k in range(3)))

    for target in ((1.2, WING_Y, 0.16), (-1.2, WING_Y, 0.16), (0.6, WING_Y, -0.28), (0.24, WING_Y, -0.34),
                   (0.0, BILL_TIP[1], BILL_TIP[0])):
        i = nearest(target)
        for arm, hand in ((0.58, 0.09), (-0.46, -0.29)):
            p, r = stored(built, i)
            out.append({"vertex": i, "arm": arm, "hand": hand, "at": [round(c, 5) for c in pose(p, r, arm, hand)]})
    return out


def write_module(path, built, mesh):
    triangles, normals = read_mesh(mesh)
    xs = [v[0] for v in built.verts]
    zs = [v[2] for v in built.verts]
    positions = [int(round(c / QUANT)) for v in built.verts for c in v]
    if max(abs(p) for p in positions) > 32767:
        raise RuntimeError(f"{TAG} the bird does not fit the stored positions")
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Sakura Twilight's red-crowned crane: GENERATED by scripts/blender/sakura_crane.py (do not",
        " * edit by hand). To write it again, byte for byte:",
        " *",
        " *     blender --background --factory-startup --python scripts/blender/sakura_crane.py -- \\",
        " *         --out src/themes/sakura-twilight",
        " *",
        " * The bird on the wing, wings spread flat, modelled in Blender. Game frame: x the bird's",
        " * left, y up, z forward; metres, real size. `positions` Int16 in units of `quant` metres,",
        " * `normals` Int8 (/ 127), `colours` Uint8 (linear r, g, b and `thin`: how much moonlight a",
        " * feather lets through; / 255), `rig` Uint8 (arm, hand, shade, unused; / 255: how much of the",
        " * shoulder's turn and of the wrist's turn a vertex takes, and how open it is to the sky),",
        " * `parts` Uint8 (an index into `parts`), `index` Uint16 triangles. `shoulder` and `wrist` are",
        " * the wing's two hinges (|x|, y: lines along z). `poses` are the wingbeat's quarters as the",
        " * script previews them (arm, hand: radians, + up); `checks` are vertices as the script's own",
        " * twin of the vertex stage poses them (the tests).",
        " */",
        "export const SAKURA_CRANE = Object.freeze({",
        f"    quant: {QUANT},",
        f"    parts: {json.dumps(PARTS)},",
        f"    shoulder: {json.dumps(list(SHOULDER))},",
        f"    wrist: {json.dumps(list(WRIST))},",
        f"    vertexCount: {len(built.verts)},",
        f"    triangleCount: {len(triangles)},",
        f"    span: {round(max(xs) - min(xs), 4)},",
        f"    length: {round(max(zs) - min(zs), 4)},",
        f"    poses: {json.dumps({name: [arm, hand] for name, arm, hand in POSES})},",
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
          f"length {max(zs) - min(zs):.3f} m")
    print(f"{TAG} wrote {path}")


# ── Previews (Workbench, orthographic lineups; each also at game size) ────────

GAME_PX = 30    # the bird's span on screen, pixels
ENLARGE = 8


def enlarge(path, out, times):
    """Write `path` again `times` larger, every pixel a square (no smoothing): what the game shows, readable."""
    import numpy as np
    image = bpy.data.images.load(str(path))
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    big = np.repeat(np.repeat(pixels.reshape(h, w, 4), times, axis=0), times, axis=1)
    result = bpy.data.images.new("SakuraCraneEnlarged", w * times, h * times, alpha=True)
    result.pixels.foreach_set(big.ravel())
    result.filepath_raw = str(out)
    result.file_format = "PNG"
    result.save()
    bpy.data.images.remove(image)
    bpy.data.images.remove(result)


def previews(scene, built, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    row = [(name, [pose(p, r, arm, hand) for p, r in zip(built.verts, built.rig)]) for name, arm, hand in POSES]
    for obj in scene.collection.objects:
        obj.hide_render = True
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_object_outline = False
    shading.show_cavity = False
    world = bpy.data.worlds.new("SakuraCraneWorld")
    scene.world = world
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    cam_data = bpy.data.cameras.new("SakuraCranePreviewCam")
    cam = bpy.data.objects.new("SakuraCranePreviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = "ORTHO"
    files = []
    views = {
        # name: the camera's direction (Blender frame: the bird flies toward -Y), its up, the lineup's axis
        "side": (Vector((-1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))),
        "below-front": (Vector((-0.42, 0.74, 0.52)).normalized(), Vector((0, 0, 1)), Vector((0.87, 0.5, 0)).normalized()),
        "below": (Vector((0, 0, 1)), Vector((0, -1, 0)), Vector((1, 0, 0))),
        "above": (Vector((0, 0, -1)), Vector((0, -1, 0)), Vector((1, 0, 0))),
        "front": (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))),
    }
    skies = {"night": (0.012, 0.012, 0.04), "snow": (0.36, 0.38, 0.6)}
    for view, (direction, up, axis) in views.items():
        spacing = 2.3 if view == "side" else 2.9
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
        jobs = [("", 1800, "night")] + [(f"-game-{sky}", round(width / SPAN * GAME_PX), sky) for sky in skies]
        for suffix, pixels, sky in jobs:
            world.color = skies[sky]
            scene.render.resolution_x = pixels
            scene.render.resolution_y = max(8, round(pixels * (0.2 if view == "side" else 0.3)))
            scene.render.resolution_percentage = 100
            path = out / f"crane-{view}{suffix}.png"
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
    built = build_crane()
    mesh = make_mesh("SakuraCrane", built)
    scene.collection.objects.link(bpy.data.objects.new("SakuraCrane", mesh))
    if out:
        path = Path(out)
        write_module(path if path.suffix == ".js" else path / MODULE, built, mesh)
    if preview_dir:
        for file in previews(scene, built, preview_dir):
            print(f"{TAG} preview {file}")


if __name__ == "__main__":
    main()
