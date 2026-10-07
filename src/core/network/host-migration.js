// @ts-check
/**
 * Host migration: who takes over when the host is gone, and when nobody should.
 *
 * The host is alive while anything arrives from it (the transport's peer liveness), not
 * only its beat. A peer checks that in every phase:
 * - outside a match (waiting room, countdown, results) a gone host ends the lobby: each
 *   peer leaves, told the host left;
 * - in a match (a round, or the beat after one) the players still present elect a
 *   successor. Candidates are ranked by Steam id, and candidate r claims once r election
 *   steps pass without a claim from one ranked before it, so a dead candidate costs one
 *   step instead of the match. A claim from a candidate ranked before this peer is taken
 *   even before this peer's own monitor fires, once the host has gone quiet here too.
 *   The successor re-announces itself for a few seconds so that late peers follow, and
 *   takes the old host off its roster as departed (multiplayer/ffa/presence.js).
 * A host that leaves on purpose says so (LOBBY_PLAYER_LEFT), and Steam reports lobby
 * departures, so peers rarely wait out the silence.
 *
 * Before this, host loss was only noticed in a round, an election had no timeout and
 * could pick a departed candidate, a claim counted only if the receiver's own monitor
 * had already fired, and the candidate claimed once: survivors hung or split.
 */

import { MessageTypes } from './message-types.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';

/** Host silence that ends a host mid-match. */
export const HOST_GONE_MS = 5000;
/** Host silence that ends a host outside a match, where a busy host (loading the match) must not close the lobby. */
export const HOST_GONE_IDLE_MS = 15_000;
/** Host silence after which a successor's claim is believed before this peer's own monitor fires. */
export const HOST_SUSPECT_MS = 2000;
/** How long each candidate ranked ahead gets to claim. */
export const ELECTION_STEP_MS = 2000;
/** How long, and how often, a successor re-announces itself. */
export const SUCCESSOR_ECHO_MS = 5000;
const SUCCESSOR_ECHO_EVERY_MS = 1000;
const MONITOR_EVERY_MS = 500;

/** @param {string} a @param {string} b */
function byId(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

export class HostMigration {
    /** @param {Record<string, any>} gameState */
    constructor(gameState) {
        this.gameState = gameState;
        this.network = gameState.network;
        this.isElectionInProgress = false;
        this.electionStartedAt = 0;
        /** @type {string|null} why the election began */
        this.electionReason = null;
        /** @type {string|null} the host being replaced */
        this.goneHostId = null;
        /** @type {ReturnType<typeof setInterval>|null} */
        this.monitorInterval = null;
        /** @type {ReturnType<typeof setInterval>|null} */
        this.echoTimer = null;
    }

    /** Watch the host (peers only). */
    startMonitoring() {
        if (this.gameState.isHost) return;
        this.stopMonitoring();
        this.monitorInterval = setInterval(() => this.check(Date.now()), MONITOR_EVERY_MS);
    }

    stopMonitoring() {
        if (this.monitorInterval) clearInterval(this.monitorInterval);
        this.monitorInterval = null;
    }

    /** Stop everything this migration runs (the game state is going away). */
    dispose() {
        this.stopMonitoring();
        if (this.echoTimer) clearInterval(this.echoTimer);
        this.echoTimer = null;
    }

    /**
     * Milliseconds since anything arrived from the host (0 on a transport that cannot
     * tell: such a host is never taken for gone).
     * @param {number} now
     * @param {string|null} [hostId]
     */
    hostSilenceMs(now, hostId = this.network.hostSteamId) {
        if (!hostId || typeof this.network.peerSilenceMs !== 'function') return 0;
        return this.network.peerSilenceMs(hostId, now);
    }

    /** A round is on, or the beat after one: the match goes on without its host. */
    matchInProgress() {
        const game = this.gameState;
        return game.gamePhase === 'playing'
            || (game.gamePhase === 'finished' && game.lastMatchResults?.isGameOver !== true);
    }

    /** @param {number} now */
    check(now) {
        const game = this.gameState;
        if (game.isHost || game._disposed || game.handshakeComplete !== true) return;
        if (this.isElectionInProgress) {
            this._advanceElection(now);
            return;
        }
        const limit = this.matchInProgress() ? HOST_GONE_MS : HOST_GONE_IDLE_MS;
        if (this.hostSilenceMs(now) > limit) this.onHostGone('timeout', now);
    }

    /**
     * The host is gone: elect a successor if a match is on, else leave.
     * @param {string} reason
     * @param {number} [now]
     */
    onHostGone(reason, now = Date.now()) {
        const game = this.gameState;
        if (game.isHost || game._disposed || this.isElectionInProgress) return;
        game._recordNetEvent?.('host_lost', { hostId: this.network.hostSteamId, reason, phase: game.gamePhase });
        if (!this.matchInProgress()) {
            this._leave();
            return;
        }
        console.warn(`⚠️ Host gone (${reason}): electing a successor`);
        this.isElectionInProgress = true;
        this.electionStartedAt = now;
        this.electionReason = reason;
        this.goneHostId = this.network.hostSteamId;
        this._advanceElection(now);
    }

    /** Players still present who could host, in claim order; the gone host is not one. */
    candidates() {
        const gone = this.goneHostId ?? this.network.hostSteamId;
        return Array.from(this.gameState.players?.values?.() || [])
            .filter((player) => player?.steamId && player.isDisconnected !== true && player.steamId !== gone)
            .map((player) => String(player.steamId))
            .sort(byId);
    }

    _getExpectedHostCandidateId() {
        return this.candidates()[0] ?? null;
    }

    /** @param {number} now */
    _advanceElection(now) {
        const waited = now - this.electionStartedAt;
        // Silence, not a leave: the host speaking again before anyone claimed was a blip.
        if (this.electionReason === 'timeout' && this.goneHostId
            && this.hostSilenceMs(now, this.goneHostId) < waited) {
            this.isElectionInProgress = false;
            this.goneHostId = null;
            return;
        }
        const candidates = this.candidates();
        const rank = candidates.indexOf(String(this.gameState.localPlayerId));
        if (rank >= 0 && waited >= rank * ELECTION_STEP_MS) {
            this.claimHost();
            return;
        }
        // Nobody who could host has claimed: the match cannot go on.
        if (waited > (candidates.length + 1) * ELECTION_STEP_MS) this._leave();
    }

    _leave() {
        this.isElectionInProgress = false;
        this.stopMonitoring();
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.KICKED, { reason: 'host_left' });
    }

    /**
     * Whether a peer naming itself the new host is believed: it is a present candidate,
     * none ranked before it is this peer, and the host is gone here too (an election is
     * on, or the host has been quiet for HOST_SUSPECT_MS). A healthy host cannot be
     * displaced.
     * @param {string|null|undefined} senderId
     * @param {string|null|undefined} newHostId
     * @param {number} [now]
     */
    acceptsSuccessor(senderId, newHostId, now = Date.now()) {
        const game = this.gameState;
        if (!senderId || senderId !== newHostId || game.isHost) return false;
        if (senderId === this.network.hostSteamId) return true;
        const candidates = this.candidates();
        const rank = candidates.indexOf(String(newHostId));
        const ownRank = candidates.indexOf(String(game.localPlayerId));
        if (rank < 0 || (ownRank >= 0 && ownRank < rank)) return false;
        return this.isElectionInProgress || this.hostSilenceMs(now) >= HOST_SUSPECT_MS;
    }

    /**
     * Follow a new host.
     * @param {string} newHostId
     * @param {string} source
     */
    adoptHost(newHostId, source) {
        const game = this.gameState;
        const previousHostId = this.network.hostSteamId;
        this.isElectionInProgress = false;
        this.goneHostId = null;
        if (previousHostId === newHostId) return;
        console.log(`🗳️ Following the new host ${newHostId}`);
        this.network.hostSteamId = newHostId;
        game.onHostAuthorityChanged?.({ previousHostId, newHostId, source });
        if (game.localPlayerId !== newHostId) {
            game.isHost = false;
            this.network.isHost = false;
            this.startMonitoring();
        }
    }

    /** @param {{from?: string, data?: Record<string, any>}} msg */
    handleClaim(msg) {
        const game = this.gameState;
        const newHostId = msg?.data?.newHostId;
        if (!this.acceptsSuccessor(msg?.from, newHostId)) {
            console.warn(`🗳️ Ignoring host claim from ${msg?.from} (claimed ${newHostId})`);
            return;
        }
        if (game._acceptMigrationEpoch
            && !game._acceptMigrationEpoch(msg.data?.migrationEpoch, { source: 'migration_claim', from: msg.from })) {
            console.warn(`Ignoring host claim from ${msg.from}: stale migration epoch ${msg.data?.migrationEpoch}`);
            return;
        }
        this.adoptHost(newHostId, 'migration_claim');
    }

    claimHost() {
        const game = this.gameState;
        const migrationEpoch = game.prepareMigrationClaim?.() ?? game.migrationEpoch ?? 0;
        console.log('👑 Claiming host');

        // A peer normally receives only host traffic, so its transport map may not
        // contain the other roster peers. Seed those known identities before the
        // one permitted peer broadcast; otherwise real Steam sends CLAIM/SYNC only
        // to the retired host while mock BroadcastChannel tests falsely pass.
        this._seedMigrationPeersFromRoster();

        this.network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_CLAIM, {
            newHostId: game.localPlayerId,
            migrationEpoch,
        });
        this.becomeHost(migrationEpoch);
    }

    _seedMigrationPeersFromRoster() {
        if (!(this.network.connectedPeers instanceof Map)
            || !(this.gameState.players instanceof Map)) return;

        this.gameState.players.forEach((player, rosterId) => {
            const steamId = player?.steamId || rosterId;
            if (!steamId
                || steamId === this.gameState.localPlayerId
                || steamId === this.goneHostId
                || player?.isDisconnected
                || this.network.connectedPeers.has(steamId)) return;

            this.network.connectedPeers.set(steamId, {
                steamId,
                name: player?.name,
                migrationSeeded: true,
            });
        });
    }

    /** @param {number|null} [migrationEpoch] */
    becomeHost(migrationEpoch = null) {
        const game = this.gameState;
        const goneHostId = this.goneHostId ?? this.network.hostSteamId;
        this.stopMonitoring();
        this.isElectionInProgress = false;
        this.goneHostId = null;

        if (game._migrationEpochEnabled && !Number.isFinite(Number(migrationEpoch))) {
            migrationEpoch = game.prepareMigrationClaim?.() ?? game.migrationEpoch ?? 0;
        }
        if (game._migrationEpochEnabled) {
            game.migrationEpoch = Number(migrationEpoch) || 0;
        }

        game.promoteToHost?.();
        this.network.seedNegotiatedProtocolPeers?.(this.network.connectedPeers?.keys?.() || []);
        console.log('🚀 Migration complete. I am now the host.');

        // Assert authority with the state as this side has it, then keep saying so for a
        // few seconds: a peer whose monitor fires late follows the first one it gets.
        this._announceSuccession(game.buildStateSnapshot?.());
        game.broadcastGameState?.();
        if (this.echoTimer) clearInterval(this.echoTimer);
        let echoes = Math.floor(SUCCESSOR_ECHO_MS / SUCCESSOR_ECHO_EVERY_MS);
        this.echoTimer = setInterval(() => {
            echoes -= 1;
            if (echoes < 0 || game._disposed || !game.isHost) {
                if (this.echoTimer) clearInterval(this.echoTimer);
                this.echoTimer = null;
                return;
            }
            this._announceSuccession(null);
        }, SUCCESSOR_ECHO_EVERY_MS);

        // The host replaced is gone: knocked out with its seat held, or off the roster.
        if (goneHostId && goneHostId !== game.localPlayerId) game.removePlayer?.(goneHostId, 'host_lost');

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.HOST_MIGRATED, {
            newHostId: game.localPlayerId,
        });
    }

    /** @param {Record<string, any>|null|undefined} snapshot */
    _announceSuccession(snapshot) {
        const game = this.gameState;
        this.network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_SYNC, {
            ...(snapshot ? { snapshot } : {}),
            newHostId: game.localPlayerId,
            migrationEpoch: game.migrationEpoch || 0,
            simulationClock: game.matchConfig?.simulationClock,
        });
    }
}
