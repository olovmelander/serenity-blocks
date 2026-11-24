"""
The trees of Odyssey's island (2026-11-24): every specimen, grown.

A specimen is authored the way an environment artist blocks one in: the crown's masses first (its
lobes: where each is, how big, how flat), then the wood that would carry them (a limb to each mass,
leaving the trunk where it would), then twigs grown into each mass (growth.colonize), then foliage on
the twigs' ends. Metres, z up; the tree's foot at the origin.

`Tree` after `finish()`:
  sk, r           the skeleton and its radii
  c, a, n, hl, hw the foliage clusters: centre, growth axis, mass normal, half length, half width
  fam             each cluster's family of sprays
  ao, depth, up   the sky it sees, how deep in the crown it sits (0 heart .. 1 skin), its height 0..1
  lobe            which mass it belongs to
"""

import math

import numpy as np

from growth import (Skeleton, colonize, farthest_points, lobe_points, radii, rng_of, sky_visibility, smooth, spline, tips,
                    unit)
from sprays import FROND_WIDE


class Tree:
    def __init__(self, name, species, stage='mature', flare=(0.55, 0.9, 5), bark='brown'):
        self.name = name
        self.species = species
        self.stage = stage
        self.flare = flare
        self.bark = bark
        self.sk = Skeleton()
        self.r = None
        self.items = []          # (c, a, n, hl, hw, fam, lobe)
        self.lobes = []
        self.wood_budget = 220
        self.trunk_sides = 7
        self.hero_count = 0
        self.mid_count = 44
        self.crown_shapes = None
        self.lying = False       # a log: its wood lies along the ground

    def cluster(self, c, a, n, hl, hw, fam, lobe=0):
        self.items.append((np.asarray(c, float), unit(np.asarray(a, float)), unit(np.asarray(n, float)), float(hl), float(hw),
                           fam, int(lobe)))

    def finish(self, ao_density=0.55):
        # The foot goes into the ground: on a slope no trunk ends in the air.
        if not self.lying:
            self.sk.pos[0] = np.array([self.sk.pos[0][0], self.sk.pos[0][1], -0.9])
        if self.items:
            self.c = np.array([i[0] for i in self.items])
            self.a = np.array([i[1] for i in self.items])
            self.n = np.array([i[2] for i in self.items])
            self.hl = np.array([i[3] for i in self.items])
            self.hw = np.array([i[4] for i in self.items])
            self.fam = [i[5] for i in self.items]
            self.lobe = np.array([i[6] for i in self.items])
            self.ao = sky_visibility(self.c, (self.hl + self.hw) / 2, density=ao_density)
            lo = self.c.min(axis=0)
            hi = self.c.max(axis=0)
            mid = np.array([self.c[:, 0].mean(), self.c[:, 1].mean(), (lo[2] + hi[2]) / 2])
            half = np.maximum((hi - lo) / 2, 0.4)
            self.depth = np.clip(np.linalg.norm((self.c - mid) / half, axis=1), 0, 1)
            self.up = np.clip((self.c[:, 2] - lo[2]) / max(hi[2] - lo[2], 0.1), 0, 1)
            self.crown_mid = mid
            self.crown_half = half
            self.height = float((self.c[:, 2] + self.hl * 0.8).max())
            self.reach = float((np.linalg.norm(self.c[:, :2], axis=1) + self.hw * 0.8).max())
        else:
            p = np.array(self.sk.pos)
            self.c = np.zeros((0, 3))
            self.height = float(p[:, 2].max())
            self.reach = float(np.linalg.norm(p[:, :2], axis=1).max())
            self.crown_mid = np.array([0, 0, self.height / 2])
            self.crown_half = np.array([0.5, 0.5, self.height / 2])
            self.ao = np.zeros(0)
            self.lobe = np.zeros(0, int)
            self.fam = []
        return self


# ── masses ──────────────────────────────────────────────────────────────────────────────────────

def ring(rng, count, z, out, r, flat, jitter=0.18, start=None, drop=0):
    """`count` masses round the tree at height z, `out` from its axis; `drop` of them left out."""
    a0 = rng.uniform(0, 2 * math.pi) if start is None else start
    out_l = []
    skip = set(rng.choice(count, drop, replace=False)) if drop else set()
    for k in range(count):
        if k in skip:
            continue
        a = a0 + 2 * math.pi * k / count + rng.normal() * jitter * 1.2
        o = out * (1 + rng.normal() * jitter)
        rr = r * (1 + rng.normal() * jitter)
        out_l.append((math.cos(a) * o, math.sin(a) * o, z + rng.normal() * jitter * r, rr, rr * (0.85 + 0.3 * rng.uniform()),
                      rr * flat))
    return out_l


def limb_to(sk, start, end, rng, rise=0.35, wiggle=0.10, n=7, tag=1):
    """A limb from node `start` to the point `end`: leaves climbing, levels, wanders a little."""
    a = sk.pos[start]
    e = np.asarray(end, float)
    d = e - a
    L = np.linalg.norm(d)
    flat = np.array([d[0], d[1], 0.0])
    up = np.array([0, 0, 1.0])
    side = unit(np.cross(d, up) + 1e-6)
    m1 = a + d * 0.30 + up * rise * L * 0.30 + side * rng.normal() * wiggle * L - flat * 0.04
    m2 = a + d * 0.68 + up * rise * L * 0.26 + side * rng.normal() * wiggle * L
    pts = spline([a, m1, m2, e], n)
    return sk.chain(pts[1:], parent=start, tag=tag)


def broadleaf(name, species, fam, seed, trunk, lobes, count, size, base_r, stage='mature', attract=720, step=0.5, kill=0.72,
              rise=0.30, wiggle=0.10, fork_lo=0.25, outward=0.75, up=0.35, droop=0.0, tip=0.028, power=2.3, bark='brown',
              flare=(0.6, 0.9, 5), wood=260, mid=46, sides=7, aspect=1.0, lean=(0, 0), shell=0.4, tropism=(0, 0, 0.05),
              jitter_size=0.18, inner=0.10, stems=None, lobe_normal=0.60, spokes=False):
    """A tree whose crown is masses on limbs. `trunk` is a list of control points to the fork (or the leader's top)."""
    rng = rng_of(seed)
    t = Tree(name, species, stage, flare, bark)
    t.wood_budget = wood
    t.trunk_sides = sides
    t.mid_count = mid
    sk = t.sk
    L = float(np.sum(np.linalg.norm(np.diff(np.asarray(trunk, float), axis=0), axis=1)))
    ids = sk.chain(spline(trunk, max(5, int(L / step) + 1)), tag=0)
    roots = [ids]
    for st in (stems or []):
        L2 = float(np.sum(np.linalg.norm(np.diff(np.asarray(st, float), axis=0), axis=1)))
        pts = spline(st, max(4, int(L2 / step) + 1))
        roots.append(sk.chain(pts[1:], parent=ids[0], tag=0))
    t.lobes = lobes
    top = max(sk.pos[i][2] for i in ids)
    order = sorted(range(len(lobes)), key=lambda k: math.hypot(lobes[k][0], lobes[k][1]) + 0.2 * abs(lobes[k][2] - top))
    for k in order:
        l = lobes[k]
        e = np.array([l[0], l[1], l[2] - l[5] * 0.35])
        # The limb leaves the wood that is nearest, below it and inward of it.
        best, score = None, 1e9
        for i in range(len(sk.pos)):
            p = sk.pos[i]
            if p[2] < fork_lo * top:
                continue
            d = e - p
            dist = np.linalg.norm(d)
            if dist < 1e-3:
                continue
            climb = d[2] / dist
            penalty = 0.0 if climb > 0.05 else (0.05 - climb) * 2.2
            inward = max(0.0, math.hypot(p[0], p[1]) - math.hypot(e[0], e[1]))
            sc = dist * (1 + penalty) + inward * 1.5 + (0.0 if sk.tag[i] == 0 else 0.35 * dist)
            if spokes and sk.tag[i] != 0:
                sc += 60
            if sc < score:
                best, score = i, sc
        if best is None:
            best = ids[-1]
        n = max(4, int(np.linalg.norm(e - sk.pos[best]) / step) + 1)
        limb_to(sk, best, e, rng, rise, wiggle, n)
    pts, owner = lobe_points(lobes, attract, rng, shell)
    colonize(sk, pts, step=step, infl=6.5, kill=kill, rng=rng, tropism=tropism, iters=90)
    smooth(sk, 2, 0.35, hold=2)
    t.r = radii(sk, tip=tip, power=power, base=base_r)
    P = np.array(sk.pos)
    par = np.array(sk.parent)
    ends = tips(sk)
    # Foliage sits where the twigs end, and a little on the shoots behind them.
    centres = np.array([l[:3] for l in lobes])
    half = np.array([l[3:6] for l in lobes])
    cand = []
    for i in ends:
        cand.append((P[i], P[i] - P[par[i]], 1.0))
        j = par[i]
        if j > 0 and par[j] > 0 and rng.uniform() < 0.5 + inner:
            cand.append((P[j], P[i] - P[j], 0.75))
    cp = np.array([c[0] for c in cand])
    cd = unit(np.array([c[1] for c in cand]))
    cw = np.array([c[2] for c in cand])
    rel = (cp[:, None, :] - centres[None]) / half[None]
    owner = np.linalg.norm(rel, axis=2).argmin(axis=1)
    skin = np.linalg.norm(rel, axis=2).min(axis=1)
    pick = farthest_points(cp, count, weight=cw * (0.75 + 0.5 * np.clip(skin, 0, 1.1)))
    mean = P[ends].mean(axis=0)
    for k in pick:
        lo = owner[k]
        ln = unit((cp[k] - centres[lo]) / (half[lo] ** 2) * half[lo].mean())
        crown = unit((cp[k] - np.array([mean[0], mean[1], mean[2] - 0.15 * half[:, 2].mean()])) * np.array([1, 1, 1.15]))
        nrm = unit(ln * lobe_normal + crown * (1 - lobe_normal))
        axis = unit(cd[k] * 0.45 + nrm * outward + np.array([0, 0, up - droop]))
        s = size * (1 + rng.normal() * jitter_size)
        s = max(size * 0.6, min(size * 1.5, s))
        c = cp[k] + axis * s * 0.22
        t.cluster(c, axis, nrm, s, s * aspect, fam, lo)
    if lean != (0, 0):
        shear(t, lean)
    return t.finish()


def shear(t, lean, power=1.35):
    """Lean the whole tree (the wind's, or the light's): the higher, the further."""
    H = max(p[2] for p in t.sk.pos) or 1.0
    lx, ly = lean

    def off(p):
        k = (max(0.0, p[2]) / H) ** power * H
        return np.array([p[0] + lx * k, p[1] + ly * k, p[2]])
    t.sk.pos = [off(p) for p in t.sk.pos]
    t.items = [(off(c), unit(a + np.array([lx, ly, 0]) * 0.3), n, hl, hw, fam, lo) for c, a, n, hl, hw, fam, lo in t.items]


def conifer(name, species, fam, seed, H, R, base_r, lo=0.10, whorls=22, per=6, stage='mature', profile=None, e_top=38, e_bot=-12,
            droop=0.18, tip_up=0.10, width=0.46, gap=0.06, wobble=0.012, wood=220, mid=48, bark='brown', two_over=2.6, side=True,
            dead=0.0, flare=(0.5, 0.7, 5), len_jit=0.16, curve=None, sides=6, lobe_n=0.35, tuft=0.034, dense_top=0.86):
    """A leader and irregular whorls of drooping boughs."""
    rng = rng_of(seed)
    t = Tree(name, species, stage, flare, bark)
    t.wood_budget = wood
    t.trunk_sides = sides
    t.mid_count = mid
    sk = t.sk
    base_profile = profile or (lambda u: (1 - u) ** 0.80)
    # Near the tip the boughs shorten slowly and stand up, so the spire closes instead of baring its leader.
    profile = lambda u: max(base_profile(u), 0.30 * (1 - u) ** 0.42 + 0.05)
    n = 20
    path = []
    ph = rng.uniform(0, 6.28, 2)
    for i in range(n):
        u = i / (n - 1)
        w = wobble * H * u
        bend = curve(u) if curve else (0.0, 0.0)
        path.append([w * math.sin(2.1 * u * math.pi + ph[0]) + bend[0], w * math.sin(1.6 * u * math.pi + ph[1]) + bend[1], H * u])
    path = np.array(path)
    leader = sk.chain(path, tag=0)

    def at(z):
        u = np.clip(z / H, 0, 1) * (n - 1)
        i = min(int(u), n - 2)
        f = u - i
        return path[i] * (1 - f) + path[i + 1] * f, leader[i if f < 0.5 else i + 1]

    az = rng.uniform(0, 6.28)
    for w in range(whorls):
        u = ((w + 0.15 + 0.45 * rng.uniform()) / whorls) ** dense_top
        z = H * (lo + (0.975 - lo) * u)
        k = per + (1 if rng.uniform() < 0.3 else 0) - (1 if rng.uniform() < 0.3 else 0)
        if u > 0.72:
            k = max(4, k - 1)
        az += 2.399 + rng.normal() * 0.3
        for b in range(k):
            if rng.uniform() < gap * (1.6 - u):
                continue
            a = az + 2 * math.pi * b / k + rng.normal() * 0.22
            z2 = z + rng.normal() * H * 0.012
            p0, node = at(z2)
            L = R * profile(u) * (1 + rng.normal() * len_jit)
            L = max(0.15 * R, L)
            e0 = math.radians(e_bot + (e_top - e_bot) * u ** 1.3 + 24 * max(0.0, (u - 0.80) / 0.20) + rng.normal() * 6)
            h = np.array([math.cos(a), math.sin(a), 0.0])
            m = 5 if L > 2 else 4
            pts = []
            for q in range(1, m + 1):
                s = q / m
                pts.append(p0 + h * L * s * math.cos(e0 * 0.6)
                           + np.array([0, 0, (math.sin(e0) * s - droop * s * s + tip_up * s ** 3) * L]))
            is_dead = u < 0.22 and rng.uniform() < dead
            if is_dead:
                pts = [p0 + (p - p0) * 0.55 for p in pts]
            sk.chain(pts, parent=node, tag=2 if is_dead else 1)
            if is_dead:
                continue
            pts = np.array([p0] + pts)
            seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
            cum = np.concatenate([[0], np.cumsum(seg)])
            tot = cum[-1]

            def along(d):
                i = min(int(np.searchsorted(cum, d, side='right')) - 1, len(pts) - 2)
                i = max(i, 0)
                f = (d - cum[i]) / max(seg[i], 1e-6)
                return pts[i] * (1 - f) + pts[i + 1] * f, unit(pts[i + 1] - pts[i])
            nrm = unit(h * (1 - lobe_n) + np.array([0, 0, 0.55 + 0.3 * u]))
            spans = [(0.08, 0.64), (0.46, 1.05)] if tot > two_over else [(0.02, 1.06)]
            for s0, s1 in spans:
                c, _ = along(tot * (s0 + s1) / 2)
                p1, _ = along(tot * s0)
                p2, _ = along(min(tot, tot * s1))
                ax = unit(p2 - p1)
                hl = tot * (s1 - s0) / 2 * 1.06
                t.cluster(c, ax, nrm, hl, max(hl * width, 0.34) * (1.15 if len(spans) == 2 else 1.0), fam, w)
            if side and tot > two_over * 0.75:
                for sgn in (-1, 1):
                    if rng.uniform() < 0.22:
                        continue
                    c, ax = along(tot * (0.50 + 0.1 * rng.uniform()))
                    lat = unit(np.cross(ax, [0, 0, 1.0])) * sgn
                    ax2 = unit(ax * 0.72 + lat * 0.70 + np.array([0, 0, -0.24]))
                    hl = tot * 0.25
                    t.cluster(c + ax2 * hl * 0.85, ax2, nrm, hl, hl * width * 1.15, fam, w)
    # the leader's own tuft
    tip = path[-1]
    tl = tuft * H
    t.cluster(tip + np.array([0, 0, -tl * 0.15]), [0, 0, 1], [0, 0, 1], tl, tl * 0.30, fam, whorls)
    for a in np.arange(3) * 2.09 + rng.uniform(0, 6):
        d = unit(np.array([math.cos(a) * 0.9, math.sin(a) * 0.9, 1.0]))
        t.cluster(tip + np.array([0, 0, -tl * 1.0]) + d * tl * 0.32, d, d, tl * 0.55, tl * 0.26, fam, whorls)
    t.r = radii(sk, tip=0.02, power=2.1, base=base_r)
    for i, node in enumerate(leader):
        u = i / (n - 1)
        t.r[node] = max(0.016, base_r * (1 - u) ** 1.05 * 0.96 + 0.010)
    for i in range(len(sk.pos)):
        if sk.tag[i] != 0:
            t.r[i] = min(t.r[i], 0.42 * t.r[sk.parent[i]] if sk.tag[sk.parent[i]] == 0 else t.r[sk.parent[i]])
            t.r[i] = max(t.r[i], 0.015)
    return t.finish(ao_density=0.42)


def column(name, species, fam, seed, H, R, base_r, stage='mature', levels=24, per=4, wood=70, mid=30, lo=0.04, bark='brown', fat=0.36):
    """A cypress or a poplar: a flame of upswept sprays."""
    rng = rng_of(seed)
    t = Tree(name, species, stage, (0.4, 0.5, 4), bark)
    t.wood_budget = wood
    t.trunk_sides = 6
    t.mid_count = mid
    path = spline([[0, 0, 0], [rng.normal() * 0.05, 0, H * 0.4], [rng.normal() * 0.12, rng.normal() * 0.1, H * 0.95]], 12)
    t.sk.chain(path, tag=0)
    for w in range(levels):
        u = (w + 0.3) / levels
        z = H * (lo + (0.95 - lo) * u)
        prof = min(1.0, (u / fat) ** 0.55) * (1 - max(0.0, (u - fat) / (1 - fat)) ** 1.5) ** 0.85
        prof *= 1 + 0.12 * math.sin(u * 17 + seed) * (1 - u)
        r = R * max(0.10, prof)
        p = path[min(11, int(u * 11))]
        for k in range(per if u < 0.85 else 2):
            a = w * 1.3 + 2 * math.pi * k / per + rng.normal() * 0.25
            h = np.array([math.cos(a), math.sin(a), 0])
            s = max(0.55, r * 0.85) * (1 + rng.normal() * 0.12)
            c = np.array([p[0], p[1], z]) + h * max(0.0, r - s * 0.42)
            t.cluster(c, unit(h * 0.22 + np.array([0, 0, 1.0])), unit(h + np.array([0, 0, 0.25])), s * 1.35, s * 0.72, fam, w)
    t.cluster(path[-1] + np.array([0, 0, 0.02 * H]), [0, 0, 1], [0, 0, 1], 0.07 * H, 0.025 * H + 0.12, fam, levels)
    t.r = radii(t.sk, base=base_r)
    for i in range(len(t.sk.pos)):
        t.r[i] = max(0.02, base_r * (1 - i / 12))
    return t.finish(ao_density=0.45)


def shrub(name, species, fam, seed, R, H, count, size, stems=5, stage='bush', bark='brown', flat=0.8, attract=300, mid=14, wood=40,
          aspect=1.0, lobes=None):
    """A bush: several stems from one foot, a low dome of masses."""
    rng = rng_of(seed)
    ls = lobes or (ring(rng, 4 if R > 1.2 else 3, H * 0.42, R * 0.52, R * 0.50, flat, 0.14)
                   + [(rng.normal() * 0.1 * R, rng.normal() * 0.1 * R, H * 0.62, R * 0.52, R * 0.50, R * 0.46 * flat)])
    side = []
    for k in range(stems):
        a = 2 * math.pi * k / stems + rng.uniform(0, 1)
        side.append([[0, 0, 0], [math.cos(a) * R * 0.16, math.sin(a) * R * 0.16, H * 0.22],
                     [math.cos(a) * R * 0.34, math.sin(a) * R * 0.34, H * 0.42]])
    return broadleaf(name, species, fam, seed, [[0, 0, 0], [0.02, 0, H * 0.2], [0.04, 0.03, H * 0.45]], ls, count, size, 0.06 + 0.02 * R,
                     stage=stage, attract=attract, step=0.22 * max(1.0, R / 1.5), kill=0.28 * max(1.0, R / 1.5), fork_lo=0.1, up=0.5,
                     stems=side, bark=bark, wood=wood, mid=mid, sides=4, flare=None, tip=0.014, aspect=aspect)


def snag(name, seed, H, base_r, stubs=9, lean=(0.04, 0.02)):
    """A dead tree: a silver trunk broken off, a few stubs left."""
    rng = rng_of(seed)
    t = Tree(name, 'snag', 'dead', (0.5, 1.1, 5), 'silver')
    t.wood_budget = 190
    t.trunk_sides = 7
    path = spline([[0, 0, 0], [H * 0.02, -H * 0.02, H * 0.35], [H * 0.05, H * 0.01, H * 0.7], [H * 0.04, H * 0.05, H]], 12)
    ids = t.sk.chain(path, tag=0)
    for k in range(stubs):
        u = 0.25 + 0.68 * (k + rng.uniform()) / stubs
        i = ids[int(u * 11)]
        a = k * 2.4 + rng.normal() * 0.4
        L = H * (0.10 + 0.20 * rng.uniform()) * (1.15 - 0.7 * u)
        h = np.array([math.cos(a), math.sin(a), 0.0])
        p = t.sk.pos[i]
        pts = [p + h * L * s + np.array([0, 0, L * (0.25 * s - 0.35 * s * s)]) + rng.normal(size=3) * 0.03 * L for s in (0.35, 0.7, 1.0)]
        chain = t.sk.chain(pts, parent=i, tag=2)
        if rng.uniform() < 0.6:
            d = unit(h + rng.normal(size=3) * 0.5)
            t.sk.chain([pts[1] + d * L * 0.2, pts[1] + d * L * 0.38], parent=chain[1], tag=2)
    t.r = radii(t.sk, base=base_r, tip=0.02)
    for i, node in enumerate(ids):
        t.r[node] = base_r * (1 - 0.62 * i / 11)
    for i in range(len(t.sk.pos)):
        if t.sk.tag[i] == 2:
            t.r[i] = max(0.02, min(t.r[i], 0.28 * t.r[ids[0]]))
    return t.finish()


# ── the specimens ───────────────────────────────────────────────────────────────────────────────

def oak_great(seed=101):
    """The great oak: a short massive bole, limbs like trees of their own, a crown wider than it is tall."""
    rng = rng_of(seed)
    lobes = (ring(rng, 7, 5.6, 6.4, 2.7, 0.62, 0.13, start=0.2)
             + ring(rng, 6, 8.6, 4.9, 2.9, 0.66, 0.12, start=0.7)
             + ring(rng, 4, 11.4, 2.7, 2.7, 0.66, 0.12)
             + [(0.5, -0.3, 13.0, 2.4, 2.3, 1.6), (0.2, 0.2, 8.6, 2.6, 2.6, 2.0)])
    return broadleaf('oak-great', 'oak', 'oak', seed, [[0, 0, 0], [0.15, 0.05, 1.5], [0.05, 0.3, 3.0], [0.4, 0.2, 5.4]], lobes, 250, 1.36, 0.95,
                     stage='old', attract=900, step=0.6, kill=0.95, rise=0.20, wiggle=0.14, fork_lo=0.42, wood=420, mid=93, sides=9,
                     flare=(0.8, 1.1, 6), outward=0.85, up=0.28, bark='oak')


def oak_wide(seed=102):
    rng = rng_of(seed)
    lobes = (ring(rng, 6, 5.0, 4.7, 2.25, 0.64, 0.15, drop=1)
             + ring(rng, 5, 7.6, 3.6, 2.3, 0.68, 0.14)
             + ring(rng, 3, 10.0, 1.8, 2.2, 0.70, 0.12) + [(0, 0, 11.3, 1.9, 1.9, 1.3), (0, 0, 7.2, 2.2, 2.2, 1.6)])
    return broadleaf('oak-wide', 'oak', 'oak', seed, [[0, 0, 0], [0.2, -0.1, 1.6], [0.0, 0.25, 3.4], [-0.2, 0.1, 5.0]], lobes, 205, 1.22, 0.62,
                     attract=680, step=0.55, rise=0.24, wiggle=0.12, fork_lo=0.4, wood=300, mid=78, sides=8, bark='oak', outward=0.85, up=0.28)


def oak_tall(seed=103):
    """An oak of the closed wood: a clean bole, the crown pushed up to the light."""
    rng = rng_of(seed)
    lobes = (ring(rng, 4, 8.2, 2.7, 1.9, 0.75, 0.16) + ring(rng, 5, 11.0, 2.9, 2.0, 0.75, 0.15) + ring(rng, 4, 13.8, 2.0, 1.9, 0.75, 0.15)
             + [(0.2, 0.1, 15.6, 1.8, 1.7, 1.3), (0, 0, 11.0, 2.0, 2.0, 2.0)])
    return broadleaf('oak-tall', 'oak', 'oak', seed, [[0, 0, 0], [0.1, 0.1, 3.0], [-0.15, 0.05, 6.6], [0.15, 0, 11.6]], lobes, 190, 1.16, 0.40,
                     attract=620, rise=0.45, fork_lo=0.5, wood=230, mid=71, bark='oak')


def oak_young(seed=104):
    rng = rng_of(seed)
    lobes = ring(rng, 4, 3.0, 1.35, 1.15, 0.78, 0.16) + ring(rng, 3, 4.5, 0.95, 1.1, 0.8, 0.15) + [(0, 0, 5.6, 0.95, 0.95, 0.9)]
    return broadleaf('oak-young', 'oak', 'oak', seed, [[0, 0, 0], [0.05, 0, 1.2], [0, 0.05, 3.9]], lobes, 96, 0.84, 0.16, stage='young',
                     attract=420, step=0.32, kill=0.42, rise=0.4, fork_lo=0.3, wood=90, mid=24, sides=5, bark='oak')


def beech_tall(seed=111):
    """A beech: a smooth grey column, a tall dome of close, layered sprays."""
    rng = rng_of(seed)
    lobes = (ring(rng, 5, 6.6, 3.5, 2.1, 0.58, 0.12) + ring(rng, 6, 9.4, 3.7, 2.2, 0.58, 0.12) + ring(rng, 5, 12.4, 3.0, 2.1, 0.60, 0.12)
             + ring(rng, 4, 15.0, 1.9, 1.9, 0.65, 0.12) + [(0, 0.2, 17.2, 1.6, 1.6, 1.5), (0, 0, 11.6, 2.2, 2.2, 2.6)])
    return broadleaf('beech-tall', 'beech', 'beech', seed, [[0, 0, 0], [0.1, 0, 4.0], [0.0, 0.15, 8.4], [0.1, 0.1, 14.6]], lobes, 240, 1.22, 0.50,
                     attract=820, rise=0.42, fork_lo=0.34, wood=260, mid=84, sides=8, bark='grey', outward=0.95, up=0.10, aspect=1.05)


def beech_dome(seed=112):
    rng = rng_of(seed)
    lobes = (ring(rng, 6, 4.4, 3.9, 1.9, 0.60, 0.13) + ring(rng, 6, 7.0, 3.6, 2.0, 0.60, 0.13) + ring(rng, 4, 9.6, 2.4, 2.0, 0.62, 0.13)
             + [(0.1, 0, 11.6, 1.9, 1.9, 1.5), (0, 0, 7.0, 2.2, 2.2, 2.0)])
    return broadleaf('beech-dome', 'beech', 'beech', seed, [[0, 0, 0], [0.05, 0.1, 2.0], [0.1, 0.05, 4.8], [0, 0, 9.0]], lobes, 205, 1.16, 0.50,
                     attract=700, rise=0.34, fork_lo=0.2, wood=220, mid=74, bark='grey', outward=0.95, up=0.10, aspect=1.05)


def beech_young(seed=113):
    rng = rng_of(seed)
    lobes = ring(rng, 4, 2.6, 1.3, 1.0, 0.65, 0.15) + ring(rng, 3, 4.4, 1.1, 1.0, 0.65, 0.15) + [(0, 0, 6.0, 0.8, 0.8, 1.0)]
    return broadleaf('beech-young', 'beech', 'beech', seed, [[0, 0, 0], [0.04, 0, 1.6], [0, 0.05, 5.2]], lobes, 92, 0.80, 0.13, stage='young',
                     attract=420, step=0.32, kill=0.42, rise=0.4, fork_lo=0.18, wood=80, mid=22, sides=5, bark='grey')


def birch_one(seed=121):
    """A silver birch: a white stem that curves, upswept limbs whose ends weep."""
    rng = rng_of(seed)
    lobes = []
    for k, (z, out, r) in enumerate([(5.0, 1.5, 1.15), (6.2, 1.8, 1.25), (7.4, 1.7, 1.25), (8.6, 1.55, 1.2), (9.8, 1.35, 1.1),
                                     (10.9, 1.0, 1.0), (12.0, 0.7, 0.85)]):
        a = k * 2.4 + rng.normal() * 0.2
        lobes.append((math.cos(a) * out, math.sin(a) * out, z, r, r, r * 0.95))
        if k in (1, 2, 3, 4):
            lobes.append((math.cos(a + 2.2) * out * 0.9, math.sin(a + 2.2) * out * 0.9, z - 0.5, r * 0.9, r * 0.9, r * 0.9))
    lobes.append((0.1, 0.05, 13.0, 0.55, 0.55, 0.8))
    return broadleaf('birch-one', 'birch', 'birch', seed, [[0, 0, 0], [0.28, 0.05, 3.2], [0.12, 0.2, 7.5], [0.35, 0.1, 12.6]], lobes, 170, 0.96, 0.21,
                     attract=820, step=0.38, kill=0.48, rise=0.75, wiggle=0.08, fork_lo=0.28, up=-0.15, outward=0.55, droop=0.35, wood=170, mid=62,
                     sides=6, bark='birch', flare=(0.4, 0.5, 4), aspect=0.92, jitter_size=0.22)


def birch_clump(seed=122):
    """Three birches from one stool, leaning out of each other's way."""
    rng = rng_of(seed)
    lobes = []
    stems = []
    for s in range(3):
        a = 0.4 + s * 2.1
        lean = 1.5 + 0.5 * rng.uniform()
        h = [12.2, 10.6, 9.2][s]
        d = np.array([math.cos(a), math.sin(a)])
        stems.append([[0, 0, 0], [d[0] * lean * 0.35, d[1] * lean * 0.35, h * 0.3], [d[0] * lean * 0.8, d[1] * lean * 0.8, h * 0.65],
                      [d[0] * lean * 1.15, d[1] * lean * 1.15, h]])
        for k in range(5):
            u = 0.42 + 0.56 * k / 4
            b = k * 2.4 + s
            out = 1.25 * (1 - 0.7 * (u - 0.42) / 0.58)
            r = 1.15 * (1 - 0.45 * (u - 0.42) / 0.58)
            lobes.append((d[0] * lean * (0.4 + 0.75 * u) + math.cos(b) * out, d[1] * lean * (0.4 + 0.75 * u) + math.sin(b) * out, h * u, r, r, r))
    return broadleaf('birch-clump', 'birch', 'birch', seed, stems[0], lobes, 215, 0.96, 0.18, attract=980, step=0.38, kill=0.48, rise=0.7,
                     fork_lo=0.25, up=-0.15, outward=0.55, droop=0.35, wood=260, mid=71, sides=6, bark='birch', flare=(0.35, 0.4, 4),
                     stems=stems[1:], aspect=0.92, jitter_size=0.22)


def birch_young(seed=123):
    lobes = [(0.25, 0, 2.6, 0.6, 0.6, 0.7), (-0.2, 0.25, 3.5, 0.6, 0.6, 0.7), (0.1, -0.2, 4.4, 0.5, 0.5, 0.65), (0.05, 0.05, 5.4, 0.36, 0.36, 0.6)]
    return broadleaf('birch-young', 'birch', 'birch', seed, [[0, 0, 0], [0.1, 0.02, 2], [0.02, 0.08, 5.2]], lobes, 62, 0.66, 0.085, stage='young',
                     attract=320, step=0.28, kill=0.32, rise=0.7, fork_lo=0.3, up=0.0, wood=60, mid=18, sides=5, bark='birch', flare=None)


def aspen_tall(seed=131):
    """An aspen of a clone: a pale bole bare half its height, a rounded narrow crown."""
    rng = rng_of(seed)
    lobes = ring(rng, 3, 7.4, 1.4, 1.25, 0.85, 0.15) + ring(rng, 4, 9.2, 1.55, 1.3, 0.85, 0.15) + ring(rng, 3, 11.0, 1.2, 1.25, 0.85, 0.15) \
        + [(0, 0, 12.6, 1.0, 1.0, 1.0)]
    return broadleaf('aspen-tall', 'aspen', 'aspen', seed, [[0, 0, 0], [0.12, 0, 3.5], [-0.05, 0.12, 7], [0.1, 0.05, 11.6]], lobes, 150, 0.98, 0.20,
                     attract=700, step=0.38, kill=0.48, rise=0.6, fork_lo=0.5, wood=130, mid=56, sides=6, bark='aspen', flare=(0.35, 0.4, 4), up=0.15)


def aspen_broad(seed=132):
    rng = rng_of(seed)
    lobes = ring(rng, 4, 5.4, 1.9, 1.4, 0.82, 0.16, drop=1) + ring(rng, 4, 7.4, 1.8, 1.45, 0.82, 0.15) + ring(rng, 3, 9.4, 1.2, 1.3, 0.85, 0.15) \
        + [(0.1, 0, 10.8, 1.0, 1.0, 0.95)]
    return broadleaf('aspen-broad', 'aspen', 'aspen', seed, [[0, 0, 0], [-0.2, 0.1, 2.6], [0.1, 0.05, 5.4], [0, 0.1, 9.6]], lobes, 158, 1.02, 0.22,
                     attract=720, step=0.38, kill=0.48, rise=0.55, fork_lo=0.36, wood=140, mid=56, sides=6, bark='aspen', flare=(0.35, 0.4, 4), up=0.15)


def aspen_young(seed=133):
    lobes = [(0.2, 0.1, 3.0, 0.7, 0.7, 0.7), (-0.2, 0, 4.0, 0.7, 0.7, 0.7), (0, 0.05, 5.1, 0.55, 0.55, 0.65)]
    return broadleaf('aspen-young', 'aspen', 'aspen', seed, [[0, 0, 0], [0.06, 0, 2], [0, 0.05, 4.8]], lobes, 58, 0.72, 0.085, stage='young',
                     attract=320, step=0.28, kill=0.32, rise=0.6, fork_lo=0.4, wood=50, mid=16, sides=5, bark='aspen', flare=None)


def maple_round(seed=141):
    rng = rng_of(seed)
    lobes = (ring(rng, 6, 4.4, 3.4, 1.8, 0.52, 0.13) + ring(rng, 5, 6.6, 3.2, 1.9, 0.54, 0.13) + ring(rng, 4, 8.8, 2.1, 1.8, 0.56, 0.12)
             + [(0.1, 0, 10.4, 1.6, 1.6, 1.0), (0, 0, 6.4, 1.8, 1.8, 1.6)])
    return broadleaf('maple-round', 'maple', 'maple', seed, [[0, 0, 0], [-0.1, 0.1, 1.5], [0.1, 0, 3.2], [0, 0.1, 6.6]], lobes, 190, 1.16, 0.42,
                     attract=600, step=0.5, rise=0.35, fork_lo=0.3, wood=220, mid=71, bark='dark', outward=0.9, up=0.16, aspect=1.08)


def maple_spread(seed=142):
    """A maple over open ground: tiers like spread hands, a bent double stem."""
    rng = rng_of(seed)
    lobes = (ring(rng, 5, 3.2, 3.7, 1.6, 0.42, 0.14) + ring(rng, 5, 5.0, 3.0, 1.7, 0.44, 0.14) + ring(rng, 3, 6.8, 1.6, 1.6, 0.48, 0.12)
             + [(-0.2, 0.2, 8.0, 1.2, 1.2, 0.7)])
    return broadleaf('maple-spread', 'maple', 'maple', seed, [[0, 0, 0], [0.45, 0.1, 1.1], [0.2, -0.2, 2.3], [0.5, 0.1, 4.6]], lobes, 190, 1.08, 0.36,
                     attract=820, step=0.42, kill=0.6, rise=0.22, wiggle=0.16, fork_lo=0.25, wood=240, mid=65, bark='dark', outward=0.95, up=0.10, aspect=1.15,
                     stems=[[[0, 0, 0], [-0.5, 0.3, 1.0], [-0.9, 0.6, 2.3], [-1.0, 0.4, 3.8]]])


def cherry_queen(seed=151):
    """The cherry queen: an old black trunk, limbs thrown wide and low, cloud upon cloud of blossom."""
    rng = rng_of(seed)
    lobes = (ring(rng, 6, 3.3, 5.0, 1.95, 0.46, 0.14, start=0.1) + ring(rng, 6, 5.2, 4.2, 2.05, 0.50, 0.14, start=0.6)
             + ring(rng, 4, 7.1, 2.5, 2.0, 0.52, 0.12) + [(0.3, -0.2, 8.4, 1.7, 1.7, 1.0), (-0.2, 0.1, 5.6, 1.7, 1.7, 1.2)])
    return broadleaf('cherry-queen', 'cherry', 'cherry', seed, [[0, 0, 0], [0.45, 0.1, 0.9], [0.15, 0.35, 2.0], [0.4, 0.1, 3.5]], lobes, 235, 1.14, 0.62,
                     stage='old', attract=760, step=0.5, rise=0.24, wiggle=0.18, fork_lo=0.3, wood=360, mid=84, sides=8, bark='cherry',
                     flare=(0.6, 1.0, 5), outward=0.8, up=0.25, stems=[[[0, 0, 0], [-0.4, 0.2, 1.0], [-0.95, 0.5, 2.2], [-1.4, 0.4, 3.4]]])


def cherry_vase(seed=152):
    rng = rng_of(seed)
    lobes = (ring(rng, 5, 3.6, 2.6, 1.45, 0.60, 0.15) + ring(rng, 5, 5.4, 2.5, 1.5, 0.60, 0.15) + ring(rng, 3, 7.0, 1.3, 1.4, 0.65, 0.14)
             + [(0.1, 0, 8.1, 1.0, 1.0, 0.8)])
    return broadleaf('cherry-vase', 'cherry', 'cherry', seed, [[0, 0, 0], [0.1, 0.05, 0.9], [0.05, 0.1, 1.9]], lobes, 165, 1.0, 0.28,
                     attract=760, step=0.38, kill=0.5, rise=0.55, wiggle=0.12, fork_lo=0.5, wood=190, mid=59, bark='cherry', outward=0.7, up=0.35,
                     stems=[[[0, 0, 0], [-0.25, 0.15, 1.0], [-0.6, 0.3, 2.4]], [[0, 0, 0], [0.15, -0.3, 1.0], [0.4, -0.75, 2.5]]])


def cherry_cloud(seed=153):
    """A cherry leaning down the slope, its masses drawn out like cloud."""
    rng = rng_of(seed)
    lobes = [(1.2, 0.2, 3.4, 1.7, 1.4, 0.85), (3.2, 0.6, 3.0, 1.7, 1.3, 0.75), (4.8, 0.2, 2.5, 1.2, 1.1, 0.6), (-1.4, 0.8, 3.8, 1.5, 1.4, 0.85),
             (0.2, -1.7, 3.6, 1.5, 1.3, 0.8), (1.6, 1.9, 4.2, 1.5, 1.3, 0.8), (0.6, 0.1, 5.3, 1.6, 1.5, 0.95), (2.3, -0.8, 4.7, 1.4, 1.3, 0.8),
             (0.2, 0.6, 6.4, 1.1, 1.1, 0.8)]
    return broadleaf('cherry-cloud', 'cherry', 'cherry', seed, [[0, 0, 0], [0.5, 0, 0.8], [0.5, 0.2, 1.8], [1.0, 0.2, 3.0]], lobes, 150, 1.0, 0.30,
                     attract=760, step=0.36, kill=0.46, rise=0.22, wiggle=0.16, fork_lo=0.4, wood=200, mid=59, bark='cherry', outward=0.75, up=0.28)


def cherry_young(seed=154):
    rng = rng_of(seed)
    lobes = ring(rng, 4, 2.0, 0.9, 0.75, 0.75, 0.15) + [(0, 0, 3.1, 0.75, 0.75, 0.7), (0.1, 0.1, 4.0, 0.45, 0.45, 0.5)]
    return broadleaf('cherry-young', 'cherry', 'cherry', seed, [[0, 0, 0], [0.05, 0, 0.7], [0, 0.05, 2.6]], lobes, 66, 0.70, 0.10, stage='young',
                     attract=330, step=0.28, kill=0.32, rise=0.5, fork_lo=0.35, wood=70, mid=18, sides=5, bark='cherry', flare=None)


def willow(name, seed, H=9.5, R=4.6, n=96):
    """
    A weeping willow: a thick leaning bole, limbs that arch over, and whips that fall all round it. Over
    the dome they start at its crest and lie out along it; at its skirt they hang to the water.
    """
    rng = rng_of(seed)
    lobes = (ring(rng, 6, H * 0.66, R * 0.50, R * 0.28, 0.6, 0.10) + ring(rng, 4, H * 0.82, R * 0.28, R * 0.28, 0.6, 0.10)
             + [(0.1, 0, H * 0.92, R * 0.22, R * 0.22, R * 0.16)])
    t = broadleaf(name, 'willow', 'willowtop', seed, [[0, 0, 0], [0.35, 0.1, H * 0.12], [0.1, 0.2, H * 0.24], [0.3, 0, H * 0.44]], lobes, 40, 0.9, 0.52,
                  attract=560, step=0.4, kill=0.55, rise=0.75, wiggle=0.10, fork_lo=0.45, wood=230, mid=20, bark='dark', outward=0.6, up=0.0,
                  droop=0.5, flare=(0.6, 1.0, 5))
    # the dome: whips laid out from the crest, steeper the further out
    for k in range(int(n * 0.72)):
        u = math.sqrt((k + 0.5) / (n * 0.72))
        a = k * 2.39996 + rng.normal() * 0.15
        h = np.array([math.cos(a), math.sin(a), 0.0])
        out = R * 0.80 * u
        root = h * out + np.array([0.15, 0, H * (1.0 - 0.30 * u * u) + rng.normal() * 0.15])
        d = unit(h * (0.95 - 0.72 * u) + np.array([0, 0, -(0.30 + 1.0 * u)]) + rng.normal(size=3) * 0.07)
        L = (1.5 + 1.1 * u) * (0.85 + 0.3 * rng.uniform()) * H / 9.5
        nrm = unit(h * (0.35 + 0.6 * u) + np.array([0, 0, 1.05 - 0.85 * u]))
        t.cluster(root + d * L * 0.5, -d, nrm, L * 0.58, L * 0.34 + 0.18, 'willow', 20)
    # the skirt: long curtains to the grass and the water
    for k in range(n):
        a = k * 2.39996 + rng.normal() * 0.1
        ring_ = k % 3
        out = R * (1.0 - 0.17 * ring_) * (1 + rng.normal() * 0.05)
        top = H * (0.72 + 0.07 * ring_) + rng.normal() * 0.3
        L = min(top - 0.2, H * (0.50 + 0.22 * rng.uniform()))
        hl = L / 2 * (0.88 + 0.14 * rng.uniform())
        h = np.array([math.cos(a), math.sin(a), 0])
        c = h * out + np.array([0.1, 0, top - hl])
        t.cluster(c, unit(np.array([0, 0, 1.0]) - h * (0.06 + 0.10 * rng.uniform())), unit(h + np.array([0, 0, 0.12])), hl, hl * 0.40, 'willow', 21 + ring_)
    t.mid_count = 84
    return t.finish(ao_density=0.34)


def stone_pine(name, seed, H, R, lean=(0.0, 0.0), count=210, size=1.0, base_r=0.40, forks=8, stage='mature', dome=0.36, attract=900,
               fork_at=0.58, wood=260, mid=68):
    """A stone pine: a bare curving bole, ribs that fan like an umbrella's, one flat dome of needles."""
    rng = rng_of(seed)
    z0 = H * 0.86
    rz = R * dome
    lobes = []
    for k in range(forks):
        a = 2 * math.pi * k / forks + rng.normal() * 0.14
        o = R * 0.68 * (1 + rng.normal() * 0.08)
        rr = R * 0.38 * (1 + rng.normal() * 0.10)
        lobes.append((math.cos(a) * o, math.sin(a) * o, z0 - rz * 0.26 + rng.normal() * 0.12, rr, rr, rz * 0.60))
    for k in range(5):
        a = 2 * math.pi * k / 5 + rng.uniform()
        o = R * 0.32
        lobes.append((math.cos(a) * o, math.sin(a) * o, z0 + rz * 0.30, R * 0.36, R * 0.36, rz * 0.58))
    lobes.append((0, 0, z0 + rz * 0.52, R * 0.34, R * 0.34, rz * 0.5))
    f = H * fork_at
    return broadleaf(name, 'stone-pine', 'pine', seed, [[0, 0, 0], [0.035 * H, 0.02, f * 0.35], [-0.012 * H, 0.05, f * 0.7], [0.012 * H, 0, f]],
                     lobes, count, size, base_r, stage=stage, attract=attract, step=0.42, kill=0.55 if R > 4 else 0.34, rise=0.06, wiggle=0.05, fork_lo=0.93, up=0.80,
                     outward=0.45, bark='pine', wood=wood, mid=mid, flare=(0.5, 0.6, 5), lobe_normal=0.30, lean=lean, shell=0.15, spokes=True, inner=0.4)


def scots_pine(name, seed, H, R, base_r=0.36, masses=8, lean=(0, 0), lo=0.48, stage='mature', count=130, size=0.98, wood=230, mid=59):
    """A Scots pine: a bare rusty stem, dead stubs, a few irregular cloud masses held out at angles, one at the top."""
    rng = rng_of(seed)
    lobes = []
    for k in range(masses):
        u = lo + (0.92 - lo) * (k / (masses - 1)) ** 0.9
        a = k * 2.39996 + rng.normal() * 0.35
        out = R * (0.95 - 0.75 * (u - lo) / (1 - lo)) * (0.75 + 0.4 * rng.uniform())
        rr = R * (0.46 - 0.10 * abs(u - 0.75)) * (0.85 + 0.3 * rng.uniform())
        lobes.append((math.cos(a) * out, math.sin(a) * out, H * u, rr, rr, rr * 0.48))
    lobes.append((0.05, 0, H * 0.95, R * 0.40, R * 0.40, R * 0.24))
    w = 0.05 * H
    t = broadleaf(name, 'scots-pine', 'pine', seed, [[0, 0, 0], [w * 0.5, w * 0.1, H * 0.3], [-w * 0.4, w * 0.3, H * 0.62], [w * 0.3, 0, H * 0.9]],
                  lobes, count, size, base_r, stage=stage, attract=760, step=0.38, kill=0.5, rise=0.18, wiggle=0.16, fork_lo=0.42, up=0.7,
                  outward=0.5, bark='pine', wood=wood, mid=mid, flare=(0.4, 0.6, 5), lobe_normal=0.5, lean=lean)
    for k in range(5):
        u = 0.22 + 0.06 * k
        node = int(u * 18)
        a = k * 2.2 + rng.normal()
        p = t.sk.pos[min(node, 14)]
        L = 0.45 + 0.6 * rng.uniform()
        t.sk.chain([p + np.array([math.cos(a) * L, math.sin(a) * L, 0.10 * L])], parent=min(node, 14), tag=2)
    t.r = np.concatenate([t.r, np.full(len(t.sk.pos) - len(t.r), 0.035)])
    return t


def bent_pine(name, seed, H=5.8, R=2.4):
    """A wind-bent pine for the islet and the ledges: an S of a trunk, flat pads, every pad to leeward."""
    lobes = [(1.9, 0.2, H * 0.40, 1.15, 0.95, 0.42), (-1.1, 0.5, H * 0.48, 0.95, 0.85, 0.38), (2.9, -0.4, H * 0.60, 1.25, 1.0, 0.44),
             (0.3, 1.1, H * 0.66, 1.0, 0.95, 0.40), (0.4, -1.1, H * 0.72, 1.0, 0.9, 0.40), (2.2, 0.7, H * 0.80, 1.2, 1.0, 0.44),
             (1.2, -0.3, H * 0.94, 1.2, 1.1, 0.50)]
    return broadleaf(name, 'bent-pine', 'pine', seed, [[0, 0, 0], [-0.45, 0.1, H * 0.22], [0.2, 0.1, H * 0.42], [1.1, 0, H * 0.62], [1.0, 0, H * 0.88]],
                     lobes, 130, 0.74, 0.25, stage='old', attract=560, step=0.28, kill=0.36, rise=0.05, wiggle=0.14, fork_lo=0.22, up=0.8, outward=0.4,
                     bark='pine', wood=240, mid=53, flare=(0.35, 0.9, 5), lobe_normal=0.5)


def dwarf_pine(name, seed, R=2.3, H=1.9):
    """Mountain pine, sprawled: branches along the ground that turn up at their ends."""
    rng = rng_of(seed)
    lobes = ring(rng, 6, H * 0.45, R * 0.60, R * 0.36, 0.55, 0.16) + ring(rng, 3, H * 0.70, R * 0.25, R * 0.34, 0.6, 0.14)
    return shrub(name, 'dwarf-pine', 'pine', seed, R, H, 70, 0.62, stems=6, lobes=lobes, mid=18, wood=60, bark='pine', attract=380)


def fern(name, seed, fronds=9, L=1.15, R=0.0, crowns=1):
    """A lady fern: fronds arching out of one crown (or of a few, drifted together over `R` metres)."""
    rng = rng_of(seed)
    t = Tree(name, 'fern', 'fern', None, 'brown')
    t.wood_budget = 6
    t.trunk_sides = 3
    t.mid_count = max(5, int(fronds * crowns * 0.45))
    t.sk.chain([[0, 0, 0], [0.01, 0, 0.06]], tag=0)
    t.r = np.array([0.04, 0.02])
    for q in range(crowns):
        a0 = rng.uniform(0, 6.28)
        rr = R * math.sqrt((q + 0.3) / crowns) if crowns > 1 else 0
        c0 = np.array([math.cos(q * 2.4 + a0) * rr, math.sin(q * 2.4 + a0) * rr, 0.0])
        big = 0.8 + 0.35 * rng.uniform()
        n = fronds + int(rng.randint(-1, 2))
        for k in range(n):
            a = a0 + 2 * math.pi * k / n + rng.normal() * 0.16
            inner = k % 3 == 0
            e = math.radians((58 if inner else 34) + rng.normal() * 6)
            h = np.array([math.cos(a), math.sin(a), 0.0])
            axis = unit(h * math.cos(e) + np.array([0, 0, math.sin(e)]))
            hl = L * 0.5 * big * (0.86 if inner else 1.0) * (0.9 + 0.2 * rng.uniform())
            c = c0 + axis * hl * 1.0 + np.array([0, 0, 0.04])
            t.cluster(c, axis, unit(h * 0.35 + np.array([0, 0, 1.0])), hl, hl * 1.06 / FROND_WIDE, 'fern', q)
    return t.finish(ao_density=0.16)


def bracken(name, seed, fronds=9, R=0.8, L=1.55):
    """Bracken: each frond its own stalk out of the ground, a broad triangle held up and out."""
    rng = rng_of(seed)
    t = Tree(name, 'bracken', 'fern', None, 'brown')
    t.wood_budget = 6
    t.trunk_sides = 3
    t.mid_count = max(5, int(fronds * 0.5))
    t.sk.chain([[0, 0, 0], [0.01, 0, 0.06]], tag=0)
    t.r = np.array([0.03, 0.015])
    for q in range(fronds):
        rr = R * math.sqrt((q + 0.35) / fronds)
        a0 = q * 2.39996 + rng.normal() * 0.2
        base = np.array([math.cos(a0) * rr, math.sin(a0) * rr, -0.08])
        a = a0 + rng.normal() * 0.7
        e = math.radians(64 - 16 * (rr / R) + rng.normal() * 7)
        d = np.array([math.cos(a), math.sin(a), 0.0])
        axis = unit(d * math.cos(e) + np.array([0, 0, math.sin(e)]))
        hl = L * 0.5 * (0.78 + 0.4 * rng.uniform())
        t.cluster(base + axis * hl * 0.97, axis, unit(d * 0.3 + np.array([0, 0, 1.0])), hl, hl * 0.92, 'bracken', q % 3)
    return t.finish(ao_density=0.18)


def moss_along(t, rng, at, count, size, lobe=0):
    """Cushions of moss: `at(u)` gives a place on the wood and the way out of it."""
    for k in range(count):
        p, up = at((k + rng.uniform()) / count)
        s = size * (0.7 + 0.6 * rng.uniform())
        t.cluster(p, unit(up + np.array([0.6 * rng.normal(), 0.3 * rng.normal(), 0])), up, s * 0.85, s * 1.15, 'moss', lobe)


def ferns_round(t, rng, places, hl=0.45):
    for p in places:
        a = rng.uniform(0, 6.28)
        for q in range(3):
            d = np.array([math.cos(a + q * 2.1), math.sin(a + q * 2.1), 0])
            axis = unit(d * 0.8 + np.array([0, 0, 0.6]))
            t.cluster(np.asarray(p) + axis * hl, axis, unit(d * 0.3 + np.array([0, 0, 1])), hl, hl * 1.06 / FROND_WIDE, 'fern', 1)


def log(name, seed, L=8.0, r=0.42, mosses=26, ferns=6):
    """A fallen trunk, half sunk, mossed along its back, a fern or two in its lee."""
    rng = rng_of(seed)
    t = Tree(name, 'log', 'dead', None, 'oak')
    t.lying = True
    t.wood_budget = 150
    t.trunk_sides = 8
    t.mid_count = mosses // 2 + ferns
    path = spline([[-L * 0.5, 0, -r * 1.4], [-L * 0.44, 0.02, r * 0.55], [-L * 0.1, 0.25, r * 0.62], [L * 0.25, -0.05, r * 0.5], [L * 0.5, 0.25, r * 0.12]], 14)
    ids = t.sk.chain(path, tag=0)
    for k in range(3):
        i = ids[4 + k * 3]
        a = rng.uniform(0.5, 1.4) * (1 if k % 2 else -1)
        d = unit(np.array([0.4 * rng.normal(), math.sin(a), abs(math.cos(a)) + 0.15]))
        ln = 0.45 + 0.4 * rng.uniform()
        t.sk.chain([t.sk.pos[i] + d * ln * 0.5, t.sk.pos[i] + d * (r + ln) + np.array([0.10 * rng.normal(), 0, 0])], parent=i, tag=2)
    t.r = np.full(len(t.sk.pos), 0.055)
    for i, node in enumerate(ids):
        u = i / (len(ids) - 1)
        t.r[node] = r * (1.0 - 0.45 * u) * (0.92 + 0.14 * math.sin(7 * u + seed))

    def back(u):
        u = 0.06 + 0.88 * u
        i = min(int(u * 13), 12)
        f = u * 13 - i
        p = path[i] * (1 - f) + path[i + 1] * f
        a = rng.normal() * 0.65
        up = np.array([0, math.sin(a), math.cos(a)])
        return p + up * r * (1 - 0.45 * u) * 0.86, up
    moss_along(t, rng, back, mosses, 0.40)
    ferns_round(t, rng, [[-L * 0.35 + L * 0.7 * (k + rng.uniform()) / ferns, (-1 if k % 2 else 1) * (r + 0.35), 0.05] for k in range(ferns)])
    return t.finish(ao_density=0.2)


def stump(name, seed, H=1.0, r=0.62, mosses=16, ferns=4):
    """What is left of a great one: a broken stump, mossed, ferns between its roots."""
    rng = rng_of(seed)
    t = Tree(name, 'log', 'dead', (0.9, 0.8, 5), 'oak')
    t.wood_budget = 96
    t.trunk_sides = 8
    t.mid_count = mosses // 2 + ferns
    ids = t.sk.chain([[0, 0, 0], [0.02, 0.03, H * 0.45], [0.05, 0, H * 0.85], [0.10, -0.05, H]], tag=0)
    t.r = np.array([r, r * 0.86, r * 0.80, r * 0.42])[:len(ids)]

    def skin(u):
        a = u * 6.28 * 2.6
        z = H * (0.12 + 0.95 * u)
        up = unit(np.array([math.cos(a), math.sin(a), 0.5 + 0.9 * u]))
        return np.array([math.cos(a) * r * 0.82, math.sin(a) * r * 0.82, z]), up
    moss_along(t, rng, skin, mosses, 0.34)
    ferns_round(t, rng, [[math.cos(a) * (r + 0.45), math.sin(a) * (r + 0.45), 0.04] for a in rng.uniform(0, 6.28, ferns)], hl=0.42)
    return t.finish(ao_density=0.2)


def build_all(only=None):
    """Every specimen, in the order the game numbers them."""
    P = lambda a, b: (lambda u: np.interp(u, a, b))
    makers = [
        # the Greenwood
        ('oak-great', lambda: oak_great()),
        ('oak-wide', lambda: oak_wide()),
        ('oak-tall', lambda: oak_tall()),
        ('oak-young', lambda: oak_young()),
        ('beech-tall', lambda: beech_tall()),
        ('beech-dome', lambda: beech_dome()),
        ('beech-young', lambda: beech_young()),
        ('birch-one', lambda: birch_one()),
        ('birch-clump', lambda: birch_clump()),
        ('birch-young', lambda: birch_young()),
        # the autumn side
        ('aspen-tall', lambda: aspen_tall()),
        ('aspen-broad', lambda: aspen_broad()),
        ('aspen-young', lambda: aspen_young()),
        ('maple-round', lambda: maple_round()),
        ('maple-spread', lambda: maple_spread()),
        # the blossom
        ('cherry-queen', lambda: cherry_queen()),
        ('cherry-vase', lambda: cherry_vase()),
        ('cherry-cloud', lambda: cherry_cloud()),
        ('cherry-young', lambda: cherry_young()),
        # the water
        ('willow-old', lambda: willow('willow-old', 161)),
        ('willow-round', lambda: willow('willow-round', 162, H=7.6, R=3.7, n=80)),
        # the Landfall
        ('stone-pine-old', lambda: stone_pine('stone-pine-old', 171, 15.5, 7.0, lean=(0.13, 0.04), count=270, size=1.08, base_r=0.52, stage='old', wood=320, mid=87, attract=1000, forks=9)),
        ('stone-pine-tall', lambda: stone_pine('stone-pine-tall', 172, 17.5, 5.6, lean=(-0.07, 0.03), count=215, size=1.02, base_r=0.40, forks=7, mid=71)),
        ('stone-pine-young', lambda: stone_pine('stone-pine-young', 173, 7.2, 2.8, count=112, size=0.80, base_r=0.18, forks=6, dome=0.62, stage='young', attract=700, fork_at=0.40, wood=120, mid=40)),
        # the slopes
        ('spruce-great', lambda: conifer('spruce-great', 'spruce', 'spruce', 181, 25.0, 4.7, 0.46, lo=0.06, whorls=25, per=6, stage='old', gap=0.10, dead=0.35, wood=300, mid=99)),
        ('spruce-spire', lambda: conifer('spruce-spire', 'spruce', 'spruce', 182, 21.5, 2.9, 0.33, lo=0.05, whorls=26, per=6, e_bot=-26, droop=0.22, gap=0.05, wood=220, mid=84)),
        ('spruce-broad', lambda: conifer('spruce-broad', 'spruce', 'spruce', 183, 17.0, 4.1, 0.34, lo=0.04, whorls=20, per=7, gap=0.04, wood=230, mid=84,
                                         profile=P([0, .12, .5, 1], [0.86, 1.0, 0.62, 0.04]))),
        ('spruce-young', lambda: conifer('spruce-young', 'spruce', 'spruce', 184, 6.8, 1.9, 0.13, lo=0.02, whorls=14, per=6, e_top=48, e_bot=8, droop=0.10, stage='young', wood=70, mid=24, sides=5, side=False)),
        ('fir-tall', lambda: conifer('fir-tall', 'fir', 'fir', 191, 22.0, 3.5, 0.36, lo=0.06, whorls=25, per=6, e_top=30, e_bot=2, droop=0.12, tip_up=0.14, width=0.52, gap=0.05, wood=230, mid=90,
                                     profile=P([0, .15, .6, 1], [0.80, 1.0, 0.60, 0.05]))),
        ('fir-young', lambda: conifer('fir-young', 'fir', 'fir', 192, 8.5, 2.2, 0.16, lo=0.02, whorls=15, per=6, e_top=40, e_bot=10, droop=0.06, stage='young', width=0.50, wood=80, mid=40, sides=5, side=False)),
        ('larch-tall', lambda: conifer('larch-tall', 'larch', 'larch', 201, 20.0, 3.7, 0.32, lo=0.16, whorls=20, per=5, e_top=40, e_bot=0, droop=0.16, tip_up=0.30, width=0.62, gap=0.14, len_jit=0.26, wood=220, mid=65,
                                       profile=P([0, .2, .6, 1], [0.70, 1.0, 0.66, 0.06]), wobble=0.012)),
        ('larch-old', lambda: conifer('larch-old', 'larch', 'larch', 202, 17.0, 4.6, 0.44, lo=0.22, whorls=15, per=5, e_top=32, e_bot=-4, droop=0.14, tip_up=0.34, width=0.62, gap=0.22, len_jit=0.36, dead=0.5, stage='old', wood=260, mid=62,
                                      profile=P([0, .25, .6, 1], [0.80, 1.0, 0.75, 0.20]), curve=lambda u: (1.1 * u ** 1.6, 0.3 * math.sin(2 * u)))),
        ('scots-tall', lambda: scots_pine('scots-tall', 211, 19.0, 3.9)),
        ('scots-old', lambda: scots_pine('scots-old', 212, 14.0, 5.0, base_r=0.46, masses=9, lo=0.36, lean=(0.06, -0.03), stage='old', count=150, size=1.06, wood=280, mid=65)),
        ('scots-young', lambda: scots_pine('scots-young', 213, 8.0, 2.0, base_r=0.15, masses=6, lo=0.30, stage='young', count=72, size=0.80, wood=90, mid=22)),
        ('bent-pine', lambda: bent_pine('bent-pine', 221)),
        ('dwarf-pine-a', lambda: dwarf_pine('dwarf-pine-a', 222)),
        ('dwarf-pine-b', lambda: dwarf_pine('dwarf-pine-b', 223, R=1.7, H=1.4)),
        # the dark notes
        ('cypress-tall', lambda: column('cypress-tall', 'cypress', 'cypress', 231, 16.5, 1.25, 0.24)),
        ('cypress-young', lambda: column('cypress-young', 'cypress', 'cypress', 232, 9.0, 0.90, 0.15, stage='young', levels=16, mid=20)),
        # the skirt
        ('hazel', lambda: shrub('hazel', 'hazel', 'beech', 241, 1.9, 2.9, 40, 0.80)),
        ('hawthorn', lambda: shrub('hawthorn', 'hawthorn', 'hawthorn', 242, 1.6, 2.4, 38, 0.70)),
        ('thicket', lambda: shrub('thicket', 'thicket', 'shrub', 243, 2.4, 1.7, 40, 0.74, flat=0.62)),
        ('juniper', lambda: shrub('juniper', 'juniper', 'cypress', 244, 0.9, 1.9, 24, 0.58, flat=1.2, aspect=0.8, stems=3)),
        ('snag-tall', lambda: snag('snag-tall', 251, 12.5, 0.36)),
        ('snag-stub', lambda: snag('snag-stub', 252, 5.8, 0.42, stubs=6)),
        # the forest floor
        ('fern-a', lambda: fern('fern-a', 261)),
        ('fern-b', lambda: fern('fern-b', 262, fronds=7, L=0.95)),
        ('fern-drift', lambda: fern('fern-drift', 263, fronds=7, L=1.1, R=1.9, crowns=5)),
        ('bracken-a', lambda: bracken('bracken-a', 271)),
        ('bracken-drift', lambda: bracken('bracken-drift', 272, fronds=22, R=2.3)),
        ('log-mossy', lambda: log('log-mossy', 281)),
        ('log-short', lambda: log('log-short', 282, L=4.6, r=0.34, mosses=16, ferns=4)),
        ('stump-mossy', lambda: stump('stump-mossy', 291)),
    ]
    out = []
    for name, make in makers:
        if only and name not in only:
            continue
        out.append(make())
    return out
