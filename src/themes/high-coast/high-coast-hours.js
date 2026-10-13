/**
 * High Coast — the hours of light (CPU only, three-free).
 *
 * The coast is lit by a summer day at 63° north that turns on a wheel of six hours: the golden
 * hour, sunset, the light night (the sun only a few degrees under the northern horizon, the sky
 * never dark), dawn with the sea fog lying on the bay, morning, and afternoon. The wheel moves with
 * the clock by itself (one hour every TIMING.hour seconds, resting TIMING.hourRest of each step on
 * the hour's own light) and a level-up adds a whole hour on top, eased from wherever the light
 * was heading. So the colour changes slowly at any level, and a level-up is a visible step.
 *
 * The sun walks the northern sky from right to left: low on the right over the open sea in the
 * golden hour, setting there, under the horizon behind the card in the light night, up again on
 * the left at dawn, behind the eye by day and round to the right for the afternoon. Every hour is
 * authored so a half-way mix with its neighbours keeps its colour (blues and golds, no grey).
 */
import {
    DEG, TIMING, clamp, lerp, smooth,
} from './high-coast-core.js';

/**
 * Linear colours. `sun` is the direct light (colour × strength); `fill` the sky's light on a
 * shadowed face; `bounce` the warm light the granite throws back; `zenith`/`horizon`/`glow` the
 * sky; `haze` the air in front of distant things; `mist` the sea fog; `cloudLit`/`cloudShade` the
 * two sides of a cloud; `water` the sea's own deep colour. `az` is degrees right of the view axis
 * (the sun walks toward smaller az), `el` degrees above the horizon.
 */
export const HOURS = Object.freeze([
    Object.freeze({
        name: 'golden hour',
        az: 25,
        el: 4.8,
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
        az: 21,
        el: 0.5,
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
        az: 2,
        el: -5.5,
        sun: [0, 0, 0],
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
        az: -9,
        el: 2.6,
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
        az: -95,
        el: 24,
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
        az: 140,
        el: 30,
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
const SCALAR_KEYS = ['exposure', 'stars', 'hazeDensity', 'mistDensity'];

/** The wheel's place for a level (1-based) and the clock: hours from the golden hour. */
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

/** The azimuth the sun walks to from `a` toward `b`: always the decreasing way round. */
export function walkAz(a, b, mix) {
    const to = b > a ? b - 360 : b;
    const az = lerp(a, to, mix);
    return (((az % 360) + 540) % 360) - 180;
}

function writeDir(out) {
    const az = out.az * DEG;
    const el = out.el * DEG;
    out.dir[0] = Math.sin(az) * Math.cos(el);
    out.dir[1] = Math.sin(el);
    out.dir[2] = -Math.cos(az) * Math.cos(el);
}

/**
 * The light at a wheel place, written into `out` (allocated once by the caller). Colours mix in
 * linear light; the sun walks the decreasing way round.
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
    out.az = walkAz(a.az, b.az, mix);
    out.el = lerp(a.el, b.el, mix);
    // Under the horizon the sun's own light goes out over its last two degrees.
    out.sunUp = smooth(-1.2, 1.5, out.el);
    // Windows and the lighthouse are lit when the sun is low.
    out.lamps = 1 - smooth(-1, 5, out.el);
    writeDir(out);
    out.from = from;
    out.to = to;
    out.mix = mix;
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
    out.sunUp = smooth(-1.2, 1.5, out.el);
    out.lamps = Math.max(1 - smooth(-1, 5, out.el), lerp(a.lamps, b.lamps, t));
    writeDir(out);
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
    dst.lamps = src.lamps;
    dst.from = src.from;
    dst.to = src.to;
    dst.mix = src.mix;
    dst.place = src.place;
    return dst;
}

export function createLight() {
    const light = {
        az: 0, el: 0, sunUp: 1, lamps: 0, dir: [0, 0, -1], from: 0, to: 1, mix: 0, place: 0,
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
