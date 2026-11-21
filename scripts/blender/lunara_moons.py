"""Bake Lunara's two globes with Blender. Run blender -b -P scripts/blender/lunara_moons.py.

R is lunar albedo, GB are signed surface slopes and A is the rose companion's terrain.
Blender samples both of the game's Solar System Scope maps. The file is data, so its
channels must survive saving, mipmapping and sampling without a display transform.
"""
from pathlib import Path
import struct
import zlib

import bpy
import numpy as np


TEXTURES = Path(__file__).resolve().parents[2] / "public" / "textures"
WIDTH, HEIGHT = 1536, 768


def terrain_values(name):
    image = bpy.data.images.load(str(TEXTURES / name), check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    image.scale(WIDTH, HEIGHT)
    pixels = np.empty(WIDTH * HEIGHT * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(HEIGHT, WIDTH, 4)[:, :, :3] @ [0.30, 0.57, 0.13]


def blur(field, pixels):
    fx = np.fft.rfftfreq(WIDTH)
    fy = np.fft.fftfreq(HEIGHT)[:, None]
    kernel = np.exp(-2 * np.pi ** 2 * pixels ** 2 * (fx * fx + fy * fy))
    return np.fft.irfft2(np.fft.rfft2(field) * kernel, s=field.shape, axes=(0, 1))


def impact(u, v, radius, phase):
    # Work in a local tangent plane. Index through the date line so a basin has no UV seam.
    stretch = max(0.18, np.cos((v - 0.5) * np.pi))
    rx = radius / (2 * np.pi * stretch)
    ry = radius / np.pi
    xs = np.arange(int((u - 2.6 * rx) * WIDTH), int((u + 2.6 * rx) * WIDTH) + 1)
    ys = np.arange(max(0, int((v - 2.6 * ry) * HEIGHT)), min(HEIGHT, int((v + 2.6 * ry) * HEIGHT) + 1))
    x = ((xs + 0.5) / WIDTH - u) / rx
    y = (((ys + 0.5) / HEIGHT - v) / ry)[:, None]
    a = np.arctan2(y, x)
    d = np.hypot(x, y) * (1 + 0.031 * np.cos(5 * a + phase) + 0.016 * np.sin(9 * a - phase))
    floor = np.clip(1 - d ** 3, 0, 1)
    rim = np.exp(-((d - 0.97) / 0.14) ** 2)
    peak = np.exp(-(d / 0.16) ** 2)
    wall = np.exp(-((d - 0.78) / 0.083) ** 2)
    rays = np.maximum(0, np.cos(8 * a + phase + 1.6 * np.sin(3 * a))) ** 12
    apron = np.exp(-((d - 1.13) / 0.83) ** 2) * np.clip((d - 0.98) * 5, 0, 1)
    window = np.ix_(ys, xs % WIDTH)
    height[window] += radius * (-0.14 * floor + 0.068 * rim + 0.055 * peak + 0.018 * wall)
    albedo[window] += -0.065 * floor + 0.087 * rim + 0.12 * rays * apron + 0.028 * peak


moon = terrain_values("2k_moon.jpg")
mars = terrain_values("2k_mars.jpg")
soft = blur(moon, 1.8)
albedo = 0.5 + (0.72 * soft + 0.28 * moon - np.mean(moon)) * 1.65
height = (blur(moon, 2.8) - blur(moon, 18)) * 0.015
rng = np.random.default_rng(77291)
for _ in range(340):
    impact(rng.random(), rng.uniform(0.13, 0.87), rng.uniform(0.014, 0.071), rng.random() * 6.28)
# A terraced basin high on the day side, an older flooded basin and its smaller satellites.
for basin in [(0.878, 0.526, 0.162, 1.2), (0.828, 0.392, 0.108, 2.8),
              (0.898, 0.474, 0.064, 4.1), (0.815, 0.542, 0.059, 0.4)]:
    impact(*basin)

latitude = ((np.arange(HEIGHT) + 0.5) / HEIGHT - 0.5) * np.pi
east = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * WIDTH / (4 * np.pi)
east /= np.maximum(0.18, np.cos(latitude))[:, None]
north = np.gradient(height, axis=0) * HEIGHT / np.pi
companion = np.clip(0.48 + (mars - np.mean(mars)) * 2.75, 0.08, 0.94)
packed = np.stack([albedo, 0.5 + east * 0.57, 0.5 + north * 0.57, companion], axis=-1)
rgba = np.rint(np.clip(packed[::-1], 0, 1) * 255).astype(np.uint8)


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


# PNG Sub filtering preserves the independent data channels and compresses the smooth slopes.
filtered = rgba.copy()
filtered[:, 1:] -= rgba[:, :-1]
rows = b"".join(b"\x01" + row.tobytes() for row in filtered)
output = TEXTURES / "lunara" / "twin-moons.png"
output.parent.mkdir(exist_ok=True)
output.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", WIDTH, HEIGHT, 8, 6, 0, 0, 0))
                   + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))
print(f"Baked {output.name}, {WIDTH} x {HEIGHT}, {output.stat().st_size:,} bytes")
