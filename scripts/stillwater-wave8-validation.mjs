/**
 * Stillwater Wave 8 production-preview validation.
 *
 * Default lane:
 *   node scripts/run-electron.mjs scripts/stillwater-wave8-validation.mjs
 *
 * Useful optional lanes:
 *   --base-url http://127.0.0.1:4173  Use an already-running production preview.
 *   --skip-build                       Reuse the current dist/ before starting preview.
 *   --force-webgl                      Validate the WebGL2 fallback.
 *   --stress                           Add a ten-minute reaction soak.
 *   --stress-ms 120000                 Add a custom-duration reaction soak.
 *   --lock-stress-ms 20000             Add a deterministic 2 Hz lock-only lane.
 *   --switch-cycles 30                 Alternate Forest/Stillwater repeatedly.
 *   --device-loss                      Exercise one backend loss/recovery cycle.
 *   --pause-cycles 20                  Exercise repeated suspend/resume.
 *   --hidden-ms 20000                  Exercise a hidden-tab pause window.
 *   --page-visibility-lane             Use a headed BrowserWindow with real
 *                                      Page Visibility and background throttling.
 *   --layout-captures false            Skip the solo/duo/quad/Odyssey matrix.
 *   --resize-matrix false              Skip 1080p/1440p/capped-4K transitions.
 *   --event-captures false             Skip isolated production event captures.
 *   --require-canvas-fallback          Fail if a Phaser Canvas board is unavailable.
 *   --manual-driver true               Step only Stillwater in headless mode.
 *   --low-power-gpu                    Request Chromium and Stillwater low-power GPU.
 *
 * The harness intentionally uses Electron and the Chrome DevTools Protocol rather
 * than Playwright. It validates the shipped app/theme integration, not a playground
 * effect, and writes screenshots, raw frame samples, renderer/resource diagnostics,
 * heap/DOM counters, GPU metadata, and the complete renderer console to artifacts/.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import {
    mkdir,
    writeFile,
} from 'fs/promises';
import path from 'path';
import {
    evaluateStillwaterFrameBudget,
    validatePerSurfaceBudgets,
} from './stillwater-perf-budget.mjs';
import {
    collectStillwaterSourceBuildFingerprint,
} from './stillwater-artifact-provenance.mjs';

const { app, BrowserWindow } = electron;
const ROOT = process.cwd();
const PERF_BUDGET_DOCUMENT = JSON.parse(
    readFileSync(path.join(ROOT, 'perf-budgets.json'), 'utf8'),
);
const PERF_BUDGET_SHAPE = validatePerSurfaceBudgets(PERF_BUDGET_DOCUMENT);
if (!PERF_BUDGET_SHAPE.ok) {
    throw new Error(`Invalid performance budget shape: ${PERF_BUDGET_SHAPE.errors.join(' ')}`);
}
const STILLWATER_BASELINE_P95_MS = (
    PERF_BUDGET_DOCUMENT.budgets.frameP95Ms.perSurface.stillwater
);
const ARGS = parseArgs(process.argv.slice(2));
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const DEFAULT_DIST_DIRECTORY = path.join(ROOT, 'dist');
const DIST_DIRECTORY = path.resolve(
    ROOT,
    typeof ARGS['dist-dir'] === 'string' ? ARGS['dist-dir'] : 'dist',
);
const PORT = parsePositiveInt(ARGS.port, 4173);
const EXTERNAL_BASE_URL = typeof ARGS['base-url'] === 'string'
    ? ARGS['base-url']
    : null;
const BASE_URL = EXTERNAL_BASE_URL || `http://127.0.0.1:${PORT}`;
const ARTIFACT_DIR = path.resolve(
    ROOT,
    typeof ARGS.out === 'string'
        ? ARGS.out
        : path.join('artifacts', 'themes', 'stillwater', 'wave8', TIMESTAMP),
);
const MANUAL_WARMUP_MIN_MS = parseDuration(ARGS['manual-warmup-ms'], 20000);
const MANUAL_WARMUP_MAX_MS = Math.max(
    MANUAL_WARMUP_MIN_MS,
    parseDuration(ARGS['manual-warmup-max-ms'], 60000),
);

export const STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS = Object.freeze([
    Object.freeze({
        id: 'lock',
        preset: 'lock',
        lineCount: 0,
        comboCount: 0,
        expectedRouteIndex: 0,
        captureAgeMs: 360,
    }),
    Object.freeze({
        id: 'hard-drop',
        preset: 'harddrop',
        lineCount: 0,
        comboCount: 0,
        distance: 14,
        expectedRouteIndex: 8,
        captureAgeMs: 420,
    }),
    Object.freeze({
        id: 'line-clear',
        preset: 'line-clear',
        lineCount: 1,
        comboCount: 0,
        expectedRouteIndex: 1,
        captureAgeMs: 440,
    }),
    Object.freeze({
        id: 'tetris',
        preset: 'tetris',
        lineCount: 4,
        comboCount: 0,
        expectedRouteIndex: 1,
        captureAgeMs: 520,
    }),
    Object.freeze({
        id: 'combo-4',
        preset: 'combo',
        lineCount: 1,
        comboCount: 4,
        expectedRouteIndex: 1,
        captureAgeMs: 480,
    }),
    Object.freeze({
        id: 'combo-7',
        preset: 'combo',
        lineCount: 1,
        comboCount: 7,
        expectedRouteIndex: 1,
        captureAgeMs: 520,
    }),
    Object.freeze({
        id: 'combo-10',
        preset: 'combo',
        lineCount: 1,
        comboCount: 10,
        expectedRouteIndex: 3,
        captureAgeMs: 620,
    }),
    Object.freeze({
        id: 't-spin',
        preset: 't-spin',
        lineCount: 2,
        comboCount: 0,
        expectedRouteIndex: 2,
        captureAgeMs: 520,
    }),
    Object.freeze({
        id: 'back-to-back',
        preset: 'b2b',
        lineCount: 4,
        comboCount: 0,
        // Route 4 is the delayed echo that distinguishes B2B from an ordinary
        // four-line wake. Requiring it prevents the Tetris route from masking
        // a broken B2B response.
        expectedRouteIndex: 4,
        captureAgeMs: 680,
    }),
    Object.freeze({
        id: 'perfect-clear',
        preset: 'perfect-clear',
        lineCount: 4,
        comboCount: 0,
        expectedRouteIndex: 3,
        captureAgeMs: 760,
    }),
    Object.freeze({
        id: 'level-up',
        preset: 'levelup',
        lineCount: 0,
        comboCount: 0,
        level: 12,
        expectedRouteIndex: 9,
        captureAgeMs: 720,
    }),
]);

export const STILLWATER_PHASER_CANVAS_FALLBACK_BLOCKER = Object.freeze({
    supported: false,
    code: 'phaser4-production-board-is-webgl-only',
    reason: 'The production board hardcodes Phaser.WEBGL and Phaser 4 has no '
        + 'Canvas renderer; Main.getPhysicsCallbacks() also declares that no '
        + 'canvas fallback board renderer exists. A genuine Phaser Canvas 2D '
        + 'Stillwater board capture requires a new board renderer, which is '
        + 'outside validation-only scope.',
    sourceEvidence: Object.freeze([
        'src/main.js:1634-1637',
        'src/main.js:3364-3368',
    ]),
});

const CONFIG = Object.freeze({
    quality: normalizeQuality(ARGS.quality, 'High'),
    targetFps: parsePositiveInt(ARGS['target-fps'], 60),
    renderScale: 1,
    antialias: false,
    width: parsePositiveInt(ARGS.width, 1600),
    height: parsePositiveInt(ARGS.height, 900),
    idleMs: parseDuration(ARGS['idle-ms'], 20000),
    reactionMs: parseDuration(ARGS['reaction-ms'], 20000),
    reactionSequence: normalizeReactionSequence(ARGS['reaction-sequence']),
    manualWarmupMs: MANUAL_WARMUP_MIN_MS,
    manualWarmupMaxMs: MANUAL_WARMUP_MAX_MS,
    manualWarmupWindowMs: 2000,
    pauseMs: parseDuration(ARGS['pause-ms'], 180),
    resumeSettleMs: parseDuration(ARGS['resume-settle-ms'], 220),
    pauseCycles: parsePositiveInt(ARGS['pause-cycles'], 20),
    hiddenMs: parseDuration(ARGS['hidden-ms'], 20000),
    hiddenResumeSettleMs: parseDuration(ARGS['hidden-resume-settle-ms'], 1200),
    pageVisibilityLane: parseBoolean(ARGS['page-visibility-lane'], false),
    layoutCaptures: parseBoolean(ARGS['layout-captures'], true),
    resizeMatrix: parseBoolean(ARGS['resize-matrix'], true),
    eventCaptures: parseBoolean(ARGS['event-captures'], true),
    requireCanvasFallback: parseBoolean(ARGS['require-canvas-fallback'], false),
    lockStressMs: parseNonNegativeInt(ARGS['lock-stress-ms'], 0),
    stressMs: resolveStressDuration(ARGS),
    switchCycles: parseNonNegativeInt(ARGS['switch-cycles'], 0),
    switchSettleMs: parseNonNegativeInt(ARGS['switch-settle-ms'], 10000),
    deviceLoss: parseBoolean(ARGS['device-loss'], false),
    forceWebGL: parseBoolean(ARGS['force-webgl'], false),
    lowPowerGpu: parseBoolean(ARGS['low-power-gpu'], false),
    skipBuild: parseBoolean(ARGS['skip-build'], false),
    headed: !parseBoolean(ARGS.headless, false),
    manualDriver: parseBoolean(
        ARGS['manual-driver'],
        parseBoolean(ARGS.headless, false),
    ),
    expectBackend: normalizeExpectedBackend(ARGS['expect-backend'], ARGS['force-webgl']),
    startupTimeoutMs: parseDuration(ARGS['startup-timeout-ms'], 180000),
});

const PAGE_PARAMS = Object.freeze({
    skipIntro: '1',
    noThemeWarm: '1',
    stillwaterValidation: '1',
    stillwaterPerf: '1',
    stillwaterQuality: CONFIG.quality,
    ...(CONFIG.lowPowerGpu ? { stillwaterPowerPreference: 'low-power' } : {}),
    ...(CONFIG.forceWebGL ? { forceWebGL: '1' } : {}),
});

const FAILURE_PATTERNS = Object.freeze([
    { id: 'wgsl', regex: /\bWGSL\b.*(?:error|invalid)|error.*\bWGSL\b/i },
    { id: 'shader_module', regex: /invalid\s+ShaderModule|shader module.*invalid/i },
    { id: 'render_pipeline', regex: /invalid\s+RenderPipeline|render pipeline.*invalid/i },
    { id: 'compute_pipeline', regex: /invalid\s+ComputePipeline|compute pipeline.*invalid/i },
    { id: 'pipeline_validation', regex: /pipeline.*validation error|validation error.*pipeline/i },
    { id: 'command_buffer', regex: /invalid\s+CommandBuffer|command buffer.*invalid/i },
    { id: 'webgpu_uncaptured', regex: /WebGPU uncaptured error|uncaptured GPU error/i },
]);

const ACTIVATION_MILESTONE_NAMES = Object.freeze([
    'sceneStart',
    'rendererReady',
    'runtimeConstructed',
    'criticalHeroReady',
    'targetHeroReady',
    'warmRenderComplete',
    'canvasReveal',
]);
const TROLL_LOD_BY_QUALITY = Object.freeze({
    Minimal: 'low',
    Low: 'low',
    Medium: 'medium',
    High: 'high',
    Ultra: 'ultra',
    Extreme: 'ultra',
});
const ACTIVATION_CLOCK = 'performance.now';
const ACTIVATION_TIME_EPSILON_MS = 0.01;

const API_ASSUMPTIONS = Object.freeze([
    'window.serenityBlocks exposes settingsManager, gameModeManager, themeManager, '
        + 'pauseAllRendering(), and resumeFullRendering().',
    'window.themeManager.activeThemeName and activeTheme identify the production Stillwater instance.',
    'The production Stillwater theme exposes renderer and whenFullReady().',
    'window.__STILLWATER_MASTERPIECE__ exposes ready/isReady, triggerPreset(), '
        + 'getDiagnostics(), and getResourceState().',
    'With stillwaterValidation=1, the debug API exposes an isolated manual frame '
        + 'driver that leaves every other application RAF consumer untouched.',
    'The isolated production-event lane drives triggerPreset() on the shipped '
        + 'Stillwater runtime, captures the composed app, and then proves fixed '
        + 'resource identities and renderer memory did not grow.',
    'The theme container is #stillwater-theme and owns exactly one theme canvas after readiness/recovery.',
    'The normal hidden-window lane mirrors backgroundThrottling=false and invokes '
        + 'the application pause policy explicitly; --page-visibility-lane is the '
        + 'separate headed native document.hidden validation.',
    'Adaptive-quality suppression is available through window.performanceMonitor or window.perfMonitor.',
]);

let previewProcess = null;
let buildLog = '';
let previewLog = '';
let mainWindow = null;
let shuttingDown = false;
let sourceBuildFingerprint = null;

function parseArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const option = token.slice(2);
        const separator = option.indexOf('=');
        const key = separator >= 0 ? option.slice(0, separator) : option;
        const inlineValue = separator >= 0 ? option.slice(separator + 1) : undefined;
        const next = argv[index + 1];
        if (inlineValue !== undefined) {
            parsed[key] = inlineValue;
        } else if (next && !next.startsWith('--')) {
            parsed[key] = next;
            index += 1;
        } else {
            parsed[key] = true;
        }
    }
    return parsed;
}

function parseBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseDuration(value, fallback) {
    return parsePositiveInt(value, fallback);
}

function normalizeQuality(value, fallback) {
    const names = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
    const requested = String(value || fallback).trim().toLowerCase();
    return names.find((name) => name.toLowerCase() === requested) || fallback;
}

function normalizeReactionSequence(value) {
    if (typeof value !== 'string') return null;
    const allowed = new Set([
        'lock',
        'tetris',
        'tspin',
        'combo',
        'perfectclear',
        'b2b',
        'harddrop',
        'levelup',
    ]);
    const sequence = value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => allowed.has(entry));
    return sequence.length > 0 ? sequence : null;
}

function resolveStressDuration(args) {
    if (args['stress-ms'] !== undefined) {
        return parseNonNegativeInt(args['stress-ms'], 0);
    }
    return parseBoolean(args.stress, false) ? 600000 : 0;
}

function normalizeExpectedBackend(value, forceWebGL) {
    if (parseBoolean(forceWebGL, false)) return 'WebGL2';
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'webgpu') return 'WebGPU';
    if (normalized === 'webgl' || normalized === 'webgl2') return 'WebGL2';
    return null;
}

export function evaluateStillwaterBoardCapture(diagnostics) {
    const board = diagnostics?.boardSurface || null;
    const reasons = [];
    if (String(diagnostics?.activeThemeName || '').toLowerCase() !== 'stillwater') {
        reasons.push('active theme is not Stillwater');
    }
    if (diagnostics?.themeCanvasCount !== 1) {
        reasons.push('Stillwater does not own exactly one theme canvas');
    }
    if (board?.modeId !== 'single') reasons.push('production game mode is not single-player');
    if (board?.modeRunning !== true) reasons.push('production game mode is not running');
    if (board?.boardSceneActive !== true) reasons.push('Phaser BoardScene is not active');
    if (board?.bodySerenityMode === true) reasons.push('Serenity board mode is active');
    if (board?.blockingModal) reasons.push(`blocking modal is visible: ${board.blockingModal}`);
    if (board?.gameOver === true) reasons.push('production game state is game-over');
    if (board?.stopped === true) reasons.push('production game state is stopped');
    if (board?.processingGameOver === true) reasons.push('game-over processing is pending');
    if (board?.pendingStop === true) reasons.push('mode stop is pending');
    if (board?.activeSessionPresent !== true) reasons.push('active game session is missing');
    if (board?.sessionOwnsGameState !== true) reasons.push('active session does not own game state');
    if (
        !Number.isFinite(board?.sessionGeneration)
        || !Number.isFinite(board?.activeSessionGeneration)
    ) {
        reasons.push('active session generation is unavailable');
    }
    if (
        Number.isFinite(board?.sessionGeneration)
        && Number.isFinite(board?.activeSessionGeneration)
        && board.sessionGeneration !== board.activeSessionGeneration
    ) {
        reasons.push('active session generation does not match mode generation');
    }
    if (board?.ok !== true) reasons.push('boardSurface.ok is false');
    return {
        ok: reasons.length === 0,
        reasons,
        activeThemeName: diagnostics?.activeThemeName || null,
        themeCanvasCount: diagnostics?.themeCanvasCount ?? null,
        modeId: board?.modeId || null,
        modeRunning: board?.modeRunning === true,
        boardSceneActive: board?.boardSceneActive === true,
        blockingModal: board?.blockingModal || null,
        gameOver: board?.gameOver === true,
        stopped: board?.stopped === true,
        processingGameOver: board?.processingGameOver === true,
        pendingStop: board?.pendingStop === true,
        activeSessionPresent: board?.activeSessionPresent === true,
        sessionOwnsGameState: board?.sessionOwnsGameState === true,
        sessionGeneration: board?.sessionGeneration ?? null,
        activeSessionGeneration: board?.activeSessionGeneration ?? null,
        boardSurfaceOk: board?.ok === true,
    };
}

export function evaluateStillwaterFrameBoardLifecycle(lifecycle) {
    const reasons = [];
    const inspect = (label, state) => {
        if (state?.ok !== true) reasons.push(`${label} board surface is not ready`);
        if (state?.modeId !== 'single') {
            reasons.push(`${label} game mode is not single-player`);
        }
        if (state?.modeRunning !== true) reasons.push(`${label} game mode is not running`);
        if (state?.boardSceneActive !== true) reasons.push(`${label} BoardScene is not active`);
        if (state?.blockingModal) {
            reasons.push(`${label} blocking modal is visible: ${state.blockingModal}`);
        }
        if (state?.gameOver === true) reasons.push(`${label} game state is game-over`);
        if (state?.stopped === true) reasons.push(`${label} game state is stopped`);
        if (state?.processingGameOver === true) {
            reasons.push(`${label} game-over processing is pending`);
        }
        if (state?.pendingStop === true) reasons.push(`${label} mode stop is pending`);
        if (state?.activeSessionPresent !== true) {
            reasons.push(`${label} active session is missing`);
        }
        if (state?.sessionOwnsGameState !== true) {
            reasons.push(`${label} active session does not own game state`);
        }
        if (
            !Number.isFinite(state?.sessionGeneration)
            || !Number.isFinite(state?.activeSessionGeneration)
        ) {
            reasons.push(`${label} active session generation is unavailable`);
        } else if (state.sessionGeneration !== state.activeSessionGeneration) {
            reasons.push(`${label} active session generation does not match mode generation`);
        }
    };

    inspect('before capture', lifecycle?.before);
    inspect('during capture', lifecycle?.during);
    inspect('after capture', lifecycle?.after);

    const beforeGeneration = lifecycle?.before?.activeSessionGeneration;
    const duringGeneration = lifecycle?.during?.activeSessionGeneration;
    const afterGeneration = lifecycle?.after?.activeSessionGeneration;
    if (
        !Number.isFinite(beforeGeneration)
        || beforeGeneration !== duringGeneration
        || duringGeneration !== afterGeneration
    ) {
        reasons.push('board session generation changed during isolated capture');
    }

    if (lifecycle?.pauseApplied === true) {
        if (lifecycle?.during?.modePaused !== true) {
            reasons.push('production board was not paused during isolated capture');
        }
        if (lifecycle?.after?.modePaused === true) {
            reasons.push('production board remained paused after isolated capture');
        }
    }

    return {
        ok: reasons.length === 0,
        reasons,
        pauseApplied: lifecycle?.pauseApplied === true,
        generation: Number.isFinite(beforeGeneration) ? beforeGeneration : null,
        before: lifecycle?.before || null,
        during: lifecycle?.during || null,
        after: lifecycle?.after || null,
    };
}

export function evaluateStillwaterCaptureContinuity({
    recovery,
    preCapture,
    postCapture,
} = {}) {
    const pre = evaluateStillwaterBoardCapture(preCapture);
    const post = evaluateStillwaterBoardCapture(postCapture);
    const recoveryGeneration = recovery?.expectedGeneration;
    const preGeneration = pre.activeSessionGeneration;
    const postGeneration = post.activeSessionGeneration;
    const reasons = [
        ...pre.reasons.map((reason) => `pre-capture: ${reason}`),
        ...post.reasons.map((reason) => `post-capture: ${reason}`),
    ];
    if (recovery?.ok !== true) reasons.push('final board recovery failed');
    if (
        !Number.isFinite(recoveryGeneration)
        || recoveryGeneration !== preGeneration
        || preGeneration !== postGeneration
    ) {
        reasons.push('board session generation changed across screenshot capture');
    }

    return {
        ok: reasons.length === 0,
        reasons,
        recoveryGeneration: recoveryGeneration ?? null,
        preGeneration: preGeneration ?? null,
        postGeneration: postGeneration ?? null,
        pre,
        post,
    };
}

export function evaluateStillwaterHiddenLifecycle({
    policy,
    headed,
    backgroundThrottling,
    prepare,
    hiddenStart,
    hiddenEnd,
    resume,
    resumed,
    nativeWindow,
    counterDeltas,
} = {}) {
    const pageVisibility = policy === 'page-visibility';
    const reasons = [];
    const countersStable = counterDeltas?.countersPresent === true
        && Number.isFinite(counterDeltas?.updates)
        && Number.isFinite(counterDeltas?.renders)
        && counterDeltas.updates >= 0
        && counterDeltas.renders >= 0
        && counterDeltas.updates <= 1
        && counterDeltas.renders <= 1;
    const appPauseObserved = (
        pageVisibility
            ? prepare?.renderingPaused === false
            : prepare?.renderingPaused === true
    )
        && hiddenStart?.visibility?.renderingPaused === true
        && hiddenEnd?.visibility?.renderingPaused === true;
    const resumedCleanly = resumed?.visibility?.renderingPaused === false
        && resumed?.themeCanvasCount === 1;
    const nativeHideObserved = nativeWindow?.visibleWhileHidden === false;

    if (pageVisibility) {
        if (headed !== true) reasons.push('Page Visibility lane requires a headed window');
        if (backgroundThrottling !== true) {
            reasons.push('Page Visibility lane requires backgroundThrottling=true');
        }
        if (prepare?.explicitPauseInvoked === true) {
            reasons.push('Page Visibility lane invoked the explicit pause hook');
        }
        if (resume?.explicitResumeInvoked === true) {
            reasons.push('Page Visibility lane invoked the explicit resume hook');
        }
        if (
            hiddenStart?.visibility?.hidden !== true
            || hiddenEnd?.visibility?.hidden !== true
        ) {
            reasons.push('document.hidden did not stay true for the hidden window');
        }
        if (resumed?.visibility?.hidden !== false) {
            reasons.push('document.hidden did not return to false after show');
        }
        if (nativeWindow?.visibleBefore !== true || nativeWindow?.visibleAfter !== true) {
            reasons.push('headed Page Visibility window did not complete a visible-hide-visible cycle');
        }
    } else {
        if (backgroundThrottling !== false) {
            reasons.push('explicit app-pause lane must mirror backgroundThrottling=false');
        }
        if (prepare?.explicitPauseInvoked !== true) {
            reasons.push('explicit app-pause hook was not invoked');
        }
        if (resume?.explicitResumeInvoked !== true) {
            reasons.push('explicit app-resume hook was not invoked');
        }
        if (
            headed === true
            && (
                nativeWindow?.visibleBefore !== true
                || nativeWindow?.visibleAfter !== true
            )
        ) {
            reasons.push('headed app-pause window did not complete a visible-hide-visible cycle');
        }
    }

    if (prepare?.ok !== true) reasons.push('hidden-window policy preparation failed');
    if (resume?.ok !== true) reasons.push('hidden-window policy resume failed');
    if (!nativeHideObserved) reasons.push('BrowserWindow did not enter its hidden state');
    if (!appPauseObserved) reasons.push('application pause state was not observed');
    if (!countersStable) reasons.push('hidden update/render counters were absent or advanced');
    if (!resumedCleanly) reasons.push('application did not resume cleanly with one theme canvas');

    return {
        ok: reasons.length === 0,
        policy: pageVisibility ? 'page-visibility' : 'explicit-app-pause',
        reasons,
        backgroundThrottling: backgroundThrottling === true,
        pageVisibilityRequired: pageVisibility,
        appPauseObserved,
        countersStable,
        resumedCleanly,
        nativeHideObserved,
    };
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function createTargetUrl() {
    const url = new URL('/', BASE_URL);
    Object.entries(PAGE_PARAMS).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });
    return url.toString();
}

function npmInvocation(args) {
    if (process.platform === 'win32') {
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`],
        };
    }
    return { command: 'npm', args };
}

function runCommand(commandArgs, timeoutMs) {
    const invocation = npmInvocation(commandArgs);
    return new Promise((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            cwd: ROOT,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const chunks = [];
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
        }, timeoutMs);

        child.stdout.on('data', (chunk) => chunks.push(String(chunk)));
        child.stderr.on('data', (chunk) => chunks.push(String(chunk)));
        child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            const output = chunks.join('');
            if (code === 0 && !timedOut) {
                resolve(output);
                return;
            }
            reject(new Error(
                `npm ${commandArgs.join(' ')} failed`
                + ` (${signal || code || (timedOut ? 'timeout' : 'unknown')}).\n${output}`,
            ));
        });
    });
}

async function buildProductionBundle() {
    if (CONFIG.skipBuild || EXTERNAL_BASE_URL) return;
    if (DIST_DIRECTORY !== DEFAULT_DIST_DIRECTORY) {
        throw new Error('A custom --dist-dir requires --skip-build true.');
    }
    console.log('[StillwaterWave8] Building production bundle...');
    try {
        buildLog = await runCommand(['run', 'build'], 600000);
    } finally {
        await writeFile(path.join(ARTIFACT_DIR, 'build.log'), buildLog, 'utf8');
    }
}

function startPreviewServer() {
    if (EXTERNAL_BASE_URL) return null;
    const invocation = npmInvocation([
        'run',
        'preview',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(PORT),
        '--strictPort',
        '--outDir',
        DIST_DIRECTORY,
    ]);
    const child = spawn(invocation.command, invocation.args, {
        cwd: ROOT,
        env: {
            ...process.env,
            FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    child.stdout.on('data', (chunk) => {
        previewLog += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
        previewLog += String(chunk);
    });
    child.once('error', (error) => {
        previewLog += `[spawn-error] ${error.stack || error.message}\n`;
    });
    return child;
}

async function stopPreviewServer() {
    const child = previewProcess;
    previewProcess = null;
    if (child?.exitCode === null && process.platform === 'win32' && child.pid) {
        await new Promise((resolve) => {
            const killer = spawn(
                'taskkill.exe',
                ['/PID', String(child.pid), '/T', '/F'],
                { stdio: 'ignore', windowsHide: true },
            );
            killer.once('error', resolve);
            killer.once('exit', resolve);
        });
    } else if (child?.exitCode === null) {
        child.kill('SIGTERM');
        await delay(750);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await writeFile(path.join(ARTIFACT_DIR, 'preview.log'), previewLog, 'utf8');
}

async function waitForServer(url, timeoutMs) {
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
        await delay(400);
    }
    throw new Error(
        `Timed out waiting for production preview at ${url}: ${lastError?.message || 'unknown error'}`,
    );
}

function createWindow() {
    return new BrowserWindow({
        width: CONFIG.width,
        height: CONFIG.height,
        useContentSize: true,
        show: CONFIG.headed,
        backgroundColor: '#000000',
        webPreferences: {
            // The normal production lane mirrors packaged Electron and proves
            // the application's explicit pause policy. The opt-in Page
            // Visibility lane intentionally flips this to true because
            // Electron otherwise guarantees document.visibilityState remains
            // "visible" even after win.hide().
            backgroundThrottling: CONFIG.pageVisibilityLane,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: `stillwater-wave8-${TIMESTAMP}`,
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
    return {
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
        gpuInfo,
        gpuInfoError,
        featureStatus,
        featureStatusError,
        devices,
        activeDevices: devices.filter((device) => device?.active === true),
    };
}

function executePageFunction(win, fn, payload, timeoutMs, label) {
    const source = `(${fn.toString()})(${JSON.stringify(payload)})`;
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
        );
    });
    return Promise.race([
        win.webContents.executeJavaScript(source, true),
        timeout,
    ]).finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
    });
}

async function bootstrapStillwaterPage(profile) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const waitFor = async (predicate, timeoutMs) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            try {
                if (predicate()) return true;
            } catch {
                // The app may be replacing the theme while this predicate runs.
            }
            await sleep(100);
        }
        return false;
    };
    const withTimeout = async (promise, timeoutMs, label) => {
        let timeoutId = null;
        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    };
    const resolveBackend = (theme) => {
        if (theme?.isWebGPU || theme?.renderer?.backend?.isWebGPUBackend) return 'WebGPU';
        if (theme?.isWebGL || theme?.renderer?.backend?.isWebGLBackend) return 'WebGL2';
        const backendName = String(
            theme?.backendName
            || theme?.renderer?.backend?.constructor?.name
            || '',
        );
        if (/webgpu/i.test(backendName)) return 'WebGPU';
        if (/webgl/i.test(backendName)) return 'WebGL2';
        return 'Unknown';
    };

    const appReady = await waitFor(
        () => Boolean(
            window.serenityBlocks?.isInitialized
            && window.serenityBlocks?.settingsManager
            && window.serenityBlocks?.gameModeManager
            && window.serenityBlocks?.themeManager,
        ),
        profile.startupTimeoutMs,
    );
    if (!appReady) {
        return {
            ok: false,
            reason: 'Application managers were not ready.',
            page: {
                readyState: document.readyState,
                visibilityState: document.visibilityState,
                hidden: document.hidden,
                hasSerenityBlocks: Boolean(window.serenityBlocks),
                hasStartupPipeline: Boolean(window.startupPipeline),
                startupPipeline: window.startupPipeline?.snapshot?.() || null,
                bodyClasses: [...document.body.classList],
            },
        };
    }

    const game = window.serenityBlocks;
    const pinnedSettings = {
        effectQuality: profile.quality,
        graphicsQuality: profile.quality,
        targetFrameRate: profile.targetFps,
        renderScale: profile.renderScale,
        enableAntialiasing: profile.antialias,
        backgroundComboEffects: true,
        backgroundTabBehavior: 'pause',
        backgroundMode: 'Specific',
        backgroundTheme: 'stillwater',
    };

    try {
        game.settingsManager.update?.(pinnedSettings, false);
        window.settings = game.settingsManager.get?.() || {
            ...(window.settings || {}),
            ...pinnedSettings,
        };
        // This production-app hook updates BaseTheme's module-scoped render-scale
        // and antialias settings without importing source-only URLs from dist/.
        await game.applyDisplaySettings?.(window.settings);
        game.applyEffectQuality?.(profile.quality);
        await game.applyFrameRateSettings?.(window.settings);
        game.frameRateController?.setTargetFPS?.(profile.targetFps);
        window.performanceMonitor?.setAdaptiveDownscaleSuppressed?.(true);
        window.perfMonitor?.setAdaptiveDownscaleSuppressed?.(true);
    } catch (error) {
        return {
            ok: false,
            reason: `Failed to pin validation settings: ${error?.message || String(error)}`,
        };
    }

    try {
        game.startPostMenuRenderer?.();
        if (game.gameModeManager.getCurrentModeId?.() !== 'single') {
            await withTimeout(
                game.gameModeManager.activateMode('single'),
                45000,
                'activateMode(single)',
            );
        }
        game.movePhaserGameToContainer?.('phaser-game-container');
        const phaserCanvas = game.phaserGame?.canvas
            || document.querySelector('#phaser-game-container canvas');
        [
            'position',
            'top',
            'left',
            'width',
            'height',
            'z-index',
        ].forEach((property) => phaserCanvas?.style?.removeProperty?.(property));
        document.body.classList.remove('serenity-mode');
        game.handleResize?.();
        const activeMode = game.gameModeManager.getCurrentMode?.();
        if (!activeMode?.isRunning) {
            await withTimeout(
                game.gameModeManager.startCurrentMode({ seed: 0x53545752 }),
                45000,
                'startCurrentMode(single)',
            );
        }
        game.movePhaserGameToContainer?.('phaser-game-container');
        game.handleResize?.();
        game.modalManager?.hideAll?.();
        document.body.classList.remove('start-modal-open');
        game.gamepadController?.disableGameModeSelection?.();
        game.gamepadController?.disableMenuNavigation?.();
        game.gamepadController?.disableSerenityMode?.();
        await withTimeout(
            game.themeManager.switchTheme('stillwater', true),
            60000,
            'switchTheme(stillwater)',
        );
    } catch (error) {
        return {
            ok: false,
            reason: `Failed to activate Stillwater: ${error?.message || String(error)}`,
        };
    }

    const themeReady = await waitFor(() => {
        const manager = window.themeManager || game.themeManager;
        const theme = manager?.activeTheme;
        return manager?.activeThemeName === 'stillwater'
            && Boolean(theme?.renderer)
            && typeof theme?.whenFullReady === 'function';
    }, profile.startupTimeoutMs);
    if (!themeReady) {
        return { ok: false, reason: 'Production Stillwater theme did not expose its renderer/readiness API.' };
    }

    const manager = window.themeManager || game.themeManager;
    const theme = manager.activeTheme;
    try {
        const fullReady = await withTimeout(
            theme.whenFullReady(),
            profile.startupTimeoutMs,
            'Stillwater whenFullReady()',
        );
        if (fullReady === false) {
            return { ok: false, reason: 'Stillwater whenFullReady() resolved false.' };
        }
    } catch (error) {
        return {
            ok: false,
            reason: `Stillwater full readiness failed: ${error?.message || String(error)}`,
        };
    }

    const debugReady = await waitFor(
        () => Boolean(window.__STILLWATER_MASTERPIECE__),
        profile.startupTimeoutMs,
    );
    if (!debugReady) {
        return { ok: false, reason: 'window.__STILLWATER_MASTERPIECE__ was not installed.' };
    }
    const debug = window.__STILLWATER_MASTERPIECE__;
    try {
        if (debug.ready) {
            const ready = await withTimeout(
                debug.ready,
                profile.startupTimeoutMs,
                'Stillwater debug ready',
            );
            if (ready === false) return { ok: false, reason: 'Stillwater debug ready resolved false.' };
        }
    } catch (error) {
        return {
            ok: false,
            reason: `Stillwater debug readiness failed: ${error?.message || String(error)}`,
        };
    }
    if (typeof debug.isReady === 'function' && !debug.isReady()) {
        return { ok: false, reason: 'Stillwater debug API reports target LOD is not ready.' };
    }

    const boardReady = await waitFor(() => {
        const canvas = document.querySelector('#phaser-game-container canvas');
        const rect = canvas?.getBoundingClientRect?.();
        const mode = game.gameModeManager.getCurrentMode?.();
        return game.gameModeManager.getCurrentModeId?.() === 'single'
            && mode?.isRunning === true
            && game.phaserGame?.scene?.isActive?.('BoardScene') === true
            && canvas?.clientWidth >= 200
            && canvas?.clientHeight >= 400
            && rect?.width >= 200
            && rect?.height >= 400
            && !document.body.classList.contains('serenity-mode');
    }, 15000);
    const boardCanvas = document.querySelector('#phaser-game-container canvas');
    const boardRect = boardCanvas?.getBoundingClientRect?.();
    const board = {
        ok: boardReady,
        modeId: game.gameModeManager.getCurrentModeId?.() || null,
        modeRunning: game.gameModeManager.getCurrentMode?.()?.isRunning === true,
        boardSceneActive: game.phaserGame?.scene?.isActive?.('BoardScene') === true,
        bodySerenityMode: document.body.classList.contains('serenity-mode'),
        canvas: boardCanvas ? {
            width: boardCanvas.width,
            height: boardCanvas.height,
            clientWidth: boardCanvas.clientWidth,
            clientHeight: boardCanvas.clientHeight,
            rect: boardRect ? {
                x: boardRect.x,
                y: boardRect.y,
                width: boardRect.width,
                height: boardRect.height,
            } : null,
        } : null,
    };
    if (!boardReady) {
        return {
            ok: false,
            reason: 'Production single-player board was not visible and running.',
            board,
        };
    }

    window.isRenderingPaused = false;
    window.isRenderingReduced = false;
    window.performanceMonitor?.setAdaptiveDownscaleSuppressed?.(true);
    window.perfMonitor?.setAdaptiveDownscaleSuppressed?.(true);
    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const activationObserverFinalized = await waitFor(
        () => theme.getDiagnostics?.()
            ?.validation?.activation?.longTasks?.observing === false,
        3_000,
    );
    if (!activationObserverFinalized) {
        return {
            ok: false,
            reason: 'Stillwater activation LongTask observation did not finalize.',
        };
    }

    const backend = resolveBackend(theme);
    if (profile.expectBackend && backend !== profile.expectBackend) {
        return {
            ok: false,
            reason: `Expected ${profile.expectBackend}, initialized ${backend}.`,
            backend,
        };
    }

    return {
        ok: true,
        backend,
        rendererPowerPreference: theme.getDiagnostics?.()?.rendererPowerPreference || null,
        quality: theme.getCurrentQualityLevel?.()
            || theme.activeQualityLevel
            || window.settings?.effectQuality
            || null,
        fullReady: true,
        board,
        debugReady: typeof debug.isReady === 'function' ? debug.isReady() : true,
        manualDriverAvailable: [
            debug.beginValidationDriver,
            debug.stepValidationFrame,
            debug.endValidationDriver,
        ].every((method) => typeof method === 'function'),
        themeCanvasCount: document.querySelectorAll('#stillwater-theme canvas').length,
        totalCanvasCount: document.querySelectorAll('canvas').length,
        settings: {
            effectQuality: window.settings?.effectQuality,
            graphicsQuality: window.settings?.graphicsQuality,
            targetFrameRate: window.settings?.targetFrameRate,
            renderScale: window.settings?.renderScale,
            enableAntialiasing: window.settings?.enableAntialiasing,
            backgroundComboEffects: window.settings?.backgroundComboEffects,
        },
    };
}

async function ensureProductionBoardRunningPage(options) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const waitForStable = async (predicate, timeoutMs, stableMs) => {
        const startedAt = Date.now();
        let stableSince = null;
        while (Date.now() - startedAt < timeoutMs) {
            try {
                if (predicate()) {
                    if (stableSince === null) stableSince = Date.now();
                    if (Date.now() - stableSince >= stableMs) return true;
                } else {
                    stableSince = null;
                }
            } catch {
                // The mode may be replacing its Phaser scene while restarting.
                stableSince = null;
            }
            await sleep(100);
        }
        return false;
    };
    const withTimeout = async (promise, timeoutMs, label) => {
        let timeoutId = null;
        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    };
    const game = window.serenityBlocks;
    const modeManager = game?.gameModeManager;
    if (!game || !modeManager) {
        return {
            ok: false,
            reason: 'Application or game-mode manager unavailable during board recovery.',
        };
    }
    const blockingModalSelectors = [
        '#game-over-modal',
        '#demo-complete-modal',
        '#start-modal',
        '#match-results-modal',
        '#odyssey-results-modal',
    ];
    const modalVisibility = (modal) => {
        if (!modal) return { requested: false, computed: false };
        const requested = modal.classList.contains('visible')
            || (
                (modal.id === 'match-results-modal' || modal.id === 'odyssey-results-modal')
                && !modal.classList.contains('hidden')
            );
        const style = getComputedStyle(modal);
        const rect = modal.getBoundingClientRect();
        const computed = style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || 1) > 0.01
            && rect.width > 0
            && rect.height > 0;
        return { requested, computed };
    };
    const findBlockingModal = () => {
        const candidates = blockingModalSelectors
            .map((selector) => document.querySelector(selector))
            .filter(Boolean);
        return candidates.find((modal) => {
            const visibility = modalVisibility(modal);
            return visibility.requested || visibility.computed;
        }) || null;
    };
    const readBoardState = () => {
        const mode = modeManager.getCurrentMode?.() || null;
        const gameState = mode?.gameState || null;
        const activeSession = mode?._activeSession || null;
        const blockingModal = findBlockingModal();
        const visibility = modalVisibility(blockingModal);
        const activeSessionPresent = Boolean(activeSession);
        const sessionOwnsGameState = activeSessionPresent
            && activeSession.gameState === gameState;
        return {
            mode,
            gameState,
            activeSession,
            modeId: modeManager.getCurrentModeId?.() || null,
            modeRunning: mode?.isRunning === true,
            modePaused: mode?.isPaused === true,
            boardSceneActive: game.phaserGame?.scene?.isActive?.('BoardScene') === true,
            gameOver: gameState?.isGameOver === true,
            stopped: gameState?.isStopped === true,
            processingGameOver: mode?.isProcessingGameOver === true,
            pendingStop: Boolean(mode?._stopPromise),
            activeSessionPresent,
            sessionOwnsGameState,
            sessionGeneration: Number.isFinite(mode?._sessionGeneration)
                ? mode._sessionGeneration
                : null,
            activeSessionGeneration: Number.isFinite(activeSession?.generation)
                ? activeSession.generation
                : null,
            blockingModal: blockingModal?.id || null,
            blockingModalRequested: visibility.requested,
            blockingModalComputed: visibility.computed,
        };
    };
    const beforeState = readBoardState();
    const previousGameState = beforeState.modeId === 'single'
        ? beforeState.gameState
        : null;
    const previousGeneration = beforeState.modeId === 'single'
        ? beforeState.sessionGeneration
        : null;
    const hadBlockingModal = Boolean(beforeState.blockingModal);
    const forceRestart = options.forceRestart === true
        || hadBlockingModal
        || beforeState.modeId !== 'single'
        || beforeState.modeRunning !== true
        || beforeState.boardSceneActive !== true
        || beforeState.gameOver
        || beforeState.stopped
        || beforeState.processingGameOver
        || beforeState.pendingStop
        || !beforeState.activeSessionPresent
        || !beforeState.sessionOwnsGameState;
    const hideBlockingModals = () => {
        game.modalManager?.hideAll?.();
        // Odyssey creates this modal dynamically with its own key listener, so
        // dismiss it through its public interaction path before mode recovery.
        const odysseyModal = document.querySelector('#odyssey-results-modal');
        if (odysseyModal) {
            const buttons = [...odysseyModal.querySelectorAll('button')];
            const dismissButton = buttons.find(
                (button) => button.textContent?.trim() === 'Continue',
            );
            if (dismissButton) dismissButton.click();
            else {
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                }));
            }
            if (odysseyModal.isConnected) odysseyModal.remove();
        }
        [
            '#game-over-modal',
            '#demo-complete-modal',
            '#start-modal',
        ].forEach((selector) => {
            const modal = document.querySelector(selector);
            modal?.classList?.remove('visible');
        });
        document.querySelector('#match-results-modal')?.classList?.add?.('hidden');
        document.body.classList.remove('start-modal-open', 'serenity-mode');
    };

    let restarted = false;
    let restartReason = null;
    try {
        hideBlockingModals();
        if (forceRestart && modeManager.getCurrentMode?.()) {
            await withTimeout(
                modeManager.deactivateCurrentMode(),
                options.timeoutMs,
                'deactivateCurrentMode',
            );
        }
        if (modeManager.getCurrentModeId?.() !== 'single') {
            await withTimeout(
                modeManager.activateMode('single'),
                options.timeoutMs,
                'activateMode(single)',
            );
            restarted = true;
            if (forceRestart) {
                restartReason = hadBlockingModal ? 'blocking-modal' : 'forced';
            } else {
                restartReason = 'activate-single';
            }
        }
        const mode = modeManager.getCurrentMode?.();
        const boardSceneActive = game.phaserGame?.scene?.isActive?.('BoardScene') === true;
        if (forceRestart || mode?.isRunning !== true || !boardSceneActive) {
            await withTimeout(
                modeManager.startCurrentMode({ seed: options.seed }),
                options.timeoutMs,
                'startCurrentMode(single)',
            );
            restarted = true;
            if (!restartReason) restartReason = 'inactive-board';
        }
        game.movePhaserGameToContainer?.('phaser-game-container');
        const phaserCanvas = game.phaserGame?.canvas
            || document.querySelector('#phaser-game-container canvas');
        [
            'position',
            'top',
            'left',
            'width',
            'height',
            'z-index',
        ].forEach((property) => phaserCanvas?.style?.removeProperty?.(property));
        game.resumeSinglePlayerScene?.();
        game.handleResize?.();
        hideBlockingModals();
        window.isRenderingPaused = false;
        window.isRenderingReduced = false;
    } catch (error) {
        return {
            ok: false,
            restarted,
            reason: `Failed to restore production board: ${error?.message || String(error)}`,
        };
    }

    const expectedState = readBoardState();
    const expectedGeneration = expectedState.activeSessionGeneration;
    const replacementStateCreated = !previousGameState
        || expectedState.gameState !== previousGameState;
    const generationAdvanced = !Number.isFinite(previousGeneration)
        || (
            Number.isFinite(expectedGeneration)
            && expectedGeneration > previousGeneration
        );
    const stableMs = Math.max(500, Number(options.stableMs) || 1000);
    const ready = await waitForStable(() => {
        const canvas = document.querySelector('#phaser-game-container canvas');
        const rect = canvas?.getBoundingClientRect?.();
        const state = readBoardState();
        return state.modeId === 'single'
            && state.modeRunning
            && !state.gameOver
            && !state.stopped
            && !state.processingGameOver
            && !state.pendingStop
            && state.activeSessionPresent
            && state.sessionOwnsGameState
            && Number.isFinite(expectedGeneration)
            && state.activeSessionGeneration === expectedGeneration
            && state.boardSceneActive
            && canvas?.clientWidth >= 200
            && canvas?.clientHeight >= 400
            && rect?.width >= 200
            && rect?.height >= 400
            && !document.body.classList.contains('serenity-mode')
            && !findBlockingModal();
    }, options.timeoutMs, stableMs);
    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const canvas = document.querySelector('#phaser-game-container canvas');
    const rect = canvas?.getBoundingClientRect?.();
    const finalState = readBoardState();
    return {
        ok: ready
            && !finalState.blockingModal
            && Number.isFinite(expectedGeneration)
            && finalState.activeSessionGeneration === expectedGeneration
            && (
                !forceRestart
                || (replacementStateCreated && generationAdvanced)
            ),
        restarted,
        restartReason,
        forceRestart: options.forceRestart === true,
        hadBlockingModal,
        stableMs,
        replacementStateCreated,
        generationAdvanced,
        previousGeneration,
        expectedGeneration,
        modeId: finalState.modeId,
        modeRunning: finalState.modeRunning,
        modePaused: finalState.modePaused,
        boardSceneActive: finalState.boardSceneActive,
        gameOver: finalState.gameOver,
        stopped: finalState.stopped,
        processingGameOver: finalState.processingGameOver,
        pendingStop: finalState.pendingStop,
        activeSessionPresent: finalState.activeSessionPresent,
        sessionOwnsGameState: finalState.sessionOwnsGameState,
        sessionGeneration: finalState.sessionGeneration,
        activeSessionGeneration: finalState.activeSessionGeneration,
        blockingModalVisible: Boolean(finalState.blockingModal),
        blockingModal: finalState.blockingModal,
        blockingModalRequested: finalState.blockingModalRequested,
        blockingModalComputed: finalState.blockingModalComputed,
        canvas: canvas ? {
            clientHeight: canvas.clientHeight,
            clientWidth: canvas.clientWidth,
            height: canvas.height,
            width: canvas.width,
            rect: rect ? {
                height: rect.height,
                width: rect.width,
                x: rect.x,
                y: rect.y,
            } : null,
        } : null,
    };
}

async function captureFramesPage(options) {
    const theme = window.themeManager?.activeTheme;
    const debug = window.__STILLWATER_MASTERPIECE__;
    if (!theme?.renderer || !debug) {
        return { ok: false, reason: 'Stillwater runtime unavailable during frame capture.' };
    }
    const modeManager = window.serenityBlocks?.gameModeManager || null;
    const blockingModalSelector = [
        '#game-over-modal.visible',
        '#demo-complete-modal.visible',
        '#start-modal.visible',
        '#match-results-modal:not(.hidden)',
        '#odyssey-results-modal:not(.hidden)',
    ].join(', ');
    const inspectProductionBoard = () => {
        const canvas = document.querySelector('#phaser-game-container canvas');
        const rect = canvas?.getBoundingClientRect?.();
        const blockingModal = document.querySelector(blockingModalSelector);
        const mode = modeManager?.getCurrentMode?.();
        const gameState = mode?.gameState || null;
        const activeSession = mode?._activeSession || null;
        const modeRunning = mode?.isRunning === true;
        const boardSceneActive = window.serenityBlocks?.phaserGame?.scene
            ?.isActive?.('BoardScene') === true;
        const bodySerenityMode = document.body.classList.contains('serenity-mode');
        const canvasReady = canvas?.clientWidth >= 200
            && canvas?.clientHeight >= 400
            && rect?.width >= 200
            && rect?.height >= 400;
        const gameOver = gameState?.isGameOver === true;
        const stopped = gameState?.isStopped === true;
        const processingGameOver = mode?.isProcessingGameOver === true;
        const pendingStop = Boolean(mode?._stopPromise);
        const activeSessionPresent = Boolean(activeSession);
        const sessionOwnsGameState = activeSessionPresent
            && activeSession.gameState === gameState;
        const sessionGeneration = Number.isFinite(mode?._sessionGeneration)
            ? mode._sessionGeneration
            : null;
        const activeSessionGeneration = Number.isFinite(activeSession?.generation)
            ? activeSession.generation
            : null;
        return {
            ok: modeManager?.getCurrentModeId?.() === 'single'
                && modeRunning
                && boardSceneActive
                && !bodySerenityMode
                && !blockingModal
                && !gameOver
                && !stopped
                && !processingGameOver
                && !pendingStop
                && activeSessionPresent
                && sessionOwnsGameState
                && Number.isFinite(activeSessionGeneration)
                && Number.isFinite(sessionGeneration)
                && activeSessionGeneration === sessionGeneration
                && canvasReady,
            modeId: modeManager?.getCurrentModeId?.() || null,
            modeRunning,
            modePaused: mode?.isPaused === true,
            boardSceneActive,
            bodySerenityMode,
            blockingModal: blockingModal?.id || null,
            gameOver,
            stopped,
            processingGameOver,
            pendingStop,
            activeSessionPresent,
            sessionOwnsGameState,
            sessionGeneration,
            activeSessionGeneration,
            canvasReady,
        };
    };
    const boardBefore = inspectProductionBoard();
    let boardPauseApplied = false;
    let boardPaused = null;
    const pauseProductionBoard = () => {
        const mode = modeManager?.getCurrentMode?.();
        if (
            modeManager?.getCurrentModeId?.() === 'single'
            && mode?.isRunning === true
            && mode?.isPaused !== true
        ) {
            modeManager.pauseCurrentMode({
                reason: 'stillwater-isolated-frame-capture',
            });
            boardPauseApplied = true;
        }
        boardPaused = inspectProductionBoard();
        return boardPaused;
    };

    const frameTimes = [];
    const cpuSubmissionTimes = [];
    const queueWaitTimes = [];
    const completedFrameTimes = [];
    const gpuTimestampTimes = [];
    const timestampedWorkloadTimes = [];
    const completionSources = {};
    const rendererSamples = [];
    const reactionResults = [];
    const frameErrors = [];
    const sequence = Array.isArray(options.reactionSequence)
        && options.reactionSequence.length > 0
        ? options.reactionSequence
        : [
            'lock',
            'harddrop',
            'tetris',
            'tspin',
            'combo',
            'perfectclear',
            'b2b',
            'levelup',
        ];
    let startedAt = performance.now();
    const targetFrameMs = 1000 / options.targetFps;
    const reactionInterval = Math.max(
        1,
        Number(options.reactionIntervalMs) || 2000,
    );
    let previousFrameAt = null;
    let lastRendererSampleAt = -Infinity;
    let nextReactionAt = options.reactions ? Math.min(500, reactionInterval) : Infinity;
    let reactionIndex = 0;
    let manualWarmupFrames = 0;
    let manualWarmupMs = 0;
    let manualWarmup = null;

    const summarizeWarmupValues = (rawValues) => {
        const values = rawValues
            .filter((value) => Number.isFinite(value))
            .sort((a, b) => a - b);
        const at = (ratio) => {
            if (values.length === 0) return null;
            return values[
                Math.min(values.length - 1, Math.floor(values.length * ratio))
            ];
        };
        return {
            sampleCount: values.length,
            p50Ms: at(0.50),
            p95Ms: at(0.95),
        };
    };
    const median = (values) => summarizeWarmupValues(values).p50Ms;
    const metricSpanStable = (values, absoluteTolerance, ratioTolerance) => {
        if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
            return false;
        }
        const center = median(values);
        const span = Math.max(...values) - Math.min(...values);
        return span <= Math.max(absoluteTolerance, center * ratioTolerance);
    };
    const evaluateWarmupWindows = (windows) => {
        const selected = windows.slice(-3);
        const gpuP50Values = selected.map((windowSummary) => (
            windowSummary.gpuTimestamp.p50Ms
        ));
        const gpuP95Values = selected.map((windowSummary) => (
            windowSummary.gpuTimestamp.p95Ms
        ));
        const cpuP50Values = selected.map((windowSummary) => (
            windowSummary.cpuSubmission.p50Ms
        ));
        const stable = selected.length === 3
            && selected.every(
                (windowSummary) => (
                    windowSummary.gpuTimestamp.sampleCount >= 20
                    && windowSummary.cpuSubmission.sampleCount >= 20
                ),
            )
            && metricSpanStable(gpuP50Values, 0.15, 0.03)
            && metricSpanStable(gpuP95Values, 0.30, 0.05)
            && metricSpanStable(cpuP50Values, 0.10, 0.10);
        return {
            stable,
            windowCount: selected.length,
            gpuP50Ms: median(gpuP50Values),
            gpuP95Ms: median(gpuP95Values),
            cpuP50Ms: median(cpuP50Values),
            tolerances: {
                gpuP50AbsoluteMs: 0.15,
                gpuP50Ratio: 0.03,
                gpuP95AbsoluteMs: 0.30,
                gpuP95Ratio: 0.05,
                cpuP50AbsoluteMs: 0.10,
                cpuP50Ratio: 0.10,
            },
        };
    };

    if (options.reactions) debug.resetReactions?.();

    const recordFrameStart = (now) => {
        const elapsed = now - startedAt;
        if (previousFrameAt !== null) {
            const delta = now - previousFrameAt;
            if (Number.isFinite(delta) && delta > 0 && delta < 2000) {
                frameTimes.push(delta);
            }
        }
        previousFrameAt = now;

        while (options.reactions && elapsed >= nextReactionAt) {
            const scheduledElapsedMs = nextReactionAt;
            const preset = sequence[reactionIndex % sequence.length];
            try {
                reactionResults.push({
                    elapsedMs: elapsed,
                    scheduledElapsedMs,
                    preset,
                    accepted: debug.triggerPreset?.(preset) === true,
                });
            } catch (error) {
                reactionResults.push({
                    elapsedMs: elapsed,
                    scheduledElapsedMs,
                    preset,
                    accepted: false,
                    error: error?.message || String(error),
                });
            }
            reactionIndex += 1;
            nextReactionAt += reactionInterval;
        }

        if (elapsed - lastRendererSampleAt >= 250) {
            lastRendererSampleAt = elapsed;
            const info = theme.renderer?.info || {};
            let customCounters = null;
            try {
                customCounters = debug.getRendererCounters?.() || null;
            } catch {
                customCounters = null;
            }
            rendererSamples.push({
                elapsedMs: elapsed,
                render: { ...(info.render || {}) },
                compute: { ...(info.compute || {}) },
                memory: { ...(info.memory || {}) },
                programs: Array.isArray(info.programs) ? info.programs.length : null,
                customCounters,
            });
        }
    };

    const recordManualStep = (step) => {
        const completionSource = step?.completionSource || 'unknown';
        completionSources[completionSource] = (completionSources[completionSource] || 0) + 1;
        if (Number.isFinite(step?.cpuSubmissionMs)) {
            cpuSubmissionTimes.push(step.cpuSubmissionMs);
        }
        if (Number.isFinite(step?.queueWaitMs)) {
            queueWaitTimes.push(step.queueWaitMs);
        }
        if (Number.isFinite(step?.completedFrameMs)) {
            completedFrameTimes.push(step.completedFrameMs);
        }
        if (Number.isFinite(step?.gpuTimestampMs)) {
            gpuTimestampTimes.push(step.gpuTimestampMs);
            if (Number.isFinite(step?.cpuSubmissionMs)) {
                timestampedWorkloadTimes.push(
                    step.cpuSubmissionMs + step.gpuTimestampMs,
                );
            }
        }
        if (!step?.ok || step?.rendered !== true) {
            frameErrors.push({
                ok: step?.ok === true,
                rendered: step?.rendered === true,
                reason: step?.reason || null,
                queueCompletionError: step?.queueCompletionError || null,
                gpuTimestampError: step?.gpuTimestampError || null,
            });
        }
    };

    const finish = (manualDriver, manualDriverStart = null, manualDriverEnd = null) => {
        let perfSummary = null;
        let perfPercentiles = null;
        let perfCounters = null;
        try {
            perfSummary = window.perfMonitor?.getFrameTimeSummary?.(options.targetFps) || null;
            perfPercentiles = window.perfMonitor?.getPercentiles?.() || null;
            perfCounters = window.perfMonitor?.getCounters?.() || null;
        } catch {
            // Harness samples remain authoritative for this report.
        }
        const boardDuring = inspectProductionBoard();
        let boardResumeError = null;
        if (
            boardPauseApplied
            && modeManager?.getCurrentMode?.()?.isPaused === true
        ) {
            try {
                modeManager.resumeCurrentMode();
            } catch (error) {
                boardResumeError = error?.message || String(error);
                frameErrors.push({
                    phase: 'board-resume',
                    ok: false,
                    rendered: false,
                    reason: boardResumeError,
                });
            }
        }
        const boardAfter = inspectProductionBoard();
        const boardLifecycle = {
            pauseApplied: boardPauseApplied,
            resumeError: boardResumeError,
            before: boardBefore,
            paused: boardPaused,
            during: boardDuring,
            after: boardAfter,
        };
        const boardLifecycleOk = boardBefore.ok
            && boardDuring.ok
            && boardAfter.ok
            && (
                !boardPauseApplied
                || (
                    boardDuring.modePaused === true
                    && boardAfter.modePaused !== true
                    && boardResumeError === null
                )
            );
        return {
            ok: frameErrors.length === 0 && boardLifecycleOk,
            label: options.label,
            durationMs: performance.now() - startedAt,
            targetFrameMs,
            manualDriver,
            manualDriverStart,
            manualDriverEnd,
            manualWarmupFrames,
            manualWarmupMs,
            manualWarmup,
            frameTimes,
            cpuSubmissionTimes,
            queueWaitTimes,
            completedFrameTimes,
            gpuTimestampTimes,
            timestampedWorkloadTimes,
            completionSources,
            frameErrors,
            rendererSamples,
            reactionResults,
            boardLifecycle,
            perfSummary,
            perfPercentiles,
            perfCounters,
        };
    };

    const manualDriverAvailable = [
        debug.beginValidationDriver,
        debug.stepValidationFrame,
        debug.endValidationDriver,
    ].every((method) => typeof method === 'function');
    if (options.manualDriver === true) {
        if (!manualDriverAvailable) {
            return {
                ok: false,
                reason: 'Stillwater manual validation driver is unavailable.',
            };
        }
        pauseProductionBoard();
        let manualDriverStart = null;
        try {
            manualDriverStart = debug.beginValidationDriver();
        } catch (error) {
            return {
                ...finish(true, null, null),
                ok: false,
                reason: `Could not start manual validation driver: ${
                    error?.message || String(error)
                }`,
            };
        }
        if (!manualDriverStart?.ok) {
            return {
                ...finish(true, manualDriverStart, null),
                ok: false,
                reason: manualDriverStart?.reason || 'Could not start manual validation driver.',
                manualDriverStart,
            };
        }

        let manualDriverEnd = null;
        let frameIndex = 0;
        try {
            const warmupStartedAt = performance.now();
            const warmupWindowMs = Math.max(
                500,
                Number(options.manualWarmupWindowMs) || 2000,
            );
            const warmupMinimumMs = Math.max(
                warmupWindowMs * 3,
                Number(options.manualWarmupMs) || 0,
            );
            const warmupMaximumMs = Math.max(
                warmupMinimumMs,
                Number(options.manualWarmupMaxMs) || warmupMinimumMs,
            );
            const warmupWindows = [];
            let warmupFrameIndex = 0;
            let windowStartedAt = warmupStartedAt;
            let windowCpuTimes = [];
            let windowGpuTimes = [];
            let warmupEvaluation = evaluateWarmupWindows(warmupWindows);
            while (performance.now() - warmupStartedAt < warmupMaximumMs) {
                const deadline = warmupStartedAt
                    + (warmupFrameIndex * targetFrameMs);
                const waitMs = deadline - performance.now();
                if (waitMs > 0) {
                    await new Promise((resolve) => {
                        setTimeout(resolve, waitMs);
                    });
                }
                const step = await debug.stepValidationFrame(performance.now());
                manualWarmupFrames += 1;
                warmupFrameIndex += 1;
                if (Number.isFinite(step?.cpuSubmissionMs)) {
                    windowCpuTimes.push(step.cpuSubmissionMs);
                }
                if (Number.isFinite(step?.gpuTimestampMs)) {
                    windowGpuTimes.push(step.gpuTimestampMs);
                }
                if (!step?.ok || step?.rendered !== true) {
                    frameErrors.push({
                        phase: 'warmup',
                        ok: step?.ok === true,
                        rendered: step?.rendered === true,
                        reason: step?.reason || null,
                        queueCompletionError: step?.queueCompletionError || null,
                        gpuTimestampError: step?.gpuTimestampError || null,
                    });
                    break;
                }
                const now = performance.now();
                if (now - windowStartedAt >= warmupWindowMs) {
                    warmupWindows.push({
                        index: warmupWindows.length,
                        durationMs: now - windowStartedAt,
                        cpuSubmission: summarizeWarmupValues(windowCpuTimes),
                        gpuTimestamp: summarizeWarmupValues(windowGpuTimes),
                    });
                    windowStartedAt = now;
                    windowCpuTimes = [];
                    windowGpuTimes = [];
                    warmupEvaluation = evaluateWarmupWindows(warmupWindows);
                    if (
                        now - warmupStartedAt >= warmupMinimumMs
                        && warmupEvaluation.stable
                    ) {
                        break;
                    }
                }
            }
            manualWarmupMs = performance.now() - warmupStartedAt;
            manualWarmup = {
                stable: warmupEvaluation.stable,
                minimumMs: warmupMinimumMs,
                maximumMs: warmupMaximumMs,
                windowMs: warmupWindowMs,
                durationMs: manualWarmupMs,
                frameCount: manualWarmupFrames,
                windows: warmupWindows,
                settledState: warmupEvaluation,
                pacing: 'target-paced-isolated-manual-production-frame',
                effectsActive: false,
            };
            startedAt = performance.now();
            previousFrameAt = null;
            lastRendererSampleAt = -Infinity;
            nextReactionAt = options.reactions ? Math.min(500, reactionInterval) : Infinity;
            while (performance.now() - startedAt < options.durationMs) {
                const deadline = startedAt + (frameIndex * targetFrameMs);
                const waitMs = deadline - performance.now();
                if (waitMs > 0) {
                    await new Promise((resolve) => {
                        setTimeout(resolve, waitMs);
                    });
                }
                const now = performance.now();
                recordFrameStart(now);
                const step = await debug.stepValidationFrame(now);
                recordManualStep(step);
                frameIndex += 1;
                if (!step?.ok) break;
            }
        } catch (error) {
            frameErrors.push({
                phase: 'capture',
                ok: false,
                rendered: false,
                reason: error?.message || String(error),
            });
        } finally {
            try {
                manualDriverEnd = debug.endValidationDriver();
            } catch (error) {
                manualDriverEnd = {
                    ok: false,
                    reason: error?.message || String(error),
                };
                frameErrors.push({
                    phase: 'manual-driver-cleanup',
                    ok: false,
                    rendered: false,
                    reason: manualDriverEnd.reason,
                });
            }
        }
        return finish(true, manualDriverStart, manualDriverEnd);
    }

    pauseProductionBoard();
    return new Promise((resolve) => {
        const sample = (now) => {
            recordFrameStart(now);
            if (now - startedAt < options.durationMs) {
                requestAnimationFrame(sample);
                return;
            }
            resolve(finish(false));
        };
        requestAnimationFrame(sample);
    });
}

async function collectPageDiagnosticsPage() {
    const theme = window.themeManager?.activeTheme || null;
    const renderer = theme?.renderer || null;
    const debug = window.__STILLWATER_MASTERPIECE__ || null;
    const resolveBackend = () => {
        if (theme?.isWebGPU || renderer?.backend?.isWebGPUBackend) return 'WebGPU';
        if (theme?.isWebGL || renderer?.backend?.isWebGLBackend) return 'WebGL2';
        const name = String(theme?.backendName || renderer?.backend?.constructor?.name || '');
        if (/webgpu/i.test(name)) return 'WebGPU';
        if (/webgl/i.test(name)) return 'WebGL2';
        return 'Unknown';
    };
    const summarize = (value, depth = 0, seen = new WeakSet()) => {
        if (value === null || value === undefined) return value ?? null;
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            return value;
        }
        if (ArrayBuffer.isView(value)) {
            return {
                type: value.constructor?.name || 'TypedArray',
                length: value.length,
                byteLength: value.byteLength,
            };
        }
        if (Array.isArray(value)) {
            if (depth >= 3 || value.length > 32) return { type: 'Array', length: value.length };
            return value.map((entry) => summarize(entry, depth + 1, seen));
        }
        if (typeof value !== 'object') return String(value);
        if (seen.has(value)) return '[circular]';
        if (depth >= 4) return `[${value.constructor?.name || 'Object'}]`;
        seen.add(value);
        const result = {};
        Object.entries(value).slice(0, 80).forEach(([key, entry]) => {
            if (typeof entry !== 'function') result[key] = summarize(entry, depth + 1, seen);
        });
        return result;
    };
    const sceneStats = {
        objects: 0,
        meshes: 0,
        instancedMeshes: 0,
        lights: 0,
        materials: 0,
        geometries: 0,
    };
    if (theme?.scene?.traverse) {
        const materials = new Set();
        const geometries = new Set();
        theme.scene.traverse((object) => {
            sceneStats.objects += 1;
            if (object.isMesh) sceneStats.meshes += 1;
            if (object.isInstancedMesh) sceneStats.instancedMeshes += 1;
            if (object.isLight) sceneStats.lights += 1;
            if (object.geometry) geometries.add(object.geometry);
            const objectMaterials = Array.isArray(object.material)
                ? object.material
                : [object.material];
            objectMaterials.filter(Boolean).forEach((material) => materials.add(material));
        });
        sceneStats.materials = materials.size;
        sceneStats.geometries = geometries.size;
    }
    let debugDiagnostics = null;
    let resourceState = null;
    let rendererCounters = null;
    let themeDiagnostics = null;
    let activationTelemetry = null;
    try {
        debugDiagnostics = debug?.getDiagnostics?.() || null;
    } catch (error) {
        debugDiagnostics = { error: error?.message || String(error) };
    }
    try {
        resourceState = summarize(debug?.getResourceState?.() || null);
    } catch (error) {
        resourceState = { error: error?.message || String(error) };
    }
    try {
        rendererCounters = debug?.getRendererCounters?.() || null;
    } catch (error) {
        rendererCounters = { error: error?.message || String(error) };
    }
    try {
        themeDiagnostics = theme?.getDiagnostics?.() || null;
        const activation = themeDiagnostics?.validation?.activation || null;
        activationTelemetry = activation
            ? JSON.parse(JSON.stringify(activation))
            : null;
    } catch (error) {
        themeDiagnostics = { error: error?.message || String(error) };
        activationTelemetry = { error: error?.message || String(error) };
    }
    let perf = null;
    try {
        perf = {
            percentiles: window.perfMonitor?.getPercentiles?.() || null,
            counters: window.perfMonitor?.getCounters?.() || null,
            frameSummary: window.perfMonitor?.getFrameTimeSummary?.(60) || null,
            gates: window.perfMonitor?.gates?.() || null,
        };
    } catch (error) {
        perf = { error: error?.message || String(error) };
    }
    const canvases = Array.from(document.querySelectorAll('canvas')).map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return {
            id: canvas.id || null,
            className: canvas.className || null,
            width: canvas.width,
            height: canvas.height,
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            },
            inStillwaterContainer: Boolean(canvas.closest('#stillwater-theme')),
        };
    });
    const boardCanvas = document.querySelector('#phaser-game-container canvas');
    const boardContainer = document.getElementById('phaser-game-container');
    const boardStage = document.querySelector('.single-player-stage');
    const boardRect = boardCanvas?.getBoundingClientRect?.() || null;
    const containerRect = boardContainer?.getBoundingClientRect?.() || null;
    const stageStyle = boardStage ? getComputedStyle(boardStage) : null;
    const containerStyle = boardContainer ? getComputedStyle(boardContainer) : null;
    const boardMode = window.serenityBlocks?.gameModeManager?.getCurrentMode?.() || null;
    const boardGameState = boardMode?.gameState || null;
    const activeSession = boardMode?._activeSession || null;
    const modalCandidates = [
        document.getElementById('game-over-modal'),
        document.getElementById('demo-complete-modal'),
        document.getElementById('start-modal'),
        document.getElementById('match-results-modal'),
        document.getElementById('odyssey-results-modal'),
    ].filter(Boolean);
    const describeModalVisibility = (modal) => {
        if (!modal) return { requested: false, computed: false };
        const requested = modal.classList.contains('visible')
            || (
                (modal.id === 'match-results-modal' || modal.id === 'odyssey-results-modal')
                && !modal.classList.contains('hidden')
            );
        const style = getComputedStyle(modal);
        const rect = modal.getBoundingClientRect();
        const computed = style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || 1) > 0.01
            && rect.width > 0
            && rect.height > 0;
        return { requested, computed };
    };
    const blockingModal = modalCandidates.find((modal) => {
        const visibility = describeModalVisibility(modal);
        return visibility.requested || visibility.computed;
    }) || null;
    const blockingModalVisibility = describeModalVisibility(blockingModal);
    const boardSurface = {
        modeId: window.serenityBlocks?.gameModeManager?.getCurrentModeId?.() || null,
        modeRunning: boardMode?.isRunning === true,
        modePaused: boardMode?.isPaused === true,
        boardSceneActive: window.serenityBlocks?.phaserGame?.scene?.isActive?.('BoardScene') === true,
        bodySerenityMode: document.body.classList.contains('serenity-mode'),
        blockingModal: blockingModal?.id || null,
        blockingModalRequested: blockingModalVisibility.requested,
        blockingModalComputed: blockingModalVisibility.computed,
        gameOver: boardGameState?.isGameOver === true,
        stopped: boardGameState?.isStopped === true,
        processingGameOver: boardMode?.isProcessingGameOver === true,
        pendingStop: Boolean(boardMode?._stopPromise),
        activeSessionPresent: Boolean(activeSession),
        sessionOwnsGameState: Boolean(
            activeSession
            && activeSession.gameState === boardGameState,
        ),
        sessionGeneration: Number.isFinite(boardMode?._sessionGeneration)
            ? boardMode._sessionGeneration
            : null,
        activeSessionGeneration: Number.isFinite(activeSession?.generation)
            ? activeSession.generation
            : null,
        canvasPresent: Boolean(boardCanvas),
        canvas: boardCanvas ? {
            width: boardCanvas.width,
            height: boardCanvas.height,
            clientWidth: boardCanvas.clientWidth,
            clientHeight: boardCanvas.clientHeight,
            rect: boardRect ? {
                x: boardRect.x,
                y: boardRect.y,
                width: boardRect.width,
                height: boardRect.height,
            } : null,
        } : null,
        container: boardContainer ? {
            display: containerStyle?.display || null,
            visibility: containerStyle?.visibility || null,
            opacity: containerStyle?.opacity || null,
            rect: containerRect ? {
                x: containerRect.x,
                y: containerRect.y,
                width: containerRect.width,
                height: containerRect.height,
            } : null,
        } : null,
        stage: boardStage ? {
            display: stageStyle?.display || null,
            visibility: stageStyle?.visibility || null,
            opacity: stageStyle?.opacity || null,
        } : null,
    };
    boardSurface.ok = boardSurface.modeId === 'single'
        && boardSurface.modeRunning
        && boardSurface.boardSceneActive
        && !boardSurface.bodySerenityMode
        && !boardSurface.blockingModal
        && !boardSurface.gameOver
        && !boardSurface.stopped
        && !boardSurface.processingGameOver
        && !boardSurface.pendingStop
        && boardSurface.activeSessionPresent
        && boardSurface.sessionOwnsGameState
        && Number.isFinite(boardSurface.activeSessionGeneration)
        && Number.isFinite(boardSurface.sessionGeneration)
        && boardSurface.activeSessionGeneration === boardSurface.sessionGeneration
        && boardSurface.canvas?.clientWidth >= 200
        && boardSurface.canvas?.clientHeight >= 400
        && boardSurface.canvas?.rect?.width >= 200
        && boardSurface.canvas?.rect?.height >= 400
        && boardSurface.container?.display !== 'none'
        && boardSurface.container?.visibility !== 'hidden'
        && Number(boardSurface.container?.opacity ?? 1) > 0
        && boardSurface.stage?.display !== 'none'
        && boardSurface.stage?.visibility !== 'hidden'
        && Number(boardSurface.stage?.opacity ?? 1) > 0;
    const device = renderer?.backend?.device || null;
    return {
        timestamp: new Date().toISOString(),
        activeThemeName: window.themeManager?.activeThemeName || null,
        backend: resolveBackend(),
        visibility: {
            state: document.visibilityState,
            hidden: document.hidden,
            renderingPaused: window.isRenderingPaused === true,
            renderingReduced: window.isRenderingReduced === true,
            themePaused: theme?.isPaused === true,
        },
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
        },
        settings: {
            effectQuality: window.settings?.effectQuality,
            graphicsQuality: window.settings?.graphicsQuality,
            targetFrameRate: window.settings?.targetFrameRate,
            renderScale: window.settings?.renderScale,
            enableAntialiasing: window.settings?.enableAntialiasing,
            backgroundComboEffects: window.settings?.backgroundComboEffects,
        },
        canvases,
        boardSurface,
        themeCanvasCount: canvases.filter((canvas) => canvas.inStillwaterContainer).length,
        renderer: renderer ? {
            pixelRatio: renderer.getPixelRatio?.() ?? null,
            width: renderer.domElement?.width ?? null,
            height: renderer.domElement?.height ?? null,
            outputQuadDisposeListeners:
                renderer._quad?.geometry?._listeners?.dispose?.length ?? 0,
            info: {
                autoReset: renderer.info?.autoReset ?? null,
                render: { ...(renderer.info?.render || {}) },
                compute: { ...(renderer.info?.compute || {}) },
                memory: { ...(renderer.info?.memory || {}) },
                programs: Array.isArray(renderer.info?.programs)
                    ? renderer.info.programs.length
                    : null,
            },
            backendClass: renderer.backend?.constructor?.name || null,
            devicePresent: Boolean(device),
            deviceFeatures: device?.features ? [...device.features].sort() : [],
        } : null,
        sceneStats,
        debug: {
            installed: Boolean(debug),
            ready: typeof debug?.isReady === 'function' ? debug.isReady() : null,
            criticalReady: typeof debug?.isCriticalReady === 'function'
                ? debug.isCriticalReady()
                : null,
            diagnostics: debugDiagnostics,
            resources: resourceState,
            rendererCounters,
        },
        themeDiagnostics: summarize(themeDiagnostics),
        // Preserve the complete, primitive-only validation record separately:
        // the general graph summarizer intentionally truncates nested scene
        // diagnostics and is not suitable for timestamp evidence.
        activationTelemetry,
        perf,
        jsMemory: performance.memory ? {
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSize: performance.memory.usedJSHeapSize,
        } : null,
        userAgent: navigator.userAgent,
    };
}

async function exercisePauseResumePage(options) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const game = window.serenityBlocks;
    if (
        typeof game?.pauseAllRendering !== 'function'
        || typeof game?.resumeFullRendering !== 'function'
    ) {
        return { ok: false, reason: 'Application pause/resume hooks are unavailable.' };
    }
    const readCounters = () => {
        const theme = window.themeManager?.activeTheme;
        const diagnostics = theme?.getDiagnostics?.() || {};
        return diagnostics?.frame?.counters
            || diagnostics?.frameCounters
            || diagnostics?.counters
            || null;
    };
    const finite = (value) => (Number.isFinite(value) ? value : null);
    const readCounter = (counters, keys) => {
        if (!counters) return null;
        for (let index = 0; index < keys.length; index += 1) {
            const value = finite(counters[keys[index]]);
            if (value !== null) return value;
        }
        return null;
    };
    const cycles = [];
    for (let index = 0; index < options.cycles; index += 1) {
        const before = readCounters();
        game.pauseAllRendering();
        await sleep(options.pauseMs);
        const pausedCounters = readCounters();
        const activeTheme = window.themeManager?.activeTheme;
        const paused = {
            renderingPaused: window.isRenderingPaused === true,
            renderingReduced: window.isRenderingReduced === true,
            themePaused: activeTheme?.isPaused === true,
        };
        game.resumeFullRendering();
        await sleep(options.resumeSettleMs);
        const resumedTheme = window.themeManager?.activeTheme;
        const after = readCounters();
        const resumed = {
            renderingPaused: window.isRenderingPaused === true,
            renderingReduced: window.isRenderingReduced === true,
            themePaused: resumedTheme?.isPaused === true,
            debugReady: typeof window.__STILLWATER_MASTERPIECE__?.isReady === 'function'
                ? window.__STILLWATER_MASTERPIECE__.isReady()
                : Boolean(window.__STILLWATER_MASTERPIECE__),
        };
        const updateKeys = ['simulationUpdates', 'updates', 'updateCount', 'updateFrames'];
        const renderKeys = ['composedRenders', 'renders', 'renderCount', 'renderFrames'];
        const pausedUpdates = readCounter(pausedCounters, updateKeys);
        const beforeUpdates = readCounter(before, updateKeys);
        const afterUpdates = readCounter(after, updateKeys);
        const pausedRenders = readCounter(pausedCounters, renderKeys);
        const beforeRenders = readCounter(before, renderKeys);
        const afterRenders = readCounter(after, renderKeys);
        const pausedWorkStable = (
            beforeUpdates === null
            || pausedUpdates === null
            || pausedUpdates === beforeUpdates
        ) && (
            beforeRenders === null
            || pausedRenders === null
            || pausedRenders === beforeRenders
        );
        const resumedUpdateDelta = afterUpdates !== null && pausedUpdates !== null
            ? afterUpdates - pausedUpdates
            : null;
        const resumedRenderDelta = afterRenders !== null && pausedRenders !== null
            ? afterRenders - pausedRenders
            : null;
        const oneRenderPerUpdate = resumedUpdateDelta === null
            || resumedRenderDelta === null
            || resumedUpdateDelta === resumedRenderDelta;
        cycles.push({
            cycle: index + 1,
            paused,
            resumed,
            before,
            pausedCounters,
            after,
            pausedWorkStable,
            resumedUpdateDelta,
            resumedRenderDelta,
            oneRenderPerUpdate,
            ok: paused.renderingPaused
                && !resumed.renderingPaused
                && !resumed.renderingReduced
                && !resumed.themePaused
                && resumed.debugReady
                && pausedWorkStable
                && oneRenderPerUpdate,
        });
    }
    return {
        ok: cycles.length === options.cycles && cycles.every((cycle) => cycle.ok),
        cycleCount: cycles.length,
        cycles,
    };
}

async function prepareHiddenValidationPage(options) {
    const game = window.serenityBlocks;
    try {
        game?.settingsManager?.update?.({
            backgroundTabBehavior: 'pause',
        }, false);
        game?.updateBackgroundTabBehavior?.('pause');
        game.backgroundTabBehavior = 'pause';
    } catch {
        // The selected visibility path remains observable through diagnostics.
    }
    const explicitPauseInvoked = options?.invokeExplicitPause === true;
    if (explicitPauseInvoked) game?.handleVisibilityChange?.(false);
    return {
        ok: Boolean(game),
        hidden: document.hidden,
        renderingPaused: window.isRenderingPaused === true,
        explicitPauseInvoked,
        policy: explicitPauseInvoked ? 'explicit-app-pause' : 'page-visibility',
    };
}

async function resumeHiddenValidationPage(options) {
    const explicitResumeInvoked = options?.invokeExplicitResume === true;
    if (explicitResumeInvoked) {
        window.serenityBlocks?.handleVisibilityChange?.(true);
    }
    return {
        ok: true,
        hidden: document.hidden,
        renderingPaused: window.isRenderingPaused === true,
        explicitResumeInvoked,
    };
}

async function setLayoutCapturePage(options) {
    const theme = window.themeManager?.activeTheme;
    if (!theme?.applyLayout) {
        return { ok: false, reason: 'Stillwater applyLayout() is unavailable.' };
    }
    const playerCounts = {
        solo: 1,
        duo: 2,
        quad: 4,
        odyssey: 1,
    };
    const gameModes = {
        solo: 'single',
        duo: 'local-multiplayer',
        quad: 'local-multiplayer',
        odyssey: 'odyssey',
    };
    const policy = theme.applyLayout(window.innerWidth, window.innerHeight, {
        stillwaterLayout: options.layout,
        gameMode: gameModes[options.layout] || 'single',
        playerCount: playerCounts[options.layout] || 1,
    });
    await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return {
        ok: policy?.layout === options.layout,
        policy,
        themeCanvasCount: document.querySelectorAll('#stillwater-theme canvas').length,
    };
}

async function inspectStillwaterCanvasFallbackPage() {
    const game = window.serenityBlocks;
    const phaserGame = game?.phaserGame || null;
    const renderer = phaserGame?.renderer || null;
    const boardCanvas = phaserGame?.canvas
        || document.querySelector('#phaser-game-container canvas');
    const rendererClass = renderer?.constructor?.name || null;
    const hasWebGlContext = Boolean(
        renderer?.gl
        || boardCanvas?.getContext?.('webgl2')
        || boardCanvas?.getContext?.('webgl'),
    );
    const nextHoldCanvasCount = [
        ...document.querySelectorAll(
            '#hold-canvas, [id^="next-"], [id*="-next-"]',
        ),
    ].filter((canvas) => canvas instanceof HTMLCanvasElement).length;
    return {
        supported: false,
        code: 'phaser4-production-board-is-webgl-only',
        rendererClass,
        rendererType: phaserGame?.config?.renderType
            ?? phaserGame?.config?.type
            ?? null,
        hasWebGlContext,
        boardCanvasPresent: Boolean(boardCanvas),
        boardCanvasSize: boardCanvas ? {
            width: boardCanvas.width,
            height: boardCanvas.height,
            clientWidth: boardCanvas.clientWidth,
            clientHeight: boardCanvas.clientHeight,
        } : null,
        nextHoldCanvasCount,
        note: 'Canvas 2D next/hold surfaces exist, but they are not a Phaser Canvas board fallback.',
    };
}

async function prepareProductionEventCapturePage(options) {
    const theme = window.themeManager?.activeTheme;
    const debug = window.__STILLWATER_MASTERPIECE__;
    const pendingKey = '__STILLWATER_PRODUCTION_EVENT_CAPTURE_PENDING__';
    if (!theme?.renderer || !debug) {
        return {
            ok: false,
            reason: 'Stillwater production runtime is unavailable for event capture.',
        };
    }
    if (
        typeof debug.beginValidationDriver !== 'function'
        || typeof debug.stepValidationFrame !== 'function'
        || typeof debug.endValidationDriver !== 'function'
    ) {
        return {
            ok: false,
            reason: 'Stillwater isolated validation driver is unavailable.',
        };
    }
    if (window[pendingKey]) {
        try {
            debug.endValidationDriver();
        } catch {
            // Recover a stale interrupted capture before starting the next one.
        }
        delete window[pendingKey];
    }

    const driverStart = debug.beginValidationDriver();
    if (driverStart?.ok !== true) {
        return {
            ok: false,
            reason: driverStart?.reason || 'Validation driver did not start.',
            driverStart,
        };
    }

    let timestamp = performance.now();
    const stepErrors = [];
    let stepCount = 0;
    const advance = async (durationMs, maximumStepMs = 70) => {
        const safeDuration = Math.max(0, Number(durationMs) || 0);
        const steps = Math.max(1, Math.ceil(safeDuration / maximumStepMs));
        const stepMs = safeDuration / steps;
        for (let index = 0; index < steps; index += 1) {
            timestamp += stepMs;
            const step = await debug.stepValidationFrame(timestamp);
            stepCount += 1;
            if (step?.ok !== true || step?.rendered !== true) {
                stepErrors.push({
                    index,
                    ok: step?.ok === true,
                    rendered: step?.rendered === true,
                    reason: step?.reason || null,
                    gpuTimestampError: step?.gpuTimestampError || null,
                });
            }
        }
    };
    const rendererMemory = () => ({
        geometries: theme.renderer?.info?.memory?.geometries ?? null,
        textures: theme.renderer?.info?.memory?.textures ?? null,
        programs: Array.isArray(theme.renderer?.info?.programs)
            ? theme.renderer.info.programs.length
            : null,
    });
    const summarizeResources = (state) => ({
        disposed: state?.disposed === true,
        water: {
            geometries: state?.water?.ownedGeometries ?? null,
            materials: state?.water?.ownedMaterials ?? null,
            waterMaterialVersion: state?.water?.waterMaterialVersion ?? null,
        },
        forest: {
            geometries: state?.forest?.ownedGeometries ?? null,
            materials: state?.forest?.ownedMaterials ?? null,
            renderables: state?.forest?.renderables ?? null,
        },
        characters: {
            geometries: state?.characters?.ownedGeometries ?? null,
            materials: state?.characters?.ownedMaterials ?? null,
            loadedRoots: state?.characters?.loadedRoots ?? null,
        },
        atmosphere: {
            geometries: state?.atmosphere?.geometries ?? null,
            materials: state?.atmosphere?.materials ?? null,
            moteCapacity: state?.atmosphere?.moteCapacity ?? null,
        },
        reactions: {
            geometries: state?.reactions?.geometries ?? null,
            materials: state?.reactions?.materials ?? null,
        },
        post: {
            bloomMaterials: state?.post?.bloomMaterials ?? null,
            disposed: state?.post?.disposed === true,
        },
    });

    try {
        debug.resetReactions?.();
        await advance(options?.settleMs ?? 2100);
        const beforeResources = debug.getResourceState?.() || null;
        const beforeMemory = rendererMemory();
        const lineCount = Math.max(0, Math.min(4, Math.round(
            Number(options?.lineCount) || 0,
        )));
        const clearedRows = [];
        for (let index = 0; index < lineCount; index += 1) {
            clearedRows.push(19 - index);
        }
        const payload = {
            source: 'stillwater-production-validation',
            isLocal: true,
            player: 0,
            piece: {
                type: 'T',
                shape: [
                    [0, 1, 0],
                    [1, 1, 1],
                    [0, 0, 0],
                ],
                rotation: 0,
                x: 3,
                y: 14,
                pieceId: `stillwater-production-${options?.id || 'event'}-t`,
            },
            viewportOrigin: { x: 0.5, y: 0.7 },
            lineCount,
            clearedRows,
            cascadeCount: 1,
            comboCount: Math.max(0, Math.round(Number(options?.comboCount) || 0)),
            startY: 0,
            endY: Math.max(0, Number(options?.distance) || 0),
            distance: Math.max(0, Number(options?.distance) || 0),
            level: Math.max(1, Math.round(Number(options?.level) || 1)),
            active: true,
            depth: 1,
        };
        const accepted = debug.triggerPreset?.(options?.preset, payload) === true;
        debug.flushReactions?.(0);
        await advance(options?.captureAgeMs ?? 520);
        const diagnostics = debug.getDiagnostics?.() || null;
        const routeCounts = diagnostics?.reaction?.routeCounts || null;
        const expectedRouteIndex = Number.isInteger(options?.expectedRouteIndex)
            ? options.expectedRouteIndex
            : null;
        const expectedRouteCount = expectedRouteIndex === null
            ? null
            : routeCounts?.[expectedRouteIndex] ?? null;
        const expectedRouteObserved = expectedRouteIndex === null
            || (
                Number.isFinite(expectedRouteCount)
                && expectedRouteCount > 0
            );
        const atCaptureResources = debug.getResourceState?.() || null;
        const atCaptureMemory = rendererMemory();
        window[pendingKey] = {
            eventId: options?.id || null,
            beforeResources,
            beforeMemory,
            atCaptureResources,
            atCaptureMemory,
            driverStart,
            accepted,
            stepErrors,
            stepCount,
        };
        return {
            ok: accepted && stepErrors.length === 0 && expectedRouteObserved,
            eventId: options?.id || null,
            preset: options?.preset || null,
            injection: 'production Stillwater validation API',
            accepted,
            expectedRoute: {
                index: expectedRouteIndex,
                count: expectedRouteCount,
                observed: expectedRouteObserved,
            },
            captureAgeMs: options?.captureAgeMs ?? 520,
            driverStart,
            stepCount,
            stepErrors,
            rendererMemoryBefore: beforeMemory,
            rendererMemoryAtCapture: atCaptureMemory,
            resourcesBefore: summarizeResources(beforeResources),
            resourcesAtCapture: summarizeResources(atCaptureResources),
            diagnostics: {
                quality: diagnostics?.quality || null,
                backend: diagnostics?.production?.backend || null,
                reaction: diagnostics?.reaction || null,
                water: diagnostics?.water || null,
                forest: diagnostics?.forest || null,
                characters: diagnostics?.characters || null,
                atmosphere: diagnostics?.atmosphere || null,
                reactions: diagnostics?.reactions || null,
                post: diagnostics?.post || null,
            },
        };
    } catch (error) {
        try {
            debug.endValidationDriver();
        } catch {
            // Best effort after an event-capture failure.
        }
        delete window[pendingKey];
        return {
            ok: false,
            eventId: options?.id || null,
            reason: error?.message || String(error),
            stack: error?.stack || null,
            driverStart,
            stepCount,
            stepErrors,
        };
    }
}

async function finishProductionEventCapturePage() {
    const pendingKey = '__STILLWATER_PRODUCTION_EVENT_CAPTURE_PENDING__';
    const pending = window[pendingKey];
    const debug = window.__STILLWATER_MASTERPIECE__;
    const theme = window.themeManager?.activeTheme;
    if (!pending || !debug || !theme?.renderer) {
        return {
            ok: false,
            reason: 'No prepared Stillwater production event capture is pending.',
        };
    }

    const before = pending.beforeResources;
    const after = debug.getResourceState?.() || null;
    const sameArrayMembers = (left, right) => (
        left === right
        && Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((entry, index) => entry === right[index])
    );
    const checks = {
        routeCounts: before?.routeCounts === after?.routeCounts,
        waterReaction: before?.waterReaction === after?.waterReaction,
        directorRowBuffers: sameArrayMembers(
            before?.directorRowBuffers,
            after?.directorRowBuffers,
        ),
        directorBeatDue: before?.directorBeatDue === after?.directorBeatDue,
        directorBeatSpecial: before?.directorBeatSpecial === after?.directorBeatSpecial,
        directorSinkOptions: before?.directorSinkOptions === after?.directorSinkOptions,
        waterResponseState: sameArrayMembers(
            before?.water?.responseStateValues,
            after?.water?.responseStateValues,
        ),
        waterResponseShape: sameArrayMembers(
            before?.water?.responseShapeValues,
            after?.water?.responseShapeValues,
        ),
        forestGeometryUuids: before?.forest?.geometryUuids === after?.forest?.geometryUuids,
        forestMaterialUuids: before?.forest?.materialUuids === after?.forest?.materialUuids,
        forestInstanceMatrices: before?.forest?.instanceMatrixArrays
            === after?.forest?.instanceMatrixArrays,
        atmosphereMotePosition: before?.atmosphere?.motePositionArray
            === after?.atmosphere?.motePositionArray,
        atmosphereMotePhase: before?.atmosphere?.motePhaseArray
            === after?.atmosphere?.motePhaseArray,
        atmosphereMoteSize: before?.atmosphere?.moteSizeArray
            === after?.atmosphere?.moteSizeArray,
        atmosphereMoteDrift: before?.atmosphere?.moteDriftArray
            === after?.atmosphere?.moteDriftArray,
        atmosphereMoteWarmth: before?.atmosphere?.moteWarmthArray
            === after?.atmosphere?.moteWarmthArray,
        atmosphereFogNode: before?.atmosphere?.fogNode === after?.atmosphere?.fogNode,
        atmosphereDepthTexture: before?.atmosphere?.softParticleDepthTexture
            === after?.atmosphere?.softParticleDepthTexture,
        reactionMoteOrigin: before?.reactions?.moteOriginBirthArray
            === after?.reactions?.moteOriginBirthArray,
        reactionMoteVelocity: before?.reactions?.moteVelocityLifeArray
            === after?.reactions?.moteVelocityLifeArray,
        reactionMoteStyle: before?.reactions?.moteStyleArray
            === after?.reactions?.moteStyleArray,
        reactionShaftOrigin: before?.reactions?.shaftOriginBirthArray
            === after?.reactions?.shaftOriginBirthArray,
        reactionShaftStyle: before?.reactions?.shaftStyleArray
            === after?.reactions?.shaftStyleArray,
        reactionRuneGeometry: before?.reactions?.runeGeometry
            === after?.reactions?.runeGeometry,
        reactionRuneMaterial: before?.reactions?.runeMaterial
            === after?.reactions?.runeMaterial,
        postScenePass: before?.post?.scenePass === after?.post?.scenePass,
        postProcessing: before?.post?.postProcessing === after?.post?.postProcessing,
        postBloomNode: before?.post?.bloomNode === after?.post?.bloomNode,
        postLutTexture: before?.post?.lutTexture === after?.post?.lutTexture,
        postLutData: before?.post?.lutData === after?.post?.lutData,
    };
    const identityStable = Object.values(checks).every(Boolean);
    const afterMemory = {
        geometries: theme.renderer?.info?.memory?.geometries ?? null,
        textures: theme.renderer?.info?.memory?.textures ?? null,
        programs: Array.isArray(theme.renderer?.info?.programs)
            ? theme.renderer.info.programs.length
            : null,
    };
    const memoryDelta = {
        geometries: Number.isFinite(afterMemory.geometries)
            && Number.isFinite(pending.beforeMemory?.geometries)
            ? afterMemory.geometries - pending.beforeMemory.geometries
            : null,
        textures: Number.isFinite(afterMemory.textures)
            && Number.isFinite(pending.beforeMemory?.textures)
            ? afterMemory.textures - pending.beforeMemory.textures
            : null,
        programs: Number.isFinite(afterMemory.programs)
            && Number.isFinite(pending.beforeMemory?.programs)
            ? afterMemory.programs - pending.beforeMemory.programs
            : null,
    };
    const memoryStable = (memoryDelta.geometries === null || memoryDelta.geometries <= 0)
        && (memoryDelta.textures === null || memoryDelta.textures <= 0)
        && (memoryDelta.programs === null || memoryDelta.programs <= 0);
    const diagnostics = debug.getDiagnostics?.() || null;
    const perEventResourceCreation = diagnostics?.reactions?.perEventResourceCreation;
    let driverEnd = null;
    let driverEndError = null;
    try {
        driverEnd = debug.endValidationDriver();
    } catch (error) {
        driverEndError = error?.message || String(error);
    } finally {
        delete window[pendingKey];
    }
    return {
        ok: pending.accepted === true
            && pending.stepErrors.length === 0
            && identityStable
            && memoryStable
            && perEventResourceCreation === 0
            && driverEnd?.ok === true
            && driverEndError === null,
        eventId: pending.eventId,
        accepted: pending.accepted === true,
        stepCount: pending.stepCount,
        stepErrors: pending.stepErrors,
        resourceAssertions: {
            identityStable,
            checks,
            perEventResourceCreation,
            rendererMemoryBefore: pending.beforeMemory,
            rendererMemoryAtCapture: pending.atCaptureMemory,
            rendererMemoryAfterScreenshot: afterMemory,
            rendererMemoryDelta: memoryDelta,
            rendererMemoryStable: memoryStable,
        },
        driverEnd,
        driverEndError,
    };
}

async function exerciseSwitchCyclesPage(options) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const withTimeout = async (promise, timeoutMs, label) => {
        let timeoutId = null;
        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        timeoutMs,
                    );
                }),
            ]);
        } finally {
            if (timeoutId !== null) clearTimeout(timeoutId);
        }
    };
    const waitFor = async (predicate, timeoutMs) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (predicate()) return true;
            await sleep(100);
        }
        return false;
    };
    const collectResourceSample = () => {
        const theme = window.themeManager?.activeTheme;
        const renderer = theme?.renderer;
        const scene = theme?.scene;
        const materials = new Set();
        const geometries = new Set();
        let sceneObjects = 0;
        if (scene?.traverse) {
            scene.traverse((object) => {
                sceneObjects += 1;
                if (object.geometry) geometries.add(object.geometry);
                const objectMaterials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];
                objectMaterials.filter(Boolean).forEach((material) => materials.add(material));
            });
        }
        return {
            usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null,
            sceneObjects,
            sceneGeometries: geometries.size,
            sceneMaterials: materials.size,
            rendererGeometries: renderer?.info?.memory?.geometries ?? null,
            rendererTextures: renderer?.info?.memory?.textures ?? null,
            outputQuadDisposeListeners:
                renderer?._quad?.geometry?._listeners?.dispose?.length ?? 0,
            totalCanvasCount: document.querySelectorAll('canvas').length,
            themeCanvasCount: document.querySelectorAll('#stillwater-theme canvas').length,
        };
    };
    const spread = (entries, key) => {
        const values = entries
            .map((entry) => entry.resources?.[key])
            .filter(Number.isFinite);
        if (values.length === 0) return null;
        return Math.max(...values) - Math.min(...values);
    };
    const game = window.serenityBlocks;
    const results = [];
    for (let index = 0; index < options.cycles; index += 1) {
        try {
            await withTimeout(
                game.themeManager.switchTheme('forest', true),
                options.timeoutMs,
                `forest switch ${index + 1}`,
            );
            const forestReady = await waitFor(
                () => window.themeManager?.activeThemeName === 'forest',
                options.timeoutMs,
            );
            await withTimeout(
                game.themeManager.switchTheme('stillwater', true),
                options.timeoutMs,
                `stillwater switch ${index + 1}`,
            );
            const stillwaterReady = await waitFor(
                () => window.themeManager?.activeThemeName === 'stillwater'
                    && Boolean(window.__STILLWATER_MASTERPIECE__),
                options.timeoutMs,
            );
            const theme = window.themeManager?.activeTheme;
            if (stillwaterReady && typeof theme?.whenFullReady === 'function') {
                await withTimeout(
                    theme.whenFullReady(),
                    options.timeoutMs,
                    `stillwater readiness ${index + 1}`,
                );
            }
            const debug = window.__STILLWATER_MASTERPIECE__;
            if (debug?.ready) {
                await withTimeout(
                    debug.ready,
                    options.timeoutMs,
                    `stillwater debug readiness ${index + 1}`,
                );
            }
            await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            });
            results.push({
                cycle: index + 1,
                forestReady,
                stillwaterReady,
                debugReady: typeof debug?.isReady === 'function' ? debug.isReady() : Boolean(debug),
                themeCanvasCount: document.querySelectorAll('#stillwater-theme canvas').length,
                totalCanvasCount: document.querySelectorAll('canvas').length,
                resources: collectResourceSample(),
            });
        } catch (error) {
            results.push({
                cycle: index + 1,
                error: error?.message || String(error),
            });
            break;
        }
    }
    const resourceSpreads = {
        sceneObjects: spread(results, 'sceneObjects'),
        sceneGeometries: spread(results, 'sceneGeometries'),
        sceneMaterials: spread(results, 'sceneMaterials'),
        rendererGeometries: spread(results, 'rendererGeometries'),
        // Kept as a diagnostic only. r181's renderer.info texture counter is
        // monotonic across pooled runtimes even when JS RenderTargets,
        // Texture wrappers, DepthTextures, and native GPUTextures are stable.
        rendererTextures: spread(results, 'rendererTextures'),
        outputQuadDisposeListeners: spread(results, 'outputQuadDisposeListeners'),
        totalCanvasCount: spread(results, 'totalCanvasCount'),
        themeCanvasCount: spread(results, 'themeCanvasCount'),
    };
    const authoritativeProxySpreads = Object.fromEntries(
        Object.entries(resourceSpreads).filter(([key]) => key !== 'rendererTextures'),
    );
    const resourceProxyStable = Object.entries(authoritativeProxySpreads).every(([key, value]) => (
        value === null
        || value <= (key === 'rendererGeometries' ? 1 : 0)
    ));
    return {
        ok: results.length === options.cycles
            && results.every((entry) => (
                entry.forestReady
                && entry.stillwaterReady
                && entry.debugReady
                && entry.themeCanvasCount === 1
                && !entry.error
            ))
            && resourceProxyStable,
        resourceProxyStable,
        resourceSpreads,
        rendererInfoTextureCounter: {
            authoritative: false,
            spread: resourceSpreads.rendererTextures,
            note: 'Three r181 bookkeeping drift; the forced-GC native/object census is authoritative.',
        },
        results,
    };
}

async function exerciseDeviceLossPage(options) {
    const sleep = (ms) => new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
    const theme = window.themeManager?.activeTheme;
    const renderer = theme?.renderer;
    const beforeDebug = window.__STILLWATER_MASTERPIECE__;
    if (!renderer) return { ok: false, reason: 'Stillwater renderer unavailable.' };
    window.__STILLWATER_WAVE8_PRE_LOSS_RENDERER__ = renderer;
    window.__STILLWATER_WAVE8_PRE_LOSS_DEBUG__ = beforeDebug;
    let mechanism = null;
    try {
        const device = renderer.backend?.device;
        if (device?.destroy) {
            mechanism = 'webgpu-device-destroy';
            device.destroy();
        } else {
            const context = renderer.getContext?.();
            const extension = context?.getExtension?.('WEBGL_lose_context');
            if (!extension?.loseContext) {
                return { ok: false, reason: 'No WebGPU device or WEBGL_lose_context extension.' };
            }
            mechanism = 'webgl-lose-context';
            extension.loseContext();
        }
    } catch (error) {
        return {
            ok: false,
            mechanism,
            reason: `Failed to trigger backend loss: ${error?.message || String(error)}`,
        };
    }

    const startedAt = Date.now();
    let recovered = false;
    while (Date.now() - startedAt < options.timeoutMs) {
        const activeTheme = window.themeManager?.activeTheme;
        const activeDebug = window.__STILLWATER_MASTERPIECE__;
        recovered = activeTheme?.renderer
            && activeTheme.renderer !== window.__STILLWATER_WAVE8_PRE_LOSS_RENDERER__
            && activeDebug
            && activeDebug !== window.__STILLWATER_WAVE8_PRE_LOSS_DEBUG__
            && document.querySelectorAll('#stillwater-theme canvas').length === 1;
        if (recovered) {
            if (typeof activeTheme.whenFullReady === 'function') {
                await activeTheme.whenFullReady();
            }
            if (activeDebug.ready) await activeDebug.ready;
            break;
        }
        await sleep(100);
    }
    const activeTheme = window.themeManager?.activeTheme;
    const activeDebug = window.__STILLWATER_MASTERPIECE__;
    delete window.__STILLWATER_WAVE8_PRE_LOSS_RENDERER__;
    delete window.__STILLWATER_WAVE8_PRE_LOSS_DEBUG__;
    return {
        ok: Boolean(
            recovered
            && activeTheme?.renderer
            && activeDebug
            && document.querySelectorAll('#stillwater-theme canvas').length === 1,
        ),
        mechanism,
        recovered,
        elapsedMs: Date.now() - startedAt,
        activeThemeName: window.themeManager?.activeThemeName || null,
        debugReady: typeof activeDebug?.isReady === 'function'
            ? activeDebug.isReady()
            : Boolean(activeDebug),
        themeCanvasCount: document.querySelectorAll('#stillwater-theme canvas').length,
        totalCanvasCount: document.querySelectorAll('canvas').length,
    };
}

async function ensureDebuggerAttached(win) {
    const debuggerApi = win.webContents.debugger;
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    try {
        await debuggerApi.sendCommand('Runtime.enable');
        await debuggerApi.sendCommand('Performance.enable');
    } catch {
        // Individual diagnostics below report unsupported CDP domains.
    }
}

async function sendDebuggerCommand(win, method, params = {}) {
    try {
        return {
            ok: true,
            value: await win.webContents.debugger.sendCommand(method, params),
        };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || String(error),
        };
    }
}

async function countHeapObjectsByPrototype(
    win,
    expression,
    sampleFunctionDeclaration = null,
) {
    const prototype = await sendDebuggerCommand(win, 'Runtime.evaluate', {
        expression,
        objectGroup: 'stillwater-wave8-heap-count',
        silent: true,
    });
    const prototypeObjectId = prototype.value?.result?.objectId;
    if (!prototype.ok || !prototypeObjectId) {
        return {
            ok: false,
            error: prototype.error
                || prototype.value?.exceptionDetails?.text
                || 'Prototype expression did not return a remote object.',
        };
    }
    const objects = await sendDebuggerCommand(win, 'Runtime.queryObjects', {
        prototypeObjectId,
        objectGroup: 'stillwater-wave8-heap-count',
    });
    const objectsObjectId = objects.value?.objects?.objectId;
    if (!objects.ok || !objectsObjectId) {
        await sendDebuggerCommand(win, 'Runtime.releaseObjectGroup', {
            objectGroup: 'stillwater-wave8-heap-count',
        });
        return {
            ok: false,
            error: objects.error || 'Runtime.queryObjects returned no object array.',
        };
    }
    const count = await sendDebuggerCommand(win, 'Runtime.callFunctionOn', {
        objectId: objectsObjectId,
        functionDeclaration: 'function stillwaterHeapObjectCount() { return this.length; }',
        returnByValue: true,
        silent: true,
    });
    const samples = sampleFunctionDeclaration
        ? await sendDebuggerCommand(win, 'Runtime.callFunctionOn', {
            objectId: objectsObjectId,
            functionDeclaration: sampleFunctionDeclaration,
            returnByValue: true,
            silent: true,
        })
        : null;
    await sendDebuggerCommand(win, 'Runtime.releaseObjectGroup', {
        objectGroup: 'stillwater-wave8-heap-count',
    });
    return count.ok && Number.isFinite(count.value?.result?.value)
        ? {
            ok: true,
            count: count.value.result.value,
            samples: samples?.ok ? samples.value?.result?.value ?? null : null,
            sampleError: samples && !samples.ok ? samples.error : null,
        }
        : {
            ok: false,
            error: count.error || 'Remote object count was unavailable.',
        };
}

async function collectRetainedObjectCounts(win) {
    const expressions = {
        stillwaterThemes: {
            expression: 'Object.getPrototypeOf(window.themeManager.activeTheme)',
        },
        renderers: {
            expression: 'Object.getPrototypeOf(window.themeManager.activeTheme.renderer)',
            sample: `function stillwaterRendererSamples() {
                const active = window.themeManager?.activeTheme?.renderer;
                return this.map((renderer) => ({
                    active: renderer === active,
                    backend: renderer.backend?.isWebGPUBackend
                        ? 'WebGPU'
                        : (renderer.backend?.isWebGLBackend ? 'WebGL2' : 'none'),
                    hasDevice: Boolean(renderer.backend?.device),
                    deviceLost: renderer._isDeviceLost === true,
                    canvasConnected: renderer.domElement?.isConnected === true,
                }));
            }`,
        },
        gpuDevices: {
            expression: `Object.getPrototypeOf(
                window.themeManager.activeTheme.renderer.backend.device
            )`,
        },
        gpuTextures: {
            expression: `(() => {
                const theme = window.themeManager.activeTheme;
                const texture = window.__STILLWATER_MASTERPIECE__
                    .getResourceState().post.scenePass.renderTarget.texture;
                return Object.getPrototypeOf(theme.renderer.backend.get(texture).texture);
            })()`,
            sample: `function stillwaterGpuTextureSamples() {
                return this.slice(0, 160).map((texture) => ({
                    label: texture.label || '',
                    width: texture.width ?? null,
                    height: texture.height ?? null,
                    depthOrArrayLayers: texture.depthOrArrayLayers ?? null,
                    format: texture.format || '',
                    mipLevelCount: texture.mipLevelCount ?? null,
                    sampleCount: texture.sampleCount ?? null,
                    usage: texture.usage ?? null,
                }));
            }`,
        },
        nodeFrames: {
            expression: `Object.getPrototypeOf(
                window.themeManager.activeTheme.renderer._nodes.nodeFrame
            )`,
            sample: `function stillwaterNodeFrameSamples() {
                const active = window.themeManager?.activeTheme?.renderer?._nodes?.nodeFrame;
                return this.map((frame) => ({
                    active: frame === active,
                    hasScene: Boolean(frame.scene),
                    hasObject: Boolean(frame.object),
                    hasMaterial: Boolean(frame.material),
                    hasCamera: Boolean(frame.camera),
                    hasRenderer: Boolean(frame.renderer),
                    objectName: frame.object?.name || '',
                    materialType: frame.material?.type || '',
                }));
            }`,
        },
        scenes: {
            expression: 'Object.getPrototypeOf(window.themeManager.activeTheme.scene)',
            sample: `function stillwaterSceneSamples() {
                const active = window.themeManager?.activeTheme?.scene;
                return this.map((scene) => ({
                    active: scene === active,
                    name: scene.name || '',
                    children: scene.children?.length ?? null,
                    background: Boolean(scene.background),
                }));
            }`,
        },
        postGraphs: {
            expression: `Object.getPrototypeOf(
                window.__STILLWATER_MASTERPIECE__.getResourceState().post.postProcessing
            )`,
        },
        renderTargets: {
            expression: `Object.getPrototypeOf(
                window.__STILLWATER_MASTERPIECE__
                    .getResourceState().post.scenePass.renderTarget
            )`,
            sample: `function stillwaterRenderTargetSamples() {
                const active = window.__STILLWATER_MASTERPIECE__
                    ?.getResourceState?.().post?.scenePass?.renderTarget;
                return this.map((target) => ({
                    active: target === active,
                    width: target.width,
                    height: target.height,
                    textureNames: target.textures?.map((texture) => texture?.name || ''),
                    depthName: target.depthTexture?.name || '',
                    disposeListeners: target._listeners?.dispose?.length ?? 0,
                }));
            }`,
        },
        renderTargetTextures: {
            expression: `Object.getPrototypeOf(
                window.__STILLWATER_MASTERPIECE__
                    .getResourceState().post.scenePass.renderTarget.texture
            )`,
            sample: `function stillwaterRenderTargetTextureSamples() {
                const state = window.__STILLWATER_MASTERPIECE__?.getResourceState?.();
                const active = new Set(
                    state?.post?.scenePass?.renderTarget?.textures || []
                );
                return this.map((texture) => ({
                    active: active.has(texture),
                    name: texture.name || '',
                    width: texture.image?.width ?? null,
                    height: texture.image?.height ?? null,
                    renderTarget: texture.isRenderTargetTexture === true,
                    disposeListeners: texture._listeners?.dispose?.length ?? 0,
                }));
            }`,
        },
        depthTextures: {
            expression: `Object.getPrototypeOf(
                window.__STILLWATER_MASTERPIECE__
                    .getResourceState().post.scenePass.renderTarget.depthTexture
            )`,
            sample: `function stillwaterDepthTextureSamples() {
                const active = window.__STILLWATER_MASTERPIECE__
                    ?.getResourceState?.().post?.scenePass?.renderTarget?.depthTexture;
                return this.map((texture) => ({
                    active: texture === active,
                    name: texture.name || '',
                    width: texture.image?.width ?? null,
                    height: texture.image?.height ?? null,
                    renderTarget: texture.isRenderTargetTexture === true,
                    disposeListeners: texture._listeners?.dispose?.length ?? 0,
                }));
            }`,
        },
        meshes: {
            expression: `(() => {
            let match = null;
            window.themeManager.activeTheme.scene.traverse((object) => {
                if (!match && object.isMesh) match = object;
            });
            return Object.getPrototypeOf(match);
        })()`,
            sample: `function stillwaterMeshSamples() {
                const active = new Set();
                window.themeManager?.activeTheme?.scene?.traverse?.((object) => {
                    if (object?.isMesh) active.add(object);
                });
                return this
                    .filter((mesh) => !active.has(mesh))
                    .slice(0, 120)
                    .map((mesh) => {
                        const materials = Array.isArray(mesh.material)
                            ? mesh.material
                            : [mesh.material];
                        let root = mesh;
                        while (root?.parent) root = root.parent;
                        return {
                            name: mesh.name || '',
                            type: mesh.type || '',
                            parent: mesh.parent?.name || '',
                            root: root?.name || root?.type || '',
                            rootType: root?.type || '',
                            rootChildren: root?.children?.length ?? null,
                            lod: mesh.userData?.stillwaterLod || '',
                            geometry: mesh.geometry?.type || '',
                            geometryDisposeListeners:
                                mesh.geometry?._listeners?.dispose?.length ?? 0,
                            material: materials.map(
                                (entry) => entry?.name || entry?.type || '',
                            ),
                            materialDisposeListeners: materials.map(
                                (entry) => entry?._listeners?.dispose?.length ?? 0,
                            ),
                        };
                    });
            }`,
        },
        nodeMaterials: {
            expression: `(() => {
            let match = null;
            window.themeManager.activeTheme.scene.traverse((object) => {
                const materials = Array.isArray(object.material)
                    ? object.material
                    : [object.material];
                if (!match) match = materials.find((material) => material?.isNodeMaterial) || null;
            });
            let prototype = Object.getPrototypeOf(match);
            while (
                prototype
                && !Object.prototype.hasOwnProperty.call(prototype, 'setupObserver')
            ) {
                prototype = Object.getPrototypeOf(prototype);
            }
            return prototype;
        })()`,
            sample: `function stillwaterNodeMaterialSamples() {
                return this.slice(0, 200).map((material) => ({
                    type: material.type || material.constructor?.name || '',
                    name: material.name || '',
                    disposeListeners: material._listeners?.dispose?.length ?? 0,
                }));
            }`,
        },
    };
    const entries = [];
    for (const [name, descriptor] of Object.entries(expressions)) {
        entries.push([
            name,
            await countHeapObjectsByPrototype(
                win,
                descriptor.expression,
                descriptor.sample || null,
            ),
        ]);
    }
    return Object.fromEntries(entries);
}

async function collectCdpDiagnostics(win, label, collectGarbage = false) {
    await ensureDebuggerAttached(win);
    const consoleDiscard = collectGarbage
        ? await sendDebuggerCommand(win, 'Runtime.discardConsoleEntries')
        : { ok: true, skipped: true };
    const gc = collectGarbage
        ? await sendDebuggerCommand(win, 'HeapProfiler.collectGarbage')
        : { ok: true, skipped: true };
    if (collectGarbage) await delay(150);
    const heap = await sendDebuggerCommand(win, 'Runtime.getHeapUsage');
    const dom = await sendDebuggerCommand(win, 'Memory.getDOMCounters');
    const metrics = await sendDebuggerCommand(win, 'Performance.getMetrics');
    const retainedObjects = await collectRetainedObjectCounts(win);
    return {
        label,
        timestamp: new Date().toISOString(),
        consoleDiscard,
        gc,
        heap,
        dom,
        metrics,
        retainedObjects,
    };
}

function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    const position = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * fraction) - 1),
    );
    return sorted[position];
}

function summarizeFrameCapture(capture) {
    const boardLifecycle = evaluateStillwaterFrameBoardLifecycle(
        capture?.boardLifecycle,
    );
    if (!capture?.ok || !boardLifecycle.ok) {
        return {
            ...capture,
            ok: false,
            reason: capture?.reason
                || boardLifecycle.reasons.join('; ')
                || 'Frame capture failed.',
            boardLifecycleEvaluation: boardLifecycle,
        };
    }
    const summarizeValues = (source) => {
        const sorted = (source || [])
            .filter((value) => Number.isFinite(value) && value >= 0)
            .sort((a, b) => a - b);
        const total = sorted.reduce((sum, value) => sum + value, 0);
        return {
            sampleCount: sorted.length,
            averageMs: sorted.length ? total / sorted.length : null,
            p50Ms: percentile(sorted, 0.5),
            p95Ms: percentile(sorted, 0.95),
            p99Ms: percentile(sorted, 0.99),
            maximumMs: sorted.at(-1) ?? null,
        };
    };
    const values = capture.frameTimes
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
    const total = values.reduce((sum, value) => sum + value, 0);
    const averageMs = values.length ? total / values.length : null;
    const targetFrameMs = 1000 / CONFIG.targetFps;
    return {
        ok: true,
        label: capture.label,
        durationMs: capture.durationMs,
        sampleCount: values.length,
        averageMs,
        averageFps: averageMs ? 1000 / averageMs : null,
        p50Ms: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
        p99Ms: percentile(values, 0.99),
        maximumMs: values.at(-1) ?? null,
        overTargetCount: values.filter((value) => value > targetFrameMs * 1.1).length,
        longFrameCount: values.filter((value) => value > targetFrameMs * 2).length,
        measurementMode: capture.manualDriver
            ? 'isolated-manual-production-frame'
            : 'display-request-animation-frame',
        manualDriverStart: capture.manualDriverStart || null,
        manualDriverEnd: capture.manualDriverEnd || null,
        manualWarmupFrames: capture.manualWarmupFrames || 0,
        manualWarmupMs: capture.manualWarmupMs || 0,
        manualWarmup: capture.manualWarmup || null,
        cpuSubmission: summarizeValues(capture.cpuSubmissionTimes),
        queueWait: summarizeValues(capture.queueWaitTimes),
        completedWorkload: summarizeValues(capture.completedFrameTimes),
        gpuTimestamp: summarizeValues(capture.gpuTimestampTimes),
        timestampedWorkload: summarizeValues(capture.timestampedWorkloadTimes),
        completionSources: capture.completionSources || {},
        frameErrors: capture.frameErrors || [],
        boardLifecycle: capture.boardLifecycle || null,
        boardLifecycleEvaluation: boardLifecycle,
        reactionCount: capture.reactionResults?.length || 0,
        rejectedReactionCount: (capture.reactionResults || [])
            .filter((entry) => !entry.accepted)
            .length,
        perfSummary: capture.perfSummary,
        perfPercentiles: capture.perfPercentiles,
        perfCounters: capture.perfCounters,
    };
}

function minimumFrameSamples(durationMs) {
    if (CONFIG.manualDriver) {
        // Manual mode serializes renderer work and queue/timestamp collection;
        // it is a workload sampler, not a display-cadence counter.
        return Math.min(
            300,
            Math.max(1, Math.floor((durationMs / 1_000) * 15)),
        );
    }
    return Math.min(
        CONFIG.targetFps * 5,
        Math.max(
            1,
            Math.floor((durationMs / 1_000) * CONFIG.targetFps * 0.9),
        ),
    );
}

function hasTimestampMetricCoverage(summary, durationMs = summary?.durationMs) {
    if (summary?.measurementMode !== 'isolated-manual-production-frame') {
        return false;
    }
    const required = minimumFrameSamples(durationMs);
    const gpuSamples = summary.gpuTimestamp?.sampleCount || 0;
    const workloadSamples = summary.timestampedWorkload?.sampleCount || 0;
    const referenceSamples = Math.max(
        summary.sampleCount || 0,
        summary.cpuSubmission?.sampleCount || 0,
    );
    const coverageFloor = Math.max(
        required,
        Math.floor(referenceSamples * 0.95),
    );
    return gpuSamples >= coverageFloor
        && workloadSamples >= coverageFloor;
}

function hasPrimaryMetricCoverage(summary, durationMs) {
    const required = minimumFrameSamples(durationMs);
    if (!summary?.ok || summary.sampleCount < required) return false;
    if (summary.measurementMode !== 'isolated-manual-production-frame') {
        return true;
    }
    if ((summary.gpuTimestamp?.sampleCount || 0) > 0) {
        return hasTimestampMetricCoverage(summary, durationMs);
    }
    const completedSamples = summary.completedWorkload?.sampleCount || 0;
    const referenceSamples = Math.max(
        summary.sampleCount || 0,
        summary.cpuSubmission?.sampleCount || 0,
    );
    return completedSamples >= Math.max(
        required,
        Math.floor(referenceSamples * 0.95),
    );
}

function evaluateFrameBudget(summary, { enforceCalibratedBaseline = false } = {}) {
    if (!summary?.ok) {
        return {
            ok: false,
            reason: summary?.reason || 'Frame summary is unavailable.',
        };
    }
    let p95BudgetMs = 16.6;
    if (CONFIG.targetFps >= 144) p95BudgetMs = 6.9;
    else if (CONFIG.targetFps >= 120) p95BudgetMs = 8.3;
    const cpuBudgetMs = 6 * (60 / Math.max(60, CONFIG.targetFps));
    const gpuBudgetMs = 9 * (60 / Math.max(60, CONFIG.targetFps));
    const gpuTimestampMeasured = summary.measurementMode
        === 'isolated-manual-production-frame'
        && hasTimestampMetricCoverage(summary);
    let totalP95Ms = summary.p95Ms;
    let totalP99Ms = summary.p99Ms;
    if (summary.measurementMode === 'isolated-manual-production-frame') {
        totalP95Ms = gpuTimestampMeasured
            ? summary.timestampedWorkload?.p95Ms
            : summary.completedWorkload?.p95Ms;
        totalP99Ms = gpuTimestampMeasured
            ? summary.timestampedWorkload?.p99Ms
            : summary.completedWorkload?.p99Ms;
    }
    const cpuP95Ms = summary.measurementMode === 'isolated-manual-production-frame'
        ? summary.cpuSubmission?.p95Ms
        : null;
    const gpuP95Ms = gpuTimestampMeasured ? summary.gpuTimestamp?.p95Ms : null;
    const baselineApplicable = CONFIG.lowPowerGpu
        && !CONFIG.forceWebGL
        && CONFIG.manualDriver
        && CONFIG.quality === 'Medium'
        && CONFIG.targetFps === 60
        && CONFIG.width === 1920
        && CONFIG.height === 1080;
    const calibratedBudget = evaluateStillwaterFrameBudget({
        candidateP95Ms: totalP95Ms,
        absoluteBudgetMs: p95BudgetMs,
        baselineP95Ms: STILLWATER_BASELINE_P95_MS,
        enforceBaseline: baselineApplicable && enforceCalibratedBaseline,
    });
    const p99Pass = CONFIG.targetFps > 60
        || (Number.isFinite(totalP99Ms) && totalP99Ms <= 20.8);
    const cpuPass = cpuP95Ms === null
        || (Number.isFinite(cpuP95Ms) && cpuP95Ms <= cpuBudgetMs);
    const gpuPass = gpuP95Ms === null
        || (Number.isFinite(gpuP95Ms) && gpuP95Ms <= gpuBudgetMs);
    return {
        ok: calibratedBudget.ok && p99Pass && cpuPass && gpuPass,
        targetFps: CONFIG.targetFps,
        p95BudgetMs,
        p99BudgetMs: CONFIG.targetFps <= 60 ? 20.8 : null,
        cpuBudgetMs,
        gpuBudgetMs: gpuTimestampMeasured ? gpuBudgetMs : null,
        totalP95Ms,
        totalP99Ms,
        cpuP95Ms,
        gpuP95Ms,
        gpuCompletionMeasured: gpuTimestampMeasured,
        queueDrainP95Ms: summary.queueWait?.p95Ms ?? null,
        completionSources: summary.completionSources,
        measurementMode: summary.measurementMode,
        calibratedBaseline: calibratedBudget,
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
    const expectedDeviceLoss = CONFIG.deviceLoss
        ? entries.filter((entry) => (
            entry.level >= 3
            && /WebGPURenderer:\s*WebGPU Device Lost/i.test(entry.message)
            && /Message:\s*Device was destroyed/i.test(entry.message)
            && /Reason:\s*destroyed/i.test(entry.message)
        ))
        : [];
    const expectedDeviceLossEntries = new Set(expectedDeviceLoss);
    const errors = entries.filter(
        (entry) => entry.level >= 3 && !expectedDeviceLossEntries.has(entry),
    );
    const warnings = entries.filter((entry) => entry.level === 2);
    const patternFailures = [];
    FAILURE_PATTERNS.forEach((rule) => {
        const matches = entries.filter((entry) => rule.regex.test(entry.message));
        if (matches.length) {
            patternFailures.push({
                id: rule.id,
                count: matches.length,
                samples: matches.slice(0, 5).map(serializeConsoleEntry),
            });
        }
    });
    return {
        entryCount: entries.length,
        warningCount: warnings.length,
        errorCount: errors.length,
        expectedDeviceLossCount: expectedDeviceLoss.length,
        processFailureCount: processFailures.length,
        shaderPipelineFailureCount: patternFailures
            .reduce((sum, failure) => sum + failure.count, 0),
        shaderPipelineFailures: patternFailures,
        errorSamples: errors.slice(0, 20).map(serializeConsoleEntry),
        warningSamples: warnings.slice(0, 20).map(serializeConsoleEntry),
        processFailures,
    };
}

async function captureScreenshot(win, filename) {
    await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    `, true);
    win.webContents.invalidate?.();
    await delay(50);
    const image = await win.webContents.capturePage();
    const target = path.join(ARTIFACT_DIR, filename);
    await writeFile(target, image.toPNG());
    return path.relative(ROOT, target);
}

function readFrameCounter(diagnostics, keys) {
    const counters = diagnostics?.themeDiagnostics?.frame?.counters
        || diagnostics?.themeDiagnostics?.frameCounters
        || diagnostics?.themeDiagnostics?.counters
        || null;
    if (!counters) return null;
    for (let index = 0; index < keys.length; index += 1) {
        const value = counters[keys[index]];
        if (Number.isFinite(value)) return value;
    }
    return null;
}

async function exerciseHiddenWindow(win) {
    const policy = CONFIG.pageVisibilityLane
        ? 'page-visibility'
        : 'explicit-app-pause';
    const backgroundThrottling = CONFIG.pageVisibilityLane;
    const nativeWindow = {
        visibleBefore: win.isVisible(),
        visibleWhileHidden: null,
        visibleAfter: null,
    };
    const before = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(hidden-before)',
    );
    // Packaged Electron disables background throttling, which intentionally
    // keeps document.visibilityState "visible" even after win.hide(). That
    // production-mirroring lane proves the application's explicit pause hook.
    // The opt-in headed Page Visibility lane enables background throttling and
    // relies on the real visibilitychange event instead.
    const prepare = await executePageFunction(
        win,
        prepareHiddenValidationPage,
        {
            invokeExplicitPause: policy === 'explicit-app-pause',
        },
        30000,
        'prepareHiddenValidation',
    );
    win.hide();
    nativeWindow.visibleWhileHidden = win.isVisible();
    await delay(350);
    const hiddenStart = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(hidden-start)',
    );
    await delay(CONFIG.hiddenMs);
    const hiddenEnd = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(hidden-end)',
    );
    if (CONFIG.headed) {
        win.show();
        win.focus();
    }
    const resume = await executePageFunction(
        win,
        resumeHiddenValidationPage,
        {
            invokeExplicitResume: policy === 'explicit-app-pause',
        },
        30000,
        'resumeHiddenValidation',
    );
    await delay(CONFIG.hiddenResumeSettleMs);
    nativeWindow.visibleAfter = win.isVisible();
    const resumed = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(hidden-resumed)',
    );
    const startUpdates = readFrameCounter(
        hiddenStart,
        ['simulationUpdates', 'updates', 'updateCount', 'updateFrames'],
    );
    const endUpdates = readFrameCounter(
        hiddenEnd,
        ['simulationUpdates', 'updates', 'updateCount', 'updateFrames'],
    );
    const startRenders = readFrameCounter(
        hiddenStart,
        ['composedRenders', 'renders', 'renderCount', 'renderFrames'],
    );
    const endRenders = readFrameCounter(
        hiddenEnd,
        ['composedRenders', 'renders', 'renderCount', 'renderFrames'],
    );
    const updateDelta = startUpdates !== null && endUpdates !== null
        ? endUpdates - startUpdates
        : null;
    const renderDelta = startRenders !== null && endRenders !== null
        ? endRenders - startRenders
        : null;
    const countersPresent = updateDelta !== null && renderDelta !== null;
    const counterDeltas = {
        updates: updateDelta,
        renders: renderDelta,
        countersPresent,
    };
    const evaluation = evaluateStillwaterHiddenLifecycle({
        policy,
        headed: CONFIG.headed,
        backgroundThrottling,
        prepare,
        hiddenStart,
        hiddenEnd,
        resume,
        resumed,
        nativeWindow,
        counterDeltas,
    });
    return {
        ...evaluation,
        durationMs: CONFIG.hiddenMs,
        policy,
        headed: CONFIG.headed,
        backgroundThrottling,
        nativeWindow,
        before,
        prepare,
        hiddenStart,
        hiddenEnd,
        resume,
        resumed,
        counterDeltas,
    };
}

async function recoverProductionBoardForCapture(
    win,
    label,
    {
        forceRestart = false,
        stableMs = 1000,
    } = {},
) {
    const recovery = await executePageFunction(
        win,
        ensureProductionBoardRunningPage,
        {
            seed: 0x53545752,
            timeoutMs: 45000,
            forceRestart,
            stableMs,
        },
        60000,
        `ensureProductionBoardRunning(${label})`,
    );
    await delay(350);
    const diagnostics = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        `collectPageDiagnostics(${label})`,
    );
    const board = evaluateStillwaterBoardCapture(diagnostics);
    const generationMatches = Number.isFinite(recovery?.expectedGeneration)
        && recovery.expectedGeneration === board.activeSessionGeneration
        && board.activeSessionGeneration === board.sessionGeneration;
    return {
        ok: recovery?.ok === true && board.ok && generationMatches,
        recovery,
        diagnostics,
        board,
        generationMatches,
    };
}

async function captureLayoutMatrix(win) {
    if (!CONFIG.layoutCaptures) return null;
    const layouts = ['solo', 'duo', 'quad', 'odyssey'];
    const results = [];
    for (let index = 0; index < layouts.length; index += 1) {
        const layout = layouts[index];
        const boardRecovery = await recoverProductionBoardForCapture(
            win,
            `layout-${layout}-recovery`,
        );
        const result = await executePageFunction(
            win,
            setLayoutCapturePage,
            { layout },
            30000,
            `setLayoutCapture(${layout})`,
        );
        const diagnostics = await executePageFunction(
            win,
            collectPageDiagnosticsPage,
            null,
            30000,
            `collectPageDiagnostics(layout-${layout})`,
        );
        const board = evaluateStillwaterBoardCapture(diagnostics);
        const screenshot = await captureScreenshot(win, `stillwater-layout-${layout}.png`);
        results.push({
            layout,
            ...result,
            boardRecovery,
            diagnostics,
            board,
            screenshot,
            ok: result?.ok === true
                && result?.policy?.boardSafeRegions?.length > 0
                && result?.themeCanvasCount === 1
                && boardRecovery.ok
                && board.ok,
        });
    }
    await executePageFunction(
        win,
        setLayoutCapturePage,
        { layout: 'solo' },
        30000,
        'restoreLayoutCapture(solo)',
    );
    return {
        ok: results.every((entry) => entry.ok),
        results,
    };
}

async function captureResizeMatrix(win) {
    if (!CONFIG.resizeMatrix) return null;
    const original = win.getContentSize();
    const sizes = [
        { id: '1080p', width: 1920, height: 1080 },
        { id: '1440p', width: 2560, height: 1440 },
        { id: 'capped-4k', width: 3840, height: 2160 },
    ];
    const results = [];
    for (let index = 0; index < sizes.length; index += 1) {
        const size = sizes[index];
        win.setContentSize(size.width, size.height, false);
        await delay(1200);
        const boardRecovery = await recoverProductionBoardForCapture(
            win,
            `resize-${size.id}-recovery`,
        );
        const diagnostics = await executePageFunction(
            win,
            collectPageDiagnosticsPage,
            null,
            30000,
            `collectPageDiagnostics(resize-${size.id})`,
        );
        const board = evaluateStillwaterBoardCapture(diagnostics);
        const screenshot = await captureScreenshot(
            win,
            `stillwater-resize-${size.id}.png`,
        );
        results.push({
            ...size,
            screenshot,
            boardRecovery,
            diagnostics,
            board,
            ok: diagnostics?.themeCanvasCount === 1
                && diagnostics?.viewport?.width === size.width
                && diagnostics?.viewport?.height === size.height
                && boardRecovery.ok
                && board.ok,
        });
    }
    win.setContentSize(original[0], original[1], false);
    await delay(1000);
    return {
        ok: results.every((entry) => entry.ok),
        results,
    };
}

async function captureOneProductionEvent(
    win,
    spec,
    consoleEntries,
    processFailures,
    { screenshotEnabled = true } = {},
) {
    const consoleStart = consoleEntries.length;
    const processFailureStart = processFailures.length;
    const boardRecovery = await recoverProductionBoardForCapture(
        win,
        `production-event-${spec.id}-recovery`,
        {
            // Production gameplay is intentionally live between capture
            // phases. Always bind each isolated event to a fresh session so a
            // late top-out from the prior phase cannot race the one-second
            // stability window or invalidate the next screenshot.
            forceRestart: true,
        },
    );
    const prepared = await executePageFunction(
        win,
        prepareProductionEventCapturePage,
        {
            ...spec,
            settleMs: 2100,
        },
        60000,
        `prepareProductionEventCapture(${spec.id})`,
    );
    let screenshot = null;
    let screenshotError = null;
    let finished = null;
    try {
        if (prepared?.ok === true && screenshotEnabled) {
            screenshot = await captureScreenshot(
                win,
                `stillwater-production-event-${spec.id}.png`,
            );
        }
    } catch (error) {
        screenshotError = error?.message || String(error);
    } finally {
        finished = await executePageFunction(
            win,
            finishProductionEventCapturePage,
            null,
            30000,
            `finishProductionEventCapture(${spec.id})`,
        );
    }
    await delay(120);
    const diagnostics = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        `collectPageDiagnostics(production-event-${spec.id})`,
    );
    const board = evaluateStillwaterBoardCapture(diagnostics);
    const consoleSummary = summarizeConsole(
        consoleEntries.slice(consoleStart),
        processFailures.slice(processFailureStart),
    );
    const consoleClean = consoleSummary.errorCount === 0
        && consoleSummary.processFailureCount === 0
        && consoleSummary.shaderPipelineFailureCount === 0;
    const screenshotOk = screenshotEnabled ? Boolean(screenshot) : true;
    return {
        ok: boardRecovery.ok
            && prepared?.ok === true
            && finished?.ok === true
            && screenshotOk
            && screenshotError === null
            && board.ok
            && consoleClean,
        id: spec.id,
        preset: spec.preset,
        captureAgeMs: spec.captureAgeMs,
        boardRecovery,
        prepared,
        screenshot,
        screenshotError,
        finished,
        diagnostics,
        board,
        consoleSummary,
    };
}

async function captureProductionEventMatrix(win, consoleEntries, processFailures) {
    if (!CONFIG.eventCaptures) return null;
    const warmupResults = [];
    for (
        let index = 0;
        index < STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS.length;
        index += 1
    ) {
        const spec = STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS[index];
        const warmup = await captureOneProductionEvent(
            win,
            {
                ...spec,
                id: `pool-warmup-${spec.id}`,
            },
            consoleEntries,
            processFailures,
            { screenshotEnabled: false },
        );
        const resourceAssertions = warmup.finished?.resourceAssertions || {};
        // First visibility of a prebuilt effect may upload it into renderer
        // bookkeeping. Warmup accepts that one-time upload but still requires
        // owned JS resources, console, production board, and driver cleanliness.
        const ok = warmup.boardRecovery?.ok === true
            && warmup.prepared?.ok === true
            && resourceAssertions.identityStable === true
            && resourceAssertions.perEventResourceCreation === 0
            && warmup.finished?.driverEnd?.ok === true
            && warmup.board?.ok === true
            && warmup.consoleSummary?.errorCount === 0
            && warmup.consoleSummary?.processFailureCount === 0
            && warmup.consoleSummary?.shaderPipelineFailureCount === 0;
        warmupResults.push({
            id: spec.id,
            ok,
            prepared: warmup.prepared,
            finished: warmup.finished,
            boardRecovery: warmup.boardRecovery,
            board: warmup.board,
            consoleSummary: warmup.consoleSummary,
        });
    }
    const warmupOk = warmupResults.length
        === STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS.length
        && warmupResults.every((entry) => entry.ok);
    const results = [];
    for (
        let index = 0;
        index < STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS.length;
        index += 1
    ) {
        results.push(await captureOneProductionEvent(
            win,
            STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS[index],
            consoleEntries,
            processFailures,
        ));
    }
    return {
        ok: warmupOk
            && results.length === STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS.length
            && results.every((entry) => entry.ok),
        injection: 'production Stillwater validation API on the shipped app/theme',
        isolatedManualDriver: true,
        warmup: {
            ok: warmupOk,
            rendererUploadGrowthAllowed: true,
            results: warmupResults,
        },
        results,
    };
}

function makeCheck(name, passed, details = {}) {
    return {
        name,
        status: passed ? 'pass' : 'fail',
        details,
    };
}

function evaluateSwitchRetention(result) {
    const initial = result.memory?.initial;
    const settled = result.switchSettledMemory;
    const allowances = {
        stillwaterThemes: 0,
        renderers: 0,
        nodeFrames: 0,
        scenes: 0,
        postGraphs: 0,
        meshes: 1,
        nodeMaterials: 1,
    };
    const retainedObjects = Object.fromEntries(
        Object.entries(allowances).map(([key, allowance]) => {
            const before = initial?.retainedObjects?.[key];
            const after = settled?.retainedObjects?.[key];
            const delta = Number.isFinite(before?.count) && Number.isFinite(after?.count)
                ? after.count - before.count
                : null;
            return [key, {
                ok: before?.ok === true
                    && after?.ok === true
                    && delta <= allowance,
                before: before?.count ?? null,
                after: after?.count ?? null,
                delta,
                allowance,
                beforeError: before?.error || null,
                afterError: after?.error || null,
            }];
        }),
    );
    [
        'gpuDevices',
        'gpuTextures',
        'renderTargets',
        'renderTargetTextures',
        'depthTextures',
    ].forEach((key) => {
        const before = initial?.retainedObjects?.[key];
        const after = settled?.retainedObjects?.[key];
        if (before?.ok !== true && after?.ok !== true) return;
        const delta = Number.isFinite(before?.count) && Number.isFinite(after?.count)
            ? after.count - before.count
            : null;
        retainedObjects[key] = {
            ok: before?.ok === true
                && after?.ok === true
                && delta <= 0,
            before: before?.count ?? null,
            after: after?.count ?? null,
            delta,
            allowance: 0,
            beforeError: before?.error || null,
            afterError: after?.error || null,
        };
    });
    const initialListeners = result.initialDiagnostics?.renderer
        ?.outputQuadDisposeListeners;
    const finalListeners = result.finalDiagnostics?.renderer
        ?.outputQuadDisposeListeners;
    const outputQuadListeners = {
        ok: Number.isFinite(initialListeners)
            && Number.isFinite(finalListeners)
            && finalListeners <= initialListeners,
        before: initialListeners ?? null,
        after: finalListeners ?? null,
        delta: Number.isFinite(initialListeners) && Number.isFinite(finalListeners)
            ? finalListeners - initialListeners
            : null,
    };
    return {
        ok: Boolean(initial && settled)
            && Object.values(retainedObjects).every((entry) => entry.ok)
            && outputQuadListeners.ok,
        retainedObjects,
        outputQuadListeners,
        forcedGcHeap: {
            before: initial?.heap?.value?.usedSize ?? null,
            after: settled?.heap?.value?.usedSize ?? null,
            delta: (
                Number.isFinite(initial?.heap?.value?.usedSize)
                && Number.isFinite(settled?.heap?.value?.usedSize)
            )
                ? settled.heap.value.usedSize - initial.heap.value.usedSize
                : null,
            note: 'Diagnostic only; retained-object and shared-listener counts are the lifecycle gate.',
        },
    };
}

function activationTimesAgree(left, right) {
    return Number.isFinite(left)
        && Number.isFinite(right)
        && Math.abs(left - right) <= ACTIVATION_TIME_EPSILON_MS;
}

export function evaluateColdActivationTelemetry(
    telemetry,
    quality = 'High',
) {
    const targetLod = TROLL_LOD_BY_QUALITY[normalizeQuality(quality, 'High')];
    const allowsCoalescedHeroReady = targetLod === 'low';
    const milestones = telemetry?.milestones || {};
    const orderedMilestones = ACTIVATION_MILESTONE_NAMES.map(
        (name) => milestones[name],
    );
    const milestoneFieldsFinite = orderedMilestones.every((milestone) => (
        Number.isFinite(milestone?.timestampMs)
        && Number.isFinite(milestone?.elapsedMs)
    ));
    const strictTimestampChronology = milestoneFieldsFinite
        && orderedMilestones.every((milestone, index) => (
            index === 0
            || milestone.timestampMs > orderedMilestones[index - 1].timestampMs
            || (
                allowsCoalescedHeroReady
                && index === ACTIVATION_MILESTONE_NAMES.indexOf('targetHeroReady')
                && milestone.timestampMs === orderedMilestones[index - 1].timestampMs
            )
        ));
    const strictElapsedChronology = milestoneFieldsFinite
        && orderedMilestones.every((milestone, index) => (
            index === 0
            || milestone.elapsedMs > orderedMilestones[index - 1].elapsedMs
            || (
                allowsCoalescedHeroReady
                && index === ACTIVATION_MILESTONE_NAMES.indexOf('targetHeroReady')
                && milestone.elapsedMs === orderedMilestones[index - 1].elapsedMs
            )
        ));
    const {
        sceneStart,
        canvasReveal,
        criticalHeroReady,
        targetHeroReady,
    } = milestones;
    const revealTimestampMs = canvasReveal?.timestampMs;
    const sceneStartTimestampMs = sceneStart?.timestampMs;
    const elapsedClockAgreement = milestoneFieldsFinite
        && activationTimesAgree(sceneStart?.elapsedMs, 0)
        && orderedMilestones.every((milestone) => activationTimesAgree(
            milestone.elapsedMs,
            milestone.timestampMs - sceneStart.timestampMs,
        ));
    const activationToRevealConsistent = activationTimesAgree(
        telemetry?.activationToRevealMs,
        canvasReveal?.elapsedMs,
    ) && activationTimesAgree(
        telemetry?.activationToRevealMs,
        Number.isFinite(revealTimestampMs) && Number.isFinite(sceneStartTimestampMs)
            ? revealTimestampMs - sceneStartTimestampMs
            : null,
    );
    const activationClockAgreement = telemetry?.clock === ACTIVATION_CLOCK;
    const milestoneEvaluation = {
        ok: milestoneFieldsFinite
            && strictTimestampChronology
            && strictElapsedChronology
            && elapsedClockAgreement
            && activationToRevealConsistent
            && activationClockAgreement,
        names: ACTIVATION_MILESTONE_NAMES,
        fieldsFinite: milestoneFieldsFinite,
        strictTimestampChronology,
        strictElapsedChronology,
        elapsedClockAgreement,
        activationToRevealConsistent,
        clockAgreement: activationClockAgreement,
        clock: telemetry?.clock || null,
        activationToRevealMs: telemetry?.activationToRevealMs ?? null,
        coalescedHeroReadyAllowed: allowsCoalescedHeroReady,
    };

    const expectedLods = targetLod === 'low'
        ? ['low']
        : ['low', targetLod];
    const loads = telemetry?.heroGltf?.loads || {};
    const actualLods = Object.keys(loads).sort();
    const sortedExpectedLods = [...expectedLods].sort();
    const exactLoadSet = actualLods.length === sortedExpectedLods.length
        && actualLods.every((lod, index) => lod === sortedExpectedLods[index]);
    const loadTimingsValid = exactLoadSet && expectedLods.every((lod) => {
        const load = loads[lod];
        return load?.status === 'ready'
            && Number.isFinite(load.startedAtMs)
            && Number.isFinite(load.completedAtMs)
            && Number.isFinite(load.combinedLoadParseAttachMs)
            && load.completedAtMs >= load.startedAtMs
            && load.combinedLoadParseAttachMs >= 0
            && activationTimesAgree(
                load.combinedLoadParseAttachMs,
                load.completedAtMs - load.startedAtMs,
            );
    });
    const lowLoad = loads.low;
    const targetLoad = loads[targetLod];
    const criticalHeroReadyAtMs = criticalHeroReady?.timestampMs;
    const targetHeroReadyAtMs = targetHeroReady?.timestampMs;
    const readinessClockAgreement = loadTimingsValid
        && Number.isFinite(criticalHeroReadyAtMs)
        && Number.isFinite(targetHeroReadyAtMs)
        && lowLoad.completedAtMs <= (
            criticalHeroReadyAtMs + ACTIVATION_TIME_EPSILON_MS
        )
        && targetLoad.completedAtMs <= (
            targetHeroReadyAtMs + ACTIVATION_TIME_EPSILON_MS
        );
    const gltfClockAgreement = telemetry?.heroGltf?.clock === ACTIVATION_CLOCK
        && telemetry?.heroGltf?.clock === telemetry?.clock;
    const measurementContract = (
        telemetry?.heroGltf?.measurement === 'combined GLTF load + parse/attach'
        && telemetry?.heroGltf?.gpuUploadMeasured === false
    );
    const heroGltfEvaluation = {
        ok: exactLoadSet
            && loadTimingsValid
            && readinessClockAgreement
            && gltfClockAgreement
            && measurementContract,
        expectedLods,
        actualLods,
        targetLod,
        exactLoadSet,
        loadTimingsValid,
        readinessClockAgreement,
        clockAgreement: gltfClockAgreement,
        measurementContract,
        gpuUploadMeasured: telemetry?.heroGltf?.gpuUploadMeasured ?? null,
    };

    const longTasks = telemetry?.longTasks || {};
    const entries = Array.isArray(longTasks.entries) ? longTasks.entries : null;
    const { postRevealObservationMs } = longTasks;
    const observationWindowValid = Number.isFinite(postRevealObservationMs)
        && postRevealObservationMs >= 200;
    const countMatchesEntries = Number.isInteger(longTasks.count)
        && entries !== null
        && longTasks.count === entries.length;
    const entryFieldsValid = entries !== null
        && Number.isFinite(sceneStartTimestampMs)
        && entries.every((entry) => {
            const startTimeMs = entry?.startTimeMs;
            const durationMs = entry?.durationMs;
            const endTimeMs = Number.isFinite(startTimeMs)
                && Number.isFinite(durationMs)
                ? startTimeMs + durationMs
                : null;
            return Number.isFinite(startTimeMs)
                && Number.isFinite(durationMs)
                && durationMs >= 0
                && Number.isFinite(entry?.elapsedStartMs)
                && Number.isFinite(entry?.elapsedEndMs)
                && activationTimesAgree(
                    entry.elapsedStartMs,
                    startTimeMs - sceneStartTimestampMs,
                )
                && activationTimesAgree(
                    entry.elapsedEndMs,
                    endTimeMs - sceneStartTimestampMs,
                );
        });
    const classifications = entryFieldsValid && Number.isFinite(revealTimestampMs)
        ? entries.map((entry, index) => {
            const endTimeMs = entry.startTimeMs + entry.durationMs;
            let visibility = 'pre-reveal-masked';
            if (entry.startTimeMs >= revealTimestampMs) {
                visibility = 'post-reveal-unmasked';
            } else if (endTimeMs > revealTimestampMs) {
                visibility = 'overlaps-reveal-unmasked';
            }
            return {
                index,
                visibility,
                startTimeMs: entry.startTimeMs,
                endTimeMs,
                durationMs: entry.durationMs,
            };
        })
        : [];
    const preRevealMaskedCount = classifications.filter(
        (entry) => entry.visibility === 'pre-reveal-masked',
    ).length;
    const overlapsRevealCount = classifications.filter(
        (entry) => entry.visibility === 'overlaps-reveal-unmasked',
    ).length;
    const postRevealCount = classifications.filter(
        (entry) => entry.visibility === 'post-reveal-unmasked',
    ).length;
    const unmaskedCount = overlapsRevealCount + postRevealCount;
    const measuredTotalDurationMs = entryFieldsValid
        ? entries.reduce((total, entry) => total + entry.durationMs, 0)
        : null;
    const measuredLongestDurationMs = entryFieldsValid && entries.length > 0
        ? entries.reduce(
            (longest, entry) => Math.max(longest, entry.durationMs),
            0,
        )
        : null;
    const totalDurationConsistent = activationTimesAgree(
        longTasks.totalDurationMs,
        measuredTotalDurationMs,
    );
    const longestDurationConsistent = entries?.length === 0
        ? longTasks.longestDurationMs === null
        : activationTimesAgree(
            longTasks.longestDurationMs,
            measuredLongestDurationMs,
        );
    const summaryConsistent = countMatchesEntries
        && entryFieldsValid
        && totalDurationConsistent
        && longestDurationConsistent;
    const recordComplete = longTasks.supported === true
        && longTasks.observing === false
        && observationWindowValid
        && summaryConsistent;
    const unmaskedClean = unmaskedCount === 0;
    const longTaskEvaluation = {
        ok: recordComplete && unmaskedClean,
        recordComplete,
        unmaskedClean,
        supported: longTasks.supported === true,
        finalized: longTasks.observing === false,
        observationWindowValid,
        postRevealObservationMs: postRevealObservationMs ?? null,
        count: longTasks.count ?? null,
        countMatchesEntries,
        entryFieldsValid,
        summaryConsistent,
        totalDurationConsistent,
        longestDurationConsistent,
        preRevealMaskedCount,
        overlapsRevealCount,
        postRevealCount,
        unmaskedCount,
        classifications,
        acceptanceRule: [
            'Pre-reveal masked LongTasks are retained as diagnostics.',
            'Any LongTask crossing the DOM opacity reveal or starting within the',
            'recorded immediate post-reveal observation window fails.',
        ].join(' '),
    };

    return {
        ok: milestoneEvaluation.ok
            && heroGltfEvaluation.ok
            && longTaskEvaluation.ok,
        milestones: milestoneEvaluation,
        heroGltf: heroGltfEvaluation,
        longTasks: longTaskEvaluation,
        canvasRevealEvidence: [
            'DOM canvas opacity reveal after the CPU warm-render call returned.',
            'This is not compositor or GPU-present evidence.',
        ].join(' '),
    };
}

function evaluateNeutralWarmupComparability(idleSummary, reactionSummary) {
    if (!CONFIG.manualDriver) {
        return {
            ok: true,
            applicable: false,
            reason: 'Neutral warmup comparability applies to manual-driver lanes.',
        };
    }
    const idle = idleSummary?.manualWarmup?.settledState || null;
    const reactions = reactionSummary?.manualWarmup?.settledState || null;
    const stationary = idleSummary?.manualWarmup?.stable === true
        && reactionSummary?.manualWarmup?.stable === true;
    const compare = (left, right, absoluteTolerance, ratioTolerance) => {
        if (!Number.isFinite(left) || !Number.isFinite(right)) {
            return {
                ok: false,
                left,
                right,
                deltaMs: null,
                toleranceMs: null,
            };
        }
        const center = (Math.abs(left) + Math.abs(right)) * 0.5;
        const toleranceMs = Math.max(absoluteTolerance, center * ratioTolerance);
        const deltaMs = Math.abs(left - right);
        // Chromium's millisecond clock is serialized through binary floating point
        // (for example, 0.6 - 0.5 can surface as 0.1000000238). Keep the acceptance
        // boundary inclusive without letting representation noise invalidate a lane.
        const comparisonEpsilonMs = 1e-6;
        return {
            ok: deltaMs <= toleranceMs + comparisonEpsilonMs,
            left,
            right,
            deltaMs,
            toleranceMs,
            comparisonEpsilonMs,
        };
    };
    const gpuP50 = compare(idle?.gpuP50Ms, reactions?.gpuP50Ms, 0.15, 0.03);
    const gpuP95 = compare(idle?.gpuP95Ms, reactions?.gpuP95Ms, 0.30, 0.05);
    const cpuP50 = compare(idle?.cpuP50Ms, reactions?.cpuP50Ms, 0.10, 0.10);
    return {
        ok: stationary && gpuP50.ok && gpuP95.ok && cpuP50.ok,
        applicable: true,
        stationary,
        idle: idleSummary?.manualWarmup || null,
        reactions: reactionSummary?.manualWarmup || null,
        comparisons: {
            gpuP50,
            gpuP95,
            cpuP50,
        },
        invalidResultPolicy: [
            'A non-stationary or non-comparable neutral pre-state invalidates',
            'the lane; it does not pass or fail the theme performance budget.',
        ].join(' '),
    };
}

function evaluateRun(result, gpuDiagnostics = null) {
    const idleSummary = summarizeFrameCapture(result.idle);
    const reactionSummary = summarizeFrameCapture(result.reactions);
    const lockStressSummary = result.lockStress
        ? summarizeFrameCapture(result.lockStress)
        : null;
    const stressSummary = result.stress ? summarizeFrameCapture(result.stress) : null;
    const idleBudget = evaluateFrameBudget(
        idleSummary,
        { enforceCalibratedBaseline: true },
    );
    const reactionBudget = evaluateFrameBudget(reactionSummary);
    const warmupComparability = evaluateNeutralWarmupComparability(
        idleSummary,
        reactionSummary,
    );
    const incrementalCpuP95Ms = (
        Number.isFinite(reactionBudget.cpuP95Ms)
        && Number.isFinite(idleBudget.cpuP95Ms)
    )
        ? reactionBudget.cpuP95Ms - idleBudget.cpuP95Ms
        : null;
    const incrementalGpuP95Ms = (
        Number.isFinite(reactionBudget.gpuP95Ms)
        && Number.isFinite(idleBudget.gpuP95Ms)
    )
        ? reactionBudget.gpuP95Ms - idleBudget.gpuP95Ms
        : null;
    const incrementalTotalP95Ms = (
        Number.isFinite(reactionBudget.totalP95Ms)
        && Number.isFinite(idleBudget.totalP95Ms)
    )
        ? reactionBudget.totalP95Ms - idleBudget.totalP95Ms
        : null;
    const incrementalCpuPass = incrementalCpuP95Ms === null
        || incrementalCpuP95Ms <= 0.25;
    const incrementalGpuPass = incrementalGpuP95Ms !== null
        ? incrementalGpuP95Ms <= 0.75
        : (
            incrementalTotalP95Ms !== null
            && incrementalTotalP95Ms <= 0.75
        );
    const reactionIncrementalBudget = {
        ok: incrementalCpuPass && incrementalGpuPass,
        cpuP95Ms: incrementalCpuP95Ms,
        gpuP95Ms: incrementalGpuP95Ms,
        totalP95Ms: incrementalTotalP95Ms,
        cpuBudgetMs: 0.25,
        gpuBudgetMs: 0.75,
        gpuCompletionMeasured: incrementalGpuP95Ms !== null,
        note: incrementalGpuP95Ms !== null
            ? 'Difference between warmed reaction and idle GPU timestamp p95 in the same lane.'
            : 'GPU completion was unavailable; the 0.75 ms comparison applies only to measured total workload.',
    };
    const activationTelemetry = result.initialDiagnostics?.activationTelemetry || null;
    const activationEvaluation = evaluateColdActivationTelemetry(
        activationTelemetry,
        CONFIG.quality,
    );
    const reactionCaptureContinuity = evaluateStillwaterCaptureContinuity({
        recovery: result.reactionCaptureBoardState?.recovery,
        preCapture: result.reactionCaptureBoardState?.diagnostics,
        postCapture: result.reactionPostCaptureDiagnostics,
    });
    const finalCaptureContinuity = evaluateStillwaterCaptureContinuity({
        recovery: result.finalBoardState,
        preCapture: result.finalPreCaptureDiagnostics,
        postCapture: result.finalDiagnostics,
    });
    const checks = [
        makeCheck('production_stillwater_ready', result.boot?.ok === true, result.boot),
        makeCheck(
            'pinned_quality_profile',
            result.boot?.quality === CONFIG.quality
                && result.boot?.settings?.effectQuality === CONFIG.quality
                && result.boot?.settings?.graphicsQuality === CONFIG.quality
                && result.boot?.settings?.targetFrameRate === CONFIG.targetFps
                && result.boot?.settings?.renderScale === CONFIG.renderScale
                && result.boot?.settings?.enableAntialiasing === CONFIG.antialias
                && result.boot?.settings?.backgroundComboEffects === true,
            result.boot?.settings || {},
        ),
        makeCheck(
            'single_theme_canvas',
            result.finalDiagnostics?.themeCanvasCount === 1,
            {
                themeCanvasCount: result.finalDiagnostics?.themeCanvasCount,
                canvases: result.finalDiagnostics?.canvases,
            },
        ),
        makeCheck(
            'production_game_board_visible',
            result.boot?.board?.ok === true
                && result.preIdleBoardState?.ok === true
                && result.interMeasurementBoardState?.ok === true
                && reactionCaptureContinuity.ok
                && result.finalBoardState?.ok === true
                && finalCaptureContinuity.ok,
            {
                boot: result.boot?.board || null,
                preIdle: result.preIdleBoardState || null,
                betweenMeasurements: result.interMeasurementBoardState || null,
                reactionCapture: reactionCaptureContinuity,
                recovery: result.finalBoardState || null,
                finalCapture: finalCaptureContinuity,
            },
        ),
        makeCheck(
            'frame_capture_board_lifecycle',
            idleSummary?.boardLifecycleEvaluation?.ok === true
                && reactionSummary?.boardLifecycleEvaluation?.ok === true,
            {
                idle: idleSummary?.boardLifecycleEvaluation || null,
                reactions: reactionSummary?.boardLifecycleEvaluation || null,
            },
        ),
        makeCheck(
            'cold_activation_telemetry_complete',
            activationEvaluation.milestones.ok
                && activationEvaluation.heroGltf.ok,
            {
                evaluation: activationEvaluation,
                telemetry: activationTelemetry,
            },
        ),
        makeCheck(
            'cold_activation_longtask_observer_finalized',
            activationEvaluation.longTasks.recordComplete,
            {
                evaluation: activationEvaluation.longTasks,
                telemetry: activationTelemetry?.longTasks || null,
            },
        ),
        makeCheck(
            'cold_activation_unmasked_longtask_clean',
            activationEvaluation.longTasks.recordComplete
                && activationEvaluation.longTasks.unmaskedClean,
            {
                evaluation: activationEvaluation.longTasks,
                telemetry: activationTelemetry?.longTasks || null,
            },
        ),
        makeCheck(
            'idle_frame_samples',
            hasPrimaryMetricCoverage(idleSummary, CONFIG.idleMs),
            idleSummary,
        ),
        makeCheck(
            'reaction_frame_samples',
            hasPrimaryMetricCoverage(reactionSummary, CONFIG.reactionMs)
                && reactionSummary.reactionCount > 0
                && reactionSummary.rejectedReactionCount === 0,
            reactionSummary,
        ),
        makeCheck(
            'neutral_warmup_stationary_and_comparable',
            warmupComparability.ok === true,
            warmupComparability,
        ),
        makeCheck('idle_frame_budget', idleBudget.ok === true, idleBudget),
        makeCheck('reaction_frame_budget', reactionBudget.ok === true, reactionBudget),
        makeCheck(
            'reaction_incremental_budget',
            reactionIncrementalBudget.ok === true,
            reactionIncrementalBudget,
        ),
        makeCheck('pause_resume_lifecycle', result.pauseResume?.ok === true, result.pauseResume),
        makeCheck('hidden_lifecycle', result.hidden?.ok === true, result.hidden),
        makeCheck(
            'console_shader_pipeline_clean',
            result.consoleSummary?.errorCount === 0
                && result.consoleSummary?.processFailureCount === 0
                && result.consoleSummary?.shaderPipelineFailureCount === 0,
            result.consoleSummary,
        ),
    ];
    if (CONFIG.expectBackend) {
        checks.push(makeCheck(
            'expected_backend',
            result.boot?.backend === CONFIG.expectBackend,
            {
                expected: CONFIG.expectBackend,
                actual: result.boot?.backend,
            },
        ));
    }
    if (CONFIG.lowPowerGpu) {
        const activeDevices = gpuDiagnostics?.activeDevices || [];
        const amdDevices = activeDevices.filter((device) => {
            const vendorId = Number(device?.vendorId);
            return vendorId === 0x1002
                || /\b(?:AMD|Radeon)\b/i.test(JSON.stringify(device));
        });
        checks.push(makeCheck(
            'low_power_gpu_adapter',
            result.boot?.rendererPowerPreference === 'low-power'
                && amdDevices.length > 0,
            {
                rendererPowerPreference: result.boot?.rendererPowerPreference || null,
                activeDevices,
                confirmedAmdDevices: amdDevices,
            },
        ));
    }
    if (CONFIG.stressMs > 0) {
        checks.push(makeCheck(
            'mixed_reaction_storm',
            hasPrimaryMetricCoverage(stressSummary, CONFIG.stressMs)
                && stressSummary.reactionCount > 0
                && stressSummary.rejectedReactionCount === 0,
            stressSummary,
        ));
    }
    if (CONFIG.lockStressMs > 0) {
        const expectedLockCount = Math.floor(CONFIG.lockStressMs / 500);
        const lockReactions = result.lockStress?.reactionResults || [];
        const lockCountWithinTolerance = lockReactions.length >= Math.max(
            1,
            expectedLockCount - 1,
        ) && lockReactions.length <= expectedLockCount + 1;
        checks.push(makeCheck(
            'lock_stress_2hz',
            hasPrimaryMetricCoverage(lockStressSummary, CONFIG.lockStressMs)
                && lockStressSummary.rejectedReactionCount === 0
                && lockCountWithinTolerance
                && lockReactions.every((entry) => entry.preset === 'lock'),
            {
                ...lockStressSummary,
                actualLockCount: lockReactions.length,
                expectedLockCount,
                tolerance: 1,
            },
        ));
    }
    if (CONFIG.switchCycles > 0) {
        const retention = evaluateSwitchRetention(result);
        checks.push(makeCheck(
            'switch_cycles',
            result.switchCycles?.ok === true,
            result.switchCycles,
        ));
        checks.push(makeCheck(
            'switch_retained_objects',
            retention.ok,
            retention,
        ));
    }
    if (CONFIG.deviceLoss) {
        checks.push(makeCheck(
            'device_loss_recovery',
            result.deviceLoss?.ok === true,
            result.deviceLoss,
        ));
    }
    if (CONFIG.layoutCaptures) {
        checks.push(makeCheck(
            'layout_capture_matrix',
            result.layoutMatrix?.ok === true,
            result.layoutMatrix,
        ));
    }
    if (CONFIG.resizeMatrix) {
        checks.push(makeCheck(
            'resize_dpr_matrix',
            result.resizeMatrix?.ok === true,
            result.resizeMatrix,
        ));
    }
    if (CONFIG.eventCaptures) {
        checks.push(makeCheck(
            'production_event_capture_matrix',
            result.productionEventMatrix?.ok === true,
            result.productionEventMatrix,
        ));
    }
    if (CONFIG.requireCanvasFallback) {
        checks.push(makeCheck(
            'phaser_canvas_fallback',
            result.canvasFallback?.supported === true,
            result.canvasFallback,
        ));
    }
    return {
        overallPass: checks.every((check) => check.status === 'pass'),
        checks,
        frameSummaries: {
            idle: idleSummary,
            reactions: reactionSummary,
            lockStress: lockStressSummary,
            stress: stressSummary,
        },
        frameBudgets: {
            idle: idleBudget,
            reactions: reactionBudget,
            reactionIncremental: reactionIncrementalBudget,
        },
    };
}

function buildMarkdownSummary(summary) {
    const provenance = summary.sourceBuildFingerprint;
    const activation = summary.result.initialDiagnostics?.activationTelemetry || null;
    const activationGate = activation
        ? evaluateColdActivationTelemetry(activation, CONFIG.quality)
        : null;
    const lines = [
        '# Stillwater Wave 8 Validation',
        '',
        `- Generated: ${summary.generatedAt}`,
        `- Overall: ${summary.evaluation.overallPass ? 'PASS' : 'FAIL'}`,
        `- URL: ${summary.targetUrl}`,
        `- Backend: ${summary.result.boot?.backend || 'unknown'}`,
        `- Profile: ${CONFIG.quality}, ${CONFIG.targetFps} FPS, render scale 1, AA off`,
        `- Cold activation through hero readiness: ${formatMetric(summary.result.coldActivationMs)} ms`,
        `- Artifacts: ${path.relative(ROOT, ARTIFACT_DIR)}`,
        `- Source/build fingerprint: \`${provenance.fingerprintSha256}\``,
        `- Git HEAD: \`${provenance.git.head}\` (${provenance.git.dirty ? 'dirty' : 'clean'})`,
        `- Vite manifest: \`${provenance.build.viteManifest.path}\` `
            + `(\`${provenance.build.viteManifest.sha256}\`)`,
        `- Performance budget: \`${provenance.build.performanceBudget.path}\` `
            + `(\`${provenance.build.performanceBudget.sha256}\`)`,
        `- Stillwater asset: \`${provenance.build.stillwaterThemeAsset.path}\` `
            + `(\`${provenance.build.stillwaterThemeAsset.sha256}\`)`,
        `- Validation harness: \`${provenance.build.validationHarness.path}\` `
            + `(\`${provenance.build.validationHarness.sha256}\`)`,
        `- Hidden lifecycle policy: ${summary.result.hidden?.policy || 'unknown'} `
            + `(backgroundThrottling=${
                summary.result.hidden?.backgroundThrottling === true ? 'true' : 'false'
            })`,
        `- Production event captures: ${
            summary.result.productionEventMatrix?.results?.filter((entry) => entry.ok).length
                ?? 0
        }/${summary.result.productionEventMatrix?.results?.length ?? 0} passed`,
    ];
    if (activation) {
        lines.push(
            `- Stillwater scene-start to DOM canvas opacity reveal after CPU warm-render return: ${
                formatMetric(activation.activationToRevealMs)
            } ms`,
            '- Canvas reveal evidence is the DOM opacity write only; it is not '
                + 'compositor or GPU-present evidence.',
            `- Recorded cold LongTasks (observer finalized: ${
                activation.longTasks?.observing === false ? 'yes' : 'no'
            }): ${activation.longTasks?.count ?? 0}; `
                + `total ${formatMetric(activation.longTasks?.totalDurationMs)} ms; `
                + `longest ${formatMetric(activation.longTasks?.longestDurationMs)} ms`,
            `- DOM-masked pre-reveal LongTasks (diagnostic, accepted): ${
                activationGate?.longTasks?.preRevealMaskedCount ?? 0
            }`,
            `- Unmasked-by-DOM-boundary LongTasks (required zero): ${
                activationGate?.longTasks?.unmaskedCount ?? 0
            }; overlapping reveal ${
                activationGate?.longTasks?.overlapsRevealCount ?? 0
            }; starting after reveal ${
                activationGate?.longTasks?.postRevealCount ?? 0
            }`,
            '',
            '## Activation milestones',
            '',
        );
        Object.entries(activation.milestones || {}).forEach(([name, milestone]) => {
            const label = name === 'canvasReveal'
                ? 'canvasReveal (DOM opacity visible; not compositor/GPU present)'
                : name;
            lines.push(
                `- ${label}: ${formatMetric(milestone?.elapsedMs)} ms from scene start`,
            );
        });
        const heroLoads = activation.heroGltf?.loads || {};
        Object.entries(heroLoads).forEach(([lod, timing]) => {
            lines.push(
                `- hero ${lod}: ${formatMetric(timing?.combinedLoadParseAttachMs)} ms `
                    + `combined load + parse/attach (${timing?.status || 'unknown'}); `
                    + 'GPU upload not measured separately',
            );
        });
    }
    lines.push('', '## Checks', '');
    summary.evaluation.checks.forEach((check) => {
        lines.push(`- ${check.name}: ${check.status.toUpperCase()}`);
    });
    lines.push('', '## Frame captures', '');
    Object.entries(summary.evaluation.frameSummaries).forEach(([name, report]) => {
        if (!report) return;
        const manual = report.measurementMode === 'isolated-manual-production-frame';
        const timestamped = manual && report.gpuTimestamp?.sampleCount > 0;
        let primaryP95 = report.p95Ms;
        let primaryP99 = report.p99Ms;
        if (manual) {
            primaryP95 = timestamped
                ? report.timestampedWorkload?.p95Ms
                : report.completedWorkload?.p95Ms;
            primaryP99 = timestamped
                ? report.timestampedWorkload?.p99Ms
                : report.completedWorkload?.p99Ms;
        }
        lines.push(
            `- ${name}: ${report.sampleCount ?? 0} samples, `
            + `${timestamped ? 'CPU + GPU timestamp workload' : 'display/queue-drained workload'} `
            + `p95 ${formatMetric(primaryP95)} ms, `
            + `p99 ${formatMetric(primaryP99)} ms, `
            + `${formatMetric(report.averageFps)} FPS average, `
            + `${report.measurementMode || 'unknown measurement mode'}`,
        );
        if (report.completedWorkload?.sampleCount > 0) {
            lines.push(
                `  - CPU submit p95: ${formatMetric(report.cpuSubmission?.p95Ms)} ms; `
                + `GPU timestamp p95: ${formatMetric(report.gpuTimestamp?.p95Ms)} ms; `
                + `queue drain p95: ${formatMetric(report.queueWait?.p95Ms)} ms; `
                + `scheduler pacing p95: ${formatMetric(report.p95Ms)} ms`,
            );
        }
    });
    lines.push('', '## Frame budgets', '');
    Object.entries(summary.evaluation.frameBudgets || {}).forEach(([name, budget]) => {
        const metric = Number.isFinite(budget?.totalP95Ms)
            ? ` (p95 ${formatMetric(budget.totalP95Ms)} ms)`
            : '';
        lines.push(
            `- ${name}: ${budget?.ok ? 'PASS' : 'FAIL'}${metric}`,
        );
    });
    const { canvasFallback } = summary.result;
    lines.push(
        '',
        '## Production event captures',
        '',
    );
    if (summary.result.productionEventMatrix) {
        summary.result.productionEventMatrix.results.forEach((capture) => {
            lines.push(
                `- ${capture.id}: ${capture.ok ? 'PASS' : 'FAIL'}; `
                    + `${capture.screenshot || 'no screenshot'}; `
                    + `route ${capture.prepared?.expectedRoute?.index ?? 'n/a'} `
                    + `count ${capture.prepared?.expectedRoute?.count ?? 'n/a'}; `
                    + `fixed resources ${
                        capture.finished?.resourceAssertions?.identityStable
                            ? 'stable'
                            : 'changed'
                    }; renderer memory ${
                        capture.finished?.resourceAssertions?.rendererMemoryStable
                            ? 'stable'
                            : 'grew'
                    }`,
            );
        });
    } else {
        lines.push('- Skipped by configuration.');
    }
    lines.push(
        '',
        '## Phaser Canvas fallback',
        '',
        `- Supported: ${canvasFallback?.supported === true ? 'yes' : 'no'}`,
        `- Gate: ${canvasFallback?.required ? 'required' : 'not applicable unless explicitly required'}`,
        `- Blocker: ${canvasFallback?.code || 'unknown'} — ${
            canvasFallback?.reason || 'No blocker detail was recorded.'
        }`,
        `- Source evidence: ${
            canvasFallback?.sourceEvidence?.join(', ') || 'not recorded'
        }`,
        `- Runtime board renderer: ${
            canvasFallback?.runtime?.rendererClass || 'unknown'
        }; WebGL context: ${
            canvasFallback?.runtime?.hasWebGlContext === true ? 'yes' : 'no'
        }`,
    );
    lines.push(
        '',
        '## Console gate',
        '',
        `- Errors: ${summary.result.consoleSummary.errorCount}`,
        `- Shader/pipeline failures: ${summary.result.consoleSummary.shaderPipelineFailureCount}`,
        `- Renderer/process failures: ${summary.result.consoleSummary.processFailureCount}`,
        '',
        '## API assumptions',
        '',
    );
    API_ASSUMPTIONS.forEach((assumption) => lines.push(`- ${assumption}`));
    lines.push('');
    return `${lines.join('\n')}\n`;
}

function formatMetric(value) {
    return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

async function runValidation() {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await buildProductionBundle();
    sourceBuildFingerprint = await collectStillwaterSourceBuildFingerprint({
        rootDir: ROOT,
        distDirectory: DIST_DIRECTORY,
    });
    previewProcess = startPreviewServer();
    const targetUrl = createTargetUrl();
    await waitForServer(targetUrl, CONFIG.startupTimeoutMs);

    const win = createWindow();
    mainWindow = win;
    const consoleEntries = [];
    const processFailures = [];
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleEntries.push({
            timestamp: Date.now(),
            level,
            message,
            line,
            sourceId,
        });
    });
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
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
        processFailures.push({
            type: 'did-fail-load',
            timestamp: new Date().toISOString(),
            errorCode,
            errorDescription,
            validatedUrl,
        });
    });

    if (CONFIG.headed) {
        win.show();
        win.focus();
    }
    const gpuDiagnostics = await collectElectronGpuDiagnostics();
    const coldActivationStartedAt = Date.now();
    await win.loadURL(targetUrl);

    const profile = {
        quality: CONFIG.quality,
        targetFps: CONFIG.targetFps,
        renderScale: CONFIG.renderScale,
        antialias: CONFIG.antialias,
        startupTimeoutMs: CONFIG.startupTimeoutMs,
        expectBackend: CONFIG.expectBackend,
    };
    const boot = await executePageFunction(
        win,
        bootstrapStillwaterPage,
        profile,
        CONFIG.startupTimeoutMs + 90000,
        'bootstrapStillwaterPage',
    );
    if (!boot?.ok) {
        const consoleSummary = summarizeConsole(consoleEntries, processFailures);
        const consoleText = consoleEntries.map((entry) => (
            `[${new Date(entry.timestamp).toISOString()}][L${entry.level}] `
            + `${entry.sourceId || '<unknown>'}:${entry.line || 0} ${entry.message}`
        )).join('\n');
        await writeFile(path.join(ARTIFACT_DIR, 'console.log'), consoleText, 'utf8');
        await writeFile(
            path.join(ARTIFACT_DIR, 'boot-failure.json'),
            JSON.stringify({
                generatedAt: new Date().toISOString(),
                targetUrl,
                artifactDir: ARTIFACT_DIR,
                config: CONFIG,
                sourceBuildFingerprint,
                boot,
                consoleSummary,
            }, null, 2),
            'utf8',
        );
        try {
            await captureScreenshot(win, 'boot-failure.png');
        } catch (captureError) {
            await writeFile(
                path.join(ARTIFACT_DIR, 'boot-failure-screenshot-error.log'),
                `${captureError?.stack || captureError?.message || captureError}\n`,
                'utf8',
            );
        }
        throw new Error(boot?.reason || 'Stillwater bootstrap failed.');
    }
    const coldActivationMs = Date.now() - coldActivationStartedAt;

    await delay(1000);
    const initialMemory = await collectCdpDiagnostics(win, 'initial', true);
    const initialDiagnostics = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(initial)',
    );
    const canvasFallbackRuntime = await executePageFunction(
        win,
        inspectStillwaterCanvasFallbackPage,
        null,
        30000,
        'inspectStillwaterCanvasFallback',
    );
    const canvasFallback = {
        ...STILLWATER_PHASER_CANVAS_FALLBACK_BLOCKER,
        required: CONFIG.requireCanvasFallback,
        gate: CONFIG.requireCanvasFallback ? 'required' : 'not-applicable',
        runtime: canvasFallbackRuntime,
    };
    const preIdleBoardState = await recoverProductionBoardForCapture(
        win,
        'pre-idle',
        { forceRestart: true },
    );
    const idleScreenshot = await captureScreenshot(win, 'stillwater-idle.png');
    const idle = await executePageFunction(
        win,
        captureFramesPage,
        {
            label: 'idle',
            durationMs: CONFIG.idleMs,
            targetFps: CONFIG.targetFps,
            reactions: false,
            manualDriver: CONFIG.manualDriver,
            manualWarmupMs: CONFIG.manualWarmupMs,
            manualWarmupMaxMs: CONFIG.manualWarmupMaxMs,
            manualWarmupWindowMs: CONFIG.manualWarmupWindowMs,
        },
        CONFIG.idleMs + CONFIG.manualWarmupMaxMs + 30000,
        'captureFrames(idle)',
    );

    const interMeasurementBoardState = await recoverProductionBoardForCapture(
        win,
        'between-idle-reactions',
        { forceRestart: true },
    );
    const reactions = await executePageFunction(
        win,
        captureFramesPage,
        {
            label: 'reactions',
            durationMs: CONFIG.reactionMs,
            targetFps: CONFIG.targetFps,
            reactions: true,
            reactionIntervalMs: 2000,
            reactionSequence: CONFIG.reactionSequence,
            manualDriver: CONFIG.manualDriver,
            manualWarmupMs: CONFIG.manualWarmupMs,
            manualWarmupMaxMs: CONFIG.manualWarmupMaxMs,
            manualWarmupWindowMs: CONFIG.manualWarmupWindowMs,
        },
        CONFIG.reactionMs + CONFIG.manualWarmupMaxMs + 30000,
        'captureFrames(reactions)',
    );
    const reactionCaptureBoardState = await recoverProductionBoardForCapture(
        win,
        'reaction-screenshot',
    );
    const reactionScreenshot = await captureScreenshot(win, 'stillwater-reactions.png');
    const reactionPostCaptureDiagnostics = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(reaction-post-capture)',
    );

    const pauseResume = await executePageFunction(
        win,
        exercisePauseResumePage,
        {
            pauseMs: CONFIG.pauseMs,
            resumeSettleMs: CONFIG.resumeSettleMs,
            cycles: CONFIG.pauseCycles,
        },
        (
            CONFIG.pauseCycles
            * (CONFIG.pauseMs + CONFIG.resumeSettleMs)
        ) + 30000,
        'exercisePauseResume',
    );
    const resumedScreenshot = await captureScreenshot(win, 'stillwater-resumed.png');
    const hidden = await exerciseHiddenWindow(win);
    const hiddenResumedScreenshot = await captureScreenshot(
        win,
        'stillwater-hidden-resumed.png',
    );
    const layoutMatrix = await captureLayoutMatrix(win);
    const resizeMatrix = await captureResizeMatrix(win);
    const productionEventMatrix = await captureProductionEventMatrix(
        win,
        consoleEntries,
        processFailures,
    );

    let lockStress = null;
    let lockStressScreenshot = null;
    if (CONFIG.lockStressMs > 0) {
        lockStress = await executePageFunction(
            win,
            captureFramesPage,
            {
                label: 'lock-stress-2hz',
                durationMs: CONFIG.lockStressMs,
                targetFps: CONFIG.targetFps,
                reactions: true,
                reactionIntervalMs: 500,
                reactionSequence: ['lock'],
                manualDriver: CONFIG.manualDriver,
            },
            CONFIG.lockStressMs + 60000,
            'captureFrames(lock-stress-2hz)',
        );
        lockStressScreenshot = await captureScreenshot(
            win,
            'stillwater-lock-stress-final.png',
        );
    }

    let stress = null;
    let stressScreenshot = null;
    if (CONFIG.stressMs > 0) {
        stress = await executePageFunction(
            win,
            captureFramesPage,
            {
                label: 'mixed-reaction-storm',
                durationMs: CONFIG.stressMs,
                targetFps: CONFIG.targetFps,
                reactions: true,
                reactionIntervalMs: 500,
                reactionSequence: [
                    'lock',
                    'harddrop',
                    'tetris',
                    'tspin',
                    'combo',
                    'perfectclear',
                    'b2b',
                    'levelup',
                ],
                manualDriver: CONFIG.manualDriver,
            },
            CONFIG.stressMs + 60000,
            'captureFrames(mixed-reaction-storm)',
        );
        stressScreenshot = await captureScreenshot(
            win,
            'stillwater-stress-final.png',
        );
    }

    let switchCycles = null;
    let switchSettledMemory = null;
    if (CONFIG.switchCycles > 0) {
        switchCycles = await executePageFunction(
            win,
            exerciseSwitchCyclesPage,
            {
                cycles: CONFIG.switchCycles,
                timeoutMs: 60000,
            },
            (CONFIG.switchCycles * 130000) + 30000,
            'exerciseSwitchCycles',
        );
        await captureScreenshot(win, 'stillwater-switch-final.png');
        if (CONFIG.switchSettleMs > 0) {
            await delay(CONFIG.switchSettleMs);
        }
        switchSettledMemory = await collectCdpDiagnostics(
            win,
            'post-switch-settled',
            true,
        );
    }

    let deviceLoss = null;
    if (CONFIG.deviceLoss) {
        deviceLoss = await executePageFunction(
            win,
            exerciseDeviceLossPage,
            { timeoutMs: 60000 },
            90000,
            'exerciseDeviceLoss',
        );
        await captureScreenshot(win, 'stillwater-device-loss-recovered.png');
    }

    const finalBoardState = await executePageFunction(
        win,
        ensureProductionBoardRunningPage,
        {
            seed: 0x53545752,
            timeoutMs: 45000,
            forceRestart: true,
            stableMs: 1000,
        },
        60000,
        'ensureProductionBoardRunning(final)',
    );
    await delay(1000);
    const finalPreCaptureDiagnostics = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(final-pre-capture)',
    );
    const finalBoardScreenshot = await captureScreenshot(
        win,
        'stillwater-final-board.png',
    );
    const finalDiagnostics = await executePageFunction(
        win,
        collectPageDiagnosticsPage,
        null,
        30000,
        'collectPageDiagnostics(final)',
    );
    const finalMemory = await collectCdpDiagnostics(win, 'final', true);
    const consoleSummary = summarizeConsole(consoleEntries, processFailures);
    const consoleText = consoleEntries.map((entry) => (
        `[${new Date(entry.timestamp).toISOString()}][L${entry.level}] `
        + `${entry.sourceId || '<unknown>'}:${entry.line || 0} ${entry.message}`
    )).join('\n');
    await writeFile(path.join(ARTIFACT_DIR, 'console.log'), consoleText, 'utf8');

    const result = {
        boot,
        screenshots: {
            idle: idleScreenshot,
            reactions: reactionScreenshot,
            resumed: resumedScreenshot,
            hiddenResumed: hiddenResumedScreenshot,
            productionEvents: productionEventMatrix?.results?.map((entry) => ({
                id: entry.id,
                screenshot: entry.screenshot,
            })) || [],
            lockStress: lockStressScreenshot,
            stress: stressScreenshot,
            finalBoard: finalBoardScreenshot,
        },
        coldActivationMs,
        preIdleBoardState,
        idle,
        interMeasurementBoardState,
        reactions,
        reactionCaptureBoardState,
        reactionPostCaptureDiagnostics,
        pauseResume,
        hidden,
        layoutMatrix,
        resizeMatrix,
        productionEventMatrix,
        canvasFallback,
        lockStress,
        stress,
        switchCycles,
        switchSettledMemory,
        deviceLoss,
        finalBoardState,
        finalPreCaptureDiagnostics,
        initialDiagnostics,
        finalDiagnostics,
        memory: {
            initial: initialMemory,
            final: finalMemory,
        },
        consoleSummary,
    };
    const evaluation = evaluateRun(result, gpuDiagnostics);
    const summary = {
        generatedAt: new Date().toISOString(),
        targetUrl,
        artifactDir: ARTIFACT_DIR,
        config: CONFIG,
        apiAssumptions: API_ASSUMPTIONS,
        sourceBuildFingerprint,
        gpuDiagnostics,
        evaluation,
        result,
    };
    await writeFile(
        path.join(ARTIFACT_DIR, 'stillwater-wave8-summary.json'),
        JSON.stringify(summary, null, 2),
        'utf8',
    );
    await writeFile(
        path.join(ARTIFACT_DIR, 'stillwater-wave8-summary.md'),
        buildMarkdownSummary(summary),
        'utf8',
    );
    console.log(
        `[StillwaterWave8] ${evaluation.overallPass ? 'PASS' : 'FAIL'} — ${ARTIFACT_DIR}`,
    );
    return evaluation.overallPass;
}

async function shutdown(exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    } catch {
        // Best effort.
    }
    mainWindow = null;
    try {
        await stopPreviewServer();
    } catch (error) {
        console.error('[StillwaterWave8] Preview shutdown failed:', error);
    }
    try {
        await app.quit();
    } catch {
        // Best effort.
    }
    process.exit(exitCode);
}

function launchValidationApp() {
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    if (!CONFIG.pageVisibilityLane) {
        app.commandLine.appendSwitch('disable-background-timer-throttling');
        app.commandLine.appendSwitch('disable-renderer-backgrounding');
    }
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    if (CONFIG.lowPowerGpu) {
        app.commandLine.appendSwitch('force_low_power_gpu');
    } else if (!parseBoolean(ARGS['allow-low-power-gpu'], false)) {
        app.commandLine.appendSwitch('force_high_performance_gpu');
    }

    app.on('window-all-closed', (event) => {
        event.preventDefault();
    });

    app.whenReady().then(async () => {
        try {
            const passed = await runValidation();
            await shutdown(passed ? 0 : 1);
        } catch (error) {
            console.error(
                '[StillwaterWave8] FAILED:',
                error?.stack || error?.message || error,
            );
            await mkdir(ARTIFACT_DIR, { recursive: true });
            let fingerprintError = null;
            if (!sourceBuildFingerprint) {
                try {
                    sourceBuildFingerprint = await collectStillwaterSourceBuildFingerprint({
                        rootDir: ROOT,
                        distDirectory: DIST_DIRECTORY,
                    });
                } catch (provenanceError) {
                    fingerprintError = provenanceError?.message
                        || String(provenanceError);
                }
            }
            await writeFile(
                path.join(ARTIFACT_DIR, 'fatal-error.log'),
                `${error?.stack || error?.message || error}\n`,
                'utf8',
            );
            await writeFile(
                path.join(ARTIFACT_DIR, 'fatal-error.json'),
                JSON.stringify({
                    generatedAt: new Date().toISOString(),
                    targetUrl: createTargetUrl(),
                    artifactDir: ARTIFACT_DIR,
                    config: CONFIG,
                    sourceBuildFingerprint,
                    sourceBuildFingerprintError: fingerprintError,
                    error: {
                        message: error?.message || String(error),
                        stack: error?.stack || null,
                    },
                }, null, 2),
                'utf8',
            );
            await shutdown(1);
        }
    });

    process.on('SIGINT', () => shutdown(130));
    process.on('SIGTERM', () => shutdown(143));
}

if (app?.commandLine && typeof app.whenReady === 'function') {
    launchValidationApp();
}
