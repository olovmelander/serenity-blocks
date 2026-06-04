/**
 * Serenity Blocks — Electron Main Process
 *
 * Slim production wrapper. Provides:
 *   - BrowserWindow with context-isolated preload
 *   - Display management IPC (fullscreen, borderless, windowed, resolution, VSync)
 *   - Desktop runtime config for renderer feature-detection
 *   - Power monitor events forwarded to renderer
 *   - Single-instance enforcement
 *   - Native DevTools via F12 / Ctrl+Shift+I
 *   - High-performance GPU preference (replaces the C launcher)
 *   - Lazy-loaded Steam integration (no startup delay)
 *   - Optional diagnostics via SERENITY_ENABLE_DIAGNOSTICS / SERENITY_ENABLE_LOGGING
 *
 * Original 4543-line main.js backed up as main-original.js.
 */

import { app, BrowserWindow, screen, ipcMain, powerMonitor, Menu } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { appendFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isPackaged = app.isPackaged;
const isWindows = process.platform === 'win32';

// ---------------------------------------------------------------------------
// GPU configuration — minimal, sensible defaults
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('force-high-performance-gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-webgl');

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let mainWindow = null;
let currentVSyncEnabled = true;

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

// Stubs for APIs the renderer calls with optional chaining — returning
// sensible defaults keeps the renderer happy without the full diagnostics.
ipcMain.handle('desktop:get-gpu-health', () => ({ status: 'ok' }));
ipcMain.handle('desktop:get-devtools-diagnostics', () => ({}));
ipcMain.handle('desktop:get-debug-tools-status', () => ({}));
ipcMain.handle('desktop:get-log-paths', () => ({}));
ipcMain.handle('desktop:open-devtools', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.toggleDevTools();
    }
});
ipcMain.handle('desktop:open-renderer-debugger', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
});
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
    // Replace the stub handlers with real diagnostics
    ipcMain.removeHandler('desktop:get-gpu-health');
    ipcMain.handle('desktop:get-gpu-health', () => {
        const gpuInfo = app.getGPUFeatureStatus?.() || {};
        return { status: 'ok', features: gpuInfo };
    });

    ipcMain.removeHandler('desktop:get-log-paths');
    ipcMain.handle('desktop:get-log-paths', () => ({
        main: getDiagnosticsLogPath(),
        userData: app.getPath('userData'),
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

    console.log('[Electron] Diagnostics enabled (SERENITY_ENABLE_DIAGNOSTICS=1)');
}

if (loggingEnabled) {
    console.log(`[Electron] Structured logging enabled → ${getDiagnosticsLogPath()}`);
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
            preload: join(__dirname, 'preload.mjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,  // Required for ES module preload (.mjs)
            backgroundThrottling: false,
        },
    });

    if (isPackaged && isWindows) {
        mainWindow.maximize();
    }

    // Application menu — DevTools + Reload
    const menu = Menu.buildFromTemplate([
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
    ]);
    Menu.setApplicationMenu(menu);

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

    // Window focus events → renderer
    mainWindow.on('blur', () => {
        emitRuntimeEvent('window-focus-changed', { focused: false });
    });
    mainWindow.on('focus', () => {
        emitRuntimeEvent('window-focus-changed', { focused: true });
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
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

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.whenReady().then(() => {
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
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
