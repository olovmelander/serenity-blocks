/**
 * Reproducible Chiral Gold visual smoke captures, using the shipped scene/event path.
 * Run: node scripts/chiral-gold-visual-validation.mjs playground|theme|game [--native] [--mobile] [--low]
 * Target one reaction: --event lock|clear|combo --event-age 0.42 --lock-x 0 --lock-y 16
 * Inspect its lifecycle: --event combo --timeline --output-dir reports/chiral-gold-followup
 * `game` keeps the real single-player board/HUD visible; its gameplay simulation is frozen.
 * Supply PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE when Playwright is not installed locally.
 * Software GPU captures establish render correctness, not physical-device frame rates.
 */
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PerspectiveCamera, Vector3 } from 'three';

const argv = process.argv.slice(2);
const args = new Set(argv);
const option = (name, fallback) => {
    const inline = argv.find((value) => value.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = argv.indexOf(name);
    if (index < 0) return fallback;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
    return value;
};
const numeric = (name, fallback, minimum, maximum) => {
    const value = Number(option(name, fallback));
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    }
    return value;
};
if (args.has('--help')) {
    console.log(`Usage: node scripts/chiral-gold-visual-validation.mjs playground|theme|game [options]
  --native                 Validate WebGPU instead of forced WebGL2
  --mobile                 Emulate a 390x844 touch viewport (also selects Low)
  --low                    Select Low quality
  --no-post                Disable postprocessing for material inspection
  --output-dir <path>      Save captures in this directory
  --label <name>           Add a filename label to preserve positional variants
  --image-format <format>  Save png or jpeg (JPEG quality 90; default png)
  --event <name>           Capture idle, lock, clear or combo in isolation
  --event-age <seconds>    Capture this long after the event (default 0.42)
  --timeline               Capture impact, crest, tail and recovery phases
  --lock-x <column>        Locked piece column, 0..6 (default 3)
  --lock-y <row>           Locked piece row, 0..19 (default 16)
  --line-count <count>     Clear 1..4 rows; four rows use the tetris reaction
  --board                  Add the playground's board-shaped composition guide
  --help                   Print this help without starting a browser`);
    process.exit(0);
}
const mode = args.has('playground') ? 'playground' : (args.has('game') ? 'game' : 'theme');
const native = args.has('--native');
const mobile = args.has('--mobile');
const quality = args.has('--low') || mobile ? 'Low' : 'High';
const label = option('--label', null);
if (label && !/^[a-z0-9-]+$/i.test(label)) throw new Error('--label may contain only letters, digits and hyphens');
const prefix = `${mode}-${native ? 'webgpu' : 'webgl2'}-${mobile ? 'phone' : 'desktop'}-${quality.toLowerCase()}${label ? `-${label}` : ''}`;
const artifactDir = path.resolve(option('--output-dir', 'reports/chiral-gold-overhaul'));
const selectedEvent = option('--event', null);
if (selectedEvent && !['idle', 'lock', 'clear', 'combo'].includes(selectedEvent)) {
    throw new Error('--event must be idle, lock, clear or combo');
}
const eventAge = numeric('--event-age', 0.42, 0, 10);
const lockX = Math.round(numeric('--lock-x', 3, 0, 6));
const lockY = Math.round(numeric('--lock-y', 16, 0, 19));
const lineCount = Math.round(numeric('--line-count', 4, 1, 4));
const timeline = args.has('--timeline');
const imageFormat = option('--image-format', 'png');
if (!['png', 'jpeg'].includes(imageFormat)) throw new Error('--image-format must be png or jpeg');
const phases = timeline ? [
    { name: 'impact', age: 0.12 }, { name: 'crest', age: 0.42 },
    { name: 'tail', age: 1.1 }, { name: 'recovery', age: 2.6 },
] : [{ name: null, age: eventAge }];
const validationName = `${prefix}${selectedEvent ? `-${selectedEvent}` : ''}${timeline ? '-timeline'
    : (selectedEvent ? `-${String(eventAge).replace('.', 'p')}s` : '')}-validation.json`;
// Match getOriginFromPiece's fixed-board fallback for the four-wide I lock payload.
// Playground receives world coordinates, while --lock-x/--lock-y remain board cells.
function playgroundLockOrigin(width, height) {
    const camera = new PerspectiveCamera(64, width / height, 1, 10000);
    camera.position.set(Math.sin(8 * 0.025) * 12, Math.sin(8 * 0.023) * 8, 1520);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const point = new Vector3(-0.20 + ((lockX + 2) / 9) * 0.40,
        0.36 - ((lockY + 0.5) / 19) * 0.72, 0.5).unproject(camera);
    const direction = point.sub(camera.position);
    return camera.position.clone().add(direction.multiplyScalar(-camera.position.z / direction.z));
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
await mkdir(artifactDir, { recursive: true });

const bootstrap = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050301}
.background-container,.theme-container{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}
#chiral-gold-theme{z-index:0!important;transition:none!important;opacity:1!important;visibility:visible!important}
canvas{display:block}</style></head><body><div class="background-container"></div>
<script type="module">
import ChiralGoldTheme from '/src/themes/chiral-gold/chiral-gold-theme.js';
import {eventBus, EVENTS} from '/src/events/event-bus.js';
window.settings={effectQuality:${JSON.stringify(quality)},graphicsQuality:${JSON.stringify(quality)},
backgroundComboEffects:true,targetFrameRate:60};
const theme=new ChiralGoldTheme();
window.__CHIRAL_THEME__=theme;
window.__CHIRAL_EVENT__=(name,payload)=>eventBus.emit(EVENTS[name],payload);
await theme.init();
await theme.start({loadTheme(){}});
theme.cancelAnimationLoop();
theme.shouldRenderFrame=()=>true;
theme.clock.getDelta=()=>1/60;
theme.time=8;
window.__CHIRAL_READY__=true;
</script></body></html>`;

const server = await createServer({
    cacheDir: path.join(tmpdir(), `serenity-chiral-gold-vite-cache-${process.pid}`),
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
    plugins: [{
        name: 'chiral-gold-capture-shell',
        configureServer(viteServer) {
            viteServer.middlewares.use('/__chiral-gold-validation.html', (_request, response) => {
                response.setHeader('Content-Type', 'text/html');
                response.end(bootstrap);
            });
        },
    }],
});
let browser;
let page;
const errors = [];
const warnings = [];
const snapshots = [];
let teardown = null;
let failure = null;
let currentEvent = null;
let currentEventAge = null;
let lastDiagnostics = null;
let lastReadiness = null;

async function readGameReadiness() {
    return page.evaluate(() => {
        const manager = window.serenityBlocks?.themeManager;
        const theme = manager?.activeTheme;
        return { quality: theme?.currentQualityLevel, active: theme?.isActive, flags: theme?.flags,
            compile: theme?.compileStats, hasSculpture: !!theme?.sculpture,
            lifecycleGeneration: theme?.lifecycleGeneration, manager: {
                activeThemeName: manager?.activeThemeName, pendingThemeName: manager?.pendingThemeName,
                isTransitioning: manager?.isTransitioning, themesSuspended: manager?.themesSuspended,
            }, settings: Object.fromEntries(['effectQuality', 'graphicsQuality', 'renderScale',
                'targetFrameRate', 'backgroundComboEffects', 'backgroundMode', 'backgroundTheme']
                .map((key) => [key, window.settings?.[key]])),
            compute: Object.fromEntries(['dustCompute', 'burstCompute', 'wispCompute']
                .map((key) => [key, theme?.[key] ? { ready: theme[key].ready, report: theme[key].compileReport } : null])) };
    });
}

async function step(frames) {
    await page.evaluate(async (count) => {
        const theme = window.__CHIRAL_THEME__;
        const board = window.serenityBlocks?.gameModeManager?.getCurrentMode()?._getBoardScene?.();
        board?.sys?.game?.loop?.sleep?.();
        const render = theme.renderFrame;
        // Advance real animation, CPU pools and compute; submit one expensive scene draw.
        theme.renderFrame = () => {};
        try {
            for (let frame = 0; frame < count; frame += 1) {
                theme.animate();
                theme.cancelAnimationLoop();
            }
        } finally { theme.renderFrame = render; }
        theme.renderFrame();
        await theme.renderer.backend?.device?.queue.onSubmittedWorkDone();
        theme.renderer.backend?.gl?.finish();
    }, frames);
}

async function capture(state) {
    const diagnostics = await page.evaluate((currentMode) => {
        if (currentMode === 'playground') {
            const api = window.__PLAYGROUND__;
            return { backend: api.backend(), diagnostics: api.diagnostics(),
                viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } };
        }
        const theme = window.__CHIRAL_THEME__;
        return {
            backend: theme.isWebGPU ? 'WebGPU' : 'WebGL2',
            quality: theme.currentQualityLevel,
            flags: theme.flags,
            compile: theme.compileStats,
            compute: Object.fromEntries(['dustCompute', 'burstCompute', 'wispCompute'].map((key) => [key,
                theme[key] ? { ready: theme[key].ready, report: theme[key].compileReport } : null])),
            sculpture: theme.sculpture?.diagnostics?.() || null,
            bursts: theme.burstDebugStats,
            renderInfo: { calls: theme.renderer.info.render.calls, triangles: theme.renderer.info.render.triangles },
            viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
            sceneTime: theme.time,
            gameGpuQueueSettled: currentMode === 'game' ? window.__CHIRAL_GPU_QUEUE_SETTLED__ === true : null,
            gameplay: currentMode === 'game' ? {
                mode: window.serenityBlocks.gameModeManager.getCurrentModeId(),
                running: window.serenityBlocks.gameModeManager.getCurrentMode()?.isRunning,
                boardCanvasCount: document.querySelectorAll('#phaser-game-container canvas').length,
                phaserLoopRunning: window.serenityBlocks.phaserGame?.loop?.running,
            } : null,
        };
    }, mode);
    lastDiagnostics = diagnostics;
    if (native && !diagnostics.backend.startsWith('WebGPU')) {
        throw new Error(`Requested native WebGPU, received ${diagnostics.backend}`);
    }
    if (native && mode !== 'playground' && quality === 'High') {
        const unready = Object.entries(diagnostics.compute).filter(([, value]) => !value?.ready);
        if (unready.length) throw new Error(`Native compute not ready: ${unready.map(([key]) => key).join(', ')}`);
    }
    if (mode === 'game' && (!diagnostics.gameplay.running || diagnostics.gameplay.boardCanvasCount !== 1)) {
        throw new Error(`Game board not ready: ${JSON.stringify(diagnostics.gameplay)}`);
    }
    diagnostics.capture = { event: currentEvent, eventAge: currentEventAge, lockX, lockY, lineCount };
    const name = `${prefix}-${state}`;
    await page.screenshot({ path: path.join(artifactDir, `${name}.${imageFormat === 'jpeg' ? 'jpg' : 'png'}`),
        type: imageFormat, ...(imageFormat === 'jpeg' ? { quality: 90 } : {}), scale: 'css',
        animations: 'disabled', timeout: 60000 });
    snapshots.push({ state, diagnostics });
    await writeFile(path.join(artifactDir, `${name}.json`), JSON.stringify(diagnostics, null, 2));
    console.log(`[ChiralGoldCapture] ${name}: ${diagnostics.backend}`);
}

async function emitEvent(name) {
    await page.evaluate(({ event, x, y, rows }) => {
        if (event === 'lock') {
            window.__CHIRAL_EVENT__('PIECE_LOCK', { piece: { shape: [[1, 1, 1, 1]], x, y } });
        } else if (event === 'clear') {
            window.__CHIRAL_EVENT__('LINE_CLEAR', { lineCount: rows, comboCount: 1,
                clearedRows: Array.from({ length: rows }, (_, index) => 20 - rows + index) });
        } else if (event === 'combo') {
            window.__CHIRAL_EVENT__('COMBO', { comboCount: 8 });
            window.__CHIRAL_EVENT__('LINE_CLEAR', { lineCount: 4, comboCount: 8, clearedRows: [16, 17, 18, 19] });
        }
    }, { event: name, x: lockX, y: lockY, rows: lineCount });
}

async function prepareTheme(origin, params) {
    if (mode === 'theme') {
        await page.goto(`${origin}/__chiral-gold-validation.html?${params}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__CHIRAL_READY__, null, { timeout: 120000 });
        return;
    }
    params.set('skipIntro', '1'); params.set('noThemeWarm', '1'); params.set('themeValidation', '1');
    await page.addInitScript((pinnedQuality) => {
        localStorage.setItem('serenityBlocksSettings', JSON.stringify({
            effectQuality: pinnedQuality, graphicsQuality: pinnedQuality, targetFrameRate: 60,
            backgroundComboEffects: true, backgroundMode: 'Specific', backgroundTheme: 'chiral-gold',
            musicVolume: 0, soundVolume: 0,
        }));
    }, quality);
    await page.goto(`${origin}/?${params}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.serenityBlocks?.isInitialized
        && window.serenityBlocks?.gameModeManager && window.serenityBlocks?.themeManager,
    null, { timeout: 180000 });
    await page.evaluate(async (pinnedQuality) => {
        const app = window.serenityBlocks;
        window.performanceMonitor?.setAdaptiveDownscaleSuppressed?.(true);
        app.settingsManager.update({ effectQuality: pinnedQuality, graphicsQuality: pinnedQuality,
            backgroundComboEffects: true, targetFrameRate: 60 }, false);
        window.settings = app.settingsManager.get();
        const manager = app.themeManager;
        manager.clearAdjacentThemePreloadQueue?.();
        manager.deferAdjacentThemePreload = true;
        manager.queueAdjacentThemePreload = () => {};
        await app.startPostMenuRenderer?.();
        if (app.gameModeManager.getCurrentModeId() !== 'single') await app.gameModeManager.activateMode('single');
        if (!app.gameModeManager.getCurrentMode()?.isRunning) await app.gameModeManager.startCurrentMode({ seed: 1234 });
        app.modalManager?.hideAll?.();
        document.body.classList.remove('start-modal-open');
        app.serenityHub?.hide?.();
        window.settings = app.settingsManager.get();
        await manager.switchTheme('chiral-gold', true);
        if (manager.activeTheme?.currentQualityLevel !== pinnedQuality) {
            // A startup/prewarm scene may have been created before the requested settings.
            manager.disposeThemeInstance(manager.activeTheme, 'chiral-gold', { removeFromCache: true });
            await manager.switchTheme('chiral-gold', true);
        }
        const modeInstance = app.gameModeManager.getCurrentMode();
        modeInstance._stopGameLoop();
        const boardScene = modeInstance._getBoardScene();
        boardScene?.syncFromGameState(modeInstance.gameState);
        const { eventBus, EVENTS } = await import('/src/events/event-bus.js');
        const theme = manager.activeTheme;
        window.__CHIRAL_THEME__ = theme;
        window.__CHIRAL_EVENT__ = (name, payload) => eventBus.emit(EVENTS[name], payload);
    }, quality);
    lastReadiness = await readGameReadiness();
    console.log(`[ChiralGoldCapture] game initialization: ${JSON.stringify(lastReadiness)}`);
    if (native && quality === 'High' && lastReadiness.compile?.status === 'success'
        && lastReadiness.flags?.useCompute === false) {
        throw new Error(`Game scene disabled native compute: ${JSON.stringify(lastReadiness)}`);
    }
    try {
        await page.waitForFunction(({ expectedQuality, requireCompute }) => {
            const theme = window.serenityBlocks?.themeManager?.activeTheme;
            return theme?.isActive && theme?.sculpture && theme.currentQualityLevel === expectedQuality
                && ['success', 'timeout'].includes(theme.compileStats?.status)
                && (!requireCompute || ['dustCompute', 'burstCompute', 'wispCompute'].every((key) => theme[key]?.ready));
        }, { expectedQuality: quality, requireCompute: native && quality === 'High' }, { timeout: 45000 });
    } catch (error) {
        lastReadiness = await readGameReadiness();
        throw new Error(`Game theme did not finish initialization: ${JSON.stringify(lastReadiness)}`, { cause: error });
    }
    await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.serenityBlocks.phaserGame?.loop?.sleep?.();
        const theme = window.serenityBlocks.themeManager.activeTheme;
        window.__CHIRAL_THEME__ = theme;
        theme.cancelAnimationLoop();
        theme.shouldRenderFrame = () => true;
        theme.clock.getDelta = () => 1 / 60;
        theme.time = 8;
        await theme.renderer.backend?.device?.queue.onSubmittedWorkDone();
        window.__CHIRAL_GPU_QUEUE_SETTLED__ = true;
        window.__CHIRAL_READY__ = true;
    });
}

try {
    await server.listen();
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
        args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
            '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
            '--disable-vulkan-surface'],
    });
    page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
        if (message.type() === 'warning') {
            warnings.push(message.text());
            if (/validation error|shader error|wgsl.*error|device.*lost/i.test(message.text())) errors.push(message.text());
        }
    });
    const params = new URLSearchParams({ chiralGoldSeed: '1234', seed: '1234', noThemeFpsCap: '1' });
    if (!native) params.set('forceWebGL', '1');
    if (args.has('--no-post')) params.set('chiralGoldNoPost', '1');
    if (mode === 'playground') {
        params.set('quality', quality);
        if (args.has('--no-post')) params.set('noPost', '1');
        params.set('effect', 'chiral-gold'); params.set('t', '8'); params.set('orbit', '0');
        if (args.has('--board')) params.set('board', '1');
        const events = selectedEvent ? [selectedEvent] : (timeline ? ['lock', 'clear', 'combo'] : ['idle']);
        for (const event of events) {
            const eventPhases = event === 'idle' ? [{ name: null, age: 0 }] : phases;
            for (const phase of eventPhases) {
                const eventParams = new URLSearchParams(params);
                if (event !== 'idle') eventParams.set('event', event === 'clear' && lineCount === 4 ? 'tetris' : event);
                eventParams.set('eventAge', String(phase.age));
                const viewport = page.viewportSize();
                const lockOrigin = playgroundLockOrigin(viewport.width, viewport.height);
                eventParams.set('lockX', String(lockOrigin.x)); eventParams.set('lockY', String(lockOrigin.y));
                await page.goto(`${origin}/playground.html?${eventParams}`, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.__PLAYGROUND_READY__ || window.__PLAYGROUND_ERROR__,
                    null, { timeout: 120000 });
                const playgroundError = await page.evaluate(() => window.__PLAYGROUND_ERROR__);
                if (playgroundError) throw new Error(playgroundError);
                await page.evaluate(async () => {
                    const api = window.__PLAYGROUND__;
                    api.renderer().setAnimationLoop(null);
                    await api.seek(8);
                    await api.renderer().backend?.device?.queue.onSubmittedWorkDone();
                    document.getElementById('hud')?.style.setProperty('display', 'none');
                });
                currentEvent = event; currentEventAge = phase.age;
                await capture(phase.name ? `${event}-${phase.name}` : event);
            }
        }
    } else {
        await prepareTheme(origin, params);
        await step(3);
        if (mode === 'game' && selectedEvent && selectedEvent !== 'idle') {
            currentEvent = 'idle'; currentEventAge = 0;
            await capture('idle');
        }
        if (selectedEvent || timeline) {
            const events = selectedEvent ? [selectedEvent] : ['idle', 'lock', 'clear', 'combo'];
            for (const [eventIndex, event] of events.entries()) {
                currentEvent = event; currentEventAge = 0;
                if (event === 'idle') {
                    await capture('idle');
                    continue;
                }
                await emitEvent(event);
                let elapsedFrames = 0;
                for (const phase of phases) {
                    const targetFrames = Math.round(phase.age * 60);
                    await step(targetFrames - elapsedFrames);
                    elapsedFrames = targetFrames;
                    currentEventAge = elapsedFrames / 60;
                    await capture(phase.name ? `${event}-${phase.name}` : event);
                }
                // Let the existing pool entries retire before the next isolated reaction.
                if (eventIndex < events.length - 1) await step(300);
            }
        } else {
            currentEvent = 'idle'; currentEventAge = 0;
            await capture('idle');
            for (const [event, frames] of [['lock', 8], ['clear', 10], ['combo', 12]]) {
                await emitEvent(event);
                await step(frames);
                currentEvent = event; currentEventAge = frames / 60;
                await capture(event);
            }
        }
        if (mobile) {
            await page.setViewportSize({ width: 844, height: 390 });
            if (mode === 'game') {
                await page.evaluate(async () => {
                    const app = window.serenityBlocks;
                    app.handleResize();
                    const board = app.gameModeManager.getCurrentMode()._getBoardScene();
                    const game = board.sys.game;
                    board.scale.refresh();
                    game.loop.wake();
                    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    game.loop.sleep();
                    game.renderer?.gl?.finish?.();
                });
            }
            await page.evaluate(() => window.__CHIRAL_THEME__.onWindowResize());
            await step(120);
            currentEvent = 'idle'; currentEventAge = null;
            await capture('landscape');
        }
        teardown = await page.evaluate(async () => {
            const theme = window.__CHIRAL_THEME__;
            await theme.renderer.backend?.device?.queue.onSubmittedWorkDone();
            theme.stop();
            return { active: theme.isActive, canvasCount: document.querySelectorAll('#chiral-gold-theme canvas').length };
        });
        if (teardown.active || teardown.canvasCount) throw new Error(`Teardown failed: ${JSON.stringify(teardown)}`);
    }
    if (errors.length) throw new Error(`Browser validation failed: ${errors.join('\n')}`);
} catch (error) {
    failure = error.stack || String(error);
    throw error;
} finally {
    await writeFile(path.join(artifactDir, validationName), JSON.stringify({
        generatedAt: new Date().toISOString(), softwareGpu: true, mode, native, mobile, quality,
        captureOptions: { selectedEvent, eventAge, timeline, lockX, lockY, lineCount, label, imageFormat, noPost: args.has('--no-post') },
        passed: !failure && !errors.length, errors, warnings, snapshots, teardown, failure,
        ...(failure ? { failureDiagnostics: lastDiagnostics, readiness: lastReadiness } : {}),
    }, null, 2));
    await browser?.close();
    await server.close();
}
