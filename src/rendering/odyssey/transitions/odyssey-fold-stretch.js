// @ts-check
/**
 * THE FOLD IS LONGER (2026-11-17). The owner: "can we make inside the black hole longer and spread
 * out the orbs more so it is a longer experience inside the black hole!!!"
 *
 * Progress `p` is arc length over the whole journey, and hundreds of things are placed by it, so
 * chapter 7 cannot simply take a larger share of it. Instead the rail inside the hole is LONGER IN
 * THE WORLD than its share of progress: between `from` and `to` (chapter 7's local progress) the
 * rail leaves today's line and climbs a wide spiral before it rejoins it (odyssey-path-stretch.js
 * builds it), so a unit of progress there covers `rate` times the world it covers elsewhere.
 * Outside that stretch the rail is today's to the bit, so the dive, the exit and every other
 * chapter are untouched.
 *
 * This module is the stretch's schedule, pure and three-free: where it is, how much world a unit
 * of progress covers at each point (`foldStretchRate`: 1 outside, easing up to `rate` over a
 * `shoulder` at each end, so the eye's world speed never jumps), and the WORLD MEASURE of progress
 * (`foldStretchMeasure`: progress plus the stretch's extra world, in units of the journey's
 * length) that travel, the wheel, the drift and the fold's rooms run on.
 *
 * Why [0.5678, 0.7900] of the chapter: before it the camera's 6->7 hairpin chord reads path points
 * up to ~0.56 of the chapter (OdysseyCameraController HAIRPIN_67), and after it comes the 7->8
 * seam, where the mouth opens onto the city (from ~0.82, and the camera's settling just before):
 * both must see today's rail.
 */

export const CH7_FOLD_STRETCH = Object.freeze({
    /** Chapter 7's local progress where the stretch begins and ends (0.922 and 0.942 today). */
    from: 0.5678,
    to: 0.7900,
    /** World covered per unit of progress in the stretch's middle, against the rest of the rail. */
    rate: 15,
    /** Progress over which the rate eases up from 1 at each end. */
    shoulder: 0.0025,
});

const smooth01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/** The integral of smooth01 from 0 to x (x in 0..1): x^3 - x^4 / 2. */
const smoothArea = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return (t * t * t) - ((t * t * t * t) / 2);
};

/**
 * The stretch in absolute progress.
 * @param {number[]|null|undefined} chapterPositions the live chapter boundaries
 * @returns {{ a: number, b: number, s: number }|null} null without a usable layout
 */
export function foldStretchRange(chapterPositions) {
    const ch7 = chapterPositions?.[6];
    const ch8 = chapterPositions?.[7];
    if (!Number.isFinite(ch7) || !Number.isFinite(ch8) || !(ch8 > ch7)) return null;
    const span = ch8 - ch7;
    const a = ch7 + (span * CH7_FOLD_STRETCH.from);
    const b = ch7 + (span * CH7_FOLD_STRETCH.to);
    const s = Math.min(CH7_FOLD_STRETCH.shoulder, (b - a) / 3);
    return { a, b, s };
}

/**
 * How much more world a unit of progress covers at `p` than elsewhere on the rail: 1 outside the
 * stretch, `rate` in its middle, eased (smoothstep) over the shoulders.
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number} >= 1
 */
export function foldStretchRate(p, chapterPositions) {
    const r = foldStretchRange(chapterPositions);
    if (!r || !Number.isFinite(p) || p <= r.a || p >= r.b) return 1;
    const bump = smooth01((p - r.a) / r.s) * (1 - smooth01((p - (r.b - r.s)) / r.s));
    return 1 + ((CH7_FOLD_STRETCH.rate - 1) * bump);
}

/**
 * The stretch's extra world up to `p`, in units of the journey's length: the integral of
 * (rate - 1) from the stretch's start (0 before it, its whole extra after it).
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function foldStretchArea(p, chapterPositions) {
    const r = foldStretchRange(chapterPositions);
    if (!r || !Number.isFinite(p) || p <= r.a) return 0;
    const k = CH7_FOLD_STRETCH.rate - 1;
    const { a, b, s } = r;
    const x = Math.min(p, b);
    let bump;
    if (x <= a + s) {
        bump = s * smoothArea((x - a) / s);
    } else if (x <= b - s) {
        bump = (s / 2) + (x - (a + s));
    } else {
        const t = (x - (b - s)) / s;
        bump = (s / 2) + ((b - s) - (a + s)) + (s * (t - smoothArea(t)));
    }
    return k * bump;
}

/**
 * The world measure of progress: `p` plus the stretch's extra world up to it (units of the
 * journey's length). Equal to `p` before the stretch; it grows `rate` times as fast inside.
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function foldStretchMeasure(p, chapterPositions) {
    if (!Number.isFinite(p)) return p;
    return p + foldStretchArea(p, chapterPositions);
}

/**
 * The progress at world measure `m` (the inverse of foldStretchMeasure; monotone).
 * @param {number} m
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function foldStretchProgress(m, chapterPositions) {
    const r = foldStretchRange(chapterPositions);
    if (!r || !Number.isFinite(m) || m <= r.a) return m;
    const extra = foldStretchArea(r.b, chapterPositions);
    if (m >= r.b + extra) return m - extra;
    let lo = r.a;
    let hi = r.b;
    for (let i = 0; i < 60; i += 1) {
        const mid = (lo + hi) / 2;
        if (foldStretchMeasure(mid, chapterPositions) < m) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * Where a reach from `p` to `target` (progress) lands when it is measured in the world: `target`
 * itself wherever the reach does not touch the stretch (to the bit), otherwise the progress as far
 * along the stretched rail as `target - p` is along today's.
 * @param {number} p progress
 * @param {number} target progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function foldStretchReach(p, target, chapterPositions) {
    const r = foldStretchRange(chapterPositions);
    if (!r || !Number.isFinite(p) || !Number.isFinite(target)) return target;
    if (Math.max(p, target) <= r.a || Math.min(p, target) >= r.b) return target;
    return foldStretchProgress(foldStretchMeasure(p, chapterPositions) + (target - p), chapterPositions);
}
