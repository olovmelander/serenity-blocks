#!/usr/bin/env python3
import json
import math
import os
import struct
import sys

import bpy
from mathutils import Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
FAUNA_DIR = os.path.join(REPO_ROOT, 'src', 'themes', 'ocean', 'assets', 'fauna')


def hex_rgba(value, alpha=1.0):
    return (
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255,
        alpha,
    )


def mix_color(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


def clamp(value, low, high):
    return max(low, min(high, value))


def fract(value):
    return value - math.floor(value)


def hash2(x, y, seed=0.0):
    return fract(math.sin(x * 127.1 + y * 311.7 + seed * 19.19) * 43758.5453)


def make_texture_atlas(name, size, palette, mode):
    image = bpy.data.images.new(name, width=size, height=size, alpha=True)
    pixels = [0.0] * (size * size * 4)
    colors = {key: hex_rgba(value, 1.0) for key, value in palette.items()}

    for y in range(size):
        v = y / max(1, size - 1)
        for x in range(size):
            u = x / max(1, size - 1)
            noise = hash2(math.floor(u * 96), math.floor(v * 96), len(name))
            fine = hash2(math.floor(u * 256), math.floor(v * 256), len(name) * 2)

            if mode == 'shark':
                base = mix_color(colors['belly'], colors['flank'], smoothstep(0.10, 0.62, v))
                base = mix_color(base, colors['dorsal'], smoothstep(0.52, 0.98, v))
                lateral = math.exp(-((v - 0.50) ** 2) / 0.0018) * 0.12
                mottles = (noise - 0.5) * 0.10 + math.sin(u * 54 + noise * 4) * 0.025
                gill = 0.0
                if 0.68 < u < 0.82 and 0.36 < v < 0.68:
                    gill = max(0.0, math.sin((u - 0.68) * 190)) * 0.18
                factor = 1.0 + mottles - lateral - gill
                color = tuple(clamp(c * factor, 0.0, 1.0) for c in base[:3]) + (1.0,)
            elif mode == 'turtle':
                shell = mix_color(colors['shell_low'], colors['shell_high'], smoothstep(0.18, 0.92, v))
                cell_x = abs(fract(u * 6.0 + 0.08 * math.sin(v * 12)) - 0.5)
                cell_y = abs(fract(v * 4.4 + 0.06 * math.sin(u * 10)) - 0.5)
                seam = max(0.0, 1.0 - min(cell_x, cell_y) * 18.0)
                speckle = (noise - 0.5) * 0.13 + (fine - 0.5) * 0.045
                edge_wear = smoothstep(0.78, 0.98, abs(u - 0.5) * 2) * 0.14
                base = mix_color(shell, colors['scute_line'], seam * 0.5 + edge_wear)
                color = tuple(clamp(c * (1.0 + speckle), 0.0, 1.0) for c in base[:3]) + (1.0,)
            elif mode == 'whale':
                base = mix_color(colors['belly'], colors['flank'], smoothstep(0.14, 0.66, v))
                base = mix_color(base, colors['dorsal'], smoothstep(0.54, 1.0, v))
                cloud = (noise - 0.5) * 0.16 + math.sin(u * 21 + noise * 6) * math.sin(v * 13) * 0.05
                pleats = 0.0
                if v < 0.34:
                    pleats = max(0.0, math.sin(u * 92)) * (0.34 - v) * 0.30
                color = tuple(clamp(c * (1.0 + cloud - pleats), 0.0, 1.0) for c in base[:3]) + (1.0,)
            else:
                base = mix_color(colors['belly'], colors['body'], smoothstep(0.08, 0.92, v))
                stripe_phase = math.sin((u * (22 if mode == 'banner' else 15)) + (0.55 * math.sin(v * 9)))
                stripe = smoothstep(0.56, 0.98, stripe_phase if mode == 'banner' else abs(stripe_phase))
                fin_glow = smoothstep(0.70, 0.98, v) * 0.18 + smoothstep(0.0, 0.16, v) * 0.12
                sparkle = max(0.0, fine - 0.82) * 0.30
                base = mix_color(base, colors['accent'], stripe * (0.55 if mode == 'banner' else 0.34))
                base = mix_color(base, colors['fin'], fin_glow)
                color = tuple(clamp(c * (0.96 + sparkle), 0.0, 1.0) for c in base[:3]) + (1.0,)

            offset = (y * size + x) * 4
            pixels[offset:offset + 4] = color

    image.pixels.foreach_set(pixels)
    image.update()
    image.file_format = 'PNG'
    return image


def smoothstep(edge0, edge1, value):
    if edge0 == edge1:
        return 0.0
    t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def attach_base_color_texture(mat, image):
    if not image or not mat.use_nodes:
        return mat
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    if not bsdf:
        return mat
    tex = nodes.new('ShaderNodeTexImage')
    tex.name = f'{mat.name} atlas'
    tex.image = image
    tex.extension = 'REPEAT'
    tex.interpolation = 'Smart'
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    mat['textureAtlas'] = image.name
    return mat


def texture_materials(materials, image):
    if isinstance(materials, dict):
        iterable = materials.values()
    else:
        iterable = materials
    for mat in iterable:
        attach_base_color_texture(mat, image)


def make_material(name, color, roughness=0.75, metallic=0.0, alpha=1.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = hex_rgba(color, alpha)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = hex_rgba(color, alpha)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        if emission is not None and 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = hex_rgba(emission[0], 1.0)
            bsdf.inputs['Emission Strength'].default_value = emission[1]
    if alpha < 1:
        mat.blend_method = 'BLEND'
        mat.use_screen_refraction = True
    mat['aquaticMaterial'] = True
    mat['underwaterGrade'] = 'premium-v4-textured-procedural'
    return mat


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 96
    bpy.context.scene.render.fps = 30


def empty(name, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.25
    obj.location = location
    if parent:
        obj.parent = parent
    bpy.context.collection.objects.link(obj)
    return obj


def shade_smooth(obj, weighted=True):
    for poly in obj.data.polygons:
        poly.use_smooth = True
    if weighted:
        mod = obj.modifiers.new('premium weighted normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        mod.weight = 50
    return obj


def add_uv_ellipsoid(name, mat, location, scale, segments=48, rings=24, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=1,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f'{name}Mesh'
    obj.scale = scale
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return shade_smooth(obj)


def add_cube_detail(name, mat, location, scale, rotation=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f'{name}Mesh'
    obj.scale = scale
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return shade_smooth(obj, weighted=False)


def add_cylinder_detail(name, mat, location, radius, depth, vertices=24, scale=(1, 1, 1),
                        rotation=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f'{name}Mesh'
    obj.scale = scale
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return shade_smooth(obj)


def sample_profile(profile, samples):
    result = []
    ordered = sorted(profile, key=lambda p: p[0])
    x0 = ordered[0][0]
    x1 = ordered[-1][0]
    for i in range(samples + 1):
        x = x0 + (x1 - x0) * (i / samples)
        for j in range(len(ordered) - 1):
            a = ordered[j]
            b = ordered[j + 1]
            if x <= b[0] + 1e-9 or j == len(ordered) - 2:
                span = b[0] - a[0] or 1
                t = max(0, min(1, (x - a[0]) / span))
                # Smooth the station interpolation so silhouettes feel sculpted.
                t = t * t * (3 - 2 * t)
                ry = a[1] + (b[1] - a[1]) * t
                rz = a[2] + (b[2] - a[2]) * t
                result.append((x, max(0.001, ry), max(0.001, rz)))
                break
    return result


def create_lathe_body(name, profile, mats, samples=80, radial=36, parent=None,
                      x_stripes=None, wobble=0.0):
    stations = sample_profile(profile, samples)
    verts = []
    faces = []
    mat_indices = []
    for x, ry, rz in stations:
        for r in range(radial):
            theta = math.tau * r / radial
            wrinkle = 1 + wobble * math.sin(theta * 3 + x * 1.7) * math.sin((x + 4) * 2.1)
            verts.append((x, ry * math.sin(theta) * wrinkle, rz * math.cos(theta) * wrinkle))

    for i in range(samples):
        for r in range(radial):
            r1 = (r + 1) % radial
            faces.append((i * radial + r, i * radial + r1, (i + 1) * radial + r1, (i + 1) * radial + r))
            _, y0, _ = verts[i * radial + r]
            _, y1, _ = verts[i * radial + r1]
            avg_y = (y0 + y1) * 0.5
            avg_x = (verts[i * radial + r][0] + verts[(i + 1) * radial + r][0]) * 0.5
            stripe_mat = None
            if x_stripes:
                for x_min, x_max, mat_name in x_stripes:
                    if x_min <= avg_x <= x_max:
                        stripe_mat = mat_name
                        break
            if stripe_mat and stripe_mat in mats:
                mat_indices.append(list(mats).index(stripe_mat))
            elif avg_y > 0.28:
                mat_indices.append(list(mats).index('dorsal'))
            elif avg_y < -0.24:
                mat_indices.append(list(mats).index('belly'))
            else:
                mat_indices.append(list(mats).index('flank'))

    mesh = bpy.data.meshes.new(f'{name}Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    x_min = min(v[0] for v in verts)
    x_max = max(v[0] for v in verts)
    x_span = max(x_max - x_min, 0.001)
    uv_layer = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            station_index = vertex_index // radial
            ring_index = vertex_index % radial
            u = (verts[vertex_index][0] - x_min) / x_span
            v = ring_index / radial
            uv_layer.data[loop_index].uv = (u, v)
    colors = {
        'dorsal': mats['dorsal'].diffuse_color,
        'flank': mats['flank'].diffuse_color,
        'belly': mats['belly'].diffuse_color,
    }
    min_y = min(v[1] for v in verts)
    max_y = max(v[1] for v in verts)
    span_y = max(max_y - min_y, 0.001)
    color_attr = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    mesh.color_attributes.active_color = color_attr
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            y = verts[vertex_index][1]
            t = (y - min_y) / span_y
            if t > 0.52:
                color = mix_color(colors['flank'], colors['dorsal'], (t - 0.52) / 0.48)
            else:
                color = mix_color(colors['belly'], colors['flank'], t / 0.52)
            color_attr.data[loop_index].color = color
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for mat in mats.values():
        mesh.materials.append(mat)
    for poly, mat_index in zip(mesh.polygons, mat_indices):
        poly.material_index = mat_index
    if parent:
        obj.parent = parent
    return shade_smooth(obj)


def create_airfoil_fin(name, mat, base, tip, root_chord, tip_chord, thickness_axis,
                       root_thickness=0.06, tip_thickness=0.0, span_segments=7,
                       chord_segments=6, parent=None):
    base = Vector(base)
    tip = Vector(tip)
    root_chord = Vector(root_chord)
    tip_chord = Vector(tip_chord)
    thickness_axis = Vector(thickness_axis).normalized()
    verts = []
    faces = []

    for side in (-1, 1):
        for i in range(span_segments + 1):
            st = i / span_segments
            center = base.lerp(tip, st)
            chord = root_chord.lerp(tip_chord, st)
            thick = root_thickness + (tip_thickness - root_thickness) * st
            camber = math.sin(st * math.pi) * 0.025
            for j in range(chord_segments + 1):
                ct = (j / chord_segments) - 0.5
                taper = 1 - abs(ct) * 0.35
                p = center + chord * ct + thickness_axis * (side * thick * taper + camber)
                verts.append(tuple(p))

    row = chord_segments + 1
    slab = (span_segments + 1) * row
    for side_index in range(2):
        offset = side_index * slab
        for i in range(span_segments):
            for j in range(chord_segments):
                a = offset + i * row + j
                b = a + 1
                c = a + row + 1
                d = a + row
                faces.append((a, b, c, d) if side_index == 0 else (a, d, c, b))

    # Seal leading/trailing and root edges.
    for i in range(span_segments):
        a = i * row
        b = (i + 1) * row
        c = slab + (i + 1) * row
        d = slab + i * row
        faces.append((a, b, c, d))
        a = i * row + chord_segments
        b = (i + 1) * row + chord_segments
        c = slab + (i + 1) * row + chord_segments
        d = slab + i * row + chord_segments
        faces.append((a, d, c, b))

    mesh = bpy.data.meshes.new(f'{name}Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            local_index = vertex_index % slab
            span_index = local_index // row
            chord_index = local_index % row
            uv_layer.data[loop_index].uv = (
                chord_index / max(1, chord_segments),
                span_index / max(1, span_segments),
            )
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    if parent:
        obj.parent = parent
    return shade_smooth(obj)


def make_action_track(obj, clip_name, frames):
    bpy.context.scene.frame_set(frames[0]['frame'])
    for item in frames:
        bpy.context.scene.frame_set(item['frame'])
        if 'location' in item:
            obj.location = item['location']
            obj.keyframe_insert(data_path='location', frame=item['frame'])
        if 'rotation' in item:
            obj.rotation_euler = item['rotation']
            obj.keyframe_insert(data_path='rotation_euler', frame=item['frame'])
    if not obj.animation_data or not obj.animation_data.action:
        return
    action = obj.animation_data.action
    action.name = f'{obj.name}_{clip_name}'
    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'SINE'
    track = obj.animation_data.nla_tracks.new()
    track.name = clip_name
    strip = track.strips.new(clip_name, frames[0]['frame'], action)
    strip.name = clip_name
    obj.animation_data.action = None


def export_glb(root, file_name):
    os.makedirs(FAUNA_DIR, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(FAUNA_DIR, file_name)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_materials='EXPORT',
        export_texcoords=True,
        export_normals=True,
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_frame_range=True,
        export_optimize_animation_size=True,
        export_apply=False,
    )
    return inspect_glb(path)


def parse_glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, _ = struct.unpack_from('<III', data, 0)
    if magic != 0x46546C67 or version != 2:
        raise RuntimeError(f'{path} is not a glTF 2 GLB')
    json_length, chunk_type = struct.unpack_from('<II', data, 12)
    if chunk_type != 0x4E4F534A:
        raise RuntimeError(f'{path} does not start with a JSON chunk')
    return data, json.loads(data[20:20 + json_length].decode('utf8'))


def count_triangles(json_doc):
    total = 0
    for mesh in json_doc.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            if primitive.get('mode', 4) != 4:
                continue
            indices = primitive.get('indices')
            if isinstance(indices, int):
                total += json_doc['accessors'][indices].get('count', 0) // 3
            else:
                pos = primitive.get('attributes', {}).get('POSITION')
                if isinstance(pos, int):
                    total += json_doc['accessors'][pos].get('count', 0) // 3
    return total


def inspect_glb(path):
    data, json_doc = parse_glb_json(path)
    return {
        'fileName': os.path.basename(path),
        'bytes': len(data),
        'triangles': count_triangles(json_doc),
        'animations': [a.get('name', '(unnamed)') for a in json_doc.get('animations', [])],
        'textures': len(json_doc.get('textures', [])),
    }


SHARK_ANIMATION_CLIPS = [
    'shark_cruise_loop',
    'shark_stalk_loop',
    'shark_charge_loop',
    'shark_strike_lunge',
    'shark_disengage_loop',
]


def add_tooth(name, mat, location, scale, rotation=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cone_add(
        vertices=8,
        radius1=1,
        radius2=0,
        depth=1,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f'{name}Mesh'
    obj.scale = scale
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return shade_smooth(obj, weighted=False)


def make_shark_phase_animation(body_pivot, tail, pectoral_pivots):
    phase_defs = {
        'shark_cruise_loop': {
            'frames': [1, 16, 32, 48, 64, 80, 96],
            'body_yaw': 0.040,
            'body_roll': 0.014,
            'tail_yaw': 0.38,
            'bob': 0.030,
            'pectoral': 0.08,
            'cycles': 3,
        },
        'shark_stalk_loop': {
            'frames': [1, 20, 40, 60, 80, 96],
            'body_yaw': 0.026,
            'body_roll': 0.020,
            'tail_yaw': 0.30,
            'bob': 0.018,
            'pectoral': 0.12,
            'cycles': 2.5,
        },
        'shark_charge_loop': {
            'frames': [1, 10, 20, 30, 40, 50, 60],
            'body_yaw': 0.078,
            'body_roll': 0.030,
            'tail_yaw': 0.62,
            'bob': 0.020,
            'pectoral': -0.18,
            'cycles': 3,
        },
        'shark_strike_lunge': {
            'frames': [1, 8, 16, 24, 32, 40],
            'body_yaw': 0.090,
            'body_roll': 0.044,
            'tail_yaw': 0.72,
            'bob': 0.052,
            'pectoral': -0.28,
            'cycles': 2.5,
            'lunge': 0.18,
        },
        'shark_disengage_loop': {
            'frames': [1, 22, 44, 66, 88, 96],
            'body_yaw': 0.024,
            'body_roll': 0.036,
            'tail_yaw': 0.24,
            'bob': 0.044,
            'pectoral': 0.18,
            'cycles': 2,
        },
    }

    for clip_name in SHARK_ANIMATION_CLIPS:
        spec = phase_defs[clip_name]
        frames = spec['frames']
        cycles = spec['cycles']
        make_action_track(body_pivot, clip_name, [
            {
                'frame': f,
                'rotation': (
                    0.016 * math.sin(i * math.tau / cycles),
                    spec['body_yaw'] * math.sin(i * math.tau / cycles),
                    spec['body_roll'] * math.sin(i * math.tau / cycles + math.pi * 0.34),
                ),
                'location': (
                    spec.get('lunge', 0) * smoothstep(0.16, 0.74, i / max(1, len(frames) - 1)),
                    spec['bob'] * math.sin(i * math.tau / cycles),
                    0,
                ),
            }
            for i, f in enumerate(frames)
        ])
        make_action_track(tail, clip_name, [
            {
                'frame': f,
                'rotation': (0, spec['tail_yaw'] * math.sin(i * math.tau / cycles + math.pi * 0.15), 0),
            }
            for i, f in enumerate(frames)
        ])
        for pivot_obj, side in pectoral_pivots:
            make_action_track(pivot_obj, clip_name, [
                {
                    'frame': f,
                    'rotation': (
                        0,
                        side * 0.08,
                        side * (spec['pectoral'] + 0.045 * math.sin(i * math.tau / cycles)),
                    ),
                }
                for i, f in enumerate(frames)
            ])


def create_shark():
    clear_scene()
    root = empty('OceanRareGreatWhiteSharkV5', None)
    root['assetId'] = 'rare-shark-v2'
    root['assetRole'] = 'cinematic-primary-shark'
    root['sourceMode'] = 'blender-mcp-project-authored'
    body_pivot = empty('SharkBodySway', root)
    atlas = make_texture_atlas('rare_shark_v5_basecolor_atlas', 1024, {
        'dorsal': 0x2f5966,
        'flank': 0x74a6ad,
        'belly': 0xe0f1ee,
    }, 'shark')

    mats = {
        'dorsal': make_material('great white slate dorsal PBR', 0x385f6a, 0.62),
        'flank': make_material('great white satin flank PBR', 0x7fb0b6, 0.66),
        'belly': make_material('great white pearlescent belly PBR', 0xe1efea, 0.58),
    }
    fin_mat = make_material('great white translucent fin edges PBR', 0x2b515b, 0.70, alpha=0.96)
    dark_mat = make_material('great white gill mouth shadow PBR', 0x102029, 0.88)
    eye_mat = make_material('great white black glass eyes PBR', 0x030608, 0.32)
    glint_mat = make_material('great white eye catchlight PBR', 0xdffcff, 0.2, emission=(0xa8f4ff, 0.8))
    tooth_mat = make_material('great white ivory teeth PBR', 0xf0eee2, 0.46)
    texture_materials(mats, atlas)

    create_lathe_body('SharkGreatWhiteCountershadedBody', [
        (-3.48, 0.050, 0.045), (-3.00, 0.150, 0.130), (-2.22, 0.295, 0.235),
        (-1.18, 0.465, 0.350), (0.02, 0.610, 0.455), (1.08, 0.575, 0.430),
        (1.92, 0.455, 0.365), (2.55, 0.275, 0.270), (3.08, 0.125, 0.145),
        (3.38, 0.025, 0.030),
    ], mats, samples=104, radial=44, parent=body_pivot, wobble=0.010)

    create_airfoil_fin('SharkGreatWhiteTallDorsalFin', fin_mat, (-0.18, 0.54, 0), (-0.64, 1.58, 0.02),
                       (-1.02, 0, 0), (-0.30, -0.09, 0), (0, 0, 1), 0.115, 0.0, 9, 7, body_pivot)
    create_airfoil_fin('SharkGreatWhiteRearDorsalFin', fin_mat, (-1.72, 0.31, 0), (-1.84, 0.68, 0.02),
                       (-0.44, 0, 0), (-0.18, -0.03, 0), (0, 0, 1), 0.055, 0, 5, 5, body_pivot)
    create_airfoil_fin('SharkGreatWhitePelvicKeelFin', fin_mat, (-0.78, -0.45, 0), (-0.60, -0.88, 0.02),
                       (-0.50, 0, 0), (-0.20, 0.02, 0), (0, 0, 1), 0.055, 0, 5, 5, body_pivot)

    pectoral_pivots = []
    for side in (-1, 1):
        pivot_obj = empty(f'Shark{"Right" if side > 0 else "Left"}PectoralPivot', body_pivot,
                          (0.86, -0.10, side * 0.38))
        pectoral_pivots.append((pivot_obj, side))
        create_airfoil_fin(f'Shark{"Right" if side > 0 else "Left"}LongScythePectoralFin', fin_mat,
                           (0, 0, 0), (-0.92, -0.62, side * 1.36),
                           (-0.42, -0.04, 0), (-0.18, -0.02, 0), (0, 1, 0),
                           0.090, 0, 9, 7, pivot_obj)

    tail = empty('SharkTailPivot', body_pivot, (-3.42, 0, 0))
    create_airfoil_fin('SharkGreatWhiteUpperCaudalBlade', fin_mat, (0, 0.05, 0), (-1.10, 1.14, 0.04),
                       (-0.50, 0, 0), (-0.28, -0.07, 0), (0, 0, 1), 0.105, 0, 8, 7, tail)
    create_airfoil_fin('SharkGreatWhiteLowerCaudalBlade', fin_mat, (0, -0.05, 0), (-0.84, -0.72, 0.04),
                       (-0.40, 0, 0), (-0.20, 0.04, 0), (0, 0, 1), 0.090, 0, 7, 6, tail)

    for side in (-1, 1):
        add_uv_ellipsoid(f'Shark{"Right" if side > 0 else "Left"}Eye', eye_mat,
                         (2.67, 0.20, side * 0.36), (0.058, 0.043, 0.036), 24, 12, body_pivot)
        add_uv_ellipsoid(f'Shark{"Right" if side > 0 else "Left"}EyeCatchlight', glint_mat,
                         (2.69, 0.22, side * 0.390), (0.018, 0.012, 0.008), 12, 8, body_pivot)
        for i in range(5):
            add_cube_detail(f'Shark{"Right" if side > 0 else "Left"}GillSlit{i + 1}', dark_mat,
                            (1.82 + i * 0.082, 0.080 - i * 0.018, side * 0.420),
                            (0.011, 0.122, 0.008), rotation=(0.0, 0.0, -0.22), parent=body_pivot)

    add_cube_detail('SharkUnderslungMouthShadow', dark_mat, (2.82, -0.16, 0),
                    (0.32, 0.018, 0.22), rotation=(0, 0, 0.04), parent=body_pivot)
    for side in (-1, 1):
        for row, y, z_base, tilt in [('Upper', -0.108, 0.096, math.pi), ('Lower', -0.216, 0.084, 0)]:
            for i in range(7):
                z = side * (z_base + i * 0.018)
                x = 2.56 + i * 0.048
                add_tooth(f'Shark{row}Tooth{"Right" if side > 0 else "Left"}{i + 1}', tooth_mat,
                          (x, y, z), (0.020, 0.055, 0.020), rotation=(tilt, 0.0, side * 0.10),
                          parent=body_pivot)

    make_shark_phase_animation(body_pivot, tail, pectoral_pivots)
    return root


def create_shark_fallback():
    clear_scene()
    root = empty('OceanRareGreatWhiteSharkFallback', None)
    root['assetId'] = 'rare-shark-v1'
    root['assetRole'] = 'cinematic-fallback-shark'
    root['sourceMode'] = 'blender-mcp-project-authored-fallback'
    body_pivot = empty('SharkBodySway', root)

    mats = {
        'dorsal': make_material('fallback shark slate dorsal PBR', 0x385d66, 0.66),
        'flank': make_material('fallback shark cool flank PBR', 0x78a9ac, 0.70),
        'belly': make_material('fallback shark pale belly PBR', 0xd8ece8, 0.64),
    }
    fin_mat = make_material('fallback shark fins PBR', 0x2d5660, 0.74)
    dark_mat = make_material('fallback shark dark details PBR', 0x0f2028, 0.88)

    create_lathe_body('SharkFallbackCountershadedBody', [
        (-3.18, 0.05, 0.04), (-2.45, 0.22, 0.17), (-1.20, 0.44, 0.32),
        (0.30, 0.56, 0.42), (1.52, 0.42, 0.34), (2.42, 0.21, 0.22),
        (3.04, 0.04, 0.04),
    ], mats, samples=32, radial=18, parent=body_pivot, wobble=0.006)

    create_airfoil_fin('SharkFallbackDorsalFin', fin_mat, (-0.14, 0.48, 0), (-0.46, 1.28, 0.02),
                       (-0.82, 0, 0), (-0.24, -0.08, 0), (0, 0, 1), 0.085, 0, 5, 4, body_pivot)
    create_airfoil_fin('SharkFallbackPelvicFin', fin_mat, (-0.60, -0.40, 0), (-0.42, -0.78, 0.02),
                       (-0.36, 0, 0), (-0.16, 0.02, 0), (0, 0, 1), 0.045, 0, 4, 3, body_pivot)
    pectoral_pivots = []
    for side in (-1, 1):
        pivot_obj = empty(f'Shark{"Right" if side > 0 else "Left"}PectoralPivot', body_pivot,
                          (0.72, -0.10, side * 0.34))
        pectoral_pivots.append((pivot_obj, side))
        create_airfoil_fin(f'SharkFallback{"Right" if side > 0 else "Left"}PectoralFin', fin_mat,
                           (0, 0, 0), (-0.72, -0.48, side * 1.12),
                           (-0.32, -0.03, 0), (-0.14, -0.02, 0), (0, 1, 0),
                           0.065, 0, 5, 4, pivot_obj)

    tail = empty('SharkTailPivot', body_pivot, (-3.16, 0, 0))
    create_airfoil_fin('SharkFallbackUpperCaudalBlade', fin_mat, (0, 0.05, 0), (-0.86, 0.92, 0.03),
                       (-0.36, 0, 0), (-0.18, -0.06, 0), (0, 0, 1), 0.075, 0, 5, 4, tail)
    create_airfoil_fin('SharkFallbackLowerCaudalBlade', fin_mat, (0, -0.05, 0), (-0.66, -0.56, 0.03),
                       (-0.28, 0, 0), (-0.14, 0.04, 0), (0, 0, 1), 0.060, 0, 5, 4, tail)

    for side in (-1, 1):
        add_uv_ellipsoid(f'SharkFallback{"Right" if side > 0 else "Left"}Eye', dark_mat,
                         (2.48, 0.18, side * 0.32), (0.050, 0.034, 0.026), 12, 8, body_pivot)
        for i in range(4):
            add_cube_detail(f'SharkFallback{"Right" if side > 0 else "Left"}GillSlit{i + 1}', dark_mat,
                            (1.62 + i * 0.090, 0.060 - i * 0.016, side * 0.365),
                            (0.010, 0.100, 0.007), rotation=(0.0, 0.0, -0.20), parent=body_pivot)
    add_cube_detail('SharkFallbackMouthShadow', dark_mat, (2.54, -0.14, 0),
                    (0.26, 0.016, 0.18), rotation=(0, 0, 0.04), parent=body_pivot)

    make_shark_phase_animation(body_pivot, tail, pectoral_pivots)
    return root


def create_turtle():
    clear_scene()
    root = empty('OceanRareTurtleV4', None)
    root['assetId'] = 'rare-turtle-v2'
    glide = empty('TurtleGlidePivot', root)
    atlas = make_texture_atlas('rare_turtle_v4_basecolor_atlas', 1024, {
        'shell_low': 0x365941,
        'shell_high': 0x88a05c,
        'scute_line': 0xd0c074,
    }, 'turtle')

    shell_mat = make_material('turtle deep olive shell PBR', 0x4f7159, 0.84)
    shell_rim_mat = make_material('turtle beveled amber shell rim PBR', 0xa3aa68, 0.78)
    scute_mat = make_material('turtle raised scute panels PBR', 0x7f8f54, 0.86)
    body_mat = make_material('turtle soft teal skin PBR', 0x79a69b, 0.78)
    belly_mat = make_material('turtle warm plastron PBR', 0xd7cf96, 0.76)
    eye_mat = make_material('turtle black glass eyes PBR', 0x07100d, 0.34)
    texture_materials([shell_mat, scute_mat, body_mat], atlas)

    add_uv_ellipsoid('TurtleHydrodynamicShell', shell_mat, (0, 0.19, 0), (1.52, 0.43, 0.92), 80, 40, glide)
    add_uv_ellipsoid('TurtleRoundedPlastron', belly_mat, (0.03, -0.16, 0), (1.22, 0.20, 0.70), 56, 24, glide)
    add_uv_ellipsoid('TurtleHead', body_mat, (1.42, 0.03, 0), (0.36, 0.25, 0.23), 36, 18, glide)
    add_uv_ellipsoid('TurtleNeck', body_mat, (1.10, -0.03, 0), (0.36, 0.17, 0.16), 32, 14, glide)
    add_uv_ellipsoid('TurtleTailNub', body_mat, (-1.42, -0.04, 0), (0.20, 0.10, 0.10), 24, 10, glide)

    for x in (-0.82, -0.32, 0.18, 0.68):
        add_cylinder_detail(f'TurtleCentralRaisedScute{x:.1f}', scute_mat, (x, 0.63, 0),
                            0.28, 0.035, vertices=6, scale=(1.35, 0.72, 1),
                            rotation=(math.pi / 2, 0, math.pi / 6), parent=glide)
    for side in (-1, 1):
        for x in (-0.62, 0.02, 0.62):
            add_cylinder_detail(f'Turtle{"Right" if side > 0 else "Left"}OuterScute{x:.1f}', shell_rim_mat,
                                (x, 0.52, side * 0.48), 0.20, 0.032, vertices=6,
                                scale=(1.15, 0.62, 1), rotation=(math.pi / 2, 0, side * 0.28), parent=glide)
        add_uv_ellipsoid(f'Turtle{"Right" if side > 0 else "Left"}Eye', eye_mat,
                         (1.65, 0.10, side * 0.14), (0.035, 0.030, 0.025), 16, 8, glide)

    fin_pivots = []
    for side in (-1, 1):
        front = empty(f'Turtle{"Right" if side > 0 else "Left"}FrontFlipperPivot', glide, (0.62, -0.02, side * 0.62))
        rear = empty(f'Turtle{"Right" if side > 0 else "Left"}RearFlipperPivot', glide, (-0.78, -0.10, side * 0.54))
        fin_pivots.extend([(front, side, 1), (rear, side, -1)])
        create_airfoil_fin(f'Turtle{"Right" if side > 0 else "Left"}FrontLayeredFlipper', body_mat,
                           (0, 0, 0), (0.42, -0.22, side * 0.82),
                           (0.64, -0.02, 0), (0.20, -0.02, 0), (0, 1, 0),
                           0.075, 0, 8, 7, front)
        create_airfoil_fin(f'Turtle{"Right" if side > 0 else "Left"}RearLayeredFlipper', body_mat,
                           (0, 0, 0), (-0.36, -0.16, side * 0.56),
                           (0.42, 0, 0), (0.15, 0, 0), (0, 1, 0),
                           0.06, 0, 6, 6, rear)

    frames = [1, 20, 40, 60, 80, 96]
    make_action_track(glide, 'turtle_flipper_glide_loop', [
        {'frame': f, 'rotation': (0.02 * math.sin(i * math.tau / 5), 0, 0.035 * math.sin(i * math.tau / 5)),
         'location': (0, 0.03 * math.sin(i * math.tau / 5), 0)}
        for i, f in enumerate(frames)
    ])
    for pivot_obj, side, front_mult in fin_pivots:
        make_action_track(pivot_obj, 'turtle_flipper_glide_loop', [
            {'frame': f, 'rotation': (0.0, side * 0.12 * math.sin(i * math.tau / 5),
                                      front_mult * 0.42 * math.sin(i * math.tau / 5))}
            for i, f in enumerate(frames)
        ])
    return root


def create_whale():
    clear_scene()
    root = empty('OceanRareBlueWhaleV4', None)
    root['assetId'] = 'rare-blue-whale-v1'
    body_pivot = empty('WhaleBodyUndulation', root)
    atlas = make_texture_atlas('rare_blue_whale_v4_basecolor_atlas', 1024, {
        'dorsal': 0x274f77,
        'flank': 0x719fc0,
        'belly': 0xd3e4e7,
    }, 'whale')

    mats = {
        'dorsal': make_material('whale deep cobalt dorsal PBR', 0x315f82, 0.68),
        'flank': make_material('whale mist blue flank PBR', 0x6f9db5, 0.72),
        'belly': make_material('whale pale ventral belly PBR', 0xcbdde2, 0.70),
    }
    fin_mat = make_material('whale satin fin edge PBR', 0x294f6c, 0.74)
    groove_mat = make_material('whale soft ventral groove shadow PBR', 0x456f85, 0.86)
    eye_mat = make_material('whale tiny black eye PBR', 0x061014, 0.40)
    texture_materials(mats, atlas)

    create_lathe_body('WhaleContinuousSculptedBody', [
        (-4.85, 0.11, 0.09), (-3.90, 0.42, 0.30), (-2.40, 0.74, 0.56),
        (-0.50, 0.82, 0.64), (1.50, 0.70, 0.54), (3.25, 0.42, 0.34),
        (4.25, 0.20, 0.18), (4.55, 0.04, 0.04),
    ], mats, samples=128, radial=56, parent=body_pivot, wobble=0.006)
    for z in [-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36]:
        add_cube_detail(f'WhaleVentralPleat{z:+.2f}', groove_mat, (2.00, -0.63, z),
                        (1.25, 0.012, 0.010), rotation=(0, 0, -0.05), parent=body_pivot)
    for side in (-1, 1):
        create_airfoil_fin(f'Whale{"Right" if side > 0 else "Left"}LongPectoralFin', fin_mat,
                           (1.12, -0.15, side * 0.42), (0.10, -0.68, side * 1.88),
                           (-0.65, -0.02, 0), (-0.28, -0.04, 0), (0, 1, 0),
                           0.11, 0, 10, 8, body_pivot)
        add_uv_ellipsoid(f'Whale{"Right" if side > 0 else "Left"}Eye', eye_mat,
                         (3.42, 0.16, side * 0.27), (0.035, 0.026, 0.020), 14, 8, body_pivot)

    tail = empty('WhaleTailFlukePivot', body_pivot, (-4.78, 0, 0))
    for side in (-1, 1):
        create_airfoil_fin(f'Whale{"Right" if side > 0 else "Left"}BroadFluke', fin_mat,
                           (0, 0, 0), (-0.70, 0.05, side * 1.15),
                           (-0.55, 0.02, 0), (-0.18, 0.03, 0), (0, 1, 0),
                           0.12, 0, 9, 8, tail)

    frames = [1, 20, 40, 60, 80, 96]
    make_action_track(body_pivot, 'whale_body_undulation_loop', [
        {'frame': f, 'rotation': (0.014 * math.sin(i * math.tau / 5), -0.025 * math.sin(i * math.tau / 5), 0),
         'location': (0, 0.04 * math.sin(i * math.tau / 5), 0)}
        for i, f in enumerate(frames)
    ])
    make_action_track(tail, 'whale_body_undulation_loop', [
        {'frame': f, 'rotation': (0, 0.30 * math.sin(i * math.tau / 5), 0)}
        for i, f in enumerate(frames)
    ])
    return root


def create_hero_fish(file_name, root_name, species_id, body_color, flank_color, belly_color,
                     accent_color, fin_color, banner=False):
    clear_scene()
    root = empty(root_name, None)
    root['assetId'] = species_id
    body = empty(f'{species_id}_BodySwimPivot', root)
    tail = empty(f'{species_id}_TailPivot', body, (-1.05, 0, 0))
    atlas = make_texture_atlas(f'{species_id}_v4_basecolor_atlas', 512, {
        'body': body_color,
        'belly': belly_color,
        'accent': accent_color,
        'fin': fin_color,
    }, 'banner' if banner else 'reef')

    mats = {
        'dorsal': make_material(f'{species_id} dorsal PBR', body_color, 0.65),
        'flank': make_material(f'{species_id} satin flank PBR', flank_color, 0.66),
        'belly': make_material(f'{species_id} pearl belly PBR', belly_color, 0.63),
        'stripe': make_material(f'{species_id} graphic stripe PBR', accent_color, 0.7),
    }
    fin_mat = make_material(f'{species_id} translucent fin PBR', fin_color, 0.7, alpha=0.92)
    eye_mat = make_material(f'{species_id} bright black eyes PBR', 0x05070a, 0.35)
    glint_mat = make_material(f'{species_id} eye catchlight PBR', 0xf1ffff, 0.2, emission=(0xa8ffff, 0.55))
    texture_materials([mats['flank'], mats['stripe']], atlas)

    stripes = [(-0.55, -0.43, 'stripe'), (0.05, 0.16, 'stripe')] if not banner else [
        (-0.72, -0.58, 'stripe'), (-0.16, -0.01, 'stripe'), (0.45, 0.58, 'stripe')
    ]
    create_lathe_body(f'{species_id}_PremiumBody', [
        (-1.12, 0.04, 0.035), (-0.72, 0.24, 0.13), (-0.10, 0.37, 0.18),
        (0.62, 0.31, 0.16), (1.02, 0.13, 0.08), (1.16, 0.015, 0.015),
    ], mats, samples=54, radial=28, parent=body, x_stripes=stripes, wobble=0.015)

    create_airfoil_fin(f'{species_id}_DorsalRibbonFin', fin_mat, (-0.10, 0.34, 0), (-0.35, 0.78 if banner else 0.58, 0.02),
                       (-0.64, 0, 0), (-0.22, -0.04, 0), (0, 0, 1), 0.04, 0, 6, 6, body)
    create_airfoil_fin(f'{species_id}_VentralRibbonFin', fin_mat, (-0.12, -0.31, 0), (-0.36, -0.70 if banner else -0.52, 0.02),
                       (-0.50, 0, 0), (-0.20, 0.04, 0), (0, 0, 1), 0.04, 0, 6, 6, body)
    for side in (-1, 1):
        create_airfoil_fin(f'{species_id}_{"Right" if side > 0 else "Left"}PectoralFin', fin_mat,
                           (0.30, -0.05, side * 0.15), (-0.02, -0.18, side * 0.52),
                           (-0.20, 0, 0), (-0.10, -0.02, 0), (0, 1, 0), 0.04, 0, 5, 5, body)
        add_uv_ellipsoid(f'{species_id}_{"Right" if side > 0 else "Left"}Eye', eye_mat,
                         (0.82, 0.12, side * 0.12), (0.045, 0.034, 0.025), 16, 8, body)
        add_uv_ellipsoid(f'{species_id}_{"Right" if side > 0 else "Left"}EyeGlint', glint_mat,
                         (0.84, 0.135, side * 0.14), (0.014, 0.010, 0.008), 10, 6, body)

    create_airfoil_fin(f'{species_id}_UpperTailBlade', fin_mat, (0, 0.02, 0), (-0.35, 0.40, 0),
                       (-0.20, 0, 0), (-0.08, -0.02, 0), (0, 0, 1), 0.045, 0, 5, 5, tail)
    create_airfoil_fin(f'{species_id}_LowerTailBlade', fin_mat, (0, -0.02, 0), (-0.35, -0.40, 0),
                       (-0.20, 0, 0), (-0.08, 0.02, 0), (0, 0, 1), 0.045, 0, 5, 5, tail)

    clip = f'{species_id}_tail_body_swim_loop'
    frames = [1, 12, 24, 36, 48, 60]
    make_action_track(body, clip, [
        {'frame': f, 'rotation': (0, -0.04 * math.sin(i * math.tau / 3), 0.025 * math.sin(i * math.tau / 3))}
        for i, f in enumerate(frames)
    ])
    make_action_track(tail, clip, [
        {'frame': f, 'rotation': (0, 0.55 * math.sin(i * math.tau / 3), 0)}
        for i, f in enumerate(frames)
    ])
    return root


def main():
    assets = [
        ('rare-shark-v2.glb', create_shark),
        ('rare-shark.glb', create_shark_fallback),
        ('rare-turtle-v2.glb', create_turtle),
        ('rare-blue-whale-v1.glb', create_whale),
        ('hero-reef-fish.glb', lambda: create_hero_fish(
            'hero-reef-fish.glb',
            'OceanHeroReefFishV3',
            'hero-reef-fish',
            0x0d7f96,
            0x18b8c9,
            0xbceff0,
            0xffc45e,
            0x0f6f8c,
            False,
        )),
        ('hero-bannerfish.glb', lambda: create_hero_fish(
            'hero-bannerfish.glb',
            'OceanHeroBannerfishV3',
            'hero-bannerfish',
            0xf4ca58,
            0xffe79c,
            0xf7f1c4,
            0x15394f,
            0xf7f1c4,
            True,
        )),
    ]
    targets = {arg for arg in sys.argv[1:] if arg.endswith('.glb')}
    report = []
    for file_name, factory in assets:
        if targets and file_name not in targets:
            continue
        root = factory()
        report.append(export_glb(root, file_name))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
