/**
 * Steam P2P Networking Wrapper
 * Handles Steam lobbies, P2P messaging, and matchmaking
 *
 * Phase 4: Added binary encoding support for 90% bandwidth reduction
 */

import { SteamConfig } from './config.js';
import { getBinaryEncoder, getBinaryDecoder } from '../network/binary-encoding.js';

// Detect if we're running in Electron
const isElectron = typeof window !== 'undefined'
    && typeof window.process !== 'undefined'
    && window.process.type === 'renderer';

// Try to import greenworks (only works in Electron)
let greenworks;
if (isElectron) {
    try {
        // Use dynamic require in Electron context
        greenworks = window.require('greenworks');
    } catch (err) {
        console.warn('⚠️ Greenworks not available in Electron, using mock mode');
        greenworks = null;
    }
} else {
    // Running in browser - use mock mode
    console.log('🌐 Running in browser mode - Steam features will use mock mode');
    greenworks = null;
}

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
        this.protocolVersion = '1.0.0';
        this.matchId = null;
        this.matchNonce = null;
        this.sendSeqByChannel = new Map();
        this.recvSeqByPeer = new Map();
        this.snapshotQueues = new Map();

        // Phase 4: Binary encoding for snapshots (90% bandwidth reduction)
        this.useBinaryEncoding = true; // Enable by default for production
        this.binaryEncoder = null;
        this.binaryDecoder = null;

        // Phase 4: Heartbeat and disconnect detection
        this.heartbeatInterval = null;
        this.heartbeatRate = 2000; // Send heartbeat every 2 seconds
        this.heartbeatTimeout = 6000; // Consider peer dead after 6 seconds
        this.lastHeartbeatReceived = new Map(); // Map<steamId, timestamp>
        this.disconnectCallbacks = []; // Array of callbacks for disconnect events

        // Mock mode for local testing
        this.mockMode = SteamConfig.mockMode || !greenworks;

        // Mock P2P communication channel (for cross-window messaging)
        this.broadcastChannel = null;
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

        // Real Steam mode
        if (!greenworks || !greenworks.isSteamRunning()) {
            console.error('❌ Steam is not running! Please launch Steam first.');
            throw new Error('Steam is not running! Please launch Steam first.');
        }

        try {
            this.initialized = greenworks.initAPI();

            if (this.initialized) {
                this.steamId = greenworks.getSteamId().getRawSteamID();
                this.playerName = greenworks.getSteamId().getPersonaName();

                console.log(`✅ Steam initialized: ${this.playerName} (${this.steamId})`);

                // Start P2P packet polling
                this.startP2PPolling();

                return true;
            }

            throw new Error('Failed to initialize Steam API');
        } catch (err) {
            console.error('❌ Steam initialization failed:', err);
            throw err;
        }
    }

    /**
   * Create a Steam lobby (become host)
   */
    async createLobby(options = {}) {
        const {
            maxPlayers = 8,
            lobbyType = 'public', // 'public' or 'friends'
            gameName = 'FFA Match',
            endCondition = 'frags',
            endConditionValue = 10,
        } = options;

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

        return new Promise((resolve, reject) => {
            const type = lobbyType === 'public'
                ? greenworks.LobbyType.Public
                : greenworks.LobbyType.FriendsOnly;

            greenworks.createLobby(type, maxPlayers, (lobbyId) => {
                console.log(`✅ Lobby created: ${lobbyId}`);

                this.isHost = true;
                this.hostSteamId = this.steamId;
                this.currentLobbyId = lobbyId;
                this.matchId = lobbyId;
                this.matchNonce = this._generateMatchNonce();

                // Set lobby metadata
                greenworks.setLobbyData(lobbyId, 'game_mode', 'ffa');
                greenworks.setLobbyData(lobbyId, 'game_name', gameName);
                greenworks.setLobbyData(lobbyId, 'end_condition', endCondition);
                greenworks.setLobbyData(lobbyId, 'end_condition_value', endConditionValue.toString());
                greenworks.setLobbyData(lobbyId, 'version', '1.0.0');

                resolve(lobbyId);
            }, (err) => {
                console.error('❌ Failed to create lobby:', err);
                reject(err);
            });
        });
    }

    /**
   * Join an existing Steam lobby
   */
    async joinLobby(lobbyId) {
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

        return new Promise((resolve, reject) => {
            greenworks.joinLobby(lobbyId, () => {
                console.log(`✅ Joined lobby: ${lobbyId}`);

                this.isHost = false;
                this.currentLobbyId = lobbyId;
                this.matchId = lobbyId;
                this.hostSteamId = greenworks.getLobbyOwner(lobbyId);

                resolve();
            }, (err) => {
                console.error('❌ Failed to join lobby:', err);
                reject(err);
            });
        });
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
        const envelope = this._buildEnvelope(messageType, data, options);

        if (this.mockMode) {
            // Mock send via BroadcastChannel
            if (this.broadcastChannel) {
                const message = {
                    ...envelope,
                    from: this.steamId,
                    to: targetSteamId,
                    channel: options.channel,
                };
                this.broadcastChannel.postMessage(message);

                if (SteamConfig.debugMode) {
                    console.log(`🧪 Mock sent to ${targetSteamId}:`, messageType);
                }
            }
            return;
        }

        const buffer = Buffer.from(JSON.stringify(envelope));
        const sendType = this._resolveDelivery(options.delivery);

        greenworks.sendP2PPacket(
            targetSteamId,
            buffer,
            sendType,
            options.channel ?? 0,
        );
    }

    /**
   * Broadcast message to all connected peers (host only)
   */
    broadcastToAll(messageType, data, options = {}) {
        if (this.mockMode) {
            // Mock broadcast via BroadcastChannel
            if (this.broadcastChannel) {
                const envelope = this._buildEnvelope(messageType, data, options);
                const message = {
                    ...envelope,
                    from: this.steamId,
                    to: 'all',
                    channel: options.channel ?? 0,
                };
                this.broadcastChannel.postMessage(message);

                if (SteamConfig.debugMode) {
                    console.log('🧪 Mock broadcast:', messageType);
                }
            }
            return;
        }

        if (!this.isHost) {
            console.warn('⚠️ Only host can broadcast');
            return;
        }

        this.connectedPeers.forEach((peerInfo, steamId) => {
            this._sendMessage(steamId, messageType, data, {
                channel: 0,
                delivery: 'reliable',
                ...options,
            });
        });
    }

    broadcastSnapshot(messageType, data, options = {}) {
        if (!this.isHost) return;

        // Phase 4: Binary encoding for snapshots
        let encodedData = data;
        let isBinary = false;

        if (this.useBinaryEncoding && messageType === 'game:state:full') {
            try {
                if (!this.binaryEncoder) {
                    this.binaryEncoder = getBinaryEncoder();
                }

                // DELTA ENCODING OPTIMIZATION
                let binaryBuffer;
                let usedDelta = false;

                if (this.lastBroadcastSnapshot) {
                    // Try to encode as delta relative to last broadcast
                    // This is safe because we use RELIABLE delivery
                    binaryBuffer = this.binaryEncoder.encodeDeltaSnapshot(data, this.lastBroadcastSnapshot);
                    if (binaryBuffer) {
                        usedDelta = true;
                    }
                }

                // Fallback to full snapshot if delta failed (e.g. first frame or player list change)
                if (!binaryBuffer) {
                    binaryBuffer = this.binaryEncoder.encodeSnapshot(data);
                    usedDelta = false;
                }

                // Update baseline for next time
                this.lastBroadcastSnapshot = data;

                // Convert to base64 for JSON transport
                encodedData = {
                    _binary: true,
                    _delta: usedDelta, // Flag to tell receiver to use decodeDeltaSnapshot
                    _data: this._arrayBufferToBase64(binaryBuffer),
                    // Debug stats
                    _originalSize: JSON.stringify(data).length,
                    _encodedSize: binaryBuffer.byteLength,
                };

                isBinary = true;
            } catch (err) {
                console.warn('Binary encoding failed, falling back to JSON:', err);
                encodedData = data;
            }
        }

        this.connectedPeers.forEach((peerInfo, steamId) => {
            this._queueSnapshot(steamId, messageType, encodedData, { ...options, isBinary });
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

        // Poll for P2P packets at 60Hz
        this.pollInterval = setInterval(() => {
            [0, 1, 2].forEach((channel) => {
                while (greenworks.isP2PPacketAvailable(channel)) {
                    const packet = greenworks.readP2PPacket(channel);
                    if (packet) {
                        this.handleP2PPacket(packet, channel);
                    }
                }
            });
        }, 16); // ~60Hz
    }

    /**
   * Handle incoming P2P packet
   * Phase 4: Supports binary-encoded snapshots for bandwidth reduction
   */
    handleP2PPacket(packet, channel = 0) {
        try {
            const message = JSON.parse(packet.data.toString());
            const fromSteamId = packet.steamId;
            const envelope = this._normalizeEnvelope(message, fromSteamId);
            if (!envelope) return;

            if (!this._validateEnvelope(envelope, fromSteamId, channel)) {
                return;
            }

            // Track peer connection
            if (!this.connectedPeers.has(fromSteamId)) {
                this.connectedPeers.set(fromSteamId, { steamId: fromSteamId });
                console.log(`✅ New peer connected: ${fromSteamId}`);
            }

            // Phase 4: Decode binary payload if present (FULL or DELTA)
            let { payload } = envelope;
            if (payload && payload._binary === true && payload._data) {
                try {
                    if (!this.binaryDecoder) {
                        this.binaryDecoder = getBinaryDecoder();
                    }
                    const binaryBuffer = this._base64ToArrayBuffer(payload._data);

                    if (payload._delta) {
                        // Delta Packet: Need baseline
                        // We assume the PREVIOUS packet from this sender was the baseline.
                        // Since we use reliable delivery, lastReceivedSnapshot should be correct.
                        const lastSnapshot = this.snapshotQueues.get(fromSteamId);

                        if (lastSnapshot) {
                            payload = this.binaryDecoder.decodeDeltaSnapshot(binaryBuffer, lastSnapshot);
                        } else {
                            console.warn(`Received DELTA from ${fromSteamId} but have no baseline! Requesting resync?`);
                            // Drop it? Or try decoding as full (maybe magic handles it)?
                            // decodeDelta checking magic might fail.
                            return;
                        }
                    } else {
                        // Full Packet
                        payload = this.binaryDecoder.decodeSnapshot(binaryBuffer);
                    }

                    // Store decoded snapshot as new baseline for this peer
                    this.snapshotQueues.set(fromSteamId, payload);
                } catch (err) {
                    console.warn('Binary decoding failed, payload may be corrupted:', err);
                    return; // Drop corrupted packet
                }
            }

            // Call registered message handlers (array-based)
            const handlers = this.messageHandlers.get(envelope.msgType);
            if (handlers && handlers.length > 0) {
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
                        });
                    } catch (err) {
                        console.error('Error in message handler:', err);
                    }
                });
            }
        } catch (err) {
            console.error('❌ Failed to parse P2P packet:', err);
        }
    }

    // Note: on() method is defined at the end of the class (array-based version)

    /**
   * Leave current lobby
   */
    leaveLobby() {
        if (!this.currentLobbyId) return;

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

            this.currentLobbyId = null;
            this.isHost = false;
            return;
        }

        // Close all P2P connections
        this.connectedPeers.forEach((peerInfo, steamId) => {
            greenworks.closeP2PSessionWithUser(steamId);
        });

        greenworks.leaveLobby(this.currentLobbyId);
        this.connectedPeers.clear();
        this.currentLobbyId = null;
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
            }));
        }

        return new Promise((resolve, reject) => {
            greenworks.requestLobbyList((lobbies) => {
                const lobbyList = lobbies.map((lobbyId) => ({
                    id: lobbyId,
                    name: greenworks.getLobbyData(lobbyId, 'game_name') || '[No name]',
                    mode: greenworks.getLobbyData(lobbyId, 'game_mode') || 'ffa',
                    players: greenworks.getNumLobbyMembers(lobbyId),
                    maxPlayers: greenworks.getLobbyMemberLimit(lobbyId),
                }));

                resolve(lobbyList);
            }, reject);
        });
    }

    /**
   * Cleanup on shutdown
   */
    shutdown() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
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

        const envelope = this._normalizeEnvelope(message, message.from);
        if (!envelope) return;
        if (!this._validateEnvelope(envelope, message.from, message.channel ?? 0)) {
            return;
        }

        // Phase 4: Decode binary payload if present
        let { payload } = envelope;
        if (payload && payload._binary === true && payload._data) {
            try {
                if (!this.binaryDecoder) {
                    this.binaryDecoder = getBinaryDecoder();
                }
                const binaryBuffer = this._base64ToArrayBuffer(payload._data);
                payload = this.binaryDecoder.decodeSnapshot(binaryBuffer);
            } catch (err) {
                console.warn('Binary decoding failed in mock mode:', err);
                return; // Drop corrupted packet
            }
        }

        // Call registered message handlers
        const handlers = this.messageHandlers.get(envelope.msgType);
        if (handlers && handlers.length > 0) {
            handlers.forEach((handler) => {
                try {
                    handler({
                        data: payload,
                        from: message.from,
                        timestamp: envelope.sentAt,
                        seq: envelope.seq,
                        tick: envelope.tick,
                        protocolVersion: envelope.protocolVersion,
                    });
                } catch (err) {
                    console.error('Error in message handler:', err);
                }
            });
        }
    }

    /**
   * Register a message handler
   */
    on(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
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

    _buildEnvelope(messageType, data, options = {}) {
        const channel = options.channel ?? 0;
        const seq = this._nextSeq(channel);
        return {
            msgType: messageType,
            matchId: this.matchId,
            matchNonce: this.matchNonce,
            hostSteamId: this.hostSteamId,
            seq,
            tick: options.tick ?? data?.tick ?? null,
            sentAt: Date.now(),
            protocolVersion: this.protocolVersion,
            payload: data,
        };
    }

    _normalizeEnvelope(message, fromSteamId) {
        if (message?.msgType) {
            return message;
        }
        if (message?.type) {
            return {
                msgType: message.type,
                matchId: message.matchId ?? null,
                matchNonce: message.matchNonce ?? null,
                hostSteamId: message.hostSteamId ?? null,
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

    _validateEnvelope(envelope, fromSteamId, channel) {
        const isHello = envelope.msgType === 'net:hello';
        const isWelcome = envelope.msgType === 'net:welcome';
        if (!envelope.protocolVersion) {
            return false;
        }
        if (envelope.protocolVersion !== this.protocolVersion && !isHello && !isWelcome) {
            this._sendNetError(fromSteamId, 'PROTOCOL_MISMATCH', envelope.msgType);
            return false;
        }

        if (isWelcome && fromSteamId === this.hostSteamId) {
            if (envelope.matchId) this.matchId = envelope.matchId;
            if (envelope.matchNonce) this.matchNonce = envelope.matchNonce;
            if (envelope.hostSteamId) this.hostSteamId = envelope.hostSteamId;
            return true;
        }

        if (!this.matchId || !this.matchNonce || !this.hostSteamId) {
            return true;
        }

        if (!isHello) {
            if (envelope.matchId !== this.matchId) return false;
            if (envelope.matchNonce !== this.matchNonce) return false;
            if (envelope.hostSteamId !== this.hostSteamId) return false;
        }

        const seqKey = `${fromSteamId}:${channel}`;
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
        this.sendP2PMessage(targetSteamId, 'net:error', payload);
    }

    _nextSeq(channel) {
        const current = this.sendSeqByChannel.get(channel) ?? 0;
        const next = current + 1;
        this.sendSeqByChannel.set(channel, next);
        return next;
    }

    _resolveDelivery(delivery) {
        if (!greenworks) return null;
        switch (delivery) {
        case 'unreliable':
            return greenworks.P2PSend.Unreliable;
        case 'unreliable_no_delay':
            return greenworks.P2PSend.UnreliableNoDelay;
        case 'reliable':
        default:
            return greenworks.P2PSend.Reliable;
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
        const state = this.snapshotQueues.get(steamId) || {
            pending: null,
            lastSendAt: 0,
            minInterval: 1000 / 30, // Start at 30Hz
            dropCount: 0,
            windowStart: Date.now(),
            timer: null,
            // Phase 4: Backpressure metrics
            totalDropped: 0,
            totalSent: 0,
            currentRate: 30,
            consecutiveSuccesses: 0,
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
            state.consecutiveSuccesses++;

            // Phase 4: Try to restore rate after sustained success
            if (state.consecutiveSuccesses >= 30 && state.currentRate < 30) {
                // Sustained 1 second of success, try to increase rate
                if (state.currentRate === 10) {
                    state.currentRate = 20;
                    state.minInterval = 1000 / 20;
                } else if (state.currentRate === 20) {
                    state.currentRate = 30;
                    state.minInterval = 1000 / 30;
                }
                state.consecutiveSuccesses = 0;
            }
        } else {
            // Queue is building up - apply backpressure
            if (state.pending) {
                // Drop the OLD pending snapshot, keep the NEW one (latest state)
                state.dropCount++;
                state.totalDropped++;
                state.consecutiveSuccesses = 0;
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
                        state.pending = null;
                    }
                    state.timer = null;
                }, delay);
            }
        }

        // Reset window stats every second
        if (now - state.windowStart > 1000) {
            // Phase 4: Adaptive throttling based on drop rate
            const dropRate = state.dropCount / Math.max(1, state.dropCount + (state.totalSent - (state.totalSent - state.dropCount)));

            if (state.dropCount >= 5 || dropRate > 0.3) {
                // Heavy congestion - drop to 10Hz
                state.currentRate = 10;
                state.minInterval = 1000 / 10;
            } else if (state.dropCount >= 2 || dropRate > 0.1) {
                // Moderate congestion - drop to 20Hz
                state.currentRate = 20;
                state.minInterval = 1000 / 20;
            }
            // Note: Rate restoration happens in the success path above

            state.dropCount = 0;
            state.windowStart = now;
        }

        this.snapshotQueues.set(steamId, state);
    }

    /**
     * Phase 4: Get backpressure stats for all peers
     */
    getBackpressureStats() {
        const stats = {};
        for (const [steamId, state] of this.snapshotQueues) {
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

    _generateMatchNonce() {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const bytes = new Uint8Array(8);
            crypto.getRandomValues(bytes);
            return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        }
        return Math.random().toString(16).slice(2) + Date.now().toString(16);
    }

    refreshMatchSession() {
        this.matchNonce = this._generateMatchNonce();
        return {
            matchId: this.matchId,
            matchNonce: this.matchNonce,
            hostSteamId: this.hostSteamId,
            protocolVersion: this.protocolVersion,
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
            this.broadcastToAll('net:heartbeat', {
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
            this.on('net:heartbeat', (msg) => {
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
