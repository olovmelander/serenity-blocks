"""Bake the greenhouse's moth orchid and a small lunar albedo map with Blender.

Run blender --background --factory-startup --python scripts/blender/moonlit_greenhouse.py.
The orchid is original geometry. The lunar face projects the game's credited
Solar System Scope map into the disc seen through the glass and in the canal.
"""
import base64
import math
from array import array
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src/themes/moonlit-greenhouse/moonlit-greenhouse-specimens.js"
vertices, faces, pigments, petal_uvs = [], [], [], []


def vertex(point, colour, petal_uv=(0.5, 1.0)):
    # Author in the game's front elevation, then work in Blender's Z-up frame.
    x, y, z = point
    vertices.append((x, -z, y))
    pigments.append(colour)
    petal_uvs.append(petal_uv)
    return len(vertices) - 1


def strip(rows):
    for a, b in zip(rows, rows[1:]):
        for j in range(len(a) - 1):
            faces.append((a[j], b[j], b[j + 1], a[j + 1]))


def tube(path, radii, colour, sides=7):
    rows = []
    for k, (p, r) in enumerate(zip(path, radii)):
        tangent = (path[min(k + 1, len(path) - 1)] - path[max(0, k - 1)]).normalized()
        reference = (0, 1, 0) if abs(tangent.z) > 0.94 else (0, 0, 1)
        right = tangent.cross(Vector(reference)).normalized()
        up = tangent.cross(right)
        rows.append([vertex(p + r * (right * math.cos(a * math.tau / sides)
                                     + up * math.sin(a * math.tau / sides)), colour)
                     for a in range(sides)])
        rows[-1].append(rows[-1][0])
    strip(rows)


def spine(t):
    return Vector((0.13 * t + 0.98 * t * t, 1.22 * math.sin(t * 1.93), 0.14 * math.sin(t * 3)))


def petal(origin, angle, reach, width, form, yaw, phase):
    rows = []
    # The two broad lateral petals overlap the three longer lance-shaped sepals.
    along_steps, across_steps = (8, 6) if form == "cheek" else (5, 4)
    for i in range(along_steps + 1):
        # Closely spaced rows near the margins keep the broad petals rounded in silhouette.
        t = (1 - math.cos(math.pi * i / along_steps)) * 0.5
        spread = (max(0.0005, math.sin(math.pi * t)) ** (0.51 if form == "cheek" else 0.83))
        row = []
        for j in range(across_steps + 1):
            c = j * 2 / across_steps - 1
            edge = abs(c)
            along = reach * (t + 0.035 * edge * math.sin(3.5 * t + phase))
            across = width * spread * c * (0.73 + t * 0.49)
            curl = reach * (0.36 * math.sin(t * math.pi) - 0.17 * t + 0.25 * edge**2 * spread)
            curl += width * 0.09 * math.sin(13 * t + 3 * c + phase) * edge**3
            x = along * math.cos(angle) - across * math.sin(angle)
            y = along * math.sin(angle) + across * math.cos(angle)
            p = origin + Vector((x * math.cos(yaw) + curl * math.sin(yaw), y,
                                 curl * math.cos(yaw) - x * math.sin(yaw)))
            # Pigment is multiplied by the scene light at runtime. Deep throats,
            # flushed veins, ivory margins and a separate two-lobed raspberry lip.
            if form == "lip":
                gold = math.exp(-6.2 * t) * (1 - edge)
                colour = (0.64 + 0.36 * gold, 0.032 + 0.59 * gold + 0.12 * edge,
                          0.17 + 0.19 * edge, 1)
            else:
                vein = max(0, math.cos(10.8 * c + 1.3 * t + phase)) ** 6 * (1 - t)
                blush = min(1, (1 - t) ** 1.25 * 0.9 + 0.27 * vein + (0.14 if form == "sepal" else 0))
                colour = (0.93 - 0.37 * blush, 0.69 - 0.62 * blush + 0.13 * edge,
                          0.87 - 0.45 * blush + 0.07 * edge, 1)
            uv = (c * 0.5 + 0.5, t) if form != "lip" else (0.5, 1)
            row.append(vertex(p, colour, uv))
        rows.append(row)
    strip(rows)


stem = (0.105, 0.23, 0.084, 0)
path = [spine(i / 24) for i in range(25)]
tube(path, [0.017 * (1 - 0.65 * i / 24) for i in range(25)], stem)
for k, t in enumerate((0.36, 0.49, 0.62, 0.74, 0.85, 0.95, 1.0)):
    sign = 1 if k % 2 else -1
    start = spine(t)
    end = start + Vector((sign * 0.09, sign * 0.073, 0.085 + 0.03 * math.sin(k)))
    tube([start, start.lerp(end, 0.55) + Vector((0, -0.022, 0)), end], [0.011, 0.008, 0.009], stem)
    if k >= 5:
        bud = [end + Vector((j * 0.016, -j * 0.005, j * 0.005)) for j in range(5)]
        tube(bud, [0.007, 0.023, 0.028, 0.019, 0.002], (0.45, 0.29, 0.30, 0.55))
        continue
    yaw = sign * 0.52 + 0.18 * math.sin(2.7 * k)
    scale = 1 - 0.07 * k
    tilt = 0.22 * sign + 0.13 * math.sin(k)
    for deg, length, width, form in (
            (90, 0.182, 0.065, "sepal"), (222, 0.16, 0.061, "sepal"), (-42, 0.16, 0.061, "sepal"),
            (19, 0.197, 0.115, "cheek"), (157, 0.197, 0.115, "cheek"),
            (-62, 0.083, 0.040, "lip"), (-117, 0.083, 0.040, "lip")):
        lip = form == "lip"
        centre = end + Vector((0, -0.018 if lip else 0, 0.052 if lip else (0.02 if form == "cheek" else 0)))
        petal(centre, math.radians(deg) + tilt, length * scale, width * scale, form, yaw, k * 0.43)
    column = [end + Vector((0, y * scale, z * scale)) for y, z in ((0, 0.028), (0.016, 0.064), (0, 0.09))]
    tube(column, [0.015 * scale, 0.031 * scale, 0.012 * scale], (1, 0.65, 0.09, 1), 8)

mesh = bpy.data.meshes.new("Phalaenopsis raceme")
mesh.from_pydata(vertices, [], faces)
mesh.update()
mesh.calc_loop_triangles()


def packed(fmt, items):
    return base64.b64encode(array(fmt, items).tobytes()).decode("ascii")


positions = packed("h", (round(v * 10000) for p in mesh.vertices for v in (p.co.x, p.co.z, -p.co.y)))
index = packed("H", (i for tri in mesh.loop_triangles for i in tri.vertices))
paint = packed("B", (round(min(1, max(0, c)) * 255) for colour in pigments for c in colour))
petal_uv = packed("B", (round(c * 255) for uv in petal_uvs for c in uv))

# A 96-pixel reference face resolves more than the disc at normal game sizes.
photo = bpy.data.images.load(str(ROOT / "public/textures/2k_moon.jpg"))
photo.colorspace_settings.name = "Non-Color"
w, h = photo.size
pixels = np.empty(w * h * 4, dtype=np.float32)
photo.pixels.foreach_get(pixels)
luma = pixels.reshape(h, w, 4)[:, :, :3].mean(axis=2)
n = 96
y, x = (np.indices((n, n)) + 0.5) * 2 / n - 1
z = np.sqrt(np.maximum(0, 1 - x*x - y*y))
u = np.arctan2(x, z) / math.tau + 0.5
v = np.arcsin(np.clip(y, -1, 1)) / math.pi + 0.5
face = luma[(v * (h - 1)).astype(int), (u * (w - 1)).astype(int)]
floor, ceiling = np.percentile(face[x*x+y*y < 0.93], [4, 98])
moon = packed("B", np.rint(np.clip((face-floor)/(ceiling-floor), 0, 1) * 255).astype("uint8").flat)
OUT.write_text(
    "// Generated by scripts/blender/moonlit_greenhouse.py. See assets/ATTRIBUTION.md.\n"
    "/* eslint-disable max-len -- Packed vertex, index, pigment and lunar texture data. */\n"
    "export const ORCHID = {\n"
    f"    positions: '{positions}',\n    index: '{index}',\n    pigment: '{paint}',\n    petalUv: '{petal_uv}',\n"
    "};\n"
    f"export const LUNAR_FACE = {{ size: {n}, pixels: '{moon}' }};\n", encoding="utf-8", newline="\n")
print(f"Greenhouse orchid: {len(mesh.vertices)} vertices, {len(mesh.loop_triangles)} triangles. Wrote {OUT}")
