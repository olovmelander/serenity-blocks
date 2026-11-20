// @ts-check
/**
 * Nimbus Veil — the air over the cloud sea and what happens in it by itself (three-free).
 *
 * The hours turn the LIGHT (nimbus-veil-moods.js). This turns the AIR, on a clock of its own
 * beside them: how much high cloud stands over the deck and of what kind, how thick the veils of
 * mist lie on it, how high its heads pile, how strongly the high cloud breaks the sun into beams
 * and shade, how far the eye reaches, how fast the high cloud streams. Five
 * airs of AIR_PERIOD seconds against five hours of MOOD_PERIOD: the two wheels have different
 * lengths, so an hour meets a different air every time it comes round (the pair repeats after
 * 88 minutes).
 *
 *   0  fair        a few high wisps, the deck as it always was
 *   1  tails       mares' tails: long fibres of high cloud streaming over on a quick wind
 *   2  mackerel    a rippled ceiling of small cloudlets, lit from below when the sun is low
 *   3  beams       a broken ceiling: its shadows drift over the deck and the sun fans into beams
 *   4  mist        the veils rise, the heads sink toward stratus, the far towers soften
 *
 * And between them the sky has happenings of its own, one to a slot of HAPPEN_SLOT seconds, with
 * quiet slots between: a skein of birds crossing the light, a drift of ice glitter, a tower that
 * boils up, and after dark shooting stars and heat lightning inside a far tower. Which one a
 * slot holds is a hash of its number, so a seek, a replay and a rebuild land on the same sky;
 * everything a happening shows is a function of its age.
 */

import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds an air lasts. */
export const AIR_PERIOD = 96;
/** The share of that time an air rests before it melts into the next. */
export const AIR_HOLD = 0.4;

/**
 * What an air sets:
 *   ceil    how much of the sky the high cloud covers (0 none .. 1 nearly all)
 *   ripple  its kind: 0 long fibres (cirrus), 1 rows of cloudlets (a mackerel sky)
 *   veil    how thick the veils of mist lie over the deck (1 = the plain day)
 *   heads   how high the deck's heads pile (1 = the plain day, lower = toward stratus)
 *   beams   how strongly the high cloud breaks the sun: shade drifting over the deck, the fan
 *   haze    how fast distance dissolves into the air (1 = the plain day)
 *   wind    how fast the high cloud streams
 */
export const AIR_KEYS = Object.freeze(['ceil', 'ripple', 'veil', 'heads', 'beams', 'haze', 'wind']);

/** @typedef {{ name: string, ceil: number, ripple: number, veil: number, heads: number, beams: number, haze: number, wind: number }} Air */

/** @type {ReadonlyArray<Readonly<Air>>} */
export const AIRS = Object.freeze([
    Object.freeze({
        name: 'fair', ceil: 0.34, ripple: 0.1, veil: 0.55, heads: 1.0, beams: 0.25, haze: 1.0, wind: 1.0,
    }),
    Object.freeze({
        name: 'tails', ceil: 0.66, ripple: 0.0, veil: 0.6, heads: 0.92, beams: 0.4, haze: 1.0, wind: 1.5,
    }),
    Object.freeze({
        name: 'mackerel', ceil: 0.88, ripple: 1.0, veil: 0.5, heads: 1.05, beams: 0.55, haze: 0.92, wind: 0.9,
    }),
    Object.freeze({
        name: 'beams', ceil: 0.56, ripple: 0.55, veil: 0.75, heads: 1.1, beams: 1.0, haze: 1.05, wind: 1.2,
    }),
    Object.freeze({
        name: 'mist', ceil: 0.42, ripple: 0.25, veil: 1.45, heads: 0.62, beams: 0.5, haze: 1.32, wind: 0.6,
    }),
]);

export const AIR_COUNT = AIRS.length;

const AT = { a: 0, b: 0, melt: 0 };

/**
 * Where the air stands on its wheel at `time`: the whole part names an air, the fraction is how
 * far it has melted into the next.
 * @param {number} time
 */
export function airPhase(time) {
    return moodDrift(time, AIR_PERIOD, AIR_HOLD);
}

/**
 * The air at `phase` round its wheel, written into `out` (every key of AIR_KEYS, and `name`: the
 * nearer of the two it stands between). Returns `out`.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function airAt(phase, out = {}) {
    wheelAt(phase, AIR_COUNT, AT);
    const a = AIRS[AT.a];
    const b = AIRS[AT.b];
    for (let i = 0; i < AIR_KEYS.length; i += 1) {
        const key = AIR_KEYS[i];
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    out.name = AT.melt < 0.5 ? a.name : b.name;
    return out;
}

/** The index of the air called `name` (-1 when there is none): a capture's `air=` parameter. */
export function airIndex(name) {
    return AIRS.findIndex((air) => air.name === name);
}

// ── Happenings ──────────────────────────────────────────────────────────────────

/** Seconds a happening's slot lasts. One slot holds one happening or none. */
export const HAPPEN_SLOT = 36;
/** The share of slots that stay quiet. */
export const HAPPEN_QUIET = 0.26;

/**
 * The happenings: how long each lasts and when it may come (`day`: while the sun is up, `dusk`:
 * while it is going, `night`: once the stars are out).
 * @type {Readonly<Record<string, Readonly<{ dur: number, day: boolean, dusk: boolean, night: boolean }>>>}
 */
export const HAPPENINGS = Object.freeze({
    /** A skein of birds crosses the light, edge to edge, whole from its first bird. */
    skein: Object.freeze({
        dur: 26, day: true, dusk: true, night: false,
    }),
    /** A drift of ice crystals glitters past, toward the sun. */
    glitter: Object.freeze({
        dur: 18, day: true, dusk: true, night: true,
    }),
    /** One tower boils up: its crown swells and climbs, then settles. */
    boil: Object.freeze({
        dur: 24, day: true, dusk: true, night: false,
    }),
    /** Shooting stars. */
    meteor: Object.freeze({
        dur: 16, day: false, dusk: false, night: true,
    }),
    /** Heat lightning, silent, inside a far tower. */
    flicker: Object.freeze({
        dur: 14, day: false, dusk: true, night: true,
    }),
});

export const HAPPENING_KINDS = Object.freeze(Object.keys(HAPPENINGS));

/** An integer hash to [0, 1): the same slot always draws the same numbers. */
export function slotHash(slot, salt = 0) {
    let x = Math.imul((slot | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((salt | 0) + 1, 0xc2b2ae35);
    x ^= x >>> 15;
    x = Math.imul(x, 0x2c1b3c6d);
    x ^= x >>> 12;
    x = Math.imul(x, 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
}

/** The slot `time` falls in. */
export function happeningSlot(time) {
    return Math.floor(Math.max(0, Number(time) || 0) / HAPPEN_SLOT);
}

/**
 * Which happening a slot holds, or null for a quiet one. `stars` is the starlight at the slot's
 * start (0 by day, 1 at night): it picks the list the slot draws from.
 * @param {number} slot
 * @param {number} stars
 * @returns {string | null}
 */
export function happeningKind(slot, stars) {
    if (slotHash(slot, 1) < HAPPEN_QUIET) return null;
    let when = 'day';
    if (stars > 0.5) when = 'night';
    else if (stars > 0.05) when = 'dusk';
    let count = 0;
    for (let i = 0; i < HAPPENING_KINDS.length; i += 1) {
        if (HAPPENINGS[HAPPENING_KINDS[i]][when]) count += 1;
    }
    let pick = Math.min(count - 1, Math.floor(slotHash(slot, 2) * count));
    for (let i = 0; i < HAPPENING_KINDS.length; i += 1) {
        if (!HAPPENINGS[HAPPENING_KINDS[i]][when]) continue;
        if (pick === 0) return HAPPENING_KINDS[i];
        pick -= 1;
    }
    return null;
}

/**
 * The happening of `kind` in `slot` at `time`, written into `out`: `kind` (null while it has not
 * begun or is over), `age` seconds, `dur`, `u` (age / dur) and `seed` (its own number in [0, 1)).
 * A happening begins a little into its slot and always ends inside it.
 * @param {string | null} kind
 * @param {number} slot
 * @param {number} time
 * @param {{ kind: string | null, age: number, dur: number, u: number, seed: number }} [out]
 */
export function happeningState(kind, slot, time, out = {
    kind: null, age: 0, dur: 1, u: 0, seed: 0,
}) {
    const o = out;
    o.kind = null;
    o.age = 0;
    o.u = 0;
    o.dur = 1;
    o.seed = slotHash(slot, 3);
    const spec = kind ? HAPPENINGS[kind] : null;
    if (!spec) return o;
    const slack = Math.max(0, HAPPEN_SLOT - spec.dur - 2);
    const start = slot * HAPPEN_SLOT + 1 + slotHash(slot, 4) * slack;
    const age = time - start;
    o.dur = spec.dur;
    if (age < 0 || age > spec.dur) return o;
    o.kind = kind;
    o.age = age;
    o.u = age / spec.dur;
    return o;
}

/** A soft rise and fall over a happening's life: 0 at both ends, 1 through the middle. */
export function happeningEnvelope(u, rise = 0.18, fall = 0.25) {
    if (!(u > 0) || !(u < 1)) return 0;
    const a = Math.min(1, u / rise);
    const b = Math.min(1, (1 - u) / fall);
    const k = Math.min(a, b);
    return k * k * (3 - 2 * k);
}
