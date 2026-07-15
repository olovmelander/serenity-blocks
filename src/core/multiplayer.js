/**
 * @fileoverview Multiplayer game state and logic for 2-player local multiplayer
 * Manages two independent game states with garbage interaction
 */

import { GameState, applyGarbage } from './game.js';
import {
    GarbageQueue, calculateGarbage, ATTACK_TYPES,
} from './garbage.js';
import { processPhysics } from './physics.js';

/**
 * Multiplayer game state that manages two players
 */
export class MultiplayerGameState {
    constructor() {
        // Player game states
        this.player1 = new GameState();
        this.player2 = new GameState();

        // Garbage queues
        this.player1GarbageQueue = new GarbageQueue();
        this.player2GarbageQueue = new GarbageQueue();

        // Game control flags
        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null; // 'player1', 'player2', or null

        // Timing (shared between players)
        this.lastTime = 0;
        this.animationId = null;

        // Attack sequencing per player for deterministic IDs
        this.attackSequences = {
            1: 0,
            2: 0,
        };
    }

    /**
     * Reset the multiplayer game state
     */
    reset() {
        this.player1.reset();
        this.player2.reset();
        this.player1GarbageQueue.clear();
        this.player2GarbageQueue.clear();
        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null;
        this.lastTime = 0;
    }

    /**
     * Handle a completed cascade summary and generate garbage for the opponent.
     * Mirrors Quadra's depth/complexity to attack conversion.
     *
     * @param {number} player - Player number (1 or 2)
     * @param {Object} summary - Cascade summary produced by physics.onGarbageReady
     * @param {Function} onGarbageSend - Callback when garbage lines are queued
     */
    handleGarbageSummary(player, summary, onGarbageSend) {
        const attack = calculateGarbage(summary);
        const attackerState = this.getPlayerState(player);
        const opponentState = this.getOpponentState(player);
        const opponentQueue = player === 1 ? this.player2GarbageQueue : this.player1GarbageQueue;

        const sequence = typeof summary.sequence === 'number'
            ? summary.sequence
            : this.attackSequences[player]++;
        const attackId = `P${player}-A${sequence}`;
        attack.withId(attackId);

        const totalLines = attack.getTotalLines();
        console.log(
            `[MultiplayerState] Player ${player} cascade resolved → depth=${attack.depth}, `
            + `combo=${attack.complexity}, clean=${attack.sendForPerfectClear}`,
        );
        console.log(
            `[MultiplayerState]   Total attack rows: ${totalLines} (clean bonus: ${attack.cleanRowBonus})`,
        );

        if (
            totalLines <= 0
            && attack.attackType !== ATTACK_TYPES.BLIND
            && attack.attackType !== ATTACK_TYPES.FULL_BLIND
        ) {
            return;
        }

        const context = {
            color: summary.sourceColor || attackerState.comboState?.sourceColor || '#808080',
            team: summary.team || null,
        };

        const entries = attack.expandEntries(context);
        const queueableEntries = [];

        entries.forEach((entry) => {
            if (entry.type === 'full_blind') {
                this.applyFullBlindEffect(opponentState, entry.duration, attack);
            } else {
                queueableEntries.push(entry);
            }
        });

        if (queueableEntries.length > 0) {
            opponentQueue.enqueue(queueableEntries);
        }

        const totalQueued = opponentQueue.getTotalLines();
        const opponentNum = player === 1 ? 2 : 1;
        console.log(
            `[MultiplayerState] Player ${opponentNum} now has ${totalQueued} total garbage queued`,
        );

        if (onGarbageSend) {
            onGarbageSend(player, totalLines);
        }
    }

    /**
     * Insert pending garbage into a player's board with animation
     * Called when a piece locks and there's garbage in queue
     * @param {number} player - Player number (1 or 2)
     * @param {Object} options - Animation options
     * @returns {Object} Result with success, topOut flags, and garbage pieces
     */
    insertPendingGarbage(player, options = { animated: true }) {
        const queue = player === 1 ? this.player1GarbageQueue : this.player2GarbageQueue;
        const gameState = player === 1 ? this.player1 : this.player2;

        const blindEntries = queue.takePendingBlindEntries();
        blindEntries.forEach((entry) => this.applyBlindEffect(gameState, entry.duration));

        const burst = queue.dequeueLineBurst();
        if (burst.length === 0) {
            return {
                success: true,
                topOut: false,
                garbagePieces: [],
                settledSteps: 0,
                linesAfterInsertion: [],
            };
        }

        // Board mutation + grid/cache repair live in the ONE boundary (§5.1) —
        // this caller previously only marked dirty and relied on the renderer's
        // per-frame rebuild to heal the grid before the next collision read.
        const result = applyGarbage(gameState, burst, options);
        return result;
    }

    /**
     * Resolve any immediate line clears or cascades that result from garbage insertion.
     * Runs the physics pipeline without spawning a new piece automatically.
     *
     * @param {number} player - Player number (1 or 2)
     * @param {Object} physicsCallbacks - Physics callback set for the player
     */
    async resolveGarbageCascade(player, physicsCallbacks) {
        if (!physicsCallbacks) return;

        const gameState = this.getPlayerState(player);
        if (!gameState || gameState.isProcessingPhysics) {
            return;
        }

        console.log(
            `[MultiplayerState] Resolving cascades after garbage insertion for Player ${player}`,
        );

        gameState.isProcessingPhysics = true;
        try {
            const patchedCallbacks = {
                ...physicsCallbacks,
                spawnPiece: () => {
                    // Suppress automatic respawn here. We'll spawn manually after physics settles.
                },
            };

            await processPhysics(gameState, patchedCallbacks);
        } finally {
            gameState.isProcessingPhysics = false;
        }
    }

    /**
     * Check if game is over and determine winner
     * @param {number} losingPlayer - Player who topped out (1 or 2)
     */
    setGameOver(losingPlayer) {
        this.isGameOver = true;
        this.player1.isGameOver = true;
        this.player2.isGameOver = true;

        // Set winner as the other player
        this.winner = losingPlayer === 1 ? 'player2' : 'player1';
    }

    /**
     * Get current player's game state
     * @param {number} player - Player number (1 or 2)
     * @returns {GameState} Player's game state
     */
    getPlayerState(player) {
        return player === 1 ? this.player1 : this.player2;
    }

    /**
     * Get opponent's game state
     * @param {number} player - Player number (1 or 2)
     * @returns {GameState} Opponent's game state
     */
    getOpponentState(player) {
        return player === 1 ? this.player2 : this.player1;
    }

    /**
     * Get garbage queue for a player
     * @param {number} player - Player number (1 or 2)
     * @returns {GarbageQueue} Player's garbage queue
     */
    getGarbageQueue(player) {
        return player === 1 ? this.player1GarbageQueue : this.player2GarbageQueue;
    }

    /**
     * Check if either player has topped out
     * @returns {number|null} Player number who topped out, or null
     */
    checkTopOut() {
        if (this.player1.isGameOver) return 1;
        if (this.player2.isGameOver) return 2;
        return null;
    }

    applyBlindEffect(gameState, duration) {
        if (!gameState || duration <= 0) return;
        console.log(`[MultiplayerState] Applying blind effect for duration=${duration}`);
        gameState.blindTimers.pending = Math.max(gameState.blindTimers.pending || 0, duration);
        gameState.lockedPieces.forEach((piece) => {
            piece.blindTime = Math.max(piece.blindTime || 0, duration);
        });
    }

    applyFullBlindEffect(gameState, duration, attack) {
        if (!gameState || duration <= 0) return;
        console.log(
            `[MultiplayerState] Applying FULL blind effect for duration=${duration} `
            + `(attack ${attack?.id || 'unknown'})`,
        );
        gameState.blindTimers.field = Math.max(gameState.blindTimers.field || 0, duration);
        this.applyBlindEffect(gameState, duration);
    }
}
