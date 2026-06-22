/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;
const args = parseArgs(process.argv.slice(2));

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
const SHOW_WINDOW = args.hide ? false : process.env.ODYSSEY_PERF_HIDE !== '1';
const PROFILE_DIR = path.resolve(String(args.profileDir || path.join(ROOT, 'artifacts', 'odyssey', 'perf-profile-temp')));
const OUTPUT_FILE = path.resolve(String(args.output || path.join(
    ROOT,
    'artifacts',
    'odyssey',
    'perf',
    `${CACHE_MODE}-${SCENARIO}-${Date.now()}.json`,
)));

const consoleLines = [];
const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

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
    if (args.forceWebgl || args.forceWebGL) params.set('forceWebGL', '1');
    if (args.disableBackgroundWarm) params.set('odysseyPerfDisableBackgroundWarm', '1');
    if (args.disableBackgroundLoading) params.set('odysseyDisableBackgroundLoading', '1');
    if (args.disableAdaptiveQuality) params.set('odysseyDisableAdaptiveQuality', '1');
    if (args.disableBloom) params.set('odysseyPerfDisableBloom', '1');
    if (args.bloomScale) params.set('odysseyPerfBloomScale', String(args.bloomScale));
    if (args.postQuality) params.set('odysseyPerfPostQuality', String(args.postQuality));
    if (args.gpuSync) params.set('odysseyPerfGpuSync', '1');
    if (args.pixelRatio) params.set('odysseyPixelRatio', String(args.pixelRatio));
    if (WARP_PREINIT) params.set('odysseyWarpPreinit', WARP_PREINIT);
    return `${BASE_URL}/?${params.toString()}`;
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

async function collectResult(win) {
    const browser = await execute(win, `
        (() => {
            const target = ${JSON.stringify(TARGET_FRAME_RATE)};
            const bc = window.odysseyMode?.boardController;
            return {
                location: window.location.href,
                devicePixelRatio: window.devicePixelRatio,
                perf: {
                    metrics: window.perfMonitor?.getMetrics?.() ?? null,
                    rollingPercentiles: window.perfMonitor?.getPercentiles?.() ?? null,
                    frameTimeSummary: window.perfMonitor?.getFrameTimeSummary?.(target) ?? null,
                    counters: window.perfMonitor?.getCounters?.() ?? null,
                    spikes: window.perfMonitor?.getSpikes?.() ?? [],
                    topSections: window.perfMonitor?.getTopSections?.(10) ?? [],
                    report: window.perfMonitor?.report?.() ?? null,
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
        consoleLines,
    };
}

function parseConsole(lines) {
    const messages = lines.map((line) => line.message);
    const startupLine = [...messages].reverse().find((message) => message.includes('[OdysseyStartup] total')) || null;
    const boardVisibleLine = [...messages].reverse().find((message) => message.includes('[OdysseyStartup] board visible')) || null;
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

async function runDegradeCycles(win) {
    for (let cycle = 0; cycle < RELOAD_CYCLES; cycle += 1) {
        await bootstrapOdyssey(win, { resetBeforeActivate: false });
        await delay(1000);
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

    const win = createWindow();
    if (RELOAD_CYCLES > 0) {
        await runDegradeCycles(win);
    }
    await bootstrapOdyssey(win, { resetBeforeActivate: true });
    await runScenario(win);
    const result = await collectResult(win);
    await writeFile(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log(`[odyssey-perf] wrote ${path.relative(ROOT, OUTPUT_FILE)}`);
    win.destroy();
    app.quit();
}

main().catch((error) => {
    console.error('[odyssey-perf] session failed:', error);
    app.quit();
    process.exitCode = 1;
});
