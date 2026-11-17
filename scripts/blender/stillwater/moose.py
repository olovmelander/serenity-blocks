"""The old moose of the wood: built from numbers into a body the runtime poses.

A bull in his prime, the shape everybody knows from far off in the mist: a deep chest, a hump
over the shoulders higher than his rump, a short thick neck, a long heavy head with an
overhanging muzzle, the bell hanging under his throat, long pale legs, and broad palmate
antlers. One signed distance field of smooth masses (the troll's own primitives, troll_shape.py),
meshed once, decimated, weighted to a 16-bone skeleton by the masses each bone carries (soft
across every joint), and given baked ambient occlusion. Every vertex carries what it is (hide,
leg, muzzle, antler, eye) for the runtime's shader (src/themes/stillwater/stillwater-moose.js).

Frame: Blender's (Z up, he faces -Y, +X is his LEFT), in metres, his hooves at z = 0.
"""

import math

import bmesh
import bpy
import numpy as np

from . import troll_shape as ts
from .figure_glb import write_figure
from .rigs import to_gltf  # noqa: F401  (the frame the files are written in)

V = ts.V
Prim = ts.Prim
frame = ts.frame

#: Triangles in the file.
TRIANGLES = 9000
#: Metres per voxel of the field.
VOXEL = 0.011

# ── The skeleton (Blender frame): name -> (parent, head, tail) ──
_FL = lambda s: {  # noqa: E731 - a front leg of side s (+1 his left)
    f'arm{"L" if s > 0 else "R"}': ('spine', (0.21 * s, -0.54, 1.46), (0.21 * s, -0.48, 1.02)),
    f'fore{"L" if s > 0 else "R"}': (f'arm{"L" if s > 0 else "R"}', (0.21 * s, -0.48, 1.02), (0.19 * s, -0.52, 0.56)),
    f'can{"L" if s > 0 else "R"}': (f'fore{"L" if s > 0 else "R"}', (0.19 * s, -0.52, 0.56), (0.17 * s, -0.55, 0.13)),
}
_HL = lambda s: {  # noqa: E731 - a hind leg of side s
    f'thigh{"L" if s > 0 else "R"}': ('root', (0.2 * s, 0.78, 1.44), (0.22 * s, 0.56, 0.98)),
    f'shin{"L" if s > 0 else "R"}': (f'thigh{"L" if s > 0 else "R"}', (0.22 * s, 0.56, 0.98), (0.18 * s, 0.92, 0.56)),
    f'hind{"L" if s > 0 else "R"}': (f'shin{"L" if s > 0 else "R"}', (0.18 * s, 0.92, 0.56), (0.17 * s, 0.84, 0.13)),
}
MOOSE = {
    'root': (None, (0.0, 0.62, 1.48), (0.0, 0.0, 1.56)),
    'spine': ('root', (0.0, 0.0, 1.56), (0.0, -0.6, 1.7)),
    'neck': ('spine', (0.0, -0.6, 1.7), (0.0, -1.02, 1.84)),
    'head': ('neck', (0.0, -1.02, 1.84), (0.0, -1.7, 1.54)),
    **_FL(1), **_FL(-1), **_HL(1), **_HL(-1),
}

#: What each part is packed as in the colour's red channel.
KIND = {'hide': 0.0, 'leg': 0.4, 'muzzle': 0.7, 'antler': 1.0, 'eye': 0.2}


def P3(*a):
    return np.array(a, float)


def ell(part, bone, c, r, main=(0, 0, 1), hint=(1, 0, 0), k=0.05, op='add'):
    """An ellipsoid: radii r along (main, the axis nearest hint, their cross)."""
    pr = Prim('ell', part, k=k, op=op, c=P3(*c), r=P3(*r), R=frame(main, hint))
    pr.tag = {'bone': bone}
    return pr


def cone(part, bone, a, b, r1, r2, k=0.05, op='add'):
    pr = Prim('cone', part, k=k, op=op, a=P3(*a), b=P3(*b), r1=r1, r2=r2)
    pr.tag = {'bone': bone}
    return pr


def design():
    """Every mass of him, in the order they are laid into the field."""
    out = []
    # The barrel: a deep chest, the back sloping down from the hump to a narrower, lower rump.
    out.append(ell('hide', 'spine', (0, -0.38, 1.42), (0.52, 0.36, 0.46), main=(0, 1, 0), hint=(0, 0, 1), k=0.0))
    out.append(ell('hide', 'root', (0, 0.3, 1.46), (0.6, 0.31, 0.35), main=(0, 1, 0.08), hint=(0, 0, 1), k=0.12))
    out.append(ell('hide', 'root', (0, 0.82, 1.5), (0.28, 0.29, 0.31), main=(0, 1, -0.25), hint=(0, 0, 1), k=0.1))
    # His withers: the back rises in one long smooth line from the rump to over his shoulders,
    # higher than the rump, and falls away into the neck. (A round hump here read as a lump on
    # his neck: it is a long low swell, blended softly.)
    out.append(ell('hide', 'spine', (0, -0.22, 1.74), (0.62, 0.22, 0.2), main=(0, 1, -0.22), hint=(0, 0, 1), k=0.22))
    # The belly, tucked up toward his flanks.
    out.append(ell('hide', 'root', (0, -0.05, 1.2), (0.5, 0.29, 0.2), main=(0, 1, 0.12), hint=(0, 0, 1), k=0.12))
    # The neck: short and thick, carried forward from under the hump.
    out.append(cone('hide', 'neck', (0, -0.6, 1.66), (0, -1.0, 1.78), 0.27, 0.19, k=0.14))
    # A short mane along the top of the neck, lying in the line of the back.
    out.append(cone('hide', 'neck', (0, -0.5, 1.92), (0, -0.95, 1.92), 0.06, 0.04, k=0.12))
    # The head: a long heavy skull to a big overhanging muzzle.
    out.append(cone('hide', 'head', (0, -1.05, 1.86), (0, -1.5, 1.62), 0.16, 0.13, k=0.06))
    out.append(ell('muzzle', 'head', (0, -1.62, 1.56), (0.18, 0.13, 0.14), main=(0, 1, 0.45), hint=(0, 0, 1), k=0.06))
    out.append(ell('muzzle', 'head', (0, -1.75, 1.5), (0.1, 0.12, 0.11), main=(0, 1, 0.9), hint=(0, 0, 1), k=0.05))
    out.append(ell('muzzle', 'head', (0, -1.6, 1.42), (0.11, 0.08, 0.05), main=(0, 1, 0.3), hint=(0, 0, 1), k=0.04))
    # Cheeks and jaw.
    out.append(ell('hide', 'head', (0, -1.18, 1.74), (0.18, 0.14, 0.14), main=(0, 1, 0.4), hint=(0, 0, 1), k=0.05))
    # The bell under his throat.
    out.append(ell('hide', 'neck', (0, -1.0, 1.45), (0.2, 0.03, 0.08), main=(0.0, 0.2, -1), hint=(0, 1, 0), k=0.035))
    for s in (1, -1):
        side = 'L' if s > 0 else 'R'
        # Ears: long, set high, turned out.
        out.append(ell('hide', 'head', (0.14 * s, -1.0, 2.03), (0.14, 0.055, 0.022), main=(0.55 * s, 0.35, 0.75),
                       hint=(0, -1, 0), k=0.025))
        # Eyes, small and deep.
        out.append(ell('eye', 'head', (0.125 * s, -1.24, 1.87), (0.024, 0.024, 0.024), k=0.0))
        # Nostrils.
        out.append(ell('muzzle', 'head', (0.055 * s, -1.83, 1.53), (0.032, 0.022, 0.02), op='sub', k=0.01))
        # The front legs: the shoulder and upper arm in the chest, a strong forearm, the knee, the
        # long pale cannon, the hoof.
        out.append(cone('hide', f'arm{side}', (0.21 * s, -0.54, 1.46), (0.21 * s, -0.48, 1.02), 0.19, 0.13, k=0.1))
        out.append(cone('hide', f'fore{side}', (0.21 * s, -0.48, 1.02), (0.19 * s, -0.52, 0.56), 0.12, 0.066, k=0.06))
        out.append(ell('leg', f'can{side}', (0.19 * s, -0.525, 0.56), (0.075, 0.062, 0.068), k=0.03))
        out.append(cone('leg', f'can{side}', (0.19 * s, -0.53, 0.54), (0.17 * s, -0.55, 0.13), 0.055, 0.044, k=0.03))
        out.append(cone('leg', f'can{side}', (0.17 * s, -0.56, 0.12), (0.17 * s, -0.64, 0.02), 0.054, 0.06, k=0.03))
        # The hind legs: the heavy haunch, the gaskin back to the hock and its point, the cannon, the hoof.
        out.append(cone('hide', f'thigh{side}', (0.2 * s, 0.78, 1.44), (0.22 * s, 0.56, 0.98), 0.22, 0.13, k=0.1))
        out.append(cone('hide', f'shin{side}', (0.22 * s, 0.56, 0.98), (0.18 * s, 0.92, 0.56), 0.12, 0.06, k=0.06))
        out.append(cone('leg', f'hind{side}', (0.18 * s, 0.93, 0.6), (0.18 * s, 1.0, 0.63), 0.055, 0.035, k=0.03))
        out.append(cone('leg', f'hind{side}', (0.18 * s, 0.92, 0.56), (0.17 * s, 0.84, 0.13), 0.054, 0.044, k=0.03))
        out.append(cone('leg', f'hind{side}', (0.17 * s, 0.83, 0.12), (0.17 * s, 0.75, 0.02), 0.052, 0.058, k=0.03))
        out.extend(antler(s))
    # A stub of a tail.
    out.append(cone('hide', 'root', (0, 1.08, 1.7), (0, 1.15, 1.54), 0.05, 0.03, k=0.04))
    return out


def antler(s):
    """One of his antlers (side s): a short beam out of the skull and a broad palm that lies out
    to his side and back, cupped upward, with a row of points round its rim and a brow tine."""
    out = []
    base = np.array((0.1 * s, -1.06, 2.02))
    beam_end = np.array((0.28 * s, -1.02, 2.08))
    out.append(cone('antler', 'head', base, beam_end, 0.052, 0.046, k=0.02))
    # The palm's plane: out to his side and up a little, and back along him.
    way = np.array((0.88 * s, 0.22, 0.42))
    way /= np.linalg.norm(way)
    back = np.array((0.0, 1.0, 0.18))
    R = frame(way, back)
    out_axis, back_axis = R[0], R[1]
    centre = beam_end + out_axis * 0.3 + back_axis * 0.06
    palm = Prim('ell', 'antler', k=0.035, c=centre, r=P3(0.4, 0.19, 0.026), R=R)
    palm.tag = {'bone': 'head'}
    out.append(palm)
    up = np.array((0.0, 0.0, 1.0))
    # The points along its far rim only (out from his head and round to the back), up and out.
    for i, theta in enumerate((-28, -8, 12, 32, 52, 74, 98)):
        t = math.radians(theta)
        at = centre + out_axis * (math.cos(t) * 0.37) + back_axis * (math.sin(t) * 0.17)
        d = out_axis * math.cos(t) * 0.8 + back_axis * math.sin(t) * 0.9 + up * 0.85
        d /= np.linalg.norm(d)
        length = (0.12, 0.17, 0.2, 0.19, 0.17, 0.14, 0.1)[i]
        out.append(cone('antler', 'head', at, at + d * length, 0.034, 0.009, k=0.02))
    # The brow tine, forward over his eye.
    bt = beam_end + np.array((-0.04 * s, -0.03, 0.0))
    out.append(cone('antler', 'head', bt, bt + np.array((0.06 * s, -0.18, 0.08)), 0.032, 0.01, k=0.02))
    return out


def surface(prims, voxel=VOXEL, log=print):
    import openvdb as vdb
    lo, hi = V(-1.1, -2.0, -0.08), V(1.1, 1.35, 2.62)
    grid = ts.Grid(lo, hi, voxel)
    for pr in prims:
        grid.apply(pr)
    log(f'moose field: {grid.n.tolist()} voxels of {voxel}')
    g = vdb.FloatGrid(0.2)
    g.copyFromArray(grid.d)
    pts, quads = g.convertToQuads(isovalue=0.0)
    return lo + np.asarray(pts, float) * voxel, np.asarray(quads, int)


def _tidy(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges[:], dist=1e-7)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    # Only the largest shell (the field closes nothing else worth keeping).
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen:
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
    drop = [v for comp in islands[1:] for v in comp] + [v for v in bm.verts if not v.link_faces]
    if drop:
        bmesh.ops.delete(bm, geom=list(set(drop)), context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()


def weights_and_kinds(P, prims, soft=0.035):
    """Each vertex's bone weights (top four, from the masses each bone carries, soft across the
    joints) and what it is (the part of the nearest mass)."""
    order = list(MOOSE.keys())
    n = len(P)
    W = np.zeros((n, len(order)))
    best = np.full(n, 1e3)
    kind = np.zeros(n)
    for pr in prims:
        if pr.op != 'add':
            continue
        lo, hi = pr.aabb()
        sel = np.all((P >= lo - 0.08) & (P <= hi + 0.08), axis=1)
        if not np.any(sel):
            continue
        d = np.abs(pr.sdf(P[sel]))
        bone = order.index(pr.tag['bone'])
        W[sel, bone] = np.maximum(W[sel, bone], np.exp(-d / soft))
        closer = d < best[sel]
        idx = np.where(sel)[0][closer]
        best[idx] = d[closer]
        kind[idx] = KIND[pr.part]
    # Above the knees the leg is his hide (the long pale stockings start below the elbow and stifle).
    return W, kind


def build(out_dir, log=print, preview_dir=None, voxel=VOXEL):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prims = design()
    verts, quads = surface(prims, voxel=voxel, log=log)
    me = bpy.data.meshes.new('MooseSurface')
    me.from_pydata(verts.tolist(), [], quads.tolist())
    me.validate()
    obj = bpy.data.objects.new('Moose', me)
    bpy.context.scene.collection.objects.link(obj)
    _tidy(me)
    centre = np.array([v.co[:] for v in me.vertices]).mean(0)
    fn = np.array([p.normal[:] for p in me.polygons])
    fc = np.array([p.center[:] for p in me.polygons])
    if (np.einsum('ij,ij->i', fn, fc - centre) > 0).mean() < 0.5:
        me.flip_normals()
    src = len(me.polygons)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    dec = obj.modifiers.new('dec', 'DECIMATE')
    dec.decimate_type = 'COLLAPSE'
    dec.ratio = min(1.0, TRIANGLES / src)
    bpy.ops.object.modifier_apply(modifier='dec')
    _tidy(me)
    for p in me.polygons:
        p.use_smooth = True
    log(f'moose surface: {src} faces meshed, {len(me.polygons)} kept, {len(me.vertices)} vertices')
    P = np.array([v.co[:] for v in me.vertices])
    W, kind = weights_and_kinds(P, prims)
    order = list(MOOSE.keys())
    groups = {name: obj.vertex_groups.new(name=name) for name in order}
    for i in range(len(P)):
        top = np.argsort(-W[i])[:4]
        total = float(W[i, top].sum()) or 1.0
        for j in top:
            w = float(W[i, j]) / total
            if w > 1e-4:
                groups[order[j]].add([i], w, 'REPLACE')
    # Ambient occlusion, baked into a colour attribute on the CPU.
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.seed = 7
    scene.render.bake.target = 'VERTEX_COLORS'
    mat = bpy.data.materials.new('bake')
    mat.use_nodes = True
    me.materials.append(mat)
    ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = ao
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='AO')
    log('baked ambient occlusion')
    if preview_dir is not None:
        preview(obj, kind, preview_dir, log=log)

    def colour(i):
        return (kind[i], ao.data[i].color[0], 0.0, 1.0)

    path = out_dir / 'moose.glb'
    n, tris, size = write_figure(obj, MOOSE, colour, str(path), 'Serenity Blocks - Stillwater moose (Blender, built from numbers)', {
        'stillwaterMoose': 1,
        'units': 'metres, his hooves at y = 0',
        'colour': 'r kind (0 hide, 0.2 eye, 0.4 leg, 0.7 muzzle, 1 antler), g ambient occlusion',
    })
    log(f'wrote {path.name}: {n} vertices, {tris} triangles, {size} bytes')
    return [path]


def preview(obj, kind, out_dir, log=print):
    """What each part is, seen from the side, from three quarters and small, as the game sees him."""
    from mathutils import Vector
    me = obj.data
    pal = {0.0: (0.24, 0.17, 0.12), 0.2: (0.05, 0.05, 0.05), 0.4: (0.6, 0.55, 0.48), 0.7: (0.38, 0.3, 0.24),
           1.0: (0.85, 0.8, 0.68)}
    keys = np.array(sorted(pal.keys()))
    col = np.array([pal[keys[np.argmin(np.abs(keys - k))]] for k in kind])
    look = me.color_attributes.new('Look', 'FLOAT_COLOR', 'POINT')
    look.data.foreach_set('color', np.concatenate([col, np.ones((len(col), 1))], 1).ravel().astype(np.float32))
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    me.color_attributes.active_color = look
    scene.render.resolution_x = 640
    scene.render.resolution_y = 520
    cam = bpy.data.objects.new('previewCam', bpy.data.cameras.new('previewCam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 4.0
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, -0.25, 1.2))
    for name, d in (('side', Vector((1, 0, 0.02))), ('q34', Vector((0.75, -0.65, 0.18))), ('front', Vector((0, -1, 0.05))),
                    ('above', Vector((0.3, -0.2, 1)))):
        d = d.normalized()
        cam.location = target + d * 8
        cam.rotation_euler = (d * -1).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(out_dir / f'moose-{name}.png')
        bpy.ops.render.render(write_still=True)
    log(f'previews written to {out_dir}')
