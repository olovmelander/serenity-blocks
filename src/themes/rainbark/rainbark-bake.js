/**
 * Rainbark — the CPU bakes: three-free, deterministic typed arrays that rainbark-tsl.js wraps as
 * 2D DataTextures. Nothing is fetched and nothing is 3D (a 3D texture's writes fail validation on
 * some software adapters); everything here is synchronous and the same for the same seed.
 *
 *   bakePatchAtlas  the bark's patch map: ragged vertical ribbons of younger bark laid over a
 *                   matrix of old bark, one tileable 4.8 m × 14 m tile of bark space
 *   bakeCrownMask   the canopy's crowns and the channels of crown shyness between them, R8, mips
 *   bakeLeafLace    the leaves' detail inside the crowns: tileable leaf coverage, R8, mips
 *   bakeRamp        the age ramp, 256 × 1, linear light
 *   bakeFbm         four tileable value-noise bands, RGBA8, with its mip chain
 *   bakeLattice     white noise for a 3D value noise read from a 2D texture in one fetch
 *
 * The patch model ("ribbon splats"): ATLAS_RIBBONS ribbons per tile, each 0.25–1.1 m wide and
 * 3–12 m tall, its centre line wobbling a few centimetres over metres, its width breathing (some
 * pinch to slivers), bites out of its sides, blunt-ragged or pointed ends and a two-scale torn
 * edge that frays most near the ends, splatted in order onto a torus, later ribbons over earlier
 * ones. What no ribbon covers is the matrix (40–48 % of the tile), with a few pale old-skin
 * islands in it, laid first. Not a Voronoi diagram: every texel of a Voronoi belongs to a polygon
 * of similar size, which reads as stained glass.
 */

import {
    ATLAS_CONSISTENT, ATLAS_ISLANDS, ATLAS_RIBBONS, BARK_TEAR, BARK_TILE, CANOPY_CROWNS, CANOPY_LACE,
    LATTICE_SLICE, PATCH_EDGE_RANGE, buildMips, mulberry32, rampAt, smooth,
} from './rainbark-core.js';

// ── Tileable value noise ────────────────────────────────────────────────────────

/** An integer lattice point → [0, 1). */
function hash3(x, y, s) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((s | 0) + 0x3c6ef372, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The lattice of one noise layer: px × py values in [0, 1). */
function latticeTable(seed, px, py) {
    const table = new Float32Array(px * py);
    for (let y = 0; y < py; y++) {
        for (let x = 0; x < px; x++) table[y * px + x] = hash3(x, y, seed);
    }
    return table;
}

/** A noise layer: value noise with a smooth fade, periodic in px × py lattice cells. */
function noiseLayer(seed, px, py) {
    const table = latticeTable(seed, px, py);
    return (x, y) => {
        const xf = Math.floor(x);
        const yf = Math.floor(y);
        let fx = x - xf;
        let fy = y - yf;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        const x0 = ((xf % px) + px) % px;
        const y0 = ((yf % py) + py) % py;
        const x1 = x0 + 1 === px ? 0 : x0 + 1;
        const r0 = y0 * px;
        const r1 = (y0 + 1 === py ? 0 : y0 + 1) * px;
        const a = table[r0 + x0];
        const b = table[r0 + x1];
        const c = table[r1 + x0];
        const d = table[r1 + x1];
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
}

/**
 * Add one noise layer, sampled at texel centres of a size × size grid, to `out`: px × py lattice
 * cells across the grid (periodic), times `amp`. Rows and columns are set up once, so a texel
 * costs four table reads.
 */
function addNoiseGrid(out, size, seed, px, py, amp) {
    const table = latticeTable(seed, px, py);
    const cx0 = new Int32Array(size);
    const cx1 = new Int32Array(size);
    const cfx = new Float32Array(size);
    for (let x = 0; x < size; x++) {
        const fx = ((x + 0.5) / size) * px;
        const xf = Math.floor(fx);
        const f = fx - xf;
        cx0[x] = xf % px;
        cx1[x] = (xf + 1) % px;
        cfx[x] = f * f * (3 - 2 * f);
    }
    for (let y = 0; y < size; y++) {
        const fy = ((y + 0.5) / size) * py;
        const yf = Math.floor(fy);
        let g = fy - yf;
        g = g * g * (3 - 2 * g);
        const r0 = (yf % py) * px;
        const r1 = ((yf + 1) % py) * px;
        const row = y * size;
        for (let x = 0; x < size; x++) {
            const a = table[r0 + cx0[x]];
            const b = table[r0 + cx1[x]];
            const c = table[r1 + cx0[x]];
            const d = table[r1 + cx1[x]];
            const f = cfx[x];
            out[row + x] += amp * (a + (b - a) * f + (c - a) * g + (a - b - c + d) * f * g);
        }
    }
}

/**
 * Octaves of value noise over a size × size grid, each twice the last's frequency (and still
 * periodic), normalised to 0..1 by the amplitudes: px × py cells in the lowest octave.
 */
function fbmGrid(size, seed, px, py, octaves) {
    const out = new Float32Array(size * size);
    let total = 0;
    for (let o = 0, amp = 0.5, f = 1; o < octaves; o++, amp *= 0.5, f *= 2) {
        addNoiseGrid(out, size, seed + o * 101, px * f, py * f, amp);
        total += amp;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
}

/** A periodic size × size field resampled (bilinear, wrapping) to a larger square grid. */
function upsample(field, size, to) {
    if (to === size) return field;
    const out = new Float32Array(to * to);
    const k = size / to;
    for (let y = 0; y < to; y++) {
        const fy = (y + 0.5) * k - 0.5;
        const y0 = Math.floor(fy);
        const g = fy - y0;
        const r0 = ((y0 + size) % size) * size;
        const r1 = ((y0 + 1) % size) * size;
        for (let x = 0; x < to; x++) {
            const fx = (x + 0.5) * k - 0.5;
            const x0 = Math.floor(fx);
            const f = fx - x0;
            const a = (x0 + size) % size;
            const b = (x0 + 1) % size;
            const top = field[r0 + a] + (field[r0 + b] - field[r0 + a]) * f;
            const bottom = field[r1 + a] + (field[r1 + b] - field[r1 + a]) * f;
            out[y * to + x] = top + (bottom - top) * g;
        }
    }
    return out;
}

// ── The patch atlas ─────────────────────────────────────────────────────────────

/** Wrap a coordinate into [−period/2, period/2). */
const wrapCentred = (v, period) => v - period * Math.round(v / period);

/**
 * The ribbons of one tile: width w0 (m), height h (m), centre (cx, cy), the centre line's wobble
 * (amplitude, wavelength, phase), from the seed; then, from a second stream (so the layout stays
 * put), the shape: how far the width breathes (lo … hi of w0: some ribbons pinch to slivers),
 * the bites taken out of each side (depth m, spacing m), and whether the ends taper to a point.
 */
export function planRibbons(seed, count) {
    const rand = mulberry32(seed >>> 0);
    const shape = mulberry32((seed ^ 0x5bd1e995) >>> 0);
    const ribbons = [];
    for (let k = 0; k < count; k++) {
        ribbons.push({
            w0: 0.25 + rand() * 0.85,
            h: 3 + rand() * 9,
            cx: rand() * BARK_TILE.around,
            cy: rand() * BARK_TILE.up,
            phase: rand() * Math.PI * 2,
            wobble: 0.01 + rand() * 0.05,
            wavelength: 4 + rand() * 5,
        });
    }
    ribbons.forEach((r) => {
        r.breathLo = 0.45;
        r.breathHi = 1.3;
        r.biteDepth = 0.05 + shape() * 0.09;
        r.biteSpacing = 0.3 + shape() * 0.5;
        r.pointed = shape() < 0.45;
        r.rag = 1;
    });
    return ribbons;
}

/**
 * The pale old-skin islands of one tile: smaller lozenges (0.3–1 m wide, 1–4 m tall), torn a
 * little more gently than the ribbons, half of them pointed. They are laid first, under every ribbon, so
 * they only show in the matrix.
 */
export function planIslands(seed, count) {
    const rand = mulberry32((Math.imul(seed, 7) + 0x1234567) >>> 0);
    const islands = [];
    for (let k = 0; k < count; k++) {
        islands.push({
            w0: 0.3 + rand() * 0.7,
            h: 1 + rand() * 3,
            cx: rand() * BARK_TILE.around,
            cy: rand() * BARK_TILE.up,
            phase: rand() * Math.PI * 2,
            wobble: 0.005 + rand() * 0.02,
            wavelength: 2 + rand() * 3,
            breathLo: 0.5,
            breathHi: 1.2,
            biteDepth: 0.03 + rand() * 0.05,
            biteSpacing: 0.2 + rand() * 0.3,
            pointed: rand() < 0.5,
            rag: 0.9,
        });
    }
    return islands;
}

/**
 * The torn edge, as two periodic fields over the tile (metres, centred on 0), from a
 * low-frequency fray (≈0.22 m), a mid one (0.08 m) and a fine one (0.035 m):
 *   side  all three, pushing a ribbon's long sides in and out;
 *   end   the same noise for its ends, where it pushes the edge up and down: broad tongues (the
 *         low fray, enlarged) with little fine tearing, so an end is ragged without combing
 *         into long vertical drips.
 */
function bakeRag(seed, size) {
    // Computed at no more than 256² (its finest detail is several texels wide there) and
    // resampled: the 256² atlas of the lowest tier tears along the same edges as the others.
    const at = Math.min(size, 256);
    const side = new Float32Array(at * at);
    const end = new Float32Array(at * at);
    const low = fbmGrid(at, seed + 5, 12, 10, 4);
    const mid = fbmGrid(at, seed + 15, 24, 14, 4);
    const fine = new Float32Array(at * at);
    addNoiseGrid(fine, at, seed + 7, 96, 60, 1);
    for (let i = 0; i < side.length; i++) {
        const l = low[i] - 0.5;
        const m = mid[i] - 0.5;
        const f = fine[i] - 0.5;
        side[i] = l * 0.22 + m * 0.11 + f * 0.035;
        end[i] = l * 0.66 + m * 0.12 + f * 0.04;
    }
    return { side: upsample(side, at, size), end: upsample(end, at, size) };
}

/** The widest a ribbon may breathe (metres). */
const MAX_RIBBON_WIDTH = 1.1;

/** How far (metres) the islands stand back from every ribbon's edge. */
const ISLAND_HALO = 0.035;

/** A wrap offset pair (−1, 0, 1 each) as one base-3 digit pair, 0..8 (4 = no wrap). */
const wrapCode = (ds, dv) => (ds + 1) * 3 + (dv + 1);

/**
 * Each splat's shape along one row: its distance field d (> 0 inside, metres to its edge) is the
 * nearer of its torn sides, min(halfL + dx, halfR − dx) + rag.side · fray, and its torn end,
 * (h/2 − |dy|) + rag.end · fray: both true distances, so the edge's seams, lips and shadows are
 * as wide at a ribbon's end as along its sides.
 */
function splatRow(r, k, dy, noise, out) {
    const t = Math.min(1, Math.max(0, dy / r.h + 0.5));
    out.centre = r.cx + r.wobble * Math.sin((dy / r.wavelength) * Math.PI * 2 + r.phase);
    // Blunt ends swell to full width over the last ~15 % of the height; pointed ones over 30 %.
    const swell = r.pointed
        ? Math.min(1, Math.sin(Math.PI * t) * 1.24) ** 1.2
        : Math.min(1, Math.sin(Math.PI * t) * 2.2) ** 0.7;
    // The width breathes over a couple of metres (pinching some ribbons to slivers), with a
    // quicker ripple on top.
    const slow = smooth(0.15, 0.85, noise.breath(k * 3.7, dy / 2.3 + 50));
    const quick = noise.breath(k * 3.7 + 1.9, dy / 0.8 + 11) - 0.5;
    const breath = r.breathLo + (r.breathHi - r.breathLo) * slow + 0.3 * quick;
    // (No wider than the widest ribbon's own width: breathing pinches more than it swells.)
    const half = Math.min(r.w0 * breath, MAX_RIBBON_WIDTH) * 0.5 * swell;
    // Bites out of each side: irregular notches, gated by a slower noise so they come in runs.
    const bite = (layer, gate) => r.biteDepth * smooth(0.42, 0.75, layer(k * 1.7, dy / r.biteSpacing + 20))
        * smooth(0.3, 0.6, gate(k * 2.3, dy / 2.1 + 9));
    out.halfL = half - bite(noise.biteL, noise.gateL);
    out.halfR = half - bite(noise.biteR, noise.gateR);
    out.half = Math.max(out.halfL, out.halfR);
    out.end = r.h / 2 - Math.abs(dy);
    // The edge frays most toward the splat's ends.
    out.fray = (0.6 + 0.8 * (1 - t * (1 - t) * 4)) * r.rag;
    return out;
}

/**
 * The patch map of one tile of bark space (BARK_TILE: 4.8 m around × 14 m up), tileable on the
 * torus, as RGBA8 texels (row 0 at the bottom of the tile, v up):
 *   R  the id of the region this texel shows: 0 the matrix, 1..islands the pale old-skin
 *      islands, then islands + k + 1 for ribbon k
 *   G  the signed distance (metres, ±PATCH_EDGE_RANGE ↔ 1..255, 128 on the edge) to the nearest
 *      edge of this region, positive inside the higher id of the pair (this region and the one
 *      across that edge), so a linear read crosses 128 exactly on the edge
 *   B  the id of the region across that edge (the nearest texel that shows another region)
 *   A  where each of the two regions is "at home": a ribbon that wraps round the tile edge is
 *      the instance centred in the next tile (s or v ± 1), so the shader's per-tile patch hash
 *      stays one patch across the tile seam: codeR·9 + codeB, code = (ds + 1)·3 + (dv + 1);
 *      plus ATLAS_CONSISTENT when every neighbour's G reads in the same sense as this texel's
 *      (each shows one of the pair, and orders it against its own partner the same way), so a
 *      bilinear read of G here is a true distance to this edge (not near a triple junction).
 * @returns {{ data: Uint8Array, size: number, count: number, islands: number,
 *             matrixShare: number, islandShare: number }}
 *   matrixShare  the share of the tile no ribbon covers (the old bark, its islands included)
 *   islandShare  the share of the tile the islands show in
 */
export function bakePatchAtlas(seed = 21, size = 512, { count = ATLAS_RIBBONS, islands = ATLAS_ISLANDS } = {}) {
    const nRibbons = Math.max(1, Math.min(200, Math.round(count)));
    const nIslands = Math.max(0, Math.min(40, Math.round(islands)));
    const TW = BARK_TILE.around;
    const TH = BARK_TILE.up;
    const cap = PATCH_EDGE_RANGE;
    const splats = [...planIslands(seed, nIslands), ...planRibbons(seed, nRibbons)];
    const n = splats.length;
    // Each splat's shape noises are keyed by its index within its own kind, so adding islands
    // leaves the ribbons' shapes as they were.
    const keys = splats.map((_, k) => (k < nIslands ? k + 0.5 : k - nIslands));
    const noises = splats.map((_, k) => {
        const own = k < nIslands ? 500 + k : 100 + (k - nIslands);
        return {
            breath: noiseLayer(seed + own, 32, 64),
            biteL: noiseLayer(seed + 3000 + own * 2, 8, 64),
            biteR: noiseLayer(seed + 3001 + own * 2, 8, 64),
            gateL: noiseLayer(seed + 6000 + own * 2, 8, 32),
            gateR: noiseLayer(seed + 6001 + own * 2, 8, 32),
        };
    });
    const rag = bakeRag(seed, size);
    // The torn edge reaches at most this far past a splat's half-width or its end (metres).
    let reachRag = 0;
    let reachEnd = 0;
    for (let i = 0; i < rag.side.length; i++) {
        reachRag = Math.max(reachRag, Math.abs(rag.side[i]));
        reachEnd = Math.max(reachEnd, Math.abs(rag.end[i]));
    }
    reachRag *= 1.4;
    reachEnd *= 1.4;
    const texels = size * size;
    const region = new Uint8Array(texels);
    const across = new Uint8Array(texels);
    const dist = new Float32Array(texels);
    const code = new Uint8Array(texels);
    const codeB = new Uint8Array(texels);
    // One row at a time: each splat's coverage value d and its wrap round the tile, at the texels
    // it can reach; then each texel's region and its nearest edge.
    const d = new Float32Array(n * size);
    const ds = new Int8Array(n * size);
    const dv = new Int8Array(n);
    const row = {};
    let matrix = 0;
    let island = 0;
    for (let y = 0; y < size; y++) {
        const Y = ((y + 0.5) / size) * TH;
        const base = y * size;
        d.fill(-cap);
        for (let k = 0; k < n; k++) {
            const r = splats[k];
            const raw = Y - r.cy;
            const dy = wrapCentred(raw, TH);
            // Farther than the cap (and its torn end) from the splat's end: it cannot touch this row.
            if (Math.abs(dy) >= r.h / 2 + cap + reachEnd * r.rag) continue;
            dv[k] = Math.round((raw - dy) / TH);
            splatRow(r, keys[k], dy, noises[k], row);
            const reach = row.half + cap + reachRag * row.fray;
            const x0 = Math.floor(((row.centre - reach) / TW) * size - 0.5);
            const x1 = Math.ceil(((row.centre + reach) / TW) * size - 0.5);
            const o = k * size;
            for (let xi = Math.max(x0, x1 - size + 1); xi <= x1; xi++) {
                const x = ((xi % size) + size) % size;
                const X = ((x + 0.5) / size) * TW;
                const rawX = X - row.centre;
                const dx = wrapCentred(rawX, TW);
                ds[o + x] = Math.round((rawX - dx) / TW);
                const side = Math.min(row.halfL + dx, row.halfR - dx) + rag.side[base + x] * row.fray;
                d[o + x] = Math.min(side, row.end + rag.end[base + x] * row.fray);
            }
        }
        for (let x = 0; x < size; x++) {
            // The islands keep ISLAND_HALO clear of every ribbon's edge: no sliver of one peeks out
            // along a ribbon, so the matrix always lies between them (no junction of the three).
            let clear = cap;
            for (let k = nIslands; k < n; k++) clear = Math.min(clear, -d[k * size + x] - ISLAND_HALO);
            for (let k = 0; k < nIslands; k++) d[k * size + x] = Math.min(d[k * size + x], clear);
            let top = -1;
            for (let k = n - 1; k >= 0; k--) {
                if (d[k * size + x] > 0) {
                    top = k;
                    break;
                }
            }
            // The nearest edge: this region's own (beyond it shows the highest splat under it
            // here, else the matrix: refined below), or the edge of a splat laid over it.
            let e = cap;
            let other = -1;
            if (top >= 0) {
                e = Math.min(d[top * size + x], cap);
                for (let k = top - 1; k >= 0; k--) {
                    if (d[k * size + x] > 0) {
                        other = k;
                        break;
                    }
                }
            }
            if (top < nIslands) matrix += 1;
            if (top >= 0 && top < nIslands) island += 1;
            for (let k = top + 1; k < n; k++) {
                const c = -d[k * size + x];
                if (c < e) {
                    e = c;
                    other = k;
                }
            }
            const i = base + x;
            region[i] = top + 1;
            across[i] = other + 1;
            dist[i] = e;
            code[i] = top >= 0 ? wrapCode(ds[top * size + x], dv[top]) : 4;
            codeB[i] = other >= 0 ? wrapCode(ds[other * size + x], dv[other]) : 4;
        }
    }
    closeSlivers(region, dist, code, size);
    refineAcross(region, across, dist, code, codeB, size);
    const data = new Uint8Array(texels * 4);
    for (let i = 0; i < texels; i++) {
        const phi = region[i] > across[i] ? dist[i] : -dist[i];
        const o = i * 4;
        data[o] = region[i];
        data[o + 1] = Math.max(1, Math.min(255, Math.round(128 + (phi / cap) * 127)));
        data[o + 2] = across[i];
        data[o + 3] = code[i] * 9 + codeB[i];
    }
    markConsistent(data, size);
    return {
        data,
        size,
        count: nRibbons,
        islands: nIslands,
        matrixShare: matrix / texels,
        islandShare: island / texels,
    };
}

/** A wrap code seen from a texel one tile along (sx, sy: −1, 0, 1) from the one it was taken in. */
function shiftCode(c, sx, sy) {
    const cs = Math.max(-1, Math.min(1, Math.floor(c / 3) - 1 + sx));
    const cv = Math.max(-1, Math.min(1, (c % 3) - 1 + sy));
    return wrapCode(cs, cv);
}

/**
 * Close the slivers one or two texels wide round the trunk (a ribbon pinched to nothing, or what
 * lies under a ribbon showing through a notch no wider than that): no shader can draw a region
 * narrower than its texels without it twinkling as a broken line of colour. The sliver joins the
 * region on both sides of it, at their distance from an edge (refineAcross then finds the edge
 * that really is nearest).
 */
function closeSlivers(region, dist, code, size) {
    for (let y = 0; y < size; y++) {
        const row = y * size;
        const at = (x) => region[row + ((x + size) % size)];
        for (let x = 0; x < size; x++) {
            const l = at(x - 1);
            if (region[row + x] === l) continue;
            let w = 0;
            if (at(x + 1) === l) w = 1;
            else if (at(x + 1) === region[row + x] && at(x + 2) === l) w = 2;
            if (!w) continue;
            const left = row + ((x - 1 + size) % size);
            const right = row + ((x + w) % size);
            const c = x === 0 ? shiftCode(code[left], -1, 0) : code[left];
            const e = (dist[left] + dist[right]) / 2;
            for (let i = 0; i < w && x + i < size; i++) {
                region[row + x + i] = l;
                code[row + x + i] = c;
                dist[row + x + i] = e;
            }
        }
    }
}

/**
 * Where an edge is near (within the reach of the shader's edge cut), the region across it is
 * whatever the nearest texel showing another region shows: the splat under this one at the
 * texel itself may have ended before the edge (near a junction), and the shader would flip to a
 * colour that is not there. The wrap code comes along, shifted when the neighbour sits over the
 * tile's seam.
 */
function refineAcross(region, across, dist, code, codeB, size) {
    const tw = BARK_TILE.around / size;
    const th = BARK_TILE.up / size;
    const reach = 2 * Math.hypot(tw, th) + BARK_TEAR;
    const rx = Math.ceil(reach / tw);
    const ry = Math.ceil(reach / th);
    const list = [];
    for (let oy = -ry; oy <= ry; oy++) {
        for (let ox = -rx; ox <= rx; ox++) {
            const m = Math.hypot(ox * tw, oy * th);
            if ((ox || oy) && m <= reach + Math.hypot(tw, th)) list.push([m, ox, oy]);
        }
    }
    list.sort((a, b) => a[0] - b[0]);
    const count = list.length;
    const offX = Int32Array.from(list, (o) => o[1]);
    const offY = Int32Array.from(list, (o) => o[2]);
    const offI = Int32Array.from(list, (o) => o[2] * size + o[1]);
    // The edge lies no nearer than a texel's diagonal short of the nearest texel across it (where
    // a sliver was closed, the distance field still thinks its edge is here).
    const diag = Math.hypot(tw, th);
    const offFloor = Float32Array.from(list, (o) => Math.max(0, o[0] - diag));
    for (let y = 0; y < size; y++) {
        const inY = y >= ry && y < size - ry;
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            if (dist[i] >= reach) continue;
            const r = region[i];
            let k = 0;
            if (inY && x >= rx && x < size - rx) {
                // Away from the tile's border no neighbour wraps.
                for (; k < count; k++) {
                    const j = i + offI[k];
                    if (region[j] !== r) {
                        across[i] = region[j];
                        codeB[i] = code[j];
                        dist[i] = Math.max(dist[i], offFloor[k]);
                        break;
                    }
                }
                // No other region within reach: the distance field ran short (a bite, a torn
                // corner), and there is no edge here to cut.
                if (k === count) dist[i] = Math.min(PATCH_EDGE_RANGE, reach * 1.1);
                continue;
            }
            for (; k < count; k++) {
                const xx = x + offX[k];
                const yy = y + offY[k];
                const sx = Math.floor(xx / size);
                const sy = Math.floor(yy / size);
                const j = (yy - sy * size) * size + (xx - sx * size);
                if (region[j] === r) continue;
                across[i] = region[j];
                // The neighbour's code is relative to its own tile; seen from this one it is
                // one tile further along where it sits over the seam.
                codeB[i] = shiftCode(code[j], sx, sy);
                dist[i] = Math.max(dist[i], offFloor[k]);
                break;
            }
            if (k === count) dist[i] = Math.min(PATCH_EDGE_RANGE, reach * 1.1);
        }
    }
}

/**
 * Set ATLAS_CONSISTENT on each texel whose eight neighbours read G in its sense: each shows one
 * of its pair (R, B) and orders that region against its own partner as this texel does. A
 * bilinear read of G anywhere in this texel's cell mixes only such texels, so its zero crossing
 * is this edge. Near a triple junction it is clear, and the shader keeps the nearest region.
 */
function markConsistent(data, size) {
    const flags = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
        const ys = [(y + size - 1) % size, y, (y + 1) % size];
        for (let x = 0; x < size; x++) {
            const o = (y * size + x) * 4;
            const r = data[o];
            const b = data[o + 2];
            const rHigh = r > b;
            let ok = true;
            for (let a = 0; a < 3 && ok; a++) {
                for (let c = -1; c <= 1; c++) {
                    const q = (ys[a] * size + ((x + c + size) % size)) * 4;
                    const r2 = data[q];
                    const b2 = data[q + 2];
                    if (r2 === r) {
                        if ((r > b2) !== rHigh) ok = false;
                    } else if (r2 === b) {
                        if ((b > b2) !== !rHigh) ok = false;
                    } else {
                        ok = false;
                    }
                    if (!ok) break;
                }
            }
            flags[y * size + x] = ok ? 1 : 0;
        }
    }
    for (let i = 0; i < flags.length; i++) if (flags[i]) data[i * 4 + 3] |= ATLAS_CONSISTENT;
}

/** The signed edge distance (metres) a G byte encodes. */
export const decodeEdge = (g) => ((g - 128) / 127) * PATCH_EDGE_RANGE;

// ── The canopy: its crowns and their leaf lace ─────────────────────────────────

/**
 * The nearest and second-nearest site of a jittered power diagram on the torus (sites as x, y,
 * weight triples in tile units): the metres-free border distance (d2 − d1) / 2, and the third's.
 */
function powerBorders(px, py, sites, out) {
    let d1 = Infinity;
    let d2 = Infinity;
    let d3 = Infinity;
    for (let k = 0; k < sites.length; k += 3) {
        let dx = px - sites[k];
        let dy = py - sites[k + 1];
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const d = Math.sqrt(dx * dx + dy * dy) - sites[k + 2];
        if (d < d1) {
            d3 = d2;
            d2 = d1;
            d1 = d;
        } else if (d < d2) {
            d3 = d2;
            d2 = d;
        } else if (d < d3) {
            d3 = d;
        }
    }
    out[0] = (d2 - d1) / 2;
    out[1] = (d3 - d1) / 2;
    return out;
}

/** n × n jittered sites (x, y, weight) on the unit torus. */
function jitteredSites(rand, n, jitter, weight) {
    const sites = [];
    for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
            const sx = (gx + 0.5 + (rand() - 0.5) * jitter) / n;
            const sy = (gy + 0.5 + (rand() - 0.5) * jitter) / n;
            sites.push(sx, sy, (rand() - 0.5) * weight);
        }
    }
    return sites;
}

/**
 * The canopy's crowns seen from below as coverage (0 sky … 255 leaves), one tileable
 * CANOPY_CROWNS.tile square, R8 with its CPU mip chain: a jittered 3 × 3 power diagram (crowns of
 * 15–25 m, unequal), looked up through a warp so no border runs straight, the channels of crown
 * shyness between them 1.5–3 m wide and ragged, bridged by twigs over part of their length,
 * widening where three crowns meet, and at a few meetings opening into holes 9–14 m across (the
 * gaps that still show sky through the crown layer's depth at a slant). A crown is not quite
 * solid: a broad mottle thins it.
 * Returns { data, size, mipmaps, cover }.
 */
export function bakeCrownMask(seed = CANOPY_CROWNS.seed, size = CANOPY_CROWNS.size) {
    const rand = mulberry32(seed >>> 0);
    const { tile } = CANOPY_CROWNS;
    const sites = jitteredSites(rand, CANOPY_CROWNS.crowns, 0.8, 0.05);
    // The borders (smooth distance fields) are found at half the size and filtered up; the noise
    // that rags them varies over metres, at a quarter.
    const half2 = Math.max(16, size >> 1);
    const noise = Math.max(16, size >> 2);
    const warpX = upsample(fbmGrid(noise, seed + 43, 4, 4, 3), noise, half2);
    const warpY = upsample(fbmGrid(noise, seed + 47, 4, 4, 3), noise, half2);
    const nearest = new Float32Array(half2 * half2);
    const thirdOf = new Float32Array(half2 * half2);
    const borders = [0, 0];
    for (let y = 0; y < half2; y++) {
        for (let x = 0; x < half2; x++) {
            const i = y * half2 + x;
            const px = (x + 0.5) / half2 + (warpX[i] - 0.5) * 0.09;
            const py = (y + 0.5) / half2 + (warpY[i] - 0.5) * 0.09;
            powerBorders(px, py, sites, borders);
            nearest[i] = borders[0] * tile;
            thirdOf[i] = borders[1] * tile;
        }
    }
    const borderField = upsample(nearest, half2, size);
    const thirdField = upsample(thirdOf, half2, size);
    const rag = upsample(fbmGrid(noise, seed + 31, 12, 12, 3), noise, size);
    const bridge = upsample(fbmGrid(noise, seed + 71, 16, 16, 2), noise, size);
    const mottle = upsample(fbmGrid(noise, seed + 57, 10, 10, 3), noise, size);
    const holes = upsample(fbmGrid(noise, seed + 89, 3, 3, 2), noise, size);
    const data = new Uint8Array(size * size);
    let total = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            // Metres from the border between the two nearest crowns, and from the third.
            const border = borderField[i];
            const third = thirdField[i];
            // 1.5–3 m channels (half on each side), opening where three crowns meet: a little at
            // every meeting, into a hole 9–14 m across at a few (where the broad noise allows).
            const meet = 1 - smooth(0.5, 4.5, third);
            const wide = smooth(0.56, 0.68, holes[i]);
            const half = 0.75 + 0.75 * rag[i] + meet * (0.8 + 5 * wide);
            const open = 1 - smooth(half, half + 0.5, border);
            // Twigs bridge the narrow channels over part of their length (never the holes).
            const bridged = open * (1 - 0.9 * smooth(0.5, 0.62, bridge[i]) * smooth(4, 2, half));
            const leaves = (1 - bridged) * (0.86 + 0.14 * smooth(0.3, 0.7, mottle[i]));
            data[i] = Math.round(leaves * 255);
            total += leaves;
        }
    }
    return {
        data, size, mipmaps: buildMips(data, size, 1), cover: total / data.length,
    };
}

/**
 * The canopy's leaf lace as leaf coverage (0 sky … 255 leaves), one tileable CANOPY_LACE.tile
 * square, R8 with its CPU mip chain: the leaves' detail inside the crowns, read where single
 * leaves resolve.
 *  - Clumps: a 4 × 4 jittered power diagram on the torus (clumps of 2–4 m, unequal), looked up
 *    through a gentle warp, computed at half the size and filtered up (it varies over metres).
 *    Between them run narrow ragged channels (0.1–0.5 m), bridged by twigs over about half their
 *    length; leaves thin toward a rim.
 *  - Inside a clump, leaves hang in twig clusters of 4–8 fanned one way: lanceolate blades
 *    0.18–0.34 m long, a fifth as wide, widest before halfway and pointed, rasterised row by row
 *    with a texel of anti-aliasing (union of coverage). A broad clump noise leaves a few holes.
 * Returns { data, size, mipmaps, cover } (cover = the tile's mean coverage).
 */
export function bakeLeafLace(seed = CANOPY_LACE.seed, size = CANOPY_LACE.size) {
    const rand = mulberry32(seed >>> 0);
    const perMetre = size / CANOPY_LACE.tile;
    const sites = jitteredSites(rand, 4, 0.85, 0.012);
    // The clumps, their ragged channels, the warp and the holes vary over metres: computed coarse.
    const coarse = Math.max(16, size >> 1);
    const noise = Math.max(16, size >> 2);
    const rag = upsample(fbmGrid(noise, seed + 31, 8, 8, 3), noise, coarse);
    const warpX = upsample(fbmGrid(noise, seed + 43, 5, 5, 3), noise, coarse);
    const warpY = upsample(fbmGrid(noise, seed + 47, 5, 5, 3), noise, coarse);
    const clump = upsample(fbmGrid(noise, seed + 57, 6, 6, 3), noise, coarse);
    const bridge = upsample(fbmGrid(noise, seed + 71, 10, 10, 3), noise, coarse);
    const coarseDensity = new Float32Array(coarse * coarse);
    const borders = [0, 0];
    for (let y = 0; y < coarse; y++) {
        for (let x = 0; x < coarse; x++) {
            const i = y * coarse + x;
            const px = (x + 0.5) / coarse + (warpX[i] - 0.5) * 0.08;
            const py = (y + 0.5) / coarse + (warpY[i] - 0.5) * 0.08;
            powerBorders(px, py, sites, borders);
            // Metres from the border between the two nearest clumps.
            const border = borders[0] * CANOPY_LACE.tile;
            const channel = 0.08 + 0.45 * rag[i] * rag[i];
            // Twigs bridge the channels over about half their length, so the sky shows in broken
            // runs and holes, never as a net.
            const crown = Math.max(smooth(channel, channel + 0.4, border), 0.85 * smooth(0.42, 0.56, bridge[i]));
            coarseDensity[i] = crown * smooth(0.16, 0.28, clump[i]);
        }
    }
    const density = upsample(coarseDensity, coarse, size);
    const cover = new Float32Array(size * size);
    const twigs = Math.round(CANOPY_LACE.twigs * (size / 512) ** 2);
    const aa = 0.75;
    // Lanceolate: widest a little before halfway, pointed at both ends (a table over the length).
    const PROFILE = 64;
    const profile = new Float32Array(PROFILE + 1);
    for (let i = 0; i <= PROFILE; i++) profile[i] = Math.sin((Math.PI * i) / PROFILE) * (1.25 - (0.5 * i) / PROFILE);
    for (let t = 0; t < twigs; t++) {
        const tx = rand() * size;
        const ty = rand() * size;
        if (rand() > density[(Math.floor(ty) % size) * size + (Math.floor(tx) % size)]) continue;
        const leaves = 4 + Math.floor(rand() * 5);
        // A cluster droops one way: its blades fan about a common direction.
        const turn = rand() * Math.PI * 2;
        for (let l = 0; l < leaves; l++) {
            const angle = turn + (rand() - 0.5) * 2.4;
            const len = (0.18 + rand() * 0.16) * perMetre;
            // (Never much under a texel wide: a thinner blade would only be its anti-aliasing.)
            const half = Math.max(len * (0.08 + rand() * 0.035), 0.6);
            const ca = Math.cos(angle);
            const sa = Math.sin(angle);
            const ox = tx + ca * len * 0.1 + (rand() - 0.5) * 3 * (perMetre / 42.7);
            const oy = ty + sa * len * 0.1 + (rand() - 0.5) * 3 * (perMetre / 42.7);
            const reach = half * 1.1 + aa;
            const inv = 1 / len;
            const y0 = Math.floor(Math.min(oy, oy + sa * len) - reach);
            const y1 = Math.ceil(Math.max(oy, oy + sa * len) + reach);
            for (let y = y0; y <= y1; y++) {
                const dy = y + 0.5 - oy;
                // The columns this row crosses the blade's box in: along ∈ (0, len), |across| < reach.
                let lo = -Infinity;
                let hi = Infinity;
                if (Math.abs(ca) > 1e-4) {
                    const a = -(dy * sa) / ca;
                    const b = (len - dy * sa) / ca;
                    lo = Math.max(lo, Math.min(a, b));
                    hi = Math.min(hi, Math.max(a, b));
                } else if (dy * sa <= 0 || dy * sa >= len) continue;
                if (Math.abs(sa) > 1e-4) {
                    const a = (dy * ca - reach) / sa;
                    const b = (dy * ca + reach) / sa;
                    lo = Math.max(lo, Math.min(a, b));
                    hi = Math.min(hi, Math.max(a, b));
                } else if (Math.abs(dy * ca) >= reach) continue;
                if (!(hi > lo)) continue;
                let wy = y % size;
                if (wy < 0) wy += size;
                const row = wy * size;
                for (let x = Math.floor(ox + lo - 0.5); x <= Math.ceil(ox + hi - 0.5); x++) {
                    const dx = x + 0.5 - ox;
                    const along = (dx * ca + dy * sa) * inv;
                    if (along <= 0 || along >= 1) continue;
                    const across = Math.abs(dy * ca - dx * sa);
                    const c = (half * profile[Math.round(along * PROFILE)] - across) / aa + 0.5;
                    if (c <= 0) continue;
                    let wx = x % size;
                    if (wx < 0) wx += size;
                    const v = c < 1 ? c : 1;
                    if (v > cover[row + wx]) cover[row + wx] = v;
                }
            }
        }
    }
    const data = new Uint8Array(size * size);
    let total = 0;
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.round(cover[i] * 255);
        total += cover[i];
    }
    return {
        data, size, mipmaps: buildMips(data, size, 1), cover: total / data.length,
    };
}

// ── The ramp, the fBm bands and the lattice ─────────────────────────────────────

/** The age ramp, 256 × 1 RGBA8 in linear light (decoded from sRGB here, once). */
export function bakeRamp(width = 256) {
    const data = new Uint8Array(width * 4);
    const rgb = [0, 0, 0];
    for (let i = 0; i < width; i++) {
        rampAt(i / (width - 1), rgb);
        data[i * 4] = Math.round(rgb[0] * 255);
        data[i * 4 + 1] = Math.round(rgb[1] * 255);
        data[i * 4 + 2] = Math.round(rgb[2] * 255);
        data[i * 4 + 3] = 255;
    }
    return { data, width, height: 1 };
}

/**
 * Lattice cells per tile of each band's lowest octave, and its octaves: R 2 (+2), G 4 (+2),
 * B 16 (+1), A 32 (+1). Each band is stretched to the full 0..1 range.
 */
export const FBM_BANDS = Object.freeze([[2, 3], [4, 3], [16, 2], [32, 2]]);

/** Four tileable value-noise bands as RGBA8, with a box-filtered mip chain down to 1 × 1. */
export function bakeFbm(seed = 4441, size = 256) {
    const data = new Uint8Array(size * size * 4);
    FBM_BANDS.forEach(([cells, octaves], band) => {
        let lo = Infinity;
        let hi = -Infinity;
        const field = fbmGrid(size, seed + band * 997, cells, cells, octaves);
        for (let i = 0; i < field.length; i++) {
            lo = Math.min(lo, field[i]);
            hi = Math.max(hi, field[i]);
        }
        const inv = 1 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i++) data[i * 4 + band] = Math.round((field[i] - lo) * inv * 255);
    });
    return {
        data, size, mipmaps: buildMips(data, size, 4),
    };
}

/**
 * White noise for 3D value noise in one fetch: G holds R shifted by one z-slice, A holds B
 * shifted the same way, so mix(rb, ga, fz) at xy + LATTICE_SLICE · floor(z) is the trilinear
 * blend of two independent fields. Sampled at level 0 with bilinear filtering.
 */
export function bakeLattice(seed = 9917, size = 256) {
    const rand = mulberry32(seed);
    const r = new Uint8Array(size * size);
    const b = new Uint8Array(size * size);
    for (let i = 0; i < r.length; i++) {
        r[i] = Math.floor(rand() * 256);
        b[i] = Math.floor(rand() * 256);
    }
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const j = ((y + LATTICE_SLICE[1]) % size) * size + ((x + LATTICE_SLICE[0]) % size);
            data[i * 4] = r[i];
            data[i * 4 + 1] = r[j];
            data[i * 4 + 2] = b[i];
            data[i * 4 + 3] = b[j];
        }
    }
    return { data, size };
}
