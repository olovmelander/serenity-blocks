"""Odyssey chapter 2's fish, modelled in Blender: a schooling jack and a cruising tuna.

Run headless (nothing in an open Blender session is touched):

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_fish.py -- \
        [--out src/rendering/odyssey/world/odyssey-fish-hulls.js] [--preview <dir>]

The deep-ocean climb's four schools (odyssey-fish.js) wheel overhead and around the rising eye,
40 to 300 px long at 2560 x 1440: three schools of a small silver fish and one loose school of big
cruisers. Two hulls, each built for the size it is seen at:

- SCHOOL: a jack / horse mackerel. Fusiform and laterally compressed (half as wide as deep), the
  deepest point a third back, a pointed snout, a large eye, a spiny first dorsal and a long soft
  second dorsal mirrored by the anal fin, small pectoral and pelvic fins, a slender caudal
  peduncle and a deeply forked tail.
- CRUISER: a tuna / bonito. A deep, round, fusiform body (a quarter as deep as long) that narrows
  to a keeled pencil of a peduncle, a tall first dorsal that folds into a groove, a sickle second
  dorsal and anal fin, a row of finlets above and below the tail stock, long pectorals and a
  lunate (sickle) tail.

Each body is a dense loft of super-elliptic sections along spline profiles (top, belly, width),
meshed in Blender and reduced by its Decimate modifier (collapse, symmetric about the midplane) to
the triangle count its game size needs, with smooth normals. Fins are thin sheets built at their
final resolution, their roots sunk into the body; the eye is a small disc laid on the body's own
surface (a BVH ray cast).

Game frame: x the fish's LEFT, y up, z forward (the nose), hull units: the nose at z = +2.10, the
tail's tips at z = -2.25 (4.35 long, as the code-built hull before it, so every size and path in
the game stays). In Blender the fish faces -Y with its back on +Z and its left on +X.

Per vertex, besides position and normal, the module bakes `parts` (four floats):
  s     distance along the body, 0 at the nose to 1 at the tail's tips (drives the swim's
        travelling wave: its amplitude grows toward the tail);
  d     how dorsal the point is, 0 belly .. 1 back (countershading: the back line, flank, belly);
  flex  0 on the body and at a fin's root .. 1 at its trailing edge (how far the fin lags);
        on the eye, 0 at the pupil's centre .. 1 at the rim of the iris;
  code  hull * 4 + region: hull 0 school / 1 cruiser; region 0 body, 1 fin, 2 eye.

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
from mathutils import Vector
from mathutils.bvhtree import BVHTree

TAG = "[odyssey-fish]"
NOSE_Z = 2.10
TAIL_Z = -2.25
LENGTH = NOSE_Z - TAIL_Z

# ── The two fish, in numbers ──────────────────────────────────────────────────
# Profiles along the body (u = 0 at the snout, 1 at the caudal base): the top and belly lines
# (measured from y = 0) and the half-width. The snout rounds in fast (a blunt-pointed head),
# the deepest point sits a third to two fifths back, and the body narrows to the peduncle.

SCHOOL = {
    "name": "school",
    "hull": 0,
    "caudal_base_z": -1.34,
    "u":      [0.0, 0.025, 0.07, 0.16, 0.30, 0.42, 0.56, 0.70, 0.82, 0.92, 1.0],
    "top":    [0.0, 0.085, 0.175, 0.285, 0.365, 0.375, 0.335, 0.245, 0.150, 0.092, 0.072],
    "belly":  [-0.015, -0.080, -0.160, -0.270, -0.345, -0.350, -0.300, -0.205, -0.125, -0.080, -0.064],
    "width":  [0.0, 0.058, 0.113, 0.172, 0.207, 0.209, 0.186, 0.138, 0.090, 0.056, 0.044],
    # Super-ellipse exponent of the section (2 = ellipse; above 2 the flanks flatten) and how
    # much the back is pinched to a ridge (a compressed fish's section is an almond).
    "section_power": 2.3,
    "ridge_pinch": 0.30,
    "body_triangles": 156,
    "eye": {"z": 1.80, "y": 0.065, "r": 0.080},
}

CRUISER = {
    "name": "cruiser",
    "hull": 1,
    "caudal_base_z": -1.40,
    "u":      [0.0, 0.025, 0.07, 0.16, 0.30, 0.43, 0.57, 0.71, 0.83, 0.925, 1.0],
    "top":    [0.0, 0.115, 0.240, 0.420, 0.560, 0.590, 0.540, 0.400, 0.225, 0.105, 0.070],
    "belly":  [-0.020, -0.100, -0.215, -0.390, -0.525, -0.555, -0.495, -0.355, -0.195, -0.090, -0.062],
    "width":  [0.0, 0.080, 0.170, 0.290, 0.375, 0.385, 0.340, 0.250, 0.150, 0.105, 0.118],
    "section_power": 2.05,
    "ridge_pinch": 0.12,
    "body_triangles": 228,
    "eye": {"z": 1.76, "y": 0.105, "r": 0.076},
}

RINGS = 56      # sections in the dense loft
AROUND = 32     # vertices round each section (even, with points on the midplane top and bottom)


def catmull(xs, ys, x):
    """A Catmull-Rom spline through (xs, ys), evaluated at x (clamped to the ends)."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = max(k for k in range(len(xs) - 1) if xs[k] <= x)
    x0, x1 = xs[i], xs[i + 1]
    t = (x - x0) / (x1 - x0)

    def slope(k):
        lo, hi = max(k - 1, 0), min(k + 1, len(xs) - 1)
        return (ys[hi] - ys[lo]) / (xs[hi] - xs[lo])

    m0 = slope(i) * (x1 - x0)
    m1 = slope(i + 1) * (x1 - x0)
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * m0
            + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * m1)


def profile(fish, u):
    return (catmull(fish["u"], fish["top"], u), catmull(fish["u"], fish["belly"], u),
            catmull(fish["u"], fish["width"], u))


def body_z(fish, u):
    return NOSE_Z + (fish["caudal_base_z"] - NOSE_Z) * u


def to_blender(p):
    """Game (x left, y up, z forward) -> Blender (X left, Y back, Z up): a proper rotation."""
    return Vector((p[0], -p[2], p[1]))


def to_game(v):
    return (v.x, v.z, -v.y)


# ── The body: a dense loft, decimated in Blender ──────────────────────────────


def section_point(fish, u, theta):
    top, belly, width = profile(fish, u)
    c, s = math.cos(theta), math.sin(theta)
    e = 2.0 / fish["section_power"]
    sx = math.copysign(abs(c) ** e, c)
    sy = math.copysign(abs(s) ** e, s)
    # The back pinches to a ridge: the upper part of the section is narrower.
    pinch = 1.0 - fish["ridge_pinch"] * max(s, 0.0) ** 2
    x = width * sx * pinch
    y = (top if s >= 0 else -belly) * sy
    # Above the midline the section's centre is the mean of the extents, so the snout's tip
    # (top = belly) lands where the profiles meet.
    return (x, y, body_z(fish, u))


def build_body(fish):
    """The dense loft as a closed Blender mesh: a vertex at the snout, RINGS sections, a vertex
    closing the caudal base."""
    bm = bmesh.new()
    nose_top, nose_belly, _ = profile(fish, 0.0)
    nose = bm.verts.new(to_blender((0.0, (nose_top + nose_belly) * 0.5, NOSE_Z)))
    rings = []
    for i in range(1, RINGS + 1):
        # Sections bunch toward the snout and the peduncle, where the shape turns fastest.
        t = i / RINGS
        u = 0.5 - 0.5 * math.cos(math.pi * t)
        u = 0.45 * t + 0.55 * u
        ring = [bm.verts.new(to_blender(section_point(fish, u, 2 * math.pi * k / AROUND)))
                for k in range(AROUND)]
        rings.append(ring)
    end_top, end_belly, _ = profile(fish, 1.0)
    tail = bm.verts.new(to_blender((0.0, (end_top + end_belly) * 0.5, fish["caudal_base_z"] - 0.025)))
    for k in range(AROUND):
        k1 = (k + 1) % AROUND
        bm.faces.new((nose, rings[0][k], rings[0][k1]))
        for i in range(len(rings) - 1):
            bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][k1], rings[i][k1]))
        bm.faces.new((rings[-1][k], tail, rings[-1][k1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(f"{fish['name']}-body-dense")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(f"{fish['name']}-body", mesh)
    bpy.context.scene.collection.objects.link(obj)
    dense_tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    dec = obj.modifiers.new("decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.use_symmetry = True
    dec.symmetry_axis = "X"
    dec.use_collapse_triangulate = True
    # Collapse to the target: the modifier's ratio is of faces, so search it.
    lo, hi = 0.0, 1.0
    best = None
    for _ in range(24):
        mid = 0.5 * (lo + hi)
        dec.ratio = mid
        tris = evaluated_triangles(obj)
        if tris > fish["body_triangles"]:
            hi = mid
        else:
            lo = mid
            best = mid
    dec.ratio = best
    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.clear()
    old = obj.data
    obj.data = baked
    bpy.data.meshes.remove(old)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()
    for p in obj.data.polygons:
        p.use_smooth = True
    print(f"{TAG} {fish['name']} body: {dense_tris} -> {len(obj.data.polygons)} triangles (ratio {best:.4f})")
    return obj


def evaluated_triangles(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    n = sum(len(p.vertices) - 2 for p in mesh.polygons)
    ev.to_mesh_clear()
    return n


# ── Fins: thin sheets at their final resolution ───────────────────────────────


class Sheets:
    """Fin and eye geometry in the game frame: vertices with (d, flex, region) and triangles."""

    def __init__(self):
        self.verts = []   # (x, y, z)
        self.normals = []
        self.extra = []   # (d, flex, region)
        self.tris = []

    def add(self, p, n, d, flex, region):
        self.verts.append(tuple(p))
        self.normals.append(tuple(n))
        self.extra.append((d, flex, region))
        return len(self.verts) - 1

    def fin(self, outline_root, outline_tip, d, normal_fn, flex_power=1.0):
        """A fin as a strip between a root line (sunk in the body) and an outer edge, both lists of
        points in the game frame of equal length; flex grows from root to edge."""
        n = len(outline_root)
        root = [self.add(p, normal_fn(p), d, 0.0, 1) for p in outline_root]
        tip = []
        for k, p in enumerate(outline_tip):
            reach = k / max(n - 1, 1)
            tip.append(self.add(p, normal_fn(p), d, min(1.0, (0.55 + 0.45 * reach) ** flex_power), 1))
        for k in range(n - 1):
            self.tris.append((root[k], root[k + 1], tip[k + 1]))
            self.tris.append((root[k], tip[k + 1], tip[k]))

    def fan(self, points, flexes, d, normal_fn):
        """A fin as a fan from its first point (the root's middle)."""
        ids = [self.add(p, normal_fn(p), d, f, 1) for p, f in zip(points, flexes)]
        for k in range(1, len(ids) - 1):
            self.tris.append((ids[0], ids[k], ids[k + 1]))


def midplane_normal(_p):
    return (1.0, 0.0, 0.0)


def top_at(fish, z):
    u = (z - NOSE_Z) / (fish["caudal_base_z"] - NOSE_Z)
    return profile(fish, min(max(u, 0.0), 1.0))


def dorsal_fin(sheets, fish, z0, z1, heights, rake, sink=0.82, d=0.95):
    """A median fin on the back from z0 (front) to z1, its edge at heights over the root, raked aft."""
    n = len(heights)
    root, edge = [], []
    for k in range(n):
        z = z0 + (z1 - z0) * k / (n - 1)
        top, _, _ = top_at(fish, z)
        root.append((0.0, top * sink, z))
        edge.append((0.0, top + heights[k], z - rake * heights[k]))
    sheets.fin(root, edge, d, midplane_normal)


def anal_fin(sheets, fish, z0, z1, depths, rake, sink=0.82, d=0.12):
    n = len(depths)
    root, edge = [], []
    for k in range(n):
        z = z0 + (z1 - z0) * k / (n - 1)
        _, belly, _ = top_at(fish, z)
        root.append((0.0, belly * sink, z))
        edge.append((0.0, belly - depths[k], z - rake * depths[k]))
    sheets.fin(root, edge, d, midplane_normal)


def flank_x(fish, z, y, sink):
    """The body's half-width at height y of the section at z (the section is roughly elliptic)."""
    top, belly, width = top_at(fish, z)
    rel = (y - (top + belly) * 0.5) / max((top - belly) * 0.5, 1e-6)
    return width * math.sqrt(max(0.0, 1.0 - min(rel * rel, 1.0))) * sink


def paired_fin(sheets, fish, z, y_share, length, chord, droop, splay, d, sink=0.80):
    """A pectoral or pelvic pair. The root is a short, near-vertical line on the flank (as a real
    pectoral's base is); the blade sweeps back along the flank, drooping by droop (radians below
    the body's axis) and standing out from the wall by splay (radians)."""
    for side in (1.0, -1.0):
        top, belly, _ = top_at(fish, z)
        y = belly + (top - belly) * y_share
        y_hi = y + chord * 0.5
        y_lo = y - chord * 0.5
        root_hi = (side * flank_x(fish, z, y_hi, sink), y_hi, z)
        root_lo = (side * flank_x(fish, z - chord * 0.3, y_lo, sink), y_lo, z - chord * 0.3)
        dx = math.sin(splay) * side
        dy = -math.sin(droop)
        dz = -math.cos(splay) * math.cos(droop)
        mid = Vector(root_hi).lerp(Vector(root_lo), 0.5)
        tip = mid + Vector((dx, dy, dz)) * length
        lead = Vector(root_hi).lerp(tip, 0.55) + Vector((0.0, chord * 0.10, 0.0))
        trail = Vector(root_lo).lerp(tip, 0.5) + Vector((0.0, -chord * 0.05, chord * 0.12))
        # The blade's plane normal, turned to face out of the body.
        nrm = (Vector(root_lo) - Vector(root_hi)).cross(tip - Vector(root_hi)).normalized()
        if nrm.x * side < 0:
            nrm = -nrm
        nn = tuple(nrm)
        ids = [sheets.add(tuple(p), nn, d, f, 1) for p, f in (
            (root_hi, 0.0), (lead, 0.55), (tip, 1.0), (trail, 0.8), (root_lo, 0.0))]
        for k in (1, 2, 3):
            sheets.tris.append((ids[0], ids[k], ids[k + 1]))


def forked_tail(sheets, fish):
    """The jack's deeply forked caudal fin, in the midplane."""
    zb = fish["caudal_base_z"]
    top, belly, _ = top_at(fish, 1.0)
    # Points (z, y) round the outline; the root overlaps the peduncle.
    root_hi = (zb + 0.10, top * 0.75)
    root_lo = (zb + 0.10, belly * 0.75)
    hub = (zb + 0.02, 0.0)
    up_lead1 = (zb - 0.18, 0.20)
    up_lead2 = (zb - 0.52, 0.42)
    up_tip = (TAIL_Z, 0.57)
    up_trail = (zb - 0.56, 0.20)
    notch = (zb - 0.40, 0.0)
    lo_trail = (zb - 0.55, -0.19)
    lo_tip = (TAIL_Z + 0.02, -0.55)
    lo_lead2 = (zb - 0.50, -0.40)
    lo_lead1 = (zb - 0.17, -0.19)
    pts = {
        "hub": (hub, 0.0), "root_hi": (root_hi, 0.0), "root_lo": (root_lo, 0.0),
        "up_lead1": (up_lead1, 0.35), "up_lead2": (up_lead2, 0.75), "up_tip": (up_tip, 1.0),
        "up_trail": (up_trail, 0.75), "notch": (notch, 0.55), "lo_trail": (lo_trail, 0.75),
        "lo_tip": (lo_tip, 1.0), "lo_lead2": (lo_lead2, 0.75), "lo_lead1": (lo_lead1, 0.35),
    }
    ids = {}
    for key, ((z, y), flex) in pts.items():
        d = 0.5 + 0.45 * max(-1.0, min(1.0, y / 0.5))
        ids[key] = sheets.add((0.0, y, z), (1.0, 0.0, 0.0), d, flex, 1)
    for a, b, c in (
        ("hub", "root_hi", "up_lead1"), ("hub", "up_lead1", "up_trail"), ("up_lead1", "up_lead2", "up_trail"),
        ("up_lead2", "up_tip", "up_trail"), ("hub", "up_trail", "notch"),
        ("hub", "notch", "lo_trail"), ("hub", "lo_trail", "lo_lead1"), ("lo_lead1", "lo_trail", "lo_lead2"),
        ("lo_lead2", "lo_trail", "lo_tip"), ("hub", "lo_lead1", "root_lo"),
    ):
        sheets.tris.append((ids[a], ids[b], ids[c]))


def lunate_tail(sheets, fish):
    """The tuna's sickle tail: two narrow, swept lobes on a short stalk, the trailing edge concave."""
    zb = fish["caudal_base_z"]
    top, belly, _ = top_at(fish, 1.0)
    span = TAIL_Z - zb
    hub = sheets.add((0.0, 0.0, zb + 0.06), (1.0, 0.0, 0.0), 0.5, 0.0, 1)
    notch = sheets.add((0.0, 0.0, zb - 0.36), (1.0, 0.0, 0.0), 0.5, 0.5, 1)
    for sign, reach, root_y in ((1.0, 1.0, top * 0.7), (-1.0, 0.95, belly * -0.7)):
        # Each lobe a crescent: a convex leading edge sweeping back to a sharp tip, a concave
        # trailing edge curving back in to the notch; the chord narrows toward the tip.
        lead = [(zb + 0.10, root_y), (zb + 0.12 * span, 0.20), (zb + 0.36 * span, 0.47),
                (zb + 0.65 * span, 0.70)]
        trail = [(zb + 0.50 * span, 0.17), (zb + 0.64 * span, 0.36), (zb + 0.77 * span, 0.58)]
        tip = (zb + span, 0.84)
        flex_lead = (0.0, 0.3, 0.6, 0.85)
        flex_trail = (0.6, 0.78, 0.92)

        def at(zy, f, s=sign, r=reach):
            y = s * zy[1] * r
            d = 0.5 + 0.45 * max(-1.0, min(1.0, y / 0.6))
            return sheets.add((0.0, y, zy[0]), (1.0, 0.0, 0.0), d, f, 1)

        l0, l1, l2, l3 = (at(p, f) for p, f in zip(lead, flex_lead))
        t1, t2, t3 = (at(p, f) for p, f in zip(trail, flex_trail))
        tip_id = at(tip, 1.0)
        sheets.tris.extend([
            (hub, l0, l1), (hub, l1, notch), (l1, t1, notch),
            (l1, l2, t2), (l1, t2, t1), (l2, l3, t3), (l2, t3, t2), (l3, tip_id, t3),
        ])


def finlets(sheets, fish, z0, z1, count, size, dorsal):
    """The tuna's finlets: small triangular flags along the top (and bottom) of the tail stock."""
    for k in range(count):
        z = z0 + (z1 - z0) * k / max(count - 1, 1)
        top, belly, _ = top_at(fish, z)
        s = size * (1.0 - 0.25 * k / max(count - 1, 1))
        if dorsal:
            y0 = top * 0.85
            p = [(0.0, y0, z + s * 0.5), (0.0, y0, z - s * 0.4), (0.0, top + s * 0.85, z - s * 0.9)]
            d = 0.75
        else:
            y0 = belly * 0.85
            p = [(0.0, y0, z + s * 0.5), (0.0, belly - s * 0.85, z - s * 0.9), (0.0, y0, z - s * 0.4)]
            d = 0.3
        ids = [sheets.add(q, (1.0, 0.0, 0.0), d, f, 1) for q, f in zip(p, (0.0, 0.0, 1.0))]
        sheets.tris.append(tuple(ids))


def fins_for(fish):
    sheets = Sheets()
    if fish["hull"] == 0:
        # Spiny first dorsal (triangular, raked), long soft second dorsal and its mirror the anal.
        dorsal_fin(sheets, fish, 0.86, 0.20, [0.10, 0.27, 0.22, 0.12, 0.03], rake=0.55)
        dorsal_fin(sheets, fish, 0.05, -0.80, [0.16, 0.13, 0.09, 0.07, 0.05], rake=0.45)
        anal_fin(sheets, fish, -0.08, -0.80, [0.13, 0.10, 0.07, 0.05, 0.04], rake=0.45)
        paired_fin(sheets, fish, 1.32, 0.40, 0.46, 0.15, 0.30, 0.42, d=0.55)
        paired_fin(sheets, fish, 0.98, 0.04, 0.22, 0.10, 0.80, 0.30, d=0.2)
        forked_tail(sheets, fish)
    else:
        # Tall first dorsal folding back to a groove, sickle second dorsal and anal fin, finlets.
        dorsal_fin(sheets, fish, 1.02, 0.30, [0.10, 0.30, 0.24, 0.13, 0.06, 0.02], rake=0.45)
        dorsal_fin(sheets, fish, 0.22, -0.16, [0.06, 0.40, 0.18, 0.04], rake=1.05)
        anal_fin(sheets, fish, 0.10, -0.24, [0.05, 0.36, 0.16, 0.04], rake=1.05)
        finlets(sheets, fish, -0.36, -1.18, 6, 0.13, True)
        finlets(sheets, fish, -0.40, -1.18, 5, 0.12, False)
        paired_fin(sheets, fish, 1.22, 0.55, 0.62, 0.17, 0.18, 0.30, d=0.6)
        paired_fin(sheets, fish, 1.00, 0.06, 0.22, 0.10, 0.85, 0.25, d=0.2)
        lunate_tail(sheets, fish)
    return sheets


def eyes_for(fish, body, sheets):
    """A dark disc each side, laid on the body's surface (a ray cast in from outside)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(body, depsgraph)
    eye = fish["eye"]
    for side in (1.0, -1.0):
        start = to_blender((side * 1.0, eye["y"], eye["z"]))
        hit, nrm, _, _ = tree.ray_cast(start, Vector((-side, 0.0, 0.0)))
        if hit is None:
            raise RuntimeError(f"{TAG} the eye ray missed the {fish['name']} body")
        p = Vector(to_game(hit))
        n = Vector(to_game(nrm)).normalized()
        if n.x * side < 0:
            n = -n
        p = p + n * 0.010
        # The disc's own axes in the surface's tangent plane.
        t1 = Vector((0.0, 1.0, 0.0)).cross(n).normalized()
        t2 = n.cross(t1).normalized()
        centre = sheets.add(tuple(p), tuple(n), 0.6, 0.0, 2)
        ring = []
        for k in range(6):
            a = 2 * math.pi * k / 6
            q = p + (t1 * math.cos(a) + t2 * math.sin(a)) * eye["r"]
            ring.append(sheets.add(tuple(q), tuple(n), 0.6, 1.0, 2))
        for k in range(6):
            a, b = ring[k], ring[(k + 1) % 6]
            # Wind each triangle round the outward normal.
            pa, pb = Vector(sheets.verts[a]), Vector(sheets.verts[b])
            if (pa - p).cross(pb - p).dot(n) < 0:
                a, b = b, a
            sheets.tris.append((centre, a, b))


# ── Gather one hull ───────────────────────────────────────────────────────────


def gather(fish):
    body = build_body(fish)
    mesh = body.data
    verts, normals, parts, tris = [], [], [], []
    for v in mesh.vertices:
        g = to_game(v.co)
        n = Vector(to_game(v.normal)).normalized()
        verts.append(g)
        normals.append(tuple(n))
    # Dorsal share from where a vertex sits in its own section (0 belly .. 1 back).
    for g in verts:
        top, belly, _ = top_at(fish, g[2])
        mid = (top + belly) * 0.5
        half = max((top - belly) * 0.5, 1e-4)
        rel = max(-1.0, min(1.0, (g[1] - mid) / half))
        d = 0.5 + 0.5 * rel
        parts.append([d, 0.0, float(fish["hull"] * 4 + 0)])
    for p in mesh.polygons:
        tris.append(tuple(p.vertices))
    body_tris = len(tris)
    sheets = fins_for(fish)
    eyes_for(fish, body, sheets)
    # Wind every sheet triangle round its vertices' own normal, so the two sides of a fin are
    # the two faces the renderer tells apart (and Blender's previews shade them alike).
    for k, (a, b, c) in enumerate(sheets.tris):
        pa, pb, pc = (Vector(sheets.verts[i]) for i in (a, b, c))
        want = Vector(sheets.normals[a]) + Vector(sheets.normals[b]) + Vector(sheets.normals[c])
        if (pb - pa).cross(pc - pa).dot(want) < 0:
            sheets.tris[k] = (a, c, b)
    base = len(verts)
    for p, n, (d, flex, region) in zip(sheets.verts, sheets.normals, sheets.extra):
        verts.append(p)
        normals.append(tuple(Vector(n).normalized()))
        parts.append([d, flex, float(fish["hull"] * 4 + region)])
    for t in sheets.tris:
        tris.append(tuple(base + i for i in t))
    # The distance along the whole fish, nose 0 .. tail tips 1.
    full = []
    for g, (d, flex, code) in zip(verts, parts):
        s = max(0.0, min(1.0, (NOSE_Z - g[2]) / LENGTH))
        full.append((round(s, 5), round(d, 5), round(flex, 5), code))
    return {
        "fish": fish,
        "body": body,
        "verts": [tuple(round(c, 5) for c in g) for g in verts],
        "normals": [tuple(round(c, 5) for c in n) for n in normals],
        "parts": full,
        "tris": tris,
        "body_tris": body_tris,
    }


# ── The module the game imports ───────────────────────────────────────────────


def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def hull_block(h):
    verts = h["verts"]
    mins = [round(min(v[k] for v in verts), 4) for k in range(3)]
    maxs = [round(max(v[k] for v in verts), 4) for k in range(3)]
    return [
        f"    {h['fish']['name']}: Object.freeze({{",
        f"        hull: {h['fish']['hull']},",
        f"        vertexCount: {len(verts)},",
        f"        triangleCount: {len(h['tris'])},",
        f"        bodyTriangleCount: {h['body_tris']},",
        f"        min: {json.dumps(mins)},",
        f"        max: {json.dumps(maxs)},",
        f"        positions: '{b64('f', [c for v in verts for c in v])}',",
        f"        normals: '{b64('f', [c for n in h['normals'] for c in n])}',",
        f"        parts: '{b64('f', [c for p in h['parts'] for c in p])}',",
        f"        index: '{b64('H', [i for t in h['tris'] for i in t])}',",
        "    }),",
    ]


def write_module(path, hulls):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Odyssey chapter 2's fish hulls: GENERATED by scripts/blender/odyssey/odyssey_fish.py",
        " * (do not edit by hand).",
        " *",
        " * A schooling jack (`school`) and a cruising tuna (`cruiser`), modelled in Blender. Game frame:",
        " * x the fish's left, y up, z forward; hull units, the nose at z = +2.10 and the tail's tips at",
        " * z = -2.25 (odyssey-fish.js scales them). Base64 little-endian: `positions` and `normals`",
        " * Float32 xyz; `parts` Float32 (s along the fish 0 nose..1 tail tips, d dorsal share 0 belly..1",
        " * back, flex 0 root..1 trailing edge or pupil..iris rim, code = hull * 4 + region: 0 body, 1 fin,",
        " * 2 eye);",
        " * `index` Uint16 triangles, wound outward, the closed body's `bodyTriangleCount` first.",
        " */",
        "export const ODYSSEY_FISH_HULLS = Object.freeze({",
        f"    noseZ: {NOSE_Z},",
        f"    tailZ: {TAIL_Z},",
    ]
    for h in hulls:
        lines.extend(hull_block(h))
    lines.extend(["});", ""])
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# ── Previews (Workbench) ──────────────────────────────────────────────────────


def preview_object(h):
    """The whole hull as one Blender object with vertex colours: a dark back, a silver belly,
    grey fins, a black eye."""
    mesh = bpy.data.meshes.new(f"{h['fish']['name']}-preview")
    mesh.from_pydata([tuple(to_blender(v)) for v in h["verts"]], [], h["tris"])
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    col = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, (s, d, flex, code) in enumerate(h["parts"]):
        region = int(code) % 4
        if region == 2:
            c = (0.02, 0.02, 0.03)
        elif region == 1:
            c = (0.18 + 0.1 * (1 - d), 0.24 + 0.1 * (1 - d), 0.28 + 0.1 * (1 - d))
        else:
            back = (0.10, 0.20, 0.26)
            belly = (0.80, 0.84, 0.86)
            t = max(0.0, min(1.0, (d - 0.50) / 0.22))
            c = tuple(belly[k] + (back[k] - belly[k]) * t for k in range(3))
        col.data[i].color = (*c, 1.0)
    obj = bpy.data.objects.new(f"{h['fish']['name']}-preview", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def previews(hulls, out_dir):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_cavity = False
    scene.world = bpy.data.worlds.new("sea")
    scene.world.color = (0.10, 0.30, 0.36)
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    out_dir.mkdir(parents=True, exist_ok=True)
    for o in list(scene.collection.objects):
        if o.type == "MESH":
            o.hide_render = True
    views = {
        "side": Vector((1, 0, 0)), "below": Vector((0, 0.001, -1)), "top": Vector((0, 0.001, 1)),
        "threeq": Vector((0.7, -0.45, 0.35)), "underq": Vector((0.45, 0.35, -0.75)),
        "front": Vector((0, -1, 0.0001)),
    }
    for h in hulls:
        obj = preview_object(h)
        for name, d in views.items():
            d = d.normalized()
            # Straight up and down the fish is turned to lie across the frame.
            obj.rotation_euler = (0.0, 0.0, math.pi / 2 if name in ("below", "top") else 0.0)
            cam.location = d * 8
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            # A big look and the game's own sizes (px along the fish), upscaled later to judge.
            for label, w, scale in (("big", 900, 5.0), ("g120", 128, 5.0), ("g60", 64, 5.0)):
                cam_data.ortho_scale = scale
                scene.render.resolution_x = w
                scene.render.resolution_y = int(w * 0.6)
                scene.render.filepath = str(out_dir / f"{h['fish']['name']}-{name}-{label}.png")
                bpy.ops.render.render(write_still=True)
        obj.hide_render = True
    game_size_sheet(hulls, out_dir)


def game_size_sheet(hulls, out_dir):
    """The game-size renders blown up with hard pixels (x8 and x4) side by side, one row per hull
    and view, to judge each fish at the size the game draws it."""
    import numpy as np

    def pixels(path):
        img = bpy.data.images.load(str(path))
        w, h = img.size
        a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        bpy.data.images.remove(img)
        return a

    cell_w, cell_h = 512, 304
    rows = []
    for h in hulls:
        for view in ("side", "below", "threeq", "underq"):
            row = []
            for label, k in (("g60", 8), ("g120", 4)):
                a = pixels(out_dir / f"{h['fish']['name']}-{view}-{label}.png")
                a = np.repeat(np.repeat(a, k, axis=0), k, axis=1)[:cell_h, :cell_w]
                pad = np.zeros((cell_h, cell_w, 4), dtype=np.float32)
                pad[..., 3] = 1
                pad[:a.shape[0], :a.shape[1]] = a
                row.append(pad)
                row.append(np.ones((cell_h, 4, 4), dtype=np.float32) * 0.12)
            rows.append(np.concatenate(row[:-1], axis=1))
            rows.append(np.ones((4, rows[-1].shape[1], 4), dtype=np.float32) * 0.12)
    sheet = np.concatenate(rows[:-1], axis=0)
    sh, sw = sheet.shape[:2]
    img = bpy.data.images.new("fish-sheet", sw, sh, alpha=True)
    img.pixels[:] = sheet.ravel().tolist()
    img.filepath_raw = str(out_dir / "game-size-sheet.png")
    img.file_format = "PNG"
    img.save()
    print(f"{TAG} wrote {out_dir / 'game-size-sheet.png'} ({sw} x {sh})")


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
    out = Path(opts.get("out", "src/rendering/odyssey/world/odyssey-fish-hulls.js"))
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    hulls = [gather(SCHOOL), gather(CRUISER)]
    for h in hulls:
        print(f"{TAG} {h['fish']['name']}: {len(h['verts'])} vertices, {len(h['tris'])} triangles "
              f"({h['body_tris']} body)")
    write_module(out, hulls)
    print(f"{TAG} wrote {out}")
    if opts.get("preview"):
        previews(hulls, Path(opts["preview"]))


if __name__ == "__main__":
    main()
