/**
 * Odyssey Journey Capture Harness.
 *
 * Usage:
 *   npx electron scripts/odyssey-journey-capture.mjs
 */

import electron from 'electron';
import { mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const DEV_SERVER_PORT = 4177;
const DEV_SERVER_BASE_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const URL_FLAGS = 'skipIntro=1&odysseyAAA=1';
const DEV_SERVER_URL = `${DEV_SERVER_BASE_URL}/?${URL_FLAGS}`;
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'journey');

const CHAPTER_NAMES = {
    1: 'Earth Core & Subterranean Origins',
    2: 'Deep Ocean & Liquid Worlds',
    3: 'Surface World & Living Landscapes',
    4: 'Mountains & Thin-Air Ascension',
    5: 'Sky & Atmospheric Drift',
    6: 'Space & Cosmic Expanse',
    7: 'Black Hole & Abstract Transcendence',
    8: 'Urban Dreams Encore'
};

const consoleLines = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // Keep polling until dev server is listening.
        }
        await delay(400);
    }
    throw new Error(`Timed out waiting for dev server: ${url}`);
}

function createWindow() {
    return new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        webPreferences: {
            offscreen: false,
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
}

async function execute(win, source) {
    return win.webContents.executeJavaScript(source, true);
}

async function bootstrapOdyssey(win) {
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

            if (!await waitFor(() => !!window.serenityBlocks?.gameModeManager)) {
                return { ok: false, reason: 'gameModeManager not ready' };
            }

            const gm = window.serenityBlocks.gameModeManager;
            try {
                if (gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
                if (!gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();
            } catch (error) {
                return { ok: false, reason: 'activate failed: ' + (error?.message || error) };
            }

            if (!await waitFor(() => !!window.odysseyMode?.boardController?.isActive)) {
                return { ok: false, reason: 'board not active' };
            }

            const hide = (selector) => document.querySelectorAll(selector).forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
            });
            hide('#start-modal');
            hide('.modal-overlay');
            hide('#main-menu, .main-menu-screen, #menu-screen');

            const bc = window.odysseyMode.boardController;
            await waitFor(() => {
                const envs = bc.environmentManager?.environments;
                return envs && envs.size >= 8;
            }, 120000);
            await sleep(500);

            return {
                ok: true,
                aaaPost: !!bc.aaaPostActive,
                chapterPositions: [...(bc.presentationLayout?.chapterPositions || [])],
                currentPosition: bc.cameraController?.getCurrentPosition?.() ?? 0,
            };
        })();
    `;
    return execute(win, script);
}

async function waitForBoardSettled(win, targetPosition, timeoutMs = 15000) {
    const script = `
        (async () => {
            const target = ${JSON.stringify(targetPosition)};
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const startedAt = performance.now();
            while (performance.now() - startedAt < ${timeoutMs}) {
                const bc = window.odysseyMode?.boardController;
                const current = bc?.cameraController?.getCurrentPosition?.();
                const envs = bc?.environmentManager?.environments;
                const pending = bc?.pendingChapterLoads?.size || 0;
                if (Number.isFinite(current)
                    && Math.abs(current - target) < 0.0012
                    && envs?.size >= 8
                    && pending === 0) {
                    return true;
                }
                await sleep(80);
            }
            return false;
        })();
    `;
    return execute(win, script);
}

async function panToPosition(win, position, duration = 800) {
    const script = `
        (async () => {
            const bc = window.odysseyMode?.boardController;
            if (!bc?.cameraController) return false;
            try {
                await bc.cameraController.panToPosition(${position}, ${duration});
                return true;
            } catch {
                return false;
            }
        })();
    `;
    return execute(win, script);
}

async function capturePng(win, filename) {
    const image = await win.webContents.capturePage();
    await writeFile(path.join(ARTIFACT_DIR, filename), image.toPNG());
    console.log(`[capture] wrote ${filename}`);
}

async function run() {
    await rm(ARTIFACT_DIR, { recursive: true, force: true });
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await waitForServer(DEV_SERVER_BASE_URL);

    const win = createWindow();
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        const logLine = `[renderer:${level}] ${message}`;
        consoleLines.push(logLine);
        console.log(logLine);
    });

    console.log(`[capture] loading dev server at ${DEV_SERVER_URL}...`);
    await win.loadURL(DEV_SERVER_URL);
    const boot = await bootstrapOdyssey(win);
    if (!boot?.ok) throw new Error(`Bootstrap failed: ${boot?.reason}`);
    console.log('[capture] Odyssey booted successfully');

    const totalSteps = 200;
    const chapterCounts = {};

    for (let step = 0; step <= totalSteps; step++) {
        const position = step / totalSteps;
        console.log(`[capture] Panning to position ${position.toFixed(3)} (step ${step}/${totalSteps})...`);
        
        await panToPosition(win, position, 800);
        await waitForBoardSettled(win, position);
        
        // Wait an extra 200ms for visual animations to settle completely
        await delay(200);

        const state = await execute(win, `
            (() => {
                const bc = window.odysseyMode?.boardController;
                const director = bc?.director?.getState?.();
                return {
                    activeChapter: director?.activeChapter ?? 1
                };
            })();
        `);

        const chapterId = state.activeChapter || 1;
        const chapterName = CHAPTER_NAMES[chapterId] || `Chapter ${chapterId}`;
        
        chapterCounts[chapterId] = (chapterCounts[chapterId] || 0) + 1;
        const countStr = String(chapterCounts[chapterId]).padStart(2, '0');
        const filename = `${chapterName} - ${countStr}.png`;

        await capturePng(win, filename);
    }

    await writeFile(path.join(ARTIFACT_DIR, 'journey-console.log'), consoleLines.slice(-300).join('\n'), 'utf8');
    console.log('[capture] Journey capture completed successfully!');
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
    try {
        await run();
        app.quit();
    } catch (error) {
        console.error('[capture] FAILED:', error?.message || error);
        if (consoleLines.length) console.error(consoleLines.slice(-40).join('\n'));
        app.exit(1);
    }
});

app.on('window-all-closed', () => {
    app.quit();
});
