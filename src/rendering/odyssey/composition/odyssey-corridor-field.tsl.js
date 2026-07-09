/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Odyssey Corridor Depth Field — TSL (WebGPU) material builders.
 *
 * Part of the Odyssey Visual Cohesion master plan (Phase A, batch 2 — UNIT A2).
 * See docs/ODYSSEY_VISUAL_COHESION_MASTER_PLAN.md.
 *
 * Sibling helper for composition/odyssey-corridor-field.js. It holds the two reusable
 * NodeMaterial builders the corridor field instances per chapter:
 *
 *   • createCorridorSheetMaterial — a large parallax backdrop SHEET (PlaneGeometry):
 *     an FBM nebula/haze field tinted from the chapter palette, radially feathered to
 *     0 alpha before the quad edge so no rectangular border shows. Used for nebula
 *     sheets (cosmic), hazy cloud banks (aerial), depth murk / silhouette bands
 *     (terrestrial), and far building-silhouette sheets (urban).
 *
 *   • createCorridorParticulateMaterial — instanced camera-facing billboard quads
 *     (via makeQuadInstancedGeometry + billboardWorld) for the volumetric particulate
 *     that surrounds the camera: stars/dust (cosmic), motes (black hole), city-light
 *     bokeh (urban), drifting haze flecks (terrestrial/aerial). Round, soft, feathered.
 *
 * Both expose a per-instance / per-sheet `uOpacity` uniform the corridor field drives
 * each frame for the chapter cross-fade, plus a shared `uTime` for drift. WebGPU/TSL
 * only (MeshBasicNodeMaterial). They run on the WebGPURenderer and its WebGL2 fallback.
 *
 * ── PERF (Odyssey Performance plan §3b "Bake FBM to a texture") ──────────────────────
 * The sheet field used to recompute three full 5-octave `fbm2` evaluations PER PIXEL,
 * PER LAYER, EVERY FRAME — pure fill-rate burn for a field whose lattice is static.
 * It is now BAKED ONCE into a shared, tileable single-channel DataTexture
 * (`getCorridorFbmTexture`) and SAMPLED in-shader (3 texture fetches replacing ~45
 * noise-octave evaluations per pixel). The animated drift is preserved by offsetting
 * the texture UV with `uTime`; the per-sheet `scale` becomes a UV multiply into the
 * tiling field, so every recipe keeps its exact frequency/look. One texture is shared
 * across ALL chapters' sheets, so the bake cost (one DataTexture upload) is paid once.
 */

import * as THREE from 'three/webgpu';
import {
    Discard,
    abs,
    attribute,
    clamp,
    float,
    length,
    mix,
    oneMinus,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import { billboardWorld, makeQuadInstancedGeometry } from '../chapter-environments/shared/odyssey-tsl-billboard.js';

// Alpha below this contributes no visible glow but still costs a shaded+blended pixel.
// `Discard` it so the GPU skips the blend (overdraw saving on feathered corners / vacuum).
const ALPHA_DISCARD = 0.01;

// ── Baked FBM field (shared, tileable, built once) ───────────────────────────────────
//
// The corridor sheet field is a sum of 5-octave `fbm2` lobes. Re-deriving that per pixel
// every frame is the corridor's single biggest fill cost. Instead we bake one tileable
// scalar `fbm2` field over a generous UV domain and sample it three times in the shader
// (matching the three lobes the old per-pixel path computed). The CPU FBM below is a
// faithful mirror of the TSL/GLSL `fbm2` (shared/odyssey-tsl-noise.js): same hash21,
// same value-noise lattice, same rotation mat2(0.80,0.60,-0.60,0.80), lacunarity 2.02,
// 5 octaves, amplitude 0.5 — so the baked field matches the live shader's look.

// Domain (in sheet-UV units) the field is baked over. The largest recipe `scale` is ~4.6
// and the largest in-shader lobe multiplier is `scale * 2.3`, and `vUv` ∈ [0,1], so the
// in-shader sample coordinate `vUv * scale * 2.3` can reach ~10.6. We bake the field over
// [0, FBM_DOMAIN] and wrap (RepeatWrapping) beyond it; a tileable bake keeps the wrap
// seam invisible in a low-frequency additive haze.
const FBM_DOMAIN = 12;
const FBM_TEX_SIZE = 512;

let _fbmTexture = null;

/** vec2 → [0,1) scalar hash — CPU mirror of TSL `hash21` / GLSL `od_hash21`. */
function cpuHash21(x, y) {
    // p3 = fract(vec3(x, y, x) * 0.1031)
    let p3x = x * 0.1031;
    let p3y = y * 0.1031;
    let p3z = x * 0.1031;
    p3x -= Math.floor(p3x);
    p3y -= Math.floor(p3y);
    p3z -= Math.floor(p3z);
    // p3 += dot(p3, p3.yzx + 33.33)
    const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += d;
    p3y += d;
    p3z += d;
    // fract((p3.x + p3.y) * p3.z)
    const v = (p3x + p3y) * p3z;
    return v - Math.floor(v);
}

/** Smooth 2D value noise in ~[0,1] — CPU mirror of TSL `noise2` / GLSL `od_noise2`. */
function cpuNoise2(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);
    const a = cpuHash21(ix, iy);
    const b = cpuHash21(ix + 1, iy);
    const c = cpuHash21(ix, iy + 1);
    const d = cpuHash21(ix + 1, iy + 1);
    const ab = a + (b - a) * ux;
    const cd = c + (d - c) * ux;
    return ab + (cd - ab) * uy;
}

/** 5-octave FBM — CPU mirror of TSL/GLSL `fbm2` (rot+2.02, amp 0.5). */
function cpuFbm2(xIn, yIn) {
    let value = 0.0;
    let amplitude = 0.5;
    let px = xIn;
    let py = yIn;
    for (let i = 0; i < 5; i += 1) {
        value += amplitude * cpuNoise2(px, py);
        // rot * p * 2.02 ; rot = mat2(0.80, 0.60, -0.60, 0.80)
        const rx = px * 0.80 + py * -0.60;
        const ry = px * 0.60 + py * 0.80;
        px = rx * 2.02;
        py = ry * 2.02;
        amplitude *= 0.5;
    }
    return value;
}

/**
 * Lazily build (once) and return the shared, tileable, single-channel `fbm2` DataTexture
 * the sheet material samples instead of recomputing FBM per pixel. RepeatWrapping +
 * LinearFilter so it reads like the smooth analytic field. Stored as 8-bit RED — `fbm2`
 * output is ~[0, 0.97], well inside a unit-normalized byte, and the haze is low-frequency
 * so 1/255 precision is invisible. Reused across every sheet of every chapter.
 *
 * To make the field tile across the [0, FBM_DOMAIN] period, we blend the four corner
 * copies (toroidal wrap) so opposite edges match — a standard tileable-FBM trick.
 * @returns {THREE.DataTexture}
 */
export function getCorridorFbmTexture() {
    if (_fbmTexture) return _fbmTexture;

    const size = FBM_TEX_SIZE;
    const data = new Uint8Array(size * size);
    const period = FBM_DOMAIN;

    for (let j = 0; j < size; j += 1) {
        const v = (j / size) * period; // 0..period (exclusive of period)
        for (let i = 0; i < size; i += 1) {
            const u = (i / size) * period;
            // Toroidal blend of four phase-shifted copies so the [0,period] field tiles.
            const wu = u / period; // 0..1 blend weight
            const wv = v / period;
            const f00 = cpuFbm2(u, v);
            const f10 = cpuFbm2(u - period, v);
            const f01 = cpuFbm2(u, v - period);
            const f11 = cpuFbm2(u - period, v - period);
            const top = f00 * (1 - wu) + f10 * wu;
            const bot = f01 * (1 - wu) + f11 * wu;
            const value = top * (1 - wv) + bot * wv;
            const byte = Math.max(0, Math.min(255, Math.round(value * 255)));
            data[j * size + i] = byte;
        }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    tex.name = 'odyssey-corridor-fbm';
    _fbmTexture = tex;
    return tex;
}

/**
 * Sample the baked FBM field at a sheet-UV coordinate scaled into the tiling domain.
 * Mirrors the old `fbm2(vUv * mul + offset)` call sites. Returns a float node in ~[0,1].
 * @param {THREE.Texture} tex the shared baked field
 * @param {*} coord vec2 node — the (already scaled/offset) sample coordinate in UV units
 */
function sampleFbm(tex, coord) {
    // Map the UV-domain coordinate into [0,1) texture space; RepeatWrapping tiles beyond.
    return texture(tex, coord.div(FBM_DOMAIN)).r;
}

/**
 * Build one parallax backdrop sheet material — an FBM field, two-tone tinted, radially
 * feathered. The mesh placement (position/rotation/scale) is the caller's job; this only
 * builds the surface. The FBM is now sampled from a shared baked texture rather than
 * recomputed per pixel (see module header / getCorridorFbmTexture).
 *
 * @param {object} opts
 * @param {THREE.Color|number} opts.inner inner (denser) tint
 * @param {THREE.Color|number} opts.outer outer/edge tint
 * @param {number} [opts.density] FBM coverage bias (0..1, higher = more body)
 * @param {number} [opts.scale] FBM frequency
 * @param {number} [opts.drift] horizontal drift speed factor
 * @param {boolean} [opts.additive] additive (glows: nebula/haze) vs normal (silhouettes)
 * @param {number} [opts.baseOpacity] peak opacity ceiling
 * @param {number} [opts.pocket] 0..1 POCKETING strength. 0 (default) = the original
 *   uniform-haze field (terrestrial/urban keep their exact prior look); >0 carves the
 *   sheet into a few bright bands on near-black vacuum (cosmic/aerial).
 * @param {number} [opts.coverage] 0..1 fraction lit when pocketing. LOW = sparse bright
 *   pockets on dark; HIGH = broad fill. Only acts when pocket > 0. (Default 0.5.)
 * @param {number} [opts.contrast] >1 sharpens the lit/dark falloff (pow on the cloud);
 *   1 = no change. High contrast + low coverage = the deep-vacuum-with-pockets read.
 * @param {*} [opts.uTime] shared time uniform (created if omitted)
 * @returns {{ material: THREE.Material, uniforms: object }}
 */
export function createCorridorSheetMaterial({
    inner = 0x6a3cff,
    outer = 0x140a2e,
    density = 0.5,
    scale = 1.6,
    drift = 0.04,
    additive = true,
    baseOpacity = 0.42,
    pocket = 0,
    coverage = 0.5,
    contrast = 1.0,
    uTime = uniform(0),
} = {}) {
    const uOpacity = uniform(1);
    const uInner = uniform(new THREE.Color(inner));
    const uOuter = uniform(new THREE.Color(outer));
    const uDensity = uniform(density);
    const uBaseOpacity = uniform(baseOpacity);

    const fbmTex = getCorridorFbmTexture();

    const vUv = uv();
    // Centre-relative coordinate for the radial feather (no rectangular edge).
    const centered = vUv.sub(0.5);
    const radial = clamp(length(centered).mul(2.0), 0.0, 1.0);
    const feather = oneMinus(smoothstep(0.55, 1.0, radial));

    // Two FBM lobes at different scale/drift for a sense of internal parallax — now
    // SAMPLED from the baked field instead of recomputed per pixel. The coordinate
    // transforms mirror the old `fbm2(vUv.mul(...).add(driftOffset))` exactly.
    const p0 = vUv.mul(scale).add(vec2(uTime.mul(drift), uTime.mul(drift * 0.55)));
    const p1 = vUv.mul(scale * 2.3).add(vec2(uTime.mul(-drift * 0.7), uTime.mul(drift * 0.4)));
    const fa = sampleFbm(fbmTex, p0);
    const fb = sampleFbm(fbmTex, p1);
    const base = clamp(fa.mul(0.7).add(fb.mul(0.35)).add(uDensity.sub(0.5).mul(0.6)), 0.0, 1.0);

    // POCKETING (opt-in): a broad low-frequency lobe carves the field into a FEW bright
    // bands on near-black vacuum, with a coverage threshold + contrast falloff. At
    // pocket = 0 this branch contributes nothing and `cloud` == the original `base`,
    // so terrestrial/urban sheets keep their exact prior look.
    const pPocket = vUv.mul(scale * 0.42).add(vec2(uTime.mul(drift * 0.25), uTime.mul(-drift * 0.18)));
    const lobe = pow(clamp(sampleFbm(fbmTex, pPocket).mul(1.4).sub(0.2), 0.0, 1.0), 1.6);
    const carved = base.mul(lobe.mul(0.9).add(0.1));
    // Threshold by coverage (lower coverage -> darker vacuum), then sharpen by contrast.
    const thresholded = clamp(carved.sub(oneMinus(float(coverage)).mul(0.55)), 0.0, 1.0);
    const pocketed = pow(thresholded, float(contrast));
    const cloud = mix(base, pocketed, float(pocket));

    // Tint from edge tone (sparse) to inner tone (dense).
    const color = mix(uOuter, uInner, smoothstep(0.15, 0.85, cloud));

    // Vertical gradient so sheets read as banded depth (denser toward the band centre).
    const vertical = oneMinus(abs(centered.y).mul(2.0));
    const body = clamp(cloud.mul(vertical.mul(0.6).add(0.4)), 0.0, 1.0);

    const alpha = clamp(
        body.mul(feather).mul(uBaseOpacity).mul(uOpacity),
        0.0,
        1.0,
    );

    // Skip the blend for sub-visible feathered corners / dark vacuum (overdraw saving).
    Discard(alpha.lessThan(ALPHA_DISCARD));

    const material = new THREE.MeshBasicNodeMaterial();
    // Additive sheets pre-multiply colour by alpha so they glow without a hard plate;
    // normal sheets (silhouettes) keep their tint and just fade via opacity.
    material.colorNode = additive ? color.mul(alpha) : color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.toneMapped = false;
    material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;

    return {
        material,
        uniforms: {
            uTime, uOpacity, uInner, uOuter, uDensity, uBaseOpacity,
        },
    };
}

/**
 * Build the per-instance particulate buffer (deterministic, no per-frame allocation).
 * Distributes `count` motes inside a box hugging the corridor (centred on origin; the
 * caller positions the parent group on the path). Each instance carries a base offset,
 * a per-instance size, and a seed for drift/twinkle.
 *
 * @param {number} count
 * @param {object} opts
 * @param {number} opts.spread half-extent on x/y (lateral)
 * @param {number} opts.depth half-extent on z (along view)
 * @param {number} opts.minSize world-space sprite half-size
 * @param {number} opts.maxSize world-space sprite half-size
 * @returns {THREE.InstancedBufferGeometry}
 */
export function createCorridorParticulateGeometry(count, {
    spread = 80,
    depth = 110,
    minSize = 0.6,
    maxSize = 2.4,
} = {}) {
    const bases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);

    // Deterministic pseudo-random so the field is stable across reloads (no allocation
    // churn, reproducible captures). Cheap fract-of-sine hash (no bitwise ops).
    let s = 1.2345;
    const rand = () => {
        s += 0.6180339887;
        const v = Math.sin(s * 127.1) * 43758.5453123;
        return v - Math.floor(v);
    };

    for (let i = 0; i < count; i += 1) {
        const idx = i * 3;
        bases[idx] = (rand() * 2 - 1) * spread;
        bases[idx + 1] = (rand() * 2 - 1) * spread;
        bases[idx + 2] = (rand() * 2 - 1) * depth;
        sizes[i] = minSize + rand() * (maxSize - minSize);
        seeds[i] = rand();
    }

    return makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });
}

/**
 * Build the particulate sprite material — camera-facing, round, soft, feathered to 0
 * alpha before the quad edge. Drifts each mote on its seed; twinkles cosmic pinpoints.
 *
 * @param {object} opts
 * @param {THREE.Color|number} opts.color sprite tint
 * @param {number} [opts.drift] world-units drift amplitude
 * @param {number} [opts.twinkle] 0..1 twinkle depth (1 = strong, for stars)
 * @param {number} [opts.softness] 1 = soft puff (dust), higher = tighter pinpoint (stars)
 * @param {number} [opts.baseOpacity] peak opacity ceiling
 * @param {boolean} [opts.additive] additive glow vs normal
 * @param {*} [opts.uTime] shared time uniform (created if omitted)
 * @returns {{ material: THREE.Material, uniforms: object }}
 */
export function createCorridorParticulateMaterial({
    color = 0xbfd6ff,
    drift = 3.0,
    twinkle = 0.4,
    softness = 1.0,
    baseOpacity = 0.7,
    additive = true,
    uTime = uniform(0),
} = {}) {
    const uOpacity = uniform(1);
    const uColor = uniform(new THREE.Color(color));
    const uDrift = uniform(drift);
    const uTwinkle = uniform(twinkle);
    const uBaseOpacity = uniform(baseOpacity);

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aSeed = attribute('aSeed', 'float');

    // Gentle per-mote drift on the seed phase (cheap sine wander; no allocation).
    const phase = aSeed.mul(6.2831);
    const wanderX = sin(uTime.mul(0.18).add(phase)).mul(uDrift);
    const wanderY = sin(uTime.mul(0.13).add(phase.mul(1.7)).add(1.7)).mul(uDrift.mul(0.8));
    const wanderZ = sin(uTime.mul(0.09).add(phase.mul(0.6)).add(3.1)).mul(uDrift.mul(0.6));
    const center = vec3(
        aBase.x.add(wanderX),
        aBase.y.add(wanderY),
        aBase.z.add(wanderZ),
    );

    const positionNode = billboardWorld(center, aSize);

    // Round sprite mask: feather radially to 0 well before the quad edge. Higher softness
    // = a TIGHTER pinpoint (crisp star) rather than a broad puff. A small extra-bright
    // central kernel gives stars a crisp glint instead of a flat disc.
    const p = uv().sub(0.5);
    const r = clamp(length(p).mul(2.0), 0.0, 1.0);
    const core = pow(oneMinus(smoothstep(0.0, 1.0, r)), float(softness).add(1.0));
    const glint = pow(oneMinus(smoothstep(0.0, 0.42, r)), float(softness).mul(1.6).add(2.0));
    const shape = clamp(core.add(glint.mul(0.6)), 0.0, 1.0);

    // Twinkle: cosmic pinpoints flicker; dust stays steady (twinkle ~0).
    const tw = sin(uTime.mul(2.4).add(aSeed.mul(41.0))).mul(0.5).add(0.5);
    const flick = mix(float(1.0), tw, uTwinkle);

    const alpha = clamp(shape.mul(flick).mul(uBaseOpacity).mul(uOpacity), 0.0, 1.0);

    // Skip the blend for the sub-visible feathered corners of each sprite quad — these
    // round masks zero out well before the quad edge, so a large fraction of every
    // billboard quad is dead pixels we no longer pay to blend (overdraw saving).
    Discard(alpha.lessThan(ALPHA_DISCARD));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = additive ? uColor.mul(alpha) : uColor;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.toneMapped = false;
    material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;

    return {
        material,
        uniforms: {
            uTime, uOpacity, uColor, uDrift, uTwinkle, uBaseOpacity,
        },
    };
}

export default createCorridorSheetMaterial;
