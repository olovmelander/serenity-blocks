"""
The photographs (Odyssey's forest, 2026-11-24).

  leaf atlas   every spray, straight on, 128 px a tile (families.atlas_plan). The near trees' cards draw it.
  far atlas    every specimen from 8 sides at 2 heights, 80 px a tile. The far trees are one of these each.

Both are RGBA data, never colour (the game paints each tree its own colours):
  R  coverage
  G  the surface's facing, across the picture (0.5 straight on)
  B  ... and up it
  A  the light it keeps, in bands by what it is:
       wood    0.00 .. 0.18
       leaf    0.22 .. 0.86   (its own occlusion times its tone)
       flower  0.90 .. 1.00   (white flower on a green bush; a cherry's petals are its leaves)
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix

import families
import preview
import studio
from growth import rng_of, wood_mesh

WOOD = (0.0, 0.18)
LEAF = (0.22, 0.86)
FLOWER = (0.90, 1.0)


def band(value, lohi):
    return lohi[0] + (lohi[1] - lohi[0]) * np.clip(value, 0, 1)


def fill_out(rgb, alpha, rounds=10):
    """Carry the colours out past the edge, so filtering never mixes in what is not there."""
    known = alpha > 0.02
    a = rgb.copy()
    w = known.astype(np.float32)
    for _ in range(rounds):
        acc = a * w[..., None]
        ws = w.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            acc = acc + np.roll(np.roll(a * w[..., None], dy, 0), dx, 1)
            ws = ws + np.roll(np.roll(w, dy, 0), dx, 1)
        new = acc / np.maximum(ws[..., None], 1e-6)
        grow = (w < 0.5) & (ws > 0)
        a = np.where(grow[..., None], new, a)
        w = np.where(grow, 1.0, w)
    return a, w


def coverage_curve(cov, tile, cuts=(1, 2, 3, 4, 5)):
    """The alpha cut at each mip that keeps a tile's covered share what it is at mip 0 (cut 0.5), averaged."""
    out = [0.5]
    a = cov
    full = (a > 0.5).mean()
    for m in cuts:
        a = studio.downsample(a[..., None], 2)[..., 0]
        lo, hi = 0.02, 0.6
        for _ in range(24):
            mid = (lo + hi) / 2
            if (a > mid).mean() > full:
                lo = mid
            else:
                hi = mid
        out.append(round(float((lo + hi) / 2), 4))
    return out


def bake_leaf_atlas(path, over=4, samples=24):
    plan, index = families.atlas_plan()
    T = families.ATLAS_TILE
    C, R = families.ATLAS_COLS, families.ATLAS_ROWS
    sc = studio.scene('OdysseyForestAtlas')
    nm = studio.data_material('OF_bake_normal', 'normal')
    dm = studio.data_material('OF_bake_data', 'data', ao_dist=0.55)
    meshes = []
    for fam, kind, variant, tile in plan:
        v, t, tone, kd = families.make_spray(fam, kind, variant).arrays()
        me = studio.mesh_from('OF_at_%s_%s_%d' % (fam, kind, variant), v, t, {'tone': tone, 'kind': kd})
        me.materials.append(nm)
        x, y = tile % C, tile // C
        ob = studio.put(sc, me.name, me, None, (x * 2 + 1, y * 2 + 1, 0))
        me.materials.clear()
        me.materials.append(nm)
        meshes.append(me)
    studio.setup_render(sc, C * T * over, R * T * over, samples)
    studio.ortho_camera(sc, C * 2, (C, R, 30))
    N = studio.shoot(sc, 'of_atlas_n')
    for me in meshes:
        me.materials[0] = dm
    D = studio.shoot(sc, 'of_atlas_d')
    al = D[..., 3]
    n = np.concatenate([N[..., :3], N[..., 3:4]], -1)
    nd = studio.downsample(n, over)
    dd = studio.downsample(D, over)
    cov = np.clip(dd[..., 3], 0, 1)
    nn = np.where(nd[..., 3:4] > 1e-3, nd[..., :3] / np.maximum(nd[..., 3:4], 1e-3), 0.5)
    data = np.where(dd[..., 3:4] > 1e-3, dd[..., :3] / np.maximum(dd[..., 3:4], 1e-3), 0.5)
    ao, tone, kind = data[..., 0], data[..., 1], data[..., 2] * 2
    # Each tile's own range, so every family uses the whole band.
    light = np.clip(ao, 0, 1) ** 0.85 * (0.42 + 0.58 * tone)
    val = np.zeros_like(light)
    plan_img = {}
    for fam, kd, variant, tile in plan:
        x, y = (tile % C) * T, (tile // C) * T
        s = np.s_[y:y + T, x:x + T]
        m = cov[s] > 0.4
        lf = light[s]
        lo, hi = np.percentile(lf[m & (kind[s] < 0.6)] if (m & (kind[s] < 0.6)).sum() > 20 else lf[m], [3, 97])
        if fam == 'cherry':
            lo, hi = np.percentile(lf[m], [3, 97])
        k = np.clip((lf - lo) / max(hi - lo, 1e-3), 0, 1)
        petal = np.clip((kind[s] - 1.2) / 0.6, 0, 1)
        wood = np.clip(1 - np.abs(kind[s] - 1) / 0.45, 0, 1)
        if fam == 'cherry':
            wood = np.clip(1 - np.abs(kind[s] - 1) / 0.30, 0, 1) * (lf < np.percentile(lf[m], 30))
            petal = petal * 0
        v = band(k, LEAF)
        v = v * (1 - wood) + band(0.25 + 0.75 * k, WOOD) * wood
        v = v * (1 - petal) + band(k, FLOWER) * petal
        val[s] = v
    rgb = np.stack([nn[..., 0], nn[..., 1], val], -1)
    filled, w = fill_out(rgb, cov, 14)
    for fam, kd, variant, tile in plan:
        x, y = (tile % C) * T, (tile // C) * T
        s = np.s_[y:y + T, x:x + T]
        mean = np.array([0.5, 0.5, val[s][cov[s] > 0.4].mean()])
        filled[s] = np.where(w[s][..., None] > 0.5, filled[s], mean)
    used = plan[-1][3] + 1
    out = np.zeros((R * T, C * T, 4), np.float32)
    bark = {61: bark_tile('rough', T), 62: bark_tile('birch', T), 63: bark_tile('plate', T)}
    out[..., 0] = cov
    out[..., 1] = filled[..., 0]
    out[..., 2] = filled[..., 1]
    out[..., 3] = filled[..., 2]
    for tile, pic in bark.items():
        x, y = (tile % C) * T, (tile // C) * T
        out[y:y + T, x:x + T] = pic
    used = max(used, 64)
    rows = int(math.ceil(used / C))
    curve = coverage_curve(cov[:rows * T], T)
    save_rgba(path, out, levels=(64, 64, 64, 128))
    cover = {}
    for fam, kd, variant, tile in plan:
        x, y = (tile % C) * T, (tile // C) * T
        cover.setdefault(fam + ':' + kd, []).append(round(float(cov[y:y + T, x:x + T].mean()), 3))
    return {'index': index, 'curve': curve, 'tiles': used, 'cover': cover}


def _noise(T, cells_u, cells_v, seed, octaves=4):
    """Tiling value noise, T x T, its cells stretched (the tile is 1 m round and 11 m up)."""
    rng = np.random.RandomState(seed)
    out = np.zeros((T, T))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cu, cv = cells_u * 2 ** o, cells_v * 2 ** o
        g = rng.uniform(size=(cv, cu))
        u = np.arange(T) / T * cu
        v = np.arange(T) / T * cv
        u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int)
        fu, fv = u - u0, v - v0
        fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
        a = g[v0 % cv][:, u0 % cu]
        b = g[v0 % cv][:, (u0 + 1) % cu]
        c = g[(v0 + 1) % cv][:, u0 % cu]
        d = g[(v0 + 1) % cv][:, (u0 + 1) % cu]
        out += amp * ((a * (1 - fu) + b * fu) * (1 - fv[:, None]) + (c * (1 - fu) + d * fu) * fv[:, None])
        total += amp
        amp *= 0.55
    return out / total


def bark_tile(kind, T):
    """A bark as the cards' own channels: covered, its facing, and its light (0 deep .. 1 proud)."""
    if kind == 'rough':
        # Fissures that run up the stem, breaking and joining.
        n = _noise(T, 6, 5, 11)
        f = np.abs(_noise(T, 7, 3, 12) - 0.5) * 2
        h = np.clip(0.25 + 0.95 * f ** 0.6, 0, 1) * (0.72 + 0.5 * n)
    elif kind == 'birch':
        # White paper with dark lenticels round it, and black diamonds where limbs were.
        n = _noise(T, 3, 6, 21)
        lent = _noise(T, 3, 40, 22, 2)
        dark = _noise(T, 2, 9, 23, 3)
        h = 0.86 + 0.14 * n
        h = np.where(lent > 0.66, h * 0.55, h)
        h = h * (1 - 0.82 * np.clip((dark - 0.66) / 0.10, 0, 1))
    else:
        # A pine's plates, proud scales with dark seams.
        rng = np.random.RandomState(31)
        pts = np.stack([rng.uniform(0, 1, 120), rng.uniform(0, 1, 120)], 1)
        uu, vv = np.meshgrid((np.arange(T) + 0.5) / T, (np.arange(T) + 0.5) / T)
        d1 = np.full((T, T), 9.0)
        d2 = np.full((T, T), 9.0)
        for px, py in pts:
            du = np.abs(uu - px)
            du = np.minimum(du, 1 - du) * 5.0
            dv = np.abs(vv - py)
            dv = np.minimum(dv, 1 - dv) * 12.0
            d = np.sqrt(du * du + dv * dv)
            d2 = np.where(d < d1, d1, np.minimum(d2, d))
            d1 = np.minimum(d1, d)
        h = np.clip((d2 - d1) / 0.30, 0, 1) ** 0.7
        h = (0.30 + 0.70 * h) * (0.78 + 0.4 * _noise(T, 5, 8, 32))
    h = np.clip(h / max(1e-3, np.percentile(h, 98)), 0, 1)
    gu = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 1.4
    gv = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.6
    return np.stack([np.ones_like(h), np.clip(0.5 - gu, 0, 1), np.clip(0.5 - gv, 0, 1), h], -1).astype(np.float32)


def save_rgba(path, a, levels=None):
    """An RGBA PNG whose alpha is a channel like any other (no premultiplying anywhere)."""
    import struct
    import zlib
    if levels:
        # Fewer levels than a byte holds: noise the eye never sees does not need to be stored.
        a = np.stack([np.rint(a[..., k] * (n - 1)) / (n - 1) for k, n in enumerate(levels)], -1)
    a8 = np.clip(np.rint(a[::-1] * 255), 0, 255).astype(np.uint8)   # PNG's first row is the top
    h, w, c = a8.shape
    raw = bytearray()
    prev = np.zeros((w * c,), np.uint8)
    for y in range(h):
        row = a8[y].reshape(-1)
        left = np.concatenate([np.zeros(c, np.uint8), row[:-c]])
        ul = np.concatenate([np.zeros(c, np.uint8), prev[:-c]])
        best = None
        for f in (0, 1, 2, 3, 4):
            if f == 0:
                e = row
            elif f == 1:
                e = row - left
            elif f == 2:
                e = row - prev
            elif f == 3:
                e = row - ((left.astype(np.int16) + prev.astype(np.int16)) // 2).astype(np.uint8)
            else:
                p = left.astype(np.int16) + prev.astype(np.int16) - ul.astype(np.int16)
                pa, pb, pc = np.abs(p - left), np.abs(p - prev), np.abs(p - ul)
                pred = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, prev, ul)).astype(np.uint8)
                e = row - pred
            score = int(np.abs(e.astype(np.int8).astype(np.int32)).sum())
            if best is None or score < best[0]:
                best = (score, f, e)
        raw.append(best[1])
        raw.extend(best[2].tobytes())
        prev = row

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as fh:
        fh.write(png)
    return len(png)


FAR_AZ = 8
FAR_EL = (7.0, 38.0)          # degrees above the horizon the two rows are seen from
FAR_TILE = 80
FAR_COLS = 32                 # two specimens a row of tiles (16 views each)


def far_fit(t):
    """The picture's frame: half width, height of its middle, half height, at each elevation."""
    # (The picture keeps a margin inside its tile, so a mip never brings the neighbour in.)
    lo = -t.height * 0.035
    hi = t.height * 1.075
    R = t.reach * 1.09
    frames = []
    for el in FAR_EL:
        e = math.radians(el)
        # an upright box R x H seen from e: its picture's extent up the screen
        top = hi * math.cos(e) + R * 0.55 * math.sin(e)
        bot = lo * math.cos(e) - R * 0.55 * math.sin(e)
        frames.append((R, (top + bot) / 2, (top - bot) / 2))
    return frames


def far_tree(t, nm):
    """The specimen as one mesh (wood and every leaf), so a hundred views share it."""
    v, n, al, tr, rd = wood_mesh(t.sk, t.r, 1200, 10, t.flare, tol=0.04, seed=len(t.name))
    V = [v]
    F = [tr]
    K = [np.ones(len(v))]
    O = [np.full(len(v), 0.75)]
    base = len(v)
    rng = rng_of(sum(ord(ch) for ch in t.name))
    for i in range(len(t.c)):
        fam = t.fam[i]
        k = rng.randint(families.FAMILIES[fam][1])
        sp = _arrays(fam, k)
        rolls = [rng.normal() * 0.5]
        if fam in preview.ROOFED:
            rolls = [preview.ROOFED[fam], -preview.ROOFED[fam], 0.0]
        for roll in rolls:
            M = np.array(preview.spray_frame(t.c[i], t.a[i], t.n[i], t.hl[i], t.hw[i], roll))
            vv = sp[0] @ M[:3, :3].T + M[:3, 3]
            V.append(vv)
            F.append(sp[1] + base)
            kind = sp[3].astype(float)
            if fam == 'cherry':
                kind = np.where(kind > 1.5, 0.0, kind)
            K.append(kind)
            O.append(sp[2] * (0.80 + 0.35 * rng.uniform()))
            base += len(vv)
    me = studio.mesh_from('OF_far_' + t.name, np.vstack(V), np.vstack(F), {'tone': np.concatenate(O), 'kind': np.concatenate(K)})
    me.materials.append(nm)
    return me


_arr = {}


def _arrays(fam, k):
    if (fam, k) not in _arr:
        _arr[(fam, k)] = families.make_spray(fam, 'hero', k).arrays()
    return _arr[(fam, k)]


def bake_far_atlas(trees, path, over=3, samples=14):
    """
    One render a (specimen, elevation) row would be slow; instead every view of one specimen is a copy
    of its mesh on a sheet, turned about its own axis, and one orthographic picture takes them all.
    """
    T = FAR_TILE
    views = FAR_AZ * len(FAR_EL)
    per_row = FAR_COLS // views
    rows = int(math.ceil(len(trees) / per_row))
    out = np.zeros((rows * T, FAR_COLS * T, 4), np.float32)
    nm = studio.data_material('OF_far_normal', 'normal')
    info = []
    for ti, t in enumerate(trees):
        frames = far_fit(t)
        sc = studio.scene('OdysseyForestFar')
        me = far_tree(t, nm)
        dm = studio.data_material('OF_far_data', 'data', ao_dist=max(1.2, 0.32 * t.height), ao_samples=10)
        big = max(max(f[0], f[2]) for f in frames) * 2.6
        for ei, el in enumerate(FAR_EL):
            R, mid, half = frames[ei]
            e = math.radians(el)
            for az in range(FAR_AZ):
                a = 2 * math.pi * az / FAR_AZ
                # Seen from azimuth a (eye at +x' of the tree's frame turned by a), elevation e: turn the
                # tree by -a about z, tip it toward the camera by e, then scale its picture to the tile.
                turn = Matrix.Rotation(-a - math.pi / 2, 4, 'Z')
                tip = Matrix.Rotation(-(math.pi / 2 - e), 4, 'X')
                ob = studio.put(sc, 'OF_f', me, None)
                # camera looks down -Z with Y up: the tree's z must become picture y
                place = Matrix.Translation(((az + 0.5) * big, (ei + 0.5) * big, 0))
                ob.matrix_world = place @ Matrix.Translation((0, -mid, 0)) @ tip @ turn
        W = FAR_AZ * big
        H = len(FAR_EL) * big
        # The sheet is rendered at a resolution that gives each tile over*T along its longer side.
        px = int(round(over * T * big / (2 * min(min(f[0], f[2]) for f in frames)) / 8) * 8)
        px = min(px, 640)
        studio.setup_render(sc, px * FAR_AZ, px * len(FAR_EL), samples)
        cam = studio.ortho_camera(sc, W, (W / 2, H / 2, 400))
        N = studio.shoot(sc, 'of_far_n')
        me.materials[0] = dm
        D = studio.shoot(sc, 'of_far_d')
        row = ti // per_row
        col0 = (ti % per_row) * views
        for ei in range(len(FAR_EL)):
            R, mid, half = frames[ei]
            for az in range(FAR_AZ):
                cx, cy = (az + 0.5) * px, (ei + 0.5) * px
                hw, hh = R / big * px, half / big * px
                tileN = _resample(N, cx, cy, hw, hh, T)
                tileD = _resample(D, cx, cy, hw, hh, T)
                cov = np.clip(tileD[..., 3], 0, 1)
                nn = np.where(tileN[..., 3:4] > 1e-3, tileN[..., :3] / np.maximum(tileN[..., 3:4], 1e-3), 0.5)
                dd = np.where(tileD[..., 3:4] > 1e-3, tileD[..., :3] / np.maximum(tileD[..., 3:4], 1e-3), 0.5)
                light = np.clip(dd[..., 0], 0, 1) ** 0.9 * (0.45 + 0.55 * dd[..., 1])
                kind = dd[..., 2] * 2
                m = cov > 0.3
                lo, hi = (np.percentile(light[m], [2, 98]) if m.sum() > 8 else (0, 1))
                k = np.clip((light - lo) / max(hi - lo, 1e-3), 0, 1)
                wood = np.clip(1 - np.abs(kind - 1) / 0.5, 0, 1)
                petal = np.clip((kind - 1.3) / 0.6, 0, 1)
                val = band(k, LEAF) * (1 - wood) + band(0.2 + 0.8 * k, WOOD) * wood
                val = val * (1 - petal) + band(k, FLOWER) * petal
                rgb = np.stack([nn[..., 0], nn[..., 1], val], -1)
                f, w = fill_out(rgb, cov, 8)
                mean = np.array([0.5, 0.5, val[m].mean() if m.sum() else 0.5])
                f = np.where(w[..., None] > 0.5, f, mean)
                # Past the edge's reach the picture is one flat value (it is never seen, and it packs small).
                f = np.where(studio.near_distance(cov > 0.02, 3)[..., None] > 3, mean, f)
                x0 = (col0 + ei * FAR_AZ + az) * T
                y0 = row * T
                out[y0:y0 + T, x0:x0 + T, 0] = cov
                out[y0:y0 + T, x0:x0 + T, 1:4] = f
        info.append({'name': t.name, 'frames': [[round(float(x), 4) for x in fr] for fr in frames]})
        bpy.data.meshes.remove(me)
    save_rgba(path, out, levels=(16, 22, 22, 36))
    curve = coverage_curve(out[..., 0], T, cuts=(1, 2, 3, 4))
    return {'info': info, 'curve': curve, 'rows': rows}


def _resample(img, cx, cy, hw, hh, T, ss=4):
    """Average the sheet over each of the tile's T x T texels (its own box, ss x ss bilinear taps)."""
    h, w = img.shape[:2]
    n = T * ss
    xs = cx - hw + (np.arange(n) + 0.5) / n * 2 * hw - 0.5
    ys = cy - hh + (np.arange(n) + 0.5) / n * 2 * hh - 0.5
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 2)
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 2)
    fx = np.clip(xs - x0, 0, 1)[None, :, None]
    fy = np.clip(ys - y0, 0, 1)[:, None, None]
    a = img[y0][:, x0]
    b = img[y0][:, x0 + 1]
    c = img[y0 + 1][:, x0]
    d = img[y0 + 1][:, x0 + 1]
    out = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    return out.reshape(T, ss, T, ss, 4).mean(axis=(1, 3))
