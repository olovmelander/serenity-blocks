"""Sculpt and bake Blood Moon's volcanic skyline. Blender -b -P this_file.

The orthographic plate stores direct moonlight, snow, distance through the
foothills and coverage. The game shades this relief again along the mirror ray.
"""
from pathlib import Path
import struct
import zlib

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


WIDTH, HEIGHT = 2560, 288
LEFT, RIGHT, TOP = -7.0, 3.0, 1.46


def noise(x, y, scale, seed):
    """Continuous, deterministic value noise in the mountain's ground plane."""
    x, y = x * scale + seed * 3.7, y * scale + seed * 1.3
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def lattice(dx, dy):
        h = np.sin((ix + dx) * 127.1 + (iy + dy) * 311.7 + seed) * 43758.5453
        return (h - np.floor(h)) * 2 - 1

    a = lattice(0, 0) * (1 - fx) + lattice(1, 0) * fx
    b = lattice(0, 1) * (1 - fx) + lattice(1, 1) * fx
    return a * (1 - fy) + b * fy


def elevation(x, y):
    # The drainage fan runs from the rim to the foot of the volcano. Its
    # bifurcating channels turn with radius, cutting much deeper on the front.
    dx, dy = x + 0.025, y - 0.15
    a = np.arctan2(dy, dx)
    radius = np.hypot(dx, dy * 0.95)
    rim = 0.097 + 0.010 * np.sin(a * 4.0) + 0.008 * np.sin(a * 7.0 + 0.6)
    r = np.maximum(radius - rim, 0)
    flank = np.maximum(1 - r / (1.54 + 0.27 * np.cos(2.0 * a + 0.65)), 0)
    fan = a + 0.22 * radius + 0.112 * np.sin(4 * a + 3 * radius)
    rib = (1 - np.abs(np.sin(fan * 4 + 1.35 * np.sin(3 * a)))) ** 2
    gullies = (1 - np.abs(np.sin(fan * 11 + 4.2 * radius))) ** 2
    arc = np.clip(r * 6, 0, 1) * flank
    summit = 1.04 * flank ** 1.65 + arc * (0.084 * rib - 0.043 * gullies)
    summit -= np.maximum(1 - radius / rim, 0) * 0.18
    # A notch on the front rim exposes the caldera. The east shoulder carries
    # an older peak and the collapsed lower flank opens into an amphitheatre.
    summit -= np.exp(-((dx - 0.008) / 0.055) ** 2 - ((dy + 0.075) / 0.093) ** 2) * 0.21
    # The south face broke out in a sector collapse. Two uneven headwalls stand
    # above its incised channel; the lower east apron exposes resistant lava beds.
    run = np.maximum(-dy, 0)
    gorge = 0.03 + 0.38 * run - 0.16 * run * run + 0.031 * np.sin(9 * run)
    scar = np.exp(-((x - gorge) / (0.047 + 0.23 * run)) ** 2)
    summit -= scar * np.clip(run * 5, 0, 1) * flank * 0.24
    branch = gorge - run * 0.49 + 0.040 * np.sin(8 * run)
    summit -= np.exp(-((x - branch) / (0.037 + 0.07 * run)) ** 2) * arc * 0.093
    beds = np.sin(summit * 55 + x * 5 + noise(x, y, 4.6, 11) * 2.2)
    summit += np.clip(beds * 2.3, -1, 1) * arc * np.clip(x * 3.2 + 0.38, 0, 1) * 0.024
    east = np.maximum(1 - np.hypot((x - 0.60) / 0.57, (y - 0.36) / 0.68), 0) ** 1.2 * 0.68
    west = np.maximum(1 - np.hypot((x + 0.92) / 0.57, (y - 0.43) / 0.48), 0) ** 1.1 * 0.47
    massif = np.maximum(np.maximum(summit, east), west)

    horizon = np.zeros_like(massif)
    # Four overlapping ranges. Saddles and drainages carve each crest; their
    # actual depth in the scene supplies aerial perspective and cast shadows.
    for index, (cy, height, breadth) in enumerate(((1.72, 0.42, 0.62), (1.02, 0.32, 0.57),
                                                   (-0.27, 0.17, 0.40), (-1.02, 0.085, 0.23))):
        crest = cy + 0.18 * np.sin(x * 2.1 + index) + 0.12 * noise(x, 0, 2.4, 3 + index)
        local = 0.56 + 0.23 * np.sin(x * 2.8 + index * 1.88) + 0.17 * noise(x, 0, 2.9, index + 6)
        local += 0.10 * (1 - np.abs(noise(x, 0, 6, index + 9))) + 0.05 * noise(x, 0, 16, index)
        # A high western group, a low pass behind the board, a steep eastern shoulder.
        local *= 0.70 + 0.70 * np.exp(-((x + 4.5) / 1.1) ** 2) + 0.46 * np.exp(-((x - 1.38) / 0.62) ** 2)
        spine = np.maximum(1 - np.abs(y - crest) / breadth, 0)
        horizon = np.maximum(horizon, 0.022 + height * local * spine ** 1.45)
    terrain = np.maximum(massif, horizon)
    eroded = noise(x, y, 7, 15) * 0.041 + noise(x, y, 23, 17) * 0.022 + noise(x, y, 61, 6) * 0.010
    shore = np.clip((-y - 1.19 - 0.04 * np.sin(5 * x)) * 5.3, 0, 1)
    return terrain + eroded * np.clip(terrain * 3, 0, 1) - shore * 0.13


def build_relief():
    nx, ny = 1601, 401
    x, y = np.meshgrid(np.linspace(LEFT - 0.02, RIGHT + 0.02, nx), np.linspace(-1.5, 2.45, ny))
    h = elevation(x, y)
    # Exported UV height is normalized to the volcano. Use a realistic slope
    # for actual ray casts and for snow holding on the gentler shelves.
    positions = np.stack((x, y, h * 0.61), axis=-1).astype(np.float32).reshape(-1, 3)
    ll = np.arange((ny - 1) * nx, dtype=np.int32).reshape(ny - 1, nx)[:, :-1].ravel()
    corners = np.stack((ll, ll + 1, ll + 1 + nx, ll + nx), axis=-1).ravel()
    mesh = bpy.data.meshes.new("Blood Moon caldera and four ridges")
    body = bpy.data.objects.new("Blood Moon relief bake", mesh)
    bpy.context.scene.collection.objects.link(body)
    try:
        mesh.vertices.add(len(positions))
        mesh.vertices.foreach_set("co", positions.ravel())
        mesh.loops.add(len(corners))
        mesh.loops.foreach_set("vertex_index", corners)
        mesh.polygons.add(len(ll))
        mesh.polygons.foreach_set("loop_start", np.arange(0, len(corners), 4, dtype=np.int32))
        mesh.update(calc_edges=True)
        bpy.context.view_layer.update()
        return BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    finally:
        bpy.data.objects.remove(body, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def save_png(path, rgba):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    # The Sub filter preserves the smooth slopes in the packed data.
    filtered = rgba.copy()
    filtered[:, 1:] -= rgba[:, :-1]
    rows = b''.join(b'\x01' + row.tobytes() for row in filtered)
    height, width = rgba.shape[:2]
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', width, height, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def bake(path):
    tree = build_relief()
    sun = Vector((-0.84, -0.41, 0.37)).normalized()
    forward = Vector((0, 1, 0))
    plate = np.zeros((HEIGHT, WIDTH, 4), dtype=np.uint8)
    for row in range(HEIGHT):
        height = TOP * (1 - (row + 0.5) / HEIGHT)
        for col in range(WIDTH):
            x = LEFT + (RIGHT - LEFT) * (col + 0.5) / WIDTH
            point, normal, face, _ = tree.ray_cast((x, -2.0, height * 0.61), forward)
            if face is None:
                continue
            diffuse = max(0.0, normal.dot(sun))
            if diffuse > 0.03 and tree.ray_cast(point + normal * 0.0008, sun, 2.0)[2] is not None:
                diffuse *= 0.20
            exposure = max(0.0, min(1.0, (height - 0.42 + 0.32 * (normal.z - 0.65)) * 3.8))
            shelf = max(0.0, min(1.0, (normal.z - 0.51 + normal.x * 0.16) * 2.1))
            snow = exposure * shelf
            distance = max(0.0, min(1.0, (point.y + 1.1) / 3.1))
            plate[row, col] = (round(diffuse * 255), round(snow * 255), round(distance * 255), 255)
    if np.any(plate[-1, :, 3] != 255):
        raise ValueError("The shoreline must cover the waterline along every bearing.")
    save_png(path, plate)


def bake_crust(path):
    # One seamless square of evaporite polygons. Their boundaries buckle
    # together, as a saline film dries. Encode the nearest rim's distance and
    # downhill direction; the shader can light its flanks from the moon.
    size, period = 768, 12
    rng = np.random.default_rng(128)
    seeds = rng.uniform(0.10, 0.90, (period, period, 2))
    colours = rng.uniform(0, 1, (period, period))
    coords = (np.arange(size) + 0.5) * period / size
    x, y = np.meshgrid(coords, coords[::-1])
    phase = np.pi * 2 / period
    wx = 0.048 * np.sin(phase * (7*x + 4*y) + 0.9 * np.sin(phase * (2*x - 7*y)))
    wy = 0.052 * np.sin(phase * (3*x - 7*y) + 0.8 * np.sin(phase * (9*x + y)))
    wx += 0.011 * np.sin(phase * (31*x - 6*y)) + 0.005 * np.sin(phase * (94*y + 13*x))
    wy += 0.009 * np.sin(phase * (25*y + 16*x)) + 0.005 * np.sin(phase * (70*x - 41*y))
    x, y = x + wx, y + wy
    ix, iy = np.floor(x).astype(int), np.floor(y).astype(int)
    best = np.full_like(x, np.inf)
    win_x, win_y = np.zeros_like(ix), np.zeros_like(iy)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx, cy = ix + ox, iy + oy
            seed = seeds[cy % period, cx % period]
            dsq = (cx + seed[:, :, 0] - x) ** 2 + (cy + seed[:, :, 1] - y) ** 2
            nearer = dsq < best
            win_x[nearer], win_y[nearer], best[nearer] = cx[nearer], cy[nearer], dsq[nearer]
    a = seeds[win_y % period, win_x % period]
    ax, ay = win_x + a[:, :, 0], win_y + a[:, :, 1]
    dist = np.full_like(x, np.inf)
    for oy in range(-2, 3):
        for ox in range(-2, 3):
            if ox == 0 and oy == 0:
                continue
            cx, cy = win_x + ox, win_y + oy
            seed = seeds[cy % period, cx % period]
            dx, dy = cx + seed[:, :, 0] - ax, cy + seed[:, :, 1] - ay
            gap = ((ax - x + dx * 0.5) * dx + (ay - y + dy * 0.5) * dy) / np.hypot(dx, dy)
            dist = np.minimum(dist, gap)
    gx = np.roll(dist, -1, axis=1) - np.roll(dist, 1, axis=1)
    gy = np.roll(dist, 1, axis=0) - np.roll(dist, -1, axis=0)
    slope = np.maximum(np.hypot(gx, gy), 0.00001)
    mineral = colours[win_y % period, win_x % period] * 0.79 + 0.14
    mineral += 0.035 * np.sin(phase * (38*x + 21*y)) * np.sin(phase * (96*x - 34*y))
    def coarse(v, steps):
        return np.round(v * steps) / steps

    # Only pixels within a rim width can see its normal. The rest of the plate
    # describes its gently submerged bed and compresses as broad flat colour.
    on_rim = np.clip((0.175 - dist) * 20, 0, 1)
    channels = np.stack((dist / 0.78, coarse(0.5 - 0.5 * gx / slope * on_rim, 23),
                         coarse(0.5 - 0.5 * gy / slope * on_rim, 23), coarse(mineral, 31)), axis=2)
    save_png(path, (np.clip(channels, 0, 1) * 255 + 0.5).astype(np.uint8))


if __name__ == '__main__':
    folder = Path(__file__).resolve().parents[2] / 'public/textures/blood-moon'
    bake(folder / 'caldera-relief.png')
    bake_crust(folder / 'salt-relief.png')
