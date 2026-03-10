import { app, BrowserWindow, screen, ipcMain, crashReporter, powerMonitor } from 'electron';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { appendFileSync, existsSync, readFileSync } from 'fs';
import * as net from 'net';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Steam overlay in Electron needs these switches set before app ready.
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-direct-composition');

// Steamworks.js integration (for lobbies, P2P, friends, rich presence)
let steamworksClient = null;
let steamworksModule = null;
let steamInitialized = false;
let steamServerConnected = null;
let steamSteamId = null;
let steamPlayerName = null;
let currentLobbyId = null;
let steamOverlayEnabled = false;
const DEFAULT_STEAM_APP_ID = 480;
let steamAppId = null;
let steamCallbackHandles = [];
let pendingLobbyJoins = [];
let rendererReady = false;

// ez-steam-api integration (for leaderboards - steamworks.js doesn't expose leaderboard API)
let ezSteamApi = null;
let ezSteamInitialized = false;
const ezSteamLeaderboardCache = new Map(); // Cache leaderboard handles

function resolveSteamworksModuleSpecifier() {
  const override = process.env.STEAMWORKS_MODULE;
  if (!override) {
    return 'steamworks.js';
  }

  if (override.startsWith('.') || override.startsWith('/') || override.includes('\\')) {
    const absolutePath = override.startsWith('.')
      ? resolve(process.cwd(), override)
      : resolve(override);
    return pathToFileURL(absolutePath).href;
  }

  return override;
}

function parseConnectLobbyArg(argv) {
  const idx = argv.findIndex((arg) => arg === '+connect_lobby');
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return null;
}

function queueLobbyJoin(payload) {
  const normalized = {
    lobbyId: payload?.lobbyId ? String(payload.lobbyId) : null,
    friendSteamId: payload?.friendSteamId ? String(payload.friendSteamId) : null,
    source: payload?.source || 'unknown',
    receivedAt: Date.now(),
  };

  if (!normalized.lobbyId) {
    return;
  }

  // Avoid enqueueing duplicates
  if (pendingLobbyJoins.some((invite) => invite.lobbyId === normalized.lobbyId)) {
    return;
  }

  if (mainWindow && mainWindow.webContents && rendererReady) {
    mainWindow.webContents.send('steam:lobbyJoinRequested', normalized);
    return;
  }

  pendingLobbyJoins.push(normalized);
}

function probeSteamNetwork(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect(
      { host: 'api.steampowered.com', port: 443 },
      () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(true);
      }
    );

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

function setSteamServerConnection(isConnected, source = 'unknown', payload) {
  if (steamServerConnected === isConnected) return;
  steamServerConnected = isConnected;
  console.log(`[Steam] Server connection: ${isConnected ? 'connected' : 'disconnected'} (${source})`);
  if (mainWindow && mainWindow.webContents && rendererReady) {
    mainWindow.webContents.send('steam:serverConnection', {
      connected: isConnected,
      source,
      payload,
    });
  }
}

function registerSteamCallbacks() {
  if (!steamworksClient?.callback?.register || !steamworksModule?.SteamCallback) {
    return;
  }

  // Clean up previous handles if any
  steamCallbackHandles.forEach((handle) => {
    try {
      handle?.disconnect?.();
    } catch (err) {
      console.warn('⚠️ Failed to disconnect Steam callback handle:', err.message);
    }
  });
  steamCallbackHandles = [];

  const lobbyJoinHandle = steamworksClient.callback.register(
    steamworksModule.SteamCallback.GameLobbyJoinRequested,
    (payload) => {
      const lobbyId = payload?.lobby_steam_id?.toString?.() || payload?.lobby_steam_id;
      const friendSteamId = payload?.friend_steam_id?.toString?.() || payload?.friend_steam_id;
      queueLobbyJoin({
        lobbyId,
        friendSteamId,
        source: 'callback',
      });
    }
  );

  const serversConnectedHandle = steamworksClient.callback.register(
    steamworksModule.SteamCallback.SteamServersConnected,
    (payload) => {
      setSteamServerConnection(true, 'SteamServersConnected', payload);
    }
  );

  const serversDisconnectedHandle = steamworksClient.callback.register(
    steamworksModule.SteamCallback.SteamServersDisconnected,
    (payload) => {
      setSteamServerConnection(false, 'SteamServersDisconnected', payload);
    }
  );

  const serverConnectFailureHandle = steamworksClient.callback.register(
    steamworksModule.SteamCallback.SteamServerConnectFailure,
    (payload) => {
      setSteamServerConnection(false, 'SteamServerConnectFailure', payload);
    }
  );

  steamCallbackHandles.push(
    lobbyJoinHandle,
    serversConnectedHandle,
    serversDisconnectedHandle,
    serverConnectFailureHandle
  );
}

function resolveSteamAppId() {
  const envAppId = process.env.STEAM_APP_ID;
  if (envAppId && /^\d+$/.test(envAppId)) {
    return Number(envAppId);
  }

  const candidateDirs = [
    process.cwd(),
    app.getAppPath(),
    dirname(process.execPath),
  ];

  for (const dir of candidateDirs) {
    const appIdPath = join(dir, 'steam_appid.txt');
    if (existsSync(appIdPath)) {
      const text = readFileSync(appIdPath, 'utf8').trim();
      if (/^\d+$/.test(text)) {
        return Number(text);
      }
    }
  }

  return DEFAULT_STEAM_APP_ID;
}

// Try to initialize Steamworks with retry logic
async function initSteamworks(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // steamworks.js needs to be required dynamically
      const steamworksSpecifier = resolveSteamworksModuleSpecifier();
      console.log(`🔌 Loading Steamworks module: ${steamworksSpecifier}`);
      const steamworks = await import(steamworksSpecifier);
      steamworksModule = steamworks;

      if (!steamOverlayEnabled && typeof steamworks.electronEnableSteamOverlay === 'function') {
        try {
          steamworks.electronEnableSteamOverlay();
          steamOverlayEnabled = true;
          console.log('✅ Steam overlay enabled for Electron');
        } catch (err) {
          console.warn('⚠️ Failed to enable Steam overlay:', err.message);
        }
      }

      // Initialize the Steam client
      // For testing, use AppId 480 (Spacewar)
      // For production, use your actual Steam AppId
      steamAppId = resolveSteamAppId();
      steamworksClient = steamworks.init(steamAppId);

      if (steamworksClient) {
        steamInitialized = true;
        steamSteamId = steamworksClient.localplayer.getSteamId().steamId64.toString();
        steamPlayerName = steamworksClient.localplayer.getName();

        console.log(`✅ Steamworks.js loaded successfully`);
        console.log(`✅ Steam initialized: ${steamPlayerName} (${steamSteamId})`);

        // Note: steamworks.js handles callbacks automatically via Node's event loop
        // No need for manual callback pumping like greenworks
        registerSteamCallbacks();

        return true;
      }
    } catch (err) {
      const delay = Math.pow(2, attempt) * 500; // 500ms, 1000ms, 2000ms backoff
      console.warn(`⚠️ Steam init attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt < retries) {
        console.log(`   Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.log('⚠️ Steam unavailable - running in offline mode');
  steamInitialized = false;
  return false;
}

// Initialize ez-steam-api for leaderboards (steamworks.js doesn't expose leaderboard API)
// NOTE: We do NOT call Steam.start() because steamworks.js already called SteamAPI_Init()
// and Steam only allows one initialization per process. ez-steam-api will use the existing
// Steam context for its leaderboard calls.
async function initEzSteamApi() {
  if (!steamInitialized || !steamAppId) {
    console.log('[ez-steam-api] Skipping - steamworks.js not initialized');
    return false;
  }

  try {
    // Dynamic import for ES modules compatibility
    console.log('[ez-steam-api] Loading module...');
    const ezSteamModule = await import('ez-steam-api');
    ezSteamApi = ezSteamModule.Steam;

    // ez-steam-api.start() returns true if we should exit (e.g., Steam restart required)
    // We MUST call this for ez-steam-api to work, even if steamworks.js is already active.
    // SteamAPI_Init is generally safe to call multiple times.
    console.log('[ez-steam-api] Calling Steam.start()...');
    const shouldExit = ezSteamApi.start(steamAppId);
    if (shouldExit) {
      console.log('[ez-steam-api] Steam requested app restart');
      return false;
    }
    console.log('[ez-steam-api] Steam.start() successful');

    // Test if we can access Steam by trying to get user name (quick sanity check)
    try {
      const userName = ezSteamApi.getUserName();
      console.log(`[ez-steam-api] ✅ Connected to Steam as: ${userName}`);
    } catch (nameErr) {
      console.log('[ez-steam-api] Could not get user name, but continuing (leaderboards may still work)');
    }

    ezSteamInitialized = true;
    console.log('✅ ez-steam-api initialized (leaderboards enabled)');
    return true;
  } catch (err) {
    console.warn('⚠️ ez-steam-api init failed:', err.message);
    console.warn('   Full error:', err.stack || err);
    console.warn('   Leaderboards will not be available');
    ezSteamInitialized = false;
    return false;
  }
}

// Detect if running in WSL2 (development environment)
const isWSL = process.platform === 'linux' &&
  (process.env.WSL_DISTRO_NAME || process.env.WSLENV ||
    (process.env.PATH && process.env.PATH.includes('/mnt/c')));

// GPU configuration based on environment
if (isWSL && !app.isPackaged) {
  // WSL2 development mode - needs aggressive flags for GPU passthrough
  console.log('[Electron] WSL2 development mode detected - applying GPU workarounds');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'default');
  app.commandLine.appendSwitch('enable-webgl');
} else if (process.platform === 'win32') {
  // Native Windows - prefer discrete GPU (NVIDIA/AMD dedicated)
  console.log('[Electron] Windows native mode - preferring discrete GPU');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('use-angle', 'd3d11');  // D3D11 often prefers discrete GPU
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');
} else {
  // Linux/Mac native - minimal flags
  console.log('[Electron] Native mode - using minimal GPU settings');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

let mainWindow;
let currentVSyncEnabled = null;

const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalIpcHandle(channel, async (event, ...args) => {
  if (mainWindow && event?.sender?.id !== mainWindow.webContents.id) {
    throw new Error(`Unauthorized IPC sender for channel: ${channel}`);
  }
  return listener(event, ...args);
});

function emitRuntimeEvent(type, payload = {}) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('desktop:runtime-event', {
      type,
      timestamp: Date.now(),
      ...payload,
    });
  }
}

function applyVSyncSettings(enabled) {
  const target = !!enabled;

  if (currentVSyncEnabled === target) {
    return;
  }

  currentVSyncEnabled = target;

  if (target) {
    app.commandLine.removeSwitch('disable-frame-rate-limit');
    app.commandLine.removeSwitch('disable-gpu-vsync');
    console.log('[Electron] VSync enabled (default renderer timing)');
  } else {
    app.commandLine.appendSwitch('disable-frame-rate-limit');
    app.commandLine.appendSwitch('disable-gpu-vsync');
    console.log('[Electron] VSync disabled (manual frame timing)');
  }
}

// Apply default VSync configuration (enabled by default)
applyVSyncSettings(true);

// ============================================================================
// IPC Handlers for Display Management
// ============================================================================

/**
 * Get all available displays
 */
ipcMain.handle('get-displays', () => {
  return screen.getAllDisplays().map(display => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    internal: display.internal
  }));
});

/**
 * Set fullscreen mode
 */
ipcMain.handle('set-fullscreen', (event, enable) => {
  if (mainWindow) {
    mainWindow.setFullScreen(enable);
    return true;
  }
  return false;
});

/**
 * Set borderless window (fullscreen window without borders)
 */
ipcMain.handle('set-borderless', (event, resolution) => {
  if (!mainWindow) return false;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = resolution || primaryDisplay.workArea;

  mainWindow.setFullScreen(false);
  mainWindow.setBounds({
    x: 0,
    y: 0,
    width,
    height
  });
  mainWindow.setResizable(false);
  mainWindow.setMaximizable(false);

  return true;
});

/**
 * Set windowed mode with specific resolution
 */
ipcMain.handle('set-windowed', (event, resolution) => {
  if (!mainWindow) return false;

  mainWindow.setFullScreen(false);
  mainWindow.setResizable(true);
  mainWindow.setMaximizable(true);

  if (resolution) {
    const { width, height } = resolution;
    mainWindow.setSize(width, height);
    mainWindow.center();
  }

  return true;
});

/**
 * Set window resolution
 */
ipcMain.handle('set-resolution', (event, { width, height }) => {
  if (!mainWindow) return false;

  mainWindow.setSize(width, height);
  mainWindow.center();
  return true;
});

/**
 * Get current window bounds
 */
ipcMain.handle('get-window-bounds', () => {
  if (!mainWindow) return null;
  return mainWindow.getBounds();
});

/**
 * Check if window is fullscreen
 */
ipcMain.handle('is-fullscreen', () => {
  if (!mainWindow) return false;
  return mainWindow.isFullScreen();
});

/**
 * Toggle VSync settings
 */
ipcMain.handle('set-vsync', (event, enable) => {
  applyVSyncSettings(enable);
  if (!app.isReady()) {
    return currentVSyncEnabled;
  }

  if (mainWindow?.webContents?.setFrameRate) {
    // When VSync is disabled, Electron will honor manual frame rate caps.
    const fallbackFPS = 240;
    try {
      const target = currentVSyncEnabled ? 60 : fallbackFPS;
      mainWindow.webContents.setFrameRate(target);
      console.log(`[Electron] webContents frame rate hint set to ${target} FPS`);
    } catch (error) {
      console.warn('[Electron] Failed to set webContents frame rate hint:', error);
    }
  }

  return currentVSyncEnabled;
});

// ============================================================================
// Steam IPC Handlers
// ============================================================================

ipcMain.handle('steam:isInitialized', () => steamInitialized);

ipcMain.handle('steam:getSteamId', () => steamSteamId);

ipcMain.handle('steam:getPlayerName', () => steamPlayerName);

ipcMain.handle('steam:getAppId', () => steamAppId);

// Get comprehensive connection status
ipcMain.handle('steam:getConnectionStatus', () => {
  return {
    initialized: steamInitialized,
    isOnline: steamInitialized && steamworksClient !== null,
    steamId: steamSteamId,
    playerName: steamPlayerName,
    currentLobbyId: currentLobbyId,
  };
});

ipcMain.handle('steam:getCapabilities', () => {
  const leaderboardsApi = getLeaderboardsApi();
  const remoteStorageApi = getRemoteStorageApi();
  const achievementsApi = getAchievementsApi();
  return {
    steamAvailable: steamInitialized && steamworksClient !== null,
    leaderboards: hasLeaderboardsApi(leaderboardsApi),
    cloud: hasRemoteStorageApi(remoteStorageApi),
    friends: !!steamworksClient?.friends,
    achievements: hasAchievementsApi(achievementsApi),
  };
});

ipcMain.handle('steam:isSteamRunning', () => {
  if (!steamworksClient) return false;
  try {
    return true; // If client exists, Steam is running
  } catch {
    return false;
  }
});

ipcMain.handle('steam:checkConnection', async () => {
  if (!steamworksClient) return false;

  if (steamServerConnected === false) {
    return false;
  }

  let serverTime = null;
  try {
    if (steamworksClient.utils?.getServerRealTime) {
      serverTime = steamworksClient.utils.getServerRealTime();
      if (typeof serverTime === 'number' && serverTime === 0) {
        return false;
      }
    }
  } catch {
    return false;
  }

  const networkOk = await probeSteamNetwork();
  if (!networkOk) {
    return false;
  }

  if (steamServerConnected === null && typeof serverTime === 'number') {
    return serverTime > 0;
  }

  return true;
});

// Get player avatar (returns base64 image data)
// Size: 'small' (32x32), 'medium' (64x64), 'large' (184x184)
ipcMain.handle('steam:getAvatar', async (event, steamId, size = 'medium') => {
  if (!steamworksClient) return null;
  try {
    const targetSteamId = steamId || steamSteamId;
    if (!targetSteamId) return null;

    // Map size to steamworks.js avatar size
    const sizeMap = {
      small: 'small',   // 32x32
      medium: 'medium', // 64x64
      large: 'large',   // 184x184
    };
    const avatarSize = sizeMap[size] || 'medium';

    // Get avatar using steamworks.js
    // Note: steamworks.js returns avatar as Buffer
    const avatar = steamworksClient.friends.getSmallFriendAvatar
      ? await steamworksClient.friends.getFriendAvatar(BigInt(targetSteamId), avatarSize)
      : null;

    if (avatar && avatar.length > 0) {
      // Convert to base64 data URL for use in img src
      const base64 = Buffer.from(avatar).toString('base64');
      return `data:image/png;base64,${base64}`;
    }
    return null;
  } catch (err) {
    console.warn('⚠️ Failed to get avatar:', err.message);
    return null;
  }
});

// Set Rich Presence (shows in Steam Friends list)
ipcMain.handle('steam:setRichPresence', (event, key, value) => {
  if (!steamworksClient) return false;
  try {
    steamworksClient.friends.setRichPresence(key, value);
    console.log(`🎮 Rich Presence: ${key} = ${value}`);
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to set Rich Presence:', err.message);
    return false;
  }
});

// Clear all Rich Presence data
ipcMain.handle('steam:clearRichPresence', () => {
  if (!steamworksClient) return false;
  try {
    steamworksClient.friends.clearRichPresence();
    console.log('🎮 Rich Presence cleared');
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to clear Rich Presence:', err.message);
    return false;
  }
});

// ============================================================================
// Steam Stats & Leaderboards IPC Handlers
// ============================================================================

function normalizeStatArgs(nameOrPayload, value) {
  if (typeof nameOrPayload === 'object' && nameOrPayload !== null) {
    return {
      name: nameOrPayload.name,
      value: nameOrPayload.value,
      amount: nameOrPayload.amount,
    };
  }
  return { name: nameOrPayload, value, amount: value };
}

ipcMain.handle('steam:getStat', (event, nameOrPayload) => {
  if (!steamworksClient?.stats) return null;
  try {
    const { name } = normalizeStatArgs(nameOrPayload);
    if (!name) return null;
    const value = steamworksClient.stats.getInt(name);
    return value ?? null;
  } catch (err) {
    console.warn('⚠️ Failed to get stat:', err.message);
    return null;
  }
});

ipcMain.handle('steam:setStat', (event, nameOrPayload, value) => {
  if (!steamworksClient?.stats) return false;
  try {
    const { name, value: payloadValue } = normalizeStatArgs(nameOrPayload, value);
    if (!name) return false;
    const safeValue = Number.isFinite(payloadValue) ? Math.floor(payloadValue) : 0;
    steamworksClient.stats.setInt(name, safeValue);
    return steamworksClient.stats.store();
  } catch (err) {
    console.warn('⚠️ Failed to set stat:', err.message);
    return false;
  }
});

ipcMain.handle('steam:setStatMax', (event, nameOrPayload, value) => {
  if (!steamworksClient?.stats) return false;
  try {
    const { name, value: payloadValue } = normalizeStatArgs(nameOrPayload, value);
    if (!name) return false;
    const safeValue = Number.isFinite(payloadValue) ? Math.floor(payloadValue) : 0;
    const current = steamworksClient.stats.getInt(name) ?? 0;
    if (safeValue > current) {
      steamworksClient.stats.setInt(name, safeValue);
      return steamworksClient.stats.store();
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to set max stat:', err.message);
    return false;
  }
});

ipcMain.handle('steam:incrementStat', (event, nameOrPayload, amount) => {
  if (!steamworksClient?.stats) return false;
  try {
    const { name, amount: payloadAmount } = normalizeStatArgs(nameOrPayload, amount);
    if (!name) return false;
    const delta = Number.isFinite(payloadAmount) ? Math.floor(payloadAmount) : 1;
    const current = steamworksClient.stats.getInt(name) ?? 0;
    steamworksClient.stats.setInt(name, current + delta);
    return steamworksClient.stats.store();
  } catch (err) {
    console.warn('⚠️ Failed to increment stat:', err.message);
    return false;
  }
});

ipcMain.handle('steam:storeStats', () => {
  if (!steamworksClient?.stats) return false;
  try {
    return steamworksClient.stats.store();
  } catch (err) {
    console.warn('⚠️ Failed to store stats:', err.message);
    return false;
  }
});

ipcMain.handle('steam:getStats', (event, names) => {
  if (!steamworksClient?.stats) return {};
  try {
    const result = {};
    const list = Array.isArray(names) ? names : [];
    list.forEach((name) => {
      result[name] = steamworksClient.stats.getInt(name) ?? 0;
    });
    return result;
  } catch (err) {
    console.warn('⚠️ Failed to get stats:', err.message);
    return {};
  }
});

// ---------------------------------------------------------------------------
// Leaderboards Adapter Helpers
// ---------------------------------------------------------------------------

const leaderboardHandles = new Map();

function getLeaderboardsApi() {
  const candidates = [
    steamworksClient?.leaderboards,
    steamworksClient?.userStats?.leaderboards,
    steamworksClient?.userstats?.leaderboards,
    steamworksClient?.userStats,
    steamworksClient?.userstats,
  ].filter(Boolean);

  for (const api of candidates) {
    if (hasLeaderboardsApi(api)) {
      return api;
    }
  }

  return null;
}

function hasLeaderboardsApi(api) {
  if (!api) return false;
  return (
    typeof api.getLeaderboard === 'function' ||
    typeof api.getLeaderboardEntry === 'function' ||
    typeof api.uploadScore === 'function' ||
    typeof api.uploadLeaderboardScore === 'function' ||
    typeof api.downloadLeaderboardEntries === 'function' ||
    typeof api.downloadEntries === 'function' ||
    typeof api.downloadLeaderboardEntriesForUsers === 'function' ||
    typeof api.downloadEntriesForUsers === 'function' ||
    typeof api.findLeaderboard === 'function' ||
    typeof api.findOrCreateLeaderboard === 'function'
  );
}

function getRemoteStorageApi() {
  return (
    steamworksClient?.remoteStorage
    || steamworksClient?.remote_storage
    || steamworksClient?.remoteStorageAPI
    || steamworksClient?.remoteStorageApi
    || null
  );
}

function hasRemoteStorageApi(api) {
  if (!api) return false;
  return (
    typeof api.fileWrite === 'function'
    || typeof api.writeFile === 'function'
    || typeof api.fileRead === 'function'
    || typeof api.readFile === 'function'
    || typeof api.fileExists === 'function'
    || typeof api.exists === 'function'
    || typeof api.fileDelete === 'function'
    || typeof api.deleteFile === 'function'
    || typeof api.getFileTimestamp === 'function'
    || typeof api.getQuota === 'function'
  );
}

function getAchievementsApi() {
  return (
    steamworksClient?.achievements
    || steamworksClient?.userStats?.achievements
    || steamworksClient?.userstats?.achievements
    || steamworksClient?.userStats
    || steamworksClient?.userstats
    || null
  );
}

function hasAchievementsApi(api) {
  if (!api) return false;
  return (
    typeof api.unlockAchievement === 'function'
    || typeof api.setAchievement === 'function'
    || typeof api.getAchievements === 'function'
    || typeof api.getAchievement === 'function'
  );
}

function resolveCloudWriteBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer);
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  if (data === null || data === undefined) {
    return Buffer.from('', 'utf8');
  }
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

function toSteamIdValue(steamId) {
  if (!steamId) return steamId;
  if (typeof steamId === 'bigint') return steamId;
  if (typeof steamId === 'number') return BigInt(steamId);
  if (typeof steamId === 'string' && /^\d+$/.test(steamId)) return BigInt(steamId);
  return steamId;
}

async function invokeSteamworks(fn, args) {
  if (typeof fn !== 'function') {
    return undefined;
  }

  if (fn.length > args.length) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        const maybePromise = fn(...args, done);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done).catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  const result = fn(...args);
  if (result && typeof result.then === 'function') {
    return await result;
  }
  return result;
}

function normalizeSteamId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value.steamId64) return value.steamId64.toString();
  if (value.steam_id) return value.steam_id.toString();
  return String(value);
}

function getPersonaName(steamId) {
  if (!steamworksClient?.friends || !steamId) return null;
  try {
    return steamworksClient.friends.getFriendPersonaName(BigInt(steamId));
  } catch (err) {
    return null;
  }
}

function normalizeEntries(entries = [], start = 0) {
  const safeEntries = entries.filter(Boolean);
  return safeEntries.map((entry, idx) => ({
    rank: entry.rank ?? entry.globalRank ?? entry.rankIndex ?? (start + idx + 1),
    steamId: normalizeSteamId(entry.steamId ?? entry.steamId64 ?? entry.userId ?? entry.playerSteamId),
    score: entry.score ?? entry.scoreValue ?? entry.value ?? 0,
    details: entry.details ?? entry.scoreDetails ?? null,
    name: entry.name ?? entry.personaName ?? getPersonaName(normalizeSteamId(entry.steamId ?? entry.steamId64)),
  }));
}

async function resolveLeaderboardHandle(name) {
  if (!name) return null;
  if (leaderboardHandles.has(name)) {
    return leaderboardHandles.get(name);
  }

  const api = getLeaderboardsApi();
  if (!api) return null;

  const findOrCreate = api.findOrCreateLeaderboard || api.findOrCreate;
  const find = api.findLeaderboard || api.find;

  if (typeof findOrCreate === 'function') {
    const sortMethod = api.SortMethod?.Descending ?? api.LeaderboardSortMethod?.Descending ?? 2;
    const displayType = api.DisplayType?.Numeric ?? api.LeaderboardDisplayType?.Numeric ?? 1;
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

function recordLeaderboardSubmission(payload, outcome) {
  try {
    const logPath = join(app.getPath('userData'), 'leaderboard-submissions.jsonl');
    const entry = {
      timestamp: Date.now(),
      leaderboardName: payload?.leaderboardName,
      score: payload?.score,
      scoreDetails: payload?.scoreDetails || null,
      result: outcome || null,
    };
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn('⚠️ Failed to record leaderboard submission:', err.message);
  }
}

ipcMain.handle('steam:uploadScore', async (event, payload) => {
  const { leaderboardName, score, scoreDetails, scoreDetailsPacked } = payload || {};

  // First try ez-steam-api (preferred for leaderboards)
  if (ezSteamInitialized && ezSteamApi) {
    try {
      // Get or cache leaderboard handle
      let leaderboard = ezSteamLeaderboardCache.get(leaderboardName);
      if (!leaderboard) {
        leaderboard = await ezSteamApi.getLeaderboardAsync(leaderboardName);
        if (leaderboard) {
          ezSteamLeaderboardCache.set(leaderboardName, leaderboard);
        }
      }

      if (leaderboard) {
        // ez-steam-api setScoreAsync returns whether score was newly achieved
        await leaderboard.setScoreAsync(score);
        recordLeaderboardSubmission(payload, { success: true, backend: 'ez-steam-api' });
        console.log(`✅ Uploaded score ${score} to ${leaderboardName} via ez-steam-api`);
        return { supported: true, success: true, backend: 'ez-steam-api' };
      }
    } catch (err) {
      console.warn(`⚠️ ez-steam-api uploadScore failed:`, err.message);
      recordLeaderboardSubmission(payload, { success: false, error: err.message, backend: 'ez-steam-api' });
    }
  }

  // Fallback to steamworks.js (won't work since it has no leaderboards API, but kept for future compatibility)
  try {
    const api = getLeaderboardsApi();
    if (!api) {
      recordLeaderboardSubmission(payload, { success: false, error: 'Leaderboards API not available' });
      return { supported: false, success: false, error: 'Leaderboards API not available' };
    }

    if (typeof api.uploadScore === 'function') {
      let result;
      try {
        result = await api.uploadScore(
          leaderboardName,
          score,
          Array.isArray(scoreDetailsPacked) ? scoreDetailsPacked : scoreDetails,
        );
      } catch (err) {
        if (scoreDetails && scoreDetails !== scoreDetailsPacked) {
          result = await api.uploadScore(leaderboardName, score, scoreDetails);
        } else {
          throw err;
        }
      }
      recordLeaderboardSubmission(payload, { success: true, backend: 'steamworks.js', result });
      return { supported: true, success: true, result };
    }

    if (typeof api.uploadLeaderboardScore === 'function') {
      const handle = await resolveLeaderboardHandle(leaderboardName);
      if (!handle) {
        return { supported: true, success: false, error: 'Leaderboard handle not found' };
      }
      const detailsArray = Array.isArray(scoreDetailsPacked) ? scoreDetailsPacked : [];
      const result = await invokeSteamworks(api.uploadLeaderboardScore, [handle, score, detailsArray]);
      recordLeaderboardSubmission(payload, { success: true, backend: 'steamworks.js', result });
      return { supported: true, success: true, result };
    }
  } catch (err) {
    recordLeaderboardSubmission(payload, { success: false, error: err.message });
    return { supported: true, success: false, error: err.message };
  }

  return { supported: false, success: false, error: 'Leaderboards API not available' };
});

ipcMain.handle('steam:getLeaderboard', async (event, payload) => {
  const { name, type = 'global', start = 0, count = 10 } = payload || {};
  console.log(`[steam:getLeaderboard] Request: name=${name}, type=${type}, ezSteamInitialized=${ezSteamInitialized}`);

  // First try ez-steam-api (preferred for leaderboards)
  if (ezSteamInitialized && ezSteamApi) {
    try {
      // Get or cache leaderboard handle
      let leaderboard = ezSteamLeaderboardCache.get(name);
      if (!leaderboard) {
        leaderboard = await ezSteamApi.getLeaderboardAsync(name);
        if (leaderboard) {
          ezSteamLeaderboardCache.set(name, leaderboard);
        }
      }

      if (leaderboard) {
        // ez-steam-api only supports friends leaderboard fetching currently
        if (type === 'friends') {
          const rows = await leaderboard.getFriendScoresAsync();
          const entries = (rows || []).slice(start, start + count).map((row, idx) => ({
            rank: start + idx + 1,
            steamId: row.steamId ? row.steamId.toString() : null,
            name: row.name || 'Unknown',
            score: row.score || 0,
            details: null,
          }));
          console.log(`✅ Fetched ${entries.length} friend entries from ${name} via ez-steam-api`);
          return { supported: true, entries, backend: 'ez-steam-api' };
        }

        // For global/around_user, ez-steam-api has limited support
        // Return supported: true with notice so UI can handle gracefully
        return {
          supported: true,
          entries: [],
          notice: 'Global leaderboards not yet supported via ez-steam-api. Use Steam Partner Portal or wait for library update.',
          backend: 'ez-steam-api',
        };
      }
    } catch (err) {
      console.warn(`⚠️ ez-steam-api getLeaderboard failed:`, err.message);
      // Fall through to steamworks.js
    }
  }

  // Fallback to steamworks.js (won't work since it has no leaderboards API, but kept for future)
  const api = getLeaderboardsApi();
  if (!api) {
    return { supported: false, entries: [] };
  }

  try {
    if (typeof api.getLeaderboard === 'function') {
      const result = await api.getLeaderboard(name, type, start, count);
      const entries = Array.isArray(result?.entries) ? result.entries : Array.isArray(result) ? result : [];
      return { supported: true, entries: normalizeEntries(entries, start) };
    }

    const downloadEntries = api.downloadEntries || api.downloadLeaderboardEntries;
    if (typeof downloadEntries === 'function') {
      const handle = await resolveLeaderboardHandle(name);
      if (!handle) {
        return { supported: true, entries: [], notice: 'Leaderboard not found' };
      }
      let requestType = type;
      const requestEnum = api.DataRequest || api.LeaderboardDataRequest;
      if (requestEnum) {
        if (type === 'around_user') {
          requestType = requestEnum.GlobalAroundUser || requestEnum.AroundUser || requestEnum.AroundMe || type;
        } else if (type === 'friends') {
          requestType = requestEnum.Friends || type;
        } else {
          requestType = requestEnum.Global || type;
        }
      }
      const result = await invokeSteamworks(downloadEntries, [
        handle,
        requestType,
        start,
        start + count - 1,
      ]);
      const entries = Array.isArray(result?.entries) ? result.entries : Array.isArray(result) ? result : [];
      return { supported: true, entries: normalizeEntries(entries, start) };
    }
  } catch (err) {
    return { supported: true, entries: [], error: err.message };
  }

  return { supported: false, entries: [] };
});

ipcMain.handle('steam:getLeaderboardEntry', async (event, payload) => {
  const { name, steamId } = payload || {};

  // First try ez-steam-api for friends' entries
  if (ezSteamInitialized && ezSteamApi && steamId) {
    try {
      let leaderboard = ezSteamLeaderboardCache.get(name);
      if (!leaderboard) {
        leaderboard = await ezSteamApi.getLeaderboardAsync(name);
        if (leaderboard) {
          ezSteamLeaderboardCache.set(name, leaderboard);
        }
      }

      if (leaderboard) {
        const rows = await leaderboard.getFriendScoresAsync();
        const targetId = steamId.toString();
        const match = (rows || []).find(row =>
          row.steamId && row.steamId.toString() === targetId
        );
        if (match) {
          const entry = {
            rank: (rows || []).indexOf(match) + 1,
            steamId: match.steamId ? match.steamId.toString() : null,
            name: match.name || 'Unknown',
            score: match.score || 0,
            details: null,
          };
          return { supported: true, entry, backend: 'ez-steam-api' };
        }
        return { supported: true, entry: null, backend: 'ez-steam-api' };
      }
    } catch (err) {
      console.warn(`⚠️ ez-steam-api getLeaderboardEntry failed:`, err.message);
    }
  }

  // Fallback to steamworks.js
  const api = getLeaderboardsApi();
  if (!api) {
    return { supported: false, entry: null };
  }

  try {
    if (typeof api.getLeaderboardEntry === 'function') {
      const entry = await api.getLeaderboardEntry(name, steamId);
      if (!entry) {
        return { supported: true, entry: null };
      }
      const normalized = normalizeEntries([entry], 0)[0];
      return { supported: true, entry: normalized };
    }

    const downloadEntriesForUsers = api.downloadEntriesForUsers || api.downloadLeaderboardEntriesForUsers;
    if (typeof downloadEntriesForUsers === 'function') {
      const handle = await resolveLeaderboardHandle(name);
      if (!handle) {
        return { supported: true, entry: null, notice: 'Leaderboard not found' };
      }
      const result = await invokeSteamworks(downloadEntriesForUsers, [
        handle,
        [toSteamIdValue(steamId)],
      ]);
      const entries = Array.isArray(result?.entries) ? result.entries : Array.isArray(result) ? result : [];
      const normalized = normalizeEntries(entries, 0)[0] || null;
      return { supported: true, entry: normalized };
    }
  } catch (err) {
    return { supported: true, entry: null, error: err.message };
  }

  return { supported: false, entry: null };
});

// ============================================================================
// Steam Cloud (Remote Storage) IPC Handlers
// ============================================================================

ipcMain.handle('steam:cloudWrite', async (event, payload) => {
  const api = getRemoteStorageApi();
  if (!hasRemoteStorageApi(api)) {
    return { supported: false, success: false, error: 'Remote Storage API not available' };
  }

  try {
    const { filename, data } = payload || {};
    if (!filename) {
      return { supported: true, success: false, error: 'Missing filename' };
    }

    const buffer = resolveCloudWriteBuffer(data);
    const writeFn = api.fileWrite || api.writeFile;
    let result;
    try {
      result = await invokeSteamworks(writeFn, [filename, buffer]);
    } catch (err) {
      result = await invokeSteamworks(writeFn, [filename, buffer, buffer.length]);
    }
    return { supported: true, success: true, size: buffer.length, result };
  } catch (err) {
    return { supported: true, success: false, error: err.message };
  }
});

ipcMain.handle('steam:cloudRead', async (event, payload) => {
  const api = getRemoteStorageApi();
  if (!hasRemoteStorageApi(api)) {
    return { supported: false, data: null };
  }

  try {
    const { filename } = payload || {};
    if (!filename) {
      return { supported: true, data: null, error: 'Missing filename' };
    }

    const readFn = api.fileRead || api.readFile;
    let result;
    try {
      result = await invokeSteamworks(readFn, [filename]);
    } catch (err) {
      if (typeof api.getFileSize === 'function') {
        const size = await invokeSteamworks(api.getFileSize, [filename]);
        result = await invokeSteamworks(readFn, [filename, size]);
      } else {
        throw err;
      }
    }
    const data = normalizeCloudReadResult(result);
    return { supported: true, data };
  } catch (err) {
    return { supported: true, data: null, error: err.message };
  }
});

ipcMain.handle('steam:cloudDelete', async (event, payload) => {
  const api = getRemoteStorageApi();
  if (!hasRemoteStorageApi(api)) {
    return { supported: false, success: false, error: 'Remote Storage API not available' };
  }

  try {
    const { filename } = payload || {};
    if (!filename) {
      return { supported: true, success: false, error: 'Missing filename' };
    }

    const deleteFn = api.fileDelete || api.deleteFile;
    const result = await invokeSteamworks(deleteFn, [filename]);
    return { supported: true, success: true, result };
  } catch (err) {
    return { supported: true, success: false, error: err.message };
  }
});

ipcMain.handle('steam:cloudExists', async (event, payload) => {
  const api = getRemoteStorageApi();
  if (!hasRemoteStorageApi(api)) {
    return { supported: false, exists: false };
  }

  try {
    const { filename } = payload || {};
    if (!filename) {
      return { supported: true, exists: false, error: 'Missing filename' };
    }

    const existsFn = api.fileExists || api.exists;
    const result = await invokeSteamworks(existsFn, [filename]);
    return { supported: true, exists: !!result };
  } catch (err) {
    return { supported: true, exists: false, error: err.message };
  }
});

ipcMain.handle('steam:cloudGetQuota', async () => {
  const api = getRemoteStorageApi();
  if (!hasRemoteStorageApi(api) || typeof api.getQuota !== 'function') {
    return { supported: false };
  }

  try {
    const result = await invokeSteamworks(api.getQuota, []);
    if (Array.isArray(result)) {
      const [totalBytes, availableBytes] = result;
      return { supported: true, totalBytes, availableBytes };
    }
    if (result && typeof result === 'object') {
      return {
        supported: true,
        totalBytes: result.totalBytes ?? result.total,
        availableBytes: result.availableBytes ?? result.available,
      };
    }
    return { supported: true, totalBytes: result?.totalBytes, availableBytes: result?.availableBytes };
  } catch (err) {
    return { supported: true, error: err.message };
  }
});

ipcMain.handle('steam:cloudGetTimestamp', async (event, payload) => {
  const api = getRemoteStorageApi();
  if (!hasRemoteStorageApi(api) || typeof api.getFileTimestamp !== 'function') {
    return { supported: false, timestamp: null };
  }

  try {
    const { filename } = payload || {};
    if (!filename) {
      return { supported: true, timestamp: null, error: 'Missing filename' };
    }

    const result = await invokeSteamworks(api.getFileTimestamp, [filename]);
    return { supported: true, timestamp: result ?? null };
  } catch (err) {
    return { supported: true, timestamp: null, error: err.message };
  }
});

// ============================================================================
// Steam Friends & Social IPC Handlers
// ============================================================================

// Get list of friends with status
ipcMain.handle('steam:getFriends', async () => {
  if (!steamworksClient) return [];
  try {
    const friendCount = steamworksClient.friends.getFriendCount(0x04); // k_EFriendFlagImmediate
    const friends = [];

    for (let i = 0; i < friendCount; i++) {
      const friendSteamId = steamworksClient.friends.getFriendByIndex(i, 0x04);
      const name = steamworksClient.friends.getFriendPersonaName(friendSteamId);
      const personaState = steamworksClient.friends.getFriendPersonaState(friendSteamId);
      const gameInfo = steamworksClient.friends.getFriendGamePlayed(friendSteamId);

      friends.push({
        steamId: friendSteamId.steamId64.toString(),
        name,
        personaState,
        isOnline: personaState !== 0,
        inGame: !!gameInfo,
        gameId: gameInfo?.gameId?.toString() || null,
      });
    }

    // Sort by online status (online first) then by name
    friends.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return friends;
  } catch (err) {
    console.warn('⚠️ Failed to get friends:', err.message);
    return [];
  }
});

// Get persona state for a specific user
ipcMain.handle('steam:getPersonaState', (event, steamId) => {
  if (!steamworksClient) return 0; // Offline
  try {
    return steamworksClient.friends.getFriendPersonaState(BigInt(steamId));
  } catch (err) {
    console.warn('⚠️ Failed to get persona state:', err.message);
    return 0;
  }
});

// Invite friend to current lobby
ipcMain.handle('steam:inviteToLobby', (event, friendSteamId, lobbyId) => {
  if (!steamworksClient || !lobbyId) return false;
  try {
    const targetLobbyId = lobbyId || currentLobbyId;
    if (!targetLobbyId) {
      console.warn('⚠️ No lobby to invite to');
      return false;
    }
    steamworksClient.matchmaking.inviteUserToLobby(BigInt(targetLobbyId), BigInt(friendSteamId));
    console.log(`✅ Invited ${friendSteamId} to lobby ${targetLobbyId}`);
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to invite to lobby:', err.message);
    return false;
  }
});

// Open Steam's invite dialog for the current lobby
ipcMain.handle('steam:openLobbyInviteDialog', (event, lobbyId) => {
  if (!steamworksClient) return false;
  try {
    const targetLobbyId = lobbyId || currentLobbyId;
    if (!targetLobbyId) return false;
    const lobby = steamworksClient.matchmaking.getLobbyFromId(BigInt(targetLobbyId));
    if (!lobby) return false;
    lobby.openInviteDialog();
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to open lobby invite dialog:', err.message);
    return false;
  }
});

// ============================================================================
// Steam Overlay IPC Handlers
// ============================================================================

// Activate Steam overlay to a specific page
ipcMain.handle('steam:activateOverlay', (event, type) => {
  if (!steamworksClient) return false;
  try {
    // Valid types: 'Friends', 'Community', 'Players', 'Settings', 'OfficialGameGroup', 'Stats', 'Achievements'
    steamworksClient.overlay.activate(type || 'Friends');
    console.log(`🎮 Steam overlay activated: ${type}`);
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to activate overlay:', err.message);
    return false;
  }
});

// Activate Steam overlay to a specific user
ipcMain.handle('steam:activateOverlayToUser', (event, type, steamId) => {
  if (!steamworksClient) return false;
  try {
    // type: 'steamid', 'chat', 'jointrade', 'stats', 'achievements', 'friendadd', 'friendremove', 'friendrequestaccept', 'friendrequestignore'
    steamworksClient.overlay.activateToUser(type || 'steamid', BigInt(steamId));
    console.log(`🎮 Steam overlay activated to user: ${steamId}`);
    return true;
  } catch (err) {
    console.warn('⚠️ Failed to activate overlay to user:', err.message);
    return false;
  }
});

ipcMain.handle('steam:createLobby', async (event, options) => {
  if (!steamworksClient) throw new Error('Steam not initialized');
  try {
    const { maxPlayers = 8, lobbyType = 'public' } = options || {};
    const type = lobbyType === 'public' ? 2 : 1; // Public = 2, FriendsOnly = 1
    const lobby = await steamworksClient.matchmaking.createLobby(type, maxPlayers);
    currentLobbyId = lobby.id.toString();
    console.log(`✅ Steam lobby created: ${currentLobbyId}`);
    return currentLobbyId;
  } catch (err) {
    console.error('❌ Failed to create lobby:', err);
    throw err;
  }
});

ipcMain.handle('steam:joinLobby', async (event, lobbyId) => {
  if (!steamworksClient) throw new Error('Steam not initialized');
  try {
    await steamworksClient.matchmaking.joinLobby(BigInt(lobbyId));
    currentLobbyId = lobbyId;
    console.log(`✅ Joined Steam lobby: ${lobbyId}`);
    return true;
  } catch (err) {
    console.error('❌ Failed to join lobby:', err);
    throw err;
  }
});

ipcMain.handle('steam:leaveLobby', () => {
  if (!steamworksClient || !currentLobbyId) return;
  try {
    steamworksClient.matchmaking.leaveLobby(BigInt(currentLobbyId));
    console.log(`✅ Left Steam lobby: ${currentLobbyId}`);
    currentLobbyId = null;
  } catch (err) {
    console.error('❌ Failed to leave lobby:', err);
  }
});

ipcMain.handle('steam:getLobbies', async () => {
  if (!steamworksClient) return [];
  try {
    const lobbies = await steamworksClient.matchmaking.getLobbies();

    // Filter to only show Serenity Blocks lobbies (have our game_mode metadata)
    const serenityLobbies = lobbies.filter(lobby => {
      const gameMode = lobby.getData('game_mode');
      return gameMode === 'ffa'; // Only show our lobbies
    });

    console.log(`[Steam] Found ${lobbies.length} total lobbies, ${serenityLobbies.length} Serenity Blocks lobbies`);

    return serenityLobbies.map(lobby => ({
      id: lobby.id.toString(),
      name: lobby.getData('game_name') || '[No name]',
      mode: lobby.getData('game_mode') || 'ffa',
      players: lobby.getMemberCount(),
      maxPlayers: lobby.getMemberLimit(),
      endCondition: lobby.getData('end_condition') || 'frags',
      endConditionValue: lobby.getData('end_condition_value') || '10',
    }));
  } catch (err) {
    console.error('❌ Failed to get lobbies:', err);
    return [];
  }
});

ipcMain.handle('steam:getLobbyData', (event, lobbyId, key) => {
  if (!steamworksClient) return null;
  try {
    const lobby = steamworksClient.matchmaking.getLobbyFromId(BigInt(lobbyId));
    return lobby?.getData(key) || null;
  } catch {
    return null;
  }
});

ipcMain.handle('steam:setLobbyData', (event, lobbyId, key, value) => {
  if (!steamworksClient) return false;
  try {
    const lobby = steamworksClient.matchmaking.getLobbyFromId(BigInt(lobbyId));
    lobby?.setData(key, value);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('steam:getLobbyMembers', (event, lobbyId) => {
  if (!steamworksClient) return [];
  try {
    const lobby = steamworksClient.matchmaking.getLobbyFromId(BigInt(lobbyId));
    if (!lobby) return [];
    const members = [];
    for (let i = 0; i < lobby.getMemberCount(); i++) {
      const member = lobby.getMemberByIndex(i);
      members.push({
        steamId: member.steamId64.toString(),
        name: steamworksClient.friends.getFriendPersonaName(member),
      });
    }
    return members;
  } catch {
    return [];
  }
});

ipcMain.handle('steam:getLobbyOwner', (event, lobbyId) => {
  if (!steamworksClient) return null;
  try {
    const lobby = steamworksClient.matchmaking.getLobbyFromId(BigInt(lobbyId));
    return lobby?.getOwner()?.steamId64?.toString() || null;
  } catch {
    return null;
  }
});

ipcMain.handle('steam:sendP2PPacket', (event, steamId, data, sendType, channel) => {
  if (!steamworksClient) return false;
  try {
    const buffer = Buffer.from(JSON.stringify(data));
    steamworksClient.networking.sendP2PPacket(BigInt(steamId), buffer, sendType, channel);
    return true;
  } catch (err) {
    console.error('❌ Failed to send P2P packet:', err);
    return false;
  }
});

ipcMain.handle('steam:readP2PPacket', (event, channel) => {
  if (!steamworksClient) return null;
  try {
    if (!steamworksClient.networking.isP2PPacketAvailable(channel)) return null;
    const packet = steamworksClient.networking.readP2PPacket(channel);
    if (!packet) return null;
    return {
      steamId: packet.steamId.steamId64.toString(),
      data: JSON.parse(packet.data.toString()),
    };
  } catch {
    return null;
  }
});

ipcMain.handle('steam:isP2PPacketAvailable', (event, channel) => {
  if (!steamworksClient) return false;
  try {
    return steamworksClient.networking.isP2PPacketAvailable(channel);
  } catch {
    return false;
  }
});

ipcMain.handle('steam:closeP2PSession', (event, steamId) => {
  if (!steamworksClient) return;
  try {
    steamworksClient.networking.closeP2PSessionWithUser(BigInt(steamId));
  } catch (err) {
    console.error('❌ Failed to close P2P session:', err);
  }
});

// ============================================================================
// Window Creation
// ============================================================================

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workArea;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(720, height),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    title: 'Serenity Blocks',
    backgroundColor: '#000000',
    show: false, // Don't show until ready to prevent flicker
  });

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    if (pendingLobbyJoins.length > 0) {
      pendingLobbyJoins.forEach((invite) => {
        mainWindow.webContents.send('steam:lobbyJoinRequested', invite);
      });
      pendingLobbyJoins = [];
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Electron] Renderer process gone:', details);
    emitRuntimeEvent('render-process-gone', { details });
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Electron] Renderer unresponsive');
    emitRuntimeEvent('renderer-unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    emitRuntimeEvent('renderer-responsive');
  });

  // Load Vite dev server (development mode) or built files (production)
  if (app.isPackaged) {
    // Production mode - load built files from dist folder
    const indexPath = join(app.getAppPath(), 'dist', 'index.html');
    console.log('[Electron] Loading production build from:', indexPath);
    mainWindow.loadFile(indexPath);
  } else {
    // Development mode - load from Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const lobbyId = parseConnectLobbyArg(argv);
    if (lobbyId) {
      queueLobbyJoin({ lobbyId, source: 'second_instance' });
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    crashReporter.start({
      productName: 'Serenity Blocks',
      companyName: 'Serenity Blocks',
      uploadToServer: false,
      compress: true,
      extra: {
        appVersion: app.getVersion(),
        buildChannel: app.isPackaged ? 'production' : 'development',
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron,
      },
    });

    const launchLobbyId = parseConnectLobbyArg(process.argv);
    if (launchLobbyId) {
      queueLobbyJoin({ lobbyId: launchLobbyId, source: 'command_line' });
    }

    // Initialize Steam before creating window
    await initSteamworks();
    // Initialize ez-steam-api for leaderboards (separate from steamworks.js)
    await initEzSteamApi();
    createWindow();

    powerMonitor.on('suspend', () => emitRuntimeEvent('power-suspend'));
    powerMonitor.on('resume', () => emitRuntimeEvent('power-resume'));
    powerMonitor.on('on-battery', () => emitRuntimeEvent('power-on-battery'));
    powerMonitor.on('on-ac', () => emitRuntimeEvent('power-on-ac'));
    powerMonitor.on('speed-limit-change', (_event, limit) => emitRuntimeEvent('power-speed-limit-change', { limit }));
  });
}

app.on('render-process-gone', (_event, webContents, details) => {
  console.error('[Electron] App render-process-gone:', details);
  emitRuntimeEvent('app-render-process-gone', { details, url: webContents?.getURL?.() });
});

app.on('child-process-gone', (_event, details) => {
  console.error('[Electron] Child process gone:', details);
  emitRuntimeEvent('child-process-gone', { details });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
