/**
 * Bounded isolated Neon District visual captures on the shipping renderer.
 * Optional tooling: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
 * node scripts/neon-district-visual-validation.mjs --lane webgl2 --out artifacts/neon-district
 * --lane webgpu --offscreen uses GPU readback when native canvas presentation is absent.
 * Software rendering verifies artwork and shader compatibility, never hardware FPS.
 */
// GPU work and fresh browser profiles must run serially.
/* eslint-disable no-await-in-loop */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = {};
for (let index = 2; index < process.argv.length; index += 1) {
    const [key, inline] = process.argv[index].replace(/^--/, '').split('=');
    options[key] = inline ?? (process.argv[index + 1]?.startsWith('--') === false ? process.argv[++index] : true);
}
const OUTPUT = path.resolve(ROOT, options.out || 'artifacts/neon-district-overhaul');
const lanes = options.lane === 'both' || !options.lane ? ['webgl2', 'webgpu'] : [options.lane];
if (lanes.some((lane) => !['webgl2', 'webgpu'].includes(lane))) {
    throw new Error('--lane must be webgl2, webgpu, or both.');
}
const phases = String(options.phases || 'ambient,piece-lock,tetris,combo').split(',');
if (phases.some((phase) => !['ambient', 'piece-lock', 'tetris', 'combo'].includes(phase))) {
    throw new Error('Unsupported --phases value.');
}
const profiles = [
    {
        id: 'desktop', width: 1280, height: 720, quality: 'High', dpr: 1,
    },
    {
        id: 'mobile', width: 390, height: 844, quality: 'Low', dpr: 3,
    },
    {
        id: 'mobile-landscape', width: 844, height: 390, quality: 'Low', dpr: 3,
    },
].filter((profile) => !options.profile || profile.id === options.profile);
if (!profiles.length) throw new Error('--profile must be desktop, mobile, or mobile-landscape.');
const GRAPHICS_ERROR_PATTERN = 'WGSL|ShaderModule|RenderPipeline|TSL:|No stack defined'
    + '|validation error|device lost|compilation error|WebGPU.*error';
const GRAPHICS_ERROR = new RegExp(GRAPHICS_ERROR_PATTERN, 'i');

function bounded(promise, milliseconds, label) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms.`)), milliseconds);
    })]).finally(() => clearTimeout(timer));
}

function inspect() {
    const theme = window.__neonTheme;
    const renderer = theme?.renderer;
    let backend = 'unknown';
    if (theme?.isWebGPU) backend = 'WebGPU';
    else if (theme?.isWebGL) backend = 'WebGL2';
    let objects = 0; let nodeMaterials = 0; let nonFinite = 0;
    theme?.scene?.traverse((object) => {
        if (object.geometry) objects += 1;
        if (![object.position.x, object.position.y, object.position.z,
            object.scale.x, object.scale.y, object.scale.z].every(Number.isFinite)) nonFinite += 1;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material?.isNodeMaterial) nodeMaterials += 1;
        }
        for (const attribute of Object.values(object.geometry?.attributes || {})) {
            const { array } = attribute;
            if (!array) continue;
            const stride = Math.max(1, Math.ceil(array.length / 3000));
            for (let index = 0; index < array.length; index += stride) {
                if (!Number.isFinite(array[index])) nonFinite += 1;
            }
        }
    });
    return {
        ready: window.__neonReady === true,
        active: theme?.isActive,
        backend,
        rendererKind: renderer?.isWebGPURenderer ? 'WebGPURenderer' : 'unknown',
        quality: theme?.currentQualityName,
        objects,
        nodeMaterials,
        nonFinite,
        buildings: theme?.buildings?.length,
        signs: theme?.neonSigns?.length,
        billboards: theme?.vhsBillboards?.length,
        effectDiagnostics: theme?.districtEvents?.getDiagnostics?.() || null,
        lightPulse: theme?.lightPulseIntensity,
        bloomBoost: theme?.bloomBoost,
        frame: renderer?.info?.frame,
        calls: renderer?.info?.render?.calls,
        pixelRatio: renderer?.getPixelRatio?.(),
        post: Boolean(theme?.post),
        time: theme?.time,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvas: { width: renderer?.domElement.width, height: renderer?.domElement.height },
        camera: { position: theme?.camera?.position.toArray(), fov: theme?.camera?.fov },
        failure: window.__neonFailure || null,
    };
}

async function presentReadback(page) {
    await bounded(page.evaluate(async () => {
        const theme = window.__neonTheme;
        const { renderer } = theme;
        const target = window.__neonCaptureTarget;
        if (!target) return;
        await renderer.backend.device.queue.onSubmittedWorkDone();
        const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
        const canvas = document.getElementById('__neonReadback') || document.createElement('canvas');
        canvas.id = '__neonReadback';
        canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:5';
        canvas.width = target.width; canvas.height = target.height;
        const packed = new Uint8ClampedArray(target.width * target.height * 4);
        const stride = Math.ceil((target.width * 4) / 256) * 256;
        for (let row = 0; row < target.height; row += 1) {
            packed.set(pixels.subarray(row * stride, row * stride + target.width * 4), row * target.width * 4);
        }
        canvas.getContext('2d').putImageData(new ImageData(packed, target.width, target.height), 0, 0);
        document.body.appendChild(canvas);
    }), 30_000, 'WebGPU readback');
}

async function screenshot(page, destination) {
    if (options.offscreen) await presentReadback(page);
    const png = await page.screenshot({ path: destination, scale: 'css', timeout: 20_000 });
    return page.evaluate(async (dataUrl) => {
        const image = new Image(); image.src = dataUrl; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0; let squared = 0; let lit = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            const value = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
            sum += value; squared += value * value; if (value > 12) lit += 1;
        }
        const count = pixels.length / 4; const mean = sum / count;
        return { mean, deviation: Math.sqrt(Math.max(0, squared / count - mean * mean)), litFraction: lit / count };
    }, `data:image/png;base64,${png.toString('base64')}`);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
// Vite is a declared development dependency used only by this local validation server.
// eslint-disable-next-line import/no-extraneous-dependencies
const { createServer } = await import('vite');
await mkdir(OUTPUT, { recursive: true });
const server = await createServer({
    root: ROOT,
    cacheDir: path.join(OUTPUT, 'vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
        host: '127.0.0.1', port: 0, strictPort: true, hmr: false,
    },
});
const report = {
    schemaVersion: 1,
    softwareRendering: true,
    offscreenWebGPU: Boolean(options.offscreen),
    limits: [
        'Isolated production theme; full game boot and physical-device performance are not measured.',
    ],
    results: [],
};
if (options.offscreen) {
    report.limits.push('WebGPU readback checks production shaders; native canvas presentation is not tested.');
}
if (options.append) {
    const previous = await readFile(path.join(OUTPUT, 'report.json'), 'utf8').then(JSON.parse).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    report.results = previous?.results || [];
    for (const result of report.results) {
        for (const phase of result.phases || []) phase.screenshot = path.basename(phase.screenshot);
    }
}
let browser;
try {
    await server.listen();
    const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const lane of lanes) {
        for (const profile of profiles) {
            const result = {
                id: `${lane}-${profile.id}`, profile, console: [], failures: [], phases: [],
            };
            report.results = report.results.filter((previous) => previous.id !== result.id);
            report.results.push(result);
            console.log(`[NeonDistrictVisual] Starting ${result.id}`);
            try {
                browser = await chromium.launch({
                    headless: true,
                    executablePath: options.executable || process.env.PLAYWRIGHT_EXECUTABLE_PATH,
                    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
                        '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
                        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
                        '--in-process-gpu', '--disable-gpu-sandbox',
                        ...(lane === 'webgpu' ? [
                            '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader',
                        ] : [])],
                });
                const page = await browser.newPage({
                    viewport: { width: profile.width, height: profile.height },
                    deviceScaleFactor: Number(options.dpr || profile.dpr),
                    isMobile: profile.id.startsWith('mobile'),
                    hasTouch: profile.id.startsWith('mobile'),
                });
                page.on('console', (message) => result.console.push({ type: message.type(), text: message.text() }));
                page.on('pageerror', (error) => result.failures.push(error.stack || error.message));
                page.on('crash', () => result.failures.push('Browser page crashed.'));
                await page.addInitScript(() => {
                    let seed = 481516; Math.random = () => {
                        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;
                    };
                });
                if (lane === 'webgl2') {
                    await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', {
                        value: undefined, configurable: true,
                    }));
                }
                const markup = [
                    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">',
                    '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#060711}',
                    '#neon-district-theme{position:fixed;inset:0;visibility:visible!important;opacity:1!important}',
                    '</style><div id="neon-district-theme"></div>',
                ].join('');
                await page.route((url) => url.pathname === '/__neon_visual__', (route) => route.fulfill({
                    contentType: 'text/html', body: markup,
                }));
                const params = new URLSearchParams({ noThemeFpsCap: '1', ndNoPrewarm: '1', ndSyncLoad: '1' });
                if (lane === 'webgl2') params.set('forceWebGL', '1');
                await page.goto(`${baseUrl}/__neon_visual__?${params}`, {
                    waitUntil: 'domcontentloaded', timeout: 30_000,
                });
                await bounded(page.evaluate(async ({ quality, offscreen }) => {
                    window.settings = { effectQuality: quality, graphicsQuality: quality, targetFrameRate: 60 };
                    const themeModule = '/src/themes/neon-district/neon-district-theme.js';
                    const [{ default: Theme }, events] = await Promise.all([
                        import(themeModule),
                        // This Vite browser-root URL runs inside page.evaluate, not Node's filesystem resolver.
                        // eslint-disable-next-line import/no-absolute-path, import/no-unresolved
                        import('/src/events/event-bus.js'),
                    ]);
                    // Reuse the exact renderer module URL Vite supplied to the theme.
                    // Importing its raw build URL would load a second Three instance.
                    let THREE;
                    if (offscreen) {
                        const source = await fetch(themeModule).then((response) => response.text());
                        const rendererImport = source.match(/import \* as THREE from ["']([^"']+)["']/);
                        if (!rendererImport) {
                            throw new Error('Cannot resolve shipping Three renderer module for offscreen target.');
                        }
                        THREE = await import(rendererImport[1]);
                    }
                    const theme = new Theme(); window.__neonTheme = theme; window.__neonEvents = events;
                    theme.updateDynamicResolution = () => {};
                    if (offscreen) {
                        const init = theme.initRenderer.bind(theme);
                        theme.initRenderer = async (...args) => {
                            const ready = await init(...args);
                            if (ready && theme.isWebGPU) {
                                const { renderer } = theme;
                                const target = new THREE.RenderTarget(window.innerWidth, window.innerHeight, {
                                    samples: 4,
                                });
                                target.texture.colorSpace = THREE.SRGBColorSpace;
                                window.__neonCaptureTarget = target;
                                const setTarget = renderer.setRenderTarget.bind(renderer);
                                renderer.setRenderTarget = (next, ...rest) => setTarget(next || target, ...rest);
                                renderer.setRenderTarget(target);
                            }
                            return ready;
                        };
                    }
                    await theme.init();
                    await theme.start({ loadTheme() {} }, {
                        onRuntimeFailure: (error) => { window.__neonFailure = String(error); },
                    });
                    theme.cancelAnimationFrames(); theme.isAnimating = false;
                    await theme.buildingLoadPromise;
                    await theme.backgroundLoadPromise;
                    await theme.deferredMaterialLoadPromise;
                    await theme.hdrEnvironmentLoadPromise;
                    theme.time = 8; theme.clock.getDelta = () => 1 / 60;
                    theme.updateGameplayEffects?.(0);
                    if (theme.post) theme.post.render(); else theme.renderer.render(theme.scene, theme.camera);
                    window.__neonReady = true;
                }, {
                    quality: options.quality || profile.quality,
                    offscreen: lane === 'webgpu' && Boolean(options.offscreen),
                }), 100_000, `${result.id} scene startup`);
                await page.waitForTimeout(600);
                await page.evaluate(() => {
                    window.__neonTheme.cancelAnimationFrames();
                    window.__neonTheme.isAnimating = false;
                });
                const state = await page.evaluate(inspect);
                if (state.backend !== (lane === 'webgpu' ? 'WebGPU' : 'WebGL2')) {
                    result.failures.push(`Expected ${lane}, got ${state.backend}.`);
                }
                for (const phase of phases) {
                    if (phase !== 'ambient') {
                        await page.evaluate((name) => {
                            const { eventBus, EVENTS } = window.__neonEvents;
                            if (name === 'piece-lock') {
                                eventBus.emit(EVENTS.PIECE_LOCK, {
                                    type: 'T', piece: { type: 'T' }, position: { x: 5, y: 16 },
                                });
                            }
                            if (name === 'tetris') {
                                eventBus.emit(EVENTS.LINE_CLEAR, { lines: 4, lineCount: 4, comboCount: 1 });
                            }
                            if (name === 'combo') eventBus.emit(EVENTS.COMBO, { combo: 7, comboCount: 7 });
                        }, phase);
                    }
                    if (phase !== 'ambient') {
                        await page.evaluate(() => {
                            const theme = window.__neonTheme;
                            for (let frame = 0; frame < 11; frame += 1) {
                                theme.updateGameplayEffects?.(1 / 60);
                                theme.updateCameraSway(1 / 60);
                            }
                            if (theme.post) theme.post.render();
                            else theme.renderer.render(theme.scene, theme.camera);
                        });
                    }
                    const destination = path.join(OUTPUT, `${result.id}-${phase}.png`);
                    const pixels = await screenshot(page, destination);
                    const metrics = await page.evaluate(inspect);
                    result.phases.push({
                        phase, screenshot: path.basename(destination), pixels, metrics,
                    });
                    if (metrics.nonFinite) result.failures.push(`${phase}: ${metrics.nonFinite} non-finite values.`);
                    if (pixels.deviation < 1 || pixels.litFraction < 0.01) {
                        result.failures.push(`${phase}: blank or uniform screenshot.`);
                    }
                }
                result.failures.push(...result.console.filter((message) => message.type === 'error'
                    || (GRAPHICS_ERROR.test(message.text)
                        && !message.text.includes('MRT disabled; using full-scene bloom to avoid pipeline errors.')))
                    .map((message) => message.text));
            } catch (error) {
                result.failures.push(error.stack || String(error));
            } finally {
                if (browser) await bounded(browser.close(), 5000, 'Browser close').catch(() => {});
                browser = null;
            }
            result.status = result.failures.length ? 'fail' : 'pass';
            await writeFile(path.join(OUTPUT, `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
            await writeFile(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
            console.log(JSON.stringify({ id: result.id, status: result.status, failures: result.failures }));
        }
    }
} finally {
    if (browser) await bounded(browser.close(), 5000, 'Browser close').catch(() => {});
    await server.close();
}
if (report.results.some((result) => result.status === 'fail')) process.exitCode = 1;
for (const result of report.results) {
    await writeFile(path.join(OUTPUT, `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
}
