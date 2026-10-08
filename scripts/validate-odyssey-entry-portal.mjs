#!/usr/bin/env node
/** Bounded shipping Canvas2D/DOM portal capture over saved world baselines; no live WebGL renderer. */
/* eslint-disable no-await-in-loop -- Fixtures and frames share one page and must finish in capture order. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LevelRegistry } from '../src/core/odyssey/LevelRegistry.js';
import { getOdysseyThemePresentationPalette } from '../src/core/odyssey/theme-presentation.js';

const config = {
    source: 'src/rendering/transitions/JourneyEntryTransition.js',
    baselines: 'artifacts/odyssey-chapter-audit-2026-10-08',
    out: 'artifacts/odyssey-entry-portal-2026-10-08/after',
    label: 'after',
};
for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index].replace(/^--/, '');
    if (key === 'help') {
        console.log('node scripts/validate-odyssey-entry-portal.mjs [--source FILE] [--baselines DIR] '
            + '[--out DIR] [--label before|after]\n'
            + 'Uses saved chapter3 offscreen and chapter1 visible anchors, seeded particles '
            + 'and a controlled portal clock.\n'
            + 'Set PLAYWRIGHT_MODULE and CHROMIUM_PATH for external tooling. No Vite/game/WebGL is started.');
        process.exit(0);
    }
    if (!Object.hasOwn(config, key) || !process.argv[index + 1]) throw new Error(`Unknown/incomplete option: ${key}`);
    config[key] = process.argv[++index];
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(config.source);
const constants = await readFile('src/rendering/transitions/transition-layer-constants.js');
await mkdir(config.out, { recursive: true });
await writeFile(path.join(config.out, 'JourneyEntryTransition.source.js'), source);
const fixtures = [];
const registry = new LevelRegistry();
for (const [chapter, name, reducedMotion] of [[3, 'offscreen', false], [1, 'visible', false], [3, 'reduced', true]]) {
    const root = path.join(config.baselines, `chapter-${String(chapter).padStart(2, '0')}`);
    const report = JSON.parse(await readFile(path.join(root, 'report.json'), 'utf8'));
    const station = report.stations.find((entry) => entry.name === 'arrival');
    const metrics = station.metrics.firstOrbMetrics;
    const level = registry.resolveLevelPresentation(registry.getChapterStartLevel(chapter).id);
    const theme = level.transitionPaletteThemeId || level.theme.transitionPalette || level.theme.primary;
    const palette = getOdysseyThemePresentationPalette(theme);
    assert.ok(palette, `Expected a shipped entry palette for ${theme}`);
    fixtures.push({
        name,
        reducedMotion,
        chapter,
        palette,
        levelId: level.id,
        anchor: { ...metrics.center, radius: metrics.radius, onScreen: metrics.onScreen },
        background: await readFile(path.join(root, station.filename)),
    });
}
let playwright;
try {
    // eslint-disable-next-line import/no-unresolved -- Optional developer tooling can also be supplied externally.
    playwright = await import('playwright');
} catch (error) {
    if (!process.env.PLAYWRIGHT_MODULE) {
        throw new Error('Set PLAYWRIGHT_MODULE to external Playwright.', { cause: error });
    }
    playwright = await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href);
}
const browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-gpu', '--disable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(5000);
const errors = [];
const cases = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
try {
    await page.route('http://odyssey-portal.test/**', (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname === '/JourneyEntryTransition.js') {
            return route.fulfill({ contentType: 'text/javascript', body: source });
        }
        if (pathname === '/transition-layer-constants.js') {
            return route.fulfill({ contentType: 'text/javascript', body: constants });
        }
        return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><head><link rel="icon" href="data:,"></head>'
                + '<body style="margin:0;background:#080713;overflow:hidden"></body></html>',
        });
    });
    await page.goto('http://odyssey-portal.test/');
    for (const fixture of fixtures) {
        const row = {
            name: fixture.name,
            chapter: fixture.chapter,
            levelId: fixture.levelId,
            palette: fixture.palette,
            rawAnchor: fixture.anchor,
            backgroundSha256: hash(fixture.background),
            frames: [],
        };
        row.normalizedAnchor = await page.evaluate(async ({
            anchor, palette, reducedMotion, background, moduleUrl,
        }) => {
            document.body.replaceChildren();
            const image = document.createElement('img');
            image.src = background;
            image.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover';
            document.body.appendChild(image);
            await image.decode();
            const { JourneyEntryTransition } = await import(moduleUrl);
            let now = 0;
            const transition = new JourneyEntryTransition({
                performanceRef: { now: () => now },
                requestAnimationFrameRef: () => 1,
                cancelAnimationFrameRef: () => {},
            });
            const originalRandom = Math.random;
            let seed = 12345;
            Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
            const completion = transition.play({
                anchor, palette, reducedMotion, qualityPreset: 'High',
            });
            Math.random = originalRandom;
            window.__portalCapture = {
                frame: (time) => { now = time; transition.tick(transition.activeRun); },
                finish: async () => { transition.abort('capture-complete'); await completion; },
            };
            return transition.activeRun.anchor;
        }, {
            anchor: fixture.anchor,
            palette: fixture.palette,
            reducedMotion: fixture.reducedMotion,
            background: `data:image/png;base64,${fixture.background.toString('base64')}`,
            moduleUrl: '/JourneyEntryTransition.js',
        });
        if (fixture.anchor.onScreen) assert.deepEqual(row.normalizedAnchor, fixture.anchor);
        else if (config.label === 'after') {
            assert.deepEqual(row.normalizedAnchor, {
                x: 0.5, y: 0.5, radius: 0.14, onScreen: false,
            });
        }
        for (const elapsed of fixture.reducedMotion ? [110] : [200, 360, 600]) {
            await page.evaluate((time) => window.__portalCapture.frame(time), elapsed);
            const filename = `${fixture.name}-${elapsed}ms.png`;
            const bytes = await page.screenshot({ path: path.join(config.out, filename) });
            row.frames.push({ elapsedMs: elapsed, filename, sha256: hash(bytes) });
        }
        await page.evaluate(() => window.__portalCapture.finish());
        cases.push(row);
    }
    assert.deepEqual(errors, [], 'Unexpected browser errors');
} finally {
    await writeFile(path.join(config.out, 'report.json'), JSON.stringify({
        status: cases.length === fixtures.length && errors.length === 0 ? 'pass' : 'incomplete',
        label: config.label,
        source: config.source,
        sourceSha256: hash(source),
        constantsSha256: hash(constants),
        methodology: 'Shipping JourneyEntryTransition with measured chapter anchors, resolved first-orb palette '
            + 'and saved arrival world images. Seeded particles; injected clock; 1280x800; GPU/WebGL disabled.',
        limitations: 'Static background, not a live camera/world or full chapter lifecycle. '
            + 'Camera-motion suppression is verified by the production Mode unit test. No performance or audio claim.',
        errors,
        cases,
    }, null, 2));
    await browser.close();
}
console.log(JSON.stringify({
    label: config.label,
    cases: cases.length,
    screenshots: cases.reduce((sum, row) => sum + row.frames.length, 0),
    errors,
    out: config.out,
}));
