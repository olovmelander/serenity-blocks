/**
 * Sunset — the weather, and the small things that happen by themselves (CPU only, three-free).
 *
 * The day (sunset-hours.js) turns the light. Beside it a second clock turns the WEATHER, a
 * function of the world's clock and nothing else, so a seek, a replay and a rebuild that carries
 * the clock all agree:
 *
 *   trade      the trade-wind sky the theme opens on: a broken deck running in toward the sunset,
 *              cirrus over it, a steady breeze on the water
 *   towers     heaps of cloud standing along the horizon on flat bases, the deck thinner; at dusk
 *              and by night lightning flickers inside the far ones, without a sound
 *   mackerel   a fuller, finer deck, rippled like a mackerel's back (the widest fire at sunset),
 *              a fresher wind and a livelier sea
 *   clear      hardly a cloud, the air washed clean to the horizon, the sea near glass: the
 *              sharpest sun, the most stars
 *   veil       high thin cloud over everything: the light spreads wide round the sun and the
 *              moon and a ring stands round them, the distance goes soft, the stars are few
 *
 * A weather lasts SKY_PERIOD seconds, resting for a share of it and then melting into the next.
 * Five of them come round in 470 s against the day's 565 s, so the same hour meets a different
 * sky each time: the two are back in step only after more than fifteen hours of play.
 *
 * And now and then something happens on its own: a shooting star in a dark sky, a flicker of
 * lightning in a far tower, a few gulls crossing. When each falls is dealt from a seed by its
 * number, so those are functions of the clock too.
 */
import { clamp01, mulberry32 } from './sunset-core.js';

const quintic = (k) => k * k * k * (k * (k * 6 - 15) + 10);

/** Seconds a weather lasts, and the share of that it rests before it begins to turn. */
export const SKY_PERIOD = 94;
export const SKY_REST = 0.4;

/**
 * The weathers, in the order they come round.
 *
 *   cover   added to the hour's cloud cover (the deck)
 *   mackerel  how far the deck is broken into small cells, row on row (0..1)
 *   cirrus  the high cloud, against the theme's own
 *   bars    the bars low over the sea, likewise
 *   towers  how much of the horizon the towers of cloud take (0..1)
 *   veil    the high thin veil (0..1)
 *   haze    how far the eye sees over the sea, against the theme's own
 *   chop    the wind's chop on the water, likewise
 */
export const SKIES = Object.freeze([
    {
        name: 'trade', cover: 0, mackerel: 0, cirrus: 1, bars: 1, towers: 0, veil: 0, haze: 1, chop: 1,
    },
    {
        name: 'towers', cover: -0.14, mackerel: 0, cirrus: 0.55, bars: 0.45, towers: 1, veil: 0, haze: 1.25, chop: 0.8,
    },
    {
        name: 'mackerel', cover: 0.2, mackerel: 1, cirrus: 0.35, bars: 1, towers: 0.3, veil: 0, haze: 1, chop: 1.35,
    },
    {
        name: 'clear', cover: -0.36, mackerel: 0, cirrus: 0.3, bars: 0.3, towers: 0.14, veil: 0, haze: 1.8, chop: 0.42,
    },
    {
        name: 'veil', cover: -0.2, mackerel: 0, cirrus: 1.7, bars: 0.8, towers: 0, veil: 1, haze: 0.68, chop: 0.62,
    },
].map((sky) => Object.freeze(sky)));

/** The numbers a weather carries. */
export const SKY_KEYS = Object.freeze(['cover', 'mackerel', 'cirrus', 'bars', 'towers', 'veil', 'haze', 'chop']);

/**
 * How far the weather's clock has turned at `time`, in whole weathers: it rests on each for
 * SKY_REST of its period, then melts into the next over what is left. Never back, never a jump.
 */
export function skyDrift(time, period = SKY_PERIOD, rest = SKY_REST) {
    const t = Math.max(0, Number.isFinite(time) ? time : 0) / period;
    const whole = Math.floor(t);
    return whole + quintic(clamp01((t - whole - rest) / (1 - rest)));
}

/**
 * The weather at a phase (any real number: the table comes round): every number of SKY_KEYS
 * mixed between the two weathers it stands between, `name` (the nearer one), `next` and `mix`.
 */
export function skyAt(phase, out = {}) {
    const n = SKIES.length;
    const p = (((Number.isFinite(phase) ? phase : 0) % n) + n) % n;
    const i = Math.floor(p) % n;
    const f = p - Math.floor(p);
    const a = SKIES[i];
    const b = SKIES[(i + 1) % n];
    for (let k = 0; k < SKY_KEYS.length; k += 1) {
        const key = SKY_KEYS[k];
        out[key] = a[key] + (b[key] - a[key]) * f;
    }
    out.name = f < 0.5 ? a.name : b.name;
    out.next = f < 0.5 ? b.name : a.name;
    out.mix = f;
    return out;
}

/** The phase that holds the weather on the one called `name` (or on a number), else null. */
export function skyPhaseOf(name) {
    if (name === null || name === undefined || name === '') return null;
    const at = SKIES.findIndex((sky) => sky.name === name);
    if (at >= 0) return at;
    const n = Number(name);
    return Number.isFinite(n) ? n : null;
}

// ── Now and then ────────────────────────────────────────────────────────────────

/**
 * Things that happen by themselves: the n-th one falls at a time dealt from the seed by its
 * number, `every[0]..every[1]` seconds after the one before. `due(clock)` hands out each one
 * once, in order, as the clock passes it (a clock that jumped far ahead is caught up without a
 * burst: only the last one due is handed out).
 */
export class NowAndThen {
    /**
     * @param {object} p
     * @param {number} p.seed
     * @param {number[]} p.every   [shortest, longest] seconds between two
     * @param {number} [p.first]   the earliest the first may fall
     */
    constructor({ seed, every, first = 0 }) {
        this.seed = seed >>> 0;
        this.every = every;
        this.first = first;
        this.restart(0);
    }

    /** Start over from `clock` (a seek): the first falls a while after it. */
    restart(clock) {
        this.rand = mulberry32(this.seed);
        this.index = 0;
        this.next = Math.max(0, clock) + this.first + this.gap();
    }

    gap() {
        const [lo, hi] = this.every;
        return lo + (hi - lo) * this.rand();
    }

    /**
     * Is one due at `clock`? Returns its number (0, 1, 2 …) and deals the next, or -1. `roll`
     * (0..1) comes with it in `this.roll`: a number of its own for whoever stages it.
     */
    due(clock) {
        if (clock < this.next) return -1;
        let n = -1;
        // Catch up without a burst.
        for (let guard = 0; guard < 64 && clock >= this.next; guard += 1) {
            n = this.index;
            this.index += 1;
            this.roll = this.rand();
            this.next += this.gap();
        }
        if (clock >= this.next) this.next = clock + this.gap();
        return n;
    }
}
