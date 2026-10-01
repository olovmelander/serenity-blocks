/** One visible, phase-pinned Cosmic Noir playground; no production source edits. */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
    const flag = `--${name}`;
    const inline = argv.find((value) => value.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const index = argv.indexOf(flag);
    if (index < 0) return fallback;
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${flag} requires a value`);
    return argv[index + 1];
};
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', path.join(app.getPath('temp'), 'serenity-cosmic-noir-pinned-profile'));
app.on('window-all-closed', (event) => event.preventDefault());

async function bounded(promise, label, timeoutMs = 10000) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

// Serialised into the visible browser. All instrumentation stays in this report harness.
async function profilePinnedScene(config) {
    const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    const stage = (message) => console.log(`[Pinned instrument] ${message}`);
    const timed = async (label, operation, timeoutMs = 3000) => {
        stage(label);
        let timer;
        try {
            return await Promise.race([
                operation,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    stage('installing frame and query observers');
    const playground = window.__PLAYGROUND__;
    const renderer = playground.renderer();
    const camera = playground.camera();
    const scene = playground.scene();
    const originalLoop = renderer.getAnimationLoop();
    const originalResolve = renderer.resolveTimestampsAsync;
    const originalSetTarget = renderer.setRenderTarget;
    if (!originalLoop || !renderer.backend?.isWebGPUBackend) throw new Error('Native WebGPU loop required');
    if (!renderer.backend.trackTimestamp || !renderer.backend.device?.features.has('timestamp-query')) {
        throw new Error('Native timestamp queries are unavailable');
    }
    if (renderer.info.autoReset !== true) throw new Error('Expected three animation-owned per-frame counter reset');
    let epoch = 0;
    let collecting = false;
    let lastStart = null;
    const frames = [];
    const queries = [];
    const staleQueries = [];
    const queryErrors = [];
    const targets = new Map();
    const pending = new Set();
    const seen = { render: new Set(), compute: new Set() };
    renderer.resolveTimestampsAsync = function resolveVerified(type = 'render') {
        const generation = epoch;
        const eligible = collecting;
        const requestedAt = performance.now();
        const promise = Promise.resolve(originalResolve.call(this, type)).then((milliseconds) => {
            const frameIds = this.backend.getTimestampFrames(type);
            const frameId = frameIds.at(-1) ?? null;
            const fresh = frameId !== null && !seen[type].has(frameId);
            if (fresh) seen[type].add(frameId);
            if (eligible && generation === epoch) {
                const sample = {
                    type,
                    frameId,
                    milliseconds: Number.isFinite(milliseconds) ? milliseconds : null,
                    requestedAt,
                    resolvedAt: performance.now(),
                    frameIds: [...frameIds],
                };
                if (fresh && Number.isFinite(milliseconds)) queries.push(sample);
                else staleQueries.push(sample);
            }
            return milliseconds;
        }).catch((error) => {
            if (eligible && generation === epoch) queryErrors.push({ type, error: String(error) });
            throw error;
        }).finally(() => pending.delete(promise));
        pending.add(promise);
        return promise;
    };
    renderer.setRenderTarget = function observeTarget(target, ...rest) {
        if (collecting && target) {
            const description = {
                width: target.width,
                height: target.height,
                name: target.texture?.name || '',
                samples: target.samples ?? 0,
            };
            targets.set(JSON.stringify(description), description);
        }
        return originalSetTarget.call(this, target, ...rest);
    };
    await timed('install animation wrapper', renderer.setAnimationLoop((time, xrFrame) => {
        const started = performance.now();
        originalLoop(time, xrFrame);
        if (collecting) {
            frames.push({
                frameId: renderer.info.frame,
                cpuMs: performance.now() - started,
                intervalMs: lastStart === null ? null : started - lastStart,
                draws: renderer.info.render.drawCalls,
                passes: renderer.info.render.frameCalls,
                triangles: renderer.info.render.triangles,
                points: renderer.info.render.points,
                computeCalls: renderer.info.compute.frameCalls,
            });
            lastStart = started;
        }
    }));
    const stamp = () => ({
        diagnostics: playground.diagnostics(),
        profile: playground.profile.snapshot(),
        camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov },
        visible: document.visibilityState === 'visible' && !document.hidden,
        renderer: {
            width: renderer.domElement.width,
            height: renderer.domElement.height,
            pixelRatio: renderer.getPixelRatio(),
            samples: renderer.samples,
            toneMapping: renderer.toneMapping,
            exposure: renderer.toneMappingExposure,
            outputColorSpace: renderer.outputColorSpace,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: devicePixelRatio },
    });
    await timed('warming the fixed scene', sleep(config.warmMs), config.warmMs + 2000);
    // Epoch invalidation rejects any warmup query that completes later. Do not
    // block the live loop on a warmup readback just to begin measurement.
    playground.profile.reset();
    epoch += 1;
    const before = stamp();
    const startedAt = performance.now();
    collecting = true;
    const progress = setInterval(() => {
        stage(`measuring: ${frames.length} frames; ${queries.length} fresh queries; ${pending.size} pending`);
    }, 2000);
    try {
        await timed('measuring the fixed scene', sleep(config.durationMs), config.durationMs + 2000);
    } finally {
        clearInterval(progress);
    }
    collecting = false;
    const elapsedMs = performance.now() - startedAt;
    await timed('stopping animation wrapper', renderer.setAnimationLoop(null));
    await timed('draining measured query resolves', Promise.allSettled([...pending]));
    await timed('draining submitted GPU work', renderer.backend.device.queue.onSubmittedWorkDone());
    stage(`complete: ${frames.length} frames; ${queries.length} fresh queries`);
    const after = stamp();
    renderer.resolveTimestampsAsync = originalResolve;
    renderer.setRenderTarget = originalSetTarget;
    const info = renderer.backend.device.adapterInfo;
    const adapter = info ? Object.fromEntries(['vendor', 'architecture', 'device', 'description']
        .map((key) => [key, info[key] ?? null])) : null;
    return {
        before,
        after,
        elapsedMs,
        frames,
        queries,
        staleQueries,
        queryErrors,
        renderTargets: [...targets.values()],
        sameRuntime: renderer === playground.renderer() && scene === playground.scene(),
        adapter,
        timestampFeatures: [...renderer.backend.device.features],
        backend: playground.backend(),
        methodology: {
            environment: 'Vite development playground; fixed-content GPU/counter evidence; no production FPS claim.',
            gpu: 'One sample per newly resolved r186 timestamp frame ID; cached readbacks excluded.',
            counters: 'Complete renderer.info totals after the playground animation callback, including post passes.',
            phase: 'Fixed shader/simulation phase; RAF timing is context only, not live gameplay FPS.',
            quantizationMs: 0.065536,
            machineQuiet: 'Operator verification required; one run alone does not establish a regression claim.',
        },
    };
}

function summarize(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
    return {
        count: sorted.length,
        min: sorted[0] ?? null,
        p50: percentile(0.5),
        p95: percentile(0.95),
        max: sorted.at(-1) ?? null,
    };
}

function reduce(measurement, config) {
    const {
        before, after, frames, queries,
    } = measurement;
    const counters = Object.fromEntries(['draws', 'passes', 'triangles', 'points', 'computeCalls']
        .map((key) => [key, summarize(frames.map((frame) => frame[key]))]));
    const checks = {
        sameRuntime: measurement.sameRuntime,
        visible: before.visible && after.visible,
        cameraPinned: JSON.stringify(before.camera) === JSON.stringify(after.camera),
        phasePinned: before.profile.fixedTime === config.phase && after.profile.fixedTime === config.phase
            && before.diagnostics.time === config.phase && after.diagnostics.time === config.phase,
        seed: before.profile.seed === config.seed && after.profile.seed === config.seed,
        quality: before.diagnostics.quality === config.quality && after.diagnostics.quality === config.quality,
        resolution: before.renderer.width === config.width && before.renderer.height === config.height
            && before.renderer.pixelRatio === 1 && JSON.stringify(before.renderer) === JSON.stringify(after.renderer),
        stableContent: Object.values(counters).every((counter) => counter.min === counter.max),
        enoughFrames: frames.length >= 120,
        freshRenderQueries: queries.filter((query) => query.type === 'render').length >= 6,
        queryErrors: measurement.queryErrors.length === 0,
    };
    return {
        instrumentValid: Object.values(checks).every(Boolean),
        checks,
        counters,
        cpuMs: summarize(frames.map((frame) => frame.cpuMs)),
        rafIntervalMs: summarize(frames.map((frame) => frame.intervalMs)),
        gpuRenderMs: summarize(queries.filter((query) => query.type === 'render').map((query) => query.milliseconds)),
        gpuComputeMs: summarize(queries.filter((query) => query.type === 'compute').map((query) => query.milliseconds)),
    };
}

async function run() {
    const config = {
        width: Number(arg('width', 1280)),
        height: Number(arg('height', 800)),
        phase: Number(arg('phase', 12)),
        seed: Number(arg('seed', 12345)),
        quality: arg('quality', 'High'),
        warmMs: Number(arg('warm-ms', 3000)),
        durationMs: Number(arg('duration-ms', 8000)),
        output: path.resolve(arg('out', 'reports/cosmic-noir-polish/before')),
    };
    const url = new URL(arg('url', 'http://localhost:5173/playground.html?effect=cosmic-noir'));
    Object.entries({
        effect: 'cosmic-noir',
        t: config.phase,
        seed: config.seed,
        quality: config.quality,
        profile: 1,
        trackTimestamp: 1,
    }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const report = { config, url: url.href, messages: [], stages: [], navigations: [] };
    await mkdir(config.output, { recursive: true });
    console.log(`[Cosmic Noir profile] ${url.href}; warm ${config.warmMs}ms; measure ${config.durationMs}ms`);
    const win = new BrowserWindow({
        width: config.width,
        height: config.height,
        show: true,
        useContentSize: true,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    win.removeMenu();
    win.webContents.on('console-message', (event) => {
        if (event.message?.startsWith('[Pinned instrument]')) {
            report.stages.push({ message: event.message, at: new Date().toISOString() });
            console.log(event.message);
        }
        if (['warning', 'error'].includes(event.level)) {
            report.messages.push({ level: event.level, message: event.message });
        }
    });
    win.webContents.on('did-start-navigation', (_event, target, _inPlace, isMainFrame) => {
        if (isMainFrame) {
            report.navigations.push({ url: target, at: new Date().toISOString() });
            console.log(`[Cosmic Noir profile] Navigation: ${target}`);
        }
    });
    const evaluate = (source, timeout = 10000) => bounded(
        win.webContents.executeJavaScript(source, true), 'Page evaluation', timeout,
    );
    try {
        await bounded(win.loadURL(url.href), 'Page load', 30000);
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt += 1) {
            const state = await evaluate(`({ready:window.__PLAYGROUND_READY__,error:window.__PLAYGROUND_ERROR__,
                loaded:window.__PLAYGROUND__?.diagnostics()?.loaded})`);
            if (state.error) throw new Error(state.error);
            if (state.ready && state.loaded !== false) { ready = true; break; }
            await new Promise((resolve) => { setTimeout(resolve, 200); });
        }
        if (!ready) throw new Error('Playground did not become ready');
        await evaluate('document.querySelectorAll(\'#hud,.hud,#drop-hint\').forEach(e=>e.style.display=\'none\')');
        console.log('[Cosmic Noir profile] Ready; measuring pinned content');
        report.measurement = await evaluate(
            `(${profilePinnedScene.toString()})(${JSON.stringify(config)})`,
            config.warmMs + config.durationMs + 15000,
        );
        report.summary = reduce(report.measurement, config);
        report.gpu = await app.getGPUInfo('complete');
        await writeFile(path.join(config.output, 'capture.png'), (await win.webContents.capturePage()).toPNG());
        const comparePath = arg('compare', null);
        if (comparePath) {
            const previous = JSON.parse(await readFile(path.resolve(comparePath), 'utf8'));
            const baseline = previous.summary;
            const current = report.summary;
            const triangleRatio = Math.abs(current.counters.triangles.p50 - baseline.counters.triangles.p50)
                / Math.max(1, baseline.counters.triangles.p50);
            const matches = {
                verifiedInstruments: baseline.instrumentValid && current.instrumentValid,
                drawCalls: baseline.counters.draws.p50 === current.counters.draws.p50,
                triangles: triangleRatio <= 0.02,
                camera: JSON.stringify(previous.measurement.before.camera)
                    === JSON.stringify(report.measurement.before.camera),
                resolution: JSON.stringify(previous.measurement.before.renderer)
                    === JSON.stringify(report.measurement.before.renderer),
                hardware: JSON.stringify(previous.measurement.adapter) === JSON.stringify(report.measurement.adapter),
                phase: previous.config.phase === config.phase && previous.config.seed === config.seed
                    && previous.config.quality === config.quality,
            };
            report.comparison = {
                source: path.resolve(comparePath),
                matches,
                contentMatched: Object.values(matches).every(Boolean),
                note: 'ADR0016 differential claims still require a quiet machine and an agreeing repeat.',
            };
        }
        report.ok = report.summary.instrumentValid;
    } catch (error) {
        report.ok = false;
        report.error = error.stack || String(error);
        console.error(report.error);
    } finally {
        try {
            await evaluate(`(async()=>{const r=window.__PLAYGROUND__?.renderer?.()??window.renderer;
                r?.setAnimationLoop?.(null);if(r?.backend)r.backend.trackTimestamp=false;
                await r?.backend?.device?.queue.onSubmittedWorkDone();})()`, 5000);
            await bounded(win.loadURL('about:blank'), 'Page unload', 5000);
            report.shutdown = { stopped: true };
        } catch (error) {
            report.shutdown = { stopped: false, error: String(error) };
            report.ok = false;
        }
        const shaderPattern = /invalid.*(?:ShaderModule|RenderPipeline|CommandBuffer)|WGSL.*error|WebGPU uncaptured/i;
        report.shaderErrors = report.messages.filter((entry) => entry.level === 'error'
            || shaderPattern.test(entry.message));
        if (report.shaderErrors.length) report.ok = false;
        await writeFile(path.join(config.output, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify({
            ok: report.ok, output: config.output, summary: report.summary, error: report.error,
        }));
        win.destroy();
        app.exit(report.ok ? 0 : 1);
    }
}

app.whenReady().then(run).catch((error) => { console.error(error); app.exit(1); });
