/**
 * Chiral Gold — constants and CPU maths shared by the choreography, the shaders and the tests.
 * Three-free: the director, the composition and their tests import only this.
 *
 * The hall (metres, y up): still black water at y = 0. Two towers of braided gold stand in it,
 * mirror images of each other, one either side of the board; behind them a great open ring of
 * gold stands half sunk in the water. The camera looks level across the water from the +Z side.
 */

export const TAU = Math.PI * 2;

/** The stage every part is laid out on. */
export const STAGE = Object.freeze({
    camera: Object.freeze({
        y: 2.6, z: 16, fov: 40, near: 0.25, far: 400,
    }),
    /** Screen x (NDC, 16:9) the towers stand at, and the widest/narrowest the layout lets them go. */
    helixNdcX: 0.64,
    /** The great ring: its centre and the radius of its outermost band. */
    ring: Object.freeze({ y: 2.6, z: -7, radius: 8 }),
    /** Where the board's foot meets the water, in front of the towers (z toward the camera). */
    boardZ: 6.5,
});

/**
 * One tower. `s` runs 0 at its submerged foot to 1 above the frame.
 * Three broad ribbons wind one way and a cage of fine wire winds the other.
 */
export const HELIX = Object.freeze({
    bottom: -1.3,
    top: 13.6,
    radius: 1.0,
    turns: 2.35,
    ribbons: 3,
    /** Half-widths of the three ribbons (the braid is not regular). */
    halfWidth: Object.freeze([0.42, 0.33, 0.25]),
    halfThickness: 0.034,
    /** How far the axis itself wanders (a slow S), as a fraction of the radius. */
    sway: 0.2,
    /** The wires swing out in long loops: their widest reach, their turns, how often they swell. */
    wireRadius: 1.95,
    wireTurns: 1.7,
    wireSwell: 1.15,
});

export const helixHeight = (s) => HELIX.bottom + (HELIX.top - HELIX.bottom) * s;
export const helixParam = (y) => (y - HELIX.bottom) / (HELIX.top - HELIX.bottom);

/** The axis' slow wander at parameter `s` (x, z), before handedness. */
function axisSway(s) {
    const a = HELIX.sway * HELIX.radius;
    return [Math.sin(s * TAU * 0.62 + 0.4) * a, Math.sin(s * TAU * 0.41 + 1.9) * a * 0.7];
}

/**
 * Centre line of ribbon `k` at parameter `s` in the tower's own frame. `hand` = −1 winds the
 * left tower, +1 the right: the two are true mirror images (x ↔ −x), not a shared spiral.
 * @returns {[number, number, number]}
 */
export function ribbonPoint(s, k, hand) {
    const theta = TAU * HELIX.turns * s + (k * TAU) / HELIX.ribbons;
    const r = HELIX.radius * (0.86 + 0.16 * Math.cos(TAU * 0.83 * s + k * 2.1));
    const [sx, sz] = axisSway(s);
    return [hand * (Math.cos(theta) * r + sx), helixHeight(s), Math.sin(theta) * r + sz];
}

/** Centre line of wire `j` of `count`: wound against the ribbons. */
export function wirePoint(s, j, count, hand) {
    const theta = -(TAU * HELIX.wireTurns * s) + (j * TAU) / count + j * 0.4;
    const r = HELIX.wireRadius * (0.83 + 0.17 * Math.cos(TAU * HELIX.wireSwell * s + j * 2.4));
    const [sx, sz] = axisSway(s);
    return [hand * (Math.cos(theta) * r + sx), helixHeight(s), Math.sin(theta) * r + sz];
}

// ── Gameplay slots evaluated by the materials ───────────────────────────────────

/** Pulses running along the ribbons: (height, birth, strength, side). */
export const PULSE_SLOTS = 8;
/** Speed a pulse front climbs/descends (m/s), its half-width (m) and fade (1/s). */
export const PULSE_SPEED = 5.2;
export const PULSE_WIDTH = 0.55;
export const PULSE_FADE = 1.15;

/** Rings on the water: (x, z, birth, strength) + colour. */
export const RIPPLE_SLOTS = 6;
export const RIPPLE_REACH = 15;
export const RIPPLE_TAU = 1.25;
export const RIPPLE_FADE = 0.85;

/** Comets on the great ring: (birth, direction·speed in turns/s, strength, band). */
export const COMET_SLOTS = 6;

/** Radius of a water ring `age` seconds after it starts. */
export function rippleRadius(age) {
    return age <= 0 ? 0 : RIPPLE_REACH * (1 - Math.exp(-age / RIPPLE_TAU));
}

/** Seconds a spark takes from the board to a tower: the tower lights when it lands. */
export const SPARK_FLIGHT = 0.42;

/**
 * The four-line strike ("aurum"): a hush, then the ring ignites and a braid of gold leaf climbs
 * around the board.
 */
export const AURUM = Object.freeze({
    hush: 0.16,
    rise: 2.6,
    rain: 7.5,
    /** Seconds the hall stays in overdrive. */
    hold: 3.2,
});

// ── Charge ──────────────────────────────────────────────────────────────────────

/** 0..1: how hot a chain of `combo` consecutive clears runs the hall. */
export function heatForCombo(combo) {
    if (!(combo > 1)) return 0;
    return Math.min(1, 1 - Math.exp(-(combo - 1) * 0.34));
}

/** How many bands of the great ring have left its plane for a chain of `combo`. */
export function bandsForCombo(combo) {
    if (combo >= 6) return 3;
    if (combo >= 4) return 2;
    if (combo >= 2) return 1;
    return 0;
}

// ── Alloys ──────────────────────────────────────────────────────────────────────

/**
 * Scene-linear reflectance of each alloy the hall is cast in; a level-up pours the next one.
 * [name, braid colours for the three ribbons, glow]
 */
export const ALLOYS = Object.freeze([
    Object.freeze({
        name: 'fine gold',
        ribbons: Object.freeze([[1.0, 0.64, 0.22], [1.0, 0.54, 0.25], [1.0, 0.75, 0.4]]),
        glow: Object.freeze([1.0, 0.6, 0.18]),
    }),
    Object.freeze({
        name: 'rose gold',
        ribbons: Object.freeze([[1.0, 0.5, 0.36], [1.0, 0.64, 0.22], [1.0, 0.68, 0.54]]),
        glow: Object.freeze([1.0, 0.48, 0.3]),
    }),
    Object.freeze({
        name: 'white gold',
        ribbons: Object.freeze([[1.0, 0.84, 0.62], [1.0, 0.64, 0.22], [0.96, 0.92, 0.84]]),
        glow: Object.freeze([1.0, 0.78, 0.5]),
    }),
    Object.freeze({
        name: 'green gold',
        ribbons: Object.freeze([[0.9, 0.78, 0.26], [1.0, 0.64, 0.22], [0.84, 0.88, 0.5]]),
        glow: Object.freeze([0.9, 0.75, 0.22]),
    }),
    Object.freeze({
        name: 'red gold',
        ribbons: Object.freeze([[1.0, 0.42, 0.2], [1.0, 0.62, 0.24], [1.0, 0.56, 0.36]]),
        glow: Object.freeze([1.0, 0.4, 0.16]),
    }),
]);

export const alloyForLevel = (level) => ALLOYS[(Math.max(1, Math.round(level || 1)) - 1) % ALLOYS.length];

// ── Small maths ─────────────────────────────────────────────────────────────────

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

/** Clamp to 0..1; anything that is not a number is 0. */
export const clamp01 = (v) => (v > 0 ? Math.min(1, v) : 0);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** An sRGB hex (number or '#rrggbb') as scene-linear [r, g, b]. */
export function linRGB(hex) {
    const n = typeof hex === 'string' ? Number.parseInt(hex.replace('#', ''), 16) : hex;
    const ch = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}
