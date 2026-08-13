import * as THREE from 'three/webgpu';
import {
    Fn, If,
    abs, attribute, clamp, cos, cross, dFdx, dFdy, dot, exp, exp2, float, floor, fract, length,
    max, min, mix,
    normalize, normalWorld, positionGeometry, positionLocal, positionWorld, sin, smoothstep,
    step as tslStep, texture, uniform, uv, varying, vec2, vec3, cameraPosition,
} from 'three/tsl';

import {
    ODYSSEY_SEA_LEVEL,
    odysseyWorldDetailWeight,
    odysseyWorldMacro,
    odysseyWorldRelief,
} from './odyssey-world-height.js';
import { MORPH_END, MORPH_START, buildOdysseyClipmap } from './odyssey-clipmap.js';
import { snoise3 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import {
    billboardWorld, makeQuadInstancedGeometry,
} from '../chapter-environments/shared/odyssey-tsl-billboard.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import {
    sampleColourScript,
    ODYSSEY_COLOUR_SCRIPT,
    ODYSSEY_WATER_RAMP,
} from '../odyssey-colour-script.js';

/**
 * THE ODYSSEY ACT II WORLD.
 *
 * One continuous surface for chapters 2–5 — ocean floor, sea, shore, forest, alpine, summit —
 * replacing the seven independent ground surfaces the shipped build spreads across four
 * chapter environments. See docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md.
 *
 * Everything here is generated at load: no meshes, no textures, no imported assets. Returns a
 * single Group plus an update() that takes the rail position — the caller owns nothing else.
 *
 * WHAT IS LOAD-BEARING, all of it paid for in measurement:
 *  - `texture(...).level(0)` is MANDATORY in a positionNode. WGSL forbids textureSample in the
 *    vertex stage and r181 injects a level only for EnvironmentNode/Background.
 *  - The analytic macro belongs in the VERTEX stage. Finite-differencing it per fragment cost
 *    7.5 ms of an 11.6 ms frame.
 *  - Detail comes from a TILED TEXTURE, not procedural noise: ~1 ALU against ~100, worth 6.5 ms.
 *  - Sun shadows are BAKED. One sun plus a rail makes self-shadowing static, which deletes the
 *    entire shadow-cascade budget line for one texture fetch.
 *  - Trees are CHUNKED. Their cost is vertex, not fill: collapsing distant instances to
 *    degenerate triangles changed nothing; giving three real bounds to cull against halved it.
 *  - A positionNode REPLACES the instance transform, so it must be built from `positionLocal`,
 *    while a local-space mask must read `positionGeometry`.
 */

// Imported, not owned: the canonical value now lives in chapter-profile.js so chapters can read
// the journey's sun without importing the whole world renderer. Re-exported under the same name
// because the world's own modules and tests already reference it from here.
export { ODYSSEY_WORLD_SUN };

export const ODYSSEY_WORLD_QUALITY = Object.freeze({
    high: {
        gridN: 128,
        levels: 9,
        baseSpacing: 1.6,
        holeShrink: 3,
        reliefRes: 1024,
        shadowRes: 512,
        treeSpacing: 15,
        detailScales: 2,
        cavity: 0.30,
        ridgeRock: 0.16,
    },
    low: {
        gridN: 96,
        levels: 8,
        baseSpacing: 2.2,
        holeShrink: 2,
        reliefRes: 768,
        shadowRes: 384,
        treeSpacing: 24,
        detailScales: 1,
        cavity: 0.24,
        ridgeRock: 0.12,
    },
});

const RELIEF_EXTENT = 9000;
/**
 * Altitude of the one cloud deck, in world units. Chosen against the RAIL, not against a
 * chapter: the path leaves the shore at ~300, crosses 424 entering the ascent, tops Ch5's
 * climb at 656 and reaches the summit crown near 1017. A deck at 660 is therefore far
 * overhead from the valley, at eye height through the climb, and comfortably below the
 * summit — the three readings Ch3, Ch5 and Ch4 used to build separately.
 */
const CLOUD_DECK_Y = 660;

// The two fixed ends of the water banding, read ONCE from the colour script so the plates
// and the keyframes can never drift. Sampling the script for them per frame would be three
// more Oklab walks for values that do not change.
const SHALLOWS_BODY = sampleColourScript(0.12).skyHorizon;
const ABYSS_BODY = sampleColourScript(0.0).skyHorizon;
// Where the script stops being water: the last keyframe whose medium is 'water' (today the
// 'shallows' at 0.12 — computed, not asserted, so a script edit moves it). The MID water
// plate tracks the live sample, and past this point the script's horizon is the breach's
// pale AIR sky; with uSubmerged driven by the real eye, the p 0.18→0.20 ascent renders as
// water, and an unclamped plate would paint that air INTO the water column.
const WATER_SCRIPT_END = ODYSSEY_COLOUR_SCRIPT
    .filter((k) => k.medium === 'water')
    .reduce((last, k) => Math.max(last, k.p), 0);

// ── bakes ────────────────────────────────────────────────────────────────────────

function buildReliefBake(reliefRes) {
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
            data[idx] = THREE.DataUtils.toHalfFloat(relief[(j * reliefRes) + i]);
            data[idx + 1] = THREE.DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) / (2 * step));
            data[idx + 2] = THREE.DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) / (2 * step));
            const neighbourMean = (at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1)) / 4;
            data[idx + 3] = THREE.DataUtils.toHalfFloat(
                (neighbourMean - relief[(j * reliefRes) + i]) / step,
            );
        }
    }
    // Half-float is filterable everywhere with no feature request; float32-filterable is
    // optional in WebGPU and r181's fallback covers only DataTexture, not render targets.
    const tex = new THREE.DataTexture(data, reliefRes, reliefRes, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

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
    const sample = (x, z) => {
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
    return { tex, sample };
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
function bakeMacroTexture(res = 512) {
    const step = RELIEF_EXTENT / (res - 1);
    const origin = -RELIEF_EXTENT / 2;
    const e = 4;
    const data = new Uint16Array(res * res * 4);
    for (let j = 0; j < res; j += 1) {
        const z = origin + (j * step);
        for (let i = 0; i < res; i += 1) {
            const x = origin + (i * step);
            const idx = ((j * res) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat(odysseyWorldMacro(x, z));
            data[idx + 1] = THREE.DataUtils.toHalfFloat(odysseyWorldDetailWeight(x, z));
            data[idx + 2] = THREE.DataUtils.toHalfFloat(
                (odysseyWorldMacro(x + e, z) - odysseyWorldMacro(x - e, z)) / (2 * e),
            );
            data[idx + 3] = THREE.DataUtils.toHalfFloat(
                (odysseyWorldMacro(x, z + e) - odysseyWorldMacro(x, z - e)) / (2 * e),
            );
        }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

function bakeSunVisibility(heightAt, shadowRes) {
    const len = Math.hypot(...ODYSSEY_WORLD_SUN);
    const [sx, sy, sz] = ODYSSEY_WORLD_SUN.map((v) => v / len);
    const horiz = Math.hypot(sx, sz) || 1e-4;
    const dirX = sx / horiz;
    const dirZ = sz / horiz;
    const rise = sy / horiz;
    const step = RELIEF_EXTENT / shadowRes;
    const origin = -RELIEF_EXTENT / 2;

    const raw = new Float32Array(shadowRes * shadowRes);
    for (let j = 0; j < shadowRes; j += 1) {
        const z0 = origin + (j * step);
        for (let i = 0; i < shadowRes; i += 1) {
            const x0 = origin + (i * step);
            const h0 = heightAt(x0, z0);
            let shadow = 0;
            let t = step * 1.5;
            for (let k = 0; k < 42; k += 1) {
                const terrain = heightAt(x0 + (dirX * t), z0 + (dirZ * t));
                const ray = h0 + (rise * t);
                if (terrain > ray) {
                    shadow = Math.max(shadow, Math.min(1, ((terrain - ray) / (1 + (t * 0.05))) * 0.5));
                    if (shadow >= 1) break;
                }
                t *= 1.115;
            }
            raw[(j * shadowRes) + i] = 1 - shadow;
        }
    }
    const at = (i, j) => raw[(Math.max(0, Math.min(shadowRes - 1, j)) * shadowRes)
        + Math.max(0, Math.min(shadowRes - 1, i))];
    const data = new Uint16Array(shadowRes * shadowRes);
    for (let j = 0; j < shadowRes; j += 1) {
        for (let i = 0; i < shadowRes; i += 1) {
            let sum = 0;
            for (let dj = -1; dj <= 1; dj += 1) {
                for (let di = -1; di <= 1; di += 1) sum += at(i + di, j + dj);
            }
            data[(j * shadowRes) + i] = THREE.DataUtils.toHalfFloat(sum / 9);
        }
    }
    const tex = new THREE.DataTexture(data, shadowRes, shadowRes, THREE.RedFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
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
    const applyK = (k) => {
        for (let r = 0; r < n; r += 1) {
            const u = (r + 0.5) / n;
            matched[order[r]] = 0.58 + ((targetQ(u) - 0.58) * k);
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
    const CLUSTERS = 3;
    for (let c = 0; c < CLUSTERS; c += 1) {
        const cx = rnd();
        const cy = rnd();
        const primaries = 2 + Math.floor(rnd() * 3); // 2-4 lobes carry the read
        for (let i = 0; i < primaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.16), cy + ((rnd() - 0.5) * 0.16), 0.070 + (rnd() * 0.045));
        }
        const secondaries = 4 + Math.floor(rnd() * 4);
        for (let i = 0; i < secondaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.24), cy + ((rnd() - 0.5) * 0.24), 0.032 + (rnd() * 0.030));
        }
        const tertiaries = 8 + Math.floor(rnd() * 6);
        for (let i = 0; i < tertiaries; i += 1) {
            push(cx + ((rnd() - 0.5) * 0.30), cy + ((rnd() - 0.5) * 0.30), 0.013 + (rnd() * 0.016));
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

function bakeDetailNormal(res = 256) {
    const h = (ix, iy) => {
        const wx = ((ix % res) + res) % res;
        const wy = ((iy % res) + res) % res;
        let v = (wx * 374761393) + (wy * 668265263);
        v = Math.imul(v ^ (v >>> 13), 1274126177);
        return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
    };
    const vn = (x, y, freq) => {
        const fx = x * freq;
        const fy = y * freq;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const ux = tx * tx * (3 - (2 * tx));
        const uy = ty * ty * (3 - (2 * ty));
        const a = h(ix, iy);
        const b = h(ix + 1, iy);
        const c = h(ix, iy + 1);
        const d = h(ix + 1, iy + 1);
        return (((a * (1 - ux)) + (b * ux)) * (1 - uy)) + ((((c * (1 - ux)) + (d * ux)) * uy));
    };
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
    const coarse = bakeCloudSilhouette(res, vn);
    // Rebake calibration guard: the sum the thresholds actually see must land back on the
    // measured p10/p50/p90 = 0.42/0.58/0.70, or 0.63/0.40 and the gate bands silently change
    // meaning. Logged rather than thrown — a sky that is a little off is a tuning note, not a
    // reason to refuse to boot — and asserted in odyssey-world-lints.test.js.
    const cloudStats = matchCloudHistogram(coarse, res);
    // eslint-disable-next-line no-console
    console.log('[world] cloud silhouette histogram', JSON.stringify({
        k: Number(cloudStats.k.toFixed(3)),
        p10: Number(cloudStats.p10.toFixed(4)),
        p50: Number(cloudStats.p50.toFixed(4)),
        p90: Number(cloudStats.p90.toFixed(4)),
    }));
    const data = new Uint16Array(res * res * 4);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const idx = ((j * res) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat((at(i + 1, j) - at(i - 1, j)) * 0.5);
            data[idx + 1] = THREE.DataUtils.toHalfFloat((at(i, j + 1) - at(i, j - 1)) * 0.5);
            data[idx + 2] = THREE.DataUtils.toHalfFloat(field[(j * res) + i]);
            data[idx + 3] = THREE.DataUtils.toHalfFloat(coarse[(j * res) + i]);
        }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

// ── vegetation ───────────────────────────────────────────────────────────────────

function buildTreeGeometry() {
    const positions = [];
    const normals = [];
    const shade = [];
    const SIDES = 6;
    const trunkH = 0.9;
    const trunkR = 0.10;
    for (let i = 0; i < SIDES; i += 1) {
        const a0 = (i / SIDES) * Math.PI * 2;
        const a1 = ((i + 1) / SIDES) * Math.PI * 2;
        const nx = Math.cos((a0 + a1) / 2);
        const nz = Math.sin((a0 + a1) / 2);
        const p0 = [Math.cos(a0) * trunkR, Math.sin(a0) * trunkR];
        const p1 = [Math.cos(a1) * trunkR, Math.sin(a1) * trunkR];
        [[p0[0], 0, p0[1], 0], [p1[0], 0, p1[1], 0], [p1[0], trunkH, p1[1], 0.2],
            [p0[0], 0, p0[1], 0], [p1[0], trunkH, p1[1], 0.2], [p0[0], trunkH, p0[1], 0.2]]
            .forEach(([x, y, z, sv]) => {
                positions.push(x, y, z);
                normals.push(nx, 0.1, nz);
                shade.push(sv);
            });
    }
    for (let t = 0; t < 3; t += 1) {
        const f = t / 3;
        const base = trunkH + (f * 2.5);
        const top = base + 1.55 - (f * 0.25);
        const radius = 1.0 - (f * 0.27);
        for (let i = 0; i < SIDES; i += 1) {
            const a0 = (i / SIDES) * Math.PI * 2;
            const a1 = ((i + 1) / SIDES) * Math.PI * 2;
            const nx = Math.cos((a0 + a1) / 2);
            const nz = Math.sin((a0 + a1) / 2);
            positions.push(Math.cos(a0) * radius, base, Math.sin(a0) * radius);
            positions.push(Math.cos(a1) * radius, base, Math.sin(a1) * radius);
            positions.push(0, top, 0);
            for (let k = 0; k < 3; k += 1) normals.push(nx, 0.45, nz);
            shade.push(0.15, 0.15, 1.0);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    return geo;
}

/**
 * Scatter on the CPU HEIGHT MIRROR — the same surface the vertex shader displaces to, so a
 * floating or buried tree is structurally impossible. (The shipped Ch4 belt is planted at a
 * constant Y with no heightfield sample at all: mean -4.5u, 37.7% of cells burying a tree by
 * more than 8u.) Jittered grid rather than pure random, which clumps and leaves holes at
 * exactly the scale the eye reads as a mistake.
 */
export function scatterTrees(heightAt, {
    cx, cz, radius, spacing, seaLevel, snowStart,
}) {
    const out = [];
    const rnd = (i, j, salt) => {
        let h = ((i | 0) * 374761393) + ((j | 0) * 668265263) + (salt * 2654435761);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const steps = Math.ceil((radius * 2) / spacing);
    for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < steps; i += 1) {
            const x = (cx - radius) + (i * spacing) + ((rnd(i, j, 1) - 0.5) * spacing * 0.95);
            const z = (cz - radius) + (j * spacing) + ((rnd(i, j, 2) - 0.5) * spacing * 0.95);
            if (Math.hypot(x - cx, z - cz) > radius) continue;
            const y = heightAt(x, z);
            if (y < seaLevel + 3 || y > snowStart) continue;
            const e = 4;
            const slope = Math.hypot(
                (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
                (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e),
            );
            if (slope > 0.62) continue;
            const mask = rnd(Math.floor(x / 140), Math.floor(z / 140), 3);
            const falloff = 1 - Math.max(0, (y - (snowStart - 130)) / 130);
            if (rnd(i, j, 4) > (0.35 + (mask * 0.95)) * Math.max(0.12, falloff)) continue;
            out.push({
                x,
                y,
                z,
                scale: 3.2 + (rnd(i, j, 5) * 3.4),
                rot: rnd(i, j, 6) * Math.PI * 2,
                tint: rnd(i, j, 7),
            });
        }
    }
    return out;
}

// ── the world ────────────────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {string} [opts.quality] 'high' | 'low'
 * @param {Array<{x:number,y:number,z:number}>} [opts.railSamples] points along the journey
 *   rail, sampled by the CALLER (the world deliberately does not know the path). Used to seat
 *   the underwater god-ray shafts along the submerged stretch; empty means no shafts.
 * @param {boolean} [opts.clouds] BISECT LEVER, default true. When false the cloud deck's mesh
 *   never enters the scene, so its pipeline is never compiled — the material and geometry are
 *   still constructed (that part is proven safe headless). Exists because every IN-GAME One
 *   World boot after the deck landed stalls before readiness while the playground renders the
 *   same deck perfectly; this isolates "is it the deck's in-game compile" to one URL flag
 *   instead of one source edit per experiment.
 * @param {boolean} [opts.applyExposure] whether the WORLD applies the colour script's
 *   exposure. True standalone (the playground has no post stack). FALSE inside the game,
 *   where odyssey-tsl-pipeline.js owns exposure and applies ACES after it — otherwise
 *   exposure is applied twice.
 * @param {number} [opts.outputSaturation] pulls the world's output toward its own luma before
 *   it reaches a post stack that adds saturation of its own. The Odyssey grade lifts master
 *   saturation 1.15x and chapter saturation a further ~1.10x on top of a black crush, which
 *   drove the sky's already-low red channel to a clamped ZERO. The world therefore has to hand
 *   that stack a FLATTER image than the one it wants on screen; 1.0 (the playground) is the
 *   image as authored.
 * @param {number} [opts.outputScale] scales the world's HDR output before it reaches a post
 *   stack. The palette is authored display-referred, which is right for a flat playground but
 *   far too hot for a pipeline that then adds bloom and an ACES curve: measured in-game, sky
 *   came out at luma 200 against 129 standalone and the massif washed to pale haze. Scene-
 *   linear output is what a tonemapper needs room to work with.
 * @param {boolean} [opts.water] build the sea plate at all. A MEASUREMENT LEVER, not a player
 *   setting (board flag `?odysseyWorldNoWater=1`, gpu-split configuration `no-water`): the
 *   water surface is one ungated DoubleSide transparent clipmap that draws across the whole
 *   act window, and until 2026-08-13 nothing in the tree could turn it off — so its total cost
 *   had never been measured and no water work could be honestly funded. Skipping the BUILD
 *   (not just the draw) also prices its pipeline out of the cold-compile path. Same
 *   measurement-lever pattern as earth-core's ?earthCoreNoLake/NoHaze bisects.
 */
export function createOdysseyWorld({
    quality = 'high', applyExposure = true, outputScale = 1, outputSaturation = 1, clouds = true,
    water = true,
    skyRadius = null, railSamples = [],
} = {}) {
    const q = ODYSSEY_WORLD_QUALITY[quality] || ODYSSEY_WORLD_QUALITY.high;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);

    const relief = buildReliefBake(q.reliefRes);
    const sunVisTex = bakeSunVisibility(relief.sample, q.shadowRes);
    const detailTex = bakeDetailNormal();
    const macroTex = bakeMacroTexture();
    const heightTex = relief.tex;
    const t1 = (typeof performance !== 'undefined' ? performance.now() : 0);

    const group = new THREE.Group();
    group.name = 'odyssey-act2-world';

    const ground = buildOdysseyClipmap({
        gridN: q.gridN, levels: q.levels, baseSpacing: q.baseSpacing, holeShrink: q.holeShrink,
    });
    const waterSpacing = (q.baseSpacing * q.gridN) / 32;
    // `waterGeo`, not `water` — the option of that name is the build gate (matches cloudGeo).
    const waterGeo = buildOdysseyClipmap({
        gridN: 32, levels: q.levels, baseSpacing: waterSpacing, holeShrink: 1,
    });
    // The cloud deck rides the same coarse lattice as the water: it is a smooth surface with
    // no small-scale geometry, so its detail belongs in the density field, not in triangles.
    const cloudSpacing = waterSpacing * 1.6;
    const cloudGeo = buildOdysseyClipmap({
        gridN: 32, levels: q.levels, baseSpacing: cloudSpacing, holeShrink: 1,
    });
    const cloudReach = cloudGeo.reach;

    const uLodCenter = uniform(new THREE.Vector2(0, 0));
    const uTime = uniform(0);
    const uSunDir = uniform(new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize());
    const uSkyHorizon = uniform(new THREE.Color(0.72, 0.82, 0.93));
    const uSkyZenith = uniform(new THREE.Color(0.19, 0.40, 0.76));
    const uSunColour = uniform(new THREE.Color(1, 0.95, 0.86));
    const uShadowTint = uniform(new THREE.Color(0.44, 0.58, 0.82));
    const uAerialK = uniform(0.00016);
    // How hard the baked curvature reads. Two separate gains because they answer different
    // questions: cavity is "how deep does this gully feel", ridgeRock is "has the weather
    // stripped this crest back to stone".
    const uCavity = uniform(q.cavity);
    const uRidgeRock = uniform(q.ridgeRock);
    const uExposure = uniform(1);
    const uOutputScale = uniform(outputScale);
    const uOutputSat = uniform(outputSaturation);
    const uSubmerged = uniform(0);
    // How deep the EYE is (0 at the surface, 1 by ~140 u down) — set from the same eye height
    // that drives uSubmerged. The convergence colour at infinity depends on it: at depth,
    // long rays converge on the abyss plate, but 30 u under the surface they converge on the
    // MID plate — capture-measured at p=0.185, a fixed deep-plate convergence rendered the
    // near-surface ascent as abyss-dark water.
    const uEyeDepth = uniform(1);
    // 1 while the eye is AT the surface (within ~3 u), 0 elsewhere — the meniscus window.
    const uBreachNear = uniform(0);
    // THE CLOUD REGIME GATE (cloud plan Wave 2, exit-gate response). 1 when the eye is high
    // enough that any part of the deck can show its sunlit TOP, 0 when it cannot. The CPU
    // knows this exactly, so the GPU should not pay to discover it per fragment — see the
    // If-branch on it in the deck's colour graph.
    const uCloudTopLit = uniform(0);
    // The three water plates. Driven from the colour script's water keyframes so the ocean's
    // depth banding and the journey's palette can never drift apart (they are the same data).
    const uWaterShallow = uniform(new THREE.Color(0.29, 0.54, 0.69));
    const uWaterMid = uniform(new THREE.Color(0.10, 0.29, 0.42));
    const uWaterDeep = uniform(new THREE.Color(0.020, 0.105, 0.165));
    /** The dawn-gold kiss the crest SSS transmits — kept OUT of the air palette on purpose. */
    const uWaterGlow = uniform(new THREE.Color(0.88, 0.75, 0.50));

    const skyColourFor = (dirY) => mix(uSkyHorizon, uSkyZenith, clamp(dirY.mul(1.55).add(0.26), 0, 1));
    const applyAerial = (lit, wp) => {
        const to = wp.sub(cameraPosition);
        const d = length(to);
        const dirY = to.div(max(d, float(0.001))).y;
        const air = mix(lit, skyColourFor(dirY), clamp(float(1).sub(exp(d.mul(uAerialK.negate()))), 0, 0.82));
        // PER-CHANNEL BEER-LAMBERT, so red dies first and distance reads as WATER rather than
        // as blue fog: one scalar became a vec3 whose red extinguishes ~3.5x faster than blue,
        // the one cue that separates "underwater" from "tinted air". The old 0.97 clamp is gone
        // with it — it pinned everything past ~470 u to 97% of one target, which is why
        // removing the steam veil exposed a frame with 97.5% of its pixels in ONE luma band.
        // 0.995 keeps a floor of the fragment's own colour so the far field converges without
        // ever fully degenerating to the plate.
        const wRGB = clamp(float(1).sub(exp(d.mul(vec3(-0.0160, -0.0082, -0.0046)))), 0, 0.995);
        // The up-lift is a DOWNWELLING cone (pow-concentrated overhead), and grazing rays
        // converge to the DEEP plate: from 100+ u down the whole up-hemisphere is the water
        // plane's underside, whose fragments all sit AT the surface (depthBelow = 0), so
        // without a directional term every up-ray converged to the same shallow plate —
        // capture-measured at p=0.130 as 90% of the frame's pixels in ONE luma band. A
        // grazing ray is a long horizontal water column and must darken like one.
        const surfaceGlow = clamp(dirY, 0, 1).pow(2.2).mul(0.5);
        const grazing = float(1).sub(abs(dirY)).pow(3);
        // BANDED DEPTH, not one exponential (plan §3.4.1 — Ponyo's stacked plates). Depth is
        // shown as discrete hue steps within one temperature family, which is how every
        // adopted reference does it and why none of them need grey scattering. The band index
        // comes from the fragment's own depth below the surface, so the column brightens
        // TOWARD the light instead of away from it — Phase 0 measured the shipped gradient
        // reading darker near the surface than at mid-depth.
        const depthBelow = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(160), 0, 1);
        const bandShallow = mix(uWaterShallow, uWaterMid, smoothstep(float(0.10), float(0.42), depthBelow));
        const banded = mix(bandShallow, uWaterDeep, smoothstep(float(0.45), float(0.92), depthBelow));
        const convergePlate = mix(uWaterMid, uWaterDeep, uEyeDepth);
        const bandedDir = mix(banded, convergePlate, grazing);
        const waterTarget = mix(bandedDir, skyColourFor(float(0.5)).mul(0.45), surfaceGlow);
        // Component-wise mix against the same target: the hue WALKS with distance (red gone
        // first, blue last) instead of every channel arriving together. This is what puts
        // value structure back into the frame the steam veil used to supply.
        const litUnder = lit.mul(vec3(0.42, 0.86, 1.0));
        const submergedCol = mix(litUnder, waterTarget, wRGB);
        return mix(air, submergedCol, uSubmerged);
    };

    const clipmapXZ = (spacing0, halfN) => {
        const aGrid = attribute('position', 'vec3');
        const spacing = float(spacing0).mul(exp2(aGrid.y));
        const origin = floor(uLodCenter.div(spacing.mul(2))).mul(spacing.mul(2));
        const gridXZ = vec2(aGrid.x, aGrid.z);
        const local = gridXZ.mul(spacing);
        const cheb = max(abs(local.x), abs(local.y)).div(spacing.mul(float(halfN)));
        const morph = clamp(cheb.sub(float(MORPH_START)).div(float(MORPH_END - MORPH_START)), 0, 1);
        const coarse = floor(gridXZ.mul(0.5)).mul(2).mul(spacing);
        return {
            // .toVar() is LOAD-BEARING throughout this file, not style. r181's node builder
            // re-walks a shared subexpression once PER REFERENCE during analysis; expressions
            // with high fan-out (this worldXZ feeds the macro, the weight, the UVs and the
            // swell) therefore make build TIME grow multiplicatively even while the emitted
            // WGSL stays tiny. Measured before/after on the water material: 129 s -> see
            // plan §Wave 2 addendum. A .toVar() materializes the value once and turns every
            // downstream reference into a leaf.
            worldXZ: origin.add(mix(local, coarse, morph)).toVar(),
            spacing: spacing.mul(morph.add(1)).toVar(),
        };
    };

    // (The analytic tslMacro/tslWeight fold lived here. It is BAKED now — bakeMacroTexture —
    // because expressing it in TSL froze every first compile for minutes. Do not resurrect it.)

    // ── ground ──
    const g = clipmapXZ(q.baseSpacing, q.gridN / 2);
    const reliefUv = g.worldXZ.div(float(RELIEF_EXTENT)).add(0.5);
    const vUv = varying(reliefUv, 'vUv');
    // Macro terrain comes from the BAKE, not from analytic TSL — see bakeMacroTexture. The
    // analytic fold in a shader graph froze the tab for minutes at build time.
    const gMacroTex = texture(macroTex, reliefUv).level(0);
    const gMacro = gMacroTex.r;
    const gWeight = gMacroTex.g;
    const groundMat = new THREE.MeshBasicNodeMaterial();
    groundMat.positionNode = vec3(
        g.worldXZ.x,
        gMacro.add(texture(heightTex, reliefUv).level(0).r.mul(gWeight)),
        g.worldXZ.y,
    );
    const vWeight = varying(gWeight, 'vW');
    const vSpacing = varying(g.spacing, 'vS');
    const vMDx = varying(gMacroTex.b, 'vMDx');
    const vMDz = varying(gMacroTex.a, 'vMDz');

    const aux = texture(heightTex, vUv);
    const baseNormal = normalize(vec3(aux.g.mul(vWeight).add(vMDx).negate(), 1, aux.b.mul(vWeight).add(vMDz).negate()));
    const footprint = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)));
    const detailScales = [{ world: 26, amp: 0.34 }, { world: 7.5, amp: 0.20 }]
        .slice(0, q.detailScales);
    let bump = vec2(0, 0);
    detailScales.forEach(({ world: wl, amp }) => {
        const gate = float(1).sub(smoothstep(float(wl / 6), float(wl / 1.5), footprint));
        bump = bump.add(texture(detailTex, positionWorld.xz.div(wl)).rg.mul(amp).mul(gate));
    });
    // Curvature, on the same weight ramp as the relief it was baked from, so it fades out
    // with the detail rather than surviving as shading over a lattice too coarse to show it.
    const curvature = clamp(aux.a.mul(vWeight).mul(9.0), -1, 1);
    const gully = max(curvature, 0);
    const crest = max(curvature.negate(), 0);
    const flatness = clamp(baseNormal.y, 0, 1);
    const normal = normalize(baseNormal.add(vec3(bump.x, 0, bump.y).mul(flatness.mul(0.42))));

    const height = positionWorld.y;
    // Biome follows the LANDFORM; only lighting sees the grain. Driving both from the detailed
    // normal makes grass and rock track the surface noise, which reads as camouflage blotching.
    const slope = clamp(float(1).sub(baseNormal.y), 0, 1);
    const detailGate = float(1).sub(smoothstep(float(1.2), float(9), footprint))
        .mul(float(1).sub(smoothstep(float(2), float(6), vSpacing)));

    const wSand = float(1).sub(smoothstep(float(ODYSSEY_SEA_LEVEL - 2), float(ODYSSEY_SEA_LEVEL + 26), height));
    // ALPINE SURFACE LANGUAGE (Ch4 port). The peaks survive suppression as terms in the
    // height field, so the camera stares at them for all of Ch4 — but a generic biome ramp
    // gives them a CLEAN HORIZONTAL snow band, which reads as a contour line on a map rather
    // than a mountain. mountain-language.js broke that band with FBM jitter and gated snow by
    // slope; both port directly here, the jitter riding a low-frequency read of the detail
    // texture (one fetch) instead of procedural noise. The band is also tightened 620..790 ->
    // 620..730 now that the jitter, not the ramp width, is what softens the boundary.
    const snowJitter = texture(detailTex, positionWorld.xz.mul(0.0016)).b.sub(0.5).mul(92);
    const snowHeight = height.add(snowJitter).toVar();
    const wSnow = smoothstep(float(620), float(730), snowHeight)
        .mul(float(1).sub(smoothstep(float(0.42), float(0.70), slope)));
    const wRock = clamp(max(
        smoothstep(float(0.17), float(0.40), slope),
        smoothstep(float(470), float(640), snowHeight).mul(0.75),
    ).add(crest.mul(uRidgeRock).mul(detailGate)), 0, 1);
    let albedo = vec3(0.30, 0.44, 0.22);
    albedo = mix(albedo, vec3(0.70, 0.64, 0.47), wSand);
    albedo = mix(albedo, vec3(0.36, 0.34, 0.33), wRock);
    albedo = mix(albedo, vec3(0.92, 0.95, 1.0), wSnow);
    const grain = positionWorld.xz.mul(0.036);
    albedo = albedo.mul(grain.x.sin().mul(grain.y.cos()).mul(0.5).add(0.5)
        .mul(0.07)
        .mul(detailGate)
        .add(0.985));

    // CAUSTICS on the submerged shelf — ported from Ch2 (deep-ocean.tsl.js
    // causticProjection): two counter-scrolling gradient noises sharpened to bright
    // veins. World-space UVs, so the port is the term itself, unchanged. Gated to below
    // the waterline and faded in over the first few metres of depth. A small, LOW-FAN-OUT
    // graph — the codegen lesson applies: keep it a leaf term, .toVar() the result.
    const causticUv = positionWorld.xz.mul(0.055);
    // WAVE 4: min(), not add() — summed noises regress toward mid and pow() them into soft
    // BLOBS; the MINIMUM of two counter-scrolling fields is bright only where BOTH are
    // bright, which draws the sharp intersecting veins a caustic web actually has. And the
    // web lands only on UP-FACES: projected surface light cannot paint a cliff wall or the
    // underside of a ledge, which is where the old term striped.
    const causticN1 = snoise3(vec3(causticUv.x, causticUv.y, uTime.mul(0.2)))
        .mul(0.5).add(0.5);
    const causticN2 = snoise3(vec3(causticUv.x.mul(1.4), causticUv.y.mul(1.4), uTime.mul(-0.15)))
        .mul(0.5).add(0.5);
    // smoothstep remap, not pow: min() of two fields peaks near ~0.8, so a bare pow buried
    // the web (the first min() capture showed a FLAT shelf). The remap keeps ~20% coverage
    // of crisp full-brightness veins.
    const caustic = smoothstep(float(ODYSSEY_SEA_LEVEL), float(ODYSSEY_SEA_LEVEL - 7), height)
        .mul(smoothstep(float(0.55), float(0.85), min(causticN1, causticN2)))
        .mul(clamp(normal.y, 0, 1))
        .toVar();

    const sunVis = texture(sunVisTex, vUv).r;
    const ndl = max(dot(normal, uSunDir), 0);
    // Cavity occlusion: sunVis already knows what the massifs shadow, but it is baked at a
    // resolution that cannot see a gully. This is the small-scale half of the same term.
    const cavity = clamp(float(1).sub(gully.mul(uCavity).mul(detailGate)), 0.62, 1.0);
    const lit = albedo.mul(uSunColour.mul(ndl.mul(sunVis).mul(0.92).add(0.06))
        .add(uShadowTint.mul(0.36))).mul(cavity)
        .add(vec3(0.55, 0.85, 0.90).mul(caustic).mul(sunVis.mul(0.7).add(0.3)).mul(0.5))
        // ALPENGLOW: high snow that faces the sun takes a warm kiss. In mountain-language it
        // is pow(ndl, 1.6) gated by height; here it rides the same wSnow the albedo uses, so
        // it can never bleed onto rock or meadow, and it is multiplied by the baked sun
        // visibility so a shadowed crown stays cold.
        .add(uSunColour.mul(vec3(1.0, 0.72, 0.52))
            .mul(wSnow.mul(ndl.pow(1.6)).mul(sunVis).mul(0.30)));
    const toOutput = (c) => {
        const scaled = (applyExposure ? c.mul(uExposure) : c).mul(uOutputScale);
        return mix(vec3(dot(scaled, vec3(0.2126, 0.7152, 0.0722))), scaled, uOutputSat);
    };
    groundMat.colorNode = toOutput(applyAerial(lit, positionWorld));

    const groundMesh = new THREE.Mesh(ground.geometry, groundMat);
    groundMesh.frustumCulled = false;
    groundMesh.matrixAutoUpdate = false;
    groundMesh.updateMatrix();
    groundMesh.name = 'odyssey-world-ground';
    group.add(groundMesh);

    // ── sky ──
    const skyMat = new THREE.MeshBasicNodeMaterial();
    const skyDir = normalize(positionWorld.sub(cameraPosition));
    const skyAir = skyColourFor(skyDir.y)
        .add(vec3(1, 0.86, 0.66).mul(
            smoothstep(float(0.90), float(1), dot(skyDir, uSunDir)).pow(3).mul(0.3),
        ))
        .add(vec3(1, 0.97, 0.9).mul(
            smoothstep(float(0.9985), float(0.9995), dot(skyDir, uSunDir)).mul(2.2),
        ));
    // ONE COLOUR AT INFINITY. The seabed fades toward the deep plate while this dome sat
    // 6-11x brighter behind it, so the horizon carried a hard bright/dark seam that no amount
    // of fog tuning could hide. The dome now converges on the SAME deep plate the aerial
    // perspective converges on (uWaterDeep), and the bright lift is a DOWNWELLING cone,
    // pow-concentrated overhead, not a hemisphere-wide wash: surface light survives looking
    // UP, not sideways. Capture-measured at p=0.130 (camera pitched up the rail), the flat
    // hemisphere handed 90% of the frame's pixels one luma band; the cone is what puts a
    // dark-to-light gradient inside the up-pitched frame the ascent actually shows.
    const downwelling = clamp(skyDir.y, 0, 1).pow(2.2)
        .add(smoothstep(float(-0.15), float(0.35), skyDir.y).mul(0.22));
    const skyWater = mix(
        mix(uWaterMid, uWaterDeep, uEyeDepth),
        mix(uWaterMid, skyColourFor(float(0.4)).mul(0.42), float(0.35)),
        clamp(downwelling, 0, 1),
    );
    skyMat.colorNode = toOutput(mix(skyAir, skyWater, uSubmerged));
    skyMat.side = THREE.BackSide;
    skyMat.depthWrite = false;
    // The dome must sit INSIDE the camera's far plane. Sized off `reach` it lands at 22,000:
    // fine for the playground's 30,000 far plane, and entirely CLIPPED by the game's 9,000 —
    // where the shipped r=4000 atmosphere backstop fills in and the world's own sky, colour
    // script and all, is never seen. Callers with a tighter frustum pass their own radius.
    const domeRadius = Number.isFinite(skyRadius) ? skyRadius : Math.min(ground.reach * 1.7, 22000);
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(domeRadius, 32, 20), skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -100;
    skyMesh.name = 'odyssey-world-sky';
    group.add(skyMesh);

    // ── water ──
    const w = clipmapXZ(waterSpacing, 16);
    const waterMat = new THREE.MeshBasicNodeMaterial();
    // ── THE SWELL (Ghibli-water Wave 2) ──────────────────────────────────────────────
    // Was ONE separable sine product, amplitude 0.55 u over 483-628 u wavelengths: a maximum
    // surface slope of 0.007 rad, i.e. a flat sheet from every camera in the journey. Worse,
    // the shading normal was built from the wave's VALUE rather than its GRADIENT (max tilt
    // +-0.0275), so light never responded and the sea could not move even in shading.
    //
    // Now a 3-wave directional sum with ANALYTIC normals. Constraints that set the numbers:
    // the water clipmap is 6.4 u/cell, so the finest representable wavelength is ~13 u — every
    // wavelength here is far above that floor (110/62/37 u) and the fine detail that cannot be
    // geometry lives in the ripple normal below. Vertical displacement only: this is a MORPHING
    // clipmap, and horizontal (Gerstner Q) displacement would tear the seams between LOD rings.
    // Crest SHARPNESS is therefore bought in the fragment stage (the whitecap threshold), which
    // is where a painted look wants it anyway.
    const WAVES = [
        {
            dirX: 0.94, dirZ: 0.34, len: 54, amp: 1.30, speed: 0.85,
        },
        {
            dirX: 0.20, dirZ: -0.98, len: 31, amp: 0.72, speed: 1.15,
        },
        {
            dirX: -0.72, dirZ: 0.69, len: 19, amp: 0.34, speed: 1.55,
        },
    ];
    // Wavelengths halved from the first cut (110/62/37 m): at the shoreline station the sea
    // spans ~300 m, so a 110 m dominant wave put only two or three crests in the entire frame
    // and the foam read as isolated patches rather than a running sea. 54/31/19 m keeps every
    // wave clear of the 13 m geometric floor while roughly doubling the crest count in view.
    /** Summed amplitude — the normaliser the whitecap threshold is expressed against. */
    const WAVE_AMP_SUM = 2.36;
    // Shallow-water taper: waves must not saw through the beach. The bed comes from the same
    // macro bake the fragment stage uses; a vertex-stage fetch REQUIRES .level(0) (WGSL forbids
    // implicit-derivative sampling outside the fragment stage — this file's own header note).
    const wVertUv = w.worldXZ.div(float(RELIEF_EXTENT)).add(0.5);
    const wVertBed = texture(macroTex, wVertUv).level(0);
    const wVertDepth = float(ODYSSEY_SEA_LEVEL).sub(wVertBed.r).toVar();
    const wSwellFade = clamp(wVertDepth.div(9), 0, 1).toVar();
    // ONE definition of the wave field, evaluated in BOTH stages. It must be re-evaluated per
    // FRAGMENT rather than interpolated from the vertices: this clipmap's cells double every
    // ring, so past ring 0 a cell is tens to hundreds of metres wide and linear interpolation
    // erases a 110 m wave completely — the first cut carried height/slope as varyings and the
    // whitecaps came out as round blobs of pure noise on a surface with no wave data left in
    // it. Displacement stays in the vertex stage (it is geometry); everything the LOOK depends
    // on — normal, glint, whitecaps — is computed here, where every pixel gets the real wave.
    // `ampScale(wv)` lets the two stages disagree about AMPLITUDE while sharing one phase
    // definition — the vertex stage must fade waves its lattice cannot sample (below), the
    // fragment stage keeps them all.
    const waveField = (xz, ampScale = () => float(1)) => {
        let h = float(0);
        let dx = float(0);
        let dz = float(0);
        WAVES.forEach((wv) => {
            const k = (Math.PI * 2) / wv.len;
            const phase = xz.x.mul(wv.dirX * k)
                .add(xz.y.mul(wv.dirZ * k))
                .add(uTime.mul(wv.speed));
            const a = ampScale(wv).mul(wv.amp);
            h = h.add(sin(phase).mul(a));
            // d/dx and d/dz of the same sum — the gradient the old normal never had.
            dx = dx.add(cos(phase).mul(a.mul(k * wv.dirX)));
            dz = dz.add(cos(phase).mul(a.mul(k * wv.dirZ)));
        });
        return { h, dx, dz };
    };
    // PER-WAVE CAMERA-DISTANCE ENVELOPES, IDENTICAL IN BOTH STAGES (second fix; the first
    // was wrong and the user caught it twice). The first fix faded amplitude by the clipmap's
    // morph-adjusted `spacing` — continuous in VALUE, but its change concentrates inside the
    // narrow morph bands at ring edges, so wave height dropped in RECTANGULAR terraces ("wave
    // squares" seen from above), and the fragment field — still full amplitude — disagreed
    // with the terraced geometry along the same rectangles. It also gutted the near field:
    // ring 0's 6.4 m cells sat inside the 19 m wave's fade window, so the smallest wave ran
    // ~60% faded everywhere and the underside lost its rolling character.
    //
    // Distance from the CAMERA is smooth and radial — no ring shapes anywhere — and each
    // wave's envelope (full inside 3.5·len, gone past 5·len) closes BEFORE its wavelength
    // becomes undersampled: the lattice reaches ~2.5 samples/cycle for a wave of length L at
    // roughly 6.4·L from the centre, and 5·L sits safely inside that. Near the camera every
    // wave is FULL amplitude again. Both stages use the same envelope, so geometry and
    // shading cannot disagree, ever, by construction.
    // 4.5L -> 6.2L, sized from the lattice itself: ring spacing at distance R is ~R/16, and
    // 2.5 samples/cycle for a wave of length L therefore fails at ~6.4L — the envelope ends
    // just inside it. The first cut used 3.5L->5L and flattened the far ceiling: the
    // reference A/B proved the underside's beloved plate-mottling is the DISPLACED
    // geometry self-occluding at glancing angles, which no normal trick can fake, so the
    // envelopes must run as wide as sampling allows and not a metre narrower.
    const waveEnvelope = (wv, distXZ) => float(1)
        .sub(smoothstep(float(wv.len * 4.5), float(wv.len * 6.2), distXZ));
    const wVertDist = length(w.worldXZ.sub(cameraPosition.xz)).toVar();
    const swellVert = waveField(w.worldXZ, (wv) => waveEnvelope(wv, wVertDist));
    const swell = swellVert.h.mul(wSwellFade).toVar();
    waterMat.positionNode = vec3(w.worldXZ.x, float(ODYSSEY_SEA_LEVEL).add(swell), w.worldXZ.y);
    const wUv = varying(w.worldXZ.div(float(RELIEF_EXTENT)).add(0.5), 'vWUv');
    // Bed height from the macro BAKE — the analytic fold in a fragment-referenced varying was
    // the single largest cause of the minutes-long first compile (see bakeMacroTexture).
    const bedTex = texture(macroTex, wUv);
    const depth = float(ODYSSEY_SEA_LEVEL)
        .sub(bedTex.r.add(texture(heightTex, wUv).r.mul(bedTex.g))).toVar();
    // ── THE PAINTED SEA (Ghibli-water Wave 1) ────────────────────────────────────────
    // Was: two smooth mixes over hardcoded vec3s with band edges at 0-18 m and 18-103 m.
    // MEASURED problem: the median visible bed depth is 49.6 m at the shoreline station and
    // 133 m just past the breach, so both of the journey's largest water views sat inside
    // that ramp's flat upper region — one colour, no structure, exactly the "flat steel-blue
    // sheet" the capture critique found. Now: a Beer-Lambert depth driver tuned so the
    // measured range spans the whole ramp, quantised into flat plates, over the four-stop
    // pigment ramp the colour script owns (viridian -> cerulean -> cobalt -> Prussian).
    const wShore = vec3(...ODYSSEY_WATER_RAMP.shore);
    const wShelf = vec3(...ODYSSEY_WATER_RAMP.shelf);
    const wOpen = vec3(...ODYSSEY_WATER_RAMP.open);
    const wDeep = vec3(...ODYSSEY_WATER_RAMP.deep);
    // THE NORMAL IS THE GRADIENT NOW, plus animated ripple detail (Wave 2). The old normal
    // was built from the swell's VALUE, which is not a slope at all — it tilted +-0.0275 and
    // pointed the wrong way, so fresnel and the sun glint were effectively static. The wave
    // gradient arrives as a varying; the fine chop that the 13 u geometric floor forbids as
    // geometry is added here as a normal perturbation, sampled from the ALREADY-RESIDENT
    // detail bake (rg = signed derivatives, RepeatWrapping) at two scrolling scales — the
    // never-repeating trick harvested from r181's own WaterMesh.getNoise(), at two taps
    // instead of four because this sea is stylised, not photographic.
    // NOTE the encoding: detailTex.rg are SIGNED central-difference derivatives already
    // centred on zero (bakeDetailNormal), NOT a 0..1 normal map — subtracting 0.5 from them
    // injects a large constant slope over the whole sea, which is exactly how the first cut
    // of this term turned the ocean solid white.
    const rippleA = texture(detailTex, w.worldXZ.mul(0.021).add(vec2(uTime.mul(0.010), uTime.mul(-0.014)))).rg;
    const rippleB = texture(detailTex, w.worldXZ.mul(0.047).add(vec2(uTime.mul(-0.018), uTime.mul(0.008)))).rg;
    const ripple = rippleA.mul(0.9).add(rippleB.mul(0.5)).toVar();
    // The wave field again, per fragment, from the true world position — at FULL amplitude.
    // The envelopes above are for DISPLACEMENT only: a lattice tears when asked to sample a
    // wave it cannot resolve, but shading is analytic per pixel and cannot tear, and it is
    // precisely the full-amplitude fragment normal modulating the Snell window that paints
    // the mottled light across the whole underside ceiling — the look the user named. (The
    // one-session detour that enveloped BOTH stages flattened that ceiling; reverted.) The
    // single global fade below only prevents sub-pixel shimmer at the horizon, where the
    // dissolve owns the frame anyway.
    const wFragDist = length(positionWorld.xz.sub(cameraPosition.xz)).toVar();
    const wFragFade = clamp(float(1).sub(wFragDist.div(520)), 0, 1).mul(wSwellFade).toVar();
    const wFrag = waveField(positionWorld.xz);
    const waveH = wFrag.h.mul(wFragFade).toVar();
    const waveSlope = vec2(wFrag.dx, wFrag.dz).mul(wFragFade).toVar();
    const wSlope = waveSlope.add(ripple.mul(wSwellFade)).toVar();
    const wN = normalize(vec3(wSlope.x.negate(), 1, wSlope.y.negate())).toVar();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const spec = smoothstep(float(0.9955), float(0.9995), dot(normalize(uSunDir.add(viewDir)), wN)).mul(0.9);
    const grazing = float(1).sub(clamp(abs(dot(wN, viewDir)), 0, 1));
    // WAVE 5 — the MENISCUS: while the eye is within ~3 u of the plane, the extreme-grazing
    // sliver of the surface lights as a thin bright line — the crossing cue that makes the
    // breach one event instead of a fade. Rides `grazing`, so it IS the waterline.
    const meniscus = smoothstep(float(0.93), float(0.995), grazing).mul(uBreachNear).mul(0.9);
    // ── THE REGIME BRANCH (MEASURED, and it pays for the whole Ghibli package) ────────
    // The cold-machine sweep priced waves 1+2 at +2.36 ms on the deep station — OVER its
    // 14.2 max — and the tell is that both hot stations are UNDERWATER frames: every
    // submerged pixel was paying for the full topside stack (quantised ramp, fresnel, sun
    // glint, whitecaps with their noise, horizon dissolve, shore band) and then discarding
    // it in the final mix, because a multiply-by-uniform is not dead code (this repo's
    // logged lesson). uSubmerged is a UNIFORM the CPU writes each frame, so `If` on it is
    // uniform control flow — the GPU skips the untaken side coherently, no divergence.
    // Both branches only run inside the 14 u breach transition band (~1% of the journey).
    // Shared prerequisites (wave field, ripple normal, spec, grazing) are defined above
    // because BOTH regimes read them — but they must also be BUILT below, at the branch
    // root, or the branch that runs second reads zeros. See the root-pin block.
    const waterShaded = Fn(() => {
        // ── ROOT-PIN THE SHARED TERMS (the "flat ceiling / clear sea" regression) ──
        // r181's WGSL builder hoists var DECLARATIONS to function scope but emits each
        // ASSIGNMENT at the node's first build site. These terms were first built inside
        // the TOPSIDE If, so on submerged frames (topside skipped) the underside read
        // ZERO-initialised depth/wN/spec/grazing: the Snell window collapsed to uniform
        // tirBody and opacityNode's depth read 0 (a semi-clear sea). A bare .toVar() here
        // runs toStack() at creation on the Fn's root stack, so each line below is a real
        // root statement that pins the assignment before either branch. Proven by the
        // always-true-conditions probe: identical formulas, branches forced on, and the
        // ceiling came back — the regime If was starving the untaken branch's inputs.
        depth.toVar('wRootDepth');
        wN.toVar('wRootN');
        spec.toVar('wRootSpec');
        grazing.toVar('wRootGrazing');
        const col = vec3(0).toVar('waterRegimeCol');
        If(uSubmerged.lessThan(0.999), () => {
            // ── TOPSIDE: the painted sea (Wave 1) + whitecaps (Wave 2) ──
            // exp2 absorption, not a linear lerp: near-shore metres get the resolution
            // they need while the deep saturates instead of clipping.
            const wT = clamp(
                float(1).sub(exp2(depth.mul(-ODYSSEY_WATER_RAMP.absorptionPerMetre))),
                0,
                1,
            ).toVar();
            // QUANTISE into flat plates with an anti-aliased edge. A hard floor()
            // posterise aliases badly at 720p on a surface this size.
            const bands = float(ODYSSEY_WATER_RAMP.bands);
            const wCell = wT.mul(bands).toVar();
            const wStep = floor(wCell).add(smoothstep(float(0.45), float(0.55), fract(wCell)))
                .div(bands)
                .toVar();
            const wSeg = wStep.mul(3).toVar();
            const body = mix(
                mix(
                    mix(wShore, wShelf, clamp(wSeg, 0, 1)),
                    wOpen,
                    clamp(wSeg.sub(1), 0, 1),
                ),
                wDeep,
                clamp(wSeg.sub(2), 0, 1),
            );
            // FRESNEL TWO-TONE, then the sun glint over the baked sun visibility. Ghibli
            // water is not a mirror: the sky arrives as a colour wash, never an image.
            const fb = float(1).sub(max(dot(wN, viewDir), 0));
            const fres = fb.mul(fb).mul(fb).mul(fb).mul(0.62);
            const wVis = texture(sunVisTex, wUv).r;
            const wl = mix(body, skyColourFor(float(0.22)), fres)
                .add(vec3(1, 0.96, 0.88).mul(spec).mul(wVis))
                .mul(wVis.mul(0.18).add(0.82))
                .toVar();
            // WHITECAPS — The Witness reference: opaque flat white with a drawn edge, so
            // this MIXES toward white in a narrow (0.06) threshold band. HEIGHT is the
            // driver (height+steepness fight each other: a sine's crest has zero slope),
            // normalised against the real summed amplitude so the threshold means what it
            // says; high-frequency noise breaks the crest lines into separate caps without
            // out-voting them.
            const crestNorm = clamp(waveH.div(WAVE_AMP_SUM), -1, 1);
            const capNoise = snoise3(vec3(
                w.worldXZ.x.mul(0.14),
                w.worldXZ.y.mul(0.14),
                uTime.mul(0.35),
            ));
            const capDrive = crestNorm.add(capNoise.mul(0.30));
            const cap = smoothstep(float(0.50), float(0.56), capDrive)
                .mul(smoothstep(float(0.4), float(2.5), depth));
            wl.assign(mix(wl, vec3(0.97, 0.99, 1.0), cap.mul(0.9)));
            // HORIZON DISSOLVE — far water converges on the sky (80% by 1.2 km, capped
            // below 1 so the boundary never becomes a hard line of its own), applied AFTER
            // the caps so far foam melts into sky instead of shimmering; then the static
            // shore brightening band (proven live by the Wave 0 GPU probe).
            const wHorizon = clamp(
                length(positionWorld.sub(cameraPosition)).mul(1 / 1200),
                0,
                1,
            ).pow(1.4).mul(0.8);
            wl.assign(mix(wl, skyColourFor(float(0.16)), wHorizon));
            wl.assign(wl.add(vec3(0.92, 0.97, 0.99).mul(
                smoothstep(float(2.6), float(0.15), depth)
                    .mul(smoothstep(float(-0.4), float(0.5), depth)).mul(0.55),
            )));
            col.assign(wl);
        });
        If(uSubmerged.greaterThan(0.001), () => {
            // ── UNDERSIDE: the luminous ceiling (Wave 5 of the seam plan, unchanged) ──
            // Crest SSS + Snell's window + TIR; the swell-perturbed normal (shared, above)
            // is what makes the window's rim ripple live.
            const crestMask = clamp(swell.mul(1.6).add(0.35), 0, 1);
            const sss = crestMask.mul(grazing).mul(clamp(dot(uSunDir, vec3(0, 1, 0)), 0, 1));
            const upCos = clamp(dot(viewDir.negate(), wN), 0, 1);
            const snellWindow = smoothstep(float(0.60), float(0.72), upCos);
            const windowSky = skyColourFor(float(0.9)).mul(1.30)
                .add(vec3(1, 0.96, 0.88).mul(spec).mul(1.2));
            const tirBody = mix(uWaterMid, uWaterDeep, uEyeDepth).mul(0.6);
            const underside = mix(tirBody, windowSky, snellWindow)
                .add(uWaterGlow.mul(sss).mul(0.55));
            col.assign(mix(col, underside, uSubmerged));
        });
        return col.add(vec3(0.95, 0.99, 1.0).mul(meniscus));
    })();
    waterMat.colorNode = toOutput(applyAerial(waterShaded, positionWorld));
    waterMat.opacityNode = clamp(smoothstep(float(-0.6), float(2.2), depth), 0, 1);
    waterMat.transparent = true;
    waterMat.depthWrite = false;
    waterMat.alphaTest = 0.004;
    waterMat.side = THREE.DoubleSide;
    // MEASUREMENT LEVER (see the `water` option): when off, the mesh is never created, so the
    // sea costs zero draws, zero vertex work, zero fill AND zero pipeline compile. The TSL
    // node objects above are plain JS until a material they feed is rendered, so building them
    // unconditionally keeps this gate a one-line diff with no dangling references.
    let waterMesh = null;
    if (water) {
        waterMesh = new THREE.Mesh(waterGeo.geometry, waterMat);
        waterMesh.frustumCulled = false;
        waterMesh.matrixAutoUpdate = false;
        waterMesh.updateMatrix();
        waterMesh.renderOrder = 1;
        waterMesh.name = 'odyssey-world-water';
        group.add(waterMesh);
    }

    // ── cloud deck ─────────────────────────────────────────────────────────────────
    // The single highest-value thing the chapters were doing that the world was not.
    // Ch3's biggest loss was its 15 cumulus banks, Ch4's was its cloud-SEA disc, Ch5's was
    // its six FBM strata — three chapters authoring three views of ONE physical layer, each
    // in its own local frame, which is the whole disease this rebuild exists to cure. Here
    // it is one deck at one altitude, and the reading changes because the RAIL CLIMBS
    // THROUGH it: cumulus overhead from the shore, strata at eye height on the ascent, a
    // sunlit sea below you from the summit. Nothing switches; the camera just moves.
    const cl = clipmapXZ(cloudSpacing, 16);
    const cloudMat = new THREE.MeshBasicNodeMaterial();

    // Billow, so the deck is a weather system and not a pane of glass. Cheap: two sines
    // against a texture lookup, all in the vertex stage.
    //
    // GATED BY COVERAGE. Run at full amplitude the billow displaces geometry that the
    // fragment stage then cuts a hole through, so every hole edge was a torn cliff a hundred
    // metres tall seen against the sky. Estimating the same coarse density here — the 0.52
    // weighted octave, the term that decides where the holes ARE — lets the surface sink back
    // to the flat deck plane exactly where it is about to become transparent. Edges dissolve
    // instead of tearing. `.level(0)` is mandatory (WGSL forbids implicit LOD in a vertex
    // stage) and the lint in odyssey-world-lints.test.js enforces it.
    const cloudDrift = uTime.mul(0.0016);
    // TWO octaves, RE-NORMALISED (cloud plan Wave 1a). The gate's whole job is to sink
    // geometry exactly where the FRAGMENT stage is about to go transparent, but it was
    // estimating that from octave A alone while the fragment sums three (A*0.52 + B*0.32 +
    // B*0.16). One octave cannot see holes the other two carve, so billowed geometry
    // survived into fragments that then discarded it — the torn-edge failure this gate
    // exists to prevent, just one octave later. Adding octave B covers 84 % of the
    // fragment sum; the weights are divided by that 0.84 so the MEAN is unchanged and the
    // 0.63/0.40 threshold calibration below still means what it says (an un-normalised
    // 0.84-weighted sum would sit systematically under the threshold and shift every gate
    // band). `.level(0)` is mandatory in the vertex stage and lint-enforced.
    const vertDensity = texture(detailTex, cl.worldXZ.mul(0.00205).add(vec2(cloudDrift, 0)))
        .level(0).a.mul(0.52 / 0.84)
        .add(texture(detailTex, cl.worldXZ.mul(0.00560).add(vec2(0.31, 0.77)).add(vec2(cloudDrift.mul(1.7), 0)))
            .level(0).a.mul(0.32 / 0.84))
        .toVar();
    const vertThreshold = mix(
        float(0.63),
        float(0.40),
        smoothstep(float(-150), float(-760), cl.worldXZ.y),
    ).toVar();
    const billowGate = smoothstep(
        vertThreshold.sub(0.16),
        vertThreshold.add(0.06),
        vertDensity,
    ).toVar();
    const billow = texture(detailTex, cl.worldXZ.mul(0.00042)).level(0).b.sub(0.5)
        .mul(165)
        .add(cl.worldXZ.x.mul(0.0016).add(uTime.mul(0.02)).sin().mul(34))
        .mul(billowGate);
    cloudMat.positionNode = vec3(cl.worldXZ.x, float(CLOUD_DECK_Y).add(billow), cl.worldXZ.y);
    // The fragment stage needs the DISPLACED height, not the deck plane, for its above/below
    // decision (see `fromAboveF`). One varying, no extra fetch.
    const vCloudY = varying(float(CLOUD_DECK_Y).add(billow), 'vCloudY');

    // Coverage is a property of the MAP, not of a chapter index. The rail runs inland and
    // upward as it climbs (z falls from the shore at +60 to the ascent at -700), so a deck
    // that thickens inland gives broken daylight cumulus over the valley and a solid sea
    // under the summit — the two things Ch3 and Ch4 each hand-authored — from one term.
    // The threshold is placed against the MEASURED distribution of the density field, not an
    // assumed one: sampled over the deck it runs p10 0.42 / p50 0.58 / p90 0.70, so a coverage
    // control expressed as "1 - cover" sat almost entirely above the field's own range and the
    // deck rendered empty. 0.63 leaves broken cumulus over the valley; 0.40 is a near-solid sea.
    // WIND STREETS (cloud plan Wave 1b). Coverage used to be a bare world-Z ramp, so at any
    // given distance inland the sky had ONE density everywhere across x — a gradient of fog
    // rather than weather. This adds a slow lateral swing so coverage opens and closes across
    // the valley. WAVELENGTH IS THE WHOLE POINT: the approach proposal specified 0.00022,
    // which is a ~28.5 km period — nearly constant over the visible deck, i.e. a no-op, and
    // the research critic caught it. 0.0018 is a ~3.5 km period, which puts two or three
    // openings across a wide view. The z term tilts the streets so they do not read as bars.
    // COVERAGE RAISED 0.63/0.40 -> 0.685/0.515 (Wave 2 exit-gate response + Witness reference).
    // TWO reasons that point the same way, which is why this is a threshold change and not a
    // shader trick. (1) MEASURED: the rebaked field put visibly more cloud on screen at the
    // old thresholds, and the deck's cost went 1.049 -> 1.376 ms at ch4 with a drift bound of
    // 0.066 — five times the bound, so real. The two new gradient taps can only account for
    // ~0.05 ms of that by arithmetic (≈0.37 Mpx covered x 2 fetches), so the cost is COVERAGE:
    // more covered pixels means more blended fill, and fill is what this iGPU is short of.
    // (2) ART: the owner's Witness reference is mostly BLUE — discrete cumulus with generous
    // sky between them, not a broken overcast. Lower coverage serves the budget and the
    // reference with one number, which is the rare case where the cheap fix is also the right
    // one. The inland end moves least (0.40 -> 0.515): ch5's overhead deck still reads as a
    // layer, just not a lid.
    const cloudThreshold = mix(
        float(0.685),
        float(0.515),
        smoothstep(float(-150), float(-760), cl.worldXZ.y),
    ).add(sin(cl.worldXZ.x.mul(0.0018).add(cl.worldXZ.y.mul(0.0006))).mul(0.045));
    const vThresh = varying(cloudThreshold, 'vThresh');
    const cUvA = varying(cl.worldXZ.mul(0.00205), 'vCUvA');
    const cUvB = varying(cl.worldXZ.mul(0.00560).add(vec2(0.31, 0.77)), 'vCUvB');
    const cUvC = varying(cl.worldXZ.mul(0.01420).add(vec2(0.58, 0.12)), 'vCUvC');
    const drift = uTime.mul(0.0016);
    // ALL THREE OCTAVES READ THE SILHOUETTE FIELD (.a) — cloud plan Wave 1b. Octaves 2 and 3
    // used to read .b, which is the terrain's value noise: lobes at the coarse scale with
    // static sprayed over them at the fine scales, so every cloud edge dissolved into
    // confetti exactly where the Ghibli rules want a drawn scallop. Reading .a at all three
    // scales gives the three-tier lobe hierarchy the references describe (primaries carry the
    // read, secondaries ride them, tertiaries scallop the crown), and the scale ratios
    // (2.73x, 2.54x) are deliberately non-integer so the 256^2 tile's recurrences at the
    // three octaves never coincide.
    const density = texture(detailTex, cUvA.add(vec2(drift, 0))).a.mul(0.52)
        .add(texture(detailTex, cUvB.add(vec2(drift.mul(1.7), 0))).a.mul(0.32))
        .add(texture(detailTex, cUvC).a.mul(0.16));

    // Fade the deck out at the lattice rim, or its far edge draws a horizon-wide straight
    // line across the sky — the same failure mode as a uv feather that never reaches 1.
    const cloudDist = length(cl.worldXZ.sub(uLodCenter));
    const rim = float(1).sub(smoothstep(float(cloudReach * 0.62), float(cloudReach * 0.95), cloudDist));
    // Widen the alpha edge with FOOTPRINT: a 0.06 band is a crisp cumulus edge up close and a
    // pixel-wide razor cut at 10 km, which aliases into hard confetti. Band-limiting the edge
    // is the same principle the ground's detail gate already uses.
    const cloudFootprint = max(length(dFdx(positionWorld.xz)), length(dFdy(positionWorld.xz)));
    // A LITTLE band-limiting, not a lot: the first attempt lifted the edge to 0.22 at range,
    // which stopped anti-aliasing the edge and started making it — partial coverage everywhere
    // turned the distant broken cumulus into a translucent overcast veil across the whole sky.
    const puffBand = smoothstep(float(8), float(90), cloudFootprint).mul(0.05).add(0.06);
    // The anti-aliased edge width, hoisted: BOTH the colour block (the underside's shadow-patch
    // step) and the opacity block (the drawn edge + opaque core) key off it, so it has to be
    // declared before either reads it.
    const aaW = puffBand.toVar();

    // ── TWO-BAND SUN SHADING (cloud plan Wave 2) ─────────────────────────────────────
    // The deck never read `uSunDir` at all: light had no direction, so every mass was the
    // same tone whichever way it faced, and the only variation came from DENSITY modulating
    // colour — which reads inverted, thin edges glowing and thick cores going dark (the
    // distillation's mistake #4: frequency belongs in the silhouette, the interior stays
    // flat). Now the silhouette field doubles as a height field: two extra taps give its
    // gradient, the gradient gives a pseudo-normal, and ONE dot against the sun through ONE
    // narrow smoothstep gives a hard quantised terminator. Because the normal comes from the
    // SAME field that cuts the silhouette, the terminator's edge scallops in step with the
    // outline — which is the "flat yet volumetric" trick the whole reference set turns on.
    // The gradient sampler. GUARDED normalize downstream: a zero-length vector const-folds into
    // a WGSL compile failure on this stack (the winter theme's logged trap), and the gradient
    // IS zero wherever the field is locally flat — most of a cloud's interior. The terminator
    // band is 8 % wide — a drawn line, not a gradient — and its edges are never equal, because
    // `smoothstep(a, a, x)` is a hard WGSL compile error.
    const cTexel = float(1 / 256);
    const cSample = (uvOff) => texture(detailTex, cUvA.add(vec2(drift, 0)).add(uvOff)).a;
    const cloudTop = uSunColour.mul(1.06).add(uSkyZenith.mul(0.10));
    // The base tone leans on the HORIZON colour, not the shadow tint. The first version was
    // shadow-tint-dominated, which the playground (no post stack) rendered as soft grey — and
    // the in-game grade (outputScale 0.82, ACES, chapter saturation 1.10) crushed into ragged
    // NAVY shards across Ch5's sky. Same lesson as the ground palette: the world hands the
    // grade a brighter, flatter colour than it wants on screen, because the grade adds the
    // punch. Capture-diagnosed at Ch5 eye height, 2026-08-12.
    // THE SHADOW BAND IS A HUE SHIFT, NOT A DARKENING (rule 2). Mixing toward the horizon
    // colour and leaning violet keeps the value gap small (~85 % of lit) while the temperature
    // gap does the work; darkening instead reads muddy and grey. Everything here is authored
    // BRIGHT because the world hands the post stack a deliberately flattened image
    // (outputSaturation 0.72) and the grade supplies the vividness.
    const cloudShade = mix(cloudTop, uSkyHorizon, float(0.42)).mul(vec3(0.99, 0.995, 1.06));
    // THE UNDERSIDE IS WHERE THIS DECK ACTUALLY LIVES, so it gets two bands of its own.
    // MEASURED while building this wave: the rail's eye tops out around y=634 at the end of
    // ch5 (`?p=0.643` reports eyeY 634.1) against a deck plane at 660 — the camera never
    // climbs above the deck in Act II, it only reaches INSIDE the billow band. So the sun
    // terminator above is a late-ch5 detail, and a single flat underside tone would have made
    // this wave invisible for most of the journey.
    // The references do not paint undersides flat either: volume is read from the SHAPE of
    // flat shadow patches (the fish-scale stack), not from smooth shading. So the underside
    // takes ONE quantised step — thick core a touch cooler and darker, thin shoulder brighter
    // — with the step following the density contour, which makes each patch lobe-shaped for
    // free. NOTE THE SIGN: the old term did `mix(base, top, puff.oneMinus())`, i.e. LOW
    // density got the bright tone, so thin edges glowed and thick cores went dark — the
    // inverted read the critique flagged. This is that term, the right way round and
    // quantised instead of smooth. Both tones stay LIGHTER than the sky behind them (rule 3),
    // which is the anti-"navy shards" rule this deck has been burnt by before.
    const cloudUnderLit = uSkyHorizon.mul(1.10).add(uShadowTint.mul(0.12));
    // ~0.86 of the lit band's luminance with a strong violet lean. The first pass used 0.96 and
    // the patches were invisible once the grade had flattened them (outputSaturation 0.72 into
    // an ACES curve) — the repo's standing playground rule is that colour must OVERSHOOT here,
    // and a two-band read that survives the grade needs a bigger gap than it needs on the page.
    const cloudUnderShade = uSkyHorizon.mul(0.86).add(uShadowTint.mul(0.36)).mul(vec3(0.96, 0.98, 1.09));
    // The step also starts closer to the silhouette edge, so the shadow patch covers a real
    // area of each lobe instead of only its densest core.
    const underStep = smoothstep(vThresh.add(aaW).add(0.012), vThresh.add(aaW).add(0.042), density);
    const cloudUnder = mix(cloudUnderLit, cloudUnderShade, underStep);
    // PER-FRAGMENT above/below, against the fragment's OWN displaced height. The old term read
    // the camera against the flat deck plane, so the entire sky swapped tone at once as the
    // rail climbed through y=660; now billow crests flip to their sunlit read before the
    // troughs do, which is a parallax reveal instead of a global colour swim.
    // ── THE REGIME GATE (MEASURED; this is the water plate's lesson applied) ─────────
    // Wave 2 shipped +0.327 ms at ch4 against a 0.066 drift bound — five times the bound, so
    // real, and it FAILED the wave's exit gate. The first hypothesis was fill, so coverage was
    // cut from 0.63/0.40 to 0.685/0.515: `cloudsMs` came back 1.376, IDENTICAL to the digit.
    // That refutes fill and confirms what the research critic said about the discard floor —
    // sub-threshold fragments still run every tap, discard only saves the blend write — so the
    // cost is shader work on EVERY rasterised sheet fragment, cloud or sky.
    //
    // And most of that work is invisible: the rail's eye tops out near y=634 against a deck at
    // 660, so below y≈484 (deck minus billow minus the fade's own 60 u) `fromAboveF` is zero
    // for every fragment and the entire top read — two gradient taps, a normalize, a dot and a
    // terminator — is computed and then multiplied away. A multiply by zero is NOT dead-code-
    // eliminated (this repo's logged lesson, and the exact bug the water plate had). `uCloudTopLit`
    // is a uniform the CPU writes, so `If` on it is uniform control flow the GPU skips coherently.
    const cloudCol = Fn(() => {
        // ROOT-PIN first: r181 emits a var's ASSIGNMENT at its first build site, so any shared
        // term first built inside a branch leaves the other path — and later graph roots like
        // `opacityNode` — reading zeros. This is the regression that broke the water's
        // underside; it is not being repeated here.
        density.toVar('cRootDensity');
        aaW.toVar('cRootAaW');
        vThresh.toVar('cRootThresh');
        const col = vec3(0).toVar('cloudColOut');
        col.assign(cloudUnder);
        If(uCloudTopLit.greaterThan(0.5), () => {
            const cCentre = cSample(vec2(0, 0)).toVar();
            const cGx = cSample(vec2(cTexel, 0)).sub(cCentre);
            const cGz = cSample(vec2(0, cTexel)).sub(cCentre);
            const cNraw = vec3(cGx.mul(-9.0), 1, cGz.mul(-9.0));
            const cN = cNraw.div(max(length(cNraw), float(1e-5)));
            const cSun = clamp(dot(cN, uSunDir).mul(0.5).add(0.5), 0, 1);
            const cBand = smoothstep(float(0.44), float(0.52), cSun);
            const fromAboveF = smoothstep(float(-60), float(90), cameraPosition.y.sub(vCloudY));
            col.assign(mix(cloudUnder, mix(cloudShade, cloudTop, cBand), fromAboveF));
        });
        return col;
    })();
    cloudMat.colorNode = toOutput(applyAerial(cloudCol, positionWorld));
    // NEAR FADE: Ch5's rail crosses the deck's altitude, so without this the camera meets
    // paper-thin billowed geometry edge-on — ragged shards filling the frame. Fading by
    // distance to the EYE (not by altitude band) keeps the deck solid at range in every
    // direction while the 60..240 u shell around the camera reads as passing through mist.
    const nearFade = smoothstep(float(60), float(240), length(positionWorld.sub(cameraPosition)));
    // ALTITUDE-BAND FADE. The near fade alone is not enough: with the camera INSIDE the
    // deck's billow band, the sheet at the camera's own altitude forms hard torn silhouettes
    // at EVERY distance — the ragged-shards frame the first Ch5 capture produced. Fading
    // fragments within ~200 u of the camera's altitude opens a horizontal corridor through
    // the layer while the deck above and below stays solid, which reads as flying between
    // cloud floors — exactly the "strata at eye height" the chapter wants.
    const bandFade = smoothstep(float(40), float(200), abs(positionWorld.y.sub(cameraPosition.y)));
    // ── POSTER-PAINT ALPHA (cloud plan Wave 1b) ──────────────────────────────────────
    // Was a single smoothstep to 0.94: one soft ramp from sky to cloud, which is the
    // fog-blob edge the Ghibli/Witness distillation names as mistake #1, and a body that
    // never reached opaque so saturated sky bled through the mass everywhere (mistake #11,
    // and half of why the holes read ultramarine).
    //
    // Now TWO stops. `edgeA` is the drawn edge: it rises across the footprint-widened band
    // — keeping the far-field band-limiting that stops the horizon aliasing into confetti —
    // and stops at 0.72, so the silhouette has a visible rim rather than fading in. `coreA`
    // then takes the interior to FULLY opaque a little further in. `max` of the two is a
    // hard edge followed by poster paint, which is exactly the Witness cloud profile.
    const edgeA = smoothstep(vThresh, vThresh.add(aaW), density).mul(0.72);
    const coreA = smoothstep(vThresh.add(aaW).add(0.035), vThresh.add(aaW).add(0.085), density);
    cloudMat.opacityNode = max(edgeA, coreA).mul(rim).mul(nearFade).mul(bandFade)
        .mul(float(1).sub(uSubmerged))
        // 0.94 -> 0.985: the last 6 % of transparency was the whole sky's worth of milkiness.
        .mul(0.985);
    cloudMat.transparent = true;
    cloudMat.depthWrite = false;
    // THE BLEND-BANDWIDTH FLOOR (cloud plan Wave 1a). The deck is a sky-covering sheet whose
    // alpha is zero or near-zero over most of its area, and every one of those fragments was
    // still paying a full read-modify-write in the ROP — on a shared-LPDDR iGPU that is the
    // expensive half of a transparent full-screen layer. Wave 0 measured the deck at 1.049 ms
    // (ch4) and 1.901 ms (ch5, 20.9 % of the frame), so this is being taken out of a real
    // number rather than a guess. Same 0.004 cut the water plate already uses.
    cloudMat.alphaTest = 0.004;
    cloudMat.side = THREE.DoubleSide;

    const cloudMesh = new THREE.Mesh(cloudGeo.geometry, cloudMat);
    cloudMesh.frustumCulled = false;
    cloudMesh.matrixAutoUpdate = false;
    cloudMesh.updateMatrix();
    cloudMesh.renderOrder = 6;
    cloudMesh.name = 'odyssey-world-clouds';
    if (clouds) group.add(cloudMesh);

    // ── god rays (Ch2 port) ─────────────────────────────────────────────────────────
    // The deep-ocean chapter's declared hero: descending light shafts with caustic shimmer.
    // Ported as ONE InstancedMesh of open cones seated along the SUBMERGED stretch of the
    // rail (the caller samples its spline into railSamples — the world does not know the
    // path), tilted to the real ODYSSEY_WORLD_SUN rather than the old chapter's private
    // "light from above" assumption. Visible only while the camera is underwater.
    const sunkPoints = railSamples.filter((pt) => pt && pt.y < ODYSSEY_SEA_LEVEL - 6);
    // WAVE 4: the cap is the REAL number. Four research findings priced this system at "22
    // cones" off the old cap while the submerged rail has ever only yielded 9 — the code's
    // own constant was the source of the wrong number, so it now states the truth.
    const rayCount = Math.min(9, sunkPoints.length);
    let rayMesh = null;
    let rayMat = null;
    if (rayCount > 2) {
        rayMat = new THREE.MeshBasicNodeMaterial();
        const rUv = uv();
        // Brightest where the shaft meets the surface, feathering to nothing as it descends —
        // with a short feather AT the base too (first capture after the flip showed the open
        // base's rim as a hard bright ellipse; a shaft of light has no end-cap). The depth
        // exponent steepened 1.15 -> 1.6 so the shaft melts out by mid-depth instead of
        // standing as a full-height pipe.
        const vFade = float(1).sub(rUv.y).pow(1.6).mul(smoothstep(float(0.0), float(0.14), rUv.y));
        // FACING fade, not a uv.x feather. On a ConeGeometry uv.x runs around the
        // CIRCUMFERENCE, so the ported `abs(uv.x - 0.5)` lit one side of the cone and left a
        // hard seam on the other — in-game that read as solid triangular wedges, not light.
        // A shell standing in for a volume must instead dim where it is seen EDGE-ON, because
        // the grazing angle IS the silhouette; fading it there means the shape has no visible
        // boundary at all.
        const rayView = normalize(cameraPosition.sub(positionWorld));
        const eFade = abs(dot(normalWorld, rayView)).pow(0.85).toVar();
        // NEAR fade: the rail passes THROUGH these shafts, and a 220 u cone a few metres from
        // the eye fills the frame with one flat wedge. Same lesson as the cloud deck.
        const rayNear = smoothstep(float(14), float(85), length(positionWorld.sub(cameraPosition)));
        const rayShimmer = snoise3(vec3(
            rUv.x.mul(3.0),
            rUv.y.mul(2.0).add(uTime.mul(-0.12)),
            uTime.mul(0.2),
        ));
        // Same NaN guard as the caustic below: pow() with a negative base and a non-integer
        // exponent is UNDEFINED in WGSL, and two summed noises can dip below the -0.5 that
        // .add(0.5) assumes. Clamp first.
        const rayShimmerSafe = clamp(rayShimmer.mul(0.5).add(0.5), 0, 1).pow(1.35)
            .mul(0.55)
            .add(0.45);
        rayMat.colorNode = uSunColour.mul(vec3(0.75, 0.92, 1.0)).mul(uOutputScale);
        // 0.55 -> 0.34: the flip put the wide (formerly buried) half of every cone in front
        // of the camera, and DoubleSide additive pays both walls — at the old master the
        // shafts read as solid pipes.
        rayMat.opacityNode = vFade.mul(eFade).mul(rayNear).mul(rayShimmerSafe).mul(uSubmerged)
            .mul(0.34)
            .toVar();
        rayMat.transparent = true;
        rayMat.blending = THREE.AdditiveBlending;
        rayMat.depthWrite = false;
        rayMat.side = THREE.DoubleSide;
        rayMat.fog = false;

        const hash01 = (n) => {
            let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
            h = Math.imul(h ^ (h >>> 13), 1274126177);
            return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        };
        const sunLen = Math.hypot(...ODYSSEY_WORLD_SUN);
        const sunDirV = new THREE.Vector3(...ODYSSEY_WORLD_SUN).divideScalar(sunLen);
        // Lean toward the sun's azimuth but only PART WAY: at 25 degrees of solar elevation a
        // full alignment lays the cones nearly sideways, and refraction at the surface bends
        // real underwater shafts steeply toward the vertical (Snell), so a ~23 degree lean
        // keeps the direction of the light readable without the fallen-over look the first
        // capture showed. The AZIMUTH still matches the one canonical sun.
        const fullTilt = new THREE.Quaternion()
            .setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDirV);
        const tilt = new THREE.Quaternion().slerp(fullTilt, 0.35);
        const rayGeo = new THREE.ConeGeometry(7, 240, 14, 1, true);
        // WAVE 4: RIGHT WAY UP. ConeGeometry seats the wide base (uv.y=0, where vFade is
        // brightest) at the BOTTOM and the apex at the top — so the shafts were brightest at
        // their deep end, the bright base buried below the seabed, and the thin dark apex
        // poking above the surface. Flipping the geometry puts the wide bright end AT the
        // surface and tapers the shaft dark toward the floor, which is what refracted
        // surface light does.
        rayGeo.rotateX(Math.PI);
        rayMesh = new THREE.InstancedMesh(rayGeo, rayMat, rayCount);
        const rm4 = new THREE.Matrix4();
        const rPos = new THREE.Vector3();
        const rScl = new THREE.Vector3();
        for (let i = 0; i < rayCount; i += 1) {
            const pt = sunkPoints[Math.floor((i / rayCount) * sunkPoints.length)];
            const a = hash01(i * 3 + 1) * Math.PI * 2;
            const r = 18 + (hash01(i * 3 + 2) * 46);
            // Base (wide, bright end) just above the surface; the apex feathers down to
            // ~SEA-236, dark before it can meet the deepest floor (~SEA-207).
            rPos.set(pt.x + (Math.cos(a) * r), ODYSSEY_SEA_LEVEL - 116, pt.z + (Math.sin(a) * r));
            const sc = 0.75 + (hash01(i * 3 + 3) * 0.7);
            rScl.set(sc, 1, sc);
            rayMesh.setMatrixAt(i, rm4.compose(rPos, tilt, rScl));
        }
        rayMesh.instanceMatrix.needsUpdate = true;
        rayMesh.frustumCulled = false;
        rayMesh.renderOrder = 3;
        rayMesh.name = 'odyssey-world-godrays';
        group.add(rayMesh);
    }

    // ── motes (Wave 4: the particulate the luminous ocean was missing) ─────────────
    // Nausicaa's transmitted-light rig, sized for Lane B: the spores are LIGHT SOURCES, so
    // each mote's brightness scales with how dark the water behind it is (deeper = brighter
    // relative to its background), and serenity comes from CONSTANT velocity — no easing.
    // ONE material, ONE instanced draw, and the budget lever is SIZE, not count: additive
    // overdraw is what killed Cosmic Noir on this lane, and a 0.5–1.1 u quad cannot overdraw
    // much no matter how many there are.
    let moteMesh = null;
    let moteMat = null;
    if (sunkPoints.length > 2) {
        const MOTES = 640;
        const mSeed = new Float32Array(MOTES);
        const mOrigin = new Float32Array(MOTES * 3);
        for (let i = 0; i < MOTES; i += 1) {
            const pt = sunkPoints[Math.floor((i / MOTES) * sunkPoints.length)];
            const h = (n) => {
                let v = Math.imul(n ^ 0x27d4eb2f, 2654435761);
                v = Math.imul(v ^ (v >>> 13), 1274126177);
                return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
            };
            mSeed[i] = h(i * 5 + 1);
            const a = h(i * 5 + 2) * Math.PI * 2;
            const r = 6 + (h(i * 5 + 3) * 64);
            const mx = pt.x + (Math.cos(a) * r);
            const mz = pt.z + (Math.sin(a) * r);
            let my = Math.min(pt.y + ((h(i * 5 + 4) - 0.35) * 90), ODYSSEY_SEA_LEVEL - 3);
            // WAVE 3 RESEAT — same rule as the fish: 267 motes were seeded under the seabed
            // and early-Z rejected. Lift only at open-water stations; shaft stations are
            // Wave 2's reseeding.
            if (pt.y > relief.sample(pt.x, pt.z) - 2) {
                my = Math.min(Math.max(my, relief.sample(mx, mz) + 2), ODYSSEY_SEA_LEVEL - 3);
            }
            mOrigin[i * 3] = mx;
            mOrigin[i * 3 + 1] = my;
            mOrigin[i * 3 + 2] = mz;
        }
        const moteGeo = makeQuadInstancedGeometry(MOTES, {
            aSeed: { array: mSeed, itemSize: 1 },
            aOrigin: { array: mOrigin, itemSize: 3 },
        });
        moteMat = new THREE.MeshBasicNodeMaterial();
        const mS = attribute('aSeed', 'float');
        const mO = attribute('aOrigin', 'vec3');
        // Constant-velocity drift upward with a slow sine sway; fract recycles each mote.
        const mRise = fract(uTime.mul(0.014).mul(mS.mul(0.5).add(0.6)).add(mS));
        const mSway = sin(uTime.mul(0.30).add(mS.mul(41))).mul(2.2);
        const moteCenter = vec3(
            mO.x.add(mSway),
            mO.y.add(mRise.mul(70)),
            mO.z.add(mSway.mul(0.7)),
        );
        // 0.5–1.1 u world size, AND screen-space capped (plan Wave 3): the reseat lifts 267
        // previously-buried motes into open water, so the additive fill they can spend is
        // clamped — a mote may never exceed ~1.2 degrees of screen no matter how close it
        // drifts to the eye. Far motes keep their world size (the min never binds).
        const moteSize = mS.mul(0.6).add(0.5);
        const moteDist = length(moteCenter.sub(cameraPosition));
        const moteSizeClamped = min(moteSize, moteDist.mul(0.02).add(0.04));
        moteMat.positionNode = billboardWorld(moteCenter, moteSizeClamped);
        const mUv = uv();
        const mRadial = float(1).sub(smoothstep(float(0.0), float(0.5), length(mUv.sub(vec2(0.5)))));
        // Transmitted light: brightness rises with depth below the surface, because the
        // background darkens with depth — the same inverse the vault's ember gate uses.
        const mDepth = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(120), 0, 1);
        moteMat.colorNode = mix(vec3(0.55, 0.85, 0.90), vec3(0.35, 0.75, 0.80), mDepth)
            .mul(mDepth.mul(0.9).add(0.35))
            .mul(uOutputScale);
        moteMat.opacityNode = mRadial.mul(mRadial).mul(uSubmerged).mul(0.42);
        moteMat.transparent = true;
        moteMat.depthWrite = false;
        moteMat.blending = THREE.AdditiveBlending;
        moteMat.fog = false;
        moteMesh = new THREE.Mesh(moteGeo, moteMat);
        moteMesh.frustumCulled = false;
        moteMesh.renderOrder = 4;
        moteMesh.name = 'odyssey-world-motes';
        group.add(moteMesh);
    }

    // ── fish (Wave 5: life, as silhouettes between the camera and the light) ──────
    // ABZU's documented technique, ported to TSL: instanced static meshes animated ENTIRELY
    // in the vertex stage with cosine waves — no skeletons, no CPU skinning, vertex-ALU only.
    // The deep-ocean chapter's old creatures failed as "flat dark polygons" because they swam
    // against the dark; these school ABOVE the rail, so the breach light behind them is what
    // makes a silhouette read (the same reason the levistone device needs darkness).
    let fishMesh = null;
    let fishMat = null;
    if (sunkPoints.length > 2) {
        const FISH = 110;
        // WAVE 3 HULL. The old wedge was 7 of the 9 triangles a closed shape needs (the rear
        // back and belly were simply absent) and was WIDER (0.32) than tall (0.26) — a fish
        // flattened along the wrong axis. This one is CLOSED and laterally compressed the way
        // fish are (taller than wide, 0.60 vs 0.26), widest a third back from the nose, with
        // a forked caudal fin and a raked dorsal. Still nose-to-tail along +Z, still cheap:
        // 11 triangles, vertex-only animation.
        const fishGeo = new THREE.BufferGeometry();
        const fp = [];
        const push = (...v) => fp.push(...v);
        const HX = 0.13; // half-width  (lateral compression: narrower than tall)
        const HY = 0.30; // half-height at the deepest point of the body
        push(0, 0, 2.1, HX, HY, 0.9, HX, -HY, 0.9); // nose right
        push(0, 0, 2.1, HX, -HY, 0.9, -HX, -HY, 0.9); // nose belly
        push(0, 0, 2.1, -HX, -HY, 0.9, -HX, HY, 0.9); // nose left
        push(0, 0, 2.1, -HX, HY, 0.9, HX, HY, 0.9); // nose back
        push(HX, HY, 0.9, 0, 0.02, -1.6, HX, -HY, 0.9); // flank right
        push(-HX, HY, 0.9, -HX, -HY, 0.9, 0, 0.02, -1.6); // flank left
        push(HX, HY, 0.9, -HX, HY, 0.9, 0, 0.02, -1.6); // back (was OPEN)
        push(HX, -HY, 0.9, 0, 0.02, -1.6, -HX, -HY, 0.9); // belly (was OPEN)
        push(0, 0.02, -1.6, 0, 0.36, -2.25, 0, 0.10, -1.95); // caudal upper lobe
        push(0, 0.02, -1.6, 0, -0.06, -1.95, 0, -0.32, -2.25); // caudal lower lobe
        push(0, HY, 0.85, 0, HY + 0.24, 0.35, 0, HY - 0.02, 0.15); // dorsal fin, raked aft
        fishGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
        fishGeo.computeVertexNormals();
        const fInst = new THREE.InstancedBufferGeometry();
        fInst.index = fishGeo.index;
        fInst.setAttribute('position', fishGeo.getAttribute('position'));
        fInst.setAttribute('normal', fishGeo.getAttribute('normal'));
        fInst.instanceCount = FISH;
        const fSeed = new Float32Array(FISH);
        const fOrigin = new Float32Array(FISH * 3);
        const fh = (n) => {
            let v = Math.imul(n ^ 0x51ed270b, 2654435761);
            v = Math.imul(v ^ (v >>> 13), 1274126177);
            return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
        };
        for (let i = 0; i < FISH; i += 1) {
            fSeed[i] = fh(i * 7 + 1);
            const pt = sunkPoints[Math.floor((i / FISH) * sunkPoints.length)];
            const a = fh(i * 7 + 2) * Math.PI * 2;
            const r = 14 + (fh(i * 7 + 3) * 52);
            const x = pt.x + (Math.cos(a) * r);
            const z = pt.z + (Math.sin(a) * r);
            // ABOVE the rail, below the surface: the band where a silhouette has light
            // behind it. Clamped to 8 u under the surface so no fish breaches.
            let y = Math.min(pt.y + 14 + (fh(i * 7 + 4) * 46), ODYSSEY_SEA_LEVEL - 8);
            // WAVE 3 RESEAT — out of the ROCK, not out of the shaft. 40 of 110 seeded below
            // the seabed (the sample disc lands in hillsides) and were early-Z'd invisible.
            // Lift ONLY fish whose rail STATION is open water: a station whose rail runs
            // under the world's terrain is the Act I shaft, and lifting those fish would put
            // them in the cavern — the exact leak Wave 2's reseeding owns.
            if (pt.y > relief.sample(pt.x, pt.z) - 2) {
                y = Math.min(Math.max(y, relief.sample(x, z) + 4), ODYSSEY_SEA_LEVEL - 8);
            }
            fOrigin[i * 3] = x;
            fOrigin[i * 3 + 1] = y;
            fOrigin[i * 3 + 2] = z;
        }
        fInst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(fSeed, 1));
        fInst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(fOrigin, 3));

        fishMat = new THREE.MeshBasicNodeMaterial();
        const fS = attribute('aSeed', 'float');
        const fO = attribute('aOrigin', 'vec3');
        // WAVE 3 SIZING (plan, from Wave 0's unit ruling): 1 u = 1 m, and the old scale
        // (1.2–2.8 over a 4.2 u hull) made every fish in the chapter a 5–12 m whale. The
        // school now spans ~1.7–3.2 m — creature-sized, not vessel-sized.
        const fScale = fS.mul(0.35).add(0.38);
        // Slow circular cruise around each fish's own origin — a school drifts, it does not
        // teleport. Radius and rate vary per seed so the school never phase-locks, and HALF
        // THE SCHOOL CIRCLES THE OTHER WAY (step on the seed): one global handedness read as
        // a carousel, not a school.
        const swimDir = tslStep(0.5, fS).mul(2).sub(1);
        const cruiseRate = fS.mul(0.16).add(0.10);
        const cruiseA = uTime.mul(cruiseRate).mul(swimDir).add(fS.mul(40));
        const cruiseR = fS.mul(9).add(5);
        const fishCenter = vec3(
            fO.x.add(cos(cruiseA).mul(cruiseR)),
            fO.y.add(sin(uTime.mul(0.4).add(fS.mul(17))).mul(1.6)),
            fO.z.add(sin(cruiseA).mul(cruiseR)),
        );
        // WAVE 3 SWIM (replaces the standing-wave flap, whose one phase for the whole body
        // was the loudest "not alive" signal there was). Three coupled terms, all closed-form
        // per-instance, all vertex-ALU, keyed on positionGeometry.z (the instancing-safe
        // local axis — r181's InstanceNode rewrites positionLocal before positionNode runs):
        //   1. TAIL BEAT COUPLED TO SPEED: linear speed is cruiseR*cruiseRate; beat frequency
        //      is ~1.3 beats per body-length of travel + an idle floor. The old code beat at
        //      0.8–1.1 Hz while covering 0.06–0.21 body-lengths/s — treading water furiously.
        //   2. TRAVELLING wave: the phase LAGS down the body (-z), so the bend propagates
        //      nose to tail; amplitude grows tailward with a small head-sway floor.
        //   3. BANKING: a body in a constant-radius turn rolls INTO it; bank angle rides
        //      v*omega (centripetal), signed by the circle's handedness.
        const bodyLen = fScale.mul(4.35);
        const vLin = cruiseR.mul(cruiseRate);
        const beatHz = vLin.div(bodyLen).mul(1.3).add(0.4);
        const swimPhase = uTime.mul(beatHz.mul(Math.PI * 2)).add(fS.mul(60));
        const waveAmp = clamp(float(0.9).sub(positionGeometry.z).mul(0.30), 0.06, 1.0);
        const wave = sin(swimPhase.sub(positionGeometry.z.mul(1.6)).mul(swimDir));
        const lx = positionGeometry.x.add(wave.mul(waveAmp).mul(0.22));
        const bank = vLin.mul(cruiseRate).mul(0.55).mul(swimDir.negate());
        const cb = cos(bank);
        const sb = sin(bank);
        const bx = lx.mul(cb).add(positionGeometry.y.mul(sb));
        const by = positionGeometry.y.mul(cb).sub(lx.mul(sb));
        // Heading = tangent of the cruise circle, so the fish faces where it swims — the
        // tangent flips with the circle's handedness.
        const heading = cruiseA.add(swimDir.mul(Math.PI / 2));
        const ch = cos(heading);
        const sh = sin(heading);
        const lz = positionGeometry.z;
        const rotated = vec3(
            bx.mul(ch).sub(lz.mul(sh)),
            by,
            bx.mul(sh).add(lz.mul(ch)),
        );
        fishMat.positionNode = fishCenter.add(rotated.mul(fScale));
        // WAVE 3 SHADING: still a silhouette-first body, but no longer a FLAT one. The world
        // normal comes from screen-space derivatives (instancing-safe — it needs no normal
        // attribute and survives the vertex-stage swim), the dorsal surface catches a touch
        // of down-welling light, and the whole body hands itself to applyAerial so a distant
        // fish fades into the SAME water colour as everything else instead of staying an
        // ink-black dart at any range.
        const fN = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
        const fDepth = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(120), 0, 1);
        const fBase = mix(vec3(0.045, 0.10, 0.13), vec3(0.02, 0.05, 0.08), fDepth);
        const fDorsal = clamp(fN.y, 0, 1).mul(float(1).sub(fDepth).mul(0.7).add(0.3));
        const fLit = fBase.add(vec3(0.10, 0.22, 0.26).mul(fDorsal));
        fishMat.colorNode = toOutput(applyAerial(fLit, positionWorld));
        fishMat.side = THREE.DoubleSide;
        fishMat.fog = false;
        fishMesh = new THREE.Mesh(fInst, fishMat);
        fishMesh.frustumCulled = false;
        fishMesh.renderOrder = 2;
        fishMesh.name = 'odyssey-world-fish';
        group.add(fishMesh);
        fishGeo.dispose();
    }

    // ── forest ──
    const treeGeo = buildTreeGeometry();
    const trees = scatterTrees(relief.sample, {
        cx: -220,
        cz: -620,
        radius: 1750,
        spacing: q.treeSpacing,
        seaLevel: ODYSSEY_SEA_LEVEL,
        snowStart: 640,
    });
    const CHUNK = 420;
    const buckets = new Map();
    trees.forEach((t) => {
        const key = `${Math.floor(t.x / CHUNK)}|${Math.floor(t.z / CHUNK)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(t);
    });

    const treeMat = new THREE.MeshBasicNodeMaterial();
    const gShade = attribute('aShade', 'float');
    const gPhase = attribute('aPhase', 'float');
    const gTint = attribute('aTint', 'float');
    const swayMask = clamp(positionGeometry.y.div(4.5), 0, 1);
    const gust = sin(uTime.mul(1.4).add(gPhase).add(positionWorld.x.mul(0.006)))
        .mul(0.10).mul(swayMask.mul(swayMask));
    // positionLocal, not positionGeometry: setupPosition() applies the instance matrix into
    // positionLocal and then positionNode REPLACES it, so building from the raw attribute
    // would discard the instance transform entirely.
    treeMat.positionNode = positionLocal.add(vec3(gust, 0, gust.mul(0.55)));
    const treeBase = mix(
        vec3(0.050, 0.105, 0.070),
        vec3(0.235, 0.375, 0.175),
        gShade.mul(0.75).add(gTint.mul(0.25)),
    );
    treeMat.colorNode = toOutput(applyAerial(
        treeBase.mul(uSunColour.mul(max(dot(normalWorld, uSunDir), 0).mul(0.35).add(0.55))
            .add(uShadowTint.mul(0.30))),
        positionWorld,
    ));

    const treeMeshes = [];
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    buckets.forEach((list) => {
        const n = list.length;
        const geo = treeGeo.clone();
        const aPhase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        const aTint = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        const mesh = new THREE.InstancedMesh(geo, treeMat, n);
        let cx = 0;
        let cz = 0;
        let maxY = -Infinity;
        let minY = Infinity;
        list.forEach((t, i) => {
            quat.setFromAxisAngle(axis, t.rot);
            pos.set(t.x, t.y, t.z);
            scl.set(t.scale, t.scale * (0.85 + (t.tint * 0.4)), t.scale);
            mesh.setMatrixAt(i, m4.compose(pos, quat, scl));
            aPhase.setX(i, t.rot * 3.7);
            aTint.setX(i, t.tint);
            cx += t.x;
            cz += t.z;
            maxY = Math.max(maxY, t.y + (t.scale * 5));
            minY = Math.min(minY, t.y);
        });
        geo.setAttribute('aPhase', aPhase);
        geo.setAttribute('aTint', aTint);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.boundingSphere = new THREE.Sphere(
            new THREE.Vector3(cx / n, (minY + maxY) / 2, cz / n),
            (CHUNK * 0.75) + ((maxY - minY) / 2) + 40,
        );
        mesh.frustumCulled = true;
        mesh.userData.centre = new THREE.Vector2(cx / n, cz / n);
        mesh.name = 'odyssey-world-forest-chunk';
        group.add(mesh);
        treeMeshes.push(mesh);
    });

    const t2 = (typeof performance !== 'undefined' ? performance.now() : 0);
    // The game puts a per-CHAPTER FogExp2 on the scene. Left on, it saturates the sky dome —
    // 3,600 units out is ~100% fogged at any density the chapters use — so the colour script
    // was never once visible in-game, and the ground got double-fogged on top of applyAerial.
    // These four materials carry their own aerial perspective; the scene fog is not theirs.
    [groundMat, waterMat, skyMat, treeMat, cloudMat].forEach((m) => { m.fog = false; });

    // What the scene fog SHOULD be, for everything the world does not draw (the path ribbon,
    // the level orbs, neighbouring chapters). Exposed so one horizon drives the whole frame
    // instead of the chapter profiles of chapters that no longer exist. Colour is pre-scaled
    // into the same output space the world's own materials write.
    const fogState = { color: new THREE.Color(), density: 0.0004 };
    // FogExp2 is 1-exp(-(d*z)^2); applyAerial is 1-exp(-K*z). Equal at z = FOG_MATCH_DISTANCE.
    const FOG_MATCH_DISTANCE = 1200;

    // LIVE STATE, for instruments only — never read by the renderer itself.
    // `uSubmerged` and the active colour-script keyframe are computed every frame and were
    // unreadable from outside, so a capture could not distinguish "the world believes it is
    // underwater" from "the world believes it is in air". That is precisely the question an
    // apparently-wrong submerged frame asks, and answering it by re-deriving the formula in
    // the harness would let the two copies drift.
    const state = { submerged: 0, scriptName: '', actT: 0 };

    const stats = {
        quality,
        groundTriangles: ground.triangles,
        waterTriangles: water.triangles,
        reach: ground.reach,
        trees: trees.length,
        forestChunks: treeMeshes.length,
        materials: clouds ? 5 : 4,
        applyExposure,
        outputScale,
        outputSaturation,
        clouds,
        godRays: rayCount > 2 ? rayCount : 0,
        motes: moteMesh ? 640 : 0,
        fish: fishMesh ? 110 : 0,
        skyRadius: domeRadius,
        bakeMs: { relief: +(t1 - t0).toFixed(1), total: +(t2 - t0).toFixed(1) },
    };

    return {
        group,
        stats,
        state,
        heightAt: relief.sample,
        fog: fogState,
        /**
         * @param {number} time seconds
         * @param {{x:number,y:number,z:number}} railPoint the GROUND-TRACK point — never the
         *   camera eye. Centring the lattice on the eye makes the ground change shape when
         *   only the camera moves (plan §3.1 point 4).
         * @param {number} progress 0..1 across Act II, for the colour script
         */
        update(time, railPoint, progress, eyeY = null) {
            uTime.value = time;
            uLodCenter.value.set(railPoint.x, railPoint.z);
            const scriptP = 0.05 + (Math.max(0, Math.min(1, progress)) * 0.9);
            const cs = sampleColourScript(scriptP);
            uSkyHorizon.value.setRGB(...cs.skyHorizon);
            uSkyZenith.value.setRGB(...cs.skyZenith);
            uSunColour.value.setRGB(...cs.sun);
            uShadowTint.value.setRGB(...cs.groundShadow);
            uAerialK.value = cs.fogDensity;
            // The depth plates come from the SCRIPT, not from constants beside it: shallow is
            // the shallows keyframe's body, mid is this sample's own body, deep is the abyss.
            // One table owns the ocean's colour, so a palette edit cannot desync the banding.
            // The MID plate's sample is clamped to the script's last WATER keyframe: past it
            // the horizon belongs to the breach's air sky, and the plates may never leave the
            // water table (see WATER_SCRIPT_END above).
            const csWater = scriptP > WATER_SCRIPT_END
                ? sampleColourScript(WATER_SCRIPT_END)
                : cs;
            uWaterShallow.value.setRGB(...SHALLOWS_BODY);
            uWaterMid.value.setRGB(...csWater.skyHorizon);
            uWaterDeep.value.setRGB(...ABYSS_BODY);
            uExposure.value = cs.exposure;
            const fogScale = (applyExposure ? cs.exposure : 1) * outputScale;
            const fogR = cs.skyHorizon[0] * fogScale;
            const fogG = cs.skyHorizon[1] * fogScale;
            const fogB = cs.skyHorizon[2] * fogScale;
            const fogL = (0.2126 * fogR) + (0.7152 * fogG) + (0.0722 * fogB);
            fogState.color.setRGB(
                fogL + ((fogR - fogL) * outputSaturation),
                fogL + ((fogG - fogL) * outputSaturation),
                fogL + ((fogB - fogL) * outputSaturation),
            );
            fogState.density = Math.sqrt(cs.fogDensity / FOG_MATCH_DISTANCE);
            // SUBMERSION IS THE EYE'S BUSINESS, NOT THE RAIL'S (MEASURED 2026-08-13).
            // This read `railPoint.y + 16`, but the eye does not sit above the rail: on a
            // climbing rail `computeFollowFrame` pulls it BACKWARDS along the tangent, so it
            // trails BELOW its rail point — measured -22.6 u at p=0.15 easing to -7.2 at
            // p=0.20. Bisected against the shipped spline, the rail crosses sea level at
            // p=0.19182 and the EYE at p=0.20023, while this expression reached zero at
            // p=0.18141. So for 0.0188 of progress — 17% of chapter 2, the entire final ascent
            // to the breach — the world rendered AIR while the camera was still under water:
            // air sky dome, air aerial perspective, cloud deck on, rays/motes/fish switched
            // off, and the water plane showing its topside from below.
            // Callers pass the real eye height; the old rail expression remains as the
            // fallback so no existing call site changes behaviour by omission.
            // The band widens 9 -> 14 u because the eye climbs ~11 u per 0.01 of progress near
            // the surface: 9 u resolved in under a hundredth of progress, which pops.
            const submergedRefY = Number.isFinite(eyeY) ? eyeY : (railPoint.y + 16);
            uSubmerged.value = Math.max(0, Math.min(
                1,
                (ODYSSEY_SEA_LEVEL + 2.0 - submergedRefY) / 14,
            ));
            uEyeDepth.value = Math.max(0, Math.min(1, (ODYSSEY_SEA_LEVEL - submergedRefY) / 140));
            uBreachNear.value = Math.max(0, 1 - (Math.abs(ODYSSEY_SEA_LEVEL - submergedRefY) / 3));
            // The deck's top read is only reachable once the eye is within the billow band:
            // deck plane 660, billow reaches ~116 below it, and `fromAboveF` needs another
            // 60 u before it leaves zero. Below that the GPU skips the whole top stack.
            uCloudTopLit.value = submergedRefY > (CLOUD_DECK_Y - 116 - 60) ? 1 : 0;
            // Publish what this frame decided, for instruments (see `state` above). Written
            // LAST so a reader can never observe a half-updated frame.
            state.submerged = uSubmerged.value;
            state.scriptName = cs.name;
            state.actT = progress;
            // WAVE 0's MEASURED DEFECT. `odyssey-world-clouds` was submitted and rasterised
            // at every fully-submerged station with its alpha provably zero (three texture
            // fetches per covered pixel of a sky-covering sheet, on the lane that measures
            // 7.73 ms), and the god-rays are the same bug inverted above the waterline. A
            // multiply by a zero uniform is NOT dead-code-eliminated — the repo has that
            // lesson logged — so the gate has to be a `visible` write on the CPU.
            if (cloudMesh) cloudMesh.visible = clouds && uSubmerged.value < 0.999;
            // THE FOREST IS SUBMITTED UNDER WATER AND CANNOT BE SEEN (MEASURED 2026-08-13).
            // The trees are legitimately the far SHORE -- scatterTrees rejects any site below
            // seaLevel + 3, and the lowest trunk seats at y=290.3 against sea level 287.31, so
            // none of this geometry is ever underwater. But while the eye is submerged every one
            // of them is occluded: tracing eye->treetop rays to their y = SEA_LEVEL crossing and
            // evaluating the water's own opacity there gives, at p=0.174, 2,057 hidden by opaque
            // water and 13,355 by terrain with ZERO potentially visible; at p=0.16, 841 / 14,569
            // and 2, both of which still sit behind water at 0.75 opacity a kilometre out. It
            // cannot be otherwise: for an eye D below the surface and a treetop T above it at
            // range X, the ray meets the water plane at X*D/(D+T) < X, always.
            // Meanwhile 5-13 chunks pass the frustum, submitting 1,537-4,697 tree instances and
            // 46k-141k triangles to be shaded and painted over -- 11 of the 45 draws measured at
            // p=0.16 are forest. A CPU visible gate is required: multiplying by a zero uniform
            // would not remove the draw.
            // NOTE the draw count changes, so the p=0.16 cell must be RE-BASELINED; a pair
            // across this change is not content-matched and cannot be compared.
            if (rayMesh) rayMesh.visible = uSubmerged.value > 0.001;
            if (moteMesh) moteMesh.visible = uSubmerged.value > 0.001;
            if (fishMesh) fishMesh.visible = uSubmerged.value > 0.001;
            const forestDrawable = uSubmerged.value < 0.999;
            for (let i = 0; i < treeMeshes.length; i += 1) {
                const c = treeMeshes[i].userData.centre;
                treeMeshes[i].visible = forestDrawable
                    && Math.hypot(c.x - railPoint.x, c.y - railPoint.z) < 1450;
            }
        },
        dispose() {
            group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
            [groundMat, waterMat, skyMat, treeMat, cloudMat].forEach((m) => m.dispose());
            if (rayMat) rayMat.dispose();
            if (moteMat) moteMat.dispose();
            if (moteMesh) moteMesh.geometry.dispose();
            if (rayMesh) rayMesh.geometry.dispose();
            [heightTex, sunVisTex, detailTex, macroTex].forEach((t) => t.dispose());
            treeGeo.dispose();
        },
    };
}
