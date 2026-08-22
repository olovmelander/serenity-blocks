/**
 * @fileoverview One World boot bakes — the PURE half (typed arrays only, no three object).
 *
 * Extracted from odyssey-world-renderer.js on 2026-08-21 (plan item 2.1) so the five texture
 * bakes can run in a Web Worker (odyssey-world-bake.worker.js): relief + derivatives, macro,
 * detail normal + cloud silhouette, and — from odyssey-ground-bakes.js — the sun fields and the
 * ground atlas. Every function here is deterministic and input-free beyond its resolution, and
 * byte-identical to the pre-extraction bakes (tests/unit/odyssey-world-bakes-golden.test.js).
 * The renderer module keeps thin wrappers that turn these arrays into DataTextures, and accepts
 * pre-baked data from the worker in place of running them.
 *
 * `DataUtils` comes from 'three' CORE (tree-shaken to the half-float table): NOT 'three/webgpu'.
 */

import { DataUtils } from 'three';
import {
    odysseyWorldDetailWeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import { createTilingValueNoise } from './odyssey-tiling-noise.js';
import { bakeGroundAtlasData, bakeGroundSunFieldsData } from './odyssey-ground-bakes.js';

// Re-exported so the worker and the loader import every bake from one module.
export { bakeGroundAtlasData, bakeGroundSunFieldsData };

/** World plate extent in units (shared by every bake and the clipmap). */
export const RELIEF_EXTENT = 9000;

export function bakeReliefData(reliefRes) {
    const step = RELIEF_EXTENT / (reliefRes - 1);
    const origin = -RELIEF_EXTENT / 2;

    // The only place the noise is evaluated. Deriving everything else from this grid rather
    // than recomputing cost 352 ms of pure duplicate work when it was done twice.
    const relief = new Float32Array(reliefRes * reliefRes);
    for (let j = 0; j < reliefRes; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < reliefRes; i += 1) {
            relief[(j * reliefRes) + i] = odysseyWorldRelief(origin + (i * step), z);
        }
    }
    const at = (i, j) => relief[(Math.max(0, Math.min(reliefRes - 1, j)) * reliefRes)
        + Math.max(0, Math.min(reliefRes - 1, i))];

    // AUX: derivatives central-differenced from the BAKED heights, never re-evaluated
    // analytically, so lighting describes exactly the surface the vertex shader displaces to.
    // A carries CURVATURE — the discrete Laplacian, mean(4-neighbours) - centre, divided by the
    // step so it is dimensionless. Positive is concave (a gully, the neighbours stand above
    // you), negative convex (a ridge). It is the difference between a landform that reads as
    // rock and one that reads as a smooth pile: first derivatives only tell the light which
    // way a face points, and every face of a cone points somewhere plausible. The channel was
    // already allocated and written as a literal zero, so this costs bake time and nothing
    // else — no VRAM, no bandwidth, no extra fetch.
    const data = new Uint16Array(reliefRes * reliefRes * 4);
    for (let j = 0; j < reliefRes; j += 1) {
        for (let i = 0; i < reliefRes; i += 1) {
            const idx = ((j * reliefRes) + i) * 4;
            data[idx] = DataUtils.toHalfFloat(relief[(j * reliefRes) + i]);
            data[idx + 1] = DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) / (2 * step));
            data[idx + 2] = DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) / (2 * step));
            const neighbourMean = (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) / 4;
            data[idx + 3] = DataUtils.toHalfFloat(
                (neighbourMean - relief[(j * reliefRes) + i]) / step,
            );
        }
    }
    // (Half-float is filterable everywhere with no feature request; float32-filterable is
    // optional in WebGPU — the wrapper in odyssey-world-renderer.js uploads these texels.)

    // CPU mirror of the DRAWN height, derived — no noise re-evaluation.
    const total = new Float32Array(reliefRes * reliefRes);
    for (let j = 0; j < reliefRes; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < reliefRes; i += 1) {
            const x = origin + (i * step);
            total[(j * reliefRes) + i] = odysseyWorldMacro(x, z)
                + (relief[(j * reliefRes) + i] * odysseyWorldDetailWeight(x, z));
        }
    }
    return {
        data, total, res: reliefRes, step, origin,
    };
}

/**
 * ONE HORIZONTAL BAND of {@link bakeReliefData}, rows [jStart, jEnd) — the same arithmetic in
 * the same order, so concatenated bands are byte-identical to the whole bake (pinned by
 * tests/unit/odyssey-world-bakes-golden.test.js).
 *
 * WHY (plan item 2.4, 2026-08-21): once the startup CPU steps stopped costing a second of
 * yield latency, the world bake became the critical path and its longest lane is the
 * dependency chain relief → sunFields. The noise, the derivative pack and the CPU height
 * mirror are all PER TEXEL, so the relief half splits across workers; only the sun march (which
 * needs the whole plate, and normalises over it) stays whole.
 *
 * The pack reads the four neighbours of each texel, so a band computes one HALO row of noise on
 * each side (clamped at the plate edges exactly as the whole bake clamps).
 * @param {number} reliefRes
 * @param {number} jStart first row of the band (inclusive)
 * @param {number} jEnd last row of the band (exclusive)
 * @returns {{data: Uint16Array, total: Float32Array, jStart: number, jEnd: number, res: number}}
 */
export function bakeReliefBand(reliefRes, jStart, jEnd) {
    const step = RELIEF_EXTENT / (reliefRes - 1);
    const origin = -RELIEF_EXTENT / 2;
    const j0 = Math.max(0, jStart - 1); // halo row above
    const j1 = Math.min(reliefRes, jEnd + 1); // halo row below
    const rows = j1 - j0;

    const relief = new Float32Array(rows * reliefRes);
    for (let j = j0; j < j1; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < reliefRes; i += 1) {
            relief[((j - j0) * reliefRes) + i] = odysseyWorldRelief(origin + (i * step), z);
        }
    }
    // Same clamp as the whole bake, expressed against the local rows.
    const at = (i, j) => relief[((Math.max(j0, Math.min(j1 - 1, j)) - j0) * reliefRes)
        + Math.max(0, Math.min(reliefRes - 1, i))];

    const bandRows = jEnd - jStart;
    const data = new Uint16Array(bandRows * reliefRes * 4);
    const total = new Float32Array(bandRows * reliefRes);
    for (let j = jStart; j < jEnd; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < reliefRes; i += 1) {
            const local = ((j - jStart) * reliefRes) + i;
            const centre = relief[((j - j0) * reliefRes) + i];
            const idx = local * 4;
            data[idx] = DataUtils.toHalfFloat(centre);
            data[idx + 1] = DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) / (2 * step));
            data[idx + 2] = DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) / (2 * step));
            const neighbourMean = (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) / 4;
            data[idx + 3] = DataUtils.toHalfFloat((neighbourMean - centre) / step);
            const x = origin + (i * step);
            total[local] = odysseyWorldMacro(x, z) + (centre * odysseyWorldDetailWeight(x, z));
        }
    }
    return {
        data, total, jStart, jEnd, res: reliefRes,
    };
}

/**
 * Concatenate {@link bakeReliefBand} results (any order) into a whole-plate relief bake.
 * @param {Array<{data: Uint16Array, total: Float32Array, jStart: number, jEnd: number}>} bands
 * @param {number} reliefRes
 */
export function mergeReliefBands(bands, reliefRes) {
    const data = new Uint16Array(reliefRes * reliefRes * 4);
    const total = new Float32Array(reliefRes * reliefRes);
    for (const band of bands) {
        data.set(band.data, band.jStart * reliefRes * 4);
        total.set(band.total, band.jStart * reliefRes);
    }
    return {
        data,
        total,
        res: reliefRes,
        step: RELIEF_EXTENT / (reliefRes - 1),
        origin: -RELIEF_EXTENT / 2,
    };
}

/** Row ranges for `count` bands over `reliefRes` rows (last band takes the remainder). */
export function reliefBandRanges(reliefRes, count) {
    const per = Math.ceil(reliefRes / count);
    const ranges = [];
    for (let jStart = 0; jStart < reliefRes; jStart += per) {
        ranges.push({ jStart, jEnd: Math.min(reliefRes, jStart + per) });
    }
    return ranges;
}

/**
 * The CPU mirror of the drawn height as a bilinear sampler over a baked `total` grid — built
 * on whichever thread holds the array (the worker result is transferred, the sampler rebuilt).
 * @param {{total: Float32Array, res: number, step: number, origin: number}} relief
 * @returns {(x: number, z: number) => number}
 */
export function makeReliefSampler({
    total, res: reliefRes, step, origin,
}) {
    return (x, z) => {
        const gx = Math.max(0, Math.min(reliefRes - 1.001, (x - origin) / step));
        const gz = Math.max(0, Math.min(reliefRes - 1.001, (z - origin) / step));
        const i0 = Math.floor(gx);
        const j0 = Math.floor(gz);
        const fx = gx - i0;
        const fz = gz - j0;
        const i1 = Math.min(reliefRes - 1, i0 + 1);
        const j1 = Math.min(reliefRes - 1, j0 + 1);
        const a = total[(j0 * reliefRes) + i0];
        const b = total[(j0 * reliefRes) + i1];
        const c = total[(j1 * reliefRes) + i0];
        const d = total[(j1 * reliefRes) + i1];
        return (((a * (1 - fx)) + (b * fx)) * (1 - fz)) + (((c * (1 - fx)) + (d * fx)) * fz);
    };
}

/**
 * MACRO TEXTURE — [macro height, detail weight, dMacro/dx, dMacro/dz] at 512².
 *
 * This bake exists to DELETE the analytic macro from the shaders. The massif smooth-max fold,
 * expressed in TSL and referenced through varyings, hit a three r181 builder pathology:
 * build TIME scaled with (fold size × fragment references) — measured at 129 s for the water
 * material and 27 s for the ground, ~156 s of frozen tab on every load, uncached, while the
 * emitted WGSL stayed ~6 KB. `.toVar()` inside the fold changed nothing (the builder walks
 * through Var and Varying nodes), so the durable fix is for the fold to not exist at build
 * time at all: the CPU already evaluates the same functions for the mirror, the macro is
 * smooth by construction (512² over 9,000 u = 17.6 u texels under bilinear), and the shader
 * cost is one fetch it was already paying next door. After this, the world compiles in ~1 s.
 */
export function bakeMacroData(res = 512) {
    const step = RELIEF_EXTENT / (res - 1);
    const origin = -RELIEF_EXTENT / 2;
    const e = 4;
    const data = new Uint16Array(res * res * 4);
    for (let j = 0; j < res; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < res; i += 1) {
            const x = origin + (i * step);
            const idx = ((j * res) + i) * 4;
            data[idx] = DataUtils.toHalfFloat(odysseyWorldMacro(x, z));
            data[idx + 1] = DataUtils.toHalfFloat(odysseyWorldDetailWeight(x, z));
            data[idx + 2] = DataUtils.toHalfFloat(
                (odysseyWorldMacro(x + e, z) - odysseyWorldMacro(x - e, z)) / (2 * e),
            );
            data[idx + 3] = DataUtils.toHalfFloat(
                (odysseyWorldMacro(x, z + e) - odysseyWorldMacro(x, z - e)) / (2 * e),
            );
        }
    }
    return { data, res };
}

/**
 * THE CLOUD SILHOUETTE FIELD (.a of the detail bake) — cloud plan Wave 1b.
 *
 * WHAT WAS WRONG. This channel used to be one octave of value noise (`vn(i, j, 1/96)`), and a
 * coverage threshold across value noise produces amoebae: soft, round-cornered, featureless
 * blobs with no top, no bottom and no edge. That is the entire reason Act II's sky reads as
 * salt-and-pepper static — no amount of shading can put a cloud shape into a field that has
 * none. The Ghibli/Witness distillation is explicit that the silhouette is where all the
 * frequency lives and the interior stays flat, so the fix belongs HERE, in the field, not in
 * the fragment shader.
 *
 * WHAT IT IS NOW. A union of discs at three scales — the cauliflower construction every
 * reference uses: 2-4 primary lobes that carry the read, secondaries riding on them, and
 * sparse tertiary scallops. `max()` of a domed falloff means the iso-contour of the union is
 * an arc-of-circles boundary, so ANY threshold through this field cuts a scalloped silhouette
 * by construction, at every coverage level. Sizes and spacing are irregular by mandate
 * (evenly-sized lobes read as soap bubbles). An inverted-ridge term fills the flanks between
 * lobes so they are not dead flat.
 *
 * TILING. The texture is 256^2 and repeats every ~488 world units at the deck's coarsest UV
 * scale, so stamped shapes WILL recur — the research critic flagged exactly this. Two defences:
 * distances wrap toroidally (no seam at the tile edge), and the deck samples this field at
 * three scales whose ratios are irrational-ish, so the recurrences of the three never line up.
 *
 * @param {number} res texture resolution
 * @param {(x:number,y:number,freq:number)=>number} vn the caller's tiling value-noise sampler
 * @returns {Float32Array} the silhouette field, histogram-matched (see bakeDetailNormal)
 */
/**
 * HISTOGRAM-MATCH the silhouette field so the shipped calibration survives the rebake.
 *
 * The deck's coverage thresholds (0.63 broken cumulus / 0.40 near-solid) and the vertex gate's
 * bands were placed against a MEASURED distribution of the summed density: p10 0.42, p50 0.58,
 * p90 0.70. Swap the field underneath them and those numbers stop meaning what the comments
 * say — coverage moves everywhere and every band needs re-tuning by eye, which is how a "look"
 * change quietly becomes a fortnight.
 *
 * So the new field is remapped by RANK onto a target marginal, and the target's spread is
 * SOLVED so that the quantity the thresholds actually see — the three-octave sum the fragment
 * stage computes — lands back on the measured percentiles. Rank-remapping is monotonic, so it
 * cannot disturb the silhouette geometry: it changes what the contour heights are called, never
 * where the contours are.
 *
 * The research critic's objection is the reason for the solve: matching ONE octave's marginals
 * does not bound the SUM's distribution. Matching the sum directly is the answer to it.
 *
 * ⚠️ RANK REMAPPING IS ONLY MONOTONIC IF TIES ARE HANDLED. This field is 64 % exact zeros and
 * the first version ranked them individually, which turned one input value into a texel-order
 * ramp across the tile — see `applyK`. A rank remap of a field with a large tied mass is a
 * trap; the same applies to any future bake that thresholds or gates its source.
 *
 * @param {Float32Array} field raw silhouette field (mutated in place)
 * @param {number} res texture resolution
 * @returns {{k:number, p10:number, p50:number, p90:number}} the solved stretch and the sum's
 *          achieved percentiles, for the assertion in the caller
 */
function matchCloudHistogram(field, res) {
    const n = res * res;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => field[a] - field[b]);
    // Target marginal: piecewise-linear through the three MEASURED percentiles, extended to
    // the tails. Expressed as an offset from the median so the stretch pivots on it.
    const targetQ = (u) => {
        if (u <= 0.10) return 0.386 + ((u / 0.10) * (0.42 - 0.386));
        if (u <= 0.50) return 0.42 + (((u - 0.10) / 0.40) * (0.58 - 0.42));
        if (u <= 0.90) return 0.58 + (((u - 0.50) / 0.40) * (0.70 - 0.58));
        return 0.70 + (((u - 0.90) / 0.10) * (0.73 - 0.70));
    };
    const matched = new Float32Array(n);
    // TIES MAP TO ONE VALUE — average-rank remapping, and it is load-bearing, not pedantry.
    // MEASURED 2026-08-13: 64.3 % of this field is EXACTLY zero (the sky between the disc
    // clusters, where the ridge term is gated off too). Giving each tied texel its own rank
    // `r` handed those 42,172 identical inputs 42,172 DIFFERENT outputs, spanning 0.256 to
    // 0.652 — and because `Array.prototype.sort` is stable, the order of the tie block is
    // texel order, so the field's own "empty sky" became a RAMP in row-major order that
    // stepped 0.394 at the wrap. The deck's whole anti-aliased alpha edge is 0.060 wide, so
    // that was a 6.6x razor line drawn across the sky every 488 world units, plus a coverage
    // gradient inside every tile that no threshold comment described. Averaging the rank over
    // each tied group keeps the map monotonic and makes it a function of the VALUE, which is
    // the only thing a histogram match is allowed to be a function of.
    const applyK = (k) => {
        let r = 0;
        while (r < n) {
            const value = field[order[r]];
            let end = r + 1;
            while (end < n && field[order[end]] === value) end += 1;
            const u = ((r + end) / 2) / n;
            const target = 0.58 + ((targetQ(u) - 0.58) * k);
            for (let t = r; t < end; t += 1) matched[order[t]] = target;
            r = end;
        }
    };
    // Bilinear, wrapping — the same filtering the GPU will do.
    const sample = (u, v) => {
        const x = ((((u * res) % res) + res) % res);
        const y = ((((v * res) % res) + res) % res);
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const x1 = (x0 + 1) % res;
        const y1 = (y0 + 1) % res;
        const a = matched[(y0 * res) + x0];
        const b = matched[(y0 * res) + x1];
        const c = matched[(y1 * res) + x0];
        const d = matched[(y1 * res) + x1];
        return (((a * (1 - fx)) + (b * fx)) * (1 - fy)) + (((c * (1 - fx)) + (d * fx)) * fy);
    };
    // The fragment stage's own octave scales and offsets (odyssey-world-renderer cloud deck).
    const sumAt = (wx, wz) => (sample(wx * 0.00205, wz * 0.00205) * 0.52)
        + (sample((wx * 0.00560) + 0.31, (wz * 0.00560) + 0.77) * 0.32)
        + (sample((wx * 0.01420) + 0.58, (wz * 0.01420) + 0.12) * 0.16);
    const SAMPLES = 8192;
    const pct = () => {
        const vals = new Float64Array(SAMPLES);
        let sd = 0x2545f491;
        const r = () => {
            sd = Math.imul(sd ^ (sd >>> 15), 2246822519);
            sd = (sd + 0x6d2b79f5) >>> 0;
            return ((sd ^ (sd >>> 13)) >>> 0) / 4294967296;
        };
        for (let i = 0; i < SAMPLES; i += 1) vals[i] = sumAt(r() * 24000, r() * 24000);
        vals.sort();
        return {
            p10: vals[Math.floor(SAMPLES * 0.10)],
            p50: vals[Math.floor(SAMPLES * 0.50)],
            p90: vals[Math.floor(SAMPLES * 0.90)],
        };
    };
    // Solve the stretch so the SUM's p90-p10 spread reproduces the measured 0.28. Averaging
    // three octaves narrows the distribution, so k > 1 is expected.
    let lo = 0.5;
    let hi = 6.0;
    let best = null;
    for (let it = 0; it < 22; it += 1) {
        const k = (lo + hi) / 2;
        applyK(k);
        best = pct();
        if ((best.p90 - best.p10) < 0.28) lo = k; else hi = k;
        best.k = k;
    }
    field.set(matched);
    return best;
}

function bakeCloudSilhouette(res, vn) {
    // Deterministic placement: the same sky every boot, and reproducible captures.
    let seed = 0x9e3779b9;
    const rnd = () => {
        seed = Math.imul(seed ^ (seed >>> 15), 2246822519);
        seed = (seed + 0x6d2b79f5) >>> 0;
        return ((seed ^ (seed >>> 13)) >>> 0) / 4294967296;
    };
    // DISCS ARE PLACED IN CLUSTERS, NOT SPREAD. The first cut scattered 77 discs uniformly
    // across the tile and the field came out above threshold almost everywhere: one connected
    // overcast mass rather than separate clouds (capture-confirmed — the sky filled in). A
    // cloud is a CLUSTER of lobes with sky around it, so each cluster gets its own 2-4
    // primaries, the secondaries ride those primaries' rims, and the tertiaries scallop the
    // crown. The gaps between clusters are the sky, and they only exist if the clusters are
    // placed sparsely on purpose.
    // NOTE this field is a PLAN view: the deck is a horizontal sheet, so what the viewer reads
    // as the cloud's outline is this field's contour seen from below or above. The Ghibli
    // "flat base" rule belongs to vertical faces and does not apply here; the scalloped
    // contour does, and that is exactly what a union of discs produces.
    const discs = [];
    const push = (x, y, r) => discs.push({ x: x * res, y: y * res, r: r * res });
    // SCALE, set against the owner's Witness reference. That sky is a FEW BIG clouds in
    // generous blue, and each one is big enough that you can count its lobes; the first cut
    // gave many small puffs — a mackerel sky, right grammar at the wrong size. So: 2 clusters
    // per tile instead of 3, primaries roughly doubled (0.070-0.115 -> 0.125-0.190 of the
    // tile), and the satellites scaled with them so the lobe HIERARCHY is preserved — a
    // cloud must still read as primaries carrying secondaries carrying scallops, just larger.
    // Cluster spreads grow with the lobes for the same reason.
    // In world terms at the coarsest octave (tile ~488 u) a primary lobe is now ~120-185 u
    // across rather than ~68-112, and there are fewer of them.
    const CLUSTERS = 2;
    for (let c = 0; c < CLUSTERS; c += 1) {
        const cx = rnd();
        const cy = rnd();
        const primaries = 2 + Math.floor(rnd() * 3); // 2-4 lobes carry the read
        for (let i = 0; i < primaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.26), cy + ((rnd() - 0.5) * 0.26), 0.125 + (rnd() * 0.065));
        }
        const secondaries = 5 + Math.floor(rnd() * 4);
        for (let i = 0; i < secondaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.40), cy + ((rnd() - 0.5) * 0.40), 0.058 + (rnd() * 0.048));
        }
        const tertiaries = 10 + Math.floor(rnd() * 7);
        for (let i = 0; i < tertiaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.50), cy + ((rnd() - 0.5) * 0.50), 0.024 + (rnd() * 0.026));
        }
    }
    const out = new Float32Array(res * res);
    const half = res / 2;
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            let m = 0;
            for (let d = 0; d < discs.length; d += 1) {
                const disc = discs[d];
                let dx = Math.abs(i - disc.x);
                if (dx > half) dx = res - dx;
                let dy = Math.abs(j - disc.y);
                if (dy > half) dy = res - dy;
                const dist = Math.sqrt((dx * dx) + (dy * dy));
                if (dist < disc.r) {
                    // sqrt dome: circular iso-contours, and a shoulder that stays fat near the
                    // rim so the union's boundary is an arc rather than a soft ramp.
                    const f = Math.sqrt(1 - (dist / disc.r));
                    if (f > m) m = f;
                }
            }
            // The ridge term is DETAIL ON the lobes, not a second cloud layer: gate it by the
            // disc field so it cannot raise the gaps between clusters back above threshold.
            const ridge = 1 - Math.abs((2 * vn(i, j, 1 / 26)) - 1);
            out[(j * res) + i] = (0.80 * m) + (0.20 * ridge * m);
        }
    }
    return out;
}

/**
 * The deck's silhouette field, baked and calibrated — the `.a` channel of the detail texture.
 *
 * EXPORTED FOR ITS UNIT GUARD (odyssey-cloud-field.test.js), because this field shipped two
 * defects that a screenshot could only show as "a straight line in the sky at ch5" and that
 * cost three bisect sessions between them: a value noise that did not tile, and a rank remap
 * that gave 42,172 tied texels 42,172 different values in texel order. Both are properties of
 * the FIELD, testable in milliseconds without a GPU, and neither was testable at all while
 * this lived inside `bakeDetailNormal` as two closures.
 *
 * @param {number} [res] texture resolution
 * @returns {{field: Float32Array, stats: {k:number,p10:number,p50:number,p90:number}}}
 */
export function bakeOdysseyCloudField(res = 256) {
    const field = bakeCloudSilhouette(res, createTilingValueNoise(res));
    const stats = matchCloudHistogram(field, res);
    return { field, stats };
}

export function bakeDetailNormalData(res = 256) {
    // THE NOISE MUST TILE, and until 2026-08-13 this one did not — see odyssey-tiling-noise.js
    // for the mechanism and the measured 48x seam step it put across the cloud silhouette.
    // EVERY channel of this texture is sampled with RepeatWrapping by something: .rg by the
    // ground's bump and the water's ripples, .b by the terrain's snow jitter and the deck's
    // vertex billow, .a by all three of the deck's density octaves. One non-tiling sampler
    // therefore drew a straight discontinuity across five surfaces at once.
    const vn = createTilingValueNoise(res);
    const field = new Float32Array(res * res);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            field[(j * res) + i] = (vn(i, j, 1 / 32) * 0.65) + (vn(i, j, 1 / 11) * 0.35);
        }
    }
    const at = (i, j) => field[((((j % res) + res) % res) * res) + (((i % res) + res) % res)];
    // RG are DERIVATIVES — signed, centred on zero — for the ground's bump term. BA carry the
    // scalar field itself at two frequencies, which the bake already computed and used to throw
    // away. The cloud deck needs a DENSITY, and reading it off the derivative channels gives a
    // field centred on zero that no coverage threshold can ever cross: the deck rendered
    // completely empty until this was widened. One texture, one fetch path, both uses served.
    // Rebake calibration guard: the sum the thresholds actually see must land back on the
    // measured p10/p50/p90 = 0.42/0.58/0.70, or 0.63/0.40 and the gate bands silently change
    // meaning. Logged rather than thrown — a sky that is a little off is a tuning note, not a
    // reason to refuse to boot — and asserted in odyssey-cloud-field.test.js.
    const { field: coarse, stats: cloudStats } = bakeOdysseyCloudField(res);
    const data = new Uint16Array(res * res * 4);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const idx = ((j * res) + i) * 4;
            data[idx] = DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) * 0.5);
            data[idx + 1] = DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) * 0.5);
            data[idx + 2] = DataUtils.toHalfFloat(field[(j * res) + i]);
            data[idx + 3] = DataUtils.toHalfFloat(coarse[(j * res) + i]);
        }
    }
    return { data, res, cloudStats };
}

// ── vegetation ───────────────────────────────────────────────────────────────────

/**
 * The five boot bakes in dependency order, as transferable arrays. This is what the worker runs
 * and what `createOdysseyWorld` consumes (`bakedTextures` option); the synchronous path calls
 * the same function on the main thread, so both paths are one code path.
 * @param {{reliefRes: number, shadowRes: number}} q quality resolutions
 * @returns {{relief: object, sunFields: object, atlas: object, detail: object, macro: object, ms: object}}
 */
export function bakeWorldTextureData({ reliefRes, shadowRes }) {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const relief = bakeReliefData(reliefRes);
    const t1 = now();
    const sunFields = bakeGroundSunFieldsData(makeReliefSampler(relief), shadowRes);
    const t2 = now();
    const atlas = bakeGroundAtlasData();
    const t3 = now();
    const detail = bakeDetailNormalData();
    const t4 = now();
    const macro = bakeMacroData();
    const t5 = now();
    return {
        relief,
        sunFields,
        atlas,
        detail,
        macro,
        ms: {
            relief: +(t1 - t0).toFixed(1),
            sunFields: +(t2 - t1).toFixed(1),
            atlas: +(t3 - t2).toFixed(1),
            detail: +(t4 - t3).toFixed(1),
            macro: +(t5 - t4).toFixed(1),
            total: +(t5 - t0).toFixed(1),
        },
    };
}

/** The ArrayBuffers of a bake result, for a postMessage transfer list. */
export function worldTextureDataBuffers(baked) {
    return [
        baked.relief.data.buffer, baked.relief.total.buffer,
        baked.sunFields.data.buffer,
        baked.atlas.data.buffer, ...baked.atlas.fields.map((f) => f.buffer),
        baked.detail.data.buffer,
        baked.macro.data.buffer,
    ];
}
