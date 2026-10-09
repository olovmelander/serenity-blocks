/**
 * Supernova — constants and CPU maths shared by the choreography, the shaders and the tests.
 * Three-free (it reads the composition module, which is three-free too): the choreography's
 * tests need nothing else.
 *
 * Lengths are in STAR RADII (the star at rest has radius 1). The star sits at the origin of its
 * own frame; the nebula it has thrown off is a set of thin shells round it, each a sphere whose
 * pattern is fixed in DIRECTION, so a shell keeps its filaments as it grows (the gas of a real
 * remnant expands the same way: every part moves straight out at a speed set by where it is).
 */

import { fallbackLayout } from './supernova-composition.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** The star and what is drawn on its billboard (surface, chromosphere, corona, glare, spikes). */
export const STAR = Object.freeze({
    radius: 1,
    /** Half the side of the billboard, in star radii at rest. */
    quad: 8,
    /** Its own turn, radians per second at rest, and how far its axis leans from the screen's up. */
    spin: 0.05,
    tilt: 24 * DEG,
});

/** The nebula: shells are born at `inner`, fade out at `outer`, and take `cycle` seconds to cross. */
export const NEBULA = Object.freeze({
    inner: 2.5,
    outer: 19,
    cycle: 380,
});

/** The ring of beads round the star (the chain's tally). */
export const RING = Object.freeze({
    radius: 3.35,
    width: 0.3,
    beads: 12,
    /** How far the ring's plane leans back from the line of sight. */
    inclination: 66 * DEG,
});

/** Lock impacts the photosphere remembers (a flash, a ripple, a patch of the piece's colour). */
export const IMPACT_SLOTS = 6;
/** Streams in flight at once (a lock sends one, a hard drop three, a clear one per row). */
export const STREAM_SLOTS = 12;
/** Segments along one stream's ribbon. */
export const STREAM_SEGMENTS = 20;
/** Prominences standing on the star at once. */
export const LOOP_SLOTS = 10;
/** Segments along one prominence. */
export const LOOP_SEGMENTS = 28;
/** Shock fronts and echoes running out through the nebula at once. */
export const FRONT_SLOTS = 8;
/** The fireball of a detonation is this many shells, one inside the other. */
export const BLAST_SHELLS = 3;
/** The most standing shells any tier draws. */
export const STANDING_MAX = 5;
/** Rows of the shell table the nebula's shader walks (live rows are packed at the front). */
export const SHELL_ROWS = STANDING_MAX + FRONT_SLOTS + BLAST_SHELLS;
/** vec4s per row of the shell table. */
export const SHELL_STRIDE = 5;

/** Seconds a lock's stream takes from the card to the star (scaled a little by the distance). */
export const STREAM_FLIGHT = 0.52;
/** Seconds the cleared rows take to reach the star. */
export const ROW_FLIGHT = 0.2;
/** Seconds between the fronts of one clear (one front per line). */
export const FRONT_GAP = 0.15;
/** Seconds the star falls in on itself before it detonates. */
export const COLLAPSE_HOLD = 0.4;
/** A second detonation waits at least this long after the last (an aftershock answers instead). */
export const NOVA_REARM = 7;
/** Seconds the newborn star takes to swell back to its size. */
export const REKINDLE = 13;
/** Seconds a lock's colour stays on the photosphere (to 1/e). */
export const IMPACT_HOLD = 9;
/** Seconds a prominence lives. */
export const LOOP_LIFE = 5.5;
/** What is left of the star's radius at the moment it detonates. */
export const COLLAPSED_SIZE = 0.14;
/** A chain this long sets the star off by itself. */
export const CRITICAL_COMBO = 8;

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

// ── The nebula's shells ─────────────────────────────────────────────────────────

/** Where a standing shell is in its life: 0 = just thrown off, 1 = gone. */
export function shellPhase(index, count, time, cycle = NEBULA.cycle) {
    const p = index / Math.max(1, count) + time / cycle;
    return p - Math.floor(p);
}

/** A standing shell's radius for its phase (it grows by the same FACTOR every second). */
export function shellRadius(phase) {
    return NEBULA.inner * (NEBULA.outer / NEBULA.inner) ** phase;
}

/** How much of its light a standing shell has for its phase: it fades in, thins, and fades out. */
export function shellGain(phase) {
    return smooth(0, 0.1, phase) * (1 - smooth(0.7, 1, phase)) * (1.25 - phase * 0.75);
}

/**
 * How far a shock front has run `age` seconds after it left the star. It leaves fast and slows
 * as it sweeps the gas up. `reach` is how far it gets, `tau` how soon.
 */
export function frontRadius(age, reach = 21, tau = 1.15) {
    return age <= 0 ? STAR.radius : STAR.radius + reach * (1 - Math.exp(-age / tau));
}

/** Seconds after a front leaves at which it reaches a radius (Infinity if it never does). */
export function frontPassTime(radius, reach = 21, tau = 1.15) {
    const f = (radius - STAR.radius) / reach;
    if (f <= 0) return 0;
    if (f >= 1) return Infinity;
    return -tau * Math.log(1 - f);
}

/** The outer edge of a detonation's fireball `age` seconds after it. */
export function blastRadius(age) {
    return age <= 0 ? 0.2 : 0.2 + 22 * (1 - Math.exp(-age / 2.1)) + age * 0.25;
}

// ── The star ────────────────────────────────────────────────────────────────────

/** The star's heat for a chain of n clears (0 at rest, → 1). */
export function heatForCombo(combo) {
    return combo > 0 ? 1 - Math.exp(-combo / 3.4) : 0;
}

/**
 * The star's size around a detonation at `birth` (the moment of the flash): it falls in on
 * itself over COLLAPSE_HOLD before it, and what is left swells back over REKINDLE after it.
 * Returns a factor on its radius at rest.
 */
export function collapseScale(time, birth, hold = COLLAPSE_HOLD) {
    const age = time - birth;
    if (age < -hold) return 1;
    if (age < 0) {
        const k = 1 + age / hold; // 0 → 1 through the fall
        return 1 - (1 - COLLAPSED_SIZE) * k * k * k;
    }
    return COLLAPSED_SIZE + (1 - COLLAPSED_SIZE) * smooth(0, 1, age / REKINDLE) ** 0.8;
}

/** How bright the pulsar's beams are `age` seconds after a detonation. */
export function pulsarGain(age) {
    if (age < 0.25) return 0;
    return smooth(0.25, 1.1, age) * (1 - smooth(REKINDLE * 0.45, REKINDLE * 0.95, age));
}

// ── Colour ──────────────────────────────────────────────────────────────────────

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
export function pieceColor(value, fallback = 0xffaa00) {
    let hex = fallback;
    if (typeof value === 'number' && Number.isFinite(value)) hex = value;
    else if (typeof value === 'string') {
        const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (m) hex = Number.parseInt(m[1], 16);
    }
    const rgb = linRGB(hex);
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
    // Pale piece colours wash out as light: push them toward their own hue, and keep a floor in
    // every channel so a pure primary still reaches all three of the bloom's channels.
    const lo = Math.min(rgb[0], rgb[1], rgb[2]) / peak;
    return rgb.map((c) => {
        const n = c / peak;
        const pushed = (n - lo * 0.7) / (1 - lo * 0.7);
        return pushed * 0.95 + 0.05;
    });
}

/**
 * Palettes, all scene-linear, in the order the star goes through them: a level is the element
 * it burns, and time alone also carries it slowly on to the next (see paletteDrift).
 *   starDeep / starMid / starHot  the photosphere, from the cool lanes to the hot cells
 *   rim       the chromosphere: the thin electric edge of the disc
 *   corona    the light the star's own gas scatters round it
 *   gasA / gasB / gasC  what the nebula's filaments glow in
 *   skyA / skyB  the far clouds behind everything
 *   void      the sky's own colour
 */
export const SUPERNOVA_PALETTES = Object.freeze([
    {
        name: 'hydrogen',
        starDeep: [1.0, 0.05, 0.03],
        starMid: [1.0, 0.36, 0.05],
        starHot: [1.0, 0.82, 0.42],
        rim: [0.12, 0.5, 1.0],
        corona: [1.0, 0.5, 0.2],
        gasA: [1.0, 0.09, 0.2],
        gasB: [0.05, 0.7, 0.95],
        gasC: [1.0, 0.6, 0.12],
        skyA: [0.55, 0.07, 0.32],
        skyB: [0.05, 0.2, 0.75],
        void: [0.0036, 0.0014, 0.0078],
    },
    {
        name: 'helium',
        starDeep: [1.0, 0.3, 0.04],
        starMid: [1.0, 0.68, 0.16],
        starHot: [1.0, 0.95, 0.7],
        rim: [0.62, 0.3, 1.0],
        corona: [1.0, 0.75, 0.4],
        gasA: [1.0, 0.62, 0.1],
        gasB: [0.55, 0.22, 1.0],
        gasC: [1.0, 0.22, 0.42],
        skyA: [0.5, 0.26, 0.08],
        skyB: [0.3, 0.1, 0.72],
        void: [0.0044, 0.0022, 0.006],
    },
    {
        name: 'carbon',
        starDeep: [0.02, 0.32, 0.5],
        starMid: [0.06, 0.78, 0.74],
        starHot: [0.7, 1.0, 0.88],
        rim: [1.0, 0.7, 0.16],
        corona: [0.2, 0.9, 0.8],
        gasA: [0.08, 0.9, 0.55],
        gasB: [0.12, 0.36, 1.0],
        gasC: [1.0, 0.66, 0.2],
        skyA: [0.05, 0.42, 0.4],
        skyB: [0.1, 0.16, 0.7],
        void: [0.0012, 0.0034, 0.0064],
    },
    {
        name: 'oxygen',
        starDeep: [0.1, 0.18, 0.9],
        starMid: [0.3, 0.6, 1.0],
        starHot: [0.82, 0.94, 1.0],
        rim: [1.0, 0.2, 0.7],
        corona: [0.45, 0.7, 1.0],
        gasA: [0.1, 0.85, 0.9],
        gasB: [1.0, 0.16, 0.62],
        gasC: [0.3, 0.42, 1.0],
        skyA: [0.08, 0.36, 0.62],
        skyB: [0.5, 0.08, 0.5],
        void: [0.0014, 0.0022, 0.0096],
    },
    {
        name: 'silicon',
        starDeep: [0.55, 0.04, 0.6],
        starMid: [1.0, 0.25, 0.75],
        starHot: [1.0, 0.8, 0.95],
        rim: [0.2, 1.0, 0.7],
        corona: [1.0, 0.45, 0.85],
        gasA: [1.0, 0.14, 0.7],
        gasB: [0.2, 1.0, 0.72],
        gasC: [0.6, 0.3, 1.0],
        skyA: [0.48, 0.08, 0.5],
        skyB: [0.08, 0.4, 0.5],
        void: [0.0034, 0.0012, 0.0086],
    },
]);

export const PALETTE_KEYS = Object.freeze([
    'starDeep', 'starMid', 'starHot', 'rim', 'corona', 'gasA', 'gasB', 'gasC', 'skyA', 'skyB', 'void',
]);

/**
 * Seconds the star spends on one palette before time alone has carried it into the next, and
 * the share of that time the palette holds still before it starts to turn. Five palettes: one
 * turn of the whole cycle takes a little under seven minutes.
 */
export const PALETTE_DRIFT = 80;
export const PALETTE_HOLD = 0.35;

/**
 * Which two palettes the star is between. The level says where in the cycle it starts; the
 * hue clock (seconds) carries it on from there, whatever the level, one palette every
 * PALETTE_DRIFT seconds. Writes `from` and `to` (indices) and `blend` (0..1 between them).
 */
export function paletteDrift(level, clock, out = { from: 0, to: 1, blend: 0 }) {
    const count = SUPERNOVA_PALETTES.length;
    const start = Number.isFinite(level) ? Math.max(1, Math.round(level)) - 1 : 0;
    const turned = (Number.isFinite(clock) ? Math.max(0, clock) : 0) / PALETTE_DRIFT;
    const whole = Math.floor(turned);
    out.from = (start + whole) % count;
    out.to = (out.from + 1) % count;
    out.blend = smooth(PALETTE_HOLD, 1, turned - whole);
    return out;
}

/** The colour a detonation fires in, and what a star at full heat burns toward. */
export const STARFIRE = Object.freeze([1.0, 0.9, 0.74]);
export const BLUEWHITE = Object.freeze([0.62, 0.8, 1.0]);

/**
 * Where the star sits on screen for an aspect ratio: its centre (fractions, y down) and its
 * radius at rest (in screen heights). The centre of the frame belongs to the board, so the star
 * takes the room the card leaves: where there is enough to the card's left it burns there, in the
 * middle of that margin, and its shells sweep behind the card; on an upright phone, where the
 * card nearly fills the width, it climbs into the sky above the card instead. It is one place or
 * the other: a blend of the two would carry the star across the card's corner.
 */
export function starAnchors(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const card = fallbackLayout(a * 1000, 1000).cards[0];
    // The margins, in screen heights.
    const leftRoom = card.x0 * a;
    const topRoom = card.y0;
    const beside = leftRoom >= 0.2 ? 1 : 0;
    const besideRadius = Math.max(0.045, Math.min(0.095, leftRoom * 0.22));
    const aboveRadius = Math.max(0.028, Math.min(0.05, topRoom * 0.22));
    return {
        x: lerp(0.5, card.x0 * 0.52, beside),
        y: lerp(Math.max(0.05, topRoom * 0.45), 0.47, beside),
        radius: lerp(aboveRadius, besideRadius, beside),
    };
}
