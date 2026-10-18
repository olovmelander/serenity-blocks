"""The spirit: a slender figure in a long gown with gold hair to her knees, built from numbers.

A smooth body (Blender's skin modifier over a stick figure, subdivided: arms, hands with a thumb,
neck), an egg of a head with a quiet face, a cap and a fall of hair with two locks over her
shoulders, a gown (a fitted bodice falling into a flared skirt with folds and a train), bell
sleeves and a thin circlet. Weights: the skin by distance to the body's bones; the gown by height
along the torso, its skirt shared among four panels by the way it faces; the hair by height down
two links that the runtime lets hang; the sleeves by the arm. Each vertex also carries how freely
it moves (the runtime sways it) and baked ambient occlusion. Two files: the full figure and half.
"""

import math

import bmesh
import bpy
from mathutils import Vector

from .figure_glb import write_figure
from .rigs import SPIRIT, SPIRIT_BODY, build_armature

#: Share of the full figure's triangles in each file (Medium and up, Low and Minimal).
LOD_SHARE = (1.0, 0.5)


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def _new(name, me):
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def _apply_all(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def build_body():
    """A skin-modifier stick figure: torso, neck, arms, hands with thumbs (her legs are never seen)."""
    verts = {
        'pelvis': ((0, 0.0, 0.5), (0.07, 0.055)),
        'waist': ((0, 0.004, 0.615), (0.05, 0.04)),
        'chest': ((0, 0.0, 0.72), (0.068, 0.05)),
        'bust': ((0, -0.004, 0.77), (0.07, 0.05)),
        'neckBase': ((0, 0.002, 0.82), (0.042, 0.034)),
        'neckTop': ((0, -0.004, 0.875), (0.026, 0.028)),
    }
    for s, sx in (('L', 1), ('R', -1)):
        verts['shoulder' + s] = ((sx * 0.092, 0.004, 0.808), (0.03, 0.03))
        verts['elbow' + s] = ((sx * 0.118, 0.012, 0.657), (0.022, 0.022))
        verts['wrist' + s] = ((sx * 0.126, -0.012, 0.508), (0.0155, 0.0135))
        verts['palm' + s] = ((sx * 0.125, -0.02, 0.462), (0.012, 0.019))
        verts['tips' + s] = ((sx * 0.123, -0.028, 0.418), (0.007, 0.014))
        verts['thumb' + s] = ((sx * 0.117, -0.04, 0.47), (0.006, 0.006))
    edges = [('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'bust'), ('bust', 'neckBase'), ('neckBase', 'neckTop')]
    for s in 'LR':
        edges += [('neckBase', 'shoulder' + s), ('shoulder' + s, 'elbow' + s), ('elbow' + s, 'wrist' + s),
                  ('wrist' + s, 'palm' + s), ('palm' + s, 'tips' + s), ('wrist' + s, 'thumb' + s)]
    names = list(verts)
    me = bpy.data.meshes.new('body')
    me.from_pydata([verts[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in edges], [])
    o = _new('Body', me)
    o.modifiers.new('skin', 'SKIN')
    for i, n in enumerate(names):
        sv = me.skin_vertices[0].data[i]
        sv.radius = verts[n][1]
        if n == 'pelvis':
            sv.use_root = True
    sub = o.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    _apply_all(o)
    return o


def build_head():
    """An egg with a quiet face: a narrower jaw, a small nose, the shallow of the eyes."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
    c = Vector((0, -0.008, 0.936))
    for v in bm.verts:
        x, y, z = v.co
        jaw = smooth(0.1, -0.9, z)
        p = Vector((x * 0.047 * (1 - 0.3 * jaw), y * 0.056 * (1 - 0.12 * jaw) * (1.06 if y > 0 else 0.96), z * 0.066))
        front = max(0.0, -y)
        p.y -= 0.006 * jaw * front
        p.y -= 0.011 * math.exp(-((x / 0.18) ** 2) - ((z + 0.12) / 0.25) ** 2) * front ** 4
        p.y += 0.0035 * math.exp(-(((abs(x) - 0.38) / 0.17) ** 2) - ((z - 0.08) / 0.13) ** 2) * front ** 2
        v.co = p + c
    me = bpy.data.meshes.new('head')
    bm.to_mesh(me)
    bm.free()
    o = _new('Head', me)
    for poly in me.polygons:
        poly.use_smooth = True
    return o


def loft(name, rings, closed=True, centres=None):
    """Join rings into a surface whose faces look away from each ring's centre (or `centres[k]`)."""
    bm = bmesh.new()
    rows = [[bm.verts.new(Vector(p)) for p in ring] for ring in rings]
    n = len(rings[0])
    for k, (a, b) in enumerate(zip(rows[:-1], rows[1:])):
        last = n if closed else n - 1
        if centres is not None:
            c = (Vector(centres[k]) + Vector(centres[k + 1])) * 0.5
        else:
            c = sum((v.co for v in a + b), Vector()) / (2 * n)
        for i in range(last):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.normal_update()
            if f.normal.dot(f.calc_center_median() - c) < 0:
                f.normal_flip()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _new(name, me)
    for poly in me.polygons:
        poly.use_smooth = True
    return o


def build_gown():
    """A fitted bodice falling into a flared skirt with folds, its train lying behind her."""
    prof = [  # (z, rx, ry front, ry back)
        (0.83, 0.098, 0.05, 0.05), (0.80, 0.085, 0.056, 0.05), (0.76, 0.079, 0.064, 0.05), (0.70, 0.068, 0.052, 0.046),
        (0.64, 0.061, 0.046, 0.043), (0.59, 0.07, 0.053, 0.055), (0.53, 0.088, 0.066, 0.07), (0.45, 0.103, 0.082, 0.088),
        (0.36, 0.118, 0.097, 0.108), (0.27, 0.134, 0.112, 0.132), (0.18, 0.152, 0.127, 0.16), (0.1, 0.172, 0.142, 0.196),
        (0.04, 0.19, 0.156, 0.236), (0.0, 0.2, 0.162, 0.27),
    ]
    sides = 72
    rings = []
    for z, rx, ryf, ryb in prof:
        ring = []
        for i in range(sides):
            a = (i / sides) * math.tau  # 0 her front (-Y), pi her back
            ca, sa = math.cos(a), math.sin(a)
            ry = lerp(ryb, ryf, 0.5 + 0.5 * ca)
            fold = smooth(0.58, 0.0, z)
            r_fold = 1 + 0.07 * fold * math.sin(9 * a + 0.4) + 0.035 * fold * math.sin(5 * a + 1.9)
            zz = z
            if z > 0.82:
                zz = z - 0.03 * max(0.0, ca) ** 2  # the neckline: a soft scoop, lower in front
            if z < 0.05:
                zz = z + 0.012 * max(0.0, ca)  # the front hem just clears the ground
            ring.append((sa * rx * r_fold, -ca * ry * r_fold, zz))
        rings.append(ring)
    return loft('Gown', rings)


def build_sleeve(sx):
    """Along the arm, shoulder to elbow to wrist, opening below the elbow into a gentle bell."""
    sh = Vector((sx * 0.094, 0.004, 0.814))
    el = Vector((sx * 0.118, 0.012, 0.657))
    wr = Vector((sx * 0.126, -0.012, 0.5))
    steps = [(0.0, 0.034), (0.25, 0.03), (0.5, 0.026), (0.75, 0.024), (1.0, 0.025), (1.3, 0.026), (1.6, 0.031),
             (1.85, 0.038), (2.0, 0.045)]
    rings = []
    for s, r in steps:
        if s <= 1.0:
            c, axis = sh.lerp(el, s), (el - sh).normalized()
        else:
            c, axis = el.lerp(wr, s - 1.0), (wr - el).normalized()
        side = (Vector((1, 0, 0)) - axis * axis.x).normalized()
        fwd = axis.cross(side).normalized()
        ring = []
        for i in range(20):
            a = (i / 20) * math.tau
            fold = 1 + (0.07 * math.sin(5 * a) * smooth(1.4, 2.0, s) if s > 1.4 else 0.0)
            p = c + (side * math.cos(a) + fwd * math.sin(a)) * r * fold
            if s > 1.6:
                p.z -= 0.022 * max(0.0, -math.cos(a) * sx) * (s - 1.6) / 0.4  # longer on the inside
            ring.append(tuple(p))
        rings.append(ring)
    return loft('Sleeve' + ('L' if sx > 0 else 'R'), rings)


def build_hair():
    """A cap over her crown, a fall down her back to below the knee, two locks over her shoulders."""
    objs = []
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
    c = Vector((0, -0.006, 0.938))
    kill = []
    for v in bm.verts:
        x, y, z = v.co
        line = 0.42 * max(0.0, -y) - 0.6 * max(0.0, y) + 0.02
        if z < line - 0.02 * abs(x):
            kill.append(v)
        part = 0.004 * math.exp(-(x / 0.06) ** 2) * max(0.0, z)
        v.co = Vector((x * 0.0505, y * 0.0595 + (0.004 if y > 0 else 0.0), z * 0.0685 - part)) + c
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    me = bpy.data.meshes.new('HairCap')
    bm.to_mesh(me)
    bm.free()
    cap = _new('HairCap', me)
    for poly in me.polygons:
        poly.use_smooth = True
    objs.append(cap)
    prof = [  # (z, rx, ry, angular span round her back)
        (0.93, 0.052, 0.04, 1.75), (0.88, 0.056, 0.046, 1.85), (0.84, 0.072, 0.055, 1.95), (0.79, 0.086, 0.06, 2.05),
        (0.72, 0.09, 0.062, 2.0), (0.64, 0.088, 0.066, 1.95), (0.55, 0.094, 0.078, 1.9), (0.46, 0.1, 0.094, 1.85),
        (0.38, 0.106, 0.108, 1.8), (0.31, 0.11, 0.12, 1.7), (0.26, 0.108, 0.128, 1.55),
    ]
    rings = []
    for z, rx, ry, span in prof:
        ring = []
        for i in range(31):
            t = i / 30
            a = math.pi + (t - 0.5) * span
            wave = 1 + 0.06 * math.sin(11 * t + z * 9) * smooth(0.85, 0.4, z)
            zz = z - 0.05 * (0.5 + 0.5 * math.sin(t * math.tau * 3.0 + 0.8)) if z < 0.3 else z
            ring.append((math.sin(a) * rx * wave, -math.cos(a) * ry * wave + 0.012, zz))
        rings.append(ring)
    objs.append(loft('HairFall', rings, closed=False, centres=[(0, -0.01, r[0][2]) for r in rings]))
    for sx in (1, -1):
        path = [Vector((sx * 0.044, -0.022, 0.95)), Vector((sx * 0.052, -0.03, 0.88)), Vector((sx * 0.06, -0.05, 0.8)),
                Vector((sx * 0.058, -0.064, 0.72)), Vector((sx * 0.05, -0.062, 0.64)), Vector((sx * 0.046, -0.058, 0.57))]
        rings = []
        for k, p in enumerate(path):
            w = 0.017 * (1 - 0.55 * k / (len(path) - 1))
            rings.append([(p.x + math.cos(a) * w, p.y + math.sin(a) * w * 0.45, p.z)
                          for a in ((i / 8) * math.tau for i in range(8))])
        objs.append(loft('Lock' + ('L' if sx > 0 else 'R'), rings))
    return objs


def build_circlet():
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=False, radius=1.0, segments=48)
    me = bpy.data.meshes.new('circ')
    bm.to_mesh(me)
    bm.free()
    o = _new('Circlet', me)
    o.modifiers.new('skin', 'SKIN')
    for i, v in enumerate(me.vertices):
        a = math.atan2(v.co.y, v.co.x)
        front = max(0.0, -math.sin(a))
        v.co = Vector((math.cos(a) * 0.0525, math.sin(a) * 0.061 - 0.004, 0.962 - 0.012 * front))
        me.skin_vertices[0].data[i].radius = (0.0032, 0.0032)
    _apply_all(o)
    return o


KIND = {'Body': 0.0, 'Head': 0.0, 'Gown': 1.0, 'SleeveL': 2.0, 'SleeveR': 2.0, 'HairCap': 3.0, 'HairFall': 3.0,
        'LockL': 3.0, 'LockR': 3.0, 'Circlet': 4.0}


def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def _envelope(p, names):
    """Weights by distance to each bone's segment (an inverse fourth power, normalised)."""
    w = {n: 1.0 / (_seg_dist(p, Vector(SPIRIT[n][1]), Vector(SPIRIT[n][2])) ** 4 + 1e-9) for n in names}
    s = sum(w.values())
    return {k: v / s for k, v in w.items()}


def _torso_by_height(z):
    head = smooth(0.85, 0.9, z)
    neck = smooth(0.8, 0.86, z) * (1 - head)
    chest = smooth(0.66, 0.74, z) * (1 - head - neck)
    spine = smooth(0.56, 0.64, z) * (1 - head - neck - chest)
    hips = max(0.0, 1 - head - neck - chest - spine)
    return {k: v for k, v in (('head', head), ('neck', neck), ('chest', chest), ('spine', spine), ('hips', hips)) if v > 1e-4}


def _weigh(p, kind, lock):
    """(weights by bone, how freely it moves) for one vertex."""
    if kind < 0.5:  # skin
        return ({'head': 1.0} if p.z > 0.875 and abs(p.x) < 0.07 else _envelope(p, SPIRIT_BODY)), 0.0
    if kind < 1.5:  # gown
        skirt = smooth(0.52, 0.18, p.z)
        w = {k: v * (1 - skirt) for k, v in _torso_by_height(p.z).items()}
        a = math.atan2(p.x, -p.y)
        lobes = {'skirtF': max(0.0, math.cos(a)) ** 2, 'skirtB': max(0.0, -math.cos(a)) ** 2,
                 'skirtL': max(0.0, math.sin(a)) ** 2, 'skirtR': max(0.0, -math.sin(a)) ** 2}
        s = sum(lobes.values()) or 1.0
        for k, v in lobes.items():
            if v > 1e-4:
                w[k] = w.get(k, 0.0) + skirt * v / s
        return w, smooth(0.55, 0.0, p.z)
    if kind < 2.5:  # sleeves
        side = 'L' if p.x > 0 else 'R'
        w = _envelope(p, ['clav' + side, 'upper' + side, 'fore' + side, 'hand' + side])
        w.pop('hand' + side, None)
        s = sum(w.values()) or 1.0
        return {k: v / s for k, v in w.items()}, smooth(0.58, 0.48, p.z) * 0.8
    if kind < 3.5:  # hair
        if lock > 0.5:
            hz = smooth(0.86, 0.9, p.z)
            return {'head': hz, 'chest': 1 - hz}, smooth(0.85, 0.6, p.z) * 0.6
        if p.z > 0.9 or (p.y < 0.03 and p.z > 0.86):
            return {'head': 1.0}, 0.0
        a = smooth(0.88, 0.62, p.z)
        b = smooth(0.6, 0.35, p.z)
        return {'head': max(0.0, 1 - a), 'hair1': a * (1 - b), 'hair2': a * b}, smooth(0.85, 0.3, p.z)
    return {'head': 1.0}, 0.0  # the circlet


def build_figure(log=print):
    """The joined, weighted figure (one object) with its colour attributes; returns it."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = [build_body(), build_head(), build_gown(), build_circlet(), build_sleeve(1), build_sleeve(-1)] + build_hair()
    for o in parts:
        me = o.data
        a = me.attributes.new('kind', 'FLOAT', 'POINT')
        b = me.attributes.new('lock', 'FLOAT', 'POINT')
        for i in range(len(me.vertices)):
            a.data[i].value = KIND[o.name]
            b.data[i].value = 1.0 if o.name.startswith('Lock') else 0.0
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    spirit = bpy.context.active_object
    spirit.name = 'Spirit'
    me = spirit.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    kind = [me.attributes['kind'].data[i].value for i in range(len(me.vertices))]
    lock = [me.attributes['lock'].data[i].value for i in range(len(me.vertices))]
    weighed = [_weigh(v.co, kind[i], lock[i]) for i, v in enumerate(me.vertices)]
    pack = me.color_attributes.new('Pack', 'FLOAT_COLOR', 'POINT')
    for i in range(len(me.vertices)):
        k = kind[i]
        # r skin, g hair (both: the gold circlet), b how freely it moves, a (later) occlusion.
        pack.data[i].color = (1.0 if (k < 0.5 or k > 3.5) else 0.0, 1.0 if k > 2.5 else 0.0, weighed[i][1], 1.0)
    # (Nothing else selected: the armature's edit mode must not take the figure into it.)
    bpy.ops.object.select_all(action='DESELECT')
    build_armature(bpy, SPIRIT, 'SpiritRig')
    for name in SPIRIT:
        spirit.vertex_groups.new(name=name)
    for i, (w, _) in enumerate(weighed):
        top = sorted([(k, x) for k, x in w.items() if x > 1e-4], key=lambda t: -t[1])[:4]
        s = sum(x for _, x in top) or 1.0
        for k, x in top:
            spirit.vertex_groups[k].add([i], x / s, 'REPLACE')
    log(f'spirit: {len(me.vertices)} vertices, {len(me.polygons)} triangles')
    return spirit


def build(out_dir, log=print):
    """The spirit's two files."""
    from .troll import bake_ao
    spirit = build_figure(log=log)
    written = []
    for li, share in enumerate(LOD_SHARE):
        bpy.ops.object.select_all(action='DESELECT')
        spirit.select_set(True)
        bpy.context.view_layer.objects.active = spirit
        bpy.ops.object.duplicate()
        obj = bpy.context.active_object
        obj.name = f'SpiritLOD{li}'
        if share < 1.0:
            dec = obj.modifiers.new('dec', 'DECIMATE')
            dec.ratio = share
            bpy.ops.object.modifier_apply(modifier='dec')
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.triangulate(bm, faces=bm.faces)
            bm.to_mesh(obj.data)
            bm.free()
        bake_ao([obj], samples=64, log=log)
        pack = obj.data.color_attributes['Pack']
        ao = obj.data.color_attributes['AO']

        def colour(i, pack=pack, ao=ao):
            p = pack.data[i].color
            return (p[0], p[1], p[2], ao.data[i].color[0])
        path = out_dir / f'spirit-lod{li}.glb'
        n, tris, size = write_figure(obj, SPIRIT, colour, str(path), 'Serenity Blocks - Stillwater spirit (Blender authoring)', {
            'stillwaterSpirit': 1,
            'colour': 'r skin, g hair (both: the gold circlet), b how freely it moves, a ambient occlusion',
        })
        log(f'wrote {path.name}: {n} vertices, {tris} triangles, {size} bytes')
        written.append(path)
        obj.hide_render = True
    return written
