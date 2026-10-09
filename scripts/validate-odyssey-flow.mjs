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

const SCENARIOS = [
    'within', 'reduced', 'chapter', 'chapter-map', 'chapter-reduced', 'finale', 'world-paused', 'world-map',
    'interrupted', 'entry-interrupted', 'retry-interrupted',
];
const EXTRA_SCENARIOS = ['ui', 'finale-ui'];
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
        else if (arg === '--slow-gpu') config.slowGpu = true;
        else if (arg.startsWith('--viewport=')) {
            const [width, height] = arg.slice('--viewport='.length).split('x').map(Number);
            if (!(width >= 320 && height >= 320)) throw new Error(`Invalid viewport: ${arg}`);
            config.viewport = { width, height };
        } else if (['--scenario', '--base-url', '--out'].includes(arg)) {
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
        sessionRetired: window.odysseyMode?._activeLevelSession?.retired ?? null,
        hybridLoopRunning: window.odysseyMode?.deps.frameRateController?.isRunning ?? false,
        phase: window.odysseyMode?.entryPhase,
        active: window.odysseyMode?.isActive,
        world: window.__flowWorldSnapshot?.() || null,
        flow: document.getElementById('odyssey-flow-overlay')?.outerHTML || null,
        calls: window.__flowTrace?.calls || [],
    })).catch(() => null);
}

async function installTrace(page, pauseWorld = false) {
    await page.evaluate((shouldPauseWorld) => {
        const mode = window.odysseyMode;
        const trace = {
            startedAt: performance.now(),
            calls: [],
            milestones: [],
            retainedComposition: null,
            worldSamples: [],
            worldCameraSamples: [],
            worldTravelCalls: [],
            mapUiViolations: [],
            worldCancelled: false,
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
            const state = [modal.dataset.variant, modal.dataset.worldStage,
                modal.dataset.covered, modal.dataset.revealed,
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
        const initialBoard = mode.boardController;
        const initialRenderer = initialBoard?.renderer;
        const visible = (node) => {
            if (!node) return false;
            const bounds = node.getBoundingClientRect();
            if (bounds.width === 0 || bounds.height === 0) return false;
            let opacity = 1;
            for (let current = node; current instanceof Element; current = current.parentElement) {
                const style = getComputedStyle(current);
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                opacity *= Number(style.opacity);
            }
            return opacity > 0.05;
        };
        window.__flowWorldSnapshot = () => {
            const board = mode.boardController;
            const modal = document.getElementById('odyssey-flow-overlay');
            const mapUi = ['odyssey-board-overlay', 'odyssey-level-panel', 'odyssey-navigator-btn']
                .filter((id) => visible(document.getElementById(id)));
            return {
                ms: performance.now() - trace.startedAt,
                stage: modal?.dataset.worldStage || null,
                variant: modal?.dataset.variant || null,
                pathPosition: board?.cameraController?.getCurrentPosition?.() ?? null,
                cameraPosition: board?.camera?.position?.toArray?.() || null,
                cameraQuaternion: board?.camera?.quaternion?.toArray?.() || null,
                boardVisible: visible(document.getElementById('odyssey-board-3d')),
                rendering: !!board?.isActive && !board?.isRenderingPaused,
                interactionAttached: !!board?.interactionAttached,
                sameBoard: board === initialBoard,
                sameRenderer: board?.renderer === initialRenderer,
                visibilityHeld: modal?.dataset.visibilityHeld === 'true',
                scenicCovered: modal?.dataset.scenicCovered === 'true',
                selectedLevel: board?.selectedLevelId ?? null,
                mapUi,
            };
        };
        if (initialBoard?.travelToLevel) {
            const travel = initialBoard.travelToLevel.bind(initialBoard);
            initialBoard.travelToLevel = (id, options = {}) => {
                trace.worldTravelCalls.push({
                    level: id,
                    ms: performance.now() - trace.startedAt,
                    pathTravel: options.pathTravel === true,
                    chapterArrival: options.chapterArrival === true,
                    duration: options.travelDuration ?? null,
                    focus: options.focus ?? true,
                });
                return travel(id, options);
            };
        }
        const camera = initialBoard?.cameraController;
        if (camera?.updatePathTravel) {
            const update = camera.updatePathTravel.bind(camera);
            camera.updatePathTravel = (...args) => {
                const wasActive = camera.pathTravel?.active;
                const result = update(...args);
                if (wasActive && trace.worldCameraSamples.length < 2400) {
                    const state = window.__flowWorldSnapshot();
                    trace.worldCameraSamples.push(state);
                    const travel = camera.pathTravel;
                    const low = Math.min(travel?.startPosition, travel?.endPosition);
                    const high = Math.max(travel?.startPosition, travel?.endPosition);
                    if (shouldPauseWorld && !trace.fixtureWorldPause && state.stage === 'travel'
                        && state.pathPosition > low + 0.000001 && state.pathPosition < high - 0.000001) {
                        trace.fixtureWorldPause = state;
                        document.querySelector('#odyssey-flow-overlay [data-flow-action="pause"]')?.click();
                    }
                }
                return result;
            };
        }
        const sample = () => {
            const state = window.__flowWorldSnapshot();
            if (state.stage && !trace.worldCancelled && trace.worldSamples.length < 2400) {
                trace.worldSamples.push(state);
                if ((state.interactionAttached || state.mapUi.length) && trace.mapUiViolations.length < 20) {
                    trace.mapUiViolations.push(state);
                }
            }
            if (!trace.worldCancelled && !trace.calls.some((call) => call.name === 'beginLevelRun')) {
                window.__flowSampleFrame = requestAnimationFrame(sample);
            }
        };
        sample();
    }, pauseWorld);
}

function assertWorldJourney(trace, fixture, reduced, cancelled = false) {
    assert.ok(trace.worldSamples.length > 0, 'No world journey was observed');
    assert.deepEqual(trace.mapUiViolations, [], 'Map UI or interaction flashed during automatic travel');
    assert.ok(
        trace.worldSamples.every((sample) => sample.sameBoard && sample.sameRenderer),
        'The resident world or its renderer was replaced',
    );
    const observed = [...trace.worldSamples, ...trace.worldCameraSamples];
    const visible = observed.filter((sample) => sample.boardVisible
        && sample.rendering && !sample.scenicCovered
        && ['emerging', 'travel'].includes(sample.stage));
    assert.ok(visible.length > 0, 'No visible, rendering world was observed before entry');
    const positions = visible.filter((sample) => sample.stage === 'travel')
        .map((sample) => sample.pathPosition).filter(Number.isFinite);
    if (!reduced) {
        assert.ok(
            trace.worldTravelCalls.some((call) => call.level === fixture.next
                && (call.pathTravel || (fixture.chapter !== fixture.nextChapter && call.chapterArrival))),
            'Next orb did not use explicit path travel',
        );
        assert.ok(
            new Set(positions.map((position) => position.toFixed(7))).size >= (cancelled ? 2 : 3),
            'The visible world never showed intermediate path positions',
        );
        assert.ok(
            positions.some((position) => position > Math.min(fixture.startPath, fixture.nextPath) + 0.000001
            && position < Math.max(fixture.startPath, fixture.nextPath) - 0.000001),
            'Travel samples never passed between the source and destination',
        );
    } else {
        assert.ok(
            !trace.worldTravelCalls.some((call) => (call.pathTravel || call.chapterArrival) && call.duration > 0),
            'Reduced motion still requested animated path travel',
        );
        assert.ok(
            visible.every((sample) => Math.abs(sample.pathPosition - fixture.startPath) < 0.00001),
            'Reduced motion should show the stable source world before a covered destination seek',
        );
    }
    if (!cancelled) {
        assert.ok(
            trace.worldSamples.some((sample) => sample.stage === 'entering'),
            'World travel never reached the next-orb entry phase',
        );
    }
}

async function captureWorldJourney(page, out, fixture, scenario) {
    const reduced = ['reduced', 'chapter-reduced'].includes(scenario);
    const holdsWorld = ['world-paused', 'world-map', 'chapter', 'chapter-map'].includes(scenario);
    await page.waitForFunction(({
        isReduced, hold,
    }) => {
        const world = window.__flowWorldSnapshot?.();
        if (!world) return false;
        return world.boardVisible && world.rendering && !world.scenicCovered
            && (isReduced ? ['emerging', 'travel'].includes(world.stage) : world.stage === 'travel')
            && (!hold || (window.__flowTrace.fixtureWorldPause && world.visibilityHeld));
    }, {
        isReduced: reduced, hold: holdsWorld,
    }, { timeout: 35_000 });
    // Pause is injected at an actual intermediate shipping-camera update, so
    // sparse software-GPU frames cannot skip a driver-side polling window.
    const captureBefore = await page.evaluate(() => window.__flowWorldSnapshot());
    await page.screenshot({ path: path.join(out, '03-world-travel.png') });
    const captureAfter = await page.evaluate(() => window.__flowWorldSnapshot());
    const evidence = {
        captureBefore, captureAfter, screenshot: '03-world-travel.png', pausedForCapture: holdsWorld,
    };
    if (!holdsWorld) return evidence;
    await page.waitForFunction(
        () => document.getElementById('odyssey-flow-overlay')?.dataset.visibilityHeld === 'true',
    );
    // Settle one queued frame before comparing the deliberately paused glide.
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const before = await snapshot(page);
    assert.equal(before.world.stage, 'travel', 'Pause missed the world glide');
    assert.equal(before.running, false, 'Gameplay was running during world travel');
    await page.mouse.wheel(0, 400);
    await page.mouse.click(1100, 100);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', repeat: true, bubbles: true, cancelable: true,
    })));
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(1400);
    const after = await snapshot(page);
    assert.ok(
        Math.abs(after.world.pathPosition - before.world.pathPosition) < 0.0000001,
        'Path travel moved while paused',
    );
    assert.equal(
        after.world.selectedLevel,
        before.world.selectedLevel,
        'Map input changed the destination during paused travel',
    );
    assert.equal(after.calls.filter((call) => call.name === 'beginLevelRun').length, 0);
    assert.equal(after.calls.filter((call) => call.name === 'launchOdysseyLevel').length, 0);
    await page.screenshot({ path: path.join(out, '03b-world-paused.png') });
    evidence.pause = { heldForMs: 1400, before, after };
    if (!['world-map', 'chapter-map'].includes(scenario)) {
        await page.getByRole('button', { name: 'Resume journey', exact: true }).click();
        return evidence;
    }
    await page.evaluate(() => { window.__flowTrace.worldCancelled = true; });
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.waitForFunction(() => window.odysseyMode?.isInBoardView
        && window.odysseyMode.boardController?.interactionAttached && !window.odysseyMode.isEnteringLevel
        && !document.getElementById('odyssey-flow-overlay'), null, { timeout: 30_000 });
    await page.waitForTimeout(3200);
    const cancelled = await snapshot(page);
    const hitTesting = await page.evaluate(() => {
        const container = document.getElementById('odyssey-board-3d');
        const canvas = window.odysseyMode.boardController?.renderer?.domElement;
        const samples = [[0.75, 0.3], [0.65, 0.5], [0.4, 0.25]].map(([x, y]) => {
            const hit = document.elementFromPoint(window.innerWidth * x, window.innerHeight * y);
            return {
                x, y, tag: hit?.tagName, id: hit?.id, canvas: hit === canvas,
            };
        });
        return {
            containerPointerEvents: container ? getComputedStyle(container).pointerEvents : null,
            canvasPointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : null,
            samples,
        };
    });
    assert.equal(hitTesting.containerPointerEvents, 'auto', 'Restored map container still blocks pointer input');
    assert.equal(hitTesting.canvasPointerEvents, 'auto', 'Restored map canvas still blocks pointer input');
    assert.ok(hitTesting.samples.some((sample) => sample.canvas), 'Restored map canvas cannot be hit-tested');
    const orbClick = await page.evaluate((levelId) => {
        const board = window.odysseyMode.boardController;
        const canvas = board.renderer.domElement;
        const bounds = canvas.getBoundingClientRect();
        const candidates = [levelId, ...board.nodeManager.nodes.keys()]
            .filter((id, index, list) => id !== board.selectedLevelId && list.indexOf(id) === index);
        for (const id of candidates) {
            const point = board.nodeManager.getNodePosition(id)?.project(board.camera);
            if (point && point.z >= -1 && point.z <= 1) {
                const x = bounds.left + (point.x + 1) * 0.5 * bounds.width;
                const y = bounds.top + (1 - point.y) * 0.5 * bounds.height;
                if (document.elementFromPoint(x, y) === canvas) {
                    return {
                        levelId: id, previousSelection: board.selectedLevelId, x, y,
                    };
                }
            }
        }
        return null;
    }, fixture.start);
    assert.ok(orbClick, 'No different visible orb is available for the restored-map pointer check');
    await page.mouse.move(orbClick.x, orbClick.y);
    await page.mouse.click(orbClick.x, orbClick.y);
    await page.waitForFunction(
        (id) => window.odysseyMode?.boardController?.selectedLevelId === id,
        orbClick.levelId,
        { timeout: 4000 },
    );
    hitTesting.orbClick = orbClick;
    assert.equal(cancelled.running, false, 'Cancelled world journey started gameplay');
    assert.equal(cancelled.calls.filter((call) => call.name === 'beginLevelRun').length, 0);
    assert.equal(cancelled.calls.filter((call) => call.name === 'launchOdysseyLevel').length, 0);
    assert.equal(cancelled.calls.filter((call) => call.name === 'saveCompletion').length, 1);
    assert.equal(
        (await snapshot(page)).calls.filter((call) => call.name === 'launchOdysseyLevel').length,
        0,
        'Selecting a restored-map orb should show its panel without automatic entry',
    );
    const trace = await page.evaluate(() => window.__flowTrace);
    assertWorldJourney(trace, fixture, false, true);
    await page.screenshot({ path: path.join(out, '04-map-cancelled.png') });
    evidence.cancellation = {
        heldAfterRestoreMs: 3200, cancelled, hitTesting, trace,
    };
    return evidence;
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
            && window.odysseyMode.entryPhase === 'playable' && modal?.dataset.visibilityHeld === 'true';
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
                    document.body.style.background = '#080713';
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
                // Reading room is measured once the staged entrance has settled (1.6 s without a
                // reward), still well before the shortest automatic beat (3.4 s).
                await page.waitForTimeout(1700);
                const prefix = `${size.name}-${from}-to-${from + 1}`;
                await page.screenshot({ path: path.join(out, `${prefix}-completion.png`), animations: 'disabled' });
                const before = await page.evaluate(() => {
                    const modal = window.__uiModal;
                    const goal = modal.querySelector('.ody-flow__goal').getBoundingClientRect();
                    // The overlay keeps flowing only while what must be read is in view: the
                    // reward (none in this fixture), the next orb and Pause. Results and Map may scroll.
                    const inView = (node) => {
                        const rect = node?.getBoundingClientRect();
                        return !rect || rect.bottom <= rect.top
                            || (rect.top >= 0 && rect.bottom <= window.innerHeight - 8);
                    };
                    return {
                        goalY: goal.y,
                        essentialsInView: [
                            modal.querySelector('[data-flow-action="pause"]'),
                            modal.querySelector('.ody-flow__next'),
                            modal.querySelector('.ody-theme-reward'),
                        ].every(inView),
                        autoRunning: modal.dataset.autoRunning,
                        holdMs: modal.autoContinueMs,
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
                    String(before.essentialsInView),
                    `${prefix}: automatic continuation must wait when the next orb or Pause is outside the viewport`,
                );
                if (!before.essentialsInView && from === 1) {
                    await page.waitForTimeout(3200);
                    assert.deepEqual(
                        await page.evaluate(() => window.__uiChoices),
                        [],
                        `${prefix}: overflowed completion advanced before the player could read`,
                    );
                }
                await page.evaluate(async () => { window.__uiModal.beginTransit(); await window.__uiModal.cover(); });
                // The ceremony departs in place before the briefing takes the transit layout.
                await page.waitForTimeout(420);
                const after = await page.evaluate(() => {
                    const goal = window.__uiGoal.getBoundingClientRect();
                    return {
                        sameModal: window.__uiModal === document.getElementById('odyssey-flow-overlay'),
                        sameGoal: window.__uiGoal === window.__uiModal.querySelector('.ody-flow__goal'),
                        sameChanges: window.__uiChanges === window.__uiModal.querySelector('.ody-flow__changes'),
                        layout: window.__uiModal.dataset.layout,
                        departing: window.__uiModal.dataset.departing,
                        goalY: goal.y,
                        goalVisible: goal.height > 0 && goal.bottom > 0 && goal.top < window.innerHeight,
                    };
                });
                assert.ok(after.sameModal && after.sameGoal && after.sameChanges, `${prefix}: replaced composition`);
                assert.equal(after.departing, 'false', `${prefix}: ceremony never finished departing`);
                assert.equal(after.layout, 'transit', `${prefix}: wrong transit layout`);
                assert.ok(after.goalVisible, `${prefix}: briefing goal hidden during transit`);
                await page.screenshot({ path: path.join(out, `${prefix}-transit.png`), animations: 'disabled' });
                await page.getByRole('button', { name: 'Pause', exact: true }).click();
                assert.equal(await page.locator('#odyssey-flow-overlay').getAttribute('data-visibility-held'), 'true');
                await page.screenshot({ path: path.join(out, `${prefix}-paused.png`), animations: 'disabled' });
                await page.getByRole('button', { name: 'Resume journey', exact: true }).click();
                assert.equal(await page.locator('#odyssey-flow-overlay').getAttribute('data-visibility-held'), 'false');
                await page.evaluate(() => {
                    // Clearly synthetic backdrop; real world visibility is verified in live scenarios.
                    document.body.style.background = 'radial-gradient(ellipse at 65% 20%, '
                        + '#427780, #102432 65%, #080713)';
                    document.body.style.minHeight = '100vh';
                    window.__uiModal.setScenic('travel');
                });
                // Measure the docked briefing after its entrance, as the overlay itself does.
                await page.waitForTimeout(760);
                const scenic = await page.evaluate(() => {
                    const modal = window.__uiModal;
                    const content = modal.querySelector('.ody-flow__content');
                    const panel = content.getBoundingClientRect();
                    const actions = modal.querySelector('.ody-flow__actions').getBoundingClientRect();
                    return {
                        stage: modal.dataset.worldStage,
                        sameGoal: window.__uiGoal === modal.querySelector('.ody-flow__goal'),
                        sameChanges: window.__uiChanges === modal.querySelector('.ody-flow__changes'),
                        heldForReading: modal.dataset.visibilityHeld === 'true',
                        panelTop: panel.top,
                        panelBottom: panel.bottom,
                        panelWidth: panel.width,
                        panelHeight: panel.height,
                        scrollWidth: content.scrollWidth,
                        clientWidth: content.clientWidth,
                        actionsVisible: actions.top >= 0 && actions.bottom <= window.innerHeight,
                        portalHidden: getComputedStyle(modal.querySelector('.ody-flow__portal')).display === 'none',
                    };
                });
                assert.equal(scenic.stage, 'travel');
                assert.ok(scenic.sameGoal && scenic.sameChanges, `${prefix}: scenic briefing was replaced`);
                assert.ok(scenic.scrollWidth <= scenic.clientWidth + 1, `${prefix}: scenic horizontal clipping`);
                assert.ok(scenic.actionsVisible, `${prefix}: scenic controls are outside the viewport`);
                assert.ok(
                    scenic.portalHidden && scenic.panelTop > size.height * 0.35,
                    `${prefix}: scenic panel does not leave room for the world`,
                );
                await page.screenshot({ path: path.join(out, `${prefix}-scenic.png`), animations: 'disabled' });
                if (!scenic.heldForReading) await page.getByRole('button', { name: 'Pause', exact: true }).click();
                assert.equal(await page.locator('#odyssey-flow-overlay').getAttribute('data-visibility-held'), 'true');
                await page.getByRole('button', { name: 'Resume journey', exact: true }).click();
                assert.equal(await page.locator('#odyssey-flow-overlay').getAttribute('data-visibility-held'), 'false');
                report.push({
                    prefix, before, after, scenic, pauseResume: 'pass',
                });
            }
        }
        assert.deepEqual(errors, [], 'UI browser errors');
        await writeFile(path.join(out, 'result.json'), JSON.stringify({
            status: 'pass',
            cases: report,
            errors,
            limitation: 'Isolated real DOM/CSS and effective registry configs over a synthetic CSS backdrop; '
                + 'no game renderer or physical device.',
            screenshotMethod: 'Settled CSS animations; real automatic countdown continues until transit is requested.',
        }, null, 2));
        console.log(JSON.stringify({
            scenario: 'ui', status: 'pass', cases: report.length, out,
        }));
    } finally {
        await browser.close();
    }
}

async function captureFinale(page, out, fixture) {
    await page.waitForSelector('#odyssey-finale-modal', { timeout: 15_000 });
    const before = await snapshot(page);
    assert.equal(before.sessionRetired, true, 'Finale left its completed session active');
    assert.equal(before.hybridLoopRunning, false, 'Finale left its simulation driver running');
    assert.equal(before.calls.filter((call) => call.name === 'saveCompletion').length, 1);
    const facts = await page.locator('.ody-finale__facts').innerText();
    const saved = await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('serenityBlocks_odysseyProgress'));
        const levels = window.odysseyMode.levelRegistry.getAllLevels();
        return {
            registeredCompleted: levels.filter((level) => data?.completedLevels?.[level.id]).length,
            stars: levels.reduce((total, level) => total + (data?.completedLevels?.[level.id]?.stars || 0), 0),
            source: data?.completedLevels?.[window.odysseyMode.currentLevelId],
        };
    });
    assert.equal(saved.registeredCompleted, fixture.campaign.registered, 'Campaign was not persisted completely');
    assert.ok(saved.source?.stars >= 1, 'Source completion was not persisted');
    assert.ok(facts.includes(`${fixture.campaign.registered} / ${fixture.campaign.registered}`));
    assert.ok(facts.includes(`${fixture.campaign.chapters} / ${fixture.campaign.chapters}`));
    assert.ok(facts.includes(`${saved.stars} / ${fixture.campaign.registered * 3}`));
    await page.waitForTimeout(3200);
    assert.deepEqual((await snapshot(page)).calls, before.calls, 'Finale advanced without input');
    await page.screenshot({ path: path.join(out, '02-finale.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'View this orb’s results', exact: true }).click();
    await page.waitForSelector('#odyssey-results-modal', { timeout: 5000 });
    await page.screenshot({ path: path.join(out, '03-finale-details.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#odyssey-finale-modal', { timeout: 5000 });
    assert.equal((await snapshot(page)).calls.filter((call) => call.name === 'saveCompletion').length, 1);
    const target = await page.evaluate(() => {
        const mode = window.odysseyMode;
        return mode.levelRegistry.getAllLevels().find((level) => mode.odysseyState.getLevelStars(level.id) < 3)?.id;
    });
    await page.getByRole('button', { name: 'Follow the next star', exact: true }).click();
    await page.waitForFunction((id) => window.odysseyMode.isInBoardView
        && window.odysseyMode.boardController?.interactionAttached
        && window.odysseyMode.boardController?.selectedLevelId === id
        && !document.getElementById('odyssey-finale-modal'), target, { timeout: 30_000 });
    await page.waitForTimeout(3200);
    const after = await snapshot(page);
    assert.equal(after.running, false, 'Mastery selection started gameplay automatically');
    assert.equal(after.calls.filter((call) => call.name === 'launchOdysseyLevel').length, 0);
    assert.equal(after.calls.filter((call) => call.name === 'beginLevelRun').length, 0);
    assert.equal(after.calls.filter((call) => call.name === 'saveCompletion').length, 1);
    await page.screenshot({ path: path.join(out, '04-finale-mastery-map.png'), animations: 'disabled' });
    return {
        facts, saved, before, after, target, heldForMs: 3200, detailsRoundTrip: true,
    };
}

async function runFinaleUiScenario(chromium, config) {
    const out = path.join(config.out, 'finale-ui');
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
        const fixtureUrl = new URL('/__odyssey_finale_ui_fixture', config.url).href;
        await page.route(fixtureUrl, (route) => route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${
                ['/styles/fonts.css', '/styles/keystone.css', '/styles/odyssey-finale.css']
                    .map((href) => `<link rel="stylesheet" href="${href}">`).join('')
            }</head><body style="margin:0;background:#080713"></body></html>`,
        }));
        await page.goto(fixtureUrl);
        await page.evaluate(async ({ finalePath, registryPath, summaryPath }) => {
            const [{ createCampaignFinale }, { LevelRegistry }, { getOdysseyCampaignSummary }] = await Promise.all([
                import(finalePath), import(registryPath), import(summaryPath),
            ]);
            const registry = new LevelRegistry();
            window.__finaleSummary = getOdysseyCampaignSummary(registry, {
                isLevelCompleted: () => true,
                getLevelStars: () => 2,
            });
            window.__createFinale = createCampaignFinale;
            window.__mountFinale = () => {
                window.__finale?.dispose();
                window.__finaleChoices = [];
                window.__finale = createCampaignFinale({
                    summary: window.__finaleSummary,
                    onChoose: (choice) => window.__finaleChoices.push(choice),
                });
                document.body.appendChild(window.__finale);
            };
            await document.fonts.ready;
        }, {
            finalePath: '/src/ui/odyssey/CampaignFinale.js',
            registryPath: '/src/core/odyssey/LevelRegistry.js',
            summaryPath: '/src/core/odyssey/odyssey-campaign-summary.js',
        });
        for (const size of [
            {
                name: 'desktop', width: 1280, height: 800, fontSize: 16,
            },
            {
                name: 'mobile', width: 320, height: 640, fontSize: 16,
            },
            {
                name: 'landscape', width: 844, height: 390, fontSize: 16,
            },
            {
                name: 'large-text', width: 640, height: 800, fontSize: 32,
            },
        ]) {
            await page.setViewportSize({ width: size.width, height: size.height });
            await page.evaluate((fontSize) => {
                document.documentElement.style.fontSize = `${fontSize}px`;
                window.__mountFinale();
            }, size.fontSize);
            await page.waitForTimeout(950);
            const layout = await page.evaluate(() => {
                const modal = window.__finale;
                const content = modal.querySelector('.ody-finale__content');
                return {
                    width: modal.clientWidth,
                    scrollWidth: modal.scrollWidth,
                    contentTop: content.getBoundingClientRect().top,
                    scrollHeight: modal.scrollHeight,
                    height: modal.clientHeight,
                    choices: window.__finaleChoices,
                    chapterStations: modal.querySelectorAll('.ody-finale__station').length,
                    expectedChapters: window.__finaleSummary.totalChapters,
                };
            });
            assert.ok(layout.scrollWidth <= layout.width + 1, `${size.name}: horizontal clipping`);
            assert.ok(layout.contentTop >= 0, `${size.name}: top content is unreachable`);
            assert.equal(layout.chapterStations, layout.expectedChapters);
            assert.deepEqual(layout.choices, []);
            await page.screenshot({ path: path.join(out, `${size.name}-top.png`), animations: 'disabled' });
            for (const action of ['world', 'mastery', 'details']) {
                if (action !== 'world') await page.evaluate(() => window.__mountFinale());
                const button = page.locator(`[data-finale-action="${action}"]`);
                await button.scrollIntoViewIfNeeded();
                if (action === 'world') {
                    await page.screenshot({ path: path.join(out, `${size.name}-actions.png`), animations: 'disabled' });
                    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter', repeat: true, bubbles: true, cancelable: true,
                    })));
                    assert.deepEqual(await page.evaluate(() => window.__finaleChoices), []);
                }
                await button.click();
                assert.deepEqual(await page.evaluate(() => window.__finaleChoices), [action]);
                assert.equal(await page.locator('#odyssey-finale-modal').count(), 0);
            }
            await page.evaluate(() => { window.__mountFinale(); window.__finale.dispose(); });
            await page.keyboard.press('Enter');
            assert.deepEqual(await page.evaluate(() => window.__finaleChoices), [], 'Disposed finale retained input');
            report.push({ size, layout, actionsAndDispose: 'pass' });
        }
        assert.deepEqual(errors, []);
        await writeFile(path.join(out, 'result.json'), JSON.stringify({
            status: 'pass',
            cases: report,
            errors,
            limitation: 'Real finale DOM/CSS with registry-derived synthetic summary; '
                + 'runtime save verified separately.',
        }, null, 2));
        console.log(JSON.stringify({
            scenario: 'finale-ui', status: 'pass', cases: report.length, out,
        }));
    } finally { await browser.close(); }
}

async function runScenario(chromium, config, scenario) {
    const reduced = ['reduced', 'chapter-reduced'].includes(scenario);
    const chapter = scenario.startsWith('chapter');
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
        viewport: config.viewport || { width: 1280, height: 800 },
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
            const level = kind.startsWith('chapter')
                ? registry.getChapterEndLevel(1) : registry.getChapterStartLevel(1);
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
                startPath: window.odysseyMode.boardController.nodeManager.nodes.get(level.id)?.pathPosition,
                nextPath: window.odysseyMode.boardController.nodeManager.nodes.get(next.id)?.pathPosition,
            };
        }, scenario);
        fixture.sourceThemePrefetchRequested = Boolean(config.warmSource);
        assert.equal(fixture.chapter === fixture.nextChapter, !chapter, 'Fixture boundary changed');
        if (scenario === 'finale') {
            fixture.campaign = await page.evaluate((missingId) => {
                const mode = window.odysseyMode;
                const levels = mode.levelRegistry.getAllLevels();
                levels.filter((level) => level.id !== missingId).forEach((level) => {
                    mode.odysseyState.completeLevel(level.id, { stars: 1, score: 100, time: 30 });
                });
                return {
                    registered: levels.length,
                    chapters: mode.levelRegistry.getAllChapters().length,
                    missingId,
                    completedBefore: levels.filter((level) => mode.odysseyState.isLevelCompleted(level.id)).length,
                    sourceCompleteBefore: mode.odysseyState.isLevelCompleted(missingId),
                    methodology: 'Seed registered orbs except source using the actual save API; '
                        + 'real source completion closes campaign.',
                };
            }, fixture.start);
            assert.equal(fixture.campaign.completedBefore, fixture.campaign.registered - 1);
            assert.equal(fixture.campaign.sourceCompleteBefore, false);
        }
        if (config.slowGpu) {
            // Fixture only: a software rasteriser can need far longer than real hardware to
            // prepare under the portal. Widen the covered budget; readiness itself is unchanged.
            fixture.slowGpuBlackoutBudgetMs = await page.evaluate(() => {
                const mode = window.odysseyMode;
                const budget = 60_000;
                const entry = mode._buildJourneyEntryTimings.bind(mode);
                mode._buildJourneyEntryTimings = (...a) => ({ ...entry(...a), maxBlackoutHoldMs: budget });
                const back = mode._buildJourneyReturnTimings.bind(mode);
                mode._buildJourneyReturnTimings = (...a) => ({ ...back(...a), maxBlackoutHoldMs: budget });
                return budget;
            });
        }
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
        await installTrace(page, ['world-paused', 'world-map', 'chapter', 'chapter-map'].includes(scenario));
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
        if (scenario === 'finale') {
            const finale = await captureFinale(page, out, fixture);
            assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
            assert.deepEqual(consoleErrors, [], 'Browser console errors');
            await writeFile(path.join(out, 'result.json'), JSON.stringify({
                status: 'pass',
                scenario,
                fixture,
                finale,
                pageErrors,
                consoleErrors,
                limitation: 'Synthetic saved completions, isolated browser storage, software WebGL2 and muted audio.',
            }, null, 2));
            console.log(JSON.stringify({ scenario, status: 'pass', out }));
            return;
        }
        await page.waitForSelector('#odyssey-flow-overlay[data-variant="completion"]', { timeout: 15_000 });
        console.log(`[odyssey-flow:${scenario}] Completion feedback is visible`);
        // Let the staged reveal (stars, then the theme art) settle before the capture.
        await page.waitForTimeout(1800);
        // A busy software compositor can still paint its first CSS animation frame late.
        // Capture settled CSS composition without changing the JavaScript flow timer.
        await page.screenshot({ path: path.join(out, '02-completion.png'), animations: 'disabled' });
        const preference = await page.locator('#odyssey-flow-overlay').getAttribute('data-reduced-motion');
        assert.equal(preference, String(reduced), 'Overlay must honor the operating-system motion preference');
        let chapterPause = null;
        let interruption = null;
        let worldJourney = null;
        if (chapter) {
            worldJourney = await captureWorldJourney(page, out, fixture, scenario);
            if (scenario === 'chapter-map') {
                assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
                assert.deepEqual(consoleErrors, [], 'Browser console errors');
                await writeFile(path.join(out, 'result.json'), JSON.stringify({
                    status: 'pass',
                    scenario,
                    fixture,
                    worldJourney,
                    pageErrors,
                    consoleErrors,
                    limitation: 'Synthetic completion, disposable storage, software WebGL2; '
                        + 'no hardware performance claim.',
                }, null, 2));
                console.log(JSON.stringify({ scenario, status: 'pass', out }));
                return;
            }
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
            assert.equal(
                after.world.pathPosition,
                before.world.pathPosition,
                'Rail position drifted during chapter reading',
            );
            if (reduced) {
                assert.deepEqual(
                    after.world.cameraPosition,
                    before.world.cameraPosition,
                    'Reduced-motion camera moved during chapter reading',
                );
                assert.deepEqual(
                    after.world.cameraQuaternion,
                    before.world.cameraQuaternion,
                    'Reduced-motion camera rotated during chapter reading',
                );
            }
            assert.equal(after.world.interactionAttached, false, 'Chapter reading exposed map input');
            assert.deepEqual(after.world.mapUi, [], 'Chapter reading exposed map UI');
            await page.screenshot({ path: path.join(out, '03-chapter.png') });
            chapterPause = { heldForMs: 3200, before, after };
            console.log(`[odyssey-flow:${scenario}] Chapter reveal held for 3200 ms; beginning deliberately`);
            await page.getByRole('button', { name: 'Begin chapter', exact: true }).click();
        } else {
            await page.waitForSelector('#odyssey-flow-overlay[data-variant="transit"]', { timeout: 15_000 });
            worldJourney = await captureWorldJourney(page, out, fixture, scenario);
            if (scenario === 'world-map') {
                assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
                assert.deepEqual(consoleErrors, [], 'Browser console errors');
                await writeFile(path.join(out, 'result.json'), JSON.stringify({
                    status: 'pass',
                    scenario,
                    fixture,
                    worldJourney,
                    pageErrors,
                    consoleErrors,
                    limitation: 'Synthetic completion, isolated storage, software WebGL2; '
                        + 'no hardware performance claim.',
                }, null, 2));
                console.log(JSON.stringify({ scenario, status: 'pass', out }));
                return;
            }
            if (scenario === 'interrupted') {
                await page.waitForFunction(
                    (id) => window.odysseyMode?.currentLevelId === id
                    && ['preparing', 'prepared'].includes(window.odysseyMode.entryPhase)
                    && document.getElementById('odyssey-flow-overlay')?.dataset.worldStage === 'entering',
                    fixture.next,
                    { timeout: 30_000 },
                );
                interruption = await interruptTransit(page, out, fixture.next);
            }
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
        await writeFile(path.join(out, 'trace.json'), JSON.stringify(result.trace, null, 2));
        assert.equal(calls('saveCompletion').length, 1, 'Completion must be saved exactly once');
        assert.equal(calls('prepareLevelStart').length, 1, 'Next orb must be prepared exactly once');
        assert.equal(calls('beginLevelRun').length, 1, 'Next orb must start exactly once');
        assert.equal(calls('beginLevelRun')[0].level, fixture.next, 'Wrong next orb started');
        assert.equal(calls('returnToBoard').length, 1, 'Journey must return to its resident world exactly once');
        assert.equal(calls('launchOdysseyLevel').length, 1, 'Journey must enter its next orb exactly once');
        assertWorldJourney(result.trace, fixture, reduced);
        if (!chapter) {
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
            worldJourney,
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
            trace: await page.evaluate(() => window.__flowTrace || null).catch(() => null),
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
  --scenario <name>  within (default), reduced, chapter, chapter-map, chapter-reduced,
                     finale, finale-ui, interrupted, entry-interrupted, retry-interrupted,
                     world-paused, world-map, ui, or all (runtime cases)
  --base-url <url>   Existing development server (default http://127.0.0.1:5173)
  --out <directory>  Captures and reports (default artifacts/odyssey-flow)
  --warm-source      Await existing source-theme prefetch before entry (recorded fixture setup)
  --slow-gpu         Widen the covered portal budget to 60 s for software rasterisers (recorded
                     fixture setup; readiness checks are unchanged)
  --viewport=WxH     Runtime viewport (default 1280x800); smaller sizes render faster in software
  --help            Show this help without loading Playwright or starting a browser
Environment: ODYSSEY_FLOW_BASE_URL or BASE_URL, CHROMIUM_PATH, PLAYWRIGHT_MODULE.
Each scenario uses a fresh browser and disposable storage, serially. Starts chapter 1's
first orb, or its registry-resolved last orb for chapter. Injects a synthetic line goal
into the real completion path. Interrupted also dispatches a synthetic window blur
during next-orb preparation and requires deliberate Resume after readiness. World-paused
holds mid-glide until Resume; world-map cancels from the paused glide and checks no late start.
Chapter uses the same real-camera Pause/Resume check, then verifies an untimed arrival and
explicit Begin. Chapter-map cancels while travelling; chapter-reduced checks a covered seek
and stable reading camera. Finale seeds every registered orb except orb1 through the real
save API, then completes orb1 through the real evaluator; checks persisted campaign facts,
untimed finale, details roundtrip and next-star map selection without automatic gameplay.
Finale-ui verifies the actual finale DOM/CSS at four viewport/text sizes, its three choices,
repeated-input protection and disposal; its registry-derived summary is explicitly synthetic.
World captures include path samples, renderer identity and suppressed map UI. Software WebGL2 evidence
is not a hardware FPS benchmark or a simulation of actual OS focus loss. Entry/retry cases
hold prepared runs after synthetic blur. UI captures effective 1→2, 3→4 and 6→7 briefings
at desktop, 320px, 844×390 landscape and 200% root text sizes, including retained transit,
Pause/Resume and automatic reading holds when Pause does not fit in the viewport.`);
        return;
    }
    const { chromium } = await loadPlaywright();
    if (config.scenario === 'ui') { await runUiScenario(chromium, config); return; }
    if (config.scenario === 'finale-ui') { await runFinaleUiScenario(chromium, config); return; }
    for (const scenario of config.scenario === 'all' ? SCENARIOS : [config.scenario]) {
        await runScenario(chromium, config, scenario);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
