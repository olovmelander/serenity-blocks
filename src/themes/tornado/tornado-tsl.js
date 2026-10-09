/**
 * Tornado — shared TSL: the uniforms every part reads, the baked noise, the funnel's shape.
 *
 * One set of uniforms (createUniforms) is the scene's state on the GPU: the storm's clocks, the
 * light of the hour, the funnel's girth and lean, and the small tables the gameplay writes
 * (ribbons the funnel holds, gust rings on the field, flashes in the cloud, the sparks' flights).
 * Parts never keep copies: the world writes, the materials read.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    max,
    pow,
    sin,
    texture,
    uniform,
    uniformArray,
    vec2,
    vec3,
} from 'three/tsl';
import {
    TAU, WORLD, mulberry32,
} from './tornado-core.js';

/** vec2 → [0,1) */
export const tnHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'tn_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

export const tnLuma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
export const tnMax3 = (c) => max(c.x, max(c.y, c.z));
/** e^(−x²). */
export const tnGauss = (x) => exp(x.mul(x).negate());

// ── The noise texture ────────────────────────────────────────────────────────────

export const NOISE_SIZE = 256;

/**
 * Four periodic fBm gradient-noise fields, one per channel, each stretched to 0..1. R and G
 * start at four cells a tile (the cloud's lobes, the funnel's streaks), B at eight, A at sixteen
 * (the fine grain).
 * @returns {Uint8Array} size × size × 4
 */
export function bakeNoise(seed = 1925, size = NOISE_SIZE) {
    const n = size;
    const rand = mulberry32(seed);
    const data = new Uint8Array(n * n * 4);
    const field = new Float32Array(n * n);
    const fade = (v) => v * v * v * (v * (v * 6 - 15) + 10);
    const first = [4, 4, 8, 16];
    for (let c = 0; c < 4; c += 1) {
        field.fill(0);
        let amp = 1;
        for (let o = 0; o < 5; o += 1) {
            const period = first[c] << o;
            if (period > n / 2) break;
            const gx = new Float32Array(period * period);
            const gy = new Float32Array(period * period);
            for (let i = 0; i < gx.length; i += 1) {
                const a = rand() * TAU;
                gx[i] = Math.cos(a);
                gy[i] = Math.sin(a);
            }
            const scale = period / n;
            for (let y = 0; y < n; y += 1) {
                const fy = y * scale;
                const y0 = Math.floor(fy);
                const ty = fy - y0;
                const y1 = (y0 + 1) % period;
                const sy = fade(ty);
                for (let x = 0; x < n; x += 1) {
                    const fx = x * scale;
                    const x0 = Math.floor(fx);
                    const tx = fx - x0;
                    const x1 = (x0 + 1) % period;
                    const sx = fade(tx);
                    const i00 = y0 * period + x0;
                    const i10 = y0 * period + x1;
                    const i01 = y1 * period + x0;
                    const i11 = y1 * period + x1;
                    const d00 = gx[i00] * tx + gy[i00] * ty;
                    const d10 = gx[i10] * (tx - 1) + gy[i10] * ty;
                    const d01 = gx[i01] * tx + gy[i01] * (ty - 1);
                    const d11 = gx[i11] * (tx - 1) + gy[i11] * (ty - 1);
                    const top = d00 + (d10 - d00) * sx;
                    const bottom = d01 + (d11 - d01) * sx;
                    field[y * n + x] += (top + (bottom - top) * sy) * amp;
                }
            }
            amp *= 0.5;
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < field.length; i += 1) {
            if (field[i] < lo) lo = field[i];
            if (field[i] > hi) hi = field[i];
        }
        const inv = 255 / Math.max(1e-6, hi - lo);
        for (let i = 0; i < field.length; i += 1) data[i * 4 + c] = Math.round((field[i] - lo) * inv);
    }
    return data;
}

export function createNoiseTexture(seed) {
    const data = bakeNoise(seed);
    const tex = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

// ── The scene's state ────────────────────────────────────────────────────────────

/** Ribbons of light the funnel can hold at once (one per swallowed piece). */
export const RIBBONS = 6;
/** Gust rings crossing the field at once. */
export const RINGS = 4;
/** Flashes inside the cloud at once. */
export const FLASHES = 3;
/** Locked pieces whose sparks are in the air at once. */
export const FLIGHTS = 5;
/** Lightning channels at once. */
export const BOLTS = 4;

const rows = (count) => Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, 0));
const colour = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export function createUniforms() {
    const tables = {
        // per ribbon: (phase round the funnel, head height, tail height, light) + (rgb, turns)
        ribbons: rows(RIBBONS * 2),
        // per ring: (x, z, radius, strength) + (rgb, width)
        rings: rows(RINGS * 2),
        // per flash: (x, z, light, reach)
        flashes: rows(FLASHES),
        // per flight: (origin xyz, start time) + (rgb, power)
        flights: rows(FLIGHTS * 2),
        // per channel: (light, 0, 0, 0)
        bolts: rows(BOLTS),
    };
    return {
        tables,
        ribbons: uniformArray(tables.ribbons, 'vec4'),
        rings: uniformArray(tables.rings, 'vec4'),
        flashes: uniformArray(tables.flashes, 'vec4'),
        flights: uniformArray(tables.flights, 'vec4'),
        bolts: uniformArray(tables.bolts, 'vec4'),

        time: uniform(0),
        /** The storm's clocks: accumulated, so a change of speed never jumps. */
        spin: uniform(0), // the funnel's turn, in turns
        flow: uniform(0), // the updraught, in tiles
        wind: uniform(0), // sway and flicker time
        deck: uniform(0), // the cloud base's winding phase, in cycles
        deckTurn: uniform(0), // the deck's rigid turn, radians
        gust: uniform(new THREE.Vector2(0, 0)), // where the gust field has travelled, tiles

        fury: uniform(0), // the chain: 0 at rest, toward 1
        girth: uniform(1), // stem radius scale (live control × chain × swell)
        flare: uniform(1), // wall-cloud flare scale
        rope: uniform(20), // the funnel's sideways sway, metres
        lean: uniform(new THREE.Vector2(0, 0)), // where the foot has wandered, metres
        axis: uniform(new THREE.Vector3(-300, 0, -650)), // the funnel's anchor under the cloud
        release: uniform(0), // 0..1: the ribbons let go (a clear)
        rays: uniform(0.35), // the sun's shafts under the deck
        shock: uniform(new THREE.Vector4(0, 0, 0, 0)), // the dust front: (radius, strength, 0, 0)

        sunDir: uniform(new THREE.Vector3(0.5, 0.05, -0.86)),
        sunPower: uniform(15),
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        pixelAngle: uniform(0.001),

        sun: colour(1, 0.55, 0.2),
        gapLow: colour(0.98, 0.5, 0.17),
        gapHigh: colour(0.5, 0.36, 0.3),
        skyTop: colour(0.13, 0.17, 0.25),
        cloudDark: colour(0.016, 0.023, 0.034),
        cloudMid: colour(0.05, 0.062, 0.082),
        cloudLit: colour(0.92, 0.36, 0.13),
        cloudRim: colour(0.95, 0.68, 0.44),
        wheatLit: colour(0.62, 0.37, 0.09),
        wheatShade: colour(0.085, 0.062, 0.026),
        haze: colour(0.56, 0.33, 0.17),
        funnelLit: colour(1, 0.6, 0.32),
        funnelShade: colour(0.062, 0.075, 0.1),
        dust: colour(0.36, 0.2, 0.09),
        bolt: colour(0.8, 0.86, 1),
    };
}

/** Sample the noise at an explicit level (vertex stage, or a deliberately soft read). */
export const noiseAt = (tex, uvNode, level = 0) => texture(tex, uvNode).level(level);

// ── The funnel's shape (the shader's copy of tornado-core's funnelRadius) ──────────

/** Radius at height fraction h, metres. */
export function funnelRadiusNode(u, hIn) {
    const h = clamp(hIn, 0.0, 1.0);
    return float(WORLD.radiusGround).mul(u.girth)
        .add(pow(h, 1.7).mul(WORLD.radiusTop - WORLD.radiusGround))
        .add(exp(h.oneMinus().mul(-8.0)).mul(u.flare).mul(WORLD.flare))
        .add(exp(h.mul(-16.0)).mul(WORLD.foot));
}

/**
 * The funnel's centre line at height fraction h: anchored under the cloud, the foot wandering,
 * the stem swaying like a rope between them.
 */
export function funnelCentreNode(u, hIn) {
    const h = clamp(hIn, 0.0, 1.0);
    const bell = h.mul(h.oneMinus()).mul(4.0);
    const sway = vec2(
        sin(h.mul(2.6).add(u.wind.mul(0.31))),
        cos(h.mul(2.1).add(u.wind.mul(0.23))).mul(0.6),
    ).mul(bell).mul(u.rope);
    const wander = u.lean.mul(pow(h.oneMinus(), 1.6));
    return vec3(
        u.axis.x.add(wander.x).add(sway.x),
        h.mul(WORLD.cloudBase),
        u.axis.z.add(wander.y).add(sway.y),
    );
}
