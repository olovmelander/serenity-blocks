"""The sea's large animals, each drawn from numbers as smooth masses and fins.

Every animal is one unit long from its nose (+z) to the end of its tail (a ray: one unit across
its wings), y up. Each design returns its primitives (sdf.Prim) and what the runtime needs to know
about it: its swimming family, where its body runs from and to along z, how many triangles it is
given, and its pattern masks per vertex.

Families (how the runtime swims them, src/themes/ocean/ocean-giants.js):
  0 whale   the body beats up and down, the flukes pitch, the flippers scull
  1 fish    the body sweeps side to side, the head a little against it
  2 ray     the wings fly: a wave runs out along the span and back across the chord
  3 turtle  the front flippers row and twist, the rear ones steer, the head nods
  4 mola    the tall fins above and below scull from side to side together

Parts (packed per vertex): 0 body, 1 pectoral fin / flipper, 2 tail (flukes, caudal fin, ray's
tail), 3 dorsal fin, 4 head (cephalic fins, hammer, turtle's head and neck), 5 rear (turtle's
rear flippers, sunfish's anal fin, pelvic fins), 6 eye.
"""

import math

import numpy as np

from .sdf import (V, Prim, body_chain, field_at, fin, mirror, pchip, planform, unit)

PARTS = {'body': 0, 'pectoral': 1, 'tail': 2, 'dorsal': 3, 'head': 4, 'rear': 5, 'eye': 6}
FAMILIES = {'whale': 0, 'fish': 1, 'ray': 2, 'turtle': 3, 'mola': 4}


def _smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def surface_point(prims, centre, direction, reach=0.7):
    """Where a ray from `centre` (inside) along `direction` leaves the field (bisection)."""
    c = np.asarray(centre, float)
    d = unit(direction)
    lo, hi = 0.0, reach
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if field_at(prims, (c + d * mid)[None])[0] < 0:
            lo = mid
        else:
            hi = mid
    return c + d * lo


def groove(prims, points, radius, k=0.003, part='body'):
    """A shallow groove (a mouth line) through surface points: subtracted round cones."""
    out = []
    for a, b in zip(points[:-1], points[1:]):
        out.append(Prim('cone', part, k=k, op='sub', a=np.asarray(a, float), b=np.asarray(b, float),
                        r1=radius, r2=radius))
    return out


def lip_line(prims, zs, ys, side=1, inset=0.0):
    """Points on the body's flank at each (z, y), `inset` under the skin."""
    pts = []
    for z, y in zip(zs, ys):
        p = surface_point(prims, V(0.0, y, z), V(side, 0.0, 0.0))
        pts.append(p - V(side, 0.0, 0.0) * inset)
    return pts


def eye(prims, z, y, r, side=1, depth=0.45, squash=(1.0, 0.85, 1.15)):
    p = surface_point(prims, V(0.0, y, z), V(side, 0.0, 0.0))
    c = p - V(side, 0.0, 0.0) * (r * depth)
    return Prim('ell', 'eye', k=r * 0.5, c=c, r=V(r * squash[0], r * squash[1], r * squash[2]),
                meta={'side': side})


def both(prim):
    return [prim, mirror(prim)]


def notch_wave(depth, width):
    return lambda f: -depth * np.exp(-(f / width) ** 2)


# ── Whales ──────────────────────────────────────────────────────────────────────


def humpback():
    # A heavy body, deepest just behind the flippers; the head broad and flat on top.
    rows = [
        (0.000, 0.008, 0.004, -0.022),
        (0.025, 0.048, 0.019, -0.024),
        (0.060, 0.074, 0.033, -0.024),
        (0.120, 0.098, 0.054, -0.022),
        (0.200, 0.114, 0.078, -0.018),
        (0.300, 0.124, 0.100, -0.012),
        (0.400, 0.125, 0.109, -0.005),
        (0.500, 0.114, 0.104, 0.000),
        (0.600, 0.093, 0.092, 0.004),
        (0.700, 0.064, 0.076, 0.006),
        (0.780, 0.041, 0.059, 0.006),
        (0.850, 0.023, 0.044, 0.004),
        (0.905, 0.013, 0.028, 0.002),
        (0.940, 0.009, 0.014, 0.000),
    ]
    body = body_chain(rows, step=0.012, k=0.014)
    # The throat swells under the head (the pleated pouch), the lower jaw reaches the snout.
    body.append(Prim('ell', 'body', k=0.05, c=V(0.0, -0.066, 0.26), r=V(0.1, 0.074, 0.21)))
    body.append(Prim('ell', 'body', k=0.025, c=V(0.0, -0.038, 0.41), r=V(0.06, 0.026, 0.095)))
    # The low hump two thirds of the way back, and its small fin.
    body.append(Prim('ell', 'body', k=0.02, c=V(0.0, 0.08, -0.14), r=V(0.02, 0.022, 0.06)))
    prims = list(body)
    for side in (1, -1):
        zs = np.linspace(0.488, 0.285, 9)
        ys = -0.022 - 0.036 * ((0.488 - zs) / 0.203) ** 1.4
        prims += groove(body, lip_line(body, zs, ys, side, inset=-0.0005), 0.0034)
        prims.append(eye(body, 0.272, -0.04, 0.0068, side))
    # The flippers: a third of the body long, swept back and down, knobbed along the leading edge.
    root = surface_point(body, V(0.0, -0.064, 0.205), V(1, 0, 0)) - V(0.012, 0.0, 0.0)
    us, lead, trail = planform(0.30, 0.074, 0.016, sweep=0.035, tip_round=0.2,
                               lead_wave=lambda f: -0.0042 * np.sin(np.pi * f * 10.5) ** 2 * _smooth(0.08, 0.35, f))
    flipper = fin('pectoral', root, V(1.0, -0.42, -0.5), V(0, 0, -1), us, lead, trail,
                  0.011 - 0.007 * us / 0.30, k=0.018, tmin=0.0026, bow=-0.03 * (us / 0.30) ** 2,
                  side=1, along=0.295)
    prims += both(flipper)
    # The dorsal fin on the hump.
    us, lead, trail = planform(0.04, 0.075, 0.014, sweep=0.03, tip_round=0.3, trail_bulge=-0.006)
    prims.append(fin('dorsal', V(0.0, 0.088, -0.112), V(0.0, 1.0, -0.85), V(0, 0, -1), us, lead, trail,
                     0.009 - 0.005 * us / 0.04, k=0.012, tmin=0.0026))
    # The flukes: wide, swept, the trailing edge ragged, notched in the middle.
    us, lead, trail = planform(0.175, 0.07, 0.012, sweep=0.072, tip_round=0.12,
                               trail_wave=lambda f: 0.0024 * np.sin(f * np.pi * 15) * f - 0.016 * np.exp(-(f / 0.07) ** 2))
    fluke = fin('tail', V(0.0, 0.0, -0.418), V(1.0, 0.0, -0.18), V(0, 0, -1), us, lead, trail,
                0.012 * (1 - 0.75 * us / 0.175), k=0.012, tmin=0.0026, side=1)
    prims += both(fluke)

    def masks(P, N, part, s):
        below = _smooth(-0.15, -0.55, N[:, 1])
        pleats = below * (1 - _smooth(0.42, 0.52, s)) * (part == PARTS['body'])
        white = np.where(part == PARTS['pectoral'], 1.0, 0.0)
        white = np.maximum(white, (part == PARTS['tail']) * _smooth(0.1, -0.4, N[:, 1]))
        white = np.maximum(white, below * _smooth(0.22, 0.32, s) * (1 - _smooth(0.55, 0.68, s)) * 0.8)
        return pleats, white

    return prims, {
        'family': 'whale', 'voxel': 0.0024, 'triangles': 6400, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


def blue_whale():
    rows = [
        (0.000, 0.012, 0.006, -0.008),
        (0.020, 0.040, 0.015, -0.010),
        (0.060, 0.054, 0.025, -0.010),
        (0.120, 0.060, 0.036, -0.010),
        (0.200, 0.063, 0.048, -0.008),
        (0.300, 0.066, 0.058, -0.004),
        (0.420, 0.066, 0.063, 0.000),
        (0.550, 0.058, 0.060, 0.002),
        (0.680, 0.044, 0.052, 0.003),
        (0.780, 0.030, 0.042, 0.003),
        (0.860, 0.017, 0.030, 0.002),
        (0.920, 0.010, 0.018, 0.001),
        (0.950, 0.008, 0.010, 0.000),
    ]
    body = body_chain(rows, step=0.011, k=0.012)
    body.append(Prim('ell', 'body', k=0.035, c=V(0.0, -0.026, 0.33), r=V(0.056, 0.036, 0.17)))
    # The splash guard before the blowholes.
    body.append(Prim('ell', 'body', k=0.012, c=V(0.0, 0.03, 0.33), r=V(0.012, 0.008, 0.03)))
    prims = list(body)
    for side in (1, -1):
        zs = np.linspace(0.492, 0.33, 8)
        ys = -0.009 - 0.016 * ((0.492 - zs) / 0.162) ** 1.3
        prims += groove(body, lip_line(body, zs, ys, side, inset=-0.0004), 0.0022)
        prims.append(eye(body, 0.335, -0.022, 0.0045, side))
    root = surface_point(body, V(0.0, -0.03, 0.25), V(1, 0, 0)) - V(0.008, 0.0, 0.0)
    us, lead, trail = planform(0.13, 0.034, 0.008, sweep=0.016, tip_round=0.2)
    prims += both(fin('pectoral', root, V(1.0, -0.42, -0.48), V(0, 0, -1), us, lead, trail,
                      0.006 - 0.004 * us / 0.13, k=0.012, tmin=0.0022, side=1, along=0.25))
    us, lead, trail = planform(0.014, 0.032, 0.008, sweep=0.012, tip_round=0.3)
    prims.append(fin('dorsal', V(0.0, 0.043, -0.28), V(0.0, 1.0, -1.1), V(0, 0, -1), us, lead, trail,
                     0.004, k=0.01, tmin=0.0022))
    us, lead, trail = planform(0.125, 0.05, 0.01, sweep=0.048, tip_round=0.12, trail_wave=notch_wave(0.01, 0.07))
    prims += both(fin('tail', V(0.0, 0.0, -0.435), V(1.0, 0.0, -0.15), V(0, 0, -1), us, lead, trail,
                      0.009 * (1 - 0.7 * us / 0.125), k=0.01, tmin=0.0022, side=1))

    def masks(P, N, part, s):
        below = _smooth(-0.15, -0.55, N[:, 1])
        pleats = below * (1 - _smooth(0.4, 0.5, s)) * (part == PARTS['body'])
        return pleats, np.zeros(len(P))

    return prims, {
        'family': 'whale', 'voxel': 0.002, 'triangles': 3600, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


def dolphin():
    rows = [
        (0.000, 0.006, 0.006, -0.012),
        (0.040, 0.015, 0.015, -0.014),
        (0.072, 0.021, 0.023, -0.011),
        (0.100, 0.040, 0.048, 0.000),
        (0.150, 0.058, 0.066, 0.000),
        (0.250, 0.078, 0.085, -0.002),
        (0.350, 0.085, 0.091, -0.002),
        (0.450, 0.081, 0.087, 0.000),
        (0.560, 0.067, 0.077, 0.002),
        (0.670, 0.047, 0.063, 0.002),
        (0.760, 0.029, 0.049, 0.002),
        (0.840, 0.016, 0.035, 0.001),
        (0.890, 0.010, 0.020, 0.000),
    ]
    body = body_chain(rows, step=0.01, k=0.012)
    # The melon.
    body.append(Prim('ell', 'body', k=0.028, c=V(0.0, 0.018, 0.37), r=V(0.044, 0.048, 0.075)))
    prims = list(body)
    for side in (1, -1):
        zs = np.linspace(0.495, 0.40, 8)
        ys = -0.013 + 0.012 * ((0.495 - zs) / 0.095) ** 1.6
        prims += groove(body, lip_line(body, zs, ys, side, inset=-0.0004), 0.0026)
        prims.append(eye(body, 0.37, -0.002, 0.008, side))
    root = surface_point(body, V(0.0, -0.05, 0.255), V(1, 0, 0)) - V(0.01, 0.0, 0.0)
    us, lead, trail = planform(0.13, 0.05, 0.01, sweep=0.035, tip_round=0.12)
    prims += both(fin('pectoral', root, V(1.0, -0.6, -0.62), V(0, 0, -1), us, lead, trail,
                      0.009 - 0.0065 * us / 0.13, k=0.014, tmin=0.0025, side=1, along=0.245))
    us, lead, trail = planform(0.115, 0.12, 0.018, sweep=0.105, tip_round=0.22, trail_bulge=-0.03)
    prims.append(fin('dorsal', V(0.0, 0.08, 0.075), V(0.0, 1.0, -0.62), V(0, 0, -1), us, lead, trail,
                     0.011 - 0.008 * us / 0.115, k=0.016, tmin=0.0025))
    us, lead, trail = planform(0.13, 0.066, 0.012, sweep=0.062, tip_round=0.12, trail_wave=notch_wave(0.01, 0.07))
    prims += both(fin('tail', V(0.0, 0.0, -0.375), V(1.0, 0.0, -0.18), V(0, 0, -1), us, lead, trail,
                      0.011 * (1 - 0.75 * us / 0.13), k=0.012, tmin=0.0025, side=1))

    def masks(P, N, part, s):
        # The cape: the darker saddle over the back, from the melon to behind the dorsal fin.
        cape = _smooth(0.25, 0.65, N[:, 1]) * _smooth(0.08, 0.16, s) * (1 - _smooth(0.55, 0.7, s))
        cape = np.maximum(cape, (part == PARTS['dorsal']) * 1.0)
        return cape, np.zeros(len(P))

    return prims, {
        'family': 'whale', 'voxel': 0.0022, 'triangles': 2600, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


# ── Sharks ──────────────────────────────────────────────────────────────────────


def whale_shark():
    # The head broad and flat, the mouth right across its front.
    rows = [
        (0.000, 0.062, 0.016, -0.006),
        (0.015, 0.078, 0.025, -0.004),
        (0.050, 0.086, 0.038, -0.001),
        (0.120, 0.089, 0.055, 0.002),
        (0.220, 0.090, 0.07, 0.004),
        (0.330, 0.086, 0.077, 0.004),
        (0.450, 0.074, 0.073, 0.004),
        (0.570, 0.058, 0.063, 0.004),
        (0.680, 0.040, 0.051, 0.004),
        (0.780, 0.024, 0.037, 0.004),
        (0.860, 0.014, 0.024, 0.006),
        (0.900, 0.010, 0.016, 0.010),
    ]
    body = body_chain(rows, step=0.011, k=0.012)
    prims = list(body)
    # The wide mouth across the front.
    prims.append(Prim('ell', 'body', k=0.004, op='sub', c=V(0.0, -0.007, 0.505), r=V(0.062, 0.0055, 0.016)))
    # The ridges along the back (three a side), and the keels on the tail stock.
    for side in (1, -1):
        for angle in (22, 46, 72):
            a = math.radians(angle)
            pts = []
            for s in np.linspace(0.1, 0.82, 10):
                z = 0.5 - s
                yc = float(pchip([r[0] for r in rows], [r[3] for r in rows], s))
                pts.append(surface_point(body, V(0.0, yc, z), V(side * math.sin(a), math.cos(a), 0.0)))
            radius = 0.0042 if angle != 72 else 0.0034
            for p0, p1 in zip(pts[:-1], pts[1:]):
                prims.append(Prim('cone', 'body', k=0.008, a=p0, b=p1, r1=radius, r2=radius))
        keel = [surface_point(body, V(0.0, 0.005, 0.5 - s), V(side, 0.0, 0.0)) for s in (0.78, 0.84, 0.9)]
        for p0, p1 in zip(keel[:-1], keel[1:]):
            prims.append(Prim('cone', 'body', k=0.008, a=p0, b=p1, r1=0.006, r2=0.004))
        prims.append(eye(body, 0.455, 0.004, 0.0045, side))
    root = surface_point(body, V(0.0, -0.035, 0.3), V(1, 0, 0)) - V(0.012, 0.0, 0.0)
    us, lead, trail = planform(0.19, 0.085, 0.014, sweep=0.065, tip_round=0.12, trail_bulge=-0.012)
    prims += both(fin('pectoral', root, V(1.0, -0.45, -0.42), V(0, 0, -1), us, lead, trail,
                      0.012 - 0.009 * us / 0.19, k=0.016, tmin=0.0026, side=1, along=0.2))
    us, lead, trail = planform(0.11, 0.14, 0.028, sweep=0.06, tip_round=0.16, trail_bulge=-0.02)
    prims.append(fin('dorsal', V(0.0, 0.07, 0.02), V(0.0, 1.0, -0.55), V(0, 0, -1), us, lead, trail,
                     0.013 - 0.009 * us / 0.11, k=0.016, tmin=0.0026))
    us, lead, trail = planform(0.036, 0.05, 0.014, sweep=0.016, tip_round=0.25)
    prims.append(fin('dorsal', V(0.0, 0.042, -0.24), V(0.0, 1.0, -0.6), V(0, 0, -1), us, lead, trail,
                     0.006, k=0.01, tmin=0.0024))
    us, lead, trail = planform(0.048, 0.042, 0.014, sweep=0.012, tip_round=0.3)
    prims += both(fin('rear', V(0.03, -0.05, -0.07), V(0.55, -1.0, -0.45), V(0, 0, -1), us, lead, trail,
                      0.006, k=0.01, tmin=0.0024, side=1))
    prims.append(fin('rear', V(0.0, -0.035, -0.255), V(0.0, -1.0, -0.6), V(0, 0, -1), *planform(0.034, 0.04, 0.012, sweep=0.012, tip_round=0.3),
                     0.0055, k=0.01, tmin=0.0024))
    # The tail: the upper lobe long and tall, the lower one shorter (the body runs into the upper).
    us, lead, trail = planform(0.2, 0.09, 0.02, sweep=0.05, tip_round=0.12, trail_bulge=-0.025)
    prims.append(fin('tail', V(0.0, 0.012, -0.375), V(0.0, 1.0, -1.15), V(0, 0, -1), us, lead, trail,
                     0.012 * (1 - 0.7 * us / 0.2), k=0.012, tmin=0.0026))
    us, lead, trail = planform(0.12, 0.07, 0.02, sweep=0.03, tip_round=0.15, trail_bulge=-0.015)
    prims.append(fin('tail', V(0.0, 0.004, -0.375), V(0.0, -1.0, -0.8), V(0, 0, -1), us, lead, trail,
                     0.011 * (1 - 0.7 * us / 0.12), k=0.012, tmin=0.0026))

    def masks(P, N, part, s):
        mouth = _smooth(0.022, 0.008, s) * _smooth(0.016, 0.004, np.abs(P[:, 1] + 0.006))
        gills = _smooth(0.13, 0.15, s) * (1 - _smooth(0.22, 0.24, s)) * _smooth(0.4, 0.1, np.abs(N[:, 1]))
        return mouth, gills

    return prims, {
        'family': 'fish', 'voxel': 0.0022, 'triangles': 4400, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


def hammerhead():
    rows = [
        (0.020, 0.020, 0.017, 0.000),
        (0.060, 0.030, 0.029, 0.000),
        (0.150, 0.045, 0.049, 0.000),
        (0.280, 0.052, 0.061, 0.000),
        (0.400, 0.050, 0.059, 0.002),
        (0.520, 0.042, 0.051, 0.002),
        (0.640, 0.032, 0.041, 0.002),
        (0.740, 0.022, 0.031, 0.002),
        (0.820, 0.014, 0.023, 0.004),
        (0.860, 0.010, 0.016, 0.006),
    ]
    body = body_chain(rows, step=0.01, k=0.012)
    prims = list(body)
    # The hammer: a flat wing across the head, notched at the middle and before each eye.
    us, lead, trail = planform(0.135, 0.056, 0.03, sweep=0.014, tip_round=0.32,
                               lead_wave=lambda f: 0.006 * np.exp(-(f / 0.09) ** 2) + 0.0032 * np.exp(-((f - 0.55) / 0.07) ** 2))
    hammer = fin('head', V(0.0, 0.002, 0.497), V(1.0, 0.0, -0.12), V(0, 0, -1), us, lead, trail,
                 0.012 - 0.002 * us / 0.135, k=0.014, tmin=0.0045, side=1, along=0.04)
    prims += both(hammer)
    for side in (1, -1):
        # (In the hammer's tips, a little proud of them.)
        prims.append(Prim('ell', 'eye', k=0.003, c=V(side * 0.127, 0.003, 0.46), r=V(0.0075, 0.0072, 0.0085),
                          meta={'side': side}))
    us, lead, trail = planform(0.14, 0.11, 0.018, sweep=0.065, tip_round=0.2, trail_bulge=-0.03)
    prims.append(fin('dorsal', V(0.0, 0.056, 0.21), V(0.0, 1.0, -0.45), V(0, 0, -1), us, lead, trail,
                     0.01 - 0.0075 * us / 0.14, k=0.014, tmin=0.0024))
    us, lead, trail = planform(0.03, 0.036, 0.01, sweep=0.012, tip_round=0.3)
    prims.append(fin('dorsal', V(0.0, 0.03, -0.22), V(0.0, 1.0, -0.6), V(0, 0, -1), us, lead, trail,
                     0.005, k=0.008, tmin=0.0022))
    root = surface_point(body, V(0.0, -0.036, 0.26), V(1, 0, 0)) - V(0.008, 0.0, 0.0)
    us, lead, trail = planform(0.11, 0.056, 0.012, sweep=0.04, tip_round=0.15)
    prims += both(fin('pectoral', root, V(1.0, -0.38, -0.5), V(0, 0, -1), us, lead, trail,
                      0.008 - 0.006 * us / 0.11, k=0.012, tmin=0.0022, side=1, along=0.24))
    us, lead, trail = planform(0.03, 0.03, 0.01, sweep=0.01, tip_round=0.3)
    prims += both(fin('rear', V(0.018, -0.04, -0.05), V(0.5, -1.0, -0.5), V(0, 0, -1), us, lead, trail,
                      0.005, k=0.008, tmin=0.0022, side=1))
    prims.append(fin('rear', V(0.0, -0.026, -0.22), V(0.0, -1.0, -0.6), V(0, 0, -1), *planform(0.026, 0.03, 0.01, sweep=0.01, tip_round=0.3),
                     0.005, k=0.008, tmin=0.0022))
    us, lead, trail = planform(0.17, 0.06, 0.016, sweep=0.03, tip_round=0.1, trail_bulge=-0.016,
                               trail_wave=lambda f: -0.01 * np.exp(-((f - 0.8) / 0.05) ** 2))
    prims.append(fin('tail', V(0.0, 0.008, -0.345), V(0.0, 1.0, -1.6), V(0, 0, -1), us, lead, trail,
                     0.009 * (1 - 0.7 * us / 0.17), k=0.01, tmin=0.0022))
    us, lead, trail = planform(0.08, 0.045, 0.012, sweep=0.02, tip_round=0.15)
    prims.append(fin('tail', V(0.0, -0.002, -0.345), V(0.0, -1.0, -0.9), V(0, 0, -1), us, lead, trail,
                     0.008 * (1 - 0.6 * us / 0.08), k=0.01, tmin=0.0022))

    def masks(P, N, part, s):
        return np.zeros(len(P)), np.zeros(len(P))

    return prims, {
        'family': 'fish', 'voxel': 0.0022, 'triangles': 2000, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


# ── Rays ────────────────────────────────────────────────────────────────────────


def _disc(lead_pts, trail_pts, n=61):
    """A ray's disc as one planform across both wings: u = x, v = how far back (from z = 0.2)."""
    us = np.linspace(-0.5, 0.5, n)
    a = np.abs(us)
    la, lz = zip(*lead_pts)
    ta, tz = zip(*trail_pts)
    z_lead = pchip(la, lz, a)
    z_trail = pchip(ta, tz, a)
    return us, 0.2 - z_lead, 0.2 - z_trail


def manta():
    us, lead, trail = _disc(
        [(0.0, 0.205), (0.08, 0.207), (0.12, 0.19), (0.2, 0.14), (0.3, 0.078), (0.4, 0.016), (0.465, -0.035), (0.5, -0.088)],
        [(0.0, -0.232), (0.07, -0.222), (0.12, -0.19), (0.2, -0.142), (0.3, -0.1), (0.4, -0.086), (0.46, -0.09), (0.5, -0.088)],
    )
    a = np.abs(us)
    thick = 0.042 * np.clip(1 - (a / 0.5) ** 2, 0, 1) ** 1.6 + 0.0035
    disc = fin('body', V(0.0, 0.0, 0.2), V(1, 0, 0), V(0, 0, -1), us, lead, trail, thick, k=0.0,
               tmin=0.0026, rnd=0.0016, bow=-0.012 * (a / 0.5) ** 2)
    prims = [disc]
    prims.append(Prim('ell', 'body', k=0.03, c=V(0.0, 0.004, 0.0), r=V(0.088, 0.04, 0.2)))
    prims.append(Prim('ell', 'body', k=0.02, c=V(0.0, 0.0, 0.16), r=V(0.1, 0.028, 0.05)))
    # The mouth, wide across the front between the horns.
    prims.append(Prim('ell', 'body', k=0.004, op='sub', c=V(0.0, -0.01, 0.212), r=V(0.068, 0.008, 0.024)))
    for side in (1, -1):
        # The cephalic fins, rolled into horns that curl in.
        p0, p1, p2 = V(side * 0.086, -0.003, 0.185), V(side * 0.096, -0.012, 0.262), V(side * 0.084, -0.022, 0.288)
        prims.append(Prim('cone', 'head', k=0.008, a=p0, b=p1, r1=0.014, r2=0.0075, meta={'side': side, 'pivot': p0,
                                                                                            'span': unit(p2 - p0), 'reach': 0.11, 'along': 0.02}))
        prims.append(Prim('cone', 'head', k=0.006, a=p1, b=p2, r1=0.0075, r2=0.004, meta={'side': side, 'pivot': p0,
                                                                                           'span': unit(p2 - p0), 'reach': 0.11, 'along': 0.02}))
        # (The eyes on the sides of the head, behind the horns, standing out of it.)
        prims.append(Prim('ell', 'eye', k=0.003, c=V(side * 0.106, 0.004, 0.172), r=V(0.0085, 0.009, 0.01), meta={'side': side}))
        prims.append(Prim('ell', 'rear', k=0.01, c=V(side * 0.042, -0.004, -0.236), r=V(0.028, 0.0045, 0.03), meta={'side': side}))
    prims.append(Prim('cone', 'tail', k=0.01, a=V(0.0, 0.0, -0.215), b=V(0.0, 0.0, -0.58), r1=0.011, r2=0.0028))
    us2, lead2, trail2 = planform(0.02, 0.034, 0.008, sweep=0.01, tip_round=0.3)
    prims.append(fin('dorsal', V(0.0, 0.016, -0.205), V(0.0, 1.0, -1.0), V(0, 0, -1), us2, lead2, trail2,
                     0.004, k=0.008, tmin=0.0022))

    def masks(P, N, part, s):
        x, z = np.abs(P[:, 0]), P[:, 2]
        top = _smooth(-0.05, 0.25, N[:, 1])
        # The white shoulders: a triangle each side of the black T down the middle.
        inner = _smooth(0.058, 0.074, x)
        back = _smooth(-0.012, 0.01, z - (-0.035 + 0.42 * (x - 0.06)))
        outer = 1 - _smooth(0.24, 0.3, x)
        shoulder = top * inner * back * outer * (z < 0.175) * (part == PARTS['body'])
        under = _smooth(-0.1, -0.45, N[:, 1])
        gills = under * _smooth(0.028, 0.038, x) * (1 - _smooth(0.085, 0.095, x)) * _smooth(0.04, 0.05, z) * (1 - _smooth(0.15, 0.16, z))
        return shoulder, gills

    return prims, {
        'family': 'ray', 'voxel': 0.0022, 'triangles': 3400, 'masks': masks,
        'nose': 0.29, 'tail': -0.58,
    }


def eagle_ray():
    us, lead, trail = _disc(
        [(0.0, 0.19), (0.05, 0.19), (0.15, 0.13), (0.25, 0.062), (0.35, -0.006), (0.45, -0.08), (0.5, -0.13)],
        [(0.0, -0.33), (0.08, -0.3), (0.15, -0.255), (0.25, -0.2), (0.35, -0.164), (0.45, -0.14), (0.5, -0.13)],
    )
    a = np.abs(us)
    thick = 0.034 * np.clip(1 - (a / 0.5) ** 2, 0, 1) ** 1.8 + 0.003
    prims = [fin('body', V(0.0, 0.0, 0.2), V(1, 0, 0), V(0, 0, -1), us, lead, trail, thick, k=0.0,
                 tmin=0.0024, rnd=0.0014, bow=-0.02 * (a / 0.5) ** 2)]
    prims.append(Prim('ell', 'body', k=0.03, c=V(0.0, 0.004, -0.02), r=V(0.078, 0.032, 0.22)))
    # The head stands out before the disc, ending in a flat duck-bill snout.
    prims.append(Prim('ell', 'head', k=0.03, c=V(0.0, 0.004, 0.215), r=V(0.046, 0.03, 0.075), meta={'along': 0.06}))
    prims.append(Prim('ell', 'head', k=0.02, c=V(0.0, -0.006, 0.288), r=V(0.032, 0.012, 0.036), meta={'along': 0.03}))
    for side in (1, -1):
        prims.append(Prim('ell', 'eye', k=0.004, c=V(side * 0.038, 0.022, 0.222), r=V(0.0065, 0.007, 0.009), meta={'side': side}))
        prims.append(Prim('ell', 'rear', k=0.008, c=V(side * 0.038, -0.003, -0.31), r=V(0.024, 0.004, 0.026), meta={'side': side}))
    prims.append(Prim('cone', 'tail', k=0.01, a=V(0.0, 0.0, -0.3), b=V(0.0, 0.0, -0.75), r1=0.008, r2=0.004))
    prims.append(Prim('cone', 'tail', k=0.004, a=V(0.0, 0.0, -0.75), b=V(0.0, 0.0, -1.3), r1=0.004, r2=0.0026))
    us2, lead2, trail2 = planform(0.018, 0.03, 0.008, sweep=0.01, tip_round=0.3)
    prims.append(fin('dorsal', V(0.0, 0.012, -0.3), V(0.0, 1.0, -1.0), V(0, 0, -1), us2, lead2, trail2,
                     0.0035, k=0.006, tmin=0.0022))

    def masks(P, N, part, s):
        top = _smooth(-0.05, 0.25, N[:, 1])
        return top, np.zeros(len(P))

    return prims, {
        'family': 'ray', 'voxel': 0.0022, 'triangles': 2200, 'masks': masks,
        'nose': 0.33, 'tail': -1.3,
    }


# ── Turtle ──────────────────────────────────────────────────────────────────────


def turtle():
    # The shell an oval a little narrower behind (heart-shaped from above), domed low.
    prims = [
        Prim('ell', 'body', k=0.06, c=V(0.0, 0.0, 0.05), r=V(0.275, 0.115, 0.3)),
        Prim('ell', 'body', k=0.06, c=V(0.0, -0.004, -0.13), r=V(0.215, 0.1, 0.28)),
        # The carapace's rim, a little proud of the dome.
        Prim('ell', 'body', k=0.03, c=V(0.0, -0.022, -0.03), r=V(0.3, 0.022, 0.39)),
        Prim('plane', 'body', op='cut', o=V(0.0, -0.046, 0.0), n=V(0.0, -1.0, 0.0), lo=V(-0.4, -0.2, -0.5), hi=V(0.4, 0.2, 0.5)),
        Prim('ell', 'body', k=0.025, c=V(0.0, -0.045, -0.02), r=V(0.24, 0.026, 0.33)),
    ]
    head = {'along': 0.05, 'pivot': V(0.0, -0.01, 0.31), 'span': V(0.0, 0.0, 1.0), 'reach': 0.22}
    prims.append(Prim('cone', 'head', k=0.025, a=V(0.0, -0.012, 0.3), b=V(0.0, 0.0, 0.42), r1=0.058, r2=0.052, meta=head))
    prims.append(Prim('ell', 'head', k=0.02, c=V(0.0, 0.012, 0.458), r=V(0.06, 0.055, 0.078), meta=head))
    prims.append(Prim('ell', 'head', k=0.018, c=V(0.0, -0.004, 0.518), r=V(0.034, 0.033, 0.034), meta=head))
    for side in (1, -1):
        prims.append(Prim('ell', 'eye', k=0.006, c=V(side * 0.051, 0.027, 0.478), r=V(0.012, 0.011, 0.014),
                          meta={'side': side, **head}))
    us, lead, trail = planform(0.5, 0.13, 0.03, sweep=0.085, tip_round=0.15, trail_bulge=0.035)
    prims += both(fin('pectoral', V(0.19, -0.022, 0.2), V(1.0, -0.08, -0.32), V(0, 0, -1), us, lead, trail,
                      0.022 - 0.016 * us / 0.5, k=0.03, tmin=0.003, side=1, along=0.33))
    us, lead, trail = planform(0.16, 0.085, 0.055, sweep=0.0, tip_round=0.5)
    prims += both(fin('rear', V(0.11, -0.036, -0.3), V(0.55, -0.05, -0.85), V(0, 0, -1), us, lead, trail,
                      0.012 - 0.006 * us / 0.16, k=0.022, tmin=0.003, side=1, along=0.84))
    prims.append(Prim('cone', 'body', k=0.02, a=V(0.0, -0.03, -0.37), b=V(0.0, -0.036, -0.455), r1=0.02, r2=0.006))

    def masks(P, N, part, s):
        on_body = part == PARTS['body']
        shell = on_body * _smooth(-0.03, -0.012, P[:, 1]) * _smooth(-0.2, 0.1, N[:, 1])
        plastron = on_body * _smooth(-0.03, -0.045, P[:, 1]) * _smooth(0.0, -0.4, N[:, 1])
        return shell, plastron

    return prims, {
        'family': 'turtle', 'voxel': 0.0024, 'triangles': 3200, 'masks': masks,
        'nose': 0.545, 'tail': -0.46,
    }


# ── Ocean sunfish ───────────────────────────────────────────────────────────────


def sunfish():
    rows = [
        (0.000, 0.020, 0.030, 0.0),
        (0.030, 0.045, 0.110, 0.0),
        (0.100, 0.075, 0.200, 0.0),
        (0.200, 0.092, 0.262, 0.0),
        (0.320, 0.098, 0.290, 0.0),
        (0.450, 0.094, 0.295, 0.0),
        (0.580, 0.084, 0.285, 0.0),
        (0.700, 0.070, 0.260, 0.0),
        (0.800, 0.054, 0.225, 0.0),
        (0.870, 0.040, 0.190, 0.0),
    ]
    body = body_chain(rows, step=0.012, k=0.016)
    prims = list(body)
    prims.append(Prim('ell', 'body', k=0.02, c=V(0.0, 0.0, 0.5), r=V(0.026, 0.03, 0.03)))
    for side in (1, -1):
        prims.append(eye(body, 0.36, 0.07, 0.019, side, depth=0.35))
    # The clavus: the scalloped rim the body ends in, in place of a tail.
    us = np.linspace(-0.215, 0.215, 41)
    f = us / 0.215
    lead = -0.01 + 0.02 * f * f
    trail = 0.085 - 0.05 * f ** 2 + 0.011 * np.abs(np.sin(f * np.pi * 4.5))
    prims.append(fin('tail', V(0.0, 0.0, -0.355), V(0.0, 1.0, 0.0), V(0, 0, -1), us, lead, trail,
                     0.03 - 0.016 * np.abs(f), k=0.03, tmin=0.004))
    # The tall fins above and below: they scull together, each bending from its root.
    us, lead, trail = planform(0.36, 0.17, 0.075, sweep=0.06, tip_round=0.35)
    prims.append(fin('dorsal', V(0.0, 0.25, -0.06), V(0.0, 1.0, -0.33), V(0, 0, -1), us, lead, trail,
                     0.028 - 0.016 * us / 0.36, k=0.03, tmin=0.0035, along=0.6))
    prims.append(fin('rear', V(0.0, -0.25, -0.06), V(0.0, -1.0, -0.33), V(0, 0, -1), us, lead, trail,
                     0.028 - 0.016 * us / 0.36, k=0.03, tmin=0.0035, along=0.6))
    us, lead, trail = planform(0.06, 0.055, 0.035, sweep=0.0, tip_round=0.5)
    prims += both(fin('pectoral', V(0.075, 0.03, 0.15), V(0.8, 0.25, -0.6), V(0, 0, -1), us, lead, trail,
                      0.008, k=0.012, tmin=0.003, side=1, along=0.36))

    def masks(P, N, part, s):
        gill = _smooth(0.012, 0.004, np.hypot(P[:, 1] - 0.04, P[:, 2] - 0.19)) * (part == PARTS['body'])
        mouth = _smooth(0.03, 0.012, np.hypot(P[:, 1], P[:, 2] - 0.525) * 0.7)
        return mouth, gill

    return prims, {
        'family': 'mola', 'voxel': 0.0034, 'triangles': 3000, 'masks': masks, 'adapt': 0.2,
        'nose': 0.53, 'tail': -0.45,
    }


#: The cast, in the order the runtime numbers them.
CAST = {
    'humpback': humpback,
    'blueWhale': blue_whale,
    'dolphin': dolphin,
    'whaleShark': whale_shark,
    'hammerhead': hammerhead,
    'manta': manta,
    'eagleRay': eagle_ray,
    'turtle': turtle,
    'sunfish': sunfish,
}
