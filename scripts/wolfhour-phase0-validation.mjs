import electron from 'electron';
import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;
const BASELINE_PARAMS = {
    wolfhourBaseline: '1',
    wolfhourSeed: '1234',
    wolfhourFixedDt: '16.666',
    wolfhourPlayback: 'default',
};
const SCENARIOS = [
    { name: 'default', params: {} },
    { name: 'force_webgl', params: { forceWebGL: '1' } },
    { name: 'no_post', params: { wolfhourNoPost: '1' } },
    { name: 'no_mrt', params: { wolfhourNoMRT: '1' } },
    { name: 'no_compute', params: { wolfhourNoCompute: '1' } },
];
const DEV_SERVER_PORT = 4173;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(
    ROOT,
    'docs',
    'validation',
    'wolfhour',
    'phase0',
    TIMESTAMP,
);

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

let devServerProcess = null;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeScenarioUrl(params = {}) {
    const search = new URLSearchParams({ ...BASELINE_PARAMS, ...params });
    return `${DEV_SERVER_URL}/?${search.toString()}`;
}

async function waitForServer(url, timeoutMs = 120000) {
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

    throw new Error(`Timed out waiting for dev server at ${url}: ${lastError?.message || 'unknown error'}`);
}

function startDevServer() {
    const command = 'npm';
    const args = [
        'run',
        'dev',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(DEV_SERVER_PORT),
        '--strictPort',
    ];

    const proc = spawn(command, args, {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            FORCE_COLOR: '0',
        },
    });

    const logChunks = [];
    proc.stdout.on('data', (chunk) => {
        logChunks.push(String(chunk));
    });
    proc.stderr.on('data', (chunk) => {
        logChunks.push(String(chunk));
    });

    proc.on('exit', (code) => {
        if (code !== 0) {
            console.error('[Phase0Validation] Dev server exited unexpectedly with code:', code);
        }
    });

    proc._logChunks = logChunks;
    return proc;
}

async function stopDevServer() {
    if (!devServerProcess) return;

    const proc = devServerProcess;
    devServerProcess = null;

    if (proc.killed) return;

    proc.kill('SIGTERM');
    await delay(800);

    if (!proc.killed) {
        proc.kill('SIGKILL');
    }

    const devLogPath = path.join(ARTIFACT_DIR, 'dev-server.log');
    const logText = Array.isArray(proc._logChunks) ? proc._logChunks.join('') : '';
    await writeFile(devLogPath, logText, 'utf8');
}

function createWindow() {
    return new BrowserWindow({
        width: 1600,
        height: 900,
        show: false,
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
}

async function bootstrapWolfhourScene(win) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 60000) => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < timeoutMs) {
                    if (predicate()) return true;
                    await sleep(100);
                }
                return false;
            };

            const managersReady = await waitFor(
                () => !!(window.serenityBlocks?.gameModeManager && window.serenityBlocks?.themeManager),
                120000,
            );
            if (!managersReady) {
                return { ok: false, reason: 'Managers were not ready in time.' };
            }

            const app = window.serenityBlocks;
            const currentMode = app.gameModeManager.getCurrentMode?.();
            if (!currentMode || !currentMode.isRunning) {
                try {
                    window.dispatchEvent(new CustomEvent('startGameWithMode', {
                        detail: { mode: 'serenity' },
                    }));
                } catch (error) {
                    // Ignore dispatch issues and fall back to direct activation.
                }

                const startedViaEvent = await waitFor(
                    () => !!(app.gameModeManager.getCurrentMode?.()?.isRunning),
                    30000,
                );

                if (!startedViaEvent) {
                    try {
                        if (app.gameModeManager.getCurrentModeId?.() !== 'serenity') {
                            await app.gameModeManager.activateMode('serenity');
                        }
                        const modeAfterActivate = app.gameModeManager.getCurrentMode?.();
                        if (!modeAfterActivate || !modeAfterActivate.isRunning) {
                            await app.gameModeManager.startCurrentMode();
                        }
                    } catch (error) {
                        return { ok: false, reason: 'Failed to activate/start serenity mode: ' + (error?.message || String(error)) };
                    }
                }
            }

            try {
                await app.themeManager.switchTheme('wolfhour', true);
            } catch (error) {
                return { ok: false, reason: 'Failed to switch to wolfhour: ' + (error?.message || String(error)) };
            }

            const themeReady = await waitFor(
                () => {
                    const theme = window.themeManager?.activeTheme;
                    return window.themeManager?.activeThemeName === 'wolfhour'
                        && !!theme?.renderer
                        && !!theme?.scene
                        && !!theme?.camera;
                },
                120000,
            );

            if (!themeReady) {
                return { ok: false, reason: 'Wolfhour theme was not ready in time.' };
            }

            return { ok: true };
        })();
    `;

    return win.webContents.executeJavaScript(script, true);
}

async function triggerPlayback(win) {
    const script = `
        (async () => {
            const theme = window.themeManager?.activeTheme;
            if (!theme || typeof theme.playBaselineSequence !== 'function') return false;
            theme.playBaselineSequence('default', { loops: 1, stepMs: 320 });
            return true;
        })();
    `;
    return win.webContents.executeJavaScript(script, true);
}

async function runSmokeScenario(scenario) {
    const win = createWindow();
    const consoleEntries = [];

    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleEntries.push({
            ts: Date.now(),
            level,
            message,
            line,
            sourceId,
        });
    });

    const url = makeScenarioUrl(scenario.params);
    let error = null;
    let screenshotIdlePath = null;
    let screenshotPlaybackPath = null;

    try {
        await win.loadURL(url);
        const bootstrapResult = await bootstrapWolfhourScene(win);
        if (!bootstrapResult?.ok) {
            throw new Error(bootstrapResult?.reason || 'Unknown bootstrap failure');
        }

        await delay(3000); // Wait for scene to settle in default idle state

        const imageIdle = await win.webContents.capturePage();
        screenshotIdlePath = path.join(ARTIFACT_DIR, `${scenario.name}_idle.png`);
        await writeFile(screenshotIdlePath, imageIdle.toPNG());

        console.log(`[Phase0Validation] Scenario ${scenario.name}: Triggering playback...`);
        const triggered = await triggerPlayback(win);
        if (!triggered) {
            throw new Error('Playback sequence could not be triggered. Check if playBaselineSequence exists on theme.');
        }

        // Wait mid sequence to capture a frame full of effects
        await delay(1200);

        const imagePlayback = await win.webContents.capturePage();
        screenshotPlaybackPath = path.join(ARTIFACT_DIR, `${scenario.name}_playback.png`);
        await writeFile(screenshotPlaybackPath, imagePlayback.toPNG());

        // Wait to finish sequence before next test
        await delay(2000);

    } catch (err) {
        error = err?.message || String(err);
    } finally {
        if (!win.isDestroyed()) {
            win.destroy();
        }
    }

    const logPath = path.join(ARTIFACT_DIR, `${scenario.name}.console.log`);
    const logText = consoleEntries
        .map((entry) => `[${new Date(entry.ts).toISOString()}][L${entry.level}] ${entry.message}`)
        .join('\n');
    await writeFile(logPath, logText, 'utf8');

    const warnings = consoleEntries.filter((entry) => entry.level >= 2).map((entry) => entry.message);
    const errors = consoleEntries.filter((entry) => entry.level >= 3).map((entry) => entry.message);

    return {
        scenario: scenario.name,
        url,
        passed: !error,
        warningCount: warnings.length,
        errorCount: errors.length,
        warnings,
        errors,
        screenshotIdlePath: screenshotIdlePath ? path.relative(ROOT, screenshotIdlePath) : null,
        screenshotPlaybackPath: screenshotPlaybackPath ? path.relative(ROOT, screenshotPlaybackPath) : null,
        logPath: path.relative(ROOT, logPath),
        error,
    };
}

async function runValidation() {
    await mkdir(ARTIFACT_DIR, { recursive: true });

    console.log('[Phase0Validation] Starting Vite dev server...');
    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_URL);
    console.log('[Phase0Validation] Dev server ready:', DEV_SERVER_URL);

    const smokeResults = [];
    for (const scenario of SCENARIOS) {
        console.log(`[Phase0Validation] Running scenario: ${scenario.name}`);
        const result = await runSmokeScenario(scenario);
        smokeResults.push(result);
        console.log(
            `[Phase0Validation] Scenario ${scenario.name}: ${result.passed ? 'PASS' : 'FAIL'} `
            + `(warnings=${result.warningCount}, errors=${result.errorCount})`,
        );
    }

    const report = {
        generatedAt: new Date().toISOString(),
        artifactDir: path.relative(ROOT, ARTIFACT_DIR),
        smokeResults,
    };

    const jsonPath = path.join(ARTIFACT_DIR, 'phase0-validation-report.json');
    await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    const overallPass = smokeResults.every((result) => result.passed);

    console.log('[Phase0Validation] Artifacts:', path.relative(ROOT, ARTIFACT_DIR));
    console.log(
        '[Phase0Validation] Overall:',
        overallPass ? 'PASS' : 'FAIL'
    );

    return {
        report,
        overallPass,
    };
}

async function main() {
    try {
        const { overallPass } = await runValidation();
        await stopDevServer();
        app.exit(overallPass ? 0 : 2);
    } catch (error) {
        console.error('[Phase0Validation] Fatal error:', error);
        if (devServerProcess && existsSync(ARTIFACT_DIR)) {
            const fatalPath = path.join(ARTIFACT_DIR, 'fatal-error.txt');
            await writeFile(fatalPath, String(error?.stack || error), 'utf8');
        }
        await stopDevServer();
        app.exit(1);
    }
}

app.whenReady().then(main);
