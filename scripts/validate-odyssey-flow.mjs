#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-await-in-loop -- GPU captures run serially in fresh browser contexts. */
/**
 * Live Odyssey flow validation against an already running development server.
 * Uses a disposable browser context and a synthetic goal-completion fixture. This
 * exercises real saves, lifecycle and rendering, not human play or difficulty.
 * Optional tooling: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCENARIOS = ['within', 'reduced', 'chapter', 'interrupted', 'entry-interrupted', 'retry-interrupted'];
const EXTRA_SCENARIOS = ['ui'];
const TIMEOUT = 120_000;

function parseArgs(args) {
    const config = {
        scenario: 'within',
        baseUrl: process.env.ODYSSEY_FLOW_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:5173',
        out: path.resolve('artifacts/odyssey-flow'),
        executablePath: process.env.CHROMIUM_PATH,
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') config.help = true;
        else if (arg === '--warm-source') config.warmSource = true;
        else if (['--scenario', '--base-url', '--out'].includes(arg)) {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            if (arg === '--scenario') config.scenario = value;
            if (arg === '--base-url') config.baseUrl = value;
            if (arg === '--out') config.out = path.resolve(value);
        } else if ([...SCENARIOS, ...EXTRA_SCENARIOS, 'all'].includes(arg)) config.scenario = arg;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (![...SCENARIOS, ...EXTRA_SCENARIOS, 'all'].includes(config.scenario)) {
        throw new Error(`Unknown scenario: ${config.scenario}`);
    }
    const url = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL must use HTTP or HTTPS');
    url.searchParams.set('skipIntro', '1');
    url.searchParams.set('forceWebGL', '1');
    config.url = url.href;
    return config;
}

async function loadPlaywright() {
    try {
        // eslint-disable-next-line import/no-unresolved -- Optional developer tooling, intentionally not a game dependency.
        return await import('playwright');
    } catch (error) {
        if (!process.env.PLAYWRIGHT_MODULE) {
            throw new Error('Playwright is unavailable. Install it separately or set PLAYWRIGHT_MODULE '
                + 'to its module file. No project dependency is added by this script.', { cause: error });
        }
        const target = process.env.PLAYWRIGHT_MODULE;
        return import(target.startsWith('file:') ? target : pathToFileURL(path.resolve(target)).href);
    }
}

async function snapshot(page) {
    return page.evaluate(() => ({
        level: window.odysseyMode?.currentLevelId,
        running: window.odysseyMode?.levelRunStarted,
        phase: window.odysseyMode?.entryPhase,
        active: window.odysseyMode?.isActive,
        flow: document.getElementById('odyssey-flow-overlay')?.outerHTML || null,
        calls: window.__flowTrace?.calls || [],
    })).catch(() => null);
}

async function installTrace(page) {
    await page.evaluate(() => {
        const mode = window.odysseyMode;
        const trace = {
            startedAt: performance.now(), calls: [], milestones: [], retainedComposition: null,
        };
        window.__flowTrace = trace;
        const record = (collection, name, detail = {}) => {
            trace[collection].push({
                name, ms: performance.now() - trace.startedAt, level: mode.currentLevelId, ...detail,
            });
        };
        const methods = [
            'returnToBoard', 'launchOdysseyLevel', 'prepareLevelStart', 'beginLevelRun',
            '_prepareGameplayReveal', '_activateLevelThemeVisuals', '_waitForEntryRevealReadiness',
            '_beginGameplayReveal', 'showLevelStartCue',
        ];
        methods.forEach((name) => {
            const original = mode[name].bind(mode);
            mode[name] = (...args) => {
                record('calls', name);
                const result = original(...args);
                if (result?.then) {
                    result.then(
                        (value) => record('milestones', `${name}:settled`, { success: value !== false }),
                        () => record('milestones', `${name}:rejected`),
                    );
                } else record('milestones', `${name}:settled`, { success: result !== false });
                return result;
            };
        });
        const save = mode.odysseyState.completeLevel.bind(mode.odysseyState);
        mode.odysseyState.completeLevel = (...args) => { record('calls', 'saveCompletion'); return save(...args); };
        let completion = null;
        let goal = null;
        let changes = null;
        const seen = new Set();
        const observe = () => {
            const modal = document.getElementById('odyssey-flow-overlay');
            if (!modal) return;
            if (modal.dataset.variant === 'completion' && !completion) {
                completion = modal;
                goal = modal.querySelector('.ody-flow__goal');
                changes = modal.querySelector('.ody-flow__changes');
            }
            const state = [modal.dataset.variant, modal.dataset.covered, modal.dataset.revealed,
                modal.dataset.visibilityHeld].join(':');
            if (seen.has(state)) return;
            seen.add(state);
            record('milestones', `overlay:${state}`);
            if (modal.dataset.variant === 'transit' && completion && modal.dataset.continuation === 'true') {
                trace.retainedComposition = {
                    sameModal: modal === completion,
                    sameGoal: modal.querySelector('.ody-flow__goal') === goal,
                    sameChanges: modal.querySelector('.ody-flow__changes') === changes,
                    goal: goal?.textContent,
                    changes: changes?.textContent || '',
                };
            }
        };
        const observer = new MutationObserver(observe);
        observer.observe(document.body, { subtree: true, attributes: true, childList: true });
        window.__flowObserver = observer;
        observe();
    });
}

async function holdPreparedEntry(page, out, source, trigger = 'preparation') {
    await page.waitForFunction(
        () => window.odysseyMode?.currentLevelId === null || (window.odysseyMode?.levelPrepared
        && ['playable', 'countdown'].includes(window.odysseyMode.entryPhase)
        && document.getElementById('odyssey-flow-overlay')?.dataset.visibilityHeld === 'true'),
        null,
        { timeout: TIMEOUT },
    );
    assert.notEqual((await snapshot(page)).level, null, `${source} aborted before reaching the presence assertion`);
    // Readiness alone must not start gameplay while the presence hold owns entry.
    await page.waitForTimeout(3200);
    const held = await snapshot(page);
    assert.equal(held.running, false, `${source} started behind a presence hold`);
    assert.equal(held.calls.filter((call) => call.name === 'beginLevelRun').length, 0);
    await page.screenshot({ path: path.join(out, '02-presence-paused.png') });
    await page.getByRole('button', { name: 'Resume journey', exact: true }).click();
    await page.waitForFunction(
        () => window.odysseyMode?.levelRunStarted
        && !document.getElementById('odyssey-flow-overlay') && !window.odysseyMode.isEnteringLevel,
        null,
        { timeout: TIMEOUT },
    );
    const resumed = await snapshot(page);
    assert.equal(resumed.level, held.level, `${source} changed the prepared destination`);
    assert.equal(resumed.calls.filter((call) => call.name === 'prepareLevelStart').length, 1);
    assert.equal(resumed.calls.filter((call) => call.name === 'saveCompletion').length, 0);
    assert.equal(resumed.calls.filter((call) => call.name === 'beginLevelRun').length, 1);
    assert.equal(resumed.calls.filter((call) => call.name === 'returnToBoard').length, 0);
    if (trigger === 'ready cue') {
        assert.equal(
            resumed.calls.filter((call) => call.name === 'showLevelStartCue').length,
            2,
            'A partly seen cue must be shown again after Resume',
        );
    }
    await page.screenshot({ path: path.join(out, '03-resumed.png') });
    return {
        trigger: `Synthetic window blur during ${trigger}; no OS focus change.`, heldForMs: 3200, held, resumed,
    };
}

async function interruptTransit(page, out, nextLevelId) {
    // Synthetic presence event: exercise the real blur listener without claiming
    // an OS window switch or background-tab throttling measurement.
    const triggerState = await page.evaluate(() => {
        const phase = window.odysseyMode.entryPhase;
        const revealed = document.getElementById('odyssey-flow-overlay')?.dataset.revealed === 'true';
        window.dispatchEvent(new Event('blur'));
        return { phase, revealed };
    });
    assert.ok(
        ['preparing', 'prepared'].includes(triggerState.phase),
        'Interruption must occur before the prepared orb is revealed',
    );
    assert.equal(triggerState.revealed, false, 'Interruption must precede the next orb reveal');
    await page.screenshot({ path: path.join(out, '03-transit.png') });
    await page.waitForFunction((id) => {
        const modal = document.getElementById('odyssey-flow-overlay');
        return window.odysseyMode?.currentLevelId === id && window.odysseyMode?.levelPrepared
            && modal?.dataset.revealed === 'true' && modal.dataset.visibilityHeld === 'true';
    }, nextLevelId, { timeout: TIMEOUT });
    const before = await snapshot(page);
    assert.equal(before.running, false, 'A prepared orb must stay stopped after loss of presence');
    assert.equal(before.calls.filter((call) => call.name === 'beginLevelRun').length, 0);
    // Loading and reveal have settled; this wait proves readiness alone cannot resume play.
    await page.waitForTimeout(3200);
    const after = await snapshot(page);
    assert.equal(after.level, nextLevelId, 'Interrupted handoff changed its destination');
    assert.equal(after.running, false, 'Interrupted handoff resumed without deliberate input');
    assert.deepEqual(after.calls, before.calls, 'Interrupted handoff continued without deliberate input');
    console.log('[odyssey-flow:interrupted] Prepared orb held for 3200 ms; resuming deliberately');
    await page.screenshot({ path: path.join(out, '03b-presence-paused.png') });
    await page.getByRole('button', { name: 'Resume journey', exact: true }).click();
    return {
        trigger: 'Synthetic window blur event during transit; no OS focus loss is simulated.',
        triggerState,
        heldAfterReadinessMs: 3200,
        before,
        after,
    };
}

async function runUiScenario(chromium, config) {
    const out = path.join(config.out, 'ui');
    await mkdir(out, { recursive: true });
    const browser = await chromium.launch({
        ...(config.executablePath ? { executablePath: config.executablePath } : {}),
        headless: true,
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const report = [];
    try {
        const fixtureUrl = new URL('/__odyssey_flow_ui_fixture', config.url).href;
        await page.route(fixtureUrl, (route) => route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${
                ['/styles/fonts.css', '/styles/keystone.css', '/styles/odyssey-flow.css']
                    .map((href) => `<link rel="stylesheet" href="${href}">`).join('')
            }</head><body style="margin:0;background:#080713"></body></html>`,
        }));
        await page.goto(fixtureUrl);
        await page.evaluate(async ({ overlayPath, registryPath }) => {
            const [{ createJourneyFlowOverlay }, { LevelRegistry }] = await Promise.all([
                import(overlayPath), import(registryPath),
            ]);
            window.__createFlow = createJourneyFlowOverlay;
            window.__flowRegistry = new LevelRegistry();
            await document.fonts.ready;
        }, {
            overlayPath: '/src/ui/odyssey/JourneyFlowOverlay.js', registryPath: '/src/core/odyssey/LevelRegistry.js',
        });
        for (const size of [
            {
                name: 'desktop', width: 1280, height: 800, fontSize: 16,
            },
            {
                name: 'mobile', width: 320, height: 640, fontSize: 16,
            },
            {
                name: 'large-text', width: 640, height: 800, fontSize: 32,
            },
            {
                name: 'landscape', width: 844, height: 390, fontSize: 16,
            },
        ]) {
            await page.setViewportSize({ width: size.width, height: size.height });
            for (const from of [1, 3, 6]) {
                await page.evaluate(({ start, fontSize }) => {
                    document.getElementById('odyssey-flow-overlay')?.dispose();
                    document.documentElement.style.fontSize = `${fontSize}px`;
                    const level = window.__flowRegistry.resolveLevelPresentation(start);
                    const nextLevel = window.__flowRegistry.resolveLevelPresentation(start + 1);
                    window.__uiChoices = [];
                    const modal = window.__createFlow({
                        level,
                        nextLevel,
                        chapter: window.__flowRegistry.getChapter(nextLevel.chapter),
                        results: { stars: 2, score: 12400, time: 83 },
                        autoContinue: true,
                        onChoose: (choice) => window.__uiChoices.push(choice),
                    });
                    document.body.appendChild(modal);
                    window.__uiModal = modal;
                    window.__uiGoal = modal.querySelector('.ody-flow__goal');
                    window.__uiChanges = modal.querySelector('.ody-flow__changes');
                }, { start: from, fontSize: size.fontSize });
                await page.waitForTimeout(50);
                const prefix = `${size.name}-${from}-to-${from + 1}`;
                await page.screenshot({ path: path.join(out, `${prefix}-completion.png`), animations: 'disabled' });
                const before = await page.evaluate(() => {
                    const modal = window.__uiModal;
                    const goal = modal.querySelector('.ody-flow__goal').getBoundingClientRect();
                    const pause = modal.querySelector('[data-flow-action="pause"]').getBoundingClientRect();
                    return {
                        goalY: goal.y,
                        pauseInitiallyVisible: pause.top >= 0 && pause.bottom <= window.innerHeight,
                        autoRunning: modal.dataset.autoRunning,
                        goal: window.__uiGoal.textContent,
                        changes: window.__uiChanges?.textContent || '',
                        clientWidth: modal.clientWidth,
                        scrollWidth: modal.scrollWidth,
                        clientHeight: modal.clientHeight,
                        scrollHeight: modal.scrollHeight,
                    };
                });
                assert.ok(before.scrollWidth <= before.clientWidth + 1, `${prefix}: horizontal clipping`);
                assert.equal(
                    before.autoRunning,
                    String(before.pauseInitiallyVisible),
                    `${prefix}: automatic continuation must wait when Pause is outside the viewport`,
                );
                if (!before.pauseInitiallyVisible && from === 1) {
                    await page.waitForTimeout(3200);
                    assert.deepEqual(
                        await page.evaluate(() => window.__uiChoices),
                        [],
                        `${prefix}: overflowed completion advanced before the player could read`,
                    );
                }
                await page.evaluate(async () => { window.__uiModal.beginTransit(); await window.__uiModal.cover(); });
                const after = await page.evaluate(() => ({
                    sameModal: window.__uiModal === document.getElementById('odyssey-flow-overlay'),
                    sameGoal: window.__uiGoal === window.__uiModal.querySelector('.ody-flow__goal'),
                    sameChanges: window.__uiChanges === window.__uiModal.querySelector('.ody-flow__changes'),
                    goalY: window.__uiGoal.getBoundingClientRect().y,
                }));
                assert.ok(after.sameModal && after.sameGoal && after.sameChanges, `${prefix}: replaced composition`);
                assert.ok(Math.abs(after.goalY - before.goalY) < 1, `${prefix}: briefing jumped during transit`);
                await page.screenshot({ path: path.join(out, `${prefix}-transit.png`), animations: 'disabled' });
                await page.getByRole('button', { name: 'Pause', exact: true }).click();
                assert.equal(await page.locator('#odyssey-flow-overlay').getAttribute('data-visibility-held'), 'true');
                await page.screenshot({ path: path.join(out, `${prefix}-paused.png`), animations: 'disabled' });
                await page.getByRole('button', { name: 'Resume journey', exact: true }).click();
                assert.equal(await page.locator('#odyssey-flow-overlay').getAttribute('data-visibility-held'), 'false');
                report.push({
                    prefix, before, after, pauseResume: 'pass',
                });
            }
        }
        assert.deepEqual(errors, [], 'UI browser errors');
        await writeFile(path.join(out, 'result.json'), JSON.stringify({
            status: 'pass',
            cases: report,
            errors,
            limitation: 'Isolated real DOM/CSS and effective registry configs; no game renderer or physical device.',
            screenshotMethod: 'Settled CSS animations; real automatic countdown continues until transit is requested.',
        }, null, 2));
        console.log(JSON.stringify({
            scenario: 'ui', status: 'pass', cases: report.length, out,
        }));
    } finally {
        await browser.close();
    }
}

async function runScenario(chromium, config, scenario) {
    const reduced = scenario === 'reduced';
    const out = path.join(config.out, `live-${scenario}`);
    await mkdir(out, { recursive: true });
    const browser = await chromium.launch({
        ...(config.executablePath ? { executablePath: config.executablePath } : {}),
        headless: true,
        args: [
            '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        ],
    });
    // No persistent profile, storageState, userDataDir or authenticated user context.
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    const consoleLog = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on('console', (message) => {
        consoleLog.push(`${message.type()}: ${message.text()}`);
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('serenityBlocksSettings', JSON.stringify({
            backgroundMode: 'Specific',
            backgroundTheme: 'cinder-drift',
            effectQuality: 'Minimal',
            renderScale: 0.75,
            musicVolume: 0,
            sfxVolume: 0,
            odysseyAutoContinue: true,
            customCursorEnabled: false,
        }));
    });
    let fixture;
    try {
        console.log(`[odyssey-flow:${scenario}] Booting ${config.url}`);
        await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForFunction(() => window.serenityBlocks?.gameModeManager, null, { timeout: TIMEOUT });
        await page.waitForFunction(() => window.startupPipelineSnapshot?.menuReady, null, { timeout: TIMEOUT });
        await page.evaluate(() => {
            window.__flowBoot = (async () => {
                const manager = window.serenityBlocks.gameModeManager;
                document.querySelector('#start-modal')?.classList.remove('visible');
                await manager.activateMode('odyssey');
                await manager.startCurrentMode();
                return true;
            })();
        });
        await page.waitForFunction(
            () => window.odysseyMode?.boardController && window.odysseyMode?.isInBoardView,
            null,
            { timeout: TIMEOUT },
        );
        await page.evaluate(() => window.__flowBoot);
        console.log(`[odyssey-flow:${scenario}] Boot ready; chapter map is visible`);
        await page.screenshot({ path: path.join(out, '00-board.png') });
        fixture = await page.evaluate((kind) => {
            const registry = window.odysseyMode.levelRegistry;
            const level = kind === 'chapter' ? registry.getChapterEndLevel(1) : registry.getChapterStartLevel(1);
            const next = registry.getNextLevel(level.id);
            if (!next) throw new Error('The first chapter fixture has no next orb');
            if (level.victory.primary.type !== 'lines') {
                throw new Error('The prepared completion fixture requires a primary line goal');
            }
            return {
                start: level.id,
                next: next.id,
                chapter: level.chapter,
                nextChapter: next.chapter,
                goalType: level.victory.primary.type,
                target: level.victory.primary.target,
            };
        }, scenario);
        fixture.sourceThemePrefetchRequested = Boolean(config.warmSource);
        assert.equal(fixture.chapter === fixture.nextChapter, scenario !== 'chapter', 'Fixture boundary changed');
        if (config.warmSource) {
            console.log(`[odyssey-flow:${scenario}] Prefetching source theme before the lifecycle fixture`);
            fixture.sourceThemePrefetchResult = await page.evaluate((id) => {
                const mode = window.odysseyMode;
                return mode._prefetchLevelAssets(mode.levelRegistry.resolveLevelPresentation(id), { priority: 'high' });
            }, fixture.start);
        }
        if (scenario === 'entry-interrupted') {
            await installTrace(page);
            await page.evaluate(() => {
                const mode = window.odysseyMode;
                const prepare = mode._prepareGameplayReveal.bind(mode);
                mode._prepareGameplayReveal = (...args) => {
                    window.dispatchEvent(new Event('blur'));
                    return prepare(...args);
                };
            });
        }
        console.log(`[odyssey-flow:${scenario}] Launching source orb ${fixture.start}`);
        await page.evaluate((id) => {
            if (typeof window.testOdysseyLevel !== 'function') {
                throw new Error('Run against the development server: the prepared fixture needs testOdysseyLevel');
            }
            window.__flowEntry = window.testOdysseyLevel(id);
        }, fixture.start);
        if (scenario === 'entry-interrupted') {
            const interruption = await holdPreparedEntry(page, out, 'Map entry');
            assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
            assert.deepEqual(consoleErrors, [], 'Browser console errors');
            await writeFile(path.join(out, 'result.json'), JSON.stringify({
                status: 'pass',
                scenario,
                fixture,
                interruption,
                pageErrors,
                consoleErrors,
                limitation: 'Synthetic blur, isolated save, muted audio, software WebGL2; not actual OS focus loss.',
            }, null, 2));
            console.log(JSON.stringify({ scenario, status: 'pass', out }));
            return;
        }
        const sourceEntered = await page.evaluate(() => window.__flowEntry);
        assert.notEqual(sourceEntered, false, 'Source orb entry aborted before the flow fixture');
        await page.waitForFunction(
            (id) => window.odysseyMode?.levelRunStarted && window.odysseyMode?.currentLevelId === id,
            fixture.start,
            { timeout: TIMEOUT },
        );
        console.log(`[odyssey-flow:${scenario}] Source orb ${fixture.start} is running`);
        await page.screenshot({ path: path.join(out, '01-running.png') });
        await installTrace(page);
        if (scenario === 'retry-interrupted') {
            await page.evaluate(() => {
                const mode = window.odysseyMode;
                const cue = mode.showLevelStartCue.bind(mode);
                let interrupted = false;
                mode.showLevelStartCue = (...args) => {
                    if (!interrupted) {
                        interrupted = true;
                        setTimeout(() => window.dispatchEvent(new Event('blur')), 150);
                    }
                    return cue(...args);
                };
                // Synthetic failure enters the real retire/debrief/retry path.
                window.__flowFailure = mode.failLevel('top-out');
            });
            await page.getByRole('button', { name: /retry/i }).click({ timeout: 15_000 });
            const interruption = await holdPreparedEntry(page, out, 'Retry', 'ready cue');
            assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
            assert.deepEqual(consoleErrors, [], 'Browser console errors');
            await writeFile(path.join(out, 'result.json'), JSON.stringify({
                status: 'pass',
                scenario,
                fixture,
                interruption,
                pageErrors,
                consoleErrors,
                limitation: 'Synthetic failure and blur, isolated save, muted audio, software WebGL2; not real play.',
            }, null, 2));
            console.log(JSON.stringify({ scenario, status: 'pass', out }));
            return;
        }
        await page.evaluate(() => {
            const mode = window.odysseyMode;
            // Synthetic goal fixture: inject the authored target into the real evaluator.
            // No claim that this is a playable route, human performance, or a benchmark.
            const { target } = mode.currentLevelConfig.victory.primary;
            mode.hybridEngine.victoryEvaluator.onLineClear(target);
            mode.gameState.score = 12400;
            mode._checkVictoryConditions(mode._activeLevelSession);
        });
        await page.waitForSelector('#odyssey-flow-overlay[data-variant="completion"]', { timeout: 15_000 });
        console.log(`[odyssey-flow:${scenario}] Completion feedback is visible`);
        // Let the text entry animation settle; the first frame only shows portal rings.
        await page.waitForTimeout(350);
        // A busy software compositor can still paint its first CSS animation frame late.
        // Capture settled CSS composition without changing the JavaScript flow timer.
        await page.screenshot({ path: path.join(out, '02-completion.png'), animations: 'disabled' });
        const preference = await page.locator('#odyssey-flow-overlay').getAttribute('data-reduced-motion');
        assert.equal(preference, String(reduced), 'Overlay must honor the operating-system motion preference');
        let chapterPause = null;
        let interruption = null;
        if (scenario === 'chapter') {
            await page.waitForSelector('#odyssey-flow-overlay[data-variant="chapter"]', { timeout: TIMEOUT });
            await page.waitForTimeout(350);
            const before = await snapshot(page);
            assert.equal(before.running, false, 'Chapter reveal must not run gameplay');
            assert.equal(before.calls.filter((call) => call.name === 'beginLevelRun').length, 0);
            assert.equal(before.calls.filter((call) => call.name === 'launchOdysseyLevel').length, 0);
            // Longer than the completion bridge: the chapter must still await explicit input.
            await page.waitForTimeout(3200);
            const after = await snapshot(page);
            assert.equal(after.level, before.level, 'Chapter pause advanced without input');
            assert.equal(after.running, false, 'Chapter pause started gameplay without input');
            assert.deepEqual(after.calls, before.calls, 'Chapter pause launched or prepared another session');
            await page.screenshot({ path: path.join(out, '03-chapter.png') });
            chapterPause = { heldForMs: 3200, before, after };
            console.log(`[odyssey-flow:${scenario}] Chapter reveal held for 3200 ms; beginning deliberately`);
            await page.getByRole('button', { name: 'Begin chapter', exact: true }).click();
        } else {
            await page.waitForSelector('#odyssey-flow-overlay[data-variant="transit"]', { timeout: 15_000 });
            await page.waitForFunction(
                () => document.querySelector('#odyssey-flow-overlay')?.dataset.covered === 'true',
            );
            if (scenario === 'interrupted') interruption = await interruptTransit(page, out, fixture.next);
            else await page.screenshot({ path: path.join(out, '03-transit.png') });
        }
        await page.waitForFunction(
            (id) => window.odysseyMode?.currentLevelId === id && window.odysseyMode?.levelRunStarted
                && !document.getElementById('odyssey-flow-overlay') && !window.odysseyMode.isEnteringLevel,
            fixture.next,
            { timeout: TIMEOUT },
        );
        console.log(`[odyssey-flow:${scenario}] Next orb ${fixture.next} is running`);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, '04-next-running.png') });
        const result = await page.evaluate((startId) => ({
            trace: window.__flowTrace,
            level: window.odysseyMode.currentLevelId,
            running: window.odysseyMode.levelRunStarted,
            overlay: !!document.getElementById('odyssey-flow-overlay'),
            completion: window.odysseyMode.odysseyState.getLevelCompletion(startId),
            activeTheme: window.serenityBlocks.themeManager?.activeThemeName,
            renderer: window.odysseyMode.boardController?.renderer?.backend?.isWebGLBackend ? 'webgl2' : 'other',
        }), fixture.start);
        const calls = (name) => result.trace.calls.filter((call) => call.name === name);
        assert.equal(calls('saveCompletion').length, 1, 'Completion must be saved exactly once');
        assert.equal(calls('prepareLevelStart').length, 1, 'Next orb must be prepared exactly once');
        assert.equal(calls('beginLevelRun').length, 1, 'Next orb must start exactly once');
        assert.equal(calls('beginLevelRun')[0].level, fixture.next, 'Wrong next orb started');
        assert.equal(calls('returnToBoard').length, scenario === 'chapter' ? 1 : 0, 'Unexpected map navigation');
        assert.equal(calls('launchOdysseyLevel').length, scenario === 'chapter' ? 1 : 0, 'Unexpected full entry path');
        if (scenario !== 'chapter') {
            assert.equal(result.trace.retainedComposition?.sameModal, true, 'Completion modal was replaced in transit');
            assert.equal(result.trace.retainedComposition.sameGoal, true, 'Next goal was replaced in transit');
            assert.equal(
                result.trace.retainedComposition.sameChanges,
                true,
                'Changed-rule briefing was replaced in transit',
            );
        }
        assert.ok(result.completion?.stars >= 1, 'Prepared win was not saved');
        assert.equal(result.level, fixture.next);
        assert.equal(result.running, true);
        assert.equal(result.overlay, false, 'Flow overlay leaked into gameplay');
        assert.equal(result.renderer, 'webgl2', 'This capture requires the forced WebGL2 path');
        assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
        assert.deepEqual(consoleErrors, [], 'Browser console errors');
        const report = {
            status: 'pass',
            scenario,
            fixture,
            methodology: 'Synthetic goal completion, real runtime transitions, isolated disposable browser storage.',
            screenshotMethod: 'Completion captures disable CSS animations for settled static composition; '
                + 'JavaScript flow timing is unchanged. Chapter capture follows the deliberate 3200 ms pause check.',
            limitation: 'Software WebGL2 capture; not hardware performance, human gameplay, or a difficulty benchmark.',
            ...result,
            chapterPause,
            interruption,
            pageErrors,
            consoleErrors,
        };
        await writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({
            scenario, status: report.status, next: result.level, out,
        }));
    } catch (error) {
        await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
        await writeFile(path.join(out, 'failure.json'), JSON.stringify({
            status: 'fail',
            scenario,
            fixture,
            message: error.message,
            stack: error.stack,
            pageErrors,
            consoleErrors,
            state: await snapshot(page),
        }, null, 2));
        throw error;
    } finally {
        await writeFile(path.join(out, 'console.log'), consoleLog.join('\n'));
        await browser.close();
    }
}

async function main() {
    const config = parseArgs(process.argv.slice(2));
    if (config.help) {
        console.log(`Usage: node scripts/validate-odyssey-flow.mjs [options]
  --scenario <name>  within (default), reduced, chapter, interrupted, entry-interrupted,
                     retry-interrupted, ui, or all (runtime cases); positional name accepted
  --base-url <url>   Existing development server (default http://127.0.0.1:5173)
  --out <directory>  Captures and reports (default artifacts/odyssey-flow)
  --warm-source      Await existing source-theme prefetch before entry (recorded fixture setup)
  --help            Show this help without loading Playwright or starting a browser
Environment: ODYSSEY_FLOW_BASE_URL or BASE_URL, CHROMIUM_PATH, PLAYWRIGHT_MODULE.
Each scenario uses a fresh browser and disposable storage, serially. Starts chapter 1's
first orb, or its registry-resolved last orb for chapter. Injects a synthetic line goal
into the real completion path. Interrupted also dispatches a synthetic window blur
during transit and requires deliberate Resume after readiness. Software WebGL2 evidence
is not a hardware FPS benchmark or a simulation of actual OS focus loss. Entry/retry cases
hold prepared runs after synthetic blur. UI captures effective 1→2, 3→4 and 6→7 briefings
at desktop, 320px, 844×390 landscape and 200% root text sizes, including retained transit,
Pause/Resume and automatic reading holds when Pause does not fit in the viewport.`);
        return;
    }
    const { chromium } = await loadPlaywright();
    if (config.scenario === 'ui') { await runUiScenario(chromium, config); return; }
    for (const scenario of config.scenario === 'all' ? SCENARIOS : [config.scenario]) {
        await runScenario(chromium, config, scenario);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
