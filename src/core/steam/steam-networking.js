/**
 * Steam P2P Networking Wrapper
 * Handles Steam lobbies, P2P messaging, and matchmaking
 */

import { SteamConfig } from './config.js';

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
    sendP2PMessage(targetSteamId, messageType, data) {
        if (this.mockMode) {
            // Mock send via BroadcastChannel
            if (this.broadcastChannel) {
                const message = {
                    type: messageType,
                    timestamp: Date.now(),
                    from: this.steamId,
                    to: targetSteamId,
                    data,
                };
                this.broadcastChannel.postMessage(message);

                if (SteamConfig.debugMode) {
                    console.log(`🧪 Mock sent to ${targetSteamId}:`, messageType);
                }
            }
            return;
        }

        const message = {
            type: messageType,
            timestamp: Date.now(),
            from: this.steamId,
            data,
        };

        const buffer = Buffer.from(JSON.stringify(message));

        greenworks.sendP2PPacket(
            targetSteamId,
            buffer,
            greenworks.P2PSend.Reliable, // Reliable delivery
            0, // Channel 0
        );
    }

    /**
   * Broadcast message to all connected peers (host only)
   */
    broadcastToAll(messageType, data) {
        if (this.mockMode) {
            // Mock broadcast via BroadcastChannel
            if (this.broadcastChannel) {
                const message = {
                    type: messageType,
                    timestamp: Date.now(),
                    from: this.steamId,
                    to: 'all',
                    data,
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
            this.sendP2PMessage(steamId, messageType, data);
        });
    }

    /**
   * Start polling for incoming P2P packets
   */
    startP2PPolling() {
        if (this.mockMode) return;

        // Poll for P2P packets at 60Hz
        this.pollInterval = setInterval(() => {
            while (greenworks.isP2PPacketAvailable(0)) {
                const packet = greenworks.readP2PPacket(0);
                if (packet) {
                    this.handleP2PPacket(packet);
                }
            }
        }, 16); // ~60Hz
    }

    /**
   * Handle incoming P2P packet
   */
    handleP2PPacket(packet) {
        try {
            const message = JSON.parse(packet.data.toString());
            const fromSteamId = packet.steamId;

            // Track peer connection
            if (!this.connectedPeers.has(fromSteamId)) {
                this.connectedPeers.set(fromSteamId, { steamId: fromSteamId });
                console.log(`✅ New peer connected: ${fromSteamId}`);
            }

            // Call registered message handlers
            const handler = this.messageHandlers.get(message.type);
            if (handler) {
                handler({
                    from: fromSteamId,
                    type: message.type,
                    data: message.data,
                    timestamp: message.timestamp,
                });
            }
        } catch (err) {
            console.error('❌ Failed to parse P2P packet:', err);
        }
    }

    /**
   * Register a message handler
   */
    on(messageType, callback) {
        this.messageHandlers.set(messageType, callback);
    }

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
   */
    handleMockP2PMessage(message) {
        if (SteamConfig.debugMode) {
            console.log(`🧪 Mock received from ${message.from}:`, message.type);
        }

        // Call registered message handlers
        const handlers = this.messageHandlers.get(message.type);
        if (handlers && handlers.length > 0) {
            handlers.forEach((handler) => {
                try {
                    handler({ data: message.data, from: message.from });
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
}
