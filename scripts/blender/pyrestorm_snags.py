"""Pyrestorm's snags: the charred trees of the forest the ridge once carried, built by script.

Run headless (nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/pyrestorm_snags.py -- \
        --out src/themes/pyrestorm [--preview <dir>]

The eye stands on a tephra ridge fifteen kilometres from the eruption. Ash fall killed the wood
that grew there, and what is left stands between the eye and the lava: trunks burnt to charcoal,
their crowns gone, a few limbs broken short. They are seen as SILHOUETTES against the rivers' glow,
so each design is built for its outline first and reads apart from the others at sixty pixels:

    spire       a tall trunk broken off high up, splinters over the break, stubs all the way up it
    fork        a trunk that parts into two limbs of unequal length, both broken
    lean        a trunk leaning out of the slope with one long limb reaching back over it
    candelabra  a stout trunk carrying three limbs that turn upward
    stump       a wide stump broken off low, four jagged teeth of unequal height over the break
    hook        a thin trunk whose top has folded over and hangs

Each is a skeleton (polylines of points with a radius, in metres, y up) skinned with Blender's Skin
modifier, subdivided once, roughened along its normals with ridged noise (burnt bark splits in
plates, and a break is never clean) and decimated. Every vertex carries what the theme shades it
by: its smoothed normal, and `tip`, 0 on the trunk rising to 1 at a broken end, where the wood
still smoulders.

The export is one module, src/themes/pyrestorm/pyrestorm-snag-models.js: base64 typed arrays, no
loader and no asset file. Deterministic: the same script and Blender write the same bytes.
"""

import base64
import json
import math
import random
import sys
from array import array
from pathlib import Path

import bpy
from mathutils import Vector, noise

TAG = "[pyrestorm-snags]"
SCENE = "PyrestormSnags"
MODULE = "pyrestorm-snag-models.js"
#: Positions are Int16 in units of QUANT metres (a snag stands at most ~16 m).
QUANT = 1.0 / 1024.0


# ── The designs: skeletons in game space (x right, y up, z toward the eye), metres ──────────────

def wobble(rng, amount):
    return (rng.uniform(-amount, amount), rng.uniform(-amount, amount))


def limb(rng, start, direction, length, r0, r1, steps=5, sag=0.0, bend=0.25, lift=0.0):
    """A run of points from `start` along `direction`, wandering; `sag` pulls it down, `lift` up."""
    d = Vector(direction).normalized()
    p = Vector(start)
    out = [(p.x, p.y, p.z, r0)]
    for i in range(1, steps + 1):
        f = i / steps
        d = (d + Vector((rng.uniform(-bend, bend), rng.uniform(-bend, bend) - sag * f + lift * f,
                         rng.uniform(-bend, bend)))).normalized()
        p = p + d * (length / steps)
        out.append((p.x, p.y, p.z, r0 + (r1 - r0) * f))
    return out


def trunk(rng, height, r0, r1, lean=(0.0, 0.0), steps=7, sway=0.12):
    out = []
    x = z = 0.0
    for i in range(steps + 1):
        f = i / steps
        if i:
            wx, wz = wobble(rng, sway)
            x += wx + lean[0] * height / steps
            z += wz + lean[1] * height / steps
        # A flared foot, then a slow taper.
        r = r0 * (1.0 + 0.55 * math.exp(-f * 9.0)) + (r1 - r0) * f
        out.append((x, f * height, z, r))
    # The roots: a short stub under the ground so the foot never floats on a slope.
    out.insert(0, (out[0][0], -0.8, out[0][2], out[0][3] * 0.9))
    return out


def at(branch, f):
    """The point a fraction of the way up a branch (linear between its points)."""
    k = max(0.0, min(0.999, f)) * (len(branch) - 1)
    i = int(k)
    t = k - i
    a = branch[i]
    b = branch[i + 1]
    return tuple(a[c] + (b[c] - a[c]) * t for c in range(3))


def stubs(rng, t, count, lo=0.22, hi=0.9, length=(0.5, 1.5), radius=(0.07, 0.13)):
    """Broken-off limbs along a trunk: short, each its own way round, a little upward."""
    out = []
    for k in range(count):
        f = lo + (hi - lo) * (k + rng.uniform(0.15, 0.85)) / count
        a = rng.uniform(0.0, math.tau)
        r = rng.uniform(*radius) * (1.25 - 0.5 * f)
        out.append(limb(rng, at(t, f), (math.cos(a), rng.uniform(0.25, 0.8), math.sin(a) * 0.6),
                        rng.uniform(*length) * (1.2 - 0.5 * f), r, r * 0.55, steps=2, bend=0.2))
    return out


def broken_top(rng, t, teeth=2):
    """A break is never clean: splinters stand over it, one taller than the rest."""
    top = at(t, 0.985)
    r = t[-1][3]
    out = []
    for k in range(teeth):
        a = rng.uniform(0.0, math.tau)
        out.append(limb(rng, (top[0] + math.cos(a) * r * 0.5, top[1] - r, top[2] + math.sin(a) * r * 0.5),
                        (math.cos(a) * 0.18, 1.0, math.sin(a) * 0.18), r * rng.uniform(2.2, 5.5) * (1.0 if k else 1.4),
                        r * 0.55, r * 0.12, steps=2, bend=0.08))
    return out


def design_spire(rng):
    t = trunk(rng, 14.0, 0.58, 0.24, lean=(0.03, 0.0), sway=0.22)
    return [t] + stubs(rng, t, 6, length=(0.6, 2.4)) + broken_top(rng, t, 3)


def design_fork(rng):
    t = trunk(rng, 7.0, 0.7, 0.46, lean=(-0.05, 0.0), steps=5, sway=0.2)
    crotch = at(t, 0.93)
    left = limb(rng, crotch, (-0.5, 1.0, 0.1), 6.4, 0.36, 0.17, steps=6, bend=0.22, lift=0.15)
    right = limb(rng, crotch, (0.75, 1.0, -0.15), 3.8, 0.33, 0.19, steps=4, bend=0.22, lift=0.1)
    return [t, left, right] + stubs(rng, t, 2, length=(0.5, 1.3)) + stubs(rng, left, 3, lo=0.3, length=(0.4, 1.2), radius=(0.05, 0.09))         + broken_top(rng, left, 2) + broken_top(rng, right, 2)


def design_lean(rng):
    t = trunk(rng, 10.5, 0.56, 0.2, lean=(0.32, 0.05), steps=7, sway=0.2)
    back = limb(rng, at(t, 0.58), (-1.0, 0.4, 0.0), 5.0, 0.22, 0.09, steps=6, bend=0.2, sag=0.14)
    return [t, back] + stubs(rng, t, 4, length=(0.5, 1.6)) + stubs(rng, back, 2, lo=0.3, length=(0.3, 0.9), radius=(0.04, 0.07))         + broken_top(rng, t, 2)


def design_candelabra(rng):
    t = trunk(rng, 7.6, 0.78, 0.5, steps=5, sway=0.14)
    a = limb(rng, at(t, 0.5), (-1.0, 0.25, 0.1), 5.2, 0.3, 0.12, steps=6, bend=0.14, lift=0.5)
    b = limb(rng, at(t, 0.7), (1.0, 0.3, -0.1), 4.4, 0.27, 0.12, steps=6, bend=0.14, lift=0.5)
    c = limb(rng, at(t, 0.93), (0.12, 1.0, 0.1), 3.8, 0.4, 0.16, steps=4, bend=0.18)
    return [t, a, b, c] + stubs(rng, t, 2, length=(0.4, 1.0)) + stubs(rng, a, 2, lo=0.4, length=(0.3, 0.9), radius=(0.04, 0.07))         + broken_top(rng, c, 2) + broken_top(rng, a, 1) + broken_top(rng, b, 1)


def design_stump(rng):
    t = trunk(rng, 2.6, 0.95, 0.74, steps=4, sway=0.08)
    top = at(t, 0.97)
    teeth = []
    for k, (dx, dz, h, r) in enumerate(((-0.4, 0.1, 2.6, 0.3), (0.32, -0.15, 1.2, 0.26), (0.05, 0.3, 0.7, 0.22), (-0.1, -0.3, 1.7, 0.2))):
        teeth.append(limb(rng, (top[0] + dx, top[1] - 0.3, top[2] + dz), (dx * 0.25, 1.0, dz * 0.25), h, r, 0.05, steps=3, bend=0.1))
    return [t] + teeth + stubs(rng, t, 1, lo=0.4, hi=0.7, length=(0.5, 0.9))


def design_hook(rng):
    t = trunk(rng, 9.6, 0.44, 0.2, lean=(-0.09, 0.0), steps=7, sway=0.26)
    over = limb(rng, at(t, 0.96), (1.0, 0.3, 0.0), 3.8, 0.19, 0.07, steps=6, bend=0.1, sag=0.7)
    return [t, over] + stubs(rng, t, 5, length=(0.4, 1.5), radius=(0.05, 0.1))


DESIGNS = {
    "spire": (design_spire, 760),
    "fork": (design_fork, 820),
    "lean": (design_lean, 700),
    "candelabra": (design_candelabra, 860),
    "stump": (design_stump, 420),
    "hook": (design_hook, 620),
}


# ── Skinning ─────────────────────────────────────────────────────────────────────

def to_blender(p):
    """Game (x right, y up, z toward the eye) → Blender (x right, y away, z up)."""
    return (p[0], -p[2], p[1])


def to_game(v):
    return (v.x, v.z, -v.y)


def skin(scene, name, branches, triangles, seed):
    verts = []
    edges = []
    radii = []
    roots = []
    for branch in branches:
        base = len(verts)
        roots.append(base)
        for i, p in enumerate(branch):
            verts.append(to_blender(p))
            radii.append(p[3])
            if i:
                edges.append((base + i - 1, base + i))
    mesh = bpy.data.meshes.new(name + "Skeleton")
    mesh.from_pydata(verts, edges, [])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    skin_mod = obj.modifiers.new("Skin", "SKIN")
    skin_mod.use_smooth_shade = True
    layer = mesh.skin_vertices[0].data
    for i, r in enumerate(radii):
        layer[i].radius = (r, r)
        layer[i].use_root = i in roots
    sub = obj.modifiers.new("Subdivision", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    # The modifiers need the object in the active view layer's depsgraph.
    evaluated = obj.evaluated_get(scene.view_layers[0].depsgraph)
    fine = bpy.data.meshes.new_from_object(evaluated)
    fine.name = name + "Fine"
    # Burnt bark: plates parted by splits, deeper toward a broken end (a break is never clean).
    tips = tip_values(branches, [to_game(v.co) for v in fine.vertices])
    rng_offset = Vector((seed * 3.7, seed * 1.3, seed * 5.1))
    for v, tip in zip(fine.vertices, tips):
        p = Vector(to_game(v.co))
        n = v.normal.copy()
        plates = 1.0 - abs(noise.noise(Vector((p.x * 2.6, p.y * 0.55, p.z * 2.6)) + rng_offset))
        grain = noise.noise(Vector((p.x * 7.0, p.y * 2.2, p.z * 7.0)) + rng_offset * 2.0)
        ragged = noise.noise(Vector((p.x * 3.3, p.y * 3.3, p.z * 3.3)) - rng_offset) * tip * tip
        v.co = v.co + n * (-(plates ** 5) * 0.11 + grain * 0.035 + ragged * 0.1)
    fine.update()
    rough = bpy.data.objects.new(name + "Rough", fine)
    scene.collection.objects.link(rough)
    fine_tris = sum(len(p.vertices) - 2 for p in fine.polygons)
    decimate = rough.modifiers.new("Decimate", "DECIMATE")
    decimate.ratio = min(1.0, triangles / max(1, fine_tris))
    decimate.use_collapse_triangulate = True
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    low = bpy.data.meshes.new_from_object(rough.evaluated_get(scene.view_layers[0].depsgraph))
    low.name = name + "Mesh"
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.objects.remove(rough, do_unlink=True)
    final = bpy.data.objects.new(name, low)
    scene.collection.objects.link(final)
    for poly in low.polygons:
        poly.use_smooth = True
    low.update()
    low.calc_loop_triangles()
    vertices = [to_game(v.co) for v in low.vertices]
    normals = [to_game(v.normal) for v in low.vertices]
    tris = []
    for tri in low.loop_triangles:
        # Blender → game is a turn about x (no mirror): the winding stands.
        tris.append(tuple(tri.vertices))
    height = max(v[1] for v in vertices)
    return {
        "design": name,
        "object": final,
        "vertices": vertices,
        "normals": normals,
        "tip": tip_values(branches, vertices),
        "triangles": tris,
        "height": height,
    }


def tip_values(branches, points):
    """0 on the trunk rising to 1 at a broken end: by the nearest skeleton segment."""
    out = []
    for p in points:
        best = 1e9
        value = 0.0
        P = Vector(p)
        for b, branch in enumerate(branches):
            n = len(branch) - 1
            for i in range(n):
                A = Vector(branch[i][:3])
                B = Vector(branch[i + 1][:3])
                AB = B - A
                t = max(0.0, min(1.0, (P - A).dot(AB) / max(1e-9, AB.dot(AB))))
                d = (P - (A + AB * t)).length
                if d < best:
                    best = d
                    along = (i + t) / n
                    # The trunk smoulders only at its break; a limb along its outer half.
                    start = 0.86 if b == 0 else 0.45
                    value = max(0.0, min(1.0, (along - start) / (1.0 - start)))
        out.append(value)
    return out


# ── The module the theme imports ──────────────────────────────────────────────

def b64(typecode, values):
    a = array(typecode, values)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def write_module(path, models):
    lines = [
        "/* eslint-disable */",
        "/**",
        " * Pyrestorm's snags: GENERATED by scripts/blender/pyrestorm_snags.py (do not edit by hand).",
        " *",
        " * Six charred trees built by script in Blender (a skeleton skinned, roughened and decimated).",
        " * Each stands on the origin, y up, in metres (`height` is its top); its trunk runs 0.8 m under",
        " * the ground so its foot never floats on a slope. `positions` are Int16 in units of `quant`;",
        " * `normals` Int8 (smoothed, x127); `tip` Uint8 (0 on the trunk rising to 255 at a broken end,",
        " * where the wood still smoulders); `index` Uint16 triangles, wound counter-clockwise seen from",
        " * outside.",
        " */",
        "export const PYRESTORM_SNAG_MODELS = Object.freeze({",
        f"    quant: {QUANT!r},",
        f"    designs: {json.dumps([m['design'] for m in models])},",
        "    models: [",
    ]
    for model in models:
        positions = [int(round(c / QUANT)) for v in model["vertices"] for c in v]
        normals = [int(round(max(-1.0, min(1.0, c)) * 127)) for n in model["normals"] for c in n]
        tip = [int(round(max(0.0, min(1.0, t)) * 255)) for t in model["tip"]]
        index = [int(i) for t in model["triangles"] for i in t]
        lines += [
            "        {",
            f"            design: {json.dumps(model['design'])},",
            f"            height: {round(model['height'], 3)!r},",
            f"            vertexCount: {len(model['vertices'])},",
            f"            triangleCount: {len(model['triangles'])},",
            f"            positions: '{b64('h', positions)}',",
            f"            normals: '{b64('b', normals)}',",
            f"            tip: '{b64('B', tip)}',",
            f"            index: '{b64('H', index)}',",
            "        },",
        ]
    lines += ["    ],", "});", ""]
    Path(path).write_text("\n".join(lines), encoding="utf-8", newline="\n")


# ── Previews: the row of designs as silhouettes against a glow ───────────────────

def previews(scene, models, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    x = 0.0
    for model in models:
        model["object"].location = (x, 0.0, 0.0)
        x += 7.5
    width = x - 7.5
    cam_data = bpy.data.cameras.new("SnagCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = width + 12.0
    cam = bpy.data.objects.new("SnagCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (width / 2, -60.0, 7.0)
    cam.rotation_euler = (math.radians(90), 0.0, 0.0)
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 600
    scene.render.film_transparent = False
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.02, 0.015, 0.012)
    world = bpy.data.worlds.new("SnagGlow")
    world.color = (0.9, 0.32, 0.06)
    scene.world = world
    scene.display.shading.background_type = "WORLD"
    files = []
    for name, flat in (("silhouette", True), ("form", False)):
        if not flat:
            scene.display.shading.light = "STUDIO"
            scene.display.shading.single_color = (0.35, 0.33, 0.31)
            world.color = (0.05, 0.05, 0.06)
        out = directory / f"pyrestorm-snags-{name}.png"
        scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        files.append(str(out))
    return files


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = None
    preview_dir = None
    for i, a in enumerate(argv):
        if a == "--out":
            out = argv[i + 1]
        if a == "--preview":
            preview_dir = argv[i + 1]
    scene = bpy.data.scenes.new(SCENE)
    bpy.context.window.scene = scene
    models = []
    report = {}
    for seed, (name, (design, triangles)) in enumerate(DESIGNS.items()):
        rng = random.Random(0x5a9 + seed * 101)
        model = skin(scene, name, design(rng), triangles, seed + 1)
        models.append(model)
        report[name] = {"vertices": len(model["vertices"]), "triangles": len(model["triangles"]),
                        "height": round(model["height"], 2)}
    if out:
        path = Path(out) / MODULE
        write_module(path, models)
        print(TAG, "wrote", path, f"{path.stat().st_size / 1024:.1f} KiB")
    if preview_dir:
        for f in previews(scene, models, preview_dir):
            print(TAG, "preview", f)
    print(TAG, json.dumps(report))


if __name__ == "__main__":
    main()
