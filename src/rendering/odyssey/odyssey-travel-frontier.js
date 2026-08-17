/**
 * @fileoverview TRAVEL FRONTIER — the "you can never reach something that isn't ready" rule.
 *
 * Super Mario Galaxy never stutters on a 2007 console, and the reason is not that it is cheap to
 * draw. It is that the player is never given control of a world that is still being built: a
 * galaxy loads fully behind a loading screen, and the launch-star flight between galaxies is a
 * loading cover wearing a costume. The guarantee is not "everything is loaded" — it is
 * **"you cannot get to anything unfinished"**.
 *
 * Odyssey broke that guarantee in the only place it matters. The board is one continuous
 * scrollable world with no loading covers, so a player who scrolls briskly from the reveal walks
 * straight into chapters whose materials have never been compiled or uploaded, and pays that cost
 * on a visible frame. Measured (2026-08-17): forward travel hitched 8 times, worst 586 ms, while
 * travelling BACKWARD over identical scenery hitched zero times — the whole difference is
 * first-visit work.
 *
 * The naive reading of "do it the Galaxy way" is to hold the loading screen until everything is
 * prepared. That is the wrong trade here and would make the loudest complaint worse: preparation
 * completes around 18.7 s, so it would buy a ~19 s loading screen. Galaxy does not preload the
 * whole game either — it preloads the CURRENT galaxy and controls where you can go.
 *
 * So this module computes how far the player may travel RIGHT NOW: to the end of the last
 * contiguous prepared chapter, and no further. The camera eases to a hold just before an
 * unprepared boundary — which reads as a cinematic beat at a vista, not a stall — and releases the
 * moment that chapter is ready. Fast start AND no freeze.
 *
 * TWO RULES THIS MODULE WILL NOT BEND:
 *
 * 1. **Fail open.** Any malformed input returns "no limit". A bug in a perf optimisation must
 *    never be able to trap the player behind an invisible wall; a stutter is a bad frame, being
 *    stuck is a broken game.
 * 2. **Contiguous only.** Readiness is scanned forward from the player and stops at the first gap.
 *    A prepared chapter 8 does not entitle anyone to cross an unprepared chapter 7.
 */

/** Default hold distance (in progress units) kept BEFORE an unprepared boundary. */
export const DEFAULT_FRONTIER_MARGIN = 0.004;

/**
 * How far along the path the player may currently travel.
 *
 * @param {object} options
 * @param {number[]} options.chapterPositions boundary positions, ascending, `[0, b1, .., 1]`;
 *   chapter `c` spans `chapterPositions[c - 1] .. chapterPositions[c]`.
 * @param {(chapterId: number) => boolean} options.isChapterReady is this chapter safe to enter?
 * @param {number} [options.margin] hold distance kept before an unprepared boundary.
 * @returns {number} the maximum progress the player may reach, in [0, 1]. Returns 1 ("no limit")
 *   for any input this cannot reason about.
 */
export function computeTravelFrontier({
    chapterPositions,
    isChapterReady,
    margin = DEFAULT_FRONTIER_MARGIN,
} = {}) {
    // RULE 1 — fail open. Never gate travel on data or a predicate we cannot trust.
    if (!Array.isArray(chapterPositions) || chapterPositions.length < 2) return 1;
    if (typeof isChapterReady !== 'function') return 1;
    if (!chapterPositions.every((p) => Number.isFinite(p))) return 1;

    const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : DEFAULT_FRONTIER_MARGIN;
    const lastChapter = chapterPositions.length - 1;

    for (let chapter = 1; chapter <= lastChapter; chapter += 1) {
        let ready = false;
        try {
            ready = isChapterReady(chapter) === true;
        } catch {
            return 1; // a throwing predicate must not wall the player in
        }
        if (!ready) {
            // RULE 2 — stop at the FIRST gap. Hold just short of this chapter's opening boundary
            // so the seam is never half-entered (both chapters co-present is exactly the state
            // whose cost we are avoiding), and never below the journey start.
            return Math.max(0, chapterPositions[chapter - 1] - safeMargin);
        }
    }
    return chapterPositions[lastChapter];
}

/**
 * Clamp a desired target position to the frontier.
 * @param {number} target desired progress
 * @param {number} frontier from {@link computeTravelFrontier}
 * @returns {number} the permitted target (unchanged when already within the frontier)
 */
export function clampToFrontier(target, frontier) {
    if (!Number.isFinite(target)) return target;
    if (!Number.isFinite(frontier)) return target;
    return Math.min(target, frontier);
}

/**
 * Is the player currently held AT the frontier (rather than simply travelling below it)?
 * Used to decide whether to present the hold as an intentional beat, and to start the
 * anti-softlock timer that eventually releases a chapter that never becomes ready.
 * @param {number} position current progress
 * @param {number} frontier current frontier
 * @param {number} [tolerance] how close counts as "at"
 * @returns {boolean} true when travel is being withheld
 */
export function isHeldAtFrontier(position, frontier, tolerance = 0.002) {
    if (!Number.isFinite(position) || !Number.isFinite(frontier)) return false;
    if (frontier >= 1) return false; // the journey end is not a hold
    return position >= frontier - Math.abs(tolerance);
}

export default {
    computeTravelFrontier,
    clampToFrontier,
    isHeldAtFrontier,
    DEFAULT_FRONTIER_MARGIN,
};
