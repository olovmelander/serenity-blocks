"""Verdant Hills' sheep: a ewe and her lamb, modelled procedurally in Blender round the rig's joints.

Run by scripts/verdant-hills/model-sheep.mjs, which hands it the skeleton
(src/themes/verdant-hills/verdant-hills-sheep-rig.js) as JSON, then skins what it writes to that
skeleton and writes the assets:

    node scripts/verdant-hills/model-sheep.mjs [--animal=ewe|lamb|both] [--preview=<dir>]

or by hand (headless; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/verdant_hills_sheep.py -- \
        --animal ewe --skeleton <bones.json> --out <ewe-mesh.glb> [--preview <dir>]

The flock grazes the downs a hundred and fifty to nine hundred metres from the lens, so what has to
read is the silhouette and the value: a deep, boxy fleece whose outline is all locks, never a
smooth egg; a bare black head, long and Roman-nosed, with long black ears hanging out to the sides;
slim black legs under the wool. The ewe is a black-faced Suffolk cross, 0.72 m at the withers and
1.35 m from muzzle to tail, her tail docked to a woolly stub. Her lamb is six weeks old: a short
tight fleece of small curls on a small round barrel, long bare legs, a big black head with long
ears, and a long woolly tail it has not lost yet.

How it is made (the meshing is the Grainfields horse's, scripts/blender/grainfields/horse_sdf.py):

- **Shape.** A signed distance field of ellipsoids and round cones joined by smooth unions. The
  fleece is its own field (barrel, broad flat back, rump, brisket, the belly's hang, the woolly
  neck and the cap behind the poll, the sleeves on the forearms and the breeches down the
  gaskins, the tail) displaced by locks at two scales: cells of Worley noise a hand across that
  bulge out with creases between them, and a fine crimp. The bare parts are smooth: the head as
  cranium, a Roman-nosed face, cheeks and jaw, a soft muzzle and chin, long ears, a brow over each
  eye; each leg a tube through its own joints with a knobbly knee or hock, a cannon, a fetlock and
  a pastern to a cloven hoof.
- **Mesh.** The field's left half is sampled on a grid of a few millimetres, polygonised with
  surface nets, projected onto the zero set, decimated in Blender with a quadric edge collapse,
  cleaned of folds and mirrored, so the animal is exactly symmetric.
- **Parts.** Which part each vertex belongs to (body, head and neck, each leg, tail), by the nearest
  primitive, cleaned into one piece each: the skinning step weights by it.
- **Paint.** COLOR_0 = (fleece, soil, dark, sky seen): 1 on the wool and 0 on the bare skin; the
  wool's dirt under the belly, round the breech and along the fleece's ragged edge; the darkest
  places (eyes, nostrils, hooves, inside the ears); ambient occlusion traced through the field and
  the grass under it.

Frame: metres, +z forward (toward the head), +y up, the hooves on y = 0, the body centred on x = 0;
the sheep faces +z, so its left side is +x. No external asset is used: the field is the model.
"""

import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402

from grainfields.horse_sdf import (  # noqa: E402
    Displace, Ellipsoid, HalfSpace, RoundCone, Tube, Union, X_AXIS,
    _grid, _neighbours, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)

TAG = "[verdant-sheep]"
GENERATOR = "Serenity Blocks - Verdant Hills sheep (scripts/blender/verdant_hills_sheep.py)"
PARTS = {"body": 0, "head": 1, "frontLeft": 2, "frontRight": 3, "hindLeft": 4, "hindRight": 5, "tail": 6}
LEGS = (PARTS["frontLeft"], PARTS["frontRight"], PARTS["hindLeft"], PARTS["hindRight"])
# Per animal: grid voxel (metres) and the whole mirrored mesh's triangle budget.
SETTINGS = {
    "ewe": dict(voxel=0.006, triangles=3800),
    "lamb": dict(voxel=0.0045, triangles=2400),
}


def P(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


# -- the fleece's locks -------------------------------------------------------------------
def _hash3(ix, iy, iz, seed):
    """Three floats in [0, 1) for each integer cell (vectorised, deterministic)."""
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791)
    h = (h ^ seed) & 0xFFFFFFFF
    out = []
    for salt in (0x9E3779B1, 0x85EBCA77, 0xC2B2AE3D):
        v = (h * salt + 0x165667B1) & 0xFFFFFFFF
        v ^= v >> 15
        v = (v * 0x2C1B3C6D) & 0xFFFFFFFF
        v ^= v >> 12
        v = (v * 0x297A2D39) & 0xFFFFFFFF
        v ^= v >> 15
        out.append((v & 0xFFFFFF).astype(np.float64) / float(0x1000000))
    return out


def blobs(x, y, z, cell, seed, sigma=0.4):
    """A sum of round Gaussian bumps, one at each feature point of a jittered grid: smooth
    everywhere, high over each point and low in the hollows between them."""
    px, py, pz = x / cell, y / cell, z / cell
    cx, cy, cz = np.floor(px), np.floor(py), np.floor(pz)
    total = np.zeros(px.shape)
    inverse = 1.0 / (sigma * sigma)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                ix, iy, iz = cx + dx, cy + dy, cz + dz
                hx, hy, hz = _hash3(ix, iy, iz, seed)
                ddx = ix + 0.15 + 0.7 * hx - px
                ddy = iy + 0.15 + 0.7 * hy - py
                ddz = iz + 0.15 + 0.7 * hz - pz
                total += np.exp(-(ddx * ddx + ddy * ddy + ddz * ddz) * inverse)
    return total


def locks(big, fine, share, seed):
    """Locks of fleece: rounded domes about `big` across with soft hollows between them, and smaller
    ones over them (`share` of the height). Returns a unit displacement (-1 outward .. 0); the
    caller's amplitude makes it metres."""
    def fn(x, y, z):
        x, y, z = np.broadcast_arrays(x, y, z)
        shape = x.shape
        x, y, z = x.reshape(-1), y.reshape(-1), z.reshape(-1)
        # (Locks hang: a little taller than wide.) Narrow bumps, so a lock's crown and the hollow
        # between two locks differ by most of the amplitude.
        dome = np.minimum(blobs(x, y * 0.85, z, big, seed, sigma=0.31), 1.15) / 1.15
        small = np.minimum(blobs(x, y, z, fine, seed + 101, sigma=0.3), 1.15) / 1.15
        return (-((1.0 - share) * dome + share * small)).reshape(shape)
    return fn


# -- the animals --------------------------------------------------------------------------
def _leg(J, M, side, front, wool_to, r, sleeve, hoof):
    """One leg: the bare tube through its joints (knee or hock knobbly, cannon, fetlock, pastern,
    cloven hoof) and the wool that sleeves its top. Returns (bare, wool)."""
    s = 1.0 if side == "L" else -1.0
    names = ("arm", "fore", "hand", "pawF") if front else ("thigh", "shin", "hock", "pawB")
    top, middle, joint = J[names[0] + side], J[names[1] + side], J[names[2] + side]
    paw = np.asarray(M[names[3] + side], dtype=np.float64)
    fetlock = joint + (paw - joint) * 0.72 + P(0, 0, -0.012 if front else -0.006) * (r["unit"])
    pastern_end = paw + P(0, r["hoof"][1] * 1.2, -0.004 * r["unit"])
    bare = Union([
        Tube([middle, (middle + joint) * 0.5, joint], [r["upper"], r["upper"] * 0.9, r["joint"]], k=0.01 * r["unit"]),
        # The knee (or the hock): a knob a little proud of the line.
        (Ellipsoid(joint + P(0, 0, (0.006 if front else -0.01) * r["unit"]),
                   (r["joint"] * 1.08, r["joint"] * 1.25, r["joint"] * 1.12)), 0.012 * r["unit"]),
        Tube([joint, fetlock], [r["cannon"], r["cannon"] * 0.92], k=0.006 * r["unit"]),
        (Ellipsoid(fetlock, (r["cannon"] * 1.15, r["cannon"] * 1.2, r["cannon"] * 1.2)), 0.008 * r["unit"]),
        (RoundCone(fetlock, pastern_end, r["cannon"] * 0.95, r["cannon"] * 0.9), 0.006 * r["unit"]),
        # The hoof: two toes, nearly one at this size, splayed a hair at the front.
        (Ellipsoid(paw + P(0.0, hoof[1] * 0.85, 0.004 * r["unit"]), hoof, along=(0.0, -0.25, 1.0)),
         0.008 * r["unit"]),
    ])
    wool = None
    if sleeve:
        start = top * 0.35 + middle * 0.65
        end = middle + (joint - middle) * wool_to
        wool = Tube([start, middle, end], sleeve, k=0.02 * r["unit"])
    return bare, wool


def _head(J, M, d):
    """The bare head: cranium, Roman-nosed face, cheeks and jaw, soft muzzle and chin, brows, ears."""
    poll = J["head"]
    nose = np.asarray(M["nose"], dtype=np.float64)
    u = _unit(nose - poll)                     # down the face
    n = _unit(np.cross(u, np.array(X_AXIS)))   # up off the face
    if n[1] < 0:
        n = -n
    length = float(np.linalg.norm(nose - poll))
    a = d["unit"]
    parts = [
        Ellipsoid(poll + u * (0.22 * length), (0.058 * a, 0.062 * a, 0.078 * a), along=u),
        RoundCone(poll + u * (0.24 * length), nose - u * (0.14 * length), 0.056 * a, 0.035 * a, (X_AXIS, 0.84)),
        # The Roman nose: a long convex bridge over the line of the face.
        (Ellipsoid(poll + u * (0.58 * length) + n * (0.024 * a), (0.03 * a, 0.022 * a, 0.09 * a), along=u), 0.03 * a),
        # Cheeks and the jaw's angle, low and back.
        (Ellipsoid(poll + u * (0.36 * length) - n * (0.035 * a), (0.05 * a, 0.036 * a, 0.065 * a), along=u),
         0.03 * a),
        # The muzzle, soft and a little swollen, and the chin under it.
        (Ellipsoid(nose - u * (0.11 * length) - n * (0.006 * a), (0.034 * a, 0.033 * a, 0.034 * a)), 0.02 * a),
        (Ellipsoid(nose - u * (0.2 * length) - n * (0.038 * a), (0.024 * a, 0.017 * a, 0.03 * a), along=u),
         0.018 * a),
    ]
    for s in (1.0, -1.0):
        eye = np.asarray(M["eye"], dtype=np.float64) * np.array([s, 1.0, 1.0])
        parts.append((Ellipsoid(eye + n * (0.004 * a), (0.014 * a, 0.012 * a, 0.017 * a)), 0.012 * a))
    head = Union(parts, k=0.025 * a)
    ears = []
    for s in (1.0, -1.0):
        root = np.asarray(M["ear"], dtype=np.float64) * np.array([s, 1.0, 1.0])
        along = _unit(np.array([d["ear"][0] * s, d["ear"][1], d["ear"][2]]))
        # (Rooted a little out from the mark, so the whole ear hangs clear of the wool behind the poll.)
        ears.append(Ellipsoid(root + along * (d["earLength"] * 0.5 + 0.012 * a),
                              (d["earWidth"][0], d["earWidth"][1], d["earLength"] * 0.5), along=along))
    return Union([(head, 0.0), (Union(ears), 0.012 * a)]), u, n


def design(animal, J, M):
    """The animal as two distance fields round the rig's joints `J` and marks `M` — its fleece
    (displaced by locks) and its bare skin — and its landmarks. Returns (root, whole, wool, bare,
    landmarks): `root` is cut at the ground, `whole` is not."""
    lamb = animal == "lamb"
    a = 0.62 if lamb else 1.0
    tail_chain = [J["tail1"], J["tail2"], J["tail3"], np.asarray(M["tailTip"], dtype=np.float64)]
    if lamb:
        fleece = Union([
            Ellipsoid(P(0, 0.4, -0.02), (0.1, 0.1, 0.195)),
            (Ellipsoid(P(0, 0.452, -0.025), (0.09, 0.055, 0.185)), 0.06),
            (Ellipsoid(P(0, 0.405, -0.155), (0.1, 0.098, 0.095)), 0.06),
            (Ellipsoid(P(0, 0.385, 0.12), (0.092, 0.098, 0.085)), 0.06),
        ], k=0.055).tag(PARTS["body"], hair=True)
        neck = Tube([P(0, 0.41, 0.15), P(0, 0.465, 0.245), P(0, 0.515, 0.3)], [0.064, 0.05, 0.04],
                    squash_axis=X_AXIS, squash=[0.95, 0.92, 0.9], k=0.03)
        cap = Ellipsoid(P(0, 0.553, 0.305), (0.022, 0.016, 0.02))
        tail = Tube(tail_chain, [0.021, 0.019, 0.017, 0.014], k=0.01)
        leg_r = dict(unit=a, upper=0.021, joint=0.0195, cannon=0.0145, hoof=(0.018, 0.017, 0.024))
        fore_sleeve, hind_sleeve = [0.03, 0.022, 0.017], [0.04, 0.029, 0.021]
        fore_to, hind_to = 0.12, 0.18
        head_d = dict(unit=a * 1.3, ear=(0.8, -0.56, 0.2), earLength=0.078, earWidth=(0.014, 0.024))
        lock, lock_amp = locks(0.045, 0.022, 0.3, 7), 0.014
        neck_base = ((0.53, 0.115), (0.27, 0.235))
        cuts = dict(front=0.255, hind=0.3)
    else:
        fleece = Union([
            Ellipsoid(P(0, 0.592, -0.075), (0.205, 0.2, 0.415)),
            # The broad flat back of a fat ewe.
            (Ellipsoid(P(0, 0.672, -0.085), (0.188, 0.1, 0.4)), 0.1),
            (Ellipsoid(P(0, 0.605, -0.34), (0.2, 0.188, 0.188)), 0.08),
            (Ellipsoid(P(0, 0.565, 0.23), (0.172, 0.188, 0.158)), 0.08),
            # The belly hangs a little between the legs.
            (Ellipsoid(P(0, 0.47, -0.06), (0.172, 0.095, 0.28)), 0.08),
        ], k=0.09).tag(PARTS["body"], hair=True)
        neck = Tube([P(0, 0.628, 0.3), P(0, 0.705, 0.45), P(0, 0.765, 0.53)], [0.13, 0.1, 0.066],
                    squash_axis=X_AXIS, squash=[0.95, 0.9, 0.88], k=0.05)
        # A tuft of wool on the poll, behind the ears.
        cap = Ellipsoid(P(0, 0.825, 0.548), (0.036, 0.026, 0.034))
        tail = Tube(tail_chain[:3], [0.056, 0.05, 0.042], k=0.02)
        leg_r = dict(unit=a, upper=0.031, joint=0.0275, cannon=0.0205, hoof=(0.027, 0.024, 0.035))
        fore_sleeve, hind_sleeve = [0.064, 0.05, 0.038], [0.08, 0.062, 0.047]
        fore_to, hind_to = 0.2, 0.45
        head_d = dict(unit=a, ear=(0.88, -0.42, 0.22), earLength=0.14, earWidth=(0.017, 0.034))
        lock, lock_amp = locks(0.105, 0.05, 0.3, 3), 0.04
        neck_base = ((0.86, 0.2), (0.4, 0.43))
        cuts = dict(front=0.36, hind=0.385)
    neck_wool = Union([(neck, 0.0), (cap, 0.03 * a)]).tag(PARTS["head"], hair=True)
    tail = tail.tag(PARTS["tail"], hair=True)
    head, u, n = _head(J, M, head_d)
    head = head.tag(PARTS["head"])

    legs_bare, legs_wool = [], []
    for side in ("L", "R"):
        for front in (True, False):
            part = PARTS[("front" if front else "hind") + ("Left" if side == "L" else "Right")]
            bare, wool = _leg(J, M, side, front, fore_to if front else hind_to, leg_r,
                              fore_sleeve if front else hind_sleeve, leg_r["hoof"])
            legs_bare.append(bare.tag(part))
            if wool is not None:
                legs_wool.append(wool.tag(part, hair=True))

    wool = Union([(fleece, 0.0), (neck_wool, 0.07 * a), (tail, 0.03 * a), *[(w, 0.05 * a) for w in legs_wool]])
    shaggy = Displace(wool, lock_amp, lock)
    bare = Union([(head, 0.0), *[(leg, 0.0) for leg in legs_bare]])
    whole = Union([(shaggy, 0.0), (bare, 0.02 * a)])
    root = HalfSpace(whole, axis=1)
    nose = np.asarray(M["nose"], dtype=np.float64)
    landmarks = dict(
        nose=nose, u=u, n=n,
        eyes=[np.asarray(M["eye"], dtype=np.float64) * np.array([s, 1.0, 1.0]) for s in (1, -1)],
        ears=[np.asarray(M["ear"], dtype=np.float64) * np.array([s, 1.0, 1.0]) for s in (1, -1)],
        earLength=head_d["earLength"],
        neckBase=neck_base,
        frontCut=cuts["front"],
        hindCut=cuts["hind"],
        belly=0.5 if not lamb else 0.33,
        breech=float(J["hips"][2]) - (0.16 if not lamb else 0.09),
        unit=a,
    )
    return root, whole, wool, bare, landmarks


# -- parts, occlusion and paint ----------------------------------------------------------
def _clean_parts(parts, neighbours, passes=3):
    """Vote away stray vertices, then keep each part to one connected region."""
    parts = parts.copy()
    for _ in range(passes):
        updated = parts.copy()
        for vertex, around in enumerate(neighbours):
            if not len(around):
                continue
            values, counts = np.unique(parts[around], return_counts=True)
            if np.count_nonzero(parts[around] == parts[vertex]) * 3 < len(around):
                updated[vertex] = values[np.argmax(counts)]
        parts = updated
    for part in np.unique(parts):
        seen = np.zeros(len(parts), dtype=bool)
        regions = []
        for start in np.nonzero(parts == part)[0]:
            if seen[start]:
                continue
            region, stack = [], [start]
            seen[start] = True
            while stack:
                vertex = stack.pop()
                region.append(vertex)
                for other in neighbours[vertex]:
                    if not seen[other] and parts[other] == part:
                        seen[other] = True
                        stack.append(other)
            regions.append(region)
        regions.sort(key=len, reverse=True)
        for region in regions[1:]:
            around = np.concatenate([neighbours[v] for v in region])
            around = around[parts[around] != part]
            if len(around):
                values, counts = np.unique(parts[around], return_counts=True)
                parts[region] = values[np.argmax(counts)]
    return parts


def regions(whole, landmarks, positions, triangles):
    """Which part each vertex belongs to, by the nearest primitive (cleaned into one piece each)."""
    leaves = whole.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    leaf_parts = np.array([leaf.part for leaf in leaves])
    y = positions[:, 1]
    claim = distances.copy()
    for column, part in enumerate(leaf_parts):
        if part in (PARTS["frontLeft"], PARTS["frontRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["frontCut"])
        elif part in (PARTS["hindLeft"], PARTS["hindRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["hindCut"])
        elif part == PARTS["tail"]:
            # The tail is small against the rump it hangs from: let it have its own wool.
            claim[:, column] -= 0.014 * landmarks["unit"]
    parts = leaf_parts[np.argmin(claim, axis=1)]
    left = positions[:, 0] >= 0.0
    parts = np.where((parts == PARTS["frontRight"]) & left, PARTS["frontLeft"], parts)
    parts = np.where((parts == PARTS["frontLeft"]) & ~left, PARTS["frontRight"], parts)
    parts = np.where((parts == PARTS["hindRight"]) & left, PARTS["hindLeft"], parts)
    parts = np.where((parts == PARTS["hindLeft"]) & ~left, PARTS["hindRight"], parts)
    # Between the neck and the body the boundary is the plane at the base of the neck.
    (top_y, top_z), (low_y, low_z) = landmarks["neckBase"]
    ahead = (positions[:, 1] - top_y) * (low_z - top_z) + (positions[:, 2] - top_z) * (top_y - low_y) > 0.0
    trunk = np.isin(parts, (PARTS["body"], PARTS["head"]))
    parts = np.where(trunk, np.where(ahead, PARTS["head"], PARTS["body"]), parts)
    parts = _clean_parts(parts, _neighbours(len(positions), triangles))
    return parts


def occlusion(shape, positions, normals, rays=32, reach=0.6, ground=0.7, unit=1.0):
    """The share of the sky over each vertex that the sheep (and, partly, the grass under it) hides,
    by rays sphere-traced through the field over a cosine-weighted hemisphere."""
    count = len(positions)
    k = np.arange(rays) + 0.5
    r = np.sqrt(k / rays)
    phi = k * math.pi * (3.0 - math.sqrt(5.0))
    local = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1.0 - r * r)], axis=1)
    helper = np.where(np.abs(normals[:, 1:2]) < 0.9, np.array([[0.0, 1.0, 0.0]]), np.array([[1.0, 0.0, 0.0]]))
    tangent = np.cross(helper, normals)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=1), 1e-9)[:, None]
    bitangent = np.cross(normals, tangent)
    seen = np.zeros(count)
    start = positions + normals * 0.004 * unit
    reach = reach * unit
    for d in local:
        direction = tangent * d[0] + bitangent * d[1] + normals * d[2]
        down = direction[:, 1] < -1e-6
        t_ground = np.where(down, start[:, 1] / np.maximum(-direction[:, 1], 1e-6), np.inf)
        t = np.full(count, 0.01 * unit)
        alive = np.ones(count, dtype=bool)
        blocked = np.zeros(count)
        for _ in range(30):
            if not alive.any():
                break
            index = np.nonzero(alive)[0]
            p = start[index] + direction[index] * t[index, None]
            field = shape.eval(p)
            hit = field < 0.002 * unit
            blocked[index[hit]] = 1.0
            t[index] += np.maximum(field, 0.005 * unit)
            grounded = ~hit & (t[index] >= t_ground[index]) & (t_ground[index] < reach)
            blocked[index[grounded]] = ground
            alive[index[hit | grounded]] = False
            alive &= t < reach
        seen += 1.0 - blocked
    return np.clip(seen / rays, 0.0, 1.0)


def paint(whole, wool, bare, landmarks, positions, normals, parts):
    """COLOR_0 = (fleece, soil, dark, sky seen), each 0..1."""
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    a = landmarks["unit"]
    # Wool where the fleece's field is nearer than the skin's.
    d_wool = wool.eval(positions)
    d_bare = bare.eval(positions)
    fleece = _smoothstep(-0.004 * a, 0.006 * a, d_bare - d_wool)
    # Dirt: under the belly, round the breech, and on the ragged edge where the fleece meets skin.
    under = _smoothstep(landmarks["belly"], landmarks["belly"] - 0.14 * a, y)
    breech = _smoothstep(landmarks["breech"], landmarks["breech"] - 0.12 * a, z) * _smoothstep(
        landmarks["belly"] + 0.22 * a, landmarks["belly"] - 0.05 * a, y)
    fringe = _smoothstep(0.05 * a, 0.0, np.abs(d_bare - d_wool)) * np.isin(parts, LEGS)
    soil = np.clip(0.75 * under + 0.65 * breech + 0.55 * fringe, 0.0, 1.0) * fleece
    # The darkest places: eyes, nostrils, the hooves, inside the ears.
    nose, u, n = landmarks["nose"], landmarks["u"], landmarks["n"]
    eyes = np.min([np.linalg.norm((positions - eye) * np.array([1.0, 1.25, 0.85]), axis=1)
                   for eye in landmarks["eyes"]], axis=0)
    nostrils = np.min([np.linalg.norm(positions - (nose + np.array([s * 0.016 * a, 0.0, 0.0]) + n * 0.006 * a
                                                   - u * 0.004 * a), axis=1) for s in (1, -1)], axis=0)
    legs = np.isin(parts, LEGS)
    hooves = legs * _smoothstep(0.05 * a, 0.03 * a, y)
    ear_inside = np.zeros(len(positions))
    for ear in landmarks["ears"]:
        to_ear = positions - ear
        along = np.linalg.norm(to_ear, axis=1)
        ear_inside = np.maximum(ear_inside, _smoothstep(landmarks["earLength"] * 1.05, landmarks["earLength"] * 0.3,
                                                        along) * _smoothstep(0.1, -0.5, normals[:, 1])
                                * (parts == PARTS["head"]) * (1.0 - fleece) * _smoothstep(0.03 * a, 0.06 * a,
                                                                                          np.abs(x)))
    dark = np.maximum.reduce([
        _smoothstep(0.016 * a, 0.009 * a, eyes),
        _smoothstep(0.013 * a, 0.006 * a, nostrils),
        hooves * 0.9,
        ear_inside * 0.55,
    ]) * (1.0 - fleece)
    sky = occlusion(whole, positions, normals, unit=a)
    print("%s paint: wool %d verts, skin %d, dark %d, soiled %d, sky seen %.2f..%.2f (mean %.2f)" % (
        TAG, int((fleece > 0.5).sum()), int((fleece <= 0.5).sum()), int((dark > 0.5).sum()), int((soil > 0.4).sum()),
        sky.min(), sky.max(), sky.mean()), flush=True)
    return np.stack([fleece, soil, dark, sky], axis=1)


# -- building it ---------------------------------------------------------------------------
class Sheep:
    def __init__(self, animal, positions, normals, colors, triangles, parts, stats):
        self.animal = animal
        self.positions, self.normals, self.colors = positions, normals, colors
        self.triangles, self.parts, self.stats = triangles, parts, stats

    def measures(self):
        body = self.positions[self.parts == PARTS["body"]]
        mid = float(np.median(body[:, 2]))
        withers = body[(body[:, 2] > mid + 0.05) & (body[:, 2] < body[:, 2].max() - 0.02)]
        rump = body[body[:, 2] < mid - 0.15]
        return dict(withersHeight=float(withers[:, 1].max()), rumpHeight=float(rump[:, 1].max()),
                    bellyHeight=float(body[:, 1].min()),
                    length=float(np.ptp(self.positions[:, 2])), width=float(np.ptp(self.positions[:, 0])),
                    height=float(self.positions[:, 1].max()))


def build(studio, animal, skeleton, voxel, target):
    """Polygonise and decimate the left half, mirror it, then sort it into parts and paint it."""
    started = time.time()
    J = {bone[0]: np.array(bone[2:5], dtype=np.float64) for bone in skeleton["bones"]}
    M = skeleton["marks"]
    shape, whole, wool, bare, landmarks = design(animal, J, M)
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    sampled = time.time()
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    netted = time.time()
    positions, triangles = decimate(studio, dense, dense_triangles, target // 2)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    # Normals from the field: crisp on the bare skin, taken over a finger's width on the wool so
    # the locks shade as soft rounds and not as facets.
    woolly = _smoothstep(-0.004, 0.008, bare.eval(positions) - wool.eval(positions))[:, None]
    grad = gradient(shape, positions) * (1.0 - woolly)
    soft = gradient(shape, positions, eps=0.012 * landmarks["unit"])
    grad = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None] + woolly * (
        soft / np.maximum(np.linalg.norm(soft, axis=1), 1e-12)[:, None])
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    # The soles stand flat on the grass: their normals point straight down.
    normals[positions[:, 1] <= 1e-6] = np.array([0.0, -1.0, 0.0])
    parts = regions(whole, landmarks, positions, triangles)
    colors = paint(whole, wool, bare, landmarks, positions, normals, parts)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_triangles=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=folds, mesh_normals=int(disagree.sum()),
                 field_s=sampled - started, nets_s=netted - sampled, total_s=time.time() - started)
    sheep = Sheep(animal, positions, normals, colors, triangles, parts, stats)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s %s grid %s dense %d tris -> mirrored %d tris %d verts (%d folds, %d mesh normals); "
          "x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s; parts %s; field %.1fs nets %.1fs total %.1fs" % (
              TAG, animal, "x".join(str(v) for v in stats["grid"]), stats["dense_triangles"], stats["triangles"],
              stats["vertices"], folds, stats["mesh_normals"], low[0], high[0], low[1], high[1], low[2], high[2],
              {key: round(value, 3) for key, value in sheep.measures().items()},
              {name: int((parts == index).sum()) for name, index in PARTS.items()},
              stats["field_s"], stats["nets_s"], stats["total_s"]), flush=True)
    return sheep


def write(path, sheep):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("verdant-" + sheep.animal, {
        "POSITION": (sheep.positions, False),
        "NORMAL": (sheep.normals.astype(np.float32), False),
        "COLOR_0": (glb.quantize_unit(sheep.colors, np.uint8), True),
        "_PART": (sheep.parts.astype(np.uint8), False),
    }, indices=sheep.triangles, position_bits=32)
    writer.set_extras(dict(
        name="verdant-" + sheep.animal, animal=sheep.animal, parts=PARTS,
        **{key: round(value, 4) for key, value in sheep.measures().items()},
        triangles=int(len(sheep.triangles)), vertices=int(len(sheep.positions)),
        color={"r": "fleece (1 wool, 0 bare skin)", "g": "soil (dirty wool)", "b": "dark (eyes, nostrils, hooves, "
               "inside the ears)", "a": "sky seen"},
    ))
    return writer.write(path)


# -- previews (never shipped) -------------------------------------------------------------
PART_COLOURS = np.array([
    [0.85, 0.82, 0.74], [0.95, 0.55, 0.35], [0.3, 0.6, 0.95], [0.25, 0.85, 0.6],
    [0.85, 0.35, 0.8], [0.9, 0.85, 0.25], [0.6, 0.3, 0.2],
])


def coat_colours(sheep):
    """What the game paints, roughly: cream wool (soiled toward ochre), black skin, the hollows darker."""
    fleece, soil, dark, sky = (sheep.colors[:, i:i + 1] for i in range(4))
    clean = np.array([[0.86, 0.83, 0.74]]) if sheep.animal == "ewe" else np.array([[0.93, 0.92, 0.86]])
    wool = clean * (1.0 - soil * 0.45) + np.array([[0.42, 0.34, 0.22]]) * soil * 0.45
    skin = np.array([[0.035, 0.03, 0.028]]) * (1.0 - dark * 0.6)
    return (wool * fleece + skin * (1.0 - fleece)) * (0.35 + 0.65 * sky)


def previews(sheep, directory):
    import bpy
    from mathutils import Vector
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    started = time.time()
    lights = []
    name = sheep.animal
    s = 1.0 if name == "ewe" else 0.62

    def sheep_object(label, colours, offset=(0.0, 0.0, 0.0), turn=0.0):
        positions = sheep.positions.copy()
        if turn:
            c, si = math.cos(turn), math.sin(turn)
            px, pz = positions[:, 0].copy(), positions[:, 2].copy()
            positions[:, 0], positions[:, 2] = c * px + si * pz, -si * px + c * pz
        positions += np.asarray(offset)
        obj = studio.mesh_object(label, positions, sheep.triangles, colors=colours)
        normals = sheep.normals.copy()
        if turn:
            nx, nz = normals[:, 0].copy(), normals[:, 2].copy()
            normals[:, 0], normals[:, 2] = c * nx + si * nz, -si * nx + c * nz
        obj.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(normals)])
        obj.data.materials.append(studio.material(label, roughness=0.9))
        return obj

    def sky(colour, strength):
        world = studio.scene.world
        world.use_nodes = True
        background = world.node_tree.nodes["Background"]
        background.inputs["Color"].default_value = (*colour, 1.0)
        background.inputs["Strength"].default_value = strength

    def sun(toward, strength, colour=(1.0, 0.95, 0.88)):
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        lights.clear()
        data = bpy.data.lights.new(studio_module.PREFIX + "sheep_sun", "SUN")
        data.energy = strength
        data.color = colour
        data.angle = math.radians(2.0)
        light = bpy.data.objects.new(studio_module.PREFIX + "sheep_sun", data)
        studio.scene.collection.objects.link(light)
        direction = _unit(to_blender(np.array([toward]))[0])
        light.rotation_euler = Vector(direction).to_track_quat("Z", "Y").to_euler()
        lights.append(light)

    def remove(objects):
        for obj in objects:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(data)

    try:
        extent = 60.0
        ground = studio.mesh_object("sheep_ground", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([[0.2, 0.36, 0.08]], (4, 1)))
        ground.data.materials.append(studio.material("sheep_ground", roughness=1.0))
        obj = sheep_object("sheep_coat", coat_colours(sheep))
        sky((0.5, 0.62, 0.8), 0.8)
        sun((0.45, 0.75, -0.5), 3.6)
        h = 0.5 * s
        shots = {
            "side": dict(eye=(3.4 * s, h, 0.12 * s), target=(0.0, h, 0.12 * s), lens=50.0, size=(1200, 760)),
            "three-quarter": dict(eye=(2.3 * s, 1.0 * s, 2.3 * s), target=(0.0, h, 0.1 * s), lens=46.0,
                                  size=(1100, 860)),
            "front": dict(eye=(0.35 * s, 0.75 * s, 3.0 * s), target=(0.0, h, 0.2 * s), lens=50.0, size=(860, 860)),
            "rear": dict(eye=(-1.6 * s, 1.0 * s, -2.6 * s), target=(0.0, h, -0.1 * s), lens=46.0, size=(900, 800)),
            "head": dict(eye=(0.75 * s, 0.9 * s, 1.35 * s), target=(0.0, 0.72 * s, 0.68 * s), lens=55.0,
                         size=(860, 860)),
            "head-side": dict(eye=(1.2 * s, 0.75 * s, 0.7 * s), target=(0.0, 0.72 * s, 0.68 * s), lens=60.0,
                              size=(860, 680)),
            "legs": dict(eye=(1.3 * s, 0.25 * s, 0.9 * s), target=(0.0, 0.2 * s, 0.0), lens=40.0, size=(1000, 700)),
        }
        for label, shot in shots.items():
            studio.render(directory / ("%s-%s.png" % (name, label)), samples=20, **shot)
        remove([obj])
        # As the game sees them: a group of four, turned this way and that, from 250 m with a long
        # lens (each sheep a few dozen pixels), and the same at the game's own size, scaled up.
        group = [sheep_object("sheep_g%d" % i, coat_colours(sheep), offset=(dx * s, 0.0, dz * s), turn=turn)
                 for i, (dx, dz, turn) in enumerate([(-1.6, 0.4, 1.2), (0.0, 0.0, -0.4), (1.5, -0.6, 2.6),
                                                     (0.7, 1.4, -1.9)])]
        sun((0.35, 0.8, -0.45), 3.6)
        studio.render(directory / ("%s-far.png" % name), eye=(60.0, 14.0, 240.0), target=(0.0, 0.4 * s, 0.0),
                      lens=900.0, size=(900, 500), samples=24)
        studio.render(directory / ("%s-gamesize.png" % name), eye=(60.0, 14.0, 240.0), target=(0.0, 0.4 * s, 0.0),
                      lens=120.0, size=(240, 135), samples=24)
        remove(group)
        parts = sheep_object("sheep_parts", PART_COLOURS[sheep.parts])
        sky((0.6, 0.62, 0.66), 0.9)
        sun((0.5, 0.7, 0.6), 3.0, colour=(1.0, 1.0, 1.0))
        studio.render(directory / ("%s-parts.png" % name), eye=(2.3 * s, 1.0 * s, 2.3 * s),
                      target=(0.0, h, 0.1 * s), lens=46.0, size=(1000, 760), samples=12)
        remove([parts])
        shade = sheep_object("sheep_ao", np.repeat(sheep.colors[:, 3:4], 3, axis=1) * 0.85)
        studio.render(directory / ("%s-ao.png" % name), eye=(2.3 * s, 0.6 * s, 2.0 * s), target=(0.0, h, 0.1 * s),
                      lens=46.0, size=(1000, 760), samples=12)
        remove([shade, ground])
    finally:
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        studio.dispose()
    print("%s previews in %s  %.1fs" % (TAG, directory, time.time() - started), flush=True)


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {}
    key = None
    for argument in arguments:
        if argument.startswith("--"):
            key = argument[2:]
            options[key] = True
        elif key:
            options[key] = argument
            key = None
    animal = options.get("animal", "ewe")
    if animal not in SETTINGS or "skeleton" not in options or "out" not in options:
        raise SystemExit("usage: blender --background --factory-startup --python verdant_hills_sheep.py -- "
                         "--animal ewe|lamb --skeleton <bones.json> --out <mesh.glb> [--preview <dir>]")
    skeleton = json.loads(Path(options["skeleton"]).read_text(encoding="utf-8"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Verdant Hills - Sheep Atelier"
    studio_module.PREFIX = "SVSHEEP_"
    studio = studio_module.Studio()
    settings = SETTINGS[animal]
    try:
        sheep = build(studio, animal, skeleton, voxel=float(options.get("voxel", settings["voxel"])),
                      target=int(options.get("triangles", settings["triangles"])))
    finally:
        studio.dispose()
    out = Path(options["out"]).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    size = write(out, sheep)
    print("%s wrote %s (%d bytes)" % (TAG, out, size), flush=True)
    if options.get("preview") and options["preview"] is not True:
        previews(sheep, Path(options["preview"]).expanduser().resolve())


if __name__ == "__main__":
    main()
