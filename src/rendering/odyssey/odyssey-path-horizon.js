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
 * node (which sits on it), under the hole, and the nodes beyond it are not drawn. The far rail
 * retracts across the 5->6 seam (behind the cloud bank, so nothing is seen to move) and is laid out
 * again on the glide from chapter 6's last node to that first node, after the black hole has
 * become chapter 7's: the horizon sweeps up the climb to the journey's end on the way, so a player
 * parked on either node sees a whole picture — the rail into the hole, or the way on — never a
 * rail stopped half-drawn.
 *
 * One schedule of progress, read by the ribbon (its radius collapses past the horizon) and by the
 * level nodes (they scale out the same way), so the two can never disagree. Pure: no three.js.
 */
import { getChapterTransitionForChapter } from './chapter-environments/shared/chapter-profile.js';

export const ODYSSEY_PATH_HORIZON = Object.freeze({
    // The chapter whose end the rail vanishes into (1-indexed): 6, Space.
    chapter: 6,
    // The taper before the horizon, in progress (~15 u of path).
    soft: 0.006,
    // The reveal starts this far along the glide from chapter 6's last node to the boundary node
    // and ends on arrival.
    revealFromGlide: 0.25,
    // Without node positions: the reveal runs over this fraction of the outgoing seam half-width,
    // ending at the boundary.
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
 * The path progress past which the rail and its nodes are not drawn, for the eye at `progress`.
 * @param {number} progress camera path progress
 * @param {number[]} chapterPositions the active layout's chapter starts
 * @param {number[]|null} [levelPositions] the layout's node positions (places the reveal on the
 *   glide into chapter 7's first node)
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
    const wOut = getChapterTransitionForChapter(H.chapter)?.seamWidth ?? 0.0222;
    const held = end + H.soft;
    if (progress <= start - wIn) return PATH_HORIZON_OPEN;
    if (progress < start + wIn) {
        return HORIZON_FAR + ((held - HORIZON_FAR) * smooth01((progress - (start - wIn)) / (2 * wIn)));
    }
    let revealStart = end - (wOut * H.revealFraction);
    if (Array.isArray(levelPositions)) {
        let lastNode = -Infinity;
        levelPositions.forEach((x) => { if (x > start && x < end - 1e-6 && x > lastNode) lastNode = x; });
        if (Number.isFinite(lastNode)) revealStart = lastNode + ((end - lastNode) * H.revealFromGlide);
    }
    if (progress <= revealStart) return held;
    if (progress >= end) return PATH_HORIZON_OPEN;
    return held + ((HORIZON_FAR - held) * smooth01((progress - revealStart) / (end - revealStart)));
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
