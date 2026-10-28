"""Forest's eagle owl in Blender: the armature, the skinned mesh, posing from the runtime's numbers,
previews and the GLB.

Everything is made in a scene of its own (SCENE_NAME), so it can run inside an open Blender session
(the Blender MCP design loop) without touching anything else, or headless with --factory-startup.
Every bone points up its rest frame: a bone's rest rotation is the identity, so a rotation the theme
sets is about the owl's own axes (x its left, y up, z forward) and glTF carries them as they are.
"""

import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from .model import skeleton

SCENE_NAME = "Serenity Forest - Owl Atelier"
PREFIX = "SFOWL_"


def to_blender(points):
    """glTF/three (x, y up, z forward) -> Blender (x, y back, z up)."""
    points = np.asarray(points, dtype=np.float64)
    return np.stack([points[..., 0], -points[..., 2], points[..., 1]], axis=-1)


def atelier(fresh=False):
    scene = bpy.data.scenes.get(SCENE_NAME) or bpy.data.scenes.new(SCENE_NAME)
    if fresh:
        clear(scene)
    return scene


def clear(scene):
    for obj in list(scene.collection.all_objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and getattr(data, "users", 1) == 0:
            for pool in (bpy.data.meshes, bpy.data.armatures, bpy.data.cameras, bpy.data.lights):
                if data.name in pool and pool[data.name] == data:
                    pool.remove(data)
                    break


class DecimateStudio:
    def __init__(self, scene):
        self.scene = scene
        self.layer = scene.view_layers[0]

    def mesh_object(self, name, positions, triangles):
        mesh = bpy.data.meshes.new(PREFIX + name)
        mesh.from_pydata([tuple(p) for p in to_blender(positions)], [], [tuple(int(i) for i in t) for t in triangles])
        mesh.update()
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        self.scene.collection.objects.link(obj)
        self.layer.update()
        return obj


def make_armature(scene, name="Owl"):
    data = bpy.data.armatures.new(PREFIX + name + "Rig")
    arm = bpy.data.objects.new(name + "Rig", data)
    scene.collection.objects.link(arm)
    window_scene = bpy.context.window.scene if bpy.context.window else None
    view_layer = scene.view_layers[0]
    if bpy.context.window:
        bpy.context.window.scene = scene
    view_layer.objects.active = arm
    for obj in view_layer.objects:
        obj.select_set(obj == arm)
    with bpy.context.temp_override(scene=scene, view_layer=view_layer, active_object=arm, object=arm):
        bpy.ops.object.mode_set(mode="EDIT")
        for bone_name, parent, head in skeleton():
            bone = data.edit_bones.new(bone_name)
            h = Vector(to_blender(head))
            bone.head = h
            bone.tail = h + Vector((0.0, 0.0, 0.01))
            bone.roll = 0.0
            if parent:
                bone.parent = data.edit_bones[parent]
                bone.use_connect = False
        bpy.ops.object.mode_set(mode="OBJECT")
    if window_scene is not None and bpy.context.window:
        bpy.context.window.scene = window_scene
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
    data.display_type = "STICK"
    return arm


def make_mesh(scene, owl, arm, name="Owl"):
    mesh = bpy.data.meshes.new(PREFIX + name)
    mesh.from_pydata([tuple(p) for p in to_blender(owl.positions)], [],
                     [tuple(int(i) for i in t) for t in owl.triangles])
    mesh.update()
    mesh.shade_smooth()
    mesh.normals_split_custom_set_from_vertices([tuple(n) for n in to_blender(owl.normals)])
    colour = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    colour.data.foreach_set("color", owl.colors.astype(np.float32).ravel())
    mesh.color_attributes.active_color = colour
    mesh.color_attributes.render_color_index = 0
    plumage = mesh.attributes.new("_plumage", "FLOAT_COLOR", "POINT")
    plumage.data.foreach_set("color", owl.plumage.astype(np.float32).ravel())
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    names = [bone[0] for bone in skeleton()]
    groups = [obj.vertex_groups.new(name=bone_name) for bone_name in names]
    for vertex in range(len(owl.positions)):
        for slot in range(4):
            w = float(owl.weights[vertex, slot])
            if w > 0.0:
                groups[int(owl.joints[vertex, slot])].add([vertex], w, "REPLACE")
    obj.parent = arm
    modifier = obj.modifiers.new("Rig", "ARMATURE")
    modifier.object = arm
    return obj


def apply_pose(arm, pose):
    """`pose` = {bone: (w, x, y, z) in the owl frame, "<bone>@": (x, y, z) metres moved, "<bone>%": (sx, sy, sz)}."""
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)
    for key, value in pose.items():
        if key.endswith("@"):
            # A bone's local frame is the owl's: local x = x, local y = up, local z = forward.
            arm.pose.bones[key[:-1]].location = (value[0], value[1], value[2])
        elif key.endswith("%"):
            arm.pose.bones[key[:-1]].scale = (value[0], value[1], value[2])
        elif key in arm.pose.bones:
            arm.pose.bones[key].rotation_quaternion = Quaternion(tuple(value))


def place(obj, position, quaternion=None):
    """Put an object (the rig) at a glTF-frame position, turned by a glTF-frame quaternion (w, x, y, z)."""
    g2b = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    q = Quaternion(tuple(quaternion)) if quaternion is not None else Quaternion()
    m = Matrix.Translation(Vector(position)) @ q.to_matrix().to_4x4()
    obj.matrix_world = g2b @ m @ g2b.inverted()


# -- previews -----------------------------------------------------------------------------
def workbench(scene, size=(900, 700), colour="VERTEX", background=(0.13, 0.13, 0.15)):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = colour
    shading.show_shadows = False
    shading.show_cavity = True
    shading.cavity_type = "WORLD"
    shading.show_object_outline = False
    shading.show_backface_culling = False
    shading.background_type = "VIEWPORT"
    shading.background_color = background
    scene.display.render_aa = "16"
    scene.view_settings.view_transform = "Standard"


def camera(scene, eye, target, lens=None, ortho=None, name="Cam"):
    cam_name = PREFIX + name
    obj = scene.objects.get(cam_name)
    if obj is None:
        data = bpy.data.cameras.new(cam_name)
        obj = bpy.data.objects.new(cam_name, data)
        scene.collection.objects.link(obj)
    data = obj.data
    if ortho is not None:
        data.type = "ORTHO"
        data.ortho_scale = ortho
    else:
        data.type = "PERSP"
        data.lens = lens or 50.0
    data.clip_start = 0.005
    data.clip_end = 80.0
    e = Vector(to_blender(eye))
    t = Vector(to_blender(target))
    obj.location = e
    obj.rotation_euler = (t - e).to_track_quat("-Z", "Y").to_euler()
    scene.camera = obj
    return obj


def render(scene, path):
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True, scene=scene.name)
    return str(path)


def export(path, objects):
    """The rig and its skinned body as one GLB (no animations: the theme poses every bone)."""
    # A view layer lists objects linked since its last update only after it is updated again.
    bpy.context.view_layer.update()
    for obj in bpy.context.view_layer.objects:
        obj.select_set(obj in objects)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_skins=True,
        export_def_bones=False,
        export_leaf_bone=False,
        export_rest_position_armature=True,
        export_animations=False,
        export_morph=False,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="NONE",
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_attributes=True,
        export_extras=False,
    )
    return str(path)
