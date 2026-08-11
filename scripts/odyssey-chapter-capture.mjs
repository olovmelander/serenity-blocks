/**
 * TDR-safe Odyssey chapter capture harness.
 *
 * Usage:
 *   npx electron scripts/odyssey-chapter-capture.mjs --chapter 5
 *   npx electron scripts/odyssey-chapter-capture.mjs --chapter 1 --force-webgl
 *   npx electron scripts/odyssey-chapter-capture.mjs --seam 5-6
 *
 * Environment:
 *   ODYSSEY_CAPTURE_PORT       dev server port (default: 4177)
 *   ODYSSEY_CAPTURE_QUALITY    Minimal | Low | Medium | High | Ultra | Extreme
 *   ODYSSEY_CAPTURE_FRAMES     number of chapter samples (default: 20)
 *   ODYSSEY_CAPTURE_SHOW       set 1 to show the Electron window
 *   ODYSSEY_CAPTURE_KEEP       set 1 to keep the existing artifact folder
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */

import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const { app, BrowserWindow } = electron;

const CHAPTER_NAMES = {
    1: 'Earth Core & Subterranean Origins',
    2: 'Deep Ocean & Liquid Worlds',
    3: 'Surface World & Living Landscapes',
    4: 'Mountains & Thin-Air Ascension',
    5: 'Sky & Atmospheric Drift',
    6: 'Space & Cosmic Expanse',
    7: 'Black Hole & Abstract Transcendence',
    8: 'Urban Dreams Encore',
};

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || process.env.ODYSSEY_CAPTURE_PORT || 4177);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const QUALITY = String(args.quality || process.env.ODYSSEY_CAPTURE_QUALITY || 'High');
const FRAME_COUNT = Math.max(2, Number.parseInt(args.frames || process.env.ODYSSEY_CAPTURE_FRAMES || '20', 10));
const WIDTH = Math.max(320, Number.parseInt(args.width || process.env.ODYSSEY_CAPTURE_WIDTH || '1280', 10));
const HEIGHT = Math.max(240, Number.parseInt(args.height || process.env.ODYSSEY_CAPTURE_HEIGHT || '720', 10));
const SHOW_WINDOW = args.show || process.env.ODYSSEY_CAPTURE_SHOW === '1';
const KEEP_EXISTING = args.keep || process.env.ODYSSEY_CAPTURE_KEEP === '1';
const FORCE_WEBGL = args.forceWebgl || args['force-webgl'] || process.env.ODYSSEY_CAPTURE_FORCE_WEBGL === '1';
const SEAM = parseSeam(args.seam || process.env.ODYSSEY_CAPTURE_SEAM || '');
const CHAPTER = SEAM ? null : parseChapter(args.chapter || args.ch || process.env.ODYSSEY_CAPTURE_CHAPTER || '');
const MODE = SEAM ? 'seam' : 'chapter';
const TARGET_CHAPTERS = SEAM
    ? [SEAM.source, SEAM.target]
    : expandChapterWindow(CHAPTER);
const BACKEND_LABEL = FORCE_WEBGL ? 'webgl2' : 'webgpu';
const VARIANT_LABEL = MODE === 'seam'
    ? `seam-${SEAM.source}-${SEAM.target}-${QUALITY.toLowerCase()}-${BACKEND_LABEL}`
    : `chapter-${String(CHAPTER).padStart(2, '0')}-${QUALITY.toLowerCase()}-${BACKEND_LABEL}`;
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'odyssey', 'wave-v', VARIANT_LABEL);

let devServerProcess = null;
const consoleLines = [];
const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const raw = token.slice(2);
        const [key, inlineValue] = raw.split('=', 2);
        const normalized = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        const next = argv[index + 1];
        if (inlineValue !== undefined) {
            result[normalized] = inlineValue;
        } else if (next && !next.startsWith('--')) {
            result[normalized] = next;
            index += 1;
        } else {
            result[normalized] = true;
        }
    }
    return result;
}

function parseChapter(value) {
    const chapter = Number.parseInt(value, 10);
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 8) {
        throw new Error('Pass a chapter id from 1 to 8, for example --chapter 5.');
    }
    return chapter;
}

function parseSeam(value) {
    if (!value) return null;
    const match = String(value).match(/^([1-7])-([2-8])$/);
    if (!match) {
        throw new Error('Pass seams as source-target, for example --seam 5-6.');
    }
    const source = Number.parseInt(match[1], 10);
    const target = Number.parseInt(match[2], 10);
    if (target !== source + 1) {
        throw new Error('Only adjacent Odyssey seams are supported.');
    }
    return { source, target };
}

function expandChapterWindow(chapter) {
    return [chapter - 1, chapter, chapter + 1]
        .filter((id) => id >= 1 && id <= 8);
}

function makeUrl() {
    const params = new URLSearchParams({
        skipIntro: '1',
        odysseyAAA: '1',
        odysseyOverlay: '0',
        odysseyPixelRatio: '1',
        odysseyDisableAdaptiveQuality: '1',
        odysseyDisableBackgroundLoading: '1',
        odysseyCaptureChapters: TARGET_CHAPTERS.join(','),
        captureBust: String(Date.now()),
    });
    if (FORCE_WEBGL) params.set('forceWebGL', '1');
    // Pass arbitrary extra flags through: --url-flag odysseyOneWorld=1
    []
        .concat(args['url-flag'] || args.urlFlag || [])
        .forEach((entry) => {
            String(entry).split(',').forEach((pair) => {
                const [k, v = '1'] = pair.split('=');
                if (k) params.set(k, v);
            });
        });
    return `${BASE_URL}/?${params.toString()}`;
}

async function waitForServer(url, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // Keep polling until Vite is listening.
        }
        await delay(400);
    }
    throw new Error(`Timed out waiting for dev server: ${url}`);
}

function startDevServer() {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const commandArgs = isWindows
        ? [
            '/d', '/s', '/c',
            'npm.cmd', 'run', 'dev', '--',
            '--host', '127.0.0.1',
            '--port', String(PORT),
            '--strictPort',
        ]
        : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'];
    const proc = spawn(
        command,
        commandArgs,
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } },
    );
    proc.stdout.on('data', (chunk) => consoleLines.push(String(chunk)));
    proc.stderr.on('data', (chunk) => consoleLines.push(String(chunk)));
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
}

function createWindow() {
    return new BrowserWindow({
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
}

async function execute(win, source) {
    return win.webContents.executeJavaScript(source, true);
}

const HIDE_OVERLAYS = `
    (() => {
        const captureStyleId = 'odyssey-wave-v-capture-hide-ui';
        const captureHiddenAttr = 'data-odyssey-wave-v-capture-hidden';
        const hideElement = (element) => {
            if (!element || element.closest('#odyssey-board-3d')) return;
            element.setAttribute(captureHiddenAttr, 'true');
            element.style.setProperty('display', 'none', 'important');
            element.style.setProperty('opacity', '0', 'important');
            element.style.setProperty('visibility', 'hidden', 'important');
            element.style.setProperty('pointer-events', 'none', 'important');
        };
        let style = document.getElementById(captureStyleId);
        const selectors = [
            '#start-modal',
            '#cinematic-loading-overlay',
            '#startup-shell',
            '#main-menu',
            '#menu-screen',
            '#odyssey-board-overlay',
            '#odyssey-level-select',
            '#odyssey-aaa-debug-overlay',
            '#odyssey-navigator-btn',
            '#performance-overlay',
            '.main-menu-player-card',
            '.modal-overlay',
            '.main-menu-screen',
            '.game-mode-selection',
            '.game-mode-cards-container',
            '.odyssey-navigator-icon',
            '.floating-settings-btn',
            '.serenity-hub-icon'
        ];
        if (!style) {
            style = document.createElement('style');
            style.id = captureStyleId;
            style.textContent = selectors.join(',') + [
                '{',
                'display:none!important;',
                'opacity:0!important;',
                'visibility:hidden!important;',
                'pointer-events:none!important;',
                '}',
            ].join('');
            document.head.appendChild(style);
        }
        document.querySelectorAll(selectors.join(',')).forEach(hideElement);
        document.querySelectorAll('button, [role="button"], a[href]').forEach((element) => {
            const computed = window.getComputedStyle(element);
            if (computed.position !== 'fixed') return;
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            hideElement(element);
        });
        document.body.classList.remove('startup-shell-active', 'start-modal-open', 'serenity-hub-open');
        return true;
    })();
`;

async function bootstrapOdyssey(win) {
    return execute(win, `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitFor = async (predicate, timeoutMs = 140000) => {
                const startedAt = performance.now();
                while (performance.now() - startedAt < timeoutMs) {
                    if (predicate()) return true;
                    await sleep(100);
                }
                return false;
            };

            if (!await waitFor(() => !!window.serenityBlocks?.gameModeManager)) {
                return { ok: false, reason: 'gameModeManager not ready' };
            }

            const captureQuality = ${JSON.stringify(QUALITY)};
            window.settings = {
                ...(window.settings || {}),
                effectQuality: captureQuality,
                graphicsQuality: captureQuality,
            };
            window.settingsManager?.update?.({
                effectQuality: captureQuality,
                graphicsQuality: captureQuality,
            });

            const gm = window.serenityBlocks.gameModeManager;
            if (gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
            if (!gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();

            const required = ${JSON.stringify(TARGET_CHAPTERS)};
            const ready = await waitFor(() => {
                const bc = window.odysseyMode?.boardController;
                if (!bc?.isActive || !bc.cameraController || !bc.environmentManager) return false;
                const envs = bc.environmentManager.environments;
                // A chapter whose ground comes from the continuous Act II world is never
                // created as an environment, so requiring an entry for it here can never
                // become true. This predicate predates the idea that a chapter's ground might
                // live somewhere other than its own diorama; without this it simply waits out
                // its 140s timeout and reports a boot failure that never happened.
                const suppressed = bc.environmentManager.suppressedChapters;
                const satisfied = (chapterId) => envs?.has(chapterId)
                    || (!!bc.oneWorld && !!suppressed?.has?.(chapterId));
                return required.every(satisfied)
                    && (bc.pendingChapterLoads?.size || 0) === 0;
            });
            if (!ready) return { ok: false, reason: 'required chapter environments not ready' };

            await ${HIDE_OVERLAYS}

            const bc = window.odysseyMode.boardController;
            return {
                ok: true,
                qualityName: bc.qualityName,
                pixelRatio: bc.renderer?.getPixelRatio?.() ?? null,
                backend: bc.isWebGPU ? 'webgpu' : (bc.isWebGL ? 'webgl2' : 'unknown'),
                aaaPost: !!bc.aaaPostActive,
                debugOverlay: !!document.getElementById('odyssey-aaa-debug-overlay'),
                loadedChapters: [...bc.environmentManager.environments.keys()].sort((a, b) => a - b),
                chapterPositions: [...(bc.presentationLayout?.chapterPositions || [])],
            };
        })();
    `);
}

async function settleAtPosition(win, position, options = {}) {
    const direct = options.direct !== false;
    const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : 350;
    await execute(win, `
        (() => {
            const bc = window.odysseyMode?.boardController;
            if (!bc?.cameraController) return false;
            const pos = ${JSON.stringify(position)};
            bc.cameraController.setCurrentPosition(pos);
            bc.cameraController.updateFollowPosition?.({ position: pos, direct: ${direct ? 'true' : 'false'} });
            const blendState = bc.environmentManager?.getBlendState(pos) || null;
            bc.environmentManager?.updateVisibility(pos, { mode: 'progress', blendState });
            bc.environmentManager?.updateGlobalEnvironment(pos, blendState);
            const audioState = null;
            const directorState = bc.director?.update?.(1 / 60, { ascentProgress: pos, audio: audioState, blendState })
                || bc.director?.getState?.()
                || null;
            bc.cameraController?.setDirectorState?.(directorState);
            bc.nodeManager?.setCameraProgress(pos);
            bc.nodeManager?.update(1 / 60, directorState?.node?.focalPulse ?? 0);
            bc.atmosphere?.update(bc.camera, directorState);
            bc.environmentManager?.update(1 / 60, bc.camera, pos, directorState);
            bc.pathRenderer?.update?.(1 / 60, directorState);
            bc.thresholdDirector?.update?.(1 / 60, bc.camera, directorState);
            bc.renderOnce?.(1 / 60);
            return true;
        })();
    `);
    await execute(win, HIDE_OVERLAYS);
    await delay(settleMs);
    await execute(win, HIDE_OVERLAYS);
}

async function capturePng(win, filename, metrics = {}) {
    const image = await win.webContents.capturePage();
    await writeFile(path.join(ARTIFACT_DIR, filename), image.toPNG());
    await writeFile(
        path.join(ARTIFACT_DIR, filename.replace(/\.png$/, '.json')),
        JSON.stringify(metrics, null, 2),
        'utf8',
    );
    console.log(`[chapter-capture] wrote ${filename}`);
}

async function collectMetrics(win, extra = {}) {
    return execute(win, `
        (() => {
            const bc = window.odysseyMode?.boardController;
            const director = bc?.director?.getState?.() || null;
            const info = bc?.renderer?.info || {};
            return {
                ...${JSON.stringify(extra)},
                timestamp: new Date().toISOString(),
                qualityName: bc?.qualityName ?? null,
                backend: bc?.isWebGPU ? 'webgpu' : (bc?.isWebGL ? 'webgl2' : 'unknown'),
                pixelRatio: bc?.renderer?.getPixelRatio?.() ?? null,
                canvas: {
                    width: bc?.renderer?.domElement?.width ?? null,
                    height: bc?.renderer?.domElement?.height ?? null,
                    clientWidth: bc?.renderer?.domElement?.clientWidth ?? null,
                    clientHeight: bc?.renderer?.domElement?.clientHeight ?? null,
                },
                currentPosition: bc?.cameraController?.getCurrentPosition?.() ?? null,
                activeChapter: director?.activeChapter ?? null,
                boundaryId: director?.boundaryId ?? null,
                inSeam: director?.inSeam ?? null,
                seamProgress: director?.seamProgress ?? null,
                loadedChapters: [...(bc?.environmentManager?.environments?.keys?.() || [])].sort((a, b) => a - b),
                debugOverlayPresent: !!document.getElementById('odyssey-aaa-debug-overlay'),
                render: {
                    drawCalls: info.render?.drawCalls ?? null,
                    calls: info.render?.calls ?? null,
                    triangles: info.render?.triangles ?? null,
                    gpuMs: info.render?.timestamp ?? null,
                },
                memory: {
                    geometries: info.memory?.geometries ?? null,
                    textures: info.memory?.textures ?? null,
                },
            };
        })();
    `);
}

function resolveChapterRange(chapterPositions, chapterId) {
    const start = chapterPositions[chapterId - 1];
    const end = chapterPositions[chapterId] ?? 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error(`Invalid chapter range for chapter ${chapterId}.`);
    }
    return { start, end };
}

async function captureChapter(win, boot) {
    const range = resolveChapterRange(boot.chapterPositions, CHAPTER);
    const samples = Array.from({ length: FRAME_COUNT }, (_, index) => (
        FRAME_COUNT === 1 ? 0 : index / (FRAME_COUNT - 1)
    ));

    for (let index = 0; index < samples.length; index += 1) {
        const localProgress = samples[index];
        const position = range.start + ((range.end - range.start) * localProgress);
        await settleAtPosition(win, position);
        const metrics = await collectMetrics(win, {
            mode: 'chapter',
            chapter: CHAPTER,
            chapterName: CHAPTER_NAMES[CHAPTER],
            localProgress,
            requestedPosition: position,
            frameIndex: index + 1,
            frameCount: samples.length,
        });
        const filename = [
            `chapter-${String(CHAPTER).padStart(2, '0')}`,
            String(index + 1).padStart(2, '0'),
            `local-${String(Math.round(localProgress * 1000)).padStart(4, '0')}.png`,
        ].join('-');
        await capturePng(win, filename, metrics);
    }

    const burstLocalProgress = Number.isFinite(Number.parseFloat(args.burstLocal))
        ? Number.parseFloat(args.burstLocal)
        : 0.6;
    const clampedBurstLocal = Math.min(1, Math.max(0, burstLocalProgress));
    const burstPosition = range.start + ((range.end - range.start) * clampedBurstLocal);
    await settleAtPosition(win, burstPosition, { settleMs: 250 });
    for (let index = 0; index < 3; index += 1) {
        if (index > 0) await delay(500);
        const metrics = await collectMetrics(win, {
            mode: 'motion-burst',
            chapter: CHAPTER,
            chapterName: CHAPTER_NAMES[CHAPTER],
            localProgress: burstLocalProgress,
            requestedPosition: burstPosition,
            burstIndex: index + 1,
        });
        const filename = [
            `chapter-${String(CHAPTER).padStart(2, '0')}`,
            `motion-${String(index + 1).padStart(2, '0')}.png`,
        ].join('-');
        await capturePng(win, filename, metrics);
    }
}

async function startFrameSamplerAndPan(win, start, end, durationMs) {
    await settleAtPosition(win, start, { settleMs: 250 });
    return execute(win, `
        (() => {
            const bc = window.odysseyMode?.boardController;
            if (!bc?.cameraController) return false;
            const sampler = {
                active: true,
                frames: [],
                startedAt: performance.now(),
                lastAt: 0,
                done: false,
            };
            window.__odysseyWaveVSeamSampler = sampler;
            const tick = (now) => {
                if (!sampler.active) return;
                if (sampler.lastAt > 0) sampler.frames.push(now - sampler.lastAt);
                sampler.lastAt = now;
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            bc.cameraController.panToPosition(${JSON.stringify(end)}, ${JSON.stringify(durationMs)})
                .finally(() => {
                    sampler.done = true;
                    sampler.endedAt = performance.now();
                });
            return true;
        })();
    `);
}

async function stopFrameSampler(win) {
    return execute(win, `
        (() => {
            const sampler = window.__odysseyWaveVSeamSampler || null;
            if (!sampler) return null;
            sampler.active = false;
            const frames = sampler.frames.filter((value) => Number.isFinite(value) && value > 0 && value < 2000);
            const maxFrameMs = frames.length ? Math.max(...frames) : null;
            const avgFrameMs = frames.length
                ? frames.reduce((sum, value) => sum + value, 0) / frames.length
                : null;
            return {
                frameCount: frames.length,
                maxFrameMs,
                avgFrameMs,
                over33ms: frames.filter((value) => value > 33).length,
                over50ms: frames.filter((value) => value > 50).length,
                firstSamples: frames.slice(0, 20),
                done: sampler.done,
                elapsedMs: (sampler.endedAt || performance.now()) - sampler.startedAt,
            };
        })();
    `);
}

async function captureSeam(win, boot) {
    const boundary = boot.chapterPositions[SEAM.source];
    if (!Number.isFinite(boundary)) {
        throw new Error(`Invalid seam boundary for ${SEAM.source}-${SEAM.target}.`);
    }
    const halfWidth = Number.isFinite(Number.parseFloat(args.seamWidth))
        ? Number.parseFloat(args.seamWidth)
        : 0.04;
    const start = Math.max(0, boundary - halfWidth);
    const end = Math.min(1, boundary + halfWidth);
    const durationMs = Math.max(
        800,
        Number.parseInt(args.duration || process.env.ODYSSEY_CAPTURE_SEAM_DURATION || '3000', 10),
    );
    const defaultOffsets = '0,300,600,850,1200,1800,2600,3200';
    const offsets = String(args.offsets || process.env.ODYSSEY_CAPTURE_SEAM_OFFSETS || defaultOffsets)
        .split(',')
        .map((entry) => Number.parseInt(entry.trim(), 10))
        .filter((entry) => Number.isFinite(entry) && entry >= 0)
        .sort((left, right) => left - right);

    await startFrameSamplerAndPan(win, start, end, durationMs);
    const startedAt = Date.now();
    for (const offset of offsets) {
        const waitMs = Math.max(0, startedAt + offset - Date.now());
        if (waitMs > 0) await delay(waitMs);
        await execute(win, HIDE_OVERLAYS);
        const metrics = await collectMetrics(win, {
            mode: 'seam',
            seam: `${SEAM.source}-${SEAM.target}`,
            atMs: offset,
            boundaryPosition: boundary,
            startPosition: start,
            endPosition: end,
            durationMs,
        });
        const filename = `seam-${SEAM.source}-${SEAM.target}-${String(offset).padStart(4, '0')}ms.png`;
        await capturePng(win, filename, metrics);
    }

    await delay(Math.max(0, durationMs + 300 - (Date.now() - startedAt)));
    const seamMetrics = await stopFrameSampler(win);
    await writeFile(
        path.join(ARTIFACT_DIR, `seam-${SEAM.source}-${SEAM.target}-frame-metrics.json`),
        JSON.stringify({
            seam: `${SEAM.source}-${SEAM.target}`,
            boundaryPosition: boundary,
            startPosition: start,
            endPosition: end,
            durationMs,
            ...seamMetrics,
        }, null, 2),
        'utf8',
    );
}

async function run() {
    if (!KEEP_EXISTING) {
        await rm(ARTIFACT_DIR, { recursive: true, force: true });
    }
    await mkdir(ARTIFACT_DIR, { recursive: true });

    let serverAlreadyUp = false;
    try { serverAlreadyUp = (await fetch(BASE_URL)).ok; } catch { serverAlreadyUp = false; }
    if (serverAlreadyUp) {
        console.log(`[chapter-capture] using existing dev server at ${BASE_URL}`);
    } else {
        devServerProcess = startDevServer();
    }
    await waitForServer(BASE_URL);

    const win = createWindow();
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleLines.push(`[renderer:${level}] ${sourceId}:${line} ${message}`);
    });

    const url = makeUrl();
    console.log(`[chapter-capture] loading ${url}`);
    await win.loadURL(url);
    const boot = await bootstrapOdyssey(win);
    if (!boot?.ok) throw new Error(`Bootstrap failed: ${boot?.reason}`);
    console.log(
        `[chapter-capture] ready mode=${MODE} quality=${boot.qualityName} backend=${boot.backend} `
        + `pixelRatio=${boot.pixelRatio} loaded=${boot.loadedChapters.join(',')}`,
    );

    await writeFile(
        path.join(ARTIFACT_DIR, 'capture-manifest.json'),
        JSON.stringify({
            mode: MODE,
            chapter: CHAPTER,
            seam: SEAM ? `${SEAM.source}-${SEAM.target}` : null,
            targetChapters: TARGET_CHAPTERS,
            quality: QUALITY,
            backend: BACKEND_LABEL,
            frameCount: FRAME_COUNT,
            viewport: { width: WIDTH, height: HEIGHT },
            urlFlags: Object.fromEntries(new URL(url).searchParams.entries()),
            boot,
        }, null, 2),
        'utf8',
    );

    if (MODE === 'seam') {
        await captureSeam(win, boot);
    } else {
        await captureChapter(win, boot);
    }

    await writeFile(path.join(ARTIFACT_DIR, 'console.log'), consoleLines.slice(-500).join('\n'), 'utf8');
    win.destroy();
}

// Force the discrete GPU (RTX 5080) like electron/main.js:46 — this capture script is its own
// Electron main, so it must set the switch itself. Without it a heavy 2-chapter seam capture can
// fall back to the iGPU and TDR-bluescreen the machine.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
    try {
        await run();
        await stopDevServer();
        app.quit();
    } catch (error) {
        console.error('[chapter-capture] FAILED:', error?.message || error);
        if (consoleLines.length) console.error(consoleLines.slice(-40).join('\n'));
        await stopDevServer();
        app.exit(1);
    }
});

app.on('window-all-closed', () => {
    stopDevServer().finally(() => app.quit());
});
