"""Bake the two wave-worn basalt shapes as an indexed, millimetre-quantised mesh library.

blender --background --factory-startup --python scripts/blender/luminous_tides_basalt.py
An optional path after -- selects the output during playground iteration.
"""
import json
import math
import random
import sys
from pathlib import Path

import bmesh


def outcrop(seed, lean):
    rng = random.Random(seed)
    mesh = bmesh.new()
    sides = 9
    rim = []
    for i in range(sides):
        angle = (i + rng.uniform(-0.16, 0.16)) * math.tau / sides
        radius = rng.uniform(0.81, 1.08)
        rim.append((math.cos(angle) * radius, math.sin(angle) * radius * 0.66))
    rings = []
    for height, width, offset in [(-0.36, 0.71, -0.10), (0.04, 1.0, 0), (0.42, 0.84, 0.06), (0.62, 0.54, 0.14)]:
        ring = []
        for x, y in rim:
            ring.append(mesh.verts.new((x * width + offset, y * width,
                                        height - x * lean + y * 0.11 + rng.uniform(-0.085, 0.085))))
        rings.append(ring)
    mesh.faces.new(list(reversed(rings[0])))
    for lower, upper in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            mesh.faces.new((lower[i], lower[j], upper[j], upper[i]))
    mesh.faces.new(rings[-1])
    bmesh.ops.bevel(mesh, geom=list(mesh.edges), offset=0.095, segments=2, affect='EDGES', profile=0.52)
    bmesh.ops.triangulate(mesh, faces=list(mesh.faces))
    mesh.verts.index_update()
    positions = [round(c * 1000) for v in mesh.verts for c in (v.co.x, v.co.z, -v.co.y)]
    indices = [v.index for face in mesh.faces for v in face.verts]
    mesh.free()
    return dict(positions=positions, indices=indices)


root = Path(__file__).resolve().parents[2]
output = Path(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else (
    root / 'src/themes/luminous-tides/luminous-tides-basalt.json')
output.write_text(json.dumps([outcrop(31, 0.24), outcrop(73, -0.16)], separators=(',', ':')) + '\n')
