/**
 * @fileoverview GameplayHybridEngine - Orchestrates Odyssey Mode gameplay systems
 *
 * Main coordinator that:
 * - Creates GameState configured for the level
 * - Applies modifiers
 * - Wraps physics callbacks
 * - Connects victory/failure evaluation
 */

import { GameState } from '../game.js';
import {
    COLS, ROWS, HIDDEN_ROWS, LEVEL_SPEEDS,
} from '../constants.js';
import { VictoryConditionEvaluator } from './VictoryConditionEvaluator.js';
import { ModifierStack } from './ModifierStack.js';
import { MechanicsMixer } from './MechanicsMixer.js';

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
     * @returns {GameState}
     */
    createGameState() {
        if (!this.levelConfig) {
            throw new Error('[HybridEngine] Must call configure() before createGameState()');
        }

        const { mechanics } = this.levelConfig;
        const mixer = this.mechanicsMixer;

        // Determine if using infinity mode features
        const isInfinityBased = mechanics.baseMode === 'infinity' || mechanics.baseMode === 'hybrid';

        const options = {
            isInfinityMode: isInfinityBased,
            maxRows: mechanics.board.rows || ROWS,
            disableLevelProgression: !mixer.hasLevelProgression(),
            disableGarbage: true, // Odyssey mode doesn't use garbage attacks
            initialInfinityRows: (mechanics.board.rows || ROWS) + HIDDEN_ROWS,
        };

        this.gameState = new GameState(options);

        // Set starting level
        this.gameState.level = mechanics.speed.startLevel || 1;
        this.gameState.dropInterval = mechanics.speed.fixedDropInterval
            || LEVEL_SPEEDS[this.gameState.level - 1] || 1000;

        // Apply modifiers to game state
        this.modifierStack.applyToGameState(this.gameState);

        console.log('[HybridEngine] GameState created:', {
            isInfinityMode: isInfinityBased,
            rows: mechanics.board.rows,
            startLevel: this.gameState.level,
            dropInterval: this.gameState.dropInterval,
        });

        return this.gameState;
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
