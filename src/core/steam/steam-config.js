/**
 * Steam Configuration Constants
 * Centralized configuration for Steam integration
 */

// Steam App ID
// 480 = Spacewar (Valve's test app) - use for development
// Replace with your registered AppID for production
export const STEAM_APP_ID = 480;

// Retry configuration for Steam initialization
export const STEAM_RETRY = {
    MAX_ATTEMPTS: 3,
    BASE_DELAY_MS: 500, // Exponential backoff: 500ms, 1000ms, 2000ms
};

// Connection monitoring
export const STEAM_CONNECTION = {
    CHECK_INTERVAL_MS: 30000, // Check every 30 seconds
    TIMEOUT_MS: 5000, // Timeout for connection checks
};

// Avatar configuration
export const AVATAR_SIZES = {
    SMALL: 32, // List views, HUD
    MEDIUM: 64, // Player cards, waiting room
    LARGE: 184, // Profile, match results
};

// Avatar cache settings
export const AVATAR_CACHE = {
    TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
    STORAGE_KEY_PREFIX: 'steamAvatar_',
    MAX_MEMORY_ENTRIES: 50, // LRU eviction threshold
    MAX_STORAGE_ENTRIES: 100, // localStorage limit
    BATCH_CONCURRENCY: 4, // Max parallel avatar fetches
};

// Friend/persona state values
export const PERSONA_STATE = {
    OFFLINE: 0,
    ONLINE: 1,
    BUSY: 2,
    AWAY: 3,
    SNOOZE: 4,
    LOOKING_TO_TRADE: 5,
    LOOKING_TO_PLAY: 6,
};

// Map persona state to display string
export const PERSONA_STATE_LABELS = {
    [PERSONA_STATE.OFFLINE]: 'Offline',
    [PERSONA_STATE.ONLINE]: 'Online',
    [PERSONA_STATE.BUSY]: 'Busy',
    [PERSONA_STATE.AWAY]: 'Away',
    [PERSONA_STATE.SNOOZE]: 'Snooze',
    [PERSONA_STATE.LOOKING_TO_TRADE]: 'Looking to Trade',
    [PERSONA_STATE.LOOKING_TO_PLAY]: 'Looking to Play',
};

// LocalStorage keys
export const STEAM_STORAGE_KEYS = {
    OFFLINE_QUEUE: 'steamOfflineQueue',
    CACHED_PLAYER: 'steamCachedPlayer',
    AVATAR_CACHE: 'steamAvatarCache',
    STATS_CACHE: 'steamStatsCache',
    LEADERBOARD_CACHE: 'steamLeaderboardCache',
    CLOUD_MANIFEST: 'steamCloudManifest',
    CLOUD_DEVICE_ID: 'steamCloudDeviceId',
};

// Steam events emitted by SteamService
export const STEAM_EVENTS = {
    // Initialization events
    READY: 'steam:ready', // Steam fully initialized, ready to use
    INIT_FAILED: 'steam:initFailed', // Steam init failed after all retries

    // Connection events
    CONNECTED: 'steam:connected', // Steam connection established
    DISCONNECTED: 'steam:disconnected', // Steam connection lost
    RECONNECTED: 'steam:reconnected', // Steam reconnected after disconnect

    // Player events
    PLAYER_UPDATED: 'steam:playerUpdated', // Player data changed (name, avatar)

    // Capability/state events
    CAPABILITIES_UPDATED: 'steam:capabilitiesUpdated',
    STATE_CHANGED: 'steam:stateChanged',

    // Queue events
    QUEUE_FLUSHED: 'steam:queueFlushed', // Offline queue synced to Steam

    // Social events
    INVITE_RECEIVED: 'steam:inviteReceived', // Steam lobby invite / join request received
};

// IPC channel names for main/renderer communication
export const STEAM_IPC = {
    // Status
    IS_INITIALIZED: 'steam:isInitialized',
    GET_CONNECTION_STATUS: 'steam:getConnectionStatus',
    CHECK_CONNECTION: 'steam:checkConnection',
    GET_APP_ID: 'steam:getAppId',

    // Player
    GET_STEAM_ID: 'steam:getSteamId',
    GET_PLAYER_NAME: 'steam:getPlayerName',
    GET_AVATAR: 'steam:getAvatar',
    GET_CAPABILITIES: 'steam:getCapabilities',

    // Lobbies (existing)
    IS_STEAM_RUNNING: 'steam:isSteamRunning',
    CREATE_LOBBY: 'steam:createLobby',
    JOIN_LOBBY: 'steam:joinLobby',
    LEAVE_LOBBY: 'steam:leaveLobby',
    GET_LOBBIES: 'steam:getLobbies',
    GET_LOBBY_DATA: 'steam:getLobbyData',
    SET_LOBBY_DATA: 'steam:setLobbyData',
    OPEN_LOBBY_INVITE_DIALOG: 'steam:openLobbyInviteDialog',

    // P2P (existing)
    SEND_P2P_PACKET: 'steam:sendP2PPacket',
    READ_P2P_PACKET: 'steam:readP2PPacket',

    // Stats
    GET_STAT: 'steam:getStat',
    SET_STAT: 'steam:setStat',
    SET_STAT_MAX: 'steam:setStatMax',
    INCREMENT_STAT: 'steam:incrementStat',
    STORE_STATS: 'steam:storeStats',
    GET_STATS: 'steam:getStats',

    // Leaderboards
    UPLOAD_SCORE: 'steam:uploadScore',
    GET_LEADERBOARD: 'steam:getLeaderboard',
    GET_LEADERBOARD_ENTRY: 'steam:getLeaderboardEntry',

    // Cloud Saves (Remote Storage)
    CLOUD_WRITE: 'steam:cloudWrite',
    CLOUD_READ: 'steam:cloudRead',
    CLOUD_DELETE: 'steam:cloudDelete',
    CLOUD_EXISTS: 'steam:cloudExists',
    CLOUD_GET_QUOTA: 'steam:cloudGetQuota',
    CLOUD_GET_TIMESTAMP: 'steam:cloudGetTimestamp',
};

// Default player info for offline mode
export const STEAM_DEFAULTS = {
    PLAYER_NAME: 'Player',
    STEAM_ID: null,
    AVATAR: null, // Will use default avatar component
};

// Leaderboard names (versioned to avoid schema/ruleset drift)
export const STEAM_LEADERBOARDS = {
    SINGLE_PLAYER_HIGH_SCORE: 'SinglePlayerHighScore_v1',
    SINGLE_PLAYER_LINES: 'SinglePlayerLines_v1',
    ODYSSEY_TOTAL_STARS: 'OdysseyTotalStars_v1',
    ODYSSEY_LEVEL_TIME_PREFIX: 'OdysseyLevelTime_v1_', // Append level id
    INFINITY_HIGH_SCORE: 'InfinityHighScore_v1',
    INFINITY_SURVIVAL_TIME: 'InfinitySurvivalTime_v1',
    INFINITY_BEST_CASCADE: 'InfinityBestCascade_v1',
    FFA_WIN_RATE: 'FFAWinRate_v1',
    FFA_TOTAL_KILLS: 'FFATotalKills_v1',
};

// Steam stats we track (must match Steamworks config)
export const STEAM_STATS = [
    'total_games_played',
    'total_lines_cleared',
    'total_tspins',
    'total_perfect_clears',
    'best_cascade',
    'odyssey_stars',
    'ffa_wins',
    'ffa_kills',
    'ffa_matches',
    'playtime_minutes',
    'infinity_best_time',
];
