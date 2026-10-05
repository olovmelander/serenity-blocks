/**
 * Capture breathing worlds inside the real game: boot index.html, enter Serenity Mode through the
 * menu as a player does, open the shipping guide on each world in turn (the guide swaps worlds in
 * place, so later worlds also exercise the world-change path), and screenshot the page — canvas,
 * words and scrims together. Headless Chromium on SwiftShader, like
 * scripts/capture-breathing-headless.mjs: pixels, not timings (ADR-0016). Under software rendering
 * the game draws about a frame a second, so a run takes minutes.
 *
 * Usage (a Vite dev server must be running):
 *   node scripts/capture-breathing-ingame.mjs --worlds=zen-garden,calm-sleep --width=1440 --height=900
 *   node scripts/capture-breathing-ingame.mjs --worlds=coherence --width=390 --height=844   (phone: Low tier)
 *
 *   --baseUrl=URL   dev server (default http://127.0.0.1:5173)
 *   --out=DIR       where screenshots go (default artifacts/breathing-ingame)
 *   --backend=webgl2  force the WebGL2 backend
 *   --shots=N       screenshots per world, 8 s apart (default 1)
 */
/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop, no-console */
/* global GPUTexture */
import { execSync } from 'child_process';
import { mkdir } from 'fs/promises';
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

const BASE = String(args.baseUrl || 'http://127.0.0.1:5173');
const OUT = path.resolve(process.cwd(), String(args.out || path.join('artifacts', 'breathing-ingame')));
const WORLDS = String(args.worlds || 'forest-breath').split(',');
const WIDTH = Number(args.width || 1440);
const HEIGHT = Number(args.height || 900);
const WEBGL = args.backend === 'webgl2';
const SHOTS = Number(args.shots || 1);
const LAUNCH = WEBGL
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
        '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const NOISE = /vite\]|GL Driver Message|WebGPU Context Provider|ReadPixels|Automatic fallback/;

const { chromium } = await loadPlaywright();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: LAUNCH });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const problems = [];
try {
    // A peer's save must not reload the page mid-capture: never let the HMR socket connect.
    await page.routeWebSocket(/.*/, () => {});
    // Harness-only: this Chromium predates the string form of GPUTextureViewDescriptor.swizzle.
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
    page.on('console', (message) => {
        const text = message.text();
        if ((message.type() === 'error' || message.type() === 'warning') && !NOISE.test(text)) problems.push(`${message.type()}: ${text.slice(0, 300)}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${String(error.message).slice(0, 300)}`));
    const t0 = Date.now();
    await page.goto(`${BASE}/index.html?skipIntro=1${WEBGL ? '&forceWebGL=1' : ''}`, { timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.breathingIndicator), null, { timeout: 240000 });
    // Enter Serenity Mode through the menu; the guide lives inside it.
    await page.waitForSelector('#serenity-card-btn', { state: 'visible', timeout: 240000 });
    await page.click('#serenity-card-btn', { timeout: 240000 });
    await page.waitForTimeout(6000);
    console.log('serenity mode entered after', Math.round((Date.now() - t0) / 1000), 's');
    for (const world of WORLDS) {
        await page.evaluate((id) => {
            const guide = window.breathingIndicator;
            guide.setTechnique(id);
            if (!guide.isActive) guide.start();
        }, world);
        await page.waitForFunction((id) => {
            const root = document.querySelector('.breath-guide');
            return root?.classList.contains('is-live') && window.breathingIndicator?.stage?.worldId === id;
        }, world, { timeout: 240000 }).catch(() => problems.push(`timeout waiting for ${world} to go live`));
        for (let shot = 0; shot < SHOTS; shot++) {
            // Let the dawn transition finish and the breath move a little.
            await page.waitForTimeout(shot === 0 ? 4000 : 8000);
            const suffix = SHOTS > 1 ? `-s${shot}` : '';
            const file = path.join(OUT, `game-${world}-${WEBGL ? 'webgl2' : 'webgpu'}-${WIDTH}x${HEIGHT}${suffix}.png`);
            await page.screenshot({ path: file, timeout: 240000 });
            console.log(file);
        }
        console.log(world, JSON.stringify(await page.evaluate(() => window.breathingIndicator?.stage?.getDiagnostics?.() ?? null)));
    }
} catch (error) {
    problems.push(`error: ${String(error?.message || error).slice(0, 500)}`);
} finally {
    await browser.close();
}
console.log('problems', JSON.stringify(problems, null, 1));
process.exit(problems.some((problem) => problem.startsWith('error') || problem.startsWith('pageerror')) ? 1 : 0);
