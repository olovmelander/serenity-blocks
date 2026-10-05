/**
 * Ice Temple — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the plan, the director and their tests import only this.
 */

export const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * The nave (metres). It runs along −Z from the camera; the board stands on its centre line.
 * Column pairs stand at z = firstZ − k·bay, k = 0..pairs−1; the aisle rows stand half a bay
 * further on; the apse closes the far end around the Great Crystal.
 */
export const NAVE = Object.freeze({
    halfWidth: 11,
    bay: 10,
    pairs: 8,
    firstZ: -8,
    columnRadius: 1.35,
    /** Height the arches spring from, and the apex of the transverse arches. */
    springHeight: 20,
    apexHeight: 33,
    /** The outer rows: shorter, thinner, some of them broken. */
    aisleHalf: 24,
    aisleRadius: 0.92,
    aisleHeight: 13,
    aisleFirstZ: -13,
    aislePairs: 8,
    /** The apse: a half ring of columns around the Great Crystal. */
    apseZ: -92,
    apseRadius: 14.5,
    apseColumns: 7,
    /** The Great Crystal's light. */
    heartZ: -100,
    heartY: 13,
    /** How far the frozen lake runs before the shore. */
    lakeRadius: 620,
});

/** The rest camera: on the centre line, a little above head height, looking up the nave. */
export const REST_RIG = Object.freeze({
    x: 0,
    height: 2.7,
    z: 4,
    pitch: 7.5 * DEG,
    /** Horizontal field of view the rig holds; the vertical one follows the aspect, clamped. */
    hFov: 90,
    minFov: 48,
    maxFov: 84,
    near: 0.3,
    far: 2400,
});

/** Vertical field of view (degrees) for an aspect ratio. */
export function fovForAspect(aspect) {
    const a = Math.max(0.2, Number.isFinite(aspect) ? aspect : 16 / 9);
    const v = (2 * Math.atan(Math.tan((REST_RIG.hFov * DEG) / 2) / a)) / DEG;
    return Math.max(REST_RIG.minFov, Math.min(REST_RIG.maxFov, v));
}

/**
 * The moon: low over the left colonnade, so its columns throw long shadows across the nave.
 * `dir` points from the scene toward the moon.
 */
const MOON_AZIMUTH = -38 * DEG;
const MOON_ELEVATION = 24 * DEG;
export const MOON = Object.freeze({
    dir: Object.freeze([
        Math.sin(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
        Math.sin(MOON_ELEVATION),
        -Math.cos(MOON_AZIMUTH) * Math.cos(MOON_ELEVATION),
    ]),
    /** Horizontal unit vector toward the moon, and the tangent of its elevation. */
    flat: Object.freeze([Math.sin(MOON_AZIMUTH), -Math.cos(MOON_AZIMUTH)]),
    tanElevation: Math.tan(MOON_ELEVATION),
});

/** Gameplay pulse slots evaluated by the materials. */
export const LOCK_SLOTS = 4;
export const CLEAR_SLOTS = 2;

/**
 * Lock: the piece strikes the ice. A shell of light runs out through the temple at
 * radius R·(1 − e^(−age/τ)), LOCK_SHELL_WIDTH thick, fading at LOCK_FADE /s; the star fracture it
 * leaves in the floor heals over LOCK_SCAR seconds.
 */
export const LOCK_REACH = 34;
export const LOCK_TAU = 0.46;
export const LOCK_SHELL_WIDTH = 2.4;
export const LOCK_FADE = 1.9;
export const LOCK_SCAR = 7;
/** Rays in a star fracture. */
export const STAR_RAYS = 9;

/**
 * Clear: the Great Crystal answers. A wave leaves the heart and reaches the camera CLEAR_TRAVEL
 * seconds later, one front per cleared line, CLEAR_FRONT_GAP apart; what a front has passed
 * keeps an afterglow.
 */
export const CLEAR_DEPTH = 108;
export const CLEAR_TRAVEL = 1.25;
export const CLEAR_SHAPE = 1.7;
export const CLEAR_FRONT_GAP = 0.11;
export const CLEAR_FRONT_WIDTH = 0.06;
export const CLEAR_AFTERGLOW = 1.1;

/** Four lines: seconds the temple holds its breath before the heart answers. */
export const HUSH_HOLD = 0.26;
/** Seconds the overdrive after a four-line clear takes to cool to 1/e. */
export const OVERDRIVE_COOL = 2.8;

/** The Great Snowflake (four lines): it grows, holds, then shatters into diamond dust. */
export const FLAKE_GROW = 1.15;
export const FLAKE_HOLD = 2.3;
export const FLAKE_SHATTER = 1.5;
export const FLAKE_LIFE = FLAKE_GROW + FLAKE_HOLD + FLAKE_SHATTER;

/** The ice crown a hard drop raises: spikes per crown, and its life (grow, hold, sink). */
export const CROWN_SPIKES = 16;
export const CROWN_LIFE = 1.5;

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

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** How far ahead of the camera a clear wave's first front is, `age` seconds after the clear. */
export function clearFrontDepth(age) {
    const p = clamp01(age / CLEAR_TRAVEL);
    return CLEAR_DEPTH * (1 - p) ** CLEAR_SHAPE;
}

/** Seconds after a clear that its first front passes depth `z` (negative ahead of the camera). */
export function clearPassTime(z) {
    const depth = clamp01(-z / CLEAR_DEPTH);
    return CLEAR_TRAVEL * (1 - depth ** (1 / CLEAR_SHAPE));
}

/** Radius of a lock shell `age` seconds after the lock. */
export function lockShellRadius(age) {
    return age <= 0 ? 0 : LOCK_REACH * (1 - Math.exp(-age / LOCK_TAU));
}

/** Seconds after a lock that its shell reaches a point `distance` metres from the blow. */
export function lockShellArrival(distance) {
    const d = Math.max(0, distance);
    return d >= LOCK_REACH ? Infinity : -LOCK_TAU * Math.log(1 - d / LOCK_REACH);
}

/** The temple's resonance for a combo of n (0 at rest, → 1). */
export function resonanceForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.6) : 0;
}

/** How far the Great Snowflake has grown (0..1) `age` seconds after it was called. */
export function flakeGrowth(age) {
    if (age <= 0) return 0;
    const p = clamp01(age / FLAKE_GROW);
    return 1 - (1 - p) ** 3;
}

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** An sRGB hex as scene-linear [r, g, b]. */
export function linRGB(hex) {
    return [
        srgbToLinear(((hex >> 16) & 255) / 255),
        srgbToLinear(((hex >> 8) & 255) / 255),
        srgbToLinear((hex & 255) / 255),
    ];
}

/**
 * Aurora palettes, one per level (cycled). `a` is the curtain's bright lower border, `b` its
 * body, `c` the fringe high above; `heart` tints the Great Crystal.
 *
 * The resonance lights the ice from within in these colours, and a warm light inside blue ice
 * mixes to grey: every colour here is one that stays a colour in ice (greens, blues, violets,
 * rose). No orange, no gold.
 */
export const AURORA_PALETTES = Object.freeze([
    Object.freeze({
        name: 'boreal', a: 0x3dff9e, b: 0x2ccfff, c: 0x8f5cff, heart: 0x9be8ff,
    }),
    Object.freeze({
        name: 'amethyst', a: 0x8f7bff, b: 0xff62d2, c: 0x39d9ff, heart: 0xc9b8ff,
    }),
    Object.freeze({
        name: 'glacier', a: 0x6ae8ff, b: 0xc8efff, c: 0x4f82ff, heart: 0xd8f6ff,
    }),
    Object.freeze({
        name: 'rose', a: 0xff5fa8, b: 0xb18cff, c: 0x5fd0ff, heart: 0xffd6ec,
    }),
    Object.freeze({
        name: 'solar', a: 0xff4a78, b: 0x3fffa6, c: 0xb45cff, heart: 0xffc4d6,
    }),
]);

/**
 * A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b] with a
 * floor in every channel (a pure primary would vanish in one of the bloom's channels).
 */
export function pieceColor(value, fallback = 0x7fdcff) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    return rgb.map((c) => (c / peak) * 0.9 + 0.1);
}

/**
 * The shadow rows: every row of columns the moon throws across the ice, as
 * [x, firstZ, count, radius, height]. The floor and the mist read the same list.
 */
export const SHADOW_ROWS = Object.freeze([
    Object.freeze([-NAVE.halfWidth, NAVE.firstZ, NAVE.pairs, NAVE.columnRadius, NAVE.springHeight + 4]),
    Object.freeze([NAVE.halfWidth, NAVE.firstZ, NAVE.pairs, NAVE.columnRadius, NAVE.springHeight + 4]),
    Object.freeze([-NAVE.aisleHalf, NAVE.aisleFirstZ, NAVE.aislePairs, NAVE.aisleRadius, NAVE.aisleHeight]),
    Object.freeze([NAVE.aisleHalf, NAVE.aisleFirstZ, NAVE.aislePairs, NAVE.aisleRadius, NAVE.aisleHeight]),
]);

/**
 * Fraction of moonlight reaching a point (CPU twin of the shaders' itMoonShadow): 1 = lit,
 * 0 = in a column's shadow.
 */
export function moonShadowAt(x, y, z) {
    const [lx, lz] = MOON.flat;
    let lit = 1;
    for (let i = 0; i < SHADOW_ROWS.length; i++) {
        const [cx, z0, count, radius, height] = SHADOW_ROWS[i];
        const s = (cx - x) / lx;
        if (!(s > 0)) continue;
        const zHit = z + s * lz;
        const k = Math.round((z0 - zHit) / NAVE.bay);
        if (k < 0 || k > count - 1) continue;
        const perp = Math.abs((zHit - (z0 - k * NAVE.bay)) * lx);
        const rayH = y + s * MOON.tanElevation;
        const pen = 0.06 + s * 0.014;
        const edge = 1 - smooth(radius - pen, radius + pen, perp);
        const top = 1 - smooth(height - 1, height + 1, rayH);
        lit *= 1 - edge * top;
    }
    return lit;
}
