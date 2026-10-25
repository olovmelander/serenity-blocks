// @ts-check
/**
 * Wolfhour — the hours of the wolf's night.
 *
 * The moon does not move (the ranges' moonlight and shade are baked for where it stands), but
 * the night does. Its light turns through five hours and comes round: the silver moon the valley
 * opens under, deep midnight when the moon is veiled and small and the snow goes to deep blue
 * under the most stars, the wolf's hour itself — the grey hour before dawn, when the mist pales
 * and the stars go out — alpenglow, the first light rose on the peaks above cold violet shade,
 * and a hunter's moon, rising honey-gold over the snow (gold, never red: the red moon is Blood
 * Moon's). The clock turns them by itself in every mode (shared/mood-clock.js), and every level
 * is one hour on from wherever the clock has brought the night.
 *
 * Plain numbers and no three.js: the sky's night light (wolfhour-sky.js `setHour`) and the grade
 * take them, and the theme, the playground and the tests share them. Every colour is a tint on
 * the scene's own authored colours (1 is the night as it was), but the sky's two base colours,
 * which an hour sets outright.
 */
import {
    easeStep, meltPalettes, moodDrift, nearestStep, wheelAt,
} from '../shared/mood-clock.js';

/** Seconds from one hour to the next: a little over eight minutes for the night to come round. */
export const WOLFHOUR_HOUR_SECONDS = 100;
/** The share of its period an hour rests, pure, before it begins to melt into the next. */
export const WOLFHOUR_HOUR_HOLD = 0.35;
/** How quickly the night takes a level's step, per second: most of the way in four seconds. */
export const WOLFHOUR_HOUR_FOLLOW = 0.6;

/**
 * The colours an hour sets: `moon` tints the moonlit snow, rock, spruce, the wolves' rims and the
 * spindrift; `shade` the shaded snow and rock (the sky's fill); `air` the valley air and mist;
 * `skyLow` and `skyHigh` the sky's base at the horizon and overhead (outright, linear); `glow` the
 * moon's light on the sky and its corona; `cloud` the moonlit cloud; `disc` the moon's face.
 */
export const WOLFHOUR_HOUR_COLOURS = Object.freeze([
    'moon', 'shade', 'air', 'skyLow', 'skyHigh', 'glow', 'cloud', 'disc',
]);
/** And the numbers: how many stars show, the grade's iris, and how hard it leans the shadows blue. */
export const WOLFHOUR_HOUR_SCALARS = Object.freeze(['stars', 'exposure', 'cool']);

export const WOLFHOUR_HOURS = Object.freeze([
    {
        // The valley as it opens: cool white snow, blue shade, an indigo sky round a silver moon.
        name: 'silver moon',
        moon: [1, 1, 1],
        shade: [1, 1, 1],
        air: [1, 1, 1],
        skyLow: [0.0062, 0.0095, 0.021],
        skyHigh: [0.0006, 0.0009, 0.0026],
        glow: [1, 1, 1],
        cloud: [1, 1, 1],
        disc: [1, 1, 1],
        stars: 1,
        exposure: 1,
        cool: 1,
    },
    {
        // The moon veiled and small: the snow gone deep blue, the sky ink, the stars at their most.
        name: 'deep midnight',
        moon: [0.6, 0.7, 0.98],
        shade: [0.82, 0.9, 1.12],
        air: [0.72, 0.8, 0.98],
        skyLow: [0.0034, 0.0056, 0.0165],
        skyHigh: [0.0003, 0.0005, 0.0019],
        glow: [0.72, 0.8, 1.0],
        cloud: [0.58, 0.64, 0.8],
        disc: [0.84, 0.9, 1.0],
        stars: 1.4,
        exposure: 1.06,
        cool: 1.1,
    },
    {
        // The wolf's hour, the grey hour before dawn: lilac-grey light, the mist pale, the stars
        // going out and the sky greying up from the horizon.
        name: "the wolf's hour",
        moon: [0.8, 0.77, 0.86],
        shade: [1.6, 1.48, 1.38],
        air: [1.4, 1.3, 1.3],
        skyLow: [0.04, 0.037, 0.056],
        skyHigh: [0.0036, 0.0044, 0.011],
        glow: [0.85, 0.82, 0.92],
        cloud: [1.85, 1.72, 1.78],
        disc: [0.88, 0.88, 0.92],
        stars: 0.3,
        exposure: 1.04,
        cool: 0.7,
    },
    {
        // Alpenglow: the first light rose on the snow, the shade cold violet, a peach band under a
        // cobalt sky.
        name: 'alpenglow',
        moon: [1.75, 1.0, 0.74],
        shade: [1.1, 1.0, 1.25],
        air: [1.35, 1.05, 1.1],
        skyLow: [0.15, 0.075, 0.09],
        skyHigh: [0.004, 0.009, 0.028],
        glow: [1.2, 1.0, 0.9],
        cloud: [2.6, 1.6, 1.7],
        disc: [1.0, 0.95, 0.92],
        stars: 0.2,
        exposure: 0.95,
        cool: 0.4,
    },
    {
        // A hunter's moon: honey-gold light on the snow, cold blue shade, an amber aureole in an
        // indigo sky (gold, never red).
        name: "hunter's moon",
        moon: [1.42, 1.0, 0.6],
        shade: [0.95, 0.95, 1.1],
        air: [1.05, 0.96, 0.95],
        skyLow: [0.0065, 0.0075, 0.019],
        skyHigh: [0.0006, 0.0009, 0.0028],
        glow: [1.3, 1.0, 0.72],
        cloud: [1.25, 1.05, 0.85],
        disc: [1.12, 0.92, 0.64],
        stars: 0.9,
        exposure: 0.98,
        cool: 0.6,
    },
].map((hour) => Object.freeze(Object.fromEntries(Object.entries(hour).map(([key, value]) => (
    [key, Array.isArray(value) ? Object.freeze(value) : value]))))));

/** Somewhere to put an hour's colours and numbers: a place a caller keeps and fills again. */
export function createWolfhourHour() {
    /** @type {Record<string, any>} */
    const hour = {};
    for (const key of WOLFHOUR_HOUR_COLOURS) hour[key] = [0, 0, 0];
    for (const key of WOLFHOUR_HOUR_SCALARS) hour[key] = 0;
    return hour;
}

/**
 * How far the clock alone has turned the hours at `time` (seconds): a whole number while one
 * rests, easing to the next as it melts. A function of the time and nothing else.
 * @param {number} time
 */
export function wolfhourHourDrift(time) {
    return moodDrift(time, WOLFHOUR_HOUR_SECONDS, WOLFHOUR_HOUR_HOLD);
}

const AT = { a: 0, b: 0, melt: 0 };

/**
 * The night's light `phase` hours in (any real number: the night comes round). On a whole phase
 * it is that hour exactly; between, the colours melt the short way round the colour wheel.
 * @param {number} phase
 * @param {Record<string, any>} [out]
 */
export function wolfhourHourAt(phase, out = createWolfhourHour()) {
    meltPalettes(WOLFHOUR_HOURS, WOLFHOUR_HOUR_COLOURS, phase, out);
    wheelAt(phase, WOLFHOUR_HOURS.length, AT);
    const a = WOLFHOUR_HOURS[AT.a];
    const b = WOLFHOUR_HOURS[AT.b];
    for (const key of WOLFHOUR_HOUR_SCALARS) {
        const from = /** @type {number} */ (a[key]);
        const to = /** @type {number} */ (b[key]);
        // eslint-disable-next-line no-param-reassign
        out[key] = from + (to - from) * AT.melt;
    }
    return out;
}

/**
 * The name of the hour a phase is nearest.
 * @param {number} phase
 */
export function wolfhourHourName(phase) {
    const n = WOLFHOUR_HOURS.length;
    const p = Number.isFinite(phase) ? phase : 0;
    return WOLFHOUR_HOURS[((Math.round(p) % n) + n) % n].name;
}

/**
 * Where the night stands: the clock's turn and the level's step on top. The theme and the
 * playground each keep one; `update(time, dt)` eases a new level's step in (the short way round)
 * and returns the phase, a function of the time and the eased step alone.
 */
export class WolfhourNightClock {
    constructor() {
        this.level = 1;
        /** The levels' share of the phase, eased toward `level - 1`. */
        this.step = 0;
        this.phase = 0;
    }

    /**
     * A new level: the night turns one hour on from wherever the clock has brought it. It eases
     * there in update(); `silent` (a rebuilt scene, a capture) is there at once. A new run goes
     * back to the first level's hour the short way round.
     * @param {number} level
     * @param {{ silent?: boolean }} [options]
     */
    setLevel(level, { silent = false } = {}) {
        const wanted = Number(level);
        if (Number.isFinite(wanted)) this.level = Math.max(1, Math.min(9999, Math.round(wanted)));
        if (silent) this.step = nearestStep(this.step, this.level - 1, WOLFHOUR_HOURS.length);
        return this.level;
    }

    /**
     * The phase at `time`, after easing the level's step by `dt` seconds.
     * @param {number} time
     * @param {number} [dt]
     */
    update(time, dt = 0) {
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const follow = 1 - Math.exp(-step * WOLFHOUR_HOUR_FOLLOW);
        this.step = easeStep(this.step, this.level - 1, follow, WOLFHOUR_HOURS.length);
        if (Number.isFinite(time)) this.phase = this.step + wolfhourHourDrift(time);
        return this.phase;
    }
}
