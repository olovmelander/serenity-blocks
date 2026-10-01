/**
 * Shifting Sands — shared TSL building blocks and the one atmosphere every surface shares.
 *
 * Rules (from the fleet's perf sweeps):
 *  - every helper that is called more than once carries `setLayout`, so it is emitted ONCE as a
 *    real shader function instead of being inlined at each call site;
 *  - no `mx_noise_*` anywhere (a DXC compile pathology on this project's Windows machines):
 *    low-frequency noise is ONE fetch of a tiny tileable value-noise texture (smoothed bilinear),
 *    hashes are Dave Hoskins' hash-without-sine;
 *  - additive materials write PREMULTIPLIED colour with alpha 1 (r185+ AdditiveBlending is
 *    (SrcAlpha, One), so (col·a, a) would apply every falloff twice).
 *
 * The atmosphere is built once per material from the shared uniform nodes (`createAtmosphere`):
 * the sky dome, the haze every surface fades into and the light terms all read the same values,
 * so the dunes melt into exactly the sky behind them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    pow,
    select,
    smoothstep,
    sqrt,
    texture,
    vec2,
    vec3,
} from 'three/tsl';

// ── Seeded RNG (CPU) ────────────────────────────────────────────────────────────

/** mulberry32: a tiny seeded [0, 1) generator. */
export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Linear-space THREE.Color from an sRGB hex (authoring convenience). */
export function linearHex(hex) {
    return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

// ── Hashes (GPU) ────────────────────────────────────────────────────────────────

/** vec2 → [0,1) */
export const ssHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ss_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** vec2 → vec2 in [0,1) */
export const ssHash22 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.xx.add(p3.yz).mul(p3.zy));
}).setLayout({ name: 'ss_hash22', type: 'vec2', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** float → [0,1) */
export const ssHash11 = /* @__PURE__ */ Fn(([pIn]) => {
    const p = fract(float(pIn).mul(0.1031)).toVar();
    p.mulAssign(p.add(33.33));
    p.mulAssign(p.add(p));
    return fract(p);
}).setLayout({ name: 'ss_hash11', type: 'float', inputs: [{ name: 'pIn', type: 'float' }] });

// ── Value-noise texture ─────────────────────────────────────────────────────────

export const NOISE_SIZE = 128;

/**
 * A tileable RGBA value-noise lattice: four independent channels of random values, sampled with
 * a smoothed-bilinear lookup (`ssTexNoise`). One fetch = four decorrelated smooth noises.
 */
export function createNoiseTexture(seed = 9173) {
    const rand = mulberry32(seed);
    const n = NOISE_SIZE;
    const data = new Uint8Array(n * n * 4);
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(rand() * 256);
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'shifting-sands-noise';
    tex.needsUpdate = true;
    return tex;
}

/**
 * Smooth value noise (four channels, each in [0,1]) at lattice coordinate p: the fractional part
 * is remapped through the cubic fade before ONE hardware-bilinear fetch (Quilez' trick), so the
 * result is smooth with no lattice creases. Inline on purpose (it captures the texture node).
 */
export function ssTexNoise(noiseTex, p) {
    const i = floor(p);
    const f = fract(p);
    const s = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    return texture(noiseTex, i.add(s).add(0.5).div(NOISE_SIZE)).level(0);
}

// ── Small maths ─────────────────────────────────────────────────────────────────

/** Henyey–Greenstein phase. */
export const ssPhaseHG = /* @__PURE__ */ Fn(([c, g]) => {
    const g2 = g.mul(g);
    const d = max(float(1.0).add(g2).sub(g.mul(c).mul(2.0)), 1e-4);
    return float(1.0).sub(g2).div(d.mul(sqrt(d)).mul(12.566));
}).setLayout({
    name: 'ss_phaseHG',
    type: 'float',
    inputs: [{ name: 'c', type: 'float' }, { name: 'g', type: 'float' }],
});

/** Rec.709 luminance. */
export const ssLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/** Max of three channels. */
export const ssMax3 = (c) => max(c.x, max(c.y, c.z));

// ── The atmosphere ──────────────────────────────────────────────────────────────

/**
 * Scene-linear values of the shared atmosphere (radiance, pre tone map). The grade lives in the
 * post; level progression (the deepening dusk) lerps between DAY and DUSK in the world.
 */
export const ATMOSPHERE_LOOK = Object.freeze({
    day: Object.freeze({
        sunLightA: [0xffa65a, 2.7],
        sunLightB: [0xffe4c8, 1.2],
        zenith: [0x26407e, 0.3],
        upper: [0x6a6ea8, 0.4],
        horizonWarm: [0xffa865, 0.78],
        horizonCool: [0xc48d8c, 0.5],
    }),
    dusk: Object.freeze({
        sunLightA: [0xff7a3a, 2.2],
        sunLightB: [0xffc9a0, 1.0],
        zenith: [0x141d44, 0.22],
        upper: [0x4e3f78, 0.32],
        horizonWarm: [0xff8a4a, 0.95],
        horizonCool: [0x9a6276, 0.42],
    }),
});

/**
 * Build the atmosphere graph helpers from the shared uniform nodes:
 *   u = { uSunA, uSunB, uSunLightA, uSunLightB, uZenith, uUpper, uHorizonWarm, uHorizonCool,
 *         uFog (x: distance density, y: height density, z: height falloff, w: max amount) }
 * All helpers are plain JS graph builders: each material evaluates them once.
 */
export function createAtmosphere(u) {
    const towardSunA = (dir) => {
        const d2 = normalize(vec2(dir.x, dir.z).add(vec2(1e-5, 0.0)));
        const s2 = normalize(vec2(u.uSunA.x, u.uSunA.z));
        return dot(d2, s2).mul(0.5).add(0.5);
    };

    /** Horizon colour by azimuth relative to the primary sun (hot apricot → dusty rose). */
    const horizonColor = (dir) => mix(u.uHorizonCool, u.uHorizonWarm, pow(towardSunA(dir), 2.4));

    /** The two suns' forward-scattering glow (Mie) along a direction. */
    const mieGlow = (dir, strength = 1.0) => {
        const cA = dot(dir, u.uSunA);
        const cB = dot(dir, u.uSunB);
        const a = ssPhaseHG(cA, float(0.9)).mul(0.03).add(ssPhaseHG(cA, float(0.6)).mul(0.032));
        const b = ssPhaseHG(cB, float(0.92)).mul(0.025).add(ssPhaseHG(cB, float(0.65)).mul(0.025));
        return u.uSunLightA.mul(a).add(u.uSunLightB.mul(b)).mul(strength);
    };

    /** Sky radiance without discs/clouds. */
    const skyGradient = (dir) => {
        const el = dir.y;
        const hz = horizonColor(dir);
        const t = clamp(el, 0.0, 1.0);
        // The hot horizon band is thicker toward the suns.
        const band = mix(0.08, 0.22, pow(towardSunA(dir), 1.5));
        const lowSky = mix(hz, u.uUpper, smoothstep(0.0, band, t));
        const sky = mix(lowSky, u.uZenith, smoothstep(band.mul(0.7), 0.8, pow(t, 0.85)));
        // Below the horizon: the dust layer, a little darker.
        const below = hz.mul(mix(1.0, 0.8, clamp(el.negate().mul(6.0), 0.0, 1.0)));
        const base = mix(below, sky, smoothstep(-0.002, 0.004, el));
        return base.add(mieGlow(dir, mix(1.0, 0.65, smoothstep(0.0, 0.3, el))));
    };

    /** The colour distant surfaces fade into along `dir` (horizon light + forward scattering). */
    const hazeColor = (dir) => horizonColor(dir).mul(0.94).add(mieGlow(dir, 0.6));

    /**
     * Aerial perspective amount in [0, uFog.w]: exponential distance fog plus an analytic
     * exponential height fog (dense dust in the troughs, thin over the crests).
     */
    const fogAmount = (worldPos) => {
        const v = worldPos.sub(cameraPosition);
        const dist = length(v);
        const b = u.uFog.z;
        // ∫ exp(−b·y) dt along the ray, closed form; series form for near-horizontal rays.
        const by = b.mul(v.y);
        const exact = float(1.0).sub(exp(by.negate())).div(by);
        const ratio = select(abs(by).greaterThan(1e-3), exact, float(1.0).sub(by.mul(0.5)));
        const heightOD = u.uFog.y.mul(exp(b.mul(cameraPosition.y).negate())).mul(dist).mul(ratio);
        const distOD = u.uFog.x.mul(dist);
        return min(float(1.0).sub(exp(heightOD.add(distOD).negate())), u.uFog.w);
    };

    const applyAerial = (color, worldPos, fogScale = 1.0) => {
        const v = worldPos.sub(cameraPosition);
        const dir = v.div(max(length(v), 1e-3));
        return mix(color, hazeColor(dir), fogAmount(worldPos).mul(fogScale));
    };

    return {
        towardSunA, horizonColor, mieGlow, skyGradient, hazeColor, fogAmount, applyAerial,
    };
}
