import electron from 'electron';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;
const PORT = 4177;
const OUT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'journey');
const URL = `http://127.0.0.1:${PORT}/?skipIntro=1&odysseyAAA=1&captureBust=${Date.now()}`;
const REQUESTED_FRAMES = (process.env.ODYSSEY_EARTH_CORE_CAPTURE_FRAMES || '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 19);
const CAPTURE_FRAMES = REQUESTED_FRAMES.length > 0
    ? REQUESTED_FRAMES
    : Array.from({ length: 19 }, (_, index) => index + 1);
const CLEAR_OUT_DIR = process.env.ODYSSEY_EARTH_CORE_KEEP_EXISTING !== '1';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function execute(win, source) {
    return win.webContents.executeJavaScript(source, true);
}

async function waitFor(win, predicateSource, timeoutMs = 120000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await execute(win, predicateSource)) return true;
        await delay(150);
    }
    return false;
}

const HIDE_OVERLAYS = `
    (() => {
        const captureStyleId = 'odyssey-earth-core-capture-hide-ui';
        let style = document.getElementById(captureStyleId);
        if (!style) {
            style = document.createElement('style');
            style.id = captureStyleId;
            style.textContent = [
                '#start-modal',
                '.game-mode-selection',
                '.game-mode-cards-container',
                '.game-mode-card',
                '.start-modal-actions',
                '.headphones-recommended',
                '.headphone-text',
                '#serenity-hub-icon',
                '.serenity-hub-icon',
                '.floating-settings-btn',
                '#debug-panel',
                '.debug-panel',
                '#odyssey-debug-panel',
                '.odyssey-debug-panel',
                '.modal-overlay',
                '#main-menu',
                '.main-menu-screen',
                '#menu-screen'
            ].join(',') + '{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;}';
            document.head.appendChild(style);
        }
        [
            '#cinematic-loading-overlay',
            '#startup-shell',
            '#start-modal',
            '.game-mode-selection',
            '.game-mode-cards-container',
            '.game-mode-card',
            '.start-modal-actions',
            '.headphones-recommended',
            '.headphone-text',
            '#serenity-hub-icon',
            '.serenity-hub-icon',
            '.floating-settings-btn',
            '.modal-overlay',
            '#main-menu',
            '.main-menu-screen',
            '#menu-screen',
        ].forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('opacity', '0', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
            });
        });
        document.querySelectorAll('#start-modal, .game-mode-selection, .game-mode-cards-container').forEach((el) => el.remove());
        document.body.classList.remove('startup-shell-active');
        document.body.classList.remove('start-modal-open');
        document.body.classList.remove('serenity-hub-open');
        void document.body.offsetHeight;
        return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
        });
    })();
`;

async function run() {
    if (CLEAR_OUT_DIR) {
        await rm(OUT_DIR, { recursive: true, force: true });
    }
    await mkdir(OUT_DIR, { recursive: true });

    const win = new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    console.log(`[quick-capture] loading ${URL}`);
    win.loadURL(URL);
    if (!await waitFor(win, '!!window.serenityBlocks?.gameModeManager')) {
        throw new Error('gameModeManager not ready');
    }
    console.log('[quick-capture] gameModeManager ready');

    const booted = await execute(win, `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const gm = window.serenityBlocks.gameModeManager;
            if (gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
            if (!gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();
            const started = performance.now();
            while (performance.now() - started < 120000) {
                const bc = window.odysseyMode?.boardController;
                if (bc?.isActive && bc.environmentManager?.environments?.has(1) && bc.cameraController) return true;
                await sleep(150);
            }
            return false;
        })();
    `);
    if (!booted) throw new Error('Odyssey chapter 1 not ready');
    console.log(`[quick-capture] Odyssey ready; capturing frames ${CAPTURE_FRAMES.join(', ')}`);

    await execute(win, HIDE_OVERLAYS);
    await delay(1200);
    await execute(win, HIDE_OVERLAYS);

    for (const frame of CAPTURE_FRAMES) {
        const position = (frame - 1) * 0.005;
        await execute(win, `
            (() => {
                const bc = window.odysseyMode.boardController;
                const pos = ${position};
                bc.cameraController.setCurrentPosition(pos);
                bc.cameraController.updateFollowPosition({ position: pos, direct: true });
                const blendState = bc.environmentManager?.getBlendState(pos) || null;
                bc.environmentManager?.updateVisibility(pos, { mode: 'progress', blendState });
                bc.environmentManager?.updateGlobalEnvironment(pos);
                bc.director?.update?.(0.016, { ascentProgress: pos, audio: null, blendState });
                const directorState = bc.director?.getState?.() || null;
                bc.nodeManager?.setCameraProgress(pos);
                bc.nodeManager?.update(0.016, directorState?.node?.focalPulse ?? 0);
                bc.environmentManager?.update(0.016, bc.camera, pos, directorState);
                bc.pathRenderer?.update?.(0.016, directorState);
                bc.thresholdDirector?.update?.(0.016, bc.camera, directorState);
                return true;
            })();
        `);
        await execute(win, HIDE_OVERLAYS);
        await delay(350);
        await execute(win, HIDE_OVERLAYS);
        const image = await win.webContents.capturePage();
        const name = `Earth Core & Subterranean Origins - ${String(frame).padStart(2, '0')}.png`;
        await writeFile(path.join(OUT_DIR, name), image.toPNG());
        console.log(`[quick-capture] wrote ${name}`);
    }

    win.destroy();
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
    try {
        await run();
        app.quit();
    } catch (error) {
        console.error('[quick-capture] FAILED:', error?.message || error);
        app.exit(1);
    }
});
