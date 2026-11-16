"""Halcyon Apex's skyfarers: the craft that come to the sanctuary's light, modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/halcyon_apex_fleet.py -- \
        --out src/themes/halcyon-apex/halcyon-apex-fleet-model.js [--preview <dir>]

Eight hulls, each built for how the sanctuary sees it: from the lagoon, looking up, 40 to 250 px
across. So every hull is drawn for its silhouette and its belly first:

    swift    a courier dart, 17 m: a needle body, crescent wings swept back to points like a
             swallow's, two tail streamers, a keel light and twin engines
    manta    a dark flying wing, 44 m across: a thick heart thinning to down-curved tips, two
             horns at its brow, a long tail spine, veins of light over its back, lamps under it
    barge    a hauler, 34 m: a cab on a spine between two pontoons, six crystals of cargo that
             glow, an engine block of four
    saucer   the classic disc, 15 m: a chrome lens, a dark belt of lamps, a glass dome, an
             emitter under its belly
    ark      a great ship, 220 m: a long keel-deep hull through two habitat rings, a tall sail,
             three engines
    hoop     a ring that carries a crystal, 20 m: an upright hoop with a cut stone floating at
             its centre and three pods on its rim
    capsule  a plain white capsule, 13 m
    orb      a ball of light, 2.2 m

Blender's frame while modelling: x the nose, y port, z up, metres. The game's frame (what the
module holds): x the nose, y up, z starboard. Every part is a closed shell lofted from sections
(a superellipse ring along a body, an airfoil ring along a wing), turned outward by its signed
volume, and tagged with what it is made of. Normals are smoothed across edges flatter than 38
degrees; ambient occlusion is cast against the whole hull (wing roots, intakes and the space
between a ring and its hull darken), and both are baked per vertex.

The export quantises positions to Int16 (the step per hull is in the module), normals to Int8,
and writes (surface, param, occlusion, 0) as bytes. Lamps and engines are exported as points so
the theme lights them as sprites and draws exhaust trails from the engines.

Deterministic: the same script writes the same file.
"""

import base64
import math
import sys
from array import array
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

TAG = "[halcyon-fleet]"

# What a face is made of (the hull shader branches on it; halcyon-apex-visitor-plan.js: SURFACE).
CHROME, SATIN, MATTE, GLASS, LAMP, ORB, PEARL, ENGINE, TRIM, CRYSTAL = range(10)

SMOOTH_ANGLE = math.radians(38)
TAU = math.pi * 2


def sgn(v):
    return -1.0 if v < 0 else 1.0


def lerp(a, b, t):
    return a + (b - a) * t


class Hull:
    """One craft: a bmesh of closed parts, each face tagged (surface, param)."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.surf = self.bm.faces.layers.int.new("surf")
        self.param = self.bm.faces.layers.float.new("param")
        self.lamps = []
        self.engines = []

    # ── parts ──

    def _finish(self, faces, surface, param, outward=None):
        """Turn a part's faces outward (signed volume, or toward `outward`) and tag them."""
        faces = [f for f in faces if f.is_valid]
        if not faces:
            return faces
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        self.bm.normal_update()
        if outward is not None:
            for f in faces:
                if f.normal.dot(outward) < 0:
                    f.normal_flip()
        else:
            volume = sum(f.calc_center_median().dot(f.normal) * f.calc_area() for f in faces)
            if volume < 0:
                for f in faces:
                    f.normal_flip()
        for f in faces:
            f[self.surf] = surface
            f[self.param] = param
        return faces

    def loft(self, rings, surface, param=0.0, cap_start=True, cap_end=True, outward=None):
        """A shell through `rings` (lists of points, equal length; a ring of one point is a tip)."""
        bm = self.bm
        made = []
        vrings = [[bm.verts.new(p) for p in ring] for ring in rings]
        for a, b in zip(vrings, vrings[1:]):
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                n = len(b)
                for k in range(n):
                    made.append(bm.faces.new((a[0], b[k], b[(k + 1) % n])))
            elif len(b) == 1:
                n = len(a)
                for k in range(n):
                    made.append(bm.faces.new((a[k], b[0], a[(k + 1) % n])))
            else:
                n = len(a)
                for k in range(n):
                    made.append(bm.faces.new((a[k], b[k], b[(k + 1) % n], a[(k + 1) % n])))
        if cap_start and len(vrings[0]) > 2:
            made.append(bm.faces.new(vrings[0]))
        if cap_end and len(vrings[-1]) > 2:
            made.append(bm.faces.new(list(reversed(vrings[-1]))))
        return self._finish(made, surface, param, outward)

    def body(self, stations, surface, param=0.0, n=14, power=2.5, belly=None, cap_start=True, cap_end=True):
        """A body along x: stations of (x, half width, height up, height down, centre z[, centre y]).

        `belly` = (surface, param) for the faces that look down (a two-tone hull).
        """
        rings = []
        for st in stations:
            x, hw, hu, hd, cz = st[:5]
            cy = st[5] if len(st) > 5 else 0.0
            if hw <= 1e-6 and hu <= 1e-6 and hd <= 1e-6:
                rings.append([Vector((x, cy, cz))])
                continue
            ring = []
            for k in range(n):
                a = TAU * (k + 0.5) / n
                c, s = math.cos(a), math.sin(a)
                y = cy + hw * sgn(c) * abs(c) ** (2 / power)
                z = cz + (hu if s >= 0 else hd) * sgn(s) * abs(s) ** (2 / power)
                ring.append(Vector((x, y, z)))
            rings.append(ring)
        faces = self.loft(rings, surface, param, cap_start, cap_end)
        if belly:
            for f in faces:
                if f.normal.z < -0.35:
                    f[self.surf] = belly[0]
                    f[self.param] = belly[1]
        return faces

    def wing(self, sections, surface, param=0.0, side=1, chord=(0.0, 0.05, 0.22, 0.5, 0.8, 1.0), edge=None,
             cap_root=True, cap_tip=True, vertical=False, under=None):
        """A wing through airfoil sections of (span, lift, leading x, trailing x, thickness).

        `side` mirrors the span; `vertical` stands it up (a fin: span along z, lift along y).
        `edge` = (surface, param) for the leading edge's faces; `under` for the lower skin.
        """
        rings = []
        m = len(chord)
        for (span, lift, le, te, t) in sections:
            upper = []
            lower = []
            for c in chord:
                x = lerp(le, te, c)
                shape = 2.6 * math.sqrt(max(c, 0.0)) * (1 - c) if 0 < c < 1 else 0.0
                upper.append((x, lift + t * shape))
                lower.append((x, lift - t * 0.62 * shape))
            ring2 = upper + list(reversed(lower[1:-1]))
            ring = []
            for (x, h) in ring2:
                if vertical:
                    ring.append(Vector((x, side * h, span)))
                else:
                    ring.append(Vector((x, side * span, h)))
            rings.append(ring)
        faces = self.loft(rings, surface, param, cap_root, cap_tip)
        ring_n = 2 * m - 2
        if edge or under:
            for f in faces:
                if len(f.verts) != 4:
                    continue
                centre = f.calc_center_median()
                # Which chord cell a face lies in: by its mean x against the section it sits on.
                if edge:
                    spans = [abs((v.co.z if vertical else v.co.y)) for v in f.verts]
                    lo, hi = min(spans), max(spans)
                    for (a, b) in zip(sections, sections[1:]):
                        if abs(a[0] - lo) < 1e-4 and abs(b[0] - hi) < 1e-4:
                            k = 0.5
                            le = lerp(a[2], b[2], k)
                            te = lerp(a[3], b[3], k)
                            c = (centre.x - le) / (te - le) if abs(te - le) > 1e-6 else 0.5
                            if c < chord[1] * 0.75 + 1e-4:
                                f[self.surf] = edge[0]
                                f[self.param] = edge[1]
                if under and f[self.surf] == surface:
                    down = (f.normal.y * -side) if vertical else f.normal.z
                    if (not vertical) and down < -0.5:
                        f[self.surf] = under[0]
                        f[self.param] = under[1]
        del ring_n
        return faces

    def disc(self, centre, normal, radius, surface, param=0.0, n=12):
        bm = self.bm
        nrm = Vector(normal).normalized()
        ref = Vector((0, 0, 1)) if abs(nrm.z) < 0.9 else Vector((1, 0, 0))
        e1 = nrm.cross(ref).normalized()
        e2 = nrm.cross(e1)
        c = bm.verts.new(Vector(centre))
        rim = [bm.verts.new(Vector(centre) + (e1 * math.cos(TAU * k / n) + e2 * math.sin(TAU * k / n)) * radius)
               for k in range(n)]
        made = [bm.faces.new((c, rim[k], rim[(k + 1) % n])) for k in range(n)]
        return self._finish(made, surface, param, outward=nrm)

    def tube(self, a, b, ra, rb, surface, param=0.0, n=10, cap_a=True, cap_b=True):
        """A cone frustum from a to b."""
        a = Vector(a)
        b = Vector(b)
        axis = (b - a).normalized()
        ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
        e1 = axis.cross(ref).normalized()
        e2 = axis.cross(e1)
        rings = []
        for (p, r) in ((a, ra), (b, rb)):
            if r <= 1e-6:
                rings.append([p.copy()])
            else:
                rings.append([p + (e1 * math.cos(TAU * k / n) + e2 * math.sin(TAU * k / n)) * r for k in range(n)])
        return self.loft(rings, surface, param, cap_a, cap_b)

    def nozzle(self, centre, back, radius, length=0.5, shell=(SATIN, 0.06), n=12):
        """An engine: a short dark collar and the fire inside it. `back` = the way the fire leaves."""
        centre = Vector(centre)
        back = Vector(back).normalized()
        self.tube(centre - back * length, centre + back * 0.02, radius * 1.02, radius * 1.12, shell[0], shell[1], n,
                  cap_a=True, cap_b=False)
        self.disc(centre - back * 0.04, back, radius * 0.98, ENGINE, 0.0, n)
        self.engines.append((centre + back * 0.1, radius))

    def torus(self, centre, axis, major, minor, surface, param=0.0, n_major=28, n_minor=8, squash=1.0):
        """A ring about `axis`; `squash` flattens its section along the axis."""
        bm = self.bm
        centre = Vector(centre)
        axis = Vector(axis).normalized()
        ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
        e1 = axis.cross(ref).normalized()
        e2 = axis.cross(e1)
        grid = []
        for i in range(n_major):
            a = TAU * i / n_major
            radial = e1 * math.cos(a) + e2 * math.sin(a)
            ring = []
            for j in range(n_minor):
                b = TAU * (j + 0.5) / n_minor
                ring.append(bm.verts.new(centre + radial * (major + minor * math.cos(b)) + axis * (minor * squash * math.sin(b))))
            grid.append(ring)
        made = []
        for i in range(n_major):
            a = grid[i]
            b = grid[(i + 1) % n_major]
            for j in range(n_minor):
                made.append(bm.faces.new((a[j], b[j], b[(j + 1) % n_minor], a[(j + 1) % n_minor])))
        return self._finish(made, surface, param)

    def box(self, lo, hi, surface, param=0.0):
        bm = self.bm
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        v = [bm.verts.new(Vector(p)) for p in (
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
        quads = ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))
        made = [bm.faces.new([v[i] for i in q]) for q in quads]
        return self._finish(made, surface, param)

    def strut(self, a, b, half, surface, param=0.0):
        """A square beam from a to b."""
        return self.tube(a, b, half, half, surface, param, n=4)

    def bipyramid(self, centre, axis, half, girth, surface=CRYSTAL, param=0.0, sides=6, waist=0.12):
        """A cut crystal: two points and a belt (the sanctuary's own stone)."""
        centre = Vector(centre)
        axis = Vector(axis).normalized()
        ref = Vector((1, 0, 0)) if abs(axis.x) < 0.9 else Vector((0, 1, 0))
        e1 = axis.cross(ref).normalized()
        e2 = axis.cross(e1)
        rings = [[centre - axis * half]]
        for h in (-waist, waist):
            rings.append([centre + axis * (half * h) + (e1 * math.cos(TAU * k / sides) + e2 * math.sin(TAU * k / sides)) * girth
                          for k in range(sides)])
        rings.append([centre + axis * half])
        return self.loft(rings, surface, param)

    def sphere(self, centre, radius, surface, param=0.0, n=12, m=8):
        centre = Vector(centre)
        rings = [[centre + Vector((0, 0, -radius))]]
        for j in range(1, m):
            a = math.pi * j / m
            rings.append([centre + Vector((radius * math.sin(a) * math.cos(TAU * k / n),
                                           radius * math.sin(a) * math.sin(TAU * k / n),
                                           -radius * math.cos(a))) for k in range(n)])
        rings.append([centre + Vector((0, 0, radius))])
        return self.loft(rings, surface, param)

    def revolve(self, profile, n=36):
        """A surface of revolution about z: profile of (r, z, surface, param) from the bottom up."""
        made_all = []
        for (lo, hi) in zip(profile, profile[1:]):
            rings = []
            for (r, z, _s, _p) in (lo, hi):
                if r <= 1e-6:
                    rings.append([Vector((0, 0, z))])
                else:
                    rings.append([Vector((r * math.cos(TAU * k / n), r * math.sin(TAU * k / n), z)) for k in range(n)])
            mid_r = (lo[0] + hi[0]) * 0.5
            dz = hi[1] - lo[1]
            dr = hi[0] - lo[0]
            # The band's outward side: away from the axis, leaning up or down with its slope.
            out = Vector((dz, 0, -dr))
            if out.length < 1e-9:
                out = Vector((0, 0, -1 if mid_r >= 0 else 1))
            faces = self.loft(rings, lo[2], lo[3], cap_start=False, cap_end=False, outward=None)
            # Open bands: orient each face away from the axis by the band's slope.
            for f in faces:
                c = f.calc_center_median()
                radial = Vector((c.x, c.y, 0))
                if radial.length > 1e-9:
                    radial.normalize()
                want = radial * out.x + Vector((0, 0, out.z))
                if f.normal.dot(want) < 0:
                    f.normal_flip()
            made_all += faces
        return made_all

    def lamp(self, group, at, size, index=0):
        self.lamps.append((group, Vector(at), size, index))

    def mirror_y(self, build):
        """Run `build(side)` for the starboard and the port side."""
        build(1)
        build(-1)


# ── The eight hulls ─────────────────────────────────────────────────────────────

LAMP_GROUPS = ["rim", "under", "corner", "core", "window", "nose", "tail", "engine", "orb", "port", "starboard",
               "keel", "cargo", "crown"]


def build_swift():
    """The courier dart: a swallow of pearl with a dark belly."""
    h = Hull("swift")
    h.body([
        (8.8, 0, 0, 0, 0.02),
        (8.2, 0.14, 0.11, 0.09, 0.03),
        (7.0, 0.40, 0.28, 0.22, 0.05),
        (5.4, 0.70, 0.48, 0.34, 0.08),
        (3.4, 0.98, 0.70, 0.46, 0.10),
        (1.2, 1.14, 0.82, 0.54, 0.10),
        (-1.0, 1.16, 0.78, 0.56, 0.08),
        (-3.2, 1.04, 0.64, 0.52, 0.05),
        (-5.2, 0.92, 0.52, 0.48, 0.02),
        (-6.8, 0.84, 0.46, 0.44, 0.0),
    ], PEARL, 0.8, n=14, power=2.6, belly=(SATIN, 0.07))
    # The canopy: a long bubble of glass let into the back.
    h.body([
        (6.3, 0, 0, 0, 0.36),
        (5.5, 0.30, 0.24, 0.06, 0.44),
        (4.3, 0.50, 0.44, 0.06, 0.56),
        (3.0, 0.50, 0.44, 0.06, 0.64),
        (1.9, 0.34, 0.26, 0.05, 0.68),
        (1.1, 0, 0, 0, 0.70),
    ], GLASS, 0.0, n=10, power=2.2)

    def side_parts(side):
        # Crescent wings: broad at the root, swept back to a point like a swallow's.
        h.wing([
            (0.7, 0.02, 3.4, -3.6, 0.32),
            (2.2, 0.10, 2.2, -3.9, 0.25),
            (4.0, 0.16, 0.3, -4.3, 0.17),
            (5.7, 0.12, -2.0, -5.0, 0.11),
            (7.0, -0.04, -4.4, -6.2, 0.06),
            (7.8, -0.26, -6.6, -7.3, 0.02),
        ], PEARL, 0.8, side=side, edge=(CHROME, 0.0), under=(SATIN, 0.07))
        # Tail streamers.
        h.body([
            (-5.0, 0.26, 0.2, 0.2, 0.0, side * 0.72),
            (-7.0, 0.2, 0.16, 0.16, 0.02, side * 0.98),
            (-9.4, 0.12, 0.1, 0.1, 0.08, side * 1.42),
            (-11.6, 0.05, 0.04, 0.04, 0.16, side * 1.96),
            (-12.6, 0, 0, 0, 0.2, side * 2.24),
        ], PEARL, 0.8, n=6, power=2.0)
        # A canted fin over each streamer's root.
        fin = [(0.34, 0.74, -3.4, -6.4, 0.16), (1.2, 1.06, -5.0, -7.0, 0.1), (2.1, 1.42, -6.5, -7.6, 0.03)]
        h.wing([(z, y, le, te, t) for (z, y, le, te, t) in fin], PEARL, 0.8, side=side, vertical=True,
               edge=(CHROME, 0.0))
        h.nozzle((-6.84, side * 0.42, 0.0), (-1, 0, 0), 0.34, 0.5)
        h.lamp("port" if side > 0 else "starboard", (-6.5, side * 7.75, -0.24), 0.5)
        h.lamp("engine", (-7.1, side * 0.42, 0.0), 1.5, 0 if side > 0 else 1)

    h.mirror_y(side_parts)
    # The keel light: a seam of the sanctuary's colour under the belly.
    h.box((-2.6, -0.07, -0.5), (3.4, 0.07, -0.42), TRIM, 0.0)
    h.lamp("keel", (0.6, 0, -0.62), 1.3)
    h.lamp("nose", (8.9, 0, 0.02), 0.6)
    # Where its trail leaves it: between the two engines.
    h.engines.append((Vector((-7.0, 0, 0.0)), 0.5))
    return h


def build_manta():
    """The dark flying wing."""
    h = Hull("manta")
    sections = [
        (0.0, 0.0, 11.4, -9.0, 1.95),
        (2.6, 0.0, 10.4, -9.2, 1.8),
        (5.2, 0.08, 7.6, -8.7, 1.32),
        (9.2, 0.26, 3.6, -7.2, 0.8),
        (13.6, 0.42, -0.6, -6.6, 0.46),
        (17.8, 0.30, -4.8, -7.8, 0.24),
        (20.6, -0.36, -8.0, -9.8, 0.11),
        (22.0, -1.1, -10.2, -10.8, 0.03),
    ]

    def side_parts(side):
        h.wing(sections, SATIN, 0.05, side=side, chord=(0.0, 0.04, 0.16, 0.38, 0.66, 0.9, 1.0),
               edge=(CHROME, 0.0), cap_root=False, under=(SATIN, 0.035))
        # The brow's two horns.
        h.body([
            (8.6, 0.9, 0.55, 0.5, 0.05, side * 2.5),
            (11.2, 0.7, 0.42, 0.4, 0.0, side * 3.0),
            (13.6, 0.42, 0.26, 0.26, -0.12, side * 3.2),
            (15.4, 0.16, 0.1, 0.1, -0.3, side * 3.05),
            (16.2, 0, 0, 0, -0.42, side * 2.86),
        ], SATIN, 0.05, n=8, power=2.2)
        # A vein of light over the back, from the heart out to the tip.
        vein = []
        for (span, lift, le, te, t) in sections[1:-1]:
            c = 0.3
            x = lerp(le, te, c)
            top = lift + t * 2.6 * math.sqrt(c) * (1 - c)
            vein.append((x, side * span, top))
        for (p, q) in zip(vein, vein[1:]):
            w = 0.16
            a0 = Vector((p[0] + w, p[1], p[2] + 0.035))
            a1 = Vector((p[0] - w, p[1], p[2] + 0.035))
            b0 = Vector((q[0] + w, q[1], q[2] + 0.035))
            b1 = Vector((q[0] - w, q[1], q[2] + 0.035))
            made = [h.bm.faces.new([h.bm.verts.new(v) for v in (a0, b0, b1, a1)])]
            h._finish(made, TRIM, 0.0, outward=Vector((0, 0, 1)))
        # A second, shorter vein toward the trailing edge.
        vein2 = []
        for (span, lift, le, te, t) in sections[1:5]:
            c = 0.62
            x = lerp(le, te, c)
            top = lift + t * 2.6 * math.sqrt(c) * (1 - c)
            vein2.append((x, side * span, top))
        for (p, q) in zip(vein2, vein2[1:]):
            w = 0.1
            made = [h.bm.faces.new([h.bm.verts.new(Vector(v)) for v in (
                (p[0] + w, p[1], p[2] + 0.035), (q[0] + w, q[1], q[2] + 0.035),
                (q[0] - w, q[1], q[2] + 0.035), (p[0] - w, p[1], p[2] + 0.035))])]
            h._finish(made, TRIM, 0.0, outward=Vector((0, 0, 1)))
        h.lamp("corner", (-4.6, side * 13.0, 0.0), 2.2, 1 if side > 0 else 2)

    h.mirror_y(side_parts)
    # The tail spine.
    h.body([
        (-8.4, 0.5, 0.34, 0.3, 0.0),
        (-13.0, 0.3, 0.22, 0.2, 0.0),
        (-19.0, 0.16, 0.12, 0.12, 0.04),
        (-25.0, 0.06, 0.05, 0.05, 0.12),
        (-27.5, 0, 0, 0, 0.18),
    ], SATIN, 0.05, n=6, power=2.0)
    # A low blister of glass on the brow.
    h.body([
        (8.8, 0, 0, 0, 0.9),
        (7.6, 0.7, 0.34, 0.06, 1.12),
        (5.6, 1.0, 0.5, 0.06, 1.42),
        (3.6, 0.8, 0.36, 0.06, 1.6),
        (2.2, 0, 0, 0, 1.62),
    ], GLASS, 0.0, n=8, power=2.2)
    # Under it: a lamp toward each corner and the amber heart.
    h.disc((6.4, 0, -0.98), (0, 0, -1), 0.9, LAMP, 0.0, 10)
    h.disc((0.6, 0, -1.26), (0, 0, -1), 2.0, LAMP, 1.0, 14)
    h.lamp("corner", (6.4, 0, -1.3), 2.2, 0)
    h.lamp("core", (0.6, 0, -1.7), 4.2)
    # The engine: a slot of light along the trailing edge at the heart.
    made = [h.bm.faces.new([h.bm.verts.new(Vector(v)) for v in (
        (-9.06, -3.4, 0.14), (-9.06, 3.4, 0.14), (-9.06, 3.4, -0.1), (-9.06, -3.4, -0.1))])]
    h._finish(made, ENGINE, 0.0, outward=Vector((-1, 0, 0)))
    h.engines.append((Vector((-9.2, 0, 0.02)), 1.6))
    h.lamp("engine", (-9.3, 0, 0.02), 5.0)
    return h


def build_barge():
    """The hauler: a cab, a spine, two pontoons, six crystals of cargo."""
    h = Hull("barge")
    # The cab.
    cab = h.body([
        (16.6, 0, 0, 0, 0.5),
        (15.6, 1.0, 0.62, 0.5, 0.52),
        (13.8, 2.0, 1.2, 0.94, 0.5),
        (11.6, 2.5, 1.56, 1.2, 0.46),
        (9.4, 2.4, 1.5, 1.2, 0.4),
        (8.2, 1.6, 1.0, 0.9, 0.3),
    ], PEARL, 0.78, n=14, power=3.0, belly=(SATIN, 0.1))
    # Its window: the cab's own brow, glazed.
    for f in cab:
        c = f.calc_center_median()
        if 11.4 < c.x < 15.7 and c.z > 0.86 and f.normal.z < 0.93:
            f[h.surf] = GLASS
            f[h.param] = 0.0
    # The spine.
    h.box((-13.0, -0.6, -0.3), (8.6, 0.6, 0.6), SATIN, 0.2)
    h.box((-12.0, -0.22, 0.6), (7.0, 0.22, 0.84), CHROME, 0.0)
    # The engine block and its four fires.
    h.body([
        (-12.4, 2.0, 1.2, 1.1, 0.15),
        (-13.6, 2.9, 1.7, 1.5, 0.15),
        (-16.6, 3.0, 1.8, 1.6, 0.15),
        (-17.6, 2.6, 1.5, 1.4, 0.15),
    ], SATIN, 0.16, n=12, power=4.0, belly=(SATIN, 0.08))
    for (y, z) in ((1.3, 0.85), (-1.3, 0.85), (1.3, -0.55), (-1.3, -0.55)):
        h.nozzle((-17.62, y, z), (-1, 0, 0), 0.62, 0.6)
    h.lamp("engine", (-18.0, 1.3, 0.15), 2.6, 0)
    h.lamp("engine", (-18.0, -1.3, 0.15), 2.6, 1)
    # A mast.
    h.tube((10.4, 0, 1.9), (9.6, 0, 4.6), 0.09, 0.03, CHROME, 0.0, n=5)
    h.lamp("crown", (9.6, 0, 4.7), 0.7)

    def side_parts(side):
        # A pontoon.
        h.body([
            (9.6, 0, 0, 0, -0.5, side * 5.3),
            (8.0, 0.5, 0.42, 0.42, -0.5, side * 5.3),
            (4.0, 0.74, 0.62, 0.62, -0.5, side * 5.3),
            (-10.0, 0.74, 0.62, 0.62, -0.5, side * 5.3),
            (-14.4, 0.5, 0.42, 0.42, -0.5, side * 5.3),
            (-16.0, 0, 0, 0, -0.5, side * 5.3),
        ], CHROME, 0.0, n=8, power=2.2)
        for x in (5.6, -1.0, -9.4):
            h.strut((x, side * 0.5, 0.1), (x, side * 5.0, -0.4), 0.16, SATIN, 0.14)
        # Three crystals of cargo, each in its cradle.
        for i, x in enumerate((4.6, -1.6, -7.8)):
            h.bipyramid((x, side * 2.75, 0.34), (0, 0, 1), 2.5, 1.5, CRYSTAL, 0.0, sides=6)
            h.torus((x, side * 2.75, 0.34), (0, 0, 1), 1.66, 0.11, CHROME, 0.0, n_major=12, n_minor=3)
            h.lamp("cargo", (x, side * 2.75, 0.34), 3.4, i * 2 + (0 if side > 0 else 1))
        h.lamp("port" if side > 0 else "starboard", (9.5, side * 5.3, -0.5), 0.7)
        h.lamp("tail", (-15.9, side * 5.3, -0.5), 0.6, 0 if side > 0 else 1)

    h.mirror_y(side_parts)
    h.lamp("nose", (16.7, 0, 0.5), 0.9)
    h.engines.append((Vector((-18.0, 0, 0.15)), 1.8))
    return h


def build_saucer():
    """The classic disc: a chrome lens, a dark belt, a glass dome, an emitter under its belly."""
    h = Hull("saucer")
    dark = (SATIN, 0.05)
    profile = [
        (0.0, -1.34, LAMP, 0.0),
        (1.05, -1.3, SATIN, 0.05),
        (1.3, -1.06, CHROME, 0.0),
        (1.9, -0.94, *dark),
        (3.1, -0.8, CHROME, 0.0),
        (5.2, -0.48, CHROME, 0.0),
        (7.1, -0.1, *dark),
        (7.5, 0.0, *dark),
        (7.46, 0.16, CHROME, 0.0),
        (5.6, 0.54, CHROME, 0.0),
        (3.5, 0.9, PEARL, 0.8),
        (2.9, 1.0, *dark),
        (2.7, 1.14, GLASS, 0.0),
        (2.4, 1.76, GLASS, 0.0),
        (1.5, 2.3, GLASS, 0.0),
        (0.32, 2.56, CHROME, 0.0),
        (0.08, 3.3, CHROME, 0.0),
        (0.0, 3.36, CHROME, 0.0),
    ]
    h.revolve(profile, n=30)
    # Six blisters round its belly.
    for k in range(6):
        a = TAU * (k + 0.5) / 6
        h.sphere((4.1 * math.cos(a), 4.1 * math.sin(a), -0.58), 0.52, CHROME, 0.0, n=6, m=4)
    for i in range(12):
        a = TAU * i / 12
        h.lamp("rim", (7.36 * math.cos(a), 7.36 * math.sin(a), 0.03), 0.9, i)
    h.lamp("under", (0, 0, -1.6), 5.0)
    return h


def build_ark():
    """The great ship: a boat of the sky, keel-deep amidships with its bow and stern swept up, through a
    habitat ring, under three tall sails."""
    h = Hull("ark")
    stations = [
        (126, 0, 0, 0, 17.0),
        (118, 1.5, 1.3, 1.9, 13.4),
        (102, 4.8, 3.0, 5.8, 7.6),
        (80, 8.8, 4.2, 9.6, 3.2),
        (52, 11.8, 4.8, 12.6, 0.9),
        (16, 13.2, 5.0, 14.0, 0.0),
        (-20, 13.2, 5.0, 13.6, 0.0),
        (-52, 11.8, 4.8, 11.6, 1.1),
        (-78, 9.4, 4.4, 8.8, 3.6),
        (-96, 7.0, 4.0, 6.4, 7.0),
        (-107, 5.4, 3.6, 5.0, 9.6),
    ]
    h.body(stations, PEARL, 0.72, n=16, power=2.7, belly=(SATIN, 0.09))

    def hull_at(x):
        for (a, b) in zip(stations, stations[1:]):
            if b[0] <= x <= a[0]:
                k = (x - a[0]) / (b[0] - a[0])
                return [lerp(a[i], b[i], k) for i in range(5)]
        return list(stations[-1])

    # The deckhouse: a long low house on the back, glazed at its brow.
    house = h.body([
        (58, 0, 0, 0, 5.4),
        (52, 3.4, 2.0, 0.6, 5.6),
        (40, 5.4, 3.6, 0.6, 5.4),
        (-30, 5.4, 3.6, 0.6, 5.2),
        (-44, 3.6, 2.4, 0.6, 5.6),
        (-50, 0, 0, 0, 6.0),
    ], PEARL, 0.78, n=10, power=3.2)
    for f in house:
        c = f.calc_center_median()
        if c.x > 38 and c.z > 6.4:
            f[h.surf] = GLASS
            f[h.param] = 0.0
    # The habitat ring, with a seam of light on its inner rim, and its spokes.
    for (x, big, thick) in ((6, 34, 2.5), (-74, 19, 1.7)):
        cz = hull_at(x)[4] - 3.0
        h.torus((x, 0, cz), (1, 0, 0), big, thick, PEARL, 0.78, n_major=32, n_minor=6, squash=1.5)
        h.torus((x, 0, cz), (1, 0, 0), big - thick * 0.98, 0.34, TRIM, 0.0, n_major=32, n_minor=3)
        for k in range(4):
            a = TAU * (k + 0.5) / 4
            d = Vector((0, math.cos(a), math.sin(a)))
            h.strut(Vector((x, 0, cz)) + d * 8.0, Vector((x, 0, cz)) + d * (big - thick * 0.5), 0.8, SATIN, 0.16)
    # Three sails: tall blades of pearl, raked back.
    for i, (x, tall, base) in enumerate(((66, 30, 20), (14, 42, 26), (-42, 31, 21))):
        foot = hull_at(x)[4] + 4.0
        h.wing([
            (foot, 0.0, x + base * 0.5, x - base * 0.5, 0.9),
            (foot + tall * 0.55, 0.0, x + base * 0.2, x - base * 0.62, 0.6),
            (foot + tall, 0.0, x - base * 0.42, x - base * 0.74, 0.16),
        ], PEARL, 0.8, side=1, vertical=True, edge=(CHROME, 0.0))
        h.lamp("crown", (x - base * 0.58, 0, foot + tall + 0.6), 3.2, i)
    # A keel fin under the stern.
    h.wing([(-9.0, 0.0, -52, -92, 1.3), (-21, 0.0, -72, -98, 0.4)], SATIN, 0.1, side=1, vertical=True)
    # Three engines in the stern.
    for (y, z) in ((0, 12.2), (3.0, 8.0), (-3.0, 8.0)):
        h.nozzle((-107.2, y, z), (-1, 0, 0), 2.2, 2.6, n=12)
    h.engines.append((Vector((-109, 0, 9.6)), 6.4))
    h.lamp("engine", (-109.5, 0, 9.6), 18.0)
    # A row of lit windows down each flank, and the beacons.
    for side in (1, -1):
        for k in range(10):
            x = 84 - k * 17.0
            st = hull_at(x)
            h.lamp("window", (x, side * st[1] * 0.93, st[4] - st[3] * 0.34), 3.4, k)
    h.lamp("nose", (126.6, 0, 17.0), 6.0)
    h.lamp("tail", (-108, 0, 14.4), 5.0)
    return h


def build_hoop():
    """A ring that carries a crystal: an upright hoop, a cut stone floating at its centre."""
    h = Hull("hoop")
    h.torus((0, 0, 0), (0, 1, 0), 9.0, 1.05, PEARL, 0.8, n_major=36, n_minor=6, squash=0.82)
    h.torus((0, 0, 0), (0, 1, 0), 7.94, 0.16, TRIM, 0.0, n_major=36, n_minor=3)
    h.torus((0, 0, 0), (0, 1, 0), 10.02, 0.2, CHROME, 0.0, n_major=36, n_minor=3)
    h.bipyramid((0, 0, 0), (0, 0, 1), 4.4, 1.9, CRYSTAL, 0.0, sides=6)
    # Three pods on the rim: the crown, and two feet.
    for i, deg in enumerate((90, 215, 325)):
        a = math.radians(deg)
        c = Vector((math.cos(a) * 10.3, 0, math.sin(a) * 10.3))
        out = Vector((math.cos(a), 0, math.sin(a)))
        tangent = Vector((-math.sin(a), 0, math.cos(a)))
        rings = []
        for (s, r) in ((-2.6, 0.0), (-1.8, 0.62), (0.0, 0.9), (1.8, 0.62), (2.6, 0.0)):
            p = c + tangent * s
            if r <= 0:
                rings.append([p])
            else:
                rings.append([p + (out * math.cos(TAU * k / 8) + Vector((0, 1, 0)) * math.sin(TAU * k / 8)) * r
                              for k in range(8)])
        h.loft(rings, SATIN, 0.07)
        h.lamp("crown", c + out * 1.1, 1.5, i)
    h.lamp("core", (0, 0, 0), 5.6)
    return h


def build_capsule():
    h = Hull("capsule")
    radius, half = 2.4, 4.1
    stations = []
    for k in range(7):
        a = (k / 6) * (math.pi / 2)
        stations.append((-half - radius * math.cos(a), radius * math.sin(a)))
    for k in range(7):
        a = (k / 6) * (math.pi / 2)
        stations.append((half + radius * math.sin(a), radius * math.cos(a)))
    h.body([(x, r, r, r, 0.0) if r > 1e-6 else (x, 0, 0, 0, 0.0) for (x, r) in reversed(stations)],
           MATTE, 0.8, n=20, power=2.0)
    return h


def build_orb():
    h = Hull("orb")
    h.sphere((0, 0, 0), 1.1, ORB, 0.0, n=14, m=9)
    h.lamp("orb", (0, 0, 0), 4.2)
    return h


BUILDERS = [build_saucer, build_swift, build_manta, build_barge, build_ark, build_hoop, build_capsule, build_orb]


# ── Bake: triangles, smoothed normals, occlusion ───────────────────────────────


def bake(hull):
    """Triangulate; per corner a normal smoothed over the faces flatter than SMOOTH_ANGLE; AO per vertex."""
    bm = hull.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    surf = hull.surf
    param = hull.param
    size = max((v.co.length for v in bm.verts), default=1.0)

    tree = BVHTree.FromBMesh(bm)
    cos_limit = math.cos(SMOOTH_ANGLE)
    # Fixed directions over a hemisphere (a spiral): the same rays every run.
    rays = []
    count = 28
    for i in range(count):
        z = (i + 0.5) / count
        r = math.sqrt(max(0.0, 1 - z * z))
        a = i * 2.399963229728653
        rays.append((r * math.cos(a), r * math.sin(a), z))

    def occlusion(point, normal):
        ref = Vector((0, 0, 1)) if abs(normal.z) < 0.9 else Vector((1, 0, 0))
        e1 = normal.cross(ref).normalized()
        e2 = normal.cross(e1)
        start = point + normal * (size * 0.002 + 0.01)
        reach = size * 0.3
        open_sky = 0.0
        total = 0.0
        for (x, y, z) in rays:
            d = e1 * x + e2 * y + normal * z
            hit = tree.ray_cast(start, d, reach)
            total += z
            if hit[0] is None:
                open_sky += z
            else:
                open_sky += z * min(1.0, (hit[3] / reach)) ** 0.5 * 0.6
        return open_sky / total

    vertices = []
    lookup = {}
    index = []
    for face in bm.faces:
        if face.calc_area() < 1e-9:
            continue
        for loop in face.loops:
            v = loop.vert
            n = Vector((0, 0, 0))
            for other in v.link_faces:
                if other.normal.dot(face.normal) >= cos_limit and other[surf] == face[surf]:
                    n += other.normal * other.calc_area()
            if n.length < 1e-9:
                n = face.normal.copy()
            n.normalize()
            key = (v.index, round(n.x, 3), round(n.y, 3), round(n.z, 3), face[surf], round(face[param], 3))
            at = lookup.get(key)
            if at is None:
                at = len(vertices)
                lookup[key] = at
                vertices.append({
                    "p": v.co.copy(), "n": n, "surf": face[surf], "param": face[param],
                    "ao": occlusion(v.co, n),
                })
            index.append(at)
    return vertices, index


def to_game(p):
    """Blender (x nose, y port, z up) to the game (x nose, y up, z starboard)."""
    return (p.x, p.z, -p.y)


def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def write_module(path, built):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Halcyon Apex's skyfarers: GENERATED by scripts/blender/halcyon_apex_fleet.py (do not edit by hand).",
        " *",
        " * Eight hulls modelled in Blender. Game frame: x the nose, y up, z starboard; metres. Per hull:",
        " * `positions` Int16 in units of `quant` metres; `normals` Int8 (unit * 127); `parts` Uint8",
        " * (surface, param * 255, occlusion * 255, 0); `index` Uint16 triangles; `lamps` rows of",
        " * (group, x, y, z, size, index) with `group` an index into `lampGroups`; `engines` rows of",
        " * (x, y, z, radius): where an exhaust trail leaves the hull.",
        " */",
        "export const HALCYON_FLEET = Object.freeze({",
        f"    lampGroups: {LAMP_GROUPS!r},".replace("'", '"'),
        "    hulls: Object.freeze({",
    ]
    for (hull, vertices, index) in built:
        pts = [to_game(v["p"]) for v in vertices]
        reach = max(max(abs(c) for c in p) for p in pts)
        quant = max(1e-4, math.ceil(reach / 32000 * 1e5) / 1e5)
        positions = []
        normals = []
        parts = []
        for v, p in zip(vertices, pts):
            positions += [int(round(c / quant)) for c in p]
            n = to_game(v["n"])
            normals += [max(-127, min(127, int(round(c * 127)))) for c in n]
            parts += [v["surf"], max(0, min(255, int(round(v["param"] * 255)))),
                      max(0, min(255, int(round(v["ao"] * 255)))), 0]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        zs = [p[2] for p in pts]
        lamps = []
        for (group, at, size, idx) in hull.lamps:
            g = to_game(at)
            lamps.append([LAMP_GROUPS.index(group), round(g[0], 3), round(g[1], 3), round(g[2], 3), size, idx])
        engines = []
        for (at, radius) in hull.engines:
            g = to_game(at)
            engines.append([round(g[0], 3), round(g[1], 3), round(g[2], 3), radius])
        lines += [
            f"        {hull.name}: Object.freeze({{",
            f"            quant: {quant},",
            f"            vertexCount: {len(vertices)},",
            f"            triangleCount: {len(index) // 3},",
            f"            min: [{min(xs):.3f}, {min(ys):.3f}, {min(zs):.3f}],",
            f"            max: [{max(xs):.3f}, {max(ys):.3f}, {max(zs):.3f}],",
            f"            lamps: {lamps!r},",
            f"            engines: {engines!r},",
            f"            positions: '{b64('h', positions)}',",
            f"            normals: '{b64('b', normals)}',",
            f"            parts: '{b64('B', parts)}',",
            f"            index: '{b64('H', index)}',",
            "        }),",
        ]
    lines += ["    }),", "});", ""]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(TAG, "wrote", path, Path(path).stat().st_size, "bytes")


# ── Previews ───────────────────────────────────────────────────────────────────

PREVIEW_COLOURS = {
    CHROME: (0.78, 0.8, 0.84), SATIN: (0.12, 0.13, 0.16), MATTE: (0.55, 0.57, 0.6), GLASS: (0.25, 0.5, 0.62),
    LAMP: (1.0, 0.95, 0.7), ORB: (1.0, 0.9, 0.6), PEARL: (0.9, 0.88, 0.84), ENGINE: (0.2, 0.95, 1.0),
    TRIM: (0.2, 1.0, 0.9), CRYSTAL: (0.3, 0.9, 0.85),
}


def previews(built, out_dir):
    """Workbench renders of every hull: from below and ahead (how the lagoon sees it), top and side."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.data.scenes.new("HalcyonFleet")
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_specular_highlight = True
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("HalcyonFleetWorld")
    world.color = (0.42, 0.5, 0.62)
    scene.world = world
    scene.render.resolution_x = 900
    scene.render.resolution_y = 560
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88
    materials = {}
    for key, colour in PREVIEW_COLOURS.items():
        m = bpy.data.materials.new(f"HalcyonFleet{key}")
        m.diffuse_color = (*colour, 1.0)
        m.metallic = 0.0
        m.roughness = 0.25 if key in (CHROME, GLASS, PEARL, CRYSTAL) else 0.7
        materials[key] = m
    cam_data = bpy.data.cameras.new("HalcyonFleetCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("HalcyonFleetCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for (hull, vertices, index) in built:
        mesh = bpy.data.meshes.new(f"HalcyonFleet_{hull.name}")
        mesh.from_pydata([tuple(v["p"]) for v in vertices], [], [tuple(index[i:i + 3]) for i in range(0, len(index), 3)])
        for key in sorted(materials):
            mesh.materials.append(materials[key])
        for poly in mesh.polygons:
            poly.material_index = vertices[poly.vertices[0]]["surf"]
            poly.use_smooth = True
        mesh.update()
        try:
            mesh.normals_split_custom_set_from_vertices([tuple(v["n"]) for v in vertices])
        except Exception as error:  # pragma: no cover - preview only
            print(TAG, "custom normals not set:", error)
        obj = bpy.data.objects.new(f"HalcyonFleet_{hull.name}", mesh)
        scene.collection.objects.link(obj)
        size = max(v["p"].length for v in vertices)
        views = {
            "below": Vector((0.62, -0.7, -0.42)),
            "above": Vector((0.5, -0.62, 0.6)),
            "side": Vector((0.0, -1.0, 0.04)),
            "top": Vector((0.0, -0.001, 1.0)),
        }
        for name, direction in views.items():
            d = direction.normalized()
            cam.location = d * (size * 4)
            cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
            cam_data.ortho_scale = size * 2.3
            cam_data.clip_end = size * 12
            scene.render.filepath = str(out / f"{hull.name}-{name}.jpg")
            bpy.ops.render.render(write_still=True, scene=scene.name)
        obj.hide_render = True
    print(TAG, "previews in", out)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    only = None
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        elif a == "--preview":
            preview_dir = argv[i + 1]
        elif a == "--only":
            only = argv[i + 1].split(",")
    built = []
    for build in BUILDERS:
        hull = build()
        if only and hull.name not in only:
            continue
        vertices, index = bake(hull)
        print(TAG, hull.name, len(vertices), "vertices", len(index) // 3, "triangles", len(hull.lamps), "lamps")
        built.append((hull, vertices, index))
    if out:
        write_module(out, built)
    if preview_dir:
        previews(built, preview_dir)


if __name__ == "__main__":
    main()
