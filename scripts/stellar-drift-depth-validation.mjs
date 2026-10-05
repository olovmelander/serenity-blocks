/**
 * Deterministic, single-theme Stellar Drift visual validation.
 * node scripts/stellar-drift-depth-validation.mjs --stage=before|after [--native] [--live]
 * Optional PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE supply existing local tooling.
 * Software GPU captures verify shader correctness and composition, not device FPS.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const value = (name, fallback) => args.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const stage = value('stage', 'after');
const origin = value('origin', 'http://127.0.0.1:5177');
const out = path.resolve(value('out', 'reports/stellar-drift-depth-2026-10'));
const mode = args.includes('--live') ? 'theme' : 'playground';
const native = args.includes('--native');
const server = args.includes('--external-server') ? null : await createServer({
    cacheDir: `/tmp/stellar-drift-depth-vite-${new URL(origin).port || 5177}`,
    server: { host: '127.0.0.1', port: new URL(origin).port ? Number(new URL(origin).port) : 5177,
        strictPort: true, open: false },
});
await server?.listen();
const playwrightModule = process.env.PLAYWRIGHT_MODULE
    || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
        ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright/index.mjs') : null);
const { chromium } = await import(playwrightModule ? pathToFileURL(playwrightModule).href : 'playwright');
await mkdir(out, { recursive: true });

const profiles = [
    { id: 'desktop-high', width: 1440, height: 900, quality: 'High', mobile: false },
    { id: 'phone-low', width: 390, height: 844, quality: 'Low', mobile: true },
];
if (stage !== 'before') profiles.push(
    { id: 'ultrawide-high', width: 2560, height: 1080, quality: 'High', mobile: false },
    { id: 'phone-landscape-low', width: 844, height: 390, quality: 'Low', mobile: true },
);
const selectedProfiles = value('profiles', '').split(',').filter(Boolean);
const states = value('states', 'idle,combo').split(',').filter(Boolean);
const results = [];
let failed = false;
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
        '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
        '--disable-vulkan-surface', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
try {
    for (const profile of profiles.filter((entry) => selectedProfiles.length === 0 || selectedProfiles.includes(entry.id))) {
        for (const state of states) {
            const backend = native && !profile.mobile ? 'webgpu' : 'webgl2';
            const name = `${stage}-${mode}-${profile.id}-${backend}-${state}`;
            const messages = [];
            const page = await browser.newPage({
                viewport: { width: profile.width, height: profile.height },
                deviceScaleFactor: 1, isMobile: profile.mobile, hasTouch: profile.mobile,
            });
            let context;
            const record = (type, message) => {
                const existing = messages.find((entry) => entry.type === type && entry.message === message);
                if (existing) existing.count += 1;
                else messages.push({ type, message, count: 1 });
            };
            page.on('pageerror', (error) => record('pageerror', error.stack || error.message));
            page.on('console', (message) => {
                if (['error', 'warning'].includes(message.type())) record(message.type(), message.text());
            });
            page.on('crash', () => record('pageerror', 'Browser page crashed.'));
            await page.routeWebSocket((url) => url.host === new URL(origin).host, () => {});
            await page.addInitScript(() => {
                window.__STELLAR_GPU_ERRORS__ = [];
                if (typeof GPUAdapter !== 'undefined') {
                    const requestDevice = GPUAdapter.prototype.requestDevice;
                    GPUAdapter.prototype.requestDevice = async function requestValidatedDevice(...requestArgs) {
                        const device = await requestDevice.apply(this, requestArgs);
                        device.addEventListener('uncapturederror', (event) => {
                            window.__STELLAR_GPU_ERRORS__.push(event.error?.message || String(event.error));
                        });
                        device.lost.then((info) => {
                            if (info.reason !== 'destroyed') window.__STELLAR_GPU_ERRORS__.push(`GPU device lost: ${info.reason}: ${info.message}`);
                        });
                        return device;
                    };
                }
                let seed = 481516;
                Math.random = () => {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    return seed / 4294967296;
                };
            });
            const params = new URLSearchParams({ effect: 'stellar-drift', t: '8', quality: profile.quality,
                seed: '481516', orbit: '0', profile: '1' });
            if (args.includes('--board')) params.set('board', '1');
            params.set('eventAge', state === 'corona' ? '1.65' : value('event-age', '0.35'));
            if (backend === 'webgl2') params.set('forceWebGL', '1');
            if (state === 'combo' || state === 'corona') { params.set('event', 'combo'); params.set('combo', '5'); }
            if (mode === 'theme') {
                params.set('themeValidation', '1');
                await page.route((requestUrl) => requestUrl.pathname === '/__stellar-drift-validation.html', (route) => route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
                        + '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#02040a}'
                        + '#stellar-drift-theme{position:fixed;inset:0;width:100%;height:100%;visibility:visible!important;opacity:1!important}'
                        + 'canvas{display:block}.player-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
                        + 'width:calc(min(clamp(220px,22vw,300px),(100vh - 250px)/2) + 24px);'
                        + 'height:calc(2 * min(clamp(220px,22vw,300px),(100vh - 250px)/2) + 24px);border-radius:16px;background:#07111fdc;'
                        + 'border:1px solid #bfeee840;box-shadow:0 0 26px #06182e70;z-index:3;pointer-events:none}</style>'
                        + '</head><body><div id="stellar-drift-theme"></div><div class="player-card" data-player="solo"></div></body></html>',
                }));
            }
            const url = `${origin}/${mode === 'theme' ? '__stellar-drift-validation.html' : 'playground.html'}?${params}`;
            console.log(`[StellarDriftValidation] ${name}`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                if (mode === 'theme') {
                    await page.evaluate(async ({ quality, event, eventAge }) => {
                        window.settings = { graphicsQuality: quality, effectQuality: quality,
                            backgroundComboEffects: true, targetFrameRate: 60 };
                        const { default: StellarDriftTheme } = await import('/src/themes/stellar-drift/stellar-drift-theme.js');
                        const { eventBus, EVENTS } = await import('/src/events/event-bus.js');
                        const theme = new StellarDriftTheme();
                        window.__STELLAR_CAPTURE_THEME__ = theme;
                        await theme.init();
                        await theme.start({ loadTheme() {} });
                        theme.cancelAnimationFrames();
                        theme.animationLoopStarted = false;
                        theme.time = 0;
                        theme.reactions.reset();
                        for (let i = 1; i <= 480; i += 1) {
                            if (event === 'combo' && i === Math.ceil((8 - eventAge) * 60)) eventBus.emit(EVENTS.COMBO, { comboCount: 5 });
                            theme.update(1 / 60);
                        }
                        theme.renderFrame();
                        await theme.renderer.backend?.device?.queue.onSubmittedWorkDone();
                        window.__STELLAR_CAPTURE_READY__ = true;
                    }, { quality: profile.quality, event: state === 'corona' ? 'combo' : state,
                        eventAge: state === 'corona' ? 1.65 : Number(value('event-age', '0.35')) });
                }
                await page.waitForFunction(() => window.__PLAYGROUND_READY__ || window.__PLAYGROUND_ERROR__ || window.__STELLAR_CAPTURE_READY__, null, { timeout: 120000 });
                const error = await page.evaluate(() => window.__PLAYGROUND_ERROR__);
                if (error) throw new Error(error);
                await page.waitForFunction(() => window.__PLAYGROUND__?.diagnostics()?.loaded !== false, null, { timeout: 30000 });
                await page.evaluate(() => {
                    document.querySelectorAll('#hud, .hud, #drop-hint').forEach((element) => { element.style.display = 'none'; });
                    window.__PLAYGROUND__?.profile.reset();
                });
                await page.waitForTimeout(1200);
                await page.evaluate(() => window.__PLAYGROUND__?.renderer().setAnimationLoop(null));
                context = await page.evaluate(async () => {
                    const api = window.__PLAYGROUND__;
                    const theme = window.__STELLAR_CAPTURE_THEME__;
                    const renderer = api ? api.renderer() : theme.renderer;
                    await renderer.backend?.device?.queue.onSubmittedWorkDone();
                    const canvas = renderer.domElement;
                    const rect = canvas.getBoundingClientRect();
                    return {
                        ready: window.__PLAYGROUND_READY__ || window.__STELLAR_CAPTURE_READY__,
                        backend: api ? api.backend() : theme.isWebGPU ? 'WebGPU' : 'WebGL2',
                        diagnostics: api ? api.diagnostics() : { quality: theme.activeQualityLevel,
                            ...theme.atmosphere.getDiagnostics(), ...theme.postProcessing?.getDiagnostics(),
                            arcs: theme.reactions.getFrame().arcs.filter((entry) => entry.active).length,
                            comets: theme.reactions.getFrame().comets.filter((entry) => entry.active).length,
                            reactions: theme.reactions.getFrame(),
                            lastRenderPath: theme.lastRenderPath, capabilities: theme.capabilities },
                        profile: api?.profile.snapshot() ?? null,
                        camera: (() => {
                            const camera = theme?.camera || window.__STELLAR_DRIFT_ATMOSPHERE__?.camera;
                            return camera ? { position: camera.position.toArray(), fov: camera.fov,
                                aspect: camera.aspect, near: camera.near, far: camera.far } : null;
                        })(),
                        renderInfo: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
                        gpuErrors: [...window.__STELLAR_GPU_ERRORS__],
                        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
                        canvas: { width: canvas.width, height: canvas.height, left: rect.left, top: rect.top,
                            cssWidth: rect.width, cssHeight: rect.height },
                    };
                });
                if (!context.backend.toLowerCase().includes(backend === 'webgpu' ? 'webgpu' : 'webgl')) {
                    throw new Error(`Expected ${backend}, rendered ${context.backend}`);
                }
                if (context.canvas.cssWidth !== profile.width || context.canvas.cssHeight !== profile.height) {
                    throw new Error(`Canvas does not fill viewport: ${JSON.stringify(context.canvas)}`);
                }
                await page.screenshot({ path: path.join(out, `${name}.png`), scale: 'css' });
                if (args.includes('--pointer') && profile.id === 'desktop-high' && state === 'idle') {
                    context.pointer = {};
                    for (const [point, x, y] of [['center', 0.5, 0.5], ['corner', 0.9, 0.1]]) {
                        await page.mouse.move(profile.width * x, profile.height * y);
                        context.pointer[point] = await page.evaluate(async () => {
                            const theme = window.__STELLAR_CAPTURE_THEME__;
                            const atmosphere = theme?.atmosphere || window.__STELLAR_DRIFT_ATMOSPHERE__;
                            const frame = theme?.reactions.getFrame() || {};
                            // Fixed time keeps the drift phase identical while allowing the
                            // production pointer smoothing to settle after a real mouse event.
                            for (let i = 0; i < 120; i += 1) atmosphere.update(8, 1 / 60, frame);
                            if (theme) theme.renderFrame();
                            else window.__PLAYGROUND__.seek(8);
                            await new Promise((resolve) => { requestAnimationFrame(resolve); });
                            const renderer = theme?.renderer || window.__PLAYGROUND__.renderer();
                            await renderer.backend?.device?.queue.onSubmittedWorkDone();
                            return { camera: atmosphere.camera.position.toArray(), diagnostics: atmosphere.getDiagnostics() };
                        });
                        await page.screenshot({ path: path.join(out, `${name}-pointer-${point}.png`), scale: 'css' });
                    }
                    context.pointer.distance = Math.hypot(...context.pointer.center.camera.map((coordinate, i) => coordinate - context.pointer.corner.camera[i]));
                    if (context.pointer.distance < 0.05) throw new Error(`Pointer camera did not move: ${context.pointer.distance}`);
                }
                if (mode === 'theme') {
                    context.teardown = await page.evaluate(async () => {
                        const theme = window.__STELLAR_CAPTURE_THEME__;
                        await theme.renderer.backend?.device?.queue.onSubmittedWorkDone();
                        theme.stop();
                        await new Promise((resolve) => { setTimeout(resolve, 50); });
                        return { active: theme.isActive, canvasCount: document.querySelectorAll('#stellar-drift-theme canvas').length };
                    });
                    if (context.teardown.active || context.teardown.canvasCount) throw new Error(`Theme teardown failed: ${JSON.stringify(context.teardown)}`);
                }
                if (messages.some((entry) => ['error', 'pageerror'].includes(entry.type)
                    || /validation.?error|error.*(?:wgsl|shader|gpu)|(?:wgsl|shader|device).*(?:error|lost)/i.test(entry.message))) {
                    throw new Error('Browser reported rendering errors; see capture JSON.');
                }
                context.gpuErrors = await page.evaluate(() => [...window.__STELLAR_GPU_ERRORS__]);
                if (context.gpuErrors.length) throw new Error(`WebGPU validation failed: ${context.gpuErrors.join('; ')}`);
            } catch (error) {
                failed = true;
                record('captureerror', error.stack || error.message);
                await page.screenshot({ path: path.join(out, `${name}-failure.png`), scale: 'css' }).catch(() => {});
                console.error(`[StellarDriftValidation] ${name}: ${error.message}`);
            } finally {
                const result = { name, stage, mode, url, ...context, messages };
                results.push(result);
                await writeFile(path.join(out, `${name}.json`), JSON.stringify(result, null, 2));
                await page.evaluate(() => window.__PLAYGROUND__?.renderer().setAnimationLoop(null)).catch(() => {});
                await page.close();
            }
        }
    }
} finally {
    await browser.close();
    await server?.close();
    await writeFile(path.join(out, `${stage}-${mode}-${native ? 'native' : 'webgl2'}-results.json`), JSON.stringify(results, null, 2));
}
if (failed) process.exitCode = 1;
