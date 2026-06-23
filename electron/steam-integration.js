/**
 * Serenity Blocks — Steam Integration Module
 *
 * Loaded lazily by main.js AFTER the window is visible.
 * Exports { initSteam, registerSteamIPC, cleanupSteam }.
 *
 * This module handles:
 *   - steamworks.js client initialization (with retry)
 *   - ez-steam-api leaderboard integration
 *   - Steam overlay frame invalidator
 *   - All steam:* IPC handlers
 *   - Steam callback registration & cleanup
 *   - Network probing for connection status
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname, resolve } from 'path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import net from 'net';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let steamworksClient = null;
let steamworksModule = null;
let steamInitialized = false;
let steamServerConnected = null;
let steamSteamId = null;
let steamPlayerName = null;
let currentLobbyId = null;
// steamworks.js 0.4.0 has no matchmaking.getLobbyFromId()/leaveLobby() — lobby
// data/owner/members/leave are only reachable via the Lobby OBJECT returned by
// createLobby()/joinLobby(). Hold onto it for the lobby we're currently in.
let currentLobby = null;
let steamOverlayEnabled = false;
let steamCallbackHandles = [];
let steamStatusPending = false;
let ezSteamApi = null;
let ezSteamInitialized = false;

const DEFAULT_STEAM_APP_ID = 480;
const MAX_P2P_PACKET_BYTES = 64 * 1024;
let steamAppId = null;

const leaderboardHandles = new Map();

// Reference set by initSteam()
let mainWindow = null;
let rendererReady = false;
let emitRuntimeEventFn = () => {};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
let _steamLogPath = null;

function getSteamLogPath() {
    if (_steamLogPath) return _steamLogPath;
    try {
        const logsDir = join(app.getPath('userData'), 'logs');
        mkdirSync(logsDir, { recursive: true });
        _steamLogPath = join(logsDir, 'steam-init.log');
        return _steamLogPath;
    } catch {
        return null;
    }
}

function steamLog(message) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${message}\n`;
    console.log(`[Steam] ${message}`);
    try {
        const logPath = getSteamLogPath();
        if (logPath) appendFileSync(logPath, line, 'utf8');
    } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveSteamAppId() {
    const envAppId = process.env.STEAM_APP_ID;
    if (envAppId && /^\d+$/.test(envAppId)) return Number(envAppId);

    const candidateDirs = [process.cwd(), app.getAppPath(), dirname(process.execPath)];
    for (const dir of candidateDirs) {
        const appIdPath = join(dir, 'steam_appid.txt');
        if (existsSync(appIdPath)) {
            const text = readFileSync(appIdPath, 'utf8').trim();
            if (/^\d+$/.test(text)) return Number(text);
        }
    }
    return DEFAULT_STEAM_APP_ID;
}

function hasUsableSteamClient() {
    return steamInitialized && steamworksClient !== null
        && (Boolean(steamSteamId) || Boolean(steamPlayerName));
}

function toSteamIdValue(steamId) {
    if (!steamId) return steamId;
    if (typeof steamId === 'bigint') return steamId;
    if (typeof steamId === 'number') return BigInt(steamId);
    if (typeof steamId === 'string' && /^\d+$/.test(steamId)) return BigInt(steamId);
    return steamId;
}

function normalizeSteamId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'bigint') return value.toString();
    if (value.steamId64) return value.steamId64.toString();
    if (value.steam_id) return value.steam_id.toString();
    return String(value);
}

function normalizeStatArgs(nameOrPayload, value) {
    if (typeof nameOrPayload === 'object' && nameOrPayload !== null) {
        return { name: nameOrPayload.name, value: nameOrPayload.value, amount: nameOrPayload.amount };
    }
    return { name: nameOrPayload, value, amount: value };
}

function resolveCloudWriteBuffer(data) {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer);
    if (typeof data === 'string') return Buffer.from(data, 'utf8');
    if (data === null || data === undefined) return Buffer.from('', 'utf8');
    return Buffer.from(JSON.stringify(data), 'utf8');
}

function normalizeCloudReadResult(result) {
    if (result == null) return null;
    if (Buffer.isBuffer(result)) return result.toString('utf8');
    if (typeof result === 'string') return result;
    if (result.data && Buffer.isBuffer(result.data)) return result.data.toString('utf8');
    if (typeof result.data === 'string') return result.data;
    return null;
}

// ---------------------------------------------------------------------------
// Steam status & network
// ---------------------------------------------------------------------------

function buildSteamStatusPayload(source = 'unknown') {
    const pending = steamStatusPending
        || (steamInitialized && steamworksClient !== null && steamServerConnected === null);
    return {
        initialized: steamInitialized,
        connected: steamInitialized && steamServerConnected === true,
        pending,
        steamId: steamSteamId,
        playerName: steamPlayerName,
        currentLobbyId,
        source,
    };
}

function emitSteamStatus(source = 'unknown') {
    const payload = buildSteamStatusPayload(source);
    steamLog(`emitSteamStatus(${source}): initialized=${payload.initialized} connected=${payload.connected} pending=${payload.pending} player=${payload.playerName || 'none'}`);
    if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
        mainWindow.webContents.send('steam:status', payload);
    }
    emitRuntimeEventFn('steam-status', payload);
    return payload;
}

function setSteamServerConnection(isConnected, source = 'unknown', payload) {
    if (steamServerConnected === isConnected && !steamStatusPending) return;
    steamServerConnected = isConnected;
    steamStatusPending = false;
    steamLog(`Server connection: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'} (source=${source})`);
    if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
        mainWindow.webContents.send('steam:serverConnection', {
            connected: isConnected, source, payload,
        });
    }
    emitSteamStatus(source);
}

function probeSteamNetwork(timeoutMs = 1500) {
    return new Promise((resolve) => {
        let settled = false;
        const socket = net.connect({ host: 'api.steampowered.com', port: 443 }, () => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(true);
        });
        const finish = () => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(false);
        };
        socket.setTimeout(timeoutMs, finish);
        socket.on('error', finish);
    });
}

// ---------------------------------------------------------------------------
// Steam overlay frame invalidator
// ---------------------------------------------------------------------------

function clearSteamOverlayFrameInvalidator(browserWindow) {
    if (!browserWindow?._steamRepaintInterval) {
        if (browserWindow) browserWindow._steamFrameInvalidatorAttached = false;
        return false;
    }
    clearInterval(browserWindow._steamRepaintInterval);
    browserWindow._steamRepaintInterval = null;
    browserWindow._steamFrameInvalidatorAttached = false;
    return true;
}

function attachSteamOverlayFrameInvalidator(browserWindow, _source = 'unknown') {
    if (!browserWindow || browserWindow.isDestroyed()) return false;
    if (browserWindow._steamFrameInvalidatorAttached) return true;

    browserWindow._steamFrameInvalidatorAttached = true;
    browserWindow._steamRepaintInterval = setInterval(() => {
        if (browserWindow.isDestroyed()) {
            clearSteamOverlayFrameInvalidator(browserWindow);
            return;
        }
        if (!browserWindow.webContents.isPainting()) {
            browserWindow.webContents.invalidate();
        }
    }, 1000 / 60);

    browserWindow.once('closed', () => clearSteamOverlayFrameInvalidator(browserWindow));
    return true;
}

function installSteamOverlayFrameInvalidatorHook() {
    if (steamOverlayEnabled) return true;
    try {
        BrowserWindow.getAllWindows().forEach((bw) =>
            attachSteamOverlayFrameInvalidator(bw, 'existing-window'));
        app.on('browser-window-created', (_event, bw) =>
            attachSteamOverlayFrameInvalidator(bw, 'browser-window-created'));
        steamOverlayEnabled = true;
        steamLog('Steam overlay frame invalidator registered');
        return true;
    } catch (error) {
        steamLog(`WARN: Failed to register overlay frame invalidator: ${error.message}`);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Steam callbacks
// ---------------------------------------------------------------------------

function registerSteamCallbacks() {
    if (!steamworksClient?.callback?.register || !steamworksModule?.SteamCallback) {
        steamLog('WARN: Cannot register callbacks');
        return;
    }
    steamLog('Registering Steam callbacks');

    steamCallbackHandles.forEach((h) => { try { h?.disconnect?.(); } catch {} });
    steamCallbackHandles = [];

    const lobbyJoinHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.GameLobbyJoinRequested,
        (payload) => {
            const lobbyId = payload?.lobby_steam_id?.toString?.() || payload?.lobby_steam_id;
            const friendSteamId = payload?.friend_steam_id?.toString?.() || payload?.friend_steam_id;
            if (lobbyId && mainWindow && !mainWindow.isDestroyed() && rendererReady) {
                mainWindow.webContents.send('steam:lobbyJoinRequested', {
                    lobbyId, friendSteamId, source: 'callback', receivedAt: Date.now(),
                });
            }
        },
    );

    const connectedHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.SteamServersConnected,
        (p) => setSteamServerConnection(true, 'SteamServersConnected', p),
    );
    const disconnectedHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.SteamServersDisconnected,
        (p) => setSteamServerConnection(false, 'SteamServersDisconnected', p),
    );
    const failureHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.SteamServerConnectFailure,
        (p) => setSteamServerConnection(false, 'SteamServerConnectFailure', p),
    );

    // P2P session handshake (legacy ISteamNetworking): when a peer sends us its
    // first packet, Steam raises P2PSessionRequest and DROPS that packet until we
    // explicitly accept the session. Without this, two real machines join the same
    // lobby but never exchange game state (NET_HELLO/NET_WELCOME never arrive).
    // We accept and let the app layer (_validateEnvelope: matchId/nonce/protocol)
    // authorize individual packets.
    const p2pSessionRequestHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.P2PSessionRequest,
        (payload) => {
            const remote = payload?.remote;
            if (remote === undefined || remote === null) return;
            try {
                steamworksClient.networking.acceptP2PSession(BigInt(remote));
                steamLog(`Accepted P2P session from ${remote}`);
            } catch (err) {
                steamLog(`WARN: failed to accept P2P session from ${remote}: ${err.message}`);
            }
        },
    );

    // Surfaced for diagnostics — a connect failure here explains a peer that joins
    // the lobby but never syncs (NAT/firewall, peer quit, or session timeout).
    const p2pSessionFailHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.P2PSessionConnectFail,
        (payload) => {
            steamLog(`WARN: P2P session connect failed remote=${payload?.remote} error=${payload?.error}`);
        },
    );

    steamCallbackHandles.push(
        lobbyJoinHandle, connectedHandle, disconnectedHandle, failureHandle,
        p2pSessionRequestHandle, p2pSessionFailHandle,
    );
}

// ---------------------------------------------------------------------------
// Steam init
// ---------------------------------------------------------------------------

async function initSteamworks(retries = 3) {
    if (steamInitialized && steamworksClient) {
        steamLog('initSteamworks: already initialized');
        return true;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // In packaged builds, native modules are copied to resources/native_modules/
            // via extraResources (not inside the ASAR). In dev, normal require works.
            const override = process.env.STEAMWORKS_MODULE;
            steamLog(`initSteamworks attempt ${attempt}/${retries}: loading steamworks.js (platform=${process.platform}, override=${override || 'none'}, packaged=${app.isPackaged})`);
            let steamworks;
            if (override) {
                steamworks = await import(override);
            } else if (app.isPackaged) {
                const nativeModulesPath = join(process.resourcesPath, 'native_modules');
                const steamworksEntry = join(nativeModulesPath, 'steamworks.js', 'index.js');
                steamLog(`  Resolving from extraResources: ${steamworksEntry}`);
                // Anchor require to steamworks.js dir so its relative require('./dist/...') works
                const nativeRequire = createRequire(steamworksEntry);
                steamworks = nativeRequire(steamworksEntry);
            } else {
                const devRequire = createRequire(import.meta.url);
                steamworks = devRequire('steamworks.js');
            }
            steamworksModule = steamworks;
            steamLog(`Module loaded. exports: ${Object.keys(steamworks).join(', ')}`);

            installSteamOverlayFrameInvalidatorHook();

            steamAppId = resolveSteamAppId();
            steamLog(`Resolved Steam App ID: ${steamAppId}`);
            steamworksClient = steamworks.init(steamAppId);

            if (steamworksClient) {
                steamInitialized = true;
                steamServerConnected = null;
                steamSteamId = steamworksClient.localplayer.getSteamId().steamId64.toString();
                steamPlayerName = steamworksClient.localplayer.getName();
                steamLog(`Steam initialized: player="${steamPlayerName}" steamId=${steamSteamId}`);
                registerSteamCallbacks();
                return true;
            }
            steamLog('WARN: steamworks.init() returned falsy client');
        } catch (err) {
            const delay = Math.pow(2, attempt) * 500;
            steamLog(`ERROR: attempt ${attempt}/${retries} failed: ${err.message}`);
            steamLog(`  Stack: ${err.stack?.split('\n').slice(0, 3).join(' | ')}`);

            // If module import itself fails (wrong platform, missing native binary),
            // don't bother retrying — it won't work.
            if (err.message?.includes('Cannot find module')
                || err.message?.includes('not a valid Win32')
                || err.message?.includes('not supported')
                || err.code === 'ERR_MODULE_NOT_FOUND'
                || err.code === 'ERR_DLOPEN_FAILED') {
                steamLog('  Module load failure is not retryable — aborting');
                break;
            }

            if (attempt < retries) {
                steamLog(`  Retrying in ${delay}ms...`);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }

    steamLog('Steam unavailable after all retries — running offline');
    steamInitialized = false;
    steamworksClient = null;
    steamSteamId = null;
    steamPlayerName = null;
    steamServerConnected = false;
    return false;
}

async function resolveInitialSteamConnection(source = 'steam-init') {
    if (!steamworksClient || !steamInitialized) {
        steamStatusPending = false;
        emitSteamStatus(`${source}:unavailable`);
        return false;
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
        if (steamServerConnected === true || steamServerConnected === false) {
            steamStatusPending = false;
            emitSteamStatus(`${source}:callback`);
            return steamServerConnected;
        }
        try {
            const serverTime = steamworksClient.utils?.getServerRealTime?.();
            if ((typeof serverTime === 'number' || typeof serverTime === 'bigint') && serverTime > 0) {
                setSteamServerConnection(true, `${source}:server-time`, { serverTime, attempt });
                return true;
            }
        } catch {}
        if (attempt < 3) await new Promise((r) => setTimeout(r, 350));
    }

    if (hasUsableSteamClient()) {
        setSteamServerConnection(true, `${source}:client-ready-fallback`);
        return true;
    }

    const networkOk = await probeSteamNetwork(1200);
    if (networkOk) {
        setSteamServerConnection(true, `${source}:network-probe`);
        return true;
    }
    setSteamServerConnection(false, `${source}:network-probe`);
    return false;
}

async function initEzSteamApi() {
    if (!steamInitialized || !steamAppId) return false;
    try {
        // In packaged builds, load from resources/native_modules/ (extraResources)
        // koffi is nested under ez-steam-api/node_modules/ so require('koffi') resolves
        let ezSteamModule;
        if (app.isPackaged) {
            const nativeModulesPath = join(process.resourcesPath, 'native_modules');
            const ezEntry = join(nativeModulesPath, 'ez-steam-api', 'ez-steam-api.js');
            const nativeRequire = createRequire(ezEntry);
            ezSteamModule = nativeRequire(ezEntry);
        } else {
            const devRequire = createRequire(import.meta.url);
            ezSteamModule = devRequire('ez-steam-api');
        }
        ezSteamApi = ezSteamModule.Steam;
        const shouldExit = ezSteamApi.start(steamAppId);
        if (shouldExit) return false;
        ezSteamInitialized = true;
        console.log('[ez-steam-api] Initialized');
        return true;
    } catch (err) {
        console.warn('[ez-steam-api] Init failed:', err.message);
        ezSteamInitialized = false;
        return false;
    }
}

// ---------------------------------------------------------------------------
// Leaderboard helpers
// ---------------------------------------------------------------------------

function getLeaderboardsApi() {
    const candidates = [
        steamworksClient?.leaderboards,
        steamworksClient?.userStats?.leaderboards,
        steamworksClient?.userstats?.leaderboards,
        steamworksClient?.userStats,
        steamworksClient?.userstats,
    ].filter(Boolean);
    for (const api of candidates) {
        if (typeof api.findOrCreateLeaderboard === 'function'
            || typeof api.findLeaderboard === 'function'
            || typeof api.uploadScore === 'function'
            || typeof api.uploadLeaderboardScore === 'function') {
            return api;
        }
    }
    return null;
}

function getRemoteStorageApi() {
    return steamworksClient?.remoteStorage
        || steamworksClient?.remote_storage
        || steamworksClient?.remoteStorageAPI
        || steamworksClient?.remoteStorageApi
        || null;
}

function getAchievementsApi() {
    return steamworksClient?.achievements
        || steamworksClient?.userStats?.achievements
        || steamworksClient?.userstats?.achievements
        || null;
}

function getPersonaName(steamId) {
    if (!steamworksClient?.friends || !steamId) return null;
    try { return steamworksClient.friends.getFriendPersonaName(BigInt(steamId)); } catch { return null; }
}

function normalizeEntries(entries = [], start = 0) {
    return entries.filter(Boolean).map((entry, idx) => ({
        rank: entry.rank ?? entry.globalRank ?? (start + idx + 1),
        steamId: normalizeSteamId(entry.steamId ?? entry.steamId64 ?? entry.userId),
        score: entry.score ?? entry.scoreValue ?? entry.value ?? 0,
        details: entry.details ?? entry.scoreDetails ?? null,
        name: entry.name ?? entry.personaName ?? getPersonaName(normalizeSteamId(entry.steamId ?? entry.steamId64)),
    }));
}

async function resolveLeaderboardHandle(name) {
    if (!name) return null;
    if (leaderboardHandles.has(name)) return leaderboardHandles.get(name);
    const api = getLeaderboardsApi();
    if (!api) return null;
    const findOrCreate = api.findOrCreateLeaderboard || api.findOrCreate;
    const find = api.findLeaderboard || api.find;
    if (typeof findOrCreate === 'function') {
        const sortMethod = api.SortMethod?.Descending ?? 2;
        const displayType = api.DisplayType?.Numeric ?? 1;
        const handle = await findOrCreate(name, sortMethod, displayType);
        leaderboardHandles.set(name, handle);
        return handle;
    }
    if (typeof find === 'function') {
        const handle = await find(name);
        leaderboardHandles.set(name, handle);
        return handle;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize Steam. Call AFTER the window is visible.
 * @param {BrowserWindow} win - The main window
 * @param {Function} emitFn - emitRuntimeEvent function from main.js
 */
export async function initSteam(win, emitFn) {
    mainWindow = win;
    rendererReady = true;
    emitRuntimeEventFn = emitFn || (() => {});

    if (process.env.SERENITY_DISABLE_STEAM_BOOTSTRAP === '1') {
        steamLog('Steam init skipped (SERENITY_DISABLE_STEAM_BOOTSTRAP)');
        emitSteamStatus('disabled');
        return false;
    }

    // Truncate log on each launch
    try {
        const logPath = getSteamLogPath();
        if (logPath) writeFileSync(logPath, `--- Steam Init Log (${new Date().toISOString()}) ---\n`, 'utf8');
    } catch {}

    steamStatusPending = true;
    emitSteamStatus('steam-init:start');

    const steamReady = await initSteamworks();
    if (!steamReady) {
        steamStatusPending = false;
        emitSteamStatus('steam-init:offline');
        emitRuntimeEventFn('steam-init-failed', { error: 'Steam unavailable' });
        return false;
    }

    await resolveInitialSteamConnection('steam-init');

    // Extras (leaderboards) — fire-and-forget
    initEzSteamApi().catch((err) => {
        console.warn('[Steam] ez-steam-api failed:', err.message);
    });

    return true;
}

/**
 * Register all steam:* IPC handlers. Call once at startup.
 * Replaces the stub handlers registered by main.js.
 */
export function registerSteamIPC() {
    // Remove stubs first
    const channels = [
        'steam:isInitialized', 'steam:getSteamId', 'steam:getPlayerName',
        'steam:getAppId', 'steam:getConnectionStatus', 'steam:getCapabilities',
        'steam:isSteamRunning', 'steam:checkConnection', 'steam:getAvatar',
        'steam:setRichPresence', 'steam:clearRichPresence',
        'steam:getStat', 'steam:setStat', 'steam:setStatMax',
        'steam:incrementStat', 'steam:storeStats', 'steam:getStats',
        'steam:uploadScore', 'steam:getLeaderboard', 'steam:getLeaderboardEntry',
        'steam:cloudWrite', 'steam:cloudRead', 'steam:cloudDelete',
        'steam:cloudExists', 'steam:cloudGetQuota', 'steam:cloudGetTimestamp',
        'steam:getFriends', 'steam:getPersonaState',
        'steam:inviteToLobby', 'steam:openLobbyInviteDialog',
        'steam:activateOverlay', 'steam:activateOverlayToUser',
        'steam:createLobby', 'steam:joinLobby', 'steam:leaveLobby',
        'steam:getLobbies', 'steam:getLobbyData', 'steam:setLobbyData',
        'steam:getLobbyMembers', 'steam:getLobbyOwner',
        'steam:sendP2PPacket', 'steam:readP2PPacket',
        'steam:isP2PPacketAvailable', 'steam:closeP2PSession',
        'steam:getDiagnostics',
    ];
    for (const ch of channels) {
        try { ipcMain.removeHandler(ch); } catch {}
    }

    // --- Status ---
    ipcMain.handle('steam:isInitialized', () => steamInitialized);
    ipcMain.handle('steam:getSteamId', () => steamSteamId);
    ipcMain.handle('steam:getPlayerName', () => steamPlayerName);
    ipcMain.handle('steam:getAppId', () => steamAppId);

    ipcMain.handle('steam:getConnectionStatus', () => ({
        initialized: steamInitialized,
        connected: steamInitialized && steamServerConnected === true,
        isOnline: steamInitialized && steamServerConnected === true,
        pending: steamStatusPending || (steamInitialized && steamworksClient !== null && steamServerConnected === null),
        steamId: steamSteamId,
        playerName: steamPlayerName,
        appId: steamAppId,
        currentLobbyId,
    }));

    ipcMain.handle('steam:getCapabilities', () => {
        const lbApi = getLeaderboardsApi();
        const rsApi = getRemoteStorageApi();
        const achApi = getAchievementsApi();
        return {
            steamAvailable: steamInitialized && steamworksClient !== null,
            leaderboards: !!lbApi,
            cloud: !!rsApi,
            friends: !!steamworksClient?.friends,
            achievements: !!achApi,
        };
    });

    ipcMain.handle('steam:isSteamRunning', () => !!steamworksClient);

    ipcMain.handle('steam:checkConnection', async () => {
        if (!steamworksClient || !steamInitialized) return false;
        if (steamServerConnected === true) return true;
        if (steamServerConnected === false) return false;
        try {
            const t = steamworksClient.utils?.getServerRealTime?.();
            if (typeof t === 'number' && t > 0) return true;
        } catch {}
        const ok = await probeSteamNetwork();
        return ok || hasUsableSteamClient();
    });

    // --- Avatar & Rich Presence ---
    ipcMain.handle('steam:getAvatar', async (_event, steamId, size = 'medium') => {
        // steamworks.js 0.4.0 has no friends/avatar API — return null cleanly so the
        // UI falls back to default avatars instead of throwing on every lookup.
        if (!steamworksClient?.friends) return null;
        try {
            const target = steamId || steamSteamId;
            if (!target) return null;
            return await steamworksClient.friends.getFriendAvatar(BigInt(target), size) || null;
        } catch { return null; }
    });

    // Rich presence lives under `localplayer` in steamworks.js 0.4.0 (there is no
    // `friends` namespace). This is what powers "Join Game" on a friend's profile.
    ipcMain.handle('steam:setRichPresence', (_event, key, value) => {
        if (!steamworksClient) return false;
        try { steamworksClient.localplayer.setRichPresence(key, value); return true; } catch { return false; }
    });

    ipcMain.handle('steam:clearRichPresence', () => {
        if (!steamworksClient) return false;
        // 0.4.0 has no clear-all; clear known keys by setting them with no value.
        try {
            ['status', 'connect', 'steam_display'].forEach((k) => {
                try { steamworksClient.localplayer.setRichPresence(k); } catch {}
            });
            return true;
        } catch { return false; }
    });

    // --- Stats ---
    ipcMain.handle('steam:getStat', (_event, nameOrPayload) => {
        if (!steamworksClient?.stats) return null;
        try {
            const { name } = normalizeStatArgs(nameOrPayload);
            return name ? (steamworksClient.stats.getInt(name) ?? null) : null;
        } catch { return null; }
    });

    ipcMain.handle('steam:setStat', (_event, nameOrPayload, value) => {
        if (!steamworksClient?.stats) return false;
        try {
            const { name, value: v } = normalizeStatArgs(nameOrPayload, value);
            if (!name) return false;
            steamworksClient.stats.setInt(name, Number.isFinite(v) ? Math.floor(v) : 0);
            return steamworksClient.stats.store();
        } catch { return false; }
    });

    ipcMain.handle('steam:setStatMax', (_event, nameOrPayload, value) => {
        if (!steamworksClient?.stats) return false;
        try {
            const { name, value: v } = normalizeStatArgs(nameOrPayload, value);
            if (!name) return false;
            const safeValue = Number.isFinite(v) ? Math.floor(v) : 0;
            const current = steamworksClient.stats.getInt(name) ?? 0;
            if (safeValue > current) {
                steamworksClient.stats.setInt(name, safeValue);
                return steamworksClient.stats.store();
            }
            return true;
        } catch { return false; }
    });

    ipcMain.handle('steam:incrementStat', (_event, nameOrPayload, amount) => {
        if (!steamworksClient?.stats) return false;
        try {
            const { name, amount: a } = normalizeStatArgs(nameOrPayload, amount);
            if (!name) return false;
            const delta = Number.isFinite(a) ? Math.floor(a) : 1;
            const current = steamworksClient.stats.getInt(name) ?? 0;
            steamworksClient.stats.setInt(name, current + delta);
            return steamworksClient.stats.store();
        } catch { return false; }
    });

    ipcMain.handle('steam:storeStats', () => {
        if (!steamworksClient?.stats) return false;
        try { return steamworksClient.stats.store(); } catch { return false; }
    });

    ipcMain.handle('steam:getStats', (_event, names) => {
        if (!steamworksClient?.stats) return {};
        try {
            const result = {};
            (Array.isArray(names) ? names : []).forEach((n) => { result[n] = steamworksClient.stats.getInt(n) ?? 0; });
            return result;
        } catch { return {}; }
    });

    // --- Leaderboards ---
    ipcMain.handle('steam:uploadScore', async (_event, payload) => {
        if (!steamworksClient) return { success: false, error: 'Steam not initialized' };
        try {
            const { leaderboardName, score, scoreDetails } = payload || {};
            if (!leaderboardName || !Number.isFinite(score)) {
                return { success: false, error: 'Invalid payload' };
            }
            const handle = await resolveLeaderboardHandle(leaderboardName);
            if (!handle) return { success: false, error: 'Leaderboard not found' };
            const api = getLeaderboardsApi();
            const upload = api.uploadLeaderboardScore || api.uploadScore;
            if (typeof upload !== 'function') return { success: false, error: 'Upload not supported' };
            const method = api.UploadScoreMethod?.KeepBest ?? api.LeaderboardUploadScoreMethod?.KeepBest ?? 1;
            await upload.call(api, handle, method, Math.floor(score), scoreDetails ? [scoreDetails] : []);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('steam:getLeaderboard', async (_event, payload) => {
        if (!steamworksClient) return { entries: [], total: 0 };
        try {
            const { leaderboardName, start = 0, end = 9, type = 'global' } = payload || {};
            const handle = await resolveLeaderboardHandle(leaderboardName);
            if (!handle) return { entries: [], total: 0 };
            const api = getLeaderboardsApi();
            const download = api.downloadLeaderboardEntries || api.downloadEntries;
            if (typeof download !== 'function') return { entries: [], total: 0 };
            const dataRequest = type === 'friends'
                ? (api.DataRequest?.Friends ?? 2)
                : (api.DataRequest?.Global ?? 0);
            const entries = await download.call(api, handle, dataRequest, start, end);
            return { entries: normalizeEntries(entries, start), total: entries?.length ?? 0 };
        } catch { return { entries: [], total: 0 }; }
    });

    ipcMain.handle('steam:getLeaderboardEntry', async (_event, payload) => {
        if (!steamworksClient) return null;
        try {
            const { leaderboardName } = payload || {};
            const handle = await resolveLeaderboardHandle(leaderboardName);
            if (!handle) return null;
            const api = getLeaderboardsApi();
            const download = api.downloadLeaderboardEntriesForUsers || api.downloadEntriesForUsers;
            if (typeof download !== 'function') return null;
            const entries = await download.call(api, handle, [BigInt(steamSteamId)]);
            const normalized = normalizeEntries(entries);
            return normalized[0] || null;
        } catch { return null; }
    });

    // --- Cloud Storage ---
    ipcMain.handle('steam:cloudWrite', async (_event, filename, data) => {
        const api = getRemoteStorageApi();
        if (!api) return false;
        try {
            const buf = resolveCloudWriteBuffer(data);
            const write = api.fileWrite || api.writeFile;
            if (typeof write !== 'function') return false;
            return !!write.call(api, filename, buf);
        } catch { return false; }
    });

    ipcMain.handle('steam:cloudRead', async (_event, filename) => {
        const api = getRemoteStorageApi();
        if (!api) return null;
        try {
            const read = api.fileRead || api.readFile;
            if (typeof read !== 'function') return null;
            return normalizeCloudReadResult(read.call(api, filename));
        } catch { return null; }
    });

    ipcMain.handle('steam:cloudDelete', async (_event, filename) => {
        const api = getRemoteStorageApi();
        if (!api) return false;
        try {
            const del = api.fileDelete || api.deleteFile;
            return typeof del === 'function' ? !!del.call(api, filename) : false;
        } catch { return false; }
    });

    ipcMain.handle('steam:cloudExists', async (_event, filename) => {
        const api = getRemoteStorageApi();
        if (!api) return false;
        try {
            const exists = api.fileExists || api.exists;
            return typeof exists === 'function' ? !!exists.call(api, filename) : false;
        } catch { return false; }
    });

    ipcMain.handle('steam:cloudGetQuota', async () => {
        const api = getRemoteStorageApi();
        if (!api) return { total: 0, available: 0 };
        try {
            const quota = api.getQuota?.();
            return quota || { total: 0, available: 0 };
        } catch { return { total: 0, available: 0 }; }
    });

    ipcMain.handle('steam:cloudGetTimestamp', async (_event, filename) => {
        const api = getRemoteStorageApi();
        if (!api) return null;
        try {
            return api.getFileTimestamp?.(filename) ?? null;
        } catch { return null; }
    });

    // --- Friends & Social ---
    ipcMain.handle('steam:getFriends', async () => {
        if (!steamworksClient) return [];
        try {
            const count = steamworksClient.friends.getFriendCount(0x04);
            const friends = [];
            for (let i = 0; i < count; i++) {
                const fid = steamworksClient.friends.getFriendByIndex(i, 0x04);
                const name = steamworksClient.friends.getFriendPersonaName(fid);
                const state = steamworksClient.friends.getFriendPersonaState(fid);
                const gameInfo = steamworksClient.friends.getFriendGamePlayed(fid);
                friends.push({
                    steamId: fid.steamId64.toString(), name, personaState: state,
                    isOnline: state !== 0, inGame: !!gameInfo,
                    gameId: gameInfo?.gameId?.toString() || null,
                });
            }
            friends.sort((a, b) => (a.isOnline !== b.isOnline ? (b.isOnline ? 1 : -1) : a.name.localeCompare(b.name)));
            return friends;
        } catch { return []; }
    });

    ipcMain.handle('steam:getPersonaState', (_event, steamId) => {
        if (!steamworksClient) return 0;
        try { return steamworksClient.friends.getFriendPersonaState(BigInt(steamId)); } catch { return 0; }
    });

    // steamworks.js 0.4.0 has no "invite a specific user to lobby" API; the only
    // path is the Steam overlay invite dialog (the user picks the friend there).
    ipcMain.handle('steam:inviteToLobby', (_event, friendSteamId, lobbyId) => {
        if (!steamworksClient) return false;
        try {
            if (currentLobby?.openInviteDialog) { currentLobby.openInviteDialog(); return true; }
            const target = lobbyId || currentLobbyId;
            if (!target) return false;
            steamworksClient.overlay.activateInviteDialog(BigInt(target));
            return true;
        } catch { return false; }
    });

    ipcMain.handle('steam:openLobbyInviteDialog', (_event, lobbyId) => {
        if (!steamworksClient) return false;
        try {
            if (currentLobby?.openInviteDialog) { currentLobby.openInviteDialog(); return true; }
            const target = lobbyId || currentLobbyId;
            if (!target) return false;
            steamworksClient.overlay.activateInviteDialog(BigInt(target));
            return true;
        } catch { return false; }
    });

    // steamworks.js 0.4.0 overlay API: activateDialog(Dialog) / activateDialogToUser(Dialog, steamId64).
    // Dialog is a numeric enum: Friends=0, Community=1, Players=2, Settings=3,
    // OfficialGameGroup=4, Stats=5, Achievements=6. (overlay.activate/activateToUser do not exist.)
    const OVERLAY_DIALOG = {
        friends: 0, community: 1, players: 2, settings: 3, officialgamegroup: 4, stats: 5, achievements: 6,
    };
    ipcMain.handle('steam:activateOverlay', (_event, type) => {
        if (!steamworksClient) return false;
        try {
            const dialog = OVERLAY_DIALOG[String(type || 'friends').toLowerCase()] ?? 0;
            steamworksClient.overlay.activateDialog(dialog);
            return true;
        } catch { return false; }
    });

    ipcMain.handle('steam:activateOverlayToUser', (_event, type, steamId) => {
        if (!steamworksClient) return false;
        try {
            const dialog = OVERLAY_DIALOG[String(type || 'friends').toLowerCase()] ?? 0;
            steamworksClient.overlay.activateDialogToUser(dialog, BigInt(steamId));
            return true;
        } catch { return false; }
    });

    // --- Lobbies ---
    ipcMain.handle('steam:createLobby', async (_event, options) => {
        if (!steamworksClient) throw new Error('Steam not initialized');
        const { maxPlayers = 8, lobbyType = 'public' } = options || {};
        const type = lobbyType === 'public' ? 2 : 1;
        const lobby = await steamworksClient.matchmaking.createLobby(type, maxPlayers);
        currentLobby = lobby;
        currentLobbyId = lobby.id.toString();
        return currentLobbyId;
    });

    ipcMain.handle('steam:joinLobby', async (_event, lobbyId) => {
        if (!steamworksClient) throw new Error('Steam not initialized');
        // joinLobby() RESOLVES to the Lobby object — keep it; it's the only handle
        // to the lobby's owner/members/data in steamworks.js 0.4.0.
        const lobby = await steamworksClient.matchmaking.joinLobby(BigInt(lobbyId));
        currentLobby = lobby || null;
        currentLobbyId = lobby?.id ? lobby.id.toString() : String(lobbyId);
        return true;
    });

    ipcMain.handle('steam:leaveLobby', () => {
        if (!currentLobby) { currentLobbyId = null; return; }
        try { currentLobby.leave(); } catch {}
        currentLobby = null;
        currentLobbyId = null;
    });

    ipcMain.handle('steam:getLobbies', async () => {
        if (!steamworksClient) return [];
        try {
            const lobbies = await steamworksClient.matchmaking.getLobbies();
            return lobbies
                .filter((l) => l.getData('game_mode') === 'ffa')
                .map((l) => ({
                    id: l.id.toString(),
                    name: l.getData('game_name') || '[No name]',
                    mode: l.getData('game_mode') || 'ffa',
                    players: l.getMemberCount(),
                    maxPlayers: l.getMemberLimit(),
                    endCondition: l.getData('end_condition') || 'frags',
                    endConditionValue: l.getData('end_condition_value') || '10',
                }));
        } catch { return []; }
    });

    // All per-lobby reads/writes go through the live Lobby object (currentLobby),
    // since steamworks.js 0.4.0 has no getLobbyFromId(id) lookup. We're only ever
    // in one lobby at a time, so the lobbyId arg is accepted for compatibility but
    // currentLobby is authoritative.
    ipcMain.handle('steam:getLobbyData', (_event, lobbyId, key) => {
        if (!currentLobby) return null;
        try { return currentLobby.getData(key) || null; } catch { return null; }
    });

    ipcMain.handle('steam:setLobbyData', (_event, lobbyId, key, value) => {
        if (!currentLobby) return false;
        try { return !!currentLobby.setData(key, String(value)); } catch { return false; }
    });

    ipcMain.handle('steam:getLobbyMembers', (_event, lobbyId) => {
        if (!currentLobby) return [];
        try {
            return currentLobby.getMembers().map((m) => {
                const id = m.steamId64.toString();
                return { steamId: id, name: getPersonaName(id) };
            });
        } catch { return []; }
    });

    ipcMain.handle('steam:getLobbyOwner', (_event, lobbyId) => {
        if (!currentLobby) return null;
        try { return currentLobby.getOwner()?.steamId64?.toString() || null; } catch { return null; }
    });

    // --- P2P Networking ---
    // steamworks.js 0.4.0 P2P is single-channel and its signatures are:
    //   sendP2PPacket(steamId64, sendType, data)   — NOT (steamId, data, sendType, channel)
    //   isP2PPacketAvailable() -> next packet size  — takes no channel
    //   readP2PPacket(size)    -> { data, steamId } — takes the size, not a channel
    // The previous call sites used the old greenworks/channel argument order, so
    // real-Steam sends/reads silently failed (mock BroadcastChannel mode masked it).
    ipcMain.handle('steam:sendP2PPacket', (_event, steamId, data, sendType /* channel unused */) => {
        if (!steamworksClient) return false;
        try {
            const buffer = Buffer.from(JSON.stringify(data));
            const type = Number.isInteger(sendType) ? sendType : 2; // default: Reliable
            return steamworksClient.networking.sendP2PPacket(BigInt(steamId), type, buffer);
        } catch (err) {
            steamLog(`WARN: sendP2PPacket failed: ${err.message}`);
            return false;
        }
    });

    ipcMain.handle('steam:readP2PPacket', () => {
        if (!steamworksClient) return null;
        try {
            const size = steamworksClient.networking.isP2PPacketAvailable();
            if (!size) return null;
            if (size > MAX_P2P_PACKET_BYTES) {
                // Drain an oversized/garbage packet without buffering it.
                try { steamworksClient.networking.readP2PPacket(size); } catch {}
                return null;
            }
            const packet = steamworksClient.networking.readP2PPacket(size);
            if (!packet || !packet.data) return null;
            return { steamId: packet.steamId.steamId64.toString(), data: packet.data.toString('utf8') };
        } catch { return null; }
    });

    ipcMain.handle('steam:isP2PPacketAvailable', () => {
        if (!steamworksClient) return 0;
        try { return steamworksClient.networking.isP2PPacketAvailable() || 0; } catch { return 0; }
    });

    ipcMain.handle('steam:closeP2PSession', (_event, _steamId) => {
        // steamworks.js 0.4.0 exposes no closeP2PSession API — sessions time out on
        // their own. No-op kept so renderer calls remain harmless.
    });

    // --- Diagnostics ---
    ipcMain.handle('steam:getDiagnostics', () => ({
        steamInitialized, steamServerConnected, steamSteamId,
        steamPlayerName, steamAppId, steamStatusPending,
        ezSteamInitialized, platform: process.platform,
        arch: process.arch, isPackaged: app.isPackaged,
    }));
}

/**
 * Clean up Steam resources. Call on app quit.
 */
export function cleanupSteam() {
    steamCallbackHandles.forEach((h) => { try { h?.disconnect?.(); } catch {} });
    steamCallbackHandles = [];

    if (steamworksClient) {
        try {
            steamworksClient.localplayer?.setRichPresence?.('status');
            steamworksClient.localplayer?.setRichPresence?.('connect');
        } catch {}
        try { currentLobby?.leave?.(); } catch {}
        steamworksClient = null;
    }
    currentLobby = null;
    currentLobbyId = null;
    steamInitialized = false;
}
