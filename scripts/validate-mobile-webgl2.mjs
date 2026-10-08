/**
 * Repeatable, serial mobile WebGL2 compatibility captures of production themes.
 * Requires optional Playwright tooling: install it locally without saving it,
 * or set PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
 * This is software/browser emulation, not a physical-phone performance test.
 */
/* eslint-disable no-await-in-loop */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { THEME_REGISTRY } from '../src/themes/theme-registry.js';
import {
    getMobileWebgl2PixelRatioCeiling, installMobileThemeViewportForwarding, mobileWebgl2ExitCode, mobileWebgl2Failures, parseMobileWebgl2Args,
} from './lib/mobile-webgl2-validation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

function bounded(promise, timeoutMs, label) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    })]).finally(() => clearTimeout(timer));
}

function themePage(entry, config, shell) {
    const payload = JSON.stringify({ id: entry.id, module: `/src/themes/${entry.module.slice(2)}`, quality: config.quality, renderScale: config.renderScale });
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/styles/main.css"><style>body{margin:0;width:100vw;height:100vh;overflow:hidden}
    .theme-container.active{transition:none!important;opacity:1!important;visibility:visible!important}
    .background-container{z-index:0}#background-canvas{pointer-events:none}</style></head>
    <body class="theme-${entry.id}">${shell}<script type="module">
    const config=${payload};
    window.settings={effectQuality:config.quality,targetFrameRate:30};
    try {
        const [{default:Theme},{WebGLRenderer},{ensureThemeContainer},{setGlobalRenderScale},events,{initViewportBroadcaster}]=await Promise.all([
            import(config.module),import('/src/rendering/renderer.js'),import('/src/themes/theme-registry.js'),
            import('/src/themes/base-theme.js'),import('/src/events/event-bus.js'),import('/src/utils/viewport.js')]);
        setGlobalRenderScale(config.renderScale);initViewportBroadcaster();ensureThemeContainer(config.id);
        window.__mobileEvents=events;
        window.__mobileViewportUnsubscribe=(${installMobileThemeViewportForwarding.toString()})(
            events.eventBus,events.EVENTS,()=>window.__mobileTheme,()=>({width:innerWidth,height:innerHeight}));
        const shared=new WebGLRenderer(document.getElementById('background-canvas'));
        shared.setEffectQuality(config.quality);window.__mobileShared=shared;
        const theme=new Theme();window.__mobileTheme=theme;
        await theme.init();await theme.start(shared,{onRuntimeFailure:error=>{window.__mobileFailure=String(error);}});
        window.__mobileReady=true;
    } catch(error) { window.__mobileFailure=error.stack||String(error); }
    </script></body></html>`;
}

// Browser-side inspection deliberately uses the live production owner and APIs.
function inspectTheme() {
    const theme = window.__mobileTheme;
    const renderer = theme?.renderer;
    const raw = theme?.webgl2;
    const container = document.getElementById(`${theme?.name}-theme`);
    const canvas = renderer?.domElement || raw?.canvas || theme?.simulator?.gl?.canvas;
    const gl = renderer?.backend?.gl || renderer?.getContext?.() || raw?.gl || theme?.simulator?.gl;
    let nodeMaterials = 0;
    let meshes = 0;
    let nonFinite = 0;
    let inspectedAttributeValues = 0;
    theme?.scene?.traverse((object) => {
        if (object.isMesh || object.isPoints || object.isLine) meshes += 1;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material?.isNodeMaterial) nodeMaterials += 1;
        }
        for (const vector of [object.position, object.rotation, object.scale]) {
            if (vector && ![vector.x, vector.y, vector.z].every(Number.isFinite)) nonFinite += 1;
        }
        for (const attribute of Object.values(object.geometry?.attributes || {})) {
            if (!attribute.array) continue;
            // Bounded evenly-spaced samples, including both ends of large buffers.
            const stride = Math.max(1, Math.ceil(attribute.array.length / 10_000));
            for (let index = 0; index < attribute.array.length; index += stride) {
                inspectedAttributeValues += 1;
                if (!Number.isFinite(attribute.array[index])) nonFinite += 1;
            }
            if (attribute.array.length && !Number.isFinite(attribute.array.at(-1))) nonFinite += 1;
        }
    });
    const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
    };
    const qualityKeys = ['activeQualityLevel', 'currentQualityLevel', 'currentQuality', 'qualityName', 'qualityLevel', 'quality'];
    const qualityKey = qualityKeys.find((key) => typeof theme?.[key] === 'string'
        && /^(minimal|low|medium|high|ultra|extreme)$/i.test(theme[key]));
    let quality = qualityKey ? theme[qualityKey] : null;
    let qualityField = qualityKey || null;
    if (!quality && typeof theme?.getCurrentQualityLevel === 'function') {
        quality = theme.getCurrentQualityLevel();
        qualityField = 'getCurrentQualityLevel()';
    }
    if (!quality && typeof theme?.getQualitySetting === 'function') {
        quality = theme.getQualitySetting();
        qualityField = 'getQualitySetting()';
    }
    const backend = renderer?.backend?.isWebGLBackend || renderer?.isWebGLRenderer || gl instanceof WebGL2RenderingContext
        ? 'WebGL2' : gl instanceof WebGLRenderingContext ? 'WebGL1' : null;
    const extension = gl?.getExtension?.('WEBGL_debug_renderer_info');
    return {
        ready: window.__mobileReady === true,
        active: theme?.isActive === true,
        lifecycle: theme?.lifecycleState,
        runtimeFailure: window.__mobileFailure || null,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        rendererKind: renderer?.isWebGPURenderer ? 'WebGPURenderer' : renderer?.isWebGLRenderer ? 'WebGLRenderer' : raw ? 'RawWebGL2' : null,
        backend,
        rendererDescription: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
        nodeMaterials,
        meshes,
        nonFinite,
        inspectedAttributeValues,
        quality,
        qualityField,
        qualityPreset: Object.fromEntries(Object.entries(theme?.qualityPreset || {}).filter(([, value]) => ['number', 'boolean', 'string'].includes(typeof value))),
        qualityMultiplier: theme?.currentQualityMultiplier ?? null,
        visualProfile: theme?.visual ? {
            performanceLevel: theme.visual.performanceLevel ?? null,
            qualityBudget: theme.visual.quality?.key ?? null,
            authoredPixelRatioCap: theme.visual.quality?.pixelRatio ?? null,
        } : null,
        simulatorConfig: Object.fromEntries(Object.entries(theme?.simulator?.config || {}).filter(([, value]) => ['number', 'boolean', 'string'].includes(typeof value))),
        diagnostics: theme?.getDiagnostics?.() || null,
        frame: renderer?.info?.frame ?? renderer?.info?.render?.frame ?? theme?.frameCounter ?? null,
        canvas: canvas ? { width: canvas.width, height: canvas.height, connected: canvas.isConnected } : null,
        pixelRatio: renderer?.getPixelRatio?.() ?? null,
        glError: gl?.getError?.() ?? null,
        visibleContent: Boolean(canvas && visible(canvas)) || [...(container?.querySelectorAll('*') || [])].some(visible),
        fallbackText: container?.textContent?.trim().slice(0, 300) || '',
        livenessRequired: window.__mobileHeartbeat?.required === true,
        heartbeat: window.__mobileHeartbeat?.count || 0,
    };
}

function installHeartbeat() {
    const theme = window.__mobileTheme;
    const owner = theme?.renderer || theme?.webgl2 || theme?.simulator;
    const probe = { count: 0, required: Boolean(owner) };
    window.__mobileHeartbeat = probe;
    for (const key of ['render', 'renderAsync']) {
        const original = owner?.[key];
        if (typeof original !== 'function') continue;
        owner[key] = function mobileRenderHeartbeat(...args) {
            probe.count += 1;
            return original.apply(this, args);
        };
    }
}

async function screenshotStats(page, destination) {
    const png = await page.screenshot({ path: destination, scale: 'css', timeout: 20_000 });
    // Decode the actual Playwright screenshot with the browser's own PNG codec.
    // No pngjs dependency and no WebGL preserveDrawingBuffer/readback assumptions.
    return bounded(page.evaluate(async (dataUrl) => {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const sum = [0, 0, 0]; const squared = [0, 0, 0];
        for (let index = 0; index < pixels.length; index += 4) {
            for (let channel = 0; channel < 3; channel += 1) {
                const value = pixels[index + channel];
                sum[channel] += value; squared[channel] += value * value;
            }
        }
        const count = canvas.width * canvas.height;
        const mean = sum.map((value) => value / count);
        const stdDev = squared.map((value, channel) => Math.sqrt(Math.max(0, value / count - mean[channel] ** 2)));
        return { width: canvas.width, height: canvas.height, mean, stdDev, uniform: Math.max(...stdDev) < 0.02 };
    }, `data:image/png;base64,${png.toString('base64')}`), 20_000, 'Screenshot analysis');
}

async function capturePhase(page, config, entry, phase) {
    await page.evaluate(() => { window.__mobileHeartbeat.count = 0; });
    await page.waitForTimeout(500);
    const state = await bounded(page.evaluate(inspectTheme), 15_000, `${phase} inspection`);
    state.raster = await screenshotStats(page, path.join(config.out, `${entry.id}-${phase}.png`));
    return state;
}

async function runTheme(chromium, config, entry, baseUrl, shell) {
    const result = { id: entry.id, quality: config.quality, expectedMaxPixelRatio: getMobileWebgl2PixelRatioCeiling(entry.id, config), errors: [], warnings: [], requestFailures: [], httpFailures: [] };
    let server;
    let browser;
    try {
        await bounded((async () => {
            server = await chromium.launchServer({
                executablePath: config.executable,
                headless: true,
                args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...config.chromiumArgs],
                timeout: 30_000,
            });
            browser = await chromium.connect(server.wsEndpoint());
            result.browserVersion = browser.version();
            const page = await browser.newPage({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: config.dpr });
            page.on('pageerror', (error) => result.errors.push(error.stack || error.message));
            page.on('crash', () => result.errors.push('Browser page crashed.'));
            page.on('console', (message) => {
                if (message.type() === 'error') result.errors.push(message.text());
                if (message.type() === 'warning') result.warnings.push(message.text());
            });
            page.on('requestfailed', (request) => result.requestFailures.push({ url: request.url(), failure: request.failure() }));
            page.on('response', (response) => {
                if (response.status() >= 400) result.httpFailures.push({ url: response.url(), status: response.status() });
            });
            await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
            await page.route((url) => url.pathname === '/__mobile_webgl2__', (route) => route.fulfill({
                contentType: 'text/html', body: themePage(entry, config, shell),
            }));
            await page.goto(`${baseUrl}/__mobile_webgl2__?forceWebGL=1&noThemeFpsCap=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForFunction(() => window.__mobileReady || window.__mobileFailure, null, { timeout: 60_000 });
            await page.evaluate(installHeartbeat);
            result.portrait = await capturePhase(page, config, entry, 'portrait');
            await page.evaluate(() => {
                const { eventBus, EVENTS } = window.__mobileEvents;
                eventBus.emit(EVENTS.PIECE_LOCK, { piece: { type: 'T' }, type: 'T', position: { x: 5, y: 10 }, lines: 0 });
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, lines: 4, count: 4, linesCleared: 4, comboCount: 5, combo: 5 });
                eventBus.emit(EVENTS.COMBO, { comboCount: 5, combo: 5, count: 5 });
            });
            result.effects = await capturePhase(page, config, entry, 'effects');
            await page.setViewportSize(LANDSCAPE);
            await page.waitForFunction(() => {
                const renderer = window.__mobileTheme?.renderer;
                return !renderer?.domElement || Math.abs(renderer.domElement.width - Math.floor(844 * renderer.getPixelRatio())) <= 1;
            }, null, { timeout: 15_000 });
            result.landscape = await capturePhase(page, config, entry, 'landscape');
        })(), 120_000, `${entry.id} worker`);
    } catch (error) {
        result.failure = error.stack || String(error);
    } finally {
        try {
            if (browser) await bounded(browser.close(), 5_000, 'Browser close');
            if (server) await bounded(server.close(), 5_000, 'Browser process close');
        } catch (error) {
            result.errors.push(error.message);
            server?.process()?.kill('SIGKILL');
        }
    }
    result.failures = mobileWebgl2Failures(result);
    result.status = result.failures.length ? 'fail' : 'pass';
    await writeFile(path.join(config.out, `${entry.id}.json`), JSON.stringify(result, null, 2));
    return result;
}

export async function runMobileWebgl2(argv = process.argv.slice(2)) {
    const config = parseMobileWebgl2Args(argv, ROOT);
    if (config.help) {
        console.log(`Usage: npm run validate:mobile:webgl2 -- [options]
  --theme <id>       Target a registered theme; repeat for several themes
  --all              Run all registered themes (default: 17 representative surfaces)
  --list             Print the selected theme ids without starting a browser
  --quality <tier>   Minimal/Low/Medium/High/Ultra/Extreme (default: Low)
  --dpr <number>     Emulated device pixel ratio (default: 3)
  --render-scale <n> Override the selected tier's normal render scale
  --out <directory>  Reports/screenshots (default: artifacts/mobile-webgl2)
  --executable <p>   Chromium path; also PLAYWRIGHT_EXECUTABLE_PATH
  --help             Show this help
Optional tooling: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
Optional launch flags: PLAYWRIGHT_CHROMIUM_ARGS='["--single-process","--no-zygote"]'.
Every theme gets a fresh browser, serially. Software emulation does not measure phone FPS.`);
        return 0;
    }
    if (config.list) { console.log(config.ids.join('\n')); return 0; }
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
        ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
    const { createServer } = await import('vite');
    const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
    const start = html.indexOf('<div class="background-container">');
    const end = html.indexOf('<div class="game-container single-player-layout"');
    if (start === -1 || end <= start) throw new Error('Production background shell markers changed; update the isolation harness.');
    const shell = html.slice(start, end);
    await mkdir(config.out, { recursive: true });
    const server = await createServer({ root: ROOT, server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false } });
    const results = [];
    const report = {
        schemaVersion: 1,
        environment: { portrait: PORTRAIT, landscape: LANDSCAPE, deviceScaleFactor: config.dpr, globalRenderScale: config.renderScale, quality: config.quality, expectedMaxThemePixelRatio: config.expectedMaxPixelRatio, navigatorGPU: false, forceWebGL: true, serialFreshBrowserPerTheme: true },
        limits: [
            'Phone viewport/touch/DPR are emulated in Chromium; physical Android and iOS hardware are not tested.',
            'Nonuniform screenshots and modern renderer assertions catch compatibility regressions, but do not establish pixel-perfect artwork parity.',
            'Attribute checks sample large buffers; GPU storage values are not read back.',
            'This isolated production-theme harness does not exercise the full game boot or measure phone FPS, battery use, or thermals.',
        ],
        expectedThemeCount: config.ids.length,
        results,
    };
    try {
        await server.listen();
        const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
        for (const id of config.ids) {
            const entry = THEME_REGISTRY.find((item) => item.id === id);
            const result = await runTheme(chromium, config, entry, baseUrl, shell);
            results.push(result);
            report.passed = results.filter((item) => item.status === 'pass').length;
            report.failed = results.filter((item) => item.status === 'fail').length;
            await writeFile(path.join(config.out, 'report.json'), JSON.stringify(report, null, 2));
            console.log(JSON.stringify({ id, status: result.status, backend: result.portrait?.backend, quality: result.portrait?.quality, failures: result.failures }));
        }
    } finally {
        await server.close();
    }
    return mobileWebgl2ExitCode(results, config.ids.length);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runMobileWebgl2().then((code) => { process.exitCode = code; }).catch((error) => {
        console.error('[MobileWebGL2]', error);
        process.exitCode = 1;
    });
}
