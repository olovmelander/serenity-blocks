"""The troll's shape, built from numbers: one signed distance field, meshed once.

He is drawn as smooth masses blended into each other (an old, heavy body; a big head carried low
and forward; a long drooping nose under a heavy brow; long ears; big hands and feet) under a mane
of matted locks that fall from his crown over his back to his knees, a moss beard, a wrapped
loincloth and a few small mushrooms growing in his moss. The masses follow the 21-bone skeleton in
rigs.TROLL, in its rest pose, so the runtime's body (stillwater-troll-body.js) poses him as before.

Every primitive belongs to a part (skin, hide, pelt, leather, eye, cap), so each vertex of the
mesh can be told what it is from the nearest part. The locks are draped: each falls from its root
under gravity and is pushed out of the body (and the locks before it), so the mane lies on him.

Frame: Blender's (Z up, he faces -Y, +X is his LEFT), one unit tall, soles at -0.5.
"""

import math

import numpy as np

# ── Distance functions (vectorised over points P[..., 3]) ──


def _dot(a, b):
    return (a * b).sum(-1)


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
    u = np.asarray(main, float)
    u = u / np.linalg.norm(u)
    h = np.asarray(hint, float)
    v = h - u * (h @ u)
    if np.linalg.norm(v) < 1e-6:
        v = np.cross(u, (0.0, 0.0, 1.0) if abs(u[2]) < 0.9 else (1.0, 0.0, 0.0))
    v = v / np.linalg.norm(v)
    w = np.cross(u, v)
    return np.stack([u, v, w])


IDENTITY = np.eye(3)


class Prim:
    """One primitive of the field: its shape, its part, how it joins (add, sub, cut) and how softly."""

    def __init__(self, kind, part, k=0.0, op='add', tag=None, **params):
        self.kind = kind
        self.part = part
        self.k = k
        self.op = op
        self.tag = tag or {}
        self.p = params

    def sdf(self, P):
        p = self.p
        if self.kind == 'cone':
            return sd_round_cone(P, p['a'], p['b'], p['r1'], p['r2'])
        if self.kind == 'ell':
            return sd_ellipsoid(P, p['c'], p['r'], p['R'])
        if self.kind == 'plane':  # the half-space below z = h is outside
            return p['h'] - P[..., 2]
        if self.kind == 'wrap':
            return _sd_wrap(P, **p)
        if self.kind == 'cap':  # an ellipsoid above a tilted plane (moss over his scalp)
            e = sd_ellipsoid(P, p['c'], p['r'], IDENTITY)
            return smax(e, -((P - p['o']) @ p['n']), 0.01)
        raise ValueError(self.kind)

    def aabb(self):
        p = self.p
        if self.kind == 'cone':
            lo = np.minimum(p['a'] - p['r1'], p['b'] - p['r2'])
            hi = np.maximum(p['a'] + p['r1'], p['b'] + p['r2'])
            return lo, hi
        if self.kind in ('ell', 'cap'):
            m = float(np.max(p['r']))
            return p['c'] - m, p['c'] + m
        if self.kind == 'plane':
            return np.asarray(p['lo'], float), np.asarray(p['hi'], float)
        if self.kind == 'wrap':
            ax, ay = p['ax'][1], p['ay'][1]
            return (np.array([-ax - 0.03, p['y0'] - ay - 0.03, p['hem'] - 0.05]),
                    np.array([ax + 0.03, p['y0'] + ay + 0.03, p['top'] + 0.03]))
        raise ValueError(self.kind)


def _sd_wrap(P, y0, ax, ay, top, hem, tabs, tab, thick, belt):
    """A wrap round his hips: an elliptic band from `top` down to a hem cut in soft tabs, and a belt."""
    x, y, z = P[..., 0], P[..., 1] - y0, P[..., 2]
    t = np.clip((top - z) / (top - hem), 0.0, 1.0)
    rx = ax[0] + (ax[1] - ax[0]) * t
    ry = ay[0] + (ay[1] - ay[0]) * t
    rho = np.sqrt((x / rx) ** 2 + (y / ry) ** 2)
    shell = np.abs(rho - 1.0) * np.minimum(rx, ry) - thick
    theta = np.arctan2(x, -y)
    hem_z = hem + tab * np.abs(np.sin(tabs * theta * 0.5)) ** 0.7
    band = np.maximum(shell, np.maximum(z - top, hem_z - z))
    brx, bry = ax[0] + 0.004, ay[0] + 0.004
    brho = np.sqrt((x / brx) ** 2 + (y / bry) ** 2)
    ring = np.sqrt(((brho - 1.0) * min(brx, bry)) ** 2 + (z - top) ** 2) - belt
    return np.minimum(band, ring)


def V(*a):
    return np.array(a, dtype=float)


# ── The skeleton's rest (rigs.TROLL heads), for building along the bones ──

from .rigs import TROLL  # noqa: E402


def J(name, end='head'):
    _, head, tail = TROLL[name]
    return V(*(head if end == 'head' else tail))


# ── The design ──

#: The parts a vertex can be.
PARTS = ('skin', 'hide', 'pelt', 'leather', 'eye', 'cap')


def _limb_hand(prims, side, curl, rng):
    """A big hand: a heavy palm, three thick fingers and a thumb, curled by `curl` (0 open, 1 fist)."""
    s = 1.0 if side == 'L' else -1.0
    W = J('hand' + side)
    tip = J('hand' + side, 'tail')
    h = (tip - W) / np.linalg.norm(tip - W)
    # The palm faces his body (its thickness runs across him); the back of the hand faces out.
    across = V(s, 0, 0)
    R = frame(h, across)  # rows: along the hand, toward the back of the hand (out), and its width
    out, width = R[1], R[2]
    palm_c = W + h * 0.06
    prims.append(Prim('ell', 'hide', 0.018, c=palm_c, r=V(0.058, 0.027, 0.048), R=R))
    prims.append(Prim('cone', 'hide', 0.02, a=W - h * 0.01, b=palm_c, r1=0.038, r2=0.04))
    palm_side = -out  # the way the fingers curl
    for i, off in enumerate((-0.03, 0.0, 0.03)):
        base = W + h * 0.1 + width * off + out * 0.004
        length = (0.05, 0.056, 0.048)[i]
        a1 = 0.35 * curl + 0.05 * rng.standard_normal()
        d1 = h * math.cos(a1) + palm_side * math.sin(a1)
        m = base + d1 * length
        a2 = a1 + 0.6 * curl + 0.2
        d2 = h * math.cos(a2) + palm_side * math.sin(a2)
        t2 = m + d2 * length * 0.8
        prims.append(Prim('cone', 'hide', 0.01, a=base, b=m, r1=0.019, r2=0.016))
        prims.append(Prim('cone', 'hide', 0.006, a=m, b=t2, r1=0.016, r2=0.0125))
    # The thumb: from the heel of the hand on its leading edge (the front of a hanging hand, the
    # top of one held out), toward the palm.
    lead = width * math.copysign(1.0, float(width @ (V(0, -1, 0) if side == 'L' else V(0, 0, 1))))
    tb = W + h * 0.035 + lead * 0.03 + palm_side * 0.01
    t_dir = h * 0.6 + palm_side * 0.35 + lead * 0.5
    t_dir /= np.linalg.norm(t_dir)
    tm = tb + t_dir * 0.035
    t2 = h * 0.8 + palm_side * (0.3 + 0.5 * curl) + lead * 0.1
    tt = tm + t2 / np.linalg.norm(t2) * 0.032
    prims.append(Prim('cone', 'hide', 0.012, a=tb, b=tm, r1=0.02, r2=0.017))
    prims.append(Prim('cone', 'hide', 0.006, a=tm, b=tt, r1=0.017, r2=0.013))


def _limb_foot(prims, side, rng):
    """A big flat foot: a heel, a broad ball, four stubby toes; the sole cut flat later."""
    s = 1.0 if side == 'L' else -1.0
    A = J('foot' + side)
    ball = J('toe' + side)
    toe_tip = J('toe' + side, 'tail')
    heel = V(A[0], A[1] + 0.035, -0.468)
    prims.append(Prim('ell', 'hide', 0.02, c=heel, r=V(0.05, 0.055, 0.038), R=IDENTITY))
    prims.append(Prim('cone', 'hide', 0.03, a=V(A[0], A[1] - 0.01, -0.462), b=V(ball[0], ball[1] + 0.03, -0.47),
                      r1=0.052, r2=0.056))
    prims.append(Prim('cone', 'hide', 0.025, a=A + V(0, 0.005, 0.0), b=V(A[0], A[1] - 0.03, -0.46), r1=0.05, r2=0.05))
    fwd = toe_tip - ball
    fwd[2] = 0.0
    fwd /= np.linalg.norm(fwd)
    for i, off in enumerate((-0.045, -0.015, 0.016, 0.044)):
        # (The big toe on the inside of the foot.)
        big = 1.0 if (i == 0) else 0.0
        r = 0.026 if big else 0.021 - 0.002 * abs(off) / 0.045
        root = V(ball[0] + s * off, ball[1] + 0.0, -0.475)
        length = (0.085 if big else 0.07 - 0.02 * abs(off) / 0.045) + 0.005 * rng.standard_normal()
        tip = root + fwd * length + V(0, 0, -0.008)
        prims.append(Prim('cone', 'hide', 0.012, a=root, b=tip, r1=r, r2=r * 0.85))


def body_prims(rng):
    """His body: torso, head, face, ears, arms, hands, legs, feet (no hair yet)."""
    P = []
    # Torso: a heavy pelvis, a round belly carried forward, a deep chest, a hunched upper back.
    P.append(Prim('ell', 'hide', 0.0, c=V(0, 0.015, -0.2), r=V(0.172, 0.15, 0.1), R=IDENTITY))
    P.append(Prim('ell', 'hide', 0.05, c=V(0, -0.05, -0.105), r=V(0.183, 0.188, 0.15), R=IDENTITY))
    P.append(Prim('ell', 'hide', 0.05, c=V(0, 0.005, 0.03), r=V(0.178, 0.148, 0.12), R=IDENTITY))
    P.append(Prim('ell', 'hide', 0.06, c=V(0, 0.07, 0.07), r=V(0.155, 0.13, 0.115), R=IDENTITY))
    for s in (1, -1):
        P.append(Prim('ell', 'hide', 0.045, c=V(0.158 * s, -0.045, 0.092), r=V(0.08, 0.072, 0.066), R=IDENTITY))
    P.append(Prim('cone', 'hide', 0.05, a=V(0, -0.03, 0.11), b=V(0, -0.12, 0.215), r1=0.088, r2=0.072))
    # The head: carried low and forward; the brow heavy, the jowls wide, the nose long and drooping.
    P.append(Prim('ell', 'skin', 0.04, c=V(0, -0.15, 0.335), r=V(0.112, 0.112, 0.118), R=IDENTITY))
    P.append(Prim('ell', 'skin', 0.04, c=V(0, -0.195, 0.255), r=V(0.118, 0.1, 0.082), R=IDENTITY))
    P.append(Prim('cone', 'skin', 0.03, a=V(-0.07, -0.252, 0.332), b=V(0.07, -0.252, 0.332), r1=0.03, r2=0.03))
    # Cheeks under the eyes.
    for s in (1, -1):
        P.append(Prim('ell', 'skin', 0.025, c=V(0.06 * s, -0.255, 0.268), r=V(0.042, 0.032, 0.035), R=IDENTITY))
    # The nose: a bridge from the brow, swelling to a big drooping tip.
    P.append(Prim('cone', 'skin', 0.02, a=V(0, -0.268, 0.318), b=V(0, -0.33, 0.255), r1=0.027, r2=0.036))
    P.append(Prim('ell', 'skin', 0.02, c=V(0, -0.348, 0.226), r=V(0.044, 0.042, 0.05),
                  R=frame(V(0, -0.35, -0.94), V(1, 0, 0))))
    for s in (1, -1):  # the wings of the nose
        P.append(Prim('ell', 'skin', 0.012, c=V(0.03 * s, -0.33, 0.205), r=V(0.02, 0.022, 0.018), R=IDENTITY))
    # A wide upper lip under it, and a lower lip (the beard hides the rest).
    P.append(Prim('cone', 'skin', 0.02, a=V(-0.05, -0.286, 0.193), b=V(0.05, -0.286, 0.193), r1=0.02, r2=0.02))
    # Ears: long, pointed, held out to the sides and drooping a little.
    for s in (1, -1):
        root = V(0.1 * s, -0.152, 0.322)
        tip = V(0.268 * s, -0.108, 0.278)
        axis = tip - root
        R = frame(axis, V(0, 0, 1))
        for t in (0.08, 0.28, 0.5, 0.7, 0.9):
            c = root + axis * t + V(0, 0, 0.012 * math.sin(math.pi * t))
            along = 0.052 * (1.0 - 0.45 * t)
            tall = 0.05 * (1.0 - t) ** 0.85 + 0.006
            thin = 0.016 * (1.0 - 0.55 * t) + 0.003
            P.append(Prim('ell', 'skin', 0.022, c=c, r=V(along, tall, thin), R=R))
    # Arms: thick, long, a heavy forearm.
    for side, s in (('L', 1), ('R', -1)):
        S, E, W = J('upper' + side), J('fore' + side), J('hand' + side)
        P.append(Prim('cone', 'hide', 0.035, a=S + V(-0.012 * s, 0, 0), b=E, r1=0.064, r2=0.047))
        P.append(Prim('cone', 'hide', 0.02, a=E, b=W, r1=0.047, r2=0.037))
        P.append(Prim('cone', 'hide', 0.025, a=E + (W - E) * 0.12, b=E + (W - E) * 0.55, r1=0.056, r2=0.05))
        _limb_hand(P, side, 0.55 if side == 'L' else 0.3, rng)
    # Legs: short and heavy.
    for side, s in (('L', 1), ('R', -1)):
        H, K, A = J('thigh' + side), J('shin' + side), J('foot' + side)
        P.append(Prim('cone', 'hide', 0.045, a=H + V(-0.01 * s, 0, 0.02), b=K, r1=0.09, r2=0.064))
        P.append(Prim('cone', 'hide', 0.02, a=K, b=A, r1=0.062, r2=0.046))
        P.append(Prim('ell', 'hide', 0.03, c=K + (A - K) * 0.32 + V(0, 0.022, 0), r=V(0.052, 0.056, 0.058), R=IDENTITY))
        _limb_foot(P, side, rng)
    return P


def face_cuts():
    """Eye sockets and nostrils (taken out), then the eyes and their heavy lids (put back)."""
    P = []
    for s in (1, -1):
        P.append(Prim('ell', 'skin', 0.01, op='sub', c=V(0.05 * s, -0.266, 0.302), r=V(0.025, 0.013, 0.021), R=IDENTITY))
        P.append(Prim('ell', 'skin', 0.006, op='sub', c=V(0.019 * s, -0.37, 0.188), r=V(0.011, 0.012, 0.008), R=IDENTITY))
    for s in (1, -1):
        P.append(Prim('ell', 'eye', 0.002, c=V(0.05 * s, -0.262, 0.3), r=V(0.0185, 0.016, 0.0175), R=IDENTITY))
        # The lid: half over the eye, heavy and kind; a softer one under it.
        P.append(Prim('cone', 'skin', 0.006, a=V(0.031 * s, -0.27, 0.3145), b=V(0.069 * s, -0.266, 0.3115),
                      r1=0.0118, r2=0.011))
        P.append(Prim('cone', 'skin', 0.006, a=V(0.034 * s, -0.272, 0.2835), b=V(0.066 * s, -0.268, 0.2855),
                      r1=0.0072, r2=0.0068))
    return P


def sole_cut():
    return [Prim('plane', 'hide', 0.01, op='cut', h=-0.5, lo=V(-0.4, -0.45, -0.53), hi=V(0.4, 0.42, -0.455))]


def wrap_prims():
    """A loincloth of bark-cloth wrapped round his hips, hem in soft tabs, with a rope belt."""
    return [Prim('wrap', 'leather', 0.006, y0=-0.03, ax=(0.198, 0.222), ay=(0.2, 0.192), top=-0.165, hem=-0.305,
                 tabs=7, tab=0.028, thick=0.0105, belt=0.0155)]


# ── The mane ──


def field_at(prims, P):
    """The field of `prims` at points P (no windows: for small point sets)."""
    d = np.full(P.shape[:-1], 1.0)
    flat = P.reshape(-1, 3)
    plo, phi = flat.min(0), flat.max(0)
    for pr in prims:
        lo, hi = pr.aabb()
        m = max(pr.k, 0.0) + 0.06
        if np.any(lo - m > phi) or np.any(hi + m < plo):
            continue
        x = pr.sdf(P)
        if pr.op == 'add':
            d = smin(d, x, pr.k)
        elif pr.op == 'sub':
            d = smax(d, -x, pr.k)
        else:
            d = smax(d, x, pr.k)
    return d


def _grad(prims, P, e=0.002):
    g = np.zeros_like(P)
    for i in range(3):
        dv = np.zeros(3)
        dv[i] = e
        g[..., i] = (field_at(prims, P + dv) - field_at(prims, P - dv)) / (2 * e)
    n = np.linalg.norm(g, axis=-1, keepdims=True)
    return g / np.maximum(n, 1e-9)


def drape(prims, roots, dirs, lengths, r0, r1, rng, flare=None, seg=0.018, wave=0.005, rest=0.75, hug=0.0):
    """Hang locks from their roots: each falls under gravity, bends out of the body and lies on it.

    roots, dirs: (n, 3); lengths: (n,); r0, r1: radius at root and tip (arrays or numbers).
    `flare(p)` gives a push outward (away from his middle) that grows down the lock; `hug` draws a
    lock that has fallen away from him back toward him (a share of the gap each step).
    Returns a list of polylines with radii: [(points (m, 3), radii (m,))].
    """
    n = len(roots)
    r0 = np.broadcast_to(np.asarray(r0, float), (n,))
    r1 = np.broadcast_to(np.asarray(r1, float), (n,))
    steps = np.maximum(3, np.ceil(lengths / seg).astype(int))
    m = int(steps.max())
    pts = [roots.copy()]
    d = dirs / np.linalg.norm(dirs, axis=1, keepdims=True)
    p = roots.copy()
    phase = rng.uniform(0, math.tau, n)
    side = np.cross(d, np.array([0.0, 0.0, 1.0]))
    side /= np.maximum(np.linalg.norm(side, axis=1, keepdims=True), 1e-6)
    for i in range(1, m + 1):
        t = np.minimum(i / steps, 1.0)
        grav = np.array([0.0, 0.0, -1.0])
        bend = 0.35 + 0.4 * np.minimum(i / 4.0, 1.0)
        d = d * (1 - bend)[..., None] if np.ndim(bend) else d * (1 - bend)
        d = d + grav * bend
        if flare is not None:
            d = d + flare(p) * t[:, None]
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        q = p + d * seg
        # A slow sideways wave down each lock (amplitude about `wave`).
        kk = math.tau / 0.24
        q = q + side * (wave * kk * seg * np.cos(phase + kk * i * seg))[:, None]
        r = r0 + (r1 - r0) * t
        if hug > 0:
            gap = field_at(prims, q) - r * rest - 0.004
            pull = np.clip(gap, 0.0, 0.03) * hug
            q = q - _grad(prims, q) * pull[:, None]
        for _ in range(4):
            s = field_at(prims, q) - r * rest
            push = np.minimum(s, 0.0)
            if not np.any(push < 0):
                break
            q = q - _grad(prims, q) * push[:, None]
        done = (i > steps)
        q[done] = p[done]
        p = q
        pts.append(p.copy())
    out = []
    for k in range(n):
        line = np.array([pts[i][k] for i in range(steps[k] + 1)])
        t = np.linspace(0.0, 1.0, len(line))
        # Taper: full at the root, thinning to a rounded tip.
        radii = r0[k] + (r1[k] - r0[k]) * t ** 1.8
        out.append((line, radii))
    return out


def lock_prims(lines, part='pelt', k=0.008, tag=None):
    P = []
    for line, radii in lines:
        for i in range(len(line) - 1):
            a, b = line[i], line[i + 1]
            if np.linalg.norm(b - a) < 1e-5:
                continue
            ra, rb = radii[i], radii[i + 1]
            # (A round cone needs |ra - rb| < its length.)
            L = np.linalg.norm(b - a)
            if abs(ra - rb) >= L * 0.95:
                rb = ra - math.copysign(L * 0.9, ra - rb)
            P.append(Prim('cone', part, k, a=a, b=b, r1=ra, r2=rb, tag=dict(tag or {})))
    return P


HEAD_C = V(0, -0.15, 0.335)
HEAD_R = V(0.112, 0.112, 0.118)


def _on_head(alpha, beta, lift=0.0):
    """A point on his head (alpha from the top, beta round from the back of his head toward his left)."""
    a, b = math.radians(alpha), math.radians(beta)
    d = V(math.sin(a) * math.sin(b), math.sin(a) * math.cos(b), math.cos(a))
    return HEAD_C + d * (HEAD_R + lift), d


def mane_prims(body, rng, log=print):
    """The locks: crown, fringe, a cloak of two rows from his shoulders and back, and a beard."""
    tone = {}
    out = []
    lid = [0]

    def add(lines, group, k, base_tone):
        for line in lines:
            lid[0] += 1
            t = float(np.clip(base_tone + 0.18 * rng.standard_normal(), 0.0, 0.62))
            tone[lid[0]] = t
            out.extend(lock_prims([line], k=k, tag={'lock': lid[0], 'tone': t, 'group': group}))

    def flare_from(cy):
        def f(p):
            v = p.copy()
            v[:, 2] = 0.0
            v[:, 1] -= cy
            n = np.linalg.norm(v, axis=1, keepdims=True)
            return v / np.maximum(n, 1e-6) * 0.18
        return f

    # Moss over his scalp, from a hairline over his brow down to the nape: the locks grow out of it.
    hair_n = V(0, 0.42, 1.0)
    hair_n /= np.linalg.norm(hair_n)
    out.append(Prim('cap', 'pelt', 0.012, c=HEAD_C + V(0, 0.004, 0.004), r=HEAD_R + V(0.007, 0.009, 0.008),
                    o=V(0, -0.15, 0.372), n=hair_n, tag={'lock': 0, 'tone': 0.3, 'group': 'crown'}))
    obstacles = list(body) + out
    # The mantle first (it lies on his shoulders and back), then the crown over it. Its roots are
    # found on a yoke round the base of his neck, coming down onto him from above and outside.
    neck = V(0, -0.02, 0.17)

    def yoke_root(beta, ring, dz):
        bb = math.radians(beta)
        out_d = V(math.sin(bb), math.cos(bb), 0.0)
        start = neck + out_d * 0.5 + V(0, 0, 0.32)
        goal = neck + out_d * ring + V(0, 0, dz)
        d = goal - start
        d /= np.linalg.norm(d)
        q = start.copy()
        for _ in range(160):
            s = field_at(obstacles, q[None])[0]
            if s < 0.004:
                break
            q = q - d * -min(max(s, 0.003), 0.02)
        return q, out_d

    roots, dirs, lens, r0s = [], [], [], []
    for ring, dz, betas, length, rr in (
            (0.075, 0.07, np.linspace(-84, 84, 14), 0.66, 0.029),
            (0.18, -0.01, np.linspace(-70, 70, 11), 0.54, 0.028),
    ):
        for b in betas:
            b = b + rng.uniform(-3, 3)
            q, out_d = yoke_root(b, ring, dz)
            roots.append(q)
            dirs.append(out_d * 0.4 + V(0, 0, -1.0))
            lens.append(length * (1.0 - 0.55 * (abs(b) / 84.0) ** 2) * rng.uniform(0.9, 1.08))
            r0s.append(rr * rng.uniform(0.92, 1.08))
    # A row lower on his back fills in under them.
    for b in np.linspace(-68, 68, 10):
        bb = math.radians(b + rng.uniform(-3, 3))
        d = V(math.sin(bb), math.cos(bb), 0.0)
        q = V(0, 0.02, 0.0) + d * 0.45
        for _ in range(120):
            s = field_at(obstacles, q[None])[0]
            if s < 0.004:
                break
            q = q - d * min(max(s, 0.003), 0.02)
        roots.append(q)
        dirs.append(d * 0.5 + V(0, 0, -1))
        lens.append(0.36 * rng.uniform(0.9, 1.1))
        r0s.append(0.027)
    lines = drape(obstacles, np.array(roots), np.array(dirs), np.array(lens), np.array(r0s), np.array(r0s) * 0.22, rng,
                  flare=flare_from(0.02), wave=0.004, hug=0.7)
    add(lines, 'cloak', 0.022, 0.28)
    obstacles = list(body) + out
    # The crown: rows of locks from the top and back of his head falling over the back of it.
    roots, dirs, lens, r0s = [], [], [], []
    for alpha, betas, length, rr in (
            (12, (-75, -25, 25, 75, 180), 0.42, 0.027),
            (38, np.linspace(-110, 110, 12), 0.42, 0.028),
            (68, np.linspace(-100, 100, 10), 0.5, 0.027),
            (95, np.linspace(-66, 66, 7), 0.46, 0.026),
    ):
        for b in betas:
            if alpha == 12 and b == 180:
                continue
            p, n = _on_head(alpha, b + rng.uniform(-4, 4), lift=0.0)
            roots.append(p)
            back = V(0, 1, 0)
            dirs.append(n * 0.6 + back * 0.8 + V(0, 0, -0.2))
            side = abs(b) / 110.0
            lens.append(length * (1.0 - 0.35 * side) * rng.uniform(0.9, 1.1))
            r0s.append(rr)
    lines = drape(obstacles, np.array(roots), np.array(dirs), np.array(lens), np.array(r0s), np.array(r0s) * 0.24, rng,
                  flare=flare_from(0.0), wave=0.004, hug=0.6)
    add(lines, 'crown', 0.02, 0.35)
    obstacles = list(body) + out
    # Bushy moss brows over his eyes, swept out to the sides and up a little at their ends.
    lines = []
    for sx in (1, -1):
        for x, y, z, ln, r in ((0.016, -0.282, 0.336, 0.075, 0.016), (0.03, -0.277, 0.346, 0.07, 0.014)):
            t = np.linspace(0.0, 1.0, 8)
            pts = np.stack([sx * (x + ln * t), y + 0.03 * t ** 1.5, z + 0.012 * np.sin(math.pi * t * 0.8) - 0.004 * t], 1)
            lines.append((pts, r * (1.0 - 0.55 * t ** 1.4)))
    add(lines, 'fringe', 0.008, 0.45)
    # The beard: moss from his jaw, falling over his chest.
    roots, dirs, lens = [], [], []
    for phi in (-62, -38, -14, 12, 36, 60):
        f = math.radians(phi + rng.uniform(-4, 4))
        root = V(0.085 * math.sin(f), -0.2 - 0.075 * math.cos(f), 0.205 + 0.02 * abs(math.sin(f)))
        roots.append(root)
        dirs.append(V(0.2 * math.sin(f), -0.35, -1))
        lens.append((0.2 - 0.06 * abs(math.sin(f))) * rng.uniform(0.9, 1.1))
    lines = drape(body, np.array(roots), np.array(dirs), np.array(lens), 0.027, 0.012, rng, wave=0.007, rest=0.7)
    add(lines, 'beard', 0.009, 0.42)
    log(f'mane: {lid[0]} locks, {len(out)} segments')
    return out


def mushrooms(prims, rng):
    """Small caps growing in his moss (they glow faintly in the runtime and wake with the chain)."""
    P = []
    spots = ((V(0.15, 0.06, 0.17), 3), (V(0.04, 0.22, 0.02), 2), (V(-0.13, 0.11, 0.15), 2))
    for guess, count in spots:
        n0 = guess - V(0, 0.02, 0.0)
        n0 /= np.linalg.norm(n0)
        n0 = n0 * 0.6 + V(0, 0, 0.5)
        n0 /= np.linalg.norm(n0)
        for i in range(count):
            jitter = V(*rng.uniform(-0.03, 0.03, 3))
            start = guess + jitter + n0 * 0.25
            q = start.copy()
            for _ in range(120):
                s = field_at(prims, q[None])[0]
                if s < 0.002:
                    break
                q = q - n0 * min(max(s, 0.002), 0.02)
            nrm = _grad(prims, q[None])[0]
            up = nrm * 0.5 + V(0, 0, 0.5)
            up /= np.linalg.norm(up)
            size = (0.017, 0.012, 0.009)[i % 3] * rng.uniform(0.9, 1.15)
            stem_top = q + up * size * 1.4
            P.append(Prim('cone', 'cap', 0.004, a=q - up * 0.004, b=stem_top, r1=size * 0.32, r2=size * 0.28))
            P.append(Prim('ell', 'cap', 0.003, c=stem_top, r=V(size * 0.55, size, size), R=frame(up, V(1, 0, 0))))
    return P


def design(seed=11, log=print):
    """Every primitive of him, in the order the field is built."""
    rng = np.random.default_rng(seed)
    body = body_prims(rng)
    cuts = face_cuts()
    wrap = wrap_prims()
    solid = body + cuts
    mane = mane_prims(solid + wrap, rng, log=log)
    caps = mushrooms(solid + mane, rng)
    return body + cuts + mane + wrap + caps + sole_cut()


# ── The field on a grid, and its surface ──


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


def surface(prims, voxel=0.003, log=print):
    """Mesh the field: (vertices (n, 3), quads (m, 4)) in the unit frame."""
    import openvdb as vdb
    lo, hi = V(-0.4, -0.46, -0.52), V(0.4, 0.44, 0.56)
    grid = Grid(lo, hi, voxel)
    for pr in prims:
        grid.apply(pr)
    log(f'troll field: {grid.n.tolist()} voxels of {voxel}')
    g = vdb.FloatGrid(0.2)
    g.copyFromArray(grid.d)
    pts, quads = g.convertToQuads(isovalue=0.0)
    verts = lo + np.asarray(pts, float) * voxel
    return verts, np.asarray(quads, int)


def parts_at(prims, P, soft=0.006):
    """What each point is: soft shares of each part (n, len(PARTS)), the nearest lock's tone and group."""
    n = len(P)
    best = {name: np.full(n, 1e3) for name in PARTS}
    lock_d = np.full(n, 1e3)
    lock_tone = np.zeros(n)
    lock_group = np.full(n, '', dtype=object)
    for pr in prims:
        if pr.op != 'add':
            continue
        lo, hi = pr.aabb()
        m = 0.03
        sel = np.all((P >= lo - m) & (P <= hi + m), axis=1)
        if not np.any(sel):
            continue
        # (Distance to the part's surface: a carved socket lies inside the head, at its eye.)
        d = np.abs(pr.sdf(P[sel]))
        cur = best[pr.part][sel]
        best[pr.part][sel] = np.minimum(cur, d)
        if pr.part == 'pelt':
            ld = lock_d[sel]
            closer = d < ld
            idx = np.nonzero(sel)[0][closer]
            lock_d[idx] = d[closer]
            lock_tone[idx] = pr.tag.get('tone', 0.3)
            lock_group[idx] = pr.tag.get('group', '')
    D = np.stack([best[name] for name in PARTS], 1)
    dmin = D.min(1, keepdims=True)
    W = np.exp(-(D - dmin) / soft)
    W /= W.sum(1, keepdims=True)
    return W, lock_tone, lock_group
