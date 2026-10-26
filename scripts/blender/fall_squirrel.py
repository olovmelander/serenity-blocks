"""Fall's red squirrel: modelled, rigged and animated in Blender, written as one GLB.

    blender --background --factory-startup --python scripts/blender/fall_squirrel.py -- \
        --out src/themes/fall/assets/squirrel.glb [--manifest <json>] [--voxel 0.0014] [--triangles 12000]

The model (fall_squirrel/model.py) is a distance field round the rig's joints, meshed, decimated (the
face kept finer than the plume) and mirrored; the rig (fall_squirrel/rig.py) is one armature whose
every bone rests in the squirrel's own frame; the clips (fall_squirrel/motion.py) are functions of
time solved by a small IK (fall_squirrel/solver.py) and keyed into one Blender action each, which the
glTF exporter writes as one animation each. The acorn the squirrel nibbles rides on its left hand.

The same modules drive the design loop inside an open Blender through the Blender MCP
(fall_squirrel/live.py): they build in a scene of their own and touch nothing else. Headless with
--factory-startup is how the shipped asset is made.
"""

import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import bpy  # noqa: E402

from fall_squirrel import model as M  # noqa: E402
from fall_squirrel import motion  # noqa: E402
from fall_squirrel import rig as R  # noqa: E402

GENERATOR = "Serenity Blocks - Fall red squirrel (scripts/blender/fall_squirrel.py)"


def options():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out, key = {}, None
    for argument in arguments:
        if argument.startswith("--"):
            key = argument[2:]
            out[key] = True
        elif key:
            out[key] = argument
            key = None
    return out


def main():
    opts = options()
    if "out" not in opts or opts["out"] is True:
        raise SystemExit("usage: blender --background --factory-startup --python fall_squirrel.py -- --out <glb>")
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.name = R.SCENE_NAME
    scene = R.atelier(fresh=True)
    squirrel = M.build(R.DecimateStudio(scene), voxel=float(opts.get("voxel", M.VOXEL)),
                       target=int(opts.get("triangles", M.TARGET_TRIANGLES)))
    acorn = M.build_acorn(R.DecimateStudio(scene))
    arm = R.make_armature(scene)
    body = R.make_mesh(scene, squirrel, arm)
    nut = R.make_acorn(scene, arm, acorn)
    clips = R.bake(arm)
    # The animations are named for their clips.
    for name, entry in clips.items():
        bpy.data.actions[entry["action"]].name = name
        entry["action"] = name
    arm.animation_data.action = None
    out = Path(opts["out"]).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    R.export(out, [arm, body, nut])
    report = dict(
        generator=GENERATOR, file=out.name, bytes=out.stat().st_size,
        bones=[bone[0] for bone in M.skeleton()], clips=clips,
        triangles=int(len(squirrel.triangles)), vertices=int(len(squirrel.positions)),
        acornTriangles=int(len(acorn[3])),
        low=squirrel.stats["low"], high=squirrel.stats["high"], parts=squirrel.stats["parts"],
        seconds=round(time.time() - started, 1),
    )
    if opts.get("manifest") and opts["manifest"] is not True:
        Path(opts["manifest"]).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("%s wrote %s (%d bytes, %d triangles, %d clips) in %.1fs" % (
        M.TAG, out, report["bytes"], report["triangles"], len(clips), report["seconds"]), flush=True)
    print("%s %s" % (M.TAG, json.dumps({k: v for k, v in report.items() if k != "clips"})), flush=True)


if __name__ == "__main__":
    main()
