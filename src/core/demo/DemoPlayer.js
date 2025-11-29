/**
 * @fileoverview Demo Player for Serenity Blocks
 * Replays recorded demos with frame-perfect timing
 */

import { seededRandom } from '../../utils/helpers.js';
import { GameState, gameLoop, updateGame, spawnPiece, fillBag, move, rotate, softDrop, hardDrop } from '../game.js';
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
        // CRITICAL: Initialize lastTime to 0 because we will feed 'elapsedTime' (starting at 0) 
        // to updateGame, ensuring deterministic physics steps regardless of real-world start time.
        this.gameState.lastTime = 0;
        this.lastSimulatedTime = 0;

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
            // We don't reset lastTime here because we are using elapsedTime derived from startTime
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
    async _loop() {
        if (!this.isPlaying) return;

        if (!this.isPaused) {
            const currentTime = performance.now();
            // Calculate target game time (scaled by speed)
            const targetTime = (currentTime - this.startTime) * this.playbackSpeed;

            // Catch up simulation to target time, stepping through inputs
            while (this.lastSimulatedTime < targetTime) {
                // Determine the time of the next input
                let nextInputTime = Infinity;
                if (this.currentInputIndex < this.demo.inputs.length) {
                    nextInputTime = this.demo.inputs[this.currentInputIndex].t;
                }

                // Determine our next step: either the target time or the next input time
                // We clamp to targetTime so we don't run ahead of real time
                let stepTime = Math.min(targetTime, nextInputTime);

                // Ensure we make at least a tiny step to avoid infinite loops if times are identical
                // but strictly speaking, if stepTime == lastSimulatedTime, we just process the input.

                // 1. Advance physics to the step time
                if (stepTime > this.lastSimulatedTime) {
                    updateGame(stepTime, this.gameState, this.callbacks);
                    this.lastSimulatedTime = stepTime;

                    // CRITICAL: Wait for any async physics (locking/clearing) triggered by updateGame
                    if (this.gameState.latestPhysicsPromise) {
                        await this.gameState.latestPhysicsPromise;
                        this.gameState.latestPhysicsPromise = null;
                    }
                }

                // 2. If we reached an input time, apply it
                if (this.currentInputIndex < this.demo.inputs.length &&
                    this.lastSimulatedTime >= nextInputTime) {

                    const input = this.demo.inputs[this.currentInputIndex];
                    this._applyInput(input);

                    // CRITICAL: Wait for any async physics triggered by input
                    if (this.gameState.latestPhysicsPromise) {
                        await this.gameState.latestPhysicsPromise;
                        this.gameState.latestPhysicsPromise = null;
                    }

                    this.currentInputIndex++;

                    // IMPORTANT: If we processed an input, we loop again. 
                    // This allows multiple inputs at the same timestamp to be processed 
                    // before advancing physics further, or allows physics to run immediately after.
                    continue;
                }

                // If we reached targetTime and no inputs are pending at this exact time, we are done for this frame
                if (this.lastSimulatedTime >= targetTime) {
                    break;
                }
            }

            // Check if demo ended
            if (this.currentInputIndex >= this.demo.inputs.length && !this.gameState.currentPiece && !this.gameState.isProcessingPhysics) {
                if (this.lastSimulatedTime > this.demo.metadata.duration + 1000) {
                    this.stopPlayback();
                    return;
                }
            }
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
        this.gameState.lastTime = 0;
        this.lastSimulatedTime = 0;

        // 2. Fast-forward inputs AND simulate time (gravity)
        this.isSeeking = true;
        this.gameState.isSeeking = true; // Flag for physics to skip delays
        this.currentInputIndex = 0;

        // Use muted callbacks for seeking
        const callbacks = this._getMutedCallbacks();

        // Catch up simulation to target time, stepping through inputs
        while (this.lastSimulatedTime < targetTime) {
            // Determine the time of the next input
            let nextInputTime = Infinity;
            if (this.currentInputIndex < this.demo.inputs.length) {
                nextInputTime = this.demo.inputs[this.currentInputIndex].t;
            }

            // Determine our next step
            let stepTime = Math.min(targetTime, nextInputTime);

            // 1. Advance physics to the step time
            if (stepTime > this.lastSimulatedTime) {
                updateGame(stepTime, this.gameState, callbacks);
                this.lastSimulatedTime = stepTime;

                // CRITICAL: Wait for any async physics (locking/clearing) triggered by updateGame
                if (this.gameState.latestPhysicsPromise) {
                    await this.gameState.latestPhysicsPromise;
                    this.gameState.latestPhysicsPromise = null;
                }
            }

            // 2. If we reached an input time, apply it
            if (this.currentInputIndex < this.demo.inputs.length &&
                this.lastSimulatedTime >= nextInputTime) {

                const input = this.demo.inputs[this.currentInputIndex];
                this._applyInput(input);

                // CRITICAL: Wait for any async physics triggered by input (e.g. hard drop)
                if (this.gameState.latestPhysicsPromise) {
                    await this.gameState.latestPhysicsPromise;
                    this.gameState.latestPhysicsPromise = null;
                }

                this.currentInputIndex++;
                continue;
            }

            if (this.lastSimulatedTime >= targetTime) {
                break;
            }
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
