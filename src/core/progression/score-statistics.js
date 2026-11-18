// @ts-check

/**
 * Lifetime score statistics, and how two copies of them combine.
 *
 * Pre-migration aggregate snapshots share an unknown amount of history. Their
 * per-field maximum is the baseline. Each new finish contributes once by run ID,
 * including separate finishes played offline from the same starting point.
 *
 * The lifetime counters cover every mode that saves a score (Single Player and
 * Infinity), as Records shows them. `byMode` keeps the same counters for each
 * mode, so the main menu's Single Player stage shows Single Player alone.
 */

import { ACHIEVEMENTS, STAT_NAMES, isScoreInt } from '../steam/steam-catalogue.js';
import { validRun } from './record-book.js';

/**
 * @typedef {object} ModeStatistics
 * @property {number} totalGames
 * @property {number} totalScore
 * @property {number} totalLines
 * @property {number} highestScore
 * @property {number} highestLevel
 * @property {number} [bestCascade] Infinity: the deepest cascade of any run
 * @property {number} [longestRun] Infinity: the longest run, in seconds
 */

/**
 * @typedef {object} ScoreStatistics
 * @property {any} [recordBook] Portable immutable completions and pre-migration baseline.
 * @property {'stats'} id
 * @property {number} totalGames
 * @property {number} totalScore
 * @property {number} totalLines
 * @property {number} highestScore
 * @property {number} highestLevel
 * @property {Record<string, number>} bestScorePerLevel
 * @property {Record<string, ModeStatistics>} [byMode] the counters per mode ('single', 'infinity')
 */

/** The mode of a score or statistics record saved before records carried their mode. */
export const LEGACY_SCORE_MODE = 'single';

/** Scores kept for each mode, on this device and in the Steam Cloud copy. */
export const SCORES_PER_MODE = 100;

/**
 * Each mode's best `limit` scores, highest first (ties: the newest first), so one mode's
 * runs never push another's out (pure, for the tests).
 * @param {Array<{score?: number, timestamp?: number, mode?: string}>} entries
 * @param {number} [limit]
 */
export function keepTopScoresPerMode(entries, limit = SCORES_PER_MODE) {
    const sorted = [...entries].sort((a, b) => {
        if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
        return (b.timestamp ?? 0) - (a.timestamp ?? 0);
    });
    const kept = new Map();
    return sorted.filter((entry) => {
        const mode = entry.mode || LEGACY_SCORE_MODE;
        const count = kept.get(mode) || 0;
        kept.set(mode, count + 1);
        return count < limit;
    });
}

/** @type {readonly (keyof ModeStatistics)[]} */
const MODE_COUNTERS = ['totalGames', 'totalScore', 'totalLines', 'highestScore', 'highestLevel'];

/**
 * Bests a mode keeps besides its score (Infinity's), each from a field of the saved run.
 * A mode that never reports one has no such key.
 * @type {readonly [keyof ModeStatistics, string][]}
 */
const MODE_BESTS = [['bestCascade', 'cascade'], ['longestRun', 'duration']];

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
    /** @type {ModeStatistics} */
    const counters = {
        totalGames: count(s.totalGames),
        totalScore: count(s.totalScore),
        totalLines: count(s.totalLines),
        highestScore: count(s.highestScore),
        highestLevel: count(s.highestLevel),
    };
    MODE_BESTS.forEach(([key]) => {
        if (count(s[key]) > 0) counters[key] = count(s[key]);
    });
    return counters;
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
    return count(stats?.totalGames) > 0 ? { [LEGACY_SCORE_MODE]: modeCounters(stats) } : {};
}

/**
 * One mode's counters, zero for a mode not played yet.
 *
 * @param {Partial<ScoreStatistics> | null | undefined} stats
 * @param {string} mode
 * @returns {ModeStatistics}
 */
export function statisticsForMode(stats, mode) {
    return modeCounters(modeStatisticsOf(stats)[mode]);
}

/**
 * The per-mode counters with one finished game added to its mode.
 *
 * @param {Record<string, ModeStatistics>} byMode from modeStatisticsOf(), before this game
 * @param {string} mode
 * @param {{ score?: number, lines?: number, level?: number, cascade?: number, duration?: number }} game
 * @returns {Record<string, ModeStatistics>}
 */
export function addGameToModeStatistics(byMode, mode, game) {
    const entry = modeCounters(byMode[mode]);
    /** @type {ModeStatistics} */
    const next = {
        ...entry,
        totalGames: entry.totalGames + 1,
        totalScore: entry.totalScore + count(game.score),
        totalLines: entry.totalLines + count(game.lines),
        highestScore: Math.max(entry.highestScore, count(game.score)),
        highestLevel: Math.max(entry.highestLevel, count(game.level)),
    };
    MODE_BESTS.forEach(([key, field]) => {
        const best = Math.max(count(entry[key]), count(game[field]));
        if (best > 0) next[key] = best;
    });
    return { ...byMode, [mode]: next };
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
function mergeLegacyStatistics(local, incoming) {
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
                [...MODE_COUNTERS, ...MODE_BESTS.map(([key]) => key)]
                    .map((key) => [key, Math.max(count(kept[key]), count(entry[key]))]),
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

// Two installations may capture Steam's pre-migration baseline on opposite sides
// of the first store. For totals the earliest observation avoids counting a finish
// twice. A personal-best baseline always keeps the greatest observed value.
function mergeSteamBaseline(a, b) {
    const valid = [a, b].filter((base) => base && STAT_NAMES.every((name) => isScoreInt(base[name])));
    if (!valid.length) return null;
    const maxima = ['best_cascade', 'infinity_best_time', 'odyssey_stars'];
    return Object.fromEntries(STAT_NAMES.map((name) => [name,
        (maxima.includes(name) ? Math.max : Math.min)(...valid.map((base) => base[name]))]));
}

/** Legacy snapshots share a baseline. Every later finish is uniquely attributable. */
export function mergeStatisticsSnapshots(local, incoming) {
    if (!local?.recordBook && !incoming?.recordBook) return mergeLegacyStatistics(local, incoming);
    const a = local?.recordBook, b = incoming?.recordBook;
    const base = mergeLegacyStatistics(a ? a.base : local, b ? b.base : incoming);
    const result = mergeLegacyStatistics(null, base);
    const runs = Object.create(null);
    for (const source of [a, b]) {
        for (const [id, run] of Object.entries(source?.runs || {})) {
            if (!runs[id] && validRun(id, run)) runs[id] = run;
        }
    }
    for (const r of Object.values(runs)) {
        if (r.mode !== 'single' && r.mode !== 'infinity') continue;
        result.byMode = addGameToModeStatistics(result.byMode, r.mode, r);
        result.totalGames++;
        result.totalLines += r.lines || 0;
        result.totalScore += r.score || 0;
        result.highestScore = Math.max(result.highestScore, r.score || 0);
        result.highestLevel = Math.max(result.highestLevel, r.level || 0);
        result.bestScorePerLevel[r.level] = Math.max(result.bestScorePerLevel[r.level] || 0, r.score || 0);
    }
    const earned = {};
    for (const source of [a?.earned, b?.earned]) {
        for (const [owner, ids] of Object.entries(source || {})) {
            if (!/^\d+\/\d{1,20}$/.test(owner) || !Array.isArray(ids)) continue;
            earned[owner] = [...new Set([...(earned[owner] || []), ...ids.filter((id) => ACHIEVEMENTS.includes(id))])].sort();
        }
    }
    const steamBase = mergeSteamBaseline(a?.steamBase, b?.steamBase);
    result.recordBook = { version: 1, base, runs, ...(Object.keys(earned).length ? { earned } : {}), ...(steamBase ? { steamBase } : {}) };
    return result;
}
