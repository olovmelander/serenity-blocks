/**
 * Capture and lifecycle-validate exactly one registered theme in Electron.
 *
 * This file is deliberately a single-theme worker. Running several WebGPU
 * themes in one Electron/GPU process has TDR-crashed the development iGPU.
 * Use validate-all-themes.mjs to run registry-derived workers serially:
 *
 *   node scripts/validate-all-themes.mjs --theme neon-district
 *   node scripts/validate-all-themes.mjs
 *
 * Direct worker use requires an already-running server:
 *
 *   node scripts/run-electron.mjs scripts/capture-theme-screenshots.mjs \
 *     -- --theme neon-district --base-url http://127.0.0.1:4174
 */
/* eslint-disable import/no-extraneous-dependencies */
import electron from 'electron';
import {
    mkdir,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    THEME_REGISTRY,
    getThemeMeta,
} from '../src/themes/theme-registry.js';
import {
    THEME_PERF_BOOTSTRAP,
    buildPerfVisitSource,
    buildPinSource,
    reduceVisit,
} from './lib/theme-perf-instrument.mjs';
import { buildThemePerfCell } from './lib/theme-perf-cell.mjs';

const {
    app,
    BrowserWindow,
    session,
} = electron;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'docs', 'theme-screenshots');
const DEFAULT_BASE_URL = 'http://127.0.0.1:4174';
const WORKER_BOOLEAN_OPTIONS = new Set([
    'headed',
    'help',
    'perf',
]);
const WORKER_VALUE_OPTIONS = new Set([
    'base-url',
    'bootstrap-timeout-ms',
    'height',
    'out',
    'perf-idle-ms',
    'perf-out',
    'perf-profile-dir',
    'perf-quality',
    'perf-settle-ms',
    'perf-target-fps',
    'ready-timeout-ms',
    'run-id',
    'settle-ms',
    'switch-timeout-ms',
    'theme',
    'width',
]);
// Module scope on purpose: the perf switches and the userData path must be set before
// app.whenReady(), and the worker's ready handler is already past that point.
const PERF_LANE_ENABLED = process.argv.includes('--perf')
    || process.argv.some((a) => a === '--perf=true' || a === '--perf=1');
// three logs this itself when a timestamp resolve loses its buffer to a teardown. It only ever
// appears because the perf lane armed trackTimestamp, so it is an artefact of measuring, not a
// property of the theme being measured.
const INSTRUMENT_INDUCED_ERROR = /Error resolving queries/i;
const FAILURE_PATTERNS = Object.freeze([
    { id: 'wgsl', regex: /\bWGSL\b.*(?:error|invalid)|error.*\bWGSL\b/i },
    { id: 'shader_module', regex: /invalid\s+ShaderModule|shader module.*invalid/i },
    { id: 'render_pipeline', regex: /invalid\s+RenderPipeline|render pipeline.*invalid/i },
    { id: 'compute_pipeline', regex: /invalid\s+ComputePipeline|compute pipeline.*invalid/i },
    { id: 'pipeline_validation', regex: /pipeline.*validation error|validation error.*pipeline/i },
    { id: 'command_buffer', regex: /invalid\s+CommandBuffer|command buffer.*invalid/i },
    { id: 'webgpu_uncaptured', regex: /WebGPU uncaptured error|uncaptured GPU error/i },
    {
        id: 'unexpected_device_loss',
        regex: /WebGPU device lost.*(?:unknown|reason:\s*unknown)|GPUDevice.*lost unexpectedly/i,
    },
    {
        id: 'theme_lifecycle_failure',
        regex: /Failed to (?:load|switch|start).*theme|Theme .* failed to start/i,
    },
    {
        id: 'uncaught_runtime_error',
        regex: /Uncaught (?:TypeError|ReferenceError|Error)|Unhandled Promise Rejection/i,
    },
]);

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-precise-memory-info');

if (PERF_LANE_ENABLED) {
    // Without this, Electron lands on this machine's Vega 8 iGPU: there is no UserGpuPreferences
    // entry for electron.exe, so the default adapter is the integrated one. The lane records the
    // adapter it actually got, but it must at least ASK for the discrete part.
    app.commandLine.appendSwitch('force_high_performance_gpu');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    const profileFlagIndex = process.argv.indexOf('--perf-profile-dir');
    const profileDir = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : null;
    if (profileDir) {
        // A per-theme userData dir means a per-theme Dawn shader cache, so every theme's compile
        // numbers are cold-cache and comparable with each other.
        app.setPath('userData', path.resolve(ROOT, profileDir));
    }
}

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

function parseArgs(argv) {
    const parsed = {
        positionals: [],
    };
    const booleanValues = new Set([
        '0',
        '1',
        'false',
        'no',
        'off',
        'on',
        'true',
        'yes',
    ]);

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--') {
            continue;
        }
        if (!token.startsWith('--')) {
            parsed.positionals.push(token);
            continue;
        }

        const [key, inlineValue] = token.slice(2).split('=', 2);
        if (!WORKER_BOOLEAN_OPTIONS.has(key) && !WORKER_VALUE_OPTIONS.has(key)) {
            throw new Error(`Unknown option "--${key}". Use --help for supported options.`);
        }
        if (Object.hasOwn(parsed, key)) {
            throw new Error(`Option "--${key}" may only be specified once.`);
        }
        const next = argv[index + 1];
        if (inlineValue !== undefined) {
            parsed[key] = inlineValue;
        } else if (
            WORKER_BOOLEAN_OPTIONS.has(key)
            && (!next || !booleanValues.has(next.toLowerCase()))
        ) {
            parsed[key] = true;
        } else if (next && !next.startsWith('--')) {
            parsed[key] = next;
            index += 1;
        } else if (WORKER_BOOLEAN_OPTIONS.has(key)) {
            parsed[key] = true;
        } else {
            throw new Error(`Option "--${key}" requires a value.`);
        }
    }

    return parsed;
}

function parsePositiveInt(value, fallback, label) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return Math.floor(parsed);
}

function parseNonNegativeInt(value, fallback, label) {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${label} must be a non-negative integer.`);
    }
    return Math.floor(parsed);
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    throw new Error(`Expected a boolean value, received "${value}".`);
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function withTimeout(promise, timeoutMs, label) {
    let timer = null;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(`${label} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        }),
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function createConfig(argv) {
    const args = parseArgs(argv);
    if (parseBoolean(args.help, false)) {
        return Object.freeze({ help: true });
    }
    const requestedThemes = [
        ...(typeof args.theme === 'string' ? [args.theme] : []),
        ...args.positionals,
    ];

    if (requestedThemes.length !== 1) {
        throw new Error(
            'The capture worker requires exactly one --theme <id>. '
            + 'Use scripts/validate-all-themes.mjs for a registry-wide run.',
        );
    }

    const themeId = requestedThemes[0];
    const themeMeta = getThemeMeta(themeId);
    if (!themeMeta) {
        throw new Error(
            `Unknown theme "${themeId}". Registered themes: ${THEME_REGISTRY
                .map(({ id }) => id)
                .join(', ')}`,
        );
    }

    const baseUrl = new URL(
        typeof args['base-url'] === 'string'
            ? args['base-url']
            : DEFAULT_BASE_URL,
    );
    if (!['http:', 'https:'].includes(baseUrl.protocol)) {
        throw new Error('--base-url must use http: or https:.');
    }

    const runId = typeof args['run-id'] === 'string'
        ? args['run-id']
        : new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.resolve(
        ROOT,
        typeof args.out === 'string' ? args.out : DEFAULT_OUTPUT_DIR,
    );
    const anchorTheme = themeId === 'forest' ? 'mountain' : 'forest';

    return Object.freeze({
        themeId,
        themeMeta,
        anchorTheme,
        runId,
        outputDir,
        baseUrl: baseUrl.toString(),
        width: parsePositiveInt(args.width, 1920, '--width'),
        height: parsePositiveInt(args.height, 1080, '--height'),
        bootstrapTimeoutMs: parsePositiveInt(
            args['bootstrap-timeout-ms'],
            180_000,
            '--bootstrap-timeout-ms',
        ),
        switchTimeoutMs: parsePositiveInt(
            args['switch-timeout-ms'],
            90_000,
            '--switch-timeout-ms',
        ),
        readyTimeoutMs: parsePositiveInt(
            args['ready-timeout-ms'],
            30_000,
            '--ready-timeout-ms',
        ),
        settleMs: parseNonNegativeInt(args['settle-ms'], 2_000, '--settle-ms'),
        headed: parseBoolean(args.headed, false),
        perf: parseBoolean(args.perf, false),
        perfIdleMs: parseNonNegativeInt(args['perf-idle-ms'], 20_000, '--perf-idle-ms'),
        perfSettleMs: parseNonNegativeInt(args['perf-settle-ms'], 4_000, '--perf-settle-ms'),
        perfQuality: typeof args['perf-quality'] === 'string' ? args['perf-quality'] : 'High',
        perfTargetFps: parsePositiveInt(args['perf-target-fps'], 60, '--perf-target-fps'),
        perfOutputDir: path.resolve(
            ROOT,
            typeof args['perf-out'] === 'string'
                ? args['perf-out']
                : path.join(ROOT, 'reports', 'theme-perf'),
        ),
        perfProfileDir: typeof args['perf-profile-dir'] === 'string'
            ? path.resolve(ROOT, args['perf-profile-dir'])
            : null,
    });
}

function printWorkerUsage() {
    console.log(`Usage:
  node scripts/run-electron.mjs scripts/capture-theme-screenshots.mjs -- \\
    --theme <id> [options]

Validate exactly one registered theme using an already-running HTTP server.

Options:
  --theme <id>                  Registered theme id (required; one only)
  --base-url <url>              App server URL (default: ${DEFAULT_BASE_URL})
  --out <directory>             Artifact directory (default: docs/theme-screenshots)
  --run-id <id>                 Run identity used to reject stale reports
  --width <pixels>              Browser width (default: 1920)
  --height <pixels>             Browser height (default: 1080)
  --bootstrap-timeout-ms <ms>   App bootstrap timeout (default: 180000)
  --switch-timeout-ms <ms>      Per-theme switch timeout (default: 90000)
  --ready-timeout-ms <ms>       Critical-ready timeout (default: 30000)
  --settle-ms <ms>              Pre-screenshot settle time (default: 2000)
  --headed[=<boolean>]          Show the Electron window (default: false)
  --help                        Print this help without opening a window`);
}

function createTargetUrl(config) {
    const url = new URL('/', config.baseUrl);
    url.searchParams.set('skipIntro', '1');
    url.searchParams.set('noThemeWarm', '1');
    url.searchParams.set('themeValidation', '1');
    url.searchParams.set('captureBust', config.runId);
    return url.toString();
}

async function waitForServer(url, timeoutMs) {
    const startedAt = Date.now();
    let lastError = null;

    while (Date.now() - startedAt < timeoutMs) {
        try {
            // Intentional polling: the production preview may still be starting.
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

    throw new Error(
        `Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}`,
    );
}

function createWindow(config) {
    const partitionName = [
        'theme-validation',
        config.themeId.replace(/[^a-z0-9-]/gi, '-'),
        config.runId.replace(/[^a-z0-9-]/gi, '-'),
    ].join('-');
    const validationSession = session.fromPartition(partitionName, {
        cache: false,
    });

    return new BrowserWindow({
        width: config.width,
        height: config.height,
        // GPU timestamps are unavailable to an occluded surface (odyssey-gpu-split.mjs:408), so the
        // perf lane must show its window. Recorded in the cell so a future run cannot silently differ.
        show: config.headed || config.perf === true,
        backgroundColor: '#000000',
        webPreferences: {
            session: validationSession,
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
}

async function executePageFunction(win, fn, payload, timeoutMs, label) {
    const source = `(${fn.toString()})(${JSON.stringify(payload)})`;
    return withTimeout(
        win.webContents.executeJavaScript(source, true),
        timeoutMs,
        label,
    );
}

async function bootstrapThemeValidationPage(config) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const waitFor = async (predicate, timeoutMs) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (predicate()) return true;
            // Intentional in-page readiness polling.
            // eslint-disable-next-line no-await-in-loop
            await sleep(100);
        }
        return false;
    };

    const managersReady = await waitFor(
        () => Boolean(
            window.serenityBlocks?.gameModeManager
            && window.serenityBlocks?.themeManager,
        ),
        config.bootstrapTimeoutMs,
    );
    if (!managersReady) {
        return {
            ok: false,
            reason: 'Application managers were not ready in time.',
        };
    }

    const serenityApp = window.serenityBlocks;
    const {
        gameModeManager: modeManager,
        themeManager,
    } = serenityApp;
    const validationModeId = 'single';
    let currentMode = modeManager.getCurrentMode?.();

    if (
        modeManager.getCurrentModeId?.() !== validationModeId
        || !currentMode?.isRunning
    ) {
        try {
            window.dispatchEvent(new CustomEvent('startGameWithMode', {
                detail: { mode: validationModeId },
            }));
        } catch {
            // The direct manager fallback below owns bootstrap if dispatch fails.
        }

        const eventStarted = await waitFor(
            () => (
                modeManager.getCurrentModeId?.() === validationModeId
                && modeManager.getCurrentMode?.()?.isRunning === true
            ),
            Math.min(config.bootstrapTimeoutMs, 60_000),
        );

        if (!eventStarted) {
            try {
                if (modeManager.getCurrentModeId?.() !== validationModeId) {
                    await modeManager.activateMode(validationModeId);
                }
                currentMode = modeManager.getCurrentMode?.();
                if (!currentMode?.isRunning) {
                    await modeManager.startCurrentMode();
                }
            } catch (error) {
                return {
                    ok: false,
                    reason: `Failed to start gameplay mode: ${error?.message || error}`,
                };
            }
        }
    }

    currentMode = modeManager.getCurrentMode?.();
    if (
        modeManager.getCurrentModeId?.() !== validationModeId
        || !currentMode?.isRunning
    ) {
        return {
            ok: false,
            reason: 'Single-player mode did not reach a running state.',
        };
    }
    const gameState = currentMode.getGameState?.()
        ?? currentMode.gameState
        ?? null;
    if (!gameState) {
        return {
            ok: false,
            reason: 'Single-player mode did not publish a gameplay GameState.',
        };
    }

    try {
        if (!serenityApp.serenityHub) {
            await serenityApp.initializeGlobalSerenityHub?.();
        }
        serenityApp.serenityHub?.switchTab?.('themes');
    } catch (error) {
        return {
            ok: false,
            reason: `Failed to initialize the Serenity Hub: ${error?.message || error}`,
        };
    }

    themeManager.clearAdjacentThemePreloadQueue?.();
    themeManager.deferAdjacentThemePreload = true;
    // Validation owns exactly one target GPU surface. Do not let adjacency
    // preloading silently initialize another theme in the worker process.
    themeManager.queueAdjacentThemePreload = () => {};

    const modeLifecycleCalls = {
        activateMode: 0,
        startCurrentMode: 0,
        stopCurrentMode: 0,
        deactivateCurrentMode: 0,
    };
    Object.keys(modeLifecycleCalls).forEach((methodName) => {
        const original = modeManager[methodName];
        if (typeof original !== 'function') return;
        modeManager[methodName] = function validationModeLifecycleProbe(...args) {
            modeLifecycleCalls[methodName] += 1;
            return original.apply(this, args);
        };
    });
    const gameplayLifecycleCalls = {
        appStartGame: 0,
        modeOnActivate: 0,
        modeOnStart: 0,
        modeOnStop: 0,
        modeOnDeactivate: 0,
    };
    const restartSignals = {
        gameStateReset: 0,
        boardSceneRestart: 0,
        boardSceneStart: 0,
        phaserBoardSceneStart: 0,
    };
    const wrapCounterMethod = (
        owner,
        methodName,
        counters,
        counterName,
        shouldCount = () => true,
    ) => {
        const original = owner?.[methodName];
        if (typeof original !== 'function') return;
        owner[methodName] = function validationLifecycleCounter(...args) {
            if (shouldCount(args)) {
                counters[counterName] += 1;
            }
            return original.apply(this, args);
        };
    };
    wrapCounterMethod(
        serenityApp,
        'startGame',
        gameplayLifecycleCalls,
        'appStartGame',
    );
    wrapCounterMethod(
        currentMode,
        'onActivate',
        gameplayLifecycleCalls,
        'modeOnActivate',
    );
    wrapCounterMethod(
        currentMode,
        'onStart',
        gameplayLifecycleCalls,
        'modeOnStart',
    );
    wrapCounterMethod(
        currentMode,
        'onStop',
        gameplayLifecycleCalls,
        'modeOnStop',
    );
    wrapCounterMethod(
        currentMode,
        'onDeactivate',
        gameplayLifecycleCalls,
        'modeOnDeactivate',
    );
    wrapCounterMethod(gameState, 'reset', restartSignals, 'gameStateReset');

    let boardScene = null;
    try {
        boardScene = currentMode._getBoardScene?.()
            ?? currentMode.deps?.phaserGame?.scene?.getScene?.('BoardScene')
            ?? null;
    } catch {
        // The mode/session probes remain authoritative when Phaser is unavailable.
    }
    wrapCounterMethod(
        boardScene?.scene,
        'restart',
        restartSignals,
        'boardSceneRestart',
    );
    wrapCounterMethod(
        boardScene?.scene,
        'start',
        restartSignals,
        'boardSceneStart',
    );
    wrapCounterMethod(
        currentMode.deps?.phaserGame?.scene,
        'start',
        restartSignals,
        'phaserBoardSceneStart',
        (args) => args[0] === 'BoardScene',
    );

    window.__themeCaptureLifecycleProbe = {
        mode: currentMode,
        modeId: modeManager.getCurrentModeId?.(),
        gameState,
        activeSession: currentMode._activeSession ?? null,
        sessionGeneration: currentMode._sessionGeneration ?? null,
        modeLifecycleCalls,
        gameplayLifecycleCalls,
        restartSignals,
        deterministicPauseApplied: false,
    };

    try {
        if (!currentMode.isPaused) {
            modeManager.pauseCurrentMode?.({
                reason: 'theme-lifecycle-validation',
            });
        }
    } catch (error) {
        return {
            ok: false,
            reason: `Failed to freeze validation gameplay: ${error?.message || error}`,
        };
    }
    const deterministicPauseApplied = currentMode.isPaused === true;
    window.__themeCaptureLifecycleProbe.deterministicPauseApplied = deterministicPauseApplied;
    if (!deterministicPauseApplied) {
        return {
            ok: false,
            reason: 'Single-player gameplay could not be paused for deterministic validation.',
        };
    }

    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    return {
        ok: true,
        modeId: modeManager.getCurrentModeId?.(),
        modeRunning: currentMode.isRunning === true,
        gameStateReady: Boolean(gameState),
        sessionGeneration: currentMode._sessionGeneration ?? null,
        deterministicPauseApplied,
        initialTheme: themeManager.activeThemeName,
        hubReady: Boolean(serenityApp.serenityHub),
    };
}

async function exerciseThemeLifecyclePage(config) {
    const appInstance = window.serenityBlocks;
    const manager = appInstance?.themeManager;
    const modeManager = appInstance?.gameModeManager;
    const probe = window.__themeCaptureLifecycleProbe;
    const checks = [];
    const timings = {};
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const waitFor = async (predicate, timeoutMs) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (predicate()) return true;
            // Intentional in-page lifecycle polling.
            // eslint-disable-next-line no-await-in-loop
            await sleep(100);
        }
        return false;
    };
    const bounded = async (promise, timeoutMs, label) => {
        let timer = null;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
                    }, timeoutMs);
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };
    const record = (id, passed, details = null) => {
        checks.push({
            id,
            passed: Boolean(passed),
            details,
        });
        return Boolean(passed);
    };
    const isRegistryOwned = (element) => (
        element?.dataset?.themeRegistryOwned === 'true'
        || element?.getAttribute?.('data-theme-registry-owned') === 'true'
        || element?.__themeRegistryOwned === true
    );
    const activeContainerIds = () => Array.from(
        document.querySelectorAll('.theme-container.active'),
        (element) => element.id,
    );
    const modeSnapshot = () => {
        const currentMode = modeManager.getCurrentMode?.();
        return {
            modeId: modeManager.getCurrentModeId?.(),
            sameMode: currentMode === probe.mode,
            sameGameState: (
                currentMode?.getGameState?.()
                    ?? currentMode?.gameState
                    ?? null
            ) === probe.gameState,
            sameActiveSession: (
                probe.activeSession == null
                || currentMode?._activeSession === probe.activeSession
            ),
            sameSessionGeneration: (
                probe.sessionGeneration == null
                || currentMode?._sessionGeneration === probe.sessionGeneration
            ),
            running: currentMode?.isRunning === true,
            paused: currentMode?.isPaused === true,
            lifecycleCalls: { ...probe.modeLifecycleCalls },
            gameplayLifecycleCalls: { ...probe.gameplayLifecycleCalls },
            restartSignals: { ...probe.restartSignals },
        };
    };
    const ensureValidationPaused = (suffix) => {
        const currentMode = modeManager.getCurrentMode?.();
        if (
            currentMode === probe.mode
            && currentMode?.isRunning
            && !currentMode.isPaused
        ) {
            modeManager.pauseCurrentMode?.({
                reason: `theme-lifecycle-validation:${suffix}`,
            });
        }
        return record(
            `deterministic-gameplay-paused-${suffix}`,
            currentMode === probe.mode && currentMode?.isPaused === true,
            {
                sameMode: currentMode === probe.mode,
                running: currentMode?.isRunning === true,
                paused: currentMode?.isPaused === true,
            },
        );
    };
    const assertModeOwnership = (suffix) => {
        const snapshot = modeSnapshot();
        record(`mode-id-${suffix}`, snapshot.modeId === probe.modeId, snapshot);
        record(`mode-identity-${suffix}`, snapshot.sameMode, snapshot);
        record(`game-state-identity-${suffix}`, snapshot.sameGameState, snapshot);
        record(`active-session-identity-${suffix}`, snapshot.sameActiveSession, snapshot);
        record(
            `session-generation-${suffix}`,
            snapshot.sameSessionGeneration,
            snapshot,
        );
        record(`mode-running-${suffix}`, snapshot.running, snapshot);
        record(`mode-paused-${suffix}`, snapshot.paused, snapshot);
        record(
            `no-mode-lifecycle-call-${suffix}`,
            Object.values(snapshot.lifecycleCalls).every((count) => count === 0)
                && Object.values(snapshot.gameplayLifecycleCalls)
                    .every((count) => count === 0),
            {
                manager: snapshot.lifecycleCalls,
                gameplay: snapshot.gameplayLifecycleCalls,
            },
        );
        record(
            `no-gameplay-restart-signal-${suffix}`,
            Object.values(snapshot.restartSignals).every((count) => count === 0),
            snapshot.restartSignals,
        );
    };
    const awaitCriticalReady = async (theme, suffix) => {
        if (typeof theme?.whenCriticalReady !== 'function') {
            record(`critical-ready-${suffix}`, true, 'No readiness hook.');
            return;
        }
        try {
            const ready = await bounded(
                Promise.resolve(theme.whenCriticalReady()),
                config.readyTimeoutMs,
                `${theme.name} whenCriticalReady`,
            );
            record(`critical-ready-${suffix}`, ready !== false, { value: ready });
        } catch (error) {
            record(
                `critical-ready-${suffix}`,
                false,
                error?.message || String(error),
            );
        }
    };
    const probeRenderActivity = async (theme) => {
        const dedicatedOwners = [
            theme?.renderer,
            theme?.runtime,
            theme?.post,
            theme?.postProcessing,
            theme?.postComposer,
            theme?.composer,
        ].filter((owner, index, values) => (
            owner
            && owner !== theme?.webglRenderer
            && values.indexOf(owner) === index
        ));
        // Lightweight/DOM themes render through the shared background renderer
        // instead of owning a dedicated Three renderer. Probe that owner when
        // there is no theme-local render surface so frozen shared themes cannot
        // silently pass as "unsupported".
        const owners = dedicatedOwners.length > 0
            ? dedicatedOwners
            : [theme?.webglRenderer].filter(Boolean);
        const evidenceType = dedicatedOwners.length > 0
            ? 'theme-owned-renderer'
            : 'shared-background-renderer';
        const patches = [];
        let renderCalls = 0;
        const heartbeatFields = [
            'animationFrameId',
            'animationFrame',
            'rafId',
            'animationId',
            '_shapeFadeRaf',
        ];
        const snapshotThemeHeartbeat = () => {
            const snapshot = {};
            if (
                Array.isArray(theme?.animationIds)
                && theme.animationIds.length > 0
            ) {
                const animationId = theme.animationIds[theme.animationIds.length - 1];
                if (Number.isFinite(animationId)) {
                    snapshot.animationIds = animationId;
                }
            }
            heartbeatFields.forEach((fieldName) => {
                if (Number.isFinite(theme?.[fieldName])) {
                    snapshot[fieldName] = theme[fieldName];
                }
            });
            return snapshot;
        };
        const initialHeartbeat = snapshotThemeHeartbeat();
        const heartbeatKeys = Object.keys(initialHeartbeat);
        const changedHeartbeatFields = new Set();
        const sharedRendererHeartbeatFields = [
            'animationFrameId',
            'animationFrame',
            'rafId',
        ];
        const snapshotSharedRendererHeartbeat = () => {
            if (evidenceType !== 'shared-background-renderer') return {};
            const snapshot = {};
            sharedRendererHeartbeatFields.forEach((fieldName) => {
                if (Number.isFinite(owners[0]?.[fieldName])) {
                    snapshot[fieldName] = owners[0][fieldName];
                }
            });
            return snapshot;
        };
        const initialSharedRendererHeartbeat = snapshotSharedRendererHeartbeat();
        const sharedRendererHeartbeatKeys = Object.keys(initialSharedRendererHeartbeat);
        const changedSharedRendererHeartbeatFields = new Set();
        const observeThemeHeartbeat = () => {
            const currentHeartbeat = snapshotThemeHeartbeat();
            heartbeatKeys.forEach((fieldName) => {
                if (
                    Number.isFinite(currentHeartbeat[fieldName])
                    && currentHeartbeat[fieldName] !== initialHeartbeat[fieldName]
                ) {
                    changedHeartbeatFields.add(fieldName);
                }
            });
            const currentSharedRendererHeartbeat = snapshotSharedRendererHeartbeat();
            sharedRendererHeartbeatKeys.forEach((fieldName) => {
                if (
                    Number.isFinite(currentSharedRendererHeartbeat[fieldName])
                    && currentSharedRendererHeartbeat[fieldName]
                        !== initialSharedRendererHeartbeat[fieldName]
                ) {
                    changedSharedRendererHeartbeatFields.add(fieldName);
                }
            });
        };

        owners.forEach((owner) => {
            // The shared WebGL background is driven by Phaser through
            // renderFrame(), while dedicated Three renderers generally expose
            // render()/renderAsync(). Probe every public entry point.
            ['render', 'renderAsync', 'renderFrame'].forEach((methodName) => {
                const original = owner?.[methodName];
                if (typeof original !== 'function') return;
                const wrapped = function validationRenderProbe(...args) {
                    renderCalls += 1;
                    return original.apply(this, args);
                };
                owner[methodName] = wrapped;
                patches.push({
                    owner,
                    methodName,
                    original,
                    wrapped,
                });
            });
        });

        const startedAt = performance.now();
        try {
            const hasRequiredEvidence = () => (
                (
                    renderCalls > 0
                    || changedSharedRendererHeartbeatFields.size > 0
                )
                && (
                    evidenceType === 'theme-owned-renderer'
                    || heartbeatKeys.length === 0
                    || changedHeartbeatFields.size > 0
                )
            );
            while (!hasRequiredEvidence() && performance.now() - startedAt < 1_200) {
                // Intentional bounded render observation.
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => {
                    requestAnimationFrame(resolve);
                });
                observeThemeHeartbeat();
            }
        } finally {
            patches.forEach((patch) => {
                if (patch.owner[patch.methodName] === patch.wrapped) {
                    patch.owner[patch.methodName] = patch.original;
                }
            });
        }

        return {
            evidenceType,
            // Raw WebGPU themes may own their command encoder directly rather
            // than exposing a Three-style render() method. Their lifecycle-bound
            // RAF heartbeat plus the pixel-content screenshot is the observable
            // render contract.
            supported: patches.length > 0 || heartbeatKeys.length > 0,
            renderCalls,
            sharedRendererMatchesThemeReference: (
                evidenceType !== 'shared-background-renderer'
                || owners[0] === theme?.webglRenderer
            ),
            themeOwnedHeartbeatAvailable: heartbeatKeys.length > 0,
            themeOwnedHeartbeatObserved: changedHeartbeatFields.size > 0,
            heartbeatFields: heartbeatKeys,
            changedHeartbeatFields: [...changedHeartbeatFields],
            sharedRendererHeartbeatAvailable: sharedRendererHeartbeatKeys.length > 0,
            sharedRendererHeartbeatObserved:
                changedSharedRendererHeartbeatFields.size > 0,
            sharedRendererHeartbeatFields: sharedRendererHeartbeatKeys,
            changedSharedRendererHeartbeatFields: [
                ...changedSharedRendererHeartbeatFields,
            ],
        };
    };
    const renderProbePassed = (renderProbe) => (
        renderProbe.supported
        && (
            renderProbe.renderCalls > 0
            || renderProbe.themeOwnedHeartbeatObserved
            || (
                renderProbe.evidenceType === 'shared-background-renderer'
                && renderProbe.sharedRendererHeartbeatObserved
            )
        )
        && renderProbe.sharedRendererMatchesThemeReference
        && (
            renderProbe.evidenceType === 'theme-owned-renderer'
            || !renderProbe.themeOwnedHeartbeatAvailable
            || renderProbe.themeOwnedHeartbeatObserved
        )
    );
    const assertActiveTheme = async (themeId, suffix) => {
        const theme = manager.activeTheme;
        record(
            `active-name-${suffix}`,
            manager.activeThemeName === themeId,
            { actual: manager.activeThemeName, expected: themeId },
        );
        record(
            `active-instance-name-${suffix}`,
            theme?.name === themeId,
            { actual: theme?.name, expected: themeId },
        );
        record(`active-flag-${suffix}`, theme?.isActive === true, {
            actual: theme?.isActive,
        });
        record(
            `running-lifecycle-${suffix}`,
            theme?.lifecycleState === 'running',
            { actual: theme?.lifecycleState },
        );
        record(`not-cleaned-${suffix}`, theme?.cleanupComplete !== true, {
            actual: theme?.cleanupComplete,
        });
        record(
            `active-cache-identity-${suffix}`,
            manager.themeInstances?.get?.(themeId) === theme,
        );
        record(
            `no-pending-theme-${suffix}`,
            manager.pendingThemeInstance == null && manager.pendingThemeName == null,
            {
                pendingName: manager.pendingThemeName,
                hasPendingInstance: Boolean(manager.pendingThemeInstance),
            },
        );
        const containers = activeContainerIds();
        record(
            `single-active-container-${suffix}`,
            containers.length === 1 && containers[0] === `${themeId}-theme`,
            containers,
        );
        await awaitCriticalReady(theme, suffix);
        await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        return theme;
    };
    const switchExact = async (themeId, suffix) => {
        const startedAt = performance.now();
        try {
            const result = await bounded(
                manager.switchTheme(themeId, true),
                config.switchTimeoutMs,
                `switchTheme(${themeId})`,
            );
            timings[suffix] = performance.now() - startedAt;
            record(
                `switch-result-${suffix}`,
                result === themeId,
                { actual: result, expected: themeId },
            );
            await assertActiveTheme(themeId, suffix);
            return result === themeId;
        } catch (error) {
            timings[suffix] = performance.now() - startedAt;
            record(`switch-result-${suffix}`, false, error?.message || String(error));
            return false;
        }
    };
    const selectTargetViaCard = async (themeId) => {
        const hub = appInstance.serenityHub;
        try {
            hub?.show?.();
            hub?.switchTab?.('themes');
            const tabReady = await waitFor(
                () => Boolean(hub?.themesTab?.tabContainer),
                10_000,
            );
            record('hub-themes-tab-ready', tabReady);
            if (!tabReady) return false;

            const card = hub.themesTab.tabContainer.querySelector(
                `.theme-card[data-theme="${themeId}"]`,
            );
            record('target-theme-card-present', Boolean(card), { themeId });
            if (!card) return false;

            const generationBefore = hub.themesTab.themeSelectionGeneration;
            card.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
            }));

            const selectionStarted = await waitFor(
                () => hub.themesTab.themeSelectionGeneration > generationBefore,
                2_000,
            );
            record('theme-card-selection-started', selectionStarted);
            const selectionSettled = selectionStarted && await waitFor(
                () => (
                    !manager.isTransitioning
                    && !manager.switchDrainPromise
                    && !manager.queuedSwitchRequest
                ),
                config.switchTimeoutMs,
            );
            record('theme-card-selection-settled', selectionSettled);
            record(
                'theme-card-applied-target',
                selectionSettled && manager.activeThemeName === themeId,
                { actual: manager.activeThemeName, expected: themeId },
            );
            const activeStateSettled = selectionSettled && await waitFor(
                () => (
                    card.classList.contains('active')
                    && card.getAttribute('aria-pressed') === 'true'
                ),
                2_000,
            );
            record(
                'theme-card-active-state',
                activeStateSettled,
                {
                    activeClass: card.classList.contains('active'),
                    ariaPressed: card.getAttribute('aria-pressed'),
                },
            );

            const settings = appInstance.settingsManager?.get?.();
            if (settings && Object.hasOwn(settings, 'backgroundTheme')) {
                const settingSettled = await waitFor(
                    () => (
                        appInstance.settingsManager?.get?.()?.backgroundTheme
                        === themeId
                    ),
                    2_000,
                );
                record(
                    'theme-setting-committed',
                    settingSettled,
                    {
                        actual: appInstance.settingsManager?.get?.()?.backgroundTheme,
                        expected: themeId,
                    },
                );
            }
            return selectionSettled && manager.activeThemeName === themeId;
        } catch (error) {
            record('theme-card-selection', false, error?.message || String(error));
            return false;
        } finally {
            hub?.hide?.();
            ensureValidationPaused('after-card-hide');
        }
    };

    if (!appInstance || !manager || !modeManager || !probe) {
        return {
            ok: false,
            checks: [{
                id: 'validation-prerequisites',
                passed: false,
                details: 'Missing app, managers, or bootstrap probe.',
            }],
            timings,
        };
    }
    record(
        'deterministic-gameplay-freeze-installed',
        probe.deterministicPauseApplied === true,
    );
    ensureValidationPaused('before-switches');

    const anchorReady = await switchExact(config.anchorTheme, 'initial-anchor');
    if (!anchorReady) {
        return {
            ok: false,
            checks,
            timings,
        };
    }

    // The Phaser scene restart triggered by the initial Single Player boot can
    // settle asynchronously after the probe is installed. The initial anchor
    // wait is our fully-running baseline; only signals after this point belong
    // to the theme-card interaction under test.
    [
        probe.modeLifecycleCalls,
        probe.gameplayLifecycleCalls,
        probe.restartSignals,
    ].forEach((counters) => {
        Object.keys(counters).forEach((counterName) => {
            counters[counterName] = 0;
        });
    });

    const targetContainerBefore = document.getElementById(`${config.themeId}-theme`);
    const targetDescendantBaseline = targetContainerBefore?.querySelectorAll('*').length ?? 0;
    const targetCanvasBaseline = targetContainerBefore?.querySelectorAll('canvas').length ?? 0;
    const canvasesBeforeTarget = new Set(document.querySelectorAll('canvas'));

    const firstSelectionStartedAt = performance.now();
    const selectedViaCard = await selectTargetViaCard(config.themeId);
    timings.firstTargetSelection = performance.now() - firstSelectionStartedAt;
    if (!selectedViaCard) {
        return {
            ok: false,
            checks,
            timings,
            mode: modeSnapshot(),
        };
    }

    const firstTarget = await assertActiveTheme(config.themeId, 'first-target');
    const firstRenderProbe = await probeRenderActivity(firstTarget);
    record(
        'first-target-render-activity',
        renderProbePassed(firstRenderProbe),
        firstRenderProbe,
    );
    assertModeOwnership('after-first-target');

    const targetContainer = document.getElementById(`${config.themeId}-theme`);
    const targetRegisteredContainers = Array.isArray(firstTarget?.containers)
        ? [...firstTarget.containers]
        : [];
    const targetSharedRenderer = firstTarget?.webglRenderer ?? null;
    const targetDedicatedRenderer = (
        firstTarget?.renderer
        && firstTarget.renderer !== targetSharedRenderer
    )
        ? firstTarget.renderer
        : null;
    const addedTargetCanvases = Array.from(document.querySelectorAll('canvas'))
        .filter((canvas) => !canvasesBeforeTarget.has(canvas));

    const cleanupAnchorReady = await switchExact(config.anchorTheme, 'cleanup-anchor');
    if (!cleanupAnchorReady) {
        return {
            ok: false,
            checks,
            timings,
            mode: modeSnapshot(),
        };
    }
    await sleep(250);

    record('outgoing-cleanup-complete', firstTarget?.cleanupComplete === true, {
        actual: firstTarget?.cleanupComplete,
    });
    record('outgoing-inactive', firstTarget?.isActive === false, {
        actual: firstTarget?.isActive,
    });
    record(
        'outgoing-stopped',
        firstTarget?.lifecycleState === 'stopped',
        { actual: firstTarget?.lifecycleState },
    );
    record(
        'outgoing-evicted',
        !manager.themeInstances?.has?.(config.themeId),
    );
    record(
        'outgoing-not-manager-owned',
        manager.activeTheme !== firstTarget
            && manager.pendingThemeInstance !== firstTarget,
    );
    [
        ['animationIds', firstTarget?.animationIds],
        ['intervals', firstTarget?._intervals],
        ['timeouts', firstTarget?._timeouts],
        ['eventListeners', firstTarget?._eventListeners],
        ['eventUnsubscribers', firstTarget?.eventUnsubscribers],
        ['containers', firstTarget?.containers],
        ['webglLayers', firstTarget?.webglLayers],
    ].forEach(([name, value]) => {
        if (Array.isArray(value)) {
            record(`outgoing-${name}-cleared`, value.length === 0, {
                count: value.length,
            });
        }
    });
    record('outgoing-scene-released', firstTarget?.scene == null, {
        hasScene: Boolean(firstTarget?.scene),
    });
    record('outgoing-shared-renderer-released', firstTarget?.webglRenderer == null, {
        hasSharedRenderer: Boolean(firstTarget?.webglRenderer),
    });
    const isTerminalRuntimeReference = (value) => (
        value == null
        || value.disposed === true
        || value.isDisposed === true
        || value._disposed === true
        || value.destroyed === true
        || value.isDestroyed === true
        || value.cleanupComplete === true
        || value.disposeComplete === true
    );
    if (targetDedicatedRenderer) {
        record(
            'outgoing-dedicated-renderer-terminal',
            isTerminalRuntimeReference(firstTarget?.renderer),
            {
                fieldCleared: firstTarget?.renderer == null,
                terminalMarker: (
                    firstTarget?.renderer != null
                    && isTerminalRuntimeReference(firstTarget.renderer)
                ),
                canvasConnected: Boolean(targetDedicatedRenderer.domElement?.isConnected),
            },
        );
    } else {
        record(
            'outgoing-renderer-field-cleared-or-shared',
            firstTarget?.renderer == null
                || firstTarget?.renderer === targetSharedRenderer,
            {
                fieldCleared: firstTarget?.renderer == null,
                retainsExpectedSharedRenderer: (
                    firstTarget?.renderer === targetSharedRenderer
                    && targetSharedRenderer != null
                ),
            },
        );
    }
    [
        'camera',
        'post',
        'postProcessing',
        'postComposer',
        'composer',
        'simulator',
        'particleSystem',
    ].forEach((fieldName) => {
        const value = firstTarget?.[fieldName];
        record(
            `outgoing-${fieldName}-terminal`,
            isTerminalRuntimeReference(value),
            {
                fieldCleared: value == null,
                terminalMarker: value != null && isTerminalRuntimeReference(value),
                type: value?.constructor?.name || null,
            },
        );
    });
    record(
        'outgoing-registered-containers-retired',
        targetRegisteredContainers.every((container) => (
            !container?.isConnected
            || (
                isRegistryOwned(container)
                && !container.classList?.contains?.('active')
            )
        )),
        { registeredCount: targetRegisteredContainers.length },
    );
    record(
        'outgoing-canvases-disconnected',
        addedTargetCanvases.every((canvas) => !canvas.isConnected),
        {
            added: addedTargetCanvases.length,
            connected: addedTargetCanvases.filter((canvas) => canvas.isConnected).length,
        },
    );
    record(
        'outgoing-container-inactive',
        !targetContainer?.classList?.contains?.('active'),
    );
    record(
        'outgoing-container-descendants-restored',
        (targetContainer?.querySelectorAll('*').length ?? 0) <= targetDescendantBaseline,
        {
            baseline: targetDescendantBaseline,
            actual: targetContainer?.querySelectorAll('*').length ?? 0,
        },
    );
    record(
        'outgoing-container-canvases-restored',
        (targetContainer?.querySelectorAll('canvas').length ?? 0) <= targetCanvasBaseline,
        {
            baseline: targetCanvasBaseline,
            actual: targetContainer?.querySelectorAll('canvas').length ?? 0,
        },
    );
    assertModeOwnership('after-cleanup');

    const hub = appInstance.serenityHub;
    let secondSelectionResult = null;
    const secondSelectionStartedAt = performance.now();
    try {
        hub?.switchTab?.('themes');
        secondSelectionResult = await bounded(
            hub?.themesTab?.selectTheme?.(config.themeId),
            config.switchTimeoutMs,
            `ThemesTab.selectTheme(${config.themeId})`,
        );
        record(
            'second-target-selection',
            manager.activeThemeName === config.themeId,
            { activeThemeName: manager.activeThemeName },
        );
    } catch (error) {
        record('second-target-selection', false, error?.message || String(error));
    } finally {
        hub?.hide?.();
        ensureValidationPaused('after-second-selection');
    }
    timings.secondTargetSelection = performance.now() - secondSelectionStartedAt;

    const secondTarget = await assertActiveTheme(config.themeId, 'second-target');
    record(
        'fresh-second-instance',
        Boolean(secondTarget) && secondTarget !== firstTarget,
    );
    const secondRenderProbe = await probeRenderActivity(secondTarget);
    record(
        'second-target-render-activity',
        renderProbePassed(secondRenderProbe),
        secondRenderProbe,
    );
    assertModeOwnership('after-second-target');

    return {
        ok: checks.every((check) => check.passed),
        checks,
        timings,
        mode: modeSnapshot(),
        firstRenderProbe,
        secondRenderProbe,
        secondSelectionReturned: secondSelectionResult ?? null,
        activeTheme: {
            name: manager.activeThemeName,
            instanceName: manager.activeTheme?.name,
            isActive: manager.activeTheme?.isActive === true,
            lifecycleState: manager.activeTheme?.lifecycleState,
            activeContainerIds: activeContainerIds(),
        },
    };
}

async function hideCaptureUiPage() {
    window.serenityBlocks?.serenityHub?.hide?.();
    window.perfMonitor?.hide?.();
    try {
        window.breathingIndicator?.stop?.();
    } catch {
        // Screenshot cleanup is best effort after lifecycle validation.
    }

    const hiddenIds = [
        'serenity-hub-icon',
        'settings-btn-global',
        'enhanced-breathing-indicator',
        'single-player-container',
        'multiplayer-container',
        'stats-panel',
        'next-pieces',
        'game-controls',
        'infinity-hud',
        'odyssey-hud',
        'serenity-shortcuts-overlay',
        'gamepad-hints-overlay',
        'game-container',
        'demo-indicator',
        'performance-overlay',
    ];
    hiddenIds.forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
    document.querySelectorAll(
        '.modal-overlay, .modal-backdrop, .serenity-hub-backdrop',
    ).forEach((element) => {
        element.style.display = 'none';
    });
    document.body.style.cursor = 'none';

    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return true;
}

function analyzeScreenshot(image) {
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const pixelCount = Math.floor(bitmap.length / 4);
    const sampleStep = Math.max(1, Math.floor(pixelCount / 20_000));
    let count = 0;
    let sum = 0;
    let sumSquares = 0;
    let min = 255;
    let max = 0;

    for (let pixel = 0; pixel < pixelCount; pixel += sampleStep) {
        const offset = pixel * 4;
        const blue = bitmap[offset];
        const green = bitmap[offset + 1];
        const red = bitmap[offset + 2];
        const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
        min = Math.min(min, luminance);
        max = Math.max(max, luminance);
        sum += luminance;
        sumSquares += luminance * luminance;
        count += 1;
    }

    const mean = count > 0 ? sum / count : 0;
    const variance = count > 0
        ? Math.max(0, (sumSquares / count) - (mean * mean))
        : 0;
    const luminanceRange = max - min;
    const passed = !image.isEmpty()
        && size.width > 0
        && size.height > 0
        && count > 0
        && luminanceRange >= 4
        && variance >= 1;

    return {
        passed,
        width: size.width,
        height: size.height,
        byteLength: bitmap.length,
        samples: count,
        luminance: {
            min,
            max,
            mean,
            range: luminanceRange,
            variance,
        },
    };
}

function serializeConsoleEntry(entry) {
    return {
        timestamp: new Date(entry.timestamp).toISOString(),
        level: entry.level,
        message: entry.message,
        line: entry.line,
        sourceId: entry.sourceId,
    };
}

function summarizeConsole(entries, processFailures) {
    const errors = entries.filter((entry) => entry.level >= 3);
    const warnings = entries.filter((entry) => entry.level === 2);
    const patternFailures = FAILURE_PATTERNS.map((rule) => {
        const matches = entries.filter((entry) => rule.regex.test(entry.message));
        return {
            id: rule.id,
            count: matches.length,
            samples: matches.slice(0, 5).map(serializeConsoleEntry),
        };
    }).filter((entry) => entry.count > 0);

    return {
        ok: (
            errors.length === 0
            && patternFailures.length === 0
            && processFailures.length === 0
        ),
        entryCount: entries.length,
        warningCount: warnings.length,
        errorCount: errors.length,
        processFailureCount: processFailures.length,
        shaderPipelineFailureCount: patternFailures.reduce(
            (sum, entry) => sum + entry.count,
            0,
        ),
        patternFailures,
        errorSamples: errors.slice(0, 20).map(serializeConsoleEntry),
        warningSamples: warnings.slice(0, 20).map(serializeConsoleEntry),
        processFailures,
    };
}

function buildConsoleLog(entries) {
    return entries.map((entry) => (
        `[${new Date(entry.timestamp).toISOString()}][L${entry.level}] `
        + `${entry.sourceId || '<unknown>'}:${entry.line || 0} ${entry.message}`
    )).join('\n');
}

async function collectGpuDiagnostics() {
    const [gpuInfo, featureStatus] = await Promise.all([
        app.getGPUInfo('basic').catch((error) => ({
            error: error?.message || String(error),
        })),
        Promise.resolve(app.getGPUFeatureStatus()).catch((error) => ({
            error: error?.message || String(error),
        })),
    ]);
    return {
        gpuInfo,
        featureStatus,
    };
}

async function writeArtifacts(config, {
    report,
    consoleEntries,
    screenshotImage,
}) {
    const resultsDir = path.join(config.outputDir, 'results');
    const logsDir = path.join(config.outputDir, 'logs');
    await Promise.all([
        mkdir(config.outputDir, { recursive: true }),
        mkdir(resultsDir, { recursive: true }),
        mkdir(logsDir, { recursive: true }),
    ]);

    if (screenshotImage && !screenshotImage.isEmpty()) {
        await writeFile(
            path.join(config.outputDir, `${config.themeId}.png`),
            screenshotImage.toPNG(),
        );
    }
    await Promise.all([
        writeFile(
            path.join(resultsDir, `${config.themeId}.json`),
            JSON.stringify(report, null, 2),
            'utf8',
        ),
        writeFile(
            path.join(logsDir, `${config.themeId}.log`),
            `${buildConsoleLog(consoleEntries)}\n`,
            'utf8',
        ),
    ]);

    // The standalone cell, so a gate can read a directory of cells without parsing the whole
    // validation report (the shape perf-budgets-gate.mjs already expects of a baseline dir).
    if (report.perf) {
        await mkdir(config.perfOutputDir, { recursive: true });
        await writeFile(
            path.join(config.perfOutputDir, `${config.themeId}.json`),
            `${JSON.stringify(report.perf, null, 2)}\n`,
            'utf8',
        );
    }
}

/**
 * Install the document-start instrument through CDP.
 *
 * `Page.addScriptToEvaluateOnNewDocument` is the only seam that runs before the page's own
 * scripts. An `executeJavaScript` after `loadURL` is far too late: the app builds a whole theme
 * during boot, so its pipeline set would already have compiled unobserved. A `preload` cannot do
 * it either — the worker runs with `contextIsolation: true`, and an isolated world has its own
 * copies of the built-in prototypes, so a `GPUDevice.prototype` patch there is invisible to the page.
 */
async function installThemePerfInstrument(win) {
    // Prime a renderer process first. `debugger.sendCommand` HANGS on a window that has never
    // navigated, because there is no renderer to answer it — the same trap
    // `odyssey-perf-session.mjs:380` records for its CPU profiler, which works around it by
    // attaching on 'did-navigate'. That is too late here: the bootstrap must be registered before
    // the app's first script runs. about:blank gives us a live renderer without loading the app,
    // and `Page.addScriptToEvaluateOnNewDocument` persists across the navigation that follows.
    await win.loadURL('about:blank');
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await Promise.all(['Page.enable', 'Runtime.enable', 'HeapProfiler.enable'].map(
        (cmd) => withTimeout(dbg.sendCommand(cmd), 15_000, `CDP ${cmd}`),
    ));
    await withTimeout(
        dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: THEME_PERF_BOOTSTRAP }),
        15_000,
        'CDP addScriptToEvaluateOnNewDocument',
    );
}

function perfLog(message) {
    // Progress on stdout: the orchestrator echoes the worker, so a hang says WHERE it hung instead
    // of producing a silent worker-timeout kill with no report (which is how the first run was lost).
    console.log(`[ThemePerf] ${message}`);
}

async function evalInPage(win, source, timeoutMs, label) {
    try {
        return await withTimeout(
            win.webContents.executeJavaScript(source, true),
            timeoutMs,
            label,
        );
    } catch (error) {
        // The page keeps running after our race rejects, so ask it how far it got.
        let stage = null;
        try {
            stage = await withTimeout(
                win.webContents.executeJavaScript('window.__THEME_PERF_STAGE__ || null', true),
                5_000,
                'stage probe',
            );
        } catch { /* the page is wedged; the label alone has to do */ }
        throw new Error(`${label} failed: ${error?.message || error}${stage ? ` (page stage: ${stage})` : ''}`);
    }
}

/** Read the live heap without a GC in the way. Used to bracket the idle window. */
async function heapUsage(win) {
    try {
        const r = await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
        return { usedSize: r.usedSize, totalSize: r.totalSize };
    } catch {
        return null;
    }
}

// three 0.185.1's WebGPUBackend never stores its adapter, so the renderer-side probe is always
// null on r185. Ask the platform directly, at COLLECTION time only — requestAdapter is GPU work
// and must not land inside a measurement window. `webglRendererString` is the ground truth on
// Windows, where WebGPU's adapter.info comes back empty.
const PERF_ADAPTER_SOURCE = `(async () => {
  const info = (a) => (a && a.info ? {
    vendor: a.info.vendor ?? null, architecture: a.info.architecture ?? null,
    device: a.info.device ?? null, description: a.info.description ?? null } : null);
  let plain = null; let asThreeAsks = null;
  try { plain = info(await navigator.gpu?.requestAdapter?.()); } catch (_) {}
  try {
    asThreeAsks = info(await navigator.gpu?.requestAdapter?.({
      powerPreference: 'high-performance', featureLevel: 'compatibility', xrCompatible: false }));
  } catch (_) {}
  let webglRendererString = null;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) webglRendererString = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  } catch (_) {}
  return { plain, asThreeAsks, webglRendererString, requestedPowerPreference: 'high-performance' };
})()`;

/**
 * Drive both visits and build the committed cell.
 *
 * Visit 1 is the cold-in-process build (the boot theme is `forest`, and `anchorTheme` is chosen so
 * the target is never the boot theme). Visit 2 exists for the content-match guard and the drift
 * bound — not to be averaged with visit 1.
 */
async function runThemePerfLane(win, config, gpuDiagnostics) {
    const { themeId, anchorTheme } = config;
    // Every page-side await inside the visit is itself bounded, so this is a backstop, not the
    // primary guard. It must leave the worker enough room to still WRITE its report before the
    // orchestrator's own timeout kills the process.
    const visitTimeout = config.perfIdleMs + config.perfSettleMs + 200_000;

    perfLog(`lane start: target=${themeId} anchor=${anchorTheme} idle=${config.perfIdleMs}ms`);
    await evalInPage(
        win,
        buildPinSource({ quality: config.perfQuality, targetFps: config.perfTargetFps }),
        20_000,
        'perf pins',
    );
    perfLog('pinning quality/fps — done');

    // Park on the anchor first so visit 1 measures a real switch INTO the target.
    await evalInPage(
        win,
        `(async () => { const m = window.serenityBlocks && window.serenityBlocks.themeManager;
          if (m) await m.switchTheme(${JSON.stringify(anchorTheme)}, true); return true; })()`,
        config.switchTimeoutMs + 30_000,
        'perf anchor park',
    );
    perfLog('parking on the anchor theme — done');
    await delay(config.perfSettleMs);

    try { await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage'); } catch { /* best effort */ }
    await delay(150);
    const heapBefore = await heapUsage(win);

    const rawVisit1 = await evalInPage(
        win,
        buildPerfVisitSource({
            themeId,
            anchorTheme,
            idleMs: config.perfIdleMs,
            settleMs: config.perfSettleMs,
        }),
        visitTimeout,
        `${themeId} perf visit 1`,
    );
    perfLog(`visit 1 done (switch ${Math.round(rawVisit1?.switchWallMs ?? -1)} ms, `
        + `${rawVisit1?.compilePipes?.length ?? 0} pipelines, ${rawVisit1?.framesObserved ?? 0} frames)`);
    const heapAfter = await heapUsage(win);

    // Visit 2: same drive, a shorter idle. Content guard + drift only.
    await evalInPage(
        win,
        `(async () => { const m = window.serenityBlocks && window.serenityBlocks.themeManager;
          if (m) await m.switchTheme(${JSON.stringify(anchorTheme)}, true); return true; })()`,
        config.switchTimeoutMs + 30_000,
        'perf anchor return',
    );
    perfLog('returning to the anchor — done');
    await delay(config.perfSettleMs);
    const rawVisit2 = await evalInPage(
        win,
        buildPerfVisitSource({
            themeId,
            anchorTheme,
            idleMs: Math.max(4_000, Math.round(config.perfIdleMs / 3)),
            settleMs: config.perfSettleMs,
        }),
        visitTimeout,
        `${themeId} perf visit 2`,
    );
    perfLog(`visit 2 done (switch ${Math.round(rawVisit2?.switchWallMs ?? -1)} ms)`);

    const adapter = await evalInPage(win, PERF_ADAPTER_SOURCE, 30_000, 'perf adapter probe')
        .catch(() => null);

    const visit1 = reduceVisit(rawVisit1, { targetFps: config.perfTargetFps });
    const visit2 = reduceVisit(rawVisit2, { targetFps: config.perfTargetFps });

    // CDP heap bracket, as a cross-check on the in-page 250 ms sampler. Only an upper bound, and
    // only when no GC ran — the in-page sampler is what detects that.
    if (visit1 && !visit1.error && heapBefore && heapAfter) {
        visit1.memory = {
            ...visit1.memory,
            cdpHeapDeltaBytes: heapAfter.usedSize - heapBefore.usedSize,
            cdpHeapNote: 'brackets BOTH visits and the switch, not just the idle window',
        };
    }

    return buildThemePerfCell({
        theme: themeId,
        anchorTheme,
        themeMeta: config.themeMeta,
        runId: config.runId,
        generatedAt: new Date().toISOString(),
        manifest: {
            electron: process.versions.electron ?? null,
            chrome: process.versions.chrome ?? null,
            node: process.versions.node ?? null,
            platform: process.platform,
            windowPx: { width: config.width, height: config.height },
            windowShown: true,
            userDataDir: config.perfProfileDir
                ? path.relative(ROOT, config.perfProfileDir) : null,
            dawnCache: 'cold-per-theme-userdata',
            requestedSwitches: [
                'force_high_performance_gpu',
                'force-device-scale-factor=1',
                'disable-backgrounding-occluded-windows',
                'disable-background-timer-throttling',
                'disable-renderer-backgrounding',
                'enable-precise-memory-info',
            ],
            idleMs: config.perfIdleMs,
            // Stamped 2026-08-25: settleMs shapes the cell (it decides where the idle window
            // opens) but was only recoverable from the source, not the data — the one manifest
            // gap section 10 flagged. Every cell before this carries the lane default (4000).
            settleMs: config.perfSettleMs,
            quality: config.perfQuality,
            targetFps: config.perfTargetFps,
            electronGpuDiagnostics: gpuDiagnostics ?? null,
        },
        visit1,
        visit2,
        adapter,
    });
}

async function runWorker() {
    let config;
    try {
        config = createConfig(process.argv.slice(2));
    } catch (error) {
        console.error(`[ThemeCapture] ${error?.message || error}`);
        app.exit(1);
        return;
    }
    if (config.help) {
        printWorkerUsage();
        app.exit(0);
        return;
    }

    await mkdir(config.outputDir, { recursive: true });
    const targetUrl = createTargetUrl(config);
    const consoleEntries = [];
    const processFailures = [];
    let consoleGateStart = 0;
    let win = null;
    let boot = null;
    let lifecycle = null;
    let perf = null;
    let screenshotImage = null;
    let screenshot = null;
    let fatalError = null;
    let gpuDiagnostics = null;

    console.log(
        `[ThemeCapture] Validating ${config.themeId} `
        + `(${config.themeMeta.performanceClass}) in a fresh Electron process.`,
    );

    try {
        await waitForServer(targetUrl, config.bootstrapTimeoutMs);
        win = createWindow(config);
        win.webContents.on(
            'console-message',
            (_event, level, message, line, sourceId) => {
                consoleEntries.push({
                    timestamp: Date.now(),
                    level,
                    message,
                    line,
                    sourceId,
                });
            },
        );
        win.webContents.on('render-process-gone', (_event, details) => {
            processFailures.push({
                type: 'render-process-gone',
                timestamp: new Date().toISOString(),
                details,
            });
        });
        win.webContents.on('unresponsive', () => {
            processFailures.push({
                type: 'unresponsive',
                timestamp: new Date().toISOString(),
            });
        });
        win.webContents.on(
            'did-fail-load',
            (
                _event,
                errorCode,
                errorDescription,
                validatedUrl,
                isMainFrame,
            ) => {
                if (isMainFrame === false) return;
                processFailures.push({
                    type: 'did-fail-load',
                    timestamp: new Date().toISOString(),
                    errorCode,
                    errorDescription,
                    validatedUrl,
                });
            },
        );

        gpuDiagnostics = await collectGpuDiagnostics();
        if (config.perf) await installThemePerfInstrument(win);
        await win.loadURL(targetUrl);
        if (config.perf) {
            // Assert the bootstrap really landed at document start. If it did not, every pipeline
            // number below would be silently partial rather than absent.
            const installed = await win.webContents.executeJavaScript('!!window.__THEME_PERF__', true)
                .catch(() => false);
            if (!installed) throw new Error('perf instrument did not install at document start');
            perfLog('instrument confirmed at document start');
        }
        boot = await executePageFunction(
            win,
            bootstrapThemeValidationPage,
            {
                bootstrapTimeoutMs: config.bootstrapTimeoutMs,
            },
            config.bootstrapTimeoutMs + 30_000,
            'Serenity bootstrap',
        );
        if (!boot?.ok) {
            throw new Error(boot?.reason || 'Serenity bootstrap failed.');
        }

        consoleGateStart = consoleEntries.length;
        if (config.perf) {
            // The lifecycle lane drives hub cards and 104 assertions; that is the wrong driver for
            // a measurement (extra hub DOM work and two extra switches inside the window).
            perf = await runThemePerfLane(win, config, gpuDiagnostics);
            lifecycle = {
                ok: true, skipped: 'perf-lane', checks: [], timings: {},
            };
        } else {
            lifecycle = await executePageFunction(
                win,
                exerciseThemeLifecyclePage,
                {
                    themeId: config.themeId,
                    anchorTheme: config.anchorTheme,
                    switchTimeoutMs: config.switchTimeoutMs,
                    readyTimeoutMs: config.readyTimeoutMs,
                },
                (config.switchTimeoutMs * 4) + (config.readyTimeoutMs * 2) + 30_000,
                `${config.themeId} lifecycle validation`,
            );
        }

        await executePageFunction(
            win,
            hideCaptureUiPage,
            {},
            10_000,
            'capture UI cleanup',
        );
        await delay(config.settleMs);
        screenshotImage = await win.webContents.capturePage();
        const analysis = analyzeScreenshot(screenshotImage);
        screenshot = {
            path: path.relative(
                ROOT,
                path.join(config.outputDir, `${config.themeId}.png`),
            ),
            ...analysis,
        };
        await delay(250);
    } catch (error) {
        fatalError = {
            message: error?.message || String(error),
            stack: error?.stack || null,
        };
        console.error(`[ThemeCapture] ${config.themeId} failed: ${fatalError.message}`);
        if (win && !win.isDestroyed() && !screenshotImage) {
            try {
                screenshotImage = await win.webContents.capturePage();
                screenshot = {
                    path: path.relative(
                        ROOT,
                        path.join(config.outputDir, `${config.themeId}.png`),
                    ),
                    ...analyzeScreenshot(screenshotImage),
                };
            } catch {
                // JSON and console evidence remain useful when capturePage fails.
            }
        }
    }

    const gatedConsoleEntries = consoleEntries.slice(consoleGateStart);
    const consoleSummary = summarizeConsole(
        gatedConsoleEntries,
        processFailures,
    );
    // Errors THIS LANE CAUSES must not be charged to the theme. Arming trackTimestamp makes three
    // resolve timestamp queries; when a theme tears down with a resolve still in flight, the query
    // buffer is gone and three logs the rejection itself (WebGPUTimestampQueryPool.js:237 /
    // WebGLTimestampQueryPool.js:263). Without the lane that code path never runs. Counted and
    // reported separately — never silently dropped.
    //
    // Computed BEFORE `passed` (2026-08-25): the cell builder already made this distinction, but
    // the theme-level verdict did not, so fluid-dreams and astral-weave were reported FAIL on runs
    // whose cells were admissible with genuineErrorCount 0. One judgement, encoded twice, and only
    // one copy had learned it.
    const inducedErrors = !perf ? 0 : gatedConsoleEntries.filter(
        (e) => INSTRUMENT_INDUCED_ERROR.test(String(e?.message ?? '')),
    ).length;
    const genuineErrors = Math.max(0, consoleSummary.errorCount - inducedErrors);
    // Same gate as consoleSummary.ok, with ONLY the instrument-induced errors discounted.
    // patternFailures stays in: it is what catches WGSL / shader-module / pipeline-validation
    // messages, which is precisely what ADR-0007 gates a visual change on.
    const consoleOk = perf
        ? (genuineErrors === 0
            && (consoleSummary.patternFailures?.length ?? 0) === 0
            && (consoleSummary.processFailureCount ?? 0) === 0)
        : consoleSummary.ok;
    const passed = (
        boot?.ok === true
        && lifecycle?.ok === true
        && screenshot?.passed === true
        && consoleOk
        && !fatalError
    );
    if (perf) {
        const induced = inducedErrors;
        const genuine = genuineErrors;
        perf.console = {
            errorCount: consoleSummary.errorCount,
            warningCount: consoleSummary.warningCount,
            instrumentInducedErrorCount: induced,
            genuineErrorCount: genuine,
        };
        if (genuine > 0) {
            perf.admissible = false;
            perf.inadmissibleReasons = [
                ...(perf.inadmissibleReasons || []),
                `${genuine} console error(s) during the run`,
            ];
        }
    }
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runId: config.runId,
        theme: config.themeId,
        themeMeta: {
            displayName: config.themeMeta.displayName,
            module: config.themeMeta.module,
            resourceProfile: config.themeMeta.resourceProfile,
            performanceClass: config.themeMeta.performanceClass,
        },
        anchorTheme: config.anchorTheme,
        targetUrl,
        passed,
        config: {
            width: config.width,
            height: config.height,
            settleMs: config.settleMs,
            bootstrapTimeoutMs: config.bootstrapTimeoutMs,
            switchTimeoutMs: config.switchTimeoutMs,
            readyTimeoutMs: config.readyTimeoutMs,
            processIsolation: 'one-theme-per-electron-process',
        },
        gpuDiagnostics,
        boot,
        lifecycle,
        screenshot,
        console: consoleSummary,
        perf,
        fatalError,
    };

    await writeArtifacts(config, {
        report,
        consoleEntries,
        screenshotImage,
    });

    console.log(
        `[ThemeCapture] ${config.themeId}: ${passed ? 'PASS' : 'FAIL'} `
        + `(${lifecycle?.checks?.filter((check) => !check.passed).length || 0} lifecycle failures, `
        + `${consoleSummary.errorCount} console errors, `
        + `${processFailures.length} process failures).`,
    );

    if (win && !win.isDestroyed()) {
        win.destroy();
    }
    app.exit(passed ? 0 : 2);
}

app.whenReady().then(runWorker).catch((error) => {
    console.error('[ThemeCapture] Fatal worker error:', error);
    app.exit(1);
});
