"""Winter's polar bear: modelled procedurally in Blender, round the joints of the theme's rig.

Run by scripts/winter/model-bear.mjs, which hands it the skeleton (src/themes/winter/winter-bear-rig.js)
as JSON, then skins what it writes to that skeleton and writes the asset:

    node scripts/winter/model-bear.mjs [--preview=<dir>]

or by hand (headless; nothing in an open Blender session is touched):

    blender --background --factory-startup --python scripts/blender/winter_polar_bear.py -- \
        --skeleton <bones.json> --out <polar-bear-mesh.glb> [--preview <dir>]

Drawn from photographs of polar bears walking on the ice. What makes one read as itself, near or
far: a long, deep body whose rump stands a little higher than its shoulders; a long, thick neck,
nearly as wide as the head where they meet, carrying the head low; a broad, rounded head with
furred cheeks, a Roman nose ending in a big black pad, small round ears set on the sides of the
skull; forelegs that are massive columns of fur with long hair hanging behind them, ending in
great paws turned a little in, the toes and their dark claws showing at the front; hind legs in
"trousers" of long hair, their feet long and flat from the heel; hair hanging in a fringe under
the belly; a stub of a tail; and a coat that lies in soft clumps flowing back over the body and
down the legs. A big male: 1.32 m at the shoulder, 2.5 m from nose to tail.

How it is made (the meshing is the Grainfields horse's, scripts/blender/grainfields/horse_sdf.py):

- **Shape.** A signed distance field of ellipsoids and round cones joined by smooth unions, built
  round the rig's joints: chest, withers, the shoulder blades' masses over the ribs, triceps,
  barrel, loins, haunches, rump and thighs; the neck; the head as cranium, furred cheeks, brow, a
  muzzle under a convex bridge, the nose pad, the lower jaw; ears cupped by a smooth carve; each
  leg through its own joints, with the point of the elbow, the wrist, the heel, a broad paw with
  five toe pads and a claw from each; locks of hair hanging from the belly, behind the forelegs
  and down the hind legs, each laid on the skin as it falls.
- **Coat.** Over the whole, a field of clumps: value noise stretched along the way the hair lies
  (back over the body, down the legs), deeper in the long hair and shallow on the face and paws.
- **Mesh.** The field's left half is sampled on a 7 mm grid, polygonised with surface nets,
  projected onto the zero set, decimated in Blender with a quadric edge collapse, cleaned of folds
  and mirrored, so the bear is exactly symmetric.
- **Parts.** Which part each vertex belongs to (body, head and neck, each leg, tail), by the
  nearest primitive, cleaned into one piece each: the skinning step weights by it.
- **Paint.** COLOR_0 = (pad, fur length, dark, sky seen): the black pads of the soles; how long
  the hair is; the black nose, eyes, lips and claws and the shade inside the ears; ambient
  occlusion traced through the field.

Frame: metres, +z forward (toward the head), +y up, the paws on y = 0, the body centred on x = 0;
the bear faces +z, so its left side is +x. No external asset is used: the field is the model.
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
    Ellipsoid, HalfSpace, RoundCone, Shape, Tube, Union, X_AXIS, Z_AXIS,
    _grid, _neighbours, _smin, _smoothstep, _unit, collapse_bad, decimate, gradient, mesh_normals,
    mirror, on_seam, open_half, project, rim, split_seam_chords, surface_nets, untangle,
)

TAG = "[winter-bear]"
GENERATOR = "Serenity Blocks - Winter polar bear (scripts/blender/winter_polar_bear.py)"
VOXEL = 0.007
TARGET_TRIANGLES = 18000
PARTS = {"body": 0, "head": 1, "frontLeft": 2, "frontRight": 3, "hindLeft": 4, "hindRight": 5, "tail": 6}
# The deepest the coat's clumps go (metres): the field's bounds are padded by it.
COAT = 0.024


def P(x, y, z):
    return np.array([x, y, z], dtype=np.float64)


def _hash01(index, salt=0.0):
    value = math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
    return value - math.floor(value)


# -- the coat ------------------------------------------------------------------------------
def _lattice(ix, iy, iz):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
    h = h & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h = h ^ (h >> 16)
    return (h & 0xFFFF).astype(np.float64) / 65535.0


def _vnoise(x, y, z):
    """Smooth value noise in 0..1 (vectorised, any broadcastable shapes)."""
    x, y, z = np.broadcast_arrays(x, y, z)
    fx, fy, fz = np.floor(x), np.floor(y), np.floor(z)
    tx, ty, tz = x - fx, y - fy, z - fz
    sx, sy, sz = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty), tz * tz * (3 - 2 * tz)
    ix, iy, iz = fx.astype(np.int64), fy.astype(np.int64), fz.astype(np.int64)
    out = 0.0
    for c in range(8):
        ox, oy, oz = c & 1, (c >> 1) & 1, (c >> 2) & 1
        w = (sx if ox else 1 - sx) * (sy if oy else 1 - sy) * (sz if oz else 1 - sz)
        out = out + w * _lattice(ix + ox, iy + oy, iz + oz)
    return out


def _coat(x, y, z):
    """The coat's clumps, in units of COAT: back along the body, down the legs, fine in the face."""
    # Hair lies back along the body and down the legs and the flanks' lower half: the clumps are
    # long that way and narrow across it, like combed fur, not round like lumps.
    legs = np.maximum(_smoothstep(0.72, 0.5, y) * (np.abs(x) > 0.12), _smoothstep(0.85, 0.65, y) * 0.6)
    body = _vnoise(x * 30.0 + 3.1, y * 30.0, z * 5.0)
    down = _vnoise(x * 30.0 + 7.7, y * 5.0, z * 30.0 + 1.3)
    clumps = body + (down - body) * legs
    fibre = _vnoise(x * 80.0, y * 80.0 + 2.2, z * 22.0 + 5.1)
    n = (clumps - 0.5) * 2.0 * 0.8 + (fibre - 0.5) * 2.0 * 0.2
    # How deep: shallow over the back, the face and the paws; deeper down the flanks and the legs,
    # in the ruff under the neck and over the belly's fringe.
    face = _smoothstep(1.16, 1.3, z) * _smoothstep(0.85, 0.95, y)
    paws = _smoothstep(0.16, 0.06, y)
    back = _smoothstep(1.05, 1.25, y)
    ruff = _smoothstep(0.45, 0.7, z) * _smoothstep(1.1, 0.85, z) * _smoothstep(1.0, 0.8, y)
    belly = _smoothstep(0.72, 0.58, y) * _smoothstep(0.45, 0.25, z) * _smoothstep(-0.75, -0.55, z)
    depth = 0.3 + 0.12 * legs + 0.35 * np.maximum(ruff, belly)
    depth = depth * (1.0 - 0.75 * face) * (1.0 - 0.6 * paws) * (1.0 - 0.45 * back)
    return n * depth


class FurCoat(Shape):
    """The child's surface with the coat's clumps laid over it (evaluated only near the surface)."""

    def __init__(self, child, amplitude, fn):
        self.child, self.amplitude, self.fn = child, float(amplitude), fn

    def leaves(self):
        return self.child.leaves()

    def bounds(self):
        low, high = self.child.bounds()
        return low - self.amplitude, high + self.amplitude

    def eval(self, p):
        return self.child.eval(p) + self.amplitude * self.fn(p[:, 0], p[:, 1], p[:, 2])

    def eval_block(self, xs, ys, zs):
        out = self.child.eval_block(xs, ys, zs)
        near = np.abs(out) < 3.0 * self.amplitude
        index = np.nonzero(near)
        if len(index[0]):
            out[index] += self.amplitude * self.fn(xs[index[0]], ys[index[1]], zs[index[2]])
        return out


def _smax(a, b, k):
    return -_smin(-a, -b, k)


class Carve(Shape):
    """The child with `tool` carved out of it, the edge rounded by `k` (the ears' cups)."""

    def __init__(self, child, tool, k):
        self.child, self.tool, self.k = child, tool, float(k)

    def leaves(self):
        return self.child.leaves()

    def bounds(self):
        return self.child.bounds()

    def eval(self, p):
        return _smax(self.child.eval(p), -self.tool.eval(p), self.k)

    def eval_block(self, xs, ys, zs):
        out = self.child.eval_block(xs, ys, zs)
        low, high = self.tool.bounds()
        window = []
        for axis, values in enumerate((xs, ys, zs)):
            start = int(np.searchsorted(values, low[axis] - self.k))
            stop = int(np.searchsorted(values, high[axis] + self.k, side="right"))
            window.append(slice(start, stop))
        if all(w.stop > w.start for w in window):
            region = tuple(window)
            cut = self.tool.eval_block(xs[window[0]], ys[window[1]], zs[window[2]])
            out[region] = _smax(out[region], -cut, self.k)
        return out


def _lock(skin, start, direction, length, r0, r1, stations=4, sink=0.5):
    """A lock of hair rooted on `skin` near `start`, hanging free along `direction` and curling a
    little under at its end."""
    root = project(skin, np.asarray(start, dtype=np.float64)[None, :], iterations=6, limit=0.05)[0]
    normal = _unit(gradient(skin, root[None, :])[0])
    points = [root - normal * r0 * sink]
    radii = [r0]
    step = length / (stations - 1)
    heading = _unit(direction)
    for k in range(1, stations):
        f = k / (stations - 1)
        # (It falls, and swings a little in toward the body at its tip.)
        heading = _unit(heading - normal * 0.12 * f)
        points.append(points[-1] + heading * step)
        radii.append(r0 + (r1 - r0) * f)
    return Tube(points, radii, k=0.012)


def _flag(shape, **flags):
    for leaf in shape.leaves():
        for name, value in flags.items():
            setattr(leaf, name, value)
    return shape


# -- the bear ------------------------------------------------------------------------------
def design(J, M):
    """The bear as a distance field round the rig's joints `J` and marks `M`, and its landmarks."""
    # The trunk: a deep chest under the withers, the shoulder blades' masses over the ribs and the
    # triceps behind the upper arms, the barrel, the loins, haunches and a rump a little higher
    # than the shoulders, the thighs. Over the belly, the fur hangs.
    trunk = Union([
        Ellipsoid(P(0, 0.94, 0.38), (0.30, 0.37, 0.40)),
        (Ellipsoid(P(0, 1.12, 0.32), (0.25, 0.2, 0.32)), 0.14),
        *[(Ellipsoid(P(0.19 * s, 1.04, 0.42), (0.13, 0.27, 0.19), along=(0.0, 1.0, 0.3)), 0.1) for s in (1, -1)],
        *[(Ellipsoid(P(0.23 * s, 0.8, 0.33), (0.12, 0.2, 0.15), along=(0.0, 1.0, -0.2)), 0.08) for s in (1, -1)],
        Ellipsoid(P(0, 0.93, -0.08), (0.37, 0.38, 0.55)),
        (Ellipsoid(P(0, 0.73, -0.06), (0.30, 0.17, 0.48)), 0.1),
        (Ellipsoid(P(0, 1.16, -0.25), (0.25, 0.15, 0.36)), 0.12),
        Ellipsoid(P(0, 0.99, -0.58), (0.35, 0.38, 0.37)),
        (Ellipsoid(P(0, 1.16, -0.55), (0.27, 0.2, 0.32)), 0.12),
        *[(Ellipsoid(P(0.22 * s, 0.83, -0.6), (0.16, 0.33, 0.27), along=(0.0, 1.0, 0.25)), 0.1) for s in (1, -1)],
    ], k=0.16).tag(PARTS["body"])

    # The neck: long and thick, out of the chest and down a little to the back of the skull.
    neck = Tube([P(0, 1.04, 0.54), P(0, 1.07, 0.76), P(0, 1.06, 0.95), P(0, 1.05, 1.08)],
                [0.32, 0.27, 0.215, 0.18], squash_axis=X_AXIS, squash=[0.93, 0.92, 0.92, 0.95], k=0.04)
    # The head: broad and rounded with furred cheeks, a brow over the eyes, a Roman nose falling to
    # the big black pad, the lower jaw under it.
    nose = np.asarray(M["nose"], dtype=np.float64)
    head = Union([
        Ellipsoid(P(0, 1.085, 1.14), (0.15, 0.125, 0.155)),
        Ellipsoid(P(0, 1.0, 1.17), (0.165, 0.115, 0.13)),
        (Ellipsoid(P(0, 1.115, 1.25), (0.11, 0.06, 0.09)), 0.04),
        RoundCone(P(0, 1.03, 1.29), nose + P(0, 0.005, -0.055), 0.105, 0.068, (X_AXIS, 0.95)),
        (Ellipsoid(P(0, 1.035, 1.36), (0.07, 0.05, 0.11), along=(0.0, -0.25, 1.0)), 0.04),
        (Ellipsoid(nose + P(0, 0.003, -0.03), (0.056, 0.042, 0.036)), 0.02),
        RoundCone(P(0, 0.95, 1.2), P(0, 0.925, 1.4), 0.085, 0.048),
    ], k=0.05)
    # Ears: small and round on the sides of the skull, cupped forward and out.
    ears = []
    for s in (1, -1):
        base = np.asarray(J["earL"], dtype=np.float64) * np.array([s, 1.0, 1.0]) + P(0.012 * s, 0.025, 0.0)
        facing = _unit((0.45 * s, 0.15, 1.0))
        ear = Ellipsoid(base, (0.056, 0.058, 0.034), along=facing)
        cup = Ellipsoid(base + facing * 0.022 + P(0, 0.006, 0), (0.036, 0.04, 0.026), along=facing)
        ears.append(_flag(Carve(ear, cup, 0.008), ear=True))
    head_part = Union([(neck, 0.0), (head, 0.06), *[(ear, 0.03) for ear in ears]]).tag(PARTS["head"])

    def paw(ball, tip, side, front):
        """A broad paw turned a little in: the pad, five toes along its front, a claw from each."""
        s = 1.0 if side == "L" else -1.0
        turn = -0.14 * s if front else -0.07 * s
        ahead = _unit((turn, 0.0, 1.0))
        across = np.array([ahead[2], 0.0, -ahead[0]])
        length = 0.17 if front else 0.21
        centre = ball + P(0, 0.062, 0) - ahead * (0.05 if front else 0.09)
        parts = [Ellipsoid(centre, (0.135 if front else 0.12, 0.07, length), along=ahead)]
        claws = []
        reach_ = np.asarray(tip, dtype=np.float64)
        for k in range(5):
            a = (k - 2) / 2.0
            toe = reach_ + across * (0.085 * a) - ahead * (0.03 * a * a + 0.035) + P(0, 0.008, 0)
            parts.append((Ellipsoid(toe, (0.034, 0.033, 0.038), along=ahead), 0.025))
            root = toe + ahead * 0.028 + P(0, 0.004, 0)
            claw = RoundCone(root, root + ahead * 0.03 + P(0, -0.018, 0), 0.011, 0.003)
            claws.append(_flag(claw, claw=True))
        return Union(parts, k=0.04), claws

    def front(side):
        s = 1.0 if side == "L" else -1.0
        shoulder, elbow, wrist = J["arm" + side], J["fore" + side], J["hand" + side]
        ball = np.asarray(M["paw" + ("FL" if side == "L" else "FR")], dtype=np.float64)
        tip = np.asarray(M["tip" + ("FL" if side == "L" else "FR")], dtype=np.float64)
        pad, claws = paw(ball, tip, side, True)
        mid = (elbow + wrist) * 0.5 + P(0, 0, 0.012)
        leg = Union([
            Tube([shoulder + P(0, 0.06, 0.0), elbow], [0.18, 0.15]),
            (Ellipsoid(elbow + P(0, 0.02, -0.075), (0.11, 0.12, 0.1)), 0.06),
            Tube([elbow, mid, wrist], [0.15, 0.13, 0.11], squash_axis=Z_AXIS, squash=[1.0, 1.12, 1.05]),
            (Ellipsoid(wrist + P(0, -0.01, 0.0), (0.105, 0.09, 0.11)), 0.05),
            (pad, 0.08),
        ], k=0.07)
        # The long hair down the back of the forearm.
        locks = []
        for k in range(8):
            f = k / 7.0
            across = 0.1 * s * (_hash01(k, 1.0) - 0.5)
            start = elbow * (1 - f * 0.75) + wrist * (f * 0.75) + P(across, 0.02, -0.11)
            length = 0.13 + 0.08 * _hash01(k, 3.0)
            locks.append(_lock(leg, start, (0.0, -1.0, -0.3), length, 0.04, 0.012, sink=0.75))
        tag = PARTS["frontLeft" if side == "L" else "frontRight"]
        # (Tagged first: tagging a part clears the flags on its primitives.)
        leg.tag(tag)
        hair = _flag(Union([(lock, 0.03) for lock in locks]).tag(tag), hair=True)
        for claw in claws:
            _flag(claw.tag(tag), claw=True)
        return Union([(leg, 0.0), (hair, 0.035), *[(claw, 0.006) for claw in claws]])

    def hind(side):
        s = 1.0 if side == "L" else -1.0
        hip, knee, heel = J["thigh" + side], J["shin" + side], J["foot" + side]
        ball = np.asarray(M["paw" + ("BL" if side == "L" else "BR")], dtype=np.float64)
        tip = np.asarray(M["tip" + ("BL" if side == "L" else "BR")], dtype=np.float64)
        pad, claws = paw(ball, tip, side, False)
        mid = (knee + heel) * 0.5 + P(0, 0, -0.015)
        leg = Union([
            Tube([hip + P(-0.01 * s, -0.02, 0.0), knee], [0.21, 0.155]),
            Tube([knee, mid, heel], [0.155, 0.125, 0.1], squash_axis=Z_AXIS, squash=[1.0, 1.1, 1.05]),
            (Ellipsoid(heel + P(0, -0.035, -0.035), (0.08, 0.075, 0.07)), 0.03),
            (pad, 0.06),
        ], k=0.07)
        # The "trousers": long hair down the back of the thigh and the shank.
        locks = []
        for k in range(8):
            f = k / 7.0
            across = 0.1 * s * (_hash01(k, 6.0) - 0.5)
            start = hip * (1 - f * 0.9) + heel * (f * 0.9) + P(across, 0.05, -0.14 + 0.04 * f)
            length = 0.12 + 0.07 * _hash01(k, 8.0)
            locks.append(_lock(leg, start, (0.0, -1.0, -0.25), length, 0.045, 0.014, sink=0.75))
        tag = PARTS["hindLeft" if side == "L" else "hindRight"]
        leg.tag(tag)
        hair = _flag(Union([(lock, 0.03) for lock in locks]).tag(tag), hair=True)
        for claw in claws:
            _flag(claw.tag(tag), claw=True)
        return Union([(leg, 0.0), (hair, 0.035), *[(claw, 0.006) for claw in claws]])

    legs = [front("L"), front("R"), hind("L"), hind("R")]

    # The fringe of hair under the belly and the chest, longest mid-belly.
    # A curtain of thin strands, overlapping so they hang as one ragged edge.
    fringe = []
    count = 15
    # (Both sides, each the other's mirror image: the field is symmetric, as the mesh is.)
    for s in (1.0, -1.0):
        for row, x in enumerate((0.06, 0.15, 0.24)):
            for k in range(count):
                f = k / (count - 1)
                z = 0.34 - 0.9 * f + 0.03 * row
                jitter = P(0.025 * s * (_hash01(k, row) - 0.5), 0.0, 0.03 * (_hash01(k, row + 3) - 0.5))
                start = P(x * s, 0.67 - 0.02 * row, z) + jitter
                length = (0.05 + 0.08 * math.sin(math.pi * f) ** 0.6) * (0.75 + 0.5 * _hash01(k, row + 9))
                fringe.append(_lock(trunk, start, (0.08 * s, -1.0, -0.22), length, 0.036, 0.011, sink=0.75))
    fringe = _flag(Union([(lock, 0.03) for lock in fringe]).tag(PARTS["body"]), hair=True)

    tail = Ellipsoid(P(0, 1.04, -1.0), (0.065, 0.075, 0.09), along=(0.0, -0.45, -1.0)).tag(PARTS["tail"])

    whole = Union([(trunk, 0.0), (fringe, 0.04), (head_part, 0.12), *[(leg, 0.1) for leg in legs], (tail, 0.06)])
    coat = FurCoat(whole, COAT, _coat)
    root = HalfSpace(coat, axis=1)
    landmarks = dict(
        nose=nose,
        eyes=[np.asarray(M["eye"], dtype=np.float64) * np.array([s, 1.0, 1.0]) for s in (1, -1)],
        # Between the neck and the body the boundary is a plane from the withers down to the
        # front of the chest: (y, z) pairs.
        neckBase=((1.33, 0.56), (0.8, 0.8)),
        frontCut=0.84,      # a foreleg's part ends about the elbow's top
        hindCut=0.86,       # a hind leg's at the stifle
    )
    return root, whole, landmarks


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


def regions(shape, landmarks, positions, triangles):
    """Which part each vertex belongs to, by the nearest primitive (cleaned into one piece each)."""
    leaves = shape.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    leaf_parts = np.array([leaf.part for leaf in leaves])
    y = positions[:, 1]
    claim = distances.copy()
    for column, part in enumerate(leaf_parts):
        if part in (PARTS["frontLeft"], PARTS["frontRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["frontCut"])
        elif part in (PARTS["hindLeft"], PARTS["hindRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["hindCut"])
    parts = leaf_parts[np.argmin(claim, axis=1)]
    left = positions[:, 0] >= 0.0
    parts = np.where((parts == PARTS["frontRight"]) & left, PARTS["frontLeft"], parts)
    parts = np.where((parts == PARTS["frontLeft"]) & ~left, PARTS["frontRight"], parts)
    parts = np.where((parts == PARTS["hindRight"]) & left, PARTS["hindLeft"], parts)
    parts = np.where((parts == PARTS["hindLeft"]) & ~left, PARTS["hindRight"], parts)
    (top_y, top_z), (low_y, low_z) = landmarks["neckBase"]
    ahead = (positions[:, 1] - top_y) * (low_z - top_z) + (positions[:, 2] - top_z) * (top_y - low_y) > 0.0
    trunk = np.isin(parts, (PARTS["body"], PARTS["head"]))
    parts = np.where(trunk, np.where(ahead, PARTS["head"], PARTS["body"]), parts)
    parts = _clean_parts(parts, _neighbours(len(positions), triangles))
    return parts, distances


def occlusion(shape, positions, normals, rays=32, reach=1.0, ground=0.65):
    """The share of the sky over each vertex that the bear (and, partly, the ice under it) hides, by
    rays sphere-traced through the field over a cosine-weighted hemisphere."""
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
    start = positions + normals * 0.008
    for d in local:
        direction = tangent * d[0] + bitangent * d[1] + normals * d[2]
        down = direction[:, 1] < -1e-6
        t_ground = np.where(down, start[:, 1] / np.maximum(-direction[:, 1], 1e-6), np.inf)
        t = np.full(count, 0.018)
        alive = np.ones(count, dtype=bool)
        blocked = np.zeros(count)
        for _ in range(30):
            if not alive.any():
                break
            index = np.nonzero(alive)[0]
            p = start[index] + direction[index] * t[index, None]
            field = shape.eval(p)
            hit = field < 0.003
            blocked[index[hit]] = 1.0
            t[index] += np.maximum(field, 0.008)
            grounded = ~hit & (t[index] >= t_ground[index]) & (t_ground[index] < reach)
            blocked[index[grounded]] = ground
            alive[index[hit | grounded]] = False
            alive &= t < reach
        seen += 1.0 - blocked
    return np.clip(seen / rays, 0.0, 1.0)


def paint(shape, whole, landmarks, positions, normals, parts, distances):
    """COLOR_0 = (pad, fur length, dark, sky seen), each 0..1."""
    leaves = whole.leaves()
    x, y, z = positions[:, 0], positions[:, 1], positions[:, 2]
    nearest = np.argmin(distances, axis=1)
    flag = lambda name: np.array([bool(getattr(leaf, name, False)) for leaf in leaves])  # noqa: E731
    claw_leaf, hair_leaf, ear_leaf = flag("claw"), flag("hair"), flag("ear")
    on = lambda mask: _smoothstep(0.006, -0.004, distances[:, mask].min(axis=1) - distances[:, ~mask].min(axis=1))  # noqa: E731,E501
    legs = np.isin(parts, (PARTS["frontLeft"], PARTS["frontRight"], PARTS["hindLeft"], PARTS["hindRight"]))
    # The soles: black pads under the paws and the toes.
    pad = legs * _smoothstep(0.03, 0.006, y) * _smoothstep(-0.2, -0.75, normals[:, 1])
    claws = on(claw_leaf) * legs
    # The nose, the eyes and their rims, a line of black lip; inside the ears, a shade.
    nose = landmarks["nose"]
    to_nose = np.linalg.norm((positions - nose) * np.array([1.0, 1.2, 0.85]), axis=1)
    eyes = np.min([np.linalg.norm((positions - eye) * np.array([1.0, 1.3, 0.75]), axis=1)
                   for eye in landmarks["eyes"]], axis=0)
    lip = (parts == PARTS["head"]) * _smoothstep(0.012, 0.004, np.abs(y - (0.945 - 0.05 * (z - 1.3)))) \
        * _smoothstep(1.3, 1.37, z) * _smoothstep(0.025, 0.01, np.abs(np.abs(x) - 0.055))
    facing = np.max([normals @ _unit((0.45 * s, 0.15, 1.0)) for s in (1.0, -1.0)], axis=0)
    inner = on(ear_leaf) * _smoothstep(0.2, 0.7, facing) * 0.55
    dark = np.maximum.reduce([_smoothstep(0.058, 0.036, to_nose), _smoothstep(0.024, 0.013, eyes), lip * 0.75,
                              claws * 0.92, inner])
    # Hair: short on the face and the paws, longer on the body, longest in the locks, the ruff and
    # under the belly.
    face = (parts == PARTS["head"]) * _smoothstep(1.14, 1.3, z)
    locks = on(hair_leaf)
    belly = (parts == PARTS["body"]) * _smoothstep(0.8, 0.6, y)
    ruff = (parts == PARTS["head"]) * _smoothstep(1.05, 0.9, y) * _smoothstep(1.0, 0.8, z)
    fur = 0.5 + 0.5 * np.maximum.reduce([locks, belly * 0.8, ruff * 0.7])
    fur = fur * (1.0 - 0.6 * face) * (1.0 - 0.55 * legs * _smoothstep(0.2, 0.05, y)) * (1.0 - dark)
    sky = occlusion(whole, positions, normals)
    print("%s paint: dark %d verts, claws %d, pads %d, locks %d, sky seen %.2f..%.2f (mean %.2f)" % (
        TAG, int((dark > 0.5).sum()), int((claws > 0.5).sum()), int((pad > 0.5).sum()), int((locks > 0.5).sum()),
        sky.min(), sky.max(), sky.mean()), flush=True)
    return np.stack([pad, np.clip(fur, 0.0, 1.0), dark, sky], axis=1)


# -- building it ---------------------------------------------------------------------------
class Bear:
    def __init__(self, positions, normals, colors, triangles, parts, stats):
        self.positions, self.normals, self.colors = positions, normals, colors
        self.triangles, self.parts, self.stats = triangles, parts, stats

    def measures(self):
        body = self.positions[self.parts == PARTS["body"]]
        shoulders = body[(body[:, 2] > 0.2) & (body[:, 2] < 0.5)]
        rump = body[body[:, 2] < -0.4]
        return dict(shoulderHeight=float(shoulders[:, 1].max()), rumpHeight=float(rump[:, 1].max()),
                    length=float(np.ptp(self.positions[:, 2])), width=float(np.ptp(self.positions[:, 0])),
                    height=float(self.positions[:, 1].max()))


def build(studio, skeleton, voxel=VOXEL, target=TARGET_TRIANGLES):
    """Polygonise and decimate the left half, mirror it, then sort it into parts and paint it."""
    started = time.time()
    J = {bone[0]: np.array(bone[2:5], dtype=np.float64) for bone in skeleton["bones"]}
    M = skeleton["marks"]
    shape, whole, landmarks = design(J, M)
    designed = time.time()
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    sampled = time.time()
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    del field
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
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    normals[positions[:, 1] <= 1e-6] = np.array([0.0, -1.0, 0.0])
    parts, distances = regions(whole, landmarks, positions, triangles)
    colors = paint(shape, whole, landmarks, positions, normals, parts, distances)
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_triangles=len(dense_triangles), vertices=len(positions),
                 triangles=len(triangles), folds=folds, mesh_normals=int(disagree.sum()),
                 design_s=designed - started, field_s=sampled - designed, nets_s=netted - sampled,
                 total_s=time.time() - started)
    bear = Bear(positions, normals, colors, triangles, parts, stats)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s grid %s dense %d tris -> mirrored %d tris %d verts (%d folds, %d mesh normals); "
          "x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s; parts %s; design %.1fs field %.1fs nets %.1fs total %.1fs" % (
              TAG, "x".join(str(n) for n in stats["grid"]), stats["dense_triangles"], stats["triangles"],
              stats["vertices"], folds, stats["mesh_normals"], low[0], high[0], low[1], high[1], low[2], high[2],
              {key: round(value, 3) for key, value in bear.measures().items()},
              {name: int((parts == index).sum()) for name, index in PARTS.items()},
              stats["design_s"], stats["field_s"], stats["nets_s"], stats["total_s"]), flush=True)
    return bear


def write(path, bear):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=GENERATOR)
    writer.add_mesh("polar-bear", {
        "POSITION": (bear.positions, False),
        "NORMAL": (bear.normals.astype(np.float32), False),
        "COLOR_0": (glb.quantize_unit(bear.colors, np.uint8), True),
        "_PART": (bear.parts.astype(np.uint8), False),
    }, indices=bear.triangles, position_bits=32)
    writer.set_extras(dict(
        name="polar-bear", parts=PARTS, **{key: round(value, 4) for key, value in bear.measures().items()},
        triangles=int(len(bear.triangles)), vertices=int(len(bear.positions)),
        color={"r": "pad (the black soles)", "g": "fur length", "b": "dark (nose, eyes, lips, claws, ears)",
               "a": "sky seen"},
    ))
    return writer.write(path)


# -- previews (never shipped) -------------------------------------------------------------
PART_COLOURS = np.array([
    [0.85, 0.82, 0.74], [0.95, 0.55, 0.35], [0.3, 0.6, 0.95], [0.25, 0.85, 0.6],
    [0.85, 0.35, 0.8], [0.9, 0.85, 0.25], [0.6, 0.3, 0.2],
])


def previews(bear, directory):
    import bpy
    from mathutils import Vector
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    started = time.time()
    lights = []

    def bear_object(name, colours):
        obj = studio.mesh_object(name, bear.positions, bear.triangles, colors=colours)
        obj.data.normals_split_custom_set_from_vertices([tuple(n) for n in to_blender(bear.normals)])
        obj.data.materials.append(studio.material(name, roughness=0.85))
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
        data = bpy.data.lights.new(studio_module.PREFIX + "bear_sun", "SUN")
        data.energy = strength
        data.color = colour
        data.angle = math.radians(2.0)
        light = bpy.data.objects.new(studio_module.PREFIX + "bear_sun", data)
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
        extent = 30.0
        ground = studio.mesh_object("bear_ground", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([[0.55, 0.62, 0.72]], (4, 1)))
        ground.data.materials.append(studio.material("bear_ground", roughness=1.0))
        sees = bear.colors[:, 3:4]
        coat = np.array([[0.93, 0.88, 0.76]]) * (0.35 + 0.65 * sees)
        coat = coat * (1.0 - 0.92 * np.maximum(bear.colors[:, 2:3], bear.colors[:, 0:1]))
        obj = bear_object("bear_coat", coat)
        sky((0.55, 0.62, 0.75), 0.7)
        sun((0.5, 0.7, 0.45), 3.4)
        shots = {
            "side": dict(eye=(7.0, 1.0, 0.2), target=(0.0, 0.8, 0.2), lens=50.0, size=(1400, 800)),
            "front-34": dict(eye=(2.6, 1.6, 5.2), target=(0.05, 0.75, 0.4), lens=50.0, size=(1100, 1000)),
            "three-quarter": dict(eye=(4.6, 1.8, 4.6), target=(0.0, 0.8, 0.2), lens=46.0, size=(1200, 900)),
            "rear": dict(eye=(-3.2, 1.6, -5.0), target=(0.0, 0.85, -0.2), lens=46.0, size=(1000, 900)),
            "head": dict(eye=(1.1, 1.25, 2.5), target=(0.0, 1.05, 1.25), lens=60.0, size=(900, 900)),
            "head-side": dict(eye=(2.0, 1.1, 1.3), target=(0.0, 1.05, 1.27), lens=60.0, size=(900, 700)),
            "paws": dict(eye=(1.3, 0.4, 2.0), target=(0.15, 0.1, 0.55), lens=50.0, size=(1000, 700)),
        }
        for name, shot in shots.items():
            studio.render(directory / ("bear-%s.png" % name), samples=24, **shot)
        remove([obj])
        parts = bear_object("bear_parts", PART_COLOURS[bear.parts])
        sky((0.6, 0.62, 0.66), 0.9)
        sun((0.5, 0.7, 0.6), 3.0, colour=(1.0, 1.0, 1.0))
        studio.render(directory / "bear-parts.png", eye=(4.6, 1.8, 4.6), target=(0.0, 0.8, 0.2), lens=46.0,
                      size=(1000, 760), samples=16)
        remove([parts])
        paint_view = bear_object("bear_paint", np.stack([
            0.85 - 0.8 * bear.colors[:, 2], 0.85 - 0.8 * bear.colors[:, 2] + 0.15 * bear.colors[:, 1],
            0.85 - 0.8 * bear.colors[:, 0]], axis=1))
        studio.render(directory / "bear-paint.png", eye=(1.3, 0.6, 2.4), target=(0.0, 0.55, 0.8), lens=40.0,
                      size=(1000, 800), samples=16)
        remove([paint_view, ground])
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
    if "skeleton" not in options or "out" not in options:
        raise SystemExit("usage: blender --background --factory-startup --python winter_polar_bear.py -- "
                         "--skeleton <bones.json> --out <mesh.glb> [--preview <dir>]")
    skeleton = json.loads(Path(options["skeleton"]).read_text(encoding="utf-8"))
    from fall_grove import studio as studio_module
    studio_module.SCENE_NAME = "Serenity Winter - Bear Atelier"
    studio_module.PREFIX = "SWBEAR_"
    studio = studio_module.Studio()
    try:
        bear = build(studio, skeleton, voxel=float(options.get("voxel", VOXEL)),
                     target=int(options.get("triangles", TARGET_TRIANGLES)))
    finally:
        studio.dispose()
    out = Path(options["out"]).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    size = write(out, bear)
    print("%s wrote %s (%d bytes)" % (TAG, out, size), flush=True)
    if options.get("preview") and options["preview"] is not True:
        previews(bear, Path(options["preview"]).expanduser().resolve())


if __name__ == "__main__":
    main()
