/**
 * Neon District — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the layout, the director and their tests import only this.
 */

export const TAU = Math.PI * 2;

/** The street (metres). It runs along −Z from the camera and scrolls toward it. */
export const STREET = Object.freeze({
    /** Length of the repeating stretch of city. */
    period: 320,
    /** Scrolling objects live in [wrapMax − period, wrapMax): they leave 24 m behind the camera. */
    wrapMax: 24,
    /** Kerb to kerb is 2 × halfRoad; facade to facade 2 × halfStreet. */
    halfRoad: 6.4,
    halfStreet: 10,
    /** Height of the ground-floor band the shopfronts own. */
    plinth: 5.6,
});

/** Gameplay pulse slots evaluated by the materials. */
export const LOCK_SLOTS = 4;
export const CLEAR_SLOTS = 2;

/** Lock shell: radius R·(1 − e^(−age/τ)), a shell LOCK_SHELL_WIDTH thick, fading at LOCK_FADE /s. */
export const LOCK_REACH = 30;
export const LOCK_TAU = 0.42;
export const LOCK_SHELL_WIDTH = 2.6;
export const LOCK_FADE = 2.1;

/**
 * Clear wave: bursts out of the vanishing point and reaches the camera CLEAR_TRAVEL seconds later.
 * One front per cleared line, CLEAR_FRONT_GAP apart; what a front has passed keeps an afterglow.
 */
export const CLEAR_DEPTH = 170;
export const CLEAR_TRAVEL = 1.1;
export const CLEAR_SHAPE = 2.4;
export const CLEAR_FRONT_GAP = 0.085;
export const CLEAR_FRONT_WIDTH = 0.05;
export const CLEAR_AFTERGLOW = 0.9;

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

/** Wrap a scrolled depth into [wrapMax − period, wrapMax). The CPU twin of the shaders' ndWrapZ. */
export function wrapZ(z) {
    const { period, wrapMax } = STREET;
    return z - period * Math.floor((z - wrapMax) / period) - period;
}

/** How far ahead of the camera a clear wave's first front is, `age` seconds after the clear. */
export function clearFrontDepth(age) {
    const p = clamp01(age / CLEAR_TRAVEL);
    return CLEAR_DEPTH * (1 - p) ** CLEAR_SHAPE;
}

/** Radius of a lock shell `age` seconds after the lock. */
export function lockShellRadius(age) {
    return age <= 0 ? 0 : LOCK_REACH * (1 - Math.exp(-age / LOCK_TAU));
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
