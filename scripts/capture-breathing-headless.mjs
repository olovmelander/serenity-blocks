/**
 * Capture the breathing worlds from the playground (`?effect=breathing`) in headless Chromium,
 * with no GPU: WebGPU runs on SwiftShader's Vulkan adapter and the WebGL2 backend on ANGLE's
 * SwiftShader. This is the instrument for Linux cloud sessions, where Electron has no GPU and
 * scripts/capture-breathing.mjs cannot run. Pixels match the hardware path; timings do not, so
 * nothing this script records is a performance figure (ADR-0016).
 *
 * Usage (a Vite dev server must be running; options are --key=value):
 *   node scripts/capture-breathing-headless.mjs --sheet=pairs
 *   node scripts/capture-breathing-headless.mjs --sheet=portrait,webgl --worlds=forest-breath
 *   node scripts/capture-breathing-headless.mjs --sheet=motion --worlds=deep-relaxation
 *   node scripts/capture-breathing-headless.mjs --sheet=single --worlds=calm-sleep --breath=0.8
 *   node scripts/capture-breathing-headless.mjs --posters
 *
 *   --baseUrl=URL      dev server (default http://127.0.0.1:5173)
 *   --out=DIR          where sheets go (default artifacts/breathing-headless)
 *   --sheet=a,b        pairs | portrait | webgl | motion | single | tiers (default pairs)
 *   --posters          write public/assets/breathing/<id>.webp, the stills the Hub's cards show
 *   --worlds=a,b       limit to these technique ids
 *   --breath=0..1      lung fill for `single` (default 0.75)
 *   --phase=0..3       breath phase for `single` (0 in, 1 hold full, 2 out, 3 hold empty; default
 *                      0, or 1 at full lungs) and --progress=0..1 through it (default 0.8)
 *   --t=SECONDS        scene time (default 12)
 *   --width/--height   viewport for `single` (default 1280x720)
 *   --quality=TIER     tier for `single` (default High)
 *   --backend=webgl2   run `single` on the WebGL2 backend
 *   --shaders          also report the largest WGSL modules compiled (size, not time: a proxy for
 *                      compile cost, which grows faster than the shader on some drivers)
 *
 * Playwright is not a project dependency: the script uses a local copy when there is one and the
 * global install otherwise (cloud images ship it with Chromium under PLAYWRIGHT_BROWSERS_PATH).
 */
/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop, no-console */
/* global GPUTexture, GPUDevice */
import { execSync } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
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

const ROOT = process.cwd();
const BASE = String(args.baseUrl || 'http://127.0.0.1:5173');
const OUT = path.resolve(ROOT, String(args.out || path.join('artifacts', 'breathing-headless')));
const POSTER_DIR = path.join(ROOT, 'public', 'assets', 'breathing');
const SCENE_TIME = Number(args.t ?? 12);
const WORLDS = [
    ['deep-relaxation', 'Aurora Dreams', [5, 2, 7, 2]], ['box-breathing', 'Sacred Geometry', [4, 4, 4, 4]],
    ['calm-sleep', 'Moonlit Waters', [4, 7, 8, 0]], ['energizing', 'Solar Flare', [3, 1, 3, 1]],
    ['coherence', 'Heart Glow', [5, 0, 5, 0]], ['triangle', 'Crystal Prism', [4, 0, 4, 4]],
    ['wim-hof', 'Volcanic Fire', [2, 0, 1, 0]], ['ocean-breath', 'Ocean Tide', [4, 0, 4, 0]],
    ['zen-garden', 'Zen Garden', [6, 3, 6, 3]], ['cosmic-breath', 'Cosmic Nebula', [5, 3, 5, 3]],
    ['forest-breath', 'Ancient Forest', [4, 2, 6, 2]], ['electric-storm', 'Electric Storm', [3, 2, 4, 1]],
].filter(([id]) => !args.worlds || String(args.worlds).split(',').includes(id));

const BACKENDS = {
    webgpu: {
        query: '',
        launch: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
            '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
    webgl2: {
        query: '&forceWebGL=1',
        launch: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
};

/** Lung fill at `t` seconds into a pattern, as the guide resolves it (cosine-eased phases). */
function breathAt(pattern, t) {
    const cycle = pattern.reduce((sum, seconds) => sum + seconds, 0);
    let rest = ((t % cycle) + cycle) % cycle;
    for (let phase = 0; phase < 4; phase++) {
        const duration = pattern[phase];
        if (duration > 0 && rest < duration) {
            const progress = rest / duration;
            const ease = 0.5 - 0.5 * Math.cos(Math.PI * progress);
            const breath = [ease, 1, 1 - ease, 0][phase];
            return { breath, phase, progress };
        }
        rest -= duration;
    }
    return { breath: 0, phase: 3, progress: 1 };
}

// Runs in the page. Returns one data URL per tile, or one contact sheet when `cols` is set.
const RENDER_TILES = `async (tiles, cols, tileWidth, type, quality) => {
    const source = document.querySelector('#stage canvas');
    const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const draw = async (tile) => {
        const lab = window.__BREATH_LAB__;
        lab.setWorld(tile.world);
        lab.setSession(tile.session || null);
        lab.setBreath({ breath: tile.breath, phase: tile.phase, progress: tile.progress });
        // A tile may carry the scene clock and the breath integral that a real run would have reached.
        lab.seekClock?.(tile.t, tile.breathInt);
        window.__PLAYGROUND__.seek(tile.t);
        await raf(); await raf();
        window.__PLAYGROUND__.seek(tile.t);
    };
    if (!cols) {
        const stills = [];
        for (const tile of tiles) {
            await draw(tile);
            stills.push(source.toDataURL(type, quality));
        }
        return stills;
    }
    const height = Math.round(tileWidth * source.height / source.width);
    const sheet = document.createElement('canvas');
    sheet.width = cols * tileWidth;
    sheet.height = Math.ceil(tiles.length / cols) * height;
    const context = sheet.getContext('2d');
    for (let i = 0; i < tiles.length; i++) {
        await draw(tiles[i]);
        const x = (i % cols) * tileWidth;
        const y = Math.floor(i / cols) * height;
        context.drawImage(source, x, y, tileWidth, height);
        context.font = '600 13px system-ui';
        context.fillStyle = 'rgba(0,0,0,.55)';
        context.fillRect(x, y, context.measureText(tiles[i].label).width + 14, 22);
        context.fillStyle = '#fff';
        context.fillText(tiles[i].label, x + 7, y + 15);
    }
    return [sheet.toDataURL(type, quality)];
}`;

const tile = (world, label, breath, phase = 0, progress = 0.8, extra = {}) => ({
    world, label, breath, phase, progress, t: SCENE_TIME, ...extra,
});

/** Frames across one real breath cycle, with the clock and breath integral a live run would have. */
function motionTiles(id, name, pattern) {
    const cycle = pattern.reduce((sum, seconds) => sum + seconds, 0);
    const frames = 8;
    return Array.from({ length: frames }, (_, index) => {
        const t = SCENE_TIME + (cycle * index) / frames;
        const state = breathAt(pattern, t - SCENE_TIME);
        // The integral of the eased breath over whole cycles is half the time spent breathing.
        const breathInt = t * 0.5;
        return tile(id, `${name} · t+${(t - SCENE_TIME).toFixed(1)}s · ${state.breath.toFixed(2)}`, state.breath, state.phase, state.progress, { t, breathInt });
    });
}

function jobs() {
    const breath = Number(args.breath ?? 0.75);
    return {
        posters: {
            backend: 'webgpu',
            width: 720,
            height: 450,
            query: '',
            type: 'image/webp',
            quality: 0.8,
            tiles: WORLDS.map(([id, name]) => tile(id, name, 0.85)),
        },
        pairs: {
            backend: 'webgpu',
            width: 1280,
            height: 720,
            query: '',
            cols: 4,
            tileWidth: 480,
            tiles: WORLDS.flatMap(([id, name]) => [tile(id, `${name} · empty`, 0, 3, 0.5), tile(id, `${name} · full`, 1, 1, 0.5)]),
        },
        portrait: {
            backend: 'webgpu',
            width: 390,
            height: 844,
            query: '&focus=0.24&quality=Low',
            cols: 6,
            tileWidth: 300,
            tiles: WORLDS.map(([id, name]) => tile(id, name, 0.7)),
        },
        webgl: {
            backend: 'webgl2',
            width: 1280,
            height: 720,
            query: '&quality=Medium',
            cols: 4,
            tileWidth: 480,
            tiles: WORLDS.map(([id, name]) => tile(id, name, 0.7)),
        },
        tiers: {
            backend: 'webgpu',
            width: 960,
            height: 540,
            query: '',
            cols: 3,
            tileWidth: 480,
            perTileQuality: true,
            tiles: WORLDS.flatMap(([id, name]) => ['High', 'Low', 'Minimal'].map((q) => tile(id, `${name} · ${q}`, 0.7, 0, 0.8, { quality: q }))),
        },
        motion: {
            backend: 'webgpu',
            width: 960,
            height: 540,
            query: '',
            cols: 4,
            tileWidth: 480,
            tiles: WORLDS.flatMap(([id, name, pattern]) => motionTiles(id, name, pattern)),
        },
        single: {
            backend: args.backend === 'webgl2' ? 'webgl2' : 'webgpu',
            width: Number(args.width || 1280),
            height: Number(args.height || 720),
            query: `&quality=${args.quality || 'High'}${args.focus ? `&focus=${args.focus}` : ''}`,
            type: 'image/png',
            tiles: WORLDS.map(([id, name]) => {
                let phase = breath >= 1 ? 1 : 0;
                if (args.phase !== undefined) phase = Number(args.phase);
                return tile(id, name, breath, phase, Number(args.progress ?? 0.8));
            }),
        },
    };
}

const NOISE = /vite\] (failed to connect|connecting|connected)|Security Warning|GL Driver Message \(OpenGL, Performance|Failed to create WebGPU Context Provider|GPU stall due to ReadPixels|Automatic fallback to software WebGL/;

async function run(chromium, name, job) {
    const backend = BACKENDS[job.backend];
    const browser = await chromium.launch({ headless: true, args: backend.launch });
    const problems = [];
    const report = { name, backend: job.backend, problems };
    try {
        const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
        // A peer's save must not reload the page mid-capture: never let the HMR socket connect.
        await page.routeWebSocket(/.*/, () => {});
        // Harness-only: this Chromium predates the string form of GPUTextureViewDescriptor.swizzle
        // that three r186 sends; current Chrome accepts it. Shipped code is untouched.
        await page.addInitScript(() => {
            if (typeof GPUTexture === 'undefined') return;
            const original = GPUTexture.prototype.createView;
            GPUTexture.prototype.createView = function createView(descriptor) {
                if (descriptor && typeof descriptor.swizzle === 'string') {
                    const { swizzle, ...rest } = descriptor;
                    return original.call(this, rest);
                }
                return original.call(this, descriptor);
            };
        });
        if (args.shaders) {
            await page.addInitScript(() => {
                if (typeof GPUDevice === 'undefined') return;
                window.__SHADER_SIZES__ = [];
                const create = GPUDevice.prototype.createShaderModule;
                GPUDevice.prototype.createShaderModule = function createShaderModule(descriptor) {
                    window.__SHADER_SIZES__.push({ label: descriptor?.label || '', bytes: descriptor?.code?.length || 0 });
                    return create.call(this, descriptor);
                };
            });
        }
        page.on('console', (message) => {
            const level = message.type();
            if ((level === 'error' || level === 'warning') && !NOISE.test(message.text())) problems.push(`${level}: ${message.text().slice(0, 600)}`);
        });
        page.on('pageerror', (error) => problems.push(`pageerror: ${String(error?.message || error).slice(0, 600)}`));
        const groups = job.perTileQuality
            ? [...new Set(job.tiles.map((t) => t.quality))].map((q) => ({ q, tiles: job.tiles.filter((t) => t.quality === q) }))
            : [{ q: null, tiles: job.tiles }];
        const images = [];
        for (const group of groups) {
            const query = `${job.query}${backend.query}${group.q ? `&quality=${group.q}` : ''}`;
            await page.goto(`${BASE}/playground.html?effect=breathing&orbit=0&hud=0&t=${SCENE_TIME}&world=${group.tiles[0].world}&breath=0.5${query}`, { timeout: 90000 });
            await page.waitForFunction(() => window.__PLAYGROUND_READY__ === true || window.__PLAYGROUND_ERROR__, null, { timeout: 240000 });
            const error = await page.evaluate(() => window.__PLAYGROUND_ERROR__ || null);
            if (error) throw new Error(String(error).slice(0, 1200));
            report.renderer = await page.evaluate(() => window.__PLAYGROUND__.backend());
            const type = job.type || 'image/jpeg';
            const cols = job.perTileQuality ? 0 : (job.cols || 0);
            const result = await page.evaluate(
                `(${RENDER_TILES})(${JSON.stringify(group.tiles)}, ${cols}, ${job.tileWidth || 0}, '${type}', ${job.quality || 0.9})`,
            );
            images.push(...result.map((data, index) => ({ data, tile: group.tiles[index] })));
            report.diagnostics = await page.evaluate(() => window.__PLAYGROUND__.diagnostics?.() ?? null);
            if (args.shaders) {
                report.shaders = await page.evaluate(() => {
                    const list = window.__SHADER_SIZES__ || [];
                    return {
                        modules: list.length,
                        totalBytes: list.reduce((sum, entry) => sum + entry.bytes, 0),
                        largest: [...list].sort((a, b) => b.bytes - a.bytes).slice(0, 4),
                    };
                });
            }
        }
        const bytes = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
        report.files = [];
        if (name === 'posters') {
            await mkdir(POSTER_DIR, { recursive: true });
            for (const { data, tile: t } of images) {
                const file = path.join(POSTER_DIR, `${t.world}.webp`);
                await writeFile(file, bytes(data));
                report.files.push(file);
            }
        } else if (job.perTileQuality) {
            // Stitch per-tier stills into one sheet in node: three columns, one row per world.
            const { data } = await composeSheet(browser, images.map((image) => image.data), job, images.map((image) => image.tile.label));
            await mkdir(OUT, { recursive: true });
            const file = path.join(OUT, `breathing-${name}.jpg`);
            await writeFile(file, bytes(data));
            report.files.push(file);
        } else if (name === 'single') {
            await mkdir(OUT, { recursive: true });
            for (const { data, tile: t } of images) {
                const file = path.join(OUT, `${t.world}-${job.backend}-${job.width}x${job.height}-b${Number(t.breath).toFixed(2)}.png`);
                await writeFile(file, bytes(data));
                report.files.push(file);
            }
        } else {
            await mkdir(OUT, { recursive: true });
            const file = path.join(OUT, `breathing-${name}${args.worlds ? `-${String(args.worlds).replace(/,/g, '+')}` : ''}.jpg`);
            await writeFile(file, bytes(images[0].data));
            report.files.push(file);
        }
    } catch (error) {
        report.error = String(error?.message || error);
    } finally {
        await browser.close();
    }
    return report;
}

/** Lay stills out on one sheet (used when tiles came from separate page loads). */
async function composeSheet(browser, dataUrls, job, labels) {
    const page = await browser.newPage();
    const data = await page.evaluate(async ({
        urls, cols, tileWidth, names,
    }) => {
        const load = (url) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = url; });
        const imgs = await Promise.all(urls.map(load));
        const height = Math.round((tileWidth * imgs[0].height) / imgs[0].width);
        const sheet = document.createElement('canvas');
        sheet.width = cols * tileWidth;
        sheet.height = Math.ceil(imgs.length / cols) * height;
        const ctx = sheet.getContext('2d');
        // Tiles arrive grouped by tier; lay them out one world per row.
        const perGroup = imgs.length / cols;
        imgs.forEach((img, i) => {
            const group = Math.floor(i / perGroup);
            const row = i % perGroup;
            const x = group * tileWidth;
            const y = row * height;
            ctx.drawImage(img, x, y, tileWidth, height);
            ctx.font = '600 13px system-ui';
            ctx.fillStyle = 'rgba(0,0,0,.55)';
            ctx.fillRect(x, y, ctx.measureText(names[i]).width + 14, 22);
            ctx.fillStyle = '#fff';
            ctx.fillText(names[i], x + 7, y + 15);
        });
        return sheet.toDataURL('image/jpeg', 0.9);
    }, {
        urls: dataUrls, cols: job.cols, tileWidth: job.tileWidth, names: labels,
    });
    await page.close();
    return { data };
}

const { chromium } = await loadPlaywright();
const all = jobs();
const names = [];
if (args.posters) names.push('posters');
if (args.sheet) names.push(...String(args.sheet).split(',').filter((name) => all[name]));
if (!names.length) names.push('pairs');
const reports = [];
for (const name of names) {
    const started = Date.now();
    const report = await run(chromium, name, all[name]);
    report.seconds = Math.round((Date.now() - started) / 100) / 10;
    reports.push(report);
}
console.log(JSON.stringify(reports, null, 1));
process.exit(reports.some((report) => report.error) ? 1 : 0);
