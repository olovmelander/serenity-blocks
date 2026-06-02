/**
 * Odyssey AAA board capture — screenshots the level-select board at several
 * chapters, with or without ?odysseyAAA=1, so the P1 WebGL post pipeline
 * (exposure → ACES → grade) can be visually verified and compared.
 *
 * Usage:
 *   AAA_FLAGS="skipIntro=1&odysseyAAA=1" AAA_VARIANT=aaa     npx electron scripts/odyssey-aaa-board-capture.mjs
 *   AAA_FLAGS="skipIntro=1"              AAA_VARIANT=baseline npx electron scripts/odyssey-aaa-board-capture.mjs
 *
 * Artifacts: artifacts/odyssey/aaa-board/<variant>/chapter-<n>.png
 */

import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const DEV_SERVER_PORT = Number(process.env.AAA_PORT || 4177);
const DEV_SERVER_BASE_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const URL_FLAGS = process.env.AAA_FLAGS || 'skipIntro=1';
const VARIANT = process.env.AAA_VARIANT || 'aaa';
const DEV_SERVER_URL = `${DEV_SERVER_BASE_URL}/?${URL_FLAGS}`;
const TARGET_CHAPTERS = (process.env.AAA_CHAPTERS || '1,3,6,8').split(',').map((n) => Number(n.trim()));
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'aaa-board', VARIANT);

let devServerProcess = null;
const consoleLines = [];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // ignore
        }
        await delay(400);
    }
    throw new Error(`Timed out waiting for dev server: ${url}`);
}

function startDevServer() {
    return spawn(
        'npm',
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_SERVER_PORT), '--strictPort'],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } },
    );
}

function createWindow() {
    return new BrowserWindow({
        width: 1600,
        height: 900,
        show: false,
        webPreferences: { offscreen: false, backgroundThrottling: false },
    });
}

async function bootstrapOdyssey(win) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const waitFor = async (predicate, timeoutMs = 120000) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
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
            } catch (e) {
                return { ok: false, reason: 'activate failed: ' + (e?.message || e) };
            }
            if (!await waitFor(() => !!window.odysseyMode?.boardController?.isActive)) {
                return { ok: false, reason: 'board not active' };
            }

            // Dismiss the mode-select / start modal + any open overlay so the
            // 3D board (path + level orbs) is what gets captured.
            const hide = (sel) => document.querySelectorAll(sel).forEach((el) => {
                el.style.setProperty('display', 'none', 'important');
            });
            hide('#start-modal');
            hide('.modal-overlay');
            hide('#main-menu, .main-menu-screen, #menu-screen');
            await sleep(300);
            return { ok: true, aaaPost: !!window.odysseyMode.boardController.aaaPostActive };
        })();
    `;
    return win.webContents.executeJavaScript(script, true);
}

async function panToChapter(win, chapterId) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const bc = window.odysseyMode?.boardController;
            if (!bc) return false;
            try { await bc.panToChapter(${chapterId}, 1200); } catch { /* ignore */ }
            await sleep(400);
            return true;
        })();
    `;
    return win.webContents.executeJavaScript(script, true);
}

async function run() {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_BASE_URL);

    const win = createWindow();
    win.webContents.on('console-message', (_e, level, message) => {
        consoleLines.push(`[r:${level}] ${message}`);
    });

    await win.loadURL(DEV_SERVER_URL);
    const boot = await bootstrapOdyssey(win);
    if (!boot?.ok) throw new Error(`Bootstrap failed: ${boot?.reason}`);
    console.log(`[capture] variant=${VARIANT} aaaPostActive=${boot.aaaPost}`);

    await delay(1500); // let chapter 1 settle

    const results = [];
    for (const chapterId of TARGET_CHAPTERS) {
        await panToChapter(win, chapterId);
        await delay(1700);
        const image = await win.webContents.capturePage();
        const filename = `chapter-${chapterId}.png`;
        await writeFile(path.join(ARTIFACT_DIR, filename), image.toPNG());
        results.push(filename);
        console.log(`[capture] wrote ${VARIANT}/${filename}`);
    }

    await writeFile(
        path.join(ARTIFACT_DIR, 'console.log'),
        consoleLines.slice(-200).join('\n'),
    );
    console.log(`[capture] done: ${results.length} frames → ${ARTIFACT_DIR}`);
}

app.commandLine.appendSwitch('enable-unsafe-webgpu');
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
    } finally {
        if (devServerProcess) {
            try { devServerProcess.kill('SIGTERM'); } catch { /* ignore */ }
        }
    }
});

app.on('window-all-closed', () => {
    if (devServerProcess) {
        try { devServerProcess.kill('SIGTERM'); } catch { /* ignore */ }
    }
    app.quit();
});
