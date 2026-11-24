"""
The sprays: what a tree's foliage is made of (Odyssey's forest, 2026-11-24).

A spray is a twig with its leaves, modelled leaf by leaf in a unit disc: +Y the way the twig grows,
+Z toward the viewer, X across. Every leaf is a real shape (a lobed oak leaf, a five-fingered maple, a
birch's little rhomb, a blossom of five petals, needles in brushes or combs) with its own tilt and tone.

The sprays are used twice, so the game's two kinds of tree agree:
  - photographed one by one into the leaf atlas the near trees' cards draw;
  - instanced on the grown wood for the far trees' views and for the Blender previews.

Every function returns a `Spray`: vertices, triangles, and per vertex a tone (0 dark .. 1 light) and a
kind (0 leaf, 1 wood, 2 petal).
"""

import math

import numpy as np

from growth import rng_of, unit


class Spray:
    def __init__(self):
        self.v = []
        self.t = []
        self.tone = []
        self.kind = []

    def add(self, verts, tris, tone, kind):
        base = len(self.v)
        self.v.extend([list(map(float, p)) for p in verts])
        self.t.extend([(a + base, b + base, c + base) for a, b, c in tris])
        if np.isscalar(tone):
            tone = [tone] * len(verts)
        self.tone.extend([float(x) for x in tone])
        self.kind.extend([kind] * len(verts))

    def arrays(self):
        return (np.array(self.v), np.array(self.t, dtype=int), np.array(self.tone), np.array(self.kind))


# ── leaf outlines ── (x across, y from the stalk 0 to the tip 1), half outlines mirrored

OUTLINES = {
    # an oak's rounded lobes
    'oak': [(0.0, 0.0), (0.10, 0.10), (0.20, 0.20), (0.15, 0.30), (0.30, 0.42), (0.22, 0.52), (0.33, 0.66),
            (0.22, 0.76), (0.24, 0.88), (0.10, 0.97), (0.0, 1.0)],
    # a beech, a hazel, a hawthorn at this size
    'ovate': [(0.0, 0.0), (0.20, 0.16), (0.32, 0.36), (0.33, 0.54), (0.25, 0.74), (0.11, 0.91), (0.0, 1.0)],
    # a birch's pointed rhomb
    'birch': [(0.0, 0.0), (0.20, 0.10), (0.38, 0.28), (0.30, 0.48), (0.18, 0.70), (0.07, 0.88), (0.0, 1.0)],
    # a willow's long blade
    'willow': [(0.0, 0.0), (0.08, 0.15), (0.12, 0.40), (0.10, 0.68), (0.04, 0.90), (0.0, 1.0)],
    # a maple's fingers
    'maple': [(0.0, 0.0), (0.10, 0.10), (0.34, 0.10), (0.27, 0.26), (0.50, 0.40), (0.31, 0.47), (0.36, 0.62),
              (0.19, 0.64), (0.13, 0.82), (0.0, 1.0)],
    # an aspen's round leaf
    'aspen': [(0.0, 0.0), (0.22, 0.10), (0.40, 0.30), (0.42, 0.52), (0.30, 0.76), (0.12, 0.92), (0.0, 1.0)],
    'petal': [(0.0, 0.0), (0.22, 0.30), (0.40, 0.62), (0.34, 0.88), (0.12, 0.98), (0.0, 0.90)],
}


def leaf(sp, base, along, face, length, width, outline, tone, rng, kind=0, curl=0.22, fold=0.18):
    """One leaf: from `base`, its blade along `along`, its upper face toward `face`."""
    along = unit(along)
    side = np.cross(along, face)
    if np.linalg.norm(side) < 1e-4:
        side = np.cross(along, [0.3, 0.2, 1.0])
    side = unit(side)
    up = unit(np.cross(side, along))
    half = OUTLINES[outline]
    verts = []
    tones = []
    n = len(half)
    for _, y in half:
        verts.append(base + along * (y * length) + up * (-curl * y * y * length))
        tones.append(tone)
    for s in (-1, 1):
        for x, y in half:
            bend = -curl * y * y + fold * x * 1.3
            verts.append(base + along * (y * length) + side * (s * x * width) + up * (bend * length))
            tones.append(tone * (0.96 + 0.08 * (s > 0)))
    tris = []
    for si in range(2):
        o = n * (1 + si)
        for k in range(n - 1):
            q = (k, k + 1, o + k + 1, o + k)
            if si:
                tris += [(q[0], q[2], q[1]), (q[0], q[3], q[2])]
            else:
                tris += [(q[0], q[1], q[2]), (q[0], q[2], q[3])]
    sp.add(verts, tris, tones, kind)


def twig(sp, a, b, r0, r1, tone=0.45, kind=1):
    """A twig as a thin three-sided prism."""
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    d = unit(b - a)
    ref = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
    u = unit(np.cross(d, ref))
    w = np.cross(d, u)
    verts = []
    for p, r in ((a, r0), (b, r1)):
        for k in range(3):
            t = 2 * math.pi * k / 3
            verts.append(p + (u * math.cos(t) + w * math.sin(t)) * r)
    tris = []
    for k in range(3):
        k2 = (k + 1) % 3
        tris += [(k, k2, 3 + k2), (k, 3 + k2, 3 + k)]
    sp.add(verts, tris, tone, kind)


def needle(sp, base, along, length, width, tone, kind=0):
    """One needle: a thin blade turned to the viewer."""
    along = unit(along)
    ref = np.array([0, 0, 1.0]) if abs(along[2]) < 0.8 else np.array([1.0, 0, 0])
    u = unit(np.cross(along, ref))
    tip = base + along * length
    mid = base + along * (length * 0.45)
    sp.add([base - u * width * 0.5, base + u * width * 0.5, mid + u * width * 0.6, mid - u * width * 0.6, tip],
           [(0, 1, 2), (0, 2, 3), (3, 2, 4)], [tone * 0.88, tone * 0.88, tone, tone, min(1, tone * 1.1)], kind)


def leafy_spray(seed, outline, leaf_len=0.25, leaf_w=0.25, twigs=9, per=10, spread=1.0, droop=0.0, face_up=0.55,
                tone=(0.45, 1.0), flower=0.0, depth=0.42, round_=0.80, curl=0.2, fill=0.5):
    """
    A broadleaf's spray: a short stem low in the disc breaking at once into side twigs fanned all round
    it, leaves alternately along each, their faces toward the light and the viewer; `fill` scatters
    more leaves through the middle, deeper in, so the body is closed and only the rim is open. `droop`
    bends the twigs' ends down.
    """
    rng = rng_of(seed)
    sp = Spray()
    root = np.array([rng.normal() * 0.04, -0.46, -0.34])
    top = np.array([rng.normal() * 0.08, 0.18, -0.08])
    twig(sp, root, top, 0.020, 0.011)
    stems = [(root * 0.3 + top * 0.7, np.array([rng.normal() * 0.12, round_, 0.0]))]
    off = rng.uniform()
    for k in range(twigs):
        a = (-2.75 + 5.5 * ((k * 0.618 + off) % 1.0)) * spread
        t = 0.15 + 0.75 * rng.uniform()
        base = root * (1 - t) + top * t
        reach = round_ * (0.80 + 0.24 * rng.uniform()) * (1 - 0.16 * max(0.0, abs(a) - 1.6))
        tip = np.array([math.sin(a) * reach,
                        -0.03 + math.cos(a) * reach * (0.95 if abs(a) < 1.5 else 0.84) - droop * 0.30 * abs(math.sin(a)),
                        (rng.uniform() - 0.42) * depth * 1.3])
        over = math.hypot(tip[0], tip[1])
        if over > round_:
            tip[:2] *= round_ / over
        mid = (base + tip) / 2 + np.array([0, 0.05, 0.10])
        twig(sp, base, mid, 0.013, 0.009)
        twig(sp, mid, tip, 0.009, 0.005)
        stems.append((mid * 0.5 + base * 0.5, tip))
        if rng.uniform() < 0.8:
            a2 = a + (0.55 if rng.uniform() < 0.5 else -0.55) * (0.6 + 0.6 * rng.uniform())
            r2 = reach * (0.75 + 0.3 * rng.uniform())
            t2 = np.array([math.sin(a2) * r2, -0.06 + math.cos(a2) * r2 * 0.85, (rng.uniform() - 0.5) * depth])
            ov = math.hypot(t2[0], t2[1])
            if ov > round_:
                t2[:2] *= round_ / ov
            twig(sp, mid, t2, 0.008, 0.004)
            stems.append((mid, t2))

    def one(p, along, deep=0.0):
        face = unit(np.array([p[0] * 0.45 + rng.normal() * 0.38, p[1] * 0.35 + face_up * 0.5 + rng.normal() * 0.30,
                              1.0 + rng.normal() * 0.30]))
        size = 0.74 + 0.42 * rng.uniform()
        end = p + along * leaf_len * size
        ov = math.hypot(end[0], end[1])
        if ov > 0.985:
            size *= max(0.35, 1 - (ov - 0.985) / (leaf_len * size))
        tn = (tone[0] + (tone[1] - tone[0]) * rng.uniform()) * (1 - 0.25 * deep)
        leaf(sp, p, along, face, leaf_len * size, leaf_w * size, outline, tn, rng, curl=curl)
        if flower and rng.uniform() < flower:
            blossom(sp, p + np.array([0, 0, 0.10]), unit(face + np.array([0, 0, 0.6])), leaf_len * 0.66, rng)

    for base, tip in stems:
        d = tip - base
        L = np.linalg.norm(d)
        n = max(3, int(round(per * L / 0.7)))
        for i in range(n + 1):
            t = 0.10 + 0.90 * (i / n)
            p = base + d * t + np.array([0, 0, (rng.uniform() - 0.3) * depth * 0.45])
            side = -1 if i % 2 else 1
            out = unit(np.cross(d, [0, 0, 1.0])) * side
            along = unit(unit(d) * (0.55 + 0.5 * (i == n)) + out * (0.75 if i < n else 0.0)
                         + np.array([0, -0.55 * droop, 0]) + rng.normal(size=3) * 0.28)
            one(p, along)
    for _ in range(int(fill * twigs * per * 0.6)):
        a = rng.uniform(0, 2 * math.pi)
        rr = 0.62 * math.sqrt(rng.uniform())
        p = np.array([math.cos(a) * rr, math.sin(a) * rr - 0.04, -0.12 - 0.30 * rng.uniform()])
        along = unit(np.array([math.cos(a) * 0.7 + rng.normal() * 0.6,
                               math.sin(a) * 0.7 - 0.4 * droop + rng.normal() * 0.6, 0.15]))
        one(p, along, 1.0)
    return sp


def blossom(sp, centre, face, size, rng, petals=5, tone=(0.82, 1.0)):
    """Five petals round a small dark eye."""
    face = unit(face)
    ref = unit(np.cross(face, [0.3, 1.0, 0.1]))
    oth = np.cross(face, ref)
    phase = rng.uniform(0, 2 * math.pi)
    for k in range(petals):
        a = phase + 2 * math.pi * k / petals
        d = unit(ref * math.cos(a) + oth * math.sin(a) + face * 0.35)
        leaf(sp, centre + d * size * 0.06, d, face, size * 0.55, size * 0.62, 'petal',
             tone[0] + (tone[1] - tone[0]) * rng.uniform(), rng, kind=2, curl=0.10, fold=0.05)
    twig(sp, centre - face * 0.01, centre + face * size * 0.16, size * 0.07, size * 0.03, tone=0.35, kind=1)


def blossom_spray(seed, count=150, size=0.20, leaves=7, depth=0.46):
    """A cherry's spray in flower: bunches of blossom crowding bare twigs, a few bronze young leaves."""
    rng = rng_of(seed)
    sp = Spray()
    stems = []
    root = np.array([0.0, -0.48, -0.30])
    top = np.array([rng.normal() * 0.08, 0.2, 0.0])
    twig(sp, root, top, 0.022, 0.011, tone=0.28)
    off = rng.uniform()
    for k in range(11):
        a = -2.75 + 5.5 * ((k * 0.618 + off) % 1.0)
        t = 0.15 + 0.7 * rng.uniform()
        base = root * (1 - t) + top * t
        reach = 0.78 * (0.8 + 0.25 * rng.uniform())
        tip = np.array([math.sin(a) * reach, -0.04 + math.cos(a) * reach * 0.88, (rng.uniform() - 0.42) * depth])
        twig(sp, base, tip, 0.013, 0.006, tone=0.28)
        stems.append((base, tip))
    stems.append((root * 0.5 + top * 0.5, top + np.array([0, 0.45, 0.02])))
    # Cherries flower in bunches: bunch centres along the twigs, blossoms crowded round each.
    bunches = []
    for base, tip in stems:
        for q in range(3):
            t = 0.30 + 0.70 * (q + rng.uniform()) / 3
            bunches.append(base + (tip - base) * t)
    for i in range(count):
        c = bunches[i % len(bunches)]
        p = c + rng.normal(size=3) * np.array([0.085, 0.085, depth * 0.20])
        ov = math.hypot(p[0], p[1])
        if ov > 0.87:
            p[:2] *= 0.87 / ov
        face = unit(np.array([p[0] * 0.6 + rng.normal() * 0.35, p[1] * 0.45 + 0.25 + rng.normal() * 0.3, 1.0]))
        blossom(sp, p, face, size * (0.8 + 0.4 * rng.uniform()), rng, tone=(0.62, 1.0))
    for _ in range(leaves):
        base, tip = stems[rng.randint(len(stems))]
        p = base + (tip - base) * (0.4 + 0.6 * rng.uniform())
        d = unit(np.array([rng.normal(), 0.7, 0.3 + rng.normal() * 0.3]))
        leaf(sp, p, d, np.array([0.1, 0.4, 1.0]), 0.18, 0.15, 'ovate', 0.42 + 0.2 * rng.uniform(), rng)
    return sp


def spruce_bough(seed, pairs=19, hang=0.85, tip_up=0.10, needle_len=0.105, per=30, half=0.80):
    """
    A spruce's bough along +Y (foot at y = -1, tip at y = 1): side shoots in a feather that shortens
    to the tip, each hung with drooping shoots.
    """
    rng = rng_of(seed)
    sp = Spray()
    spine = []
    for i in range(12):
        t = i / 11
        spine.append(np.array([0.03 * math.sin(3 * t + seed), -0.98 + 1.94 * t, tip_up * t * t]))
    for i in range(11):
        twig(sp, spine[i], spine[i + 1], 0.030 * (1 - 0.75 * i / 11), 0.030 * (1 - 0.75 * (i + 1) / 11), tone=0.35)

    def shoot(a, b, dens):
        d = b - a
        L = np.linalg.norm(d)
        twig(sp, a, b, 0.010, 0.005, tone=0.35)
        n = max(5, int(per * L * dens))
        lift = 0.55 + 0.45 * rng.uniform()
        for k in range(n):
            t = (k + rng.uniform()) / n
            p = a + d * t
            for s in (-1, 1):
                out = unit(np.cross(unit(d), [0, 0, 1.0])) * s
                nd = unit(unit(d) * 0.75 + out * (0.85 + 0.2 * rng.normal()) + np.array([0, 0, 0.35 + 0.5 * rng.normal()]))
                needle(sp, p, nd, needle_len * (0.75 + 0.4 * rng.uniform()), 0.024,
                       (0.40 + 0.40 * rng.uniform()) * lift + 0.22 * t)

    for i in range(pairs):
        t = (i + 0.4) / pairs
        base = np.array([0, -0.98 + 1.94 * t, tip_up * t * t])
        wide = half * (1 - 0.86 * t ** 1.35) * (0.50 + 0.50 * min(1, t / 0.14))
        for s in (-1, 1):
            w = wide * (0.8 + 0.35 * rng.uniform())
            ang = 0.80 + 0.22 * rng.normal()
            tip = base + np.array([s * w * math.sin(ang), w * math.cos(ang) * 0.75,
                                   -hang * w * (0.4 + 0.5 * rng.uniform())])
            if abs(tip[1]) > 0.98:
                tip[1] = math.copysign(0.98, tip[1])
            shoot(base, tip, 1.0)
            for f in (0.45, 0.8):
                if rng.uniform() < 0.75:
                    b2 = base + (tip - base) * f
                    t2 = b2 + np.array([s * 0.06, 0.10 * rng.normal(), -hang * w * (0.45 + 0.4 * rng.uniform())])
                    shoot(b2, t2, 0.9)
    shoot(spine[-4], np.array([0, 0.97, tip_up]), 1.3)
    return sp


def fir_bough(seed):
    """A fir's flat plate: wider, no curtain, the needles combed to the sides."""
    return spruce_bough(seed, pairs=17, hang=0.10, tip_up=0.16, needle_len=0.115, per=32, half=0.88)


def pine_tuft(seed, shoots=26, per=30, nlen=0.32, depth=0.7):
    """A pine's spray: a head of upswept shoots, each a brush of long needles, packed into a cushion."""
    rng = rng_of(seed)
    sp = Spray()
    root = np.array([0, -0.26, -0.40])
    off = rng.uniform()
    for k in range(shoots):
        a = -2.5 + 5.0 * ((k * 0.618 + off) % 1.0)
        reach = 0.16 + 0.52 * math.sqrt(rng.uniform())
        base = root * 0.75 + np.array([math.sin(a) * 0.10, 0.05 + 0.10 * rng.uniform(), 0.02])
        tip = np.array([math.sin(a) * reach, -0.10 + math.cos(a) * reach * 0.78, (rng.uniform() - 0.30) * depth])
        twig(sp, base, tip, 0.016, 0.009, tone=0.4)
        d = unit(tip - base + np.array([0, 0.30, 0.05]))
        lift = 0.7 + 0.3 * rng.uniform()
        for _ in range(per):
            t = 0.45 + 0.60 * rng.uniform()
            p = base + (tip - base) * t
            nd = unit(d * 0.80 + rng.normal(size=3) * np.array([0.66, 0.50, 0.62]) + np.array([0, 0.22, 0.12]))
            L = nlen * (0.7 + 0.45 * rng.uniform())
            e = p + nd * L
            ov = math.hypot(e[0], e[1])
            if ov > 0.97:
                L *= max(0.25, 1 - (ov - 0.97) / L)
            needle(sp, p, nd, L, 0.028, (0.42 + 0.56 * rng.uniform()) * lift)
    return sp


def larch_spray(seed, stems=11):
    """A larch's soft spray: thin arching twigs set with rosettes of short needles."""
    rng = rng_of(seed)
    sp = Spray()
    root = np.array([0, -0.95, 0])
    for k in range(stems):
        s = (k / (stems - 1) - 0.5) * 2
        tip = np.array([s * 0.86, 0.85 - 0.95 * s * s - 0.45 * rng.uniform(), (rng.uniform() - 0.5) * 0.5])
        pts = [root * (1 - t) + tip * t + np.array([0, 0.28 * math.sin(math.pi * t), 0]) for t in np.linspace(0, 1, 7)]
        for a, b in zip(pts[:-1], pts[1:]):
            twig(sp, a, b, 0.014, 0.010, tone=0.5)
            for _ in range(4):
                p = a + (b - a) * rng.uniform()
                d0 = unit(rng.normal(size=3) + np.array([0, 0.1, 0.4]))
                lift = 0.65 + 0.35 * rng.uniform()
                for _n in range(11):
                    nd = unit(d0 * 0.7 + rng.normal(size=3) * 0.75)
                    needle(sp, p, nd, 0.115 * (0.7 + 0.5 * rng.uniform()), 0.022, (0.5 + 0.48 * rng.uniform()) * lift)
    return sp


def cypress_spray(seed, stems=20):
    """A cypress's flame: scale leaves on upswept, packed shoots that close to a point."""
    rng = rng_of(seed)
    sp = Spray()
    for k in range(stems):
        x = (k + 0.5) / stems * 2 - 1
        top = 0.30 + 0.66 * (1 - abs(x)) ** 0.7 * (0.8 + 0.2 * rng.uniform())
        base = np.array([x * 0.34, -0.95 + 0.30 * abs(x), (rng.uniform() - 0.5) * 0.3])
        tip = np.array([x * 0.44, top, (rng.uniform() - 0.4) * 0.4])
        bulge = x * 0.16
        pts = [base * (1 - t) + tip * t
               + np.array([bulge * math.sin(math.pi * min(1, t * 1.25)), 0, 0.2 * math.sin(math.pi * t)])
               for t in np.linspace(0, 1, 9)]
        lift = 0.6 + 0.4 * rng.uniform()
        for a, b in zip(pts[:-1], pts[1:]):
            for _ in range(9):
                p = a + (b - a) * rng.uniform()
                s = -1 if rng.uniform() < 0.5 else 1
                nd = unit(unit(b - a) * 1.2 + np.array([s * 0.5, 0.2, rng.normal() * 0.5]))
                needle(sp, p, nd, 0.14 * (0.7 + 0.5 * rng.uniform()), 0.05, (0.40 + 0.58 * rng.uniform()) * lift)
    return sp


def willow_curtain(seed, strands=19):
    """A willow's curtain: long whips hanging along -Y from the top edge, thin leaves down each."""
    rng = rng_of(seed)
    sp = Spray()
    for k in range(strands):
        x0 = ((k + 0.5) / strands * 2 - 1) * 0.42 + rng.normal() * 0.04
        z0 = (rng.uniform() - 0.5) * 0.40
        L = 1.15 + 0.78 * rng.uniform()
        drift = rng.normal() * 0.10
        top = 0.95 - 0.25 * abs(x0) - 0.1 * rng.uniform()
        pts = [np.array([x0 + drift * t * t, top - L * t, z0 + 0.05 * math.sin(5 * t + k)]) for t in np.linspace(0, 1, 12)]
        lift = 0.6 + 0.4 * rng.uniform()
        for a, b in zip(pts[:-1], pts[1:]):
            if b[1] < -0.97:
                break
            twig(sp, a, b, 0.008, 0.007, tone=0.5)
            for _ in range(3):
                p = a + (b - a) * rng.uniform()
                s = -1 if rng.uniform() < 0.5 else 1
                d = unit(np.array([s * (0.50 + 0.3 * rng.uniform()), -0.85, rng.normal() * 0.4]))
                leaf(sp, p, d, np.array([rng.normal() * 0.4, 0.3, 1.0]), 0.19 * (0.75 + 0.4 * rng.uniform()), 0.20,
                     'willow', (0.5 + 0.48 * rng.uniform()) * lift, rng, curl=0.15)
    return sp


def mass_spray(seed, maker, count=8, shrink=0.50, turn=1.0):
    """
    A whole bough: several sprays of one kind set out over the disc and in depth, for the middle
    distance, where one card stands for a branch's worth of foliage.
    """
    rng = rng_of(seed)
    sp = Spray()
    for k in range(count):
        a = k * 2.39996 + rng.uniform() * 0.5
        rr = (1 - shrink) * math.sqrt((k + 0.4) / count)
        v, t, tone, kind = maker(seed * 31 + k * 17).arrays()
        # Each spray leans outward from the middle of the bough.
        ang = turn * (rng.normal() * 0.35 - math.cos(a) * 0.8 * (rr / max(1e-6, 1 - shrink)))
        c, s = math.cos(ang), math.sin(ang)
        R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
        v = (v @ R.T) * shrink * (0.9 + 0.2 * rng.uniform())
        v = v + np.array([math.cos(a) * rr, math.sin(a) * rr, (0.5 - rr) * 0.6 + rng.normal() * 0.06])
        base = len(sp.v)
        sp.v.extend([list(map(float, p)) for p in v])
        sp.t.extend([(int(x) + base, int(y) + base, int(z) + base) for x, y, z in t])
        sp.tone.extend([float(x) for x in tone])
        sp.kind.extend([int(x) for x in kind])
    return sp


# A lady fern's frond is long and narrow: it is modelled this much wider than it is, so that it fills its
# square tile, and its card is made that much narrower (trees.fern).
FROND_WIDE = 1.75


def fern_frond(seed, pinnae=19, kind='lady', width=0.46):
    """
    A fern's frond along +Y (foot y = -0.98, tip y = 0.98): a stalk, pinnae in pairs, each cut into leaflets.
    A lady fern is widest at its middle and arches over; a bracken is a triangle, widest at its foot, held flat.
    """
    rng = rng_of(seed)
    sp = Spray()
    bend = rng.normal() * 0.06
    bare = 0.10 if kind == 'lady' else 0.40

    def spine(t):
        y = -0.98 + 1.96 * t
        z = (0.26 * math.sin(math.pi * 0.5 * t) - 0.30 * t * t) if kind == 'lady' else 0.10 * t - 0.16 * t * t
        return np.array([bend * math.sin(2.2 * t), y, z])
    for i in range(14):
        a, b = spine(i / 14), spine((i + 1) / 14)
        w = 0.020 if kind == 'lady' else 0.024
        twig(sp, a, b, w * (1 - 0.8 * i / 14), w * (1 - 0.8 * (i + 1) / 14), tone=0.42)
    for i in range(pinnae):
        t = bare + (0.985 - bare) * (i + 0.5) / pinnae
        u = (t - bare) / (1 - bare)
        if kind == 'lady':
            prof = math.sin(math.pi * (0.16 + 0.84 * u)) ** 0.75
        else:
            prof = (1 - u) ** 0.85 * min(1.0, 0.72 + 2.2 * u)
        for side in (-1, 1):
            L = width * prof * (0.92 + 0.14 * rng.uniform())
            if L < 0.025:
                continue
            base = spine(t)
            lean = 0.42 + 0.35 * u + rng.normal() * 0.05
            d = unit(np.array([side, lean, -0.16 + rng.normal() * 0.08]))
            tip = base + d * L
            twig(sp, base, tip, 0.007, 0.003, tone=0.46)
            n = max(3, int(round(L / 0.046)))
            lift = 0.62 + 0.38 * rng.uniform()
            for k in range(n):
                v = (k + 0.35) / n
                p = base + d * (L * v)
                size = (0.085 if kind == 'lady' else 0.105) * (1 - 0.62 * v) * (0.6 + 0.5 * prof)
                for s2 in (-1, 1):
                    across = unit(np.cross(d, [0, 0, 1.0])) * s2
                    along = unit(across * 0.92 + d * 0.50 + np.array([0, 0, -0.10]))
                    leaf(sp, p, along, np.array([rng.normal() * 0.15, 0.15, 1.0]), size, size * 0.62, 'ovate',
                         (0.50 + 0.46 * rng.uniform()) * lift + 0.14 * u, rng, curl=0.25)
    if kind == 'lady':
        for p in sp.v:
            p[0] *= FROND_WIDE
    return sp


def moss_tuft(seed, count=420):
    """A cushion of moss seen a little from the side: a low mound of tiny upright shoots."""
    rng = rng_of(seed)
    sp = Spray()
    for _ in range(count):
        a = rng.uniform(0, 2 * math.pi)
        r = math.sqrt(rng.uniform())
        x, y = math.cos(a) * r * 0.86, math.sin(a) * r * 0.50
        h = (1 - r * r) ** 0.5
        p = np.array([x, y * 0.8 + 0.20 * h - 0.22, 0.45 * h])
        d = unit(np.array([x * 0.7 + rng.normal() * 0.3, 0.75 + rng.normal() * 0.3, 0.6 + rng.normal() * 0.3]))
        tone = 0.35 + 0.5 * h + 0.15 * rng.uniform()
        for k in range(3):
            needle(sp, p + rng.normal(size=3) * 0.02, unit(d + rng.normal(size=3) * 0.35), 0.15 * (0.6 + 0.6 * rng.uniform()), 0.045, tone)
    return sp
