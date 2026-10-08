/**
 * Aether Tides — constants and CPU maths shared by the choreography, the director and the shaders.
 * Three-free: the composition, the director and their tests import only this.
 *
 * The picture is a nebula that is a real fluid. Everything is laid out in TIDE SPACE: the screen
 * with its centre at the origin, x to the right and y DOWN, one unit = half the screen's height
 * (so the screen spans [−aspect, aspect] × [−1, 1]). The fluid's grid covers the screen plus a
 * margin that holds the open boundary; board rects, stars, rings and wells are all tide-space
 * points.
 */

export const TAU = Math.PI * 2;

// ── The fluid's event table ─────────────────────────────────────────────────────

/**
 * How far the fluid's domain extends past the screen (a factor on both half-sizes). The margin
 * holds the sponge that lets flow leave, and the parallax never shows its edge.
 */
export const DOMAIN_MARGIN = 1.14;

/** Fixed simulation step (seconds). The picture between two steps is extrapolated, not stepped. */
export const SIM_DT = 1 / 60;
/** The most steps one frame may run (a slow frame drops simulated time instead of spiralling). */
export const SIM_MAX_STEPS = 3;

/** Moving sources of dye, momentum and heat: a locking cell, a spark, a row's jet. */
export const SPLAT_SLOTS = 28;
/** Blast fronts: a ring that shoulders the gas outward as it passes and leaves it glowing. */
export const RING_SLOTS = 8;
/** Wells and springs: places where the flow converges, spins or wells up. */
export const WELL_SLOTS = 4;
/** Stars the board has lit (one per lock), held until a clear's front reaches them. */
export const STAR_SLOTS = 28;
/** Slow gyres of the tide. */
export const GYRE_SLOTS = 3;

/** vec4 rows per slot in the event table (one uniform buffer for the whole table). */
export const SPLAT_ROWS = 5;
export const RING_ROWS = 2;
export const WELL_ROWS = 2;
export const STAR_ROWS = 3;
export const GYRE_ROWS = 1;

export const ROW_SPLAT = 0;
export const ROW_RING = ROW_SPLAT + SPLAT_SLOTS * SPLAT_ROWS;
export const ROW_WELL = ROW_RING + RING_SLOTS * RING_ROWS;
export const ROW_STAR = ROW_WELL + WELL_SLOTS * WELL_ROWS;
export const ROW_GYRE = ROW_STAR + STAR_SLOTS * STAR_ROWS;
export const EVENT_ROWS = ROW_GYRE + GYRE_SLOTS * GYRE_ROWS;

/** Splat footprints. */
export const SPLAT_ROUND = 0;
export const SPLAT_CELL = 1;

// ── Gameplay timings (seconds) ──────────────────────────────────────────────────

/** A locking cell pours its colour into the fluid for this long. */
export const LOCK_POUR = 0.2;
/** A lock's spark: from the piece to the place where its star lights. */
export const SPARK_FLIGHT = 0.62;
/** A star the board lit burns this long if no clear reaches it first. */
export const STAR_LIFE = 46;
/** A star takes this long to open. */
export const STAR_RISE = 0.5;
/** A star's nova: the flash and the push it gives the gas. */
export const NOVA_LIFE = 0.9;

/**
 * A blast front runs out from its centre and slows: radius = reach · (1 − e^(−age/τ)).
 * `reach` is in tide units, so a front crosses a wide screen in about the same time as a tall one.
 */
export const RING_TAU = 0.85;
export const RING_LIFE = 3.2;

/** Seconds a four-line clear holds the nebula's breath before everything fires. */
export const HUSH_HOLD = 0.24;

/** The maelstrom a chain of clears opens: seconds to open one step, and to let go. */
export const WELL_OPEN = 0.55;
export const WELL_RELEASE = 1.1;

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

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite step between two edges. */
export function smooth(lo, hi, v) {
    const t = clamp01((v - lo) / (hi - lo));
    return t * t * (3 - 2 * t);
}

/** Radius of a blast front `age` seconds after it left, for a given reach. */
export function ringRadius(age, reach) {
    return age <= 0 ? 0 : reach * (1 - Math.exp(-age / RING_TAU));
}

/** Seconds after it left at which a front of this reach passes a point `dist` away (Infinity if never). */
export function ringPassTime(dist, reach) {
    if (!(dist < reach * 0.995)) return Infinity;
    return -RING_TAU * Math.log(1 - Math.max(0, dist) / reach);
}

/** The tide's charge for a combo of n (0 at rest, → 1). */
export function powerForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.4) : 0;
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
export function pieceColor(value, fallback = 0x8a5cff) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // As glowing gas a pastel washes out: push each colour toward its own hue, and keep a floor
    // in every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.7) / (1 - lo * 0.7);
        return pushed * 0.96 + 0.04;
    });
}

// ── Palettes ────────────────────────────────────────────────────────────────────

/**
 * Nebula palettes, one per level (cycled), all scene-linear:
 *   gasA / gasB / gasC   the three emission colours the resting nebula is woven from
 *   dust                 what the dark lanes scatter when a star lights them
 *   star / companion     the Tide Star and its companion
 *   deep                 the colour of the empty sky between the clouds
 *   shock                the colour a blast front burns in
 */
export const AETHER_PALETTES = Object.freeze([
    {
        name: 'aether',
        gasA: [0.42, 0.1, 1.0],
        gasB: [0.04, 0.78, 1.0],
        gasC: [1.0, 0.1, 0.52],
        dust: [0.5, 0.36, 0.3],
        star: [0.72, 0.86, 1.0],
        companion: [1.0, 0.62, 0.3],
        deep: [0.006, 0.008, 0.03],
        shock: [0.7, 0.9, 1.0],
    },
    {
        name: 'carina',
        gasA: [0.05, 0.6, 0.72],
        gasB: [1.0, 0.56, 0.16],
        gasC: [0.2, 0.3, 1.0],
        dust: [0.62, 0.38, 0.22],
        star: [0.78, 0.9, 1.0],
        companion: [1.0, 0.5, 0.24],
        deep: [0.004, 0.012, 0.03],
        shock: [1.0, 0.9, 0.7],
    },
    {
        name: 'rosette',
        gasA: [1.0, 0.12, 0.3],
        gasB: [1.0, 0.42, 0.62],
        gasC: [0.5, 0.2, 1.0],
        dust: [0.55, 0.3, 0.34],
        star: [1.0, 0.9, 0.84],
        companion: [0.5, 0.7, 1.0],
        deep: [0.02, 0.005, 0.022],
        shock: [1.0, 0.8, 0.86],
    },
    {
        name: 'lagoon',
        gasA: [0.05, 0.95, 0.6],
        gasB: [0.1, 0.5, 1.0],
        gasC: [0.75, 1.0, 0.3],
        dust: [0.36, 0.42, 0.34],
        star: [0.85, 1.0, 0.92],
        companion: [1.0, 0.42, 0.7],
        deep: [0.003, 0.014, 0.022],
        shock: [0.8, 1.0, 0.9],
    },
    {
        name: 'ember',
        gasA: [1.0, 0.3, 0.06],
        gasB: [1.0, 0.72, 0.2],
        gasC: [0.75, 0.1, 0.5],
        dust: [0.6, 0.34, 0.2],
        star: [1.0, 0.86, 0.7],
        companion: [0.4, 0.75, 1.0],
        deep: [0.022, 0.007, 0.01],
        shock: [1.0, 0.86, 0.6],
    },
]);

export const PALETTE_KEYS = Object.freeze([
    'gasA', 'gasB', 'gasC', 'dust', 'star', 'companion', 'deep', 'shock',
]);

/** The colour a four-line clear burns in. */
export const STARFIRE = Object.freeze([1.0, 0.9, 0.72]);

// ── Composition ─────────────────────────────────────────────────────────────────

/** Seconds the Tide Star takes round its loop. */
export const TIDE_PERIOD = 150;

/**
 * 0 on an upright screen (the sky is above and below the card), 1 on a wide one (the sky is
 * beside it). The switch is quick on purpose: a slow blend between the two layouts would carry
 * the stars and the maelstrom straight across the card on a squarish frame.
 */
export function wideness(aspect) {
    return smooth(0.63, 0.68, aspect);
}

/**
 * The Tide Star keeps to the upper left of the card and its companion to the lower right (above
 * and below it on an upright screen). Each wanders a slow loop of its own there, so the light and
 * the shadows are never still and neither star ever stands behind the board.
 *
 * @returns {{ x: number, y: number }} tide-space position at `time` (index 0 = the Tide Star)
 */
export function tideStarPosition(index, time, aspect, out = { x: 0, y: 0 }) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const wide = wideness(a);
    const first = index === 0;
    const side = first ? -1 : 1;
    // Home: beside the card on a wide screen, above and below it on a tall one (where the
    // companion keeps to the right of its strip, clear of the maelstrom on the left).
    const homeX = side * lerp(a * (first ? 0.3 : 0.5), a * (first ? 0.63 : 0.69), wide);
    const homeY = side * lerp(0.9, first ? 0.4 : 0.56, wide);
    // Each wanders a slow loop of its own, so the light and the shadows are never still.
    const period = first ? TIDE_PERIOD : TIDE_PERIOD * 1.37;
    const phase = time * (TAU / period) + index * 2.1;
    out.x = homeX + Math.cos(phase) * lerp(a * (first ? 0.3 : 0.14), a * 0.16, wide);
    out.y = homeY + Math.sin(phase + 0.6) * lerp(0.05, first ? 0.27 : 0.2, wide);
    return out;
}

/**
 * Where the maelstrom opens: the open sky in the corner the river does not cross (upper right on
 * a wide screen, lower left on a tall one), clear of the card and of both stars.
 */
export function maelstromPosition(time, aspect, out = { x: 0, y: 0 }) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const wide = wideness(a);
    out.x = lerp(-a * 0.5, a * 0.66, wide) + Math.sin(time * 0.031) * 0.04 * wide;
    out.y = lerp(0.9, -0.6, wide) + Math.cos(time * 0.027) * 0.03;
    return out;
}

/**
 * Where the n-th star the board lights goes inside a tide-space rect of open sky: a
 * low-discrepancy walk (Halton, bases 2 and 3), so any run of seats is spread evenly and no two
 * stars land on each other. Deterministic in n.
 */
export function starSeat(n, region, out = { x: 0, y: 0 }) {
    const radical = (index, base) => {
        let f = 1;
        let r = 0;
        let k = Math.max(0, Math.floor(index)) + 1;
        while (k > 0) {
            f /= base;
            r += f * (k % base);
            k = Math.floor(k / base);
        }
        return r;
    };
    out.x = lerp(region.x0, region.x1, radical(n, 2));
    out.y = lerp(region.y0, region.y1, radical(n, 3));
    return out;
}
