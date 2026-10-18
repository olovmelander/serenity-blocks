"""The troll: the theme's own sculpt (assets/troll.glb) rebuilt into a body that can be posed.

The source is the TRELLIS reconstruction of the author's troll: its pelt is a soup of thin
triangle shards that rendered as torn paper, and its rig was thirteen bones weighted by distance.
Here the shards are thickened and the whole is voxel-remeshed into one solid surface (the sculpt's
own shape: the long nose, the ears, the belly and loincloth, big hands and feet, a cloak of matted
hair to his knees), the sculpt's paint is carried over as masks, the hair is told from the body by
how thin it is, and the result is cut into four LODs, weighted to a 21-bone skeleton (bone heat
for the body; the cloak hangs from the torso by height) and given baked ambient occlusion.
"""

import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .figure_glb import write_figure
from .rigs import TROLL, build_armature

#: Triangles per LOD (Ultra/Extreme, High, Medium, Low/Minimal).
LOD_TRIANGLES = (32000, 17000, 9700, 3700)


def _clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def rebuild_surface(source, voxel=0.0075, thick=0.0065, log=print):
    """One solid surface from the shard soup, with masks: r skin, g the paint's light, b (later) pelt."""
    _clear()
    bpy.ops.import_scene.gltf(filepath=str(source))
    for o in list(bpy.data.objects):
        if o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o)
    src = next(o for o in bpy.data.objects if o.type == 'MESH')
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    for m in list(src.modifiers):
        src.modifiers.remove(m)
    mw = src.matrix_world.copy()
    src.parent = None
    src.matrix_world = mw
    if arm:
        bpy.data.objects.remove(arm)
    bpy.context.view_layer.objects.active = src
    src.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # The paint per face (corner colours averaged) for the transfer.
    me = src.data
    col = me.color_attributes['Color']
    face_rgb = []
    for poly in me.polygons:
        r = g = b = 0.0
        for li in poly.loop_indices:
            c = col.data[li].color
            r += c[0]
            g += c[1]
            b += c[2]
        n = len(poly.loop_indices)
        face_rgb.append((r / n, g / n, b / n))
    src_bvh = BVHTree.FromObject(src, bpy.context.evaluated_depsgraph_get())
    bpy.ops.object.select_all(action='DESELECT')
    src.select_set(True)
    bpy.context.view_layer.objects.active = src
    bpy.ops.object.duplicate()
    work = bpy.context.active_object
    work.name = 'TrollSurface'
    # The shards stay separate (welding them makes spikes); thickened, the remesh can close them.
    sol = work.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = thick
    sol.offset = 0.0
    sol.use_even_offset = False
    bpy.ops.object.modifier_apply(modifier='solid')
    rem = work.modifiers.new('remesh', 'REMESH')
    rem.mode = 'VOXEL'
    rem.voxel_size = voxel
    rem.adaptivity = 0.0
    bpy.ops.object.modifier_apply(modifier='remesh')
    sm = work.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    sm.iterations = 3
    sm.smooth_type = 'SIMPLE'
    sm.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier='smooth')
    # Drop the remesh's crumbs.
    bm = bmesh.new()
    bm.from_mesh(work.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    islands = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        comp = []
        seen.add(v.index)
        while stack:
            a = stack.pop()
            comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        islands.append(comp)
    islands.sort(key=len, reverse=True)
    drop = [v for comp in islands[1:] if len(comp) < 400 for v in comp]
    bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(work.data)
    bm.free()
    # Masks from the paint: skin is pinkish (red over green); the pelt and body are olive or grey.
    for a in list(work.data.color_attributes):
        work.data.color_attributes.remove(a)
    mask = work.data.color_attributes.new('Mask', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(work.data.vertices):
        _, _, idx, _ = src_bvh.find_nearest(v.co)
        r, g, b = face_rgb[idx] if idx is not None else (0.5, 0.5, 0.5)
        skin = max(0.0, min(1.0, (r - g - 0.04) / 0.1))
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        mask.data[i].color = (skin, luma, 0.0, 1.0)
    bpy.data.objects.remove(src)
    log(f'troll surface: {len(work.data.vertices)} vertices, {len(islands)} islands ({len(drop)} crumb vertices dropped)')
    return work


def _segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def _ramp(a, b, x):
    return max(0.0, min(1.0, (x - a) / (b - a)))


def classify_parts(work):
    """What each part of him is: skin, bare hide, pelt or the leather of his loincloth.

    The paint cannot tell hair from body (both are olive), and in the source the hair is flaps of
    the one connected surface, so the parts are told by where they are and how thin they are:
    skin where the paint is pinkish (face, ears, hands, feet); leather in the loincloth's place at
    his front waist; pelt where the surface is a thin sheet (dreadlocks anywhere), on the cloak that
    stands off his back and sides, and over the top and back of his head; bare hide (arms, legs,
    belly) for the rest. Writes Mask = (skin: 1 skin / 0.65 bare hide / 0 else, paint light,
    pelt, leather).
    """
    me = work.data
    mask = me.color_attributes['Mask']
    bvh = BVHTree.FromObject(work, bpy.context.evaluated_depsgraph_get())
    spine_a, spine_b = Vector((0.0, 0.03, -0.24)), Vector((0.0, -0.06, 0.16))
    head_a, head_b = Vector((0.0, -0.13, 0.2)), Vector((0.0, -0.2, 0.43))
    n_verts = len(me.vertices)
    pelt = [0.0] * n_verts
    leather = [0.0] * n_verts
    for v in me.vertices:
        p = v.co
        n = v.normal
        hit = bvh.ray_cast(p - n * 0.0012, -n, 0.15)
        d = hit[3] if hit[0] is not None else 0.15
        thin = _ramp(0.085, 0.05, d)
        # The cloak: off his back and sides, well away from the line of his spine.
        behind = _ramp(-0.08, 0.02, p.y)
        off_spine = _ramp(0.15, 0.21, _segment_distance(p, spine_a, spine_b))
        cloak = behind * off_spine * _ramp(-0.47, -0.4, p.z)
        # The top and back of his head (not his face).
        crown = _ramp(0.24, 0.3, p.z) * _ramp(-0.26, -0.2, p.y) * _ramp(0.05, 0.09, _segment_distance(p, head_a, head_b))
        # The loincloth: a box before his hips and thighs.
        box = _ramp(-0.46, -0.42, p.z) * _ramp(-0.2, -0.24, p.z) * _ramp(0.03, -0.02, p.y) * _ramp(0.24, 0.2, abs(p.x))
        leather[v.index] = box
        pelt[v.index] = max(thin, cloak, crown) * (1.0 - box)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    for _ in range(3):
        nxt_p, nxt_l = pelt[:], leather[:]
        for v in bm.verts:
            nb = [e.other_vert(v).index for e in v.link_edges]
            if nb:
                nxt_p[v.index] = 0.5 * pelt[v.index] + 0.5 * sum(pelt[i] for i in nb) / len(nb)
                nxt_l[v.index] = 0.5 * leather[v.index] + 0.5 * sum(leather[i] for i in nb) / len(nb)
        pelt, leather = nxt_p, nxt_l
    bm.free()
    for i in range(n_verts):
        c = mask.data[i].color
        skin_paint = _ramp(0.35, 0.7, c[0])
        hair = pelt[i] * (1.0 - skin_paint)
        cloth = leather[i] * (1.0 - skin_paint) * (1.0 - hair)
        bare = (1.0 - hair) * (1.0 - cloth)
        skin = max(skin_paint, 0.65 * bare)
        mask.data[i].color = (skin, c[1], hair, cloth)


def classify_hair(work):
    """Kept for the name: see classify_parts."""
    classify_parts(work)


def _torso_weights(z):
    """The cloak hangs from the body: weights by height along the torso chain (Blender z)."""
    def ramp(a, b, x):
        return max(0.0, min(1.0, (x - a) / (b - a)))
    head = ramp(0.17, 0.26, z)
    chest = ramp(-0.02, 0.08, z) * (1 - head)
    spine = ramp(-0.17, -0.07, z) * (1 - head - chest)
    hips = max(0.0, 1 - head - chest - spine)
    return {k: v for k, v in (('head', head), ('chest', chest), ('spine', spine), ('hips', hips)) if v > 1e-4}


def make_lods(work, log=print):
    """Decimate to each LOD, bind to the skeleton (bone heat), hang the cloak from the torso."""
    arm = build_armature(bpy, TROLL, 'TrollRig')
    order = list(TROLL.keys())
    src_tris = sum(len(p.vertices) - 2 for p in work.data.polygons)
    lods = []
    for li, target in enumerate(LOD_TRIANGLES):
        bpy.ops.object.select_all(action='DESELECT')
        work.select_set(True)
        bpy.context.view_layer.objects.active = work
        bpy.ops.object.duplicate()
        lod = bpy.context.active_object
        lod.name = f'TrollLOD{li}'
        dec = lod.modifiers.new('dec', 'DECIMATE')
        dec.decimate_type = 'COLLAPSE'
        dec.ratio = min(1.0, target / src_tris)
        bpy.ops.object.modifier_apply(modifier='dec')
        bm = bmesh.new()
        bm.from_mesh(lod.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(lod.data)
        bm.free()
        bpy.ops.object.select_all(action='DESELECT')
        lod.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        lme = lod.data
        lmask = lme.color_attributes['Mask']
        groups = {g.name: g for g in lod.vertex_groups}
        gindex = {g.index: g.name for g in lod.vertex_groups}
        unweighted = 0
        for v in lme.vertices:
            auto = {gindex[g.group]: g.weight for g in v.groups if g.weight > 1e-5}
            total = sum(auto.values())
            # (The cloak and the loincloth hang from the torso; the body follows its bones.)
            hair = max(lmask.data[v.index].color[2], lmask.data[v.index].color[3])
            torso = _torso_weights(v.co.z)
            if total < 1e-3:
                unweighted += 1
                hair, auto, total = 1.0, {}, 1.0
            blend = {}
            for k, val in auto.items():
                blend[k] = blend.get(k, 0.0) + (1 - hair) * val / total
            for k, val in torso.items():
                blend[k] = blend.get(k, 0.0) + hair * val
            top = sorted(blend.items(), key=lambda kv: -kv[1])[:4]
            s = sum(val for _, val in top) or 1.0
            for name in order:
                groups[name].remove([v.index])
            for k, val in top:
                groups[k].add([v.index], val / s, 'REPLACE')
        log(f'troll LOD{li}: {len(lme.polygons)} triangles, {len(lme.vertices)} vertices ({unweighted} weighted by the torso alone)')
        lods.append(lod)
    return lods


def bake_ao(objects, samples=48, log=print):
    """Ambient occlusion into a colour attribute per object (Cycles on the CPU)."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.seed = 7
    scene.render.bake.target = 'VERTEX_COLORS'
    mat = bpy.data.materials.new('bake')
    mat.use_nodes = True
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        ao = obj.data.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        obj.data.color_attributes.active_color = ao
        for o in bpy.data.objects:
            o.hide_render = o is not obj
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO')
        log(f'baked ambient occlusion: {obj.name}')
    for o in bpy.data.objects:
        o.hide_render = False


def preview(obj, out_dir, log=print):
    """False colour of what each part is (pink skin, tan bare hide, green pelt, brown leather)."""
    mat = bpy.data.materials.new('parts')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Mask'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(attr.outputs['Color'], sep.inputs['Color'])
    alpha = nt.nodes.new('ShaderNodeVertexColor')
    alpha.layer_name = 'Mask'

    def mix_node(a, b, fac):
        m = nt.nodes.new('ShaderNodeMix')
        m.data_type = 'RGBA'
        if isinstance(a, tuple):
            m.inputs['A'].default_value = a
        else:
            nt.links.new(a, m.inputs['A'])
        m.inputs['B'].default_value = b
        nt.links.new(fac, m.inputs['Factor'])
        return m.outputs['Result']
    base = mix_node((0.55, 0.42, 0.3, 1), (0.95, 0.5, 0.45, 1), sep.outputs['Red'])
    with_pelt = mix_node(base, (0.15, 0.55, 0.15, 1), sep.outputs['Blue'])
    with_cloth = mix_node(with_pelt, (0.25, 0.12, 0.05, 1), alpha.outputs['Alpha'])
    nt.links.new(with_cloth, bsdf.inputs['Base Color'])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    scene = bpy.context.scene
    scene.cycles.samples = 12
    scene.render.resolution_x = 480
    scene.render.resolution_y = 480
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    cam = bpy.data.objects.new('previewCam', bpy.data.cameras.new('previewCam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.15
    scene.collection.objects.link(cam)
    scene.camera = cam
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o is not obj
    for name, d in (('front', Vector((0, -1, 0))), ('side', Vector((1, 0, 0))), ('back', Vector((0, 1, 0))),
                    ('q34', Vector((0.7, -0.7, 0.15)).normalized())):
        cam.location = d * 5
        cam.rotation_euler = (d * -1).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(out_dir / f'troll-parts-{name}.png')
        bpy.ops.render.render(write_still=True)
    log(f'previews written to {out_dir}')


def build(source, out_dir, log=print, preview_dir=None):
    """The whole troll: surface, pelt, LODs, weights, occlusion, four files."""
    work = rebuild_surface(source, log=log)
    classify_hair(work)
    lods = make_lods(work, log=log)
    bake_ao(lods, log=log)
    if preview_dir is not None:
        preview(lods[0], preview_dir, log=log)
    written = []
    for li, lod in enumerate(lods):
        mask = lod.data.color_attributes['Mask']
        ao = lod.data.color_attributes['AO']

        def colour(i, mask=mask, ao=ao):
            m = mask.data[i].color
            return (m[0], ao.data[i].color[0], m[2], m[1])  # skin, AO, pelt, the paint's light
        path = out_dir / f'troll-lod{li}.glb'
        n, tris, size = write_figure(lod, TROLL, colour, str(path), 'Serenity Blocks - Stillwater troll (Blender rebuild)', {
            'stillwaterTroll': 2,
            'colour': "r skin (1 skin, 0.65 bare hide), g ambient occlusion, b pelt, a the paint's light; "
                      'neither skin nor pelt = leather',
        })
        log(f'wrote {path.name}: {n} vertices, {tris} triangles, {size} bytes')
        written.append(path)
    return written
