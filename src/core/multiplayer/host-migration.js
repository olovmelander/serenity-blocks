/**
 * Host Migration - Seamless Host Handoff
 *
 * Handles host disconnection by selecting a new host from remaining players
 * Ensures match continues even if original host leaves
 */

export class HostMigration {
    constructor(ffaGameState) {
        this.gameState = ffaGameState;
        this.migrationInProgress = false;
    }

    /**
   * Handle host disconnection
   * Select new host from remaining players
   */
    handleHostDisconnect() {
        if (this.gameState.isHost) {
            console.warn('⚠️ You are the host - cannot handle own disconnect');
            return;
        }

        if (this.migrationInProgress) {
            console.log('⚠️ Migration already in progress');
            return;
        }

        console.log('🔄 Host disconnected! Migrating host...');
        this.migrationInProgress = true;

        // Select new host (deterministic: lowest Steam ID)
        const alivePlayers = Array.from(this.gameState.players.values())
            .filter((p) => p.isAlive)
            .sort((a, b) => a.steamId.localeCompare(b.steamId));

        if (alivePlayers.length === 0) {
            console.log('❌ No alive players - match cannot continue');
            this.endMatch();
            return;
        }

        const newHost = alivePlayers[0];
        const isLocalPlayerNewHost = this.gameState.localPlayerId === newHost.steamId;

        if (isLocalPlayerNewHost) {
            // You are the new host!
            console.log('✅ You are now the HOST!');
            this.becomeHost();
        } else {
            // Someone else is the new host
            console.log(`✅ New host: ${newHost.name}`);
            this.gameState.network.hostSteamId = newHost.steamId;
        }

        // Broadcast migration event to all players
        this.gameState.network.broadcastToAll('game:host:migrated', {
            newHost: newHost.steamId,
            newHostName: newHost.name,
        });

        this.migrationInProgress = false;
    }

    /**
   * Become the new host (take over authority)
   */
    becomeHost() {
        // Update local state
        this.gameState.isHost = true;
        this.gameState.network.isHost = true;
        this.gameState.network.hostSteamId = this.gameState.localPlayerId;

        // Initialize host-only systems
        if (!this.gameState.inputValidator) {
            // Re-import InputValidator dynamically if needed
            import('../validation/input-validator.js').then((module) => {
                const { InputValidator } = module;
                this.gameState.inputValidator = new InputValidator();
                console.log('✅ Input validator initialized');
            });
        }

        // Start broadcasting game state at 30Hz
        this.gameState.startStateSyncLoop();

        // HOST MIGRATION STATE TRANSFER:
        // Force immediate broadcast of current state to all peers
        // This acts as the authoritative "resync" for the new host session
        // using our local state (which is now authoritative)
        this.gameState.broadcastGameState();

        console.log('📡 You are now the authoritative host');
        console.log('   - Validating all inputs');
        console.log('   - Broadcasting state at 30Hz');
    }

    /**
   * End match (no host available)
   */
    endMatch() {
        this.gameState.gamePhase = 'finished';
        this.gameState.winner = null;

        console.log('💀 Match ended - no host available');

        // Broadcast match end
        this.gameState.network.broadcastToAll('game:match:end', {
            winner: null,
            winnerName: 'No Winner',
            reason: 'Host disconnected, no replacement found',
        });
    }

    /**
   * Monitor host connection (call periodically)
   */
    checkHostConnection() {
        if (this.gameState.isHost) {
            // You are the host, no need to check
        }

        // Check if we've received any messages from host recently
        // This could be enhanced with a heartbeat system

        // For now, Steam P2P will notify us of disconnection
        // via the peer:disconnect event
    }

    /**
   * Select backup host (for proactive migration)
   */
    selectBackupHost() {
        if (!this.gameState.isHost) {
            return null; // Only host can select backup
        }

        // Select second player (by Steam ID) as backup
        const alivePlayers = Array.from(this.gameState.players.values())
            .filter((p) => p.isAlive && p.steamId !== this.gameState.localPlayerId)
            .sort((a, b) => a.steamId.localeCompare(b.steamId));

        return alivePlayers.length > 0 ? alivePlayers[0] : null;
    }

    /**
   * Prepare for voluntary host handoff (host wants to leave)
   */
    prepareHandoff() {
        if (!this.gameState.isHost) {
            console.warn('⚠️ Only host can initiate handoff');
            return null;
        }

        const newHost = this.selectBackupHost();

        if (!newHost) {
            console.warn('⚠️ No backup host available');
            return null;
        }

        console.log(`🔄 Preparing handoff to ${newHost.name}`);

        // Notify new host
        this.gameState.network.sendP2PMessage(newHost.steamId, 'game:host:handoff', {
            reason: 'Host leaving voluntarily',
        });

        return newHost;
    }
}
