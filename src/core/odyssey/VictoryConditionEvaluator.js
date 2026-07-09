/**
 * @fileoverview VictoryConditionEvaluator - Evaluates victory/failure conditions for Odyssey Mode
 *
 * Tracks gameplay metrics and evaluates whether victory/failure/bonus conditions are met.
 * Extracted from inline OdysseyMode logic to enable reuse and testing.
 */

/**
 * VictoryConditionEvaluator - Tracks metrics and evaluates level conditions
 */
export class VictoryConditionEvaluator {
    constructor() {
        this.reset();
    }

    /**
     * Reset all tracked metrics
     */
    reset() {
        this.trackedMetrics = {
            lines: 0,
            score: 0,
            time: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            combos: 0,
            maxCombo: 0,
            tetrises: 0,
            singles: 0,
            doubles: 0,
            triples: 0,
            height: 0,
            piecesPlaced: 0,
        };
    }

    /**
     * Get current metrics snapshot
     * @returns {Object}
     */
    getMetrics() {
        return { ...this.trackedMetrics };
    }

    // =============================
    // Metric Updates
    // =============================

    /**
     * Track a line clear event
     * @param {number} lineCount - Number of lines cleared
     */
    onLineClear(lineCount) {
        this.trackedMetrics.lines += lineCount;

        switch (lineCount) {
        case 1:
            this.trackedMetrics.singles++;
            break;
        case 2:
            this.trackedMetrics.doubles++;
            break;
        case 3:
            this.trackedMetrics.triples++;
            break;
        case 4:
            this.trackedMetrics.tetrises++;
            break;
        }
    }

    /**
     * Track a cascade event
     * @param {number} cascadeDepth - Depth of the cascade chain
     * @param {boolean} isNewSequence - True if this is the start of a new cascade sequence
     */
    onCascade(cascadeDepth, isNewSequence = true) {
        // Only count cascade sequences (one per piece that triggers cascades)
        // not individual waves within a chain
        if (isNewSequence) {
            this.trackedMetrics.cascades++;
        }
        // Always track max depth for bonus objectives
        this.trackedMetrics.maxCascadeDepth = Math.max(
            this.trackedMetrics.maxCascadeDepth,
            cascadeDepth,
        );
    }

    /**
     * Track a combo event
     * @param {number} comboCount - Current combo count
     */
    onCombo(comboCount) {
        this.trackedMetrics.combos++;
        this.trackedMetrics.maxCombo = Math.max(
            this.trackedMetrics.maxCombo,
            comboCount,
        );
    }

    /**
     * Update elapsed time
     * @param {number} elapsed - Time in seconds
     */
    updateTime(elapsed) {
        this.trackedMetrics.time = elapsed;
    }

    /**
     * Update current score
     * @param {number} score
     */
    updateScore(score) {
        this.trackedMetrics.score = score;
    }

    /**
     * Update height metric (for a possible future 'height' victory level — the type is a
     * supported-but-unused capability: the difficulty model derives targets for it and it is in
     * LevelRegistry validTypes, so this stays wired. Fully removing it is a "delete or author"
     * design decision, not a dead-code deletion.)
     * @param {number} height - Current build height
     */
    updateHeight(height) {
        this.trackedMetrics.height = Math.max(this.trackedMetrics.height, height);
    }

    /**
     * Track a piece placed
     */
    onPiecePlaced() {
        this.trackedMetrics.piecesPlaced++;
    }

    // =============================
    // Victory Evaluation
    // =============================

    /**
     * Evaluate if the primary victory condition is met
     * @param {Object} gameState - Current game state
     * @param {Object} victoryConfig - Victory configuration from level
     * @returns {boolean}
     */
    evaluate(gameState, victoryConfig) {
        const condition = victoryConfig.primary;

        switch (condition.type) {
        case 'lines':
            return this.trackedMetrics.lines >= condition.target;

        case 'score':
            return (gameState?.score ?? this.trackedMetrics.score) >= condition.target;

        case 'time':
            return this.trackedMetrics.time >= condition.target;

        case 'cascade':
            return this.trackedMetrics.cascades >= condition.target;

        case 'height':
            return this.trackedMetrics.height >= condition.target;

        case 'combo':
            return this.trackedMetrics.maxCombo >= condition.target;

        case 'tetrises':
            return this.trackedMetrics.tetrises >= condition.target;

        case 'custom':
            if (typeof condition.evaluator === 'function') {
                return condition.evaluator(this.trackedMetrics, gameState);
            }
            console.warn('[VictoryEvaluator] Custom condition missing evaluator function');
            return false;

        default:
            console.warn(`[VictoryEvaluator] Unknown victory condition: ${condition.type}`);
            return false;
        }
    }

    /**
     * Evaluate if a failure condition is met
     * @param {Object} gameState - Current game state
     * @param {Object} victoryConfig - Victory configuration from level
     * @returns {boolean}
     */
    evaluateFailure(gameState, victoryConfig) {
        const { failure } = victoryConfig;

        switch (failure.type) {
        case 'top-out':
            return gameState?.isGameOver ?? false;

        case 'time':
            return this.trackedMetrics.time >= failure.value;

        case 'none':
            return false;

        default:
            return false;
        }
    }

    /**
     * Evaluate bonus objectives
     * @param {Object[]} bonuses - Array of bonus objectives from level config
     * @returns {boolean[]} - Array of boolean results for each bonus
     */
    evaluateBonuses(bonuses) {
        if (!bonuses || bonuses.length === 0) return [];

        return bonuses.map((bonus) => {
            switch (bonus.type) {
            case 'no-singles':
                return this.trackedMetrics.singles === 0;

            case 'time':
                return this.trackedMetrics.time <= bonus.target;

            case 'max-cascade-depth':
                return this.trackedMetrics.maxCascadeDepth >= bonus.target;

            case 'tetris-count':
                return this.trackedMetrics.tetrises >= bonus.target;

            case 'cascade':
                return this.trackedMetrics.cascades >= bonus.target;

            case 'combo':
                return this.trackedMetrics.maxCombo >= bonus.target;

            case 'no-top-out':
                // This is evaluated at end of level based on whether player topped out
                return true; // Will be set externally

            case 'pieces':
                return this.trackedMetrics.piecesPlaced <= bonus.target;

            default:
                console.warn(`[VictoryEvaluator] Unknown bonus type: ${bonus.type}`);
                return false;
            }
        });
    }

    /**
     * Calculate star rating based on level results
     * @param {Object} starConfig - Star thresholds from level config
     * @param {Object} gameState - Current game state
     * @returns {number} 0-3 stars
     */
    calculateStars(starConfig, gameState) {
        let earnedStars = 0;

        if (this._meetsCondition(starConfig.one, gameState)) earnedStars = 1;
        if (this._meetsCondition(starConfig.two, gameState)) earnedStars = 2;
        if (this._meetsCondition(starConfig.three, gameState)) earnedStars = 3;

        return earnedStars;
    }

    /**
     * Check if results meet a star condition
     * @private
     */
    _meetsCondition(condition, gameState) {
        if (!condition) return false;

        for (const [key, target] of Object.entries(condition)) {
            if (key === 'bonuses') {
                // Bonuses are checked separately
                continue;
            }

            // Get value from metrics or gameState
            let value = this.trackedMetrics[key];
            const gameStateValue = gameState?.[key];
            if (
                gameState
                && (value === undefined || (key === 'score' && value === 0 && Number(gameStateValue) > 0))
            ) {
                value = gameStateValue;
            }
            if (value === undefined) {
                value = 0;
            }

            // For time, lower is better
            if (key === 'time') {
                if (value > target) return false;
            } else if (value < target) return false;
        }

        return true;
    }
}

export default VictoryConditionEvaluator;
