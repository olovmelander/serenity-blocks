"""Sunset's lotus lantern, modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/sunset_lantern.py -- \
        --out src/themes/sunset/sunset-lantern-model.js [--preview <dir>]

or from a live Blender (the MCP): `runpy.run_path(<this file>, run_name="sunset_lantern")["show"]()`
builds the same lantern in a scene of its own ("SunsetLantern"), one object a part, and leaves
every other scene alone.

What a locked piece sets on the sea: a paper lotus afloat with a lantern standing in it. A small
dark wooden disc sits in the water; round it lie two rings of folded paper petals, the outer ones
open on the water, the inner ones cupped up round the lantern's foot, each a pointed leaf with a
crease down its middle; and out of the flower rises the lantern, a bud of eight paper gores
swelling between thin bamboo ribs, a bamboo hoop at its mouth and at its crown, open at the top,
its flame low inside. The petals are not quite alike (each has its own reach, pitch and roll, from
a fixed hash), as folded paper is not.

The theme draws 48 to 64 of them at once, the nearest 60 to 100 px tall and most of them 25 to
60 px, so it is built for what reads at that size: the star of open petals, the bud's outline,
the dark ring of the open top. 680 triangles, real size (0.66 m tall, 0.4 m across the bud,
about 0.64 m across the open petals); the waterline is y = 0 (the float sits 26 mm into the
water) and the flame burns on the axis at `FLAME`.

Nothing here is textured. Per vertex the export carries a normal (Blender's own: creased where
the mesh is split, along the ribs and down each petal's fold) and one RGBA8 colour that the
theme's shader lights the paper with:

    r   how far up: 0 at the paper's mouth to 1 at its crown; along a petal, 0 at its base to 1
        at its tip; on the wood 0 (the float, the lower hoop) or 1 (the upper hoop)
    g   ambient occlusion, baked here by casting rays at the mesh itself (1 open, 0 shut in)
    b   the dark lines: 1 along a bamboo rib (0 across the middle third of a gore), 1 down a
        petal's fold (0 at its edges); 0 on the wood
    a   the part: 0 the lantern's paper, 0.5 a petal, 1 wood and bamboo

Game frame: x right, y up, z toward the eye (in Blender the lantern stands on Z, as the gull and
the longtail do: x, -z, y).

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
from mathutils.bvhtree import BVHTree

TAG = "[sunset-lantern]"
SCENE = "SunsetLantern"

# ── The lantern's measures (metres, game frame: y up, the waterline at y = 0) ──

GORES = 8
# The float: a small dark disc that sits in the water.
DISC = {"radius": 0.088, "foot": 0.08, "top": 0.03, "bottom": -0.026, "sides": 10}
# The paper bud: from its mouth (on the lower hoop) to its crown (under the upper hoop).
PAPER = {"y0": 0.066, "y1": 0.644, "mouth": 0.09, "belly": 0.184, "crown": 0.114, "widest": 0.55}
# How far a gore swells out past its ribs at the belly, and where across a gore its mesh bends
# (two lines between the ribs: with one, the rib is not a valley but the middle of a flat).
PUFF = 0.085
ACROSS = ((0.0, 1.0), (1 / 3, 0.0), (2 / 3, 0.0), (1.0, 1.0))
# Rows of the paper (0 at the mouth, 1 at the crown): closer where the outline turns.
ROWS = [0.0, 0.15, 0.33, 0.52, 0.7, 0.87, 1.0]
HOOP = {"lower": (0.05, 0.066), "upper": (0.644, 0.66), "proud": 0.004}
# Where the flame burns (the theme's halo stands at 0.26 m).
FLAME = (0.0, 0.26, 0.0)

# The petals: each ring is `count` leaves, the first at `phase` (turns of a petal's step); a leaf
# runs out along `line` ((radius, height) from its base to its tip) and is `widths` wide (half
# widths at the same stations; the tip is a point); `cup` lifts its edges over its fold.
RINGS = [
    {
        "name": "Outer", "count": 8, "phase": 0.0, "cup": 0.42,
        "line": [(0.09, 0.042), (0.14, 0.022), (0.192, 0.016), (0.242, 0.028), (0.282, 0.058), (0.312, 0.104)],
        "widths": [0.032, 0.058, 0.076, 0.074, 0.046],
    },
    {
        "name": "Inner", "count": 8, "phase": 0.5, "cup": 0.5,
        "line": [(0.08, 0.05), (0.11, 0.066), (0.142, 0.094), (0.17, 0.13), (0.192, 0.172), (0.208, 0.218)],
        "widths": [0.03, 0.05, 0.062, 0.058, 0.037],
    },
]

PART_PAPER, PART_PETAL, PART_WOOD = 0, 1, 2


def noise(i, k):
    """A fixed number in 0..1 for petal `i`, draw `k` (an integer hash: the same everywhere)."""
    a = (i * 0x9E3779B1 + k * 0x85EBCA6B + 0x6D2B79F5) & 0xFFFFFFFF
    a ^= a >> 15
    a = (a * 0x2C1B3C6D) & 0xFFFFFFFF
    a ^= a >> 12
    a = (a * 0x297A2D39) & 0xFFFFFFFF
    a ^= a >> 15
    return a / 4294967296.0


# ── The mesh, built as plain lists in the game frame ──────────────────────────


class Part:
    """One Blender object: vertices, faces, and per vertex (up, edge, part). Smooth: its normals
    are Blender's vertex normals, so a crease is a seam of doubled vertices."""

    def __init__(self, name, kind, casts=True):
        self.name = name
        self.kind = kind
        # Whether it shades the rest (the hoops lie flush on the paper they bind: they do not).
        self.casts = casts
        self.verts = []
        self.faces = []
        self.data = []

    def vert(self, p, up=0.0, edge=0.0):
        self.verts.append(tuple(float(v) for v in p))
        self.data.append((float(up), float(edge)))
        return len(self.verts) - 1

    def face(self, idx):
        self.faces.append(tuple(idx))


def v3(x, y, z):
    return Vector((float(x), float(y), float(z)))


def radial(theta):
    return v3(math.cos(theta), 0.0, math.sin(theta))


def tangent(theta):
    return v3(-math.sin(theta), 0.0, math.cos(theta))


UP = v3(0, 1, 0)


def paper_radius(v):
    """The bud's outline along its ribs: out from the mouth to the belly, rounding in to the crown."""
    p = PAPER
    if v <= p["widest"]:
        t = math.sin(0.5 * math.pi * v / p["widest"])
        return p["mouth"] + (p["belly"] - p["mouth"]) * t ** 1.25
    t = math.cos(0.5 * math.pi * (v - p["widest"]) / (1 - p["widest"]))
    return p["crown"] + (p["belly"] - p["crown"]) * t ** 0.85


def gore_swell(v):
    """How far the middle of a gore stands out past its ribs: most at the belly, none at the hoops."""
    return 1.0 + PUFF * math.sin(math.pi * v) ** 0.7


def build_paper():
    """Eight gores, each its own strip (the ribs are seams, so the paper creases along them)."""
    part = Part("Paper", PART_PAPER)
    p = PAPER
    step = 2 * math.pi / GORES
    for g in range(GORES):
        columns = []
        for frac, edge in ACROSS:
            theta = (g + frac) * step
            column = []
            for v in ROWS:
                r = paper_radius(v) * (gore_swell(v) if edge == 0.0 else 1.0)
                y = p["y0"] + (p["y1"] - p["y0"]) * v
                column.append(part.vert(radial(theta) * r + UP * y, up=v, edge=edge))
            columns.append(column)
        for a, b in zip(columns, columns[1:]):
            for j in range(len(ROWS) - 1):
                part.face((a[j], a[j + 1], b[j + 1], b[j]))
    return part


def build_hoops():
    """The bamboo hoops at the mouth and the crown, a hair proud of the paper."""
    part = Part("Hoops", PART_WOOD, casts=False)
    sides = GORES * 2
    for (y0, y1), radius, up in (
        (HOOP["lower"], PAPER["mouth"] + HOOP["proud"], 0.0),
        (HOOP["upper"], PAPER["crown"] + HOOP["proud"], 1.0),
    ):
        low = [part.vert(radial(2 * math.pi * k / sides) * radius + UP * y0, up=up) for k in range(sides)]
        high = [part.vert(radial(2 * math.pi * k / sides) * radius + UP * y1, up=up) for k in range(sides)]
        for k in range(sides):
            j = (k + 1) % sides
            part.face((low[k], high[k], high[j], low[j]))
    return part


def build_float():
    """The disc in the water: its rim, and a top and a bottom of their own (flat)."""
    d = DISC
    n = d["sides"]
    rim = Part("FloatRim", PART_WOOD)
    low = [rim.vert(radial(2 * math.pi * k / n) * d["foot"] + UP * d["bottom"]) for k in range(n)]
    high = [rim.vert(radial(2 * math.pi * k / n) * d["radius"] + UP * d["top"]) for k in range(n)]
    for k in range(n):
        j = (k + 1) % n
        rim.face((low[k], high[k], high[j], low[j]))
    top = Part("FloatTop", PART_WOOD)
    centre = top.vert((0, d["top"], 0))
    ring = [top.vert(radial(2 * math.pi * k / n) * d["radius"] + UP * d["top"]) for k in range(n)]
    for k in range(n):
        top.face((centre, ring[(k + 1) % n], ring[k]))
    bottom = Part("FloatBottom", PART_WOOD)
    centre = bottom.vert((0, d["bottom"], 0))
    ring = [bottom.vert(radial(2 * math.pi * k / n) * d["foot"] + UP * d["bottom"]) for k in range(n)]
    for k in range(n):
        bottom.face((centre, ring[k], ring[(k + 1) % n]))
    return [rim, top, bottom]


def build_ring(index, ring):
    """A ring of folded paper petals. Each is two halves that meet along its fold (a seam, so the
    fold is a crease), its upper face toward the flame; no two are quite alike."""
    part = Part(f"Petals{ring['name']}", PART_PETAL)
    count = ring["count"]
    stations = len(ring["line"])
    for i in range(count):
        key = index * 100 + i
        theta = 2 * math.pi * (i + ring["phase"]) / count + (noise(key, 0) - 0.5) * 0.09
        reach = 1.0 + (noise(key, 1) - 0.5) * 0.1
        pitch = (noise(key, 2) - 0.5) * 0.14
        roll = (noise(key, 3) - 0.5) * 0.3
        er, et = radial(theta), tangent(theta)
        # The fold's line, in (radius, height): stretched a little and tipped about its base.
        r0, y0 = ring["line"][0]
        line = []
        for r, y in ring["line"]:
            dr, dy = (r - r0) * reach, (y - y0) * reach
            line.append((
                r0 + dr * math.cos(pitch) - dy * math.sin(pitch),
                y0 + dr * math.sin(pitch) + dy * math.cos(pitch),
            ))
        rows = []
        for s in range(stations - 1):
            a = line[max(0, s - 1)]
            b = line[s + 1]
            tr, ty = b[0] - a[0], b[1] - a[1]
            length = math.hypot(tr, ty)
            # The leaf's upper side: the fold's direction turned a quarter toward the flame.
            normal = er * (-ty / length) + UP * (tr / length)
            centre = er * line[s][0] + UP * line[s][1]
            w = ring["widths"][s]
            along = s / (stations - 1)
            left = centre - et * w + normal * (ring["cup"] * w * (1 - roll))
            right = centre + et * w + normal * (ring["cup"] * w * (1 + roll))
            rows.append((
                part.vert(left, up=along, edge=0.0),
                part.vert(centre, up=along, edge=1.0),
                part.vert(centre, up=along, edge=1.0),
                part.vert(right, up=along, edge=0.0),
            ))
        tip = er * line[-1][0] + UP * line[-1][1]
        tip_left = part.vert(tip, up=1.0, edge=1.0)
        tip_right = part.vert(tip, up=1.0, edge=1.0)
        for a, b in zip(rows, rows[1:]):
            # Each half in two triangles, mirrored about the fold.
            part.face((a[0], a[1], b[1]))
            part.face((a[0], b[1], b[0]))
            part.face((a[2], a[3], b[2]))
            part.face((a[3], b[3], b[2]))
        last = rows[-1]
        part.face((last[0], last[1], tip_left))
        part.face((last[2], last[3], tip_right))
    return part


def build_parts():
    return [build_paper(), build_hoops(), *build_float(), *(build_ring(i, ring) for i, ring in enumerate(RINGS))]


# ── Blender: one object a part ────────────────────────────────────────────────

def to_b(p):
    return (p[0], -p[2], p[1])


def to_g(p):
    return (p[0], p[2], -p[1])


def build_objects(scene):
    objects = []
    for part in build_parts():
        mesh = bpy.data.meshes.new(f"SunsetLantern{part.name}")
        mesh.from_pydata([to_b(v) for v in part.verts], [], [tuple(f) for f in part.faces])
        mesh.update()
        up = mesh.attributes.new("up", "FLOAT", "POINT")
        edge = mesh.attributes.new("edge", "FLOAT", "POINT")
        for i, (u, e) in enumerate(part.data):
            up.data[i].value = u
            edge.data[i].value = e
        for poly in mesh.polygons:
            poly.use_smooth = True
        obj = bpy.data.objects.new(f"Lantern {part.name}", mesh)
        scene.collection.objects.link(obj)
        objects.append((part, obj))
    return objects


def read_back(scene, objects):
    """Every part as Blender evaluates it, triangulated, in the game frame, with Blender's normals."""
    # A scene of its own has no depsgraph until a frame is set on it.
    scene.frame_set(scene.frame_current)
    depsgraph = scene.view_layers[0].depsgraph
    verts, normals, data, tris, casts = [], [], [], [], []
    for part, obj in objects:
        ev = obj.evaluated_get(depsgraph)
        mesh = ev.to_mesh()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
        up = bm.verts.layers.float.get("up")
        edge = bm.verts.layers.float.get("edge")
        bm.verts.ensure_lookup_table()
        base = len(verts)
        for v in bm.verts:
            verts.append(to_g(v.co))
            normals.append(to_g(v.normal))
            data.append((v[up], v[edge], part.kind))
        for f in bm.faces:
            tris.append(tuple(base + v.index for v in f.verts))
            casts.append(part.casts)
        bm.free()
        ev.to_mesh_clear()
    return verts, normals, data, tris, casts


# ── Ambient occlusion: rays from every vertex at the mesh itself ──────────────

AO_RAYS = 160
AO_REACH = 0.45


def bake_occlusion(verts, normals, tris, casts):
    """How open each vertex is to the sky on its own side (1 open, 0 shut in): cosine-weighted
    rays over the hemisphere round its normal, a near hit counting for more than a far one."""
    shading = [tuple(t) for t, cast in zip(tris, casts) if cast]
    tree = BVHTree.FromPolygons([Vector(v) for v in verts], shading, all_triangles=True)
    golden = math.pi * (3 - math.sqrt(5))
    out = []
    for p, n in zip(verts, normals):
        n = Vector(n).normalized()
        ref = v3(0, 1, 0) if abs(n.y) < 0.9 else v3(1, 0, 0)
        u = n.cross(ref).normalized()
        w = n.cross(u)
        origin = Vector(p) + n * 0.003
        shut = 0.0
        for k in range(AO_RAYS):
            t = (k + 0.5) / AO_RAYS
            r = math.sqrt(t)
            phi = k * golden
            d = u * (r * math.cos(phi)) + w * (r * math.sin(phi)) + n * math.sqrt(1 - t)
            hit = tree.ray_cast(origin, d, AO_REACH)
            if hit[0] is not None:
                shut += 1 - hit[3] / AO_REACH
        out.append(max(0.0, 1 - shut / AO_RAYS))
    return out


# ── The module the theme imports ──────────────────────────────────────────────

QUANT = 5e-4  # metres per unit of the stored positions


def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def unit8(x):
    return int(round(max(0.0, min(1.0, x)) * 255))


def pack(verts, normals, data, occlusion):
    """The stored arrays: Int16 positions, Int8 normals, RGBA8 (up, occlusion, edge, part)."""
    positions = [int(round(c / QUANT)) for v in verts for c in v]
    packed_normals = []
    for n in normals:
        n = Vector(n).normalized()
        packed_normals.extend(int(round(c * 127)) for c in n)
    colours = []
    for (up, edge, kind), ao in zip(data, occlusion):
        colours.extend((unit8(up), unit8(ao), unit8(edge), unit8(kind / 2)))
    return positions, packed_normals, colours


def write_module(path, verts, tris, positions, normals, colours):
    index = [i for t in tris for i in t]
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    widest = round(PAPER["belly"] * (1 + PUFF), 4)
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Sunset's lotus lantern: GENERATED by scripts/blender/sunset_lantern.py (do not edit by hand).",
        " *",
        " * A paper lotus afloat with a lantern standing in it, modelled in Blender: a dark disc in the",
        " * water, two rings of folded petals, and a bud of eight paper gores between bamboo ribs, hooped",
        " * at its mouth and its crown, open at the top. Game frame: y up, metres, real size, the",
        " * waterline at y = 0, the axis at x = z = 0.",
        " *",
        " *   positions   Int16 xyz in units of `quant` metres",
        " *   normals     Int8 xyz, a unit vector x 127 (creased along the ribs and each petal's fold)",
        " *   index       Uint16 triangles, counter-clockwise seen from outside (a petal: from above)",
        " *   colours     Uint8 rgba, what the shader lights the paper with (each / 255):",
        " *                 r  how far up: 0 at the paper's mouth to 1 at its crown; along a petal, 0 at",
        " *                    its base to 1 at its tip; on the wood 0 (float, lower hoop) or 1 (upper hoop)",
        " *                 g  baked ambient occlusion on the side its normal faces (1 open to the",
        " *                    sky, 0 shut in; the hoops cast none on the paper they bind)",
        " *                 b  the dark lines: 1 along a bamboo rib (0 across the middle third of a",
        " *                    gore), 1 down a petal's fold (0 at its edges), 0 on the wood",
        " *                 a  the part: 0 the lantern's paper, 0.5 (128) a petal, 1 wood and bamboo",
        " *",
        " * `flame` is where the flame burns; `paper` the bud's mouth and crown heights and its widest",
        " * radius; `float` the disc's radius and how deep it sits.",
        " */",
        "export const SUNSET_LANTERN = Object.freeze({",
        f"    quant: {QUANT},",
        f"    vertexCount: {len(verts)},",
        f"    triangleCount: {len(tris)},",
        f"    height: {round(max(ys), 4)},",
        f"    depth: {round(-min(ys), 4)},",
        f"    width: {round(max(max(xs) - min(xs), max(zs) - min(zs)), 4)},",
        f"    gores: {GORES},",
        f"    petals: {json.dumps([ring['count'] for ring in RINGS])},",
        f"    flame: {json.dumps([round(c, 4) for c in FLAME])},",
        f"    paper: Object.freeze({{ mouth: {PAPER['y0']}, crown: {PAPER['y1']}, radius: {widest} }}),",
        f"    float: Object.freeze({{ radius: {DISC['radius']}, top: {DISC['top']}, bottom: {DISC['bottom']} }}),",
        f"    positions: '{b64('h', positions)}',",
        f"    normals: '{b64('b', normals)}',",
        f"    index: '{b64('H', index)}',",
        f"    colours: '{b64('B', colours)}',",
        "});",
        "",
    ]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


def gather(scene, objects):
    verts, normals, data, tris, casts = read_back(scene, objects)
    if len(verts) >= 65536:
        raise RuntimeError(f"{TAG} {len(verts)} vertices do not fit a Uint16 index")
    occlusion = bake_occlusion(verts, normals, tris, casts)
    return {"verts": verts, "normals": normals, "data": data, "tris": tris, "occlusion": occlusion}


def export(model, path):
    positions, normals, colours = pack(model["verts"], model["normals"], model["data"], model["occlusion"])
    write_module(path, model["verts"], model["tris"], positions, normals, colours)
    print(f"{TAG} wrote {path}: {len(model['verts'])} vertices, {len(model['tris'])} triangles")
    return {"vertices": len(model["verts"]), "triangles": len(model["tris"])}


# ── Previews (Workbench): the exported mesh in a paper's daylight and by its flame ──

def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PREVIEW_PIECE = lin("#ff4d8f")
WOOD = (0.03, 0.02, 0.015)


def preview_colours(model, night):
    """A stand-in for the theme's shader, per vertex: the paper in daylight (its tint, paler to a
    petal's tip, the occlusion in its folds, the ribs dark), or lit by its flame alone."""
    flame = Vector(FLAME)
    out = []
    for p, n, (up, edge, kind), ao in zip(model["verts"], model["normals"], model["data"], model["occlusion"]):
        piece = Vector(PREVIEW_PIECE)
        white = Vector((1.0, 0.96, 0.9))
        if kind == PART_WOOD:
            c = Vector(WOOD) * (1.0 if not night else 0.6)
        elif kind == PART_PAPER:
            line = 1 - 0.55 * max(0.0, (edge - 0.72) / 0.28)
            if night:
                heart = 0.45 + 1.5 * math.exp(-(((up - 0.34) / 0.3) ** 2))
                c = (piece * 0.8 + Vector((1.0, 0.72, 0.38)) * 0.2) * heart * line
            else:
                c = (piece * 0.72 + white * 0.28) * (0.35 + 0.65 * ao) * line
        else:
            tint = piece * (1 - 0.45 * up) + white * (0.45 * up)
            fold = 1 - 0.35 * max(0.0, (edge - 0.8) / 0.2)
            if night:
                to = flame - Vector(p)
                facing = max(0.0, Vector(n).normalized().dot(to.normalized()))
                c = tint * (0.08 + 1.3 * facing * (1 - 0.75 * up)) * fold
            else:
                c = tint * (0.35 + 0.65 * ao) * fold
        out.append((c[0], c[1], c[2], 1.0))
    return out


def preview_object(scene, model, name, night):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_b(v) for v in model["verts"]], [], [tuple(t) for t in model["tris"]])
    mesh.update()
    col = mesh.color_attributes.new("preview", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(preview_colours(model, night)):
        col.data[i].color = c
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.normals_split_custom_set_from_vertices([Vector(to_b(n)).normalized() for n in model["normals"]])
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def previews(scene, objects, model, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for _part, obj in objects:
        obj.hide_render = True
    day = preview_object(scene, model, "SunsetLanternPreviewDay", night=False)
    night = preview_object(scene, model, "SunsetLanternPreviewNight", night=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.color_type = "VERTEX"
    shading.show_object_outline = False
    shading.show_cavity = False
    shading.show_backface_culling = False
    world = scene.world or bpy.data.worlds.new("SunsetLanternWorld")
    scene.world = world
    scene.view_settings.view_transform = "Standard"
    cam_data = bpy.data.cameras.get("SunsetLanternPreviewCam") or bpy.data.cameras.new("SunsetLanternPreviewCam")
    cam = bpy.data.objects.get("SunsetLanternPreviewCam") or bpy.data.objects.new("SunsetLanternPreviewCam", cam_data)
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    centre = Vector(to_b((0.0, 0.31, 0.0)))
    views = {
        # name: direction from the lantern to the camera (game frame), ortho scale, pixels square
        "eye": ((0.35, 0.45, 1.0), 0.86, 640),        # as the eye sees the nearest (24 degrees down)
        "side": ((0.2, 0.09, 1.0), 0.86, 640),        # as it sees the far ones
        "top": ((0.0, 1.0, 0.0001), 0.86, 640),
        "below": ((0.3, -0.6, 1.0), 0.86, 640),       # as it rises
        "game-100": ((0.35, 0.45, 1.0), 0.86, 130),   # the nearest, at the size the game draws it
        "game-40": ((0.2, 0.2, 1.0), 0.86, 52),
    }
    files = []
    for label, obj, other, light, sky in (
        ("day", day, night, "STUDIO", (0.5, 0.62, 0.78)),
        ("night", night, day, "FLAT", (0.012, 0.016, 0.04)),
    ):
        obj.hide_render = False
        other.hide_render = True
        shading.light = light
        world.color = sky
        for name, (direction, scale, size) in views.items():
            d = Vector(to_b(direction)).normalized()
            up = Vector((0, 0, 1)) if abs(d.z) < 0.99 else Vector((0, 1, 0))
            right = up.cross(d).normalized()
            true_up = d.cross(right).normalized()
            cam.rotation_mode = "QUATERNION"
            cam.rotation_quaternion = Matrix((right, true_up, d)).transposed().to_quaternion()
            cam.location = centre + d * 10.0
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = scale
            cam_data.clip_end = 50
            scene.render.resolution_x = size
            scene.render.resolution_y = size
            scene.render.resolution_percentage = 100
            path = out / f"lantern-{label}-{name}.png"
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True, scene=scene.name)
            files.append(str(path))
    for obj in (day, night):
        obj.hide_render = True
    for _part, obj in objects:
        obj.hide_render = False
    return files


# ── Entry points ──────────────────────────────────────────────────────────────

def show(preview_dir=None, export_path=None):
    """Live Blender (the MCP): the lantern in a scene of its own; nothing else touched."""
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
    model = gather(scene, objects)
    report = {"parts": [p.name for p, _o in objects], "vertices": len(model["verts"]), "triangles": len(model["tris"])}
    if export_path:
        report.update(export(model, export_path))
    if preview_dir:
        report["previews"] = previews(scene, objects, model, preview_dir)
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
    model = gather(scene, objects)
    print(f"{TAG} {len(model['verts'])} vertices, {len(model['tris'])} triangles")
    if out:
        export(model, out)
    if preview_dir:
        for f in previews(scene, objects, model, preview_dir):
            print(f"{TAG} preview {f}")


if __name__ == "__main__":
    main()
