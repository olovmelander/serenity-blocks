import electron from 'electron';
import { existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import {
    createContentSecurityPolicy,
    extractInlineScriptHashes,
} from '../electron/content-security-policy.js';

const ROOT = process.cwd();
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'sakura-twilight-electron', TIMESTAMP);
const SHOW_WINDOW = process.env.SERENITY_SHOW_WINDOW === '1';
const { app, BrowserWindow, ipcMain, screen, session } = electron;

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force-high-performance-gpu');
app.commandLine.appendSwitch('enable-webgl');

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function installContentSecurityPolicy() {
    const html = readFileSync(DIST_INDEX, 'utf8');
    const policy = createContentSecurityPolicy({
        mode: 'packaged',
        inlineScriptHashes: extractInlineScriptHashes(html),
    });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [policy],
            },
        });
    });

    return policy;
}

function registerIpcStubs() {
    const displays = () => screen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        internal: display.internal,
        displayFrequency: display.displayFrequency,
    }));

    ipcMain.handle('get-displays', displays);
    ipcMain.handle('set-fullscreen', () => true);
    ipcMain.handle('set-borderless', () => true);
    ipcMain.handle('set-windowed', () => true);
    ipcMain.handle('set-resolution', () => true);
    ipcMain.handle('get-window-bounds', () => null);
    ipcMain.handle('is-fullscreen', () => false);
    ipcMain.handle('set-vsync', () => true);
    ipcMain.handle('desktop:get-runtime-config', () => ({
        isElectron: true,
        platform: process.platform,
        arch: process.arch,
        isPackaged: true,
        appMode: 'packaged-validation',
        windowsProfile: 'sakura-validation',
        runtimeProfileMode: 'lab',
        desktopThemeThumbnails: false,
        gpuFallbackActive: false,
        gpuHealth: {
            status: 'healthy',
            reasons: [],
            remediation: [],
        },
    }));
    ipcMain.handle('desktop:get-process-metrics', () => app.getAppMetrics());
    ipcMain.handle('desktop:get-gpu-health', () => ({ status: 'healthy', reasons: [], remediation: [] }));
    ipcMain.handle('desktop:get-devtools-diagnostics', () => ({}));
    ipcMain.handle('desktop:get-debug-tools-status', () => ({}));
    ipcMain.handle('desktop:get-log-paths', () => ({}));
    ipcMain.handle('desktop:open-devtools', () => null);
    ipcMain.handle('desktop:open-renderer-debugger', () => null);
    ipcMain.handle('desktop:apply-runtime-profile', () => null);
    ipcMain.handle('desktop:store-performance-report', () => null);
    ipcMain.handle('desktop:startup-mark', () => null);
    ipcMain.handle('get-gpu-diagnostics', () => ({}));
    ipcMain.handle('set-active-gpu-renderer', () => ({}));

    [
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
    ].forEach((channel) => {
        ipcMain.handle(channel, () => null);
    });

    ipcMain.handle('steam:getConnectionStatus', () => ({
        initialized: false,
        connected: false,
        pending: false,
    }));
    ipcMain.handle('steam:getDiagnostics', () => ({ pending: false }));
}

function createWindow() {
    return new BrowserWindow({
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
}

async function validateSakura(win) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 90000) => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < timeoutMs) {
                    const value = predicate();
                    if (value) return value;
                    await sleep(150);
                }
                return null;
            };

            const managersReady = await waitFor(() => (
                window.serenityBlocks?.themeManager && window.serenityBlocks?.gameModeManager
            ));
            if (!managersReady) return { ok: false, reason: 'Managers not ready' };

            const app = window.serenityBlocks;
            if (!app.gameModeManager.getCurrentMode?.()?.isRunning) {
                try {
                    window.dispatchEvent(new CustomEvent('startGameWithMode', {
                        detail: { mode: 'serenity' },
                    }));
                } catch (error) {}
                await waitFor(() => app.gameModeManager.getCurrentMode?.()?.isRunning, 30000);
            }

            const themeManager = window.themeManager || app.themeManager;
            themeManager.switchTheme('sakura-twilight', true).catch((error) => {
                console.error('[SakuraValidation] switchTheme failed:', error?.message || error);
            });

            const activeTheme = await waitFor(() => {
                const theme = themeManager.activeTheme;
                if (
                    themeManager.activeThemeName === 'sakura-twilight'
                    && theme?.renderer?.domElement
                    && theme?.sharedCanopyMaterial
                    && theme?.petals
                    && theme?.foxes?.length >= 2
                ) {
                    return theme;
                }
                return null;
            });
            if (!activeTheme) return { ok: false, reason: 'Sakura theme did not become inspectable' };

            await sleep(3000);

            const imageSize = (texture) => texture?.image
                ? {
                    width: texture.image.width || 0,
                    height: texture.image.height || 0,
                }
                : null;

            const foxMeshes = [];
            for (const fox of activeTheme.foxes || []) {
                fox.model?.traverse?.((child) => {
                    if (!child.isMesh) return;
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    foxMeshes.push(...materials.map((material) => ({
                        meshName: child.name || null,
                        materialName: material?.name || null,
                        color: material?.color?.getHexString?.() || null,
                        hasMap: Boolean(material?.map),
                        mapImage: imageSize(material?.map),
                        mapColorSpace: material?.map?.colorSpace || null,
                    })));
                });
            }

            const canopy = activeTheme.sharedCanopyMaterial;
            const petalGeometry = activeTheme.petals.geometry;

            document.querySelectorAll(
                '#start-modal, .modal-overlay, .modal-backdrop, #serenity-hub-panel, #serenity-hub-icon, #game-container, #performance-overlay'
            ).forEach((el) => { el.style.display = 'none'; });

            return {
                ok: true,
                activeThemeName: themeManager.activeThemeName,
                canopy: {
                    hasMap: Boolean(canopy.map),
                    mapImage: imageSize(canopy.map),
                    mapColorSpace: canopy.map?.colorSpace || null,
                    hasAlphaMap: Boolean(canopy.alphaMap),
                    transparent: canopy.transparent,
                    alphaTest: canopy.alphaTest,
                },
                foxMeshes,
                petals: {
                    isMesh: activeTheme.petals.isMesh === true,
                    isInstancedBufferGeometry: petalGeometry?.isInstancedBufferGeometry === true,
                    instanceCount: petalGeometry?.instanceCount ?? null,
                    hasViewportUniform: Boolean(activeTheme.petals.material?.uniforms?.uViewport),
                },
                renderer: {
                    outputColorSpace: activeTheme.renderer.outputColorSpace || null,
                    pixelRatio: activeTheme.renderer.getPixelRatio?.() || null,
                    canvas: {
                        width: activeTheme.renderer.domElement.width,
                        height: activeTheme.renderer.domElement.height,
                    },
                },
            };
        })();
    `;

    return win.webContents.executeJavaScript(script, true);
}

function getFailures({ validation, consoleEntries }) {
    const failures = [];

    if (!validation?.ok) {
        failures.push(validation?.reason || 'Validation script returned a failed result');
        return failures;
    }

    const cspFailures = consoleEntries.filter((entry) => (
        /Content Security Policy|Refused to connect|Refused to load|THREE\.GLTFLoader: Couldn't load texture/i.test(entry.message)
        && /blob:|connect-src|GLTFLoader/i.test(entry.message)
    ));
    if (cspFailures.length > 0) {
        failures.push(`Console contains CSP/GLB texture failures: ${cspFailures.map((entry) => entry.message).join(' | ')}`);
    }

    const canopyImage = validation.canopy?.mapImage;
    if (!validation.canopy?.hasMap || !canopyImage?.width || !canopyImage?.height) {
        failures.push('Canopy material is missing a loaded base-color texture');
    }
    if (validation.canopy?.hasAlphaMap) {
        failures.push('Canopy material should not use the base-color texture as alphaMap');
    }
    if (!(validation.canopy?.alphaTest > 0)) {
        failures.push('Canopy material is not alpha-tested');
    }

    const texturedFoxMeshes = validation.foxMeshes.filter((mesh) => (
        mesh.hasMap && mesh.mapImage?.width > 0 && mesh.mapImage?.height > 0
    ));
    if (validation.foxMeshes.length < 2 || texturedFoxMeshes.length < 2) {
        failures.push('Expected both fox meshes to have loaded texture maps');
    }

    if (!validation.petals?.isMesh || !validation.petals?.isInstancedBufferGeometry || validation.petals?.instanceCount !== 400) {
        failures.push('Petals are not using the 400-instance billboard mesh');
    }

    return failures;
}

async function main() {
    if (!existsSync(DIST_INDEX)) {
        throw new Error('dist/index.html is missing. Run `npm run build` first.');
    }

    await mkdir(ARTIFACT_DIR, { recursive: true });
    registerIpcStubs();
    const policy = installContentSecurityPolicy();
    const win = createWindow();
    const consoleEntries = [];

    win.webContents.on('console-message', (_event, level, message) => {
        consoleEntries.push({
            timestamp: new Date().toISOString(),
            level,
            message,
        });
    });

    const appUrl = pathToFileURL(DIST_INDEX);
    appUrl.searchParams.set('skipIntro', '1');
    await win.loadURL(appUrl.href);
    const validation = await validateSakura(win);
    await delay(500);

    const screenshot = await win.webContents.capturePage();
    const screenshotPath = path.join(ARTIFACT_DIR, 'sakura-twilight-electron.png');
    await writeFile(screenshotPath, screenshot.toPNG());

    const failures = getFailures({ validation, consoleEntries });
    const summary = {
        generatedAt: new Date().toISOString(),
        policy,
        validation,
        failures,
        screenshot: screenshotPath,
        consoleEntries,
    };
    await writeFile(path.join(ARTIFACT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    if (!win.isDestroyed()) win.destroy();

    if (failures.length > 0) {
        console.error('[SakuraValidation] Failed:', failures.join('; '));
        console.error(`[SakuraValidation] Artifacts: ${ARTIFACT_DIR}`);
        app.exit(1);
        return;
    }

    console.log(`[SakuraValidation] Passed. Artifacts: ${ARTIFACT_DIR}`);
    app.quit();
}

app.whenReady().then(main).catch(async (error) => {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(ARTIFACT_DIR, 'error.json'), `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        message: error?.message || String(error),
        stack: error?.stack || null,
    }, null, 2)}\n`, 'utf8');
    console.error('[SakuraValidation] Fatal:', error);
    app.exit(1);
});
