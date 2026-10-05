/**
 * Reproducible Chiral Gold visual smoke captures, using the shipped scene/event path.
 * Run: node scripts/chiral-gold-visual-validation.mjs playground|theme [--native] [--mobile] [--low]
 * Supply PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE when Playwright is not installed locally.
 * Software GPU captures establish render correctness, not physical-device frame rates.
 */
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const args = new Set(process.argv.slice(2));
const mode = args.has('playground') ? 'playground' : 'theme';
const native = args.has('--native');
const mobile = args.has('--mobile');
const quality = args.has('--low') || mobile ? 'Low' : 'High';
const prefix = `${mode}-${native ? 'webgpu' : 'webgl2'}-${mobile ? 'phone' : 'desktop'}-${quality.toLowerCase()}`;
const artifactDir = path.resolve('reports/chiral-gold-overhaul');
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

async function step(frames) {
    await page.evaluate(async (count) => {
        const theme = window.__CHIRAL_THEME__;
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
    }, frames);
}

async function capture(state) {
    const diagnostics = await page.evaluate((currentMode) => {
        if (currentMode === 'playground') {
            const api = window.__PLAYGROUND__;
            return { backend: api.backend(), diagnostics: api.diagnostics() };
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
        };
    }, mode);
    if (native && !diagnostics.backend.startsWith('WebGPU')) {
        throw new Error(`Requested native WebGPU, received ${diagnostics.backend}`);
    }
    if (native && mode === 'theme' && quality === 'High') {
        const unready = Object.entries(diagnostics.compute).filter(([, value]) => !value?.ready);
        if (unready.length) throw new Error(`Native compute not ready: ${unready.map(([key]) => key).join(', ')}`);
    }
    const name = `${prefix}-${state}`;
    await page.screenshot({ path: path.join(artifactDir, `${name}.png`), scale: 'css' });
    snapshots.push({ state, diagnostics });
    await writeFile(path.join(artifactDir, `${name}.json`), JSON.stringify(diagnostics, null, 2));
    console.log(`[ChiralGoldCapture] ${name}: ${diagnostics.backend}`);
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
        await page.goto(`${origin}/playground.html?${params}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__PLAYGROUND_READY__ || window.__PLAYGROUND_ERROR__, null, { timeout: 120000 });
        const playgroundError = await page.evaluate(() => window.__PLAYGROUND_ERROR__);
        if (playgroundError) throw new Error(playgroundError);
        await page.locator('#hud').evaluate((element) => { element.style.display = 'none'; }).catch(() => {});
        await capture('idle');
    } else {
        await page.goto(`${origin}/__chiral-gold-validation.html?${params}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__CHIRAL_READY__, null, { timeout: 120000 });
        await step(3);
        await capture('idle');
        await page.evaluate(() => window.__CHIRAL_EVENT__('PIECE_LOCK', { piece: { shape: [[1, 1, 1, 1]], x: 3, y: 16 } }));
        await step(8);
        await capture('lock');
        await page.evaluate(() => window.__CHIRAL_EVENT__('LINE_CLEAR', { lineCount: 4, comboCount: 1, clearedRows: [16, 17, 18, 19] }));
        await step(10);
        await capture('clear');
        await page.evaluate(() => {
            window.__CHIRAL_EVENT__('COMBO', { comboCount: 8 });
            window.__CHIRAL_EVENT__('LINE_CLEAR', { lineCount: 4, comboCount: 8, clearedRows: [16, 17, 18, 19] });
        });
        await step(12);
        await capture('combo');
        if (mobile) {
            await page.setViewportSize({ width: 844, height: 390 });
            await page.evaluate(() => window.__CHIRAL_THEME__.onWindowResize());
            await step(120);
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
    await writeFile(path.join(artifactDir, `${prefix}-validation.json`), JSON.stringify({
        generatedAt: new Date().toISOString(), softwareGpu: true, mode, native, mobile, quality,
        passed: !failure && !errors.length, errors, warnings, snapshots, teardown, failure,
    }, null, 2));
    await browser?.close();
    await server.close();
}
