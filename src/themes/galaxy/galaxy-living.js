/**
 * Galaxy — what changes by itself (three-free: the world, the playground and the tests read it).
 *
 * The palettes (galaxy-core.js) turn the galaxy's COLOURS by the clock. This turns its FORM:
 *
 *   the airs        five states the galaxy passes through on a clock of its own (127 s an air,
 *                   against the palettes' 100 s, so a palette meets a different air every round):
 *                   how hard its nurseries burn, how thick its dust lies, how bright its heart is,
 *                   how tightly its arms wind and how far it leans back from the eye;
 *   the happenings  every half minute or so something happens that no one played: a supernova in
 *                   an arm, a ripple of star formation running down one, a shower of shooting
 *                   stars, the nucleus stirring, a flash in the companion.
 *
 * Both are pure functions of the clock (a seek and a replay agree), and neither is gated by
 * reduced motion except where it moves the picture (the lean and the winding).
 */

import { moodDrift, wheelAt } from '../shared/mood-clock.js';
import { mulberry32 } from './galaxy-core.js';

/**
 * The airs. Every number is a factor on the rest look (1 = as it is at rest) unless noted:
 *   knots   the star-forming knots and the nurseries' own glow
 *   young   the young light of the arms
 *   dust    how much the lanes hold
 *   core    the bulge
 *   halo    the old light far round the galaxy
 *   clouds  the lit clouds of the deep sky
 *   jets    ADDED to the jets' standing light (0 = the faint stub of rest)
 *   stars   ADDED to the far stars' light
 *   wind    ADDED to the arms' winding (negative opens them)
 *   lean    degrees ADDED to how far the disc leans back (negative shows more of its face)
 *   tilt    degrees ADDED to the turn of its long axis
 */
export const AIRS = Object.freeze([
    Object.freeze({
        name: 'clear', knots: 1, young: 1, dust: 1, core: 1, halo: 1, clouds: 1, jets: 0, stars: 0, wind: 0, lean: 0, tilt: 0,
    }),
    // Star formation runs hot: the arms are strung with burning knots and open their face a little.
    Object.freeze({
        name: 'starburst', knots: 1.6, young: 1.22, dust: 0.88, core: 0.96, halo: 1.1, clouds: 1.1, jets: 0, stars: 0.1, wind: -0.1, lean: -5, tilt: 2,
    }),
    // The dust lies thick: dark lanes cross the bulge, which glows through them, nearer edge-on.
    Object.freeze({
        name: 'veiled', knots: 0.9, young: 0.86, dust: 1.8, core: 1.1, halo: 1.4, clouds: 0.75, jets: 0, stars: 0, wind: 0.06, lean: 7, tilt: -3,
    }),
    // The nucleus is awake: its heart and its halo burn, faint jets stand along the axis.
    Object.freeze({
        name: 'awake', knots: 1.05, young: 1, dust: 1.05, core: 1.28, halo: 1.9, clouds: 1.3, jets: 0.2, stars: 0.16, wind: 0.1, lean: 2, tilt: 4,
    }),
    // The arms open wide and the disc shows its face.
    Object.freeze({
        name: 'tide', knots: 1.15, young: 1.1, dust: 1.2, core: 1, halo: 1, clouds: 0.9, jets: 0, stars: 0.05, wind: -0.22, lean: -8, tilt: -5,
    }),
]);

export const AIR_KEYS = Object.freeze([
    'knots', 'young', 'dust', 'core', 'halo', 'clouds', 'jets', 'stars', 'wind', 'lean', 'tilt',
]);

/** Seconds the galaxy rests in an air and melts into the next, and the share of it that is rest. */
export const AIR_SECONDS = 127;
export const AIR_HOLD = 0.4;

/** How far the clock alone has turned the airs by `time` (whole part = airs passed). */
export const airDrift = (time) => moodDrift(time, AIR_SECONDS, AIR_HOLD);

const AT = { a: 0, b: 0, melt: 0 };

/** The air at `phase` round the wheel, written into `out` (every key, and `name` of the nearer). */
export function airAt(phase, out = {}) {
    wheelAt(phase, AIRS.length, AT);
    const a = AIRS[AT.a];
    const b = AIRS[AT.b];
    for (let i = 0; i < AIR_KEYS.length; i++) {
        const key = AIR_KEYS[i];
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    out.name = AT.melt < 0.5 ? a.name : b.name;
    return out;
}

// ── Happenings ──────────────────────────────────────────────────────────────────

/** Seconds between two happenings, and when the first one comes. */
export const HAPPEN_BEAT = 29;
export const HAPPEN_FIRST = 13;

/** What can happen. The order is the order a round deals them in (a nova opens it). */
export const HAPPENINGS = Object.freeze(['nova', 'ripple', 'shower', 'stir', 'nova', 'flash', 'ripple']);

/** Which beat the clock stands in at `time` (−1 before the first). */
export function happeningBeat(time) {
    return time < HAPPEN_FIRST ? -1 : Math.floor((time - HAPPEN_FIRST) / HAPPEN_BEAT);
}

/**
 * What happens on beat `index`: its kind, the moment it starts (exact, so two frame rates agree)
 * and three numbers in [0, 1) of its own to place and colour it.
 */
export function happeningAt(index, out = {}) {
    const i = Math.max(0, Math.round(index));
    const rand = mulberry32(0x9e3779b1 + i * 0x85ebca6b);
    // Every round of seven deals each kind in a different turn of the wheel.
    const round = Math.floor(i / HAPPENINGS.length);
    out.index = i;
    out.kind = HAPPENINGS[(i + round * 3) % HAPPENINGS.length];
    out.time = HAPPEN_FIRST + i * HAPPEN_BEAT + rand() * 6;
    out.a = rand();
    out.b = rand();
    out.c = rand();
    return out;
}
