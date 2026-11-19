"""Spring's fish, modelled in Blender: an Atlantic salmon and a brown trout leaping in the river.

Run headless (nothing in an open Blender session is touched):

    blender -b --factory-startup --python scripts/blender/spring_fish.py -- \
        [--out src/themes/spring/spring-fish-hulls.js] [--preview <dir>] [--engine workbench|cycles]

The fish leap out of the river below the knoll (spring-fish.js), 10 to 40 px long in the game's
frame at 1080p and larger through a long lens. Two hulls, each a real fish's build:

- SALMON: a fresh-run Atlantic salmon. Streamlined: a fifth as deep as it is long, deepest two
  fifths back, a small pointed head, a small eye, a slender wrist to the tail (you can grip a
  salmon by it) and a slightly forked tail; the dorsal fin over the middle, the small fleshy
  adipose fin behind it, the anal fin under the adipose, the pelvic fins under the dorsal's rear,
  the pectorals low behind the gill cover.
- TROUT: a river brown trout. Deeper (near a quarter of its length) and thicker through the
  wrist, a bigger, blunter head and a larger eye, and a square-cut tail; the same fins, the
  adipose a little larger.

Each body is a dense loft of super-elliptic sections along spline profiles (top, belly, width),
meshed in Blender and reduced by its Decimate modifier (collapse, symmetric about the midplane) to
the triangle count its game size needs, with smooth normals. Fins are thin sheets built at their
final resolution, their roots sunk into the body, the side fins lifted clear of the flank; the eye
is a small disc laid on the body's own surface (a BVH ray cast).

Game frame: x the fish's LEFT, y up (its back), z forward (the nose); one fish long, the nose at
z = +0.5 and the tail's tips at z = -0.5 (spring-fish.js scales it to the fish's drawn length). In
Blender the fish faces -Y with its back on +Z and its left on +X.

Per vertex, besides position and normal, the module bakes `parts` (four floats):
  s     distance along the fish, 0 at the nose to 1 at the tail's tips (drives the tail's
        travelling wave: its stroke grows toward the tail);
  d     how dorsal the point is, 0 belly .. 1 back (countershading, the spots' band);
  flex  0 on the body and at a fin's root .. 1 at its free edge (how far the fin trails);
        on the eye, 0 at the pupil's centre .. 1 at the rim of the iris;
  code  hull * 4 + region: hull 0 salmon / 1 trout; region 0 body, 1 a dark fin (dorsal,
        adipose, tail), 2 eye, 3 a pale fin (pectorals, pelvics, anal).

Deterministic: the same script writes the same file. `--engine cycles` renders the previews on
the CPU where Workbench has no GPU context (a headless container).
"""

import base64
import json
import math
import sys
from array import array
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

TAG = "[spring-fish]"
NOSE_Z = 0.5
TAIL_Z = -0.5
LENGTH = NOSE_Z - TAIL_Z

# ── The two fish, in numbers ──────────────────────────────────────────────────
# Profiles along the body (u = 0 at the snout, 1 at the tail's base): the top and belly lines
# (measured from the axis, y = 0) and the half-width, in fish lengths (nose to the tail's tips).

SALMON = {
    "name": "salmon",
    "hull": 0,
    "caudal_base_z": -0.36,
    "u":     [0.0, 0.02, 0.06, 0.12, 0.20, 0.30, 0.40, 0.52, 0.64, 0.76, 0.86, 0.93, 1.0],
    "top":   [0.0, 0.020, 0.044, 0.068, 0.087, 0.100, 0.105, 0.100, 0.084, 0.060, 0.041, 0.035, 0.039],
    "belly": [-0.006, -0.022, -0.044, -0.066, -0.084, -0.097, -0.103, -0.099, -0.085, -0.061, -0.041,
              -0.034, -0.037],
    "width": [0.0, 0.015, 0.032, 0.046, 0.055, 0.059, 0.060, 0.056, 0.047, 0.034, 0.021, 0.015, 0.013],
    # Super-ellipse exponent of the section (2 = ellipse; above 2 the flanks flatten) and how much
    # the back is pinched toward a ridge.
    "section_power": 2.15,
    "ridge_pinch": 0.18,
    "body_triangles": 300,
    "eye": {"z": 0.447, "y": 0.021, "r": 0.0125},
}

TROUT = {
    "name": "trout",
    "hull": 1,
    "caudal_base_z": -0.38,
    "u":     [0.0, 0.02, 0.06, 0.12, 0.20, 0.30, 0.40, 0.52, 0.64, 0.76, 0.86, 0.93, 1.0],
    "top":   [0.0, 0.028, 0.058, 0.084, 0.103, 0.115, 0.120, 0.114, 0.098, 0.077, 0.059, 0.053, 0.056],
    "belly": [-0.010, -0.030, -0.057, -0.081, -0.099, -0.111, -0.117, -0.112, -0.097, -0.074, -0.056,
              -0.049, -0.052],
    "width": [0.0, 0.021, 0.041, 0.055, 0.063, 0.067, 0.068, 0.064, 0.055, 0.042, 0.030, 0.024, 0.022],
    "section_power": 2.0,
    "ridge_pinch": 0.12,
    "body_triangles": 300,
    "eye": {"z": 0.437, "y": 0.027, "r": 0.016},
}

RINGS = 60      # sections in the dense loft
AROUND = 32     # vertices round each section (even, with points on the midplane top and bottom)
FIN_CLEARANCE = 0.008  # fish lengths a side fin's blade keeps off the flank
EYE_SIDES = 8

REGION_BODY, REGION_FIN, REGION_EYE, REGION_PALE = 0, 1, 2, 3


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


def top_at(fish, z):
    u = (z - NOSE_Z) / (fish["caudal_base_z"] - NOSE_Z)
    return profile(fish, min(max(u, 0.0), 1.0))


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
    pinch = 1.0 - fish["ridge_pinch"] * max(s, 0.0) ** 2
    return (width * sx * pinch, (top if s >= 0 else -belly) * sy, body_z(fish, u))


def evaluated_triangles(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    n = sum(len(p.vertices) - 2 for p in mesh.polygons)
    ev.to_mesh_clear()
    return n


def build_body(fish):
    """The dense loft as a closed Blender mesh: a vertex at the snout, RINGS sections, a vertex
    closing the tail's base; decimated to the fish's triangle budget."""
    bm = bmesh.new()
    nose_top, nose_belly, _ = profile(fish, 0.0)
    nose = bm.verts.new(to_blender((0.0, (nose_top + nose_belly) * 0.5, NOSE_Z)))
    rings = []
    for i in range(1, RINGS + 1):
        # Sections bunch toward the snout and the tail's wrist, where the shape turns fastest.
        t = i / RINGS
        u = 0.5 - 0.5 * math.cos(math.pi * t)
        u = 0.45 * t + 0.55 * u
        rings.append([bm.verts.new(to_blender(section_point(fish, u, 2 * math.pi * k / AROUND)))
                      for k in range(AROUND)])
    end_top, end_belly, _ = profile(fish, 1.0)
    tail = bm.verts.new(to_blender((0.0, (end_top + end_belly) * 0.5, fish["caudal_base_z"] - 0.006)))
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
    lo, hi, best = 0.0, 1.0, None
    for _ in range(24):
        mid = 0.5 * (lo + hi)
        dec.ratio = mid
        if evaluated_triangles(obj) > fish["body_triangles"]:
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


# ── Fins: thin sheets at their final resolution ───────────────────────────────


class Sheets:
    """Fin and eye geometry in the game frame: vertices with (d, flex, region) and triangles."""

    def __init__(self):
        self.verts = []
        self.normals = []
        self.extra = []
        self.tris = []

    def add(self, p, n, d, flex, region):
        self.verts.append(tuple(p))
        self.normals.append(tuple(n))
        self.extra.append((d, flex, region))
        return len(self.verts) - 1

    def strip(self, root, edge, d, region, normal=(1.0, 0.0, 0.0)):
        """A fin as a strip between a root line (sunk in the body) and its free edge (equal
        lengths); flex grows from the root to the edge, most at the trailing end."""
        n = len(root)
        a = [self.add(p, normal, d, 0.0, region) for p in root]
        b = []
        for k, p in enumerate(edge):
            reach = k / max(n - 1, 1)
            b.append(self.add(p, normal, d, min(1.0, 0.6 + 0.4 * reach), region))
        for k in range(n - 1):
            self.tris.append((a[k], a[k + 1], b[k + 1]))
            self.tris.append((a[k], b[k + 1], b[k]))


def median_fin(sheets, fish, z0, z1, heights, rake, below=False, sink=0.8, region=REGION_FIN):
    """A fin on the midline, on the back (dorsal, adipose) or the belly (anal), from z0 (front) to
    z1; its free edge stands `heights` off the root, raked aft."""
    n = len(heights)
    root, edge = [], []
    for k in range(n):
        z = z0 + (z1 - z0) * k / (n - 1)
        top, belly, _ = top_at(fish, z)
        base = belly if below else top
        sign = -1.0 if below else 1.0
        root.append((0.0, base * sink, z))
        edge.append((0.0, base + sign * heights[k], z - rake * heights[k]))
    sheets.strip(root, edge, 0.08 if below else 0.95, region)


def flank_x(fish, z, y, sink):
    """The body's half-width at height y of the section at z (the section is roughly elliptic)."""
    top, belly, width = top_at(fish, z)
    rel = (y - (top + belly) * 0.5) / max((top - belly) * 0.5, 1e-6)
    return width * math.sqrt(max(0.0, 1.0 - min(rel * rel, 1.0))) * sink


def paired_fin(sheets, fish, z, y_share, length, chord, droop, splay, d, sink=0.8):
    """A pectoral or pelvic pair: the root a short line on the flank, the blade swept back along
    it, drooping by droop and standing out from the wall by splay (radians), its tip rounded."""
    for side in (1.0, -1.0):
        top, belly, _ = top_at(fish, z)
        y = belly + (top - belly) * y_share
        y_hi = y + chord * 0.5
        y_lo = y - chord * 0.5
        root_hi = Vector((side * flank_x(fish, z, y_hi, sink), y_hi, z))
        root_lo = Vector((side * flank_x(fish, z - chord * 0.35, y_lo, sink), y_lo, z - chord * 0.35))
        direction = Vector((math.sin(splay) * side, -math.sin(droop), -math.cos(splay) * math.cos(droop)))
        mid = root_hi.lerp(root_lo, 0.5)
        tip = mid + direction * length
        lead = root_hi.lerp(tip, 0.6) + Vector((0.0, chord * 0.12, 0.0))
        round_ = root_hi.lerp(tip, 0.93) + Vector((0.0, chord * 0.2, -chord * 0.05))
        trail = root_lo.lerp(tip, 0.55) + Vector((0.0, -chord * 0.08, chord * 0.1))
        nrm = (root_lo - root_hi).cross(tip - root_hi).normalized()
        if nrm.x * side < 0:
            nrm = -nrm
        nn = tuple(nrm)
        ids = [sheets.add(tuple(p), nn, d, f, REGION_PALE) for p, f in (
            (root_hi, 0.0), (lead, 0.55), (round_, 0.9), (tip, 1.0), (trail, 0.75), (root_lo, 0.0))]
        for k in range(1, len(ids) - 1):
            sheets.tris.append((ids[0], ids[k], ids[k + 1]))


def caudal_fin(sheets, fish, outline):
    """The tail in the midplane: a fan from a hub at its root round an outline of (z, y, flex),
    upper root first, round the trailing edge, to the lower root."""
    zb = fish["caudal_base_z"]
    hub = sheets.add((0.0, 0.0, zb + 0.012), (1.0, 0.0, 0.0), 0.5, 0.0, REGION_FIN)
    ids = []
    for z, y, flex in outline:
        d = 0.5 + 0.45 * max(-1.0, min(1.0, y / 0.11))
        ids.append(sheets.add((0.0, y, z), (1.0, 0.0, 0.0), d, flex, REGION_FIN))
    for k in range(len(ids) - 1):
        sheets.tris.append((hub, ids[k], ids[k + 1]))


def salmon_tail(fish):
    """Slightly forked: two firm lobes, the trailing edge concave to a shallow notch."""
    zb = fish["caudal_base_z"]
    top, belly, _ = top_at(fish, 1.0)
    upper = [(zb + 0.022, top * 0.8, 0.0), (zb - 0.03, 0.058, 0.3), (zb - 0.085, 0.094, 0.65),
             (TAIL_Z + 0.004, 0.113, 1.0), (TAIL_Z + 0.014, 0.084, 0.95), (TAIL_Z + 0.03, 0.045, 0.85)]
    notch = [(TAIL_Z + 0.042, 0.0, 0.8)]
    lower = [(TAIL_Z + 0.03, -0.044, 0.85), (TAIL_Z + 0.013, -0.082, 0.95), (TAIL_Z + 0.002, -0.11, 1.0),
             (zb - 0.085, -0.092, 0.65), (zb - 0.03, -0.056, 0.3), (zb + 0.022, belly * 0.8, 0.0)]
    return upper + notch + lower


def trout_tail(fish):
    """Square-cut: broad lobes with rounded corners and a near-straight trailing edge."""
    zb = fish["caudal_base_z"]
    top, belly, _ = top_at(fish, 1.0)
    upper = [(zb + 0.02, top * 0.8, 0.0), (zb - 0.03, 0.072, 0.3), (zb - 0.075, 0.1, 0.65),
             (TAIL_Z + 0.012, 0.118, 0.95), (TAIL_Z + 0.001, 0.104, 1.0), (TAIL_Z, 0.06, 0.95)]
    notch = [(TAIL_Z + 0.01, 0.0, 0.85)]
    lower = [(TAIL_Z, -0.058, 0.95), (TAIL_Z + 0.001, -0.101, 1.0), (TAIL_Z + 0.012, -0.115, 0.95),
             (zb - 0.075, -0.097, 0.65), (zb - 0.03, -0.07, 0.3), (zb + 0.02, belly * 0.8, 0.0)]
    return upper + notch + lower


def fins_for(fish):
    sheets = Sheets()
    if fish["hull"] == 0:
        # Dorsal over the middle, its leading rays the tallest; the adipose a small fleshy flap.
        median_fin(sheets, fish, 0.105, -0.018, [0.03, 0.098, 0.088, 0.07, 0.05, 0.032, 0.014], rake=0.55)
        median_fin(sheets, fish, -0.212, -0.262, [0.006, 0.02, 0.024, 0.017, 0.004], rake=0.5)
        median_fin(sheets, fish, -0.162, -0.252, [0.018, 0.064, 0.055, 0.04, 0.025, 0.01], rake=0.45,
                   below=True, region=REGION_PALE)
        paired_fin(sheets, fish, 0.285, 0.2, 0.115, 0.034, 0.42, 0.55, d=0.3)
        paired_fin(sheets, fish, 0.002, 0.06, 0.076, 0.028, 0.5, 0.4, d=0.1)
        caudal_fin(sheets, fish, salmon_tail(fish))
    else:
        # A trout's fins are a little broader and rounder, the adipose larger.
        median_fin(sheets, fish, 0.112, -0.022, [0.036, 0.104, 0.098, 0.082, 0.064, 0.044, 0.022], rake=0.42)
        median_fin(sheets, fish, -0.205, -0.262, [0.008, 0.026, 0.031, 0.024, 0.006], rake=0.45)
        median_fin(sheets, fish, -0.152, -0.248, [0.022, 0.072, 0.066, 0.052, 0.036, 0.018], rake=0.4,
                   below=True, region=REGION_PALE)
        paired_fin(sheets, fish, 0.262, 0.2, 0.122, 0.04, 0.4, 0.55, d=0.3)
        paired_fin(sheets, fish, -0.005, 0.07, 0.082, 0.032, 0.48, 0.4, d=0.1)
        caudal_fin(sheets, fish, trout_tail(fish))
    return sheets


def clear_side_fins(body, sheets):
    """Lift every free point of the side fins at least FIN_CLEARANCE off the body, so a blade swept
    back along a widening flank never lies in the skin to fight it for depth; the roots stay sunk."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(body, depsgraph)
    lifted = 0
    for i, (p, (_d, flex, region)) in enumerate(zip(sheets.verts, sheets.extra)):
        if region != REGION_PALE or flex <= 0.0 or abs(p[0]) < 1e-4:
            continue
        hit, nrm, _, _ = tree.find_nearest(to_blender(p))
        if hit is None:
            continue
        q = Vector(to_game(hit))
        n = Vector(to_game(nrm)).normalized()
        gap = (Vector(p) - q).dot(n)
        if gap < FIN_CLEARANCE:
            sheets.verts[i] = tuple(Vector(p) + n * (FIN_CLEARANCE - gap))
            lifted += 1
    return lifted


def eyes_for(fish, body, sheets):
    """A disc each side, laid on the body's surface (a ray cast in from outside): flex 0 at the
    pupil's centre to 1 at the iris's rim."""
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
        p = p + n * 0.0015
        t1 = Vector((0.0, 1.0, 0.0)).cross(n).normalized()
        t2 = n.cross(t1).normalized()
        centre = sheets.add(tuple(p), tuple(n), 0.62, 0.0, REGION_EYE)
        ring = []
        for k in range(EYE_SIDES):
            a = 2 * math.pi * k / EYE_SIDES
            q = p + (t1 * math.cos(a) + t2 * math.sin(a)) * eye["r"]
            ring.append(sheets.add(tuple(q), tuple(n), 0.62, 1.0, REGION_EYE))
        for k in range(EYE_SIDES):
            a, b = ring[k], ring[(k + 1) % EYE_SIDES]
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
        verts.append(to_game(v.co))
        normals.append(tuple(Vector(to_game(v.normal)).normalized()))
    for g in verts:
        top, belly, _ = top_at(fish, g[2])
        mid = (top + belly) * 0.5
        half = max((top - belly) * 0.5, 1e-4)
        rel = max(-1.0, min(1.0, (g[1] - mid) / half))
        parts.append([0.5 + 0.5 * rel, 0.0, float(fish["hull"] * 4 + REGION_BODY)])
    for p in mesh.polygons:
        tris.append(tuple(p.vertices))
    body_tris = len(tris)
    sheets = fins_for(fish)
    lifted = clear_side_fins(body, sheets)
    print(f"{TAG} {fish['name']}: lifted {lifted} side-fin points off the flank")
    eyes_for(fish, body, sheets)
    # Wind every sheet triangle round its vertices' own normal, so a fin's two sides are the two
    # faces the renderer tells apart.
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
    full = []
    for g, (d, flex, code) in zip(verts, parts):
        s = max(0.0, min(1.0, (NOSE_Z - g[2]) / LENGTH))
        full.append((round(s, 5), round(d, 5), round(flex, 5), code))
    return {
        "fish": fish,
        "body": body,
        "verts": [tuple(round(c, 6) for c in g) for g in verts],
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
        " * Spring's fish: GENERATED by scripts/blender/spring_fish.py (do not edit by hand).",
        " *",
        " * An Atlantic salmon (`salmon`) and a brown trout (`trout`), modelled in Blender. Game frame:",
        " * x the fish's left, y up (its back), z forward; one fish long, the nose at z = +0.5 and the",
        " * tail's tips at z = -0.5 (spring-fish.js scales it). Base64 little-endian: `positions` and",
        " * `normals` Float32 xyz; `parts` Float32 (s along the fish 0 nose..1 tail tips, d dorsal share",
        " * 0 belly..1 back, flex 0 root..1 free edge or pupil..iris rim, code = hull * 4 + region: 0 body,",
        " * 1 dark fin, 2 eye, 3 pale fin); `index` Uint16 triangles, wound outward, the closed body's",
        " * `bodyTriangleCount` first.",
        " */",
        "export const SPRING_FISH_HULLS = Object.freeze({",
        f"    noseZ: {NOSE_Z},",
        f"    tailZ: {TAIL_Z},",
    ]
    for h in hulls:
        lines.extend(hull_block(h))
    lines.extend(["});", ""])
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# ── Previews ──────────────────────────────────────────────────────────────────


def preview_colour(fish, s, d, flex, region):
    """The game's palette, roughly (spring-fish.js shades the real thing)."""
    salmon = fish["hull"] == 0
    if region == REGION_EYE:
        return (0.01, 0.01, 0.012) if flex < 0.55 else ((0.55, 0.56, 0.58) if salmon else (0.62, 0.48, 0.16))
    if region == REGION_FIN:
        return (0.08, 0.09, 0.1) if salmon else (0.2, 0.15, 0.07)
    if region == REGION_PALE:
        return (0.42, 0.43, 0.45) if salmon else (0.55, 0.4, 0.14)
    back = (0.06, 0.1, 0.14) if salmon else (0.12, 0.11, 0.05)
    flank = (0.72, 0.74, 0.76) if salmon else (0.55, 0.42, 0.14)
    belly = (0.92, 0.92, 0.9) if salmon else (0.85, 0.76, 0.5)
    t_back = max(0.0, min(1.0, (d - 0.6) / 0.22))
    t_belly = max(0.0, min(1.0, (0.4 - d) / 0.18))
    c = [flank[k] + (back[k] - flank[k]) * t_back for k in range(3)]
    return tuple(c[k] + (belly[k] - c[k]) * t_belly for k in range(3))


def preview_object(h):
    mesh = bpy.data.meshes.new(f"{h['fish']['name']}-preview")
    mesh.from_pydata([tuple(to_blender(v)) for v in h["verts"]], [], h["tris"])
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True
    col = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i, (s, d, flex, code) in enumerate(h["parts"]):
        col.data[i].color = (*preview_colour(h["fish"], s, d, flex, int(code) % 4), 1.0)
    obj = bpy.data.objects.new(f"{h['fish']['name']}-preview", mesh)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new(f"{h['fish']['name']}-preview")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.45
    mesh.materials.append(mat)
    return obj


def previews(hulls, out_dir, engine):
    scene = bpy.context.scene
    if engine == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 24
        scene.cycles.use_denoising = False
        sun = bpy.data.lights.new("sun", "SUN")
        sun.energy = 3.0
        sun_obj = bpy.data.objects.new("sun", sun)
        sun_obj.rotation_euler = (math.radians(40), math.radians(-25), math.radians(30))
        scene.collection.objects.link(sun_obj)
    else:
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "VERTEX"
    scene.world = bpy.data.worlds.new("river")
    scene.world.color = (0.16, 0.22, 0.24)
    if engine == "cycles":
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.3, 0.38, 0.42, 1.0)
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.render.image_settings.file_format = "PNG"
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
        "side": Vector((1, 0, 0)), "top": Vector((0, 0.001, 1)), "threeq": Vector((0.7, -0.45, 0.35)),
        "below": Vector((0.45, 0.35, -0.75)), "front": Vector((0.25, -1, 0.15)),
    }
    for h in hulls:
        obj = preview_object(h)
        for name, d in views.items():
            d = d.normalized()
            obj.rotation_euler = (0.0, 0.0, math.pi / 2 if name == "top" else 0.0)
            cam.location = d * 3
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            for label, w in (("big", 900), ("g40", 40), ("g20", 20)):
                cam_data.ortho_scale = 1.15
                scene.render.resolution_x = w
                scene.render.resolution_y = int(w * 0.6)
                scene.render.filepath = str(out_dir / f"{h['fish']['name']}-{name}-{label}.png")
                bpy.ops.render.render(write_still=True)
        obj.hide_render = True
    print(f"{TAG} previews in {out_dir}")


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
    out = Path(opts.get("out", "src/themes/spring/spring-fish-hulls.js"))
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    hulls = [gather(SALMON), gather(TROUT)]
    for h in hulls:
        print(f"{TAG} {h['fish']['name']}: {len(h['verts'])} vertices, {len(h['tris'])} triangles "
              f"({h['body_tris']} body)")
    write_module(out, hulls)
    print(f"{TAG} wrote {out}")
    if opts.get("preview"):
        previews(hulls, Path(opts["preview"]), opts.get("engine", "workbench"))


if __name__ == "__main__":
    main()
