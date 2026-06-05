/**
 * @fileoverview MechanicsMixer - Manages base mechanics selection for Odyssey Mode
 *
 * Allows levels to mix rules from Standard and Infinity modes, with
 * per-level overrides for specific mechanics.
 */

/**
 * Base rule sets for each game mode
 */
const BASE_RULES = {
    standard: {
        gravity: 'instant', // Blocks fall instantly after line clear
        cascades: false, // No cascading clears
        levelProgression: true, // Speed increases with lines
        scoring: 'standard', // Standard Tetris scoring
        lockDelay: 500, // Lock delay in ms
        previewCount: 5,
    },

    infinity: {
        gravity: 'cascading', // Blocks fall one row at a time
        cascades: true, // Cascading clears enabled
        levelProgression: false, // Fixed speed
        scoring: 'combo-focused', // Combo-weighted scoring
        lockDelay: 500,
        previewCount: 5,
    },

    hybrid: {
        gravity: 'cascading', // Use Infinity gravity
        cascades: true, // Enable cascades
        levelProgression: true, // But keep level progression
        scoring: 'hybrid', // Mixed scoring
        lockDelay: 500,
        previewCount: 5,
    },
};

/**
 * MechanicsMixer - Mixes rules from different modes with level-specific overrides
 */
export class MechanicsMixer {
    constructor() {
        this.baseMode = 'standard';
        this.baseRules = { ...BASE_RULES.standard };
        this.overrides = new Map();
    }

    /**
     * Set base mechanics from a mode
     * @param {string} mode - 'standard' | 'infinity' | 'hybrid'
     */
    setBaseMode(mode) {
        if (!BASE_RULES[mode]) {
            console.warn(`[MechanicsMixer] Unknown mode: ${mode}, defaulting to 'standard'`);
            mode = 'standard';
        }

        this.baseMode = mode;
        this.baseRules = { ...BASE_RULES[mode] };
        this.overrides.clear();

        console.log(`[MechanicsMixer] Set base mode to: ${mode}`);
    }

    /**
     * Override a specific mechanic
     * @param {string} mechanic - Mechanic key
     * @param {*} value - Override value
     */
    override(mechanic, value) {
        this.overrides.set(mechanic, value);
        console.log(`[MechanicsMixer] Override: ${mechanic} = ${value}`);
    }

    /**
     * Apply multiple overrides at once
     * @param {Object} overrides - Key-value pairs of overrides
     */
    applyOverrides(overrides) {
        for (const [key, value] of Object.entries(overrides)) {
            this.override(key, value);
        }
    }

    /**
     * Get the final value for a mechanic (base + override)
     * @param {string} mechanic - Mechanic key
     * @returns {*} Final value
     */
    get(mechanic) {
        if (this.overrides.has(mechanic)) {
            return this.overrides.get(mechanic);
        }
        return this.baseRules[mechanic];
    }

    /**
     * Get all final mechanics as an object
     * @returns {Object}
     */
    getAll() {
        const result = { ...this.baseRules };
        for (const [key, value] of this.overrides) {
            result[key] = value;
        }
        return result;
    }

    /**
     * Check if cascading gravity is enabled
     * @returns {boolean}
     */
    hasCascadingGravity() {
        return this.get('gravity') === 'cascading';
    }

    /**
     * Check if cascades are enabled
     * @returns {boolean}
     */
    hasCascades() {
        return this.get('cascades') === true;
    }

    /**
     * Check if level progression is enabled
     * @returns {boolean}
     */
    hasLevelProgression() {
        return this.get('levelProgression') === true;
    }

    /**
     * Get scoring mode
     * @returns {string}
     */
    getScoringMode() {
        return this.get('scoring');
    }

    /**
     * Apply mechanics configuration from a level config
     * @param {Object} levelConfig - Level configuration
     */
    configureFromLevel(levelConfig) {
        const { mechanics } = levelConfig;

        // Set base mode
        this.setBaseMode(mechanics.baseMode || 'standard');

        // Apply speed overrides
        if (!mechanics.speed.levelProgression) {
            this.override('levelProgression', false);
        }

        // Apply piece overrides
        if (mechanics.pieces) {
            if (mechanics.pieces.previewCount !== undefined) {
                this.override('previewCount', mechanics.pieces.previewCount);
            }
        }
    }

    /**
     * Reset to defaults
     */
    reset() {
        this.baseMode = 'standard';
        this.baseRules = { ...BASE_RULES.standard };
        this.overrides.clear();
    }
}

export default MechanicsMixer;
