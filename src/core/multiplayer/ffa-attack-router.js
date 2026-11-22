/**
 * FFA Attack Router - All-vs-All Combat System
 *
 * Routes garbage attacks from one player to ALL opponents (Free-For-All), each receiving the
 * full attack. The size rules are the versus rules (versus-rules.js): the crowd cut once more
 * than four players are alive, and no cancelling unless the match turns it on.
 */

import {
    ATTACK_TYPES,
    DEFAULT_POTATO_DURATION_MS,
    DEFAULT_POTATO_PENALTY_LINES,
    GarbageAttack,
    calculateGarbage,
    createGarbageAttackFromColumns,
} from '../garbage.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';
import { MessageTypes } from '../network/message-types.js';
import { ensureAttackCredit, takeCrowdCut } from './versus-rules.js';

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
        // Each round starts with the next seat after the last round's first holder.
        const holderId = enabled ? this._chooseHotPotatoHolder(this._lastPotatoStarter ?? null) : null;
        this._lastPotatoStarter = holderId;

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

        this.gameState.network?.broadcastToAll?.(MessageTypes.GAME_POTATO_UPDATE, state.lastEvent);
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

        // The potato's own rows are nobody's attack: dying under them earns no frag.
        holder.lastAttackerId = null;
        ensureAttackCredit(holder).holder = null;
        this.gameState.network?.broadcastToAll?.(MessageTypes.GAME_POTATO_DETONATE, {
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
            // To the next seat. Passing to the first opponent in roster order bounced the
            // potato between the first two players.
            this._transferHotPotato(attackerSteamId, this._chooseHotPotatoHolder(attackerSteamId), 'pass');
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
   * The crowd cut comes off first. Cancelling (matchConfig.garbageCancellation 'full', off
   * by default) lets outgoing lines cancel pending incoming garbage before the rest is sent.
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

        // Calculate the garbage attack (calculateGarbage in garbage.js), less the crowd cut.
        const rawAttack = calculateGarbage(cascadeSummary, rules);
        const rawLines = rawAttack.getTotalLines();
        const attack = this.applyCrowdCut(attacker, rawAttack);
        const attackMeta = this.gameState._createAttackMetadata?.(attackerSteamId, cascadeSummary) || {};
        if (attackMeta.attackId) {
            attack.withId(attackMeta.attackId);
        }
        const totalLines = attack.getTotalLines();

        if (this.isHotPotatoEnabled()) {
            this.routeHotPotatoAttack(attackerSteamId, attack);
            return;
        }

        // Blind / Full Blind carry a visual effect even with zero garbage lines,
        // so they must bypass the line-count guard (parity with local mode).
        if (
            totalLines <= 0
            && attack.attackType !== ATTACK_TYPES.BLIND
            && attack.attackType !== ATTACK_TYPES.FULL_BLIND
        ) {
            return; // No attack (too small)
        }

        this._logGarbage(`💥 ${attacker.name} cleared lines → ${totalLines} garbage lines`);

        // PHASE 3.5: Apply garbage cancellation
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

        // Every opponent receives the whole attack (the crowd cut above is the only size rule).
        const scaledLines = effectiveLines;

        // Distribute garbage to all opponents
        opponents.forEach((opponent) => {
            this.sendGarbageToPlayer(opponent, scaledLines, cascadeSummary, attacker, {
                attack,
                attackMeta,
            });
        });

        // Track attack in history
        this.recordAttack({
            attackId: attackMeta.attackId,
            attackSeq: attackMeta.attackSeq,
            from: attacker.steamId,
            fromName: attacker.name,
            rawLines,
            cancelledLines,
            totalLines: scaledLines,
            targetCount: opponents.length,
            timestamp: Date.now(),
            sourceSimTick: attackMeta.sourceSimTick,
            sourceLockSeq: attackMeta.sourceLockSeq,
        });

        const garbagePayload = {
            attackId: attackMeta.attackId,
            attackSeq: attackMeta.attackSeq,
            from: attackerSteamId,
            fromName: attacker.name,
            rawLines,
            cancelledLines,
            totalLines: scaledLines,
            targets: opponents.map((o) => o.steamId),
            targetCount: opponents.length,
            sourceSimTick: attackMeta.sourceSimTick,
            sourceLockSeq: attackMeta.sourceLockSeq,
        };

        this.gameState._recordNetEvent?.('attack_routed', {
            ...garbagePayload,
            rulesHash: attackMeta.rulesHash,
        });

        // Broadcast attack event to all peers (they render it from the network msg)…
        this.gameState.network.broadcastToAll(MessageTypes.GAME_GARBAGE_SENT, garbagePayload);
        // …and emit a LOCAL echo so the HOST (which never receives its own broadcast)
        // also logs the attack in the Battle Log. Only the host runs routeAttack, so
        // this fires once on the host and never on peers — no double entry.
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_SENT, garbagePayload);
    }

    /**
   * Send garbage to a specific player
   * ENHANCED: Insert immediately if opponent has no piece
   */
    sendGarbageToPlayer(opponent, lines, cascadeSummary, attacker, options = {}) {
        // Create garbage entries with attacker's color and steamId
        const context = {
            color: attacker.color || '#808080', // Use player's assigned color
            attackerId: attacker.steamId, // Track who sent the garbage for frag attribution
            attackerName: attacker.name, // Track name directly
        };

        this._logGarbage(`📦 Creating garbage entries with attackerId: ${attacker.steamId} (${attacker.name})`);

        // Expand garbage into actual entries
        const attackMeta = options.attackMeta || {};
        const garbageAttack = options.attack || calculateGarbage(cascadeSummary, this.gameState.matchConfig?.attackRules || {});
        if (attackMeta.attackId && typeof garbageAttack.withId === 'function') {
            garbageAttack.withId(attackMeta.attackId);
        }
        let entries = garbageAttack.expandEntries(context);

        const lineLimit = Math.max(0, Math.floor(Number(lines) || 0));
        let acceptedLines = 0;
        entries = entries.filter((entry) => {
            if (entry.type !== 'line') return true;
            if (acceptedLines >= lineLimit) return false;
            acceptedLines += 1;
            return true;
        });

        let lineIndex = 0;
        const lastLineIndex = entries.filter((entry) => entry.type === 'line').length - 1;
        entries = entries.map((entry) => {
            const isLine = entry.type === 'line';
            const currentLineIndex = isLine ? lineIndex++ : 0;
            return {
                ...entry,
                attackId: attackMeta.attackId || entry.attackId,
                attackSeq: attackMeta.attackSeq,
                sourceSimTick: attackMeta.sourceSimTick,
                createdSimTick: attackMeta.createdSimTick ?? attackMeta.sourceSimTick,
                sourceLockSeq: attackMeta.sourceLockSeq,
                targetId: opponent.steamId,
                lineIndex: isLine ? currentLineIndex : undefined,
                applyAfterLockSeq: opponent._lockSeq || 0,
                rulesHash: attackMeta.rulesHash,
                clearSummary: attackMeta.clearSummary,
                isLastInBurst: isLine ? currentLineIndex === lastLineIndex : entry.isLastInBurst,
                connectAbove: isLine ? currentLineIndex > 0 : entry.connectAbove,
                connectBelow: isLine ? currentLineIndex < lastLineIndex : entry.connectBelow,
            };
        });

        // Frag credit counts the rows sent, before the opponent's pending cap drops any.
        const credit = ensureAttackCredit(opponent);
        credit.noteAttack(attacker.steamId, entries.filter((entry) => entry.type === 'line').length);
        opponent.lastAttackerId = credit.killer;

        // Verify attackerId is set
        this._logGarbage(`📦 Generated ${entries.length} entries, checking attackerId...`);
        entries.forEach((entry, idx) => {
            if (entry.attackerId) {
                this._logGarbage(`  ✅ Entry ${idx}: attackerId = ${entry.attackerId}`);
            } else {
                this._logGarbage(`  ❌ Entry ${idx}: NO attackerId!`);
            }
        });

        // Queue it for the victim's next spawn, where the peer inserts it too. Inserting
        // at once whenever the victim had no piece also fired during its line-clear
        // animation: the clear then removed a garbage row instead of the full one and
        // scored a phantom wave, on the host's copy only.
        opponent.garbageQueue.enqueue(entries);

        this._logGarbage(`  → ${opponent.name} receives ${lines} lines (queue: ${opponent.garbageQueue.getTotalLines()})`);
        this._logGarbage(`  → Opponent's queue now has ${opponent.garbageQueue.entries.length} entries`);
    }

    /**
     * Take the crowd cut off an attack's normal rows, spending the attacker's crowd stamps
     * (earned per placed piece while more than four players are alive; versus-rules.js).
     * A move that empties the board keeps its full size, and boring rules turn the cut off.
     * @param {{ crowdStamps?: number }} attacker
     * @param {GarbageAttack} attack
     * @returns {GarbageAttack}
     */
    applyCrowdCut(attacker, attack) {
        const normal = attack.holeMasks?.length || 0;
        const { lines, stamps } = takeCrowdCut(normal, attacker.crowdStamps, {
            clean: attack.sendForPerfectClear,
            boringRules: this.gameState.matchConfig?.boringRules,
        });
        attacker.crowdStamps = stamps;
        if (lines >= normal) return attack;
        return GarbageAttack.fromJSON({
            ...attack.toJSON(),
            holeMasks: attack.holeMasks.slice(0, lines),
        }).withId(attack.id);
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
