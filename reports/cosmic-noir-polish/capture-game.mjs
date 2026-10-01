/** Single Cosmic Noir instance; no journey, reload, soak, or production-code changes. */
/* eslint-disable import/no-extraneous-dependencies */
import electron from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { app: electronApp, BrowserWindow } = electron;
const args = {};
for (let i = 2; i < process.argv.length; i += 1) {
    const token = process.argv[i];
    if (!token.startsWith('--') || token === '--') continue;
    const [key, inline] = token.slice(2).split('=');
    if (['perf', 'force-webgl', 'idle-only'].includes(key)) args[key] = inline !== 'false';
    else args[key] = inline ?? process.argv[++i];
}
const config = {
    baseUrl: args['base-url'] || 'http://127.0.0.1:4176',
    out: path.resolve(args.out || 'reports/cosmic-noir-refinement/capture'),
    quality: args.quality || 'High',
    width: Number(args.width || 1280),
    height: Number(args.height || 800),
    phase: Number(args.phase || 12),
    perf: Boolean(args.perf),
    forceWebGL: Boolean(args['force-webgl']),
    idleOnly: Boolean(args['idle-only']),
    durationMs: Number(args['duration-ms'] || 6000),
    targetFps: 60,
    pixelRatio: 1,
    renderScale: 0.92,
    seed: 12345,
};
if (!['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'].includes(config.quality)) {
    throw new Error('Unknown quality');
}
if (![config.width, config.height, config.phase, config.durationMs].every(Number.isFinite)) {
    throw new Error('Invalid numeric capture option');
}

electronApp.commandLine.appendSwitch('disable-background-timer-throttling');
electronApp.commandLine.appendSwitch('disable-renderer-backgrounding');
electronApp.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
electronApp.commandLine.appendSwitch('force_high_performance_gpu');
electronApp.commandLine.appendSwitch('force-device-scale-factor', '1');
electronApp.on('window-all-closed', (event) => event.preventDefault());

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
let win;
const consoleEntries = [];
const report = {
    config, startedAt: new Date().toISOString(), shots: {}, performance: [],
};

async function page(fn, payload = {}, timeoutMs = 90000) {
    let timer;
    console.log(`[Cosmic Noir capture] ${fn.name}${payload.label ? `: ${payload.label}` : ''}`);
    try {
        return await Promise.race([
            win.webContents.executeJavaScript(
                `(${fn.toString()})(${JSON.stringify(payload)}, (${readEventState.toString()}))`,
                true,
            ),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Page operation ${fn.name} timed out`)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function bootstrap(profile) {
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    const waitFor = async (predicate, timeout = 60000) => {
        const started = performance.now();
        while (performance.now() - started < timeout) {
            if (predicate()) return;
            // eslint-disable-next-line no-await-in-loop
            await sleep(100);
        }
        throw new Error('Application readiness timed out');
    };
    await waitFor(() => window.serenityBlocks?.isInitialized
        && window.serenityBlocks?.themeManager && window.serenityBlocks?.gameModeManager);
    const app = window.serenityBlocks;
    const manager = app.themeManager;
    manager.clearAdjacentThemePreloadQueue?.();
    manager.deferAdjacentThemePreload = true;
    manager.queueAdjacentThemePreload = () => {};
    const settings = {
        effectQuality: profile.quality,
        graphicsQuality: profile.quality,
        renderScale: 1,
        targetFrameRate: profile.targetFps,
        vsyncEnabled: true,
        enableAntialiasing: false,
        backgroundComboEffects: true,
        backgroundTabBehavior: 'continue',
        backgroundMode: 'Specific',
        backgroundTheme: 'forest',
    };
    app.settingsManager.update(settings, false);
    window.settings = app.settingsManager.get();
    app.applyEffectQuality?.(profile.quality);
    await app.applyFrameRateSettings?.(window.settings);
    app.frameRateController?.setVSync?.(true);
    app.frameRateController?.setTargetFPS?.(profile.targetFps);

    window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'single' } }));
    await waitFor(() => app.gameModeManager.getCurrentModeId() === 'single'
        && app.gameModeManager.getCurrentMode()?.isRunning);
    // isRunning becomes true before main.js finishes theme readiness, audio sync
    // and the cinematic reveal. Let that actual startup lifecycle finish before
    // pausing the board or replacing its initial theme; hiding the cover manually
    // would race the in-flight startup and could leave a suspended capture scene.
    await waitFor(() => !document.getElementById('cinematic-loading-overlay')
        && !(manager._loadingSurfaceCovering > 0)
        && !manager.switchDrainPromise
        && !manager.isTransitioning
        && !manager.queuedSwitchRequest);
    const startupSettled = {
        overlayRemoved: !document.getElementById('cinematic-loading-overlay'),
        loadingSurfaceCovering: manager._loadingSurfaceCovering ?? 0,
        initialTheme: manager.activeThemeName,
        initialThemeReady: manager.activeTheme?.isActive === true,
    };
    const mode = app.gameModeManager.getCurrentMode();
    if (!(mode.getGameState?.() ?? mode.gameState)) throw new Error('Missing actual gameplay state');
    app.gameModeManager.pauseCurrentMode({ reason: 'cosmic-noir-visual-capture' });
    if (!mode.isPaused) throw new Error('Could not pause board simulation');
    app.gamepadController?.disableGameModeSelection?.();
    app.gamepadController?.disableMenuNavigation?.();
    app.modalManager?.hideAll?.();
    app.serenityHub?.hide?.();
    document.body.classList.remove('start-modal-open');
    await manager.switchTheme('cosmic-noir', true);
    await waitFor(() => manager.activeThemeName === 'cosmic-noir'
        && manager.activeTheme?.renderer && manager.activeTheme?.camera && manager.activeTheme?.scene);
    const theme = manager.activeTheme;
    window.isRenderingPaused = false;
    window.isRenderingReduced = false;
    window.performanceMonitor?.setAdaptiveDownscaleSuppressed?.(true);
    const expectedBackend = profile.forceWebGL ? 'WebGL2' : 'WebGPU';
    let backend = 'Unknown';
    if (theme.isWebGPU) backend = 'WebGPU';
    else if (theme.isWebGL) backend = 'WebGL2';
    if (backend !== expectedBackend) throw new Error(`Expected ${expectedBackend}, got ${backend}`);
    if (!window.cosmicNoirBaseline?.getSamples || !theme.resetBaselineCapture) {
        throw new Error('Baseline telemetry API unavailable');
    }
    document.querySelectorAll('.modal-overlay, .modal-backdrop, .serenity-hub-backdrop')
        .forEach((element) => { element.style.display = 'none'; });
    ['performance-overlay', 'serenity-shortcuts-overlay', 'gamepad-hints-overlay', 'demo-indicator']
        .forEach((id) => { const element = document.getElementById(id); if (element) element.style.display = 'none'; });
    document.body.style.cursor = 'none';
    return {
        backend, mode: app.gameModeManager.getCurrentModeId(), boardPaused: mode.isPaused, startupSettled,
    };
}

function runtime(profile) {
    const theme = window.serenityBlocks.themeManager.activeTheme;
    const { renderer } = theme;
    const scenePass = theme.postProcessing?.scenePass;
    let backend = 'Unknown';
    if (theme.isWebGPU) backend = 'WebGPU';
    else if (theme.isWebGL) backend = 'WebGL2';
    const sceneTarget = scenePass ? {
        width: scenePass.renderTarget?.width,
        height: scenePass.renderTarget?.height,
        resolutionScale: scenePass.getResolutionScale?.(),
    } : null;
    const checks = {
        visible: document.visibilityState === 'visible' && !document.hidden,
        startupOverlayRemoved: !document.getElementById('cinematic-loading-overlay'),
        backend: backend === (profile.forceWebGL ? 'WebGL2' : 'WebGPU'),
        quality: theme.getCurrentQualityLevel() === profile.quality,
        seed: theme.flags.seed === profile.seed,
        pixelRatio: renderer.getPixelRatio() === 1,
        drawingBuffer: Math.abs(renderer.domElement.width - window.innerWidth) <= 1
            && Math.abs(renderer.domElement.height - window.innerHeight) <= 1,
        adaptiveDisabled: theme.flags.noAdaptiveScale === true
            && (theme.adaptiveBudgetState?.postResolutionScale ?? 1) === 1
            && (theme.adaptiveBudgetState?.pixelRatioScale ?? 1) === 1,
        liveClock: theme.fixedDeltaSeconds === null,
        sceneScale: !scenePass || Math.abs(sceneTarget.resolutionScale - profile.renderScale) < 0.001,
        sceneDimensions: !scenePass
            || (Math.abs(sceneTarget.width - Math.floor(window.innerWidth * profile.renderScale)) <= 1
                && Math.abs(sceneTarget.height - Math.floor(window.innerHeight * profile.renderScale)) <= 1),
        device: !theme.isWebGPU || Boolean(renderer.backend?.device),
    };
    return {
        checks,
        valid: Object.values(checks).every(Boolean),
        backend,
        quality: theme.getCurrentQualityLevel(),
        phase: theme.time,
        camera: theme.camera.position.toArray(),
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: devicePixelRatio },
        visibility: { state: document.visibilityState, hidden: document.hidden },
        drawingBuffer: { width: renderer.domElement.width, height: renderer.domElement.height },
        sceneTarget,
        flags: { ...theme.flags },
        compile: { ...theme.compileStats },
        timestamp: {
            enabled: theme.gpuTimestampState?.enabled === true,
            supported: theme.gpuTimestampState?.supported === true,
            features: [...(renderer.backend?.device?.features ?? [])],
        },
    };
}

// Manual animation applies ONLY to visual frames; never use these samples as FPS evidence.
async function visualStep({
    initialize = false, phase = 12, cue = null, steps = 1,
}) {
    const theme = window.serenityBlocks.themeManager.activeTheme;
    theme.cancelAnimationLoop();
    if (initialize) {
        window.__noirCaptureRestore = {
            getDelta: theme.clock.getDelta,
            shouldRenderFrame: theme.shouldRenderFrame,
            fixedDeltaSeconds: theme.fixedDeltaSeconds,
        };
        theme.clock.getDelta = () => 1 / 60;
        theme.shouldRenderFrame = () => true;
        theme.fixedDeltaSeconds = 1 / 60;
        theme.fixedElapsed = phase - 1 / 60;
        theme.time = phase - 1 / 60;
        theme.pointerX = 0;
        theme.pointerY = 0;
        theme.smoothedPointerX = 0;
        theme.smoothedPointerY = 0;
        if (theme.cameraRig) {
            theme.cameraRig._idlePhaseSeed = 0;
            theme.cameraRig._idlePhase = phase - 1 / 60;
        }
        if (theme.planet) theme.planet.rotation.y = (phase - 1 / 60) * 0.05;
    }
    if (cue === 'lock') theme.handlePieceLock();
    if (cue === 'combo') {
        theme.handleCombo({ comboCount: 3 });
        theme.handleLineClear({ lineCount: 4, comboCount: 3 });
    }
    for (let i = 0; i < steps; i += 1) {
        theme.animate();
        theme.cancelAnimationLoop();
        // Let the compositor and compute submissions advance one bounded frame at a time.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { requestAnimationFrame(resolve); });
    }
    await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
    return {
        method: 'screenshot-only fixed 1/60 simulation; normal theme animate/render code',
        phase: theme.time,
        camera: theme.camera.position.toArray(),
        cue,
        advancedSeconds: steps / 60,
        computeEnabled: theme.flags.useCompute,
        sparkWork: {
            capacity: theme.sparkCompute?.count ?? 0,
            activePrefix: theme.sparkCompute?.activeHighWaterMark ?? 0,
            dispatchCount: theme.sparkCompute?.computeNode?.count ?? 0,
            drawCount: theme.computeSparkPoints?.geometry.drawRange.count ?? 0,
            visible: theme.computeSparkPoints?.visible === true,
        },
        render: { ...theme.renderer.info.render },
    };
}

function resumeLive() {
    const theme = window.serenityBlocks.themeManager.activeTheme;
    const restore = window.__noirCaptureRestore;
    theme.clock.getDelta = restore.getDelta;
    theme.shouldRenderFrame = restore.shouldRenderFrame;
    theme.fixedDeltaSeconds = restore.fixedDeltaSeconds;
    delete window.__noirCaptureRestore;
    theme.startAnimation();
}

function readEventState() {
    const theme = window.serenityBlocks.themeManager.activeTheme;
    const state = {
        time: theme.time,
        gasParticles: theme.gasSwirlData?.activeEstimate ?? theme.gasSwirlData?.activeCount ?? 0,
        gasWindows: theme.gasSwirlData?.activeWindows?.length ?? 0,
        waves: theme.cosmicWaves?.length ?? 0,
        fallbackSparks: theme.unifiedSparkData?.activeEstimate ?? 0,
        computeActive: Boolean(theme.sparkCompute && theme.time <= theme.sparkCompute.lastActiveUntil),
        computeVisible: theme.computeSparkPoints?.visible === true,
        comboFlash: theme.comboFlashIntensity ?? 0,
        comboFlare: theme.comboLensFlareIntensity ?? 0,
        flashVisible: theme.comboFlash?.visible === true,
        flareVisible: theme.comboLensFlare?.visible === true,
    };
    return {
        ...state,
        idle: state.gasParticles === 0 && state.gasWindows === 0 && state.waves === 0
            && state.fallbackSparks === 0 && !state.computeActive && !state.computeVisible
            && state.comboFlash <= 0.001 && state.comboFlare <= 0.001
            && !state.flashVisible && !state.flareVisible,
    };
}

async function waitForIdle({ timeoutMs = 25000 }, readState) {
    const started = performance.now();
    let idleSince = null;
    let current;
    const initial = readState();
    do {
        current = readState();
        if (current.idle) {
            idleSince ??= performance.now();
            if (performance.now() - idleSince >= 1000) {
                return {
                    confirmed: true, waitedMs: performance.now() - started, initial, final: current,
                };
            }
        } else idleSince = null;
        // Require a full quiet second; a late deferred burst resets this interval.
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 50); });
    } while (performance.now() - started < timeoutMs);
    throw new Error(`Effects did not reach idle within ${timeoutMs}ms: ${JSON.stringify(current)}`);
}

async function measure({ label, durationMs, event = false }, readState) {
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    const theme = window.serenityBlocks.themeManager.activeTheme;
    const { renderer } = theme;
    const { scene } = theme;
    const before = { phase: theme.time, camera: theme.camera.position.toArray() };
    const idleStateBefore = readState();
    if (!event && !idleStateBefore.idle) {
        throw new Error(`Idle timing window contains active effects: ${JSON.stringify(idleStateBefore)}`);
    }
    if (theme.fixedDeltaSeconds !== null || window.__noirCaptureRestore) {
        throw new Error('Screenshot clock overrides must be removed before timing');
    }
    await theme.gpuTimestampState?.pending;
    theme.resetBaselineCapture();
    const started = performance.now();
    let nextEvent = started + 200;
    let events = 0;
    let nonIdleSamples = 0;
    while (performance.now() - started < durationMs) {
        if (!event && !readState().idle) nonIdleSamples += 1;
        if (event && performance.now() >= nextEvent) {
            theme.handleCombo({ comboCount: 3 });
            theme.handleLineClear({ lineCount: 4, comboCount: 3 });
            nextEvent += 1200;
            events += 1;
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(20);
    }
    await theme.gpuTimestampState?.pending;
    const elapsedMs = performance.now() - started;
    const samples = window.cosmicNoirBaseline.getSamples();
    const renderGpu = samples.gpu.filter((sample) => Number.isFinite(sample.renderMs));
    const uniqueFrameIds = new Set(renderGpu.map((sample) => sample.renderFrameId));
    const freshGpu = renderGpu.length > 0 && uniqueFrameIds.size === renderGpu.length;
    const idleStateAfter = readState();
    if (!event && (nonIdleSamples > 0 || !idleStateAfter.idle)) {
        throw new Error(`Idle timing window was contaminated: ${JSON.stringify({ nonIdleSamples, idleStateAfter })}`);
    }
    return {
        label,
        elapsedMs,
        events,
        idleStateBefore,
        idleStateAfter,
        idleConfirmed: !event && nonIdleSamples === 0 && idleStateBefore.idle && idleStateAfter.idle,
        sameInstance: window.serenityBlocks.themeManager.activeTheme === theme
            && theme.renderer === renderer && theme.scene === scene,
        liveClock: theme.fixedDeltaSeconds === null,
        before,
        after: { phase: theme.time, camera: theme.camera.position.toArray() },
        report: theme.getBaselineReport(),
        sampleCounts: Object.fromEntries(Object.entries(samples).map(([key, entries]) => [key, entries.length])),
        freshGpu,
        samples,
    };
}

async function shutdown() {
    const theme = window.serenityBlocks?.themeManager?.activeTheme;
    if (!theme) return { stopped: true, reason: 'No active theme' };
    const { renderer } = theme;
    const stages = [];
    const bounded = async (label, operation, milliseconds = 2000) => {
        let timer;
        try {
            await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
                }),
            ]);
            stages.push({ label, ok: true });
        } catch (error) {
            stages.push({ label, ok: false, error: error.message || String(error) });
        } finally {
            clearTimeout(timer);
        }
    };
    theme.cancelAnimationLoop?.();
    renderer?.setAnimationLoop?.(null);
    theme.clearDeferredTimeouts?.();
    await bounded('pending timestamps', () => theme.gpuTimestampState?.pending);
    await bounded('submitted GPU work', () => renderer?.backend?.device?.queue.onSubmittedWorkDone());

    // Cosmic Noir stop() is synchronous and discards BaseTheme's r186 disposal promise.
    // Observe that existing return during terminal teardown without changing its behavior.
    const pendingDisposals = [];
    const originalDisposeRenderer = theme.disposeRenderer;
    if (typeof originalDisposeRenderer === 'function') {
        theme.disposeRenderer = function observeRendererDisposal(...values) {
            const completion = originalDisposeRenderer.apply(this, values);
            if (completion?.then) pendingDisposals.push(completion);
            return completion;
        };
    }
    try {
        await bounded('theme stop', () => theme.stop());
        await bounded('renderer disposal', () => Promise.all(pendingDisposals));
    } finally {
        theme.disposeRenderer = originalDisposeRenderer;
    }
    return { stopped: theme.isActive === false && !theme.renderer, stages };
}

async function saveShot(label, payload) {
    console.log(`[Cosmic Noir capture] screenshot: ${label}`);
    report.shots[label] = await page(visualStep, payload);
    const shot = await win.webContents.capturePage();
    await writeFile(path.join(config.out, `${label}.png`), shot.toPNG());
}

async function run() {
    try {
        console.log(`[Cosmic Noir capture] ready; ${config.width}x${config.height}; ${config.quality}`);
        await mkdir(config.out, { recursive: true });
        win = new BrowserWindow({
            width: config.width,
            height: config.height,
            useContentSize: true,
            // Hidden Chromium windows can run RAF at ~1Hz even with background
            // throttling disabled. Visual stepping must use a visible document.
            show: true,
            webPreferences: {
                backgroundThrottling: false,
                contextIsolation: true,
                nodeIntegration: false,
                partition: `cosmic-noir-refinement-${Date.now()}`,
            },
        });
        win.removeMenu();
        win.webContents.on('console-message', (event) => {
            const {
                level, message, lineNumber, sourceId,
            } = event;
            consoleEntries.push({
                level, message, line: lineNumber, sourceId, timestamp: new Date().toISOString(),
            });
            if (level === 'warning' || level === 'error') console.log(`[Page ${level}] ${message}`);
        });
        win.webContents.on('render-process-gone', (_event, details) => {
            consoleEntries.push({ level: 'error', message: `Renderer gone: ${JSON.stringify(details)}` });
        });
        const url = new URL(config.baseUrl);
        const params = {
            skipIntro: 1,
            noThemeWarm: 1,
            cosmicNoirBaseline: 1,
            cosmicNoirSeed: config.seed,
            cosmicNoirFixedPixelRatio: config.pixelRatio,
            cosmicNoirRenderScale: config.renderScale,
            cosmicNoirNoAdaptiveScale: 1,
            cosmicNoirMsaa: 0,
            ...(config.forceWebGL ? { forceWebGL: 1 } : {}),
        };
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
        report.url = url.href;
        console.log(`[Cosmic Noir capture] load ${url.href}`);
        await win.loadURL(url.href);
        report.boot = await page(bootstrap, config);
        await delay(3000);
        report.runtime = await page(runtime, config);
        if (!report.runtime.valid) {
            throw new Error(`Runtime preflight failed: ${JSON.stringify(report.runtime.checks)}`);
        }
        await saveShot('idle', { initialize: true, phase: config.phase });
        if (!config.idleOnly) {
            await saveShot('lock', { cue: 'lock', steps: 9 });
            await saveShot('combo', { cue: 'combo', steps: 30 });
            await saveShot('combo-linger', { steps: 120 });
        }
        await page(resumeLive);
        if (config.perf) {
            // Clear the visual scenario before collecting normal RAF timings.
            console.log('[Cosmic Noir capture] settling before live performance windows');
            report.idleSettle = await page(waitForIdle, { timeoutMs: 25000 }, 30000);
            report.performanceRuntime = await page(runtime, config);
            report.performance.push(await page(measure, { label: 'idle', durationMs: config.durationMs }));
            report.performance.push(await page(measure, {
                label: 'combo', durationMs: config.durationMs, event: true,
            }));
            report.gpu = await electronApp.getGPUInfo('complete');
            const visible = report.performanceRuntime.visibility.state === 'visible'
            && !report.performanceRuntime.visibility.hidden;
            report.performanceAdmissible = visible && report.performanceRuntime.valid
            && report.performance.every((entry) => entry.sameInstance && entry.liveClock
                && entry.sampleCounts.frames >= 60 && (config.forceWebGL || entry.freshGpu));
            report.performanceInterpretation = 'Valid live RAF samples with a moving camera; '
                + 'sequential content windows, not a phase-matched differential performance benchmark.';
        }
        report.ok = true;
    } catch (error) {
        report.ok = false;
        report.error = error.stack || String(error);
    } finally {
        if (win && !win.isDestroyed()) {
            try {
                report.shutdown = await page(shutdown, {}, 12000);
                if (!report.shutdown.stopped || report.shutdown.stages?.some((stage) => !stage.ok)) report.ok = false;
                // Allow the renderer process to publish disposal diagnostics before capture ends.
                await delay(150);
            } catch (error) {
                report.shutdown = { stopped: false, error: error.message || String(error) };
                report.ok = false;
            }
        }
        const failurePattern = new RegExp([
            'invalid\\s+(?:ShaderModule|RenderPipeline|ComputePipeline|CommandBuffer)',
            'WGSL.*(?:error|invalid)|error.*WGSL|WebGPU uncaptured|uncaptured GPU error',
            'Uncaught (?:TypeError|ReferenceError|Error)|Renderer gone|device.*lost unexpectedly',
            'Failed to (?:load|switch|start).*theme',
        ].join('|'), 'i');
        report.shaderFailures = consoleEntries.filter((entry) => failurePattern.test(entry.message));
        report.consoleErrors = consoleEntries.filter((entry) => entry.level === 'error' || entry.level >= 3);
        if (report.shaderFailures.length || report.consoleErrors.length) report.ok = false;
        report.console = consoleEntries;
        report.finishedAt = new Date().toISOString();
        await mkdir(config.out, { recursive: true });
        await writeFile(path.join(config.out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
        await writeFile(
            path.join(config.out, 'console.log'),
            consoleEntries.map((entry) => `[${entry.level}] ${entry.message}`).join('\n'),
        );
        console.log(JSON.stringify({
            ok: report.ok, out: config.out, performanceAdmissible: report.performanceAdmissible, error: report.error,
        }));
        if (win && !win.isDestroyed()) win.destroy();
        electronApp.exit(report.ok ? 0 : 1);
    }
}

console.log('[Cosmic Noir capture] module loaded; awaiting app readiness');
electronApp.whenReady().then(run).catch((error) => {
    console.error('[Cosmic Noir capture] Fatal harness error:', error);
    electronApp.exit(1);
});
