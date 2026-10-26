"""The design loop through the Blender MCP: rebuild the squirrel in its own scene and render review views.

Run inside an open Blender (never touches any other scene):

    import sys; sys.path.insert(0, r"<repo>/scripts/blender")
    from fall_squirrel import live
    live.rebuild(voxel=0.0018)
    live.views("<dir>", "v4", pose=None)
"""

import os
import time

from . import model as M
from . import rig as R

STATE = {}

VIEWS = {
    "side": ((0.9, 0.11, -0.06), (0.0, 0.11, -0.06), 0.46),
    "tq": ((0.55, 0.32, 0.6), (0.0, 0.10, -0.05), 0.46),
    "head": ((0.25, 0.14, 0.32), (0.0, 0.11, 0.09), 0.10),
    "front": ((0.0, 0.11, 0.9), (0.0, 0.11, 0.0), 0.22),
    "back": ((-0.5, 0.35, -0.75), (0.0, 0.12, -0.12), 0.46),
}


def rebuild(voxel=0.0018, target=12000):
    logs = []
    scene = R.atelier(fresh=True)
    started = time.time()
    squirrel = M.build(R.DecimateStudio(scene), voxel=voxel, target=target, log=logs.append)
    arm = R.make_armature(scene)
    obj = R.make_mesh(scene, squirrel, arm)
    STATE.update(scene=scene, squirrel=squirrel, arm=arm, obj=obj)
    return dict(logs=logs, seconds=round(time.time() - started, 1))


def pose_clip(arm, name, t):
    """Pose `arm` as clip `name` stands at `t` seconds."""
    from . import motion, solver
    entry = motion.CLIPS[name]
    rotations, offset, _rig = solver.solve(entry["fn"](t))
    for pose_bone in arm.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = tuple(rotations[pose_bone.name])
        pose_bone.location = (0.0, 0.0, 0.0)
    arm.pose.bones["root"].location = tuple(offset)


def lineup(directory, tag, entries, view="side", spacing=0.42, size=None, height=0.42):
    """One render of several poses in a row: `entries` = [(clip, t)], spread along the view's right."""
    import bpy
    from mathutils import Vector
    scene, arm, obj = STATE["scene"], STATE["arm"], STATE["obj"]
    copies = []
    extra = []
    eye, target, _ortho = VIEWS[view]
    eye, target = list(eye), list(target)
    forward = Vector(R.to_blender(target)) - Vector(R.to_blender(eye))
    right = forward.cross(Vector((0.0, 0.0, 1.0))).normalized()
    try:
        arm.hide_render = True
        obj.hide_render = True
        if STATE.get("acorn") is not None:
            STATE["acorn"].hide_render = True
        for i, (name, t) in enumerate(entries):
            a = arm.copy()
            a.data = arm.data
            scene.collection.objects.link(a)
            m = obj.copy()
            scene.collection.objects.link(m)
            m.parent = a
            m.modifiers["Rig"].object = a
            shift = right * (spacing * (i - 0.5 * (len(entries) - 1)))
            a.location = shift
            a.hide_render = False
            m.hide_render = False
            pose_clip(a, name, t)
            copies += [m, a]
            nut = STATE.get("acorn")
            if nut is not None and name == "nibble":
                n = nut.copy()
                scene.collection.objects.link(n)
                n.parent = a
                n.parent_type = "BONE"
                n.parent_bone = "handL"
                n.hide_render = False
                extra.append(n)
        # The ground, and how high each pose's lowest point stands over it.
        ground_mesh = bpy.data.meshes.new(R.PREFIX + "ground")
        span = spacing * len(entries) + 1.0
        ground_mesh.from_pydata([(-span, -span, 0.0), (span, -span, 0.0), (span, span, 0.0), (-span, span, 0.0)],
                                [], [(0, 1, 2, 3)])
        ground = bpy.data.objects.new(R.PREFIX + "ground", ground_mesh)
        scene.collection.objects.link(ground)
        copies.append(ground)
        scene.view_layers[0].update()
        depsgraph = scene.view_layers[0].depsgraph
        lows = []
        for m in copies[0:-1:2]:
            evaluated = m.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            matrix = m.matrix_world
            lows.append(round(min((matrix @ v.co).z for v in mesh.vertices), 4))
            evaluated.to_mesh_clear()
        STATE["lows"] = lows
        width = spacing * len(entries)
        R.workbench(scene, size=size or (int(220 * len(entries)), int(220 * height / spacing * 1.0)))
        R.camera(scene, eye, target, ortho=max(width, height))
        path = R.render(scene, os.path.join(directory, "%s-%s.png" % (tag, view)))
    finally:
        for o in extra:
            bpy.data.objects.remove(o, do_unlink=True)
        if STATE.get("acorn") is not None:
            STATE["acorn"].hide_render = False
        for o in copies:
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0 and data.name.startswith(R.PREFIX + "ground"):
                bpy.data.meshes.remove(data)
        arm.hide_render = False
        obj.hide_render = False
    return path


def views(directory, tag, names=None, pose=None, size=(800, 640), ortho_scale=1.0):
    scene, arm = STATE["scene"], STATE["arm"]
    R.apply_pose(arm, pose or {})
    R.workbench(scene, size=size)
    files = []
    for name, (eye, target, ortho) in VIEWS.items():
        if names and name not in names:
            continue
        R.camera(scene, eye, target, ortho=ortho * ortho_scale)
        files.append(R.render(scene, os.path.join(directory, "%s-%s.png" % (tag, name))))
    return files
