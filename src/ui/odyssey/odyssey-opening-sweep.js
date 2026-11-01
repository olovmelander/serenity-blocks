/**
 * THE OPENING SWEEP (2026-11-01; the owner: "when Odyssey Mode starts, it should always begin at
 * the start of the path in Chapter 1, and then pan a bit faster to the current unfinished orb").
 *
 * The mode's side of it (the board's is OdysseyBoardController.playOpeningSweep): on entry the
 * board is built at orb 1, around chapter 1 and with the music of the orb it will fly to; once the
 * map is on screen it sweeps there, and that orb's panel opens on arrival (onLevelSelect). Without
 * a sweep the map opens framed on the orb at once, as before: no orb to open on (a fresh journey's
 * welcome), orb 1 itself, reduced motion, or `?odysseyOpeningSweep=0`.
 * Record: docs/ODYSSEY_OPENING_SWEEP_2026-11.md.
 */

/**
 * The orb the map sweeps to from orb 1 when the mode starts, or null to open framed on it.
 * @param {object} mode the OdysseyMode
 * @param {?number} revealLevelId the orb the map opens on (OdysseyMode._resolveRevealLevelId)
 * @returns {?number}
 */
export function resolveOdysseyOpeningSweep(mode, revealLevelId) {
    if (!Number.isFinite(revealLevelId) || revealLevelId === 1) return null;
    if (mode?.deps?.settingsManager?.get?.()?.reducedMotion === true) return null;
    try {
        if (new URLSearchParams(globalThis.location?.search || '').get('odysseyOpeningSweep') === '0') return null;
    } catch {
        // No URL: the sweep as default.
    }
    return revealLevelId;
}

/**
 * Decide how the map opens on mode entry: remembers the sweep's orb on the mode, selects the orb
 * the map opens framed on (none while sweeping: its panel waits for the arrival), and returns the
 * options for OdysseyMode._showBoardView.
 * @param {object} mode the OdysseyMode
 * @param {?number} revealLevelId
 * @returns {object} _showBoardView's options
 */
export function prepareOdysseyOpening(mode, revealLevelId) {
    const sweepTo = resolveOdysseyOpeningSweep(mode, revealLevelId);
    mode._openingSweepTo = sweepTo;
    if (Number.isFinite(sweepTo)) {
        mode.selectedLevelId = null;
        return { focusLevelId: null };
    }
    if (!Number.isFinite(revealLevelId)) return {};
    mode.selectedLevelId = revealLevelId;
    return { focusLevelId: revealLevelId, seatOnFocus: true };
}

/**
 * The board's construction options for a sweep (spread over the ordinary ones): chapters 1-2 built
 * and chapter 1 warmed before the reveal, opened at orb 1, with the sweep's orb's chapter music.
 * @param {object} mode the OdysseyMode
 * @returns {object} {} without a sweep
 */
export function odysseyOpeningBoardOptions(mode) {
    const sweepTo = mode?._openingSweepTo;
    if (!Number.isFinite(sweepTo)) return {};
    return {
        startupChapters: mode._computeEagerStartupChapters(1),
        focusChapter: 1,
        revealLevelId: null,
        musicChapter: mode._chapterOfLevel(sweepTo),
    };
}

/**
 * Fly the freshly revealed map from orb 1 to the sweep's orb. A scroll, an orb choice, leaving the
 * map or an orb starting ends it there.
 * @param {object} mode the OdysseyMode
 */
export function startOdysseyOpeningSweep(mode) {
    const levelId = mode._openingSweepTo;
    mode._openingSweepTo = null;
    const board = mode.boardController;
    if (!Number.isFinite(levelId) || !board?.playOpeningSweep) return;
    const generation = mode._boardPresentationGeneration || 0;
    const isCurrent = () => mode.isActive && mode.isInBoardView && mode.boardController === board
        && generation === (mode._boardPresentationGeneration || 0) && !mode.isEnteringLevel;
    board.playOpeningSweep(levelId, { isCurrent }).then((arrived) => {
        if (arrived && isCurrent()) mode.selectedLevelId = levelId;
    }).catch((error) => {
        console.warn('[Odyssey] Opening sweep failed:', error);
    });
}
