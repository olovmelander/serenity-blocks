import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const DEV_SERVER_PORT = 4175;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = path.join(
    ROOT,
    'artifacts',
    'wolfhour',
    'phase6',
    TIMESTAMP,
);

const SCENARIOS = [
    {
        name: 'webgpu_high',
        params: {
            wolfhourBaseline: '1',
            wolfhourSeed: '12345',
        },
    },
    {
        name: 'webgpu_high_no_compute',
        params: {
            wolfhourBaseline: '1',
            wolfhourSeed: '12345',
            wolfhourNoCompute: '1',
        },
    },
    {
        name: 'webgl_high_force_webgl',
        params: {
            wolfhourBaseline: '1',
            wolfhourSeed: '12345',
            forceWebGL: '1',
        },
    },
];

const CAPTURE_CONFIG = {
    idleMs: parseDuration(process.env.WOLFHOUR_IDLE_MS, 12000),
    combatMs: parseDuration(process.env.WOLFHOUR_COMBAT_MS, 12000),
    cooldownMs: parseDuration(process.env.WOLFHOUR_COOLDOWN_MS, 5000),
    soakMs: parseDuration(process.env.WOLFHOUR_SOAK_MS, 180000),
    runSoak: process.env.WOLFHOUR_RUN_SOAK === '1',
    comboEveryMs: parseDuration(process.env.WOLFHOUR_COMBO_EVERY_MS, 380),
    comboCount: parsePositiveInt(process.env.WOLFHOUR_COMBO_COUNT, 8),
    lineCount: parsePositiveInt(process.env.WOLFHOUR_LINE_COUNT, 4),
};
const ZOOMED_OUT_CAPTURE = {
    timeoutMs: 20000,
    minZoomFactor: 1.01,
    minObserveMs: 4000,
    settleMs: 900,
    releaseEpsilon: 0.0025,
};

const PHASE6_BUDGETS = {
    targetFps: 60,
    maxDrawCalls: 30,
    maxTriangles: 1000000,
    maxPoints: 100000,
    soakMemoryGrowthLimitPct: 0.1,
};

const ENFORCE_FPS_BUDGET = process.env.WOLFHOUR_ENFORCE_FPS === '1';
const SHOW_WINDOW = process.env.WOLFHOUR_SHOW_WINDOW === '1';

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
        show: SHOW_WINDOW,
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
            const waitFor = async (predicate, timeoutMs = 120000) => {
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
                        return {
                            ok: false,
                            reason: 'Failed to activate/start serenity mode: ' + (error?.message || String(error)),
                        };
                    }
                }
            }

            try {
                await app.themeManager.switchTheme('wolfhour', true);
            } catch (error) {
                return {
                    ok: false,
                    reason: 'Failed to switch to wolfhour: ' + (error?.message || String(error)),
                };
            }

            const themeReady = await waitFor(
                () => {
                    const theme = window.themeManager?.activeTheme;
                    return window.themeManager?.activeThemeName === 'wolfhour'
                        && !!theme?.renderer
                        && !!theme?.scene
                        && !!theme?.camera
                        && typeof theme.getBaselineReport === 'function';
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

async function runTimedCapture(win, options = {}) {
    const payload = {
        mode: options.mode || 'idle',
        durationMs: parseDuration(options.durationMs, 10000),
        comboEveryMs: parseDuration(options.comboEveryMs, 380),
        comboCount: parsePositiveInt(options.comboCount, 8),
        lineCount: parsePositiveInt(options.lineCount, 4),
        resetBaseline: options.resetBaseline !== false,
    };

    const script = `
        (async (payload) => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const theme = window.themeManager?.activeTheme;
            if (!theme) {
                return { ok: false, reason: 'Theme is not active.' };
            }
            if (typeof theme.getBaselineReport !== 'function') {
                return { ok: false, reason: 'Baseline report helper missing.' };
            }

            window.settings = window.settings || {};
            window.settings.backgroundComboEffects = true;

            if (payload.resetBaseline && typeof theme.resetBaselineSamples === 'function') {
                theme.resetBaselineSamples();
            }

            const startMemory = {
                textures: theme.renderer?.info?.memory?.textures ?? 0,
                geometries: theme.renderer?.info?.memory?.geometries ?? 0,
            };

            const startedAt = performance.now();
            let nextComboAt = startedAt + payload.comboEveryMs;
            let comboTriggers = 0;

            while (performance.now() - startedAt < payload.durationMs) {
                if (payload.mode === 'combat' && performance.now() >= nextComboAt) {
                    try {
                        theme.onPieceLock?.();
                        theme.onLineClear?.({ lineCount: payload.lineCount });
                        theme.onCombo?.({ comboCount: payload.comboCount });
                        comboTriggers += 1;
                    } catch (error) {
                        return {
                            ok: false,
                            reason: 'Failed while triggering combat events: ' + (error?.message || String(error)),
                        };
                    }
                    nextComboAt += payload.comboEveryMs;
                }
                await sleep(40);
            }

            const report = theme.getBaselineReport();
            const endMemory = {
                textures: theme.renderer?.info?.memory?.textures ?? 0,
                geometries: theme.renderer?.info?.memory?.geometries ?? 0,
            };

            const growth = {
                texturesPct: startMemory.textures > 0
                    ? (endMemory.textures - startMemory.textures) / startMemory.textures
                    : null,
                geometriesPct: startMemory.geometries > 0
                    ? (endMemory.geometries - startMemory.geometries) / startMemory.geometries
                    : null,
            };

            return {
                ok: true,
                mode: payload.mode,
                durationMs: payload.durationMs,
                comboTriggers,
                startMemory,
                endMemory,
                growth,
                report,
            };
        })(${JSON.stringify(payload)});
    `;

    return win.webContents.executeJavaScript(script, true);
}

async function waitForZoomedOutCamera(win, options = {}) {
    const payload = {
        timeoutMs: parseDuration(options.timeoutMs, ZOOMED_OUT_CAPTURE.timeoutMs),
        minZoomFactor: Number.isFinite(options.minZoomFactor)
            ? options.minZoomFactor
            : ZOOMED_OUT_CAPTURE.minZoomFactor,
        minObserveMs: parseDuration(options.minObserveMs, ZOOMED_OUT_CAPTURE.minObserveMs),
        settleMs: parseDuration(options.settleMs, ZOOMED_OUT_CAPTURE.settleMs),
        releaseEpsilon: Number.isFinite(options.releaseEpsilon)
            ? options.releaseEpsilon
            : ZOOMED_OUT_CAPTURE.releaseEpsilon,
    };

    const script = `
        (async (payload) => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const theme = window.themeManager?.activeTheme;
            if (!theme?.camera) {
                return { ok: false, reason: 'Theme camera is not active.' };
            }

            const getSample = () => {
                const camera = theme.camera;
                const frustumSize = Math.abs((camera.top ?? 0) - (camera.bottom ?? 0));
                const zoomFactor = frustumSize / 1000;
                return {
                    zoomFactor: Number(zoomFactor.toFixed(4)),
                    cameraY: Number((camera.position?.y ?? 0).toFixed(3)),
                    bankTilt: Number((camera.rotation?.z ?? 0).toFixed(5)),
                    frustumSize: Number(frustumSize.toFixed(3)),
                    themeTime: Number((theme.time ?? 0).toFixed(3)),
                };
            };

            let bestSample = null;
            const startedAt = performance.now();
            let lastImprovedAt = startedAt;
            while (performance.now() - startedAt < payload.timeoutMs) {
                const now = performance.now();
                const sample = getSample();
                if (
                    !bestSample
                    || sample.zoomFactor > bestSample.zoomFactor + payload.releaseEpsilon
                    || (
                        Math.abs(sample.zoomFactor - bestSample.zoomFactor) <= payload.releaseEpsilon
                        && sample.cameraY < bestSample.cameraY
                    )
                ) {
                    bestSample = sample;
                    lastImprovedAt = now;
                }

                if (
                    now - startedAt >= payload.minObserveMs
                    && bestSample.zoomFactor >= payload.minZoomFactor
                    && now - lastImprovedAt >= payload.settleMs
                    && sample.zoomFactor <= bestSample.zoomFactor - payload.releaseEpsilon
                ) {
                    return {
                        ok: true,
                        matchedThreshold: true,
                        waitedMs: Math.round(now - startedAt),
                        sample: bestSample,
                        currentSample: sample,
                    };
                }

                await sleep(50);
            }

            return {
                ok: true,
                matchedThreshold: false,
                reason: 'Fell back to the best observed zoomed-out camera sample before timeout.',
                waitedMs: Math.round(performance.now() - startedAt),
                sample: bestSample,
            };
        })(${JSON.stringify(payload)});
    `;

    return win.webContents.executeJavaScript(script, true);
}

async function collectScenario(win, scenario) {
    const scenarioDir = path.join(ARTIFACT_DIR, scenario.name);
    await mkdir(scenarioDir, { recursive: true });

    const url = makeScenarioUrl(scenario.params);
    await win.loadURL(url);

    const boot = await bootstrapWolfhourScene(win);
    if (!boot?.ok) {
        throw new Error(`[${scenario.name}] bootstrap failed: ${boot?.reason || 'unknown error'}`);
    }

    await delay(2000);

    const idle = await runTimedCapture(win, {
        mode: 'idle',
        durationMs: CAPTURE_CONFIG.idleMs,
    });
    if (!idle?.ok) {
        throw new Error(`[${scenario.name}] idle capture failed: ${idle?.reason || 'unknown error'}`);
    }

    const zoomedOut = await waitForZoomedOutCamera(win, ZOOMED_OUT_CAPTURE);
    const zoomedOutScreenshot = await win.webContents.capturePage();
    await writeFile(path.join(scenarioDir, 'zoomed-out.png'), zoomedOutScreenshot.toPNG());

    const combat = await runTimedCapture(win, {
        mode: 'combat',
        durationMs: CAPTURE_CONFIG.combatMs,
        comboEveryMs: CAPTURE_CONFIG.comboEveryMs,
        comboCount: CAPTURE_CONFIG.comboCount,
        lineCount: CAPTURE_CONFIG.lineCount,
    });
    if (!combat?.ok) {
        throw new Error(`[${scenario.name}] combat capture failed: ${combat?.reason || 'unknown error'}`);
    }

    const cooldown = await runTimedCapture(win, {
        mode: 'idle',
        durationMs: CAPTURE_CONFIG.cooldownMs,
        resetBaseline: false,
    });
    if (!cooldown?.ok) {
        throw new Error(`[${scenario.name}] cooldown capture failed: ${cooldown?.reason || 'unknown error'}`);
    }

    let soak = null;
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

    const payload = {
        scenario: scenario.name,
        url,
        idle,
        zoomedOut,
        combat,
        cooldown,
        soak,
    };

    await writeFile(
        path.join(scenarioDir, 'results.json'),
        JSON.stringify(payload, null, 2),
        'utf8',
    );

    return payload;
}

function makeCheck(name, status, details = {}) {
    return { name, status, details };
}

function checkLimit(value, limit) {
    return Number.isFinite(value) && Number.isFinite(limit) && value <= limit;
}

function estimateReactiveTokensPerTrigger(comboCount, lineCount) {
    const beams = Math.min(Math.max(1, lineCount), 2);
    const wave = 1;
    const pieceLockBurst = 1;
    const comboRift = comboCount >= 3 ? 1 : 0;
    const comboMeteors = comboCount >= 3 ? Math.min(comboCount - 1, 4) : 0;
    let comboCrashes = 0;
    if (comboCount >= 10) {
        comboCrashes = 2;
    } else if (comboCount >= 5) {
        comboCrashes = 1;
    }
    return pieceLockBurst + beams + wave + comboRift + comboMeteors + comboCrashes;
}

function evaluatePhase6(results) {
    const checks = [];

    const webgpu = results.webgpu_high;
    const webgpuNoCompute = results.webgpu_high_no_compute;
    const webgl = results.webgl_high_force_webgl;

    const webgpuReport = webgpu?.combat?.report || null;
    const webgpuBudget = webgpuReport?.budget || null;
    const webgpuBackend = webgpuReport?.backend ?? webgpu?.idle?.report?.backend ?? null;
    const hasWebgpuBackend = webgpuBackend === 'WebGPU';

    if (!hasWebgpuBackend) {
        checks.push(makeCheck(
            'webgpu_backend_expected',
            'skip',
            { reason: 'WebGPU backend unavailable on host. Scenario ran on fallback backend.', backend: webgpuBackend },
        ));
    } else {
        checks.push(makeCheck(
            'webgpu_backend_expected',
            'pass',
            { backend: webgpuBackend },
        ));

        checks.push(makeCheck(
            'webgpu_draw_call_budget',
            checkLimit(webgpuReport?.peakDrawCalls, PHASE6_BUDGETS.maxDrawCalls) ? 'pass' : 'fail',
            {
                value: webgpuReport?.peakDrawCalls ?? null,
                limit: PHASE6_BUDGETS.maxDrawCalls,
                budgetPassFlag: webgpuBudget?.pass ?? null,
            },
        ));

        checks.push(makeCheck(
            'webgpu_triangle_budget',
            checkLimit(webgpuReport?.peakTriangles, PHASE6_BUDGETS.maxTriangles) ? 'pass' : 'fail',
            {
                value: webgpuReport?.peakTriangles ?? null,
                limit: PHASE6_BUDGETS.maxTriangles,
            },
        ));

        checks.push(makeCheck(
            'webgpu_point_budget',
            checkLimit(webgpuReport?.peakPoints, PHASE6_BUDGETS.maxPoints) ? 'pass' : 'fail',
            {
                value: webgpuReport?.peakPoints ?? null,
                limit: PHASE6_BUDGETS.maxPoints,
            },
        ));

        if (ENFORCE_FPS_BUDGET) {
            const p95BudgetMs = 1000 / PHASE6_BUDGETS.targetFps;
            checks.push(makeCheck(
                'webgpu_p95_frame_budget',
                checkLimit(webgpu?.idle?.report?.p95FrameMs, p95BudgetMs) ? 'pass' : 'fail',
                {
                    value: webgpu?.idle?.report?.p95FrameMs ?? null,
                    limit: p95BudgetMs,
                },
            ));
        } else {
            checks.push(makeCheck(
                'webgpu_p95_frame_budget',
                'skip',
                { reason: 'Set WOLFHOUR_ENFORCE_FPS=1 to enforce FPS budget in this environment.' },
            ));
        }

        const featureTogglePass = Boolean(
            webgpu?.idle?.report?.runtimeFeatures?.useCompute === true
            && webgpuNoCompute?.idle?.report?.runtimeFeatures?.useCompute === false
            && webgl?.idle?.report?.runtimeFeatures?.useCompute === false,
        );
        checks.push(makeCheck(
            'compute_toggle_behavior',
            featureTogglePass ? 'pass' : 'fail',
            {
                webgpuUseCompute: webgpu?.idle?.report?.runtimeFeatures?.useCompute ?? null,
                webgpuNoComputeUseCompute: webgpuNoCompute?.idle?.report?.runtimeFeatures?.useCompute ?? null,
                webglUseCompute: webgl?.idle?.report?.runtimeFeatures?.useCompute ?? null,
            },
        ));

        const reactivePerformance = webgpu?.combat?.report?.reactivePerformance || {};
        const estimatedTokenCount = (webgpu?.combat?.comboTriggers ?? 0)
            * estimateReactiveTokensPerTrigger(CAPTURE_CONFIG.comboCount, CAPTURE_CONFIG.lineCount);
        const poolMissRate = estimatedTokenCount > 0
            ? (reactivePerformance.poolMisses ?? 0) / estimatedTokenCount
            : null;

        checks.push(makeCheck(
            'reactive_pool_miss_rate',
            poolMissRate === null || poolMissRate <= 0.01 ? 'pass' : 'fail',
            {
                poolMisses: reactivePerformance.poolMisses ?? null,
                estimatedRequestedTokens: estimatedTokenCount,
                poolMissRate,
                limit: 0.01,
            },
        ));

        checks.push(makeCheck(
            'reactive_queue_metrics_present',
            Number.isFinite(reactivePerformance.queueMaxDepth)
                && Number.isFinite(reactivePerformance.tokensDropped)
                && Number.isFinite(reactivePerformance.avgSpawnMs)
                && Number.isFinite(reactivePerformance.p95SpawnMs)
                ? 'pass'
                : 'fail',
            reactivePerformance,
        ));
    }

    checks.push(makeCheck(
        'webgl_fallback_backend',
        webgl?.idle?.report?.backend === 'WebGL2' ? 'pass' : 'fail',
        {
            backend: webgl?.idle?.report?.backend ?? null,
        },
    ));

    const preCombatMemory = webgpu?.combat?.startMemory;
    const postCooldownMemory = webgpu?.cooldown?.endMemory;
    const texturesRecoveryPct = (
        Number.isFinite(preCombatMemory?.textures)
        && preCombatMemory.textures > 0
        && Number.isFinite(postCooldownMemory?.textures)
    )
        ? (postCooldownMemory.textures - preCombatMemory.textures) / preCombatMemory.textures
        : null;
    const geometriesRecoveryPct = (
        Number.isFinite(preCombatMemory?.geometries)
        && preCombatMemory.geometries > 0
        && Number.isFinite(postCooldownMemory?.geometries)
    )
        ? (postCooldownMemory.geometries - preCombatMemory.geometries) / preCombatMemory.geometries
        : null;
    const cooldownRecoveryPass = (
        (texturesRecoveryPct === null || texturesRecoveryPct <= PHASE6_BUDGETS.soakMemoryGrowthLimitPct)
        && (geometriesRecoveryPct === null || geometriesRecoveryPct <= PHASE6_BUDGETS.soakMemoryGrowthLimitPct)
    );
    checks.push(makeCheck(
        'cooldown_memory_recovery',
        cooldownRecoveryPass ? 'pass' : 'fail',
        {
            preCombatMemory,
            postCooldownMemory,
            texturesRecoveryPct,
            geometriesRecoveryPct,
            limit: PHASE6_BUDGETS.soakMemoryGrowthLimitPct,
            cooldownMs: CAPTURE_CONFIG.cooldownMs,
        },
    ));

    if (CAPTURE_CONFIG.runSoak) {
        const texturesGrowth = webgpu?.soak?.growth?.texturesPct;
        const geometriesGrowth = webgpu?.soak?.growth?.geometriesPct;
        const soakPass = (
            (texturesGrowth === null || texturesGrowth <= PHASE6_BUDGETS.soakMemoryGrowthLimitPct)
            && (geometriesGrowth === null || geometriesGrowth <= PHASE6_BUDGETS.soakMemoryGrowthLimitPct)
        );

        checks.push(makeCheck(
            'soak_memory_growth',
            soakPass ? 'pass' : 'fail',
            {
                texturesGrowth,
                geometriesGrowth,
                limit: PHASE6_BUDGETS.soakMemoryGrowthLimitPct,
            },
        ));
    } else {
        checks.push(makeCheck(
            'soak_memory_growth',
            'skip',
            { reason: 'Set WOLFHOUR_RUN_SOAK=1 to enable long soak check.' },
        ));
    }

    const overallPass = checks.every((check) => check.status === 'pass' || check.status === 'skip');
    return { overallPass, checks };
}

function buildMarkdownSummary(summary) {
    const lines = [];
    lines.push('# Wolfhour Phase 6 Validation');
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
        lines.push(`  - cooldown textures: ${value?.cooldown?.endMemory?.textures ?? 'n/a'}`);
        lines.push(`  - cooldown geometries: ${value?.cooldown?.endMemory?.geometries ?? 'n/a'}`);
        lines.push(
            `  - reactive queue max depth: ${value?.combat?.report?.reactivePerformance?.queueMaxDepth ?? 'n/a'}`,
        );
        lines.push(`  - reactive pool misses: ${value?.combat?.report?.reactivePerformance?.poolMisses ?? 'n/a'}`);
    });
    lines.push('');
    return `${lines.join('\n')}\n`;
}

async function run() {
    await mkdir(ARTIFACT_DIR, { recursive: true });

    devServerProcess = startDevServer();
    await waitForServer(DEV_SERVER_URL, 120000);

    const win = createWindow();
    const results = {};

    for (const scenario of SCENARIOS) {
        console.log(`[Phase6Validation] Running scenario: ${scenario.name}`);
        results[scenario.name] = await collectScenario(win, scenario);
    }

    const evaluation = evaluatePhase6(results);
    const summary = {
        generatedAt: new Date().toISOString(),
        artifactDir: ARTIFACT_DIR,
        config: {
            capture: CAPTURE_CONFIG,
            budgets: PHASE6_BUDGETS,
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
    console.log(`[Phase6Validation] Overall: ${evaluation.overallPass ? 'PASS' : 'FAIL'}`);

    await win.close();
}

run()
    .catch(async (error) => {
        console.error('[Phase6Validation] Failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await stopDevServer();
        app.quit();
    });
