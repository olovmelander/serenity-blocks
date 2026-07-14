/**
 * @fileoverview GameplayHybridEngine - Orchestrates Odyssey Mode gameplay systems
 *
 * Main coordinator that:
 * - Creates GameState configured for the level
 * - Applies modifiers
 * - Wraps physics callbacks
 * - Connects victory/failure evaluation
 */

import { GameState, applyGarbage } from '../game.js';
import {
    ROWS, HIDDEN_ROWS, LEVEL_SPEEDS,
} from '../constants.js';
import { columnsToMask, maskArrayToBits } from '../garbage.js';
import { VictoryConditionEvaluator } from './VictoryConditionEvaluator.js';
import { ModifierStack } from './ModifierStack.js';
import { MechanicsMixer } from './MechanicsMixer.js';
import { bindLegacySessionRng } from '../session-rng.js';

const ODYSSEY_SEED_HOLE_PATTERNS = Object.freeze([
    [4],
    [5],
    [3, 7],
    [2, 6],
    [1, 5, 8],
    [0, 4, 9],
]);

function buildStartingRowEntries(rowCount, levelId = 0) {
    return Array.from({ length: rowCount }, (_, index) => {
        const patternIndex = (levelId + index) % ODYSSEY_SEED_HOLE_PATTERNS.length;
        const holeMask = maskArrayToBits(columnsToMask(ODYSSEY_SEED_HOLE_PATTERNS[patternIndex]));

        return {
            type: 'line',
            attackId: `odyssey-start-${levelId}`,
            variant: 'normal',
            holeMask,
            color: '#808080',
        };
    });
}

/**
 * GameplayHybridEngine - Configures gameplay for Odyssey Mode levels
 */
export class GameplayHybridEngine {
    constructor() {
        this.levelConfig = null;
        this.gameState = null;

        // Sub-systems
        this.victoryEvaluator = new VictoryConditionEvaluator();
        this.modifierStack = new ModifierStack();
        this.mechanicsMixer = new MechanicsMixer();
    }

    /**
     * Configure the engine for a specific level
     * @param {Object} levelConfig - Level configuration
     */
    configure(levelConfig) {
        this.levelConfig = levelConfig;

        // Reset evaluator
        this.victoryEvaluator.reset();

        // Configure mechanics mixer
        this.mechanicsMixer.configureFromLevel(levelConfig);

        // Activate modifiers
        const modifierIds = levelConfig.modifiers?.active || [];
        this.modifierStack.activate(modifierIds);

        console.log(`[HybridEngine] Configured for level: ${levelConfig.name}`);
        console.log(`[HybridEngine] Base mode: ${levelConfig.mechanics.baseMode}`);
        console.log(`[HybridEngine] Modifiers: ${modifierIds.join(', ') || 'none'}`);
    }

    /**
     * Create a GameState configured for the current level
     * @param {Object} [gameStateOverrides] - Fixed-clock-only supplemental options
     * @returns {GameState}
     */
    createGameState(gameStateOverrides = {}) {
        if (!this.levelConfig) {
            throw new Error('[HybridEngine] Must call configure() before createGameState()');
        }

        const { mechanics } = this.levelConfig;
        const mixer = this.mechanicsMixer;

        // Determine if using infinity mode features
        const isInfinityBased = mechanics.baseMode === 'infinity' || mechanics.baseMode === 'hybrid';

        // Keep authored Odyssey mechanics authoritative. This optional seam exists only
        // for deterministic clock/input policy; it is not a general override bag.
        const supplementalOptions = {
            ...(gameStateOverrides.inputHandling !== undefined
                ? { inputHandling: gameStateOverrides.inputHandling }
                : {}),
            ...(gameStateOverrides.hitStopEnabled !== undefined
                ? { hitStopEnabled: gameStateOverrides.hitStopEnabled }
                : {}),
            ...(gameStateOverrides.infinitySpawnPolicy !== undefined
                ? { infinitySpawnPolicy: gameStateOverrides.infinitySpawnPolicy }
                : {}),
            ...(gameStateOverrides.infinityVisibleRows !== undefined
                ? { infinityVisibleRows: gameStateOverrides.infinityVisibleRows }
                : {}),
            ...(gameStateOverrides.rngSeed !== undefined
                ? { rngSeed: gameStateOverrides.rngSeed }
                : {}),
        };
        const options = {
            ...supplementalOptions,
            isInfinityMode: isInfinityBased,
            maxRows: mechanics.board.rows || ROWS,
            disableLevelProgression: !mixer.hasLevelProgression(),
            disableGarbage: true, // Odyssey mode doesn't use garbage attacks
            initialInfinityRows: (mechanics.board.rows || ROWS) + HIDDEN_ROWS,
        };

        this.gameState = new GameState(options);
        if (supplementalOptions.rngSeed !== undefined) {
            bindLegacySessionRng(this.gameState, supplementalOptions.rngSeed);
        }

        // Set starting level
        this.gameState.level = mechanics.speed.startLevel || 1;
        this.gameState.dropInterval = mechanics.speed.fixedDropInterval
            || LEVEL_SPEEDS[this.gameState.level - 1] || 1000;

        // Apply modifiers to game state
        this.modifierStack.applyToGameState(this.gameState);

        this.seedStartingRows();

        console.log('[HybridEngine] GameState created:', {
            isInfinityMode: isInfinityBased,
            rows: mechanics.board.rows,
            startingRows: mechanics.board.startingRows || 0,
            startLevel: this.gameState.level,
            dropInterval: this.gameState.dropInterval,
        });

        return this.gameState;
    }

    seedStartingRows() {
        const requestedRows = Number(this.levelConfig?.mechanics?.board?.startingRows) || 0;
        if (!this.gameState || requestedRows <= 0) {
            return;
        }

        const totalRows = this.gameState.boardGrid?.length || (ROWS + HIDDEN_ROWS);
        const maxSeedRows = Math.max(0, totalRows - HIDDEN_ROWS - 4);
        const rowCount = Math.min(Math.floor(requestedRows), maxSeedRows);
        if (rowCount <= 0) {
            return;
        }

        const entries = buildStartingRowEntries(rowCount, this.levelConfig?.id || 0);
        // Board mutation + grid/cache repair live in the ONE boundary (§5.1).
        const result = applyGarbage(this.gameState, entries, { settleFloatingBlocks: false });

        if (result?.topOut) {
            this.gameState.isGameOver = true;
        }
    }

    /**
     * Build physics callbacks with level-specific modifications
     * @param {Object} baseCallbacks - Base physics callbacks
     * @returns {Object} - Modified callbacks wrapped with metric tracking
     */
    buildPhysicsCallbacks(baseCallbacks) {
        // Start with base callbacks
        let modifiedCallbacks = { ...baseCallbacks };

        // Wrap line clear to track metrics
        const originalOnLineClear = modifiedCallbacks.onLineClear;
        modifiedCallbacks.onLineClear = (lineCount, ...args) => {
            this.victoryEvaluator.onLineClear(lineCount);
            originalOnLineClear?.(lineCount, ...args);
        };

        // Wrap combo tracking
        const originalTriggerCombo = modifiedCallbacks.triggerCombo;
        modifiedCallbacks.triggerCombo = (comboCount, ...args) => {
            this.victoryEvaluator.onCombo(comboCount);
            originalTriggerCombo?.(comboCount, ...args);
        };

        // Wrap cascade tracking
        // IMPORTANT: Only count cascade SEQUENCES (one per piece placement that causes cascades)
        // not cascade WAVES (each step within a chain). cascadeCount=2 means first wave of a sequence.
        const originalTriggerCascadeWave = modifiedCallbacks.triggerCascadeWave;
        modifiedCallbacks.triggerCascadeWave = (cascadeCount, ...args) => {
            // Only increment cascade count on first wave (cascadeCount === 2)
            // but always track max depth for bonus objectives
            const isNewSequence = cascadeCount === 2;
            this.victoryEvaluator.onCascade(cascadeCount, isNewSequence);
            originalTriggerCascadeWave?.(cascadeCount, ...args);
        };

        // Wrap piece lock for metrics
        const originalOnPieceLock = modifiedCallbacks.onPieceLock;
        modifiedCallbacks.onPieceLock = (piece, ...args) => {
            this.victoryEvaluator.onPiecePlaced();
            originalOnPieceLock?.(piece, ...args);
        };

        // Apply modifier-specific callback wrappers
        modifiedCallbacks = this.modifierStack.applyToCallbacks(modifiedCallbacks, this.gameState);

        return modifiedCallbacks;
    }

    /**
     * Update time metric
     * @param {number} elapsedSeconds
     */
    updateTime(elapsedSeconds) {
        this.victoryEvaluator.updateTime(elapsedSeconds);
    }

    /**
     * Update score metric
     * @param {number} score
     */
    updateScore(score) {
        this.victoryEvaluator.updateScore(score);
    }

    /**
     * Check if victory condition is met
     * @returns {boolean}
     */
    checkVictory() {
        if (!this.levelConfig || !this.gameState) return false;
        return this.victoryEvaluator.evaluate(this.gameState, this.levelConfig.victory);
    }

    /**
     * Check if failure condition is met
     * @returns {boolean}
     */
    checkFailure() {
        if (!this.levelConfig || !this.gameState) return false;
        return this.victoryEvaluator.evaluateFailure(this.gameState, this.levelConfig.victory);
    }

    /**
     * Calculate star rating for level completion
     * @returns {number} 0-3 stars
     */
    calculateStars() {
        if (!this.levelConfig) return 0;
        return this.victoryEvaluator.calculateStars(this.levelConfig.stars, this.gameState);
    }

    /**
     * Evaluate bonus objectives
     * @returns {boolean[]}
     */
    evaluateBonuses() {
        if (!this.levelConfig) return [];
        return this.victoryEvaluator.evaluateBonuses(this.levelConfig.victory.bonuses);
    }

    /**
     * Get current tracked metrics
     * @returns {Object}
     */
    getMetrics() {
        return this.victoryEvaluator.getMetrics();
    }

    /**
     * Get active modifier display info
     * @returns {Object[]}
     */
    getActiveModifiers() {
        return this.modifierStack.getDisplayInfo();
    }

    /**
     * Get current mechanics configuration
     * @returns {Object}
     */
    getMechanics() {
        return this.mechanicsMixer.getAll();
    }

    /**
     * Check if a specific modifier is active
     * @param {string} modifierId
     * @returns {boolean}
     */
    hasModifier(modifierId) {
        return this.modifierStack.isActive(modifierId);
    }

    /**
     * Reset the engine (call when leaving level)
     */
    reset() {
        this.levelConfig = null;
        this.gameState = null;
        this.victoryEvaluator.reset();
        this.modifierStack.clear();
        this.mechanicsMixer.reset();
    }
}

export default GameplayHybridEngine;
