/**
 * @fileoverview Multi-player game state for 2-4 player local multiplayer
 * Manages N independent game states with garbage interaction
 * 
 * This replaces MultiplayerGameState for scalable local multiplayer
 */

import { GameState, markBoardDirty } from './game.js';
import {
    GarbageQueue, calculateGarbage, insertGarbageEntries, ATTACK_TYPES,
} from './garbage.js';
import { processPhysics } from './physics.js';
import { LEVEL_SPEEDS } from './constants.js';

/**
 * Player color scheme for visual distinction
 * Colors are vibrant, accessible, and easily distinguishable
 */
export const PLAYER_COLORS = [
    {
        primary: '#3B82F6',      // Blue - Player 1
        light: '#60A5FA',
        glow: 'rgba(59, 130, 246, 0.5)',
        name: 'Blue'
    },
    {
        primary: '#EF4444',      // Red - Player 2
        light: '#F87171',
        glow: 'rgba(239, 68, 68, 0.5)',
        name: 'Red'
    },
    {
        primary: '#10B981',      // Green - Player 3
        light: '#34D399',
        glow: 'rgba(16, 185, 129, 0.5)',
        name: 'Green'
    },
    {
        primary: '#F59E0B',      // Amber/Orange - Player 4
        light: '#FBBF24',
        glow: 'rgba(245, 158, 11, 0.5)',
        name: 'Amber'
    }
];

/**
 * Multi-player game state that manages 2-4 players
 */
export class MultiPlayerState {
    constructor(numPlayers = 2) {
        this.numPlayers = numPlayers;

        // Player game states (array-based for scalability)
        this.players = [];
        this.garbageQueues = [];
        this.playerColors = []; // Store player color assignments

        for (let i = 0; i < numPlayers; i++) {
            this.players.push(new GameState());
            this.garbageQueues.push(new GarbageQueue());
            this.playerColors.push(PLAYER_COLORS[i]);
        }
        
        // Match configuration (set by LocalMultiplayerMode)
        this.matchConfig = {
            endCondition: 'frags',
            endConditionValue: 7,
            startLevel: 1,
            levelProgression: false,
            boringRules: false,
        };
        
        // Match state
        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null; // Player index (0-3) or null
        this.matchStartTime = 0;
        
        // Frag tracking (kills)
        this.frags = new Array(numPlayers).fill(0);
        this.lastAttackerIds = new Array(numPlayers).fill(null); // Track who last attacked each player
        
        // Timing (shared between players)
        this.lastTime = 0;
        this.animationId = null;
        
        // Attack sequencing per player for deterministic IDs
        this.attackSequences = new Array(numPlayers).fill(0);
        
        // Shared RNG seed for fairness (set by mode)
        this.sharedPieceSeed = 0;
    }
    
    /**
     * Set match configuration
     */
    setMatchConfig(config) {
        this.matchConfig = { ...this.matchConfig, ...config };
    }
    
    /**
     * Reset the game state
     */
    reset() {
        for (let i = 0; i < this.numPlayers; i++) {
            this.players[i].reset();

            // Apply match configuration settings
            if (this.matchConfig) {
                // Set start level from match config
                if (this.matchConfig.startLevel) {
                    this.players[i].level = this.matchConfig.startLevel;

                    // Update drop interval based on start level
                    const speedIndex = Math.min(
                        this.matchConfig.startLevel - 1,
                        LEVEL_SPEEDS.length - 1
                    );
                    this.players[i].dropInterval = LEVEL_SPEEDS[speedIndex];

                    console.log(`[MultiPlayerState] Player ${i + 1} reset: level=${this.players[i].level}, dropInterval=${this.players[i].dropInterval}ms`);
                }
            }

            this.garbageQueues[i].clear();
            this.frags[i] = 0;
            this.lastAttackerIds[i] = null;
        }

        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null;
        this.lastTime = 0;
        this.matchStartTime = Date.now();
    }
    
    /**
     * Get player state by index
     */
    getPlayerState(playerIndex) {
        return this.players[playerIndex];
    }
    
    /**
     * Get opponent state by index (for 2 players only)
     * @deprecated Use getPlayerState with specific index instead
     */
    getOpponentState(playerIndex) {
        if (this.numPlayers !== 2) {
            console.warn('[MultiPlayerState] getOpponentState only works for 2 players');
            return null;
        }
        return this.players[playerIndex === 0 ? 1 : 0];
    }
    
    /**
     * Get garbage queue by index
     */
    getGarbageQueue(playerIndex) {
        return this.garbageQueues[playerIndex];
    }

    /**
     * Get player color scheme by index
     */
    getPlayerColor(playerIndex) {
        return this.playerColors[playerIndex];
    }

    /**
     * Handle garbage summary and route to opponents
     * 
     * For 2 players: Send to other player
     * For 3+ players: Distribute to all other players
     */
    handleGarbageSummary(playerIndex, summary, onGarbageSend) {
        const attack = calculateGarbage(summary);
        const attackerState = this.players[playerIndex];
        
        const sequence = typeof summary.sequence === 'number'
            ? summary.sequence
            : this.attackSequences[playerIndex]++;
        const attackId = `P${playerIndex + 1}-A${sequence}`;
        attack.withId(attackId);
        
        let totalLines = attack.getTotalLines();
        
        console.log(
            `[MultiPlayerState] Player ${playerIndex + 1} cascade resolved → depth=${attack.depth}, combo=${attack.complexity}`,
        );
        
        // Apply attack scaling based on player count
        totalLines = this._scaleAttackForPlayerCount(totalLines);
        
        console.log(
            `[MultiPlayerState]   Total attack rows: ${totalLines} (scaled from ${attack.getTotalLines()})`,
        );
        
        if (totalLines <= 0 && attack.attackType !== ATTACK_TYPES.BLIND) {
            return;
        }
        
        // Get attacker's color for garbage blocks
        const attackerColor = this.getPlayerColor(playerIndex);

        const context = {
            color: attackerColor ? attackerColor.primary : '#808080',
        };
        
        const entries = attack.expandEntries(context);
        
        // Route garbage to all opponents
        const targets = this._getAttackTargets(playerIndex);
        
        if (targets.length === 0) {
            console.log(`[MultiPlayerState] No valid targets for Player ${playerIndex + 1}`);
            return;
        }
        
        targets.forEach((targetIndex) => {
            // Track last attacker for frag attribution
            this.lastAttackerIds[targetIndex] = playerIndex;

            const targetQueue = this.garbageQueues[targetIndex];
            const targetPlayerState = this.players[targetIndex];
            const queueableEntries = [];

            entries.forEach((entry) => {
                if (entry.type === 'full_blind') {
                    targetQueue.enqueue({
                        type: 'full_blind',
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                } else if (entry.type === 'blind') {
                    targetQueue.enqueue({
                        type: 'blind',
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                } else {
                    queueableEntries.push(entry);
                }
            });

            if (queueableEntries.length > 0) {
                // Add to garbage queue - will be inserted when next piece locks
                queueableEntries.forEach(entry => {
                    targetQueue.enqueue({
                        ...entry,
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                });
            }

            console.log(
                `[MultiPlayerState] Player ${playerIndex + 1} → Player ${targetIndex + 1}: ${totalLines} lines`,
            );
        });
        
        if (onGarbageSend) {
            onGarbageSend(playerIndex, targets, totalLines);
        }
    }
    
    /**
     * Determine attack targets for a player
     * 
     * For 2 players: Always attack the other player
     * For 3-4 players: Attack all other alive players (evenly distributed)
     */
    _getAttackTargets(attackerIndex) {
        const targets = [];
        
        for (let i = 0; i < this.numPlayers; i++) {
            if (i !== attackerIndex && this.players[i].isAlive) {
                targets.push(i);
            }
        }
        
        return targets;
    }
    
    /**
     * Apply attack scaling based on number of players
     * Similar to Quadra's "boring rules" system
     * 
     * Without boring rules:
     * - 2 players: 100% damage (no scaling)
     * - 3 players: 75% damage
     * - 4 players: 50% damage
     */
    _scaleAttackForPlayerCount(totalLines) {
        if (this.matchConfig.boringRules) {
            return totalLines; // No scaling with boring rules
        }
        
        // Count alive players
        const alivePlayers = this.players.filter(p => p.isAlive).length;
        
        if (alivePlayers <= 2) {
            return totalLines; // Full damage for 2 players
        } else if (alivePlayers === 3) {
            return Math.ceil(totalLines * 0.75); // 75% damage for 3 players
        } else {
            return Math.ceil(totalLines * 0.5); // 50% damage for 4+ players
        }
    }
    
    /**
     * Mark a player as dead and award frag
     */
    handlePlayerDeath(playerIndex) {
        const player = this.players[playerIndex];
        
        if (!player.isAlive) {
            return; // Already dead
        }
        
        player.isAlive = false;
        
        // Award frag to last attacker
        const killerId = this.lastAttackerIds[playerIndex];
        
        if (killerId !== null && killerId !== playerIndex) {
            this.frags[killerId]++;
            console.log(
                `[MultiPlayerState] 💀 Player ${killerId + 1} fragged Player ${playerIndex + 1}! Frags: ${this.frags[killerId]}`,
            );
        } else {
            console.log(`[MultiPlayerState] 💀 Player ${playerIndex + 1} self-destructed (no frag awarded)`);
        }
        
        // Check win condition
        this.checkWinCondition();
    }
    
    /**
     * Check if match should end based on win condition
     * NOTE: This checks MATCH win conditions (e.g., first to 7 frags), not round-end conditions.
     * Round-end logic (last player standing) is handled by LocalMultiplayerMode._handleGameOver()
     */
    checkWinCondition() {
        const config = this.matchConfig;
        
        // Check specific win conditions (frags, time, points, lines, never)
        // DO NOT check "last player standing" here - that's a round-end, not match-end
        switch (config.endCondition) {
            case 'frags': {
                const maxFrags = Math.max(...this.frags);
                const topPlayerIndex = this.frags.indexOf(maxFrags);
                if (maxFrags >= config.endConditionValue) {
                    this.endMatch(topPlayerIndex);
                    return true;
                }
                break;
            }
            
            case 'time': {
                const elapsed = (Date.now() - this.matchStartTime) / 1000 / 60; // minutes
                if (elapsed >= config.endConditionValue) {
                    // Winner is player with highest score
                    const scores = this.players.map(p => p.score);
                    const topPlayerIndex = scores.indexOf(Math.max(...scores));
                    this.endMatch(topPlayerIndex);
                    return true;
                }
                break;
            }
            
            case 'points': {
                const targetScore = config.endConditionValue * 1000;
                for (let i = 0; i < this.numPlayers; i++) {
                    if (this.players[i].score >= targetScore) {
                        this.endMatch(i);
                        return true;
                    }
                }
                break;
            }
            
            case 'lines': {
                for (let i = 0; i < this.numPlayers; i++) {
                    if (this.players[i].totalLinesCleared >= config.endConditionValue) {
                        this.endMatch(i);
                        return true;
                    }
                }
                break;
            }
            
            case 'never':
                // Never end automatically
                break;
        }
        
        return false;
    }
    
    /**
     * End the match with a winner
     */
    endMatch(winnerIndex) {
        this.isGameOver = true;
        this.winner = winnerIndex;
        
        if (winnerIndex !== null) {
            console.log(`[MultiPlayerState] 🏆 Player ${winnerIndex + 1} wins the match!`);
        } else {
            console.log('[MultiPlayerState] 🤝 Match ended in a draw');
        }
    }
    
    /**
     * Get match statistics for all players
     */
    getMatchStats() {
        return this.players.map((player, index) => ({
            playerIndex: index,
            playerName: `Player ${index + 1}`,
            frags: this.frags[index],
            score: player.score,
            lines: player.totalLinesCleared,
            isAlive: player.isAlive,
            level: player.level,
        }));
    }
    
    /**
     * Get sorted leaderboard
     */
    getLeaderboard() {
        const stats = this.getMatchStats();
        
        // Sort by: frags (desc) → score (desc) → lines (desc)
        stats.sort((a, b) => {
            if (b.frags !== a.frags) return b.frags - a.frags;
            if (b.score !== a.score) return b.score - a.score;
            return b.lines - a.lines;
        });
        
        return stats;
    }
}

