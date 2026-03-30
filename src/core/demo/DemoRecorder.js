/**
 * @fileoverview Demo Recorder for Serenity Blocks
 * Captures player inputs and game state for deterministic replay
 */

export class DemoRecorder {
    constructor() {
        this.isRecording = false;
        this.demo = null;
        this.startTime = 0;
    }

    /**
     * Start recording a new demo
     * @param {Object} gameState - Initial game state
     * @param {Object} settings - Game settings
     * @param {number} seed - RNG seed
     * @param {string} gameMode - Game mode identifier
     */
    startRecording(gameState, settings, seed, gameMode = 'single-player') {
        this.demo = {
            version: '1.0',
            gameMode,
            timestamp: Date.now(),
            initialState: {
                seed,
                level: gameState.level,
                settings: this._captureSettings(settings),
            },
            inputs: [],
            metadata: {},
        };

        this.isRecording = true;
        this.startTime = performance.now();
        console.log('[DemoRecorder] Started recording');
    }

    /**
     * Record an input action
     * @param {string} action - Action name (move, rotate, hardDrop, softDrop, hold)
     * @param {any} data - Action data (direction, etc.)
     */
    recordInput(action, data = null) {
        if (!this.isRecording) return;

        const timestamp = performance.now() - this.startTime;
        const inputEvent = { t: Math.round(timestamp), a: action };

        if (data !== null) {
            inputEvent.d = data;
        }

        this.demo.inputs.push(inputEvent);
    }

    /**
     * Stop recording and finalize demo
     * @param {Object} finalStats - Final game statistics
     * @returns {Object} The recorded demo object
     */
    stopRecording(finalStats = {}) {
        if (!this.isRecording) return null;

        this.isRecording = false;

        // Add metadata
        this.demo.metadata = {
            duration: Math.round(performance.now() - this.startTime),
            finalScore: finalStats.score || 0,
            linesCleared: finalStats.lines || 0,
            level: finalStats.level || 1,
            ...finalStats,
        };

        console.log(`[DemoRecorder] Stopped recording. Captured ${this.demo.inputs.length} inputs.`);
        return this.demo;
    }

    /**
     * Get the current demo object
     * @returns {Object} Demo object
     */
    getDemo() {
        return this.demo;
    }

    /**
     * Capture relevant settings for replay
     * @private
     */
    _captureSettings(settings) {
        // Only capture settings that affect gameplay mechanics
        return {
            // Add relevant settings here, e.g., DAS, ARR if they are configurable and affect mechanics
            // For now, we assume standard settings or that they are part of the game mode defaults
            themeBasedTetrominos: settings.themeBasedTetrominos,
        };
    }
}
