/**
 * Verdant Hills — the weathers of the kite day.
 *
 * The sun does not move: the oak's shade on the hill is drawn once for where it stands. The
 * day's weather does, and with it the hour the light reads as. Seven weathers follow one another
 * and come round, each a June day on the downs:
 *
 *   kite day         fair-weather cumulus, white on a deep blue sky (where a session starts)
 *   honey afternoon  the light warms to butter, the cumulus build, a creamy horizon
 *   storm light      the cumulus crowd into indigo heaps with white crowns; the sun comes down
 *                    between them in shafts and the greens stand rich in its pools
 *   after the rain   rinsed air: a deep blue sky to the horizon, small white heaps, the far
 *                    ridges sharp, and a rainbow standing over the valley
 *   long gold        the light goes gold and the haze honey, the clouds thin and gild
 *   afterglow        the sun is down behind the windmill: an orange rim under a violet sky, the
 *                    first stars, and fireflies over the grass
 *   morning mist     a pale gold morning with the valley under mist, the hills standing out of it
 *
 * and from the mist back to the kite day. The clock turns them by itself, a weather every
 * VERDANT_HILLS_MOOD_SECONDS, resting a share of that pure before it melts into the next; every
 * level is one weather on from wherever the clock has brought the day. Hot play still clears the
 * air, thins the cumulus and warms the light on top of whichever weather it is.
 *
 * Plain numbers and no three.js, so the light rig, the tests and a capture share them. Colours
 * are linear, at the scale the materials expect (the tone mapper sits after them).
 */
import { meltPalettes, moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one weather to the next: about twelve minutes for the day to come round. */
export const VERDANT_HILLS_MOOD_SECONDS = 105;
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
/**
 * And the numbers: the haze density per metre, the share of the sky under cloud, the exposure
 * against rest, how much mist lies in the valley (0..1), how far night has come (0..1: the stars
 * and the fireflies), how brightly the rainbow stands (0..1) and how strongly the sun's shafts
 * stand in the air between the clouds (0..1).
 */
export const VERDANT_HILLS_MOOD_SCALARS = Object.freeze([
    'haze', 'cover', 'exposure', 'mist', 'night', 'bow', 'beams',
]);

const mood = (name, values) => Object.freeze({
    name,
    mist: 0,
    night: 0,
    bow: 0,
    beams: 0,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value.slice()) : value,
    ])),
});

export const VERDANT_HILLS_MOODS = Object.freeze([
    mood('kite day', {
        sun: [3.5, 3.2, 2.7],
        skyLight: [0.3, 0.44, 0.66],
        bounce: [0.13, 0.2, 0.07],
        zenith: [0.015, 0.08, 0.42],
        skyMid: [0.045, 0.21, 0.68],
        horizon: [0.34, 0.56, 0.82],
        horizonSun: [0.8, 0.84, 0.8],
        hazeCool: [0.22, 0.37, 0.6],
        hazeWarm: [0.8, 0.76, 0.6],
        cloudBase: [0.095, 0.133, 0.228],
        cloudTop: [0.342, 0.418, 0.59],
        cirrus: [0.86, 0.9, 0.96],
        haze: 0.00012,
        cover: 0.22,
        exposure: 1,
    }),
    mood('honey afternoon', {
        sun: [3.9, 3.05, 1.95],
        skyLight: [0.29, 0.41, 0.62],
        bounce: [0.16, 0.2, 0.06],
        zenith: [0.016, 0.08, 0.4],
        skyMid: [0.05, 0.21, 0.64],
        horizon: [0.42, 0.56, 0.74],
        horizonSun: [1.05, 0.92, 0.7],
        hazeCool: [0.25, 0.36, 0.54],
        hazeWarm: [0.95, 0.8, 0.55],
        cloudBase: [0.1, 0.125, 0.2],
        cloudTop: [0.36, 0.41, 0.55],
        cirrus: [0.92, 0.91, 0.9],
        haze: 0.00016,
        cover: 0.3,
        exposure: 1,
    }),
    mood('storm light', {
        sun: [3.7, 3.5, 3.1],
        skyLight: [0.2, 0.29, 0.5],
        bounce: [0.1, 0.16, 0.06],
        zenith: [0.012, 0.05, 0.28],
        skyMid: [0.035, 0.13, 0.44],
        horizon: [0.24, 0.36, 0.56],
        horizonSun: [0.72, 0.74, 0.72],
        hazeCool: [0.16, 0.25, 0.42],
        hazeWarm: [0.74, 0.72, 0.62],
        cloudBase: [0.03, 0.055, 0.15],
        cloudTop: [0.36, 0.43, 0.62],
        cirrus: [0.5, 0.58, 0.72],
        haze: 0.00015,
        cover: 0.34,
        exposure: 1.1,
        beams: 1,
    }),
    mood('after the rain', {
        sun: [3.6, 3.4, 3.0],
        skyLight: [0.26, 0.44, 0.72],
        bounce: [0.11, 0.21, 0.08],
        zenith: [0.012, 0.08, 0.46],
        skyMid: [0.035, 0.2, 0.74],
        horizon: [0.26, 0.52, 0.84],
        horizonSun: [0.7, 0.82, 0.88],
        hazeCool: [0.2, 0.36, 0.6],
        hazeWarm: [0.7, 0.75, 0.68],
        cloudBase: [0.09, 0.13, 0.23],
        cloudTop: [0.35, 0.44, 0.64],
        cirrus: [0.84, 0.9, 1.0],
        haze: 0.00007,
        cover: 0.16,
        exposure: 0.98,
        bow: 1,
    }),
    mood('long gold', {
        sun: [4.6, 2.75, 1.1],
        skyLight: [0.2, 0.26, 0.44],
        bounce: [0.2, 0.15, 0.05],
        zenith: [0.014, 0.06, 0.34],
        skyMid: [0.06, 0.19, 0.52],
        horizon: [0.5, 0.48, 0.56],
        horizonSun: [1.5, 0.98, 0.52],
        hazeCool: [0.26, 0.29, 0.42],
        hazeWarm: [1.15, 0.8, 0.42],
        cloudBase: [0.11, 0.1, 0.17],
        cloudTop: [0.42, 0.35, 0.42],
        cirrus: [1.0, 0.86, 0.72],
        haze: 0.0002,
        cover: 0.2,
        exposure: 0.97,
        beams: 0.35,
    }),
    mood('afterglow', {
        sun: [1.5, 0.62, 0.3],
        skyLight: [0.085, 0.12, 0.26],
        bounce: [0.035, 0.04, 0.035],
        zenith: [0.006, 0.014, 0.085],
        skyMid: [0.03, 0.045, 0.17],
        horizon: [0.2, 0.14, 0.26],
        horizonSun: [1.7, 0.62, 0.22],
        hazeCool: [0.07, 0.08, 0.18],
        hazeWarm: [0.75, 0.34, 0.2],
        cloudBase: [0.022, 0.024, 0.06],
        cloudTop: [0.075, 0.06, 0.13],
        cirrus: [0.85, 0.4, 0.36],
        haze: 0.00013,
        cover: 0.18,
        exposure: 1.22,
        night: 1,
    }),
    mood('morning mist', {
        sun: [3.3, 2.9, 2.2],
        skyLight: [0.3, 0.4, 0.56],
        bounce: [0.12, 0.17, 0.07],
        zenith: [0.03, 0.12, 0.42],
        skyMid: [0.14, 0.3, 0.6],
        horizon: [0.62, 0.66, 0.7],
        horizonSun: [1.1, 0.98, 0.8],
        hazeCool: [0.4, 0.48, 0.58],
        hazeWarm: [0.95, 0.86, 0.68],
        cloudBase: [0.12, 0.15, 0.22],
        cloudTop: [0.4, 0.44, 0.56],
        cirrus: [1.0, 0.92, 0.84],
        haze: 0.00018,
        cover: 0.12,
        exposure: 1,
        mist: 1,
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
