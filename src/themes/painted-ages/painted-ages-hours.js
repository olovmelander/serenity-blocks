/**
 * Painted Ages — the hours of light (CPU only, three-free).
 *
 * The badlands are lit by a day that turns on a wheel of six hours: first light, morning, high
 * day, afternoon, sunset and the blue hour. The wheel moves with the clock by itself (one hour
 * every TIMING.hour seconds, resting TIMING.hourRest of each step on the hour's own light) and a
 * level-up adds a whole hour on top, eased from wherever the light was heading. So the colour
 * changes slowly at any level, and a level-up is a visible step of the day.
 *
 * The sun walks round the sky: up out of the right of the frame at dawn, behind the eye at noon,
 * down into the left at sunset, under the horizon in the blue hour, and back to the right through
 * a brief twilight. Every hour is authored so a half-way mix with its neighbours keeps its colour.
 */
import {
    DEG, TIMING, clamp, lerp, smooth,
} from './painted-ages-core.js';

/**
 * Linear colours. `sun` is the direct light (colour × strength, unshadowed on a face turned to
 * it); `fill` the sky's light on a shadowed face; `bounce` the warm light the red ground throws
 * back up; `zenith`/`horizon`/`glow` the sky; `haze` the air in front of distant things; `mist`
 * the valley mist; `cloudLit`/`cloudShade` the two sides of a cloud; `snow` alpenglow on the peaks.
 * `az` is degrees right of the view axis, `el` degrees above the horizon.
 */
export const HOURS = Object.freeze([
    Object.freeze({
        name: 'first light',
        az: 27,
        el: 6.5,
        sun: [3.4, 1.55, 0.78],
        fill: [0.16, 0.15, 0.27],
        bounce: [0.2, 0.09, 0.06],
        zenith: [0.045, 0.06, 0.17],
        horizon: [0.92, 0.5, 0.42],
        glow: [1.6, 0.68, 0.32],
        haze: [0.6, 0.4, 0.44],
        mist: [0.78, 0.56, 0.6],
        cloudLit: [1.5, 0.72, 0.52],
        cloudShade: [0.24, 0.18, 0.32],
        snow: [1.3, 0.62, 0.62],
        exposure: 1.15,
        stars: 0.12,
        hazeDensity: 1.25,
        mistDensity: 1.0,
    }),
    Object.freeze({
        name: 'morning',
        az: 70,
        el: 14,
        sun: [4.2, 3.05, 1.9],
        fill: [0.19, 0.25, 0.42],
        bounce: [0.26, 0.13, 0.08],
        zenith: [0.06, 0.15, 0.42],
        horizon: [0.72, 0.61, 0.56],
        glow: [1.3, 0.9, 0.55],
        haze: [0.6, 0.57, 0.6],
        mist: [0.8, 0.74, 0.72],
        cloudLit: [1.6, 1.3, 1.0],
        cloudShade: [0.36, 0.38, 0.5],
        snow: [1.5, 1.35, 1.25],
        exposure: 0.92,
        stars: 0,
        hazeDensity: 1.0,
        mistDensity: 0.55,
    }),
    Object.freeze({
        name: 'high day',
        az: 160,
        el: 47,
        sun: [4.1, 3.8, 3.35],
        fill: [0.2, 0.3, 0.5],
        bounce: [0.3, 0.16, 0.1],
        zenith: [0.035, 0.12, 0.42],
        horizon: [0.48, 0.6, 0.78],
        glow: [1.0, 0.95, 0.85],
        haze: [0.5, 0.6, 0.76],
        mist: [0.7, 0.76, 0.84],
        cloudLit: [1.75, 1.72, 1.66],
        cloudShade: [0.45, 0.52, 0.66],
        snow: [1.7, 1.72, 1.78],
        exposure: 0.6,
        stars: 0,
        hazeDensity: 1.05,
        mistDensity: 0.2,
    }),
    Object.freeze({
        name: 'afternoon',
        az: 258,
        el: 21,
        sun: [4.5, 3.4, 2.15],
        fill: [0.19, 0.24, 0.4],
        bounce: [0.3, 0.15, 0.08],
        zenith: [0.05, 0.13, 0.4],
        horizon: [0.7, 0.62, 0.56],
        glow: [1.4, 0.95, 0.52],
        haze: [0.66, 0.58, 0.52],
        mist: [0.82, 0.72, 0.62],
        cloudLit: [1.7, 1.38, 0.98],
        cloudShade: [0.38, 0.36, 0.46],
        snow: [1.6, 1.42, 1.2],
        exposure: 0.88,
        stars: 0,
        hazeDensity: 1.05,
        mistDensity: 0.3,
    }),
    Object.freeze({
        name: 'sunset',
        az: 333,
        el: 6,
        sun: [3.8, 1.3, 0.42],
        fill: [0.17, 0.13, 0.24],
        bounce: [0.28, 0.09, 0.05],
        zenith: [0.06, 0.06, 0.19],
        horizon: [1.0, 0.42, 0.22],
        glow: [1.9, 0.62, 0.2],
        haze: [0.74, 0.38, 0.3],
        mist: [0.86, 0.5, 0.42],
        cloudLit: [1.9, 0.72, 0.32],
        cloudShade: [0.3, 0.16, 0.26],
        snow: [1.6, 0.58, 0.46],
        exposure: 1.08,
        stars: 0.04,
        hazeDensity: 1.3,
        mistDensity: 0.75,
    }),
    Object.freeze({
        name: 'blue hour',
        az: 338,
        el: -5.5,
        sun: [0, 0, 0],
        fill: [0.11, 0.11, 0.22],
        bounce: [0.06, 0.03, 0.04],
        zenith: [0.012, 0.02, 0.07],
        horizon: [0.34, 0.2, 0.32],
        glow: [0.6, 0.24, 0.3],
        haze: [0.19, 0.15, 0.27],
        mist: [0.3, 0.26, 0.42],
        cloudLit: [0.62, 0.3, 0.42],
        cloudShade: [0.06, 0.06, 0.13],
        snow: [0.55, 0.42, 0.62],
        exposure: 1.9,
        stars: 0.9,
        hazeDensity: 1.0,
        mistDensity: 0.9,
    }),
]);

export const HOUR_COUNT = HOURS.length;
const COLOUR_KEYS = ['sun', 'fill', 'bounce', 'zenith', 'horizon', 'glow', 'haze', 'mist', 'cloudLit', 'cloudShade', 'snow'];
const SCALAR_KEYS = ['exposure', 'stars', 'hazeDensity', 'mistDensity'];

/** The wheel's place for a level (1-based) and the clock: hours from first light. */
export function hourPlace(level, time) {
    const t = Number.isFinite(time) ? Math.max(0, time) : 0;
    return Math.max(0, (Number(level) || 1) - 1) + t / TIMING.hour;
}

/** Hour index (0..5) and the eased mix toward the next one for a wheel place. */
export function hourMix(place) {
    const p = Number.isFinite(place) ? place : 0;
    const whole = Math.floor(p);
    const from = ((whole % HOUR_COUNT) + HOUR_COUNT) % HOUR_COUNT;
    const to = (from + 1) % HOUR_COUNT;
    const rest = TIMING.hourRest;
    const mix = smooth(rest, 1 - rest, p - whole);
    return { from, to, mix };
}

/**
 * The light at a wheel place, written into `out` (allocated once by the caller). Colours mix in
 * linear light; the sun's azimuth walks the increasing way round (the hours are authored in
 * increasing azimuth, the last hour's successor one turn on).
 */
export function lightAt(place, out = createLight()) {
    const { from, to, mix } = hourMix(place);
    const a = HOURS[from];
    const b = HOURS[to];
    for (const key of COLOUR_KEYS) {
        const ca = a[key];
        const cb = b[key];
        const o = out[key];
        o[0] = lerp(ca[0], cb[0], mix);
        o[1] = lerp(ca[1], cb[1], mix);
        o[2] = lerp(ca[2], cb[2], mix);
    }
    for (const key of SCALAR_KEYS) out[key] = lerp(a[key], b[key], mix);
    const azB = b.az < a.az ? b.az + 360 : b.az;
    out.az = lerp(a.az, azB, mix) % 360;
    out.el = lerp(a.el, b.el, mix);
    // Under the horizon the sun's own light goes out over its last two degrees.
    const up = smooth(-1.2, 1.5, out.el);
    out.sunUp = up;
    const az = out.az * DEG;
    const el = out.el * DEG;
    out.dir[0] = Math.sin(az) * Math.cos(el);
    out.dir[1] = Math.sin(el);
    out.dir[2] = -Math.cos(az) * Math.cos(el);
    out.from = from;
    out.to = to;
    out.mix = mix;
    out.place = place;
    return out;
}

/**
 * Blend light `a` toward light `b` by k (0..1) into `out` (all three may be distinct objects):
 * the colours and scalars mix; the sun's elevation and its direction follow.
 */
export function blendLight(a, b, k, out = createLight()) {
    const t = clamp(k, 0, 1);
    for (const key of COLOUR_KEYS) {
        for (let c = 0; c < 3; c++) out[key][c] = lerp(a[key][c], b[key][c], t);
    }
    for (const key of SCALAR_KEYS) out[key] = lerp(a[key], b[key], t);
    out.az = a.az;
    out.el = lerp(a.el, b.el, t);
    out.sunUp = smooth(-1.2, 1.5, out.el);
    const az = out.az * DEG;
    const el = out.el * DEG;
    out.dir[0] = Math.sin(az) * Math.cos(el);
    out.dir[1] = Math.sin(el);
    out.dir[2] = -Math.cos(az) * Math.cos(el);
    out.from = a.from;
    out.to = a.to;
    out.mix = a.mix;
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
    dst.place = src.place;
    return dst;
}

export function createLight() {
    const light = {
        az: 0, el: 0, sunUp: 1, dir: [0, 0, -1], from: 0, to: 1, mix: 0, place: 0,
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
        this.levelPlace = 0;
        this.turnFrom = 0;
        this.turnTo = 0;
        this.turnAt = -1e6;
        this.level = 1;
    }

    reset() {
        this.levelPlace = 0;
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
            // A new run starts again at level 1: the light stays where it is.
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

export { clamp };
