/**
 * GROUND BAKES — the painter, run once at boot.
 *
 * The ground plan's central move: colour STRUCTURE is authored world data baked into
 * textures, and the fragment graph is only the brush. This is the same architecture The
 * Witness landed on after abandoning blend-mapped terrain colour — "Shannon painted a
 * 2048x2048 texture of the island" — except that with no artist in the loop the painting is
 * done by world LOGIC (concavity, altitude, sea proximity, sun aspect) rather than by hand.
 * That substitution is not a compromise: it is what the premium-terrain analysis calls the
 * difference between "height bands" and "a place".
 *
 * TWO BAKES LIVE HERE.
 *
 * 1. `bakeGroundSunFields` — the WORLD-ANCHORED plate, at the shadow resolution, sampled at
 *    the ground's `vUv`. It replaces the old single-channel sun-visibility bake and is the
 *    plan's free ride: R keeps its exact former meaning and its exact former math (water
 *    reads it too, and a silent change there would be a second, quieter opinion about where
 *    the sun is), while G, B and A were three unused channel slots on a fetch the ground
 *    fragment ALREADY pays for. Widening a texture that is already sampled costs nothing per
 *    pixel — the same trick the relief bake's curvature channel used ("the channel was
 *    already allocated and written as a literal zero").
 *
 * 2. `bakeGroundAtlas` — the TILING plate: one small texture whose four channels are the four
 *    material families' mesostructure. Applied Wolfire-style (see `GROUND_ATLAS_AVG`), so the
 *    tile can never shift the painted colour — only add texture to it.
 *
 * Both are pure functions of the height field and a seeded lattice noise, so both are
 * deterministic and testable without a GPU (odyssey-ground-bakes.test.js).
 */

// 'three' CORE, not 'three/webgpu': this module is imported by the world-bake Worker
// (odyssey-world-bake.worker.js), which must not pull the WebGPU renderer + TSL graph. Every
// symbol used here (DataTexture, DataUtils, formats, filters) is core.
import * as THREE from 'three';

import { ODYSSEY_SEA_LEVEL } from './odyssey-world-height.js';
import { createTilingValueNoise } from './odyssey-tiling-noise.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';

/** The bakes span the same square the relief bake does. Kept in sync by import in the tests. */
export const GROUND_BAKE_EXTENT = 9000;

/**
 * WIDE-RADIUS AMBIENT OCCLUSION — the term the Witness got from its lightmapper and we do not
 * have. Their whole ground look leans on "big soft baked gradients on open surfaces"; ours had
 * only `cavity`, a gully term derived from the relief bake's Laplacian, which by construction
 * sees only what a single texel-step can see. This is the OTHER half of the same idea at two
 * landform radii, and the one-owner split is explicit: AO owns everything wider than ~9 u,
 * `cavity` keeps everything below it.
 *
 * Not a hemisphere integral — a horizon-openness estimate, which is all a heightfield needs:
 * compare the texel's height to the mean of a ring around it, normalised by the ring radius so
 * the result is a dimensionless slope rather than a number of metres.
 */
const AO_RADII = Object.freeze([9, 64]);
const AO_DIRS = 8;
/** How dark the deepest hollow is allowed to get. Ghibli shadows pool; they do not black out. */
const AO_FLOOR = 0.56;

/**
 * MOISTURE — the field that decides where each material sits between its two palette poles.
 *
 * Every term is a piece of landscape logic, in the Fletcher-Studio sense that made The
 * Witness's terrain feel designed rather than generated: water collects in hollows, low
 * ground is damper than high ground, the sea wets its own margin, and a slope that faces the
 * sun all day dries out. The output is 0 (bone dry) to 1 (lush/damp).
 */
const MOISTURE = Object.freeze({
    base: 0.24,
    concavity: 0.85,
    lowland: 0.22,
    /** How far above the sea the shore's damp margin reaches. */
    shore: 46,
    shoreGain: 0.18,
    /** Sun-facing slopes dry out — the "exposure" half of the aspect term. */
    exposure: 0.34,
    /**
     * Altitude ramp: fully dry this far above the waterline.
     *
     * 420 u put the ENTIRE ch4 massif station on the dry pole — every visible slope golden,
     * one hue family across the whole frame with the autumn forest on top of it. The reference
     * islands are green at altitude with golden PATCHES; altitude should bias the field, not
     * decide it, so the ramp now outruns the terrain the rail actually crosses and local
     * concavity carries most of the variegation.
     */
    altitudeSpan: 980,
});

/**
 * THE LAND STRETCH — why this field is histogram-remapped and the others are not.
 *
 * The bake covers a 9,000 u square of which the island is a small part; everything else is
 * ocean, and ocean is flat, low and next to the sea, so it pins every moisture term at once.
 * MEASURED on the first cut: the raw field ran p10 0.687 / p50 0.920 over the whole plate —
 * the entire island sat inside the top decile and the palette's two poles collapsed onto one.
 * Absolute terms alone cannot fix that, because the useful range is a property of the terrain,
 * not of the constants: any hand-tuned balance would drift the moment the height field moves.
 *
 * So the terms decide the ORDERING and a percentile stretch over LAND texels decides the
 * range. That is the same instrument the cloud silhouette uses (histogram matching), for the
 * same reason, and it makes the field's contrast a guaranteed property rather than a hope.
 * The percentiles are wide (5/95) so a handful of extreme hollows cannot rescale the island.
 */
const FIELD_STRETCH = Object.freeze([0.05, 0.95]);

/**
 * THE ZONE FIELD (A channel) — regional colour personality.
 *
 * The Witness gave each area of the island its own palette ("different locations would have
 * very different color palettes… this would help cement the locations' individual
 * personalities") and interpolated the light colour as the player walked between them. This
 * is that, at the cheapest possible fidelity: one smooth scalar over the island that warms or
 * cools every material's poles. Two irrational-ish wavelengths so the lobes never line up
 * into a visible grid, and a slow diagonal term so the drift crosses the rail rather than
 * running parallel to it.
 */
function zoneAt(x, z) {
    const a = Math.sin((x / 880) + 0.7) * Math.cos((z / 1150) - 0.4);
    const b = Math.sin(((x + z) / 1930) + 2.1);
    const c = Math.cos((x / 3100) - (z / 2400));
    return 0.5 + (a * 0.26) + (b * 0.18) + (c * 0.12);
}

/**
 * Deciles of a field, logged at bake time so a rebake cannot silently flatten it.
 *
 * `mask` is not optional decoration. Over the whole 9,000 u plate the island is a minority of
 * texels and the ocean pins every one of these fields at its extreme, so unmasked deciles
 * report "flat" for a field that is perfectly well spread where anyone can see it. Every
 * statistic this bake publishes is therefore a LAND statistic.
 */
function fieldStats(field, mask) {
    const kept = mask ? field.filter((_, k) => mask[k]) : Float32Array.from(field);
    if (!kept.length) return { p10: 0, p50: 0, p90: 0 };
    const sorted = Float32Array.from(kept).sort();
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { p10: at(0.10), p50: at(0.50), p90: at(0.90) };
}

/** Percentile of a masked field, for the stretches. */
function maskedPercentile(field, mask, q) {
    const kept = Float32Array.from(field.filter((_, k) => mask[k])).sort();
    if (!kept.length) return q;
    return kept[Math.min(kept.length - 1, Math.floor(q * kept.length))];
}

/**
 * Remap a field so its land percentiles span [0, 1], in place.
 *
 * Applied to all three authored channels, each for a MEASURED reason found by probing the
 * first cut rather than by taste:
 *  - moisture ran p10 0.687 / p50 0.920 raw — the whole island inside one decile;
 *  - wide occlusion ran p10 0.965 on land, i.e. a term that did nothing at all, because the
 *    dimensionless ring difference on this terrain is a few hundredths and any fixed gain
 *    that fixed it here would be wrong for the next height-field edit;
 *  - the zone field ran 0.742..0.918 across the island, because the island occupies a small
 *    and not-especially-varied part of the lobes' domain.
 * In every case the TERMS carry the meaning (which places are damp, hollow, warm) and the
 * stretch carries only the contrast.
 */
function stretchToLand(field, mask, lo = FIELD_STRETCH[0], hi = FIELD_STRETCH[1]) {
    const a = maskedPercentile(field, mask, lo);
    const b = maskedPercentile(field, mask, hi);
    const span = Math.max(1e-4, b - a);
    for (let k = 0; k < field.length; k += 1) {
        field[k] = Math.max(0, Math.min(1, (field[k] - a) / span));
    }
}

/**
 * THE WORLD PLATE — [sun visibility, wide AO, moisture, zone] at the shadow resolution.
 *
 * @param {(x:number,z:number)=>number} heightAt CPU mirror of the drawn height
 * @param {number} shadowRes texture resolution
 * @returns {{tex: THREE.DataTexture, stats: object}}
 */
/**
 * Pure half of {@link bakeGroundSunFields}: the four fields packed as RGBA half floats, no three
 * object. Worker-safe; byte-identical to what the wrapper uploads (golden suite).
 * @param {(x: number, z: number) => number} heightAt
 * @param {number} shadowRes
 * @returns {{data: Uint16Array, res: number, stats: object}}
 */
export function bakeGroundSunFieldsData(heightAt, shadowRes) {
    const len = Math.hypot(...ODYSSEY_WORLD_SUN);
    const [sx, sy, sz] = ODYSSEY_WORLD_SUN.map((v) => v / len);
    const horiz = Math.hypot(sx, sz) || 1e-4;
    const dirX = sx / horiz;
    const dirZ = sz / horiz;
    const rise = sy / horiz;
    const step = GROUND_BAKE_EXTENT / shadowRes;
    const origin = -GROUND_BAKE_EXTENT / 2;

    // ── R: sun visibility. UNCHANGED MATH, deliberately — see the header. ──
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

    /**
     * ── G/B: openness at two radii, and the moisture field derived from it ──
     *
     * COMPUTED AT HALF RESOLUTION and bilinearly expanded, which is not a corner cut but a
     * statement about what these fields ARE. Both are landform-scale by construction — the
     * rings that build them span 9 u and 64 u, so nothing they can express varies faster than
     * the coarse grid samples it. The sun channel above is different and stays at full
     * resolution: a shadow edge is a discontinuity, and those alias.
     *
     * MEASURED, which is why it is here: at full resolution the ring sampling added 167 ms to
     * boot (16 extra height lookups per texel over 512² = 4.2 M) against the 77 ms the legacy
     * sun march cost on its own. Cold start is a tracked sore in this repo, so a 4x saving on
     * a field that cannot use the resolution is worth the twenty lines.
     */
    const coarse = Math.max(2, shadowRes >> 1);
    const cStep = GROUND_BAKE_EXTENT / coarse;
    const cAo = new Float32Array(coarse * coarse);
    const cMoist = new Float32Array(coarse * coarse);
    const cosD = new Float32Array(AO_DIRS);
    const sinD = new Float32Array(AO_DIRS);
    for (let d = 0; d < AO_DIRS; d += 1) {
        const a = (d / AO_DIRS) * Math.PI * 2;
        cosD[d] = Math.cos(a);
        sinD[d] = Math.sin(a);
    }
    for (let j = 0; j < coarse; j += 1) {
        const z0 = origin + (j * cStep);
        for (let i = 0; i < coarse; i += 1) {
            const x0 = origin + (i * cStep);
            const h0 = heightAt(x0, z0);
            let openSum = 0;
            let concavity = 0;
            // The gradient falls out of the near ring for free — no extra samples for aspect.
            let gx = 0;
            let gz = 0;
            AO_RADII.forEach((r, ri) => {
                let ring = 0;
                for (let d = 0; d < AO_DIRS; d += 1) {
                    const h = heightAt(x0 + (cosD[d] * r), z0 + (sinD[d] * r));
                    ring += h;
                    if (ri === 0) {
                        gx += cosD[d] * (h - h0);
                        gz += sinD[d] * (h - h0);
                    }
                }
                ring /= AO_DIRS;
                // Dimensionless: positive means the surroundings stand ABOVE us (a hollow).
                const rel = Math.max(-1, Math.min(1, ((ring - h0) / r) * 2.2));
                openSum += ri === 0 ? rel * 0.45 : rel * 0.55;
                if (ri === 1) concavity = Math.max(0, rel);
            });
            // Raw openness for now — the stretch below decides the range, and only then is
            // it mapped onto [AO_FLOOR, 1]. Storing the mapped value first would stretch a
            // field that had already been compressed into the floor.
            cAo[(j * coarse) + i] = -openSum;

            const above = h0 - ODYSSEY_SEA_LEVEL;
            const lowland = 1 - Math.max(0, Math.min(1, above / MOISTURE.altitudeSpan));
            const shore = 1 - Math.max(0, Math.min(1, above / MOISTURE.shore));
            const gl = Math.hypot(gx, gz) || 1e-5;
            // Aspect: the surface normal's horizontal lean against the sun's bearing. The
            // gradient points UPHILL, so a slope facing the sun has -grad aligned with it.
            const exposure = Math.max(0, ((-gx / gl) * dirX) + ((-gz / gl) * dirZ))
                * Math.min(1, gl / (AO_RADII[0] * 0.5));
            const damp = MOISTURE.base
                + (concavity * MOISTURE.concavity)
                + (lowland * MOISTURE.lowland)
                + (shore * MOISTURE.shoreGain)
                - (exposure * MOISTURE.exposure);
            cMoist[(j * coarse) + i] = Math.max(0, Math.min(1, damp));
        }
    }

    // Expand to the plate's resolution. The land mask is evaluated at FULL resolution from the
    // height mirror rather than upsampled: it gates the percentile stretches, and a coastline
    // smeared across two coarse texels would let ocean values into the land statistics.
    const ao = new Float32Array(shadowRes * shadowRes);
    const moisture = new Float32Array(shadowRes * shadowRes);
    const land = new Uint8Array(shadowRes * shadowRes);
    const bilinear = (src, u, v) => {
        const gu = Math.max(0, Math.min(coarse - 1.001, u));
        const gv = Math.max(0, Math.min(coarse - 1.001, v));
        const i0 = Math.floor(gu); const j0 = Math.floor(gv);
        const fu = gu - i0; const fv = gv - j0;
        const i1 = Math.min(coarse - 1, i0 + 1); const j1 = Math.min(coarse - 1, j0 + 1);
        const a = src[(j0 * coarse) + i0]; const b = src[(j0 * coarse) + i1];
        const c = src[(j1 * coarse) + i0]; const dd = src[(j1 * coarse) + i1];
        return (((a * (1 - fu)) + (b * fu)) * (1 - fv)) + (((c * (1 - fu)) + (dd * fu)) * fv);
    };
    for (let j = 0; j < shadowRes; j += 1) {
        const v = (j * step) / cStep;
        const z0 = origin + (j * step);
        for (let i = 0; i < shadowRes; i += 1) {
            const u = (i * step) / cStep;
            const k = (j * shadowRes) + i;
            ao[k] = bilinear(cAo, u, v);
            moisture[k] = bilinear(cMoist, u, v);
            land[k] = heightAt(origin + (i * step), z0) > (ODYSSEY_SEA_LEVEL - 1) ? 1 : 0;
        }
    }

    // The stretches: land percentiles decide the range, the terms decided the ordering.
    stretchToLand(moisture, land);
    stretchToLand(ao, land);
    for (let k = 0; k < ao.length; k += 1) ao[k] = AO_FLOOR + ((1 - AO_FLOOR) * ao[k]);

    // ── pack, with the same 3x3 blur the sun channel has always had ──
    const at = (buf, i, j) => buf[(Math.max(0, Math.min(shadowRes - 1, j)) * shadowRes)
        + Math.max(0, Math.min(shadowRes - 1, i))];
    const blurred = (buf, i, j) => {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj += 1) {
            for (let di = -1; di <= 1; di += 1) sum += at(buf, i + di, j + dj);
        }
        return sum / 9;
    };
    const zone = new Float32Array(shadowRes * shadowRes);
    for (let j = 0; j < shadowRes; j += 1) {
        const z0 = origin + (j * step);
        for (let i = 0; i < shadowRes; i += 1) {
            zone[(j * shadowRes) + i] = zoneAt(origin + (i * step), z0);
        }
    }
    stretchToLand(zone, land);

    const data = new Uint16Array(shadowRes * shadowRes * 4);
    for (let j = 0; j < shadowRes; j += 1) {
        for (let i = 0; i < shadowRes; i += 1) {
            const idx = ((j * shadowRes) + i) * 4;
            data[idx] = THREE.DataUtils.toHalfFloat(blurred(raw, i, j));
            data[idx + 1] = THREE.DataUtils.toHalfFloat(blurred(ao, i, j));
            data[idx + 2] = THREE.DataUtils.toHalfFloat(blurred(moisture, i, j));
            data[idx + 3] = THREE.DataUtils.toHalfFloat(zone[(j * shadowRes) + i]);
        }
    }
    return {
        data,
        res: shadowRes,
        stats: {
            sun: fieldStats(raw, land),
            ao: fieldStats(ao, land),
            moisture: fieldStats(moisture, land),
            zone: fieldStats(zone, land),
            landTexels: land.reduce((a, b) => a + b, 0),
        },
    };
}

/**
 * Wrap baked RGBA half-float texels as the ground plate texture (clamped, linear, no mips).
 * @param {Uint16Array} data
 * @param {number} res
 */
export function wrapGroundSunFieldsTexture(data, res) {
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

export function bakeGroundSunFields(heightAt, shadowRes, baked = null) {
    const d = baked ?? bakeGroundSunFieldsData(heightAt, shadowRes);
    return { tex: wrapGroundSunFieldsTexture(d.data, d.res), stats: d.stats };
}

/**
 * THE TILING ATLAS — one texture, four material mesostructures.
 *
 * Each channel is authored as a DIFFERENT KIND of mark, which is the whole point: the Witness
 * rock post is explicit that material identity comes from contrasting shape languages
 * ("foliage has a different language, as does rolling terrain, and hard architectural
 * surfaces… it helps inform the player what materials the surfaces are made from"), and the
 * measured bar says the same thing in numbers — Firewatch grass alternates 2.5-3x within one
 * patch (directional strokes, dark base and light tips) while paths and sand hills sit inside
 * +-5..12 luma (flat fills, no gravel noise anywhere in either game).
 *
 *   R — grass: anisotropic strokes, clustered, with real internal value range.
 *   G — rock:  a crossing fracture web (min of two perpendicular streak fields), which is
 *              what gives a cliff its angular marks rather than blobby mottle.
 *   B — sand:  long parallel ripples with a noise-wobbled phase; low contrast by mandate.
 *   A — tooth: a plain mid-frequency field, shared. Two jobs: the generic near-field grain,
 *              and the HEIGHT term that biases every biome boundary (sand fills between grass
 *              tufts, rock pokes through thin snow) instead of cross-fading.
 *
 * ANISOTROPY AND TILING. The streaks are made by scaling the lattice coordinate by an INTEGER
 * factor before sampling. That matters: `createTilingValueNoise` wraps its hash at the cell
 * count, so a coordinate scaled by any integer still lands on a cell boundary at the texture
 * edge and the tile closes. A non-integer stretch would reintroduce exactly the seam the
 * cloud silhouette shipped (measured 48x the interior step), so the factors below are whole
 * numbers and the tiling test compares texel 255 against texel 0 — never against texel 256.
 */
export const GROUND_ATLAS_RES = 256;
/** World units per atlas repeat. ~22 u puts the grass strokes at a readable near-field scale. */
export const GROUND_ATLAS_WORLD = 22;

function normaliseInPlace(field) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < field.length; k += 1) {
        if (field[k] < lo) lo = field[k];
        if (field[k] > hi) hi = field[k];
    }
    const span = hi - lo || 1;
    let sum = 0;
    for (let k = 0; k < field.length; k += 1) {
        field[k] = (field[k] - lo) / span;
        sum += field[k];
    }
    return sum / field.length;
}

/**
 * @param {number} [res]
 * @returns {{tex: THREE.DataTexture, avg: number[], fields: Float32Array[]}}
 *   `avg` is the per-channel mean — the Wolfire denominator. The shader multiplies albedo by
 *   `tile / avg`, whose own mean is 1 by construction, so tiled detail adds mesostructure and
 *   can NEVER shift the painted macro colour. That division is the exact technique The Witness
 *   adopted from Wolfire ("the repeating detail texture is color-corrected so that its average
 *   color corresponds to the whole-island-color-map's color at that position") and it is the
 *   difference between detail that decorates the paint and detail that overwrites it.
 */
/**
 * Pure half of {@link bakeGroundAtlas}. Worker-safe; byte-identical to the wrapper's upload.
 * @param {number} [res]
 * @returns {{data: Uint16Array, res: number, avg: number[], fields: Float32Array[]}}
 */
export function bakeGroundAtlasData(res = GROUND_ATLAS_RES) {
    const vn = createTilingValueNoise(res);
    const n = res * res;
    const grass = new Float32Array(n);
    const rock = new Float32Array(n);
    const sand = new Float32Array(n);
    const tooth = new Float32Array(n);

    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
            const k = (j * res) + i;

            // GRASS. Two stroke fields at PERPENDICULAR stretches, chosen between by a
            // low-frequency mask, so the stroke direction varies from patch to patch. One
            // orientation is not a shortcut for two: the first bake stretched along z only and
            // the near-field capture read as corduroy — regular parallel lines across the whole
            // meadow — where the painting guides are explicit that grass strokes go in "varied
            // angle/direction". The same low mask also clusters the tufts and drops the floor
            // between them, which is where the measured dark base of the stroke alternation
            // comes from (Firewatch grass runs 2.5-3x p10 to p90 inside a single patch).
            const clump = vn(i, j, 1 / 32);
            const lean = vn(i, j, 1 / 16);
            const alongZ = (vn(i, j * 7, 1 / 16) * 0.62) + (vn(i * 3, j * 13, 1 / 8) * 0.38);
            const alongX = (vn(i * 7, j, 1 / 16) * 0.62) + (vn(i * 13, j * 3, 1 / 8) * 0.38);
            const strokes = (alongZ * lean) + (alongX * (1 - lean));
            grass[k] = (strokes * (0.55 + (clump * 0.75))) + (clump * 0.22);

            // ROCK. Two perpendicular streak fields, intersected. `min` keeps only where BOTH
            // are dark, which draws lines rather than patches — the same reason the caustic web
            // uses a minimum instead of a sum.
            const along = vn(i * 8, j, 1 / 16);
            const across = vn(i, j * 8, 1 / 16);
            const fracture = Math.min(along, across);
            rock[k] = (fracture * 0.72) + (vn(i * 2, j * 2, 1 / 8) * 0.28);

            // SAND. Six ripple periods across the tile (integer, so it closes), phase-wobbled
            // by noise. Deliberately shallow: the references show beaches as flat fills.
            const wobble = vn(i, j, 1 / 16) * 2.6;
            sand[k] = 0.5 + (0.5 * Math.sin(((i / res) * Math.PI * 12) + wobble));

            // TOOTH. Plain, isotropic, mid-frequency — the shared grain and the boundary height.
            tooth[k] = (vn(i, j, 1 / 16) * 0.58) + (vn(i, j, 1 / 8) * 0.42);
        }
    }

    const avg = [
        normaliseInPlace(grass),
        normaliseInPlace(rock),
        normaliseInPlace(sand),
        normaliseInPlace(tooth),
    ];

    const data = new Uint16Array(n * 4);
    for (let k = 0; k < n; k += 1) {
        data[(k * 4)] = THREE.DataUtils.toHalfFloat(grass[k]);
        data[(k * 4) + 1] = THREE.DataUtils.toHalfFloat(rock[k]);
        data[(k * 4) + 2] = THREE.DataUtils.toHalfFloat(sand[k]);
        data[(k * 4) + 3] = THREE.DataUtils.toHalfFloat(tooth[k]);
    }
    return {
        data, res, avg, fields: [grass, rock, sand, tooth],
    };
}

/** Wrap baked atlas texels as the repeating ground atlas texture (linear, no mips). */
export function wrapGroundAtlasTexture(data, res) {
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // NO MIPMAPS, matching the detail bake next door. The atlas is melted to nothing by the
    // distance envelope long before minification could alias it (that envelope is a look
    // requirement first — "from far away, the grain melts away and the structure is mostly a
    // solid color" — and the aliasing defence falls out of it for free), and asking the WebGPU
    // backend to generate a mip chain for a half-float DataTexture is a validation risk this
    // surface does not need to take.
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

export function bakeGroundAtlas(res = GROUND_ATLAS_RES, baked = null) {
    const d = baked ?? bakeGroundAtlasData(res);
    return { tex: wrapGroundAtlasTexture(d.data, d.res), avg: d.avg, fields: d.fields };
}
