"""Grainfields - the ruin on the knoll, authored in Blender.

The old stone castle on its knoll in the vale (PLACES.fort in src/themes/grainfields/grainfields-core.js),
seen from the barley 1.4 km away against Lapporten's gate, a degree or two over the field's crest.
At that distance a metre is about a pixel, so only its outline, its openings and the light on its
faces read: it is designed as a skyline. From the left: a round tower split open, its top broken
off on a slant; the gatehouse where the path arrives (two round fronts and an arch); behind them
the keep, turned three-quarters to the fields, its stair turret the highest point, its walls
broken off in steps and two tiers of tall windows the sky shows through; a broken square tower at
the right corner. A curtain wall runs round the crown, breached, with rubble heaps at the breaches.

Everything is closed solids (extruded outlines, hollow cylinders) cut with Blender's boolean, then
baked per face: how much sky it sees (ambient occlusion) and the mean open direction (the bent
normal), which the theme uses to keep the sun out of the keep's inside and the gate's passage.

Frames: modelled in Blender's (x right as seen from the fields, y away from them, z up) with the
knoll's crown at z = 0; written as glTF (x right, y up, z toward the fields).
"""

import math
import time

import numpy as np

TAG = "[grainfields ruin]"
PREFIX = "SGRAIN_ruin_"
SEED = 0x6A57
FOUNDATION = -4.0     # every solid runs this far under the crown (the drawn land is coarse there)
COURSE = 0.5          # broken tops step in masonry courses
ARC_STEPS = 6

# Roles (the colour attribute's alpha): dressed walls and towers, rubble and fallen blocks.
WALL, RUBBLE = 1.0, 0.0

# Where the eye stands, in the ruin's own frame (Blender axes, metres): the theme stands the ruin at
# PLACES.fort turned RUIN_YAW about the vertical, on the crown's height; the eye is 1.45 m over the
# field at the world's origin. Used by the previews and to check what the eye sees.
RUIN_YAW = 0.35
FORT_XZ = (-410.0, -1350.0)
CROWN_Y = 52.0
EYE_Y = 11.95


def eye_in_ruin_frame():
    dx, dz = -FORT_XZ[0], -FORT_XZ[1]
    c, s = math.cos(RUIN_YAW), math.sin(RUIN_YAW)
    lx = dx * c - dz * s
    lz = dx * s + dz * c
    return np.array([lx, -lz, EYE_Y - CROWN_Y])


def sun_in_ruin_frame(bearing, elevation):
    """The direction toward the sun (bearing degrees right of the view axis) in the ruin's frame."""
    b, e = math.radians(bearing), math.radians(elevation)
    wx, wy, wz = math.sin(b) * math.cos(e), math.sin(e), -math.cos(b) * math.cos(e)
    c, s = math.cos(RUIN_YAW), math.sin(RUIN_YAW)
    lx = wx * c - wz * s
    lz = wx * s + wz * c
    return np.array([lx, -lz, wy])


# -- outlines ---------------------------------------------------------------------------------


def _clean(points):
    """Drop repeated points and the middle of straight runs, so caps stay simple polygons."""
    out = []
    for p in points:
        p = (round(float(p[0]), 4), round(float(p[1]), 4))
        if out and abs(out[-1][0] - p[0]) < 1e-4 and abs(out[-1][1] - p[1]) < 1e-4:
            continue
        out.append(p)
    changed = True
    while changed and len(out) > 3:
        changed = False
        for i in range(1, len(out) - 1):
            a, b, c = np.array(out[i - 1]), np.array(out[i]), np.array(out[i + 1])
            cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if abs(cross) < 1e-6 and np.dot(b - a, c - b) > 0:
                del out[i]
                changed = True
                break
    return out


class Top:
    """A wall's top, built left to right along it as runs (s0, s1, h0, h1)."""

    def __init__(self, rng, start):
        self.rng = rng
        self.s = start
        self.runs = []

    def _run(self, s1, h0, h1):
        if s1 > self.s + 1e-4:
            self.runs.append((self.s, s1, h0, h1))
            self.s = s1

    def broken(self, end, h_start, h_end, rough=0.7, steps=(1.2, 3.4), slope=0.55):
        """Broken masonry from here to `end`: steps of whole courses round a line from h_start to h_end."""
        rng = self.rng
        start = self.s
        while self.s < end - 1e-4:
            run = rng.uniform(*steps)
            s1 = end if end - (self.s + run) < steps[0] * 0.6 else self.s + run
            mid = 0.5 * (self.s + s1)
            frac = np.clip((mid - start) / max(1e-6, end - start), 0.0, 1.0)
            base = h_start + (h_end - h_start) * frac
            h = max(1.0, round((base + rough * rng.normal()) / COURSE) * COURSE)
            if rng.random() < slope:
                # A crumbled slope: from this course toward the line's next height, off by a little.
                nxt = h_start + (h_end - h_start) * np.clip((s1 - start) / max(1e-6, end - start), 0.0, 1.0)
                h2 = max(1.0, nxt + rng.normal() * rough * 1.3)
                self._run(s1, h, h2)
            else:
                self._run(s1, h, h)
        return self

    def piece(self, end, h_start, h_end=None, **kwargs):
        return self.broken(end, h_start, h_start if h_end is None else h_end, **kwargs)

    def battlement(self, end, h, merlon=1.6, crenel=1.1, rise=1.3, lost=0.15):
        """A wall walk with its merlons, a few of them fallen."""
        rng = self.rng
        self._run(min(end, self.s + crenel * 0.5), h, h)
        while self.s < end - 1e-4:
            top = h if rng.random() < lost else h + rise
            self._run(min(end, self.s + merlon), top, top)
            self._run(min(end, self.s + crenel), h, h)
        return self

    def flat(self, end, h):
        self._run(end, h, h)
        return self

    def outline(self, bottom=FOUNDATION):
        """The wall's elevation, counter-clockwise: along the foot, then back along the top."""
        s0, s1 = self.runs[0][0], self.runs[-1][1]
        points = [(s0, bottom), (s1, bottom)]
        for a, b, h0, h1 in reversed(self.runs):
            points.append((b, h1))
            points.append((a, h0))
        return _clean(points)


def arch_outline(centre, sill, width, height, pointed=False):
    """A window or door: upright sides and a round (or pointed) head, counter-clockwise."""
    half = width * 0.5
    spring = sill + height - (half * (1.25 if pointed else 1.0))
    points = [(centre - half, sill), (centre + half, sill), (centre + half, spring)]
    for i in range(1, ARC_STEPS):
        a = math.pi * i / ARC_STEPS
        if pointed:
            # Two arcs meeting at the apex (a lancet).
            if a <= math.pi / 2:
                t = a / (math.pi / 2)
                x = centre + half - half * (1 - math.cos(t * math.pi / 2)) * 1.0
                y = spring + half * 1.25 * math.sin(t * math.pi / 2)
            else:
                t = (a - math.pi / 2) / (math.pi / 2)
                x = centre - half * math.sin(t * math.pi / 2) * 1.0
                y = spring + half * 1.25 * math.cos(t * math.pi / 2)
            points.append((x, y))
        else:
            points.append((centre + half * math.cos(a), spring + half * math.sin(a)))
    points.append((centre - half, spring))
    return points


# -- the kit: closed solids in a scratch scene ---------------------------------------------------


class Kit:
    def __init__(self, studio, seed=SEED):
        import bpy
        self.bpy = bpy
        self.studio = studio
        self.scene = studio.scene
        self.rng = np.random.default_rng(seed)
        self.parts = []          # (object, role, tone, turf)
        self.cutters = []
        self.solver = None

    # Solids are built straight into world coordinates (no object transforms).
    def _object(self, name, verts, faces):
        import bmesh
        bpy = self.bpy
        bm = bmesh.new()
        made = [bm.verts.new(tuple(map(float, v))) for v in verts]
        for face in faces:
            bm.faces.new([made[i] for i in face])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        mesh = bpy.data.meshes.new(PREFIX + name)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        self.scene.collection.objects.link(obj)
        return obj

    def prism(self, name, outline, origin, u, v, w0, w1):
        """A counter-clockwise outline in the plane (u, v) through `origin`, swept along u x v."""
        origin, u, v = (np.asarray(x, dtype=float) for x in (origin, u, v))
        w = np.cross(u, v)
        n = len(outline)
        ring = [origin + u * a + v * b for a, b in outline]
        verts = [p + w * w0 for p in ring] + [p + w * w1 for p in ring]
        faces = [list(reversed(range(n))), list(range(n, 2 * n))]
        faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
        return self._object(name, verts, faces)

    def ring(self, name, centre, r_bottom, r_top, inner, z0, z1, segments=22, phase=0.0):
        """A tower: a tapering cylinder, hollow when `inner` is given."""
        cx, cy = centre
        verts = []
        angles = [phase + 2 * math.pi * i / segments for i in range(segments)]
        for r, z in ((r_bottom, z0), (r_top, z1)):
            verts += [(cx + r * math.cos(a), cy + r * math.sin(a), z) for a in angles]
        n = segments
        faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
        if inner:
            base = len(verts)
            for z in (z0, z1):
                verts += [(cx + inner * math.cos(a), cy + inner * math.sin(a), z) for a in angles]
            faces += [[base + n + i, base + n + (i + 1) % n, base + (i + 1) % n, base + i] for i in range(n)]
            faces += [[i, base + i, base + (i + 1) % n, (i + 1) % n] for i in range(n)]
            faces += [[n + i, n + (i + 1) % n, base + n + (i + 1) % n, base + n + i] for i in range(n)]
        else:
            faces += [list(reversed(range(n))), list(range(n, 2 * n))]
        return self._object(name, verts, faces)

    def rock(self, name, centre, size, flat=0.6):
        """A fallen block: the hull of a jittered box, sitting into the ground."""
        import bmesh
        bpy = self.bpy
        rng = self.rng
        sx, sy, sz = size
        points = []
        for _ in range(12):
            p = rng.uniform(-0.5, 0.5, 3) * np.array([sx, sy, sz * flat * 2])
            points.append(p)
        yaw = rng.uniform(0, math.pi)
        c, s = math.cos(yaw), math.sin(yaw)
        bm = bmesh.new()
        for p in points:
            x, y, z = p
            bm.verts.new((centre[0] + x * c - y * s, centre[1] + x * s + y * c, centre[2] + z))
        bmesh.ops.convex_hull(bm, input=bm.verts[:])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        mesh = bpy.data.meshes.new(PREFIX + name)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        self.scene.collection.objects.link(obj)
        return obj

    def heap(self, name, centre, radii, height, yaw=0.0, segments=12):
        """A grassed rubble mound: a low, lumpy dome."""
        rng = self.rng
        cx, cy = centre
        rx, ry = radii
        c, s = math.cos(yaw), math.sin(yaw)
        verts = []
        rings = [(1.08, FOUNDATION * 0.25), (1.0, 0.0), (0.72, height * 0.55), (0.38, height * 0.92)]
        for k, (scale, z) in enumerate(rings):
            for i in range(segments):
                a = 2 * math.pi * (i + 0.5 * (k % 2)) / segments
                jitter = 1.0 + (0.18 if k else 0.05) * rng.normal()
                x, y = math.cos(a) * rx * scale * jitter, math.sin(a) * ry * scale * jitter
                verts.append((cx + x * c - y * s, cy + x * s + y * c, z + (0.25 * rng.normal() * height if k > 1 else 0)))
        top = len(verts)
        verts.append((cx, cy, height))
        n = segments
        faces = []
        for k in range(len(rings) - 1):
            for i in range(n):
                a0, a1 = k * n + i, k * n + (i + 1) % n
                b0, b1 = (k + 1) * n + i, (k + 1) * n + (i + 1) % n
                faces.append([a0, a1, b1, b0] if k % 2 == 0 else [a0, a1, b1, b0])
        last = (len(rings) - 1) * n
        faces += [[last + i, last + (i + 1) % n, top] for i in range(n)]
        faces.append(list(reversed(range(n))))
        return self._object(name, verts, [[int(i) for i in f] for f in faces])

    # -- booleans --------------------------------------------------------------------------------
    def cutter(self, obj):
        obj.hide_render = True
        self.cutters.append(obj)
        return obj

    def cut(self, obj, cutters):
        """Subtract each cutter, then bake the result into the object's own mesh."""
        bpy = self.bpy
        for i, cutter in enumerate(cutters):
            mod = obj.modifiers.new("cut%d" % i, "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.object = cutter
            if self.solver is None:
                try:
                    mod.solver = "MANIFOLD"
                    self.solver = "MANIFOLD"
                except TypeError:
                    self.solver = "EXACT"
            mod.solver = self.solver
        layer = self.studio.layer
        layer.update()
        depsgraph = layer.depsgraph
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=False, depsgraph=depsgraph)
        old = obj.data
        obj.modifiers.clear()
        obj.data = mesh
        bpy.data.meshes.remove(old)
        for cutter in cutters:
            data = cutter.data
            bpy.data.objects.remove(cutter, do_unlink=True)
            bpy.data.meshes.remove(data)
        return obj

    def keep(self, obj, role=WALL, tone=None, turf=0.0):
        tone = float(self.rng.uniform(0.3, 0.7)) if tone is None else tone
        self.parts.append((obj, role, tone, turf))
        return obj

    def dispose(self):
        bpy = self.bpy
        for obj, *_ in self.parts:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)
        self.parts = []


# -- the pieces of the castle -----------------------------------------------------------------------


class Wall:
    """A straight wall from a to b (plan, metres), `thickness` thick, its top a Top."""

    def __init__(self, kit, name, a, b, thickness, top_fn, extend=None):
        a = np.array([a[0], a[1], 0.0])
        b = np.array([b[0], b[1], 0.0])
        d = b - a
        self.length = float(np.linalg.norm(d[:2]))
        self.u = d / self.length
        self.v = np.array([0.0, 0.0, 1.0])
        self.origin = a
        self.thickness = thickness
        self.kit = kit
        self.name = name
        extend = thickness * 0.5 if extend is None else extend
        top = Top(kit.rng, -extend)
        top_fn(top, self.length, extend)
        self.top = top
        self.obj = kit.prism(name, top.outline(), a, self.u, self.v, -thickness * 0.5, thickness * 0.5)
        self.openings = []

    def opening(self, s, sill, width, height, pointed=False):
        outline = arch_outline(s, sill, width, height, pointed)
        cut = self.kit.prism("%s_hole%d" % (self.name, len(self.openings)), outline, self.origin, self.u, self.v,
                             -self.thickness * 2.0, self.thickness * 2.0)
        self.openings.append(self.kit.cutter(cut))
        return self

    def finish(self, tone=None):
        if self.openings:
            self.kit.cut(self.obj, self.openings)
        return self.kit.keep(self.obj, WALL, tone)

    def point(self, s, offset=0.0):
        """A plan point `s` along the wall, `offset` to its left (toward u x v)."""
        w = np.cross(self.u, self.v)
        p = self.origin + self.u * s + w * offset
        return float(p[0]), float(p[1])


def _rotate(point, centre, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    x, y = point
    return centre[0] + x * c - y * s, centre[1] + x * s + y * c


def slant_cutter(kit, name, centre, radius, direction, h_low, h_high, rough=0.8, steps=(0.8, 1.8)):
    """A cutter that takes a tower's top off on a slant, broken in courses: low toward `direction`."""
    ux, uy = math.cos(direction), math.sin(direction)
    u = np.array([ux, uy, 0.0])
    v = np.array([0.0, 0.0, 1.0])
    reach = radius + 2.0
    top = Top(kit.rng, -reach)
    top.piece(reach, h_high, h_low, rough=rough, steps=steps, slope=0.35)
    # The cutter's underside is the broken line; it reaches far up.
    outline = []
    for s0, s1, h0, h1 in top.runs:
        outline += [(s0, h0), (s1, h1)]
    outline += [(reach, 200.0), (-reach, 200.0)]
    origin = np.array([centre[0], centre[1], 0.0])
    return kit.cutter(kit.prism(name, _clean(outline), origin, u, v, -reach, reach))


def sector_cutter(kit, name, centre, radius, a0, a1, z0, z1=200.0):
    """A cutter that takes a slice out of a tower's side (angles a0..a1) from z0 up."""
    points = [(centre[0], centre[1])]
    for i in range(7):
        a = a0 + (a1 - a0) * i / 6
        points.append((centre[0] + (radius + 2.0) * math.cos(a), centre[1] + (radius + 2.0) * math.sin(a)))
    return kit.cutter(kit.prism(name, points, (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), z0, z1))


def build_castle(kit):
    """The castle's pieces, cut and kept on the kit. Returns the layout's landmarks."""
    rng = kit.rng
    marks = {}

    # The curtain wall round the crown (plan corners, clockwise from the round tower at the front left).
    C = [(-31.0, -18.0), (-11.5, -32.5), (5.5, -35.5), (28.0, -25.0), (39.0, -2.0), (33.0, 24.0),
         (6.0, 38.0), (-22.0, 32.0), (-38.0, 8.0)]
    marks["curtain"] = C
    T = 2.1  # the curtain's thickness

    def curtain(name, a, b, fn):
        wall = Wall(kit, name, a, b, T, fn, extend=T * 0.5)
        return wall

    # Front left: from the round tower to the gatehouse, broken to a breach in the middle.
    w = curtain("curtain_fl", C[0], C[1], lambda t, L, e: (
        t.piece(L * 0.22, 7.5, 6.5), t.piece(L * 0.36, 4.0, 2.0, rough=0.5), t.piece(L * 0.5, 1.5, 1.5, rough=0.3),
        t.piece(L * 0.66, 3.5, 5.5), t.battlement(L * 0.9, 7.5), t.piece(L + e, 8.0, 8.0, rough=0.3)))
    w.finish()
    marks["breach_fl"] = w.point(w.length * 0.45, 0.8)
    # Front right: battlements by the gate, then the great breach, then up to the square tower.
    w = curtain("curtain_fr", C[2], C[3], lambda t, L, e: (
        t.piece(L * 0.08, 8.5, 8.5, rough=0.2), t.battlement(L * 0.36, 8.0), t.piece(L * 0.46, 5.0, 2.0),
        t.piece(L * 0.66, 1.0, 1.0, rough=0.4), t.piece(L * 0.8, 3.0, 6.0), t.piece(L + e, 7.0, 8.0)))
    w.finish()
    marks["breach_fr"] = w.point(w.length * 0.57, 0.8)
    curtain("curtain_r1", C[3], C[4], lambda t, L, e: (
        t.piece(L * 0.3, 7.5, 7.0), t.battlement(L * 0.62, 7.0), t.piece(L + e, 6.5, 8.0))).finish()
    curtain("curtain_r2", C[4], C[5], lambda t, L, e: (
        t.piece(L * 0.5, 8.0, 6.0), t.piece(L + e, 5.0, 8.5))).finish()
    curtain("curtain_b1", C[5], C[6], lambda t, L, e: (
        t.piece(L * 0.4, 8.5, 9.0), t.piece(L * 0.55, 4.0, 3.0), t.piece(L + e, 6.0, 8.0))).finish()
    curtain("curtain_b2", C[6], C[7], lambda t, L, e: (
        t.piece(L * 0.5, 8.0, 7.0), t.battlement(L * 0.8, 7.0), t.piece(L + e, 7.5, 8.5))).finish()
    curtain("curtain_l1", C[7], C[8], lambda t, L, e: (
        t.piece(L * 0.6, 9.0, 8.0), t.piece(L + e, 6.5, 7.0))).finish()
    curtain("curtain_l2", C[8], C[0], lambda t, L, e: (
        t.piece(L * 0.35, 7.0, 7.5), t.battlement(L * 0.7, 7.5), t.piece(L + e, 8.0, 9.0))).finish()

    # The round tower at the front left: tapering, hollow, split open toward the gate and its top
    # broken off on a slant (high at the back left).
    rc = C[0]
    tower = kit.ring("round_tower", rc, 6.6, 5.7, 3.9, FOUNDATION, 26.0, segments=24)
    kit.cut(tower, [
        slant_cutter(kit, "round_tower_top", rc, 6.6, math.radians(-30), 16.5, 25.5),
        sector_cutter(kit, "round_tower_split", rc, 6.6, math.radians(-70), math.radians(-18), 10.5),
        sector_cutter(kit, "round_tower_split2", rc, 6.6, math.radians(-58), math.radians(-30), 6.0),
    ])
    kit.keep(tower, WALL, 0.45)
    marks["round_tower"] = rc

    # The gatehouse where the path arrives: a block with an arched passage and two round fronts.
    g0, g1 = np.array(C[1]), np.array(C[2])
    gc = (g0 + g1) * 0.5
    gyaw = math.atan2(g1[1] - g0[1], g1[0] - g0[0])
    marks["gate"] = (float(gc[0]), float(gc[1]))
    gu = np.array([math.cos(gyaw), math.sin(gyaw), 0.0])
    gw = np.array([-math.sin(gyaw), math.cos(gyaw), 0.0])     # into the castle
    half = 7.0
    depth = 9.0
    front = 1.5   # the block stands this far out of the curtain's line
    # A Wall is centred on its line: run that line down the block's middle.
    a = gc - gu[:2] * half + gw[:2] * (depth * 0.5 - front)
    gate = Wall(kit, "gatehouse", a, a + gu[:2] * half * 2, depth, lambda t, L, e: (
        t.piece(L * 0.3, 12.5, 13.0, rough=0.4), t.battlement(L * 0.62, 12.5), t.piece(L, 11.0, 9.5, rough=0.6)),
        extend=0.0)
    gate.opening(half, FOUNDATION, 3.6, 6.4 - FOUNDATION)
    gate.opening(half, 8.0, 1.5, 2.6)
    gate.finish(0.5)
    for side, (h_low, h_high) in ((-1, (11.0, 14.5)), (1, (9.5, 13.0))):
        centre = gc + gu[:2] * side * 5.1 - gw[:2] * front
        drum = kit.ring("gate_drum%d" % side, tuple(centre), 3.3, 3.1, None, FOUNDATION, 16.0, segments=16)
        kit.cut(drum, [slant_cutter(kit, "gate_drum_top%d" % side, tuple(centre), 3.3,
                                    gyaw + (math.pi if side < 0 else 0.0), h_low, h_high, rough=0.4)])
        kit.keep(drum, WALL, 0.52)

    # The square tower at the front right: four walls, its front broken low so the inside shows.
    sq = np.array(C[3]) + np.array([1.0, 1.0])
    syaw = math.radians(28)
    S = 9.0
    t2 = 1.7
    corners = [_rotate((x, y), sq, syaw) for x, y in ((-S / 2, -S / 2), (S / 2, -S / 2), (S / 2, S / 2), (-S / 2, S / 2))]
    Wall(kit, "square_front", corners[0], corners[1], t2, lambda t, L, e: (
        t.piece(L * 0.3, 12.0, 9.0), t.piece(L * 0.75, 4.5, 3.0), t.piece(L + e, 6.0, 8.0))).finish(0.42)
    Wall(kit, "square_right", corners[1], corners[2], t2, lambda t, L, e: (
        t.piece(L + e, 10.0, 15.5, rough=0.5),)).finish(0.4)
    back = Wall(kit, "square_back", corners[2], corners[3], t2, lambda t, L, e: (
        t.piece(L * 0.4, 16.0, 16.5, rough=0.3), t.piece(L + e, 15.0, 13.0, rough=0.5)))
    back.opening(back.length * 0.5, 9.0, 1.4, 3.2)
    back.finish(0.42)
    Wall(kit, "square_left", corners[3], corners[0], t2, lambda t, L, e: (
        t.piece(L + e, 13.5, 11.0, rough=0.6),)).finish(0.4)
    marks["square_tower"] = (float(sq[0]), float(sq[1]))

    # The keep: turned three-quarters to the fields (its left face takes the morning sun, the only
    # light that ever falls on a face the fields see), its front and left walls the tall ones (two
    # tiers of windows in them), the back lower so the sky shows through the upper windows, the
    # right wall broken down in a V. A stair turret at its front left corner is the highest point.
    kc = (7.0, 5.0)
    kyaw = math.radians(38)
    KX, KY, KT = 19.0, 15.0, 2.5
    fl, fr, br, bl = (_rotate(p, kc, kyaw) for p in ((-KX / 2, -KY / 2), (KX / 2, -KY / 2), (KX / 2, KY / 2),
                                                     (-KX / 2, KY / 2)))
    marks["keep"] = kc
    front = Wall(kit, "keep_front", fl, fr, KT, lambda t, L, e: (
        t.piece(L * 0.2, 26.5, 26.0, rough=0.3), t.piece(L * 0.48, 24.0, 22.5, rough=0.5),
        t.piece(L * 0.78, 21.0, 18.5), t.piece(L + e, 17.0, 15.0)))
    front.opening(front.length * 0.27, 14.5, 2.4, 5.8)
    front.opening(front.length * 0.58, 14.0, 2.4, 5.8)
    front.opening(front.length * 0.22, 7.5, 1.5, 3.0)
    front.opening(front.length * 0.7, 7.5, 1.5, 3.0)
    front.finish(0.5)
    left = Wall(kit, "keep_left", bl, fl, KT, lambda t, L, e: (
        t.piece(L * 0.28, 30.5, 30.0, rough=0.2), t.piece(L * 0.72, 26.5, 24.5, rough=0.5),
        t.piece(L + e, 25.5, 26.5, rough=0.3)))
    left.opening(left.length * 0.52, 15.0, 2.2, 5.8)
    left.opening(left.length * 0.4, 7.5, 1.4, 2.8)
    left.finish(0.55)
    back = Wall(kit, "keep_back", br, bl, KT, lambda t, L, e: (
        t.piece(L * 0.45, 10.5, 12.5), t.piece(L * 0.8, 13.0, 15.0), t.piece(L + e, 24.0, 30.0, rough=0.3)))
    back.opening(back.length * 0.3, 6.5, 1.4, 2.8)
    back.finish(0.5)
    right = Wall(kit, "keep_right", fr, br, KT, lambda t, L, e: (
        t.piece(L * 0.25, 15.5, 12.0), t.piece(L * 0.55, 6.5, 4.0, rough=0.6), t.piece(L + e, 7.0, 10.5)))
    right.finish(0.48)
    # Clasping buttresses at the corners the fields see.
    for name, corner, along, height in (("keep_buttress_fr", fr, kyaw, 13.0), ("keep_buttress_fl", fl, kyaw, 21.0)):
        bx = _rotate((0.0, 0.0), corner, 0.0)
        outline = [(-1.8, FOUNDATION), (1.8, FOUNDATION), (1.8, height), (0.0, height + 1.0), (-1.8, height)]
        u = np.array([math.cos(along + math.pi / 4), math.sin(along + math.pi / 4), 0.0])
        kit.keep(kit.prism(name, outline, (bx[0], bx[1], 0.0), u, (0.0, 0.0, 1.0), -1.8, 1.8), WALL, 0.5)
    turret_c = _rotate((-KX / 2 - 0.5, KY / 2 + 0.5), kc, kyaw)
    turret = kit.ring("keep_turret", turret_c, 2.7, 2.5, None, FOUNDATION, 37.0, segments=16)
    kit.cut(turret, [slant_cutter(kit, "keep_turret_top", turret_c, 2.7, kyaw - math.radians(20), 32.5, 35.0,
                                  rough=0.3)])
    kit.keep(turret, WALL, 0.47)
    marks["turret"] = turret_c

    # Rubble: grassed heaps at the breaches and under the broken walls, fallen blocks on them.
    heaps = [
        (marks["breach_fl"], (6.0, 3.2), 2.2, -0.6),
        (marks["breach_fr"], (6.5, 3.5), 2.0, 0.42),
        (_rotate((7.5, -3.0), rc, 0.0), (5.0, 3.5), 2.6, -0.4),
        (_rotate((KX / 2 + 2.5, 1.0), kc, kyaw), (4.0, 6.0), 3.0, kyaw),
        (_rotate((0.0, -S / 2 - 2.5), tuple(sq), syaw), (4.5, 2.6), 1.8, syaw),
        ((float(gc[0]) - 14.0, float(gc[1]) + 9.0), (3.5, 2.5), 1.2, 0.3),
    ]
    for i, (centre, radii, height, yaw) in enumerate(heaps):
        kit.keep(kit.heap("heap%d" % i, centre, radii, height, yaw), RUBBLE, 0.4, turf=0.75)
        for j in range(6):
            a = rng.uniform(0, 2 * math.pi)
            r = rng.uniform(0.2, 1.1)
            p = (centre[0] + math.cos(a) * radii[0] * r, centre[1] + math.sin(a) * radii[1] * r)
            on = height * max(0.0, 1.0 - r * r) * 0.85
            size = (rng.uniform(0.9, 2.2), rng.uniform(0.8, 1.8), rng.uniform(0.7, 1.4))
            kit.keep(kit.rock("block%d_%d" % (i, j), (p[0], p[1], on), size), RUBBLE, float(rng.uniform(0.35, 0.7)),
                     turf=0.15)
    # A slab of fallen wall face under the round tower's split.
    slab = kit.prism("fallen_slab", [(-3.2, -0.9), (3.2, -0.9), (3.0, 0.9), (-2.8, 0.9)],
                     (rc[0] + 8.5, rc[1] - 7.0, 1.3), (math.cos(0.5), math.sin(0.5), 0.0),
                     (-math.sin(0.5) * 0.3, math.cos(0.5) * 0.3, 0.95), -1.6, 1.6)
    kit.keep(slab, RUBBLE, 0.5, turf=0.1)
    return marks


# -- bake and arrays ------------------------------------------------------------------------------


def _hemisphere(count):
    """Cosine-weighted directions about +z (Hammersley)."""
    out = []
    for i in range(count):
        u1 = (i + 0.5) / count
        bits = i
        u2 = 0.0
        f = 0.5
        while bits:
            u2 += f * (bits & 1)
            bits >>= 1
            f *= 0.5
        r = math.sqrt(u1)
        phi = 2 * math.pi * u2
        out.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1.0 - u1))))
    return np.array(out)


class Model:
    def __init__(self, positions, normals, colors, bent, triangles, marks, stats):
        self.positions = positions      # glTF metres, the crown at y = 0
        self.normals = normals
        self.colors = colors            # r sky seen, g stone tone, b turf, a dressed (1) or rubble (0)
        self.bent = bent                # the mean open direction
        self.triangles = triangles
        self.marks = marks
        self.stats = stats

    def record(self):
        low, high = self.positions.min(axis=0), self.positions.max(axis=0)
        return dict(triangles=int(len(self.triangles)), vertices=int(len(self.positions)),
                    height=round(float(high[1]), 2), width=round(float(high[0] - low[0]), 2),
                    depth=round(float(high[2] - low[2]), 2))


def to_gltf(points):
    points = np.asarray(points, dtype=np.float64)
    return np.stack([points[:, 0], points[:, 2], -points[:, 1]], axis=1)


def collect(kit, rays=40, reach=30.0, seed=SEED):
    """Flat-shaded arrays of every kept part, with the per-face sky and bent normal baked."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    rng = np.random.default_rng(seed + 1)
    all_verts = []
    all_polys = []
    faces = []      # (corner positions, triangles as corner indices, normal, role, tone, turf)
    for obj, role, tone, turf in kit.parts:
        mesh = obj.data
        mesh.calc_loop_triangles()
        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        base = len(all_verts)
        all_verts.extend(map(tuple, co))
        tris_of = {}
        for tri in mesh.loop_triangles:
            tris_of.setdefault(tri.polygon_index, []).append(tuple(tri.vertices))
        for poly in mesh.polygons:
            indices = list(poly.vertices)
            all_polys.append([base + i for i in indices])
            local = {v: k for k, v in enumerate(indices)}
            tris = [(local[a], local[b], local[c]) for a, b, c in tris_of.get(poly.index, [])]
            if not tris:
                continue
            face_tone = float(np.clip(tone + rng.normal(0.0, 0.08), 0.0, 1.0))
            faces.append((co[indices], tris, np.array(poly.normal), role, face_tone, turf, poly.area))
    tree = BVHTree.FromPolygons(all_verts, all_polys, epsilon=0.0)
    hemi = _hemisphere(rays)
    positions, normals, colors, bents, triangles = [], [], [], [], []
    started = time.time()
    total_rays = 0
    for corners, tris, normal, role, tone, turf, area in faces:
        n = normal / max(1e-9, np.linalg.norm(normal))
        helper = np.array([0.0, 0.0, 1.0]) if abs(n[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        t1 = np.cross(helper, n)
        t1 /= np.linalg.norm(t1)
        t2 = np.cross(n, t1)
        areas = np.array([0.5 * np.linalg.norm(np.cross(corners[b] - corners[a], corners[c] - corners[a]))
                          for a, b, c in tris])
        samples = int(np.clip(round(area / 6.0), 2, 10))
        open_count = 0
        bent = np.zeros(3)
        for _ in range(samples):
            k = rng.choice(len(tris), p=areas / areas.sum()) if areas.sum() > 0 else 0
            a, b, c = tris[k]
            r1, r2 = rng.random(), rng.random()
            if r1 + r2 > 1:
                r1, r2 = 1 - r1, 1 - r2
            p = corners[a] + (corners[b] - corners[a]) * r1 + (corners[c] - corners[a]) * r2 + n * 0.04
            spin = rng.uniform(0, 2 * math.pi)
            cs, sn = math.cos(spin), math.sin(spin)
            x = hemi[:, 0] * cs - hemi[:, 1] * sn
            y = hemi[:, 0] * sn + hemi[:, 1] * cs
            directions = x[:, None] * t1[None, :] + y[:, None] * t2[None, :] + hemi[:, 2:3] * n[None, :]
            origin = Vector(p)
            for d in directions:
                if tree.ray_cast(origin, Vector(d), reach)[0] is None:
                    open_count += 1
                    bent += d
            total_rays += len(hemi)
        sky = open_count / (samples * len(hemi))
        bent = bent / np.linalg.norm(bent) if np.linalg.norm(bent) > 1e-6 else n
        base = len(positions)
        positions.extend(corners)
        normals.extend([n] * len(corners))
        colors.extend([(sky, tone, turf, role)] * len(corners))
        bents.extend([bent] * len(corners))
        triangles.extend([(base + a, base + b, base + c) for a, b, c in tris])
    print("%s baked %d faces, %d rays in %.1fs" % (TAG, len(faces), total_rays, time.time() - started), flush=True)
    return (to_gltf(positions), to_gltf(normals), np.array(colors), to_gltf(bents),
            np.array(triangles, dtype=np.int64))


def build(studio, seed=SEED):
    started = time.time()
    kit = Kit(studio, seed)
    try:
        marks = build_castle(kit)
        built = time.time()
        positions, normals, colors, bent, triangles = collect(kit, seed=seed)
    finally:
        kit.dispose()
    stats = dict(solver=kit.solver, build_s=round(built - started, 1), total_s=round(time.time() - started, 1))
    model = Model(positions, normals, colors, bent, triangles, marks, stats)
    print("%s %s %s" % (TAG, model.record(), stats), flush=True)
    return model


def write(path, model, generator, schema_version):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=generator)
    writer.add_mesh("ruin", {
        "POSITION": (model.positions, False),
        "NORMAL": (glb.quantize_unit(model.normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(np.clip(model.colors, 0.0, 1.0), np.uint8), True),
        "_BENT": (glb.quantize_unit(np.concatenate([model.bent, np.zeros((len(model.bent), 1))], axis=1),
                                    np.int8), True),
    }, indices=model.triangles)
    low, high = model.positions.min(axis=0), model.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=schema_version, **model.record(),
        color={"r": "sky seen (ambient occlusion)", "g": "stone tone", "b": "turf", "a": "dressed stone (1) or rubble (0)"},
        bent="the mean open direction (glTF frame)",
        frame="glTF metres, the knoll's crown at y = 0, +z toward the fields (the theme turns it by its yaw)",
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


# -- previews (never shipped) ------------------------------------------------------------------------


STONE = (np.array([0.16, 0.15, 0.135]), np.array([0.3, 0.27, 0.22]))
TURF = np.array([0.1, 0.12, 0.04])


def preview_colours(model, normals_up=True):
    sky, tone, turf, role = (model.colors[:, i] for i in range(4))
    stone = STONE[0][None, :] * (1 - tone[:, None]) + STONE[1][None, :] * tone[:, None]
    up = np.clip((model.normals[:, 1] - 0.55) / 0.3, 0.0, 1.0) if normals_up else 0.0
    grass = np.clip(np.maximum(turf, up * 0.85), 0.0, 1.0)[:, None]
    colour = stone * (1 - grass) + TURF[None, :] * grass
    return colour * (0.25 + 0.75 * sky[:, None])


def previews(model, directory, studio, views=None):
    """Stills: the eye's view through a long lens (backlit storm and side-lit morning), and a high
    three-quarter view of the whole castle."""
    import bpy
    from mathutils import Vector
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    made = []
    obj = studio.mesh_object("ruin_preview", model.positions, model.triangles, colors=preview_colours(model),
                             smooth=False)
    obj.data.materials.append(studio.material("ruin_preview", roughness=0.95))
    made.append(obj)
    # The knoll: a flat crown falling away beyond fifty metres.
    rings = [(0.0, 0.0), (50.0, -0.6), (60.0, -6.6), (80.0, -18.5), (100.0, -32.4), (140.0, -47.4)]
    verts = [(0.0, 0.0, 0.0)]
    segs = 48
    for r, z in rings[1:]:
        verts += [(r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z) for i in range(segs)]
    tris = [(0, 1 + (i + 1) % segs, 1 + i) for i in range(segs)]
    for k in range(len(rings) - 2):
        a, b = 1 + k * segs, 1 + (k + 1) * segs
        for i in range(segs):
            tris += [(a + i, a + (i + 1) % segs, b + (i + 1) % segs), (a + i, b + (i + 1) % segs, b + i)]
    knoll_pos = to_gltf(np.array(verts))
    knoll = studio.mesh_object("ruin_knoll", knoll_pos, np.array(tris), colors=np.tile([0.09, 0.1, 0.05], (len(verts), 1)),
                               smooth=True)
    knoll.data.materials.append(studio.material("ruin_knoll", roughness=1.0))
    made.append(knoll)
    world = studio.scene.world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    # Other lights in the studio (the trees' preview sun) stay dark while these render.
    others = [o for o in studio.scene.collection.all_objects if o.type == "LIGHT" and not o.hide_render]
    for other in others:
        other.hide_render = True
    light_data = bpy.data.lights.new(PREFIX + "sun", "SUN")
    light_data.angle = math.radians(2.0)
    sun = bpy.data.objects.new(PREFIX + "sun", light_data)
    studio.scene.collection.objects.link(sun)
    camera_data = bpy.data.cameras.new(PREFIX + "camera")
    camera_data.clip_end = 5000.0
    camera = bpy.data.objects.new(PREFIX + "camera", camera_data)
    studio.scene.collection.objects.link(camera)
    scene = studio.scene
    scene.camera = camera
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    eye = eye_in_ruin_frame()
    centre = np.array([0.0, 0.0, 14.0])
    views = views or [
        ("eye-storm", eye, centre, 460.0, (1600, 700), (-27.0, 22.4), (0.5, 0.56, 0.66), 2.5, 1.0),
        ("eye-morning", eye, centre, 460.0, (1600, 700), (-70.0, 35.1), (0.5, 0.58, 0.72), 3.5, 0.8),
        ("eye-golden", eye, centre, 460.0, (1600, 700), (31.0, 6.1), (0.75, 0.6, 0.5), 3.0, 0.8),
        ("eye-scale", eye, centre, 264.0, (192, 84), (-70.0, 35.1), (0.5, 0.58, 0.72), 3.5, 0.8),
        ("three-quarter", np.array([-140.0, -170.0, 95.0]), np.array([0.0, 0.0, 6.0]), 50.0, (1400, 900),
         (-70.0, 35.1), (0.5, 0.58, 0.72), 3.5, 0.8),
    ]
    try:
        for name, eye_b, target_b, lens, size, (bearing, elevation), sky, sun_strength, sky_strength in views:
            direction = sun_in_ruin_frame(bearing, elevation)
            sun.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
            light_data.energy = sun_strength
            light_data.color = (1.0, 0.86, 0.68)
            background.inputs["Color"].default_value = (*sky, 1.0)
            background.inputs["Strength"].default_value = sky_strength
            camera_data.lens = lens
            camera.location = Vector(eye_b)
            camera.rotation_euler = (Vector(target_b) - Vector(eye_b)).to_track_quat("-Z", "Y").to_euler()
            scene.render.resolution_x, scene.render.resolution_y = size
            scene.cycles.samples = 24 if size[0] > 400 else 64
            scene.render.filepath = str(directory / ("ruin-%s.png" % name))
            bpy.ops.render.render(write_still=True, scene=scene.name)
            print("%s preview %s" % (TAG, name), flush=True)
    finally:
        for other in others:
            other.hide_render = False
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(camera_data)
        bpy.data.objects.remove(sun, do_unlink=True)
        bpy.data.lights.remove(light_data)
        for obj in made:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)
