import { app, BrowserWindow, screen, ipcMain, crashReporter, powerMonitor, dialog, Menu, shell, webContents as electronWebContents } from 'electron';
import { join, dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as inspector from 'node:inspector';
import * as net from 'net';
import { classifyGpuHealth as deriveGpuHealthState } from './gpu-health.js';
import {
  buildDebugToolsStatus,
  coerceLogLevel,
  formatLogArguments,
  getPrimaryDebugMenuLabel,
  normalizeRendererReportedLog,
  resolveDevToolsFrontendUrl,
  resolveRendererDebugTarget,
  serializeLogValue,
} from './debug-tools.js';
import {
  createDevToolsShortcutState,
  getDevToolsShortcutIntent,
  isDuplicateDevToolsShortcut,
} from './devtools-shortcuts.js';
import {
  decideDevToolsOpenRequest,
  getDevToolsOpenStrategy,
  MANAGED_DEVTOOLS_HOST_ROLE,
  shouldAttachSteamOverlayFrameInvalidator,
} from './devtools-policy.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STEAM_OVERLAY_GPU_SWITCHES_APPLIED = process.platform === 'win32'
  && process.env.SERENITY_DISABLE_STEAM_BOOTSTRAP !== '1';

const WINDOWS_RUNTIME_PROFILE_ALIASES = new Map([
  ['baseline', 'baseline'],
  ['current', 'current'],
  ['aggressive', 'aggressive'],
  ['webparity', 'webParity'],
  ['web-parity', 'webParity'],
]);
const VALID_WINDOWS_RUNTIME_PROFILES = new Set(WINDOWS_RUNTIME_PROFILE_ALIASES.values());
const DEFAULT_PACKAGED_WINDOWS_PROFILE = 'webParity';
const DEFAULT_DEVELOPMENT_WINDOWS_PROFILE = 'current';
const DEVTOOLS_OPEN_TIMEOUT_MS = 4000;
const DEVTOOLS_DIAGNOSTICS_MAX_ENTRIES = 200;

function readArgValue(flagName) {
  const prefix = `--${flagName}=`;
  const match = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasArgSwitch(flagName) {
  return process.argv.includes(`--${flagName}`);
}

function normalizeWindowsRuntimeProfile(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return WINDOWS_RUNTIME_PROFILE_ALIASES.get(normalized) || null;
}

function normalizeRemoteDebuggingPort(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    return null;
  }

  return String(parsed);
}

const requestedWindowsRuntimeProfile = normalizeWindowsRuntimeProfile(
  process.env.SERENITY_WINDOWS_PROFILE || readArgValue('serenity-windows-profile')
);
const windowsSafeMode = process.platform === 'win32'
  && (process.env.SERENITY_WINDOWS_SAFE_MODE === '1' || hasArgSwitch('serenity-safe-mode'));
const requestedRemoteDebuggingPort = normalizeRemoteDebuggingPort(
  process.env.SERENITY_REMOTE_DEBUGGING_PORT || readArgValue('serenity-remote-debugging-port')
);
const requestedMainInspectorPort = normalizeRemoteDebuggingPort(
  process.env.SERENITY_MAIN_INSPECT_PORT || readArgValue('serenity-main-inspect-port')
);
const isPackagedWindowsApp = process.platform === 'win32' && app.isPackaged;
const windowsRuntimeProfile = requestedWindowsRuntimeProfile
  || (windowsSafeMode
    ? 'baseline'
    : (isPackagedWindowsApp ? DEFAULT_PACKAGED_WINDOWS_PROFILE : DEFAULT_DEVELOPMENT_WINDOWS_PROFILE));
const windowsLabProfileRequested = process.platform === 'win32'
  && (windowsRuntimeProfile === 'current' || windowsRuntimeProfile === 'aggressive');
const windowsLabRuntimeEnabled = process.platform === 'win32'
  && (!app.isPackaged || process.env.SERENITY_ENABLE_LAB_WINDOWS_PROFILES === '1');
const windowsAngleBackend = process.platform === 'win32'
  ? (process.env.SERENITY_ANGLE_BACKEND || 'd3d11')
  : null;
const packagedRemoteDebuggingPort = isPackagedWindowsApp ? '9229' : null;
const preferDiscreteGpu = process.platform === 'win32'
  && !windowsSafeMode
  && (process.env.SERENITY_FORCE_HIGH_PERFORMANCE_GPU === '1'
      || isPackagedWindowsApp
      || windowsLabProfileRequested);
const remoteDebuggingPort = requestedRemoteDebuggingPort || packagedRemoteDebuggingPort;
const remoteDebuggingUrl = remoteDebuggingPort
  ? `http://127.0.0.1:${remoteDebuggingPort}`
  : null;
const packagedDiagnosticsForced = process.env.SERENITY_ENABLE_PACKAGED_DIAGNOSTICS === '1';
const devToolsSmokeMode = process.env.SERENITY_DEVTOOLS_SMOKE === '1';
const devToolsSmokePagePath = typeof process.env.SERENITY_DEVTOOLS_SMOKE_FILE === 'string'
  && process.env.SERENITY_DEVTOOLS_SMOKE_FILE.trim()
  ? resolve(process.env.SERENITY_DEVTOOLS_SMOKE_FILE)
  : null;

const TRACKED_GPU_SWITCHES = [
  'force-high-performance-gpu',
  'use-angle',
  'enable-gpu-rasterization',
  'enable-zero-copy',
  'in-process-gpu',
  'disable-direct-composition',
  'ignore-gpu-blocklist',
  'enable-webgl',
  'disable-gpu-sandbox',
  'no-sandbox',
  'disable-frame-rate-limit',
  'disable-gpu-vsync',
  'enable-features',
  'disable-background-timer-throttling',
  'disable-renderer-backgrounding',
  'disable-backgrounding-occluded-windows',
];

const DEBUG_LOG_FILENAMES = Object.freeze({
  main: 'main-debug.jsonl',
  renderer: 'renderer-debug.jsonl',
  preload: 'preload-debug.jsonl',
  devtools: 'devtools.log',
  steam: 'steam-init.log',
});
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
};
const debugLogState = {
  installed: false,
  pendingLines: new Map(),
};
const debugToolsState = {
  lastRendererDebuggerUrl: null,
  lastRendererDebuggerOpenedAt: null,
  mainInspectorOpened: false,
  mainInspectorError: null,
};

function getDebugLogsDir() {
  if (!app.isReady()) {
    return null;
  }

  const logsDir = join(app.getPath('userData'), 'logs');
  mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function getDebugLogPath(kind) {
  const logsDir = getDebugLogsDir();
  const filename = DEBUG_LOG_FILENAMES[kind];
  if (!logsDir || !filename) {
    return null;
  }

  return join(logsDir, filename);
}

function getDebugLogPaths() {
  return {
    logsDir: getDebugLogsDir(),
    main: getDebugLogPath('main'),
    renderer: getDebugLogPath('renderer'),
    preload: getDebugLogPath('preload'),
    devTools: getDebugLogPath('devtools'),
    steam: getDebugLogPath('steam'),
  };
}

function flushPendingDebugLogLines(kind) {
  const logPath = getDebugLogPath(kind);
  const pendingLines = debugLogState.pendingLines.get(kind);
  if (!logPath || !pendingLines?.length) {
    return logPath;
  }

  try {
    appendFileSync(logPath, pendingLines.join(''), 'utf8');
    debugLogState.pendingLines.set(kind, []);
  } catch {
    // Logging must never crash the app.
  }

  return logPath;
}

function appendStructuredDebugLog(kind, entry) {
  const line = `${JSON.stringify(entry)}\n`;
  const logPath = getDebugLogPath(kind);
  if (!logPath) {
    const pendingLines = debugLogState.pendingLines.get(kind) || [];
    pendingLines.push(line);
    debugLogState.pendingLines.set(kind, pendingLines);
    return null;
  }

  flushPendingDebugLogLines(kind);
  try {
    appendFileSync(logPath, line, 'utf8');
  } catch {
    const pendingLines = debugLogState.pendingLines.get(kind) || [];
    pendingLines.push(line);
    debugLogState.pendingLines.set(kind, pendingLines);
  }

  return logPath;
}

function recordStructuredDebugLog({
  processType = 'main',
  level = 'info',
  message = '',
  args = [],
  details = {},
  stack = null,
  category = 'runtime',
} = {}) {
  const kind = processType === 'renderer' || processType === 'preload' ? processType : 'main';
  const entry = {
    timestamp: new Date().toISOString(),
    processType: kind,
    level: coerceLogLevel(level),
    category,
    message: typeof message === 'string' ? message : formatLogArguments([message]),
    args: Array.isArray(args) ? args.map((arg) => serializeLogValue(arg)) : [],
    details: details && typeof details === 'object' && !Array.isArray(details)
      ? serializeLogValue(details)
      : {},
    stack: typeof stack === 'string' && stack ? stack : null,
  };

  appendStructuredDebugLog(kind, entry);
  return entry;
}

function installMainConsoleDebugLogging() {
  if (debugLogState.installed) {
    return;
  }

  debugLogState.installed = true;
  ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
    const original = originalConsole[level] || originalConsole.log;
    console[level] = (...args) => {
      original(...args);
      try {
        recordStructuredDebugLog({
          processType: 'main',
          level,
          message: formatLogArguments(args),
          args,
          category: 'console',
        });
      } catch {
        // Logging must never crash the app.
      }
    };
  });
}

function getMainInspectorUrl() {
  try {
    return inspector.url() || null;
  } catch {
    return null;
  }
}

function getMainInspectorPort() {
  const inspectorUrl = getMainInspectorUrl();
  if (inspectorUrl) {
    try {
      return String(new URL(inspectorUrl).port || '');
    } catch {
      return requestedMainInspectorPort;
    }
  }

  return requestedMainInspectorPort;
}

function ensureMainInspector() {
  if (!requestedMainInspectorPort) {
    return null;
  }

  if (getMainInspectorUrl()) {
    debugToolsState.mainInspectorOpened = true;
    return getMainInspectorUrl();
  }

  try {
    inspector.open(Number(requestedMainInspectorPort), '127.0.0.1', false);
    debugToolsState.mainInspectorOpened = true;
    debugToolsState.mainInspectorError = null;
    const inspectorUrl = getMainInspectorUrl();
    recordStructuredDebugLog({
      processType: 'main',
      level: 'info',
      message: `Main inspector enabled on 127.0.0.1:${requestedMainInspectorPort}`,
      details: {
        requestedMainInspectorPort: Number(requestedMainInspectorPort),
        inspectorUrl,
      },
      category: 'debug-tools',
    });
    return inspectorUrl;
  } catch (error) {
    debugToolsState.mainInspectorError = error.message;
    recordStructuredDebugLog({
      processType: 'main',
      level: 'error',
      message: 'Failed to enable the main-process inspector.',
      details: {
        requestedMainInspectorPort: Number(requestedMainInspectorPort),
      },
      stack: error.stack || null,
      category: 'debug-tools',
    });
    return null;
  }
}

function getDebugToolsStatusSnapshot() {
  const status = buildDebugToolsStatus({
    isPackagedWindowsApp,
    remoteDebuggingPort,
    remoteDebuggingUrl,
    mainInspectorPort: getMainInspectorPort(),
    mainInspectorUrl: getMainInspectorUrl(),
    lastRendererDebuggerUrl: debugToolsState.lastRendererDebuggerUrl,
    logPaths: getDebugLogPaths(),
  });
  status.mainInspector.error = debugToolsState.mainInspectorError;
  return status;
}

installMainConsoleDebugLogging();
ensureMainInspector();

if (STEAM_OVERLAY_GPU_SWITCHES_APPLIED) {
  // Modern steamworks.js (v0.4+) handles overlay compositing via
  // electronEnableSteamOverlay() frame invalidator — no longer needs
  // in-process-gpu or disable-direct-composition.
  //
  // in-process-gpu merges the GPU into the main process, so any GPU crash
  // (e.g. from NVIDIA overlay DLL injection) kills the entire app.
  // disable-direct-composition breaks NVIDIA overlay's compositing path.
  //
  // Escape hatch: set SERENITY_LEGACY_GPU_OVERLAY=1 to restore old behavior.
  if (process.env.SERENITY_LEGACY_GPU_OVERLAY === '1') {
    app.commandLine.appendSwitch('in-process-gpu');
    app.commandLine.appendSwitch('disable-direct-composition');
    console.log('[Electron] Steam overlay GPU switches applied (legacy mode via SERENITY_LEGACY_GPU_OVERLAY)');
  } else {
    console.log('[Electron] Steam overlay mode: out-of-process GPU (modern path)');
  }
}

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
let hardwareAccelerationDisabled = false;
let steamCoreBootstrapPromise = null;
let steamExtrasBootstrapPromise = null;
let steamStatusPending = false;

// File-based Steam diagnostics — persisted so they can be read without DevTools.
// Log file: <userData>/logs/steam-init.log
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
const gpuDiagnosticsState = {
  activeWebGLRenderer: null,
  gpuFeatureStatus: null,
  adapters: [],
  auxAttributes: {},
  updatedAt: null,
};
const gpuHealthState = {
  status: 'unknown',
  reasons: [],
  remediation: [],
  activeAdapter: null,
  activeAdapterMatchesPreference: null,
  isUsingSoftwareRenderer: false,
  angleBackend: windowsAngleBackend,
  renderer: null,
  driverVendor: null,
  driverVersion: null,
  updatedAt: null,
};

const desktopRuntimeConfig = {
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  isPackaged: app.isPackaged,
  appMode: app.isPackaged ? 'packaged' : 'electron-dev',
  windowsProfile: windowsRuntimeProfile,
  runtimeProfileMode: windowsLabRuntimeEnabled ? 'lab' : 'shipping',
  safeMode: windowsSafeMode,
  discreteGpuPreference: preferDiscreteGpu,
  legacyWindowsGpuWorkarounds: STEAM_OVERLAY_GPU_SWITCHES_APPLIED,
  angleBackend: windowsAngleBackend,
  remoteDebuggingPort: remoteDebuggingPort ? Number(remoteDebuggingPort) : null,
  remoteDebuggingUrl,
  mainInspectorPort: getMainInspectorPort() ? Number(getMainInspectorPort()) : null,
  mainInspectorUrl: getMainInspectorUrl(),
  desktopThemeThumbnails: isPackagedWindowsApp,
  useStartupRevealGate: isPackagedWindowsApp && windowsLabProfileRequested,
  gpuFallbackActive: false,
  gpuHealth: { ...gpuHealthState },
};

const packagedPerformanceReportState = {
  config: { ...desktopRuntimeConfig },
  createdAt: new Date().toISOString(),
  lastUpdatedAt: null,
  gpuDiagnostics: null,
  gpuHealth: null,
  gpuSwitches: {},
  processMetrics: null,
  startupMarks: [],
  runtimeEvents: [],
  rendererReports: {},
};
const devToolsDiagnosticsState = {
  entries: [],
  pendingLogLines: [],
  nextRequestId: 1,
  pendingOpenRequests: new Map(),
  lastDispatchLatencyMs: null,
};
const devToolsDialogState = {
  active: false,
  lastShownAt: 0,
};

// ez-steam-api integration (for leaderboards - steamworks.js doesn't expose leaderboard API)
let ezSteamApi = null;
let ezSteamInitialized = false;
const ezSteamLeaderboardCache = new Map(); // Cache leaderboard handles

process.on('uncaughtException', (error) => {
  console.error('[Electron] Uncaught exception:', error);
  recordStructuredDebugLog({
    processType: 'main',
    level: 'error',
    message: error?.message || 'Uncaught exception',
    details: {
      name: error?.name || 'Error',
    },
    stack: error?.stack || null,
    category: 'process',
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[Electron] Unhandled rejection:', reason);
  recordStructuredDebugLog({
    processType: 'main',
    level: 'error',
    message: reason?.message || String(reason),
    details: {
      reason: serializeLogValue(reason),
    },
    stack: reason?.stack || null,
    category: 'process',
  });
});

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

function clearSteamOverlayFrameInvalidator(browserWindow) {
  if (!browserWindow) {
    return false;
  }

  if (!browserWindow?._steamRepaintInterval) {
    browserWindow._steamFrameInvalidatorAttached = false;
    return false;
  }

  clearInterval(browserWindow._steamRepaintInterval);
  browserWindow._steamRepaintInterval = null;
  browserWindow._steamFrameInvalidatorAttached = false;
  return true;
}

function attachSteamOverlayFrameInvalidator(browserWindow, source = 'unknown') {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return false;
  }

  applyPendingBrowserWindowRole(browserWindow);
  const windowRole = getWindowRole(browserWindow);
  if (!shouldAttachSteamOverlayFrameInvalidator(windowRole)) {
    recordDevToolsDiagnostic('managed-devtools-host-skipped-by-overlay', {
      source,
      windowId: browserWindow.id,
      role: windowRole,
    });
    return false;
  }

  if (browserWindow._steamFrameInvalidatorAttached) {
    return true;
  }

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

  browserWindow.once('closed', () => {
    clearSteamOverlayFrameInvalidator(browserWindow);
  });
  return true;
}

function installSteamOverlayFrameInvalidatorHook() {
  if (steamOverlayEnabled) {
    return true;
  }

  try {
    BrowserWindow.getAllWindows().forEach((browserWindow) => {
      attachSteamOverlayFrameInvalidator(browserWindow, 'existing-window');
    });
    app.on('browser-window-created', (_event, browserWindow) => {
      applyPendingBrowserWindowRole(browserWindow);
      attachSteamOverlayFrameInvalidator(browserWindow, 'browser-window-created');
    });
    steamOverlayEnabled = true;
    steamLog('Steam overlay frame invalidator registered (custom, no GPU flag injection)');
    return true;
  } catch (error) {
    steamLog(`WARN: Failed to register overlay frame invalidator: ${error.message}`);
    return false;
  }
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
  if (steamServerConnected === isConnected && !steamStatusPending) return;
  steamServerConnected = isConnected;
  steamStatusPending = false;
  steamLog(`Server connection: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'} (source=${source})`);
  if (mainWindow && mainWindow.webContents && rendererReady) {
    mainWindow.webContents.send('steam:serverConnection', {
      connected: isConnected,
      source,
      payload,
    });
  }
  emitSteamStatus(source);
}

function hasUsableSteamClient() {
  return steamInitialized
    && steamworksClient !== null
    && (Boolean(steamSteamId) || Boolean(steamPlayerName));
}

function buildSteamStatusPayload(source = 'unknown') {
  const pending = steamStatusPending || (steamInitialized && steamworksClient !== null && steamServerConnected === null);
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
  steamLog(`emitSteamStatus(${source}): initialized=${payload.initialized} connected=${payload.connected} pending=${payload.pending} player=${payload.playerName || 'none'} rendererReady=${rendererReady}`);
  if (mainWindow && mainWindow.webContents && rendererReady) {
    mainWindow.webContents.send('steam:status', payload);
  }
  emitRuntimeEvent('steam-status', payload);
  return payload;
}

function registerSteamCallbacks() {
  if (!steamworksClient?.callback?.register || !steamworksModule?.SteamCallback) {
    steamLog(`WARN: Cannot register callbacks - client.callback.register=${!!steamworksClient?.callback?.register}, SteamCallback=${!!steamworksModule?.SteamCallback}`);
    return;
  }
  steamLog('Registering Steam callbacks (SteamServersConnected, Disconnected, ConnectFailure, LobbyJoinRequested)');

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

// Early Steam initialization — runs BEFORE createWindow() so the overlay
// frame-invalidator is registered via the browser-window-created event.
// GPU switches (in-process-gpu, disable-direct-composition) are already
// applied at module load time via STEAM_OVERLAY_GPU_SWITCHES_APPLIED.
async function earlySteamInit() {
  // Truncate the log file on each app launch so it stays fresh
  try {
    const logPath = getSteamLogPath();
    if (logPath) writeFileSync(logPath, `--- Serenity Blocks Steam Init Log (${new Date().toISOString()}) ---\n`, 'utf8');
  } catch { /* best-effort */ }

  if (process.env.SERENITY_DISABLE_STEAM_BOOTSTRAP === '1') {
    steamLog('Early Steam init skipped (SERENITY_DISABLE_STEAM_BOOTSTRAP)');
    return false;
  }

  try {
    const steamworksSpecifier = resolveSteamworksModuleSpecifier();
    steamLog(`Early Steam init: loading module "${steamworksSpecifier}"`);
    const steamworks = await import(steamworksSpecifier);
    steamworksModule = steamworks;
    steamLog(`Module loaded. exports: ${Object.keys(steamworks).join(', ')}`);

    // Register the overlay frame invalidator WITHOUT calling electronEnableSteamOverlay(),
    // because that function internally re-adds in-process-gpu + disable-direct-composition
    // which we explicitly removed to fix NVIDIA overlay crashes.
    installSteamOverlayFrameInvalidatorHook();

    // Initialize the Steam client
    steamAppId = resolveSteamAppId();
    steamLog(`Resolved Steam App ID: ${steamAppId}`);
    steamLog(`steam_appid.txt search dirs: cwd=${process.cwd()}, appPath=${app.getAppPath()}, execDir=${dirname(process.execPath)}`);
    steamworksClient = steamworks.init(steamAppId);

    if (steamworksClient) {
      steamInitialized = true;
      steamServerConnected = null;
      steamSteamId = steamworksClient.localplayer.getSteamId().steamId64.toString();
      steamPlayerName = steamworksClient.localplayer.getName();
      steamLog(`Steam initialized early: player="${steamPlayerName}" steamId=${steamSteamId}`);
      registerSteamCallbacks();
      return true;
    } else {
      steamLog('WARN: steamworks.init() returned falsy client');
    }
  } catch (err) {
    steamLog(`ERROR: Early Steam init failed: ${err.message}`);
    steamLog(`  Stack: ${err.stack?.split('\n').slice(0, 5).join(' | ')}`);
  }

  return false;
}

// Try to initialize Steamworks with retry logic
async function initSteamworks(retries = 3) {
  // Short-circuit if early init already succeeded
  if (steamInitialized && steamworksClient) {
    steamLog('initSteamworks: already initialized via early init');
    return true;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const steamworksSpecifier = resolveSteamworksModuleSpecifier();
      steamLog(`initSteamworks attempt ${attempt}/${retries}: loading "${steamworksSpecifier}"`);
      const steamworks = await import(steamworksSpecifier);
      steamworksModule = steamworks;

      // Frame invalidator already registered in earlySteamInit; register here
      // as fallback if early init was skipped. Do NOT call electronEnableSteamOverlay()
      // because it re-adds in-process-gpu + disable-direct-composition GPU flags.
      installSteamOverlayFrameInvalidatorHook();

      steamAppId = resolveSteamAppId();
      steamLog(`initSteamworks: resolved App ID=${steamAppId}`);
      steamworksClient = steamworks.init(steamAppId);

      if (steamworksClient) {
        steamInitialized = true;
        steamServerConnected = null;
        steamSteamId = steamworksClient.localplayer.getSteamId().steamId64.toString();
        steamPlayerName = steamworksClient.localplayer.getName();

        steamLog(`Steamworks initialized: player="${steamPlayerName}" steamId=${steamSteamId}`);
        registerSteamCallbacks();
        return true;
      } else {
        steamLog('WARN: steamworks.init() returned falsy client');
      }
    } catch (err) {
      const delay = Math.pow(2, attempt) * 500;
      steamLog(`ERROR: Steam init attempt ${attempt}/${retries} failed: ${err.message}`);
      steamLog(`  Stack: ${err.stack?.split('\n').slice(0, 5).join(' | ')}`);
      if (attempt < retries) {
        steamLog(`  Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  steamLog('FINAL: Steam unavailable after all retries - running in offline mode');
  steamInitialized = false;
  steamworksClient = null;
  steamSteamId = null;
  steamPlayerName = null;
  steamServerConnected = false;
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
  console.log(`[Electron] Windows ${windowsRuntimeProfile} profile - applying parity-first GPU settings`);
  app.commandLine.appendSwitch('enable-webgl');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('use-angle', windowsAngleBackend || 'd3d11');
  console.log(`[Electron] ANGLE backend: ${windowsAngleBackend || 'd3d11'}`);
  if (preferDiscreteGpu) {
    app.commandLine.appendSwitch('force-high-performance-gpu');
  }

  // Anti-throttling flags for ALL packaged Windows builds.
  // backgroundThrottling: false in webPreferences only controls JS timer throttling,
  // not Chromium compositor/GPU throttling. Without these flags, Chromium throttles
  // the renderer when backgrounded, causing freezes on alt-tab return.
  if (isPackagedWindowsApp) {
    app.commandLine.appendSwitch('disable-background-timer-throttling');
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  }

  if (windowsLabRuntimeEnabled && windowsLabProfileRequested) {
    console.log('[Electron] Windows lab runtime enabled for comparison profile');
    if (process.env.SERENITY_IGNORE_GPU_BLOCKLIST === '1') {
      app.commandLine.appendSwitch('ignore-gpu-blocklist');
      console.log('[Electron] ignore-gpu-blocklist enabled via environment variable');
    }
    if (process.env.SERENITY_ENABLE_ZERO_COPY === '1') {
      app.commandLine.appendSwitch('enable-zero-copy');
      console.log('[Electron] enable-zero-copy enabled via environment variable');
    }
    if (process.env.SERENITY_ENABLE_IN_PROCESS_GPU === '1') {
      app.commandLine.appendSwitch('in-process-gpu');
      console.log('[Electron] in-process-gpu enabled via environment variable');
    }

    if (windowsRuntimeProfile === 'aggressive') {
      app.commandLine.appendSwitch('disable-frame-rate-limit');
      app.commandLine.appendSwitch('disable-gpu-vsync');
    }
  }
} else {
  // Linux/Mac native - minimal flags
  console.log('[Electron] Native mode - using minimal GPU settings');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

// V8 performance: increase heap limit for Three.js + Phaser memory usage,
// and enable out-of-process canvas rasterization to reduce main-thread GPU contention.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=2048');
// CanvasOopRasterization removed — it broke DevTools rendering on some Windows setups.

if (remoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort);
  recordDevToolsDiagnostic('remote-debugging-configured', {
    port: Number(remoteDebuggingPort),
    url: remoteDebuggingUrl,
    source: requestedRemoteDebuggingPort
      ? (process.env.SERENITY_REMOTE_DEBUGGING_PORT ? 'env' : 'cli')
      : 'packaged-default',
  });
}

let mainWindow;
let applicationMenu = null;
let currentVSyncEnabled = null;
let startupGpuDiagnosticsReady = null;
let packagedDiagnosticsActive = packagedDiagnosticsForced || !isPackagedWindowsApp || windowsRuntimeProfile !== 'webParity';
let deferredDesktopMainServicesStarted = false;
const devToolsShortcutState = createDevToolsShortcutState();
const startupRevealState = {
  gated: false,
  browserReady: false,
  rendererShellReady: false,
};
const MAIN_WINDOW_ROLE = 'main-window';
let managedDevToolsHostWindow = null;
let pendingBrowserWindowRole = null;

const originalIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => originalIpcHandle(channel, async (event, ...args) => {
  if (mainWindow && event?.sender?.id !== mainWindow.webContents.id) {
    throw new Error(`Unauthorized IPC sender for channel: ${channel}`);
  }
  return listener(event, ...args);
});

function emitRuntimeEvent(type, payload = {}) {
  packagedPerformanceReportState.runtimeEvents.push({
    type,
    timestamp: Date.now(),
    payload,
  });
  if (packagedPerformanceReportState.runtimeEvents.length > 120) {
    packagedPerformanceReportState.runtimeEvents.shift();
  }

  recordStructuredDebugLog({
    processType: 'main',
    level: 'info',
    message: `Runtime event: ${type}`,
    details: payload,
    category: 'runtime-event',
  });

  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send('desktop:runtime-event', {
        type,
        timestamp: Date.now(),
        ...payload,
      });
    } catch (error) {
      console.warn('[Electron] Failed to emit runtime event:', type, error.message);
    }
  }
}

function setWindowRole(browserWindow, role = null) {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return browserWindow;
  }

  browserWindow.__serenityWindowRole = role;
  return browserWindow;
}

function getWindowRole(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return null;
  }

  return browserWindow.__serenityWindowRole || null;
}

function applyPendingBrowserWindowRole(browserWindow) {
  if (!browserWindow || !pendingBrowserWindowRole) {
    return browserWindow;
  }

  return setWindowRole(browserWindow, pendingBrowserWindowRole);
}

function createBrowserWindowWithRole(role, options) {
  pendingBrowserWindowRole = role;
  try {
    const browserWindow = new BrowserWindow(options);
    setWindowRole(browserWindow, role);
    return browserWindow;
  } finally {
    pendingBrowserWindowRole = null;
  }
}

function buildBrowserWindowSnapshot(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) {
    return null;
  }

  const contents = browserWindow.webContents;
  const windowRole = getWindowRole(browserWindow);
  const rawDevToolsOpen = contents?.isDevToolsOpened?.() ?? false;
  const hostReady = windowRole === MANAGED_DEVTOOLS_HOST_ROLE
    && typeof contents?.getURL?.() === 'string'
    && contents.getURL().startsWith('devtools://');
  return {
    id: browserWindow.id,
    role: windowRole,
    title: browserWindow.getTitle?.() || null,
    visible: browserWindow.isVisible?.() ?? false,
    focused: browserWindow.isFocused?.() ?? false,
    minimized: browserWindow.isMinimized?.() ?? false,
    maximized: browserWindow.isMaximized?.() ?? false,
    fullscreen: browserWindow.isFullScreen?.() ?? false,
    bounds: browserWindow.getBounds?.() || null,
    contentBounds: browserWindow.getContentBounds?.() || null,
    webContentsId: contents?.id ?? null,
    webContentsType: contents?.getType?.() || null,
    url: contents?.getURL?.() || null,
    isLoadingMainFrame: contents?.isLoadingMainFrame?.() ?? false,
    isDevToolsOpened: rawDevToolsOpen,
    isDevToolsConsideredOpen: rawDevToolsOpen || hostReady,
  };
}

function buildWebContentsSnapshot(contents) {
  if (!contents || contents.isDestroyed?.()) {
    return null;
  }

  const ownerWindow = BrowserWindow.fromWebContents(contents);
  return {
    id: contents.id,
    type: contents.getType?.() || null,
    url: contents.getURL?.() || null,
    title: contents.getTitle?.() || null,
    ownerWindowId: ownerWindow?.id ?? null,
    ownerWindowRole: getWindowRole(ownerWindow),
    isLoadingMainFrame: contents.isLoadingMainFrame?.() ?? false,
    isFocused: contents.isFocused?.() ?? false,
    isDevToolsOpened: contents.isDevToolsOpened?.() ?? false,
    osProcessId: contents.getOSProcessId?.() ?? null,
  };
}

function getAllWebContentsSnapshot() {
  try {
    return electronWebContents.getAllWebContents()
      .map((contents) => buildWebContentsSnapshot(contents))
      .filter(Boolean);
  } catch (error) {
    return [{
      error: error.message,
    }];
  }
}

function getManagedDevToolsHostWindow() {
  if (!managedDevToolsHostWindow || managedDevToolsHostWindow.isDestroyed()) {
    managedDevToolsHostWindow = null;
    return null;
  }

  return managedDevToolsHostWindow;
}

function isManagedDevToolsHostReady() {
  const hostWindow = getManagedDevToolsHostWindow();
  if (!hostWindow || hostWindow.isDestroyed()) {
    return false;
  }

  const hostUrl = hostWindow.webContents?.getURL?.() || '';
  return typeof hostUrl === 'string' && hostUrl.startsWith('devtools://');
}

function isMainWindowDevToolsOpen() {
  const webContents = getMainWindowWebContents();
  if (webContents?.isDevToolsOpened?.()) {
    return true;
  }

  if (!getMainWindowDevToolsOpenStrategy().useManagedHost) {
    return false;
  }

  return isManagedDevToolsHostReady();
}

function getDevToolsLogPath() {
  return getDebugLogPath('devtools');
}

function flushPendingDevToolsLogLines() {
  const logPath = getDevToolsLogPath();
  if (!logPath || devToolsDiagnosticsState.pendingLogLines.length === 0) {
    return logPath;
  }

  try {
    appendFileSync(logPath, devToolsDiagnosticsState.pendingLogLines.join(''), 'utf8');
    devToolsDiagnosticsState.pendingLogLines = [];
  } catch (error) {
    console.warn('[Electron][DevTools] Failed to flush pending log lines:', error.message);
  }

  return logPath;
}

function recordDevToolsDiagnostic(type, payload = {}) {
  const entry = {
    type,
    timestamp: new Date().toISOString(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    pid: process.pid,
    payload,
  };

  devToolsDiagnosticsState.entries.push(entry);
  if (devToolsDiagnosticsState.entries.length > DEVTOOLS_DIAGNOSTICS_MAX_ENTRIES) {
    devToolsDiagnosticsState.entries.shift();
  }

  const line = `${JSON.stringify(entry)}\n`;
  const logPath = getDevToolsLogPath();

  if (!logPath) {
    devToolsDiagnosticsState.pendingLogLines.push(line);
    return entry;
  }

  flushPendingDevToolsLogLines();
  try {
    appendFileSync(logPath, line, 'utf8');
  } catch (error) {
    console.warn('[Electron][DevTools] Failed to append diagnostic entry:', error.message);
    devToolsDiagnosticsState.pendingLogLines.push(line);
  }

  return entry;
}

function getDevToolsDiagnosticsSnapshot() {
  const logPath = flushPendingDevToolsLogLines() || getDevToolsLogPath();
  const activePendingOpenRequest = getActivePendingDevToolsOpenRequest();
  const debugToolsStatus = getDebugToolsStatusSnapshot();
  return {
    logPath,
    remoteDebuggingPort: remoteDebuggingPort ? Number(remoteDebuggingPort) : null,
    remoteDebuggingUrl,
    mainInspectorPort: getMainInspectorPort() ? Number(getMainInspectorPort()) : null,
    mainInspectorUrl: getMainInspectorUrl(),
    isOpen: isMainWindowDevToolsOpen(),
    openStrategy: getMainWindowDevToolsOpenStrategy(),
    mainWindow: buildBrowserWindowSnapshot(mainWindow),
    managedHostWindow: buildBrowserWindowSnapshot(getManagedDevToolsHostWindow()),
    debugToolsStatus,
    logPaths: debugToolsStatus.logPaths,
    activePendingOpenRequest: activePendingOpenRequest
      ? {
          requestId: activePendingOpenRequest.requestId,
          source: activePendingOpenRequest.source,
          startedAt: activePendingOpenRequest.startedAt,
          dispatchStartedAt: activePendingOpenRequest.dispatchStartedAt || null,
          dispatchLatencyMs: activePendingOpenRequest.dispatchLatencyMs || null,
        }
      : null,
    lastDispatchLatencyMs: devToolsDiagnosticsState.lastDispatchLatencyMs ?? null,
    processMetrics: getProcessMetricsSnapshot(),
    gpuDiagnostics: safeBuildGpuDiagnosticsPayload('devtools-diagnostics-snapshot'),
    gpuHealth: buildGpuHealthPayload(),
    webContents: getAllWebContentsSnapshot(),
    entries: [...devToolsDiagnosticsState.entries],
    pendingOpenRequests: [...devToolsDiagnosticsState.pendingOpenRequests.values()].map((pending) => ({
      requestId: pending.requestId,
      source: pending.source,
      startedAt: pending.startedAt,
      dispatchStartedAt: pending.dispatchStartedAt || null,
      dispatchLatencyMs: pending.dispatchLatencyMs || null,
    })),
  };
}

function formatDevToolsDiagnosticDetail(extraLines = []) {
  const debugToolsStatus = getDebugToolsStatusSnapshot();
  const lines = [
    `DevTools open: ${isMainWindowDevToolsOpen() ? 'yes' : 'no'}`,
    `Window focused: ${mainWindow?.isFocused?.() ? 'yes' : 'no'}`,
    `Window visible: ${mainWindow?.isVisible?.() ? 'yes' : 'no'}`,
    `Menu attached: ${applicationMenu ? 'yes' : 'no'}`,
    `Renderer Debugger: ${debugToolsStatus.rendererDebugger.baseUrl || 'disabled'}`,
    `Main Inspector: ${debugToolsStatus.mainInspector.enabled ? `127.0.0.1:${debugToolsStatus.mainInspector.port}` : 'disabled'}`,
    `Logs: ${debugToolsStatus.logPaths.logsDir || 'unavailable'}`,
  ];

  return [...lines, ...extraLines].join('\n');
}

function showDevToolsDiagnosticDialog({
  title = 'DevTools',
  message,
  detail = '',
  type = 'info',
} = {}) {
  if (!mainWindow || mainWindow.isDestroyed() || !message) {
    return false;
  }

  const now = Date.now();
  if (devToolsDialogState.active || (now - devToolsDialogState.lastShownAt) < 800) {
    return false;
  }

  devToolsDialogState.active = true;
  devToolsDialogState.lastShownAt = now;

  void dialog.showMessageBox(mainWindow, {
    type,
    title,
    message,
    detail,
    buttons: ['OK'],
    normalizeAccessKeys: true,
    noLink: true,
  }).catch(() => {
    // Best-effort diagnostics only.
  }).finally(() => {
    devToolsDialogState.active = false;
  });

  return true;
}

function describeDevToolsShortcut(input = {}) {
  if (input.type !== 'keyDown') {
    return null;
  }

  if (input.key === 'F12') {
    return 'F12';
  }

  if ((input.key === 'I' || input.key === 'i') && input.control && input.shift) {
    return 'Ctrl+Shift+I';
  }

  return null;
}

function scheduleDevToolsShortcutPostCheck(shortcutLabel, source = 'unknown') {
  setTimeout(() => {
    const isOpen = isMainWindowDevToolsOpen();
    recordDevToolsDiagnostic('devtools-shortcut-post-check', {
      shortcut: shortcutLabel,
      source,
      isOpen,
    });

    if (isOpen || !isPackagedWindowsApp) {
      return;
    }

    showDevToolsDiagnosticDialog({
      title: 'DevTools Shortcut',
      message: `The app observed ${shortcutLabel}, but DevTools still did not open.`,
      detail: formatDevToolsDiagnosticDetail([
        'Try the visible View menu next.',
        'If it still fails, connect through the Remote Inspector URL above.',
      ]),
      type: 'warning',
    });
  }, 350);
}

function createDevToolsRequestId(source = 'unknown') {
  const safeSource = String(source).replace(/[^a-z0-9_-]+/ig, '-');
  const requestId = `devtools-${safeSource}-${Date.now()}-${devToolsDiagnosticsState.nextRequestId}`;
  devToolsDiagnosticsState.nextRequestId += 1;
  return requestId;
}

function clearPendingDevToolsOpenRequest(requestId) {
  const pending = devToolsDiagnosticsState.pendingOpenRequests.get(requestId);
  if (!pending) {
    return null;
  }

  clearTimeout(pending.timeoutId);
  devToolsDiagnosticsState.pendingOpenRequests.delete(requestId);
  return pending;
}

function getActivePendingDevToolsOpenRequest() {
  const iterator = devToolsDiagnosticsState.pendingOpenRequests.values().next();
  return iterator.done ? null : iterator.value;
}

function buildDevToolsFailureDiagnosticPayload(payload = {}) {
  return {
    ...payload,
    mainWindow: buildBrowserWindowSnapshot(mainWindow),
    managedHostWindow: buildBrowserWindowSnapshot(getManagedDevToolsHostWindow()),
    webContents: getAllWebContentsSnapshot(),
    processMetrics: getProcessMetricsSnapshot(),
    gpuDiagnostics: safeBuildGpuDiagnosticsPayload('devtools-open-failed'),
    gpuHealth: buildGpuHealthPayload(),
    dispatchLatencyMs: payload.dispatchLatencyMs ?? null,
  };
}

function emitDevToolsOpenFailure({
  requestId,
  source = 'unknown',
  failureKind = 'error',
  error = null,
  extra = {},
} = {}) {
  const errorMessage = error?.message || null;
  const errorStack = error?.stack || null;
  const isOpen = isMainWindowDevToolsOpen();
  const payload = {
    requestId,
    source,
    failureKind,
    errorMessage,
    errorStack,
    isOpen,
    ...extra,
  };

  recordDevToolsDiagnostic('devtools-open-failed', buildDevToolsFailureDiagnosticPayload(payload));
  if (getMainWindowDevToolsOpenStrategy().useManagedHost && !isOpen) {
    destroyManagedDevToolsHostWindow(`open-failed:${failureKind}`);
  }
  emitRuntimeEvent('devtools-open-failed', {
    ...payload,
    logPath: getDevToolsLogPath(),
  });
}

function emitDevToolsOpenResolved(payload = {}, { defer = false } = {}) {
  const emitResolved = () => {
    recordDevToolsDiagnostic('devtools-open-resolved', payload);
    emitRuntimeEvent('devtools-opened', {
      ...payload,
      logPath: getDevToolsLogPath(),
    });
  };

  if (defer) {
    setImmediate(emitResolved);
    return;
  }

  emitResolved();
}

function registerPendingDevToolsOpenRequest(requestId, source) {
  const pending = {
    requestId,
    source,
    startedAt: Date.now(),
    timeoutId: null,
    dispatchStartedAt: null,
    dispatchLatencyMs: null,
  };
  const timeoutId = setTimeout(() => {
    const pending = clearPendingDevToolsOpenRequest(requestId);
    if (!pending) {
      return;
    }

    const isOpenAfterTimeout = isMainWindowDevToolsOpen();
    if (isOpenAfterTimeout) {
      showAndFocusManagedDevToolsHostWindow(`${pending.source}:timeout-open-state`);
      emitDevToolsOpenResolved({
        requestId,
        source: pending.source,
        isOpen: true,
        alreadyOpen: false,
        via: 'timeout-open-state',
      });
      return;
    }

    emitDevToolsOpenFailure({
      requestId,
      source: pending.source,
      failureKind: 'timeout',
      extra: {
        timeoutMs: DEVTOOLS_OPEN_TIMEOUT_MS,
        isOpenAfterTimeout,
        dispatchLatencyMs: pending.dispatchLatencyMs,
      },
    });
  }, DEVTOOLS_OPEN_TIMEOUT_MS);

  pending.timeoutId = timeoutId;
  devToolsDiagnosticsState.pendingOpenRequests.set(requestId, pending);
  return pending;
}

function failPendingDevToolsOpenRequests({
  failureKind = 'error',
  error = null,
  extra = {},
} = {}) {
  const pendingRequests = [...devToolsDiagnosticsState.pendingOpenRequests.values()];

  pendingRequests.forEach((pending) => {
    clearPendingDevToolsOpenRequest(pending.requestId);
    emitDevToolsOpenFailure({
      requestId: pending.requestId,
      source: pending.source,
      failureKind,
      error,
      extra,
    });
  });

  return pendingRequests.length;
}

function resolvePendingDevToolsOpenRequests(extra = {}) {
  const pendingRequests = [...devToolsDiagnosticsState.pendingOpenRequests.values()];
  devToolsDiagnosticsState.pendingOpenRequests.clear();

  pendingRequests.forEach((pending) => {
    clearTimeout(pending.timeoutId);
    const payload = {
      requestId: pending.requestId,
      source: pending.source,
      isOpen: isMainWindowDevToolsOpen(),
      ...extra,
    };
    emitDevToolsOpenResolved(payload);
  });

  return pendingRequests.length;
}

function showAndFocusMainWindow(reason = 'unknown') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!mainWindow.isVisible()) {
    console.log(`[Electron] Revealing main window (${reason})`);
    mainWindow.show();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

function getMainWindowWebContents() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }

  const { webContents } = mainWindow;
  if (!webContents || webContents.isDestroyed()) {
    return null;
  }

  return webContents;
}

function getMainWindowDevToolsOpenStrategy() {
  return getDevToolsOpenStrategy({
    isPackagedWindowsApp,
    devToolsSmokeMode,
  });
}

function showAndFocusManagedDevToolsHostWindow(reason = 'unknown') {
  const hostWindow = getManagedDevToolsHostWindow();
  if (!hostWindow) {
    return false;
  }

  if (hostWindow.isMinimized()) {
    hostWindow.restore();
  }

  if (!hostWindow.isVisible()) {
    hostWindow.show();
  }

  hostWindow.focus();
  recordDevToolsDiagnostic('managed-devtools-host-shown', {
    reason,
    hostWindow: buildBrowserWindowSnapshot(hostWindow),
  });
  return true;
}

function focusNativeDevToolsWindow(source = 'unknown') {
  const webContents = getMainWindowWebContents();
  if (!webContents) return false;

  const devToolsWC = webContents.devToolsWebContents;
  if (!devToolsWC) return false;

  const devToolsWindow = BrowserWindow.fromWebContents(devToolsWC);
  if (!devToolsWindow || devToolsWindow.isDestroyed()) return false;

  if (devToolsWindow.isMinimized()) {
    devToolsWindow.restore();
  }
  devToolsWindow.show();
  devToolsWindow.focus();

  recordDevToolsDiagnostic('native-devtools-window-focused', {
    source,
    devToolsWindowId: devToolsWindow.id,
  });
  return true;
}

function destroyManagedDevToolsHostWindow(reason = 'unknown') {
  const hostWindow = getManagedDevToolsHostWindow();
  if (!hostWindow) {
    return false;
  }

  hostWindow.__serenityManagedHostClosingReason = reason;
  const hostSnapshot = buildBrowserWindowSnapshot(hostWindow);
  managedDevToolsHostWindow = null;
  recordDevToolsDiagnostic('managed-devtools-host-closed', {
    reason,
    hostWindow: hostSnapshot,
  });
  clearSteamOverlayFrameInvalidator(hostWindow);

  if (!hostWindow.isDestroyed()) {
    hostWindow.destroy();
  }

  return true;
}

function ensureManagedDevToolsHostWindow({ fresh = false } = {}) {
  const existingWindow = getManagedDevToolsHostWindow();
  if (fresh && existingWindow) {
    destroyManagedDevToolsHostWindow('stale-before-open');
  }

  const reusableWindow = fresh ? null : existingWindow;
  if (reusableWindow) {
    return {
      hostWindow: reusableWindow,
      created: false,
    };
  }

  const currentWindow = getManagedDevToolsHostWindow();
  if (currentWindow) {
    return {
      hostWindow: currentWindow,
      created: false,
    };
  }

  const hostWindow = createBrowserWindowWithRole(MANAGED_DEVTOOLS_HOST_ROLE, {
    width: 1280,
    height: 840,
    show: false,
    autoHideMenuBar: true,
    title: 'Serenity Blocks DevTools',
    backgroundColor: '#11151f',
    webPreferences: {
      backgroundThrottling: false,
      sandbox: false,
    },
  });

  setWindowRole(hostWindow, MANAGED_DEVTOOLS_HOST_ROLE);
  hostWindow.on('closed', () => {
    if (managedDevToolsHostWindow === hostWindow) {
      managedDevToolsHostWindow = null;
      recordDevToolsDiagnostic('managed-devtools-host-closed', {
        reason: hostWindow.__serenityManagedHostClosingReason || 'window-closed',
        hostWindow: {
          id: hostWindow.id,
          role: MANAGED_DEVTOOLS_HOST_ROLE,
        },
      });
    }
  });
  hostWindow.once('ready-to-show', () => {
    showAndFocusManagedDevToolsHostWindow('ready-to-show');
  });
  hostWindow.webContents.on('did-finish-load', () => {
    recordDevToolsDiagnostic('managed-devtools-host-loaded', {
      hostWindow: buildBrowserWindowSnapshot(hostWindow),
    });
  });

  managedDevToolsHostWindow = hostWindow;
  recordDevToolsDiagnostic('managed-devtools-host-created', {
    hostWindow: buildBrowserWindowSnapshot(hostWindow),
  });
  return {
    hostWindow,
    created: true,
  };
}

function closeMainWindowDevTools(source = 'unknown') {
  const webContents = getMainWindowWebContents();
  if (!webContents) {
    console.warn('[Electron][DevTools] Cannot close - no webContents');
    destroyManagedDevToolsHostWindow(`${source}:window-unavailable`);
    return false;
  }

  recordDevToolsDiagnostic('devtools-close-requested', { source });
  webContents.closeDevTools();
  if (getMainWindowDevToolsOpenStrategy().useManagedHost) {
    destroyManagedDevToolsHostWindow(`${source}:close-request`);
  }
  return true;
}

function formatDebugToolsStatusDialogDetail(extraLines = []) {
  const status = getDebugToolsStatusSnapshot();
  const lines = [
    `Renderer debugger mode: ${status.rendererDebugger.mode}`,
    `Renderer debugger base URL: ${status.rendererDebugger.baseUrl || 'disabled'}`,
    `Renderer target list: ${status.rendererDebugger.jsonListUrl || 'unavailable'}`,
    `Main inspector: ${status.mainInspector.enabled ? `127.0.0.1:${status.mainInspector.port}` : 'disabled'}`,
    `Main inspector help: ${status.mainInspector.chromeInspectUrl}`,
    `Main log: ${status.logPaths.main || 'unavailable'}`,
    `Renderer log: ${status.logPaths.renderer || 'unavailable'}`,
    `Preload log: ${status.logPaths.preload || 'unavailable'}`,
    `DevTools log: ${status.logPaths.devTools || 'unavailable'}`,
  ];

  if (status.mainInspector.webSocketUrl) {
    lines.push(`Main inspector WebSocket: ${status.mainInspector.webSocketUrl}`);
  }
  if (status.rendererDebugger.lastOpenedUrl) {
    lines.push(`Last renderer debugger URL: ${status.rendererDebugger.lastOpenedUrl}`);
  }

  return [...lines, ...extraLines].join('\n');
}

function showDebugToolsStatusDialog(message = 'Debugging tools are ready.', extraLines = [], type = 'info') {
  return showDevToolsDiagnosticDialog({
    title: 'Debugging Tools',
    message,
    detail: formatDebugToolsStatusDialogDetail(extraLines),
    type,
  });
}

async function fetchRendererDebugTargets() {
  if (!remoteDebuggingUrl) {
    throw new Error('Renderer remote debugging is not enabled.');
  }

  const response = await fetch(`${remoteDebuggingUrl}/json/list`);
  if (!response.ok) {
    throw new Error(`Renderer target query failed with HTTP ${response.status}.`);
  }

  const targets = await response.json();
  if (!Array.isArray(targets)) {
    throw new Error('Renderer target query returned an unexpected payload.');
  }

  return targets;
}

async function openExternalRendererDebugger(source = 'unknown') {
  const requestId = createDevToolsRequestId(`renderer-debugger-${source}`);
  const mainWindowUrl = getMainWindowWebContents()?.getURL?.() || null;
  recordDevToolsDiagnostic('renderer-debugger-requested', {
    requestId,
    source,
    remoteDebuggingUrl,
    mainWindowUrl,
  });

  if (!remoteDebuggingUrl) {
    const error = new Error('Renderer remote debugging is disabled.');
    emitDevToolsOpenFailure({
      requestId,
      source,
      failureKind: 'remote-debugging-disabled',
      error,
      extra: {
        remoteDebuggingUrl,
      },
    });
    showDebugToolsStatusDialog(
      'Renderer debugger is not enabled for this build.',
      [
        'Packaged Windows should expose a localhost renderer debugger port.',
        'If this is unexpected, check the debug configuration and app startup logs.',
      ],
      'warning',
    );
    return {
      accepted: false,
      requestId,
      alreadyOpen: false,
    };
  }

  try {
    const targets = await fetchRendererDebugTargets();
    const target = resolveRendererDebugTarget({
      targets,
      mainWindowUrl: mainWindowUrl || '',
    });

    recordDevToolsDiagnostic('renderer-debugger-targets-fetched', {
      requestId,
      source,
      targetCount: targets.length,
      mainWindowUrl,
      selectedTargetUrl: target?.url || null,
      selectedTargetId: target?.id || null,
    });

    if (!target) {
      throw new Error('No renderer page target was reported by the remote debugging endpoint.');
    }

    const debuggerUrl = resolveDevToolsFrontendUrl({
      target,
      remoteDebuggingUrl,
    });

    if (!debuggerUrl) {
      throw new Error('The renderer target did not provide a usable DevTools frontend URL.');
    }

    await shell.openExternal(debuggerUrl);
    debugToolsState.lastRendererDebuggerUrl = debuggerUrl;
    debugToolsState.lastRendererDebuggerOpenedAt = new Date().toISOString();
    recordDevToolsDiagnostic('renderer-debugger-opened', {
      requestId,
      source,
      debuggerUrl,
      targetId: target.id || null,
      targetUrl: target.url || null,
    });
    emitDevToolsOpenResolved({
      requestId,
      source,
      alreadyOpen: false,
      isOpen: false,
      external: true,
      debuggerUrl,
      via: 'remote-debugging-frontend',
    }, { defer: true });
    return {
      accepted: true,
      requestId,
      alreadyOpen: false,
      external: true,
      debuggerUrl,
    };
  } catch (error) {
    emitDevToolsOpenFailure({
      requestId,
      source,
      failureKind: 'renderer-debugger-open-failed',
      error,
      extra: {
        remoteDebuggingUrl,
        mainWindowUrl,
      },
    });
    showDebugToolsStatusDialog(
      'Renderer debugger could not be opened automatically.',
      [
        error.message,
        'Open Chrome or Edge and navigate to chrome://inspect/#devices.',
        `Configure target 127.0.0.1:${remoteDebuggingPort} if it does not appear automatically.`,
      ],
      'warning',
    );
    return {
      accepted: false,
      requestId,
      alreadyOpen: false,
    };
  }
}

function requestMainWindowReload(source = 'unknown') {
  const webContents = getMainWindowWebContents();
  if (!webContents) {
    console.warn('[Electron][DevTools] Cannot reload - no webContents');
    return false;
  }

  recordDevToolsDiagnostic('window-reload-requested', { source });
  webContents.reload();
  return true;
}

function requestMainWindowDevToolsOpen(source = 'unknown') {
  const webContents = getMainWindowWebContents();
  if (!webContents) {
    const requestId = createDevToolsRequestId(source);
    emitDevToolsOpenFailure({
      requestId,
      source,
      failureKind: 'unavailable',
      extra: {
        reason: 'window-unavailable',
      },
    });
    return {
      accepted: false,
      requestId,
      alreadyOpen: false,
    };
  }

  const strategy = getMainWindowDevToolsOpenStrategy();
  const alreadyOpen = isMainWindowDevToolsOpen();
  const activePendingRequest = getActivePendingDevToolsOpenRequest();
  const requestDecision = decideDevToolsOpenRequest({
    activePendingRequest,
    newRequestId: createDevToolsRequestId(source),
    source,
  });
  recordDevToolsDiagnostic('devtools-open-requested', {
    requestId: requestDecision.request.requestId,
    source,
    alreadyOpen,
    hasPendingOpen: Boolean(activePendingRequest),
    openStrategy: strategy,
  });

  if (alreadyOpen) {
    if (strategy.useManagedHost) {
      showAndFocusManagedDevToolsHostWindow(`${source}:already-open`);
    }
    emitDevToolsOpenResolved({
      requestId: requestDecision.request.requestId,
      source,
      isOpen: true,
      alreadyOpen: true,
      via: 'already-open',
    }, { defer: true });
    return {
      accepted: true,
      requestId: requestDecision.request.requestId,
      alreadyOpen: true,
    };
  }

  if (requestDecision.type === 'reuse') {
    recordDevToolsDiagnostic('devtools-open-request-collapsed', {
      requestId: requestDecision.request.requestId,
      source,
      pendingSource: requestDecision.request.source,
      ageMs: requestDecision.ageMs,
    });
    return requestDecision.response;
  }

  const pendingRequest = registerPendingDevToolsOpenRequest(requestDecision.request.requestId, source);
  const nextWebContents = getMainWindowWebContents();
  if (!nextWebContents) {
    failPendingDevToolsOpenRequests({
      failureKind: 'unavailable',
      extra: {
        reason: 'window-unavailable',
      },
    });
    return requestDecision.response;
  }

  try {
    let managedHostWindow = null;
    if (strategy.useManagedHost) {
      const hostState = ensureManagedDevToolsHostWindow({ fresh: true });
      managedHostWindow = hostState.hostWindow;
      nextWebContents.setDevToolsWebContents(managedHostWindow.webContents);
    }

    pendingRequest.dispatchStartedAt = Date.now();
    pendingRequest.dispatchLatencyMs = pendingRequest.dispatchStartedAt - pendingRequest.startedAt;
    devToolsDiagnosticsState.lastDispatchLatencyMs = pendingRequest.dispatchLatencyMs;

    nextWebContents.openDevTools(strategy.openOptions);
    const isOpenAfterDispatch = isMainWindowDevToolsOpen();
    recordDevToolsDiagnostic('devtools-open-dispatched', {
      requestId: requestDecision.request.requestId,
      source,
      mode: strategy.openOptions.mode,
      activate: strategy.openOptions.activate,
      title: strategy.openOptions.title || null,
      useManagedHost: strategy.useManagedHost,
      managedHostWindowId: managedHostWindow?.id ?? null,
      dispatchLatencyMs: pendingRequest.dispatchLatencyMs,
      isOpenAfterDispatch,
    });

    if (strategy.useManagedHost) {
      showAndFocusManagedDevToolsHostWindow(`dispatch:${source}`);
    } else {
      focusNativeDevToolsWindow(`dispatch:${source}`);
    }

    if (isOpenAfterDispatch) {
      resolvePendingDevToolsOpenRequests({
        via: 'post-dispatch-open-state',
        isOpen: true,
        managedHostWindowId: managedHostWindow?.id ?? null,
      });
    }
  } catch (error) {
    failPendingDevToolsOpenRequests({
      failureKind: 'error',
      error,
      extra: {
        dispatchLatencyMs: pendingRequest.dispatchLatencyMs,
      },
    });
  }

  return requestDecision.response;
}

function openMainWindowDevTools(source = 'unknown') {
  if (isPackagedWindowsApp) {
    return openExternalRendererDebugger(source);
  }

  return requestMainWindowDevToolsOpen(source);
}

function toggleMainWindowDevTools(source = 'unknown') {
  if (isPackagedWindowsApp) {
    return openExternalRendererDebugger(source);
  }

  if (isMainWindowDevToolsOpen()) {
    const closed = closeMainWindowDevTools(`${source}:close`);
    return { accepted: closed, alreadyOpen: false, closed };
  }

  return requestMainWindowDevToolsOpen(`${source}:open`);
}

function attachApplicationMenuToMainWindow(reason = 'unknown') {
  if (!mainWindow || mainWindow.isDestroyed() || !applicationMenu) {
    return false;
  }

  if (typeof mainWindow.setMenu === 'function') {
    mainWindow.setMenu(applicationMenu);
  }

  if (process.platform !== 'darwin') {
    mainWindow.setAutoHideMenuBar(false);
    mainWindow.setMenuBarVisibility(true);
  }

  recordDevToolsDiagnostic('application-menu-attached', {
    reason,
    windowId: mainWindow.id,
    menuBarVisible: mainWindow.isMenuBarVisible?.() ?? null,
    menuBarAutoHide: mainWindow.isMenuBarAutoHide?.() ?? null,
  });
  return true;
}

function buildApplicationMenu() {
  const primaryDebugLabel = getPrimaryDebugMenuLabel(isPackagedWindowsApp);
  const viewSubmenu = [
    {
      label: primaryDebugLabel,
      accelerator: 'F12',
      click: () => {
        recordDevToolsDiagnostic('devtools-menu-clicked', {
          source: 'view-menu:F12-item',
        });
        toggleMainWindowDevTools('view-menu:F12-item');
      },
    },
    {
      label: primaryDebugLabel,
      accelerator: 'CommandOrControl+Shift+I',
      visible: false,
      click: () => {
        recordDevToolsDiagnostic('devtools-menu-clicked', {
          source: 'view-menu:ctrl-shift-i-item',
        });
        toggleMainWindowDevTools('view-menu:ctrl-shift-i-item');
      },
    },
    {
      label: 'Reload',
      accelerator: 'F5',
      click: () => {
        requestMainWindowReload('view-menu:F5-item');
      },
    },
    { type: 'separator' },
    {
      label: isPackagedWindowsApp ? 'Show Debugging Info' : 'DevTools Diagnostics',
      click: () => {
        recordDevToolsDiagnostic('devtools-diagnostics-menu-clicked', {
          source: 'view-menu',
        });
        showDebugToolsStatusDialog(
          isPackagedWindowsApp
            ? 'Packaged Windows debugging uses an external renderer debugger.'
            : 'DevTools diagnostics are active for this build.',
          [
            isPackagedWindowsApp
              ? 'Use View > Open Renderer Debugger or F12 to launch the external debugger.'
              : 'Use View > Toggle Developer Tools to open the embedded DevTools window.',
          ],
        );
      },
    },
  ];

  if (remoteDebuggingUrl) {
    viewSubmenu.push(
      { type: 'separator' },
      {
        label: `${isPackagedWindowsApp ? 'Renderer Debugger' : 'Remote Inspector'}: ${remoteDebuggingUrl}`,
        enabled: false,
      },
    );
  }

  if (getMainInspectorPort()) {
    viewSubmenu.push({
      label: `Main Inspector: 127.0.0.1:${getMainInspectorPort()}`,
      enabled: false,
    });
  }

  return Menu.buildFromTemplate([
    {
      label: 'View',
      submenu: viewSubmenu,
    },
  ]);
}

function resetStartupRevealState(gated = false) {
  startupRevealState.gated = gated;
  startupRevealState.browserReady = false;
  startupRevealState.rendererShellReady = false;
}

function attemptStartupReveal(reason = 'unknown') {
  if (!startupRevealState.gated) {
    showAndFocusMainWindow(reason);
    return true;
  }

  if (!startupRevealState.browserReady || !startupRevealState.rendererShellReady) {
    return false;
  }

  showAndFocusMainWindow(reason);
  return true;
}

function getGpuSwitchesSnapshot() {
  const snapshot = {};

  TRACKED_GPU_SWITCHES.forEach((switchName) => {
    if (!app.commandLine.hasSwitch(switchName)) {
      return;
    }

    const value = app.commandLine.getSwitchValue(switchName);
    snapshot[switchName] = value || true;
  });

  return snapshot;
}

function getAngleBackendSnapshot() {
  if (process.platform !== 'win32') {
    return app.commandLine.getSwitchValue('use-angle') || null;
  }

  return app.commandLine.getSwitchValue('use-angle') || windowsAngleBackend || 'd3d11';
}

function getMainWindowSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      windowBounds: null,
      contentBounds: null,
      display: null,
      displayScaleFactor: null,
      isFullscreen: false,
      isMaximized: false,
    };
  }

  const windowBounds = mainWindow.getBounds();
  const contentBounds = mainWindow.getContentBounds();
  const display = screen.getDisplayMatching(windowBounds);

  return {
    role: getWindowRole(mainWindow),
    windowBounds,
    contentBounds,
    display: display
      ? {
          id: display.id,
          bounds: display.bounds,
          workArea: display.workArea,
          scaleFactor: display.scaleFactor,
          rotation: display.rotation,
          internal: display.internal,
        }
      : null,
    displayScaleFactor: display?.scaleFactor ?? null,
    isFullscreen: mainWindow.isFullScreen(),
    isMaximized: mainWindow.isMaximized(),
    webContentsId: mainWindow.webContents?.id ?? null,
    url: mainWindow.webContents?.getURL?.() || null,
  };
}

function sanitizeProcessMetrics(metrics = []) {
  return metrics.map((metric) => ({
    pid: metric?.pid ?? null,
    type: metric?.type || 'unknown',
    serviceName: metric?.serviceName || null,
    name: metric?.name || null,
    creationTime: metric?.creationTime ?? null,
    sandboxed: metric?.sandboxed ?? null,
    cpu: metric?.cpu || null,
    memory: metric?.memory || null,
  }));
}

function getProcessMetricsSnapshot() {
  const mainWindowSnapshot = getMainWindowSnapshot();
  let processMetrics = [];
  let error = null;

  try {
    processMetrics = sanitizeProcessMetrics(app.getAppMetrics());
  } catch (metricsError) {
    error = metricsError.message;
    console.warn('[Electron] Failed to read process metrics:', metricsError.message);
  }

  return {
    generatedAt: new Date().toISOString(),
    runtimeProfile: desktopRuntimeConfig.windowsProfile,
    safeMode: desktopRuntimeConfig.safeMode,
    gpuFallbackActive: desktopRuntimeConfig.gpuFallbackActive,
    processMetrics,
    ...mainWindowSnapshot,
    error,
  };
}

function shouldWritePackagedPerformanceReport() {
  return process.platform === 'win32' && app.isPackaged && app.isReady() && packagedDiagnosticsActive;
}

function getPackagedPerformanceReportPath() {
  if (!shouldWritePackagedPerformanceReport()) {
    return null;
  }

  const diagnosticsDir = join(app.getPath('userData'), 'diagnostics');
  mkdirSync(diagnosticsDir, { recursive: true });
  return join(diagnosticsDir, 'windows-packaged-performance-latest.json');
}

function buildPackagedPerformanceReportPayload() {
  return {
    ...packagedPerformanceReportState,
    config: {
      ...desktopRuntimeConfig,
      gpuSwitches: getGpuSwitchesSnapshot(),
      ...getMainWindowSnapshot(),
    },
    gpuDiagnostics: safeBuildGpuDiagnosticsPayload('packaged-report'),
    gpuHealth: buildGpuHealthPayload(),
    gpuSwitches: getGpuSwitchesSnapshot(),
    processMetrics: getProcessMetricsSnapshot(),
  };
}

function writePackagedPerformanceReport(reason = 'update') {
  const reportPath = getPackagedPerformanceReportPath();
  if (!reportPath) {
    return null;
  }

  packagedPerformanceReportState.lastUpdatedAt = new Date().toISOString();
  const payload = {
    reason,
    ...buildPackagedPerformanceReportPayload(),
  };

  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return reportPath;
}

function startDeferredDesktopMainServices(reason = 'unknown') {
  if (deferredDesktopMainServicesStarted) {
    return startupGpuDiagnosticsReady;
  }

  deferredDesktopMainServicesStarted = true;
  packagedDiagnosticsActive = true;

  writePackagedPerformanceReport(`deferred-services:${reason}`);
  startupGpuDiagnosticsReady = refreshGpuDiagnostics(`deferred-services:${reason}`);
  scheduleSteamExtrasBootstrap(`renderer-${reason}`);
  return startupGpuDiagnosticsReady;
}

function normalizeGpuAdapters(gpuInfo) {
  const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : [];

  return devices.map((device, index) => ({
    index,
    active: device?.active === true,
    vendor: device?.vendorString || device?.vendor || 'Unknown vendor',
    name: device?.deviceString || device?.deviceName || device?.name || 'Unknown GPU',
    vendorId: device?.vendorId ?? null,
    deviceId: device?.deviceId ?? null,
    driverVendor: device?.driverVendor || null,
    driverVersion: device?.driverVersion || null,
  }));
}

function buildGpuDiagnosticsPayload() {
  return {
    activeWebGLRenderer: gpuDiagnosticsState.activeWebGLRenderer,
    gpuFeatureStatus: gpuDiagnosticsState.gpuFeatureStatus,
    adapters: gpuDiagnosticsState.adapters,
    activeAdapter: gpuHealthState.activeAdapter,
    driverVendor: gpuHealthState.driverVendor,
    driverVersion: gpuHealthState.driverVersion,
    angleBackend: gpuHealthState.angleBackend,
    gpuHealth: buildGpuHealthPayload(),
    gpuSwitches: getGpuSwitchesSnapshot(),
    hardwareAccelerationDisabled,
    auxAttributes: gpuDiagnosticsState.auxAttributes,
    updatedAt: gpuDiagnosticsState.updatedAt,
  };
}

function safeBuildGpuDiagnosticsPayload(source = 'unknown') {
  try {
    return buildGpuDiagnosticsPayload();
  } catch (error) {
    console.warn(`[Electron] Failed to build GPU diagnostics payload (${source}):`, error.message);
    return {
      activeWebGLRenderer: gpuDiagnosticsState.activeWebGLRenderer,
      gpuFeatureStatus: gpuDiagnosticsState.gpuFeatureStatus,
      adapters: gpuDiagnosticsState.adapters,
      activeAdapter: gpuHealthState.activeAdapter,
      driverVendor: gpuHealthState.driverVendor,
      driverVersion: gpuHealthState.driverVersion,
      angleBackend: gpuHealthState.angleBackend,
      gpuHealth: buildGpuHealthPayload(),
      gpuSwitches: {},
      hardwareAccelerationDisabled,
      auxAttributes: gpuDiagnosticsState.auxAttributes,
      updatedAt: gpuDiagnosticsState.updatedAt,
      error: error.message,
    };
  }
}

function classifyDesktopGpuHealth() {
  return deriveGpuHealthState({
    adapters: gpuDiagnosticsState.adapters,
    gpuFeatureStatus: gpuDiagnosticsState.gpuFeatureStatus,
    activeWebGLRenderer: gpuDiagnosticsState.activeWebGLRenderer,
    hardwareAccelerationDisabled,
    preferDiscreteGpu,
    angleBackend: getAngleBackendSnapshot(),
  });
}

function buildGpuHealthPayload() {
  return {
    ...gpuHealthState,
    activeAdapter: gpuHealthState.activeAdapter
      ? { ...gpuHealthState.activeAdapter }
      : null,
  };
}

function refreshGpuHealth(source = 'manual') {
  const nextHealth = classifyDesktopGpuHealth();
  Object.assign(gpuHealthState, nextHealth);
  desktopRuntimeConfig.gpuHealth = buildGpuHealthPayload();
  desktopRuntimeConfig.gpuFallbackActive = nextHealth.status !== 'healthy';
  packagedPerformanceReportState.gpuHealth = buildGpuHealthPayload();
  emitRuntimeEvent('gpu-health-updated', {
    source,
    gpuHealth: buildGpuHealthPayload(),
  });
  return buildGpuHealthPayload();
}

function emitGpuDiagnostics(source, extra = {}) {
  emitRuntimeEvent('gpu-info-updated', {
    source,
    diagnostics: safeBuildGpuDiagnosticsPayload(`emit:${source}`),
    ...extra,
  });
}

async function refreshGpuDiagnostics(source = 'manual') {
  let refreshError = null;

  try {
    const infoType = source === 'gpu-info-update' ? 'complete' : 'basic';
    const gpuInfo = await app.getGPUInfo(infoType);
    gpuDiagnosticsState.gpuFeatureStatus = app.getGPUFeatureStatus();
    gpuDiagnosticsState.adapters = normalizeGpuAdapters(gpuInfo);
    gpuDiagnosticsState.auxAttributes = gpuInfo?.auxAttributes || {};
    gpuDiagnosticsState.updatedAt = Date.now();

    const adapterSummary = gpuDiagnosticsState.adapters
      .map((adapter) => `${adapter.active ? '*' : ''}${adapter.name}`)
      .join(' | ');
    console.log(`[Electron] GPU diagnostics refreshed (${source}): ${adapterSummary || 'no adapters reported'}`);

    if (rendererReady) {
      emitGpuDiagnostics(source);
    }
  } catch (error) {
    refreshError = error;
    gpuDiagnosticsState.gpuFeatureStatus = app.getGPUFeatureStatus();
    gpuDiagnosticsState.updatedAt = Date.now();
    console.warn(`[Electron] Failed to refresh GPU diagnostics (${source}):`, error.message);

    if (rendererReady) {
      emitGpuDiagnostics(source, { error: error.message });
    }
  }

  packagedPerformanceReportState.gpuDiagnostics = safeBuildGpuDiagnosticsPayload(`refresh:${source}`);
  refreshGpuHealth(source);
  packagedPerformanceReportState.gpuSwitches = getGpuSwitchesSnapshot();
  writePackagedPerformanceReport(`gpu-refresh:${source}`);

  return safeBuildGpuDiagnosticsPayload(`refresh:${source}${refreshError ? ':error' : ''}`);
}

async function resolveInitialSteamConnection(source = 'steam-core-bootstrap') {
  steamLog(`resolveInitialSteamConnection(${source}): initialized=${steamInitialized} client=${!!steamworksClient}`);
  if (!steamworksClient || !steamInitialized) {
    steamStatusPending = false;
    steamLog(`resolveInitialSteamConnection: no client/not initialized → unavailable`);
    emitSteamStatus(`${source}:unavailable`);
    return false;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (steamServerConnected === true || steamServerConnected === false) {
      steamStatusPending = false;
      steamLog(`resolveInitialSteamConnection: callback already fired → connected=${steamServerConnected}`);
      emitSteamStatus(`${source}:callback`);
      return steamServerConnected;
    }

    try {
      const serverTime = steamworksClient.utils?.getServerRealTime?.();
      steamLog(`resolveInitialSteamConnection: attempt ${attempt} serverTime=${serverTime}`);
      if ((typeof serverTime === 'number' || typeof serverTime === 'bigint') && serverTime > 0) {
        setSteamServerConnection(true, `${source}:server-time`, { serverTime, attempt });
        return true;
      }
    } catch (error) {
      steamLog(`resolveInitialSteamConnection: attempt ${attempt} serverTime error: ${error.message}`);
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  if (hasUsableSteamClient()) {
    steamLog('resolveInitialSteamConnection: hasUsableSteamClient=true → fallback connected');
    setSteamServerConnection(true, `${source}:client-ready-fallback`, {
      fallback: 'steam-client-ready',
    });
    return true;
  }

  steamLog('resolveInitialSteamConnection: probing Steam network...');
  const networkOk = await probeSteamNetwork(1200);
  steamLog(`resolveInitialSteamConnection: network probe result=${networkOk}`);
  if (networkOk) {
    setSteamServerConnection(true, `${source}:network-probe`, { networkOk });
    return true;
  }

  setSteamServerConnection(false, `${source}:network-probe`, { networkOk });
  return false;
}

async function bootstrapSteamCoreServices() {
  steamLog('bootstrapSteamCoreServices: begin');
  steamStatusPending = true;
  emitSteamStatus('steam-core-bootstrap:start');

  let steamReady = false;
  try {
    steamLog('bootstrapSteamCoreServices: calling initSteamworks()');
    steamReady = await initSteamworks();
    steamLog(`bootstrapSteamCoreServices: initSteamworks returned ${steamReady}`);
  } catch (error) {
    steamLog(`ERROR: bootstrapSteamCoreServices: initSteamworks crashed: ${error.message}`);
    steamStatusPending = false;
    emitSteamStatus('steam-core-bootstrap:error');
    emitRuntimeEvent('steam-init-failed', { error: error.message });
    return false;
  }

  if (!steamReady) {
    steamLog('bootstrapSteamCoreServices: Steam unavailable → offline');
    steamStatusPending = false;
    emitSteamStatus('steam-core-bootstrap:offline');
    emitRuntimeEvent('steam-init-failed', { error: 'Steam unavailable - running in offline mode' });
    return false;
  }

  await resolveInitialSteamConnection('steam-core-bootstrap');
  steamLog('bootstrapSteamCoreServices: complete');
  return true;
}

async function bootstrapSteamExtras() {
  console.log('[Electron] Steam extras bootstrap begin');

  try {
    console.log('[Electron] initEzSteamApi start');
    const leaderboardReady = await initEzSteamApi();
    console.log(`[Electron] initEzSteamApi complete (${leaderboardReady ? 'enabled' : 'disabled'})`);
    if (!leaderboardReady) {
      emitRuntimeEvent('leaderboard-init-failed', { error: 'Leaderboard API unavailable' });
    }
    return leaderboardReady;
  } catch (error) {
    console.error('[Electron] initEzSteamApi crashed:', error);
    emitRuntimeEvent('leaderboard-init-failed', { error: error.message });
    return false;
  }
}

function scheduleSteamCoreBootstrap(reason = 'unknown') {
  if (steamCoreBootstrapPromise || process.env.SERENITY_DISABLE_STEAM_BOOTSTRAP === '1') {
    return steamCoreBootstrapPromise;
  }

  console.log(`[Electron] Scheduling Steam core bootstrap (${reason})`);
  steamStatusPending = true;
  emitSteamStatus(`steam-core-scheduled:${reason}`);
  steamCoreBootstrapPromise = Promise.resolve()
    .then(() => bootstrapSteamCoreServices())
    .catch((error) => {
      steamStatusPending = false;
      emitSteamStatus(`steam-core-failed:${reason}`);
      console.error('[Electron] Steam core bootstrap failed:', error);
      return false;
    });

  return steamCoreBootstrapPromise;
}

function scheduleSteamExtrasBootstrap(reason = 'unknown') {
  if (steamExtrasBootstrapPromise || process.env.SERENITY_DISABLE_STEAM_BOOTSTRAP === '1') {
    return steamExtrasBootstrapPromise;
  }

  console.log(`[Electron] Scheduling Steam extras bootstrap (${reason})`);
  steamExtrasBootstrapPromise = Promise.resolve()
    .then(async () => {
      await scheduleSteamCoreBootstrap(`extras:${reason}`);
      if (!steamInitialized || !steamworksClient) {
        return false;
      }
      return bootstrapSteamExtras();
    })
    .catch((error) => {
      console.error('[Electron] Deferred Steam extras bootstrap failed:', error);
      return false;
    });

  return steamExtrasBootstrapPromise;
}

function applyVSyncSettings(enabled) {
  const target = !!enabled;

  if (currentVSyncEnabled === target) {
    return;
  }

  currentVSyncEnabled = target;
  console.log(`[Electron] VSync ${target ? 'enabled' : 'disabled'} (renderer-owned pacing)`);
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
  emitRuntimeEvent('vsync-preference-updated', { enabled: currentVSyncEnabled });
  return currentVSyncEnabled;
});

ipcMain.handle('desktop:get-runtime-config', async () => {
  return {
    ...desktopRuntimeConfig,
    gpuHealth: buildGpuHealthPayload(),
    gpuSwitches: getGpuSwitchesSnapshot(),
    ...getMainWindowSnapshot(),
  };
});

ipcMain.handle('desktop:get-process-metrics', async () => getProcessMetricsSnapshot());
ipcMain.handle('desktop:get-gpu-health', async () => buildGpuHealthPayload());
ipcMain.handle('desktop:get-devtools-diagnostics', async () => getDevToolsDiagnosticsSnapshot());
ipcMain.handle('desktop:get-debug-tools-status', async () => getDebugToolsStatusSnapshot());
ipcMain.handle('desktop:get-log-paths', async () => getDebugLogPaths());
ipcMain.handle('desktop:open-renderer-debugger', async () => openExternalRendererDebugger('renderer-button'));
ipcMain.handle('desktop:open-devtools', async () => openMainWindowDevTools('renderer-button'));
ipcMain.handle('desktop:apply-runtime-profile', async (_event, requestedProfile) => {
  const normalizedProfile = normalizeWindowsRuntimeProfile(requestedProfile);
  if (!normalizedProfile) {
    throw new Error(`Unsupported runtime profile: ${requestedProfile}`);
  }

  if (!windowsLabRuntimeEnabled) {
    throw new Error('Runtime profile switching is only available in lab builds.');
  }

  const filteredArgs = process.argv
    .slice(1)
    .filter((arg) => typeof arg === 'string'
      && !arg.startsWith('--serenity-windows-profile=')
      && arg !== '--serenity-safe-mode');

  app.relaunch({
    args: [
      ...filteredArgs,
      `--serenity-windows-profile=${normalizedProfile}`,
    ],
  });
  setImmediate(() => app.exit(0));

  return {
    ok: true,
    relaunching: true,
    profileName: normalizedProfile,
  };
});

ipcMain.on('desktop:report-renderer-log', (event, payload = {}) => {
  if (mainWindow && event?.sender?.id !== mainWindow.webContents.id) {
    return;
  }

  const normalizedLog = normalizeRendererReportedLog(payload);
  recordStructuredDebugLog({
    processType: normalizedLog.sourceProcess,
    level: normalizedLog.level,
    message: normalizedLog.message,
    args: normalizedLog.args,
    details: normalizedLog.details,
    stack: normalizedLog.stack,
    category: 'renderer-runtime',
  });
});

ipcMain.handle('get-gpu-diagnostics', async () => {
  if (!gpuDiagnosticsState.updatedAt || gpuDiagnosticsState.adapters.length === 0) {
    return refreshGpuDiagnostics('ipc-bootstrap');
  }

  return buildGpuDiagnosticsPayload();
});

ipcMain.handle('set-active-gpu-renderer', async (event, rendererInfo) => {
  gpuDiagnosticsState.activeWebGLRenderer = typeof rendererInfo === 'string' && rendererInfo.trim()
    ? rendererInfo.trim()
    : null;

  if (!gpuDiagnosticsState.updatedAt || gpuDiagnosticsState.adapters.length === 0) {
    await refreshGpuDiagnostics('renderer-bootstrap');
  }

  if (rendererReady) {
    emitGpuDiagnostics('renderer-report');
  }

  return buildGpuDiagnosticsPayload();
});

ipcMain.handle('desktop:startup-mark', async (_event, payload = {}) => {
  const phase = typeof payload?.phase === 'string' ? payload.phase : 'unknown';
  emitRuntimeEvent('startup-mark', { phase, payload: payload?.payload || null });
  packagedPerformanceReportState.startupMarks.push({
    phase,
    timestamp: Date.now(),
    payload: payload?.payload || null,
  });
  if (packagedPerformanceReportState.startupMarks.length > 60) {
    packagedPerformanceReportState.startupMarks.shift();
  }
  writePackagedPerformanceReport(`startup-mark:${phase}`);

  if (phase === 'startup-shell-ready' || phase === 'first-usable-frame') {
    startupRevealState.rendererShellReady = true;
    attemptStartupReveal(`renderer:${phase}`);
  }

  if (phase === 'startup-shell-ready') {
    void scheduleSteamCoreBootstrap('renderer-startup-shell-ready');
  }

  if (phase === 'deferred-services-ready') {
    void startDeferredDesktopMainServices('deferred-services-ready');
  }

  // Auto-open DevTools when the startup shell reports a failure.
  // This surfaces console errors immediately without requiring a manual F12 press.
  if (phase === 'startup-error') {
    if (mainWindow && !mainWindow.isDestroyed()
        && !isMainWindowDevToolsOpen()) {
      openMainWindowDevTools('startup-error');
    }
  }

  return {
    ok: true,
    phase,
  };
});

ipcMain.handle('desktop:store-performance-report', async (_event, payload = {}) => {
  const stage = typeof payload?.stage === 'string' && payload.stage.trim()
    ? payload.stage.trim()
    : 'unknown';
  const snapshot = payload?.snapshot && typeof payload.snapshot === 'object'
    ? payload.snapshot
    : null;

  packagedPerformanceReportState.rendererReports[stage] = {
    receivedAt: new Date().toISOString(),
    snapshot,
  };
  packagedPerformanceReportState.processMetrics = getProcessMetricsSnapshot();

  const reportPath = writePackagedPerformanceReport(`renderer-report:${stage}`);
  return {
    ok: true,
    stage,
    reportPath,
  };
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
    connected: steamInitialized && steamServerConnected === true,
    isOnline: steamInitialized && steamServerConnected === true,
    pending: steamStatusPending || (steamInitialized && steamworksClient !== null && steamServerConnected === null),
    steamId: steamSteamId,
    playerName: steamPlayerName,
    appId: steamAppId,
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
  if (!steamworksClient || !steamInitialized) return false;

  if (steamServerConnected === true) {
    return true;
  }

  if (steamServerConnected === false) {
    return false;
  }

  let serverTime = null;
  try {
    if (steamworksClient.utils?.getServerRealTime) {
      serverTime = steamworksClient.utils.getServerRealTime();
      if (typeof serverTime === 'number' && serverTime > 0) {
        return true;
      }
    }
  } catch {
    return steamInitialized;
  }

  const networkOk = await probeSteamNetwork();
  if (networkOk) {
    return true;
  }

  if (hasUsableSteamClient()) {
    return true;
  }

  return false;
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
  console.log('[Electron] createWindow() start');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workArea;
  const useStartupRevealGate = desktopRuntimeConfig.useStartupRevealGate;
  const showOnReadyToShow = isPackagedWindowsApp && !useStartupRevealGate;
  const showImmediately = !useStartupRevealGate && !showOnReadyToShow;
  resetStartupRevealState(useStartupRevealGate);

  mainWindow = createBrowserWindowWithRole(MAIN_WINDOW_ROLE, {
    width: isPackagedWindowsApp ? width : Math.min(1280, width),
    height: isPackagedWindowsApp ? height : Math.min(720, height),
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      devTools: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
    title: 'Serenity Blocks',
    backgroundColor: '#000000',
    show: showImmediately,
  });
  setWindowRole(mainWindow, MAIN_WINDOW_ROLE);
  attachApplicationMenuToMainWindow('create-window');

  if (isPackagedWindowsApp) {
    mainWindow.maximize();
  }

  console.log('[Electron] BrowserWindow created');
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelMap = ['debug', 'info', 'warn', 'error'];
    recordStructuredDebugLog({
      processType: 'renderer',
      level: levelMap[level] || 'info',
      message,
      details: {
        line,
        sourceId,
      },
      category: 'console',
    });
  });
  mainWindow.webContents.on('devtools-opened', () => {
    if (!showAndFocusManagedDevToolsHostWindow('webcontents-event')) {
      focusNativeDevToolsWindow('devtools-opened-event');
    }
    const resolvedRequestCount = resolvePendingDevToolsOpenRequests({
      via: 'webcontents-event',
      managedHostWindowId: getManagedDevToolsHostWindow()?.id ?? null,
    });
    recordDevToolsDiagnostic('devtools-opened-event', {
      resolvedRequestCount,
      isOpen: isMainWindowDevToolsOpen(),
    });
    console.log('[Electron] DevTools opened');
    if (resolvedRequestCount === 0) {
      emitRuntimeEvent('devtools-opened', {
        source: 'webcontents-event',
        isOpen: true,
        logPath: getDevToolsLogPath(),
      });
    }
  });
  mainWindow.webContents.on('devtools-closed', () => {
    const failedRequestCount = failPendingDevToolsOpenRequests({
      failureKind: 'closed-before-open',
    });
    destroyManagedDevToolsHostWindow('devtools-closed');
    recordDevToolsDiagnostic('devtools-closed-event', {
      pendingRequestCount: failedRequestCount,
      isOpen: isMainWindowDevToolsOpen(),
    });
    console.log('[Electron] DevTools closed');
    emitRuntimeEvent('devtools-closed', {
      source: 'webcontents-event',
      isOpen: false,
      logPath: getDevToolsLogPath(),
    });
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const intent = getDevToolsShortcutIntent(input);
    if (!intent) {
      return;
    }

    const shortcutLabel = describeDevToolsShortcut(input) || intent;
    const isDuplicate = isDuplicateDevToolsShortcut(devToolsShortcutState, intent);
    if (isDuplicate) {
      recordDevToolsDiagnostic('devtools-shortcut-deduped', {
        shortcut: shortcutLabel,
        intent,
        key: input.key,
        code: input.code,
      });
      event.preventDefault();
      return;
    }

    recordDevToolsDiagnostic('devtools-shortcut-handled', {
      shortcut: shortcutLabel,
      intent,
      key: input.key,
      code: input.code,
      control: input.control,
      shift: input.shift,
      alt: input.alt,
      meta: input.meta,
    });

    event.preventDefault();

    if (intent === 'toggle-devtools') {
      toggleMainWindowDevTools(`before-input-event:${shortcutLabel}`);
      if (!isPackagedWindowsApp) {
        scheduleDevToolsShortcutPostCheck(shortcutLabel, 'before-input-event');
      }
      return;
    }

    if (intent === 'reload-window') {
      requestMainWindowReload('before-input-event:F5');
    }
  });

  // F12, Ctrl+Shift+I, and F5 are handled here first so packaged Windows can
  // use the managed DevTools host path. The menu remains available as a manual
  // fallback entry point for the same actions.

  if (useStartupRevealGate) {
    console.log('[Electron] Packaged Windows build detected - waiting for renderer startup shell before reveal');
  } else if (showOnReadyToShow) {
    console.log('[Electron] Packaged Windows baseline profile - revealing window on ready-to-show');
  }
  emitRuntimeEvent('startup-window-created', {
    showImmediately,
    showOnReadyToShow,
    useStartupRevealGate,
    windowsProfile: desktopRuntimeConfig.windowsProfile,
  });

  let revealWindowTimeout = null;

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    startupRevealState.browserReady = true;
    attemptStartupReveal('ready-to-show');
  });

  // Window focus/blur IPC — more reliable than visibilitychange for alt-tab on Windows.
  // The renderer uses these to manage rendering pause/resume when the window loses focus.
  mainWindow.on('blur', () => {
    if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:runtime-event', {
        type: 'window-focus-changed',
        timestamp: Date.now(),
        payload: { focused: false },
      });
    }
  });

  mainWindow.on('focus', () => {
    if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:runtime-event', {
        type: 'window-focus-changed',
        timestamp: Date.now(),
        payload: { focused: true },
      });
    }
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('[Electron] Main window did-finish-load');
    steamLog(`did-finish-load: steamInitialized=${steamInitialized} steamServerConnected=${steamServerConnected} steamSteamId=${steamSteamId}`);
    if (!useStartupRevealGate) {
      showAndFocusMainWindow('did-finish-load');
    }
    rendererReady = true;
    void scheduleSteamCoreBootstrap('did-finish-load');
    emitSteamStatus('renderer-ready-sync');

    // Re-emit Steam status after renderer ES modules have loaded and registered
    // their IPC listeners. did-finish-load fires before dynamic imports complete,
    // so the initial emission above may be missed by the renderer's SteamService.
    // Two-stage catchup covers both fast and slow module loading scenarios.
    for (const delay of [1500, 4000]) {
      setTimeout(() => {
        if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
          emitSteamStatus(`renderer-catchup-${delay}ms`);
        }
      }, delay);
    }

    if (pendingLobbyJoins.length > 0) {
      pendingLobbyJoins.forEach((invite) => {
        mainWindow.webContents.send('steam:lobbyJoinRequested', invite);
      });
      pendingLobbyJoins = [];
    }

    if (packagedDiagnosticsActive) {
      if (gpuDiagnosticsState.updatedAt && gpuDiagnosticsState.adapters.length > 0) {
        emitGpuDiagnostics('renderer-ready');
      } else {
        await refreshGpuDiagnostics('renderer-ready');
      }
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[Electron] did-fail-load:', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
    emitRuntimeEvent('did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
    if (isMainFrame) {
      showAndFocusMainWindow('did-fail-load');
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Electron] Renderer process gone:', details);
    emitRuntimeEvent('render-process-gone', { details });
    dialog.showErrorBox(
      'Serenity Blocks renderer crashed',
      `Reason: ${details?.reason || 'unknown'}\nExit code: ${details?.exitCode ?? 'unknown'}\n\nThe main renderer process exited during startup or runtime.`,
    );
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Electron] Renderer unresponsive');
    emitRuntimeEvent('renderer-unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    emitRuntimeEvent('renderer-responsive');
  });

  // Load Vite dev server (development mode) or built files (production)
  if (devToolsSmokeMode) {
    if (!devToolsSmokePagePath || !existsSync(devToolsSmokePagePath)) {
      const smokePagePath = devToolsSmokePagePath || '(not provided)';
      console.error('[Electron] Missing DevTools smoke page:', smokePagePath);
      emitRuntimeEvent('did-fail-load', {
        errorCode: 'SMOKE_PAGE_MISSING',
        errorDescription: `Missing DevTools smoke page: ${smokePagePath}`,
        validatedURL: smokePagePath,
        isMainFrame: true,
      });
      showAndFocusMainWindow('smoke-page-missing');
    } else {
      console.log(`[Electron] Loading DevTools smoke page: ${devToolsSmokePagePath}`);
      mainWindow.loadFile(devToolsSmokePagePath).catch((error) => {
        console.error('[Electron] Failed to load DevTools smoke page:', error);
        emitRuntimeEvent('did-fail-load', {
          errorCode: 'SMOKE_LOAD_FAILED',
          errorDescription: error.message,
          validatedURL: devToolsSmokePagePath,
          isMainFrame: true,
        });
        showAndFocusMainWindow('smoke-load-error');
      });
    }
  } else if (app.isPackaged) {
    // Production mode - load built index.html directly via file:// protocol.
    // file:// with base:'./' relative paths works natively in Electron (ASAR-aware)
    // and avoids custom protocol MIME-type edge cases that can stall ES module loading.
    const indexPath = join(app.getAppPath(), 'dist', 'index.html');
    console.log('[Electron] Loading production build via file://');
    mainWindow.loadFile(indexPath).catch((error) => {
      console.error('[Electron] Failed to load dist/index.html:', error);
      emitRuntimeEvent('did-fail-load', {
        errorCode: 'LOAD_FILE_FAILED',
        errorDescription: error.message,
        validatedURL: indexPath,
        isMainFrame: true,
      });
      showAndFocusMainWindow('load-file-error');
    });
  } else {
    // Development mode - load from Vite dev server
    console.log('[Electron] Loading development server: http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173').catch((error) => {
      console.error('[Electron] Failed to load development server:', error);
      showAndFocusMainWindow('load-url-error');
    });
    openMainWindowDevTools('development-startup');
  }

  // Native menu accelerators are now the authoritative local shortcut path
  // across platforms for DevTools and reload.

  // Auto-open DevTools when SERENITY_OPEN_DEVTOOLS=1 env var is set.
  // Useful for diagnosing startup issues without launching a separate process.
  if (process.env.SERENITY_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      openMainWindowDevTools('env:SERENITY_OPEN_DEVTOOLS');
    });
  }

  revealWindowTimeout = setTimeout(() => {
    showAndFocusMainWindow('startup-timeout');
  }, useStartupRevealGate ? 5000 : 3000);

  mainWindow.on('closed', () => {
    const failedRequestCount = failPendingDevToolsOpenRequests({
      failureKind: 'window-closed',
    });
    destroyManagedDevToolsHostWindow('main-window-closed');
    if (failedRequestCount > 0) {
      recordDevToolsDiagnostic('devtools-open-window-closed', {
        pendingRequestCount: failedRequestCount,
      });
    }
    if (revealWindowTimeout) {
      clearTimeout(revealWindowTimeout);
      revealWindowTimeout = null;
    }
    mainWindow = null;
    rendererReady = false;
    resetStartupRevealState(false);
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
      showAndFocusMainWindow('second-instance');
    }
  });

  app.whenReady().then(async () => {
    console.log('[Electron] app.whenReady() resolved');
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
    flushPendingDebugLogLines('main');
    flushPendingDebugLogLines('renderer');
    flushPendingDebugLogLines('preload');
    flushPendingDevToolsLogLines();
    recordDevToolsDiagnostic('devtools-log-ready', {
      logPath: getDevToolsLogPath(),
      remoteDebuggingUrl,
      mainInspectorUrl: getMainInspectorUrl(),
    });

    const launchLobbyId = parseConnectLobbyArg(process.argv);
    if (launchLobbyId) {
      queueLobbyJoin({ lobbyId: launchLobbyId, source: 'command_line' });
    }

    // Early Steam init BEFORE window creation — ensures the overlay
    // frame-invalidator is registered before the BrowserWindow exists.
    steamStatusPending = true;
    steamLog('Starting early Steam init (3s timeout)');
    const earlyResult = await Promise.race([
      earlySteamInit(),
      new Promise((resolve) => setTimeout(() => {
        steamLog('WARN: Early Steam init timed out after 3s');
        resolve(false);
      }, 3000)),
    ]);
    steamLog(`Early Steam init result: ${earlyResult ? 'SUCCESS' : 'skipped/failed'}`);

    // Application menu — package a visible manual fallback entry point for
    // DevTools and reload. Packaged Windows also handles the shortcuts in
    // before-input-event so it can route opens through the managed host path.
    applicationMenu = buildApplicationMenu();
    Menu.setApplicationMenu(applicationMenu);
    recordDevToolsDiagnostic('application-menu-installed', {
      remoteDebuggingUrl,
    });

    console.log('[Electron] Creating main window');
    createWindow();

    if (packagedDiagnosticsActive) {
      writePackagedPerformanceReport('app-when-ready');
      startupGpuDiagnosticsReady = refreshGpuDiagnostics('startup');
    }

    console.log('[Electron] Registering powerMonitor listeners');
    powerMonitor.on('suspend', () => emitRuntimeEvent('power-suspend'));
    powerMonitor.on('resume', () => emitRuntimeEvent('power-resume'));
    powerMonitor.on('on-battery', () => emitRuntimeEvent('power-on-battery'));
    powerMonitor.on('on-ac', () => emitRuntimeEvent('power-on-ac'));
    powerMonitor.on('speed-limit-change', (_event, limit) => emitRuntimeEvent('power-speed-limit-change', { limit }));
  }).catch((error) => {
    console.error('[Electron] app.whenReady() failed:', error);
  });
}

app.on('render-process-gone', (_event, webContents, details) => {
  console.error('[Electron] App render-process-gone:', details);
  emitRuntimeEvent('app-render-process-gone', { details, url: webContents?.getURL?.() });
});

app.on('gpu-info-update', () => {
  void refreshGpuDiagnostics('gpu-info-update');
});

app.on('child-process-gone', (_event, details) => {
  console.error('[Electron] Child process gone:', details);
  emitRuntimeEvent('child-process-gone', { details });
  if (/gpu/i.test(details?.type || '')) {
    emitRuntimeEvent('gpu-process-gone', { details });
    // Notify the renderer to restore WebGL contexts after GPU process crash.
    // With out-of-process GPU, Chromium restarts the GPU process automatically;
    // this event lets the renderer re-initialize its rendering state.
    if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
      mainWindow.webContents.send('desktop:runtime-event', {
        type: 'gpu-process-recovered',
        timestamp: Date.now(),
        payload: { reason: details?.reason, exitCode: details?.exitCode },
      });
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up Steam native resources so the process can exit.
// Without this, registered Steam callbacks keep the Node event loop alive
// and the Electron process lingers in Task Manager after the window closes.
app.on('will-quit', () => {
  steamCallbackHandles.forEach((handle) => {
    try {
      handle?.disconnect?.();
    } catch (_) { /* best-effort */ }
  });
  steamCallbackHandles = [];

  if (steamworksClient) {
    try {
      // Rich presence lingers in the friends list after quit — clear it
      steamworksClient.friends?.clearRichPresence?.();
    } catch (_) { /* best-effort */ }
    steamworksClient = null;
  }

  steamInitialized = false;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }

  showAndFocusMainWindow('activate');
});
