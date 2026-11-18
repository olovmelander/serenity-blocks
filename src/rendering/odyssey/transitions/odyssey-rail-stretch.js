// @ts-check
/**
 * THE JOURNEY'S LONGER RAILS, TOGETHER (2026-11-18). Two stretches of the rail are longer in the
 * world than their share of progress: the fold inside the black hole (odyssey-fold-stretch.js,
 * chapter 7's middle) and the city (odyssey-city-stretch.js, chapter 8 after its seam). They never
 * overlap. What moves the eye at a world speed (the wheel, the idle drift, the follow camera's
 * look-ahead) reads both through this module; what belongs to one chapter (the fold's rooms, its
 * warp drive and rides, the plunge's travel measure) keeps reading its own.
 *
 * Pure and three-free.
 */
import {
    foldStretchArea,
    foldStretchRange,
    foldStretchRate,
} from './odyssey-fold-stretch.js';
import {
    cityStretchArea,
    cityStretchRange,
    cityStretchRate,
} from './odyssey-city-stretch.js';

/**
 * The stretches in absolute progress, in order (none without a usable layout).
 * @param {number[]|null|undefined} chapterPositions
 * @returns {{ a: number, b: number, s: number }[]}
 */
export function railStretchRanges(chapterPositions) {
    return [foldStretchRange(chapterPositions), cityStretchRange(chapterPositions)].filter(Boolean);
}

/**
 * How much more world a unit of progress covers at `p` than on open rail (1 outside both).
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number} >= 1
 */
export function railStretchRate(p, chapterPositions) {
    // (they never overlap, so at most one of the two is above 1)
    return foldStretchRate(p, chapterPositions) * cityStretchRate(p, chapterPositions);
}

/**
 * Both stretches' extra world up to `p`, in units of the journey's length.
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function railStretchArea(p, chapterPositions) {
    return foldStretchArea(p, chapterPositions) + cityStretchArea(p, chapterPositions);
}

/**
 * The world measure of progress over the whole journey: `p` plus every stretch's extra up to it.
 * Equal to `p` before the first stretch.
 * @param {number} p progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function railStretchMeasure(p, chapterPositions) {
    if (!Number.isFinite(p)) return p;
    return p + railStretchArea(p, chapterPositions);
}

/**
 * The progress at world measure `m` (the inverse of railStretchMeasure; monotone).
 * @param {number} m
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function railStretchProgress(m, chapterPositions) {
    const ranges = railStretchRanges(chapterPositions);
    if (!ranges.length || !Number.isFinite(m) || m <= ranges[0].a) return m;
    // The measure grows at least as fast as progress: the answer lies in [m - every extra, m].
    const whole = railStretchArea(ranges[ranges.length - 1].b, chapterPositions);
    let lo = m - whole - 1e-9;
    let hi = m;
    // Past the last stretch's end the measure is progress plus a constant.
    if (m >= ranges[ranges.length - 1].b + whole) return m - whole;
    for (let i = 0; i < 60; i += 1) {
        const mid = (lo + hi) / 2;
        if (railStretchMeasure(mid, chapterPositions) < m) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * Where a reach from `p` to `target` (progress) lands when it is measured in the world: `target`
 * itself wherever the reach touches no stretch (to the bit), otherwise the progress as far along
 * the longer rail as `target - p` is along open rail.
 * @param {number} p progress
 * @param {number} target progress
 * @param {number[]|null|undefined} chapterPositions
 * @returns {number}
 */
export function railStretchReach(p, target, chapterPositions) {
    if (!Number.isFinite(p) || !Number.isFinite(target)) return target;
    const lo = Math.min(p, target);
    const hi = Math.max(p, target);
    const touched = railStretchRanges(chapterPositions).some((r) => hi > r.a && lo < r.b);
    if (!touched) return target;
    return railStretchProgress(railStretchMeasure(p, chapterPositions) + (target - p), chapterPositions);
}
