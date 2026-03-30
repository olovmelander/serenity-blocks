import electron from 'electron';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { classifyGpuHealth } from '../electron/gpu-health.js';

const ROOT = process.cwd();
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'windows-electron-parity', TIMESTAMP);
const REPORT_DIR = path.join(ARTIFACT_DIR, 'desktop-reports');
const SHOW_WINDOW = process.env.SERENITY_SHOW_WINDOW === '1';
const { app, BrowserWindow, ipcMain, screen } = electron;

let mainWindow = null;
let activeWebGLRenderer = null;
const desktopReports = new Map();
const runtimeProfileLabel = process.env.SERENITY_WINDOWS_PROFILE || 'validation';
const startupMarks = [];
const steamValidationState = {
    coreBootstrapTriggered: false,
    deferredServicesTriggered: false,
    coreTriggeredPhase: null,
    deferredPhase: null,
};
const steamStubState = {
    initialized: false,
    connected: false,
    pending: false,
    steamId: null,
    playerName: 'Player',
    appId: 480,
};

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    };
}

function getProcessMetricsSnapshot() {
    return {
        generatedAt: new Date().toISOString(),
        processMetrics: app.getAppMetrics().map((metric) => ({
            pid: metric?.pid ?? null,
            type: metric?.type || 'unknown',
            serviceName: metric?.serviceName || null,
            name: metric?.name || null,
            creationTime: metric?.creationTime ?? null,
            sandboxed: metric?.sandboxed ?? null,
            cpu: metric?.cpu || null,
            memory: metric?.memory || null,
        })),
        runtimeProfile: 'validation',
        safeMode: false,
        ...getMainWindowSnapshot(),
    };
}

async function getGpuDiagnostics() {
    const gpuInfo = await app.getGPUInfo('basic');
    const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : [];
    const activeAdapter = devices.find((device) => device?.active === true) || devices[0] || null;
    return {
        activeWebGLRenderer,
        gpuFeatureStatus: app.getGPUFeatureStatus(),
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
        activeAdapter: activeAdapter
            ? {
                vendor: activeAdapter?.vendorString || activeAdapter?.vendor || 'Unknown vendor',
                name: activeAdapter?.deviceString || activeAdapter?.deviceName || activeAdapter?.name || 'Unknown GPU',
                driverVendor: activeAdapter?.driverVendor || null,
                driverVersion: activeAdapter?.driverVersion || null,
            }
            : null,
        driverVendor: activeAdapter?.driverVendor || null,
        driverVersion: activeAdapter?.driverVersion || null,
        angleBackend: process.env.SERENITY_ANGLE_BACKEND || 'd3d11',
        updatedAt: Date.now(),
    };
}

async function getGpuHealth() {
    const diagnostics = await getGpuDiagnostics();
    return classifyGpuHealth({
        adapters: diagnostics.adapters,
        gpuFeatureStatus: diagnostics.gpuFeatureStatus,
        activeWebGLRenderer,
        angleBackend: diagnostics.angleBackend,
    });
}

async function storeDesktopReport(stage, snapshot) {
    await mkdir(REPORT_DIR, { recursive: true });
    const reportPath = path.join(REPORT_DIR, `${stage}.json`);
    desktopReports.set(stage, snapshot);
    await writeFile(reportPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return reportPath;
}

function sendSteamStatus(source = 'validation') {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const payload = {
        initialized: steamStubState.initialized,
        connected: steamStubState.connected,
        pending: steamStubState.pending,
        isOnline: steamStubState.connected,
        steamId: steamStubState.steamId,
        playerName: steamStubState.playerName,
        appId: steamStubState.appId,
        source,
    };

    mainWindow.webContents.send('steam:status', payload);
    if (!steamStubState.pending) {
        mainWindow.webContents.send('steam:serverConnection', {
            connected: steamStubState.connected,
            source,
        });
    }
}

function registerStubIpc() {
    ipcMain.handle('get-displays', () => screen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        internal: display.internal,
    })));
    ipcMain.handle('set-fullscreen', (_event, enable) => {
        mainWindow?.setFullScreen(!!enable);
        return true;
    });
    ipcMain.handle('set-borderless', () => true);
    ipcMain.handle('set-windowed', () => true);
    ipcMain.handle('set-resolution', (_event, payload = {}) => {
        if (mainWindow && Number.isFinite(payload.width) && Number.isFinite(payload.height)) {
            mainWindow.setSize(payload.width, payload.height);
        }
        return true;
    });
    ipcMain.handle('get-window-bounds', () => getMainWindowSnapshot().windowBounds);
    ipcMain.handle('is-fullscreen', () => mainWindow?.isFullScreen() ?? false);
    ipcMain.handle('set-vsync', () => true);
    ipcMain.handle('desktop:get-runtime-config', async () => ({
        isElectron: true,
        platform: process.platform,
        arch: process.arch,
        isPackaged: false,
        appMode: 'electron-validation',
        windowsProfile: runtimeProfileLabel,
        runtimeProfileMode: 'lab',
        safeMode: false,
        gpuFallbackActive: false,
        angleBackend: process.env.SERENITY_ANGLE_BACKEND || 'd3d11',
        desktopThemeThumbnails: true,
        gpuSwitches: {},
        gpuHealth: await getGpuHealth(),
        ...getMainWindowSnapshot(),
    }));
    ipcMain.handle('desktop:get-process-metrics', async () => getProcessMetricsSnapshot());
    ipcMain.handle('desktop:get-gpu-health', async () => getGpuHealth());
    ipcMain.handle('desktop:get-devtools-diagnostics', async () => ({
        logPath: null,
        remoteDebuggingPort: null,
        remoteDebuggingUrl: null,
        isOpen: false,
        entries: [],
        pendingOpenRequests: [],
    }));
    ipcMain.handle('desktop:apply-runtime-profile', async (_event, profileName) => ({
        ok: true,
        relaunching: false,
        profileName,
        validationOnly: true,
    }));
    ipcMain.handle('get-gpu-diagnostics', async () => getGpuDiagnostics());
    ipcMain.handle('set-active-gpu-renderer', async (_event, rendererInfo) => {
        activeWebGLRenderer = typeof rendererInfo === 'string' && rendererInfo.trim()
            ? rendererInfo.trim()
            : null;
        return getGpuDiagnostics();
    });
    ipcMain.handle('desktop:startup-mark', async (_event, payload = {}) => {
        const phase = payload?.phase || 'unknown';
        startupMarks.push({
            phase,
            timestamp: Date.now(),
        });

        if (phase === 'startup-shell-ready' && !steamValidationState.coreBootstrapTriggered) {
            steamValidationState.coreBootstrapTriggered = true;
            steamValidationState.coreTriggeredPhase = phase;
            steamStubState.pending = true;
            queueMicrotask(() => sendSteamStatus('validation:steam-core-pending'));
            setTimeout(() => {
                steamStubState.initialized = true;
                steamStubState.connected = true;
                steamStubState.pending = false;
                steamStubState.steamId = '76561198000000000';
                steamStubState.playerName = 'ValidationPlayer';
                sendSteamStatus('validation:steam-core-ready');
            }, 75);
        }

        if (phase === 'deferred-services-ready') {
            steamValidationState.deferredServicesTriggered = true;
            steamValidationState.deferredPhase = phase;
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
        const reportPath = await storeDesktopReport(stage, payload?.snapshot || null);
        return { ok: true, stage, reportPath };
    });

    ipcMain.handle('steam:isInitialized', async () => steamStubState.initialized);
    ipcMain.handle('steam:getSteamId', async () => steamStubState.steamId);
    ipcMain.handle('steam:getPlayerName', async () => steamStubState.playerName);
    ipcMain.handle('steam:getAppId', async () => steamStubState.appId);
    ipcMain.handle('steam:getConnectionStatus', async () => ({
        initialized: steamStubState.initialized,
        connected: steamStubState.connected,
        pending: steamStubState.pending,
        isOnline: steamStubState.connected,
        steamId: steamStubState.steamId,
        playerName: steamStubState.playerName,
        appId: steamStubState.appId,
    }));
    ipcMain.handle('steam:getCapabilities', async () => ({
        leaderboards: false,
        cloud: false,
        friends: steamStubState.connected,
        achievements: false,
    }));
    ipcMain.handle('steam:isSteamRunning', async () => steamStubState.initialized || steamStubState.pending);
    ipcMain.handle('steam:checkConnection', async () => steamStubState.connected || steamStubState.pending);
    ipcMain.handle('steam:getStats', async () => ({}));
    ipcMain.handle('steam:setRichPresence', async () => true);
    ipcMain.handle('steam:clearRichPresence', async () => true);
    ipcMain.handle('steam:getAvatar', async () => null);
    ipcMain.handle('steam:getFriends', async () => []);
    ipcMain.handle('steam:getPersonaState', async () => ({
        state: 1,
        label: 'Online',
        isOnline: true,
    }));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        show: SHOW_WINDOW,
        backgroundColor: '#000000',
        webPreferences: {
            preload: path.join(ROOT, 'electron', 'preload.mjs'),
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    return mainWindow;
}

async function waitForBootstrap(win) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 120000) => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < timeoutMs) {
                    if (predicate()) return true;
                    await sleep(100);
                }
                return false;
            };

            const ready = await waitFor(() => (
                !!window.serenityBlocks
                && !!window.runtimeValidation
                && !!document.getElementById('serenity-hub-icon')
                && !!document.getElementById('start-modal')
            ), 120000);

            return { ready };
        })();
    `;

    return win.webContents.executeJavaScript(script, true);
}

async function runRendererValidation(win) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 30000) => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < timeoutMs) {
                    if (predicate()) return true;
                    await sleep(100);
                }
                return false;
            };

            const app = window.serenityBlocks;
            const onlineButton = document.getElementById('online-multiplayer-btn')
                || document.getElementById('online-multiplayer-card-btn');
            const wheelProbe = (element) => {
                if (!element) {
                    return { dispatched: false, defaultPrevented: null };
                }
                const rect = element.getBoundingClientRect();
                const event = new WheelEvent('wheel', {
                    deltaY: 160,
                    bubbles: true,
                    cancelable: true,
                    clientX: rect.left + Math.min(rect.width / 2, 24),
                    clientY: rect.top + Math.min(rect.height / 2, 24),
                });
                const dispatched = element.dispatchEvent(event);
                return {
                    dispatched,
                    defaultPrevented: event.defaultPrevented,
                };
            };

            const getVisibleThemeCards = () => {
                const cards = Array.from(app.serenityHub?.themesTab?.themeCardElements?.values?.() || []);
                return cards.filter((card) => !card.hidden);
            };

            const onlineReady = await waitFor(() => onlineButton?.dataset?.disabled === 'false', 10000);
            const onlineAvailability = {
                ready: onlineReady,
                disabled: onlineButton?.dataset?.disabled || null,
                disabledLabel: onlineButton?.dataset?.disabledLabel || null,
                title: onlineButton?.title || null,
            };

            document.getElementById('serenity-hub-icon')?.click();
            const hubReady = await waitFor(() => (
                document.body.classList.contains('serenity-hub-open')
                && !!app.serenityHub?.themesTab
                && getVisibleThemeCards().length > 0
            ));
            await waitFor(() => (
                getVisibleThemeCards().some((card) => card.querySelector('.theme-icon-img.is-ready'))
            ), 5000);

            const hubScrollContainer = app.serenityHub?.getScrollContainer?.() || null;
            const themeCards = getVisibleThemeCards();
            const firstRowCards = themeCards.slice(0, 6);
            const firstRowIconStates = firstRowCards.map((card) => {
                const icon = card.querySelector('.theme-icon-img');
                return {
                    themeId: card.dataset.theme,
                    loaded: icon?.dataset?.iconLoaded === 'true',
                    ready: icon?.classList?.contains('is-ready') || false,
                    srcAssigned: Boolean(icon?.getAttribute?.('src')),
                    fetchPriority: icon?.getAttribute?.('fetchpriority') || null,
                    loading: icon?.getAttribute?.('loading') || null,
                };
            });

            const hubWheelProbe = wheelProbe(hubScrollContainer);

            app.modalManager.show('settings');
            const settingsVisible = await waitFor(() => document.getElementById('settings-modal')?.classList.contains('visible'));
            const settingsModal = document.getElementById('settings-modal');
            const settingsScrollContainer = settingsModal?.querySelector('.settings-scroll-container') || null;
            const settingsWheelProbe = wheelProbe(settingsScrollContainer);

            document.querySelector('#settings-modal .settings-tab[data-tab="controls"]')?.click();
            await sleep(50);
            document.querySelector('#settings-controls .controls-subtab[data-subtab="player2"]')?.click();
            await sleep(50);

            const settingsInteraction = {
                activeTab: document.querySelector('#settings-modal .settings-tab.active')?.dataset?.tab || null,
                activeSubtab: document.querySelector('#settings-controls .controls-subtab.active')?.dataset?.subtab || null,
                controlsPanelVisible: document.getElementById('settings-controls')?.classList.contains('active') || false,
                player2PanelVisible: document.getElementById('controls-player2')?.classList.contains('active') || false,
            };

            const clickProbeElement = document.querySelector('#settings-modal .settings-tab.active')
                || settingsModal?.querySelector('.modal-content')
                || settingsModal;
            const settingsRect = clickProbeElement?.getBoundingClientRect?.() || null;
            const topElementAtSettingsCenter = settingsRect
                ? document.elementFromPoint(
                    settingsRect.left + (settingsRect.width / 2),
                    settingsRect.top + (settingsRect.height / 2),
                )
                : null;
            const clickThroughCheck = {
                topElementTag: topElementAtSettingsCenter?.tagName || null,
                insideSettingsModal: Boolean(topElementAtSettingsCenter?.closest?.('#settings-modal')),
            };

            const startModeWithSettingsOverlay = async (modeId) => {
                try {
                    await app.gameModeManager.activateMode(modeId);
                    await app.gameModeManager.startCurrentMode();
                    await waitFor(() => app.gameModeManager.getCurrentModeId?.() === modeId, 15000);
                    app.modalManager.show('settings');
                    await waitFor(() => document.getElementById('settings-modal')?.classList.contains('visible'), 5000);
                    return {
                        modeId,
                        ok: true,
                        overlayWheelProbe: wheelProbe(document.querySelector('#settings-modal .settings-scroll-container')),
                    };
                } catch (error) {
                    return {
                        modeId,
                        ok: false,
                        reason: error?.message || String(error),
                    };
                }
            };

            const singlePlayerOverlay = await startModeWithSettingsOverlay('single');
            const infinityOverlay = await startModeWithSettingsOverlay('infinity');
            const odysseyOverlay = await startModeWithSettingsOverlay('odyssey');
            await sleep(1600);

            const benchmark = await window.runtimeValidation.captureDesktopBenchmark('manual-benchmark', {
                source: 'windows-electron-parity-validation',
            });
            const runtimeConfig = await window.electronAPI.getDesktopRuntimeConfig();
            const gpuHealth = await window.electronAPI.getGPUHealth();

            return {
                hubReady,
                settingsVisible,
                hubWheelProbe,
                settingsWheelProbe,
                firstRowIconStates,
                settingsInteraction,
                clickThroughCheck,
                onlineAvailability,
                singlePlayerOverlay,
                infinityOverlay,
                odysseyOverlay,
                runtimeConfig,
                gpuHealth,
                desktopPerformancePolicy: window.desktopPerformancePolicy || null,
                benchmark,
            };
        })();
    `;

    return win.webContents.executeJavaScript(script, true);
}

async function writeArtifacts(summary) {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(ARTIFACT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

app.whenReady().then(async () => {
    try {
        if (!existsSync(DIST_INDEX)) {
            throw new Error('dist/index.html is missing. Run `npm run build` before parity validation.');
        }

        registerStubIpc();
        const win = createWindow();
        const appUrl = pathToFileURL(DIST_INDEX);
        appUrl.searchParams.set('skipIntro', '1');
        await win.loadURL(appUrl.href);

        const bootstrap = await waitForBootstrap(win);
        if (!bootstrap?.ready) {
            throw new Error('Renderer bootstrap did not complete in time.');
        }

        await delay(250);
        const diagnostics = await getGpuDiagnostics();
        const gpuHealth = await getGpuHealth();
        const validation = await runRendererValidation(win);

        const summary = {
            generatedAt: new Date().toISOString(),
            runtimeProfile: runtimeProfileLabel,
            diagnostics,
            gpuHealth,
            processMetrics: getProcessMetricsSnapshot(),
            rendererReports: Object.fromEntries(desktopReports.entries()),
            startupMarks,
            steamValidation: {
                ...steamValidationState,
                coreTriggeredBeforeDeferred: (() => {
                    const coreIndex = startupMarks.findIndex((entry) => entry.phase === 'startup-shell-ready');
                    const deferredIndex = startupMarks.findIndex((entry) => entry.phase === 'deferred-services-ready');
                    return coreIndex !== -1 && (deferredIndex === -1 || coreIndex < deferredIndex);
                })(),
            },
            validation,
        };

        await writeArtifacts(summary);
        console.log(`[windows-electron-parity] Validation complete: ${ARTIFACT_DIR}`);
        app.quit();
    } catch (error) {
        await mkdir(ARTIFACT_DIR, { recursive: true });
        await writeFile(
            path.join(ARTIFACT_DIR, 'error.json'),
            `${JSON.stringify({
                generatedAt: new Date().toISOString(),
                message: error?.message || String(error),
                stack: error?.stack || null,
            }, null, 2)}\n`,
            'utf8',
        );
        console.error('[windows-electron-parity] Validation failed:', error);
        app.exit(1);
    }
});
