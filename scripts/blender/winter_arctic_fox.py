"""Winter's arctic fox: modelled procedurally in Blender, round the joints of the theme's rig.

Run by scripts/winter/rig-fox.mjs, which hands it the skeleton (src/themes/winter/winter-fox-rig.js)
as JSON, then skins and paints what it writes and writes the asset:

    node scripts/winter/rig-fox.mjs --model [--preview=<dir>]

or by hand (headless; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/winter_arctic_fox.py -- \
        --skeleton <bones.json> --out <arctic-fox-mesh.glb> [--preview <dir>]

An arctic fox in its winter coat, from what makes one read as itself near or far: a round, compact
body on short legs, the coat so deep it hides the neck; a ruff that fills the chest; a big round
head, wide across the cheeks, with a short muzzle and soft round ears, more cub than wolf; legs
ending in round paws furred right over the toes; and a great soft brush of a tail, near as long as
the body, that it carries low and curls up at the tip.

How it is made (the meshing is the Grainfields horse's, scripts/blender/grainfields/horse_sdf.py,
and the coat's tools the polar bear's):

- **Shape.** A signed distance field of ellipsoids and round cones joined by smooth unions, built
  round the rig's joints: chest, belly, rump, shoulders and haunches; the neck in its ruff; the head
  as cranium, cheeks, brow, muzzle, jaw and nose; ears cupped by a smooth carve; each leg through
  its own joints, with a paw of four toes; the tail along its chain.
- **Coat.** Tufts of hair laid on the skin as they fall: the ruff, the cheeks, the belly, the back
  of the thighs, the length of the tail. Over the whole, a field of clumps: value noise stretched
  along the way the hair lies (back over the body, down the legs), shallow on the muzzle and paws.
- **Mesh.** The field's left half is sampled on a 3.5 mm grid, polygonised with surface nets,
  projected onto the zero set, decimated in Blender with a quadric edge collapse, cleaned of folds
  and mirrored, so the fox is exactly symmetric.

The skin and the paint (tail, fur length, dark, sky seen) are laid afterwards, by
scripts/winter/rig-fox.mjs.

Frame: metres, +z forward (toward the head), +y up, the paws on y = 0, the body centred on x = 0;
the fox faces +z, so its left side is +x. No external asset is used: the field is the model.
"""

import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

from grainfields.horse_sdf import (  # noqa: E402
    Ellipsoid, HalfSpace, RoundCone, Tube, Union, X_AXIS, Z_AXIS,
    _grid, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)
from winter_polar_bear import Carve, FurCoat, P, _hash01, _lock, _vnoise  # noqa: E402

TAG = "[winter-fox]"
GENERATOR = "Serenity Blocks - Winter arctic fox (scripts/blender/winter_arctic_fox.py)"
VOXEL = 0.0035
TARGET_TRIANGLES = 24000
# The deepest the coat's clumps go (metres): the field's bounds are padded by it.
COAT = 0.007


# -- the coat ------------------------------------------------------------------------------
def _coat(x, y, z):
    """The coat's clumps, in units of COAT: back along the body, down the legs, fine in the face."""
    legs = _smoothstep(0.24, 0.14, y) * (np.abs(x) > 0.04)
    body = _vnoise(x * 62.0 + 3.1, y * 62.0, z * 13.0)
    down = _vnoise(x * 62.0 + 7.7, y * 13.0, z * 62.0 + 1.3)
    clumps = body + (down - body) * legs
    fibre = _vnoise(x * 170.0, y * 170.0 + 2.2, z * 46.0 + 5.1)
    n = (clumps - 0.5) * 2.0 * 0.8 + (fibre - 0.5) * 2.0 * 0.2
    # How deep: shallow on the muzzle, the ears and the paws; deep in the ruff and the tail.
    muzzle = _smoothstep(0.43, 0.5, z) * _smoothstep(0.38, 0.42, y)
    ears = _smoothstep(0.565, 0.59, y)
    paws = _smoothstep(0.08, 0.03, y)
    tail = _smoothstep(-0.2, -0.28, z)
    ruff = _smoothstep(0.1, 0.2, z) * _smoothstep(0.42, 0.32, z) * _smoothstep(0.2, 0.28, y)
    depth = 0.42 + 0.3 * tail + 0.3 * ruff
    return n * depth * (1.0 - 0.9 * muzzle) * (1.0 - 0.75 * ears) * (1.0 - 0.6 * paws)


def _along(points, radii, stations):
    """A smooth chain through `points` (Catmull-Rom) and `radii`: a Tube of `stations` joints."""
    points = [np.asarray(p, dtype=np.float64) for p in points]
    count = len(points) - 1
    out, sizes = [], []
    for k in range(stations):
        u = k / (stations - 1) * count
        i = min(int(u), count - 1)
        t = u - i
        p0, p1, p2, p3 = points[max(i - 1, 0)], points[i], points[i + 1], points[min(i + 2, count)]
        out.append(0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
                          + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t))
        r0, r1, r2, r3 = radii[max(i - 1, 0)], radii[i], radii[i + 1], radii[min(i + 2, count)]
        sizes.append(max(0.004, 0.5 * (2.0 * r1 + (r2 - r0) * t + (2.0 * r0 - 5.0 * r1 + 4.0 * r2 - r3) * t * t
                                       + (3.0 * r1 - r0 - 3.0 * r2 + r3) * t * t * t)))
    return Tube(out, sizes, k=0.012)


def _tufts(skin, roots):
    """Locks of hair on `skin`: each of `roots` is (start, direction, length, thick)."""
    return Union([(_lock(skin, start, direction, length, thick, thick * 0.34, sink=0.8), 0.016)
                  for start, direction, length, thick in roots])


# -- the fox -------------------------------------------------------------------------------
def design(J, M):
    """The fox as a distance field round the rig's joints `J` and marks `M`."""
    sides = (1.0, -1.0)
    # The trunk: a deep chest, a full belly (the winter coat hides the waist), a round rump,
    # shoulders and haunches under the fur.
    trunk = Union([
        Ellipsoid(P(0, 0.325, 0.13), (0.132, 0.128, 0.165)),
        Ellipsoid(P(0, 0.318, -0.01), (0.136, 0.126, 0.2)),
        Ellipsoid(P(0, 0.322, -0.13), (0.134, 0.124, 0.135)),
        *[(Ellipsoid(P(0.086 * s, 0.32, 0.18), (0.056, 0.095, 0.075)), 0.045) for s in sides],
        *[(Ellipsoid(P(0.09 * s, 0.305, -0.1), (0.058, 0.095, 0.095)), 0.045) for s in sides],
    ], k=0.07)

    # The neck hardly shows: it rises out of the chest inside the ruff.
    neck = Union([
        Tube([P(0, 0.385, 0.2), P(0, 0.435, 0.27), P(0, 0.478, 0.335)], [0.118, 0.112, 0.102], k=0.03),
        (Ellipsoid(P(0, 0.36, 0.25), (0.138, 0.13, 0.112)), 0.05),
        (Ellipsoid(P(0, 0.448, 0.3), (0.13, 0.108, 0.09)), 0.04),
    ], k=0.04)

    # The head: short and broad, wide across the cheeks, a soft stop down to a short muzzle.
    nose = np.asarray(M["nose"], dtype=np.float64)
    head = Union([
        Ellipsoid(P(0, 0.512, 0.385), (0.088, 0.078, 0.088)),
        *[(Ellipsoid(P(0.076 * s, 0.466, 0.365), (0.07, 0.066, 0.072)), 0.04) for s in sides],
        RoundCone(P(0, 0.476, 0.44), nose + P(0, 0.006, -0.018), 0.05, 0.0185, (X_AXIS, 0.96)),
        RoundCone(P(0, 0.452, 0.44), nose + P(0, -0.014, -0.028), 0.036, 0.015),
        (Ellipsoid(nose + P(0, 0.002, -0.008), (0.0145, 0.0115, 0.0105)), 0.006),
    ], k=0.024)

    # Ears: small and round, set wide, cupped forward and out.
    ears = []
    for s in sides:
        base = P(0.062 * s, 0.566, 0.358)
        tip = P(0.09 * s, 0.626, 0.344)
        facing = _unit((0.45 * s, 0.1, 1.0))
        ear = RoundCone(base, tip, 0.046, 0.024, (facing, 0.44))
        cup = Ellipsoid(base * 0.45 + tip * 0.55 + facing * 0.013, (0.0265, 0.031, 0.0125), along=facing)
        ears.append(Carve(ear, cup, 0.004))

    def paw(ball, ahead):
        """A paw furred over its toes: a soft pad and four rounded toes along its front."""
        across = np.array([ahead[2], 0.0, -ahead[0]])
        centre = ball + P(0, 0.024, 0) - ahead * 0.012
        parts = [Ellipsoid(centre, (0.034, 0.026, 0.046), along=ahead)]
        for k in range(4):
            a = (k - 1.5) / 1.5
            toe = ball + across * (0.022 * a) + ahead * (0.027 - 0.012 * a * a) + P(0, 0.013, 0)
            parts.append((Ellipsoid(toe, (0.0135, 0.0145, 0.0165), along=ahead), 0.011))
        return Union(parts, k=0.012)

    def front(side):
        s = 1.0 if side == "L" else -1.0
        shoulder, elbow, wrist = J["arm" + side], J["fore" + side], J["hand" + side]
        ball = np.asarray(M["paw" + ("FL" if side == "L" else "FR")], dtype=np.float64)
        mid = (elbow + wrist) * 0.5 + P(0, 0, 0.003)
        return Union([
            Tube([shoulder + P(0, 0.03, 0), elbow], [0.05, 0.04]),
            Tube([elbow, mid, wrist], [0.04, 0.03, 0.0245], squash_axis=Z_AXIS, squash=[1.0, 1.1, 1.08]),
            (paw(ball, _unit((-0.08 * s, 0.0, 1.0))), 0.016),
        ], k=0.018)

    def hind(side):
        s = 1.0 if side == "L" else -1.0
        hip, knee, heel = J["thigh" + side], J["shin" + side], J["hock" + side]
        ball = np.asarray(M["paw" + ("BL" if side == "L" else "BR")], dtype=np.float64)
        mid = (knee + heel) * 0.5 + P(0, 0, -0.004)
        return Union([
            Tube([hip, knee], [0.06, 0.04]),
            Tube([knee, mid, heel], [0.04, 0.029, 0.0205], squash_axis=Z_AXIS, squash=[1.0, 1.1, 1.05]),
            Tube([heel, ball + P(0, 0.028, -0.012)], [0.0205, 0.0235]),
            (paw(ball, _unit((-0.05 * s, 0.0, 1.0))), 0.015),
        ], k=0.016)

    legs = [front("L"), front("R"), hind("L"), hind("R")]

    # The tail: a great brush along its chain, widest two thirds of the way, ending in a soft point.
    brush = _along([J["tail1"], J["tail2"], J["tail3"], J["tail4"], M["tailTip"]],
                   [0.05, 0.076, 0.094, 0.07, 0.012], 20)

    body = Union([(trunk, 0.0), (neck, 0.05), (head, 0.05), *[(ear, 0.012) for ear in ears],
                  *[(leg, 0.03) for leg in legs]])

    # The hair that stands out of the coat, laid side by side (each side the other's mirror).
    roots = []
    tail_roots = []
    for s in sides:
        # The ruff: forward over the chest, falling down and back.
        for k in range(10):
            f = k / 9.0
            a = (f - 0.5) * 2.4
            start = P(0.115 * s * math.sin(abs(a) + 0.2), 0.31 + 0.11 * _hash01(k, 1.0), 0.28 - 0.06 * abs(a))
            roots.append((start, (0.25 * s * math.sin(abs(a)), -1.0, -0.2), 0.05 + 0.03 * _hash01(k, 2.0), 0.018))
        # The cheeks: out and back from the jaw, the fox's wide face.
        for k in range(4):
            f = k / 3.0
            start = P(0.09 * s, 0.445 + 0.05 * f, 0.33 + 0.04 * _hash01(k, 3.0))
            roots.append((start, (0.3 * s, -0.6, -0.9), 0.035 + 0.015 * _hash01(k, 4.0), 0.016))
        # The back of the thigh, its trousers.
        for k in range(5):
            f = k / 4.0
            start = P((0.085 + 0.03 * (_hash01(k, 7.0) - 0.5)) * s, 0.28 - 0.08 * f, -0.17 + 0.02 * f)
            roots.append((start, (0.0, -1.0, -0.45), 0.03 + 0.02 * _hash01(k, 8.0), 0.016))
        # The tail: all along it, lying close, gone before the tip.
        for row, angle in enumerate((0.15, 0.75, 1.35, 1.95, 2.55)):
            for k in range(7):
                f = (k + 0.5 * (row % 2)) / 7.0
                u = 0.8 + f * 1.8
                i = min(int(u), 3)
                t = u - i
                chain = [J["tail1"], J["tail2"], J["tail3"], J["tail4"], np.asarray(M["tailTip"], dtype=np.float64)]
                centre = chain[i] * (1 - t) + chain[i + 1] * t
                ahead = _unit(chain[i + 1] - chain[i])
                spoke = np.array([s * math.sin(angle), math.cos(angle), 0.0])
                start = centre + spoke * 0.08
                direction = ahead + spoke * 0.07
                tail_roots.append((start, direction, 0.05 + 0.03 * _hash01(k, 9.0 + row), 0.013))

    fur = _tufts(body, roots)
    tail_fur = _tufts(brush, tail_roots)
    whole = Union([(body, 0.0), (fur, 0.02), (brush, 0.05), (tail_fur, 0.024)])
    return HalfSpace(FurCoat(whole, COAT, _coat), axis=1)


# -- building it ---------------------------------------------------------------------------
class Fox:
    def __init__(self, positions, normals, triangles, stats):
        self.positions, self.normals, self.triangles, self.stats = positions, normals, triangles, stats

    def measures(self):
        low, high = self.positions.min(axis=0), self.positions.max(axis=0)
        body = self.positions[np.abs(self.positions[:, 2]) < 0.1]
        return dict(backHeight=float(body[:, 1].max()), height=float(high[1]), width=float(high[0] - low[0]),
                    length=float(high[2] - low[2]))


def build(studio, skeleton, voxel=VOXEL, target=TARGET_TRIANGLES):
    """Polygonise and decimate the left half, then mirror it."""
    started = time.time()
    J = {bone[0]: np.array(bone[2:5], dtype=np.float64) for bone in skeleton["bones"]}
    shape = design(J, skeleton["marks"])
    designed = time.time()
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    sampled = time.time()
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    del field
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    positions, triangles = decimate(studio, dense, dense_triangles, target // 2)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    normals[positions[:, 1] <= 1e-6] = np.array([0.0, -1.0, 0.0])
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_triangles=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=folds, mesh_normals=int(disagree.sum()),
                 design_s=designed - started, field_s=sampled - designed, total_s=time.time() - started)
    fox = Fox(positions, normals, triangles, stats)
    print("%s grid %s dense %d tris -> mirrored %d tris %d verts (%d folds, %d mesh normals); %s; "
          "design %.1fs field %.1fs total %.1fs" % (
              TAG, "x".join(str(n) for n in stats["grid"]), stats["dense_triangles"], stats["triangles"],
              stats["vertices"], folds, stats["mesh_normals"],
              {key: round(value, 3) for key, value in fox.measures().items()},
              stats["design_s"], stats["field_s"], stats["total_s"]), flush=True)
    return fox


def write(path, fox):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("arctic-fox", {
        "POSITION": (fox.positions, False),
        "NORMAL": (fox.normals.astype(np.float32), False),
    }, indices=fox.triangles, position_bits=32)
    writer.set_extras(dict(name="arctic-fox", **{key: round(value, 4) for key, value in fox.measures().items()},
                           triangles=int(len(fox.triangles)), vertices=int(len(fox.positions))))
    return writer.write(path)


# -- previews (never shipped) -------------------------------------------------------------
def previews(fox, directory):
    import bpy
    from mathutils import Vector
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    started = time.time()
    sun = None
    try:
        extent = 12.0
        ground = studio.mesh_object("fox_ground", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([[0.55, 0.62, 0.72]], (4, 1)))
        ground.data.materials.append(studio.material("fox_ground", roughness=1.0))
        obj = studio.mesh_object("fox_coat", fox.positions, fox.triangles,
                                 colors=np.tile([[0.46, 0.46, 0.45]], (len(fox.positions), 1)))
        obj.data.normals_split_custom_set_from_vertices([tuple(n) for n in to_blender(fox.normals)])
        obj.data.materials.append(studio.material("fox_coat", roughness=0.85))
        world = studio.scene.world
        world.use_nodes = True
        background = world.node_tree.nodes["Background"]
        background.inputs["Color"].default_value = (0.55, 0.62, 0.75, 1.0)
        background.inputs["Strength"].default_value = 0.55
        data = bpy.data.lights.new(studio_module.PREFIX + "fox_sun", "SUN")
        data.energy = 2.6
        data.color = (1.0, 0.95, 0.88)
        data.angle = math.radians(2.0)
        sun = bpy.data.objects.new(studio_module.PREFIX + "fox_sun", data)
        studio.scene.collection.objects.link(sun)
        direction = _unit(to_blender(np.array([(0.5, 0.7, 0.45)]))[0])
        sun.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
        shots = {
            "side": dict(eye=(2.4, 0.45, 0.03), target=(0.0, 0.31, 0.03), lens=50.0, size=(1000, 640)),
            "three-quarter": dict(eye=(1.5, 0.62, 1.7), target=(0.0, 0.3, 0.05), lens=50.0, size=(900, 700)),
            "front": dict(eye=(0.35, 0.5, 2.2), target=(0.0, 0.33, 0.1), lens=55.0, size=(700, 700)),
            "rear": dict(eye=(-1.1, 0.6, -1.9), target=(0.0, 0.28, -0.1), lens=50.0, size=(800, 640)),
            "head": dict(eye=(0.42, 0.56, 1.05), target=(0.0, 0.49, 0.42), lens=60.0, size=(700, 700)),
            "head-side": dict(eye=(1.1, 0.5, 0.45), target=(0.0, 0.49, 0.42), lens=60.0, size=(700, 560)),
        }
        for name, shot in shots.items():
            studio.render(directory / ("fox-%s.png" % name), samples=12, **shot)
        data_mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(data_mesh)
        data_mesh = ground.data
        bpy.data.objects.remove(ground, do_unlink=True)
        bpy.data.meshes.remove(data_mesh)
    finally:
        if sun is not None:
            data = sun.data
            bpy.data.objects.remove(sun, do_unlink=True)
            bpy.data.lights.remove(data)
        studio.dispose()
    print("%s previews in %s  %.1fs" % (TAG, directory, time.time() - started), flush=True)


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {}
    key = None
    for argument in arguments:
        if argument.startswith("--"):
            key = argument[2:]
            options[key] = True
        elif key:
            options[key] = argument
            key = None
    if "skeleton" not in options or "out" not in options:
        raise SystemExit("usage: blender --background --factory-startup --python winter_arctic_fox.py -- "
                         "--skeleton <bones.json> --out <mesh.glb> [--preview <dir>]")
    skeleton = json.loads(Path(options["skeleton"]).read_text(encoding="utf-8"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Winter - Fox Atelier"
    studio_module.PREFIX = "SWFOX_"
    studio = studio_module.Studio()
    try:
        fox = build(studio, skeleton, voxel=float(options.get("voxel", VOXEL)),
                    target=int(options.get("triangles", TARGET_TRIANGLES)))
    finally:
        studio.dispose()
    out = Path(options["out"]).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    size = write(out, fox)
    print("%s wrote %s (%d bytes)" % (TAG, out, size), flush=True)
    if options.get("preview") and options["preview"] is not True:
        previews(fox, Path(options["preview"]).expanduser().resolve())


if __name__ == "__main__":
    main()
