/**
 * WHERE THE CONTINUOUS WORLD IS ALLOWED TO DRAW.
 *
 * Extracted so the board, the seam harness and the tests all ask the SAME function. A gate
 * this cheap is exactly the kind that gets re-implemented slightly differently in a
 * playground effect, and then the harness quietly stops reproducing the game.
 *
 * The world used to draw for the whole journey — its group was added to the scene once and
 * `.visible` was never written — so its ground, water, sky dome, cloud deck and god-rays
 * rendered through chapters 1, 6, 7 and 8 as well, which own their own frame. Earth Core is
 * the proof case: its vault backstop is an opaque BackSide sphere at r=250 with
 * `depthWrite = false` at renderOrder -90, so it paints colour but no depth and the world's
 * depth-writing geometry overwrites it. Captured at p=0.051, Chapter 1's ember-lit molten
 * cathedral was rendering as magma columns in Act II's blue-teal ocean.
 */

/**
 * How far outside Act II the world keeps drawing, in progress units.
 *
 * 0.03 is the authored `transition.seamWidth` of BOTH act edges — ch1->ch2 and ch5->ch6 — and
 * `ChapterEnvironmentManager` uses seamWidth as the ecotone half-width, so the world is
 * present for exactly the window in which the neighbouring chapter is co-present, and no
 * wider.
 *
 * DO NOT raise this to the journey's widest seam (Ch4's 0.06). That reaches p=0.033, which is
 * only ~35% into Chapter 1, and leaves the defect this gate exists to fix in place — the
 * first attempt at the fix did precisely that and changed nothing about the captured frame.
 */
export const ONE_WORLD_ACT_MARGIN = 0.03;

/**
 * @param {number} progress camera progress along the whole journey, 0..1
 * @param {number} actStart Act II's first chapter boundary (chapterPositions[1])
 * @param {number} actEnd Act II's last chapter boundary (chapterPositions[5])
 * @returns {boolean} whether the world group should draw at this progress
 */
export function isWorldVisibleAtProgress(progress, actStart, actEnd) {
    if (!Number.isFinite(progress) || !Number.isFinite(actStart) || !Number.isFinite(actEnd)) {
        // Unknown layout: draw, rather than blanking Act II on a bad read.
        return true;
    }
    return progress > (actStart - ONE_WORLD_ACT_MARGIN)
        && progress < (actEnd + ONE_WORLD_ACT_MARGIN);
}
