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

        // Track recent attacks for debugging
        this.attackHistory = [];
        this.MAX_HISTORY = 50;
    }

    /**
   * Route garbage attack from one player to ALL opponents
   * (HOST ONLY - only host can route attacks)
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

        console.log(`💥 ${attacker.name} cleared lines → sending ${totalLines} garbage lines`);

        // PHASE 3.2: Apply garbage counter (defensive mechanic)
        // Sending garbage reduces your incoming garbage
        this.gameState.applyGarbageCounter(attackerSteamId, totalLines);

        // Get all living opponents (everyone except attacker)
        const opponents = Array.from(this.gameState.players.values())
            .filter((p) => p.steamId !== attackerSteamId && p.isAlive);

        if (opponents.length === 0) {
            console.log('  ⚠️ No opponents alive - attack wasted');
            return;
        }

        // Apply attack scaling based on opponent count (Quadra style)
        const scaledLines = this.applyAttackScaling(
            totalLines,
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
        };

        console.log(`📦 Creating garbage entries with attackerId: ${attacker.steamId} (${attacker.name})`);

        // Expand garbage into actual entries
        const garbageAttack = calculateGarbage(cascadeSummary);
        const entries = garbageAttack.expandEntries(context);

        // Verify attackerId is set
        console.log(`📦 Generated ${entries.length} entries, checking attackerId...`);
        entries.forEach((entry, idx) => {
            if (entry.attackerId) {
                console.log(`  ✅ Entry ${idx}: attackerId = ${entry.attackerId}`);
            } else {
                console.log(`  ❌ Entry ${idx}: NO attackerId!`);
            }
        });

        // Add to opponent's garbage queue
        opponent.garbageQueue.enqueue(entries);

        console.log(`  → ${opponent.name} receives ${lines} lines (queue: ${opponent.garbageQueue.getTotalLines()})`);
        console.log(`  → Opponent's queue now has ${opponent.garbageQueue.entries.length} entries`);

        // PHASE 3.1: If opponent has no piece (between spawns), insert immediately
        // This makes garbage more responsive and prevents stalling
        if (!opponent.gameState.currentPiece && !opponent.gameState.isGameOver) {
            console.log('  ⚡ Immediate insertion (no piece active)');
            this.gameState.insertPendingGarbage(opponent.steamId);
        }
    }

    /**
   * Apply Quadra-style attack scaling
   *
   * With many players, reduce damage to prevent overwhelming
   * (unless "boring rules" is enabled)
   */
    applyAttackScaling(baseLines, opponentCount, boringRules) {
        if (boringRules || opponentCount <= 2) {
            // No scaling with boring rules or ≤2 opponents
            return baseLines;
        }

        // Quadra scaling formula: reduce damage with 3+ opponents
        // Formula: lines / (1 + (opponentCount - 2) * 0.2)
        // Examples:
        //   2 opponents: 1.0x (no scaling)
        //   3 opponents: 0.83x (1 / 1.2)
        //   4 opponents: 0.71x (1 / 1.4)
        //   5 opponents: 0.63x (1 / 1.6)
        //   8 opponents: 0.45x (1 / 2.2)
        const scaleFactor = 1 + (opponentCount - 2) * 0.2;
        const scaledLines = Math.max(1, Math.floor(baseLines / scaleFactor));

        if (baseLines !== scaledLines) {
            console.log(`  📉 Attack scaled: ${baseLines} → ${scaledLines} lines (${opponentCount} opponents)`);
        }

        return scaledLines;
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
