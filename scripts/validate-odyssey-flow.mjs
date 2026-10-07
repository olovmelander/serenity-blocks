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

const SCENARIOS = ['within', 'reduced', 'chapter', 'interrupted'];
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
        else if (['--scenario', '--base-url', '--out'].includes(arg)) {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            if (arg === '--scenario') config.scenario = value;
            if (arg === '--base-url') config.baseUrl = value;
            if (arg === '--out') config.out = path.resolve(value);
        } else if (SCENARIOS.includes(arg) || arg === 'all') config.scenario = arg;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (![...SCENARIOS, 'all'].includes(config.scenario)) {
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

async function interruptTransit(page, out, nextLevelId) {
    // Synthetic presence event: exercise the real blur listener without claiming
    // an OS window switch or background-tab throttling measurement.
    const triggerState = await page.evaluate(() => {
        const phase = window.odysseyMode.entryPhase;
        const revealed = document.getElementById('odyssey-flow-overlay')?.dataset.revealed === 'true';
        window.dispatchEvent(new Event('blur'));
        return { phase, revealed };
    });
    assert.equal(triggerState.phase, 'preparing', 'Interruption must occur while the next orb is preparing');
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
        assert.equal(fixture.chapter === fixture.nextChapter, scenario !== 'chapter', 'Fixture boundary changed');
        console.log(`[odyssey-flow:${scenario}] Launching source orb ${fixture.start}`);
        await page.evaluate((id) => {
            if (typeof window.testOdysseyLevel !== 'function') {
                throw new Error('Run against the development server: the prepared fixture needs testOdysseyLevel');
            }
            window.__flowEntry = window.testOdysseyLevel(id);
        }, fixture.start);
        const sourceEntered = await page.evaluate(() => window.__flowEntry);
        assert.notEqual(sourceEntered, false, 'Source orb entry aborted before the flow fixture');
        await page.waitForFunction(
            (id) => window.odysseyMode?.levelRunStarted && window.odysseyMode?.currentLevelId === id,
            fixture.start,
            { timeout: TIMEOUT },
        );
        console.log(`[odyssey-flow:${scenario}] Source orb ${fixture.start} is running`);
        await page.screenshot({ path: path.join(out, '01-running.png') });
        await page.evaluate(() => {
            const mode = window.odysseyMode;
            window.__flowTrace = { startedAt: performance.now(), calls: [] };
            const record = (name) => {
                window.__flowTrace.calls.push({
                    name, ms: performance.now() - window.__flowTrace.startedAt, level: mode.currentLevelId,
                });
            };
            for (const name of ['returnToBoard', 'launchOdysseyLevel', 'prepareLevelStart', 'beginLevelRun']) {
                const original = mode[name].bind(mode);
                mode[name] = (...args) => { record(name); return original(...args); };
            }
            const save = mode.odysseyState.completeLevel.bind(mode.odysseyState);
            mode.odysseyState.completeLevel = (...args) => { record('saveCompletion'); return save(...args); };
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
  --scenario <name>  within (default), reduced, chapter, interrupted, or all; positional name accepted
  --base-url <url>   Existing development server (default http://127.0.0.1:5173)
  --out <directory>  Captures and reports (default artifacts/odyssey-flow)
  --help            Show this help without loading Playwright or starting a browser
Environment: ODYSSEY_FLOW_BASE_URL or BASE_URL, CHROMIUM_PATH, PLAYWRIGHT_MODULE.
Each scenario uses a fresh browser and disposable storage, serially. Starts chapter 1's
first orb, or its registry-resolved last orb for chapter. Injects a synthetic line goal
into the real completion path. Interrupted also dispatches a synthetic window blur
during transit and requires deliberate Resume after readiness. Software WebGL2 evidence
is not a hardware FPS benchmark or a simulation of actual OS focus loss.`);
        return;
    }
    const { chromium } = await loadPlaywright();
    for (const scenario of config.scenario === 'all' ? SCENARIOS : [config.scenario]) {
        await runScenario(chromium, config, scenario);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
