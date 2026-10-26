"""Synthwave Sunset's gull, authored procedurally in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/synthwave_gull.py -- \
        --out src/themes/synthwave-sunset/assets/gull.glb [--preview <dir>]

A herring gull, the seaside's own, built for the job it has in the theme: a handful of birds
wheeling over the pier against the sunset, 12 to 60 px across in a game frame. So the shape is the
silhouette that names a gull at a distance: long, narrow wings bent at the wrist (the arm short
and broad, the hand long and pointed), a white body with a round head and a heavy yellow bill, a
short square tail. About 1,650 triangles.

There is no skeleton. The wings are folded in the theme's vertex stage (synthwave-sunset-gulls.js)
about two hinges, the shoulder and the wrist, whose pivots this script writes into the asset
manifest. Each vertex carries how much each hinge moves it in a custom attribute `_wing`
(arm, hand, tip: 0..1, eased over a band either side of the joint so the skin bends instead of
creasing). `fold()` below is the same deformation, used here for the previews.

Vertex colours are scene-linear RGB plumage; alpha marks thin feather (1) against body (0), which
the theme's shader lets the sun shine through. Real size (1.40 m span); the theme scales it.
Deterministic: the same script writes the same file.
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy

TAG = "[synthwave-gull]"

# ── Plumage (sRGB hex → linear) ───────────────────────────────────────────────


def lin(hex_colour):
    c = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


PLUMAGE = {
    "white": lin("#eef0f1"),
    "belly": lin("#e6e8ea"),
    "mantle": lin("#a7b1bc"),       # the herring gull's pale blue-grey back and upper wing
    "mantleDeep": lin("#97a1ad"),
    "edge": lin("#e2e6ea"),         # the white trailing edge of the arm
    "black": lin("#1b1b1f"),        # the wingtips
    "mirror": lin("#e8eaec"),       # the white spot near the very tip
    "under": lin("#e9ebee"),
    "underFlight": lin("#c4cad1"),  # the primaries' grey undersides
    "bill": lin("#f0be3a"),
    "gonys": lin("#d2472e"),        # the red spot on the lower mandible
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


# ── The rig: two hinges per wing (bird frame: x to its left, y up, z forward; metres) ──────

SPAN = 1.40
LENGTH = 0.60
# Pivots on the left wing (+x); the right wing mirrors them.
SHOULDER = (0.050, 0.036, 0.020)
WRIST = (0.345, 0.036, 0.075)
# The bands over which each hinge takes hold (|x|, m): eased from 0 to 1 across them.
ARM_BAND = (0.055, 0.115)
HAND_BAND = (0.318, 0.372)
TIP_BAND = (0.560, 0.700)


def wing_weights(ax):
    return (smooth(*ARM_BAND, ax), smooth(*HAND_BAND, ax), smooth(*TIP_BAND, ax))


# ── The mesh, built as plain lists in the bird's frame ─────────────────────────

class Builder:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.wings = []     # per vertex: (arm, hand, tip)
        self.colours = []   # per vertex: (r, g, b, thin)

    def vert(self, p, colour, thin, wing=(0.0, 0.0, 0.0)):
        self.verts.append(tuple(p))
        self.wings.append(tuple(wing))
        self.colours.append((colour[0], colour[1], colour[2], thin))
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


# ── Body: a white spindle with a round head ────────────────────────────────────

# z, half width, top, bottom, centre height
BODY = [
    (0.213, 0.013, 0.012, 0.011, 0.038),
    (0.204, 0.024, 0.024, 0.019, 0.041),
    (0.186, 0.034, 0.035, 0.028, 0.042),
    (0.163, 0.033, 0.034, 0.028, 0.038),
    (0.138, 0.026, 0.027, 0.026, 0.030),
    (0.110, 0.031, 0.030, 0.035, 0.020),
    (0.072, 0.047, 0.043, 0.055, 0.008),
    (0.025, 0.058, 0.051, 0.063, 0.001),
    (-0.030, 0.057, 0.049, 0.058, 0.002),
    (-0.085, 0.047, 0.041, 0.044, 0.007),
    (-0.130, 0.033, 0.030, 0.026, 0.013),
    (-0.165, 0.021, 0.018, 0.013, 0.016),
]
BODY_RING = 14


def body_colour(z, up):
    """up: -1 belly .. 1 back."""
    if z > 0.12:
        return PLUMAGE["white"]
    back = smooth(0.25, 0.6, up) * smooth(0.11, 0.06, z) * smooth(-0.15, -0.10, z)
    return mix(mix(PLUMAGE["white"], PLUMAGE["belly"], smooth(0.0, -0.7, up)), PLUMAGE["mantle"], back)


def build_body(b):
    rings = []
    for z, wx, top, bottom, cy in BODY:
        ring = []
        for i in range(BODY_RING):
            a = 2 * math.pi * i / BODY_RING
            ca, sa = math.cos(a), math.sin(a)
            x = wx * math.copysign(abs(ca) ** 0.9, ca)
            y = cy + (top if sa > 0 else bottom) * math.copysign(abs(sa) ** 0.9, sa)
            ring.append(b.vert((x, y, z), body_colour(z, sa), 0.0))
        rings.append(ring)
    face = b.vert((0, BODY[0][4], BODY[0][0] + 0.003), PLUMAGE["white"], 0.0)
    rump = b.vert((0, BODY[-1][4], BODY[-1][0] - 0.006), PLUMAGE["white"], 0.0)
    b.loft(rings, close_start=face, close_end=rump)


# A heavy bill: deep at the base, a bulge (the gonys) on the lower edge near the tip, a hooked tip.
# z, half width, top, bottom, centre height
BILL = [
    (0.200, 0.011, 0.012, 0.010, 0.037),
    (0.222, 0.0085, 0.0095, 0.0085, 0.036),
    (0.244, 0.0068, 0.0078, 0.0090, 0.034),
    (0.262, 0.0055, 0.0068, 0.0080, 0.032),
    (0.276, 0.0040, 0.0055, 0.0042, 0.031),
]
BILL_RING = 8


def build_bill(b):
    rings = []
    for z, wx, top, bottom, cy in BILL:
        ring = []
        for i in range(BILL_RING):
            a = 2 * math.pi * i / BILL_RING
            ca, sa = math.cos(a), math.sin(a)
            col = PLUMAGE["bill"]
            if sa < -0.4 and 0.250 < z < 0.270:
                col = PLUMAGE["gonys"]
            ring.append(b.vert((wx * ca, cy + (top if sa > 0 else bottom) * sa, z), col, 0.0))
        rings.append(ring)
    tip = b.vert((0, 0.0275, 0.284), PLUMAGE["bill"], 0.0)
    b.loft(rings, close_end=tip)


# ── Tail: short, square, white; a thin fan under the rump ──────────────────────

# z, half width, centre height
TAIL = [(-0.120, 0.030, 0.015), (-0.165, 0.042, 0.016), (-0.210, 0.052, 0.015), (-0.250, 0.059, 0.013),
        (-0.278, 0.062, 0.012), (-0.290, 0.058, 0.012)]
TAIL_RING = 10
TAIL_HALF_THICK = 0.006


def build_tail(b):
    rings = []
    for k, (z, wx, cy) in enumerate(TAIL):
        thin = smooth(0.0, 2.0, k)
        ring = []
        for i in range(TAIL_RING):
            a = 2 * math.pi * i / TAIL_RING
            ca, sa = math.cos(a), math.sin(a)
            # A flattened lens: full width, a few millimetres thick, a little thicker at the root.
            thick = TAIL_HALF_THICK * (1.6 - 0.6 * smooth(0, 3, k))
            ring.append(b.vert((wx * math.copysign(abs(ca) ** 0.6, ca), cy + thick * sa, z), PLUMAGE["white"], thin))
        rings.append(ring)
    root = b.vert((0, TAIL[0][2], TAIL[0][0] + 0.01), PLUMAGE["white"], 0.0)
    end = b.vert((0, TAIL[-1][2], TAIL[-1][0] - 0.004), PLUMAGE["white"], 0.7)
    b.loft(rings, close_start=root, close_end=end)


# ── Wings: a short broad arm, a long pointed hand, bent at the wrist ───────────

# Stations along the span (|x|, m), dense at the hinges so the skin bends smoothly.
STATIONS = [0.040, 0.062, 0.085, 0.110, 0.150, 0.200, 0.250, 0.295, 0.322, 0.345, 0.368, 0.400, 0.450,
            0.500, 0.550, 0.595, 0.635, 0.665, 0.688, 0.700]
# Leading and trailing edges (z, m) along the span: the wrist (carpal) is the forward-most point,
# the hand's leading edge sweeps back to a sharp tip, the trailing edge runs nearly straight.
LEADING = [(0.040, 0.080), (0.150, 0.093), (0.290, 0.110), (0.345, 0.114), (0.420, 0.092),
           (0.550, 0.028), (0.640, -0.040), (0.700, -0.098)]
TRAILING = [(0.040, -0.112), (0.150, -0.124), (0.280, -0.121), (0.345, -0.106), (0.420, -0.104),
            (0.550, -0.108), (0.640, -0.112), (0.700, -0.104)]
THICKNESS = [(0.040, 0.15), (0.200, 0.12), (0.345, 0.085), (0.550, 0.055), (0.700, 0.035)]
# Chord fractions (leading edge 0 → trailing edge 1).
CHORD = [0.0, 0.03, 0.10, 0.22, 0.40, 0.62, 0.82, 1.0]


def wing_centre(s):
    return 0.036 - 0.004 * s


def airfoil(c, t, x):
    """Camber line and half-thicknesses above and below it, as metres along a chord c."""
    camber = 0.045 * 4 * x * (1 - x)
    yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    yt *= 1 - smooth(0.5, 1.0, x) * 0.85  # the feathered back half is thin
    return camber * c, yt * c, yt * c * 0.4


def wing_colour(s, x, upper):
    """s: |x| along the span; x: chord fraction 0 LE .. 1 TE."""
    tip = smooth(0.545, 0.585, s)
    if upper:
        base = mix(PLUMAGE["mantle"], PLUMAGE["mantleDeep"], smooth(0.1, 0.5, s))
        # The white trailing edge of the arm and inner hand.
        base = mix(base, PLUMAGE["edge"], smooth(0.78, 0.95, x) * smooth(0.52, 0.42, s))
        black = mix(base, PLUMAGE["black"], tip)
        # A white mirror just short of the tip, toward the leading edge.
        mirror = smooth(0.640, 0.655, s) * smooth(0.690, 0.675, s) * smooth(0.55, 0.3, x)
        return mix(black, PLUMAGE["mirror"], mirror)
    base = mix(PLUMAGE["under"], PLUMAGE["underFlight"], smooth(0.35, 0.65, x) * smooth(0.30, 0.45, s))
    return mix(base, PLUMAGE["black"], smooth(0.585, 0.625, s) * 0.9)


def build_wing(b, side):
    """side = 1 left (+x), -1 right."""
    rings = []
    for s in STATIONS:
        le = interp(LEADING, s)
        te = interp(TRAILING, s)
        c = le - te
        cy = wing_centre(s)
        t = interp(THICKNESS, s)
        w = wing_weights(s)
        ring = []
        # Loop: LE, upper surface to TE, lower surface back toward the LE.
        order = [(x, True) for x in CHORD] + [(x, False) for x in reversed(CHORD[1:-1])]
        for x, upper in order:
            camber, up, down = airfoil(c, t, x)
            y = cy + camber + (up if upper else -down)
            z = le - x * c
            thin = smooth(0.30, 0.70, x) * (0.55 + 0.45 * smooth(0.30, 0.55, s))
            ring.append(b.vert((side * s, y, z), wing_colour(s, x, upper or x in (0.0, 1.0)), thin, w))
        if side < 0:
            ring.reverse()
        rings.append(ring)
    root = b.vert((side * STATIONS[0], wing_centre(0), -0.02), PLUMAGE["white"], 0.0, wing_weights(0.0))
    tip = b.vert((side * (STATIONS[-1] + 0.004), wing_centre(0.7), -0.101), PLUMAGE["black"], 0.6,
                 wing_weights(0.704))
    b.loft(rings, close_start=root, close_end=tip)


# ── The fold: the theme's vertex stage, in Python (for the previews and the tests) ──────────


def _rot(a, b, ang):
    c, s = math.cos(ang), math.sin(ang)
    return a * c - b * s, a * s + b * c


def fold(p, w, pose):
    """p: rest position (bird frame); w: (arm, hand, tip); pose: dict of hinge angles (rad).

    lift:  the arm's elevation about the body's long axis (+ raises the wingtip)
    sweep: the arm swung back about the vertical (+ the tip goes back)
    bend:  the hand's elevation about the wrist, relative to the arm
    fold:  the hand swung back about the wrist (the upstroke's flexed wrist)
    curl:  the wingtip bent up under load (+), carried by the tip weight
    """
    side = 1.0 if p[0] >= 0 else -1.0
    u, y, z = abs(p[0]), p[1], p[2]
    arm, hand, tip = w
    # The hand, about the wrist.
    du, dy, dz = u - WRIST[0], y - WRIST[1], z - WRIST[2]
    du, dz = _rot(du, dz, -pose["fold"] * hand)
    du, dy = _rot(du, dy, pose["bend"] * hand + pose["curl"] * tip)
    u, y, z = WRIST[0] + du, WRIST[1] + dy, WRIST[2] + dz
    # The whole wing, about the shoulder.
    du, dy, dz = u - SHOULDER[0], y - SHOULDER[1], z - SHOULDER[2]
    du, dz = _rot(du, dz, -pose["sweep"] * arm)
    du, dy = _rot(du, dy, pose["lift"] * arm)
    return (side * (SHOULDER[0] + du), SHOULDER[1] + dy, SHOULDER[2] + dz)


# Named poses (radians): the theme blends the glide into its wingbeat cycle.
POSES = {
    "rest": {"lift": 0.0, "sweep": 0.0, "bend": 0.0, "fold": 0.0, "curl": 0.0},
    "glide": {"lift": 0.26, "sweep": -0.04, "bend": -0.46, "fold": 0.22, "curl": -0.06},
    "top": {"lift": 0.72, "sweep": -0.06, "bend": 0.08, "fold": 0.18, "curl": -0.04},
    "down": {"lift": 0.12, "sweep": -0.10, "bend": -0.14, "fold": 0.18, "curl": 0.14},
    "bottom": {"lift": -0.48, "sweep": -0.06, "bend": -0.36, "fold": 0.18, "curl": -0.04},
    "up": {"lift": 0.14, "sweep": 0.04, "bend": -0.30, "fold": 0.58, "curl": -0.02},
}


# ── Blender ───────────────────────────────────────────────────────────────────

def to_blender(p):
    """Bird frame (x left, y up, z forward) → Blender (x, -z, y); glTF export maps it back."""
    return (p[0], -p[2], p[1])


def make_mesh(name, builder, verts):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(v) for v in verts], [], builder.faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    colour = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(builder.colours):
        colour.data[i].color = c
    mesh.color_attributes.active_color = colour
    mesh.color_attributes.render_color_index = 0
    wing = mesh.attributes.new("_wing", "FLOAT_VECTOR", "POINT")
    for i, w in enumerate(builder.wings):
        wing.data[i].vector = w

    # Every part is a closed shell: let Blender face each one outward.
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh.shade_smooth()
    mesh.set_sharp_from_angle(angle=math.radians(70))
    return obj


def export(obj, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(o == obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=False,
        export_animations=False,
        export_morph=False,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_attributes=True,
        export_extras=False,
    )


def write_manifest(path, glb, tris, verts):
    data = glb.read_bytes()
    manifest = {
        "schemaVersion": 1,
        "author": "Serenity Blocks original procedural Blender authoring",
        "license": "Proprietary (project-owned)",
        "generator": "scripts/blender/synthwave_gull.py",
        "glTFUpAxis": "Y",
        "assets": [{
            "file": glb.name,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "kind": "bird",
            "species": "herring gull",
            "triangles": tris,
            "sourceVertices": verts,
        }],
        "rig": {
            "frame": "x left, y up, z forward (metres, real size)",
            "span": SPAN,
            "length": LENGTH,
            "shoulder": list(SHOULDER),
            "wrist": list(WRIST),
            "armBand": list(ARM_BAND),
            "handBand": list(HAND_BAND),
            "tipBand": list(TIP_BAND),
            "poses": POSES,
        },
    }
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")


# ── Previews: plumage under a studio light, and silhouettes at game size ──────────

def previews(builder, out_dir):
    import numpy as np
    from mathutils import Vector

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.show_cavity = False
    scene.world = bpy.data.worlds.new("sky")
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Blender frame: the bird faces −y, up is +z. Straight-down views lean a hair so "up" is defined.
    views = {
        "below": Vector((0.0, 0.25, -1.0)), "behind-below": Vector((0.25, 0.9, -0.45)),
        "front": Vector((0.0, -1.0, 0.0001)), "side": Vector((1.0, 0.0, 0.05)),
        "top": Vector((0.0, 0.001, 1.0)), "threeq": Vector((0.65, -0.55, -0.35)),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    tiles = {}

    def shoot(obj, vname, d, size, ortho, mode):
        d = d.normalized()
        cam.location = d * 4
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = ortho
        scene.render.resolution_x, scene.render.resolution_y = size
        if mode == "plumage":
            scene.display.shading.light = "STUDIO"
            scene.display.shading.color_type = "VERTEX"
            scene.world.color = (0.36, 0.30, 0.42)
        else:
            scene.display.shading.light = "FLAT"
            scene.display.shading.color_type = "SINGLE"
            scene.display.shading.single_color = (0.03, 0.02, 0.04)
            scene.world.color = (1.0, 0.42, 0.20)
        path = out_dir / f"{obj.name}-{vname}-{mode}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(size[1], size[0], 4)
        bpy.data.images.remove(img)
        return px

    for pname, pose in POSES.items():
        verts = [fold(v, w, pose) for v, w in zip(builder.verts, builder.wings)]
        obj = make_mesh(f"gull-{pname}", builder, verts)
        for o in bpy.context.view_layer.objects:
            o.hide_render = o is not obj and o.type == "MESH"
        for vname, d in views.items():
            tiles[(pname, vname, "plumage")] = shoot(obj, vname, d, (300, 200), 1.6, "plumage")
            tiles[(pname, vname, "silhouette")] = shoot(obj, vname, d, (60, 40), 1.6, "silhouette")
        obj.hide_render = True

    # One contact sheet per mode: poses down, views across.
    pnames, vnames = list(POSES), list(views)
    for mode, (tw, th), scale in (("plumage", (300, 200), 1), ("silhouette", (60, 40), 3)):
        sheet = np.zeros((len(pnames) * th * scale, len(vnames) * tw * scale, 4), dtype=np.float32)
        for r, p in enumerate(pnames):
            for c, v in enumerate(vnames):
                tile = tiles[(p, v, mode)]
                if scale > 1:
                    tile = tile.repeat(scale, axis=0).repeat(scale, axis=1)
                y0 = (len(pnames) - 1 - r) * th * scale  # Blender images are bottom-up
                sheet[y0:y0 + th * scale, c * tw * scale:(c + 1) * tw * scale] = tile
        img = bpy.data.images.new(f"sheet-{mode}", sheet.shape[1], sheet.shape[0], alpha=True)
        img.pixels[:] = sheet.ravel()
        img.filepath_raw = str(out_dir / f"sheet-{mode}.png")
        img.file_format = "PNG"
        img.save()
    print(f"{TAG} previews: rows {pnames}, columns {vnames}")


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
    out = Path(opts.get("out", "src/themes/synthwave-sunset/assets/gull.glb"))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    b = Builder()
    build_body(b)
    build_bill(b)
    build_tail(b)
    for side in (1, -1):
        build_wing(b, side)
    tris = sum(len(f) - 2 for f in b.faces)
    print(f"{TAG} {len(b.verts)} vertices, {tris} triangles")
    obj = make_mesh("Gull", b, b.verts)
    export(obj, out)
    write_manifest(out.parent / "asset-manifest.json", out, tris, len(b.verts))
    print(f"{TAG} wrote {out}")
    if opts.get("preview"):
        obj.hide_render = True
        previews(b, Path(opts["preview"]))


main()
