/**
 * Isolated shipping breathing/session capture. No gameplay theme or audio is started.
 *
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
 * PLAYWRIGHT_EXECUTABLE_PATH=/absolute/path/to/chrome-headless-shell
 * node scripts/capture-breathing-overhaul.mjs --out /tmp/breathing-captures
 * Optional: --profile desktop|portrait|landscape --technique deep-relaxation --sessions 0
 * --uiOnly recaptures library/session UI after copy/layout changes without repeating worlds.
 * Software-browser frame timings establish compatibility/work bounds, not device FPS.
 */
/* eslint-disable no-await-in-loop, import/no-extraneous-dependencies */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
    const token = process.argv[index];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=');
    args[key] = inline ?? (process.argv[index + 1]?.startsWith('--') || !process.argv[index + 1]
        ? true : process.argv[++index]);
}
const ROOT = path.resolve(args.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const OUT = path.resolve(args.out || '/tmp/breathing-overhaul-captures');
const profiles = [
    { id: 'desktop', width: 1440, height: 900, quality: 'High', mobile: false },
    { id: 'portrait', width: 390, height: 844, quality: 'Low', mobile: true },
    { id: 'landscape', width: 844, height: 390, quality: 'Low', mobile: true },
].filter((entry) => !args.profile || args.profile === entry.id);
const files = [
    'index.html',
    'src/core/game-modes/SerenityMode.js',
    'src/ui/serenity-hub/SerenityHub.js',
    'src/ui/effects/threejs-breathing-renderer.js',
    'src/ui/effects/breathing-atmosphere.js',
    'src/ui/effects/enhanced-breathing-indicator.js',
    'src/ui/effects/breathwork-session-manager.js',
    'src/ui/serenity-hub/SessionsTab.js',
    'src/ui/serenity-hub/BreathingTab.js',
    'public/styles/main.css',
    'public/styles/serenity-hub.css',
    'public/styles/serenity-hub-aaa.css',
    'public/styles/breathing-immersive.css',
    'public/styles/breathwork-sessions.css',
    'public/styles/breathing-library.css',
];
async function fingerprint() {
    return Object.fromEntries(await Promise.all(files.map(async (file) => [
        file, createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex'),
    ])));
}

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles/fonts.css"><link rel="stylesheet" href="/styles/cosmic-tokens.css">
<link rel="stylesheet" href="/styles/main.css"><link rel="stylesheet" href="/styles/serenity-hub.css">
<link rel="stylesheet" href="/styles/serenity-hub-aaa.css"><link rel="stylesheet" href="/styles/breathing-immersive.css">
<link rel="stylesheet" href="/styles/breathwork-sessions.css">
<link rel="stylesheet" href="/styles/breathing-library.css">
<style>html,body{margin:0;min-width:0;width:100%;height:100%;overflow:hidden}
body{background:radial-gradient(ellipse at 35% 30%,#133448 0%,#0e1429 46%,#070b16 100%)}
</style></head><body><div class="serenity-hub-backdrop visible" id="capture-hub-backdrop"></div>
<div class="serenity-hub-panel open" id="serenity-hub-panel">
<div class="hub-panel-header"><h2 class="hub-title">Serenity Hub</h2><button class="hub-close-btn" aria-label="Close Serenity Hub">×</button></div>
<nav class="hub-tabs"><button class="hub-tab active">Breathwork journeys</button></nav>
<div class="hub-tab-content"><div class="tab-panel active" id="tab-sessions"></div><div class="tab-panel" id="tab-breathing"></div></div></div>
</body></html>`;

async function boot() {
    const NativeResizeObserver = window.ResizeObserver;
    window.__BREATHING_RESIZES__ = [];
    window.ResizeObserver = class extends NativeResizeObserver {
        constructor(callback) {
            super((entries, observer) => {
                window.__BREATHING_RESIZES__.push(entries.map((entry) => ({
                    width: entry.contentRect.width, height: entry.contentRect.height,
                    className: entry.target.className,
                })));
                callback(entries, observer);
            });
        }
    };
    const { EnhancedBreathingIndicator } = await import('/src/ui/effects/enhanced-breathing-indicator.js');
    const { BreathworkSessionManager } = await import('/src/ui/effects/breathwork-session-manager.js');
    const { SessionsTab } = await import('/src/ui/serenity-hub/SessionsTab.js');
    const { BreathingTab } = await import('/src/ui/serenity-hub/BreathingTab.js');
    const indicator = new EnhancedBreathingIndicator(document.body);
    const manager = new BreathworkSessionManager(indicator);
    manager.audioManager?.destroy();
    manager.audioManager = null;
    const panel = document.querySelector('#serenity-hub-panel');
    const backdrop = document.querySelector('#capture-hub-backdrop');
    const hub = {
        panel,
        serenityMode: { deps: { settingsManager: { get: () => ({}), update() {} } },
            _showBreathingIndicator() { indicator.start(); }, _hideBreathingIndicator() { indicator.stop(); } },
        hide() { panel.style.display = 'none'; backdrop.style.display = 'none'; },
        show() { panel.style.display = ''; backdrop.style.display = ''; },
        switchTab(name) {
            panel.querySelectorAll('.tab-panel').forEach((entry) => entry.classList.toggle('active', entry.id === `tab-${name}`));
            panel.querySelector('.hub-tab').textContent = name === 'breathing' ? 'Breathing worlds' : 'Breathwork journeys';
        },
    };
    const tab = new SessionsTab(hub, manager);
    const breathingTab = new BreathingTab(hub, indicator);
    hub.breathingTab = breathingTab;
    tab.setActive(true);
    window.__BREATHING_CAPTURE__ = { indicator, manager, tab, hub, breathingTab, frames: [] };
    indicator.start();
    hub.hide();
}

function freeze({ phase = 'inhale', progress = 0.72, time = 12 }) {
    const { indicator } = window.__BREATHING_CAPTURE__;
    const durations = Object.fromEntries(['inhale', 'hold1', 'exhale', 'hold2']
        .map((name, index) => [name, indicator.pattern[index]]));
    indicator.currentPhase = phase;
    indicator.phaseStartTime = performance.now() - durations[phase] * progress * 1000;
    if (indicator.animationFrame) cancelAnimationFrame(indicator.animationFrame);
    indicator._animate();
    if (indicator.animationFrame) cancelAnimationFrame(indicator.animationFrame);
    indicator.animationFrame = null;
    const renderer = indicator.threeRenderer;
    renderer.stop();
    // Settle the shipping reveal and palette lerp without advancing scene time.
    for (let frame = 0; frame < 120; frame += 1) renderer.updateScene(time, 1 / 60);
    renderer.renderer.render(renderer.scene, renderer.camera);
}

function inspect() {
    const capture = window.__BREATHING_CAPTURE__;
    const renderer = capture.indicator.threeRenderer;
    const canvas = renderer?.renderer?.domElement;
    const size = renderer?.container?.getBoundingClientRect();
    const elements = [...document.querySelectorAll('button, .phase-countdown, .breathing-phase-countdown, .session-hud, .session-player')];
    const clippedControls = elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(element).visibility === 'hidden') return false;
        // Scrollable preparation content may be deliberately outside its scrollport.
        return rect.right > innerWidth + 2 || rect.left < -2;
    }).map((element) => ({ className: element.className, label: element.textContent.trim().slice(0, 60) }));
    return {
        technique: capture.indicator.currentTechnique,
        phase: capture.indicator.currentPhase,
        pattern: capture.indicator.pattern,
        session: capture.manager.sessionId,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        container: size && { width: size.width, height: size.height,
            clientWidth: renderer.container.clientWidth, clientHeight: renderer.container.clientHeight },
        canvas: canvas && { width: canvas.width, height: canvas.height },
        camera: renderer?.camera && { aspect: renderer.camera.aspect, position: renderer.camera.position.toArray() },
        quality: renderer?.qualityName || renderer?.currentQuality || null,
        resources: renderer?.renderer && { ...renderer.renderer.info.memory, programs: renderer.renderer.info.programs?.length },
        work: renderer?.renderer && { ...renderer.renderer.info.render },
        running: renderer?.isRunning,
        contextLost: renderer?.renderer?.getContext().isContextLost(),
        resizeEvents: window.__BREATHING_RESIZES__,
        clippedControls,
        scrolling: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        overlays: [...document.querySelectorAll('.hub-tab-content, .session-prep-overlay, .session-completion-overlay')]
            .filter((element) => element.getBoundingClientRect().height > 0)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const art = element.querySelector('.completion-art');
                const artRect = art?.getBoundingClientRect();
                return { className: element.className, scrollTop: element.scrollTop,
                    scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
                    rect: { top: rect.top, bottom: rect.bottom, height: rect.height },
                    art: artRect && { top: artRect.top, bottom: artRect.bottom, height: artRect.height } };
            }),
    };
}

async function settleAnimations(page) {
    await page.evaluate(async () => {
        const finite = document.getAnimations().filter((animation) => animation.playState === 'running'
            && animation.effect?.getTiming().iterations !== Infinity);
        await Promise.race([
            Promise.allSettled(finite.map((animation) => animation.finished)),
            new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
    });
}

async function captureFrame(page, result, tag) {
    const name = `${result.id}-${tag}.png`;
    await page.waitForTimeout(160);
    await settleAnimations(page);
    const state = await page.evaluate(inspect);
    await page.screenshot({ path: path.join(OUT, name), scale: 'css', timeout: 30_000 });
    if (state.clippedControls.length) result.failures.push(`${tag}: controls overflow horizontally: ${JSON.stringify(state.clippedControls)}`);
    if (state.work?.calls > 16) result.failures.push(`${tag}: draw call bound exceeded (${state.work.calls} > 16).`);
    if (state.resources?.geometries > 40) result.failures.push(`${tag}: geometry bound exceeded (${state.resources.geometries} > 40).`);
    if (state.resources?.textures > 8) result.failures.push(`${tag}: texture bound exceeded (${state.resources.textures} > 8).`);
    result.frames.push({ file: name, state });
    if (tag.endsWith('-completion')) {
        const content = state.overlays.find((entry) => entry.className === 'hub-tab-content');
        const completion = state.overlays.find((entry) => entry.className === 'session-completion-overlay');
        if (content && completion && (completion.rect.top < content.rect.top - 2
            || completion.art?.top < content.rect.top - 2)) {
            result.failures.push(`${tag}: completion artwork/dialog moved above visible Hub content: ${JSON.stringify(state.overlays)}`);
        }
    }
}

async function sampleFrames(page) {
    return page.evaluate(async () => {
        const renderer = window.__BREATHING_CAPTURE__.indicator.threeRenderer;
        const frames = [];
        let previous;
        for (let index = 0; index < 24; index += 1) {
            // This is an isolated, manually rendered frame, not a GPU timestamp.
            // eslint-disable-next-line no-await-in-loop
            const now = await new Promise((resolve) => requestAnimationFrame(resolve));
            const before = performance.now();
            renderer.updateScene(12 + index / 60, 1 / 60);
            renderer.renderer.render(renderer.scene, renderer.camera);
            frames.push({ cpuSubmissionMs: performance.now() - before,
                rafIntervalMs: previous === undefined ? null : now - previous,
                calls: renderer.renderer.info.render.calls,
                triangles: renderer.renderer.info.render.triangles,
                points: renderer.renderer.info.render.points });
            previous = now;
        }
        const quantile = (values, fraction) => {
            const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
            return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
        };
        return { sampleCount: frames.length, frames,
            cpuSubmissionP50Ms: quantile(frames.map((frame) => frame.cpuSubmissionMs), 0.5),
            cpuSubmissionP95Ms: quantile(frames.map((frame) => frame.cpuSubmissionMs), 0.95),
            rafIntervalP50Ms: quantile(frames.map((frame) => frame.rafIntervalMs), 0.5),
            rafIntervalP95Ms: quantile(frames.map((frame) => frame.rafIntervalMs), 0.95),
            maxCalls: Math.max(...frames.map((frame) => frame.calls)) };
    });
}

async function runProfile(browser, baseUrl, profile) {
    const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: 1, isMobile: profile.mobile, hasTouch: profile.mobile,
    });
    const page = await context.newPage();
    const result = { id: profile.id, profile, frames: [], console: [], failures: [] };
    page.on('console', (message) => {
        if (message.type() === 'warning' || message.type() === 'error') result.console.push({ type: message.type(), text: message.text() });
    });
    page.on('pageerror', (error) => result.failures.push(error.stack || error.message));
    page.on('crash', () => result.failures.push('Browser page crashed.'));
    try {
        await page.addInitScript(() => {
            let seed = 481516;
            Math.random = () => {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return seed / 4294967296;
            };
        });
        await page.route((url) => url.pathname === '/breathing-capture.html', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
        await page.goto(`${baseUrl}/breathing-capture.html`, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.evaluate(boot);
        await page.waitForFunction(() => window.__BREATHING_CAPTURE__?.indicator?.threeRenderer?.renderer, null, { timeout: 60_000 });
        await page.evaluate((quality) => window.__BREATHING_CAPTURE__.indicator.threeRenderer.setQuality(quality), profile.quality);
        const techniques = await page.evaluate(() => Object.keys(window.__BREATHING_CAPTURE__.indicator.techniques));
        const selected = techniques.filter((name) => !args.uiOnly && (!args.technique || args.technique === name));
        if (args.uiOnly) await page.evaluate(freeze, { phase: 'inhale', progress: 0.76, time: 12 });
        for (const technique of selected) {
            await page.evaluate((name) => {
                const { indicator } = window.__BREATHING_CAPTURE__;
                indicator.setTechnique(name, false);
            }, technique);
            await page.evaluate(freeze, { phase: 'inhale', progress: 0.76, time: 12 });
            await captureFrame(page, result, `${technique}-inhale`);
            if (args.phases === 'all') {
                for (const phase of ['hold1', 'exhale', 'hold2']) {
                    const exists = await page.evaluate((name) => {
                        const indicator = window.__BREATHING_CAPTURE__.indicator;
                        return indicator.pattern[['inhale', 'hold1', 'exhale', 'hold2'].indexOf(name)] > 0;
                    }, phase);
                    if (!exists) continue;
                    await page.evaluate(freeze, { phase, progress: 0.76, time: 12 });
                    await captureFrame(page, result, `${technique}-${phase}`);
                }
            }
        }
        // Rendering the same scene after repeated switches catches shared-material and
        // nested geometry leaks that renderer.info cannot expose before first render.
        if (!args.uiOnly) {
        result.rebuild = await page.evaluate((names) => {
            const { indicator } = window.__BREATHING_CAPTURE__;
            const renderer = indicator.threeRenderer;
            const draw = () => {
                renderer.updateScene(12, 1 / 60);
                renderer.renderer.render(renderer.scene, renderer.camera);
                return { ...renderer.renderer.info.memory, programs: renderer.renderer.info.programs.length };
            };
            // Three uploads invisible retained motifs only when first drawn.
            // Warm each technique once before comparing equal retained scenes.
            names.forEach((name) => { indicator.setTechnique(name, false); draw(); });
            indicator.setTechnique(names[0], false);
            const before = draw();
            for (let repeat = 0; repeat < 2; repeat += 1) {
                names.forEach((name) => { indicator.setTechnique(name, false); draw(); });
            }
            indicator.setTechnique(names[0], false);
            return { switches: names.length * 2 + 2, before, after: draw() };
        }, techniques);
        if (result.rebuild.before.geometries !== result.rebuild.after.geometries
            || result.rebuild.before.textures !== result.rebuild.after.textures
            || result.rebuild.before.programs !== result.rebuild.after.programs) {
            result.failures.push(`Resources grew after switching all techniques twice: ${JSON.stringify(result.rebuild)}`);
        }
        result.frameSample = await sampleFrames(page);
        if (result.frameSample.maxCalls > 16) result.failures.push('Frame sample exceeded the 16-draw budget.');
        result.resize = [];
        for (const dimensions of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: profile.width, height: profile.height }]) {
            await page.setViewportSize(dimensions);
            await page.waitForFunction(() => {
                const renderer = window.__BREATHING_CAPTURE__.indicator.threeRenderer;
                const expected = renderer.container.clientWidth / renderer.container.clientHeight;
                return Math.abs(renderer.camera.aspect - expected) < 0.01;
            }, null, { timeout: 5000 }).catch(() => {});
            await page.evaluate(freeze, { phase: 'inhale', progress: 0.76, time: 12 });
            const resized = await page.evaluate(inspect);
            result.resize.push(resized);
            const expectedAspect = resized.container.width / resized.container.height;
            if (Math.abs(resized.camera.aspect - expectedAspect) > 0.01) {
                result.failures.push(`Resize did not update camera aspect: ${JSON.stringify(resized)}`);
            }
            if (Math.abs(resized.canvas.width / resized.canvas.height - expectedAspect) > 0.015) {
                result.failures.push(`Resize did not update canvas aspect: ${JSON.stringify(resized)}`);
            }
        }
        }
        if (args.sessions !== '0') {
            await page.evaluate(() => {
                const { indicator, hub } = window.__BREATHING_CAPTURE__;
                indicator.stop(); hub.show();
            });
            await page.evaluate(() => window.__BREATHING_CAPTURE__.hub.switchTab('breathing'));
            await captureFrame(page, result, 'breathing-library');
            await page.evaluate(() => window.__BREATHING_CAPTURE__.hub.switchTab('sessions'));
            await captureFrame(page, result, 'sessions-catalogue');
            for (const sessionId of ['BASE', 'ELIXIR', 'REST', 'FLOW']) {
                await page.evaluate((id) => {
                    const { tab, hub } = window.__BREATHING_CAPTURE__;
                    hub.show(); tab.showPrepScreen(id);
                }, sessionId);
                await captureFrame(page, result, `${sessionId.toLowerCase()}-preparation`);
                await page.evaluate(() => {
                    const { tab } = window.__BREATHING_CAPTURE__;
                    tab.startCountdown();
                });
                await captureFrame(page, result, `${sessionId.toLowerCase()}-countdown`);
                await page.evaluate((id) => {
                    const { tab } = window.__BREATHING_CAPTURE__;
                    tab.cancelPendingUI(); tab.hidePrepScreen(); tab.startSession(id);
                }, sessionId);
                await page.waitForTimeout(200);
                await page.evaluate(freeze, { phase: 'inhale', progress: 0.76, time: 12 });
                await captureFrame(page, result, `${sessionId.toLowerCase()}-grounding`);
                await page.evaluate(() => window.__BREATHING_CAPTURE__.hub.show());
                if (sessionId === 'BASE') {
                    await page.evaluate(() => {
                        const { hub, breathingTab } = window.__BREATHING_CAPTURE__;
                        hub.switchTab('breathing'); breathingTab.refresh();
                    });
                    await captureFrame(page, result, 'breathing-library-guided-session');
                    await page.evaluate(() => window.__BREATHING_CAPTURE__.hub.switchTab('sessions'));
                }
                await captureFrame(page, result, `${sessionId.toLowerCase()}-journey-overview`);
                await page.evaluate(() => window.__BREATHING_CAPTURE__.hub.hide());
                // Visit real retention/recovery/integration phases with their production
                // prompts and HUD state, without waiting for an entire 20-minute session.
                for (const type of args.uiOnly ? [] : ['active', 'retention', 'recovery', 'integration']) {
                    const exists = await page.evaluate((phaseType) => {
                        const { manager } = window.__BREATHING_CAPTURE__;
                        const index = manager.activeSession.phases.findIndex((phase) => phase.type === phaseType);
                        if (index < 0) return false;
                        manager._clearPhaseTimers();
                        manager.currentPhaseIndex = index;
                        manager._runPhase();
                        return true;
                    }, type);
                    if (!exists) continue;
                    await page.evaluate(freeze, { phase: type === 'retention' ? 'hold2' : type === 'recovery' ? 'hold1' : 'inhale', progress: 0.42, time: 12 });
                    await captureFrame(page, result, `${sessionId.toLowerCase()}-${type}`);
                }
                await page.evaluate(() => window.__BREATHING_CAPTURE__.tab.stopSession());
                await page.evaluate((id) => {
                    const { manager, tab } = window.__BREATHING_CAPTURE__;
                    tab.showCompletionMessage({ sessionId: id, sessionName: manager.SESSIONS[id].name,
                        totalDuration: manager._calculateTotalDuration(id), completedRounds: manager.SESSIONS[id].totalRounds,
                        totalBreaths: manager.SESSIONS[id].phases.reduce((sum, phase) => sum + (phase.breaths || 0), 0) });
                }, sessionId);
                await captureFrame(page, result, `${sessionId.toLowerCase()}-completion`);
            }
        }
        result.teardown = await page.evaluate(() => {
            const { manager, tab, indicator, breathingTab } = window.__BREATHING_CAPTURE__;
            manager.destroy(); tab.destroy();
            breathingTab.destroy();
            indicator.destroy?.();
            return { active: indicator.isActive, rendererRunning: indicator.threeRenderer?.isRunning || false,
                raf: indicator.animationFrame, pendingUI: tab.pendingTimers.size,
                phaseTimeouts: manager.phaseTimeouts.size,
                canvasCount: document.querySelectorAll('.breathing-visual-container canvas').length };
        });
        if (result.teardown.active || result.teardown.rendererRunning || result.teardown.raf
            || result.teardown.pendingUI || result.teardown.phaseTimeouts || result.teardown.canvasCount) {
            result.failures.push(`Incomplete teardown: ${JSON.stringify(result.teardown)}`);
        }
    } catch (error) {
        result.failures.push(error.stack || String(error));
    } finally {
        await context.close();
    }
    result.failures.push(...result.console.filter((entry) => entry.type === 'error'
        || /shader.*error|compilation error|device lost|WebGL.*INVALID/i.test(entry.text)).map((entry) => entry.text));
    result.status = result.failures.length ? 'fail' : 'pass';
    await writeFile(path.join(OUT, `${profile.id}.json`), JSON.stringify(result, null, 2));
    console.log(`${profile.id}: ${result.status}; ${result.frames.length} screenshots; ${result.failures.length} failures.`);
    return result;
}

async function runGameSmoke(browser, baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const result = { id: 'game-smoke', console: [], screenshots: [], failures: [] };
    page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') result.console.push({ type: message.type(), text: message.text() });
    });
    page.on('pageerror', (error) => result.failures.push(error.stack || error.message));
    page.on('crash', () => result.failures.push('Shipping game page crashed.'));
    try {
        await page.addInitScript(() => {
            localStorage.setItem('serenityBlocksSettings', JSON.stringify({
                backgroundMode: 'Specific', backgroundTheme: 'forest', effectQuality: 'Minimal',
                graphicsQuality: 'Minimal', enableBloom: false, enableShadows: false,
                musicVolume: 0, sfxVolume: 0, customCursorEnabled: false,
                breathingGuideEnabled: false, breathingGuideAutoStart: false,
            }));
        });
        await page.goto(`${baseUrl}/?skipIntro=1&forceWebGL=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForFunction(() => window.serenityBlocks?.isInitialized && window.breathingIndicator, null, { timeout: 90_000 });
        result.globalHub = await page.evaluate(async () => {
            const hub = await window.serenityBlocks.initializeGlobalSerenityHub();
            await hub.loadTabContent('breathing');
            const hasModeControls = typeof hub.breathingTab.serenityMode._showBreathingIndicator === 'function';
            hub.breathingTab.toggleBreathingGuide(true);
            const afterStart = window.breathingIndicator.isActive;
            hub.breathingTab.toggleBreathingGuide(false);
            return { hasModeControls, afterStart, afterStop: window.breathingIndicator.isActive };
        });
        if (!result.globalHub.afterStart || result.globalHub.afterStop) throw new Error('Global Hub could not toggle breathing outside Serenity.');
        await page.locator('#serenity-card-btn').click({ timeout: 30_000 });
        await page.waitForFunction(() => window.serenityBlocks.gameModeManager.getCurrentModeId() === 'serenity'
            && window.serenityBlocks.gameModeManager.getCurrentMode()?.isRunning, null, { timeout: 60_000 });
        await page.locator('#serenity-hub-icon').click({ timeout: 30_000 });
        await page.locator('#serenity-hub-panel .hub-tab[data-tab="breathing"]').click();
        await page.waitForFunction(() => window.serenityBlocks.serenityHub?.breathingTab, null, { timeout: 30_000 });
        await page.locator('#tab-breathing .toggle-switch').click();
        if (!await page.locator('#breathing-guide-toggle').isChecked()) throw new Error('Visible guide switch did not enable its checkbox.');
        await page.waitForFunction(() => window.breathingIndicator.threeRenderer?.renderer && window.breathingIndicator.isActive, null, { timeout: 60_000 });
        result.breathing = await page.evaluate(() => ({ mode: window.serenityBlocks.gameModeManager.getCurrentModeId(),
            active: window.breathingIndicator.isActive, technique: window.breathingIndicator.currentTechnique,
            canvasCount: document.querySelectorAll('.breathing-scene-canvas').length }));
        await page.locator('#serenity-hub-panel .hub-close-btn').click();
        await page.waitForTimeout(500);
        await settleAnimations(page);
        await page.screenshot({ path: path.join(OUT, 'game-smoke-breathing.png'), scale: 'css' });
        result.screenshots.push('game-smoke-breathing.png');
        await page.locator('#serenity-hub-icon').click();
        await page.locator('#serenity-hub-panel .hub-tab[data-tab="sessions"]').click();
        await page.waitForFunction(() => window.serenityBlocks.serenityHub?.sessionsTab, null, { timeout: 30_000 });
        await page.locator('#tab-sessions .start-session-btn[data-session="BASE"]').click();
        await page.waitForTimeout(250);
        await settleAnimations(page);
        await page.screenshot({ path: path.join(OUT, 'game-smoke-preparation.png'), scale: 'css' });
        result.screenshots.push('game-smoke-preparation.png');
        // Audio is intentionally muted here. This smoke verifies the production
        // integration path and its callbacks, not voice recordings or a long session.
        await page.evaluate(() => {
            const manager = window.serenityBlocks.serenityHub.sessionManager;
            manager.audioManager?.setEnabled(false);
        });
        await page.locator('#tab-sessions .prep-skip-btn').click();
        await page.waitForFunction(() => window.serenityBlocks.serenityHub.sessionManager.activeSession?.id === 'hale-base', null, { timeout: 20_000 });
        result.session = await page.evaluate(() => {
            const hub = window.serenityBlocks.serenityHub;
            return { session: hub.sessionManager.sessionId, externallyControlled: window.breathingIndicator.isExternallyControlled,
                phase: window.breathingIndicator.sessionPhase,
                hasHUDState: Boolean(hub.sessionsTab.activeSessionData), hubHidden: !hub.isOpen };
        });
        await page.waitForTimeout(350);
        await settleAnimations(page);
        await page.screenshot({ path: path.join(OUT, 'game-smoke-guided.png'), scale: 'css' });
        result.screenshots.push('game-smoke-guided.png');
        await page.evaluate(() => {
            const manager = window.serenityBlocks.serenityHub.sessionManager;
            manager._clearPhaseTimers();
            manager.currentPhaseIndex = manager.activeSession.phases.length - 1;
            manager._nextPhase();
        });
        await page.waitForFunction(() => window.serenityBlocks.serenityHub.isOpen
            && getComputedStyle(document.querySelector('.session-completion-overlay')).display !== 'none', null, { timeout: 15_000 });
        await settleAnimations(page);
        await page.screenshot({ path: path.join(OUT, 'game-smoke-completion.png'), scale: 'css' });
        result.screenshots.push('game-smoke-completion.png');
        result.completion = await page.evaluate(() => ({ activeSession: Boolean(window.serenityBlocks.serenityHub.sessionManager.activeSession),
            indicatorActive: window.breathingIndicator.isActive,
            completionSession: window.serenityBlocks.serenityHub.sessionsTab.completedSession?.sessionId,
            currentTab: window.serenityBlocks.serenityHub.currentTab }));
        if (result.breathing.canvasCount !== 1 || !result.session.externallyControlled || !result.session.hasHUDState
            || result.completion.activeSession || result.completion.indicatorActive || result.completion.currentTab !== 'sessions') {
            result.failures.push(`Shipping integration state did not match expectations: ${JSON.stringify(result)}`);
        }
        // A short landscape screen must preserve access to the completion action
        // through the dialog's own native scroller.
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(200);
        result.completionScroll = await page.evaluate(async () => {
            const overlay = document.querySelector('.session-completion-overlay');
            overlay.scrollTop = overlay.scrollHeight;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const dialog = overlay.getBoundingClientRect();
            const button = overlay.querySelector('.completion-close-btn').getBoundingClientRect();
            return { viewport: { width: innerWidth, height: innerHeight },
                scrollTop: overlay.scrollTop, scrollHeight: overlay.scrollHeight,
                clientHeight: overlay.clientHeight, dialog: { top: dialog.top, bottom: dialog.bottom },
                button: { top: button.top, bottom: button.bottom },
                reachable: button.top >= dialog.top - 2 && button.bottom <= dialog.bottom + 2 };
        });
        if (!result.completionScroll.reachable) result.failures.push('Landscape completion action is outside its native scroller.');
        await page.locator('#tab-sessions .completion-close-btn').click();
        result.completionScroll.clicked = true;
    } catch (error) {
        result.failures.push(error.stack || String(error));
        await page.screenshot({ path: path.join(OUT, 'game-smoke-failure.png'), scale: 'css' }).catch(() => {});
    } finally {
        await context.close();
    }
    result.breathingConsoleErrors = result.console.filter((entry) => entry.type === 'error'
        && /breath|session|Shader Error|compilation error/i.test(entry.text));
    result.failures.push(...result.breathingConsoleErrors.map((entry) => entry.text));
    result.status = result.failures.length ? 'fail' : 'pass';
    await writeFile(path.join(OUT, 'game-smoke.json'), JSON.stringify(result, null, 2));
    console.log(`game-smoke: ${result.status}; ${result.screenshots.length} screenshots; ${result.failures.length} failures.`);
    return result;
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const { createServer } = await import('vite');
await mkdir(OUT, { recursive: true });
const server = await createServer({ root: ROOT, cacheDir: path.join(OUT, 'vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false } });
const report = { schemaVersion: 1, sourceSHA256: await fingerprint(), softwareRendering: true, isolatedSessionSeed: 481516,
    surfaces: args.uiOnly ? 'ui-only' : 'worlds-and-ui',
    limits: ['Shipping indicator, renderer, manager and SessionsTab in isolation; background game themes and audio are absent.',
        'Software-browser measurements establish rendering/resource bounds, not physical-phone or hardware GPU FPS.'], results: [] };
let browser;
try {
    await server.listen();
    const baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({ executablePath: args.executable || process.env.PLAYWRIGHT_EXECUTABLE_PATH,
        headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist',
            '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-gpu-sandbox'] });
    report.browserVersion = browser.version();
    for (const profile of profiles) report.results.push(await runProfile(browser, baseUrl, profile));
    if (args.gameSmoke) report.results.push(await runGameSmoke(browser, baseUrl));
} finally {
    await browser?.close();
    await server.close();
    report.sourceStable = JSON.stringify(report.sourceSHA256) === JSON.stringify(await fingerprint());
    report.status = report.sourceStable && report.results.length && report.results.every((entry) => entry.status === 'pass') ? 'pass' : 'fail';
    await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
if (report.status !== 'pass') process.exitCode = 1;
