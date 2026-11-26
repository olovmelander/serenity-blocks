"""Build the Cinder Drift shore fan. Run with Blender -b --factory-startup -P this_file.

The game imports the native Three.js buffer geometry with the theme. No model loader
or network request is needed on first visit. The geometry is original to Serenity Blocks.
"""
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


def build_fan():
    rng = random.Random(5874)
    vertices, faces, strata = [], [], []
    # Successive flows cooled against a sloping bank. The rear layer is taller;
    # the forward layer exposes short broken ends and the foot is buried in clinker.
    for row, (count, depth, length, width) in enumerate((
        (12, -0.58, 3.4, 0.32), (11, 0.02, 2.65, 0.34), (8, 0.60, 1.65, 0.38),
    )):
        for k in range(count):
            t = k / (count - 1)
            angle = -1.11 + t * 1.70 + rng.uniform(-0.07, 0.07)
            reach = length * (0.76 + 0.37 * math.sin(t * math.pi + 0.35)) * rng.uniform(0.8, 1.14)
            splay = Vector((math.sin(angle), rng.uniform(-0.10, 0.18), math.cos(angle)))
            across = Vector((math.cos(angle), 0, -math.sin(angle)))
            base = Vector((-0.40 + t * 1.4, -depth, -0.28 + rng.uniform(-0.13, 0.13)))
            corners = rng.choice((5, 6, 6, 7))
            orientation = rng.uniform(0, 1.05)
            corner_angles = [orientation + (j + rng.uniform(-0.14, 0.14)) * math.tau / corners for j in range(corners)]
            corner_radii = [width * rng.uniform(0.85, 1.13) for _ in range(corners)]
            wear = [rng.uniform(-0.075, 0.075) for _ in range(corners)]
            split = rng.uniform(0.33, 0.7)
            rings = ((0, 0.7), (split, 1), (split + 0.018, 0.91), (split + 0.036, 1),
                     (0.94, 1.02), (1, 0.79))
            first = len(vertices)
            birth = rng.random()
            for j, (fraction, scale) in enumerate(rings):
                # Outer columns flare away from the bank as the cooling front turns.
                pivot = base + splay * reach * fraction
                pivot.x += (t - 0.5) * 0.92 * fraction * fraction
                for i, a in enumerate(corner_angles):
                    radius = corner_radii[i] * scale
                    offset = across * (math.cos(a) * radius)
                    offset.y -= math.sin(a) * radius * 1.1
                    offset += splay * (wear[i] * (0.5 + fraction))
                    vertices.append(tuple(pivot + offset))
                    strata.extend((round(reach * fraction, 3), round(birth, 3)))
                    if j:
                        a0 = first + (j - 1) * corners + i
                        b0 = first + (j - 1) * corners + (i + 1) % corners
                        faces.append((a0, a0 + corners, b0 + corners, b0))
            end = first + (len(rings) - 1) * corners
            faces.append(tuple(end + i for i in reversed(range(corners))))

    # Fallen column drums lie across the front of the fan, partly sunk in the lake.
    for _ in range(13):
        centre = Vector((rng.uniform(-2.7, 1.8), rng.uniform(-1.5, -0.65), rng.uniform(-0.16, 0.16)))
        axis = Vector((rng.uniform(-1, 1), rng.uniform(-0.5, 0.5), rng.uniform(0.04, 0.50))).normalized()
        side = axis.cross(Vector((0, 0, 1))).normalized()
        up = axis.cross(side)
        height = rng.uniform(0.42, 1.05)
        width = rng.uniform(0.18, 0.39)
        phase = rng.uniform(0, math.tau)
        radii = [width * rng.uniform(0.68, 1.18) for _ in range(6)]
        first = len(vertices)
        seed = round(rng.random(), 3)
        for layer, (along, scale) in enumerate(((-0.46, 0.76), (-0.33, 1), (0.4, 1), (0.52, 0.73))):
            for i, radius in enumerate(radii):
                a = phase + i * math.tau / 6
                offset = (side * math.cos(a) + up * math.sin(a)) * radius * scale
                vertices.append(tuple(centre + axis * height * along + offset))
                strata.extend((round(height * (along + 0.5), 3), seed))
                if layer:
                    k = first + (layer - 1) * 6
                    j = (i + 1) % 6
                    faces.append((k + i, k + j, k + 6 + j, k + 6 + i))
        faces.extend((tuple(first + i for i in reversed(range(6))), tuple(first + 18 + i for i in range(6))))

    mesh = bpy.data.meshes.new('Basalt fan')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.calc_loop_triangles()
    # Blender Z-up to Three Y-up. Shared positions keep the static buffer small.
    pos = [round(v, 3) for vert in mesh.vertices for v in (vert.co.x, vert.co.z, -vert.co.y)]
    indices = [i for tri in mesh.loop_triangles for i in tri.vertices]
    data = {
        'metadata': {'version': 4.5, 'type': 'BufferGeometry', 'generator': 'scripts/blender/cinder_drift_basalt.py'},
        'type': 'BufferGeometry',
        'data': {'attributes': {'position': {'itemSize': 3, 'type': 'Float32Array', 'array': pos},
                                'uv': {'itemSize': 2, 'type': 'Float32Array', 'array': strata}},
                 'index': {'type': 'Uint16Array', 'array': indices}},
    }
    bpy.data.meshes.remove(mesh)
    return data


def export(asset):
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_text(json.dumps(build_fan(), separators=(',', ':')) + '\n', encoding='utf-8')


if __name__ == '__main__':
    export(Path(__file__).resolve().parents[2] / 'src/themes/cinder-drift/assets/basalt-fan.json')
