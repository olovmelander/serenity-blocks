/**
 * @fileoverview ModifierStack - Manages gameplay modifiers for Odyssey Mode levels
 *
 * Defines available modifiers and provides methods to activate and apply them
 * to game state and physics callbacks.
 */

/**
 * Modifier definition structure
 * @typedef {Object} ModifierDefinition
 * @property {string} name - Display name
 * @property {string} description - User-facing description
 * @property {Function} apply - Function to modify gameState
 * @property {Function} [applyToCallbacks] - Function to wrap physics callbacks
 */

/**
 * Available modifiers that can be applied to levels
 */
export const MODIFIER_DEFINITIONS = {
    'gravity-cascade': {
        name: 'Gravity Cascade',
        description: 'Blocks fall one row at a time, enabling cascading clears',
        apply: (gameState) => {
            gameState.enableCascadingGravity = true;
            // Cascading gravity is already handled by physics.js when this flag is true
        },
        applyToCallbacks: (callbacks) =>
            // No callback modifications needed - physics handles this
            callbacks
        ,
    },

    'time-attack': {
        name: 'Time Attack',
        description: 'Race against the clock',
        apply: (gameState) => {
            gameState.timeAttackMode = true;
        },
        applyToCallbacks: (callbacks) =>
            // Timer UI is handled separately by OdysseyMode
            callbacks
        ,
    },

    'combo-multiplier': {
        name: 'Combo Multiplier',
        description: 'Score multiplier increases with each consecutive clear',
        apply: (gameState) => {
            gameState.comboMultiplierEnabled = true;
            gameState.comboMultiplier = 1;
        },
        applyToCallbacks: (callbacks, gameState) => {
            const originalOnLineClear = callbacks.onLineClear;
            callbacks.onLineClear = (lineCount) => {
                // Apply combo multiplier to scoring
                if (gameState.comboMultiplierEnabled && gameState.comboCount > 0) {
                    gameState.comboMultiplier = 1 + (gameState.comboCount * 0.5);
                } else {
                    gameState.comboMultiplier = 1;
                }
                originalOnLineClear?.(lineCount);
            };
            return callbacks;
        },
    },

    invisible: {
        name: 'Invisible',
        description: 'Placed blocks become invisible after a moment',
        apply: (gameState) => {
            gameState.invisibleBlocksEnabled = true;
            gameState.invisibleDelay = 1500; // ms before blocks fade
        },
        applyToCallbacks: (callbacks, gameState) => {
            const originalOnPieceLock = callbacks.onPieceLock;
            callbacks.onPieceLock = (piece) => {
                originalOnPieceLock?.(piece);
                // Invisibility is handled by rendering, we just mark the piece
                if (gameState.invisibleBlocksEnabled) {
                    piece.fadeOutTime = Date.now() + gameState.invisibleDelay;
                }
            };
            return callbacks;
        },
    },

    mirror: {
        name: 'Mirror Mode',
        description: 'Controls are horizontally reversed',
        apply: (gameState) => {
            gameState.mirrorControls = true;
        },
        applyToCallbacks: (callbacks) =>
            // Mirror is handled by input layer, not physics
            callbacks
        ,
    },

    'speed-up': {
        name: 'Speed Up',
        description: 'Speed increases faster than normal',
        apply: (gameState) => {
            gameState.speedMultiplier = 1.5;
        },
        applyToCallbacks: (callbacks) => callbacks,
    },

    'slow-start': {
        name: 'Slow Start',
        description: 'Start at a slower speed',
        apply: (gameState) => {
            gameState.dropInterval = Math.min(gameState.dropInterval * 1.5, 2000);
        },
        applyToCallbacks: (callbacks) => callbacks,
    },
};

/**
 * ModifierStack - Manages active modifiers for a level
 */
export class ModifierStack {
    constructor() {
        this.activeModifiers = [];
        this.modifierIds = [];
    }

    /**
     * Activate modifiers by their IDs
     * @param {string[]} modifierIds - Array of modifier IDs to activate
     */
    activate(modifierIds) {
        this.modifierIds = modifierIds || [];
        this.activeModifiers = this.modifierIds
            .map((id) => {
                const def = MODIFIER_DEFINITIONS[id];
                if (!def) {
                    console.warn(`[ModifierStack] Unknown modifier: ${id}`);
                    return null;
                }
                return { id, ...def };
            })
            .filter(Boolean);

        console.log(`[ModifierStack] Activated ${this.activeModifiers.length} modifiers:`, this.modifierIds);
    }

    /**
     * Get list of active modifiers
     * @returns {Object[]}
     */
    getActive() {
        return this.activeModifiers;
    }

    /**
     * Get list of active modifier IDs
     * @returns {string[]}
     */
    getActiveIds() {
        return this.modifierIds;
    }

    /**
     * Check if a specific modifier is active
     * @param {string} modifierId
     * @returns {boolean}
     */
    isActive(modifierId) {
        return this.modifierIds.includes(modifierId);
    }

    /**
     * Apply all active modifiers to a game state
     * @param {Object} gameState
     */
    applyToGameState(gameState) {
        for (const modifier of this.activeModifiers) {
            try {
                modifier.apply(gameState);
                console.log(`[ModifierStack] Applied '${modifier.name}' to gameState`);
            } catch (error) {
                console.error(`[ModifierStack] Error applying '${modifier.name}':`, error);
            }
        }
    }

    /**
     * Wrap physics callbacks with modifier-specific logic
     * @param {Object} callbacks - Base physics callbacks
     * @param {Object} gameState - Current game state
     * @returns {Object} - Modified callbacks
     */
    applyToCallbacks(callbacks, gameState) {
        let modifiedCallbacks = { ...callbacks };

        for (const modifier of this.activeModifiers) {
            if (modifier.applyToCallbacks) {
                try {
                    modifiedCallbacks = modifier.applyToCallbacks(modifiedCallbacks, gameState) || modifiedCallbacks;
                } catch (error) {
                    console.error(`[ModifierStack] Error in '${modifier.name}' callback wrapper:`, error);
                }
            }
        }

        return modifiedCallbacks;
    }

    /**
     * Get display info for UI
     * @returns {Object[]} Array of { name, description } for active modifiers
     */
    getDisplayInfo() {
        return this.activeModifiers.map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
        }));
    }

    /**
     * Clear all active modifiers
     */
    clear() {
        this.activeModifiers = [];
        this.modifierIds = [];
    }
}

export default ModifierStack;
