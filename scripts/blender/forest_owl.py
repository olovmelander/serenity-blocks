"""Forest's eagle owl: modelled and rigged in Blender, written as one GLB.

    blender --background --factory-startup --python scripts/blender/forest_owl.py -- \
        --out <raw.glb> [--manifest <json>] [--voxel 0.0026] [--triangles 9000]

The soft body (forest_owl/model.py) is a distance field round the rig's joints, meshed, decimated (the
face kept finer) and mirrored; every flight feather is a vane of its own on a bone of its own; the rig
(forest_owl/rig.py) is one armature whose every bone rests in the owl's own frame. There are no clips:
the theme poses every bone itself (src/themes/forest/forest-owl-rig.js), so a flight between any two
perches is drawn as it is flown. scripts/forest/pack-owl.mjs runs this and packs the result.

The same modules drive the design loop inside an open Blender through the Blender MCP
(forest_owl/live.py): they build in a scene of their own and touch nothing else. Headless with
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

from forest_owl import model as M  # noqa: E402
from forest_owl import rig as R  # noqa: E402

GENERATOR = "Serenity Blocks - Forest eagle owl (scripts/blender/forest_owl.py)"


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


def plan():
    """The numbers the theme's rig mirrors (tests/unit/forest-owl-rig.test.js holds them together)."""
    return dict(
        posture=M.POSTURE, shoulder=[round(float(v), 6) for v in M.SHOULDER],
        elbow=list(M.ELBOW_F), wrist=list(M.WRIST_F), tip=list(M.TIP_F),
        primaryAngle=list(M.PRIMARY_ANGLE), tertialAngle=list(M.TERTIAL_ANGLE),
        toeDirections=[list(d) for d in M.TOE_DIRECTIONS], toeLengths=[list(d) for d in M.TOE_LENGTHS],
        eye=[round(float(v), 6) for v in M.EYE], rootHeight=float(M.joints()["root"][1]),
    )


def main():
    opts = options()
    if "out" not in opts or opts["out"] is True:
        raise SystemExit("usage: blender --background --factory-startup --python forest_owl.py -- --out <glb>")
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.name = R.SCENE_NAME
    scene = R.atelier(fresh=True)
    owl = M.build(R.DecimateStudio(scene), voxel=float(opts.get("voxel", M.VOXEL)),
                  target=int(opts.get("triangles", M.TARGET_TRIANGLES)))
    arm = R.make_armature(scene)
    body = R.make_mesh(scene, owl, arm)
    out = Path(opts["out"]).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    R.export(out, [arm, body])
    report = dict(
        generator=GENERATOR, file=out.name, bytes=out.stat().st_size, bones=M.bone_names(),
        triangles=int(len(owl.triangles)), vertices=int(len(owl.positions)), bodyTriangles=int(owl.body_triangles),
        feathers=owl.stats["feathers"], low=owl.stats["low"], high=owl.stats["high"], plan=plan(),
        seconds=round(time.time() - started, 1),
    )
    if opts.get("manifest") and opts["manifest"] is not True:
        Path(opts["manifest"]).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("%s wrote %s (%d bytes, %d triangles, %d bones) in %.1fs" % (
        M.TAG, out, report["bytes"], report["triangles"], len(report["bones"]), report["seconds"]), flush=True)


if __name__ == "__main__":
    main()
