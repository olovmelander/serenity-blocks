"""
The massif's designed form (2026-11-25): the shape erosion then works on.

The old hero was a radial cone, (1 - d/603)^1.7 x 720, with small aretes and painted bands on it; every view
of it was a cone. This keeps the cone's VOLUME (the island's smooth macro form, so the mountain still meets
its meadows where it did) and draws a mountain on it from its RIDGES:

  the summit block   a short crest across the view, broader than the cone's needle: a main top, a notch and
                     a lower eastern top (absolute heights)
  the west arete     long and gentle, a gendarme, a col, the left shoulder's top, on west
  the east arete     shorter and steeper, a buttress step, the right shoulder, on east
  two south ribs     buttresses down the face the climb rides past, either side of the rail's line
  three north ridges the back of the mountain (seen from the climb's top and the far shores)
  faces              hollowed between the ridges, deepest half way up, nothing at the foot or the top
  a cirque           a bowl hung on the south-east face, between the east arete and its rib: snow lies in it

Every spine but the crest is a LIFT over the cone (u above it at that point), so ridges stand proud of the
volume by tens of units and fall away from their crest steeply; the faces between are lower than the cone.
Coordinates are relative to the hero's apex: u = x - ax (east), v = z - az (south, toward the meadows and the
climb). Heights in world units.
"""

import numpy as np

from terrain import Noise2, bilinear, catmull_rom, fbm, ridged, smax, smoothstep

# Crest points (u, v, absolute y). The macro cone's own top is 1017.5.
CREST = [(-42, 18, 898), (-22, 10, 944), (-2, 4, 922), (20, -2, 1030), (42, -6, 1076), (60, -10, 1050),
         (80, -14, 1022), (102, -18, 978)]
# (The main top stands ~40 u east of the old cone's apex: the summit's vultures circle a column that leans
# in to ~60 u west of the apex at 930 u, and the west arete drops to a col where they pass.)

# Ridges: (u, v, lift over the cone); `wid` how far its faces reach from the spine, `w` the crest's rounding (u).
RIDGES = [
    dict(name='west', wid=70.0, w=4.0, pts=[(-42, 18, 20), (-70, 26, 10), (-104, 36, 52), (-128, 42, 70), (-142, 46, 92),
                                        (-160, 54, 70), (-190, 64, 36), (-214, 72, 30), (-236, 80, 46),
                                        (-262, 86, 40), (-310, 96, 26), (-380, 108, 14), (-460, 118, 4),
                                        (-540, 126, 0)]),
    dict(name='east', wid=62.0, w=4.0, pts=[(102, -18, 70), (112, -12, 92), (132, -4, 104), (150, 2, 112),
                                        (164, 8, 70), (196, 24, 44), (226, 42, 40), (252, 52, 46),
                                        (290, 64, 28), (350, 78, 14), (420, 90, 6), (500, 98, 0)]),
    dict(name='rib-sw', wid=82.0, w=6.0, pts=[(-30, 12, 34), (-48, 70, 40), (-70, 140, 44), (-90, 210, 52),
                                          (-102, 262, 64), (-112, 320, 40), (-120, 400, 24), (-122, 480, 10),
                                          (-118, 560, 0)]),
    dict(name='rib-se', wid=82.0, w=6.0, pts=[(60, -10, 70), (84, 50, 54), (108, 120, 44), (126, 190, 40),
                                          (138, 250, 46), (148, 320, 30), (154, 400, 14), (152, 480, 0)]),
    dict(name='north', wid=80.0, w=5.0, pts=[(0, -6, 30), (-10, -80, 40), (-18, -170, 44), (-30, -280, 36),
                                         (-40, -400, 18), (-46, -520, 0)]),
    dict(name='north-east', wid=80.0, w=5.0, pts=[(66, -15, 60), (130, -90, 52), (200, -170, 40),
                                              (280, -260, 22), (360, -350, 0)]),
    dict(name='north-west', wid=80.0, w=5.0, pts=[(-40, 12, 40), (-110, -60, 46), (-190, -140, 38),
                                              (-270, -220, 20), (-350, -300, 0)]),
]


def spine(pts, per=14):
    """A ridge's spine, densely: rows (u, v, h)."""
    return catmull_rom(pts, per)


def lifts(U, V, sp, width, towers, rounding=3.0):
    """A ridge's lift over every post, and the lateral distance to its spine: at the nearest point of each
    segment, the spine's lift (its towers added) times a profile across it, (1 - d/width)^1.6 (steep under
    the crest, nothing past `width`), the crest rounded over `rounding` u."""
    A = sp[:-1]
    B = sp[1:]
    flat_u = U.ravel()
    flat_v = V.ravel()
    out = np.empty(flat_u.size)
    dist = np.empty(flat_u.size)
    chunk = 40000
    du = (B[:, 0] - A[:, 0])[None, :]
    dv = (B[:, 1] - A[:, 1])[None, :]
    L2 = np.maximum(du * du + dv * dv, 1e-9)
    for c0 in range(0, flat_u.size, chunk):
        pu = flat_u[c0:c0 + chunk, None]
        pv = flat_v[c0:c0 + chunk, None]
        t = np.clip(((pu - A[None, :, 0]) * du + (pv - A[None, :, 1]) * dv) / L2, 0, 1)
        qu = A[None, :, 0] + t * du
        qv = A[None, :, 1] + t * dv
        d = np.sqrt((pu - qu) ** 2 + (pv - qv) ** 2)
        lift = A[None, :, 2] + t * (B[:, 2] - A[:, 2])[None, :]
        s = (np.arange(A.shape[0])[None, :] + t)
        lift = lift + towers(s)
        dd = np.sqrt(d * d + rounding * rounding) - rounding
        prof = np.power(np.clip(1 - dd / width, 0, 1), 2.0)
        out[c0:c0 + chunk] = (lift * prof).max(axis=1)
        dist[c0:c0 + chunk] = d.min(axis=1)
    return out.reshape(U.shape), dist.reshape(U.shape)


def design(grid, apex, foot, cone, relief=None, seed=7):
    """The designed absolute height over the grid (before erosion). `cone` is the macro form on the grid;
    `relief` the island's relief there (relief x weight): kept on the lower mountain, where the forest
    climbs on its broad swells, and given over to the drawn ridges above the treeline."""
    ax, az = apex
    U = grid.X - ax
    V = grid.Z - az
    n1 = Noise2(seed)
    n2 = Noise2(seed + 1)
    # A slow warp: no spine is a ruled curve, and the faces between them wander.
    wu = (fbm(n1, U / 260.0, V / 260.0, 3) - 0.5) * 40
    wv = (fbm(n2, U / 260.0 + 5.2, V / 260.0 - 3.1, 3) - 0.5) * 40
    Uw = U + wu
    Vw = V + wv
    d = np.sqrt(U * U + V * V)

    def cone_at(u, v):
        fi, fj = grid.ij(np.asarray(u) + ax, np.asarray(v) + az)
        return bilinear(cone, fi, fj)

    tn = Noise2(seed + 2)

    def towers_for(name, nseg, amp):
        off = sum(ord(ch) * (i + 1) for i, ch in enumerate(name)) % 97  # stable across runs

        def towers(s):
            # gendarmes: bumps on stretches of the spine, none at its ends
            x = s / 5.0 + off
            bump = np.maximum(0, tn(x, off * 0.37) - 0.5) * amp
            return bump * np.clip(s / 6.0, 0, 1) * np.clip((nseg - s) / 10.0, 0, 1)
        return towers

    L = np.zeros(U.shape)
    near = np.full(U.shape, 1e9)
    # The crest: absolute heights, made lifts over the cone where it runs.
    sp = spine(CREST, per=10)
    sp[:, 2] = sp[:, 2] - cone_at(sp[:, 0], sp[:, 1])
    t, dist = lifts(Uw, Vw, sp, 58.0, towers_for('crest', len(sp) - 1, 10), 1.2)
    L = smax(L, t, 3.0)
    near = np.minimum(near, dist)
    for r in RIDGES:
        sp = spine(np.asarray(r['pts'], float))
        # A ridge stands proud above the forest only: below ~470 its lift fades, so the treeline's slopes
        # keep the gentle ground the groves climb on.
        sp[:, 2] = sp[:, 2] * smoothstep(foot + 170, foot + 300, cone_at(sp[:, 0], sp[:, 1]))
        t, dist = lifts(Uw, Vw, sp, r['wid'], towers_for(r['name'], len(sp) - 1, 22), r['w'] * 0.4)
        L = smax(L, t, 3.0)
        near = np.minimum(near, dist)

    # Faces: the cone hollowed away from the ridges, deepest high on the mountain, nothing at the top, and
    # nothing down where the forest climbs (the treeline's groves keep the height they were planted at).
    amp = 58 * smoothstep(25, 110, d) * smoothstep(foot + 265, foot + 365, cone)
    H = cone + L - amp * smoothstep(6, 95, near)
    if relief is not None:
        H = H + relief * (1 - smoothstep(foot + 230, foot + 380, cone))

    # The cirque: a bowl hung on the south-east face, its floor sloping out to a lip.
    cu, cv = 100, 140
    cd = np.sqrt(((Uw - cu) / 1.15) ** 2 + ((Vw - cv) / 0.95) ** 2)
    bowl = smoothstep(105, 25, cd)
    H = H - bowl * 46

    # Fine structure for the water to find: ridged noise at two scales, more on the steep upper body.
    rough = (ridged(Noise2(seed + 3), Uw / 70.0, Vw / 70.0, 4) - 0.55) * 18 + (fbm(Noise2(seed + 4), Uw / 24.0, Vw / 24.0, 3) - 0.5) * 7
    up = smoothstep(foot + 200, foot + 420, H)
    H = H + rough * (0.12 + 0.88 * up)
    return H, d
