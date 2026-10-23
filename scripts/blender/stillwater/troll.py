"""The troll: the old troll of the wood, built from numbers (troll_shape.py) into a body that can be posed.

He keeps the character of the theme's own sculpt (assets/troll.glb: a stocky old troll with a long
nose, long ears, big hands and feet and a cloak of matted hair to his knees) but is drawn clean:
smooth masses blended into one another under a mane of matted moss locks, a moss beard and bushy
brows, a wrapped loincloth and a few small mushrooms in his moss. The surface is one signed
distance field meshed once, cut into four LODs, weighted to the 21-bone skeleton (bone heat for
the body; the mane hangs from his head and torso), and given baked ambient occlusion. Every vertex
carries what it is (face, hide, moss and which lock, leather, eye, mushroom) for the runtime's
shader.
"""

import bmesh
import bpy
import numpy as np

from . import troll_shape as ts
from .figure_glb import write_figure
from .rigs import TROLL, build_armature

#: Triangles per LOD (Ultra/Extreme, High, Medium, Low/Minimal). (The mane is many thin locks: it
#: needs more of them than the smooth masses of the first design did.)
LOD_TRIANGLES = (52000, 28000, 15000, 6000)

#: The groups of the mane drawn as pale beard-lichen, not moss (`r` 0.18 on them: see PACK).
LICHEN = ('beard', 'tuft', 'lichen')

#: What each part is packed as: (r skin, a kind); b is the moss share, g the occlusion.
#: r: 1 his ruddy face, 0.65 his hide, 0.2 an eye, 0.18 beard-lichen (on moss). a: the lock's tone
#: (0..0.6) on moss, 0.7 an eye, 1 a mushroom. Leather (his loincloth, nails, the twigs in his hair)
#: is all zero.
PACK = {
    'skin': (1.0, 0.0),
    'hide': (0.65, 0.0),
    'pelt': (0.0, None),
    'leather': (0.0, 0.0),
    'eye': (0.2, 0.7),
    'cap': (0.0, 1.0),
}


def _clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _tidy(me, triangulate=False, outer_only=False, log=print):
    """Drop degenerate faces and any vertex no face uses (it would carry no normal); with
    `outer_only`, keep only his outer surface (the field also closes small pockets between the
    mantle and his back, which mesh as little inside-out shells of their own)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-7)
    if triangulate:
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    drop = [v for v in bm.verts if not v.link_faces]
    if outer_only:
        bm.verts.ensure_lookup_table()
        seen = set()
        islands = []
        for v in bm.verts:
            if v.index in seen or not v.link_faces:
                continue
            stack, comp = [v], []
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
        for comp in islands[1:]:
            drop.extend(comp)
        if len(islands) > 1:
            log(f'troll surface: kept the outer shell, dropped {len(islands) - 1} inner pockets '
                f'({sum(len(c) for c in islands[1:])} vertices; the largest {len(islands[1])})')
    if drop:
        bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()


def build_surface(voxel=0.003, log=print):
    """The whole of him as one mesh object, and the primitives he was made from."""
    _clear()
    prims = ts.design(log=log)
    verts, quads = ts.surface(prims, voxel=voxel, log=log)
    me = bpy.data.meshes.new('TrollSurface')
    me.from_pydata(verts.tolist(), [], quads.tolist())
    me.validate()
    work = bpy.data.objects.new('TrollSurface', me)
    bpy.context.scene.collection.objects.link(work)
    _tidy(me, outer_only=True, log=log)
    centre = verts.mean(0)
    fn = np.array([p.normal[:] for p in me.polygons])
    fc = np.array([p.center[:] for p in me.polygons])
    if (np.einsum('ij,ij->i', fn, fc - centre) > 0).mean() < 0.5:
        me.flip_normals()
    for p in me.polygons:
        p.use_smooth = True
    log(f'troll surface: {len(me.vertices)} vertices, {len(me.polygons)} faces')
    return work, prims


def pack_parts(obj, prims):
    """Write `Pack` = (skin, 0, moss, kind) for each vertex of `obj`; return the part shares and lock groups."""
    me = obj.data
    P = np.array([v.co[:] for v in me.vertices])
    W, tone, group, flow = ts.parts_at(prims, P)
    ix = {name: i for i, name in enumerate(ts.PARTS)}
    r = sum(W[:, ix[k]] * PACK[k][0] for k in PACK)
    # (Beard-lichen is moss told apart by a little `r`, which no other moss has.)
    r = r + W[:, ix['pelt']] * np.isin(group, LICHEN) * 0.18
    a = sum(W[:, ix[k]] * (tone if PACK[k][1] is None else PACK[k][1]) for k in PACK)
    b = W[:, ix['pelt']]
    pack = me.color_attributes.new('Pack', 'FLOAT_COLOR', 'POINT')
    pack.data.foreach_set('color', np.stack([r, np.zeros_like(r), b, a], 1).ravel().astype(np.float32))
    # The way the hair runs at each vertex (its lock's root to tip), for the strands in the shader.
    attr = me.attributes.new('Flow', 'FLOAT_VECTOR', 'POINT')
    attr.data.foreach_set('vector', flow.astype(np.float32).ravel())
    return W, group


def _ramp(a, b, x):
    return np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)


def mane_weights(P, group):
    """How the mane hangs: brows and the tufts at his ears on his head; his beard from his head,
    handing over through his neck to his chest as it falls (so it bends smoothly as he bows his
    head); the crown's locks (and the strays and twigs among them) from his head, then down his
    torso by height; the mantle by height down his torso, its shoulder locks partly on his
    collarbones (which shrug); the moss over his shoulders on his upper arms, out from his
    collarbones."""
    z = P[:, 2]
    on_head = np.isin(group, ['fringe', 'tuft'])
    crown = np.isin(group, ['crown', 'stray', 'twig'])
    beard = group == 'beard'
    head = np.where(on_head, 1.0, np.where(crown, _ramp(0.15, 0.25, z), np.where(beard, _ramp(0.12, 0.2, z), 0.0)))
    neck = np.where(beard, _ramp(-0.04, 0.1, z), 0.0) * (1.0 - head)
    rest = 1.0 - head - neck
    chest = _ramp(-0.04, 0.07, z) * rest
    spine = _ramp(-0.18, -0.08, z) * (rest - chest)
    hips = np.maximum(rest - chest - spine, 0.0)
    shoulder = np.where(on_head | beard, 0.0, 0.55 * _ramp(0.13, 0.21, np.abs(P[:, 0])) * _ramp(-0.12, 0.0, z))
    pauldron = group == 'shoulder'
    arm = 0.8 * _ramp(0.15, 0.22, np.abs(P[:, 0]))
    out = []
    for i in range(len(P)):
        if pauldron[i]:
            side = 'L' if P[i, 0] > 0 else 'R'
            w = {'upper' + side: arm[i], 'clav' + side: (1.0 - arm[i]) * 0.65, 'chest': (1.0 - arm[i]) * 0.35}
            out.append({k: v for k, v in w.items() if v > 1e-4})
            continue
        keep = 1.0 - shoulder[i]
        w = {'head': head[i] * keep, 'neck': neck[i] * keep, 'chest': chest[i] * keep, 'spine': spine[i] * keep,
             'hips': hips[i] * keep}
        if shoulder[i] > 0:
            w['clavL' if P[i, 0] > 0 else 'clavR'] = shoulder[i]
        out.append({k: v for k, v in w.items() if v > 1e-4})
    return out


def make_lods(work, prims, log=print):
    """Decimate to each LOD, pack its parts, bind it (bone heat), hang the mane from head and torso."""
    arm = build_armature(bpy, TROLL, 'TrollRig')
    order = list(TROLL.keys())
    src_tris = sum(len(p.vertices) - 2 for p in work.data.polygons)
    ix = {name: i for i, name in enumerate(ts.PARTS)}
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
        _tidy(lod.data, triangulate=True)
        W, group = pack_parts(lod, prims)
        bpy.ops.object.select_all(action='DESELECT')
        lod.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        lme = lod.data
        P = np.array([v.co[:] for v in lme.vertices])
        # (The mushrooms grow in the moss and hang with it, and so do the twigs caught in it; an eye
        # is of his head.)
        twig = (group == 'twig') * W[:, ix['leather']]
        moss = np.minimum(W[:, ix['pelt']] + W[:, ix['cap']] + twig, 1.0)
        eye = W[:, ix['eye']]
        hang = mane_weights(P, group)
        groups = {g.name: g for g in lod.vertex_groups}
        gindex = {g.index: g.name for g in lod.vertex_groups}
        unweighted = 0
        for v in lme.vertices:
            i = v.index
            auto = {gindex[g.group]: g.weight for g in v.groups if g.weight > 1e-5}
            total = sum(auto.values())
            m = float(moss[i])
            if total < 1e-3:
                unweighted += 1
                m, auto, total = 1.0, {}, 1.0
            blend = {}
            for k, val in auto.items():
                blend[k] = blend.get(k, 0.0) + (1 - m) * (1 - eye[i]) * val / total
            for k, val in hang[i].items():
                blend[k] = blend.get(k, 0.0) + m * (1 - eye[i]) * val
            blend['head'] = blend.get('head', 0.0) + eye[i]
            top = sorted(blend.items(), key=lambda kv: -kv[1])[:4]
            s = sum(val for _, val in top) or 1.0
            for name in order:
                groups[name].remove([i])
            for k, val in top:
                if val > 1e-5:
                    groups[k].add([i], val / s, 'REPLACE')
        log(f'troll LOD{li}: {len(lme.polygons)} triangles, {len(lme.vertices)} vertices '
            f'({unweighted} hung by the mane rule alone)')
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
    """False colour of what each part is (rose face, tan hide, green moss, brown leather, white caps)."""
    from mathutils import Vector
    me = obj.data
    pack = me.color_attributes['Pack']
    n = len(me.vertices)
    raw = np.zeros(n * 4, np.float32)
    pack.data.foreach_get('color', raw)
    c = raw.reshape(n, 4)
    skin, moss, kind = c[:, 0], c[:, 2], c[:, 3]
    rosy = np.clip((skin - 0.75) / 0.2, 0, 1)[:, None]
    flesh = np.clip((skin - 0.3) / 0.25, 0, 1)[:, None]
    hide = np.array([0.55, 0.42, 0.3]) * (1 - rosy) + np.array([0.95, 0.5, 0.45]) * rosy
    base = np.array([0.25, 0.12, 0.05]) * (1 - flesh) + hide * flesh
    green = np.array([0.1, 0.4, 0.1]) + np.array([0.15, 0.25, 0.05]) * (kind / 0.6)[:, None]
    col = base * (1 - moss)[:, None] + green * moss[:, None]
    cap = (np.clip((kind - 0.85) / 0.1, 0, 1) * (1 - moss))[:, None]
    col = col * (1 - cap) + cap
    look = me.color_attributes.new('Look', 'FLOAT_COLOR', 'POINT')
    look.data.foreach_set('color', np.concatenate([col, np.ones((n, 1))], 1).ravel().astype(np.float32))
    mat = bpy.data.materials.new('parts')
    mat.use_nodes = True
    nt = mat.node_tree
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Look'
    nt.links.new(attr.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
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


def build(out_dir, log=print, preview_dir=None, voxel=0.003):
    """The whole troll: surface, LODs, parts, weights, occlusion, four files."""
    work, prims = build_surface(voxel=voxel, log=log)
    lods = make_lods(work, prims, log=log)
    bake_ao(lods, log=log)
    if preview_dir is not None:
        preview(lods[0], preview_dir, log=log)
    written = []
    for li, lod in enumerate(lods):
        pack = lod.data.color_attributes['Pack']
        ao = lod.data.color_attributes['AO']

        flows = lod.data.attributes['Flow']

        def colour(i, pack=pack, ao=ao):
            p = pack.data[i].color
            return (p[0], ao.data[i].color[0], p[2], p[3])

        def flow(i, flows=flows):
            return tuple(flows.data[i].vector)
        path = out_dir / f'troll-lod{li}.glb'
        n, tris, size = write_figure(lod, TROLL, colour, str(path), 'Serenity Blocks - Stillwater troll (Blender, built from numbers)', {
            'stillwaterTroll': 4,
            'flow': '_FLOW: the way the hair runs at each vertex (its lock, root to tip), int8 unit vectors',
            'colour': 'r skin (1 his ruddy face, 0.65 his hide, 0.2 an eye, 0.18 beard-lichen on moss), '
                      "g ambient occlusion, b moss, a kind (the moss lock's tone 0..0.6, 0.7 an eye, 1 a mushroom); "
                      'all but g zero = leather (loincloth, nails, twigs)',
        }, flow=flow)
        log(f'wrote {path.name}: {n} vertices, {tris} triangles, {size} bytes')
        written.append(path)
    return written
