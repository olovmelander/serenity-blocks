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
 * ⚠️ SCALED 0.03 -> 0.0222 BY WAVE 1A, for the same reason every seamWidth was: `p` is
 * arc-normalised over the whole curve, the ascent lengthened it 1767.65 -> 2393.89, and a
 * fixed 0.03 therefore bought 35% more world than it was authored to. The value tracks
 * the act edges' seamWidth, so it scales with them.
 *
 * DO NOT raise this to the journey's widest seam (Ch4's 0.06). That reaches p=0.033, which is
 * only ~35% into Chapter 1, and leaves the defect this gate exists to fix in place — the
 * first attempt at the fix did precisely that and changed nothing about the captured frame.
 */
export const ONE_WORLD_ACT_MARGIN = 0.0222;

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

/**
 * How far before the act edge the world begins receding, as a fraction of the sky chapter's
 * span, and how much of the gate margin it has fully closed by. FRACTIONS on purpose: the
 * ascent (Wave 1A) re-maps every chapter's p, and these have to carry without an edit.
 *
 * ⚠️ THE CLOSE IS 0 — THE RECESSION FINISHES AT THE BOUNDARY, NOT AT THE GATE, AND THAT IS
 * THE WHOLE POINT. Wave 1B first ran it to 0.85 of the margin, which put it in the SAME
 * window as the chapter ecotone crossfade (0.618-0.678 at the 5->6 seam). Two large
 * brightness changes in one window do not average, they compound: the measured cliff simply
 * moved from the gate to one sample earlier (-89.3 became -91.5), and widening the ramp
 * nearly 3x barely touched it (-86.1) because the ramp was never what was dropping.
 * Staggering them is the fix — the world does its leaving BEFORE the crossfade does its own.
 */
export const ONE_WORLD_DEPARTURE_LEAD = 0.30;
export const ONE_WORLD_DEPARTURE_CLOSE = 0.0;

/**
 * THE DEPARTURE FADE — the other half of "when does the world leave".
 *
 * `isWorldVisibleAtProgress` above is a BOOLEAN, and until Wave 1B it was also, by accident,
 * the artistic end of Act II: the world drew at full strength right up to actEnd + margin and
 * then stopped between two frames. Measured at the 5->6 seam that is a -89 luma step, and it
 * is what reads as the mountain vanishing in front of the camera.
 *
 * This returns the recession that runs AHEAD of that flag, so by the time the boolean fires
 * there is nothing visible left to hide. The gate keeps its original job unchanged — stopping
 * Act II painting over chapters that own their own frame.
 *
 * Lives here, next to the gate, because the two are one decision. A caller that has one and
 * not the other will reintroduce the cliff.
 *
 * @param {number} progress camera progress along the whole journey, 0..1
 * @param {number} skyStart chapter 5's start (chapterPositions[4])
 * @param {number} actEnd   Act II's last chapter boundary (chapterPositions[5])
 * @returns {number} 0 = fully present, 1 = fully receded into the sky
 */
export function worldDepartureFade(progress, skyStart, actEnd) {
    if (!Number.isFinite(progress) || !Number.isFinite(skyStart) || !Number.isFinite(actEnd)) return 0;
    const skySpan = Math.max(1e-5, actEnd - skyStart);
    const start = actEnd - skySpan * ONE_WORLD_DEPARTURE_LEAD;
    const end = actEnd + ONE_WORLD_ACT_MARGIN * ONE_WORLD_DEPARTURE_CLOSE;
    const t = Math.min(Math.max((progress - start) / Math.max(1e-5, end - start), 0), 1);
    return t * t * (3 - 2 * t);
}
