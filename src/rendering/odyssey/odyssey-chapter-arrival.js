import { seamHalfWidth } from './transitions/odyssey-seam-schedule.js';

/** Frame chapter arrivals inside their scenery without moving the selected orb. */
export function resolveChapterArrivalProgress(chapterId, levelProgress, chapterPositions) {
    const start = chapterPositions?.[chapterId - 1];
    const end = chapterPositions?.[chapterId];
    if (!Number.isInteger(chapterId) || chapterId < 1
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start
        || !Number.isFinite(levelProgress)) return levelProgress;

    const hasIncomingSeam = chapterId > 1;
    const hasOutgoingSeam = chapterId < chapterPositions.length - 1;
    const incomingEnd = start + (hasIncomingSeam ? seamHalfWidth(chapterId - 1) : 0);
    const outgoingStart = end - (hasOutgoingSeam ? seamHalfWidth(chapterId) : 0);
    // Custom layouts can overlap their seams; never leave the requested chapter.
    if (outgoingStart <= incomingEnd) return Math.min(end, Math.max(start, levelProgress));

    const clearance = Math.min(0.001, (outgoingStart - incomingEnd) / 4);
    const minimum = incomingEnd + (hasIncomingSeam ? clearance : 0);
    const maximum = outgoingStart - (hasOutgoingSeam ? clearance : 0);
    return Math.min(maximum, Math.max(minimum, levelProgress));
}

/**
 * Where an ordinary orb selection parks the scenery. A chapter's opening orb sits on its own
 * seam (L6, L35, L49 and L57 sit exactly on b12, b56, b67 and b78), so parking at the orb put
 * the frame in full 1->2 steam, or with both chapters at full coverage, and at L35 the faded
 * world's edge cut through the orb's ring (audit 2026-10-18). An orb inside its chapter's
 * incoming seam parks as a chapter arrival does; the camera still focuses the orb itself.
 */
export function resolveOrbParkProgress(chapterId, levelProgress, chapterPositions) {
    const start = chapterPositions?.[chapterId - 1];
    if (!Number.isInteger(chapterId) || chapterId < 2
        || !Number.isFinite(start) || !Number.isFinite(levelProgress)
        || levelProgress >= start + seamHalfWidth(chapterId - 1)) return levelProgress;
    return resolveChapterArrivalProgress(chapterId, levelProgress, chapterPositions);
}
