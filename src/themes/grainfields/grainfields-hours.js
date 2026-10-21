/**
 * Grainfields — the day: the light the grain country is seen in, round the whole twenty-four
 * hours of a day at harvest at 43° north (CPU only, three-free).
 *
 * The eye looks out west-south-west over the fields, and the sun walks the sky from left to
 * right: high on the left behind the storm in the afternoon, through the gaps in the deck above
 * Lapporten, low on the right over the ridge in the golden hour, setting there; the night passes
 * as a short blue twilight; the sun comes up behind the eye at dawn with the vale full of mist,
 * and stands high on the left by morning.
 *
 * Five stations name the day, in the order it runs (solar time):
 *
 *   storm break  16:15  the deck heavy and torn, the sun through it above the gate, shafts
 *   golden hour  17:45  the deck breaking up, the sun low on the right, everything gold
 *   dusk         18:50  the sun gone, the fells lit rose in the afterglow, the sky violet
 *   dawn mist    05:30  the sun behind the eye, the vale full of mist, the fells pink
 *   morning      09:00  broken cloud, high clean light, the fields at their most vivid
 *
 * Between two stations the light is on its way all the time: the clock never holds it, and
 * nothing in it is switched. Where the day stands is one number, the wheel's place:
 *
 *     place = clock / TIMING.hour + (level − 1)        (a level-up's share eased in)
 *
 * and station k stands at place k. The hour of the day runs through the stations' hours on a
 * smooth curve that never runs back, so the day lingers where the light changes most and runs
 * the night fast. The sun's height is the real one for its hour at harvest; its bearing runs
 * through the stations' own (the picture's composition). The direct light's strength follows the
 * height, and `day` (how far the sky is in daylight) follows it over several degrees either side
 * of the horizon, so nothing pops. The deck's cover and the wind's strength are part of each
 * station too: the storm breaks up through the evening and gathers again through the morning.
 */
import {
    DEG, TIMING, clamp, lerp, smooth,
} from './grainfields-core.js';

/** Where the fields lie, and the sun's declination early in September (degrees). */
export const LATITUDE = 43;
export const DECLINATION = 5;

/**
 * The direct light: its luminance with the sun well up (`peak`), the height where it is gone (the
 * disc under the far hills, `edge`), how many degrees over the edge it takes to reach 63 % of the
 * peak (`rise`), and the height where the disc stands wholly clear (`clear`).
 */
export const SUN = Object.freeze({
    peak: 3.7,
    edge: -1.0,
    rise: 5.4,
    clear: 0.8,
});

/** The sun's heights (degrees) between which the sky crosses from the twilight into day. */
export const DAY_HEIGHTS = Object.freeze([-5, 3]);

/**
 * Linear colours. `sun` is the hue of the direct light (its strength comes from the sun's
 * height); `fill` the sky's light on a shadowed face; `bounce` the gold the barley throws back;
 * `zenith`/`horizon`/`glow` the sky; `haze` the air in front of distant things; `mist` the vale's
 * mist; `cloudLit`/`cloudShade` the two sides of the deck.
 * Scalars: `cover` how much of the deck is cloud (0 clear … 1 overcast), `wind` the wind in the
 * grain (0 still … 1 a strong blow). `at` is the station's hour of the day, `az` the sun's bearing
 * then, in degrees right of the view axis (the sun walks toward larger az).
 */
export const HOURS = Object.freeze([
    Object.freeze({
        name: 'storm break',
        at: 16.25,
        az: -27,
        sun: [4.2, 3.55, 2.6],
        fill: [0.085, 0.11, 0.19],
        bounce: [0.15, 0.11, 0.035],
        zenith: [0.03, 0.075, 0.22],
        horizon: [0.7, 0.78, 0.9],
        glow: [1.35, 1.15, 0.85],
        haze: [0.2, 0.24, 0.32],
        mist: [0.66, 0.71, 0.78],
        cloudLit: [1.55, 1.48, 1.38],
        cloudShade: [0.055, 0.068, 0.092],
        // Exposed for the sunlit barley, as a photograph of storm light is: the field in the sun
        // keeps its texture under the tone map's shoulder, and the deck goes dark over it.
        exposure: 0.62,
        stars: 0,
        // The air the rain has washed: clear, with mist lying in the vale.
        hazeDensity: 0.4,
        mistDensity: 0.1,
        cover: 0.93,
        wind: 1.0,
    }),
    Object.freeze({
        name: 'golden hour',
        at: 17.75,
        az: 31,
        sun: [3.9, 2.35, 1.05],
        fill: [0.11, 0.15, 0.3],
        bounce: [0.19, 0.11, 0.035],
        zenith: [0.03, 0.09, 0.36],
        horizon: [0.95, 0.72, 0.45],
        glow: [1.8, 1.0, 0.42],
        haze: [0.48, 0.45, 0.5],
        mist: [0.84, 0.7, 0.6],
        cloudLit: [2.1, 1.3, 0.62],
        cloudShade: [0.16, 0.13, 0.2],
        exposure: 0.7,
        stars: 0,
        hazeDensity: 0.72,
        mistDensity: 0.07,
        cover: 0.56,
        wind: 0.62,
    }),
    Object.freeze({
        name: 'dusk',
        at: 18.83,
        az: 45,
        // The sun is under the horizon: no strength, only the hue it would carry.
        sun: [3.0, 1.0, 0.36],
        // The Lapland afterglow: a violet sky going rose toward the sunset, the fells lit pink.
        fill: [0.1, 0.075, 0.165],
        bounce: [0.1, 0.055, 0.04],
        zenith: [0.045, 0.028, 0.16],
        horizon: [0.95, 0.5, 0.56],
        glow: [1.6, 0.62, 0.58],
        haze: [0.26, 0.17, 0.3],
        mist: [0.46, 0.34, 0.47],
        cloudLit: [1.3, 0.55, 0.62],
        cloudShade: [0.08, 0.055, 0.12],
        exposure: 1.32,
        stars: 0.14,
        hazeDensity: 0.62,
        mistDensity: 0.16,
        cover: 0.5,
        wind: 0.35,
    }),
    Object.freeze({
        name: 'dawn mist',
        at: 5.5,
        az: -120,
        sun: [2.8, 1.7, 1.1],
        fill: [0.13, 0.14, 0.26],
        bounce: [0.1, 0.08, 0.06],
        zenith: [0.04, 0.08, 0.26],
        horizon: [0.88, 0.62, 0.76],
        glow: [1.4, 0.86, 0.6],
        haze: [0.58, 0.56, 0.65],
        mist: [0.9, 0.84, 0.86],
        cloudLit: [1.6, 1.1, 0.95],
        cloudShade: [0.3, 0.28, 0.4],
        exposure: 1.15,
        stars: 0,
        hazeDensity: 1.2,
        mistDensity: 0.3,
        cover: 0.4,
        wind: 0.2,
    }),
    Object.freeze({
        name: 'morning',
        at: 9.0,
        az: -70,
        sun: [4.1, 3.75, 3.2],
        fill: [0.19, 0.3, 0.58],
        bounce: [0.21, 0.15, 0.05],
        zenith: [0.022, 0.11, 0.5],
        horizon: [0.6, 0.72, 0.86],
        glow: [1.0, 0.95, 0.85],
        haze: [0.45, 0.55, 0.72],
        mist: [0.78, 0.82, 0.88],
        cloudLit: [2.0, 1.95, 1.9],
        // (Flat grey-blue bases under the white heads: the heaps stand in depth.)
        cloudShade: [0.33, 0.38, 0.53],
        exposure: 0.66,
        stars: 0,
        hazeDensity: 0.5,
        mistDensity: 0.03,
        cover: 0.44,
        wind: 0.56,
    }),
]);

export const HOUR_COUNT = HOURS.length;
const COLOUR_KEYS = ['sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade'];
const SCALAR_KEYS = ['exposure', 'stars', 'hazeDensity', 'mistDensity', 'cover', 'wind', 'day'];
/** The station keys mixed by hour (`sun` is only a hue there; `day` comes from the height). */
const STATION_COLOURS = COLOUR_KEYS;
const STATION_SCALARS = ['exposure', 'stars', 'hazeDensity', 'mistDensity', 'cover', 'wind'];

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
 * The stations' hours, counted on past midnight from the storm break so they only rise, and the
 * storm break again a day on.
 */
const COUNTED = Object.freeze([
    ...HOURS.map((hour) => (hour.at < HOURS[0].at ? hour.at + 24 : hour.at)),
    HOURS[0].at + 24,
]);

/**
 * Where the day lingers between the stations: [place, hour counted]. The twilight after sunset
 * is held a while, the night runs fast (eight hours in a third of a step), the dawn is held again.
 */
const LINGER = Object.freeze([
    Object.freeze([2.35, 19.55]),
    Object.freeze([2.7, 28.3]),
    // The sunrise comes eleven minutes after the dawn station: without this knot the stretch
    // after it ran 3.5 hours a station and the light came up in under eight seconds.
    Object.freeze([3.45, 29.95]),
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
            // Always the increasing way round (the sun walks left to right across the view).
            let step = hour.az - az;
            while (step < 0) step += 360;
            az += step;
        }
        knots.push(Object.freeze([COUNTED[k], az]));
    });
    knots.push(Object.freeze([COUNTED[HOUR_COUNT], HOURS[0].az + 360]));
    return Object.freeze(knots);
})();
const BEARING_TANGENTS = monotoneTangents(BEARINGS);

/** The wheel's place for a level (1-based) and the clock: stations from the storm break. */
export function hourPlace(level, time) {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    return Math.max(0, (Number(level) || 1) - 1) + t / TIMING.hour;
}

/** The hour of the day, counted on from the storm break (COUNTED[0] .. + 24), at a place. */
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

/** The sun's height (degrees) at an hour of the day: the real one at 43° north early in September. */
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

/** The direct light's luminance with the sun `el` degrees up: gone under the hills, then rising. */
export function sunStrength(el) {
    const over = el - SUN.edge;
    if (!(over > 0)) return 0;
    return SUN.peak * (1 - Math.exp(-over / SUN.rise));
}

/** How much of the disc stands clear of the far hills (the direct light's last gate). */
export const sunClear = (el) => smooth(SUN.edge, SUN.clear, el);

/** How far the sky is in daylight with the sun `el` degrees up (0 the twilight, 1 day). */
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
    dst.from = src.from;
    dst.to = src.to;
    dst.mix = src.mix;
    dst.hour = src.hour;
    dst.place = src.place;
    return dst;
}

export function createLight() {
    const light = {
        az: 0, el: 0, sunUp: 1, dir: [0, 0, -1], from: 0, to: 1, mix: 0, hour: HOURS[0].at, place: 0,
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
