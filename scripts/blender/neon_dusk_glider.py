"""Neon Dusk's glider: the craft that flies out of the sun in a flight of five, modelled in Blender.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/neon_dusk_glider.py -- \
        --out src/themes/neon-dusk/neon-dusk-glider-model.js [--preview <dir>]

One hull, built for how the dusk sees it: head-on and from below, 20 to 250 px across, as a dark
shape with one neon line along every edge that turns. So it is drawn in flat facets and its
silhouette comes first:

    a needle body of six-sided sections, 13 m, with a faceted canopy
    a swept delta wing, 13 m across, thinning to tips that droop, each tip turned up in a winglet
    two tail fins canted outward
    an engine face at the tail

Blender's frame while modelling: x the nose, y port, z up, metres. The game's frame (what the
module holds): x the nose, y up, z starboard.

The export is plain triangles (no index). Each corner carries its place, its facet's normal, and
an EDGE code: three numbers, one for each side of its triangle, 0 at the corner opposite a side
that is drawn and held at 1 across a side that is not (a seam between two faces that lie flat
together, a triangulation's own diagonal). The fragment stage reads the least of the three as
its distance to the nearest drawn edge, so every line of light is one of the hull's real creases.
A fourth number says what the face is: 0 hull, 1 canopy, 2 engine.

Deterministic: the same script writes the same file.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

TAG = "[neon-dusk-glider]"
HULL, CANOPY, ENGINE = 0, 1, 2
# Two faces that meet flatter than this share no drawn edge.
CREASE = math.radians(9)


def section(x, half_w, half_h, z=0.0, belly=0.55):
    """A six-sided body section at station x: a flattened hexagon, its belly shallower than its back."""
    return [
        Vector((x, half_w, z)),
        Vector((x, half_w * 0.5, z + half_h)),
        Vector((x, -half_w * 0.5, z + half_h)),
        Vector((x, -half_w, z)),
        Vector((x, -half_w * 0.5, z - half_h * belly)),
        Vector((x, half_w * 0.5, z - half_h * belly)),
    ]


def build():
    bm = bmesh.new()
    kind = bm.faces.layers.int.new("kind")

    def face(points, what=HULL):
        verts = [bm.verts.new(p) for p in points]
        f = bm.faces.new(verts)
        f[kind] = what
        return f

    def loft(a, b, what=HULL):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            face([a[i], a[j], b[j], b[i]], what)

    # ── the body: a needle of six-sided sections ──
    nose = Vector((6.6, 0.0, -0.05))
    stations = [
        section(4.4, 0.34, 0.26),
        section(1.2, 0.78, 0.5),
        section(-2.6, 0.84, 0.52),
        section(-5.2, 0.56, 0.4, z=0.06),
        section(-6.4, 0.4, 0.3, z=0.1),
    ]
    first = stations[0]
    for i in range(6):
        face([nose, first[(i + 1) % 6], first[i]])
    for a, b in zip(stations, stations[1:]):
        loft(b, a)
    face(list(reversed(stations[-1])), ENGINE)

    # ── the canopy: a faceted blister on the back ──
    back = lambda x: Vector((x, 0.0, 0.0))
    c0 = Vector((3.9, 0.0, 0.3))
    c1l, c1r = Vector((2.4, 0.3, 0.52)), Vector((2.4, -0.3, 0.52))
    cp = Vector((1.9, 0.0, 0.98))
    c2l, c2r = Vector((0.4, 0.36, 0.56)), Vector((0.4, -0.36, 0.56))
    c3 = Vector((-0.6, 0.0, 0.56))
    face([c0, c1l, cp], CANOPY)
    face([c0, cp, c1r], CANOPY)
    face([c1l, c2l, cp], CANOPY)
    face([cp, c2r, c1r], CANOPY)
    face([c2l, c3, cp], CANOPY)
    face([cp, c3, c2r], CANOPY)
    _ = back

    # ── the wings, the winglets and the fins, a side at a time ──
    for side in (1, -1):
        def p(x, y, z):
            return Vector((x, y * side, z))

        def tri(a, b, c, what=HULL):
            face([a, b, c] if side > 0 else [a, c, b], what)

        def quad(a, b, c, d, what=HULL):
            face([a, b, c, d] if side > 0 else [a, d, c, b], what)

        # The wing: a diamond section from root to tip (leading edge, crest, trailing edge, keel).
        r_le, r_te = p(2.9, 0.7, 0.0), p(-5.0, 0.7, 0.02)
        r_up, r_dn = p(-1.2, 0.7, 0.26), p(-1.2, 0.7, -0.2)
        t_le, t_te = p(-4.3, 6.4, -0.52), p(-5.6, 6.4, -0.5)
        t_up, t_dn = p(-4.9, 6.4, -0.44), p(-4.9, 6.4, -0.56)
        quad(r_le, t_le, t_up, r_up)
        quad(r_up, t_up, t_te, r_te)
        quad(r_le, r_dn, t_dn, t_le)
        quad(r_dn, r_te, t_te, t_dn)
        # The winglet: the tip turned up and back.
        w_le, w_te = p(-5.2, 6.75, 0.62), p(-6.0, 6.75, 0.62)
        quad(t_le, w_le, w_te, t_te)
        tri(t_le, t_up, t_te)
        tri(t_le, t_te, t_dn)
        # A tail fin, canted outward: a thin wedge.
        f_le, f_te = p(-3.0, 0.5, 0.42), p(-5.9, 0.5, 0.42)
        f_tl, f_tt = p(-5.3, 1.55, 2.05), p(-6.3, 1.55, 2.05)
        f_in = p(-4.6, 0.36, 0.42)
        quad(f_le, f_tl, f_tt, f_te)
        quad(f_le, f_in, f_tt, f_tl)
        tri(f_in, f_te, f_tt)

    bm.normal_update()
    return bm, kind


def export(bm, kind):
    """Plain triangles with their edge codes: (positions, normals, edges, kinds)."""
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    # Weld by place, so two faces that meet share their edge.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    bm.edges.ensure_lookup_table()

    drawn = set()
    for e in bm.edges:
        faces = e.link_faces
        if len(faces) != 2:
            drawn.add(frozenset((e.verts[0].index, e.verts[1].index)))
            continue
        if faces[0][kind] != faces[1][kind] or faces[0].normal.angle(faces[1].normal, 0.0) > CREASE:
            drawn.add(frozenset((e.verts[0].index, e.verts[1].index)))

    positions, normals, edges, kinds = [], [], [], []
    for f in bm.faces:
        ring = list(f.verts)
        n = f.normal
        # A fan from the first corner: fine for these convex faces.
        for i in range(1, len(ring) - 1):
            tri = [ring[0], ring[i], ring[i + 1]]
            # Side k is the one opposite corner k.
            shown = [
                frozenset((tri[1].index, tri[2].index)) in drawn,
                frozenset((tri[2].index, tri[0].index)) in drawn,
                frozenset((tri[0].index, tri[1].index)) in drawn,
            ]
            for k, v in enumerate(tri):
                positions.append(v.co.copy())
                normals.append(n.copy())
                code = [1.0, 1.0, 1.0]
                for side in range(3):
                    if shown[side]:
                        code[side] = 0.0 if side != k else 1.0
                    else:
                        code[side] = 1.0
                edges.append(code)
                kinds.append(f[kind])
    return positions, normals, edges, kinds


def to_game(v):
    """Blender (x nose, y port, z up) → the game (x nose, y up, z starboard)."""
    return (v.x, v.z, -v.y)


def fmt(values, digits=3):
    return ", ".join(f"{round(x, digits):g}" for x in values)


def write_module(path, positions, normals, edges, kinds):
    span = max(abs(p.y) for p in positions) * 2
    length = max(p.x for p in positions) - min(p.x for p in positions)
    flat_p = [c for p in positions for c in to_game(p)]
    flat_n = [c for n in normals for c in to_game(n)]
    flat_e = [c for e in edges for c in e]
    text = f'''// @ts-check
/* eslint-disable max-len */
/**
 * Neon Dusk — the glider's hull. GENERATED by scripts/blender/neon_dusk_glider.py (headless
 * Blender): edit the script and run it again, never this file.
 *
 * Plain triangles, no index. Frame: x the nose, y up, z starboard, metres. `edge` holds three
 * numbers a corner: the least of them, read in the fragment stage, is the distance to the nearest
 * DRAWN edge of the hull (a crease, a rim), 1 across a side that is not drawn. `kind` says what
 * the face is: 0 hull, 1 canopy, 2 engine.
 */

/** The hull's wingspan and length (metres) and its corner count. */
export const GLIDER = Object.freeze({{ span: {span:g}, length: {length:g}, corners: {len(positions)} }});

export const GLIDER_POSITION = new Float32Array([{fmt(flat_p)}]);

export const GLIDER_NORMAL = new Float32Array([{fmt(flat_n)}]);

export const GLIDER_EDGE = new Float32Array([{fmt(flat_e, 0)}]);

export const GLIDER_KIND = new Float32Array([{fmt(kinds, 0)}]);
'''
    Path(path).write_text(text, encoding="utf-8", newline="\n")
    print(TAG, "wrote", path, len(positions), "corners,", len(positions) // 3, "triangles")


def preview(bm, out_dir):
    """Three flat renders of the hull (workbench): from below-ahead, head-on and from the side."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # The factory scene's own cube, lamp and camera are not the glider's.
    for stray in list(bpy.data.objects):
        bpy.data.objects.remove(stray, do_unlink=True)
    mesh = bpy.data.meshes.new("glider")
    bm.to_mesh(mesh)
    obj = bpy.data.objects.new("glider", mesh)
    scene = bpy.context.scene
    scene.collection.objects.link(obj)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 600
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_object_outline = True
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.16, 0.1, 0.3)
    scene.world = bpy.data.worlds.new("w")
    scene.world.color = (0.5, 0.25, 0.4)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 70
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, at in (("below", (26, 9, -9)), ("ahead", (34, 0.5, -2.5)), ("side", (2, 30, 3)), ("above", (14, 12, 20))):
        cam.location = Vector(at)
        look = Vector((0, 0, 0)) - cam.location
        cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(out / f"glider-{name}.png")
        bpy.ops.render.render(write_still=True)
    print(TAG, "previews in", out)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    prev = None
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]
            i += 2
        elif argv[i] == "--preview":
            prev = argv[i + 1]
            i += 2
        else:
            i += 1
    bm, kind = build()
    positions, normals, edges, kinds = export(bm, kind)
    drawn_tris = len(positions) // 3
    print(TAG, drawn_tris, "triangles")
    if out:
        write_module(out, positions, normals, edges, kinds)
    if prev:
        preview(bm, prev)
    bm.free()


if __name__ == "__main__":
    main()
