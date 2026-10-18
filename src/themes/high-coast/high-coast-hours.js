/**
 * High Coast — the day: the light the coast is seen in, round the whole twenty-four hours of a
 * midsummer day at 63° north (CPU only, three-free).
 *
 * The eye looks north over the bay, and the sun walks the sky from right to left: low on the
 * right over the open sea in the golden hour, setting there, gliding just under the northern
 * horizon behind the card through the light night (at 63° on midsummer it never sinks more than
 * 3.6°, so the sky never darkens), up again on the left at dawn with the sea fog on the bay,
 * behind the eye by day and round to the right for the afternoon.
 *
 * Six stations name the day, in the order it runs (solar time):
 *
 *   golden hour  20:45  the sun a hand over the open sea on the right, everything gold
 *   sunset       21:45  the sun on the water, the clouds lit from beneath
 *   light night  00:00  the sun at its lowest under the north, a rose band, a few stars
 *   dawn mist    02:48  the sun just up on the left, the sea fog lying on the bay
 *   morning      06:30  the sun high on the left behind the eye, a cool clear blue
 *   afternoon    16:36  the sun round on the right behind the eye, warmer
 *
 * Between two stations the light is on its way all the time: the clock never holds it, and
 * nothing in it is switched. Where the day stands is one number, the wheel's place:
 *
 *     place = clock / TIMING.hour + (level − 1)        (a level-up's share eased in)
 *
 * and station k stands at place k. The hour of the day runs through the stations' hours on a
 * smooth curve that never runs back, so the day lingers where the light changes most (the golden
 * hour to sunset is one hour of the day in TIMING.hour seconds; the morning to the afternoon ten).
 *
 * The sun's height is the real one for its hour; its bearing runs through the stations' own (the
 * picture's composition). Its light is not switched with it: the direct light's strength follows
 * the height (the long way through the air near the horizon dims it long before it sets), and
 * `day`, how far the sky is in daylight, follows it over several degrees either side of the
 * horizon, so the clouds, the sea and the sky's glow cross into the light night over minutes of
 * clock, not seconds. Every station is authored so a half-way mix with its neighbours keeps its
 * colour (blues and golds, no grey).
 */
import {
    DEG, TIMING, clamp, lerp, smooth,
} from './high-coast-core.js';

/** Where the coast lies, and the sun's declination at midsummer (degrees). */
export const LATITUDE = 63;
export const DECLINATION = 23.44;

/**
 * The direct light: its luminance with the sun well up (`peak`), the height where it is gone (the
 * disc under the far shore, `edge`), how many degrees over the edge it takes to reach 63 % of the
 * peak (the air near the horizon, `rise`), and the height where the disc stands wholly clear of
 * the far shore (`clear`). Fitted to the light the stations were authored with.
 */
export const SUN = Object.freeze({
    peak: 3.65,
    edge: -1.2,
    rise: 5.2,
    clear: 0.6,
});

/** The sun's heights (degrees) between which the sky crosses from the light night into day. */
export const DAY_HEIGHTS = Object.freeze([-4, 3]);

/**
 * Linear colours. `sun` is the hue of the direct light (its strength comes from the sun's
 * height); `fill` the sky's light on a shadowed face; `bounce` the warm light the granite throws
 * back; `zenith`/`horizon`/`glow` the sky; `haze` the air in front of distant things; `mist` the
 * sea fog; `cloudLit`/`cloudShade` the two sides of a cloud; `water` the sea's own deep colour.
 * `at` is the station's hour of the day, `az` the sun's bearing then, in degrees right of the
 * view axis (the sun walks toward smaller az).
 */
export const HOURS = Object.freeze([
    Object.freeze({
        name: 'golden hour',
        at: 20.75,
        az: 25,
        sun: [3.7, 2.25, 1.05],
        fill: [0.12, 0.19, 0.4],
        bounce: [0.16, 0.1, 0.07],
        zenith: [0.028, 0.1, 0.42],
        horizon: [0.9, 0.74, 0.46],
        glow: [1.75, 0.95, 0.42],
        haze: [0.42, 0.45, 0.58],
        mist: [0.78, 0.68, 0.64],
        cloudLit: [1.95, 1.25, 0.7],
        cloudShade: [0.4, 0.42, 0.62],
        water: [0.006, 0.03, 0.068],
        exposure: 0.95,
        stars: 0,
        hazeDensity: 0.5,
        mistDensity: 0.08,
    }),
    Object.freeze({
        name: 'sunset',
        at: 21.75,
        az: 21,
        sun: [3.2, 1.08, 0.3],
        fill: [0.1, 0.11, 0.26],
        bounce: [0.13, 0.06, 0.04],
        zenith: [0.024, 0.05, 0.22],
        horizon: [1.05, 0.48, 0.26],
        glow: [2.1, 0.66, 0.2],
        haze: [0.5, 0.36, 0.4],
        mist: [0.86, 0.5, 0.44],
        cloudLit: [2.05, 0.78, 0.36],
        cloudShade: [0.3, 0.2, 0.36],
        water: [0.005, 0.018, 0.05],
        exposure: 1.18,
        stars: 0.02,
        hazeDensity: 0.62,
        mistDensity: 0.18,
    }),
    Object.freeze({
        name: 'light night',
        at: 0,
        az: 2,
        // The sun is under the horizon: no strength, only the hue it would carry.
        sun: [3.0, 0.8, 0.2],
        fill: [0.04, 0.05, 0.12],
        bounce: [0.03, 0.025, 0.03],
        zenith: [0.005, 0.012, 0.055],
        horizon: [0.34, 0.18, 0.18],
        glow: [0.72, 0.3, 0.2],
        haze: [0.07, 0.07, 0.13],
        mist: [0.12, 0.12, 0.2],
        cloudLit: [0.22, 0.12, 0.15],
        cloudShade: [0.02, 0.025, 0.06],
        water: [0.002, 0.008, 0.026],
        exposure: 1.45,
        stars: 0.45,
        hazeDensity: 0.45,
        mistDensity: 0.32,
    }),
    Object.freeze({
        name: 'dawn mist',
        at: 2.8,
        az: -9,
        sun: [2.7, 1.6, 1.0],
        fill: [0.15, 0.15, 0.28],
        bounce: [0.12, 0.08, 0.07],
        zenith: [0.04, 0.075, 0.26],
        horizon: [0.92, 0.62, 0.72],
        glow: [1.55, 0.84, 0.52],
        haze: [0.62, 0.56, 0.64],
        mist: [0.96, 0.8, 0.78],
        cloudLit: [1.65, 1.02, 0.82],
        cloudShade: [0.34, 0.3, 0.44],
        water: [0.008, 0.025, 0.055],
        exposure: 1.18,
        stars: 0,
        hazeDensity: 1.1,
        mistDensity: 1.0,
    }),
    Object.freeze({
        name: 'morning',
        at: 6.5,
        az: -95,
        sun: [4.0, 3.62, 3.0],
        fill: [0.2, 0.32, 0.6],
        bounce: [0.17, 0.12, 0.09],
        zenith: [0.022, 0.11, 0.5],
        horizon: [0.55, 0.66, 0.82],
        glow: [1.0, 0.95, 0.85],
        haze: [0.42, 0.52, 0.72],
        mist: [0.76, 0.8, 0.88],
        cloudLit: [1.92, 1.88, 1.82],
        cloudShade: [0.5, 0.56, 0.72],
        water: [0.008, 0.042, 0.092],
        exposure: 0.62,
        stars: 0,
        hazeDensity: 0.36,
        mistDensity: 0.04,
    }),
    Object.freeze({
        name: 'afternoon',
        at: 16.6,
        az: 140,
        sun: [4.1, 3.5, 2.6],
        fill: [0.2, 0.3, 0.55],
        bounce: [0.18, 0.13, 0.09],
        zenith: [0.024, 0.1, 0.46],
        horizon: [0.62, 0.68, 0.8],
        glow: [1.2, 1.0, 0.7],
        haze: [0.46, 0.52, 0.68],
        mist: [0.78, 0.78, 0.82],
        cloudLit: [2.0, 1.85, 1.6],
        cloudShade: [0.48, 0.52, 0.66],
        water: [0.008, 0.038, 0.085],
        exposure: 0.64,
        stars: 0,
        hazeDensity: 0.42,
        mistDensity: 0.04,
    }),
]);

export const HOUR_COUNT = HOURS.length;
const COLOUR_KEYS = ['sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade', 'water'];
const SCALAR_KEYS = ['exposure', 'stars', 'hazeDensity', 'mistDensity', 'day'];
/** The station keys mixed by hour (`sun` is only a hue there; `day` comes from the height). */
const STATION_COLOURS = COLOUR_KEYS;
const STATION_SCALARS = ['exposure', 'stars', 'hazeDensity', 'mistDensity'];

const wrap24 = (h) => ((h % 24) + 24) % 24;
const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

// ── The timetable ───────────────────────────────────────────────────────────────────────────

/**
 * Tangents of a periodic curve through knots [x, y] (the last knot is the first one period on)
 * that never runs back between them (Fritsch–Butland).
 */
function monotoneTangents(knots) {
    const n = knots.length - 1;
    const secant = (i) => {
        const k = ((i % n) + n) % n;
        const [x0, y0] = knots[k];
        const [x1, y1] = knots[k + 1];
        return { d: (y1 - y0) / (x1 - x0), w: x1 - x0 };
    };
    const out = [];
    for (let i = 0; i <= n; i += 1) {
        const a = secant(i - 1);
        const b = secant(i);
        if (a.d * b.d <= 0) {
            out.push(0);
            continue;
        }
        const w1 = 2 * b.w + a.w;
        const w2 = b.w + 2 * a.w;
        out.push((w1 + w2) / (w1 / a.d + w2 / b.d));
    }
    return Object.freeze(out);
}

/** The curve through the knots at x (x inside the knots' span), with its tangents. */
function hermite(knots, tangents, x) {
    let i = 0;
    while (i < knots.length - 2 && knots[i + 1][0] <= x) i += 1;
    const [x0, y0] = knots[i];
    const [x1, y1] = knots[i + 1];
    const w = x1 - x0;
    const t = clamp((x - x0) / w, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * w * tangents[i]
        + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * w * tangents[i + 1];
}

/**
 * The stations' hours, counted on past midnight from the golden hour so they only rise, and the
 * golden hour again a day on.
 */
const COUNTED = Object.freeze([
    ...HOURS.map((hour) => (hour.at < HOURS[0].at ? hour.at + 24 : hour.at)),
    HOURS[0].at + 24,
]);

/**
 * Where the day lingers between the stations: [place, hour counted]. The sun's light leaves the
 * land and comes back to it over a degree or two of its height, so the day slows round its
 * setting and its rising (and runs the deep night and the high day a little faster).
 */
const LINGER = Object.freeze([
    Object.freeze([1.5, 22.25]),
    Object.freeze([2.45, 25.7]),
    Object.freeze([2.9, 26.45]),
]);

/** [place, hour counted] knots: station k stands at place k; one day is HOUR_COUNT places. */
export const TIMETABLE = Object.freeze([
    ...COUNTED.map((hour, k) => Object.freeze([k, hour])),
    ...LINGER,
].sort((a, b) => a[0] - b[0]));
const TIMETABLE_TANGENTS = monotoneTangents(TIMETABLE);

/** [hour counted, bearing] knots: the sun's bearing turns through the stations' own. */
const BEARINGS = (() => {
    const knots = [];
    let { az } = HOURS[0];
    HOURS.forEach((hour, k) => {
        if (k > 0) {
            // Always the decreasing way round.
            let step = hour.az - az;
            while (step > 0) step -= 360;
            az += step;
        }
        knots.push(Object.freeze([COUNTED[k], az]));
    });
    knots.push(Object.freeze([COUNTED[HOUR_COUNT], HOURS[0].az - 360]));
    return Object.freeze(knots);
})();
const BEARING_TANGENTS = monotoneTangents(BEARINGS);

/** The wheel's place for a level (1-based) and the clock: stations from the golden hour. */
export function hourPlace(level, time) {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    return Math.max(0, (Number(level) || 1) - 1) + t / TIMING.hour;
}

/** The hour of the day, counted on from the golden hour (COUNTED[0] .. + 24), at a place. */
export function countedHourAt(place) {
    const p = Number.isFinite(place) ? place : 0;
    const s = ((p % HOUR_COUNT) + HOUR_COUNT) % HOUR_COUNT;
    return hermite(TIMETABLE, TIMETABLE_TANGENTS, s);
}

/** The hour of the day (0..24) the wheel stands on at a place. */
export function dayHourAt(place) {
    return wrap24(countedHourAt(place));
}

/**
 * Which two stations the light stands between at a place, how far it has crossed (by the hour
 * of the day), and that hour. The crossing eases in and out a little but never stands still.
 */
export function hourMix(place, out = {}) {
    const p = Number.isFinite(place) ? place : 0;
    const whole = Math.floor(p);
    const from = ((whole % HOUR_COUNT) + HOUR_COUNT) % HOUR_COUNT;
    const to = (from + 1) % HOUR_COUNT;
    const hour = countedHourAt(p);
    const a = COUNTED[from];
    const b = COUNTED[from + 1];
    const t = clamp((hour - a) / (b - a), 0, 1);
    out.from = from;
    out.to = to;
    out.mix = lerp(t, smooth(0, 1, t), 0.5);
    out.hour = wrap24(hour);
    out.counted = hour;
    return out;
}

// ── The sun ─────────────────────────────────────────────────────────────────────────────────

const SIN_LAT = Math.sin(LATITUDE * DEG);
const COS_LAT = Math.cos(LATITUDE * DEG);
const SIN_DEC = Math.sin(DECLINATION * DEG);
const COS_DEC = Math.cos(DECLINATION * DEG);

/** The sun's height (degrees) at an hour of the day: the real one at 63° north on midsummer. */
export function sunHeightAt(hour) {
    const angle = 15 * (hour - 12) * DEG;
    return Math.asin(clamp(SIN_DEC * SIN_LAT + COS_DEC * COS_LAT * Math.cos(angle), -1, 1)) / DEG;
}

/** The sun's bearing (degrees right of the view axis, −180..180) at an hour of the day. */
export function sunBearingAt(hour) {
    const counted = COUNTED[0] + wrap24(hour - COUNTED[0]);
    const az = hermite(BEARINGS, BEARING_TANGENTS, counted);
    return (((az % 360) + 540) % 360) - 180;
}

/** The direct light's luminance with the sun `el` degrees up: gone at the far shore, then rising. */
export function sunStrength(el) {
    const over = el - SUN.edge;
    if (!(over > 0)) return 0;
    return SUN.peak * (1 - Math.exp(-over / SUN.rise));
}

/** How much of the disc stands clear of the far shore (the direct light's last gate). */
export const sunClear = (el) => smooth(SUN.edge, SUN.clear, el);

/** How far the sky is in daylight with the sun `el` degrees up (0 the light night, 1 day). */
export const dayAt = (el) => smooth(DAY_HEIGHTS[0], DAY_HEIGHTS[1], el);

function writeDir(out) {
    const az = out.az * DEG;
    const el = out.el * DEG;
    out.dir[0] = Math.sin(az) * Math.cos(el);
    out.dir[1] = Math.sin(el);
    out.dir[2] = -Math.cos(az) * Math.cos(el);
}

// ── The light ───────────────────────────────────────────────────────────────────────────────

const mixed = {};

/**
 * The light at a wheel place, written into `out` (allocated once by the caller). The stations'
 * colours mix in linear light by the hour of the day; the sun stands where that hour puts it, and
 * its strength, the disc's gate and the sky's daylight follow its height.
 */
export function lightAt(place, out = createLight()) {
    const {
        from, to, mix, hour,
    } = hourMix(place, mixed);
    const a = HOURS[from];
    const b = HOURS[to];
    for (const key of STATION_COLOURS) {
        const ca = a[key];
        const cb = b[key];
        const o = out[key];
        o[0] = lerp(ca[0], cb[0], mix);
        o[1] = lerp(ca[1], cb[1], mix);
        o[2] = lerp(ca[2], cb[2], mix);
    }
    for (const key of STATION_SCALARS) out[key] = lerp(a[key], b[key], mix);
    out.el = sunHeightAt(hour);
    out.az = sunBearingAt(hour);
    // The direct light: the stations' hue at the strength the sun's height gives it.
    const strength = sunStrength(out.el) / Math.max(1e-6, luminance(out.sun));
    for (let c = 0; c < 3; c++) out.sun[c] *= strength;
    out.sunUp = sunClear(out.el);
    out.day = dayAt(out.el);
    // Windows and the lighthouse are lit when the sun is low.
    out.lamps = 1 - smooth(-1, 5, out.el);
    writeDir(out);
    out.from = from;
    out.to = to;
    out.mix = mix;
    out.hour = hour;
    out.place = place;
    return out;
}

/** Blend light `a` toward light `b` by k (0..1) into `out` (the sun's place follows `a`). */
export function blendLight(a, b, k, out = createLight()) {
    const t = clamp(k, 0, 1);
    for (const key of COLOUR_KEYS) {
        for (let c = 0; c < 3; c++) out[key][c] = lerp(a[key][c], b[key][c], t);
    }
    for (const key of SCALAR_KEYS) out[key] = lerp(a[key], b[key], t);
    out.az = a.az;
    out.el = lerp(a.el, b.el, t);
    out.sunUp = sunClear(out.el);
    out.lamps = Math.max(1 - smooth(-1, 5, out.el), lerp(a.lamps, b.lamps, t));
    writeDir(out);
    out.from = a.from;
    out.to = a.to;
    out.mix = a.mix;
    out.hour = a.hour;
    out.place = a.place;
    return out;
}

/** Copy light `src` into `dst` (no shared arrays). */
export function copyLight(src, dst) {
    for (const key of COLOUR_KEYS) for (let c = 0; c < 3; c++) dst[key][c] = src[key][c];
    for (const key of SCALAR_KEYS) dst[key] = src[key];
    for (let c = 0; c < 3; c++) dst.dir[c] = src.dir[c];
    dst.az = src.az;
    dst.el = src.el;
    dst.sunUp = src.sunUp;
    dst.lamps = src.lamps;
    dst.from = src.from;
    dst.to = src.to;
    dst.mix = src.mix;
    dst.hour = src.hour;
    dst.place = src.place;
    return dst;
}

export function createLight() {
    const light = {
        az: 0, el: 0, sunUp: 1, lamps: 0, dir: [0, 0, -1], from: 0, to: 1, mix: 0, hour: HOURS[0].at, place: 0,
    };
    for (const key of COLOUR_KEYS) light[key] = [0, 0, 0];
    for (const key of SCALAR_KEYS) light[key] = 0;
    return light;
}

/**
 * The wheel the world turns. `place()` is the light's position: the clock's share plus the
 * level's eased steps. A level-up steps FORWARD by the levels gained from wherever the last turn
 * was heading; a new run (level 1 again) keeps the light where it is.
 */
export class HourWheel {
    constructor() {
        this.reset();
    }

    reset() {
        this.turnFrom = 0;
        this.turnTo = 0;
        this.turnAt = -1e6;
        this.level = 1;
    }

    /** The level's share of the place at time t (eased). */
    levelShare(t) {
        const k = smooth(0, TIMING.levelTurn, t - this.turnAt);
        return lerp(this.turnFrom, this.turnTo, k);
    }

    place(t) {
        return this.levelShare(t) + Math.max(0, t) / TIMING.hour;
    }

    /** A level-up at time t to `level`: step forward by the levels gained (silent = at once). */
    levelUp(level, t, silent = false) {
        const n = Math.max(1, Math.round(Number(level) || 1));
        if (n <= this.level) {
            this.level = n;
            return;
        }
        const gained = n - this.level;
        const current = this.levelShare(t);
        this.turnFrom = current;
        this.turnTo = Math.max(this.turnTo, current) + gained;
        this.turnAt = silent ? t - TIMING.levelTurn : t;
        this.level = n;
    }

    /** A new run (level 1 again): the light stays where it is; later level-ups step on from it. */
    newRun() {
        this.level = 1;
    }

    exportState() {
        return {
            turnFrom: this.turnFrom, turnTo: this.turnTo, turnAt: this.turnAt, level: this.level,
        };
    }

    importState(state) {
        if (!state) return;
        this.turnFrom = Number(state.turnFrom) || 0;
        this.turnTo = Number(state.turnTo) || 0;
        this.turnAt = Number.isFinite(state.turnAt) ? state.turnAt : -1e6;
        this.level = Math.max(1, Math.round(Number(state.level) || 1));
    }
}

/** Saturation (max − min over max) of a linear colour: the tests keep every mix colourful. */
export function chroma(rgb) {
    const hi = Math.max(rgb[0], rgb[1], rgb[2]);
    const lo = Math.min(rgb[0], rgb[1], rgb[2]);
    return hi > 0 ? (hi - lo) / hi : 0;
}
