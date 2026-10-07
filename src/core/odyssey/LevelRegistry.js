/**
 * @fileoverview LevelRegistry - Central registry for Odyssey Mode level configurations
 *
 * Provides access to level data, chapter information, and navigation helpers.
 * Level data is loaded from data/levels.js and data/chapters.js
 */

import { LEVEL_CONFIGS } from './data/levels.js';
import { CHAPTER_CONFIGS } from './data/chapters.js';
import {
    applyOdysseyLayoutToLevels,
    buildOdysseyPresentationLayout,
    cloneOdysseyLayoutData,
    normalizeOdysseyLayoutData,
    ODYSSEY_LAYOUT_DATA,
} from './data/odyssey-layout.js';
import {
    hasOdysseyThemePresentationPalette,
} from './theme-presentation.js';

export class LevelRegistry {
    constructor(options = {}) {
        this.levels = new Map();
        this.chapters = new Map();
        this.levelsByChapter = new Map();
        this.sortedLevels = [];
        this.presentationByLevel = new Map();
        this.presentationLayout = null;
        this.layoutData = normalizeOdysseyLayoutData(options.layoutData || ODYSSEY_LAYOUT_DATA);

        this.loadLevelData();
    }

    /**
     * Load and index all level and chapter data
     */
    loadLevelData() {
        const resolvedLevels = applyOdysseyLayoutToLevels(LEVEL_CONFIGS, this.layoutData);

        // Index levels by ID
        for (const level of resolvedLevels) {
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

        this.rebuildDerivedData();

        console.log(`[LevelRegistry] Loaded ${this.levels.size} levels in ${this.chapters.size} chapters`);
    }

    rebuildDerivedData() {
        this.sortedLevels = Array.from(this.levels.values())
            .sort((left, right) => left.id - right.id);

        this.levelsByChapter.forEach((levels, chapterId) => {
            this.levelsByChapter.set(
                chapterId,
                [...levels].sort(
                    (left, right) => (left.chapterLevel || left.id) - (right.chapterLevel || right.id),
                ),
            );
        });

        this.presentationByLevel.clear();
        this.sortedLevels.forEach((level) => {
            this.presentationByLevel.set(level.id, this._createResolvedLevelPresentation(level));
        });

        this.presentationLayout = buildOdysseyPresentationLayout(this.sortedLevels, this.layoutData);
    }

    _createResolvedLevelPresentation(level) {
        if (!level) {
            return null;
        }

        const theme = {
            ...(level.theme || {}),
        };
        const metadata = {
            ...(level.metadata || {}),
        };
        const pathLabel = metadata.pathLabel || level.name;
        const iconThemeId = theme.pathIcon || theme.primary || null;
        const transitionPaletteThemeId = theme.transitionPalette || theme.primary || null;

        theme.pathIcon = iconThemeId;
        theme.transitionPalette = transitionPaletteThemeId;

        return {
            ...level,
            theme,
            metadata,
            description: metadata.description || '',
            iconThemeId,
            transitionPaletteThemeId,
            pathLabel,
        };
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
        return [...this.sortedLevels];
    }

    /**
     * Get levels in a specific chapter
     * @param {number} chapterId
     * @returns {Object[]}
     */
    getLevelsInChapter(chapterId) {
        return [...(this.levelsByChapter.get(chapterId) || [])];
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
        return Array.from(this.chapters.values()).sort((left, right) => left.id - right.id);
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

    getChapterName(chapterId) {
        return this.getChapter(chapterId)?.name || 'Unknown';
    }

    resolveLevelPresentation(levelOrId) {
        const levelId = typeof levelOrId === 'object' ? levelOrId?.id : levelOrId;
        if (!Number.isFinite(levelId)) {
            return null;
        }
        const presentation = this.presentationByLevel.get(levelId);
        if (!presentation) {
            return null;
        }

        return {
            ...presentation,
            theme: { ...(presentation.theme || {}) },
            metadata: { ...(presentation.metadata || {}) },
        };
    }

    getAllLevelPresentations() {
        return this.sortedLevels
            .map((level) => this.resolveLevelPresentation(level.id))
            .filter(Boolean);
    }

    getPresentationLayout() {
        return {
            controlPoints: this.presentationLayout?.controlPoints?.map((point) => ({ ...point })) || [],
            levelPositionsById: { ...(this.presentationLayout?.levelPositionsById || {}) },
            levelPositions: [...(this.presentationLayout?.levelPositions || [])],
            chapterPositions: [...(this.presentationLayout?.chapterPositions || [])],
            totalLevels: this.presentationLayout?.totalLevels || this.sortedLevels.length,
            chapterRanges: (this.presentationLayout?.chapterRanges || []).map((range) => ({ ...range })),
        };
    }

    getLayoutData() {
        return cloneOdysseyLayoutData(this.layoutData);
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
        if (!levelConfig || typeof levelConfig !== 'object') {
            return { valid: false, errors: ['Missing level config'] };
        }

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
            // 'tetrises' is supported by VictoryConditionEvaluator (primary switch) but was
            // missing here, so a tetrises-primary level would falsely fail validation (masterplan §2 #10).
            const validTypes = ['lines', 'score', 'time', 'height', 'cascade', 'combo', 'tetrises', 'frags', 'custom'];
            const { primary } = levelConfig.victory;
            if (!primary) {
                errors.push('Missing primary victory condition');
            } else if (!validTypes.includes(primary.type)) {
                errors.push(`Invalid victory type: ${primary.type}`);
            } else if (primary.type !== 'custom' && (!Number.isFinite(primary.target) || primary.target <= 0)) {
                errors.push('Victory target must be a positive number');
            }
        }

        const versus = levelConfig.mechanics?.versus;
        const primary = levelConfig.victory?.primary;
        const failure = levelConfig.victory?.failure;
        if (versus) {
            if (levelConfig.mechanics.baseMode !== 'standard') {
                errors.push('Bot duels require the standard board mode');
            }
            if (!Number.isInteger(versus.botDifficulty) || versus.botDifficulty < 1 || versus.botDifficulty > 10) {
                errors.push('Bot difficulty must be an integer from 1 to 10');
            }
            if (!Number.isInteger(versus.fragsToWin) || versus.fragsToWin <= 0) {
                errors.push('Duel frag target must be a positive integer');
            }
            if (primary?.type !== 'frags' || primary.target !== versus.fragsToWin) {
                errors.push('Duel victory must match its frag target');
            }
            if (failure?.type !== 'opponent-frags' || failure.value !== versus.fragsToWin) {
                errors.push('Duel failure must match its opponent frag target');
            }
            if (levelConfig.victoryLapPolicy !== 'none') {
                errors.push('Bot duels cannot use a victory lap');
            }
            let previousDeathLimit = Infinity;
            for (const tier of ['one', 'two', 'three']) {
                const condition = levelConfig.stars?.[tier];
                if (condition?.frags !== versus.fragsToWin) {
                    errors.push(`Duel ${tier}-star condition must match its frag target`);
                }
                if (condition?.maxDeaths !== undefined) {
                    if (!Number.isInteger(condition.maxDeaths) || condition.maxDeaths < 0) {
                        errors.push(`Duel ${tier}-star death limit must be a nonnegative integer`);
                    } else if (condition.maxDeaths > previousDeathLimit) {
                        errors.push('Duel higher stars cannot allow more deaths');
                    }
                    previousDeathLimit = condition.maxDeaths;
                }
            }
        } else if (primary?.type === 'frags' || failure?.type === 'opponent-frags') {
            errors.push('Frag objectives require a bot duel configuration');
        }

        if (primary && levelConfig.victoryLapPolicy === 'none' && primary.type !== 'time') {
            const metric = primary.type === 'cascade' ? 'cascades' : primary.type;
            for (const tier of ['one', 'two', 'three']) {
                const condition = levelConfig.stars?.[tier];
                if (Number.isFinite(condition?.[metric]) && condition[metric] > primary.target) {
                    errors.push(`${tier}-star ${metric} requirement exceeds the completion target`
                        + ' without a victory lap');
                }
            }
        }
        const bonusCount = levelConfig.victory?.bonuses?.length || 0;
        for (const tier of ['one', 'two', 'three']) {
            const requestedBonuses = levelConfig.stars?.[tier]?.bonuses;
            if (Number.isFinite(requestedBonuses) && requestedBonuses > bonusCount) {
                errors.push(`${tier}-star bonus requirement exceeds the configured bonuses`);
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
            presentationErrors: [],
            chapterErrors: [],
            warnings: [],
        };

        let previousPathPosition = -Infinity;
        for (const level of this.sortedLevels) {
            const result = this.validateLevel(level);
            if (!result.valid) {
                report.valid = false;
                report.levelErrors.set(level.id, result.errors);
            }

            if (!Number.isFinite(level.pathPosition) || level.pathPosition < 0 || level.pathPosition > 1) {
                report.valid = false;
                report.presentationErrors.push(`Level ${level.id} has invalid pathPosition ${level.pathPosition}`);
            } else if (level.pathPosition <= previousPathPosition) {
                report.valid = false;
                report.presentationErrors.push(`Level ${level.id} pathPosition ${level.pathPosition} is not strictly increasing`);
            }
            previousPathPosition = level.pathPosition;

            const themeId = level.theme?.transitionPalette || level.theme?.primary;
            if (!hasOdysseyThemePresentationPalette(themeId)) {
                report.valid = false;
                report.presentationErrors.push(`Level ${level.id} is missing Odyssey theme presentation palette for "${themeId}"`);
            }
        }

        // Check for gaps in level IDs
        const maxId = Math.max(...Array.from(this.levels.keys()));
        for (let i = 1; i <= maxId; i++) {
            if (!this.levels.has(i)) {
                report.warnings.push(`Missing level ID: ${i}`);
            }
        }

        for (const chapter of this.getAllChapters()) {
            const levels = this.getLevelsInChapter(chapter.id);
            if (levels.length === 0) {
                report.valid = false;
                report.chapterErrors.push(`Chapter ${chapter.id} has no levels`);
                continue;
            }

            const actualRange = [levels[0].id, levels[levels.length - 1].id];
            const configuredRange = chapter.levelRange || [];
            if (configuredRange[0] !== actualRange[0] || configuredRange[1] !== actualRange[1]) {
                report.valid = false;
                report.chapterErrors.push(
                    `Chapter ${chapter.id} levelRange mismatch: expected ${actualRange.join('-')} got ${configuredRange.join('-')}`,
                );
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

        try {
            const resolvedLevels = applyOdysseyLayoutToLevels(LEVEL_CONFIGS, this.layoutData);

            // Re-index
            for (const level of resolvedLevels) {
                this.levels.set(level.id, level);
                if (!this.levelsByChapter.has(level.chapter)) {
                    this.levelsByChapter.set(level.chapter, []);
                }
                this.levelsByChapter.get(level.chapter).push(level);
            }

            for (const chapter of CHAPTER_CONFIGS) {
                this.chapters.set(chapter.id, chapter);
            }

            this.rebuildDerivedData();

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
