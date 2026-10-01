/* eslint-disable no-await-in-loop */
// Single Ocean surface, isolated browser; optional PLAYWRIGHT_MODULE for local tooling.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { THEME_PERF_BOOTSTRAP, quantile } from './lib/theme-perf-instrument.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const url = process.argv[2] || 'http://localhost:5173/playground.html?effect=ocean-reef-light&t=8&profile=1&trackTimestamp=1';
const out = path.resolve(process.argv[3] || 'reports/ocean-refinement/study');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const messages = [];
function recordMessage(message) {
    const existing = messages.find((entry) => entry.type === message.type && entry.text === message.text);
    if (existing) existing.count += 1;
    else messages.push({ ...message, count: 1 });
}
let capturePage;
try {
    const captureParams = new URL(url).searchParams;
    const page = await browser.newPage({
        viewport: {
            width: Number(captureParams.get('width') || 1280),
            height: Number(captureParams.get('height') || 800),
        },
        deviceScaleFactor: 1,
    });
    capturePage = page;
    // Capture one settled revision even when unrelated work triggers Vite HMR.
    await page.routeWebSocket((socketUrl) => socketUrl.host === new URL(url).host, () => {});
    await page.addInitScript({ content: THEME_PERF_BOOTSTRAP });
    await page.addInitScript(() => {
        let seed = 481516;
        Math.random = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };
    });
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            recordMessage({ type: msg.type(), text: msg.text() });
            console.log(msg.type(), msg.text().slice(0, 350));
        }
    });
    page.on('pageerror', (error) => recordMessage({ type: 'error', text: error.message, stack: error.stack }));
    page.on('crash', () => recordMessage({ type: 'error', text: 'Browser page crashed during Ocean capture' }));
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) console.log('Navigation', frame.url());
    });
    console.log('Loading', url);
    const shipping = url.includes('/ocean-capture.html');
    if (shipping) {
        await page.route((requestUrl) => requestUrl.pathname === '/ocean-capture.html', (route) => route.fulfill({
            contentType: 'text/html', body: '<html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#ocean-theme{position:fixed;inset:0}</style><div id="ocean-theme"></div></html>',
        }));
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (shipping) {
        await page.evaluate(async () => {
            const params = new URLSearchParams(window.location.search);
            const quality = params.get('quality') || 'High';
            window.settings = {
                graphicsQuality: quality, effectQuality: quality, effectScale: 1, targetFps: 60,
            };
            const { default: OceanTheme } = await import(params.get('module') || '/src/themes/ocean/ocean-theme.js');
            const ocean = new OceanTheme();
            window.ocean = ocean;
            window.__OCEAN_COUNTERS__ = [];
            window.perfMonitor = {
                startSection() {},
                endSection() {},
                recordCounters(value) {
                    if (window.__OCEAN_MEASURING__) window.__OCEAN_COUNTERS__.push(value);
                },
            };
            await ocean.start({ loadTheme() {} });
            await ocean.deferredMaterialLoadPromise;
            if (ocean.currentQuality !== quality && !ocean.webglFallbackClamped) {
                throw new Error(`Quality pin failed: requested ${quality}, rendered ${ocean.currentQuality}`);
            }
            const time = Number(params.get('t') || 8);
            ocean.clock.getDelta = () => { ocean.clock.elapsedTime = time; return 1 / 60; };
            ocean.oceanCamera.nextSwitchAt = Infinity;
            ocean.oceanCamera.setPointer(Number(params.get('pointerX') || 0), Number(params.get('pointerY') || 0));
            if (params.has('mood')) ocean.oceanCamera.setMood(params.get('mood'));
            const waitUntil = performance.now() + 20000;
            while (!ocean.atmosphereSystem?.isSceneReady() && performance.now() < waitUntil) {
                await new Promise((resolve) => { setTimeout(resolve, 100); });
            }
            window.__OCEAN_CAPTURE_READY__ = true;
        });
    }
    await page.waitForFunction(() => window.__PLAYGROUND_READY__ || window.__OCEAN_CAPTURE_READY__, { timeout: 60000 });
    await page.waitForFunction(() => window.__OCEAN_CAPTURE_READY__
        || window.__PLAYGROUND__?.diagnostics()?.loaded !== false, { timeout: 30000 });
    await page.evaluate(() => {
        document.querySelectorAll('#hud, .hud, #drop-hint').forEach((el) => { el.style.display = 'none'; });
        window.__PLAYGROUND__?.profile.reset();
    });
    if (shipping) {
        await page.waitForTimeout(3000);
        await page.evaluate(() => {
            window.__THEME_PERF_RESET__();
            window.__OCEAN_MEASURING__ = true;
            window.__THEME_PERF__.startLane();
        });
    }
    await page.waitForTimeout(6000);
    if (shipping) {
        await page.evaluate(() => {
            const canvases = [...document.querySelectorAll('canvas')];
            if (canvases.length !== 1 || !document.querySelector('#ocean-theme')?.contains(canvases[0])) {
                throw new Error(`Ocean isolation failed: found ${canvases.length} canvases or an unrelated application surface`);
            }
        });
    }
    if (shipping && captureParams.has('combo')) {
        await page.evaluate(async (combo) => {
            const eventModule = '/src/events/event-bus.js';
            const { eventBus, EVENTS } = await import(eventModule);
            eventBus.emit(EVENTS.COMBO, { comboCount: combo });
            for (let frame = 0; frame < 18; frame++) {
                await new Promise((resolve) => { requestAnimationFrame(resolve); });
            }
            window.ocean.clock.getDelta = () => 0;
        }, Number(captureParams.get('combo')));
    }
    if (captureParams.get('board') === '1') {
        await page.evaluate(() => {
            const board = document.createElement('div');
            board.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
                + 'width:240px;height:480px;border-radius:18px;background:rgba(6,18,32,.82);'
                + 'border:1px solid rgba(110,220,230,.25);box-shadow:0 0 25px #031b2a80';
            document.body.appendChild(board);
        });
    }
    await page.evaluate(() => {
        if (!document.querySelector('canvas') || (!window.__PLAYGROUND_READY__ && !window.__OCEAN_CAPTURE_READY__)) {
            throw new Error('Ocean capture lost its ready canvas before the screenshot.');
        }
    });
    await page.screenshot({ path: path.join(out, 'capture.png') });
    const result = await page.evaluate(async () => ({
        adapter: await (async () => {
            const info = (await navigator.gpu?.requestAdapter())?.info;
            return info ? {
                vendor: info.vendor,
                architecture: info.architecture,
                device: info.device,
                description: info.description,
            } : null;
        })(),
        backend: window.__PLAYGROUND__?.backend() || window.ocean?.getBackendLabel(),
        diagnostics: window.__PLAYGROUND__?.diagnostics() || window.ocean?.collectSignoffSnapshot(),
        profile: window.__PLAYGROUND__?.profile.snapshot(),
        measured: window.ocean ? (() => {
            const s = window.__THEME_PERF__;
            s.stopLane();
            window.__OCEAN_MEASURING__ = false;
            return {
                ...s.rings,
                calls: window.__OCEAN_COUNTERS__.map((c) => c.calls),
                tris: window.__OCEAN_COUNTERS__.map((c) => c.triangles),
            };
        })() : null,
    }));
    if (result.measured) {
        result.measurementSummary = Object.fromEntries(
            Object.entries(result.measured).map(([key, values]) => [key, {
                samples: values.length, p50: quantile(values, 0.5), p95: quantile(values, 0.95),
            }]),
        );
    }
    await writeFile(path.join(out, 'result.json'), JSON.stringify({ url, ...result, messages }, null, 2));
    console.log(JSON.stringify({
        out, backend: result.backend, profile: result.profile, measured: result.measurementSummary, messages,
    }));
    if (messages.some((msg) => msg.type === 'error')) process.exitCode = 1;
} catch (error) {
    console.error(error);
    console.error(JSON.stringify(messages));
    if (capturePage && !capturePage.isClosed()) {
        await capturePage.screenshot({ path: path.join(out, 'failed-capture.png') }).catch(() => {});
        await writeFile(path.join(out, 'failed-page.html'), await capturePage.content()).catch(() => {});
    }
    process.exitCode = 1;
} finally {
    await browser.close();
}
