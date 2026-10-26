"""Fall's red squirrel in Blender: the armature, the skinned mesh, the clips as actions, previews and the GLB.

Everything is made in a scene of its own (SCENE_NAME), so it can run inside an open Blender session
(the Blender MCP design loop) without touching anything else, or headless with --factory-startup.
Every bone points up its rest frame: a bone's rest rotation is the identity, so a clip's rotations are
about the squirrel's own axes (x its left, y up, z forward) and glTF carries them as they are.
"""

import math

import bpy
import numpy as np
from mathutils import Euler, Quaternion, Vector

from .model import PARTS, skeleton

SCENE_NAME = "Serenity Fall - Squirrel Atelier"
ACORN_SIZE = 1.4
PREFIX = "SFSQ_"
FPS = 30


def to_blender(points):
    """glTF/three (x, y up, z forward) -> Blender (x, y back, z up)."""
    points = np.asarray(points, dtype=np.float64)
    return np.stack([points[..., 0], -points[..., 2], points[..., 1]], axis=-1)


def atelier(fresh=False):
    """The squirrel's own scene (made if missing); `fresh` empties it first."""
    scene = bpy.data.scenes.get(SCENE_NAME) or bpy.data.scenes.new(SCENE_NAME)
    if fresh:
        clear(scene)
    scene.render.fps = FPS
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
    for action in list(bpy.data.actions):
        if action.name.startswith(PREFIX):
            bpy.data.actions.remove(action)


class DecimateStudio:
    """What horse_sdf.decimate needs: a scene to evaluate a temporary mesh in."""

    def __init__(self, scene):
        self.scene = scene
        self.layer = scene.view_layers[0]

    def mesh_object(self, name, positions, triangles):
        mesh = bpy.data.meshes.new(PREFIX + name)
        mesh.from_pydata([tuple(p) for p in to_blender(positions)], [], [tuple(int(i) for i in t) for t in triangles])
        mesh.update()
        obj = bpy.data.objects.new(PREFIX + name, mesh)
        self.scene.collection.objects.link(obj)
        # A scene that is in no window has no depsgraph until its view layer is updated.
        self.layer.update()
        return obj


# -- the rig and the skinned mesh ---------------------------------------------------------
def make_armature(scene, name="Squirrel"):
    data = bpy.data.armatures.new(PREFIX + name + "Rig")
    arm = bpy.data.objects.new(name + "Rig", data)
    scene.collection.objects.link(arm)
    window_scene = bpy.context.window.scene if bpy.context.window else None
    view_layer = scene.view_layers[0]
    # Edit mode needs the armature active in a view layer of the context's scene.
    if bpy.context.window:
        bpy.context.window.scene = scene
    view_layer.objects.active = arm
    for obj in view_layer.objects:
        obj.select_set(obj == arm)
    with bpy.context.temp_override(scene=scene, view_layer=view_layer, active_object=arm, object=arm):
        bpy.ops.object.mode_set(mode="EDIT")
        for bone_name, parent, head, _tip in skeleton():
            bone = data.edit_bones.new(bone_name)
            h = Vector(to_blender(head))
            bone.head = h
            bone.tail = h + Vector((0.0, 0.0, 0.012))
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


def make_mesh(scene, squirrel, arm, name="Squirrel"):
    mesh = bpy.data.meshes.new(PREFIX + name)
    mesh.from_pydata([tuple(p) for p in to_blender(squirrel.positions)], [],
                     [tuple(int(i) for i in t) for t in squirrel.triangles])
    mesh.update()
    mesh.shade_smooth()
    mesh.normals_split_custom_set_from_vertices([tuple(n) for n in to_blender(squirrel.normals)])
    colour = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    colour.data.foreach_set("color", squirrel.colors.astype(np.float32).ravel())
    mesh.color_attributes.active_color = colour
    mesh.color_attributes.render_color_index = 0
    fur = mesh.attributes.new("_fur", "FLOAT_COLOR", "POINT")
    fur.data.foreach_set("color", squirrel.fur.astype(np.float32).ravel())
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    names = [bone[0] for bone in skeleton()]
    groups = [obj.vertex_groups.new(name=bone_name) for bone_name in names]
    for vertex in range(len(squirrel.positions)):
        for slot in range(4):
            w = float(squirrel.weights[vertex, slot])
            if w > 0.0:
                groups[int(squirrel.joints[vertex, slot])].add([vertex], w, "REPLACE")
    obj.parent = arm
    modifier = obj.modifiers.new("Rig", "ARMATURE")
    modifier.object = arm
    return obj


# -- poses --------------------------------------------------------------------------------
def quaternion(rotation):
    """A pose rotation: (x, y, z) degrees about the squirrel's axes (applied x, then y, then z), or a
    (w, x, y, z) quaternion in the squirrel's frame. Returned in the bone's Blender frame."""
    if len(rotation) == 4:
        w, x, y, z = rotation
        q = Quaternion((w, x, y, z))
    else:
        q = Euler(tuple(math.radians(a) for a in rotation), "XYZ").to_quaternion()
    # Squirrel axes (x, y up, z forward) are the bone's own (x, y, z): a bone's rest frame is
    # Blender's (x, z, -y), which is the squirrel frame again; nothing to change.
    return q


def apply_pose(arm, pose):
    """`pose`: {bone: rotation} and optional {"<bone>@": (x, y, z) metres moved in the squirrel frame}."""
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
    for key, value in pose.items():
        if key.endswith("@"):
            # Bone-local location: the bone frame is the squirrel's (x, y up, z forward) as Blender
            # sees a bone pointing up: local x = x, local y = up, local z = forward.
            arm.pose.bones[key[:-1]].location = (value[0], value[1], value[2])
        else:
            arm.pose.bones[key].rotation_quaternion = quaternion(value)


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
    shading.show_cavity = False
    shading.show_object_outline = False
    shading.background_type = "VIEWPORT"
    shading.background_color = background
    scene.display.render_aa = "16"
    scene.view_settings.view_transform = "Standard"


def camera(scene, eye, target, lens=None, ortho=None, name="Cam"):
    """A camera at `eye` looking at `target` (glTF frame)."""
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
    data.clip_end = 50.0
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


# -- the acorn in its paws ------------------------------------------------------------------
def acorn_placement():
    """Where the acorn rides on the left hand: a 4x4 in the glTF frame at bind, found from the nibble
    pose (it sits between both paws there, its point up toward the teeth)."""
    from . import motion, solver
    _rotations, _offset, rig = solver.solve(motion.CLIPS["nibble"]["fn"](0.0))
    points = [rig.joint("handL"), rig.joint("handR"), rig.point("handL", rig.tip["handL"]),
              rig.point("handR", rig.tip["handR"])]
    centre = np.mean(points, axis=0)
    head = rig.rotation("head")
    centre = centre + head @ np.array([0.0, 0.003, 0.007])
    axis = head @ np.array([0.0, 0.9, 0.45])
    axis = axis / np.linalg.norm(axis)
    hand = rig.rotation("handL")
    # Into the hand's rest frame (a bone's rest rotation is the identity).
    local_centre = rig.head["handL"] + hand.T @ (centre - rig.joint("handL"))
    up = hand.T @ axis
    side = np.cross(up, np.array([0.0, 0.0, 1.0]))
    side = side / np.linalg.norm(side)
    forward = np.cross(side, up)
    matrix = np.eye(4)
    # Drawn a little larger than life, like the squirrel's head, so it reads in its paws.
    size = ACORN_SIZE
    matrix[:3, 0], matrix[:3, 1], matrix[:3, 2], matrix[:3, 3] = side * size, up * size, forward * size, local_centre
    return matrix


def make_acorn(scene, arm, acorn, name="Acorn"):
    positions, normals, colors, triangles = acorn
    mesh = bpy.data.meshes.new(PREFIX + name)
    mesh.from_pydata([tuple(p) for p in to_blender(positions)], [], [tuple(int(i) for i in t) for t in triangles])
    mesh.update()
    mesh.shade_smooth()
    mesh.normals_split_custom_set_from_vertices([tuple(n) for n in to_blender(normals)])
    colour = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    colour.data.foreach_set("color", colors.astype(np.float32).ravel())
    mesh.color_attributes.active_color = colour
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    # glTF frame -> Blender frame for the placement matrix.
    from mathutils import Matrix
    g2b = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    placement = Matrix([list(row) for row in acorn_placement()])
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
    scene.view_layers[0].update()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = "handL"
    obj.matrix_parent_inverse = Matrix.Identity(4)
    scene.view_layers[0].update()
    obj.matrix_world = arm.matrix_world @ g2b @ placement @ g2b.inverted()
    return obj


# -- clips into actions --------------------------------------------------------------------
def bake(arm, clips=None, fps=FPS):
    """Every clip as a Blender action on the rig (one slot, one layer, keys on every frame): bone
    rotations as quaternions, the root's offset as its location. A looping clip's last key repeats
    its first, so the loop closes. Returns {name: dict(length, frames, loop, speed)}."""
    from . import motion, solver
    clips = clips or motion.CLIPS
    rig = solver.Rig()
    report = {}
    arm.animation_data_create()
    for name, entry in clips.items():
        frames = max(2, int(round(entry["length"] * fps)))
        times = [entry["length"] * i / frames for i in range(frames + 1)]
        if entry["loop"]:
            times[-1] = 0.0
        samples = []
        for t in times:
            rotations, offset, _rig = solver.solve(entry["fn"](t), rig)
            samples.append((rotations, offset))
        action = bpy.data.actions.new(PREFIX + name)
        action.use_fake_user = True
        action.use_cyclic = bool(entry["loop"])
        slot = action.slots.new(id_type="OBJECT", name=arm.name)
        layer = action.layers.new("Layer")
        strip = layer.strips.new(type="KEYFRAME")
        bag = strip.channelbag(slot, ensure=True)
        frame_numbers = np.arange(len(times), dtype=np.float32)
        for bone in rig.names:
            quats = np.array([s[0][bone] for s in samples])
            for i in range(1, len(quats)):
                if np.dot(quats[i], quats[i - 1]) < 0.0:
                    quats[i] = -quats[i]
            path = 'pose.bones["%s"].rotation_quaternion' % bone
            for c in range(4):
                curve = bag.fcurves.new(path, index=c, group_name=bone)
                curve.keyframe_points.add(len(times))
                curve.keyframe_points.foreach_set("co", np.stack([frame_numbers, quats[:, c]], axis=1).ravel())
                curve.keyframe_points.foreach_set("interpolation", [2] * len(times))  # LINEAR
        offsets = np.array([s[1] for s in samples])
        path = 'pose.bones["root"].location'
        for c in range(3):
            curve = bag.fcurves.new(path, index=c, group_name="root")
            curve.keyframe_points.add(len(times))
            curve.keyframe_points.foreach_set("co", np.stack([frame_numbers, offsets[:, c]], axis=1).ravel())
            curve.keyframe_points.foreach_set("interpolation", [2] * len(times))
        action.frame_range = (0.0, float(frames))
        report[name] = dict(length=entry["length"], frames=frames, loop=bool(entry["loop"]), speed=entry["speed"],
                            action=action.name, slot=slot.identifier)
    return report


def assign(arm, action_name):
    action = bpy.data.actions[action_name]
    arm.animation_data_create()
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0]


def export(path, objects):
    """The rig, its skinned body and the acorn as one GLB, every action a glTF animation."""
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
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
        export_optimize_animation_size=False,
        export_anim_slide_to_zero=True,
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
