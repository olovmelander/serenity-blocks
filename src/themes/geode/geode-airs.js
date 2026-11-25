/**
 * Geode — its airs, and what happens in it unasked (CPU only, three-free).
 *
 * The minerals turn the geode's colour by the clock (geode-core.js: mineralDrift). The airs turn its
 * LIGHT, on a clock of their own that never falls in step with the minerals' (77 s to their 90, so
 * the same mineral in the same air comes round once in eleven and a half hours): how hard the heart
 * burns and how white, how far its light carries down the wall, how much light comes through the
 * wall's thin places, whether the stones glow from within, how much spectral fire the facets throw,
 * whether a moonstone sheen crosses the lining, how thick the dust hangs and how hard it all
 * sparkles — and the grade the post lays over it. Five airs, each resting pure for a while and
 * then melting into the next:
 *
 *   radiance   the geode as it has always stood: a warm heart, a dark lining lit along its rim;
 *   blaze      the heart at its hottest: long rays in thick dust, the wall's thin places aglow;
 *   prism      the light split: fire wandering over the lining and flashing off every facet;
 *   embers     the heart sunk to a coal: the cavity goes dark and deep, the stones burn from
 *              within and the lining is all stars;
 *   moonstone  a cool silver light from the viewer's side, and a blue sheen crossing the lining.
 *
 * And between the player's own events the geode has visits: every twenty-odd seconds one thing
 * happens of its own accord, never the same kind twice running. Each is a pure function of the
 * world clock (nothing is stored), so a seek and a replay show the same visit at the same moment:
 *
 *   shimmer   a meridian of sparkle runs once round the lining;
 *   cascade   a ring of sparkle runs down the wall from the agate's rim to the viewer;
 *   chime     one hero cluster rings softly by itself, in its own mineral's colour;
 *   swell     the heart swells and sends one slow, wide ring of its own light down the wall;
 *   fall      a shower of crystal dust comes down through the cavity, glittering;
 *   fire      the spectral fire on the lining flares up and dies back.
 */

import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds the geode spends in each air when only the clock is turning it. */
export const AIR_PERIOD = 77;
/** The share of that time an air rests, pure, before it starts to melt into the next. */
export const AIR_HOLD = 0.52;

/**
 * heart       gain on the heart's light (it lights everything)
 * white       how far the heart's light is pulled toward white (0 = its mineral's own colour)
 * cool        how far it is pulled toward the fill's cool colour
 * fill        gain on the cool light from the viewer's side
 * thin        light coming through the wall's thin places (the lining glows from behind)
 * inner       the stones' own inner fire
 * fire        spectral fire on the facets and the lining
 * sheen       the moonstone sheen that crosses the lining
 * sparkle     gain on the lining's glints and stars
 * dust        gain on the dust in the air
 * reach       how far down the wall the heart's light carries (1 = as at rest)
 * rays        gain on the heart's rays in the dust
 * exposure    the iris for this air
 * warmth      the grade's cast on the lights (−1 cool .. 1 warm)
 * saturation  the grade's saturation lift
 * depth       how far the grade sinks the shadows (0..1)
 */
export const GEODE_AIRS = Object.freeze([
    Object.freeze({
        name: 'radiance',
        heart: 1.0,
        white: 0.0,
        cool: 0.0,
        fill: 1.0,
        thin: 0.5,
        inner: 0.0,
        fire: 0.3,
        sheen: 0.0,
        sparkle: 1.0,
        dust: 1.0,
        reach: 1.0,
        rays: 1.0,
        exposure: 1.0,
        warmth: 0.0,
        saturation: 0.0,
        depth: 0.0,
    }),
    Object.freeze({
        name: 'blaze',
        heart: 1.45,
        white: 0.0,
        cool: 0.0,
        fill: 0.7,
        thin: 1.0,
        inner: 0.1,
        fire: 0.45,
        sheen: 0.0,
        sparkle: 1.25,
        dust: 2.2,
        reach: 1.45,
        rays: 2.2,
        exposure: 0.86,
        warmth: 0.8,
        saturation: 0.08,
        depth: 0.25,
    }),
    Object.freeze({
        name: 'prism',
        heart: 1.05,
        white: 0.55,
        cool: 0.0,
        fill: 1.1,
        thin: 0.35,
        inner: 0.05,
        fire: 1.6,
        sheen: 0.15,
        sparkle: 1.7,
        dust: 1.2,
        reach: 1.15,
        rays: 1.2,
        exposure: 0.96,
        warmth: -0.15,
        saturation: 0.12,
        depth: 0.1,
    }),
    Object.freeze({
        name: 'embers',
        heart: 0.3,
        white: 0.0,
        cool: 0.0,
        fill: 0.4,
        thin: 1.2,
        inner: 1.0,
        fire: 0.2,
        sheen: 0.0,
        sparkle: 2.6,
        dust: 0.6,
        reach: 0.6,
        rays: 0.5,
        exposure: 1.12,
        warmth: 0.35,
        saturation: 0.14,
        depth: 0.6,
    }),
    Object.freeze({
        name: 'moonstone',
        heart: 0.62,
        white: 0.25,
        cool: 0.6,
        fill: 2.3,
        thin: 0.3,
        inner: 0.25,
        fire: 0.5,
        sheen: 1.0,
        sparkle: 1.6,
        dust: 1.0,
        reach: 1.1,
        rays: 0.8,
        exposure: 1.08,
        warmth: -0.7,
        saturation: 0.02,
        depth: 0.2,
    }),
]);

/** The numbers an air is made of, in the order airAt() writes them. */
export const AIR_KEYS = Object.freeze(Object.keys(GEODE_AIRS[0]).filter((key) => key !== 'name'));

/** How far the clock alone has turned the airs by `time` (whole part: airs passed; fraction: the melt). */
export const airDrift = (time) => moodDrift(time, AIR_PERIOD, AIR_HOLD);

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The air at `phase` of the wheel, written into `out` (every key of AIR_KEYS): on a whole phase
 * it is that air exactly, between two it is their mix.
 */
export function airAt(phase, out = {}) {
    wheelAt(phase, GEODE_AIRS.length, AT);
    const a = GEODE_AIRS[AT.a];
    const b = GEODE_AIRS[AT.b];
    for (let i = 0; i < AIR_KEYS.length; i++) {
        const key = AIR_KEYS[i];
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    return out;
}

/** The air a (whole or melting) phase is nearest to, by name. */
export const airName = (phase) => GEODE_AIRS[((Math.round(phase) % GEODE_AIRS.length) + GEODE_AIRS.length)
    % GEODE_AIRS.length].name;

// ── Visits ──────────────────────────────────────────────────────────────────────

/** Seconds from one visit's slot to the next. */
export const VISIT_PERIOD = 23;
/** The kinds of visit, and how long each lasts (seconds). */
export const VISIT_KINDS = Object.freeze(['shimmer', 'chime', 'fall', 'cascade', 'swell', 'fire']);
export const VISIT_LIFE = Object.freeze({
    shimmer: 6.5, chime: 5.5, fall: 9, cascade: 5, swell: 6, fire: 8,
});
/** The first visit waits this long after the clock starts (a new geode is seen at rest first). */
const VISIT_LEAD = 14;

/** A hash of an integer to [0, 1). */
function hash01(n) {
    let a = (Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
    a = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) >>> 0;
    a = Math.imul(a ^ (a >>> 12), 0x297a2d39) >>> 0;
    return ((a ^ (a >>> 15)) >>> 0) / 4294967296;
}

/**
 * The visit under way at `time`, written into `out`:
 *   kind   its name, or null between visits;
 *   index  which visit it is (its slot);
 *   age    seconds since it began, `life` how long it lasts, `k` = age / life;
 *   env    its envelope (0..1): in over the first sixth, out over the last third;
 *   seed, seedB   two numbers in [0, 1) that are its own.
 * Consecutive visits are never of one kind: they come in the order of VISIT_KINDS, and every
 * time round the order starts one kind later.
 */
export function visitAt(time, out = {}) {
    const t = Number.isFinite(time) ? time : 0;
    const index = Math.floor((t - VISIT_LEAD) / VISIT_PERIOD);
    out.kind = null;
    out.index = index;
    out.age = 0;
    out.life = 0;
    out.k = 0;
    out.env = 0;
    out.seed = 0;
    out.seedB = 0;
    if (index < 0) return out;
    const start = VISIT_LEAD + index * VISIT_PERIOD + hash01(index * 3 + 1) * (VISIT_PERIOD - 10);
    const count = VISIT_KINDS.length;
    const kind = VISIT_KINDS[(index + Math.floor(index / count)) % count];
    const life = VISIT_LIFE[kind];
    const age = t - start;
    if (age < 0 || age >= life) return out;
    out.kind = kind;
    out.age = age;
    out.life = life;
    out.k = age / life;
    out.env = visitEnvelope(out.k);
    out.seed = hash01(index * 3 + 2);
    out.seedB = hash01(index * 3 + 3);
    return out;
}

/** A visit's envelope at `k` of its life (0..1): in over the first sixth, out over the last third. */
export function visitEnvelope(k) {
    if (!(k > 0) || k >= 1) return 0;
    const rise = Math.min(1, k * 6);
    const fall = Math.min(1, (1 - k) * 3);
    return rise * rise * (3 - 2 * rise) * fall * fall * (3 - 2 * fall);
}

/**
 * One moment of one visit, for a capture: the visit of `kind`, `age` seconds in (null, or an age
 * outside its life, is no visit), written into `out` in visitAt()'s shape.
 */
export function visitHeld(kind, age, out = {}, seed = 0.37, seedB = 0.71) {
    const life = VISIT_LIFE[kind] || 0;
    const on = life > 0 && age >= 0 && age < life;
    out.kind = on ? kind : null;
    out.index = 0;
    out.age = on ? age : 0;
    out.life = on ? life : 0;
    out.k = on ? age / life : 0;
    out.env = on ? visitEnvelope(out.k) : 0;
    out.seed = seed;
    out.seedB = seedB;
    return out;
}
