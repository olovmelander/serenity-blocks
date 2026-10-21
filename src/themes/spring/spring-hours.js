/**
 * Spring — the day: the light the valley is seen in, round the whole twenty-four hours of a day
 * at the end of May at 65° north, when the river is in its spring flood (CPU only, three-free).
 *
 * The eye looks north up the river. The sun walks the sky from left to right through the north:
 * behind the eye by day, round to the left in the afternoon, over the fall up to the left in the
 * golden evening, down behind the gorge's rim at sunset (the valley goes into shade while the
 * fells far off keep the light), under the northern fells through the light night (it never
 * sinks four degrees: the sky never darkens), up again through the gap in the fells on the right
 * at dawn with the mist lying on the river, and round behind the eye for the morning.
 *
 * Six stations name the day, in the order it runs (solar time):
 *
 *   morning         07:00  the sun high on the right behind the eye, a cool clear blue
 *   afternoon       15:30  the sun round on the left, warmer, the cumulus building
 *   golden evening  18:45  the sun over the trees above the fall, the spray and the birches lit
 *                          from behind
 *   sunset          20:15  the sun gone behind the gorge's rim: the valley in blue shade, the
 *                          fells far off and the sky still in the light
 *   light night     00:00  the sun at its lowest under the north, a rose band over the fells
 *   dawn mist       03:30  the sun up through the gap in the fells on the right, mist on the water
 *
 * Between two stations the light is on its way all the time: the clock never holds it, and
 * nothing in it is switched. Where the day stands is one number, the wheel's place:
 *
 *     place = clock / TIMING.hour + (level − 1)        (a level-up's share eased in)
 *
 * and station k stands at place k. The hour of the day runs through the stations' hours on a
 * smooth curve that never runs back, lingering where the light changes most.
 *
 * The sun's height is the real one for its hour; its bearing runs through the stations' own (the
 * picture's composition). Its light is not switched with it: the direct light's strength follows
 * the height through the air (the long way near the horizon dims and reddens it), and how much of
 * it reaches the valley follows the height over the skyline at the sun's bearing, over a few
 * degrees (`sunUp`, the valley's share; the land lifts it for high ground, so the fells keep the
 * light after the valley loses it). `day`, how far the sky is in daylight, follows the height over
 * several degrees either side of the horizon. Every station is authored so a half-way mix with its
 * neighbours keeps its colour (blues and golds, no grey).
 */
import {
    DEG, TIMING, clamp, lerp, smooth,
} from './spring-core.js';

/** Where the valley lies, and the sun's declination at the end of May (degrees). */
export const LATITUDE = 65.5;
export const DECLINATION = 21.8;

/**
 * The direct light: its luminance with the sun well up (`peak`), the height where the air has
 * taken it all (`edge`), and how many degrees over that it takes to reach 63 % of the peak (`rise`).
 */
export const SUN = Object.freeze({
    peak: 3.7,
    edge: -1.2,
    rise: 5.2,
});

/**
 * The skyline from the eye (degrees over the horizon) every 10° of bearing from −180, measured
 * over the baked ground (spring-terrain.js; a unit test keeps them together), half a degree
 * added for the trees on the near rims. The sun's light leaves the valley as it sinks behind it.
 */
export const SKYLINE = Object.freeze([
    /* −180 */ 15.9, 16.0, 17.0, 17.2, 15.9, 15.0, 14.4, 12.3, 10.8, 9.7,
    /* −80 */ 9.8, 9.7, 10.7, 9.1, 8.1, 11.1, 9.7, 11.9, 8.2, 6.6,
    /* 20 */ 7.2, 7.4, 5.6, 6.0, 7.9, 9.2, 11.7, 11.4, 12.8, 13.6,
    /* 120 */ 13.4, 13.7, 15.5, 16.2, 16.5, 16.2, 15.9,
]);

/** How many degrees over and under the skyline the valley's share of the sun crosses (from, to). */
export const SKYLINE_GATE = Object.freeze([-0.8, 2.4]);

/** The sun's heights (degrees) between which the sky crosses from the light night into day. */
export const DAY_HEIGHTS = Object.freeze([-4, 3]);

/**
 * Linear colours. `sun` is the hue of the direct light (its strength comes from the sun's
 * height); `fill` the sky's light on a shadowed face; `bounce` the light the green valley throws
 * back; `zenith`/`horizon`/`glow` the sky; `haze` the air in front of distant things; `mist` the
 * mist over the water; `cloudLit`/`cloudShade` the two sides of a cloud; `water` the river's own
 * deep colour (brown-green: the flood carries the forest's peat). Scalars: `exposure`;
 * `hazeDensity`, `mistDensity`; `cover` the share of the sky the clouds hold; `open` how far the
 * flowers are open (wood anemones close at night); `dew`. `at` is the station's hour of the day,
 * `az` the sun's bearing then, in degrees right of the view axis (the sun walks toward larger az).
 */
export const HOURS = Object.freeze([
    Object.freeze({
        name: 'morning',
        at: 7,
        az: 100,
        sun: [4.0, 3.62, 3.0],
        fill: [0.2, 0.32, 0.6],
        bounce: [0.12, 0.14, 0.08],
        zenith: [0.055, 0.155, 0.46],
        horizon: [0.56, 0.67, 0.82],
        glow: [1.0, 0.95, 0.85],
        haze: [0.42, 0.52, 0.72],
        mist: [0.76, 0.8, 0.88],
        cloudLit: [1.92, 1.88, 1.82],
        cloudShade: [0.5, 0.56, 0.72],
        water: [0.011, 0.02, 0.017],
        exposure: 0.62,
        hazeDensity: 0.48,
        mistDensity: 0.12,
        cover: 0.28,
        open: 0.78,
        dew: 0.5,
    }),
    Object.freeze({
        name: 'afternoon',
        at: 15.5,
        az: 220,
        sun: [4.1, 3.5, 2.6],
        fill: [0.2, 0.3, 0.55],
        bounce: [0.13, 0.14, 0.08],
        zenith: [0.06, 0.15, 0.43],
        horizon: [0.62, 0.68, 0.8],
        glow: [1.2, 1.0, 0.7],
        haze: [0.46, 0.52, 0.68],
        mist: [0.78, 0.78, 0.82],
        cloudLit: [2.0, 1.85, 1.6],
        cloudShade: [0.48, 0.52, 0.66],
        water: [0.012, 0.021, 0.016],
        exposure: 0.64,
        hazeDensity: 0.52,
        mistDensity: 0.04,
        cover: 0.42,
        open: 1,
        dew: 0.05,
    }),
    Object.freeze({
        name: 'golden evening',
        at: 18.75,
        az: 332,
        sun: [3.7, 2.25, 1.05],
        fill: [0.12, 0.19, 0.4],
        bounce: [0.15, 0.11, 0.06],
        zenith: [0.045, 0.115, 0.4],
        horizon: [0.9, 0.74, 0.46],
        glow: [1.75, 0.95, 0.42],
        haze: [0.42, 0.45, 0.58],
        mist: [0.78, 0.68, 0.64],
        cloudLit: [1.95, 1.25, 0.7],
        cloudShade: [0.4, 0.42, 0.62],
        water: [0.012, 0.017, 0.015],
        exposure: 0.95,
        hazeDensity: 0.5,
        mistDensity: 0.1,
        cover: 0.34,
        open: 0.7,
        dew: 0.12,
    }),
    Object.freeze({
        name: 'sunset',
        at: 20.25,
        az: 345,
        sun: [3.2, 1.08, 0.3],
        fill: [0.1, 0.11, 0.26],
        bounce: [0.08, 0.06, 0.05],
        zenith: [0.024, 0.05, 0.22],
        horizon: [1.05, 0.48, 0.26],
        glow: [2.1, 0.66, 0.2],
        haze: [0.5, 0.36, 0.4],
        mist: [0.62, 0.42, 0.42],
        cloudLit: [2.05, 0.78, 0.36],
        cloudShade: [0.3, 0.2, 0.36],
        water: [0.008, 0.011, 0.013],
        exposure: 1.18,
        hazeDensity: 0.62,
        mistDensity: 0.25,
        cover: 0.3,
        open: 0.4,
        dew: 0.3,
    }),
    Object.freeze({
        name: 'light night',
        at: 0,
        az: 364,
        // The sun is under the horizon: no strength, only the hue it would carry.
        sun: [3.0, 0.8, 0.2],
        fill: [0.05, 0.06, 0.13],
        bounce: [0.03, 0.03, 0.035],
        zenith: [0.006, 0.014, 0.06],
        horizon: [0.36, 0.2, 0.2],
        glow: [0.75, 0.32, 0.2],
        haze: [0.08, 0.08, 0.14],
        mist: [0.14, 0.14, 0.22],
        cloudLit: [0.24, 0.13, 0.16],
        cloudShade: [0.025, 0.03, 0.065],
        water: [0.003, 0.006, 0.01],
        exposure: 1.45,
        hazeDensity: 0.45,
        mistDensity: 0.55,
        cover: 0.2,
        open: 0.12,
        dew: 0.7,
    }),
    Object.freeze({
        name: 'dawn mist',
        at: 3.5,
        az: 406,
        sun: [2.7, 1.6, 1.0],
        fill: [0.15, 0.15, 0.28],
        bounce: [0.1, 0.08, 0.07],
        zenith: [0.04, 0.075, 0.26],
        horizon: [0.92, 0.62, 0.72],
        glow: [1.55, 0.84, 0.52],
        haze: [0.62, 0.56, 0.64],
        mist: [0.96, 0.8, 0.78],
        cloudLit: [1.65, 1.02, 0.82],
        cloudShade: [0.34, 0.3, 0.44],
        water: [0.01, 0.015, 0.017],
        exposure: 1.18,
        hazeDensity: 1.0,
        mistDensity: 1.0,
        cover: 0.18,
        open: 0.25,
        dew: 1,
    }),
]);

export const HOUR_COUNT = HOURS.length;
export const LIGHT_COLOUR_KEYS = Object.freeze([
    'sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade', 'water',
]);
export const LIGHT_SCALAR_KEYS = Object.freeze([
    'exposure', 'hazeDensity', 'mistDensity', 'cover', 'open', 'dew', 'day',
]);
/** The station scalars mixed by hour (`day` comes from the sun's height). */
const STATION_SCALARS = ['exposure', 'hazeDensity', 'mistDensity', 'cover', 'open', 'dew'];

const wrap24 = (h) => ((h % 24) + 24) % 24;
const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

// ── The timetable ───────────────────────────────────────────────────────────────────────────

/**
 * Tangents of a curve through knots [x, y] that never runs back between them (Fritsch–Butland),
 * treating the knots as one period of a periodic curve (the last knot is the first, one on).
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

/** The stations' hours, counted on from the morning so they only rise, and the morning a day on. */
const COUNTED = Object.freeze([
    ...HOURS.map((hour) => (hour.at < HOURS[0].at ? hour.at + 24 : hour.at)),
    HOURS[0].at + 24,
]);

/**
 * Where the day lingers between the stations: [place, hour counted]. The valley loses the sun
 * behind the gorge's rim and gets it back through the gap in the fells over a degree or two of
 * its height, so the day slows there (and runs the high day and the deep night a little faster).
 */
export const LINGER = Object.freeze([
    Object.freeze([2.5, 19.4]),
    Object.freeze([4.62, 26.4]),
    Object.freeze([5.3, 28.2]),
]);

/** [place, hour counted] knots: station k stands at place k; one day is HOUR_COUNT places. */
export const TIMETABLE = Object.freeze([
    ...COUNTED.map((hour, k) => Object.freeze([k, hour])),
    ...LINGER,
].sort((a, b) => a[0] - b[0]));
const TIMETABLE_TANGENTS = monotoneTangents(TIMETABLE);

/** [hour counted, bearing] knots: the sun's bearing turns through the stations' own. */
const BEARINGS = (() => {
    const knots = HOURS.map((hour, k) => Object.freeze([COUNTED[k], hour.az]));
    knots.push(Object.freeze([COUNTED[HOUR_COUNT], HOURS[0].az + 360]));
    return Object.freeze(knots);
})();
const BEARING_TANGENTS = monotoneTangents(BEARINGS);

/** The wheel's place for a level (1-based) and the clock: stations from the morning. */
export function hourPlace(level, time) {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    return Math.max(0, (Number(level) || 1) - 1) + t / TIMING.hour;
}

/** The hour of the day, counted on from the morning (COUNTED[0] .. + 24), at a place. */
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

/** The sun's height (degrees) at an hour of the day: the real one at 65.5° north at the end of May. */
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

/** The skyline's height (degrees) at a bearing (degrees), between the table's entries. */
export function skylineAt(bearing) {
    const b = (((bearing % 360) + 540) % 360) - 180;
    const f = (b + 180) / 10;
    const i = Math.min(SKYLINE.length - 2, Math.floor(f));
    return lerp(SKYLINE[i], SKYLINE[i + 1], f - i);
}

/** The direct light's luminance with the sun `el` degrees up, through the air (no skyline). */
export function sunStrength(el) {
    const over = el - SUN.edge;
    if (!(over > 0)) return 0;
    return SUN.peak * (1 - Math.exp(-over / SUN.rise));
}

/** How much of the sun reaches ground `lift` degrees over the valley's own skyline (0..1). */
export const sunClear = (el, skyline, lift = 0) => smooth(SKYLINE_GATE[0], SKYLINE_GATE[1], el - skyline + lift)
    * smooth(SUN.edge, 0.4, el);

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
 * colours mix in linear light by the hour of the day; the sun stands where that hour puts it, its
 * strength follows its height, and the valley's share of it its height over the skyline.
 */
export function lightAt(place, out = createLight()) {
    const {
        from, to, mix, hour,
    } = hourMix(place, mixed);
    const a = HOURS[from];
    const b = HOURS[to];
    for (const key of LIGHT_COLOUR_KEYS) {
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
    out.skyline = skylineAt(out.az);
    // The direct light: the stations' hue at the strength the sun's height gives it.
    const strength = sunStrength(out.el) / Math.max(1e-6, luminance(out.sun));
    for (let c = 0; c < 3; c++) out.sun[c] *= strength;
    out.sunUp = sunClear(out.el, out.skyline);
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
    for (const key of LIGHT_COLOUR_KEYS) {
        for (let c = 0; c < 3; c++) out[key][c] = lerp(a[key][c], b[key][c], t);
    }
    for (const key of LIGHT_SCALAR_KEYS) out[key] = lerp(a[key], b[key], t);
    out.az = a.az;
    out.el = lerp(a.el, b.el, t);
    out.skyline = a.skyline;
    out.sunUp = lerp(a.sunUp, b.sunUp, t);
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
    for (const key of LIGHT_COLOUR_KEYS) for (let c = 0; c < 3; c++) dst[key][c] = src[key][c];
    for (const key of LIGHT_SCALAR_KEYS) dst[key] = src[key];
    for (let c = 0; c < 3; c++) dst.dir[c] = src.dir[c];
    dst.az = src.az;
    dst.el = src.el;
    dst.skyline = src.skyline;
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
        az: 0, el: 0, skyline: 0, sunUp: 1, dir: [0, 0, -1], from: 0, to: 1, mix: 0, hour: HOURS[0].at, place: 0,
    };
    for (const key of LIGHT_COLOUR_KEYS) light[key] = [0, 0, 0];
    for (const key of LIGHT_SCALAR_KEYS) light[key] = 0;
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
