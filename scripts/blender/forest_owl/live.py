"""The design loop through the Blender MCP: rebuild the owl in its own scene and render review views.

Run inside an open Blender (never touches any other scene):

    import sys; sys.path.insert(0, r"<repo>/scripts/blender")
    from forest_owl import live
    live.rebuild(voxel=0.003)
    live.views("<dir>", "v1")
    live.pose_json("<poses.json>")  # poses written by scripts/forest/owl-poses.mjs from the runtime's rig
    live.lineup("<dir>", "fold", ["perch", "glide", "down", "up"])
"""

import json
import os
import time

from . import model as M
from . import rig as R

STATE = {}

# name: (eye, target, ortho scale), glTF frame.
VIEWS = {
    "front": ((0.0, 0.3, 2.0), (0.0, 0.3, 0.0), 0.75),
    "side": ((2.0, 0.3, 0.0), (0.0, 0.3, 0.0), 0.75),
    "tq": ((1.2, 0.55, 1.4), (0.0, 0.3, 0.0), 0.75),
    "back": ((-1.0, 0.6, -1.7), (0.0, 0.3, 0.0), 0.75),
    "face": ((0.18, 0.5, 0.9), (0.0, 0.46, 0.06), 0.26),
    "spread": ((0.0, 0.3, 2.0), (0.0, 0.1, 0.0), 1.9),
    "top": ((0.0, 3.0, 0.02), (0.0, 0.0, 0.0), 1.9),
    "fly": ((0.0, 0.32, 3.0), (0.0, 0.32, 0.0), 1.9),
    "flyside": ((3.0, 0.32, 0.0), (0.0, 0.32, 0.0), 1.9),
    "under": ((0.0, -3.0, 0.02), (0.0, 0.0, 0.0), 1.9),
}


def rebuild(voxel=M.VOXEL, target=M.TARGET_TRIANGLES):
    logs = []
    scene = R.atelier(fresh=True)
    started = time.time()
    owl = M.build(R.DecimateStudio(scene), voxel=voxel, target=target, log=logs.append)
    arm = R.make_armature(scene)
    obj = R.make_mesh(scene, owl, arm)
    STATE.update(scene=scene, owl=owl, arm=arm, obj=obj, poses={})
    return dict(logs=logs, seconds=round(time.time() - started, 1), stats=owl.stats)


def pose_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        STATE["poses"] = json.load(handle)
    return sorted(STATE["poses"].keys())


def pose(name=None):
    arm = STATE["arm"]
    entry = STATE["poses"].get(name) if name else None
    R.apply_pose(arm, (entry or {}).get("bones", {}))
    R.place(arm, (entry or {}).get("position", (0.0, 0.0, 0.0)), (entry or {}).get("rotation"))


def views(directory, tag, names=None, pose_name=None, size=(800, 800), scale=1.0):
    scene = STATE["scene"]
    pose(pose_name)
    R.workbench(scene, size=size)
    files = []
    for name, (eye, target, ortho) in VIEWS.items():
        if names and name not in names:
            continue
        R.camera(scene, eye, target, ortho=ortho * scale)
        files.append(R.render(scene, os.path.join(directory, "%s-%s.png" % (tag, name))))
    return files


def lineup(directory, tag, poses, view="side", spacing=0.9, size=None, height=0.9, scale=1.0):
    """One render of several poses in a row, spread along the view's right."""
    import bpy
    from mathutils import Vector
    scene, arm, obj = STATE["scene"], STATE["arm"], STATE["obj"]
    eye, target, _ortho = VIEWS[view]
    forward = Vector(R.to_blender(target)) - Vector(R.to_blender(eye))
    right = forward.cross(Vector((0.0, 0.0, 1.0))).normalized()
    copies = []
    try:
        arm.hide_render = True
        obj.hide_render = True
        for i, name in enumerate(poses):
            a = arm.copy()
            a.data = arm.data
            scene.collection.objects.link(a)
            m = obj.copy()
            scene.collection.objects.link(m)
            m.parent = a
            m.modifiers["Rig"].object = a
            entry = STATE["poses"].get(name, {})
            R.apply_pose(a, entry.get("bones", {}))
            R.place(a, entry.get("position", (0.0, 0.0, 0.0)), entry.get("rotation"))
            shift = right * (spacing * (i - 0.5 * (len(poses) - 1)))
            a.matrix_world.translation = a.matrix_world.translation + shift
            a.hide_render = False
            m.hide_render = False
            copies += [m, a]
        scene.view_layers[0].update()
        width = spacing * len(poses)
        R.workbench(scene, size=size or (int(300 * len(poses)), int(300 * height / spacing)))
        R.camera(scene, eye, target, ortho=max(width, height) * scale)
        path = R.render(scene, os.path.join(directory, "%s-%s.png" % (tag, view)))
    finally:
        for o in copies:
            bpy.data.objects.remove(o, do_unlink=True)
        arm.hide_render = False
        obj.hide_render = False
    return path
