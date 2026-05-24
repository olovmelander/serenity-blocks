#!/usr/bin/env python3
import json
import math
import os
import sys

import bpy
from mathutils import Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
sys.path.insert(0, SCRIPT_DIR)

import generate_ocean_fauna_premium as fauna  # noqa: E402


CORAL_DIR = os.path.join(REPO_ROOT, 'src', 'themes', 'ocean', 'assets', 'corals')
KELP_DIR = os.path.join(REPO_ROOT, 'src', 'themes', 'ocean', 'assets', 'kelp')
FAUNA_DIR = os.path.join(REPO_ROOT, 'src', 'themes', 'ocean', 'assets', 'fauna')


def export_glb(root, directory, file_name):
    os.makedirs(directory, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = os.path.join(directory, file_name)
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
    return fauna.inspect_glb(path)


def make_coral_material(name, color, emission=None):
    return fauna.make_material(name, color, 0.78, emission=emission)


def coral_root(asset_id):
    fauna.clear_scene()
    root = fauna.empty(asset_id, None)
    root['assetId'] = asset_id
    root['sourcePolicy'] = 'blender-only-project-authored'
    return root


def add_branch_cluster(root, asset_id, palette, seed=0):
    base_mat = make_coral_material(f'{asset_id} warm base PBR', palette[0])
    tip_mat = make_coral_material(f'{asset_id} glowing tips PBR', palette[1], emission=(palette[1], 0.16))
    plate_mat = make_coral_material(f'{asset_id} shaded plates PBR', palette[2])

    fauna.add_cylinder_detail(
        f'{asset_id}_basal_mound',
        plate_mat,
        (0, 0.12, 0),
        0.82,
        0.24,
        vertices=32,
        scale=(1.3, 1, 0.92),
        parent=root,
    )
    branch_count = 24 + seed % 5
    for i in range(branch_count):
        angle = (i / branch_count) * math.tau + math.sin(i * 1.7) * 0.18
        radius = 0.12 + 0.45 * ((i * 37 + seed) % 100) / 100
        height = 0.72 + 0.9 * ((i * 53 + seed) % 100) / 100
        x = math.cos(angle) * radius
        z = math.sin(angle) * radius
        obj = fauna.add_cylinder_detail(
            f'{asset_id}_branch_{i:02d}',
            base_mat if i % 3 else tip_mat,
            (x, height * 0.5 + 0.14, z),
            0.075 + 0.035 * (1 - i / max(1, branch_count)),
            height,
            vertices=18,
            scale=(0.75, 1, 0.75),
            rotation=(math.sin(angle) * 0.25, 0, -math.cos(angle) * 0.28),
            parent=root,
        )
        fauna.shade_smooth(obj)
        if i % 2 == 0:
            side = fauna.add_cylinder_detail(
                f'{asset_id}_side_branch_{i:02d}',
                tip_mat,
                (x + math.cos(angle + 0.7) * 0.16, height * 0.78, z + math.sin(angle + 0.7) * 0.16),
                0.038,
                height * 0.46,
                vertices=14,
                scale=(0.7, 1, 0.7),
                rotation=(0.55 * math.sin(angle), 0, -0.55 * math.cos(angle)),
                parent=root,
            )
            fauna.shade_smooth(side)
    return root


def create_coral_branch():
    root = coral_root('coral-branch-01')
    return add_branch_cluster(root, 'coral_branch_01', [0xc86e54, 0xff9b72, 0x794c62], 11)


def create_coral_spire():
    root = coral_root('coral-spire-01')
    mat = make_coral_material('coral spire ochre PBR', 0xcc8d52, emission=(0xffc173, 0.12))
    shadow = make_coral_material('coral spire shadow PBR', 0x73524b)
    for i in range(32):
        angle = (i / 32) * math.tau
        radius = 0.18 + (i % 5) * 0.1
        height = 0.95 + (i % 7) * 0.18
        fauna.add_cylinder_detail(
            f'coral_spire_01_spire_{i:02d}',
            mat if i % 4 else shadow,
            (math.cos(angle) * radius, height * 0.5, math.sin(angle) * radius),
            0.09 - min(0.045, i * 0.002),
            height,
            vertices=16,
            scale=(0.82, 1, 0.82),
            rotation=(math.sin(angle) * 0.18, 0, -math.cos(angle) * 0.18),
            parent=root,
        )
    fauna.add_cylinder_detail('coral_spire_01_base', shadow, (0, 0.1, 0), 0.72, 0.2, vertices=48, parent=root)
    return root


def create_coral_anemone():
    root = coral_root('coral-anemone-01')
    mat = make_coral_material('coral anemone teal body PBR', 0x4a8a82)
    tip_mat = make_coral_material('coral anemone lime tips PBR', 0xb5f07d, emission=(0x9be875, 0.22))
    fauna.add_uv_ellipsoid('coral_anemone_01_body', mat, (0, 0.2, 0), (0.82, 0.22, 0.72), 48, 16, root)
    for ring, count in enumerate((14, 18, 24)):
        radius = 0.24 + ring * 0.2
        for i in range(count):
            angle = (i / count) * math.tau + ring * 0.12
            length = 0.48 + ring * 0.16 + math.sin(i * 1.9) * 0.08
            fauna.add_cylinder_detail(
                f'coral_anemone_01_tendril_{ring}_{i:02d}',
                tip_mat if ring == 2 else mat,
                (math.cos(angle) * radius, 0.48 + ring * 0.05, math.sin(angle) * radius),
                0.025,
                length,
                vertices=8,
                scale=(0.55, 1, 0.55),
                rotation=(0.72 * math.sin(angle), 0, -0.72 * math.cos(angle)),
                parent=root,
            )
    return root


def create_coral_boulder():
    root = coral_root('coral-boulder-01')
    mat = make_coral_material('coral boulder plum PBR', 0x8b5478, emission=(0xff8db4, 0.08))
    ridge = make_coral_material('coral boulder ridge PBR', 0xd08f7d)
    fauna.add_uv_ellipsoid('coral_boulder_01_mass', mat, (0, 0.46, 0), (1.12, 0.52, 0.92), 72, 32, root)
    for i in range(34):
        angle = (i / 34) * math.tau
        y = 0.34 + 0.34 * math.sin(i * 0.41) ** 2
        fauna.add_cylinder_detail(
            f'coral_boulder_01_ridge_{i:02d}',
            ridge if i % 3 == 0 else mat,
            (math.cos(angle) * 0.62, y, math.sin(angle) * 0.50),
            0.018,
            0.52,
            vertices=6,
            scale=(0.5, 1, 0.5),
            rotation=(0.0, 0, angle + math.pi / 2),
            parent=root,
        )
    return root


def create_coral_table():
    root = coral_root('coral-table-01')
    mat = make_coral_material('coral table rust PBR', 0xc06a52, emission=(0xff8c6a, 0.1))
    shadow = make_coral_material('coral table underside PBR', 0x5d4846)
    for i in range(12):
        angle = (i / 12) * math.tau
        radius = 0.15 + (i % 3) * 0.12
        fauna.add_cylinder_detail(
            f'coral_table_01_stem_{i:02d}',
            shadow,
            (math.cos(angle) * radius, 0.42, math.sin(angle) * radius),
            0.075,
            0.84,
            vertices=16,
            parent=root,
        )
    for i in range(8):
        angle = (i / 8) * math.tau + 0.2
        fauna.add_cylinder_detail(
            f'coral_table_01_plate_{i:02d}',
            mat,
            (math.cos(angle) * 0.34, 0.78 + i * 0.045, math.sin(angle) * 0.27),
            0.48 + i * 0.04,
            0.055,
            vertices=64,
            scale=(1.55, 1, 0.72),
            rotation=(0.08 * math.sin(angle), 0.0, angle),
            parent=root,
        )
    return root


def create_coral_fan():
    root = coral_root('coral-fan-01')
    mat = make_coral_material('coral fan teal pink PBR', 0x4a8a82, emission=(0xf2a3a0, 0.09))
    edge = make_coral_material('coral fan warm rim PBR', 0xd38b74)
    for i in range(7):
        angle = -0.75 + i * 0.25
        fan = fauna.create_airfoil_fin(
            f'coral_fan_01_panel_{i:02d}',
            mat if i % 2 else edge,
            (0.0, 0.25, 0.0),
            (math.sin(angle) * 0.9, 1.52 + i * 0.05, math.cos(angle) * 0.22),
            (-0.62, 0.04, 0),
            (-0.15, 0.02, 0),
            (0, 0, 1),
            0.018,
            0.0,
            20,
            12,
            root,
        )
        fan.rotation_euler.y = angle * 0.35
    fauna.add_cylinder_detail('coral_fan_01_base', edge, (0, 0.13, 0), 0.52, 0.25, vertices=40, parent=root)
    return root


def create_kelp_blade_mesh(name, mat, height, width, bend, parent):
    segments = 64
    verts = []
    faces = []
    uvs = []
    for i in range(segments + 1):
        t = i / segments
        y = t * height
        taper = 1 - t * 0.66
        curve = math.sin(t * math.pi) * bend
        half = width * taper
        verts.append((-half + curve, y, 0))
        verts.append((half + curve, y, 0))
        uvs.extend([(0, t), (1, t)])
        if i < segments:
            a = i * 2
            faces.append((a, a + 1, a + 3, a + 2))
    mesh = bpy.data.meshes.new(f'{name}Mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            uv_layer.data[loop_index].uv = uvs[mesh.loops[loop_index].vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    obj.parent = parent
    fauna.shade_smooth(obj)
    return obj


def create_kelp_grove(asset_id, count, height_base, seed):
    fauna.clear_scene()
    root = fauna.empty(asset_id, None)
    root['assetId'] = asset_id
    root['sourcePolicy'] = 'blender-only-project-authored'
    mat = fauna.make_material(f'{asset_id} satin green PBR', 0x23785a, 0.72, alpha=0.94, emission=(0x60e09a, 0.04))
    for i in range(count):
        angle = (i / count) * math.tau + seed * 0.13
        radius = 0.08 + 0.75 * ((i * 41 + seed) % 100) / 100
        blade = create_kelp_blade_mesh(
            f'{asset_id}_blade_{i:02d}',
            mat,
            height_base * (0.78 + 0.42 * ((i * 17 + seed) % 100) / 100),
            0.20 + 0.12 * ((i * 29 + seed) % 100) / 100,
            math.sin(i * 1.8 + seed) * 0.55,
            root,
        )
        blade.location = (math.cos(angle) * radius, 0, math.sin(angle) * radius)
        blade.rotation_euler = (math.sin(angle) * 0.08, angle, math.cos(angle) * 0.08)
    return root


def main():
    assets = [
        (CORAL_DIR, 'coral-branch-01.glb', create_coral_branch),
        (CORAL_DIR, 'coral-fan-01.glb', create_coral_fan),
        (CORAL_DIR, 'coral-table-01.glb', create_coral_table),
        (CORAL_DIR, 'coral-spire-01.glb', create_coral_spire),
        (CORAL_DIR, 'coral-anemone-01.glb', create_coral_anemone),
        (CORAL_DIR, 'coral-boulder-01.glb', create_coral_boulder),
        (KELP_DIR, 'kelp-grove-01.glb', lambda: create_kelp_grove('kelp-grove-01', 10, 7.4, 3)),
        (KELP_DIR, 'kelp-grove-02.glb', lambda: create_kelp_grove('kelp-grove-02', 11, 8.1, 17)),
        (KELP_DIR, 'kelp-grove-03.glb', lambda: create_kelp_grove('kelp-grove-03', 13, 8.8, 31)),
        (KELP_DIR, 'kelp-grove-04.glb', lambda: create_kelp_grove('kelp-grove-04', 12, 9.2, 47)),
        (FAUNA_DIR, 'hero-angelfish.glb', lambda: fauna.create_hero_fish(
            'hero-angelfish.glb',
            'OceanHeroAngelfishV1',
            'hero-angelfish',
            0x235a8f,
            0x46b6c8,
            0xf4eac5,
            0xf6b84f,
            0x5bc6bd,
            True,
        )),
        (FAUNA_DIR, 'hero-mandarinfish.glb', lambda: fauna.create_hero_fish(
            'hero-mandarinfish.glb',
            'OceanHeroMandarinfishV1',
            'hero-mandarinfish',
            0x1e6f6b,
            0x34a08b,
            0xd6f3d6,
            0xff7f4f,
            0x4bc6d8,
            False,
        )),
    ]
    report = []
    for directory, file_name, factory in assets:
        root = factory()
        report.append(export_glb(root, directory, file_name))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
