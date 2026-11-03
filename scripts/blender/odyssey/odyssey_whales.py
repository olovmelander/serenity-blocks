"""Odyssey's humpback mother and calf (chapter 2's whale pass), built, rigged and animated headless.

    blender -b --factory-startup --python scripts/blender/odyssey/odyssey_whales.py -- \
        [--out src/rendering/odyssey/assets/chapter-02/creatures/humpback-swim.glb] \
        [--review <dir>] [--blend <review .blend>]

WHY (2026-11-03). The pair swam as `whale-glide.glb`, a photo-to-3D (TRELLIS) mesh with a 9-bone
auto-rig. Up close it was a slender rorqual, not the humpback the docs name, and its rig was
backwards: the bones called "tail" sat in the head, so the baked swim nodded the head ~11 % of the
body length while the flukes stayed still. This script draws a humpback from numbers, rigs it and
keys a real swim, so the motion can be read off the curves and scrubbed in Blender.

THE BODY is a signed distance field of smooth masses and fins (the Ocean theme's authoring library,
scripts/blender/ocean_creatures/sdf.py, which is generic), meshed by Blender's openvdb, decimated
mirror-symmetric, normals from the field. The design numbers are this file's own (started from the
Ocean pack's humpback and redrawn, so a change to the theme never moves Odyssey's whale), drawn to
the marks a humpback is known by (see "The design" below): flippers a third of the body long with a
scalloped leading edge, a broad head flat on top and rounded at the tip, a stocky body deepest
just behind the flippers, a small fin on a low hump, broad flukes serrated and notched.

THE RIG: a chain from the centre of mass back to the flukes (root, spine x3, tail stock x2, flukes)
and forward (chest, head), and two bones in each flipper. Weights are a smooth partition along the
body (each vertex between its two nearest bones), the flippers along their span.

THE SWIM (one action, "Swim", one stroke of 4 s at 24 fps, cyclic): a travelling wave of heave
h(s) = A(s) sin(phi - 2 pi s / wavelength) down the body (s 0 nose .. 1 fluke tips), small at the
head (the recoil), least just behind the flippers and growing toward the flukes, which sweep 0.17 of
the length peak to peak; each bone follows the curve between its two ends, so the wave visibly runs
back along the body. The flukes pitch ahead of their heave (feathering). The whole body heaves a
little against the tail. The flippers ride the chest and flex, their tips lagging. Every curve is a
smooth sampled function keyed at 16 points per stroke with automatic Bezier handles and a Cycles
modifier, so the stroke has no corner anywhere, the loop seam included. Turns (a C-bend, the head
leading, the inside flipper dipping) and the beat rate (with speed, the calf faster) are applied by
the game on top (composition/odyssey-whale-pass.js).

Frames: the GLB leads with -Z, up +Y (as the old whale did): in Blender the nose points +Y, up +Z.
"""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
BLENDER_SCRIPTS = HERE.parent
REPO = BLENDER_SCRIPTS.parent.parent
if str(BLENDER_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(BLENDER_SCRIPTS))

from ocean_creatures import sdf  # noqa: E402
from ocean_creatures.cast import PARTS, _smooth, both, eye, groove, lip_line, surface_point  # noqa: E402
from ocean_creatures.sdf import V, Prim, body_chain, fin, planform  # noqa: E402
from ocean_creatures.build import _tidy  # noqa: E402

TAG = "[odyssey-whales]"
FPS = 24
STROKE_FRAMES = 96  # one stroke: 4 s at 24 fps (the game plays it slower for the mother)
KEYS_PER_STROKE = 16

# ── The design: a humpback, by its marks ────────────────────────────────────────────────────
#
# Started from the Ocean pack's humpback (2026-11-03) and redrawn the same day (the lead: "it reads
# as a slender rorqual"). What tells a humpback from a blue or fin whale, all of it judged at the
# game's size (the review's game-size sheet):
#   - flippers a third of the body long, white, their leading edge scalloped (knobs);
#   - a broad head, flat on top and ROUNDED at the tip seen from above (a rorqual's comes to a
#     point), the lower jaw broad and just past the upper;
#   - a stocky body, deepest just behind the flippers, the tail stock tall and narrow;
#   - a small dorsal fin on a low hump two thirds of the way back;
#   - broad flukes, the trailing edge serrated and a clear notch in the middle.
# The tubercles (the knobs along the jaw) are a few hundredths of the length: under two pixels at
# the size the journey shows the pair, so they are left out.


def humpback():
    # (s from the nose, half width, half height, centre height). The tip is a broad round cap.
    rows = [
        (0.000, 0.030, 0.012, -0.024),
        (0.018, 0.056, 0.020, -0.025),
        (0.045, 0.079, 0.031, -0.026),
        (0.090, 0.100, 0.047, -0.026),
        (0.160, 0.119, 0.070, -0.024),
        (0.240, 0.132, 0.094, -0.020),
        (0.320, 0.140, 0.114, -0.014),
        (0.390, 0.140, 0.122, -0.008),
        (0.470, 0.130, 0.116, -0.002),
        (0.560, 0.108, 0.101, 0.003),
        (0.650, 0.078, 0.083, 0.006),
        (0.730, 0.050, 0.065, 0.006),
        (0.800, 0.030, 0.050, 0.004),
        (0.860, 0.018, 0.036, 0.002),
        (0.910, 0.011, 0.021, 0.000),
        (0.940, 0.008, 0.011, 0.000),
    ]
    body = body_chain(rows, step=0.012, k=0.014)
    # The throat swells under the head (the pleated pouch); the lower jaw is broad and reaches just
    # past the upper, its chin rounded.
    body.append(Prim('ell', 'body', k=0.05, c=V(0.0, -0.07, 0.25), r=V(0.115, 0.08, 0.22)))
    body.append(Prim('ell', 'body', k=0.03, c=V(0.0, -0.044, 0.40), r=V(0.085, 0.03, 0.105)))
    # The low hump two thirds of the way back, and its small fin.
    body.append(Prim('ell', 'body', k=0.025, c=V(0.0, 0.088, -0.145), r=V(0.024, 0.026, 0.075)))
    prims = list(body)
    for side in (1, -1):
        # The mouth line, from the corner up to near the tip (kept short of it, where the groove
        # used to cut a dark slit at the snout).
        zs = np.linspace(0.462, 0.27, 9)
        ys = -0.026 - 0.034 * ((0.462 - zs) / 0.192) ** 1.4
        prims += groove(body, lip_line(body, zs, ys, side, inset=-0.0005), 0.003)
        prims.append(eye(body, 0.262, -0.044, 0.0072, side))
    # The flippers: a third of the body long, out from the body and swept back, a little down; the
    # leading edge scalloped with nine knobs, big enough to show.
    root = surface_point(body, V(0.0, -0.07, 0.21), V(1, 0, 0)) - V(0.014, 0.0, 0.0)
    span = 0.40
    us, lead, trail = planform(span, 0.078, 0.02, sweep=0.05, tip_round=0.18,
                               lead_wave=lambda f: -0.0085 * np.sin(np.pi * f * 9.0) ** 2 * _smooth(0.05, 0.25, f))
    fdir = V(1.0, -0.3, -0.62)
    flipper = fin('pectoral', root, fdir, V(0, 0, -1), us, lead, trail,
                  0.012 - 0.008 * us / span, k=0.018, tmin=0.0026, bow=-0.035 * (us / span) ** 2,
                  side=1, along=0.295)
    prims += both(flipper)
    # The dorsal fin on the hump: small, its back edge hooked.
    us, lead, trail = planform(0.05, 0.085, 0.016, sweep=0.04, tip_round=0.3, trail_bulge=-0.008)
    prims.append(fin('dorsal', V(0.0, 0.106, -0.12), V(0.0, 1.0, -0.9), V(0, 0, -1), us, lead, trail,
                     0.01 - 0.006 * us / 0.05, k=0.012, tmin=0.0026))
    # The flukes: broad and swept, the trailing edge serrated, a clear notch in the middle.
    us, lead, trail = planform(0.18, 0.072, 0.012, sweep=0.075, tip_round=0.12,
                               trail_wave=lambda f: (0.0055 * np.sin(f * np.pi * 9) * _smooth(0.1, 0.3, f))
                               - (0.03 * np.exp(-(f / 0.075) ** 2)))
    fluke = fin('tail', V(0.0, 0.0, -0.418), V(1.0, 0.0, -0.18), V(0, 0, -1), us, lead, trail,
                0.012 * (1 - 0.75 * us / 0.18), k=0.012, tmin=0.0026, side=1)
    prims += both(fluke)

    def masks(P, N, part, s):
        below = _smooth(-0.15, -0.55, N[:, 1])
        # The fins' white (the long flippers, the flukes' underside) and the belly's, apart: the
        # game keeps the belly mostly dark, so the pair reads as silhouettes against the light.
        fins = np.where(part == PARTS['pectoral'], 1.0, 0.0)
        fins = np.maximum(fins, (part == PARTS['tail']) * _smooth(0.1, -0.4, N[:, 1]))
        belly = below * _smooth(0.22, 0.32, s) * (1 - _smooth(0.55, 0.68, s)) * (part == PARTS['body'])
        return belly, fins

    meta = {'voxel': 0.0024, 'triangles': 6000, 'masks': masks, 'nose': 0.5, 'tail': -0.5,
            'rows': rows, 'flipper_root': root, 'flipper_dir': sdf.unit(fdir), 'flipper_len': span}
    return prims, meta


def mesh_whale(log=print):
    """The field meshed, the outer shell kept, decimated mirror-symmetric, normals from the field,
    and every vertex told its part, side, place along the body and how far out along its fin."""
    prims, meta = humpback()
    verts, faces = sdf.surface(prims, meta['voxel'], log=log, name='humpback')
    me = bpy.data.meshes.new('humpback-src')
    me.from_pydata(verts.tolist(), [], faces)
    me.validate()
    obj = bpy.data.objects.new('humpback-src', me)
    bpy.context.scene.collection.objects.link(obj)
    _tidy(me, outer_only=True, log=log, name='humpback')
    centre = np.array([v.co[:] for v in me.vertices]).mean(0)
    fn = np.array([p.normal[:] for p in me.polygons])
    fc = np.array([p.center[:] for p in me.polygons])
    if (np.einsum('ij,ij->i', fn, fc - centre) > 0).mean() < 0.5:
        me.flip_normals()
    src = sum(len(p.vertices) - 2 for p in me.polygons)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    dec = obj.modifiers.new('dec', 'DECIMATE')
    dec.decimate_type = 'COLLAPSE'
    dec.ratio = min(1.0, meta['triangles'] / max(src, 1))
    dec.use_symmetry = True
    dec.symmetry_axis = 'X'
    bpy.ops.object.modifier_apply(modifier='dec')
    _tidy(me, triangulate=True, name='humpback')
    P = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
    tris = np.array([p.vertices[:] for p in me.polygons], dtype=np.int64)
    N = sdf.gradient(prims, P)
    mesh_n = np.array([v.normal[:] for v in me.vertices])
    bad = ~np.isfinite(N).all(1) | (np.linalg.norm(N, axis=1) < 0.5) | ((N * mesh_n).sum(1) < -0.2)
    N[bad] = mesh_n[bad]
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    g = np.cross(P[tris[:, 1]] - P[tris[:, 0]], P[tris[:, 2]] - P[tris[:, 0]])
    m = N[tris[:, 0]] + N[tris[:, 1]] + N[tris[:, 2]]
    flip = (g * m).sum(1) < 0
    if flip.any():
        tris[flip] = tris[flip][:, [0, 2, 1]]
        log(f'humpback: rewound {int(flip.sum())} folded triangles')
    idx, _ = sdf.nearest_parts(prims, P)
    n = len(P)
    part = np.zeros(n, int)
    span = np.zeros(n)
    along = np.clip((meta['nose'] - P[:, 2]) / (meta['nose'] - meta['tail']), 0.0, 1.0)
    for i in range(n):
        pr = prims[idx[i]] if idx[i] >= 0 else None
        if pr is None:
            continue
        part[i] = PARTS[pr.part]
        mm = pr.meta
        if 'pivot' in mm and 'span' in mm and mm.get('reach', 0) > 0:
            span[i] = np.clip(((P[i] - mm['pivot']) @ mm['span']) / mm['reach'], 0.0, 1.0)
    ao = sdf.ambient(prims, P, N, reach=0.035)
    belly, white = meta['masks'](P, N, part, along)
    bpy.data.objects.remove(obj, do_unlink=True)
    counts = {k: int((part == v).sum()) for k, v in PARTS.items()}
    log(f'humpback: {n} vertices, {len(tris)} triangles; parts {counts}')
    return {
        'P': P, 'N': N, 'tris': tris, 'part': part, 'along': along, 'span': span, 'ao': ao,
        'belly': np.clip(belly, 0, 1), 'white': np.clip(white, 0, 1), 'meta': meta,
    }


# ── Frames: the design's (x, y up, z nose) to Blender's (nose +Y, up +Z), a proper rotation ──


def to_blender(p):
    return Vector((-p[0], p[2], p[1]))


def centre_height(meta, s):
    rows = np.asarray(meta['rows'], float)
    return float(sdf.pchip(rows[:, 0], rows[:, 3], np.clip(s, rows[0, 0], rows[-1, 0])))


def body_point(meta, s):
    """Blender point on the body's centre line at share s (0 nose .. 1 tail end)."""
    return Vector((0.0, meta['nose'] - s, centre_height(meta, min(s, 0.94))))


# The spine: (name, parent, s at its head, s at its tail). The root sits at the centre of mass and
# points back; the chest and head point forward from it.
SPINE = [
    ('root', None, 0.38, 0.46),
    ('spine1', 'root', 0.46, 0.57),
    ('spine2', 'spine1', 0.57, 0.67),
    ('spine3', 'spine2', 0.67, 0.765),
    ('stock1', 'spine3', 0.765, 0.845),
    ('stock2', 'stock1', 0.845, 0.915),
    ('flukes', 'stock2', 0.915, 1.0),
    ('chest', 'root', 0.38, 0.24),
    ('head', 'chest', 0.24, 0.02),
]
# Each bone's place along the body for the weights (its middle; the root's is the centre of mass).
WEIGHT_AT = {
    'head': 0.11, 'chest': 0.30, 'root': 0.42, 'spine1': 0.515, 'spine2': 0.62, 'spine3': 0.717,
    'stock1': 0.805, 'stock2': 0.88, 'flukes': 0.96,
}
WEIGHT_ORDER = ['head', 'chest', 'root', 'spine1', 'spine2', 'spine3', 'stock1', 'stock2', 'flukes']


def build_rig(d, log=print):
    meta = d['meta']
    arm_data = bpy.data.armatures.new('HumpbackRig')
    arm = bpy.data.objects.new('HumpbackRig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm_data.edit_bones
    for name, parent, s0, s1 in SPINE:
        b = eb.new(name)
        b.head = body_point(meta, s0)
        b.tail = body_point(meta, s1)
        b.roll = 0.0
        if parent:
            b.parent = eb[parent]
            b.use_connect = name not in ('chest',)
    root = np.asarray(meta['flipper_root'], float)
    span = np.asarray(meta['flipper_dir'], float)
    reach = meta['flipper_len']
    for side, tag in ((1, 'L'), (-1, 'R')):
        m = np.array([side, 1.0, 1.0])
        p0 = to_blender(root * m)
        p1 = to_blender((root + span * reach * 0.45) * m)
        p2 = to_blender((root + span * reach) * m)
        b1 = eb.new(f'flipper1_{tag}')
        b1.head, b1.tail = p0, p1
        b1.parent = eb['chest']
        b2 = eb.new(f'flipper2_{tag}')
        b2.head, b2.tail = p1, p2
        b2.parent = b1
        b2.use_connect = True
    bpy.ops.object.mode_set(mode='OBJECT')
    log(f'rig: {len(arm_data.bones)} bones')
    return arm


def hat_weights(s, centres):
    """Piecewise-linear partition of unity over bone centres (sorted), smoothed (smoothstep)."""
    w = np.zeros((len(s), len(centres)))
    c = np.asarray(centres)
    for i, x in enumerate(s):
        if x <= c[0]:
            w[i, 0] = 1
            continue
        if x >= c[-1]:
            w[i, -1] = 1
            continue
        k = int(np.searchsorted(c, x) - 1)
        t = (x - c[k]) / (c[k + 1] - c[k])
        t = t * t * (3 - 2 * t)
        w[i, k] = 1 - t
        w[i, k + 1] = t
    return w


def build_mesh(d, arm, log=print):
    P, N, tris = d['P'], d['N'], d['tris']
    verts = [to_blender(p) for p in P]
    me = bpy.data.meshes.new('Humpback')
    me.from_pydata([tuple(v) for v in verts], [], [tuple(int(i) for i in t) for t in tris])
    me.validate()
    # The design frame -> Blender is a proper rotation, so winding and normals carry over.
    normals = [tuple(to_blender(n)) for n in N]
    for p in me.polygons:
        p.use_smooth = True
    me.normals_split_custom_set_from_vertices(normals)
    # COLOR_0: r the fins' white (flippers, the flukes' underside), g the belly's white, b ao.
    col = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    for i in range(len(P)):
        col.data[i].color = (float(d['white'][i]), float(d['belly'][i]), float(np.clip(d['ao'][i], 0, 1)), 1.0)
    me.color_attributes.active_color = col
    obj = bpy.data.objects.new('Humpback', me)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = arm
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    groups = {b.name: obj.vertex_groups.new(name=b.name) for b in arm.data.bones}
    part, along, span = d['part'], d['along'], d['span']
    W = hat_weights(along, [WEIGHT_AT[n] for n in WEIGHT_ORDER])
    for i in range(len(P)):
        if part[i] == PARTS['pectoral']:
            tag = 'L' if P[i][0] > 0 else 'R'
            # Root on the chest, out along the span to the tip bone.
            ws = hat_weights(np.array([span[i]]), [0.05, 0.35, 0.8])[0]
            for name, w in zip(('chest', f'flipper1_{tag}', f'flipper2_{tag}'), ws):
                if w > 1e-4:
                    groups[name].add([i], float(w), 'REPLACE')
            continue
        for k, name in enumerate(WEIGHT_ORDER):
            if W[i, k] > 1e-4:
                groups[name].add([i], float(W[i, k]), 'REPLACE')
    log(f'mesh: {len(me.vertices)} vertices, {len(me.polygons)} triangles')
    return obj


# ── The swim ────────────────────────────────────────────────────────────────────────────────

SWIM = {
    # heave amplitude (share of the length) along the body: the head's recoil, the least just
    # behind the flippers, the flukes' sweep (half of the peak-to-peak). The front half stays
    # nearly still: the flexing is in the tail stock (it grows as the cube of the way back).
    'head': 0.006,
    'least_at': 0.32,
    'least': 0.002,
    'flukes': 0.07,
    'grow': 3.0,
    # the body wave's length (body lengths): longer than the body, so the rear moves nearly
    # together and the flukes come last
    'wavelength': 1.25,
    # The wave itself pitches the flukes front-up on the upstroke and front-down on the
    # downstroke (about 20 degrees); they feather a little more on top of it (rad).
    'feather': 0.08,
    # the flippers flex with the chest (rad), the tips lagging the roots
    'flipper': 0.025,
    'flipper_tip': 0.045,
    'flipper_lag': 0.9,
}


def heave_amp(s):
    w = SWIM
    if s <= w['least_at']:
        u = 1 - s / w['least_at']
        return w['least'] + (w['head'] - w['least']) * u * u
    u = (s - w['least_at']) / (1 - w['least_at'])
    return w['least'] + (w['flukes'] - w['least']) * u ** w['grow']


def heave(s, phi):
    return heave_amp(s) * math.sin(phi - 2 * math.pi * s / SWIM['wavelength'])


def absolute_pitch(name, phi):
    for n, parent, s0, s1 in SPINE:
        if n == name:
            if s1 > s0:
                # pointing back (-Y): its tail at heave(s1); rotation about +X lowers a -Y bone's tail
                return -math.atan2(heave(s1, phi) - heave(s0, phi), s1 - s0) + (
                    SWIM['feather'] * math.cos(phi - 2 * math.pi * 0.96 / SWIM['wavelength']) if n == 'flukes' else 0.0)
            # pointing forward (+Y): rotation about +X raises its tail
            return math.atan2(heave(s1, phi) - heave(s0, phi), s0 - s1)
    raise KeyError(name)


def pose_curves(arm, log=print):
    """Key the stroke: per bone, its pitch relative to its parent (the wave), the root's heave,
    and the flippers' flex, at KEYS_PER_STROKE points with automatic handles, cyclic."""
    bones = arm.data.bones
    rest = {b.name: b.matrix_local.to_quaternion() for b in bones}
    parent_of = {b.name: (b.parent.name if b.parent else None) for b in bones}
    pose = arm.pose.bones
    for pb in pose:
        pb.rotation_mode = 'QUATERNION'
    action = bpy.data.actions.new('Swim')
    arm.animation_data_create()
    arm.animation_data.action = action
    xaxis = Vector((1, 0, 0))
    for k in range(KEYS_PER_STROKE + 1):
        phi = 2 * math.pi * k / KEYS_PER_STROKE
        frame = STROKE_FRAMES * k / KEYS_PER_STROKE
        angles = {}
        for name, parent, _s0, _s1 in SPINE:
            angles[name] = absolute_pitch(name, phi)
        for name, parent, _s0, _s1 in SPINE:
            rel = angles[name] - (angles[parent] if parent else 0.0)
            q_arm = Quaternion(xaxis, rel)
            r = rest[name]
            q_local = r.inverted() @ q_arm @ r
            pose[name].rotation_quaternion = q_local
            pose[name].keyframe_insert('rotation_quaternion', frame=frame)
        # The root heaves against the tail (the body's weight), in its own local frame.
        h = heave(0.42, phi)
        pose['root'].location = rest['root'].inverted() @ Vector((0.0, 0.0, h))
        pose['root'].keyframe_insert('location', frame=frame)
        # The flippers flex with the chest's heave, the tips lagging the roots; up/down about the
        # axis square to the span in the horizontal (so the tip rises and falls).
        for tag, side in (('L', 1), ('R', -1)):
            for bi, amp, lag in ((1, SWIM['flipper'], 0.0), (2, SWIM['flipper_tip'], SWIM['flipper_lag'])):
                name = f'flipper{bi}_{tag}'
                b = bones[name]
                spanv = (b.tail_local - b.head_local).normalized()
                axis = Vector((0, 0, 1)).cross(spanv).normalized()
                ang = amp * math.sin(phi - 2 * math.pi * 0.30 / SWIM['wavelength'] - lag - math.pi * 0.5)
                q_arm = Quaternion(axis, ang)
                r = rest[name]
                pose[name].rotation_quaternion = r.inverted() @ q_arm @ r
                pose[name].keyframe_insert('rotation_quaternion', frame=frame)
    for fc in action.fcurves if hasattr(action, 'fcurves') else iter_fcurves(action):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = 'AUTO'
            kp.handle_right_type = 'AUTO'
        fc.modifiers.new('CYCLES')
        fc.update()
    log(f'swim: {KEYS_PER_STROKE} keys per stroke, {STROKE_FRAMES} frames, cyclic')
    return action


def iter_fcurves(action):
    """Blender 5's layered actions keep their curves in channelbags."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def export_glb(arm, mesh, path, log=print):
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = arm
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = STROKE_FRAMES
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format='GLB', use_selection=True, export_yup=True,
        export_animations=True, export_skins=True, export_force_sampling=True, export_frame_range=True,
        export_frame_step=1, export_optimize_animation_size=True, export_anim_single_armature=True,
        export_rest_position_armature=True, export_def_bones=False, export_influence_nb=4,
        export_materials='NONE', export_vertex_color='ACTIVE', export_normals=True, export_tangents=False,
        export_animation_mode='ACTIONS', export_extras=False,
    )
    log(f'wrote {path} ({path.stat().st_size} bytes)')


# ── Review: clay and colour from six sides, motion strips, onion skin, tip paths ─────────────


def review(arm, mesh, out_dir, log=print):
    out_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.show_cavity = True
    scene.display.shading.color_type = 'VERTEX'
    scene.world = bpy.data.worlds.new('sea')
    scene.world.color = (0.08, 0.17, 0.22)
    scene.render.image_settings.file_format = 'PNG'
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Show the white mask as colour: a review material reads the 'Col' red channel.
    mat = bpy.data.materials.new('review')
    mesh.data.materials.append(mat)
    views = {
        'side': Vector((1, 0, 0)), 'top': Vector((0, 0.0001, 1)), 'below': Vector((0, 0.0001, -1)),
        'front': Vector((0, 1, 0.0001)), 'threeq': Vector((0.75, 0.5, 0.4)), 'underq': Vector((0.6, -0.4, -0.7)),
    }

    def shoot(name, d, w=900, h=560, scale=1.15, frame=0, color='VERTEX'):
        scene.frame_set(frame)
        scene.display.shading.color_type = color
        d = d.normalized()
        cam.location = d * 4
        q = (-d).to_track_quat('-Z', 'Y')
        if abs(d.z) > 0.9:
            # Straight up or down: turn the frame so the whale lies across it, nose to the right.
            q = q @ Quaternion((0, 0, 1), math.pi / 2 * (1 if d.z > 0 else -1))
        cam.rotation_euler = q.to_euler()
        cam_data.ortho_scale = scale
        scene.render.resolution_x = w
        scene.render.resolution_y = h
        scene.render.filepath = str(out_dir / f'{name}.png')
        bpy.ops.render.render(write_still=True)

    # The vertex colour shows the masks raw (red = white); a clay pass shows the form.
    for name, d in views.items():
        # Straight up or down the flippers reach wider than the frame's height at 1.15.
        sc = 1.45 if abs(d.normalized().z) > 0.9 else 1.15
        shoot(f'colour-{name}', d, scale=sc)
        shoot(f'clay-{name}', d, scale=sc, color='SINGLE')
    scene.display.shading.single_color = (0.62, 0.66, 0.7)
    # Motion strips: 8 frames over one stroke, side and top.
    for vname in ('side', 'top'):
        for k in range(8):
            shoot(f'strip-{vname}-{k}', views[vname], w=600, h=330, frame=int(STROKE_FRAMES * k / 8), color='SINGLE')
    # Tip paths over a stroke (armature space), swum forward at one body length per stroke.
    paths = {}
    dg = bpy.context.evaluated_depsgraph_get
    probe = {'fluke tip': None, 'flipper tip': None, 'snout': None}
    me0 = mesh.data
    co = np.array([v.co[:] for v in me0.vertices])
    probe['fluke tip'] = int(np.argmax(-co[:, 1] + 0.3 * co[:, 0]))
    probe['flipper tip'] = int(np.argmax(co[:, 0]))
    probe['snout'] = int(np.argmax(co[:, 1]))
    for k in probe:
        paths[k] = []
    for f in range(0, STROKE_FRAMES + 1):
        scene.frame_set(f)
        ev = mesh.evaluated_get(dg())
        em = ev.to_mesh()
        for k, i in probe.items():
            v = em.vertices[i].co
            paths[k].append([v.x, v.y, v.z])
        ev.to_mesh_clear()
    (out_dir / 'tip-paths.json').write_text(json.dumps(paths))
    game_size(mesh, out_dir, shoot_small=lambda name, d, w, h, scale: shoot(name, d, w=w, h=h, scale=scale, color='VERTEX'))
    onion(out_dir, [out_dir / f'strip-side-{k}.png' for k in range(8)], out_dir / 'onion-side.png')
    plot_paths(paths, out_dir / 'tip-paths.png')
    (out_dir / 'motion.json').write_text(json.dumps(motion_numbers(arm), indent=1))
    log(f'review: {out_dir}')
    return paths


def game_size(mesh, out_dir, shoot_small):
    """The whale at the lengths the journey draws it (1280 x 720: the calf ~110 px, the mother
    ~250 px; at 2560 x 1600 about twice that), from below (the climb's view), the side and above,
    each blown up with hard pixels to judge what shows."""
    views = {'below': Vector((0, 0.0001, -1)), 'side': Vector((1, 0, 0)), 'top': Vector((0, 0.0001, 1)),
             'underq': Vector((0.6, -0.4, -0.7))}
    # A look like the game's for these: a dark skin, the white of the fins, a hint of the belly's.
    me = mesh.data
    src = me.color_attributes['Col']
    look = me.color_attributes.new('Look', 'BYTE_COLOR', 'POINT')
    for i in range(len(me.vertices)):
        r, g, _b, _a = src.data[i].color
        k = min(1.0, r * 0.85 + g * 0.22)
        look.data[i].color = (0.07 + 0.68 * k, 0.09 + 0.71 * k, 0.12 + 0.70 * k, 1.0)
    me.color_attributes.active_color = look
    cells = []
    for px, up in ((110, 4), (250, 2)):
        for name, d in views.items():
            w = int(px * 1.25)
            h = int(px * 0.75)
            shoot_small(f'game-{name}-{px}', d, w, h, 1.25 * 1.05)
            a = _load(out_dir / f'game-{name}-{px}.png')
            cells.append(np.repeat(np.repeat(a, up, axis=0), up, axis=1))
    rows = []
    for r in range(2):
        row = cells[r * 4:(r + 1) * 4]
        hmax = max(c.shape[0] for c in row)
        padded = []
        for c in row:
            pad = np.zeros((hmax, c.shape[1] + 6, 4), dtype=np.float32)
            pad[..., :3] = 0.12
            pad[..., 3] = 1
            pad[:c.shape[0], :c.shape[1]] = c
            padded.append(pad)
        rows.append(np.concatenate(padded, axis=1))
    wmax = max(r.shape[1] for r in rows)
    out = []
    for r in rows:
        pad = np.zeros((r.shape[0] + 6, wmax, 4), dtype=np.float32)
        pad[..., :3] = 0.12
        pad[..., 3] = 1
        pad[:r.shape[0], :r.shape[1]] = r
        out.append(pad)
    _save(np.concatenate(out, axis=0), out_dir / 'game-size.png')
    me.color_attributes.active_color = src
    me.color_attributes.remove(look)


def _load(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def _save(a, path):
    h, w = a.shape[:2]
    img = bpy.data.images.new(path.stem, w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(a, dtype=np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def onion(out_dir, frames, out):
    """The stroke's silhouettes overlaid, each outline coloured by its time (blue early, red late)."""
    imgs = [_load(f) for f in frames]
    bg = imgs[0][2, 2, :3]
    base = imgs[0].copy()
    base[..., :3] = bg * 0.9
    for k, a in enumerate(imgs):
        m = np.abs(a[..., :3] - bg).sum(-1) > 0.06
        er = m.copy()
        er[1:-1, 1:-1] = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
        edge = m & ~er
        t = k / max(len(imgs) - 1, 1)
        col = np.array([0.25 + 0.75 * t, 0.45, 1.0 - 0.75 * t])
        base[m, :3] = base[m, :3] * 0.93 + 0.035
        base[edge, :3] = col
    _save(base, out)


def plot_paths(paths, out, w=1400, h=420):
    """Side view of each tip's path through the water over two strokes, the whale swimming a
    quarter of its length per stroke (its pace in the game): a natural stroke draws a smooth wave."""
    a = np.zeros((h, w, 4), dtype=np.float32)
    a[..., :3] = (0.07, 0.10, 0.13)
    a[..., 3] = 1
    a[h // 2, :, :3] = 0.18
    colours = {'fluke tip': (1.0, 0.55, 0.2), 'flipper tip': (0.3, 0.8, 1.0), 'snout': (0.7, 1.0, 0.5)}
    stride = 0.25
    scale = h / 0.5
    for name, pts in paths.items():
        pts = np.asarray(pts)
        n = len(pts) - 1
        xs, zs = [], []
        for rep in range(2):
            for f in range(n):
                t = (rep * n + f) / n
                xs.append(pts[f, 1] + stride * t)
                zs.append(pts[f, 2])
        xs = np.asarray(xs)
        zs = np.asarray(zs) - np.mean(zs)
        px = (xs - xs.min()) / max(xs.max() - xs.min(), 1e-6) * (w - 40) + 20
        pz = h / 2 - zs * scale
        for i in range(len(px) - 1):
            for u in np.linspace(0, 1, 12):
                x = int(px[i] + (px[i + 1] - px[i]) * u)
                y = int(pz[i] + (pz[i + 1] - pz[i]) * u)
                a[max(0, y - 1):y + 2, max(0, x - 1):x + 2, :3] = colours.get(name, (1, 1, 1))
    _save(a[::-1].copy(), out)


def motion_numbers(arm):
    """Per bone over one stroke at 60 Hz (played at 1.0; the game plays the mother at ~0.8, the
    calf at ~1.5): its swing (deg), its worst angular velocity (rad/s) and acceleration (rad/s^2)
    and its tip's worst acceleration (body lengths/s^2), from the bone's direction (float64), and
    the step across the loop seam."""
    scene = bpy.context.scene
    dt = 1 / 60
    steps = int(round(STROKE_FRAMES / FPS / dt))
    pose = arm.pose.bones
    heads = {pb.name: [] for pb in pose}
    tails = {pb.name: [] for pb in pose}
    for i in range(steps + 3):
        f = i * dt * FPS
        scene.frame_set(int(f), subframe=f - int(f))
        for pb in pose:
            heads[pb.name].append(np.array(pb.head[:], dtype=np.float64))
            tails[pb.name].append(np.array(pb.tail[:], dtype=np.float64))
    out = {}
    for name in heads:
        H = np.array(heads[name])
        T = np.array(tails[name])
        D = T - H
        D /= np.linalg.norm(D, axis=1, keepdims=True)

        def between(a, b):
            return np.arctan2(np.linalg.norm(np.cross(a, b), axis=-1), (a * b).sum(-1))
        swing = between(D[0][None], D).max()
        vel = between(D[:-1], D[1:]) / dt
        acc = np.abs(np.diff(vel)) / dt
        tip_acc = np.linalg.norm(T[2:] - 2 * T[1:-1] + T[:-2], axis=1) / (dt * dt)
        out[name] = {'swingDeg': round(math.degrees(swing), 2), 'velMax': round(float(vel.max()), 4),
                     'accMax': round(float(acc.max()), 4), 'tipAccMax': round(float(tip_acc.max()), 4),
                     'seamDeg': round(math.degrees(float(between(D[0], D[steps]))), 4)}
    return out


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {}
    i = 0
    while i < len(argv):
        if argv[i].startswith('--'):
            key = argv[i][2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
                opts[key] = argv[i + 1]
                i += 2
                continue
            opts[key] = True
        i += 1
    bpy.ops.wm.read_factory_settings(use_empty=True)
    out = Path(opts.get('out', REPO / 'src/rendering/odyssey/assets/chapter-02/creatures/humpback-swim.glb'))
    d = mesh_whale(log=lambda m: print(TAG, m, flush=True))
    arm = build_rig(d, log=lambda m: print(TAG, m, flush=True))
    mesh = build_mesh(d, arm, log=lambda m: print(TAG, m, flush=True))
    pose_curves(arm, log=lambda m: print(TAG, m, flush=True))
    if not opts.get('no-export'):
        export_glb(arm, mesh, out, log=lambda m: print(TAG, m, flush=True))
    if opts.get('review'):
        review(arm, mesh, Path(opts['review']), log=lambda m: print(TAG, m, flush=True))
    if opts.get('blend'):
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(opts['blend'])))
        print(TAG, 'saved', opts['blend'])


if __name__ == '__main__':
    main()
