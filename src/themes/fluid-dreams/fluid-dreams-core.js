/**
 * Fluid Dreams — constants and CPU maths shared by the choreography, the layout and the shaders.
 * Three-free: the choreography, the director and their tests import only this.
 *
 * The dreaming sea (metres): the camera stands a little above a sea of liquid light (y = 0),
 * looking down −Z. The Great Drop hangs upper left on a thread of liquid drawn up out of the sea,
 * its kin float far right, and everything liquid in the picture is one smooth-min distance field:
 * drops merge with each other and with the sea, and pinch off again, by construction.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// ── The distance field's ball table ─────────────────────────────────────────────

/** Ball groups: each owns a fixed range of the ball table and a bounding sphere per frame. */
export const GROUP_HERO = 0; // the Great Drop: lobes, satellites, the crown of a four-line clear
export const GROUP_KIN = 1; // the little drops far right, and what drips from them
export const GROUP_LEFT = 2; // event liquid left of the board (flights, jets)
export const GROUP_RIGHT = 3; // event liquid right of the board
export const GROUP_COUNT = 4;

/** Table capacity per group (balls). */
export const GROUP_CAPACITY = Object.freeze([36, 6, 16, 16]);
export const GROUP_START = Object.freeze(GROUP_CAPACITY.map((_, g) => {
    let start = 0;
    for (let i = 0; i < g; i += 1) start += GROUP_CAPACITY[i];
    return start;
}));
export const MAX_BALLS = GROUP_CAPACITY.reduce((a, b) => a + b, 0);

/** Smooth-union radius (metres) between the sea and anything standing in it: its meniscus. */
export const SMOOTH_K = 0.3;

/**
 * Each group's balls join one another with a union of their own before they meet the sea: the
 * Great Drop's satellites and its crown bridge generously, a jet stays a slender column.
 */
export const GROUP_BLEND = Object.freeze([0.62, 0.3, 0.2, 0.2]);

/** Ripple trains on the sea (a lock, a drip, a falling bead). */
export const RING_SLOTS = 10;
/** Colour a lock leaves glowing under the surface. */
export const DYE_SLOTS = 12;
/** Wave packets a clear sends through the sea. */
export const WAVE_SLOTS = 3;

// ── The Great Drop ──────────────────────────────────────────────────────────────

export const HERO = Object.freeze({
    /** Core radius at rest. */
    radius: 3.3,
    /** Distance from the camera. */
    distance: 27,
    lobes: 4,
    /** The most satellites a chain of clears can raise. */
    satellites: 8,
    /** How much a full charge swells it. */
    swell: 0.22,
});

// ── Gameplay timings (seconds) ──────────────────────────────────────────────────

/** A lock's droplet: from the card to the sea. */
export const FLIGHT_TIME = 0.52;
/** The rebound jet a landing raises, start to finish. */
export const JET_TIME = 1.25;
/** A ring train: radius R·(1 − e^(−age/τ)), fading at RING_FADE /s. */
export const RING_REACH = 16;
export const RING_TAU = 0.9;
export const RING_FADE = 0.95;
/** Seconds the colour a lock leaves in the sea takes to fall to 1/e. */
export const DYE_HOLD = 22;

/** A clear's wave packet: leaves the foot of the board and runs out through the sea. */
export const CLEAR_REACH = 150;
export const CLEAR_TRAVEL = 2.6;
export const CLEAR_SHAPE = 1.35;

/** Seconds a four-line clear holds the sea's breath before the Great Drop lets go. */
export const HUSH_HOLD = 0.24;
/** The plunge: the fall, the crown, the column that lifts the Drop back into the air. */
export const PLUNGE = Object.freeze({
    fall: 0.42,
    crown: 1.7,
    rise: 2.3,
    total: 4.6,
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

/** Radius of a ring train `age` seconds after it starts, for a train that reaches `reach`. */
export function ringRadius(age, reach = RING_REACH) {
    return age <= 0 ? 0 : reach * (1 - Math.exp(-age / RING_TAU));
}

/** How far a clear's packet has run `age` seconds after the clear. */
export function clearRadius(age) {
    return age <= 0 ? 0 : CLEAR_REACH * Math.min(1, age / CLEAR_TRAVEL) ** CLEAR_SHAPE;
}

/** The sea's charge for a combo of n (0 at rest, → 1). */
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
export function pieceColor(value, fallback = 0xff2d95) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Keep a floor in every channel so a pure primary still reaches all three of the bloom's
    // channels, and a pastel leans to its own hue instead of washing out as light.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.6) / (1 - lo * 0.6);
        return pushed * 0.96 + 0.04;
    });
}

/**
 * Palettes, one per level (cycled), all scene-linear:
 *   zenith / mid / horizon  the sky from overhead down to the sea line
 *   sun                     the dream sun's light
 *   inkA / inkB / inkC      the ink that drifts through the sky and inside the Great Drop
 *   deep                    the sea seen straight down
 *   glow                    the light the Great Drop gathers under itself
 */
export const FLUID_PALETTES = Object.freeze([
    {
        name: 'amethyst-dusk',
        zenith: [0.006, 0.003, 0.034],
        mid: [0.055, 0.014, 0.17],
        horizon: [0.62, 0.11, 0.42],
        sun: [1.0, 0.62, 0.5],
        inkA: [1.0, 0.1, 0.45],
        inkB: [0.0, 0.78, 1.0],
        inkC: [0.5, 0.16, 1.0],
        deep: [0.012, 0.005, 0.045],
        glow: [0.2, 0.75, 1.0],
    },
    {
        name: 'lagoon',
        zenith: [0.003, 0.008, 0.034],
        mid: [0.012, 0.06, 0.17],
        horizon: [0.1, 0.52, 0.5],
        sun: [0.82, 1.0, 0.9],
        inkA: [0.1, 0.95, 0.75],
        inkB: [0.3, 0.45, 1.0],
        inkC: [0.95, 0.3, 0.8],
        deep: [0.004, 0.022, 0.06],
        glow: [0.25, 1.0, 0.75],
    },
    {
        name: 'rose-gold',
        zenith: [0.012, 0.004, 0.03],
        mid: [0.12, 0.022, 0.1],
        horizon: [0.72, 0.26, 0.13],
        sun: [1.0, 0.82, 0.5],
        inkA: [1.0, 0.36, 0.22],
        inkB: [1.0, 0.2, 0.62],
        inkC: [1.0, 0.78, 0.25],
        deep: [0.04, 0.008, 0.04],
        glow: [1.0, 0.62, 0.3],
    },
    {
        name: 'ultraviolet',
        zenith: [0.004, 0.002, 0.04],
        mid: [0.04, 0.016, 0.2],
        horizon: [0.3, 0.14, 0.75],
        sun: [0.78, 0.7, 1.0],
        inkA: [0.42, 0.2, 1.0],
        inkB: [0.1, 0.9, 1.0],
        inkC: [1.0, 0.2, 0.9],
        deep: [0.008, 0.004, 0.08],
        glow: [0.5, 0.4, 1.0],
    },
    {
        name: 'aurora-mint',
        zenith: [0.003, 0.006, 0.032],
        mid: [0.03, 0.03, 0.17],
        horizon: [0.22, 0.56, 0.3],
        sun: [0.95, 1.0, 0.72],
        inkA: [0.2, 1.0, 0.55],
        inkB: [0.75, 0.3, 1.0],
        inkC: [0.1, 0.7, 1.0],
        deep: [0.006, 0.012, 0.06],
        glow: [0.4, 1.0, 0.6],
    },
]);

export const PALETTE_KEYS = Object.freeze([
    'zenith', 'mid', 'horizon', 'sun', 'inkA', 'inkB', 'inkC', 'deep', 'glow',
]);

/** The colour a four-line clear fires in. */
export const DREAMFIRE = Object.freeze([1.0, 0.86, 0.62]);

/**
 * Where the picture's anchors sit on screen (fractions, y down) for an aspect ratio. Landscape
 * leaves the centre to the board: the Great Drop stands upper left, its kin far right, the dream
 * sun low between the board and the kin. Upright phones show sky only above the card, so the
 * Drop moves up and in.
 */
export function sceneAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const k = smooth(0.75, 1.35, a);
    return {
        hero: { x: lerp(0.5, 0.215, k), y: lerp(0.2, 0.33, k) },
        kin: { x: lerp(0.86, 0.805, k), y: lerp(0.36, 0.3, k) },
        // right of the stats bar in landscape, so its path of light lies on open sea
        sun: { x: lerp(0.72, 0.875, k), y: lerp(0.5, 0.57, k) },
        /** Hero scale: a phone's sky is narrow. */
        heroScale: lerp(0.62, 1, k),
    };
}
