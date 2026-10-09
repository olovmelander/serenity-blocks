/**
 * Summer — the hours of the midsummer night.
 *
 * On the longest day the sun does not set: it sinks to the hills, rests there and climbs
 * again. Five hours follow one another and come round, and each has its colours and its
 * place for the sun:
 *
 *   evening      a gold sun in the ring of the maypole's wreath, deep blue overhead, peach
 *                clouds (the scene as it was built, and where a session starts)
 *   rose hour    the sun sinks toward the lake and reddens; rose and lilac sky
 *   white night  the sun an ember resting on the far hills, the land in blue dusk, lamps
 *   dawn         an apricot sun rising beside the maypole, pale turquoise sky, thick mist
 *   morning      a white-gold sun high over the wreath, clear blue, white clouds
 *
 * and from the morning it comes down into the ring again. The sun keeps to the sky left of
 * the board all the while: the board hides the middle of the screen (its edge is 10.7
 * degrees from straight ahead at this lens, whatever the window's shape, because the board
 * is sized by the window's height), and in single player the score card stands to its right.
 *
 * An hour is a point on a circle: `phase` 0 is evening, 1 the rose hour, and so on; 5 is
 * evening again. Each level of the game stands one hour further on, and the night also
 * moves by itself, one hour every `SUMMER_HOUR_SECONDS`. No renderer in here: the light
 * rig copies an hour into its uniforms, and tests read the table directly.
 *
 * Colours are linear RGB at the scale the materials expect (the tone mapper sits after
 * them), so values above 1 are ordinary.
 */

/** Seconds the night takes to move one hour by itself. */
export const SUMMER_HOUR_SECONDS = 240;
/** Time constant, in seconds, of the turn to a new hour when the level changes. */
export const SUMMER_HOUR_TURN_SECONDS = 2.4;

const COLOURS = Object.freeze([
    // The sun's light, the two ambient poles, and the sky dome.
    'sun', 'skyLight', 'bounce', 'zenith', 'skyMid', 'skyAway', 'skyToward',
    // The air: shaded distance and sunlit distance.
    'hazeCool', 'hazeWarm',
    // Clouds, each from the side away from the sun to the side toward it.
    'cloudShadeAway', 'cloudShadeToward', 'cloudBodyAway', 'cloudBodyToward', 'cloudGiltAway', 'cloudGiltToward',
    'cirrusAway', 'cirrusToward',
    // Lit air in the volumetric shafts.
    'shaftCool', 'shaftWarm',
]);
const SCALARS = Object.freeze([
    // Haze density per metre, how brightly windows burn, and exposure against the resting value.
    'haze', 'lamps', 'exposure',
    // Where the sun stands, in degrees: azimuth from straight ahead (negative is to the left)
    // and elevation above the horizon.
    'sunAzimuth', 'sunElevation',
]);

export const SUMMER_HOUR_COLOURS = COLOURS;
export const SUMMER_HOUR_SCALARS = SCALARS;

const hour = (id, name, values) => Object.freeze({
    id,
    name,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value.slice()) : value,
    ])),
});

export const SUMMER_HOURS = Object.freeze([
    hour('evening', 'Evening', {
        sun: [3.6, 2.6, 1.42],
        skyLight: [0.24, 0.36, 0.58],
        bounce: [0.15, 0.2, 0.065],
        zenith: [0.03, 0.14, 0.44],
        skyMid: [0.09, 0.33, 0.66],
        skyAway: [0.62, 0.4, 0.4],
        skyToward: [1.4, 0.82, 0.3],
        hazeCool: [0.22, 0.32, 0.48],
        hazeWarm: [0.95, 0.58, 0.26],
        cloudShadeAway: [0.3, 0.27, 0.44],
        cloudShadeToward: [0.62, 0.34, 0.3],
        cloudBodyAway: [0.78, 0.47, 0.44],
        cloudBodyToward: [1.12, 0.6, 0.36],
        cloudGiltAway: [1.22, 0.98, 0.84],
        cloudGiltToward: [1.95, 1.4, 0.72],
        cirrusAway: [0.8, 0.5, 0.5],
        cirrusToward: [1.4, 0.95, 0.56],
        shaftCool: [0.05, 0.065, 0.09],
        shaftWarm: [1.25, 0.86, 0.4],
        haze: 0.0012,
        lamps: 1,
        exposure: 1,
        // In the ring of the maypole's right-hand wreath, as the resting camera sees it
        // (tests/unit/summer-world.test.js holds the alignment).
        sunAzimuth: -14.5,
        sunElevation: 9,
    }),
    hour('rose', 'Rose hour', {
        sun: [3.5, 1.85, 1.15],
        skyLight: [0.3, 0.3, 0.56],
        bounce: [0.16, 0.16, 0.08],
        zenith: [0.07, 0.1, 0.42],
        skyMid: [0.24, 0.26, 0.62],
        skyAway: [0.5, 0.36, 0.6],
        skyToward: [1.5, 0.6, 0.42],
        hazeCool: [0.3, 0.27, 0.48],
        hazeWarm: [1.05, 0.46, 0.38],
        cloudShadeAway: [0.3, 0.22, 0.46],
        cloudShadeToward: [0.6, 0.28, 0.34],
        cloudBodyAway: [0.8, 0.42, 0.52],
        cloudBodyToward: [1.2, 0.5, 0.42],
        cloudGiltAway: [1.25, 0.85, 0.9],
        cloudGiltToward: [2, 1.15, 0.7],
        cirrusAway: [0.85, 0.45, 0.6],
        cirrusToward: [1.5, 0.75, 0.55],
        shaftCool: [0.06, 0.055, 0.09],
        shaftWarm: [1.3, 0.62, 0.42],
        haze: 0.0013,
        lamps: 1.25,
        exposure: 1,
        sunAzimuth: -12.8,
        sunElevation: 6.4,
    }),
    hour('white-night', 'White night', {
        // The view looks toward the sun, so the horizon band on that side fills the frame:
        // it stays blue here, and the warmth is left to the sun's own glow and the cloud edges.
        sun: [1.8, 0.56, 0.2],
        skyLight: [0.1, 0.17, 0.36],
        bounce: [0.04, 0.07, 0.06],
        zenith: [0.01, 0.04, 0.2],
        skyMid: [0.03, 0.12, 0.38],
        skyAway: [0.1, 0.17, 0.4],
        skyToward: [0.42, 0.34, 0.5],
        hazeCool: [0.09, 0.16, 0.34],
        hazeWarm: [0.5, 0.27, 0.24],
        cloudShadeAway: [0.06, 0.08, 0.2],
        cloudShadeToward: [0.14, 0.12, 0.24],
        cloudBodyAway: [0.12, 0.15, 0.32],
        cloudBodyToward: [0.34, 0.24, 0.36],
        cloudGiltAway: [0.3, 0.32, 0.5],
        cloudGiltToward: [1.2, 0.6, 0.4],
        cirrusAway: [0.16, 0.2, 0.4],
        cirrusToward: [0.6, 0.36, 0.44],
        shaftCool: [0.02, 0.03, 0.06],
        shaftWarm: [0.7, 0.28, 0.14],
        haze: 0.0016,
        lamps: 2.2,
        exposure: 1.06,
        sunAzimuth: -15.6,
        sunElevation: 5.3,
    }),
    hour('dawn', 'Dawn', {
        sun: [3.3, 2.1, 1.1],
        skyLight: [0.26, 0.4, 0.58],
        bounce: [0.14, 0.2, 0.09],
        zenith: [0.05, 0.2, 0.52],
        skyMid: [0.16, 0.48, 0.7],
        skyAway: [0.5, 0.5, 0.66],
        skyToward: [1.6, 0.85, 0.42],
        hazeCool: [0.24, 0.38, 0.54],
        hazeWarm: [1.1, 0.62, 0.32],
        cloudShadeAway: [0.36, 0.42, 0.6],
        cloudShadeToward: [0.6, 0.5, 0.54],
        cloudBodyAway: [0.74, 0.62, 0.78],
        cloudBodyToward: [1.35, 0.78, 0.5],
        cloudGiltAway: [1.25, 1.05, 1],
        cloudGiltToward: [2, 1.4, 0.8],
        cirrusAway: [0.85, 0.66, 0.74],
        cirrusToward: [1.5, 0.92, 0.6],
        shaftCool: [0.06, 0.08, 0.11],
        shaftWarm: [1.25, 0.78, 0.42],
        haze: 0.0015,
        lamps: 0.7,
        exposure: 1,
        sunAzimuth: -17.6,
        sunElevation: 7.6,
    }),
    hour('morning', 'Morning', {
        sun: [3.9, 3.35, 2.5],
        skyLight: [0.28, 0.42, 0.68],
        bounce: [0.17, 0.24, 0.07],
        zenith: [0.02, 0.16, 0.56],
        skyMid: [0.1, 0.4, 0.8],
        skyAway: [0.4, 0.56, 0.78],
        skyToward: [1.2, 1, 0.7],
        hazeCool: [0.26, 0.38, 0.56],
        hazeWarm: [0.9, 0.78, 0.5],
        cloudShadeAway: [0.42, 0.5, 0.66],
        cloudShadeToward: [0.6, 0.62, 0.7],
        cloudBodyAway: [0.86, 0.9, 0.98],
        cloudBodyToward: [1.1, 1.05, 0.98],
        cloudGiltAway: [1.3, 1.3, 1.3],
        cloudGiltToward: [1.9, 1.75, 1.4],
        cirrusAway: [0.9, 0.92, 1],
        cirrusToward: [1.3, 1.2, 1],
        shaftCool: [0.05, 0.07, 0.1],
        shaftWarm: [1.15, 1, 0.7],
        haze: 0.001,
        lamps: 0.25,
        exposure: 0.97,
        sunAzimuth: -12.8,
        sunElevation: 15.2,
    }),
]);

/** A phase folded onto the circle of hours: 0 <= result < SUMMER_HOURS.length. */
export function wrapSummerHour(phase) {
    const count = SUMMER_HOURS.length;
    if (!Number.isFinite(phase)) return 0;
    // Twice, so a negative phase lands inside the circle and a whole number of turns is +0.
    return ((phase % count) + count) % count;
}

/** The hour a level stands at: level 1 is evening, and every level is one hour further on. */
export function summerHourForLevel(level) {
    const whole = Number.isFinite(level) ? Math.max(1, Math.round(level)) : 1;
    return (whole - 1) % SUMMER_HOURS.length;
}

/** A blank hour to interpolate into; reuse it every frame. */
export function createSummerHourState() {
    const state = { phase: 0 };
    for (const key of COLOURS) state[key] = new Float32Array(3);
    for (const key of SCALARS) state[key] = 0;
    return state;
}

/**
 * The colours of the night at `phase`, written into `out`. Between two hours the blend is
 * eased, so the night lingers at each hour and turns more quickly in between.
 */
export function summerHourAt(phase, out = createSummerHourState()) {
    const wrapped = wrapSummerHour(phase);
    const index = Math.min(SUMMER_HOURS.length - 1, Math.floor(wrapped));
    const from = SUMMER_HOURS[index];
    const to = SUMMER_HOURS[(index + 1) % SUMMER_HOURS.length];
    const linear = wrapped - index;
    const blend = linear * linear * (3 - 2 * linear);
    for (const key of COLOURS) {
        const a = from[key];
        const b = to[key];
        const target = out[key];
        target[0] = a[0] + (b[0] - a[0]) * blend;
        target[1] = a[1] + (b[1] - a[1]) * blend;
        target[2] = a[2] + (b[2] - a[2]) * blend;
    }
    for (const key of SCALARS) out[key] = from[key] + (to[key] - from[key]) * blend;
    out.phase = wrapped;
    return out;
}

/**
 * Unit vector from the scene toward a sun at an azimuth and elevation in degrees, written
 * into `out` as [x, y, z]. The camera looks down -z, so azimuth 0 is straight ahead.
 */
export function summerSunDirection(azimuth, elevation, out = [0, 0, 0]) {
    const turn = (azimuth * Math.PI) / 180;
    const rise = (elevation * Math.PI) / 180;
    out[0] = Math.sin(turn) * Math.cos(rise);
    out[1] = Math.sin(rise);
    out[2] = -Math.cos(turn) * Math.cos(rise);
    return out;
}

/** The hour nearest a phase (for diagnostics and captions). */
export function nearestSummerHour(phase) {
    return SUMMER_HOURS[Math.round(wrapSummerHour(phase)) % SUMMER_HOURS.length];
}
