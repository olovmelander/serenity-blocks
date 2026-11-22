/**
 * FFA Attack Router - All-vs-All Combat System
 *
 * Routes garbage attacks from one player to ALL opponents (Free-For-All), each receiving the
 * full attack. The size rules are the versus rules (versus-rules.js): the crowd cut once more
 * than four players are alive, and no cancelling unless the match turns it on. What the rows
 * become (rows, blind pieces or a full blind) is the attack style's (garbage.js ATTACK_TYPES).
 * In a hot potato match the host's potato decides where attacks go (hot-potato.js); every
 * player is a team of one online.
 */

import {
    GarbageAttack,
    calculateGarbage,
    versusAttackRules,
} from '../garbage.js';
import { clearBlind } from '../blind.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';
import { MessageTypes } from '../network/message-types.js';
import { ensureAttackCredit, takeCrowdCut } from './versus-rules.js';
import {
    countHolderRows, createHotPotatoState, isHotPotatoConfig, potatoRoute, stepHotPotato,
} from './hot-potato.js';

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
        return isHotPotatoConfig(this.gameState.matchConfig);
    }

    /**
     * A fresh potato for a new match or round: nobody holds it, the first holder is chosen
     * two seconds in. Every node resets its own copy at the round start; afterwards peers take
     * the host's from GAME_POTATO_UPDATE.
     * @param {number} [now]
     */
    resetHotPotato(now = Date.now()) {
        const enabled = this.isHotPotatoEnabled();
        this.gameState.hotPotatoState = createHotPotatoState(enabled);
        this._potatoClockAt = now;
        if (!enabled) return;
        if (this.isHost) {
            this._broadcastHotPotato(null);
        } else {
            const state = this.gameState.hotPotatoState;
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.HOT_POTATO_UPDATED, { state, event: null });
        }
    }

    _getHotPotatoState() {
        if (!this.gameState.hotPotatoState) {
            this.resetHotPotato();
        }
        return this.gameState.hotPotatoState;
    }

    /** @returns {Array<{ key: string, alive: boolean }>} every player is a team of one online */
    _potatoTeams() {
        return Array.from(this.gameState.players.values())
            .map((player) => ({ key: player.steamId, alive: player.isAlive === true }))
            .sort((left, right) => (left.key < right.key ? -1 : Number(left.key > right.key)));
    }

    /**
     * Tell every peer the host's potato (HUD state) and what just happened to it.
     * @param {Object|null} event
     */
    _broadcastHotPotato(event) {
        const state = this.gameState.hotPotatoState;
        if (!state) return;
        const copy = { ...state, targets: { ...state.targets }, order: state.order.slice() };
        this.gameState.network?.broadcastToAll?.(MessageTypes.GAME_POTATO_UPDATE, {
            state: copy,
            event,
            roundGeneration: this.gameState.roundGeneration,
        });
        // The host never receives its own broadcast: echo it for the host's HUD.
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.HOT_POTATO_UPDATED, {
            state: copy,
            event: event ? { type: event.type, team: event.team } : null,
        });
    }

    /**
     * A player got rid of the potato (host): its waiting garbage is dropped and its hidden
     * cells show. The peer does the same to its own board on GAME_POTATO_UPDATE.
     * @param {{ team: string }} event
     */
    _potatoPassed(event) {
        const player = this.gameState.players.get(event.team);
        if (!player) return;
        player.garbageQueue?.clear?.();
        clearBlind(player.gameState);
    }

    /**
     * Run the host's potato clock to `now` (host only; every fixed tick).
     * @param {number} [now]
     * @returns {Object|null} the potato event, if one happened
     */
    updateHotPotato(now = Date.now()) {
        if (!this.isHost || !this.isHotPotatoEnabled()) return null;
        const state = this._getHotPotatoState();
        const last = Number.isFinite(this._potatoClockAt) ? this._potatoClockAt : now;
        this._potatoClockAt = now;
        const event = stepHotPotato(state, Math.max(0, now - last), this._potatoTeams());
        if (event?.type === 'pass') this._potatoPassed(event);
        if (event) this._broadcastHotPotato(event);
        return event;
    }

    /**
     * Route one attack in a hot potato match (host). The holder's attack counts toward its
     * target; anyone else's goes only to the holder; with nobody holding it nothing is sent.
     * @param {string} attackerSteamId
     * @param {GarbageAttack} attack
     * @returns {{ handled: boolean, targetId: string|null }} handled: nothing more to send
     */
    routeHotPotatoAttack(attackerSteamId, attack) {
        const state = this._getHotPotatoState();
        const { route, holder } = potatoRoute(state, attackerSteamId);
        if (route === 'holder') return { handled: false, targetId: holder };
        if (route === 'count') {
            const event = countHolderRows(state, attackerSteamId, attack.getTotalLines());
            if (event) this._potatoPassed(event);
            this._broadcastHotPotato(event);
        }
        this.recordAttack({
            from: attackerSteamId,
            fromName: this.gameState.players.get(attackerSteamId)?.name || attackerSteamId,
            totalLines: 0,
            targetCount: 0,
            attackType: 'potato',
            timestamp: Date.now(),
        });
        return { handled: true, targetId: null };
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

        const rules = versusAttackRules(this.gameState.matchConfig);
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

        if (totalLines <= 0) {
            return; // No attack (too small)
        }

        let potatoTargetId = null;
        if (this.isHotPotatoEnabled()) {
            const potato = this.routeHotPotatoAttack(attackerSteamId, attack);
            if (potato.handled) return;
            potatoTargetId = potato.targetId;
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

        // Get all living opponents (everyone except attacker; only the potato's holder in a
        // hot potato match)
        const opponents = Array.from(this.gameState.players.values())
            .filter((p) => p.steamId !== attackerSteamId && p.isAlive)
            .filter((p) => potatoTargetId === null || p.steamId === potatoTargetId);

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
        const garbageAttack = options.attack
            || calculateGarbage(cascadeSummary, versusAttackRules(this.gameState.matchConfig));
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
        const lineCount = entries.filter((entry) => entry.type === 'line').length;
        const lastLineIndex = lineCount - 1;
        // Blind entries are numbered after the rows, so each has its own attackId:lineIndex
        // (the peer's idempotent adopt keys on it: garbageBurstKey).
        let blindIndex = lineCount;
        entries = entries.map((entry) => {
            const isLine = entry.type === 'line';
            const currentLineIndex = isLine ? lineIndex++ : blindIndex++;
            return {
                ...entry,
                attackId: attackMeta.attackId || entry.attackId,
                attackSeq: attackMeta.attackSeq,
                sourceSimTick: attackMeta.sourceSimTick,
                createdSimTick: attackMeta.createdSimTick ?? attackMeta.sourceSimTick,
                sourceLockSeq: attackMeta.sourceLockSeq,
                targetId: opponent.steamId,
                lineIndex: currentLineIndex,
                applyAfterLockSeq: opponent._lockSeq || 0,
                rulesHash: attackMeta.rulesHash,
                clearSummary: attackMeta.clearSummary,
                isLastInBurst: isLine ? currentLineIndex === lastLineIndex : entry.isLastInBurst,
                connectAbove: isLine ? currentLineIndex > 0 : entry.connectAbove,
                connectBelow: isLine ? currentLineIndex < lastLineIndex : entry.connectBelow,
            };
        });

        // Frag credit counts the attack's rows (whatever they become), before the opponent's
        // pending cap drops any.
        const credit = ensureAttackCredit(opponent);
        credit.noteAttack(attacker.steamId, Math.min(lineLimit, garbageAttack.getTotalLines()));
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
