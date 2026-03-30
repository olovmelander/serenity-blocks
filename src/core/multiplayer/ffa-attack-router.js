/**
 * FFA Attack Router - All-vs-All Combat System
 *
 * Routes garbage attacks from one player to ALL opponents (Free-For-All)
 * Implements Quadra-style attack scaling based on player count
 */

import { calculateGarbage } from '../garbage.js';

export class FFAAttackRouter {
    constructor(ffaGameState) {
        this.gameState = ffaGameState;
        this.isHost = ffaGameState.isHost;
        this.debugGarbage = ffaGameState.debugGarbage === true;

        // Track recent attacks for debugging
        this.attackHistory = [];
        this.MAX_HISTORY = 50;
    }

    _logGarbage(...args) {
        if (this.debugGarbage) {
            console.log(...args);
        }
    }

    /**
   * Route garbage attack from one player to ALL opponents
   * (HOST ONLY - only host can route attacks)
   *
   * PHASE 3.5: Implements garbage cancellation (Quadra/TETR.IO style)
   * Outgoing lines first cancel any pending incoming garbage,
   * then only the remainder is sent to opponents.
   */
    routeAttack(attackerSteamId, cascadeSummary) {
        if (!this.isHost) {
            console.warn('⚠️ Only host can route attacks');
            return;
        }

        const attacker = this.gameState.players.get(attackerSteamId);
        if (!attacker || !attacker.isAlive) {
            return; // Attacker doesn't exist or is dead
        }

        // Calculate garbage attack using Quadra formula
        const attack = calculateGarbage(cascadeSummary);
        const totalLines = attack.getTotalLines();

        if (totalLines <= 0) {
            return; // No attack (too small)
        }

        this._logGarbage(`💥 ${attacker.name} cleared lines → ${totalLines} garbage lines`);

        // PHASE 3.5: Apply garbage cancellation (Quadra/TETR.IO style)
        // Outgoing lines first cancel incoming garbage, then remainder goes to opponents
        const cancelledLines = this.gameState.applyGarbageCounter(attackerSteamId, totalLines);
        const effectiveLines = totalLines - cancelledLines;

        if (cancelledLines > 0) {
            this._logGarbage(`  🛡️ Cancelled ${cancelledLines} incoming lines, sending ${effectiveLines} to opponents`);
        }

        // If all lines were used for cancellation, no attack goes out
        if (effectiveLines <= 0) {
            this._logGarbage('  ⚔️ All lines used for cancellation - no attack sent');
            return;
        }

        // Get all living opponents (everyone except attacker)
        const opponents = Array.from(this.gameState.players.values())
            .filter((p) => p.steamId !== attackerSteamId && p.isAlive);

        if (opponents.length === 0) {
            this._logGarbage('  ⚠️ No opponents alive - attack wasted');
            return;
        }

        // Apply attack scaling based on opponent count (Quadra style)
        const scaledLines = this.applyAttackScaling(
            effectiveLines,
            opponents.length,
            this.gameState.matchConfig.boringRules,
        );

        // Distribute garbage to all opponents
        opponents.forEach((opponent) => {
            this.sendGarbageToPlayer(opponent, scaledLines, cascadeSummary, attacker);
        });

        // Track attack in history
        this.recordAttack({
            from: attacker.steamId,
            fromName: attacker.name,
            totalLines: scaledLines,
            targetCount: opponents.length,
            timestamp: Date.now(),
        });

        // Broadcast attack event to all players
        this.gameState.network.broadcastToAll('game:garbage:sent', {
            from: attackerSteamId,
            fromName: attacker.name,
            totalLines: scaledLines,
            targets: opponents.map((o) => o.steamId),
            targetCount: opponents.length,
        });
    }

    /**
   * Send garbage to a specific player
   * ENHANCED: Insert immediately if opponent has no piece
   */
    sendGarbageToPlayer(opponent, lines, cascadeSummary, attacker) {
        // Create garbage entries with attacker's color and steamId
        const context = {
            color: attacker.color || '#808080', // Use player's assigned color
            attackerId: attacker.steamId, // Track who sent the garbage for frag attribution
            attackerName: attacker.name, // Track name directly
        };

        this._logGarbage(`📦 Creating garbage entries with attackerId: ${attacker.steamId} (${attacker.name})`);

        // Expand garbage into actual entries
        const garbageAttack = calculateGarbage(cascadeSummary);
        const entries = garbageAttack.expandEntries(context);

        // Verify attackerId is set
        this._logGarbage(`📦 Generated ${entries.length} entries, checking attackerId...`);
        entries.forEach((entry, idx) => {
            if (entry.attackerId) {
                this._logGarbage(`  ✅ Entry ${idx}: attackerId = ${entry.attackerId}`);
            } else {
                this._logGarbage(`  ❌ Entry ${idx}: NO attackerId!`);
            }
        });

        // Add to opponent's garbage queue
        opponent.garbageQueue.enqueue(entries);

        this._logGarbage(`  → ${opponent.name} receives ${lines} lines (queue: ${opponent.garbageQueue.getTotalLines()})`);
        this._logGarbage(`  → Opponent's queue now has ${opponent.garbageQueue.entries.length} entries`);

        // PHASE 3.1: If opponent has no piece (between spawns), insert immediately
        // This makes garbage more responsive and prevents stalling
        if (!opponent.gameState.currentPiece && !opponent.gameState.isGameOver) {
            this._logGarbage('  ⚡ Immediate insertion (no piece active)');
            this.gameState.insertPendingGarbage(opponent.steamId);
        }
    }

    /**
     * Apply Quadra-style attack scaling - REMOVED
     *
     * Quadra does NOT scale attacks based on player count directly.
     * It uses a stamp-based handicap system instead.
     * We return the base lines unmodified here.
     */
    applyAttackScaling(baseLines, opponentCount, boringRules) {
        // If boring rules (classic) enabled, no scaling
        if (boringRules) {
            return baseLines;
        }

        // Standard FFA scaling: Reduce garbage power as player count increases
        // 1 opponent: 100%
        // 2 opponents: 90%
        // 3 opponents: 80%
        // ...
        // 7 opponents: 40% (floor at 25%)

        if (opponentCount <= 1) return baseLines;

        const reductionPerOpponent = 0.10; // 10% reduction per extra opponent
        let multiplier = 1.0 - ((opponentCount - 1) * reductionPerOpponent);

        // Cap minimum multiplier at 0.25 (25% power)
        multiplier = Math.max(0.25, multiplier);

        // return Math.ceil(baseLines * multiplier);
        // Better to round normally or use stochastic rounding?
        // Using ceil ensures at least some garbage is sent for small attacks
        // But for < 1 it becomes 1?
        // Base lines is integer.
        // If lines=4, opp=7 (scale=0.4) -> 1.6 -> 2 lines.
        const scaled = Math.round(baseLines * multiplier);

        // Ensure at least 1 line if original was > 0
        return baseLines > 0 ? Math.max(1, scaled) : 0;
    }

    /**
   * Record attack in history (for debugging/analytics)
   */
    recordAttack(attackData) {
        this.attackHistory.unshift(attackData);

        // Keep only recent history
        if (this.attackHistory.length > this.MAX_HISTORY) {
            this.attackHistory.pop();
        }
    }

    /**
   * Get attack statistics
   */
    getStats() {
        const playerStats = new Map();

        this.attackHistory.forEach((attack) => {
            if (!playerStats.has(attack.from)) {
                playerStats.set(attack.from, {
                    steamId: attack.from,
                    name: attack.fromName,
                    totalAttacks: 0,
                    totalLinesSent: 0,
                });
            }

            const stats = playerStats.get(attack.from);
            stats.totalAttacks++;
            stats.totalLinesSent += attack.totalLines * attack.targetCount;
        });

        return Array.from(playerStats.values());
    }

    /**
   * Clear attack history
   */
    clearHistory() {
        this.attackHistory = [];
    }
}
