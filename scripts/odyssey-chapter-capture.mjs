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
// PHASE LOCK. Without it this harness is not comparable run to run: every animated uniform
// rides `boardController.time`, which advances with wall clock, so the same station sampled
// twice shows a different frame of lava, ember and haze animation. Measured 2026-08-12 with
// functionally identical code, the value-structure metric moved 0.233 -> 0.793 at one station
// between runs — larger than any art change being evaluated. `--time 9` freezes the clock the
// way the playground's `?t=` does, which is what makes an A/B mean anything.
const FIXED_TIME = Number.isFinite(Number.parseFloat(args.time ?? process.env.ODYSSEY_CAPTURE_TIME))
    ? Number.parseFloat(args.time ?? process.env.ODYSSEY_CAPTURE_TIME)
    : null;
/**
 * Extra frozen clocks to re-shoot each station at, camera untouched — `--times 9,40,90`.
 * Their purpose is motion evidence, so they are deliberately NOT a substitute for `--time`:
 * the station's own frame still uses that, and these are additional.
 */
const EXTRA_TIMES = String(args.times || '')
    .split(',')
    .map((token) => Number.parseFloat(token))
    .filter((value) => Number.isFinite(value));
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
    // Repeated options ACCUMULATE into an array instead of last-one-wins. This bug produced a
    // silently wrong measurement: `--url-flag odysseyOneWorld=1 --url-flag odysseyWorldNoClouds=1`
    // dropped the first flag, the capture booted the LEGACY path, and its success was read as a
    // clean bisect of the One World boot stall — the manifest's urlFlags list was the only tell.
    const store = (key, value) => {
        if (result[key] === undefined) result[key] = value;
        else result[key] = [].concat(result[key], value);
    };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const raw = token.slice(2);
        const [key, inlineValue] = raw.split('=', 2);
        const normalized = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        const next = argv[index + 1];
        if (inlineValue !== undefined) {
            store(normalized, inlineValue);
        } else if (next && !next.startsWith('--')) {
            store(normalized, next);
            index += 1;
        } else {
            store(normalized, true);
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
        {
            cwd: ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
            // Isolated dep cache — see vite.config.js cacheDir: a harness server sharing
            // node_modules/.vite with an interactive one corrupts the optimizer for both.
            env: { ...process.env, FORCE_COLOR: '0', VITE_CACHE_DIR: `node_modules/.vite-harness-${PORT}` },
        },
    );
    proc.stdout.on('data', (chunk) => consoleLines.push(String(chunk)));
    proc.stderr.on('data', (chunk) => consoleLines.push(String(chunk)));
    return proc;
}

/**
 * Kill a spawned dev server AND ITS CHILDREN.
 *
 * On Windows the server is `cmd.exe /d /s /c npm.cmd run dev ...`, so `proc.kill()` reaps
 * the cmd wrapper and leaves node/Vite holding the port. The next `--strictPort` run then
 * dies with "dev server did not start in 90s", which reads as a harness bug rather than as
 * the leak it is; the 2026-08-12 Act I measurement session lost three runs to exactly this
 * before the orphans were swept by hand. `taskkill /T` walks the tree.
 */
function killProcessTree(proc) {
    if (!proc || proc.killed || !proc.pid) return;
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
            proc.kill('SIGKILL');
        }
        return;
    }
    proc.kill('SIGTERM');
}

async function stopDevServer() {
    if (!devServerProcess) return;
    const proc = devServerProcess;
    devServerProcess = null;
    if (!proc.killed) {
        killProcessTree(proc);
        await delay(800);
        if (!proc.killed && process.platform !== 'win32') proc.kill('SIGKILL');
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
        // SELECTOR LISTS GO STALE; GEOMETRY DOES NOT. The named list above missed whatever
        // shows the mode cards at journey position 0, so EVERY run's first station captured
        // the main menu over the board — and its value metrics were mostly UI, which silently
        // polluted six phase-locked A/Bs before anyone looked at the image. Sweep by geometry
        // instead: anything positioned, outside the board container, that covers a meaningful
        // slice of the viewport is chrome by definition in a capture.
        // THE DECISIVE SWEEP: hide every top-level subtree that does NOT contain the board.
        // Selector lists and position-based heuristics both missed the mode-card menu (it is
        // laid out in normal flow inside a full-page wrapper), so six A/B runs measured UI.
        // Containment is the only property that cannot go stale: exactly one subtree holds the
        // canvas we came to photograph; everything else is chrome.
        const boardEl = document.querySelector('#odyssey-board-3d')
            || document.querySelector('canvas#odyssey-board-canvas')
            || document.querySelector('#odyssey-board-3d canvas');
        if (boardEl) {
            Array.from(document.body.children).forEach((child) => {
                if (child.contains(boardEl)) return;
                if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') return;
                hideElement(child);
            });
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        document.querySelectorAll('body *').forEach((element) => {
            if (element.closest('#odyssey-board-3d')) return;
            if (element.tagName === 'CANVAS') return;
            const computed = window.getComputedStyle(element);
            if (computed.position !== 'fixed' && computed.position !== 'absolute') return;
            if (computed.display === 'none' || computed.visibility === 'hidden') return;
            const rect = element.getBoundingClientRect();
            if (rect.width < 40 || rect.height < 40) return;
            const covered = (Math.min(rect.right, vw) - Math.max(rect.left, 0))
                * (Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
            if (covered <= 0) return;
            if (covered / (vw * vh) < 0.01) return;
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
            // Freeze the animation clock BEFORE the render so every uniform driven off
            // bc.time resolves to the same phase on every run; delta 0 keeps it frozen.
            const fixedTime = ${FIXED_TIME === null ? 'null' : FIXED_TIME};
            if (fixedTime !== null) {
                bc.time = fixedTime;
                bc.renderOnce?.(0);
            } else {
                bc.renderOnce?.(1 / 60);
            }
            return true;
        })();
    `);
    await execute(win, HIDE_OVERLAYS);
    await delay(settleMs);
    await execute(win, HIDE_OVERLAYS);
}

/**
 * Advance ONLY the animation clock and re-render, leaving the camera untouched.
 *
 * THE INSTRUMENT MOTION VERIFICATION NEEDED, and the reason it did not exist is worth
 * recording. Comparing two captures from two RUNS cannot show motion of a few tens of world
 * units: measured 2026-08-14, the same station in the same build at the same `--time` differs
 * in 23.6 % of ground-band pixels. Nor can `--time` be varied across runs, because it also
 * feeds the director's focal pulse — so the camera moves too, and an "obvious" cloud drift
 * turned out to be camera breathing.
 *
 * Re-rendering inside ONE session removes the cross-run noise floor — same window, same
 * pipeline state — and `settleAtPosition` is deliberately NOT re-run.
 *
 * ⚠️ IT DOES NOT PIN THE CAMERA, despite the stubs below trying to. `renderFrame` re-poses the
 * camera from the director and the director's focal pulse reads `bc.time`, so advancing the
 * clock moves the view as well as the content. MEASURED: with every cloud animation set to
 * zero, silhouette area still varied 21.55 % across three clocks. So this probe CANNOT be
 * used to prove that something moved by comparing one clock against another.
 *
 * What it CAN do, and what it was worth building for, is a PAIRED comparison: shoot the same
 * clocks twice with a feature on and off. The camera behaves identically in both arms, so the
 * difference between the arms is the feature. That is how the cloud drift was evidenced
 * (sky changed +12 points with clouds present; the bare-rock control was identical).
 */
async function renderAtTime(win, time) {
    await execute(win, `
        (() => {
            const bc = window.odysseyMode?.boardController;
            if (!bc) return false;
            // ⚠️ THE CAMERA MUST BE PINNED, or this probe measures the camera.
            // renderFrame() calls cameraController.update() and re-applies the director state,
            // and the director's focal pulse is a function of bc.time — so simply advancing
            // the clock and re-rendering moves the FOV. Measured before pinning: a "static"
            // bare-rock control changed 9-30 % of its pixels between two clocks, which is the
            // camera, not the rock. Neutralising both entry points for the duration of the
            // render leaves the clock as the only thing that changed.
            const cc = bc.cameraController;
            const savedUpdate = cc && cc.update;
            const savedSetDirector = cc && cc.setDirectorState;
            if (cc) { cc.update = () => {}; cc.setDirectorState = () => {}; }
            try {
                bc.time = ${time};
                // ADVANCE THE WORLD EXPLICITLY. renderFrame only calls oneWorld.update()
                // inside its runPositionWork block, which is THROTTLED once the camera is
                // settled -- so setting bc.time and re-rendering can leave the world's own
                // uTime uniform exactly where it was, with every time-driven cloud term
                // frozen. Not subtle: a probe with the drift amplitude cranked to 3000 world
                // units produced almost no movement, which reads as "the feature is broken"
                // when it is really "the clock never reached it". Re-driving with the SAME
                // rail point and progress changes nothing except the clock.
                // (No backticks in this comment: the whole block is injected through a
                // template literal and a backtick here terminates it.)
                const st = bc.oneWorld && bc.oneWorld.state;
                if (bc.oneWorld && st && st.lodCenter) {
                    bc.oneWorld.update(
                        bc.time,
                        { x: st.lodCenter.x, y: 0, z: st.lodCenter.z },
                        st.actT,
                        bc.camera && bc.camera.position ? bc.camera.position.y : null,
                    );
                }
                bc.renderOnce?.(0);
            } finally {
                if (cc) { cc.update = savedUpdate; cc.setDirectorState = savedSetDirector; }
            }
            return true;
        })();
    `);
    await execute(win, `new Promise((r) => requestAnimationFrame(
        () => requestAnimationFrame(() => setTimeout(r, 90)),
    ))`).catch(() => {});
    return true;
}

async function capturePng(win, filename, metrics = {}) {
    // HIDE IMMEDIATELY BEFORE THE SHUTTER. Sweeping during `settleAtPosition` is not enough:
    // `#start-modal` re-shows itself asynchronously while the mode finishes activating, which
    // is after the settle sweep and before the first frame is photographed. That is why
    // station 1 — and ONLY station 1 — carried the main menu in every run, quietly turning its
    // value metrics into a measurement of UI.
    await execute(win, HIDE_OVERLAYS).catch(() => {});
    // AND GIVE THE COMPOSITOR TIME TO ACT ON IT. `capturePage()` returns the last composited
    // frame, so a DOM change made microseconds earlier is not in it — which is why hiding the
    // modal at the shutter still photographed the modal. Two rAFs plus a short settle is the
    // difference between changing the page and photographing the changed page.
    await execute(win, `new Promise((r) => requestAnimationFrame(
        () => requestAnimationFrame(() => setTimeout(r, 120)),
    ))`).catch(() => {});
    const image = await win.webContents.capturePage();
    await writeFile(path.join(ARTIFACT_DIR, filename), image.toPNG());
    await writeFile(
        path.join(ARTIFACT_DIR, filename.replace(/\.png$/, '.json')),
        JSON.stringify({ ...metrics, ...frameLuma(image) }, null, 2),
        'utf8',
    );
    console.log(`[chapter-capture] wrote ${filename}`);
}

/**
 * MEAN FRAME LUMA, recorded into every sidecar.
 *
 * The Act II -> Space transition is judged on how the frame's brightness travels across the
 * seam (docs/ODYSSEY_ACT2_TO_SPACE_TRANSITION_PLAN_2026-08.md §1): the shipped defect is that
 * 74% of the change lands in the final third of the window, ending in a single -89 luma step
 * where the One World act gate flips. That is a property of the PIXELS, so it has to be
 * measured from them — and the harness is the only place that already holds a decoded bitmap,
 * which is why this lives here rather than in a separate analyser that would need a PNG
 * decoder Node does not ship.
 *
 * Rec.709 luma on the raw BGRA bitmap, subsampled on a fixed stride: this is a curve-shape
 * metric across frames, not a colourimetric measurement, and the stride keeps it free.
 */
function frameLuma(image) {
    try {
        const { width, height } = image.getSize();
        if (!width || !height) return { meanLuma: null };
        const buf = image.toBitmap(); // BGRA
        const stride = 4 * 4; // every 4th pixel
        let sum = 0;
        let n = 0;
        for (let i = 0; i + 3 < buf.length; i += stride) {
            sum += 0.0722 * buf[i] + 0.7152 * buf[i + 1] + 0.2126 * buf[i + 2];
            n += 1;
        }
        return { meanLuma: n ? Number((sum / n).toFixed(3)) : null, lumaSamples: n };
    } catch (error) {
        return { meanLuma: null, lumaError: String(error && error.message) };
    }
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
                // WHAT IS ACTUALLY ON SCREEN. A capture that shows an unexpected surface
                // used to leave only speculation about which object drew it — the Act I
                // plan's Phase 0 logged a "cloud deck renders underwater" defect that was
                // really the steam quench doing its job. These three blocks make the frame
                // self-describing: what the world believes, which act-edge volume is live,
                // and the visible-mesh roster (traverseVisible already honours the whole
                // parent chain, so this is the drawn set, not the authored set).
                world: {
                    present: !!bc?.oneWorld,
                    groupVisible: bc?.oneWorld?.group?.visible ?? null,
                    submerged: bc?.oneWorld?.state?.submerged ?? null,
                    scriptName: bc?.oneWorld?.state?.scriptName ?? null,
                    actT: bc?.oneWorld?.state?.actT ?? null,
                    // The clipmap's rings are square and centred HERE, not on the eye. Without
                    // both of these a straight line in a capture cannot be tested against a
                    // ring boundary, which is the one question the deck's remaining defect
                    // class keeps asking.
                    lodCenter: bc?.oneWorld?.state?.lodCenter
                        ? { ...bc.oneWorld.state.lodCenter }
                        : null,
                },
                // WHERE THE FRAME WAS SHOT FROM. Every geometric read of a capture — "is that
                // line the deck's rim or a ring edge", "is the eye inside the billow band" —
                // needs the eye and the look direction, and both were being re-derived by hand
                // from the plan's notes one station at a time.
                camera: (() => {
                    const cam = bc?.camera;
                    if (!cam) return null;
                    const dir = new (cam.position.constructor)();
                    cam.getWorldDirection(dir);
                    return {
                        x: +cam.position.x.toFixed(2),
                        y: +cam.position.y.toFixed(2),
                        z: +cam.position.z.toFixed(2),
                        dirX: +dir.x.toFixed(4),
                        dirY: +dir.y.toFixed(4),
                        dirZ: +dir.z.toFixed(4),
                        fov: cam.fov ?? null,
                    };
                })(),
                occluders: {
                    steamQuenchVisible: bc?.steamQuench?.mesh?.visible ?? null,
                    cloudBankVisible: bc?.cloudBank?.mesh?.visible ?? null,
                },
                visibleMeshes: (() => {
                    const names = [];
                    bc?.scene?.traverseVisible?.((o) => {
                        if (!(o.isMesh || o.isInstancedMesh || o.isSprite)) return;
                        // UNNAMED MESHES ARE NOT INVISIBLE, they are just invisible to THIS.
                        // The ch6 void-sky backstop paints the entire frame during the 5->6
                        // summit ignite and never appeared in this roster, so a capture that
                        // asked "what is drawing my sky" got an answer with the culprit
                        // missing. Fall back to a geometry+material description so an unnamed
                        // mesh is still accounted for rather than silently dropped.
                        // NOTE the concatenation: this whole block is injected through a
                        // template literal, so a nested backtick template here terminates the
                        // OUTER one and the page silently receives a syntax error.
                        names.push(o.name || ('<unnamed ' + (o.geometry?.type || '?') + ' '
                            + (o.material?.type || '?') + '>'));
                    });
                    const counts = {};
                    names.forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
                    return counts;
                })(),
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
    // NAMED STATIONS BEAT AN EVEN SPREAD when you are bisecting rather than surveying. The
    // even spread is what a review sheet wants; a bisect wants THE SAME p as the run it is
    // being compared against, and reaching one specific p through `--frames` alone meant
    // choosing a frame count whose spread happened to land on it. `--locals 0.44,0.55` takes
    // local progresses directly, and `--burst 0` drops the three motion frames, which halves
    // the shots per run — the TDR law's whole concern.
    const requested = String(args.locals || '')
        .split(',')
        .map((token) => Number.parseFloat(token))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
    const samples = requested.length ? requested : Array.from({ length: FRAME_COUNT }, (_, index) => (
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

        // `--times 9,40,90` shoots the SAME station at several frozen clocks without touching
        // the camera — the only way this harness can evidence motion (see renderAtTime).
        for (let t = 0; t < EXTRA_TIMES.length; t += 1) {
            await renderAtTime(win, EXTRA_TIMES[t]);
            await capturePng(win, filename.replace(/\.png$/, `-t${EXTRA_TIMES[t]}.png`), {
                ...metrics, motionProbeTime: EXTRA_TIMES[t],
            });
        }
    }

    if (String(args.burst ?? '1') === '0') return;
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
    // ── SEAM SAMPLING IS BY POSITION, NOT BY WALL CLOCK ──────────────────────────
    //
    // THE OLD SCHEME NEVER SAMPLED THE SEAM (measured 2026-08-13, and it invalidates
    // every prior seam assessment). It started a `panToPosition(end, 3000)` and then
    // shuttered at wall-clock offsets 0,300,600,…  But one shutter — HIDE_OVERLAYS +
    // collectMetrics + capturePage over IPC — costs far more than the ~300 ms between
    // those offsets, so the schedule slipped past the whole 3 s pan: the recorded
    // `currentPosition` went 0.05301 at the first shutter and **0.13249 at the second**,
    // i.e. the camera had already teleported past the p=0.093 boundary, and every later
    // frame re-shot the far side. `inSeam` was false in all eight samples. The pan logic
    // itself is fine — it animates correctly in a live browser; it is the *shutter
    // schedule* that cannot keep a deadline.
    //
    // So the seam is now sampled the way chapter stations already are, and those work:
    // pin an explicit position, settle it, shoot it. Deterministic, reproducible, and
    // independent of how slow a capture round-trip happens to be. Offsets are expressed
    // as PROGRESS values; `--offsets` still overrides them, now in p.
    const defaultStations = [
        boundary - 0.030, // the act gate opens here today (margin 0.03) — the leak point
        boundary - 0.020,
        boundary - 0.010,
        boundary - 0.006, // quench plateau opens (~p 0.0874 for the 1→2 seam)
        boundary,
        boundary + 0.004, // quench plateau closes (~p 0.0970)
        boundary + 0.010,
        boundary + 0.020,
        boundary + 0.030, // Earth Core's dissolve is still running out here
    ];
    const stations = String(args.offsets || process.env.ODYSSEY_CAPTURE_SEAM_OFFSETS || '')
        .split(',')
        .map((entry) => Number.parseFloat(entry.trim()))
        .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1);
    const seamStations = (stations.length ? stations : defaultStations)
        .map((entry) => Math.min(1, Math.max(0, entry)))
        .sort((left, right) => left - right);

    for (const stationPosition of seamStations) {
        await settleAtPosition(win, stationPosition, { settleMs: 260 });
        const metrics = await collectMetrics(win, {
            mode: 'seam',
            seam: `${SEAM.source}-${SEAM.target}`,
            stationPosition,
            boundaryPosition: boundary,
            startPosition: start,
            endPosition: end,
        });
        const tag = stationPosition.toFixed(4).replace('.', 'p');
        const filename = `seam-${SEAM.source}-${SEAM.target}-${tag}.png`;
        await capturePng(win, filename, metrics);
    }

    // The frame-time sample still wants a real moving camera, so it keeps the pan — but
    // it runs AFTER the stills, on its own, where a slipped schedule costs nothing.
    await startFrameSamplerAndPan(win, start, end, durationMs);
    await delay(durationMs + 300);
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
            fixedTime: FIXED_TIME,
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
