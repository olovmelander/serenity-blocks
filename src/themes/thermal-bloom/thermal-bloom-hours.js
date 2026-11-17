/**
 * Thermal Bloom — the basin's hours (three-free).
 *
 * Beside the year (the season wheel, thermal-bloom-core.js) the basin has a day: Morning, the
 * look the theme was built in, then Golden Hour, Dusk, Night and Dawn, and round again. The sun
 * never moves (it stands behind the left shoulder, where the one rainbow needs it); what turns is
 * its light. Every material reads its light from a handful of uniforms (the sun's colour, the
 * zenith, the haze, the pearl), so an hour is a set of multipliers and offsets on the season's own
 * colours: `season × mul + add`, in linear light.
 *
 * As the light falls the heat shows: `glow` raises the springs' own light (the Iris from its
 * throat, the hot bands and thin veins down the runoff channels, the Stair's pools, the jewel
 * pools), so by night the basin is lit from below. It is kept low: a first pass at 0.82 with the
 * channels lit along their whole length read as a lava field in neon. `stars` brings the night sky out, `twilight` the rose band that
 * stands over the far range opposite a sun below the horizon, with the earth's blue shadow under
 * it, and `alpen` the last (or first) sunlight on whatever stands tall enough to reach it: the
 * steam columns' crowns and the far range.
 *
 * The hours turn on the clock alone (a level-up steps the year, never the day), HOUR_STEP seconds
 * an hour, resting at each end of a step, so with the year's 100 s the two never meet the same
 * way twice in a session.
 */

/** Seconds an hour lasts on the theme's clock, and the share of it rested at each end. */
export const HOUR_STEP = 130;
export const HOUR_REST = 0.2;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (lo, hi, v) => {
    const k = clamp01((v - lo) / (hi - lo));
    return k * k * (3 - 2 * k);
};

/**
 * The hours. Colours are linear rgb triples. `sun`, `zenith`, `haze`, `pearl`: [mul, add] on the
 * season's colour. `land`: the light on far things the backdrop paints unlit (the forest, the
 * plateau, snow). `exposure`, `sat`: the post's. `gradeShadow`, `gradeLight`: the post's grade.
 * `steam`: the plumes' density (a cold dawn steams hardest). `shadow`: how firmly the direct
 * light's shadows hold (a sun below the horizon casts none), and `shadowLong` how long the hour
 * lays them (× the morning's). `glow`: the springs' own light at rest in that hour.
 */
export const HOURS = Object.freeze([
    Object.freeze({
        name: 'Morning',
        sun: [[1, 1, 1], [0, 0, 0]],
        zenith: [[1, 1, 1], [0, 0, 0]],
        haze: [[1, 1, 1], [0, 0, 0]],
        pearl: [[1, 1, 1], [0, 0, 0]],
        land: [1, 1, 1],
        glow: 0,
        stars: 0,
        twilight: [0, 0, 0],
        earthShadow: 0,
        alpen: [0, 0, 0],
        exposure: 1,
        sat: 1,
        gradeShadow: [0.012, 0.03, 0.06],
        gradeLight: [1.0, 0.93, 0.84],
        steam: 1,
        shadow: 1,
        shadowLong: 1,
    }),
    Object.freeze({
        name: 'Golden Hour',
        sun: [[1.2, 0.72, 0.42], [0, 0, 0]],
        zenith: [[0.95, 0.9, 0.9], [0.012, 0.004, 0]],
        haze: [[1.08, 0.86, 0.64], [0, 0, 0]],
        pearl: [[1.06, 0.86, 0.66], [0, 0, 0]],
        land: [0.95, 0.78, 0.62],
        glow: 0.08,
        stars: 0,
        twilight: [0.26, 0.1, 0.03],
        earthShadow: 0,
        alpen: [0.1, 0.045, 0.01],
        exposure: 1,
        sat: 1.05,
        gradeShadow: [0.03, 0.02, 0.05],
        gradeLight: [1.0, 0.9, 0.76],
        steam: 1,
        shadow: 1,
        shadowLong: 1.6,
    }),
    Object.freeze({
        name: 'Dusk',
        sun: [[0.05, 0.04, 0.05], [0.16, 0.085, 0.11]],
        zenith: [[0.42, 0.36, 0.44], [0.004, 0.0, 0.012]],
        haze: [[0.25, 0.27, 0.4], [0, 0, 0]],
        pearl: [[0.3, 0.28, 0.38], [0, 0, 0]],
        land: [0.24, 0.23, 0.33],
        glow: 0.4,
        stars: 0.3,
        twilight: [0.42, 0.15, 0.15],
        earthShadow: 0.55,
        alpen: [0.5, 0.2, 0.16],
        exposure: 1.3,
        sat: 1.02,
        gradeShadow: [0.02, 0.02, 0.07],
        gradeLight: [1.0, 0.92, 0.94],
        steam: 1.05,
        shadow: 0.35,
        shadowLong: 1.9,
    }),
    Object.freeze({
        name: 'Night',
        sun: [[0, 0, 0], [0.09, 0.135, 0.225]],
        zenith: [[0.03, 0.03, 0.04], [0.004, 0.008, 0.02]],
        haze: [[0.03, 0.035, 0.055], [0.008, 0.012, 0.022]],
        pearl: [[0.035, 0.04, 0.058], [0, 0, 0]],
        land: [0.03, 0.04, 0.07],
        glow: 0.6,
        stars: 1,
        twilight: [0, 0, 0],
        earthShadow: 0,
        alpen: [0, 0, 0],
        exposure: 1.8,
        sat: 1.0,
        gradeShadow: [0.006, 0.014, 0.05],
        gradeLight: [0.9, 0.96, 1.0],
        steam: 1.1,
        shadow: 0.8,
        shadowLong: 0.8,
    }),
    Object.freeze({
        name: 'Dawn',
        sun: [[0.5, 0.3, 0.22], [0.03, 0.02, 0.03]],
        zenith: [[0.62, 0.68, 0.8], [0.004, 0, 0.004]],
        haze: [[0.74, 0.64, 0.68], [0, 0, 0]],
        pearl: [[0.74, 0.62, 0.64], [0, 0, 0]],
        land: [0.55, 0.47, 0.54],
        glow: 0.22,
        stars: 0.05,
        twilight: [0.48, 0.2, 0.13],
        earthShadow: 0.4,
        alpen: [0.55, 0.24, 0.13],
        exposure: 1.12,
        sat: 1.03,
        gradeShadow: [0.03, 0.02, 0.06],
        gradeLight: [1.0, 0.9, 0.86],
        steam: 1.3,
        shadow: 0.55,
        shadowLong: 1.75,
    }),
]);

/** The hours' names, in order (the playground's `hour=` takes an index or a name). */
export const HOUR_NAMES = Object.freeze(HOURS.map((h) => h.name));

/**
 * The day's position eased through each step (whole numbers are the hours themselves): the
 * clock's steps, resting HOUR_REST at each end of every step.
 */
export function hourWheel(time) {
    const s = Math.max(0, Number(time) || 0) / HOUR_STEP;
    const base = Math.floor(s);
    return base + smooth(HOUR_REST, 1 - HOUR_REST, s - base);
}

const COLOUR_KEYS = Object.freeze(['land', 'twilight', 'alpen', 'gradeShadow', 'gradeLight']);
const PAIR_KEYS = Object.freeze(['sun', 'zenith', 'haze', 'pearl']);
const NUMBER_KEYS = Object.freeze([
    'glow', 'stars', 'earthShadow', 'exposure', 'sat', 'steam', 'shadow', 'shadowLong',
]);

/** A blank blended hour (reused by the world: a frame allocates nothing). */
export function createHourState() {
    const state = { wheel: 0, index: 0, name: HOURS[0].name };
    COLOUR_KEYS.forEach((key) => { state[key] = [0, 0, 0]; });
    PAIR_KEYS.forEach((key) => { state[key] = [[1, 1, 1], [0, 0, 0]]; });
    NUMBER_KEYS.forEach((key) => { state[key] = 0; });
    return state;
}

/**
 * The hour a wheel position stands in, blended between its two hours.
 * @param {number} wheel  hourWheel(time), or a held value (2 = Dusk, 2.5 = half way to Night)
 * @param {object} [out]  createHourState()
 */
export function hourAt(wheel, out = createHourState()) {
    const n = HOURS.length;
    const w = Math.max(0, Number(wheel) || 0);
    const base = Math.floor(w);
    const k = w - base;
    const a = HOURS[base % n];
    const b = HOURS[(base + 1) % n];
    out.wheel = w;
    out.index = Math.round(w) % n;
    out.name = HOURS[out.index].name;
    COLOUR_KEYS.forEach((key) => {
        for (let i = 0; i < 3; i++) out[key][i] = a[key][i] + (b[key][i] - a[key][i]) * k;
    });
    PAIR_KEYS.forEach((key) => {
        for (let j = 0; j < 2; j++) {
            for (let i = 0; i < 3; i++) out[key][j][i] = a[key][j][i] + (b[key][j][i] - a[key][j][i]) * k;
        }
    });
    NUMBER_KEYS.forEach((key) => { out[key] = a[key] + (b[key] - a[key]) * k; });
    return out;
}

/** A season's colour under an hour's light: `season × mul + add` (linear rgb, written to `out`). */
export function hourColour(pair, rgb, out = [0, 0, 0]) {
    for (let i = 0; i < 3; i++) out[i] = rgb[i] * pair[0][i] + pair[1][i];
    return out;
}

/** An hour's index for a name or a number (the playground's `hour=`), or null. */
export function hourIndex(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, n);
    const key = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
    const i = HOUR_NAMES.findIndex((name) => name.toLowerCase().replace(/\s+/g, '') === key);
    return i >= 0 ? i : null;
}
