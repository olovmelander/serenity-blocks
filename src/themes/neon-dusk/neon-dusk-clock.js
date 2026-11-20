// @ts-check
/**
 * Neon Dusk — the clocks that keep the dusk from standing still (three-free).
 *
 * The moods (neon-dusk-moods.js) turn the COLOUR of the light. These turn everything else, each on
 * a period of its own so that the pairings never repeat for long:
 *
 *   the airs        what hangs in the sky: a clear dusk, thick cloud bars burning across the sun,
 *                   a deep sky with the galaxy standing bright, a haze with the sun's rays fanned
 *                   out in it, and the lattice (the dome's own grid showing overhead)
 *   the sky's turn  the stars and the galaxy wheel about a pole above the frame
 *   the planet      a ringed world rises beside the pass, arcs over the sun and sets again
 *   the sun         it stands a little higher or lower in the pass
 *   the happenings  now and then something crosses the picture: a meteor shower, a comet, a
 *                   satellite, lights racing out along the grid
 *
 * Every one is a function of the time alone, so a seek, a replay and a rebuild that carries the
 * clock land on the same picture. At time 0 the air is `clear` and the sun stands where it was
 * authored: with mood 0 that is the look the theme opens on.
 */

import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds an air lasts, and the share of it that it rests, pure, before melting into the next. */
export const AIR_PERIOD = 76;
export const AIR_HOLD = 0.4;

/**
 * The airs, in the order the clock turns through them:
 *   cloud    how thick the cloud bars lie across the sun (0 = the thin lenses of a clear dusk)
 *   deep     the deep sky: the galaxy's light and its crowd of faint stars
 *   stars    scales the starlight on top of the mood's
 *   haze     the air round the sun: its glow widens and its rays stand in it
 *   lattice  the dome's own grid, overhead
 *   calm     how still the glass lies (1 = a clean mirror; the ripples ease off)
 * @type {ReadonlyArray<Readonly<{ name: string, cloud: number, deep: number, stars: number, haze: number, lattice: number, calm: number }>>}
 */
export const AIRS = Object.freeze([
    Object.freeze({
        name: 'clear', cloud: 0, deep: 0.38, stars: 1, haze: 0, lattice: 0, calm: 0,
    }),
    Object.freeze({
        name: 'cloud bars', cloud: 1, deep: 0.16, stars: 0.75, haze: 0.2, lattice: 0, calm: 0,
    }),
    Object.freeze({
        name: 'deep sky', cloud: 0, deep: 1, stars: 1.35, haze: 0, lattice: 0, calm: 0.8,
    }),
    Object.freeze({
        name: 'haze', cloud: 0.3, deep: 0.08, stars: 0.55, haze: 1, lattice: 0, calm: 0.2,
    }),
    Object.freeze({
        name: 'lattice', cloud: 0, deep: 0.5, stars: 1.1, haze: 0, lattice: 1, calm: 0.4,
    }),
]);

export const AIR_COUNT = AIRS.length;
/** The scalars an air sets (everything but its name). */
export const AIR_KEYS = Object.freeze(['cloud', 'deep', 'stars', 'haze', 'lattice', 'calm']);

const AT = { a: 0, b: 0, melt: 0 };

/** Where the airs stand at `time` (plus `shift` whole airs): the whole part names one. */
export function airPhase(time, shift = 0) {
    return shift + moodDrift(time, AIR_PERIOD, AIR_HOLD);
}

/**
 * The air at `phase` round the wheel, written into `out` (one number a key of AIR_KEYS).
 * @param {number} phase
 * @param {Record<string, number>} [out]
 */
export function airAt(phase, out = {}) {
    wheelAt(phase, AIR_COUNT, AT);
    const a = AIRS[AT.a];
    const b = AIRS[AT.b];
    for (let i = 0; i < AIR_KEYS.length; i += 1) {
        const key = AIR_KEYS[i];
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    return out;
}

/** The name of the air nearest `phase`. */
export function airName(phase) {
    const k = ((Math.round(Number.isFinite(phase) ? phase : 0) % AIR_COUNT) + AIR_COUNT) % AIR_COUNT;
    return AIRS[k].name;
}

// ── The sky's turn ──────────────────────────────────────────────────────────────

/**
 * The pole the stars wheel about: above the frame over the pass, so no lens ever sees it (the
 * star lattice is squeezed there) and the stars low over the ranges slide sideways.
 */
export const SKY_POLE = Object.freeze({ azimuth: 0.3, elevation: 1.12 });
/** Seconds the sky takes to turn once, and how far a level turns it on top (radians). */
export const SKY_TURN_SECONDS = 2400;
export const SKY_TURN_PER_LEVEL = 0.14;

/** How far the sky has turned (radians) at `time` with the level's eased `step`. */
export function skyTurn(time, step = 0) {
    return ((Math.max(0, time) / SKY_TURN_SECONDS) * Math.PI * 2 + step * SKY_TURN_PER_LEVEL) % (Math.PI * 2);
}

// ── The planet ──────────────────────────────────────────────────────────────────

/**
 * The ringed planet's round: `period` seconds, of which it is `up` (a share) above the horizon,
 * crossing from `from` to `to` (azimuth, radians from the sun's bearing) and standing `peak`
 * (radians) high at the top of its arc; `phase0` is where the round stands at time 0 (it opens
 * past the top of its arc, right of the sun). `radius` is the globe's angular radius.
 */
export const PLANET = Object.freeze({
    period: 560, up: 0.74, from: -0.2, to: 0.27, low: 0.06, peak: 0.4, phase0: 0.43, radius: 0.04,
});

/**
 * Where the planet stands at `time`: its azimuth and elevation (radians), how far it is through
 * its arc (`arc`, 0..1, or −1 while it is down) and its rings' roll and opening.
 * @param {number} time
 * @param {{ azimuth: number, elevation: number, arc: number, roll: number, open: number, up: number }} [out]
 */
export function planetAt(time, out = {
    azimuth: 0, elevation: 0, arc: 0, roll: 0, open: 0, up: 0,
}) {
    const P = PLANET;
    const turn = (((Math.max(0, time) / P.period + P.phase0) % 1) + 1) % 1;
    const arc = turn / P.up;
    const s = Math.min(1, arc);
    out.azimuth = P.from + (P.to - P.from) * s;
    out.elevation = arc <= 1
        ? P.low + (P.peak - P.low) * Math.sin(Math.PI * s)
        // Down: it rides on under the horizon, out of every lens.
        : -0.2;
    out.arc = arc <= 1 ? arc : -1;
    out.up = arc <= 1 ? 1 : 0;
    // The rings tip a little as it crosses, and open and close over a few rounds.
    out.roll = -0.42 + 0.5 * s;
    out.open = 0.3 + 0.12 * Math.sin((time / (P.period * 3.1)) * Math.PI * 2 + 0.6);
    return out;
}

// ── The sun's height ────────────────────────────────────────────────────────────

/** The sun rides this far up and down in the pass (radians) once in this many seconds. */
export const SUN_DRIFT = Object.freeze({ reach: 0.02, period: 410 });

/** The sun's offset from its authored elevation at `time` (0 at time 0). */
export function sunDrift(time) {
    return SUN_DRIFT.reach * Math.sin((Math.max(0, time) / SUN_DRIFT.period) * Math.PI * 2);
}

// ── The happenings ──────────────────────────────────────────────────────────────

/** One happening may begin in each window of this many seconds. */
export const HAPPENING_PERIOD = 27;

/**
 * The kinds, with how often each is drawn (`weight`) and how long it lasts (s). `none` is a
 * window in which nothing comes.
 */
export const HAPPENINGS = Object.freeze([
    Object.freeze({ kind: 'none', weight: 2, duration: 0 }),
    Object.freeze({ kind: 'meteors', weight: 3, duration: 6 }),
    Object.freeze({ kind: 'racers', weight: 3, duration: 7 }),
    Object.freeze({ kind: 'comet', weight: 2, duration: 22 }),
    Object.freeze({ kind: 'satellite', weight: 2, duration: 16 }),
    Object.freeze({ kind: 'flight', weight: 3, duration: 15 }),
]);

/** A small deterministic generator for one window (so a seek replays the same happening). */
export function windowRandom(k, salt = 0x5bd1e995) {
    let s = (Math.imul(k | 0, 0x9e3779b1) ^ salt) >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WEIGHT_SUM = HAPPENINGS.reduce((sum, h) => sum + h.weight, 0);

/**
 * The happening of window `k`: its kind, when it begins (s), how long it lasts and a generator
 * for its own numbers. The same kind never comes twice running: a window that draws what the
 * window before it drew stays quiet instead.
 * @param {number} k
 */
export function happeningOf(k) {
    const pick = (index) => {
        const r = windowRandom(index, 0x2f6b1d35);
        let at = r() * WEIGHT_SUM;
        let chosen = HAPPENINGS[0];
        for (const h of HAPPENINGS) {
            at -= h.weight;
            if (at < 0) {
                chosen = h;
                break;
            }
        }
        return { chosen, r };
    };
    const drawn = pick(k);
    const { r } = drawn;
    // Drawn again: a quiet window.
    const chosen = k > 0 && pick(k - 1).chosen.kind === drawn.chosen.kind ? HAPPENINGS[0] : drawn.chosen;
    const room = Math.max(1, HAPPENING_PERIOD - 4 - Math.min(chosen.duration, HAPPENING_PERIOD - 6));
    return {
        kind: chosen.kind,
        start: k * HAPPENING_PERIOD + 2 + r() * room,
        duration: chosen.duration,
        random: r,
    };
}
