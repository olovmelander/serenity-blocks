"""Write a skinned figure as Stillwater's compact GLB.

One mesh, quantised (KHR_mesh_quantization): POSITION int16 (the node's scale and translation
restore metres), NORMAL int8, COLOR_0 uint8 rgba (what each vertex is; the meaning is written in
the extras), JOINTS_0 uint8 and WEIGHTS_0 uint8 normalised to sum to 255. No glTF skin and no
animation: the skeleton rides in `scenes[0].extras.bones` and the runtime
(src/themes/stillwater/stillwater-rig.js) builds the bones itself and poses them every frame.
"""

import numpy as np

from fall_grove.glb import GlbWriter, quantize_unit

from .rigs import bone_list, to_gltf


def write_figure(obj, bones, colour, path, generator, extras):
    """Write `obj` (a triangulated mesh weighted to the vertex groups named in `bones`).

    `colour(index)` gives each vertex's rgba (0..1). Returns (vertices, triangles, bytes).
    """
    order = list(bones.keys())
    me = obj.data
    me.calc_loop_triangles()
    n = len(me.vertices)
    pos = np.array([to_gltf(v.co) for v in me.vertices], dtype=np.float64)
    nor = np.array([to_gltf(v.normal) for v in me.vertices], dtype=np.float64)
    col = np.array([colour(i) for i in range(n)], dtype=np.float64)
    gidx = {g.index: order.index(g.name) for g in obj.vertex_groups if g.name in order}
    joints = np.zeros((n, 4), dtype=np.uint8)
    weights = np.zeros((n, 4), dtype=np.float64)
    for v in me.vertices:
        ws = sorted(((gidx[g.group], g.weight) for g in v.groups if g.group in gidx and g.weight > 1e-4),
                    key=lambda t: -t[1])[:4]
        total = sum(w for _, w in ws) or 1.0
        for k, (j, w) in enumerate(ws):
            joints[v.index, k] = j
            weights[v.index, k] = w / total
    wq = np.floor(weights * 255 + 0.5).astype(np.int32)
    wq[np.arange(n), np.argmax(weights, axis=1)] += 255 - wq.sum(axis=1)
    wq = np.clip(wq, 0, 255).astype(np.uint8)
    tris = np.array([t.vertices[:] for t in me.loop_triangles], dtype=np.uint32)
    writer = GlbWriter(generator=generator)
    unit = nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-9)
    writer.add_mesh(obj.name, {
        'POSITION': (pos, False),
        'NORMAL': (quantize_unit(unit, np.int8), True),
        'COLOR_0': (quantize_unit(np.clip(col, 0, 1), np.uint8), True),
        'JOINTS_0': (joints, False),
        'WEIGHTS_0': (wq, True),
    }, indices=tris)
    writer.set_extras({
        **extras,
        'bones': bone_list(bones),
        'sole': round(float(pos[:, 1].min()), 5),
        'top': round(float(pos[:, 1].max()), 5),
    })
    size = writer.write(path)
    return n, len(tris), size
