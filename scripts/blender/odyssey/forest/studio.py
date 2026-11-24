"""
Blender helpers for Odyssey's forest (2026-11-24): meshes from arrays, a data material (normals,
occlusion, tone, kind, with no light and no view transform), and orthographic photographs read back as
numpy arrays. Everything lives in scenes of its own ('OdysseyForest…'), so it never touches the scene
that is open.
"""

import os
import tempfile

import bpy
import numpy as np

TMP = os.environ.get('ODYSSEY_FOREST_TMP') or tempfile.gettempdir()


def scene(name, clear=True):
    sc = bpy.data.scenes.get(name)
    if sc is None:
        sc = bpy.data.scenes.new(name)
    if clear:
        for ob in list(sc.objects):
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if data is not None and getattr(data, 'users', 1) == 0:
                try:
                    bpy.data.batch_remove([data])
                except Exception:
                    pass
    return sc


def mesh_from(name, verts, tris, attrs=None, smooth=False, normals=None):
    me = bpy.data.meshes.new(name)
    v = np.asarray(verts, dtype=np.float32)
    t = np.asarray(tris, dtype=np.int32)
    me.vertices.add(len(v))
    me.vertices.foreach_set('co', v.ravel())
    me.loops.add(len(t) * 3)
    me.loops.foreach_set('vertex_index', t.ravel())
    me.polygons.add(len(t))
    me.polygons.foreach_set('loop_start', np.arange(0, len(t) * 3, 3, dtype=np.int32))
    if smooth:
        me.polygons.foreach_set('use_smooth', np.ones(len(t), dtype=bool))
    me.update(calc_edges=True)
    for key, values in (attrs or {}).items():
        a = me.attributes.new(key, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.asarray(values, dtype=np.float32).ravel())
    if normals is not None:
        me.normals_split_custom_set_from_vertices([tuple(map(float, n)) for n in normals])
    return me


def put(sc, name, me, mat=None, loc=(0, 0, 0)):
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    sc.collection.objects.link(ob)
    if mat is not None:
        me.materials.clear()
        me.materials.append(mat)
    return ob


def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    return nt


def data_material(name, mode, ao_dist=0.6, ao_samples=24):
    """
    mode 'normal': the shading normal in world space (x, y, z) * 0.5 + 0.5.
    mode 'data':   occlusion, tone (the mesh's attribute), kind / 2.
    """
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = _nodes(mat)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    if mode == 'normal':
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        mul = nt.nodes.new('ShaderNodeVectorMath')
        mul.operation = 'MULTIPLY_ADD'
        mul.inputs[1].default_value = (0.5, 0.5, 0.5)
        mul.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs['Normal'], mul.inputs[0])
        nt.links.new(mul.outputs[0], em.inputs['Color'])
    else:
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
        ao.samples = ao_samples
        ao.inputs['Distance'].default_value = ao_dist
        tone = nt.nodes.new('ShaderNodeAttribute')
        tone.attribute_name = 'tone'
        kind = nt.nodes.new('ShaderNodeAttribute')
        kind.attribute_name = 'kind'
        half = nt.nodes.new('ShaderNodeMath')
        half.operation = 'MULTIPLY'
        half.inputs[1].default_value = 0.5
        nt.links.new(kind.outputs['Fac'], half.inputs[0])
        comb = nt.nodes.new('ShaderNodeCombineColor')
        nt.links.new(ao.outputs['AO'], comb.inputs[0])
        nt.links.new(tone.outputs['Fac'], comb.inputs[1])
        nt.links.new(half.outputs[0], comb.inputs[2])
        nt.links.new(comb.outputs[0], em.inputs['Color'])
    return mat


def setup_render(sc, width, height, samples=16, device='GPU'):
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.samples = samples
    cy.use_denoising = False
    cy.use_adaptive_sampling = False
    cy.max_bounces = 1
    cy.filter_width = 1.0
    cy.device = device
    cy.seed = 7
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type in ('OPTIX', 'CUDA')
    except Exception:
        cy.device = 'CPU'
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.use_persistent_data = False
    sc.view_settings.view_transform = 'Raw'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    sc.render.dither_intensity = 0
    if sc.world is None:
        sc.world = bpy.data.worlds.new(sc.name + 'World')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0, 0, 0, 1)
        bg.inputs[1].default_value = 0


def ortho_camera(sc, scale, loc, rot=(0, 0, 0)):
    cam = bpy.data.cameras.new(sc.name + 'Cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = scale
    cam.clip_start = 0.01
    cam.clip_end = 5000
    ob = bpy.data.objects.new(sc.name + 'Cam', cam)
    ob.location = loc
    ob.rotation_euler = rot
    sc.collection.objects.link(ob)
    sc.camera = ob
    return ob


def shoot(sc, name):
    """Render `sc` and return it as a float array (h, w, 4), row 0 the bottom."""
    path = os.path.join(TMP, name + '.exr')
    ims = sc.render.image_settings
    if hasattr(ims, 'media_type'):
        try:
            ims.media_type = 'IMAGE'
        except Exception:
            pass
    ims.file_format = 'OPEN_EXR'
    ims.color_mode = 'RGBA'
    ims.color_depth = '32'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=sc.name)
    im = bpy.data.images.load(path, check_existing=False)
    im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(buf)
    bpy.data.images.remove(im)
    return buf.reshape(h, w, 4)


def unpremultiply(a):
    """Cycles writes premultiplied colour; the data wants it straight."""
    al = a[..., 3:4]
    return np.concatenate([np.where(al > 1e-4, a[..., :3] / np.maximum(al, 1e-4), 0), al], axis=-1)


def save_png(path, rgb_or_rgba):
    """Write an (h, w, 3|4) array (0..1, row 0 the bottom) as an 8-bit PNG, untouched."""
    a = np.asarray(rgb_or_rgba, dtype=np.float32)
    h, w, c = a.shape
    if c == 3:
        a = np.concatenate([a, np.ones((h, w, 1), np.float32)], axis=-1)
    im = bpy.data.images.new('odyssey_forest_out', w, h, alpha=True, float_buffer=False, is_data=True)
    im.alpha_mode = 'CHANNEL_PACKED'
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def downsample(a, k):
    h, w = a.shape[:2]
    return a[:h // k * k, :w // k * k].reshape(h // k, k, w // k, k, -1).mean(axis=(1, 3))


def edt(mask):
    """Exact euclidean distance to the nearest True texel (Felzenszwalb, row then column)."""
    INF = 1e9
    f = np.where(mask, 0.0, INF)
    h, w = f.shape

    def pass1(line):
        n = len(line)
        v = np.zeros(n, dtype=int)
        z = np.zeros(n + 1)
        k = 0
        z[0] = -INF
        z[1] = INF
        for q in range(1, n):
            s = ((line[q] + q * q) - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
            while s <= z[k]:
                k -= 1
                s = ((line[q] + q * q) - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
            k += 1
            v[k] = q
            z[k] = s
            z[k + 1] = INF
        k = 0
        out = np.empty(n)
        for q in range(n):
            while z[k + 1] < q:
                k += 1
            out[q] = (q - v[k]) ** 2 + line[v[k]]
        return out

    for j in range(h):
        f[j] = pass1(f[j])
    for i in range(w):
        f[:, i] = pass1(f[:, i])
    return np.sqrt(f)


def near_distance(mask, reach):
    """Distance in texels to the nearest True texel, capped at `reach` (vectorised, for small reaches)."""
    h, w = mask.shape
    out = np.full((h, w), float(reach) + 1)
    out[mask] = 0
    offs = [(dy, dx) for dy in range(-reach, reach + 1) for dx in range(-reach, reach + 1)
            if 0 < dy * dy + dx * dx <= reach * reach]
    offs.sort(key=lambda o: o[0] ** 2 + o[1] ** 2)
    for dy, dx in offs:
        d = (dy * dy + dx * dx) ** 0.5
        src = mask[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
        dst = out[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
        np.minimum(dst, np.where(src, d, dst), out=dst)
    return out
