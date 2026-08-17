/**
 * @fileoverview Pure statistics + phase summarisation for the Odyssey hitch harness.
 *
 * Extracted from scripts/odyssey-hitch-harness.mjs so the trust-critical part — how runs are
 * reduced to a headline number — is unit-testable without a GPU. The harness itself can only be
 * exercised on a working WebGPU device, which is exactly the thing that is unreliable when
 * perf work goes wrong, so the arithmetic must not depend on being able to run it.
 *
 * MEDIAN + IQR, never the mean: these distributions have hard outliers (a single 4 680 ms frame
 * was observed in one scroll pass), and a mean lets one such frame dictate the conclusion.
 */

/**
 * Linear-interpolated quantile over an ASCENDING-sorted array.
 * @param {number[]} sorted ascending values
 * @param {number} q quantile in [0, 1]
 * @returns {?number} the quantile, or null for an empty input
 */
export function quantile(sorted, q) {
    if (!Array.isArray(sorted) || sorted.length === 0) return null;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Reduce a set of runs to median/IQR for one metric. Non-finite values (a failed or missing
 * measurement) are dropped rather than coerced to 0 — a failed run must never be able to pull a
 * median toward "fast".
 * @param {object[]} runs run records
 * @param {(run: object) => (number|null|undefined)} pick metric selector
 * @returns {?{n:number, median:number, p25:number, p75:number, min:number, max:number}}
 */
export function aggregate(runs, pick) {
    const vals = (runs || [])
        .map(pick)
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b);
    if (!vals.length) return null;
    return {
        n: vals.length,
        median: Math.round(quantile(vals, 0.5)),
        p25: Math.round(quantile(vals, 0.25)),
        p75: Math.round(quantile(vals, 0.75)),
        min: vals[0],
        max: vals[vals.length - 1],
    };
}

/**
 * Summarise the recorded rAF gaps for one scroll phase.
 * @param {Array<{ms:number, phase:string}>} gaps recorded gaps
 * @param {string} phase phase name ('forward' | 'backward' | 'boot')
 * @returns {{gaps50:number, gaps100:number, worstMs:number, totalStallMs:number}}
 */
export function summarizePhase(gaps, phase) {
    const g = (gaps || []).filter((x) => x && x.phase === phase && Number.isFinite(x.ms));
    return {
        gaps50: g.length,
        gaps100: g.filter((x) => x.ms > 100).length,
        worstMs: Math.round(g.reduce((m, x) => Math.max(m, x.ms), 0)),
        totalStallMs: Math.round(g.reduce((s, x) => s + x.ms, 0)),
    };
}

/**
 * Do two variants' IQRs overlap? Overlapping IQRs mean the sample does NOT resolve the change —
 * the honest answer is "add runs", not "it got better". The harness prints this so a reader is
 * not left eyeballing two medians.
 * @param {?{p25:number,p75:number}} a first aggregate
 * @param {?{p25:number,p75:number}} b second aggregate
 * @returns {boolean} true when the ranges overlap (or either is missing)
 */
export function iqrOverlaps(a, b) {
    if (!a || !b) return true;
    return a.p25 <= b.p75 && b.p25 <= a.p75;
}

export default {
    quantile, aggregate, summarizePhase, iqrOverlaps,
};
