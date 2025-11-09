import { SinglePlayerMode } from './SinglePlayerMode.js';
import { LocalMultiplayerMode } from './LocalMultiplayerMode.js';
import { OnlineMultiplayerMode } from './OnlineMultiplayerMode.js';
import { SerenityMode } from './SerenityMode.js';
import { InfinityMode } from './InfinityMode.js';
import { GAME_MODES } from '../constants.js';

/**
 * GameModeManager - Central orchestrator for all game modes
 *
 * Responsibilities:
 * - Register and manage all game modes
 * - Handle mode switching with proper cleanup
 * - Provide unified interface for game lifecycle
 * - Ensure only one mode is active at a time
 *
 * Usage:
 * const manager = new GameModeManager(dependencies);
 * await manager.activateMode(GAME_MODES.SINGLE_PLAYER);
 * await manager.startCurrentMode();
 * await manager.stopCurrentMode();
 */
export class GameModeManager {
    /**
     * @param {Object} dependencies - Shared resources
     * @param {Object} dependencies.phaserGame - Phaser game instance
     * @param {Object} dependencies.soundManager - Sound manager
     * @param {Object} dependencies.themeManager - Theme manager
     * @param {Object} dependencies.settingsManager - Settings manager
     * @param {Object} dependencies.highScoreManager - High score manager
     * @param {Object} dependencies.modalManager - Modal manager
     */
    constructor(dependencies) {
        this.deps = dependencies;

        // Mode registry
        this.modes = new Map();
        this.currentMode = null;
        this.currentModeId = null;

        // Event handlers
        this.eventHandlers = new Map();

        // Register all modes
        this._registerModes();

        console.log('[GameModeManager] Initialized with modes:', Array.from(this.modes.keys()));
    }

    /**
     * Register all available game modes
     * @private
     */
    _registerModes() {
        this.registerMode(new SinglePlayerMode(this.deps));
        this.registerMode(new LocalMultiplayerMode(this.deps));
        this.registerMode(new OnlineMultiplayerMode(this.deps));
        this.registerMode(new SerenityMode(this.deps));
        this.registerMode(new InfinityMode(this.deps));
    }

    /**
     * Register a game mode
     * @param {BaseGameMode} mode
     */
    registerMode(mode) {
        const modeId = mode.getModeId();

        if (this.modes.has(modeId)) {
            console.warn(`[GameModeManager] Mode ${modeId} already registered, replacing...`);
        }

        this.modes.set(modeId, mode);
        console.log(`[GameModeManager] Registered mode: ${modeId} (${mode.getDisplayName()})`);
    }

    /**
     * Get a registered mode
     * @param {string} modeId
     * @returns {BaseGameMode|null}
     */
    getMode(modeId) {
        return this.modes.get(modeId) || null;
    }

    /**
     * Get all registered modes
     * @returns {Array<BaseGameMode>}
     */
    getAllModes() {
        return Array.from(this.modes.values());
    }

    /**
     * Get current active mode
     * @returns {BaseGameMode|null}
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * Get current mode ID
     * @returns {string|null}
     */
    getCurrentModeId() {
        return this.currentModeId;
    }

    /**
     * Check if a mode is currently active
     * @param {string} modeId
     * @returns {boolean}
     */
    isModeActive(modeId) {
        return this.currentModeId === modeId;
    }

    /**
     * Activate a game mode (select it in UI, don't start yet)
     * @param {string} modeId
     * @returns {Promise<void>}
     */
    async activateMode(modeId) {
        const mode = this.modes.get(modeId);

        if (!mode) {
            throw new Error(`[GameModeManager] Unknown mode: ${modeId}`);
        }

        // If this mode is already active, do nothing
        if (this.currentModeId === modeId && this.currentMode?.isActive) {
            console.log(`[GameModeManager] Mode ${modeId} is already active`);
            return;
        }

        // If current mode exists but is not active, clear the reference
        if (this.currentMode && !this.currentMode.isActive) {
            console.log(`[GameModeManager] Current mode ${this.currentModeId} is no longer active, clearing reference`);
            this.currentMode = null;
            this.currentModeId = null;
        }

        // Deactivate current mode if any
        if (this.currentMode && this.currentMode.isActive) {
            console.log(`[GameModeManager] Deactivating current mode: ${this.currentModeId}`);
            await this.currentMode.onDeactivate();
        }

        // Activate new mode
        console.log(`[GameModeManager] Activating mode: ${modeId}`);
        this.currentMode = mode;
        this.currentModeId = modeId;

        try {
            await mode.onActivate();
            this._emitEvent('modeActivated', { modeId, mode });
            console.log(`[GameModeManager] Mode ${modeId} activated successfully`);
        } catch (error) {
            console.error(`[GameModeManager] Failed to activate mode ${modeId}:`, error);
            this.currentMode = null;
            this.currentModeId = null;
            throw error;
        }
    }

    /**
     * Start the current active mode
     * @returns {Promise<void>}
     */
    async startCurrentMode() {
        if (!this.currentMode) {
            throw new Error('[GameModeManager] No mode is currently active');
        }

        if (!this.currentMode.isActive) {
            throw new Error(`[GameModeManager] Mode ${this.currentModeId} is not active`);
        }

        if (this.currentMode.isRunning) {
            console.warn(`[GameModeManager] Mode ${this.currentModeId} is already running`);
            return;
        }

        console.log(`[GameModeManager] Starting mode: ${this.currentModeId}`);

        try {
            if (this.deps?.soundManager?.resumeThemeLinkedMusic) {
                this.deps.soundManager.resumeThemeLinkedMusic(true);
            }
            await this.currentMode.onStart();
            this._emitEvent('modeStarted', { modeId: this.currentModeId, mode: this.currentMode });
            console.log(`[GameModeManager] Mode ${this.currentModeId} started successfully`);
        } catch (error) {
            console.error(`[GameModeManager] Failed to start mode ${this.currentModeId}:`, error);
            throw error;
        }
    }

    /**
     * Pause the current running mode
     */
    pauseCurrentMode() {
        if (!this.currentMode || !this.currentMode.isRunning) {
            console.warn('[GameModeManager] No running mode to pause');
            return;
        }

        console.log(`[GameModeManager] Pausing mode: ${this.currentModeId}`);
        this.currentMode.onPause();
        this._emitEvent('modePaused', { modeId: this.currentModeId, mode: this.currentMode });
    }

    /**
     * Resume the current paused mode
     */
    resumeCurrentMode() {
        if (!this.currentMode || !this.currentMode.isPaused) {
            console.warn('[GameModeManager] No paused mode to resume');
            return;
        }

        console.log(`[GameModeManager] Resuming mode: ${this.currentModeId}`);
        this.currentMode.onResume();
        this._emitEvent('modeResumed', { modeId: this.currentModeId, mode: this.currentMode });
    }

    /**
     * Stop the current running mode
     * @returns {Promise<void>}
     */
    async stopCurrentMode() {
        if (!this.currentMode) {
            console.warn('[GameModeManager] No mode to stop');
            return;
        }

        if (!this.currentMode.isRunning) {
            console.warn(`[GameModeManager] Mode ${this.currentModeId} is not running`);
            return;
        }

        console.log(`[GameModeManager] Stopping mode: ${this.currentModeId}`);

        try {
            await this.currentMode.onStop();
            this._emitEvent('modeStopped', { modeId: this.currentModeId, mode: this.currentMode });
            console.log(`[GameModeManager] Mode ${this.currentModeId} stopped successfully`);
        } catch (error) {
            console.error(`[GameModeManager] Failed to stop mode ${this.currentModeId}:`, error);
            throw error;
        }
    }

    /**
     * Deactivate the current mode
     * @returns {Promise<void>}
     */
    async deactivateCurrentMode() {
        if (!this.currentMode) {
            console.warn('[GameModeManager] No mode to deactivate');
            return;
        }

        console.log(`[GameModeManager] Deactivating mode: ${this.currentModeId}`);

        try {
            await this.currentMode.onDeactivate();
            this._emitEvent('modeDeactivated', { modeId: this.currentModeId, mode: this.currentMode });
            this.currentMode = null;
            this.currentModeId = null;
            console.log('[GameModeManager] Mode deactivated successfully');
        } catch (error) {
            console.error(`[GameModeManager] Failed to deactivate mode:`, error);
            throw error;
        }
    }

    /**
     * Handle window resize
     */
    handleResize() {
        if (this.currentMode && this.currentMode.isActive) {
            this.currentMode.onResize();
        }
    }

    /**
     * Handle theme change
     * @param {string} theme
     */
    handleThemeChange(theme) {
        if (this.currentMode && this.currentMode.isActive) {
            this.currentMode.onThemeChange(theme);
        }
    }

    /**
     * Handle settings change
     * @param {Object} settings
     */
    handleSettingsChange(settings) {
        if (this.currentMode && this.currentMode.isActive) {
            this.currentMode.onSettingsChange(settings);
        }
    }

    /**
     * Get state of all modes
     * @returns {Object}
     */
    getState() {
        const modesState = {};

        this.modes.forEach((mode, modeId) => {
            modesState[modeId] = mode.getState();
        });

        return {
            currentModeId: this.currentModeId,
            modes: modesState,
        };
    }

    /**
     * Subscribe to manager events
     * @param {string} event - Event name (modeActivated, modeStarted, modePaused, modeResumed, modeStopped, modeDeactivated)
     * @param {Function} handler - Event handler
     * @returns {Function} Unsubscribe function
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }

        this.eventHandlers.get(event).push(handler);

        // Return unsubscribe function
        return () => {
            const handlers = this.eventHandlers.get(event);
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        };
    }

    /**
     * Emit an event
     * @private
     */
    _emitEvent(event, data) {
        const handlers = this.eventHandlers.get(event);

        if (handlers) {
            handlers.forEach((handler) => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`[GameModeManager] Error in ${event} handler:`, error);
                }
            });
        }
    }

    /**
     * Cleanup all modes and event handlers
     */
    async cleanup() {
        console.log('[GameModeManager] Cleaning up...');

        // Deactivate current mode
        if (this.currentMode) {
            await this.deactivateCurrentMode();
        }

        // Clear event handlers
        this.eventHandlers.clear();

        console.log('[GameModeManager] Cleanup complete');
    }
}
