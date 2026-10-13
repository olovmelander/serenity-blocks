/**
 * Serenity Blocks — Electron Main Process
 *
 * Slim production wrapper. Provides:
 *   - BrowserWindow with context-isolated preload
 *   - Display management IPC (fullscreen, borderless, windowed, resolution, VSync)
 *   - Desktop runtime config for renderer feature-detection
 *   - Power monitor events forwarded to renderer
 *   - Single-instance enforcement
 *   - Native DevTools via F12 / Ctrl+Shift+I (dev and diagnostics builds)
 *   - High-performance GPU preference (replaces the C launcher)
 *   - Lazy-loaded Steam integration (no startup delay)
 *   - Optional diagnostics via SERENITY_ENABLE_DIAGNOSTICS / SERENITY_ENABLE_LOGGING
 *
 * Original 4543-line main.js backed up as main-original.js.
 */

import {
    app, BrowserWindow, crashReporter, dialog, screen, ipcMain, powerMonitor, Menu, shell, session,
} from 'electron';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { appendFileSync, mkdirSync, readFileSync } from 'fs';
import inspector from 'node:inspector';
import {
    createContentSecurityPolicy,
    extractInlineScriptHashes,
} from './content-security-policy.js';
import { buildDebugToolsStatus } from './debug-tools.js';
import { classifyGpuHealth } from './gpu-health.js';
import {
    decideDevToolsOpenRequest,
    getDevToolsOpenStrategy,
} from './devtools-policy.js';
import {
    createDevToolsShortcutState,
    debugKeysEnabled,
    getDevToolsShortcutIntent,
    isDuplicateDevToolsShortcut,
} from './devtools-shortcuts.js';
import { isAllowedExternalUrl } from './external-links.js';
import { decideRendererRecovery, isFatalLoadFailure } from './renderer-recovery.js';
import { requestRendererQuitFlush } from './quit-flush.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;
const isWindows = process.platform === 'win32';

// Keep minidumps of main, renderer and GPU crashes on this machine only (audit ELEC-09).
// Nothing is uploaded; they land in app.getPath('crashDumps'), which the diagnostics log
// paths list so support can ask for one.
crashReporter.start({ uploadToServer: false });

// ---------------------------------------------------------------------------
// GPU configuration — minimal, sensible defaults
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('force_high_performance_gpu');
if (process.env.SERENITY_ENABLE_GPU_RASTERIZATION === '1') {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
}
app.commandLine.appendSwitch('enable-webgl');

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------
// A second launch hands focus to the first instance ('second-instance' below)
// and quits. app.quit() is asynchronous, so the lifecycle handlers below must not
// open a window in this process meanwhile.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let mainWindow = null;
let currentVSyncEnabled = true;
let rendererCrashes = []; // recent renderer crash times (electron/renderer-recovery.js)
let rendererReloadRequestedAt = null; // the player chose Reload on the hang prompt

// ---------------------------------------------------------------------------
// Runtime config exposed to renderer via IPC
// ---------------------------------------------------------------------------
const desktopRuntimeConfig = {
    isElectron: true,
    platform: process.platform,
    arch: process.arch,
    isPackaged,
    appMode: isPackaged ? 'packaged' : 'electron-dev',
    desktopThemeThumbnails: false, // Always use bundled Vite icons
    gpuFallbackActive: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send an event to the renderer's `window.electronAPI.onRuntimeEvent` listener */
function emitRuntimeEvent(type, payload = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:runtime-event', { type, ...payload });
    }
}

function isAllowedAppNavigation(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        if (!isPackaged) {
            return ['http://localhost:5173', 'http://127.0.0.1:5173'].includes(parsed.origin);
        }

        if (parsed.protocol !== 'file:') {
            return false;
        }

        const distRoot = resolve(app.getAppPath(), 'dist');
        const targetPath = resolve(fileURLToPath(parsed));
        return targetPath === join(distRoot, 'index.html') || targetPath.startsWith(`${distRoot}${sep}`);
    } catch {
        return false;
    }
}

function openExternalIfAllowed(targetUrl) {
    if (!isAllowedExternalUrl(targetUrl)) {
        console.warn('[Electron] Refused to open an external URL outside the allowlist');
        return;
    }
    shell.openExternal(targetUrl).catch((err) => {
        console.warn('[Electron] Failed to open external URL:', err.message);
    });
}

// ---------------------------------------------------------------------------
// IPC Handlers — Display Management
// ---------------------------------------------------------------------------

ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        internal: display.internal,
        displayFrequency: display.displayFrequency,
    }));
});

ipcMain.handle('set-fullscreen', (_event, enable) => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(enable);
    return true;
});

ipcMain.handle('set-borderless', (_event, resolution) => {
    if (!mainWindow) return false;
    const { width, height } = resolution || screen.getPrimaryDisplay().workArea;
    mainWindow.setFullScreen(false);
    mainWindow.setBounds({ x: 0, y: 0, width, height });
    mainWindow.setResizable(false);
    mainWindow.setMaximizable(false);
    return true;
});

ipcMain.handle('set-windowed', (_event, resolution) => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(false);
    mainWindow.setResizable(true);
    mainWindow.setMaximizable(true);
    if (resolution) {
        mainWindow.setSize(resolution.width, resolution.height);
        mainWindow.center();
    }
    return true;
});

ipcMain.handle('set-resolution', (_event, { width, height }) => {
    if (!mainWindow) return false;
    mainWindow.setSize(width, height);
    mainWindow.center();
    return true;
});

ipcMain.handle('get-window-bounds', () => {
    if (!mainWindow) return null;
    return mainWindow.getBounds();
});

ipcMain.handle('is-fullscreen', () => {
    if (!mainWindow) return false;
    return mainWindow.isFullScreen();
});

ipcMain.handle('set-vsync', (_event, enable) => {
    currentVSyncEnabled = !!enable;
    emitRuntimeEvent('vsync-preference-updated', { enabled: currentVSyncEnabled });
    return currentVSyncEnabled;
});

// ---------------------------------------------------------------------------
// IPC Handlers — Desktop Runtime
// ---------------------------------------------------------------------------

ipcMain.handle('desktop:get-runtime-config', () => {
    return { ...desktopRuntimeConfig };
});

ipcMain.handle('desktop:get-process-metrics', () => {
    return app.getAppMetrics();
});

// The main menu's Quit (desktop only). will-quit still runs the Steam cleanup.
ipcMain.handle('desktop:quit', () => {
    app.quit();
});

// GPU health — real classification via electron/gpu-health.js (the module the
// unit tests and the windows parity lane exercise). Status vocabulary is
// 'healthy' | 'degraded' | 'unsafe', which is what the renderer's body classes,
// remediation panel, and gpuFallbackActive computation expect (src/main.js).
// Returns null when Chromium can't report GPU info — the renderer keeps its
// healthy default instead of tripping the fallback UI on an API hiccup.
async function getGpuHealthSnapshot() {
    try {
        const gpuInfo = await app.getGPUInfo('basic');
        const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : [];
        return classifyGpuHealth({
            adapters: devices.map((device, index) => ({
                index,
                active: device?.active === true,
                vendor: device?.vendorString || device?.vendor || 'Unknown vendor',
                name: device?.deviceString || device?.deviceName || device?.name || 'Unknown GPU',
                vendorId: device?.vendorId ?? null,
                deviceId: device?.deviceId ?? null,
                driverVendor: device?.driverVendor || null,
                driverVersion: device?.driverVersion || null,
            })),
            gpuFeatureStatus: app.getGPUFeatureStatus?.() || {},
            hardwareAccelerationDisabled: app.commandLine.hasSwitch('disable-gpu'),
            angleBackend: process.env.SERENITY_ANGLE_BACKEND || null,
        });
    } catch (err) {
        console.warn('[Electron] GPU health classification failed:', err?.message || err);
        return null;
    }
}

ipcMain.handle('desktop:get-gpu-health', () => getGpuHealthSnapshot());

// DevTools open requests — electron/devtools-policy.js. The settings UI awaits
// { accepted, requestId } from the invoke and then matches the
// devtools-opened / devtools-open-failed runtime event carrying that requestId
// (src/ui/settings.js); a bare toggle used to leave that button stuck on
// "Main process did not accept the DevTools request."
let pendingDevToolsRequest = null;
let devToolsRequestSequence = 0;

// A pending request whose openDevTools() dispatch never produced a
// 'devtools-opened' event (nor a throw) must not pin the requestId forever —
// after this TTL a new click mints a fresh request instead of reusing one
// that can no longer resolve.
const DEVTOOLS_PENDING_REQUEST_TTL_MS = 10_000;

function requestDevToolsOpen(source) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { accepted: false, requestId: null, alreadyOpen: false };
    }

    devToolsRequestSequence += 1;
    const requestId = `devtools-req-${devToolsRequestSequence}`;

    if (mainWindow.webContents.isDevToolsOpened()) {
        return { accepted: true, requestId, alreadyOpen: true };
    }

    // External renderer-debugger flow: on a packaged Windows build with
    // diagnostics enabled, embedded DevTools is not the supported path —
    // debug-tools.js advertises packagedExternalDebugger to the settings UI,
    // which expects a devtools-opened event carrying external + debuggerUrl.
    // Answer with the CDP endpoint instead of dispatching a doomed embedded
    // open. (setImmediate lets the invoke resolve first so the renderer has
    // stored the requestId before the event arrives.)
    if (isPackaged && isWindows && diagnosticsEnabled && remoteDebuggingUrl) {
        setImmediate(() => emitRuntimeEvent('devtools-opened', {
            requestId,
            alreadyOpen: false,
            external: true,
            debuggerUrl: remoteDebuggingUrl,
        }));
        return { accepted: true, requestId, alreadyOpen: false };
    }

    if (pendingDevToolsRequest
        && Number.isFinite(pendingDevToolsRequest.startedAt)
        && (Date.now() - pendingDevToolsRequest.startedAt) > DEVTOOLS_PENDING_REQUEST_TTL_MS) {
        pendingDevToolsRequest = null;
    }

    const decision = decideDevToolsOpenRequest({
        activePendingRequest: pendingDevToolsRequest,
        newRequestId: requestId,
        source,
    });

    if (decision.type === 'create') {
        pendingDevToolsRequest = decision.request;
    }

    // DevTools is not open at this point, so ALWAYS (re-)dispatch the open —
    // including on a 'reuse' decision. A reuse that skipped the dispatch would
    // make a silently-failed first open unrecoverable (every retry would
    // return the stale requestId without attempting anything).
    const { openOptions } = getDevToolsOpenStrategy({
        isPackagedWindowsApp: isPackaged && isWindows,
        devToolsSmokeMode: false,
    });
    try {
        mainWindow.webContents.openDevTools(openOptions);
    } catch (err) {
        pendingDevToolsRequest = null;
        const failedRequestId = decision.response.requestId;
        // Async emit + accepted:true response: the renderer stores the
        // requestId when the invoke resolves, then receives this event —
        // formatFailureMessage renders payload.errorMessage (settings.js).
        setImmediate(() => emitRuntimeEvent('devtools-open-failed', {
            requestId: failedRequestId,
            failureKind: 'exception',
            errorMessage: err?.message || String(err),
        }));
    }

    return decision.response;
}

// Stubs for APIs the renderer calls with optional chaining — returning
// sensible defaults keeps the renderer happy without the full diagnostics.
ipcMain.handle('desktop:get-devtools-diagnostics', () => ({}));
ipcMain.handle('desktop:get-debug-tools-status', () => ({}));
ipcMain.handle('desktop:get-log-paths', () => ({}));
ipcMain.handle('desktop:open-devtools', () => requestDevToolsOpen('settings-open-devtools'));
ipcMain.handle('desktop:open-renderer-debugger', () => requestDevToolsOpen('settings-open-renderer-debugger'));
ipcMain.handle('desktop:apply-runtime-profile', () => null);
ipcMain.handle('desktop:store-performance-report', () => null);
ipcMain.handle('desktop:startup-mark', () => null);
ipcMain.handle('get-gpu-diagnostics', () => ({}));
ipcMain.handle('set-active-gpu-renderer', () => ({}));

// ---------------------------------------------------------------------------
// Steam stubs — replaced by real handlers once steam-integration.js loads
// ---------------------------------------------------------------------------

const steamStubChannels = [
    'steam:isInitialized', 'steam:getSteamId', 'steam:getPlayerName',
    'steam:getAppId', 'steam:getCapabilities',
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
];

for (const channel of steamStubChannels) {
    ipcMain.handle(channel, () => null);
}

// Return pending status so renderer waits for real Steam init instead of failing
ipcMain.handle('steam:getConnectionStatus', () => ({
    initialized: false,
    connected: false,
    pending: true,
}));

// Diagnostics stub — replaced by real handler once steam-integration.js loads
ipcMain.handle('steam:getDiagnostics', () => ({ pending: true, phase: 'stub' }));

// ---------------------------------------------------------------------------
// Phase 4: Optional diagnostics (behind env flags)
// ---------------------------------------------------------------------------
const diagnosticsEnabled = process.env.SERENITY_ENABLE_DIAGNOSTICS === '1';
const loggingEnabled = process.env.SERENITY_ENABLE_LOGGING === '1';

let remoteDebuggingPort = null;
let remoteDebuggingUrl = null;
let mainInspectorPort = null;
let mainInspectorUrl = null;

let _diagnosticsLogPath = null;

function getDiagnosticsLogPath() {
    if (_diagnosticsLogPath) return _diagnosticsLogPath;
    try {
        const logsDir = join(app.getPath('userData'), 'logs');
        mkdirSync(logsDir, { recursive: true });
        _diagnosticsLogPath = join(logsDir, 'main-debug.jsonl');
        return _diagnosticsLogPath;
    } catch { return null; }
}

function diagnosticLog(entry) {
    if (!loggingEnabled) return;
    try {
        const logPath = getDiagnosticsLogPath();
        if (logPath) {
            const line = JSON.stringify({ timestamp: Date.now(), ...entry }) + '\n';
            appendFileSync(logPath, line, 'utf8');
        }
    } catch { /* best-effort */ }
}

if (diagnosticsEnabled) {
    // Replace the stub handlers with real diagnostics. (desktop:get-gpu-health
    // needs no override — the base handler already returns the full
    // classifyGpuHealth result in every mode.)
    ipcMain.removeHandler('desktop:get-log-paths');
    ipcMain.handle('desktop:get-log-paths', () => ({
        main: getDiagnosticsLogPath(),
        userData: app.getPath('userData'),
        crashDumps: app.getPath('crashDumps'),
    }));

    ipcMain.removeHandler('desktop:store-performance-report');
    ipcMain.handle('desktop:store-performance-report', (_event, payload) => {
        diagnosticLog({ type: 'performance-report', payload });
        return true;
    });

    ipcMain.removeHandler('desktop:startup-mark');
    ipcMain.handle('desktop:startup-mark', (_event, payload) => {
        const phase = typeof payload?.phase === 'string' ? payload.phase : 'unknown';
        diagnosticLog({ type: 'startup-mark', phase, payload: payload?.payload || null });
        return null;
    });

    ipcMain.removeHandler('get-gpu-diagnostics');
    ipcMain.handle('get-gpu-diagnostics', async () => {
        try {
            const info = await app.getGPUInfo('complete');
            return info;
        } catch { return {}; }
    });

    // Renderer remote debugging (CDP) — the packaged app never exposed an
    // attach point for chrome-devtools MCP / webgpu_inspector before this;
    // they could only ever reach the Vite dev-server tab. Loopback-only by
    // default (Chromium binds 127.0.0.1 unless --remote-debugging-address is
    // also passed), and only opens when diagnostics are explicitly enabled.
    remoteDebuggingPort = Number(process.env.SERENITY_REMOTE_DEBUGGING_PORT) || 9222;
    app.commandLine.appendSwitch('remote-debugging-port', String(remoteDebuggingPort));
    remoteDebuggingUrl = `http://127.0.0.1:${remoteDebuggingPort}`;
    console.log(`[Electron] Renderer remote debugging enabled at ${remoteDebuggingUrl}`);

    // Main-process (Node) inspector — separate opt-in, off even with
    // diagnostics enabled unless a port is explicitly requested.
    const inspectPortArg = process.argv.find((arg) => arg.startsWith('--serenity-main-inspect-port='));
    const requestedInspectPort = Number(process.env.SERENITY_MAIN_INSPECT_PORT)
        || (inspectPortArg ? Number(inspectPortArg.split('=')[1]) : 0);
    if (requestedInspectPort) {
        try {
            inspector.open(requestedInspectPort, '127.0.0.1', false);
            mainInspectorPort = requestedInspectPort;
            mainInspectorUrl = inspector.url();
            console.log(`[Electron] Main-process inspector enabled at ${mainInspectorUrl}`);
        } catch (err) {
            console.warn('[Electron] Failed to open main-process inspector:', err.message);
        }
    }

    ipcMain.removeHandler('desktop:get-debug-tools-status');
    ipcMain.handle('desktop:get-debug-tools-status', () => buildDebugToolsStatus({
        isPackagedWindowsApp: isPackaged && isWindows,
        remoteDebuggingPort,
        remoteDebuggingUrl,
        mainInspectorPort,
        mainInspectorUrl,
        logPaths: { main: getDiagnosticsLogPath(), userData: app.getPath('userData') },
    }));

    ipcMain.removeHandler('desktop:get-devtools-diagnostics');
    ipcMain.handle('desktop:get-devtools-diagnostics', () => ({
        remoteDebuggingUrl,
        logPath: getDiagnosticsLogPath(),
        entries: [],
    }));

    console.log('[Electron] Diagnostics enabled (SERENITY_ENABLE_DIAGNOSTICS=1)');
}

if (loggingEnabled) {
    console.log(`[Electron] Structured logging enabled → ${getDiagnosticsLogPath()}`);
}

// ---------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------
//
// The renderer previously ran with NO CSP at all (allow-everything), so any
// markup-injection bug would execute script with full renderer privileges.
// We install a strict policy from the main process via onHeadersReceived so it
// covers the packaged file:// load as well as the dev server.
//
// Key protections (both modes): no remote script origins, NO arbitrary inline
// <script> (only the hashed first-party startup blocks below are allowed), no
// eval of JS, no plugins/objects, no <base> hijack, no framing. We still allow
// inline STYLES ('unsafe-inline' in style-src only — the app sets inline styles
// pervasively) and the Google webfonts.
//
// Packaged note: file:// subresources must keep loading, so `file:` is allowed
// in the resource directives. Self-hosting the two webfonts (a later phase)
// would let style-src/font-src drop the Google origins entirely.
//
// Inline startup scripts: index.html ships two TRUSTED first-party inline
// <script> blocks (the startup bridge, and the startup shell that installs the
// global error/unhandledrejection handlers + the white-screen watchdog). A
// no-'unsafe-inline' policy would silently block them and disable that safety
// net, so we allow them by sha256 hash computed AT RUNTIME from the exact
// dist/index.html Chromium loads — self-maintaining, never drifts, and still
// blocks any INJECTED inline script. (Worst case, if hashing fails, we fall
// back to the current behavior: blocked inline + working app.)
//
// Escape hatch: set SERENITY_DISABLE_CSP=1 to bypass while diagnosing a
// CSP-related white-screen in a packaged build.
function computeInlineScriptHashes() {
    try {
        const indexPath = join(app.getAppPath(), 'dist', 'index.html');
        const html = readFileSync(indexPath, 'utf8');
        // Match only attribute-less classic inline scripts (<script>...</script>).
        // Module scripts are externalized by Vite to a `src` (covered by 'self').
        return extractInlineScriptHashes(html);
    } catch (err) {
        console.warn('[Electron] Could not hash inline startup scripts for CSP:', err.message);
        return [];
    }
}

function installContentSecurityPolicy() {
    if (process.env.SERENITY_DISABLE_CSP === '1') {
        console.warn('[Electron] CSP disabled via SERENITY_DISABLE_CSP=1');
        return;
    }

    const policy = createContentSecurityPolicy({
        mode: isPackaged ? 'packaged' : 'dev',
        inlineScriptHashes: isPackaged ? computeInlineScriptHashes() : [],
    });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [policy],
            },
        });
    });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workArea;

    mainWindow = new BrowserWindow({
        width: isPackaged ? width : Math.min(1280, width),
        height: isPackaged ? height : Math.min(720, height),
        title: 'Serenity Blocks',
        backgroundColor: '#000000',
        show: true,
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
            additionalArguments: diagnosticsEnabled ? ['--serenity-diagnostics-enabled'] : [],
        },
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        openExternalIfAllowed(url);
        return { action: 'deny' };
    });

    const blockUnexpectedNavigation = (event, url) => {
        if (isAllowedAppNavigation(url)) {
            return;
        }
        event.preventDefault();
        openExternalIfAllowed(url);
    };
    mainWindow.webContents.on('will-navigate', blockUnexpectedNavigation);
    mainWindow.webContents.on('will-redirect', blockUnexpectedNavigation);

    // Resolve pending settings-UI DevTools requests (see requestDevToolsOpen).
    // Shortcut/menu opens carry no pending request and emit nothing — the
    // settings UI only listens for requestIds it created.
    mainWindow.webContents.on('devtools-opened', () => {
        const requestId = pendingDevToolsRequest?.requestId || null;
        pendingDevToolsRequest = null;
        if (requestId) {
            emitRuntimeEvent('devtools-opened', { requestId, alreadyOpen: false });
        }
    });

    // DevTools/reload shortcuts — electron/devtools-shortcuts.js (the module
    // the unit tests pin). preventDefault() also suppresses the matching View
    // menu accelerator, so one keypress can never fire both paths; the dedup
    // window collapses duplicate keyDown/rawKeyDown deliveries of one press.
    // Dev and diagnostics builds only: in a release F12 (Steam's screenshot
    // key) opened DevTools and F5 reloaded out of an online match.
    const debugKeys = debugKeysEnabled({ isPackaged, diagnosticsEnabled });
    const devToolsShortcutState = createDevToolsShortcutState();
    if (debugKeys) {
        mainWindow.webContents.on('before-input-event', (event, input) => {
            const intent = getDevToolsShortcutIntent(input);
            if (!intent) {
                return;
            }

            event.preventDefault();
            // OS key auto-repeat re-delivers keyDown slower than the 150ms dedup
            // window, so a held F5 would fire repeated reloads without this guard.
            if (input.isAutoRepeat) {
                return;
            }
            if (isDuplicateDevToolsShortcut(devToolsShortcutState, intent)) {
                return;
            }

            if (intent === 'toggle-devtools') {
                mainWindow.webContents.toggleDevTools();
            } else if (intent === 'reload-window') {
                mainWindow.webContents.reload();
            }
        });
    }

    if (isPackaged && isWindows) {
        mainWindow.maximize();
    }

    // Application menu — DevTools + Reload, with the debug keys only: a release
    // build has no menu, as those were its only items.
    Menu.setApplicationMenu(debugKeys ? Menu.buildFromTemplate([
        {
            label: 'View',
            submenu: [
                { role: 'toggleDevTools', accelerator: 'F12' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'reload', accelerator: 'F5' },
                { role: 'forceReload' },
            ],
        },
    ]) : null);

    // Load content
    if (isPackaged) {
        const indexPath = join(app.getAppPath(), 'dist', 'index.html');
        mainWindow.loadFile(indexPath).catch((err) => {
            console.error('[Electron] Failed to load dist/index.html:', err);
        });
    } else {
        mainWindow.loadURL('http://localhost:5173').catch((err) => {
            console.error('[Electron] Failed to load dev server:', err);
        });
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // Window focus events → renderer.
    // Only report "unfocused" on a TRUE minimize — a plain focus loss (alt-tab, a
    // second window, glancing at the other machine during an online match) must NOT
    // throttle the renderer/game to 10 FPS mid-match. (blur fires on any focus loss;
    // isMinimized() distinguishes a real minimize from alt-tab.)
    mainWindow.on('blur', () => {
        if (mainWindow.isMinimized()) {
            emitRuntimeEvent('window-focus-changed', { focused: false });
        }
    });
    mainWindow.on('focus', () => {
        emitRuntimeEvent('window-focus-changed', { focused: true });
    });

    // Crashes, hangs and load failures (audit ELEC-09; electron/renderer-recovery.js).
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error(`[Electron] Renderer gone: ${details.reason} (exit code ${details.exitCode})`);
        diagnosticLog({ type: 'render-process-gone', reason: details.reason, exitCode: details.exitCode });
        const decision = decideRendererRecovery({
            reason: details.reason,
            now: Date.now(),
            recentCrashes: rendererCrashes,
            reloadRequestedAt: rendererReloadRequestedAt,
        });
        rendererCrashes = decision.recentCrashes;
        rendererReloadRequestedAt = null;
        if (!mainWindow || mainWindow.isDestroyed()) return;
        // Reload on the next task: a reload from inside this event crashed the new renderer too.
        if (decision.action === 'reload') setTimeout(() => mainWindow?.webContents.reload(), 0);
        else if (decision.action === 'prompt') {
            promptRendererFailure('Serenity Blocks stopped unexpectedly.', `Reason: ${details.reason}.`);
        }
    });
    let unresponsivePrompt = null;
    mainWindow.on('unresponsive', () => {
        console.warn('[Electron] Renderer is not responding');
        diagnosticLog({ type: 'renderer-unresponsive' });
        if (unresponsivePrompt || !mainWindow) return;
        unresponsivePrompt = new AbortController();
        dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Serenity Blocks',
            message: 'Serenity Blocks is not responding.',
            detail: 'You can wait for it, or reload the game.',
            buttons: ['Wait', 'Reload'],
            defaultId: 0,
            cancelId: 0,
            signal: unresponsivePrompt.signal,
        }).then(({ response }) => {
            if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
                rendererReloadRequestedAt = Date.now();
                mainWindow.webContents.forcefullyCrashRenderer();
                mainWindow.webContents.reload();
            }
        }).catch(() => {}).finally(() => { unresponsivePrompt = null; });
    });
    mainWindow.on('responsive', () => unresponsivePrompt?.abort());
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
        // In development the dev-server load failure is expected and already logged.
        if (!isPackaged || !isFatalLoadFailure({ errorCode, isMainFrame })) return;
        console.error(`[Electron] Failed to load the game: ${errorDescription} (${errorCode})`);
        diagnosticLog({ type: 'did-fail-load', errorCode, errorDescription });
        promptRendererFailure('Serenity Blocks could not load.', `${errorDescription} (${errorCode}).`);
    });

    // Let the game finish its saves before the window closes (audit LIFE-14; electron/quit-flush.js).
    // app.quit() closes the window too, so this covers the menu's Quit as well.
    let quitFlush = 'pending';
    mainWindow.on('close', (event) => {
        if (quitFlush === 'done' || mainWindow.webContents.isCrashed()) return;
        event.preventDefault();
        if (quitFlush === 'running') return;
        quitFlush = 'running';
        requestRendererQuitFlush({ ipc: ipcMain, webContents: mainWindow.webContents }).then((outcome) => {
            console.log(`[Electron] Quit flush: ${outcome}`);
            quitFlush = 'done';
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        });
    });

    mainWindow.on('closed', () => {
        pendingDevToolsRequest = null;
        mainWindow = null;
    });
}

/** Ask the player to reload or quit after a failure the game cannot recover from itself. */
function promptRendererFailure(message, detail) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Serenity Blocks',
        message,
        detail,
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 1,
    }).then(({ response }) => {
        if (response !== 0) app.quit();
        else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    }).catch(() => app.quit());
}

// ---------------------------------------------------------------------------
// Lazy Steam loading
// ---------------------------------------------------------------------------
let steamModule = null;

async function bootstrapSteam() {
    console.log('[Electron] bootstrapSteam: starting...');
    try {
        // Use absolute path for ASAR compatibility — relative import()
        // can fail inside packaged Electron apps.
        const steamPath = join(__dirname, 'steam-integration.js');
        const { pathToFileURL } = await import('url');
        console.log('[Electron] bootstrapSteam: importing', steamPath);
        steamModule = await import(pathToFileURL(steamPath).href);

        // Register real IPC handlers (replaces the stubs above)
        steamModule.registerSteamIPC();
        console.log('[Electron] bootstrapSteam: IPC handlers registered');

        // Initialize Steam client
        const result = await steamModule.initSteam(mainWindow, emitRuntimeEvent);
        console.log('[Electron] Steam integration loaded, initialized:', result);
    } catch (err) {
        console.error('[Electron] Steam integration unavailable:', err.message);
        console.error('[Electron] Steam error stack:', err.stack);
        // Replace pending stub with definitive offline so renderer stops polling
        try { ipcMain.removeHandler('steam:getConnectionStatus'); } catch {}
        ipcMain.handle('steam:getConnectionStatus', () => ({
            initialized: false,
            connected: false,
            pending: false,
            error: err.message,
        }));
        // Push failure to renderer immediately
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('steam:status', {
                initialized: false,
                connected: false,
                pending: false,
                source: 'bootstrap-failed',
            });
        }
    }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// GPU, utility and network process crashes: Chromium restarts them; record them.
app.on('child-process-gone', (_event, details) => {
    console.warn(`[Electron] ${details.type} process gone: ${details.reason} (exit code ${details.exitCode})`);
    diagnosticLog({
        type: 'child-process-gone', processType: details.type, reason: details.reason, exitCode: details.exitCode,
    });
});

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.whenReady().then(() => {
    if (!gotLock) return;
    installContentSecurityPolicy();
    createWindow();

    // Power monitor → renderer
    powerMonitor.on('suspend', () => emitRuntimeEvent('power-suspend'));
    powerMonitor.on('resume', () => emitRuntimeEvent('power-resume'));
    powerMonitor.on('on-battery', () => emitRuntimeEvent('power-on-battery'));
    powerMonitor.on('on-ac', () => emitRuntimeEvent('power-on-ac'));
    powerMonitor.on('speed-limit-change', (_event, limit) => {
        emitRuntimeEvent('power-speed-limit-change', { limit });
    });

    // Load Steam AFTER window is visible — no startup delay
    mainWindow.webContents.once('did-finish-load', () => {
        bootstrapSteam();
    });
}).catch((error) => {
    // Startup itself failed: say so instead of leaving a process with no window.
    console.error('[Electron] Startup failed:', error);
    dialog.showErrorBox('Serenity Blocks could not start', String(error?.stack || error));
    app.exit(1);
});

app.on('will-quit', () => {
    if (steamModule) {
        steamModule.cleanupSteam();
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (gotLock && BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
