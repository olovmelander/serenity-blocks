#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-await-in-loop -- A disposable browser validates one UI state at a time. */
/** Real collection, SoundManager, DOM and styles; Chromium output is muted, media is not mocked. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const config = { baseUrl: 'http://127.0.0.1:5194', out: 'artifacts/theme-music/browser' };
for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--runtime-only') { config.runtimeOnly = true; continue; }
    if (process.argv[i] === '--saved-choice-only') {
        config.runtimeOnly = true; config.savedChoiceOnly = true; continue;
    }
    const key = { '--base-url': 'baseUrl', '--out': 'out' }[process.argv[i]];
    if (!key || !process.argv[i + 1]) {
        throw new Error('Usage: validate-theme-music.mjs [--base-url URL] [--out DIR] '
            + '[--runtime-only|--saved-choice-only]');
    }
    config[key] = process.argv[++i];
}
await mkdir(config.out, { recursive: true });
const modulePath = process.env.PLAYWRIGHT_MODULE;
// eslint-disable-next-line import/no-unresolved -- Optional external validation tooling.
const { chromium } = modulePath ? await import(pathToFileURL(modulePath).href) : await import('playwright');
if (config.runtimeOnly) {
    await runRuntimeProbe();
    process.exit(process.exitCode || 0);
}
const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-gpu', '--disable-webgl', '--mute-audio',
        '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const report = {
    passed: false, errors: [], checks: {}, cases: [], mediaResponses: [],
};
page.on('pageerror', (error) => report.errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', (response) => {
    if (/\/assets\/music\/.*\.mp3(?:$|\?)/.test(response.url())) {
        report.mediaResponses.push({ file: new URL(response.url()).pathname, status: response.status() });
    }
});
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const stylesheets = [...indexHtml.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
const fixtureUrl = new URL('/__theme_music_fixture', config.baseUrl).href;
const sizes = [
    {
        name: 'desktop', width: 1280, height: 800, font: 16,
    },
    {
        name: 'mobile', width: 320, height: 568, font: 16,
    },
    {
        name: 'landscape', width: 844, height: 390, font: 16,
    },
    {
        name: 'large-text', width: 640, height: 800, font: 32,
    },
];

async function installFixture(clearStorageOnLoad = true) {
    await page.goto(fixtureUrl);
    await page.evaluate(async (clearStorage) => {
        /* eslint-disable import/no-unresolved, import/no-absolute-path -- Production browser modules via Vite. */
        const [hubModule, musicModule, soundModule, serviceModule, collectionModule, registryModule,
            stateModule, themesModule, catalogModule, overlayModule] = await Promise.all([
            import('/src/ui/serenity-hub/SerenityHub.js'),
            import('/src/ui/serenity-hub/MusicTab.js'),
            import('/src/audio/sound-manager.js'),
            import('/src/core/progression/theme-collection-service.js'),
            import('/src/themes/theme-collection.js'),
            import('/src/core/odyssey/LevelRegistry.js'),
            import('/src/core/odyssey/OdysseyStateManager.js'),
            import('/src/themes/theme-registry.js'),
            import('/src/core/progression/theme-music-catalog.js'),
            import('/src/ui/odyssey/JourneyFlowOverlay.js'),
        ]);
        /* eslint-enable import/no-unresolved, import/no-absolute-path */
        const registry = new registryModule.LevelRegistry();
        const audit = {
            registry,
            catalog: catalogModule.THEME_MUSIC_CATALOG,
            getSong: catalogModule.getThemeMusic,
        };
        window.__musicAudit = audit;
        audit.createCollection = () => new serviceModule.ThemeCollectionService({
            catalog: themesModule.THEME_REGISTRY,
            levels: registry.getAllLevels(),
            rules: collectionModule.ODYSSEY_COLLECTION_REWARDS,
            resolveThemeId: themesModule.resolveThemeId,
            migrateProgress: stateModule.migrateOdysseyProgressData,
            storage: localStorage,
        });
        audit.clearUi = () => {
            audit.overlay?.dispose(); audit.overlay = null;
            audit.hub?.musicTab?.destroy(); audit.hub?.abortController?.abort();
            audit.hub?.tabAbortControllers?.forEach((controller) => controller.abort());
            if (audit.hub?.scrollIdleTimeout) clearTimeout(audit.hub.scrollIdleTimeout);
            document.body.replaceChildren(); audit.hub = null;
        };
        audit.reset = async ({ clear = true } = {}) => {
            audit.clearUi(); audit.sound?.cleanup();
            if (clear) localStorage.clear();
            audit.collection = audit.createCollection();
            audit.state = new stateModule.OdysseyStateManager({ levelRegistry: registry });
            const settings = {
                musicVolume: 1,
                sfxVolume: 1,
                ...JSON.parse(localStorage.getItem('__musicAuditSettings') || '{}'),
            };
            audit.settings = {
                get: () => settings,
                update: (patch) => Object.assign(settings, patch),
                save: () => localStorage.setItem('__musicAuditSettings', JSON.stringify(settings)),
            };
            audit.sound = new soundModule.SoundManager();
            audit.sound.settingsManager = audit.settings;
            audit.sound.setThemeCollection(audit.collection);
            if (settings.musicTrack) audit.sound.musicTrack = settings.musicTrack;
            await audit.sound.initializeTracks();
            audit.mountMusic();
            return audit.snapshot();
        };
        audit.mountMusic = () => {
            audit.clearUi();
            const hub = Object.create(hubModule.SerenityHub.prototype);
            Object.assign(hub, {
                isOpen: true,
                currentTab: 'music',
                abortController: new AbortController(),
                tabAbortControllers: new Map(),
                scrollRafId: null,
                scrollIdleTimeout: null,
                scrollIdleDelay: 100,
                hide() { audit.hidden = true; },
                serenityMode: {
                    deps: {
                        themeCollection: audit.collection,
                        settingsManager: audit.settings,
                        canExploreTheme: () => true,
                        onExploreTheme: (themeId) => { audit.exploredTheme = themeId; },
                    },
                },
            });
            hub.createPanel(); hub.panel.classList.add('open'); hub.backdrop.classList.add('visible');
            hub.panel.querySelectorAll('.tab-content').forEach((node) => {
                node.classList.toggle('active', node.id === 'tab-music');
            });
            hub.panel.querySelectorAll('[data-tab]').forEach((node) => {
                node.classList.toggle('active', node.dataset.tab === 'music');
                node.setAttribute('aria-selected', String(node.dataset.tab === 'music'));
            });
            hub.musicTab = new musicModule.MusicTab(hub, audit.sound);
            hub.attachEventListeners();
            hub.setupGamepadIntegration(); audit.hub = hub;
        };
        audit.complete = (levelId = 1) => {
            const result = audit.state.completeLevel(levelId, {
                stars: 1, score: 14000, time: 70, lines: 20,
            });
            audit.receipt = audit.collection.awardCompletion({
                levelId,
                themeId: registry.getLevel(levelId).theme.primary,
                progressPersisted: result.persisted,
            });
            audit.lastLevelId = levelId;
            return { receipt: audit.receipt, snapshot: audit.snapshot() };
        };
        audit.mountReward = ({ reducedMotion = false } = {}) => {
            audit.clearUi();
            audit.overlay = overlayModule.createJourneyFlowOverlay({
                level: registry.resolveLevelPresentation(audit.lastLevelId),
                nextLevel: registry.resolveLevelPresentation(audit.lastLevelId + 1),
                results: {
                    stars: 1, score: 14000, time: 70, lines: 20, themeUnlock: audit.receipt,
                },
                reducedMotion,
                autoContinue: false,
                onChoose() {},
            });
            document.body.appendChild(audit.overlay);
        };
        audit.snapshot = () => ({
            summary: audit.collection.getSummary(),
            selectable: audit.sound.getSelectableSongs().map((song) => song.trackKey),
            current: audit.sound.musicTrack,
            count: document.querySelector('.track-count')?.textContent,
            rows: document.querySelectorAll('.playlist-item').length,
            stored: JSON.parse(localStorage.getItem('serenityBlocks_themeCollection') || 'null'),
        });
        audit.media = () => ({
            selected: audit.sound.musicTrack,
            actual: audit.sound.getActualTrackKey(),
            paused: audit.sound.audioElement?.paused,
            readyState: audit.sound.audioElement?.readyState,
            currentTime: audit.sound.audioElement?.currentTime,
            duration: audit.sound.audioElement?.duration,
            src: audit.sound.audioElement?.currentSrc,
            error: audit.sound.audioElement?.error?.message || null,
        });
        await audit.reset({ clear: clearStorage });
        await document.fonts.ready;
    }, clearStorageOnLoad);
}

async function capture(size, name, { focus = false } = {}) {
    await page.waitForTimeout(180);
    const layout = await page.evaluate(() => {
        const root = document.querySelector('.serenity-hub-panel, .ody-flow');
        const active = document.activeElement;
        const rect = active?.getBoundingClientRect();
        const nodes = [...document.querySelectorAll('.music-tab, .playlist-container, .playlist-item-info, '
            + '.playlist-item-title, .ody-theme-reward, .ody-theme-reward__copy')];
        return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            rootWidth: root?.clientWidth,
            rootScrollWidth: root?.scrollWidth,
            // The existing active-song keystone intentionally extends four pixels past its row.
            // Still check document/panel containment and every text block without that allowance.
            overflow: nodes.filter((node) => node.clientWidth > 0 && node.scrollWidth > node.clientWidth
                + (node.matches('.music-tab, .playlist-container') ? 5 : 2))
                .map((node) => ({ class: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth })),
            focus: {
                tag: active?.tagName, class: active?.className, top: rect?.top, bottom: rect?.bottom,
            },
        };
    });
    const failures = [];
    if (/NaN|undefined/.test(await page.locator('body').innerText())) failures.push('invalid visible value');
    if (layout.documentWidth > layout.viewportWidth + 1
        || layout.rootScrollWidth > layout.rootWidth + 1 || layout.overflow.length) {
        failures.push('horizontal overflow');
    }
    if (focus && (layout.focus.top < -1 || layout.focus.bottom > size.height + 1)) failures.push('focus offscreen');
    const screenshot = `${size.name}-${name}.png`;
    await page.screenshot({ path: path.join(config.out, screenshot), animations: 'disabled' });
    report.cases.push({
        name: `${size.name}-${name}`, screenshot, failures, ...layout,
    });
}

try {
    await page.route(fixtureUrl, (route) => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            ${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
            <body style="margin:0;min-height:100vh;
                background:radial-gradient(ellipse at 70% 10%,#264a45,#151724 65%,#080b12)">
            </body></html>`,
    }));
    await installFixture();
    report.checks.fresh = await page.evaluate(() => window.__musicAudit.snapshot());
    assert.equal(report.checks.fresh.summary.owned, 1);
    assert.equal(report.checks.fresh.summary.total, 61);
    assert.deepEqual(report.checks.fresh.selectable, ['EchoesOfTheSoul']);
    assert.equal(report.checks.fresh.rows, 61);
    await page.locator('#play-pause').click();
    await page.waitForFunction(() => window.__musicAudit.sound.getActualTrackKey() === 'EchoesOfTheSoul'
        && !window.__musicAudit.sound.audioElement?.paused
        && window.__musicAudit.sound.audioElement?.currentTime > 0.05);
    report.checks.defaultPlayback = await page.evaluate(() => window.__musicAudit.media());
    assert.match(report.checks.defaultPlayback.src, /echoes-of-the-soul\.mp3/);
    const target = await page.evaluate(() => {
        const audit = window.__musicAudit;
        return audit.getSong(audit.registry.getLevel(1).theme.primary);
    });
    report.checks.target = target;
    report.checks.lockedSelection = await page.evaluate((key) => {
        const audit = window.__musicAudit;
        audit.sound.setTrack(key);
        return { allowed: audit.sound.canSelectTrack(key), ...audit.snapshot() };
    }, target.trackKey);
    assert.equal(report.checks.lockedSelection.allowed, false);
    assert.equal(report.checks.lockedSelection.current, 'EchoesOfTheSoul');

    for (const size of sizes) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.evaluate(async (font) => {
            document.documentElement.style.fontSize = `${font}px`;
            await window.__musicAudit.reset();
        }, size.font);
        await capture(size, 'fresh');
        await page.locator('#music-playlist-title').scrollIntoViewIfNeeded();
        await capture(size, 'fresh-song-collection');
        const row = page.locator(`.playlist-item[data-track="${target.trackKey}"]`);
        await row.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.track), target.trackKey);
        assert.equal(await page.locator('.music-collection-detail').isVisible(), false);
        await page.keyboard.press('Enter');
        await page.evaluate(() => window.__musicAudit.hub.gamepadCallbacks.closeHub());
        assert.equal(await page.evaluate(() => document.activeElement.dataset.track), target.trackKey);
        assert.equal(await page.locator('.music-collection-detail').isVisible(), false);
        assert.notEqual(await page.evaluate(() => window.__musicAudit.hidden), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.__musicAudit.sound.musicTrack), 'EchoesOfTheSoul');
        assert.match(await page.locator('.music-collection-detail').innerText(), /Complete Odyssey orb 1/);
        await page.locator('[data-music-explore]').click();
        assert.equal(await page.evaluate(() => window.__musicAudit.exploredTheme), target.themeId);
        await page.locator('#music-detail-title').focus();
        await capture(size, 'locked-requirement', { focus: true });
        const completion = await page.evaluate(() => window.__musicAudit.complete(1));
        assert.deepEqual(completion.receipt.themeIds, [target.themeId]);
        assert.ok(completion.snapshot.selectable.includes(target.trackKey));
        assert.equal(completion.snapshot.summary.owned, 2);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'music-detail-title');
        await capture(size, 'unlocked-row', { focus: true });
        await page.locator('[data-music-detail-close]').click();
        assert.equal(await page.evaluate(() => document.activeElement.dataset.track), target.trackKey);
        await page.locator(`.playlist-item[data-track="${target.trackKey}"]`).click();
        await page.waitForFunction((key) => window.__musicAudit.sound.getActualTrackKey() === key
            && !window.__musicAudit.sound.audioElement?.paused
            && window.__musicAudit.sound.audioElement?.currentTime > 0.05, target.trackKey);
        report.checks[`${size.name}Playback`] = await page.evaluate(() => window.__musicAudit.media());
        await capture(size, 'owned-playing');
        await page.evaluate(() => window.__musicAudit.mountReward());
        const rewardText = await page.locator('.ody-theme-reward').innerText();
        assert.match(rewardText, /song|soundtrack/i);
        assert.ok(rewardText.includes(target.name));
        await capture(size, 'theme-and-song-reward', { focus: true });
        await page.keyboard.press('Tab');
        await capture(size, 'reward-tab-focus', { focus: true });
        await page.evaluate(() => window.__musicAudit.mountReward({ reducedMotion: true }));
        await capture(size, 'reward-reduced-motion', { focus: true });
    }

    await installFixture(false);
    report.checks.reload = await page.evaluate(() => window.__musicAudit.snapshot());
    assert.equal(report.checks.reload.current, target.trackKey);
    assert.ok(report.checks.reload.selectable.includes(target.trackKey));
    report.checks.cloud = await page.evaluate(() => {
        const audit = window.__musicAudit;
        const cloud = audit.collection.exportData();
        cloud.grants.winter = { source: 'odyssey', levelId: 20, earnedAt: new Date().toISOString() };
        const accepted = audit.collection.applyCloudData(cloud);
        return { accepted, ...audit.snapshot() };
    });
    assert.equal(report.checks.cloud.accepted, true);
    assert.ok(report.checks.cloud.selectable.includes('Winter'));
    assert.equal(report.checks.cloud.summary.owned, 3);
    assert.match(report.checks.cloud.count, /3\s*\/\s*61/);

    report.checks.scope = await page.evaluate(async () => {
        const audit = window.__musicAudit;
        await audit.reset();
        const song = audit.getSong('vesper-chrysalis');
        audit.scopeCurrent = true;
        audit.scope = audit.sound.setOdysseyMusicContext({
            trackKey: song.trackKey,
            isCurrent: () => audit.scopeCurrent,
            fadeOutMs: 0,
            fadeInMs: 0,
        });
        return { trackKey: song.trackKey, owned: audit.sound.canSelectTrack(song.trackKey), ...audit.snapshot() };
    });
    assert.equal(report.checks.scope.owned, false);
    assert.equal(report.checks.scope.summary.owned, 1);
    await page.waitForFunction((key) => window.__musicAudit.sound.getActualTrackKey() === key
        && !window.__musicAudit.sound.audioElement?.paused
        && window.__musicAudit.sound.audioElement?.currentTime > 0.05, report.checks.scope.trackKey);
    report.checks.placeholderPlayback = await page.evaluate(() => window.__musicAudit.media());
    assert.match(report.checks.placeholderPlayback.src, /vesper-chrysalis-placeholder-song\.mp3/);
    assert.ok(report.checks.placeholderPlayback.duration > 1);
    report.checks.resume = await page.evaluate(async () => {
        const audit = window.__musicAudit;
        audit.sound.audioElement.pause();
        const resumed = await audit.sound.resumeBackgroundMusic();
        return { resumed, ...audit.media(), owned: audit.sound.canSelectTrack(audit.sound.musicTrack) };
    });
    assert.equal(report.checks.resume.resumed, true);
    assert.equal(report.checks.resume.paused, false);
    assert.equal(report.checks.resume.owned, false);
    report.checks.restored = await page.evaluate(() => {
        const audit = window.__musicAudit;
        audit.scopeCurrent = false;
        const cleared = audit.sound.clearOdysseyMusicContext(audit.scope);
        return { cleared, ...audit.snapshot() };
    });
    assert.equal(report.checks.restored.cleared, true);
    assert.equal(report.checks.restored.current, 'EchoesOfTheSoul');
    assert.deepEqual(report.checks.restored.selectable, ['EchoesOfTheSoul']);
    assert.deepEqual(report.errors, []);
    report.passed = report.cases.every((entry) => entry.failures.length === 0);
} catch (error) {
    report.fatal = { message: error.message, stack: error.stack };
    await page.screenshot({ path: path.join(config.out, 'fatal.png'), animations: 'disabled' }).catch(() => {});
} finally {
    report.methodology = 'Actual production Hub/MusicTab/reward DOM and CSS, collection save service and SoundManager. '
        + 'Real MP3 network/decode/play/resume events in muted headless Chromium; no claim of human listening quality. '
        + 'App shell/theme renderer injected for bounded DOM tests; no GPU or native audio-device validation.';
    await writeFile(path.join(config.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await browser.close();
    console.log(JSON.stringify({
        passed: report.passed,
        cases: report.cases.length,
        failures: report.cases.filter((entry) => entry.failures.length),
        fatal: report.fatal,
        errors: report.errors,
        out: config.out,
    }, null, 2));
    if (!report.passed) process.exitCode = 1;
}

/** One actual orb; gameplay completion is driven through the production evaluator, not a playthrough. */
async function runRuntimeProbe() {
    const out = path.join(config.out, config.savedChoiceOnly ? 'saved-choice' : 'runtime');
    await mkdir(out, { recursive: true });
    const liveBrowser = await chromium.launch({
        headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    const live = await liveBrowser.newPage({ viewport: { width: 1280, height: 800 } });
    live.setDefaultTimeout(15000);
    const runtime = {
        passed: false, errors: [], console: [], steps: {},
    };
    const started = Date.now();
    const deadline = setTimeout(() => {
        runtime.deadlineExceeded = true;
        live.close({ runBeforeUnload: false }).catch(() => {});
    }, 180000);
    live.on('pageerror', (error) => runtime.errors.push(error.message));
    live.on('console', (message) => {
        runtime.console.push(`${Date.now() - started}ms ${message.type()}: ${message.text()}`);
        if (message.type() === 'error') runtime.errors.push(message.text());
    });
    const bootReady = () => live.waitForFunction(() => window.startupPipelineSnapshot?.menuReady
        && window.serenityBlocks?.themeManager?.activeThemeName
        && window.serenityBlocks?.soundManager?.songsData?.length === 61, null, { timeout: 60000 });
    const media = () => live.evaluate(() => {
        const sound = window.serenityBlocks.soundManager;
        return {
            selected: sound.musicTrack,
            actual: sound.getActualTrackKey(),
            src: sound.audioElement?.currentSrc,
            readyState: sound.audioElement?.readyState,
            paused: sound.audioElement?.paused,
            currentTime: sound.audioElement?.currentTime,
            owned: sound.canSelectTrack(sound.musicTrack),
            selectable: sound.getSelectableSongs().map((song) => song.trackKey),
            savedPreference: window.serenityBlocks.settingsManager.get().musicTrack,
            theme: window.serenityBlocks.themeManager.activeThemeName,
            collection: window.serenityBlocks.themeCollection.getSummary(),
        };
    });
    const playing = (key) => live.waitForFunction((trackKey) => {
        const sound = window.serenityBlocks?.soundManager;
        return sound?.getActualTrackKey() === trackKey && !sound.audioElement?.paused
            && sound.audioElement?.readyState >= 3 && sound.audioElement?.currentTime > 0.2;
    }, key, { timeout: 15000 });
    try {
        await live.addInitScript((savedChoiceOnly) => {
            if (sessionStorage.getItem('__musicRuntimeSeeded')) return;
            localStorage.clear();
            localStorage.setItem('serenityBlocksSettings', JSON.stringify({
                effectQuality: 'Minimal',
                renderScale: 0.75,
                musicVolume: 0.4,
                sfxVolume: 0,
                odysseyAutoContinue: false,
                customCursorEnabled: false,
                autoThemeChange: false,
                themeLinkedMode: false,
                ...(savedChoiceOnly ? { musicTrack: 'CinderDrift' } : {}),
            }));
            if (savedChoiceOnly) {
                localStorage.setItem('serenityBlocks_themeCollection', JSON.stringify({
                    version: 1,
                    grants: {
                        forest: { source: 'starter' },
                        'cinder-drift': { source: 'odyssey', levelId: 1, earnedAt: '2026-10-08T13:45:03.883Z' },
                    },
                    seenThemeIds: ['forest'],
                    updatedAt: 1791467103884,
                }));
            }
            sessionStorage.setItem('__musicRuntimeSeeded', 'true');
        }, config.savedChoiceOnly === true);
        await live.goto(
            new URL('/?skipIntro=1&forceWebGL=1', config.baseUrl).href,
            { waitUntil: 'domcontentloaded', timeout: 60000 },
        );
        await bootReady();
        await live.keyboard.press('Shift'); // Genuine browser gesture releases the application's audio owner.
        if (config.savedChoiceOnly) {
            await playing('CinderDrift');
            runtime.steps.savedChoiceBoot = await media();
            assert.equal(runtime.steps.savedChoiceBoot.owned, true);
            assert.equal(runtime.steps.savedChoiceBoot.collection.owned, 2);
            assert.equal(runtime.steps.savedChoiceBoot.savedPreference, 'CinderDrift');
            await live.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
            await bootReady();
            await live.keyboard.press('Shift');
            await playing('CinderDrift');
            runtime.steps.savedChoiceReload = await media();
            assert.equal(runtime.steps.savedChoiceReload.owned, true);
            assert.equal(runtime.steps.savedChoiceReload.collection.owned, 2);
            assert.equal(runtime.steps.savedChoiceReload.savedPreference, 'CinderDrift');
            assert.deepEqual(runtime.errors, []);
            runtime.passed = true;
            return;
        }
        await playing('EchoesOfTheSoul');
        runtime.steps.forest = await media();
        assert.equal(runtime.steps.forest.theme, 'forest');
        assert.equal(runtime.steps.forest.collection.owned, 1);
        assert.deepEqual(runtime.steps.forest.selectable, ['EchoesOfTheSoul']);
        assert.match(runtime.steps.forest.src, /echoes-of-the-soul\.mp3/);
        runtime.steps.refused = await live.evaluate(() => ({
            accepted: window.serenityBlocks.soundManager.setTrack('CinderDrift'),
            selected: window.serenityBlocks.soundManager.musicTrack,
        }));
        assert.equal(runtime.steps.refused.accepted, false);
        assert.equal(runtime.steps.refused.selected, 'EchoesOfTheSoul');
        await live.screenshot({ path: path.join(out, '01-forest-starter.png') });
        await live.evaluate(() => {
            window.__musicRuntimeEntry = (async () => {
                const manager = window.serenityBlocks.gameModeManager;
                document.querySelector('#start-modal')?.classList.remove('visible');
                await manager.activateMode('odyssey');
                await manager.startCurrentMode();
            })();
        });
        await live.evaluate(() => window.__musicRuntimeEntry);
        await live.waitForFunction(() => window.odysseyMode?.isInBoardView
            && window.odysseyMode?.boardController, null, { timeout: 60000 });
        await live.waitForFunction(() => window.serenityBlocks.soundManager.getOdysseyMusicContextTrack());
        const chapterTrack = await live.evaluate(
            () => window.serenityBlocks.soundManager.getOdysseyMusicContextTrack(),
        );
        assert.ok(chapterTrack, 'The live chapter map owns a temporary music context.');
        await playing(chapterTrack);
        runtime.steps.chapterMap = await media();
        assert.equal(runtime.steps.chapterMap.collection.owned, 1);
        assert.equal(runtime.steps.chapterMap.savedPreference, 'EchoesOfTheSoul');
        await live.evaluate(() => { window.__musicRuntimeOrbEntry = window.testOdysseyLevel(1); });
        await live.evaluate(() => window.__musicRuntimeOrbEntry);
        await live.waitForFunction(() => window.odysseyMode?.levelRunStarted
            && window.odysseyMode?.currentLevelId === 1, null, { timeout: 60000 });
        await playing('CinderDrift');
        runtime.steps.authored = await media();
        assert.equal(runtime.steps.authored.owned, false);
        assert.equal(runtime.steps.authored.collection.owned, 1);
        assert.equal(runtime.steps.authored.savedPreference, 'EchoesOfTheSoul');
        assert.equal(runtime.steps.authored.theme, 'cinder-drift');
        assert.match(runtime.steps.authored.src, /cinder-drift\.mp3/);
        await live.evaluate(() => {
            const audio = window.serenityBlocks.soundManager.audioElement;
            window.__musicRuntimeEnded = 0;
            audio.addEventListener('ended', () => { window.__musicRuntimeEnded += 1; }, { once: true });
            audio.currentTime = audio.duration - 0.15;
        });
        await live.waitForFunction(() => window.__musicRuntimeEnded === 1
            && window.serenityBlocks.soundManager.audioElement?.currentTime < 5);
        await playing('CinderDrift');
        runtime.steps.naturalEnd = await media();
        assert.equal(runtime.steps.naturalEnd.selected, 'CinderDrift');
        assert.equal(runtime.steps.naturalEnd.owned, false);
        assert.equal(runtime.steps.naturalEnd.savedPreference, 'EchoesOfTheSoul');
        await live.evaluate(async () => {
            const hub = await window.serenityBlocks.initializeGlobalSerenityHub();
            hub.show(); hub.switchTab('music');
        });
        await live.waitForSelector('#play-pause', { state: 'visible' });
        assert.match(await live.locator('#current-track-meta').innerText(), /Playing in Odyssey.*Not collected yet/);
        await live.locator('#play-pause').click();
        await live.waitForFunction(() => window.serenityBlocks.soundManager.audioElement?.paused);
        runtime.steps.paused = await media();
        await live.locator('#play-pause').click();
        await playing('CinderDrift');
        runtime.steps.resumed = await media();
        assert.equal(runtime.steps.resumed.owned, false);
        assert.equal(runtime.steps.resumed.savedPreference, 'EchoesOfTheSoul');
        await live.screenshot({ path: path.join(out, '02-uncollected-odyssey-song.png') });
        await live.evaluate(() => {
            window.serenityBlocks.serenityHub.hide();
            const mode = window.odysseyMode;
            mode.gameState.score = 12400;
            mode.hybridEngine.victoryEvaluator.onLineClear(mode.currentLevelConfig.victory.primary.target);
            mode._checkVictoryConditions(mode._activeLevelSession);
        });
        await live.waitForSelector('.ody-theme-reward', { timeout: 15000 });
        runtime.steps.awarded = await live.evaluate(() => ({
            themeOwned: window.serenityBlocks.themeCollection.isUnlocked('cinder-drift'),
            songOwned: window.serenityBlocks.soundManager.canSelectTrack('CinderDrift'),
            summary: window.serenityBlocks.themeCollection.getSummary(),
            reward: document.querySelector('.ody-theme-reward').textContent,
            saved: JSON.parse(localStorage.getItem('serenityBlocks_themeCollection')),
        }));
        assert.equal(runtime.steps.awarded.themeOwned, true);
        assert.equal(runtime.steps.awarded.songOwned, true);
        assert.equal(runtime.steps.awarded.summary.owned, 2);
        assert.match(runtime.steps.awarded.reward, /Theme \+ song collected/);
        assert.ok(runtime.steps.awarded.saved.grants['cinder-drift']);
        await live.screenshot({ path: path.join(out, '03-theme-and-song-reward.png'), animations: 'disabled' });
        await live.evaluate(() => window.serenityBlocks.gameModeManager.deactivateCurrentMode());
        runtime.steps.exited = await media();
        assert.equal(runtime.steps.exited.selected, 'EchoesOfTheSoul');
        assert.equal(runtime.steps.exited.savedPreference, 'EchoesOfTheSoul');
        await live.evaluate(async () => {
            const hub = await window.serenityBlocks.initializeGlobalSerenityHub();
            hub.show(); hub.switchTab('music');
        });
        await live.locator('.playlist-item[data-track="CinderDrift"]').click();
        await playing('CinderDrift');
        runtime.steps.manualChoice = await media();
        assert.equal(runtime.steps.manualChoice.savedPreference, 'CinderDrift');
        await live.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await bootReady();
        await live.keyboard.press('Shift');
        await playing('CinderDrift');
        runtime.steps.reloaded = await media();
        assert.equal(runtime.steps.reloaded.collection.owned, 2);
        assert.equal(runtime.steps.reloaded.savedPreference, 'CinderDrift');
        assert.equal(runtime.steps.reloaded.owned, true);
        assert.deepEqual(runtime.errors, []);
        runtime.passed = true;
    } catch (error) {
        runtime.fatal = { message: error.message, stack: error.stack };
        runtime.steps.failureSnapshot = await media().catch(() => null);
        await live.screenshot({ path: path.join(out, 'fatal.png') }).catch(() => {});
    } finally {
        clearTimeout(deadline);
        runtime.elapsedMs = Date.now() - started;
        runtime.methodology = 'One real app boot and authored orb 1 through the existing DEV entry helper. '
            + 'Production media, collection, Hub controls and lifecycle; evaluator-driven completion. '
            + 'Muted headless Chromium/SwiftShader; playback verified by decoded source, '
            + 'playing state and advancing time. '
            + 'No claim of human listening, physical controls, native audio devices or a full player playthrough.';
        if (config.savedChoiceOnly) {
            runtime.methodology = 'Actual application boot and reload with the collection grant produced by orb 1 '
                + 'and an owned Cinder Drift preference. '
                + 'Real muted Chromium media source/decode/advancing-time checks; '
                + 'no Odyssey GPU world is started in this focused startup regression probe.';
        }
        await writeFile(path.join(out, 'report.json'), `${JSON.stringify(runtime, null, 2)}\n`);
        await liveBrowser.close();
        console.log(JSON.stringify({
            passed: runtime.passed,
            elapsedMs: runtime.elapsedMs,
            steps: runtime.steps,
            fatal: runtime.fatal,
            errors: runtime.errors,
            out,
        }, null, 2));
        if (!runtime.passed) process.exitCode = 1;
    }
}
