import electron from 'electron';
import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const ALL_THEMES = [
    'forest', 'himalayan-peak', 'ice-temple', 'moonlit-forest', 'wolfhour',
    'ocean', 'sunset', 'mountain', 'winter', 'fall', 'summer', 'tornado',
    'sakura-twilight', 'aurora', 'galaxy', 'aether-tides', 'rainy-window',
    'koi-pond', 'verdant-hills', 'cosmic-chimes', 'singing-bowl',
    'starlight', 'swedish-forest', 'geode', 'bioluminescence', 'shifting-sands',
    'misty-lake', 'waves', 'luminous-tides', 'fluid-dreams', 'crystal-cave',
    'moonlit-greenhouse', 'electric-dreams', 'nebula-flow', 'chromatic-impasto',
    'voltage-storm', 'lunara', 'solar-eclipse', 'moonrise-summit', 'black-hole',
    'supernova', 'cosmic-noir', 'chiral-gold', 'nimbus-veil', 'sky-children',
    'sky-children-v2', 'cinder-drift', 'pyrestorm', 'neon-dusk', 'neon-district',
    'synthwave-sunset', 'chromadelic-highway', 'stillwater', 'blood-moon',
    'astral-weave', 'stellar-velocity', 'stellar-drift',
];

// Parse CLI args: themes can be passed as arguments to only capture specific ones
// Usage: npx electron scripts/capture-theme-screenshots.mjs cosmic-chimes starlight fluid-dreams
const cliThemes = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const THEMES_TO_CAPTURE = cliThemes.length > 0 ? cliThemes : ALL_THEMES;
const FRESH_LOAD_PER_THEME = cliThemes.length > 0;

const DEV_SERVER_PORT = 4174;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const SETTLE_TIME_MS = 25_000;
const THEME_SWITCH_TIMEOUT_MS = 45_000;
const SCREENSHOT_DIR = path.join(ROOT, 'docs', 'theme-screenshots');

// GPU flags for proper rendering
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

let devServerProcess = null;
let devServerAlive = false;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms),
        ),
    ]);
}

async function waitForServer(url, timeoutMs = 120_000) {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url, { method: 'GET' });
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await delay(500);
    }
    throw new Error(`Timed out waiting for dev server: ${lastError?.message}`);
}

function startDevServer() {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? 'npx.cmd' : 'npx';
    const args = ['vite', '--host', '127.0.0.1', '--port', String(DEV_SERVER_PORT), '--strictPort'];

    const proc = spawn(command, args, {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
        shell: isWindows,
    });

    devServerAlive = true;
    const logChunks = [];
    proc.stdout.on('data', (chunk) => logChunks.push(String(chunk)));
    proc.stderr.on('data', (chunk) => logChunks.push(String(chunk)));
    proc.on('exit', (code) => {
        devServerAlive = false;
        if (code !== 0 && code !== null) {
            console.error('[ThemeCapture] Dev server exited with code:', code);
        }
    });
    proc._logChunks = logChunks;
    return proc;
}

async function stopDevServer() {
    if (!devServerProcess) return;
    const proc = devServerProcess;
    devServerProcess = null;
    devServerAlive = false;
    if (proc.killed) return;
    proc.kill('SIGTERM');
    await delay(800);
    if (!proc.killed) proc.kill('SIGKILL');
}

async function ensureDevServer() {
    // Quick health check to see if dev server is alive (either locally started or pre-existing)
    try {
        const resp = await fetch(DEV_SERVER_URL, { method: 'GET', signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
            devServerAlive = true;
            return;
        }
    } catch {}

    console.log('[ThemeCapture] Dev server is down, restarting...');
    await stopDevServer();
    await delay(1000);
    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_URL);
    console.log('[ThemeCapture] Dev server restarted');
}

function createWindow() {
    return new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
}

/**
 * Load the app URL and bootstrap serenity mode from scratch.
 * Used on first load and after recovering from a stuck theme.
 */
async function loadAndBootstrap(win, consoleEntries) {
    const url = `${DEV_SERVER_URL}/?skipIntro=1`;
    await win.loadURL(url);

    const script = `
        (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const waitFor = async (pred, timeoutMs = 60000) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    if (pred()) return true;
                    await sleep(200);
                }
                return false;
            };

            const ready = await waitFor(
                () => !!(window.serenityBlocks?.gameModeManager && window.serenityBlocks?.themeManager),
                120000,
            );
            if (!ready) return { ok: false, reason: 'Managers not ready in time' };

            const app = window.serenityBlocks;
            const currentMode = app.gameModeManager.getCurrentMode?.();
            if (!currentMode || !currentMode.isRunning) {
                try {
                    window.dispatchEvent(new CustomEvent('startGameWithMode', {
                        detail: { mode: 'serenity' },
                    }));
                } catch (e) {}

                const started = await waitFor(
                    () => !!(app.gameModeManager.getCurrentMode?.()?.isRunning),
                    30000,
                );

                if (!started) {
                    try {
                        if (app.gameModeManager.getCurrentModeId?.() !== 'serenity') {
                            await app.gameModeManager.activateMode('serenity');
                        }
                        const mode = app.gameModeManager.getCurrentMode?.();
                        if (!mode || !mode.isRunning) {
                            await app.gameModeManager.startCurrentMode();
                        }
                    } catch (e) {
                        return { ok: false, reason: 'Failed to start serenity mode: ' + e.message };
                    }
                }
            }

            await sleep(3000);
            return { ok: true };
        })();
    `;

    const result = await withTimeout(
        win.webContents.executeJavaScript(script, true),
        120_000,
        'bootstrap serenity mode',
    );
    return result;
}

/**
 * Switch theme entirely inside the browser. Uses a fire-and-forget approach:
 * calls switchTheme without awaiting it (to avoid hanging on WebGPU init),
 * then polls for the theme name to match.
 */
async function switchThemeAndWait(win, themeId) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            // Fire off the theme switch WITHOUT awaiting — this prevents hanging
            // on themes where renderer.init() never resolves
            const switchPromise = window.themeManager.switchTheme('${themeId}', true).catch(e => {
                console.error('[ThemeCapture] switchTheme error for ${themeId}:', e.message);
            });

            // Poll for the theme name to match (set early in switchTheme)
            const start = Date.now();
            while (Date.now() - start < 40000) {
                if (window.themeManager?.activeThemeName === '${themeId}') {
                    // Give the theme a moment to finish creating its scene
                    await sleep(2000);
                    return { ok: true, themeName: '${themeId}' };
                }
                await sleep(300);
            }

            return { ok: false, reason: 'Theme name never matched after 40s' };
        })();
    `;

    return withTimeout(
        win.webContents.executeJavaScript(script, true),
        THEME_SWITCH_TIMEOUT_MS,
        `switch to ${themeId}`,
    );
}

async function hideAllUI(win) {
    const script = `
        (() => {
            // Hide performance monitor
            if (window.perfMonitor) window.perfMonitor.hide();

            // Hide serenity hub
            const hubIcon = document.getElementById('serenity-hub-icon');
            if (hubIcon) hubIcon.style.display = 'none';
            const hubPanel = document.getElementById('serenity-hub-panel');
            if (hubPanel) hubPanel.style.display = 'none';
            const hubBackdrop = document.querySelector('.serenity-hub-backdrop');
            if (hubBackdrop) hubBackdrop.style.display = 'none';

            // Stop breathing indicator
            if (window.breathingIndicator) {
                try { window.breathingIndicator.stop(); } catch(e) {}
            }
            const breathEl = document.getElementById('enhanced-breathing-indicator');
            if (breathEl) breathEl.style.display = 'none';

            // Hide all game UI elements
            [
                'single-player-container', 'multiplayer-container', 'stats-panel',
                'next-pieces', 'game-controls', 'infinity-hud', 'odyssey-hud',
                'serenity-shortcuts-overlay', 'gamepad-hints-overlay', 'game-container',
                'demo-indicator', 'performance-overlay',
            ].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

            // Hide stats bar
            const statsBar = document.querySelector('.single-player-stats-bar');
            if (statsBar) statsBar.style.display = 'none';

            // Hide cursor
            document.body.style.cursor = 'none';

            // Hide any modal overlays
            document.querySelectorAll('.modal-overlay, .modal-backdrop').forEach(el => {
                el.style.display = 'none';
            });

            return true;
        })();
    `;
    return win.webContents.executeJavaScript(script, true);
}

async function main() {
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    // Check if a dev server is already running (e.g. started in WSL on UNC path)
    let alreadyRunning = false;
    try {
        const resp = await fetch(DEV_SERVER_URL, { method: 'GET', signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
            alreadyRunning = true;
            console.log('[ThemeCapture] Found already running dev server on port', DEV_SERVER_PORT);
        }
    } catch (e) {}

    if (!alreadyRunning) {
        console.log('[ThemeCapture] Starting Vite dev server on port', DEV_SERVER_PORT);
        devServerProcess = startDevServer();
        await waitForServer(DEV_SERVER_URL);
        console.log('[ThemeCapture] Dev server ready');
    } else {
        devServerAlive = true;
    }

    const win = createWindow();
    const consoleEntries = [];

    win.webContents.on('console-message', (_event, level, message) => {
        consoleEntries.push({ ts: Date.now(), level, message });
    });

    // Initial bootstrap
    console.log('[ThemeCapture] Loading app and bootstrapping serenity mode...');
    const bootstrap = await loadAndBootstrap(win, consoleEntries);
    if (!bootstrap?.ok) {
        console.error('[ThemeCapture] Bootstrap failed:', bootstrap?.reason);
        await stopDevServer();
        app.exit(1);
        return;
    }
    console.log('[ThemeCapture] Serenity mode active');

    let needsReload = false;
    const results = [];

    if (FRESH_LOAD_PER_THEME) {
        console.log(`[ThemeCapture] Running in single-theme mode for: ${THEMES_TO_CAPTURE.join(', ')}`);
    }

    for (let i = 0; i < THEMES_TO_CAPTURE.length; i++) {
        const themeId = THEMES_TO_CAPTURE[i];
        const progress = `[${i + 1}/${THEMES_TO_CAPTURE.length}]`;
        console.log(`${progress} Switching to: ${themeId}`);

        // Fresh load per theme when retrying specific themes, or recover from failure
        if (FRESH_LOAD_PER_THEME && i > 0) needsReload = true;
        if (needsReload) {
            console.log(`${progress} Reloading page to recover from previous failure...`);
            try {
                await ensureDevServer();
                const reboot = await loadAndBootstrap(win, consoleEntries);
                if (!reboot?.ok) {
                    console.error(`${progress} Reboot failed, skipping ${themeId}`);
                    results.push({ theme: themeId, passed: false, screenshot: null, error: 'Page reload failed' });
                    continue;
                }
                needsReload = false;
            } catch (err) {
                console.error(`${progress} Reboot crashed, skipping ${themeId}`);
                results.push({ theme: themeId, passed: false, screenshot: null, error: 'Page reload crashed: ' + err.message });
                continue;
            }
        }

        let error = null;
        let screenshotPath = null;

        try {
            const switchResult = await switchThemeAndWait(win, themeId);
            if (!switchResult?.ok) {
                throw new Error(switchResult?.reason || 'Theme switch failed');
            }

            // Hide all UI overlays
            await hideAllUI(win);

            // Wait for theme to fully render and settle
            console.log(`${progress} Waiting ${SETTLE_TIME_MS / 1000}s for ${themeId} to settle...`);
            await delay(SETTLE_TIME_MS);

            // Hide UI again in case anything reappeared
            await hideAllUI(win);
            await delay(500);

            // Capture screenshot
            const image = await win.webContents.capturePage();
            screenshotPath = path.join(SCREENSHOT_DIR, `${themeId}.png`);
            await writeFile(screenshotPath, image.toPNG());
            console.log(`${progress} Captured: ${themeId}.png`);

        } catch (err) {
            error = err?.message || String(err);
            console.error(`${progress} FAILED: ${themeId} - ${error}`);
            // Mark that we need a full page reload before the next theme
            needsReload = true;
        }

        results.push({
            theme: themeId,
            passed: !error,
            screenshot: screenshotPath ? path.relative(ROOT, screenshotPath) : null,
            error,
        });
    }

    // Write report
    const report = {
        generatedAt: new Date().toISOString(),
        totalThemes: THEMES_TO_CAPTURE.length,
        captured: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        settleTimeMs: SETTLE_TIME_MS,
        results,
    };

    const reportPath = path.join(SCREENSHOT_DIR, 'capture-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

    // Write console log
    const logPath = path.join(SCREENSHOT_DIR, 'capture.log');
    const logText = consoleEntries
        .map((e) => `[${new Date(e.ts).toISOString()}][L${e.level}] ${e.message}`)
        .join('\n');
    await writeFile(logPath, logText, 'utf8');

    console.log('\n[ThemeCapture] Done!');
    console.log(`  Captured: ${report.captured}/${report.totalThemes}`);
    console.log(`  Failed: ${report.failed}`);
    console.log(`  Output: ${path.relative(ROOT, SCREENSHOT_DIR)}/`);

    if (!win.isDestroyed()) win.destroy();
    await stopDevServer();
    app.exit(report.failed > 0 ? 2 : 0);
}

app.whenReady().then(main).catch((err) => {
    console.error('[ThemeCapture] Fatal error:', err);
    stopDevServer().then(() => app.exit(1));
});
