"""
Growing a tree's wood (Odyssey's forest, 2026-11-24).

Two growers, both deterministic, both pure numpy (no bpy), in metres with z up:

  colonize()   broadleaves, stone and Scots pines: the crown is drawn first, as a cloud of points
               inside an envelope of lobes, and the wood grows toward the points until it has reached
               them all (space colonisation). The limbs fork where the light is, so no two trees branch
               alike and every fork has a reason.
  whorls()     spruces, firs, larches: a leader, and branches leaving it in irregular whorls, each with
               its own length, droop and upturned tip.

A skeleton is (pos (N,3), parent (N,), radius (N,)); node 0 is the foot of the trunk.
"""

import math

import numpy as np


def rng_of(seed):
    return np.random.RandomState(seed & 0x7FFFFFFF)


def unit(v, axis=-1):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v, axis=axis, keepdims=True)
    return v / np.where(n < 1e-9, 1.0, n)


def spline(points, n):
    """A Catmull-Rom curve through `points`, n samples, ends included."""
    p = np.asarray(points, dtype=float)
    if len(p) == 2:
        t = np.linspace(0, 1, n)[:, None]
        return p[0] * (1 - t) + p[1] * t
    ext = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    segs = len(p) - 1
    for k in range(n):
        u = (k / (n - 1)) * segs
        i = min(int(u), segs - 1)
        t = u - i
        a, b, c, d = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                          + (-a + 3 * b - 3 * c + d) * t ** 3))
    return np.array(out)


class Skeleton:
    def __init__(self):
        self.pos = []
        self.parent = []
        self.tag = []          # 0 trunk, 1 branch, 2 twig carrying no foliage (a dead stub)

    def add(self, p, parent, tag=1):
        self.pos.append(np.asarray(p, dtype=float))
        self.parent.append(parent)
        self.tag.append(tag)
        return len(self.pos) - 1

    def chain(self, points, parent=-1, tag=1):
        ids = []
        for p in points:
            parent = self.add(p, parent, tag)
            ids.append(parent)
        return ids

    def arrays(self):
        return np.array(self.pos), np.array(self.parent, dtype=int), np.array(self.tag, dtype=int)

    def children(self):
        kids = [[] for _ in self.pos]
        for i, p in enumerate(self.parent):
            if p >= 0:
                kids[p].append(i)
        return kids


def lobe_points(lobes, count, rng, shell=0.45):
    """Points inside a union of ellipsoid lobes (x, y, z, rx, ry, rz), more of them near the skin:
    `shell` is the inner radius share the points are kept out of for half of them."""
    vol = np.array([l[3] * l[4] * l[5] for l in lobes]) ** 0.75
    vol = vol / vol.sum()
    pts = []
    ids = []
    for li, l in enumerate(lobes):
        n = max(6, int(round(count * vol[li])))
        d = unit(rng.normal(size=(n, 3)))
        u = rng.uniform(size=n)
        r = np.where(rng.uniform(size=n) < 0.5, u ** (1 / 3), (shell ** 3 + (1 - shell ** 3) * u) ** (1 / 3))
        p = np.array(l[:3]) + d * r[:, None] * np.array(l[3:6])
        # A lobe's underside is flat: foliage gathers on top of the wood that carries it.
        low = np.array(l[:3])[2] - l[5] * 0.55
        p[:, 2] = np.where(p[:, 2] < low, low + (p[:, 2] - low) * 0.35, p[:, 2])
        pts.append(p)
        ids.append(np.full(n, li))
    return np.vstack(pts), np.concatenate(ids)


def colonize(sk, attract, step=0.45, infl=6.0, kill=0.9, iters=160, tropism=(0, 0, 0.06), keep=0.4,
             rng=None, wander=0.12, max_nodes=4000):
    """Grow `sk` toward the attractor points. `keep` is how much a shoot keeps its own heading."""
    rng = rng or rng_of(1)
    A = np.asarray(attract, dtype=float)
    P = np.array(sk.pos)
    heading = np.zeros_like(P)
    for i, par in enumerate(sk.parent):
        heading[i] = unit(P[i] - P[par]) if par >= 0 else np.array([0, 0, 1.0])
    d = np.linalg.norm(A[:, None, :] - P[None, :, :], axis=2)
    best = d.argmin(axis=1)
    bestd = d.min(axis=1)
    alive = bestd > kill * 0.5
    tropism = np.asarray(tropism, dtype=float)
    grew_from = {}
    for _ in range(iters):
        live = np.nonzero(alive & (bestd < infl))[0]
        if len(live) == 0:
            far = np.nonzero(alive)[0]
            if len(far) == 0:
                break
            live = far[np.argsort(bestd[far])[:max(1, len(far) // 12)]]
        new_pos = []
        new_parent = []
        for node in np.unique(best[live]):
            mine = live[best[live] == node]
            pull = unit(A[mine] - P[node]).sum(axis=0)
            if np.linalg.norm(pull) < 1e-3:
                pull = rng.normal(size=3)
            dirv = unit(unit(pull) + keep * heading[node] + tropism + wander * rng.normal(size=3))
            key = (int(node), tuple(np.round(dirv, 2)))
            if grew_from.get(key, 0) >= 1:
                dirv = unit(dirv + 0.6 * rng.normal(size=3))
            grew_from[key] = grew_from.get(key, 0) + 1
            new_pos.append(P[node] + dirv * step)
            new_parent.append(int(node))
        if not new_pos:
            break
        first = len(sk.pos)
        for p, par in zip(new_pos, new_parent):
            sk.add(p, par, 1)
        np_new = np.array(new_pos)
        P = np.vstack([P, np_new])
        heading = np.vstack([heading, unit(np_new - P[np.array(new_parent)])])
        dn = np.linalg.norm(A[:, None, :] - np_new[None, :, :], axis=2)
        nb = dn.argmin(axis=1)
        nd = dn.min(axis=1)
        closer = nd < bestd
        best = np.where(closer, first + nb, best)
        bestd = np.where(closer, nd, bestd)
        alive &= bestd > kill
        if len(sk.pos) > max_nodes:
            break
    return sk


def smooth(sk, rounds=2, amount=0.35, hold=1):
    """Ease the kinks along the wood (never moves the foot)."""
    pos, parent, _ = sk.arrays()
    kids = sk.children()
    for _ in range(rounds):
        new = pos.copy()
        for i in range(hold, len(pos)):
            if parent[i] < 0 or not kids[i]:
                continue
            mean = (pos[parent[i]] + pos[kids[i]].mean(axis=0)) / 2
            new[i] = pos[i] * (1 - amount) + mean * amount
        pos = new
    sk.pos = [p for p in pos]
    return sk


def radii(sk, tip=0.03, power=2.35, base=None, taper_floor=0.02, taper=0.028):
    """The pipe model: a limb carries the wood of everything it bears."""
    pos, parent, tag = sk.arrays()
    kids = sk.children()
    n = len(pos)
    r = np.zeros(n)
    for i in range(n - 1, -1, -1):
        if not kids[i]:
            r[i] = tip
        else:
            seg = np.linalg.norm(pos[kids[i]] - pos[i], axis=1).max()
            r[i] = (np.sum(r[kids[i]] ** power)) ** (1 / power) * (1 + taper * seg)
    if base is not None and r[0] > 1e-6:
        # Scale the trunk to its authored girth, and the twigs by less, so fine ends stay fine.
        k = base / r[0]
        t = np.clip((r - tip) / max(r[0] - tip, 1e-6), 0, 1)
        r = r * (1 + (k - 1) * (0.35 + 0.65 * t))
    # A branch is never thicker than 0.85 of the wood it leaves, so a fork reads as one.
    for i in range(1, n):
        if parent[i] >= 0:
            r[i] = min(r[i], r[parent[i]])
    return np.maximum(r, taper_floor)


def tips(sk):
    kids = sk.children()
    return np.array([i for i in range(len(sk.pos)) if not kids[i] and sk.tag[i] != 2], dtype=int)


def chains(sk, r):
    """Split the wood into chains root to tip: at a fork the thickest child carries the limb on."""
    kids = sk.children()
    pos = np.array(sk.pos)
    out = []
    stack = [(0, None)]
    while stack:
        start, origin = stack.pop()
        chain = [] if origin is None else [origin]
        node = start
        while True:
            chain.append(node)
            k = kids[node]
            if not k:
                break
            k = sorted(k, key=lambda c: -r[c])
            for other in k[1:]:
                stack.append((other, node))
            if len(chain) > 1:
                # A limb that doubles back is another limb (a tube round so sharp a turn folds on itself).
                # (Judged over a few nodes: a twig can come round in easy steps.)
                came = pos[node] - pos[chain[max(0, len(chain) - 5)]]
                goes = pos[k[0]] - pos[node]
                if came @ goes < 0.15 * np.linalg.norm(came) * np.linalg.norm(goes):
                    stack.append((k[0], node))
                    break
            node = k[0]
        out.append(chain)
    return out


def simplify(pts, rad, tol):
    """Ramer-Douglas-Peucker on a chain, the radius carried along."""
    if len(pts) <= 2:
        return list(range(len(pts)))
    a, b = pts[0], pts[-1]
    ab = b - a
    L = np.linalg.norm(ab)
    if L < 1e-6:
        dist = np.linalg.norm(pts - a, axis=1)
    else:
        t = np.clip(((pts - a) @ ab) / (L * L), 0, 1)
        dist = np.linalg.norm(pts - (a + t[:, None] * ab), axis=1)
    t = np.linspace(0, 1, len(pts))
    dist = dist + np.abs(rad - (rad[0] * (1 - t) + rad[-1] * t)) * 0.6
    k = int(dist.argmax())
    if dist[k] < tol or k in (0, len(pts) - 1):
        return [0, len(pts) - 1]
    left = simplify(pts[:k + 1], rad[:k + 1], tol)
    right = simplify(pts[k:], rad[k:], tol)
    return left[:-1] + [k + i for i in right]


def tube(pts, rad, sides, flare=None, seed=0, cap=False):
    """
    A tube along `pts`: rings turned without twist (parallel transport), CCW outward.
    `flare` (height, gain, lobes) widens the foot into root buttresses.
    Returns (verts, normals, (round 0..1..0, along in m), tris).
    """
    pts = np.asarray(pts, dtype=float)
    n = len(pts)
    tang = np.zeros_like(pts)
    tang[1:-1] = pts[2:] - pts[:-2]
    tang[0] = pts[1] - pts[0]
    tang[-1] = pts[-1] - pts[-2]
    tang = unit(tang)
    ref = np.array([1.0, 0, 0]) if abs(tang[0][0]) < 0.9 else np.array([0, 1.0, 0])
    u = unit(ref - tang[0] * (ref @ tang[0]))
    rng = rng_of(seed + 77)
    phase = rng.uniform(0, 2 * math.pi)
    verts = []
    norms = []
    along = []
    dist = 0.0
    for i in range(n):
        if i:
            dist += np.linalg.norm(pts[i] - pts[i - 1])
            u = unit(u - tang[i] * (u @ tang[i]))
        v = np.cross(tang[i], u)
        for s in range(sides):
            a = 2 * math.pi * s / sides
            r = rad[i]
            if flare is not None:
                h = max(0.0, pts[i][2])
                k = math.exp(-h / flare[0])
                r *= 1 + flare[1] * k * (0.62 + 0.38 * math.cos(a * flare[2] + phase))
            o = u * math.cos(a) + v * math.sin(a)
            verts.append(pts[i] + o * r)
            norms.append(o)
            along.append((abs(2.0 * s / sides - 1.0), dist))
    tris = []
    for i in range(n - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            a, b = i * sides + s, i * sides + s2
            c, d = (i + 1) * sides + s, (i + 1) * sides + s2
            tris.append((a, b, d))
            tris.append((a, d, c))
    if cap:
        verts.append(pts[-1])
        norms.append(tang[-1])
        along.append((0.5, dist))
        top = len(verts) - 1
        for s in range(sides):
            tris.append(((n - 1) * sides + s, (n - 1) * sides + (s + 1) % sides, top))
    return np.array(verts), np.array(norms), np.array(along), np.array(tris, dtype=int)


def wood_mesh(sk, r, budget, trunk_sides=8, flare=None, tol=0.12, min_r=0.0, seed=0):
    """
    The wood as one mesh inside a triangle budget: the thickest chains first, each simplified, with
    fewer sides the thinner it is. Returns (verts, normals, along, tris, radius per vertex).
    """
    pos = np.array(sk.pos)
    parts = []
    used = 0
    cs = chains(sk, r)
    # The trunk first, then by the wood they carry (girth times length).
    def weight(c):
        p = pos[c]
        return float(np.sum(np.linalg.norm(p[1:] - p[:-1], axis=1) * r[c][1:] ** 1.2))
    order = [cs[0]] + sorted(cs[1:], key=weight, reverse=True)
    for ci, c in enumerate(order):
        c = np.array(c)
        rr = r[c].copy()
        if ci and len(c) > 1:
            rr[0] = min(rr[0], rr[1] * 1.25)
        keepn = rr >= min_r
        if ci and keepn.sum() < 2:
            continue
        if ci:
            last = int(np.nonzero(keepn)[0][-1]) + 1
            c = c[:max(2, last)]
            rr = rr[:max(2, last)]
        idx = simplify(pos[c], rr, tol * (1.0 if ci == 0 else 1.6))
        if len(idx) < 2:
            continue
        sides = trunk_sides if ci == 0 else (6 if rr[0] > 0.22 else 5 if rr[0] > 0.12 else 4 if rr[0] > 0.06 else 3)
        cost = (len(idx) - 1) * sides * 2
        if used + cost > budget and ci:
            # Too dear as it is: try it as one straight piece.
            idx = [0, len(c) - 1]
            sides = 3
            cost = 6
            if used + cost > budget:
                continue
        rad = rr[idx].copy()
        rad[-1] = min(rad[-1], rad[0] * 0.45) if ci else rad[-1] * 0.6
        v, nn, al, tr = tube(pos[c][idx], rad, sides, flare if ci == 0 else None, seed + ci)
        parts.append((v, nn, al, tr, np.repeat(rad, sides)))
        used += cost
    verts = []
    norms = []
    along = []
    tris = []
    rads = []
    base = 0
    for v, nn, al, tr, rd in parts:
        verts.append(v)
        norms.append(nn)
        along.append(al)
        tris.append(tr + base)
        rads.append(rd)
        base += len(v)
    return np.vstack(verts), np.vstack(norms), np.vstack(along), np.vstack(tris), np.concatenate(rads)


def farthest_points(points, count, weight=None, rng=None):
    """Pick `count` of the points, spread as evenly as they go (farthest point sampling)."""
    p = np.asarray(points, dtype=float)
    n = len(p)
    if n <= count:
        return np.arange(n)
    w = np.ones(n) if weight is None else np.asarray(weight, dtype=float)
    first = int(np.argmax(w * (1 + 0.001 * p[:, 2])))
    chosen = [first]
    d = np.linalg.norm(p - p[first], axis=1)
    for _ in range(count - 1):
        k = int(np.argmax(d * w))
        chosen.append(k)
        d = np.minimum(d, np.linalg.norm(p - p[k], axis=1))
    return np.array(chosen)


def sky_visibility(centres, sizes, density=0.55, rays=96, seed=5, ground=True):
    """
    How much of the sky each foliage cluster sees through the others (0..1), cosine weighted about
    straight up, with a share to the sides. Each cluster is a soft ball; a ray through it loses light
    by the length of its chord.
    """
    rng = rng_of(seed)
    C = np.asarray(centres, dtype=float)
    R = np.asarray(sizes, dtype=float)
    u = rng.uniform(size=rays)
    phi = np.arange(rays) * 2.39996323
    z = np.sqrt(1 - 0.94 * u)
    s = np.sqrt(np.maximum(0, 1 - z * z))
    D = np.stack([s * np.cos(phi), s * np.sin(phi), z], axis=1)
    out = np.zeros(len(C))
    for i in range(len(C)):
        rel = C - C[i]
        tca = rel @ D.T                                   # (n, rays)
        d2 = np.sum(rel * rel, axis=1)[:, None] - tca * tca
        rr = (R * 0.85)[:, None] ** 2
        half = np.sqrt(np.maximum(0, rr - d2))
        chord = np.maximum(0, tca + half) - np.maximum(0, tca - half)
        chord[i] = R[i] * 0.35
        tau = (chord / np.maximum(R[:, None], 1e-3)).sum(axis=0) * density
        out[i] = np.mean(np.exp(-tau))
    return out
