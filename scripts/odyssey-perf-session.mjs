/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
// Odyssey perf session harness (audit OD-01/OD-02 remediation).
// - Pins adaptive quality OFF and pixel ratio to 1 BY DEFAULT (override with
//   --allow-adaptive / --pixel-ratio) so p95/p99 tails are not contaminated by
//   the adaptive controller. Background loading is deliberately NOT pinned —
//   it is part of what this lane measures (pin explicitly with
//   --disable-background-loading when isolating).
// - Collects long-task / heap / release-gate evidence (null when a hook is
//   absent — never throws).
// - --runs N repeats the single-run flow with a fresh page per run and emits a
//   per-metric aggregate (median/p95/min/max) alongside every raw run payload.
// - Every output embeds a machine manifest (OS/CPU/RAM/GPU adapter/commit/
//   effective URL) so captures are comparable across machines.
// Default output dir is the committed reports/odyssey-perf/ (see its README);
// --output still overrides (the baseline runner writes to artifacts/).
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2));

if (args.help) {
    printHelp();
    process.exit(0);
}

// Electron is imported lazily so --help works in environments without the
// Electron binary (the npm package throws at import when dist/ is absent).
const electronModule = await import('electron');
const electron = electronModule.default ?? electronModule;
const { app, BrowserWindow } = electron;

// Match the shipped app's GPU selection (electron/main.js:46-50) so the lane
// profiles the SAME adapter players get. On hybrid-graphics Windows laptops the
// default is the low-power iGPU — without this the harness silently measured the
// wrong GPU (Radeon 610M instead of the discrete RTX). Chromium ignores WebGPU
// powerPreference on Windows (crbug 369219127), so this command-line switch is the
// reliable lever, and it must be appended before app-ready. (If the OS per-app
// graphics preference is set to "power saving" it can still override — see the
// reports/odyssey-perf README.)
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-webgl');
if (process.env.SERENITY_ENABLE_GPU_RASTERIZATION === '1') {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
}

// Stamped ONCE so the filename and every manifest field agree (never call
// Date.now() twice into naming + manifest).
const SESSION_DATE = new Date();

const PORT = Number(args.port || process.env.ODYSSEY_PERF_PORT || 4177);
const BASE_URL = String(args.baseUrl || process.env.ODYSSEY_PERF_BASE_URL || `http://127.0.0.1:${PORT}`);
const SCENARIO = String(args.scenario || process.env.ODYSSEY_PERF_SCENARIO || 'load');
const CACHE_MODE = String(args.cache || process.env.ODYSSEY_PERF_CACHE || 'cold');
const QUALITY = String(args.quality || process.env.ODYSSEY_PERF_QUALITY || 'Extreme');
const TARGET_FRAME_RATE = Number(args.targetFrameRate || process.env.ODYSSEY_PERF_TARGET_FPS || 240);
const WARMUP_MODE = String(args.warmupMode || process.env.ODYSSEY_PERF_WARMUP_MODE || 'current');
const WARP_PREINIT = String(args.warpPreinit || process.env.ODYSSEY_PERF_WARP_PREINIT || '');
const WIDTH = Math.max(640, Number(args.width || process.env.ODYSSEY_PERF_WIDTH || 1280));
const HEIGHT = Math.max(480, Number(args.height || process.env.ODYSSEY_PERF_HEIGHT || 720));
const DURATION_MS = Math.max(1000, Number(args.duration || process.env.ODYSSEY_PERF_DURATION_MS || 30000));
const PAN_DURATION_MS = Math.max(250, Number(args.panDuration || process.env.ODYSSEY_PERF_PAN_MS || 2200));
const RELOAD_CYCLES = Math.max(0, Number(args.reloadCycles || process.env.ODYSSEY_PERF_RELOAD_CYCLES || 0));
const RUNS = Math.max(1, Math.floor(Number(args.runs || process.env.ODYSSEY_PERF_RUNS || 1)));
const SHOW_WINDOW = args.hide ? false : process.env.ODYSSEY_PERF_HIDE !== '1';
// OD-02 pins (default ON — mirrors scripts/odyssey-chapter-capture.mjs).
const ALLOW_ADAPTIVE = !!args.allowAdaptive;
const PIXEL_RATIO = (() => {
    const value = Number(args.pixelRatio);
    return Number.isFinite(value) && value > 0 ? value : 1;
})();
const PROFILE_DIR = path.resolve(String(
    args.profileDir || path.join(ROOT, 'artifacts', 'odyssey', 'perf-profile-temp'),
));
const OUTPUT_FILE = path.resolve(String(args.output || path.join(
    ROOT,
    'reports',
    'odyssey-perf',
    `session-${CACHE_MODE}-${SCENARIO}-${SESSION_DATE.getTime()}.json`,
)));
// Optional: grab a PNG of the (visible, real-GPU) board after the scenario — a fast way to
// eyeball a visual change (e.g. an earth-core octave cut) that the full chapter-capture
// harness is too slow/hang-prone to produce headlessly.
const SCREENSHOT_PATH = (args.screenshot && args.screenshot !== true)
    ? path.resolve(String(args.screenshot))
    : null;

const consoleLines = [];
const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

function printHelp() {
    console.log(`Usage: node scripts/run-electron.mjs scripts/odyssey-perf-session.mjs [options]

Runs an instrumented Odyssey session against the dev server and writes a JSON
result (raw runs + aggregate + machine manifest).

Pinning (audit OD-02 — pinned BY DEFAULT):
  --allow-adaptive              un-pin adaptive quality (default: odysseyDisableAdaptiveQuality=1)
  --pixel-ratio <v>             pinned devicePixelRatio (default: 1; always pinned)
  --disable-background-loading  pin background loading OFF (NOT pinned by default —
                                the streaming tail is part of what this lane measures)

Runs / aggregation (audit OD-01):
  --runs <n>                    repeat the flow n times, fresh page per run (default 1).
                                Output always has { manifest, aggregate, runs[] } — an
                                aggregate of one when n=1. NOTE: with --cache cold, runs
                                2..n reuse the same Electron profile (Dawn cache warm);
                                for strict cold cells prefer n separate invocations.
  --output <file>               output path (default reports/odyssey-perf/session-<cache>-<scenario>-<stamp>.json)

Session shape:
  --scenario <load|idle|scroll|transition>   (default load)
  --cache <cold|warm|degraded|...>           label + profile handling (default cold)
  --quality <tier>              (default Extreme)     --target-frame-rate <fps> (default 240)
  --warmup-mode <mode>          (default current)     --duration <ms>  (default 30000)
  --pan-duration <ms>           (default 2200)        --reload-cycles <n> (default 0)
  --width <px> --height <px>    (default 1280x720)    --idle-position <0..1>
  --positions <csv>             scroll scenario stops --warp-preinit <immediate|defer|off>

Toggles passed through to the page:
  --force-webgl --disable-background-warm --disable-bloom --bloom-scale <v>
  --post-quality <v> --gpu-sync

Infra:
  --port <n> --base-url <url> --profile-dir <dir> --reset-profile --hide --verbose --help`);
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const raw = token.slice(2);
        const [key, inline] = raw.split('=', 2);
        const normalized = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (inline !== undefined) {
            out[normalized] = inline;
        } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
            out[normalized] = argv[i + 1];
            i += 1;
        } else {
            out[normalized] = true;
        }
    }
    return out;
}

function parseNumberList(value) {
    return String(value || '')
        .split(',')
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isFinite(entry));
}

function makeUrl() {
    const params = new URLSearchParams({
        skipIntro: '1',
        odysseyPerfRun: '1',
        odysseyPerfScenario: SCENARIO,
        odysseyWarmupMode: WARMUP_MODE,
        odysseyPerfRefreshTarget: String(TARGET_FRAME_RATE),
        odysseyOverlay: '0',
    });
    // OD-02: pinned configuration is the DEFAULT (mirrors odyssey-chapter-capture.mjs).
    // Background loading is intentionally NOT pinned here — it is measured, not locked
    // (pin explicitly with --disable-background-loading).
    if (!ALLOW_ADAPTIVE) params.set('odysseyDisableAdaptiveQuality', '1');
    params.set('odysseyPixelRatio', String(PIXEL_RATIO));
    if (args.forceWebgl || args.forceWebGL) params.set('forceWebGL', '1');
    if (args.disableBackgroundWarm) params.set('odysseyPerfDisableBackgroundWarm', '1');
    if (args.disableBackgroundLoading) params.set('odysseyDisableBackgroundLoading', '1');
    if (args.disableBloom) params.set('odysseyPerfDisableBloom', '1');
    if (args.bloomScale) params.set('odysseyPerfBloomScale', String(args.bloomScale));
    if (args.postQuality) params.set('odysseyPerfPostQuality', String(args.postQuality));
    if (args.gpuSync) params.set('odysseyPerfGpuSync', '1');
    if (WARP_PREINIT) params.set('odysseyWarpPreinit', WARP_PREINIT);
    return `${BASE_URL}/?${params.toString()}`;
}

function getGitCommit() {
    try {
        return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // Keep polling.
        }
        await delay(350);
    }
    throw new Error(`Timed out waiting for dev server: ${url}`);
}

function createWindow() {
    const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        useContentSize: true,
        show: SHOW_WINDOW,
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        const entry = {
            level,
            message: String(message),
            line,
            sourceId,
            t: Date.now(),
        };
        consoleLines.push(entry);
        if (args.verbose) console.log(`[browser] ${entry.message}`);
    });

    return win;
}

async function execute(win, source) {
    return win.webContents.executeJavaScript(source, true);
}

async function waitFor(win, predicateSource, timeoutMs = 140000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const ok = await execute(win, `(() => { try { return !!(${predicateSource}); } catch { return false; } })()`);
        if (ok) return true;
        await delay(100);
    }
    return false;
}

async function resetPerf(win, label) {
    await execute(win, `
        (() => {
            window.perfMonitor?.start?.();
            window.perfMonitor?.hide?.();
            window.perfMonitor?.reset?.();
            window.perfMonitor?.clearSpikes?.();
            window.perfMonitor?.event?.('odyssey-perf-reset', { label: ${JSON.stringify(label)} });
            return true;
        })();
    `);
}

async function bootstrapOdyssey(win, { resetBeforeActivate = true } = {}) {
    await win.loadURL(makeUrl());
    const ready = await waitFor(win, 'window.serenityBlocks?.gameModeManager', 140000);
    if (!ready) throw new Error('gameModeManager not ready');

    await execute(win, `
        (() => {
            window.settings = {
                ...(window.settings || {}),
                effectQuality: ${JSON.stringify(QUALITY)},
                graphicsQuality: ${JSON.stringify(QUALITY)},
                targetFrameRate: ${JSON.stringify(TARGET_FRAME_RATE)},
            };
            window.settingsManager?.update?.({
                effectQuality: ${JSON.stringify(QUALITY)},
                graphicsQuality: ${JSON.stringify(QUALITY)},
                targetFrameRate: ${JSON.stringify(TARGET_FRAME_RATE)},
            });
            return true;
        })();
    `);

    if (resetBeforeActivate) await resetPerf(win, `${CACHE_MODE}:${SCENARIO}:load`);

    const boot = await execute(win, `
        (async () => {
            const gm = window.serenityBlocks.gameModeManager;
            if (gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
            if (!gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();
            return true;
        })();
    `);
    if (!boot) throw new Error('Odyssey activation failed');

    const active = await waitFor(win, 'window.odysseyMode?.boardController?.isActive', 180000);
    if (!active) throw new Error('Odyssey board did not become active');
    await delay(300);
}

async function waitForCleanRuntime(win, timeoutMs = 180000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const state = await execute(win, `
            (() => {
                const mode = window.odysseyMode;
                const bc = window.odysseyMode?.boardController;
                if (!bc?.isActive) return { ready: false };
                const warpPreinitMode = mode?._resolveWarpPreinitMode?.() ?? 'unknown';
                const warpReady = warpPreinitMode !== 'defer'
                    || mode?._warpPreinitComplete
                    || !mode?.transitionManager;
                return {
                    ready: (bc.pendingChapterLoads?.size || 0) === 0
                        && (bc.prewarmQueue?.length || 0) === 0
                        && !bc.isPrewarming
                        && (bc._bgRenderWarmComplete || ${args.disableBackgroundWarm ? 'true' : 'false'})
                        && warpReady,
                    pendingChapterLoads: bc.pendingChapterLoads?.size || 0,
                    prewarmQueue: bc.prewarmQueue?.length || 0,
                    isPrewarming: !!bc.isPrewarming,
                    bgRenderWarmComplete: !!bc._bgRenderWarmComplete,
                    warpPreinitMode,
                    warpPreinitComplete: !!mode?._warpPreinitComplete,
                    warpPreinitScheduled: !!mode?._warpPreinitScheduled,
                };
            })();
        `);
        if (state.ready) return state;
        await delay(500);
    }
    return { ready: false, timeoutMs };
}

async function runIdle(win) {
    await waitForCleanRuntime(win);
    const idlePosition = Number(args.idlePosition);
    if (Number.isFinite(idlePosition)) {
        await execute(win, `
            (() => {
                const bc = window.odysseyMode?.boardController;
                const position = Math.min(1, Math.max(0, ${idlePosition}));
                if (bc?.cameraController?.setFollowMode) {
                    bc.cameraController.setFollowMode({ position, direct: true });
                } else {
                    bc?.cameraController?.setCurrentPosition?.(position);
                }
                if (bc?.cameraController?.travelModel) {
                    bc.cameraController.travelModel.velocity = 0;
                    bc.cameraController.travelModel.inputVelocity = 0;
                }
                if (bc?.cameraController?.config) {
                    bc.cameraController.config.autoDriftScale = 0;
                }
                bc?.environmentManager?.updateVisibility?.(position, { mode: 'progress' });
                bc?.environmentManager?.updateGlobalEnvironment?.(position);
                bc?.renderFrame?.(1 / 240);
                return bc?.cameraController?.getCurrentPosition?.() ?? null;
            })();
        `);
        await delay(100);
    }
    await resetPerf(win, `${CACHE_MODE}:${SCENARIO}:idle`);
    await delay(DURATION_MS);
}

async function runScroll(win) {
    await waitForCleanRuntime(win);
    const positions = parseNumberList(args.positions);
    const plan = positions.length > 0 ? positions : await execute(win, `
        (() => {
            const bc = window.odysseyMode?.boardController;
            const current = bc?.cameraController?.getCurrentPosition?.() ?? 0.093;
            const stops = bc?.presentationLayout?.chapterPositions || [];
            const next = stops.find((p) => Number.isFinite(p) && p > current + 0.025) ?? Math.min(1, current + 0.16);
            return [current, Math.min(1, current + ((next - current) * 0.5)), next, Math.max(0, next - 0.035), current];
        })();
    `);
    await resetPerf(win, `${CACHE_MODE}:${SCENARIO}:scroll`);
    for (const position of plan) {
        await execute(win, `
            (async () => {
                const bc = window.odysseyMode?.boardController;
                await bc?.cameraController?.panToPosition?.(${position}, ${PAN_DURATION_MS});
                return bc?.cameraController?.getCurrentPosition?.() ?? null;
            })();
        `);
        await delay(250);
    }
}

async function runTransition(win) {
    await waitForCleanRuntime(win);
    const transition = await execute(win, `
        (() => {
            const bc = window.odysseyMode?.boardController;
            const current = bc?.cameraController?.getCurrentPosition?.() ?? 0.093;
            const boundary = (bc?.presentationLayout?.chapterPositions || [])
                .find((p) => Number.isFinite(p) && p > current + 0.02) ?? Math.min(0.98, current + 0.08);
            return {
                start: Math.max(0, boundary - 0.03),
                end: Math.min(1, boundary + 0.03),
            };
        })();
    `);
    await execute(win, `
        (async () => {
            const bc = window.odysseyMode?.boardController;
            await bc?.cameraController?.panToPosition?.(${transition.start}, 1);
            return true;
        })();
    `);
    await delay(250);
    await resetPerf(win, `${CACHE_MODE}:${SCENARIO}:transition`);
    await execute(win, `
        (async () => {
            const bc = window.odysseyMode?.boardController;
            await bc?.cameraController?.panToPosition?.(${transition.end}, ${PAN_DURATION_MS});
            return true;
        })();
    `);
    await delay(750);
}

async function runScenario(win) {
    if (SCENARIO === 'idle') return runIdle(win);
    if (SCENARIO === 'scroll') return runScroll(win);
    if (SCENARIO === 'transition') return runTransition(win);
    await delay(Math.min(2000, DURATION_MS));
    return null;
}

async function collectResult(win, runIndex) {
    const browser = await execute(win, `
        (() => {
            const target = ${JSON.stringify(TARGET_FRAME_RATE)};
            const bc = window.odysseyMode?.boardController;
            return {
                location: window.location.href,
                devicePixelRatio: window.devicePixelRatio,
                // Machine-manifest GPU identity as the page sees it (three.js WebGPU
                // backend adapter). Nullable — WebGL2 fallback / older builds have none.
                gpu: (() => {
                    try {
                        const info = bc?.renderer?.backend?.adapter?.info ?? null;
                        if (!info) return null;
                        return {
                            vendor: info.vendor ?? null,
                            architecture: info.architecture ?? null,
                            device: info.device ?? null,
                            description: info.description ?? null,
                        };
                    } catch { return null; }
                })(),
                // Which render backend actually served the frames — a null gpu.adapter
                // alone can't distinguish "WebGPU with no adapter.info" from "WebGL2
                // fallback", and that changes how the numbers are read. Existence-guarded.
                backend: (() => {
                    try {
                        const b = bc?.renderer?.backend;
                        if (!b) return null;
                        const isWebGPU = !!b.isWebGPUBackend;
                        const isWebGL = !!b.isWebGLBackend;
                        return {
                            isWebGPU,
                            isWebGL,
                            name: isWebGPU ? 'webgpu' : (isWebGL ? 'webgl2' : 'unknown'),
                        };
                    } catch { return null; }
                })(),
                // Definitive physical-adapter name via the WebGL ANGLE renderer string
                // (WebGPU adapter.info is null on Windows). This is how we CONFIRM
                // force_high_performance_gpu actually selected the dGPU — the manifest
                // should read an NVIDIA/RTX string, not "AMD Radeon 610M".
                webglRenderer: (() => {
                    try {
                        const canvas = document.createElement('canvas');
                        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                        if (!gl) return null;
                        const ext = gl.getExtension('WEBGL_debug_renderer_info');
                        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
                    } catch { return null; }
                })(),
                perf: {
                    metrics: window.perfMonitor?.getMetrics?.() ?? null,
                    rollingPercentiles: window.perfMonitor?.getPercentiles?.() ?? null,
                    frameTimeSummary: window.perfMonitor?.getFrameTimeSummary?.(target) ?? null,
                    counters: window.perfMonitor?.getCounters?.() ?? null,
                    spikes: window.perfMonitor?.getSpikes?.() ?? [],
                    topSections: window.perfMonitor?.getTopSections?.(10) ?? [],
                    report: window.perfMonitor?.report?.() ?? null,
                    // OD-01: previously-discarded evidence. Each hook is
                    // existence-guarded — absent hook records null, never throws.
                    longTasks: window.perfMonitor?.getLongTaskSummary?.() ?? null,
                    releaseGates: window.perfMonitor?.gates?.() ?? null,
                    // performance.memory is Chromium-only and may be absent.
                    memory: (() => {
                        try {
                            const m = typeof performance !== 'undefined' ? performance.memory : null;
                            if (!m) return null;
                            return {
                                usedJSHeapSize: m.usedJSHeapSize ?? null,
                                totalJSHeapSize: m.totalJSHeapSize ?? null,
                                jsHeapSizeLimit: m.jsHeapSizeLimit ?? null,
                            };
                        } catch { return null; }
                    })(),
                },
                odyssey: bc?.getPerfSnapshot?.({
                    label: ${JSON.stringify(`${CACHE_MODE}:${SCENARIO}`)},
                    cacheMode: ${JSON.stringify(CACHE_MODE)},
                    scenario: ${JSON.stringify(SCENARIO)},
                    targetFrameRate: target,
                    warpPreinit: {
                        mode: window.odysseyMode?._resolveWarpPreinitMode?.() ?? null,
                        complete: !!window.odysseyMode?._warpPreinitComplete,
                        scheduled: !!window.odysseyMode?._warpPreinitScheduled,
                    },
                }) ?? null,
            };
        })();
    `);
    return {
        runIndex,
        label: `${CACHE_MODE}:${SCENARIO}`,
        cacheMode: CACHE_MODE,
        scenario: SCENARIO,
        quality: QUALITY,
        targetFrameRate: TARGET_FRAME_RATE,
        warmupMode: WARMUP_MODE,
        durationMs: DURATION_MS,
        panDurationMs: PAN_DURATION_MS,
        reloadCycles: RELOAD_CYCLES,
        parsedConsole: parseConsole(consoleLines),
        browser,
        consoleLines: [...consoleLines],
    };
}

function parseConsole(lines) {
    const messages = lines.map((line) => line.message);
    const startupLine = [...messages].reverse().find((message) => message.includes('[OdysseyStartup] total')) || null;
    const boardVisibleLine = [...messages].reverse()
        .find((message) => message.includes('[OdysseyStartup] board visible')) || null;
    const startup = startupLine ? parseStartupLine(startupLine) : null;
    const boardVisibleMatch = boardVisibleLine?.match(/board visible\s+(\d+)ms/i);
    return {
        startupLine,
        boardVisibleLine,
        startup,
        boardVisibleMs: boardVisibleMatch ? Number(boardVisibleMatch[1]) : null,
        warmupLines: messages.filter((message) => message.includes('[OdysseyWarmup]')),
        warnings: messages.filter((message) => /\b(warn|error|failed|validation)\b/i.test(message)),
    };
}

function parseStartupLine(line) {
    const total = Number(line.match(/total\s+(\d+)ms/)?.[1] ?? NaN);
    const buckets = {};
    const parts = line.split('|').slice(1);
    for (const part of parts) {
        const match = part.trim().match(/^(.+?)\s+(\d+)$/);
        if (match) buckets[match[1].trim()] = Number(match[2]);
    }
    return {
        totalMs: Number.isFinite(total) ? total : null,
        buckets,
    };
}

// ── OD-01 aggregation ───────────────────────────────────────────────────────

function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

/** Flatten one run payload into the named scalar metrics the aggregate (and
 * odyssey-perf-compare.mjs) understand. Missing sources yield null. */
function extractRunMetrics(run) {
    const perf = run?.browser?.perf || {};
    const frames = perf.frameTimeSummary || {};
    return {
        boardVisibleMs: finiteOrNull(run?.parsedConsole?.boardVisibleMs),
        'startup.totalMs': finiteOrNull(run?.parsedConsole?.startup?.totalMs),
        'startup.warmupMs': finiteOrNull(run?.parsedConsole?.startup?.buckets?.warmup),
        'frame.p50': finiteOrNull(frames.p50),
        'frame.p95': finiteOrNull(frames.p95),
        'frame.p99': finiteOrNull(frames.p99),
        'frame.max': finiteOrNull(frames.max),
        overBudget: finiteOrNull(frames.overBudget),
        spikes: Array.isArray(perf.spikes) ? perf.spikes.length : null,
        'drawCalls.avg': finiteOrNull(perf.counters?.callsAvg),
        'triangles.avg': finiteOrNull(perf.counters?.trianglesAvg),
        'longTasks.count': finiteOrNull(perf.longTasks?.count),
        'longTasks.totalMs': finiteOrNull(perf.longTasks?.totalMs),
        'longTasks.maxMs': finiteOrNull(perf.longTasks?.maxMs),
        'memory.usedJSHeapSizeMB': perf.memory?.usedJSHeapSize != null
            ? finiteOrNull(perf.memory.usedJSHeapSize / (1024 * 1024))
            : null,
    };
}

function summarizeValues(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const percentile = (fraction) => {
        const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
        return sorted[index];
    };
    return {
        count: sorted.length,
        median: percentile(0.5),
        p95: percentile(0.95),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        values: sorted,
    };
}

/** Aggregate block: per-metric median/p95/min/max across runs. --runs 1
 * produces the same shape (an aggregate of one) so consumers handle both. */
function buildAggregate(runs) {
    const perRun = runs.map((run) => extractRunMetrics(run));
    const metrics = {};
    const names = new Set(perRun.flatMap((entry) => Object.keys(entry)));
    for (const name of names) {
        metrics[name] = summarizeValues(perRun.map((entry) => entry[name]));
    }
    return { runCount: runs.length, metrics };
}

/** Machine + configuration manifest (audit OD-01: captures must record their
 * identity or they are not comparable). GPU identity comes from the page. */
function buildManifest(runs) {
    const cpus = os.cpus() || [];
    const gpu = runs.map((run) => run?.browser?.gpu).find((info) => info) ?? null;
    const backend = runs.map((run) => run?.browser?.backend).find(Boolean) ?? null;
    const webglRenderer = runs.map((run) => run?.browser?.webglRenderer).find(Boolean) ?? null;
    return {
        schemaVersion: 2,
        date: SESSION_DATE.toISOString(),
        commit: getGitCommit(),
        script: 'scripts/odyssey-perf-session.mjs',
        argv: process.argv.slice(2),
        backend,
        webglRenderer,
        machine: {
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            cpuModel: cpus[0]?.model ?? null,
            cpuCount: cpus.length,
            totalMemBytes: os.totalmem(),
        },
        gpu,
        url: makeUrl(),
        // OD-02 acceptance: the manifest records the pinned state explicitly.
        pins: {
            adaptive: ALLOW_ADAPTIVE ? 'enabled (--allow-adaptive)' : 'disabled',
            dpr: PIXEL_RATIO,
            backgroundLoading: args.disableBackgroundLoading
                ? 'disabled'
                : 'default-on (measured, not pinned)',
        },
        session: {
            cacheMode: CACHE_MODE,
            scenario: SCENARIO,
            quality: QUALITY,
            targetFrameRate: TARGET_FRAME_RATE,
            warmupMode: WARMUP_MODE,
            durationMs: DURATION_MS,
            panDurationMs: PAN_DURATION_MS,
            reloadCycles: RELOAD_CYCLES,
            runs: RUNS,
            width: WIDTH,
            height: HEIGHT,
            profileDir: path.relative(ROOT, PROFILE_DIR),
            coldCacheCaveat: RUNS > 1 && CACHE_MODE === 'cold'
                ? 'runs 2..N reuse the Electron profile (Dawn cache warm); use separate invocations for strict cold'
                : null,
        },
    };
}

async function runDegradeCycles(win) {
    for (let cycle = 0; cycle < RELOAD_CYCLES; cycle += 1) {
        await bootstrapOdyssey(win, { resetBeforeActivate: false });
        await delay(1000);
    }
}

async function runOnce(runIndex) {
    consoleLines.length = 0;
    const win = createWindow();
    try {
        if (RELOAD_CYCLES > 0) {
            await runDegradeCycles(win);
        }
        await bootstrapOdyssey(win, { resetBeforeActivate: true });
        await runScenario(win);
        const result = await collectResult(win, runIndex);
        if (SCREENSHOT_PATH) {
            const image = await win.webContents.capturePage();
            await mkdir(path.dirname(SCREENSHOT_PATH), { recursive: true });
            await writeFile(SCREENSHOT_PATH, image.toPNG());
            console.log(`[odyssey-perf] screenshot -> ${path.relative(ROOT, SCREENSHOT_PATH)}`);
        }
        return result;
    } finally {
        win.destroy();
    }
}

async function main() {
    if (args.resetProfile) {
        await rm(PROFILE_DIR, { recursive: true, force: true });
    }
    await mkdir(PROFILE_DIR, { recursive: true });
    await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    app.setPath('userData', PROFILE_DIR);
    await app.whenReady();
    await waitForServer(BASE_URL);

    const runs = [];
    for (let runIndex = 0; runIndex < RUNS; runIndex += 1) {
        if (RUNS > 1) console.log(`[odyssey-perf] run ${runIndex + 1}/${RUNS}...`);
        runs.push(await runOnce(runIndex));
    }

    const result = {
        manifest: buildManifest(runs),
        aggregate: buildAggregate(runs),
        runs,
    };
    await writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log(`[odyssey-perf] wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
    app.quit();
}

main().catch((error) => {
    console.error('[odyssey-perf] session failed:', error);
    app.quit();
    process.exitCode = 1;
});
