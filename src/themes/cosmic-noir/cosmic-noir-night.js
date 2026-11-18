/**
 * Cosmic Noir — the night's weather (three-free).
 *
 * The picture never holds one look for long. The night runs through five acts, round and round,
 * and a level-up moves it one act on (the clock and the level's steps simply add, as for the
 * print's stock, which drifts on a clock of its own: the two fall in and out of step, so an act
 * seldom comes back on the stock it wore last time):
 *
 *   clear     the home act: a hard, clean night. The galaxy stands whole over a black sea, the
 *             stars are sharp, the air is thin and the beam is a pencil.
 *   scud      torn cloud races in before the wind and crosses the galaxy, lit silver where it is
 *             thin; the sea begins to run.
 *   squall    the sky closes. Rain slants through the beam (it shows only where light is), the
 *             sea heaves and every roller breaks hard, and sheet lightning opens the whole
 *             picture for a moment: the cloud from inside, the sea as a sheet of pewter, the
 *             tower as a cut-out.
 *   clearing  the front has gone through: ragged cloud going home, a long swell, the galaxy
 *             back and brighter, a flicker now and then far out on the horizon.
 *   fog       the sea smokes. A bank lies on the water and the air is thick: the beams are
 *             solid bars, the slats' shadows stand in the air as a fan, the galaxy is a glow.
 *
 * Everything here is a pure function of a place on that round and of the clock, so a seek lands
 * on the same weather as running there. Lightning by itself falls on a fixed grid of moments (one
 * every STRIKE_GAP seconds may fire), each a soft swell of light, never a strobe.
 */

import { smooth } from './cosmic-noir-core.js';

/** Seconds the clock alone takes to carry the night one act along. A level-up is one step. */
export const NIGHT_STEP = 110;
/** The share of a step, at each end, the night rests on an act before it turns. */
export const NIGHT_REST = 0.28;

/**
 * cloud     how much of the sky the deck covers (0 .. 1)
 * mist      the mist lying on the sea, as a share of SEA.mist
 * haze      the air's own haze, as a share of SMOKE.haze (thick air: solid beams)
 * rain      0 .. 1
 * storm     how readily lightning falls (0 .. 1)
 * wind      the wind, as a share of its rest speed (the sea and the cloud run before it)
 * swell     the sea's heave and its rollers' height, as a share of rest
 * galaxy    the galaxy's light (in the sky and on the sea, the rock and the tower)
 * stars     the stars' light
 * glow      the night sky's own glow, as the sea mirrors it
 * rough     how broken the sea's mirror is (wind and rain roughen it)
 * fringe    the loose smoke lying on the sea's swells
 */
const FIELDS = Object.freeze([
    'cloud', 'mist', 'haze', 'rain', 'storm', 'wind', 'swell', 'galaxy', 'stars', 'glow', 'rough', 'fringe',
]);
/** An act: its name, and its numbers in the order of FIELDS. */
const act = (name, numbers) => {
    const made = { name };
    FIELDS.forEach((key, index) => {
        made[key] = numbers[index];
    });
    return Object.freeze(made);
};
export const NIGHT_ACTS = Object.freeze([
    act('clear', [0.05, 0.2, 1.0, 0, 0, 1.0, 1.0, 1.0, 1.0, 0.02, 1.0, 0.25]),
    act('scud', [0.5, 0.28, 1.1, 0, 0, 1.35, 1.12, 0.95, 0.9, 0.026, 1.25, 0.38]),
    act('squall', [0.94, 0.45, 1.22, 1, 1, 1.8, 1.38, 0.4, 0.1, 0.015, 1.9, 0.75]),
    act('clearing', [0.36, 0.4, 1.15, 0.1, 0.3, 1.2, 1.25, 1.08, 1.0, 0.025, 1.2, 0.5]),
    act('fog', [0.12, 2.4, 2.5, 0, 0, 0.55, 0.8, 0.55, 0.5, 0.03, 0.8, 1.0]),
]);
/** The act level 1 starts on. */
export const NIGHT_HOME = 0;

/** Where the night stands for a level's place and the clock: the two simply add. */
export const nightPlace = (levelPlace, time) => levelPlace + Math.max(0, time) / NIGHT_STEP;

/** A place on the round as (index, next, mix). */
export function nightPhase(place) {
    const count = NIGHT_ACTS.length;
    const x = (((place + NIGHT_HOME) % count) + count) % count;
    const index = Math.min(count - 1, Math.floor(x));
    return { index, next: (index + 1) % count, mix: smooth(NIGHT_REST, 1 - NIGHT_REST, x - index) };
}

/** The weather at a place: every number mixed between two neighbouring acts. Fills `out`. */
export function nightAt(place, out = {}) {
    const { index, next, mix } = nightPhase(place);
    const a = NIGHT_ACTS[index];
    const b = NIGHT_ACTS[next];
    for (let i = 0; i < FIELDS.length; i++) {
        const key = FIELDS[i];
        out[key] = a[key] + (b[key] - a[key]) * mix;
    }
    return out;
}

/** The name of the act a place stands nearest to. */
export function nightName(place) {
    const { index, next, mix } = nightPhase(place);
    return NIGHT_ACTS[mix < 0.5 ? index : next].name;
}

// ── Lightning ───────────────────────────────────────────────────────────────────

/** One moment in every this many seconds may hold a strike. */
export const STRIKE_GAP = 6.8;
/** A strike's light lasts this long (its swell and the glow that rolls after it). */
export const STRIKE_LIFE = 1.5;

/** A number in [0, 1) for a whole number and a salt. */
export function strikeHash(k, salt) {
    let a = (Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) >>> 0;
    a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d);
    a = Math.imul(a ^ (a >>> 12), 0x297a2d39);
    return ((a ^ (a >>> 15)) >>> 0) / 4294967296;
}

/**
 * The strike that may fall in slot `k` of the clock: when, how bright (0 .. 1, before the weather
 * says whether it falls at all), and where in the sky (a bearing right of the lighthouse and an
 * altitude, radians).
 */
export function strikeIn(k, out = {}) {
    out.at = (k + 0.15 + 0.7 * strikeHash(k, 1)) * STRIKE_GAP;
    out.gain = 0.45 + 0.55 * strikeHash(k, 2);
    out.chance = strikeHash(k, 3);
    out.bearing = -0.5 + 1.75 * strikeHash(k, 4);
    out.altitude = 0.1 + 0.26 * strikeHash(k, 5);
    return out;
}

/**
 * A strike's light (0 .. 1) `age` seconds after it fell: one quick swell and a slow glow rolling
 * after it through the cloud. One flash a strike: its light never comes back up inside a third of
 * a second (photosensitivity, ADR-0021).
 */
export function flashAt(age) {
    if (age < 0 || age > STRIKE_LIFE) return 0;
    const swell = (1 - Math.exp(-age / 0.022)) * Math.exp(-age / 0.11);
    const roll = 0.22 * Math.exp(-(((age - 0.74) / 0.26) ** 2));
    return Math.min(1, swell * 1.25 + roll);
}

const scratch = {};
/**
 * The lightning that falls by itself at a moment of the clock, for how stormy the night is
 * (0 .. 1). Fills `out` with its light (0 .. 1) and where it stands; a pure function of both.
 */
export function lightningAt(time, storm, out = {}) {
    out.light = 0;
    out.bearing = 0;
    out.altitude = 0.2;
    out.seed = 0;
    if (!(storm > 0.01) || !(time >= 0)) return out;
    const slot = Math.floor(time / STRIKE_GAP);
    for (let k = slot; k >= Math.max(0, slot - 1); k--) {
        const strike = strikeIn(k, scratch);
        // A quiet night lets few of them fall, and those few dim and low.
        if (strike.chance > storm) continue;
        const light = flashAt(time - strike.at) * strike.gain * (0.4 + 0.6 * storm);
        if (light > out.light) {
            out.light = light;
            out.bearing = strike.bearing;
            out.altitude = strike.altitude * (0.35 + 0.65 * storm);
            out.seed = strikeHash(k, 6);
        }
    }
    return out;
}
