/**
 * @fileoverview Demo Player for Serenity Blocks
 * Replays recorded demos with frame-perfect timing
 */

import { seededRandom } from '../../utils/helpers.js';
import { GameState, gameLoop, spawnPiece, fillBag, move, rotate, softDrop, hardDrop } from '../game.js';
import { LEVEL_SPEEDS } from '../constants.js';

export class DemoPlayer {
    constructor(dependencies) {
        this.deps = dependencies;
        this.demo = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.playbackSpeed = 1.0;
        this.currentInputIndex = 0;
        this.startTime = 0;
        this.pauseTime = 0;
        this.gameState = null;
        this.animationId = null;
        this.onPlaybackEnd = null;
        this.callbacks = null; // Store callbacks for actions
    }

    /**
     * Load a demo for playback
     * @param {Object} demoData - The demo JSON object
     * @returns {boolean} True if loaded successfully
     */
    loadDemo(demoData) {
        if (!demoData || !demoData.version || !demoData.inputs) {
            console.error('[DemoPlayer] Invalid demo data');
            return false;
        }

        this.demo = demoData;
        this.currentInputIndex = 0;
        console.log('[DemoPlayer] Demo loaded:', this.demo.metadata);
        return true;
    }

    /**
     * Start playback
     * @param {Object} callbacks - Game callbacks (draw, updateStats, etc.)
     * @param {Object} gameState - Game state instance to use (should be fresh)
     */
    startPlayback(callbacks, gameState) {
        if (!this.demo) return;

        this.gameState = gameState;
        this.callbacks = callbacks;
        this.isPlaying = true;
        this.isPaused = false;
        this.currentInputIndex = 0;
        this.playbackSpeed = 1.0;

        // Initialize RNG with recorded seed
        const seed = this.demo.initialState.seed;
        this.gameState.randomGenerator = seededRandom(seed);

        // Restore initial level
        this.gameState.level = this.demo.initialState.level || 1;

        // Setup time
        this.startTime = performance.now();
        this.gameState.lastTime = this.startTime;

        // Initialize bag and spawn first piece
        fillBag(this.gameState.nextPieces, this.gameState.randomGenerator);

        if (callbacks.spawnPiece) callbacks.spawnPiece();
        if (callbacks.updateStats) callbacks.updateStats();
        if (callbacks.onStart) callbacks.onStart();

        // Start input processing loop
        this._loop();
        console.log('[DemoPlayer] Playback started');
    }

    /**
     * Pause playback
     */
    pausePlayback() {
        if (!this.isPlaying || this.isPaused) return;
        this.isPaused = true;
        this.pauseTime = performance.now();
        if (this.gameState) this.gameState.isPaused = true;
    }

    /**
     * Resume playback
     */
    resumePlayback() {
        if (!this.isPlaying || !this.isPaused) return;
        this.isPaused = false;
        // Adjust start time to account for pause duration
        const pauseDuration = performance.now() - this.pauseTime;
        this.startTime += pauseDuration;
        if (this.gameState) {
            this.gameState.isPaused = false;
            this.gameState.lastTime = performance.now();
        }
    }

    /**
     * Set playback speed
     * @param {number} speed - Speed multiplier (e.g. 0.5, 1.0, 2.0)
     */
    setPlaybackSpeed(speed) {
        this.playbackSpeed = Math.max(0.1, Math.min(speed, 10.0));
    }

    /**
     * Stop playback
     */
    stopPlayback() {
        this.isPlaying = false;
        this.isPaused = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.onPlaybackEnd) {
            this.onPlaybackEnd();
        }
    }

    /**
     * Get current playback time in milliseconds
     * @returns {number}
     */
    getCurrentTime() {
        if (!this.isPlaying) return 0;
        if (this.isPaused) {
            return (this.pauseTime - this.startTime) * this.playbackSpeed;
        }
        return (performance.now() - this.startTime) * this.playbackSpeed;
    }

    /**
     * Get total duration of the demo in milliseconds
     * @returns {number}
     */
    getDuration() {
        return this.demo?.metadata?.duration || 0;
    }

    /**
     * Main playback loop (input scheduler)
     * @private
     */
    _loop() {
        if (!this.isPlaying) return;

        if (!this.isPaused) {
            const currentTime = performance.now();
            // Calculate elapsed game time (scaled by speed if we were doing variable speed simulation, 
            // but for deterministic replay we need to be careful. 
            // Actually, we should process inputs based on elapsed real time * speed)

            const elapsedTime = (currentTime - this.startTime) * this.playbackSpeed;

            // Process pending inputs
            while (this.currentInputIndex < this.demo.inputs.length) {
                const input = this.demo.inputs[this.currentInputIndex];

                if (input.t <= elapsedTime) {
                    this._applyInput(input);
                    this.currentInputIndex++;
                } else {
                    break;
                }
            }

            // Check if demo ended
            if (this.currentInputIndex >= this.demo.inputs.length && !this.gameState.currentPiece && !this.gameState.isProcessingPhysics) {
                // Wait a bit after last input to show final state? 
                // Or just rely on game over state if recorded
                if (elapsedTime > this.demo.metadata.duration + 1000) {
                    this.stopPlayback();
                    return;
                }
            }

            // Run game loop logic
            // We need to trick the game loop into thinking time has passed according to playback speed
            // But gameLoop uses performance.now() internally. 
            // For true speed control, we might need to modify gameLoop or pass a custom time provider.
            // For now, let's just let the game loop run normally, but we inject inputs at the right time.
            // Wait, if we change playback speed, the game physics (gravity) also needs to speed up?
            // The current gameLoop uses delta time. If we want 2x speed, we can't just run gameLoop normally.
            // We would need to call gameLoop logic multiple times or with larger delta?

            // Actually, for simple replay at 1x, we just feed inputs.
            // For >1x, we might need to step the physics faster.

            // Let's stick to 1x for now to ensure determinism first. 
            // Speed control is tricky with the current game loop structure without refactoring.
        }

        this.animationId = requestAnimationFrame(() => this._loop());
    }

    /**
     * Apply a recorded input to the game state
     * @private
     */
    _applyInput(input) {
        const { a: action, d: data } = input;

        // Use muted callbacks if seeking to avoid sound spam and visual glitches
        const effectiveCallbacks = this.isSeeking ? this._getMutedCallbacks() : this.callbacks;

        const physicsCallbacks = effectiveCallbacks.physicsCallbacks || {};
        const playDropCallback = effectiveCallbacks.playDropCallback || (() => { });
        const playSoundCallback = effectiveCallbacks.playSoundCallback || (() => { }); // For move/rotate
        const addTrailCallback = effectiveCallbacks.addTrailCallback || (() => { });

        switch (action) {
            case 'move':
                move(this.gameState, data, playSoundCallback, addTrailCallback);
                break;
            case 'rotate':
                rotate(this.gameState, data, playSoundCallback, addTrailCallback);
                break;
            case 'softDrop':
                softDrop(this.gameState, playDropCallback, physicsCallbacks);
                break;
            case 'hardDrop':
                hardDrop(this.gameState, playDropCallback, physicsCallbacks);
                break;
            case 'hold':
                // Implement hold if/when supported
                break;
        }
    }

    /**
     * Seek to a specific time in the demo
     * @param {number} targetTime - Time in milliseconds
     */
    async seek(targetTime) {
        if (!this.demo || !this.gameState) return;

        targetTime = Math.max(0, Math.min(targetTime, this.getDuration()));

        // 1. Reset Game State
        this._resetState();

        // 2. Fast-forward inputs AND simulate time (gravity)
        this.isSeeking = true;
        this.gameState.isSeeking = true; // Flag for physics to skip delays
        this.currentInputIndex = 0;

        let simulatedTime = 0;

        // We need to simulate the time passing between inputs to trigger auto-drops (gravity)
        // Otherwise pieces won't fall and inputs will apply to wrong positions
        while (simulatedTime < targetTime) {
            // Find next event time (either next input or target time)
            let nextInput = this.demo.inputs[this.currentInputIndex];
            let nextEventTime = nextInput ? nextInput.t : targetTime;

            // Cap at targetTime
            if (nextEventTime > targetTime) nextEventTime = targetTime;

            // Calculate time delta to simulate
            let deltaTime = nextEventTime - simulatedTime;

            // Simulate gravity/game loop for this delta
            if (deltaTime > 0) {
                await this._simulateGameLoop(deltaTime);
                simulatedTime += deltaTime;
            }

            // Apply input if we reached it
            if (nextInput && nextInput.t <= simulatedTime) {
                this._applyInput(nextInput);

                // CRITICAL: Wait for any async physics to complete before processing next input
                if (this.gameState.latestPhysicsPromise) {
                    await this.gameState.latestPhysicsPromise;
                    this.gameState.latestPhysicsPromise = null;
                }

                this.currentInputIndex++;
            }

            // Break if we've processed all inputs and reached target
            if (!nextInput && simulatedTime >= targetTime) break;
        }

        // Update start time to match the seek position
        const now = performance.now();
        if (this.isPaused) {
            this.pauseTime = now;
            this.startTime = now - (targetTime / this.playbackSpeed);
        } else {
            this.startTime = now - (targetTime / this.playbackSpeed);
        }

        this.isSeeking = false;
        this.gameState.isSeeking = false;

        // 3. Force update of stats/visuals
        if (this.callbacks.updateStats) this.callbacks.updateStats();
        this.gameState.forceDraw = true;
    }

    /**
     * Simulate game loop (gravity) for a duration
     * @private
     */
    async _simulateGameLoop(duration) {
        let remaining = duration;
        const mutedCallbacks = this._getMutedCallbacks();
        const physicsCallbacks = mutedCallbacks.physicsCallbacks;

        while (remaining > 0) {
            // If physics is running, wait for it
            if (this.gameState.isProcessingPhysics) {
                if (this.gameState.latestPhysicsPromise) {
                    await this.gameState.latestPhysicsPromise;
                    this.gameState.latestPhysicsPromise = null;
                }
                // Physics is "instant" in seek mode, so we don't consume 'remaining' time waiting for it
                // But we check again to ensure state is clean
                continue;
            }

            // If no piece, we can't drop. 
            if (!this.gameState.currentPiece) {
                // If we are here, likely waiting for spawn or game over.
                // Consume remaining time
                remaining = 0;
                break;
            }

            // Calculate time until next auto-drop
            let timeToDrop = this.gameState.dropInterval - this.gameState.dropCounter;

            // Step is the smaller of remaining time or time to next drop
            // We add a small epsilon (1ms) to ensure we cross the threshold if we reach it
            let step = Math.min(remaining, timeToDrop + 0.1);

            // Advance counters
            this.gameState.dropCounter += step;
            remaining -= step;

            // Trigger drop if threshold reached
            if (this.gameState.dropCounter >= this.gameState.dropInterval) {
                // softDrop returns true if moved, false if locked
                // We use muted callbacks
                softDrop(this.gameState, () => { }, physicsCallbacks);

                // If it locked, isProcessingPhysics will be true.
                if (this.gameState.isProcessingPhysics && this.gameState.latestPhysicsPromise) {
                    await this.gameState.latestPhysicsPromise;
                    this.gameState.latestPhysicsPromise = null;
                }
            }
        }
    }

    /**
     * Reset game state to initial conditions
     * @private
     */
    /**
     * Reset game state to initial conditions
     * @private
     */
    _resetState() {
        if (!this.gameState || !this.demo) return;

        // Use the robust reset from GameState to clear everything (including boardGrid)
        this.gameState.reset();

        // Restore Demo Specifics
        const seed = this.demo.initialState.seed;
        this.gameState.randomGenerator = seededRandom(seed);

        // Restore Level & Speed
        this.gameState.level = this.demo.initialState.level || 1;

        // Recalculate drop interval for the level
        // Note: LEVEL_SPEEDS is 0-indexed for level 1
        const speedIndex = Math.min(this.gameState.level - 1, LEVEL_SPEEDS.length - 1);
        this.gameState.dropInterval = LEVEL_SPEEDS[speedIndex];

        // Refill bag (reset() cleared it and set default RNG)
        fillBag(this.gameState.nextPieces, this.gameState.randomGenerator);

        // Spawn first piece
        // We use the muted callback version if we are about to seek, but _resetState is called inside seek.
        // We should just call the spawnPiece logic.
        if (this.callbacks.spawnPiece) {
            this.callbacks.spawnPiece();
        }
    }

    /**
     * Get callbacks with muted sounds/effects for seeking
     * @private
     */
    _getMutedCallbacks() {
        if (!this._mutedCallbacks) {
            const originalPhysics = this.callbacks.physicsCallbacks || {};
            this._mutedCallbacks = {
                ...this.callbacks,
                playSoundCallback: () => { },
                playDropCallback: () => { },
                addTrailCallback: () => { },
                physicsCallbacks: {
                    ...originalPhysics,
                    onMove: () => { },
                    onRotate: () => { },
                    onLineClear: () => { },
                    onLevelUp: () => { },
                    onHardDrop: () => { },
                    triggerCombo: () => { },
                    triggerCascadeWave: () => { },
                    triggerFlash: () => { },
                    onLineClearImpact: () => { },
                    triggerBackgroundPulse: () => { },
                    onPieceLock: () => { },
                    // Keep spawnPiece as it affects game state
                    spawnPiece: originalPhysics.spawnPiece
                }
            };
        }
        return this._mutedCallbacks;
    }
}
