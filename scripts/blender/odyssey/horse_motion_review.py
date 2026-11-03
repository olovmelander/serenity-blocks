"""Odyssey's wild horses: a motion review in headless Blender, from the game's own poses.

    blender -b --factory-startup --python scripts/blender/odyssey/horse_motion_review.py -- \
        --glb src/rendering/odyssey/assets/chapter-03/horses/wild-horses.glb --motion <motion.json> \
        --out <dir> [--label after] [--blend <horses-review.blend>]

The motion file is exported from the game's CPU twin (composition/odyssey-horse-band.js: per frame
and per horse the pose table the shader skins from, `pos = q v k + t` per bone, and the hooves).
This script skins the model with it on the CPU and makes, per clip:

- a motion strip (eight frames from a camera that follows the horse),
- an onion skin (several frames over one another from a still camera),
- the hooves' paths drawn against the body (a natural stride is a smooth loop, a robotic one has
  corners or a slide),

and, with `--blend`, a review file: every clip's horses as meshes whose shape keys hold the game's
poses frame by frame (15 a second), a camera that follows, ground and sun, so the clip can be
scrubbed in Blender. Nothing here is shipped.
"""

import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
for path in (str(ROOT), str(HERE)):
    if path not in sys.path:
        sys.path.insert(0, path)

import numpy as np  # noqa: E402

from wild_horse import _albedo, load_glb  # noqa: E402

LEG_COLOURS = {0: (0.85, 0.25, 0.2), 1: (0.95, 0.7, 0.15), 2: (0.2, 0.45, 0.9), 3: (0.25, 0.75, 0.35)}
LEG_NAMES = ("left hind", "left fore", "right hind", "right fore")


def quat_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def skin(animal, table):
    """Positions and normals of `animal` posed by one pose table (29 bones x 8 floats)."""
    rows = np.asarray(table, dtype=np.float64).reshape(-1, 8)
    mats = np.stack([quat_matrix(r[:4]) for r in rows])
    w = animal.weights.astype(np.float64) / 255.0
    ids = animal.bones.astype(np.int64)
    p = np.zeros_like(animal.positions, dtype=np.float64)
    n = np.zeros_like(animal.normals, dtype=np.float64)
    for k in range(4):
        R = mats[ids[:, k]]
        T = rows[ids[:, k], 4:7]
        K = rows[ids[:, k], 7:8]
        p += w[:, k:k + 1] * (np.einsum("nij,nj->ni", R, animal.positions) * K + T)
        n += w[:, k:k + 1] * np.einsum("nij,nj->ni", R, animal.normals)
    n /= np.maximum(np.linalg.norm(n, axis=1), 1e-9)[:, None]
    return p, n


def load_image(path):
    import bpy
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px


def save_image(path, px):
    import bpy
    h, w = px.shape[:2]
    img = bpy.data.images.new(Path(path).stem, w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(px, dtype=np.float32).reshape(-1))
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def draw_line(img, p0, p1, colour, width=2):
    h, w = img.shape[:2]
    n = int(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1]))) + 1
    for i in range(n + 1):
        t = i / max(1, n)
        x = int(round(p0[0] + (p1[0] - p0[0]) * t))
        y = int(round(p0[1] + (p1[1] - p0[1]) * t))
        img[max(0, y - width // 2):min(h, y + width // 2 + 1), max(0, x - width // 2):min(w, x + width // 2 + 1), :3] = colour


def hoof_paths(clip, horse_index, path, size=(720, 360)):
    """The hooves' paths against the body, side on (forward to the right, up up), over the clip;
    planted hooves drawn darker. Life metres: the drawn size divided out."""
    w, h = size
    img = np.ones((h, w, 4), dtype=np.float32)
    img[:, :, :3] = 0.97
    pts = {l: [] for l in range(4)}
    for frame in clip["frames"]:
        horse = next(x for x in frame["horses"] if x["i"] == horse_index)
        k = horse["table"][7]
        rx, ry, rz = horse["root"]
        hdg = horse["heading"]
        fx, fz = math.sin(hdg), math.cos(hdg)
        for l, (x, y, z, stance) in enumerate(horse["hooves"]):
            along = ((x - rx) * fx + (z - rz) * fz) / k
            pts[l].append((along, (y - 0) / k, stance))
    # Map: along -1.6..1.6 m -> x, height 0..0.9 m -> y (y down in image rows from the top).
    def to_px(a, u):
        return ((a + 1.6) / 3.2 * (w - 40) + 20, h - 20 - (u / 0.9) * (h - 40))
    # Ground line.
    draw_line(img, to_px(-1.6, 0), to_px(1.6, 0), (0.6, 0.6, 0.6), 1)
    for l, seq in pts.items():
        base = np.array(LEG_COLOURS[l])
        for a, b in zip(seq, seq[1:]):
            colour = tuple(base * (0.55 if b[2] > 0.5 else 1.0))
            draw_line(img, to_px(a[0], a[1]), to_px(b[0], b[1]), colour, 3 if b[2] > 0.5 else 2)
    save_image(path, img[::-1])  # Blender images are bottom-up


def main():
    import bpy
    from fall_grove import studio as studio_module
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {}
    for key, value in zip(args[::2], args[1::2]):
        opts[key.lstrip("-")] = value
    out = Path(opts["out"])
    out.mkdir(parents=True, exist_ok=True)
    label = opts.get("label", "after")
    animals = {a.name: a for a in load_glb(opts["glb"])}
    motion = json.loads(Path(opts["motion"]).read_text())
    if opts.get("clips"):
        wanted = opts["clips"].split(",")
        motion["clips"] = [c for c in motion["clips"] if c["name"] in wanted]
    studio_module.SCENE_NAME = "Odyssey Horses Review"
    studio_module.PREFIX = "OHR_"
    studio = studio_module.Studio()
    studio.setup_preview(sun_direction=(-0.46, 0.36, 0.61), sun_strength=4.0, sky=(0.5, 0.62, 0.8), sky_strength=0.8)
    material = studio.material("horse", roughness=0.8)
    colour_cache = {}

    def colours(model, coat):
        if (model, coat) not in colour_cache:
            colour_cache[(model, coat)] = _albedo(animals[model], coat)
        return colour_cache[(model, coat)]

    ground = studio.mesh_object("ground", np.array(
        [[-200, 0, -200], [200, 0, -200], [200, 0, 200], [-200, 0, 200]], dtype=float), np.array([[0, 2, 1], [0, 3, 2]]))
    ground.data.materials.append(studio.material("grass", vertex_color=False, base=(0.09, 0.2, 0.05)))
    for clip in motion["clips"]:
        frames = clip["frames"]
        follow = clip["follow"]
        lead0 = next(x for x in frames[0]["horses"] if x["i"] == follow)
        ox, oz = lead0["root"][0], lead0["root"][2]

        def build(frame):
            objs = []
            for horse in frame["horses"]:
                p, n = skin(animals[horse["model"]], horse["table"])
                p = p - np.array([ox, 0.0, oz])
                obj = studio.mesh_object("h%d" % horse["i"], p, animals[horse["model"]].triangles,
                                         colors=colours(horse["model"], horse["coat"]))
                obj.data.materials.append(material)
                objs.append(obj)
            return objs

        def clear(objs):
            for obj in objs:
                data = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                bpy.data.meshes.remove(data)

        # The strip: eight frames, the camera beside the followed horse (its sunlit left side).
        picks = np.linspace(0, len(frames) - 1, 8).round().astype(int)
        cells = []
        for idx in picks:
            frame = frames[idx]
            lead = next(x for x in frame["horses"] if x["i"] == follow)
            k = lead["table"][7]
            rx, rz = lead["root"][0] - ox, lead["root"][2] - oz
            hdg = lead["heading"]
            lx, lz = math.cos(hdg), -math.sin(hdg)
            d = 5.6 * k
            objs = build(frame)
            path = out / ("_%s_%s_%03d.png" % (label, clip["name"], idx))
            studio.render(path, eye=(rx + lx * d, 0.9 * k, rz + lz * d), target=(rx, 0.65 * k, rz), lens=35,
                          size=(480, 270), samples=8)
            clear(objs)
            cells.append(load_image(path))
            path.unlink()
        strip = np.concatenate([np.concatenate(cells[:4], axis=1), np.concatenate(cells[4:], axis=1)], axis=0)
        save_image(out / ("%s-%s-strip.png" % (label, clip["name"])), strip)
        # The onion skin: six frames from a still camera, over one another.
        first = next(x for x in frames[0]["horses"] if x["i"] == follow)
        last = next(x for x in frames[-1]["horses"] if x["i"] == follow)
        k = first["table"][7]
        mid = ((first["root"][0] + last["root"][0]) / 2 - ox, (first["root"][2] + last["root"][2]) / 2 - oz)
        span = math.hypot(last["root"][0] - first["root"][0], last["root"][2] - first["root"][2])
        hdg = math.atan2(last["root"][0] - first["root"][0], last["root"][2] - first["root"][2]) if span > 1 else first["heading"]
        lx, lz = math.cos(hdg), -math.sin(hdg)
        d = max(6.5 * k, span * 1.2)
        onion = None
        picks = np.linspace(0, len(frames) - 1, 6).round().astype(int)
        for j, idx in enumerate(picks):
            objs = build(frames[idx])
            path = out / ("_%s_%s_onion_%d.png" % (label, clip["name"], j))
            studio.render(path, eye=(mid[0] + lx * d, 1.0 * k, mid[1] + lz * d), target=(mid[0], 0.6 * k, mid[1]),
                          lens=35, size=(720, 405), samples=8)
            clear(objs)
            px = load_image(path)
            path.unlink()
            weight = 0.25 + 0.75 * (j / (len(picks) - 1))
            onion = px.copy() if onion is None else onion * (1 - 0.5 * weight) + px * (0.5 * weight)
        save_image(out / ("%s-%s-onion.png" % (label, clip["name"])), onion)
        hoof_paths(clip, follow, out / ("%s-%s-hooves.png" % (label, clip["name"])))
        print("[horse-review] %s %s done" % (label, clip["name"]), flush=True)

    if opts.get("blend"):
        # The review file: each clip's horses as one mesh each, its shape keys the game's poses at 15
        # a second, shown only during its clip; a camera follows the clip's horse.
        # (Each pose holds for its frame: new keys step, not ease. Blender 5's layered actions have
        # no flat fcurve list to set afterwards.)
        bpy.context.preferences.edit.keyframe_new_interpolation_type = "CONSTANT"
        cam_data = bpy.data.cameras.new("ReviewCamera")
        cam_data.lens = 35
        cam = bpy.data.objects.new("ReviewCamera", cam_data)
        studio.scene.collection.objects.link(cam)
        studio.scene.camera = cam
        frame_at = 1
        from fall_grove.studio import to_blender
        for clip in motion["clips"]:
            frames = clip["frames"][::2]
            follow = clip["follow"]
            lead0 = next(x for x in frames[0]["horses"] if x["i"] == follow)
            ox, oz = lead0["root"][0], lead0["root"][2]
            start = frame_at
            for hi, horse0 in enumerate(frames[0]["horses"]):
                model = animals[horse0["model"]]
                base, _n = skin(model, horse0["table"])
                obj = studio.mesh_object("%s_horse%d" % (clip["name"], horse0["i"]), base - np.array([ox, 0, oz]),
                                         model.triangles, colors=colours(horse0["model"], horse0["coat"]))
                obj.data.materials.append(material)
                obj.shape_key_add(name="Basis")
                for fi, frame in enumerate(frames):
                    horse = next(x for x in frame["horses"] if x["i"] == horse0["i"])
                    p, _n = skin(model, horse["table"])
                    key = obj.shape_key_add(name="f%03d" % fi)
                    key.data.foreach_set("co", to_blender(p - np.array([ox, 0, oz])).astype(np.float32).ravel())
                    for f, v in ((start + fi - 1, 0.0), (start + fi, 1.0), (start + fi + 1, 0.0)):
                        key.value = v
                        key.keyframe_insert("value", frame=f)
                for f, hidden in ((start - 1, True), (start, False), (start + len(frames), True)):
                    obj.hide_viewport = hidden
                    obj.hide_render = hidden
                    obj.keyframe_insert("hide_viewport", frame=max(0, f))
                    obj.keyframe_insert("hide_render", frame=max(0, f))
            for fi, frame in enumerate(frames):
                lead = next(x for x in frame["horses"] if x["i"] == follow)
                k = lead["table"][7]
                rx, rz = lead["root"][0] - ox, lead["root"][2] - oz
                hdg = lead["heading"]
                eye = to_blender(np.array([[rx + math.cos(hdg) * 6 * k, 1.1 * k, rz - math.sin(hdg) * 6 * k]]))[0]
                target = to_blender(np.array([[rx, 0.6 * k, rz]]))[0]
                cam.location = eye
                direction = target - eye
                cam.rotation_mode = "QUATERNION"
                from mathutils import Vector
                cam.rotation_quaternion = Vector(direction).to_track_quat("-Z", "Y")
                cam.keyframe_insert("location", frame=start + fi)
                cam.keyframe_insert("rotation_quaternion", frame=start + fi)
            marker = studio.scene.timeline_markers.new(clip["name"], frame=start)
            marker.camera = cam
            frame_at = start + len(frames) + 15
        studio.scene.frame_start = 1
        studio.scene.frame_end = frame_at
        studio.scene.render.fps = 15
        # Only the review scene in the file (the factory scene and its cube out), so it opens on it.
        for other in [sc for sc in bpy.data.scenes if sc != studio.scene]:
            for obj in list(other.objects):
                if not any(obj.name in sc.objects for sc in bpy.data.scenes if sc != other):
                    bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.scenes.remove(other)
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(opts["blend"]).resolve()), compress=True)
        print("[horse-review] wrote %s" % opts["blend"], flush=True)


if __name__ == "__main__":
    main()
