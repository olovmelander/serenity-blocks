/**
 * Odyssey board capture harness.
 *
 * Usage:
 *   npm run capture:odyssey
 *   ODYSSEY_CAPTURE_MODE=positions npm run capture:odyssey
 *   ODYSSEY_CAPTURE_MODE=seams npm run capture:odyssey
 *
 * Environment:
 *   ODYSSEY_CAPTURE_FLAGS       URL query flags (default: skipIntro=1&odysseyAAA=1)
 *   ODYSSEY_CAPTURE_VARIANT     output subfolder (default: cinematic)
 *   ODYSSEY_CAPTURE_MODE        chapters | positions | seams | climb
 *   ODYSSEY_CAPTURE_CHAPTERS    comma-separated chapter ids
 *   ODYSSEY_CAPTURE_POSITIONS   comma-separated normalized positions
 *   ODYSSEY_CAPTURE_PORT        dev server port
 */

import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const DEV_SERVER_PORT = Number(process.env.ODYSSEY_CAPTURE_PORT || process.env.AAA_PORT || 4177);
const DEV_SERVER_BASE_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const URL_FLAGS = process.env.ODYSSEY_CAPTURE_FLAGS
    || process.env.AAA_FLAGS
    || 'skipIntro=1&odysseyAAA=1';
const VARIANT = process.env.ODYSSEY_CAPTURE_VARIANT || process.env.AAA_VARIANT || 'cinematic';
const MODE = process.env.ODYSSEY_CAPTURE_MODE || process.env.AAA_MODE || 'chapters';
const DEV_SERVER_URL = `${DEV_SERVER_BASE_URL}/?${URL_FLAGS}`;
const TARGET_CHAPTERS = parseNumberList(process.env.ODYSSEY_CAPTURE_CHAPTERS || process.env.AAA_CHAPTERS || '1,2,3,4,5,6,7,8');
const TARGET_POSITIONS = parseNumberList(
    process.env.ODYSSEY_CAPTURE_POSITIONS
    || '0,0.046,0.093,0.148,0.204,0.278,0.352,0.426,0.5,0.574,0.648,0.731,0.815,0.879,0.944,0.972,1',
);
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'aaa-board', VARIANT);

let devServerProcess = null;
const consoleLines = [];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseNumberList(value) {
    return String(value || '')
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry));
}

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // Keep polling until Vite is listening.
        }
        await delay(400);
    }
    throw new Error(`Timed out waiting for dev server: ${url}`);
}

function startDevServer() {
    const proc = spawn(
        'npm',
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_SERVER_PORT), '--strictPort'],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } },
    );

    proc.stdout.on('data', (chunk) => consoleLines.push(String(chunk)));
    proc.stderr.on('data', (chunk) => consoleLines.push(String(chunk)));
    return proc;
}

async function stopDevServer() {
    if (!devServerProcess) return;
    const proc = devServerProcess;
    devServerProcess = null;
    if (!proc.killed) {
        proc.kill('SIGTERM');
        await delay(800);
        if (!proc.killed) proc.kill('SIGKILL');
    }
}

function createWindow() {
    return new BrowserWindow({
        width: 1920,
        height: 1080,
        show: process.env.ODYSSEY_CAPTURE_SHOW_WINDOW === '1',
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
            await sleep(350);

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

async function panToPosition(win, position, duration = 2200) {
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

async function capturePng(win, filename, metrics = {}) {
    const image = await win.webContents.capturePage();
    await writeFile(path.join(ARTIFACT_DIR, filename), image.toPNG());
    await writeFile(
        path.join(ARTIFACT_DIR, filename.replace(/\\.png$/, '.json')),
        JSON.stringify(metrics, null, 2),
        'utf8',
    );
    console.log(`[capture] wrote ${VARIANT}/${filename}`);
}

async function capturePosition(win, position, label, duration = 2200) {
    await panToPosition(win, position, duration);
    await waitForBoardSettled(win, position);
    const metrics = await execute(win, `
        (() => {
            const bc = window.odysseyMode?.boardController;
            const cc = bc?.cameraController;
            const director = bc?.director?.getState?.();
            return {
                requestedPosition: ${position},
                currentPosition: cc?.getCurrentPosition?.() ?? null,
                fov: bc?.camera?.fov ?? null,
                followDistance: cc?.directorCamera?.followDistance ?? null,
                activeChapter: director?.activeChapter ?? null,
                boundaryId: director?.boundaryId ?? null,
                seamProgress: director?.seamProgress ?? null,
                seamPhase: director?.seamPhase ?? null,
            };
        })();
    `);
    await capturePng(win, `${label}.png`, metrics);
}

async function captureChapters(win, chapterPositions) {
    for (const chapterId of TARGET_CHAPTERS) {
        const position = chapterPositions[chapterId - 1];
        if (!Number.isFinite(position)) continue;
        await capturePosition(win, position, `chapter-${chapterId}-start`);
    }
}

async function capturePositions(win) {
    for (const position of TARGET_POSITIONS) {
        const label = `position-${String(position.toFixed(3)).replace('.', '-')}`;
        await capturePosition(win, position, label);
    }
}

async function captureSeams(win, chapterPositions) {
    const offsetsMs = parseNumberList(process.env.ODYSSEY_CAPTURE_SEAM_MS || '0,300,600,850,1200');
    for (let chapterId = 1; chapterId < chapterPositions.length - 1; chapterId += 1) {
        const boundary = chapterPositions[chapterId];
        if (!Number.isFinite(boundary)) continue;
        const start = Math.max(0, boundary - 0.03);
        const end = Math.min(1, boundary + 0.03);
        await panToPosition(win, start, 1);
        await waitForBoardSettled(win, start);

        const crossing = panToPosition(win, end, 3000);
        const startedAt = Date.now();
        for (const atMs of offsetsMs) {
            const waitMs = Math.max(0, startedAt + atMs - Date.now());
            if (waitMs > 0) await delay(waitMs);
            const metrics = await execute(win, `
                (() => {
                    const bc = window.odysseyMode?.boardController;
                    const director = bc?.director?.getState?.();
                    return {
                        boundary: '${chapterId}-${chapterId + 1}',
                        atMs: ${atMs},
                        currentPosition: bc?.cameraController?.getCurrentPosition?.() ?? null,
                        seamProgress: director?.seamProgress ?? null,
                        seamPhase: director?.seamPhase ?? null,
                        boundaryId: director?.boundaryId ?? null,
                    };
                })();
            `);
            await capturePng(win, `seam-${chapterId}-${chapterId + 1}-${atMs}ms.png`, metrics);
        }
        await crossing.catch(() => false);
    }
}

async function captureClimb(win) {
    await panToPosition(win, 0, 1);
    await waitForBoardSettled(win, 0);
    const crossing = panToPosition(win, 1, 30000);
    for (let index = 0; index <= 60; index += 1) {
        await delay(index === 0 ? 0 : 500);
        const position = index / 60;
        await capturePng(win, `climb-${String(index).padStart(2, '0')}.png`, { approximatePosition: position });
    }
    await crossing.catch(() => false);
}

async function run() {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    // Reuse an already-running dev server (e.g. `npm run dev` on 5173) when reachable;
    // only spawn our own otherwise (avoids a Windows `spawn('npm')` startup failure).
    let serverAlreadyUp = false;
    try { serverAlreadyUp = (await fetch(DEV_SERVER_BASE_URL)).ok; } catch { serverAlreadyUp = false; }
    if (serverAlreadyUp) {
        console.log(`[capture] using existing dev server at ${DEV_SERVER_BASE_URL}`);
    } else {
        devServerProcess = startDevServer();
    }
    await waitForServer(DEV_SERVER_BASE_URL);

    const win = createWindow();
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleLines.push(`[renderer:${level}] ${sourceId}:${line} ${message}`);
    });

    await win.loadURL(DEV_SERVER_URL);
    const boot = await bootstrapOdyssey(win);
    if (!boot?.ok) throw new Error(`Bootstrap failed: ${boot?.reason}`);
    console.log(`[capture] variant=${VARIANT} mode=${MODE} aaaPostActive=${boot.aaaPost}`);

    if (MODE === 'positions') {
        await capturePositions(win);
    } else if (MODE === 'seams') {
        await captureSeams(win, boot.chapterPositions || []);
    } else if (MODE === 'climb') {
        await captureClimb(win);
    } else {
        await captureChapters(win, boot.chapterPositions || []);
    }

    await writeFile(path.join(ARTIFACT_DIR, 'console.log'), consoleLines.slice(-300).join('\n'), 'utf8');
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(async () => {
    try {
        await run();
        await stopDevServer();
        app.quit();
    } catch (error) {
        console.error('[capture] FAILED:', error?.message || error);
        if (consoleLines.length) console.error(consoleLines.slice(-40).join('\n'));
        await stopDevServer();
        app.exit(1);
    }
});

app.on('window-all-closed', () => {
    stopDevServer().finally(() => app.quit());
});
