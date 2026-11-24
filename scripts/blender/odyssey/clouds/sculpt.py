"""
The cloud shapes of Odyssey's sky (2026-11-24), each sculpted as a volume.

A cumulus is sculpted the way one grows: a few masses on one condensation level, each throwing billows off
its top and flanks, each of those smaller ones, so its outline is cauliflower at every scale and its base
is flat and ragged. A shape is authored in units of its own width (1), its base at y = 0.06, and comes back
as a true distance field on the atlas's grid, whatever its proportions (`box`).

  puff    a fair-weather heap, small, low
  heap    a grown one, two or three heads
  tower   a congestus: heads stacked on a broad foot, leaning down the wind
  bank    a long ridge of heads, a wall of cloud on the horizon
  torn    a fractus: rags pulled off a heap
  shelf   a broad low layer with heads along it, for the level below the eye
  lens    a lenticular stack, smooth as water
"""

import math

import numpy as np

from field import Billow, Lattice, fbm, fib_sphere, grid, redistance, rng_of, smax, union, unit

REACH = 0.10          # the distance the field keeps, in widths
VOXEL = 1 / 150.0     # sculpted at this, then resampled to the atlas


def billows(parents, rng, n, size, out=0.86, up=0.30, low=-0.25, spread=0.30):
    """Each ball throws smaller ones off its upper side."""
    kids = []
    for c, r in parents:
        for d in fib_sphere(n, rng):
            d = unit(d + np.array([0, up, 0]))
            if d[1] < low:
                continue
            rr = r * size * (1 - spread + 2 * spread * rng.uniform())
            kids.append((np.asarray(c) + d * (r * out), rr))
    return kids


class Shape:
    def __init__(self, name, kind, box, seed):
        self.name, self.kind, self.box, self.seed = name, kind, box, seed
        self.rng = rng_of(seed)
        self.balls = []
        self.base = 0.06
        self.k = 0.016
        self.shear = 0.0
        self.ragged = 0.020
        self.rough = (0.030, 0.012)
        self.floor = True

    def grow(self, masses, kids=((13, 0.50), (9, 0.46)), up=0.30):
        """`masses` (x, y, z, r) on the base; `kids` (how many, how big) for each generation."""
        level = [(np.array(m[:3], float), float(m[3])) for m in masses]
        self.balls += level
        for n, size in kids:
            level = billows(level, self.rng, n, size, up=up)
            self.balls += level
        return self

    def rags(self, count, size=(0.010, 0.026)):
        """Loose scraps just off the outline, as a growing cloud always has."""
        for _ in range(count):
            c, r = self.balls[self.rng.randint(len(self.balls))]
            d = unit(self.rng.normal(size=3) * np.array([1, 0.6, 1]))
            q = size[0] + (size[1] - size[0]) * self.rng.uniform()
            p = c + d * (r + q * (0.6 + 1.6 * self.rng.uniform()))
            if p[1] < self.base + 0.01:
                continue
            for _k in range(3):
                self.balls.append((p + self.rng.normal(size=3) * q * 0.8, q * (0.6 + 0.5 * self.rng.uniform())))
        return self

    def fit(self, margin=0.055):
        """Into its box, filling it, its base where it belongs: nothing is ever cut."""
        c = np.array([b[0] for b in self.balls])
        r = np.array([b[1] for b in self.balls]) + 0.012
        shift = self.shear * np.maximum(c[:, 1] - self.base, 0) ** 1.25
        lo = [(c[:, 0] + shift - r).min(), (c[:, 2] - r).min()]
        hi = [(c[:, 0] + shift + r).max(), (c[:, 2] + r).max()]
        top = (c[:, 1] + r).max() - self.base
        k = min((self.box[0] - 2 * margin) / (hi[0] - lo[0]), (self.box[2] - 2 * margin) / (hi[1] - lo[1]),
                (self.box[1] - margin - self.base) / top)
        mx, mz = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
        self.balls = [(np.array([(b[0][0] - mx) * k, self.base + (b[0][1] - self.base) * k, (b[0][2] - mz) * k]), b[1] * k) for b in self.balls]
        self.shear *= k ** -0.25
        return self

    def field(self):
        X, Y, Z, n = grid(self.box, VOXEL)
        warp = Lattice(self.seed + 5)
        fine = Lattice(self.seed + 9)
        # The whole leans down the wind with height, and nothing in it is quite straight.
        wx = X - self.shear * np.maximum(Y - self.base, 0) ** 1.25 + 0.030 * warp(X * 4.2, Y * 4.2, Z * 4.2) + 0.012 * fine(X * 10, Y * 10, Z * 10)
        wy = Y + 0.020 * warp(X * 4.6 + 9, Y * 4.6, Z * 4.6) + 0.008 * fine(X * 11 + 3, Y * 11, Z * 11)
        wz = Z + 0.030 * warp(X * 4.2, Y * 4.2 + 17, Z * 4.2) + 0.012 * fine(X * 10, Y * 10 + 5, Z * 10)
        # (A warped place is off the grid, so the union is taken at the warped places, ball by ball.)
        d = self.melt(wx, wy, wz)
        a, b = self.rough
        big, small = Billow(self.seed + 21), Billow(self.seed + 22)
        d = d - a * (big(wx * 9.5, wy * 9.5, wz * 9.5) - 0.42) - b * (small(wx * 21, wy * 21, wz * 21) - 0.42)
        if self.floor:
            # The condensation level: flat, a little ragged, its rim torn upward.
            under = self.base + self.ragged * (fbm(fine, X * 6.5, np.zeros_like(X), Z * 6.5, 3) * 1.3 + 0.15)
            d = smax(d, under - Y, 0.022)
        return d, n

    def melt(self, x, y, z):
        acc = np.zeros(x.shape, np.float64)
        k = self.k
        vx = VOXEL
        ox, oy, oz = -self.box[0] / 2 + vx / 2, vx / 2, -self.box[2] / 2 + vx / 2
        pad = 0.075 + k * 8 + abs(self.shear) * 0.35
        for c, r in self.balls:
            lo = [int(max(0, math.floor((c[i] - r - pad - o) / vx))) for i, o in enumerate((ox, oy, oz))]
            hi = [int(min(x.shape[i], math.ceil((c[i] + r + pad - o) / vx) + 1)) for i, o in enumerate((ox, oy, oz))]
            if any(h <= l for l, h in zip(lo, hi)):
                continue
            s = np.s_[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
            d = np.sqrt((x[s] - c[0]) ** 2 + (y[s] - c[1]) ** 2 + (z[s] - c[2]) ** 2) - r
            acc[s] += np.exp(-np.minimum(d, 0.5) / k)
        return np.where(acc > 1e-14, -k * np.log(np.maximum(acc, 1e-14)), 0.5).astype(np.float32)

    def sdf(self):
        f, _n = self.field()
        return redistance(f, VOXEL, REACH)


# ── the kinds ──

def ring_masses(rng, count, spread, r, y, zk=0.75, rough=0.5):
    out = []
    a0 = rng.uniform(0, 2 * math.pi)
    for i in range(count):
        q = spread * math.sqrt((i + 0.3) / count) * (0.85 + 0.3 * rng.uniform())
        rr = r * (1 - rough / 2 + rough * rng.uniform())
        out.append((math.cos(a0 + i * 2.4) * q, y + rr * 0.30, math.sin(a0 + i * 2.4) * q * zk, rr))
    return out


def puff(name, seed, heads=6, box=(1.0, 0.50, 0.78), tall=0.10):
    s = Shape(name, 'puff', box, seed)
    m = ring_masses(s.rng, heads, 0.30, 0.125, 0.07, rough=0.8)
    for _ in range(2):
        m.append((0.16 * s.rng.normal(), 0.17 + tall * s.rng.uniform(), 0.06 * s.rng.normal(), 0.085 + 0.04 * s.rng.uniform()))
    s.k = 0.012
    s.shear = 0.12
    s.grow(m, kids=((13, 0.50), (9, 0.46))).rags(16)
    return s.fit()


def heap(name, seed, heads=9, crown=3, box=(1.0, 0.60, 0.80), rise=0.16):
    s = Shape(name, 'heap', box, seed)
    rng = s.rng
    m = ring_masses(rng, heads, 0.34, 0.120, 0.08, rough=0.7)
    for i in range(crown):
        x = -0.20 + 0.40 * (i + rng.uniform()) / max(1, crown)
        y = 0.22 + rise * rng.uniform()
        m.append((x, y, 0.07 * rng.normal(), 0.10 + 0.04 * rng.uniform()))
        m.append((x + 0.04 * rng.normal(), y * 0.62, 0.07 * rng.normal(), 0.11))
    s.k = 0.012
    s.shear = 0.18
    s.grow(m, kids=((13, 0.50), (9, 0.46)), up=0.36).rags(20)
    return s.fit()


def tower(name, seed, peaks=((0.0, 0.92), (-0.22, 0.60)), box=(1.0, 1.02, 0.80)):
    """A mountain of heads: broad at the foot, each storey narrower and bolder, its crown the crispest."""
    s = Shape(name, 'tower', box, seed)
    rng = s.rng
    m = ring_masses(rng, 10, 0.36, 0.130, 0.08, rough=0.6)
    for px, h in peaks:
        storeys = int(2 + h * 6)
        for k in range(storeys):
            u = (k + 0.5) / storeys
            wide = 0.20 * (1 - u) ** 0.8 + 0.028
            for _q in range(3 if u < 0.55 else 2):
                m.append((px + wide * rng.normal() * 0.62, 0.12 + u * (h - 0.14) + 0.02 * rng.normal(), wide * rng.normal() * 0.5,
                          (0.125 - 0.040 * u) * (0.82 + 0.36 * rng.uniform())))
    s.k = 0.011
    s.shear = 0.13
    s.grow(m, kids=((11, 0.50), (8, 0.46)), up=0.26).rags(24)
    return s.fit()


def bank(name, seed, heads=14, tall=0.24, box=(1.0, 0.36, 0.32)):
    """A wall of cloud: a long foot, and heads of every height standing on it."""
    s = Shape(name, 'bank', box, seed)
    rng = s.rng
    m = []
    for i in range(heads):
        u = (i + 0.5) / heads
        env = math.sin(math.pi * (0.04 + 0.92 * u)) ** 0.6
        x = -0.46 + 0.92 * u + 0.02 * rng.normal()
        r = (0.036 + 0.036 * rng.uniform()) * (0.65 + 0.5 * env)
        m.append((x, 0.055 + r * 0.4, 0.045 * rng.normal(), r))
        m.append((x + 0.03, 0.055 + r * 0.3, 0.06 * rng.normal(), r * 0.8))
        bold = rng.uniform()
        if bold > 0.45:
            hh = tall * env * (0.35 + 0.65 * bold * rng.uniform())
            n = 2 + int(hh * 14)
            for q in range(n):
                u2 = (q + 0.7) / n
                m.append((x + 0.02 * rng.normal(), 0.07 + hh * u2, 0.03 * rng.normal(), 0.050 * (1.0 - 0.34 * u2) * (0.8 + 0.4 * rng.uniform())))
    s.k = 0.009
    s.rough = (0.018, 0.009)
    s.shear = 0.12
    s.ragged = 0.010
    s.base = 0.045
    s.grow(m, kids=((10, 0.50), (7, 0.46)), up=0.34).rags(30, (0.006, 0.014))
    return s.fit(0.035)


def shelf(name, seed, heads=46, box=(1.0, 0.24, 1.0), bold=0.40):
    """A piece of a floor of cloud: pillows run together, their crowns broken small, its rim thinning out."""
    s = Shape(name, 'shelf', box, seed)
    rng = s.rng
    m = []
    for i in range(heads):
        a = i * 2.39996 + rng.normal() * 0.35
        q = 0.43 * math.sqrt((i + 0.4) / heads) * (0.86 + 0.28 * rng.uniform())
        inner = 1 - (q / 0.46) ** 2
        r = (0.030 + 0.052 * rng.uniform() ** 1.5) * (0.62 + 0.5 * inner)
        m.append((math.cos(a) * q, 0.05 + r * 0.12, math.sin(a) * q, r))
        if rng.uniform() < bold * (0.4 + 0.8 * inner):
            m.append((math.cos(a) * q + 0.02 * rng.normal(), 0.06 + r * 0.9, math.sin(a) * q + 0.02 * rng.normal(), r * 0.74))
    s.k = 0.008
    s.rough = (0.020, 0.011)
    s.base = 0.045
    s.ragged = 0.012
    s.grow(m, kids=((11, 0.50), (8, 0.46)), up=0.40).rags(44, (0.005, 0.013))
    return s.fit(0.045)


def torn(name, seed, rags=9, box=(1.0, 0.34, 0.56)):
    s = Shape(name, 'torn', box, seed)
    rng = s.rng
    m = []
    for i in range(rags):
        x = -0.38 + 0.76 * (i + rng.uniform()) / rags
        m.append((x, 0.12 + 0.09 * rng.uniform(), 0.10 * rng.normal(), 0.030 + 0.045 * rng.uniform()))
    s.k = 0.016
    s.rough = (0.044, 0.020)
    s.floor = False
    s.shear = 0.5
    s.grow(m, kids=((9, 0.62), (7, 0.52)), up=0.12).rags(26, (0.006, 0.020))
    return s.fit(0.07)


class Lens(Shape):
    """Plates of a standing wave: smooth, thin-rimmed, stacked."""

    def field(self):
        X, Y, Z, n = grid(self.box, VOXEL)
        warp = Lattice(self.seed + 5)
        d = np.full(X.shape, 0.5, np.float32)
        for cx, cy, cz, rx, ry in self.plates:
            wy = Y - cy - 0.024 * (X - cx) ** 2 / (rx * rx) + 0.006 * warp(X * 3, Y * 3, Z * 3)
            q = np.sqrt(((X - cx) / rx) ** 2 + ((Z - cz) / (rx * 0.62)) ** 2) * (1 + 0.04 * warp(X * 5, 0 * Y, Z * 5))
            half = ry * np.maximum(0, 1 - q * q) ** 1.15
            d = np.minimum(d, np.where(q < 1, np.abs(wy) - half, np.maximum((q - 1) * rx * 0.6, np.abs(wy) * 0.6)))
        return d.astype(np.float32), n


def lens(name, seed):
    s = Lens(name, 'lens', (1.0, 0.36, 0.70), seed)
    s.plates = [(0.0, 0.11, 0.0, 0.44, 0.062), (0.05, 0.20, 0.0, 0.32, 0.046), (0.09, 0.268, 0.0, 0.20, 0.030)]
    return s


def build_all(only=None):
    makers = [
        ('puff-a', lambda: puff('puff-a', 11)),
        ('puff-b', lambda: puff('puff-b', 12, heads=5, tall=0.16)),
        ('puff-c', lambda: puff('puff-c', 13, heads=8, box=(1.0, 0.38, 0.66), tall=0.05)),
        ('heap-a', lambda: heap('heap-a', 21)),
        ('heap-b', lambda: heap('heap-b', 22, heads=8, crown=4, rise=0.22)),
        ('heap-c', lambda: heap('heap-c', 23, heads=7, crown=2, box=(1.0, 0.66, 0.84), rise=0.30)),
        ('heap-d', lambda: heap('heap-d', 24, heads=11, crown=3, box=(1.0, 0.48, 0.70), rise=0.12)),
        ('tower-a', lambda: tower('tower-a', 31)),
        ('tower-b', lambda: tower('tower-b', 32, peaks=((0.14, 0.94), (-0.18, 0.74), (0.34, 0.44)))),
        ('tower-c', lambda: tower('tower-c', 33, peaks=((-0.08, 0.78), (0.24, 0.50)), box=(1.0, 0.84, 0.80))),
        ('bank-a', lambda: bank('bank-a', 41)),
        ('bank-b', lambda: bank('bank-b', 42, heads=17, tall=0.16, box=(1.0, 0.27, 0.30))),
        ('bank-c', lambda: bank('bank-c', 43, heads=11, tall=0.34, box=(1.0, 0.46, 0.36))),
        ('shelf-a', lambda: shelf('shelf-a', 51)),
        ('shelf-b', lambda: shelf('shelf-b', 52, heads=34, bold=0.62)),
        ('shelf-c', lambda: shelf('shelf-c', 53, heads=58, bold=0.25)),
        ('torn-a', lambda: torn('torn-a', 61)),
        ('lens-a', lambda: lens('lens-a', 71)),
    ]
    return [(n, m()) for n, m in makers if only is None or n in only]
