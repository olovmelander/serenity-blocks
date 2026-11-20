"""The troll: the old troll of the wood, built from numbers (troll_shape.py) into a body that can be posed.

He is the author's character, a stocky old troll with a long nose, long ears, big hands and feet
and a cloak of matted hair to his knees, drawn clean:
smooth masses blended into one another under a mane of matted moss locks, a moss beard and bushy
brows, a wrapped loincloth and a few small mushrooms in his moss. He is five shells (his body, the
hair of his head, the mantle over his back, and each arm from the ball of its shoulder down with
the moss on that shoulder: troll_shape.SHELLS), each one signed distance field meshed once, cut
into four LODs, weighted to the 21-bone skeleton, given baked ambient occlusion and joined into
one mesh. Every vertex carries what it is (face, hide, moss and which lock, leather, eye, mushroom)
for the runtime's shader.

How he is bound. His body's skin and cloth are bound by bone heat to a skeleton WITHOUT his arms
(an arm's bones hang beside his hip, and heat gave the cloth and the thigh next to his fist to his
hand); his hair and his mantle hang from his head and torso by rule (never from a leg); each arm,
and the moss on its shoulder, is bound to its own three bones and to nothing else, blended across
the elbow and the wrist. `check_shell` and `check_binding` refuse a build in which a shell is bound
to a bone that is not its own, or anything is shared between an arm and the rest of him.
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

#: An arm's bones below the collarbone. The body's own skin is bound to none of them.
ARM_BONES = ('upperL', 'foreL', 'handL', 'upperR', 'foreR', 'handR')
#: The bones his hair and his mantle hang from (mane_weights): never an arm's, never a leg's.
MANE_BONES = ('head', 'neck', 'chest', 'spine', 'hips', 'clavL', 'clavR')
#: The shells whose every vertex hangs by the mane's rule.
MANE_SHELLS = ('hair', 'cloak')
#: The shells whose occlusion is baked together (they move as one, near enough); an arm is baked alone.
LIT_TOGETHER = ('body', 'hair', 'cloak')

#: Half the width (model units) of the blend across his elbow and across his wrist.
ELBOW_BLEND = 0.04
WRIST_BLEND = 0.022

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


def _volume(faces):
    """Six times the signed volume a set of faces encloses (positive: their normals face out of it)."""
    total = 0.0
    for f in faces:
        co = [loop.vert.co for loop in f.loops]
        for i in range(1, len(co) - 1):
            total += co[0].dot(co[i].cross(co[i + 1]))
    return total


def _tidy(me, triangulate=False, outer_only=False, log=print, name='troll', speck=60):
    """Drop degenerate faces and any vertex no face uses (it would carry no normal); with
    `outer_only`, drop the pockets (the field also closes small hollows between the mantle and his
    back, which mesh as little shells of their own, turned inside out: they enclose a volume of the
    other sign than his own surface does) and the specks (pieces of fewer than `speck` vertices
    that stand apart from the rest: a lock's tip the lattice cut off). Returns True when his
    surface faces inward as meshed."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-7)
    if triangulate:
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    drop = [v for v in bm.verts if not v.link_faces]
    inward = False
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
        volumes = [_volume({f for v in comp for f in v.link_faces}) for comp in islands]
        inward = volumes[0] < 0
        pockets = [comp for comp, vol in zip(islands[1:], volumes[1:]) if (vol < 0) != inward]
        loose = [comp for comp, vol in zip(islands[1:], volumes[1:]) if (vol < 0) == inward]
        specks = [comp for comp in loose if len(comp) < speck]
        kept = [comp for comp in loose if len(comp) >= speck]
        for comp in pockets + specks:
            drop.extend(comp)
        for what, comps in (('inner pockets', pockets), ('specks', specks)):
            if comps:
                log(f'{name} surface: dropped {len(comps)} {what} ({sum(len(c) for c in comps)} vertices; '
                    f'the largest {", ".join(str(len(c)) for c in comps[:4])})')
        if kept:
            log(f'{name} surface: kept {len(kept)} pieces that stand apart from the rest '
                f'({", ".join(str(len(c)) for c in kept)} vertices)')
    if drop:
        bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()
    return inward


def build_surface(voxel=0.003, log=print):
    """Each shell of him as a mesh object ({shell: object}), and the primitives he was made from."""
    _clear()
    prims = ts.design(log=log)
    works = {}
    for shell in ts.SHELLS:
        verts, quads = ts.surface(ts.shell_prims(prims, shell), voxel=voxel, log=log, name=shell)
        me = bpy.data.meshes.new('Troll_' + shell)
        me.from_pydata(verts.tolist(), [], quads.tolist())
        me.validate()
        work = bpy.data.objects.new('Troll_' + shell, me)
        bpy.context.scene.collection.objects.link(work)
        # (His body is one piece: bone heat has no answer for a mesh with loose ones. His hair is
        # several (brows, ear tufts), and an arm may carry a cushion of moss that does not touch it.)
        if _tidy(me, outer_only=True, log=log, name=shell, speck=10 ** 9 if shell == 'body' else 24):
            me.flip_normals()
        for p in me.polygons:
            p.use_smooth = True
        log(f'{shell} surface: {len(me.vertices)} vertices, {len(me.polygons)} faces')
        works[shell] = work
    return works, prims


def pack_parts(obj, prims):
    """Write `Pack` = (skin, 0, moss, kind) for each vertex of `obj`; return the part shares, the
    lock groups and the groups whose rule each hangs by."""
    me = obj.data
    P = np.array([v.co[:] for v in me.vertices])
    W, tone, group, rule, flow = ts.parts_at(prims, P)
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
    return W, group, rule


def _ramp(a, b, x):
    return np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)


def _smooth(a, b, x):
    t = _ramp(a, b, x)
    return t * t * (3.0 - 2.0 * t)


def mane_weights(P, group):
    """How the mane hangs: brows and the tufts at his ears on his head; his beard from his head,
    handing over through his neck to his chest as it falls (so it bends smoothly as he bows his
    head); the crown's locks (and the strays and twigs among them) from his head, then down his
    torso by height; the mantle by height down his torso, its shoulder locks partly on his
    collarbones (which shrug). (The moss over his shoulders is not here: it is of his arms' shells
    and rides on his upper arms.)"""
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
    out = []
    for i in range(len(P)):
        keep = 1.0 - shoulder[i]
        w = {'head': head[i] * keep, 'neck': neck[i] * keep, 'chest': chest[i] * keep, 'spine': spine[i] * keep,
             'hips': hips[i] * keep}
        if shoulder[i] > 0:
            w['clavL' if P[i, 0] > 0 else 'clavR'] = shoulder[i]
        out.append({k: v for k, v in w.items() if v > 1e-4})
    return out


def arm_weights(P, side):
    """An arm's shell (its skin, and the moss on its shoulder): its upper arm, forearm and hand,
    blended across the elbow and the wrist (each across the plane that halves the joint's angle as
    he is built), and bound to nothing else."""
    S, E, Wr = (np.array(TROLL[bone + side][1], float) for bone in ('upper', 'fore', 'hand'))
    T = np.array(TROLL['hand' + side][2], float)

    def unit(v):
        return v / np.linalg.norm(v)

    d1, d2, d3 = unit(E - S), unit(Wr - E), unit(T - Wr)
    fore = _smooth(-ELBOW_BLEND, ELBOW_BLEND, (P - E) @ unit(d1 + d2))
    hand = _smooth(-WRIST_BLEND, WRIST_BLEND, (P - Wr) @ unit(d2 + d3))
    return {'upper' + side: (1.0 - fore) * (1.0 - hand), 'fore' + side: fore * (1.0 - hand), 'hand' + side: hand}


def _groups(obj, order):
    """Every bone's vertex group on `obj`, by name (made where it has none)."""
    for name in order:
        if name not in obj.vertex_groups:
            obj.vertex_groups.new(name=name)
    return {g.name: g for g in obj.vertex_groups}


def weigh_mane(lod, rule, order):
    """Hang a shell of his mane (his hair, his mantle) by rule alone."""
    P = np.array([v.co[:] for v in lod.data.vertices])
    groups = _groups(lod, order)
    for i, w in enumerate(mane_weights(P, rule)):
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        s = sum(val for _, val in top) or 1.0
        for k, val in top:
            groups[k].add([i], val / s, 'REPLACE')


def weigh_body(lod, rig, W, group, rule, order):
    """Bind the body's skin by bone heat to `rig` (his skeleton without his arms); what moss grows
    on bare skin hangs by the mane's rule."""
    ix = {name: i for i, name in enumerate(ts.PARTS)}
    bpy.ops.object.select_all(action='DESELECT')
    lod.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    lme = lod.data
    P = np.array([v.co[:] for v in lme.vertices])
    # (The mushrooms grow in the moss and hang with it, and so do the twigs caught in it; an eye
    # is of his head.)
    twig = (group == 'twig') * W[:, ix['leather']]
    moss = np.minimum(W[:, ix['pelt']] + W[:, ix['cap']] + twig, 1.0)
    eye = W[:, ix['eye']]
    hang = mane_weights(P, rule)
    # (Heat lets his big head, hung low before his chest, take a share of the skin of his belly
    # under it, and his collarbones a share of his belly's sides, across the room his arms leave:
    # nothing of his head's is lower than his chin, nor of a collarbone's lower than his breast.)
    of_head = _ramp(0.10, 0.15, P[:, 2])
    of_clav = _ramp(-0.04, 0.03, P[:, 2])
    gindex = {g.index: g.name for g in lod.vertex_groups}
    groups = _groups(lod, order)
    unweighted = 0
    for v in lme.vertices:
        i = v.index
        auto = {gindex[g.group]: g.weight for g in v.groups if g.weight > 1e-5 and g.group in gindex}
        if 'head' in auto:
            auto['head'] *= float(of_head[i])
        for clav in ('clavL', 'clavR'):
            if clav in auto:
                auto[clav] *= float(of_clav[i])
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
    if unweighted > len(lme.vertices) * 0.02:
        raise RuntimeError(f'{lod.name}: bone heat left {unweighted} of {len(lme.vertices)} vertices unbound')
    return unweighted


def weigh_arm(lod, side, W, group, order):
    """Bind an arm's shell to its own three bones (the moss on its shoulder, and what grows in it,
    rides on its upper arm alone: it hangs beside the elbow and must not be bent by it)."""
    ix = {name: i for i, name in enumerate(ts.PARTS)}
    P = np.array([v.co[:] for v in lod.data.vertices])
    moss = np.minimum(W[:, ix['pelt']] + W[:, ix['cap']] + (group == 'twig') * W[:, ix['leather']], 1.0)
    weights = arm_weights(P, side)
    for name in weights:
        weights[name] = weights[name] * (1.0 - moss) + (moss if name.startswith('upper') else 0.0)
    groups = _groups(lod, order)
    for name, vals in weights.items():
        for i in np.nonzero(vals > 1e-4)[0]:
            groups[name].add([int(i)], float(vals[i]), 'REPLACE')


def check_shell(lod, shell):
    """Refuse a shell bound to a bone that is not its own to be bound to."""
    if shell == 'body':
        allowed = set(TROLL) - set(ARM_BONES)
    elif shell in MANE_SHELLS:
        allowed = set(MANE_BONES)
    else:
        allowed = {bone + shell[-1] for bone in ('upper', 'fore', 'hand')}
    names = {g.index: g.name for g in lod.vertex_groups}
    stray = {}
    for v in lod.data.vertices:
        for g in v.groups:
            if g.weight > 1e-4 and names[g.group] not in allowed:
                stray[names[g.group]] = stray.get(names[g.group], 0) + 1
    if stray:
        raise RuntimeError(f'{lod.name}: bound to bones that are not its own: {stray}')


def check_binding(obj, log=print):
    """Refuse anything shared between an arm and the rest of him: it is what stretched between his
    hand and his loincloth. A vertex that carries any of an arm's weight carries that arm's alone,
    and no triangle joins an arm's vertex to one that is not."""
    names = {g.index: g.name for g in obj.vertex_groups}
    me = obj.data
    owner = {}
    faults = []
    for v in me.vertices:
        w = {names[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
        arm = [k for k in w if k in ARM_BONES]
        owner[v.index] = arm[0][-1] if arm else ''
        if arm and (len(arm) != len(w) or len({k[-1] for k in arm}) > 1):
            faults.append((v.index, w))
    bridges = sum(1 for p in me.polygons if len({owner[i] for i in p.vertices}) > 1)
    if faults or bridges:
        raise RuntimeError(f'{obj.name}: {len(faults)} vertices are shared between an arm and the rest of him '
                           f'(the first: {faults[:3]}), and {bridges} triangles join an arm to the rest of him')
    log(f'{obj.name}: nothing is shared between an arm and the rest of him')


def make_lods(works, prims, log=print):
    """Decimate each shell to each LOD, pack its parts and bind it. Returns [[a mesh per shell], ...]."""
    order = list(TROLL.keys())
    rig = build_armature(bpy, {name: bone for name, bone in TROLL.items() if name not in ARM_BONES}, 'TrollBodyRig')
    src_tris = sum(len(p.vertices) - 2 for work in works.values() for p in work.data.polygons)
    lods = []
    for li, target in enumerate(LOD_TRIANGLES):
        parts = []
        for shell in ts.SHELLS:
            work = works[shell]
            bpy.ops.object.select_all(action='DESELECT')
            work.select_set(True)
            bpy.context.view_layer.objects.active = work
            bpy.ops.object.duplicate()
            lod = bpy.context.active_object
            lod.name = f'TrollLOD{li}_{shell}'
            dec = lod.modifiers.new('dec', 'DECIMATE')
            dec.decimate_type = 'COLLAPSE'
            dec.ratio = min(1.0, target / src_tris)
            bpy.ops.object.modifier_apply(modifier='dec')
            _tidy(lod.data, triangulate=True)
            own = ts.shell_prims(prims, shell)
            W, group, rule = pack_parts(lod, own)
            if shell == 'body':
                weigh_body(lod, rig, W, group, rule, order)
            elif shell in MANE_SHELLS:
                weigh_mane(lod, rule, order)
            else:
                weigh_arm(lod, shell[-1], W, group, order)
            check_shell(lod, shell)
            log(f'troll LOD{li} {shell}: {len(lod.data.polygons)} triangles, {len(lod.data.vertices)} vertices')
            lod['shell'] = shell
            parts.append(lod)
        lods.append(parts)
    return lods


def join_shells(parts, name):
    """One mesh of a LOD's shells (they stay apart in it: no face joins one to another)."""
    for o in parts:
        for m in list(o.modifiers):
            o.modifiers.remove(m)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def bake_ao(lods, samples=48, log=print):
    """Ambient occlusion into a colour attribute per shell of each LOD (Cycles on the CPU). His
    body, his hair and his mantle shade one another (the dark under his beard and his mantle's
    edge); an arm is baked alone: it casts none on his body, nor his body on it (they move against
    each other, and a shadow baked where his arm once hung would stay on his flank when it lifts)."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.seed = 7
    scene.render.bake.target = 'VERTEX_COLORS'
    mat = bpy.data.materials.new('bake')
    mat.use_nodes = True
    for parts in lods:
        for obj in parts:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            ao = obj.data.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
            obj.data.color_attributes.active_color = ao
            together = obj['shell'] in LIT_TOGETHER
            seen = {o.name for o in parts if together and o['shell'] in LIT_TOGETHER} | {obj.name}
            for o in bpy.data.objects:
                o.hide_render = o.name not in seen
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.bake(type='AO')
        log(f'baked ambient occlusion: {", ".join(o.name for o in parts)}')
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
    """The whole troll: his shells, LODs, parts, weights, occlusion, four files."""
    works, prims = build_surface(voxel=voxel, log=log)
    shells = make_lods(works, prims, log=log)
    bake_ao(shells, log=log)
    lods = [join_shells(parts, f'TrollLOD{li}') for li, parts in enumerate(shells)]
    for lod in lods:
        check_binding(lod, log=log)
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
            'stillwaterTroll': 5,
            'shells': 'five closed surfaces in the one mesh, no face joining one to another: his body, the hair of '
                      'his head, the mantle over his back, and each arm from the ball of its shoulder down with the '
                      'moss on that shoulder (an arm is bound to its own three bones alone; hair and mantle to no leg)',
            'flesh': ts.masses(),
            'flow': '_FLOW: the way the hair runs at each vertex (its lock, root to tip), int8 unit vectors',
            'colour': 'r skin (1 his ruddy face, 0.65 his hide, 0.2 an eye, 0.18 beard-lichen on moss), '
                      "g ambient occlusion, b moss, a kind (the moss lock's tone 0..0.6, 0.7 an eye, 1 a mushroom); "
                      'all but g zero = leather (loincloth, nails, twigs)',
        }, flow=flow)
        log(f'wrote {path.name}: {n} vertices, {tris} triangles, {size} bytes')
        written.append(path)
    return written
