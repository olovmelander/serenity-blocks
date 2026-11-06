"""Sunset's longtail boat, modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sunset_longtail.py -- \
        --out src/themes/sunset/sunset-longtail-model.js [--preview <dir>]

or from a live Blender (the MCP): `runpy.run_path(<this file>, run_name="sunset_longtail")["show"]()`
builds the same boat in a scene of its own ("SunsetLongtail"), one object a part, and leaves every
other scene alone.

A Thai longtail boat (ruea hang yao), the boat of the Andaman coast's evenings: a long, narrow
wooden hull whose bow sweeps up into a tall prow wrapped in coloured garlands and ribbons, a
faded tarp canopy on four poles over the middle, and at the stern a car engine on a pivot with
its long propeller shaft running out behind, low over the water and into it. The boatman stands
at the stern with the tiller; two passengers sit under the canopy; a lantern hangs from the
canopy's front bar and is lit by night.

The theme sees it from two or three hundred metres, 40 to 60 px long, so it is built for the
silhouette that names a longtail at a distance: the low hull, the high curved prow with its
spot of colour, the flat roof, the standing figure, and the shaft angling down astern. About
1,800 triangles, real size (11 m long); the waterline is y = 0.

The export reads every part back from Blender (evaluated, triangulated) into one mesh in the
game's frame: x the boat's left, y up, z forward (in Blender it faces -Y with its left on +X, as
the gull does). Per vertex a linear colour and a lamp flag (the lantern's glass). Parts that are
boxes and posts keep their faces flat (a vertex per face corner); the hull and the people are
smooth.

Deterministic: the same script writes the same file, headless or from the live session.
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

TAG = "[sunset-longtail]"
SCENE = "SunsetLongtail"

# ── Colours (sRGB hex → linear) ───────────────────────────────────────────────


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PAINT = {
    "hull": lin("#6e4528"),         # oiled teak
    "hullDark": lin("#3a2617"),     # wet wood at the waterline
    "band": lin("#d9d2bf"),         # the pale band along the sheer
    "rail": lin("#4d321f"),
    "deck": lin("#3b2819"),
    "tarp": lin("#3f6d93"),         # a sun-faded blue tarp
    "tarpUnder": lin("#2b4a64"),
    "pole": lin("#2a221c"),
    "engine": lin("#3b3e43"),
    "steel": lin("#8c939a"),
    "shirt": lin("#d8d0bf"),
    "trousers": lin("#2b2e35"),
    "skin": lin("#7b5236"),
    "hat": lin("#b9a27a"),
    "passenger1": lin("#b8433a"),
    "passenger2": lin("#e2c25a"),
    "lamp": lin("#ffd38a"),
    "lampFrame": lin("#2d2620"),
}
RIBBONS = [lin(h) for h in ("#e5458b", "#f2c22e", "#3daa58", "#efe9da", "#d8322f", "#8a4fd0", "#f07a2a")]

# ── The mesh, built as plain lists in the game frame ──────────────────────────


class Part:
    """One Blender object: vertices, faces, per-vertex colour and lamp flag, smooth or flat."""

    def __init__(self, name, smooth):
        self.name = name
        self.smooth = smooth
        self.verts = []
        self.faces = []
        self.colours = []

    def vert(self, p, colour, lamp=0.0):
        self.verts.append(tuple(float(v) for v in p))
        self.colours.append((colour[0], colour[1], colour[2], lamp))
        return len(self.verts) - 1

    def face(self, idx):
        self.faces.append(tuple(idx))

    def flat_face(self, points, colour, lamp=0.0):
        """A face of its own vertices (flat shading after the normals are computed per vertex)."""
        self.face([self.vert(p, colour, lamp) for p in points])

    def loft(self, rings, close_start=None, close_end=None, closed=True):
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(n if closed else n - 1):
                j = (i + 1) % n
                self.face((a[i], a[j], b[j], b[i]))
        if close_start is not None:
            r = rings[0]
            for i in range(n):
                self.face((close_start, r[(i + 1) % n], r[i]))
        if close_end is not None:
            r = rings[-1]
            for i in range(n):
                self.face((close_end, r[i], r[(i + 1) % n]))

    def orient(self, first, inside):
        """Turn the faces since `first` outward (away from `inside(centre)`) if most face in."""
        votes = 0.0
        for f in self.faces[first:]:
            p = [Vector(self.verts[i]) for i in f]
            n = (p[1] - p[0]).cross(p[2] - p[0])
            c = sum(p, Vector()) / len(p)
            votes += n.dot(c - Vector(inside(c)))
        if votes < 0:
            self.faces[first:] = [tuple(reversed(f)) for f in self.faces[first:]]


def v3(x, y, z):
    return Vector((float(x), float(y), float(z)))


def box(part, centre, size, colour, rot=None, lamp=0.0):
    """An axis box (optionally turned by `rot`, a 3x3 Matrix) with outward faces of their own."""
    c = Vector(centre)
    hx, hy, hz = (s / 2 for s in size)
    R = rot or Matrix.Identity(3)

    def p(sx, sy, sz):
        return tuple(c + R @ v3(sx * hx, sy * hy, sz * hz))

    faces = [
        ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)),      # +x
        ((-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1)),  # -x
        ((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)),      # +y
        ((-1, -1, 1), (-1, -1, -1), (1, -1, -1), (1, -1, 1)),  # -y
        ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)),      # +z
        ((1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)),  # -z
    ]
    for f in faces:
        part.flat_face([p(*q) for q in f], colour, lamp)


def rod(part, a, b, radius, colour, sides=5, lamp=0.0):
    """A thin post from a to b: flat sides, capped."""
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    ref = v3(0, 1, 0) if abs(axis.y) < 0.9 else v3(1, 0, 0)
    u = axis.cross(ref).normalized()
    w = axis.cross(u).normalized()
    ring = [u * math.cos(2 * math.pi * k / sides) * radius + w * math.sin(2 * math.pi * k / sides) * radius
            for k in range(sides)]
    for k in range(sides):
        j = (k + 1) % sides
        part.flat_face([tuple(a + ring[k]), tuple(a + ring[j]), tuple(b + ring[j]), tuple(b + ring[k])], colour, lamp)
    part.flat_face([tuple(b + ring[k]) for k in range(sides)], colour, lamp)
    part.flat_face([tuple(a + ring[k]) for k in reversed(range(sides))], colour, lamp)
    first = len(part.faces) - (sides + 2)
    mid = (a + b) / 2
    part.orient(first, lambda c: tuple(mid + axis * axis.dot(Vector(c) - mid)))


def blob(part, centre, radii, colour, rings=5, segs=8):
    """A smooth ellipsoid (heads, garland knots)."""
    c = Vector(centre)
    first = len(part.faces)
    top = part.vert(tuple(c + v3(0, radii[1], 0)), colour)
    bottom = part.vert(tuple(c - v3(0, radii[1], 0)), colour)
    rows = []
    for r in range(1, rings):
        phi = math.pi * r / rings
        row = []
        for s in range(segs):
            th = 2 * math.pi * s / segs
            row.append(part.vert(tuple(c + v3(radii[0] * math.sin(phi) * math.cos(th), radii[1] * math.cos(phi),
                                               radii[2] * math.sin(phi) * math.sin(th))), colour))
        rows.append(row)
    part.loft(rows, close_start=top, close_end=bottom)
    part.orient(first, lambda _p: tuple(c))


# The hull: stations from the transom to the prow's last ring, each
# (z, half beam, sheer height, keel depth); the waterline is y = 0.
STATIONS = [
    (-5.30, 0.56, 0.70, -0.12),
    (-4.90, 0.70, 0.66, -0.24),
    (-4.00, 0.83, 0.60, -0.33),
    (-2.60, 0.89, 0.56, -0.36),
    (-1.00, 0.91, 0.55, -0.37),
    (0.60, 0.89, 0.56, -0.36),
    (2.00, 0.81, 0.60, -0.33),
    (3.10, 0.65, 0.71, -0.28),
    (3.95, 0.45, 0.88, -0.19),
    (4.60, 0.28, 1.16, -0.07),
    (5.05, 0.16, 1.55, 0.2),
    (5.36, 0.08, 1.98, 0.62),
    (5.56, 0.035, 2.34, 1.14),
]
PROW_TIP = (0.0, 2.52, 5.74)
# Half a cross-section from the sheer down to the keel: (x / half beam, height up the side, 0..1).
SECTION = [(1.0, 1.0), (0.99, 0.72), (0.95, 0.47), (0.84, 0.27), (0.62, 0.11), (0.33, 0.03), (0.0, 0.0)]
DECK_DROP = 0.07   # the deck stands this far under the sheer
RAIL_IN = 0.06     # and this far in from the side


def hull_colour(y, top):
    """Wet dark wood at the waterline, oiled teak above, a pale band under the sheer."""
    if y < 0.05:
        return PAINT["hullDark"]
    if y > top - 0.13:
        return PAINT["band"]
    return PAINT["hull"]


def build_hull():
    part = Part("Hull", smooth=True)
    rings = []
    for z, hw, top, bot in STATIONS:
        ring = []
        # Port side from the sheer down to the keel, then starboard back up, then the deck's edge.
        side = [(x * hw, bot + (top - bot) * h) for x, h in SECTION]
        for x, y in side:
            ring.append(part.vert((x, y, z), hull_colour(y, top)))
        for x, y in reversed(side[:-1]):
            ring.append(part.vert((-x, y, z), hull_colour(y, top)))
        # The rail's top and the deck inside it (starboard, then port, closing the ring).
        inset = max(0.0, hw - RAIL_IN)
        ring.append(part.vert((-inset, top - DECK_DROP * 0.3, z), PAINT["rail"]))
        ring.append(part.vert((-inset * 0.96, top - DECK_DROP, z), PAINT["deck"]))
        ring.append(part.vert((inset * 0.96, top - DECK_DROP, z), PAINT["deck"]))
        ring.append(part.vert((inset, top - DECK_DROP * 0.3, z), PAINT["rail"]))
        rings.append(ring)
    first = len(part.faces)
    transom = part.vert((0.0, 0.25, STATIONS[0][0] - 0.02), PAINT["hull"])
    tip = part.vert(PROW_TIP, PAINT["hull"])
    part.loft(rings, close_start=transom, close_end=tip)

    def inside(c):
        z = max(STATIONS[0][0], min(STATIONS[-1][0], c[2]))
        for (z0, _hw0, top0, bot0), (z1, _hw1, top1, bot1) in zip(STATIONS, STATIONS[1:]):
            if z0 <= z <= z1:
                t = (z - z0) / (z1 - z0)
                return (0.0, (bot0 + (top0 - bot0) * 0.45) * (1 - t) + (bot1 + (top1 - bot1) * 0.45) * t, z)
        return (0.0, 0.3, z)

    part.orient(first, inside)
    return part


def build_garlands():
    """Ribbons and flower garlands wrapped round the prow and hanging from it: the boat's colour."""
    part = Part("Garlands", smooth=False)
    # Knots of garland round the stem just under the tip.
    knots = [(0.0, 2.36, 5.66), (0.0, 2.18, 5.59), (0.0, 2.0, 5.5), (0.0, 1.82, 5.4)]
    for k, c in enumerate(knots):
        blob(part, c, (0.14, 0.09, 0.13), RIBBONS[k % len(RIBBONS)], rings=3, segs=6)
    # Ribbons tied at the tip, hanging down and streaming back a little.
    for k in range(7):
        side = (k - 3) * 0.05
        top = v3(side, 2.42 - k * 0.03, 5.7 - k * 0.025)
        length = 0.75 + 0.18 * ((k * 37) % 5) / 4
        bottom = top + v3(side * 0.6, -length, -0.18 - 0.05 * (k % 3))
        across = v3(0.0, 0.0, 0.07)
        colour = RIBBONS[k % len(RIBBONS)]
        # Two triangles a ribbon, both ways round (they are seen from either side).
        quad = [tuple(top - across), tuple(top + across), tuple(bottom + across * 0.6), tuple(bottom - across * 0.6)]
        part.flat_face(quad, colour)
        part.flat_face(list(reversed(quad)), colour)
    # A small pennant on the tip.
    pole_top = v3(0.0, 2.88, 5.76)
    rod(part, PROW_TIP, tuple(pole_top), 0.012, PAINT["pole"], sides=3)
    flag = [tuple(pole_top), tuple(pole_top + v3(0, -0.16, 0)), tuple(pole_top + v3(0.0, -0.08, -0.32))]
    part.flat_face(flag, RIBBONS[4])
    part.flat_face(list(reversed(flag)), RIBBONS[4])
    return part


CANOPY = {"z0": -2.65, "z1": 1.25, "half": 0.84, "eave": 1.98, "ridge": 2.12, "rows": 6}


def build_canopy():
    part = Part("Canopy", smooth=False)
    c = CANOPY
    # Four poles from the deck to the eaves, and a bar across the front for the lantern.
    for x in (-c["half"] + 0.05, c["half"] - 0.05):
        for z in (c["z0"] + 0.1, c["z1"] - 0.1):
            rod(part, (x, 0.5, z), (x, c["eave"], z), 0.025, PAINT["pole"], sides=4)
    rod(part, (-c["half"] + 0.05, c["eave"] - 0.04, c["z1"] - 0.1), (c["half"] - 0.05, c["eave"] - 0.04, c["z1"] - 0.1),
        0.02, PAINT["pole"], sides=4)
    # The roof: a shallow arch across the boat, a tarp with an upper and an under side.
    n = c["rows"]
    xs = [-c["half"] + 2 * c["half"] * i / n for i in range(n + 1)]

    def y_at(x):
        return c["eave"] + (c["ridge"] - c["eave"]) * (1 - (x / c["half"]) ** 2)

    for x0, x1 in zip(xs, xs[1:]):
        a0, a1 = (x0, y_at(x0), c["z0"]), (x1, y_at(x1), c["z0"])
        b0, b1 = (x0, y_at(x0), c["z1"]), (x1, y_at(x1), c["z1"])
        part.flat_face([a1, a0, b0, b1], PAINT["tarp"])          # up
        part.flat_face([a0, a1, b1, b0], PAINT["tarpUnder"])     # down
    # Its hem hangs a hand over the sides.
    for x, sign in ((-c["half"], 1), (c["half"], -1)):
        top0, top1 = (x, c["eave"], c["z0"]), (x, c["eave"], c["z1"])
        bot0, bot1 = (x, c["eave"] - 0.14, c["z0"]), (x, c["eave"] - 0.14, c["z1"])
        quad = [top0, top1, bot1, bot0] if sign > 0 else [top1, top0, bot0, bot1]
        part.flat_face(quad, PAINT["tarp"])
        part.flat_face(list(reversed(quad)), PAINT["tarpUnder"])
    return part


ENGINE = {"centre": (0.0, 0.92, -5.25), "size": (0.5, 0.42, 0.72)}
SHAFT = {"from": (0.0, 0.84, -5.62), "to": (0.0, -0.28, -9.35)}
LANTERN = (0.0, 1.78, CANOPY["z1"] - 0.1)


def build_engine():
    part = Part("Engine", smooth=False)
    # The pivot post on the transom, the engine on it, a fuel tank behind, the shaft out astern.
    rod(part, (0.0, 0.55, -5.2), (0.0, 0.74, -5.2), 0.06, PAINT["steel"], sides=6)
    box(part, ENGINE["centre"], ENGINE["size"], PAINT["engine"])
    box(part, (0.0, 1.2, -5.25), (0.34, 0.16, 0.42), PAINT["engine"])
    box(part, (0.0, 1.08, -4.72), (0.26, 0.22, 0.28), PAINT["steel"])
    rod(part, SHAFT["from"], SHAFT["to"], 0.04, PAINT["steel"], sides=6)
    # The propeller's guard, half under water.
    prop = Vector(SHAFT["to"])
    box(part, tuple(prop + v3(0, 0.02, 0.1)), (0.08, 0.36, 0.08), PAINT["engine"])
    # The tiller: a pole forward and up from the engine to the boatman's hands.
    rod(part, (0.0, 1.02, -4.9), (0.28, 1.12, -3.85), 0.025, PAINT["steel"], sides=4)
    return part


def figure(part, feet, facing, shirt, standing=True):
    """A person: legs, a body, arms and a head with a hat, `facing` the way the front looks."""
    f = Vector(feet)
    fwd = v3(math.sin(facing), 0, math.cos(facing))
    left = v3(fwd.z, 0, -fwd.x)
    R = Matrix((left, v3(0, 1, 0), fwd)).transposed()
    if standing:
        for s in (-1, 1):
            box(part, tuple(f + left * 0.1 * s + v3(0, 0.42, 0)), (0.13, 0.84, 0.15), PAINT["trousers"], R)
        hip = 0.84
    else:
        box(part, tuple(f + v3(0, 0.12, 0) + fwd * 0.2), (0.34, 0.16, 0.42), PAINT["trousers"], R)
        hip = 0.2
    box(part, tuple(f + v3(0, hip + 0.3, 0)), (0.38, 0.6, 0.22), shirt, R)
    for s in (-1, 1):
        reach = fwd * (0.22 if standing and s > 0 else 0.08)
        box(part, tuple(f + left * 0.24 * s + v3(0, hip + 0.32, 0) + reach), (0.09, 0.5, 0.11), shirt, R)
    head = f + v3(0, hip + 0.74, 0)
    blob(part, tuple(head), (0.11, 0.13, 0.11), PAINT["skin"], rings=4, segs=7)
    blob(part, tuple(head + v3(0, 0.1, 0)), (0.15, 0.06, 0.15), PAINT["hat"], rings=3, segs=8)


def build_people():
    part = Part("People", smooth=False)
    deck = STATIONS[1][2] - DECK_DROP
    # The boatman at the stern, turned a little toward the tiller in his right hand.
    figure(part, (0.12, deck, -4.35), 0.18, PAINT["shirt"], standing=True)
    # Two passengers under the canopy, facing forward.
    figure(part, (0.3, 0.49, -1.6), 0.0, PAINT["passenger1"], standing=False)
    figure(part, (-0.32, 0.49, -0.1), 0.0, PAINT["passenger2"], standing=False)
    return part


def build_lantern():
    part = Part("Lantern", smooth=False)
    c = Vector(LANTERN)
    rod(part, tuple(c + v3(0, 0.08, 0)), (0.0, CANOPY["eave"] - 0.05, LANTERN[2]), 0.008, PAINT["lampFrame"], sides=3)
    box(part, tuple(c), (0.13, 0.17, 0.13), PAINT["lamp"], lamp=1.0)
    box(part, tuple(c + v3(0, 0.1, 0)), (0.16, 0.03, 0.16), PAINT["lampFrame"])
    return part


def build_parts():
    return [build_hull(), build_garlands(), build_canopy(), build_engine(), build_people(), build_lantern()]


# ── Blender: one object a part ────────────────────────────────────────────────

def to_b(p):
    return (p[0], -p[2], p[1])


def to_g(p):
    return (p[0], p[2], -p[1])


def build_objects(scene):
    objects = []
    for part in build_parts():
        mesh = bpy.data.meshes.new(f"SunsetLongtail{part.name}")
        mesh.from_pydata([to_b(v) for v in part.verts], [], [tuple(f) for f in part.faces])
        mesh.update()
        col = mesh.color_attributes.new("paint", "FLOAT_COLOR", "POINT")
        for i, c in enumerate(part.colours):
            col.data[i].color = (c[0], c[1], c[2], 1.0)
        lamp = mesh.attributes.new("lamp", "FLOAT", "POINT")
        for i, c in enumerate(part.colours):
            lamp.data[i].value = c[3]
        for poly in mesh.polygons:
            poly.use_smooth = part.smooth
        obj = bpy.data.objects.new(f"Longtail {part.name}", mesh)
        scene.collection.objects.link(obj)
        objects.append((part, obj))
    return objects


def read_back(scene, objects):
    """Every part as Blender evaluates it, triangulated, in the game frame, flat parts split per face."""
    # A scene of its own has no depsgraph until a frame is set on it.
    scene.frame_set(scene.frame_current)
    depsgraph = scene.view_layers[0].depsgraph
    verts, colours, tris = [], [], []
    for part, obj in objects:
        ev = obj.evaluated_get(depsgraph)
        mesh = ev.to_mesh()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        paint = bm.verts.layers.float_color.get("paint")
        lamp = bm.verts.layers.float.get("lamp")
        bm.verts.ensure_lookup_table()
        if part.smooth:
            base = len(verts)
            for v in bm.verts:
                verts.append(to_g(v.co))
                c = v[paint]
                colours.append((c[0], c[1], c[2], v[lamp]))
            for f in bm.faces:
                tris.append(tuple(base + v.index for v in f.verts))
        else:
            for f in bm.faces:
                ids = []
                for v in f.verts:
                    verts.append(to_g(v.co))
                    c = v[paint]
                    colours.append((c[0], c[1], c[2], v[lamp]))
                    ids.append(len(verts) - 1)
                tris.append(tuple(ids))
        bm.free()
        ev.to_mesh_clear()
    return verts, colours, tris


# ── The module the theme imports ──────────────────────────────────────────────

QUANT = 1e-3  # metres per unit of the stored positions


def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def write_module(path, verts, colours, tris):
    positions = [int(round(c / QUANT)) for v in verts for c in v]
    index = [i for t in tris for i in t]
    paint = []
    for r, g, b, lamp in colours:
        paint.extend(int(round(max(0.0, min(1.0, x)) * 255)) for x in (r, g, b, lamp))
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Sunset's longtail boat: GENERATED by scripts/blender/sunset_longtail.py (do not edit by hand).",
        " *",
        " * A Thai longtail boat modelled in Blender. Game frame: x the boat's left, y up, z forward",
        " * (the bow); metres, real size, the waterline at y = 0. `positions` are Int16 in units of",
        " * `quant` metres; `index` Uint16 triangles; `colours` Uint8 linear paint (r, g, b, and the",
        " * lantern's glass / 255). `lantern` is where the lamp hangs; `stern` and `bow` the hull's ends",
        " * and `propeller` where the shaft enters the sea (the wake starts there).",
        " */",
        "export const SUNSET_LONGTAIL = Object.freeze({",
        f"    quant: {QUANT},",
        f"    vertexCount: {len(verts)},",
        f"    triangleCount: {len(tris)},",
        f"    length: {round(max(zs) - min(zs), 3)},",
        f"    beam: {round(max(xs) - min(xs), 3)},",
        f"    height: {round(max(ys), 3)},",
        f"    lantern: {json.dumps([round(c, 3) for c in LANTERN])},",
        f"    stern: {STATIONS[0][0]},",
        f"    bow: {PROW_TIP[2]},",
        f"    propeller: {json.dumps([round(c, 3) for c in SHAFT['to']])},",
        f"    positions: '{b64('h', positions)}',",
        f"    index: '{b64('H', index)}',",
        f"    colours: '{b64('B', paint)}',",
        "});",
        "",
    ]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


def export(scene, objects, path):
    verts, colours, tris = read_back(scene, objects)
    if len(verts) >= 65536:
        raise RuntimeError(f"{TAG} {len(verts)} vertices do not fit a Uint16 index")
    write_module(path, verts, colours, tris)
    print(f"{TAG} wrote {path}: {len(verts)} vertices, {len(tris)} triangles")
    return {"vertices": len(verts), "triangles": len(tris)}


# ── Previews (Workbench, the paint as vertex colour) ──────────────────────────

def previews(scene, objects, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_object_outline = False
    shading.show_cavity = False
    world = scene.world or bpy.data.worlds.new("SunsetLongtailWorld")
    scene.world = world
    world.color = (0.62, 0.66, 0.72)
    scene.view_settings.view_transform = "Standard"
    cam_data = bpy.data.cameras.get("SunsetLongtailPreviewCam") or bpy.data.cameras.new("SunsetLongtailPreviewCam")
    cam = bpy.data.objects.get("SunsetLongtailPreviewCam") or bpy.data.objects.new("SunsetLongtailPreviewCam", cam_data)
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    centre = Vector(to_b((0.0, 1.05, -1.6)))
    views = {
        # name: direction from the boat to the camera (game frame), ortho scale, width, height
        "side": ((1.0, 0.0, 0.0), 15.5, 1800, 520),
        "three-quarter": ((0.8, 0.32, 0.55), 15.0, 1600, 760),
        "front": ((0.0, 0.08, 1.0), 4.2, 700, 700),
        "top": ((0.0, 1.0, 0.0001), 15.5, 1800, 420),
        "far": ((1.0, 0.012, 0.18), 16.5, 1800, 420),
    }
    files = []
    for name, (direction, scale, w, h) in views.items():
        d = Vector(to_b(direction)).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.99 else Vector((0, 1, 0))
        right = up.cross(d).normalized()
        true_up = d.cross(right).normalized()
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = Matrix((right, true_up, d)).transposed().to_quaternion()
        cam.location = centre + d * 40.0
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = scale
        cam_data.clip_end = 200
        scene.render.resolution_x = w
        scene.render.resolution_y = h
        scene.render.resolution_percentage = 100
        if name == "far":
            # A silhouette against an evening sky, as the theme sees it at a low sun.
            shading.light = "FLAT"
            shading.color_type = "SINGLE"
            shading.single_color = (0.02, 0.016, 0.018)
            world.color = (0.95, 0.42, 0.14)
        path = out / f"longtail-{name}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        files.append(str(path))
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    world.color = (0.62, 0.66, 0.72)
    return files


# ── Entry points ──────────────────────────────────────────────────────────────

def show(preview_dir=None, export_path=None):
    """Live Blender (the MCP): the boat in a scene of its own; nothing else touched."""
    old = bpy.data.scenes.get(SCENE)
    if old is not None:
        for o in list(old.objects):
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Camera):
                    bpy.data.cameras.remove(data)
        bpy.data.scenes.remove(old)
    scene = bpy.data.scenes.new(SCENE)
    objects = build_objects(scene)
    report = {"parts": [p.name for p, _o in objects]}
    if export_path:
        report.update(export(scene, objects, export_path))
    if preview_dir:
        report["previews"] = previews(scene, objects, preview_dir)
    window = getattr(bpy.context, "window", None)
    if window is not None:
        window.scene = scene
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
    # The same scene of its own the live session builds, so both write the same file.
    scene = bpy.data.scenes.new(SCENE)
    objects = build_objects(scene)
    if out:
        export(scene, objects, out)
    if preview_dir:
        for f in previews(scene, objects, preview_dir):
            print(f"{TAG} preview {f}")


if __name__ == "__main__":
    main()
