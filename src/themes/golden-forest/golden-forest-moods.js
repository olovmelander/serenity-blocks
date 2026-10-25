/**
 * Golden Forest — the evenings of the lake.
 *
 * The sun does not move: it rests on the headland's treetops and the shores' shadows are drawn
 * once for it. But its light does. Five hours of a northern summer follow one another and come
 * round, each low over the same water:
 *
 *   golden hour    molten gold on the treetops under a dusk-blue sky (the lake as it was built,
 *                  and where a session starts)
 *   ember sunset   the sun reddens, the low sky burns crimson, the zenith deepens to indigo
 *   alpenglow      the sun a dim ember on the treetops, rose over the ridges, lavender mist
 *   white night    the midsummer midnight that never darkens: a pale peach sun, a lilac and
 *                  silver sky, the lake a mirror of it
 *   morning gold   a fresh pale-gold sun, a clear blue zenith over a peach band, golden mist
 *
 * and from the morning back into the golden hour. The clock turns them by itself, an hour every
 * GOLDEN_FOREST_MOOD_SECONDS, resting a share of that pure before it melts into the next; every
 * level is one hour on from wherever the clock has brought the lake. Hot play still deepens
 * whichever hour it is toward sunset and clears the air (golden-forest-light.js).
 *
 * Plain numbers and no three.js, so the light rig, the tests and a capture share them. Colours
 * are linear, at the scale the materials expect (the tone mapper sits after them).
 */
import { meltPalettes, moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one hour to the next: ten minutes for the evening to come round. */
export const GOLDEN_FOREST_MOOD_SECONDS = 120;
/** The share of its period an hour rests, pure, before it melts into the next. */
export const GOLDEN_FOREST_MOOD_HOLD = 0.35;

/**
 * The colours an hour sets: the sun's light, the two ambient poles, the sky dome (overhead, the
 * middle, the low band away from the sun and toward it), the air in shade and in sun, the bars
 * of evening cloud (their bodies near the sun and away from it, low and high, and the edges that
 * burn), and the shafts' colour away from the sun and toward it.
 */
export const GOLDEN_FOREST_MOOD_COLOURS = Object.freeze([
    'sun', 'skyLight', 'bounce', 'zenith', 'skyMid', 'skyAway', 'skyToward', 'hazeCool', 'hazeWarm',
    'cloudEmber', 'cloudGlow', 'cloudDusk', 'cloudHigh', 'cloudGilt', 'shaftShade', 'shaftSun',
]);
/** And the numbers: the haze density per metre, the exposure against rest. */
export const GOLDEN_FOREST_MOOD_SCALARS = Object.freeze(['haze', 'exposure']);

const mood = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value.slice()) : value,
    ])),
});

export const GOLDEN_FOREST_MOODS = Object.freeze([
    mood('golden hour', {
        sun: [4.2, 2.1, 0.62],
        skyLight: [0.36, 0.18, 0.17],
        bounce: [0.3, 0.12, 0.045],
        zenith: [0.045, 0.05, 0.13],
        skyMid: [0.36, 0.14, 0.16],
        skyAway: [0.6, 0.21, 0.11],
        skyToward: [1.5, 0.66, 0.14],
        hazeCool: [0.4, 0.165, 0.11],
        hazeWarm: [1.15, 0.52, 0.12],
        cloudEmber: [0.34, 0.1, 0.04],
        cloudGlow: [0.82, 0.27, 0.08],
        cloudDusk: [0.3, 0.14, 0.18],
        cloudHigh: [0.13, 0.08, 0.15],
        cloudGilt: [2.3, 1.0, 0.24],
        shaftShade: [0.16, 0.06, 0.035],
        shaftSun: [1.6, 0.8, 0.24],
        haze: 0.0025,
        exposure: 1,
    }),
    mood('ember sunset', {
        sun: [4.3, 1.45, 0.38],
        skyLight: [0.34, 0.13, 0.15],
        bounce: [0.3, 0.09, 0.035],
        zenith: [0.035, 0.03, 0.11],
        skyMid: [0.4, 0.1, 0.14],
        skyAway: [0.62, 0.14, 0.09],
        skyToward: [1.6, 0.42, 0.08],
        hazeCool: [0.38, 0.12, 0.1],
        hazeWarm: [1.2, 0.36, 0.08],
        cloudEmber: [0.32, 0.06, 0.03],
        cloudGlow: [0.85, 0.18, 0.05],
        cloudDusk: [0.3, 0.1, 0.17],
        cloudHigh: [0.12, 0.06, 0.15],
        cloudGilt: [2.4, 0.7, 0.16],
        shaftShade: [0.16, 0.045, 0.03],
        shaftSun: [1.7, 0.55, 0.15],
        haze: 0.0024,
        exposure: 1.03,
    }),
    mood('alpenglow', {
        sun: [2.2, 0.85, 0.5],
        skyLight: [0.26, 0.16, 0.26],
        bounce: [0.16, 0.08, 0.07],
        zenith: [0.03, 0.035, 0.12],
        skyMid: [0.28, 0.13, 0.26],
        skyAway: [0.48, 0.2, 0.3],
        skyToward: [0.95, 0.38, 0.3],
        hazeCool: [0.24, 0.13, 0.22],
        hazeWarm: [0.75, 0.34, 0.26],
        cloudEmber: [0.22, 0.08, 0.09],
        cloudGlow: [0.6, 0.24, 0.22],
        cloudDusk: [0.22, 0.12, 0.22],
        cloudHigh: [0.08, 0.06, 0.15],
        cloudGilt: [1.5, 0.62, 0.4],
        shaftShade: [0.1, 0.05, 0.06],
        shaftSun: [0.95, 0.45, 0.32],
        haze: 0.0023,
        exposure: 1.15,
    }),
    mood('white night', {
        sun: [2.5, 1.85, 1.35],
        skyLight: [0.2, 0.21, 0.32],
        bounce: [0.13, 0.1, 0.08],
        zenith: [0.04, 0.07, 0.2],
        skyMid: [0.22, 0.22, 0.38],
        skyAway: [0.34, 0.3, 0.42],
        skyToward: [0.95, 0.66, 0.48],
        hazeCool: [0.17, 0.18, 0.28],
        hazeWarm: [0.72, 0.54, 0.4],
        cloudEmber: [0.2, 0.15, 0.17],
        cloudGlow: [0.55, 0.38, 0.34],
        cloudDusk: [0.2, 0.18, 0.28],
        cloudHigh: [0.09, 0.1, 0.2],
        cloudGilt: [1.5, 1.05, 0.7],
        shaftShade: [0.08, 0.075, 0.1],
        shaftSun: [0.9, 0.68, 0.48],
        haze: 0.0019,
        exposure: 1.05,
    }),
    mood('morning gold', {
        sun: [3.9, 2.65, 1.15],
        skyLight: [0.26, 0.25, 0.3],
        bounce: [0.24, 0.15, 0.06],
        zenith: [0.03, 0.075, 0.25],
        skyMid: [0.22, 0.23, 0.36],
        skyAway: [0.42, 0.31, 0.24],
        skyToward: [1.4, 0.9, 0.34],
        hazeCool: [0.25, 0.19, 0.15],
        hazeWarm: [1.0, 0.68, 0.27],
        cloudEmber: [0.3, 0.16, 0.08],
        cloudGlow: [0.75, 0.42, 0.17],
        cloudDusk: [0.24, 0.2, 0.26],
        cloudHigh: [0.1, 0.11, 0.2],
        cloudGilt: [2.1, 1.35, 0.48],
        shaftShade: [0.12, 0.08, 0.045],
        shaftSun: [1.4, 0.98, 0.38],
        haze: 0.0019,
        exposure: 0.96,
    }),
]);

/** Somewhere to put an hour's colours and numbers: a place a caller keeps and fills again. */
export function createGoldenForestMood() {
    const out = {};
    for (const key of GOLDEN_FOREST_MOOD_COLOURS) out[key] = [0, 0, 0];
    for (const key of GOLDEN_FOREST_MOOD_SCALARS) out[key] = 0;
    return out;
}

/**
 * How far the clock alone has turned the hours at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts. A function of the time alone, so a seek and an evening
 * lived through agree at any frame rate.
 * @param {number} time
 */
export function goldenForestMoodDrift(time) {
    return moodDrift(time, GOLDEN_FOREST_MOOD_SECONDS, GOLDEN_FOREST_MOOD_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The lake's light `phase` hours in (any real number: the evening comes round). Fills `out` with
 * every colour (melted the short way round the colour wheel) and number (mixed) of an hour and
 * returns it; on a whole phase it is that hour exactly.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function goldenForestMoodAt(phase, out = createGoldenForestMood()) {
    meltPalettes(GOLDEN_FOREST_MOODS, GOLDEN_FOREST_MOOD_COLOURS, phase, out);
    wheelAt(phase, GOLDEN_FOREST_MOODS.length, AT);
    const a = GOLDEN_FOREST_MOODS[AT.a];
    const b = GOLDEN_FOREST_MOODS[AT.b];
    for (const key of GOLDEN_FOREST_MOOD_SCALARS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = AT.melt > 0 ? a[key] + (b[key] - a[key]) * AT.melt : a[key];
    }
    return out;
}

/**
 * The name of the hour a phase is nearest.
 * @param {number} phase
 */
export function goldenForestMoodName(phase) {
    const n = GOLDEN_FOREST_MOODS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return GOLDEN_FOREST_MOODS[((Math.round(p) % n) + n) % n].name;
}
