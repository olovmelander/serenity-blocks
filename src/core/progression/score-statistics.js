// @ts-check

/**
 * Lifetime score statistics, and how two copies of them combine.
 *
 * Each device's record is a cumulative snapshot. Once a device has synced with
 * Steam Cloud, its record already includes the history it downloaded. Merging
 * two snapshots therefore keeps the larger value of every counter. Adding them
 * counted the shared history again on every sync, so totals grew without any
 * play (audit SCORE-04).
 *
 * max() can still miss games that two devices both played between syncs.
 * Per-device counters would count those too, and remain the long-term fix.
 */

/**
 * @typedef {object} ScoreStatistics
 * @property {'stats'} id
 * @property {number} totalGames
 * @property {number} totalScore
 * @property {number} totalLines
 * @property {number} highestScore
 * @property {number} highestLevel
 * @property {Record<string, number>} bestScorePerLevel
 */

/** @param {unknown} value */
const count = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
};

/** @returns {ScoreStatistics} */
export function createEmptyStatistics() {
    return {
        id: 'stats',
        totalGames: 0,
        totalScore: 0,
        totalLines: 0,
        highestScore: 0,
        highestLevel: 0,
        bestScorePerLevel: {},
    };
}

/**
 * Combines two snapshots of the same lifetime history. Pass `null` for `local`
 * to normalize a single snapshot.
 *
 * @param {Partial<ScoreStatistics> | null | undefined} local
 * @param {Partial<ScoreStatistics> | null | undefined} incoming
 * @returns {ScoreStatistics}
 */
export function mergeStatisticsSnapshots(local, incoming) {
    const a = local || {};
    const b = incoming || {};
    /** @param {'totalGames' | 'totalScore' | 'totalLines' | 'highestScore' | 'highestLevel'} key */
    const larger = (key) => Math.max(count(a[key]), count(b[key]));
    /** @type {Record<string, number>} */
    const bestScorePerLevel = {};
    for (const levels of [a.bestScorePerLevel, b.bestScorePerLevel]) {
        Object.entries(levels || {}).forEach(([level, score]) => {
            bestScorePerLevel[level] = Math.max(bestScorePerLevel[level] || 0, count(score));
        });
    }
    return {
        id: 'stats',
        totalGames: larger('totalGames'),
        totalScore: larger('totalScore'),
        totalLines: larger('totalLines'),
        highestScore: larger('highestScore'),
        highestLevel: larger('highestLevel'),
        bestScorePerLevel,
    };
}
