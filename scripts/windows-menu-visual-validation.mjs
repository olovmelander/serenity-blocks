import electron from 'electron';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = process.cwd();
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const PRELOAD_PATH = path.join(ROOT, 'electron', 'preload.mjs');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'windows-menu-visual', TIMESTAMP);
const REPORT_PATH = path.join(ARTIFACT_DIR, 'report.json');
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, 'menu.png');
const SHOW_WINDOW = process.env.SERENITY_SHOW_WINDOW !== '0';
const WINDOW_WIDTH = Number.parseInt(process.env.SERENITY_MENU_VISUAL_WIDTH || '1600', 10);
const WINDOW_HEIGHT = Number.parseInt(process.env.SERENITY_MENU_VISUAL_HEIGHT || '900', 10);
const { app, BrowserWindow, ipcMain, screen } = electron;

const consoleMessages = [];
let activeWebGLRenderer = null;
let mainWindow = null;

app.commandLine.appendSwitch('force-high-performance-gpu');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function registerHandler(channel, handler) {
    try {
        ipcMain.removeHandler(channel);
    } catch {
        // Handler was not registered yet.
    }
    ipcMain.handle(channel, handler);
}

function getWindowSnapshot() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return {
            windowBounds: null,
            contentBounds: null,
            display: null,
            displayScaleFactor: null,
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
    };
}

function registerIpcStubs() {
    registerHandler('get-displays', () => screen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        internal: display.internal,
        displayFrequency: display.displayFrequency,
    })));
    registerHandler('set-fullscreen', (_event, enable) => {
        mainWindow?.setFullScreen(!!enable);
        return true;
    });
    registerHandler('set-borderless', () => true);
    registerHandler('set-windowed', () => true);
    registerHandler('set-resolution', (_event, { width, height } = {}) => {
        if (mainWindow && Number.isFinite(width) && Number.isFinite(height)) {
            mainWindow.setSize(width, height);
            mainWindow.center();
        }
        return true;
    });
    registerHandler('get-window-bounds', () => getWindowSnapshot().windowBounds);
    registerHandler('is-fullscreen', () => mainWindow?.isFullScreen() ?? false);
    registerHandler('set-vsync', () => true);
    registerHandler('desktop:get-runtime-config', () => ({
        isElectron: true,
        platform: process.platform,
        arch: process.arch,
        isPackaged: true,
        appMode: 'packaged-menu-validation',
        windowsProfile: 'validation',
        runtimeProfileMode: 'lab',
        safeMode: false,
        useStartupRevealGate: false,
        desktopThemeThumbnails: false,
        gpuFallbackActive: false,
        gpuSwitches: {},
        gpuHealth: {
            status: 'healthy',
            reasons: [],
            remediation: [],
        },
        ...getWindowSnapshot(),
    }));
    registerHandler('desktop:get-process-metrics', () => ({
        generatedAt: new Date().toISOString(),
        processMetrics: app.getAppMetrics(),
        ...getWindowSnapshot(),
    }));
    registerHandler('desktop:get-gpu-health', () => ({
        status: 'healthy',
        reasons: [],
        remediation: [],
    }));
    registerHandler('desktop:get-devtools-diagnostics', () => ({}));
    registerHandler('desktop:get-debug-tools-status', () => ({}));
    registerHandler('desktop:get-log-paths', () => ({}));
    registerHandler('desktop:open-devtools', () => null);
    registerHandler('desktop:open-renderer-debugger', () => null);
    registerHandler('desktop:apply-runtime-profile', () => null);
    registerHandler('desktop:store-performance-report', () => true);
    registerHandler('desktop:startup-mark', () => null);
    registerHandler('get-gpu-diagnostics', async () => {
        try {
            return {
                activeWebGLRenderer,
                gpuFeatureStatus: app.getGPUFeatureStatus?.() || {},
                gpuInfo: await app.getGPUInfo('basic'),
            };
        } catch {
            return {
                activeWebGLRenderer,
                gpuFeatureStatus: app.getGPUFeatureStatus?.() || {},
            };
        }
    });
    registerHandler('set-active-gpu-renderer', (_event, renderer) => {
        activeWebGLRenderer = typeof renderer === 'string' ? renderer : null;
        return { activeWebGLRenderer };
    });

    const steamNullChannels = [
        'steam:getSteamId', 'steam:getAppId', 'steam:getAvatar',
        'steam:getStat', 'steam:setStat', 'steam:setStatMax',
        'steam:incrementStat', 'steam:storeStats', 'steam:getStats',
        'steam:uploadScore', 'steam:getLeaderboard', 'steam:getLeaderboardEntry',
        'steam:cloudWrite', 'steam:cloudRead', 'steam:cloudDelete',
        'steam:cloudExists', 'steam:cloudGetQuota', 'steam:cloudGetTimestamp',
        'steam:getFriends', 'steam:inviteToLobby', 'steam:openLobbyInviteDialog',
        'steam:activateOverlay', 'steam:activateOverlayToUser',
        'steam:createLobby', 'steam:joinLobby', 'steam:leaveLobby',
        'steam:getLobbies', 'steam:getLobbyData', 'steam:setLobbyData',
        'steam:getLobbyMembers', 'steam:getLobbyOwner',
        'steam:sendP2PPacket', 'steam:readP2PPacket',
        'steam:isP2PPacketAvailable', 'steam:closeP2PSession',
    ];
    steamNullChannels.forEach((channel) => registerHandler(channel, () => null));
    registerHandler('steam:isInitialized', () => false);
    registerHandler('steam:getPlayerName', () => 'ValidationPlayer');
    registerHandler('steam:isSteamRunning', () => false);
    registerHandler('steam:checkConnection', () => false);
    registerHandler('steam:getCapabilities', () => ({
        leaderboards: false,
        cloud: false,
        friends: false,
        achievements: false,
    }));
    registerHandler('steam:getConnectionStatus', () => ({
        initialized: false,
        connected: false,
        pending: false,
        isOnline: false,
        source: 'windows-menu-visual-validation',
    }));
    registerHandler('steam:getPersonaState', () => ({
        state: 0,
        label: 'Offline',
        isOnline: false,
    }));
    registerHandler('steam:setRichPresence', () => true);
    registerHandler('steam:clearRichPresence', () => true);
    registerHandler('steam:getDiagnostics', () => ({
        validation: true,
        initialized: false,
    }));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: Number.isFinite(WINDOW_WIDTH) ? WINDOW_WIDTH : 1600,
        height: Number.isFinite(WINDOW_HEIGHT) ? WINDOW_HEIGHT : 900,
        show: SHOW_WINDOW,
        backgroundColor: '#000000',
        webPreferences: {
            preload: PRELOAD_PATH,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            backgroundThrottling: false,
        },
    });

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleMessages.push({
            level,
            message,
            line,
            sourceId,
        });
    });

    return mainWindow;
}

async function driveMenuAndCollectMetrics(win) {
    return win.webContents.executeJavaScript(`
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 150000, onTick = null) => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < timeoutMs) {
                    const value = predicate();
                    if (value) return value;
                    if (onTick) await onTick();
                    await sleep(100);
                }
                throw new Error('Timed out waiting for menu visual validation condition.');
            };

            const elementSnapshot = (element) => {
                if (!element) return null;
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                const opacity = Number.parseFloat(style.opacity || '1');
                const resolvedOpacity = Number.isFinite(opacity) ? opacity : 1;
                const inViewport = rect.bottom > 0
                    && rect.right > 0
                    && rect.top < window.innerHeight
                    && rect.left < window.innerWidth;
                const hasPaintedBox = rect.width > 0
                    && rect.height > 0
                    && inViewport
                    && style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && resolvedOpacity > 0.05;

                return {
                    display: style.display || '',
                    visibility: style.visibility || '',
                    opacity: style.opacity || '',
                    width: rect.width,
                    height: rect.height,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    left: rect.left,
                    painted: hasPaintedBox,
                };
            };

            const isPainted = (element) => Boolean(elementSnapshot(element)?.painted);

            let menuBgReady = false;
            window.addEventListener('intro:menuBgReady', () => {
                menuBgReady = true;
            }, { once: true });

            await waitFor(() => document.getElementById('intro-animation'), 150000);

            let lastClickAt = 0;
            await waitFor(() => {
                const modal = document.getElementById('start-modal');
                const cards = Array.from(document.querySelectorAll('#start-modal .game-mode-card'));
                const paintedCards = cards.filter((card) => isPainted(card));

                return menuBgReady
                    && document.body.classList.contains('start-modal-open')
                    && modal?.classList.contains('visible')
                    && isPainted(modal)
                    && cards.length >= 6
                    && paintedCards.length >= 6;
            }, 150000, async () => {
                const now = Date.now();
                const intro = document.getElementById('intro-animation');
                if (intro && now - lastClickAt > 900) {
                    lastClickAt = now;
                    intro.dispatchEvent(new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        clientX: window.innerWidth / 2,
                        clientY: window.innerHeight / 2,
                    }));
                }
            });

            await waitFor(() => {
                const modalInfo = elementSnapshot(document.getElementById('start-modal'));
                const paintedCards = Array.from(document.querySelectorAll('#start-modal .game-mode-card'))
                    .filter((card) => elementSnapshot(card)?.painted);
                return modalInfo?.painted
                    && Number.parseFloat(modalInfo.opacity || '1') > 0.95
                    && paintedCards.length >= 6;
            }, 10000);
            await sleep(900);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            const normalizedBackdrop = (value) => !value || value === 'none';
            const cards = Array.from(document.querySelectorAll('.game-mode-card'));
            const modal = document.getElementById('start-modal');
            const cardsContainer = document.querySelector('.game-mode-cards-container');
            const cardBackdrops = cards.map((card) => {
                const style = getComputedStyle(card);
                return {
                    id: card.id || card.dataset.mode || null,
                    backdropFilter: style.backdropFilter || '',
                    webkitBackdropFilter: style.webkitBackdropFilter || '',
                    rect: elementSnapshot(card),
                };
            });

            const staticLogo = document.querySelector('.main-menu-logo');
            const staticLogoStyle = staticLogo ? getComputedStyle(staticLogo) : null;
            const staticLogoRect = elementSnapshot(staticLogo);
            const introLogo = document.querySelector('.intro-title-container.shrink-to-logo');
            const introLogoStyle = introLogo ? getComputedStyle(introLogo) : null;
            const introLogoRect = elementSnapshot(introLogo);
            const canvas = document.getElementById('intro-webgl-canvas');
            const canvasRect = canvas?.getBoundingClientRect?.() || null;
            const canvasRatioX = canvas && canvasRect?.width ? canvas.width / canvasRect.width : 0;
            const canvasRatioY = canvas && canvasRect?.height ? canvas.height / canvasRect.height : 0;
            const expectedCanvasRatio = Math.min(window.devicePixelRatio || 1, 2);

            return {
                menuBgReady,
                bodyClasses: Array.from(document.body.classList),
                cardCount: cards.length,
                paintedCardCount: cardBackdrops.filter((entry) => entry.rect?.painted).length,
                modal: elementSnapshot(modal),
                cardsContainer: elementSnapshot(cardsContainer),
                cardBackdrops,
                cardsHaveNoBackdropFilter: cardBackdrops.every((entry) => (
                    normalizedBackdrop(entry.backdropFilter)
                    && normalizedBackdrop(entry.webkitBackdropFilter)
                )),
                staticLogo: {
                    exists: Boolean(staticLogo),
                    display: staticLogoStyle?.display || null,
                    visibility: staticLogoStyle?.visibility || null,
                    opacity: staticLogoStyle?.opacity || null,
                    width: staticLogoRect?.width || 0,
                    height: staticLogoRect?.height || 0,
                    visible: Boolean(staticLogoRect?.painted),
                },
                introLogo: {
                    exists: Boolean(introLogo),
                    display: introLogoStyle?.display || null,
                    visibility: introLogoStyle?.visibility || null,
                    width: introLogoRect?.width || 0,
                    height: introLogoRect?.height || 0,
                    hidden: !introLogo || !introLogoRect?.painted,
                },
                canvas: {
                    exists: Boolean(canvas),
                    cssWidth: canvasRect?.width || 0,
                    cssHeight: canvasRect?.height || 0,
                    backingWidth: canvas?.width || 0,
                    backingHeight: canvas?.height || 0,
                    ratioX: canvasRatioX,
                    ratioY: canvasRatioY,
                    expectedRatio: expectedCanvasRatio,
                    backingAdequate: Boolean(canvas)
                        && canvasRatioX >= expectedCanvasRatio * 0.88
                        && canvasRatioY >= expectedCanvasRatio * 0.88,
                },
                devicePixelRatio: window.devicePixelRatio || 1,
                activeElement: document.activeElement?.id || document.activeElement?.tagName || null,
            };
        })();
    `, true);
}

function getWebGpuValidationMessages() {
    const validationPattern = /\\b(WebGPU|GPUValidationError|validation error|uncaptured error|WGSL|shader module|render pipeline|bind group)\\b/i;
    return consoleMessages.filter((entry) => {
        const level = Number(entry.level);
        const isWarningOrError = Number.isFinite(level) ? level >= 2 : true;
        return isWarningOrError && validationPattern.test(String(entry.message || ''));
    });
}

function assertMetrics(metrics) {
    const failures = [];

    if (!metrics?.cardsHaveNoBackdropFilter) {
        failures.push('Main menu cards still have backdrop-filter enabled.');
    }
    if ((metrics?.paintedCardCount || 0) < 6) {
        failures.push('Main menu card grid did not render all six visible cards.');
    }
    if (!metrics?.staticLogo?.visible) {
        failures.push('Electron menu did not use a visible static .main-menu-logo.');
    }
    if (!metrics?.introLogo?.hidden) {
        failures.push('Animated intro title logo is still visible in Electron menu mode.');
    }
    if (!metrics?.canvas?.backingAdequate) {
        failures.push('Intro canvas backing resolution is below the expected DPR scale.');
    }

    const webgpuValidationMessages = getWebGpuValidationMessages();
    if (webgpuValidationMessages.length > 0) {
        failures.push('Console contained WebGPU validation errors.');
    }

    return {
        ok: failures.length === 0,
        failures,
        webgpuValidationMessages,
    };
}

async function main() {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    if (!existsSync(DIST_INDEX)) {
        throw new Error('dist/index.html is missing. Run npm run build before menu visual validation.');
    }
    if (!existsSync(PRELOAD_PATH)) {
        throw new Error(`Missing preload script: ${PRELOAD_PATH}`);
    }

    registerIpcStubs();
    const win = createWindow();
    const appUrl = pathToFileURL(DIST_INDEX);
    appUrl.searchParams.set('menuVisualValidation', '1');
    await win.loadURL(appUrl.href);

    if (SHOW_WINDOW) {
        win.show();
        win.focus();
    }

    const metrics = await driveMenuAndCollectMetrics(win);
    await delay(300);
    const image = await win.webContents.capturePage();
    await writeFile(SCREENSHOT_PATH, image.toPNG());

    const assertions = assertMetrics(metrics);
    const report = {
        generatedAt: new Date().toISOString(),
        artifactDir: ARTIFACT_DIR,
        screenshotPath: SCREENSHOT_PATH,
        metrics,
        assertions,
        consoleMessages,
        window: getWindowSnapshot(),
    };
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    if (!assertions.ok) {
        throw new Error(`Menu visual validation failed: ${assertions.failures.join(' ')}`);
    }

    console.log(`[windows-menu-visual] Validation complete: ${ARTIFACT_DIR}`);
    if (!win.isDestroyed()) {
        win.destroy();
    }
    app.exit(0);
}

app.whenReady().then(() => {
    main().catch(async (error) => {
        await mkdir(ARTIFACT_DIR, { recursive: true });
        if (!existsSync(REPORT_PATH)) {
            await writeFile(REPORT_PATH, `${JSON.stringify({
                generatedAt: new Date().toISOString(),
                errorMessage: error?.message || String(error),
                errorStack: error?.stack || null,
                consoleMessages,
                window: getWindowSnapshot(),
            }, null, 2)}\n`, 'utf8');
        }
        console.error('[windows-menu-visual] Failed:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
        }
        app.exit(1);
    });
});
