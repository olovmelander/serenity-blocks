/**
 * Retry orb / Back to map, chosen on the pause sheet (Settings while an orb is in progress),
 * and Chapters, chosen on the journey sheet (Settings on the map).
 * The sheet closes and resumes play before the choice arrives, so the restart veil and the
 * return transition run over live surfaces exactly as they do after a failed orb.
 */

/**
 * @param {object} mode the active OdysseyMode
 * @param {{ action?: 'retry'|'map'|'chapters' }} [payload]
 * @returns {boolean} whether the action was taken
 */
export function handleOdysseyPauseAction(mode, { action } = {}) {
    if (action === 'chapters') {
        // The chapter list opens over the settled map only, as its rail tile does.
        if (!mode?.isActive || !mode.isOnOdysseyMap?.()) return false;
        mode.openOdysseyNavigator();
        return true;
    }
    if (!mode?.isActive || mode.isInBoardView || mode.isEnteringLevel || mode.levelCompleting) return false;
    if (!mode.currentLevelConfig || !mode._activeLevelSession) return false;
    let run = null;
    if (action === 'retry') run = mode._restartLevelInPlace();
    else if (action === 'map') run = mode.returnToBoard();
    if (!run) return false;
    Promise.resolve(run).catch((error) => console.warn(`[Odyssey] Pause action "${action}" failed:`, error));
    return true;
}
