// @ts-check
/**
 * THE CITY IS LONGER (2026-11-18). The owner: "I also want to lengthen the urban dreams encore so
 * we have a bit longer between the orbs in that chapter and travel a bit longer into that chapter."
 *
 * Chapter 8 is lengthened the way the fold was (odyssey-fold-stretch.js): progress `p` is arc
 * length over the whole journey and hundreds of things are placed by it, so the chapter cannot
 * take a larger share of it. Instead the rail through the city is LONGER IN THE WORLD than its
 * share of progress: from `from` (chapter 8's local progress) to the journey's end, a unit of
 * progress covers `rate` times the world it covers elsewhere, eased up over a `shoulder`.
 *
 * Unlike the fold, the city's stretch has no far end to rejoin (the rail ends at the last orb), so
 * its rail is not a detour: it is today's rail CARRIED ON FURTHER, the same direction at the same
 * progress, only each unit of progress `rate` times as long (odyssey-path-stretch.js). The camera's
 * frames, the city's stage basis and every direction are today's to the bit; the eye travels
 * further down the boulevard toward the spire. The city itself stays where it was authored
 * (anchored on today's rail: path-utils getChapterPathRange), so the 7 -> 8 seam, the Retrosun the
 * hole's sun is carried onto, and the arrival at orb 57 are unchanged.
 *
 * Why it starts at local 0.44: the 7 -> 8 seam runs to local ~0.414 (its half width 0.0162 of the
 * chapter's 0.0391), and orb 57 (on the boundary) parks just after it (~0.4399): the stretch begins
 * past that park, so the way out of the hole and the arrival in the city see today's rail.
 *
 * Pure and three-free, like the fold's schedule.
 */

export const CH8_CITY_STRETCH = Object.freeze({
    /** Chapter 8's local progress where the stretch begins (it runs to the journey's end). */
    from: 0.44,
    /** World covered per unit of progress once the stretch is under way, against the rest. */
    rate: 2.5,
    /** Progress over which the rate eases up from 1. */
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
 * The stretch in absolute progress: from `a` to the end of chapter 8 (`b`, the journey's end).
 * @param {number[]|null|undefined} chapterPositions the live chapter boundaries
 * @returns {{ a: number, b: number, s: number }|null} null without a usable layout
 */
export function cityStretchRange(chapterPositions) {
    const ch8 = chapterPositions?.[7];
    const end = chapterPositions?.[8] ?? (Number.isFinite(ch8) ? 1 : undefined);
    if (!Number.isFinite(ch8) || !Number.isFinite(end) || !(end > ch8)) return null;
    const a = ch8 + ((end - ch8) * CH8_CITY_STRETCH.from);
    const b = end;
    if (!(b > a)) return null;
    const s = Math.min(CH8_CITY_STRETCH.shoulder, (b - a) / 3);
    return { a, b, s };
}

/**
 * How much more world a unit of progress covers at `p` than elsewhere: 1 before the stretch,
 * easing (smoothstep) up to `rate` over the shoulder, then `rate` to the journey's end.
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number} >= 1
 */
export function cityStretchRate(p, chapterPositions) {
    const r = cityStretchRange(chapterPositions);
    if (!r || !Number.isFinite(p) || p <= r.a || p > r.b) return 1;
    return 1 + ((CH8_CITY_STRETCH.rate - 1) * smooth01((p - r.a) / r.s));
}

/**
 * The stretch's extra world up to `p`, in units of the journey's length: the integral of
 * (rate - 1) from the stretch's start (0 before it, its whole extra at the journey's end).
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function cityStretchArea(p, chapterPositions) {
    const r = cityStretchRange(chapterPositions);
    if (!r || !Number.isFinite(p) || p <= r.a) return 0;
    const { a, b, s } = r;
    const x = Math.min(p, b);
    const bump = x <= a + s ? s * smoothArea((x - a) / s) : (s / 2) + (x - (a + s));
    return (CH8_CITY_STRETCH.rate - 1) * bump;
}
