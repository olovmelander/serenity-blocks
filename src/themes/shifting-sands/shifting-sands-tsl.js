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
    atan,
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

// The scene-linear values of the shared atmosphere (radiance, pre tone map) are the hours of the
// evening, shifting-sands-hours.js: the world melts from one station to the next. The grade lives
// in the post.

/**
 * Dust banks: world units per noise cell and the height-haze multiplier range. Their drift (noise
 * cells) is the world's uBankDrift: 0.006 cells a second at rest, integrated, so a storm drives
 * the banks faster across the erg without ever jumping them.
 */
const DUST_BANK_SCALE = 850;
/** Half the length of the wall of dust along the horizon (radians: shifting-sands-weather.js WALL.half). */
const WALL_HALF = (30 * Math.PI) / 180;
const DUST_BANK_RANGE = Object.freeze([0.3, 2.7]);

/**
 * Build the atmosphere graph helpers from the shared uniform nodes:
 *   u = { uSunA, uSunB, uGlowA, uGlowB (what each sun does to the AIR: it outlasts the sunset),
 *         uMoonDir, uMoonLight, uZenith, uUpper, uHorizonWarm, uHorizonCool,
 *         uFog (x: distance density, y: height density, z: height falloff, w: max amount),
 *         uWeather (x: cirrus, y: streets, z: the ribbed deck, w: the haze),
 *         uBankDrift, uWindDir, noiseTex (the drifting dust banks) }
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
        // The tight aureole is held low so the sky beside the ember disc stays under the tone
        // curve's shoulder: only the disc itself reaches it.
        const a = ssPhaseHG(cA, float(0.9)).mul(0.018).add(ssPhaseHG(cA, float(0.6)).mul(0.032));
        const b = ssPhaseHG(cB, float(0.92)).mul(0.025).add(ssPhaseHG(cB, float(0.65)).mul(0.025));
        // The moons' own veil of silver in the air round them (nothing until the night).
        const m = ssPhaseHG(dot(dir, u.uMoonDir), float(0.72)).mul(0.05);
        return u.uGlowA.mul(a).add(u.uGlowB.mul(b)).add(u.uMoonLight.mul(m)).mul(strength);
    };

    /** Sky radiance without discs/clouds. */
    const skyGradient = (dir) => {
        const el = dir.y;
        const hz = horizonColor(dir);
        const t = clamp(el, 0.0, 1.0);
        // The hot horizon band is thicker toward the suns, and thicker everywhere when the dust
        // hangs (uWeather.w: the haze), which also lays its own colour over the upper sky.
        const haze = u.uWeather.w;
        const band = mix(0.08, 0.22, pow(towardSunA(dir), 1.5)).add(haze.mul(0.16));
        const upper = mix(u.uUpper, hz.mul(0.8), haze.mul(0.4));
        const lowSky = mix(hz, upper, smoothstep(0.0, band, t));
        const sky = mix(lowSky, mix(u.uZenith, upper, haze.mul(0.45)), smoothstep(band.mul(0.7), 0.8, pow(t, 0.85)));
        // Below the horizon: the dust layer, a little darker.
        const below = hz.mul(mix(1.0, 0.8, clamp(el.negate().mul(6.0), 0.0, 1.0)));
        const base = mix(below, sky, smoothstep(-0.002, 0.004, el));
        return base.add(mieGlow(dir, mix(1.0, 0.65, smoothstep(0.0, 0.3, el))));
    };

    /** The colour distant surfaces fade into along `dir` (horizon light + forward scattering). */
    const hazeColor = (dir) => horizonColor(dir).mul(0.94).add(mieGlow(dir, 0.6));

    /**
     * Banks of suspended dust drifting downwind: a slow noise read part-way along the view ray
     * (so a bank stands in front of what it veils, not painted on it), in [0, 1].
     */
    const dustBanks = (worldPos) => {
        const mid = mix(cameraPosition.xz, worldPos.xz, 0.7);
        const p = mid.div(DUST_BANK_SCALE).sub(u.uWindDir.mul(u.uBankDrift));
        const n = ssTexNoise(u.noiseTex, p.add(vec2(23.1, 7.7)));
        return smoothstep(0.3, 0.75, n.x.mul(0.65).add(n.y.mul(0.35)));
    };

    /**
     * Aerial perspective amount in [0, uFog.w]: exponential distance fog plus an analytic
     * exponential height fog (dense dust in the troughs, thin over the crests), thickened and
     * thinned by the drifting dust banks.
     */
    const fogAmount = (worldPos) => {
        const v = worldPos.sub(cameraPosition);
        const dist = length(v);
        const b = u.uFog.z;
        // ∫ exp(−b·y) dt along the ray, closed form; series form for near-horizontal rays.
        const by = b.mul(v.y);
        const exact = float(1.0).sub(exp(by.negate())).div(by);
        const ratio = select(abs(by).greaterThan(1e-3), exact, float(1.0).sub(by.mul(0.5)));
        const banks = mix(DUST_BANK_RANGE[0], DUST_BANK_RANGE[1], dustBanks(worldPos));
        const heightOD = u.uFog.y.mul(exp(b.mul(cameraPosition.y).negate())).mul(dist).mul(ratio).mul(banks);
        const distOD = u.uFog.x.mul(dist);
        return min(float(1.0).sub(exp(heightOD.add(distOD).negate())), u.uFog.w);
    };

    /**
     * The wall of dust on the horizon stands beyond the land, so the land in front of it must
     * melt into ITS dark, not into the bright air it hides: the haze the far erg fades to is
     * shaded where the wall stands (uWall: x how tall, y its azimuth).
     */
    const wallShade = (dir, dist) => {
        const a = atan(dir.x, dir.z.negate()).sub(u.uWall.y).div(WALL_HALF);
        const reach = smoothstep(-1.0, -0.62, a).mul(float(1.0).sub(smoothstep(0.1, 1.0, a)));
        return float(1.0).sub(reach.mul(clamp(u.uWall.x, 0.0, 1.0)).mul(smoothstep(2200.0, 7000.0, dist)).mul(0.62));
    };

    const applyAerial = (color, worldPos, fogScale = 1.0) => {
        const v = worldPos.sub(cameraPosition);
        const dist = max(length(v), 1e-3);
        const dir = v.div(dist);
        return mix(color, hazeColor(dir).mul(wallShade(dir, dist)), fogAmount(worldPos).mul(fogScale));
    };

    return {
        towardSunA, horizonColor, mieGlow, skyGradient, hazeColor, fogAmount, applyAerial,
    };
}
