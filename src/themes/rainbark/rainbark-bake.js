/**
 * Rainbark — the CPU bakes: three-free, deterministic typed arrays that rainbark-tsl.js wraps as
 * 2D DataTextures. Nothing is fetched and nothing is 3D (a 3D texture's writes fail validation on
 * some software adapters); everything here is synchronous and the same for the same seed.
 *
 *   bakePatchAtlas  the bark's patch map: ragged vertical ribbons of younger bark laid over a
 *                   matrix of old bark, one tileable 4.8 m × 14 m tile of bark space
 *   bakeCrownField  the canopy's crowns as a signed field of leaf clumps (round clumps ragged by
 *                   sprays of lanceolate leaves, kept off the channels of crown shyness), their
 *                   limbs, the openings' half-widths and the masses' tones, RGBA8, mips
 *   bakeLeafLace    the leaves' detail inside the crowns: tileable leaf coverage, R8, mips
 *   bakeGapMask     where the sun gets through the canopy (the sunflecks' gobo), R8, mips
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
    ATLAS_CONSISTENT, ATLAS_ISLANDS, ATLAS_RIBBONS, BARK_TEAR, BARK_TILE, CANOPY_CLUMPS, CANOPY_CROWNS, CANOPY_LACE,
    CANOPY_LIMBS, GAP_MASK,
    LATTICE_SLICE, PATCH_EDGE_RANGE, buildMips, clamp01, mulberry32, rampAt, ribbonPhases, smooth,
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
        // The width breathes only gently (a swollen belly on a long ribbon is a procedural tell:
        // the real streaks run parallel-sided and change width in torn jogs, below).
        r.breathLo = 0.68;
        r.breathHi = 1.06;
        r.biteDepth = 0.05 + shape() * 0.09;
        r.biteSpacing = 0.3 + shape() * 0.5;
        r.pointed = shape() < 0.45;
        r.rag = 1;
    });
    // From a third stream (so the layout and the shapes above stay put): 1–3 torn jogs a ribbon,
    // where one side steps in or out by 4–12 cm over 5–10 cm of height.
    const tear = mulberry32((seed ^ 0x2f6b9a1d) >>> 0);
    ribbons.forEach((r) => {
        const jogs = 1 + Math.floor(tear() * 3);
        r.jogs = Array.from({ length: jogs }, () => ({
            y: (tear() - 0.5) * r.h * 0.7,
            left: tear() < 0.5,
            step: (0.04 + tear() * 0.08) * (tear() < 0.5 ? -1 : 1),
            over: 0.05 + tear() * 0.05,
        }));
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
    const breath = r.breathLo + (r.breathHi - r.breathLo) * slow + 0.12 * quick;
    // (No wider than the widest ribbon's own width: breathing pinches more than it swells.)
    const half = Math.min(r.w0 * breath, MAX_RIBBON_WIDTH) * 0.5 * swell;
    // The torn jogs: below each, one side stands its step in or out.
    let jogL = 0;
    let jogR = 0;
    if (r.jogs) {
        for (let j = 0; j < r.jogs.length; j++) {
            const g = r.jogs[j];
            const moved = g.step * smooth(g.y - g.over / 2, g.y + g.over / 2, -dy) * swell;
            if (g.left) jogL += moved;
            else jogR += moved;
        }
    }
    // Bites out of each side: irregular notches, gated by a slower noise so they come in runs.
    const bite = (layer, gate) => r.biteDepth * smooth(0.42, 0.75, layer(k * 1.7, dy / r.biteSpacing + 20))
        * smooth(0.3, 0.6, gate(k * 2.3, dy / 2.1 + 9));
    out.halfL = Math.max(0, half + jogL - bite(noise.biteL, noise.gateL));
    out.halfR = Math.max(0, half + jogR - bite(noise.biteR, noise.gateR));
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
 *             matrixShare: number, islandShare: number, areas: Float32Array, phases: Float32Array }}
 *   matrixShare  the share of the tile no ribbon covers (the old bark, its islands included)
 *   islandShare  the share of the tile the islands show in
 *   areas        each ribbon's visible texels, and `phases` its place in the tile's cycle
 *                (atlasPhases: spread by area, the same at every atlas size; null when the
 *                option `phases` is false)
 */
export function bakePatchAtlas(seed = 21, size = 512, {
    count = ATLAS_RIBBONS, islands = ATLAS_ISLANDS, phases = true,
} = {}) {
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
    // Each ribbon's visible area (texels), and from it its place in the tile's cycle.
    const areas = new Float32Array(nRibbons);
    for (let i = 0; i < texels; i++) if (region[i] > nIslands) areas[region[i] - nIslands - 1] += 1;
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
        areas,
        phases: phases ? atlasPhases(seed, nRibbons, nIslands) : null,
    };
}

/** The coarse bake whose ribbon areas place the ribbons in their cycle (atlasPhases). */
export const ATLAS_PHASE_SIZE = 128;
/**
 * The world's atlas (seed 21, ATLAS_RIBBONS ribbons, ATLAS_ISLANDS islands): its ribbons' places,
 * found once by atlasPhases' search and frozen here, so a theme load never pays for the search on
 * the main thread (a unit test recomputes them and checks they still match).
 */
export const ATLAS_PHASES_21 = Object.freeze([
    0.877593577, 0.880187213, 0.525597632, 0.717128992, 0.855942726, 0.127424449, 0.465606689, 0.416328371,
    0.690798402, 0.0527176373, 0.890843511, 0.618234098, 0.377029777, 0.39580515, 0.51302433, 0.949537635,
    0.80846864, 0.223387465, 0.661366701, 0.561682463, 0.759303093, 0.331134409,
]);
const PHASES = new Map([[`21:${ATLAS_RIBBONS}:${ATLAS_ISLANDS}`, Float32Array.from(ATLAS_PHASES_21)]]);
/**
 * Each ribbon's place in its tile's cycle (ribbonPhases) for a seed and plan: spread by the areas
 * of one coarse bake of the plan (ATLAS_PHASE_SIZE), never the tier's own atlas, so every atlas size
 * shows a ribbon in the same colour at the same moment (the swaps that refine the order would land
 * elsewhere on another size's areas). Found once per seed and plan, then kept (the world's own
 * seed and plan are frozen: ATLAS_PHASES_21). `search`: find them even where they are frozen.
 */
export function atlasPhases(seed = 21, count = ATLAS_RIBBONS, islands = ATLAS_ISLANDS, { search = false } = {}) {
    const key = `${seed}:${count}:${islands}`;
    if (search) {
        const { areas } = bakePatchAtlas(seed, ATLAS_PHASE_SIZE, { count, islands, phases: false });
        return ribbonPhases(areas);
    }
    if (!PHASES.has(key)) {
        const { areas } = bakePatchAtlas(seed, ATLAS_PHASE_SIZE, { count, islands, phases: false });
        PHASES.set(key, ribbonPhases(areas));
    }
    return PHASES.get(key);
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
 * A tapering limb rasterised into channel `ch` of an interleaved tileable field (texels, wrapping):
 * a capsule from (x0, y0) radius r0 to (x1, y1) radius r1, anti-aliased over a texel (union).
 */
function strokeLimb(out, size, stride, ch, x0, y0, r0, x1, y1, r1) {
    const reach = Math.max(r0, r1) + 1;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = Math.max(dx * dx + dy * dy, 1e-6);
    for (let y = Math.floor(Math.min(y0, y1) - reach); y <= Math.ceil(Math.max(y0, y1) + reach); y++) {
        const wy = ((y % size) + size) % size;
        for (let x = Math.floor(Math.min(x0, x1) - reach); x <= Math.ceil(Math.max(x0, x1) + reach); x++) {
            const px = x + 0.5 - x0;
            const py = y + 0.5 - y0;
            const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
            const d = Math.hypot(px - dx * t, py - dy * t);
            const c = r0 + (r1 - r0) * t - d + 0.5;
            if (c <= 0) continue;
            const i = (wy * size + (((x % size) + size) % size)) * stride + ch;
            const v = Math.round(Math.min(1, c) * 255);
            if (v > out[i]) out[i] = v;
        }
    }
}

/**
 * The limbs inside one crown seen from below (CANOPY_LIMBS), into channel `ch`: from near the
 * crown's heart, `count` limbs fan outward, each wandering a little as it goes, tapering, and
 * forking once; they end inside the crown (its leaves hang from them), so from below they show
 * only where the leaves part: dark lines running into the lace toward each crown's trunk. Every
 * step's end goes into `hangs` as (x, y metres, share of its limb's length from the heart): where
 * the leaf masses hang.
 */
function crownLimbs(out, size, stride, ch, cx, cy, rand, hangs) {
    const L = CANOPY_LIMBS;
    const perMetre = size / CANOPY_CROWNS.tile;
    const count = L.count[0] + Math.floor(rand() * (L.count[1] - L.count[0] + 1));
    const spin = rand() * Math.PI * 2;
    const limb = (x, y, heading, length, width, fork, from) => {
        const steps = Math.max(2, Math.round(length / L.step));
        const forkAt = fork ? Math.floor(steps * (L.forkAt[0] + rand() * (L.forkAt[1] - L.forkAt[0]))) : -1;
        let px = x;
        let py = y;
        let a = heading;
        for (let k = 0; k < steps; k++) {
            const w0 = width * (1 - (1 - L.tip) * (k / steps));
            const w1 = width * (1 - (1 - L.tip) * ((k + 1) / steps));
            a += (rand() - 0.5) * L.wander;
            const nx = px + Math.cos(a) * (length / steps);
            const ny = py + Math.sin(a) * (length / steps);
            const r0 = w0 * 0.5 * perMetre;
            const r1 = w1 * 0.5 * perMetre;
            strokeLimb(out, size, stride, ch, px * perMetre, py * perMetre, r0, nx * perMetre, ny * perMetre, r1);
            const along = from + (1 - from) * ((k + 1) / steps);
            hangs.push(nx, ny, along);
            if (k === forkAt) {
                const side = rand() < 0.5 ? -1 : 1;
                const turn = side * (L.forkTurn[0] + rand() * (L.forkTurn[1] - L.forkTurn[0]));
                limb(nx, ny, a + turn, length * (1 - k / steps) * L.forkLength, w1 * L.forkWidth, false, along);
            }
            px = nx;
            py = ny;
        }
    };
    for (let i = 0; i < count; i++) {
        const heading = spin + ((i + 0.3 + rand() * 0.4) / count) * Math.PI * 2;
        const length = L.length[0] + rand() * (L.length[1] - L.length[0]);
        const width = L.width[0] + rand() * (L.width[1] - L.width[0]);
        const r = L.start;
        limb(cx + Math.cos(heading) * r, cy + Math.sin(heading) * r, heading, length, width, true, 0);
    }
}

/**
 * The room the leaves have in a crown (metres, + inside it), on a size × size grid over the tile:
 * how far a point stands inside the channel of crown shyness round its crown. A jittered power
 * diagram (crowns of 15–25 m, unequal), looked up through a warp so no border runs straight; the
 * channels 1.5–3 m wide and ragged, widening where three crowns meet, and at a few meetings
 * opening into holes 9–14 m across.
 */
function crownRoom(sites, seed, size) {
    const { tile } = CANOPY_CROWNS;
    const noise = Math.max(16, size >> 1);
    const warpX = upsample(fbmGrid(noise, seed + 43, 4, 4, 3), noise, size);
    const warpY = upsample(fbmGrid(noise, seed + 47, 4, 4, 3), noise, size);
    const rag = upsample(fbmGrid(noise, seed + 31, 12, 12, 3), noise, size);
    const holes = upsample(fbmGrid(noise, seed + 89, 3, 3, 2), noise, size);
    const room = new Float32Array(size * size);
    const borders = [0, 0];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const px = (x + 0.5) / size + (warpX[i] - 0.5) * 0.09;
            const py = (y + 0.5) / size + (warpY[i] - 0.5) * 0.09;
            powerBorders(px, py, sites, borders);
            // Metres from the border between the two nearest crowns, and from the third.
            const border = borders[0] * tile;
            const meet = 1 - smooth(0.5, 4.5, borders[1] * tile);
            const wide = smooth(0.56, 0.68, holes[i]);
            room[i] = border - (0.75 + 0.75 * rag[i] + meet * (0.8 + 5 * wide));
        }
    }
    return room;
}

/**
 * A primitive's signed value (+ inside, metres) written into the field where it stands higher
 * (a union), over its box out to `reach` metres outside it, wrapping; the texel takes its tone.
 * A disc of radius `r` (`leaf` null), or a lanceolate leaf: a vesica (two discs' lens) of
 * half-length `r`, half-width r/aspect, along the unit `leaf` = [cos, sin], pointed at both ends.
 */
function unionInto(field, tone, size, perMetre, cx, cy, r, reach, value, leaf = null, aspect = 1) {
    const span = (r + reach) * perMetre;
    const x0 = Math.floor(cx * perMetre - span);
    const x1 = Math.ceil(cx * perMetre + span);
    const y0 = Math.floor(cy * perMetre - span);
    const y1 = Math.ceil(cy * perMetre + span);
    const W = r / aspect;
    const vr = ((r * r) / W + W) * 0.5;
    const vd = vr - W;
    const ca = leaf ? leaf[0] : 1;
    const sa = leaf ? leaf[1] : 0;
    const inv = 1 / perMetre;
    for (let y = y0; y <= y1; y++) {
        const dy = (y + 0.5) * inv - cy;
        const row = (((y % size) + size) % size) * size;
        let i = row + (((x0 % size) + size) % size);
        const end = row + size;
        for (let x = x0; x <= x1; x++, i++) {
            if (i >= end) i -= size;
            const dx = (x + 0.5) * inv - cx;
            let v;
            if (!leaf) v = r - Math.sqrt(dx * dx + dy * dy);
            else {
                const along = Math.abs(dx * ca + dy * sa);
                const across = Math.abs(dy * ca - dx * sa);
                if ((along - r) * vd > across * r) v = -Math.sqrt(across * across + (along - r) * (along - r));
                else v = vr - Math.sqrt((across + vd) * (across + vd) + along * along);
            }
            if (v > field[i]) {
                field[i] = v;
                tone[i] = value;
            }
        }
    }
}

/** One line of the squared Euclidean distance transform (Felzenszwalb & Huttenlocher), in place. */
function edtLine(f, n, v, z, d) {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
        let sq = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (sq <= z[k]) {
            k -= 1;
            sq = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = sq;
        z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k += 1;
        d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    for (let q = 0; q < n; q++) f[q] = d[q];
}

/**
 * Texels from each texel of a tileable size × size mask to the nearest set one (exact Euclidean,
 * wrapping: the tile is padded by `pad` texels of itself, so distances past `pad` are clamped).
 */
function distanceToMask(mask, size, pad) {
    const n = size + 2 * pad;
    const big = 1e12;
    const g = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
        const sy = (((y - pad) % size) + size) % size;
        for (let x = 0; x < n; x++) {
            const sx = (((x - pad) % size) + size) % size;
            g[y * n + x] = mask[sy * size + sx] ? 0 : big;
        }
    }
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) f[y] = g[y * n + x];
        edtLine(f, n, v, z, d);
        for (let y = 0; y < n; y++) g[y * n + x] = f[y];
    }
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
        const row = (y + pad) * n;
        for (let x = 0; x < n; x++) f[x] = g[row + x];
        edtLine(f, n, v, z, d);
        for (let x = 0; x < size; x++) out[y * size + x] = Math.sqrt(Math.min(f[x + pad], pad * pad));
    }
    return out;
}

/**
 * The canopy's crowns seen from below as a field of leaf clumps (CANOPY_CROWNS, CANOPY_CLUMPS),
 * one tileable square, RGBA8 with its CPU mip chain:
 *  R  the signed distance to the leaves' edge (metres, + in the leaves), ±CANOPY_CROWNS.range;
 *  G  the limbs (crownLimbs: 0 none … 255 a limb);
 *  B  the half-width of the opening a texel of sky lies in (metres, 0 … range): the radius of the
 *     widest disc of sky that holds it, carried a texel or two under the leaves' edge;
 *  A  the tone of the leaf mass a texel belongs to (0 dark … 1 light), `dome` of it its clump's
 *     own depth (lighter toward a clump's heart: the masses read as clustered clumps).
 * Leaf masses stand `masses.apart` metres apart through every crown (dart thrown where the crown
 * has room, crownRoom, and its broad thinning allows) and at the ends of the limbs' steps; each
 * mass is a cluster of round clumps (`clumps`), each clump ragged by lanceolate sprays of leaves
 * (`leaves`: pointed at both ends, `aspect` times as long as wide) hanging out round its rim, the
 * clumps kept off the channels of crown shyness while their sprays may hang into them. The field
 * is their union: round, convex clump arcs and pointed sprays along every edge, so a threshold of
 * it draws foliage at any distance, never the iso-line of a blurred noise. A mass's tone: its own,
 * and lighter toward its crown's rim (`rim`: the thinner, lit edge), darker in the crown's heart.
 * Returns { data, size, channels: 4, mipmaps, cover (the leaves' share) }.
 */
export function bakeCrownField(seed = CANOPY_CROWNS.seed, size = CANOPY_CROWNS.size) {
    const rand = mulberry32(seed >>> 0);
    const { tile, range } = CANOPY_CROWNS;
    const K = CANOPY_CLUMPS;
    const perMetre = size / tile;
    const sites = jitteredSites(rand, CANOPY_CROWNS.crowns, 0.8, 0.05);
    const roomSize = Math.max(16, size >> 2);
    const room = crownRoom(sites, seed, roomSize);
    const thin = fbmGrid(roomSize, seed + 57, 6, 6, 3);
    const sampler = (grid) => (mx, my) => {
        const fx = (mx / tile) * roomSize - 0.5;
        const fy = (my / tile) * roomSize - 0.5;
        const xf = Math.floor(fx);
        const yf = Math.floor(fy);
        const f = fx - xf;
        const g = fy - yf;
        const a = ((xf % roomSize) + roomSize) % roomSize;
        const b = (a + 1) % roomSize;
        const r0 = (((yf % roomSize) + roomSize) % roomSize) * roomSize;
        const r1 = ((((yf + 1) % roomSize) + roomSize) % roomSize) * roomSize;
        const top = grid[r0 + a] + (grid[r0 + b] - grid[r0 + a]) * f;
        const bottom = grid[r1 + a] + (grid[r1 + b] - grid[r1 + a]) * f;
        return top + (bottom - top) * g;
    };
    const roomAt = sampler(room);
    const thinAt = sampler(thin);
    const data = new Uint8Array(size * size * 4);
    // ── The limbs (G), and where along them leaf masses hang ──
    const hangs = [];
    const limbRand = mulberry32((seed ^ 0x51ed27) >>> 0);
    for (let k = 0; k < sites.length; k += 3) {
        crownLimbs(data, size, 4, 1, sites[k] * tile, sites[k + 1] * tile, limbRand, hangs);
    }
    // ── The leaf masses: at limbs' steps, then dart thrown through the crowns ──
    const leafRand = mulberry32((seed ^ 0x2c1b3a) >>> 0);
    const masses = [];
    const cells = Math.max(1, Math.floor(tile / K.masses.apart));
    const grid = Array.from({ length: cells * cells }, () => []);
    const cellOf = (v) => ((Math.floor((v / tile) * cells) % cells) + cells) % cells;
    const apart2 = K.masses.apart * K.masses.apart;
    const tryMass = (mx, my) => {
        if (roomAt(mx, my) < K.masses.least) return;
        if (leafRand() < smooth(K.masses.thin[0], K.masses.thin[1], thinAt(mx, my))) return;
        const gx = cellOf(mx);
        const gy = cellOf(my);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const list = grid[((gy + dy + cells) % cells) * cells + ((gx + dx + cells) % cells)];
                for (let i = 0; i < list.length; i += 2) {
                    let ex = list[i] - mx;
                    let ey = list[i + 1] - my;
                    ex -= tile * Math.round(ex / tile);
                    ey -= tile * Math.round(ey / tile);
                    if (ex * ex + ey * ey < apart2) return;
                }
            }
        }
        grid[gy * cells + gx].push(mx, my);
        masses.push(mx, my);
    };
    for (let k = 0; k < hangs.length; k += 3) {
        if (leafRand() < smooth(K.masses.from, 1, hangs[k + 2])) tryMass(hangs[k], hangs[k + 1]);
    }
    for (let n = 0; n < K.masses.darts; n++) tryMass(leafRand() * tile, leafRand() * tile);
    // ── The masses' clumps, then the sprays of leaves round the clumps' rims that still face sky ──
    const { reach } = K;
    const field = new Float32Array(size * size).fill(-reach);
    const tone = new Float32Array(size * size);
    const clumps = [];
    for (let m = 0; m < masses.length; m += 2) {
        const mx = masses[m];
        const my = masses[m + 1];
        const R = K.masses.radius[0] + leafRand() * (K.masses.radius[1] - K.masses.radius[0]);
        const value = clamp01(leafRand() * (1 - K.rim) + K.rim * (1 - smooth(1, 9, roomAt(mx, my))));
        const n = K.clumps.count[0] + Math.floor(leafRand() * (K.clumps.count[1] - K.clumps.count[0] + 1));
        for (let c = 0; c < n; c++) {
            const r = K.clumps.radius[0] + leafRand() * leafRand() * (K.clumps.radius[1] - K.clumps.radius[0]);
            const a = leafRand() * Math.PI * 2;
            const d = Math.sqrt(leafRand()) * Math.max(R - r, 0) * K.clumps.spread;
            const cx = mx + Math.cos(a) * d;
            const cy = my + Math.sin(a) * d;
            if (roomAt(cx, cy) < r * K.clumps.into) continue;
            unionInto(field, tone, size, perMetre, cx, cy, r, reach, value);
            clumps.push(cx, cy, r, value);
        }
    }
    const fieldAt = (mx, my) => {
        const x = ((Math.floor(mx * perMetre) % size) + size) % size;
        const y = ((Math.floor(my * perMetre) % size) + size) % size;
        return field[y * size + x];
    };
    const spray = [1, 0];
    for (let c = 0; c < clumps.length; c += 4) {
        const [cx, cy, r, value] = [clumps[c], clumps[c + 1], clumps[c + 2], clumps[c + 3]];
        const sprays = K.leaves.count[0] + Math.floor(leafRand() * (K.leaves.count[1] - K.leaves.count[0] + 1));
        for (let s = 0; s < sprays; s++) {
            const around = leafRand() * Math.PI * 2;
            const turn = around + (leafRand() - 0.5) * K.leaves.splay;
            const L = (K.leaves.length[0] + leafRand() * (K.leaves.length[1] - K.leaves.length[0])) * 0.5;
            const out = r * K.leaves.root + L;
            const lx = cx + Math.cos(around) * out;
            const ly = cy + Math.sin(around) * out;
            // (Only where the spray would show: a spray buried in the mass is never drawn.)
            if (fieldAt(lx, ly) > L || roomAt(lx, ly) < -L * K.leaves.hang) continue;
            spray[0] = Math.cos(turn);
            spray[1] = Math.sin(turn);
            unionInto(field, tone, size, perMetre, lx, ly, L, reach, value, spray, K.aspect);
        }
    }
    // ── Out in the sky, beyond the primitives' reach, the distance to the nearest leaf (exact
    // Euclidean, at half the size) ──
    const h = size >> 1;
    const perHalf = perMetre / 2;
    const leafy = new Uint8Array(h * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < h; x++) {
            const i = 2 * y * size + 2 * x;
            const any = field[i] > 0 || field[i + 1] > 0 || field[i + size] > 0 || field[i + size + 1] > 0;
            leafy[y * h + x] = any ? 1 : 0;
        }
    }
    const pad = Math.ceil(range * perHalf) + 2;
    const away = upsample(distanceToMask(leafy, h, pad), h, size);
    for (let i = 0; i < field.length; i++) {
        if (field[i] <= -reach + 1e-6) field[i] = -Math.min(Math.max(away[i] / perHalf, reach), range);
    }
    // ── The openings' half-widths, at half the size: every texel of sky stamps its distance to the
    // leaves over the disc of that radius round it (the widest disc of sky holding a texel) ──
    const half = new Float32Array(h * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < h; x++) {
            const i = 2 * y * size + 2 * x;
            half[y * h + x] = (field[i] + field[i + 1] + field[i + size] + field[i + size + 1]) * 0.25;
        }
    }
    const width = new Float32Array(h * h);
    const most = Math.ceil(range * perHalf) + 1;
    const wrap = new Int32Array(h + 2 * most);
    for (let k = 0; k < wrap.length; k++) wrap[k] = (((k - most) % h) + h) % h;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < h; x++) {
            const r = -half[y * h + x];
            if (r <= 0) continue;
            // (Only from a ridge of the distance: a texel with a farther neighbour stamps nothing new.)
            const lift = r + 0.5 / perHalf;
            const up = wrap[y - 1 + most] * h;
            const mid = y * h;
            const down = wrap[y + 1 + most] * h;
            const l = wrap[x - 1 + most];
            const rr = wrap[x + 1 + most];
            const farther = Math.max(
                -half[up + l],
                -half[up + x],
                -half[up + rr],
                -half[mid + l],
                -half[mid + rr],
                -half[down + l],
                -half[down + x],
                -half[down + rr],
            );
            if (farther > lift) continue;
            const rt = r * perHalf;
            const span = Math.floor(rt);
            const rt2 = rt * rt;
            for (let dy = -span; dy <= span; dy++) {
                const row = wrap[y + dy + most] * h;
                const reachX = Math.floor(Math.sqrt(Math.max(rt2 - dy * dy, 0)));
                for (let dx = -reachX; dx <= reachX; dx++) {
                    const j = row + wrap[x + dx + most];
                    if (r > width[j]) width[j] = r;
                }
            }
        }
    }
    // (Each sky texel at least its own distance; carried a texel under the leaves' edge.)
    for (let i = 0; i < width.length; i++) if (-half[i] > width[i]) width[i] = -half[i];
    const prev = width.slice();
    for (let y = 0; y < h; y++) {
        const up = wrap[y - 1 + most] * h;
        const mid = y * h;
        const down = wrap[y + 1 + most] * h;
        for (let x = 0; x < h; x++) {
            if (half[mid + x] <= 0) continue;
            const l = wrap[x - 1 + most];
            const rr = wrap[x + 1 + most];
            width[mid + x] = Math.max(
                prev[up + l],
                prev[up + x],
                prev[up + rr],
                prev[mid + l],
                prev[mid + x],
                prev[mid + rr],
                prev[down + l],
                prev[down + x],
                prev[down + rr],
            );
        }
    }
    // ── In the leaves, the distance to the nearest opening wider than a pinhole (`pinhole` metres
    // of half-width; exact Euclidean, at half the size), so a mass's heart is deep however its
    // clumps overlap and whatever pinholes it holds (a clump's own depth goes into its tone) ──
    const open = new Uint8Array(h * h);
    for (let i = 0; i < open.length; i++) open[i] = half[i] < 0 && width[i] >= K.pinhole ? 1 : 0;
    const deep = upsample(distanceToMask(open, h, pad), h, size);
    for (let i = 0; i < field.length; i++) {
        const v = field[i];
        if (v <= 0) continue;
        // A clump's own depth (0 at its rim … 1 a metre in) shades its mass's tone.
        tone[i] = clamp01((1 - K.dome) * tone[i] + K.dome * smooth(0, 1, v));
        // (Near the edge the primitives' own value is exact; the half-size distance, a texel of it
        // short, takes over deeper in, where a crease between clumps is no edge at all.)
        field[i] = Math.min(Math.max(v, (deep[i] - 1) / perHalf), range);
    }
    const widths = upsample(width, h, size);
    // ── Pack ──
    let leaves = 0;
    for (let i = 0; i < size * size; i++) {
        const d = field[i];
        if (d > 0) leaves += 1;
        data[i * 4] = Math.round(clamp01(d / (2 * range) + 0.5) * 255);
        data[i * 4 + 2] = Math.round(clamp01(widths[i] / range) * 255);
        data[i * 4 + 3] = Math.round(clamp01(tone[i]) * 255);
    }
    return {
        data, size, channels: 4, mipmaps: buildMips(data, size, 4), cover: leaves / (size * size),
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
 * Its mips are a Gaussian pyramid (gaussianMips), the first the field itself.
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
    // A Gaussian pyramid: cut at a threshold, a level only a few texels across a clump draws round
    // silhouettes, never a box chain's polygons.
    const mipmaps = gaussianMips(cover, size);
    mipmaps[0] = { data, width: size, height: size };
    return {
        data, size, mipmaps, cover: total / data.length,
    };
}

// ── The canopy's gap mask (the sunflecks' gobo) ─────────────────────────────────

/** The binomial kernel a level is filtered with before it is halved (centred between two texels). */
const HALVE = [1, 5, 10, 10, 5, 1].map((w) => w / 32);
/** The binomial kernel that softens a level in place (σ = 1 texel of it). */
const SOFTEN = [1, 4, 6, 4, 1].map((w) => w / 16);

/** A tileable square field filtered in place by SOFTEN along both axes (wrapping), `passes` times. */
function soften(field, w, passes = 1) {
    if (passes > 1) return soften(soften(field, w, passes - 1), w);
    const rows = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let k = 0; k < 5; k++) sum += SOFTEN[k] * field[y * w + ((((x + k - 2) % w) + w) % w)];
            rows[y * w + x] = sum;
        }
    }
    const out = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let k = 0; k < 5; k++) sum += SOFTEN[k] * rows[((((y + k - 2) % w) + w) % w) * w + x];
            out[y * w + x] = sum;
        }
    }
    return out;
}

/**
 * A Gaussian pyramid of a tileable R8 field: each level is the last filtered by a six-tap
 * binomial (σ ≈ 1.1 texels of it, wrapping) and halved, its texel centred between the two it
 * replaces, so the levels line up with a box chain's and keep its mean. A box chain turns a lone
 * opening into one bright texel whose bilinear read is a diamond; band-limited like this, every
 * level reads back as a round soft bump. `oversample` n: each level is stored softened in place
 * (SOFTEN, σ² = 1 a pass: 1 pass holds the next level's blur, 6 the one after) so it holds the
 * blur of the level n further down at 2ⁿ times its texels: thresholded, a bilinear read of a level
 * only a few texels across a bump draws a polygon with straight sides, and at four times the
 * texels it draws a round disc (level 0 is then the field itself softened).
 */
function gaussianMips(field, size, { oversample = 0 } = {}) {
    const toBytes = (f) => {
        const out = new Uint8Array(f.length);
        for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(f[i] * 255)));
        return out;
    };
    const passes = [0, 1, 6][oversample];
    const store = (f, w) => ({ data: toBytes(passes ? soften(f, w, passes) : f), width: w, height: w });
    const levels = [store(field, size)];
    let level = field;
    let w = size;
    while (w > 1) {
        const nw = w >> 1;
        const rows = new Float32Array(nw * w);
        for (let y = 0; y < w; y++) {
            for (let x = 0; x < nw; x++) {
                let sum = 0;
                for (let k = 0; k < 6; k++) sum += HALVE[k] * level[y * w + ((((2 * x + k - 2) % w) + w) % w)];
                rows[y * nw + x] = sum;
            }
        }
        const next = new Float32Array(nw * nw);
        for (let y = 0; y < nw; y++) {
            for (let x = 0; x < nw; x++) {
                let sum = 0;
                for (let k = 0; k < 6; k++) sum += HALVE[k] * rows[((((2 * y + k - 2) % w) + w) % w) * nw + x];
                next[y * nw + x] = sum;
            }
        }
        levels.push(store(next, nw));
        level = next;
        w = nw;
    }
    return levels;
}

/**
 * The canopy seen from below where the sun gets through (GAP_MASK): one tileable square of leaves
 * (0) with openings (1) in it, R8, with its mip chain. Thin places in the crowns (patches, kept
 * apart by dart throwing, wrapping) each hold a handful of pinholes; medium openings and fine
 * pinholes are scattered between; each opening an ellipse turned its own way, its rim bitten by
 * leaves (lobes round it) and anti-aliased over a texel. Read through its mips at the size of a
 * pinhole image (rbFleck): from the Bole a patch is one soft fleck and the fine pinholes the dapple
 * between; under the canopy every opening is its own small, crisp fleck.
 * Returns { data, size, mipmaps, open (the tile's open share), openings: [{ x, y, r }] (metres) }.
 */
export function bakeGapMask(seed = GAP_MASK.seed, size = GAP_MASK.size) {
    const G = GAP_MASK;
    const T = G.tile;
    const rand = mulberry32(seed >>> 0);
    const perMetre = size / T;
    const apart = (a, b) => {
        const d = Math.abs(a - b) % T;
        return Math.min(d, T - d);
    };
    const centres = [];
    for (let tries = 0; centres.length < G.patches && tries < 4000; tries++) {
        const c = [rand() * T, rand() * T];
        if (centres.every((o) => Math.hypot(apart(o[0], c[0]), apart(o[1], c[1])) >= G.apart)) centres.push(c);
    }
    const openings = [];
    const open = (x, y, [lo, hi]) => openings.push({
        x: ((x % T) + T) % T,
        y: ((y % T) + T) % T,
        r: lo + (hi - lo) * rand(),
        aspect: 1 + rand() * 0.3,
        turn: rand() * Math.PI,
        lobes: 3 + Math.floor(rand() * 4),
        bite: 0.12 + rand() * 0.18,
        phase: rand() * Math.PI * 2,
    });
    centres.forEach(([cx, cy]) => {
        const n = G.pinholes[0] + Math.floor(rand() * (G.pinholes[1] - G.pinholes[0] + 1));
        const spread = G.spread[0] + (G.spread[1] - G.spread[0]) * rand();
        for (let i = 0; i < n; i++) {
            // A gaussian step from the patch's centre (Box–Muller).
            const rr = spread * Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-6)));
            const a = rand() * Math.PI * 2;
            open(cx + rr * Math.cos(a), cy + rr * Math.sin(a), G.small);
        }
    });
    for (let i = 0; i < G.mediums; i++) open(rand() * T, rand() * T, G.medium);
    for (let i = 0; i < G.fine; i++) open(rand() * T, rand() * T, G.fineR);
    const cover = new Float32Array(size * size);
    openings.forEach((o) => {
        const ca = Math.cos(o.turn);
        const sa = Math.sin(o.turn);
        const reach = o.r * o.aspect * (1 + o.bite) * perMetre + 2;
        const cx = o.x * perMetre;
        const cy = o.y * perMetre;
        for (let yi = Math.floor(cy - reach); yi <= Math.ceil(cy + reach); yi++) {
            const wy = ((yi % size) + size) % size;
            for (let xi = Math.floor(cx - reach); xi <= Math.ceil(cx + reach); xi++) {
                const dx = (xi + 0.5 - cx) / perMetre;
                const dy = (yi + 0.5 - cy) / perMetre;
                // In the opening's own frame, its long axis stretched to a circle.
                const u = (dx * ca + dy * sa) / o.aspect;
                const v = -dx * sa + dy * ca;
                const d = Math.hypot(u, v);
                const angle = Math.atan2(v, u);
                const rim = o.r * (1 - o.bite * 0.5 * (1 + Math.sin(o.lobes * angle + o.phase)));
                // A texel of anti-aliasing at the rim.
                const c = clamp01(((rim - d) * perMetre) + 0.5);
                if (c <= 0) continue;
                const wx = ((xi % size) + size) % size;
                const k = wy * size + wx;
                if (c > cover[k]) cover[k] = c;
            }
        }
    });
    const data = new Uint8Array(size * size);
    let total = 0;
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.round(cover[i] * 255);
        total += cover[i];
    }
    return {
        data,
        size,
        mipmaps: gaussianMips(cover, size, { oversample: GAP_MASK.oversample }),
        open: total / data.length,
        openings: openings.map(({ x, y, r }) => ({ x, y, r })),
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
