/**
 * Capture the Hale sessions inside the real game: the catalogue with your practice, the
 * preparation screen, the countdown, a session's stages (arrival, a round's card, an open hold
 * counting up and then ready to end, the recovery, Rest's soft pause, Flow's rhythm kept on your
 * own, the natural rest and the closing) and the result with its holds and a new best.
 *
 * It boots index.html, enters Serenity Mode through the menu, opens the Hub's Hale tab and drives
 * the flow with clicks; stages are stepped through the session manager (a real session is twenty
 * minutes). A few days of practice are seeded first so the streak and best-hold lines show.
 * Headless Chromium on SwiftShader, like scripts/capture-breathing-ingame.mjs: pixels, not timings
 * (ADR-0016).
 *
 * Usage (a Vite dev server must be running):
 *   node scripts/capture-hale-sessions.mjs                      desktop, 1440×900
 *   node scripts/capture-hale-sessions.mjs --width=390 --height=844 --shots=phone
 *
 *   --baseUrl=URL      dev server (default http://127.0.0.1:5173)
 *   --out=DIR          where screenshots go (default artifacts/hale-sessions)
 *   --backend=webgl2   force the WebGL2 backend
 *   --shots=all|phone  which steps to capture (phone: preparation, a ready hold, the result)
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
const OUT = path.resolve(process.cwd(), String(args.out || path.join('artifacts', 'hale-sessions')));
const WIDTH = Number(args.width || 1440);
const HEIGHT = Number(args.height || 900);
const WEBGL = args.backend === 'webgl2';
const PHONE = args.shots === 'phone';
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
const size = `${WIDTH}x${HEIGHT}`;

/** Freeze CSS animations at `ms` so a title card or a rising bar is caught mid-way, every run. */
async function freezeAnimations(ms) {
    await page.evaluate((at) => {
        document.getAnimations().forEach((animation) => {
            animation.pause();
            animation.currentTime = at;
        });
    }, ms);
}

async function shot(name, { freezeAt = null } = {}) {
    if (freezeAt !== null) await freezeAnimations(freezeAt);
    const file = path.join(OUT, `hale-${name}-${size}.png`);
    await page.screenshot({ path: file, timeout: 240000 });
    console.log(file);
}

/** Wait until the world behind the guide is drawn (or give up and capture the CSS guide). */
async function worldLive() {
    await page.waitForFunction(() => document.querySelector('.breath-guide')?.classList.contains('is-live'), null, { timeout: 300000 })
        .catch(() => problems.push('world did not go live in time'));
    await page.waitForTimeout(1500);
}

/** Load a world behind the guide and wait until it is drawn. */
async function prewarm(world) {
    await page.evaluate((id) => window.breathingIndicator.setTechnique(id), world);
    await worldLive();
}

/**
 * Jump the running session to one of its stages, its world loaded first: under software
 * rendering a world takes many seconds to compile, longer than a pause or a title card lasts.
 */
async function stage(index) {
    const world = await page.evaluate((i) => {
        const manager = window.serenityBlocks.serenityHub.sessionManager;
        return manager._worldFor(manager.activeSession.phases[i]);
    }, index);
    await prewarm(world);
    await page.evaluate((i) => {
        const manager = window.serenityBlocks.serenityHub.sessionManager;
        manager.currentPhaseIndex = i;
        manager._runPhase();
    }, index);
    await page.waitForTimeout(700);
}

/** Pretend the current stage began `seconds` ago (the clock the progress reports read). */
async function elapsed(seconds) {
    await page.evaluate((ms) => {
        window.serenityBlocks.serenityHub.sessionManager.phaseStartTime = Date.now() - ms;
    }, seconds * 1000);
    await page.waitForTimeout(500);
}

try {
    await page.routeWebSocket(/.*/, () => {});
    await page.addInitScript(() => {
        // A few days of practice, so the streak, the week and the best hold have something to say.
        if (!localStorage.getItem('serenity.haleSessions')) {
            const day = (days) => Date.now() - days * 86400000;
            const open = (round, seconds, suggested) => ({
                round, seconds, suggested, mode: 'open',
            });
            const entry = (id, days, seconds, breaths, holds = []) => ({
                id, at: day(days), seconds, completed: true, rounds: 3, breaths, holds,
            });
            const entries = [
                entry('REST', 3, 1100, 37),
                entry('BASE', 2, 1530, 110, [open(1, 64, 60), open(2, 88, 90), open(3, 102, 120)]),
                entry('FLOW', 1, 1460, 45),
            ];
            localStorage.setItem('serenity.haleSessions', JSON.stringify({
                v: 2, count: 3, seconds: 4090, last: { id: 'FLOW', at: day(1) }, entries,
            }));
        }
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
    await page.goto(`${BASE}/index.html?skipIntro=1${WEBGL ? '&forceWebGL=1' : ''}`, { timeout: 120000 });
    await page.waitForSelector('#serenity-card-btn', { state: 'visible', timeout: 240000 });
    await page.click('#serenity-card-btn', { timeout: 240000 });
    await page.waitForFunction(() => Boolean(window.serenityBlocks?.serenityHub), null, { timeout: 240000 });
    await page.waitForTimeout(5000);

    // The catalogue, with your practice.
    await page.evaluate(() => {
        const hub = window.serenityBlocks.serenityHub;
        hub.switchTab('sessions');
        hub.show();
    });
    await page.waitForSelector('.hale-card__begin', { state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1500);
    if (!PHONE) await shot('catalogue');

    // Preparation for Hale Base: the journey, the guidance switches, the safety note.
    await page.click('.hale-card__begin[data-session="BASE"]', { timeout: 60000 });
    await page.waitForSelector('.hale-flow__panel--prepare:not([hidden])', { timeout: 60000 });
    await page.click('.hale-flow__intention[data-intention="calm"]');
    await page.waitForTimeout(1200);
    await shot('prepare-base');
    await page.click('.hale-flow__ack');
    if (!PHONE) {
        await page.click('.hale-flow__begin');
        await page.waitForTimeout(1300);
        await shot('countdown');
    } else {
        await page.click('.hale-flow__begin');
    }
    await page.waitForFunction(() => window.breathingIndicator?.isExternallyControlled, null, { timeout: 60000 });
    await worldLive();
    if (!PHONE) {
        // The arrival card has long faded by the time a software world compiles: show it again.
        await page.evaluate(() => {
            const manager = window.serenityBlocks.serenityHub.sessionManager;
            manager._presentStage(manager.activeSession.phases[0]);
        });
        await shot('arrive', { freezeAt: 1400 });
        await stage(1);
        await shot('round-card', { freezeAt: 1300 });
    }

    // An open hold: counting up toward its suggestion, then past it and ready to end.
    await stage(2);
    await elapsed(42);
    if (!PHONE) await shot('hold-open', { freezeAt: 3400 });
    await elapsed(72);
    await page.evaluate(() => window.serenityBlocks.serenityHub.sessionManager._holdReady());
    await page.waitForTimeout(800);
    await shot('hold-ready', { freezeAt: 3400 });

    if (!PHONE) {
        // Breathing in ends the hold: the recovery breath (its world loaded first).
        await prewarm('coherence');
        await page.click('.breath-guide__button--breathe');
        await page.waitForTimeout(800);
        await shot('recovery');
        // The rest, breathed naturally, and its closing.
        await stage(10);
        await shot('rest-natural', { freezeAt: 1400 });
        // The closing comes minutes into the rest, long after the rest's card has gone.
        await page.evaluate(() => {
            window.breathingIndicator._hideChapter();
            window.serenityBlocks.serenityHub.sessionManager._closing();
        });
        await page.waitForTimeout(1200);
        await shot('closing', { freezeAt: 3400 });
    }

    // The result: three measured holds, the last a new best (the seeded best is 1:42).
    await page.evaluate(() => {
        const manager = window.serenityBlocks.serenityHub.sessionManager;
        manager.sessionStartTime = Date.now() - 1508000;
        manager.measure = {
            breaths: 110,
            rounds: 3,
            holds: [
                {
                    round: 1, seconds: 72, suggested: 60, mode: 'open', endedBy: 'you',
                },
                {
                    round: 2, seconds: 101, suggested: 90, mode: 'open', endedBy: 'you',
                },
                {
                    round: 3, seconds: 131, suggested: 120, mode: 'open', endedBy: 'you',
                },
            ],
        };
        manager.currentPhaseIndex = manager.activeSession.phases.length - 1;
        manager._nextPhase();
    });
    await page.waitForSelector('.hale-flow__panel--complete:not([hidden])', { timeout: 60000 });
    await page.waitForTimeout(2000);
    await shot('result', { freezeAt: 5000 });

    if (!PHONE) {
        // Rest's soft pause, and Flow's rhythm kept on your own.
        await page.click('.hale-flow__finish');
        for (const [sessionId, index, name, shift] of [['REST', 2, 'rest-pause', 8000], ['FLOW', 2, 'flow-carry', 12000]]) {
            await page.evaluate((id) => {
                const tab = window.serenityBlocks.serenityHub.sessionsTab;
                tab.startSession(id);
            }, sessionId);
            await worldLive();
            await stage(index);
            await elapsed(shift / 1000);
            await shot(name, { freezeAt: 3400 });
            await page.evaluate(() => window.serenityBlocks.serenityHub.sessionsTab.stopSession());
            await page.waitForTimeout(1000);
        }
        // The catalogue again: the practice recorded above.
        await page.evaluate(() => {
            const hub = window.serenityBlocks.serenityHub;
            hub.switchTab('sessions');
            hub.show();
        });
        await page.waitForTimeout(1500);
        await shot('catalogue-after');
    }
    console.log('diagnostics', JSON.stringify(await page.evaluate(() => window.breathingIndicator?.stage?.getDiagnostics?.() ?? null)));
} catch (error) {
    problems.push(`error: ${String(error?.message || error).slice(0, 500)}`);
} finally {
    await browser.close();
}
console.log('problems', JSON.stringify(problems, null, 1));
process.exit(problems.some((problem) => problem.startsWith('error') || problem.startsWith('pageerror')) ? 1 : 0);
