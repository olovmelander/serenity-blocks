/**
 * FFA Attack Router - All-vs-All Combat System
 *
 * Routes garbage attacks from one player to ALL opponents (Free-For-All)
 * Implements Quadra-style attack scaling based on player count
 */

import {
    ATTACK_TYPES,
    DEFAULT_POTATO_DURATION_MS,
    DEFAULT_POTATO_PENALTY_LINES,
    calculateGarbage,
    createGarbageAttackFromColumns,
} from '../garbage.js';

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

    isHotPotatoEnabled() {
        const config = this.gameState.matchConfig || {};
        const rules = config.attackRules || {};
        return !!(
            config.hotPotato
            || config.attackStyle === 'hot_potato'
            || rules.forceAttackType === ATTACK_TYPES.POTATO
        );
    }

    resetHotPotato(now = Date.now()) {
        const config = this.gameState.matchConfig || {};
        const rules = config.attackRules || {};
        const enabled = this.isHotPotatoEnabled();
        const durationMs = Math.max(1000, Number(config.potatoDurationMs || rules.potatoDurationMs || DEFAULT_POTATO_DURATION_MS));
        const penaltyLines = Math.max(1, Number(config.potatoPenaltyLines || rules.potatoPenaltyLines || DEFAULT_POTATO_PENALTY_LINES));
        const holderId = enabled ? this._chooseHotPotatoHolder(null) : null;

        this.gameState.hotPotatoState = {
            enabled,
            holderId,
            previousHolderId: null,
            expiresAt: holderId ? now + durationMs : 0,
            durationMs,
            penaltyLines,
            generation: 0,
            lastEvent: null,
        };
    }

    _getHotPotatoState() {
        if (!this.gameState.hotPotatoState) {
            this.resetHotPotato();
        }
        return this.gameState.hotPotatoState;
    }

    _getAliveOpponentIds(attackerSteamId) {
        return Array.from(this.gameState.players.values())
            .filter((player) => player.steamId !== attackerSteamId && player.isAlive)
            .map((player) => player.steamId);
    }

    _chooseHotPotatoHolder(previousHolderId = null, preferredTargets = []) {
        const aliveIds = Array.from(this.gameState.players.values())
            .filter((player) => player.isAlive)
            .map((player) => player.steamId)
            .sort();

        if (aliveIds.length === 0) return null;

        const preferred = preferredTargets.find((steamId) => aliveIds.includes(steamId) && steamId !== previousHolderId);
        if (preferred) return preferred;

        if (!previousHolderId || !aliveIds.includes(previousHolderId)) {
            return aliveIds[0];
        }

        return aliveIds.find((steamId) => steamId > previousHolderId) || aliveIds[0];
    }

    _transferHotPotato(fromId, toId, reason = 'pass', now = Date.now()) {
        const state = this._getHotPotatoState();
        if (!state.enabled || !toId) return null;

        state.previousHolderId = fromId || state.holderId;
        state.holderId = toId;
        state.expiresAt = now + state.durationMs;
        state.generation++;
        state.lastEvent = {
            type: reason,
            fromId,
            toId,
            timestamp: now,
            generation: state.generation,
        };

        this.gameState.network?.broadcastToAll?.('game:potato:update', state.lastEvent);
        return state.lastEvent;
    }

    _buildPotatoPenaltyAttack(holderId) {
        const state = this._getHotPotatoState();
        const playerIds = Array.from(this.gameState.players.keys()).sort();
        const holderOffset = Math.max(0, playerIds.indexOf(holderId));
        const columnsByRow = Array.from({ length: state.penaltyLines }, (_, rowIndex) => [
            (holderOffset * 3 + rowIndex * 2) % 10,
        ]);

        return createGarbageAttackFromColumns({
            rows: state.penaltyLines,
            columnsByRow,
            attackType: ATTACK_TYPES.POTATO,
            metadata: {
                source: 'hot_potato',
                holderId,
                generation: state.generation,
            },
        }).withId(`POTATO-${state.generation + 1}`);
    }

    detonateHotPotato(now = Date.now()) {
        const state = this._getHotPotatoState();
        if (!state.enabled || !state.holderId) return null;

        const holder = this.gameState.players.get(state.holderId);
        if (!holder?.isAlive) {
            const nextHolder = this._chooseHotPotatoHolder(state.holderId);
            return this._transferHotPotato(state.holderId, nextHolder, 'holder_eliminated', now);
        }

        const attack = this._buildPotatoPenaltyAttack(holder.steamId);
        const entries = attack.expandEntries({
            color: holder.color || '#f97316',
            attackerId: null,
            attackerName: 'Hot Potato',
        });

        entries.forEach((entry) => {
            holder.garbageQueue.enqueue({
                ...entry,
                attackerId: null,
                attackerName: 'Hot Potato',
                isHotPotato: true,
            });
        });

        holder.lastAttackerId = null;
        this.gameState.network?.broadcastToAll?.('game:potato:detonate', {
            holderId: holder.steamId,
            holderName: holder.name,
            lines: entries.filter((entry) => entry.type === 'line').length,
        });

        const nextHolder = this._chooseHotPotatoHolder(holder.steamId);
        return this._transferHotPotato(holder.steamId, nextHolder, 'detonate', now);
    }

    updateHotPotato(now = Date.now()) {
        if (!this.isHost || !this.isHotPotatoEnabled()) return null;
        const state = this._getHotPotatoState();
        const holder = state.holderId ? this.gameState.players.get(state.holderId) : null;

        if (!holder?.isAlive) {
            const nextHolder = this._chooseHotPotatoHolder(state.holderId);
            return this._transferHotPotato(state.holderId, nextHolder, 'holder_eliminated', now);
        }

        if (state.expiresAt > 0 && now >= state.expiresAt) {
            return this.detonateHotPotato(now);
        }

        return null;
    }

    routeHotPotatoAttack(attackerSteamId, attack) {
        const state = this._getHotPotatoState();
        const lineCount = attack.getTotalLines();
        if (!state.enabled || lineCount <= 0) return true;

        const targets = this._getAliveOpponentIds(attackerSteamId);
        if (targets.length === 0) return true;

        if (!state.holderId) {
            this._transferHotPotato(null, this._chooseHotPotatoHolder(null), 'start');
        } else if (state.holderId === attackerSteamId) {
            this._transferHotPotato(attackerSteamId, this._chooseHotPotatoHolder(attackerSteamId, targets), 'pass');
        }

        this.recordAttack({
            from: attackerSteamId,
            fromName: this.gameState.players.get(attackerSteamId)?.name || attackerSteamId,
            totalLines: 0,
            targetCount: 0,
            attackType: ATTACK_TYPES.POTATO,
            timestamp: Date.now(),
        });

        return true;
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

        const rules = this.gameState.matchConfig?.attackRules || {};
        if (rules.disableAttacks) {
            return;
        }

        // Calculate garbage attack using Quadra formula
        const attack = calculateGarbage(cascadeSummary, rules);
        const totalLines = attack.getTotalLines();

        if (this.isHotPotatoEnabled()) {
            this.routeHotPotatoAttack(attackerSteamId, attack);
            return;
        }

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
        const garbageAttack = calculateGarbage(cascadeSummary, this.gameState.matchConfig?.attackRules || {});
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
