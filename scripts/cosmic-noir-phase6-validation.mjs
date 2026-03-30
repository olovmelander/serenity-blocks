import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const DEV_SERVER_PORT = 4174;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(
    ROOT,
    'artifacts',
    'cosmic-noir',
    'phase6',
    TIMESTAMP,
);

const SCENARIOS = [
    {
        name: 'webgpu_high',
        params: {
            cosmicNoirBaseline: '1',
            cosmicNoirSeed: '12345',
        },
    },
    {
        name: 'webgpu_high_no_compute',
        params: {
            cosmicNoirBaseline: '1',
            cosmicNoirSeed: '12345',
            cosmicNoirNoCompute: '1',
        },
    },
    {
        name: 'webgl_high_force_webgl',
        params: {
            cosmicNoirBaseline: '1',
            cosmicNoirSeed: '12345',
            forceWebGL: '1',
        },
    },
];

const CAPTURE_CONFIG = {
    idleMs: parseDuration(process.env.COSMIC_NOIR_IDLE_MS, 15000),
    combatMs: parseDuration(process.env.COSMIC_NOIR_COMBAT_MS, 15000),
    soakMs: parseDuration(process.env.COSMIC_NOIR_SOAK_MS, 600000),
    runSoak: process.env.COSMIC_NOIR_SKIP_SOAK !== '1',
    comboEveryMs: parseDuration(process.env.COSMIC_NOIR_COMBO_EVERY_MS, 380),
    comboCount: parsePositiveInt(process.env.COSMIC_NOIR_COMBO_COUNT, 8),
    lineCount: parsePositiveInt(process.env.COSMIC_NOIR_LINE_COUNT, 4),
};

const PHASE6_BUDGETS = {
    webgpuP95BudgetMs: 16.7,
    drawCallReductionTarget: 0.7,
    webglRegressionLimit: 0.05,
    soakMemoryGrowthLimit: 0.1,
};

const SHADER_FAILURE_PATTERNS = [
    {
        id: 'wgsl_parse_error',
        label: 'THREE.Error while parsing WGSL',
        pattern: 'THREE.Error while parsing WGSL',
    },
    {
        id: 'invalid_shader_module',
        label: 'Invalid ShaderModule',
        pattern: 'Invalid ShaderModule',
    },
    {
        id: 'invalid_render_pipeline',
        label: 'Invalid RenderPipeline',
        pattern: 'Invalid RenderPipeline',
    },
    {
        id: 'invalid_command_buffer',
        label: 'Invalid CommandBuffer',
        pattern: 'Invalid CommandBuffer',
    },
    {
        id: 'webgpu_uncaptured_error',
        label: 'WebGPU uncaptured error',
        pattern: '[GPUResilience] WebGPU uncaptured error',
    },
];

const WEBGL_REFERENCE_PATH = process.env.COSMIC_NOIR_WEBGL_REFERENCE || null;

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

let devServerProcess = null;

function parseDuration(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeConsoleEntry(entry) {
    return {
        ts: new Date(entry.ts).toISOString(),
        level: entry.level,
        message: entry.message,
        line: entry.line,
        sourceId: entry.sourceId,
    };
}

function buildConsoleLog(entries) {
    return entries
        .map((entry) => `[${new Date(entry.ts).toISOString()}][L${entry.level}] ${entry.message}`)
        .join('\n');
}

function summarizeConsoleEntries(entries) {
    const warningEntries = entries.filter((entry) => entry.level >= 2);
    const errorEntries = entries.filter((entry) => entry.level >= 3);
    const shaderFailures = SHADER_FAILURE_PATTERNS.map((rule) => {
        const matches = entries
            .filter((entry) => entry.message.includes(rule.pattern))
            .map(serializeConsoleEntry);

        return {
            id: rule.id,
            label: rule.label,
            count: matches.length,
            samples: matches.slice(0, 5),
        };
    }).filter((entry) => entry.count > 0);

    return {
        entryCount: entries.length,
        warningCount: warningEntries.length,
        errorCount: errorEntries.length,
        shaderFailureCount: shaderFailures.reduce((sum, entry) => sum + entry.count, 0),
        shaderFailureTypes: shaderFailures.map((entry) => entry.id),
        shaderFailures,
        warningSamples: warningEntries.slice(0, 10).map(serializeConsoleEntry),
        errorSamples: errorEntries.slice(0, 10).map(serializeConsoleEntry),
    };
}

function makeScenarioUrl(params = {}) {
    const search = new URLSearchParams(params);
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
    const proc = spawn(
        'npm',
        [
            'run',
            'dev',
            '--',
            '--host',
            '127.0.0.1',
            '--port',
            String(DEV_SERVER_PORT),
            '--strictPort',
        ],
        {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                FORCE_COLOR: '0',
            },
        },
    );

    const logChunks = [];
    proc.stdout.on('data', (chunk) => {
        logChunks.push(String(chunk));
    });
    proc.stderr.on('data', (chunk) => {
        logChunks.push(String(chunk));
    });

    proc._logChunks = logChunks;
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

function executeJavaScriptWithTimeout(win, script, timeoutMs, label) {
    return Promise.race([
        win.webContents.executeJavaScript(script, true),
        new Promise((_, reject) => {
            setTimeout(
                () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
                timeoutMs,
            );
        }),
    ]);
}

async function bootstrapCosmicNoirScene(win) {
    const script = `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 120000) => {
                const start = Date.now();
                while (Date.now() - start < timeoutMs) {
                    if (predicate()) return true;
                    await sleep(100);
                }
                return false;
            };
            const withTimeout = async (promise, timeoutMs, label) => Promise.race([
                promise,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(label + ' timed out')), timeoutMs);
                }),
            ]);

            const managersReady = await waitFor(
                () => !!(window.serenityBlocks?.gameModeManager && window.serenityBlocks?.themeManager),
                120000,
            );
            if (!managersReady) {
                return { ok: false, reason: 'Managers not ready in time.' };
            }

            const app = window.serenityBlocks;
            const currentMode = app.gameModeManager.getCurrentMode?.();
            if (!currentMode || !currentMode.isRunning) {
                try {
                    window.dispatchEvent(new CustomEvent('startGameWithMode', {
                        detail: { mode: 'serenity' },
                    }));
                } catch (error) {
                    // Ignore and fall back.
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
                        return {
                            ok: false,
                            reason: 'Failed to activate serenity mode: ' + (error?.message || String(error)),
                        };
                    }
                }
            }

            try {
                await withTimeout(
                    app.themeManager.switchTheme('cosmic-noir', true),
                    45000,
                    'switchTheme(cosmic-noir)',
                );
            } catch (error) {
                return {
                    ok: false,
                    reason: 'Failed to switch to cosmic-noir: ' + (error?.message || String(error)),
                };
            }

            const themeReady = await waitFor(
                () => {
                    const theme = window.themeManager?.activeTheme;
                    return window.themeManager?.activeThemeName === 'cosmic-noir'
                        && !!theme?.renderer
                        && !!theme?.scene
                        && !!theme?.camera;
                },
                120000,
            );
            if (!themeReady) {
                return { ok: false, reason: 'Cosmic Noir did not become ready in time.' };
            }

            return { ok: true };
        })();
    `;

    return executeJavaScriptWithTimeout(win, script, 60000, 'bootstrapCosmicNoirScene');
}

async function runTimedCapture(win, options = {}) {
    const payload = {
        mode: options.mode || 'idle',
        durationMs: parseDuration(options.durationMs, 10000),
        comboEveryMs: parseDuration(options.comboEveryMs, 380),
        comboCount: parsePositiveInt(options.comboCount, 8),
        lineCount: parsePositiveInt(options.lineCount, 4),
    };

    const script = `
        (async (payload) => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const theme = window.themeManager?.activeTheme;
            if (!theme) {
                return { ok: false, reason: 'Theme is not active.' };
            }
            if (typeof theme.resetBaselineCapture !== 'function' || typeof theme.getBaselineReport !== 'function') {
                return { ok: false, reason: 'Baseline helpers are unavailable on theme.' };
            }

            window.settings = window.settings || {};
            window.settings.backgroundComboEffects = true;

            theme.resetBaselineCapture();
            const startedAt = performance.now();
            let nextComboAt = startedAt + payload.comboEveryMs;
            let comboTriggers = 0;

            while (performance.now() - startedAt < payload.durationMs) {
                if (payload.mode === 'combat' && performance.now() >= nextComboAt) {
                    try {
                        theme.onLineClear?.(payload.lineCount, payload.comboCount);
                        comboTriggers += 1;
                    } catch (error) {
                        return {
                            ok: false,
                            reason: 'Failed while triggering combo bursts: ' + (error?.message || String(error)),
                        };
                    }
                    nextComboAt += payload.comboEveryMs;
                }
                await sleep(40);
            }

            const report = theme.getBaselineReport();
            const samples = window.cosmicNoirBaseline?.getSamples?.() || { frames: [], render: [] };

            const computeTrend = (renderSamples) => {
                const count = renderSamples.length;
                if (!count) return null;
                const windowSize = Math.max(20, Math.floor(count * 0.1));
                const head = renderSamples.slice(0, windowSize);
                const tail = renderSamples.slice(Math.max(0, count - windowSize));
                const avg = (arr, key) => arr.reduce((sum, sample) => {
                    const value = Number(sample?.[key]);
                    return sum + (Number.isFinite(value) ? value : 0);
                }, 0) / Math.max(1, arr.length);
                const pct = (start, end) => {
                    if (!Number.isFinite(start) || start <= 0) return null;
                    if (!Number.isFinite(end)) return null;
                    return (end - start) / start;
                };

                const startTextures = avg(head, 'textures');
                const endTextures = avg(tail, 'textures');
                const startGeometries = avg(head, 'geometries');
                const endGeometries = avg(tail, 'geometries');

                return {
                    sampleCount: count,
                    windowSize,
                    start: {
                        avgDrawCalls: avg(head, 'calls'),
                        avgTriangles: avg(head, 'triangles'),
                        avgPoints: avg(head, 'points'),
                        avgTextures: startTextures,
                        avgGeometries: startGeometries,
                    },
                    end: {
                        avgDrawCalls: avg(tail, 'calls'),
                        avgTriangles: avg(tail, 'triangles'),
                        avgPoints: avg(tail, 'points'),
                        avgTextures: endTextures,
                        avgGeometries: endGeometries,
                    },
                    growth: {
                        texturesPct: pct(startTextures, endTextures),
                        geometriesPct: pct(startGeometries, endGeometries),
                    },
                };
            };

            return {
                ok: true,
                mode: payload.mode,
                durationMs: payload.durationMs,
                comboTriggers,
                report,
                trend: computeTrend(samples.render || []),
                sampleCounts: {
                    frameSamples: (samples.frames || []).length,
                    renderSamples: (samples.render || []).length,
                },
            };
        })(${JSON.stringify(payload)});
    `;

    return executeJavaScriptWithTimeout(
        win,
        script,
        payload.durationMs + 30000,
        `runTimedCapture(${payload.mode})`,
    );
}

async function collectScenario(win, scenario, consoleEntries) {
    const scenarioDir = path.join(ARTIFACT_DIR, scenario.name);
    await mkdir(scenarioDir, { recursive: true });

    const url = makeScenarioUrl(scenario.params);
    const consoleStartIndex = consoleEntries.length;
    let idle = null;
    let combat = null;
    let soak = null;
    let error = null;

    try {
        await win.loadURL(url);
        const boot = await bootstrapCosmicNoirScene(win);
        if (!boot?.ok) {
            throw new Error(`[${scenario.name}] bootstrap failed: ${boot?.reason || 'unknown error'}`);
        }

        await delay(2000);

        idle = await runTimedCapture(win, {
            mode: 'idle',
            durationMs: CAPTURE_CONFIG.idleMs,
        });
        if (!idle?.ok) {
            throw new Error(`[${scenario.name}] idle capture failed: ${idle?.reason || 'unknown error'}`);
        }

        combat = await runTimedCapture(win, {
            mode: 'combat',
            durationMs: CAPTURE_CONFIG.combatMs,
            comboEveryMs: CAPTURE_CONFIG.comboEveryMs,
            comboCount: CAPTURE_CONFIG.comboCount,
            lineCount: CAPTURE_CONFIG.lineCount,
        });
        if (!combat?.ok) {
            throw new Error(`[${scenario.name}] combat capture failed: ${combat?.reason || 'unknown error'}`);
        }

        if (CAPTURE_CONFIG.runSoak) {
            soak = await runTimedCapture(win, {
                mode: 'combat',
                durationMs: CAPTURE_CONFIG.soakMs,
                comboEveryMs: CAPTURE_CONFIG.comboEveryMs,
                comboCount: CAPTURE_CONFIG.comboCount,
                lineCount: CAPTURE_CONFIG.lineCount,
            });
            if (!soak?.ok) {
                throw new Error(`[${scenario.name}] soak capture failed: ${soak?.reason || 'unknown error'}`);
            }
        }

        const screenshot = await win.webContents.capturePage();
        await writeFile(path.join(scenarioDir, 'combat.png'), screenshot.toPNG());
    } catch (scenarioError) {
        error = scenarioError?.message || String(scenarioError);
    }

    const scenarioConsoleEntries = consoleEntries.slice(consoleStartIndex);
    const consoleSummary = summarizeConsoleEntries(scenarioConsoleEntries);
    const consoleLogPath = path.join(scenarioDir, 'console.log');
    await writeFile(consoleLogPath, buildConsoleLog(scenarioConsoleEntries), 'utf8');

    const payload = {
        scenario: scenario.name,
        url,
        idle,
        combat,
        soak,
        consoleSummary,
        consoleLogPath: path.relative(ROOT, consoleLogPath),
        error,
    };

    await writeFile(
        path.join(scenarioDir, 'results.json'),
        JSON.stringify(payload, null, 2),
        'utf8',
    );

    if (error) {
        throw new Error(error);
    }

    return payload;
}

function makeCheck(name, status, details = {}) {
    return { name, status, details };
}

function evaluatePhase6(results, webglReference = null) {
    const checks = [];
    const webgpu = results.webgpu_high;
    const webgpuNoCompute = results.webgpu_high_no_compute;
    const webgl = results.webgl_high_force_webgl;

    const webgpuP95 = webgpu?.idle?.report?.p95FrameMs;
    checks.push(makeCheck(
        'webgpu_high_p95_budget',
        Number.isFinite(webgpuP95) && webgpuP95 <= PHASE6_BUDGETS.webgpuP95BudgetMs ? 'pass' : 'fail',
        {
            value: webgpuP95,
            budget: PHASE6_BUDGETS.webgpuP95BudgetMs,
        },
    ));

    const compileStatus = webgpu?.idle?.report?.compile?.status || 'unknown';
    checks.push(makeCheck(
        'compile_async_timeout_guard',
        compileStatus === 'success' || compileStatus === 'fallback' || compileStatus === 'skipped'
            ? 'pass'
            : 'fail',
        {
            compile: webgpu?.idle?.report?.compile || null,
        },
    ));

    const computeDrawCalls = webgpu?.combat?.report?.avgDrawCalls;
    const fallbackDrawCalls = webgpuNoCompute?.combat?.report?.avgDrawCalls;
    let reduction = null;
    if (Number.isFinite(computeDrawCalls) && Number.isFinite(fallbackDrawCalls) && fallbackDrawCalls > 0) {
        reduction = 1 - (computeDrawCalls / fallbackDrawCalls);
    }
    checks.push(makeCheck(
        'burst_draw_call_reduction',
        Number.isFinite(reduction) && reduction >= PHASE6_BUDGETS.drawCallReductionTarget ? 'pass' : 'fail',
        {
            reduction,
            target: PHASE6_BUDGETS.drawCallReductionTarget,
            computeAvgDrawCalls: computeDrawCalls,
            noComputeAvgDrawCalls: fallbackDrawCalls,
        },
    ));

    const qualityScalingPass = Boolean(
        webgpu?.idle?.report?.runtimeFeatures?.useCompute === true
        && webgpuNoCompute?.idle?.report?.runtimeFeatures?.useCompute === false
        && webgl?.idle?.report?.runtimeFeatures?.useCompute === false,
    );
    checks.push(makeCheck(
        'quality_feature_scaling',
        qualityScalingPass ? 'pass' : 'fail',
        {
            webgpuUseCompute: webgpu?.idle?.report?.runtimeFeatures?.useCompute ?? null,
            webgpuNoComputeUseCompute: webgpuNoCompute?.idle?.report?.runtimeFeatures?.useCompute ?? null,
            webglUseCompute: webgl?.idle?.report?.runtimeFeatures?.useCompute ?? null,
        },
    ));

    const soakGrowth = webgpu?.soak?.trend?.growth || null;
    const texturesGrowth = soakGrowth?.texturesPct;
    const geometriesGrowth = soakGrowth?.geometriesPct;
    const soakPass = soakGrowth
        ? (
            (texturesGrowth === null || texturesGrowth <= PHASE6_BUDGETS.soakMemoryGrowthLimit)
            && (geometriesGrowth === null || geometriesGrowth <= PHASE6_BUDGETS.soakMemoryGrowthLimit)
        )
        : !CAPTURE_CONFIG.runSoak;
    checks.push(makeCheck(
        'soak_memory_stability',
        soakPass ? 'pass' : 'fail',
        {
            enabled: CAPTURE_CONFIG.runSoak,
            limitPct: PHASE6_BUDGETS.soakMemoryGrowthLimit,
            trend: webgpu?.soak?.trend || null,
        },
    ));

    if (webglReference && Number.isFinite(webglReference.p95FrameMs)) {
        const webglP95 = webgl?.idle?.report?.p95FrameMs;
        const regression = Number.isFinite(webglP95) && webglReference.p95FrameMs > 0
            ? (webglP95 - webglReference.p95FrameMs) / webglReference.p95FrameMs
            : null;
        checks.push(makeCheck(
            'webgl_regression_vs_reference',
            Number.isFinite(regression) && regression <= PHASE6_BUDGETS.webglRegressionLimit
                ? 'pass'
                : 'fail',
            {
                regression,
                limit: PHASE6_BUDGETS.webglRegressionLimit,
                currentP95: webglP95,
                referenceP95: webglReference.p95FrameMs,
            },
        ));
    } else {
        checks.push(makeCheck(
            'webgl_regression_vs_reference',
            'skip',
            { reason: 'No reference report supplied via COSMIC_NOIR_WEBGL_REFERENCE.' },
        ));
    }

    const consoleShaderDetails = Object.fromEntries(
        Object.entries(results).map(([name, value]) => [
            name,
            {
                shaderFailureCount: value?.consoleSummary?.shaderFailureCount ?? 0,
                shaderFailureTypes: value?.consoleSummary?.shaderFailureTypes ?? [],
                warningCount: value?.consoleSummary?.warningCount ?? 0,
                errorCount: value?.consoleSummary?.errorCount ?? 0,
                consoleLogPath: value?.consoleLogPath ?? null,
            },
        ]),
    );
    const consoleShaderCleanPass = Object.values(consoleShaderDetails)
        .every((entry) => entry.shaderFailureCount === 0);
    checks.push(makeCheck(
        'console_shader_pipeline_cleanliness',
        consoleShaderCleanPass ? 'pass' : 'fail',
        consoleShaderDetails,
    ));

    const overallPass = checks.every((check) => check.status === 'pass' || check.status === 'skip');
    return { overallPass, checks };
}

function buildMarkdownSummary(summary) {
    const lines = [];
    lines.push('# Cosmic Noir Phase 6 Validation');
    lines.push('');
    lines.push(`- Generated: ${summary.generatedAt}`);
    lines.push(`- Overall: ${summary.evaluation.overallPass ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push('## Checks');
    lines.push('');
    summary.evaluation.checks.forEach((check) => {
        lines.push(`- ${check.name}: ${check.status.toUpperCase()}`);
    });
    lines.push('');
    lines.push('## Scenario Reports');
    lines.push('');
    Object.entries(summary.results).forEach(([name, value]) => {
        lines.push(`- ${name}`);
        lines.push(`  - idle p95: ${value?.idle?.report?.p95FrameMs ?? 'n/a'}`);
        lines.push(`  - combat avg draw calls: ${value?.combat?.report?.avgDrawCalls ?? 'n/a'}`);
        lines.push(`  - backend: ${value?.idle?.report?.backend ?? 'n/a'}`);
        lines.push(`  - console shader failures: ${value?.consoleSummary?.shaderFailureCount ?? 'n/a'}`);
        lines.push(`  - console errors: ${value?.consoleSummary?.errorCount ?? 'n/a'}`);
        lines.push(`  - console log: ${value?.consoleLogPath ?? 'n/a'}`);
    });
    lines.push('');
    return `${lines.join('\n')}\n`;
}

async function loadWebglReference() {
    if (!WEBGL_REFERENCE_PATH) return null;
    if (!existsSync(WEBGL_REFERENCE_PATH)) {
        throw new Error(`Reference file does not exist: ${WEBGL_REFERENCE_PATH}`);
    }
    const raw = await readFile(WEBGL_REFERENCE_PATH, 'utf8');
    return JSON.parse(raw);
}

async function run() {
    await mkdir(ARTIFACT_DIR, { recursive: true });

    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_URL, 120000);

    const win = createWindow();
    const consoleEntries = [];
    const results = {};

    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleEntries.push({
            ts: Date.now(),
            level,
            message,
            line,
            sourceId,
        });
    });

    for (const scenario of SCENARIOS) {
        console.log(`[Phase6Validation] Running scenario: ${scenario.name}`);
        results[scenario.name] = await collectScenario(win, scenario, consoleEntries);
    }

    const webglReference = await loadWebglReference();
    const evaluation = evaluatePhase6(results, webglReference);
    const summary = {
        generatedAt: new Date().toISOString(),
        artifactDir: ARTIFACT_DIR,
        config: {
            capture: CAPTURE_CONFIG,
            budgets: PHASE6_BUDGETS,
            webglReferencePath: WEBGL_REFERENCE_PATH,
        },
        evaluation,
        results,
    };

    await writeFile(
        path.join(ARTIFACT_DIR, 'phase6-summary.json'),
        JSON.stringify(summary, null, 2),
        'utf8',
    );
    await writeFile(
        path.join(ARTIFACT_DIR, 'phase6-summary.md'),
        buildMarkdownSummary(summary),
        'utf8',
    );

    console.log('[Phase6Validation] Summary written to', ARTIFACT_DIR);
    console.log('[Phase6Validation] Overall:', evaluation.overallPass ? 'PASS' : 'FAIL');
}

async function shutdown(exitCode = 0) {
    try {
        await stopDevServer();
    } catch (error) {
        console.error('[Phase6Validation] Failed to stop dev server cleanly:', error);
    }

    try {
        await app.quit();
    } catch (error) {
        // Ignore.
    }

    process.exit(exitCode);
}

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

app.whenReady().then(async () => {
    try {
        await run();
        await shutdown(0);
    } catch (error) {
        console.error('[Phase6Validation] Failed:', error);
        await shutdown(1);
    }
});

process.on('SIGINT', async () => {
    await shutdown(130);
});

process.on('SIGTERM', async () => {
    await shutdown(143);
});
