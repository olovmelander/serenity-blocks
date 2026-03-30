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

        // 1. Determine candidates (all peers minus old host)
        // We use the player list from game state
        const peers = Array.from(this.gameState.players.values())
            .filter((p) => !p.isDisconnected && p.steamId !== this.network.hostSteamId);

        if (peers.length === 0) {
            console.error('❌ No peers left to migrate to.');
            return;
        }

        // 2. Select candidate with lowest Steam ID (string comparison)
        // This is a deterministic way for all peers to agree on the same candidate
        peers.sort((a, b) => a.steamId.localeCompare(b.steamId));
        const candidate = peers[0];

        console.log(`🗳️ Election started. Candidate: ${candidate.name} (${candidate.steamId})`);

        // 3. If I am the candidate, claim host
        if (candidate.steamId === this.gameState.localPlayerId) {
            this.claimHost();
        }
    }

    /**
     * Claim host status
     */
    claimHost() {
        console.log('👑 I am the new host! Broadcasting claim...');

        // Broadcast CLAIM message
        // Note: We might need to send this to individual peers if broadcast assumes host?
        // But in P2P mesh (Steam), usually we can send to everyone.
        // Assuming network.broadcastToAll works even if not host (it should just iter peers)
        this.network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_CLAIM, {
            newHostId: this.gameState.localPlayerId,
        });

        // Actually become host
        this.becomeHost();
    }

    /**
     * Transition to host role
     */
    becomeHost() {
        this.stopMonitoring();
        this.isElectionInProgress = false;

        // Update network role
        this.network.isHost = true;
        this.network.hostSteamId = this.gameState.localPlayerId;
        this.gameState.isHost = true;

        console.log('🚀 Migration complete. I am now the host.');

        // Initialize host systems
        if (this.gameState.inputValidator) {
            this.gameState.inputValidator.reset();
        }

        // Resume game loop as host
        this.gameState.startHeartbeatLoop();

        // CRITICAL: Explicitly sync state to all peers to assert authority
        const snapshot = this.gameState.buildStateSnapshot();
        this.network.broadcastToAll(MessageTypes.GAME_HOST_MIGRATION_SYNC, {
            snapshot,
            newHostId: this.gameState.localPlayerId
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
        const { newHostId } = msg.data;
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
