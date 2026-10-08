/**
 * Cinder Drift — constants and CPU maths shared by the plan, the choreography and the shaders.
 * Three-free: the layout, the director and their tests import only this.
 *
 * The chamber (metres): the camera stands on a ledge at the origin, a little above a lake of
 * lava (y = 0), looking down −Z. The great fall pours out of the left cliff, the crust it feeds
 * drifts across the lake toward the viewer's right, and cliffs of columnar basalt close the
 * chamber on every side.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Gameplay pulse slots evaluated by the materials. */
export const RING_SLOTS = 6;
export const CLEAR_SLOTS = 2;
/** Ribbons of running lava: the great fall, the fissure streams a chain opens, the fountains. */
export const STREAM_SLOTS = 6;
export const FOUNTAIN_SLOTS = 12;
/** Lava bombs in flight at once, and the embers strung behind each. */
export const BOMB_SLOTS = 14;
export const BOMB_TAIL = 14;

/** Where the lake lies: the square of it the camera can see (x0, x1, z0, z1). */
export const LAKE = Object.freeze({
    x0: -150, x1: 150, z0: -300, z1: 30,
});

/** The crust drifts this way (unit, xz) at DRIFT_SPEED metres a second at rest. */
export const DRIFT_DIR = Object.freeze([0.64, 0.768]);
export const DRIFT_SPEED = 0.38;

/** World size (metres) of one tile of the plate texture, and plates across a tile. */
export const PLATE_TILE = 44;
export const PLATE_CELLS = 13;

/**
 * The lake's memory of heat: a square of crust (metres across, texels across) that drifts with
 * the plates. A lock melts a pool into it; the pool cools to 1/e in HEAT_HOLD seconds.
 */
export const HEAT_EXTENT = 256;
export const HEAT_SIZE = 192;
export const HEAT_HOLD = 16;
/** The most heat a point of the memory holds. */
export const HEAT_MAX = 2.2;

/** Lock ring on the lake: radius R·(1 − e^(−age/τ)), fading at RING_FADE /s. */
export const RING_REACH = 26;
export const RING_TAU = 0.75;
export const RING_FADE = 1.5;

/**
 * Clear wave: leaves the foot of the board and runs out through the chamber, accelerating:
 * radius = CLEAR_REACH · (age / CLEAR_TRAVEL)^CLEAR_SHAPE. One front per cleared line.
 */
export const CLEAR_REACH = 260;
export const CLEAR_TRAVEL = 1.5;
export const CLEAR_SHAPE = 1.6;
export const CLEAR_FRONT_GAP = 0.12;
export const CLEAR_FRONT_WIDTH = 0.055;
export const CLEAR_AFTERGLOW = 1.6;

/** Seconds a four-line clear holds the chamber's breath before the fissure opens. */
export const HUSH_HOLD = 0.24;
/** Seconds the curtain of fire stands, and a single fountain of a smaller clear. */
export const CURTAIN_LIFE = 3.4;
export const FOUNTAIN_LIFE = 1.5;

/** Gravity on spatter and bombs (m/s²: a little light, so arcs stay readable). */
export const GRAVITY = 8.5;

/**
 * The great fall: how far down the chamber it leaves the left cliff, how high its lip is, how
 * far the lava is thrown clear of the rock, and how wide it runs. (The plan finds the cliff.)
 */
export const FALL = Object.freeze({
    z: -98, lipY: 36, reach: 1.8, width: 7.6,
});

/** The hole in the roof the night looks in through, and where its shaft meets the rock. */
export const SKYLIGHT = Object.freeze({
    top: [64, 54, -122],
    foot: [46, 5, -92],
    radius: 7,
});

/** The fissure a clear opens across the lake: fountains stand along z = FISSURE_Z. */
export const FISSURE_Z = -38;

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
export function ringRadius(age, reach = 1) {
    return age <= 0 ? 0 : RING_REACH * reach * (1 - Math.exp(-age / RING_TAU));
}

/** How far a clear wave's first front has run `age` seconds after the clear. */
export function clearRadius(age) {
    return age <= 0 ? 0 : CLEAR_REACH * Math.min(1, age / CLEAR_TRAVEL) ** CLEAR_SHAPE;
}

/** Seconds after the clear at which its first front passes a point `dist` metres from the heart. */
export function clearPassTime(dist) {
    return CLEAR_TRAVEL * clamp01(dist / CLEAR_REACH) ** (1 / CLEAR_SHAPE);
}

/** The chamber's pressure for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.2) : 0;
}

/** Fissures a chain of n clears has opened in the cliffs (the second clear opens the first). */
export function fissuresForCombo(combo) {
    return Math.max(0, Math.min(STREAM_SLOTS, Math.round(combo) - 1));
}

/** Seconds a body thrown up at `vy` m/s from height `y0` takes to come down to the lake. */
export function flightTime(vy, y0 = 0) {
    return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRAVITY * Math.max(0, y0)))) / GRAVITY;
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
 * A piece colour (CSS hex string or number) as a scene-linear, peak-normalised [r, g, b], drawn
 * toward the fire it is thrown into: the piece keeps its hue, and no piece comes out cold.
 */
export function pieceColor(value, fallback = 0xff8800) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    const ember = [1.0, 0.42, 0.1];
    return rgb.map((c, i) => {
        const n = c / peak;
        const pushed = (n - lo * 0.6) / (1 - lo * 0.6);
        return (pushed * 0.72 + ember[i] * 0.28) * 0.95 + 0.05;
    });
}

/**
 * Chamber palettes, one per level (cycled), all scene-linear:
 *   hot / mid / deep   the lava's own light, from its white heart through its body to its skin
 *   haze               the glow that hangs in the far air
 *   rock               the basalt
 *   cool               the night that looks in through the roof
 *   spark              embers
 */
export const CINDER_PALETTES = Object.freeze([
    {
        name: 'ember',
        hot: [1.0, 0.66, 0.26],
        mid: [1.0, 0.2, 0.018],
        deep: [0.56, 0.02, 0.003],
        haze: [0.085, 0.014, 0.004],
        rock: [0.04, 0.035, 0.036],
        cool: [0.09, 0.2, 0.42],
        spark: [1.0, 0.46, 0.1],
    },
    {
        name: 'crimson',
        hot: [1.0, 0.72, 0.5],
        mid: [1.0, 0.13, 0.03],
        deep: [0.5, 0.008, 0.02],
        haze: [0.08, 0.007, 0.008],
        rock: [0.036, 0.028, 0.032],
        cool: [0.3, 0.26, 0.5],
        spark: [1.0, 0.3, 0.12],
    },
    {
        name: 'gold',
        hot: [1.0, 0.9, 0.56],
        mid: [1.0, 0.5, 0.05],
        deep: [0.7, 0.1, 0.004],
        haze: [0.09, 0.03, 0.005],
        rock: [0.036, 0.032, 0.028],
        cool: [0.16, 0.34, 0.48],
        spark: [1.0, 0.72, 0.2],
    },
    {
        name: 'forge',
        hot: [1.0, 0.94, 0.8],
        mid: [1.0, 0.42, 0.1],
        deep: [0.66, 0.06, 0.012],
        haze: [0.085, 0.022, 0.008],
        rock: [0.03, 0.03, 0.036],
        cool: [0.24, 0.36, 0.56],
        spark: [1.0, 0.82, 0.5],
    },
    {
        name: 'rose',
        hot: [1.0, 0.76, 0.62],
        mid: [1.0, 0.2, 0.12],
        deep: [0.5, 0.012, 0.06],
        haze: [0.078, 0.01, 0.018],
        rock: [0.034, 0.028, 0.036],
        cool: [0.22, 0.3, 0.52],
        spark: [1.0, 0.42, 0.3],
    },
]);

export const PALETTE_KEYS = Object.freeze(['hot', 'mid', 'deep', 'haze', 'rock', 'cool', 'spark']);

/** The colour a four-line clear fires in: the white of the forge. */
export const WHITE_HEAT = Object.freeze([1.0, 0.9, 0.66]);

/**
 * Where the great fall and the skylight sit on screen for an aspect: how far the camera turns
 * (radians, positive = left) and tilts so the fall stays clear of the card. Landscape leaves the
 * centre to the board; an upright phone shows the chamber only above and below the card, so the
 * camera turns toward the fall and looks up.
 */
export function rigForAspect(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.7, 1.4, a);
    return {
        yaw: lerp(0.26, 0.0, k),
        pitch: lerp(8.5, 2.2, k) * DEG,
    };
}
