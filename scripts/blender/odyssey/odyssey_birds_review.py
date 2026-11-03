"""The Odyssey birds in motion, for review: strips, onion skins, wingtip paths and a review .blend.

Run headless, after sampling the game's motion with bird_motion_export.mjs:

    node scripts/blender/odyssey/bird_motion_export.mjs --out motion.json
    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_birds_review.py -- \
        --motion motion.json [--strips <dir>] [--blend <birds-review.blend>] [--module <odyssey_birds.py>]

The poses are the game's own (the CPU twins of its vertex stage, sampled by the exporter); the
meshes and the fold are odyssey_birds.py's (`--module` points at another copy of it, e.g. an
older one for a before/after). Nothing in an open Blender session is touched.

--strips writes, per bird (gull, swallow, goose, vulture):
  <kind>-beat.png    one beat at full weight, 12 frames: from the front a little above, from the
                     side, and seen from below behind
  <kind>-onion.png   the whole beat overlaid (older frames fainter), front and side
  <kind>-tip.png     the wingtip's path over one beat in the bird's frame (front and side), a dot
                     every 1/48 beat (their spacing is the speed), downstroke orange, upstroke blue
  <kind>-clip.png    a stretch of the game's clock with a beat starting and ending in it
and the eagle's clip (eagle-clip.png) from the Himalayan eagle rig posed per joint.

--blend saves a scene to scrub: each bird flying the clip the exporter sampled (absolute shape
keys, one per frame, on a keyed eval_time), with its bank and pitch (not its heading), and below
it the same bird beating at full weight in a loop, its wingtip path drawn as a curve; the eagle
on its own rig, every joint keyed; and the beat cycles' keyframes (odyssey_birds.author_beats),
so the Graph Editor shows the easing.
"""

import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
TAG = "[odyssey-birds-review]"
KINDS = ("gull", "swallow", "goose", "vulture")


def load_module(path):
    spec = importlib.util.spec_from_file_location("odyssey_birds_mod", str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["odyssey_birds_mod"] = mod
    spec.loader.exec_module(mod)
    return mod


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith("--") and i + 1 < len(argv):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            i += 1
    return opts


# -- posing ----------------------------------------------------------------------------------------


def posed(mod, kind, b, pose):
    """The bird's vertices (bird frame) under `pose` (+ heave and tail when the module has them)."""
    spec = mod.SPECS[kind]
    full = {k: pose.get(k, 0.0) for k in ("lift", "sweep", "bend", "fold", "curl")}
    out = []
    tail_fn = getattr(mod, "tail_pose", None)
    tails = getattr(b, "tail", None)
    for i, (v, w) in enumerate(zip(b.verts, b.hinge)):
        p = v
        if tail_fn and tails:
            p = tail_fn(spec, p, tails[i], pose.get("tailSpread", 0.0), pose.get("tailTwist", 0.0))
        q = mod.fold(spec, p, w, full)
        out.append((q[0], q[1] + pose.get("heave", 0.0), q[2]))
    return out


def to_blender(p):
    """Bird frame (x left, y up, z forward) -> Blender (x, -z, y): the bird faces -y, up +z."""
    return (p[0], -p[2], p[1])


def world_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def frame_rotation(fr):
    """The bird's bank and pitch (its heading taken out), as a Blender rotation matrix."""
    left = world_to_blender(fr["left"])
    up = world_to_blender(fr["up"])
    fwd = world_to_blender(fr["forward"])
    # The bird's axes in Blender: left -> +X, forward -> -Y, up -> +Z.
    m = Matrix((left, -fwd, up)).transposed()
    flat = Vector((fwd.x, fwd.y, 0.0))
    if flat.length < 1e-6:
        flat = Vector((0.0, -1.0, 0.0))
    flat.normalize()
    yaw = math.atan2(flat.x, -flat.y)
    return Matrix.Rotation(-yaw, 3, "Z") @ m


# -- scene helpers ----------------------------------------------------------------------------------


def mesh_object(scene, name, b, verts, colours=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([to_blender(v) for v in verts], [], [tuple(t) for t in b.tris])
    mesh.update()
    col = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(colours or b.top):
        col.data[i].color = (c[0], c[1], c[2], 1.0)
    mesh.color_attributes.active_color = col
    mesh.color_attributes.render_color_index = 0
    mesh.shade_smooth()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def bake_shapes(obj, frames_verts, fps_frames):
    """Absolute shape keys, one per sampled frame, played by a keyed eval_time (a mesh cache)."""
    obj.shape_key_add(name="Basis", from_mix=False)
    key = obj.data.shape_keys
    key.use_relative = False
    for k, verts in enumerate(frames_verts):
        kb = obj.shape_key_add(name=f"f{k:04d}", from_mix=False)
        kb.interpolation = "KEY_LINEAR"
        flat = [c for v in verts for c in to_blender(v)]
        kb.data.foreach_set("co", flat)
    # Block k sits at eval_time 10 * (k + 1) (the basis at 0).
    key.eval_time = 10.0
    key.keyframe_insert("eval_time", frame=fps_frames[0])
    key.eval_time = 10.0 * len(frames_verts)
    key.keyframe_insert("eval_time", frame=fps_frames[1])
    from bpy_extras import anim_utils
    act = key.animation_data.action
    cb = anim_utils.action_get_channelbag_for_slot(act, key.animation_data.action_slot)
    for fc in cb.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    return key


def setup_render(scene, size, ortho, world=(0.42, 0.52, 0.62), transparent=False):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.show_cavity = False
    scene.display.shading.show_backface_culling = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = transparent
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    if scene.world is None:
        scene.world = bpy.data.worlds.new("sky")
    scene.world.color = world
    cam = scene.camera
    if cam is None:
        data = bpy.data.cameras.new("cam")
        data.type = "ORTHO"
        cam = bpy.data.objects.new("cam", data)
        scene.collection.objects.link(cam)
        scene.camera = cam
    cam.data.ortho_scale = ortho
    return cam


def aim(cam, direction, target=Vector((0, 0, 0)), dist=8.0):
    d = Vector(direction).normalized()
    cam.location = target + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()


def render_px(scene, path):
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True, scene=scene.name)
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    Path(path).unlink()
    return px


def save_px(px, path):
    h, w = px.shape[:2]
    img = bpy.data.images.new(Path(path).stem, w, h, alpha=True)
    img.pixels[:] = np.ascontiguousarray(px[::-1]).ravel()
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def tile(rows, gap=4, bg=(0.12, 0.12, 0.12)):
    """rows: list of lists of HxWx4 arrays (equal sizes) -> one sheet."""
    h, w = rows[0][0].shape[:2]
    cols = max(len(r) for r in rows)
    sheet = np.zeros((len(rows) * h + (len(rows) - 1) * gap, cols * w + (cols - 1) * gap, 4), np.float32)
    sheet[..., :3] = bg
    sheet[..., 3] = 1
    for ri, r in enumerate(rows):
        for ci, px in enumerate(r):
            y, x = ri * (h + gap), ci * (w + gap)
            sheet[y:y + h, x:x + w] = px
    return sheet


def draw_dot(px, x, y, r, col):
    h, w = px.shape[:2]
    for yy in range(int(y - r), int(y + r) + 1):
        for xx in range(int(x - r), int(x + r) + 1):
            if 0 <= xx < w and 0 <= yy < h and (xx - x) ** 2 + (yy - y) ** 2 <= r * r:
                px[yy, xx, :3] = col
                px[yy, xx, 3] = 1


def draw_line(px, a, b, col):
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
    for k in range(n + 1):
        t = k / n
        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        if 0 <= int(y) < px.shape[0] and 0 <= int(x) < px.shape[1]:
            px[int(y), int(x), :3] = col


# -- strips -----------------------------------------------------------------------------------------


VIEWS = {
    "front": Vector((0.0, -1.0, 0.18)),          # from ahead, a little above
    "side": Vector((1.0, 0.0, 0.04)),
    "behindBelow": Vector((0.35, 0.85, -0.45)),
}


def strips(mod, built, motion, out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.data.scenes.new("strips")
    for kind in KINDS:
        if kind not in motion["cycles"]:
            continue
        b = built[kind]
        spec = mod.SPECS[kind]
        ortho = spec["span"] * 1.12
        cam = setup_render(scene, (240, 170), ortho)
        poses = motion["cycles"][kind]["poses"]
        n = len(poses)
        pick = [round(k * n / 12) % n for k in range(12)]
        rows = []
        objs = []
        for k in pick:
            objs.append(mesh_object(scene, f"{kind}-{k}", b, posed(mod, kind, b, poses[k])))
        for vname, d in VIEWS.items():
            row = []
            for o in objs:
                for other in objs:
                    other.hide_render = other is not o
                aim(cam, d)
                row.append(render_px(scene, out_dir / "_t.png"))
            rows.append(row)
        save_px(tile(rows), out_dir / f"{kind}-beat.png")
        for o in objs:
            m = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.meshes.remove(m)

        # Onion skin: every frame of the beat, older ones fainter (front and side).
        setup_render(scene, (420, 300), ortho, transparent=True)
        onion_rows = []
        for vname in ("front", "side"):
            acc = np.zeros((300, 420, 4), np.float32)
            acc[..., :3] = (0.42, 0.52, 0.62)
            acc[..., 3] = 1
            order = list(range(0, n, max(1, n // 16)))
            for j, k in enumerate(order):
                o = mesh_object(scene, f"{kind}-on{k}", b, posed(mod, kind, b, poses[k]))
                aim(cam, VIEWS[vname])
                px = render_px(scene, out_dir / "_t.png")
                a = px[..., 3:4] * (0.25 + 0.75 * (j + 1) / len(order))
                acc[..., :3] = acc[..., :3] * (1 - a) + px[..., :3] * a
                m = o.data
                bpy.data.objects.remove(o, do_unlink=True)
                bpy.data.meshes.remove(m)
            onion_rows.append(acc)
        save_px(tile([onion_rows]), out_dir / f"{kind}-onion.png")

        # The wingtip's path over one beat (bird frame, with the body's heave): front and side.
        tip_i = max(range(len(b.verts)), key=lambda i: b.verts[i][0])
        path = []
        for k in range(n):
            vs = posed(mod, kind, b, poses[k])
            path.append(vs[tip_i])
        lowest = min(range(n), key=lambda k: path[k][1])
        highest = max(range(n), key=lambda k: path[k][1])
        res = (420, 300)
        tiles = []
        for vname in ("front", "side"):
            setup_render(scene, res, ortho, transparent=False)
            o = mesh_object(scene, f"{kind}-tipref", b, posed(mod, kind, b, poses[0]))
            aim(cam, Vector((0, -1, 0.0001)) if vname == "front" else Vector((1, 0, 0.0001)))
            px = render_px(scene, out_dir / "_t.png")
            px[..., :3] = px[..., :3] * 0.35 + 0.65 * np.array((0.42, 0.52, 0.62))  # the bird faint
            m = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.meshes.remove(m)
            scale = res[0] / ortho

            def to_px(p, vname=vname):
                # Seen from ahead the image's right is the bird's left (+x); from its left side,
                # the image's right is behind the bird (-z).
                u = p[0] if vname == "front" else -p[2]
                return (res[0] / 2 + u * scale, res[1] / 2 - p[1] * scale)
            pts = [to_px(p) for p in path]
            for k in range(n):
                a, c = pts[k], pts[(k + 1) % n]
                going_down = path[(k + 1) % n][1] < path[k][1]
                draw_line(px, a, c, (0.95, 0.55, 0.15) if going_down else (0.2, 0.45, 0.95))
            for k in range(n):
                going_down = path[(k + 1) % n][1] < path[k][1]
                draw_dot(px, *pts[k], 2.2, (0.95, 0.55, 0.15) if going_down else (0.2, 0.45, 0.95))
            draw_dot(px, *pts[highest], 4, (1, 1, 1))
            draw_dot(px, *pts[lowest], 4, (0, 0, 0))
            tiles.append(px)
        save_px(tile([tiles]), out_dir / f"{kind}-tip.png")

        # The clip: glide -> beat -> glide, as the game flies it (bank and pitch kept).
        clip = motion["clips"][kind]["frames"]
        cam = setup_render(scene, (200, 140), ortho * 1.1)
        step = max(1, len(clip) // 32)
        row, rows = [], []
        for k in range(0, len(clip), step):
            fr = clip[k]
            o = mesh_object(scene, f"{kind}-c{k}", b, posed(mod, kind, b, fr))
            o.matrix_world = frame_rotation(fr).to_4x4()
            aim(cam, Vector((0.55, -0.75, 0.32)))
            row.append(render_px(scene, out_dir / "_t.png"))
            m = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            bpy.data.meshes.remove(m)
            if len(row) == 16:
                rows.append(row)
                row = []
        if row:
            while len(row) < 16:
                row.append(np.zeros_like(rows[0][0]) if rows else row[0] * 0)
            rows.append(row)
        save_px(tile(rows), out_dir / f"{kind}-clip.png")
        print(f"{TAG} {kind}: strips written")
    bpy.data.scenes.remove(scene)


# -- the eagle --------------------------------------------------------------------------------------


def build_eagle(scene_name="birds-review"):
    """The Himalayan eagle (scripts/blender/himalayan_eagle.py), rig and mesh, in a fresh file."""
    # The script runs its own main() (writing the theme's GLB) when loaded: load it without that.
    source = (HERE.parent / "himalayan_eagle.py").read_text(encoding="utf-8")
    source = source[:source.rstrip().rfind("main()")]
    he = type(sys)("himalayan_eagle")
    he.__file__ = str(HERE.parent / "himalayan_eagle.py")
    exec(compile(source, he.__file__, "exec"), he.__dict__)  # noqa: S102 - our own build script
    b = he.Builder()
    face_ring = he.build_body(b)
    he.build_bill(b, face_ring)
    for side in (1, -1):
        he.build_wing(b, side)
        he.build_fingers(b, side)
    he.build_tail(b)
    arm, obj = he.build_scene(b, he.skeleton())  # resets the file (read_factory_settings)
    bpy.context.scene.name = scene_name
    return arm, obj


def key_eagle(arm, frames, origin):
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    for k, fr in enumerate(frames):
        f = k + 1
        rot = frame_rotation(fr)
        arm.matrix_world = Matrix.Translation(origin + Vector((0, 0, fr["heave"]))) @ rot.to_4x4()
        arm.keyframe_insert("location", frame=f)
        arm.rotation_mode = "QUATERNION"
        arm.keyframe_insert("rotation_quaternion", frame=f)
        for name, j in fr["joints"].items():
            pb = arm.pose.bones.get(name)
            if pb is None:
                continue
            pb.rotation_euler = (j[0], j[1], j[2])
            pb.keyframe_insert("rotation_euler", frame=f)


def eagle_clip(arm, motion, out_dir):
    scene = bpy.context.scene
    cam = setup_render(scene, (260, 170), 2.6)
    frames = motion["eagle"]["frames"]
    rows, row = [], []
    step = max(1, len(frames) // 32)
    for k in range(0, len(frames), step):
        scene.frame_set(k + 1)
        aim(cam, Vector((0.55, -0.75, 0.32)), target=arm.matrix_world.translation.copy())
        row.append(render_px(scene, Path(out_dir) / "_t.png"))
        if len(row) == 16:
            rows.append(row)
            row = []
    if row:
        while len(row) < 16:
            row.append(row[0] * 0)
        rows.append(row)
    save_px(tile(rows), Path(out_dir) / "eagle-clip.png")
    # One bout's beat, larger, from the front and the side.
    beat = [k for k, fr in enumerate(frames) if fr["amount"] > 0.98][:24]
    if beat:
        cam = setup_render(scene, (260, 170), 2.6)
        rows = []
        for d in (Vector((0, -1, 0.15)), Vector((1, 0, 0.05))):
            r = []
            for k in beat[::2][:12]:
                scene.frame_set(k + 1)
                aim(cam, d, target=arm.matrix_world.translation.copy())
                r.append(render_px(scene, Path(out_dir) / "_t.png"))
            rows.append(r)
        save_px(tile(rows), Path(out_dir) / "eagle-beat.png")
    cam.hide_render = False


# -- the review .blend ------------------------------------------------------------------------------


def review_blend(mod, built, motion, path, eagle_arm=None):
    scene = bpy.context.scene
    fps = motion["fps"]
    scene.render.fps = fps
    n = len(next(iter(motion["clips"].values()))["frames"])
    scene.frame_start, scene.frame_end = 1, n
    spacing = 3.4
    for col, kind in enumerate(KINDS):
        if kind not in motion["clips"]:
            continue
        b = built[kind]
        x = (col - 1.5) * spacing
        # The clip, as the game flies it.
        clip = motion["clips"][kind]["frames"]
        o = mesh_object(scene, f"{kind}-flight", b, b.verts)
        o.location = (x, 0, 2.0)
        bake_shapes(o, [posed(mod, kind, b, fr) for fr in clip], (1, n))
        o.rotation_mode = "QUATERNION"
        for k, fr in enumerate(clip):
            o.rotation_quaternion = frame_rotation(fr).to_quaternion()
            o.keyframe_insert("rotation_quaternion", frame=k + 1)
        # The beat at full weight, looping at its real rate, and its wingtip's path.
        cyc = motion["cycles"][kind]
        poses = cyc["poses"]
        c = mesh_object(scene, f"{kind}-beat-loop", b, b.verts)
        c.location = (x, 0, -0.5)
        frames_per_beat = fps / cyc["rate"]
        key = bake_shapes(c, [posed(mod, kind, b, p) for p in poses] + [posed(mod, kind, b, poses[0])],
                          (1, 1 + frames_per_beat))
        from bpy_extras import anim_utils
        act = key.animation_data.action
        cb = anim_utils.action_get_channelbag_for_slot(act, key.animation_data.action_slot)
        for fc in cb.fcurves:
            fc.modifiers.new("CYCLES")
        tip_i = max(range(len(b.verts)), key=lambda i: b.verts[i][0])
        pts = [to_blender(posed(mod, kind, b, p)[tip_i]) for p in poses]
        curve = bpy.data.curves.new(f"{kind}-tip-path", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.004 * mod.SPECS[kind]["span"]
        spline = curve.splines.new("POLY")
        spline.points.add(len(pts))
        for i, p in enumerate(pts + [pts[0]]):
            spline.points[i].co = (p[0], p[1], p[2], 1.0)
        cobj = bpy.data.objects.new(f"{kind}-tip-path", curve)
        cobj.location = c.location
        scene.collection.objects.link(cobj)
    if eagle_arm is not None:
        eagle_arm.location = (0, 4.5, 1.0)
    if hasattr(mod, "author_beats"):
        mod.author_beats(scene)
    # A camera and Workbench in vertex colour, so it opens looking like the previews.
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "VERTEX"
    scene.display.shading.light = "STUDIO"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("sky")
    scene.world.color = (0.42, 0.52, 0.62)
    cam_data = bpy.data.cameras.new("review-cam")
    cam = bpy.data.objects.new("review-cam", cam_data)
    scene.collection.objects.link(cam)
    aim(cam, Vector((0.25, -1.0, 0.35)), target=Vector((0, 1.5, 0.8)), dist=21)
    scene.camera = cam
    for area_scene in bpy.data.scenes:
        if area_scene is not scene:
            bpy.data.scenes.remove(area_scene)
    if bpy.context.window is not None:
        bpy.context.window.scene = scene
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
    print(f"{TAG} saved {path}")


def main():
    opts = parse_args()
    mod = load_module(opts.get("module", HERE / "odyssey_birds.py"))
    motion = json.load(open(opts["motion"], encoding="utf-8"))
    eagle_arm = None
    if motion.get("eagle"):
        eagle_arm, _ = build_eagle()
        key_eagle(eagle_arm, motion["eagle"]["frames"], Vector((0, 0, 0)))
    built = {}
    for kind in KINDS:
        b = mod.BUILDERS[kind]()
        b.orient()
        built[kind] = b
    if opts.get("strips"):
        if eagle_arm is not None:
            eagle_clip(eagle_arm, motion, opts["strips"])
        strips(mod, built, motion, opts["strips"])
    if opts.get("blend"):
        review_blend(mod, built, motion, opts["blend"], eagle_arm)


main()
