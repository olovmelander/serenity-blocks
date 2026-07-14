// Electron is the executable for this validation harness, so its devDependency placement is intentional.
// eslint-disable-next-line import/no-extraneous-dependencies
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

const RUN_PROFILE = Object.freeze({
    quality: 'High',
    pixelRatio: parsePositiveNumber(process.env.COSMIC_NOIR_PIXEL_RATIO, 1),
    renderScale: parseBoundedNumber(process.env.COSMIC_NOIR_RENDER_SCALE, 0.92, 0.5, 2),
    targetFps: parsePositiveInt(process.env.COSMIC_NOIR_TARGET_FPS, 60),
    antialias: parseBoolean(process.env.COSMIC_NOIR_ANTIALIAS, false),
    adaptiveScale: false,
    preserveDrawingBuffer: false,
    headed: true,
    windowWidth: parsePositiveInt(process.env.COSMIC_NOIR_WINDOW_WIDTH, 1600),
    windowHeight: parsePositiveInt(process.env.COSMIC_NOIR_WINDOW_HEIGHT, 900),
});

const BASE_SCENARIO_PARAMS = Object.freeze({
    skipIntro: '1',
    noThemeWarm: '1',
    cosmicNoirBaseline: '1',
    cosmicNoirSeed: '12345',
    cosmicNoirFixedPixelRatio: String(RUN_PROFILE.pixelRatio),
    cosmicNoirRenderScale: String(RUN_PROFILE.renderScale),
    cosmicNoirNoAdaptiveScale: '1',
    cosmicNoirMsaa: RUN_PROFILE.antialias ? '1' : '0',
});

const SCENARIOS = [
    {
        name: 'webgpu_high',
        expectedBackend: 'WebGPU',
        params: {
            ...BASE_SCENARIO_PARAMS,
        },
    },
    {
        name: 'webgpu_high_no_compute',
        expectedBackend: 'WebGPU',
        params: {
            ...BASE_SCENARIO_PARAMS,
            cosmicNoirNoCompute: '1',
        },
    },
    {
        name: 'webgl_high_force_webgl',
        expectedBackend: 'WebGL2',
        params: {
            ...BASE_SCENARIO_PARAMS,
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
    webgpuP95BudgetMs: parsePositiveNumber(
        process.env.COSMIC_NOIR_WEBGPU_P95_BUDGET_MS,
        (1000 / RUN_PROFILE.targetFps) + 0.1,
    ),
    computePathRegressionLimit: parseBoundedNumber(
        process.env.COSMIC_NOIR_COMPUTE_REGRESSION_LIMIT,
        0.05,
        0,
        1,
    ),
    minimumCaptureSamples: parsePositiveInt(process.env.COSMIC_NOIR_MIN_CAPTURE_SAMPLES, 120),
    webglRegressionLimit: 0.05,
    soakMemoryGrowthLimit: 0.1,
    targetDimensionTolerancePx: 1,
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
if (process.env.COSMIC_NOIR_FORCE_HIGH_PERFORMANCE_GPU !== '0') {
    app.commandLine.appendSwitch('force_high_performance_gpu');
}

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

function parsePositiveNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseBoundedNumber(value, fallback, min, max) {
    const parsed = Number(value);
    const resolved = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(max, Math.max(min, resolved));
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
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
            // Intentional polling: the Vite server may still be starting.
            // eslint-disable-next-line no-await-in-loop
            const response = await fetch(url, { method: 'GET' });
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(500);
    }

    throw new Error(`Timed out waiting for dev server at ${url}: ${lastError?.message || 'unknown error'}`);
}

function startDevServer() {
    const npmArgs = [
        'run',
        'dev',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(DEV_SERVER_PORT),
        '--strictPort',
    ];
    const useWindowsShell = process.platform === 'win32';
    const proc = spawn(
        useWindowsShell ? (process.env.ComSpec || 'cmd.exe') : 'npm',
        useWindowsShell
            ? ['/d', '/s', '/c', `npm.cmd ${npmArgs.join(' ')}`]
            : npmArgs,
        {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
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
    proc.on('error', (error) => {
        logChunks.push(`[spawn-error] ${error.stack || error.message}\n`);
    });

    proc._logChunks = logChunks;
    return proc;
}

async function stopDevServer() {
    if (!devServerProcess) return;
    const proc = devServerProcess;
    devServerProcess = null;

    if (proc.exitCode === null && process.platform === 'win32' && proc.pid) {
        await new Promise((resolve) => {
            const killer = spawn(
                'taskkill.exe',
                ['/PID', String(proc.pid), '/T', '/F'],
                { stdio: 'ignore', windowsHide: true },
            );
            killer.once('error', resolve);
            killer.once('exit', resolve);
        });
    } else if (proc.exitCode === null) {
        proc.kill('SIGTERM');
        await delay(800);
        if (proc.exitCode === null) proc.kill('SIGKILL');
    }

    const devLogPath = path.join(ARTIFACT_DIR, 'dev-server.log');
    const logText = Array.isArray(proc._logChunks) ? proc._logChunks.join('') : '';
    await writeFile(devLogPath, logText, 'utf8');
}

function createWindow() {
    return new BrowserWindow({
        width: RUN_PROFILE.windowWidth,
        height: RUN_PROFILE.windowHeight,
        useContentSize: true,
        show: RUN_PROFILE.headed,
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            // Dedicated partition: never read or mutate the player's saved mode/theme settings.
            partition: 'persist:cosmic-noir-phase6-validation',
        },
    });
}

async function collectElectronGpuDiagnostics() {
    let gpuInfo = null;
    let gpuInfoError = null;
    try {
        gpuInfo = await app.getGPUInfo('complete');
    } catch (error) {
        gpuInfoError = error?.message || String(error);
    }

    let featureStatus = null;
    let featureStatusError = null;
    try {
        featureStatus = app.getGPUFeatureStatus();
    } catch (error) {
        featureStatusError = error?.message || String(error);
    }

    const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : [];
    const activeDevices = devices.filter((device) => device?.active === true);
    return {
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
        forceHighPerformanceGpu: process.env.COSMIC_NOIR_FORCE_HIGH_PERFORMANCE_GPU !== '0',
        gpuInfo,
        gpuInfoError,
        featureStatus,
        featureStatusError,
        devices,
        activeDevices,
        adapterIdentified: activeDevices.length > 0,
    };
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

async function bootstrapCosmicNoirScene(win, scenario) {
    const bootstrapProfile = {
        quality: RUN_PROFILE.quality,
        targetFps: RUN_PROFILE.targetFps,
        antialias: RUN_PROFILE.antialias,
        pixelRatio: RUN_PROFILE.pixelRatio,
        renderScale: RUN_PROFILE.renderScale,
        expectedBackend: scenario.expectedBackend,
    };
    const script = `
        (async (profile) => {
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
                () => !!(
                    window.serenityBlocks?.isInitialized
                    && window.serenityBlocks?.gameModeManager
                    && window.serenityBlocks?.themeManager
                ),
                120000,
            );
            if (!managersReady) {
                return { ok: false, reason: 'Managers not ready in time.' };
            }

            const app = window.serenityBlocks;
            const pinnedSettings = {
                effectQuality: profile.quality,
                graphicsQuality: profile.quality,
                renderScale: 1,
                targetFrameRate: profile.targetFps,
                vsyncEnabled: true,
                enableAntialiasing: profile.antialias,
                backgroundComboEffects: true,
                backgroundTabBehavior: 'continue',
                backgroundMode: 'Specific',
                backgroundTheme: 'forest',
            };

            try {
                app.settingsManager?.update?.(pinnedSettings, false);
                window.settings = app.settingsManager?.get?.() || {
                    ...(window.settings || {}),
                    ...pinnedSettings,
                };

                const baseTheme = await import('/src/themes/base-theme.js');
                baseTheme.setGlobalRenderScale(1);
                baseTheme.setGlobalAntialias(profile.antialias);

                app.applyEffectQuality?.(profile.quality);
                await app.applyFrameRateSettings?.(window.settings);
                app.frameRateController?.setVSync?.(true);
                app.frameRateController?.setTargetFPS?.(profile.targetFps);
            } catch (error) {
                return {
                    ok: false,
                    reason: 'Failed to pin benchmark settings: ' + (error?.message || String(error)),
                };
            }

            const currentMode = app.gameModeManager.getCurrentMode?.();
            if (!currentMode || !currentMode.isRunning) {
                try {
                    app.startPostMenuRenderer?.();
                    if (app.gameModeManager.getCurrentModeId?.() !== 'serenity') {
                        await withTimeout(
                            app.gameModeManager.activateMode('serenity'),
                            45000,
                            'activateMode(serenity)',
                        );
                    }
                    const modeAfterActivate = app.gameModeManager.getCurrentMode?.();
                    if (!modeAfterActivate || !modeAfterActivate.isRunning) {
                        await withTimeout(
                            app.gameModeManager.startCurrentMode(),
                            45000,
                            'startCurrentMode(serenity)',
                        );
                    }
                } catch (error) {
                    return {
                        ok: false,
                        reason: 'Failed to activate serenity mode: ' + (error?.message || String(error)),
                    };
                }
            }

            app.gamepadController?.disableGameModeSelection?.();
            app.gamepadController?.disableMenuNavigation?.();
            app.gamepadController?.disableSerenityMode?.();
            app.modalManager?.hideAll?.();
            document.body.classList.remove('start-modal-open');

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

            window.isRenderingPaused = false;
            window.isRenderingReduced = false;
            window.performanceMonitor?.setAdaptiveDownscaleSuppressed?.(true);

            const theme = window.themeManager.activeTheme;
            const actualBackend = theme.isWebGPU ? 'WebGPU' : (theme.isWebGL ? 'WebGL2' : 'Unknown');
            if (actualBackend !== profile.expectedBackend) {
                return {
                    ok: false,
                    reason: 'Expected ' + profile.expectedBackend + ' but initialized ' + actualBackend + '.',
                };
            }
            if (typeof theme.resetBaselineCapture !== 'function'
                || typeof theme.getBaselineReport !== 'function'
                || typeof window.cosmicNoirBaseline?.getSamples !== 'function') {
                return { ok: false, reason: 'Cosmic Noir baseline API is unavailable.' };
            }

            await new Promise((resolve) => requestAnimationFrame(
                () => requestAnimationFrame(resolve),
            ));

            return {
                ok: true,
                backend: actualBackend,
                compile: { ...(theme.compileStats || {}) },
            };
        })(${JSON.stringify(bootstrapProfile)});
    `;

    return executeJavaScriptWithTimeout(win, script, 180000, 'bootstrapCosmicNoirScene');
}

async function collectRuntimeMetadata(win, scenario) {
    const expected = {
        backend: scenario.expectedBackend,
        quality: RUN_PROFILE.quality,
        pixelRatio: RUN_PROFILE.pixelRatio,
        renderScale: RUN_PROFILE.renderScale,
        antialias: RUN_PROFILE.antialias,
        preserveDrawingBuffer: RUN_PROFILE.preserveDrawingBuffer,
    };
    const script = `
        (async (expected) => {
            const theme = window.themeManager?.activeTheme;
            const renderer = theme?.renderer;
            if (!theme || !renderer) {
                return { ok: false, reason: 'Theme renderer is unavailable.' };
            }

            const serializeAdapterInfo = (info) => {
                if (!info) return null;
                const result = {};
                [
                    'vendor',
                    'architecture',
                    'device',
                    'description',
                    'subgroupMinSize',
                    'subgroupMaxSize',
                ].forEach((key) => {
                    const value = info[key];
                    if (value !== undefined && value !== '') result[key] = value;
                });
                return Object.keys(result).length ? result : null;
            };
            const approximatelyEqual = (actual, target, tolerance = 0.01) => (
                Number.isFinite(actual)
                && Number.isFinite(target)
                && Math.abs(actual - target) <= tolerance
            );

            let adapterProbe = null;
            let adapterProbeError = null;
            if (navigator.gpu?.requestAdapter) {
                try {
                    const adapter = await navigator.gpu.requestAdapter({
                        powerPreference: 'high-performance',
                    });
                    let info = adapter?.info || null;
                    if (!info && typeof adapter?.requestAdapterInfo === 'function') {
                        info = await adapter.requestAdapterInfo();
                    }
                    adapterProbe = {
                        available: Boolean(adapter),
                        info: serializeAdapterInfo(info),
                        features: adapter?.features ? [...adapter.features].sort() : [],
                    };
                } catch (error) {
                    adapterProbeError = error?.message || String(error);
                }
            }

            const backend = theme.isWebGPU ? 'WebGPU' : (theme.isWebGL ? 'WebGL2' : 'Unknown');
            const contextAttributes = renderer.getContext?.()?.getContextAttributes?.() || null;
            const backendParameters = renderer.backend?.parameters || null;
            const pixelRatio = renderer.getPixelRatio?.() ?? null;
            const drawingBufferWidth = renderer.domElement?.width ?? null;
            const drawingBufferHeight = renderer.domElement?.height ?? null;
            const expectedDrawingBufferWidth = Math.floor(window.innerWidth * expected.pixelRatio);
            const expectedDrawingBufferHeight = Math.floor(window.innerHeight * expected.pixelRatio);
            const scenePass = theme.postProcessing?.scenePass || null;
            const sceneResolutionScale = scenePass?.getResolutionScale?.() ?? null;
            const sceneWidth = scenePass?.renderTarget?.width ?? null;
            const sceneHeight = scenePass?.renderTarget?.height ?? null;
            const expectedSceneWidth = backend === 'WebGPU'
                ? Math.floor(window.innerWidth * expected.pixelRatio * expected.renderScale)
                : null;
            const expectedSceneHeight = backend === 'WebGPU'
                ? Math.floor(window.innerHeight * expected.pixelRatio * expected.renderScale)
                : null;
            const antialiasSamples = Number.isFinite(renderer.samples) ? renderer.samples : null;
            const antialiasEnabled = backend === 'WebGPU'
                ? (antialiasSamples > 0)
                : (contextAttributes?.antialias ?? null);
            const preserveDrawingBuffer = contextAttributes?.preserveDrawingBuffer
                ?? backendParameters?.preserveDrawingBuffer
                ?? null;
            const device = renderer.backend?.device || null;
            const deviceFeatures = device?.features ? [...device.features].sort() : [];
            const deviceAdapterInfo = serializeAdapterInfo(device?.adapterInfo || null);
            const runtimeQuality = theme.getCurrentQualityLevel?.() || theme.activeQualityLevel || null;
            const flags = { ...(theme.flags || {}) };
            const adaptive = theme.adaptiveBudgetState || {};
            const visibilityState = document.visibilityState;
            const documentHidden = document.hidden;

            const assertions = [
                {
                    name: 'headed_visibility',
                    pass: visibilityState === 'visible' && documentHidden === false,
                    actual: { visibilityState, documentHidden },
                    expected: { visibilityState: 'visible', documentHidden: false },
                },
                {
                    name: 'backend',
                    pass: backend === expected.backend,
                    actual: backend,
                    expected: expected.backend,
                },
                {
                    name: 'quality',
                    pass: runtimeQuality === expected.quality,
                    actual: runtimeQuality,
                    expected: expected.quality,
                },
                {
                    name: 'pixel_ratio',
                    pass: approximatelyEqual(pixelRatio, expected.pixelRatio),
                    actual: pixelRatio,
                    expected: expected.pixelRatio,
                },
                {
                    name: 'adaptive_scale_disabled',
                    pass: flags.noAdaptiveScale === true
                        && approximatelyEqual(adaptive.pixelRatioScale ?? 1, 1)
                        && approximatelyEqual(adaptive.postResolutionScale ?? 1, 1),
                    actual: {
                        flag: flags.noAdaptiveScale,
                        pixelRatioScale: adaptive.pixelRatioScale ?? null,
                        postResolutionScale: adaptive.postResolutionScale ?? null,
                    },
                    expected: true,
                },
                {
                    name: 'drawing_buffer_dimensions',
                    pass: Math.abs(drawingBufferWidth - expectedDrawingBufferWidth) <= 1
                        && Math.abs(drawingBufferHeight - expectedDrawingBufferHeight) <= 1,
                    actual: { width: drawingBufferWidth, height: drawingBufferHeight },
                    expected: {
                        width: expectedDrawingBufferWidth,
                        height: expectedDrawingBufferHeight,
                    },
                },
                {
                    name: 'antialias',
                    pass: antialiasEnabled === expected.antialias,
                    actual: { enabled: antialiasEnabled, samples: antialiasSamples },
                    expected: expected.antialias,
                },
                {
                    name: 'preserve_drawing_buffer',
                    pass: preserveDrawingBuffer === expected.preserveDrawingBuffer,
                    actual: preserveDrawingBuffer,
                    expected: expected.preserveDrawingBuffer,
                },
            ];

            if (backend === 'WebGPU') {
                assertions.push(
                    {
                        name: 'webgpu_device',
                        pass: Boolean(device),
                        actual: Boolean(device),
                        expected: true,
                    },
                    {
                        name: 'scene_resolution_scale',
                        pass: approximatelyEqual(sceneResolutionScale, expected.renderScale),
                        actual: sceneResolutionScale,
                        expected: expected.renderScale,
                    },
                    {
                        name: 'scene_target_dimensions',
                        pass: Math.abs(sceneWidth - expectedSceneWidth) <= 1
                            && Math.abs(sceneHeight - expectedSceneHeight) <= 1,
                        actual: { width: sceneWidth, height: sceneHeight },
                        expected: { width: expectedSceneWidth, height: expectedSceneHeight },
                    },
                );
            }

            return {
                ok: assertions.every((assertion) => assertion.pass),
                assertions,
                backend,
                quality: runtimeQuality,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                visibility: { visibilityState, documentHidden },
                drawingBuffer: {
                    width: drawingBufferWidth,
                    height: drawingBufferHeight,
                    pixelRatio,
                    antialiasEnabled,
                    samples: antialiasSamples,
                    preserveDrawingBuffer,
                },
                sceneTarget: {
                    width: sceneWidth,
                    height: sceneHeight,
                    resolutionScale: sceneResolutionScale,
                },
                flags: {
                    noAdaptiveScale: flags.noAdaptiveScale ?? null,
                    fixedPixelRatio: flags.fixedPixelRatio ?? null,
                    renderScale: flags.renderScale ?? null,
                    usePost: flags.usePost ?? null,
                    useMRT: flags.useMRT ?? null,
                    useCompute: flags.useCompute ?? null,
                },
                adaptiveState: {
                    pixelRatioScale: adaptive.pixelRatioScale ?? null,
                    postResolutionScale: adaptive.postResolutionScale ?? null,
                },
                compile: { ...(theme.compileStats || {}) },
                rendererInfo: {
                    autoReset: renderer.info?.autoReset ?? null,
                    render: { ...(renderer.info?.render || {}) },
                    compute: { ...(renderer.info?.compute || {}) },
                    memory: { ...(renderer.info?.memory || {}) },
                },
                adapter: {
                    navigatorGpuAvailable: Boolean(navigator.gpu),
                    backendDevicePresent: Boolean(device),
                    timestampQuerySupported: deviceFeatures.includes('timestamp-query'),
                    timestampTrackingEnabled: renderer.backend?.trackTimestamp === true,
                    deviceAdapterInfo,
                    deviceFeatures,
                    probe: adapterProbe,
                    probeError: adapterProbeError,
                },
                userAgent: navigator.userAgent,
            };
        })(${JSON.stringify(expected)});
    `;

    return executeJavaScriptWithTimeout(win, script, 30000, 'collectRuntimeMetadata');
}

async function runTimedCapture(win, options = {}) {
    const payload = {
        mode: options.mode || 'idle',
        durationMs: parseDuration(options.durationMs, 10000),
        comboEveryMs: parseDuration(options.comboEveryMs, 380),
        comboCount: parsePositiveInt(options.comboCount, 8),
        lineCount: parsePositiveInt(options.lineCount, 4),
        targetFps: RUN_PROFILE.targetFps,
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

            const compileBeforeReset = { ...(theme.compileStats || {}) };
            const expectedFrameCapacity = Math.ceil(
                (payload.durationMs / 1000) * payload.targetFps * 1.25,
            );
            theme.baselineMaxFrames = Math.max(
                Number(theme.baselineMaxFrames) || 0,
                expectedFrameCapacity,
            );
            theme.resetBaselineCapture();
            const compileAfterReset = { ...(theme.compileStats || {}) };
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

            // Give the asynchronous timestamp resolver one scheduling turn to publish its latest
            // completed batch. This does not wait for the GPU on every frame.
            await sleep(100);

            const report = theme.getBaselineReport();
            const samples = window.cosmicNoirBaseline?.getSamples?.() || {
                frames: [],
                render: [],
                cpu: [],
                gpu: [],
            };

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
                        avgDrawCalls: avg(head, 'drawCalls'),
                        avgRenderPasses: avg(head, 'renderPasses'),
                        avgComputeCalls: avg(head, 'computeCalls'),
                        avgTriangles: avg(head, 'triangles'),
                        avgPoints: avg(head, 'points'),
                        avgTextures: startTextures,
                        avgGeometries: startGeometries,
                    },
                    end: {
                        avgDrawCalls: avg(tail, 'drawCalls'),
                        avgRenderPasses: avg(tail, 'renderPasses'),
                        avgComputeCalls: avg(tail, 'computeCalls'),
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
                compile: {
                    beforeReset: compileBeforeReset,
                    afterReset: compileAfterReset,
                    preserved: JSON.stringify(compileBeforeReset) === JSON.stringify(compileAfterReset),
                },
                trend: computeTrend(samples.render || []),
                samples,
                sampleCounts: {
                    frameSamples: (samples.frames || []).length,
                    renderSamples: (samples.render || []).length,
                    cpuSamples: (samples.cpu || []).length,
                    gpuSamples: (samples.gpu || []).length,
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
    let boot = null;
    let runtimeMetadata = null;
    let error = null;

    try {
        await win.loadURL(url);
        boot = await bootstrapCosmicNoirScene(win, scenario);
        if (!boot?.ok) {
            throw new Error(`[${scenario.name}] bootstrap failed: ${boot?.reason || 'unknown error'}`);
        }

        await delay(2000);
        runtimeMetadata = await collectRuntimeMetadata(win, scenario);
        if (!runtimeMetadata?.ok) {
            const failures = (runtimeMetadata?.assertions || [])
                .filter((assertion) => !assertion.pass)
                .map((assertion) => assertion.name)
                .join(', ');
            const failureReason = failures
                || runtimeMetadata?.reason
                || 'unknown error';
            throw new Error(
                `[${scenario.name}] runtime profile assertion failed: ${failureReason}`,
            );
        }

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
        expectedBackend: scenario.expectedBackend,
        runProfile: RUN_PROFILE,
        boot,
        runtimeMetadata,
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

    return payload;
}

function makeCheck(name, status, details = {}) {
    return { name, status, details };
}

function evaluatePhase6(results, webglReference = null, gpuDiagnostics = null) {
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
    const compilePreserved = [webgpu?.idle, webgpu?.combat, webgpu?.soak]
        .filter(Boolean)
        .every((capture) => capture?.compile?.preserved === true);
    checks.push(makeCheck(
        'compile_async_timeout_guard',
        (
            compileStatus === 'success'
            || compileStatus === 'fallback'
            || compileStatus === 'skipped'
        ) && compilePreserved
            ? 'pass'
            : 'fail',
        {
            compile: webgpu?.idle?.report?.compile || null,
            compilePreservedAcrossCaptureReset: compilePreserved,
        },
    ));

    const computeCombatP95 = webgpu?.combat?.report?.p95FrameMs;
    const fallbackCombatP95 = webgpuNoCompute?.combat?.report?.p95FrameMs;
    let computeRegression = null;
    if (Number.isFinite(computeCombatP95) && Number.isFinite(fallbackCombatP95) && fallbackCombatP95 > 0) {
        computeRegression = (computeCombatP95 - fallbackCombatP95) / fallbackCombatP95;
    }
    checks.push(makeCheck(
        'compute_path_combat_frame_time',
        Number.isFinite(computeRegression)
            && computeRegression <= PHASE6_BUDGETS.computePathRegressionLimit
            ? 'pass'
            : 'fail',
        {
            regression: computeRegression,
            limit: PHASE6_BUDGETS.computePathRegressionLimit,
            computeP95FrameMs: computeCombatP95,
            noComputeP95FrameMs: fallbackCombatP95,
            computeGpuTiming: webgpu?.combat?.report?.gpuTiming || null,
            noComputeGpuTiming: webgpuNoCompute?.combat?.report?.gpuTiming || null,
        },
    ));

    const runtimeProfileDetails = Object.fromEntries(
        Object.entries(results).map(([name, result]) => [
            name,
            {
                ok: result?.runtimeMetadata?.ok === true,
                failedAssertions: (result?.runtimeMetadata?.assertions || [])
                    .filter((assertion) => !assertion.pass),
                backend: result?.runtimeMetadata?.backend ?? null,
                quality: result?.runtimeMetadata?.quality ?? null,
                drawingBuffer: result?.runtimeMetadata?.drawingBuffer ?? null,
                sceneTarget: result?.runtimeMetadata?.sceneTarget ?? null,
            },
        ]),
    );
    checks.push(makeCheck(
        'pinned_runtime_profile',
        Object.values(runtimeProfileDetails).every((entry) => entry.ok) ? 'pass' : 'fail',
        runtimeProfileDetails,
    ));

    const captureEntries = Object.entries(results).flatMap(([scenarioName, result]) => (
        ['idle', 'combat', ...(CAPTURE_CONFIG.runSoak ? ['soak'] : [])]
            .map((captureName) => ({
                scenarioName,
                captureName,
                capture: result?.[captureName],
            }))
    ));
    const sampleIntegrityDetails = captureEntries.map(({ scenarioName, captureName, capture }) => ({
        scenario: scenarioName,
        capture: captureName,
        frameSamples: capture?.sampleCounts?.frameSamples ?? 0,
        renderSamples: capture?.sampleCounts?.renderSamples ?? 0,
        cpuSamples: capture?.sampleCounts?.cpuSamples ?? 0,
        gpuSamples: capture?.sampleCounts?.gpuSamples ?? 0,
        rawSamplesRetained: Boolean(capture?.samples),
    }));
    const sampleIntegrityPass = sampleIntegrityDetails.every((entry) => (
        entry.frameSamples >= PHASE6_BUDGETS.minimumCaptureSamples
        && entry.renderSamples >= PHASE6_BUDGETS.minimumCaptureSamples
        && entry.cpuSamples >= PHASE6_BUDGETS.minimumCaptureSamples
        && entry.rawSamplesRetained
    ));
    checks.push(makeCheck(
        'raw_capture_sample_integrity',
        sampleIntegrityPass ? 'pass' : 'fail',
        {
            minimumSamples: PHASE6_BUDGETS.minimumCaptureSamples,
            captures: sampleIntegrityDetails,
        },
    ));

    const webgpuTargetDetails = [
        ['webgpu_high', webgpu],
        ['webgpu_high_no_compute', webgpuNoCompute],
    ].flatMap(([scenarioName, result]) => (
        ['idle', 'combat', ...(CAPTURE_CONFIG.runSoak ? ['soak'] : [])].map((captureName) => {
            const targets = result?.[captureName]?.report?.targetDimensions || null;
            const runtime = result?.runtimeMetadata || {};
            const finitePositive = (value) => Number.isFinite(value) && value > 0;
            const close = (actual, expected) => Number.isFinite(actual)
                && Number.isFinite(expected)
                && Math.abs(actual - expected) <= PHASE6_BUDGETS.targetDimensionTolerancePx;
            const valid = Boolean(targets)
                && close(targets.drawingBufferWidth, runtime.drawingBuffer?.width)
                && close(targets.drawingBufferHeight, runtime.drawingBuffer?.height)
                && close(targets.sceneWidth, runtime.sceneTarget?.width)
                && close(targets.sceneHeight, runtime.sceneTarget?.height)
                && finitePositive(targets.bloomWidth)
                && finitePositive(targets.bloomHeight)
                && targets.bloomWidth <= targets.drawingBufferWidth
                && targets.bloomHeight <= targets.drawingBufferHeight;
            return {
                scenario: scenarioName,
                capture: captureName,
                valid,
                targets,
                expectedDrawingBuffer: runtime.drawingBuffer || null,
                expectedSceneTarget: runtime.sceneTarget || null,
            };
        })
    ));
    checks.push(makeCheck(
        'webgpu_target_dimensions',
        webgpuTargetDetails.every((entry) => entry.valid) ? 'pass' : 'fail',
        webgpuTargetDetails,
    ));

    const timestampExpected = webgpu?.runtimeMetadata?.adapter?.timestampQuerySupported === true
        && webgpu?.runtimeMetadata?.adapter?.timestampTrackingEnabled === true;
    const gpuTimingDetails = ['idle', 'combat', ...(CAPTURE_CONFIG.runSoak ? ['soak'] : [])]
        .map((captureName) => ({
            capture: captureName,
            render: webgpu?.[captureName]?.report?.gpuTiming?.renderMs || null,
            compute: webgpu?.[captureName]?.report?.gpuTiming?.computeMs || null,
        }));
    const gpuTimingPass = gpuTimingDetails.every((entry) => (
        Number(entry.render?.sampleCount) > 0
        && (
            entry.capture === 'idle'
            || Number(entry.compute?.sampleCount) > 0
        )
    ));
    let gpuTimingStatus = 'skip';
    if (timestampExpected) {
        gpuTimingStatus = gpuTimingPass ? 'pass' : 'fail';
    }
    checks.push(makeCheck(
        'webgpu_timestamp_samples',
        gpuTimingStatus,
        {
            timestampExpected,
            captures: gpuTimingDetails,
        },
    ));

    const adapterDetails = {
        electronAdapterIdentified: gpuDiagnostics?.adapterIdentified === true,
        activeDevices: gpuDiagnostics?.activeDevices || [],
        allDevices: gpuDiagnostics?.devices || [],
        webgpuDevicePresent: webgpu?.runtimeMetadata?.adapter?.backendDevicePresent === true,
        adapterProbe: webgpu?.runtimeMetadata?.adapter?.probe || null,
        adapterProbeError: webgpu?.runtimeMetadata?.adapter?.probeError || null,
    };
    checks.push(makeCheck(
        'gpu_adapter_identified',
        adapterDetails.electronAdapterIdentified && adapterDetails.webgpuDevicePresent
            ? 'pass'
            : 'fail',
        adapterDetails,
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
        .every((entry) => entry.shaderFailureCount === 0 && entry.errorCount === 0);
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
    const profile = summary.config.runProfile;
    lines.push(
        `- Profile: ${profile.quality}, DPR ${profile.pixelRatio}, `
        + `scene scale ${profile.renderScale}, ${profile.targetFps} FPS, `
        + `AA ${profile.antialias ? 'on' : 'off'}`,
    );
    const activeGpu = summary.gpuDiagnostics?.activeDevices?.[0];
    lines.push(`- Active GPU: ${activeGpu?.deviceString || activeGpu?.vendorString || 'not identified'}`);
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
        lines.push(`  - GPU render p95: ${value?.combat?.report?.gpuTiming?.renderMs?.p95Ms ?? 'n/a'}`);
        lines.push(`  - GPU compute p95: ${value?.combat?.report?.gpuTiming?.computeMs?.p95Ms ?? 'n/a'}`);
        lines.push(`  - raw idle samples: ${value?.idle?.sampleCounts?.frameSamples ?? 'n/a'}`);
        const sceneWidth = value?.idle?.report?.targetDimensions?.sceneWidth ?? 'n/a';
        const sceneHeight = value?.idle?.report?.targetDimensions?.sceneHeight ?? 'n/a';
        lines.push(`  - scene target: ${sceneWidth}x${sceneHeight}`);
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
    win.show();
    win.focus();
    const gpuDiagnostics = await collectElectronGpuDiagnostics();
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
        // Scenarios intentionally share one BrowserWindow and run serially to avoid GPU contention.
        // eslint-disable-next-line no-await-in-loop
        results[scenario.name] = await collectScenario(win, scenario, consoleEntries);
    }

    const webglReference = await loadWebglReference();
    const evaluation = evaluatePhase6(results, webglReference, gpuDiagnostics);
    const summary = {
        generatedAt: new Date().toISOString(),
        artifactDir: ARTIFACT_DIR,
        config: {
            runProfile: RUN_PROFILE,
            capture: CAPTURE_CONFIG,
            budgets: PHASE6_BUDGETS,
            webglReferencePath: WEBGL_REFERENCE_PATH,
        },
        gpuDiagnostics,
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
    return evaluation.overallPass;
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
        const passed = await run();
        await shutdown(passed ? 0 : 1);
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
