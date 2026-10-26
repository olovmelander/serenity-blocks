"""Audit the squirrel's clips for what makes motion look wrong, before anything is keyed.

    "<blender>/5.2/python/bin/python.exe" scripts/blender/fall_squirrel/audit.py [clip ...]

Run with Blender's own Python (it has numpy; bpy is not needed). For every clip, sampled at the rate
the clips are keyed at, it reports:

- reach: how far a leg could not get to its paw's target (mm at life size). A planted paw the leg
  cannot reach is dragged along: it slides.
- slip: how fast a paw on the ground moves when it should stand still on it (m/s at life size; a
  gait's ground slides back under it at the clip's own speed, and that is subtracted).
- pop: the largest change of a bone's turning speed from one frame to the next (degrees per frame
  per frame, in the clip's frame): a pop reads as a jerk.
- seam: for a loop, the same at the join of its last frame and its first.
"""

import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

from fall_squirrel import motion, solver  # noqa: E402
from fall_squirrel.model import tips  # noqa: E402

FPS = 60
PAWS = (("hindL", "footL"), ("hindR", "footR"), ("frontL", "handL"), ("frontR", "handR"))
WATCH = ("hips", "chest", "head", "tail3", "tail6", "thighL", "shinL", "footL", "armL", "foreL", "handL")


def angle(a, b):
    """Degrees between two rotation matrices."""
    c = (np.trace(a.T @ b) - 1.0) * 0.5
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def audit(name):
    entry = motion.CLIPS[name]
    length = entry["length"]
    frames = max(2, int(round(length * FPS)))
    rig = solver.Rig()
    T = tips()
    rows = []
    for i in range(frames + (2 if entry["loop"] else 0)):
        t = length * i / frames
        if entry["loop"]:
            t = t % length
        _r, _o, rig = solver.solve(entry["fn"](t), rig)
        world = rig.world()
        paws = {}
        for limb, bone in PAWS:
            paws[limb] = rig.point(bone, T[bone])
        # A miss matters where the paw is meant to be on the ground (in the air the leg just reaches).
        spec = entry["fn"](t)
        planted = {}
        for limb, _bone in PAWS:
            paw = spec.get(limb)
            target = None
            if isinstance(paw, dict) and "fk" not in paw and not paw.get("attach"):
                target = paw.get("heel") if limb.startswith("hind") else paw.get("wrist")
            planted[limb] = target is not None and (paw["toe"][1] < 0.0045)
        upper = {"hindL": "thighL", "hindR": "thighR", "frontL": "armL", "frontR": "armR"}
        misses = [rig.misses.get(upper[limb], 0.0) for limb, _b in PAWS if planted[limb]]
        rows.append(dict(
            rot={b: world[b][0].copy() for b in WATCH},
            paws=paws,
            misses=max(misses) if misses else 0.0,
        ))
    reach = max(r["misses"] for r in rows) * 1000.0
    # Slip: a paw within 1.5 mm of its ground contact (life), against the ground sliding back at the clip's speed.
    dt = length / frames
    ground = np.array([0.0, 0.0, -entry["speed"]])
    slips = []
    for i in range(1, len(rows)):
        for limb, _bone in PAWS:
            a, b = rows[i - 1]["paws"][limb], rows[i]["paws"][limb]
            if a[1] < 0.0045 and b[1] < 0.0045:
                slips.append(float(np.linalg.norm((b - a) / dt - ground)))
    slip = float(np.percentile(slips, 90)) if slips else 0.0
    # Pops and the loop's seam.
    worst, where = 0.0, ""
    seam = 0.0
    for bone in WATCH:
        speeds = [angle(rows[i - 1]["rot"][bone], rows[i]["rot"][bone]) for i in range(1, len(rows))]
        for i in range(1, len(speeds)):
            jerk = abs(speeds[i] - speeds[i - 1])
            if jerk > worst:
                worst, where = jerk, "%s@%.2fs" % (bone, length * i / frames)
            if entry["loop"] and i >= frames - 1:
                seam = max(seam, jerk)
    return dict(name=name, frames=frames, reach=reach, slip=slip, pop=worst, where=where, seam=seam)


def main():
    names = sys.argv[1:] or list(motion.CLIPS)
    print("%-9s %6s %9s %9s %8s %-16s %7s" % ("clip", "frames", "reach mm", "slip m/s", "pop", "(where)", "seam"))
    for name in names:
        r = audit(name)
        print("%-9s %6d %9.1f %9.3f %8.2f %-16s %7.2f" % (
            r["name"], r["frames"], r["reach"], r["slip"], r["pop"], r["where"], r["seam"]))


if __name__ == "__main__":
    main()
