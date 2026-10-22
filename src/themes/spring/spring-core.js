/**
 * Spring — renderer-free constants and maths (three-free, DOM-free).
 *
 * The world: a Norrland river in its spring flood at the end of May, seen from a flowering knoll
 * at the outside of a bend: a broad fall up to the left, rapids coming down to the knoll, the
 * river leaving down the valley to the right toward the snow-patched fells (spring-plan.js).
 * Metres; x right, y up, z toward the eye (the view looks down −z).
 *
 * This module owns what everything shares: the piece codes the director deals in and the board's
 * colours, the timings, and small maths.
 */

// ── Maths ─────────────────────────────────────────────────────────────────────────

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export const clamp01 = (v) => clamp(v, 0, 1);
export const clampInt = (v, lo, hi) => Math.round(clamp(v, lo, hi));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Fraction of the way to a target after dt at an exponential rate. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Hermite step between two edges (a step at lo when the edges are equal). */
export function smooth(lo, hi, v) {
    if (hi === lo) return v < lo ? 0 : 1;
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** The inverse of the Hermite step on [0, 1]: where 3x² − 2x³ reaches `y`. */
export function smoothInverse(y) {
    const v = clamp01(y);
    if (v <= 0 || v >= 1) return v;
    return 0.5 - Math.sin(Math.asin(1 - 2 * v) / 3);
}

/**
 * A rise–hold–fall envelope (`power` × smooth(0, rise) × (1 − smooth(holdEnd, fallEnd)) of the
 * time since `at`) that a new event REJOINS instead of restarting. Restarting it from its start
 * dropped whatever was lit back to nothing and let a weak event cut a strong one short; a hit
 * here takes up the curve where it stands: the reading never steps down, the new power is the
 * larger of the two (plus `gain` of the new one on top), and the curve climbs from what shows to
 * it over what is left of the rise, holds again and falls as before. Two numbers (`at`, `power`),
 * so a shader can draw the same curve from them.
 */
export class Rejoin {
    /** @param {{ rise: number, holdEnd: number, fallEnd: number, ceiling?: number }} shape seconds */
    constructor({
        rise, holdEnd, fallEnd, ceiling = 1,
    }) {
        this.rise = Math.max(0, rise);
        this.holdEnd = Math.max(this.rise, holdEnd);
        this.fallEnd = Math.max(this.holdEnd, fallEnd);
        this.ceiling = ceiling;
        this.reset();
    }

    /** The unit curve at `age` seconds (0 before its start). */
    shape(age) {
        if (!(age >= 0)) return 0;
        return smooth(0, this.rise, age) * (1 - smooth(this.holdEnd, this.fallEnd, age));
    }

    valueAt(now) {
        return this.power > 0 ? this.power * this.shape(now - this.at) : 0;
    }

    /**
     * Take up the curve at `now` with an event of `power`.
     * @param {number} power
     * @param {number} now seconds
     * @param {number} [gain] share of the new power added on top of what is lit
     */
    hit(power, now, gain = 0) {
        if (!(power > 0) || !Number.isFinite(now)) return;
        const shown = this.valueAt(now);
        const next = Math.min(this.ceiling, Math.max(power, shown + power * gain, shown));
        if (!(next > 0)) return;
        // Back onto the rise where it shows what is lit now: no step, then up to the new power.
        this.at = now - this.rise * smoothInverse(shown / next);
        this.power = next;
    }

    reset() {
        this.at = -1e6;
        this.power = 0;
    }

    exportState() {
        return { at: this.at, power: this.power };
    }

    importState(o) {
        this.reset();
        if (Number.isFinite(o?.at) && Number.isFinite(o?.power)) {
            this.at = o.at;
            this.power = Math.max(0, o.power);
        }
    }
}

/** Small, fast, deterministic PRNG (returns a function giving floats in [0, 1)). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A 32-bit integer hash of two integers (deterministic scatter without a PRNG stream). */
export function hash2i(x, y) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

/** The same as a float in [0, 1). */
export const hash2 = (x, y) => hash2i(x, y) / 4294967296;

const srgbChannelToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** An sRGB hex ('#RRGGBB') as linear RGB in 0..1 (black for anything else). */
export function hexToLinear(hex, out = [0, 0, 0]) {
    const m = typeof hex === 'string' ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
    if (!m) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return out;
    }
    const n = parseInt(m[1], 16);
    out[0] = srgbChannelToLinear(((n >> 16) & 255) / 255);
    out[1] = srgbChannelToLinear(((n >> 8) & 255) / 255);
    out[2] = srgbChannelToLinear((n & 255) / 255);
    return out;
}

// ── Pieces ────────────────────────────────────────────────────────────────────────

export const PIECE_CODE = Object.freeze({
    I: 0, T: 1, Z: 2, L: 3, S: 4, J: 5, O: 6, GARBAGE: 7,
});
export const PIECE_ORDER = Object.freeze(['I', 'T', 'Z', 'L', 'S', 'J', 'O', 'GARBAGE']);
/** The board's piece colours by code (spring-tetrominos.js carries the same table). */
export const PIECE_COLORS = Object.freeze([
    '#F6E76E', '#F8F4EC', '#E8508C', '#C756D2', '#279DF1', '#D9BDF5', '#EE8512', '#2E3826',
]);

export function pieceCode(shape) {
    if (typeof shape !== 'string') return PIECE_CODE.GARBAGE;
    const key = shape.trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(PIECE_CODE, key) ? PIECE_CODE[key] : PIECE_CODE.GARBAGE;
}

/**
 * A piece matrix as 4 cell offsets (8 numbers, x right, y up), centred on its bounding box.
 * Returns null for anything that is not a matrix with at least one filled cell.
 */
export function cellsFromMatrix(matrix) {
    if (!Array.isArray(matrix)) return null;
    const cells = [];
    for (let r = 0; r < matrix.length && r < 8; r++) {
        const row = matrix[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length && c < 8; c++) {
            if (Number(row[c]) > 0 && cells.length < 8) cells.push(c, -r);
        }
    }
    if (!cells.length) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < cells.length; i += 2) {
        minX = Math.min(minX, cells[i]);
        maxX = Math.max(maxX, cells[i]);
        minY = Math.min(minY, cells[i + 1]);
        maxY = Math.max(maxY, cells[i + 1]);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const out = new Array(8);
    for (let i = 0; i < 8; i += 2) {
        const j = i < cells.length ? i : 0;
        out[i] = cells[j] - cx;
        out[i + 1] = cells[j + 1] - cy;
    }
    return out;
}

/** The pieces in their spawn orientation (the game's own matrices). */
export const SHAPES = Object.freeze({
    I: [[1, 1, 1, 1]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1]],
    S: [[0, 1, 1], [1, 1, 0]],
    Z: [[1, 1, 0], [0, 1, 1]],
    J: [[1, 0, 0], [1, 1, 1]],
    L: [[0, 0, 1], [1, 1, 1]],
});
export const SHAPE_KEYS = Object.freeze(Object.keys(SHAPES));

// ── Timings (seconds) ─────────────────────────────────────────────────────────────

export const TIMING = Object.freeze({
    /** One station of the day per this many seconds of theme clock (the wheel's clock term). */
    hour: 100,
    /** A level-up's turn of the wheel eases over this long. */
    levelTurn: 5,
    /** Game over: the light falls to evening over this long, and returns over this long. */
    dusk: 6,
    dawn: 4,
    /** Without play the chain is forgotten after this long. */
    idle: 90,
});
