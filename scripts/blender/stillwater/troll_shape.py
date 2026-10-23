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


#: Where the staff runs through his left fist, in the hand's own frame (model units from the
#: wrist): along the hand, and off the palm on its inside (the runtime's FIST,
#: stillwater-troll-body.js); and the staff's radius there (its 4.6 cm over his 2.9 m).
FIST_ALONG = 0.085
FIST_OFF = 0.046
STAFF_R = 0.0158


def _fist(prims, W, h, out, lead):
    """The fingers and thumb of his left hand closed round the staff: the fingers from their
    knuckles over the front of it and round under it, their nails outward; the thumb from the heel
    of his hand round the other way and over his first finger. (The staff runs along `lead`, the
    thumb's side toward its top.)"""
    inward = -out
    C = W + h * FIST_ALONG + inward * FIST_OFF

    def on(theta, rad, axial):
        return C + (h * math.cos(theta) + inward * math.sin(theta)) * rad + lead * axial

    def radial(theta):
        return h * math.cos(theta) + inward * math.sin(theta)

    ring = STAFF_R + 0.0185
    # First finger (by the thumb), middle, last: a little shorter and curled a little tighter each.
    # (Each a little apart from the next, so the grooves between them show.)
    for axial, r0, tighten in ((0.038, 0.0205, 0.0), (0.0, 0.0205, 0.06), (-0.037, 0.019, 0.14)):
        base = W + h * 0.104 + lead * axial + out * 0.004
        # The knuckle stands out on the back of a closed hand.
        prims.append(Prim('ell', 'hide', 0.008, c=base + out * 0.018 + h * 0.004, r=V(0.018, 0.013, 0.017),
                          R=frame(h, out)))
        th = (0.15 + tighten, 1.55 + tighten, 2.3 + tighten)
        m1 = on(th[0], ring, axial)
        m2 = on(th[1], ring, axial)
        tip = on(th[2], ring * 0.96, axial)
        prims.append(Prim('cone', 'hide', 0.007, a=base, b=m1, r1=r0, r2=r0 * 0.84))
        prims.append(Prim('ell', 'hide', 0.005, c=m1 + radial(th[0]) * 0.004, r=V(0.0165, 0.0155, 0.0165), R=IDENTITY))
        prims.append(Prim('cone', 'hide', 0.006, a=m1, b=m2, r1=r0 * 0.84, r2=r0 * 0.72))
        prims.append(Prim('ell', 'hide', 0.005, c=m2 + radial(th[1]) * 0.003, r=V(0.0155, 0.0145, 0.0155), R=IDENTITY))
        prims.append(Prim('cone', 'hide', 0.005, a=m2, b=tip, r1=r0 * 0.72, r2=r0 * 0.6))
        d3 = (tip - m2) / np.linalg.norm(tip - m2)
        n3 = radial(th[2])
        n3 = n3 - d3 * (n3 @ d3)
        n3 /= np.linalg.norm(n3)
        prims.append(Prim('ell', 'leather', 0.003, c=tip - d3 * 0.005 + n3 * 0.0085, r=V(0.012, 0.0055, 0.0105),
                          R=frame(d3, n3)))
    # The thumb: from the heel of his hand round the staff's near side and over his first finger.
    tb = W + h * 0.035 + lead * 0.03 - out * 0.008
    t1 = on(math.radians(178), 0.043, 0.05)
    t2 = on(math.radians(122), 0.047, 0.046)
    tt = on(math.radians(80), 0.051, 0.038)
    prims.append(Prim('cone', 'hide', 0.012, a=tb, b=t1, r1=0.024, r2=0.02))
    prims.append(Prim('cone', 'hide', 0.006, a=t1, b=t2, r1=0.02, r2=0.0175))
    prims.append(Prim('cone', 'hide', 0.005, a=t2, b=tt, r1=0.0175, r2=0.0145))
    d3 = (tt - t2) / np.linalg.norm(tt - t2)
    n3 = radial(math.radians(80))
    n3 = n3 - d3 * (n3 @ d3)
    n3 /= np.linalg.norm(n3)
    prims.append(Prim('ell', 'leather', 0.003, c=tt - d3 * 0.005 + n3 * 0.0085, r=V(0.012, 0.0055, 0.011),
                      R=frame(d3, n3)))


def grip_cut():
    """The way through his left fist the staff takes (taken out, so the fist closes on nothing)."""
    W = J('handL')
    h = (J('handL', 'tail') - W) / np.linalg.norm(J('handL', 'tail') - W)
    out = frame(h, V(1, 0, 0))[1]
    width = frame(h, V(1, 0, 0))[2]
    lead = width * math.copysign(1.0, float(width @ V(0, -1, 0)))
    C = W + h * FIST_ALONG - out * FIST_OFF
    return [Prim('cone', 'hide', 0.004, op='sub', a=C - lead * 0.09, b=C + lead * 0.09, r1=STAFF_R, r2=STAFF_R)]


def _limb_hand(prims, side, curl, rng):
    """A big hand: a heavy palm with knuckles, three thick fingers and a thumb, each ending in a
    nail of dark horn, curled by `curl` (0 open, 1 fist; None: closed round his staff)."""
    s = 1.0 if side == 'L' else -1.0
    W = J('hand' + side)
    tip = J('hand' + side, 'tail')
    h = (tip - W) / np.linalg.norm(tip - W)
    # The palm faces his body (its thickness runs across him); the back of the hand faces out.
    across = V(s, 0, 0)
    R = frame(h, across)  # rows: along the hand, toward the back of the hand (out), and its width
    out, width = R[1], R[2]
    palm_c = W + h * 0.062
    prims.append(Prim('ell', 'hide', 0.02, c=palm_c, r=V(0.064, 0.031, 0.054), R=R))
    prims.append(Prim('cone', 'hide', 0.02, a=W - h * 0.012, b=palm_c, r1=0.044, r2=0.044))
    # A fleshy heel of the hand under the thumb.
    prims.append(Prim('ell', 'hide', 0.016, c=W + h * 0.04 - out * 0.016, r=V(0.034, 0.02, 0.03), R=R))
    palm_side = -out  # the way the fingers curl
    if curl is None:
        lead = width * math.copysign(1.0, float(width @ V(0, -1, 0)))
        _fist(prims, W, h, out, lead)
        return
    for i, off in enumerate((-0.032, 0.0, 0.032)):
        base = W + h * 0.104 + width * off + out * 0.004
        length = (0.054, 0.06, 0.052)[i]
        # The knuckle: a knob on the back of the hand where the finger begins.
        prims.append(Prim('ell', 'hide', 0.008, c=base + out * 0.016, r=V(0.017, 0.012, 0.016), R=R))
        a1 = 0.35 * curl + 0.05 * rng.standard_normal()
        d1 = h * math.cos(a1) + palm_side * math.sin(a1)
        m = base + d1 * length
        a2 = a1 + 0.6 * curl + 0.2
        d2 = h * math.cos(a2) + palm_side * math.sin(a2)
        t2 = m + d2 * length * 0.8
        prims.append(Prim('cone', 'hide', 0.01, a=base, b=m, r1=0.022, r2=0.0185))
        prims.append(Prim('ell', 'hide', 0.006, c=m + out * 0.004, r=V(0.017, 0.016, 0.017), R=R))
        prims.append(Prim('cone', 'hide', 0.006, a=m, b=t2, r1=0.0185, r2=0.014))
        # A thick nail of dark horn on the back of the last joint.
        nail_out = np.cross(d2, width)
        nail_out = nail_out * math.copysign(1.0, float(nail_out @ out))
        prims.append(Prim('ell', 'leather', 0.003, c=t2 - d2 * 0.006 + nail_out * 0.009,
                          r=V(0.013, 0.006, 0.011), R=frame(d2, nail_out)))
    # The thumb: from the heel of the hand on its leading edge (the front of a hanging hand, the
    # top of one held out), toward the palm.
    lead = width * math.copysign(1.0, float(width @ (V(0, -1, 0) if side == 'L' else V(0, 0, 1))))
    tb = W + h * 0.035 + lead * 0.03 + palm_side * 0.01
    t_dir = h * 0.6 + palm_side * 0.35 + lead * 0.5
    t_dir /= np.linalg.norm(t_dir)
    tm = tb + t_dir * 0.035
    t2 = h * 0.8 + palm_side * (0.3 + 0.5 * curl) + lead * 0.1
    tt = tm + t2 / np.linalg.norm(t2) * 0.032
    prims.append(Prim('cone', 'hide', 0.012, a=tb, b=tm, r1=0.023, r2=0.019))
    prims.append(Prim('cone', 'hide', 0.006, a=tm, b=tt, r1=0.019, r2=0.0145))
    t3 = tt - tm
    t3 /= np.linalg.norm(t3)
    tn = np.cross(t3, width)
    tn = tn * math.copysign(1.0, float(tn @ out))
    prims.append(Prim('ell', 'leather', 0.003, c=tt - t3 * 0.005 + tn * 0.009, r=V(0.012, 0.0055, 0.011),
                      R=frame(t3, tn)))


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
        prims.append(Prim('ell', 'leather', 0.003, c=tip + V(0, 0, r * 0.55) - fwd * 0.004,
                          r=V(r * 0.7, r * 0.75, r * 0.32), R=frame(fwd, V(1, 0, 0))))


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
    # An old man's chest, sagging over his belly, and a navel in it.
    for s in (1, -1):
        P.append(Prim('ell', 'hide', 0.04, c=V(0.075 * s, -0.128, 0.055), r=V(0.064, 0.036, 0.048), R=IDENTITY))
    P.append(Prim('ell', 'hide', 0.008, op='sub', c=V(0.0, -0.238, -0.092), r=V(0.011, 0.012, 0.014), R=IDENTITY))
    # A hump of old muscle over his shoulders and the top of his back (his head hangs before it).
    P.append(Prim('ell', 'hide', 0.06, c=V(0, 0.06, 0.15), r=V(0.15, 0.09, 0.07),
                  R=frame(V(1, 0, 0), V(0, 0.3, 1))))
    for s in (1, -1):
        # The slope from his neck to each shoulder (the trapezius), heavy.
        P.append(Prim('cone', 'hide', 0.04, a=V(0.03 * s, -0.02, 0.17), b=V(0.15 * s, -0.06, 0.12), r1=0.06, r2=0.05))
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
    # Heavy jowls either side of his mouth.
    for s in (1, -1):
        P.append(Prim('ell', 'skin', 0.03, c=V(0.075 * s, -0.235, 0.215), r=V(0.045, 0.04, 0.05), R=IDENTITY))
    # Warts: on his nose, by it, on a cheek, on his brow (set on his skin: see warts()).
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
    # Arms: long and heavy: a round shoulder, a thick upper arm, a knob of an elbow, a forearm that
    # swells toward the elbow (a troll's are bigger than his upper arms) and a thick wrist.
    for side, s in (('L', 1), ('R', -1)):
        S, E, W = J('upper' + side), J('fore' + side), J('hand' + side)
        up = (E - S) / np.linalg.norm(E - S)
        fore = (W - E) / np.linalg.norm(W - E)
        P.append(Prim('ell', 'hide', 0.04, c=S + V(0.012 * s, 0, 0.012) + up * 0.02, r=V(0.072, 0.07, 0.066),
                      R=IDENTITY))
        P.append(Prim('cone', 'hide', 0.035, a=S + V(-0.012 * s, 0, 0), b=E, r1=0.07, r2=0.05))
        P.append(Prim('ell', 'hide', 0.03, c=S + (E - S) * 0.45 + V(0, -0.012, 0), r=V(0.062, 0.05, 0.058),
                      R=frame(up, V(0, -1, 0))))
        # The elbow's knob, behind.
        back = np.cross(up, V(s, 0, 0))
        back = back * math.copysign(1.0, float(back @ V(0, 1, 0)))
        P.append(Prim('ell', 'hide', 0.014, c=E + back * 0.028, r=V(0.03, 0.026, 0.03), R=IDENTITY))
        P.append(Prim('cone', 'hide', 0.02, a=E, b=W, r1=0.05, r2=0.043))
        P.append(Prim('cone', 'hide', 0.03, a=E + fore * 0.03, b=E + (W - E) * 0.6, r1=0.066, r2=0.054))
        _limb_hand(P, side, None if side == 'L' else 0.3, rng)
    # Legs: short and heavy.
    for side, s in (('L', 1), ('R', -1)):
        H, K, A = J('thigh' + side), J('shin' + side), J('foot' + side)
        P.append(Prim('cone', 'hide', 0.045, a=H + V(-0.01 * s, 0, 0.02), b=K, r1=0.09, r2=0.064))
        P.append(Prim('cone', 'hide', 0.02, a=K, b=A, r1=0.062, r2=0.046))
        P.append(Prim('ell', 'hide', 0.03, c=K + (A - K) * 0.32 + V(0, 0.022, 0), r=V(0.052, 0.056, 0.058), R=IDENTITY))
        # A knobbed kneecap.
        P.append(Prim('ell', 'hide', 0.016, c=K + V(0.004 * s, -0.052, 0.008), r=V(0.034, 0.024, 0.036), R=IDENTITY))
        _limb_foot(P, side, rng)
    return P


def _onto(prims, guess, centre, steps=200):
    """The point of the surface of `prims` on the line from `centre` out through `guess`."""
    d = guess - centre
    d /= np.linalg.norm(d)
    q = centre + d * 0.3
    for _ in range(steps):
        s = field_at(prims, q[None])[0]
        if s < 0.0005:
            break
        q = q - d * min(max(s, 0.0005), 0.02)
    return q


def warts(body):
    """Warts set on his skin: on his nose and by it, on a cheek, on his brow."""
    P = []
    nose = V(0, -0.348, 0.226)
    head = V(0, -0.17, 0.3)
    for guess, centre, r in ((V(0.03, -0.37, 0.25), nose, 0.0105), (V(-0.015, -0.392, 0.215), nose, 0.0085),
                             (V(-0.03, -0.32, 0.29), nose, 0.008), (V(0.09, -0.25, 0.255), head, 0.0095),
                             (V(-0.08, -0.24, 0.235), head, 0.008), (V(0.06, -0.25, 0.37), head, 0.009)):
        q = _onto(body, guess, centre)
        P.append(Prim('ell', 'skin', 0.004, c=q, r=V(r, r, r * 0.9), R=IDENTITY))
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
    """His hair: moss over his scalp, a shaggy crown, a mantle of many locks over his back, stray
    tufts that break his outline, twigs caught in it, lichen grown on his shoulders, bushy brows,
    and a long beard of beard-lichen with a drooping moustache.

    Each lock is draped (it falls from its root under gravity and lies on what is under it) and
    tapers to a ragged point; the locks are thin and few of them fuse, so the mane reads as hair
    and not as one mass. Groups: crown, cloak, shoulder, stray, fringe (brows), beard, tuft (ears),
    lichen, twig (bark: part leather)."""
    tone = {}
    out = []
    lid = [0]

    def add(lines, group, k, base_tone, part='pelt'):
        for line in lines:
            lid[0] += 1
            t = float(np.clip(base_tone + 0.18 * rng.standard_normal(), 0.0, 0.62))
            tone[lid[0]] = t
            out.extend(lock_prims([line], part=part, k=k, tag={'lock': lid[0], 'tone': t, 'group': group}))

    def flare_from(cy, amount=0.18):
        def f(p):
            v = p.copy()
            v[:, 2] = 0.0
            v[:, 1] -= cy
            n = np.linalg.norm(v, axis=1, keepdims=True)
            return v / np.maximum(n, 1e-6) * amount
        return f

    # Moss over his scalp, from a hairline over his brow down to the nape (the locks grow out of it).
    hair_n = V(0, 0.42, 1.0)
    hair_n /= np.linalg.norm(hair_n)
    scalp = [Prim('cap', 'pelt', 0.018, c=HEAD_C + V(0, 0.004, 0.004), r=HEAD_R + V(0.007, 0.009, 0.008),
                  o=V(0, -0.15, 0.372), n=hair_n, tag={'lock': 0, 'tone': 0.3, 'group': 'crown'})]
    out.extend(scalp)
    under = list(body) + scalp

    # ── The mantle: many locks from a yoke round the base of his neck and from his back ──
    neck = V(0, -0.02, 0.17)

    def onto(start, d):
        q = start.copy()
        for _ in range(160):
            s = field_at(under, q[None])[0]
            if s < 0.004:
                break
            q = q + d * min(max(s, 0.003), 0.02)
        return q

    def yoke(rows, jitter=3.5):
        roots, dirs, lens, r0s = [], [], [], []
        for ring, dz, count, span, length, rr in rows:
            for b in np.linspace(-span, span, count):
                bb = math.radians(b + rng.uniform(-jitter, jitter))
                out_d = V(math.sin(bb), math.cos(bb), 0.0)
                start = neck + out_d * 0.5 + V(0, 0, 0.32 + dz)
                goal = neck + out_d * ring + V(0, 0, dz)
                d = goal - start
                d /= np.linalg.norm(d)
                roots.append(onto(start, d))
                dirs.append(out_d * 0.4 + V(0, 0, -1.0))
                lens.append(length * max(1.0 - 0.5 * (abs(b) / 90.0) ** 2, 0.3) * rng.uniform(0.85, 1.12))
                r0s.append(rr * rng.uniform(0.85, 1.15))
        return np.array(roots), np.array(dirs), np.array(lens), np.array(r0s)

    # Under it all a dense mat of moss (thick locks, fused), so no skin shows between the locks.
    roots, dirs, lens, r0s = yoke(((0.075, 0.07, 19, 104, 0.56, 0.03), (0.18, -0.02, 14, 80, 0.46, 0.03)))
    lines = drape(under, roots, dirs, lens, r0s, r0s * 0.45, rng, flare=flare_from(0.02, 0.12), wave=0.003, hug=0.8)
    mat_start = len(out)
    add(lines, 'cloak', 0.02, 0.16)
    under = under + out[mat_start:]
    # Over it, many thin locks with ragged ends.
    roots, dirs, lens, r0s = [], [], [], []
    for ring, dz, count, span, length, rr in ((0.075, 0.07, 28, 108, 0.66, 0.02), (0.18, -0.01, 20, 84, 0.56, 0.02),
                                             (0.26, -0.12, 14, 64, 0.42, 0.019)):
        for b in np.linspace(-span, span, count):
            bb = math.radians(b + rng.uniform(-3.5, 3.5))
            out_d = V(math.sin(bb), math.cos(bb), 0.0)
            start = neck + out_d * 0.5 + V(0, 0, 0.32 + dz)
            goal = neck + out_d * ring + V(0, 0, dz)
            d = goal - start
            d /= np.linalg.norm(d)
            roots.append(onto(start, d))
            dirs.append(out_d * 0.4 + V(0, 0, -1.0))
            lens.append(length * max(1.0 - 0.5 * (abs(b) / 90.0) ** 2, 0.3) * rng.uniform(0.82, 1.15))
            r0s.append(rr * rng.uniform(0.85, 1.15))
    lines = drape(under, np.array(roots), np.array(dirs), np.array(lens), np.array(r0s), np.array(r0s) * 0.14, rng,
                  flare=flare_from(0.02), wave=0.005, hug=0.7)
    add(lines, 'cloak', 0.01, 0.28)
    cloak_lines = lines

    # ── Moss grown over his shoulders: cushions of it round the cap of each (top, outside, front
    # and back: the camera sees his near shoulder from the side and in front as he reaches), and
    # locks from it falling down the outside of his upper arms (no bare ball of a shoulder by his
    # lantern) ──
    roots, dirs, lens, r0s = [], [], [], []
    pads = []
    for side, s in (('L', 1), ('R', -1)):
        S, E = J('upper' + side), J('fore' + side)
        centre = S + V(0.012 * s, 0, 0.012) + (E - S) / np.linalg.norm(E - S) * 0.02
        for d in (V(0, 0, 1), V(0.7 * s, 0, 0.7), V(0.9 * s, -0.35, 0.25), V(0.45 * s, -0.75, 0.45),
                  V(0.95 * s, 0.2, -0.15), V(0.3 * s, 0.6, 0.7), V(0.6 * s, -0.7, -0.1), V(0.75 * s, 0.55, 0.2)):
            d = d / np.linalg.norm(d)
            q = _onto(under, centre + d * 0.12, centre)
            n = _grad(under, q[None])[0]
            rr = rng.uniform(0.042, 0.056)
            pads.append(Prim('ell', 'pelt', 0.024, c=q - n * 0.002, r=V(0.013, rr, rr * 0.9), R=frame(n, V(0, 0, 1)),
                             tag={'lock': -3, 'tone': float(rng.uniform(0.2, 0.45)), 'group': 'shoulder'}))
        for _ in range(20):
            d = V(s * rng.uniform(0.2, 1.0), rng.uniform(-0.8, 0.6), rng.uniform(0.0, 0.9))
            d = d / np.linalg.norm(d)
            roots.append(_onto(under, centre + d * 0.12, centre) + d * 0.006)
            dirs.append(V(0.5 * s, rng.uniform(-0.25, 0.25), -1.0))
            lens.append(rng.uniform(0.08, 0.16))
            r0s.append(rng.uniform(0.015, 0.022))
    out.extend(pads)
    under = under + pads
    lines = drape(under, np.array(roots), np.array(dirs), np.array(lens), np.array(r0s), np.array(r0s) * 0.2, rng,
                  flare=flare_from(0.0, 0.1), wave=0.004, rest=0.5, hug=0.75)
    add(lines, 'shoulder', 0.012, 0.3)
    cloak_lines = cloak_lines + lines

    # ── The crown: many thin locks from his head, fused into combed-back hair lying flat to it and
    # falling over its back and sides (his face and ears free) ──
    roots, dirs, lens, r0s = [], [], [], []
    for alpha, count, span, length, rr in ((14, 9, 118, 0.42, 0.013), (28, 14, 118, 0.44, 0.014),
                                          (44, 16, 116, 0.46, 0.014), (62, 15, 108, 0.46, 0.014),
                                          (82, 13, 94, 0.42, 0.014), (100, 9, 72, 0.36, 0.013)):
        for b in np.linspace(-span, span, count):
            p, n = _on_head(alpha, b + rng.uniform(-6, 6), lift=0.0)
            if (p - HEAD_C) @ hair_n < -0.03:
                continue
            roots.append(p)
            dirs.append(n * 0.65 + V(0, 1, 0) * 0.7 + V(0, 0, -0.15))
            side = abs(b) / 120.0
            lens.append(length * (1.0 - 0.3 * side) * rng.uniform(0.8, 1.15))
            r0s.append(rr * rng.uniform(0.85, 1.15))
    lines = drape(under, np.array(roots), np.array(dirs), np.array(lens), np.array(r0s), np.array(r0s) * 0.2, rng,
                  flare=flare_from(0.0, 0.16), wave=0.003, rest=0.4, hug=0.85)
    add(lines, 'crown', 0.013, 0.34)
    crown_lines = lines

    # ── Strays: short tufts standing out of the mane, so his outline is shaggy, not smooth ──
    strays = []
    pool = cloak_lines + crown_lines
    picks = rng.choice(len(pool), size=min(34, len(pool)), replace=False)
    for k in picks:
        line, radii = pool[k]
        if len(line) < 6:
            continue
        i = int(rng.uniform(0.3, 0.85) * (len(line) - 1))
        p = line[i]
        o = p - V(0, 0.0, p[2] * 0.3)
        o = p - V(0.0, -0.02, 0.05)
        o[2] *= 0.25
        o /= max(np.linalg.norm(o), 1e-6)
        d = o * 0.8 + V(0, 0, -0.55) + V(*rng.uniform(-0.25, 0.25, 3))
        d /= np.linalg.norm(d)
        n = 5
        length = rng.uniform(0.045, 0.1)
        pts = np.array([p + d * length * (j / (n - 1)) + V(0, 0, -0.25 * length * (j / (n - 1)) ** 2) for j in range(n)])
        r0 = radii[i] * rng.uniform(0.55, 0.75)
        strays.append((pts, r0 * (1.0 - 0.85 * np.linspace(0, 1, n) ** 1.2)))
    add(strays, 'stray', 0.004, 0.36)

    # ── Twigs caught in his mane (bark: dark), each with a fork ──
    twigs = []
    for guess, d in ((V(0.07, 0.02, 0.44), V(0.5, 0.5, 0.7)), (V(-0.12, 0.12, 0.3), V(-0.7, 0.4, 0.5)),
                     (V(0.15, 0.18, 0.12), V(0.8, 0.3, 0.4))):
        d = d / np.linalg.norm(d)
        q = guess.copy()
        for _ in range(80):
            s = field_at(under + out, q[None])[0]
            if s < -0.004:
                break
            q = q - d * min(max(s, 0.002), 0.015)
        tip = q + d * 0.12
        twigs.append((np.array([q - d * 0.02, q + d * 0.06, tip]), np.array([0.0075, 0.0055, 0.0025])))
        side = np.cross(d, V(0, 0, 1))
        side /= max(np.linalg.norm(side), 1e-6)
        mid = q + d * 0.06
        fork = mid + (d * 0.6 + side * 0.8) * 0.05
        twigs.append((np.array([mid, fork]), np.array([0.0045, 0.002])))
    add(twigs, 'twig', 0.003, 0.0, part='leather')

    # ── Lichen grown on him: pale patches on the tops of his shoulders and his back ──
    lichen = []
    for guess in (V(0.17, 0.02, 0.17), V(-0.16, 0.03, 0.16), V(0.08, 0.12, 0.2), V(-0.05, 0.16, 0.08)):
        q = _onto(under, guess, V(guess[0] * 0.3, guess[1] * 0.3 - 0.02, 0.0))
        n = _grad(under, q[None])[0]
        for j in range(3):
            c = q + V(*rng.uniform(-0.025, 0.025, 3))
            c = _onto(under, c, c - n * 0.2) + n * 0.003
            r = rng.uniform(0.016, 0.026)
            out.append(Prim('ell', 'pelt', 0.006, c=c, r=V(r * 0.35, r, r * 0.9), R=frame(n, V(0, 0, 1)),
                            tag={'lock': -1, 'tone': 0.5, 'group': 'lichen'}))

    # ── Bushy brows over his eyes, swept out and up at their ends ──
    lines = []
    for sx in (1, -1):
        for x, y, z, ln, r in ((0.014, -0.284, 0.334, 0.08, 0.018), (0.03, -0.278, 0.346, 0.075, 0.016),
                               (0.022, -0.276, 0.356, 0.06, 0.012)):
            t = np.linspace(0.0, 1.0, 8)
            pts = np.stack([sx * (x + ln * t), y + 0.035 * t ** 1.5, z + 0.016 * np.sin(math.pi * t * 0.8) - 0.004 * t], 1)
            lines.append((pts, r * (1.0 - 0.7 * t ** 1.4)))
    add(lines, 'fringe', 0.006, 0.45)

    # ── Tufts at the tips of his ears ──
    tufts = []
    for s in (1, -1):
        tip = V(0.262 * s, -0.11, 0.282)
        for j in range(3):
            d = V(0.6 * s, rng.uniform(-0.3, 0.3), rng.uniform(-0.2, 0.5))
            d /= np.linalg.norm(d)
            pts = np.array([tip - d * 0.01, tip + d * 0.03, tip + d * 0.055 + V(0, 0, -0.01)])
            tufts.append((pts, np.array([0.006, 0.004, 0.0015])))
    add(tufts, 'tuft', 0.003, 0.5)

    # ── His beard: beard-lichen, long, from his jaw and chin over his chest to a ragged point at his
    # belly ──
    # (A core from his chin down his chest, narrowing as it falls: the tresses lie on it, so no skin
    # shows between them, and only their ends go ragged below it.)
    beard_tag = {'lock': -2, 'tone': 0.4, 'group': 'beard'}
    beard_core = [
        Prim('ell', 'pelt', 0.035, c=V(0, -0.256, 0.165), r=V(0.084, 0.05, 0.075),
             R=frame(V(0, -0.25, -1), V(1, 0, 0))[[1, 2, 0]], tag=dict(beard_tag)),
        Prim('ell', 'pelt', 0.035, c=V(0, -0.262, 0.07), r=V(0.066, 0.046, 0.085), R=IDENTITY, tag=dict(beard_tag)),
        Prim('ell', 'pelt', 0.03, c=V(0, -0.254, -0.03), r=V(0.042, 0.04, 0.07), R=IDENTITY, tag=dict(beard_tag)),
    ]
    out.extend(beard_core)
    rest = list(body) + beard_core
    # Tresses: a few roots strewn over his jaw and chin, each with a sibling or two beside it (beard-
    # lichen hangs in strings that cling together), gathered toward his middle as they fall.
    roots, dirs, lens, r0s = [], [], [], []
    for _ in range(19):
        phi = rng.uniform(-84, 84)
        f = math.radians(phi)
        side = abs(phi) / 90.0
        rad = rng.uniform(0.05, 0.095) * (1.0 - 0.15 * side)
        dz = 0.15 + 0.07 * side + rng.uniform(-0.02, 0.02)
        root = V(rad * math.sin(f), -0.205 - (rad * 0.85) * math.cos(f), dz)
        length = (0.4 - 0.16 * side ** 1.3) * rng.uniform(0.75, 1.18)
        rr = rng.uniform(0.013, 0.021)
        for j in range(int(rng.integers(1, 4))):
            off = V(*rng.uniform(-0.009, 0.009, 3)) if j else V(0, 0, 0)
            roots.append(root + off)
            dirs.append(V(-0.15 * math.sin(f), -0.45, -1))
            lens.append(length * rng.uniform(0.85, 1.1))
            r0s.append(rr * (0.8 if j else 1.0))

    def gather(p):
        # Toward his middle (x = 0) and a little forward over his belly, more the further out.
        v = np.zeros_like(p)
        v[:, 0] = -p[:, 0] * 2.6
        v[:, 1] = -0.05
        return v
    lines = drape(rest, np.array(roots), np.array(dirs), np.array(lens), np.array(r0s), np.array(r0s) * 0.12, rng,
                  flare=gather, wave=0.006, rest=0.45, hug=0.55)
    add(lines, 'beard', 0.013, 0.42)
    # Sideburns of it down from his temples, before his ears, to his jaw where the beard begins
    # (his hair and his beard are one growth).
    roots, dirs, lens, r0s = [], [], [], []
    for s in (1, -1):
        for beta, r0 in ((112, 0.016), (124, 0.015), (136, 0.013)):
            roots.append(_on_head(rng.uniform(84, 92), s * (beta + rng.uniform(-3, 3)), lift=-0.004)[0])
            dirs.append(V(0, -0.25, -1.0))
            lens.append(rng.uniform(0.11, 0.14))
            r0s.append(r0)
    lines = drape(rest, np.array(roots), np.array(dirs), np.array(lens), np.array(r0s), np.array(r0s) * 0.5, rng,
                  wave=0.002, rest=0.55, hug=0.8)
    add(lines, 'beard', 0.01, 0.4)
    # A moustache drooping from under his nose, past his mouth.
    lines = []
    for s in (1, -1):
        t = np.linspace(0.0, 1.0, 10)
        pts = np.stack([s * (0.012 + 0.07 * t ** 0.8), -0.33 + 0.045 * t, 0.205 - 0.11 * t ** 1.6], 1)
        lines.append((pts, 0.016 * (1.0 - 0.8 * t ** 1.3) + 0.002))
    add(lines, 'beard', 0.006, 0.4)
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
    body = body + warts(body)
    cuts = face_cuts() + grip_cut()
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


#: The way hair runs where a tagged primitive has no length of its own (the moss over his scalp
#: runs back from his brow; a lump of moss or lichen hangs down).
SCALP_FLOW = np.array([0.0, 0.8, -0.6]) / 1.0
HANG_FLOW = np.array([0.0, 0.0, -1.0])


def parts_at(prims, P, soft=0.006):
    """What each point is: soft shares of each part (n, len(PARTS)), the nearest lock's tone, group
    and direction (the way its strands run: root to tip; unit vectors)."""
    n = len(P)
    best = {name: np.full(n, 1e3) for name in PARTS}
    lock_d = np.full(n, 1e3)
    lock_tone = np.zeros(n)
    lock_group = np.full(n, '', dtype=object)
    lock_dir = np.tile(HANG_FLOW, (n, 1))
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
        if pr.tag.get('group'):
            ld = lock_d[sel]
            closer = d < ld
            idx = np.nonzero(sel)[0][closer]
            lock_d[idx] = d[closer]
            lock_tone[idx] = pr.tag.get('tone', 0.3)
            lock_group[idx] = pr.tag.get('group', '')
            if pr.kind == 'cone':
                d = pr.p['b'] - pr.p['a']
                lock_dir[idx] = d / max(np.linalg.norm(d), 1e-9)
            elif pr.kind == 'cap':
                lock_dir[idx] = SCALP_FLOW / np.linalg.norm(SCALP_FLOW)
            else:
                lock_dir[idx] = HANG_FLOW
    D = np.stack([best[name] for name in PARTS], 1)
    dmin = D.min(1, keepdims=True)
    W = np.exp(-(D - dmin) / soft)
    W /= W.sum(1, keepdims=True)
    return W, lock_tone, lock_group, lock_dir
