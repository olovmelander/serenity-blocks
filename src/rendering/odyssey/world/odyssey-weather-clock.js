/**
 * THE WEATHER'S CLOCK — the island and the mountains are never quite the same twice (masterpiece
 * pass, 2026-11-17).
 *
 * The audit: "nothing changes with time anywhere" — the cloud shadows drifted and the trees swayed,
 * but on one unchanging schedule, so an orb looked the same on every visit. This is a slow weather
 * on the world's clock: how much cloud stands over the land, how hard the wind blows, how much
 * mist lies in the hollows, and how clear the light is. Each is a sum of two or three sines with
 * periods of one to five minutes that share no common multiple, so the weather never repeats while
 * a player watches and never jumps (it is continuous in time, and its rate is bounded: nothing
 * here moves faster than a cloud does). Subtle by design: the weather colours a view, it never
 * replaces it.
 *
 * Pure (no three.js): the world reads it once a frame and writes four uniforms.
 */

const TAU = Math.PI * 2;

/** One slow signal: [period (s), weight, phase (turns)] terms; the weights sum to 1. */
export const ODYSSEY_WEATHER = Object.freeze({
    /** Cloud over the land: more of it, more and larger shadows crossing the meadows. */
    cover: Object.freeze([
        Object.freeze([191, 0.6, 0.13]),
        Object.freeze([83, 0.4, 0.58]),
    ]),
    /** The wind: calm spells and gusty ones (the gust fronts' own period is ~10 s). */
    gust: Object.freeze([
        Object.freeze([67, 0.55, 0.31]),
        Object.freeze([149, 0.45, 0.77]),
    ]),
    /** The mist in the hollows: it gathers, then lifts and thins. */
    mist: Object.freeze([
        Object.freeze([233, 0.65, 0.05]),
        Object.freeze([101, 0.35, 0.44]),
    ]),
    /** The light: thin high cloud crossing the sun softens it, clear air sharpens it. */
    light: Object.freeze([
        Object.freeze([127, 0.5, 0.71]),
        Object.freeze([307, 0.5, 0.22]),
    ]),
});

/** How far each signal moves what it drives. */
export const ODYSSEY_WEATHER_RANGE = Object.freeze({
    /** Added to the cloud shadows' cover (0..1). */
    cover: 0.18,
    /** The gusts' strength: [calm, gusty] multipliers. */
    gust: Object.freeze([0.45, 1.25]),
    /** The mist's density: [thin, thick] multipliers. */
    mist: Object.freeze([0.6, 1.5]),
    /** The sun's brightness (±) and how far soft light leans to the sky's own colour. */
    light: 0.045,
    lightSoft: 0.06,
});

function signal(terms, time) {
    let sum = 0;
    for (let i = 0; i < terms.length; i += 1) {
        const [period, weight, phase] = terms[i];
        sum += weight * Math.sin(TAU * ((time / period) + phase));
    }
    return sum;
}

/**
 * The weather at world time `time` (seconds).
 * @param {number} time
 * @returns {{cover:number, gust:number, mist:number, light:number}} each -1..1
 */
export function odysseyWeatherAt(time) {
    const t = Number.isFinite(time) ? time : 0;
    return {
        cover: signal(ODYSSEY_WEATHER.cover, t),
        gust: signal(ODYSSEY_WEATHER.gust, t),
        mist: signal(ODYSSEY_WEATHER.mist, t),
        light: signal(ODYSSEY_WEATHER.light, t),
    };
}

const lerp = (a, b, t) => a + ((b - a) * t);

/**
 * What the weather does to the world at `time`, in the units its uniforms take.
 * @param {number} time seconds
 * @param {number} [amount] 0..1: how much of the weather applies (0 under water and in space)
 * @param {object} [out] written and returned (the world hands in its own, so a frame allocates nothing)
 * @returns {{cover:number, gust:number, mist:number, sun:number, soft:number}}
 *   `cover` added to the shadows' cover, `gust` and `mist` multipliers, `sun` a brightness
 *   multiplier, `soft` 0..1 how far the sun's colour leans to the sky's
 */
export function odysseyWeatherDrive(time, amount = 1, out = {}) {
    const t = Number.isFinite(time) ? time : 0;
    const k = Math.min(Math.max(Number.isFinite(amount) ? amount : 0, 0), 1);
    const R = ODYSSEY_WEATHER_RANGE;
    const light = signal(ODYSSEY_WEATHER.light, t);
    // (`|| 0`: a signal on its way through zero must not hand a uniform a negative zero.)
    out.cover = (signal(ODYSSEY_WEATHER.cover, t) * R.cover * k) || 0;
    out.gust = lerp(1, lerp(R.gust[0], R.gust[1], (signal(ODYSSEY_WEATHER.gust, t) * 0.5) + 0.5), k);
    out.mist = lerp(1, lerp(R.mist[0], R.mist[1], (signal(ODYSSEY_WEATHER.mist, t) * 0.5) + 0.5), k);
    out.sun = 1 + (light * R.light * k);
    out.soft = (Math.max(0, -light) * R.lightSoft * k) || 0;
    return out;
}
