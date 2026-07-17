// @ts-check
/**
 * Steam P2P Networking Wrapper
 * Handles Steam lobbies, P2P messaging, and matchmaking
 *
 * Phase 4: Added binary encoding support for 90% bandwidth reduction
 * Phase 5: Migrated from greenworks to steamworks.js (via Electron IPC)
 */

import { SteamConfig } from './config.js';
import { readFlag } from '../flags.js';
import { getBinaryEncoder, getBinaryDecoder } from '../network/binary-encoding.js';
import { NetworkImpairmentHarness, resolveImpairmentBootConfig } from '../network/network-impairment.js';
import { hydrateBinarySnapshot } from '../network/snapshot-contract.js';
import {
    decodeSnapshotFrameV2,
    encodeSnapshotFrameV2,
    sessionNonceToTag,
    SnapshotFrameKind,
} from '../network/snapshot-frame-v2.js';
import {
    getProtocolEntry,
    isProtocolBootstrapMessageType,
    isSupportedInAnyProtocolVersion,
    MessageTypes,
} from '../network/message-types.js';
import {
    acceptsProtocolSelection,
    compareProtocolVersions,
    CURRENT_ENVELOPE_VERSION,
    CURRENT_PROTOCOL_VERSION,
    getLocalProtocolOffer,
    MIN_PROTOCOL_VERSION,
    negotiateProtocolVersion,
    PROTOCOL_V2,
    SUPPORTED_PROTOCOL_VERSIONS,
} from '../network/protocol-version.js';

const electronApi = typeof window !== 'undefined' ? window.electronAPI : null;
const ipcRenderer = electronApi
    ? { invoke: (...args) => electronApi.invoke(...args) }
    : null;
const hasSteamworks = Boolean(ipcRenderer);

if (!hasSteamworks) {
    console.log('🌐 Running in browser mode - Steam features will use mock mode');
}

// Host migration has one deliberately peer-safe broadcast: the elected
// successor must announce its CLAIM before promoteToHost() changes the envelope
// authority. All other broadcasts remain host-only in both real and mock mode.
const PEER_BROADCAST_MESSAGE_TYPES = new Set([
    MessageTypes.GAME_HOST_MIGRATION_CLAIM,
]);

export class SteamNetworking {
    constructor() {
        this.initialized = false;
        this.steamId = null;
        this.playerName = null;
        this.isHost = false;
        this.hostSteamId = null;
        this.currentLobbyId = null;
        this.connectedPeers = new Map(); // Map<steamId, { name, isAlive, ... }>
        this.messageHandlers = new Map();
        this.supportedProtocolVersions = [...SUPPORTED_PROTOCOL_VERSIONS];
        this.minProtocolVersion = MIN_PROTOCOL_VERSION;
        this.protocolVersion = CURRENT_PROTOCOL_VERSION;
        /** @type {string|null} */
        this.sessionProtocolVersion = null;
        /** @type {Set<string>} */
        this.acceptedProtocolPeers = new Set();
        this.envelopeVersion = CURRENT_ENVELOPE_VERSION;
        this.matchId = null;
        this.matchNonce = null;
        this.sendSeqByChannel = new Map();
        this.recvSeqByPeer = new Map();
        /** @type {Map<string, BinaryStateSnapshotV7>} */
        this.incomingSnapshotBaselines = new Map();
        this.lastResyncRequestAt = new Map(); // per-peer cooldown so a burst of bad deltas can't spam resyncs
        this.outgoingSnapshotState = new Map();

        // Phase 4: Binary encoding for snapshots (90% bandwidth reduction)
        this.useBinaryEncoding = true; // Enable by default for production
        this.binaryEncoder = null;
        this.binaryDecoder = null;
        this.lastBroadcastSnapshot = null;
        // Deltas diff against the last KEYFRAME (which is sent reliably and in-order),
        // not against the previous broadcast — so one lost/reordered unreliable delta
        // can't invalidate every later delta in the interval. Only a full advances it.
        this.lastKeyframeSnapshot = null;
        this.lastFullSnapshotAt = 0;
        // Reliable keyframe cadence. A dropped (unreliable) delta self-heals on the
        // next full, so this bounds the worst-case opponent-board freeze. 250ms keeps
        // it crisp; keyframes are tiny binary + only ~4/s so bandwidth stays low.
        this.fullSnapshotIntervalMs = 250;

        // Phase 4: Heartbeat and disconnect detection
        this.heartbeatInterval = null;
        this.heartbeatRate = 2000; // Send heartbeat every 2 seconds
        this.heartbeatTimeout = 6000; // Consider peer dead after 6 seconds
        this.lastHeartbeatReceived = new Map(); // Map<steamId, timestamp>
        this.disconnectCallbacks = []; // Array of callbacks for disconnect events

        // Mock mode for local testing - use mock if Steam API is not available via preload
        this.mockMode = SteamConfig.mockMode || !hasSteamworks;

        // Mock P2P communication channel (for cross-window messaging)
        this.broadcastChannel = null;
        // Impairment harness is dev/test-gated (plan §1.4): live config only in
        // mock mode, Vite dev, or explicit ?netImpair opt-in — a poisoned
        // localStorage entry must never drop/delay real Steam packets.
        this.networkImpairment = new NetworkImpairmentHarness(resolveImpairmentBootConfig({
            mockMode: this.mockMode,
            // Plain import.meta.env.DEV (no optional chaining) — the exact token
            // Vite statically replaces in builds; the proven idiom here (OdysseyMode).
            isDev: Boolean(import.meta.env.DEV),
            search: (typeof window !== 'undefined' && window.location?.search) || '',
        }));
        this.networkImpairmentTimers = new Set();
        this.packetStats = {
            sent: 0,
            received: 0,
            sendFailures: 0,
            decodeFailures: 0,
            validationFailures: 0,
            roleValidationDropsByType: /** @type {Record<string, number>} */ ({}),
            staleDeltasDropped: 0, // deltas superseded by a newer keyframe (silently ignored)
            keyframesSent: 0,
            deltasSent: 0,
            keyframesReceived: 0,
            deltasReceived: 0,
            missingBaselineDeltas: 0,
            aheadOfBaselineDeltas: 0,
            deltaDecodeFailures: 0,
            resyncRequestsSent: 0,
            resyncRequestsSuppressed: 0,
            snapshotWireBytesSent: [],
            snapshotWireBytesReceived: [],
            snapshotDeltaWireBytesSent: [],
            snapshotDeltaWireBytesReceived: [],
            snapshotKeyframeWireBytesSent: [],
            snapshotKeyframeWireBytesReceived: [],
            snapshotPayloadBytesSent: [],
            snapshotPayloadBytesReceived: [],
        };
    }

    /**
   * Initialize Steam API
   */
    async init() {
        // Mock mode for local testing
        if (this.mockMode) {
            console.log('🧪 MOCK STEAM MODE - Local testing only');
            this.initialized = true;
            this.steamId = `mock_${Math.random().toString(36).substr(2, 9)}`;
            this.playerName = `Dev_${Date.now() % 1000}`;
            console.log(`✅ Mock Steam initialized: ${this.playerName} (${this.steamId})`);
            return true;
        }

        // Real Steam mode via steamworks.js preload API
        try {
            const isRunning = await ipcRenderer.invoke('steam:isSteamRunning');
            if (!isRunning) {
                console.error('❌ Steam is not running! Please launch Steam first.');
                throw new Error('Steam is not running! Please launch Steam first.');
            }

            const steamInitialized = await ipcRenderer.invoke('steam:isInitialized');
            if (!steamInitialized) {
                console.error('❌ Steam API not initialized in main process');
                throw new Error('Steam API not initialized');
            }

            this.steamId = await ipcRenderer.invoke('steam:getSteamId');
            this.playerName = await ipcRenderer.invoke('steam:getPlayerName');
            this.initialized = true;

            console.log(`✅ Steam initialized: ${this.playerName} (${this.steamId})`);

            // Start P2P packet polling
            this.startP2PPolling();

            return true;
        } catch (err) {
            console.error('❌ Steam initialization failed:', err);
            throw err;
        }
    }

    /**
   * Create a Steam lobby (become host)
   */
    async createLobby(options = {}) {
        this._resetLobbySession();
        const {
            maxPlayers = 8,
            lobbyType = 'public', // 'public' or 'friends'
            gameName = 'FFA Match',
            endCondition = 'frags',
            endConditionValue = 10,
            requiredProtocolVersion = readFlag('wireV2', false)
                ? PROTOCOL_V2
                : this.protocolVersion,
        } = options;
        if (!this.lockProtocolSession(requiredProtocolVersion)) {
            throw new Error(`Unsupported required protocol version: ${requiredProtocolVersion}`);
        }

        if (this.mockMode) {
            // Mock lobby for local testing
            this.isHost = true;
            this.hostSteamId = this.steamId;
            this.currentLobbyId = `mock_lobby_${Date.now()}`;
            this.matchId = this.currentLobbyId;
            this.matchNonce = this._generateMatchNonce();

            // Store lobby in localStorage so it's visible across browser windows
            const lobbyData = {
                id: this.currentLobbyId,
                hostId: this.steamId,
                hostName: this.playerName,
                gameName,
                maxPlayers,
                currentPlayers: 1,
                lobbyType,
                endCondition,
                endConditionValue,
                version: this.getNegotiatedProtocolVersion(),
                // Match lifecycle as advertised to the lobby browser:
                //   'open' (waiting room, normal Join) | 'playing' (in progress → drop-in / watch) | 'finished'
                // Kept current by the host via setLobbyStatus()/setLobbyPlayerCount().
                status: 'open',
                createdAt: Date.now(),
            };

            this.saveMockLobby(lobbyData);

            // Set up BroadcastChannel for cross-window communication
            this.setupMockP2P(this.currentLobbyId);

            console.log(`🧪 Mock lobby created: ${this.currentLobbyId}`);
            console.log('   📢 Lobby is now visible to all browser windows!');
            console.log('   📡 Mock P2P communication enabled!');
            return this.currentLobbyId;
        }

        // Real Steam mode via steamworks.js preload API
        try {
            const lobbyId = await ipcRenderer.invoke('steam:createLobby', { maxPlayers, lobbyType });
            console.log(`✅ Lobby created: ${lobbyId}`);

            this.isHost = true;
            this.hostSteamId = this.steamId;
            this.currentLobbyId = lobbyId;
            this.matchId = lobbyId;
            this.matchNonce = this._generateMatchNonce();

            // Set lobby metadata
            await ipcRenderer.invoke('steam:setLobbyData', lobbyId, 'game_mode', 'ffa');
            await ipcRenderer.invoke('steam:setLobbyData', lobbyId, 'game_name', gameName);
            await ipcRenderer.invoke('steam:setLobbyData', lobbyId, 'end_condition', endCondition);
            await ipcRenderer.invoke('steam:setLobbyData', lobbyId, 'end_condition_value', endConditionValue.toString());
            await ipcRenderer.invoke(
                'steam:setLobbyData',
                lobbyId,
                'version',
                this.getNegotiatedProtocolVersion(),
            );

            return lobbyId;
        } catch (err) {
            console.error('❌ Failed to create lobby:', err);
            throw err;
        }
    }

    /**
   * Join an existing Steam lobby
   */
    async joinLobby(lobbyId) {
        this._resetLobbySession();
        if (this.mockMode) {
            // Mock join for local testing
            this.isHost = false;
            this.currentLobbyId = lobbyId;
            this.matchId = lobbyId;

            // Get the REAL host ID from the lobby data in localStorage
            const lobbies = this.loadMockLobbies();
            const lobby = lobbies.find((l) => l.id === lobbyId);
            if (lobby) {
                this.hostSteamId = lobby.hostId;
                console.log(`✅ Found lobby host: ${lobby.hostName} (${lobby.hostId})`);
            } else {
                console.warn(`⚠️ Lobby ${lobbyId} not found in localStorage, using fallback`);
                this.hostSteamId = `mock_host_${lobbyId}`;
            }

            // Set up BroadcastChannel for cross-window communication
            this.setupMockP2P(lobbyId);

            console.log(`🧪 Mock joined lobby: ${lobbyId}`);
            console.log('   📡 Mock P2P communication enabled!');
            return;
        }

        // Real Steam mode via steamworks.js preload API
        try {
            await ipcRenderer.invoke('steam:joinLobby', lobbyId);
            console.log(`✅ Joined lobby: ${lobbyId}`);

            this.isHost = false;
            this.currentLobbyId = lobbyId;
            this.matchId = lobbyId;
            this.hostSteamId = await ipcRenderer.invoke('steam:getLobbyOwner', lobbyId);

            return;
        } catch (err) {
            console.error('❌ Failed to join lobby:', err);
            throw err;
        }
    }

    /**
     * Get data from a lobby
     */
    async getLobbyData(lobbyId, key) {
        if (this.mockMode) {
            // Mock data
            const lobbies = this.loadMockLobbies();
            const lobby = lobbies.find((l) => l.id === lobbyId);
            if (lobby) {
                if (key === 'game_name') return lobby.gameName;
                if (key === 'end_condition') return lobby.endCondition;
                if (key === 'end_condition_value') return lobby.endConditionValue;
            }
            return null;
        }

        try {
            return await ipcRenderer.invoke('steam:getLobbyData', lobbyId, key);
        } catch (err) {
            console.warn(`⚠️ Failed to get lobby data (${key}):`, err.message);
            return null;
        }
    }

    /**
   * Send P2P message to specific player
   */
    sendP2PMessage(targetSteamId, messageType, data, options = {}) {
        return this._sendMessage(targetSteamId, messageType, data, {
            channel: 0,
            delivery: 'reliable',
            ...options,
        });
    }

    sendUnreliable(targetSteamId, messageType, data, options = {}) {
        return this._sendMessage(targetSteamId, messageType, data, {
            channel: 2,
            delivery: 'unreliable',
            ...options,
        });
    }

    sendUnreliableNoDelay(targetSteamId, messageType, data, options = {}) {
        return this._sendMessage(targetSteamId, messageType, data, {
            channel: 1,
            delivery: 'unreliable_no_delay',
            ...options,
        });
    }

    _sendMessage(targetSteamId, messageType, data, options) {
        if (!this._hasOutboundProtocolSession(targetSteamId, messageType)) {
            this.packetStats.sendFailures += 1;
            console.warn(`Rejected outbound ${messageType || 'unknown'} before protocol negotiation`);
            return false;
        }
        const protocolVersion = options.protocolVersion
            ?? this.getNegotiatedProtocolVersion();
        if (!this._isLocalSenderAllowedForMessage(messageType, data, protocolVersion)) {
            this.packetStats.sendFailures += 1;
            console.warn(`Rejected outbound message type or sender role: ${messageType || 'unknown'}`);
            return false;
        }
        const isRawSnapshot = options.rawSnapshot === true;
        const requiresRawSnapshot = protocolVersion === PROTOCOL_V2
            && messageType === MessageTypes.GAME_STATE_FULL;
        if (isRawSnapshot !== requiresRawSnapshot) {
            this.packetStats.sendFailures += 1;
            console.warn(`Rejected outbound ${messageType}: session snapshot codec mismatch`);
            return false;
        }
        if (isRawSnapshot) {
            if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
                this.packetStats.sendFailures += 1;
                console.warn('Rejected outbound protocol-v2 snapshot: raw frame bytes required');
                return false;
            }
            this._sendEnvelope(targetSteamId, messageType, data, {
                ...options,
                protocolVersion,
            });
            return true;
        }
        const envelope = this._buildEnvelope(messageType, data, {
            ...options,
            targetSteamId,
            protocolVersion,
        });
        this._sendEnvelope(targetSteamId, messageType, envelope, options);
        return true;
    }

    _sendEnvelope(targetSteamId, messageType, envelope, options = {}) {
        const impairmentPlan = this.networkImpairment.planDelivery({
            channel: options.channel ?? 0,
            delivery: options.delivery ?? 'reliable',
        });

        if (impairmentPlan.drop) {
            return;
        }

        for (const delivery of impairmentPlan.deliveries) {
            if (delivery.delayMs > 0) {
                const timer = setTimeout(() => {
                    this.networkImpairmentTimers.delete(timer);
                    this._deliverEnvelopeNow(targetSteamId, messageType, envelope, options);
                }, delivery.delayMs);
                this.networkImpairmentTimers.add(timer);
            } else {
                this._deliverEnvelopeNow(targetSteamId, messageType, envelope, options);
            }
        }
    }

    _deliverEnvelopeNow(targetSteamId, messageType, envelope, options = {}) {
        if (options.rawSnapshot === true) {
            this._deliverRawSnapshotNow(targetSteamId, messageType, envelope, options);
            return;
        }
        if (this.mockMode) {
            // Mock send via BroadcastChannel
            if (this.broadcastChannel) {
                const message = {
                    ...envelope,
                    type: messageType,
                    from: this.steamId,
                    to: targetSteamId,
                    channel: options.channel,
                };
                this.broadcastChannel.postMessage(message);
                if (messageType === MessageTypes.GAME_STATE_FULL) {
                    this._recordSnapshotWireBytes(
                        'sent',
                        this._packetByteLength(envelope),
                        this._snapshotWireKind(envelope),
                    );
                    this._recordSnapshotPayloadBytes('sent', envelope.payload?._encodedSize);
                }

                if (SteamConfig.debugMode) {
                    console.log(`🧪 Mock sent to ${targetSteamId}:`, messageType);
                }
            }
            return;
        }

        const sendType = this._resolveDelivery(options.delivery);
        // Send via steamworks.js preload API
        ipcRenderer.invoke(
            'steam:sendP2PPacket',
            targetSteamId,
            envelope,
            sendType,
            options.channel ?? 0,
        ).then((result) => {
            const sent = typeof result === 'object' ? result?.sent : result;
            if (sent) {
                this.packetStats.sent += 1;
                if (messageType === MessageTypes.GAME_STATE_FULL && result?.wireBytes) {
                    this._recordSnapshotWireBytes(
                        'sent',
                        result.wireBytes,
                        this._snapshotWireKind(envelope),
                    );
                    this._recordSnapshotPayloadBytes('sent', envelope.payload?._encodedSize);
                }
            } else {
                this.packetStats.sendFailures += 1;
            }
        }).catch(() => {
            this.packetStats.sendFailures += 1;
        });
    }

    _deliverRawSnapshotNow(targetSteamId, messageType, rawFrame, options = {}) {
        const wireBytes = this._packetByteLength(rawFrame);
        const snapshotKind = options.snapshotKind ?? null;
        if (this.mockMode) {
            if (!this.broadcastChannel) return;
            this.broadcastChannel.postMessage({
                type: 'steam:raw-snapshot-v2',
                from: this.steamId,
                to: targetSteamId,
                channel: options.channel,
                rawFrame,
            });
            this._recordSnapshotWireBytes('sent', wireBytes, snapshotKind);
            this._recordSnapshotPayloadBytes('sent', options.snapshotPayloadBytes);
            return;
        }

        const sendType = this._resolveDelivery(options.delivery);
        ipcRenderer.invoke(
            'steam:sendP2PPacket',
            targetSteamId,
            rawFrame,
            sendType,
            options.channel ?? 0,
        ).then((result) => {
            const sent = typeof result === 'object' ? result?.sent : result;
            if (!sent) {
                this.packetStats.sendFailures += 1;
                return;
            }
            this.packetStats.sent += 1;
            this._recordSnapshotWireBytes(
                'sent',
                result?.wireBytes || wireBytes,
                snapshotKind,
            );
            this._recordSnapshotPayloadBytes('sent', options.snapshotPayloadBytes);
        }).catch(() => {
            this.packetStats.sendFailures += 1;
        });
    }

    /**
    * Broadcast message to all connected peers (host only)
    */
    broadcastToAll(messageType, data, options = {}) {
        const protocolVersion = this.getNegotiatedProtocolVersion();
        if (!this._isLocalSenderAllowedForMessage(messageType, data, protocolVersion)) {
            this.packetStats.sendFailures += 1;
            console.warn(`Rejected outbound message type or sender role: ${messageType || 'unknown'}`);
            return;
        }
        if (!this.isHost && !PEER_BROADCAST_MESSAGE_TYPES.has(messageType)) {
            this.packetStats.sendFailures += 1;
            console.warn('Only the host can broadcast this message type');
            return;
        }
        if (!this.isHost && !this.sessionProtocolVersion) {
            this.packetStats.sendFailures += 1;
            console.warn(`Rejected outbound ${messageType || 'unknown'} before protocol negotiation`);
            return;
        }

        if (this.mockMode) {
            if (this.isHost) {
                this.connectedPeers.forEach((peerInfo, steamId) => {
                    if (!this.acceptedProtocolPeers.has(steamId)) return;
                    this._sendMessage(steamId, messageType, data, {
                        channel: 0,
                        delivery: 'reliable',
                        ...options,
                    });
                });
                return;
            }
            const envelope = this._buildEnvelope(messageType, data, {
                channel: 0,
                delivery: 'reliable',
                ...options,
            });
            this._sendEnvelope('all', messageType, envelope, {
                channel: 0,
                delivery: 'reliable',
                ...options,
            });

            if (SteamConfig.debugMode) {
                console.log('🧪 Mock broadcast:', messageType);
            }
            return;
        }

        this.connectedPeers.forEach((peerInfo, steamId) => {
            if (this.isHost && !this.acceptedProtocolPeers.has(steamId)) return;
            this._sendMessage(steamId, messageType, data, {
                channel: 0,
                delivery: 'reliable',
                ...options,
            });
        });
    }

    /**
     * @param {string} messageType
     * @param {StateSnapshot} data
    * @param {{skipPeers?: Set<string>|string[]}} [options]
     */
    broadcastSnapshot(messageType, data, options = {}) {
        if (!this._isLocalSenderAllowedForMessage(
            messageType,
            data,
            this.getNegotiatedProtocolVersion(),
        )) {
            this.packetStats.sendFailures += 1;
            console.warn(`Rejected outbound message type or sender role: ${messageType || 'unknown'}`);
            return;
        }
        if (!this.isHost) return;

        const protocolVersion = this.getNegotiatedProtocolVersion();
        const useRawSnapshotV2 = protocolVersion === PROTOCOL_V2;

        // Phase 4/6A: binary-v7 state is either retained in protocol 1's
        // JSON/base64 wrapper or carried byte-exactly by protocol 2's raw frame.
        /** @type {StateSnapshot|BinarySnapshotWrapperV7|Uint8Array} */
        let encodedData = data;
        let isBinary = false;
        let isRawSnapshot = false;
        let rawSnapshotKind = null;
        let snapshotPayloadBytes = 0;

        if (useRawSnapshotV2 && (!this.useBinaryEncoding || messageType !== MessageTypes.GAME_STATE_FULL)) {
            this.packetStats.sendFailures += 1;
            console.warn('Protocol-v2 snapshots require the binary raw-frame codec');
            return;
        }

        if (this.useBinaryEncoding && messageType === MessageTypes.GAME_STATE_FULL) {
            try {
                if (!this.binaryEncoder) {
                    this.binaryEncoder = getBinaryEncoder();
                }

                // DELTA ENCODING OPTIMIZATION
                let binaryBuffer;
                let usedDelta = false;
                const now = Date.now();
                const forceFullSnapshot = now - this.lastFullSnapshotAt >= this.fullSnapshotIntervalMs;

                if (this.lastKeyframeSnapshot && !forceFullSnapshot) {
                    // Delta relative to the last KEYFRAME (not the previous broadcast).
                    binaryBuffer = this.binaryEncoder.encodeDeltaSnapshot(data, this.lastKeyframeSnapshot);
                    if (binaryBuffer) {
                        usedDelta = true;
                    }
                }

                // Fallback to a full keyframe (first frame, player-list change, or due).
                if (!binaryBuffer) {
                    binaryBuffer = this.binaryEncoder.encodeSnapshot(data);
                    usedDelta = false;
                }

                snapshotPayloadBytes = binaryBuffer.byteLength;

                // Convert to base64 for JSON transport
                // The binary codec does NOT serialize lastInputSeq or roundGeneration.
                // Carry them in the JSON wrapper (like _digest) and re-attach on the
                // receiver. Without lastInputSeq the peer can't prune its input
                // history → it replays its whole history onto the board (glitches);
                // without roundGeneration a stale snapshot can clobber the next round.
                /** @type {Record<string, number>} */
                const acks = {};
                /** @type {number[]} */
                const positionalAcks = [];
                if (Array.isArray(data?.players)) {
                    for (const p of data.players) {
                        if (p && p.steamId != null && p.lastInputSeq != null) {
                            acks[p.steamId] = p.lastInputSeq;
                        }
                        if (useRawSnapshotV2) {
                            if (!Number.isInteger(p?.lastInputSeq)
                                || p.lastInputSeq < 0
                                || p.lastInputSeq > 0xffff_ffff) {
                                throw new RangeError('Protocol-v2 snapshots require one uint32 ACK per player');
                            }
                            positionalAcks.push(p.lastInputSeq);
                        }
                    }
                }
                if (useRawSnapshotV2) {
                    if (!this.matchNonce) {
                        throw new Error('Protocol-v2 snapshot session nonce is not bound');
                    }
                    const frameKind = usedDelta
                        ? SnapshotFrameKind.DELTA
                        : SnapshotFrameKind.FULL;
                    const logicalChannel = usedDelta ? 1 : 0;
                    encodedData = encodeSnapshotFrameV2({
                        kind: frameKind,
                        logicalChannel,
                        seq: this._nextSeq(logicalChannel),
                        sessionNonceTag: sessionNonceToTag(this.matchNonce),
                        roundGeneration: data?.roundGeneration,
                        migrationEpoch: data?.migrationEpoch,
                        digest: data?.digest,
                        acknowledgements: positionalAcks,
                        body: binaryBuffer,
                    });
                    isRawSnapshot = true;
                    rawSnapshotKind = usedDelta ? 'delta' : 'keyframe';
                } else {
                    encodedData = /** @satisfies {BinarySnapshotWrapperV7} */ ({
                        _binary: true,
                        _delta: usedDelta,
                        _data: this._arrayBufferToBase64(binaryBuffer),
                        _gen: data?.roundGeneration,
                        _migrationEpoch: data?.migrationEpoch,
                        _acks: acks,
                        // The digest is full-state even for a delta packet.
                        _digest: data?.digest,
                        _encodedSize: binaryBuffer.byteLength,
                    });
                }

                // ONLY a successfully framed full advances the delta baseline;
                // every later delta in the interval diffs against this keyframe.
                if (!usedDelta) {
                    this.lastFullSnapshotAt = now;
                    this.lastKeyframeSnapshot = data;
                }
                isBinary = true;
            } catch (err) {
                if (useRawSnapshotV2) {
                    this.packetStats.sendFailures += 1;
                    console.warn('Protocol-v2 snapshot encoding failed; JSON fallback is forbidden:', err);
                    return;
                }
                console.warn('Binary encoding failed, falling back to JSON:', err);
                encodedData = data;
            }
        }

        // A full snapshot (keyframe) is the recovery point for the delta stream, so
        // it MUST arrive: send it RELIABLE + immediately, bypassing backpressure.
        // Intermediate deltas stay unreliable_no_delay for lowest latency — a lost
        // delta now self-heals on the next guaranteed keyframe instead of stranding
        // the opponent board for up to a full keyframe interval.
        const binaryPayload = isBinary
            && !isRawSnapshot
            && !ArrayBuffer.isView(encodedData)
            && '_binary' in encodedData
            ? encodedData
            : null;
        const isKeyframe = isRawSnapshot
            ? rawSnapshotKind === 'keyframe'
            : binaryPayload?._delta === false;
        const skipPeers = options.skipPeers instanceof Set
            ? options.skipPeers
            : new Set(Array.isArray(options.skipPeers) ? options.skipPeers : []);

        this.connectedPeers.forEach((peerInfo, steamId) => {
            if (skipPeers.has(steamId) || !this.acceptedProtocolPeers.has(steamId)) return;
            if (isBinary) {
                if (isKeyframe) this.packetStats.keyframesSent += 1;
                else this.packetStats.deltasSent += 1;
            }
            const sendOptions = {
                isBinary,
                rawSnapshot: isRawSnapshot,
                snapshotKind: rawSnapshotKind,
                snapshotPayloadBytes,
            };
            if (isKeyframe) {
                this._sendMessage(steamId, messageType, encodedData, {
                    channel: 0,
                    delivery: 'reliable',
                    ...sendOptions,
                });
            } else {
                this._queueSnapshot(steamId, messageType, encodedData, {
                    ...options,
                    ...sendOptions,
                });
            }
        });
    }

    /**
     * Convert ArrayBuffer to base64 string
     */
    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Convert base64 string to ArrayBuffer
     */
    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
   * Start polling for incoming P2P packets
   */
    startP2PPolling() {
        if (this.mockMode) return;

        // Guard against a second init() orphaning the previous interval — that
        // would leak a 60Hz timer and double-process every incoming packet.
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        // Poll for P2P packets at 60Hz via steamworks.js preload API.
        // steamworks.js 0.4.0 P2P is single-channel: drain it each tick. The
        // logical channel rides inside the envelope (used for seq tracking), so
        // we don't need a per-channel transport here.
        this.pollInterval = setInterval(async () => {
            try {
                let packet = await ipcRenderer.invoke('steam:readP2PPacket');
                while (packet) {
                    this.handleP2PPacket(packet, 0);
                    packet = await ipcRenderer.invoke('steam:readP2PPacket');
                }
            } catch (err) {
                // Ignore polling errors
            }
        }, 16); // ~60Hz
    }

    /**
     * Stop the 60Hz P2P packet poll. Called when Online MP deactivates so the
     * cross-process IPC round-trips don't keep running for the rest of the
     * session in menus and other modes (audit SB-02). startP2PPolling()
     * re-arms it when the mode activates again; it must never be called while
     * a lobby or match is live (OnlineMultiplayerMode deactivation leaves the
     * lobby first).
     */
    stopP2PPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
   * Handle incoming P2P packet
   * Phase 4: Supports binary-encoded snapshots for bandwidth reduction
   */
    handleP2PPacket(packet, channel = 0) {
        try {
            const fromSteamId = packet.steamId;
            if (packet.data instanceof ArrayBuffer || ArrayBuffer.isView(packet.data)) {
                this._handleRawSnapshotPacket(
                    packet.data,
                    fromSteamId,
                    packet.wireBytes || this._packetByteLength(packet.data),
                );
                return;
            }
            const message = this._parsePacketData(packet.data);
            const envelope = this._normalizeEnvelope(message, fromSteamId);
            if (!envelope) return;

            if (!this._validateEnvelope(envelope, fromSteamId, channel)) {
                this.packetStats.validationFailures += 1;
                return;
            }
            if (envelope.msgType === MessageTypes.GAME_STATE_FULL) {
                this._recordSnapshotWireBytes(
                    'received',
                    packet.wireBytes || this._packetByteLength(packet.data),
                    this._snapshotWireKind(envelope),
                );
            }

            this._processEnvelope(envelope, fromSteamId, { trackPeer: true });
        } catch (err) {
            console.error('❌ Failed to parse P2P packet:', err);
            this.packetStats.decodeFailures += 1;
        }
    }

    _processEnvelope(envelope, fromSteamId, { trackPeer = false } = {}) {
        if (!this._hasInboundProtocolSession(fromSteamId, envelope.msgType)) {
            this.packetStats.validationFailures += 1;
            return this._rejectMessageRole(
                envelope.msgType,
                fromSteamId,
                'protocol negotiation incomplete',
            );
        }
        if (!this._isSenderAllowedForMessage(envelope.msgType, fromSteamId, envelope)) {
            this.packetStats.validationFailures += 1;
            return false;
        }

        this.packetStats.received += 1;

        if (trackPeer && !this.connectedPeers.has(fromSteamId)) {
            this.connectedPeers.set(fromSteamId, { steamId: fromSteamId });
            console.log(`✅ New peer connected: ${fromSteamId}`);
        }

        const decoded = this._decodeEnvelopePayload(envelope, fromSteamId);
        if (!decoded || decoded.drop === true) {
            return false;
        }

        this._dispatchEnvelope(envelope, fromSteamId, decoded.payload);
        return true;
    }

    _decodeEnvelopePayload(envelope, fromSteamId) {
        let { payload } = envelope;

        if (payload?._rawSnapshotV2) {
            return this._decodeRawSnapshotPayload(payload._rawSnapshotV2, fromSteamId);
        }

        if (payload && payload._binary === true && payload._data) {
            const wrapper = payload;
            try {
                if (!this.binaryDecoder) {
                    this.binaryDecoder = getBinaryDecoder();
                }
                const binaryBuffer = this._base64ToArrayBuffer(wrapper._data);
                this._recordSnapshotPayloadBytes(
                    'received',
                    wrapper._encodedSize || binaryBuffer.byteLength,
                );
                /** @type {BinaryStateSnapshotV7|null} */
                let packedSnapshot = null;
                if (wrapper._delta) {
                    this.packetStats.deltasReceived += 1;
                    const baseline = this.incomingSnapshotBaselines.get(fromSteamId);
                    if (!baseline) {
                        this.packetStats.missingBaselineDeltas += 1;
                        this._requestResync(fromSteamId, 'missing_delta_baseline');
                        return { drop: true };
                    }

                    const deltaBaselineTick = this.binaryDecoder.peekDeltaBaselineTick(binaryBuffer);
                    if (deltaBaselineTick != null && typeof baseline.tick === 'number') {
                        if (deltaBaselineTick < baseline.tick) {
                            this.packetStats.staleDeltasDropped += 1;
                            return { drop: true };
                        }
                        if (deltaBaselineTick > baseline.tick) {
                            this.packetStats.aheadOfBaselineDeltas += 1;
                            this._requestResync(fromSteamId, 'delta_ahead_of_baseline');
                            return { drop: true };
                        }
                    }

                    const decodedDelta = this.binaryDecoder.decodeDeltaSnapshot(binaryBuffer, baseline);
                    if (!decodedDelta) throw new Error('Decoded delta snapshot is empty');
                    packedSnapshot = decodedDelta;
                } else {
                    this.packetStats.keyframesReceived += 1;
                    const decodedSnapshot = this.binaryDecoder.decodeSnapshot(binaryBuffer);
                    if (!decodedSnapshot) throw new Error('Decoded keyframe snapshot is empty');
                    packedSnapshot = decodedSnapshot;
                    this.incomingSnapshotBaselines.set(fromSteamId, packedSnapshot);
                }
                payload = hydrateBinarySnapshot(packedSnapshot, {
                    digest: wrapper._digest,
                    roundGeneration: wrapper._gen,
                    migrationEpoch: wrapper._migrationEpoch,
                    acknowledgements: wrapper._acks,
                });
            } catch (err) {
                console.warn('Binary decoding failed, payload may be corrupted:', err);
                this.packetStats.decodeFailures += 1;
                if (wrapper._delta) {
                    this.packetStats.deltaDecodeFailures += 1;
                    this._requestResync(fromSteamId, 'delta_decode_failed');
                }
                return { drop: true };
            }
        }

        return { payload };
    }

    _decodeRawSnapshotPayload(frame, fromSteamId) {
        const isDelta = frame.kind === SnapshotFrameKind.DELTA;
        try {
            if (!this.binaryDecoder) {
                this.binaryDecoder = getBinaryDecoder();
            }
            const binaryBuffer = frame.body.slice().buffer;
            this._recordSnapshotPayloadBytes('received', binaryBuffer.byteLength);

            /** @type {BinaryStateSnapshotV7|null} */
            let packedSnapshot = null;
            if (isDelta) {
                this.packetStats.deltasReceived += 1;
                const baseline = this.incomingSnapshotBaselines.get(fromSteamId);
                if (!baseline) {
                    this.packetStats.missingBaselineDeltas += 1;
                    this._requestResync(fromSteamId, 'missing_delta_baseline');
                    return { drop: true };
                }

                const deltaBaselineTick = this.binaryDecoder.peekDeltaBaselineTick(binaryBuffer);
                if (deltaBaselineTick != null && typeof baseline.tick === 'number') {
                    if (deltaBaselineTick < baseline.tick) {
                        this.packetStats.staleDeltasDropped += 1;
                        return { drop: true };
                    }
                    if (deltaBaselineTick > baseline.tick) {
                        this.packetStats.aheadOfBaselineDeltas += 1;
                        this._requestResync(fromSteamId, 'delta_ahead_of_baseline');
                        return { drop: true };
                    }
                }

                packedSnapshot = this.binaryDecoder.decodeDeltaSnapshot(binaryBuffer, baseline);
                if (!packedSnapshot) throw new Error('Decoded protocol-v2 delta snapshot is empty');
            } else {
                this.packetStats.keyframesReceived += 1;
                packedSnapshot = this.binaryDecoder.decodeSnapshot(binaryBuffer);
                if (!packedSnapshot) throw new Error('Decoded protocol-v2 keyframe snapshot is empty');
            }

            if (packedSnapshot.players.length !== frame.acknowledgements.length) {
                throw new Error('Protocol-v2 acknowledgement/player count changed during decode');
            }
            /** @type {Record<string, number>} */
            const acknowledgements = {};
            packedSnapshot.players.forEach((player, index) => {
                acknowledgements[player.steamId] = frame.acknowledgements[index];
            });
            if (!isDelta) {
                this.incomingSnapshotBaselines.set(fromSteamId, packedSnapshot);
            }

            return {
                payload: hydrateBinarySnapshot(packedSnapshot, {
                    digest: frame.digest,
                    roundGeneration: frame.roundGeneration,
                    migrationEpoch: frame.migrationEpoch,
                    acknowledgements,
                }),
            };
        } catch (err) {
            console.warn('Protocol-v2 snapshot decoding failed:', err);
            this.packetStats.decodeFailures += 1;
            if (isDelta) {
                this.packetStats.deltaDecodeFailures += 1;
                this._requestResync(fromSteamId, 'delta_decode_failed');
            }
            return { drop: true };
        }
    }

    /** @param {string} fromSteamId @param {BinaryStateSnapshotV7} snapshot */
    setIncomingSnapshotBaseline(fromSteamId, snapshot) {
        if (!fromSteamId || !snapshot || typeof snapshot !== 'object') return;
        this.incomingSnapshotBaselines.set(fromSteamId, snapshot);
    }

    /** Drop a queued delta and make the next broadcast a reliable full keyframe. */
    forceNextSnapshotKeyframe(steamId) {
        const state = this.outgoingSnapshotState.get(steamId);
        if (state?.timer) clearTimeout(state.timer);
        if (state) {
            state.pending = null;
            state.timer = null;
        }
        this.lastKeyframeSnapshot = null;
        this.lastFullSnapshotAt = 0;
    }

    _dispatchEnvelope(envelope, fromSteamId, payload) {
        const handlers = this.messageHandlers.get(envelope.msgType);
        if (!handlers || handlers.length === 0) return;

        handlers.forEach((handler) => {
            try {
                handler({
                    from: fromSteamId,
                    type: envelope.msgType,
                    data: payload,
                    timestamp: envelope.sentAt,
                    seq: envelope.seq,
                    tick: envelope.tick,
                    protocolVersion: envelope.protocolVersion,
                    envelopeVersion: envelope.envelopeVersion,
                });
            } catch (err) {
                console.error('Error in message handler:', err);
            }
        });
    }

    // Note: on() method is defined at the end of the class (array-based version)

    /**
   * Leave current lobby
   */
    leaveLobby() {
        this._clearNetworkImpairmentTimers();
        if (!this.currentLobbyId) {
            this._resetLobbySession();
            this.isHost = false;
            return;
        }

        if (this.mockMode) {
            console.log(`🧪 Mock left lobby: ${this.currentLobbyId}`);

            // Close BroadcastChannel
            if (this.broadcastChannel) {
                this.broadcastChannel.close();
                this.broadcastChannel = null;
                console.log('   📡 Mock P2P channel closed');
            }

            // If host, remove lobby from localStorage
            if (this.isHost) {
                this.removeMockLobby(this.currentLobbyId);
                console.log('   📢 Lobby removed from localStorage');
            }

            this._resetLobbySession();
            this.isHost = false;
            return;
        }

        // Close all P2P connections via steamworks.js preload API
        this.connectedPeers.forEach((peerInfo, steamId) => {
            ipcRenderer.invoke('steam:closeP2PSession', steamId);
        });

        ipcRenderer.invoke('steam:leaveLobby');
        this._resetLobbySession();
        this.isHost = false;

        console.log('✅ Left lobby');
    }

    /**
   * Get list of lobbies (for lobby browser)
   */
    async getLobbies() {
        if (this.mockMode) {
            // Return mock lobbies from localStorage (shared across browser windows)
            const lobbies = this.loadMockLobbies();
            console.log(`🧪 Found ${lobbies.length} mock lobbies in localStorage`);
            return lobbies.map((lobby) => ({
                id: lobby.id,
                name: lobby.gameName,
                players: lobby.currentPlayers,
                maxPlayers: lobby.maxPlayers,
                hostName: lobby.hostName,
                endCondition: lobby.endCondition,
                endConditionValue: lobby.endConditionValue,
                // Surface the advertised lifecycle so the browser can show Join vs
                // "Join (next round)" / Watch for an in-progress match. Falls back to
                // capacity-derived status in the browser when absent (older entries).
                status: lobby.status,
            }));
        }

        // Real Steam mode via steamworks.js preload API
        try {
            const lobbies = await ipcRenderer.invoke('steam:getLobbies');
            return lobbies;
        } catch (err) {
            console.error('❌ Failed to get lobbies:', err);
            return [];
        }
    }

    /**
   * Cleanup on shutdown
   */
    shutdown() {
        this._clearNetworkImpairmentTimers();
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        this.stopHeartbeat();
        if (this._disconnectCheckInterval) {
            clearInterval(this._disconnectCheckInterval);
            this._disconnectCheckInterval = null;
        }
        this.incomingSnapshotBaselines.clear();
        this.lastResyncRequestAt.clear();
        this.lastKeyframeSnapshot = null;
        this.lastBroadcastSnapshot = null;
        this.outgoingSnapshotState.forEach((state) => {
            if (state?.timer) {
                clearTimeout(state.timer);
            }
        });
        this.outgoingSnapshotState.clear();
        this.leaveLobby();
    }

    /**
   * Save mock lobby to localStorage (for cross-window visibility)
   */
    saveMockLobby(lobbyData) {
        try {
            const lobbies = this.loadMockLobbies();
            lobbies.push(lobbyData);
            localStorage.setItem('serenity_mock_lobbies', JSON.stringify(lobbies));
        } catch (err) {
            console.warn('⚠️ Failed to save mock lobby to localStorage:', err);
        }
    }

    /**
   * Patch an existing mock lobby's fields in shared localStorage (cross-window).
   * No-op if the lobby isn't found.
   */
    updateMockLobby(lobbyId, patch) {
        try {
            const lobbies = this.loadMockLobbies();
            let changed = false;
            lobbies.forEach((lobby) => {
                if (lobby.id === lobbyId) {
                    Object.assign(lobby, patch);
                    changed = true;
                }
            });
            if (changed) {
                localStorage.setItem('serenity_mock_lobbies', JSON.stringify(lobbies));
            }
        } catch (err) {
            console.warn('⚠️ Failed to update mock lobby in localStorage:', err);
        }
    }

    /**
   * Advertise the current match lifecycle status ('open' | 'playing' | 'finished')
   * to the lobby list so browsers render Join / "Join (next round)" / Watch correctly.
   * Host-only in effect; safe no-op when there's no current lobby. Works for the mock
   * transport (localStorage) and best-effort for real Steam (lobby metadata).
   */
    setLobbyStatus(status) {
        if (!this.currentLobbyId || !status) return;
        if (this.mockMode) {
            this.updateMockLobby(this.currentLobbyId, { status });
            return;
        }
        try {
            ipcRenderer.invoke('steam:setLobbyData', this.currentLobbyId, 'status', String(status));
        } catch (err) {
            console.warn('⚠️ Failed to set lobby status:', err);
        }
    }

    /**
   * Advertise the current player count to the lobby list (drives the N/max display
   * and the "Full" vs "Join (next round)" decision for in-progress matches).
   */
    setLobbyPlayerCount(count) {
        if (!this.currentLobbyId || typeof count !== 'number') return;
        // Mock lobbies carry their own currentPlayers (read by getLobbies). Real Steam
        // reports the live member count via getMemberCount(), so there's nothing to write.
        if (this.mockMode) {
            this.updateMockLobby(this.currentLobbyId, { currentPlayers: count });
        }
    }

    /**
   * Load mock lobbies from localStorage
   */
    loadMockLobbies() {
        try {
            const stored = localStorage.getItem('serenity_mock_lobbies');
            if (!stored) return [];

            const lobbies = JSON.parse(stored);

            // Clean up old lobbies (older than 1 hour)
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            const validLobbies = lobbies.filter((lobby) => lobby.createdAt > oneHourAgo);

            // Save cleaned list
            if (validLobbies.length !== lobbies.length) {
                localStorage.setItem('serenity_mock_lobbies', JSON.stringify(validLobbies));
            }

            return validLobbies;
        } catch (err) {
            console.warn('⚠️ Failed to load mock lobbies from localStorage:', err);
            return [];
        }
    }

    /**
   * Remove mock lobby from localStorage
   */
    removeMockLobby(lobbyId) {
        try {
            const lobbies = this.loadMockLobbies();
            const filtered = lobbies.filter((lobby) => lobby.id !== lobbyId);
            localStorage.setItem('serenity_mock_lobbies', JSON.stringify(filtered));
        } catch (err) {
            console.warn('⚠️ Failed to remove mock lobby from localStorage:', err);
        }
    }

    /**
   * Clear all mock lobbies (for testing)
   */
    clearMockLobbies() {
        try {
            localStorage.removeItem('serenity_mock_lobbies');
            console.log('🧹 Cleared all mock lobbies from localStorage');
        } catch (err) {
            console.warn('⚠️ Failed to clear mock lobbies:', err);
        }
    }

    /**
   * Set up mock P2P communication using BroadcastChannel
   */
    setupMockP2P(lobbyId) {
        if (!this.mockMode) return;

        try {
            // Create a broadcast channel for this lobby
            const channelName = `serenity-lobby-${lobbyId}`;
            this.broadcastChannel = new BroadcastChannel(channelName);

            // Listen for messages from other windows
            this.broadcastChannel.onmessage = (event) => {
                const message = event.data;

                // Ignore messages from self
                if (message.from === this.steamId) return;

                // Only process messages meant for us or broadcasts
                if (message.to && message.to !== this.steamId && message.to !== 'all') return;

                // Handle the message
                this.handleMockP2PMessage(message);
            };

            console.log(`🧪 Mock P2P channel created: ${channelName}`);
        } catch (err) {
            console.warn('⚠️ Failed to create BroadcastChannel:', err);
        }
    }

    /**
   * Handle incoming mock P2P message
   * Phase 4: Supports binary-encoded snapshots
   */
    handleMockP2PMessage(message) {
        if (SteamConfig.debugMode) {
            console.log(`🧪 Mock received from ${message.from}:`, message.type);
        }

        if (message?.rawFrame != null) {
            this._handleRawSnapshotPacket(
                message.rawFrame,
                message.from,
                this._packetByteLength(message.rawFrame),
            );
            return;
        }

        const envelope = this._normalizeEnvelope(message, message.from);
        if (!envelope) return;
        if (!this._validateEnvelope(envelope, message.from, message.channel ?? 0)) {
            this.packetStats.validationFailures += 1;
            return;
        }
        if (envelope.msgType === MessageTypes.GAME_STATE_FULL) {
            this._recordSnapshotWireBytes(
                'received',
                this._packetByteLength(message),
                this._snapshotWireKind(envelope),
            );
        }
        this._processEnvelope(envelope, message.from, { trackPeer: true });
    }

    _handleRawSnapshotPacket(rawFrame, fromSteamId, wireBytes) {
        if (this.getNegotiatedProtocolVersion() !== PROTOCOL_V2
            || !this.matchNonce
            || !this._hasInboundProtocolSession(fromSteamId, MessageTypes.GAME_STATE_FULL)) {
            this.packetStats.validationFailures += 1;
            return false;
        }

        let frame;
        try {
            frame = decodeSnapshotFrameV2(rawFrame);
        } catch (err) {
            console.warn('Rejected malformed protocol-v2 snapshot frame:', err);
            this.packetStats.decodeFailures += 1;
            return false;
        }

        if (frame.sessionNonceTag !== sessionNonceToTag(this.matchNonce)) {
            this.packetStats.validationFailures += 1;
            return false;
        }

        const envelope = {
            envelopeVersion: this.envelopeVersion,
            msgType: MessageTypes.GAME_STATE_FULL,
            matchId: this.matchId,
            matchNonce: this.matchNonce,
            hostSteamId: this.hostSteamId,
            channel: frame.logicalChannel,
            seq: frame.seq,
            tick: null,
            sentAt: Date.now(),
            protocolVersion: PROTOCOL_V2,
            payload: { _rawSnapshotV2: frame },
        };
        if (!this._validateEnvelope(
            envelope,
            fromSteamId,
            frame.logicalChannel,
            { rawSnapshot: true },
        )) {
            this.packetStats.validationFailures += 1;
            return false;
        }

        this._recordSnapshotWireBytes(
            'received',
            wireBytes,
            frame.kind === SnapshotFrameKind.DELTA ? 'delta' : 'keyframe',
        );
        return this._processEnvelope(envelope, fromSteamId, { trackPeer: true });
    }

    /**
   * Register a message handler
   */
    on(messageType, handler) {
        if (!isSupportedInAnyProtocolVersion(messageType)) {
            console.warn(`Rejected handler registration for unsupported message type: ${messageType || 'unknown'}`);
            return false;
        }
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
        return true;
    }

    /**
   * Unregister a message handler
   */
    off(messageType, handler) {
        const handlers = this.messageHandlers.get(messageType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    getProtocolOffer() {
        const fallback = getLocalProtocolOffer();
        const selectableVersions = this._getSelectableProtocolVersions();
        return {
            minVersion: selectableVersions[0] ?? fallback.minVersion,
            maxVersion: selectableVersions.at(-1) ?? fallback.maxVersion,
            envelopeVersion: this.envelopeVersion,
            minEnvelopeVersion: this.envelopeVersion,
            maxEnvelopeVersion: this.envelopeVersion,
        };
    }

    negotiateProtocol(remoteOffer) {
        const selectableVersions = this.sessionProtocolVersion
            ? [this.sessionProtocolVersion]
            : this._getSelectableProtocolVersions();
        return negotiateProtocolVersion(remoteOffer, selectableVersions);
    }

    _getSelectableProtocolVersions() {
        return [...this.supportedProtocolVersions]
            .filter((version) => compareProtocolVersions(version, this.minProtocolVersion) >= 0)
            .sort(compareProtocolVersions);
    }

    lockProtocolSession(protocolVersion = this.sessionProtocolVersion ?? this.protocolVersion) {
        if (!this._getSelectableProtocolVersions().includes(protocolVersion)) return false;
        if (this.sessionProtocolVersion && this.sessionProtocolVersion !== protocolVersion) return false;
        this.sessionProtocolVersion = protocolVersion;
        return true;
    }

    acceptsProtocolSelection(selectedVersion, localOffer = this.getProtocolOffer()) {
        return acceptsProtocolSelection(
            selectedVersion,
            localOffer,
            this._getSelectableProtocolVersions(),
        );
    }

    setNegotiatedProtocol(peerSteamId, protocolVersion) {
        if (!peerSteamId || !this._getSelectableProtocolVersions().includes(protocolVersion)) return false;
        if (this.sessionProtocolVersion && this.sessionProtocolVersion !== protocolVersion) return false;
        this.sessionProtocolVersion = protocolVersion;
        this.acceptedProtocolPeers.add(peerSteamId);
        return true;
    }

    hasNegotiatedProtocol(peerSteamId) {
        return this.acceptedProtocolPeers.has(peerSteamId);
    }

    getNegotiatedProtocolVersion() {
        return this.sessionProtocolVersion ?? this.protocolVersion;
    }

    clearNegotiatedProtocol(peerSteamId) {
        this.acceptedProtocolPeers.delete(peerSteamId);
        if (!this.isHost && peerSteamId === this.hostSteamId) {
            this.sessionProtocolVersion = null;
        }
    }

    seedNegotiatedProtocolPeers(peerSteamIds) {
        if (!this.sessionProtocolVersion) return;
        for (const peerSteamId of peerSteamIds) {
            if (peerSteamId && peerSteamId !== this.steamId) {
                this.acceptedProtocolPeers.add(peerSteamId);
            }
        }
    }

    _resetProtocolSession() {
        this.sessionProtocolVersion = null;
        this.acceptedProtocolPeers.clear();
        this.sendSeqByChannel.clear();
        this.recvSeqByPeer.clear();
    }

    _resetLobbySession() {
        this._resetProtocolSession();
        this.connectedPeers.clear();
        this.matchId = null;
        this.matchNonce = null;
        this.hostSteamId = null;
        this.currentLobbyId = null;
        this.resetSnapshotBaselines();
    }

    _hasOutboundProtocolSession(targetSteamId, messageType) {
        if (isProtocolBootstrapMessageType(messageType)) return true;
        if (this.isHost) return this.acceptedProtocolPeers.has(targetSteamId);
        return Boolean(this.sessionProtocolVersion);
    }

    _hasInboundProtocolSession(fromSteamId, messageType) {
        if (isProtocolBootstrapMessageType(messageType)) return true;
        if (this.isHost) return this.acceptedProtocolPeers.has(fromSteamId);
        return Boolean(this.sessionProtocolVersion);
    }

    _buildEnvelope(messageType, data, options = {}) {
        const channel = options.channel ?? 0;
        const seq = this._nextSeq(channel);
        return {
            envelopeVersion: options.envelopeVersion ?? this.envelopeVersion,
            msgType: messageType,
            matchId: this.matchId,
            matchNonce: this.matchNonce,
            hostSteamId: this.hostSteamId,
            // Logical channel travels with the packet so the receiver can track
            // per-channel sequence numbers even though steamworks.js 0.4.0
            // delivers everything on one physical channel.
            channel,
            seq,
            tick: options.tick ?? data?.tick ?? null,
            sentAt: Date.now(),
            protocolVersion: options.protocolVersion
                ?? this.getNegotiatedProtocolVersion(),
            payload: data,
        };
    }

    _parsePacketData(data) {
        if (typeof data === 'string') {
            return JSON.parse(data);
        }

        if (data && typeof data === 'object' && (data.msgType || data.type)) {
            return data;
        }

        if (data && typeof data.toString === 'function') {
            return JSON.parse(data.toString());
        }

        throw new Error('Unsupported P2P packet payload');
    }

    _normalizeEnvelope(message, fromSteamId) {
        if (message?.msgType) {
            return message;
        }
        if (message?.type) {
            return {
                msgType: message.type,
                envelopeVersion: message.envelopeVersion ?? 1,
                matchId: message.matchId ?? null,
                matchNonce: message.matchNonce ?? null,
                hostSteamId: message.hostSteamId ?? null,
                channel: message.channel ?? 0,
                seq: message.seq ?? 0,
                tick: message.tick ?? null,
                sentAt: message.timestamp ?? Date.now(),
                protocolVersion: message.protocolVersion ?? null,
                payload: message.data,
            };
        }
        console.warn('⚠️ Unknown packet format from', fromSteamId);
        return null;
    }

    _isLocalSenderAllowedForMessage(messageType, data, protocolVersion = this.protocolVersion) {
        const entry = getProtocolEntry(messageType, protocolVersion);
        if (!entry || entry.status !== 'supported') return false;

        return entry.routes.some((route) => {
            if (route.sender === 'host') return this.isHost;
            if (route.sender === 'peer') return !this.isHost;
            return Boolean(
                this.isHost
                && this.steamId
                && this.hostSteamId === this.steamId
                && data?.newHostId === this.steamId,
            );
        });
    }

    _isSenderAllowedForMessage(messageType, fromSteamId, envelope = null) {
        const protocolVersion = envelope?.protocolVersion
            ?? this.getNegotiatedProtocolVersion();
        const entry = getProtocolEntry(messageType, protocolVersion);
        if (!entry || entry.status !== 'supported') {
            return this._rejectMessageRole(messageType, fromSteamId, 'unsupported or undeclared type');
        }

        const receiverRole = this.isHost ? 'host' : 'peer';
        const allowed = entry.routes.some((route) => {
            if (route.receiver !== receiverRole) return false;
            if (route.sender === 'host') {
                return Boolean(this.hostSteamId && fromSteamId === this.hostSteamId);
            }
            if (route.sender === 'peer') {
                return Boolean(fromSteamId && fromSteamId !== this.hostSteamId);
            }
            return Boolean(
                fromSteamId
                && envelope?.payload?.newHostId === fromSteamId
                && envelope?.hostSteamId === fromSteamId,
            );
        });

        if (!allowed) {
            return this._rejectMessageRole(messageType, fromSteamId, 'role mismatch');
        }
        return true;
    }

    _rejectMessageRole(messageType, fromSteamId, reason) {
        const key = messageType || 'unknown';
        const drops = this.packetStats.roleValidationDropsByType;
        drops[key] = (drops[key] || 0) + 1;
        console.warn(`Rejected ${key} from ${fromSteamId || 'unknown'}: ${reason}`);
        return false;
    }

    _validateEnvelope(envelope, fromSteamId, channel, { rawSnapshot = false } = {}) {
        const isNegotiationMessage = isProtocolBootstrapMessageType(envelope.msgType);
        // A successor may send SYNC before this peer receives CLAIM (Steam is
        // ordered, but the deterministic impairment harness intentionally is
        // not). Admit only the host-id transition here: match identity, nonce,
        // protocol, receiver role, sender identity, election, and epoch are all
        // still checked by the normal transport/role/FFA gates.
        const isSelfIdentifyingSuccessorSync = Boolean(
            !this.isHost
            && envelope.msgType === MessageTypes.GAME_HOST_MIGRATION_SYNC
            && fromSteamId
            && envelope.payload?.newHostId === fromSteamId
            && envelope.hostSteamId === fromSteamId,
        );
        if (envelope.envelopeVersion !== this.envelopeVersion && !isNegotiationMessage) {
            this._sendNetError(fromSteamId, 'ENVELOPE_MISMATCH', envelope.msgType);
            return false;
        }
        if (!envelope.protocolVersion) {
            return false;
        }
        const expectedProtocolVersion = this.getNegotiatedProtocolVersion();
        if (envelope.protocolVersion !== expectedProtocolVersion && !isNegotiationMessage) {
            this._sendNetError(fromSteamId, 'PROTOCOL_MISMATCH', envelope.msgType);
            return false;
        }
        if (envelope.msgType === MessageTypes.GAME_STATE_FULL) {
            const expectsRawSnapshot = expectedProtocolVersion === PROTOCOL_V2;
            if (rawSnapshot !== expectsRawSnapshot) {
                this._sendNetError(fromSteamId, 'SNAPSHOT_CODEC_MISMATCH', envelope.msgType);
                return false;
            }
        }

        const hasBoundSession = Boolean(this.matchId && this.matchNonce && this.hostSteamId);
        if (hasBoundSession && !isNegotiationMessage) {
            if (envelope.matchId !== this.matchId
                || envelope.matchNonce !== this.matchNonce
                || (envelope.hostSteamId !== this.hostSteamId && !isSelfIdentifyingSuccessorSync)) {
                // Previously a SILENT 100% drop — the root of "lose connection mid-match
                // with the Steam session still open" (split-brain after a false host
                // migration: the peer promoted itself and rewrote its own hostSteamId, so
                // every cross-host packet now mismatches). Throttled-warn so it's
                // diagnosable instead of an invisible blackhole.
                const reason = envelope.matchId !== this.matchId ? 'matchId'
                    : (envelope.matchNonce !== this.matchNonce ? 'matchNonce' : 'hostSteamId');
                const now = Date.now();
                this._envDropWarn = this._envDropWarn || {};
                if (!this._envDropWarn[reason] || now - this._envDropWarn[reason] > 2000) {
                    this._envDropWarn[reason] = now;
                    console.warn(`[Net] DROP inbound pkt from ${fromSteamId}: ${reason} mismatch `
                        + `(msgType=${envelope.msgType}, theirs=${envelope[reason]}, ours=${this[reason]}) `
                        + '— possible host split-brain (throttled 1/2s).');
                }
                return false;
            }
        }

        // Key replay/ordering by the LOGICAL channel carried in the envelope, not
        // the physical transport channel — steamworks.js 0.4.0 delivers all packets
        // on a single channel, so per-channel sender seq counters would otherwise
        // collide on one key and drop ~half the traffic. (In mock mode the two are
        // equal, so existing behavior is unchanged.)
        const seqKey = `${fromSteamId}:${envelope.channel ?? channel}`;
        const lastSeq = this.recvSeqByPeer.get(seqKey) ?? -1;
        if (typeof envelope.seq === 'number' && envelope.seq <= lastSeq) {
            return false;
        }
        if (typeof envelope.seq === 'number') {
            this.recvSeqByPeer.set(seqKey, envelope.seq);
        }
        return true;
    }

    _sendNetError(targetSteamId, code, originalMsgType) {
        const payload = {
            code,
            message: `Protocol error: ${code}`,
            originalMsgType,
        };
        this.sendP2PMessage(targetSteamId, MessageTypes.NET_ERROR, payload);
    }

    /**
     * Ask the current host for a full-state resync, at most once per keyframe
     * interval. This is peer-only and target-bound: a stale host ID cannot receive
     * recovery traffic after authority changes.
     * @param {string} hostSteamId
     * @param {string} reason
     * @returns {boolean} true when a request was admitted and sent
     */
    requestResync(hostSteamId, reason) {
        if (this.isHost !== false
            || typeof hostSteamId !== 'string'
            || hostSteamId.length === 0
            || hostSteamId !== this.hostSteamId
            || hostSteamId === this.steamId) return false;

        const now = Date.now();
        const last = this.lastResyncRequestAt.get(hostSteamId);
        if (last !== undefined && now - last < this.fullSnapshotIntervalMs) {
            this.packetStats.resyncRequestsSuppressed += 1;
            return false;
        }
        this.lastResyncRequestAt.set(hostSteamId, now);
        this.packetStats.resyncRequestsSent += 1;
        this.sendP2PMessage(hostSteamId, MessageTypes.GAME_STATE_RESYNC_ACK, {
            requestResync: true,
            reason,
        });
        return true;
    }

    /**
     * Decoder compatibility alias. New external recovery triggers use the public
     * role-checked requestResync() boundary.
     * @param {string} fromSteamId
     * @param {string} reason
     * @returns {boolean}
     */
    _requestResync(fromSteamId, reason) {
        return this.requestResync(fromSteamId, reason);
    }

    /**
     * Force the next outgoing snapshot to be a full KEYFRAME and discard stale
     * receive baselines. MUST be called on a round restart: otherwise the host's
     * first post-restart packet is a DELTA encoded against the PRE-restart keyframe
     * (hostTick is monotonic, so the baseline-tick guard doesn't catch it), and the
     * peer decodes round-2 state against round-1 data → corrupted/frozen peer board.
     */
    resetSnapshotBaselines() {
        this.lastKeyframeSnapshot = null;
        this.lastBroadcastSnapshot = null;
        this.lastFullSnapshotAt = 0;
        this.incomingSnapshotBaselines.clear();
        this.lastResyncRequestAt.clear();
    }

    setNetworkImpairment(config = {}) {
        this._clearNetworkImpairmentTimers();
        this.networkImpairment.setConfig(config);
    }

    getNetworkImpairmentStats() {
        return this.networkImpairment.getStats();
    }

    _clearNetworkImpairmentTimers() {
        if (!this.networkImpairmentTimers) return;
        this.networkImpairmentTimers.forEach((timer) => clearTimeout(timer));
        this.networkImpairmentTimers.clear();
    }

    _nextSeq(channel) {
        const current = this.sendSeqByChannel.get(channel) ?? 0;
        const next = current + 1;
        this.sendSeqByChannel.set(channel, next);
        return next;
    }

    _resolveDelivery(delivery) {
        // Steam P2P send types (matches steamworks.js constants)
        // 0 = Unreliable, 1 = UnreliableNoDelay, 2 = Reliable, 3 = ReliableWithBuffering
        switch (delivery) {
        case 'unreliable':
            return 0;
        case 'unreliable_no_delay':
            return 1;
        case 'reliable':
        default:
            return 2;
        }
    }

    /**
     * Phase 4: Queue snapshot with backpressure support
     *
     * Backpressure rules:
     * - Per-peer queue cap = 2 snapshots (drop oldest, keep latest)
     * - Adaptive throttling: 30Hz → 20Hz → 10Hz based on drop rate
     * - Restore to 30Hz when queue stabilizes
     */
    _queueSnapshot(steamId, messageType, data, options = {}) {
        const state = this.outgoingSnapshotState.get(steamId) || {
            pending: null,
            lastSendAt: 0,
            minInterval: 1000 / 30, // Start at 30Hz
            dropCount: 0,
            windowStart: Date.now(),
            timer: null,
            // Phase 4: Backpressure metrics
            totalDropped: 0,
            totalSent: 0,
            sentThisWindow: 0,
            currentRate: 30,
        };

        const now = Date.now();
        const elapsed = now - state.lastSendAt;

        // Check if we can send immediately
        if (elapsed >= state.minInterval && !state.timer) {
            this._sendMessage(steamId, messageType, data, {
                channel: 1,
                delivery: 'unreliable_no_delay',
                ...options,
            });
            state.lastSendAt = now;
            state.totalSent++;
            state.sentThisWindow = (state.sentThisWindow || 0) + 1;
            // Rate restoration is now time-based (see the window-reset block), which
            // recovers reliably instead of needing 30 uninterrupted successes.
        } else {
            // Queue is building up - apply backpressure
            if (state.pending) {
                // Drop the OLD pending snapshot, keep the NEW one (latest state)
                state.dropCount++;
                state.totalDropped++;
            }

            // Store the latest snapshot
            state.pending = { msgType: messageType, payload: data, options };

            // Schedule send if not already scheduled
            if (!state.timer) {
                const delay = Math.max(0, state.minInterval - elapsed);
                state.timer = setTimeout(() => {
                    if (state.pending) {
                        this._sendMessage(
                            steamId,
                            state.pending.msgType,
                            state.pending.payload,
                            {
                                channel: 1,
                                delivery: 'unreliable_no_delay',
                                ...state.pending.options,
                            },
                        );
                        state.lastSendAt = Date.now();
                        state.totalSent++;
                        state.sentThisWindow = (state.sentThisWindow || 0) + 1;
                        state.pending = null;
                    }
                    state.timer = null;
                }, delay);
            }
        }

        // Reset window stats every second + adapt the rate.
        if (now - state.windowStart > 1000) {
            const sent = state.sentThisWindow || 0;
            // Real drop-rate (the old formula algebraically collapsed to a constant).
            const dropRate = state.dropCount / Math.max(1, state.dropCount + sent);

            if (state.dropCount >= 5 || dropRate > 0.3) {
                // Heavy congestion → floor at 20Hz (never the old 10Hz pin, which
                // combined with the delta stream to strand boards).
                state.currentRate = 20;
            } else if (state.dropCount >= 2 || dropRate > 0.1) {
                state.currentRate = 25;
            } else if (state.dropCount === 0 && state.currentRate < 30) {
                // Clean window → restore one tier toward 30Hz. Time-based recovery
                // can't get pinned the way the old 30-consecutive-success gate did.
                state.currentRate = state.currentRate >= 25 ? 30 : 25;
            }
            state.minInterval = 1000 / state.currentRate;

            state.dropCount = 0;
            state.sentThisWindow = 0;
            state.windowStart = now;
        }

        this.outgoingSnapshotState.set(steamId, state);
    }

    /**
     * Phase 4: Get backpressure stats for all peers
     */
    getBackpressureStats() {
        const stats = {};
        for (const [steamId, state] of this.outgoingSnapshotState) {
            stats[steamId] = {
                currentRate: state.currentRate || 30,
                totalSent: state.totalSent || 0,
                totalDropped: state.totalDropped || 0,
                dropRate: state.totalSent > 0
                    ? `${((state.totalDropped / state.totalSent) * 100).toFixed(1)}%`
                    : '0%',
            };
        }
        return stats;
    }

    _recordSnapshotWireBytes(direction, byteLength, kind = null) {
        if (!Number.isFinite(byteLength) || byteLength <= 0) return;
        const key = direction === 'sent' ? 'snapshotWireBytesSent' : 'snapshotWireBytesReceived';
        const keys = [key];
        if (kind === 'delta') {
            keys.push(direction === 'sent'
                ? 'snapshotDeltaWireBytesSent'
                : 'snapshotDeltaWireBytesReceived');
        } else if (kind === 'keyframe') {
            keys.push(direction === 'sent'
                ? 'snapshotKeyframeWireBytesSent'
                : 'snapshotKeyframeWireBytesReceived');
        }
        for (const sampleKey of keys) {
            this._recordByteSample(sampleKey, byteLength);
        }
    }

    _recordSnapshotPayloadBytes(direction, byteLength) {
        const key = direction === 'sent' ? 'snapshotPayloadBytesSent' : 'snapshotPayloadBytesReceived';
        this._recordByteSample(key, byteLength);
    }

    _recordByteSample(key, byteLength) {
        if (!Number.isFinite(byteLength) || byteLength <= 0) return;
        const samples = this.packetStats[key] || [];
        samples.push(byteLength);
        if (samples.length > 120) {
            samples.splice(0, samples.length - 120);
        }
        this.packetStats[key] = samples;
    }

    _snapshotWireKind(envelope) {
        if (envelope?.msgType !== MessageTypes.GAME_STATE_FULL) return null;
        return envelope.payload?._binary === true && envelope.payload?._delta === true
            ? 'delta'
            : 'keyframe';
    }

    /** @param {unknown} data */
    _packetByteLength(data) {
        if (typeof data === 'string') {
            return new TextEncoder().encode(data).byteLength;
        }
        if (data instanceof ArrayBuffer) return data.byteLength;
        if (ArrayBuffer.isView(data)) return data.byteLength;
        try {
            return new TextEncoder().encode(JSON.stringify(data)).byteLength;
        } catch {
            return 0;
        }
    }

    _snapshotByteSummary(samples = []) {
        if (!Array.isArray(samples) || samples.length === 0) {
            return {
                count: 0, p50: 0, p95: 0, max: 0,
            };
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
        return {
            count: sorted.length,
            p50: percentile(0.50),
            p95: percentile(0.95),
            max: sorted[sorted.length - 1],
        };
    }

    getPacketStats() {
        const {
            snapshotWireBytesSent,
            snapshotWireBytesReceived,
            snapshotDeltaWireBytesSent,
            snapshotDeltaWireBytesReceived,
            snapshotKeyframeWireBytesSent,
            snapshotKeyframeWireBytesReceived,
            snapshotPayloadBytesSent,
            snapshotPayloadBytesReceived,
            ...counters
        } = this.packetStats;
        return {
            ...counters,
            // Backward-compatible names now report actual application-wire bytes,
            // not the inner binary payload size.
            snapshotBytesSent: this._snapshotByteSummary(snapshotWireBytesSent),
            snapshotBytesReceived: this._snapshotByteSummary(snapshotWireBytesReceived),
            snapshotWireBytesSent: this._snapshotByteSummary(snapshotWireBytesSent),
            snapshotWireBytesReceived: this._snapshotByteSummary(snapshotWireBytesReceived),
            snapshotDeltaWireBytesSent: this._snapshotByteSummary(snapshotDeltaWireBytesSent),
            snapshotDeltaWireBytesReceived: this._snapshotByteSummary(snapshotDeltaWireBytesReceived),
            snapshotKeyframeWireBytesSent: this._snapshotByteSummary(snapshotKeyframeWireBytesSent),
            snapshotKeyframeWireBytesReceived: this._snapshotByteSummary(snapshotKeyframeWireBytesReceived),
            snapshotPayloadBytesSent: this._snapshotByteSummary(snapshotPayloadBytesSent),
            snapshotPayloadBytesReceived: this._snapshotByteSummary(snapshotPayloadBytesReceived),
            netImpairment: this.getNetworkImpairmentStats(),
            connectedPeers: this.connectedPeers.size,
            pendingOutgoingSnapshots: Array.from(this.outgoingSnapshotState.values())
                .filter((state) => state?.pending).length,
        };
    }

    _generateMatchNonce() {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const bytes = new Uint8Array(8);
            crypto.getRandomValues(bytes);
            return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
        return Math.random().toString(16).slice(2) + Date.now().toString(16);
    }

    createHandshakeNonce() {
        return this._generateMatchNonce();
    }

    refreshMatchSession() {
        this.lockProtocolSession();
        this.matchNonce = this._generateMatchNonce();
        return {
            matchId: this.matchId,
            matchNonce: this.matchNonce,
            hostSteamId: this.hostSteamId,
            protocolVersion: this.sessionProtocolVersion ?? this.protocolVersion,
        };
    }

    // ============================================
    // Phase 4: Heartbeat and Disconnect Detection
    // ============================================

    /**
     * Start sending heartbeats (host only)
     * Heartbeats allow peers to detect if the host has disconnected
     */
    startHeartbeat() {
        if (!this.isHost) {
            console.warn('Only host should send heartbeats');
            return;
        }

        this.stopHeartbeat(); // Clear any existing

        this.heartbeatInterval = setInterval(() => {
            this.broadcastToAll(MessageTypes.NET_HEARTBEAT, {
                timestamp: Date.now(),
                hostSteamId: this.steamId,
            });
        }, this.heartbeatRate);

        console.log('💓 Heartbeat started (every 2s)');
    }

    /**
     * Stop sending heartbeats
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Handle incoming heartbeat (peer only)
     * @param {string} fromSteamId - Steam ID of the sender
     */
    handleHeartbeat(fromSteamId) {
        this.lastHeartbeatReceived.set(fromSteamId, Date.now());
    }

    /**
     * Check for timed-out peers
     * @returns {Array<string>} Array of Steam IDs that have timed out
     */
    checkForTimeouts() {
        const now = Date.now();
        const timedOut = [];

        for (const [steamId, lastHeartbeat] of this.lastHeartbeatReceived) {
            if (now - lastHeartbeat > this.heartbeatTimeout) {
                timedOut.push(steamId);
            }
        }

        return timedOut;
    }

    /**
     * Check if host has disconnected (peer only)
     * @returns {boolean} True if host appears disconnected
     */
    isHostDisconnected() {
        if (this.isHost) return false;
        if (!this.hostSteamId) return false;

        const lastHeartbeat = this.lastHeartbeatReceived.get(this.hostSteamId);
        if (!lastHeartbeat) return false; // No heartbeat received yet

        return (Date.now() - lastHeartbeat) > this.heartbeatTimeout;
    }

    /**
     * Register a callback for disconnect events
     * @param {Function} callback - Called with (steamId, reason)
     */
    onDisconnect(callback) {
        this.disconnectCallbacks.push(callback);
    }

    /**
     * Trigger disconnect callbacks
     * @param {string} steamId - Disconnected peer's Steam ID
     * @param {string} reason - Reason for disconnect
     */
    _triggerDisconnect(steamId, reason) {
        for (const callback of this.disconnectCallbacks) {
            try {
                callback(steamId, reason);
            } catch (err) {
                console.error('Error in disconnect callback:', err);
            }
        }
    }

    /**
     * Start monitoring for peer disconnects
     * Call this after joining a lobby
     */
    startDisconnectMonitoring() {
        // Initialize heartbeat timestamp for host
        if (!this.isHost && this.hostSteamId) {
            this.lastHeartbeatReceived.set(this.hostSteamId, Date.now());
        }

        // Register heartbeat handler
        if (!this._heartbeatHandlerRegistered) {
            this.on(MessageTypes.NET_HEARTBEAT, (msg) => {
                this.handleHeartbeat(msg.from);
            });
            this._heartbeatHandlerRegistered = true;
        }

        // Start periodic timeout check (every second)
        if (!this._disconnectCheckInterval) {
            this._disconnectCheckInterval = setInterval(() => {
                if (!this.isHost && this.isHostDisconnected()) {
                    console.warn('⚠️ Host appears disconnected!');
                    this._triggerDisconnect(this.hostSteamId, 'timeout');
                }

                // For host: check for timed out peers
                if (this.isHost) {
                    const timedOut = this.checkForTimeouts();
                    for (const steamId of timedOut) {
                        console.warn(`⚠️ Peer ${steamId} timed out`);
                        this._triggerDisconnect(steamId, 'timeout');
                        this.lastHeartbeatReceived.delete(steamId);
                    }
                }
            }, 1000);
        }

        console.log('👁️ Disconnect monitoring started');
    }

    /**
     * Stop disconnect monitoring
     */
    stopDisconnectMonitoring() {
        if (this._disconnectCheckInterval) {
            clearInterval(this._disconnectCheckInterval);
            this._disconnectCheckInterval = null;
        }
        this.lastHeartbeatReceived.clear();
    }

    /**
     * Get heartbeat status for all known peers
     */
    getHeartbeatStatus() {
        const now = Date.now();
        const status = {};

        for (const [steamId, lastHeartbeat] of this.lastHeartbeatReceived) {
            const age = now - lastHeartbeat;
            status[steamId] = {
                lastHeartbeat,
                age,
                healthy: age < this.heartbeatTimeout,
                warning: age > this.heartbeatTimeout / 2,
            };
        }

        return status;
    }
}
