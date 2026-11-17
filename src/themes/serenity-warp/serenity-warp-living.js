/**
 * Serenity Warp — the living warp (third pass, 2026-11): what changes by itself as time goes by,
 * and the shapes the board's events throw round the gate. Three-free: the world, the tests and
 * the CPU twins of the shaders import it.
 *
 *  - Moods. Beside the palettes' slow walk the warp itself changes its character on its own
 *    clock: how many arms it has (two or three), how tightly they wind, how fast the gas pours
 *    in, how many streamers of light run down them, how bright the open sky's nebula burns, how
 *    wide the throat stands and how many hot spots circle its ring. Four moods, one every
 *    MOOD_STEP seconds with a rest on each; a level moves one mood on as it moves one palette on.
 *  - Visitors. Every INFALL_EVERY seconds a wandering star is caught by the current: it comes in
 *    from the dark along an arm with its tail behind it, is torn out round the throat in an arc,
 *    and the ring flares in its colour as it goes in. Every COMET_EVERY seconds a comet crosses
 *    the open sky beyond the board, its tails blown straight away from the gate as a sun's wind
 *    blows a comet's.
 *  - Event shapes (FORM_KINDS), each its own form round the gate, so no two events are the same
 *    ring in another size: a twist unwinds an open pinwheel of light out of the rim; a back-to-
 *    back lights the Einstein cross (bright images of one light standing round the ring); a
 *    perfect clear crowns the gate with a corona of rays across the whole sky; a level opens a
 *    lotus of petals in the new palette's light; a chain's step sends a surge of light running
 *    down the arms INTO the throat. The game's end closes the gate to a pinhole for a while.
 */

import {
    TAU, clamp01, lerp, mulberry32, smooth,
} from './serenity-warp-core.js';
import { moodDrift } from '../shared/mood-clock.js';

// ── Moods ───────────────────────────────────────────────────────────────────────

/** Seconds the clock alone takes to move the warp one mood on, and the share it rests on each. */
export const MOOD_STEP = 117;
export const MOOD_HOLD = 0.4;

/**
 * The warp's moods, in the order the clock walks them (a wheel: the last melts into the first).
 *   arms3      0 = two arms, 1 = three
 *   wind       × how tightly the arms are wound
 *   inflow     × how fast the gas pours in
 *   streamers  the streamers of light down the arms (gain)
 *   nebula     the open sky's nebula (gain)
 *   throat     × the throat's width
 *   knots      the hot spots circling the photon ring (gain)
 *   reach      × how far out the vortex reaches
 */
export const WARP_MOODS = Object.freeze([
    Object.freeze({
        name: 'calm',
        arms3: 0,
        wind: 1.0,
        inflow: 1.0,
        streamers: 0.8,
        nebula: 1.0,
        throat: 1.0,
        knots: 0.55,
        reach: 1.0,
    }),
    Object.freeze({
        name: 'torrent',
        arms3: 1,
        wind: 1.26,
        inflow: 1.55,
        streamers: 1.35,
        nebula: 0.85,
        throat: 0.95,
        knots: 1.0,
        reach: 0.92,
    }),
    Object.freeze({
        name: 'bloom',
        arms3: 0,
        wind: 0.84,
        inflow: 0.85,
        streamers: 0.9,
        nebula: 1.45,
        throat: 1.12,
        knots: 0.7,
        reach: 1.18,
    }),
    Object.freeze({
        name: 'tide',
        arms3: 1,
        wind: 0.96,
        inflow: 1.2,
        streamers: 1.1,
        nebula: 1.2,
        throat: 1.04,
        knots: 0.85,
        reach: 1.1,
    }),
]);
export const MOOD_KEYS = Object.freeze(['arms3', 'wind', 'inflow', 'streamers', 'nebula', 'throat', 'knots', 'reach']);

/** Where the moods stand for a level's place (level − 1, eased) and the clock: the two add. */
export const moodPlace = (levelPlace, time) => levelPlace + moodDrift(time, MOOD_STEP, MOOD_HOLD);

/** A place on the wheel of moods as (index, next, mix). */
export function moodPhase(place) {
    const n = WARP_MOODS.length;
    const x = ((place % n) + n) % n;
    const index = Math.floor(x) % n;
    return { index, next: (index + 1) % n, mix: x - Math.floor(x) };
}

/** The mood at a place: every number mixed between two neighbours. Fills and returns `out`. */
export function moodAt(place, out = {}) {
    const { index, next, mix } = moodPhase(place);
    const a = WARP_MOODS[index];
    const b = WARP_MOODS[next];
    for (let i = 0; i < MOOD_KEYS.length; i++) out[MOOD_KEYS[i]] = lerp(a[MOOD_KEYS[i]], b[MOOD_KEYS[i]], mix);
    out.name = mix < 0.5 ? a.name : b.name;
    return out;
}

// ── The open sky ────────────────────────────────────────────────────────────────

/**
 * Seconds the open sky takes to turn once round the gate (a few pixels a second out at the
 * frame's edge), and how fast its clouds drift through the gas volume (units a second: a cloud
 * forms and melts over a minute or so).
 */
export const SKY_TURN = 2600;
export const CLOUD_DRIFT = 0.0021;

// ── Streamers ───────────────────────────────────────────────────────────────────

/**
 * Streamers: lanes of light at a constant turn of the vortex (each a logarithmic spiral, the
 * arms' own shape), broken into dashes that run down them into the throat. Lanes round the
 * gate and how many dashes a unit of log angle holds, per layer; how much faster than the gas
 * they run.
 */
export const STREAMER_LAYERS = Object.freeze([
    Object.freeze({
        lanes: 38, dashes: 2.2, seed: 1.7, gain: 1,
    }),
    Object.freeze({
        lanes: 67, dashes: 3.1, seed: 4.3, gain: 0.55,
    }),
]);
export const STREAMER_RUN = 2.4;

// ── Visitors ────────────────────────────────────────────────────────────────────

/** A wandering star caught by the current: one every INFALL_EVERY s, INFALL_RIDE s from the dark to the rim. */
export const INFALL_EVERY = 43;
export const INFALL_FIRST = 9;
export const INFALL_RIDE = 18;
/** Seconds the torn star takes to go in once it reaches the rim (its arc round the ring). */
export const INFALL_TEAR = 1.6;
/**
 * How far out a visitor is caught, and where its fall ends and its tearing begins, both as the
 * angle off the axis BEFORE the lens (β): the photon ring is β = 0, so the end is a sliver of the
 * throat's radius (INFALL_END) and the torn arc lies on the ring itself. Where the card's shadow
 * ends (INFALL_CLEAR) the visitor stands on the open side of the gate (see the world).
 */
export const INFALL_FROM = 0.95;
export const INFALL_END = 0.55;
export const INFALL_TORN = 0.37;
export const INFALL_CLEAR = 0.18;
export const VISITOR_SLOTS = 3;

/**
 * A wandering star's colour by its temperature (0 cool → 1 hot): ember orange, gold, then a
 * blue-white. Saturated beside the sky's own stars, or it would vanish on the white ring.
 */
export function starColorAt(t) {
    const a = clamp01(t * 2.2);
    const b = clamp01(t * 2 - 1);
    const warm = [1.0, lerp(0.42, 0.78, a), lerp(0.16, 0.42, a)];
    return [lerp(warm[0], 0.52, b), lerp(warm[1], 0.72, b), lerp(warm[2], 1.0, b)];
}

/**
 * The k-th wandering star (k ≥ 0): when it is caught, the turn of the vortex it rides, which way
 * round it orbits, its colour and size. A pure function of k, so a seek lands on the same sky.
 */
export function infallVisitor(k, seed = 0x5e7e) {
    const rand = mulberry32((seed ^ 0x1f3a) + k * 7919);
    const temp = rand();
    return {
        k,
        birth: INFALL_FIRST + k * INFALL_EVERY + (rand() - 0.5) * 9,
        turn: rand() * TAU,
        rgb: starColorAt(temp * 0.85 + 0.1),
        light: 0.8 + rand() * 0.6,
        size: 0.8 + rand() * 0.5,
    };
}

/**
 * How far in a visitor is `age` seconds after it was caught, as the log of its angle off the axis
 * (it drifts at first and falls faster as it nears: the gate's pull grows; a constant pace in log
 * angle would slow it on screen as it neared). `rim` = the throat's radius (radians).
 * Returns { L, tear }: tear 0 before it reaches the rim, rising to 1 as it goes in.
 */
export function infallPlace(age, rim) {
    const k = clamp01(age / INFALL_RIDE);
    const from = Math.log(INFALL_FROM);
    const to = Math.log(Math.max(1e-4, rim * INFALL_END));
    const L = lerp(from, to, k ** 1.15);
    const tear = age <= INFALL_RIDE ? 0 : clamp01((age - INFALL_RIDE) / INFALL_TEAR);
    return { L: tear > 0 ? lerp(to, Math.log(Math.max(1e-4, rim * INFALL_TORN)), smooth(0, 1, tear)) : L, tear };
}

/** A comet across the open sky: one every COMET_EVERY s, COMET_LIFE s in sight. */
export const COMET_EVERY = 151;
export const COMET_FIRST = 64;
export const COMET_LIFE = 27;

/**
 * The k-th comet's crossing, in screen fractions of the rest frame (y down): it comes in past the
 * frame's edge, bends a little toward the gate and leaves past the edge again. Its way is laid in
 * the open sky the layout leaves: right of the HUD on a landscape frame, the band below the card
 * on an upright one (the gate holds the band above it).
 */
export function cometPath(k, aspect, seed = 0x5e7e) {
    const rand = mulberry32((seed ^ 0x2c71) + k * 104729);
    const tall = aspect < 0.95;
    const flip = rand() < 0.5;
    if (tall) {
        const y0 = 0.885 + rand() * 0.05;
        const y1 = 0.9 + rand() * 0.07;
        const a = { x: 1.12, y: y0 };
        const b = { x: -0.12, y: y1 };
        return {
            from: flip ? b : a,
            to: flip ? a : b,
            bend: 0.05 + rand() * 0.04,
            light: 0.9 + rand() * 0.4,
            tail: 0.8 + rand() * 0.5,
        };
    }
    const x0 = 0.82 + rand() * 0.1;
    const x1 = 0.79 + rand() * 0.14;
    const a = { x: x0 + 0.1, y: -0.12 };
    const b = { x: x1, y: 1.12 };
    return {
        from: flip ? b : a,
        to: flip ? a : b,
        bend: 0.04 + rand() * 0.05,
        light: 0.9 + rand() * 0.4,
        tail: 0.8 + rand() * 0.5,
    };
}

/** Where on the crossing (0..1) a comet is `age` seconds after it came in (a little slower mid-sky). */
export const cometProgress = (age) => {
    const k = clamp01(age / COMET_LIFE);
    return k + 0.06 * Math.sin(k * TAU);
};

// ── Event shapes ────────────────────────────────────────────────────────────────

/** Event shapes held at once. */
export const FORM_SLOTS = 6;
/** The kinds (the shader's switch) and how long each lives (seconds). */
export const FORM_KINDS = Object.freeze({
    pinwheel: 1, cross: 2, corona: 3, petals: 4,
});
export const FORM_LIFE = Object.freeze({
    1: 1.9, 2: 1.5, 3: 3.4, 4: 2.6,
});

/** The open spiral of a twist: radians of turn an e-fold out (open: a tight one reads as rings), arms. */
export const PINWHEEL_WIND = 1.25;
export const PINWHEEL_ARMS = 5;
/** Petals of a level's lotus, rays of a crown's corona (two layers of sectors). */
export const PETALS = 6;
export const CORONA_SECTORS = Object.freeze([71, 29]);

/** A form's light `age` seconds after it was born (0 before and after its life): quick in, long out. */
export function formLight(kind, age) {
    const life = FORM_LIFE[kind] ?? 2;
    if (age < 0 || age > life) return 0;
    const rise = smooth(0, kind === 3 ? 0.22 : 0.09, age);
    return rise * (1 - smooth(life * 0.35, life, age));
}

/** How far out a form reaches (in throat radii) `age` seconds after it was born. */
export function formReach(kind, age) {
    const a = Math.max(0, age);
    if (kind === 1) return 1 + 6.5 * (1 - Math.exp(-a * 1.9));
    if (kind === 2) return 1.03 + 0.28 * (1 - Math.exp(-a * 2.4));
    if (kind === 3) return 1 + 14 * (1 - Math.exp(-a * 1.5));
    if (kind === 4) return 1 + 2.4 * (1 - Math.exp(-a * 2.1));
    return 1;
}

/** A chain's surge down the arms: seconds it takes from far out to the rim, and its width (log units). */
export const SURGE_RUN = 1.05;
export const SURGE_WIDTH = 0.2;
export const SURGE_FROM = 0.9;

/** Where a surge is `age` seconds after it set out (log of its angle off the axis), or null when gone. */
export function surgePlace(age, rim) {
    if (age < 0 || age > SURGE_RUN + 0.25) return null;
    const k = smooth(0, 1, age / SURGE_RUN);
    return lerp(Math.log(SURGE_FROM), Math.log(Math.max(1e-3, rim)), k);
}

// ── The game's end ──────────────────────────────────────────────────────────────

/** The gate closes at the end of a run: seconds to close, to hold shut, and to open again by itself. */
export const CLOSE_IN = 1.4;
export const CLOSE_HOLD = 7;
export const CLOSE_OPEN = 3.2;
/** How small the throat goes (× its width) and how much of its light it keeps when shut. */
export const CLOSED_THROAT = 0.16;
export const CLOSED_LIGHT = 0.35;

/** How shut the gate is (0 open → 1 shut) `since` seconds after the run ended. */
export function closedAt(since) {
    if (!(since >= 0)) return 0;
    if (since < CLOSE_IN) return smooth(0, CLOSE_IN, since);
    if (since < CLOSE_IN + CLOSE_HOLD) return 1;
    return 1 - smooth(0, CLOSE_OPEN, since - CLOSE_IN - CLOSE_HOLD);
}
