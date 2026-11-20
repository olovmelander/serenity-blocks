"""Painted Ages' poplar: the columnar white poplar of the valley's windbreak rows, grown by script.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/painted_ages_poplar.py -- \
        --out src/themes/painted-ages [--preview <dir>]

The valley floor carries rows of the tall narrow poplar a Central Asian farm plants as a
windbreak. The game sees them from 600 m to 2 km: on a 1600 x 900 screen a tree is eight to fifty
pixels tall (half of them under seventeen) and two to twelve wide, so it is grown for its OUTLINE
and for the light on it, never for its leaves:

    trunk     pale, bare for the lowest tenth of the tree, flared at the foot
    column    the inner crown: a slim flame on the trunk's axis, what a cleft between plumes shows
    plumes    the steeply ascending limbs of a fastigiate tree, each with its leaves as one mass:
              a flame of its own that leaves the column a little below its tip, so the outline is
              lumpy and feathered upward, widest about a third of the way up
    leaders   the top: one leading shoot and a second, shorter one beside it (a forked top)

The plumes, column and leaders are ellipsoid blobs along their lines, each pushed about by a noise;
their union is skinned (a voxel remesh), smoothed, given a leafy unevenness and collapsed to three
levels of detail (the theme picks one by tier). Leaf CLUMPS only: at this size a leaf is a sparkle.

Every vertex carries what the theme's material shades it by:

    normal    the mesh's own blended with the whole flame's, so a tree takes the light as one
              shape with lumps on it, not as its triangles
    out       how far out toward the crown's hull it stands (0 in a cleft, 1 on a plume's skin)
    open      how much of the sky it sees (cosine-weighted rays against the tree itself)
    clump     which plume it belongs to (an integer: the theme draws a plume in or pushes it out,
              and turns it gold, tree by tree)
    bark      1 on the trunk, 0 on leaves

The export is one module, src/themes/painted-ages/painted-ages-poplar-model.js: base64 typed
arrays, no loader and no asset file. Every level is the UNIT tree the instance matrix scales: its
foot at y = 0, its top at y = 1, its widest point one unit from the axis. Deterministic: the same
script and the same Blender write the same bytes. Each level is held to its checks first (the unit
bounds, the flame's profile, the bare bole, the lumpy outline, the winding, the triangle budget)
and nothing is written if one fails; what was measured goes into the module as `facts`, and
tests/unit/painted-ages-poplar-model.test.js measures it again from the arrays.

Previews (`--preview`, Workbench): the fine tree turned to six sides and the two leaner levels,
lit and coloured roughly as the theme will (`poplar-form.png`), as outlines (`poplar-outline.png`),
and at the game's size, 28 and 16 pixels tall, enlarged eight times (`poplar-game-*px.png`).

Space: the game's own (x right, y up, z toward the eye), metres while it grows. Objects are turned
upright for Blender (+90 degrees about X) only where a preview is laid out.
"""

import base64
import json
import math
import random
import sys
from array import array
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

TAG = "[painted-ages-poplar]"
SCENE = "PaintedAgesPoplar"
MODULE = "painted-ages-poplar-model.js"
SEED = 0x9091

#: The tree as it grows (metres): a twenty-metre poplar, 4.8 m across at its widest.
HEIGHT = 20.0
RADIUS = 2.4
#: Where the leaves begin (a share of the height) and where the crown is widest (a share of the
#: crown's own height: a fifth of the way up the crown is a third of the way up the tree).
CROWN_BASE = 0.115
WIDEST = 0.2
#: Plumes round the column (the two leaders come on top of these).
PLUMES = 18
#: The skin's voxel (metres) before it is collapsed.
VOXEL = 0.15
#: The levels: name, the crown's triangles, the trunk's sides and rings.
LEVELS = (("fine", 520, 6, 3), ("mid", 300, 5, 3), ("lean", 150, 4, 2))
#: The most triangles a level may hold in all (the theme's budget per tree, by tier).
BUDGET = {"fine": 600, "mid": 340, "lean": 180}
#: Positions are Int16 in units of QUANT (the unit tree spans -1..1 and 0..1).
QUANT = 1.0 / 16384.0


def log(*parts):
    print(TAG, *parts)


# ───────────────────────────── the form ─────────────────────────────

def crown_t(y):
    """A height in metres as a share of the crown's own height (0 at its base, 1 at the tip)."""
    return (y / HEIGHT - CROWN_BASE) / (1.0 - CROWN_BASE)


def crown_y(t):
    return HEIGHT * (CROWN_BASE + (1.0 - CROWN_BASE) * t)


def envelope(y):
    """The crown's hull radius (metres) at a height: a flame, widest a third of the way up."""
    t = crown_t(y)
    if t <= 0.0:
        return RADIUS * 0.46
    if t >= 1.0:
        return 0.0
    if t < WIDEST:
        return RADIUS * (0.46 + 0.54 * math.sin(0.5 * math.pi * t / WIDEST) ** 0.9)
    return RADIUS * (1.0 - ((t - WIDEST) / (1.0 - WIDEST)) ** 1.7) ** 0.8


def grow(rng):
    """The tree as blobs: (centre, cross radius, long radius, long axis, clump id or -1)."""
    blobs = []
    axis_up = Vector((0.0, 1.0, 0.0))
    # The column: the inner crown on the trunk's axis (a cleft's floor).
    y = crown_y(0.0) + 0.9
    while y < crown_y(0.9):
        r = envelope(y) * 0.44
        blobs.append((Vector((rng.uniform(-0.08, 0.08), y, rng.uniform(-0.08, 0.08))), r, 1.15, axis_up, -1))
        y += 0.95
    # The plumes: up the column in a spiral, each a flame of its own that stands off at its tip.
    for i in range(PLUMES):
        t0 = 0.05 + (i + rng.uniform(0.15, 0.85)) / PLUMES * 0.74
        az = i * 2.399963 + rng.uniform(-0.4, 0.4)
        span = (0.27 - 0.11 * max(t0, 0.0)) * rng.uniform(0.82, 1.22)
        reach = rng.uniform(0.76, 1.0)
        girth = rng.uniform(0.34, 0.46)
        drift = rng.uniform(-0.3, 0.3)
        steps = 4
        previous = None
        for k in range(steps):
            s = k / (steps - 1)
            y = crown_y(t0 + span * s)
            hull = envelope(y)
            w = max(0.26, hull * girth * (1.0 - 0.62 * s ** 1.35))
            # Its skin stands at `reach` of the hull; its tip a little proud of the column.
            rho = max(hull * reach * (1.0 + 0.04 * s) - w * 0.9, hull * 0.16)
            a = az + drift * s
            centre = Vector((math.cos(a) * rho, y, math.sin(a) * rho))
            axis = (centre - previous).normalized() if previous is not None else Vector((math.cos(a) * 0.22, 1.0, math.sin(a) * 0.22)).normalized()
            long = span * (1.0 - CROWN_BASE) * HEIGHT / (steps - 1) * (0.86 if k < steps - 1 else 1.25)
            blobs.append((centre, w, long, axis, i))
            previous = centre
    # The leading shoot, and a second one beside it: a forked top.
    for clump, (t_from, t_to, off, az, r0, r1) in enumerate((
            (0.78, 0.985, 0.0, 0.0, 0.46, 0.24),
            (0.72, 0.94, 0.72, rng.uniform(0.0, math.tau), 0.4, 0.2),
    )):
        steps = 4
        for k in range(steps):
            s = k / (steps - 1)
            y = crown_y(t_from + (t_to - t_from) * s)
            rho = off * (0.55 + 0.45 * s)
            centre = Vector((math.cos(az) * rho, y, math.sin(az) * rho))
            long = (t_to - t_from) * (1.0 - CROWN_BASE) * HEIGHT / (steps - 1) * (0.9 if k < steps - 1 else 1.05)
            blobs.append((centre, r0 + (r1 - r0) * s, long, axis_up, PLUMES + clump))
    return blobs


def blob_matrix(centre, cross, long, axis):
    z = axis.normalized()
    ref = Vector((1.0, 0.0, 0.0)) if abs(z.x) < 0.9 else Vector((0.0, 0.0, 1.0))
    x = ref.cross(z).normalized()
    y = z.cross(x)
    turn = Matrix((x, y, z)).transposed()
    return Matrix.Translation(centre) @ turn.to_4x4() @ Matrix.Diagonal((cross, cross, long, 1.0))


# ───────────────────────────── Blender helpers ─────────────────────────────

def scene_of():
    scene = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    if bpy.context.window is not None:
        bpy.context.window.scene = scene
    return scene


def object_from(scene, name, P, T):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in P], [], [tuple(int(i) for i in t) for t in T])
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def evaluated_arrays(ob):
    """The object's evaluated mesh (its modifiers applied) as triangles."""
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.ensure_lookup_table()
    P = np.array([v.co[:] for v in bm.verts], dtype=np.float64).reshape(-1, 3)
    T = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64).reshape(-1, 3)
    bm.free()
    bpy.data.meshes.remove(me)
    return P, T


def discard(ob):
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if me.users == 0:
        bpy.data.meshes.remove(me)


def smooth_normals(P, T):
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, T[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-20)


def skin(scene, blobs):
    """The union of the blobs as one closed skin, smoothed, with a leafy unevenness."""
    bm = bmesh.new()
    for k, (centre, cross, long, axis, _) in enumerate(blobs):
        made = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0, matrix=blob_matrix(centre, cross, long, axis))
        for v in made["verts"]:
            d = v.co - centre
            q = v.co * 0.85 + Vector((k * 0.71 + 3.1, k * 1.3, 1.7))
            v.co = centre + d * (1.0 + 0.2 * noise.noise(q))
    me = bpy.data.meshes.new("blobs")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("blobs", me)
    scene.collection.objects.link(ob)
    mod = ob.modifiers.new("remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = VOXEL
    mod.adaptivity = 0.0
    P, T = evaluated_arrays(ob)
    discard(ob)
    bm = bmesh.new()
    me = bpy.data.meshes.new("skin")
    me.from_pydata([tuple(p) for p in P], [], [tuple(int(i) for i in t) for t in T])
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.verts.ensure_lookup_table()
    P = np.array([v.co[:] for v in bm.verts], dtype=np.float64).reshape(-1, 3)
    T = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64).reshape(-1, 3)
    bm.free()
    # Leaves are not a smooth skin: sprays stand off it, more toward a plume's tip.
    N = smooth_normals(P, T)
    for i in range(len(P)):
        p = Vector(P[i])
        rough = 0.11 * noise.noise(p * 1.15 + Vector((5.0, 0.0, 2.0))) + 0.05 * noise.noise(p * 2.7 + Vector((0.0, 9.0, 4.0)))
        P[i] += N[i] * rough
    return P, T


def decimated(scene, P, T, target):
    """The skin collapsed to about `target` triangles."""
    ob = object_from(scene, "decimate", P, T)
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = target / len(T)
    mod.use_collapse_triangulate = True
    P2, T2 = evaluated_arrays(ob)
    discard(ob)
    return P2, T2


def trunk(sides, rings):
    """The bole: a tapering tube from the ground into the crown (open at both ends: its foot is
    in the ground and its top inside the leaves)."""
    top = crown_y(0.0) + 1.3
    P = []
    T = []
    for j in range(rings):
        f = j / (rings - 1)
        # Rings crowd toward the foot, where the flare is.
        y = top * f ** 1.8
        r = 0.2 + 0.16 * math.exp(-y / 0.55) + 0.06 * (1.0 - y / top)
        for k in range(sides):
            a = math.tau * (k + 0.5 * j) / sides
            P.append((math.cos(a) * r, y, math.sin(a) * r))
    for j in range(rings - 1):
        for k in range(sides):
            a = j * sides + k
            b = j * sides + (k + 1) % sides
            c = a + sides
            d = b + sides
            # Seen from outside the corners run counter-clockwise (y up, angle turning x toward z).
            T.append((a, c, b))
            T.append((b, c, d))
    return np.array(P, dtype=np.float64), np.array(T, dtype=np.int64)


# ───────────────────────────── what a vertex carries ─────────────────────────────

def cosine_directions(n):
    """n directions over the +z hemisphere, cosine-weighted (a sunflower on the disc, lifted)."""
    out = []
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)
        a = i * 2.399963229728653
        out.append((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1.0 - r * r))))
    return out


def sky_seen(P, N, T, samples=64, reach=4.0, bias=0.05):
    """How much of the sky each vertex sees: cosine-weighted rays about its normal against the
    tree itself, a hit counting less the farther off it is."""
    bvh = BVHTree.FromPolygons([Vector(p) for p in P], [tuple(int(i) for i in t) for t in T], all_triangles=True, epsilon=0.0)
    dirs = cosine_directions(samples)
    rng = random.Random(SEED + 7)
    seen = np.ones(len(P))
    for i in range(len(P)):
        n = Vector(N[i])
        ref = Vector((0.0, 1.0, 0.0)) if abs(n.y) < 0.9 else Vector((1.0, 0.0, 0.0))
        u = ref.cross(n).normalized()
        v = n.cross(u)
        spin = rng.random() * math.tau
        cs, sn = math.cos(spin), math.sin(spin)
        o = Vector(P[i]) + n * bias
        occluded = 0.0
        for dx, dy, dz in dirs:
            d = u * (dx * cs - dy * sn) + v * (dx * sn + dy * cs) + n * dz
            hit = bvh.ray_cast(o, d, reach)
            if hit[0] is not None:
                occluded += 1.0 - (hit[3] / reach) ** 2
        seen[i] = 1.0 - occluded / samples
    return seen


def hull_normals(P):
    """The whole flame's normal at each point: out from the axis, tilted as the hull tapers."""
    N = np.zeros_like(P)
    for i, (x, y, z) in enumerate(P):
        r = math.hypot(x, z)
        slope = (envelope(y + 0.25) - envelope(y - 0.25)) / 0.5
        if r < 1e-6:
            N[i] = (0.0, 1.0, 0.0)
            continue
        n = Vector((x / r, -slope, z / r))
        # Near the tip the hull closes over: its normal turns up.
        lift = max(0.0, crown_t(y) - 0.9) / 0.1
        n = n.normalized().lerp(Vector((0.0, 1.0, 0.0)), min(1.0, lift) * 0.6)
        N[i] = n.normalized()[:]
    return N


def clump_of(P, blobs):
    """The plume each point belongs to: the nearest blob in its own measure (an ellipsoid's)."""
    ids = np.zeros(len(P), dtype=np.int64)
    plumes = [(c, w, long, axis.normalized(), k) for c, w, long, axis, k in blobs if k >= 0]
    for i, p in enumerate(P):
        best = 1e9
        v = Vector(p)
        for c, w, long, axis, k in plumes:
            d = v - c
            along = d.dot(axis)
            across = (d - axis * along).length
            m = math.hypot(across / w, along / long)
            if m < best:
                best = m
                ids[i] = k
    return ids


class Level:
    """One level of detail as the module stores it (the unit tree)."""

    def __init__(self, name, P, N, T, out, seen, clump, bark):
        self.name = name
        self.metres = P
        self.tri = T
        self.out = out
        self.open = seen
        self.clump = clump
        self.bark = bark
        self.reach = float(np.max(np.hypot(P[:, 0], P[:, 2])))
        self.top = float(np.max(P[:, 1]))
        unit = np.array([1.0 / self.reach, 1.0 / self.top, 1.0 / self.reach])
        # As the module stores them (so that what is measured here holds for the arrays to the last bit).
        self.pos = np.round(P * unit / QUANT) * QUANT
        # A normal goes by the inverse transpose of what its surface goes by.
        n = N / unit
        self.nrm = np.round(n / np.linalg.norm(n, axis=1, keepdims=True) * 32767.0) / 32767.0


def build_level(scene, name, fine, blobs, target, sides, rings):
    P, T = decimated(scene, fine[0], fine[1], target)
    N = smooth_normals(P, T)
    # One shape with lumps on it: the mesh's normal leans toward the whole flame's.
    H = hull_normals(P)
    blend = N * 0.5 + H * 0.5
    blend /= np.maximum(np.linalg.norm(blend, axis=1, keepdims=True), 1e-9)
    seen = sky_seen(P, N, T)
    r = np.hypot(P[:, 0], P[:, 2])
    hull = np.array([max(envelope(y), 0.3) for y in P[:, 1]])
    # 0 on the column (a cleft's floor), 1 where a plume's skin stands on the hull; the tip is all skin.
    out = np.clip((r / hull - 0.5) / 0.5, 0.0, 1.0)
    tip = np.clip((np.array([crown_t(y) for y in P[:, 1]]) - 0.86) / 0.1, 0.0, 1.0)
    out = np.maximum(out, tip)
    clump = clump_of(P, blobs)
    tP, tT = trunk(sides, rings)
    tr = np.hypot(tP[:, 0], tP[:, 2])
    tN = np.stack([tP[:, 0] / tr, np.full(len(tP), 0.08), tP[:, 2] / tr], axis=1)
    tN /= np.linalg.norm(tN, axis=1, keepdims=True)
    base = len(P)
    # The bole under the leaves is in their shade.
    t_open = np.clip(1.0 - tP[:, 1] / (crown_y(0.0) + 0.6), 0.25, 1.0)
    return Level(
        name,
        np.concatenate([P, tP]),
        np.concatenate([blend, tN]),
        np.concatenate([T, tT + base]),
        np.concatenate([out, np.zeros(len(tP))]),
        np.concatenate([seen, t_open]),
        np.concatenate([clump, np.zeros(len(tP), dtype=np.int64)]),
        np.concatenate([np.zeros(len(P)), np.ones(len(tP))]),
    )


# ───────────────────────────── the script's own checks ─────────────────────────────

def facing_out(level):
    """The share of triangles whose own normal agrees with their vertices' (an inside-out mesh scores near zero)."""
    P = level.pos
    T = level.tri
    face = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    mean = level.nrm[T[:, 0]] + level.nrm[T[:, 1]] + level.nrm[T[:, 2]]
    return float(np.mean(np.einsum("ij,ij->i", face, mean) > 0))


def volume(level):
    """The volume the leaves' faces enclose (the unit tree's; negative if they are wound inward)."""
    P = level.pos
    T = level.tri[level.bark[level.tri[:, 0]] < 0.5]
    return float(np.einsum("ij,ij->i", P[T[:, 0]], np.cross(P[T[:, 1]], P[T[:, 2]])).sum() / 6.0)


def profile(level, bands=10):
    """The crown's reach (the unit tree's radius) in each tenth of its height."""
    P = level.pos
    r = np.hypot(P[:, 0], P[:, 2])
    out = []
    for b in range(bands):
        inside = (P[:, 1] >= b / bands) & (P[:, 1] <= (b + 1) / bands)
        out.append(round(float(r[inside].max()) if inside.any() else 0.0, 4))
    return out


def measure(level):
    P = level.pos
    r = np.hypot(P[:, 0], P[:, 2])
    leaf = level.bark < 0.5
    widest = int(np.argmax(r))
    # How uneven the outline is: in each tenth of the crown's middle, how far the innermost leaf
    # stands inside the outermost (0 a smooth spindle, toward 1 clefts down to the bole), averaged.
    spans = []
    for b in range(2, 8):
        inside = leaf & (P[:, 1] >= b / 10) & (P[:, 1] <= (b + 1) / 10)
        spans.append(1.0 - float(r[inside].min()) / float(r[inside].max()))
    return {
        "vertices": int(len(P)),
        "triangles": int(len(level.tri)),
        "widestAt": round(float(P[widest, 1]), 4),
        "crownBase": round(float(P[leaf, 1].min()), 4),
        "lumps": round(float(np.mean(spans)), 4),
        "facingOut": round(facing_out(level), 4),
        "volume": round(volume(level), 4),
        "profile": profile(level),
        "clumps": int(len(set(level.clump[leaf].tolist()))),
    }


def check(level, facts):
    name = level.name
    P = level.pos
    r = np.hypot(P[:, 0], P[:, 2])
    problems = []
    if not np.isfinite(P).all() or not np.isfinite(level.nrm).all():
        problems.append("a number is not finite")
    if abs(r.max() - 1.0) > 1.5 * QUANT or abs(P[:, 1].max() - 1.0) > 1e-9 or abs(P[:, 1].min()) > 1e-9:
        problems.append(f"not the unit tree: reach {r.max()}, y {P[:, 1].min()}..{P[:, 1].max()}")
    if facts["triangles"] > BUDGET[name]:
        problems.append(f"{facts['triangles']} triangles, over the budget of {BUDGET[name]}")
    shape = facts["profile"]
    if max(shape[2], shape[3]) < 0.92 or not 0.2 <= facts["widestAt"] <= 0.6:
        problems.append(f"not widest about a third up: {shape}, widest at {facts['widestAt']}")
    if shape[8] > 0.62 or shape[9] > 0.42 or shape[0] > 0.5:
        problems.append(f"the profile is no flame: {shape}")
    if not 0.07 <= facts["crownBase"] <= 0.14:
        problems.append(f"the leaves begin at {facts['crownBase']}, not about a tenth up")
    # The stored normals lean toward the whole flame's, so a cleft's faces disagree with them:
    # the volume the faces enclose says which way they are wound.
    if facts["facingOut"] < 0.8 or facts["volume"] <= 0:
        problems.append(f"inside out: {facts['facingOut']} of its faces look outward, volume {facts['volume']}")
    if facts["lumps"] < 0.3:
        problems.append(f"the outline is too even ({facts['lumps']})")
    return problems


# ───────────────────────────── the module ─────────────────────────────

def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def byte(x):
    return int(round(max(0.0, min(1.0, float(x))) * 255))


def write_module(path, levels, facts):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Painted Ages' poplar: GENERATED by scripts/blender/painted_ages_poplar.py (do not edit by",
        " * hand). To write it again, byte for byte:",
        " *",
        " *     blender --background --factory-startup --python scripts/blender/painted_ages_poplar.py -- \\",
        " *         --out src/themes/painted-ages",
        " *",
        " * The columnar white poplar of the valley's windbreak rows, grown in Blender: a pale bole, a",
        " * slim inner column and eighteen steeply ascending plumes of leaves round it, two leaders at",
        " * the top; skinned as one mass and collapsed to three levels of detail. Every level is the",
        " * UNIT tree an instance matrix scales by (radius, height, radius): x right, y up, its foot at",
        " * y = 0, its top at y = 1, its widest point one unit from the axis. `grown` is the size it",
        " * grew at (metres).",
        " *",
        " * `positions` Int16 in units of `quant`; `normals` Int16 (/ 32767: the unit tree's own, the",
        " * mesh's blended with the whole flame's); `crown` Uint8 x 4 per vertex: out (/ 255: 0 in a",
        " * cleft, 1 on a plume's skin), open (/ 255: how much sky it sees), clump (the plume's index, an",
        " * integer below `clumps`), bark (0 leaves, 255 the bole); `index` Uint16 triangles, wound",
        " * counter-clockwise seen from outside. `facts` are what the script measured and held each",
        " * level to (the tests measure them again from the arrays).",
        " */",
        "export const PAINTED_AGES_POPLAR = Object.freeze({",
        f"    quant: {QUANT!r},",
        f"    grown: {json.dumps({'height': HEIGHT, 'radius': RADIUS})},",
        f"    clumps: {PLUMES + 2},",
        f"    budget: {json.dumps(BUDGET)},",
        "    levels: [",
    ]
    for level in levels:
        positions = [int(round(c / QUANT)) for p in level.pos for c in p]
        if max(abs(p) for p in positions) > 32767:
            raise RuntimeError(f"{TAG} {level.name} does not fit the stored positions")
        normals = [int(round(max(-1.0, min(1.0, c)) * 32767)) for n in level.nrm for c in n]
        crown = []
        for i in range(len(level.pos)):
            crown += [byte(level.out[i]), byte(level.open[i]), int(level.clump[i]), 255 if level.bark[i] > 0.5 else 0]
        index = [int(i) for t in level.tri for i in t]
        lines += [
            "        {",
            f"            name: {json.dumps(level.name)},",
            f"            vertexCount: {len(level.pos)},",
            f"            triangleCount: {len(level.tri)},",
            f"            facts: {json.dumps(facts[level.name], separators=(', ', ': '))},",
            f"            positions: '{b64('h', positions)}',",
            f"            normals: '{b64('h', normals)}',",
            f"            crown: '{b64('B', crown)}',",
            f"            index: '{b64('H', index)}',",
            "        },",
        ]
    lines += ["    ],", "});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# ───────────────────────────── previews ─────────────────────────────

GAME_PX = (28, 16)   # a tree's height on screen, pixels: a near row and a far one
ENLARGE = 8


def enlarge(path, times):
    """Write `path` again `times` larger, every pixel a square: what the game shows, readable."""
    image = bpy.data.images.load(str(path))
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    big = np.repeat(np.repeat(pixels.reshape(h, w, 4), times, axis=0), times, axis=1)
    result = bpy.data.images.new("PoplarEnlarged", w * times, h * times, alpha=True)
    result.pixels.foreach_set(big.ravel())
    result.filepath_raw = str(path)
    result.file_format = "PNG"
    result.save()
    bpy.data.images.remove(image)
    bpy.data.images.remove(result)


def preview_object(scene, name, level, turn, x, gold):
    """A level stood upright for Blender at x, turned about its axis, coloured as the theme will
    (roughly): a dark green core, gold tips, darker where it sees little sky, a pale bole."""
    c, s = math.cos(turn), math.sin(turn)
    verts = []
    for px, py, pz in level.metres:
        gx = px * c + pz * s
        gz = -px * s + pz * c
        verts.append((gx + x, -gz, py))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [tuple(int(i) for i in t) for t in level.tri])
    for poly in me.polygons:
        poly.use_smooth = True
    me.update()
    colours = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    for i in range(len(verts)):
        if level.bark[i] > 0.5:
            rgb = (0.5, 0.47, 0.4)
        else:
            light = level.out[i] * (0.35 + 0.65 * level.open[i])
            turned = min(1.0, max(0.0, gold * 1.9 - 0.45 + (level.pos[i][1] - 0.5) * 0.5 + (level.out[i] - 0.6) * 0.5))
            green = (0.05 + 0.12 * light, 0.09 + 0.16 * light, 0.025 + 0.03 * light)
            yellow = (0.34 + 0.5 * light, 0.19 + 0.42 * light, 0.03 + 0.08 * light)
            rgb = tuple(green[k] + (yellow[k] - green[k]) * turned for k in range(3))
            shade = 0.45 + 0.55 * level.open[i]
            rgb = tuple(v * shade for v in rgb)
        colours.data[i].color = (rgb[0], rgb[1], rgb[2], 1.0)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def previews(scene, levels, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_object_outline = False
    shading.show_cavity = False
    world = bpy.data.worlds.new("PoplarWorld")
    scene.world = world
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    shading.background_type = "WORLD"
    cam_data = bpy.data.cameras.new("PoplarCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("PoplarCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.rotation_euler = (math.radians(90), 0.0, 0.0)
    by_name = {level.name: level for level in levels}
    # The fine tree turned to six sides (three gold, three half-turned), then the leaner levels.
    row = [("fine", k * math.tau / 6, 0.95 if k % 2 == 0 else 0.5) for k in range(6)] + [("mid", 0.0, 0.95), ("mid", 2.1, 0.2), ("lean", 0.0, 0.95), ("lean", 2.1, 0.5)]
    spacing = 7.0
    objects = [preview_object(scene, f"pv{k}", by_name[name], turn, (k - (len(row) - 1) / 2) * spacing, gold)
               for k, (name, turn, gold) in enumerate(row)]
    width = spacing * len(row)
    cam.location = (0.0, -80.0, HEIGHT / 2)
    cam_data.ortho_scale = width
    files = []
    jobs = [("form", 2000, (0.33, 0.4, 0.55), "STUDIO"), ("outline", 2000, (0.72, 0.62, 0.52), "FLAT")]
    jobs += [(f"game-{px}px", round(width / HEIGHT * px), (0.6, 0.5, 0.42), "STUDIO") for px in GAME_PX]
    for label, pixels, sky, light in jobs:
        world.color = sky
        shading.light = light
        shading.color_type = "SINGLE" if label == "outline" else "VERTEX"
        shading.single_color = (0.05, 0.05, 0.04)
        scene.render.resolution_x = pixels
        scene.render.resolution_y = max(8, round(pixels * (HEIGHT + 3.0) / width))
        scene.render.resolution_percentage = 100
        path = out / f"poplar-{label}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        if label.startswith("game"):
            enlarge(path, ENLARGE)
        files.append(str(path))
    for ob in objects:
        discard(ob)
    return files


# ───────────────────────────── entry point ─────────────────────────────

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        if a == "--preview":
            preview_dir = argv[i + 1]
    scene = scene_of()
    rng = random.Random(SEED)
    blobs = grow(rng)
    fine = skin(scene, blobs)
    log(f"{len(blobs)} blobs, the skin {len(fine[1])} triangles")
    levels = []
    facts = {}
    problems = []
    for name, target, sides, rings in LEVELS:
        level = build_level(scene, name, fine, blobs, target, sides, rings)
        facts[name] = measure(level)
        problems += [f"{name}: {p}" for p in check(level, facts[name])]
        levels.append(level)
        log(name, json.dumps(facts[name]))
    for p in problems:
        log("CHECK FAILED", p)
    if out:
        if problems:
            raise RuntimeError(f"{TAG} the tree fails its checks; nothing written")
        path = Path(out)
        path = path if path.suffix == ".js" else path / MODULE
        write_module(path, levels, facts)
        log("wrote", path, f"{path.stat().st_size / 1024:.1f} KiB")
    if preview_dir:
        for f in previews(scene, levels, preview_dir):
            log("preview", f)


if __name__ == "__main__":
    main()
