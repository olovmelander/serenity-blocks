"""
Erosion for Odyssey's massif (2026-11-25): rain and frost on the designed form.

  rain    droplets run down the surface carrying sediment, cutting where they speed up and dropping
          it where they slow: gullies that join into couloirs, fans at their feet. Vectorised: a batch
          of droplets steps together, their cuts and drops summed with bincount.
  beds    the rock is not one rock: a few hard beds, each its own height, thickness and dip, present in
          patches, resist the rain (they stand as broken cliff bands, tens of metres apart, never a
          stack of equal steps).
  frost   loose ground steeper than its angle of rest slides down (soft rock only; hard beds keep cliffs).

Heights are world units; the droplets work in posts (a height h / step, so a slope is rise per run).
"""

import numpy as np

from terrain import Noise2, blur, fbm, smoothstep

# The hard beds: base height (u), thickness (u), resistance (x), dip (u per u along x, z), patch scale.
BEDS = [
    dict(h=645, t=9, r=3.5, dip=(0.05, -0.03), patch=170, seed=21),
    dict(h=598, t=13, r=4.5, dip=(0.04, 0.02), patch=210, seed=22),
    dict(h=702, t=8, r=3.0, dip=(-0.03, 0.05), patch=150, seed=23),
    dict(h=768, t=16, r=5.0, dip=(0.06, 0.01), patch=240, seed=24),
    dict(h=884, t=10, r=4.0, dip=(0.02, -0.04), patch=180, seed=25),
]


class Rock:
    """Resistance of the rock at a post and a height."""

    def __init__(self, grid, apex):
        self.grid = grid
        U = grid.X - apex[0]
        V = grid.Z - apex[1]
        self.beds = []
        for b in BEDS:
            nz = Noise2(b['seed'])
            present = smoothstep(0.42, 0.62, fbm(nz, U / b['patch'], V / b['patch'], 3))
            shift = b['dip'][0] * U + b['dip'][1] * V + (fbm(Noise2(b['seed'] + 50), U / 300.0, V / 300.0, 2) - 0.5) * 30
            self.beds.append((b, present.ravel(), shift.ravel()))

    def resistance(self, cell, h):
        # Below the treeline the forest holds the soil: the rain cuts the bare mountain, not the woods.
        r = 1.0 + 3.0 * (1.0 - smoothstep(480.0, 580.0, h))
        for b, present, shift in self.beds:
            dz = (h - (b['h'] + shift[cell])) / b['t']
            r += (b['r'] - 1) * present[cell] * np.exp(-dz * dz)
        return r

    def field(self, H):
        cell = np.arange(H.size)
        return self.resistance(cell, H.ravel()).reshape(H.shape)


def rain(H, grid, rock, spawn, drops=240000, batch=6000, seed=5, life=72,
         inertia=0.1, cap_factor=4.0, min_cap=0.01, erode=0.3, deposit=0.3, evaporate=0.02,
         gravity=4.0, radius=2, scale=4.0, max_cut=0.06, max_vel=6.0):
    """Droplet erosion. `spawn` is a weight per post (where rain may start). Returns the eroded height,
    the flow (water that passed each post) and the deposition (sediment left there).
    The droplets see heights in posts / `scale` (a 45 degree face falls 0.25 a step), which keeps them in
    the regime the rule is stable in; no droplet cuts more than `max_cut` a step or runs faster than `max_vel`."""
    n = grid.n
    step = grid.step * scale
    h = (H / step).ravel().astype(np.float64)
    flow = np.zeros(n * n)
    depo = np.zeros(n * n)
    rng = np.random.RandomState(seed)

    # The cut's brush: posts within `radius`, weighted by closeness.
    offs = []
    for dj in range(-radius, radius + 1):
        for di in range(-radius, radius + 1):
            d = np.hypot(di, dj)
            if d < radius:
                offs.append((di, dj, radius - d))
    offs = np.asarray(offs)
    bw = offs[:, 2] / offs[:, 2].sum()
    odi = offs[:, 0].astype(np.int64)
    odj = offs[:, 1].astype(np.int64)

    p = spawn.ravel() / spawn.sum()
    cells = np.arange(n * n)
    done = 0
    while done < drops:
        m = min(batch, drops - done)
        done += m
        start = rng.choice(cells, size=m, p=p)
        px = (start % n) + rng.uniform(0, 1, m)
        pz = (start // n) + rng.uniform(0, 1, m)
        dx = np.zeros(m)
        dz = np.zeros(m)
        vel = np.ones(m)
        water = np.ones(m)
        sed = np.zeros(m)
        alive = np.ones(m, bool)
        for _ in range(life):
            if not alive.any():
                break
            a = np.nonzero(alive)[0]
            x = px[a]
            z = pz[a]
            i = np.floor(x).astype(np.int64)
            j = np.floor(z).astype(np.int64)
            ok = (i >= radius) & (j >= radius) & (i < n - 1 - radius) & (j < n - 1 - radius)
            alive[a[~ok]] = False
            a = a[ok]
            if a.size == 0:
                break
            x = px[a]
            z = pz[a]
            i = np.floor(x).astype(np.int64)
            j = np.floor(z).astype(np.int64)
            u = x - i
            v = z - j
            c00 = j * n + i
            h00 = h[c00]
            h10 = h[c00 + 1]
            h01 = h[c00 + n]
            h11 = h[c00 + n + 1]
            hh = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v
            gx = (h10 - h00) * (1 - v) + (h11 - h01) * v
            gz = (h01 - h00) * (1 - u) + (h11 - h10) * u
            ndx = dx[a] * inertia - gx * (1 - inertia)
            ndz = dz[a] * inertia - gz * (1 - inertia)
            L = np.hypot(ndx, ndz)
            still = L < 1e-9
            ang = rng.uniform(0, 2 * np.pi, a.size)
            ndx = np.where(still, np.cos(ang), ndx / np.maximum(L, 1e-9))
            ndz = np.where(still, np.sin(ang), ndz / np.maximum(L, 1e-9))
            dx[a] = ndx
            dz[a] = ndz
            nx = x + ndx
            nz = z + ndz
            inside = (nx >= 1) & (nz >= 1) & (nx < n - 2) & (nz < n - 2)
            nh = np.where(inside, 0.0, hh)
            ii = np.clip(np.floor(nx).astype(np.int64), 0, n - 2)
            jj = np.clip(np.floor(nz).astype(np.int64), 0, n - 2)
            uu = np.clip(nx - ii, 0, 1)
            vv = np.clip(nz - jj, 0, 1)
            cc = jj * n + ii
            nh = np.where(inside, (h[cc] * (1 - uu) + h[cc + 1] * uu) * (1 - vv) + (h[cc + n] * (1 - uu) + h[cc + n + 1] * uu) * vv, nh)
            dh = nh - hh
            w = water[a]
            sv = sed[a]
            vl = vel[a]
            cap = np.maximum(-dh, min_cap) * vl * w * cap_factor
            dep = (sv > cap) | (dh > 0)
            # deposit at the four posts round the old place
            amt = np.where(dh > 0, np.minimum(dh, sv), (sv - cap) * deposit)
            amt = np.where(dep, np.maximum(amt, 0), 0.0)
            sv = sv - amt
            wts = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v]
            idxs = [c00, c00 + 1, c00 + n, c00 + n + 1]
            add = np.zeros(n * n)
            for ix, wt in zip(idxs, wts):
                add += np.bincount(ix, weights=amt * wt, minlength=n * n)
            # cut where it runs fast, by the rock's resistance at that height
            res = rock.resistance(c00, hh * step)
            cut = np.where(dep, 0.0, np.minimum((cap - sv) * erode / res, -dh))
            cut = np.clip(cut, 0, max_cut)
            sv = sv + cut
            ci = (i[:, None] + odi[None, :])
            cj = (j[:, None] + odj[None, :])
            cidx = (cj * n + ci).ravel()
            sub = np.bincount(cidx, weights=(cut[:, None] * bw[None, :]).ravel(), minlength=n * n)
            h += add - sub
            depo += add
            flow += np.bincount(c00, weights=w, minlength=n * n)
            vel[a] = np.minimum(np.sqrt(np.maximum(vl * vl + (-dh) * gravity, 0.0)), max_vel)
            sed[a] = sv
            water[a] = w * (1 - evaporate)
            px[a] = nx
            pz[a] = nz
            dead = (~inside) | (water[a] < 0.05)
            alive[a[dead]] = False
    return (h.reshape(n, n) * step), flow.reshape(n, n), depo.reshape(n, n) * step


def frost(H, grid, rock, mask, iters=40, angle_deg=44.0, rate=0.22):
    """Loose ground steeper than its rest slides down; hard beds hold (with no `rock`, nothing holds: the
    last pass caps every face at a slope the world's lattice can carry). Works on posts, 4 neighbours."""
    step = grid.step
    talus = np.tan(np.radians(angle_deg)) * step
    h = H.copy()
    soft = 1.0 / rock.field(h) if rock is not None else 1.0
    for _ in range(iters):
        move = np.zeros_like(h)
        for dj, di in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nb = np.roll(np.roll(h, dj, 0), di, 1)
            d = h - nb - talus
            m = np.where(d > 0, d * rate * 0.5, 0.0) * soft * mask
            move -= m
            move += np.roll(np.roll(m, -dj, 0), -di, 1)
        h += move
    return h


def cliff_bands(H, rock, mask, grid, amp=7.0):
    """Each hard bed, where it is present, stands as a step: the ground just above it is lifted and just under
    it lowered (a tanh across the bed), so the face is a cliff at the bed and a bench above it. Five beds at
    their own heights, broken into patches: never a stack of equal steps."""
    h = H.ravel().copy()
    out = h.copy()
    for b, present, shift in rock.beds:
        z = (h - (b['h'] + shift)) / (b['t'] * 1.4)
        out += amp * (b['r'] / 4.0) * present * np.tanh(z) * np.exp(-0.5 * (z / 4.0) ** 2)
    return H + (out.reshape(H.shape) - H) * mask


def crisp(H, mask, grid, foot, amount=0.55, sigma=2.5):
    """An unsharp mask on the mountain (above its skirt): crests and gully lips sharper, nothing new made."""
    from terrain import blur
    hi = H - blur(H, sigma)
    w = mask * smoothstep(foot + 250, foot + 380, H)
    return H + amount * hi * w


def limit_slope(H, grid, mask, angle_deg=73.0, iters=60):
    """No face steeper than `angle_deg` (the world's lattice carries no steeper; odyssey-world-height.test.js):
    the ground at the foot of a steeper step is raised to the limit, which lays a scree apron under every
    cliff and leaves the crests where they are. Four neighbours and the diagonals."""
    step = grid.step
    t1 = np.tan(np.radians(angle_deg)) * step
    t2 = t1 * np.sqrt(2.0)
    h = H.copy()
    on = mask > 0.02
    for _ in range(iters):
        p = np.pad(h, 1, mode='edge')
        n = h.shape[0]
        lim = np.maximum.reduce([
            p[1:n + 1, 0:n] - t1, p[1:n + 1, 2:n + 2] - t1, p[0:n, 1:n + 1] - t1, p[2:n + 2, 1:n + 1] - t1,
            p[0:n, 0:n] - t2, p[0:n, 2:n + 2] - t2, p[2:n + 2, 0:n] - t2, p[2:n + 2, 2:n + 2] - t2,
        ])
        nh = np.where(on, np.maximum(h, lim), h)
        if np.abs(nh - h).max() < 1e-3:
            h = nh
            break
        h = nh
    return h


def flow_field(flow, sigma=1.2):
    """Where water gathers, 0..1 (log of the water that passed, softened)."""
    f = np.log1p(blur(flow, sigma))
    lo, hi = np.percentile(f, [50, 99.7])
    return np.clip((f - lo) / max(hi - lo, 1e-6), 0, 1)
