// @ts-check
/**
 * Sakura Twilight — the airs of the garden's night.
 *
 * Beside the hours (sakura-hours.js: what colour the night is) the garden has weather, on a clock
 * of its own, and the two never line up for long. Six airs follow one another and come round:
 *
 *   clear        a few high wisps and a light breeze: the garden as it was built, and where a
 *                session starts
 *   petal wind   hanakaze: the breeze freshens, torn cloud hurries across the moon, the boughs
 *                toss and the crowns let go a steady fall; a banner of snow streams off the summit
 *   mackerel     urokogumo: the cloud settles into a field of small scales, silver where the moon
 *                is behind them, and the mountain wears its cap of cloud
 *   hazy moon    oborozuki: a thin veil over the whole sky; the moon stands in a wide ring, the
 *                stars thin out and the light goes soft
 *   lake mist    the air stands still and mist comes in off the water: the far shore and the gate
 *                are shapes in it, a sea of cloud lies at the mountain's foot and the moon's shafts
 *                stand in the garden
 *   mirror       nagi: the mist lifts off a lake like glass under a clear, deep sky; the mountain
 *                stands on its head in the water and the fireflies come out
 *
 * and clear again. An air is a handful of numbers the light rig copies into uniforms: nothing is
 * rebuilt, so every tier and both backends show the same weather. Plain numbers and no three.js.
 */
import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** Seconds one air lasts, the turn to the next included (the hours take 110: they drift apart). */
export const SAKURA_WEATHER_SECONDS = 84;
/** The share of its time an air simply holds before it starts turning into the next. */
export const SAKURA_WEATHER_HOLD = 0.4;

/**
 * What an air sets:
 *   cloud     how much of the sky the moonlit banks cover (0..1)
 *   wisps     the high cirrus the garden always had (0..1)
 *   mackerel  the field of small scales (0..1)
 *   veil      a thin sheet over everything: the moon's ring opens, the stars thin (0..1)
 *   drift     how fast the cloud travels, against its resting pace
 *   stars     how many stars show, against the hour's own
 *   galaxy    how much of the river of heaven shows (0..1, the hour scales it too)
 *   wind      the breeze, against the garden's own
 *   fall      how many of the crowns' petals are in the air at once (0..1 of what the tier has)
 *   stream    how much of the far blizzard of petals the wind itself keeps going (0..1)
 *   calm      how like glass the lake lies (0 ruffled .. 1 a mirror)
 *   mist      the mist on the water, against the hour's own
 *   banks     how thick the banks of mist over the lake stand, against their own
 *   cap       the mountain's cap of cloud (0..1)
 *   sea       the sea of cloud at its foot (0..1)
 *   banner    the snow banner streaming off its summit (0..1)
 *   shafts    the moon's shafts in the air, against their resting density
 *   fireflies how many of them are out: from 1.12 every one of the tier's, as the garden was built; under
 *             that the shyest stay in the grass
 */
export const SAKURA_WEATHER_SCALARS = Object.freeze([
    'cloud', 'wisps', 'mackerel', 'veil', 'drift', 'stars', 'galaxy', 'wind', 'fall', 'stream', 'calm', 'mist', 'banks',
    'cap', 'sea', 'banner', 'shafts', 'fireflies',
]);

const air = (id, name, values) => Object.freeze({ id, name, ...values });

/** The six airs, in the order the night takes them. The first is the garden as it always was. */
export const SAKURA_WEATHERS = Object.freeze([
    air('clear', 'Clear evening', {
        cloud: 0.16,
        wisps: 1,
        mackerel: 0,
        veil: 0,
        drift: 1,
        stars: 1,
        galaxy: 0.55,
        wind: 1,
        fall: 1,
        stream: 0,
        calm: 0.4,
        mist: 1,
        banks: 1,
        cap: 0,
        sea: 0.2,
        banner: 0.12,
        shafts: 1,
        fireflies: 1.12,
    }),
    air('wind', 'Petal wind', {
        cloud: 0.58,
        wisps: 0.5,
        mackerel: 0,
        veil: 0.08,
        drift: 3.4,
        stars: 0.85,
        galaxy: 0.3,
        wind: 2.1,
        fall: 1,
        stream: 0.5,
        calm: 0,
        mist: 0.55,
        banks: 0.5,
        cap: 0,
        sea: 0.1,
        banner: 1,
        shafts: 0.8,
        fireflies: 0.3,
    }),
    air('mackerel', 'Mackerel sky', {
        cloud: 0.22,
        wisps: 0.3,
        mackerel: 1,
        veil: 0.12,
        drift: 0.8,
        stars: 0.6,
        galaxy: 0.2,
        wind: 0.9,
        fall: 0.8,
        stream: 0,
        calm: 0.55,
        mist: 0.9,
        banks: 0.8,
        cap: 1,
        sea: 0.35,
        banner: 0.2,
        shafts: 1.1,
        fireflies: 0.7,
    }),
    air('haze', 'Hazy moon', {
        cloud: 0.26,
        wisps: 0.7,
        mackerel: 0.15,
        veil: 1,
        drift: 0.5,
        stars: 0.4,
        galaxy: 0.05,
        wind: 0.7,
        fall: 0.6,
        stream: 0,
        calm: 0.7,
        mist: 1.5,
        banks: 1.3,
        cap: 0.45,
        sea: 0.6,
        banner: 0,
        shafts: 1.35,
        fireflies: 0.9,
    }),
    air('mist', 'Mist on the lake', {
        cloud: 0.12,
        wisps: 0.4,
        mackerel: 0,
        veil: 0.45,
        drift: 0.35,
        stars: 0.55,
        galaxy: 0.15,
        wind: 0.45,
        fall: 0.45,
        stream: 0,
        calm: 0.85,
        mist: 3.1,
        banks: 2.3,
        cap: 0.15,
        sea: 1,
        banner: 0,
        shafts: 1.9,
        fireflies: 1,
    }),
    air('mirror', 'Mirror calm', {
        cloud: 0.06,
        wisps: 0.55,
        mackerel: 0,
        veil: 0,
        drift: 0.3,
        stars: 1.3,
        galaxy: 1,
        wind: 0.35,
        fall: 0.35,
        stream: 0,
        calm: 1,
        mist: 0.8,
        banks: 0.7,
        cap: 0,
        sea: 0.4,
        banner: 0,
        shafts: 0.9,
        fireflies: 1.12,
    }),
]);

/** Somewhere to put an air's numbers: a place a caller keeps and fills again. */
export function createSakuraWeather() {
    /** @type {Record<string, number>} */
    const out = {};
    for (const key of SAKURA_WEATHER_SCALARS) out[key] = 0;
    return out;
}

/**
 * How far the clock alone has turned the airs at `time` (seconds): a whole number while one
 * holds, easing to the next as it turns. A function of the time and nothing else.
 * @param {number} time
 */
export function sakuraWeatherDrift(time) {
    return moodDrift(time, SAKURA_WEATHER_SECONDS, SAKURA_WEATHER_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The air `phase` airs in (any real number: they come round). On a whole phase it is that air
 * exactly; between, every number crosses over.
 * @param {number} phase
 * @param {Record<string, number>} [out]
 */
export function sakuraWeatherAt(phase, out = createSakuraWeather()) {
    wheelAt(phase, SAKURA_WEATHERS.length, AT);
    const a = /** @type {Record<string, any>} */ (SAKURA_WEATHERS[AT.a]);
    const b = /** @type {Record<string, any>} */ (SAKURA_WEATHERS[AT.b]);
    for (const key of SAKURA_WEATHER_SCALARS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    return out;
}

/**
 * The name of the air a phase is nearest.
 * @param {number} phase
 */
export function sakuraWeatherName(phase) {
    const n = SAKURA_WEATHERS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return SAKURA_WEATHERS[((Math.round(p) % n) + n) % n].name;
}

/**
 * The index of an air by its id (`clear`, `wind`, `mackerel`, `haze`, `mist`, `mirror`) or its
 * number, or null: a capture's `weather=` and the tests pin one with it.
 * @param {string | number | null | undefined} value
 */
export function sakuraWeatherIndex(value) {
    if (value === null || value === undefined || value === '') return null;
    const byId = SAKURA_WEATHERS.findIndex((weather) => weather.id === String(value).toLowerCase());
    if (byId >= 0) return byId;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const n = SAKURA_WEATHERS.length;
    return ((Math.round(number) % n) + n) % n;
}
