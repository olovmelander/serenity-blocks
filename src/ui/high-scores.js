/**
 * @fileoverview High Score Management System for Serenity Blocks
 * Uses IndexedDB to store high scores, game history, and statistics
 */

/**
 * Manages high scores, game history, and statistics using IndexedDB
 */
export class HighScoreManager {
    constructor() {
        this.db = null;
        this.DB_NAME = 'SerenityBlocksDB';
        this.DB_VERSION = 1;
        this.STORES = {
            HIGH_SCORES: 'highScores',
            STATISTICS: 'statistics',
            GAME_HISTORY: 'gameHistory',
        };
    }

    /**
     * Initializes the IndexedDB database
     * @returns {Promise<void>}
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
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
            };
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

        return this.saveScore({
            ...scoreData,
            theme,
            musicTrack,
            speedMultiplier,
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
     * @returns {Promise<Object>} The saved game record
     */
    async saveScore(scoreData) {
        if (!this.db) await this.init();

        const gameRecord = {
            score: scoreData.score,
            lines: scoreData.lines,
            level: scoreData.level,
            speedMultiplier: scoreData.speedMultiplier,
            theme: scoreData.theme,
            musicTrack: scoreData.musicTrack,
            timestamp: Date.now(),
        };

        // Save to high scores
        await this._addToStore(this.STORES.HIGH_SCORES, gameRecord);

        // Save to game history
        await this._addToStore(this.STORES.GAME_HISTORY, gameRecord);

        // Trim high scores to top 100
        await this._trimHighScores(100);

        // Trim game history to last 50 games
        await this._trimGameHistory(50);

        // Update statistics
        await this._updateStatistics(gameRecord);

        return gameRecord;
    }

    /**
     * Retrieves top scores
     * @param {number} limit - Number of top scores to retrieve
     * @returns {Promise<Array<Object>>} Array of top scores
     */
    async getTopScores(limit = 10) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readonly');
            const store = transaction.objectStore(this.STORES.HIGH_SCORES);
            const index = store.index('score');
            const request = index.openCursor(null, 'prev'); // Descending order

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
     * Gets the rank of a score among all scores
     * @param {number} score - Score to rank
     * @returns {Promise<number>} Rank (1-based)
     */
    async getRank(score) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readonly');
            const store = transaction.objectStore(this.STORES.HIGH_SCORES);
            const index = store.index('score');
            const request = index.openCursor(IDBKeyRange.lowerBound(score, true), 'prev');

            let rank = 1;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    rank++;
                    cursor.continue();
                } else {
                    resolve(rank);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // Private helper methods

    /**
     * Adds a record to a store
     * @private
     */
    async _addToStore(storeName, data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Trims high scores to keep only top N
     * @private
     */
    async _trimHighScores(limit) {
        const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readwrite');
        const store = transaction.objectStore(this.STORES.HIGH_SCORES);
        const index = store.index('score');
        const request = index.openCursor(null, 'prev');

        let count = 0;
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                count++;
                if (count > limit) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
    }

    /**
     * Trims game history to keep only last N games
     * @private
     */
    async _trimGameHistory(limit) {
        const transaction = this.db.transaction([this.STORES.GAME_HISTORY], 'readwrite');
        const store = transaction.objectStore(this.STORES.GAME_HISTORY);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev');

        let count = 0;
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                count++;
                if (count > limit) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
    }

    /**
     * Updates aggregate statistics after a game
     * @private
     */
    async _updateStatistics(gameRecord) {
        const stats = await this.getStatistics();

        stats.totalGames++;
        stats.totalScore += gameRecord.score;
        stats.totalLines += gameRecord.lines;
        stats.highestScore = Math.max(stats.highestScore, gameRecord.score);
        stats.highestLevel = Math.max(stats.highestLevel, gameRecord.level);

        // Track best score per level
        if (
            !stats.bestScorePerLevel[gameRecord.level]
            || gameRecord.score > stats.bestScorePerLevel[gameRecord.level]
        ) {
            stats.bestScorePerLevel[gameRecord.level] = gameRecord.score;
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORES.STATISTICS], 'readwrite');
            const store = transaction.objectStore(this.STORES.STATISTICS);
            const request = store.put(stats);

            request.onsuccess = () => resolve(stats);
            request.onerror = () => reject(request.error);
        });
    }
}
