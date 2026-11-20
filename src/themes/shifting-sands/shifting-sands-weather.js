// @ts-check

/**
 * Shifting Sands — the weather of the erg (CPU only, three-free).
 *
 * Beside the hours (shifting-sands-hours.js: the light) the air has its own clock, so the same
 * hour never comes round under the same sky. Six weathers on a wheel, each a few numbers the
 * world spends on the sky, the air and the sand; between them every number melts:
 *
 *   clear    the still dusk: wisps of cirrus, clean far air (the opening look)
 *   streets  long streets of cirrus streaming toward the suns, thick enough to burn from below
 *   deck     a ceiling of high cloud with a clear slot along the horizon: the low suns shine up
 *            through the slot and its underside takes fire
 *   haze     the dust hangs: thick warm air, the suns dimmed to discs the eye can rest on, the
 *            far erg and the Rampart veiled, long rays
 *   wind     it blows: the crests smoke, sheets of sand stream wide over the erg, gust after gust
 *            crosses it, the dust banks drive
 *   front    a wall of dust stands on the far horizon and travels along it, lightning in its body
 *
 * And the happenings: small things that come by the clock in any weather (a dust devil walking
 * the erg, a falling star once the stars are out, a gust front when it blows). All of it is a
 * function of the time alone, so a seek, a replay and a rebuild land on the same sky.
 */

import { moodDrift, wheelAt } from '../shared/mood-clock.js';

/** What a weather is made of (every value 0..1 unless said). */
export const WEATHER_KEYS = Object.freeze(['cirrus', 'streets', 'deck', 'haze', 'wind', 'wall']);

export const WEATHERS = Object.freeze([
    Object.freeze({
        name: 'clear', cirrus: 0.5, streets: 0, deck: 0, haze: 0, wind: 0, wall: 0,
    }),
    Object.freeze({
        name: 'streets', cirrus: 1, streets: 1, deck: 0, haze: 0.08, wind: 0.15, wall: 0,
    }),
    Object.freeze({
        name: 'deck', cirrus: 0.3, streets: 0.2, deck: 1, haze: 0.05, wind: 0.1, wall: 0,
    }),
    Object.freeze({
        name: 'haze', cirrus: 0.35, streets: 0.3, deck: 0, haze: 1, wind: 0.2, wall: 0,
    }),
    Object.freeze({
        name: 'wind', cirrus: 0.8, streets: 0.7, deck: 0.15, haze: 0.3, wind: 1, wall: 0,
    }),
    Object.freeze({
        name: 'front', cirrus: 0.25, streets: 0.1, deck: 0.3, haze: 0.25, wind: 0.55, wall: 1,
    }),
]);

/** Seconds a weather lasts, and the share of that it rests before it melts into the next. */
export const WEATHER_SECONDS = 76;
export const WEATHER_HOLD = 0.4;

/** The index of a weather by name (or -1). */
export function weatherIndex(name) {
    return WEATHERS.findIndex((w) => w.name === name);
}

/** A fresh weather to write into. */
export function makeWeather() {
    /** @type {Record<string, any>} */
    const out = {
        from: 0, to: 0, melt: 0, phase: 0,
    };
    for (const key of WEATHER_KEYS) out[key] = 0;
    return out;
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The weather at a phase round the wheel (whole numbers are the weathers themselves).
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function weatherAtPhase(phase, out = makeWeather()) {
    wheelAt(phase, WEATHERS.length, AT);
    const a = WEATHERS[AT.a];
    const b = WEATHERS[AT.b];
    out.from = AT.a;
    out.to = AT.b;
    out.melt = AT.melt;
    out.phase = phase;
    for (let i = 0; i < WEATHER_KEYS.length; i++) {
        const key = WEATHER_KEYS[i];
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    return out;
}

/** How far the clock alone has turned the weather by `time` (whole numbers: a weather at rest). */
export const weatherDrift = (time) => moodDrift(time, WEATHER_SECONDS, WEATHER_HOLD);

/**
 * The weather at `time`.
 * @param {number} time
 * @param {Record<string, any>} [out]
 */
export function weatherAt(time, out = makeWeather()) {
    return weatherAtPhase(weatherDrift(time), out);
}

// ── The wall of dust on the horizon ─────────────────────────────────────────────

/**
 * Where the front stands: it comes in from the right of the lens and travels along the horizon
 * toward the suns' bearing while its weather lasts (degrees of azimuth, + right of forward), and
 * when a level calls it, it runs the whole horizon in a few seconds.
 */
export const WALL = Object.freeze({
    /** Azimuth it stands at when its weather begins, and how far it travels while that lasts. */
    from: 58,
    travel: -64,
    /** Half its length along the horizon (degrees). */
    half: 30,
    /** Seconds between flickers of lightning in its body, and how long one lasts. */
    flickerEvery: 3.4,
    flicker: 0.55,
});

/** A hash of a whole number in [0, 1). */
export function hash01(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
}

/**
 * The lightning inside the wall at `time`: one soft flicker at a time, at its own place along the
 * wall each time. Returns `out`: `glow` (0..1) and `at` (-1..1 along the wall's length).
 * A flicker is a double beat (a stroke and its dimmer return), never a strobe.
 * @param {number} time
 * @param {{ glow: number, at: number }} [out]
 */
export function wallLightning(time, out = { glow: 0, at: 0 }) {
    const turn = time / WALL.flickerEvery;
    const n = Math.floor(turn);
    // Each flicker starts a little late or early, and about one in four does not come.
    const start = (n + 0.15 + hash01(n * 3.1) * 0.5) * WALL.flickerEvery;
    const age = time - start;
    out.at = hash01(n * 7.7 + 2.3) * 2 - 1;
    if (age < 0 || age > WALL.flicker || hash01(n * 5.3 + 1.1) < 0.25) {
        out.glow = 0;
        return out;
    }
    const u = age / WALL.flicker;
    const beat = (x, w) => Math.exp(-(((u - x) / w) ** 2));
    out.glow = Math.min(1, beat(0.14, 0.09) + 0.55 * beat(0.5, 0.16));
    return out;
}

// ── Happenings ──────────────────────────────────────────────────────────────────

/** A dust devil walks the erg this often (seconds), for this long, from this time on. */
export const DEVIL_WALKS = Object.freeze({ every: 47, first: 21, life: 15 });
/** A falling star crosses the sky this often once the stars are out (seconds). */
export const METEORS = Object.freeze({ every: 13, life: 1.5, minStars: 0.45 });
/** When it blows, a gust front crosses the erg this often (seconds). */
export const GUST_FRONTS = Object.freeze({ every: 9.5, minWind: 0.45 });

/**
 * The happening of one kind that is due at `time`: its count since the start (so each is told
 * apart, and a caller fires each once) and when it began. -1 before the first.
 * @param {{ every: number, first?: number }} plan
 * @param {number} time
 */
export function happeningIndex(plan, time) {
    const first = plan.first ?? plan.every * 0.5;
    return time < first ? -1 : Math.floor((time - first) / plan.every);
}

/** When happening `n` of a plan begins. */
export function happeningStart(plan, n) {
    return (plan.first ?? plan.every * 0.5) + n * plan.every;
}

/**
 * A falling star: where it starts in the sky and which way it falls (azimuth and elevation in
 * degrees; the run in degrees of sky), from its count alone.
 * @param {number} n
 */
export function meteorPath(n) {
    const az = -52 + hash01(n * 1.7 + 0.3) * 104;
    const el = 9 + hash01(n * 2.9 + 4.1) * 13;
    // They fall slantwise, either way, never level and never straight down.
    const side = hash01(n * 4.3 + 7.7) < 0.5 ? -1 : 1;
    const slant = (22 + hash01(n * 6.1 + 1.9) * 38) * side;
    return {
        az, el, slant, run: 7 + hash01(n * 8.9 + 5.5) * 9, bright: 0.55 + hash01(n * 3.7 + 9.1) * 0.45,
    };
}
