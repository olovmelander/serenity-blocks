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
 *
 * The lifetime counters cover every mode that saves a score (Single Player and
 * Infinity), as Records shows them. `byMode` keeps the same counters for each
 * mode, so the main menu's Single Player stage shows Single Player alone.
 */

/**
 * @typedef {object} ModeStatistics
 * @property {number} totalGames
 * @property {number} totalScore
 * @property {number} totalLines
 * @property {number} highestScore
 * @property {number} highestLevel
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
 * @property {Record<string, ModeStatistics>} [byMode] the counters per mode ('single', 'infinity')
 */

/** @type {readonly (keyof ModeStatistics)[]} */
const MODE_COUNTERS = ['totalGames', 'totalScore', 'totalLines', 'highestScore', 'highestLevel'];

/** @param {unknown} value */
const count = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * @param {Partial<ModeStatistics> | null | undefined} source
 * @returns {ModeStatistics}
 */
function modeCounters(source) {
    const s = source || {};
    return {
        totalGames: count(s.totalGames),
        totalScore: count(s.totalScore),
        totalLines: count(s.totalLines),
        highestScore: count(s.highestScore),
        highestLevel: count(s.highestLevel),
    };
}

/**
 * Each mode's counters in a snapshot. One saved before the counters were split has
 * none: its whole history counts as Single Player, because the Infinity runs in it
 * cannot be told apart. The menu then shows what it showed before the split, and
 * only games played since are kept apart.
 *
 * @param {Partial<ScoreStatistics> | null | undefined} stats
 * @returns {Record<string, ModeStatistics>}
 */
export function modeStatisticsOf(stats) {
    if (stats?.byMode && typeof stats.byMode === 'object') {
        return Object.fromEntries(Object.entries(stats.byMode).map(([mode, entry]) => [mode, modeCounters(entry)]));
    }
    return count(stats?.totalGames) > 0 ? { single: modeCounters(stats) } : {};
}

/**
 * The per-mode counters with one finished game added to its mode.
 *
 * @param {Record<string, ModeStatistics>} byMode from modeStatisticsOf(), before this game
 * @param {string} mode
 * @param {{ score?: number, lines?: number, level?: number }} game
 * @returns {Record<string, ModeStatistics>}
 */
export function addGameToModeStatistics(byMode, mode, game) {
    const entry = modeCounters(byMode[mode]);
    return {
        ...byMode,
        [mode]: {
            totalGames: entry.totalGames + 1,
            totalScore: entry.totalScore + count(game.score),
            totalLines: entry.totalLines + count(game.lines),
            highestScore: Math.max(entry.highestScore, count(game.score)),
            highestLevel: Math.max(entry.highestLevel, count(game.level)),
        },
    };
}

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
        byMode: {},
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
    /** @type {Record<string, ModeStatistics>} */
    const byMode = {};
    for (const modes of [modeStatisticsOf(a), modeStatisticsOf(b)]) {
        Object.entries(modes).forEach(([mode, entry]) => {
            const kept = byMode[mode] || modeCounters(null);
            byMode[mode] = modeCounters(Object.fromEntries(
                MODE_COUNTERS.map((key) => [key, Math.max(kept[key], entry[key])]),
            ));
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
        byMode,
    };
}
