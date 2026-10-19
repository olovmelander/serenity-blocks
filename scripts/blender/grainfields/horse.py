"""The Grainfields herd's horse: a Hokkaido native horse (Dosanko), modelled procedurally.

Built by scripts/blender/grainfields_assets.py (`--only horse`). The horse grazes in ripe
barley sixty metres from a low camera, so what has to read is the silhouette above the
grain, often against the light: the line of the back from the withers to the croup, the
thick arched neck under a heavy mane, the large straight-profiled head with its small ears
and forelock, and the heavy tail falling from the dock. The breed is stocky: short, strong
legs under a deep barrel; withers about 1.35 m, about 2 m from the point of the shoulder to
the point of the buttock.

How it is made:

- **Shape.** A signed distance field of ellipsoids and round cones (tapered capsules, some
  of them squashed into an elliptic section) joined by polynomial smooth unions: the barrel,
  chest, shoulders, withers, back, croup, quarters and thighs; the neck as a tapering core
  under an arched crest; the head as a cranium, the cheeks and jaw bars, a tapering face and
  the lips; the ears; four legs of forearm or gaskin, knee or hock, cannon, fetlock, pastern
  and hoof; the mane, the forelock and the tail with a little lumpiness in the hair. The
  hooves are cut flat on the ground plane.
- **Mesh.** The field is sampled on a 1 cm grid (symmetric about x = 0), polygonised with
  surface nets and projected onto the zero set, then decimated in Blender with a quadric
  edge collapse (symmetric in x) to about five thousand triangles and projected again.
  Normals are the field's gradient (smooth; the mesh normal where a thin ear tip disagrees).
- **Paint (COLOR_0, normalised unsigned bytes).** R = part id / 8 (0 body, 1 neck with the
  head, ears, mane and forelock, 2 front-left leg, 3 front-right, 4 hind-left, 5 hind-right,
  6 tail), the part of the element nearest the vertex, cleaned so each part is one connected
  region; G = a dark mask (mane, forelock, tail, the legs below the knees and hocks, the
  hooves) with a soft edge; B = a light mask (a mealy muzzle and the belly); A = 1.
- **Pivots** (metres, horse frame): the base of the neck, each shoulder and hip joint and the
  root of the dock, written into the file's extras and the manifest record.

Frame: metres, +z forward (toward the head), +y up, the hooves on y = 0, the body centred on
x = 0. The horse faces +z, so its left side is +x.
"""

import math
import time

import numpy as np

TAG = "[grainfields]"
NAME = "grainfields-horse"
BREED = "Hokkaido native horse (Dosanko)"
PARTS = {"body": 0, "neck": 1, "frontLeft": 2, "frontRight": 3, "hindLeft": 4, "hindRight": 5, "tail": 6}
PART_SCALE = 8
VOXEL = 0.01
TARGET_TRIANGLES = 5000
FAR = 10.0
MARGIN = 0.05
X_AXIS = (1.0, 0.0, 0.0)
Z_AXIS = (0.0, 0.0, 1.0)


# -- small helpers ------------------------------------------------------------------------
def _unit(vector):
    vector = np.asarray(vector, dtype=np.float64)
    return vector / np.linalg.norm(vector)


def _smoothstep(edge0, edge1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _smin(a, b, k):
    """Polynomial smooth minimum: a fillet of about k where two surfaces meet."""
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def _point(y, z, x=0.0):
    return np.array([x, y, z], dtype=np.float64)


# -- the distance field -------------------------------------------------------------------
class Shape:
    part = 0
    hair = False
    ear = False

    def leaves(self):
        return [self]

    def tag(self, part, hair=False):
        for leaf in self.leaves():
            leaf.part = part
            leaf.hair = hair
        return self

    def eval_block(self, xs, ys, zs):
        grid = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), axis=-1).reshape(-1, 3)
        return self.eval(grid).reshape(len(xs), len(ys), len(zs))


class Ellipsoid(Shape):
    """An ellipsoid; `along` turns its local z axis (radii[2]) onto a direction."""

    def __init__(self, centre, radii, along=None):
        self.centre = np.asarray(centre, dtype=np.float64)
        self.radii = np.asarray(radii, dtype=np.float64)
        if along is None:
            self.frame = np.eye(3)
        else:
            z = _unit(along)
            x = np.array(X_AXIS) - z * z[0]
            if np.linalg.norm(x) < 1e-6:
                x = np.array([0.0, 1.0, 0.0]) - z * z[1]
            x = _unit(x)
            self.frame = np.stack([x, np.cross(z, x), z], axis=1)

    def bounds(self):
        reach = float(self.radii.max())
        return self.centre - reach, self.centre + reach

    def eval(self, p):
        q = (p - self.centre) @ self.frame
        k0 = np.linalg.norm(q / self.radii, axis=1)
        k1 = np.linalg.norm(q / (self.radii * self.radii), axis=1)
        return np.where(k1 > 1e-9, k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), -float(self.radii.min()))


class RoundCone(Shape):
    """A tapered capsule from `a` (radius ra) to `b` (radius rb), optionally squashed.

    `squash` = (axis, factor) flattens the section along `axis` by `factor` (an elliptic
    section: the full radius across, radius x factor along the axis).
    """

    def __init__(self, a, b, ra, rb, squash=None):
        self.a = np.asarray(a, dtype=np.float64)
        self.b = np.asarray(b, dtype=np.float64)
        self.ra, self.rb = float(ra), float(rb)
        self.u, self.factor = (None, 1.0) if squash is None else (_unit(squash[0]), float(squash[1]))
        self.ba = self._stretch(self.b - self.a)
        self.l2 = float(self.ba @ self.ba)
        self.rr = self.ra - self.rb
        self.a2 = self.l2 - self.rr * self.rr
        if self.a2 <= 0.0:
            raise ValueError("round cone end spheres overlap: %s -> %s" % (self.a, self.b))
        self.il2 = 1.0 / self.l2

    def _stretch(self, v):
        if self.u is None:
            return v
        return v + (1.0 / self.factor - 1.0) * (v @ self.u)[..., None] * self.u

    def bounds(self):
        reach = max(self.ra, self.rb)
        return np.minimum(self.a, self.b) - reach, np.maximum(self.a, self.b) + reach

    def eval(self, p):
        # Inigo Quilez's exact round cone, evaluated in the stretched (canonical) space.
        pa = self._stretch(p - self.a)
        y = pa @ self.ba
        z = y - self.l2
        w = pa * self.l2 - y[:, None] * self.ba
        x2 = np.einsum("ij,ij->i", w, w)
        y2 = y * y * self.l2
        z2 = z * z * self.l2
        k = math.copysign(1.0, self.rr) * self.rr * self.rr * x2
        cap_b = np.sqrt(x2 + z2) * self.il2 - self.rb
        cap_a = np.sqrt(x2 + y2) * self.il2 - self.ra
        side = (np.sqrt(x2 * self.a2 * self.il2) + y * self.rr) * self.il2 - self.ra
        d = np.where(np.sign(z) * self.a2 * z2 > k, cap_b, np.where(np.sign(y) * self.a2 * y2 < k, cap_a, side))
        return d * self.factor


class Union(Shape):
    """Smooth union; each child is a shape or (shape, fillet)."""

    def __init__(self, children, k=0.0):
        self.children = [(child, k) if isinstance(child, Shape) else (child[0], float(child[1]))
                         for child in children]

    def leaves(self):
        return [leaf for child, _k in self.children for leaf in child.leaves()]

    def bounds(self):
        lows, highs = zip(*(child.bounds() for child, _k in self.children))
        pad = max(k for _child, k in self.children) * 0.25
        return np.min(lows, axis=0) - pad, np.max(highs, axis=0) + pad

    def eval(self, p):
        result = np.full(len(p), FAR)
        for child, k in self.children:
            low, high = child.bounds()
            inside = np.all((p >= low - k - MARGIN) & (p <= high + k + MARGIN), axis=1)
            if inside.any():
                result[inside] = _smin(result[inside], child.eval(p[inside]), k)
        return result

    def eval_block(self, xs, ys, zs):
        result = np.full((len(xs), len(ys), len(zs)), FAR)
        for child, k in self.children:
            low, high = child.bounds()
            ranges = []
            for axis, values in enumerate((xs, ys, zs)):
                start = int(np.searchsorted(values, low[axis] - k - MARGIN))
                stop = int(np.searchsorted(values, high[axis] + k + MARGIN, side="right"))
                ranges.append(slice(start, stop))
            if any(window.stop <= window.start for window in ranges):
                continue
            region = tuple(ranges)
            result[region] = _smin(result[region], child.eval_block(xs[ranges[0]], ys[ranges[1]], zs[ranges[2]]), k)
        return result


class Tube(Union):
    """Round cones through a polyline of stations: the neck, the legs, the hair."""

    def __init__(self, points, radii, squash_axis=None, squash=1.0, k=0.015):
        points = [np.asarray(point, dtype=np.float64) for point in points]
        factors = np.broadcast_to(np.asarray(squash, dtype=np.float64), (len(points),))
        cones = []
        for index in range(len(points) - 1):
            factor = 0.5 * (factors[index] + factors[index + 1])
            squash_spec = None if squash_axis is None or abs(factor - 1.0) < 1e-6 else (squash_axis, factor)
            cones.append(RoundCone(points[index], points[index + 1], radii[index], radii[index + 1], squash_spec))
        super().__init__(cones, k)


class Displace(Shape):
    """Lumps in the hair: the child's distance plus amplitude x fn(x, y, z)."""

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
        return self.child.eval_block(xs, ys, zs) + self.amplitude * self.fn(
            xs[:, None, None], ys[None, :, None], zs[None, None, :])


class HalfSpace(Shape):
    """The child cut flat by a coordinate plane, keeping the side where p[axis] >= 0.

    On y it stands the hooves on the ground; on x it keeps the left half of the horse,
    which is polygonised and decimated alone and then mirrored, so the mesh is exactly
    symmetric.
    """

    def __init__(self, child, axis):
        self.child, self.axis = child, int(axis)

    def leaves(self):
        return self.child.leaves()

    def bounds(self):
        low, high = self.child.bounds()
        low = low.copy()
        low[self.axis] = max(low[self.axis], 0.0)
        return low, high

    def eval(self, p):
        return np.maximum(self.child.eval(p), -p[:, self.axis])

    def eval_block(self, xs, ys, zs):
        plane = [xs[:, None, None], ys[None, :, None], zs[None, None, :]][self.axis]
        return np.maximum(self.child.eval_block(xs, ys, zs), -plane)


def _mane_locks(x, y, z):
    # Symmetric in x, so the mesh stays mirror-symmetric.
    return np.sin(47.0 * y - 19.0 * z + 0.7) * np.cos(23.0 * x) * np.sin(29.0 * z + 11.0 * y + 1.9)


def _tail_strands(x, y, z):
    return np.cos(61.0 * x) * (0.55 + 0.45 * np.sin(17.0 * y + 31.0 * z))


# -- the horse ----------------------------------------------------------------------------
def _crest_offsets(line, offsets):
    """Stations moved off a (y, z) polyline along its upper-back normal by `offsets`."""
    line = np.asarray(line, dtype=np.float64)
    out = []
    for index, (y, z) in enumerate(line):
        before = line[max(0, index - 1)]
        after = line[min(len(line) - 1, index + 1)]
        tangent = _unit(after - before)
        normal = np.array([tangent[1], -tangent[0]])  # (dy, dz) -> up and back
        out.append(_point(y + normal[0] * offsets[index], z + normal[1] * offsets[index]))
    return out


# Where the legs stand (z of the front and hind cannons): 1.15 m apart, square.
FRONT_Z = 0.445
HIND_Z = -0.70


def _front_leg(side):
    x = 0.14 * side
    z = FRONT_Z
    return Union([
        # The forearm, muscled under the elbow and lean above the knee.
        Ellipsoid(_point(0.78, z + 0.015, x), (0.08, 0.085, 0.15), along=(0.0, 1.0, 0.04)),
        Tube([_point(0.88, z + 0.01, x), _point(0.62, z + 0.005, x), _point(0.45, z, x)], [0.085, 0.07, 0.05],
             squash_axis=X_AXIS, squash=0.86),
        # The knee (carpus), flat in front.
        Ellipsoid(_point(0.415, z, x), (0.054, 0.058, 0.056)),
        # The cannon, narrow from the front, the fetlock with a little feather, the sloping
        # pastern and the hoof.
        Tube([_point(0.40, z - 0.002, x), _point(0.15, z - 0.003, x)], [0.046, 0.043], squash_axis=X_AXIS,
             squash=0.8),
        Ellipsoid(_point(0.118, z - 0.003, x), (0.05, 0.053, 0.06)),
        Ellipsoid(_point(0.095, z - 0.03, x), (0.042, 0.044, 0.042)),
        Tube([_point(0.115, z, x), _point(0.06, z + 0.027, x)], [0.039, 0.043]),
        RoundCone(_point(0.072, z + 0.031, x), _point(0.012, z + 0.047, x), 0.048, 0.066),
    ], k=0.03)


def _hind_leg(side):
    x = 0.15 * side
    z = HIND_Z
    return Union([
        # The gaskin from the stifle down and back to the hock, with its muscle behind.
        Tube([_point(0.86, z + 0.34, x * 1.12), _point(0.66, z + 0.15, x), _point(0.50, z + 0.005, x)],
             [0.11, 0.085, 0.058], squash_axis=X_AXIS, squash=0.78),
        Ellipsoid(_point(0.69, z + 0.09, x), (0.075, 0.09, 0.14), along=(0.0, 0.62, 0.78)),
        # The hock and its point.
        Ellipsoid(_point(0.49, z + 0.002, x), (0.05, 0.066, 0.068)),
        Ellipsoid(_point(0.525, z - 0.055, x), (0.032, 0.042, 0.032)),
        # The cannon, the fetlock and its feather, the pastern and the hoof.
        Tube([_point(0.47, z - 0.002, x), _point(0.15, z + 0.002, x)], [0.047, 0.043], squash_axis=X_AXIS,
             squash=0.8),
        Ellipsoid(_point(0.118, z + 0.002, x), (0.05, 0.053, 0.059)),
        Ellipsoid(_point(0.095, z - 0.024, x), (0.042, 0.044, 0.042)),
        Tube([_point(0.115, z - 0.002, x), _point(0.06, z + 0.022, x)], [0.038, 0.042]),
        RoundCone(_point(0.072, z + 0.026, x), _point(0.012, z + 0.042, x), 0.046, 0.063),
    ], k=0.03)


def design():
    """The horse as a distance field, and the landmarks the paint and the pivots use."""
    body = Union([
        # The deep barrel and the round belly under it.
        Ellipsoid(_point(0.97, -0.03), (0.29, 0.31, 0.50)),
        Ellipsoid(_point(0.85, -0.06), (0.28, 0.2, 0.38)),
        # The girth and the chest, the shoulders sloping up to the withers.
        Ellipsoid(_point(0.99, 0.26), (0.26, 0.30, 0.28)),
        Ellipsoid(_point(0.99, 0.52), (0.20, 0.24, 0.22)),
        (Ellipsoid(_point(1.12, 0.48, 0.10), (0.15, 0.12, 0.29), along=(0.0, 0.60, -0.80)), 0.1),
        (Ellipsoid(_point(1.12, 0.48, -0.10), (0.15, 0.12, 0.29), along=(0.0, 0.60, -0.80)), 0.1),
        (Ellipsoid(_point(1.215, 0.30), (0.10, 0.115, 0.22), along=(0.0, 0.25, 0.97)), 0.1),
        # A broad, flat back and loins, a little below the withers and the croup.
        Ellipsoid(_point(1.165, -0.08), (0.22, 0.11, 0.33)),
        # The quarters, the croup falling to the tail, the stifles and the thighs down to the
        # gaskins.
        Ellipsoid(_point(1.04, -0.49), (0.275, 0.27, 0.31)),
        (Ellipsoid(_point(1.195, -0.42), (0.19, 0.115, 0.27), along=(0.0, 0.30, 0.95)), 0.1),
        (Ellipsoid(_point(0.86, -0.33, 0.18), (0.09, 0.13, 0.11)), 0.08),
        (Ellipsoid(_point(0.86, -0.33, -0.18), (0.09, 0.13, 0.11)), 0.08),
        (Ellipsoid(_point(0.88, -0.63, 0.14), (0.14, 0.14, 0.21), along=(0.0, -0.848, 0.53)), 0.08),
        (Ellipsoid(_point(0.88, -0.63, -0.14), (0.14, 0.14, 0.21), along=(0.0, -0.848, 0.53)), 0.08),
    ], k=0.12).tag(PARTS["body"])

    # The neck: a deep, tapering core at about 47 degrees under an arched crest.
    core = Tube([_point(1.10, 0.54), _point(1.25, 0.70), _point(1.40, 0.84), _point(1.53, 0.95), _point(1.64, 1.04)],
                [0.25, 0.215, 0.175, 0.15, 0.13], squash_axis=X_AXIS, squash=[0.74, 0.74, 0.76, 0.78, 0.82], k=0.03)
    crest_line = [(1.33, 0.28), (1.485, 0.46), (1.62, 0.66), (1.72, 0.86), (1.79, 1.01)]
    crest_radii = [0.10, 0.10, 0.09, 0.08, 0.07]
    crest = Tube(_crest_offsets(crest_line, [-r for r in crest_radii]), crest_radii, squash_axis=X_AXIS,
                 squash=0.9, k=0.03)

    # The head, laid out in its own frame from the poll: s forward along the face (48
    # degrees below the horizontal), t toward the forehead, x across; a large head, 0.62 m
    # from the poll to the lips.
    poll = _point(1.80, 1.04)
    pitch = math.radians(48.0)
    forward = np.array([0.0, -math.sin(pitch), math.cos(pitch)])
    up = np.array([0.0, math.cos(pitch), math.sin(pitch)])
    scale = 1.08

    def head(s, t, x=0.0):
        return poll + scale * (s * forward + t * up + np.array([x, 0.0, 0.0]))

    def radii(*values):
        return tuple(scale * value for value in values)

    head_shape = Union([
        Ellipsoid(head(0.11, -0.05), radii(0.112, 0.115, 0.15), along=forward),          # cranium
        Ellipsoid(head(0.13, -0.15), radii(0.105, 0.12, 0.13), along=forward),           # cheeks
        RoundCone(head(0.20, -0.04), head(0.47, -0.05), *radii(0.105, 0.072), (X_AXIS, 0.82)),  # face
        Ellipsoid(head(0.505, -0.072), radii(0.06, 0.068, 0.068), along=forward),       # lips and nostrils
        RoundCone(head(0.20, -0.215, 0.04), head(0.45, -0.125, 0.03), *radii(0.05, 0.033)),  # jaw bars
        RoundCone(head(0.20, -0.215, -0.04), head(0.45, -0.125, -0.03), *radii(0.05, 0.033)),
        Ellipsoid(head(0.48, -0.125), radii(0.04, 0.035, 0.045), along=forward),         # chin
        Ellipsoid(head(0.13, 0.0, 0.1), radii(0.03, 0.035, 0.04), along=forward),        # eyes
        Ellipsoid(head(0.13, 0.0, -0.1), radii(0.03, 0.035, 0.04), along=forward),
    ], k=0.05)

    # Small ears for the head, but the first thing a silhouette needs: up, a little forward
    # and out, cupped (thin front to back).
    ears = []
    for side in (1.0, -1.0):
        base = head(0.0, 0.03, 0.062 * side)
        direction = _unit((0.2 * side, 0.95, 0.25))
        across = _unit(np.array(Z_AXIS) - direction * direction[2])
        ears.append(Tube([base, base + 0.08 * direction, base + 0.15 * direction], [0.038, 0.032, 0.011],
                         squash_axis=across, squash=0.62, k=0.01))
    ears = Union(ears)
    for leaf in ears.leaves():
        leaf.ear = True

    # The mane rides the crest from the poll to the front of the withers, heavy enough to fall
    # to both sides of it.
    mane_line = [(1.39, 0.35)] + crest_line[1:]
    falls = [Tube([station + np.array([0.075 * side, 0.0, 0.0])
                   for station in _crest_offsets(mane_line, [-0.07, -0.08, -0.075, -0.065, -0.05])],
                  [0.03, 0.06, 0.07, 0.065, 0.05], squash_axis=X_AXIS, squash=0.55, k=0.02) for side in (1.0, -1.0)]
    mane = Displace(Union([
        Tube(_crest_offsets(mane_line, [0.012] * 5), [0.035, 0.05, 0.058, 0.058, 0.05], k=0.02), *falls,
    ], k=0.02), 0.012, _mane_locks)
    # The forelock falls from between the ears over the forehead to the eyes.
    forelock = Displace(RoundCone(head(-0.01, 0.07), head(0.22, 0.075), 0.05, 0.03, (up, 0.6)), 0.008,
                        _mane_locks)

    # The tail: the dock arches off the croup and lies down the buttocks; the hair falls
    # from it, full and a little flattened, and parts into locks at its end. It hangs clear of
    # the hocks (a hand's breadth behind them), so it lifts and swishes on its own.
    dock = Tube([_point(1.24, -0.72), _point(1.17, -0.83), _point(1.07, -0.875)], [0.065, 0.058, 0.05])
    locks = [RoundCone(_point(0.48, -0.965), _point(0.27, -0.975), 0.06, 0.012, (Z_AXIS, 0.6))]
    for side in (1.0, -1.0):
        locks.append(RoundCone(_point(0.50, -0.965, 0.04 * side), _point(0.32, -0.97, 0.085 * side), 0.05, 0.01,
                               (Z_AXIS, 0.6)))
    hair = Displace(Union([
        Tube([_point(1.20, -0.82), _point(1.08, -0.89), _point(0.90, -0.935), _point(0.70, -0.955),
              _point(0.52, -0.965), _point(0.42, -0.965)], [0.08, 0.105, 0.12, 0.125, 0.11, 0.09],
             squash_axis=Z_AXIS, squash=0.62, k=0.02),
        *[(lock, 0.03) for lock in locks],
    ]), 0.009, _tail_strands)

    neck = Union([
        (core, 0.0), (crest, 0.08), (head_shape, 0.07), (ears, 0.025),
    ]).tag(PARTS["neck"])
    mane.tag(PARTS["neck"], hair=True)
    forelock.tag(PARTS["neck"], hair=True)
    tail = Union([dock.tag(PARTS["tail"], hair=True), (hair.tag(PARTS["tail"], hair=True), 0.04)])
    legs = [
        _front_leg(1.0).tag(PARTS["frontLeft"]), _front_leg(-1.0).tag(PARTS["frontRight"]),
        _hind_leg(1.0).tag(PARTS["hindLeft"]), _hind_leg(-1.0).tag(PARTS["hindRight"]),
    ]
    root = HalfSpace(Union([
        (body, 0.0), (neck, 0.1), (mane, 0.05), (forelock, 0.02),
        *[(leg, 0.07) for leg in legs], (tail, 0.04),
    ]), axis=1)
    landmarks = dict(
        muzzle=head(0.575, -0.072),
        # The neck leaves the body through a plane from the front of the withers down to the
        # foot of the jugular groove (above the point of the shoulder): (y, z) pairs.
        neckBase=((1.35, 0.29), (1.04, 0.80)),
        frontCut=0.80,      # a front leg's part ends under the elbow
        hindCut=0.86,       # a hind leg's part ends at the stifle
        frontPoints=(0.50, 0.40),   # dark points fade in below the knee
        hindPoints=(0.57, 0.47),    # ... and below the hock
        pivots=dict(
            # The base of the neck: the middle of the plane the neck leaves the body by.
            neck=[0.0, 1.195, 0.545],
            # The shoulder joints above the forearms, the hip joints above the stifles.
            frontLeft=[0.14, 1.0, 0.48], frontRight=[-0.14, 1.0, 0.48],
            hindLeft=[0.15, 1.0, -0.50], hindRight=[-0.15, 1.0, -0.50],
            # The root of the dock, inside the top of the croup.
            tail=[0.0, 1.24, -0.72],
            # The joints down a leg (the left one's; a right one's mirrors x): the knee (carpus),
            # the hock, the fetlocks.
            knee=[0.14, 0.415, FRONT_Z], hock=[0.15, 0.49, HIND_Z + 0.002],
            frontFetlock=[0.14, 0.118, FRONT_Z - 0.003], hindFetlock=[0.15, 0.118, HIND_Z + 0.002],
            # The head nods about the atlas, under the poll; the ears turn about their bases.
            poll=[0.0, 1.745, 0.97], ear=[0.067, 1.822, 1.064],
        ),
        rig=dict(
            # A leg's weight fades out up into the body over these heights (skin over the shoulder
            # and the stifle, no tear where the leg meets the trunk).
            frontBand=(0.80, 0.98), hindBand=(0.86, 1.04),
            # The neck's weight across the plane it leaves the body by, and its axis (y, z) from
            # its base to the atlas; the head's across the plane from behind the poll to the throat.
            neckAxis=((1.195, 0.545), (1.745, 0.97)),
            headPlane=((1.86, 0.98), (1.48, 0.93)),
            # The tail from its root down to its end (heights).
            tailSpan=(1.24, 0.27),
        ),
    )
    return root, landmarks


# -- polygonising -------------------------------------------------------------------------
def _grid(shape, voxel):
    """Samples at half-voxel offsets, so the cut planes x = 0 and y = 0 cross mid-cell."""
    low, high = shape.bounds()

    def samples(start, stop):
        return (np.arange(int(math.floor(start / voxel)) - 2, int(math.ceil(stop / voxel)) + 3) + 0.5) * voxel

    return samples(low[0], high[0]), samples(low[1], high[1]), samples(low[2], high[2])


def surface_nets(field, xs, ys, zs):
    """Naive surface nets: one vertex per surface cell, one quad per crossing edge."""
    nx, ny, nz = field.shape
    voxel = float(xs[1] - xs[0])
    origin = np.array([xs[0], ys[0], zs[0]])
    inside = field < 0.0
    dims = np.array([nx - 1, ny - 1, nz - 1])
    cells = int(np.prod(dims))
    sums = np.zeros((cells, 3))
    counts = np.zeros(cells)
    quads = []
    for axis in range(3):
        lower = [slice(None)] * 3
        upper = [slice(None)] * 3
        lower[axis] = slice(0, -1)
        upper[axis] = slice(1, None)
        crossing = inside[tuple(lower)] != inside[tuple(upper)]
        index = np.stack(np.nonzero(crossing), axis=1)
        if not len(index):
            continue
        ahead = index.copy()
        ahead[:, axis] += 1
        f0 = field[index[:, 0], index[:, 1], index[:, 2]]
        f1 = field[ahead[:, 0], ahead[:, 1], ahead[:, 2]]
        t = f0 / (f0 - f1)
        position = origin + index * voxel
        position[:, axis] += t * voxel
        b, c = (axis + 1) % 3, (axis + 2) % 3
        corners = []
        for db, dc in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            cell = index.copy()
            cell[:, b] += db
            cell[:, c] += dc
            valid = np.all((cell >= 0) & (cell < dims), axis=1)
            flat = (cell[:, 0] * dims[1] + cell[:, 1]) * dims[2] + cell[:, 2]
            for component in range(3):
                sums[:, component] += np.bincount(flat[valid], weights=position[valid, component], minlength=cells)
            counts += np.bincount(flat[valid], minlength=cells)
            corners.append(np.where(valid, flat, -1))
        corners = np.stack(corners, axis=1)
        whole = np.all(corners >= 0, axis=1)
        quad = corners[whole]
        # Wound so the normal points out: +axis when the lower end is inside.
        outward_negative = ~inside[index[whole, 0], index[whole, 1], index[whole, 2]]
        quad[outward_negative] = quad[outward_negative][:, ::-1]
        quads.append(quad)
    active = counts > 0
    lookup = np.full(cells, -1, dtype=np.int64)
    lookup[active] = np.arange(int(active.sum()))
    vertices = sums[active] / counts[active][:, None]
    quads = lookup[np.concatenate(quads)]
    a, b, c, d = (vertices[quads[:, i]] for i in range(4))
    short = np.linalg.norm(a - c, axis=1) <= np.linalg.norm(b - d, axis=1)
    triangles = np.concatenate([
        np.where(short[:, None], quads[:, [0, 1, 2]], quads[:, [0, 1, 3]]),
        np.where(short[:, None], quads[:, [0, 2, 3]], quads[:, [1, 2, 3]]),
    ])
    return vertices, triangles


def gradient(shape, p, eps=0.0015):
    out = np.zeros_like(p)
    for axis in range(3):
        step = np.zeros(3)
        step[axis] = eps
        out[:, axis] = (shape.eval(p + step) - shape.eval(p - step)) / (2.0 * eps)
    return out


def project(shape, p, iterations=3, limit=0.01):
    """Newton steps onto the zero set, each step at most `limit` metres."""
    p = p.copy()
    for _ in range(iterations):
        value = shape.eval(p)
        grad = gradient(shape, p)
        step = value[:, None] * grad / np.maximum((grad * grad).sum(axis=1), 1e-8)[:, None]
        length = np.linalg.norm(step, axis=1)
        step *= np.minimum(1.0, limit / np.maximum(length, 1e-12))[:, None]
        p -= step
    return p


def mesh_normals(positions, triangles):
    a, b, c = (positions[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    normals = np.zeros_like(positions)
    for i in range(3):
        np.add.at(normals, triangles[:, i], face)
    return normals / np.maximum(np.linalg.norm(normals, axis=1), 1e-12)[:, None]


def decimate(studio, positions, triangles, target):
    """Quadric edge collapse in Blender; returns glTF-frame arrays."""
    import bpy
    obj = studio.mesh_object("horse_dense", positions, triangles)
    modifier = obj.modifiers.new("decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = min(1.0, target / float(len(triangles)))
    modifier.use_collapse_triangulate = True
    depsgraph = studio.layer.depsgraph
    depsgraph.update()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
    mesh.calc_loop_triangles()
    count = len(mesh.vertices)
    co = np.zeros(count * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    loops = np.zeros(len(mesh.loop_triangles) * 3, dtype=np.int64)
    mesh.loop_triangles.foreach_get("vertices", loops)
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(data)
    bpy.data.meshes.remove(mesh)
    # Blender (x, y forward, z up) -> glTF (x, y up, z toward the viewer).
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1), loops.reshape(-1, 3)


def _compact(positions, triangles):
    used = np.unique(triangles)
    remap = np.full(len(positions), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return positions[used].copy(), remap[triangles]


def rim(count, triangles):
    """Vertices on the open boundary (edges used by one triangle)."""
    edges = np.sort(np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), axis=1)
    unique, uses = np.unique(edges, axis=0, return_counts=True)
    mask = np.zeros(count, dtype=bool)
    mask[unique[uses == 1].ravel()] = True
    return mask


def on_seam(shape, points):
    """Points moved onto x = 0 and, within that plane, onto the horse's surface."""
    points = points.copy()
    points[:, 0] = 0.0
    for _ in range(4):
        points = project(shape, points, iterations=1, limit=VOXEL)
        points[:, 0] = 0.0
    return points


def open_half(shape, positions, triangles):
    """Drop the flat face the half was cut by, leaving its rim on the seam at x = 0."""
    cut = np.all(np.abs(positions[triangles, 0]) < 1e-6, axis=1)
    positions, triangles = _compact(positions, triangles[~cut])
    seam = rim(len(positions), triangles)
    positions[seam] = on_seam(shape, positions[seam])
    return positions, triangles


def folded(shape, positions, triangles):
    """Triangles facing against the field's outward normal (a decimation fold)."""
    a, b, c = (positions[triangles[:, i]] for i in range(3))
    face = np.cross(b - a, c - a)
    outward = gradient(shape, (a + b + c) / 3.0)

    def unit(vectors):
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1), 1e-12)[:, None]

    # The corners' normals too: in a crease the field turns quickly under a triangle.
    corners = sum(unit(gradient(shape, corner)) for corner in (a, b, c))
    return ((face * outward).sum(axis=1) <= 0.0) | ((face * corners).sum(axis=1) <= 0.0)


def collapse_bad(shape, positions, triangles, seam, passes=4):
    """Collapse the shortest edge of every folded or degenerate triangle."""
    for _ in range(passes):
        a, b, c = (positions[triangles[:, i]] for i in range(3))
        area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
        bad = np.nonzero(folded(shape, positions, triangles) | (area < 1e-8))[0]
        if not len(bad):
            break
        parent = np.arange(len(positions))

        def find(vertex):
            while parent[vertex] != vertex:
                parent[vertex] = parent[parent[vertex]]
                vertex = parent[vertex]
            return vertex

        for index in bad:
            corners = triangles[index]
            lengths = [np.linalg.norm(positions[corners[i]] - positions[corners[(i + 1) % 3]]) for i in range(3)]
            first = int(np.argmin(lengths))
            keep, gone = find(corners[first]), find(corners[(first + 1) % 3])
            if keep == gone:
                continue
            if seam[gone] and not seam[keep]:
                keep, gone = gone, keep
            if seam[keep] == seam[gone]:
                positions[keep] = 0.5 * (positions[keep] + positions[gone])
            parent[gone] = keep
        target = np.array([find(vertex) for vertex in range(len(positions))])
        triangles = target[triangles]
        triangles = triangles[(triangles[:, 0] != triangles[:, 1]) & (triangles[:, 1] != triangles[:, 2])
                              & (triangles[:, 2] != triangles[:, 0])]
        # Two triangles on the same three corners are a fin: drop both.
        keys, inverse, uses = np.unique(np.sort(triangles, axis=1), axis=0, return_inverse=True, return_counts=True)
        triangles = triangles[uses[inverse.ravel()] == 1]
        used = np.unique(triangles)
        remap = np.full(len(positions), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        positions, seam, triangles = positions[used].copy(), seam[used], remap[triangles]
        moved = ~seam
        positions[moved] = project(shape, positions[moved], iterations=2, limit=VOXEL)
        positions[seam] = on_seam(shape, positions[seam])
    return positions, triangles, seam


def untangle(shape, positions, triangles, seam, passes=8):
    """Relax the corners of folded triangles toward their neighbours and back onto the field."""
    neighbours = _neighbours(len(positions), triangles)
    for _ in range(passes):
        bad = folded(shape, positions, triangles)
        if not bad.any():
            break
        corners = np.unique(triangles[bad])
        relaxed = np.array([positions[neighbours[v]].mean(axis=0) for v in corners])
        relaxed = project(shape, relaxed, iterations=3, limit=VOXEL)
        on = seam[corners]
        relaxed[on] = on_seam(shape, relaxed[on])
        positions[corners] = relaxed
    return positions, int(folded(shape, positions, triangles).sum())


def mirror(positions, triangles, seam):
    """The left half and its mirror image, welded on the seam at x = 0."""
    off = np.nonzero(~seam)[0]
    image = np.arange(len(positions))
    image[off] = len(positions) + np.arange(len(off))
    mirrored = positions[off] * np.array([-1.0, 1.0, 1.0])
    positions = np.concatenate([positions, mirrored])
    triangles = np.concatenate([triangles, image[triangles][:, ::-1]])
    return positions, triangles


# -- paint --------------------------------------------------------------------------------
def _neighbours(count, triangles):
    edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    out = [[] for _ in range(count)]
    for a, b in edges:
        out[a].append(int(b))
        out[b].append(int(a))
    return [np.array(entry, dtype=np.int64) for entry in out]


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


def paint(shape, landmarks, positions, normals, triangles):
    """COLOR_0: R = part / 8, G = dark mask, B = light mask, A = 1."""
    leaves = shape.leaves()
    distances = np.stack([leaf.eval(positions) for leaf in leaves], axis=1)
    leaf_parts = np.array([leaf.part for leaf in leaves])
    hair = np.array([leaf.hair for leaf in leaves])
    y = positions[:, 1]
    claim = distances.copy()
    for column, part in enumerate(leaf_parts):
        if part in (PARTS["frontLeft"], PARTS["frontRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["frontCut"])
        elif part in (PARTS["hindLeft"], PARTS["hindRight"]):
            claim[:, column] += 4.0 * np.maximum(0.0, y - landmarks["hindCut"])
    parts = leaf_parts[np.argmin(claim, axis=1)]
    # Between the neck and the body the boundary is the plane at the base of the neck.
    (top_y, top_z), (low_y, low_z) = landmarks["neckBase"]
    ahead = (positions[:, 1] - top_y) * (low_z - top_z) + (positions[:, 2] - top_z) * (top_y - low_y) > 0.0
    trunk = np.isin(parts, (PARTS["body"], PARTS["neck"]))
    parts = np.where(trunk, np.where(ahead, PARTS["neck"], PARTS["body"]), parts)
    # The mane is the neck's wherever it lies.
    nearest = np.argmin(distances, axis=1)
    parts = np.where(hair[nearest] & (leaf_parts[nearest] == PARTS["neck"]), PARTS["neck"], parts)
    neighbours = _neighbours(len(positions), triangles)
    parts = _clean_parts(parts, neighbours)

    hairiness = _smoothstep(0.012, -0.012, distances[:, hair].min(axis=1) - distances[:, ~hair].min(axis=1))
    front = np.isin(parts, (PARTS["frontLeft"], PARTS["frontRight"]))
    hind = np.isin(parts, (PARTS["hindLeft"], PARTS["hindRight"]))
    points = np.where(front, _smoothstep(*landmarks["frontPoints"], y), 0.0)
    points = np.where(hind, _smoothstep(*landmarks["hindPoints"], y), points)
    dark = np.maximum(hairiness, points)
    muzzle = _smoothstep(0.17, 0.06, np.linalg.norm(positions - landmarks["muzzle"], axis=1))
    belly = _smoothstep(0.86, 0.7, y) * _smoothstep(-0.1, -0.6, normals[:, 1]) * (parts == PARTS["body"])
    light = np.maximum(muzzle, belly) * (1.0 - dark)
    parts, weights = rig(landmarks, positions, distances, leaves, parts)
    colors = np.stack([parts / float(PART_SCALE), dark, light, np.ones(len(parts))], axis=1)
    return colors, parts, weights


def _plane_distance(positions, top, low):
    """Signed distance (metres) from the (y, z) line through `top` and `low`; positive ahead (+z)."""
    (top_y, top_z), (low_y, low_z) = top, low
    normal = np.array([low_z - top_z, top_y - low_y])
    normal /= np.linalg.norm(normal)
    return (positions[:, 1] - top_y) * normal[0] + (positions[:, 2] - top_z) * normal[1]


def rig(landmarks, positions, distances, leaves, parts):
    """The skin's weights (_RIG, four normalised unsigned bytes) and the parts they belong to.

    R = how far the vertex follows its part's root joint (0 with the trunk, 1 with the part);
    soft across a band where the part meets the trunk, so the skin stretches there instead of
    tearing (a band vertex takes the part's id with a weight under 1).
    G = a leg: below the knee or the hock; the neck: the head, beyond the atlas; the tail: how
    far down it the vertex lies (0 at the root, 1 at the end).
    B = a leg: below the fetlock; the neck: how far up it (0 at its base, 1 at the atlas).
    A = the neck: the ears.
    """
    R = landmarks["rig"]
    pivots = landmarks["pivots"]
    y = positions[:, 1]
    count = len(positions)
    leaf_parts = np.array([leaf.part for leaf in leaves])
    ear_leaf = np.array([leaf.ear for leaf in leaves])

    def nearest(part):
        return distances[:, leaf_parts == part].min(axis=1)

    legs_ids = [PARTS[name] for name in ("frontLeft", "frontRight", "hindLeft", "hindRight")]

    def others(part):
        # Nearer this part than what it could tear from: the trunk, and the tail hanging by the hocks
        # (a leg is never joined to another leg, so their nearness does not count).
        exclude = legs_ids if part in legs_ids else [part]
        return distances[:, ~np.isin(leaf_parts, exclude)].min(axis=1)

    weights = np.zeros((count, 7))
    # The legs: nearer the leg than the trunk, faded out up into the body.
    for name in ("frontLeft", "frontRight", "hindLeft", "hindRight"):
        part = PARTS[name]
        low, high = R["frontBand"] if name.startswith("front") else R["hindBand"]
        side = 1.0 if name.endswith("Left") else -1.0
        own = (positions[:, 0] * side) > -0.02
        # (Soft over a wide margin: the mesh's vertices stand three or four centimetres apart, and the
        # skin must stretch over several of them, not one edge.)
        soft = np.maximum(_smoothstep(-0.02, 0.2, others(part) - nearest(part)), _smoothstep(0.62, 0.5, y) * (parts == part))
        weights[:, part] = soft * _smoothstep(high, low, y) * own
    # The neck: across the plane it leaves the body by (the mane with it).
    (base_y, base_z), (top_y, top_z) = R["neckAxis"]
    neck_plane = _plane_distance(positions, *landmarks["neckBase"])
    trunk_or_neck = np.isin(parts, (PARTS["body"], PARTS["neck"]))
    weights[:, PARTS["neck"]] = _smoothstep(-0.13, 0.15, neck_plane) * trunk_or_neck
    # The tail: nearer the tail than the trunk, from a little below its root.
    tail_top, tail_end = R["tailSpan"]
    along_tail = np.clip((tail_top - y) / (tail_top - tail_end), 0.0, 1.0)
    # (Only up by the dock does the skin blend into the croup: lower down the hair is the tail's.)
    tail_soft = np.maximum(_smoothstep(-0.02, 0.15, others(PARTS["tail"]) - nearest(PARTS["tail"])),
                           _smoothstep(0.2, 0.4, along_tail) * (parts == PARTS["tail"]))
    weights[:, PARTS["tail"]] = tail_soft * _smoothstep(0.0, 0.3, along_tail) * (parts != PARTS["neck"])
    best = np.argmax(weights, axis=1)
    root = weights[np.arange(count), best]
    rigged = np.where(root > 0.002, best, PARTS["body"])
    root = np.where(rigged == PARTS["body"], 0.0, root)

    second = np.zeros(count)
    third = np.zeros(count)
    fourth = np.zeros(count)
    legs = {PARTS["frontLeft"]: ("knee", "frontFetlock"), PARTS["frontRight"]: ("knee", "frontFetlock"),
            PARTS["hindLeft"]: ("hock", "hindFetlock"), PARTS["hindRight"]: ("hock", "hindFetlock")}
    for part, (joint, fetlock) in legs.items():
        mine = rigged == part
        joint_y, fetlock_y = pivots[joint][1], pivots[fetlock][1]
        second[mine] = _smoothstep(joint_y + 0.04, joint_y - 0.03, y[mine])
        third[mine] = _smoothstep(fetlock_y + 0.04, fetlock_y - 0.03, y[mine])
    neck = rigged == PARTS["neck"]
    head_plane = _plane_distance(positions, *R["headPlane"])
    second[neck] = _smoothstep(-0.04, 0.06, head_plane[neck])
    axis = np.array([top_y - base_y, top_z - base_z])
    progress = ((positions[:, 1] - base_y) * axis[0] + (positions[:, 2] - base_z) * axis[1]) / (axis @ axis)
    # The head rides the top of the neck whole (no shear as the neck bends): all the way up.
    third[neck] = np.maximum(np.clip(progress[neck], 0.0, 1.0), second[neck])
    ear_distance = distances[:, ear_leaf].min(axis=1)
    head_distance = distances[:, (leaf_parts == PARTS["neck"]) & ~ear_leaf].min(axis=1)
    fourth[neck] = _smoothstep(-0.004, 0.02, head_distance[neck] - ear_distance[neck])
    tail = rigged == PARTS["tail"]
    second[tail] = along_tail[tail]
    return rigged, np.stack([root, second, third, fourth], axis=1)


# -- the build ----------------------------------------------------------------------------
class Horse:
    def __init__(self, positions, normals, colors, triangles, parts, pivots, stats, weights):
        self.positions, self.normals, self.colors = positions, normals, colors
        self.triangles, self.parts, self.pivots, self.stats = triangles, parts, pivots, stats
        self.weights = weights

    def measures(self):
        # The trunk: the body and the skin of the band round it that mostly stays with it.
        trunk = (self.parts == PARTS["body"]) | ((self.weights[:, 0] < 0.5) & (self.parts != PARTS["tail"]))
        body = self.positions[trunk]
        coat = self.positions[trunk & (self.colors[:, 1] < 0.5)]
        withers = coat[(coat[:, 2] > 0.1) & (coat[:, 2] < 0.5)]
        return dict(withersHeight=float(withers[:, 1].max()), bodyLength=float(body[:, 2].max() - body[:, 2].min()),
                    length=float(np.ptp(self.positions[:, 2])), height=float(self.positions[:, 1].max()))

    def record(self):
        return dict(name=NAME, breed=BREED, triangles=int(len(self.triangles)), vertices=int(len(self.positions)),
                    parts=dict(PARTS), partScale=PART_SCALE, pivots=self.pivots,
                    **{key: round(value, 4) for key, value in self.measures().items()})


def build(studio, voxel=VOXEL, target=TARGET_TRIANGLES):
    """Polygonise and decimate the left half, mirror it, and paint the whole horse."""
    started = time.time()
    shape, landmarks = design()
    half = HalfSpace(shape, axis=0)
    xs, ys, zs = _grid(half, voxel)
    field = half.eval_block(xs, ys, zs)
    sampled = time.time()
    dense, dense_triangles = surface_nets(field, xs, ys, zs)
    dense = project(half, dense, iterations=2, limit=voxel)
    dense, dense_triangles = open_half(shape, dense, dense_triangles)
    netted = time.time()
    positions, triangles = decimate(studio, dense, dense_triangles, target // 2)
    decimated = len(triangles)
    seam = rim(len(positions), triangles)
    positions[~seam] = project(shape, positions[~seam], iterations=3, limit=voxel)
    positions[seam] = on_seam(shape, positions[seam])
    positions[:, 1] = np.maximum(positions[:, 1], 0.0)
    positions, triangles, seam = collapse_bad(shape, positions, triangles, seam)
    positions, folds = untangle(shape, positions, triangles, seam)
    # The soles stand exactly on the ground.
    positions[positions[:, 1] < 5e-4, 1] = 0.0
    positions, triangles = mirror(positions, triangles, seam)
    grad = gradient(shape, positions)
    grad[positions[:, 0] == 0.0, 0] = 0.0
    normals = grad / np.maximum(np.linalg.norm(grad, axis=1), 1e-12)[:, None]
    flat = mesh_normals(positions, triangles)
    disagree = (normals * flat).sum(axis=1) < 0.4
    normals[disagree] = flat[disagree]
    colors, parts, weights = paint(shape, landmarks, positions, normals, triangles)
    pivots = {name: [round(float(v), 4) for v in value] for name, value in landmarks["pivots"].items()}
    stats = dict(grid=[len(xs), len(ys), len(zs)], dense_vertices=len(dense), dense_triangles=len(dense_triangles),
                 half_triangles=decimated, vertices=len(positions), triangles=len(triangles), folds=folds,
                 mesh_normals=int(disagree.sum()), field_s=sampled - started, nets_s=netted - sampled,
                 total_s=time.time() - started)
    horse = Horse(positions, normals, colors, triangles, parts, pivots, stats, weights)
    low, high = positions.min(axis=0), positions.max(axis=0)
    print("%s horse grid %s half dense %d tris -> %d -> mirrored %d tris %d verts (%d folds, %d mesh normals); "
          "x %.3f..%.3f y %.3f..%.3f z %.3f..%.3f; %s  field %.1fs nets %.1fs total %.1fs" % (
              TAG, "x".join(str(n) for n in stats["grid"]), stats["dense_triangles"], stats["half_triangles"],
              stats["triangles"], stats["vertices"], stats["folds"], stats["mesh_normals"],
              low[0], high[0], low[1], high[1], low[2], high[2],
              {key: round(value, 3) for key, value in horse.measures().items()}, stats["field_s"], stats["nets_s"],
              stats["total_s"]), flush=True)
    return horse


def write(path, horse, generator, schema_version):
    from fall_grove import glb
    writer = glb.GlbWriter(generator=generator)
    writer.add_mesh("horse", {
        "POSITION": (horse.positions, False),
        "NORMAL": (glb.quantize_unit(horse.normals, np.int8), True),
        "COLOR_0": (glb.quantize_unit(horse.colors, np.uint8), True),
        "_RIG": (glb.quantize_unit(horse.weights, np.uint8), True),
    }, indices=horse.triangles)
    low, high = horse.positions.min(axis=0), horse.positions.max(axis=0)
    writer.set_extras(dict(
        schemaVersion=schema_version, **horse.record(),
        color={"r": "part id / partScale", "g": "dark mask", "b": "light mask", "a": "1"},
        rig={"r": "follows the part's root joint", "g": "leg: below the knee or hock; neck: the head; tail: how far down",
             "b": "leg: below the fetlock; neck: how far up", "a": "neck: the ears"},
        boundsMin=[float(v) for v in low], boundsMax=[float(v) for v in high],
    ))
    return writer.write(path)


# -- previews (never shipped) -------------------------------------------------------------
COAT = np.array([0.16, 0.065, 0.025])       # bay
POINTS = np.array([0.018, 0.012, 0.01])     # black mane, tail and legs
MEALY = np.array([0.3, 0.2, 0.12])          # the pale muzzle and belly
PART_COLOURS = np.array([
    (0.5, 0.5, 0.5), (0.85, 0.22, 0.04), (0.08, 0.25, 0.9), (0.05, 0.7, 0.8),
    (0.15, 0.65, 0.12), (0.85, 0.72, 0.05), (0.7, 0.12, 0.7),
])


def _coat(colors):
    dark, light = colors[:, 1:2], colors[:, 2:3]
    return (COAT * (1.0 - light) + MEALY * light) * (1.0 - dark) + POINTS * dark


def _turned(points, heading_degrees, offset=(0.0, 0.0, 0.0)):
    """Rotate about y so the horse's +z turns `heading_degrees` toward +x, then move it."""
    angle = math.radians(heading_degrees)
    c, s = math.cos(angle), math.sin(angle)
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    return np.stack([x * c + z * s, y, -x * s + z * c], axis=1) + np.asarray(offset)


def previews(horse, directory):
    import bpy
    from mathutils import Vector
    from fall_grove import studio as studio_module
    from fall_grove.studio import to_blender
    directory.mkdir(parents=True, exist_ok=True)
    studio = studio_module.Studio()
    started = time.time()
    lights = []

    def horse_object(name, colours, heading=0.0, offset=(0.0, 0.0, 0.0), material=None):
        obj = studio.mesh_object(name, _turned(horse.positions, heading, offset), horse.triangles, colors=colours)
        normals = to_blender(_turned(horse.normals, heading))
        obj.data.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
        obj.data.materials.append(material or studio.material(name, roughness=0.72))
        return obj

    def flat(name, colour):
        material = studio.track(bpy.data.materials.new(studio_module.PREFIX + name))
        material.use_nodes = True
        nodes, links = material.node_tree.nodes, material.node_tree.links
        nodes.clear()
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = (*colour, 1.0)
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(emission.outputs["Emission"], output.inputs["Surface"])
        return material

    def quad(name, corners, material):
        obj = studio.mesh_object(name, np.asarray(corners, dtype=np.float64), np.array([[0, 1, 2], [0, 2, 3]]))
        obj.data.materials.append(material)
        return obj

    def sky(colour, strength):
        world = studio.scene.world
        world.use_nodes = True
        background = world.node_tree.nodes["Background"]
        background.inputs["Color"].default_value = (*colour, 1.0)
        background.inputs["Strength"].default_value = strength

    def sun(toward, strength, colour=(1.0, 0.82, 0.6)):
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        lights.clear()
        data = bpy.data.lights.new(studio_module.PREFIX + "horse_sun", "SUN")
        data.energy = strength
        data.color = colour
        data.angle = math.radians(2.0)
        light = bpy.data.objects.new(studio_module.PREFIX + "horse_sun", data)
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
        ground_material = studio.material("horse_ground", roughness=1.0)
        extent = 40.0
        ground = studio.mesh_object("horse_ground", np.array(
            [[-extent, 0.0, -extent], [extent, 0.0, -extent], [extent, 0.0, extent], [-extent, 0.0, extent]]),
            np.array([[0, 2, 1], [0, 3, 2]]), colors=np.tile([[0.32, 0.25, 0.12]], (4, 1)))
        ground.data.materials.append(ground_material)
        coat = horse_object("horse_coat", _coat(horse.colors))
        sky((0.55, 0.6, 0.68), 0.8)
        sun((0.55, 0.62, 0.55), 3.6)
        studio.render(directory / "horse-side.png", eye=(6.0, 1.0, 0.3), target=(0.0, 0.98, 0.3), lens=52.0,
                      size=(1400, 900), samples=32)
        studio.render(directory / "horse-three-quarter.png", eye=(4.3, 1.5, 4.5), target=(0.0, 0.95, 0.25),
                      lens=48.0, size=(1200, 1000), samples=32)
        # Against the light: the sun low behind the horse, a pale sky.
        sky((0.8, 0.8, 0.76), 1.0)
        sun((-0.92, 0.2, 0.2), 5.0, colour=(1.0, 0.72, 0.42))
        studio.render(directory / "horse-backlit.png", eye=(6.3, 0.85, -0.6), target=(0.0, 1.12, 0.3), lens=48.0,
                      size=(1400, 900), samples=32)
        remove([coat])

        parts = horse_object("horse_parts", PART_COLOURS[horse.parts])
        sky((0.6, 0.62, 0.66), 0.9)
        sun((0.5, 0.7, 0.6), 3.0, colour=(1.0, 1.0, 1.0))
        studio.render(directory / "horse-parts.png", eye=(4.4, 1.6, 4.4), target=(0.0, 0.9, 0.0), lens=46.0,
                      size=(1200, 1000), samples=24)
        studio.render(directory / "horse-parts-rear.png", eye=(-4.2, 1.4, -4.6), target=(0.0, 0.9, -0.1),
                      lens=46.0, size=(1200, 1000), samples=24)
        remove([parts])
        dark, light = horse.colors[:, 1:2], horse.colors[:, 2:3]
        masks = np.array([0.2, 0.2, 0.2]) * (1.0 - dark) * (1.0 - light) + np.array([0.9, 0.85, 0.75]) * light
        masked = horse_object("horse_masks", masks)
        studio.render(directory / "horse-masks.png", eye=(4.4, 0.9, 3.6), target=(0.0, 0.95, 0.25), lens=46.0,
                      size=(1200, 900), samples=24)
        studio.render(directory / "horse-head.png", eye=(1.5, 1.95, 2.6), target=(0.0, 1.6, 1.1), lens=50.0,
                      size=(900, 900), samples=24)
        remove([masked])
        # The skin's weights: red the root joints' (fading into the trunk), green below the knees and
        # hocks, the head and down the tail, blue below the fetlocks and up the neck, white the ears.
        w = horse.weights
        rigged = horse_object("horse_rig", np.clip(np.stack([w[:, 0] * 0.9 + w[:, 3], w[:, 1] * 0.9 + w[:, 3],
                                                             w[:, 2] * 0.9 + w[:, 3]], axis=1), 0.0, 1.0) * 0.8
                              + 0.04)
        studio.render(directory / "horse-rig.png", eye=(4.4, 1.6, 4.4), target=(0.0, 0.9, 0.0), lens=46.0,
                      size=(1200, 1000), samples=24)
        studio.render(directory / "horse-rig-rear.png", eye=(-4.2, 1.4, -4.6), target=(0.0, 0.9, -0.1),
                      lens=46.0, size=(1200, 1000), samples=24)
        remove([rigged])

        # The herd as the camera sees it: sixty metres off, the barley 0.95 m tall in front.
        remove([ground])
        black = flat("horse_black", (0.012, 0.01, 0.01))
        barley = flat("horse_barley", (0.6, 0.47, 0.22))
        herd = [horse_object("horse_herd_%d" % index, np.zeros((len(horse.positions), 3)), heading=heading,
                             offset=(0.0, 0.0, offset), material=black)
                for index, (heading, offset) in enumerate(((0.0, -5.4), (40.0, -1.8), (140.0, 1.8), (90.0, 5.4)))]
        band = quad("horse_barley_band", [[1.6, 0.0, -30.0], [1.6, 0.0, 30.0], [1.6, 0.95, 30.0], [1.6, 0.95, -30.0]],
                    barley)
        sky((0.8, 0.81, 0.8), 1.0)
        for name, size in (("horse-silhouette-barley.png", (1600, 520)), ("horse-silhouette-barley-small.png",
                                                                           (480, 156))):
            studio.render(directory / name, eye=(60.0, 1.7, 0.0), target=(0.0, 1.05, 0.0), lens=36.0 * 60.0 / 15.0,
                          size=size, samples=16)
        remove(herd + [band])
    finally:
        for light in lights:
            data = light.data
            bpy.data.objects.remove(light, do_unlink=True)
            bpy.data.lights.remove(data)
        studio.dispose()
    print("%s horse previews in %s  %.1fs" % (TAG, directory, time.time() - started), flush=True)
