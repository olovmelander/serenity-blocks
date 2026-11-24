"""Odyssey's forest floor, modelled and baked in Blender: one tile of litter seen from straight above.

Run headless (nothing in an open Blender session is touched):

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_floor.py -- \
        --out src/rendering/odyssey/assets/ground/floor.png [--samples 24] [--res 1024]

WHY. Under the Greenwood the ground was the meadow's turf, dimmed. A wood's floor is a different thing:
last year's leaves lying in drifts, twigs fallen across them, cushions of moss on what is old. This models
exactly that and photographs it from above, as odyssey_meadow.py does the turf.

THE SCENE. A square `TILE` metres a side: lobed and oval leaves, each curled and tilted its own way, lying
thick in the drifts and thin on the bare soil between; twigs and a few fallen sticks; cushions of moss, each
a low dome of small shoots; a scatter of seedlings. Everything within a margin of an edge is also placed one
tile over, so the photograph tiles without a seam.

THE BAKE (Cycles, CPU, orthographic, straight down), two renders:
  1. LIGHT: every leaf its own pale or dark, the soil dark, under an even white sky and nothing else.
  2. KEYS: the moss and seedlings one colour, the newly fallen leaves another, everything else black.

OUTPUT, one RGB PNG (8-bit linear data, not colour; rendered at twice the size and averaged down):
  R  the litter's light (the shader divides by the tile's mean: it adds texture, not a shift of colour)
  G  moss and seedlings
  B  leaves newly fallen (the shader gives them the wood's own colour)
Deterministic: the same seed writes the same scene.
"""

import argparse
import math
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import odyssey_meadow as meadow  # noqa: E402

TAG = "[odyssey-floor]"
TILE = 16.0
MARGIN = 1.6
SEED = 20261124

OAK = [(0.0, 0.0), (0.10, 0.10), (0.20, 0.20), (0.15, 0.30), (0.30, 0.42), (0.22, 0.52), (0.33, 0.66), (0.22, 0.76), (0.24, 0.88), (0.10, 0.97),
       (0.0, 1.0)]
OVATE = [(0.0, 0.0), (0.20, 0.16), (0.32, 0.36), (0.33, 0.54), (0.25, 0.74), (0.11, 0.91), (0.0, 1.0)]


def wrapped(x, y, margin=MARGIN):
    xs = [x] + ([x + TILE] if x < margin else []) + ([x - TILE] if x > TILE - margin else [])
    ys = [y] + ([y + TILE] if y < margin else []) + ([y - TILE] if y > TILE - margin else [])
    return [(a, b) for a in xs for b in ys]


def tiling_noise(rng, cells, octaves=3):
    """A smooth noise over the tile that wraps: f(x, y) -> 0..1."""
    grids = [rng.uniform(size=(cells * 2 ** o, cells * 2 ** o)) for o in range(octaves)]

    def f(x, y):
        out, amp, tot = 0.0, 1.0, 0.0
        for g in grids:
            n = g.shape[0]
            u, v = (x / TILE % 1) * n, (y / TILE % 1) * n
            i, j = int(u) % n, int(v) % n
            a, b = u - int(u), v - int(v)
            a, b = a * a * (3 - 2 * a), b * b * (3 - 2 * b)
            i1, j1 = (i + 1) % n, (j + 1) % n
            out += amp * ((g[j, i] * (1 - a) + g[j, i1] * a) * (1 - b) + (g[j1, i] * (1 - a) + g[j1, i1] * a) * b)
            tot += amp
            amp *= 0.55
        return out / tot
    return f


class Pile:
    """One mesh with a light a face corner carries."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def add(self, verts, faces, light):
        base = len(self.v)
        self.v.extend([tuple(map(float, p)) for p in verts])
        self.f.extend([tuple(i + base for i in f) for f in faces])
        self.c.extend([float(light)] * len(verts))

    def build(self, name, material):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.v, [], self.f)
        att = mesh.attributes.new("light", "FLOAT", "POINT")
        att.data.foreach_set("value", np.array(self.c, dtype=np.float32))
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def rot(yaw, pitch, roll):
    cy, sy, cp, sp, cr, sr = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch), math.cos(roll), math.sin(roll)
    Rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    Ry = np.array([[cr, 0, sr], [0, 1, 0], [-sr, 0, cr]])
    return Rz @ Rx @ Ry


def litter_leaf(pile, rng, x, y, z, length, outline, light):
    """A fallen leaf: its blade bent along the rib, its edges curled up or down."""
    width = length * (1.1 if outline is OAK else 1.0)
    bend = rng.normal() * 0.55
    cup = rng.normal() * 0.9
    M = rot(rng.uniform(0, math.tau), rng.normal() * 0.35, rng.normal() * 0.45)
    verts, faces = [], []
    n = len(outline)
    for s in (0, -1, 1):
        for px, py in outline:
            w = abs(px) * s
            verts.append(M @ np.array([w * width, (py - 0.5) * length, (bend * (py - 0.5) ** 2 + cup * w * w * 2.2) * length]))
    for si, flip in ((1, False), (2, True)):
        o = n * si
        for k in range(n - 1):
            q = (k, k + 1, o + k + 1, o + k)
            faces.append(tuple(reversed(q)) if flip else q)
    verts = np.array(verts)
    verts[:, 2] -= verts[:, 2].min()
    for a, b in wrapped(x, y):
        pile.add(verts + np.array([a, b, z]), faces, light)


def stick(pile, rng, x, y, length, r, light):
    yaw = rng.uniform(0, math.tau)
    pts = []
    n = 6
    off = 0.0
    for k in range(n + 1):
        t = k / n - 0.5
        off += rng.normal() * 0.03 * length
        pts.append(np.array([math.cos(yaw) * t * length - math.sin(yaw) * off, math.sin(yaw) * t * length + math.cos(yaw) * off,
                             r + 0.16 + 0.05 * rng.uniform()]))
    verts, faces = [], []
    for k, p in enumerate(pts):
        rr = r * (1 - 0.6 * k / n)
        d = np.array([-math.sin(yaw), math.cos(yaw), 0])
        for q in range(5):
            a = math.tau * q / 5
            verts.append(p + d * math.cos(a) * rr + np.array([0, 0, math.sin(a) * rr]))
    for k in range(n):
        for q in range(5):
            a, b = k * 5 + q, k * 5 + (q + 1) % 5
            faces.append((a, b, b + 5, a + 5))
    for a, b in wrapped(x, y, MARGIN + length):
        pile.add(np.array(verts) + np.array([a, b, 0]), faces, light)


def moss_cushion(pile, rng, x, y, r):
    """A cushion: a few low domes run together, their skin rough with shoots."""
    for k in range(5):
        a, q = rng.uniform(0, math.tau), (0 if k == 0 else r * rng.uniform(0.35, 0.8))
        rr = r * (0.75 if k == 0 else rng.uniform(0.28, 0.55))
        cx, cy = math.cos(a) * q, math.sin(a) * q
        rings, seg = 7, 22
        base = 0.50 + 0.26 * rng.uniform()
        verts = [np.array([cx, cy, rr * 0.46 + 0.04])]
        for ring in range(1, rings + 1):
            u = ring / rings
            for g in range(seg):
                t = math.tau * (g + 0.5 * (ring % 2)) / seg
                wob = 1 + 0.10 * math.sin(3 * t + a) + 0.07 * math.sin(7 * t + 2 * a)
                d = rr * u * wob
                z = rr * 0.46 * math.sqrt(max(0.0, 1 - u * u)) + rng.normal() * 0.016 + 0.03 * (1 - u)
                verts.append(np.array([cx + math.cos(t) * d, cy + math.sin(t) * d, z - (0.04 if ring == rings else 0)]))
        faces = [(0, 1 + g, 1 + (g + 1) % seg) for g in range(seg)]
        for ring in range(rings - 1):
            for g in range(seg):
                p0 = 1 + ring * seg + g
                p1 = 1 + ring * seg + (g + 1) % seg
                faces.append((p0, p0 + seg, p1 + seg, p1))
        for a2, b2 in wrapped(x, y):
            pile.add(np.array(verts) + np.array([a2, b2, 0]), faces, base)
    for _ in range(int(120 * r)):
        a, q = rng.uniform(0, math.tau), math.sqrt(rng.uniform()) * r * 0.95
        s = 0.016 + 0.014 * rng.uniform()
        h = r * 0.34 * math.sqrt(max(0.0, 1 - (q / r) ** 2)) + 0.05
        c = np.array([math.cos(a) * q, math.sin(a) * q, h])
        verts = [c + np.array([0, 0, s * 2])] + [c + np.array([math.cos(math.tau * k / 5) * s, math.sin(math.tau * k / 5) * s, 0]) for k in range(5)]
        for a2, b2 in wrapped(x, y):
            pile.add(np.array(verts) + np.array([a2, b2, 0]), [(0, 1 + k, 1 + (k + 1) % 5) for k in range(5)], 0.66 + 0.3 * rng.uniform())


def seedling(pile, rng, x, y, size):
    for k in range(int(rng.integers(3, 7))):
        a = k * 2.39996 + rng.uniform(-0.3, 0.3)
        L = size * rng.uniform(0.7, 1.2)
        M = rot(a, rng.normal() * 0.2 - 0.25, rng.normal() * 0.2)
        verts, faces = [], []
        n = len(OVATE)
        for s in (0, -1, 1):
            for px, py in OVATE:
                verts.append(M @ np.array([px * s * L * 1.1, py * L, 0.22 + 0.05 * py * L]))
        for si, flip in ((1, False), (2, True)):
            for j in range(n - 1):
                q = (j, j + 1, n * si + j + 1, n * si + j)
                faces.append(tuple(reversed(q)) if flip else q)
        light = 0.62 + 0.34 * rng.uniform()
        for p, q in wrapped(x, y):
            pile.add(np.array(verts) + np.array([p, q, 0]), faces, light)


def light_material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    df = nt.nodes.new("ShaderNodeBsdfDiffuse")
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "light"
    nt.links.new(at.outputs["Fac"], df.inputs["Color"])
    nt.links.new(df.outputs[0], out.inputs[0])
    return mat


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--res", type=int, default=1024, help="render size (the file is half)")
    parser.add_argument("--scratch", default=None)
    args = parser.parse_args(argv)
    out = Path(args.out)
    scratch = Path(args.scratch) if args.scratch else Path(tempfile.mkdtemp(prefix="odyssey-floor-"))
    scratch.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.seed = 7
    scene.cycles.use_denoising = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "16"
    scene.view_settings.view_transform = "Standard"
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.look = "None"

    rng = np.random.default_rng(SEED)
    drift = tiling_noise(rng, 5)
    tone = tiling_noise(rng, 7)
    mossy = tiling_noise(rng, 4)
    lit = light_material("floor-light")

    old, fresh, moss, sticks = Pile(), Pile(), Pile(), Pile()
    # The litter, lowest first: each layer lies on the one before.
    LEAVES = 46000
    for k in range(LEAVES):
        x, y = rng.uniform(0, TILE, 2)
        d = drift(x, y)
        if rng.uniform() > 0.45 + 1.1 * (d - 0.30) / 0.5:
            continue
        light = np.clip(0.20 + 0.56 * rng.uniform() ** 1.2 + 0.75 * (tone(x, y) - 0.5) + 0.35 * (d - 0.5), 0.08, 0.97)
        outline = OAK if rng.uniform() < 0.55 else OVATE
        litter_leaf(old, rng, x, y, 0.01 + 0.16 * (k / LEAVES) * (0.3 + d), 0.21 * rng.uniform(0.65, 1.3), outline, light)
    for k in range(1100):
        x, y = rng.uniform(0, TILE, 2)
        if rng.uniform() > 0.35 + 0.9 * (drift(x, y) - 0.3):
            continue
        litter_leaf(fresh, rng, x, y, 0.19, 0.21 * rng.uniform(0.75, 1.25), OAK if rng.uniform() < 0.5 else OVATE, 0.66 + 0.3 * rng.uniform())
    for _ in range(170):
        x, y = rng.uniform(0, TILE, 2)
        stick(sticks, rng, x, y, rng.uniform(0.35, 1.0), rng.uniform(0.010, 0.022), 0.34 + 0.4 * rng.uniform())
    for _ in range(15):
        x, y = rng.uniform(0, TILE, 2)
        stick(sticks, rng, x, y, rng.uniform(1.3, 2.4), rng.uniform(0.035, 0.07), 0.30 + 0.25 * rng.uniform())
    placed = 0
    for x, y in meadow.poisson(rng, TILE, 0.80):
        m = mossy(x, y)
        if m < 0.52:
            continue
        moss_cushion(moss, rng, x, y, (0.20 + 0.62 * (m - 0.52) / 0.3) * rng.uniform(0.7, 1.15))
        placed += 1
    for _ in range(360):
        x, y = rng.uniform(0, TILE, 2)
        if drift(x, y) > 0.62 or rng.uniform() < 0.3:
            continue
        seedling(moss, rng, x, y, rng.uniform(0.14, 0.28))
    objs = {"old": old.build("litter", lit), "fresh": fresh.build("fresh", lit), "moss": moss.build("moss", lit),
            "sticks": sticks.build("sticks", lit)}
    ground = Pile()
    ground.add([(-3, -3, 0), (TILE + 3, -3, 0), (TILE + 3, TILE + 3, 0), (-3, TILE + 3, 0)], [(0, 1, 2, 3)], 0.14)
    soil = ground.build("soil", lit)
    print(f"{TAG} litter {len(old.f)} faces, fresh {len(fresh.f)}, moss {len(moss.f)} ({placed} cushions), sticks {len(sticks.f)}")

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = TILE
    cam.location = (TILE / 2, TILE / 2, 6.0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    scene.world = world
    meadow.render(scratch / "floor-light.png", args.res, args.samples)

    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    black = meadow.emission("black", (0, 0, 0), 0.0)
    for o in (objs["old"], objs["sticks"], soil):
        meadow.set_material(o, black)
    meadow.set_material(objs["moss"], meadow.emission("key-moss", (0.0, 1.0, 0.0)))
    meadow.set_material(objs["fresh"], meadow.emission("key-fresh", (0.0, 0.0, 1.0)))
    meadow.render(scratch / "floor-keys.png", args.res, max(8, args.samples // 3))

    def load(path):
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
        bpy.data.images.remove(img)
        return px[::-1]

    light = load(scratch / "floor-light.png")[..., 0]
    keys = load(scratch / "floor-keys.png")
    n = args.res // 2

    def down(a):
        return a.reshape(n, 2, n, 2).mean(axis=(1, 3))

    value = down(light)
    lo, hi = np.percentile(value, [0.5, 99.7])
    value = np.clip((value - lo) / (hi - lo), 0, 1)
    value = (np.floor(value * 47.999) + 0.5) / 48.0
    g = np.round(down(np.clip(keys[..., 1], 0, 1)) * 15) / 15
    b = np.round(down(np.clip(keys[..., 2], 0, 1)) * 15) / 15
    rgb8 = np.round(np.stack([value, g, b], axis=2) * 255).astype(np.uint8)
    out.parent.mkdir(parents=True, exist_ok=True)
    meadow.write_png(out, rgb8)
    print(f"{TAG} wrote {out} {n}x{n} (mean {float(value.mean()):.3f}, moss {float(g.mean()):.3f}, fresh {float(b.mean()):.3f}, "
          f"{out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
