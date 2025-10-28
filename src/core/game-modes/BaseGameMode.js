/**
 * BaseGameMode - Abstract base class for all game modes
 *
 * Defines the lifecycle hooks and common interface that all game modes must implement.
 * This ensures consistent behavior and makes it easy to add new game modes.
 *
 * Lifecycle:
 * 1. constructor() - Create instance with dependencies
 * 2. onActivate() - Mode is selected in UI (prepare UI, don't start game)
 * 3. onStart() - User clicks "Start Game" (initialize game state, start loop)
 * 4. onPause() - Game is paused (settings opened, etc.)
 * 5. onResume() - Game is resumed from pause
 * 6. onStop() - Game ends (game over or user quits)
 * 7. onDeactivate() - Mode is deselected (cleanup, return to menu)
 */
export class BaseGameMode {
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
        if (new.target === BaseGameMode) {
            throw new TypeError('Cannot construct BaseGameMode instances directly');
        }

        this.deps = dependencies;
        this.isActive = false;
        this.isRunning = false;
        this.isPaused = false;
    }

    /**
     * Get the unique identifier for this mode
     * @returns {string}
     */
    getModeId() {
        throw new Error('getModeId() must be implemented by subclass');
    }

    /**
     * Get the display name for this mode
     * @returns {string}
     */
    getDisplayName() {
        throw new Error('getDisplayName() must be implemented by subclass');
    }

    /**
     * Called when this mode is selected in the UI
     * Use this to prepare UI, show instructions, etc.
     * DO NOT start the game loop here.
     */
    async onActivate() {
        console.log(`[${this.getModeId()}] Mode activated`);
        this.isActive = true;
    }

    /**
     * Called when user explicitly clicks "Start Game"
     * Initialize game state and start the game loop here.
     */
    async onStart() {
        if (!this.isActive) {
            throw new Error('Cannot start mode that is not active');
        }
        if (this.isRunning) {
            console.warn(`[${this.getModeId()}] Mode is already running`);
            return;
        }

        console.log(`[${this.getModeId()}] Starting game...`);
        this.isRunning = true;
        this.isPaused = false;
    }

    /**
     * Called when the game is paused (settings menu, etc.)
     */
    onPause() {
        if (!this.isRunning) {
            return;
        }

        console.log(`[${this.getModeId()}] Game paused`);
        this.isPaused = true;
    }

    /**
     * Called when the game is resumed from pause
     */
    onResume() {
        if (!this.isRunning || !this.isPaused) {
            return;
        }

        console.log(`[${this.getModeId()}] Game resumed`);
        this.isPaused = false;
    }

    /**
     * Called when the game ends (game over or user quits)
     */
    async onStop() {
        if (!this.isRunning) {
            return;
        }

        console.log(`[${this.getModeId()}] Stopping game...`);
        this.isRunning = false;
        this.isPaused = false;
    }

    /**
     * Called when this mode is deselected
     * Clean up all resources, cancel animations, etc.
     */
    async onDeactivate() {
        if (this.isRunning) {
            await this.onStop();
        }

        console.log(`[${this.getModeId()}] Mode deactivated`);
        this.isActive = false;
    }

    /**
     * Handle window resize
     */
    onResize() {
        // Override in subclass if needed
    }

    /**
     * Handle theme change
     */
    onThemeChange(theme) {
        // Override in subclass if needed
    }

    /**
     * Handle settings change
     */
    onSettingsChange(settings) {
        // Override in subclass if needed
    }

    /**
     * Get current game state (for serialization, debugging, etc.)
     * @returns {Object}
     */
    getState() {
        return {
            modeId: this.getModeId(),
            isActive: this.isActive,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
        };
    }

    /**
     * Cleanup helper - cancel animation frame
     * @param {number} frameId
     * @protected
     */
    _cancelAnimationFrame(frameId) {
        if (frameId) {
            cancelAnimationFrame(frameId);
        }
        return null;
    }

    /**
     * Cleanup helper - remove event listeners
     * @param {Array<Function>} cleanupHandlers
     * @protected
     */
    _cleanupEventListeners(cleanupHandlers) {
        cleanupHandlers.forEach((cleanup) => cleanup());
        cleanupHandlers.length = 0;
    }
}
