/**
 * @fileoverview THE SEAM SCHEDULE — one place that answers "where is each chapter seam, and how
 * does each side of it fade", for every system that crosses a boundary (camera framing, the
 * chapter environment fades, the post lens/crush terms, the corridor field).
 *
 * Why it exists (seamless pass, 2026-10-02). Every seam defect the audit found had the same
 * shape: a system that switched on a DIFFERENT signal than its neighbours — the camera framing
 * on the active-chapter flip, the post lens on the same flip, the corridor windows on p-values
 * authored for a layout two re-spacings ago. A seam is seamless when everything that changes
 * across it is a continuous function of the same progress window, so this module owns that
 * window and the shapes drawn over it.
 *
 * Everything here is a pure function of progress + the live chapter boundaries.
 */

import { DEFAULT_BOARD_TRANSITION } from '../../../core/odyssey/data/chapters.js';
import { getChapterTransitionForChapter } from '../chapter-environments/shared/chapter-profile.js';
import { getOdysseyPathCurve } from '../path-utils.js';

function clamp01(value) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** @param {number} x @returns {number} smoothstep on [0, 1] */
export function smooth01(x) {
    const t = clamp01(x);
    return t * t * (3 - 2 * t);
}

/** @param {number} x @returns {number} smootherstep on [0, 1] */
export function smoother01(x) {
    const t = clamp01(x);
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * The seam half-width (the ecotone / co-presence window) for the boundary LEAVING `sourceChapter`.
 * Resolved exactly like ChapterEnvironmentManager.getChapterBoardTransition (pinned by test), so
 * the camera, the fades and the post all agree with the manager's blend state by construction.
 * @param {number} sourceChapter 1-based chapter id on the near side of the boundary
 * @returns {number} half-width in progress units
 */
export function seamHalfWidth(sourceChapter) {
    const transition = {
        ...DEFAULT_BOARD_TRANSITION,
        ...getChapterTransitionForChapter(sourceChapter),
    };
    return Math.max(0.001, transition.seamWidth || DEFAULT_BOARD_TRANSITION.seamWidth);
}

/**
 * The seam window containing `progress`, or null. Same windows as resolveChapterBlendState.
 * @param {number} progress 0..1
 * @param {number[]} chapterPositions [0, b12, b23, ..., 1]
 * @returns {{source:number, target:number, boundary:number, halfWidth:number,
 *            start:number, end:number, t:number}|null} `t` is linear 0..1 across the window
 */
export function seamWindowAt(progress, chapterPositions) {
    if (!Array.isArray(chapterPositions) || !Number.isFinite(progress)) return null;
    const last = chapterPositions.length - 1;
    for (let source = 1; source < last; source += 1) {
        const boundary = chapterPositions[source];
        if (!Number.isFinite(boundary)) continue;
        const halfWidth = seamHalfWidth(source);
        const start = boundary - halfWidth;
        const end = boundary + halfWidth;
        if (progress < start || progress > end) continue;
        return {
            source,
            target: source + 1,
            boundary,
            halfWidth,
            start,
            end,
            t: clamp01((progress - start) / (end - start)),
        };
    }
    return null;
}

/**
 * STAGGERED FADES for OPAQUE content (the coverage fix). A symmetric crossfade of two opaque
 * chapters forced transparent leaves coverage 1-(1-a)(1-b) = 0.75 at the midpoint, so whatever
 * is behind both — the clear colour, another chapter's sky — shows through (the audit's stars
 * through the black hole at p 0.8589). Staggered, the incoming chapter is fully present by the
 * boundary and the outgoing one only starts leaving there, so coverage never drops below 1.
 * @param {number} t linear 0..1 across the seam window (0.5 = the boundary)
 * @returns {number} incoming opacity: 0 -> 1 over [0, 0.5], 1 after
 */
export function staggeredIncoming(t) {
    return smooth01(clamp01(t) * 2);
}

/**
 * @param {number} t linear 0..1 across the seam window (0.5 = the boundary)
 * @returns {number} outgoing opacity: 1 until 0.5, then 1 -> 0 over [0.5, 1]
 */
export function staggeredOutgoing(t) {
    return smooth01((1 - clamp01(t)) * 2);
}

let cachedArcLength = null;

/**
 * Total arc length of the live journey spline, in world units (cached; the board re-layout
 * path calls `resetSeamScheduleCache()`).
 * @returns {number}
 */
export function journeyArcLength() {
    if (cachedArcLength === null) {
        const length = getOdysseyPathCurve()?.getLength?.();
        cachedArcLength = Number.isFinite(length) && length > 0 ? length : 2532.64;
    }
    return cachedArcLength;
}

/** Drop the cached arc length (after a layout override rebuilt the path). */
export function resetSeamScheduleCache() {
    cachedArcLength = null;
}

/**
 * WORLD UNITS -> PROGRESS. `p` is arc-normalised over the whole curve, so a window authored as
 * a p-delta silently changes world size every time the journey is re-laid out (the steam
 * quench's 0.06 went from 106 u to 152 u; the corridor's 0.045 overlaps from 80 u to 114 u).
 * Windows that are about DISTANCE — how far ahead something appears, how long a bank lasts —
 * are authored in world units and converted here.
 * @param {number} arcUnits world units along the rail
 * @returns {number} progress delta
 */
export function arcToP(arcUnits) {
    return (Number.isFinite(arcUnits) ? arcUnits : 0) / journeyArcLength();
}

/**
 * @param {number} p progress delta
 * @returns {number} world units along the rail
 */
export function pToArc(p) {
    return (Number.isFinite(p) ? p : 0) * journeyArcLength();
}
