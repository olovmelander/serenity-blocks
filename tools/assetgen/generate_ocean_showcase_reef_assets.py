#!/usr/bin/env python3
import json
import math
import os
import sys

import bpy


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
sys.path.insert(0, SCRIPT_DIR)

import generate_ocean_fauna_premium as fauna  # noqa: E402


REEF_DIR = os.path.join(REPO_ROOT, 'src', 'themes', 'ocean', 'assets', 'reef')
CORAL_DIR = os.path.join(REPO_ROOT, 'src', 'themes', 'ocean', 'assets', 'corals')
KELP_DIR = os.path.join(REPO_ROOT, 'src', 'themes', 'ocean', 'assets', 'kelp')


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


def mat(name, color, roughness=0.78, emission=None, alpha=1.0):
    return fauna.make_material(name, color, roughness, alpha=alpha, emission=emission)


def new_root(asset_id, kind):
    fauna.clear_scene()
    root = fauna.empty(asset_id, None)
    root['assetId'] = asset_id
    root['kind'] = kind
    root['sourcePolicy'] = 'blender-only-project-authored'
    root['styleTarget'] = 'stylized-aaa-reef-canyon'
    return root


def add_slab(name, material, location, scale, rotation, parent):
    obj = fauna.add_cube_detail(name, material, location, scale, rotation=rotation, parent=parent)
    bevel = obj.modifiers.new('soft sculpted ledge bevel', 'BEVEL')
    bevel.width = 0.055
    bevel.segments = 2
    bevel.affect = 'EDGES'
    obj.modifiers.new('weighted reef shelf normals', 'WEIGHTED_NORMAL')
    return obj


def add_layered_reef(root, prefix, width, depth, height, ledges, side_bias=1):
    rock_base = mat(f'{prefix} deep blue basalt PBR', 0x173f4c)
    rock_mid = mat(f'{prefix} turquoise shelf PBR', 0x245f66)
    rock_lit = mat(f'{prefix} caustic shelf tops PBR', 0x4e8882, emission=(0x74d8bd, 0.05))
    moss = mat(f'{prefix} violet algae trim PBR', 0x5d4a84, emission=(0xa871ff, 0.035))

    for i in range(ledges):
        t = i / max(1, ledges - 1)
        y = t * height
        x = side_bias * (0.08 * width * math.sin(i * 1.7))
        z = (t - 0.5) * depth + math.sin(i * 0.83) * 0.55
        slab_width = width * (0.88 - t * 0.34) * (0.88 + 0.16 * math.sin(i * 1.1))
        slab_depth = depth * (0.16 + 0.05 * math.cos(i * 1.8))
        slab_height = 0.34 + 0.18 * math.sin(i * 0.6) ** 2
        material = rock_lit if i % 5 == 0 else rock_mid if i % 2 else rock_base
        add_slab(
            f'{prefix}_stratified_shelf_{i:02d}',
            material,
            (x, y, z),
            (slab_width, slab_height, slab_depth),
            (0.02 * math.sin(i), 0.1 * math.sin(i * 0.57), 0.03 * math.cos(i)),
            root,
        )

    boulder_count = ledges * 2
    for i in range(boulder_count):
        angle = (i / boulder_count) * math.tau
        t = (i * 37 % 100) / 100
        x = side_bias * (width * 0.32 + math.sin(angle * 1.7) * width * 0.18)
        y = 0.4 + t * height * 0.92
        z = math.cos(angle) * depth * 0.38 + math.sin(i * 0.42) * 0.8
        scale = (
            0.7 + (i % 5) * 0.13,
            0.38 + (i % 4) * 0.09,
            0.55 + (i % 6) * 0.11,
        )
        obj = fauna.add_uv_ellipsoid(
            f'{prefix}_faceted_boulder_{i:02d}',
            rock_base if i % 4 else rock_lit,
            (x, y, z),
            scale,
            18,
            8,
            root,
        )
        obj.rotation_euler = (0.12 * math.sin(i), angle * 0.17, 0.18 * math.cos(i))

    for i in range(max(8, ledges)):
        z = -depth * 0.42 + (i / max(1, ledges - 1)) * depth * 0.84
        x = side_bias * (width * 0.08 + math.sin(i) * width * 0.17)
        y = 0.35 + (i % 5) * height * 0.12
        fauna.add_cylinder_detail(
            f'{prefix}_violet_coral_trim_{i:02d}',
            moss,
            (x, y, z),
            0.18 + (i % 3) * 0.04,
            0.42 + (i % 4) * 0.13,
            vertices=10,
            scale=(0.72, 1.0, 0.72),
            rotation=(0.12 * math.sin(i), 0, 0.12 * math.cos(i)),
            parent=root,
        )


def create_reef_wall_left():
    root = new_root('reef-wall-left-01', 'left-canyon-wall')
    add_layered_reef(root, 'reef_wall_left_01', 4.7, 5.6, 4.8, 16, -1)
    return root


def create_reef_shelf_right():
    root = new_root('reef-shelf-right-01', 'right-coral-shelf')
    add_layered_reef(root, 'reef_shelf_right_01', 5.6, 4.4, 2.8, 13, 1)
    return root


def create_reef_shelf_left():
    root = new_root('reef-shelf-left-01', 'left-coral-shelf')
    add_layered_reef(root, 'reef_shelf_left_01', 4.8, 4.8, 3.2, 12, -1)
    return root


def create_reef_arch_mid():
    root = new_root('reef-arch-mid-01', 'mid-canyon-arch')
    rock = mat('reef arch blue stone PBR', 0x1c4c5a)
    lip = mat('reef arch turquoise rim PBR', 0x4e8882, emission=(0x8debd3, 0.045))
    for side in (-1, 1):
        for i in range(9):
            fauna.add_uv_ellipsoid(
                f'reef_arch_mid_01_pillar_{side}_{i:02d}',
                lip if i > 6 else rock,
                (side * (1.6 + 0.08 * math.sin(i)), 0.34 + i * 0.5, 0.08 * math.cos(i)),
                (0.72 - i * 0.025, 0.36, 0.64 - i * 0.018),
                28,
                12,
                root,
            )
    for i in range(8):
        x = -1.25 + i * 0.36
        y = 4.65 + math.sin(i * 0.7) * 0.12
        add_slab(
            f'reef_arch_mid_01_bridge_{i:02d}',
            lip if i % 3 == 0 else rock,
            (x, y, 0),
            (0.5, 0.38, 0.72),
            (0.0, 0.02 * math.sin(i), 0.09 * math.sin(i * 0.5)),
            root,
        )
    return root


def create_reef_arch_coral():
    root = new_root('reef-arch-coral-01', 'foreground-coral-arch')
    rock = mat('reef coral arch blue stone PBR', 0x1b4d5a)
    rock_lit = mat('reef coral arch shelf top PBR', 0x4d8880, emission=(0x8debd3, 0.04))
    violet = mat('reef coral arch violet carpet PBR', 0x6b56b9, emission=(0x9b79ff, 0.12))
    orange = mat('reef coral arch orange tube PBR', 0xf08a31, emission=(0xffb15a, 0.16))
    green = mat('reef coral arch seafoam plate PBR', 0x8fcf76, emission=(0xc9ff94, 0.08))
    pink = mat('reef coral arch pink fan PBR', 0xe06f91, emission=(0xff94c2, 0.1))

    for side in (-1, 1):
        for i in range(7):
            y = 0.34 + i * 0.52
            taper = 1.0 - i * 0.045
            z = math.sin(i * 0.72) * 0.22
            obj = fauna.add_uv_ellipsoid(
                f'reef_arch_coral_01_pillar_{side}_{i:02d}',
                rock_lit if i > 4 else rock,
                (side * (1.42 + math.sin(i * 0.41) * 0.08), y, z),
                (0.66 * taper, 0.34, 0.58 * taper),
                26,
                12,
                root,
            )
            obj.rotation_euler = (0.08 * math.sin(i), side * 0.14, 0.05 * math.cos(i))

        for i in range(4):
            y = 0.62 + i * 0.64
            fauna.add_cylinder_detail(
                f'reef_arch_coral_01_side_tube_{side}_{i:02d}',
                orange if i % 2 else green,
                (side * 1.18, y, -0.48 - i * 0.05),
                0.085 + i * 0.012,
                0.42 + i * 0.11,
                vertices=14,
                scale=(0.72, 1.0, 0.72),
                rotation=(0.22, 0, side * 0.16),
                parent=root,
            )

    for i in range(8):
        x = -1.2 + i * 0.34
        y = 3.75 + math.sin(i * 0.7) * 0.1
        add_slab(
            f'reef_arch_coral_01_bridge_{i:02d}',
            rock_lit if i % 2 else rock,
            (x, y, math.sin(i * 0.45) * 0.08),
            (0.48, 0.32, 0.64),
            (0.0, 0.04 * math.sin(i), 0.08 * math.sin(i * 0.6)),
            root,
        )

    for i in range(46):
        angle = (i * 2.399963) % math.tau
        side = -1 if i % 2 == 0 else 1
        shelf_x = side * (0.52 + math.sqrt((i % 23 + 0.5) / 23) * 0.62)
        shelf_z = math.sin(angle) * 0.52
        shelf_y = 3.98 + math.cos(angle) * 0.08
        if i % 5 == 0:
            fauna.add_cylinder_detail(
                f'reef_arch_coral_01_plate_{i:02d}',
                green,
                (shelf_x, shelf_y + 0.05, shelf_z),
                0.18 + (i % 4) * 0.025,
                0.035,
                vertices=32,
                scale=(1.35, 1.0, 0.68),
                rotation=(0.04 * math.sin(i), 0, angle),
                parent=root,
            )
        elif i % 3 == 0:
            fauna.add_cylinder_detail(
                f'reef_arch_coral_01_tube_{i:02d}',
                orange,
                (shelf_x, shelf_y + 0.12, shelf_z),
                0.045 + (i % 3) * 0.008,
                0.28 + (i % 4) * 0.06,
                vertices=12,
                scale=(0.78, 1.0, 0.78),
                rotation=(0.12 * math.sin(i), 0, 0.1 * math.cos(i)),
                parent=root,
            )
        else:
            fauna.add_cylinder_detail(
                f'reef_arch_coral_01_violet_polyp_{i:02d}',
                violet,
                (shelf_x, shelf_y + 0.08, shelf_z),
                0.035 + (i % 3) * 0.006,
                0.16 + (i % 5) * 0.025,
                vertices=8,
                scale=(0.7, 1.0, 0.7),
                parent=root,
            )

    for side in (-1, 1):
        for i in range(5):
            fauna.add_cube_detail(
                f'reef_arch_coral_01_fan_{side}_{i:02d}',
                pink,
                (side * (1.72 + i * 0.04), 1.0 + i * 0.44, 0.34 + i * 0.04),
                (0.035, 0.36 + i * 0.035, 0.24 + i * 0.02),
                rotation=(0.0, side * 0.24, 0.18 * side),
                parent=root,
            )
    return root


def create_reef_stack_far():
    root = new_root('reef-stack-far-01', 'far-blue-stack')
    add_layered_reef(root, 'reef_stack_far_01', 3.4, 3.8, 5.4, 14, 1)
    root.scale = (0.82, 1.0, 0.82)
    return root


def create_coral_carpet_purple():
    root = new_root('coral-carpet-purple-01', 'purple-blue-coral-carpet')
    base = mat('coral carpet violet mat PBR', 0x583f91, emission=(0x8e6dff, 0.08))
    tip = mat('coral carpet electric blue tips PBR', 0x2ba9d7, emission=(0x64dcff, 0.18))
    mat_green = mat('coral carpet lime sprout PBR', 0x9bdc66, emission=(0xc8ff8a, 0.08))
    fauna.add_cylinder_detail('coral_carpet_purple_01_low_patch', base, (0, 0.05, 0), 1.05, 0.1, vertices=64, scale=(1.35, 1, 0.72), parent=root)
    for i in range(94):
        angle = (i * 2.399963) % math.tau
        radius = math.sqrt((i + 0.5) / 94) * 1.08
        x = math.cos(angle) * radius * 1.22
        z = math.sin(angle) * radius * 0.72
        h = 0.16 + (i % 7) * 0.025
        fauna.add_cylinder_detail(
            f'coral_carpet_purple_01_polyp_{i:02d}',
            tip if i % 4 == 0 else mat_green if i % 11 == 0 else base,
            (x, 0.11 + h * 0.5, z),
            0.035 + (i % 3) * 0.008,
            h,
            vertices=8,
            scale=(0.72, 1.0, 0.72),
            parent=root,
        )
    return root


def create_tube_orange():
    root = new_root('coral-tube-orange-01', 'orange-tube-sponge-cluster')
    tube = mat('tube sponge warm orange PBR', 0xf08a31, emission=(0xffb15a, 0.16))
    rim = mat('tube sponge yellow rim PBR', 0xf7d460, emission=(0xfff08a, 0.22))
    shadow = mat('tube sponge dark openings PBR', 0x492b34)
    for i in range(46):
        angle = (i * 2.399963) % math.tau
        radius = math.sqrt((i + 0.5) / 46) * 0.95
        h = 0.38 + (i % 8) * 0.095
        x = math.cos(angle) * radius
        z = math.sin(angle) * radius * 0.74
        fauna.add_cylinder_detail(
            f'coral_tube_orange_01_tube_{i:02d}',
            tube if i % 5 else rim,
            (x, h * 0.5, z),
            0.07 + (i % 4) * 0.013,
            h,
            vertices=16,
            scale=(0.74, 1.0, 0.74),
            rotation=(0.08 * math.sin(i), 0, 0.08 * math.cos(i)),
            parent=root,
        )
        fauna.add_cylinder_detail(
            f'coral_tube_orange_01_opening_{i:02d}',
            shadow,
            (x, h + 0.012, z),
            0.045 + (i % 4) * 0.009,
            0.024,
            vertices=16,
            scale=(0.76, 1.0, 0.76),
            parent=root,
        )
    return root


def create_plate_green():
    root = new_root('coral-plate-green-01', 'green-yellow-plate-coral')
    plate = mat('plate coral seafoam green PBR', 0x79c782, emission=(0xb4f48f, 0.08))
    rim = mat('plate coral yellow rim PBR', 0xd4cf62, emission=(0xffff90, 0.12))
    stem = mat('plate coral shaded stalk PBR', 0x436f64)
    for i in range(18):
        angle = (i / 18) * math.tau
        r = 0.18 + (i % 4) * 0.13
        h = 0.18 + i * 0.035
        fauna.add_cylinder_detail(
            f'coral_plate_green_01_stem_{i:02d}',
            stem,
            (math.cos(angle) * r * 0.52, h * 0.5, math.sin(angle) * r * 0.42),
            0.035,
            h,
            vertices=12,
            parent=root,
        )
        fauna.add_cylinder_detail(
            f'coral_plate_green_01_plate_{i:02d}',
            rim if i % 3 == 0 else plate,
            (math.cos(angle) * r, h + 0.06, math.sin(angle) * r * 0.72),
            0.26 + (i % 5) * 0.045,
            0.035,
            vertices=48,
            scale=(1.38, 1.0, 0.66),
            rotation=(0.04 * math.sin(i), 0, angle),
            parent=root,
        )
    return root


def create_brush_blue():
    root = new_root('coral-brush-blue-01', 'blue-brush-coral')
    base = mat('blue brush coral stalk PBR', 0x217ca0, emission=(0x4bd8ff, 0.08))
    tip = mat('blue brush coral violet tips PBR', 0x7352ba, emission=(0xa77cff, 0.16))
    for i in range(72):
        angle = (i * 2.399963) % math.tau
        radius = math.sqrt((i + 0.5) / 72) * 0.95
        h = 0.32 + (i % 9) * 0.055
        x = math.cos(angle) * radius * 1.04
        z = math.sin(angle) * radius * 0.72
        fauna.add_cylinder_detail(
            f'coral_brush_blue_01_stalk_{i:02d}',
            tip if i % 4 == 0 else base,
            (x, h * 0.5, z),
            0.028 + (i % 3) * 0.006,
            h,
            vertices=8,
            scale=(0.58, 1.0, 0.58),
            rotation=(0.16 * math.sin(angle), 0, -0.16 * math.cos(angle)),
            parent=root,
        )
    return root


ASSETS = [
    (REEF_DIR, 'reef-wall-left-01.glb', create_reef_wall_left),
    (REEF_DIR, 'reef-shelf-right-01.glb', create_reef_shelf_right),
    (REEF_DIR, 'reef-shelf-left-01.glb', create_reef_shelf_left),
    (REEF_DIR, 'reef-arch-mid-01.glb', create_reef_arch_mid),
    (REEF_DIR, 'reef-arch-coral-01.glb', create_reef_arch_coral),
    (REEF_DIR, 'reef-stack-far-01.glb', create_reef_stack_far),
    (CORAL_DIR, 'coral-carpet-purple-01.glb', create_coral_carpet_purple),
    (CORAL_DIR, 'coral-tube-orange-01.glb', create_tube_orange),
    (CORAL_DIR, 'coral-plate-green-01.glb', create_plate_green),
    (CORAL_DIR, 'coral-brush-blue-01.glb', create_brush_blue),
]


def main():
    targets = {arg for arg in sys.argv[1:] if arg.endswith('.glb')}
    assets = [
        (directory, file_name, factory)
        for directory, file_name, factory in ASSETS
        if not targets or file_name in targets
    ]
    if targets and not assets:
        raise SystemExit(f'No matching ocean showcase assets for: {sorted(targets)}')

    stats = []
    for directory, file_name, factory in assets:
        root = factory()
        info = export_glb(root, directory, file_name)
        stats.append(info)
    print(json.dumps(stats, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
