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

        if (this.deps?.themeManager?.suspendThemes) {
            this.deps.themeManager.suspendThemes();
        }
    }

    /**
     * Register all available game modes
     * @private
     */
    _registerModes() {
        this.registerModeFactory(
            GAME_MODES.SINGLE_PLAYER,
            'Single Player',
            async () => (await import('./SinglePlayerMode.js')).SinglePlayerMode,
        );
        this.registerModeFactory(
            GAME_MODES.LOCAL_MULTIPLAYER,
            'Local Multiplayer',
            async () => (await import('./LocalMultiplayerMode.js')).LocalMultiplayerMode,
        );
        this.registerModeFactory(
            GAME_MODES.ONLINE_MULTIPLAYER,
            'Online Multiplayer',
            async () => (await import('./OnlineMultiplayerMode.js')).OnlineMultiplayerMode,
        );
        this.registerModeFactory(
            GAME_MODES.SERENITY,
            'Serenity',
            async () => (await import('./SerenityMode.js')).SerenityMode,
        );
        this.registerModeFactory(
            GAME_MODES.INFINITY,
            'Infinity',
            async () => (await import('./InfinityMode.js')).InfinityMode,
        );
        this.registerModeFactory(
            GAME_MODES.ODYSSEY,
            'Odyssey',
            async () => (await import('./OdysseyMode.js')).OdysseyMode,
        );
    }

    registerModeFactory(modeId, displayName, loader) {
        if (!modeId || typeof loader !== 'function') {
            throw new Error('[GameModeManager] Invalid lazy mode registration');
        }

        this.modes.set(modeId, {
            modeId,
            displayName,
            loader,
            instance: null,
            loadingPromise: null,
        });
        console.log(`[GameModeManager] Registered lazy mode: ${modeId} (${displayName})`);
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

        this.modes.set(modeId, {
            modeId,
            displayName: mode.getDisplayName(),
            loader: null,
            instance: mode,
            loadingPromise: null,
        });
        console.log(`[GameModeManager] Registered mode: ${modeId} (${mode.getDisplayName()})`);
    }

    async _ensureMode(modeId) {
        const entry = this.modes.get(modeId);
        if (!entry) {
            throw new Error(`[GameModeManager] Unknown mode: ${modeId}`);
        }

        if (entry.instance) {
            return entry.instance;
        }

        if (!entry.loader) {
            throw new Error(`[GameModeManager] Mode ${modeId} has no loader`);
        }

        if (!entry.loadingPromise) {
            entry.loadingPromise = (async () => {
                const ModeClass = await entry.loader();
                const modeInstance = new ModeClass(this.deps);
                entry.instance = modeInstance;
                entry.displayName = modeInstance.getDisplayName?.() || entry.displayName;
                console.log(`[GameModeManager] Loaded mode: ${modeId} (${entry.displayName})`);
                return modeInstance;
            })().finally(() => {
                entry.loadingPromise = null;
            });
        }

        return entry.loadingPromise;
    }

    /**
     * Get a registered mode
     * @param {string} modeId
     * @returns {BaseGameMode|null}
     */
    getMode(modeId) {
        return this.modes.get(modeId)?.instance || null;
    }

    /**
     * Get all registered modes
     * @returns {Array<BaseGameMode>}
     */
    getAllModes() {
        return Array.from(this.modes.values())
            .map((entry) => entry.instance)
            .filter(Boolean);
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
        const mode = await this._ensureMode(modeId);

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
    async startCurrentMode(options = {}) {
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

        console.log(`[GameModeManager] Starting mode: ${this.currentModeId}`, options);

        try {
            const mode = this.currentMode;
            await mode.onStart(options);

            if (!mode.isRunning) {
                console.log(
                    `[GameModeManager] Mode ${this.currentModeId} start deferred (awaiting mode-specific setup)`,
                );
                return;
            }

            const startRuntimePolicy = {
                resumeThemeLinkedMusic: true,
                resumeThemes: true,
                syncMusicPlayback: true,
                ...(typeof mode.getStartRuntimePolicy === 'function'
                    ? mode.getStartRuntimePolicy()
                    : {}),
            };

            if (startRuntimePolicy.resumeThemeLinkedMusic
                && this.deps?.soundManager?.resumeThemeLinkedMusic) {
                this.deps.soundManager.resumeThemeLinkedMusic(true);
            }
            if (startRuntimePolicy.resumeThemes
                && this.deps?.themeManager?.resumeThemes) {
                await this.deps.themeManager.resumeThemes();
            }
            if (startRuntimePolicy.syncMusicPlayback
                && this.deps?.soundManager?.ensureTrackPlaybackSynced) {
                await this.deps.soundManager.ensureTrackPlaybackSynced({
                    reason: 'mode-start',
                    force: true,
                });
            }

            this._emitEvent('modeStarted', { modeId: this.currentModeId, mode });
            console.log(`[GameModeManager] Mode ${this.currentModeId} started successfully`);
        } catch (error) {
            console.error(`[GameModeManager] Failed to start mode ${this.currentModeId}:`, error);
            throw error;
        }
    }

    /**
     * Pause the current running mode
     * @param {Object} options - Pause options (passed to onPause)
     */
    pauseCurrentMode(options = {}) {
        if (!this.currentMode || !this.currentMode.isRunning) {
            console.warn('[GameModeManager] No running mode to pause');
            return;
        }

        console.log(`[GameModeManager] Pausing mode: ${this.currentModeId}`, options);
        this.currentMode.onPause(options);
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
            if (this.deps?.themeManager?.suspendThemes) {
                this.deps.themeManager.suspendThemes();
            }
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
            console.error('[GameModeManager] Failed to deactivate mode:', error);
            throw error;
        }
    }

    /**
     * Handle window resize
     */
    handleResize() {
        if (this.currentMode && this.currentMode.isActive) {
            console.log(`[GameModeManager] Propagating resize to mode: ${this.currentModeId}`);
            this.currentMode.onResize();
        } else {
            console.log('[GameModeManager] No active mode to resize');
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

        this.modes.forEach((entry, modeId) => {
            modesState[modeId] = entry.instance
                ? entry.instance.getState()
                : {
                    isLoaded: false,
                    isActive: this.currentModeId === modeId,
                    isRunning: false,
                    displayName: entry.displayName,
                };
        });

        return {
            currentModeId: this.currentModeId,
            modes: modesState,
        };
    }

    async preloadMode(modeId) {
        await this._ensureMode(modeId);
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
