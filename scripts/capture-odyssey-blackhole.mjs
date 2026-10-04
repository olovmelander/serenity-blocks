/**
 * Capture Chapter 7 approach, horizon crossing and warp in the isolated shipping scene.
 * Optional tooling: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
 * Software rendering verifies shader compatibility/artwork, not hardware FPS.
 *
 * node scripts/capture-odyssey-blackhole.mjs --out artifacts/odyssey-blackhole
 * --offscreenWebGPU renders through a GPU target/readback when the container's
 * native WebGPU canvas presentation is unavailable; shader/material code is unchanged.
 * --falls 0,.12,.24,.32,.44,.56,.7,.81,.9,.99 --phases 8 selects progress/time.
 * --root /absolute/path/to/worktree captures a separate baseline checkout.
 * --particles 600 overrides the chapter particle budget for both quality profiles.
 * PLAYWRIGHT_EXECUTABLE_PATH selects a locally installed Chromium/headless shell.
 */
/* eslint-disable no-await-in-loop, import/no-extraneous-dependencies */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const OUT = path.resolve(ROOT, args.out || 'artifacts/odyssey-blackhole');
const FALLS = String(args.falls || '0,.12,.24,.32,.44,.56,.7,.81,.9,.99')
    .split(',')
    .map(Number);
const PHASES = String(args.phases || '8')
    .split(',')
    .map(Number);
const LANE = args.lane || 'both';
const ERR = /WGSL|ShaderModule|RenderPipeline|TSL:|No stack defined|validation error|device lost|compilation error/i;
const SOURCE_FILES = [
    'src/playground/effects/ch7-fall.effect.js',
    'src/rendering/odyssey/OdysseyCameraController.js',
    'src/rendering/odyssey/chapter-environments/black-hole-transcendence.js',
    'src/rendering/odyssey/chapter-environments/black-hole-transcendence.tsl.js',
    'src/rendering/odyssey/transitions/odyssey-black-hole-fall.js',
];
const profiles = [
    {
        id: 'desktop', width: 1280, height: 720, tier: 'High',
    },
    {
        id: 'portrait', width: 390, height: 844, tier: 'Low',
    },
].filter((entry) => !args.profile || args.profile === entry.id);

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const [key, inline] = token.slice(2).split('=');
        if (inline !== undefined) result[key] = inline;
        else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
            result[key] = argv[index + 1];
            index += 1;
        } else result[key] = true;
    }
    return result;
}

async function sourceFingerprint() {
    const hashes = await Promise.all(SOURCE_FILES.map(async (file) => [
        file,
        createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex'),
    ]));
    return Object.fromEntries(hashes);
}

function inspect() {
    const renderer = window.__PLAYGROUND__?.renderer?.();
    const camera = window.__PLAYGROUND__?.camera?.();
    return {
        ready: window.__PLAYGROUND_READY__ === true,
        error: window.__PLAYGROUND_ERROR__ || null,
        backend: window.__PLAYGROUND__?.backend?.(),
        effect: window.__PLAYGROUND__?.diagnostics?.(),
        fall: window.__CH7_FALL__?.getFall?.() || null,
        chapterBounds: window.__CH7_FALL__
            ? { start: window.__CH7_FALL__.ch7Start, end: window.__CH7_FALL__.ch8Start }
            : null,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        canvas: { width: renderer?.domElement.width, height: renderer?.domElement.height },
        camera: camera
            ? {
                position: camera.position.toArray(),
                quaternion: camera.quaternion.toArray(),
                fov: camera.fov,
            }
            : null,
        renderer: { frame: renderer?.info?.frame, calls: renderer?.info?.render?.calls },
    };
}

async function runProfile(browser, baseUrl, lane, profile) {
    const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: 1,
        isMobile: profile.id === 'portrait',
        hasTouch: profile.id === 'portrait',
    });
    const page = await context.newPage();
    const result = {
        id: `${lane}-${profile.id}`, profile, console: [], frames: [], failures: [],
    };
    if (lane === 'webgpu' && args.offscreenWebGPU) {
        await page.route(
            (url) => url.pathname === '/src/playground/main.js',
            async (route) => {
                const response = await route.fetch();
                const source = (await response.text()).replace(
                    'stage.appendChild(renderer.domElement);',
                    `stage.appendChild(renderer.domElement);
        window.__captureRenderTarget = new THREE.RenderTarget(window.innerWidth, window.innerHeight, { samples: 4 });
        window.__captureRenderTarget.texture.colorSpace = THREE.SRGBColorSpace;
        renderer.setRenderTarget(window.__captureRenderTarget);`,
                );
                await route.fulfill({ response, body: source });
            },
        );
    }
    page.on('console', (message) => result.console.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => result.failures.push(error.stack || error.message));
    page.on('crash', () => result.failures.push('Browser page crashed.'));
    try {
        const params = new URLSearchParams({
            effect: 'ch7-fall',
            t: String(PHASES[0]),
            motion: '1',
            fallT: String(FALLS[0]),
            orbit: '0',
            tier: profile.tier,
        });
        if (args.particles) params.set('particles', args.particles);
        if (lane === 'webgl2') params.set('forceWebGL', '1');
        result.url = `${baseUrl}/playground.html?${params}`;
        await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(
            () => window.__PLAYGROUND_READY__ || window.__PLAYGROUND_ERROR__,
            null,
            { timeout: 90_000 },
        );
        const state = await page.evaluate(inspect);
        if (state.error) throw new Error(state.error);
        if (lane === 'webgpu' && !state.backend?.startsWith('WebGPU')) {
            throw new Error(`Expected WebGPU, got ${state.backend}.`);
        }
        if (lane === 'webgl2' && state.backend !== 'WebGL2') throw new Error(`Expected WebGL2, got ${state.backend}.`);
        await page.waitForTimeout(400);
        await page.evaluate(() => {
            window.__PLAYGROUND__.renderer().setAnimationLoop(null);
        });
        await page.addStyleTag({
            content: '#hud, .hud, header, aside, .controls { visibility: hidden !important; }',
        });
        const variant = 'shipping';
        for (const fall of FALLS) {
            for (const time of PHASES) {
                await page.evaluate(({ progress, phase }) => {
                    window.__CH7_FALL__.setFallT(progress);
                    window.__PLAYGROUND__.seek(phase);
                }, { progress: fall, phase: time });
                await page.waitForTimeout(150);
                const progressTag = String(fall).replace('.', '-');
                const timeTag = String(time).replace('.', '-');
                const name = `${result.id}-${variant}-fall${progressTag}-t${timeTag}.png`;
                const stateAtPhase = await page.evaluate(inspect);
                if (stateAtPhase.error) throw new Error(stateAtPhase.error);
                if (lane === 'webgpu' && args.offscreenWebGPU) {
                    await page.evaluate(async () => {
                        const renderer = window.__PLAYGROUND__.renderer();
                        const target = window.__captureRenderTarget;
                        const { width, height } = target;
                        await renderer.backend.device.queue.onSubmittedWorkDone();
                        const pixels = await renderer.readRenderTargetPixelsAsync(
                            target,
                            0,
                            0,
                            width,
                            height,
                        );
                        let canvas = document.getElementById('__captureReadback');
                        if (!canvas) {
                            canvas = document.createElement('canvas');
                            canvas.id = '__captureReadback';
                            canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:5';
                            document.body.appendChild(canvas);
                        }
                        canvas.width = width;
                        canvas.height = height;
                        // GPU readback rows align to 256 bytes (390px portrait rows are padded).
                        const packed = new Uint8ClampedArray(width * height * 4);
                        const stride = Math.ceil((width * 4) / 256) * 256;
                        for (let row = 0; row < height; row += 1) {
                            packed.set(
                                pixels.subarray(row * stride, row * stride + width * 4),
                                row * width * 4,
                            );
                        }
                        canvas
                            .getContext('2d')
                            .putImageData(new ImageData(packed, width, height), 0, 0);
                    });
                }
                const image = await page.screenshot({
                    path: path.join(OUT, name),
                    scale: 'css',
                    timeout: 30_000,
                });
                const raster = await page.evaluate(async (base64) => {
                    const bitmap = new Image();
                    bitmap.src = `data:image/png;base64,${base64}`;
                    await bitmap.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const context2d = canvas.getContext('2d', { willReadFrequently: true });
                    context2d.drawImage(bitmap, 0, 0);
                    const pixels = context2d.getImageData(0, 0, canvas.width, canvas.height).data;
                    let sum = 0;
                    let sumSquared = 0;
                    for (let index = 0; index < pixels.length; index += 4) {
                        const value = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
                        sum += value;
                        sumSquared += value * value;
                    }
                    const count = pixels.length / 4;
                    const mean = sum / count;
                    return {
                        width: canvas.width,
                        height: canvas.height,
                        mean,
                        stdDev: Math.sqrt(Math.max(0, sumSquared / count - mean * mean)),
                    };
                }, image.toString('base64'));
                if (raster.stdDev < 0.1) result.failures.push(`Uniform screenshot ${name}.`);
                result.frames.push({
                    file: name, variant, fall, time, state: stateAtPhase, raster,
                });
            }
        }
    } catch (error) {
        result.failures.push(error.stack || String(error));
    } finally {
        await context.close();
    }
    result.failures.push(
        ...result.console
            .filter((entry) => entry.type === 'error' || ERR.test(entry.text))
            .map((entry) => entry.text),
    );
    result.status = result.failures.length ? 'fail' : 'pass';
    await writeFile(path.join(OUT, `${result.id}.json`), JSON.stringify(result, null, 2));
    console.log(
        `${result.id}: ${result.status}; ${result.frames.length} screenshots; ${result.failures.length} errors.`,
    );
    return result;
}

const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const { createServer } = await import('vite');
const server = args.baseUrl
    ? null
    : await createServer({
        root: ROOT,
        cacheDir: path.join(OUT, 'vite-cache'),
        optimizeDeps: { noDiscovery: true, include: [] },
        server: {
            host: '127.0.0.1', port: 0, strictPort: true, hmr: false,
        },
    });
const report = {
    schemaVersion: 1,
    softwareRendering: true,
    effect: 'ch7-fall',
    falls: FALLS,
    phases: PHASES,
    sourceSHA256: await sourceFingerprint(),
    offscreenWebGPU: Boolean(args.offscreenWebGPU),
    limits: [
        'Isolated chapter only; no full journey.',
        'Production Chapter 7 environment, path and camera; journey post processing and Chapter 8 city are absent.',
        'Software browser rendering does not establish phone or physical GPU performance.',
        ...(args.offscreenWebGPU
            ? [
                'WebGPU renders to a GPU target and uses readback; native canvas presentation is not exercised.',
            ]
            : []),
    ],
    results: [],
};
let browser;
try {
    await mkdir(OUT, { recursive: true });
    if (server) await server.listen();
    const baseUrl = args.baseUrl || server.resolvedUrls.local[0].replace(/\/$/, '');
    for (const lane of LANE === 'both' ? ['webgpu', 'webgl2'] : [LANE]) {
        browser = await chromium.launch({
            executablePath: args.executable || process.env.PLAYWRIGHT_EXECUTABLE_PATH,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--ignore-gpu-blocklist',
                '--enable-unsafe-swiftshader',
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--in-process-gpu',
                '--disable-gpu-sandbox',
                ...(lane === 'webgpu'
                    ? [
                        '--enable-unsafe-webgpu',
                        '--enable-features=Vulkan',
                        '--use-webgpu-adapter=swiftshader',
                    ]
                    : []),
            ],
            timeout: 30_000,
        });
        report.browserVersion = browser.version();
        for (const profile of profiles) report.results.push(await runProfile(browser, baseUrl, lane, profile));
        await browser.close();
        browser = null;
    }
} finally {
    if (browser) await browser.close();
    if (server) await server.close();
    report.sourceStable = JSON.stringify(report.sourceSHA256) === JSON.stringify(await sourceFingerprint());
    report.status = report.sourceStable
        && report.results.length
        && report.results.every((entry) => entry.status === 'pass')
        ? 'pass'
        : 'fail';
    await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
if (report.status !== 'pass') process.exitCode = 1;
