#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-await-in-loop -- One isolated chapter/browser at a time protects the GPU. */
/**
 * Bounded composition samples, not progression or performance measurements.
 * Reuses the shipping chapter-capture URL contract with a chapter + adjacent window.
 * Run against an existing stable Vite server (HMR off, optimizeDeps.noDiscovery true).
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(args) {
    const config = {
        chapter: 'all',
        baseUrl: 'http://127.0.0.1:5194',
        quality: 'High',
        out: path.resolve('artifacts/odyssey-chapter-audit-2026-10-08'),
        time: 9,
        settle: 2500,
        timeout: 180000,
        width: 1280,
        height: 800,
    };
    for (let index = 0; index < args.length; index += 1) {
        const key = args[index];
        if (key === '--help') config.help = true;
        else if (['--chapter', '--base-url', '--quality', '--out'].includes(key)) {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
            if (key === '--chapter') config.chapter = value;
            if (key === '--base-url') config.baseUrl = value;
            if (key === '--quality') config.quality = value;
            if (key === '--out') config.out = path.resolve(value);
        } else throw new Error(`Unknown argument: ${key}`);
    }
    if (config.chapter !== 'all' && !/^[1-8]$/.test(config.chapter)) throw new Error('Chapter must be 1–8 or all');
    if (!['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'].includes(config.quality)) {
        throw new Error('Unknown quality preset');
    }
    return config;
}

async function loadPlaywright() {
    if (process.env.PLAYWRIGHT_MODULE) {
        return import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href);
    }
    // eslint-disable-next-line import/no-unresolved -- Optional external developer tooling, not a game dependency.
    return import('playwright');
}

function chapterUrl(config, chapter) {
    const url = new URL(config.baseUrl);
    const neighbors = [chapter - 1, chapter, chapter + 1].filter((id) => id >= 1 && id <= 8);
    Object.entries({
        skipIntro: '1',
        forceWebGL: '1',
        odysseyAAA: '1',
        odysseyOverlay: '0',
        odysseyPixelRatio: '1',
        odysseyDisableAdaptiveQuality: '1',
        odysseyDisableBackgroundLoading: '1',
        odysseyCaptureChapters: neighbors.join(','),
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return { url: url.href, neighbors };
}

async function bootstrap(page, config, chapter) {
    await page.waitForFunction(() => window.serenityBlocks?.gameModeManager
        && window.startupPipelineSnapshot?.menuReady, null, { timeout: config.timeout });
    await page.evaluate(async ({
        chapterId, registryPath, overlayPath, arrivalPath,
    }) => {
        const [{ LevelRegistry }, { createJourneyFlowOverlay }, { resolveChapterArrivalProgress }] = await Promise.all([
            import(registryPath), import(overlayPath), import(arrivalPath),
        ]);
        const registry = new LevelRegistry();
        const first = registry.getChapterStartLevel(chapterId);
        const prior = registry.getAllLevels().filter((level) => level.id < first.id);
        localStorage.setItem('serenityBlocks_odysseyProgress', JSON.stringify({
            version: 2,
            currentChapter: chapterId,
            currentLevel: first.id,
            unlockedLevels: [...prior.map((level) => level.id), first.id],
            completedLevels: Object.fromEntries(prior.map((level) => [level.id, {
                stars: 2,
                bestScore: 100,
                bestTime: 30,
                attempts: 1,
                completedBonuses: [],
                completionDate: '2026-10-08T00:00:00.000Z',
            }])),
            statistics: { totalStars: prior.length * 2, totalAttempts: prior.length },
        }));
        const manager = window.serenityBlocks.gameModeManager;
        manager.getMode('odyssey')?.odysseyState?.load();
        window.__chapterVisual = { registry, createJourneyFlowOverlay, resolveChapterArrivalProgress };
        document.querySelector('#start-modal')?.classList.remove('visible');
        window.__chapterBoot = (async () => {
            await manager.activateMode('odyssey');
            await manager.startCurrentMode();
            return true;
        })();
    }, {
        chapterId: chapter,
        registryPath: '/src/core/odyssey/LevelRegistry.js',
        overlayPath: '/src/ui/odyssey/JourneyFlowOverlay.js',
        arrivalPath: '/src/rendering/odyssey/odyssey-chapter-arrival.js',
    });
    await page.waitForFunction(() => window.odysseyMode?.isInBoardView
        && window.odysseyMode?.boardController?.isActive, null, { timeout: config.timeout });
    await page.evaluate(() => window.__chapterBoot);
    await page.waitForFunction(() => {
        const board = window.odysseyMode.boardController;
        const manager = board.environmentManager;
        return board.captureChapterIds.every((id) => manager.environments.has(id)
            || (manager.suppressedChapters.has(id) && board.oneWorld?.group))
            && board.pendingChapterLoads.size === 0 && !board.isPrewarming && board.prewarmQueue.length === 0;
    }, null, { timeout: 30000 });
    return page.evaluate((chapterId) => {
        const mode = window.odysseyMode;
        const board = mode.boardController;
        const { registry, resolveChapterArrivalProgress } = window.__chapterVisual;
        const first = registry.getChapterStartLevel(chapterId);
        const levels = registry.getLevelsInChapter(chapterId);
        const positions = board.presentationLayout.chapterPositions;
        const start = positions[chapterId - 1];
        const end = positions[chapterId];
        const firstPath = board.nodeManager.nodes.get(first.id).pathPosition;
        const arrival = resolveChapterArrivalProgress(chapterId, firstPath, positions);
        // The final urban payoff is authored at the journey's end, rather than local .85.
        const late = chapterId === 8 ? 1 : start + (end - start) * 0.85;
        board.pauseRendering();
        mode._lockOdysseyBoardForLaunch();
        mode._setBoardOverlaySuppressed(true);
        mode._updateLevelPreview(null);
        const boardElement = document.getElementById('odyssey-board-3d');
        Array.from(document.body.children).forEach((node) => {
            if (node.contains(boardElement) || ['SCRIPT', 'STYLE'].includes(node.tagName)) return;
            node.style.setProperty('display', 'none', 'important');
        });
        ['odyssey-board-overlay', 'odyssey-level-panel', 'odyssey-navigator-btn', 'performance-overlay']
            .forEach((id) => document.getElementById(id)?.style.setProperty('display', 'none', 'important'));
        const camera = board.cameraController;
        camera.config.idleAutoDrift = false;
        camera.config.autoDriftScale = 0;
        camera.travelModel.velocity = 0;
        camera.travelModel.inputVelocity = 0;
        return {
            chapter: chapterId,
            name: registry.getChapter(chapterId).name,
            firstLevelId: first.id,
            firstOrbPath: firstPath,
            range: { start, end },
            levels: levels.map((level) => ({
                id: level.id, name: level.name, path: board.nodeManager.nodes.get(level.id).pathPosition,
            })),
            stations: [
                { name: 'arrival', path: arrival },
                { name: 'middle', path: start + (end - start) * 0.5 },
                { name: 'late', path: late },
            ],
            quality: board.qualityName,
            backend: board.isWebGL ? 'webgl2' : 'other',
            pixelRatio: board.renderer.getPixelRatio(),
            captureChapterIds: board.captureChapterIds,
            loadedChapters: [...board.environmentManager.environments.keys()],
            suppressedChapters: [...board.environmentManager.suppressedChapters],
            oneWorldEnabled: board.oneWorldEnabled,
            oneWorldPresent: !!board.oneWorld?.group,
            compileBarrierSettled: board._compilePool === null,
            warmup: board._warmupStats,
        };
    }, chapter);
}

async function renderStation(page, config, station, firstLevelId) {
    await page.evaluate(async ({ position, time }) => {
        const board = window.odysseyMode.boardController;
        const camera = board.cameraController;
        const blendState = board.environmentManager.getBlendState(position);
        board.environmentManager.updateVisibility(position, { mode: 'progress', blendState });
        board.environmentManager.updateGlobalEnvironment(position, blendState);
        board.director.time = time;
        const directorState = board.director.update(0, { ascentProgress: position, audio: null, blendState });
        camera.setDirectorState(directorState);
        await camera.travelToPosition(position, 0);
        window.__chapterVisual.renderPinned = () => {
            board.time = time;
            board.environmentManager.time = time;
            if (board.director) board.director.time = time;
            camera.breatheTime = time;
            board.lastPositionWorkAtMs = -Infinity;
            board.renderOnce(0);
            board.renderer.backend?.gl?.finish?.();
        };
        window.__chapterVisual.renderPinned();
    }, { position: station.path, time: config.time });
    await page.waitForTimeout(config.settle);
    await page.evaluate(() => window.__chapterVisual.renderPinned());
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150)));
    }));
    return page.evaluate((levelId) => {
        const board = window.odysseyMode.boardController;
        const manager = board.environmentManager;
        const progress = board.cameraController.getCurrentPosition();
        const blend = manager.getBlendState(progress);
        return {
            path: progress,
            clocks: {
                board: board.time,
                environment: manager.time,
                director: board.director?.time,
                camera: board.cameraController.breatheTime,
            },
            camera: {
                mode: board.cameraController.mode,
                position: board.camera.position.toArray(),
                quaternion: board.camera.quaternion.toArray(),
                fov: board.camera.fov,
            },
            firstOrbMetrics: board.nodeManager.getNodeCinematicMetrics(levelId, board.camera),
            oneWorldPresent: !!board.oneWorld?.group,
            oneWorldVisible: board.oneWorld?.group?.visible ?? false,
            blend,
            readiness: {
                compileBarrierSettled: board._compilePool === null,
                pendingChapterLoads: [...board.pendingChapterLoads],
                prewarmQueue: [...board.prewarmQueue],
                actionablePrewarmQueue: board.prewarmQueue.filter((id) => !manager.suppressedChapters.has(id)
                    && manager.environments.get(id)?.prewarmed !== true),
                isPrewarming: board.isPrewarming,
                environmentPendingCreateStatus: 'No manager-level pending-create API; board pending set recorded.',
                chapters: [...manager.environments.entries()].map(([id, env]) => ({
                    id,
                    prewarmed: env.prewarmed,
                    renderWarmed: env._renderWarmed === true,
                    visible: env.group.visible,
                })),
                suppressedChapters: [...manager.suppressedChapters],
            },
            draws: board.renderer.info.render.drawCalls,
            triangles: board.renderer.info.render.triangles,
            canvas: { width: board.renderer.domElement.width, height: board.renderer.domElement.height },
        };
    }, firstLevelId);
}

async function captureArrival(page, out, chapter) {
    const layout = await page.evaluate((chapterId) => {
        const { registry, createJourneyFlowOverlay } = window.__chapterVisual;
        const first = registry.getChapterStartLevel(chapterId);
        const previous = registry.getPreviousLevel(first.id);
        const modal = createJourneyFlowOverlay({
            variant: 'completion',
            level: previous ? registry.resolveLevelPresentation(previous.id) : null,
            nextLevel: registry.resolveLevelPresentation(first.id),
            chapter: registry.getChapter(chapterId),
            results: { stars: 3, score: 12400, time: 90 },
            autoContinue: false,
        });
        document.body.appendChild(modal);
        modal.beginTransit();
        modal.showChapter();
        window.__chapterVisual.modal = modal;
        return { chapter: chapterId, retainedCompletion: true, variant: modal.dataset.variant };
    }, chapter);
    await page.waitForTimeout(1000);
    const bounds = await page.evaluate(() => {
        const { modal } = window.__chapterVisual;
        const rect = (selector) => {
            const node = modal.querySelector(selector);
            const box = node.getBoundingClientRect();
            return {
                text: node.textContent, x: box.x, y: box.y, width: box.width, height: box.height,
            };
        };
        return {
            title: rect('.ody-flow__title'),
            goal: rect('.ody-flow__goal'),
            actions: rect('.ody-flow__actions'),
            scrollWidth: modal.scrollWidth,
            width: modal.clientWidth,
            scrollHeight: modal.scrollHeight,
            height: modal.clientHeight,
        };
    });
    await page.screenshot({ path: path.join(out, '02-arrival-overlay.png'), animations: 'disabled' });
    await page.evaluate(() => { window.__chapterVisual.modal.dispose(); });
    return { ...layout, ...bounds };
}

async function captureChapter(chromium, config, chapter) {
    const out = path.join(config.out, `chapter-${String(chapter).padStart(2, '0')}`);
    await mkdir(out, { recursive: true });
    const { url, neighbors } = chapterUrl(config, chapter);
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        headless: true,
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    const timer = setTimeout(() => { browser.close().catch(() => {}); }, 240000);
    const page = await browser.newPage({ viewport: { width: config.width, height: config.height } });
    const consoleLines = [];
    const errors = [];
    const pageErrors = [];
    page.on('console', (message) => {
        consoleLines.push(`${message.type()}: ${message.text()}`);
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const report = {
        chapter,
        status: 'running',
        url,
        neighbors,
        config,
        methodology: 'Shipping world composition at three fixed stations; chapter DOM composed over arrival panorama. '
            + 'Disposable synthetic map progression, not eight automatic travel lifecycles.',
        limitations: 'Software WebGL2; no native FPS, human-flow or exact cross-session pixel-determinism claim. '
            + 'Chapter1 arrival overlay is a composition preview; normal initial map does not play a chapter break.',
        stations: [],
    };
    try {
        await page.addInitScript((quality) => {
            localStorage.clear();
            localStorage.setItem('serenityBlocksSettings', JSON.stringify({
                backgroundMode: 'Specific',
                backgroundTheme: 'cinder-drift',
                effectQuality: quality,
                graphicsQuality: quality,
                renderScale: 1,
                musicVolume: 0,
                sfxVolume: 0,
                customCursorEnabled: false,
                odysseyAutoContinue: true,
            }));
        }, config.quality);
        console.log(`[chapter-visual:${chapter}] Booting scoped chapters ${neighbors.join(',')} (${config.quality})`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        report.boot = await bootstrap(page, config, chapter);
        assert.equal(report.boot.backend, 'webgl2');
        assert.equal(report.boot.quality, config.quality);
        assert.equal(report.boot.oneWorldEnabled, true, 'Default OneWorld unexpectedly disabled');
        assert.equal(report.boot.oneWorldPresent, true, 'OneWorld fell back during capture');
        assert.ok(report.boot.loadedChapters.every((id) => neighbors.includes(id)), 'Out-of-scope environment loaded');
        console.log(`[chapter-visual:${chapter}] Ready; capturing ${report.boot.name}`);
        for (const [index, station] of report.boot.stations.entries()) {
            const metrics = await renderStation(page, config, station, report.boot.firstLevelId);
            assert.ok(Math.abs(metrics.path - station.path) < 0.000001, 'Camera left the requested station');
            assert.equal(metrics.clocks.board, config.time);
            assert.equal(metrics.clocks.environment, config.time);
            assert.deepEqual(metrics.readiness.pendingChapterLoads, []);
            const filename = `${index === 0 ? '01' : String(index + 2).padStart(2, '0')}-${station.name}-world.png`;
            await page.screenshot({ path: path.join(out, filename) });
            report.stations.push({ ...station, filename, metrics });
            if (index === 0) report.arrivalOverlay = await captureArrival(page, out, chapter);
            console.log(`[chapter-visual:${chapter}] Captured ${station.name} p=${metrics.path}`);
        }
        assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
        assert.deepEqual(errors, [], 'Browser console errors');
        report.status = 'pass';
    } catch (error) {
        report.status = 'fail';
        report.message = error.message;
        report.stack = error.stack;
        await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
        console.error(`[chapter-visual:${chapter}] ${error.message}`);
    } finally {
        report.consoleErrors = errors;
        report.pageErrors = pageErrors;
        await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        await writeFile(path.join(out, 'console.log'), consoleLines.join('\n'));
        clearTimeout(timer);
        await browser.close();
    }
    console.log(JSON.stringify({ chapter, status: report.status, out }));
    return report.status;
}

async function main() {
    const config = parseArgs(process.argv.slice(2));
    if (config.help) {
        console.log(`Usage: node scripts/validate-odyssey-chapter-visuals.mjs [options]
  --chapter <1–8|all>  Isolated chapter; all creates eight sequential fresh browsers
  --base-url <url>     Existing stable Vite server (default http://127.0.0.1:5194)
  --quality <preset>   Fixed preset (default High)
  --out <directory>    Artifact root (default artifacts/odyssey-chapter-audit-2026-10-08)
Environment: PLAYWRIGHT_MODULE, CHROMIUM_PATH. Each chapter is capped at four minutes.
Three fixed stations: actual arrival resolver, chapter midpoint, local .85 (chapter8 uses1).
Board/environment/director/camera clocks fixed at9s; 2.5s compositor settle. Default OneWorld
is preserved, only adjacent chapter assets may load, and background loading is disabled.
Real chapter overlay is composed over the arrival frame using effective authored rules.
This verifies representative composition, not a full progression, cold-entry budget or FPS.`);
        return;
    }
    const { chromium } = await loadPlaywright();
    const chapters = config.chapter === 'all' ? [1, 2, 3, 4, 5, 6, 7, 8] : [Number(config.chapter)];
    const results = [];
    for (const chapter of chapters) results.push(await captureChapter(chromium, config, chapter));
    if (results.some((status) => status !== 'pass')) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
