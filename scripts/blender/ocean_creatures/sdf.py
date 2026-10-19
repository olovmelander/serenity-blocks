"""Signed distance functions for the sea's large animals (numpy, vectorised over points P[..., 3]).

Frame: the runtime's (y up, the animal's nose toward +z). A body is a chain of ellipsoids along a
profile; a fin is a planform (its outline in its own plane, from a leading and a trailing edge)
given an airfoil's thickness, so its silhouette is exactly the outline that was drawn.

Every primitive belongs to a part and may carry where that part turns from (`pivot`), which way
its span runs and how long it is, and a fixed place along the body (`along`) for parts that ride
the body at their root (flippers) instead of at their own place on it.
"""

import math

import numpy as np


def _dot(a, b):
    return (a * b).sum(-1)


def V(*a):
    return np.array(a, dtype=float)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def sd_round_cone(P, a, b, r1, r2):
    """Exact distance to the round cone from sphere (a, r1) to sphere (b, r2) (Quilez)."""
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    x = pa * l2 - y[..., None] * ba
    x2 = _dot(x, x)
    y2 = y * y * l2
    z2 = z * z * l2
    k = math.copysign(1.0, rr) * rr * rr * x2 if rr != 0 else np.zeros_like(x2)
    d_b = np.sqrt(x2 + z2) * il2 - r2
    d_a = np.sqrt(x2 + y2) * il2 - r1
    d_m = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d_b, np.where(np.sign(y) * a2 * y2 < k, d_a, d_m))


def sd_ellipsoid(P, c, r, R):
    """Near-exact distance to an ellipsoid (centre c, radii r along the rows of R)."""
    q = (P - c) @ R.T
    k0 = np.linalg.norm(q / r, axis=-1)
    k1 = np.linalg.norm(q / (r * r), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sd_polygon(u, v, poly):
    """Signed distance in 2D from points (u, v) to a closed polygon (rows of poly); negative inside."""
    n = len(poly)
    d = (u - poly[0, 0]) ** 2 + (v - poly[0, 1]) ** 2
    s = np.ones_like(u)
    for i in range(n):
        j = i - 1
        ex, ey = poly[j, 0] - poly[i, 0], poly[j, 1] - poly[i, 1]
        wx, wy = u - poly[i, 0], v - poly[i, 1]
        ee = ex * ex + ey * ey
        t = np.clip((wx * ex + wy * ey) / max(ee, 1e-12), 0.0, 1.0)
        bx, by = wx - ex * t, wy - ey * t
        d = np.minimum(d, bx * bx + by * by)
        c1 = v >= poly[i, 1]
        c2 = v < poly[j, 1]
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


def smin(a, b, k):
    """Smooth union (polynomial, blend width k)."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def frame(main, hint):
    """Rows: the main axis, then two axes square to it (the second as near `hint` as it can be)."""
    u = unit(main)
    h = np.asarray(hint, float)
    v = h - u * (h @ u)
    if np.linalg.norm(v) < 1e-6:
        v = np.cross(u, (0.0, 0.0, 1.0) if abs(u[2]) < 0.9 else (1.0, 0.0, 0.0))
    v = v / np.linalg.norm(v)
    w = np.cross(u, v)
    return np.stack([u, v, w])


IDENTITY = np.eye(3)


def airfoil(x):
    """A symmetric section's half-thickness at chord fraction x (0 leading edge, 1 trailing), peak 1."""
    x = np.clip(x, 0.0, 1.0)
    t = 0.2969 * np.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4
    return t / 0.1500


class Prim:
    """One primitive of the field: its shape, its part, how it joins (add, sub, cut) and how softly.

    meta: pivot (where the part turns from), span (its unit direction) and reach (its length) for
    parts that move about a root; along (a fixed place on the body); side (-1, 0, 1).
    """

    def __init__(self, kind, part, k=0.0, op='add', meta=None, **params):
        self.kind = kind
        self.part = part
        self.k = k
        self.op = op
        self.meta = meta or {}
        self.p = params
        if kind == 'fin':
            self._fin_prepare()

    # ── fins ──

    def _fin_prepare(self):
        p = self.p
        us = np.asarray(p['us'], float)
        lead = np.asarray(p['lead'], float)
        trail = np.asarray(p['trail'], float)
        r = p.get('round', 0.0)
        # The outline, shrunk by the rounding radius (added back as distance).
        poly = np.concatenate([np.stack([us, lead + r], 1), np.stack([us[::-1], trail[::-1] - r], 1)])
        self.poly = poly
        self.us, self.lead, self.trail = us, lead, trail

    def _fin(self, P):
        p = self.p
        q = (P - p['o']) @ p['R'].T
        u, v, w = q[..., 0], q[..., 1], q[..., 2]
        bow = p.get('bow')
        if bow is not None:
            w = w - np.interp(u, self.us, bow)
        d2 = sd_polygon(u, v, self.poly)
        lead = np.interp(u, self.us, self.lead)
        trail = np.interp(u, self.us, self.trail)
        x = (v - lead) / np.maximum(trail - lead, 1e-6)
        thick = np.interp(u, self.us, np.asarray(p['thick'], float))
        r = p.get('round', 0.0)
        t = np.maximum(thick * airfoil(x) - r, p.get('tmin', 0.003) - r)
        dz = np.abs(w) - t
        inside = np.minimum(np.maximum(d2, dz), 0.0)
        outside = np.hypot(np.maximum(d2, 0.0), np.maximum(dz, 0.0))
        return inside + outside - r

    def sdf(self, P):
        p = self.p
        if self.kind == 'cone':
            return sd_round_cone(P, p['a'], p['b'], p['r1'], p['r2'])
        if self.kind == 'ell':
            return sd_ellipsoid(P, p['c'], p['r'], p.get('R', IDENTITY))
        if self.kind == 'fin':
            return self._fin(P)
        if self.kind == 'plane':  # the half-space on the far side of (o, n) is outside
            return (P - p['o']) @ p['n']
        raise ValueError(self.kind)

    def aabb(self):
        p = self.p
        if self.kind == 'cone':
            lo = np.minimum(p['a'] - p['r1'], p['b'] - p['r2'])
            hi = np.maximum(p['a'] + p['r1'], p['b'] + p['r2'])
            return lo, hi
        if self.kind == 'ell':
            m = float(np.max(p['r']))
            return p['c'] - m, p['c'] + m
        if self.kind == 'fin':
            R = p['R']
            tmax = float(np.max(p['thick'])) + 0.01
            bow = p.get('bow')
            bmin = float(np.min(bow)) if bow is not None else 0.0
            bmax = float(np.max(bow)) if bow is not None else 0.0
            corners = []
            for u in (self.us.min(), self.us.max()):
                for v in (min(self.lead.min(), self.trail.min()), max(self.lead.max(), self.trail.max())):
                    for w in (bmin - tmax, bmax + tmax):
                        corners.append(p['o'] + R[0] * u + R[1] * v + R[2] * w)
            c = np.array(corners)
            return c.min(0), c.max(0)
        if self.kind == 'plane':
            return np.asarray(p['lo'], float), np.asarray(p['hi'], float)
        raise ValueError(self.kind)


# ── Helpers that make primitives ──


def pchip(xs, ys, x):
    """Monotone cubic through (xs, ys) at x (Fritsch-Carlson): no overshoot between rows."""
    xs = np.asarray(xs, float)
    ys = np.asarray(ys, float)
    x = np.asarray(x, float)
    h = np.diff(xs)
    delta = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0], m[-1] = delta[0], delta[-1]
    for i in range(1, len(xs) - 1):
        if delta[i - 1] * delta[i] <= 0:
            m[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])
    i = np.clip(np.searchsorted(xs, x) - 1, 0, len(xs) - 2)
    t = (x - xs[i]) / h[i]
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
            + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])


def body_chain(rows, nose=0.5, length=1.0, step=0.012, part='body', k=0.012, squash=None):
    """A body along z from a profile: rows of (s, half width, half height, centre height), s 0 at
    the nose. Ellipsoids at `step`, each twice as long as the step, so the chain reads as one
    smooth body. `squash(s)` may flatten the back (a lower top) -> scale on the half height above."""
    rows = np.asarray(rows, float)
    s0, s1 = rows[0, 0], rows[-1, 0]
    n = int(math.ceil((s1 - s0) * length / step)) + 1
    ss = np.linspace(s0, s1, n)
    hw = pchip(rows[:, 0], rows[:, 1], ss)
    hh = pchip(rows[:, 0], rows[:, 2], ss)
    yc = pchip(rows[:, 0], rows[:, 3], ss)
    prims = []
    for i, s in enumerate(ss):
        L = max(step * 1.6, 0.6 * min(hw[i], hh[i]))
        c = V(0.0, yc[i], nose - s * length)
        prims.append(Prim('ell', part, k=k, c=c, r=V(max(hw[i], 0.002), max(hh[i], 0.002), L)))
    return prims


def planform(span, chord_root, chord_tip, sweep=0.0, n=24, tip_round=0.18, lead_wave=None, trail_wave=None,
             trail_bulge=0.0, tip_power=1.0):
    """Leading and trailing edges (v, increasing toward the back) of a fin along its span u 0..span.

    The chord narrows from root to tip (`tip_power` shapes the taper), the leading edge sweeps
    back by `sweep` at the tip (quadratically), the tip is rounded over its last `tip_round` of
    span; `lead_wave(f)` / `trail_wave(f)` add bumps (f = u / span); `trail_bulge` bows the
    trailing edge back mid-span."""
    us = np.linspace(0.0, span, n)
    f = us / span
    chord = chord_root + (chord_tip - chord_root) * f ** tip_power
    lead = sweep * f * f
    if tip_round > 0:
        g = np.clip((f - (1 - tip_round)) / tip_round, 0.0, 1.0)
        round_ = np.sqrt(np.maximum(1 - g * g, 0.0))
        mid = lead + chord * 0.45
        lead = mid - (mid - lead) * round_
        trail = mid + (lead + chord - mid) * round_
        trail = np.where(g > 0, trail, lead + chord)
    else:
        trail = lead + chord
    trail = trail + trail_bulge * np.sin(np.pi * f) * (1 - f)
    if lead_wave is not None:
        lead = lead + lead_wave(f)
    if trail_wave is not None:
        trail = trail + trail_wave(f)
    return us, lead, trail


def fin(part, root, span_dir, chord_hint, us, lead, trail, thick, k=0.01, tmin=0.003, rnd=0.0015,
        bow=None, side=0, along=None, pivot=None, op='add'):
    """A fin from its root along `span_dir`, its chord running toward `chord_hint` (squared up)."""
    R = frame(span_dir, chord_hint)
    meta = {
        'pivot': np.asarray(pivot if pivot is not None else root, float),
        'span': R[0], 'reach': float(np.max(us)), 'side': side,
    }
    if along is not None:
        meta['along'] = along
    return Prim('fin', part, k=k, op=op, meta=meta, o=np.asarray(root, float), R=R, us=us, lead=lead,
                trail=trail, thick=np.broadcast_to(np.asarray(thick, float), np.shape(us)).copy(),
                tmin=tmin, round=rnd, bow=bow)


def mirror(prim):
    """The same primitive on the other side (x -> -x)."""
    M = np.diag([-1.0, 1.0, 1.0])
    p = dict(prim.p)
    meta = dict(prim.meta)
    if prim.kind == 'cone':
        p['a'] = p['a'] @ M
        p['b'] = p['b'] @ M
    elif prim.kind == 'ell':
        p['c'] = p['c'] @ M
        if 'R' in p:
            p['R'] = p['R'] @ M
    elif prim.kind == 'fin':
        p['o'] = p['o'] @ M
        R = p['R'] @ M
        # (Keep the frame right-handed: the normal axis flips with the mirror.)
        R[2] = -R[2]
        p['R'] = R
        if p.get('bow') is not None:
            p['bow'] = -np.asarray(p['bow'])
    if 'pivot' in meta:
        meta['pivot'] = meta['pivot'] @ M
    if 'span' in meta:
        meta['span'] = meta['span'] @ M
    meta['side'] = -meta.get('side', 0)
    out = Prim(prim.kind, prim.part, k=prim.k, op=prim.op, meta=meta, **p)
    return out


# ── The field on a grid ──


class Grid:
    def __init__(self, lo, hi, voxel):
        self.lo = np.asarray(lo, float)
        self.voxel = voxel
        self.n = (np.ceil((np.asarray(hi, float) - self.lo) / voxel).astype(int) + 1)
        self.d = np.full(tuple(self.n), 0.2, np.float32)

    def apply(self, pr):
        lo, hi = pr.aabb()
        m = max(pr.k, 0.0) + 4 * self.voxel
        i0 = np.maximum(np.floor((lo - m - self.lo) / self.voxel).astype(int), 0)
        i1 = np.minimum(np.ceil((hi + m - self.lo) / self.voxel).astype(int) + 1, self.n)
        if np.any(i1 <= i0):
            return
        ax = [self.lo[i] + np.arange(i0[i], i1[i]) * self.voxel for i in range(3)]
        X, Y, Z = np.meshgrid(*ax, indexing='ij')
        P = np.stack([X, Y, Z], -1)
        x = pr.sdf(P)
        sl = (slice(i0[0], i1[0]), slice(i0[1], i1[1]), slice(i0[2], i1[2]))
        cur = self.d[sl].astype(np.float64)
        if pr.op == 'add':
            cur = smin(cur, x, pr.k)
        elif pr.op == 'sub':
            cur = smax(cur, -x, pr.k)
        else:
            cur = smax(cur, x, pr.k)
        self.d[sl] = cur.astype(np.float32)


def bounds(prims, margin=0.02):
    los, his = zip(*(p.aabb() for p in prims if p.op == 'add'))
    return np.min(los, 0) - margin, np.max(his, 0) + margin


def field_at(prims, P, far=0.2):
    """The field at arbitrary points (the same ops in the same order as the grid)."""
    d = np.full(len(P), far)
    for pr in prims:
        lo, hi = pr.aabb()
        m = max(pr.k, 0.0) + 0.02
        sel = np.all((P >= lo - m) & (P <= hi + m), axis=1)
        if not np.any(sel):
            continue
        x = pr.sdf(P[sel])
        cur = d[sel]
        if pr.op == 'add':
            cur = smin(cur, x, pr.k)
        elif pr.op == 'sub':
            cur = smax(cur, -x, pr.k)
        else:
            cur = smax(cur, x, pr.k)
        d[sel] = cur
    return d


def gradient(prims, P, e=0.0015):
    g = np.zeros_like(P)
    for i in range(3):
        o = np.zeros(3)
        o[i] = e
        g[:, i] = field_at(prims, P + o) - field_at(prims, P - o)
    n = np.linalg.norm(g, axis=1, keepdims=True)
    return g / np.maximum(n, 1e-9)


def surface(prims, voxel, log=print, name='shape', adaptivity=0.0):
    """Mesh the field: (vertices (n, 3), faces: a list of quads and triangles).

    `adaptivity` > 0 lets openvdb merge voxels where the surface is flat (fewer, larger faces
    there), which spares the decimator from collapsing broad flat flanks into folds."""
    import openvdb as vdb
    lo, hi = bounds(prims)
    grid = Grid(lo, hi, voxel)
    for pr in prims:
        grid.apply(pr)
    log(f'{name} field: {grid.n.tolist()} voxels of {voxel}')
    g = vdb.FloatGrid(0.2)
    g.copyFromArray(grid.d)
    if adaptivity > 0:
        pts, tris, quads = g.convertToPolygons(isovalue=0.0, adaptivity=adaptivity)
        faces = [list(map(int, f)) for f in np.asarray(quads)] + [list(map(int, f)) for f in np.asarray(tris)]
    else:
        pts, quads = g.convertToQuads(isovalue=0.0)
        faces = np.asarray(quads, int).tolist()
    verts = lo + np.asarray(pts, float) * voxel
    return verts, faces


def ambient(prims, P, N, reach=0.05, steps=5):
    """Ambient occlusion from the field: how far the field falls short of open water along the normal."""
    occ = np.zeros(len(P))
    total = 0.0
    for i in range(1, steps + 1):
        h = reach * i / steps
        w = 0.5 ** (i - 1)
        d = field_at(prims, P + N * h)
        occ += w * np.clip((h - d) / h, 0.0, 1.0)
        total += w
    return np.clip(1.0 - 1.4 * occ / total, 0.0, 1.0)


def nearest_parts(prims, P):
    """For each point: the index of the nearest 'add' primitive by |distance|."""
    best = np.full(len(P), 1e3)
    idx = np.full(len(P), -1, int)
    for i, pr in enumerate(prims):
        if pr.op != 'add':
            continue
        lo, hi = pr.aabb()
        m = 0.03
        sel = np.all((P >= lo - m) & (P <= hi + m), axis=1)
        if not np.any(sel):
            continue
        d = np.abs(pr.sdf(P[sel]))
        cur = best[sel]
        closer = d < cur
        where = np.nonzero(sel)[0][closer]
        best[where] = d[closer]
        idx[where] = i
    return idx, best
