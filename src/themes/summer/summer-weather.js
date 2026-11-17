/**
 * Summer — the weather of the longest day.
 *
 * Beside the hours of the night (summer-hours.js: where the sun stands and what colour its light
 * is) the day has weather, on a clock of its own, and the two never line up for long: six kinds
 * follow one another and come round, each a little over a minute,
 *
 *   fair     scattered evening cumulus on a light breeze: the scene as it was built, and where a
 *            session starts
 *   breeze   the wind freshens off the lake: cat's-paws race over the water and the grass rolls,
 *            cloud shadows hurry across the meadow and the far hills, the air is clear
 *   towers   the cumulus builds into towers over the hills and the sun fans out between them
 *   shower   a sun shower: rain falls through the sunshine, every drop lit from behind, and
 *            dimples the lake
 *   mist     after the rain the air stands still and mist rises off the water and lies in the
 *            hollows of the meadow; the sun's shafts stand in it
 *   still    a mackerel sky high over a lake like glass
 *
 * and fair again. A weather is a handful of numbers the light rig copies into uniforms; nothing
 * is rebuilt, so every tier and both backends show the same weather. No renderer in here: tests
 * read the table directly.
 */

/** Seconds one weather lasts, the turn to the next included. */
export const SUMMER_WEATHER_SECONDS = 76;
/** The share of a weather's time it simply holds, before it starts turning into the next. */
export const SUMMER_WEATHER_HOLD = 0.45;

const SCALARS = Object.freeze([
    // The sky: how much of the horizon the low cumulus covers and how tall it stands, the same for
    // the row above it, the streaks of the high deck, the mackerel field and the cirrus.
    'low', 'tall', 'mid', 'deck', 'mackerel', 'cirrus',
    // The air: the breeze at rest, how fast the clouds and their shadows travel, how ruffled the
    // lake is, mist (0..1), the haze's density against the hour's own, and rain (0..1).
    'wind', 'drift', 'ruffle', 'mist', 'haze', 'rain',
    // The light: how deep a cloud's shadow is on the land, how much the sun is veiled, the fan of
    // rays about the sun at rest, and the sun's shafts against their resting density.
    'shade', 'veil', 'rays', 'shafts',
]);
export const SUMMER_WEATHER_SCALARS = SCALARS;

const weather = (id, name, values) => Object.freeze({ id, name, ...values });

export const SUMMER_WEATHERS = Object.freeze([
    weather('fair', 'Fair evening', {
        low: 0.52,
        tall: 0.6,
        mid: 0.36,
        deck: 0.5,
        mackerel: 0,
        cirrus: 0.6,
        wind: 0.3,
        drift: 1,
        ruffle: 1,
        mist: 0,
        haze: 1,
        rain: 0,
        shade: 0.4,
        veil: 0,
        rays: 0.1,
        shafts: 1,
    }),
    weather('breeze', 'A fresh breeze', {
        low: 0.52,
        tall: 0.6,
        mid: 0.46,
        deck: 0.4,
        mackerel: 0,
        cirrus: 0.4,
        wind: 0.6,
        drift: 2.4,
        ruffle: 1.7,
        mist: 0,
        haze: 0.8,
        rain: 0,
        shade: 0.55,
        veil: 0,
        rays: 0.08,
        shafts: 0.85,
    }),
    weather('towers', 'Towers over the hills', {
        low: 0.64,
        tall: 1,
        mid: 0.4,
        deck: 0.3,
        mackerel: 0,
        cirrus: 0.3,
        wind: 0.36,
        drift: 1.2,
        ruffle: 1.1,
        mist: 0.05,
        haze: 1,
        rain: 0,
        shade: 0.6,
        veil: 0.05,
        rays: 0.5,
        shafts: 1.15,
    }),
    weather('shower', 'Sun shower', {
        low: 0.8,
        tall: 0.9,
        mid: 0.74,
        deck: 0.6,
        mackerel: 0,
        cirrus: 0.1,
        wind: 0.42,
        drift: 1.6,
        ruffle: 1.2,
        mist: 0.22,
        haze: 1.25,
        rain: 1,
        shade: 0.5,
        veil: 0.3,
        rays: 0.6,
        shafts: 1.3,
    }),
    weather('mist', 'Mist on the water', {
        low: 0.2,
        tall: 0.4,
        mid: 0.1,
        deck: 0.25,
        mackerel: 0.15,
        cirrus: 0.5,
        wind: 0.1,
        drift: 0.4,
        ruffle: 0.35,
        mist: 1,
        haze: 1.5,
        rain: 0,
        shade: 0.1,
        veil: 0.25,
        rays: 0.35,
        shafts: 1.6,
    }),
    weather('still', 'Mackerel sky', {
        low: 0.12,
        tall: 0.35,
        mid: 0,
        deck: 0.3,
        mackerel: 0.85,
        cirrus: 0.8,
        wind: 0.08,
        drift: 0.3,
        ruffle: 0.18,
        mist: 0.3,
        haze: 1.05,
        rain: 0,
        shade: 0.12,
        veil: 0.1,
        rays: 0.15,
        shafts: 1,
    }),
]);

/** A phase folded onto the wheel of weathers: 0 <= result < SUMMER_WEATHERS.length. */
export function wrapSummerWeather(phase) {
    const count = SUMMER_WEATHERS.length;
    if (!Number.isFinite(phase)) return 0;
    return ((phase % count) + count) % count;
}

/** Where the wheel stands after `seconds` of the theme's own time: phase 0 is fair. */
export function summerWeatherPhase(seconds, period = SUMMER_WEATHER_SECONDS) {
    if (!Number.isFinite(seconds) || !(period > 0)) return 0;
    return wrapSummerWeather(Math.max(0, seconds) / period);
}

/** A blank weather to interpolate into; reuse it every frame. */
export function createSummerWeatherState() {
    const state = { phase: 0 };
    for (const key of SCALARS) state[key] = 0;
    return state;
}

/**
 * The weather at `phase`, written into `out`. A weather holds for the first part of its time
 * and then eases into the next, so each is seen as itself before it turns.
 */
export function summerWeatherAt(phase, out = createSummerWeatherState()) {
    const wrapped = wrapSummerWeather(phase);
    const index = Math.min(SUMMER_WEATHERS.length - 1, Math.floor(wrapped));
    const from = SUMMER_WEATHERS[index];
    const to = SUMMER_WEATHERS[(index + 1) % SUMMER_WEATHERS.length];
    const linear = Math.max(0, (wrapped - index - SUMMER_WEATHER_HOLD) / (1 - SUMMER_WEATHER_HOLD));
    const blend = linear * linear * (3 - 2 * linear);
    for (const key of SCALARS) out[key] = from[key] + (to[key] - from[key]) * blend;
    out.phase = wrapped;
    return out;
}

/** The weather nearest a phase (for diagnostics and captions). */
export function nearestSummerWeather(phase) {
    return SUMMER_WEATHERS[Math.round(wrapSummerWeather(phase)) % SUMMER_WEATHERS.length];
}
