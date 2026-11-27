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
 * The chapters whose closing orbs park before their outgoing seam: chapter 1.
 *
 * Its last orb (the rival, L5) stands at the vent's lip, past where the sea starts to draw (the
 * continuous world draws from the 1->2 seam's start, odyssey-world-act-gate.js). Parked at the
 * orb, an Earth Core orb stood in chapter 2's water: the sea began one orb before its chapter
 * (2026-11-27). Parked before the seam it stands in the lava's light, and the sea arrives on
 * the glide to L6, the sea's first orb.
 *
 * Only chapter 1. The other chapters' closing orbs stand inside their outgoing seams too (L18,
 * L24-26, L47-48, L56), and each already shows its own world there: what changes across those
 * seams is composed around where these orbs park (the day turns between L18's park and L19's,
 * the hole is space's own sight, the fold's way out opens just past L56's park), with ibex, the
 * bow and the plunge's pace staged on the same parks. Moving them breaks those pictures.
 */
const CLOSING_ORBS_PARK_BEFORE_SEAM = new Set([1]);

/**
 * Where an ordinary orb selection parks the scenery. A chapter's opening orb sits on its own
 * seam (L6, L35, L49 and L57 sit exactly on b12, b56, b67 and b78), so parking at the orb put
 * the frame in full 1->2 steam, or with both chapters at full coverage, and at L35 the faded
 * world's edge cut through the orb's ring (audit 2026-10-18). An orb inside its chapter's
 * incoming seam parks as a chapter arrival does, and so does chapter 1's closing orb inside its
 * outgoing seam (CLOSING_ORBS_PARK_BEFORE_SEAM); the camera still focuses the orb itself.
 */
export function resolveOrbParkProgress(chapterId, levelProgress, chapterPositions) {
    if (!Number.isInteger(chapterId) || chapterId < 1 || !Number.isFinite(levelProgress)) return levelProgress;
    const start = chapterPositions?.[chapterId - 1];
    const end = chapterPositions?.[chapterId];
    const inIncomingSeam = chapterId > 1 && Number.isFinite(start)
        && levelProgress < start + seamHalfWidth(chapterId - 1);
    const inOutgoingSeam = CLOSING_ORBS_PARK_BEFORE_SEAM.has(chapterId) && Number.isFinite(end)
        && levelProgress > end - seamHalfWidth(chapterId);
    if (!inIncomingSeam && !inOutgoingSeam) return levelProgress;
    return resolveChapterArrivalProgress(chapterId, levelProgress, chapterPositions);
}
