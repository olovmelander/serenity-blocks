/**
 * Forest — the hours of the night.
 *
 * The moon does not move: the whole wood is laid out for where it hangs, and its shadows
 * are drawn once. But the night does. Its colours turn through five hours and come round:
 * the deep night the forest opens in, the small hours when the mist thickens and everything
 * silvers, first light, an amber moonrise, the blue hour, and deep night again. The clock
 * turns them by itself, and every level is one hour on from wherever the clock has brought
 * the night. Plain numbers and no three.js, so the light rig, the tests and a capture share
 * them.
 */

/** Seconds from one hour to the next: ten minutes for the night to come round. */
export const FOREST_HOUR_PERIOD = 120;
/** The share of its period an hour rests before it begins to turn. */
export const FOREST_HOUR_REST = 0.35;

/** The colours an hour sets (linear, as the light rig holds them). */
export const FOREST_HOUR_COLOURS = Object.freeze([
    'moon', 'skyLight', 'bounce', 'fill', 'zenith', 'skyMid', 'skyAway', 'skyToward', 'hazeCool', 'hazeMoon',
    'nightTint', 'moonFace', 'aureole', 'cloudAway', 'cloudToward', 'beamCool', 'beamMoon', 'shade',
]);
/** And the numbers: how thick the air is, how many stars show. */
export const FOREST_HOUR_SCALARS = Object.freeze(['haze', 'stars']);

/**
 * The five hours, in the order the night takes them. `moon` is the moonlight and `moonFace`
 * the disc itself; `skyLight`, `bounce` and `fill` are what the sky, the floor and the lit
 * ride give back; `zenith`, `skyMid`, `skyAway` and `skyToward` are the sky from overhead
 * to the horizon, away from the moon and toward it; `hazeCool` and `hazeMoon` the night air
 * in shade and where the moon is behind it; `nightTint` what moonlight makes of a surface;
 * `aureole` the wide glow round the moon; `cloudAway` and `cloudToward` the thin cloud;
 * `beamCool` and `beamMoon` the moonbeams; `shade` the lean of the darkest tones.
 */
export const FOREST_HOURS = Object.freeze([
    {
        // The forest as it opens: ink and slate blue under a blue-white moon.
        name: 'deep night',
        moon: [1.15, 1.6, 2.5],
        skyLight: [0.075, 0.135, 0.27],
        bounce: [0.016, 0.03, 0.045],
        fill: [0.03, 0.055, 0.1],
        zenith: [0.0035, 0.008, 0.023],
        skyMid: [0.011, 0.026, 0.058],
        skyAway: [0.018, 0.04, 0.078],
        skyToward: [0.105, 0.175, 0.29],
        hazeCool: [0.016, 0.034, 0.066],
        hazeMoon: [0.27, 0.41, 0.63],
        nightTint: [0.84, 0.96, 1.12],
        moonFace: [1.0, 0.95, 0.82],
        aureole: [0.62, 0.8, 1.1],
        cloudAway: [0.012, 0.022, 0.042],
        cloudToward: [0.03, 0.055, 0.1],
        beamCool: [0.02, 0.042, 0.082],
        beamMoon: [0.4, 0.6, 0.95],
        shade: [0.9, 1.0, 1.14],
        haze: 0.0062,
        stars: 1,
    },
    {
        // The mist thickens in the hollows, the moon whitens, the colour drains to silver.
        name: 'the small hours',
        moon: [1.7, 1.86, 2.0],
        skyLight: [0.1, 0.135, 0.18],
        bounce: [0.02, 0.029, 0.036],
        fill: [0.042, 0.06, 0.082],
        zenith: [0.007, 0.012, 0.021],
        skyMid: [0.02, 0.032, 0.05],
        skyAway: [0.046, 0.06, 0.078],
        skyToward: [0.21, 0.25, 0.3],
        hazeCool: [0.04, 0.052, 0.064],
        hazeMoon: [0.48, 0.55, 0.62],
        nightTint: [0.93, 0.98, 1.05],
        moonFace: [1.0, 0.98, 0.94],
        aureole: [0.78, 0.86, 0.98],
        cloudAway: [0.02, 0.028, 0.04],
        cloudToward: [0.048, 0.062, 0.086],
        beamCool: [0.032, 0.045, 0.066],
        beamMoon: [0.52, 0.62, 0.78],
        shade: [0.96, 1.0, 1.07],
        haze: 0.0114,
        stars: 0.4,
    },
    {
        // First light: rose along the horizon away from the moon, lilac air, the stars going out.
        name: 'first light',
        moon: [1.2, 1.2, 1.5],
        skyLight: [0.15, 0.125, 0.21],
        bounce: [0.032, 0.026, 0.036],
        fill: [0.075, 0.055, 0.075],
        zenith: [0.012, 0.014, 0.038],
        skyMid: [0.05, 0.04, 0.088],
        skyAway: [0.2, 0.09, 0.105],
        skyToward: [0.21, 0.17, 0.25],
        hazeCool: [0.055, 0.04, 0.062],
        hazeMoon: [0.42, 0.34, 0.46],
        nightTint: [1.03, 0.94, 1.03],
        moonFace: [1.0, 0.93, 0.88],
        aureole: [0.88, 0.74, 0.94],
        cloudAway: [0.085, 0.042, 0.052],
        cloudToward: [0.085, 0.07, 0.11],
        beamCool: [0.055, 0.04, 0.068],
        beamMoon: [0.52, 0.44, 0.62],
        shade: [1.0, 0.97, 1.08],
        haze: 0.0082,
        stars: 0.14,
    },
    {
        // The moon comes up amber: honey light down the ride, an ember band under indigo.
        name: 'moonrise',
        moon: [2.6, 1.5, 0.66],
        skyLight: [0.085, 0.082, 0.2],
        bounce: [0.03, 0.022, 0.03],
        fill: [0.09, 0.05, 0.036],
        zenith: [0.005, 0.006, 0.023],
        skyMid: [0.02, 0.018, 0.056],
        skyAway: [0.03, 0.03, 0.076],
        skyToward: [0.32, 0.14, 0.08],
        hazeCool: [0.025, 0.024, 0.058],
        hazeMoon: [0.64, 0.36, 0.19],
        nightTint: [1.1, 0.94, 0.84],
        moonFace: [1.0, 0.7, 0.36],
        aureole: [1.0, 0.6, 0.33],
        cloudAway: [0.014, 0.014, 0.04],
        cloudToward: [0.095, 0.045, 0.038],
        beamCool: [0.052, 0.03, 0.034],
        beamMoon: [0.98, 0.54, 0.24],
        shade: [0.95, 0.96, 1.14],
        haze: 0.0066,
        stars: 0.7,
    },
    {
        // The blue hour: the day's last light is teal in the air, the moon cool and clear.
        name: 'the blue hour',
        moon: [1.15, 1.85, 2.15],
        skyLight: [0.06, 0.18, 0.25],
        bounce: [0.013, 0.037, 0.044],
        fill: [0.028, 0.072, 0.096],
        zenith: [0.005, 0.021, 0.046],
        skyMid: [0.018, 0.062, 0.098],
        skyAway: [0.028, 0.09, 0.118],
        skyToward: [0.11, 0.26, 0.3],
        hazeCool: [0.016, 0.052, 0.07],
        hazeMoon: [0.24, 0.52, 0.6],
        nightTint: [0.8, 1.0, 1.09],
        moonFace: [0.94, 1.0, 0.92],
        aureole: [0.54, 0.92, 1.04],
        cloudAway: [0.013, 0.038, 0.054],
        cloudToward: [0.03, 0.084, 0.108],
        beamCool: [0.017, 0.056, 0.078],
        beamMoon: [0.34, 0.74, 0.9],
        shade: [0.86, 1.02, 1.12],
        haze: 0.0058,
        stars: 0.34,
    },
].map((hour) => Object.freeze(Object.fromEntries(Object.entries(hour).map(([key, value]) => (
    [key, Array.isArray(value) ? Object.freeze(value) : value]))))));

/** Somewhere to put an hour's colours and numbers: a place a caller keeps and fills again. */
export function createForestHour() {
    const hour = {};
    for (const key of FOREST_HOUR_COLOURS) hour[key] = [0, 0, 0];
    for (const key of FOREST_HOUR_SCALARS) hour[key] = 0;
    return hour;
}

/**
 * How far the clock alone has turned the hours at `time` (seconds), in hours: a whole number
 * while one rests, easing to the next whole number as it melts. A function of the time and
 * nothing else, so a seek and a night lived through agree at any frame rate.
 */
export function forestHourDrift(time) {
    const t = Math.max(0, Number.isFinite(time) ? time : 0) / FOREST_HOUR_PERIOD;
    const whole = Math.floor(t);
    const k = Math.max(0, Math.min(1, (t - whole - FOREST_HOUR_REST) / (1 - FOREST_HOUR_REST)));
    // (Held to one: the last step of the ease can overshoot by a rounding, and the next
    // hour would then begin a hair behind it.)
    return whole + Math.min(1, k * k * k * (k * (k * 6 - 15) + 10));
}

/**
 * The night's colours `phase` hours in (any real number: the night comes round). Fills
 * `out[key]` for every colour and number of an hour, mixed between the two hours the phase
 * lies between, and returns `out`.
 */
export function forestHourAt(phase, out = createForestHour()) {
    const n = FOREST_HOURS.length;
    const p = (((Number.isFinite(phase) ? phase : 0) % n) + n) % n;
    const whole = Math.floor(p);
    const f = p - whole;
    const a = FOREST_HOURS[whole % n];
    const b = FOREST_HOURS[(whole + 1) % n];
    for (let k = 0; k < FOREST_HOUR_COLOURS.length; k += 1) {
        const key = FOREST_HOUR_COLOURS[k];
        for (let c = 0; c < 3; c += 1) out[key][c] = a[key][c] + (b[key][c] - a[key][c]) * f;
    }
    for (let k = 0; k < FOREST_HOUR_SCALARS.length; k += 1) {
        const key = FOREST_HOUR_SCALARS[k];
        // eslint-disable-next-line no-param-reassign
        out[key] = a[key] + (b[key] - a[key]) * f;
    }
    return out;
}

/** The name of the hour a phase is nearest. */
export function forestHourName(phase) {
    const n = FOREST_HOURS.length;
    const p = (((Number.isFinite(phase) ? phase : 0) % n) + n) % n;
    return FOREST_HOURS[Math.round(p) % n].name;
}

/**
 * The count of hours nearest `from` that shows the same hour as `wanted`: the night is a
 * circle, so it turns to a level's hour the short way round.
 */
export function forestNearestTurn(from, wanted, n = FOREST_HOURS.length) {
    const start = Number.isFinite(from) ? from : 0;
    const goal = Number.isFinite(wanted) ? wanted : 0;
    return goal + n * Math.round((start - goal) / n);
}
