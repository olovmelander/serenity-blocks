/**
 * @fileoverview OdysseyStateManager - Manages Odyssey Mode progression and persistence
 *
 * Handles:
 * - Level unlock tracking
 * - Completion status and star ratings
 * - Statistics aggregation
 * - Save/load to localStorage
 */

import { eventBus, EVENTS } from '../../events/event-bus.js';
import { getLevelRegistry } from './LevelRegistry.js';
import {
    ODYSSEY_SAVE_VERSION, getOdysseyCompletionThemeIds, snapshotLegacyOdysseyThemes,
} from './odyssey-progress-schema.js';

const STORAGE_KEY = 'serenityBlocks_odysseyProgress';
// v2 (2026-08-15, space lengthening): chapter 6 grew 36-44 → 36-48, so every level
// id ≥ 42 shifted +4 (the Event Horizon finale trilogy became 46-48; old ch7/ch8
// 45-55 became 49-59). v1 saves must renumber or a finished-the-game save silently
// re-points mid-ch7 — every id in a 55-level v1 save is still "valid" in a 59-level
// world, so the version gate is load-bearing, not advisory.
const V2_SHIFT_FROM_ID = 42;
const V2_SHIFT = 4;

/**
 * Migrate a raw odyssey progress document IN PLACE to the current save version and
 * return it. Pure data-shape work (no registry access) so the Steam cloud-sync layer
 * can migrate cloud documents BEFORE merging them — merging a v1 document by raw id
 * would alias old ch7 arrivals onto the new ch6 levels (false unlocks, kept stars).
 */
export function migrateOdysseyProgressData(data) {
    if (!data || typeof data !== 'object') return data;
    const version = Number(data.version) || 1;
    if (version >= ODYSSEY_SAVE_VERSION) return data;

    if (version < 2) {
        const shiftId = (id) => {
            const numeric = Number(id);
            if (!Number.isFinite(numeric)) return numeric;
            return numeric >= V2_SHIFT_FROM_ID ? numeric + V2_SHIFT : numeric;
        };
        if (Array.isArray(data.unlockedLevels)) {
            // Numeric ids in the array form.
            data.unlockedLevels = data.unlockedLevels.map(shiftId);
        }
        if (data.completedLevels && typeof data.completedLevels === 'object') {
            // STRING keys in the map form — the type asymmetry is the trap here.
            const migrated = {};
            Object.entries(data.completedLevels).forEach(([key, value]) => {
                migrated[String(shiftId(key))] = value;
            });
            data.completedLevels = migrated;
        }
        if (Number.isFinite(Number(data.currentLevel))) {
            data.currentLevel = shiftId(data.currentLevel);
        }
    }

    if (version < 3) snapshotLegacyOdysseyThemes(data);
    data.version = ODYSSEY_SAVE_VERSION;
    return data;
}

/**
 * @typedef {Object} LevelCompletion
 * @property {number} stars - Star rating (0-3)
 * @property {number} bestScore - Highest score achieved
 * @property {number} bestTime - Fastest completion time (seconds)
 * @property {boolean[]} completedBonuses - Which bonus objectives were completed
 * @property {string} completionDate - ISO date string of first completion
 * @property {number} attempts - Number of attempts
 */

/**
 * @typedef {Object} OdysseyStatistics
 * @property {number} totalPlayTime - Total time spent in Odyssey Mode (seconds)
 * @property {number} totalAttempts - Cumulative level attempts (completions + failures)
 * @property {number} totalLinesCleared - Cumulative lines cleared
 * @property {number} totalScore - Cumulative score
 * @property {number} highestCombo - Best combo achieved
 * @property {number} maxCascadeDepth - Deepest cascade achieved
 * @property {number} chaptersCompleted - Number of chapters fully completed
 * @property {number} totalStars - Sum of all stars earned
 */

export class OdysseyStateManager {
    constructor({ levelRegistry = getLevelRegistry() } = {}) {
        this.levelRegistry = levelRegistry;

        // Current position in odyssey
        this.currentChapter = 1;
        this.currentLevel = 1;

        // Progression tracking
        this.unlockedLevels = new Set([1]); // Level 1 always unlocked
        this.completedLevels = new Map(); // levelId → LevelCompletion

        // Statistics
        this.statistics = {
            totalPlayTime: 0,
            totalAttempts: 0,
            totalLinesCleared: 0,
            totalScore: 0,
            highestCombo: 0,
            maxCascadeDepth: 0,
            chaptersCompleted: 0,
            totalStars: 0,
        };

        // Session tracking (not persisted)
        this.sessionStartTime = null;
        this.currentLevelAttempts = 0;
        this.unsupportedSaveVersion = false;

        // Load saved progress
        this.load();
    }

    // =============================
    // Persistence
    // =============================

    /**
     * Save progress to localStorage
     */
    getSaveData() {
        return {
            version: ODYSSEY_SAVE_VERSION,
            currentChapter: this.currentChapter,
            currentLevel: this.currentLevel,
            unlockedLevels: Array.from(this.unlockedLevels),
            completedLevels: Object.fromEntries(this.completedLevels),
            statistics: { ...this.statistics },
            lastSaveDate: new Date().toISOString(),
        };
    }

    save({ emitEvent = true } = {}) {
        if (this.unsupportedSaveVersion) return false;
        const saveData = this.getSaveData();

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
            console.log('[OdysseyState] Progress saved successfully');
            if (emitEvent) {
                eventBus.emit(EVENTS.ODYSSEY_SAVED, {
                    data: saveData,
                    source: 'local',
                });
            }
            return true;
        } catch (error) {
            console.error('[OdysseyState] Failed to save progress:', error);
            return false;
        }
    }

    /**
     * Load progress from localStorage
     */
    load() {
        try {
            const savedData = localStorage.getItem(STORAGE_KEY);
            if (!savedData) {
                console.log('[OdysseyState] No saved progress found, starting fresh');
                return false;
            }

            const data = JSON.parse(savedData);
            if (Number(data.version) > ODYSSEY_SAVE_VERSION) {
                this.unsupportedSaveVersion = true;
                return false;
            }
            this.unsupportedSaveVersion = false;

            // Version migration if needed
            if (data.version !== ODYSSEY_SAVE_VERSION) {
                console.log(`[OdysseyState] Migrating save from v${data.version} to v${ODYSSEY_SAVE_VERSION}`);
                this.migrateSaveData(data);
            }

            // Restore state
            this.currentChapter = data.currentChapter || 1;
            this.currentLevel = data.currentLevel || 1;
            this.unlockedLevels = new Set(data.unlockedLevels || [1]);
            this.completedLevels = new Map(Object.entries(data.completedLevels || {}));
            this.statistics = { ...this.statistics, ...data.statistics };
            this._normalizeProgressState();

            console.log('[OdysseyState] Progress loaded successfully');
            console.log(`[OdysseyState] Current: Chapter ${this.currentChapter}, Level ${this.currentLevel}`);
            console.log(`[OdysseyState] Unlocked levels: ${this.unlockedLevels.size}`);
            console.log(`[OdysseyState] Completed levels: ${this.completedLevels.size}`);

            return true;
        } catch (error) {
            console.error('[OdysseyState] Failed to load progress:', error);
            return false;
        }
    }

    /**
     * Migrate save data from older versions
     * @param {Object} data - Old save data
     */
    migrateSaveData(data) {
        migrateOdysseyProgressData(data);
        console.log('[OdysseyState] Migration complete');
    }

    _normalizeProgressState() {
        const totalLevels = this.levelRegistry.getTotalLevels();

        this.unlockedLevels = new Set(
            [...this.unlockedLevels]
                .map((levelId) => Number(levelId))
                .filter((levelId) => Number.isFinite(levelId) && levelId >= 1 && levelId <= totalLevels),
        );
        if (this.unlockedLevels.size === 0) {
            this.unlockedLevels.add(1);
        }

        this.completedLevels = new Map(
            [...this.completedLevels.entries()]
                .filter(([levelId]) => {
                    const numericId = Number(levelId);
                    return Number.isFinite(numericId) && numericId >= 1 && numericId <= totalLevels;
                }),
        );

        const furthestUnlocked = Math.max(...this.unlockedLevels);
        this.currentLevel = Math.min(
            totalLevels,
            Math.max(1, Number(this.currentLevel) || 1, furthestUnlocked),
        );
        this.currentChapter = this.levelRegistry.getLevel(this.currentLevel)?.chapter || 1;
        this.statistics.totalStars = this.getTotalStars();
        this.statistics.chaptersCompleted = this.getCompletedChapterCount();
    }

    /**
     * Reset all progress (new game)
     */
    reset() {
        this.unsupportedSaveVersion = false;
        this.currentChapter = 1;
        this.currentLevel = 1;
        this.unlockedLevels = new Set([1]);
        this.completedLevels = new Map();
        this.statistics = {
            totalPlayTime: 0,
            totalAttempts: 0,
            totalLinesCleared: 0,
            totalScore: 0,
            highestCombo: 0,
            maxCascadeDepth: 0,
            chaptersCompleted: 0,
            totalStars: 0,
        };

        // Clear localStorage
        try {
            localStorage.removeItem(STORAGE_KEY);
            console.log('[OdysseyState] Progress reset');
        } catch (error) {
            console.error('[OdysseyState] Failed to clear saved progress:', error);
        }
    }

    // =============================
    // Level Progression
    // =============================

    /**
     * Check if a level is unlocked
     * @param {number} levelId
     * @returns {boolean}
     */
    isLevelUnlocked(levelId) {
        return this.unlockedLevels.has(levelId);
    }

    /**
     * Check if a level is completed
     * @param {number} levelId
     * @returns {boolean}
     */
    isLevelCompleted(levelId) {
        return this.completedLevels.has(String(levelId));
    }

    /**
     * Get completion data for a level
     * @param {number} levelId
     * @returns {LevelCompletion|null}
     */
    getLevelCompletion(levelId) {
        return this.completedLevels.get(String(levelId)) || null;
    }

    /**
     * Get star count for a level
     * @param {number} levelId
     * @returns {number} 0-3 stars
     */
    getLevelStars(levelId) {
        const completion = this.getLevelCompletion(levelId);
        return completion ? completion.stars : 0;
    }

    /**
     * Unlock a level
     * @param {number} levelId
     */
    unlockLevel(levelId) {
        if (!this.unlockedLevels.has(levelId)) {
            this.unlockedLevels.add(levelId);
            console.log(`[OdysseyState] Level ${levelId} unlocked`);
            this.save();
        }
    }

    /**
     * Record a level completion
     * @param {number} levelId
     * @param {Object} results - Level completion results
     * @param {number} results.score - Final score
     * @param {number} results.time - Completion time in seconds
     * @param {number} results.lines - Lines cleared
     * @param {number} results.stars - Star rating (1-3)
     * @param {boolean[]} results.bonuses - Bonus objectives completed
     * @param {number} results.combo - Highest combo
     * @param {number} results.maxCascadeDepth - Deepest cascade
     * @param {number} [results.cascadeDepth] - Legacy alias for deepest cascade
     */
    completeLevel(levelId, results, { themeId = this.levelRegistry.getLevel(levelId)?.theme?.primary } = {}) {
        const levelKey = String(levelId);
        const existing = this.completedLevels.get(levelKey);

        const completion = {
            stars: Math.max(results.stars || 0, existing?.stars || 0),
            bestScore: Math.max(results.score || 0, existing?.bestScore || 0),
            bestTime: existing?.bestTime
                ? Math.min(results.time || Infinity, existing.bestTime)
                : results.time || 0,
            completedBonuses: this.mergeBonuses(
                results.bonuses || [],
                existing?.completedBonuses || [],
            ),
            completionDate: existing?.completionDate || new Date().toISOString(),
            attempts: (existing?.attempts || 0) + 1,
            themeId,
            themeIds: getOdysseyCompletionThemeIds({
                themeId, themeIds: getOdysseyCompletionThemeIds(existing),
            }),
        };

        this.completedLevels.set(levelKey, completion);

        // Update statistics
        this.statistics.totalAttempts = (this.statistics.totalAttempts || 0) + 1;
        this.updateStatistics(results);

        // Unlock next level
        const nextLevel = this.levelRegistry.getNextLevel(levelId);
        if (nextLevel) {
            this.unlockedLevels.add(nextLevel.id);
        }

        // Update current position
        if (levelId >= this.currentLevel) {
            this.currentLevel = nextLevel?.id || levelId;
            this.currentChapter = nextLevel?.chapter
                || this.levelRegistry.getLevel(levelId)?.chapter
                || this.currentChapter;
        }

        console.log(`[OdysseyState] Level ${levelId} completed with ${completion.stars} stars`);
        const persisted = this.save();
        // Keep the historical completion shape in JSON and callers, while
        // exposing durability to reward presentation at the completion boundary.
        Object.defineProperty(completion, 'persisted', { value: persisted, enumerable: false });

        return completion;
    }

    /**
     * Merge bonus completion arrays (keep any true values)
     */
    mergeBonuses(newBonuses, existingBonuses) {
        const maxLength = Math.max(newBonuses.length, existingBonuses.length);
        const merged = [];

        for (let i = 0; i < maxLength; i++) {
            merged[i] = (newBonuses[i] || false) || (existingBonuses[i] || false);
        }

        return merged;
    }

    /**
     * Record a level attempt (without completion)
     * @param {number} levelId
     */
    recordAttempt(levelId) {
        this.currentLevelAttempts++;
        // Persist to the aggregate so FAILED attempts aren't lost (the per-level completion
        // record's `attempts` only counts completions — masterplan §2 #5).
        this.statistics.totalAttempts = (this.statistics.totalAttempts || 0) + 1;
        this.save();
    }

    // =============================
    // Statistics
    // =============================

    /**
     * Update aggregate statistics
     * @param {Object} sessionStats
     */
    updateStatistics(sessionStats) {
        // NOTE: totalPlayTime is accumulated ONLY by endSession() (whole-session wall-clock =
        // the documented "total time spent in Odyssey Mode"). Adding per-level results.time here
        // too double-counted it, since the session duration already contains those level times
        // (masterplan §2 #5).
        if (sessionStats.lines) {
            this.statistics.totalLinesCleared += sessionStats.lines;
        }
        if (sessionStats.score) {
            this.statistics.totalScore += sessionStats.score;
        }
        if (sessionStats.combo) {
            this.statistics.highestCombo = Math.max(
                this.statistics.highestCombo,
                sessionStats.combo,
            );
        }
        const cascadeDepth = sessionStats.maxCascadeDepth ?? sessionStats.cascadeDepth;
        if (cascadeDepth) {
            this.statistics.maxCascadeDepth = Math.max(
                this.statistics.maxCascadeDepth,
                cascadeDepth,
            );
        }

        // Recalculate total stars
        this.statistics.totalStars = this.getTotalStars();

        // Check chapters completed
        this.statistics.chaptersCompleted = this.getCompletedChapterCount();
    }

    /**
     * Get total stars earned across all levels
     * @returns {number}
     */
    getTotalStars() {
        let total = 0;
        for (const completion of this.completedLevels.values()) {
            total += completion.stars || 0;
        }
        return total;
    }

    /**
     * Get number of fully completed chapters
     * @returns {number}
     */
    getCompletedChapterCount() {
        let completedChapters = 0;

        for (const chapter of this.levelRegistry.getAllChapters()) {
            const chapterLevels = this.levelRegistry.getLevelsInChapter(chapter.id);
            if (chapterLevels.length > 0 && chapterLevels.every((level) => this.isLevelCompleted(level.id))) {
                completedChapters++;
            }
        }

        return completedChapters;
    }

    /**
     * Get stars earned in a specific chapter
     * @param {number} chapterId
     * @returns {number}
     */
    getStarsForChapter(chapterId) {
        let stars = 0;
        this.levelRegistry.getLevelsInChapter(chapterId).forEach((level) => {
            stars += this.getLevelStars(level.id);
        });

        return stars;
    }

    /**
     * Get maximum possible stars for a chapter
     * @param {number} chapterId
     * @returns {number}
     */
    getMaxStarsForChapter(chapterId) {
        return this.levelRegistry.getLevelsInChapter(chapterId).length * 3;
    }

    // =============================
    // Session Management
    // =============================

    /**
     * Start a session timer
     */
    startSession() {
        this.sessionStartTime = Date.now();
        this.currentLevelAttempts = 0;
    }

    /**
     * End session and record time
     */
    endSession() {
        if (this.sessionStartTime) {
            const sessionDuration = (Date.now() - this.sessionStartTime) / 1000;
            this.statistics.totalPlayTime += sessionDuration;
            this.sessionStartTime = null;
            this.save();
        }
    }

    /**
     * Get current session duration in seconds
     * @returns {number}
     */
    getSessionDuration() {
        if (!this.sessionStartTime) return 0;
        return (Date.now() - this.sessionStartTime) / 1000;
    }

    // =============================
    // Queries
    // =============================

    /**
     * Get overall progress percentage
     * @returns {number} 0-100
     */
    getOverallProgress() {
        const totalLevels = this.levelRegistry.getTotalLevels();
        const completed = this.completedLevels.size;
        return Math.round((completed / totalLevels) * 100);
    }

    /**
     * Get progress summary for UI
     * @returns {Object}
     */
    getProgressSummary() {
        const totalLevels = this.levelRegistry.getTotalLevels();
        const totalChapters = this.levelRegistry.getTotalChapters();
        return {
            currentChapter: this.currentChapter,
            currentLevel: this.currentLevel,
            completedLevels: this.completedLevels.size,
            totalLevels,
            totalStars: this.statistics.totalStars,
            maxStars: totalLevels * 3,
            chaptersCompleted: this.statistics.chaptersCompleted,
            totalChapters,
            overallProgress: this.getOverallProgress(),
        };
    }

    /**
     * Get chapter progress for UI
     * @param {number} chapterId
     * @returns {Object}
     */
    getChapterProgress(chapterId) {
        const chapterLevels = this.levelRegistry.getLevelsInChapter(chapterId);

        let completed = 0;
        let stars = 0;

        for (const level of chapterLevels) {
            if (this.isLevelCompleted(level.id)) {
                completed++;
            }
            stars += this.getLevelStars(level.id);
        }

        return {
            chapterId,
            completedLevels: completed,
            totalLevels: chapterLevels.length,
            stars,
            maxStars: chapterLevels.length * 3,
            isComplete: chapterLevels.length > 0 && completed === chapterLevels.length,
        };
    }
}

export default OdysseyStateManager;
