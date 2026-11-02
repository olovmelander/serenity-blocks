"""Odyssey's pond birds: a mute swan and a grey heron, modelled and rigged procedurally in headless Blender.

    blender -b --factory-startup --python scripts/blender/odyssey/pond_birds.py -- \
        --out-dir src/rendering/odyssey/assets/chapter-03/pond [--preview <dir>]

Life at the tarn (the chapter-3 basin's pond, docs/ODYSSEY_GROUND_ANIMALS_2026-11.md "Life at the
pond"): a pair of swans glides across it and a heron stands in the shallows. Seen from the rail
200-270 metres off and drawn at three times life, like the rest of the act's life, so a swan is
some twenty-five pixels long on a 1440p screen and the heron some fifteen pixels tall. What has to
read is the silhouette and the value: the swan's white body riding low with its neck in an S and an
orange bill; the heron's grey body on long legs, a white neck, a dark crest and a yellow bill.

How they are made: the red deer's way (red_deer.py, after the Grainfields horse): a signed distance
field of ellipsoids, round cones and tubes in smooth unions, its left half polygonised with surface
nets, decimated, cleaned and mirrored, then painted and skinned.

- **Swan** (`swan.glb`): the hull cut flat at the waterline (y = 0), the breast, the arched wings
  over the back and the raised tail; the long neck in an S; the head, the orange bill and its black
  knob. Bones: root, four neck bones, head.
- **Heron** (`heron.glb`): the body tilted up at the front, the folded wings, the short tail and the
  breast plumes; the neck in its resting S; the head, the long dagger bill, the black crest; the
  long legs to the toes (thicker than life so they stay lines when drawn small; the toes stand on
  y = 0). Bones: root, three neck bones, head, and each leg's thigh, shin and foot.
- **Skin.** Up to four bones a vertex (`_BONES`, `_WEIGHTS`), down each chain with blends at the
  joints, smoothed over the mesh. Every bone rests aligned with the bird's axes (x left, y up,
  z forward); a pose turns a bone about its head in its parent's frame.
- **Paint.** COLOR_0 = (bill, dark, white, sky seen): the swan's orange bill, the dark knob and eyes,
  its white everywhere else; the heron's yellow bill and legs, its black crest, eye stripe, shoulder
  patch and wing edge, its white face, neck and breast, grey elsewhere.

Frame: metres at real size, +z forward, +y up, x = 0 the bird's plane of symmetry. No external
asset is used.
"""

import json
import math
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from grainfields.horse_sdf import (  # noqa: E402
    X_AXIS, Ellipsoid, HalfSpace, RoundCone, Tube, Union,
    _grid, _neighbours, _point, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)
from grainfields.horse import occlusion  # noqa: E402

TAG = "[odyssey-pond-birds]"
GENERATOR = "Serenity Blocks - Odyssey pond birds (scripts/blender/odyssey/pond_birds.py)"
SCHEMA_VERSION = 1


def _segment_t(points, a, b):
    ab = np.asarray(b) - np.asarray(a)
    return np.clip(((points - a) @ ab) / max(ab @ ab, 1e-12), 0.0, 1.0)


def _polyline_t(points, knots):
    """Each point's place along a polyline (0 at its first knot, 1 at its last), by its nearest
    segment."""
    knots = np.asarray(knots, dtype=np.float64)
    lengths = np.linalg.norm(np.diff(knots, axis=0), axis=1)
    starts = np.concatenate([[0.0], np.cumsum(lengths)])
    total = starts[-1]
    best = np.full(len(points), np.inf)
    out = np.zeros(len(points))
    for i in range(len(knots) - 1):
        t = _segment_t(points, knots[i], knots[i + 1])
        closest = knots[i] + t[:, None] * (knots[i + 1] - knots[i])
        d = np.linalg.norm(points - closest, axis=1)
        better = d < best
        best[better] = d[better]
        out[better] = (starts[i] + t[better] * lengths[i]) / total
    return out


def _chain_weights(t, knots_t, names, band):
    """Weights down a chain by a parameter t: each joint (knots_t, increasing) blends its two bones
    over +-band."""
    out = {}
    upper = np.ones_like(t)
    for j, at in enumerate(knots_t):
        past = _smoothstep(at - band, at + band, t)
        out[names[j]] = upper * (1.0 - past)
        upper = upper * past
    out[names[len(knots_t)]] = upper
    return out


def regions(shape, positions, triangles):
    """Each vertex's part: the nearest primitive's, cleaned by its neighbours' votes."""
    leaves = shape.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    parts = np.array([leaves[i].part for i in np.argmin(distances, axis=1)])
    neighbours = _neighbours(len(positions), triangles)
    for _ in range(3):
        votes = parts.copy()
        for v, around in enumerate(neighbours):
            if len(around) < 3:
                continue
            values, counts = np.unique(parts[around], return_counts=True)
            best = values[np.argmax(counts)]
            if best != parts[v] and counts.max() >= 0.6 * len(around):
                votes[v] = best
        parts = votes
    return parts


def finish_weights(weights, triangles, smoothing=3):
    """Normalised, smoothed over the mesh, the four strongest quantised to bytes that sum to 255."""
    weights = weights / np.maximum(weights.sum(axis=1, keepdims=True), 1e-9)
    neighbours = _neighbours(len(weights), triangles)
    for _ in range(smoothing):
        mean = np.stack([weights[around].mean(axis=0) if len(around) else weights[v]
                         for v, around in enumerate(neighbours)])
        weights = 0.5 * weights + 0.5 * mean
    order = np.argsort(-weights, axis=1)[:, :4]
    top = np.take_along_axis(weights, order, axis=1)
    top /= np.maximum(top.sum(axis=1, keepdims=True), 1e-9)
    quant = np.floor(top * 255.0).astype(np.int64)
    quant[:, 0] += 255 - quant.sum(axis=1)
    return order.astype(np.uint8), quant.astype(np.uint8)


# == THE SWAN =============================================================================
SWAN_PARTS = {"body": 0, "neck": 1, "head": 2, "bill": 3, "knob": 4}
# The neck's S, (y, z): up and forward from the breast, back at the top, the head held forward.
SWAN_NECK = [(0.17, 0.36), (0.33, 0.46), (0.50, 0.46), (0.63, 0.41), (0.72, 0.385)]
SWAN_HEAD_FORWARD = _unit(np.array([0.0, -0.32, 0.95]))
SWAN_POLL = _point(0.745, 0.40)


def swan_bones():
    return [
        ("root", None, (0.0, 0.12, 0.0)),
        ("neck0", "root", (0.0, 0.17, 0.36)),
        ("neck1", "neck0", (0.0, 0.33, 0.46)),
        ("neck2", "neck1", (0.0, 0.50, 0.46)),
        ("neck3", "neck2", (0.0, 0.63, 0.41)),
        ("head", "neck3", (0.0, 0.72, 0.385)),
    ]


def swan_design():
    P = SWAN_PARTS
    body = Union([
        # The hull, low and long, riding with its keel under the water (cut at y = 0).
        Ellipsoid(_point(0.08, -0.03), (0.21, 0.17, 0.47)),
        # The full breast forward, the stern lifting to the tail.
        Ellipsoid(_point(0.11, 0.27), (0.17, 0.15, 0.19)),
        (Ellipsoid(_point(0.20, -0.40), (0.11, 0.075, 0.15), along=(0.0, 0.42, -0.91)), 0.06),
        # The wings folded and lifted a little over the back (the mute swan's arched back).
        *[(Ellipsoid(_point(0.22, -0.08, 0.095 * s), (0.11, 0.085, 0.34), along=(0.0, 0.16, 0.99)), 0.07)
          for s in (1.0, -1.0)],
    ], k=0.08).tag(P["body"])
    neck = Tube([_point(y, z) for y, z in SWAN_NECK], [0.088, 0.058, 0.05, 0.045, 0.044],
                squash_axis=X_AXIS, squash=[0.8, 0.85, 0.88, 0.9, 0.9], k=0.03).tag(P["neck"])
    f = SWAN_HEAD_FORWARD
    head = Union([
        Ellipsoid(SWAN_POLL + 0.03 * f, (0.042, 0.046, 0.068), along=f),
        *[Ellipsoid(SWAN_POLL + 0.045 * f + np.array([0.03 * s, 0.006, 0.0]), (0.012, 0.012, 0.012))
          for s in (1.0, -1.0)],
    ], k=0.02).tag(P["head"])
    bill = RoundCone(SWAN_POLL + 0.085 * f + np.array([0.0, -0.01, 0.0]), SWAN_POLL + 0.18 * f + np.array([0.0, -0.022, 0.0]),
                     0.03, 0.013, (X_AXIS, 0.75)).tag(P["bill"])
    knob = Ellipsoid(SWAN_POLL + 0.08 * f + np.array([0.0, 0.02, 0.0]), (0.018, 0.022, 0.024), along=f).tag(P["knob"])
    root = HalfSpace(Union([(body, 0.0), (neck, 0.09), (head, 0.04), (bill, 0.02), (knob, 0.015)]), axis=1)
    landmarks = dict(eyes=[SWAN_POLL + 0.045 * f + np.array([0.034 * s, 0.006, 0.0]) for s in (1.0, -1.0)],
                     billTip=SWAN_POLL + 0.18 * f)
    return root, landmarks


def swan_skin(positions, parts, triangles, index):
    weights = np.zeros((len(positions), len(index)))
    P = SWAN_PARTS

    def put(mask, name, value):
        weights[mask, index[name]] += value[mask] if np.ndim(value) else value

    body = parts == P["body"]
    put(body, "root", 1.0)
    neck = parts == P["neck"]
    knots = np.array([[0.0, y, z] for y, z in SWAN_NECK])
    t = _polyline_t(positions, knots)
    lengths = np.linalg.norm(np.diff(knots, axis=0), axis=1)
    at = np.cumsum(lengths)[:-1] / lengths.sum()
    chain = _chain_weights(t, list(at) + [0.98], ["neck0", "neck1", "neck2", "neck3", "head"], 0.06)
    base = _smoothstep(0.18, 0.0, t)
    for name, value in chain.items():
        put(neck, name, value * (1.0 - 0.7 * base))
    put(neck, "root", 0.7 * base)
    for part in ("head", "bill", "knob"):
        put(parts == P[part], "head", 1.0)
    return weights


def swan_paint(shape, landmarks, positions, normals, parts):
    P = SWAN_PARTS
    bill = (parts == P["bill"]).astype(float)
    eyes = np.maximum.reduce([_smoothstep(0.02, 0.011, np.linalg.norm(positions - e, axis=1))
                              for e in landmarks["eyes"]])
    # The black knob, the bill's nail and its edge at the face.
    nail = _smoothstep(0.03, 0.015, np.linalg.norm(positions - landmarks["billTip"], axis=1))
    dark = np.clip(np.maximum.reduce([(parts == P["knob"]).astype(float), eyes, nail * 0.8]), 0.0, 1.0)
    white = np.clip(1.0 - bill - dark, 0.0, 1.0)
    seen = occlusion(shape, positions, normals, rays=16, reach=0.5, ground=0.0)
    return np.stack([bill, dark, white, seen], axis=1)


# == THE HERON ============================================================================
HERON_PARTS = {"body": 0, "neck": 1, "head": 2, "bill": 3, "crest": 4, "legLeft": 5, "legRight": 6}
HERON_NECK = [(0.71, 0.13), (0.80, 0.20), (0.87, 0.16), (0.935, 0.14), (0.99, 0.18)]
HERON_HIP = (0.56, -0.01)
HERON_HEEL = (0.30, -0.035)
HERON_FOOT = (0.035, 0.0)
HERON_X = 0.045
LEG_THICKEN = 1.9


def heron_bones():
    bones = [
        ("root", None, (0.0, 0.62, 0.0)),
        ("neck0", "root", (0.0, 0.71, 0.13)),
        ("neck1", "neck0", (0.0, 0.80, 0.20)),
        ("neck2", "neck1", (0.0, 0.87, 0.16)),
        ("head", "neck2", (0.0, 0.99, 0.18)),
    ]
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x = HERON_X * side
        bones += [
            ("thigh" + tag, "root", (x, HERON_HIP[0], HERON_HIP[1])),
            ("shin" + tag, "thigh" + tag, (x, HERON_HEEL[0], HERON_HEEL[1])),
            ("foot" + tag, "shin" + tag, (x, HERON_FOOT[0], HERON_FOOT[1])),
        ]
    return bones


def _heron_leg(side):
    x = HERON_X * side
    k = LEG_THICKEN
    return Union([
        # The feathered thigh into the body, the long bare shin, the heel joint, the tarsus.
        Ellipsoid(_point(0.58, -0.005, x), (0.03, 0.05, 0.035)),
        Tube([_point(HERON_HIP[0], HERON_HIP[1], x), _point(HERON_HEEL[0], HERON_HEEL[1], x)],
             [0.011 * k, 0.008 * k]),
        Ellipsoid(_point(HERON_HEEL[0], HERON_HEEL[1], x), (0.01 * k, 0.012 * k, 0.012 * k)),
        Tube([_point(HERON_HEEL[0], HERON_HEEL[1], x), _point(HERON_FOOT[0] + 0.01, HERON_FOOT[1], x)],
             [0.008 * k, 0.0075 * k]),
        # Three long toes forward and spread, one back, on the ground.
        *[Tube([_point(0.012, 0.0, x), _point(0.008, 0.0 + 0.09 * math.cos(a), x + 0.09 * math.sin(a) * side)],
               [0.006 * k, 0.004 * k]) for a in (-0.45, 0.0, 0.45)],
        Tube([_point(0.012, 0.0, x), _point(0.008, -0.06, x)], [0.006 * k, 0.004 * k]),
    ], k=0.008)


def heron_design():
    P = HERON_PARTS
    up = _unit(np.array([0.0, 0.36, 0.93]))
    body = Union([
        Ellipsoid(_point(0.63, 0.0), (0.085, 0.10, 0.20), along=up),
        # The folded wings over the back and flanks, the tail tip below and behind.
        *[(Ellipsoid(_point(0.645, -0.03, 0.035 * s), (0.055, 0.092, 0.215), along=up), 0.03) for s in (1.0, -1.0)],
        (Ellipsoid(_point(0.55, -0.21), (0.05, 0.035, 0.075), along=(0.0, -0.5, -0.87)), 0.03),
        # The breast plumes hanging at the front.
        (Ellipsoid(_point(0.60, 0.12), (0.055, 0.085, 0.045)), 0.04),
    ], k=0.05).tag(P["body"])
    neck = Tube([_point(y, z) for y, z in HERON_NECK], [0.05, 0.034, 0.029, 0.027, 0.029],
                squash_axis=X_AXIS, squash=0.85, k=0.02).tag(P["neck"])
    poll = _point(1.005, 0.19)
    head = Union([
        Ellipsoid(poll + np.array([0.0, 0.0, 0.025]), (0.027, 0.03, 0.05)),
        *[Ellipsoid(poll + np.array([0.022 * s, 0.006, 0.04]), (0.008, 0.008, 0.008)) for s in (1.0, -1.0)],
    ], k=0.012).tag(P["head"])
    bill = RoundCone(poll + np.array([0.0, -0.006, 0.065]), poll + np.array([0.0, -0.016, 0.20]), 0.017, 0.004,
                     (X_AXIS, 0.75)).tag(P["bill"])
    crest = Tube([poll + np.array([0.0, 0.022, 0.0]), poll + np.array([0.0, 0.018, -0.07]),
                  poll + np.array([0.0, 0.002, -0.14])], [0.008, 0.006, 0.003]).tag(P["crest"])
    legs = [_heron_leg(1.0).tag(P["legLeft"]), _heron_leg(-1.0).tag(P["legRight"])]
    root = HalfSpace(Union([(body, 0.0), (neck, 0.05), (head, 0.03), (bill, 0.01), (crest, 0.01),
                            *[(leg, 0.03) for leg in legs]]), axis=1)
    landmarks = dict(poll=poll, eyes=[poll + np.array([0.025 * s, 0.006, 0.04]) for s in (1.0, -1.0)])
    return root, landmarks


def heron_skin(positions, parts, triangles, index):
    weights = np.zeros((len(positions), len(index)))
    P = HERON_PARTS
    y = positions[:, 1]

    def put(mask, name, value):
        weights[mask, index[name]] += value[mask] if np.ndim(value) else value

    put(parts == P["body"], "root", 1.0)
    neck = parts == P["neck"]
    knots = np.array([[0.0, yy, zz] for yy, zz in HERON_NECK])
    t = _polyline_t(positions, knots)
    lengths = np.linalg.norm(np.diff(knots, axis=0), axis=1)
    at = np.cumsum(lengths)[:-1] / lengths.sum()
    chain = _chain_weights(t, [at[0], at[1], 0.97], ["neck0", "neck1", "neck2", "head"], 0.06)
    base = _smoothstep(0.2, 0.0, t)
    for name, value in chain.items():
        put(neck, name, value * (1.0 - 0.7 * base))
    put(neck, "root", 0.7 * base)
    for part in ("head", "bill", "crest"):
        put(parts == P[part], "head", 1.0)
    for part, tag in (("legLeft", "L"), ("legRight", "R")):
        leg = parts == P[part]
        # Down the leg by height: the feathered thigh into the body, the shin to the heel, the foot.
        into = _smoothstep(0.54, 0.6, y)
        shin = _smoothstep(HERON_HEEL[0] + 0.02, HERON_HEEL[0] - 0.02, y)
        foot = _smoothstep(0.05, 0.02, y)
        put(leg, "root", into)
        put(leg, "thigh" + tag, (1.0 - into) * (1.0 - shin))
        put(leg, "shin" + tag, shin * (1.0 - foot))
        put(leg, "foot" + tag, foot)
    return weights


def heron_paint(shape, landmarks, positions, normals, parts):
    P = HERON_PARTS
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    legs = np.isin(parts, [P["legLeft"], P["legRight"]]) & (y < 0.53)
    yellow = np.clip((parts == P["bill"]) + legs * 0.8, 0.0, 1.0)
    poll = landmarks["poll"]
    stripe = ((parts == P["head"]) * _smoothstep(0.004, 0.018, (positions - poll)[:, 1])
              * _smoothstep(0.012, 0.022, np.abs(x)))
    eyes = np.maximum.reduce([_smoothstep(0.012, 0.006, np.linalg.norm(positions - e, axis=1))
                              for e in landmarks["eyes"]])
    # The black shoulder patch at the wing's bend and the dark flight feathers at the wing's edge.
    body = parts == P["body"]
    shoulder = body * _smoothstep(0.08, 0.12, z) * _smoothstep(0.66, 0.7, y) * _smoothstep(0.05, 0.075, np.abs(x)) * 0.8
    edge = body * _smoothstep(-0.05, -0.16, z) * _smoothstep(0.62, 0.56, y) * _smoothstep(0.045, 0.07, np.abs(x)) * 0.55
    # The neck's front stripe of dark streaks (a faint line down the throat).
    throat = (parts == P["neck"]) * _smoothstep(0.6, 0.9, normals[:, 2]) * _smoothstep(0.012, 0.004, np.abs(x)) * 0.5
    dark = np.clip(np.maximum.reduce([(parts == P["crest"]).astype(float), stripe, eyes, shoulder, edge, throat]),
                   0.0, 1.0)
    white = np.clip(np.maximum.reduce([
        (np.isin(parts, [P["neck"], P["head"]])).astype(float) * 0.9,
        body * _smoothstep(0.08, 0.14, z) * _smoothstep(0.62, 0.55, y) * 0.75,  # the breast plumes
    ]) - dark, 0.0, 1.0)
    seen = occlusion(shape, positions, normals, rays=16, reach=0.5, ground=0.6)
    return np.stack([yellow, dark, white, seen], axis=1)


# == THE BUILD ============================================================================
BIRDS = {
    "swan": dict(name="swan", species="Mute swan (Cygnus olor)", design=swan_design, bones=swan_bones,
                 skin=swan_skin, paint=swan_paint, voxel=0.0075, target=1300),
    "heron": dict(name="heron", species="Grey heron (Ardea cinerea)", design=heron_design, bones=heron_bones,
                  skin=heron_skin, paint=heron_paint, voxel=0.0045, target=1200),
}


class Bird:
    def __init__(self, spec, positions, normals, colors, triangles, bones, weights, skeleton):
        self.spec, self.positions, self.normals, self.colors = spec, positions, normals, colors
        self.triangles, self.bones, self.weights, self.skeleton = triangles, bones, weights, skeleton

    def record(self):
        low, high = self.positions.min(axis=0), self.positions.max(axis=0)
        return dict(name=self.spec["name"], species=self.spec["species"], triangles=int(len(self.triangles)),
                    vertices=int(len(self.positions)), bones=len(self.skeleton),
                    length=round(float(high[2] - low[2]), 4), height=round(float(high[1]), 4))


def build(studio, key):
    spec = BIRDS[key]
    started = time.time()
    shape, landmarks = spec["design"]()
    voxel = spec["voxel"]
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    positions, triangles = decimate(studio, dense, dense_triangles, spec["target"] // 2)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, _folds = untangle(shape, positions, triangles, seam)
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles, seam = split_seam_chords(shape, positions, triangles, seam)
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    parts = regions(shape, positions, triangles)
    colors = spec["paint"](shape, landmarks, positions, normals, parts)
    table = spec["bones"]()
    index = {name: i for i, (name, _parent, _head) in enumerate(table)}
    bones, weights = finish_weights(spec["skin"](positions, parts, triangles, index), triangles)
    skeleton = [dict(name=name, parent=-1 if parent is None else index[parent], head=[round(float(v), 4) for v in head])
                for name, parent, head in table]
    bird = Bird(spec, positions, normals, colors, triangles, bones, weights, skeleton)
    print("%s %s -> %d tris %d verts, %s, %.1fs" % (TAG, key, len(triangles), len(positions),
                                                    json.dumps(bird.record()), time.time() - started), flush=True)
    return bird


def write(path, bird):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh(bird.spec["name"], {
        "POSITION": (bird.positions, False),
        "NORMAL": (glb.quantize_unit(bird.normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(bird.colors, np.uint8), True),
        "_BONES": (bird.bones, True),
        "_WEIGHTS": (bird.weights, True),
    }, indices=bird.triangles)
    low, high = bird.positions.min(axis=0), bird.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=SCHEMA_VERSION, **bird.record(), skeleton=bird.skeleton,
        color={"r": "bill (and the heron's legs)", "g": "dark", "b": "white", "a": "sky seen (ambient occlusion)"},
        skin={"_BONES": "four bone indices / 255", "_WEIGHTS": "their weights (sum 1)",
              "pose": "each bone rests aligned with the bird's axes; a pose turns it about its head"},
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


# -- previews (never shipped) ---------------------------------------------------------------
def _albedo(bird):
    c = bird.colors
    bill, dark, white, seen = (c[:, i:i + 1] for i in range(4))
    if bird.spec["name"] == "swan":
        base = np.array([0.94, 0.94, 0.92]) * (1 - bill) + np.array([0.95, 0.42, 0.08]) * bill
    else:
        base = np.array([0.42, 0.44, 0.47]) * (1 - white) + np.array([0.9, 0.9, 0.88]) * white
        base = base * (1 - bill) + np.array([0.85, 0.7, 0.2]) * bill
    base = base * (1 - dark) + np.array([0.03, 0.03, 0.03]) * dark
    return np.clip(base * (0.5 + 0.5 * seen), 0.0, 1.0)


def previews(birds, directory):
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    studio.setup_preview(sun_direction=(-0.46, 0.36, 0.61), sun_strength=4.0, sky=(0.5, 0.62, 0.8), sky_strength=0.8)
    ground = studio.mesh_object("water", np.array([[-6, 0, -6], [6, 0, -6], [6, 0, 6], [-6, 0, 6]], dtype=float),
                                np.array([[0, 2, 1], [0, 3, 2]]))
    ground.data.materials.append(studio.material("water", vertex_color=False, base=(0.1, 0.45, 0.5)))
    material = studio.material("bird", roughness=0.8)
    for index, bird in enumerate(birds):
        offset = np.array([(index - 0.5) * 1.6, 0.0, 0.0])
        obj = studio.mesh_object("bird_" + bird.spec["name"], bird.positions + offset, bird.triangles,
                                 colors=_albedo(bird))
        obj.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(bird.normals)])
        obj.data.materials.append(material)
    studio.render(directory / "pond-birds-side.png", eye=(5.0, 1.2, 1.0), target=(0.0, 0.45, 0.0), lens=50,
                  size=(900, 500), samples=16)
    studio.render(directory / "pond-birds-34.png", eye=(3.2, 2.2, 3.6), target=(0.0, 0.45, 0.0), lens=50,
                  size=(900, 500), samples=16)
    studio.render(directory / "pond-birds-above.png", eye=(1.0, 6.0, 3.0), target=(0.0, 0.3, 0.0), lens=50,
                  size=(900, 500), samples=16)
    studio.dispose()


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    options = {}
    for key, value in zip(arguments[::2], arguments[1::2]):
        options[key.lstrip("-")] = value
    out_dir = Path(options.get("out-dir", "pond"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Odyssey - Pond Birds Atelier"
    studio_module.PREFIX = "SODY_"
    studio = studio_module.Studio()
    birds = []
    try:
        for key in options.get("birds", "swan,heron").split(","):
            bird = build(studio, key)
            out_dir.mkdir(parents=True, exist_ok=True)
            size = write(out_dir / ("%s.glb" % key), bird)
            print("%s wrote %s (%d bytes)" % (TAG, out_dir / ("%s.glb" % key), size), flush=True)
            birds.append(bird)
    finally:
        studio.dispose()
    if options.get("preview"):
        previews(birds, Path(options["preview"]))
        print("%s previews in %s" % (TAG, options["preview"]), flush=True)


if __name__ == "__main__":
    main()
