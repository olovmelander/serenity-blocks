/**
 * Prove that a change left the breathing worlds' pictures alone: render a fixed set of frames from
 * a build to PNG, then compare two such sets pixel by pixel. The instrument for performance work
 * that must not change the look (docs/BREATHING_PERF_PASS_2026-10.md): run it on the commit
 * before (a second worktree and dev server) and on the change, then compare.
 *
 * Two renderers:
 *   - default: headless Chromium (Playwright) on SwiftShader (WebGPU on its Vulkan adapter, the
 *     WebGL2 backend on ANGLE), as scripts/capture-breathing-headless.mjs does. The reference: two
 *     captures of the same build agree to the bit, on any machine that has it. Chromium on Windows
 *     blocks software WebGPU, so there the WebGPU sets cannot run this way, and the capture stops
 *     rather than measure the WebGL2 fallback under a WebGPU set's name.
 *   - --gpu: Electron on the discrete GPU (the driver's own compiler, D3D12 on Windows): the same
 *     sets and file names, so the same --compare reads them. Run it through Electron:
 *       node scripts/run-electron.mjs scripts/breathing-pixel-identity.mjs --capture --gpu ...
 *     A driver compiles the WGSL its own way, so capture the build before twice and compare those
 *     first: only then does a difference belong to the change.
 * Pixels, not timings: nothing here is a performance figure (ADR-0016).
 *
 * Usage (options are --key=value):
 *   node scripts/breathing-pixel-identity.mjs --capture --baseUrl=http://127.0.0.1:5174 --out=artifacts/identity/before
 *   node scripts/breathing-pixel-identity.mjs --capture --baseUrl=http://127.0.0.1:5173 --out=artifacts/identity/after
 *   node scripts/breathing-pixel-identity.mjs --compare=artifacts/identity/before --with=artifacts/identity/after
 *
 *   --sets=a,b       moods | lungs | moment | phone | minimal | webgl (default: all six, 120 frames)
 *   --worlds=a,b     limit to these technique ids
 *   --tolerance=N    largest channel difference (0..255) that still counts as identical (default 0)
 */
/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop, no-console */
/* global GPUTexture */
import { execSync } from 'child_process';
import {
    mkdir, readdir, readFile, writeFile,
} from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.join('=') || true];
}));

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
        return createRequire(path.join(root, '/'))('playwright');
    }
}

const WORLDS = ['deep-relaxation', 'box-breathing', 'calm-sleep', 'energizing', 'coherence', 'triangle',
    'wim-hof', 'ocean-breath', 'zen-garden', 'cosmic-breath', 'forest-breath', 'electric-storm']
    .filter((id) => !args.worlds || String(args.worlds).split(',').includes(id));

const LAUNCH = {
    webgpu: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
        '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    webgl2: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

/** What each set renders: every world (in every mood for `moods`), at pinned clock, seed and breath. */
const SETS = {
    moods: {
        backend: 'webgpu',
        width: 1280,
        height: 720,
        query: '&quality=High',
        allMoods: true,
        tiles: [{
            breath: 0.75, phase: 0, progress: 0.8, t: 12,
        }],
    },
    lungs: {
        backend: 'webgpu',
        width: 1280,
        height: 720,
        query: '&quality=High',
        tiles: [{
            breath: 0, phase: 3, progress: 0.5, t: 12,
        }, {
            breath: 1, phase: 1, progress: 0.5, t: 12,
        }],
    },
    moment: {
        backend: 'webgpu',
        width: 1280,
        height: 720,
        query: '&quality=High',
        tiles: [{
            breath: 0.4, phase: 2, progress: 0.3, t: 47.3, seed: 0.21,
        }],
    },
    phone: {
        backend: 'webgpu',
        width: 390,
        height: 844,
        query: '&quality=Low&focus=0.24',
        tiles: [{
            breath: 0.7, phase: 0, progress: 0.8, t: 12,
        }],
    },
    minimal: {
        backend: 'webgpu',
        width: 960,
        height: 540,
        query: '&quality=Minimal',
        tiles: [{
            breath: 0.7, phase: 0, progress: 0.8, t: 12,
        }],
    },
    webgl: {
        backend: 'webgl2',
        width: 1280,
        height: 720,
        query: '&quality=Medium&forceWebGL=1',
        tiles: [{
            breath: 0.7, phase: 0, progress: 0.8, t: 12,
        }],
    },
};

const NOISE = /vite\] (failed to connect|connecting|connected)|Security Warning|GL Driver Message|Failed to create WebGPU Context Provider|GPU stall due to ReadPixels|Automatic fallback to software WebGL|No available adapters/;

/** Harness-only: this Chromium predates the string form of GPUTextureViewDescriptor.swizzle three r186 sends. */
function stripSwizzle() {
    if (typeof GPUTexture === 'undefined') return;
    const original = GPUTexture.prototype.createView;
    GPUTexture.prototype.createView = function createView(descriptor) {
        if (descriptor && typeof descriptor.swizzle === 'string') {
            const { swizzle, ...rest } = descriptor;
            return original.call(this, rest);
        }
        return original.call(this, descriptor);
    };
}

/** In the page: show one tile's world, mood, seed and breath, draw it, and return the frame as a PNG. */
const DRAW_TILE = async ({ id, m, s }) => {
    const raf = () => new Promise((resolve) => { requestAnimationFrame(resolve); });
    const lab = window.__BREATH_LAB__;
    lab.setWorld(id, m, s.seed ?? 0.5);
    lab.setSession(null);
    lab.setBreath({ breath: s.breath, phase: s.phase, progress: s.progress });
    window.__PLAYGROUND__.seek(s.t);
    await raf();
    await raf();
    window.__PLAYGROUND__.seek(s.t);
    return document.querySelector('#stage canvas').toDataURL('image/png');
};

const playgroundUrl = (base, set) => `${base}/playground.html?effect=breathing&orbit=0&hud=0&t=12`
    + `&world=${WORLDS[0]}&breath=0.5${set.query}`;
const tileFile = (world, mood, tile) => `${world}__m${mood}__b${tile.breath}_p${tile.phase}_t${tile.t}`
    + `${tile.seed !== undefined ? `_s${tile.seed}` : ''}.png`;
const NO_SOFTWARE_WEBGPU = ': this Chromium has no software WebGPU here; capture with --gpu';
const backendMismatch = (set, backend) => (set.backend === 'webgpu' && !/^WebGPU/.test(backend || '')
    ? `the page runs on ${backend || 'no backend'}, not WebGPU${args.gpu ? '' : NO_SOFTWARE_WEBGPU}`
    : null);

/** Every tile of a set, drawn in one page through `evaluate(fn, arg)`, written as PNGs. */
async function drawTiles(evaluate, name, set, out) {
    const dir = path.join(out, name);
    await mkdir(dir, { recursive: true });
    let count = 0;
    for (const world of WORLDS) {
        const moods = set.allMoods ? await evaluate((id) => window.__BREATH_LAB__.moods(id).length, world) : 1;
        for (let mood = 0; mood < Math.max(1, moods); mood++) {
            for (const tile of set.tiles) {
                const data = await evaluate(DRAW_TILE, { id: world, m: mood, s: tile });
                await writeFile(path.join(dir, tileFile(world, mood, tile)), Buffer.from(data.split(',')[1], 'base64'));
                count += 1;
            }
        }
    }
    return count;
}

async function captureSet(chromium, name, set, base, out) {
    const browser = await chromium.launch({ headless: true, args: LAUNCH[set.backend] });
    const problems = [];
    let count = 0;
    try {
        const page = await browser.newPage({ viewport: { width: set.width, height: set.height }, deviceScaleFactor: 1 });
        // A save elsewhere must not reload the page mid-capture: never let the HMR socket connect.
        await page.routeWebSocket(/.*/, () => {});
        await page.addInitScript(stripSwizzle);
        page.on('console', (message) => {
            if (['error', 'warning'].includes(message.type()) && !NOISE.test(message.text())) problems.push(message.text().slice(0, 400));
        });
        page.on('pageerror', (error) => problems.push(`pageerror: ${String(error?.message || error).slice(0, 400)}`));
        await page.goto(playgroundUrl(base, set), { timeout: 90000 });
        await page.waitForFunction(() => window.__PLAYGROUND_READY__ === true || window.__PLAYGROUND_ERROR__, null, { timeout: 300000 });
        const error = await page.evaluate(() => window.__PLAYGROUND_ERROR__ || null);
        if (error) throw new Error(String(error).slice(0, 1200));
        const mismatch = backendMismatch(set, await page.evaluate(() => window.__PLAYGROUND__.backend()));
        if (mismatch) throw new Error(`${name}: ${mismatch}`);
        count = await drawTiles((fn, arg) => page.evaluate(fn, arg), name, set, out);
    } finally {
        await browser.close();
    }
    return { set: name, frames: count, problems };
}

/** The same set in Electron on the discrete GPU: one shown, off-screen window at a scale of 1. */
async function captureSetGpu(electron, name, set, base, out) {
    const { BrowserWindow, session } = electron;
    const partition = `breathing-identity-${name}`;
    session.fromPartition(partition).webRequest.onBeforeRequest(
        { urls: [`${base.replace('http', 'ws')}/*`] },
        (_details, callback) => callback({ cancel: true }),
    );
    const win = new BrowserWindow({
        width: set.width,
        height: set.height,
        useContentSize: true,
        frame: false,
        thickFrame: false,
        resizable: false,
        show: false,
        x: -6000,
        y: -6000,
        webPreferences: { backgroundThrottling: false, partition },
    });
    win.setPosition(-6000, -6000);
    win.showInactive();
    const problems = [];
    win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2 && !NOISE.test(message)) problems.push(message.slice(0, 400));
    });
    const run = (fn, arg) => win.webContents.executeJavaScript(`(${fn})(${JSON.stringify(arg)})`);
    const report = { set: name, frames: 0, problems };
    try {
        await win.loadURL(playgroundUrl(base, set));
        const started = Date.now();
        for (;;) {
            const state = await win.webContents.executeJavaScript(
                '({ ready: window.__PLAYGROUND_READY__ === true, error: window.__PLAYGROUND_ERROR__ || null })',
            ).catch(() => ({ ready: false, error: null }));
            if (state.error) throw new Error(String(state.error).slice(0, 1200));
            if (state.ready) break;
            if (Date.now() - started > 300000) throw new Error('the playground never became ready');
            await new Promise((resolve) => { setTimeout(resolve, 150); });
        }
        const [w, h] = await win.webContents.executeJavaScript('[innerWidth, innerHeight]');
        if (w !== set.width || h !== set.height) {
            throw new Error(`${name}: window ${w}x${h}, not ${set.width}x${set.height}`);
        }
        report.backend = await win.webContents.executeJavaScript('window.__PLAYGROUND__.backend()');
        report.adapter = await win.webContents.executeJavaScript(`(() => {
            const info = window.__PLAYGROUND__.renderer().backend.device?.adapterInfo;
            return info ? info.vendor + ' ' + info.architecture : null;
        })()`);
        const mismatch = backendMismatch(set, report.backend);
        if (mismatch) throw new Error(`${name}: ${mismatch}`);
        report.frames = await drawTiles(run, name, set, out);
    } catch (error) {
        report.error = String(error?.message || error);
    } finally {
        win.destroy();
    }
    return report;
}

/** Compare every PNG of `before` with its namesake in `after`, decoding both in a page. */
async function compare(chromium, before, after) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const rows = [];
    try {
        const sets = (await readdir(before, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        for (const set of sets) {
            const names = (await readdir(path.join(before, set))).filter((name) => name.endsWith('.png'))
                .filter((name) => WORLDS.includes(name.split('__')[0]));
            for (const name of names) {
                let other;
                try {
                    other = await readFile(path.join(after, set, name));
                } catch {
                    rows.push({ set, name, missing: true });
                    continue;
                }
                const mine = await readFile(path.join(before, set, name));
                const result = await page.evaluate(async ({ a, b }) => {
                    const pixels = async (b64) => {
                        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob(), {
                            premultiplyAlpha: 'none', colorSpaceConversion: 'none',
                        });
                        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                        const context = canvas.getContext('2d');
                        context.drawImage(bitmap, 0, 0);
                        return { w: bitmap.width, h: bitmap.height, d: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
                    };
                    const [x, y] = await Promise.all([pixels(a), pixels(b)]);
                    if (x.w !== y.w || x.h !== y.h) return { shape: true };
                    let max = 0;
                    let differ = 0;
                    for (let i = 0; i < x.d.length; i += 4) {
                        const d = Math.max(Math.abs(x.d[i] - y.d[i]), Math.abs(x.d[i + 1] - y.d[i + 1]), Math.abs(x.d[i + 2] - y.d[i + 2]));
                        if (d > 0) differ += 1;
                        if (d > max) max = d;
                    }
                    return { max, share: differ / (x.d.length / 4) };
                }, { a: mine.toString('base64'), b: other.toString('base64') });
                rows.push({ set, name, ...result });
            }
        }
    } finally {
        await browser.close();
    }
    return rows;
}

const base = String(args.baseUrl || 'http://127.0.0.1:5173');
const out = path.resolve(String(args.out || path.join('artifacts', 'breathing-identity')));
const names = args.sets ? String(args.sets).split(',').filter((name) => SETS[name]) : Object.keys(SETS);

if (args.capture && args.gpu) {
    if (!process.versions.electron) {
        console.log('--gpu captures in Electron: node scripts/run-electron.mjs scripts/breathing-pixel-identity.mjs --capture --gpu ...');
        process.exit(2);
    }
    const { default: electron } = await import('electron');
    const { app } = electron;
    app.commandLine.appendSwitch('force_high_performance_gpu');
    // A hidden or occluded window runs requestAnimationFrame at a few hertz.
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    // CSS pixels are canvas pixels, as in the SwiftShader captures (deviceScaleFactor 1).
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    app.on('window-all-closed', () => { /* one window per set, made after the last one goes */ });
    // Not awaited at the top level: Electron is ready only once this module has run.
    app.whenReady().then(async () => {
        const reports = [];
        for (const name of names) reports.push(await captureSetGpu(electron, name, SETS[name], base, out));
        console.log(JSON.stringify({ out, gpu: true, reports }, null, 1));
        app.exit(reports.some((report) => report.error || report.problems.length) ? 1 : 0);
    });
} else if (args.capture) {
    const { chromium } = await loadPlaywright();
    const reports = [];
    for (const name of names) reports.push(await captureSet(chromium, name, SETS[name], base, out));
    console.log(JSON.stringify({ out, reports }, null, 1));
    process.exit(reports.some((report) => report.problems.length) ? 1 : 0);
} else if (args.compare && args.with) {
    const { chromium } = await loadPlaywright();
    const tolerance = Number(args.tolerance ?? 0);
    const rows = await compare(chromium, path.resolve(String(args.compare)), path.resolve(String(args.with)));
    const bad = rows.filter((row) => row.missing || row.shape || row.max > tolerance);
    rows.filter((row) => row.max > 0 || row.missing || row.shape).forEach((row) => {
        console.log(`${row.missing ? 'MISSING' : `max ${row.max} on ${(row.share * 100).toFixed(3)}% of pixels`}  ${row.set}/${row.name}`);
    });
    const worst = rows.reduce((top, row) => Math.max(top, row.max || 0), 0);
    console.log(`${rows.length} frames compared, worst channel difference ${worst}/255, ${bad.length} over the tolerance (${tolerance})`);
    process.exit(bad.length ? 1 : 0);
} else {
    console.log('Use --capture --baseUrl=… --out=DIR (add --gpu, through Electron, for the discrete GPU), '
        + 'or --compare=DIR --with=DIR (see the header of this file).');
    process.exit(2);
}
