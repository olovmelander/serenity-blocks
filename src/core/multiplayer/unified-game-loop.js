/**
 * @fileoverview Unified Multiplayer Game Loop
 * Optimized game loop that manages multiple players efficiently
 * Phase 3 Architecture Improvement
 */

import { processAutoDrop } from '../game.js';
import { decrementBlindTimers } from '../blind.js';
import { advanceTick } from '../simulation-tick.js';
import { FIXED_TICK_MS } from '../fixed-tick-clock.js';

function readLoopTime() {
    return performance.now();
}

/**
 * Unified game loop manager for multiplayer
 * Reduces overhead by processing all players in a single update cycle
 */
export class UnifiedMultiplayerLoop {
    constructor() {
        this.players = [];
        this.lastTime = 0;
        this.animationId = null;
        this.externalUpdateTimerId = null;
        this.externalUpdateIntervalMs = FIXED_TICK_MS;
        this.externalUpdateLastTime = 0;
        this.externalUpdateGeneration = 0;
        this.runGeneration = 0;
        this.isRunning = false;
        this.isPaused = false;
        this.isGameOver = false;
        this.externalPlayerUpdate = false;
        // Competitive online MP must NEVER pause the sim (pausing desyncs the netcode).
        // When this latch is set, pause() is a no-op so no menu/visibility/background-tab
        // path can freeze a live match. Set via setNeverPause(true) while online.
        this.neverPause = false;

        // Performance tracking
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.currentFps = 0;

        // Callbacks
        this.onUpdate = null;
        this.onRender = null;
        this.onStatsUpdate = null;
    }

    /**
     * Register a player for unified updates
     * @param {string|number} playerId - Player identifier
     * @param {Object} playerState - Player game state
     * @param {Object} physicsCallbacks - Physics callbacks for this player
     * @param {Function|null} soundCallback - Sound callback for drops
     */
    registerPlayer(playerId, playerState, physicsCallbacks, soundCallback) {
        this.players.push({
            id: playerId,
            state: playerState,
            physics: physicsCallbacks,
            sound: soundCallback,
        });

        console.log(`[UnifiedLoop] Registered player ${playerId} (total: ${this.players.length})`);
    }

    /**
     * Unregister a player
     * @param {number} playerId - Player to remove
     */
    unregisterPlayer(playerId) {
        this.players = this.players.filter((p) => p.id !== playerId);
        console.log(`[UnifiedLoop] Unregistered player ${playerId} (remaining: ${this.players.length})`);
    }

    /**
     * Clear all players
     */
    clearPlayers() {
        this.players = [];
        console.log('[UnifiedLoop] All players cleared');
    }

    /**
     * Start the unified game loop
     */
    start() {
        if (this.isRunning) return;
        this.lastTime = readLoopTime();
        this.lastFpsTime = this.lastTime;
        this.isPaused = false;
        this.isGameOver = false;
        this.frameCount = 0;
        this.isRunning = true;
        this.runGeneration += 1;
        this._startExternalUpdateDriver();

        console.log('[UnifiedLoop] Starting loop');
        this.loop(this.lastTime, this.runGeneration);
    }

    /**
     * Stop the game loop
     */
    stop() {
        this.isRunning = false;
        this.runGeneration += 1;
        this._stopExternalUpdateDriver();
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        console.log('[UnifiedLoop] Stopped');
    }

    /**
     * Pause the game loop
     */
    pause() {
        if (this.neverPause) {
            console.warn('[UnifiedLoop] pause() ignored — online match is live (never-pause latch set)');
            return;
        }
        this.isPaused = true;
        this._stopExternalUpdateDriver();
        console.log('[UnifiedLoop] Paused');
    }

    /**
     * Latch that makes pause() a no-op (competitive online MP must never pause).
     * @param {boolean} value
     */
    setNeverPause(value) {
        const wasPaused = this.isPaused;
        this.neverPause = !!value;
        if (this.neverPause) {
            this.isPaused = false; // ensure we're not already paused when the latch goes on
            if (wasPaused) this._startExternalUpdateDriver();
        }
    }

    /**
     * Resume the game loop
     */
    resume() {
        this.isPaused = false;
        this.lastTime = readLoopTime();
        this._startExternalUpdateDriver();
        console.log('[UnifiedLoop] Resumed');
    }

    /**
     * Main game loop - called every frame
     * @param {number} currentTime - Current timestamp from RAF
     */
    loop(currentTime, generation = this.runGeneration) {
        if (!this.isRunning || generation !== this.runGeneration) return;
        // Schedule next frame
        this.animationId = requestAnimationFrame((t) => this.loop(t, generation));

        // Check exit conditions
        if (this.isGameOver) return;
        if (this.isPaused) return;

        // Calculate delta
        const delta = currentTime - this.lastTime;
        this.lastTime = currentTime;

        // Update FPS counter
        this.frameCount++;
        if (currentTime - this.lastFpsTime >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = currentTime;
        }

        // External fixed simulation has a timeout owner; rAF only observes it.
        // Legacy paths retain their historical players→render→stats→custom order.
        const externalUpdate = this.externalPlayerUpdate;
        if (!externalUpdate) {
            this.updatePlayers(delta);
        }

        // Callback for rendering
        if (this.onRender) {
            this.onRender();
        }

        // Callback for stats update
        if (this.onStatsUpdate) {
            this.onStatsUpdate();
        }

        // Callback for custom update logic
        if (!externalUpdate && this.onUpdate) {
            this.onUpdate(currentTime, delta);
        }
    }

    _stopExternalUpdateDriver() {
        this.externalUpdateGeneration += 1;
        if (this.externalUpdateTimerId !== null) {
            clearTimeout(this.externalUpdateTimerId);
            this.externalUpdateTimerId = null;
        }
    }

    _scheduleExternalUpdateDriver(generation) {
        if (
            !this.isRunning
            || !this.externalPlayerUpdate
            || this.isPaused
            || this.isGameOver
            || generation !== this.externalUpdateGeneration
        ) return;
        this.externalUpdateTimerId = setTimeout(
            () => this._runExternalUpdateDriver(generation),
            this.externalUpdateIntervalMs,
        );
    }

    _startExternalUpdateDriver() {
        this._stopExternalUpdateDriver();
        if (!this.isRunning || !this.externalPlayerUpdate || this.isPaused || this.isGameOver) return;
        this.externalUpdateLastTime = readLoopTime();
        this._scheduleExternalUpdateDriver(this.externalUpdateGeneration);
    }

    _runExternalUpdateDriver(generation) {
        if (
            !this.isRunning
            || !this.externalPlayerUpdate
            || this.isPaused
            || this.isGameOver
            || generation !== this.externalUpdateGeneration
        ) return;
        this.externalUpdateTimerId = null;
        const currentTime = readLoopTime();
        const delta = Math.max(0, currentTime - this.externalUpdateLastTime);
        this.externalUpdateLastTime = currentTime;
        this._scheduleExternalUpdateDriver(generation);
        try {
            this.onUpdate?.(currentTime, delta);
        } catch (error) {
            // A partially applied multi-board tick is not safe to continue.
            // Invalidate the pre-scheduled successor before surfacing the fault.
            this._stopExternalUpdateDriver();
            throw error;
        }
    }

    /**
     * Update all players efficiently
     * @param {number} delta - Time since last update
     */
    updatePlayers(delta) {
        // Batch process all active players
        for (let i = 0; i < this.players.length; i++) {
            const player = this.players[i];
            const { state } = player;

            // Skip if game is over or player is explicitly dead
            if (state.isGameOver === true || state.isAlive === false) {
                continue;
            }

            // Tick down active blind blackout timers (delta is in ms, we need seconds)
            decrementBlindTimers(state, delta / 1000);

            // Handle hit-stop decrement and freeze
            if (state.hitStopRemaining > 0) {
                state.hitStopRemaining = Math.max(0, state.hitStopRemaining - delta);
                continue;
            }

            // Skip if player is processing physics or has no current piece
            if (state.isProcessingPhysics || !state.currentPiece) {
                continue;
            }

            // Auto-drop logic (fixed-step accumulator for FPS-independent timing)
            processAutoDrop(
                state,
                delta,
                player.sound || (() => {}),
                player.physics,
            );
        }
    }

    /**
     * Advance each live board by one canonical tick.
     * A function keeps the original advance-only API; an adapter may also own
     * command application and observe the resulting dispositions.
     * @param {Function|Object|null} [inputAdapter]
     * @param {Function|null} [shouldContinue] Abort if the enclosing sim ownership changes.
     */
    updatePlayersFixedTick(inputAdapter = null, shouldContinue = null) {
        const advanceInput = typeof inputAdapter === 'function'
            ? inputAdapter
            : inputAdapter?.advanceInput;
        const applyInput = typeof inputAdapter === 'object'
            ? inputAdapter?.applyInput
            : null;
        const onTickResult = typeof inputAdapter === 'object'
            ? inputAdapter?.onTickResult
            : null;

        for (let i = 0; i < this.players.length; i++) {
            if (shouldContinue && !shouldContinue()) break;
            const player = this.players[i];
            const { state } = player;
            if (state.isGameOver === true || state.isAlive === false) continue;

            const result = advanceTick(state, {
                advanceInput: advanceInput
                    ? (context) => advanceInput(player.id, context)
                    : undefined,
                applyInput: applyInput
                    ? (command) => applyInput(player.id, command)
                    : undefined,
                advancePhysics: (tickMs) => processAutoDrop(
                    state,
                    tickMs,
                    player.sound,
                    player.physics,
                    { fixedTick: true },
                ),
                shouldContinue,
            });
            if (shouldContinue && !shouldContinue()) break;
            onTickResult?.(player.id, result);
        }
    }

    setExternalPlayerUpdate(enabled, intervalMs = FIXED_TICK_MS) {
        const nextEnabled = enabled === true;
        const numericInterval = Number(intervalMs);
        const nextInterval = Number.isFinite(numericInterval) && numericInterval > 0
            ? numericInterval
            : FIXED_TICK_MS;
        const changed = nextEnabled !== this.externalPlayerUpdate
            || nextInterval !== this.externalUpdateIntervalMs;
        this.externalPlayerUpdate = nextEnabled;
        this.externalUpdateIntervalMs = nextInterval;
        if (!this.isRunning || !changed) return;
        this.lastTime = readLoopTime();
        if (nextEnabled) this._startExternalUpdateDriver();
        else this._stopExternalUpdateDriver();
    }

    /**
     * Get current performance metrics
     * @returns {Object} Performance info
     */
    getMetrics() {
        return {
            fps: this.currentFps,
            playerCount: this.players.length,
            activePlayers: this.players.filter((p) => !p.state.isProcessingPhysics).length,
            isPaused: this.isPaused,
            isGameOver: this.isGameOver,
        };
    }

    /**
     * Set game over state
     */
    setGameOver() {
        this.isGameOver = true;
        this._stopExternalUpdateDriver();
        this.players.forEach((p) => {
            if (p.state) {
                p.state.isGameOver = true;
            }
        });
        console.log('[UnifiedLoop] Game over');
    }
}

/**
 * Singleton instance for global use
 */
export const unifiedLoop = new UnifiedMultiplayerLoop();
