/**
 * Verdant Hills — the weathers of the kite day.
 *
 * The sun does not move: the oak's shade on the hill is drawn once for where it stands. The
 * day's weather does. Five weathers follow one another and come round, each a June day on the
 * downs:
 *
 *   kite day         fair-weather cumulus in a washed blue sky (the day as it was built, and
 *                    where a session starts)
 *   honey afternoon  the light warms to butter, the cumulus build, a creamy horizon
 *   long gold        the light goes gold and the haze honey, the clouds thin and gild
 *   showers coming   the cumulus crowd into slate heaps and their shadows cover the valley; the
 *                    sun breaks through white between them and the greens stand rich
 *   after the rain   rinsed air: a deep blue sky to the horizon, small white heaps, the far
 *                    ridges sharp
 *
 * and from the rinsed air back to the kite day. The clock turns them by itself, a weather every
 * VERDANT_HILLS_MOOD_SECONDS, resting a share of that pure before it melts into the next; every
 * level is one weather on from wherever the clock has brought the day. Hot play still clears the
 * air, thins the cumulus and warms the light on top of whichever weather it is.
 *
 * Plain numbers and no three.js, so the light rig, the tests and a capture share them. Colours
 * are linear, at the scale the materials expect (the tone mapper sits after them).
 */
import { meltPalettes, moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one weather to the next: about nine minutes for the day to come round. */
export const VERDANT_HILLS_MOOD_SECONDS = 110;
/** The share of its period a weather rests, pure, before it melts into the next. */
export const VERDANT_HILLS_MOOD_HOLD = 0.35;

/**
 * The colours a weather sets: the sun's light, the two ambient poles, the sky dome (overhead,
 * the middle, the rim away from the sun and toward it), the air in shade and in sun, the
 * cumulus's own shade from its flat base up its tower, and the high cirrus.
 */
export const VERDANT_HILLS_MOOD_COLOURS = Object.freeze([
    'sun', 'skyLight', 'bounce', 'zenith', 'skyMid', 'horizon', 'horizonSun', 'hazeCool', 'hazeWarm',
    'cloudBase', 'cloudTop', 'cirrus',
]);
/** And the numbers: the haze density per metre, the share of the sky under cloud, the exposure against rest. */
export const VERDANT_HILLS_MOOD_SCALARS = Object.freeze(['haze', 'cover', 'exposure']);

const mood = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value.slice()) : value,
    ])),
});

export const VERDANT_HILLS_MOODS = Object.freeze([
    mood('kite day', {
        sun: [3.5, 3.2, 2.7],
        skyLight: [0.3, 0.44, 0.66],
        bounce: [0.13, 0.2, 0.07],
        zenith: [0.035, 0.15, 0.5],
        skyMid: [0.1, 0.34, 0.74],
        horizon: [0.42, 0.6, 0.8],
        horizonSun: [0.86, 0.86, 0.78],
        hazeCool: [0.24, 0.38, 0.58],
        hazeWarm: [0.8, 0.76, 0.6],
        cloudBase: [0.06, 0.08, 0.125],
        cloudTop: [0.27, 0.33, 0.45],
        cirrus: [0.86, 0.9, 0.96],
        haze: 0.00016,
        cover: 0.25,
        exposure: 1,
    }),
    mood('honey afternoon', {
        sun: [3.8, 3.05, 2.0],
        skyLight: [0.29, 0.42, 0.64],
        bounce: [0.16, 0.2, 0.06],
        zenith: [0.03, 0.14, 0.48],
        skyMid: [0.09, 0.33, 0.72],
        horizon: [0.44, 0.6, 0.78],
        horizonSun: [0.98, 0.92, 0.76],
        hazeCool: [0.25, 0.37, 0.56],
        hazeWarm: [0.92, 0.8, 0.58],
        cloudBase: [0.06, 0.075, 0.115],
        cloudTop: [0.26, 0.31, 0.44],
        cirrus: [0.9, 0.91, 0.93],
        haze: 0.00015,
        cover: 0.33,
        exposure: 1,
    }),
    mood('long gold', {
        sun: [3.95, 2.75, 1.5],
        skyLight: [0.24, 0.33, 0.58],
        bounce: [0.17, 0.15, 0.05],
        zenith: [0.02, 0.09, 0.4],
        skyMid: [0.07, 0.25, 0.62],
        horizon: [0.4, 0.5, 0.7],
        horizonSun: [1.12, 0.9, 0.66],
        hazeCool: [0.23, 0.3, 0.48],
        hazeWarm: [0.95, 0.76, 0.52],
        cloudBase: [0.06, 0.065, 0.11],
        cloudTop: [0.25, 0.28, 0.44],
        cirrus: [0.94, 0.9, 0.88],
        haze: 0.00012,
        cover: 0.2,
        exposure: 0.97,
    }),
    mood('showers coming', {
        sun: [2.5, 2.54, 2.5],
        skyLight: [0.27, 0.35, 0.49],
        bounce: [0.1, 0.15, 0.06],
        zenith: [0.05, 0.1, 0.24],
        skyMid: [0.12, 0.21, 0.4],
        horizon: [0.34, 0.42, 0.52],
        horizonSun: [0.6, 0.66, 0.7],
        hazeCool: [0.2, 0.27, 0.38],
        hazeWarm: [0.5, 0.54, 0.54],
        cloudBase: [0.05, 0.06, 0.08],
        cloudTop: [0.27, 0.3, 0.37],
        cirrus: [0.62, 0.67, 0.74],
        haze: 0.00024,
        cover: 0.34,
        exposure: 1.16,
    }),
    mood('after the rain', {
        sun: [3.6, 3.4, 3.0],
        skyLight: [0.26, 0.44, 0.72],
        bounce: [0.11, 0.21, 0.08],
        zenith: [0.02, 0.12, 0.5],
        skyMid: [0.06, 0.3, 0.78],
        horizon: [0.3, 0.55, 0.82],
        horizonSun: [0.75, 0.85, 0.88],
        hazeCool: [0.2, 0.36, 0.6],
        hazeWarm: [0.7, 0.75, 0.68],
        cloudBase: [0.05, 0.075, 0.12],
        cloudTop: [0.25, 0.33, 0.48],
        cirrus: [0.84, 0.9, 1.0],
        haze: 0.00009,
        cover: 0.18,
        exposure: 0.98,
    }),
]);

/** Somewhere to put a weather's colours and numbers: a place a caller keeps and fills again. */
export function createVerdantHillsMood() {
    const out = {};
    for (const key of VERDANT_HILLS_MOOD_COLOURS) out[key] = [0, 0, 0];
    for (const key of VERDANT_HILLS_MOOD_SCALARS) out[key] = 0;
    return out;
}

/**
 * How far the clock alone has turned the weathers at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts. A function of the time alone, so a seek and a day lived
 * through agree at any frame rate.
 * @param {number} time
 */
export function verdantHillsMoodDrift(time) {
    return moodDrift(time, VERDANT_HILLS_MOOD_SECONDS, VERDANT_HILLS_MOOD_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The day's weather `phase` weathers in (any real number: the day comes round). Fills `out` with
 * every colour (melted the short way round the colour wheel) and number (mixed) of a weather and
 * returns it; on a whole phase it is that weather exactly.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function verdantHillsMoodAt(phase, out = createVerdantHillsMood()) {
    meltPalettes(VERDANT_HILLS_MOODS, VERDANT_HILLS_MOOD_COLOURS, phase, out);
    wheelAt(phase, VERDANT_HILLS_MOODS.length, AT);
    const a = VERDANT_HILLS_MOODS[AT.a];
    const b = VERDANT_HILLS_MOODS[AT.b];
    for (const key of VERDANT_HILLS_MOOD_SCALARS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = AT.melt > 0 ? a[key] + (b[key] - a[key]) * AT.melt : a[key];
    }
    return out;
}

/**
 * The name of the weather a phase is nearest.
 * @param {number} phase
 */
export function verdantHillsMoodName(phase) {
    const n = VERDANT_HILLS_MOODS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return VERDANT_HILLS_MOODS[((Math.round(p) % n) + n) % n].name;
}
