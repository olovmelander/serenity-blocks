/**
 * FFA P2P Game State - Host-Authoritative Multiplayer
 *
 * This manages the game state for Free-For-All multiplayer using P2P.
 * The host is authoritative (validates all moves, broadcasts state).
 */

import { MessageTypes } from '../network/message-types.js';
import {
    GameState,
    fillBag,
    spawnPiece,
    move,
    rotate,
    softDrop,
    hardDrop,
    markBoardDirty,
} from '../game.js';
import { rebuildBoardGridFromPieces } from '../board.js';
import { GarbageQueue, insertGarbageEntries } from '../garbage.js';
import { InputValidator } from '../validation/input-validator.js';
import { processPhysics } from '../physics.js';
import { PLAYER_COLORS } from '../constants.js';
import { FFAAttackRouter } from './ffa-attack-router.js';
import { FragTracker } from './frag-tracker.js';
import { HostMigration } from '../network/host-migration.js';
import { InGameChat } from '../../ui/ingame-chat.js';
import { unifiedLoop } from './unified-game-loop.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';
import { InputJitterBuffer } from '../network/input-jitter-buffer.js';
import { getBinaryDecoder, getBinaryEncoder } from '../network/binary-encoding.js';
import { createBlindTimers, applyBlindEffect, applyFullBlindEffect } from '../blind.js';

const RESYNC_CHUNK_SIZE = 16 * 1024;
const RESYNC_WINDOW = 4;
const RESYNC_TIMEOUT_MS = 300;
const RESYNC_MAX_RETRIES = 5;

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c >>> 0;
    }
    return table;
})();

const crc32 = (bytes) => {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
};

const encodeUtf8 = (str) => {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str);
    }
    if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(str, 'utf8'));
    }
    return Uint8Array.from(unescape(encodeURIComponent(str)).split('').map((c) => c.charCodeAt(0)));
};

const decodeUtf8 = (bytes) => {
    if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder().decode(bytes);
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('utf8');
    }
    return decodeURIComponent(escape(String.fromCharCode(...bytes)));
};

const encodeBase64 = (bytes) => {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary);
};

const decodeBase64 = (base64) => {
    if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(base64, 'base64'));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

export class FFAGameStateP2P {
    constructor(steamNetworking, localPlayerId) {
        this.network = steamNetworking;
        this.localPlayerId = localPlayerId;
        this.isHost = steamNetworking.isHost;

        // All player states (Map<steamId, PlayerState>)
        this.players = new Map();

        // Initialize local player
        this.addPlayer(localPlayerId, steamNetworking.playerName, true);

        // Lobby Info
        this.lobbyId = null;
        this.lobbyName = null;

        // Match state
        this.gamePhase = 'waiting'; // waiting, countdown, playing, finished
        this.sharedSeed = 0; // Deterministic RNG seed (same pieces for all)
        this.matchConfig = {
            endCondition: 'frags', // 'frags', 'time', 'points', 'lines', 'never'
            endConditionValue: 10,
            startLevel: 1,
            levelProgression: false,
            allowHandicap: true,
            boringRules: false,
            garbageCancellation: 'full', // 'full' (modern Quadra/TETR.IO) | 'disabled' (classic)
            attackStyle: 'standard',
            attackRules: null,
            hotPotato: false,
            potatoDurationMs: 12000,
            potatoPenaltyLines: 6,
        };
        this.winner = null;
        this.matchStartTime = 0;
        this.lastMatchResults = null;
        this.hotPotatoState = null;
        this.rematchVotes = new Set(); // Track steamIds who voted for rematch

        // Input validation (host only)
        this.inputValidator = this.isHost ? new InputValidator() : null;
        this.debugGarbage = typeof window !== 'undefined'
            && window.__MULTIPLAYER_DEBUG_GARBAGE__ === true;

        // State sync (host broadcasts at 30Hz)
        this.stateSyncInterval = null;
        this.STATE_SYNC_RATE = 30; // Hz
        this._lastStateBroadcastTime = 0;
        this._stateBroadcastAccumulator = 0;

        // Track last state for delta detection (reduces network spam)
        this.lastBroadcastState = new Map(); // steamId -> last state snapshot

        // Phase 3 systems
        this.attackRouter = new FFAAttackRouter(this);
        this.fragTracker = new FragTracker(this);
        // Monitor host health (Peers only)
        this.hostMigration = new HostMigration(this);
        if (!this.isHost) {
            this.hostMigration.startMonitoring();
        }

        // Heartbeat (Host only)
        this.heartbeatInterval = null;
        if (this.isHost) {
            this.startHeartbeatLoop();
        }

        // Chat UI
        this.chat = new InGameChat(this);
        this.chatHistory = []; // Unified chat history

        // Phase 4: Input jitter buffer (host only)
        // Smooths input timing for fair gameplay across varying latencies
        this.inputJitterBuffer = this.isHost ? new InputJitterBuffer({
            bufferDepth: 2, // 2 ticks (~66ms at 30Hz)
            tickRate: 30,
        }) : null;
        this.useJitterBuffer = this.matchConfig?.useJitterBuffer !== false; // Enable by default

        // Game loop (unified RAF-driven loop)
        this.unifiedLoop = unifiedLoop;
        this.loopRunning = false;
        this.loopCallbacksConfigured = false;
        this.localInputHooks = {
            advance: null,
            reset: null,
        };

        // === PERFORMANCE OPTIMIZATIONS ===
        // Pre-allocated render payload - reused every frame (saves ~360 allocations/sec)
        this._renderPayload = {
            players: new Array(8).fill(null).map(() => ({
                steamId: null,
                name: null,
                color: null,
                gameState: null,
                garbageQueue: null,
                isLocal: false,
                isAlive: true,
                frags: 0,
            })),
            playerCount: 0,
        };
        this.hostTick = 0;
        this.syncpoint = 'idle';
        this.pendingResyncs = [];
        this.resyncTransfers = new Map();
        this.resyncBuffers = new Map();
        this.resyncChunkSize = RESYNC_CHUNK_SIZE;
        this.resyncWindow = RESYNC_WINDOW;
        this.resyncTimeoutMs = RESYNC_TIMEOUT_MS;
        this.resyncMaxRetries = RESYNC_MAX_RETRIES;
        this.handshakeComplete = this.isHost;

        // Phase 5: Input Batching
        this.pendingInputs = []; // Array of inputs to send this tick
        this.inputSequence = 0; // Local input sequence number
        this.lastAckedTick = -1; // Tick of last acknowledged input
        this.gameTick = 0; // Local simulation tick

        // Setup network handlers
        this.setupNetworkHandlers();

        // If peer, announce joining to host
        if (!this.isHost) {
            this.announceJoin();
        }
    }

    _logGarbage(...args) {
        if (this.debugGarbage) {
            console.log(...args);
        }
    }

    setLocalInputHooks(hooks = {}) {
        this.localInputHooks = {
            advance: typeof hooks.advance === 'function' ? hooks.advance : null,
            reset: typeof hooks.reset === 'function' ? hooks.reset : null,
        };
    }

    /**
   * Add a player to the match
   */
    addPlayer(steamId, name, isLocal = false) {
        if (this.players.has(steamId)) {
            const existing = this.players.get(steamId);
            // RECONNECTION LOGIC: Revive player if they are in grace period
            if (existing.isDisconnected) {
                console.log(`♻️ Player reconnected during grace period: ${name}`);
                clearTimeout(existing.disconnectTimeout);
                existing.isDisconnected = false;
                existing.disconnectTimeout = null;

                // Broadcast update so everyone knows they are back
                if (this.isHost) {
                    this.broadcastPlayerList();
                    this.queueResync(steamId); // Force immediate state sync
                }
                return;
            }

            console.warn(`⚠️ Player ${steamId} already exists`);
            return;
        }

        // Check if PLAYER_COLORS is available
        if (!PLAYER_COLORS || PLAYER_COLORS.length === 0) {
            console.error('❌ PLAYER_COLORS is not available!', PLAYER_COLORS);
            return;
        }

        // Assign color based on join order (wraps around if > 8 players)
        const colorIndex = this.players.size % PLAYER_COLORS.length;
        const playerColor = PLAYER_COLORS[colorIndex];

        console.log(`🎨 Assigning color to ${name}: index=${colorIndex}, color=${playerColor}`);
        console.log('   Available colors:', PLAYER_COLORS);
        console.log('   PLAYER_COLORS type:', typeof PLAYER_COLORS, Array.isArray(PLAYER_COLORS));

        const playerState = {
            steamId,
            name,
            color: playerColor, // NEW: Assign unique player color
            isLocal,
            gameState: new GameState(),
            garbageQueue: new GarbageQueue(),
            isAlive: true,
            isReady: false,
            frags: 0,
            joinedAt: Date.now(),
            lastAttackerId: null, // Track who last sent garbage to this player (for kill attribution)
            isDisconnected: false, // Reconnection tracking
            lastInputSeq: 0, // Last processed input sequence number
        };

        this.players.set(steamId, playerState);
        console.log(`✅ Player added: ${name} (${steamId})${isLocal ? ' [LOCAL]' : ''} - Color: ${playerColor}`);
        console.log(`   Total players: ${this.players.size}`);
        console.log('   All player colors now:', Array.from(this.players.values()).map((p) => ({ name: p.name, color: p.color })));

        // Trigger UI update event
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED, {
            players: this.players,
        });

        // Host broadcasts updated player list
        if (this.isHost) {
            this.broadcastPlayerList();
            if (this.loopRunning) {
                this.syncUnifiedLoopPlayers();
            }
        }
    }

    /**
   * Remove a player from the match
   */
    removePlayer(steamId) {
        const player = this.players.get(steamId);
        if (!player) return;

        // Grace Period Logic:
        // If match is in progress, don't remove immediately. Mark as disconnected.
        if (this.gamePhase === 'playing' && player.isAlive && !player.isDisconnected) {
            console.log(`⚠️ Player disconnected during match: ${player.name} - Entering Grace Period (10s)`);
            player.isDisconnected = true;
            player.disconnectTime = Date.now();

            // Auto-remove after 10s if not reconnected
            player.disconnectTimeout = setTimeout(() => {
                console.log(`🛑 Grace period expired for ${player.name} - Removing player`);
                this._finalizeRemovePlayer(steamId);
            }, 10000);

            // Notify others of disconnect status
            if (this.isHost) {
                this.broadcastPlayerList();
            }
            return;
        }

        this._finalizeRemovePlayer(steamId);
    }

    _finalizeRemovePlayer(steamId) {
        const player = this.players.get(steamId);
        if (!player) return;

        if (player.disconnectTimeout) {
            clearTimeout(player.disconnectTimeout);
        }

        console.log(`👋 Player permanently removed: ${player.name}`);
        this.players.delete(steamId);

        // Clean up validator data (host only)
        if (this.isHost && this.inputValidator) {
            this.inputValidator.resetPlayer(steamId);
        }

        // Broadcast updated player list
        if (this.isHost) {
            this.broadcastPlayerList();
            if (this.loopRunning) {
                this.syncUnifiedLoopPlayers();
            } else if (this.unifiedLoop) {
                this.unifiedLoop.unregisterPlayer(steamId);
            }
        }
    }

    /**
   * Announce joining to host (peer only)
   */
    announceJoin() {
        if (this.isHost) return;

        console.log('📢 Announcing join to host...');

        this.network.sendP2PMessage(
            this.network.hostSteamId,
            MessageTypes.NET_HELLO,
            {
                protocolVersion: this.network.protocolVersion,
                clientVersion: this.network.protocolVersion,
                featureFlags: [],
            },
        );
    }

    /**
   * Setup network message handlers
   */
    setupNetworkHandlers() {
        // === INPUT MESSAGES (Peer → Host) ===

        this.network.on(MessageTypes.NET_HELLO, (msg) => {
            if (!this.isHost) return;
            const requested = msg.data?.protocolVersion;
            const accepted = requested === this.network.protocolVersion;

            // Check for rejoin
            const existing = this.players.get(msg.from);
            if (existing && existing.isDisconnected) {
                clearTimeout(existing.disconnectTimeout);
                existing.isDisconnected = false;
                existing.disconnectTimeout = null;
                console.log(`♻️ Player rejoined via NET_HELLO: ${existing.name}`);
                this.queueResync(msg.from);
            }

            this.network.sendP2PMessage(msg.from, MessageTypes.NET_WELCOME, {
                protocolVersion: this.network.protocolVersion,
                featureFlags: [],
                matchId: this.network.matchId,
                matchNonce: this.network.matchNonce,
                hostSteamId: this.network.hostSteamId,
                accepted,
                reason: accepted ? 'ok' : 'protocol_mismatch',
            });
        });

        this.network.on(MessageTypes.NET_WELCOME, (msg) => {
            if (this.isHost) return;
            if (msg.data?.accepted) {
                console.log('✅ NET_WELCOME received from host');
            } else {
                console.warn(`⚠️ NET_WELCOME rejected: ${msg.data?.reason || 'unknown'}`);
            }
        });

        this.network.on(MessageTypes.GAME_INPUT_MOVE, (msg) => {
            if (this.isHost) {
                this.processPlayerInput(msg.from, 'move', msg.data, msg.timestamp);
            }
        });

        this.network.on(MessageTypes.GAME_INPUT_ROTATE, (msg) => {
            if (this.isHost) {
                this.processPlayerInput(msg.from, 'rotate', msg.data, msg.timestamp);
            }
        });

        this.network.on(MessageTypes.GAME_INPUT_DROP, (msg) => {
            if (this.isHost) {
                this.processPlayerInput(msg.from, 'drop', msg.data, msg.timestamp);
            }
        });

        this.network.on(MessageTypes.GAME_INPUT_BATCH, (msg) => {
            if (this.isHost) {
                this.processInputBatch(msg.from, msg.data, msg.timestamp);
            }
        });

        // === STATE SYNC MESSAGES (Host → Peers) ===

        this.network.on(MessageTypes.GAME_STATE_FULL, (msg) => {
            if (!this.isHost) {
                this.syncFromHost(msg.data);
            }
        });

        this.network.on(MessageTypes.GAME_STATE_RESYNC, (msg) => {
            if (!this.isHost) {
                this._handleResyncChunk(msg);
            }
        });

        this.network.on(MessageTypes.GAME_STATE_RESYNC_ACK, (msg) => {
            if (this.isHost) {
                this._handleResyncAck(msg);
            }
        });

        this.network.on(MessageTypes.GAME_SYNCPOINT, (msg) => {
            if (!this.isHost) {
                this.syncpoint = msg.data?.syncpoint ?? this.syncpoint;
            }
        });

        this.network.on(MessageTypes.LOBBY_PLAYER_JOINED, (msg) => {
            console.log('📬 LOBBY_PLAYER_JOINED received:', msg);
            console.log('   isHost:', this.isHost);
            console.log('   msg.data:', msg.data);

            // Host receives join announcement from peer
            if (this.isHost && msg.data.steamId && msg.data.name) {
                console.log(`📢 Host received join from: ${msg.data.name} (${msg.data.steamId})`);
                if (msg.data.steamId !== this.localPlayerId) {
                    this.addPlayer(msg.data.steamId, msg.data.name);
                    this.queueResync(msg.data.steamId);
                }
            }

            // Peers receive player list update from host
            if (!this.isHost && msg.data.players) {
                console.log('📢 Peer received player list update from host:', msg.data.players);
                msg.data.players.forEach((p) => {
                    if (!this.players.has(p.steamId)) {
                        console.log(`   Adding player: ${p.name} with color from host: ${p.color}`);
                        this.addPlayer(p.steamId, p.name, p.steamId === this.localPlayerId);
                        // Override auto-assigned color with host's color
                        const player = this.players.get(p.steamId);
                        if (player && p.color) {
                            console.log(`   🎨 Overriding color for ${p.name}: ${player.color} → ${p.color}`);
                            player.color = p.color;
                        }
                    } else {
                        // Update existing player
                        console.log(`   Updating existing player: ${p.name}`);
                        const player = this.players.get(p.steamId);
                        console.log(`     Current color: ${player.color}, Host color: ${p.color}`);
                        player.isReady = p.isReady;
                        player.isAlive = p.isAlive;
                        // Update color if provided (ensures consistency)
                        if (p.color) {
                            console.log(`   🎨 Updating color for ${p.name}: ${player.color} → ${p.color}`);
                            player.color = p.color;
                        }
                    }
                });
                console.log('   📊 Final player colors:', Array.from(this.players.values()).map((p) => ({ name: p.name, color: p.color })));
            }
        });

        this.network.on(MessageTypes.LOBBY_PLAYER_LEFT, (msg) => {
            this.removePlayer(msg.data.steamId);
        });

        this.network.on(MessageTypes.LOBBY_GAME_START, (msg) => {
            if (!this.isHost) {
                console.log('📬 Peer received game start from host!');
                this.startMatch(msg.data.sharedSeed, msg.data.config);

                // Note: MATCH_STARTED event will be emitted AFTER countdown completes
                // (see startMatch -> showCountdown callback line ~1065)
            }
        });

        this.network.on(MessageTypes.LOBBY_PLAYER_READY, (msg) => {
            const player = this.players.get(msg.data.steamId);
            if (player) {
                player.isReady = msg.data.isReady;
                console.log(`${player.name} is ${msg.data.isReady ? 'ready' : 'not ready'}`);
            }
        });

        // === HOST MIGRATION ===

        this.network.on(MessageTypes.NET_HEARTBEAT, (msg) => {
            // Pass to migration system
            this.hostMigration.onHeartbeat();
        });

        this.network.on(MessageTypes.GAME_HOST_MIGRATION_CLAIM, (msg) => {
            this.hostMigration.handleClaim(msg);
        });

        this.network.on(MessageTypes.GAME_HOST_MIGRATION_SYNC, (msg) => {
            const newHostId = msg.data?.newHostId;
            if (!this._verifyHostReassignment(msg.from, newHostId)) {
                console.warn(`🛑 Rejecting migration sync from ${msg.from} (claimed new host: ${newHostId})`);
                return;
            }
            console.log(`📦 Received migration sync from new host ${newHostId}`);
            // The successor is verified; adopt it as host and take its snapshot.
            this.network.hostSteamId = newHostId;
            if (msg.data.snapshot) {
                this.syncFromHost(msg.data.snapshot);
            }
        });

        // === PHASE 3: FFA COMBAT & HOST MIGRATION ===

        this.network.on('game:player:died', (msg) => {
            console.log(`💀 ${msg.data.playerName} died`);
        });

        this.network.on('game:player:frag', (msg) => {
            console.log(`🏆 ${msg.data.killerName} fragged ${msg.data.victimName}!`);
        });

        this.network.on(MessageTypes.GAME_MATCH_END, (msg) => {
            const data = msg.data || {};
            const winnerName = data.winnerName || 'Draw';
            console.log(`🎊 MATCH OVER! Winner: ${winnerName}`);

            this.gamePhase = 'finished';
            this.winner = data.winner
                ? (this.players.get(data.winner) || { steamId: data.winner, name: winnerName })
                : { steamId: null, name: winnerName };
            this.lastMatchResults = data;

            this.stopGameLoop();
            this.stopStateSyncLoop();

            if (data.isGameOver) {
                emitMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, {
                    winner: this.winner,
                    winnerName,
                    finalStats: data.finalStats || [],
                    endCondition: data.endCondition,
                    endConditionValue: data.endConditionValue,
                    duration: data.duration,
                    killFeed: data.killFeed || [],
                    isGameOver: true,
                });
            }
        });

        this.network.on('game:garbage:sent', (msg) => {
            console.log(`💥 ${msg.data.fromName} sent ${msg.data.totalLines} lines to ${msg.data.targetCount} players`);
        });

        // Handle attack requests from peers (host routes attacks)
        this.network.on('game:attack:request', (msg) => {
            if (!this.isHost) return; // Only host routes attacks

            const attackerSteamId = msg.from; // from is set by steam-networking
            const { cascadeSummary } = msg.data;

            if (attackerSteamId && cascadeSummary) {
                console.log(`⚔️ Routing attack from peer ${attackerSteamId}`);
                this.attackRouter.routeAttack(attackerSteamId, cascadeSummary);
            }
        });

        this.network.on('game:host:migrated', (msg) => {
            const newHost = msg.data?.newHost;
            if (!this._verifyHostReassignment(msg.from, newHost)) {
                console.warn(`🛑 Rejecting host:migrated from ${msg.from} (claimed new host: ${newHost})`);
                return;
            }
            console.log(`🔄 Host migrated to: ${msg.data.newHostName}`);
            this.network.hostSteamId = newHost;
        });

        this.network.on('game:host:handoff', (msg) => {
            // A handoff request makes the receiver try to become host, so it must
            // only be honored from the current host (a planned handoff). Otherwise
            // any peer could trigger every peer to claim host simultaneously.
            if (msg.from !== this.network?.hostSteamId) {
                console.warn(`🛑 Rejecting host:handoff from non-host ${msg.from}`);
                return;
            }
            console.log(`🔄 Host handoff requested: ${msg.data.reason}`);
            if (!this.isHost) {
                this.hostMigration.becomeHost();
            }
        });

        this.network.on(MessageTypes.GAME_ROUND_RESTART, (msg) => {
            if (this.isHost) return; // Host handles locally via performRoundRestart

            const data = msg.data || {};
            console.log('🔄 Peer received restart command:', data);

            // Use shared method
            this.performRoundRestart(data);
        });
        // PHASE 4.4: Chat messages
        this.network.on('game:chat', (msg) => {
            console.log(`💬 Chat from ${msg.data.playerName}: ${msg.data.message}`);

            const resolved = { ...msg.data };
            if (!resolved.color && this.players) {
                let player = this.players.get(resolved.steamId);
                if (!player) {
                    for (const [id, p] of this.players) {
                        if (String(id) === String(resolved.steamId)) {
                            player = p;
                            break;
                        }
                    }
                }
                if (!player && resolved.playerName) {
                    for (const p of this.players.values()) {
                        if (p.name === resolved.playerName) {
                            player = p;
                            break;
                        }
                    }
                }
                if (player?.color) {
                    resolved.color = player.color;
                }
            }

            // Add to centralized history
            this.chatHistory.push(resolved);
            if (this.chatHistory.length > 100) this.chatHistory.shift();

            // Show in In-Game UI
            if (this.chat) {
                this.chat.addMessage(resolved);
            }

            // Dispatch to UI (Lobby sees this too)
            if (resolved.steamId !== this.localPlayerId) {
                emitMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, {
                    playerName: resolved.playerName,
                    message: resolved.message,
                    steamId: resolved.steamId,
                    timestamp: resolved.timestamp,
                    color: resolved.color,
                });
            }

            // If host, rebroadcast to others
            if (this.isHost) {
                this.broadcastToPeers('game:chat', resolved);
            }
        });

        // Rematch Voting
        this.network.on('game:rematch:vote', (msg) => {
            const voterId = msg.from;
            if (!this.players.has(voterId)) return;

            console.log(`🗳️ Rematch vote from ${this.players.get(voterId).name}`);
            this.rematchVotes.add(voterId);

            // Broadcast vote update
            if (this.isHost) {
                this.broadcastRematchStatus();
                this.checkRematchThreshold();
            }
        });

        this.network.on('game:rematch:status', (msg) => {
            this.rematchVotes = new Set(msg.data.votes);
            this.checkRematchThreshold();
            // Emit event for UI
            emitMultiplayerEvent('rematch_status', {
                votes: msg.data.votes,
                total: this.players.size,
                required: Math.ceil(this.players.size / 2),
            });
        });
    }

    startNewMatch() {
        if (!this.isHost) return;

        console.log('🔄 Host starting new match sequence...');
        const newSeed = Math.floor(Math.random() * 1000000);

        // Reset local state first
        this.rematchVotes.clear(); // Clear votes

        // Broadcast restart
        this.network.broadcastToAll(MessageTypes.GAME_ROUND_RESTART, {
            fullReset: true,
            newSeed,
            prefixText: 'READY',
            countFrom: 0,
            includeZero: false,
        });

        // Trigger local restart logic (simulated by receiving own message, or explicit call?)
        // The network loop usually doesn't loopback broadcastToAll to self unless configured.
        // Let's manually trigger the handler logic or send to self
        // Re-using the logic from the handler is best.

        // Ideally we emit a local message or call a shared method.
        // For now, let's just piggyback on the handler logic refactor or duplicate essential valid reset.
        // Actually, broadcastToAll typically implies "to peers".
        // We should construct the logic to run locally too.

        // Hack: trigger the event handler locally
        const mockMsg = {
            data: {
                fullReset: true, newSeed, prefixText: 'READY', countFrom: 0, includeZero: false,
            },
        };
        // We need to call the logic inside the handler.
        // Refactoring the handler to a method `handleRoundRestart(data)` is cleaner but for now I'll just emit.

        // Better: Make network loopback work or extract function.
        // Let's extract the reset logic to `performRoundRestart(data)`
        this.performRoundRestart(mockMsg.data);
    }

    performRoundRestart(data) {
        const isFullReset = data.fullReset === true;
        const prefixText = data.prefixText || 'ROUND OVER';
        const countFrom = data.countFrom !== undefined ? data.countFrom : 3;
        const includeZero = data.includeZero === true;
        const instantStart = data.instantStart === true;

        // ... (Same reset logic as before) ...
        console.log('🔄 Host performing local restart...');

        // Stop current game
        this.stopGameLoop();
        this.stopStateSyncLoop();

        // Reset trackers
        if (this.fragTracker) {
            this.fragTracker.reset();
        }
        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        // Reset ALL players
        this.players.forEach((player, steamId) => {
            player.isAlive = true; // Revive everyone
            player.garbageQueue.clear();
            player.lastAttackerId = null;

            if (isFullReset) {
                player.frags = 0;
                player.gameState = new GameState();
                player.gameState.level = this.matchConfig.startLevel;
            } else {
                const oldScore = player.gameState.score;
                const oldLines = player.gameState.lines;
                const oldLevel = player.gameState.level;

                player.gameState = new GameState();
                player.gameState.score = oldScore;
                player.gameState.lines = oldLines;
                player.gameState.level = oldLevel;
            }
        });

        this.winner = null;
        this.gamePhase = 'waiting';

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
            players: Array.from(this.players.keys()),
        });

        const startRound = () => {
            this.gamePhase = 'playing';
            this.players.forEach((player) => {
                player.gameState.randomGenerator = this.createSeededRNG(data.newSeed);
                fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);
                spawnPiece(player.gameState, null, null);
            });
            this.startGameLoop();
            this.startStateSyncLoop(); // Host needs to start sync loop!
        };

        if (instantStart) {
            this.hideCountdownOverlay();
            startRound();
            return;
        }

        this.showCountdown(startRound, prefixText, countFrom, includeZero);
    }

    sendRematchVote() {
        if (this.isHost) {
            this.rematchVotes.add(this.localPlayerId);
            this.broadcastRematchStatus();
            this.checkRematchThreshold();
        } else {
            this.network.sendP2PMessage(this.network.hostSteamId, 'game:rematch:vote', {});
        }
    }

    broadcastRematchStatus() {
        if (!this.isHost) return;
        this.broadcastToPeers('game:rematch:status', {
            votes: Array.from(this.rematchVotes),
        });
        // Also update local UI
        emitMultiplayerEvent('rematch_status', {
            votes: Array.from(this.rematchVotes),
            total: this.players.size,
            required: Math.ceil(this.players.size / 2),
        });
    }

    checkRematchThreshold() {
        if (!this.isHost) return;
        const required = Math.ceil(this.players.size / 2) + 1; // Majority + 1 or just majority? Let's say majority
        const total = this.players.size;
        const votes = this.rematchVotes.size;

        // If majority voted
        if (votes >= Math.ceil(total / 2)) {
            console.log('✅ Rematch threshold reached! Restarting...');
            setTimeout(() => this.startNewMatch(), 1000);
        }
    }

    broadcastToPeers(type, data) {
        if (!this.isHost) return;
        this.players.forEach((p, steamId) => {
            if (steamId !== this.localPlayerId && !p.isDisconnected) {
                this.network.sendP2PMessage(steamId, type, data);
            }
        });
    }

    _applyInputToPlayer(steamId, inputType, data, physicsCallbacks) {
        const player = this.players.get(steamId);
        if (!player || !player.isAlive) {
            return false;
        }

        const { gameState } = player;

        // Buffer input if processing physics (prevents dropped inputs during animations)
        // The queue is consumed in game.js spawnPiece()
        if (gameState.isProcessingPhysics || !gameState.currentPiece) {
            if (inputType === 'move' || inputType === 'rotate') {
                const queued = {
                    type: inputType,
                    dir: data.direction,
                };
                if (Array.isArray(gameState.inputQueue)) {
                    if (gameState.inputQueue.length < 4) {
                        gameState.inputQueue.push(queued);
                    }
                } else if (gameState.inputQueue) {
                    gameState.inputQueue = [gameState.inputQueue, queued].slice(0, 4);
                } else {
                    gameState.inputQueue = queued;
                }
            }
            return false;
        }

        const callbacks = physicsCallbacks || this.buildPhysicsCallbacks(steamId);

        switch (inputType) {
        case 'move':
            move(gameState, data.direction, null, null);
            break;
        case 'rotate':
            rotate(gameState, data.direction, null, null);
            break;
        case 'drop':
            if (data.type === 'soft') {
                softDrop(gameState, null, callbacks);
            } else if (data.type === 'hard') {
                // Update callbacks to proxy the hard drop effect through to the client
                const dropCallbacks = {
                    ...callbacks,
                    onHardDrop: (dropData) => {
                        if (callbacks.onHardDrop) callbacks.onHardDrop(dropData);
                        // Provide a hook for local UI integration in FFA multiplayer
                        emitMultiplayerEvent('hard_drop_effect', { steamId, dropData });
                    },
                };
                hardDrop(gameState, null, dropCallbacks);
            }
            break;
        default:
            return false;
        }

        return true;
    }

    /**
    * Process player input (HOST ONLY)
    */
    processPlayerInput(steamId, inputType, data, timestamp) {
        if (!this.isHost) {
            console.warn('⚠️ Only host can process inputs');
            return;
        }

        const player = this.players.get(steamId);
        if (!player || !player.isAlive) {
            return; // Player doesn't exist or is dead
        }

        // Validate input (anti-cheat)
        const validation = this.inputValidator.validateInput(steamId, inputType, data, timestamp);
        if (!validation.valid) {
            console.warn(`⚠️ Invalid input from ${player.name}: ${validation.reason}`);
            // TODO: Could kick player for repeated violations
            return;
        }

        // Track input for pattern detection
        this.inputValidator.trackInput(steamId, inputType, data);

        // JITTER BUFFER INTEGRATION
        // When the jitter buffer is enabled, buffer the input and let
        // processBufferedInputs() apply it on its scheduled tick. We must NOT
        // also apply it here: applying in both places double-applies every input
        // (a single "move left" would travel two cells, a rotate would
        // double-rotate), corrupting host-authoritative state and desyncing
        // client prediction.
        // NOTE: temporary correctness fix. The structural fix is tick-boundary
        // input application in the fixed-tick sim refactor (see
        // docs/ARCHITECTURAL_REMEDIATION_PLAN.md Phase 5).
        if (this.useJitterBuffer && this.inputJitterBuffer) {
            // Label the input with the jitter buffer's OWN per-frame clock, not
            // hostTick / the client tick. The buffer's processCursor advances once
            // per loop frame (advanceTick in processBufferedInputs), but hostTick
            // only increments inside broadcastGameState (<=30Hz, gated on a
            // significant state change) and a peer's hostTick never advances at
            // all (peers don't broadcast) — so labeling with those clocks lets
            // processCursor overtake the labels within a few frames and every
            // input is then rejected as stale (tick < processCursor). Using the
            // buffer's currentTick guarantees each input is accepted and applied
            // exactly once, bufferDepth frames later. (Discarding data.tick also
            // drops the broken adaptive-offset signal, which was measured against
            // the same stale peer clock.)
            const inputTick = this.inputJitterBuffer.currentTick;

            this.inputJitterBuffer.addInput(steamId, inputTick, {
                type: inputType,
                data,
                timestamp,
            });
            return; // Buffered — applied later by processBufferedInputs().
        }

        // No jitter buffer: apply immediately.
        // - Local player (host): full callbacks including garbage routing
        // - Remote player (peer): no garbage routing (peer sends their own game:attack:request)
        const isRemotePlayer = steamId !== this.localPlayerId;
        const callbacks = isRemotePlayer
            ? this.buildRemotePlayerCallbacks(steamId)
            : this.buildPhysicsCallbacks(steamId);

        const applied = this._applyInputToPlayer(
            steamId,
            inputType,
            data,
            callbacks,
        );

        if (!applied) {
            return;
        }

        // Update sequence number if provided
        if (data.seq && data.seq > (player.lastInputSeq || 0)) {
            player.lastInputSeq = data.seq;
        }

        // CRITICAL: Force immediate visual update after input
        // Don't wait for next state sync (30Hz) - render immediately (60Hz)
        this.renderAllPlayers();
    }

    /**
     * Send local player input to host (batched)
     */
    sendInput(inputType, data) {
        if (this.gamePhase !== 'playing') {
            return; // Can't send inputs if game isn't playing
        }

        const timestamp = Date.now();

        if (this.isHost) {
            // Host processes its own input immediately
            this.processPlayerInput(this.localPlayerId, inputType, data, timestamp);
        } else {
            const seq = ++this.inputSequence;
            // Peer queues input for batch sending
            const queuedInput = {
                type: inputType,
                data,
                tick: this.hostTick, // Use estimated host tick
                seq,
                timestamp,
            };
            this.pendingInputs.push(queuedInput);

            if (!this.inputHistory) this.inputHistory = [];
            this.inputHistory.push(queuedInput);
            if (this.inputHistory.length > 120) {
                this.inputHistory.splice(0, this.inputHistory.length - 120);
            }

            // Apply prediction locally immediately
            this._applyLocalPrediction(inputType, data);
        }
    }

    /**
     * Flush pending inputs to host (called per tick/frame)
     */
    flushInputBatch() {
        if (this.isHost || this.pendingInputs.length === 0) return;

        // Send all pending inputs in one batch message
        this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.GAME_INPUT_BATCH, {
            inputs: this.pendingInputs,
            lastAck: this.lastAckedTick,
            tick: this.hostTick,
        });

        // Clear queue (assuming reliability, or we implement retry queue later)
        this.pendingInputs = [];
    }

    /**
     * Process a batch of inputs from a peer (HOST ONLY)
     */
    processInputBatch(steamId, batchData, timestamp) {
        if (!this.isHost) return;

        const { inputs } = batchData;
        if (!Array.isArray(inputs)) return;

        // Validate batch size (prevent massive spam)
        if (inputs.length > 20) {
            console.warn(`⚠️ Batch too large from ${steamId}: ${inputs.length}`);
            return;
        }

        inputs.forEach((input) => {
            // Validate input type
            if (!['move', 'rotate', 'drop'].includes(input.type)) return;

            // Process individual input
            this.processPlayerInput(
                steamId,
                input.type,
                {
                    ...(input.data || {}),
                    seq: input.seq,
                    tick: input.tick,
                },
                input.timestamp || timestamp,
            );
        });
    }

    _applyLocalPrediction(inputType, data) {
        if (this.isHost) {
            return;
        }

        const applied = this._applyInputToPlayer(
            this.localPlayerId,
            inputType,
            data,
            this.buildLocalPredictionCallbacks(this.localPlayerId),
        );

        if (applied) {
            this.renderAllPlayers();
        }
    }

    /**
    * Insert pending garbage for a player (after piece spawns)
    * HOST ONLY
    */
    insertPendingGarbage(steamId) {
        if (!this.isHost) return;

        const player = this.players.get(steamId);
        if (!player || !player.isAlive) return;

        const { garbageQueue } = player;

        // Apply Quadra blind attacks FIRST. This both triggers the blackout
        // and removes leading blind/full_blind entries that would otherwise
        // block dequeueLineBurst() (which bails on a non-'line' head).
        const blindBurst = garbageQueue.takePendingBlindBurst?.() || [];
        blindBurst.forEach((entry) => {
            if (entry.type === 'full_blind') {
                applyFullBlindEffect(player.gameState, entry.duration);
            } else {
                applyBlindEffect(player.gameState, entry.duration);
            }
        });

        const totalLines = garbageQueue.getTotalLines();

        if (totalLines === 0) return;

        this._logGarbage(`💥 Inserting ${totalLines} garbage lines for ${player.name}`);
        this._logGarbage(`💥 Queue has ${garbageQueue.entries.length} total entries before dequeue`);

        // Take lines from queue
        const burst = garbageQueue.dequeueLineBurst();

        if (!burst || burst.length === 0) return;

        this._logGarbage(`💥 Dequeued ${burst.length} entries from garbage queue`);

        // Log all entries in burst to debug attackerId
        burst.forEach((entry, idx) => {
            this._logGarbage(`  Entry ${idx}: type=${entry.type}, attackerId=${entry.attackerId || 'MISSING'}, color=${entry.color}`);
        });

        // Track who sent the garbage for kill attribution
        // Use the last garbage entry's attacker (most recent attacker gets the frag)
        const attackerId = burst.length > 0
            ? (burst[burst.length - 1].attackerId || burst.find((entry) => entry.attackerId)?.attackerId || null)
            : null;
        const attackerName = burst.length > 0
            ? (burst[burst.length - 1].attackerName || burst.find((entry) => entry.attackerName)?.attackerName || null)
            : null;

        if (attackerId) {
            const attacker = this.players.get(attackerId);
            this._logGarbage(`💥 ✅ Garbage from ${attacker?.name || attackerId} is being inserted into ${player.name}'s board`);
            // Track this attacker as the last one who sent garbage to this player
            player.lastAttackerId = attackerId;
        } else {
            this._logGarbage('💥 ❌ NO ATTACKER FOUND in garbage burst! This will be a self-kill.');
        }

        const killerId = attackerId || null;
        const killerName = attackerName || (killerId ? this.players.get(killerId)?.name : null);
        const isSelfKill = !killerId || killerId === steamId;

        const result = insertGarbageEntries(player.gameState.lockedPieces, burst, {
            boardGrid: player.gameState.boardGrid,
            debug: this.debugGarbage,
        });

        if (!result || result.topOut) {
            this._logGarbage(`💀 ${player.name} topped out from garbage insertion!`);
            player.isAlive = false;
            player.gameState.isGameOver = true;

            if (attackerId) {
                const attacker = this.players.get(attackerId);
                this._logGarbage(`🏆 Kill attributed to: ${attacker?.name || attackerId}`);
            } else {
                this._logGarbage('💀 Self-kill (no attacker found in garbage entries)');
            }

            this.fragTracker.recordDeath(steamId, attackerId, attackerName);

            emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
                steamId,
                playerName: player.name,
                killer: killerId,
                killerId,
                killerName,
                isSelfKill,
                isLocal: steamId === this.localPlayerId,
            });
            return;
        }

        if (player.gameState.boardGrid) {
            rebuildBoardGridFromPieces(player.gameState.lockedPieces, player.gameState.boardGrid);
            player.gameState.boardCache = null;
            player.gameState.boardCacheDirty = true;
        }
        markBoardDirty(player.gameState);

        // PHASE 3.2: Dispatch garbage insertion event for visual effects
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, {
            steamId,
            playerName: player.name,
            linesInserted: burst.length,
            isLocal: steamId === this.localPlayerId,
        });

        // Check if player topped out
        if (this.checkTopOut(player.gameState)) {
            this._logGarbage(`💀 ${player.name} topped out!`);
            player.isAlive = false;
            player.gameState.isGameOver = true;

            // Award frag to the player who sent the garbage
            if (attackerId) {
                const attacker = this.players.get(attackerId);
                this._logGarbage(`🏆 Kill attributed to: ${attacker?.name || attackerId}`);
            } else {
                this._logGarbage('💀 Self-kill (no attacker found in garbage entries)');
            }
            this.fragTracker.recordDeath(steamId, attackerId, attackerName);

            // Dispatch top-out event
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
                steamId,
                playerName: player.name,
                killer: killerId,
                killerId,
                killerName,
                isSelfKill,
                isLocal: steamId === this.localPlayerId,
            });
        }
    }

    /**
    * PHASE 3.5: Cancel garbage with outgoing attacks (garbage counter)
    * Modern competitive mechanic where outgoing lines cancel incoming garbage first.
    * Only the remainder is sent to opponents (Quadra/TETR.IO style).
    * @param {string} attackerSteamId - The player clearing lines
    * @param {number} outgoingLines - Lines the player would send
    * @returns {number} Lines cancelled (to be subtracted from outgoing attack)
    */
    applyGarbageCounter(attackerSteamId, outgoingLines) {
        if (!this.isHost) return 0;

        // Check if garbage cancellation is enabled (default: full/enabled)
        if (this.matchConfig.garbageCancellation === 'disabled') {
            return 0; // Classic mode - no cancellation
        }

        const attacker = this.players.get(attackerSteamId);
        if (!attacker || !attacker.isAlive) return 0;

        const incomingLines = attacker.garbageQueue.getTotalLines();

        if (incomingLines === 0) {
            return 0; // No incoming garbage to counter
        }

        // Calculate how many lines can be countered (1:1 ratio - Quadra/TETR.IO style)
        const canceledLines = Math.min(incomingLines, outgoingLines);

        if (canceledLines > 0) {
            // Remove canceled lines from queue
            let removed = 0;

            while (removed < canceledLines && attacker.garbageQueue.entries.length > 0) {
                const entry = attacker.garbageQueue.entries[0];
                if (entry.type === 'line') {
                    attacker.garbageQueue.entries.shift();
                    removed++;
                } else {
                    break; // Don't remove non-line entries
                }
            }

            this._logGarbage(`🛡️ ${attacker.name} countered ${removed} garbage lines (${incomingLines} → ${attacker.garbageQueue.getTotalLines()})`);

            // Dispatch counter event for visual/audio feedback
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_COUNTERED, {
                steamId: attackerSteamId,
                playerName: attacker.name,
                linesCanceled: removed,
                remainingGarbage: attacker.garbageQueue.getTotalLines(),
                isLocal: attackerSteamId === this.localPlayerId,
            });

            return removed;
        }

        return 0;
    }

    /**
    * Check if game board has topped out
    */
    checkTopOut(gameState) {
        const HIDDEN_ROWS = 4;
        // Check if any locked pieces are at or above the spawn line (top of visible area)
        // Since pieces now spawn at y=HIDDEN_ROWS, having locked pieces there means no room to spawn
        return gameState.lockedPieces.some((piece) => piece.y <= HIDDEN_ROWS);
    }

    /**
    * Start the match (host initiates, peers receive)
    */
    startMatch(seed = null, config = null) {
        if (this.isHost && !seed) {
            // Host generates seed
            this.sharedSeed = Math.floor(Math.random() * 1000000);

            // Apply config if provided
            if (config) {
                this.matchConfig = { ...this.matchConfig, ...config };
            }

            // Initialize all players with shared seed
            this.players.forEach((player) => {
                this.initializePlayerForMatch(player, this.sharedSeed);
            });
            this.attackRouter.resetHotPotato();

            const session = this.network.refreshMatchSession();
            this.network.broadcastToAll(MessageTypes.NET_WELCOME, {
                protocolVersion: session.protocolVersion,
                featureFlags: [],
                matchId: session.matchId,
                matchNonce: session.matchNonce,
                hostSteamId: session.hostSteamId,
                accepted: true,
                reason: 'match_start',
            });

            // Broadcast game start to all peers
            this.network.broadcastToAll(MessageTypes.LOBBY_GAME_START, {
                sharedSeed: this.sharedSeed,
                config: this.matchConfig,
            });

            // Start state sync loop (30Hz)
            this.startStateSyncLoop();
            this.startHeartbeatLoop();
        } else if (!this.isHost && seed) {
            // Peer receives seed and config from host
            this.sharedSeed = seed;
            if (config) {
                this.matchConfig = { ...this.matchConfig, ...config };
            }

            // Initialize local player
            const localPlayer = this.players.get(this.localPlayerId);
            this.initializePlayerForMatch(localPlayer, seed);
            this.attackRouter.resetHotPotato();
        }

        console.log('🎮 Match starting...');
        console.log(`   Seed: ${this.sharedSeed}`);
        console.log(`   End Condition: ${this.matchConfig.endCondition} = ${this.matchConfig.endConditionValue}`);
        console.log(`   Players: ${this.players.size}`);

        // Emit MATCH_PREPARING to set up UI BEFORE countdown
        // This allows the game layout to be visible behind the countdown overlay
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_PREPARING, { gameState: this });

        // Show "GAME START" countdown before starting
        this.showCountdown(() => {
            this.gamePhase = 'playing';
            this.matchStartTime = Date.now();

            // Start game loop for all players
            this.startGameLoop();

            console.log('🎮 Match started!');

            // Dispatch match started event for UI (both host and peer)
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_STARTED, { gameState: this });
        });
    }

    /**
    * Initialize a player for the match with deterministic RNG
    */
    initializePlayerForMatch(player, seed) {
        // Reset game state
        player.gameState.reset();
        player.garbageQueue = new GarbageQueue();
        player.isAlive = true;
        // DO NOT reset frags here - they persist across rounds until full game reset

        // Set deterministic RNG (same seed = same pieces for ALL players)
        // CRITICAL: All players must use the EXACT same seed for fair play
        player.gameState.randomGenerator = this.createSeededRNG(seed);

        // Fill initial bag with deterministic pieces
        fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);

        // Spawn first piece (no game over callback needed at start)
        spawnPiece(player.gameState, null, null);

        console.log(`✅ Player ${player.name} initialized with seed ${seed}`);
    }

    /**
    * Create seeded random number generator
    * This ensures all players get the same piece sequence!
    */
    createSeededRNG(seed) {
        let state = seed % 233280;
        if (state < 0) state += 233280;
        console.log(`🎲 [RNG] Created generator with seed=${seed} (state=${state})`);

        return function () {
            // Linear congruential generator (LCG)
            state = (state * 9301 + 49297) % 233280;
            return state / 233280;
        };
    }

    /**
    * Start broadcasting game state at 30Hz (host only)
    */
    startStateSyncLoop() {
        if (!this.isHost) return;

        // Clear any existing interval
        if (this.stateSyncInterval) {
            clearInterval(this.stateSyncInterval);
        }

        // Low-frequency fallback; normal snapshots are RAF-aligned in onUpdate.

        this.stateSyncInterval = setInterval(() => {
            if (this.gamePhase === 'playing') {
                const now = Date.now();

                if ((now - this._lastStateBroadcastTime) > 500) {
                    this.broadcastGameState();
                    this._lastStateBroadcastTime = now;
                }

                this._updateSyncpoint();
                this._processPendingResyncs();
            }
        }, 500);

        console.log(`📡 State sync started (${this.STATE_SYNC_RATE}Hz with delta optimization)`);
    }

    /**
    * Stop state sync loop
    */
    stopStateSyncLoop() {
        if (this.stateSyncInterval) {
            clearInterval(this.stateSyncInterval);
            this.stateSyncInterval = null;
            console.log('📡 State sync stopped');
        }

        this.stopHeartbeatLoop();
    }

    /**
     * Start heartbeat loop (Host only)
     * Sends keepalive every 1 second
     */
    startHeartbeatLoop() {
        if (!this.isHost) return;
        this.stopHeartbeatLoop();

        this.heartbeatInterval = setInterval(() => {
            this.network.broadcastToAll(MessageTypes.NET_HEARTBEAT, {
                timestamp: Date.now(),
            });
        }, 1000);

        console.log('💓 Heartbeat loop started');
    }

    stopHeartbeatLoop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    _computeSyncpoint() {
        if (this.gamePhase !== 'playing') return 'download';
        const busy = Array.from(this.players.values()).some((player) => player.gameState?.isProcessingPhysics);
        return busy ? 'busy' : 'idle';
    }

    _updateSyncpoint() {
        const next = this._computeSyncpoint();
        if (next !== this.syncpoint) {
            this.syncpoint = next;
            this.network.broadcastToAll(MessageTypes.GAME_SYNCPOINT, {
                syncpoint: this.syncpoint,
                tick: this.hostTick,
                reason: 'state_change',
            });
        }
    }

    _processPendingResyncs() {
        if (!this.isHost || this.pendingResyncs.length === 0) return;
        if (this.syncpoint === 'busy') return;
        const steamId = this.pendingResyncs.shift();
        if (steamId) {
            this._sendResyncToPeer(steamId);
        }
    }

    buildStateSnapshot() {
        const players = Array.from(this.players.entries()).map(([steamId, player]) => ({
            steamId,
            name: player.name,
            color: player.color,
            score: player.gameState.score,
            lines: player.gameState.lines,
            level: player.gameState.level,
            frags: player.frags,
            isAlive: player.isAlive,
            garbagePending: player.garbageQueue.getTotalLines(),

            grid: player.gameState.boardGrid,
            currentPiece: player.gameState.currentPiece,
            nextPieces: player.gameState.nextPieces,
            dropCounter: player.gameState.dropCounter,
            dropInterval: player.gameState.dropInterval,

            garbageEntries: player.garbageQueue.entries.map((entry) => ({
                type: entry.type,
                attackerId: entry.attackerId,
                color: entry.color,
                holeMask: entry.holeMask,
                variant: entry.variant,
            })),

            lockedPieces: player.gameState.lockedPieces.map((piece) => ({
                x: piece.x,
                y: piece.y,
                shape: piece.shape,
                color: piece.color,
                shapeKey: piece.shapeKey,
            })),

            blindTimers: player.gameState.blindTimers ? {
                field: player.gameState.blindTimers.field,
                fieldMax: player.gameState.blindTimers.fieldMax,
                pending: player.gameState.blindTimers.pending,
                pendingMax: player.gameState.blindTimers.pendingMax,
            } : null,

            lastInputSeq: player.lastInputSeq,
        }));

        // Phase 4: Calculate state digest for desync detection
        const stateDigest = this._calculateStateDigest(players);

        return {
            players,
            gamePhase: this.gamePhase,
            hotPotatoState: this.hotPotatoState ? { ...this.hotPotatoState } : null,
            winner: this.winner ? {
                steamId: this.winner.steamId,
                name: this.winner.name,
            } : null,
            timestamp: Date.now(),
            tick: this.hostTick,
            // Phase 4: State digest for desync detection
            digest: stateDigest,
        };
    }

    /**
     * Phase 4: Calculate a digest of the critical game state for desync detection
     * Uses a simple hash of scores, frags, and alive status - fast to compute
     */
    _calculateStateDigest(players) {
        // Build a string of critical state values
        const stateString = players
            .sort((a, b) => a.steamId.localeCompare(b.steamId)) // Deterministic order
            .map((p) => `${p.steamId}:${p.score}:${p.lines}:${p.frags}:${p.isAlive ? 1 : 0}:${p.garbagePending}`)
            .join('|');

        // Simple hash (DJB2 algorithm)
        let hash = 5381;
        for (let i = 0; i < stateString.length; i++) {
            hash = ((hash << 5) + hash) + stateString.charCodeAt(i);
            hash &= hash; // Convert to 32-bit integer
        }
        return (hash >>> 0).toString(16); // Unsigned hex string
    }

    getFullState() {
        return this.buildStateSnapshot();
    }

    /**
    * Check if any player state has changed significantly
    * Used to avoid broadcasting when nothing has changed
    */
    hasSignificantStateChanges() {
        if (!this.isHost) return false;

        for (const [steamId, player] of this.players) {
            const lastState = this.lastBroadcastState.get(steamId);

            if (!lastState) {
                return true; // No previous state, so broadcast
            }

            const currentState = player.gameState;

            // Check for significant changes
            const hasChanges = (
                lastState.score !== currentState.score
                || lastState.lines !== currentState.lines
                || lastState.level !== currentState.level
                || lastState.currentPieceY !== currentState.currentPiece?.y
                || lastState.currentPieceX !== currentState.currentPiece?.x
                || lastState.dropCounter !== currentState.dropCounter
                || lastState.garbagePending !== player.garbageQueue.getTotalLines()
                || player.frags !== lastState.frags
                || player.isAlive !== lastState.isAlive
                || lastState.hotPotatoGeneration !== (this.hotPotatoState?.generation || 0)
            );

            if (hasChanges) {
                return true;
            }
        }

        return false; // No changes detected
    }

    maybeBroadcastPostPhysics(delta) {
        if (!this.isHost || this.gamePhase !== 'playing') return;

        this._stateBroadcastAccumulator += delta;
        const minBroadcastInterval = 1000 / this.STATE_SYNC_RATE;
        if (this._stateBroadcastAccumulator < minBroadcastInterval) {
            return;
        }

        this._stateBroadcastAccumulator %= minBroadcastInterval;
        if (this.hasSignificantStateChanges()) {
            this.broadcastGameState();
            this._lastStateBroadcastTime = Date.now();
        }

        this._updateSyncpoint();
        this._processPendingResyncs();
    }

    /**
    * Broadcast current game state to all peers (host only)
    * Enhanced to include full board state for accurate rendering
    */
    broadcastGameState() {
        if (!this.isHost) return;
        this.hostTick += 1;
        this._lastStateBroadcastTime = Date.now();

        // Update last broadcast state snapshots
        for (const [steamId, player] of this.players) {
            this.lastBroadcastState.set(steamId, {
                score: player.gameState.score,
                lines: player.gameState.lines,
                level: player.gameState.level,
                currentPieceY: player.gameState.currentPiece?.y,
                currentPieceX: player.gameState.currentPiece?.x,
                dropCounter: player.gameState.dropCounter,
                garbagePending: player.garbageQueue.getTotalLines(),
                frags: player.frags,
                isAlive: player.isAlive,
                hotPotatoGeneration: this.hotPotatoState?.generation || 0,
            });
        }

        const state = this.buildStateSnapshot();
        this.network.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, state);
    }

    /**
    * Sync state from host (peer only)
    * CRITICAL: Must trigger visual updates
    * Phase 4: Includes desync detection
    */
    syncFromHost(state) {
        if (this.isHost) return;

        // Phase 4: Desync detection
        if (state.digest && this._lastHostDigest) {
            // Compare current local digest to what we expect
            const expectedDigest = this._lastHostDigest;
            const localDigest = this._calculateStateDigest(
                Array.from(this.players.entries()).map(([steamId, player]) => ({
                    steamId,
                    score: player.gameState.score,
                    lines: player.gameState.lines,
                    frags: player.frags,
                    isAlive: player.isAlive,
                    garbagePending: player.garbageQueue?.getTotalLines() || 0,
                })),
            );

            // Check for desync - if local state diverged significantly
            if (localDigest !== expectedDigest && this._desyncCheckEnabled) {
                this._desyncCount = (this._desyncCount || 0) + 1;

                // Only trigger resync after multiple consecutive desyncs (avoid false positives)
                if (this._desyncCount >= 5) {
                    console.warn(`⚠️ Desync detected: local=${localDigest}, expected=${expectedDigest}`);
                    this._requestResync();
                    this._desyncCount = 0;
                }
            } else {
                this._desyncCount = 0; // Reset on successful sync
            }
        }

        // Store host digest for next comparison
        this._lastHostDigest = state.digest;

        this._applySnapshotState(state, { forceLocal: false, reconcileLocal: true });
        this._reconcileLocalPlayer();
    }

    /**
     * Phase 5: Replay pending inputs on top of authoritative state
     */
    _reconcileLocalPlayer() {
        if (this.isHost) return;
        const player = this.players.get(this.localPlayerId);
        if (!player || !player.gameState) return;

        // Find last acknowledged sequence from server state
        // (This was applied in _applySnapshotState)
        const serverLastSeq = player.lastInputSeq || 0;

        // Remove acknowledged inputs from history
        // We need a separate history queue for reconciliation, separate from pendingInputs (batching)
        // Let's assume we add this.inputHistory locally
        if (!this.inputHistory) this.inputHistory = [];

        // Remove acknowledged inputs
        this.inputHistory = this.inputHistory.filter((input) => input.seq > serverLastSeq);

        // Replay remaining inputs
        if (this.inputHistory.length > 0) {
            // Mute sounds/events during replay
            const callbacks = this.buildPhysicsCallbacks(this.localPlayerId);
            const silentCallbacks = {
                ...callbacks,
                triggerFlash: () => { }, // No visual flash during replay
                onLineClearImpact: () => { }, // No impact events during replay
                onGarbageReady: () => { }, // No outgoing garbage checks during replay (server handles authoritative garbage)
            };

            // Replay inputs
            this.inputHistory.forEach((input) => {
                this._applyInputToPlayer(
                    this.localPlayerId,
                    input.type,
                    input.data,
                    silentCallbacks,
                );
            });
        }
    }

    /**
     * Phase 4: Request resync from host when desync detected
     */
    _requestResync() {
        if (this.isHost) return;

        console.log('🔄 Requesting resync due to detected desync...');
        this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.GAME_STATE_RESYNC_ACK, {
            requestResync: true,
            reason: 'desync_detected',
        });
    }

    /**
     * Phase 4: Enable/disable desync detection
     */
    setDesyncDetection(enabled) {
        this._desyncCheckEnabled = enabled;
        this._desyncCount = 0;
    }

    _applySnapshotState(state, { forceLocal, reconcileLocal = false }) {
        // Update all player states from host
        state.players.forEach((playerData) => {
            const player = this.players.get(playerData.steamId);
            if (player) {
                const isLocalPlayer = playerData.steamId === this.localPlayerId;

                if (playerData.color) {
                    player.color = playerData.color;
                }

                // Update stats for all players (including local)
                player.gameState.score = playerData.score;
                player.gameState.lines = playerData.lines;
                player.gameState.level = playerData.level;
                player.frags = playerData.frags;
                player.isAlive = playerData.isAlive;
                player.gameState.isGameOver = !playerData.isAlive;

                // Sync sequence number
                if (playerData.lastInputSeq) {
                    player.lastInputSeq = playerData.lastInputSeq;
                }

                // Normal peer snapshots update opponents only. Reconciliation
                // snapshots apply the authoritative local board first, then
                // replay unacknowledged local inputs in _reconcileLocalPlayer().
                const shouldApplyBoardState = forceLocal || !isLocalPlayer || (reconcileLocal && isLocalPlayer);
                if (shouldApplyBoardState) {
                    // Update full board state for opponent rendering
                    if (playerData.grid) {
                        player.gameState.boardGrid = playerData.grid;
                        player.gameState.grid = playerData.grid;
                    }
                    player.gameState.currentPiece = playerData.currentPiece ? {
                        ...playerData.currentPiece,
                    } : null;
                    player.gameState.lockedPieces = playerData.lockedPieces || [];
                    player.gameState.boardCache = null;
                    player.gameState.boardCacheDirty = true;
                }

                if (shouldApplyBoardState) {
                    player.gameState.dropCounter = playerData.dropCounter || 0;
                    player.gameState.dropInterval = playerData.dropInterval || 1000;
                    player.gameState.nextPieces = playerData.nextPieces ? [...playerData.nextPieces] : [];
                }

                // Reconstruct garbage queue from network data for meter display
                if (playerData.garbageEntries && player.garbageQueue) {
                    player.garbageQueue.entries = playerData.garbageEntries.map((e) => ({
                        type: e.type,
                        attackerId: e.attackerId,
                        color: e.color,
                        holeMask: e.holeMask,
                        variant: e.variant,
                    }));
                }

                // Sync blind timers
                if (playerData.blindTimers) {
                    player.gameState.blindTimers = {
                        field: playerData.blindTimers.field || 0,
                        fieldMax: playerData.blindTimers.fieldMax || 0,
                        pending: playerData.blindTimers.pending || 0,
                        pendingMax: playerData.blindTimers.pendingMax || 0,
                    };
                } else if (!player.gameState.blindTimers) {
                    player.gameState.blindTimers = createBlindTimers();
                }
            }
        });

        this.gamePhase = state.gamePhase;
        if (state.hotPotatoState !== undefined) {
            this.hotPotatoState = state.hotPotatoState ? { ...state.hotPotatoState } : null;
        }
        this.winner = state.winner;

        // CRITICAL: Trigger rendering after state update
        // Note: The render loop also calls this, but we call it here too
        // to ensure immediate visual update when state arrives
        this.renderAllPlayers();
    }

    queueResync(steamId) {
        if (!this.isHost) return;
        if (!steamId || steamId === this.localPlayerId) return;
        if (this.gamePhase !== 'playing' || this.syncpoint !== 'busy') {
            this._sendResyncToPeer(steamId);
            return;
        }
        if (!this.pendingResyncs.includes(steamId)) {
            this.pendingResyncs.push(steamId);
        }
    }

    _buildResyncPayload() {
        const snapshotBytes = new Uint8Array(getBinaryEncoder().encodeSnapshot(this.buildStateSnapshot()));

        return {
            encoding: 'binary-v1',
            header: {
                matchConfig: this.matchConfig,
                sharedSeed: this.sharedSeed,
                matchStartTime: this.matchStartTime,
            },
            snapshot: encodeBase64(snapshotBytes),
        };
    }

    _sendResyncToPeer(steamId) {
        if (!this.isHost) return;

        const payload = this._buildResyncPayload();
        const bytes = encodeUtf8(JSON.stringify(payload));
        const chunkCount = Math.ceil(bytes.length / this.resyncChunkSize);
        const resyncId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

        const chunks = [];
        for (let i = 0; i < chunkCount; i += 1) {
            const start = i * this.resyncChunkSize;
            const end = Math.min(bytes.length, start + this.resyncChunkSize);
            const slice = bytes.slice(start, end);
            chunks.push({
                resyncId,
                chunkIndex: i,
                chunkCount,
                byteOffset: start,
                crc32: crc32(slice),
                data: encodeBase64(slice),
            });
        }

        const transfer = {
            resyncId,
            steamId,
            chunks,
            inFlight: new Set(),
            retries: new Map(),
            lastSentAt: new Map(),
            cursor: 0,
            timer: null,
        };

        this.resyncTransfers.set(resyncId, transfer);
        this._sendResyncWindow(transfer);
        transfer.timer = setInterval(() => this._tickResyncTransfer(transfer), 50);
    }

    _sendResyncWindow(transfer) {
        while (transfer.inFlight.size < this.resyncWindow && transfer.cursor < transfer.chunks.length) {
            const chunk = transfer.chunks[transfer.cursor];
            this._sendResyncChunk(transfer, chunk);
            transfer.cursor += 1;
        }
    }

    _sendResyncChunk(transfer, chunk) {
        this.network.sendP2PMessage(transfer.steamId, MessageTypes.GAME_STATE_RESYNC, chunk);
        transfer.inFlight.add(chunk.chunkIndex);
        transfer.lastSentAt.set(chunk.chunkIndex, Date.now());
        const retryCount = transfer.retries.get(chunk.chunkIndex) || 0;
        transfer.retries.set(chunk.chunkIndex, retryCount + 1);
    }

    _tickResyncTransfer(transfer) {
        const now = Date.now();
        let abort = false;
        transfer.inFlight.forEach((chunkIndex) => {
            const lastSent = transfer.lastSentAt.get(chunkIndex) || 0;
            if (now - lastSent < this.resyncTimeoutMs) return;
            const retryCount = transfer.retries.get(chunkIndex) || 0;
            if (retryCount >= this.resyncMaxRetries) {
                abort = true;
                return;
            }
            const chunk = transfer.chunks[chunkIndex];
            if (chunk) {
                this._sendResyncChunk(transfer, chunk);
            }
        });

        if (abort) {
            clearInterval(transfer.timer);
            transfer.timer = null;
            this.resyncTransfers.delete(transfer.resyncId);
            return;
        }

        if (transfer.inFlight.size === 0 && transfer.cursor >= transfer.chunks.length) {
            clearInterval(transfer.timer);
            transfer.timer = null;
            this.resyncTransfers.delete(transfer.resyncId);
        }
    }

    _handleResyncAck(msg) {
        if (msg.data?.requestResync) {
            this.queueResync(msg.from);
            return;
        }

        const { resyncId, chunkIndex, isFinal } = msg.data || {};
        const transfer = this.resyncTransfers.get(resyncId);
        if (!transfer || transfer.steamId !== msg.from) return;

        if (typeof chunkIndex === 'number') {
            transfer.inFlight.delete(chunkIndex);
            this._sendResyncWindow(transfer);
        }

        if (isFinal) {
            clearInterval(transfer.timer);
            transfer.timer = null;
            this.resyncTransfers.delete(resyncId);
        }
    }

    _handleResyncChunk(msg) {
        const {
            resyncId, chunkIndex, chunkCount, byteOffset, crc32: expectedCrc, data,
        } = msg.data || {};
        if (!resyncId || typeof chunkIndex !== 'number') return;

        const bytes = decodeBase64(data || '');
        if (expectedCrc !== crc32(bytes)) {
            return;
        }

        const buffer = this.resyncBuffers.get(resyncId) || {
            chunkCount,
            chunks: new Map(),
            received: 0,
        };

        if (!buffer.chunks.has(chunkIndex)) {
            buffer.chunks.set(chunkIndex, { bytes, byteOffset });
            buffer.received += 1;
        }

        this.resyncBuffers.set(resyncId, buffer);

        this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.GAME_STATE_RESYNC_ACK, {
            resyncId,
            chunkIndex,
            isFinal: false,
        });

        if (buffer.received === buffer.chunkCount) {
            const totalLength = Array.from(buffer.chunks.values()).reduce((max, chunk) => Math.max(max, chunk.byteOffset + chunk.bytes.length), 0);
            const merged = new Uint8Array(totalLength);
            buffer.chunks.forEach((chunk) => {
                merged.set(chunk.bytes, chunk.byteOffset);
            });

            try {
                const payload = JSON.parse(decodeUtf8(merged));
                if (payload?.encoding === 'binary-v1') {
                    const snapshotBytes = decodeBase64(payload.snapshot || '');
                    const snapshotBuffer = snapshotBytes.buffer.slice(
                        snapshotBytes.byteOffset,
                        snapshotBytes.byteOffset + snapshotBytes.byteLength,
                    );
                    const snapshot = getBinaryDecoder().decodeSnapshot(snapshotBuffer);
                    this._applyResyncState({
                        ...snapshot,
                        ...(payload.header || {}),
                    });
                } else {
                    this._applyResyncState(payload);
                }
                this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.GAME_STATE_RESYNC_ACK, {
                    resyncId,
                    chunkIndex: null,
                    isFinal: true,
                });
            } catch (err) {
                console.error('❌ Failed to parse resync payload:', err);
            }

            this.resyncBuffers.delete(resyncId);
        }
    }

    _applyResyncState(state) {
        if (state.matchConfig) {
            this.matchConfig = { ...this.matchConfig, ...state.matchConfig };
        }
        if (state.sharedSeed) {
            this.sharedSeed = state.sharedSeed;
        }
        if (state.matchStartTime) {
            this.matchStartTime = state.matchStartTime;
        }

        state.players.forEach((playerData) => {
            if (!this.players.has(playerData.steamId)) {
                this.addPlayer(playerData.steamId, playerData.name || 'Player');
            }
        });

        this._applySnapshotState(state, { forceLocal: true });

        if (this.gamePhase === 'playing' && !this.loopRunning) {
            this.startGameLoop();
        }
    }

    /**
    * Broadcast player list (host only)
    */
    broadcastPlayerList() {
        if (!this.isHost) return;

        const playerList = Array.from(this.players.values()).map((p) => ({
            steamId: p.steamId,
            name: p.name,
            color: p.color, // NEW: Include player color
            isReady: p.isReady,
            isAlive: p.isAlive,
            isDisconnected: p.isDisconnected || false, // Broadcast disconnect status
        }));

        this.network.broadcastToAll(MessageTypes.LOBBY_PLAYER_JOINED, {
            players: playerList,
        });
    }

    /**
    * Set local player ready status
    */
    setReady(isReady) {
        const localPlayer = this.players.get(this.localPlayerId);
        if (localPlayer) {
            localPlayer.isReady = isReady;

            // Broadcast to everyone
            if (this.isHost) {
                this.broadcastPlayerList();
            } else {
                this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.LOBBY_PLAYER_READY, {
                    steamId: this.localPlayerId,
                    isReady,
                });
            }
        }
    }

    /**
    * Reset all player ready states (host broadcasts)
    */
    resetReadyStates() {
        this.players.forEach((player) => {
            player.isReady = false;
        });

        if (this.isHost) {
            this.broadcastPlayerList();
        }
    }

    /**
    * Check if all players are ready
    */
    allPlayersReady() {
        if (this.players.size < 2) return false; // Need at least 2 players

        return Array.from(this.players.values()).every((p) => p.isReady);
    }

    /**
    * Get player by Steam ID
    */
    getPlayer(steamId) {
        return this.players.get(steamId);
    }

    /**
    * Get local player
    */
    getLocalPlayer() {
        return this.players.get(this.localPlayerId);
    }

    /**
    * Send garbage attack to all opponents (after line clear)
    *
    * @param {Object} cascadeSummary - Summary of cascade (lines, colors, etc.)
    */
    sendGarbageAttack(cascadeSummary) {
        if (!this.isHost) {
            // Peers send attack info to host
            this.network.sendP2PMessage(this.network.hostSteamId, 'game:attack:request', {
                cascadeSummary,
                timestamp: Date.now(),
            });
            return;
        }

        // Host routes attack
        this.attackRouter.routeAttack(this.localPlayerId, cascadeSummary);
    }

    /**
    * Record player death (host only)
    *
    * @param {String} deadPlayerSteamId - Steam ID of dead player
    * @param {String} killerSteamId - Steam ID of killer (null for self-kill)
    */
    recordPlayerDeath(deadPlayerSteamId, killerSteamId = null) {
        if (!this.isHost) {
            console.warn('⚠️ Only host can record deaths');
            return;
        }

        this.fragTracker.recordDeath(deadPlayerSteamId, killerSteamId);
    }

    /**
    * Get current kill feed
    */
    getKillFeed() {
        return this.fragTracker.getKillFeed();
    }

    /**
    * Get current standings (ranked by frags, then score)
    */
    getStandings() {
        return this.fragTracker.getStandings();
    }

    /**
    * Handle host disconnection (peer only)
    */
    handleHostDisconnect() {
        if (this.isHost) {
            console.warn('⚠️ You are the host');
            return;
        }

        // Was this.hostMigration.handleHostDisconnect() — a method that does not
        // exist on HostMigration (guaranteed TypeError). The correct entry point
        // for "the host is gone, start a successor election" is initiateElection().
        this.hostMigration.initiateElection();
    }

    /**
    * Authority guard for host-reassignment messages (peer side).
    *
    * Returns true only when a host reassignment is legitimate:
    *  - the message comes from the current (still-alive) host announcing a
    *    planned handoff to a named successor, OR
    *  - an election is in progress (THIS peer believes the host is gone) AND the
    *    message comes from the legitimately-elected successor naming itself
    *    (mirrors HostMigration.handleClaim's `isElectionInProgress` + candidate
    *    checks).
    *
    * The election gate is essential: without it the lowest-id peer (always a
    * valid `_getExpectedHostCandidateId`) could broadcast game:host:migrated /
    * game:host:sync naming itself and seize a LIVE, HEALTHY host at any time,
    * then have every subsequent host-authoritative message accepted as trusted —
    * a full authority takeover. This is the Phase 1 quick fix; Phase 6 replaces
    * the allowlist model with a default-deny one (see the remediation plan).
    */
    _verifyHostReassignment(senderId, claimedNewHostId) {
        if (!senderId || !claimedNewHostId) return false;

        const currentHost = this.network?.hostSteamId;
        // The trusted current host may hand authority to any named successor
        // (a planned handoff) without an election.
        if (senderId === currentHost) return true;

        // A peer may assert authority ONLY while a successor election is active
        // — i.e. this peer's own host-liveness monitor has declared the host gone.
        // Otherwise a healthy host cannot be displaced by a peer.
        if (!this.hostMigration?.isElectionInProgress) return false;

        // ...and only by naming itself as the expected (lowest-id) candidate. It
        // is "expected" if it is still the lowest-id candidate (SYNC arrived
        // before CLAIM) or if CLAIM already promoted it to current host.
        const expectedCandidate = this.hostMigration?._getExpectedHostCandidateId?.();
        return senderId === claimedNewHostId
            && (claimedNewHostId === currentHost || claimedNewHostId === expectedCandidate);
    }

    /**
    * Get attack statistics
    */
    getAttackStats() {
        return this.attackRouter.getStats();
    }

    /**
    * Force end match (host only)
    */
    forceEndMatch() {
        if (!this.isHost) {
            console.warn('⚠️ Only host can force end match');
            return;
        }

        // Get top player as winner
        const standings = this.fragTracker.getStandings();
        const winner = standings.length > 0 ? this.players.get(standings[0].steamId) : null;

        if (winner) {
            this.fragTracker.endMatch(winner);
        }
    }

    /**
    * Configure unified loop callbacks once
    */
    configureUnifiedLoopCallbacks() {
        if (this.loopCallbacksConfigured || !this.unifiedLoop) {
            return;
        }

        this.unifiedLoop.onRender = () => {
            this.renderAllPlayers();
        };

        this.unifiedLoop.onUpdate = (currentTime, delta) => {
            if (this.gamePhase !== 'playing') {
                return;
            }

            this.localInputHooks.advance?.(currentTime, delta);

            // Phase 5: Flush batched inputs (Peers only)
            if (!this.isHost) {
                this.flushInputBatch();
            }

            if (this.isHost) {
                this.processBufferedInputs(); // Process inputs from jitter buffer
                this.updateAllPlayers(delta);
                this.attackRouter.updateHotPotato(Date.now());
                this.maybeBroadcastPostPhysics(delta);
            }
        };

        this.loopCallbacksConfigured = true;
    }

    /**
     * Process inputs from the jitter buffer (HOST ONLY)
     * Called every game tick to apply buffered inputs
     */
    processBufferedInputs() {
        if (!this.useJitterBuffer || !this.inputJitterBuffer) return;

        // Get inputs ready for this tick
        const inputsMap = this.inputJitterBuffer.getInputsForTick();

        for (const [steamId, inputs] of inputsMap) {
            if (inputs.length === 0) continue;

            const player = this.players.get(steamId);
            if (!player || !player.isAlive) continue;

            // Build callbacks once per player
            // Use local/remote callbacks as appropriate
            const isRemotePlayer = steamId !== this.localPlayerId;
            const callbacks = isRemotePlayer
                ? this.buildRemotePlayerCallbacks(steamId)
                : this.buildPhysicsCallbacks(steamId);

            // Apply all inputs for this tick
            for (const input of inputs) {
                // Re-validate just in case (though we trust the buffer logic)
                // Note: We skip timestamp validation here as it was already buffered

                // Track input for heuristics
                if (this.inputValidator) {
                    this.inputValidator.trackInput(steamId, input.type, input.data);
                }

                const applied = this._applyInputToPlayer(
                    steamId,
                    input.type,
                    input.data, // This is the inner data object
                    callbacks,
                );
                if (applied && input.data?.seq && input.data.seq > (player.lastInputSeq || 0)) {
                    player.lastInputSeq = input.data.seq;
                }
            }
        }

        // Advance buffer tick
        this.inputJitterBuffer.advanceTick();
    }

    /**
    * Create physics callbacks for unified game loop player registration
    */
    createPhysicsCallbacks(steamId) {
        return this.buildPhysicsCallbacks(steamId);
    }

    buildPhysicsCallbacks(steamId) {
        const isLocal = () => steamId === this.localPlayerId;
        const getPlayer = () => this.players.get(steamId);

        return {
            onGarbageReady: (summary) => {
                this.attackRouter.routeAttack(steamId, summary);
            },
            triggerFlash: (clearedRows = []) => {
                const player = getPlayer();
                if (!player) return;

                const rows = Array.isArray(clearedRows) ? clearedRows.slice() : [];
                const linesCleared = rows.length || (Array.isArray(clearedRows) ? 0 : Number(clearedRows) || 0);

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR, {
                    steamId,
                    playerName: player.name,
                    rows,
                    linesCleared,
                    isLocal: isLocal(),
                });
            },
            onLineClearImpact: (lineCount = 1) => {
                const player = getPlayer();
                if (!player) return;

                const settings = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager.get() : {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if (!prefersReducedMotion && player.gameState) {
                    let hitStop = 0;
                    if (lineCount >= 4) {
                        hitStop = 70;
                    }
                    if (hitStop > 0) {
                        player.gameState.hitStopRemaining = hitStop;
                    }
                }

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR_IMPACT, {
                    steamId,
                    playerName: player.name,
                    linesCleared: lineCount,
                    isLocal: isLocal(),
                });
            },
            triggerCombo: (comboCount) => {
                if (comboCount > 1) {
                    const player = getPlayer();
                    if (!player) return;

                    emitMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, {
                        steamId,
                        playerName: player.name,
                        comboCount,
                        isLocal: isLocal(),
                    });
                }
            },
            onPieceLock: (piece) => {
                const player = getPlayer();
                if (!player) return;

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, {
                    steamId,
                    playerName: player.name,
                    piece,
                    isLocal: isLocal(),
                });
            },
            onHardDrop: (dropData) => {
                const player = getPlayer();
                if (!player) return;

                const settings = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager.get() : {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if (!prefersReducedMotion && player.gameState) {
                    player.gameState.hitStopRemaining = Math.max(player.gameState.hitStopRemaining || 0, 30);
                }

                emitMultiplayerEvent('game:hard_drop', {
                    steamId,
                    playerName: player.name,
                    dropData,
                    isLocal: isLocal(),
                });
            },
            onPerfectClear: (depth, perfectClearBonus) => {
                const player = getPlayer();
                if (!player) return;

                const settings = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager.get() : {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if (!prefersReducedMotion && player.gameState) {
                    player.gameState.hitStopRemaining = 110;
                }

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.PERFECT_CLEAR, {
                    steamId,
                    playerName: player.name,
                    depth,
                    perfectClearBonus,
                    isLocal: isLocal(),
                });
            },
            spawnPiece: () => this._spawnNextPieceForPlayer(steamId),
        };
    }

    buildLocalPredictionCallbacks(steamId) {
        const callbacks = this.buildPhysicsCallbacks(steamId);
        // Peers send their attack info to the host for routing
        callbacks.onGarbageReady = (summary) => {
            this.sendGarbageAttack(summary);
        };
        // Peers handle their own piece spawning and garbage insertion locally
        // This is necessary because we don't sync board state from host for local player
        callbacks.spawnPiece = () => {
            const player = this.players.get(steamId);
            if (!player) return;

            const { gameState } = player;
            // Don't spawn if piece already exists or game is over
            if (gameState.currentPiece || gameState.isGameOver) {
                return;
            }

            // Insert local garbage prediction on piece lock
            this._insertLocalGarbagePrediction(steamId);

            // Check if garbage insertion caused game over
            if (gameState.isGameOver) {
                return;
            }

            // Spawn next piece locally (peers manage their own piece spawning)
            spawnPiece(gameState, null, null);
        };
        return callbacks;
    }

    /**
     * Build callbacks for processing REMOTE player input on the host
     * These callbacks do NOT route garbage attacks because remote players
     * send their own game:attack:request messages
     */
    buildRemotePlayerCallbacks(steamId) {
        const callbacks = this.buildPhysicsCallbacks(steamId);
        // Don't route garbage - remote players send their own attack requests
        callbacks.onGarbageReady = () => { };
        return callbacks;
    }

    /**
     * Insert garbage locally for visual prediction (peers only)
     * Host's broadcast will overwrite with authoritative state
     */
    _insertLocalGarbagePrediction(steamId) {
        if (this.isHost) return; // Host uses _spawnNextPieceForPlayer

        const player = this.players.get(steamId);
        if (!player || !player.isAlive) return;

        const { garbageQueue, gameState } = player;
        const totalLines = garbageQueue.getTotalLines();

        if (totalLines > 0) {
            // Take lines from queue and insert locally
            const burst = garbageQueue.dequeueLineBurst();
            if (burst && burst.length > 0) {
                const normalizedBurst = burst.map((entry) => ({
                    ...entry,
                    holeMask: typeof entry.holeMask === 'number' ? entry.holeMask : 0,
                    variant: entry.variant || 'normal',
                }));

                const result = insertGarbageEntries(gameState.lockedPieces, normalizedBurst, {
                    boardGrid: gameState.boardGrid,
                    debug: this.debugGarbage,
                });

                if (result && !result.topOut && gameState.boardGrid) {
                    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
                    gameState.boardCache = null;
                    gameState.boardCacheDirty = true;
                }
                markBoardDirty(gameState);

                // Dispatch event for UI feedback
                emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, {
                    steamId,
                    playerName: player.name,
                    linesInserted: burst.length,
                    isLocal: true,
                });
            }
        }

        // Trigger render to show the garbage
        this.renderAllPlayers();
    }

    _spawnNextPieceForPlayer(steamId) {
        const player = this.players.get(steamId);
        if (!player) return;

        const { gameState } = player;
        if (gameState.currentPiece || gameState.isGameOver) {
            return;
        }

        // CRITICAL: Insert garbage BEFORE spawning new piece
        // This ensures garbage appears on the board at the same time the meter goes down
        this.insertPendingGarbage(steamId);

        // Check if garbage insertion caused top-out
        if (gameState.isGameOver) {
            return;
        }

        spawnPiece(
            gameState,
            null,
            () => {
                const latestPlayer = this.players.get(steamId);
                if (!latestPlayer) {
                    return;
                }

                console.log(`💀 ${latestPlayer.name} topped out on spawn!`);
                gameState.isGameOver = true;
                latestPlayer.isAlive = false;

                const { lastAttackerId } = latestPlayer;
                const lastAttacker = lastAttackerId ? this.players.get(lastAttackerId) : null;
                if (lastAttackerId) {
                    console.log(`🏆 Death on spawn attributed to last attacker: ${lastAttacker?.name || lastAttackerId}`);
                } else {
                    console.log('💀 Death on spawn with no attacker tracked (self-kill)');
                }

                // TODO: Store lastAttackerName on player too? For now, we rely on ID lookup for this edge case
                this.fragTracker.recordDeath(steamId, lastAttackerId);

                emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
                    steamId,
                    playerName: latestPlayer.name,
                    killer: lastAttackerId || null,
                    killerId: lastAttackerId || null,
                    killerName: lastAttacker?.name || null,
                    isSelfKill: !lastAttackerId || lastAttackerId === steamId,
                    isLocal: steamId === this.localPlayerId,
                });
            },
        );
    }

    /**
    * Register all players with the unified multiplayer loop (host only)
    */
    syncUnifiedLoopPlayers() {
        if (!this.unifiedLoop) {
            return;
        }

        this.unifiedLoop.clearPlayers();

        if (!this.isHost) {
            return;
        }

        this.players.forEach((player, steamId) => {
            if (!player) return;
            const physicsCallbacks = this.createPhysicsCallbacks(steamId);
            this.unifiedLoop.registerPlayer(steamId, player.gameState, physicsCallbacks, null);
        });
    }

    promoteToHost() {
        this.isHost = true;
        this.network.isHost = true;
        this.network.hostSteamId = this.localPlayerId;
        this.handshakeComplete = true;
        this.attackRouter.isHost = true;

        if (!this.inputValidator) {
            this.inputValidator = new InputValidator();
        } else {
            this.inputValidator.reset();
        }

        if (!this.inputJitterBuffer) {
            this.inputJitterBuffer = new InputJitterBuffer({
                bufferDepth: 2,
                tickRate: 30,
            });
        } else {
            this.inputJitterBuffer.clear();
        }

        this.players.forEach((_player, steamId) => {
            this.inputJitterBuffer?.addPlayer(steamId);
        });

        this.startHeartbeatLoop();
        this.syncUnifiedLoopPlayers();
        this.startGameLoop();
        this.startStateSyncLoop();
    }

    /**
    * Start the game loop (runs on both host and peer)
    */
    startGameLoop() {
        this.configureUnifiedLoopCallbacks();

        if (this.isHost) {
            this.syncUnifiedLoopPlayers();
        } else if (this.unifiedLoop) {
            this.unifiedLoop.clearPlayers();
            const localPlayer = this.players.get(this.localPlayerId);
            if (localPlayer) {
                const physicsCallbacks = this.buildLocalPredictionCallbacks(this.localPlayerId);
                this.unifiedLoop.registerPlayer(
                    this.localPlayerId,
                    localPlayer.gameState,
                    physicsCallbacks,
                    null,
                );
            }
        }

        if (this.unifiedLoop && !this.loopRunning) {
            this.localInputHooks.reset?.();
            this.unifiedLoop.start();
            this.loopRunning = true;
            console.log(`🎮 Unified game loop started (${this.isHost ? 'HOST' : 'PEER'} mode)`);
        }
    }

    /**
    * Render all player game boards (HOST & PEER)
    * This is called every frame to update visuals
    * PERF: Uses pre-allocated payload to avoid object creation every frame
    */
    renderAllPlayers() {
        // PERF: Reuse pre-allocated slots instead of creating new objects
        let i = 0;
        this.players.forEach((player, steamId) => {
            const slot = this._renderPayload.players[i];
            if (slot) {
                slot.steamId = steamId;
                slot.name = player.name;
                slot.color = player.color;
                slot.gameState = player.gameState;
                slot.garbageQueue = player.garbageQueue;
                slot.isLocal = steamId === this.localPlayerId;
                slot.isAlive = player.isAlive;
                slot.frags = player.frags;
                i++;
            }
        });
        this._renderPayload.playerCount = i;

        // Emit with pre-allocated payload (consumers should use playerCount, not players.length)
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.RENDER_FRAME, this._renderPayload);
    }

    /**
    * Stop the game loop
    */
    stopGameLoop() {
        if (this.unifiedLoop && this.loopRunning) {
            this.unifiedLoop.stop();
            this.loopRunning = false;
            console.log('🛑 Game loop stopped');
        }

        this.localInputHooks.reset?.();

        if (this.unifiedLoop) {
            this.unifiedLoop.clearPlayers();
        }
    }

    /**
    * Update all players' game states (HOST ONLY)
    */
    updateAllPlayers(deltaTime) {
        this.players.forEach((player, steamId) => {
            if (!player) return;

            const { gameState } = player;
            if (gameState.isGameOver && player.isAlive) {
                const { lastAttackerId } = player;
                if (lastAttackerId) {
                    const attacker = this.players.get(lastAttackerId);
                    console.log(`🏆 Death attributed to last attacker: ${attacker?.name || lastAttackerId}`);
                } else {
                    console.log('💀 Death with no attacker tracked (self-kill)');
                }

                this.fragTracker.recordDeath(steamId, lastAttackerId);
            }
        });

        // Check win condition
        this.fragTracker.checkMatchEnd();
    }

    /**
    * Restart the match (new round with same players)
    * HOST ONLY - Instant restart (no between-round countdown)
    */
    restartMatch() {
        if (!this.isHost) {
            console.warn('⚠️ Only host can restart match');
            return;
        }

        console.log('🔄 Restarting match...');

        // Stop current game
        this.stopGameLoop();
        this.stopStateSyncLoop();

        // Reset trackers
        if (this.fragTracker) {
            this.fragTracker.reset();
        }
        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        // IMPORTANT: Reset ALL players (including dead ones) but KEEP FRAGS/SCORES
        this.players.forEach((player, steamId) => {
            player.isAlive = true; // Revive everyone
            // DO NOT RESET FRAGS - they accumulate across rounds!
            player.garbageQueue.clear();
            player.lastAttackerId = null; // Clear last attacker for new round

            // Reset game state but preserve score and lines from previous rounds
            const oldScore = player.gameState.score;
            const oldLines = player.gameState.lines;
            const oldLevel = player.gameState.level;

            player.gameState = new GameState();
            player.gameState.score = oldScore; // Keep score across rounds
            player.gameState.lines = oldLines; // Keep lines across rounds
            player.gameState.level = oldLevel; // Keep level progression
        });

        // Reset match state (but keep matchStartTime for time-based win conditions)
        this.winner = null;
        this.gamePhase = 'waiting';

        console.log('🎮 Starting next round...');

        // Broadcast round restart to all peers BEFORE starting the next round
        const newSeed = Math.floor(Math.random() * 1000000);
        const instantStart = true;
        this.network.broadcastToAll(MessageTypes.GAME_ROUND_RESTART, {
            newSeed,
            instantStart,
        });

        // Dispatch event to clear death visuals for all players
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
            players: Array.from(this.players.keys()),
        });

        const startRound = () => {
            this.gamePhase = 'playing';

            // Re-initialize players for next round (use the same seed we broadcast)
            // CRITICAL: All players must use the EXACT same seed for fair play
            this.players.forEach((player) => {
                // Set new deterministic RNG for this round - same seed for all players
                player.gameState.randomGenerator = this.createSeededRNG(newSeed);

                // Fill bag and spawn first piece
                fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);
                spawnPiece(player.gameState, null, null);
            });

            // Start game loop
            this.startGameLoop();

            // Host: Start state sync loop (30Hz broadcasts to peers)
            if (this.isHost) {
                this.startStateSyncLoop();
            }

            console.log('🎮 Round started!');
        };

        if (instantStart) {
            this.hideCountdownOverlay();
            startRound();
            return;
        }

        this.showCountdown(startRound, 'ROUND OVER', 3, false);
    }

    /**
    * Full game restart (resets frags too) - used when game is truly over
    * HOST ONLY
    */
    restartFullGame() {
        if (!this.isHost) {
            console.warn('⚠️ Only host can restart full game');
            return;
        }

        console.log('🔄 Restarting full game (resetting frags)...');

        // Stop current game
        this.stopGameLoop();
        this.stopStateSyncLoop();

        // Reset trackers
        if (this.fragTracker) {
            this.fragTracker.reset();
        }
        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        // Reset ALL players including frags/scores (full reset)
        this.players.forEach((player, steamId) => {
            player.isAlive = true;
            player.frags = 0; // RESET FRAGS for new game
            player.garbageQueue.clear();
            player.lastAttackerId = null; // Clear last attacker for new game

            // Complete reset
            player.gameState = new GameState();
            player.gameState.level = this.matchConfig.startLevel;
        });

        // Reset match state
        this.winner = null;
        this.gamePhase = 'waiting';

        console.log('🎮 Starting new game...');

        // Dispatch event to clear death visuals
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
            players: Array.from(this.players.keys()),
        });

        // Start a fresh match (broadcasts to peers with countdown)
        this.startMatch();
    }

    /**
    * Show countdown overlay with optional text: [TEXT] → 3, 2, 1, GO!
    * @param {Function} callback - Called after countdown finishes
    * @param {string} prefixText - Optional text to show before countdown (e.g., "ROUND OVER", "GAME START")
    * @param {number} countFrom - Number to start counting down from
    * @param {boolean} includeZero - Whether to include 0 in the countdown
    */
    showCountdown(callback, prefixText = null, countFrom = 5, includeZero = true) {
        const countdownElement = document.getElementById('multiplayer-countdown');

        if (!countdownElement) {
            console.warn('⚠️ Countdown element not found');
            if (callback) callback();
            return;
        }

        console.log('🎬 Starting countdown animation...', { prefixText });

        const minCount = includeZero ? 0 : 1;
        let count = Number.isFinite(countFrom) ? Math.floor(countFrom) : 5;
        if (count < minCount) {
            count = minCount;
        }

        // Enhanced full-screen overlay with animation support
        const forceFullScreen = () => {
            countdownElement.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 99999 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: rgba(0, 0, 0, 0.85) !important;
        backdrop-filter: blur(15px) !important;
        font-family: 'Orbitron', sans-serif !important;
        font-weight: 900 !important;
        text-align: center !important;
        color: #ffffff !important;
        text-shadow: 0 0 30px rgba(255, 255, 255, 0.9), 0 0 50px rgba(102, 126, 234, 0.7), 0 0 80px rgba(102, 126, 234, 0.4) !important;
        transform: none !important;
        translate: none !important;
        inset: 0 !important;
        opacity: 1 !important;
      `;
        };

        // Show prefix text first (if provided)
        if (prefixText) {
            forceFullScreen();
            countdownElement.textContent = prefixText;
            countdownElement.style.fontSize = '80px';
            countdownElement.style.color = '#fbbf24'; // Yellow/gold
            countdownElement.style.animation = 'countdownFadeInScale 0.4s ease-out forwards';

            console.log(`📢 Showing prefix: "${prefixText}"`);

            setTimeout(() => {
                countdownElement.style.animation = 'countdownFadeOut 0.2s ease-out forwards';
                setTimeout(() => startCountdown(), 200);
            }, 1400); // Show prefix for 1.4 seconds
        } else {
            forceFullScreen();
            startCountdown();
        }

        function startCountdown() {
            const showGo = () => {
                requestAnimationFrame(() => {
                    countdownElement.textContent = 'GO!';
                    countdownElement.style.fontSize = '160px';
                    countdownElement.style.color = '#10b981'; // Bright Green
                    countdownElement.style.animation = 'none';

                    // Force reflow
                    void countdownElement.offsetHeight;

                    countdownElement.style.animation = 'countdownGo 0.6s ease-out forwards';

                    emitMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, { count: 'GO' });
                });

                // Fade out entire overlay and start game
                setTimeout(() => {
                    requestAnimationFrame(() => {
                        countdownElement.style.transition = 'opacity 0.3s ease-out';
                        countdownElement.style.opacity = '0';
                    });

                    setTimeout(() => {
                        countdownElement.style.display = 'none';
                        countdownElement.style.transition = '';
                        countdownElement.style.opacity = ''; // Reset opacity
                        if (callback) callback();
                    }, 300);
                }, 600);
            };

            const showNumber = () => {
                if (count < minCount) {
                    showGo();
                    return;
                }

                // Use requestAnimationFrame for smooth UI updates
                requestAnimationFrame(() => {
                    countdownElement.textContent = count;
                    countdownElement.style.fontSize = '140px';
                    countdownElement.style.color = count >= 3 ? '#ef4444' : count === 2 ? '#f59e0b' : '#10b981'; // Red (5,4,3) -> Orange (2) -> Green (1)
                    countdownElement.style.animation = 'none'; // Clear previous animation

                    // Force reflow to restart animation
                    void countdownElement.offsetHeight;

                    countdownElement.style.animation = 'countdownPulse 0.5s ease-out forwards';

                    console.log(`🔢 Showing countdown: ${count}`);

                    // Broadcast countdown to all players
                    emitMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, { count });
                });

                count--;

                if (count >= minCount) {
                    setTimeout(showNumber, 750); // Smooth timing between numbers
                } else {
                    const goDelay = includeZero ? 0 : 750;
                    setTimeout(showGo, goDelay);
                }
            };

            showNumber();
        }
    }

    hideCountdownOverlay() {
        const countdownElement = document.getElementById('multiplayer-countdown');
        if (!countdownElement) return;

        countdownElement.style.display = 'none';
        countdownElement.style.transition = '';
        countdownElement.style.opacity = '';
        countdownElement.style.animation = '';
        countdownElement.textContent = '';
    }

    /**
    * Clean up (leave match)
    */
    cleanup() {
        this.stopGameLoop();
        this.stopStateSyncLoop();

        if (this.inputValidator) {
            this.inputValidator.reset();
        }

        if (this.fragTracker) {
            this.fragTracker.reset();
        }

        if (this.attackRouter) {
            this.attackRouter.clearHistory();
        }

        this.players.clear();
        this.gamePhase = 'waiting';
        this.winner = null;
        this.setLocalInputHooks();

        console.log('🧹 FFA game state cleaned up');
    }
}
