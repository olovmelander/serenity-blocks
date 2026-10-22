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
 * retracts across the 5->6 seam (behind the cloud bank, so nothing is seen to move).
 *
 * THE WAY ON, ONE NODE AT A TIME (2026-10-22, second pass). Laying the whole climb out again on the
 * glide into chapter 7 drew its far reach, between levels 50 and 52, straight across the face of
 * the hole while the hole was still an object in the sky (measured from level 49: the rail at p
 * 0.890-0.901 covers the shadow's disc). Now the rail goes on one node at a time: parked on a
 * node, it runs to the next one and tapers out there, and on each glide the next stretch is laid
 * out (from a quarter of the way along to arrival). The rail to the next node never crosses the
 * hole until the fall has the hole filling the frame, and once the hole has swallowed the frame
 * (chapter 7's fall reaches its horizon, just past level 52) the whole way on is laid out: the
 * tunnel, then the city. A player parked on any node sees a whole picture, the rail into the hole
 * or the rail to the next node, and never a rail stopped half-way between two.
 *
 * One schedule of progress, read by the ribbon (its radius collapses past the horizon) and by the
 * level nodes (they scale out the same way), so the two can never disagree. Pure: no three.js.
 */
import { getChapterTransitionForChapter } from './chapter-environments/shared/chapter-profile.js';
import { CH7_FALL } from './transitions/odyssey-black-hole-fall.js';

export const ODYSSEY_PATH_HORIZON = Object.freeze({
    // The chapter whose end the rail vanishes into (1-indexed): 6, Space.
    chapter: 6,
    // The taper before the horizon, in progress (~15 u of path).
    soft: 0.006,
    // Each glide lays the next stretch out from this far along it, ending on arrival.
    revealFromGlide: 0.25,
    // Without node positions: the reveal runs over this fraction of the outgoing seam half-width,
    // ending at the boundary.
    revealFraction: 0.3,
    // How far into the next chapter (local progress) the way on goes one node at a time: until
    // chapter 7's fall has the hole swallowing the frame.
    rollUntilLocal: CH7_FALL.horizon,
});

/** A horizon past the journey's end: nothing is hidden. */
export const PATH_HORIZON_OPEN = 2;

// Where the retract starts and the last reveal ends: just past the journey's end (1) plus the
// taper, so the sweep's ends never hide anything.
const HORIZON_FAR = 1 + (ODYSSEY_PATH_HORIZON.soft * 2);

function smooth01(x) {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
}

/**
 * The nodes the way on stops at: the boundary node, then the next chapter's nodes up to where the
 * hole has swallowed the frame.
 * @param {number} end the boundary (the next chapter's start, where its first node sits)
 * @param {number[]} chapterPositions
 * @param {number[]} levelPositions
 * @returns {number[]}
 */
function resolveWayOnStops(end, chapterPositions, levelPositions) {
    const H = ODYSSEY_PATH_HORIZON;
    const next = chapterPositions?.[H.chapter + 1];
    const until = Number.isFinite(next) && next > end ? end + ((next - end) * H.rollUntilLocal) : end;
    const stops = levelPositions
        .filter((x) => Number.isFinite(x) && x > end + 1e-6 && x <= until + 1e-6)
        .sort((a, b) => a - b);
    return [end, ...stops];
}

/**
 * The path progress past which the rail and its nodes are not drawn, for the eye at `progress`.
 * @param {number} progress camera path progress
 * @param {number[]} chapterPositions the active layout's chapter starts
 * @param {number[]|null} [levelPositions] the layout's node positions (the way on stops at them)
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
    let lastNode = -Infinity;
    if (Array.isArray(levelPositions)) {
        levelPositions.forEach((x) => { if (x > start && x < end - 1e-6 && x > lastNode) lastNode = x; });
    }
    if (!Number.isFinite(lastNode)) {
        // No node positions: the whole way on is laid out over the end of the chapter.
        const revealStart = end - (wOut * H.revealFraction);
        if (progress <= revealStart) return held;
        if (progress >= end) return PATH_HORIZON_OPEN;
        return held + ((HORIZON_FAR - held) * smooth01((progress - revealStart) / (end - revealStart)));
    }
    // The glides: chapter 6's last node to the boundary node, then node to node. Parked on a
    // stop, the rail runs to the one after it; on each glide the next stretch is laid out, and
    // the glide onto the last stop lays out the rest of the journey.
    const glide = [lastNode, ...resolveWayOnStops(end, chapterPositions, levelPositions)];
    if (progress <= glide[0]) return held;
    const last = glide[glide.length - 1];
    if (progress >= last) return PATH_HORIZON_OPEN;
    const shown = (i) => (i + 1 < glide.length ? glide[i + 1] + H.soft : HORIZON_FAR);
    let i = 0;
    while (progress >= glide[i + 1]) i += 1;
    const from = glide[i];
    const to = glide[i + 1];
    const revealStart = from + ((to - from) * H.revealFromGlide);
    if (progress <= revealStart) return shown(i);
    return shown(i) + ((shown(i + 1) - shown(i)) * smooth01((progress - revealStart) / (to - revealStart)));
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
