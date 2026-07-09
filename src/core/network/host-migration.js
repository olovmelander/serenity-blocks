/**
 * Host Migration System
 *
 * Handles automated host handoff when the current host disconnects.
 * Uses a "lowest peer ID" election algorithm.
 */

import { MessageTypes } from './message-types.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';

export class HostMigration {
    constructor(gameState) {
        this.gameState = gameState;
        this.network = gameState.network;
        this.isElectionInProgress = false;

        // Heartbeat tracking
        this.lastHeartbeatTime = Date.now();
        this.HEARTBEAT_TIMEOUT = 5000; // 5 seconds without heartbeat = dead host

        // Election state
        this.electionCandidates = new Set();
        this.myVote = null;
    }

    /**
     * Start monitoring host health (Peers only)
     */
    startMonitoring() {
        if (this.gameState.isHost) return;

        this.monitorInterval = setInterval(() => {
            // Host migration only applies to an ACTIVE match. During the lobby /
            // waiting-room and the initial P2P handshake (which can take several
            // seconds over Steam relay), keep the timer fresh so the joiner never
            // promotes itself to host — doing so would split-brain the lobby (both
            // sides think they're host, which breaks ready-up, chat routing, and
            // roster names).
            if (this.gameState.gamePhase !== 'playing') {
                this.lastHeartbeatTime = Date.now();
                return;
            }
            const now = Date.now();
            if (now - this.lastHeartbeatTime > this.HEARTBEAT_TIMEOUT) {
                console.warn('⚠️ Host heartbeat timeout! Initiating election...');
                this.initiateElection();
            }
        }, 1000);
    }

    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    /**
     * Called when HEARTBEAT received
     */
    onHeartbeat() {
        this.lastHeartbeatTime = Date.now();
        // If we were in an election, cancel it (host is back?)
        if (this.isElectionInProgress) {
            console.log('💓 Host revived? Cancelling election.');
            this.isElectionInProgress = false;
        }
    }

    /**
     * Start an election
     */
    initiateElection() {
        if (this.isElectionInProgress) return;
        this.isElectionInProgress = true;

        const candidateId = this._getExpectedHostCandidateId();
        if (!candidateId) {
            console.error('❌ No peers left to migrate to.');
            this.isElectionInProgress = false;
            return;
        }

        const candidate = this.gameState.players.get(candidateId);
        console.log(`🗳️ Election started. Candidate: ${candidate?.name || 'Unknown'} (${candidateId})`);

        // 3. If I am the candidate, claim host
        if (candidateId === this.gameState.localPlayerId) {
            this.claimHost();
        }
    }

    _getExpectedHostCandidateId() {
        if (!this.gameState.players) return null;

        const peers = Array.from(this.gameState.players.values())
            .filter((p) => p?.steamId && !p.isDisconnected && p.steamId !== this.network.hostSteamId);

        peers.sort((a, b) => String(a.steamId).localeCompare(String(b.steamId)));
        return peers[0]?.steamId || null;
    }

    /**
     * Claim host status
     */
    claimHost() {
        const migrationEpoch = this.gameState.prepareMigrationClaim?.() ?? this.gameState.migrationEpoch ?? 0;
        console.log('👑 I am the new host! Broadcasting claim...');

        // Broadcast CLAIM message
        // Note: We might need to send this to individual peers if broadcast assumes host?
        // But in P2P mesh (Steam), usually we can send to everyone.
        // Assuming network.broadcastToAll works even if not host (it should just iter peers)
        this.network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_CLAIM, {
            newHostId: this.gameState.localPlayerId,
            migrationEpoch,
        });

        // Actually become host
        this.becomeHost(migrationEpoch);
    }

    /**
     * Transition to host role
     */
    becomeHost(migrationEpoch = null) {
        this.stopMonitoring();
        this.isElectionInProgress = false;

        if (this.gameState._migrationEpochEnabled && !Number.isFinite(Number(migrationEpoch))) {
            migrationEpoch = this.gameState.prepareMigrationClaim?.() ?? this.gameState.migrationEpoch ?? 0;
        }
        if (this.gameState._migrationEpochEnabled) {
            this.gameState.migrationEpoch = Number(migrationEpoch) || 0;
        }

        this.gameState.promoteToHost?.();

        console.log('🚀 Migration complete. I am now the host.');

        // CRITICAL: Explicitly sync state to all peers to assert authority
        const snapshot = this.gameState.buildStateSnapshot();
        this.network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_SYNC, {
            snapshot,
            newHostId: this.gameState.localPlayerId,
            migrationEpoch: this.gameState.migrationEpoch || 0,
        });

        // Also fire standard state update just in case
        this.gameState.broadcastGameState();

        // Notify UI
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.HOST_MIGRATED, {
            newHostId: this.gameState.localPlayerId
        });
    }

    /**
     * Handle CLAIM message from another peer
     */
    handleClaim(msg) {
        const { newHostId } = msg.data || {};
        const expectedHostId = this._getExpectedHostCandidateId();

        if (!this.isElectionInProgress) {
            console.warn(`🗳️ Ignoring host claim from ${msg.from}: no election in progress`);
            return;
        }

        if (!newHostId || msg.from !== newHostId) {
            console.warn(`🗳️ Ignoring forged host claim from ${msg.from}: claimed ${newHostId}`);
            return;
        }

        if (expectedHostId !== newHostId) {
            console.warn(`🗳️ Ignoring host claim from ${msg.from}: expected ${expectedHostId}`);
            return;
        }

        if (this.gameState._acceptMigrationEpoch
            && !this.gameState._acceptMigrationEpoch(msg.data?.migrationEpoch, { source: 'migration_claim', from: msg.from })) {
            console.warn(`Ignoring host claim from ${msg.from}: stale migration epoch ${msg.data?.migrationEpoch}`);
            return;
        }

        console.log(`🗳️ Accepting new host: ${newHostId}`);

        this.network.hostSteamId = newHostId;
        this.lastHeartbeatTime = Date.now(); // Reset timeout
        this.isElectionInProgress = false;

        // If we are not the new host, ensure we are in peer mode
        if (this.gameState.localPlayerId !== newHostId) {
            this.gameState.isHost = false;
            this.network.isHost = false;
            this.startMonitoring(); // Monitor new host
        }
    }
}
