#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-await-in-loop -- One disposable browser, sequential DOM states. */
/** Actual collection/reward DOM and CSS with real save models; renderer/app shell injected. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const config = { baseUrl: 'http://127.0.0.1:5194', out: 'artifacts/theme-unlocks/browser', runtimeLevel: 1 };
for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--map-probe') { config.mapProbe = true; continue; }
    if (process.argv[i] === '--focus-only') { config.focusOnly = true; continue; }
    if (process.argv[i] === '--runtime-only') { config.runtime = true; config.runtimeOnly = true; continue; }
    if (process.argv[i] === '--runtime') { config.runtime = true; continue; }
    const key = { '--base-url': 'baseUrl', '--out': 'out', '--runtime-level': 'runtimeLevel' }[process.argv[i]];
    if (!key || !process.argv[i + 1]) {
        throw new Error('Usage: validate-theme-collection.mjs [--base-url URL] [--out DIR] '
            + '[--runtime|--runtime-only] [--runtime-level 1..60] [--map-probe]');
    }
    config[key] = process.argv[++i];
}
config.runtimeLevel = Number(config.runtimeLevel);
assert.ok(
    Number.isInteger(config.runtimeLevel) && config.runtimeLevel >= 1 && config.runtimeLevel <= 60,
    'Choose one authored orb from 1 through 60 for the bounded runtime probe.',
);
await mkdir(config.out, { recursive: true });
const modulePath = process.env.PLAYWRIGHT_MODULE;
// eslint-disable-next-line import/no-unresolved -- Optional tooling, never an application dependency.
const { chromium } = modulePath ? await import(pathToFileURL(modulePath).href) : await import('playwright');
const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-gpu', '--disable-webgl'],
});
const page = await browser.newPage();
page.setDefaultTimeout(8000);
const errors = [];
const cases = [];
const checks = {};
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const url = new URL('/__theme_collection_fixture', config.baseUrl).href;
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const stylesheets = [...indexHtml.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((match) => match[1]);
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
if (config.runtimeOnly) await browser.close();
if (!config.runtimeOnly) {
    try {
        await page.route(url, (route) => route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        ${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join('')}</head>
        <body style="margin:0;min-height:100vh;
            background:radial-gradient(ellipse at 70% 10%,#264a45,#151724 65%,#080b12)"></body></html>`,
        }));
        await page.goto(url);
        await page.evaluate(async () => {
        /* eslint-disable import/no-unresolved, import/no-absolute-path -- URLs loaded inside the browser via Vite. */
            const [hubModule, tabModule, serviceModule, rulesModule, registryModule, stateModule,
                themesModule, overlayModule, resultsModule, finaleModule,
                summaryModule, schemaModule] = await Promise.all([
                import('/src/ui/serenity-hub/SerenityHub.js'), import('/src/ui/serenity-hub/ThemesTab.js'),
                import('/src/core/progression/theme-collection-service.js'), import('/src/themes/theme-collection.js'),
                import('/src/core/odyssey/LevelRegistry.js'), import('/src/core/odyssey/OdysseyStateManager.js'),
                import('/src/themes/theme-registry.js'), import('/src/ui/odyssey/JourneyFlowOverlay.js'),
                import('/src/ui/odyssey/ResultsModal.js'), import('/src/ui/odyssey/CampaignFinale.js'),
                import('/src/core/odyssey/odyssey-campaign-summary.js'),
                import('/src/core/odyssey/odyssey-progress-schema.js'),
            ]);
            /* eslint-enable import/no-unresolved, import/no-absolute-path */
            const registry = new registryModule.LevelRegistry();
            const createCollection = () => new serviceModule.ThemeCollectionService({
                catalog: themesModule.THEME_REGISTRY,
                levels: registry.getAllLevels(),
                rules: rulesModule.ODYSSEY_COLLECTION_REWARDS,
                resolveThemeId: themesModule.resolveThemeId,
                migrateProgress: stateModule.migrateOdysseyProgressData,
                storage: localStorage,
                now: () => Date.now(),
            });
            window.__audit = {
                registry,
                createCollection,
                catalog: themesModule.THEME_REGISTRY,
                checks: {},
                choices: [],
                rules: rulesModule.ODYSSEY_COLLECTION_REWARDS,
                saveVersion: schemaModule.ODYSSEY_SAVE_VERSION,
            };
            const audit = window.__audit;
            const legacy = stateModule.migrateOdysseyProgressData({
                version: 2,
                completedLevels: Object.fromEntries(Array.from({ length: 59 }, (_, index) => [index + 1, {}])),
            });
            audit.remappedOrbs = registry.getAllLevels()
                .filter((level) => legacy.completedLevels[level.id]?.themeId !== level.theme.primary)
                .map((level) => ({
                    levelId: level.id,
                    themeId: level.theme.primary,
                    levelName: level.name,
                    chapterId: level.chapter,
                    previousThemeId: legacy.completedLevels[level.id]?.themeId || null,
                }));
            audit.clear = () => {
                audit.modal?.dispose(); audit.modal = null;
                audit.hub?.themesTab?.destroy(); audit.hub?.abortController?.abort();
                if (audit.hub?.scrollIdleTimeout) clearTimeout(audit.hub.scrollIdleTimeout);
                document.body.replaceChildren(); audit.hub = null;
            };
            audit.reset = (count = 0) => {
                audit.clear(); localStorage.clear(); audit.collection = createCollection();
                audit.state = new stateModule.OdysseyStateManager({ levelRegistry: registry });
                audit.receipt = null; audit.completions = [];
                for (let id = 1; id <= count; id += 1) {
                    const result = audit.state.completeLevel(id, {
                        stars: 1, score: 14000, time: 70, lines: 20,
                    });
                    audit.lastCompletion = { persisted: result.persisted, levelId: id };
                    audit.receipt = audit.collection.awardCompletion({
                        levelId: id,
                        themeId: registry.getLevel(id).theme.primary,
                        progressPersisted: result.persisted,
                    });
                    audit.completions.push({
                        levelId: id,
                        themeId: registry.getLevel(id).theme.primary,
                        receipt: audit.receipt,
                    });
                }
                return audit.collection.getSummary();
            };
            audit.reclearLegacyOrb = () => {
                audit.clear(); localStorage.clear();
                localStorage.setItem('serenityBlocks_odysseyProgress', JSON.stringify({
                    version: 2,
                    currentLevel: 20,
                    unlockedLevels: [1, 19, 20],
                    completedLevels: { 19: { stars: 1, bestScore: 14000, bestTime: 70 } },
                }));
                audit.collection = createCollection();
                const legacyOwned = audit.collection.getOwnedThemeIds();
                audit.state = new stateModule.OdysseyStateManager({ levelRegistry: registry });
                const levelId = Number([...audit.state.completedLevels.keys()][0]);
                const themeId = registry.getLevel(levelId).theme.primary;
                const completion = audit.state.completeLevel(levelId, { stars: 1, score: 14000, time: 70 });
                const receipt = audit.collection.awardCompletion({
                    levelId, themeId, progressPersisted: completion.persisted,
                });
                return {
                    levelId,
                    legacyOwned,
                    themeId,
                    receipt,
                    saved: JSON.parse(localStorage.getItem('serenityBlocks_odysseyProgress')).completedLevels[levelId],
                    reloadedOwned: createCollection().getOwnedThemeIds(),
                };
            };
            audit.loadRetiredTheme = () => {
                audit.clear(); localStorage.clear();
                localStorage.setItem('serenityBlocks_themeCollection', JSON.stringify({
                    version: 1,
                    grants: {
                        forest: { source: 'starter' },
                        'bioluminescence-2': { source: 'odyssey', levelId: 10 },
                    },
                    seenThemeIds: ['forest', 'bioluminescence-2'],
                }));
                localStorage.setItem('serenityBlocks_odysseyProgress', JSON.stringify({
                    version: 3,
                    currentLevel: 11,
                    unlockedLevels: [1, 10, 11],
                    completedLevels: {
                        10: { stars: 1, themeId: 'bioluminescence-2', themeIds: ['bioluminescence-2'] },
                    },
                }));
                audit.collection = createCollection();
                audit.state = new stateModule.OdysseyStateManager({ levelRegistry: registry });
                audit.mountCollection();
                return {
                    summary: audit.collection.getSummary(),
                    ownsRetired: audit.collection.isUnlocked('bioluminescence-2'),
                    ownsOriginal: audit.collection.isUnlocked('bioluminescence'),
                    retiredCards: document.querySelectorAll('.theme-card[data-theme="bioluminescence-2"]').length,
                    originalCards: document.querySelectorAll('.theme-card[data-theme="bioluminescence"]').length,
                    activeCompletions: [...audit.state.completedLevels.keys()],
                };
            };
            audit.mountCollection = () => {
                audit.clear(); audit.switches = []; audit.explored = []; audit.saves = [];
                const themeManager = {
                    activeThemeName: 'forest',
                    activeTheme: {},
                    themeCollection: audit.collection,
                    canSelectTheme: (id) => audit.collection.isUnlocked(id),
                    isOdysseyThemeScopeActive: () => audit.inOrb === true,
                    switchTheme: async (id) => { audit.switches.push(id); themeManager.activeThemeName = id; },
                };
                const settingsManager = {
                    get: () => ({}), update: (settings) => audit.saves.push(settings), save() {},
                };
                const hub = Object.create(hubModule.SerenityHub.prototype);
                Object.assign(hub, {
                    isOpen: true,
                    currentTab: 'themes',
                    abortController: new AbortController(),
                    scrollRafId: null,
                    scrollIdleTimeout: null,
                    scrollIdleDelay: 100,
                    hide: () => { audit.hidden = true; },
                    serenityMode: {
                        deps: {
                            themeCollection: audit.collection,
                            onExploreTheme: (id) => audit.explored.push(id),
                            canExploreTheme: () => !audit.inGame,
                        },
                    },
                });
                hub.createPanel(); hub.panel.classList.add('open'); hub.backdrop.classList.add('visible');
                hub.themesTab = new tabModule.ThemesTab(hub, themeManager, settingsManager);
                hub.setupGamepadIntegration(); audit.hub = hub;
            };
            audit.mountReward = (kind, { reducedMotion = false, autoContinue = false, fresh = false } = {}) => {
                audit.clear(); audit.choices = []; audit.started = performance.now();
                const receipt = fresh ? { ...audit.receipt, themeIds: [...audit.receipt.themeIds] } : audit.receipt;
                const results = {
                    stars: 1, score: 14000, time: 70, lines: 20, themeUnlock: receipt, reducedMotion,
                };
                const onChoose = (choice) => audit.choices.push({ choice, ms: performance.now() - audit.started });
                if (kind === 'flow') {
                    audit.modal = overlayModule.createJourneyFlowOverlay({
                        level: registry.resolveLevelPresentation(audit.lastCompletion?.levelId || 1),
                        nextLevel: registry.resolveLevelPresentation((audit.lastCompletion?.levelId || 1) + 1),
                        results,
                        reducedMotion,
                        autoContinue,
                        onChoose,
                    });
                } else if (kind === 'results') {
                    audit.modal = resultsModule.createResultsModal({
                        results,
                        onClose: () => onChoose('close'),
                        levelConfig: registry.getLevel(audit.lastCompletion?.levelId || 1),
                        levelId: audit.lastCompletion?.levelId || 1,
                        totalStars: 1,
                        formatTime: () => '1:10',
                    });
                } else {
                    audit.modal = finaleModule.createCampaignFinale({
                        summary: summaryModule.getOdysseyCampaignSummary(registry, {
                            isLevelCompleted: () => true, getLevelStars: () => 1,
                        }),
                        themeUnlock: receipt,
                        reducedMotion,
                        onChoose,
                    });
                }
                document.body.appendChild(audit.modal);
            };
            audit.layout = () => {
                const root = audit.hub?.panel || audit.modal;
                const nodes = [...root.querySelectorAll('.theme-collection, .theme-card, .theme-detail-copy, '
                + '.theme-detail-stage, .ody-theme-reward, .ody-flow__content, .ody-finale__content')]
                    .filter((node) => node.getClientRects().length > 0);
                const rect = (node) => {
                    const r = node.getBoundingClientRect();
                    return {
                        left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                    };
                };
                const reward = root.querySelector('.ody-theme-reward');
                const { activeElement: focus } = document;
                return {
                    width: window.innerWidth,
                    rootWidth: root.clientWidth,
                    rootScrollWidth: root.scrollWidth,
                    documentWidth: document.documentElement.scrollWidth,
                    // The selected card's authored keystone extends five pixels beyond its corner.
                    contentOverflow: nodes.filter((node) => node.scrollWidth > node.clientWidth
                        + (node.classList.contains('active') && node.classList.contains('theme-card') ? 8 : 1))
                        .map((node) => ({ class: node.className, width: node.clientWidth, scroll: node.scrollWidth })),
                    focus: {
                        id: focus.id, class: focus.className, theme: focus.dataset.theme, rect: rect(focus),
                    },
                    reward: reward ? {
                        text: reward.textContent,
                        rect: rect(reward),
                        celebrating: reward.dataset.celebrating,
                        ariaLive: reward.ariaLive,
                        animations: reward.getAnimations({ subtree: true }).map((animation) => animation.animationName),
                    } : null,
                    summary: audit.collection.getSummary(),
                    switches: audit.switches,
                };
            };
            await document.fonts.ready;
        });

        if (!config.focusOnly) {
            checks.retiredTheme = await page.evaluate(() => window.__audit.loadRetiredTheme());
            assert.equal(checks.retiredTheme.summary.owned, 1);
            assert.equal(checks.retiredTheme.summary.total, 61);
            assert.equal(checks.retiredTheme.ownsRetired, false);
            assert.equal(checks.retiredTheme.ownsOriginal, false);
            assert.equal(checks.retiredTheme.retiredCards, 0);
            assert.equal(checks.retiredTheme.originalCards, 1);
            assert.deepEqual(checks.retiredTheme.activeCompletions, []);
            checks.legacyReclear = await page.evaluate(() => window.__audit.reclearLegacyOrb());
            assert.equal(checks.legacyReclear.levelId, 18);
            assert.deepEqual([...checks.legacyReclear.legacyOwned].sort(), ['forest', 'summer']);
            assert.deepEqual(checks.legacyReclear.receipt.themeIds, [checks.legacyReclear.themeId]);
            const legacyAndCurrent = ['summer', checks.legacyReclear.themeId].sort();
            assert.deepEqual(checks.legacyReclear.saved.themeIds, legacyAndCurrent);
            assert.deepEqual([...checks.legacyReclear.reloadedOwned].sort(), ['forest', ...legacyAndCurrent].sort());
            checks.firstClears = await page.evaluate(() => {
                const audit = window.__audit;
                audit.reset(audit.registry.getTotalLevels());
                return {
                    completions: audit.completions,
                    summary: audit.collection.getSummary(),
                    reloaded: audit.createCollection().getSummary(),
                    saveVersion: JSON.parse(localStorage.getItem('serenityBlocks_odysseyProgress')).version,
                    currentSaveVersion: audit.saveVersion,
                    rules: audit.rules,
                };
            });
            assert.equal(checks.firstClears.completions.length, 60);
            assert.equal(new Set(checks.firstClears.completions.map((entry) => entry.themeId)).size, 60);
            assert.deepEqual(checks.firstClears.rules, []);
            for (const entry of checks.firstClears.completions) {
                assert.notEqual(entry.themeId, 'forest', `Orb ${entry.levelId} must unlock a new world.`);
                assert.equal(entry.receipt.persisted, true);
                assert.deepEqual(entry.receipt.themeIds, [entry.themeId], `Orb ${entry.levelId} exclusive reward.`);
            }
            assert.equal(checks.firstClears.summary.owned, 61);
            assert.equal(checks.firstClears.reloaded.owned, 61);
            assert.equal(checks.firstClears.saveVersion, checks.firstClears.currentSaveVersion);
            assert.equal(checks.firstClears.saveVersion, 4);
            checks.changedOrbRequirements = [];
            await page.evaluate(() => { window.__audit.reset(); window.__audit.mountCollection(); });
            const remappedOrbs = await page.evaluate(() => window.__audit.remappedOrbs);
            assert.ok(
                remappedOrbs.length >= 10,
                'The fresh campaign must replace all repeats and move missing worlds.',
            );
            for (const mapping of remappedOrbs) {
                const { levelId, themeId, levelName } = mapping;
                await page.evaluate((id) => window.__audit.hub.themesTab.collectionView.open(id), themeId);
                const requirement = await page.locator('.theme-detail-requirement').innerText();
                const title = await page.locator('#theme-detail-title').innerText();
                assert.equal(requirement, `Complete Odyssey orb ${levelId} · ${levelName}.`);
                assert.equal(await page.locator('[data-collection-apply]').count(), 0);
                checks.changedOrbRequirements.push({
                    ...mapping, title, requirement,
                });
            }
            checks.insertedOrbs = await page.evaluate(() => [43, 55].map((levelId) => {
                const level = window.__audit.registry.getLevel(levelId);
                return {
                    levelId,
                    themeId: level.theme.primary,
                    displayName: window.__audit.catalog.find((theme) => theme.id === level.theme.primary).displayName,
                };
            }));
            assert.deepEqual(checks.insertedOrbs.map((level) => level.themeId), ['vesper-chrysalis', 'serenity-warp']);
        }

        if (config.focusOnly) {
            for (const size of sizes) {
                await page.setViewportSize({ width: size.width, height: size.height });
                await page.evaluate((font) => { document.documentElement.style.fontSize = `${font}px`; }, size.font);
                for (const failure of [null, 'collection', 'progress']) {
                    await page.evaluate((kind) => {
                        window.__audit.reset(1);
                        if (kind) window.__audit.receipt = { persisted: false, failure: kind, themeIds: [] };
                        window.__audit.mountReward('flow', { autoContinue: true });
                    }, failure);
                    await page.waitForTimeout(100);
                    const data = await page.evaluate(() => window.__audit.layout());
                    const failures = [];
                    if (data.focus.rect.top < -1 || data.focus.rect.bottom > size.height + 1) {
                        failures.push('Initial completion focus offscreen');
                    }
                    const screenshot = `${size.name}-completion-${failure || 'reward'}.png`;
                    await page.screenshot({ path: path.join(config.out, screenshot), animations: 'disabled' });
                    await page.keyboard.press('Tab');
                    const afterTab = await page.evaluate(() => window.__audit.layout());
                    if (afterTab.focus.rect.top < -1 || afterTab.focus.rect.bottom > size.height + 1) {
                        failures.push('Tab focus offscreen');
                    }
                    if (data.rootScrollWidth > data.rootWidth + 1 || data.contentOverflow.length) {
                        failures.push('Completion overflow');
                    }
                    cases.push({
                        name: screenshot, screenshot, failures, initial: data, afterTab,
                    });
                }
            }
        }
        for (const size of config.focusOnly ? [] : sizes) {
            await page.setViewportSize({ width: size.width, height: size.height });
            await page.evaluate((font) => { document.documentElement.style.fontSize = `${font}px`; }, size.font);
            const capture = async (name) => {
                await page.waitForTimeout(150);
                const data = await page.evaluate(() => window.__audit.layout());
                const failures = [];
                if (data.rootScrollWidth > data.rootWidth + 1 || data.documentWidth > data.width + 1) {
                    failures.push('horizontal overflow');
                }
                if (data.contentOverflow.length) failures.push('content overflow');
                const screenshot = `${size.name}-${name}.png`;
                await page.screenshot({ path: path.join(config.out, screenshot), animations: 'disabled' });
                cases.push({
                    name: `${size.name}-${name}`, screenshot, failures, ...data,
                });
            };
            const fresh = await page.evaluate(() => {
                const summary = window.__audit.reset();
                window.__audit.mountCollection();
                return summary;
            });
            assert.equal(fresh.owned, 1);
            await capture('fresh');
            await page.locator('.theme-card[data-theme="cinder-drift"]').focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('[data-collection-apply]').count(), 0);
            assert.match(await page.locator('.theme-detail-requirement').innerText(), /orb 1/);
            await capture('locked-orb');
            await page.keyboard.press('Escape');
            assert.equal(await page.evaluate(() => document.activeElement.dataset.theme), 'cinder-drift');
            await page.evaluate(() => window.__audit.hub.themesTab.collectionView.open('vesper-chrysalis'));
            assert.match(await page.locator('.theme-detail-requirement').innerText(), /orb 43 · Celestial Chrysalis/);
            await capture('locked-vesper-orb');
            await page.evaluate(() => window.__audit.hub.gamepadCallbacks.closeHub());
            assert.equal(await page.evaluate(() => document.activeElement.dataset.theme), 'vesper-chrysalis');
            await page.evaluate(() => window.__audit.hub.themesTab.collectionView.open('serenity-warp'));
            assert.match(await page.locator('.theme-detail-requirement').innerText(), /orb 55 · Serenity Passage/);
            await capture('locked-warp-orb');
            assert.equal((await page.evaluate(() => window.__audit.switches)).length, 0);
            await page.evaluate(() => { window.__audit.reset(1); window.__audit.mountCollection(); });
            assert.equal(await page.locator(
                '.theme-card[data-theme="cinder-drift"] .theme-collection-state',
            ).textContent(), 'New');
            await capture('partial-new');
            await page.locator('.theme-card[data-theme="cinder-drift"]').scrollIntoViewIfNeeded();
            await capture('collection-cards');
            await page.locator('.theme-card[data-theme="cinder-drift"]').click();
            await capture('collected-detail');
            assert.equal(await page.evaluate(() => window.__audit.collection.getSummary().newCount), 0);
            await page.locator('[data-collection-apply]').scrollIntoViewIfNeeded();
            await capture('collected-actions');
            await page.locator('[data-collection-apply]').click();
            assert.deepEqual(await page.evaluate(() => window.__audit.switches), ['cinder-drift']);
            const reloaded = await page.evaluate(() => window.__audit.createCollection().getSummary());
            assert.equal(reloaded.owned, 2);
            await page.evaluate(() => window.__audit.mountReward('flow', { fresh: true, autoContinue: true }));
            const flowPresence = await page.evaluate(() => {
                const { modal } = window.__audit;
                const bounds = modal.querySelector('[data-flow-action="pause"]').getBoundingClientRect();
                return {
                    autoRunning: modal.dataset.autoRunning,
                    pauseVisible: bounds.top >= 0 && bounds.bottom <= window.innerHeight,
                };
            });
            assert.equal(flowPresence.autoRunning, String(flowPresence.pauseVisible));
            await capture('reward');
            await page.locator('[data-flow-action="pause"]').scrollIntoViewIfNeeded();
            if (await page.locator('[data-flow-action="pause"]').isEnabled()) {
                await page.locator('[data-flow-action="pause"]').click();
            } else assert.deepEqual(await page.evaluate(() => window.__audit.choices), []);
            await capture('reward-paused-actions');
            await page.evaluate(() => window.__audit.mountReward('flow', { reducedMotion: true, fresh: true }));
            assert.equal(await page.locator('.ody-theme-reward').getAttribute('data-celebrating'), 'false');
            assert.equal(await page.evaluate(() => document.querySelector('.ody-theme-reward')
                .getAnimations({ subtree: true }).length), 0);
            await capture('reward-reduced');
            for (const inserted of checks.insertedOrbs) {
                await page.evaluate((id) => {
                    window.__audit.reset(id);
                    window.__audit.mountReward('flow', { fresh: true });
                }, inserted.levelId);
                const rewardText = await page.locator('.ody-theme-reward').textContent();
                assert.ok(rewardText.includes(inserted.displayName));
                assert.ok(rewardText.includes(`${inserted.levelId + 1} / 61 themes`));
                await capture(`orb-${inserted.levelId}-new-reward`);
            }
            await page.evaluate(() => {
                window.__audit.reset(window.__audit.registry.getTotalLevels());
                window.__audit.mountReward('finale', { fresh: true });
            });
            assert.equal(await page.locator('.ody-theme-reward__bonus').count(), 0);
            assert.deepEqual(
                await page.locator('.ody-finale__fact dd').allTextContents(),
                ['60 / 60', '8 / 8', '60 / 180'],
            );
            await capture('finale-last-orb');
            const focusVisible = () => page.evaluate(() => {
                const bounds = document.activeElement.getBoundingClientRect();
                return bounds.top >= -1 && bounds.bottom <= window.innerHeight + 1;
            });
            assert.ok(await focusVisible(), 'Finale initial focus must be visible');
            await page.keyboard.press('Tab');
            assert.ok(await focusVisible(), 'Finale Tab target must scroll into view');
            await capture('finale-focused-actions');
            await page.evaluate(() => window.__audit.mountReward('results'));
            await capture('results-last-orb');
            assert.ok(await focusVisible(), 'Results initial focus must be visible');
            await page.keyboard.press('Tab');
            assert.ok(await focusVisible(), 'Results Tab target must scroll into view');
            await capture('results-focused-actions');
            await page.evaluate(() => window.__audit.mountReward('finale'));
            assert.equal(await page.locator('.ody-theme-reward').getAttribute('data-celebrating'), 'false');
            assert.equal(await page.locator('.ody-theme-reward').getAttribute('aria-live'), 'off');
            for (const failure of ['progress', 'collection']) {
                await page.evaluate((kind) => {
                    window.__audit.receipt = { persisted: false, failure: kind, themeIds: [] };
                    window.__audit.mountReward('flow');
                }, failure);
                assert.equal(await page.locator('.ody-theme-reward').getAttribute('data-celebrating'), 'false');
                assert.equal(await page.locator('.ody-theme-reward img').count(), 0);
                assert.equal(await page.locator('.ody-theme-reward__collection').count(), 0);
                assert.doesNotMatch(await page.locator('.ody-theme-reward').textContent(), /Theme \+ song collected/);
                await capture(`save-${failure}-failure`);
                await page.locator('[data-flow-action="next"]').scrollIntoViewIfNeeded();
                assert.equal(await page.locator('[data-flow-action="next"]').isEnabled(), true);
            }
            await page.evaluate(() => {
                window.__audit.reset(1);
                window.__audit.collection.storage = {
                    getItem: (key) => localStorage.getItem(key),
                    setItem: () => { throw new Error('Injected disposable save failure'); },
                };
                window.__audit.collection.markSeen('cinder-drift');
                window.__audit.mountCollection();
            });
            assert.equal(await page.locator('[data-collection-save-status]').isVisible(), true);
            await capture('collection-save-failure');
        }
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.evaluate(() => {
            document.documentElement.style.fontSize = '16px'; window.__audit.reset(1);
            window.__audit.mountReward('flow', { autoContinue: true, fresh: true });
        });
        await page.waitForFunction(() => window.__audit.choices.length > 0);
        checks.auto = await page.evaluate(() => window.__audit.choices);
        assert.equal(checks.auto[0].choice, 'next');
        assert.ok(checks.auto[0].ms >= 2500 && checks.auto[0].ms < 3100, JSON.stringify(checks.auto));
        checks.coverage = config.focusOnly
            ? ['Visible initial completion focus and Tab targets for reward and both save failures at four sizes',
                'No overflow', 'Existing 2600ms automatic handoff']
            : ['real OdysseyStateManager save → collection award → new service reload',
                'fresh Forest only', 'locked inspect never switches', 'explicit owned Apply only',
                'keyboard Enter/Escape and delegated controller close callback restore source card',
                '60 unique non-Forest first-clear rewards, no bonuses, and all 61 themes owned after reload',
                'retired BioII has no card, grant count, original Bio grant, or active orb completion',
                'v2 orb 19 migrates to 18 and retains Summer; re-clear adds Halcyon and reload preserves both',
                'all remapped orb requirements compared with v2 provenance; inserted orbs 43 and 55 requirements',
                'Vesper and Warp grant only from their own orb completions', 'four viewport/text sizes',
                'static reduced-motion reward', 'same receipt results/finale roundtrip does not repeat celebration',
                'existing 2600ms automatic handoff'];
    } catch (error) {
        checks.fatal = { message: error.message, stack: error.stack };
        await page.screenshot({ path: path.join(config.out, 'fatal.png') }).catch(() => {});
    } finally {
        await browser.close();
        const report = {
            methodology: 'Real production DOM/CSS/data/service, injected renderer and Hub shell dependencies; '
                + 'disposable browser localStorage. Synthetic completion, no human play, hardware performance, '
                + 'physical controller, or audio-mix claim.',
            generatedAt: new Date().toISOString(),
            cases,
            checks,
            errors,
            passed: !checks.fatal && errors.length === 0 && cases.every((entry) => entry.failures.length === 0),
        };
        await writeFile(path.join(config.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        console.log(JSON.stringify({
            passed: report.passed,
            cases: cases.length,
            errors,
            fatal: checks.fatal,
            failedCases: cases.filter((entry) => entry.failures.length)
                .map(({ name, failures }) => ({ name, failures })),
            checks,
        }, null, 2));
        if (!report.passed) process.exitCode = 1;
    }
}

async function runRuntimeProbe() {
    const levelId = config.runtimeLevel;
    let themeId;
    let themeName;
    const out = path.join(config.out, 'runtime');
    await mkdir(out, { recursive: true });
    const liveBrowser = await chromium.launch({
        headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
        args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    const live = await liveBrowser.newPage({ viewport: { width: 1280, height: 800 } });
    live.setDefaultTimeout(15000);
    const runtime = {
        errors: [], console: [], steps: {}, passed: false,
    };
    const runtimeStarted = Date.now();
    const runtimeDeadlineTimer = setTimeout(() => {
        runtime.deadlineExceeded = true;
        live.close({ runBeforeUnload: false }).catch(() => {});
    }, 180000);
    live.on('pageerror', (error) => runtime.errors.push(error.message));
    live.on('console', (message) => {
        runtime.console.push(`${Date.now() - runtimeStarted}ms ${message.type()}: ${message.text()}`);
        if (message.type() === 'error') runtime.errors.push(message.text());
    });
    const timeout = 120000;
    try {
        await live.addInitScript(() => {
            if (sessionStorage.getItem('__collectionAuditSeeded')) return;
            localStorage.clear();
            localStorage.setItem('serenityBlocksSettings', JSON.stringify({
                effectQuality: 'Minimal',
                renderScale: 0.75,
                musicVolume: 0,
                sfxVolume: 0,
                odysseyAutoContinue: false,
                customCursorEnabled: false,
            }));
            sessionStorage.setItem('__collectionAuditSeeded', 'true');
        });
        const liveUrl = new URL('/?skipIntro=1&forceWebGL=1', config.baseUrl).href;
        await live.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await live.waitForFunction(() => window.startupPipelineSnapshot?.menuReady
            && window.serenityBlocks?.themeManager?.activeThemeName, null, { timeout });
        const authoredTarget = await live.evaluate(async (id) => {
            /* eslint-disable import/no-unresolved, import/no-absolute-path -- Browser module URLs via Vite. */
            const [{ getLevelRegistry }, { getThemeMeta }] = await Promise.all([
                import('/src/core/odyssey/LevelRegistry.js'), import('/src/themes/theme-registry.js'),
            ]);
            const level = getLevelRegistry().getLevel(id);
            const params = new URLSearchParams(window.location.search);
            let resolvedQuality = null;
            if (level.theme.primary === 'vesper-chrysalis') {
                const { resolveVesperQuality } = await import(
                    '/src/themes/vesper-chrysalis/vesper-chrysalis-quality.js'
                );
                resolvedQuality = resolveVesperQuality(params, window.settings);
            }
            /* eslint-enable import/no-unresolved, import/no-absolute-path */
            return {
                themeId: level.theme.primary,
                themeName: getThemeMeta(level.theme.primary).displayName,
                name: level.name,
                chapter: level.chapter,
                quality: {
                    effectQuality: window.settings?.effectQuality,
                    graphicsQuality: window.settings?.graphicsQuality ?? null,
                    query: params.get('quality'),
                    resolved: resolvedQuality,
                },
            };
        }, levelId);
        runtime.steps.target = authoredTarget;
        ({ themeId, themeName } = authoredTarget);
        if (themeId === 'vesper-chrysalis') assert.equal(authoredTarget.quality.resolved, 'Minimal');
        runtime.steps.fresh = await live.evaluate((id) => ({
            current: window.serenityBlocks.themeManager.activeThemeName,
            summary: window.serenityBlocks.themeCollection.getSummary(),
            canSelectTarget: window.serenityBlocks.themeManager.canSelectTheme(id),
        }), themeId);
        assert.equal(runtime.steps.fresh.current, 'forest');
        assert.equal(runtime.steps.fresh.summary.owned, 1);
        assert.equal(runtime.steps.fresh.canSelectTarget, false);
        await live.screenshot({ path: path.join(out, '01-fresh-forest.png'), animations: 'disabled' });
        await live.evaluate(() => {
            window.__collectionBoot = (async () => {
                const manager = window.serenityBlocks.gameModeManager;
                document.querySelector('#start-modal')?.classList.remove('visible');
                await manager.activateMode('odyssey'); await manager.startCurrentMode();
            })();
        });
        await live.waitForFunction(() => window.odysseyMode?.isInBoardView
            && window.odysseyMode?.boardController, null, { timeout });
        await live.evaluate(() => window.__collectionBoot);
        if (config.mapProbe) {
            await live.evaluate((id) => {
                const mode = window.odysseyMode;
                mode.odysseyState.unlockLevel(id);
                mode.boardController.updateProgress(mode._buildOdysseyProgressData());
                window.__collectionMapFocus = mode.focusCollectionLevel(id);
            }, levelId);
            assert.equal(await live.evaluate(() => window.__collectionMapFocus), true);
            await live.waitForTimeout(250);
            runtime.steps.worldMap = await live.evaluate((id) => {
                const mode = window.odysseyMode;
                const board = mode.boardController;
                const node = board.nodeManager.nodes.get(id);
                const projected = board.nodeManager.getNodePosition(id).clone().project(board.camera);
                return {
                    nodeCount: board.nodeManager.nodes.size,
                    selectedLevelId: mode.selectedLevelId,
                    boardSelectedLevelId: board.selectedLevelId,
                    name: document.getElementById('level-panel-name').textContent,
                    chapter: node.config.chapter,
                    themeId: node.config.theme.primary,
                    playEnabled: !document.getElementById('level-panel-play-btn').disabled,
                    visible: node.group.visible,
                    projection: { x: projected.x, y: projected.y, z: projected.z },
                    neighbors: [id - 1, id, id + 1].map((candidate) => ({
                        levelId: candidate,
                        pathPosition: mode.levelRegistry.getLevel(candidate)?.pathPosition,
                    })),
                };
            }, levelId);
            const map = runtime.steps.worldMap;
            assert.equal(map.nodeCount, 60);
            assert.equal(map.selectedLevelId, levelId);
            assert.equal(map.boardSelectedLevelId, levelId);
            assert.equal(map.chapter, authoredTarget.chapter);
            assert.equal(map.themeId, themeId);
            assert.equal(map.name, authoredTarget.name);
            assert.equal(map.playEnabled, true);
            assert.equal(map.visible, true);
            assert.ok(Math.abs(map.projection.x) <= 1 && Math.abs(map.projection.y) <= 1
                && Math.abs(map.projection.z) <= 1, 'Inserted orb must be inside the selected camera view.');
            const positions = map.neighbors.map((neighbor) => neighbor.pathPosition);
            assert.ok(
                positions[0] < positions[1] && positions[1] < positions[2],
                'Inserted orb must sit strictly between its neighbors along the path.',
            );
            await live.screenshot({ path: path.join(out, '02a-inserted-orb-world-map.png') });
        }
        runtime.steps.prefetch = await live.evaluate((id) => {
            const mode = window.odysseyMode;
            return mode._prefetchLevelAssets(mode.levelRegistry.resolveLevelPresentation(id), { priority: 'high' });
        }, levelId);
        runtime.steps.entryTimingBudget = await live.evaluate((id) => {
            const mode = window.odysseyMode;
            window.__collectionEntryTrace = [];
            for (const method of ['_prepareGameplayReveal', '_activateLevelThemeVisuals', 'prepareLevelStart',
                '_waitForEntryRevealReadiness', '_confirmFirstGameplayComposite']) {
                const original = mode[method];
                mode[method] = async function tracedEntryStep(...args) {
                    const trace = { method, started: performance.now() };
                    window.__collectionEntryTrace.push(trace);
                    try {
                        const result = await original.apply(this, args);
                        trace.result = result;
                        return result;
                    } finally {
                        trace.duration = performance.now() - trace.started;
                    }
                };
            }
            return mode._buildJourneyEntryTimings(mode.levelRegistry.getLevel(id));
        }, levelId);
        if (config.mapProbe) await live.locator('#level-panel-play-btn').click();
        else {
            await live.evaluate((id) => { window.__collectionEntry = window.testOdysseyLevel(id); }, levelId);
            await live.evaluate(() => window.__collectionEntry);
        }
        await live.waitForFunction(
            (id) => (window.odysseyMode?.levelRunStarted && window.odysseyMode?.currentLevelId === id)
                || (window.odysseyMode?.entryPhase === 'aborted' && !window.odysseyMode?.isEnteringLevel),
            levelId,
            { timeout },
        );
        runtime.steps.entry = await live.evaluate(() => ({
            phase: window.odysseyMode.entryPhase,
            levelId: window.odysseyMode.currentLevelId,
            started: window.odysseyMode.levelRunStarted,
            trace: window.__collectionEntryTrace,
        }));
        assert.equal(runtime.steps.entry.started, true, `Entry ended in phase ${runtime.steps.entry.phase}.`);
        assert.equal(runtime.steps.entry.levelId, levelId);
        runtime.steps.authoredPlayback = await live.evaluate((id) => ({
            current: window.serenityBlocks.themeManager.activeThemeName,
            collectionOwnsTarget: window.serenityBlocks.themeCollection.isUnlocked(id),
            scope: window.serenityBlocks.themeManager.isOdysseyThemeScopeActive(),
        }), themeId);
        assert.equal(runtime.steps.authoredPlayback.current, themeId);
        assert.equal(runtime.steps.authoredPlayback.collectionOwnsTarget, false);
        await live.screenshot({ path: path.join(out, '02-authored-locked-orb.png') });
        await live.evaluate(() => {
            const mode = window.odysseyMode;
            const { type, target } = mode.currentLevelConfig.victory.primary;
            mode.gameState.score = type === 'score' ? target : 12400;
            if (type === 'cascade') {
                for (let index = 0; index < target; index += 1) mode.hybridEngine.victoryEvaluator.onCascade(1);
            } else if (type === 'lines') mode.hybridEngine.victoryEvaluator.onLineClear(target);
            else if (type === 'score') mode.hybridEngine.updateScore(target);
            else throw new Error(`Unsupported runtime probe goal: ${type}`);
            mode._checkVictoryConditions(mode._activeLevelSession);
        });
        await live.waitForSelector('.ody-theme-reward', { timeout: 15000 });
        await live.waitForTimeout(350);
        const imageState = () => live.evaluate(() => {
            const image = document.querySelector('.ody-theme-reward__image');
            const styles = (node) => {
                const computed = getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return {
                    class: node.className,
                    rect: rect.toJSON(),
                    display: computed.display,
                    opacity: computed.opacity,
                    visibility: computed.visibility,
                    transform: computed.transform,
                    filter: computed.filter,
                    zIndex: computed.zIndex,
                };
            };
            return image ? {
                styles: [image, image.parentElement, image.parentElement.querySelector('.ody-theme-reward__seal')]
                    .filter(Boolean).map(styles),
                bodyClass: document.body.className,
                src: image.src,
                currentSrc: image.currentSrc,
                complete: image.complete,
                naturalWidth: image.naturalWidth,
                hidden: image.hidden,
            } : null;
        });
        runtime.steps.imageAt350ms = await imageState();
        await live.waitForFunction(() => {
            const image = document.querySelector('.ody-theme-reward__image');
            return image?.complete && image.naturalWidth > 0 && !image.hidden;
        }, null, { timeout: 10000 });
        runtime.steps.decodedImage = await imageState();
        await live.screenshot({ path: path.join(out, '03-saved-theme-reward.png'), animations: 'disabled' });
        await live.waitForTimeout(500);
        await live.screenshot({ path: path.join(out, '04-settled-theme-reward.png') });
        runtime.steps.awarded = await live.evaluate((id) => ({
            summary: window.serenityBlocks.themeCollection.getSummary(),
            saved: JSON.parse(localStorage.getItem('serenityBlocks_themeCollection')),
            progress: JSON.parse(localStorage.getItem('serenityBlocks_odysseyProgress')).completedLevels[String(id)],
            reward: document.querySelector('.ody-theme-reward').textContent,
        }), levelId);
        assert.equal(runtime.steps.awarded.summary.owned, 2);
        assert.ok(runtime.steps.awarded.saved.grants[themeId]);
        assert.equal(runtime.steps.awarded.progress.themeId, themeId);
        assert.deepEqual(runtime.steps.awarded.progress.themeIds, [themeId]);
        assert.ok(runtime.steps.awarded.reward.includes(themeName));
        await live.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await live.waitForFunction(() => window.startupPipelineSnapshot?.menuReady
            && window.serenityBlocks?.themeManager?.activeThemeName, null, { timeout });
        runtime.steps.reloaded = await live.evaluate((id) => ({
            current: window.serenityBlocks.themeManager.activeThemeName,
            summary: window.serenityBlocks.themeCollection.getSummary(),
            canSelectTarget: window.serenityBlocks.themeManager.canSelectTheme(id),
            duplicateReward: Boolean(document.querySelector('.ody-theme-reward')),
        }), themeId);
        assert.equal(runtime.steps.reloaded.current, 'forest');
        assert.equal(runtime.steps.reloaded.summary.owned, 2);
        assert.equal(runtime.steps.reloaded.canSelectTarget, true);
        assert.equal(runtime.steps.reloaded.duplicateReward, false);
        assert.deepEqual(runtime.errors, []);
        runtime.passed = true;
    } catch (error) {
        runtime.fatal = { message: error.message, stack: error.stack };
        await live.screenshot({ path: path.join(out, 'fatal.png') }).catch(() => {});
    } finally {
        clearTimeout(runtimeDeadlineTimer);
        runtime.steps.entryTrace = await live.evaluate(() => window.__collectionEntryTrace || []).catch(() => []);
        await liveBrowser.close();
        const entryMethod = config.mapProbe
            ? 'fixture unlock, real world-map focus and Play button entry'
            : 'entry via DEV level helper';
        runtime.methodology = 'Fresh disposable Chromium profile; actual application Forest boot, '
            + `authored Odyssey orb ${levelId} (${themeName}), ${entryMethod}, `
            + 'synthetic authored goal through real evaluator, real completion/save/reward, page reload. '
            + 'Source asset prefetch and reward image decode awaited. Muted software WebGL2; '
            + 'no human play, audio-mix or native-performance claim.';
        await writeFile(path.join(out, 'report.json'), `${JSON.stringify(runtime, null, 2)}\n`);
        console.log(JSON.stringify({
            runtime: runtime.passed,
            steps: runtime.steps,
            fatal: runtime.fatal,
            errors: runtime.errors,
        }));
        if (!runtime.passed) process.exitCode = 1;
    }
}

if (config.runtime && !process.exitCode) await runRuntimeProbe();
