"""
Beauty previews of Odyssey's forest in Blender (2026-11-24): the grown trees with their real leaves,
under a low sun and a blue sky, to judge shape, mass and variety before anything reaches the game.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

import families
import studio
from growth import rng_of, wood_mesh

BARKS = {'brown': (0.10, 0.065, 0.04), 'oak': (0.11, 0.085, 0.06), 'grey': (0.20, 0.19, 0.17), 'birch': (0.62, 0.60, 0.55),
         'aspen': (0.50, 0.50, 0.40), 'dark': (0.06, 0.042, 0.032), 'cherry': (0.085, 0.045, 0.04), 'pine': (0.30, 0.13, 0.06),
         'silver': (0.42, 0.40, 0.37)}


# A conifer's bough falls to both sides of its branch, like a roof: two sprays rolled apart.
ROOFED = {'spruce': 0.75, 'fir': 0.45, 'larch': 0.8}


def leaf_material(fam, rgb):
    mat = bpy.data.materials.get('OF_leaf_' + fam) or bpy.data.materials.new('OF_leaf_' + fam)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tone = nt.nodes.new('ShaderNodeAttribute')
    tone.attribute_name = 'tone'
    kind = nt.nodes.new('ShaderNodeAttribute')
    kind.attribute_name = 'kind'
    rnd = nt.nodes.new('ShaderNodeObjectInfo')
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['To Min'].default_value = 0.55
    ramp.inputs['To Max'].default_value = 1.25
    nt.links.new(tone.outputs['Fac'], ramp.inputs['Value'])
    base = nt.nodes.new('ShaderNodeMixRGB')
    base.blend_type = 'MULTIPLY'
    base.inputs[0].default_value = 1
    base.inputs[1].default_value = (*rgb, 1)
    nt.links.new(ramp.outputs['Result'], base.inputs[2])
    wood = nt.nodes.new('ShaderNodeMixRGB')
    isw = nt.nodes.new('ShaderNodeMath')
    isw.operation = 'COMPARE'
    isw.inputs[1].default_value = 1
    isw.inputs[2].default_value = 0.2
    nt.links.new(kind.outputs['Fac'], isw.inputs[0])
    nt.links.new(isw.outputs[0], wood.inputs[0])
    nt.links.new(base.outputs[0], wood.inputs[1])
    wood.inputs[2].default_value = (0.09, 0.06, 0.04, 1)
    petal = nt.nodes.new('ShaderNodeMixRGB')
    isp = nt.nodes.new('ShaderNodeMath')
    isp.operation = 'GREATER_THAN'
    isp.inputs[1].default_value = 1.5
    nt.links.new(kind.outputs['Fac'], isp.inputs[0])
    nt.links.new(isp.outputs[0], petal.inputs[0])
    nt.links.new(wood.outputs[0], petal.inputs[1])
    petal.inputs[2].default_value = (0.86, 0.50, 0.62, 1) if fam == 'cherry' else (0.85, 0.83, 0.76, 1)
    bs = nt.nodes.new('ShaderNodeBsdfDiffuse')
    tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = 0.32
    nt.links.new(petal.outputs[0], bs.inputs['Color'])
    nt.links.new(petal.outputs[0], tr.inputs['Color'])
    nt.links.new(bs.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return mat


def bark_material(name):
    mat = bpy.data.materials.get('OF_bark_' + name) or bpy.data.materials.new('OF_bark_' + name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*BARKS[name], 1)
        bsdf.inputs['Roughness'].default_value = 0.95
    return mat


_cache = {}


def spray_mesh(fam, variant):
    key = (fam, variant)
    if key in _cache:
        try:
            _cache[key].name
            return _cache[key]
        except ReferenceError:
            pass
    sp = families.make_spray(fam, 'hero', variant)
    v, t, tone, kind = sp.arrays()
    me = studio.mesh_from('OF_spray_%s_%d' % key, v, t, {'tone': tone, 'kind': kind})
    _cache[key] = me
    return me


def spray_frame(c, a, n, hl, hw, roll=0.0):
    """The spray's own frame: Y its axis, Z as near its outward normal as that allows."""
    y = a / np.linalg.norm(a)
    z = n - y * (n @ y)
    if np.linalg.norm(z) < 1e-3:
        ref = np.array([1.0, 0, 0]) if abs(y[0]) < 0.9 else np.array([0, 1.0, 0])
        z = ref - y * (ref @ y)
    z = z / np.linalg.norm(z)
    x = np.cross(y, z)
    cr, sr = math.cos(roll), math.sin(roll)
    x, z = x * cr + z * sr, z * cr - x * sr
    depth = min(hl, hw)
    return Matrix(((x[0] * hw, y[0] * hl, z[0] * depth, c[0]), (x[1] * hw, y[1] * hl, z[1] * depth, c[1]),
                   (x[2] * hw, y[2] * hl, z[2] * depth, c[2]), (0, 0, 0, 1)))


def tree_collection(t, leaf_mats=None, bark_mat=None, wood=900):
    """One tree as a collection: its wood, and a linked spray at every cluster."""
    name = 'OF_' + t.name
    old = bpy.data.collections.get(name)
    if old:
        for ob in list(old.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(old)
    col = bpy.data.collections.new(name)
    v, n, al, tr, rd = wood_mesh(t.sk, t.r, wood, 10, t.flare, tol=0.05, seed=len(t.name))
    me = studio.mesh_from(name + '_wood', v, tr, {'tone': np.full(len(v), 0.5), 'kind': np.ones(len(v))}, smooth=True)
    me.materials.append(bark_mat or bark_material(t.bark))
    ob = bpy.data.objects.new(name + '_wood', me)
    col.objects.link(ob)
    rng = rng_of(hash(t.name) & 0xFFFF)
    rng = rng_of(sum(ord(ch) for ch in t.name))
    for i in range(len(t.c)):
        fam = t.fam[i]
        k = rng.randint(families.FAMILIES[fam][1])
        me = spray_mesh(fam, k)
        rolls = [rng.normal() * 0.5]
        if fam in ROOFED:
            rolls = [ROOFED[fam] + rng.normal() * 0.15, -ROOFED[fam] + rng.normal() * 0.15]
        for q, roll in enumerate(rolls):
            so = bpy.data.objects.new(name + '_s%d_%d' % (i, q), me)
            so.matrix_world = spray_frame(t.c[i], t.a[i], t.n[i], t.hl[i], t.hw[i], roll)
            col.objects.link(so)
        mat = (leaf_mats or {}).get(fam) if leaf_mats else leaf_material(fam, families.FAMILIES[fam][4])
        if not me.materials:
            me.materials.append(mat)
        else:
            me.materials[0] = mat
    return col


def lineup(trees, path, spacing=None, width=1920, height=900, samples=48, pitch=10, cols=None, fov=30, row_gap=26, yaw=None):
    """Trees in rows, lit by a low side sun, seen a little from above."""
    sc = studio.scene('OdysseyForestPreview')
    studio.setup_render(sc, width, height, samples)
    sc.cycles.max_bounces = 4
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.40, 0.58, 0.85, 1)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.75
    cols = cols or len(trees)
    rows = [trees[i:i + cols] for i in range(0, len(trees), cols)]
    wide = 0
    for ri, row in enumerate(rows):
        x = 0
        xs = []
        for t in row:
            w = t.reach * 2 + 1.5 if spacing is None else spacing
            xs.append(x + w / 2)
            x += w
        wide = max(wide, x)
        for t, px in zip(row, xs):
            col = tree_collection(t)
            e = bpy.data.objects.new('OF_i_' + t.name, None)
            e.instance_type = 'COLLECTION'
            e.instance_collection = col
            e.location = (px - x / 2, ri * row_gap, 0)
            e.rotation_euler = (0, 0, yaw if yaw is not None else 0.6)
            sc.collection.objects.link(e)
    g = studio.mesh_from('OF_ground', [(-400, -400, 0), (400, -400, 0), (400, 400, 0), (-400, 400, 0)], [(0, 1, 2), (0, 2, 3)])
    gm = bpy.data.materials.get('OF_ground') or bpy.data.materials.new('OF_ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.10, 0.17, 0.05, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1
    studio.put(sc, 'OF_ground', g, gm)
    sun = bpy.data.lights.new('OF_sun', 'SUN')
    sun.energy = 4.2
    sun.angle = 0.02
    sun.color = (1.0, 0.90, 0.74)
    so = bpy.data.objects.new('OF_sun', sun)
    so.rotation_euler = (math.radians(62), 0, math.radians(-58))
    sc.collection.objects.link(so)
    H = max(t.height for t in trees)
    cam = bpy.data.cameras.new('OF_cam')
    cam.angle = math.radians(fov)
    co = bpy.data.objects.new('OF_cam', cam)
    aspect = width / height
    dist = max((wide / 2) / math.tan(math.radians(fov) / 2) * 0.96, (H * 0.60) * aspect / math.tan(math.radians(fov) / 2))
    p = math.radians(pitch)
    target = Vector((0, (len(rows) - 1) * row_gap * 0.5, H * (0.45 if len(rows) == 1 else 0.30)))
    co.location = target + Vector((0, -math.cos(p) * dist, math.sin(p) * dist))
    co.rotation_euler = (math.radians(90) - p, 0, 0)
    sc.collection.objects.link(co)
    sc.camera = co
    ims = sc.render.image_settings
    try:
        ims.media_type = 'IMAGE'
    except Exception:
        pass
    ims.file_format = 'PNG'
    ims.color_mode = 'RGB'
    ims.color_depth = '8'
    sc.cycles.use_denoising = True
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    sc.cycles.use_denoising = False
    return path
