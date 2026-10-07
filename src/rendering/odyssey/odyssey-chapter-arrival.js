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
