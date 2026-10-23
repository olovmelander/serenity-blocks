// @ts-check
/**
 * @fileoverview THE PATH VANISHES INTO THE HOLE (2026-10-22).
 *
 * Olov: "hide the path beyond chapter 6 so it seems to vanish into the hole". From chapter 6 the
 * rail past the 6->7 boundary — chapter 7's hairpin climb, and chapter 8's beyond it — drew as a
 * thin line up and across the black hole's side. It is the real path, but it read as the journey
 * going PAST the hole, and the hole cannot sit on it (chapter 7 keeps the hole camera-locked).
 *
 * So through chapter 6 the rail ends at the boundary, tapering out just past chapter 7's first
 * node (which sits on it), in the middle of the hole, and the nodes beyond it are not drawn. The
 * far rail retracts across the 5->6 seam (behind the cloud bank, so nothing is seen to move).
 *
 * NOTHING BEHIND THE HOLE BEFORE WE ARE IN IT (2026-10-22, third pass). Olov: "I dont want to see
 * any of the path behind it before we really get into the black hole." Chapter 7's plunge now
 * happens on the glide from that first node (the mouth) to the next (odyssey-black-hole-fall.js),
 * and the rail stays ended at the mouth until the eye is wholly inside the hole. Only then is the
 * rest of the journey laid out, swept up the tunnel and on to the city, finishing as the eye
 * reaches the next node. A player parked on any node sees a whole picture: the rail into the
 * hole, or the way on inside it.
 *
 * One schedule of progress, read by the ribbon (its radius collapses past the horizon) and by the
 * level nodes (they scale out the same way), so the two can never disagree. Pure: no three.js.
 */
import { getChapterTransitionForChapter } from './chapter-environments/shared/chapter-profile.js';
import { resolveBlackHoleInsideProgress } from './transitions/odyssey-black-hole-fall.js';

export const ODYSSEY_PATH_HORIZON = Object.freeze({
    // The chapter whose end the rail vanishes into (1-indexed): 6, Space.
    chapter: 6,
    // The taper before the horizon, in progress (~15 u of path): the nodes scale out over it.
    soft: 0.006,
    // The rail itself ends within this much of the taper's start (~4.5 u, inside the last node's
    // glass), where the inflow carries it on into the hole (odyssey-path-inflow.js).
    railSoft: 0.0018,
    // Without a fall schedule or node positions: the way on is laid out over this fraction of the
    // outgoing seam half-width, ending at the boundary.
    revealFraction: 0.3,
});

/** A horizon past the journey's end: nothing is hidden. */
export const PATH_HORIZON_OPEN = 2;

// Where the retract starts and the reveal ends: just past the journey's end (1) plus the taper,
// so the sweep's ends never hide anything.
const HORIZON_FAR = 1 + (ODYSSEY_PATH_HORIZON.soft * 2);

function smooth01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
}

/**
 * Where the way on is laid out: from the eye being inside the hole to the next node (the path
 * inflow, odyssey-path-inflow.js, hands over to the real rail on the same stretch).
 * @param {number[]} chapterPositions the active layout's chapter starts
 * @param {number[]|null} [levelPositions] the layout's node positions
 * @returns {{ start: number, end: number }|null} null for an unknown layout
 */
export function resolveOdysseyPathReveal(chapterPositions, levelPositions = null) {
    const H = ODYSSEY_PATH_HORIZON;
    const start = chapterPositions?.[H.chapter - 1];
    const end = chapterPositions?.[H.chapter];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const wOut = getChapterTransitionForChapter(H.chapter)?.seamWidth ?? 0.0222;
    const inside = resolveBlackHoleInsideProgress(chapterPositions);
    if (!Number.isFinite(inside)) {
        // No fall schedule: laid out over the end of the chapter.
        return { start: end - (wOut * H.revealFraction), end };
    }
    let next = null;
    if (Array.isArray(levelPositions)) {
        levelPositions.forEach((x) => {
            if (x > inside + 1e-6 && (next === null || x < next)) next = x;
        });
    }
    // No node past the inside point: laid out just after it.
    return { start: inside, end: next ?? inside + (wOut * H.revealFraction) };
}

/**
 * The path progress past which the rail and its nodes are not drawn, for the eye at `progress`.
 * @param {number} progress camera path progress
 * @param {number[]} chapterPositions the active layout's chapter starts
 * @param {number[]|null} [levelPositions] the layout's node positions (the way on is laid out by
 *   the first node past the point where the eye is inside the hole)
 * @returns {number} horizon progress (PATH_HORIZON_OPEN when nothing is hidden)
 */
export function resolveOdysseyPathHorizon(progress, chapterPositions, levelPositions = null) {
    const H = ODYSSEY_PATH_HORIZON;
    const start = chapterPositions?.[H.chapter - 1];
    const end = chapterPositions?.[H.chapter];
    if (!Number.isFinite(progress) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return PATH_HORIZON_OPEN;
    }
    // Seam k sits between chapters k and k+1 and takes chapter k's transition.
    const wIn = getChapterTransitionForChapter(H.chapter - 1)?.seamWidth ?? 0.0222;
    const held = end + H.soft;
    if (progress <= start - wIn) return PATH_HORIZON_OPEN;
    if (progress < start + wIn) {
        return HORIZON_FAR + ((held - HORIZON_FAR) * smooth01((progress - (start - wIn)) / (2 * wIn)));
    }
    // The way on is laid out from the moment the eye is inside the hole to the next node.
    const reveal = resolveOdysseyPathReveal(chapterPositions, levelPositions);
    if (progress <= reveal.start) return held;
    if (progress >= reveal.end) return PATH_HORIZON_OPEN;
    return held + ((HORIZON_FAR - held) * smooth01((progress - reveal.start) / (reveal.end - reveal.start)));
}

/**
 * How much of the rail (or a node) at path position `x` is drawn under `horizon`: 1 up to the
 * taper, 0 past the horizon. The ribbon shader evaluates the same smoothstep.
 * @param {number} x path progress of the point
 * @param {number} horizon from resolveOdysseyPathHorizon
 * @returns {number} 0..1
 */
export function odysseyPathHorizonWeight(x, horizon) {
    return 1 - smooth01((x - (horizon - ODYSSEY_PATH_HORIZON.soft)) / ODYSSEY_PATH_HORIZON.soft);
}
