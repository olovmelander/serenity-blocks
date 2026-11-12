/**
 * Serenity Blocks — Steam Integration Module
 *
 * Loaded lazily by main.js AFTER the window is visible.
 * Exports { initSteam, registerSteamIPC, cleanupSteam }.
 *
 * This module handles:
 *   - steamworks.js client initialization (with retry)
 *   - Steam overlay frame invalidator
 *   - All steam:* IPC handlers
 *   - Steam callback registration & cleanup
 *   - Network probing for connection status
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join, resolve } from 'path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import net from 'net';
import { decodeP2PPacketBody, encodeP2PPacketBody, resolveP2PSendType } from './p2p-packet-codec.js';
import { lobbyMemberChange } from './steam-peer-events.js';
import { isStoreBuild, resolveSteamAppId as resolveSteamAppIdFor } from './steam-app-id.js';
import { createP2PSessionGate } from './p2p-session-gate.js';
import { steamLobbyType } from './steam-lobby-type.js';
import { steamProfileUrl } from './steam-profile.js';
import { allowsDirectP2P } from './debug-flags.js';
import {
    RESULT_OK, SESSION_STATE, openRelayTransport, steamApiLibraryPath,
} from './steam-relay-transport.js';
import { RELAY_UNAVAILABLE_MESSAGE, describeNetworkTransport, lobbyAllowed } from './steam-network-transport.js';

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
// Who the game opens P2P sessions with: lobby members only, and for everyone but the host,
// the host alone (electron/p2p-session-gate.js).
let p2pSessionGate = null;
// How online play reaches other players (electron/steam-network-transport.js): through Steam's
// relays (electron/steam-relay-transport.js), or not at all. Direct P2P (the legacy calls, which
// show IP addresses) only in a development run that asks for it (SERENITY_ALLOW_DIRECT_P2P).
let relayTransport = null;
let networkMode = 'none';
let networkReason = 'Steam is not running';
// Players the relay transport has exchanged packets with in this lobby, and the state each
// session was last seen in (sessions are closed when we leave; a broken one is reported).
const relayPeers = new Map();
let relayAcceptedAt = 0;
let relayCheckedAt = 0;
const RELAY_ACCEPT_EVERY_MS = 200;
const RELAY_CHECK_EVERY_MS = 1000;
let steamOverlayEnabled = false;
let steamCallbackHandles = [];
let steamStatusPending = false;

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

/** electron/steam-app-id.js decides; a packaged build reads no file or variable. */
function resolveSteamAppId() {
    return resolveSteamAppIdFor({
        isPackaged: app.isPackaged,
        env: process.env,
        readAppIdFile: () => {
            for (const dir of [process.cwd(), app.getAppPath()]) {
                const appIdPath = join(dir, 'steam_appid.txt');
                if (existsSync(appIdPath)) return readFileSync(appIdPath, 'utf8');
            }
            return null;
        },
    });
}

/** Whether a SteamID belongs to a member of the lobby we are in right now. */
function isCurrentLobbyMember(steamId) {
    if (!currentLobby || !steamId) return false;
    try {
        return (currentLobby.getMembers?.() || []).some((member) => normalizeSteamId(member) === String(steamId));
    } catch {
        return false;
    }
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
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
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
        // No forced repaint while minimized (audit SB-03): the Steam overlay
        // cannot be used on a minimized window, and the invalidate() below
        // otherwise keeps the compositor producing frames at 60Hz for as long
        // as the window stays minimized. Resumes automatically on restore.
        if (browserWindow.isMinimized()) {
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

function sendToRenderer(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
        mainWindow.webContents.send(channel, payload);
    }
}

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
    // Accepting connects the two machines (directly when Steam can), so only members
    // of our lobby are accepted, and by everyone but the host only the host
    // (electron/p2p-session-gate.js); the app layer (_validateEnvelope:
    // matchId/nonce/protocol) still authorizes each packet.
    p2pSessionGate = createP2PSessionGate({
        accept: (steamId) => steamworksClient.networking.acceptP2PSession(BigInt(steamId)),
        isMember: isCurrentLobbyMember,
        log: steamLog,
    });
    // Only a development run that allows direct play accepts these: otherwise online play runs
    // through Steam's relays, and a peer asking the legacy way (which connects directly) is
    // never accepted.
    const ignoredDirectRequests = new Set();
    const p2pSessionRequestHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.P2PSessionRequest,
        (payload) => {
            const remote = normalizeSteamId(payload?.remote);
            if (!remote) return;
            if (networkMode !== 'direct') {
                if (!ignoredDirectRequests.has(remote) && ignoredDirectRequests.size < 64) {
                    ignoredDirectRequests.add(remote);
                    steamLog(`Ignored a direct P2P session request from ${remote} `
                        + '(online play runs through Steam\'s relays)');
                }
                return;
            }
            p2pSessionGate?.onRequest(remote);
        },
    );

    // A connect failure explains a peer that joins the lobby but never syncs (NAT or
    // firewall, a quit, a session timeout). The renderer treats it as that peer gone.
    const p2pSessionFailHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.P2PSessionConnectFail,
        (payload) => {
            steamLog(`WARN: P2P session connect failed remote=${payload?.remote} error=${payload?.error}`);
            sendToRenderer('steam:p2pSessionFailed', {
                steamId: payload?.remote?.toString?.() ?? null,
                error: Number(payload?.error) || 0,
            });
        },
    );

    // Lobby members leaving, dropping, kicked or banned: the renderer learns of a
    // departure at once instead of after the silence timeout.
    const lobbyMemberHandle = steamworksClient.callback.register(
        steamworksModule.SteamCallback.LobbyChatUpdate,
        (payload) => {
            const change = lobbyMemberChange(payload?.member_state_change);
            if (!change) return;
            p2pSessionGate?.onMembersChanged();
            sendToRenderer('steam:lobbyMember', {
                lobbyId: payload?.lobby?.toString?.() ?? null,
                steamId: payload?.user_changed?.toString?.() ?? null,
                change,
            });
        },
    );

    steamCallbackHandles.push(
        lobbyJoinHandle, connectedHandle, disconnectedHandle, failureHandle,
        p2pSessionRequestHandle, p2pSessionFailHandle, lobbyMemberHandle,
    );
}

// ---------------------------------------------------------------------------
// Steam init
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Network transport: Steam's relays only (electron/steam-relay-transport.js)
// ---------------------------------------------------------------------------

/** koffi, from beside steamworks.js in a packaged build, from node_modules in development. */
function loadKoffi() {
    if (app.isPackaged) {
        const entry = join(process.resourcesPath, 'native_modules', 'koffi', 'index.cjs');
        return createRequire(entry)(entry);
    }
    return createRequire(import.meta.url)('koffi');
}

/**
 * Open the relay transport once Steam runs. If it cannot open, online play is refused
 * (`unavailable`), unless a development run allows the direct legacy calls.
 * @param {string | null} steamworksDir
 */
function startNetworkTransport(steamworksDir) {
    relayTransport?.dispose();
    relayTransport = null;
    relayPeers.clear();
    let koffi = null;
    let reason = null;
    try {
        koffi = loadKoffi();
    } catch (error) {
        reason = `koffi did not load: ${error?.message || error}`;
    }
    if (koffi) {
        const opened = openRelayTransport({
            koffi,
            libraryPath: steamApiLibraryPath(steamworksDir, process.platform, join),
            maxMessageBytes: MAX_P2P_PACKET_BYTES,
            log: steamLog,
        });
        if (opened.ok) {
            relayTransport = opened.transport;
            networkMode = 'relay';
            networkReason = null;
            return;
        }
        ({ reason } = opened);
    }
    const directAllowed = allowsDirectP2P({
        env: process.env,
        storeBuild: isStoreBuild({ isPackaged: app.isPackaged }),
    });
    networkMode = directAllowed ? 'direct' : 'unavailable';
    networkReason = reason;
    steamLog(directAllowed
        ? `WARN: relay transport unavailable (${reason}); SERENITY_ALLOW_DIRECT_P2P: `
            + 'online play connects directly and shows IP addresses'
        : `WARN: relay transport unavailable (${reason}); online play is refused`);
}

/** The lobby's members other than us, as SteamID64 strings. */
function otherLobbyMembers() {
    if (!currentLobby) return [];
    try {
        return (currentLobby.getMembers?.() || [])
            .map((member) => normalizeSteamId(member))
            .filter((id) => id && id !== steamSteamId);
    } catch {
        return [];
    }
}

/**
 * Keep the relay sessions right, called as packets are read: accept the pending session of
 * every lobby member the gate allows (steamworks.js cannot pass the request callback on), and
 * now and then look at each session: report one that broke, and close one that is not relayed
 * (which, with ICE off, should never happen).
 */
function pumpRelaySessions() {
    if (!relayTransport || !currentLobby) return;
    const now = Date.now();
    if (now - relayAcceptedAt >= RELAY_ACCEPT_EVERY_MS) {
        relayAcceptedAt = now;
        for (const steamId of otherLobbyMembers()) {
            const accepted = p2pSessionGate?.allowsSession(steamId) && relayTransport.acceptFrom(steamId);
            if (accepted && !relayPeers.has(steamId)) {
                relayPeers.set(steamId, SESSION_STATE.none);
                steamLog(`Accepted a relayed session from lobby member ${steamId}`);
            }
        }
    }
    if (now - relayCheckedAt < RELAY_CHECK_EVERY_MS) return;
    relayCheckedAt = now;
    for (const [steamId, before] of relayPeers) {
        const session = relayTransport.session(steamId);
        if (session.state === before) continue;
        relayPeers.set(steamId, session.state);
        if (session.state === SESSION_STATE.connected) {
            steamLog(`Session with ${steamId}: connected, relayed=${session.relayed}, `
                + `peer address known=${session.addressKnown}`);
            if (session.layoutOk && !session.relayed) {
                steamLog(`WARN: session with ${steamId} is not relayed; closing it`);
                relayTransport.close(steamId);
                relayPeers.delete(steamId);
                sendToRenderer('steam:p2pSessionFailed', { steamId, error: 'not-relayed' });
            }
        } else if (session.state === SESSION_STATE.closedByPeer || session.state === SESSION_STATE.problem) {
            steamLog(`WARN: relayed session with ${steamId} ended (state ${session.state})`);
            sendToRenderer('steam:p2pSessionFailed', { steamId, error: session.state });
        }
    }
}

/** We left the lobby (or Steam is going): close every relayed session. */
function closeRelaySessions() {
    if (!relayTransport) return;
    for (const steamId of relayPeers.keys()) {
        try {
            relayTransport.close(steamId);
        } catch (error) {
            steamLog(`WARN: closing the relayed session with ${steamId} failed: ${error?.message || error}`);
        }
    }
    relayPeers.clear();
}

async function initSteamworks(retries = 3) {
    if (steamInitialized && steamworksClient) {
        steamLog('initSteamworks: already initialized');
        return true;
    }

    const resolvedAppId = resolveSteamAppId();
    if (!resolvedAppId.appId) {
        steamLog(`Steam off: ${resolvedAppId.reason}`);
        retries = 0;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // In packaged builds, native modules are copied to resources/native_modules/
            // via extraResources (not inside the ASAR). In dev, normal require works.
            // Unpackaged runs only (the DevTools smoke stubs Steam with it): in a
            // release it let an environment variable load any script into the
            // signed game's main process (audit T14).
            const override = app.isPackaged ? null : process.env.STEAMWORKS_MODULE;
            steamLog(`initSteamworks attempt ${attempt}/${retries}: loading steamworks.js (platform=${process.platform}, override=${override || 'none'}, packaged=${app.isPackaged})`);
            let steamworks;
            // Where steamworks.js (and the Steam API library it loads) lives: the relay
            // transport calls into that same library. A stubbed module has none.
            let steamworksDir = null;
            if (override) {
                steamworks = await import(override);
            } else if (app.isPackaged) {
                const nativeModulesPath = join(process.resourcesPath, 'native_modules');
                const steamworksEntry = join(nativeModulesPath, 'steamworks.js', 'index.js');
                steamLog(`  Resolving from extraResources: ${steamworksEntry}`);
                // Anchor require to steamworks.js dir so its relative require('./dist/...') works
                const nativeRequire = createRequire(steamworksEntry);
                steamworks = nativeRequire(steamworksEntry);
                steamworksDir = dirname(steamworksEntry);
            } else {
                const devRequire = createRequire(import.meta.url);
                steamworks = devRequire('steamworks.js');
                steamworksDir = dirname(devRequire.resolve('steamworks.js'));
            }
            steamworksModule = steamworks;
            steamLog(`Module loaded. exports: ${Object.keys(steamworks).join(', ')}`);

            installSteamOverlayFrameInvalidatorHook();

            steamAppId = resolvedAppId.appId;
            steamLog(`Resolved Steam App ID: ${steamAppId} (${resolvedAppId.source})`);
            // A shipped build started outside the Steam client hands itself to Steam, which
            // launches it again as the game (Steamworks' DRM/launch contract).
            if (app.isPackaged && steamworks.restartAppIfNecessary?.(steamAppId)) {
                steamLog('Started outside Steam — relaunching through the Steam client');
                app.quit();
                return false;
            }
            steamworksClient = steamworks.init(steamAppId);

            if (steamworksClient) {
                steamInitialized = true;
                steamServerConnected = null;
                steamSteamId = steamworksClient.localplayer.getSteamId().steamId64.toString();
                steamPlayerName = steamworksClient.localplayer.getName();
                steamLog(`Steam initialized: player="${steamPlayerName}" steamId=${steamSteamId}`);
                // Before any callback can accept a session: online play goes through the relays.
                startNetworkTransport(steamworksDir);
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
    return steamworksClient?.cloud
        || steamworksClient?.remoteStorage
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
        // Steam KeepBest uses the board's sort order; lower completion times win.
        // Include historical campaigns so replaying an offline queue stays correct.
        const isOdysseyTime = /^OdysseyLevelTime_v[1-9]\d*_[1-9]\d*$/.test(name);
        const sortMethod = isOdysseyTime
            ? (api.SortMethod?.Ascending ?? 1)
            : (api.SortMethod?.Descending ?? 2);
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
        'steam:isP2PPacketAvailable', 'steam:closeP2PSession', 'steam:setP2PPeerPolicy',
        'steam:getNetworkTransport', 'steam:getDiagnostics',
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
            if (steamworksClient.stats.setInt(name, Number.isFinite(v) ? Math.floor(v) : 0) === false) return false;
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
                if (steamworksClient.stats.setInt(name, safeValue) === false) return false;
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
            if (steamworksClient.stats.setInt(name, current + delta) === false) return false;
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
        if (!steamworksClient) return { supported: false, entries: [], total: 0 };
        try {
            const { leaderboardName, start = 0, end = 9, type = 'global' } = payload || {};
            const handle = await resolveLeaderboardHandle(leaderboardName);
            if (!handle) return { supported: false, entries: [], total: 0 };
            const api = getLeaderboardsApi();
            const download = api.downloadLeaderboardEntries || api.downloadEntries;
            if (typeof download !== 'function') return { supported: false, entries: [], total: 0 };
            const dataRequest = type === 'friends'
                ? (api.DataRequest?.Friends ?? 2)
                : (api.DataRequest?.Global ?? 0);
            const entries = await download.call(api, handle, dataRequest, start, end);
            return { supported: true, entries: normalizeEntries(entries, start), total: entries?.length ?? 0 };
        } catch { return { supported: false, entries: [], total: 0 }; }
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
        if (!api) return { supported: false, success: false };
        try {
            const buf = resolveCloudWriteBuffer(data);
            const write = api.fileWrite || api.writeFile;
            if (typeof write !== 'function') return { supported: false, success: false };
            // steamworks.js 0.4 exposes cloud.writeFile(name, content: string).
            // Retain the binary argument for older fileWrite-shaped adapters.
            const content = typeof api.fileWrite === 'function' ? buf : buf.toString('utf8');
            return { supported: true, success: !!write.call(api, filename, content) };
        } catch (error) {
            return { supported: true, success: false, error: error.message };
        }
    });

    ipcMain.handle('steam:cloudRead', async (_event, filename) => {
        const api = getRemoteStorageApi();
        if (!api) return { supported: false, success: false, data: null };
        try {
            const read = api.fileRead || api.readFile;
            if (typeof read !== 'function') return { supported: false, success: false, data: null };
            const exists = api.fileExists || api.exists;
            if (typeof exists === 'function' && !exists.call(api, filename)) {
                return {
                    supported: true, success: true, data: null, missing: true,
                };
            }
            const data = normalizeCloudReadResult(read.call(api, filename));
            // Only an explicit file-existence result establishes safe absence.
            // Null/invalid reads and thrown API failures must not authorize an
            // ownership upload that could erase an unread remote collection.
            if (data === null) {
                return {
                    supported: true, success: false, data: null, error: 'Cloud read failed',
                };
            }
            return { supported: true, success: true, data };
        } catch (error) {
            return {
                supported: true, success: false, data: null, error: error.message,
            };
        }
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

    // 'steamid' is the player's profile, where Steam's own block and report tools are. 0.4.0's
    // activateDialogToUser has no profile dialog, so the overlay's browser opens their profile
    // page (electron/steam-profile.js); the other names are its own dialogs for that user.
    ipcMain.handle('steam:activateOverlayToUser', (_event, type, steamId) => {
        if (!steamworksClient) return false;
        try {
            const kind = String(type || 'steamid').toLowerCase();
            if (kind === 'steamid') {
                const url = steamProfileUrl(steamId);
                if (!url) return false;
                steamworksClient.overlay.activateToWebPage(url);
                return true;
            }
            steamworksClient.overlay.activateDialogToUser(OVERLAY_DIALOG[kind] ?? 0, BigInt(steamId));
            return true;
        } catch { return false; }
    });

    // --- Lobbies ---
    // How online play reaches other players: through Steam's relays, or not at all in a store
    // build (electron/steam-network-transport.js). The page asks before creating or joining.
    ipcMain.handle('steam:getNetworkTransport', () => describeNetworkTransport({
        mode: networkMode,
        reason: networkReason,
        relayNetwork: relayTransport ? relayTransport.relayNetworkStatus() : null,
    }));

    ipcMain.handle('steam:createLobby', async (_event, options) => {
        if (!steamworksClient) throw new Error('Steam not initialized');
        if (!lobbyAllowed(networkMode)) throw new Error(RELAY_UNAVAILABLE_MESSAGE);
        const { maxPlayers = 8, lobbyType = 'friends' } = options || {};
        // public -> 2, friends -> 1, private -> 0 (electron/steam-lobby-type.js).
        const lobby = await steamworksClient.matchmaking.createLobby(steamLobbyType(lobbyType), maxPlayers);
        closeRelaySessions();
        p2pSessionGate?.clear();
        currentLobby = lobby;
        currentLobbyId = lobby.id.toString();
        // We host: every member talks to us.
        p2pSessionGate?.setPolicy({ isHost: true, hostSteamId: steamSteamId });
        return currentLobbyId;
    });

    ipcMain.handle('steam:joinLobby', async (_event, lobbyId) => {
        if (!steamworksClient) throw new Error('Steam not initialized');
        if (!lobbyAllowed(networkMode)) throw new Error(RELAY_UNAVAILABLE_MESSAGE);
        // joinLobby() RESOLVES to the Lobby object — keep it; it's the only handle
        // to the lobby's owner/members/data in steamworks.js 0.4.0.
        const lobby = await steamworksClient.matchmaking.joinLobby(BigInt(lobbyId));
        closeRelaySessions();
        p2pSessionGate?.clear();
        currentLobby = lobby || null;
        currentLobbyId = lobby?.id ? lobby.id.toString() : String(lobbyId);
        // We joined: we talk to the host alone, the lobby's owner until the game says who
        // its host is (steam:setP2PPeerPolicy). Setting it also takes the requests of peers
        // who asked while we were joining and are allowed now.
        let ownerId = null;
        try { ownerId = currentLobby?.getOwner?.()?.steamId64?.toString() ?? null; } catch {}
        p2pSessionGate?.setPolicy({ isHost: false, hostSteamId: ownerId });
        return true;
    });

    ipcMain.handle('steam:leaveLobby', () => {
        closeRelaySessions();
        p2pSessionGate?.clear();
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
                    // BigInt in steamworks.js; plain numbers for the renderer.
                    players: Number(l.getMemberCount()),
                    maxPlayers: Number(l.getMemberLimit() ?? 0),
                    endCondition: l.getData('end_condition') || 'frags',
                    endConditionValue: l.getData('end_condition_value') || '10',
                    // Match lifecycle the host advertises via setLobbyData('status', ...)
                    // so the browser can offer Join / "Join (next round)" / Watch. Empty
                    // (older/un-stamped lobbies) → browser derives status from capacity.
                    status: l.getData('status') || undefined,
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
        // No relay and no development permission to connect directly: nothing is sent.
        if (!lobbyAllowed(networkMode)) return { sent: false, wireBytes: 0, refused: 'no-relay' };
        // Sending opens a session with the target: everyone but the host sends to the host
        // alone (electron/p2p-session-gate.js).
        if (p2pSessionGate && !p2pSessionGate.allowsSend(steamId)) {
            return { sent: false, wireBytes: 0, refused: 'not-host' };
        }
        try {
            // Serialize once at the physical send boundary. Byte views remain
            // byte-exact for the future raw/compact transport lane.
            const buffer = encodeP2PPacketBody(data);
            // Receivers drain and drop anything bigger (steam:readP2PPacket), so sending it
            // only burns upload on a reliable channel. Refuse it here instead (NET-08).
            if (buffer.byteLength > MAX_P2P_PACKET_BYTES) {
                steamLog(`WARN: refusing a ${buffer.byteLength}-byte P2P packet (cap ${MAX_P2P_PACKET_BYTES})`);
                return { sent: false, wireBytes: buffer.byteLength, refused: 'oversize' };
            }
            const type = resolveP2PSendType(sendType, buffer.byteLength); // default: Reliable
            if (relayTransport) {
                const id = String(steamId);
                if (!relayPeers.has(id)) relayPeers.set(id, SESSION_STATE.none);
                const result = relayTransport.send(id, buffer, type);
                if (result !== RESULT_OK) steamLog(`WARN: relayed send to ${id} failed (EResult ${result})`);
                return { sent: result === RESULT_OK, wireBytes: buffer.byteLength };
            }
            const sent = steamworksClient.networking.sendP2PPacket(BigInt(steamId), type, buffer);
            return { sent, wireBytes: buffer.byteLength };
        } catch (err) {
            steamLog(`WARN: sendP2PPacket failed: ${err.message}`);
            return false;
        }
    });

    ipcMain.handle('steam:readP2PPacket', () => {
        if (!steamworksClient) return null;
        if (relayTransport) {
            try {
                pumpRelaySessions();
                const message = relayTransport.next();
                if (!message) return null;
                // Only lobby members the gate allows have a session; anyone else's packet
                // could not have arrived. Kept for the session bookkeeping.
                if (!relayPeers.has(message.steamId)) relayPeers.set(message.steamId, SESSION_STATE.none);
                return {
                    steamId: message.steamId,
                    data: decodeP2PPacketBody(message.data),
                    wireBytes: message.data.byteLength,
                };
            } catch (err) {
                steamLog(`WARN: relayed read failed: ${err.message}`);
                return null;
            }
        }
        if (networkMode !== 'direct') return null;
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
            return {
                steamId: packet.steamId.steamId64.toString(),
                data: decodeP2PPacketBody(packet.data),
                wireBytes: packet.data.byteLength,
            };
        } catch { return null; }
    });

    ipcMain.handle('steam:isP2PPacketAvailable', () => {
        if (!steamworksClient) return 0;
        if (relayTransport) {
            try { return relayTransport.peekSize(); } catch { return 0; }
        }
        if (networkMode !== 'direct') return 0;
        try { return steamworksClient.networking.isP2PPacketAvailable() || 0; } catch { return 0; }
    });

    ipcMain.handle('steam:closeP2PSession', (_event, steamId) => {
        // The relay transport closes the session at once. steamworks.js 0.4.0 has no
        // closeP2PSession for the legacy calls: their sessions time out on their own.
        if (!relayTransport || steamId == null) return;
        try {
            relayTransport.close(String(steamId));
        } catch (error) {
            steamLog(`WARN: closing the relayed session with ${steamId} failed: ${error?.message || error}`);
        }
        relayPeers.delete(String(steamId));
    });

    // The game's role in its match: whether it hosts, who its host is, and whether that host
    // looks gone mid-match (src/core/steam/steam-networking.js _syncP2PPeerPolicy). It decides
    // who P2P sessions are opened with (electron/p2p-session-gate.js). Outside a lobby there
    // is no role to keep.
    ipcMain.handle('steam:setP2PPeerPolicy', (_event, policy) => {
        if (!currentLobby || !p2pSessionGate) return false;
        p2pSessionGate.setPolicy(policy && typeof policy === 'object' ? policy : {});
        return true;
    });

    // --- Diagnostics ---
    ipcMain.handle('steam:getDiagnostics', () => ({
        steamInitialized, steamServerConnected, steamSteamId,
        steamPlayerName, steamAppId, steamStatusPending,
        networkMode, networkReason, relayCounts: relayTransport?.counts() ?? null,
        platform: process.platform,
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
        closeRelaySessions();
        try { currentLobby?.leave?.(); } catch {}
        steamworksClient = null;
    }
    relayTransport?.dispose();
    relayTransport = null;
    networkMode = 'none';
    networkReason = 'Steam is not running';
    currentLobby = null;
    currentLobbyId = null;
    p2pSessionGate?.clear();
    p2pSessionGate = null;
    steamInitialized = false;
}
