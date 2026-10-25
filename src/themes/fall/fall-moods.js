/**
 * Fall — the days of the grove.
 *
 * The sun does not move: it stands low behind the old wood and the grove's shadows are drawn
 * once for it. But the light does. Five autumn lights follow one another and come round, each
 * through the same trees:
 *
 *   quiet afternoon  a low gold sun, a clean blue sky, a rose haze opposite (the grove as it was
 *                    built, and where a session starts)
 *   amber hour       the sun goes deep amber, the low sky burns orange, the litter glows
 *   rose dusk        the sun a dim rose behind the trunks, a lilac sky, lavender air
 *   blue mist        a cool morning: a pale silver sun, grey-blue air thick between the trunks
 *   bright October   a crisp clear day: a white-gold sun, a deep blue sky, thin air, the colours
 *                    at their brightest
 *
 * and from the bright day back into the quiet afternoon. The clock turns them by itself, a light
 * every FALL_MOOD_SECONDS, resting a share of that pure before it melts into the next; every
 * level is one light on from wherever the clock has brought the grove. Hot play still turns
 * whichever light it is toward late amber and clears the air (fall-light.js).
 *
 * Plain numbers and no three.js, so the light rig, the tests and a capture share them. Colours
 * are linear, at the scale the materials expect (the tone mapper sits after them).
 */
import { meltPalettes, moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds from one light to the next: about nine minutes for the day to come round. */
export const FALL_MOOD_SECONDS = 110;
/** The share of its period a light rests, pure, before it melts into the next. */
export const FALL_MOOD_HOLD = 0.35;

/**
 * The colours a light sets: the sun's light, the two ambient poles, the sky dome (overhead, the
 * cool and rose low sky, the gold toward the sun), the air in shade and in sun, the cloud deck
 * (its undersides away from the sun and toward it, its bodies the same), and the shafts' colour
 * away from the sun and toward it.
 */
export const FALL_MOOD_COLOURS = Object.freeze([
    'sun', 'skyLight', 'bounce', 'zenith', 'skyCool', 'skyWarm', 'skyRose', 'hazeCool', 'hazeWarm',
    'cloudShade', 'cloudLit', 'cloudBody', 'cloudBodyWarm', 'shaftShade', 'shaftSun',
]);
/** And the numbers: the haze density per metre, the exposure against rest. */
export const FALL_MOOD_SCALARS = Object.freeze(['haze', 'exposure']);

const mood = (name, values) => Object.freeze({
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value.slice()) : value,
    ])),
});

export const FALL_MOODS = Object.freeze([
    mood('quiet afternoon', {
        sun: [3.6, 2.15, 1.02],
        skyLight: [0.2, 0.3, 0.5],
        bounce: [0.34, 0.2, 0.1],
        zenith: [0.02, 0.092, 0.21],
        skyCool: [0.13, 0.27, 0.41],
        skyWarm: [1.75, 0.98, 0.42],
        skyRose: [0.44, 0.28, 0.31],
        hazeCool: [0.15, 0.22, 0.33],
        hazeWarm: [1.0, 0.6, 0.27],
        cloudShade: [0.42, 0.25, 0.25],
        cloudLit: [1.5, 0.8, 0.34],
        cloudBody: [0.15, 0.13, 0.17],
        cloudBodyWarm: [0.42, 0.3, 0.24],
        shaftShade: [0.3, 0.22, 0.15],
        shaftSun: [1.5, 0.84, 0.33],
        haze: 0.0095,
        exposure: 1,
    }),
    mood('amber hour', {
        sun: [3.85, 1.75, 0.6],
        skyLight: [0.22, 0.26, 0.42],
        bounce: [0.38, 0.18, 0.07],
        zenith: [0.025, 0.075, 0.19],
        skyCool: [0.16, 0.24, 0.36],
        skyWarm: [1.9, 0.82, 0.26],
        skyRose: [0.5, 0.26, 0.24],
        hazeCool: [0.17, 0.19, 0.28],
        hazeWarm: [1.1, 0.5, 0.18],
        cloudShade: [0.46, 0.22, 0.2],
        cloudLit: [1.65, 0.68, 0.22],
        cloudBody: [0.17, 0.12, 0.14],
        cloudBodyWarm: [0.48, 0.26, 0.17],
        shaftShade: [0.32, 0.19, 0.1],
        shaftSun: [1.6, 0.7, 0.22],
        haze: 0.009,
        exposure: 1,
    }),
    mood('rose dusk', {
        sun: [2.3, 1.0, 0.7],
        skyLight: [0.2, 0.2, 0.4],
        bounce: [0.24, 0.13, 0.1],
        zenith: [0.025, 0.045, 0.16],
        skyCool: [0.16, 0.17, 0.34],
        skyWarm: [1.3, 0.58, 0.42],
        skyRose: [0.5, 0.26, 0.38],
        hazeCool: [0.14, 0.14, 0.27],
        hazeWarm: [0.8, 0.42, 0.32],
        cloudShade: [0.4, 0.2, 0.3],
        cloudLit: [1.1, 0.5, 0.38],
        cloudBody: [0.12, 0.1, 0.17],
        cloudBodyWarm: [0.34, 0.2, 0.24],
        shaftShade: [0.2, 0.13, 0.15],
        shaftSun: [1.05, 0.52, 0.38],
        haze: 0.0095,
        exposure: 1.12,
    }),
    mood('blue mist', {
        sun: [2.7, 2.35, 1.85],
        skyLight: [0.2, 0.27, 0.4],
        bounce: [0.22, 0.18, 0.13],
        zenith: [0.025, 0.07, 0.17],
        skyCool: [0.12, 0.19, 0.29],
        skyWarm: [0.95, 0.82, 0.62],
        skyRose: [0.26, 0.25, 0.32],
        hazeCool: [0.12, 0.17, 0.25],
        hazeWarm: [0.66, 0.58, 0.46],
        cloudShade: [0.3, 0.28, 0.33],
        cloudLit: [0.95, 0.84, 0.64],
        cloudBody: [0.13, 0.13, 0.17],
        cloudBodyWarm: [0.28, 0.26, 0.25],
        shaftShade: [0.17, 0.18, 0.2],
        shaftSun: [0.92, 0.82, 0.64],
        haze: 0.0105,
        exposure: 1.02,
    }),
    mood('bright October', {
        sun: [3.8, 2.85, 1.7],
        skyLight: [0.18, 0.32, 0.58],
        bounce: [0.32, 0.22, 0.11],
        zenith: [0.012, 0.08, 0.24],
        skyCool: [0.09, 0.26, 0.48],
        skyWarm: [1.6, 1.12, 0.6],
        skyRose: [0.36, 0.3, 0.36],
        hazeCool: [0.12, 0.21, 0.36],
        hazeWarm: [0.95, 0.72, 0.42],
        cloudShade: [0.4, 0.34, 0.36],
        cloudLit: [1.5, 1.1, 0.62],
        cloudBody: [0.15, 0.15, 0.19],
        cloudBodyWarm: [0.42, 0.36, 0.3],
        shaftShade: [0.26, 0.24, 0.2],
        shaftSun: [1.45, 1.05, 0.55],
        haze: 0.0072,
        exposure: 0.97,
    }),
]);

/** Somewhere to put a light's colours and numbers: a place a caller keeps and fills again. */
export function createFallMood() {
    const out = {};
    for (const key of FALL_MOOD_COLOURS) out[key] = [0, 0, 0];
    for (const key of FALL_MOOD_SCALARS) out[key] = 0;
    return out;
}

/**
 * How far the clock alone has turned the lights at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts. A function of the time alone, so a seek and a day lived
 * through agree at any frame rate.
 * @param {number} time
 */
export function fallMoodDrift(time) {
    return moodDrift(time, FALL_MOOD_SECONDS, FALL_MOOD_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The grove's light `phase` lights in (any real number: the day comes round). Fills `out` with
 * every colour (melted the short way round the colour wheel) and number (mixed) of a light and
 * returns it; on a whole phase it is that light exactly.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function fallMoodAt(phase, out = createFallMood()) {
    meltPalettes(FALL_MOODS, FALL_MOOD_COLOURS, phase, out);
    wheelAt(phase, FALL_MOODS.length, AT);
    const a = FALL_MOODS[AT.a];
    const b = FALL_MOODS[AT.b];
    for (const key of FALL_MOOD_SCALARS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = AT.melt > 0 ? a[key] + (b[key] - a[key]) * AT.melt : a[key];
    }
    return out;
}

/**
 * The name of the light a phase is nearest.
 * @param {number} phase
 */
export function fallMoodName(phase) {
    const n = FALL_MOODS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return FALL_MOODS[((Math.round(p) % n) + n) % n].name;
}
