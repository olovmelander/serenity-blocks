"""Odyssey's meadow, modelled and baked in Blender: one tile of turf seen from straight above.

Run headless (nothing in an open Blender session is touched):

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_meadow.py -- \
        --out src/rendering/odyssey/assets/ground/meadow.png [--samples 48] [--res 512]

or, in a container without Blender, with Blender as a Python module (`pip install bpy==5.2.4`):

    python scripts/blender/odyssey/odyssey_meadow.py --out ...

WHY A MODELLED MEADOW. The ground's grass was a value-noise stroke field, quiet by design and
finer than a pixel from the rail, so from 50-150 u the meadows read as felt: one green with soft
streaks. A meadow seen from a hill is tussocks (light tips, dark ground between them) and drifts
of flowers; this models exactly that and photographs it from above, so the paint the ground lays
over its colour is the shadow pattern of real tufts, not a noise.

THE SCENE. A square of turf `TILE` metres a side: tussocks of curved, tapering blades leaning out
from their crowns, Poisson-spaced, of three sizes; thin seed stalks; and flowers (buttercup,
ox-eye daisy, red clover, harebell) held above the blades on stalks, in clumps. Everything within
a margin of an edge is also placed one tile over, so the photograph tiles without a seam.

THE BAKE (Cycles, CPU, orthographic, straight down), two renders:
  1. TURF: every blade white, the soil between them dark, lit by an even white sky and nothing
     else, so the value is how much sky each point of the turf sees: bright tips, dark hollows,
     with no sun direction baked in (the game lights the ground itself).
  2. FLOWERS: each species emits its own key colour on black, the blades black and opaque, so a
     flower shows only where it stands clear of the grass.

OUTPUT, one RGB PNG (8-bit, linear data, not colour; rendered at twice the size and averaged
down, the turf held to 64 levels so the file stays small):
  R  turf value (the shader divides by the tile's mean, so it adds texture and never shifts the
     painted colour: the Wolfire division the ground atlas already uses)
  G  flower coverage
  B  which flower (0.2 buttercup, 0.45 daisy, 0.7 clover, 0.95 harebell; the game paints them)
Deterministic: the same seed writes the same scene (the renders are seeded too).
"""

import argparse
import math
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
import numpy as np

TAG = "[odyssey-meadow]"
TILE = 16.0            # metres a side (world units: the ground reads it at xz / TILE)
MARGIN = 1.2           # objects this close to an edge are repeated one tile over
SEED = 20261122

# Flowers: (name, key colour for the bake, B value written, head radius m, stalk height m)
FLOWERS = (
    ("buttercup", (1.0, 0.0, 0.0), 0.20, 0.060, (0.34, 0.5)),
    ("daisy", (0.0, 1.0, 0.0), 0.45, 0.070, (0.32, 0.46)),
    ("clover", (0.0, 0.0, 1.0), 0.70, 0.055, (0.2, 0.3)),
    ("harebell", (1.0, 1.0, 0.0), 0.95, 0.045, (0.3, 0.42)),
)


def poisson(rng, size, radius, tries=30):
    """Bridson's Poisson disc in a size x size square that wraps (so the tile tiles)."""
    cell = radius / math.sqrt(2)
    n = int(math.ceil(size / cell))
    grid = -np.ones((n, n), dtype=int)
    points = []
    active = []

    def fits(p):
        gx, gy = int(p[0] / cell) % n, int(p[1] / cell) % n
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                q = grid[(gx + dx) % n, (gy + dy) % n]
                if q >= 0:
                    d = np.abs(points[q] - p)
                    d = np.minimum(d, size - d)
                    if d[0] * d[0] + d[1] * d[1] < radius * radius:
                        return False
        return True

    first = rng.uniform(0, size, 2)
    points.append(first)
    grid[int(first[0] / cell) % n, int(first[1] / cell) % n] = 0
    active.append(0)
    while active:
        i = active[int(rng.integers(len(active)))]
        found = False
        for _ in range(tries):
            a = rng.uniform(0, math.tau)
            r = rng.uniform(radius, 2 * radius)
            p = (points[i] + np.array([math.cos(a), math.sin(a)]) * r) % size
            if fits(p):
                points.append(p)
                grid[int(p[0] / cell) % n, int(p[1] / cell) % n] = len(points) - 1
                active.append(len(points) - 1)
                found = True
                break
        if not found:
            active.remove(i)
    return np.array(points)


def copies(x, y):
    """The positions an object at (x, y) is drawn at so the tile wraps."""
    xs = [x] + ([x + TILE] if x < MARGIN else []) + ([x - TILE] if x > TILE - MARGIN else [])
    ys = [y] + ([y + TILE] if y < MARGIN else []) + ([y - TILE] if y > TILE - MARGIN else [])
    return [(a, b) for a in xs for b in ys]


class MeshBuilder:
    def __init__(self):
        self.verts = []
        self.faces = []

    def blade(self, root, direction, height, width, lean, curl, segments=4):
        """A tapering blade: a strip from `root` up and out along `direction`, bending over."""
        side = np.array([-direction[1], direction[0], 0.0])
        base = len(self.verts)
        for s in range(segments + 1):
            t = s / segments
            out = lean * (t ** 1.6) + curl * (t ** 3)
            p = np.array([root[0], root[1], 0.0]) + np.array([direction[0], direction[1], 0.0]) * out
            p[2] = height * (t - 0.18 * curl * t * t)
            w = width * (1.0 - t) ** 0.9 + 0.002
            self.verts.append(tuple(p - side * w))
            self.verts.append(tuple(p + side * w))
        for s in range(segments):
            a = base + 2 * s
            self.faces.append((a, a + 1, a + 3, a + 2))

    def disc(self, centre, radius, sides=7):
        base = len(self.verts)
        self.verts.append(tuple(centre))
        for k in range(sides):
            a = math.tau * k / sides
            self.verts.append((centre[0] + math.cos(a) * radius, centre[1] + math.sin(a) * radius, centre[2]))
        for k in range(sides):
            self.faces.append((base, base + 1 + k, base + 1 + (k + 1) % sides))

    def stalk(self, root, top, width=0.004):
        base = len(self.verts)
        d = np.array(top) - np.array(root)
        side = np.array([-d[1], d[0], 0.0])
        side = side / (np.linalg.norm(side) + 1e-9) * width
        self.verts += [tuple(np.array(root) - side), tuple(np.array(root) + side),
                       tuple(np.array(top) + side), tuple(np.array(top) - side)]
        self.faces.append((base, base + 1, base + 2, base + 3))

    def build(self, name):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.validate()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def grow_meadow(rng):
    grass = MeshBuilder()
    flowers = {name: MeshBuilder() for name, *_ in FLOWERS}
    # Tussocks: three sizes, Poisson-spaced, each a crown of blades leaning out.
    crowns = poisson(rng, TILE, 0.5)
    for cx, cy in crowns:
        lush = 0.5 + 1.0 * rng.random()
        blades = int(12 + 22 * lush)
        height = rng.uniform(0.2, 0.42) * (0.75 + 0.45 * lush)
        spin = rng.uniform(0, math.tau)
        for b in range(blades):
            a = spin + b * 2.39996 + rng.uniform(-0.3, 0.3)
            r0 = rng.uniform(0.0, 0.07)
            direction = np.array([math.cos(a), math.sin(a)])
            root = np.array([cx, cy]) + direction * r0
            h = height * rng.uniform(0.6, 1.15)
            for x, y in copies(root[0], root[1]):
                grass.blade((x, y), direction, h, rng.uniform(0.009, 0.018), rng.uniform(0.1, 0.34) + r0,
                            rng.uniform(0.0, 0.16))
        # A few seed stalks standing out of the larger tussocks.
        if lush > 1.0 and rng.random() < 0.5:
            top = (cx + rng.uniform(-0.05, 0.05), cy + rng.uniform(-0.05, 0.05), height * 1.7)
            for x, y in copies(cx, cy):
                grass.stalk((x, y, 0.0), (x + top[0] - cx, y + top[1] - cy, top[2]))
                grass.disc((x + top[0] - cx, y + top[1] - cy, top[2]), 0.018, 5)
    # Flowers: clumps of one species, each head on a stalk above the blades.
    clumps = poisson(rng, TILE, 0.95)
    weights = np.array([0.36, 0.30, 0.24, 0.10])
    for cx, cy in clumps:
        k = int(rng.choice(len(FLOWERS), p=weights / weights.sum()))
        name, _, _, head, stalk = FLOWERS[k]
        heads = int(rng.integers(8, 19))
        spread = rng.uniform(0.1, 0.2)
        for _ in range(heads):
            a = rng.uniform(0, math.tau)
            r = abs(rng.normal(0, spread))
            x0, y0 = cx + math.cos(a) * r, cy + math.sin(a) * r
            h = rng.uniform(*stalk)
            for x, y in copies(x0 % TILE, y0 % TILE):
                flowers[name].stalk((x, y, 0.0), (x, y, h), 0.003)
                flowers[name].disc((x, y, h), head * rng.uniform(0.8, 1.2), 8)
    return grass, flowers


def emission(name, rgb, strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*rgb, 1.0)
    em.inputs["Strength"].default_value = strength
    mat.node_tree.links.new(em.outputs[0], out.inputs[0])
    return mat


def diffuse(name, value):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    df = nodes.new("ShaderNodeBsdfDiffuse")
    df.inputs["Color"].default_value = (value, value, value, 1.0)
    mat.node_tree.links.new(df.outputs[0], out.inputs[0])
    return mat


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def render(path, res, samples):
    scene = bpy.context.scene
    scene.render.filepath = str(path)
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.cycles.samples = samples
    bpy.ops.render.render(write_still=True)


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--samples", type=int, default=48)
    parser.add_argument("--res", type=int, default=512, help="render size (the file is half)")
    parser.add_argument("--scratch", default=None)
    args = parser.parse_args(argv)
    out = Path(args.out)
    scratch = Path(args.scratch) if args.scratch else Path(tempfile.mkdtemp(prefix="odyssey-meadow-"))
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
    grass_b, flower_b = grow_meadow(rng)
    grass = grass_b.build("turf")
    flowers = {name: b.build(f"flowers-{name}") for name, b in flower_b.items()}
    ground_mesh = bpy.data.meshes.new("soil")
    ground_mesh.from_pydata([(-2, -2, 0), (TILE + 2, -2, 0), (TILE + 2, TILE + 2, 0), (-2, TILE + 2, 0)], [],
                            [(0, 1, 2, 3)])
    soil = bpy.data.objects.new("soil", ground_mesh)
    scene.collection.objects.link(soil)
    print(f"{TAG} turf {len(grass_b.faces)} faces; flowers "
          + ", ".join(f"{k} {len(b.faces)}" for k, b in flower_b.items()))

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = TILE
    cam.location = (TILE / 2, TILE / 2, 5.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)
    scene.collection.objects.link(cam)
    scene.camera = cam

    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
    scene.world = world

    # 1. TURF: white blades over dark soil under an even sky.
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    set_material(grass, diffuse("blade", 0.9))
    set_material(soil, diffuse("soil", 0.16))
    for obj in flowers.values():
        set_material(obj, diffuse("flower-as-grass", 0.9))
    render(scratch / "turf.png", args.res, args.samples)

    # 2. FLOWERS: each species its key colour, emissive, over black blades and soil, no sky.
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.0
    black = emission("black", (0.0, 0.0, 0.0), 0.0)
    set_material(grass, black)
    set_material(soil, black)
    for name, rgb, *_ in FLOWERS:
        set_material(flowers[name], emission(f"key-{name}", rgb, 1.0))
    render(scratch / "flowers.png", args.res, max(8, args.samples // 3))

    # Pack: R turf value, G flower coverage, B flower key; half the render size.
    def load(path):
        img = bpy.data.images.load(str(path))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
        bpy.data.images.remove(img)
        return px[::-1]   # Blender rows run bottom-up

    turf = load(scratch / "turf.png")
    flw = load(scratch / "flowers.png")
    value_hi = turf[..., 0]
    coverage_hi = np.clip(flw[..., :3].max(axis=2), 0.0, 1.0)
    key_hi = np.zeros_like(coverage_hi)
    r, g, b = flw[..., 0], flw[..., 1], flw[..., 2]
    for _, rgb, code, *_ in FLOWERS:
        target = np.array(rgb)
        match = (np.abs(r - target[0] * coverage_hi) < 0.25) & (np.abs(g - target[1] * coverage_hi) < 0.25) \
            & (np.abs(b - target[2] * coverage_hi) < 0.25) & (coverage_hi > 0.08)
        key_hi = np.where(match, code, key_hi)
    n = args.res // 2

    def down(a):
        return a.reshape(n, 2, n, 2).mean(axis=(1, 3))

    value = down(value_hi)
    value = (value - value.min()) / max(1e-6, value.max() - value.min())
    value = (np.floor(value * 63.999) + 0.5) / 64.0
    coverage = down(coverage_hi)
    # The key of each block is its most-covered texel's.
    blocks = coverage_hi.reshape(n, 2, n, 2).transpose(0, 2, 1, 3).reshape(n, n, 4)
    keys = key_hi.reshape(n, 2, n, 2).transpose(0, 2, 1, 3).reshape(n, n, 4)
    key = np.take_along_axis(keys, blocks.argmax(axis=2)[..., None], axis=2)[..., 0]
    rgb8 = np.round(np.stack([value, coverage, key], axis=2) * 255).astype(np.uint8)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_png(out, rgb8)
    print(f"{TAG} wrote {out} {n}x{n} (turf mean {float(value.mean()):.3f}, "
          f"flowers {float((coverage > 0.3).mean()):.2%}, {out.stat().st_size // 1024} KB)")


def write_png(path, rgb8):
    """A plain 8-bit RGB PNG with no colour chunks: the bytes are data and arrive unchanged."""
    h, w, _ = rgb8.shape
    raw = b"".join(b"\x00" + rgb8[row].tobytes() for row in range(h))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(argv)
