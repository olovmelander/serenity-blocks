"""Mesh the cast, tell every vertex what it is, and write src/themes/ocean/assets/creatures.glb.

For each animal: its field is meshed once (openvdb, as Stillwater's troll), the outer shell kept,
decimated (symmetric about x) to its triangle budget, its normals taken from the field's gradient
(smoother than the decimated faces'), its ambient occlusion from the field, and each vertex told
which primitive it lies nearest: its part, side, place along the body, how far out along its fin
and where that fin turns from. The runtime (src/themes/ocean/ocean-creatures.js) reads:

  POSITION   int16, the node's scale and translation restore units (KHR_mesh_quantization)
  NORMAL     int8
  _SHAPE     uint8 rgba: (along the body 0 nose .. 1 tail, (part * 3 + side + 1) / 255,
             how far out along the fin 0..1, kind / 255)
  _SKIN      uint8 rgba: (ambient occlusion, pattern mask a, pattern mask b, eye)
  _PIVOT     int16 rgba: (where the vertex's part turns from xyz, 0)
"""

import math

import bmesh
import bpy
import numpy as np

from fall_grove.glb import GlbWriter, quantize_unit

from . import sdf
from .cast import CAST, FAMILIES, PARTS

PART_TINTS = {
    0: (0.6, 0.6, 0.6), 1: (0.85, 0.25, 0.2), 2: (0.2, 0.35, 0.9), 3: (0.2, 0.75, 0.3),
    4: (0.9, 0.8, 0.2), 5: (0.8, 0.3, 0.8), 6: (0.02, 0.02, 0.02),
}


def _clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _tidy(me, triangulate=False, outer_only=False, log=print, name=''):
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
            log(f'{name}: kept the outer shell, dropped {len(islands) - 1} islands '
                f'({sum(len(c) for c in islands[1:])} vertices)')
    if drop:
        bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(me)
    bm.free()
    me.update()


def mesh_kind(name, log=print):
    """One animal as a decimated mesh object, with everything its vertices carry."""
    prims, meta = CAST[name]()
    verts, faces = sdf.surface(prims, meta['voxel'], log=log, name=name, adaptivity=meta.get('adapt', 0.0))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces)
    me.validate()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    _tidy(me, outer_only=True, log=log, name=name)
    centre = np.array([v.co[:] for v in me.vertices]).mean(0)
    fn = np.array([p.normal[:] for p in me.polygons])
    fc = np.array([p.center[:] for p in me.polygons])
    if (np.einsum('ij,ij->i', fn, fc - centre) > 0).mean() < 0.5:
        me.flip_normals()
    src = sum(len(p.vertices) - 2 for p in me.polygons)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    dec = obj.modifiers.new('dec', 'DECIMATE')
    dec.decimate_type = 'COLLAPSE'
    dec.ratio = min(1.0, meta['triangles'] / max(src, 1))
    dec.use_symmetry = True
    dec.symmetry_axis = 'X'
    bpy.ops.object.modifier_apply(modifier='dec')
    _tidy(me, triangulate=True, name=name)
    for p in me.polygons:
        p.use_smooth = True

    P = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    tris = np.array([p.vertices[:] for p in me.polygons], dtype=np.int64)
    N = sdf.gradient(prims, P)
    # (Where the field's gradient is degenerate, fall back on the mesh's own normal.)
    mesh_n = np.array([v.normal[:] for v in me.vertices])
    bad = ~np.isfinite(N).all(1) | (np.linalg.norm(N, axis=1) < 0.5) | ((N * mesh_n).sum(1) < -0.2)
    N[bad] = mesh_n[bad]
    # The runtime culls back faces: a triangle the decimator folded against its corners' normals
    # would be a pin hole. Wind every triangle the way its corners face.
    g = np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]])
    m = N[tris[:, 0]] + N[tris[:, 1]] + N[tris[:, 2]]
    flip = (g * m).sum(1) < 0
    if flip.any():
        tris[flip] = tris[flip][:, [0, 2, 1]]
        log(f'{name}: rewound {int(flip.sum())} folded triangles')
    idx, _ = sdf.nearest_parts(prims, P)
    n = len(P)
    part = np.zeros(n, int)
    side = np.zeros(n, int)
    along = np.clip((meta['nose'] - P[:, 2]) / (meta['nose'] - meta['tail']), 0.0, 1.0)
    span = np.zeros(n)
    pivot = np.zeros((n, 3))
    for i in range(n):
        pr = prims[idx[i]] if idx[i] >= 0 else None
        if pr is None:
            continue
        part[i] = PARTS[pr.part]
        m = pr.meta
        sd = m.get('side', 0)
        if pr.part == 'eye':
            sd = 1 if P[i, 0] > 0 else -1
        side[i] = int(np.sign(sd))
        if 'along' in m:
            along[i] = m['along']
        if 'pivot' in m:
            pivot[i] = m['pivot']
            if 'span' in m and m.get('reach', 0) > 0:
                span[i] = np.clip(((P[i] - m['pivot']) @ m['span']) / m['reach'], 0.0, 1.0)
    ao = sdf.ambient(prims, P, N, reach=0.035)
    m1, m2 = meta['masks'](P, N, part, along)
    eye = (part == PARTS['eye']).astype(float)
    counts = {k: int((part == v).sum()) for k, v in PARTS.items()}
    log(f'{name}: {n} vertices, {len(tris)} triangles; parts {counts}; '
        f'ao {ao.min():.2f}..{ao.max():.2f}; extent {P.min(0).round(3).tolist()} .. {P.max(0).round(3).tolist()}')
    data = {
        'P': P, 'N': N, 'tris': tris, 'part': part, 'side': side, 'along': along, 'span': span,
        'pivot': pivot, 'ao': ao, 'm1': np.clip(m1, 0, 1), 'm2': np.clip(m2, 0, 1), 'eye': eye,
        'meta': meta,
    }
    return obj, data


def write_pack(path, cast, log=print):
    writer = GlbWriter(generator='Serenity Blocks - Ocean creatures (Blender, built from numbers)')
    names = list(CAST.keys())
    for name, (obj, d) in cast.items():
        kind = names.index(name)
        n = len(d['P'])
        code = d['part'] * 3 + d['side'] + 1
        shape = np.stack([d['along'], code / 255.0, d['span'], np.full(n, kind / 255.0)], 1)
        skin = np.stack([d['ao'], d['m1'], d['m2'], d['eye']], 1)
        piv = np.concatenate([d['pivot'], np.zeros((n, 1))], 1)
        unit = d['N'] / np.maximum(np.linalg.norm(d['N'], axis=1, keepdims=True), 1e-9)
        meta = d['meta']
        writer.add_mesh(name, {
            'POSITION': (d['P'], False),
            'NORMAL': (quantize_unit(unit, np.int8), True),
            '_SHAPE': (quantize_unit(np.clip(shape, 0, 1), np.uint8), True),
            '_SKIN': (quantize_unit(np.clip(skin, 0, 1), np.uint8), True),
            '_PIVOT': (quantize_unit(np.clip(piv, -1, 1), np.int16), True),
        }, indices=d['tris'], extras={
            'kind': kind, 'family': FAMILIES[meta['family']], 'nose': meta['nose'], 'tail': meta['tail'],
            'triangles': int(len(d['tris'])),
        })
    writer.set_extras({
        'oceanCreatures': 1,
        'kinds': names,
        'shape': 'r along the body (0 nose, 1 tail), g (part * 3 + side + 1) / 255 (parts: 0 body, 1 pectoral, '
                 '2 tail, 3 dorsal, 4 head, 5 rear, 6 eye), b how far out along its fin, a kind / 255',
        'skin': 'r ambient occlusion, g pattern a, b pattern b, a eye',
        'pivot': 'xyz where the part turns from (units), w 0',
    })
    size = writer.write(str(path))
    log(f'wrote {path} ({size} bytes)')
    return size


# ── Review sheets ──


def _look(name, d):
    """A plain colouring for review: dark above, pale below, the masks, the eye."""
    N, m1, m2, eye = d['N'], d['m1'], d['m2'], d['eye']
    up = np.clip((N[:, 1] + 0.3) / 0.6, 0, 1)[:, None]
    back = np.array({'turtle': (0.3, 0.22, 0.1), 'sunfish': (0.42, 0.44, 0.46), 'whaleShark': (0.16, 0.2, 0.26),
                     'hammerhead': (0.33, 0.33, 0.3)}.get(name, (0.08, 0.09, 0.11)))
    belly = np.array((0.85, 0.86, 0.85))
    col = belly * (1 - up) + back * up
    tint = {'humpback': ((0.6, 0.6, 0.62), (0.95, 0.95, 0.95)), 'manta': ((0.9, 0.9, 0.9), (0.1, 0.1, 0.12)),
            'dolphin': ((0.18, 0.2, 0.24), (1, 1, 1)), 'turtle': ((0.45, 0.32, 0.12), (0.8, 0.72, 0.4)),
            'whaleShark': ((0.05, 0.04, 0.04), (0.1, 0.1, 0.1)), 'eagleRay': ((0.1, 0.12, 0.18), (1, 1, 1)),
            'sunfish': ((0.15, 0.12, 0.1), (0.15, 0.15, 0.15))}.get(name, ((0.5, 0.5, 0.5), (0.5, 0.5, 0.5)))
    col = col * (1 - m1[:, None]) + np.array(tint[0]) * m1[:, None]
    col = col * (1 - m2[:, None]) + np.array(tint[1]) * m2[:, None]
    col = col * (1 - eye[:, None]) + 0.01 * eye[:, None]
    return col * (0.35 + 0.65 * d['ao'][:, None])


def _parts(d):
    col = np.array([PART_TINTS[int(p)] for p in d['part']])
    return col * (0.45 + 0.55 * (1 - d['span'][:, None]))


def _set_colour(obj, rgb, layer):
    me = obj.data
    attr = me.color_attributes.get(layer) or me.color_attributes.new(layer, 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', np.concatenate([rgb, np.ones((len(rgb), 1))], 1).ravel().astype(np.float32))


def _material(layer):
    mat = bpy.data.materials.new(layer)
    mat.use_nodes = True
    nt = mat.node_tree
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = layer
    bsdf = nt.nodes['Principled BSDF']
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.55
    return mat


def review(cast, out_dir, log=print, size=(420, 260)):
    """Per animal: side, top, under and three-quarter views in a plain colouring, then side and
    top with each part false-coloured (lighter toward its root). One PNG sheet per animal."""
    from mathutils import Matrix, Vector
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 10
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('review')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.55, 0.62, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (0.35, 0.25, 0.0)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    scene.collection.objects.link(cam)
    scene.camera = cam
    look_mat, parts_mat = _material('Look'), _material('Parts')
    sheets = []
    for name, (obj, d) in cast.items():
        _set_colour(obj, _look(name, d), 'Look')
        _set_colour(obj, _parts(d), 'Parts')
        # (The runtime's frame is y up, nose +z; Blender's is z up: stand it up for the camera.)
        obj.rotation_euler = (math.pi / 2, 0.0, 0.0)
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.hide_render = o is not obj
        P = d['P']
        span = P.max(0) - P.min(0)
        aspect = size[0] / size[1]
        # (Frame each view on what it shows: side = length by height, top and under = length by width.)
        fit = {
            'side': max(span[2], span[1] * aspect), 'top': max(span[2], span[0] * aspect),
            'under': max(span[2], span[0] * aspect), 'q34': max(span) * 1.25,
        }
        mid = (P.max(0) + P.min(0)) * 0.5
        centre = Vector((mid[0], -mid[2], mid[1]))
        tiles = []
        views = [('side', Vector((1, 0, 0)), look_mat), ('top', Vector((0, 0, 1)), look_mat),
                 ('under', Vector((0, 0, -1)), look_mat), ('q34', Vector((0.8, -0.9, 0.55)).normalized(), look_mat),
                 ('side-parts', Vector((1, 0, 0)), parts_mat), ('top-parts', Vector((0, 0, 1)), parts_mat)]
        for label, direction, mat in views:
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            cam.data.ortho_scale = fit[label.split('-')[0]] * 1.08
            cam.location = centre + direction * 4
            # Look at the animal with its back up (or, from above and below, its nose to the left).
            f = (-direction).normalized()
            up_world = Vector((1, 0, 0)) if abs(direction.z) > 0.9 else Vector((0, 0, 1))
            r = f.cross(up_world).normalized()
            u = r.cross(f)
            cam.rotation_euler = Matrix((r, u, -f)).transposed().to_euler()
            path = out_dir / f'_{name}-{label}.png'
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            tiles.append(path)
        sheet = out_dir / f'{name}.png'
        _compose(tiles, sheet, cols=3, size=size)
        for t in tiles:
            t.unlink()
        sheets.append(sheet)
        obj.rotation_euler = (0.0, 0.0, 0.0)
        log(f'review sheet: {sheet}')
    return sheets


def _compose(paths, out, cols, size):
    w, h = size
    rows = int(math.ceil(len(paths) / cols))
    canvas = np.zeros((rows * h, cols * w, 4), np.float32)
    for i, p in enumerate(paths):
        img = bpy.data.images.load(str(p))
        px = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)
        r, c = divmod(i, cols)
        # (Image rows run bottom-up.)
        y0 = (rows - 1 - r) * h
        canvas[y0:y0 + h, c * w:(c + 1) * w] = px[:h, :w]
        bpy.data.images.remove(img)
    sheet = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    sheet.pixels.foreach_set(canvas.ravel())
    sheet.filepath_raw = str(out)
    sheet.file_format = 'PNG'
    sheet.save()
    bpy.data.images.remove(sheet)


def build(out_path, only=None, review_dir=None, log=print):
    _clear()
    cast = {}
    for name in CAST:
        if only and name not in only:
            continue
        cast[name] = mesh_kind(name, log=log)
    if out_path is not None:
        write_pack(out_path, cast, log=log)
    if review_dir is not None:
        review(cast, review_dir, log=log)
    return cast
