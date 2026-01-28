/**
 * SteamService - Unified Steam API Facade
 * 
 * Provides a clean, event-driven interface for all Steam functionality.
 * Handles initialization, connection monitoring, and offline queue management.
 * 
 * Usage:
 *   const steam = SteamService.getInstance();
 *   await steam.initialize();
 *   steam.on('steam:ready', () => console.log('Steam ready!'));
 */

import {
    STEAM_APP_ID,
    STEAM_EVENTS,
    STEAM_RETRY,
    STEAM_CONNECTION,
    STEAM_STORAGE_KEYS,
    STEAM_DEFAULTS,
    AVATAR_CACHE,
    PERSONA_STATE,
    PERSONA_STATE_LABELS,
    STEAM_STATS,
    STEAM_LEADERBOARDS,
    STEAM_IPC,
} from './steam-config.js';
import { normalizeScoreDetails, SCORE_DETAIL_FLAGS } from './leaderboard-score-details.js';

const OFFLINE_QUEUE_BACKOFF = {
    BASE_MS: 2000,
    MAX_MS: 60000,
    JITTER_MS: 750,
};

// Check for Electron environment
const isElectron = typeof window !== 'undefined' &&
    (window.process?.type === 'renderer' ||
        (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')));

// Get ipcRenderer if in Electron
let ipcRenderer = null;
if (isElectron) {
    try {
        const electron = window.require('electron');
        ipcRenderer = electron.ipcRenderer;
    } catch (err) {
        console.warn('[SteamService] Failed to load Electron IPC:', err.message);
    }
}

/**
 * SteamService Singleton
 * Central point for all Steam API interactions
 */
class SteamService {
    static instance = null;

    constructor() {
        // State
        this.initialized = false;
        this.isOnline = false;
        this.steamId = null;
        this.playerName = STEAM_DEFAULTS.PLAYER_NAME;
        this.avatar = null;
        this.appId = STEAM_APP_ID;

        // Event system
        this.listeners = new Map();

        // Offline queue
        this.offlineQueue = this._loadOfflineQueue();
        this.connectionState = 'offline';
        this.capabilities = {
            leaderboards: false,
            cloud: false,
            friends: false,
            achievements: false,
        };
        this.capabilitiesLoaded = false;

        // Connection monitoring
        this.connectionCheckInterval = null;
        this.wasOnline = false;

        // Initialization state
        this.initPromise = null;
        this.initComplete = false;

        // Avatar cache (memory) - using LRU tracking
        this.avatarCache = new Map();
        this.avatarAccessOrder = []; // Track access order for LRU eviction

        // Friends cache
        this.friendsCache = null;
        this.friendsCacheTimestamp = 0;
        this.FRIENDS_CACHE_TTL = 60000; // 1 minute

        // Stats cache (local mirror for leaderboards + offline)
        this.statsCache = this._loadStatsCache();
        this.statsCacheTimestamp = 0;

        // Invite queue (for events that arrive before listeners attach)
        this.pendingInvites = [];
        this._ipcListenersInitialized = false;

        this._setupIpcListeners();
    }

    // ============================================================
    // LRU Cache Helpers
    // ============================================================

    /**
     * Update LRU access order for a cache key
     */
    _touchLRU(cacheKey) {
        const idx = this.avatarAccessOrder.indexOf(cacheKey);
        if (idx > -1) {
            this.avatarAccessOrder.splice(idx, 1);
        }
        this.avatarAccessOrder.push(cacheKey);
    }

    /**
     * Evict oldest entries if cache exceeds max size
     */
    _evictLRU() {
        const maxEntries = AVATAR_CACHE.MAX_MEMORY_ENTRIES || 50;
        while (this.avatarCache.size > maxEntries && this.avatarAccessOrder.length > 0) {
            const oldest = this.avatarAccessOrder.shift();
            this.avatarCache.delete(oldest);
            console.log(`[SteamService] LRU evicted: ${oldest}`);
        }
    }

    /**
     * Get the singleton instance
     */
    static getInstance() {
        if (!SteamService.instance) {
            SteamService.instance = new SteamService();
        }
        return SteamService.instance;
    }

    /**
     * Initialize Steam connection (non-blocking)
     * Returns immediately, fires events on completion
     */
    async initialize() {
        // Prevent multiple initializations
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    /**
     * Internal initialization with retry logic
     */
    async _doInitialize() {
        if (!ipcRenderer) {
            console.log('[SteamService] No IPC available - running in offline mode');
            this._enterOfflineMode();
            this._updateConnectionState();
            this.initComplete = true;
            return false;
        }

        console.log('[SteamService] Initializing...');
        this._setupIpcListeners();

        for (let attempt = 1; attempt <= STEAM_RETRY.MAX_ATTEMPTS; attempt++) {
            try {
                const isInitialized = await ipcRenderer.invoke(STEAM_IPC.IS_INITIALIZED);

                if (isInitialized) {
                    let isConnected = true;
                    try {
                        isConnected = await ipcRenderer.invoke(STEAM_IPC.CHECK_CONNECTION);
                    } catch (err) {
                        isConnected = true;
                    }

                    // Steam is ready - fetch player data
                    this.steamId = await ipcRenderer.invoke(STEAM_IPC.GET_STEAM_ID);
                    this.playerName = await ipcRenderer.invoke(STEAM_IPC.GET_PLAYER_NAME) || STEAM_DEFAULTS.PLAYER_NAME;
                    try {
                        const appId = await ipcRenderer.invoke(STEAM_IPC.GET_APP_ID);
                        if (appId) {
                            this.appId = Number(appId);
                        }
                    } catch (err) {
                        this.appId = STEAM_APP_ID;
                    }

                    this.initialized = true;
                    this.isOnline = !!isConnected;
                    this.wasOnline = !!isConnected;

                    if (isConnected) {
                        console.log(`[SteamService] ✅ Connected: ${this.playerName} (${this.steamId})`);
                    } else {
                        console.log(`[SteamService] ⚠️ Steam available but offline: ${this.playerName} (${this.steamId})`);
                    }

                    // Cache player data for offline
                    this._cachePlayerData();

                    // Start connection monitoring
                    this._startConnectionMonitoring();

                    // Flush any queued offline actions
                    await this._flushOfflineQueue();

                    // Refresh stats cache for leaderboards
                    await this.refreshStatsCache();

                    // Refresh capabilities for feature gating
                    await this.refreshCapabilities();
                    this._updateConnectionState();

                    // Emit ready event
                    this.emit(STEAM_EVENTS.READY, {
                        steamId: this.steamId,
                        playerName: this.playerName,
                    });
                    if (isConnected) {
                        this.emit(STEAM_EVENTS.CONNECTED);
                    } else {
                        this.emit(STEAM_EVENTS.DISCONNECTED);
                    }

                    this.initComplete = true;
                    return true;
                }
            } catch (err) {
                console.warn(`[SteamService] Init attempt ${attempt}/${STEAM_RETRY.MAX_ATTEMPTS} failed:`, err.message);
            }

            // Wait before retry (exponential backoff)
            if (attempt < STEAM_RETRY.MAX_ATTEMPTS) {
                const delay = STEAM_RETRY.BASE_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`[SteamService] Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        // All retries failed
        console.log('[SteamService] ⚠️ Steam unavailable after retries - entering offline mode');
        this._enterOfflineMode();
        this.emit(STEAM_EVENTS.INIT_FAILED);
        this.initComplete = true;
        this._updateConnectionState();
        return false;
    }

    /**
     * Setup IPC listeners for main-process events
     */
    _setupIpcListeners() {
        if (!ipcRenderer || this._ipcListenersInitialized) {
            return;
        }

        this._ipcListenersInitialized = true;

        ipcRenderer.on('steam:lobbyJoinRequested', (event, payload) => {
            const invite = {
                lobbyId: payload?.lobbyId ? String(payload.lobbyId) : null,
                friendSteamId: payload?.friendSteamId ? String(payload.friendSteamId) : null,
                source: payload?.source || 'unknown',
                receivedAt: payload?.receivedAt || Date.now(),
            };

            if (!invite.lobbyId) {
                return;
            }

            this.pendingInvites.push(invite);
            this.emit(STEAM_EVENTS.INVITE_RECEIVED, invite);
        });

        ipcRenderer.on('steam:serverConnection', async (event, payload) => {
            const connected = !!payload?.connected;

            if (connected && !this.wasOnline) {
                console.log('[SteamService] ✅ Steam server connected');
                this.isOnline = true;
                this.wasOnline = true;
                this.emit(STEAM_EVENTS.RECONNECTED);
                this.emit(STEAM_EVENTS.CONNECTED);
                await this._flushOfflineQueue();
                await this.refreshStatsCache();
                await this.refreshCapabilities();
                this._updateConnectionState();
                return;
            }

            if (!connected && this.wasOnline) {
                console.log('[SteamService] ⚠️ Steam server disconnected');
                this.isOnline = false;
                this.wasOnline = false;
                this.emit(STEAM_EVENTS.DISCONNECTED);
                this._updateConnectionState();
            }
        });
    }

    /**
     * Enter offline mode with cached/default data
     */
    _enterOfflineMode() {
        this.initialized = false;
        this.isOnline = false;

        // Load cached player data if available
        const cached = this._loadCachedPlayerData();
        if (cached) {
            this.steamId = cached.steamId;
            this.playerName = cached.playerName;
            console.log(`[SteamService] Using cached player: ${this.playerName}`);
        } else {
            this.steamId = STEAM_DEFAULTS.STEAM_ID;
            this.playerName = STEAM_DEFAULTS.PLAYER_NAME;
        }
        this.capabilities = {
            leaderboards: false,
            cloud: false,
            friends: false,
            achievements: false,
        };
        this.capabilitiesLoaded = true;
    }

    /**
     * Cache player data for offline use
     */
    _cachePlayerData() {
        try {
            localStorage.setItem(STEAM_STORAGE_KEYS.CACHED_PLAYER, JSON.stringify({
                steamId: this.steamId,
                playerName: this.playerName,
                timestamp: Date.now(),
            }));
        } catch (err) {
            console.warn('[SteamService] Failed to cache player data:', err.message);
        }
    }

    /**
     * Load cached player data
     */
    _loadCachedPlayerData() {
        try {
            const cached = localStorage.getItem(STEAM_STORAGE_KEYS.CACHED_PLAYER);
            return cached ? JSON.parse(cached) : null;
        } catch (err) {
            return null;
        }
    }

    // ============================================================
    // Connection Monitoring
    // ============================================================

    /**
     * Start periodic connection checks
     */
    _startConnectionMonitoring() {
        if (this.connectionCheckInterval) {
            return;
        }

        this.connectionCheckInterval = setInterval(async () => {
            await this._checkConnection();
        }, STEAM_CONNECTION.CHECK_INTERVAL_MS);

        console.log(`[SteamService] Connection monitoring started (every ${STEAM_CONNECTION.CHECK_INTERVAL_MS / 1000}s)`);
    }

    /**
     * Stop connection monitoring
     */
    _stopConnectionMonitoring() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = null;
        }
    }

    /**
     * Check if Steam is still connected
     */
    async _checkConnection() {
        if (!ipcRenderer) {
            return;
        }

        try {
            const isOnline = await Promise.race([
                (async () => {
                    try {
                        return await ipcRenderer.invoke(STEAM_IPC.CHECK_CONNECTION);
                    } catch (err) {
                        return await ipcRenderer.invoke(STEAM_IPC.IS_INITIALIZED);
                    }
                })(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), STEAM_CONNECTION.TIMEOUT_MS)
                ),
            ]);

            if (isOnline && !this.wasOnline) {
                // Reconnected
                console.log('[SteamService] ✅ Reconnected to Steam');
                this.isOnline = true;
                this.wasOnline = true;
                this.emit(STEAM_EVENTS.RECONNECTED);
                this.emit(STEAM_EVENTS.CONNECTED);
                await this._flushOfflineQueue();
                await this.refreshStatsCache();
                await this.refreshCapabilities();
                this._updateConnectionState();
            } else if (!isOnline && this.wasOnline) {
                // Disconnected
                console.log('[SteamService] ⚠️ Disconnected from Steam');
                this.isOnline = false;
                this.wasOnline = false;
                this.emit(STEAM_EVENTS.DISCONNECTED);
                this._updateConnectionState();
            }
        } catch (err) {
            if (this.wasOnline) {
                console.log('[SteamService] ⚠️ Lost connection to Steam:', err.message);
                this.isOnline = false;
                this.wasOnline = false;
                this.emit(STEAM_EVENTS.DISCONNECTED);
                this._updateConnectionState();
            }
        }
    }

    // ============================================================
    // Capability & State Model
    // ============================================================

    _setConnectionState(nextState) {
        if (this.connectionState === nextState) {
            return;
        }
        this.connectionState = nextState;
        this.emit(STEAM_EVENTS.STATE_CHANGED, { state: nextState });
    }

    _updateConnectionState() {
        if (!ipcRenderer) {
            this._setConnectionState('no_steam');
            return;
        }

        if (!this.isOnline) {
            this._setConnectionState('offline');
            return;
        }

        if (!this.capabilitiesLoaded) {
            this._setConnectionState('connected');
            return;
        }

        const capabilities = this.capabilities || {};
        const anyMissing = !capabilities.leaderboards
            || !capabilities.cloud
            || !capabilities.friends
            || !capabilities.achievements;

        this._setConnectionState(anyMissing ? 'partial' : 'connected');
    }

    async refreshCapabilities() {
        if (!ipcRenderer || !this.isOnline) {
            this.capabilities = {
                leaderboards: false,
                cloud: false,
                friends: false,
                achievements: false,
            };
            this.capabilitiesLoaded = true;
            this.emit(STEAM_EVENTS.CAPABILITIES_UPDATED, { ...this.capabilities });
            return this.capabilities;
        }

        try {
            const caps = await ipcRenderer.invoke(STEAM_IPC.GET_CAPABILITIES);
            if (caps && typeof caps === 'object') {
                this.capabilities = {
                    leaderboards: !!caps.leaderboards,
                    cloud: !!caps.cloud,
                    friends: !!caps.friends,
                    achievements: !!caps.achievements,
                };
                this.capabilitiesLoaded = true;
                this.emit(STEAM_EVENTS.CAPABILITIES_UPDATED, { ...this.capabilities });
                this._updateConnectionState();
            }
        } catch (err) {
            console.warn('[SteamService] Failed to refresh capabilities:', err.message);
            this.capabilitiesLoaded = true;
            this.capabilities = {
                leaderboards: false,
                cloud: false,
                friends: false,
                achievements: false,
            };
            this.emit(STEAM_EVENTS.CAPABILITIES_UPDATED, { ...this.capabilities });
            this._updateConnectionState();
        }

        return this.capabilities;
    }

    getCapabilities() {
        return { ...this.capabilities };
    }

    getConnectionState() {
        return this.connectionState;
    }

    async retryConnection() {
        if (!ipcRenderer) {
            return false;
        }

        try {
            const isInitialized = await ipcRenderer.invoke(STEAM_IPC.IS_INITIALIZED);
            if (isInitialized) {
                let isConnected = true;
                try {
                    isConnected = await ipcRenderer.invoke(STEAM_IPC.CHECK_CONNECTION);
                } catch (err) {
                    isConnected = true;
                }

                this.steamId = await ipcRenderer.invoke(STEAM_IPC.GET_STEAM_ID);
                this.playerName = await ipcRenderer.invoke(STEAM_IPC.GET_PLAYER_NAME) || STEAM_DEFAULTS.PLAYER_NAME;
                this.initialized = true;
                this.isOnline = !!isConnected;
                this.wasOnline = !!isConnected;
                this._cachePlayerData();
                this._startConnectionMonitoring();
                await this.refreshCapabilities();
                if (isConnected) {
                    this.emit(STEAM_EVENTS.RECONNECTED);
                    this.emit(STEAM_EVENTS.CONNECTED);
                } else {
                    this.emit(STEAM_EVENTS.DISCONNECTED);
                }
                this._updateConnectionState();
                return isConnected;
            }
        } catch (err) {
            console.warn('[SteamService] Retry connection failed:', err.message);
        }

        this._enterOfflineMode();
        this._updateConnectionState();
        return false;
    }

    // ============================================================
    // Event System
    // ============================================================

    /**
     * Subscribe to an event
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * Unsubscribe from an event
     */
    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    /**
     * Emit an event to all listeners
     */
    emit(event, data = {}) {
        console.log(`[SteamService] Event: ${event}`, data);
        if (this.listeners.has(event)) {
            for (const callback of this.listeners.get(event)) {
                try {
                    callback(data);
                } catch (err) {
                    console.error(`[SteamService] Event handler error for ${event}:`, err);
                }
            }
        }
    }

    /**
     * Consume any pending invites that arrived before listeners attached
     */
    consumePendingInvites() {
        if (this.pendingInvites.length === 0) {
            return [];
        }
        const invites = [...this.pendingInvites];
        this.pendingInvites.length = 0;
        return invites;
    }

    // ============================================================
    // Offline Queue
    // ============================================================

    /**
     * Queue an action for when Steam reconnects
     */
    queueAction(action, data) {
        const entry = {
            action,
            data,
            timestamp: Date.now(),
            attempts: 0,
            nextAttemptAt: 0,
        };

        if (!this._coalesceQueueEntry(entry)) {
            this.offlineQueue.push(entry);
        }
        this._saveOfflineQueue();
        console.log(`[SteamService] Queued action: ${action}`);
    }

    _getLeaderboardSort(leaderboardName) {
        if (!leaderboardName) return 'desc';
        if (leaderboardName.startsWith(STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX)) {
            return 'asc';
        }
        return 'desc';
    }

    _getQueueBackoffMs(attempts) {
        const exponent = Math.max(0, attempts - 1);
        const base = OFFLINE_QUEUE_BACKOFF.BASE_MS * (2 ** exponent);
        const capped = Math.min(base, OFFLINE_QUEUE_BACKOFF.MAX_MS);
        const jitter = Math.floor(Math.random() * OFFLINE_QUEUE_BACKOFF.JITTER_MS);
        return capped + jitter;
    }

    _normalizeQueueEntry(entry) {
        if (!entry || typeof entry !== 'object') return null;
        return {
            ...entry,
            attempts: Number.isFinite(entry.attempts) ? entry.attempts : 0,
            nextAttemptAt: Number.isFinite(entry.nextAttemptAt) ? entry.nextAttemptAt : 0,
            timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
        };
    }

    _isQueueActionSupported(action) {
        if (!this.capabilitiesLoaded) return true;
        if (action === 'uploadScore') return this.capabilities?.leaderboards !== false;
        if (action === 'cloudWrite' || action === 'cloudDelete') return this.capabilities?.cloud !== false;
        if (action === 'unlockAchievement') return this.capabilities?.achievements !== false;
        return true;
    }

    _isFlushResultSuccess(action, result) {
        if (typeof result === 'boolean') return result;
        if (!result) return false;
        if (result.queued) return false;
        if (result.success === false) return false;
        if (result.supported === false) return false;
        return true;
    }

    _coalesceQueueEntry(entry) {
        const { action, data } = entry;
        if (!action) return false;

        const findIndex = (predicate) => {
            for (let i = this.offlineQueue.length - 1; i >= 0; i--) {
                if (predicate(this.offlineQueue[i])) return i;
            }
            return -1;
        };

        if (action === 'cloudWrite' && data?.filename) {
            const idx = findIndex((item) => item.action === action && item.data?.filename === data.filename);
            if (idx >= 0) {
                this.offlineQueue[idx].data = data;
                this.offlineQueue[idx].timestamp = Date.now();
                this.offlineQueue[idx].attempts = 0;
                this.offlineQueue[idx].nextAttemptAt = 0;
                return true;
            }
            return false;
        }

        if (action === 'cloudDelete' && data?.filename) {
            const idxWrite = findIndex((item) =>
                item.action === 'cloudWrite' && item.data?.filename === data.filename
            );
            if (idxWrite >= 0) {
                this.offlineQueue.splice(idxWrite, 1);
            }
            const idx = findIndex((item) => item.action === action && item.data?.filename === data.filename);
            if (idx >= 0) {
                this.offlineQueue[idx].timestamp = Date.now();
                this.offlineQueue[idx].attempts = 0;
                this.offlineQueue[idx].nextAttemptAt = 0;
                return true;
            }
            return false;
        }

        if ((action === 'setStat' || action === 'setStatMax') && data?.name) {
            const idxIncrement = findIndex((item) =>
                item.action === 'incrementStat' && item.data?.name === data.name
            );
            if (idxIncrement >= 0) {
                this.offlineQueue.splice(idxIncrement, 1);
            }
            const idx = findIndex((item) => item.action === action && item.data?.name === data.name);
            if (idx >= 0) {
                const existing = this.offlineQueue[idx];
                if (action === 'setStatMax') {
                    existing.data.value = Math.max(existing.data.value || 0, data.value || 0);
                } else {
                    existing.data.value = data.value;
                }
                existing.timestamp = Date.now();
                existing.attempts = 0;
                existing.nextAttemptAt = 0;
                return true;
            }
            return false;
        }

        if (action === 'incrementStat' && data?.name) {
            const idxSet = findIndex((item) =>
                (item.action === 'setStat' || item.action === 'setStatMax')
                && item.data?.name === data.name
            );
            if (idxSet >= 0) {
                const existing = this.offlineQueue[idxSet];
                const delta = Number(data.amount || 0);
                existing.data.value = Number(existing.data.value || 0) + delta;
                existing.timestamp = Date.now();
                existing.attempts = 0;
                existing.nextAttemptAt = 0;
                return true;
            }
            const idx = findIndex((item) => item.action === action && item.data?.name === data.name);
            if (idx >= 0) {
                const existing = this.offlineQueue[idx];
                existing.data.amount = Number(existing.data.amount || 0) + Number(data.amount || 0);
                existing.timestamp = Date.now();
                existing.attempts = 0;
                existing.nextAttemptAt = 0;
                return true;
            }
            return false;
        }

        if (action === 'uploadScore' && data?.leaderboardName) {
            const idx = findIndex((item) => item.action === action
                && item.data?.leaderboardName === data.leaderboardName);
            if (idx >= 0) {
                const existing = this.offlineQueue[idx];
                const sort = this._getLeaderboardSort(data.leaderboardName);
                const existingScore = Number(existing.data.score || 0);
                const incomingScore = Number(data.score || 0);
                const isBetter = sort === 'asc'
                    ? incomingScore < existingScore
                    : incomingScore > existingScore;
                if (isBetter) {
                    existing.data = data;
                    existing.timestamp = Date.now();
                    existing.attempts = 0;
                    existing.nextAttemptAt = 0;
                }
                return true;
            }
            return false;
        }

        if (action === 'unlockAchievement' && data?.name) {
            const idx = findIndex((item) => item.action === action && item.data?.name === data.name);
            if (idx >= 0) {
                return true;
            }
            return false;
        }

        return false;
    }

    /**
     * Flush queued actions to Steam
     */
    async _flushOfflineQueue() {
        if (this.offlineQueue.length === 0 || !this.isOnline) {
            return;
        }

        const now = Date.now();
        const pending = [];
        const deferred = [];

        for (const entry of this.offlineQueue) {
            const normalized = this._normalizeQueueEntry(entry);
            if (!normalized) continue;

            if (normalized.nextAttemptAt && normalized.nextAttemptAt > now) {
                deferred.push(normalized);
                continue;
            }

            if (!this._isQueueActionSupported(normalized.action)) {
                deferred.push(normalized);
                continue;
            }

            pending.push(normalized);
        }

        if (pending.length === 0) {
            this.offlineQueue = deferred;
            this._saveOfflineQueue();
            return;
        }

        console.log(`[SteamService] Flushing ${pending.length} queued actions...`);
        this.offlineQueue = deferred;

        for (const item of pending) {
            try {
                const result = await ipcRenderer.invoke(`steam:${item.action}`, item.data);
                const success = this._isFlushResultSuccess(item.action, result);
                if (success) {
                    console.log(`[SteamService] ✅ Flushed: ${item.action}`);
                    continue;
                }
                throw new Error(result?.error || 'Steam API unavailable');
            } catch (err) {
                console.warn(`[SteamService] ❌ Failed to flush: ${item.action}`, err.message);
                item.attempts = Number(item.attempts || 0) + 1;
                item.nextAttemptAt = Date.now() + this._getQueueBackoffMs(item.attempts);
                this.offlineQueue.push(item);
            }
        }

        this._saveOfflineQueue();

        if (pending.length > 0) {
            this.emit(STEAM_EVENTS.QUEUE_FLUSHED, { count: pending.length });
        }
    }

    /**
     * Load offline queue from localStorage
     */
    _loadOfflineQueue() {
        try {
            const stored = localStorage.getItem(STEAM_STORAGE_KEYS.OFFLINE_QUEUE);
            const parsed = stored ? JSON.parse(stored) : [];
            const ttlMs = 7 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((item) => this._normalizeQueueEntry(item))
                .filter((item) => item && now - (item.timestamp || now) <= ttlMs);
        } catch (err) {
            return [];
        }
    }

    /**
     * Save offline queue to localStorage
     */
    _saveOfflineQueue() {
        try {
            const maxEntries = 500;
            if (this.offlineQueue.length > maxEntries) {
                this.offlineQueue = this.offlineQueue.slice(-maxEntries);
            }
            localStorage.setItem(STEAM_STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(this.offlineQueue));
        } catch (err) {
            console.warn('[SteamService] Failed to save offline queue:', err.message);
        }
    }

    // ============================================================
    // Stats Cache (local mirror)
    // ============================================================

    _loadStatsCache() {
        try {
            const stored = localStorage.getItem(STEAM_STORAGE_KEYS.STATS_CACHE);
            return stored ? JSON.parse(stored) : {};
        } catch (err) {
            return {};
        }
    }

    _saveStatsCache() {
        try {
            localStorage.setItem(STEAM_STORAGE_KEYS.STATS_CACHE, JSON.stringify(this.statsCache || {}));
        } catch (err) {
            console.warn('[SteamService] Failed to save stats cache:', err.message);
        }
    }

    _setCachedStat(name, value) {
        if (!name) return;
        const safeValue = Number.isFinite(value) ? Math.floor(value) : 0;
        this.statsCache = this.statsCache || {};
        this.statsCache[name] = safeValue;
        this.statsCacheTimestamp = Date.now();
        this._saveStatsCache();
    }

    getCachedStat(name, fallback = 0) {
        if (!name) return fallback;
        const value = this.statsCache?.[name];
        return Number.isFinite(value) ? value : fallback;
    }

    async refreshStatsCache() {
        if (!ipcRenderer || !this.isOnline) {
            return this.statsCache || {};
        }

        try {
            const stats = await this.getStats();
            if (stats && typeof stats === 'object') {
                this.statsCache = { ...(this.statsCache || {}), ...stats };
                this.statsCacheTimestamp = Date.now();
                this._saveStatsCache();
            }
        } catch (err) {
            console.warn('[SteamService] Failed to refresh stats cache:', err.message);
        }

        return this.statsCache || {};
    }

    // ============================================================
    // Public API
    // ============================================================

    /**
     * Get current connection status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            isOnline: this.isOnline,
            steamId: this.steamId,
            playerName: this.playerName,
            queuedActions: this.offlineQueue.length,
            connectionState: this.connectionState,
            capabilities: { ...this.capabilities },
        };
    }

    /**
     * Check if Steam features are available
     */
    isAvailable() {
        return this.initialized && this.isOnline;
    }

    /**
     * Wait for initialization to complete
     */
    async waitForInit() {
        if (this.initComplete) {
            return this.initialized;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        return this.initialize();
    }

    /**
     * Shutdown and cleanup
     */
    async shutdown() {
        console.log('[SteamService] Shutting down...');
        this._stopConnectionMonitoring();
        this._saveOfflineQueue();
        this.listeners.clear();

        // Clear Rich Presence on shutdown
        await this.clearRichPresence();
    }

    // ============================================================
    // Avatar API (3-tier cache: memory → localStorage → IPC)
    // ============================================================

    /**
     * Get player avatar with caching
     * @param {string} steamId - Steam ID to fetch avatar for (null = local player)
     * @param {string} size - 'small' (32), 'medium' (64), 'large' (184)
     * @returns {Promise<string|null>} - Base64 data URL or null
     */
    async getAvatar(steamId = null, size = 'medium') {
        const targetId = steamId || this.steamId;
        if (!targetId) return null;

        const cacheKey = `${targetId}_${size}`;

        // 1. Check memory cache
        if (this.avatarCache.has(cacheKey)) {
            const cached = this.avatarCache.get(cacheKey);
            if (Date.now() - cached.timestamp < AVATAR_CACHE.TTL_MS) {
                this._touchLRU(cacheKey); // Update LRU order
                return cached.url;
            }
        }

        // 2. Check localStorage cache
        const storedCache = this._loadAvatarCache();
        if (storedCache[cacheKey]) {
            const cached = storedCache[cacheKey];
            if (Date.now() - cached.timestamp < AVATAR_CACHE.TTL_MS) {
                // Update memory cache
                this.avatarCache.set(cacheKey, cached);
                return cached.url;
            }
        }

        // 3. Fetch from Steam via IPC
        if (!ipcRenderer || !this.isOnline) {
            return null;
        }

        try {
            const url = await ipcRenderer.invoke('steam:getAvatar', targetId, size);
            if (url) {
                const cacheEntry = { url, timestamp: Date.now() };

                // Update memory cache with LRU tracking
                this.avatarCache.set(cacheKey, cacheEntry);
                this._touchLRU(cacheKey);
                this._evictLRU();

                // Update localStorage cache
                storedCache[cacheKey] = cacheEntry;
                this._saveAvatarCache(storedCache);

                console.log(`[SteamService] Avatar cached: ${targetId} (${size})`);
            }
            return url;
        } catch (err) {
            console.warn('[SteamService] Failed to fetch avatar:', err.message);
            return null;
        }
    }

    /**
     * Load avatar cache from localStorage
     */
    _loadAvatarCache() {
        try {
            const stored = localStorage.getItem(STEAM_STORAGE_KEYS.AVATAR_CACHE);
            return stored ? JSON.parse(stored) : {};
        } catch (err) {
            return {};
        }
    }

    /**
     * Save avatar cache to localStorage
     */
    _saveAvatarCache(cache) {
        try {
            // Enforce storage limit
            const keys = Object.keys(cache);
            if (keys.length > AVATAR_CACHE.MAX_STORAGE_ENTRIES) {
                // Sort by timestamp (oldest first) and remove excess
                const sorted = keys.sort((a, b) =>
                    (cache[a].timestamp || 0) - (cache[b].timestamp || 0)
                );
                const toRemove = sorted.slice(0, keys.length - AVATAR_CACHE.MAX_STORAGE_ENTRIES);
                toRemove.forEach(key => delete cache[key]);
            }
            localStorage.setItem(STEAM_STORAGE_KEYS.AVATAR_CACHE, JSON.stringify(cache));
        } catch (err) {
            console.warn('[SteamService] Failed to save avatar cache:', err.message);
        }
    }

    /**
     * Batch load avatars for multiple Steam IDs
     * More efficient than loading one-by-one for lobbies/results screens
     * @param {string[]} steamIds - Array of Steam IDs
     * @param {string} size - Avatar size
     * @returns {Promise<Map<string, string|null>>} - Map of steamId -> avatar URL
     */
    async getAvatarsBatch(steamIds, size = 'medium') {
        const results = new Map();
        const toFetch = [];

        // Check cache first for all IDs
        for (const steamId of steamIds) {
            const cacheKey = `${steamId}_${size}`;

            // Check memory cache
            if (this.avatarCache.has(cacheKey)) {
                const cached = this.avatarCache.get(cacheKey);
                if (Date.now() - cached.timestamp < AVATAR_CACHE.TTL_MS) {
                    this._touchLRU(cacheKey);
                    results.set(steamId, cached.url);
                    continue;
                }
            }

            // Check localStorage cache
            const storedCache = this._loadAvatarCache();
            if (storedCache[cacheKey]) {
                const cached = storedCache[cacheKey];
                if (Date.now() - cached.timestamp < AVATAR_CACHE.TTL_MS) {
                    this.avatarCache.set(cacheKey, cached);
                    this._touchLRU(cacheKey);
                    results.set(steamId, cached.url);
                    continue;
                }
            }

            toFetch.push(steamId);
        }

        // Fetch remaining in parallel with concurrency limit
        if (toFetch.length > 0 && ipcRenderer && this.isOnline) {
            const concurrency = AVATAR_CACHE.BATCH_CONCURRENCY || 4;
            const chunks = [];

            for (let i = 0; i < toFetch.length; i += concurrency) {
                chunks.push(toFetch.slice(i, i + concurrency));
            }

            for (const chunk of chunks) {
                const promises = chunk.map(async (steamId) => {
                    const url = await this.getAvatar(steamId, size);
                    results.set(steamId, url);
                });
                await Promise.all(promises);
            }
        } else {
            // Mark unfetched as null
            for (const steamId of toFetch) {
                results.set(steamId, null);
            }
        }

        return results;
    }

    // ============================================================
    // Friends & Social API
    // ============================================================

    /**
     * Get list of Steam friends with status
     * @returns {Promise<Array>} - Array of friend objects
     */
    async getFriends() {
        if (!ipcRenderer || !this.isOnline) {
            return [];
        }

        // Check cache
        if (this.friendsCache && Date.now() - this.friendsCacheTimestamp < this.FRIENDS_CACHE_TTL) {
            return this.friendsCache;
        }

        try {
            const friends = await ipcRenderer.invoke('steam:getFriends');
            this.friendsCache = friends || [];
            this.friendsCacheTimestamp = Date.now();
            return this.friendsCache;
        } catch (err) {
            console.warn('[SteamService] Failed to get friends:', err.message);
            return [];
        }
    }

    /**
     * Get friends currently playing this game
     * @returns {Promise<Array>} - Friends playing Serenity Blocks
     */
    async getFriendsPlayingGame() {
        const friends = await this.getFriends();
        // Filter to friends in-game (gameId matches our app)
        const appId = String(this.appId || STEAM_APP_ID);
        return friends.filter(f => f.gameId && f.inGame && f.gameId === appId);
    }

    /**
     * Get persona state for a friend
     * @param {string} steamId
     * @returns {Promise<Object>} - Persona state info
     */
    async getPersonaState(steamId) {
        if (!ipcRenderer || !this.isOnline) {
            return { state: PERSONA_STATE.OFFLINE, label: 'Offline' };
        }

        try {
            const state = await ipcRenderer.invoke('steam:getPersonaState', steamId);
            return {
                state,
                label: PERSONA_STATE_LABELS[state] || 'Unknown',
                isOnline: state !== PERSONA_STATE.OFFLINE,
            };
        } catch (err) {
            return { state: PERSONA_STATE.OFFLINE, label: 'Offline', isOnline: false };
        }
    }

    /**
     * Send a game invite to a friend
     * @param {string} steamId - Friend's Steam ID
     * @param {string} lobbyId - Current lobby ID
     * @returns {Promise<boolean>}
     */
    async inviteFriend(steamId, lobbyId) {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            return await ipcRenderer.invoke('steam:inviteToLobby', steamId, lobbyId);
        } catch (err) {
            console.warn('[SteamService] Failed to invite friend:', err.message);
            return false;
        }
    }

    /**
     * Open Steam's invite dialog for the current lobby
     * @param {string} lobbyId
     * @returns {Promise<boolean>}
     */
    async openLobbyInviteDialog(lobbyId) {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.OPEN_LOBBY_INVITE_DIALOG, lobbyId);
        } catch (err) {
            console.warn('[SteamService] Failed to open invite dialog:', err.message);
            return false;
        }
    }

    // ============================================================
    // Steam Overlay API
    // ============================================================

    /**
     * Activate Steam overlay to a specific page
     * @param {string} type - 'Friends', 'Community', 'Players', 'Settings', 'OfficialGameGroup', 'Stats', 'Achievements'
     */
    async activateOverlay(type = 'Friends') {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            return await ipcRenderer.invoke('steam:activateOverlay', type);
        } catch (err) {
            console.warn('[SteamService] Failed to activate overlay:', err.message);
            return false;
        }
    }

    /**
     * Activate Steam overlay to a user's profile
     * @param {string} steamId - User's Steam ID
     */
    async activateOverlayToUser(steamId) {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            return await ipcRenderer.invoke('steam:activateOverlayToUser', 'steamid', steamId);
        } catch (err) {
            console.warn('[SteamService] Failed to open user profile:', err.message);
            return false;
        }
    }

    // ============================================================
    // Rich Presence API
    // ============================================================

    /**
     * Set Rich Presence status (shows in Steam Friends)
     * @param {string} status - Status string to display
     */
    async setRichPresence(status) {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            // Steam uses 'steam_display' key for the main status
            await ipcRenderer.invoke('steam:setRichPresence', 'steam_display', status);
            // Also set 'status' for games that read it differently
            await ipcRenderer.invoke('steam:setRichPresence', 'status', status);
            console.log(`[SteamService] Rich Presence: ${status}`);
            return true;
        } catch (err) {
            console.warn('[SteamService] Failed to set Rich Presence:', err.message);
            return false;
        }
    }

    /**
     * Clear Rich Presence
     */
    async clearRichPresence() {
        if (!ipcRenderer) return false;

        try {
            await ipcRenderer.invoke('steam:clearRichPresence');
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * Set an arbitrary Rich Presence key/value pair
     * @param {string} key
     * @param {string|null} value
     */
    async setRichPresenceKey(key, value) {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            await ipcRenderer.invoke('steam:setRichPresence', key, value);
            return true;
        } catch (err) {
            console.warn('[SteamService] Failed to set Rich Presence key:', err.message);
            return false;
        }
    }

    /**
     * Clear a Rich Presence key
     * @param {string} key
     */
    async clearRichPresenceKey(key) {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            await ipcRenderer.invoke('steam:setRichPresence', key, null);
            return true;
        } catch (err) {
            console.warn('[SteamService] Failed to clear Rich Presence key:', err.message);
            return false;
        }
    }

    // ============================================================
    // Steam Stats API
    // ============================================================

    async getStat(name) {
        if (!ipcRenderer || !this.isOnline) {
            return null;
        }

        try {
            const value = await ipcRenderer.invoke(STEAM_IPC.GET_STAT, name);
            if (value !== null && value !== undefined) {
                this._setCachedStat(name, value);
            }
            return value;
        } catch (err) {
            console.warn('[SteamService] Failed to get stat:', err.message);
            return null;
        }
    }

    async setStat(name, value) {
        const safeValue = Number.isFinite(value) ? Math.floor(value) : 0;
        this._setCachedStat(name, safeValue);

        if (!ipcRenderer || !this.isOnline) {
            this.queueAction('setStat', { name, value: safeValue });
            return false;
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.SET_STAT, name, safeValue);
        } catch (err) {
            console.warn('[SteamService] Failed to set stat:', err.message);
            return false;
        }
    }

    async setStatMax(name, value) {
        const safeValue = Number.isFinite(value) ? Math.floor(value) : 0;
        const cached = this.getCachedStat(name, null);
        if (cached === null || safeValue > cached) {
            this._setCachedStat(name, safeValue);
        }

        if (!ipcRenderer || !this.isOnline) {
            this.queueAction('setStatMax', { name, value: safeValue });
            return false;
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.SET_STAT_MAX, name, safeValue);
        } catch (err) {
            console.warn('[SteamService] Failed to set max stat:', err.message);
            return false;
        }
    }

    async incrementStat(name, amount = 1) {
        const delta = Number.isFinite(amount) ? Math.floor(amount) : 1;
        const nextValue = this.getCachedStat(name, 0) + delta;
        this._setCachedStat(name, nextValue);

        if (!ipcRenderer || !this.isOnline) {
            this.queueAction('incrementStat', { name, amount: delta });
            return false;
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.INCREMENT_STAT, name, delta);
        } catch (err) {
            console.warn('[SteamService] Failed to increment stat:', err.message);
            return false;
        }
    }

    async storeStats() {
        if (!ipcRenderer || !this.isOnline) {
            return false;
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.STORE_STATS);
        } catch (err) {
            console.warn('[SteamService] Failed to store stats:', err.message);
            return false;
        }
    }

    async getStats(names = STEAM_STATS) {
        if (!ipcRenderer || !this.isOnline) {
            return {};
        }

        try {
            const stats = await ipcRenderer.invoke(STEAM_IPC.GET_STATS, names);
            if (stats && typeof stats === 'object') {
                this.statsCache = { ...(this.statsCache || {}), ...stats };
                this.statsCacheTimestamp = Date.now();
                this._saveStatsCache();
            }
            return stats;
        } catch (err) {
            console.warn('[SteamService] Failed to get stats:', err.message);
            return {};
        }
    }

    // ============================================================
    // Steam Leaderboards API (feature-detected)
    // ============================================================

    async uploadScore(leaderboardName, score, scoreDetails = {}) {
        const details = { ...(scoreDetails || {}) };
        if (!ipcRenderer || !this.isOnline) {
            details.flags = (details.flags || 0) | SCORE_DETAIL_FLAGS.OFFLINE_SUBMISSION;
            const detailsPayload = normalizeScoreDetails(details);
            this.queueAction('uploadScore', {
                leaderboardName,
                score,
                ...detailsPayload,
            });
            return { queued: true };
        }

        try {
            const detailsPayload = normalizeScoreDetails(details);
            return await ipcRenderer.invoke(STEAM_IPC.UPLOAD_SCORE, {
                leaderboardName,
                score,
                ...detailsPayload,
            });
        } catch (err) {
            console.warn('[SteamService] Failed to upload score:', err.message);
            return { supported: false, success: false, error: err.message };
        }
    }

    async getLeaderboard(name, type = 'global', start = 0, count = 10) {
        if (!ipcRenderer || !this.isOnline) {
            return { supported: false, entries: [] };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.GET_LEADERBOARD, { name, type, start, count });
        } catch (err) {
            console.warn('[SteamService] Failed to get leaderboard:', err.message);
            return { supported: false, entries: [], error: err.message };
        }
    }

    async getLeaderboardEntry(name, steamId) {
        if (!ipcRenderer || !this.isOnline) {
            return { supported: false, entry: null };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.GET_LEADERBOARD_ENTRY, { name, steamId });
        } catch (err) {
            console.warn('[SteamService] Failed to get leaderboard entry:', err.message);
            return { supported: false, entry: null, error: err.message };
        }
    }

    // ============================================================
    // Steam Cloud (Remote Storage) API
    // ============================================================

    async cloudWrite(filename, data, options = {}) {
        if (!filename) {
            return { supported: false, success: false, error: 'Missing filename' };
        }
        const payload = {
            filename,
            data,
            ...options,
        };

        if (!ipcRenderer || !this.isOnline) {
            this.queueAction('cloudWrite', payload);
            return { queued: true };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.CLOUD_WRITE, payload);
        } catch (err) {
            console.warn('[SteamService] Failed to write cloud file:', err.message);
            return { supported: false, success: false, error: err.message };
        }
    }

    async cloudRead(filename) {
        if (!ipcRenderer || !this.isOnline) {
            return { supported: false, data: null };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.CLOUD_READ, { filename });
        } catch (err) {
            console.warn('[SteamService] Failed to read cloud file:', err.message);
            return { supported: false, data: null, error: err.message };
        }
    }

    async cloudDelete(filename) {
        if (!filename) {
            return { supported: false, success: false, error: 'Missing filename' };
        }

        if (!ipcRenderer || !this.isOnline) {
            this.queueAction('cloudDelete', { filename });
            return { queued: true };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.CLOUD_DELETE, { filename });
        } catch (err) {
            console.warn('[SteamService] Failed to delete cloud file:', err.message);
            return { supported: false, success: false, error: err.message };
        }
    }

    async cloudExists(filename) {
        if (!ipcRenderer || !this.isOnline) {
            return { supported: false, exists: false };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.CLOUD_EXISTS, { filename });
        } catch (err) {
            console.warn('[SteamService] Failed to check cloud file:', err.message);
            return { supported: false, exists: false, error: err.message };
        }
    }

    async cloudGetQuota() {
        if (!ipcRenderer || !this.isOnline) {
            return { supported: false };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.CLOUD_GET_QUOTA);
        } catch (err) {
            console.warn('[SteamService] Failed to get cloud quota:', err.message);
            return { supported: false, error: err.message };
        }
    }

    async cloudGetTimestamp(filename) {
        if (!ipcRenderer || !this.isOnline) {
            return { supported: false, timestamp: null };
        }

        try {
            return await ipcRenderer.invoke(STEAM_IPC.CLOUD_GET_TIMESTAMP, { filename });
        } catch (err) {
            console.warn('[SteamService] Failed to get cloud timestamp:', err.message);
            return { supported: false, timestamp: null, error: err.message };
        }
    }
}

// Export singleton instance getter and class
export { SteamService };
export default SteamService.getInstance();
