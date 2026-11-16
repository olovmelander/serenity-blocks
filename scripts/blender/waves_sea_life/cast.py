"""Waves' sea life, each drawn from numbers as smooth masses and fins.

The animals that share the wave with the rider: the bottlenose dolphins that ride inside its face
and leap from it, the smaller spinner dolphins that corkscrew out of it, the flying fish that
skitter off the trough, the seabirds that glide the updraught along its shoulder, and, from the
Ocean's own cast (scripts/blender/ocean_creatures/cast.py), the humpback out at sea, the manta
and the green turtle seen through the glass of the wall.

Every animal is one unit long from its nose (+z) to the end of its tail (the bird: bill to tail;
a ray: one unit across its wings), y up. Each design returns its primitives (ocean_creatures.sdf
Prim) and what the runtime needs to know about it (src/themes/waves/waves-cast.js): its family,
where its body runs from and to along z, how many triangles it is given, and two pattern masks.

Families (how the runtime moves them, src/themes/waves/waves-fauna.js):
  0 whale   the body beats up and down, the flukes pitch after it, the flippers trim
  1 fish    the tail sweeps from side to side; the wings are held spread
  2 ray     the wings fly: a wave runs out along the span
  3 turtle  the front flippers row, the rear ones trail
  5 bird    the wings beat from the shoulder, the tips after the arms

Masks (packed per vertex beside the ambient occlusion): what the first two mean is the animal's
own: the dolphins' are the dark cape over the back and the pale belly; the fish's are its blue
back and its wings' clear membranes; the bird's are its grey mantle and its black wing tips.
"""

import numpy as np

from ocean_creatures import cast as ocean
from ocean_creatures.cast import PARTS, both, eye, groove, lip_line, notch_wave, surface_point
from ocean_creatures.sdf import V, Prim, body_chain, fin, planform

FAMILIES = {'whale': 0, 'fish': 1, 'ray': 2, 'turtle': 3, 'bird': 5}


def _smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ── Dolphins ────────────────────────────────────────────────────────────────────


def bottlenose():
    """The big grey dolphin of every coast: a deep chest, a short stout beak under a round melon,
    a tall hooked dorsal fin, broad flukes."""
    rows = [
        (0.000, 0.008, 0.007, -0.017),
        (0.028, 0.018, 0.014, -0.018),
        (0.058, 0.024, 0.019, -0.017),
        (0.082, 0.036, 0.034, -0.006),
        (0.115, 0.051, 0.056, 0.000),
        (0.175, 0.069, 0.077, 0.000),
        (0.265, 0.086, 0.094, -0.002),
        (0.365, 0.091, 0.099, -0.002),
        (0.465, 0.084, 0.093, 0.000),
        (0.565, 0.069, 0.081, 0.002),
        (0.665, 0.049, 0.067, 0.003),
        (0.755, 0.030, 0.053, 0.003),
        (0.835, 0.017, 0.039, 0.002),
        (0.892, 0.010, 0.022, 0.000),
    ]
    body = body_chain(rows, step=0.01, k=0.012)
    # The melon, proud of the beak: the crease between them is what makes the face a dolphin's.
    body.append(Prim('ell', 'body', k=0.022, c=V(0.0, 0.021, 0.386), r=V(0.047, 0.05, 0.068)))
    # The keel of the tail stock, above and below.
    body.append(Prim('ell', 'body', k=0.02, c=V(0.0, 0.0, -0.27), r=V(0.012, 0.05, 0.11)))
    prims = list(body)
    for side in (1, -1):
        # The mouth line: back from the tip of the beak, turning up under the eye.
        zs = np.linspace(0.496, 0.385, 9)
        ys = -0.018 + 0.016 * ((0.496 - zs) / 0.111) ** 1.8
        prims += groove(body, lip_line(body, zs, ys, side, inset=-0.0004), 0.0028)
        prims.append(eye(body, 0.372, -0.003, 0.0088, side))
    # The blowhole.
    prims.append(Prim('ell', 'body', k=0.004, op='sub', c=V(0.0, 0.082, 0.325), r=V(0.008, 0.006, 0.008)))
    root = surface_point(body, V(0.0, -0.056, 0.25), V(1, 0, 0)) - V(0.012, 0.0, 0.0)
    us, lead, trail = planform(0.155, 0.062, 0.012, sweep=0.055, tip_round=0.14, trail_bulge=-0.006)
    prims += both(fin('pectoral', root, V(1.0, -0.55, -0.62), V(0, 0, -1), us, lead, trail,
                      0.0105 - 0.0075 * us / 0.155, k=0.016, tmin=0.0026, side=1, along=0.25))
    # The dorsal fin: tall, swept, hooked at the tip.
    us, lead, trail = planform(0.135, 0.135, 0.02, sweep=0.125, tip_round=0.2, trail_bulge=-0.04)
    prims.append(fin('dorsal', V(0.0, 0.088, 0.07), V(0.0, 1.0, -0.66), V(0, 0, -1), us, lead, trail,
                     0.012 - 0.0085 * us / 0.135, k=0.018, tmin=0.0026))
    us, lead, trail = planform(0.145, 0.078, 0.013, sweep=0.072, tip_round=0.12, trail_wave=notch_wave(0.012, 0.07))
    prims += both(fin('tail', V(0.0, 0.0, -0.378), V(1.0, 0.0, -0.2), V(0, 0, -1), us, lead, trail,
                      0.012 * (1 - 0.75 * us / 0.145), k=0.012, tmin=0.0026, side=1))

    def masks(P, N, part, s):
        # The cape: the dark saddle from the melon back past the dorsal fin, fading down the flank.
        cape = _smooth(0.1, 0.62, N[:, 1]) * _smooth(0.07, 0.15, s) * (1 - _smooth(0.6, 0.8, s))
        cape = np.maximum(cape, (part == PARTS['dorsal']) * 1.0)
        cape = np.maximum(cape, (part == PARTS['tail']) * 0.8)
        cape = np.maximum(cape, (part == PARTS['pectoral']) * _smooth(-0.2, 0.3, N[:, 1]) * 0.8)
        # The belly: pale from the chin to the vent, rising a little toward the eye.
        belly = _smooth(-0.1, -0.62, N[:, 1]) * (1 - _smooth(0.66, 0.8, s)) * (part == PARTS['body'])
        return cape, belly

    return prims, {
        'family': 'whale', 'voxel': 0.002, 'triangles': 5200, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


def spinner():
    """The small slender dolphin of the open tropics: a long thin beak, a fin that stands almost
    upright, and three tones laid in bands: a dark cape, a grey flank, a white belly."""
    rows = [
        (0.000, 0.005, 0.0045, -0.012),
        (0.045, 0.0105, 0.009, -0.013),
        (0.092, 0.015, 0.0135, -0.012),
        (0.113, 0.028, 0.029, -0.004),
        (0.150, 0.042, 0.046, 0.000),
        (0.220, 0.056, 0.062, 0.000),
        (0.310, 0.066, 0.073, -0.001),
        (0.410, 0.067, 0.074, 0.000),
        (0.510, 0.060, 0.069, 0.001),
        (0.610, 0.047, 0.059, 0.002),
        (0.710, 0.031, 0.047, 0.002),
        (0.800, 0.018, 0.035, 0.002),
        (0.865, 0.011, 0.023, 0.001),
        (0.902, 0.008, 0.014, 0.000),
    ]
    body = body_chain(rows, step=0.01, k=0.011)
    body.append(Prim('ell', 'body', k=0.02, c=V(0.0, 0.014, 0.368), r=V(0.035, 0.037, 0.054)))
    body.append(Prim('ell', 'body', k=0.018, c=V(0.0, 0.0, -0.29), r=V(0.009, 0.042, 0.1)))
    prims = list(body)
    for side in (1, -1):
        zs = np.linspace(0.497, 0.375, 9)
        ys = -0.0125 + 0.011 * ((0.497 - zs) / 0.122) ** 2.0
        prims += groove(body, lip_line(body, zs, ys, side, inset=-0.0003), 0.0021)
        prims.append(eye(body, 0.36, -0.002, 0.0074, side))
    root = surface_point(body, V(0.0, -0.042, 0.245), V(1, 0, 0)) - V(0.009, 0.0, 0.0)
    us, lead, trail = planform(0.15, 0.046, 0.009, sweep=0.05, tip_round=0.12)
    prims += both(fin('pectoral', root, V(1.0, -0.6, -0.66), V(0, 0, -1), us, lead, trail,
                      0.0085 - 0.006 * us / 0.15, k=0.013, tmin=0.0024, side=1, along=0.255))
    # The dorsal fin: a triangle that stands nearly straight up.
    us, lead, trail = planform(0.108, 0.105, 0.012, sweep=0.05, tip_round=0.14)
    prims.append(fin('dorsal', V(0.0, 0.066, 0.065), V(0.0, 1.0, -0.22), V(0, 0, -1), us, lead, trail,
                     0.01 - 0.007 * us / 0.108, k=0.015, tmin=0.0024))
    us, lead, trail = planform(0.118, 0.06, 0.01, sweep=0.058, tip_round=0.12, trail_wave=notch_wave(0.009, 0.07))
    prims += both(fin('tail', V(0.0, 0.0, -0.39), V(1.0, 0.0, -0.2), V(0, 0, -1), us, lead, trail,
                      0.0105 * (1 - 0.75 * us / 0.118), k=0.011, tmin=0.0024, side=1))

    def masks(P, N, part, s):
        # The cape is narrow and sharp-edged; the belly's white reaches well up the flank.
        cape = _smooth(0.5, 0.72, N[:, 1]) * _smooth(0.09, 0.14, s) * (1 - _smooth(0.66, 0.82, s))
        cape = np.maximum(cape, (part == PARTS['dorsal']) * 1.0)
        cape = np.maximum(cape, (part == PARTS['tail']) * 0.9)
        cape = np.maximum(cape, (part == PARTS['pectoral']) * 0.9)
        # The stripe from the eye to the flipper.
        stripe = (_smooth(0.022, 0.008, np.abs(P[:, 1] + 0.006 + 0.3 * (0.36 - P[:, 2]) ** 1.0))
                  * _smooth(0.12, 0.14, s) * (1 - _smooth(0.24, 0.27, s)) * (part == PARTS['body']))
        cape = np.maximum(cape, stripe * 0.85)
        belly = _smooth(0.12, -0.3, N[:, 1]) * (1 - _smooth(0.7, 0.84, s)) * (part == PARTS['body'])
        return cape, belly * (1 - stripe)

    return prims, {
        'family': 'whale', 'voxel': 0.0019, 'triangles': 3400, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


# ── Flying fish ─────────────────────────────────────────────────────────────────


def flying_fish():
    """A cigar of a fish with wings: pectoral fins two thirds of its length, a second, smaller pair
    behind them, and a tail whose lower lobe is the longer one (it sculls the water with it to
    take off)."""
    rows = [
        (0.000, 0.014, 0.016, 0.000),
        (0.035, 0.034, 0.038, 0.002),
        (0.110, 0.051, 0.056, 0.002),
        (0.240, 0.060, 0.066, 0.000),
        (0.390, 0.059, 0.064, 0.000),
        (0.540, 0.049, 0.054, 0.000),
        (0.680, 0.034, 0.040, 0.000),
        (0.780, 0.022, 0.029, 0.000),
        (0.845, 0.015, 0.023, 0.000),
    ]
    body = body_chain(rows, step=0.012, k=0.014)
    prims = list(body)
    for side in (1, -1):
        prims.append(eye(body, 0.42, 0.012, 0.019, side, depth=0.4))
    # The wings: long, swept, a little raised; held spread in the glide.
    root = surface_point(body, V(0.0, 0.022, 0.27), V(1, 0, 0)) - V(0.012, 0.0, 0.0)
    us, lead, trail = planform(0.56, 0.15, 0.04, sweep=0.2, tip_round=0.2, trail_bulge=0.03)
    prims += both(fin('pectoral', root, V(1.0, 0.1, -0.22), V(0, 0, -1), us, lead, trail,
                      0.0075 - 0.004 * us / 0.56, k=0.012, tmin=0.0032, side=1, along=0.23,
                      bow=0.02 * (us / 0.56) ** 2))
    # The second pair, behind and below.
    root = surface_point(body, V(0.0, -0.03, -0.07), V(1, 0, 0)) - V(0.01, 0.0, 0.0)
    us, lead, trail = planform(0.24, 0.1, 0.03, sweep=0.09, tip_round=0.25, trail_bulge=0.012)
    prims += both(fin('rear', root, V(1.0, -0.08, -0.3), V(0, 0, -1), us, lead, trail,
                      0.006, k=0.01, tmin=0.003, side=1, along=0.57))
    us, lead, trail = planform(0.06, 0.1, 0.03, sweep=0.04, tip_round=0.3)
    prims.append(fin('dorsal', V(0.0, 0.03, -0.2), V(0.0, 1.0, -0.8), V(0, 0, -1), us, lead, trail,
                     0.005, k=0.008, tmin=0.003))
    # The tail: forked deep, the lower lobe half as long again as the upper.
    us, lead, trail = planform(0.16, 0.06, 0.016, sweep=0.03, tip_round=0.15)
    prims.append(fin('tail', V(0.0, 0.004, -0.33), V(0.0, 1.0, -1.25), V(0, 0, -1), us, lead, trail,
                     0.008 * (1 - 0.6 * us / 0.16), k=0.01, tmin=0.003))
    us, lead, trail = planform(0.23, 0.062, 0.016, sweep=0.03, tip_round=0.12)
    prims.append(fin('tail', V(0.0, -0.004, -0.33), V(0.0, -1.0, -1.1), V(0, 0, -1), us, lead, trail,
                     0.008 * (1 - 0.6 * us / 0.23), k=0.01, tmin=0.003))

    def masks(P, N, part, s):
        back = _smooth(-0.05, 0.5, N[:, 1]) * (part == PARTS['body'])
        membrane = ((part == PARTS['pectoral']) | (part == PARTS['rear'])) * 1.0
        return back, membrane

    return prims, {
        'family': 'fish', 'voxel': 0.0024, 'triangles': 1100, 'masks': masks,
        'nose': 0.5, 'tail': -0.5,
    }


# ── Seabird ─────────────────────────────────────────────────────────────────────


def seabird():
    """A shearwater's build: a torpedo of a body, a slim bill, and long narrow wings held stiff,
    made to glide a wave's length on one beat."""
    rows = [
        (0.000, 0.005, 0.005, -0.004),
        (0.055, 0.011, 0.011, -0.003),
        (0.095, 0.029, 0.031, 0.006),
        (0.150, 0.036, 0.038, 0.009),
        (0.215, 0.036, 0.035, 0.005),
        (0.320, 0.062, 0.057, 0.000),
        (0.460, 0.076, 0.066, -0.004),
        (0.610, 0.062, 0.05, -0.001),
        (0.740, 0.04, 0.03, 0.004),
        (0.840, 0.036, 0.013, 0.007),
        (0.950, 0.04, 0.006, 0.008),
    ]
    body = body_chain(rows, step=0.012, k=0.016)
    prims = list(body)
    for side in (1, -1):
        prims.append(eye(body, 0.365, 0.014, 0.008, side, depth=0.4))
    # The wings: each as long as the body, narrow, the hand swept back from the wrist.
    root = V(0.05, 0.022, 0.12)
    us, lead, trail = planform(1.02, 0.2, 0.045, sweep=0.2, tip_round=0.22, trail_bulge=-0.02, tip_power=1.3,
                               lead_wave=lambda f: -0.05 * np.sin(np.pi * np.clip(f / 0.55, 0, 1)) ** 2)
    f = us / 1.02
    prims += both(fin('pectoral', root, V(1.0, 0.0, 0.0), V(0, 0, -1), us, lead, trail,
                      0.014 - 0.009 * f, k=0.02, tmin=0.0034, side=1, along=0.38,
                      bow=0.035 * np.sin(np.pi * np.clip(f / 0.9, 0, 1)) - 0.03 * f * f))

    def masks(P, N, part, s):
        on_wing = part == PARTS['pectoral']
        mantle = _smooth(-0.1, 0.35, N[:, 1])
        tips = on_wing * _smooth(0.62, 0.9, np.abs(P[:, 0]) / 1.07)
        return mantle, tips

    return prims, {
        'family': 'bird', 'voxel': 0.0036, 'triangles': 900, 'masks': masks,
        'nose': 0.5, 'tail': -0.46,
    }


# ── From the Ocean's cast ───────────────────────────────────────────────────────


def _with(design, **changes):
    def made():
        prims, meta = design()
        return prims, {**meta, **changes}
    return made


#: The cast, in the order the runtime numbers them.
CAST = {
    'bottlenose': bottlenose,
    'spinner': spinner,
    'humpback': _with(ocean.humpback, triangles=5200),
    'manta': _with(ocean.manta, triangles=2600),
    'turtle': _with(ocean.turtle, triangles=2400),
    'flyingFish': flying_fish,
    'seabird': seabird,
}
