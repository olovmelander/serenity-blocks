/**
 * Sunset — the day: the light the sea is seen in, round the whole twenty-four hours (CPU only,
 * three-free).
 *
 * The eye looks out over the sea, and the sky turns in front of it from right to left. The sun
 * comes up out of the sea in the strip right of the card, climbs out of the top of the picture,
 * stands high over it at noon, comes back in at the top left in the afternoon and goes down into
 * the sea in the margin left of the card. The moon keeps the same road a little lower, half a
 * day behind: it comes up on the right just before the sun sets on the left, rides out of the
 * picture over the card in the middle of the night, comes back down on the left and sets there
 * just before the sun comes up on the right. Under the sea both run back from left to right.
 *
 * Eleven stations name the day, in the order it runs:
 *
 *   midnight   the moon high over the picture, its light on the sea, the Milky Way
 *   predawn    the moon low on the left, a first green-blue glow low on the right
 *   dawn       the moon setting into the pink belt on the left, fire under the right
 *   sunrise    the sun on the sea on the right, the clouds lit from beneath
 *   morning    the sun leaving the top of the picture, a cool clear blue
 *   noon       the sun high over the picture, a deep trade-wind blue, the sea turquoise
 *   afternoon  the sun coming back in at the top left, a warm horizon
 *   golden     the sun a hand above the sea on the left, everything gold
 *   sunset     the sun on the water, the clouds on fire from beneath; the moon up on the right
 *   afterglow  the sun under the sea, a rose band under violet, the first stars
 *   dusk       the last ember on the left, the moon climbing on the right, the stars out
 *
 * Between two stations the light is on its way, all the time (the clock never holds it).
 *
 * The day runs on the world's clock by a timetable that lingers where the light changes most:
 * DAY_SECONDS of clock make one day, and the hours from golden hour to dusk, and from the moon
 * setting to the morning, take most of them. Where the day stands is one number, the wheel:
 *
 *     wheel = clock + offset          (seconds; the offset is LEVEL_SECONDS for every level)
 *
 * so the clock turns the day by itself, slowly, in every mode, the ones that never level
 * included, and a new level carries it forward a share of a day on top (eased: the sun and the
 * stars are seen to run). Nothing ever turns it back.
 *
 * Every colour is scene-linear. The sun's and the moon's own colours are not authored per
 * station: they come from the air they are seen through (the longer the way through it, the
 * redder), so each body reddens as it nears the sea and whitens as it climbs, wherever it is.
 */
import { DEG, lerp, smooth } from './sunset-core.js';

/** Seconds of the world's clock one whole day lasts when no level turns it. */
export const DAY_SECONDS = 565;
/** A new level carries the day forward this many seconds of the timetable (eight a day). */
export const LEVEL_SECONDS = DAY_SECONDS / 8;
/** A level's turn is eased over this many seconds (a longer one a little longer). */
export const TURN_SECONDS = 3.6;
/** The hour the wheel's second 0 stands on: golden hour, the sun coming down to the sea. */
export const START_HOUR = 16 + 40 / 60;

/**
 * The timetable: [second of the wheel, hour of the day] knots, hours counted on past 24 so
 * they only rise. The day is drawn through them on a smooth curve that never runs back.
 */
export const TIMETABLE = Object.freeze([
    [0, START_HOUR], // golden hour
    [70, 18], // the sun on the water
    [140, 19.5], // afterglow and dusk: the stars come out, the moon climbs
    [200, 23], // the evening
    [260, 27], // the middle of the night
    [305, 29], // the moon comes down on the left
    [355, 30], // dawn and the moon setting
    [430, 32], // sunrise and the morning gold
    [480, 36], // the morning
    [540, 40], // noon and the afternoon
    [DAY_SECONDS, START_HOUR + 24],
].map((knot) => Object.freeze(knot)));

// ── The sky's geometry ──────────────────────────────────────────────────────────────────────

/** The sun's height at noon, and the moon's at its highest (degrees). Both stand over the picture. */
export const SUN_PEAK = 52;
export const MOON_PEAK = 40;
/** The moon runs this many degrees of the sky's turn behind the sun: up just before sunset. */
export const MOON_LAG = 172;
/** How far a body's road leans as it nears the sea (degrees of bearing per degree of height). */
export const ARC_LEAN = 0.2;
/**
 * The moon's phase angle (degrees): the sun lights it from beside the eye, so it shows as a
 * gibbous sphere with its shadow on the limb away from the sun (a full moon would read flat).
 */
export const MOON_PHASE = 50;

const wrap24 = (h) => ((h % 24) + 24) % 24;

/** A body's hour angle (degrees from its highest), `lag` degrees behind the sun. */
export function hourAngle(hour, lag = 0) {
    return 15 * (hour - 12) - lag;
}

/**
 * Where a body stands at an hour angle: `el` degrees over the sea and `az` degrees right of the
 * line the eye looks down. It comes up at `riseAz` (H = −90), stands highest half-way between
 * (H = 0) and goes down at `setAz` (H = 90); under the sea it runs back the other way.
 */
export function arcAt(angle, peak, setAz, riseAz, out = { az: 0, el: 0 }) {
    const s = Math.sin(angle * DEG);
    const c = Math.cos(angle * DEG);
    const mid = (setAz + riseAz) / 2;
    const half = (riseAz - setAz) / 2;
    out.el = peak * c;
    out.az = mid - half * s + ARC_LEAN * out.el * s;
    return out;
}

/** The sun's and the moon's heights (degrees) at an hour of the day. */
export function sunHeightAt(hour) {
    return SUN_PEAK * Math.cos(hourAngle(hour) * DEG);
}
export function moonHeightAt(hour) {
    return MOON_PEAK * Math.cos(hourAngle(hour, MOON_LAG) * DEG);
}

/** How many airs a body `height` degrees up is seen through (1 overhead; Kasten–Young). */
export function airMass(height) {
    const h = Math.max(-2, height);
    return 1 / (Math.sin(Math.max(0, h) * DEG) + 0.50572 * (Math.max(0, h) + 6.07995) ** -1.6364);
}

/** What the air lets through of each colour (Rayleigh and haze), per air. */
const EXTINCTION = Object.freeze([0.032, 0.083, 0.205]);

/**
 * A body's colour seen through the air at `height` degrees, brightest channel 1: white high up,
 * gold, then a red coal on the sea. `soft` < 1 tempers it (the eye forgives a moon its colour).
 */
export function bodyColour(height, soft, out = [0, 0, 0]) {
    const m = airMass(height);
    for (let i = 0; i < 3; i += 1) out[i] = Math.exp(-EXTINCTION[i] * m * soft);
    const top = Math.max(out[0], out[1], out[2], 1e-6);
    for (let i = 0; i < 3; i += 1) out[i] /= top;
    return out;
}

// ── The light ───────────────────────────────────────────────────────────────────────────────

/**
 * The light's colours, in the order of the uniform rows the shaders read:
 *   zenithSun, zenithFar     overhead: toward the sun and away from it
 *   midSun, midFar           the belt over the horizon
 *   horizonSun, horizonFar   the sky's lowest band
 *   sunBloom, sunAureole     the sun's wide glow and its tight one
 *   sunDisc                  the disc itself (from the air)
 *   moonGlow, moonDisc       the moon's glow and its face (from the air)
 *   cloudLit, cloudShade     a cloud where the light strikes it, and where it does not
 *   cloudDeep                the heart of a thick one
 *   cloudRim                 its lining, seen against the light
 *   cirrus                   the high thin cloud, which keeps the light longest
 *   seaDeep, seaScatter      the water looked down into, and the light that comes back out of it
 *   sunGlint, moonGlint      the sun's road on the sea, and the moon's (from the air)
 *   haze                     the air over the far sea
 *   ambient                  the sky's light on things (a lantern's paper, a bird's back)
 *   shaft                    the colour the lens gives the shafts
 *   gradeShadow, gradeLight  what the darks and the lights of the picture lean toward
 */
export const HOUR_COLOURS = Object.freeze([
    'zenithSun', 'zenithFar', 'midSun', 'midFar', 'horizonSun', 'horizonFar',
    'sunBloom', 'sunAureole', 'sunDisc',
    'moonGlow', 'moonDisc',
    'cloudLit', 'cloudShade', 'cloudDeep', 'cloudRim', 'cirrus',
    'seaDeep', 'seaScatter', 'sunGlint', 'moonGlint', 'haze',
    'ambient', 'shaft', 'gradeShadow', 'gradeLight',
]);

/** The colours the air gives the sun and the moon: not authored per station. */
export const BODY_COLOURS = Object.freeze(['sunDisc', 'sunGlint', 'moonGlow', 'moonDisc', 'moonGlint']);

/** The colours a station authors. */
export const STATION_COLOURS = Object.freeze(HOUR_COLOURS.filter((key) => !BODY_COLOURS.includes(key)));

/**
 * A station's plain numbers:
 *   exposure   the lens
 *   cover      how much of the sky the cloud deck takes (0..1)
 *   fire       0: clouds are lit from above (day); 1: from beneath (a body on the horizon)
 *   lantern    how brightly a lantern's flame shows against the light (0..1)
 *   birds      how many of the birds are on the wing (0..1)
 */
export const STATION_SCALARS = Object.freeze(['exposure', 'cover', 'fire', 'lantern', 'birds']);

/**
 * Every plain number the light carries; `stars` (how far they are out) and `moonKey` (0: the sun
 * lights the clouds, 1: the moon does) come from where the sun and the moon stand.
 */
export const HOUR_SCALARS = Object.freeze([...STATION_SCALARS, 'stars', 'moonKey']);

const station = (name, at, values) => Object.freeze({
    name,
    at,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, Array.isArray(value) ? Object.freeze(value) : value,
    ])),
});

/** The day's stations, in the order the hours run from midnight (`at`: their hour). */
export const STATIONS = Object.freeze([
    // Midnight: the moon high over the picture, silver on the sea, the Milky Way over it.
    station('midnight', 0, {
        zenithSun: [0.008, 0.016, 0.06],
        zenithFar: [0.005, 0.01, 0.044],
        midSun: [0.026, 0.044, 0.125],
        midFar: [0.013, 0.024, 0.08],
        horizonSun: [0.055, 0.085, 0.2],
        horizonFar: [0.03, 0.046, 0.115],
        sunBloom: [0, 0, 0],
        sunAureole: [0, 0, 0],
        cloudLit: [0.3, 0.38, 0.58],
        cloudShade: [0.036, 0.05, 0.12],
        cloudDeep: [0.013, 0.019, 0.052],
        cloudRim: [0.75, 0.9, 1.25],
        cirrus: [0.06, 0.085, 0.17],
        seaDeep: [0.003, 0.008, 0.028],
        seaScatter: [0.004, 0.03, 0.06],
        haze: [0.03, 0.046, 0.115],
        ambient: [0.07, 0.1, 0.22],
        shaft: [0.85, 0.95, 1.2],
        gradeShadow: [0.9, 0.98, 1.16],
        gradeLight: [0.98, 1.0, 1.06],
        exposure: 1.12,
        cover: 0.36,
        fire: 0.4,
        lantern: 1,
        birds: 0,
    }),
    // Before dawn: the moon low and gold on the left, a first cold glow low on the right.
    station('predawn', 4.7, {
        zenithSun: [0.014, 0.025, 0.085],
        zenithFar: [0.009, 0.016, 0.06],
        midSun: [0.05, 0.08, 0.18],
        midFar: [0.02, 0.032, 0.1],
        horizonSun: [0.16, 0.17, 0.28],
        horizonFar: [0.05, 0.06, 0.15],
        sunBloom: [0.03, 0.03, 0.04],
        sunAureole: [0.05, 0.045, 0.05],
        cloudLit: [0.35, 0.4, 0.6],
        cloudShade: [0.045, 0.06, 0.14],
        cloudDeep: [0.016, 0.022, 0.06],
        cloudRim: [0.8, 0.82, 1.1],
        cirrus: [0.12, 0.13, 0.25],
        seaDeep: [0.004, 0.01, 0.032],
        seaScatter: [0.006, 0.032, 0.065],
        haze: [0.08, 0.09, 0.18],
        ambient: [0.1, 0.12, 0.25],
        shaft: [0.9, 0.95, 1.15],
        gradeShadow: [0.9, 0.98, 1.15],
        gradeLight: [1.0, 1.0, 1.04],
        exposure: 1.08,
        cover: 0.38,
        fire: 0.45,
        lantern: 1,
        birds: 0,
    }),
    // Dawn: fire under the right, the pink belt over the world's blue shadow on the left, and
    // the moon going down into it.
    station('dawn', 5.45, {
        zenithSun: [0.09, 0.14, 0.34],
        zenithFar: [0.06, 0.1, 0.28],
        midSun: [0.6, 0.36, 0.32],
        midFar: [0.36, 0.24, 0.38],
        horizonSun: [1.0, 0.5, 0.18],
        horizonFar: [0.2, 0.2, 0.36],
        sunBloom: [0.25, 0.12, 0.05],
        sunAureole: [0.5, 0.24, 0.1],
        cloudLit: [1.3, 0.6, 0.55],
        cloudShade: [0.2, 0.17, 0.3],
        cloudDeep: [0.1, 0.1, 0.2],
        cloudRim: [1.4, 0.8, 0.6],
        cirrus: [1.25, 0.6, 0.62],
        seaDeep: [0.015, 0.028, 0.07],
        seaScatter: [0.025, 0.06, 0.1],
        haze: [0.4, 0.26, 0.32],
        ambient: [0.38, 0.3, 0.45],
        shaft: [1.2, 0.9, 0.85],
        gradeShadow: [0.95, 0.96, 1.12],
        gradeLight: [1.05, 0.99, 0.96],
        exposure: 0.95,
        cover: 0.44,
        fire: 0.85,
        lantern: 0.9,
        birds: 0.3,
    }),
    // Sunrise: the sun on the sea on the right, a coal in a gold band under a clear blue, the
    // far side lilac (the evening's is violet and crimson).
    station('sunrise', 6.05, {
        zenithSun: [0.08, 0.17, 0.42],
        zenithFar: [0.07, 0.15, 0.4],
        midSun: [0.76, 0.22, 0.17],
        midFar: [0.38, 0.36, 0.52],
        horizonSun: [1.0, 0.24, 0.04],
        horizonFar: [0.35, 0.32, 0.45],
        sunBloom: [0.45, 0.08, 0.014],
        sunAureole: [0.64, 0.14, 0.022],
        cloudLit: [2.4, 0.66, 0.16],
        cloudShade: [0.3, 0.2, 0.3],
        cloudDeep: [0.16, 0.13, 0.25],
        cloudRim: [3.0, 1.05, 0.27],
        cirrus: [1.4, 0.5, 0.46],
        seaDeep: [0.015, 0.04, 0.08],
        seaScatter: [0.035, 0.11, 0.13],
        haze: [0.58, 0.2, 0.11],
        ambient: [0.55, 0.44, 0.5],
        shaft: [1.3, 0.95, 0.7],
        gradeShadow: [0.95, 0.97, 1.1],
        gradeLight: [1.06, 1.0, 0.94],
        exposure: 0.75,
        cover: 0.5,
        fire: 1,
        lantern: 0.75,
        birds: 0.9,
    }),
    // The morning: the sun leaving the top of the picture, a cool clear blue, bright cloud.
    station('morning', 8, {
        zenithSun: [0.07, 0.21, 0.55],
        zenithFar: [0.05, 0.17, 0.5],
        midSun: [0.5, 0.55, 0.66],
        midFar: [0.22, 0.38, 0.66],
        horizonSun: [1.0, 0.8, 0.55],
        horizonFar: [0.45, 0.55, 0.72],
        sunBloom: [0.35, 0.3, 0.22],
        sunAureole: [1.2, 1.0, 0.7],
        cloudLit: [1.4, 1.25, 1.05],
        cloudShade: [0.42, 0.46, 0.6],
        cloudDeep: [0.28, 0.32, 0.46],
        cloudRim: [1.9, 1.6, 1.2],
        cirrus: [1.0, 0.95, 0.9],
        seaDeep: [0.01, 0.07, 0.13],
        seaScatter: [0.02, 0.19, 0.22],
        haze: [0.55, 0.6, 0.72],
        ambient: [0.8, 0.82, 0.9],
        shaft: [1.1, 1.0, 0.88],
        gradeShadow: [0.95, 1.0, 1.06],
        gradeLight: [1.03, 1.0, 0.96],
        exposure: 0.9,
        cover: 0.42,
        fire: 0.15,
        lantern: 0.4,
        birds: 1,
    }),
    // Noon: the sun high over the picture, a deep blue, white cloud, the sea turquoise.
    station('noon', 12, {
        zenithSun: [0.06, 0.22, 0.6],
        zenithFar: [0.045, 0.18, 0.55],
        midSun: [0.26, 0.48, 0.82],
        midFar: [0.2, 0.42, 0.78],
        horizonSun: [0.9, 0.84, 0.66],
        horizonFar: [0.5, 0.64, 0.82],
        sunBloom: [0.3, 0.3, 0.28],
        sunAureole: [1.0, 1.0, 0.9],
        cloudLit: [1.3, 1.28, 1.22],
        cloudShade: [0.46, 0.54, 0.7],
        cloudDeep: [0.32, 0.4, 0.56],
        cloudRim: [1.5, 1.5, 1.4],
        cirrus: [0.95, 0.97, 1.0],
        seaDeep: [0.008, 0.1, 0.17],
        seaScatter: [0.02, 0.25, 0.26],
        haze: [0.5, 0.64, 0.82],
        ambient: [0.9, 0.94, 1.0],
        shaft: [1.0, 1.0, 0.95],
        gradeShadow: [0.96, 1.0, 1.04],
        gradeLight: [1.02, 1.0, 0.98],
        exposure: 0.92,
        cover: 0.38,
        fire: 0,
        lantern: 0.25,
        birds: 1,
    }),
    // The afternoon: the sun coming back in at the top left, white cloud on a trade-wind blue.
    station('afternoon', 15, {
        zenithSun: [0.07, 0.24, 0.62],
        zenithFar: [0.05, 0.19, 0.55],
        midSun: [0.3, 0.52, 0.82],
        midFar: [0.2, 0.4, 0.74],
        horizonSun: [0.95, 0.86, 0.68],
        horizonFar: [0.42, 0.58, 0.8],
        sunBloom: [0.3, 0.3, 0.26],
        sunAureole: [1.1, 1.0, 0.8],
        cloudLit: [1.22, 1.18, 1.1],
        cloudShade: [0.44, 0.52, 0.68],
        cloudDeep: [0.31, 0.38, 0.54],
        cloudRim: [1.6, 1.5, 1.3],
        cirrus: [0.9, 0.92, 0.95],
        seaDeep: [0.01, 0.09, 0.16],
        seaScatter: [0.02, 0.22, 0.24],
        haze: [0.5, 0.64, 0.8],
        ambient: [0.85, 0.9, 1.0],
        shaft: [1.05, 1.0, 0.92],
        gradeShadow: [0.95, 1.0, 1.06],
        gradeLight: [1.02, 1.0, 0.97],
        exposure: 0.94,
        cover: 0.4,
        fire: 0,
        lantern: 0.3,
        birds: 1,
    }),
    // Golden hour: a gold sun a hand above the sea, cream cloud, teal water.
    station('golden', 17, {
        zenithSun: [0.085, 0.18, 0.43],
        zenithFar: [0.05, 0.125, 0.37],
        midSun: [0.62, 0.42, 0.24],
        midFar: [0.2, 0.29, 0.49],
        horizonSun: [1.05, 0.5, 0.13],
        horizonFar: [0.4, 0.35, 0.5],
        sunBloom: [0.5, 0.25, 0.075],
        sunAureole: [1.5, 0.82, 0.28],
        cloudLit: [1.8, 1.02, 0.4],
        cloudShade: [0.4, 0.31, 0.36],
        cloudDeep: [0.24, 0.21, 0.3],
        cloudRim: [2.6, 1.7, 0.8],
        cirrus: [1.15, 0.86, 0.62],
        seaDeep: [0.012, 0.05, 0.075],
        seaScatter: [0.03, 0.17, 0.14],
        haze: [0.66, 0.4, 0.22],
        ambient: [0.62, 0.52, 0.5],
        shaft: [1.25, 0.98, 0.7],
        gradeShadow: [0.94, 1.0, 1.08],
        gradeLight: [1.05, 1.0, 0.93],
        exposure: 0.82,
        cover: 0.5,
        fire: 0.45,
        lantern: 0.55,
        birds: 1,
    }),
    // Sunset: the sun a red coal on the water, crimson under violet, the clouds lit from beneath.
    station('sunset', 18, {
        zenithSun: [0.05, 0.075, 0.3],
        zenithFar: [0.026, 0.05, 0.23],
        midSun: [0.72, 0.17, 0.15],
        midFar: [0.12, 0.08, 0.3],
        horizonSun: [0.98, 0.2, 0.034],
        horizonFar: [0.3, 0.13, 0.3],
        sunBloom: [0.45, 0.075, 0.012],
        sunAureole: [0.62, 0.13, 0.02],
        cloudLit: [2.5, 0.6, 0.13],
        cloudShade: [0.27, 0.12, 0.27],
        cloudDeep: [0.11, 0.065, 0.19],
        cloudRim: [3.0, 1.0, 0.25],
        cirrus: [1.4, 0.42, 0.42],
        seaDeep: [0.02, 0.03, 0.072],
        seaScatter: [0.045, 0.1, 0.11],
        haze: [0.6, 0.17, 0.1],
        ambient: [0.5, 0.36, 0.5],
        shaft: [1.3, 0.82, 0.6],
        gradeShadow: [0.95, 0.95, 1.12],
        gradeLight: [1.07, 0.99, 0.92],
        exposure: 0.76,
        cover: 0.56,
        fire: 1,
        lantern: 0.72,
        birds: 0.8,
    }),
    // Afterglow: the sun under the sea, a rose band on the horizon, violet over it, first stars.
    station('afterglow', 18.4, {
        zenithSun: [0.03, 0.046, 0.2],
        zenithFar: [0.015, 0.03, 0.15],
        midSun: [0.4, 0.13, 0.4],
        midFar: [0.05, 0.05, 0.23],
        horizonSun: [1.0, 0.22, 0.13],
        horizonFar: [0.14, 0.11, 0.28],
        sunBloom: [0.5, 0.12, 0.12],
        sunAureole: [1.1, 0.36, 0.26],
        cloudLit: [1.45, 0.28, 0.42],
        cloudShade: [0.19, 0.1, 0.26],
        cloudDeep: [0.06, 0.05, 0.16],
        cloudRim: [1.5, 0.55, 0.55],
        cirrus: [1.45, 0.38, 0.62],
        seaDeep: [0.012, 0.02, 0.06],
        seaScatter: [0.02, 0.05, 0.1],
        haze: [0.42, 0.18, 0.25],
        ambient: [0.24, 0.2, 0.42],
        shaft: [1.15, 0.8, 0.9],
        gradeShadow: [0.94, 0.95, 1.14],
        gradeLight: [1.05, 0.98, 0.98],
        exposure: 0.8,
        cover: 0.5,
        fire: 1,
        lantern: 0.9,
        birds: 0.35,
    }),
    // Dusk: the last ember low on the left, indigo over it, the moon climbing on the right.
    station('dusk', 19.3, {
        zenithSun: [0.016, 0.026, 0.1],
        zenithFar: [0.01, 0.018, 0.075],
        midSun: [0.09, 0.06, 0.2],
        midFar: [0.025, 0.035, 0.12],
        horizonSun: [0.3, 0.1, 0.12],
        horizonFar: [0.05, 0.06, 0.16],
        sunBloom: [0.06, 0.02, 0.03],
        sunAureole: [0.12, 0.04, 0.05],
        cloudLit: [0.45, 0.3, 0.5],
        cloudShade: [0.06, 0.05, 0.13],
        cloudDeep: [0.025, 0.025, 0.075],
        cloudRim: [0.9, 0.8, 1.1],
        cirrus: [0.35, 0.15, 0.3],
        seaDeep: [0.006, 0.012, 0.04],
        seaScatter: [0.01, 0.035, 0.075],
        haze: [0.1, 0.07, 0.16],
        ambient: [0.12, 0.12, 0.28],
        shaft: [0.95, 0.9, 1.15],
        gradeShadow: [0.92, 0.96, 1.15],
        gradeLight: [1.0, 0.99, 1.03],
        exposure: 1.0,
        cover: 0.42,
        fire: 0.7,
        lantern: 1,
        birds: 0.1,
    }),
]);

// ── The timetable ───────────────────────────────────────────────────────────────────────────

/** Tangents of a curve through the knots that never runs back (Fritsch–Butland, periodic). */
const TANGENTS = (() => {
    const n = TIMETABLE.length - 1;
    const slope = (i) => {
        const [s0, h0] = TIMETABLE[(i + n) % n];
        const [s1, h1] = TIMETABLE[((i + n) % n) + 1];
        return { d: (h1 - h0) / (s1 - s0), w: s1 - s0 };
    };
    const out = [];
    for (let i = 0; i <= n; i += 1) {
        const a = slope(i - 1);
        const b = slope(i);
        const w1 = 2 * b.w + a.w;
        const w2 = b.w + 2 * a.w;
        out.push((w1 + w2) / (w1 / a.d + w2 / b.d));
    }
    return Object.freeze(out);
})();

/** The hour of the day (0..24) the wheel stands on, `wheel` seconds into it. */
export function dayHourAt(wheel) {
    const s = (((Number.isFinite(wheel) ? wheel : 0) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
    let i = 0;
    while (i < TIMETABLE.length - 2 && TIMETABLE[i + 1][0] <= s) i += 1;
    const [s0, h0] = TIMETABLE[i];
    const [s1, h1] = TIMETABLE[i + 1];
    const w = s1 - s0;
    const t = (s - s0) / w;
    const t2 = t * t;
    const t3 = t2 * t;
    const h = (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * w * TANGENTS[i]
        + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * w * TANGENTS[i + 1];
    return wrap24(h);
}

/** The first second of the wheel (0..DAY_SECONDS) that stands on `hour`. */
export function wheelAt(hour) {
    const target = wrap24(hour);
    // The wheel's hours, counted on from START_HOUR, rise without a break: bisect.
    const want = target < START_HOUR ? target + 24 : target;
    const counted = (s) => {
        const h = dayHourAt(s);
        return h < START_HOUR - 1e-9 ? h + 24 : h;
    };
    let lo = 0;
    let hi = DAY_SECONDS - 1e-6;
    for (let k = 0; k < 48; k += 1) {
        const m = (lo + hi) / 2;
        if (counted(m) < want) lo = m;
        else hi = m;
    }
    return (lo + hi) / 2;
}

/**
 * The offset a level holds, `since` seconds after it was reached from the offset `from`: the
 * turn is eased over `seconds` and then stays put.
 */
export function levelOffset(from, to, since, seconds = TURN_SECONDS) {
    if (!(since > 0)) return from;
    return from + (to - from) * smooth(0, Math.max(0.01, seconds), since);
}

/** How long a turn of `seconds` of the wheel takes: a level's in TURN_SECONDS, a long way a little longer. */
export function turnSeconds(seconds) {
    return TURN_SECONDS * Math.max(1, Math.sqrt(Math.abs(seconds) / LEVEL_SECONDS));
}

// ── The light at an hour ────────────────────────────────────────────────────────────────────

/**
 * Which two stations the light stands between at an hour, and how far it has crossed from the
 * first to the second. The crossing eases in and out a little but never stands still.
 */
export function stationMix(hour, out = {}) {
    const h = wrap24(Number.isFinite(hour) ? hour : 0);
    const n = STATIONS.length;
    let from = n - 1;
    for (let i = 0; i < n; i += 1) if (STATIONS[i].at <= h) from = i;
    const to = (from + 1) % n;
    const a = STATIONS[from].at;
    const b = to === 0 ? 24 : STATIONS[to].at;
    const t = Math.min(1, Math.max(0, (h - a) / (b - a)));
    out.from = from;
    out.to = to;
    out.mix = lerp(t, smooth(0, 1, t), 0.5);
    return out;
}

const mixed = {};
const sunTint = [0, 0, 0];
const moonTint = [0, 0, 0];
/** The moon by day and by night (the eye sees it silver in the dark), its glow, its road. */
const MOON_DAY = Object.freeze([1.0, 0.97, 0.92]);
const MOON_NIGHT = Object.freeze([0.94, 0.97, 1.03]);
const MOON_GLOW_LOW = Object.freeze([0.2, 0.15, 0.12]);
const MOON_GLOW_NIGHT = Object.freeze([0.085, 0.13, 0.26]);
const MOON_ROAD = Object.freeze([1.0, 1.2, 1.6]);

/**
 * The light at an hour of the day: every colour of HOUR_COLOURS as [r, g, b], every number of
 * HOUR_SCALARS, `sunHeight` and `moonHeight` (degrees), and `name` (the station it stands
 * nearer to), `next` and `mix`.
 */
export function lightAt(hour, out = {}) {
    const { from, to, mix } = stationMix(hour, mixed);
    const a = STATIONS[from];
    const b = STATIONS[to];
    for (let i = 0; i < STATION_COLOURS.length; i += 1) {
        const key = STATION_COLOURS[i];
        if (!out[key]) out[key] = [0, 0, 0];
        const colour = out[key];
        colour[0] = lerp(a[key][0], b[key][0], mix);
        colour[1] = lerp(a[key][1], b[key][1], mix);
        colour[2] = lerp(a[key][2], b[key][2], mix);
    }
    for (let i = 0; i < STATION_SCALARS.length; i += 1) {
        const key = STATION_SCALARS[i];
        out[key] = lerp(a[key], b[key], mix);
    }

    // The bodies, from the air they are seen through.
    const sunH = sunHeightAt(hour);
    const moonH = moonHeightAt(hour);
    out.sunHeight = sunH;
    out.moonHeight = moonH;
    // Day: 0 with the sun well under the sea, 1 once it is up.
    const day = smooth(-6, 6, sunH);
    out.stars = smooth(-2, -14, sunH);
    // The moon takes the clouds once the sun is well down, while it is up itself.
    out.moonKey = (1 - smooth(-8, -2, sunH)) * smooth(-2, 4, moonH);

    bodyColour(sunH, 1, sunTint);
    for (let i = 0; i < 3; i += 1) sunTint[i] **= 0.55;
    const sunDisc = out.sunDisc || (out.sunDisc = [0, 0, 0]);
    const sunGlint = out.sunGlint || (out.sunGlint = [0, 0, 0]);
    // The road is seen through the same air again on its way back off the water: deeper.
    const road = lerp(3.4, 2.4, smooth(2, 30, sunH)) * smooth(-1.2, 0.8, sunH);
    for (let i = 0; i < 3; i += 1) {
        sunDisc[i] = sunTint[i];
        sunGlint[i] = sunTint[i] ** 1.8 * road;
    }

    bodyColour(moonH, 0.35, moonTint);
    const moonDisc = out.moonDisc || (out.moonDisc = [0, 0, 0]);
    const moonGlow = out.moonGlow || (out.moonGlow = [0, 0, 0]);
    const moonGlint = out.moonGlint || (out.moonGlint = [0, 0, 0]);
    // By night the eye sees the moon silver; against a lit sky it needs more light to show.
    const dark = out.stars;
    const face = lerp(1.45, 1.0, dark);
    for (let i = 0; i < 3; i += 1) {
        moonDisc[i] = moonTint[i] * lerp(MOON_DAY[i], MOON_NIGHT[i], dark) * face;
        moonGlow[i] = lerp(moonTint[i] * MOON_GLOW_LOW[i], MOON_GLOW_NIGHT[i], dark) * (1 - 0.85 * day);
        moonGlint[i] = moonTint[i] ** 1.5 * MOON_ROAD[i] * (1 - day);
    }

    out.name = mix < 0.5 ? a.name : b.name;
    out.next = mix < 0.5 ? b.name : a.name;
    out.mix = mix;
    return out;
}
