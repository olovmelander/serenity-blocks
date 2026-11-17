// @ts-check
/**
 * THE BREACH TAKES ITS TIME (Odyssey masterpiece pass, 2026-11-17) — the journey's travel
 * measure, with the surface of the sea in it.
 *
 * A trip between orbs eases over about a second, and the eye crossed the surface of the sea in
 * the middle of the 10 -> 11 trip, where the ease runs fastest: filmed, the water was in one
 * frame and the island in the next (0.1 s). The breach was a cut inside a glide.
 *
 * The black hole's plunge had the same fault and its cure is the model (CH7_PLUNGE_TRAVEL): a
 * trip eases in a travel MEASURE rather than in progress, and the measure weighs some stretches
 * more than open path, so the trip slows there. This module adds the breach to that measure:
 *   - the last metres under the surface and the first over it weigh `dwell` (the surface rushing
 *     up, then the climb out of the spray);
 *   - the crossing itself is a beat: a Gaussian of extra weight on the eye's own crossing
 *     (ODYSSEY_BREACH_P), so the lens hangs at the waterline for a moment, half in each world,
 *     before the air takes it;
 *   - a short trip through it is given `extraMs` more, fading out for long trips (they have
 *     seconds of their own).
 * The same holds going down (orb 11 back to 10 is a dive in).
 *
 * The camera controller eases its trips in `journeyTravelMeasure` (the plunge's measure plus the
 * breach's), and the board adds `journeyTravelExtraMs`. Pure.
 */
import { ODYSSEY_BREACH_P } from '../world/odyssey-world-height.js';
import {
    plungeTravelExtraMs, plungeTravelMeasure, plungeTravelTouches,
} from './odyssey-black-hole-fall.js';

export const BREACH_TRAVEL = Object.freeze({
    /** How much more a unit of progress near the surface weighs than open path. */
    dwell: 4,
    /** The weighted stretch: this much progress before the eye crosses, and after. */
    before: 0.0075,
    after: 0.0045,
    /** Progress over which that weight eases in and out. */
    shoulder: 0.003,
    /** The beat at the waterline: extra weight in a Gaussian `beatWidth` of progress wide. */
    beatDwell: 26,
    beatWidth: 0.0011,
    /** Time added to a trip that crosses the whole stretch... */
    extraMs: 1700,
    /** ...in full up to this trip length (progress), fading to none by `longTrip + longFade`. */
    longTrip: 0.05,
    longFade: 0.12,
});

const SAMPLES = 1024;
const smooth01 = (x) => {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - (2 * t));
};

/** @type {{ at: number, lo: number, hi: number, step: number, area: Float64Array }|null} */
let table = null;

/** The breach's extra weight over open path, integrated once (per crossing progress). */
function breachTable(at = ODYSSEY_BREACH_P) {
    if (table && table.at === at) return table;
    const T = BREACH_TRAVEL;
    const from = at - T.before;
    const to = at + T.after;
    const lo = from - T.shoulder;
    const hi = to + T.shoulder;
    const extra = (p) => ((T.dwell - 1) * smooth01((p - lo) / T.shoulder) * (1 - smooth01((p - to) / T.shoulder)))
        + (T.beatDwell * Math.exp(-(((p - at) / T.beatWidth) ** 2)));
    const step = (hi - lo) / SAMPLES;
    const area = new Float64Array(SAMPLES + 1);
    let prev = extra(lo);
    for (let i = 1; i <= SAMPLES; i += 1) {
        const next = extra(lo + (i * step));
        area[i] = area[i - 1] + ((prev + next) * 0.5 * step);
        prev = next;
    }
    table = {
        at, lo, hi, step, area,
    };
    return table;
}

/** The breach's share of the measure up to progress `p` (0 before the stretch, its whole area after). */
export function breachTravelArea(p, at = ODYSSEY_BREACH_P) {
    const t = breachTable(at);
    if (!Number.isFinite(p) || p <= t.lo) return 0;
    if (p >= t.hi) return t.area[SAMPLES];
    const x = (p - t.lo) / t.step;
    const i = Math.min(SAMPLES - 1, Math.floor(x));
    return t.area[i] + ((t.area[i + 1] - t.area[i]) * (x - i));
}

/**
 * The journey's travel measure at progress `p`: progress plus the plunge's and the breach's extra
 * weight up to it (monotone, so it inverts). A trip eased in this measure slows at both.
 * @param {number} p path progress
 * @param {number[]} chapterPositions live chapter boundaries
 * @returns {number}
 */
export function journeyTravelMeasure(p, chapterPositions) {
    if (!Number.isFinite(p)) return p;
    return plungeTravelMeasure(p, chapterPositions) + breachTravelArea(p);
}

/**
 * The progress at travel measure `m` (the inverse of journeyTravelMeasure).
 * @param {number} m
 * @param {number[]} chapterPositions
 * @returns {number}
 */
export function journeyTravelProgress(m, chapterPositions) {
    if (!Number.isFinite(m)) return m;
    // Before the first weighted stretch the measure IS progress: exactly, not to a bisection's
    // last bit (a trip held at its start must read its start).
    if (journeyTravelMeasure(m, chapterPositions) === m) return m;
    // The measure grows at least as fast as progress: the answer lies in [m - all the extra, m].
    let hi = m;
    let lo = m - (journeyTravelMeasure(1, chapterPositions) - 1) - 1e-9;
    for (let i = 0; i < 52; i += 1) {
        const mid = (lo + hi) / 2;
        if (journeyTravelMeasure(mid, chapterPositions) < m) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** Whether a trip between `p0` and `p1` passes through the breach's weighted stretch. */
export function breachTravelTouches(p0, p1) {
    if (!Number.isFinite(p0) || !Number.isFinite(p1)) return false;
    const t = breachTable();
    return Math.max(p0, p1) > t.lo && Math.min(p0, p1) < t.hi;
}

/** Whether a trip passes through any weighted stretch (the plunge's or the breach's). */
export function journeyTravelTouches(p0, p1, chapterPositions) {
    return plungeTravelTouches(p0, p1, chapterPositions) || breachTravelTouches(p0, p1);
}

/**
 * The time a trip between `p0` and `p1` is given for the breach, on top of its own (ms).
 * @returns {number}
 */
export function breachTravelExtraMs(p0, p1) {
    if (!Number.isFinite(p0) || !Number.isFinite(p1)) return 0;
    const T = BREACH_TRAVEL;
    const t = breachTable();
    const lo = Math.min(p0, p1);
    const hi = Math.max(p0, p1);
    // By the share of the stretch's weight the trip crosses (the beat is most of it).
    const whole = t.area[SAMPLES];
    const share = whole > 0 ? (breachTravelArea(hi) - breachTravelArea(lo)) / whole : 0;
    const short = 1 - smooth01(((hi - lo) - T.longTrip) / T.longFade);
    return T.extraMs * share * short;
}

/** The time a trip is given on top of its own for every weighted stretch it crosses (ms). */
export function journeyTravelExtraMs(p0, p1, chapterPositions) {
    return plungeTravelExtraMs(p0, p1, chapterPositions) + breachTravelExtraMs(p0, p1);
}
