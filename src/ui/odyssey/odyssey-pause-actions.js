/**
 * Retry orb / Back to map, chosen on the pause sheet (Settings while an orb is in progress).
 * The sheet closes and resumes play before the choice arrives, so the restart veil and the
 * return transition run over live surfaces exactly as they do after a failed orb.
 */

/**
 * @param {object} mode the active OdysseyMode
 * @param {{ action?: 'retry'|'map' }} [payload]
 * @returns {boolean} whether the action was taken
 */
export function handleOdysseyPauseAction(mode, { action } = {}) {
    if (!mode?.isActive || mode.isInBoardView || mode.isEnteringLevel || mode.levelCompleting) return false;
    if (!mode.currentLevelConfig || !mode._activeLevelSession) return false;
    let run = null;
    if (action === 'retry') run = mode._restartLevelInPlace();
    else if (action === 'map') run = mode.returnToBoard();
    if (!run) return false;
    Promise.resolve(run).catch((error) => console.warn(`[Odyssey] Pause action "${action}" failed:`, error));
    return true;
}
