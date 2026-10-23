/**
 * @fileoverview High Score Management System for Serenity Blocks
 * Uses IndexedDB to store high scores, game history, and statistics
 */

import { eventBus, EVENTS } from '../events/event-bus.js';
import {
    LEGACY_SCORE_MODE, addGameToModeStatistics, mergeStatisticsSnapshots, modeStatisticsOf,
} from '../core/progression/score-statistics.js';
import { openDatabaseOnce } from '../utils/indexed-db-open.js';

/** What a run records besides its score (Infinity): its deepest cascade and its seconds. */
const RUN_DETAILS = ['cascade', 'duration'];

/** Scores kept for each mode, here and in the Steam Cloud copy. */
const SCORES_PER_MODE = 100;

/** The keys of one mode's scores in the (mode, score) index. */
function modeScores(mode) {
    return IDBKeyRange.bound([mode, -Infinity], [mode, Infinity]);
}

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

/**
 * Scores imported from another device through Steam Cloud (audit SCORE-17). Keep only
 * entries that are scores, with their counters as numbers, so a malformed or hand-edited
 * file cannot reach the records list's markup. The demoId named a replay in the other
 * device's local store, which this one doesn't have: drop it. A local copy of the same
 * score keeps its own, because local records win the de-duplication.
 */
function sanitizeImportedScore(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const score = Number(entry.score);
    if (!Number.isFinite(score) || score < 0) return null;
    const clone = { ...entry, score };
    for (const key of ['lines', 'level', 'timestamp', ...RUN_DETAILS]) {
        if (key in clone) {
            const value = Number(clone[key]);
            if (Number.isFinite(value)) clone[key] = value;
            else delete clone[key];
        }
    }
    delete clone.id;
    delete clone.demoId;
    // The mode ranks the score among its own ('single', 'infinity'); a score from before
    // scores carried their mode, or with anything else there, is Single Player's.
    if (typeof clone.mode !== 'string' || !/^[a-z-]{1,32}$/.test(clone.mode)) clone.mode = LEGACY_SCORE_MODE;
    return clone;
}

/**
 * Manages high scores, game history, and statistics using IndexedDB
 */
export class HighScoreManager {
    constructor() {
        this.db = null;
        this.DB_NAME = 'SerenityBlocksDB';
        this.DB_VERSION = 2;
        this.STORES = {
            HIGH_SCORES: 'highScores',
            STATISTICS: 'statistics',
            GAME_HISTORY: 'gameHistory',
        };
    }

    /**
     * Opens the IndexedDB database once (utils/indexed-db-open.js: concurrent callers share it,
     * and it gives way to a newer version of the game in another tab).
     * @returns {Promise<void>}
     */
    async init() {
        return openDatabaseOnce(this, {
            name: this.DB_NAME,
            version: this.DB_VERSION,
            upgrade: (event) => {
                const db = event.target.result;

                // High Scores Store - sorted by score descending
                if (!db.objectStoreNames.contains(this.STORES.HIGH_SCORES)) {
                    const highScoreStore = db.createObjectStore(this.STORES.HIGH_SCORES, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                    highScoreStore.createIndex('score', 'score', { unique: false });
                    highScoreStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // Statistics Store - single record with aggregate stats
                if (!db.objectStoreNames.contains(this.STORES.STATISTICS)) {
                    db.createObjectStore(this.STORES.STATISTICS, { keyPath: 'id' });
                }

                // Game History Store - recent games (keep last 50)
                if (!db.objectStoreNames.contains(this.STORES.GAME_HISTORY)) {
                    const historyStore = db.createObjectStore(this.STORES.GAME_HISTORY, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                    historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // v2: scores per mode. Each mode keeps its own top 100, read and ranked through
                // a (mode, score) index. A score saved before scores carried their mode is
                // Single Player's, as in score-statistics.js; it needs the mode to be indexed.
                const scores = event.target.transaction.objectStore(this.STORES.HIGH_SCORES);
                if (!scores.indexNames.contains('mode_score')) {
                    scores.createIndex('mode_score', ['mode', 'score'], { unique: false });
                }
                if (event.oldVersion > 0 && event.oldVersion < 2) {
                    scores.openCursor().onsuccess = (cursorEvent) => {
                        const cursor = cursorEvent.target.result;
                        if (!cursor) return;
                        if (!cursor.value.mode) cursor.update({ ...cursor.value, mode: LEGACY_SCORE_MODE });
                        cursor.continue();
                    };
                }
            },
        });
    }

    /**
     * Adds a score (alias for saveScore for backward compatibility)
     * @param {Object} scoreData - Score data to save
     * @returns {Promise<Object>} The saved game record
     */
    async addScore(scoreData) {
        // Get current theme and music track from global managers if not provided
        const theme = scoreData.theme || (window.themeManager?.activeThemeName || 'default');
        const musicTrack = scoreData.musicTrack || (window.soundManager?.currentTrack || 'none');
        const speedMultiplier = scoreData.speedMultiplier || 1.0;
        const demoId = scoreData.demoId || null;

        return this.saveScore({
            ...scoreData,
            theme,
            musicTrack,
            speedMultiplier,
            demoId,
        });
    }

    /**
     * Saves a game score and updates statistics
     * @param {Object} scoreData - Score data to save
     * @param {number} scoreData.score - Final score
     * @param {number} scoreData.lines - Lines cleared
     * @param {number} scoreData.level - Level reached
     * @param {number} scoreData.speedMultiplier - Speed multiplier
     * @param {string} scoreData.theme - Active theme
     * @param {string} scoreData.musicTrack - Music track played
     * @param {number} [scoreData.demoId] - Optional linked demo ID
     * @param {string} [scoreData.mode] - The mode played ('infinity'); Single Player by default
     * @param {number} [scoreData.cascade] - Infinity: the run's deepest cascade
     * @param {number} [scoreData.duration] - Infinity: the run's length in seconds
     * @returns {Promise<Object>} The saved game record
     */
    async saveScore(scoreData) {
        if (!this.db) await this.init();

        const mode = typeof scoreData.mode === 'string' && scoreData.mode ? scoreData.mode : LEGACY_SCORE_MODE;

        const gameRecord = {
            score: scoreData.score,
            lines: scoreData.lines,
            level: scoreData.level,
            speedMultiplier: scoreData.speedMultiplier,
            theme: scoreData.theme,
            musicTrack: scoreData.musicTrack,
            mode,
            timestamp: Date.now(),
        };

        // Include demoId if provided (links to saved demo for replay)
        if (scoreData.demoId) {
            gameRecord.demoId = scoreData.demoId;
        }
        RUN_DETAILS.forEach((key) => {
            const value = Number(scoreData[key]);
            if (Number.isFinite(value) && value > 0) gameRecord[key] = value;
        });

        // Store, trim and aggregate in the same transaction. Concurrent saves
        // serialize their statistics reads and no partial game survives failure.
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction(Object.values(this.STORES), 'readwrite');
            let failure = null;
            const abort = (error) => {
                failure = error;
                transaction.abort();
            };
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(failure || transaction.error || new Error('Score save aborted'));
            transaction.onerror = (event) => {
                failure = failure || event.target.error || transaction.error;
            };
            try {
                const scores = transaction.objectStore(this.STORES.HIGH_SCORES);
                const history = transaction.objectStore(this.STORES.GAME_HISTORY);
                const statistics = transaction.objectStore(this.STORES.STATISTICS);
                scores.add(gameRecord);
                history.add(gameRecord);
                this._trimStore(scores, 'mode_score', SCORES_PER_MODE, modeScores(mode));
                this._trimStore(history, 'timestamp', 50);
                const request = statistics.get('stats');
                request.onsuccess = () => {
                    try {
                        const stats = request.result || {
                            id: 'stats',
                            totalGames: 0,
                            totalScore: 0,
                            totalLines: 0,
                            highestScore: 0,
                            highestLevel: 0,
                            bestScorePerLevel: {},
                        };
                        // Read before the lifetime counters change: a record from before the
                        // split counts its history as Single Player.
                        stats.byMode = addGameToModeStatistics(modeStatisticsOf(stats), mode, gameRecord);
                        stats.totalGames++;
                        stats.totalScore += gameRecord.score;
                        stats.totalLines += gameRecord.lines;
                        stats.highestScore = Math.max(stats.highestScore, gameRecord.score);
                        stats.highestLevel = Math.max(stats.highestLevel, gameRecord.level);
                        if (!stats.bestScorePerLevel[gameRecord.level]
                            || gameRecord.score > stats.bestScorePerLevel[gameRecord.level]) {
                            stats.bestScorePerLevel[gameRecord.level] = gameRecord.score;
                        }
                        statistics.put(stats);
                    } catch (error) {
                        abort(error);
                    }
                };
            } catch (error) {
                abort(error);
            }
        });

        eventBus.emit(EVENTS.HIGH_SCORE_SAVED, {
            record: gameRecord,
            source: 'local',
        });

        return gameRecord;
    }

    /**
     * Retrieves top scores, of every mode or of one
     * @param {number} limit - Number of top scores to retrieve
     * @param {{ mode?: string|null }} [options] - Only this mode's scores ('single', 'infinity')
     * @returns {Promise<Array<Object>>} Array of top scores
     */
    async getTopScores(limit = 10, { mode = null } = {}) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readonly');
            const store = transaction.objectStore(this.STORES.HIGH_SCORES);
            // Descending order; one mode's scores through the (mode, score) index.
            const request = mode
                ? store.index('mode_score').openCursor(modeScores(mode), 'prev')
                : store.index('score').openCursor(null, 'prev');

            const scores = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && scores.length < limit) {
                    scores.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(scores);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Retrieves aggregate statistics
     * @returns {Promise<Object>} Statistics object
     */
    async getStatistics() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.STATISTICS], 'readonly');
            const store = transaction.objectStore(this.STORES.STATISTICS);
            const request = store.get('stats');

            request.onsuccess = () => {
                const stats = request.result || {
                    id: 'stats',
                    totalGames: 0,
                    totalScore: 0,
                    totalLines: 0,
                    highestScore: 0,
                    highestLevel: 0,
                    bestScorePerLevel: {},
                };
                resolve(stats);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Retrieves game history
     * @param {number} limit - Number of recent games to retrieve
     * @returns {Promise<Array<Object>>} Array of recent games
     */
    async getGameHistory(limit = 20) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.GAME_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.GAME_HISTORY);
            const index = store.index('timestamp');
            const request = index.openCursor(null, 'prev'); // Most recent first

            const history = [];
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && history.length < limit) {
                    history.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(history);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Gets the rank of a score among all scores, or among one mode's
     * @param {number} score - Score to rank
     * @param {{ mode?: string|null }} [options] - Rank among this mode's scores only
     * @returns {Promise<number>} Rank (1-based)
     */
    async getRank(score, { mode = null } = {}) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readonly');
            const store = transaction.objectStore(this.STORES.HIGH_SCORES);
            // One more than the scores above it.
            const request = mode
                ? store.index('mode_score').count(IDBKeyRange.bound([mode, score], [mode, Infinity], true))
                : store.index('score').count(IDBKeyRange.lowerBound(score, true));
            request.onsuccess = () => resolve(request.result + 1);
            request.onerror = () => reject(request.error);
        });
    }

    /** Every saved score, any mode, in store order. */
    async getAllScores() {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readonly');
            const request = transaction.objectStore(this.STORES.HIGH_SCORES).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    // Private helper methods

    /**
     * Trims a store inside its caller's transaction without reading retained values.
     * @private
     */
    _trimStore(store, indexName, limit, range = null) {
        const request = store.index(indexName).openKeyCursor(range, 'prev');
        let skippedRetained = false;
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) return;
            if (!skippedRetained && limit > 0) {
                skippedRetained = true;
                cursor.advance(limit);
                return;
            }
            // An index key cursor cannot delete; delete by its primary key so
            // tied scores/timestamps retain the existing descending ID order.
            store.delete(cursor.primaryKey);
            cursor.continue();
        };
    }

    // ============================================================
    // Cloud Sync Helpers
    // ============================================================

    async exportHighScores(limit = SCORES_PER_MODE) {
        const scores = keepTopScoresPerMode(await this.getAllScores(), limit);
        return scores.map((entry) => {
            const clone = { ...entry };
            delete clone.id;
            return clone;
        });
    }

    async exportStatistics() {
        return this.getStatistics();
    }

    async importHighScores(entries = [], { merge = true } = {}) {
        if (!this.db) await this.init();
        const incoming = (Array.isArray(entries) ? entries : []).map(sanitizeImportedScore).filter(Boolean);
        const existing = merge ? await this.getAllScores() : [];

        const combined = [...existing, ...incoming].map((entry) => {
            const clone = { ...entry };
            delete clone.id;
            return clone;
        });

        const deduped = [];
        const seen = new Set();
        for (const entry of combined) {
            const key = [
                entry.score ?? 0,
                entry.lines ?? 0,
                entry.level ?? 0,
                entry.timestamp ?? 0,
            ].join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(entry);
        }

        const trimmed = keepTopScoresPerMode(deduped);
        // One commit prevents repeated transaction overhead and keeps the old
        // scores intact if any imported record fails to write.
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error || new Error('High score import aborted'));
            transaction.onerror = () => reject(transaction.error);
            try {
                const store = transaction.objectStore(this.STORES.HIGH_SCORES);
                store.clear();
                for (const entry of trimmed) store.add(entry);
            } catch (error) {
                transaction.abort();
                reject(error);
            }
        });
        return trimmed.length;
    }

    async importStatistics(statistics = {}, { merge = true } = {}) {
        if (!this.db) await this.init();
        const incoming = statistics || {};

        // Both records are snapshots of the same lifetime history, so a merge
        // keeps the larger counters (see score-statistics.js). Read, merge and
        // write in one transaction so a game saved meanwhile is never
        // overwritten, and resolve only once the write has committed.
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.STATISTICS], 'readwrite');
            const store = transaction.objectStore(this.STORES.STATISTICS);
            let merged = null;
            let failure = null;
            const write = (stored) => {
                try {
                    merged = mergeStatisticsSnapshots(stored, incoming);
                    store.put(merged);
                } catch (error) {
                    failure = error;
                    transaction.abort();
                }
            };
            transaction.oncomplete = () => resolve(merged);
            transaction.onabort = () => reject(failure || transaction.error || new Error('Statistics import aborted'));
            if (!merge) {
                write(null);
                return;
            }
            const request = store.get('stats');
            request.onsuccess = () => write(request.result);
        });
    }

    async _clearStore(storeName) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}
