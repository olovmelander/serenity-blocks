import electron from 'electron';
import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;
const BASELINE_PARAMS = {
    goldenForestBaseline: '1',
    goldenForestSeed: '1234',
    goldenForestFixedDt: '16.666',
};
const SCENARIOS = [
    { name: 'default', params: {} },
    { name: 'force_webgl', params: { forceWebGL: '1' } },
    { name: 'no_post', params: { goldenForestNoPost: '1' } },
    { name: 'no_mrt', params: { goldenForestNoMRT: '1' } },
    { name: 'no_compute', params: { goldenForestNoCompute: '1' } },
];
const DEV_SERVER_PORT = 4173;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(
    ROOT,
    'artifacts',
    'golden-forest',
    'phase1',
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
            console.error('[Phase1Validation] Dev server exited unexpectedly with code:', code);
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

async function bootstrapGoldenForestScene(win) {
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
                await app.themeManager.switchTheme('golden-forest', true);
            } catch (error) {
                return { ok: false, reason: 'Failed to switch to golden-forest: ' + (error?.message || String(error)) };
            }

            const themeReady = await waitFor(
                () => {
                    const theme = window.themeManager?.activeTheme;
                    return window.themeManager?.activeThemeName === 'golden-forest'
                        && !!theme?.renderer
                        && !!theme?.scene
                        && !!theme?.camera;
                },
                120000,
            );

            if (!themeReady) {
                return { ok: false, reason: 'Golden Forest theme was not ready in time.' };
            }

            return { ok: true };
        })();
    `;

    return win.webContents.executeJavaScript(script, true);
}

async function readThemeState(win) {
    const script = `
        (() => {
            const theme = window.themeManager?.activeTheme;
            if (!theme) return null;

            const baseline = typeof theme.getBaselineReport === 'function'
                ? theme.getBaselineReport()
                : null;

            const renderInfo = theme.renderer?.info?.render || {};
            const memInfo = theme.renderer?.info?.memory || {};
            const perfMem = performance?.memory || null;

            return {
                activeThemeName: window.themeManager?.activeThemeName || null,
                backend: theme.isWebGPU ? 'WebGPU' : 'WebGL2',
                flags: {
                    forceWebGL: !!theme.flags?.forceWebGL,
                    forceWebGPU: !!theme.flags?.forceWebGPU,
                    noPost: !!theme.flags?.noPost,
                    noMRT: !!theme.flags?.noMRT,
                    noCompute: !!theme.flags?.noCompute,
                    baseline: !!theme.flags?.baseline,
                    usePost: !!theme.flags?.usePost,
                    useMRT: !!theme.flags?.useMRT,
                    useCompute: !!theme.flags?.useCompute,
                    useBloom: !!theme.flags?.useBloom,
                    seed: theme.flags?.seed ?? null,
                    fixedDtMs: theme.flags?.fixedDtMs ?? null,
                },
                capabilities: {
                    isWebGPU: !!theme.capabilities?.isWebGPU,
                    isWebGL2: !!theme.capabilities?.isWebGL2,
                    maxColorAttachments: theme.capabilities?.maxColorAttachments ?? null,
                    supportsMRT: !!theme.capabilities?.supportsMRT,
                    supportsPost: !!theme.capabilities?.supportsPost,
                    supportsCompute: !!theme.capabilities?.supportsCompute,
                },
                baseline,
                renderInfo: {
                    calls: renderInfo.calls ?? 0,
                    triangles: renderInfo.triangles ?? 0,
                    textures: memInfo.textures ?? 0,
                },
                jsHeapUsedMb: perfMem?.usedJSHeapSize
                    ? Number((perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(2))
                    : null,
            };
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
    let bootstrapResult = null;
    let state = null;
    let screenshotPath = null;
    let error = null;

    try {
        await win.loadURL(url);
        bootstrapResult = await bootstrapGoldenForestScene(win);
        if (!bootstrapResult?.ok) {
            throw new Error(bootstrapResult?.reason || 'Unknown bootstrap failure');
        }

        await delay(3000);
        state = await readThemeState(win);

        const image = await win.webContents.capturePage();
        screenshotPath = path.join(ARTIFACT_DIR, `${scenario.name}.png`);
        await writeFile(screenshotPath, image.toPNG());
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
    const sceneReadyLogged = consoleEntries.some((entry) => entry.message.includes('[GoldenForest] Scene ready'));
    const backendLogged = consoleEntries.find((entry) => entry.message.includes('[GoldenForest] Backend:'))?.message || null;
    const hasValidThemeState = state?.activeThemeName === 'golden-forest'
        && (state?.backend === 'WebGL2' || state?.backend === 'WebGPU');

    return {
        scenario: scenario.name,
        url,
        passed: !error && hasValidThemeState,
        sceneReadyLogged,
        backendLogged,
        warningCount: warnings.length,
        errorCount: errors.length,
        warnings,
        errors,
        state,
        screenshotPath: screenshotPath ? path.relative(ROOT, screenshotPath) : null,
        logPath: path.relative(ROOT, logPath),
        error,
    };
}

async function runSoak() {
    const win = createWindow();
    const consoleEntries = [];
    const samples = [];
    const durationMinutes = 10;
    const sampleIntervalSeconds = 30;
    const totalDurationMs = durationMinutes * 60 * 1000;
    const sampleIntervalMs = sampleIntervalSeconds * 1000;

    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleEntries.push({
            ts: Date.now(),
            level,
            message,
            line,
            sourceId,
        });
    });

    const url = makeScenarioUrl({});
    let startState = null;
    let endState = null;
    let error = null;
    let startScreenshot = null;
    let endScreenshot = null;

    try {
        await win.loadURL(url);
        const bootstrapResult = await bootstrapGoldenForestScene(win);
        if (!bootstrapResult?.ok) {
            throw new Error(bootstrapResult?.reason || 'Unknown bootstrap failure');
        }

        await delay(3000);
        startState = await readThemeState(win);

        const startImage = await win.webContents.capturePage();
        startScreenshot = path.join(ARTIFACT_DIR, 'soak-start.png');
        await writeFile(startScreenshot, startImage.toPNG());

        const startedAt = Date.now();
        while (Date.now() - startedAt <= totalDurationMs) {
            const state = await readThemeState(win);
            samples.push({
                ts: Date.now(),
                elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
                avgMs: state?.baseline?.avgMs ?? null,
                avgFps: state?.baseline?.avgFps ?? null,
                onePercentLowFps: state?.baseline?.onePercentLowFps ?? null,
                calls: state?.renderInfo?.calls ?? null,
                triangles: state?.renderInfo?.triangles ?? null,
                textures: state?.renderInfo?.textures ?? null,
                jsHeapUsedMb: state?.jsHeapUsedMb ?? null,
            });

            await delay(sampleIntervalMs);
        }

        endState = await readThemeState(win);
        const endImage = await win.webContents.capturePage();
        endScreenshot = path.join(ARTIFACT_DIR, 'soak-end.png');
        await writeFile(endScreenshot, endImage.toPNG());
    } catch (err) {
        error = err?.message || String(err);
    } finally {
        if (!win.isDestroyed()) {
            win.destroy();
        }
    }

    const logPath = path.join(ARTIFACT_DIR, 'soak.console.log');
    const logText = consoleEntries
        .map((entry) => `[${new Date(entry.ts).toISOString()}][L${entry.level}] ${entry.message}`)
        .join('\n');
    await writeFile(logPath, logText, 'utf8');

    const heapSamples = samples.map((sample) => sample.jsHeapUsedMb).filter((value) => Number.isFinite(value));
    const heapStart = heapSamples.length ? heapSamples[0] : null;
    const heapEnd = heapSamples.length ? heapSamples[heapSamples.length - 1] : null;
    const heapDelta = Number.isFinite(heapStart) && Number.isFinite(heapEnd)
        ? Number((heapEnd - heapStart).toFixed(2))
        : null;
    const memoryTrendStable = Number.isFinite(heapDelta)
        ? heapDelta <= Math.max(50, (heapStart || 0) * 0.2)
        : null;

    return {
        durationMinutes,
        sampleIntervalSeconds,
        startedAt: startState ? new Date(samples[0]?.ts || Date.now()).toISOString() : null,
        completed: !error,
        error,
        startState,
        endState,
        samples,
        sampleCount: samples.length,
        heapStartMb: heapStart,
        heapEndMb: heapEnd,
        heapDeltaMb: heapDelta,
        memoryTrendStable,
        startScreenshotPath: startScreenshot ? path.relative(ROOT, startScreenshot) : null,
        endScreenshotPath: endScreenshot ? path.relative(ROOT, endScreenshot) : null,
        logPath: path.relative(ROOT, logPath),
    };
}

function buildSummaryMarkdown(smokeResults, soakResult, jsonPath) {
    const smokeRows = smokeResults.map((result) => {
        const backend = result.state?.backend || 'unknown';
        const status = result.passed ? 'PASS' : 'FAIL';
        return `| ${result.scenario} | ${status} | ${backend} | ${result.warningCount} | ${result.errorCount} |`;
    }).join('\n');

    return [
        '# Golden Forest Phase 1 Validation Report',
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        `JSON artifact: \`${path.relative(ROOT, jsonPath)}\``,
        '',
        '## Smoke Matrix',
        '',
        '| Scenario | Result | Backend | Warnings | Errors |',
        '|---|---|---|---:|---:|',
        smokeRows,
        '',
        '## Soak Run (10 Minutes)',
        '',
        `- Completed: ${soakResult.completed}`,
        `- Samples: ${soakResult.sampleCount}`,
        `- Heap delta (MB): ${soakResult.heapDeltaMb ?? 'n/a'}`,
        `- Memory trend stable: ${soakResult.memoryTrendStable ?? 'n/a'}`,
        `- Start screenshot: \`${soakResult.startScreenshotPath || 'n/a'}\``,
        `- End screenshot: \`${soakResult.endScreenshotPath || 'n/a'}\``,
        '',
    ].join('\n');
}

async function runValidation() {
    await mkdir(ARTIFACT_DIR, { recursive: true });

    console.log('[Phase1Validation] Starting Vite dev server...');
    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_URL);
    console.log('[Phase1Validation] Dev server ready:', DEV_SERVER_URL);

    const smokeResults = [];
    for (const scenario of SCENARIOS) {
        console.log(`[Phase1Validation] Running smoke scenario: ${scenario.name}`);
        const result = await runSmokeScenario(scenario);
        smokeResults.push(result);
        console.log(
            `[Phase1Validation] Scenario ${scenario.name}: ${result.passed ? 'PASS' : 'FAIL'} `
            + `(warnings=${result.warningCount}, errors=${result.errorCount})`,
        );
    }

    console.log('[Phase1Validation] Running 10-minute soak...');
    const soakResult = await runSoak();
    console.log(
        '[Phase1Validation] Soak complete:',
        `completed=${soakResult.completed}`,
        `samples=${soakResult.sampleCount}`,
        `heapDeltaMb=${soakResult.heapDeltaMb}`,
    );

    const report = {
        generatedAt: new Date().toISOString(),
        artifactDir: path.relative(ROOT, ARTIFACT_DIR),
        smokeResults,
        soakResult,
    };

    const jsonPath = path.join(ARTIFACT_DIR, 'phase1-validation-report.json');
    await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    const markdownPath = path.join(ARTIFACT_DIR, 'PHASE1_VALIDATION_REPORT.md');
    await writeFile(markdownPath, buildSummaryMarkdown(smokeResults, soakResult, jsonPath), 'utf8');

    const smokePass = smokeResults.every((result) => result.passed);
    const soakPass = soakResult.completed === true;
    const overallPass = smokePass && soakPass;

    console.log('[Phase1Validation] Artifacts:', path.relative(ROOT, ARTIFACT_DIR));
    console.log(
        '[Phase1Validation] Overall:',
        overallPass ? 'PASS' : 'FAIL',
        `(smoke=${smokePass}, soak=${soakPass})`,
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
        console.error('[Phase1Validation] Fatal error:', error);
        if (devServerProcess && existsSync(ARTIFACT_DIR)) {
            const fatalPath = path.join(ARTIFACT_DIR, 'fatal-error.txt');
            await writeFile(fatalPath, String(error?.stack || error), 'utf8');
        }
        await stopDevServer();
        app.exit(1);
    }
}

app.whenReady().then(main);
