import * as THREE from 'three/webgpu';
import {
    abs, attribute, clamp, cos, dFdx, dFdy, dot, exp, exp2, float, floor, fract, length, max,
    mix,
    normalize, normalWorld, positionGeometry, positionLocal, positionWorld, sin, smoothstep,
    texture, uniform, uv, varying, vec2, vec3, cameraPosition,
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
import { sampleColourScript } from '../odyssey-colour-script.js';

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
    const coarse = new Float32Array(res * res);
    for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) coarse[(j * res) + i] = vn(i, j, 1 / 96);
    }
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
 */
export function createOdysseyWorld({
    quality = 'high', applyExposure = true, outputScale = 1, outputSaturation = 1, clouds = true,
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
    const water = buildOdysseyClipmap({
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
    // The three water plates. Driven from the colour script's water keyframes so the ocean's
    // depth banding and the journey's palette can never drift apart (they are the same data).
    const uWaterShallow = uniform(new THREE.Color(0.29, 0.54, 0.69));
    const uWaterMid = uniform(new THREE.Color(0.10, 0.29, 0.42));
    const uWaterDeep = uniform(new THREE.Color(0.020, 0.105, 0.165));
    /** The dawn-gold kiss the crest SSS transmits — kept OUT of the air palette on purpose. */
    const uWaterGlow = uniform(new THREE.Color(0.88, 0.75, 0.50));

    const skyColourFor = (dirY) => mix(uSkyHorizon, uSkyZenith, clamp(dirY.mul(1.55).add(0.26), 0, 1));
    const DEEP_WATER = vec3(0.020, 0.105, 0.165);
    const applyAerial = (lit, wp) => {
        const to = wp.sub(cameraPosition);
        const d = length(to);
        const dirY = to.div(max(d, float(0.001))).y;
        const air = mix(lit, skyColourFor(dirY), clamp(float(1).sub(exp(d.mul(uAerialK.negate()))), 0, 0.82));
        const wT = clamp(float(1).sub(exp(d.mul(-0.0075))), 0, 0.97);
        const surfaceGlow = smoothstep(float(-0.15), float(0.75), dirY).mul(0.5);
        // BANDED DEPTH, not one exponential (plan §3.4.1 — Ponyo's stacked plates). Depth is
        // shown as discrete hue steps within one temperature family, which is how every
        // adopted reference does it and why none of them need grey scattering. The band index
        // comes from the fragment's own depth below the surface, so the column brightens
        // TOWARD the light instead of away from it — Phase 0 measured the shipped gradient
        // reading darker near the surface than at mid-depth.
        const depthBelow = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(160), 0, 1);
        const bandShallow = mix(uWaterShallow, uWaterMid, smoothstep(float(0.10), float(0.42), depthBelow));
        const banded = mix(bandShallow, uWaterDeep, smoothstep(float(0.45), float(0.92), depthBelow));
        const waterTarget = mix(banded, skyColourFor(float(0.5)).mul(0.45), surfaceGlow);
        const submergedCol = mix(lit.mul(vec3(0.42, 0.86, 1.0)), waterTarget, wT);
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
    const caustic = smoothstep(float(ODYSSEY_SEA_LEVEL), float(ODYSSEY_SEA_LEVEL - 7), height)
        .mul(clamp(
            snoise3(vec3(causticUv.x, causticUv.y, uTime.mul(0.2)))
                .add(snoise3(vec3(causticUv.x.mul(1.4), causticUv.y.mul(1.4), uTime.mul(-0.15))))
                .mul(0.5).add(0.5),
            0,
            1,
        ).pow(4.0))
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
    const skyWater = mix(
        DEEP_WATER.mul(0.5),
        skyColourFor(float(0.4)).mul(0.55),
        smoothstep(float(-0.25), float(0.85), skyDir.y),
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
    const swell = w.worldXZ.x.mul(0.010).add(uTime.mul(0.55)).sin()
        .mul(w.worldXZ.y.mul(0.013).sub(uTime.mul(0.4)).cos())
        .mul(0.55);
    waterMat.positionNode = vec3(w.worldXZ.x, float(ODYSSEY_SEA_LEVEL).add(swell), w.worldXZ.y);
    const wUv = varying(w.worldXZ.div(float(RELIEF_EXTENT)).add(0.5), 'vWUv');
    // Bed height from the macro BAKE — the analytic fold in a fragment-referenced varying was
    // the single largest cause of the minutes-long first compile (see bakeMacroTexture).
    const bedTex = texture(macroTex, wUv);
    const depth = float(ODYSSEY_SEA_LEVEL)
        .sub(bedTex.r.add(texture(heightTex, wUv).r.mul(bedTex.g))).toVar();
    const body = mix(
        mix(vec3(0.34, 0.70, 0.71), vec3(0.12, 0.42, 0.62), clamp(depth.div(18), 0, 1)),
        vec3(0.05, 0.22, 0.44),
        clamp(depth.sub(18).div(85), 0, 1),
    );
    const wN = normalize(vec3(swell.mul(-0.05), 1, swell.mul(0.04)));
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fb = float(1).sub(max(dot(wN, viewDir), 0));
    const fres = fb.mul(fb).mul(fb).mul(fb).mul(0.62);
    const spec = smoothstep(float(0.9955), float(0.9995), dot(normalize(uSunDir.add(viewDir)), wN)).mul(0.9);
    const wVis = texture(sunVisTex, wUv).r;
    let wl = mix(body, skyColourFor(float(0.22)), fres);
    wl = wl.add(vec3(1, 0.96, 0.88).mul(spec).mul(wVis)).mul(wVis.mul(0.18).add(0.82));
    wl = wl.add(vec3(0.92, 0.97, 0.99).mul(
        smoothstep(float(2.6), float(0.15), depth)
            .mul(smoothstep(float(-0.4), float(0.5), depth)).mul(0.55),
    ));
    // From BELOW the surface is a bright ceiling, not a body of water. FrontSide culled it and
    // the camera looked straight through the sea into the sky.
    // THE LUMINOUS CEILING (plan §3.4.2 — Sea of Thieves' wave-SSS approximation). From
    // below, a crest transmits light: mask = crest height x sun-facing x grazing. We have no
    // FFT, so the crest mask comes from the swell term already computed above — ~5 ALU, zero
    // new draws, and it is what makes the breach pay off instead of merely happening.
    const crestMask = clamp(swell.mul(1.6).add(0.35), 0, 1);
    const grazing = float(1).sub(clamp(abs(dot(wN, viewDir)), 0, 1));
    const sss = crestMask.mul(grazing).mul(clamp(dot(uSunDir, vec3(0, 1, 0)), 0, 1));
    const underside = skyColourFor(float(0.65)).mul(0.85)
        .add(vec3(1, 0.96, 0.88).mul(spec.mul(0.6)))
        .add(uWaterGlow.mul(sss).mul(0.55));
    waterMat.colorNode = toOutput(applyAerial(mix(wl, underside, uSubmerged), positionWorld));
    waterMat.opacityNode = clamp(smoothstep(float(-0.6), float(2.2), depth), 0, 1);
    waterMat.transparent = true;
    waterMat.depthWrite = false;
    waterMat.alphaTest = 0.004;
    waterMat.side = THREE.DoubleSide;
    const waterMesh = new THREE.Mesh(water.geometry, waterMat);
    waterMesh.frustumCulled = false;
    waterMesh.matrixAutoUpdate = false;
    waterMesh.updateMatrix();
    waterMesh.renderOrder = 1;
    waterMesh.name = 'odyssey-world-water';
    group.add(waterMesh);

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
    const vertDensity = texture(detailTex, cl.worldXZ.mul(0.00205).add(vec2(cloudDrift, 0)))
        .level(0).a.toVar();
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

    // Coverage is a property of the MAP, not of a chapter index. The rail runs inland and
    // upward as it climbs (z falls from the shore at +60 to the ascent at -700), so a deck
    // that thickens inland gives broken daylight cumulus over the valley and a solid sea
    // under the summit — the two things Ch3 and Ch4 each hand-authored — from one term.
    // The threshold is placed against the MEASURED distribution of the density field, not an
    // assumed one: sampled over the deck it runs p10 0.42 / p50 0.58 / p90 0.70, so a coverage
    // control expressed as "1 - cover" sat almost entirely above the field's own range and the
    // deck rendered empty. 0.63 leaves broken cumulus over the valley; 0.40 is a near-solid sea.
    const cloudThreshold = mix(
        float(0.63),
        float(0.40),
        smoothstep(float(-150), float(-760), cl.worldXZ.y),
    );
    const vThresh = varying(cloudThreshold, 'vThresh');
    const cUvA = varying(cl.worldXZ.mul(0.00205), 'vCUvA');
    const cUvB = varying(cl.worldXZ.mul(0.00560).add(vec2(0.31, 0.77)), 'vCUvB');
    const cUvC = varying(cl.worldXZ.mul(0.01420).add(vec2(0.58, 0.12)), 'vCUvC');
    const drift = uTime.mul(0.0016);
    const density = texture(detailTex, cUvA.add(vec2(drift, 0))).a.mul(0.52)
        .add(texture(detailTex, cUvB.add(vec2(drift.mul(1.7), 0))).b.mul(0.32))
        .add(texture(detailTex, cUvC).b.mul(0.16));

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
    const puff = smoothstep(vThresh, vThresh.add(puffBand), density);

    // Lit from above, shaded beneath, and the transition is the density itself: a thin edge
    // passes light and glows, a thick core does not. That single term is what separates a
    // cumulus from a grey disc, seen from either side.
    const cloudTop = uSunColour.mul(1.06).add(uSkyZenith.mul(0.10));
    // The base tone leans on the HORIZON colour, not the shadow tint. The first version was
    // shadow-tint-dominated, which the playground (no post stack) rendered as soft grey — and
    // the in-game grade (outputScale 0.82, ACES, chapter saturation 1.10) crushed into ragged
    // NAVY shards across Ch5's sky. Same lesson as the ground palette: the world hands the
    // grade a brighter, flatter colour than it wants on screen, because the grade adds the
    // punch. Capture-diagnosed at Ch5 eye height, 2026-08-12.
    const cloudBase = mix(
        uSkyHorizon.mul(0.88).add(uShadowTint.mul(0.30)),
        cloudTop,
        puff.oneMinus().mul(0.85),
    );
    const fromAbove = smoothstep(float(-60), float(90), cameraPosition.y.sub(float(CLOUD_DECK_Y)));
    const cloudCol = mix(cloudBase, cloudTop, fromAbove);
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
    cloudMat.opacityNode = puff.mul(rim).mul(nearFade).mul(bandFade)
        .mul(float(1).sub(uSubmerged))
        .mul(0.94);
    cloudMat.transparent = true;
    cloudMat.depthWrite = false;
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
    const rayCount = Math.min(22, sunkPoints.length);
    let rayMesh = null;
    let rayMat = null;
    if (rayCount > 2) {
        rayMat = new THREE.MeshBasicNodeMaterial();
        const rUv = uv();
        // Brightest where the shaft meets the surface, feathering to nothing as it descends;
        // soft lateral feather so the cone melts into the water instead of reading as a shape.
        const vFade = float(1).sub(rUv.y).pow(1.15);
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
        rayMat.opacityNode = vFade.mul(eFade).mul(rayNear).mul(rayShimmerSafe).mul(uSubmerged)
            .mul(0.55)
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
        rayMesh = new THREE.InstancedMesh(rayGeo, rayMat, rayCount);
        const rm4 = new THREE.Matrix4();
        const rPos = new THREE.Vector3();
        const rScl = new THREE.Vector3();
        for (let i = 0; i < rayCount; i += 1) {
            const pt = sunkPoints[Math.floor((i / rayCount) * sunkPoints.length)];
            const a = hash01(i * 3 + 1) * Math.PI * 2;
            const r = 18 + (hash01(i * 3 + 2) * 46);
            // Base (wide end) at the surface, apex feathering down toward the sea floor.
            rPos.set(pt.x + (Math.cos(a) * r), ODYSSEY_SEA_LEVEL - 96, pt.z + (Math.sin(a) * r));
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
            mOrigin[i * 3] = pt.x + (Math.cos(a) * r);
            mOrigin[i * 3 + 1] = Math.min(pt.y + ((h(i * 5 + 4) - 0.35) * 90), ODYSSEY_SEA_LEVEL - 3);
            mOrigin[i * 3 + 2] = pt.z + (Math.sin(a) * r);
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
        const moteSize = mS.mul(0.6).add(0.5); // 0.5–1.1 u — SIZE-capped, per the plan
        moteMat.positionNode = billboardWorld(moteCenter, moteSize);
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
        // A fish-shaped wedge: elongated diamond cross-section, nose to tail along +Z.
        const fishGeo = new THREE.BufferGeometry();
        const fp = [];
        const push = (...v) => fp.push(...v);
        // 6 triangles: a flattened rhomb (top/bottom) + tail fin. Body 2.4 long, 0.5 tall.
        // ASPECT RATIO IS THE SPECIES. The first capture rendered these as tumbling black
        // kites: a 1.2-long, 0.44-wide wedge reads as paper, not fish. A fish silhouette is
        // recognised almost entirely by elongation (3.5:1 here) with the widest point a third
        // back from the nose — the same "silhouette before detail" rule as every device in
        // this act.
        push(0, 0, 2.1, 0.16, 0.13, 0.7, 0.16, -0.13, 0.7); // nose upper-right
        push(0, 0, 2.1, 0.16, -0.13, 0.7, -0.16, -0.13, 0.7); // nose lower
        push(0, 0, 2.1, -0.16, -0.13, 0.7, -0.16, 0.13, 0.7); // nose left
        push(0, 0, 2.1, -0.16, 0.13, 0.7, 0.16, 0.13, 0.7); // nose upper
        push(0.16, 0.13, 0.7, 0, 0.02, -1.6, 0.16, -0.13, 0.7); // body-to-tail right
        push(-0.16, 0.13, 0.7, -0.16, -0.13, 0.7, 0, 0.02, -1.6); // body-to-tail left
        push(0, 0.30, -2.1, 0, 0.02, -1.6, 0, -0.26, -2.1); // tail fin (vertical blade)
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
            fOrigin[i * 3] = pt.x + (Math.cos(a) * r);
            // ABOVE the rail, below the surface: the band where a silhouette has light
            // behind it. Clamped to 8 u under the surface so no fish breaches.
            fOrigin[i * 3 + 1] = Math.min(pt.y + 14 + (fh(i * 7 + 4) * 46), ODYSSEY_SEA_LEVEL - 8);
            fOrigin[i * 3 + 2] = pt.z + (Math.sin(a) * r);
        }
        fInst.setAttribute('aSeed', new THREE.InstancedBufferAttribute(fSeed, 1));
        fInst.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(fOrigin, 3));

        fishMat = new THREE.MeshBasicNodeMaterial();
        const fS = attribute('aSeed', 'float');
        const fO = attribute('aOrigin', 'vec3');
        // Slow circular cruise around each fish's own origin — a school drifts, it does not
        // teleport. Radius and rate vary per seed so the school never phase-locks.
        const cruiseA = uTime.mul(fS.mul(0.12).add(0.06)).add(fS.mul(40));
        const cruiseR = fS.mul(9).add(5);
        const fishCenter = vec3(
            fO.x.add(cos(cruiseA).mul(cruiseR)),
            fO.y.add(sin(uTime.mul(0.4).add(fS.mul(17))).mul(1.6)),
            fO.z.add(sin(cruiseA).mul(cruiseR)),
        );
        // ABZU swim: yaw the whole body, pivot the tail harder — both cosine, both in the
        // vertex stage, keyed on positionGeometry.z (the instancing-safe local axis: r181's
        // InstanceNode rewrites positionLocal before positionNode runs).
        const swimPhase = uTime.mul(fS.mul(2.0).add(5.0)).add(fS.mul(60));
        const tailMask = clamp(positionGeometry.z.negate().mul(0.6).add(0.5), 0, 1);
        const yaw = sin(swimPhase).mul(0.12).add(sin(swimPhase).mul(tailMask).mul(0.35));
        // Heading = tangent of the cruise circle, so the fish faces where it swims.
        const heading = cruiseA.add(float(Math.PI / 2));
        const ch = cos(heading);
        const sh = sin(heading);
        const lx = positionGeometry.x.add(yaw);
        const lz = positionGeometry.z;
        const rotated = vec3(
            lx.mul(ch).sub(lz.mul(sh)),
            positionGeometry.y,
            lx.mul(sh).add(lz.mul(ch)),
        );
        const fScale = fS.mul(1.6).add(1.2);
        fishMat.positionNode = fishCenter.add(rotated.mul(fScale));
        // Silhouette shading: a dark body that takes only the faint down-welling light, so
        // against the bright ceiling it reads as a SHAPE — never a lit model.
        const fDepth = clamp(float(ODYSSEY_SEA_LEVEL).sub(positionWorld.y).div(120), 0, 1);
        fishMat.colorNode = mix(vec3(0.045, 0.10, 0.13), vec3(0.02, 0.05, 0.08), fDepth)
            .mul(uOutputScale);
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
        update(time, railPoint, progress) {
            uTime.value = time;
            uLodCenter.value.set(railPoint.x, railPoint.z);
            const cs = sampleColourScript(0.05 + (Math.max(0, Math.min(1, progress)) * 0.9));
            uSkyHorizon.value.setRGB(...cs.skyHorizon);
            uSkyZenith.value.setRGB(...cs.skyZenith);
            uSunColour.value.setRGB(...cs.sun);
            uShadowTint.value.setRGB(...cs.groundShadow);
            uAerialK.value = cs.fogDensity;
            // The depth plates come from the SCRIPT, not from constants beside it: shallow is
            // the shallows keyframe's body, mid is this sample's own body, deep is the abyss.
            // One table owns the ocean's colour, so a palette edit cannot desync the banding.
            uWaterShallow.value.setRGB(...SHALLOWS_BODY);
            uWaterMid.value.setRGB(...cs.skyHorizon);
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
            uSubmerged.value = Math.max(0, Math.min(
                1,
                (ODYSSEY_SEA_LEVEL + 4.5 - (railPoint.y + 16)) / 9,
            ));
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
            if (rayMesh) rayMesh.visible = uSubmerged.value > 0.001;
            if (moteMesh) moteMesh.visible = uSubmerged.value > 0.001;
            if (fishMesh) fishMesh.visible = uSubmerged.value > 0.001;
            for (let i = 0; i < treeMeshes.length; i += 1) {
                const c = treeMeshes[i].userData.centre;
                treeMeshes[i].visible = Math.hypot(c.x - railPoint.x, c.y - railPoint.z) < 1450;
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
