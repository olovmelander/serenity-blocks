"""
Pictures of the massif in Blender (2026-11-25): the form judged before it goes into the game.

Workbench (solid shading, cast shadows, cavity) from the views the game holds it in, lit by the world's sun,
a rough paint by height and slope so snow, rock and grass read. World (x, y up, z) is Blender (x, -z, y).
"""

import math

import numpy as np

SUN = np.array([-0.875, 0.259, 0.408])

# (name, eye xyz in world, target xyz in world, lens mm)
VIEWS = [
    ('meadows', (-114, 353, -183), (-175, 760, -1030), 30),
    ('approach', (-172, 371, -314), (-170, 760, -1040), 28),
    ('climb-low', (-205, 662, -575), (-180, 900, -1050), 24),
    ('climb-high', (-150, 925, -808), (-170, 980, -1060), 26),
    ('west', (-1400, 700, -700), (-200, 720, -1040), 34),
    ('east', (900, 650, -500), (-150, 720, -1040), 34),
]


def blender_xyz(p):
    return (p[0], -p[2], p[1])


def paint(H, grid, flow=None):
    gx, gz = np.gradient(H, grid.step)
    slope = np.degrees(np.arctan(np.hypot(gx, gz)))
    grass = np.array([0.30, 0.42, 0.20])
    rock = np.array([0.42, 0.40, 0.40])
    scree = np.array([0.55, 0.52, 0.48])
    snow = np.array([0.92, 0.93, 0.96])
    c = np.empty(H.shape + (3,))
    c[:] = grass
    tr = np.clip((slope - 30) / 10, 0, 1)[..., None] * np.clip((H - 380) / 80, 0, 1)[..., None]
    c = c * (1 - tr) + rock * tr
    if flow is not None:
        f = np.clip(flow, 0, 1)[..., None] * np.clip((H - 450) / 100, 0, 1)[..., None]
        c = c * (1 - 0.35 * f) + scree * 0.35 * f
    sn = np.clip((H - 760 + (flow if flow is not None else 0) * 120) / 40, 0, 1) * np.clip((52 - slope) / 8, 0, 1)
    c = c * (1 - sn[..., None]) + snow * sn[..., None]
    return c


def render(H, grid, out_prefix, flow=None, views=None, res=(960, 540)):
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    n = grid.n
    xs = grid.X.ravel()
    zs = grid.Z.ravel()
    verts = np.stack([xs, -zs, H.ravel()], 1)
    faces = []
    idx = np.arange(n * n).reshape(n, n)
    a = idx[:-1, :-1].ravel()
    b = idx[:-1, 1:].ravel()
    c = idx[1:, 1:].ravel()
    d = idx[1:, :-1].ravel()
    faces = np.stack([a, d, c, b], 1)
    mesh = bpy.data.meshes.new('massif')
    mesh.vertices.add(n * n)
    mesh.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    mesh.loops.add(faces.size)
    mesh.loops.foreach_set('vertex_index', faces.astype(np.int32).ravel())
    mesh.polygons.add(faces.shape[0])
    mesh.polygons.foreach_set('loop_start', (np.arange(faces.shape[0]) * 4).astype(np.int32))
    mesh.polygons.foreach_set('loop_total', np.full(faces.shape[0], 4, np.int32))
    mesh.update()
    mesh.validate()
    col = paint(H, grid, flow)
    attr = mesh.color_attributes.new('paint', 'FLOAT_COLOR', 'POINT')
    rgba = np.concatenate([col.reshape(-1, 3), np.ones((n * n, 1))], 1).astype(np.float32)
    attr.data.foreach_set('color', rgba.ravel())
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = 0
    mesh.polygons.foreach_set('use_smooth', np.ones(faces.shape[0], bool))
    obj = bpy.data.objects.new('massif', mesh)
    scene = bpy.context.scene
    scene.collection.objects.link(obj)

    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    scene.display.shading.show_shadows = True
    scene.display.shading.shadow_intensity = 0.55
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    sun = SUN / np.linalg.norm(SUN)
    scene.display.light_direction = tuple(float(v) for v in blender_xyz(sun))
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.color = (0.62, 0.72, 0.86)
    scene.display.shading.background_type = 'WORLD'

    cam_data = bpy.data.cameras.new('cam')
    cam_data.clip_start = 1
    cam_data.clip_end = 20000
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    outs = []
    import os
    only = os.environ.get('ODYSSEY_MASSIF_VIEWS')
    views = views or [v for v in VIEWS if not only or v[0] in only.split(',')]
    for name, eye, target, lens in views:
        e = np.array(blender_xyz(eye))
        t = np.array(blender_xyz(target))
        cam.location = tuple(e)
        fwd = (t - e) / np.linalg.norm(t - e)
        yaw = math.atan2(fwd[1], fwd[0]) - math.pi / 2
        pitch = math.asin(np.clip(fwd[2], -1, 1))
        cam.rotation_euler = (math.pi / 2 + pitch, 0, yaw)
        cam_data.lens = lens
        path = f'{out_prefix}-{name}.png'
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        outs.append(path)
    return outs
