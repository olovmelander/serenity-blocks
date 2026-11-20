/**
 * Spring — the weather: what the sky and the air do over the valley, beside the hour of the day
 * (CPU only, three-free).
 *
 * The day turns through its six stations on one clock (spring-hours.js); the weather turns through
 * its own on another, a little slower, so the two drift past each other and the same hour never
 * meets the same sky twice running: a mackerel sky at noon one day burns at sunset the next.
 *
 *   fair             the day as the hours author it: a few heaps on the fells, mares' tails high up
 *   mackerel sky     rippled altocumulus over the whole sky (it burns from below at a low sun)
 *   building heaps   the cumulus stands taller and fuller, its shadows sweep the valley, a fresher
 *                    breeze
 *   after the shower washed, clear air under broken cloud, the woods steaming a little, and where
 *                    the sun stands behind the eye a rainbow against the rain leaving down the valley
 *   veiled sun       a milky veil of cirrostratus: a halo round the sun, soft shadows, still air
 *   clear and windy  a deep clean sky, the fells sharp, the petals streaming on a stiff breeze
 *
 * Where the weather stands is one number, its place: `clock / WEATHER_TIMING.span` (weather k
 * stands at place k, the first at 0: a session opens on the fair day). It holds a weather and
 * then crosses to the next over `cross` seconds; nothing in it is switched.
 *
 * Each weather is a row of numbers the world spends on what it already draws:
 *   cover    added to the hour's share of sky the cumulus deck holds
 *   coverMul and that share's multiplier
 *   alto     the altocumulus layer (0 none … 1 a full mackerel sky)
 *   cirrus   the high cirrus (1 the hour's own)
 *   veil     the cirrostratus veil (0..1): it whitens the sky, softens the sun, and rings it
 *   wind     how hard it blows (1 the hour's breeze): the clouds' drift, the plants' lean, the
 *            air's pace
 *   banks    how tall the heaps on the horizon stand (1 their own height)
 *   haze     the haze's multiplier (below 1: washed, clear air)
 *   mist     added to the hour's mist over the water
 *   bow      how strong a rainbow stands where the sun's place allows one (0..1)
 */
import { clamp, lerp, smooth } from './spring-core.js';

/** One weather holds and crosses to the next in `span` seconds; the crossing takes `cross`. */
export const WEATHER_TIMING = Object.freeze({ span: 130, cross: 46 });

const row = (name, cover, coverMul, alto, cirrus, veil, wind, banks, haze, mist, bow) => Object.freeze({
    name, cover, coverMul, alto, cirrus, veil, wind, banks, haze, mist, bow,
});

export const WEATHERS = Object.freeze([
    //  name                cover  coverMul alto  cirrus veil wind  banks haze  mist   bow
    row('fair', 0, 1, 0.12, 1, 0, 1, 1, 1, 0, 0),
    row('mackerel sky', -0.06, 0.7, 1, 0.5, 0.1, 0.85, 0.9, 1.05, 0, 0),
    row('building heaps', 0.16, 1.25, 0.22, 0.3, 0, 1.35, 1.38, 0.95, 0, 0),
    row('after the shower', 0.08, 1.15, 0.4, 0.2, 0, 1.1, 1.2, 0.62, 0.12, 1),
    row('veiled sun', -0.1, 0.6, 0.3, 1.5, 1, 0.6, 0.85, 1.2, 0.04, 0),
    row('clear and windy', -0.14, 0.45, 0.04, 0.25, 0, 1.9, 0.75, 0.6, -0.04, 0),
]);

export const WEATHER_COUNT = WEATHERS.length;
export const WEATHER_KEYS = Object.freeze([
    'cover', 'coverMul', 'alto', 'cirrus', 'veil', 'wind', 'banks', 'haze', 'mist', 'bow',
]);

/** The weather's place on the clock (weathers from the fair day). */
export function weatherPlace(time) {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    return t / WEATHER_TIMING.span;
}

/** Which two weathers the sky stands between at a place, and how far it has crossed (0..1). */
export function weatherMix(place, out = {}) {
    const p = Number.isFinite(place) ? place : 0;
    const whole = Math.floor(p);
    const from = ((whole % WEATHER_COUNT) + WEATHER_COUNT) % WEATHER_COUNT;
    const hold = 1 - WEATHER_TIMING.cross / WEATHER_TIMING.span;
    out.from = from;
    out.to = (from + 1) % WEATHER_COUNT;
    out.mix = smooth(hold, 1, p - whole);
    return out;
}

export function createWeather() {
    const weather = {
        from: 0, to: 1, mix: 0, place: 0, name: WEATHERS[0].name,
    };
    for (const key of WEATHER_KEYS) weather[key] = WEATHERS[0][key];
    return weather;
}

const mixed = {};

/** The weather at a place, written into `out` (allocated once by the caller). */
export function weatherAt(place, out = createWeather()) {
    const { from, to, mix } = weatherMix(place, mixed);
    const a = WEATHERS[from];
    const b = WEATHERS[to];
    for (const key of WEATHER_KEYS) out[key] = lerp(a[key], b[key], mix);
    out.from = from;
    out.to = to;
    out.mix = mix;
    out.place = place;
    out.name = (mix < 0.5 ? a : b).name;
    return out;
}

/**
 * How far a rainbow can stand in the sky with the sun `el` degrees up (0..1): the sun must be up
 * and clear of the skyline for the bow to be lit, and under 42° for any of the bow to stand over
 * the horizon (its top is 42° less the sun's height up). Where it stands follows the sun alone:
 * the bow is drawn at its true angle from the point opposite the sun, so only its part in the
 * lens shows.
 */
export function bowLight(el, sunUp = 1) {
    return clamp(sunUp, 0, 1) * smooth(1.5, 6, el) * (1 - smooth(38, 43, el));
}

/** The night-shining clouds' share with the sun `el` degrees up: only with it under the north. */
export const nightShine = (el) => 1 - smooth(-3.6, 0.6, el);

/** How far a low sun lights the high clouds from below (0 by day and deep under the horizon … 1). */
export const underLight = (el) => (1 - smooth(5, 16, el)) * smooth(-7, -2.2, el);
