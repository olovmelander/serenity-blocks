/**
 * Winter — what the night does by itself: the weather, and the forms the aurora takes.
 * Three-free and renderer-free, like the plan (winter-core.js): the world reads these each frame
 * and the tests read them without a scene.
 *
 * The hours (winter-core.js) turn the sky's colours. Two more clocks turn beside them, each a
 * function of the time and nothing else, so a seek and a replay agree at any frame rate:
 *
 *  - The WEATHER: light snowfall (the look the theme opens on), a clear still night, ice haze
 *    (diamond dust in the air, a ring round the moon, mist lying on the lake), a flurry on the
 *    wind, and big slow flakes in still air under a thin veil of cloud.
 *  - The aurora's FORM: bands with rays (the look the theme opens on), quiet arcs, tall rays,
 *    deep folded curtains, a corona breaking overhead, and patches that pulse.
 *
 * Their periods differ from the hours' and from each other's, so the same hour meets a different
 * weather and a different form each time it comes round: the three come back into step only after
 * more than an hour of play.
 *
 * And small things happen now and then on their own: a shooting star, a bough that lets its load
 * of snow go, a gust that crosses the snowfield. When each falls is dealt from a seed by its
 * number, so those are functions of the clock too.
 */

import { clamp01, mulberry32 } from './winter-core.js';

const quintic = (k) => k * k * k * (k * (k * 6 - 15) + 10);

/**
 * How far a clock has turned at `time`, in whole steps: it rests on each for `rest` of its
 * `period`, then melts into the next over what is left.
 */
export function clockDrift(time, period, rest) {
    const t = Math.max(0, Number.isFinite(time) ? time : 0) / period;
    const whole = Math.floor(t);
    return whole + quintic(clamp01((t - whole - rest) / (1 - rest)));
}

/** Mix two rows of a table at a phase (any real number: the table comes round). */
function tableAt(table, keys, phase, out) {
    const n = table.length;
    const p = (((Number.isFinite(phase) ? phase : 0) % n) + n) % n;
    const i = Math.floor(p) % n;
    const f = p - Math.floor(p);
    const a = table[i];
    const b = table[(i + 1) % n];
    for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        out[key] = a[key] + (b[key] - a[key]) * f;
    }
    return out;
}

const nameAt = (table, phase) => {
    const n = table.length;
    const p = (((Number.isFinite(phase) ? phase : 0) % n) + n) % n;
    return table[Math.round(p) % n].name;
};

// ── The weather ─────────────────────────────────────────────────────────────────

/** Seconds a weather lasts, and the share of that it rests before it begins to turn. */
export const WEATHER_PERIOD = 82;
export const WEATHER_REST = 0.42;

/**
 * The weathers, in the order they come round.
 *
 *   snow   how much of the snowfall's pool is in the air (1 = the theme's own snowfall; the pool
 *          holds SNOW_HEADROOM times that for a flurry)
 *   flake  how large the flakes are (1 = as the theme's own)
 *   wind   the wind against the resting wind (WIND in winter-core.js)
 *   veil   how much high thin cloud is over the sky (0 clear .. 1)
 *   mist   how thick the mist lies over the lake (0..1)
 *   dust   diamond dust: ice crystals in still, very cold air (0..1). With the veil it is what
 *          makes the ring round the moon.
 */
export const WEATHERS = Object.freeze([
    {
        name: 'snowfall', snow: 1, flake: 1, wind: 1, veil: 0.3, mist: 0.35, dust: 0,
    },
    {
        name: 'clear', snow: 0.1, flake: 0.9, wind: 0.55, veil: 0, mist: 0.2, dust: 0.1,
    },
    {
        name: 'ice-haze', snow: 0.16, flake: 0.8, wind: 0.3, veil: 0.7, mist: 1, dust: 1,
    },
    {
        name: 'flurry', snow: 1.6, flake: 0.9, wind: 2.3, veil: 0.85, mist: 0.6, dust: 0,
    },
    {
        name: 'soft-flakes', snow: 0.62, flake: 1.5, wind: 0.22, veil: 0.55, mist: 0.5, dust: 0.15,
    },
].map((w) => Object.freeze(w)));

export const WEATHER_KEYS = Object.freeze(['snow', 'flake', 'wind', 'veil', 'mist', 'dust']);

/** The snowfall's pool holds this many times the flakes of the theme's own snowfall. */
export const SNOW_HEADROOM = 1.6;

export const weatherDrift = (time) => clockDrift(time, WEATHER_PERIOD, WEATHER_REST);
/** The weather `phase` weathers into the round: fills `out[key]` for every key of WEATHER_KEYS. */
export const weatherAt = (phase, out = {}) => tableAt(WEATHERS, WEATHER_KEYS, phase, out);
export const weatherName = (phase) => nameAt(WEATHERS, phase);

// ── The aurora's forms ──────────────────────────────────────────────────────────

/** Seconds a form lasts, and the share of that it rests before it begins to turn. */
export const FORM_PERIOD = 64;
export const FORM_REST = 0.36;

/**
 * The forms, in the order they come round. An aurora goes through something like this over a
 * night: quiet arcs brighten into rayed bands, fold into curtains, break up overhead, and end
 * in patches that pulse.
 *
 *   rays    how much of a sheet's light is in its rays (0 a smooth glowing arc .. 1 a comb of rays)
 *   folds   how deeply the sheets fold (against the planned fold)
 *   tall    how tall the rays stand (against the planned height)
 *   hem     how bright the lower border is (against the planned hem)
 *   corona  rays that converge on a point overhead (0..1)
 *   pulse   how far the light gathers into patches that pulse (0..1)
 *   gain    how bright the whole display is (against the resting sheets)
 *   wide    how much more of the sky is alight: what it adds to the sheets that sleep at rest
 */
export const AURORA_FORMS = Object.freeze([
    {
        name: 'bands', rays: 0.6, folds: 1, tall: 1, hem: 1, corona: 0, pulse: 0, gain: 1, wide: 0,
    },
    {
        name: 'arcs', rays: 0.08, folds: 0.4, tall: 0.55, hem: 1.5, corona: 0, pulse: 0, gain: 1.25, wide: 0.5,
    },
    {
        name: 'rays', rays: 1, folds: 0.75, tall: 1.9, hem: 0.5, corona: 0.1, pulse: 0, gain: 1.15, wide: 0.6,
    },
    {
        name: 'curtains', rays: 0.7, folds: 1.75, tall: 1.15, hem: 1.9, corona: 0, pulse: 0, gain: 1.5, wide: 1,
    },
    {
        name: 'corona', rays: 0.9, folds: 1.3, tall: 1.5, hem: 1.2, corona: 0.5, pulse: 0.1, gain: 1.35, wide: 1,
    },
    {
        name: 'pulsing', rays: 0.22, folds: 0.7, tall: 0.75, hem: 0.8, corona: 0, pulse: 1, gain: 1.3, wide: 1.2,
    },
].map((f) => Object.freeze(f)));

export const FORM_KEYS = Object.freeze(['rays', 'folds', 'tall', 'hem', 'corona', 'pulse', 'gain', 'wide']);

export const formDrift = (time) => clockDrift(time, FORM_PERIOD, FORM_REST);
/** The aurora's form `phase` forms into the round: fills `out[key]` for every key of FORM_KEYS. */
export const formAt = (phase, out = {}) => tableAt(AURORA_FORMS, FORM_KEYS, phase, out);
export const formName = (phase) => nameAt(AURORA_FORMS, phase);

/**
 * The display's own breathing at rest: it brightens and sinks over half a minute to a minute and
 * a half, never the same swell twice running (three slow sines whose periods share no factor).
 * About 0.6 to 1.5, mean 1.
 */
export function auroraSwell(time) {
    const t = Number.isFinite(time) ? time : 0;
    return 1 + 0.26 * Math.sin(t * 0.1047 + 0.6) + 0.17 * Math.sin(t * 0.0613 + 2.2) + 0.1 * Math.sin(t * 0.171 + 4.1);
}

// ── Things that happen now and then ─────────────────────────────────────────────

/**
 * A stream of moments that come at uneven gaps: gap n lasts between `least` and `most` seconds,
 * drawn from the seed by n alone, so the moment of the nth is a function of n (and the moments
 * before a time are found by walking forward from 0: a few steps a minute, counted once a frame
 * from where the last frame stopped).
 */
export class NowAndThen {
    /**
     * @param {number} seed
     * @param {number} least  the shortest gap (seconds)
     * @param {number} most   the longest
     * @param {number} [first]  seconds before the first one may fall
     */
    constructor(seed, least, most, first = least) {
        this.seed = seed >>> 0;
        this.least = least;
        this.most = Math.max(most, least);
        this.first = first;
        this.reset();
    }

    /** Back to the start of the stream. */
    reset() {
        this.index = 0;
        this.next = this.first + this.gap(0);
    }

    /** The nth gap, and three numbers in 0..1 that go with the nth moment (`roll`). */
    gap(n) {
        const rand = mulberry32((this.seed + Math.imul(n + 1, 0x9e3779b1)) >>> 0);
        this.roll = [rand(), rand(), rand()];
        // (Skewed toward the short end: quiet spells are the exception, not the rule.)
        const k = this.roll[0] * this.roll[0] * 0.6 + this.roll[0] * 0.4;
        return this.least + (this.most - this.least) * k;
    }

    /**
     * Jump to `time` without firing: the next moment is the first one after it. (A seek.)
     */
    seek(time) {
        this.reset();
        while (this.next <= time) {
            this.index += 1;
            this.next += this.gap(this.index);
        }
    }

    /**
     * Has a moment fallen by `time`? Returns its three numbers (a reused array) once for each,
     * or null. Call until it returns null.
     */
    due(time) {
        if (time < this.next) return null;
        const at = this.next;
        // (The numbers that go with THIS moment are those of the gap that led to it.)
        this.gap(this.index);
        const { roll } = this;
        this.index += 1;
        const again = this.gap(this.index);
        this.next = at + again;
        this.roll = roll;
        this.at = at;
        return roll;
    }
}
