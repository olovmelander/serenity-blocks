/**
 * Sunset — the hours: the light the sea is seen in (CPU only, three-free).
 *
 * The eye looks west, and the day turns in front of it. Six hours stand on a wheel in the order
 * they come, which is also the order of their hues, so no two neighbours mix through grey:
 *
 *   golden     the sun a hand above the sea, everything gold
 *   sunset     the sun on the water, the clouds on fire from beneath
 *   afterglow  the sun gone under, a rose band on the horizon under violet, the first stars
 *   night      the moon riding down the western sky, its road on the sea, the Milky Way
 *   dawn       first light from behind the eye: the moon low and amber over the pink belt and
 *              the blue shadow of the world
 *   day        the afternoon, the sun still high and out of the picture, a trade-wind blue
 *
 * and round again to golden hour as the sun comes down into the picture.
 *
 * Where the light stands on the wheel is one number, the place:
 *
 *     place = (level − 1) + clock / HOUR_SECONDS
 *
 * so a new level turns it one whole hour (eased over TURN_SECONDS: the sun and the stars are seen
 * to run) and the clock turns it by itself, slowly, in every mode, the ones that never level
 * included. Both simply add. Within an hour the light rests on that hour's own colours for a
 * short share of the time at each end (HOUR_REST) and is on its way to the next in between.
 *
 * Every colour is scene-linear. The sun and the moon are not colours but places: each hour says
 * how far round its circle either one has come (`sunTurn`, `moonTurn`: degrees above the western
 * horizon, falling all the time; see bodyDirection in sunset-core.js), and the wheel carries them
 * on from hour to hour, under the sea and over the eye's head, without ever turning back.
 */
import { lerp, smooth } from './sunset-core.js';

/** Seconds of the world's clock one hour lasts when no level turns it. */
export const HOUR_SECONDS = 96;
/** The share of an hour, at each end, the light rests on that hour's own colours. */
export const HOUR_REST = 0.15;
/** A new level turns the wheel one hour in this many seconds. */
export const TURN_SECONDS = 3.6;

/**
 * An hour's colours, in the order of the uniform rows the shaders read:
 *   zenithSun, zenithFar     overhead: toward the sun and away from it
 *   midSun, midFar           the belt over the horizon
 *   horizonSun, horizonFar   the sky's lowest band
 *   sunBloom, sunAureole     the sun's wide glow and its tight one
 *   sunDisc                  the disc itself
 *   moonGlow, moonDisc       the moon's glow and its face
 *   cloudLit, cloudShade     a cloud where the light strikes it, and where it does not
 *   cloudDeep                the heart of a thick one
 *   cloudRim                 its lining, seen against the light
 *   cirrus                   the high thin cloud, which keeps the light longest
 *   seaDeep, seaScatter      the water looked down into, and the light that comes back out of it
 *   sunGlint, moonGlint      the sun's road on the sea, and the moon's
 *   haze                     the air over the far sea
 *   ambient                  the sky's light on things (a lantern's paper, a bird's back)
 *   shaft                    the colour the lens gives the shafts
 *   gradeShadow, gradeLight  what the darks and the lights of the picture lean toward
 */
export const HOUR_COLOURS = Object.freeze([
    'zenithSun', 'zenithFar', 'midSun', 'midFar', 'horizonSun', 'horizonFar',
    'sunBloom', 'sunAureole', 'sunDisc',
    'moonGlow', 'moonDisc',
    'cloudLit', 'cloudShade', 'cloudDeep', 'cloudRim', 'cirrus',
    'seaDeep', 'seaScatter', 'sunGlint', 'moonGlint', 'haze',
    'ambient', 'shaft', 'gradeShadow', 'gradeLight',
]);

/**
 * An hour's plain numbers:
 *   stars      how far the stars are out (0..1)
 *   exposure   the lens
 *   cover      how much of the sky the cloud deck takes (0..1)
 *   fire       0: clouds are lit from above (day); 1: from beneath (the sun on the horizon)
 *   moonKey    0: the sun lights the clouds; 1: the moon does
 *   lantern    how brightly a lantern's flame shows against the hour (0..1)
 *   birds      how many of the birds are on the wing (0..1)
 */
export const HOUR_SCALARS = Object.freeze(['stars', 'exposure', 'cover', 'fire', 'moonKey', 'lantern', 'birds']);

/** The turning numbers: where the sun and the moon stand on their circles (degrees, falling). */
export const HOUR_TURNS = Object.freeze(['sunTurn', 'moonTurn']);

const hour = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value) : value,
    ])),
});

export const HOURS = Object.freeze([
    // Golden hour: a gold sun a hand above the sea, cream cloud, teal water.
    hour('golden', {
        zenithSun: [0.085, 0.18, 0.43],
        zenithFar: [0.05, 0.125, 0.37],
        midSun: [0.62, 0.42, 0.24],
        midFar: [0.2, 0.29, 0.49],
        horizonSun: [1.05, 0.5, 0.13],
        horizonFar: [0.4, 0.35, 0.5],
        sunBloom: [0.5, 0.25, 0.075],
        sunAureole: [1.5, 0.82, 0.28],
        sunDisc: [1.0, 0.84, 0.52],
        moonGlow: [0, 0, 0],
        moonDisc: [0.5, 0.5, 0.5],
        cloudLit: [1.8, 1.02, 0.4],
        cloudShade: [0.4, 0.31, 0.36],
        cloudDeep: [0.24, 0.21, 0.3],
        cloudRim: [2.6, 1.7, 0.8],
        cirrus: [1.15, 0.86, 0.62],
        seaDeep: [0.012, 0.05, 0.075],
        seaScatter: [0.03, 0.17, 0.14],
        sunGlint: [3.2, 2.0, 0.8],
        moonGlint: [0, 0, 0],
        haze: [0.66, 0.4, 0.22],
        ambient: [0.62, 0.52, 0.5],
        shaft: [1.25, 0.98, 0.7],
        gradeShadow: [0.94, 1.0, 1.08],
        gradeLight: [1.05, 1.0, 0.93],
        stars: 0,
        exposure: 0.82,
        cover: 0.5,
        fire: 0.45,
        moonKey: 0,
        lantern: 0.55,
        birds: 1,
        sunTurn: 9.5,
        moonTurn: -170,
    }),
    // Sunset: the sun a red coal on the water, crimson under violet, the clouds lit from beneath.
    hour('sunset', {
        zenithSun: [0.05, 0.075, 0.3],
        zenithFar: [0.026, 0.05, 0.23],
        midSun: [0.72, 0.17, 0.15],
        midFar: [0.12, 0.08, 0.3],
        horizonSun: [0.98, 0.2, 0.034],
        horizonFar: [0.3, 0.13, 0.3],
        sunBloom: [0.45, 0.075, 0.012],
        sunAureole: [0.62, 0.13, 0.02],
        sunDisc: [1.0, 0.6, 0.075],
        moonGlow: [0, 0, 0],
        moonDisc: [0.5, 0.5, 0.5],
        cloudLit: [2.5, 0.6, 0.13],
        cloudShade: [0.27, 0.12, 0.27],
        cloudDeep: [0.11, 0.065, 0.19],
        cloudRim: [3.0, 1.0, 0.25],
        cirrus: [1.4, 0.42, 0.42],
        seaDeep: [0.02, 0.03, 0.072],
        seaScatter: [0.045, 0.1, 0.11],
        sunGlint: [3.4, 0.9, 0.18],
        moonGlint: [0, 0, 0],
        haze: [0.6, 0.17, 0.1],
        ambient: [0.5, 0.36, 0.5],
        shaft: [1.3, 0.82, 0.6],
        gradeShadow: [0.95, 0.95, 1.12],
        gradeLight: [1.07, 0.99, 0.92],
        stars: 0,
        exposure: 0.76,
        cover: 0.56,
        fire: 1,
        moonKey: 0,
        lantern: 0.72,
        birds: 0.8,
        sunTurn: 1.4,
        moonTurn: -215,
    }),
    // Afterglow: the sun under the sea, a rose band on the horizon, violet over it, the first stars.
    hour('afterglow', {
        zenithSun: [0.03, 0.046, 0.2],
        zenithFar: [0.015, 0.03, 0.15],
        midSun: [0.4, 0.13, 0.4],
        midFar: [0.05, 0.05, 0.23],
        horizonSun: [1.0, 0.22, 0.13],
        horizonFar: [0.14, 0.11, 0.28],
        sunBloom: [0.5, 0.12, 0.12],
        sunAureole: [1.1, 0.36, 0.26],
        sunDisc: [1.0, 0.36, 0.14],
        moonGlow: [0, 0, 0],
        moonDisc: [0.6, 0.62, 0.7],
        cloudLit: [1.45, 0.28, 0.42],
        cloudShade: [0.19, 0.1, 0.26],
        cloudDeep: [0.06, 0.05, 0.16],
        cloudRim: [1.5, 0.55, 0.55],
        cirrus: [1.45, 0.38, 0.62],
        seaDeep: [0.012, 0.02, 0.06],
        seaScatter: [0.02, 0.05, 0.1],
        sunGlint: [0, 0, 0],
        moonGlint: [0, 0, 0],
        haze: [0.42, 0.18, 0.25],
        ambient: [0.24, 0.2, 0.42],
        shaft: [1.15, 0.8, 0.9],
        gradeShadow: [0.94, 0.95, 1.14],
        gradeLight: [1.05, 0.98, 0.98],
        stars: 0.34,
        exposure: 0.8,
        cover: 0.5,
        fire: 1,
        moonKey: 0,
        lantern: 0.9,
        birds: 0.35,
        sunTurn: -5,
        moonTurn: -290,
    }),
    // Night: the moon riding down the western sky, silver on the sea, the Milky Way over it.
    hour('night', {
        zenithSun: [0.008, 0.016, 0.06],
        zenithFar: [0.005, 0.01, 0.044],
        midSun: [0.026, 0.044, 0.125],
        midFar: [0.013, 0.024, 0.08],
        horizonSun: [0.055, 0.085, 0.2],
        horizonFar: [0.03, 0.046, 0.115],
        sunBloom: [0, 0, 0],
        sunAureole: [0, 0, 0],
        sunDisc: [1.0, 0.36, 0.14],
        moonGlow: [0.085, 0.13, 0.26],
        moonDisc: [0.95, 0.97, 1.0],
        cloudLit: [0.3, 0.38, 0.58],
        cloudShade: [0.036, 0.05, 0.12],
        cloudDeep: [0.013, 0.019, 0.052],
        cloudRim: [0.75, 0.9, 1.25],
        cirrus: [0.06, 0.085, 0.17],
        seaDeep: [0.003, 0.008, 0.028],
        seaScatter: [0.004, 0.03, 0.06],
        sunGlint: [0, 0, 0],
        moonGlint: [1.0, 1.2, 1.6],
        haze: [0.03, 0.046, 0.115],
        ambient: [0.07, 0.1, 0.22],
        shaft: [0.85, 0.95, 1.2],
        gradeShadow: [0.9, 0.98, 1.16],
        gradeLight: [0.98, 1.0, 1.06],
        stars: 1,
        exposure: 1.12,
        cover: 0.36,
        fire: 0.4,
        moonKey: 1,
        lantern: 1,
        birds: 0,
        sunTurn: -40,
        moonTurn: -344,
    }),
    // Dawn: first light from behind the eye. The moon low and amber over the belt of Venus.
    hour('dawn', {
        zenithSun: [0.17, 0.25, 0.5],
        zenithFar: [0.14, 0.22, 0.47],
        midSun: [0.66, 0.42, 0.47],
        midFar: [0.62, 0.37, 0.47],
        horizonSun: [0.55, 0.36, 0.42],
        horizonFar: [0.21, 0.25, 0.41],
        sunBloom: [0, 0, 0],
        sunAureole: [0, 0, 0],
        sunDisc: [1.0, 0.9, 0.7],
        moonGlow: [0.2, 0.15, 0.12],
        moonDisc: [1.55, 1.3, 0.98],
        cloudLit: [1.1, 0.7, 0.72],
        cloudShade: [0.3, 0.27, 0.43],
        cloudDeep: [0.19, 0.18, 0.33],
        cloudRim: [0.9, 0.7, 0.7],
        cirrus: [1.2, 0.76, 0.72],
        seaDeep: [0.03, 0.05, 0.1],
        seaScatter: [0.04, 0.1, 0.13],
        sunGlint: [0, 0, 0],
        moonGlint: [0.9, 0.72, 0.5],
        haze: [0.31, 0.31, 0.45],
        ambient: [0.5, 0.42, 0.56],
        shaft: [1.1, 0.95, 0.9],
        gradeShadow: [0.96, 0.98, 1.1],
        gradeLight: [1.04, 0.99, 0.99],
        stars: 0.12,
        exposure: 1,
        cover: 0.42,
        fire: 0.2,
        moonKey: 1,
        lantern: 0.8,
        birds: 0.5,
        sunTurn: -172,
        moonTurn: -357.6,
    }),
    // The afternoon: the sun still high and out of the picture, white cloud on a trade-wind blue.
    hour('day', {
        zenithSun: [0.07, 0.24, 0.62],
        zenithFar: [0.05, 0.19, 0.55],
        midSun: [0.3, 0.52, 0.82],
        midFar: [0.2, 0.4, 0.74],
        horizonSun: [0.95, 0.86, 0.68],
        horizonFar: [0.42, 0.58, 0.8],
        sunBloom: [0.3, 0.3, 0.26],
        sunAureole: [1.1, 1.0, 0.8],
        sunDisc: [1.0, 0.96, 0.88],
        moonGlow: [0, 0, 0],
        moonDisc: [0.8, 0.84, 0.9],
        cloudLit: [1.22, 1.18, 1.1],
        cloudShade: [0.44, 0.52, 0.68],
        cloudDeep: [0.31, 0.38, 0.54],
        cloudRim: [1.6, 1.5, 1.3],
        cirrus: [0.9, 0.92, 0.95],
        seaDeep: [0.01, 0.09, 0.16],
        seaScatter: [0.02, 0.22, 0.24],
        sunGlint: [2.4, 2.2, 1.8],
        moonGlint: [0, 0, 0],
        haze: [0.5, 0.64, 0.8],
        ambient: [0.85, 0.9, 1.0],
        shaft: [1.05, 1.0, 0.92],
        gradeShadow: [0.95, 1.0, 1.06],
        gradeLight: [1.02, 1.0, 0.97],
        stars: 0,
        exposure: 0.94,
        cover: 0.4,
        fire: 0,
        moonKey: 0,
        lantern: 0.3,
        birds: 1,
        sunTurn: -318,
        moonTurn: -385,
    }),
]);

const wrap = (place) => {
    const n = HOURS.length;
    return ((place % n) + n) % n;
};

/**
 * Which two hours the light stands between at a place on the wheel, and how far it has crossed
 * from the first to the second (0 while it rests on the first, 1 while it rests on the second).
 */
export function hourMix(place, out = {}) {
    const p = wrap(Number.isFinite(place) ? place : 0);
    const from = Math.floor(p) % HOURS.length;
    out.from = from;
    out.to = (from + 1) % HOURS.length;
    out.mix = smooth(HOUR_REST, 1 - HOUR_REST, p - from);
    return out;
}

const mixed = {};

/**
 * The light at a place on the wheel: every colour of HOUR_COLOURS as [r, g, b], every number of
 * HOUR_SCALARS and HOUR_TURNS, and `name` (the hour it stands nearer to), `next` and `mix`.
 */
export function hourAt(place, out = {}) {
    const { from, to, mix } = hourMix(place, mixed);
    const a = HOURS[from];
    const b = HOURS[to];
    for (let i = 0; i < HOUR_COLOURS.length; i += 1) {
        const key = HOUR_COLOURS[i];
        if (!out[key]) out[key] = [0, 0, 0];
        const colour = out[key];
        colour[0] = lerp(a[key][0], b[key][0], mix);
        colour[1] = lerp(a[key][1], b[key][1], mix);
        colour[2] = lerp(a[key][2], b[key][2], mix);
    }
    for (let i = 0; i < HOUR_SCALARS.length; i += 1) {
        const key = HOUR_SCALARS[i];
        out[key] = lerp(a[key], b[key], mix);
    }
    // The bodies never turn back: past the last hour the first one's place is a whole turn on.
    for (let i = 0; i < HOUR_TURNS.length; i += 1) {
        const key = HOUR_TURNS[i];
        out[key] = lerp(a[key], to === 0 ? b[key] - 360 : b[key], mix);
    }
    out.name = mix < 0.5 ? a.name : b.name;
    out.next = mix < 0.5 ? b.name : a.name;
    out.mix = mix;
    return out;
}

/**
 * The place a level holds on the wheel, `since` seconds after it was reached from the place
 * `from`: the turn is eased over `seconds` and then stays put.
 */
export function levelPlace(from, to, since, seconds = TURN_SECONDS) {
    if (!(since > 0)) return from;
    return from + (to - from) * smooth(0, Math.max(0.01, seconds), since);
}

/** How long a turn of `hours` hours takes: one hour in TURN_SECONDS, a long way a little longer. */
export function turnSeconds(hours) {
    return TURN_SECONDS * Math.max(1, Math.sqrt(Math.abs(hours)));
}

/**
 * Where a new run takes up the wheel from the place the last one's levels left it: the same
 * hour seen from one turn of the wheel earlier, so the light runs FORWARD to golden hour again.
 * The sun never comes back up out of the western sea.
 */
export function restPlace(place) {
    const n = HOURS.length;
    return place - Math.ceil(place / n - 1e-9) * n;
}
