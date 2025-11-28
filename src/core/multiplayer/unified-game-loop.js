/**
 * @fileoverview Unified Multiplayer Game Loop
 * Optimized game loop that manages multiple players efficiently
 * Phase 3 Architecture Improvement
 */

import { softDrop as coreSoftDrop } from '../game.js';

/**
 * Unified game loop manager for multiplayer
 * Reduces overhead by processing all players in a single update cycle
 */
export class UnifiedMultiplayerLoop {
    constructor() {
        this.players = [];
        this.lastTime = 0;
        this.animationId = null;
        this.isPaused = false;
        this.isGameOver = false;

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
     * @param {number} playerId - Player identifier
     * @param {Object} playerState - Player game state
     * @param {Function} physicsCallbacks - Physics callbacks for this player
     * @param {Function} soundCallback - Sound callback for drops
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
        this.lastTime = performance.now();
        this.lastFpsTime = this.lastTime;
        this.isPaused = false;
        this.isGameOver = false;
        this.frameCount = 0;

        console.log('[UnifiedLoop] Starting loop');
        this.loop(this.lastTime);
    }

    /**
     * Stop the game loop
     */
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        console.log('[UnifiedLoop] Stopped');
    }

    /**
     * Pause the game loop
     */
    pause() {
        this.isPaused = true;
        console.log('[UnifiedLoop] Paused');
    }

    /**
     * Resume the game loop
     */
    resume() {
        this.isPaused = false;
        this.lastTime = performance.now();
        console.log('[UnifiedLoop] Resumed');
    }

    /**
     * Main game loop - called every frame
     * @param {number} currentTime - Current timestamp from RAF
     */
    loop(currentTime) {
        // Schedule next frame
        this.animationId = requestAnimationFrame((t) => this.loop(t));

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

        // Update all players in a single pass
        this.updatePlayers(delta);

        // Callback for rendering
        if (this.onRender) {
            this.onRender();
        }

        // Callback for stats update
        if (this.onStatsUpdate) {
            this.onStatsUpdate();
        }

        // Callback for custom update logic
        if (this.onUpdate) {
            this.onUpdate(currentTime, delta);
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

            // Skip if player is processing physics or has no current piece
            if (state.isProcessingPhysics || !state.currentPiece) {
                continue;
            }

            // Auto-drop logic
            state.dropCounter += delta;
            if (state.dropCounter > state.dropInterval) {
                this.performDrop(player);
            }
        }
    }

    /**
     * Perform drop for a specific player
     * @param {Object} player - Player object with state and callbacks
     */
    performDrop(player) {
        try {
            coreSoftDrop(
                player.state,
                player.sound || (() => {}),
                player.physics,
            );
        } catch (error) {
            console.error(`[UnifiedLoop] Drop error for player ${player.id}:`, error);
        }
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
