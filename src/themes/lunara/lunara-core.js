/**
 * Lunara — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the layout, the director and their tests import only this.
 *
 * The valley (metres): the camera stands on the mirror flats at the origin, a little above the
 * water (y = 0), looking down −Z. The great moon hangs upper left, its rose companion circles
 * it, crystal spires bracket the view and the range closes the far shore.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Gameplay pulse slots evaluated by the materials. */
export const LOCK_SLOTS = 6;
export const CLEAR_SLOTS = 2;
/** Wisps in flight at once (a lock throws one, a hard drop three). */
export const WISP_SLOTS = 8;
/** Motes in one wisp's tail. */
export const WISP_TAIL = 28;

/** Lock ring on the water: radius R·(1 − e^(−age/τ)), fading at RING_FADE /s. */
export const RING_REACH = 44;
export const RING_TAU = 0.6;
export const RING_FADE = 1.35;

/** Seconds a wisp takes from the board to its crystal. */
export const WISP_FLIGHT = 0.42;

/**
 * Clear wave: leaves the foot of the board and runs out through the valley, accelerating:
 * radius = CLEAR_REACH · (age / CLEAR_TRAVEL)^CLEAR_SHAPE. One front per cleared line.
 */
export const CLEAR_REACH = 300;
export const CLEAR_TRAVEL = 1.6;
export const CLEAR_SHAPE = 1.7;
export const CLEAR_FRONT_GAP = 0.11;
export const CLEAR_FRONT_WIDTH = 0.07;
export const CLEAR_AFTERGLOW = 1.1;

/** Seconds the light a lock leaves in a crystal takes to fall to 1/e. */
export const STORE_HOLD = 26;
/** The most light one crystal holds (in lock units). */
export const STORE_MAX = 2.4;
/** A crystal's strike / release flash falls to 1/e in this many seconds. */
export const PULSE_FADE = 0.55;

/** Seconds a four-line clear holds the valley's breath before everything fires. */
export const HUSH_HOLD = 0.22;
/** Seconds the pillars of a four-line clear stand. */
export const PILLAR_LIFE = 2.6;

/** The near terrain's heightmap: a square grid over [−half, half] × [zMin, zMax]. */
export const TERRAIN = Object.freeze({
    size: 192,
    halfWidth: 190,
    zMin: -360,
    zMax: 24,
});

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

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Radius of a lock ring `age` seconds after the lock. */
export function ringRadius(age) {
    return age <= 0 ? 0 : RING_REACH * (1 - Math.exp(-age / RING_TAU));
}

/** How far a clear wave's first front has run `age` seconds after the clear. */
export function clearRadius(age) {
    return age <= 0 ? 0 : CLEAR_REACH * Math.min(1, age / CLEAR_TRAVEL) ** CLEAR_SHAPE;
}

/** Seconds after the clear at which its first front passes a point `dist` metres from the heart. */
export function clearPassTime(dist) {
    return CLEAR_TRAVEL * clamp01(dist / CLEAR_REACH) ** (1 / CLEAR_SHAPE);
}

/** The valley's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.2) : 0;
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

/** A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b]. */
export function pieceColor(value, fallback = 0xc7a4ff) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Pastel piece colours wash out as light: push them toward their own hue, and keep a floor
    // in every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.72) / (1 - lo * 0.72);
        return pushed * 0.95 + 0.05;
    });
}

/**
 * Valley palettes, one per level (cycled), all scene-linear:
 *   moon / companion  the two moons' own light
 *   zenith / horizon  the sky's ends; `glow` is the scatter round the great moon
 *   auroraLow / auroraHigh  the curtain's lower border and its crown
 *   bed               the light in the veins under the water
 *   crystal           the hue the spires lean to
 */
export const LUNARA_PALETTES = Object.freeze([
    {
        name: 'amethyst',
        moon: [0.82, 0.68, 1.0],
        companion: [1.0, 0.3, 0.44],
        zenith: [0.0022, 0.003, 0.016],
        horizon: [0.05, 0.022, 0.118],
        glow: [0.42, 0.26, 0.95],
        auroraLow: [0.12, 0.95, 0.78],
        auroraHigh: [0.72, 0.22, 1.0],
        bed: [0.1, 0.85, 0.9],
        crystal: [0.5, 0.24, 1.0],
    },
    {
        name: 'rose-quartz',
        moon: [1.0, 0.72, 0.86],
        companion: [0.55, 0.42, 1.0],
        zenith: [0.006, 0.003, 0.018],
        horizon: [0.16, 0.04, 0.11],
        glow: [0.95, 0.3, 0.6],
        auroraLow: [1.0, 0.42, 0.7],
        auroraHigh: [0.5, 0.3, 1.0],
        bed: [1.0, 0.4, 0.75],
        crystal: [0.95, 0.3, 0.72],
    },
    {
        name: 'glacier',
        moon: [0.7, 0.9, 1.0],
        companion: [0.82, 0.5, 1.0],
        zenith: [0.002, 0.005, 0.02],
        horizon: [0.03, 0.085, 0.17],
        glow: [0.2, 0.55, 1.0],
        auroraLow: [0.15, 1.0, 0.62],
        auroraHigh: [0.25, 0.5, 1.0],
        bed: [0.15, 0.95, 0.7],
        crystal: [0.22, 0.6, 1.0],
    },
    {
        name: 'ember',
        moon: [1.0, 0.82, 0.62],
        companion: [1.0, 0.36, 0.2],
        zenith: [0.006, 0.003, 0.016],
        horizon: [0.17, 0.055, 0.06],
        glow: [1.0, 0.45, 0.28],
        auroraLow: [1.0, 0.7, 0.25],
        auroraHigh: [1.0, 0.25, 0.5],
        bed: [1.0, 0.62, 0.2],
        crystal: [1.0, 0.42, 0.5],
    },
    {
        name: 'ultraviolet',
        moon: [0.72, 0.62, 1.0],
        companion: [0.2, 0.95, 0.9],
        zenith: [0.003, 0.002, 0.024],
        horizon: [0.07, 0.03, 0.2],
        glow: [0.36, 0.2, 1.0],
        auroraLow: [0.3, 0.5, 1.0],
        auroraHigh: [0.95, 0.25, 1.0],
        bed: [0.55, 0.4, 1.0],
        crystal: [0.38, 0.22, 1.0],
    },
]);

export const PALETTE_KEYS = Object.freeze([
    'moon', 'companion', 'zenith', 'horizon', 'glow', 'auroraLow', 'auroraHigh', 'bed', 'crystal',
]);

/** The colour a four-line clear fires in. */
export const MOONFIRE = Object.freeze([1.0, 0.86, 0.6]);

/**
 * Where the celestial bodies sit on screen (fractions, y down; radii in screen heights) for an
 * aspect ratio. Landscape leaves the centre to the board: the great moon stands upper left, the
 * ringed world far right. Upright phones show sky only above the card, so both move up there.
 */
export function celestialAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.75, 1.35, a);
    return {
        moon: { x: lerp(0.36, 0.235, k), y: lerp(0.125, 0.285, k), radius: lerp(0.105, 0.19, k) },
        planet: { x: lerp(0.84, 0.8, k), y: lerp(0.06, 0.135, k), radius: lerp(0.026, 0.042, k) },
    };
}
