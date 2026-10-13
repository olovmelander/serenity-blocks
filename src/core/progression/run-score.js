// @ts-check

/**
 * Save a finished run's local high score without letting a storage failure end the
 * results flow (audit SCORE-05). IndexedDB can fail to open or write (a full disk, a
 * locked or corrupt database). The rejection used to escape the fire-and-forget game
 * over: no results, no Steam sync, no gameOver event, and the player left on a dead
 * board.
 * @param {{ addScore: (scoreData: Record<string, unknown>) => Promise<unknown> }} highScoreManager
 * @param {Record<string, unknown>} scoreData
 * @param {string} [label] log prefix, e.g. '[SinglePlayer]'
 * @returns {Promise<boolean>} whether the score was saved
 */
export async function saveRunScore(highScoreManager, scoreData, label = '[Game]') {
    try {
        await highScoreManager.addScore(scoreData);
        return true;
    } catch (error) {
        console.error(`${label} Could not save the score on this device:`, error);
        return false;
    }
}
