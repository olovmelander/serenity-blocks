"""Rainbow Terraces: the overlook's balustrade and the grove's trees, built by script in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/rainbow_terraces_models.py -- \
        --out src/themes/rainbow-terraces [--preview <dir>] [--blend <file.blend>] [--only trees,balustrade]

(`--out` writes the module, so give it only with both halves built: `--only` is for previews.)

The theme loads nothing from disk, so what Blender builds here is written out as numbers: one
module, src/themes/rainbow-terraces/rainbow-terraces-models.js (base64 typed arrays, no loader and
no asset file), which rainbow-terraces-model-build.js turns into BufferGeometry. Deterministic: the
same script and the same Blender write the same bytes.

Space: the game's own. x to the frame's right, y up, z toward the eye; metres for the balustrade
(the top of the paving at y = 0, the newel pier at x = 0.25, the rail running off toward -x), and
"sizes" for the trees (a tree is scaled by its spot's size; its foot at the origin, where the turf
is, its trunk running on down to y = -0.5 so that it never floats). Objects are turned upright
(+90 degrees about X) only where a scene is laid out for a preview or a .blend.

The balustrade (a weathered stone balustrade at human scale, the nearest thing to the eye):

    rail       the plinth course and the moulded handrail, each a profile run along x, chipped
    pier       the newel: a plinth, a base moulding, a panelled die, the handrail's own moulding
               returned round it as its cap, a ball finial on a neck (the far pier is its mirror)
    baluster   a turned vase between a square plinth block and a square abacus (two levels)
    paving     flagstones in courses, each its own value, V-joints, a worn and chipped lip
    ledge      what the paving lies on: a bed of rock behind a retaining wall of coursed ashlar
               (the eye's side), a block of it fallen out
    ivy        stems that climb the pier and trail along the rail, and the leaves on them; weeds
               in the paving's joints, dropped leaves (places, not triangles: the theme grows a
               leaf at each)

The trees (smooth, low-poly, shaded by a baked ambient occlusion: darker inside and under):

    cypress    an Italian cypress: one tapering flame of clumped plumes with a pointed tip
    pine       a stone pine: a bare leaning trunk, forking limbs, a broad flat-domed canopy
    shrub      a rounded mound of merged clumps

Each tree comes in variants and in three levels (the crown close by, the crown across the gulf, a
far isle's). Foliage is a union of blobs (a voxel remesh), smoothed and decimated; its normals lean
toward the whole form's so that a tree takes the light as one shape, not as its triangles.

Every vertex carries what the theme's one stone material shades it by: a normal, an ambient
occlusion (cosine-weighted rays against the model in its place: the pier beside its rail, a
baluster between its neighbours, a tree over its ground), a moss weight on the paving and the wall.

Previews (`--preview`): the trees' levels side by side and at the size the game draws them, the
balustrade through the game's own lens at rest and through the icon's (EYE below is measured in the
theme), in Workbench with the shipped normals and (colour x occlusion) per vertex.
"""

import base64
import math
import random
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree
from mathutils.geometry import tessellate_polygon

TAG = "[rainbow-terraces-models]"
SCENE = "RT_Models"
MODULE = "rainbow-terraces-models.js"

#: The theme's stone kinds (rainbow-terraces-isles.js, MAT).
MAT = {"travertine": 0, "iron": 1, "bronze": 2, "masonry": 3, "crown": 4, "leaf": 5}

# ── The balustrade's lay-out (metres; the theme reads these from the module) ──
PITCH = 0.46
BALUSTERS = 15
BALUSTER_X0 = -0.42
PIER_X = 0.25
PIER_HALF = 0.30
#: The far pier stands as far past the last baluster as the newel does before the first.
FAR_PIER_X = BALUSTER_X0 - (BALUSTERS - 1) * PITCH - (PIER_X - PIER_HALF - BALUSTER_X0) - PIER_HALF
RAIL_X0 = FAR_PIER_X + PIER_HALF - 0.05
RAIL_X1 = PIER_X - PIER_HALF + 0.05
Y_COURSE = 0.15
BALUSTER_H = 0.92
Y_RAIL = Y_COURSE + BALUSTER_H
Y_RAIL_TOP = 1.31
TOP = 1.72
#: The ledge: its paving's extent in plan, the rock's foot.
LEDGE = {"x0": -11.0, "x1": 1.5, "z0": -1.22, "z1": 6.0, "foot": -3.2, "slab": 0.10}
#: The eye in the balustrade's own frame at rest in a 16:9 frame (measured in the theme), for previews.
EYE = {"pos": (0.0, 3.738, 12.451), "forward": (0.6039, 0.1266, -0.7869), "up": (-0.0771, 0.992, 0.1004), "vfov": 56.0}


def log(*a):
    print(TAG, *a)
    sys.stdout.flush()


# ───────────────────────────── small maths ─────────────────────────────

def V(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth01(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def piecewise(points, t):
    """Smoothly through a list of (t, value) control points (Catmull-Rom on the values)."""
    if t <= points[0][0]:
        return points[0][1]
    if t >= points[-1][0]:
        return points[-1][1]
    for i in range(len(points) - 1):
        t0, v0 = points[i]
        t1, v1 = points[i + 1]
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            vm = points[i - 1][1] if i > 0 else v0
            vp = points[i + 2][1] if i + 2 < len(points) else v1
            return 0.5 * ((2 * v0) + (-vm + v1) * u + (2 * vm - 5 * v0 + 4 * v1 - vp) * u * u + (-vm + 3 * v0 - 3 * v1 + vp) * u ** 3)
    return points[-1][1]


def fbm(p, octaves=3, lacunarity=2.03):
    a = 0.0
    amp = 0.5
    q = Vector(p)
    for _ in range(octaves):
        a += noise.noise(q) * amp
        q = q * lacunarity
        amp *= 0.5
    return a


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n.x += (p.y - q.y) * (p.z + q.z)
        n.y += (p.z - q.z) * (p.x + q.x)
        n.z += (p.x - q.x) * (p.y + q.y)
    return n


def catmull(points, step):
    """A polyline through `points`, resampled about every `step` along a Catmull-Rom spline."""
    pts = [Vector(p) for p in points]
    out = []
    for i in range(len(pts) - 1):
        p0 = pts[max(0, i - 1)]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[min(len(pts) - 1, i + 2)]
        n = max(1, int(math.ceil((p2 - p1).length / step)))
        for j in range(n):
            u = j / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    out.append(pts[-1])
    return out


# ───────────────────────────── polygon soup ─────────────────────────────

class Soup:
    """Polygons under construction: `v` points, `f` index tuples wound counter-clockwise seen
    from outside, `a` a (tint, moss) pair per point (the slab's own value, the moss weight), or
    (tint, moss, group): points of different groups are never welded, so no normal is smoothed
    across from one to the other (a flagstone's top stays flat beside its worn nosing)."""

    def __init__(self):
        self.v = []
        self.f = []
        self.a = []

    def add(self, verts, faces, attr=(1.0, 0.0)):
        base = len(self.v)
        for p in verts:
            self.v.append(Vector(p))
            self.a.append(attr)
        self.f.extend(tuple(base + i for i in face) for face in faces)
        return base

    def face_out(self, pts, inside, attr=(1.0, 0.0), attrs=None, toward=False):
        """A polygon of new points, wound so that it faces away from `inside` (or `toward` it)."""
        pts = [Vector(p) for p in pts]
        n = newell(pts)
        c = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
        order = list(range(len(pts)))
        if (n.dot(c - Vector(inside)) < 0) != toward:
            order.reverse()
        base = len(self.v)
        for i in order:
            self.v.append(pts[i])
            self.a.append(attrs[i] if attrs else attr)
        self.f.append(tuple(range(base, base + len(pts))))

    def merge(self, other):
        base = len(self.v)
        self.v.extend(other.v)
        self.a.extend(other.a)
        self.f.extend(tuple(base + i for i in face) for face in other.f)
        return self

    def moved(self, matrix):
        out = Soup()
        out.v = [matrix @ p for p in self.v]
        out.a = list(self.a)
        out.f = list(self.f)
        return out

    def triangles(self):
        P = self.v
        T = []
        for f in self.f:
            if len(f) == 3:
                T.append(f)
            elif len(f) == 4:
                a, b, c, d = f
                if (P[a] - P[c]).length_squared <= (P[b] - P[d]).length_squared:
                    T += [(a, b, c), (a, c, d)]
                else:
                    T += [(a, b, d), (b, c, d)]
            else:
                pts = [P[i] for i in f]
                n = newell(pts)
                for tri in tessellate_polygon([pts]):
                    i, j, k = (f[t] for t in tri)
                    if (P[j] - P[i]).cross(P[k] - P[i]).dot(n) < 0:
                        j, k = k, j
                    T.append((i, j, k))
        return T


def loft(rings, cap_start=True, cap_end=True, skip=(), fan=False):
    """Rings of equal length, each running counter-clockwise seen from the next ring's side,
    joined by quads (ring pairs in `skip` left open), capped with polygons (or, `fan`, with a fan
    about each end ring's middle: a ring with points in line cannot be cut into ears)."""
    s = Soup()
    n = len(rings[0])
    for r in rings:
        s.add(r, [])
    for i in range(len(rings) - 1):
        if i in skip:
            continue
        for k in range(n):
            k1 = (k + 1) % n
            s.f.append((i * n + k, i * n + k1, (i + 1) * n + k1, (i + 1) * n + k))
    last = (len(rings) - 1) * n
    if fan:
        for on, base, flip in ((cap_start, 0, True), (cap_end, last, False)):
            if not on:
                continue
            mid = s.add([sum(s.v[base:base + n], Vector((0.0, 0.0, 0.0))) / n], [])
            for k in range(n):
                k1 = (k + 1) % n
                s.f.append((mid, base + k1, base + k) if flip else (mid, base + k, base + k1))
        return s
    if cap_start:
        s.f.append(tuple(reversed(range(n))))
    if cap_end:
        s.f.append(tuple(range(last, last + n)))
    return s


def ring_circle(cx, y, cz, r, sides, phase=0.0):
    """A level circle, from +x toward -z (counter-clockwise seen from above)."""
    return [V(cx + r * math.cos(phase + 2 * math.pi * k / sides), y, cz - r * math.sin(phase + 2 * math.pi * k / sides)) for k in range(sides)]


def ring_rect(x0, x1, y, z0, z1):
    return [V(x1, y, z0), V(x0, y, z0), V(x0, y, z1), V(x1, y, z1)]


def box(x0, x1, y0, y1, z0, z1, bottom=True, top=True):
    return loft([ring_rect(x0, x1, y0, z0, z1), ring_rect(x0, x1, y1, z0, z1)], cap_start=bottom, cap_end=top)


def lathe(profile, sides, cx=0.0, cz=0.0, pole_top=False, cap_bottom=False, cap_top=False, phase=0.0):
    """A profile of (radius, y) turned about the vertical through (cx, cz), bottom first."""
    rings = [ring_circle(cx, y, cz, r, sides, phase) for r, y in profile if r > 1e-6]
    s = loft(rings, cap_start=cap_bottom, cap_end=cap_top and not pole_top)
    if pole_top:
        r, y = profile[-1]
        assert r <= 1e-6
        base = (len(rings) - 1) * sides
        tip = s.add([V(cx, y, cz)], [])
        for k in range(sides):
            s.f.append((base + k, base + (k + 1) % sides, tip))
    return s


def tube(points, radii, sides, cap_start=False, cap_end=False, twist=0.0):
    """A tube along a polyline (parallel-transported frames), its faces outward."""
    pts = [Vector(p) for p in points]
    rings = []
    t_prev = None
    u = None
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        t = (b - a).normalized()
        if u is None:
            ref = Vector((1.0, 0.0, 0.0)) if abs(t.x) < 0.9 else Vector((0.0, 0.0, 1.0))
            u = (ref - t * ref.dot(t)).normalized()
        else:
            u = (u - t * u.dot(t))
            if u.length < 1e-6:
                u = t_prev.cross(t)
            u.normalize()
        v = t.cross(u)
        r = radii[i] if hasattr(radii, "__len__") else radii
        rings.append([p + (u * math.cos(twist + 2 * math.pi * k / sides) + v * math.sin(twist + 2 * math.pi * k / sides)) * r for k in range(sides)])
        t_prev = t
    return loft(rings, cap_start=cap_start, cap_end=cap_end)


# ───────────────────────────── meshes as arrays ─────────────────────────────

def weld(soup, tol=2e-5):
    """Welded points (points with different attributes stay apart) and the triangles on them."""
    keys = {}
    P = []
    A = []
    remap = []
    for p, a in zip(soup.v, soup.a):
        k = (round(p.x / tol), round(p.y / tol), round(p.z / tol), round(a[0] * 255), round(a[1] * 255), a[2] if len(a) > 2 else 0)
        i = keys.get(k)
        if i is None:
            i = len(P)
            keys[k] = i
            P.append((p.x, p.y, p.z))
            A.append(a[:2])
        remap.append(i)
    T = []
    for a, b, c in soup.triangles():
        a, b, c = remap[a], remap[b], remap[c]
        if a == b or b == c or a == c:
            continue
        T.append((a, b, c))
    P = np.array(P, dtype=np.float64).reshape(-1, 3)
    T = np.array(T, dtype=np.int64).reshape(-1, 3)
    if len(T):
        area = np.linalg.norm(np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]), axis=1)
        T = T[area > 1e-12]
    return P, T, np.array(A, dtype=np.float64).reshape(-1, 2)


def face_normals(P, T):
    n = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    l = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(l, 1e-20)


def corner_normals(P, T, angle_deg):
    """A normal for every triangle corner: the angle-weighted mean of the faces round its point
    that lie within `angle_deg` of the corner's own face (so an arris stays an arris)."""
    fn = face_normals(P, T)
    w = np.zeros((len(T), 3))
    for k in range(3):
        a = P[T[:, (k + 1) % 3]] - P[T[:, k]]
        b = P[T[:, (k + 2) % 3]] - P[T[:, k]]
        cosang = np.einsum("ij,ij->i", a, b) / np.maximum(np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1), 1e-20)
        w[:, k] = np.arccos(np.clip(cosang, -1.0, 1.0))
    incident = [[] for _ in range(len(P))]
    for t in range(len(T)):
        for k in range(3):
            incident[T[t, k]].append((t, k))
    limit = math.cos(math.radians(angle_deg)) - 1e-9
    N = np.zeros((len(T), 3, 3))
    for lst in incident:
        if not lst:
            continue
        ts = np.array([t for t, _ in lst])
        ws = np.array([w[t, k] for t, k in lst])
        fns = fn[ts]
        close = fns @ fns.T >= limit
        sums = (close * ws[None, :]) @ fns
        sums /= np.maximum(np.linalg.norm(sums, axis=1, keepdims=True), 1e-20)
        for j, (t, k) in enumerate(lst):
            N[t, k] = sums[j]
    return N


class Group:
    """One stone kind's vertices: positions, normals, triangles, and what is baked onto them."""

    def __init__(self, mat, pos, nrm, tri, tint=None, moss=None):
        self.mat = mat
        self.pos = np.asarray(pos, dtype=np.float64).reshape(-1, 3)
        self.nrm = np.asarray(nrm, dtype=np.float64).reshape(-1, 3)
        self.tri = np.asarray(tri, dtype=np.int64).reshape(-1, 3)
        self.tint = np.ones(len(self.pos)) if tint is None else np.asarray(tint, dtype=np.float64)
        self.moss = np.zeros(len(self.pos)) if moss is None else np.asarray(moss, dtype=np.float64)
        self.ao = np.ones(len(self.pos))
        # The geometric normals the occlusion is cast about (the shading normals may lean).
        self.cast = self.nrm.copy()

    def moved(self, dx=0.0, dy=0.0, dz=0.0):
        g = Group(self.mat, self.pos + np.array([dx, dy, dz]), self.nrm, self.tri, self.tint, self.moss)
        g.ao = self.ao.copy()
        g.cast = self.cast
        return g

    def mirrored_x(self, about):
        pos = self.pos.copy()
        pos[:, 0] = 2 * about - pos[:, 0]
        nrm = self.nrm.copy()
        nrm[:, 0] *= -1
        g = Group(self.mat, pos, nrm, self.tri[:, ::-1], self.tint, self.moss)
        g.ao = self.ao.copy()
        return g


def group_of(mat, soup, angle=35.0):
    """A soup as a group: welded, its corners' normals split where the stone turns sharply."""
    P, T, A = weld(soup)
    CN = corner_normals(P, T, angle)
    keys = {}
    pos = []
    nrm = []
    tint = []
    moss = []
    tri = []
    for t in range(len(T)):
        out = []
        for k in range(3):
            v = int(T[t, k])
            n = CN[t, k]
            key = (v, int(round(n[0] * 60)), int(round(n[1] * 60)), int(round(n[2] * 60)))
            i = keys.get(key)
            if i is None:
                i = len(pos)
                keys[key] = i
                pos.append(P[v])
                nrm.append(n)
                tint.append(A[v, 0])
                moss.append(A[v, 1])
            out.append(i)
        tri.append(out)
    return Group(mat, pos, nrm, tri, tint, moss)


def signed_volume(P, T):
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def closed_pieces(P, T, tol=1e-3):
    """The connected pieces of a mesh (points welded at `tol`, as the theme's tests weld them):
    [(closed, consistent, volume, triangle indices)]."""
    ids = {}
    vid = np.zeros(len(P), dtype=np.int64)
    for i, p in enumerate(P):
        k = (round(p[0] / tol), round(p[1] / tol), round(p[2] / tol))
        vid[i] = ids.setdefault(k, len(ids))
    parent = list(range(len(ids)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    tris = [(t, vid[a], vid[b], vid[c]) for t, (a, b, c) in enumerate(T) if len({vid[a], vid[b], vid[c]}) == 3]
    for _, a, b, c in tris:
        parent[find(a)] = find(b)
        parent[find(b)] = find(c)
    pieces = {}
    for t, a, b, c in tris:
        r = find(a)
        piece = pieces.setdefault(r, {"edges": {}, "volume": 0.0, "tris": []})
        A, B, C = P[T[t, 0]], P[T[t, 1]], P[T[t, 2]]
        piece["volume"] += float(np.dot(A, np.cross(B, C))) / 6.0
        piece["tris"].append(t)
        for e in ((a, b), (b, c), (c, a)):
            piece["edges"][e] = piece["edges"].get(e, 0) + 1
    out = []
    for piece in pieces.values():
        edges = piece["edges"]
        closed = all((b, a) in edges for (a, b) in edges)
        consistent = all(n == 1 for n in edges.values())
        out.append((closed, consistent, piece["volume"], piece["tris"]))
    return out


def face_outward(group, label):
    """Turn every closed piece of a group to face out (positive volume); report what it is."""
    pieces = closed_pieces(group.pos, group.tri)
    flipped = 0
    for closed, _consistent, volume, tris in pieces:
        if closed and volume < 0:
            group.tri[tris] = group.tri[tris][:, ::-1]
            flipped += 1
    if flipped:
        log(f"  {label}: turned {flipped} closed piece(s) to face out")
    return [(c, s, v) for c, s, v, _ in closed_pieces(group.pos, group.tri)]


# ───────────────────────────── ambient occlusion ─────────────────────────────

def cosine_directions(n):
    """n directions over the +z hemisphere, cosine-weighted (a sunflower on the disc, lifted)."""
    out = []
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)
        a = i * 2.399963229728653
        out.append((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1.0 - r * r))))
    return out


def tree_of(groups):
    """A BVH over groups' triangles."""
    verts = []
    polys = []
    for g in groups:
        base = len(verts)
        verts.extend(Vector(p) for p in g.pos)
        polys.extend((int(a) + base, int(b) + base, int(c) + base) for a, b, c in g.tri)
    return BVHTree.FromPolygons(verts, polys, all_triangles=True, epsilon=0.0)


def bake_ao(group, bvh, samples=96, reach=1.0, bias=0.004, ground=None, falloff=True, seed=1):
    """Ambient occlusion per vertex: cosine-weighted rays about its normal against `bvh` (and a
    ground plane at y = `ground`), a hit counting less the farther off it is."""
    rng = random.Random(seed)
    dirs = cosine_directions(samples)
    ao = np.ones(len(group.pos))
    for i in range(len(group.pos)):
        n = Vector(group.cast[i])
        if n.length < 1e-9:
            continue
        n.normalize()
        ref = Vector((0.0, 1.0, 0.0)) if abs(n.y) < 0.9 else Vector((1.0, 0.0, 0.0))
        u = ref.cross(n).normalized()
        v = n.cross(u)
        spin = rng.random() * 2 * math.pi
        cs, sn = math.cos(spin), math.sin(spin)
        o = Vector(group.pos[i]) + n * bias
        if ground is not None and o.y < ground:
            ao[i] = 0.0
            continue
        occ = 0.0
        for dx, dy, dz in dirs:
            x = dx * cs - dy * sn
            y = dx * sn + dy * cs
            d = u * x + v * y + n * dz
            hit = bvh.ray_cast(o, d, reach)
            dist = hit[3] if hit[0] is not None else None
            if ground is not None and d.y < -1e-6:
                tg = (ground - o.y) / d.y
                if 0 <= tg < reach and (dist is None or tg < dist):
                    dist = tg
            if dist is not None:
                occ += (1.0 - (dist / reach) ** 2) if falloff else 1.0
        ao[i] = 1.0 - occ / samples
    return ao


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


def blob_union(scene, blobs, voxel, seed, lumps=0.16, smooth=3):
    """The union of ellipsoid blobs as one closed skin: [(centre, radii, tilt matrix or None)].
    Each blob's own skin is pushed about by a noise first, so the clumps are not eggs."""
    bm = bmesh.new()
    for k, (c, r, tilt) in enumerate(blobs):
        m = Matrix.Translation(Vector(c)) @ (tilt.to_4x4() if tilt is not None else Matrix.Identity(4)) @ Matrix.Diagonal((r[0], r[1], r[2], 1.0))
        made = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0, matrix=m)
        for v in made["verts"]:
            d = v.co - Vector(c)
            q = v.co * (1.6 / max(r)) * 0.35 + Vector((seed * 3.1 + k * 0.7, k * 1.3, seed * 1.7))
            v.co = Vector(c) + d * (1.0 + lumps * noise.noise(q))
    me = bpy.data.meshes.new("blobs")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("blobs", me)
    scene.collection.objects.link(ob)
    mod = ob.modifiers.new("remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    mod.adaptivity = 0.0
    P, T = evaluated_arrays(ob)
    discard(ob)
    if smooth:
        bm = bmesh.new()
        me = bpy.data.meshes.new("skin")
        me.from_pydata([tuple(p) for p in P], [], [tuple(int(i) for i in t) for t in T])
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        for _ in range(smooth):
            bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.verts.ensure_lookup_table()
        P = np.array([v.co[:] for v in bm.verts], dtype=np.float64).reshape(-1, 3)
        T = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64).reshape(-1, 3)
        bm.free()
    return P, T


def decimated(scene, P, T, target):
    """The skin collapsed to about `target` triangles (still one closed piece)."""
    if len(T) <= target:
        return P, T
    ob = object_from(scene, "decimate", P, T)
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = target / len(T)
    mod.use_collapse_triangulate = True
    P2, T2 = evaluated_arrays(ob)
    discard(ob)
    return P2, T2


def cavity(P, T, N):
    """How far each point lies under the mean of its neighbours, in edge lengths (> 0 in a cleft)."""
    total = np.zeros_like(P)
    count = np.zeros(len(P))
    length = np.zeros(len(P))
    for a, b in ((0, 1), (1, 2), (2, 0)):
        i, j = T[:, a], T[:, b]
        np.add.at(total, i, P[j])
        np.add.at(count, i, 1)
        np.add.at(length, i, np.linalg.norm(P[j] - P[i], axis=1))
    count = np.maximum(count, 1)
    return np.einsum("ij,ij->i", total / count[:, None] - P, N) / np.maximum(length / count, 1e-9)


def smooth_normals(P, T):
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, T[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-20)


# ───────────────────────────── the trees ─────────────────────────────

#: Triangles of foliage per level (the crown close by, across the gulf, on a far isle).
FOLIAGE = {"cypress": (470, 210, 60), "pine": (460, 200, 56), "shrub": (128, 60, 26)}

CYPRESS_FLAME = [(0.0, 0.42), (0.05, 0.72), (0.13, 0.93), (0.26, 1.0), (0.42, 0.93), (0.58, 0.78), (0.72, 0.58), (0.84, 0.38),
                 (0.93, 0.2), (1.0, 0.03)]


def cypress_blobs(rng, variant):
    """An Italian cypress: plumes that stand up along a tapering flame, leaning out a little."""
    slim = variant == 0
    y0, y1 = (0.2, 3.9) if slim else (0.16, 3.55)
    rmax = 0.36 if slim else 0.43
    phase = rng.uniform(0, 6.28)
    sway = 0.05 if slim else 0.08

    def axis(t):
        return (sway * math.sin(t * 2.6 + phase) * t, sway * 0.7 * math.cos(t * 2.1 + phase * 1.7) * t)

    blobs = []
    for i in range(16):
        t = i / 15 * 0.97
        ax, az = axis(t)
        r = rmax * piecewise(CYPRESS_FLAME, t) * (0.7 if slim else 0.62)
        blobs.append(((ax, lerp(y0, y1, t), az), (r, max(r * 1.5, 0.15), r), None))
    plumes = 13
    for k in range(plumes):
        t = min(0.88, max(0.0, (k + rng.uniform(-0.25, 0.25)) / plumes * 0.88))
        a = k * 2.2 + rng.uniform(-0.3, 0.3)
        ax, az = axis(t)
        R = rmax * piecewise(CYPRESS_FLAME, t)
        rr = R * rng.uniform(0.52, 0.66) + 0.03
        out = R * rng.uniform(0.98, 1.08 if slim else 1.12) - rr * 0.9
        tall = max(rr * rng.uniform(2.6, 3.4), 0.5)
        lean = math.radians(rng.uniform(5, 12))
        radial = Vector((math.cos(a), 0.0, math.sin(a)))
        tilt = Matrix.Rotation(-lean, 3, radial.cross(Vector((0.0, 1.0, 0.0))))
        blobs.append(((ax + radial.x * out, lerp(y0, y1, t) + tall * 0.35, az + radial.z * out), (rr, tall, rr), tilt))
    ax, az = axis(1.0)
    blobs.append(((ax, y1 - 0.2, az), (0.055, 0.3, 0.055), Matrix.Rotation(math.radians(rng.uniform(-5, 5)), 3, "X")))
    return blobs, {"axis": axis, "y0": y0, "y1": y1, "rmax": rmax}


def pine_plan(rng, variant):
    """A stone pine: the trunk's line, its limbs, and the clumps of its parasol."""
    if variant == 0:
        trunk = [(0.0, -0.5, 0.0), (0.0, 0.0, 0.0), (0.05, 0.5, 0.01), (0.15, 1.0, 0.03), (0.24, 1.42, 0.02)]
        fork = Vector(trunk[-1])
        limbs = [
            [fork, (0.0, 1.75, 0.16), (-0.38, 2.02, 0.24), (-0.66, 2.12, 0.26)],
            [fork, (0.42, 1.78, -0.06), (0.62, 2.1, -0.15), (0.76, 2.3, -0.18)],
            [fork, (0.26, 1.8, 0.22), (0.28, 2.12, 0.46), (0.3, 2.34, 0.6)],
            [fork, (0.2, 1.82, -0.2), (0.08, 2.14, -0.44), (0.0, 2.36, -0.58)],
        ]
        centre = Vector((0.2, 2.38, 0.02))
        spread = (0.96, 0.86)
        side = [((-0.72, 2.1, 0.26), (0.44, 0.25, 0.42)), ((-0.52, 2.2, 0.1), (0.4, 0.24, 0.38))]
        flat = 2.14
    else:
        trunk = [(0.0, -0.5, 0.0), (0.0, 0.0, 0.0), (-0.04, 0.45, -0.02), (-0.1, 0.9, 0.0), (-0.12, 1.22, 0.02)]
        fork = Vector(trunk[-1])
        limbs = [
            [fork, (-0.3, 1.62, 0.02), (-0.48, 2.0, 0.06), (-0.64, 2.3, 0.1)],
            [fork, (0.08, 1.6, 0.04), (0.34, 1.98, 0.0), (0.62, 2.28, -0.08)],
            [fork, (-0.1, 1.66, 0.2), (-0.06, 2.06, 0.44), (0.0, 2.34, 0.62)],
            [fork, (-0.14, 1.66, -0.18), (-0.2, 2.06, -0.42), (-0.22, 2.32, -0.6)],
        ]
        centre = Vector((-0.06, 2.44, 0.02))
        spread = (1.0, 0.9)
        side = [((0.76, 2.2, -0.1), (0.4, 0.24, 0.38))]
        flat = 2.2
    blobs = []
    ring = 7
    for k in range(ring):
        a = k / ring * 2 * math.pi + rng.uniform(-0.2, 0.2)
        d = rng.uniform(0.56, 0.68)
        r = rng.uniform(0.4, 0.52)
        blobs.append(((centre.x + math.cos(a) * spread[0] * d, centre.y - 0.08 + rng.uniform(-0.06, 0.05), centre.z + math.sin(a) * spread[1] * d),
                      (r, r * rng.uniform(0.7, 0.86), r), None))
    for k in range(4):
        a = k / 4 * 2 * math.pi + rng.uniform(-0.5, 0.5)
        d = rng.uniform(0.16, 0.32)
        r = rng.uniform(0.44, 0.56)
        blobs.append(((centre.x + math.cos(a) * spread[0] * d, centre.y + 0.16 + rng.uniform(-0.04, 0.08), centre.z + math.sin(a) * spread[1] * d),
                      (r, r * rng.uniform(0.72, 0.86), r), None))
    blobs.append(((centre.x, centre.y - 0.05, centre.z), (spread[0] * 0.62, 0.3, spread[1] * 0.62), None))
    for c, r in side:
        blobs.append((c, r, None))
    return {"trunk": trunk, "limbs": limbs, "blobs": blobs, "centre": centre, "spread": spread, "flat": flat}


def shrub_blobs(rng):
    """A rounded mound: its radius 1, its top near y = 1, its skirts down under the turf."""
    blobs = [((0.0, 0.26, 0.0), (0.78, 0.7, 0.74), None)]
    for k in range(5):
        a = k / 5 * 2 * math.pi + rng.uniform(-0.3, 0.3)
        d = rng.uniform(0.4, 0.54)
        r = rng.uniform(0.4, 0.5)
        blobs.append(((math.cos(a) * d, rng.uniform(0.12, 0.34), math.sin(a) * d), (r, r * rng.uniform(1.0, 1.2), r), None))
    blobs.append(((rng.uniform(-0.15, 0.15), 0.6, rng.uniform(-0.15, 0.15)), (0.46, 0.42, 0.46), None))
    return blobs


def foliage_group(P, T, form, lean=0.5):
    """Foliage as a group: smooth normals that lean toward the whole form's (`form(p)`)."""
    P, T = P.copy(), T.copy()
    if signed_volume(P, T) < 0:
        T = T[:, ::-1]
    N = smooth_normals(P, T)
    F = np.array([form(p) for p in P])
    F /= np.maximum(np.linalg.norm(F, axis=1, keepdims=True), 1e-20)
    S = N * (1 - lean) + F * lean
    S /= np.maximum(np.linalg.norm(S, axis=1, keepdims=True), 1e-20)
    g = Group(MAT["leaf"], P, S, T)
    g.cast = N
    return g


def tree_levels(scene, kind, variant, seed):
    """One tree at its three levels: [[groups]] (bark first, then leaf), baked."""
    rng = random.Random(seed)
    levels = []
    if kind == "cypress":
        blobs, info = cypress_blobs(rng, variant)
        P, T = blob_union(scene, blobs, 0.03, seed, lumps=0.2, smooth=2)
        skirt = 0.12
        low = P[:, 1] < skirt
        P[low, 1] = skirt - (skirt - P[low, 1]) * 0.2

        def form(p):
            t = (p[1] - info["y0"]) / (info["y1"] - info["y0"])
            ax, az = info["axis"](min(1.0, max(0.0, t)))
            d = Vector((p[0] - ax, 0.0, p[2] - az))
            if d.length < 1e-6:
                return (0.0, 1.0, 0.0)
            d.normalize()
            up = 0.22 + 1.4 * smooth01((t - 0.86) / 0.14) - 0.9 * smooth01((0.07 - t) / 0.07)
            return (d.x, up, d.z)

        lean = 0.3
        trunks = [
            tube([(0, -0.5, 0), (0, 0.0, 0), (0, 0.3, 0), (0, 0.55, 0)], [0.085, 0.07, 0.058, 0.05], 6),
            tube([(0, -0.5, 0), (0, 0.05, 0), (0, 0.5, 0)], [0.085, 0.068, 0.05], 5),
            tube([(0, -0.5, 0), (0, 0.45, 0)], [0.085, 0.055], 3),
        ]
    elif kind == "pine":
        plan = pine_plan(rng, variant)
        P, T = blob_union(scene, plan["blobs"], 0.04, seed, lumps=0.2, smooth=3)
        # A parasol: what hangs below its eaves is pressed up nearly flat.
        low = P[:, 1] < plan["flat"]
        P[low, 1] = plan["flat"] - (plan["flat"] - P[low, 1]) * 0.36
        c = plan["centre"]

        def form(p):
            d = Vector(((p[0] - c.x) / plan["spread"][0], 0.0, (p[2] - c.z) / plan["spread"][1]))
            rim = min(1.0, d.length)
            under = p[1] < plan["flat"] + 0.03
            if d.length > 1e-6:
                d.normalize()
            return (d.x * rim * 0.9, -0.9 if under else (1.0 - 0.55 * rim), d.z * rim * 0.9)

        tr = plan["trunk"]
        trunk_r = [0.088, 0.08, 0.071, 0.063, 0.056]

        def limb(points, r0, sides, step):
            pts = catmull(points, step)
            return tube(pts, [lerp(r0, r0 * 0.42, i / (len(pts) - 1)) for i in range(len(pts))], sides)

        t0 = tube(tr, trunk_r, 6)
        for pts in plan["limbs"]:
            t0.merge(limb(pts, 0.046, 4, 0.3))
        t1 = tube([tr[0], tr[1], tr[3], tr[4]], [trunk_r[0], trunk_r[1], trunk_r[3], trunk_r[4]], 5)
        for pts in plan["limbs"][:3]:
            t1.merge(limb([pts[0], pts[2], pts[3]], 0.046, 3, 0.6))
        t2 = tube([tr[0], tr[2], tr[4], tuple(c)], [trunk_r[0], trunk_r[2], trunk_r[4], 0.04], 3)
        trunks = [t0, t1, t2]
        lean = 0.5
    else:
        P, T = blob_union(scene, shrub_blobs(rng), 0.04, seed, lumps=0.22, smooth=3)

        def form(p):
            d = Vector((p[0], max(0.0, p[1] - 0.1) * 1.3 + 0.25, p[2]))
            return tuple(d)

        trunks = [None, None, None]
        lean = 0.45
    full = None
    for level, target in enumerate(FOLIAGE[kind]):
        Pd, Td = decimated(scene, P, T, target)
        # (A far tree's few faces turn too sharply to lean its normals far off them.)
        leaf = foliage_group(Pd, Td, form, lean if level < 2 else lean * 0.5)
        groups = []
        if trunks[level] is not None:
            groups.append(group_of(MAT["iron"], trunks[level], angle=80.0))
        groups.append(leaf)
        if full is None:
            full = groups
        # Occlusion against the finest level (its own shape, more truly) over its ground.
        bvh = tree_of(full)
        for g in groups:
            sky = bake_ao(g, bvh, samples=128, reach=4.0, bias=0.02, ground=0.0, falloff=False, seed=seed + level)
            near = bake_ao(g, bvh, samples=64, reach=0.7, bias=0.02, ground=None, falloff=True, seed=seed + 7 + level)
            # The open sky it sees (the big shapes: lit above, dark under), and the clefts close by.
            g.ao = np.clip(0.3 + 0.7 * sky ** 0.9 * near ** 1.4, 0.0, 1.0)
            if g.mat == MAT["leaf"]:
                g.ao *= 1.0 - np.clip(cavity(g.pos, g.tri, g.cast) * 1.6, -0.12, 0.4)
                g.ao = np.clip(g.ao, 0.28, 1.0)
        for g in groups:
            pieces = face_outward(g, f"{kind}{variant}/{level}")
            if g.mat == MAT["leaf"]:
                closed = [p for p in pieces if p[0]]
                assert len(closed) >= 1 and all(p[2] > 0 for p in closed), f"{kind}{variant}/{level}: foliage is not a closed skin"
        levels.append(groups)
        log(f"  {kind}{variant} level {level}: {sum(len(g.tri) for g in groups)} triangles, {sum(len(g.pos) for g in groups)} vertices")
    return levels


def build_trees(scene):
    trees = {}
    plan = [("cypress", 0, 11), ("cypress", 1, 12), ("pine", 0, 21), ("pine", 1, 22), ("shrub", 0, 31)]
    for kind, variant, seed in plan:
        trees.setdefault(kind, []).append(tree_levels(scene, kind, variant, seed))
    return trees


# ───────────────────────────── the balustrade ─────────────────────────────

#: Half the handrail's profile, (z, y): from its bed up over the cyma and the corona to the crown
#: of its weathered top.
RAIL_HALF = [(0.150, 1.070), (0.150, 1.092), (0.163, 1.100), (0.176, 1.118), (0.196, 1.140), (0.208, 1.166), (0.214, 1.184),
             (0.224, 1.184), (0.224, 1.246), (0.212, 1.268), (0.180, 1.288), (0.100, 1.303), (0.0, 1.310)]
#: Half the plinth course's (it runs on a little under the paving).
COURSE_HALF = [(0.200, -0.03), (0.200, 0.105), (0.190, 0.128), (0.165, 0.146), (0.0, 0.150)]
#: The pier, (half width, y): its plinth and base moulding up to the die ...
PIER_BASE = [(0.41, -0.03), (0.41, 0.195), (0.402, 0.218), (0.378, 0.236), (0.362, 0.240), (0.362, 0.258), (0.352, 0.280),
             (0.334, 0.300), (0.314, 0.318), (0.304, 0.335), (0.30, 0.352)]
#: ... and over the die the handrail's own moulding returned round it as its cap, then the finial's block.
PIER_CAP = [(z + PIER_HALF - RAIL_HALF[0][0], y) for z, y in RAIL_HALF[:11]] + [(0.25, 1.302), (0.172, 1.308), (0.172, 1.342), (0.158, 1.356)]
#: The finial, (radius, y): a neck with an astragal, then a ball whose crown is the balustrade's top.
BALL = {"y": TOP - 0.146, "r": 0.146}
FINIAL = [(0.112, 1.34), (0.112, 1.366), (0.07, 1.392), (0.084, 1.41), (0.084, 1.422), (0.064, 1.432)] + [
    (BALL["r"] * math.cos(math.radians(a)), BALL["y"] + BALL["r"] * math.sin(math.radians(a))) for a in (-62, -38, -14, 10, 34, 56, 74)
] + [(0.0, TOP)]
#: A baluster's turned part, (radius, height over its plinth block), at two levels: [sides, profile].
TURNED = [
    [8, [(0.092, 0.0), (0.092, 0.035), (0.072, 0.06), (0.112, 0.15), (0.112, 0.24), (0.075, 0.40), (0.046, 0.60), (0.064, 0.668),
         (0.05, 0.70), (0.09, 0.81)]],
    [12, [(0.090, 0.0), (0.094, 0.03), (0.072, 0.058), (0.094, 0.10), (0.115, 0.17), (0.114, 0.24), (0.094, 0.33), (0.066, 0.44),
          (0.047, 0.56), (0.045, 0.645), (0.065, 0.668), (0.049, 0.694), (0.055, 0.75), (0.090, 0.81)]],
]
BLOCK = {"half": 0.1, "h": 0.055}
#: Chips knocked off the arrises, (x, y, z, radius): mostly on the eye's side.
RAIL_CHIPS = [(-0.62, 1.275, 0.245, 0.06), (-1.55, 1.2, 0.25, 0.05), (-2.9, 1.262, 0.24, 0.075), (-3.45, 1.325, 0.16, 0.045),
              (-4.9, 1.27, 0.245, 0.055), (-6.2, 1.21, 0.25, 0.06), (-5.6, 1.27, -0.245, 0.05), (-2.1, 1.27, -0.245, 0.05)]
COURSE_CHIPS = [(-1.02, 0.15, 0.225, 0.06), (-3.7, 0.13, 0.23, 0.07), (-5.9, 0.15, 0.225, 0.05)]
PIER_CHIPS = [(PIER_X - 0.395, 1.245, 0.395, 0.085), (PIER_X + 0.43, 0.2, 0.43, 0.09), (PIER_X + 0.315, 0.76, 0.315, 0.045),
              (PIER_X + 0.1, 1.262, 0.4, 0.045), (PIER_X - 0.43, 0.06, 0.43, 0.06)]


def profile_run(half, x0, x1):
    """A profile symmetric about z = 0, run along x: one closed solid."""
    full = list(half) + [(-z, y) for z, y in reversed(half[:-1])]
    return loft([[V(x, y, z) for z, y in full] for x in (x1, x0)])


def lump(rng, centre, radius):
    """A rough convex lump (what a chip leaves is its negative)."""
    bm = bmesh.new()
    for _ in range(14):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if d.length < 1e-3:
            continue
        d.normalize()
        bm.verts.new(Vector(centre) + d * radius * rng.uniform(0.78, 1.15))
    hull = bmesh.ops.convex_hull(bm, input=bm.verts[:])
    inner = [e for e in hull["geom_interior"] if isinstance(e, bmesh.types.BMVert)]
    if inner:
        bmesh.ops.delete(bm, geom=inner, context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def chipped(scene, soup, chips, rng):
    """A closed solid with chips knocked off it (lumps cut away by a boolean)."""
    P, T, _ = weld(soup)
    if signed_volume(P, T) < 0:
        T = T[:, ::-1]
    before = len(T)
    ob = object_from(scene, "chip-target", P, T)
    cutters = []
    for k, (x, y, z, r) in enumerate(chips):
        bm = lump(rng, (x, y, z), r)
        me = bpy.data.meshes.new("lump")
        bm.to_mesh(me)
        bm.free()
        cut = bpy.data.objects.new("lump", me)
        scene.collection.objects.link(cut)
        mod = ob.modifiers.new(f"chip{k}", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cut
        mod.solver = "EXACT"
        cutters.append(cut)
    P2, T2 = evaluated_arrays(ob)
    discard(ob)
    for cut in cutters:
        discard(cut)
    assert len(T2) >= before, "a chip's boolean lost the solid"
    out = Soup()
    out.add([Vector(p) for p in P2], [tuple(int(i) for i in t) for t in T2])
    return out


def pier_soup():
    """The newel pier without its finial: one closed solid (lofted squares), its die panelled."""
    cx, cz = PIER_X, 0.0
    prof = PIER_BASE + PIER_CAP
    die = len(PIER_BASE) - 1
    s = loft([ring_rect(cx - h, cx + h, y, cz - h, cz + h) for h, y in prof], skip=(die,))
    y0 = PIER_BASE[-1][1]
    y1 = PIER_CAP[0][1]
    h = PIER_HALF
    inside = V(cx, (y0 + y1) / 2, cz)
    up = V(0, 1, 0)
    for n in (V(0, 0, -1), V(-1, 0, 0), V(0, 0, 1), V(1, 0, 0)):
        t = n.cross(up)
        mid = V(cx, 0, cz) + n * h

        def rect(half, lo, hi, sink=0.0):
            return [mid + t * (-half) + up * lo - n * sink, mid + t * half + up * lo - n * sink,
                    mid + t * half + up * hi - n * sink, mid + t * (-half) + up * hi - n * sink]

        outer = rect(h, y0, y1)
        inner = rect(h - 0.085, y0 + 0.1, y1 - 0.1)
        floor = rect(h - 0.1, y0 + 0.115, y1 - 0.115, 0.03)
        mouth = mid + up * ((y0 + y1) / 2) + n * 0.1
        for j in range(4):
            s.face_out([outer[j], outer[(j + 1) % 4], inner[(j + 1) % 4], inner[j]], inside)
            s.face_out([inner[j], inner[(j + 1) % 4], floor[(j + 1) % 4], floor[j]], mouth, toward=True)
        s.face_out(floor, inside)
    return s


def baluster_soup(level):
    """A baluster on the plinth course at x = 0: a square plinth block, the turned vase, a square abacus."""
    sides, profile = TURNED[level]
    b, bh = BLOCK["half"], BLOCK["h"]
    y0 = Y_COURSE
    s = box(-b, b, y0, y0 + bh, -b, b, bottom=False)
    s.merge(lathe([(r, y0 + bh + h) for r, h in profile], sides, phase=math.pi / sides))
    s.merge(box(-b, b, Y_RAIL - bh, Y_RAIL, -b, b, top=False))
    return s


# ── The paving ──

PAVING_ROWS = [LEDGE["z0"], -0.36, 0.38, 1.26, 2.12, 3.06, 3.98, 4.92, LEDGE["z1"]]


def paving_warp(x, z):
    """The setting-out lines are a mason's, not a machine's."""
    return (x + 0.013 * noise.noise(Vector((x * 0.9, z * 0.9, 3.1))), z + 0.013 * noise.noise(Vector((x * 0.9 + 7.7, z * 0.9, 1.3))))


def paving_cells(rng):
    cells = []
    L = LEDGE
    for r in range(len(PAVING_ROWS) - 1):
        xs = [L["x1"]]
        first = True
        while xs[-1] > L["x0"] + 1e-6:
            x = xs[-1]
            length = rng.uniform(1.5, 2.4) if x < -8.4 else rng.uniform(0.72, 1.4)
            if first:
                length *= rng.uniform(0.55, 1.0)
                first = False
            nx = x - length
            if nx - L["x0"] < 0.6:
                nx = L["x0"]
            xs.append(nx)
        for i in range(len(xs) - 1):
            cells.append({"x0": xs[i + 1], "x1": xs[i], "z0": PAVING_ROWS[r], "z1": PAVING_ROWS[r + 1], "row": r, "col": i,
                          "far": r == 0, "front": r == len(PAVING_ROWS) - 2, "right": i == 0, "left": i == len(xs) - 2})
    return cells


def slab(s, cell, rng):
    """One flagstone: a lid with bevelled joints; on the ledge's edges a worn, chipped outline, and
    along the front (the eye's side) a rounded nosing over the slab's own thickness."""
    x0, x1, z0, z1 = cell["x0"], cell["x1"], cell["z0"], cell["z1"]
    front = cell["front"]
    short = cell.get("short", 0.0)
    if short:
        z1 -= short
    corners = [paving_warp(x1, z0), paving_warp(x0, z0), paving_warp(x0, z1), paving_warp(x1, z1)]
    # Edge k runs from corner k to k + 1: the far edge, the left, the front, the right.
    edge_kind = ["far" if cell["far"] else "joint", "joint", "front" if front else "joint", "right" if cell["right"] else "joint"]
    cxz = (sum(c[0] for c in corners) / 4, sum(c[1] for c in corners) / 4)
    h = rng.uniform(-0.006, 0.006)
    tx = rng.uniform(-0.004, 0.004)
    tz = rng.uniform(-0.004, 0.004)
    tint = rng.uniform(0.76, 1.0) * (0.94 if cell["row"] == 1 else 1.0)
    inside = V(cxz[0], -1.0, cxz[1])
    thick = LEDGE["slab"]
    joint_y = -0.032
    bevel = 0.02
    nose = 0.022

    def top(x, z, drop=0.0):
        return V(x, h + tx * (x - cxz[0]) + tz * (z - cxz[1]) - drop, z)

    def moss_at(x, z):
        return min(1.0, max(0.0, 0.42 + 1.1 * noise.noise(Vector((x * 0.55 + 2.3, z * 0.55 - 1.1, 0.7)))))

    normals = []
    for k in range(4):
        a = corners[k]
        b = corners[(k + 1) % 4]
        d = Vector((b[0] - a[0], b[1] - a[1])).normalized()
        n = Vector((-d.y, d.x))
        if n.dot(Vector((cxz[0] - a[0], cxz[1] - a[1]))) < 0:
            n = -n
        normals.append((d, n))
    # How far each edge's top line stands in from the cell's own line.
    worn = {"joint": bevel, "far": 0.03, "right": 0.03, "front": nose + 0.012}
    inset = [worn[kind] for kind in edge_kind]
    tops = []
    for k in range(4):
        (_, n_prev) = normals[(k - 1) % 4]
        (_, n_next) = normals[k]
        cx_, cz_ = corners[k]
        tops.append((cx_ + n_prev.x * inset[(k - 1) % 4] + n_next.x * inset[k], cz_ + n_prev.y * inset[(k - 1) % 4] + n_next.y * inset[k]))
    # A corner knocked off here and there (never on the ledge's own edges: those are worn as a whole).
    plain = (tint, 0.0, 1)
    corner_pts = []
    for k in range(4):
        tk = tops[k]
        if edge_kind[(k - 1) % 4] == "joint" and edge_kind[k] == "joint" and rng.random() < 0.2:
            dp, _ = normals[(k - 1) % 4]
            dn, _ = normals[k]
            c0 = rng.uniform(0.05, 0.13)
            c1 = rng.uniform(0.05, 0.13)
            p_prev = top(tk[0] - dp.x * c0, tk[1] - dp.y * c0, 0.004)
            p_next = top(tk[0] + dn.x * c1, tk[1] + dn.y * c1, 0.004)
            corner_pts.append([p_prev, p_next])
            ck = corners[k]
            s.face_out([V(ck[0], joint_y, ck[1]), p_next, p_prev], inside, attrs=[(tint, moss_at(ck[0], ck[1])), (tint, 0.3), (tint, 0.3)])
        else:
            corner_pts.append([top(tk[0], tk[1])])
    outline = []
    attrs = []
    for k in range(4):
        a = corners[k]
        b = corners[(k + 1) % 4]
        d, n = normals[k]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        start = corner_pts[k]
        outline.extend(start)
        attrs.extend([plain] * len(start))
        end_top = corner_pts[(k + 1) % 4][0]
        kind = edge_kind[k]
        if kind == "joint":
            ca = V(a[0], joint_y, a[1])
            cb = V(b[0], joint_y, b[1])
            s.face_out([ca, cb, end_top, start[-1]], inside,
                       attrs=[(tint, moss_at(a[0], a[1])), (tint, moss_at(b[0], b[1])), (tint, 0.0), (tint, 0.0)])
            continue
        # A worn edge: its outline wanders in and out, with a notch or two where a piece has gone.
        m = max(2, int(round(length / 0.26)))
        wear = []
        for j in range(m + 1):
            q = (lerp(a[0], b[0], j / m), lerp(a[1], b[1], j / m))
            wear.append(0.006 + 0.04 * (0.5 + 0.5 * noise.noise(Vector((q[0] * 1.3, q[1] * 1.3, 5.5)))))
        for _ in range(1 if rng.random() < 0.5 else 0):
            j = rng.randrange(1, m) if m > 1 else 0
            wear[j] += rng.uniform(0.05, 0.1)
        pts_top = []
        pts_mid = []
        pts_bot = []
        for j in range(m + 1):
            q = (lerp(a[0], b[0], j / m), lerp(a[1], b[1], j / m))
            w = wear[j]
            if j == 0:
                pt = start[-1]
            elif j == m:
                pt = end_top
            else:
                pt = top(q[0] + n.x * (w + inset[k]), q[1] + n.y * (w + inset[k]))
            pts_top.append(pt)
            mid = top(q[0] + n.x * w, q[1] + n.y * w, 0.02)
            pts_mid.append(mid)
            pts_bot.append(V(q[0] + n.x * (w + 0.008), -thick, q[1] + n.y * (w + 0.008)))
        for j in range(1, m):
            outline.append(pts_top[j])
            attrs.append(plain)
        if kind != "front":
            continue
        for j in range(m):
            s.face_out([pts_top[j], pts_top[j + 1], pts_mid[j + 1], pts_mid[j]], inside, attr=(tint, 0.05, 2))
            s.face_out([pts_mid[j], pts_mid[j + 1], pts_bot[j + 1], pts_bot[j]], inside,
                       attrs=[(tint, 0.05, 2), (tint, 0.05, 2), (tint * 0.9, 0.45, 2), (tint * 0.9, 0.45, 2)])
        # The joints between the lip's slabs show on its face as notches.
        for j, c in ((0, a), (m, b)):
            s.face_out([pts_top[j], pts_mid[j], pts_bot[j], V(c[0], joint_y, c[1])], inside,
                       attrs=[(tint, 0.0, 3), (tint, 0.0, 3), (tint * 0.9, 0.45, 3), (tint, moss_at(c[0], c[1]), 3)])
    s.face_out(outline, inside, attrs=attrs)


def paving_soup(rng):
    s = Soup()
    cells = paving_cells(rng)
    front = [c for c in cells if c["front"]]
    # Two flags of the lip have lost their front: the bed of rock shows where they lay.
    for c in front:
        if c["col"] in (3, 7):
            c["short"] = 0.28 if c["col"] == 3 else 0.2
    for c in cells:
        slab(s, c, rng)
    return s, cells


WALL_COURSES = [0.46, 0.5, 0.48, 0.54]


def bed_soup():
    """The ledge's core under the paving and behind its wall: a closed block of the overlook's
    own rock (its top shows where a flagstone has gone)."""
    L = LEDGE
    return box(L["x0"] + 0.03, L["x1"] - 0.05, L["foot"], -L["slab"], L["z0"] + 0.05, L["z1"] - 0.45)


def wall_soup(rng):
    """The retaining wall under the paving's front lip (the eye's side): courses of large ashlar,
    each block a face proud of its bevelled joints, a little in or out of line with its
    neighbours; one has fallen out. Below the courses the wall runs on plain."""
    L = LEDGE
    s = Soup()
    face = L["z1"] - 0.05
    joint = face - 0.03
    bevel = 0.02
    y = -L["slab"]
    for course, height in enumerate(WALL_COURSES):
        y0, y1 = y - height, y
        x = L["x1"] - 0.05 - (0.0 if course % 2 else 0.55)
        edges = [L["x1"] - 0.05, x] if course % 2 == 0 else [x]
        while edges[-1] > L["x0"] + 0.03 + 1e-6:
            length = rng.uniform(1.6, 2.4) if edges[-1] < -8.4 else rng.uniform(0.85, 1.5)
            nx = edges[-1] - length
            if nx - (L["x0"] + 0.03) < 0.6:
                nx = L["x0"] + 0.03
            edges.append(nx)
        for i in range(len(edges) - 1):
            x1, x0 = edges[i], edges[i + 1]
            gone = course == 1 and i == 3
            proud = -0.3 if gone else rng.uniform(0.0, 0.028)
            tint = rng.uniform(0.82, 1.0)
            z = face + proud
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            inside = V(cx, cy, joint - 2.0)

            def moss_at(px, py):
                return min(1.0, max(0.0, 0.3 + 1.0 * noise.noise(Vector((px * 0.5 + 9.1, py * 0.9 + 3.3, 2.2)))))

            outer = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            inner = [(x0 + bevel, y0 + bevel), (x1 - bevel, y0 + bevel), (x1 - bevel, y1 - bevel), (x0 + bevel, y1 - bevel)]
            s.face_out([V(px, py, z) for px, py in inner], inside, attr=(tint * (0.7 if gone else 1.0), 0.0, 1))
            for j in range(4):
                (ax, ay), (bx, by) = outer[j], outer[(j + 1) % 4]
                (ix, iy), (jx, jy) = inner[j], inner[(j + 1) % 4]
                quad = [V(ax, ay, joint), V(bx, by, joint), V(jx, jy, z), V(ix, iy, z)]
                attrs = [(tint, moss_at(ax, ay)), (tint, moss_at(bx, by)), (tint, 0.0), (tint, 0.0)]
                if gone:
                    # (A hole's walls look in toward its middle.)
                    s.face_out(quad, V(cx, cy, (joint + z) / 2), attrs=attrs, toward=True)
                else:
                    s.face_out(quad, inside, attrs=attrs)
            if course == 0:
                # The wall's head, where the paving's lip has broken back from it.
                s.face_out([V(x0, y1, joint), V(x1, y1, joint), V(x1, y1, joint - 0.22), V(x0, y1, joint - 0.22)], V(cx, y1 - 1.0, joint),
                           attr=(tint, 0.25, 4))
        y = y0
    # Below the courses the wall runs on down out of sight.
    s.face_out([V(L["x0"] + 0.03, L["foot"], joint), V(L["x1"] - 0.05, L["foot"], joint), V(L["x1"] - 0.05, y, joint), V(L["x0"] + 0.03, y, joint)],
               V(0.0, -1.0, joint - 2.0), attr=(0.8, 0.0, 5))
    return s


# ── The ivy ──

LEAF = {
    # A leaf in its own frame (across, toward its tip, along its normal), a unit long: folded a
    # little along its midrib, its tip drooping.
    "points": [(0.0, 0.0, 0.0), (-0.5, 0.22, 0.09), (-0.3, 0.68, 0.05), (0.0, 1.0, -0.1), (0.3, 0.68, 0.05), (0.5, 0.22, 0.09)],
    "index": [0, 5, 4, 0, 4, 3, 0, 3, 2, 0, 2, 1],
    # How far a leaf's shading normal leans up to the sky, and its halves away from the midrib.
    "lift": 1.0,
    "cup": 0.3,
}


def leaf_frame(n):
    """The two axes a leaf's bearing is measured in, from its normal alone (the theme's own rule)."""
    n = Vector(n).normalized()
    ref = Vector((0.0, 1.0, 0.0)) if abs(n.y) < 0.95 else Vector((1.0, 0.0, 0.0))
    a = n.cross(ref).normalized()
    b = n.cross(a)
    return a, b


def grow_ivy(rng, bvh, cells):
    """Ivy on the newel and along the rail: stems that cling to the stone (each point drawn onto
    it) or hang free, shoots off them, and a leaf every few centimetres; weeds in the paving's
    joints (`cells`: its flags) and the leaves the ivy has dropped. Returns (stems, leaves): stems
    [[(point, radius)]], leaves [(point, normal, tip, length)]."""
    eye = Vector(EYE["pos"])
    stems = []
    walks = []

    def cling(p, reach=0.13):
        hit = bvh.find_nearest(Vector(p), reach)
        if hit[0] is None:
            return None
        return hit[0], hit[1]

    def trace(points, hang=1.0, r0=0.014, r1=0.005, wiggle=0.022, leaf=(0.125, 0.07), out=None):
        """A stem through `points`; past the share `hang` of its length it hangs free."""
        pts = catmull(points, 0.04)
        seed = rng.uniform(0, 100)
        walk = []
        normal = Vector((0.0, 0.0, 1.0))
        for i, p in enumerate(pts):
            u = i / max(1, len(pts) - 1)
            hanging = u > hang
            w = Vector((noise.noise(Vector((seed, u * 8.0, 0.0))), noise.noise(Vector((seed + 9.1, u * 8.0, 3.3))),
                        noise.noise(Vector((seed + 4.7, u * 8.0, 7.1))))) * wiggle
            q = p + w
            if not hanging:
                hit = cling(q)
                if hit:
                    q = hit[0] + hit[1] * 0.012
                    normal = hit[1]
            else:
                normal = (out if out is not None else Vector((0.0, 0.12, 1.0))).normalized()
            walk.append({"p": q, "n": Vector(normal), "r": lerp(r0, r1, u), "u": u, "hanging": hanging, "leaf": lerp(leaf[0], leaf[1], u ** 1.4)})
        walks.append(walk)
        if r0 >= 0.012:
            stems.append([(w["p"], w["r"]) for w in walk[::4]] + ([(walk[-1]["p"], walk[-1]["r"])] if (len(walk) - 1) % 4 else []))
        return walk

    def shoot(start, length, climb):
        """A side shoot from a stem's point: it wanders over the stone, and hangs where the stone ends."""
        p = Vector(start["p"])
        n = Vector(start["n"])
        d = Vector((rng.uniform(-1, 1), rng.uniform(-0.3, 1.0) * climb, rng.uniform(-1, 1)))
        d = (d - n * d.dot(n))
        if d.length < 1e-3:
            return
        d.normalize()
        walk = []
        steps = int(length / 0.04)
        hanging = start["hanging"]
        for i in range(steps):
            p = p + d * 0.04
            if not hanging:
                hit = cling(p, 0.07)
                if hit:
                    p = hit[0] + hit[1] * 0.012
                    n = hit[1]
                    d = (d - n * d.dot(n))
                    d = (d + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)))).normalized()
                else:
                    hanging = True
            if hanging:
                d = (d * 0.6 + Vector((0.0, -0.5, 0.0)) + Vector((rng.uniform(-0.1, 0.1), 0.0, rng.uniform(-0.1, 0.1)))).normalized()
            u = i / max(1, steps - 1)
            walk.append({"p": Vector(p), "n": Vector(n), "r": 0.004, "u": u, "hanging": hanging, "leaf": lerp(0.098, 0.055, u)})
        walks.append(walk)

    px = PIER_X
    front = 0.31
    # The trunk: out of a joint of the paving at the newel's foot, up its eye-side face to the cap,
    # over it, and away along the handrail; where it ends it hangs down in front of the balusters.
    a = trace([(px - 0.3, 0.0, 0.47), (px - 0.25, 0.14, 0.43), (px - 0.2, 0.24, 0.4), (px - 0.16, 0.36, front), (px - 0.12, 0.6, front),
               (px - 0.22, 0.86, front), (px - 0.14, 1.04, front), (px - 0.2, 1.15, 0.35), (px - 0.24, 1.22, 0.39), (px - 0.27, 1.28, 0.35),
               (px - 0.33, 1.305, 0.2), (px - 0.5, 1.31, 0.1), (px - 0.85, 1.31, 0.12), (px - 1.25, 1.31, 0.03), (px - 1.7, 1.31, 0.13),
               (px - 2.05, 1.3, 0.18), (px - 2.2, 1.24, 0.24), (px - 2.24, 1.05, 0.27), (px - 2.26, 0.86, 0.28)],
              hang=0.9, r0=0.02, r1=0.006)
    # A second stem from the same root up the newel's corner and onto its cap, to the finial's foot.
    b = trace([(px - 0.3, 0.0, 0.47), (px - 0.33, 0.2, 0.42), (px - 0.31, 0.5, 0.31), (px - 0.3, 0.9, 0.3), (px - 0.36, 1.18, 0.37),
               (px - 0.3, 1.29, 0.33), (px - 0.16, 1.31, 0.22), (px - 0.1, 1.35, 0.17), (px - 0.02, 1.37, 0.13), (px + 0.03, 1.44, 0.12),
               (px + 0.0, 1.52, 0.14)], r0=0.015, r1=0.005)
    # Along the cap's eye-side edge and off its far corner, hanging.
    c = trace([(px - 0.2, 1.27, 0.385), (px + 0.0, 1.26, 0.385), (px + 0.2, 1.25, 0.385), (px + 0.36, 1.23, 0.39), (px + 0.4, 1.05, 0.42),
               (px + 0.41, 0.88, 0.43), (px + 0.4, 0.74, 0.43)], hang=0.55, r0=0.008, r1=0.004, out=Vector((0.3, 0.1, 1.0)))
    for x, drop in ((px - 0.3, 0.3), (px - 0.12, 0.44), (px + 0.08, 0.26)):
        trace([(x, 1.29, 0.33), (x, 1.26, 0.39), (x + 0.01, 1.2, 0.4), (x + 0.02, 1.2 - drop * 0.5, 0.36), (x + 0.02, 1.2 - drop, 0.345)],
              hang=0.35, r0=0.006, r1=0.003, leaf=(0.1, 0.06))
    # Tendrils let down from the handrail in front of the balusters.
    hangs = [(px - 0.44, 0.34), (px - 0.62, 0.5), (px - 0.82, 0.3), (px - 1.02, 0.62), (px - 1.28, 0.26), (px - 1.5, 0.4), (px - 1.86, 0.5)]
    for x, drop in hangs:
        sway = rng.uniform(-0.05, 0.05)
        trace([(x, 1.31, 0.1), (x + 0.01, 1.3, 0.2), (x + 0.02, 1.25, 0.245), (x + 0.02 + sway * 0.5, 1.25 - drop * 0.5, 0.27),
               (x + 0.02 + sway, 1.25 - drop, 0.275)], hang=0.3, r0=0.006, r1=0.003, leaf=(0.1, 0.06))
    # Creeping along the foot of the balustrade from the root.
    trace([(px - 0.34, 0.02, 0.46), (px - 0.5, 0.04, 0.3), (px - 0.7, 0.14, 0.215), (px - 1.0, 0.16, 0.19), (px - 1.35, 0.16, 0.2),
           (px - 1.6, 0.16, 0.12)], r0=0.008, r1=0.004, leaf=(0.09, 0.06))
    # Farther along, a second plant has come over the rail from the cliff's side.
    fx = -4.55
    d = trace([(fx - 0.1, 0.95, -0.27), (fx - 0.06, 1.15, -0.25), (fx - 0.03, 1.27, -0.2), (fx, 1.31, -0.05), (fx + 0.12, 1.31, 0.1),
               (fx + 0.45, 1.31, 0.14), (fx + 0.8, 1.31, 0.05), (fx + 1.05, 1.3, 0.19), (fx + 1.1, 1.2, 0.25), (fx + 1.12, 0.98, 0.27)],
              hang=0.88, r0=0.012, r1=0.004)
    trace([(fx, 1.31, -0.05), (fx - 0.3, 1.31, 0.08), (fx - 0.62, 1.31, 0.12), (fx - 0.8, 1.29, 0.2), (fx - 0.84, 1.18, 0.25),
           (fx - 0.86, 0.9, 0.27)], hang=0.7, r0=0.008, r1=0.004)
    trace([(fx + 0.3, 1.31, 0.12), (fx + 0.31, 1.29, 0.21), (fx + 0.32, 1.22, 0.25), (fx + 0.33, 0.85, 0.27)], hang=0.3, r0=0.006, r1=0.003,
          leaf=(0.09, 0.055))
    # Shoots off every stem that is thick enough to bear them.
    for walk in [a, b, c, d]:
        gap = 0
        for w in walk:
            gap += 1
            # (None off a stem's last reach: a shoot from the finial's foot would crown the ball.)
            if gap >= 4 and w["u"] < 0.85 and rng.random() < 0.45:
                gap = 0
                shoot(w, rng.uniform(0.14, 0.42), 1.0 if w["n"].y < 0.5 else 0.2)

    leaves = []

    def leaf_at(p, n, hanging, size, along=None, side=1.0, upright=False):
        n = (Vector(n) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.32).normalized()
        to_eye = (eye - p).normalized()
        # A leaf shows one face (the stone's material is single-sided): it is turned to the eye's side.
        if n.dot(to_eye) < 0.12:
            n = (n + to_eye * (0.3 - n.dot(to_eye))).normalized()
        down = Vector((0.0, 1.0 if upright else -1.0, 0.0))
        if hanging or upright or n.y < 0.7:
            tip = down - n * down.dot(n)
        else:
            tip = (along if along is not None else Vector((1.0, 0.0, 0.0))) * rng.uniform(-0.3, 0.8) + n.cross(along if along is not None else Vector((1.0, 0.0, 0.0))) * side
            tip = tip - n * tip.dot(n)
        if tip.length < 1e-4:
            tip = Vector((1.0, 0.0, 0.0)) - n * n.x
        tip.normalize()
        tip = Matrix.Rotation(math.radians(rng.uniform(-40, 40)), 3, n) @ tip
        leaves.append((Vector(p), n, tip, size * rng.uniform(0.85, 1.15)))

    for walk in walks:
        side = 1.0
        since = 0.0
        gap = rng.uniform(0.04, 0.06)
        for i in range(1, len(walk)):
            w = walk[i]
            step = (w["p"] - walk[i - 1]["p"])
            since += step.length
            if since < gap:
                continue
            since = 0.0
            gap = rng.uniform(0.038, 0.062)
            t = step.normalized() if step.length > 1e-6 else Vector((1.0, 0.0, 0.0))
            across = w["n"].cross(t)
            p = w["p"] + across * side * rng.uniform(0.015, 0.05) + w["n"] * 0.008
            leaf_at(p, w["n"], w["hanging"], w["leaf"], t, side)
            side = -side
    # Where the plant is thickest it has closed over the stone: leaves strewn on it in drifts.
    drifts = [((px - 0.3, 1.24, 0.37), 0.22, 40), ((px - 0.62, 1.3, 0.12), 0.26, 30), ((px - 0.22, 0.2, 0.42), 0.22, 22),
              ((px - 1.25, 1.31, 0.08), 0.24, 22), ((px - 1.95, 1.3, 0.16), 0.2, 16), ((px - 0.2, 0.75, 0.3), 0.24, 26),
              ((px - 0.26, 1.02, 0.31), 0.2, 20), ((px - 0.05, 1.3, 0.3), 0.2, 16),
              ((fx + 0.1, 1.3, 0.05), 0.28, 26), ((fx + 0.75, 1.31, 0.1), 0.2, 12)]
    for centre, radius, count in drifts:
        for _ in range(count):
            q = Vector(centre) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * radius
            hit = cling(q, radius)
            if hit:
                leaf_at(hit[0] + hit[1] * 0.012, hit[1], False, rng.uniform(0.08, 0.125))
    # Weeds have taken the joints where four flags meet: a few small blades standing in each.
    corners = sorted({(round(c["x0"], 3), round(c["z0"], 3)) for c in cells if 0.3 < c["z0"] < 5.5 and -7.6 < c["x0"] < 1.2})
    for x, z in rng.sample(corners, min(18, len(corners))):
        x, z = paving_warp(x, z)
        for _ in range(rng.randint(3, 5)):
            a = rng.uniform(0, 2 * math.pi)
            lean = Vector((math.cos(a), rng.uniform(0.25, 0.7), math.sin(a) + 0.5))
            leaf_at(Vector((x + rng.uniform(-0.02, 0.02), -0.02, z + rng.uniform(-0.02, 0.02))), lean, False, rng.uniform(0.06, 0.1), upright=True)
    # And the ivy's dropped leaves lie about the newel's foot.
    for _ in range(14):
        p = Vector((px + rng.uniform(-2.3, 0.9), 0.012, rng.uniform(0.5, 1.7)))
        a = rng.uniform(0, 2 * math.pi)
        leaf_at(p, Vector((0.0, 1.0, 0.0)), False, rng.uniform(0.07, 0.1), Vector((math.cos(a), 0.0, math.sin(a))))
    rng.shuffle(leaves)
    return stems, leaves


def leaf_world(leaf):
    """A leaf's six points and their shading normals in the balustrade's space (as the theme grows it)."""
    p, n, tip, size = leaf
    across = tip.cross(n)
    pts = [p + (across * u + tip * v + n * w) * size for u, v, w in LEAF["points"]]
    up = Vector((0.0, LEAF["lift"], 0.0))
    nrm = [(n + up + across * (LEAF["cup"] * (1 if u > 0 else -1 if u < 0 else 0))).normalized() for u, v, w in LEAF["points"]]
    return pts, nrm


def ivy_groups(stems, leaves, leaf_ao):
    """The ivy as triangles (for the previews; the theme grows the same from the module's rows)."""
    pos = []
    nrm = []
    tri = []
    ao = []
    for k, leaf in enumerate(leaves):
        pts, ns = leaf_world(leaf)
        base = len(pos)
        pos.extend(tuple(q) for q in pts)
        nrm.extend(tuple(q) for q in ns)
        ao.extend([leaf_ao[k]] * 6)
        idx = LEAF["index"]
        tri.extend((base + idx[i], base + idx[i + 1], base + idx[i + 2]) for i in range(0, len(idx), 3))
    g = Group(MAT["leaf"], pos, nrm, tri)
    g.ao = np.array(ao)
    s = Soup()
    for stem in stems:
        s.merge(tube([p for p, _ in stem], [r for _, r in stem], 3))
    bark = group_of(MAT["iron"], s, angle=80.0)
    bark.ao[:] = 0.7
    return [bark, g]


def build_balustrade(scene, preview_dir):
    rng = random.Random(7)
    rail = group_of(MAT["masonry"], chipped(scene, profile_run(RAIL_HALF, RAIL_X0, RAIL_X1), RAIL_CHIPS, rng))
    course = group_of(MAT["masonry"], chipped(scene, profile_run(COURSE_HALF, RAIL_X0, RAIL_X1), COURSE_CHIPS, rng))
    pier = group_of(MAT["masonry"], chipped(scene, pier_soup(), PIER_CHIPS, rng))
    finial = group_of(MAT["masonry"], lathe(FINIAL, 12, cx=PIER_X, pole_top=True, cap_bottom=True), angle=40.0)
    balusters = [group_of(MAT["masonry"], baluster_soup(0), angle=50.0), group_of(MAT["masonry"], baluster_soup(1), angle=40.0)]
    paving_s, cells = paving_soup(random.Random(17))
    paving = group_of(MAT["travertine"], paving_s, angle=50.0)
    bed = group_of(MAT["travertine"], bed_soup())
    wall = group_of(MAT["masonry"], wall_soup(random.Random(27)), angle=50.0)
    named = {"rail": rail, "course": course, "pier": pier, "finial": finial, "baluster0": balusters[0], "baluster1": balusters[1],
             "paving": paving, "bed": bed, "wall": wall}
    for label, g in named.items():
        pieces = face_outward(g, label)
        closed = [p for p in pieces if p[0]]
        log(f"  {label}: {len(g.tri)} triangles, {len(g.pos)} vertices, {len(pieces)} piece(s), {len(closed)} closed")
        assert all(p[2] > 0 for p in closed)
    for label in ("rail", "course", "pier", "finial", "bed"):
        assert any(p[0] for p in closed_pieces(named[label].pos, named[label].tri)), f"{label} is not a closed solid"
    # Paving faces the sky (a lid is an open piece: nothing else says which way it is wound).
    fn = face_normals(paving.pos, paving.tri)
    log(f"  paving: its faces' normals reach down to y = {fn[:, 1].min():.2f}")
    assert (fn[:, 1] > -0.5).all(), "a flagstone's face looks down"

    # Everything in its place, for the occlusion.
    mirror = (PIER_X + FAR_PIER_X) / 2
    placed = [rail, course, pier, finial, pier.mirrored_x(mirror), finial.mirrored_x(mirror), paving, bed, wall]
    placed += [balusters[1].moved(dx=BALUSTER_X0 - i * PITCH) for i in range(BALUSTERS)]
    bvh = tree_of(placed)

    def occlusion(g, seed):
        return 0.3 + 0.7 * bake_ao(g, bvh, samples=96, reach=0.9, bias=0.004, seed=seed)

    for k, g in enumerate((rail, course, pier, finial, paving, bed, wall)):
        g.ao = occlusion(g, 40 + k)
    for k, g in enumerate(balusters):
        g.ao = occlusion(g.moved(dx=BALUSTER_X0 - 7 * PITCH), 50 + k)

    stems, leaves = grow_ivy(random.Random(37), bvh, cells)
    # A leaf's occlusion: what the stone hides of its sky, and a little of its own chance.
    probe = Group(MAT["leaf"], [tuple(p + n * 0.02) for p, n, _, _ in leaves], [tuple(n) for _, n, _, _ in leaves], np.zeros((0, 3), dtype=np.int64))
    shade = bake_ao(probe, bvh, samples=32, reach=0.5, bias=0.0, seed=60)
    lrng = random.Random(61)
    leaf_ao = [min(1.0, max(0.0, (0.55 + 0.45 * shade[k]) * lrng.uniform(0.8, 1.0))) for k in range(len(leaves))]
    log(f"  ivy: {len(leaves)} leaves, {len(stems)} stems of {sum(len(s) for s in stems)} points")

    quant = 0.00036
    rows = bytearray()
    for k, (p, n, tip, size) in enumerate(leaves):
        q = [int(round(c / quant)) for c in p]
        nq = [int(max(-127, min(127, round(c * 127)))) for c in n]
        a, b = leaf_frame(Vector(nq))
        bearing = int(round(math.atan2(tip.dot(b), tip.dot(a)) / (2 * math.pi) * 256)) % 256
        rows += np.array(q, dtype="<i2").tobytes() + np.array(nq, dtype="i1").tobytes()
        rows += bytes([bearing, int(max(1, min(255, round(size * 1000)))), int(round(leaf_ao[k] * 255))])
    stem_rows = []
    for stem in stems:
        for p, r in stem:
            stem_rows.append([int(round(c / quant)) for c in p] + [max(1, int(round(r / quant)))])
        stem_rows.append([0, 0, 0, 0])
    out = {
        "quant": quant,
        "layout": {"pitch": PITCH, "balusters": BALUSTERS, "balusterX0": BALUSTER_X0, "pierX": PIER_X, "farPierX": FAR_PIER_X,
                   "railTop": Y_RAIL_TOP, "top": TOP},
        "rail": packed([rail, course], quant),
        "pier": packed([pier, finial], quant),
        "baluster": [packed([g], quant) for g in balusters],
        "paving": packed([paving], quant, moss=True),
        "ledge": packed([bed, wall], quant, moss=True),
        "ivy": {
            "leafCount": len(leaves),
            "leafShape": {"points": [list(p) for p in LEAF["points"]], "index": LEAF["index"], "lift": LEAF["lift"], "cup": LEAF["cup"]},
            "leaves": base64.b64encode(bytes(rows)).decode("ascii"),
            "stems": b64(np.array(stem_rows, dtype="<i2")),
        },
    }
    ivy = ivy_groups(stems, leaves, leaf_ao)
    if preview_dir:
        preview_balustrade(scene, placed, ivy, preview_dir)
    return out, placed + ivy


def preview_balustrade(scene, placed, ivy, out_dir):
    clear_previews(scene)
    preview_object(scene, "balustrade", placed)
    preview_object(scene, "ivy", ivy)
    cam = camera_of(scene)
    cam.data.type = "PERSP"
    cam.data.sensor_fit = "VERTICAL"
    cam.data.clip_start = 0.5
    cam.data.clip_end = 400.0
    f = Vector(EYE["forward"]).normalized()
    up = Vector(EYE["up"])
    # The game's own frame at rest: the balustrade is its bottom-left corner.
    cam.data.angle_y = math.radians(EYE["vfov"])
    aim(cam, EYE["pos"], f, up)
    render(scene, Path(out_dir) / "balustrade-game.png", 1600, 900)
    # The icon lens' close-up (the camera turned 0.72 left, 0.42 down, a 34 degree lens).
    game = cam.matrix_world.copy()
    cam.matrix_world = game @ Matrix.Rotation(0.72, 4, "Y") @ Matrix.Rotation(-0.42, 4, "X")
    cam.data.angle_y = math.radians(34)
    render(scene, Path(out_dir) / "balustrade-lens.png", 1200, 800)
    render(scene, Path(out_dir) / "balustrade-lens-ao.png", 1200, 800, flat=True)
    # The newel and its ivy from close by, on the eye's line; the far colony; the lip.
    cam.data.angle_y = math.radians(13)
    target = Vector((PIER_X - 0.8, 0.75, 0.0))
    eye = Vector(EYE["pos"])
    aim(cam, tuple(eye), (target - eye).normalized(), (0, 1, 0))
    render(scene, Path(out_dir) / "balustrade-newel.png", 1400, 900)
    render(scene, Path(out_dir) / "balustrade-newel-ao.png", 1400, 900, flat=True)
    target = Vector((-4.3, 0.75, 0.0))
    aim(cam, tuple(eye), (target - eye).normalized(), (0, 1, 0))
    render(scene, Path(out_dir) / "balustrade-far.png", 1400, 900)
    cam.data.angle_y = math.radians(22)
    target = Vector((-1.5, -0.6, 5.6))
    aim(cam, tuple(eye), (target - eye).normalized(), (0, 1, 0))
    render(scene, Path(out_dir) / "balustrade-lip.png", 1400, 900)
    # Square on, from the eye's side and from above.
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 4.4
    aim(cam, (PIER_X - 1.3, 0.75, 30), (0, 0, -1), (0, 1, 0))
    render(scene, Path(out_dir) / "balustrade-elevation.png", 1600, 800)
    cam.data.ortho_scale = 14.5
    aim(cam, (-4.75, 30, 2.4), (0, -1, 0), (0, 0, -1))
    render(scene, Path(out_dir) / "balustrade-plan.png", 1600, 1000)


# ───────────────────────────── previews ─────────────────────────────

TINT = {MAT["travertine"]: (0.78, 0.72, 0.6), MAT["iron"]: (0.2, 0.15, 0.11), MAT["masonry"]: (0.56, 0.54, 0.5), MAT["leaf"]: (0.1, 0.24, 0.08)}
UPRIGHT = Matrix.Rotation(math.radians(90), 4, "X")


def preview_object(scene, name, groups, offset=(0.0, 0.0, 0.0), shade=True):
    """Groups as one object carrying the shipped normals and (colour x occlusion) per vertex."""
    pos = []
    nrm = []
    col = []
    tri = []
    for g in groups:
        base = len(pos)
        pos.extend((p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]) for p in g.pos)
        nrm.extend(tuple(n) for n in g.nrm)
        c = TINT.get(g.mat, (0.5, 0.5, 0.5))
        for i in range(len(g.pos)):
            k = (0.25 + 0.75 * g.ao[i]) * g.tint[i] if shade else 1.0
            m = g.moss[i]
            col.append((lerp(c[0], 0.2, m * 0.6) * k, lerp(c[1], 0.32, m * 0.6) * k, lerp(c[2], 0.1, m * 0.6) * k, 1.0))
        tri.extend((int(a) + base, int(b) + base, int(c2) + base) for a, b, c2 in g.tri)
    me = bpy.data.meshes.new(name)
    me.from_pydata(pos, [], tri)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = True
    attr = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    attr.data.foreach_set("color", [x for c in col for x in c])
    me.color_attributes.active_color = attr
    me.normals_split_custom_set_from_vertices(nrm)
    ob = bpy.data.objects.new(name, me)
    ob.matrix_world = UPRIGHT
    scene.collection.objects.link(ob)
    return ob


def camera_of(scene):
    cam = scene.camera
    if cam is None:
        data = bpy.data.cameras.new("rt-camera")
        cam = bpy.data.objects.new("rt-camera", data)
        scene.collection.objects.link(cam)
        scene.camera = cam
    return cam


def aim(cam, eye, forward, up):
    """Pose the camera from the game's own vectors."""
    f = Vector(forward).normalized()
    r = f.cross(Vector(up)).normalized()
    u = r.cross(f)
    m = Matrix(((r.x, u.x, -f.x, eye[0]), (r.y, u.y, -f.y, eye[1]), (r.z, u.z, -f.z, eye[2]), (0, 0, 0, 1)))
    cam.matrix_world = UPRIGHT @ m


def render(scene, path, width, height, sky=(0.36, 0.5, 0.72), flat=False):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light = "FLAT" if flat else "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_shadows = False
    shading.show_cavity = False
    shading.show_specular_highlight = False
    scene.display.render_aa = "8"
    world = scene.world or bpy.data.worlds.new("rt-sky")
    world.color = sky
    scene.world = world
    bpy.ops.render.render(write_still=True, scene=scene.name)


def upscaled(path, out, factor):
    """A render repeated `factor` times each way (nearest), to judge a game-size picture."""
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    big = np.repeat(np.repeat(px, factor, axis=0), factor, axis=1)
    res = bpy.data.images.new("upscaled", w * factor, h * factor, alpha=True)
    res.pixels = big.ravel().tolist()
    res.filepath_raw = str(out)
    res.file_format = "PNG"
    res.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(res)


def clear_previews(scene):
    for ob in [o for o in scene.collection.objects if o.type == "MESH"]:
        discard(ob)


def preview_trees(scene, trees, out_dir):
    clear_previews(scene)
    cam = camera_of(scene)
    cam.data.type = "ORTHO"
    row = []
    for kind in ("cypress", "pine", "shrub"):
        for variant in trees.get(kind, []):
            row.append((kind, variant))
    # The three levels of every tree, a column each, seen from the front and from a quarter.
    x = 0.0
    for kind, levels in row:
        width = {"cypress": 1.4, "pine": 3.0, "shrub": 2.6}[kind]
        for level, groups in enumerate(levels):
            preview_object(scene, f"{kind}-{level}", groups, offset=(x + width / 2, -level * 4.6, 0.0))
        x += width
    total = x
    for name, forward, up in (("front", (0, 0, -1), (0, 1, 0)), ("quarter", (-0.6, -0.25, -0.76), (0, 1, 0)), ("under", (0, 0.5, -0.86), (0, 1, 0))):
        cam.data.ortho_scale = max(total, 14.2 * 1.6) * 1.02
        f = Vector(forward).normalized()
        centre = Vector((total / 2, -4.6 + 2.0, 0.0))
        aim(cam, tuple(centre - f * 40), forward, up)
        render(scene, Path(out_dir) / f"trees-{name}.png", 1800, 1125)
        if name == "front":
            render(scene, Path(out_dir) / "trees-front-ao.png", 1800, 1125, flat=True)
    # At the size the game draws them (a tree fifty pixels tall), eight times enlarged.
    cam.data.ortho_scale = total * 1.02
    for level in (0, 1, 2):
        aim(cam, (total / 2, 1.9 - level * 4.6, 40), (0, 0, -1), (0, 1, 0))
        small = Path(out_dir) / f"trees-game-size-{level}.png"
        render(scene, small, int(total * 13), int(total * 13 * 0.38))
        upscaled(small, Path(out_dir) / f"trees-game-size-{level}-x8.png", 8)


# ───────────────────────────── the module ─────────────────────────────

def b64(a):
    return base64.b64encode(a.tobytes()).decode("ascii")


def packed(groups, quant, moss=False):
    """Groups as one model: quantised positions, normals, occlusion, triangles, and its kinds."""
    pos = np.concatenate([g.pos for g in groups])
    nrm = np.concatenate([g.nrm for g in groups])
    ao = np.concatenate([np.clip(g.ao * g.tint, 0.0, 1.0) for g in groups])
    tri = []
    kinds = []
    base = 0
    for g in groups:
        tri.append(g.tri + base)
        kinds.append((g.mat, base, len(g.pos)))
        base += len(g.pos)
    tri = np.concatenate(tri)
    assert len(pos) < 65536
    q = np.round(pos / quant)
    assert np.abs(q).max() < 32767, "a model reaches past its quantisation"
    out = {
        "vertexCount": int(len(pos)),
        "triangleCount": int(len(tri)),
        "kinds": [[int(m), int(b), int(n)] for m, b, n in kinds],
        "positions": b64(q.astype("<i2")),
        "normals": b64(np.clip(np.round(nrm * 127), -127, 127).astype("i1")),
        "ao": b64(np.clip(np.round(ao * 255), 0, 255).astype("u1")),
        "index": b64(tri.astype("<u2")),
    }
    if moss:
        out["moss"] = b64(np.clip(np.round(np.concatenate([g.moss for g in groups]) * 255), 0, 255).astype("u1"))
    return out


def js(value, indent=1):
    """A Python value as JavaScript source (strings single-quoted, keys bare)."""
    pad = "    " * indent
    if isinstance(value, dict):
        rows = [f"{pad}{k}: {js(v, indent + 1)}," for k, v in value.items()]
        return "{\n" + "\n".join(rows) + "\n" + "    " * (indent - 1) + "}"
    if isinstance(value, (list, tuple)):
        if all(not isinstance(v, (dict, list, tuple)) for v in value) or all(isinstance(v, (list, tuple)) and len(v) <= 4 and all(not isinstance(w, (dict, list, tuple)) for w in v) for v in value):
            return "[" + ", ".join(js(v, indent + 1) for v in value) + "]"
        rows = [f"{pad}{js(v, indent + 1)}," for v in value]
        return "[\n" + "\n".join(rows) + "\n" + "    " * (indent - 1) + "]"
    if isinstance(value, str):
        return "'" + value + "'"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(round(value, 6))
    return repr(value)


HEADER = """/* eslint-disable */
/**
 * Rainbow Terraces' overlook balustrade and grove trees: GENERATED by
 * scripts/blender/rainbow_terraces_models.py (do not edit by hand; re-bake with Blender).
 *
 * Built by script in Blender and written out as numbers (the theme loads nothing from disk).
 * Space: x to the frame's right, y up, z toward the eye. A model's `positions` are Int16 xyz in
 * units of its own `quant`; `normals` Int8 xyz (x127); `ao` Uint8 (ambient occlusion, 255 in the
 * open); `moss` Uint8 (the moss weight, where a model has one); `index` Uint16 triangles, wound
 * counter-clockwise seen from outside; `kinds` rows of [stone kind, first vertex, vertices] (the
 * kinds are rainbow-terraces-isles.js's MAT). The balustrade is in metres, the top of its paving
 * at y = 0; a tree is in sizes (scaled by its spot's), its foot at the origin, levels finest first.
 * The ivy is places, not triangles: `leaves` rows of 12 bytes (Int16 xyz in units of `quant`, the
 * leaf's normal as Int8 xyz, its tip's bearing round that normal as a Uint8 turn, its length in
 * millimetres as a Uint8, its occlusion as a Uint8), in an order any prefix of which is an even
 * thinning, each grown as `leafShape` (points across, toward the tip, along the normal; a unit
 * long); `stems` Int16 rows of [x, y, z, radius] in units of `quant`, each stem ended by a row of
 * zeros.
 */
"""


def write_module(path, balustrade, trees):
    body = {}
    if balustrade is not None:
        body["balustrade"] = balustrade
    if trees is not None:
        quant = 1.0 / 8000.0
        out = {"quant": quant}
        for kind, variants in trees.items():
            out[kind] = [[packed(groups, quant) for groups in levels] for levels in variants]
        body["trees"] = out
    text = HEADER + "export const RAINBOW_TERRACES_MODELS = Object.freeze(" + js(body) + ");\n"
    Path(path).write_text(text, encoding="utf-8", newline="\n")
    log(f"wrote {path}: {len(text) / 1024:.1f} KiB")


# ───────────────────────────── main ─────────────────────────────

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

    def arg(name, default=None):
        return argv[argv.index(name) + 1] if name in argv else default

    out_dir = arg("--out")
    preview_dir = arg("--preview")
    blend = arg("--blend")
    only = (arg("--only") or "trees,balustrade").split(",")
    t0 = time.time()
    scene = scene_of()
    if preview_dir:
        Path(preview_dir).mkdir(parents=True, exist_ok=True)
    trees = None
    balustrade = None
    stone = None
    if "trees" in only:
        log("trees")
        trees = build_trees(scene)
        if preview_dir:
            preview_trees(scene, trees, preview_dir)
    if "balustrade" in only:
        log("balustrade")
        balustrade, stone = build_balustrade(scene, preview_dir)
    if out_dir:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        write_module(Path(out_dir) / MODULE, balustrade, trees)
    if blend:
        # The scene as a file to look round in: the balustrade in its place, the trees in a row
        # behind it (every kind and shape at its finest level, at a size of one).
        clear_previews(scene)
        if stone is not None:
            preview_object(scene, "balustrade", stone)
        x = -6.0
        for kind, variants in (trees or {}).items():
            for variant, levels in enumerate(variants):
                preview_object(scene, f"{kind}-{variant}", levels[0], offset=(x, 0.0, -6.0))
                x += 2.8
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
        log(f"saved {blend}")
    log(f"done in {time.time() - t0:.1f} s")


main()
