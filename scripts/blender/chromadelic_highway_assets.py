"""
Chromadelic Highway — Sculpted 3D Monolithic Aero-Wing Pillars & Curb Winglets (Blender 5.2+ headless).

Sculpts sleek, high-precision futuristic architecture worthy of a chromadelic prism highway:

  1. PYLON (paired left/right per neon arch at exact ring-lattice Z):
       - Flush Aero Wing-Root (x = 99..114, y = -2.5..+1.6): razor-sleek low-profile fairing
         gliding seamlessly out from the side edge of the highway deck (zero clunky road bricks).
       - Monolithic 24-Segment Swept Gull-Wing Blade (x = 100..257): butter-smooth single sculpted
         aerodynamic foil sweeping gently out and curving cleanly up into the neon arch foot,
         dynamically scaled in the vertex shader via `shapeFactor` so it fits Circle (258),
         Hexagon (241), AND Octagon (250) rings to the exact pixel!
       - Compact Precision Emitter Cradle (x = 250..261, y = -10..+16): sleek magnetic bezel cup
         hugging the outer-lower tangent of the arch without cutting dark chunks across the neon
         or sticking out past polygon corners.
       - Twin Embedded Plasma Conduits (`kind = 1`): continuous glowing energy veins flowing from
         the highway curb rail along the upper ridge & front leading edge right into the arch foot.
       - Flush Emitter Prism Lens (`kind = 2`): sculpted diamond projector node seated inside the
         emitter cup where the neon arch ignites.

  2. CHEVRON (sleek floating curb speed-winglets tucked just outside the outer rails):
       - Razor-thin forward-swept aero fin (x = 103.5..113.5, y = -1.2..+3.2, z = -14..+12) skimming
         alongside the holographic curb with a crisp luminous leading blade (`kind = 1`).
"""

import argparse
import math
import os
import sys
import bpy
import bmesh
from mathutils import Vector, Euler


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--preview", default="")
    return p.parse_args(argv)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def add_loft(bm, sections, rings_closed=True, cap_start=True, cap_end=True, kind=0):
    """Loft a watertight mesh along rings of 3D Vectors (all same length)."""
    n_rings = len(sections)
    n_pts = len(sections[0])
    ring_verts = [[bm.verts.new(p) for p in ring] for ring in sections]

    for i in range(n_rings - 1):
        r0 = ring_verts[i]
        r1 = ring_verts[i + 1]
        for j in range(n_pts):
            jn = (j + 1) % n_pts
            if not rings_closed and jn == 0:
                continue
            try:
                f = bm.faces.new((r0[j], r0[jn], r1[jn], r1[j]))
                f.material_index = kind
            except ValueError:
                pass

    if cap_start and n_pts >= 3:
        try:
            f = bm.faces.new(list(reversed(ring_verts[0])))
            f.material_index = kind
        except ValueError:
            pass
    if cap_end and n_pts >= 3:
        try:
            f = bm.faces.new(ring_verts[-1])
            f.material_index = kind
        except ValueError:
            pass


def loft_along_spine(bm, spine, profile_2d, scales=None, kind=0):
    """Loft a 2D (normal_xy, z) cross-section along a 3D spine using smooth orthonormal frames."""
    n = len(spine)
    sections = []
    v_dir = Vector((0.0, 0.0, 1.0))
    for i, pt in enumerate(spine):
        if i == 0:
            tang = (spine[1] - spine[0]).normalized()
        elif i == n - 1:
            tang = (spine[-1] - spine[-2]).normalized()
        else:
            tang = (spine[i + 1] - spine[i - 1]).normalized()
        u_dir = v_dir.cross(tang)
        if u_dir.length < 1e-4:
            u_dir = Vector((0.0, 1.0, 0.0))
        else:
            u_dir.normalize()
        sx, sz = scales[i] if scales else (1.0, 1.0)
        ring = [pt + u_dir * (px * sx) + v_dir * (pz * sz) for (px, pz) in profile_2d]
        sections.append(ring)
    add_loft(bm, sections, True, True, True, kind=kind)


def add_faceted_prism(bm, center, rx, ry, rz, rot_euler=(0.0, 0.0, 0.0), kind=2):
    """Add a sleek 6-sided diamond emitter prism."""
    R = Euler(rot_euler, "XYZ").to_matrix()
    c = Vector(center)
    top = bm.verts.new(c + R @ Vector((0.0, ry, 0.0)))
    bot = bm.verts.new(c + R @ Vector((0.0, -ry, 0.0)))
    ring = [
        bm.verts.new(c + R @ Vector((math.cos(k * math.tau / 6.0) * rx, 0.0, math.sin(k * math.tau / 6.0) * rz)))
        for k in range(6)
    ]
    for k in range(6):
        kn = (k + 1) % 6
        f1 = bm.faces.new((top, ring[k], ring[kn]))
        f1.material_index = kind
        f2 = bm.faces.new((bot, ring[kn], ring[k]))
        f2.material_index = kind


def build_pylon():
    """
    Build right-side (+X) Monolithic Sculpted Aero-Wing Pillar.
    Smooth 24-segment gull-wing foil gliding flush from highway edge (x=99, y=-0.8) out to a
    compact magnetic emitter cradle at the exact neon arch foot (x=258.5, y=0..15).
    """
    bm = bmesh.new()

    # 1. Monolithic 24-segment Swept Gull-Wing Foil (razor-sleek diamond airfoil cross-section)
    # Profile (u = vertical thickness perpendicular to spine, z = highway depth)
    foil_prof = [
        (-2.2, -5.2), (0.0, -11.5), (2.2, -4.5),
        (2.8, 0.0),
        (2.2, 4.5), (0.0, 11.5), (-2.2, 5.2),
        (-2.9, 0.0),
    ]
    wing_spine = []
    wing_scales = []
    n_seg = 24
    for i in range(n_seg):
        t = i / (n_seg - 1)
        x = 99.5 + t * 158.0  # 99.5 (flush curb root) -> 257.5 (arch foot)
        # Graceful gull-wing S-curve: exits flush from curb, dips softly to -6.5, lifts smoothly into arch foot!
        y = -0.8 - 6.8 * math.sin(t * math.pi) + 2.8 * (t ** 2.2)
        # Swept-back aerodynamic planform along -Z (forward into the tunnel)
        z = -13.5 * math.sin(t * math.pi * 0.58)
        wing_spine.append(Vector((x, y, z)))

        # Wide muscular fairing at curb root tapering gracefully into a razor-sleek outer wing,
        # then flaring subtly into the emitter housing at the tip!
        root_flare = math.exp(-((t / 0.14) ** 2))
        tip_flare = math.exp(-(((1.0 - t) / 0.12) ** 2))
        thick = 0.68 + 0.58 * root_flare + 0.34 * tip_flare
        chord = 0.62 + 0.85 * root_flare + 0.25 * tip_flare
        wing_scales.append((thick, chord))
    loft_along_spine(bm, wing_spine, foil_prof, wing_scales, kind=0)

    # 2. Compact Precision Magnetic Emitter Cradle hugging the lower outer tangent of the arch
    # Strictly compact (theta = -9.5 deg .. +3.5 deg) so it frames the neon foot cleanly without
    # sticking dark chunks up over the glowing arch!
    cradle_prof = [
        (-2.6, -4.4), (0.8, -6.8), (2.8, -3.6),
        (2.8, 3.6), (0.8, 6.8), (-2.6, 4.4),
    ]
    cradle_spine = []
    cradle_scales = []
    c_steps = 11
    for i in range(c_steps):
        t = i / (c_steps - 1)
        deg = -9.8 + t * 13.8  # -9.8 deg to +4.0 deg around centerY=25, r=260
        rad = math.radians(deg)
        # Seated cleanly just OUTSIDE r=260 (r=261.2) so the neon light glows unobstructed in front/inside!
        rx = 261.2 * math.cos(rad)
        ry = 25.0 + 261.2 * math.sin(rad)
        rz = -13.2 + (t - 0.35) * 2.2
        cradle_spine.append(Vector((rx, ry, rz)))
        env = math.sin(t * math.pi)
        cradle_scales.append((0.22 + 0.82 * env, 0.26 + 0.78 * env))
    loft_along_spine(bm, cradle_spine, cradle_prof, cradle_scales, kind=0)

    # 3. Primary Recessed Upper Neon Energy Vein (`kind = 1`) conducting rail light straight into the arch!
    vein_prof = [(-0.75, -1.2), (0.75, -1.2), (0.75, 1.2), (-0.75, 1.2)]
    upper_vein = [p + Vector((0.0, 2.25 * wing_scales[i][0] * 0.92, 0.0)) for i, p in enumerate(wing_spine)]
    upper_scales = [(0.82, 0.65 + 0.35 * (1.0 - i / (n_seg - 1))) for i in range(n_seg)]
    loft_along_spine(bm, upper_vein, vein_prof, upper_scales, kind=1)

    # 4. Crisp Leading-Edge Razor Light-Blade (`kind = 1`) facing the camera (+Z) for unmistakable sleek speed!
    lead_vein = [p + Vector((0.0, 0.0, 10.6 * wing_scales[i][1])) for i, p in enumerate(wing_spine[1:])]
    lead_scales = [(0.62, 0.55) for _ in lead_vein]
    loft_along_spine(bm, lead_vein, vein_prof, lead_scales, kind=1)

    # Inner glowing plasma channel inside the compact emitter cradle (`kind = 1`)
    cradle_glow = []
    for i in range(1, c_steps - 1):
        t = i / (c_steps - 1)
        rad = math.radians(-9.8 + t * 13.8)
        cradle_glow.append(Vector((258.6 * math.cos(rad), 25.0 + 258.6 * math.sin(rad), -13.2 + (t - 0.35) * 2.2)))
    loft_along_spine(bm, cradle_glow, vein_prof, [(0.85, 0.85) for _ in cradle_glow], kind=1)

    # 5. Flush Glowing Diamond Emitter Lens (`kind = 2`) where the wing kisses the neon arch foot!
    add_faceted_prism(
        bm,
        center=(257.6, 2.2, -12.6),
        rx=2.8,
        ry=6.2,
        rz=3.0,
        rot_euler=(0.0, 0.0, -0.08),
        kind=2,
    )

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    return bm


def build_chevron():
    """
    Build razor-sleek floating aerodynamic curb speed-winglet (+X side, tucked cleanly OUTSIDE
    the outer holographic rail at x=104..113.5 so it never bumps or occludes the neon curb!).
    """
    bm = bmesh.new()

    # Smooth 8-segment swept micro-winglet gliding alongside the rail
    fin_prof = [
        (-1.2, -1.6), (0.8, -2.1), (1.8, -0.6),
        (1.8, 0.6), (0.8, 2.1), (-1.2, 1.6),
    ]
    z_pts = [
        (Vector((104.2, 0.0, 12.0)), (0.20, 0.20)),
        (Vector((106.5, 1.0, 6.0)), (0.75, 0.68)),
        (Vector((108.8, 2.1, -1.0)), (0.92, 0.82)),
        (Vector((109.6, 2.5, -7.5)), (0.72, 0.65)),
        (Vector((105.0, 0.6, -15.0)), (0.18, 0.18)),
    ]
    sections = [[Vector((pt.x + px * sx, pt.y + py * sy, pt.z)) for (px, py) in fin_prof] for pt, (sx, sy) in z_pts]
    add_loft(bm, sections, True, True, True, kind=0)

    # Luminous leading razor energy-blade (`kind = 1`) skimming along the upper outer winglet crest
    blade_prof = [(-0.45, -0.5), (0.45, -0.5), (0.45, 0.5), (-0.45, 0.5)]
    b_sections = []
    for pt, (sx, sy) in [
        (Vector((105.5, 0.8, 9.5)), (0.4, 0.4)),
        (Vector((108.2, 2.2, 2.5)), (0.8, 0.8)),
        (Vector((110.2, 3.1, -5.0)), (0.85, 0.85)),
        (Vector((106.2, 1.1, -13.0)), (0.35, 0.35)),
    ]:
        b_sections.append([Vector((pt.x + px * sx, pt.y + py * sy, pt.z)) for (px, py) in blade_prof])
    add_loft(bm, b_sections, True, True, True, kind=1)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    return bm


def extract_arrays(bm):
    """Extract non-indexed triangle soup with smooth/flat normals, barycentric edge distances, and kind."""
    pos = []
    nrm = []
    edge = []
    kind = []
    # Smooth vertex normals per material kind so our curved 24-segment obsidian chrome wing shades like silk!
    bm.verts.ensure_lookup_table()
    for f in bm.faces:
        if len(f.verts) != 3:
            continue
        k = float(f.material_index)
        for idx, v in enumerate(f.verts):
            # Blend smooth vertex normal (70%) + face normal (30%) for crisp beveled chrome reflection!
            avg = Vector((0.0, 0.0, 0.0))
            for lf in v.link_faces:
                if lf.material_index == f.material_index and lf.normal.dot(f.normal) > 0.35:
                    avg += lf.normal
            n = (avg.normalized() * 0.75 + f.normal.normalized() * 0.25).normalized() if avg.length > 1e-4 else f.normal.normalized()
            pos.extend((round(v.co.x, 2), round(v.co.y, 2), round(v.co.z, 2)))
            nrm.extend((round(n.x, 4), round(n.y, 4), round(n.z, 4)))
            if idx == 0:
                edge.extend((1.0, 0.0, 0.0))
            elif idx == 1:
                edge.extend((0.0, 1.0, 0.0))
            else:
                edge.extend((0.0, 0.0, 1.0))
            kind.append(k)
    return pos, nrm, edge, kind, len(kind) // 3


def write_js(out_path, pylon_data, chevron_data):
    def fmt(arr):
        return ",".join(f"{v:g}" for v in arr)

    p_pos, p_nrm, p_edge, p_kind, p_tris = pylon_data
    c_pos, c_nrm, c_edge, c_kind, c_tris = chevron_data
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("/* eslint-disable */\n")
        f.write("/**\n")
        f.write(" * Chromadelic Highway — Blender-sculpted Monolithic Aero-Wing Pillars & Curb Winglets.\n")
        f.write(" * Generated by scripts/blender/chromadelic_highway_assets.py (do not hand-edit).\n")
        f.write(f" * PYLON: {p_tris} tris | CHEVRON: {c_tris} tris.\n")
        f.write(" */\n")
        f.write(f"export const PYLON_TRIS = {p_tris};\n")
        f.write(f"export const PYLON_POSITION = new Float32Array([{fmt(p_pos)}]);\n")
        f.write(f"export const PYLON_NORMAL = new Float32Array([{fmt(p_nrm)}]);\n")
        f.write(f"export const PYLON_EDGE = new Float32Array([{fmt(p_edge)}]);\n")
        f.write(f"export const PYLON_KIND = new Float32Array([{fmt(p_kind)}]);\n")
        f.write(f"export const CHEVRON_TRIS = {c_tris};\n")
        f.write(f"export const CHEVRON_POSITION = new Float32Array([{fmt(c_pos)}]);\n")
        f.write(f"export const CHEVRON_NORMAL = new Float32Array([{fmt(c_nrm)}]);\n")
        f.write(f"export const CHEVRON_EDGE = new Float32Array([{fmt(c_edge)}]);\n")
        f.write(f"export const CHEVRON_KIND = new Float32Array([{fmt(c_kind)}]);\n")
    print(f"Wrote {out_path} (PYLON={p_tris} tris, CHEVRON={c_tris} tris)")


def render_previews(preview_dir, pylon_bm, chevron_bm):
    if not preview_dir:
        return
    os.makedirs(preview_dir, exist_ok=True)
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 675
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"

    mats = []
    for name, rgba in [
        ("Hull", (0.08, 0.06, 0.14, 1.0)),
        ("Neon", (0.12, 0.96, 1.0, 1.0)),
        ("Crystal", (1.0, 0.25, 0.82, 1.0)),
    ]:
        m = bpy.data.materials.new(name)
        m.diffuse_color = rgba
        mats.append(m)

    def make_obj(name, bm_src, loc=(0, 0, 0), scale=(1, 1, 1)):
        mesh = bpy.data.meshes.new(name)
        bm_src.to_mesh(mesh)
        for m in mats:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(name, mesh)
        obj.location = loc
        obj.scale = scale
        scene.collection.objects.link(obj)
        return obj

    # Convert our Y-up Three.js coordinates to Blender Z-up for right-side-up preview!
    def to_yup_preview(bm_src):
        bm_c = bm_src.copy()
        for v in bm_c.verts:
            x, y, z = v.co.x, v.co.y, v.co.z
            v.co = Vector((x, -z, y))
        bm_c.normal_update()
        return bm_c

    p_prev = to_yup_preview(pylon_bm)
    c_prev = to_yup_preview(chevron_bm)

    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 600, 0))
    road = bpy.context.active_object
    road.scale = (200, 1600, 1)
    road_mat = bpy.data.materials.new("Road")
    road_mat.diffuse_color = (0.14, 0.07, 0.25, 1.0)
    road.data.materials.append(road_mat)

    for y_dist in (260, 560, 860):
        make_obj(f"PylonR_{y_dist}", p_prev, (0, y_dist, 0), (1, 1, 1))
        make_obj(f"PylonL_{y_dist}", p_prev, (0, y_dist, 0), (-1, 1, 1))
        bpy.ops.mesh.primitive_torus_add(
            major_radius=260, minor_radius=4.0,
            major_segments=72, minor_segments=10,
            location=(0, y_dist, 25),
            rotation=(math.radians(90), 0, 0),
        )
        ring = bpy.context.active_object
        ring.data.materials.append(mats[2])

    for y_dist in (150, 350, 450, 650):
        make_obj(f"ChevR_{y_dist}", c_prev, (0, y_dist, 0), (1, 1, 1))
        make_obj(f"ChevL_{y_dist}", c_prev, (0, y_dist, 0), (-1, 1, 1))

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 24
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (0, -160, 62)
    cam.rotation_euler = (Vector((0, 600, 40)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = os.path.join(preview_dir, "blender-corridor-v3.png")
    bpy.ops.render.render(write_still=True)

    cam.location = (175, 80, 68)
    cam.rotation_euler = (Vector((190, 265, 2)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(preview_dir, "blender-pylon-v3-closeup.png")
    bpy.ops.render.render(write_still=True)

    p_prev.free()
    c_prev.free()


def main():
    args = parse_args()
    clear_scene()
    pylon_bm = build_pylon()
    chevron_bm = build_chevron()
    write_js(args.out, extract_arrays(pylon_bm), extract_arrays(chevron_bm))
    render_previews(args.preview, pylon_bm, chevron_bm)
    pylon_bm.free()
    chevron_bm.free()


if __name__ == "__main__":
    main()
