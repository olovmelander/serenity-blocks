/**
 * @fileoverview LevelRegistry - Central registry for Odyssey Mode level configurations
 *
 * Provides access to level data, chapter information, and navigation helpers.
 * Level data is loaded from data/levels.js and data/chapters.js
 */

import { LEVEL_CONFIGS } from './data/levels.js';
import { CHAPTER_CONFIGS } from './data/chapters.js';

export class LevelRegistry {
    constructor() {
        this.levels = new Map();
        this.chapters = new Map();
        this.levelsByChapter = new Map();

        this.loadLevelData();
    }

    /**
     * Load and index all level and chapter data
     */
    loadLevelData() {
        // Index levels by ID
        for (const level of LEVEL_CONFIGS) {
            this.levels.set(level.id, level);

            // Index by chapter
            if (!this.levelsByChapter.has(level.chapter)) {
                this.levelsByChapter.set(level.chapter, []);
            }
            this.levelsByChapter.get(level.chapter).push(level);
        }

        // Index chapters
        for (const chapter of CHAPTER_CONFIGS) {
            this.chapters.set(chapter.id, chapter);
        }

        console.log(`[LevelRegistry] Loaded ${this.levels.size} levels in ${this.chapters.size} chapters`);
    }

    // =============================
    // Level Access
    // =============================

    /**
     * Get a level configuration by ID
     * @param {number} levelId
     * @returns {Object|null}
     */
    getLevel(levelId) {
        return this.levels.get(levelId) || null;
    }

    /**
     * Get all levels
     * @returns {Object[]}
     */
    getAllLevels() {
        return Array.from(this.levels.values());
    }

    /**
     * Get levels in a specific chapter
     * @param {number} chapterId
     * @returns {Object[]}
     */
    getLevelsInChapter(chapterId) {
        return this.levelsByChapter.get(chapterId) || [];
    }

    /**
     * Get the first level in a chapter
     * @param {number} chapterId
     * @returns {Object|null}
     */
    getChapterStartLevel(chapterId) {
        const levels = this.getLevelsInChapter(chapterId);
        return levels.find((l) => l.isChapterStart) || levels[0] || null;
    }

    /**
     * Get the last level in a chapter
     * @param {number} chapterId
     * @returns {Object|null}
     */
    getChapterEndLevel(chapterId) {
        const levels = this.getLevelsInChapter(chapterId);
        return levels.find((l) => l.isChapterEnd) || levels[levels.length - 1] || null;
    }

    // =============================
    // Chapter Access
    // =============================

    /**
     * Get a chapter configuration by ID
     * @param {number} chapterId
     * @returns {Object|null}
     */
    getChapter(chapterId) {
        return this.chapters.get(chapterId) || null;
    }

    /**
     * Get all chapters
     * @returns {Object[]}
     */
    getAllChapters() {
        return Array.from(this.chapters.values());
    }

    /**
     * Get chapter for a given level
     * @param {number} levelId
     * @returns {Object|null}
     */
    getChapterForLevel(levelId) {
        const level = this.getLevel(levelId);
        if (!level) return null;
        return this.getChapter(level.chapter);
    }

    // =============================
    // Navigation
    // =============================

    /**
     * Get the next level in sequence
     * @param {number} levelId
     * @returns {Object|null}
     */
    getNextLevel(levelId) {
        return this.getLevel(levelId + 1);
    }

    /**
     * Get the previous level in sequence
     * @param {number} levelId
     * @returns {Object|null}
     */
    getPreviousLevel(levelId) {
        if (levelId <= 1) return null;
        return this.getLevel(levelId - 1);
    }

    /**
     * Check if this is the last level in a chapter
     * @param {number} levelId
     * @returns {boolean}
     */
    isChapterEnd(levelId) {
        const level = this.getLevel(levelId);
        return level ? level.isChapterEnd : false;
    }

    /**
     * Check if this is the first level in a chapter
     * @param {number} levelId
     * @returns {boolean}
     */
    isChapterStart(levelId) {
        const level = this.getLevel(levelId);
        return level ? level.isChapterStart : false;
    }

    /**
     * Check if this is the final level in the odyssey
     * @param {number} levelId
     * @returns {boolean}
     */
    isFinalLevel(levelId) {
        return levelId === this.getTotalLevels();
    }

    // =============================
    // Queries
    // =============================

    /**
     * Get total number of levels
     * @returns {number}
     */
    getTotalLevels() {
        return this.levels.size;
    }

    /**
     * Get total number of chapters
     * @returns {number}
     */
    getTotalChapters() {
        return this.chapters.size;
    }

    /**
     * Find levels by base mode
     * @param {string} baseMode - 'standard' | 'infinity' | 'hybrid'
     * @returns {Object[]}
     */
    getLevelsByMode(baseMode) {
        return Array.from(this.levels.values()).filter(
            (level) => level.mechanics.baseMode === baseMode,
        );
    }

    /**
     * Find levels with a specific modifier
     * @param {string} modifierId
     * @returns {Object[]}
     */
    getLevelsWithModifier(modifierId) {
        return Array.from(this.levels.values()).filter(
            (level) => level.modifiers.active.includes(modifierId),
        );
    }

    /**
     * Get levels by difficulty range
     * @param {number} minDifficulty
     * @param {number} maxDifficulty
     * @returns {Object[]}
     */
    getLevelsByDifficulty(minDifficulty, maxDifficulty) {
        return Array.from(this.levels.values()).filter(
            (level) => level.metadata.difficulty >= minDifficulty
                     && level.metadata.difficulty <= maxDifficulty,
        );
    }

    // =============================
    // Theme Queries
    // =============================

    /**
     * Get primary theme for a level
     * @param {number} levelId
     * @returns {string|null}
     */
    getLevelTheme(levelId) {
        const level = this.getLevel(levelId);
        return level ? level.theme.primary : null;
    }

    /**
     * Get all themes used in a chapter
     * @param {number} chapterId
     * @returns {string[]}
     */
    getChapterThemes(chapterId) {
        const chapter = this.getChapter(chapterId);
        if (!chapter) return [];

        return [
            ...chapter.themes.primary,
            ...chapter.themes.supporting,
        ];
    }

    // =============================
    // Validation
    // =============================

    /**
     * Validate a level configuration
     * @param {Object} levelConfig
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    validateLevel(levelConfig) {
        const errors = [];

        if (!levelConfig.id) errors.push('Missing level ID');
        if (!levelConfig.name) errors.push('Missing level name');
        if (!levelConfig.chapter) errors.push('Missing chapter assignment');
        if (!levelConfig.mechanics) errors.push('Missing mechanics config');
        if (!levelConfig.victory) errors.push('Missing victory config');
        if (!levelConfig.theme) errors.push('Missing theme config');

        if (levelConfig.mechanics) {
            if (!['standard', 'infinity', 'hybrid'].includes(levelConfig.mechanics.baseMode)) {
                errors.push(`Invalid baseMode: ${levelConfig.mechanics.baseMode}`);
            }
        }

        if (levelConfig.victory) {
            const validTypes = ['lines', 'score', 'time', 'height', 'cascade', 'combo', 'custom'];
            if (!validTypes.includes(levelConfig.victory.primary.type)) {
                errors.push(`Invalid victory type: ${levelConfig.victory.primary.type}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Validate all levels and report issues
     * @returns {Object} Validation report
     */
    validateAll() {
        const report = {
            valid: true,
            levelErrors: new Map(),
            warnings: [],
        };

        for (const level of this.levels.values()) {
            const result = this.validateLevel(level);
            if (!result.valid) {
                report.valid = false;
                report.levelErrors.set(level.id, result.errors);
            }
        }

        // Check for gaps in level IDs
        const maxId = Math.max(...Array.from(this.levels.keys()));
        for (let i = 1; i <= maxId; i++) {
            if (!this.levels.has(i)) {
                report.warnings.push(`Missing level ID: ${i}`);
            }
        }

        return report;
    }

    // =============================
    // Hot Reload (Dev Mode)
    // =============================

    /**
     * Reload level data (for development hot-reloading)
     */
    async reloadLevelData() {
        this.levels.clear();
        this.chapters.clear();
        this.levelsByChapter.clear();

        // Re-import modules (with cache busting in dev)
        try {
            const timestamp = Date.now();
            const levelsModule = await import(`./data/levels.js?t=${timestamp}`);
            const chaptersModule = await import(`./data/chapters.js?t=${timestamp}`);

            // Re-index
            for (const level of levelsModule.LEVEL_CONFIGS) {
                this.levels.set(level.id, level);
                if (!this.levelsByChapter.has(level.chapter)) {
                    this.levelsByChapter.set(level.chapter, []);
                }
                this.levelsByChapter.get(level.chapter).push(level);
            }

            for (const chapter of chaptersModule.CHAPTER_CONFIGS) {
                this.chapters.set(chapter.id, chapter);
            }

            console.log('[LevelRegistry] Level data reloaded');
            return true;
        } catch (error) {
            console.error('[LevelRegistry] Failed to reload level data:', error);
            return false;
        }
    }
}

// Singleton instance
let registryInstance = null;

/**
 * Get the singleton LevelRegistry instance
 * @returns {LevelRegistry}
 */
export function getLevelRegistry() {
    if (!registryInstance) {
        registryInstance = new LevelRegistry();
    }
    return registryInstance;
}

export default LevelRegistry;
