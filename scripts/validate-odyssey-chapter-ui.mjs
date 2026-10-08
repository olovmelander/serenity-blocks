#!/usr/bin/env node
/**
 * DOM-only Odyssey chapter arrival audit using real registry content and styles.
 * Start Vite separately; no game/Three renderer is loaded. Playwright is optional
 * developer tooling (PLAYWRIGHT_MODULE), not an application dependency.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sizes = [
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
];
const config = {
    baseUrl: process.env.ODYSSEY_FLOW_BASE_URL || 'http://127.0.0.1:5173',
    out: path.resolve('artifacts/odyssey-chapter-ui'),
};
for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--help') {
        console.log('node scripts/validate-odyssey-chapter-ui.mjs [--base-url URL] [--out DIR]\n'
            + '  [--world-dir DIR] [--baseline-ref GIT_REF]\n'
            + 'Audits all eight chapter arrivals plus late duel/rule transit content at four sizes.\n'
            + 'Captures real DOM/CSS over a synthetic backdrop, with GPU disabled.\n'
            + 'Set PLAYWRIGHT_MODULE and optionally CHROMIUM_PATH for external browser tooling.');
        process.exit(0);
    }
    const keys = {
        '--base-url': 'baseUrl', '--out': 'out', '--world-dir': 'worldDir', '--baseline-ref': 'baselineRef',
    };
    if (!keys[arg] || !process.argv[i + 1]) {
        throw new Error(`Unknown or incomplete option: ${arg}`);
    }
    config[keys[arg]] = process.argv[++i];
}
config.out = path.resolve(config.out);
await mkdir(config.out, { recursive: true });
let playwright;
try {
    // eslint-disable-next-line import/no-unresolved -- Optional external developer tooling, not a game dependency.
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
const page = await browser.newPage();
page.setDefaultTimeout(5000);
const errors = [];
const cases = [];
const worldProof = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const check = (row, condition, description) => { if (!condition) row.failures.push(description); };
try {
    const fixtureUrl = new URL('/__odyssey_chapter_ui_fixture', config.baseUrl).href;
    await page.route(fixtureUrl, (route) => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${
            ['/styles/fonts.css', '/styles/keystone.css', '/styles/odyssey-flow.css']
                .map((href) => `<link rel="stylesheet" href="${href}">`).join('')
        }</head><body style="margin:0;min-height:100vh;`
            + 'background:radial-gradient(ellipse at 70% 18%,#385366,#111421 65%,#080713)"></body></html>',
    }));
    await page.goto(fixtureUrl);
    const chapters = await page.evaluate(async ({ overlayPath, registryPath, briefingPath }) => {
        const [{ createJourneyFlowOverlay }, { LevelRegistry }, { getOdysseyLevelBriefing }] = await Promise.all([
            import(overlayPath), import(registryPath), import(briefingPath),
        ]);
        const registry = new LevelRegistry();
        window.__chapterRegistry = registry;
        window.__mountChapterFixture = (chapterId, targetId = null) => {
            window.__chapterModal?.dispose();
            const chapter = registry.getChapter(chapterId);
            const first = registry.getChapterStartLevel(chapterId);
            const nextLevel = registry.resolveLevelPresentation(targetId || first.id);
            const level = registry.resolveLevelPresentation(nextLevel.id - 1);
            window.__chapterChoices = [];
            const onChoose = (choice) => window.__chapterChoices.push(choice);
            const modal = createJourneyFlowOverlay({
                variant: 'completion',
                level,
                nextLevel,
                chapter,
                autoContinue: false,
                results: { stars: 2, score: 46000, time: 130 },
                onChoose,
            });
            document.body.appendChild(modal);
            modal.beginTransit({ onChoose });
            modal.setScenic('travel');
            window.__chapterModal = modal;
            window.__arriveChapter = () => modal.showChapter({ onChoose });
            return { chapter, nextLevel, briefing: getOdysseyLevelBriefing(nextLevel, level) };
        };
        window.__chapterLayout = () => {
            const modal = window.__chapterModal;
            const rect = (node) => {
                const bounds = node.getBoundingClientRect();
                return {
                    top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right,
                };
            };
            const visible = (node) => {
                if (!node || node.hidden || !node.getClientRects().length) return false;
                const bounds = rect(node);
                return bounds.top >= -1 && bounds.bottom <= window.innerHeight + 1
                    && bounds.left >= -1 && bounds.right <= window.innerWidth + 1;
            };
            const active = document.activeElement;
            const content = modal.querySelector('.ody-flow__content');
            const title = modal.querySelector('.ody-flow__title');
            // Authored hyphens (Thin-Air) are valid wrap opportunities, not broken words.
            const splitTitleWords = [...title.textContent.matchAll(/[^\s\u002d\u2010]+/gu)].filter((word) => {
                const range = document.createRange();
                range.setStart(title.firstChild, word.index);
                range.setEnd(title.firstChild, word.index + word[0].length);
                return range.getClientRects().length > 1;
            }).map((word) => word[0]);
            return {
                variant: modal.dataset.variant,
                autoRunning: modal.dataset.autoRunning,
                held: modal.dataset.visibilityHeld === 'true',
                scrollTop: modal.scrollTop,
                width: modal.clientWidth,
                scrollWidth: modal.scrollWidth,
                contentWidth: content.clientWidth,
                contentScrollWidth: content.scrollWidth,
                height: modal.clientHeight,
                scrollHeight: modal.scrollHeight,
                title: title.textContent,
                titleBounds: rect(title),
                splitTitleWords,
                narrative: modal.querySelector('.ody-flow__narrative')?.textContent,
                goal: modal.querySelector('.ody-flow__goal').textContent,
                changes: [...modal.querySelectorAll('.ody-flow__changes li')].map((node) => node.textContent),
                active: active?.dataset.flowAction || active?.className || null,
                activeVisible: visible(active),
                actions: [...modal.querySelectorAll('[data-flow-action]')]
                    .filter((node) => !node.hidden && !node.disabled)
                    .map((node) => ({ action: node.dataset.flowAction, visible: visible(node), bounds: rect(node) })),
                choices: [...window.__chapterChoices],
            };
        };
        await document.fonts.ready;
        return registry.getAllChapters().map((chapter) => chapter.id);
    }, {
        overlayPath: '/src/ui/odyssey/JourneyFlowOverlay.js',
        registryPath: '/src/core/odyssey/LevelRegistry.js',
        briefingPath: '/src/ui/odyssey/odyssey-level-briefing.js',
    });
    /* eslint-disable no-await-in-loop -- Cases mutate one shared browser page; finish each before changing its state. */
    for (const size of sizes) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.evaluate((fontSize) => {
            document.documentElement.style.fontSize = `${fontSize}px`;
        }, size.fontSize);
        for (const chapterId of chapters) {
            const row = {
                name: `${size.name}-chapter-${chapterId}`, size, chapterId, failures: [],
            };
            row.content = await page.evaluate((id) => window.__mountChapterFixture(id), chapterId);
            await page.waitForTimeout(30);
            if (await page.evaluate(() => window.__chapterModal.dataset.visibilityHeld === 'true')) {
                await page.getByRole('button', { name: 'Resume journey', exact: true }).click();
            }
            await page.evaluate(() => {
                // Arrival must recover from a player who scrolled the previous briefing.
                window.__chapterModal.scrollTop = window.__chapterModal.scrollHeight;
                window.__chapterModal.querySelector('.ody-flow__content').scrollTop = 120;
                window.__arriveChapter();
            });
            await page.waitForTimeout(600);
            row.initial = await page.evaluate(() => window.__chapterLayout());
            check(row, row.initial.scrollWidth <= row.initial.width + 1, 'Horizontal overflow on arrival');
            check(
                row,
                row.initial.contentScrollWidth <= row.initial.contentWidth + 1,
                'Chapter content horizontal overflow',
            );
            check(row, row.initial.titleBounds.top >= 0, 'Arrival title begins above reachable viewport');
            check(row, row.initial.activeVisible, 'Initial chapter focus is offscreen');
            check(row, row.initial.splitTitleWords.length === 0, 'Chapter title splits a word mid-word');
            check(row, row.initial.title === row.content.chapter.name, 'Authored chapter title changed');
            check(row, row.initial.narrative === row.content.chapter.narrative.intro, 'Authored narrative changed');
            check(
                row,
                JSON.stringify(row.initial.changes) === JSON.stringify(row.content.briefing.changes),
                'Rule copy changed',
            );
            check(
                row,
                row.initial.autoRunning !== 'true' && row.initial.choices.length === 0,
                'Chapter is not untimed',
            );
            await page.screenshot({ path: path.join(config.out, `${row.name}-arrival.png`), animations: 'disabled' });
            if (chapterId === 7) {
                await page.waitForTimeout(3200);
                check(
                    row,
                    (await page.evaluate(() => window.__chapterChoices)).length === 0,
                    'Reading pause auto-advanced',
                );
            }
            // Tab must move to a visible action even when its handler wraps the focus trap.
            await page.locator('[data-flow-action="map"]').focus();
            await page.evaluate(() => { window.__chapterModal.scrollTop = 0; });
            await page.keyboard.press('Tab');
            row.keyboard = await page.evaluate(() => window.__chapterLayout());
            check(row, row.keyboard.active === 'next' && row.keyboard.activeVisible, 'Tab wrap leaves Begin offscreen');
            await page.locator('[data-flow-action="map"]').scrollIntoViewIfNeeded();
            row.actions = await page.evaluate(() => window.__chapterLayout());
            check(row, row.actions.actions.every((action) => action.visible), 'Begin/Map cannot be reached together');
            await page.screenshot({ path: path.join(config.out, `${row.name}-actions.png`), animations: 'disabled' });
            // Actual browser focus events are supplemented with a reproducible synthetic blur.
            await page.evaluate(() => {
                window.__chapterModal.scrollTop = 0;
                window.dispatchEvent(new Event('blur'));
            });
            await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', repeat: true, bubbles: true, cancelable: true,
            })));
            check(
                row,
                (await page.evaluate(() => window.__chapterChoices)).length === 0,
                'Hidden Begin accepted after blur',
            );
            await page.keyboard.press('Enter');
            row.resumed = await page.evaluate(() => window.__chapterLayout());
            check(row, !row.resumed.held && row.resumed.activeVisible, 'Keyboard Resume leaves focus offscreen');
            check(
                row,
                (await page.evaluate(() => window.__chapterChoices)).length === 0,
                'Resume bypassed deliberate Begin',
            );
            await page.getByRole('button', { name: 'Begin chapter', exact: true }).click();
            check(
                row,
                JSON.stringify(await page.evaluate(() => window.__chapterChoices)) === '["next"]',
                'Begin did not choose once',
            );
            await page.evaluate(() => window.__chapterModal.dispose());
            await page.keyboard.press('Enter');
            check(
                row,
                (await page.evaluate(() => window.__chapterChoices)).length === 1,
                'Disposed chapter retained input',
            );
            cases.push(row);
        }
        for (const targetId of [53, 55, 58, 59]) {
            const row = {
                name: `${size.name}-late-orb-${targetId}`, size, targetId, failures: [],
            };
            row.content = await page.evaluate(
                (id) => window.__mountChapterFixture(window.__chapterRegistry.getLevel(id).chapter, id),
                targetId,
            );
            await page.waitForTimeout(100);
            row.initial = await page.evaluate(() => window.__chapterLayout());
            check(row, row.initial.scrollWidth <= row.initial.width + 1, 'Late briefing horizontal overflow');
            check(
                row,
                row.initial.contentScrollWidth <= row.initial.contentWidth + 1,
                'Late briefing panel horizontal overflow',
            );
            check(
                row,
                row.initial.actions.every((action) => action.visible),
                'Late briefing Pause/Resume/Map inaccessible',
            );
            check(row, row.initial.goal === row.content.briefing.goal, 'Late briefing goal changed');
            await page.screenshot({ path: path.join(config.out, `${row.name}.png`), animations: 'disabled' });
            await page.getByRole('button', { name: 'Map', exact: true }).click();
            check(
                row,
                JSON.stringify(await page.evaluate(() => window.__chapterChoices)) === '["map"]',
                'Late briefing Map failed',
            );
            cases.push(row);
        }
    }
    if (config.worldDir) {
        await page.setViewportSize({ width: 1280, height: 800 });
        const baselineCss = config.baselineRef
            ? execFileSync(
                'git',
                ['show', `${config.baselineRef}:public/styles/odyssey-flow.css`],
                { encoding: 'utf8' },
            )
            : null;
        for (const chapterId of [7, 3]) {
            const backgroundPath = path.resolve(
                config.worldDir,
                `chapter-${String(chapterId).padStart(2, '0')}`,
                '01-arrival-world.png',
            );
            const background = `data:image/png;base64,${(await readFile(backgroundPath)).toString('base64')}`;
            for (const phase of baselineCss ? ['before', 'after'] : ['after']) {
                await page.evaluate(({ chapter, png, css }) => {
                    document.documentElement.style.fontSize = '16px';
                    document.body.style.background = `url("${png}") center / 1280px 800px no-repeat fixed`;
                    document.getElementById('chapter-baseline-css')?.remove();
                    if (css) {
                        const style = document.createElement('style');
                        style.id = 'chapter-baseline-css';
                        style.textContent = css;
                        document.head.appendChild(style);
                    }
                    window.__mountChapterFixture(chapter);
                    window.__arriveChapter();
                    // This comparison isolates the scrim over identical world pixels.
                    if (css) document.activeElement?.blur();
                }, { chapter: chapterId, png: background, css: phase === 'before' ? baselineCss : null });
                await page.waitForTimeout(600);
                const file = `world-chapter-${chapterId}-${phase}.png`;
                await page.screenshot({ path: path.join(config.out, file), animations: 'disabled' });
                worldProof.push({
                    chapterId, phase, backgroundPath, file, layout: await page.evaluate(() => window.__chapterLayout()),
                });
            }
        }
    }
    /* eslint-enable no-await-in-loop */
} catch (error) {
    errors.push(error.stack || error.message);
    process.exitCode = 1;
} finally {
    await browser.close();
    const failures = cases.flatMap((row) => row.failures.map((failure) => `${row.name}: ${failure}`));
    const report = {
        status: failures.length || errors.length ? 'fail' : 'pass',
        cases,
        failures,
        errors,
        worldProof,
        limitation: 'DOM/CSS fixture with real authored registry copy over a synthetic backdrop. No game renderer, '
            + 'physical phone, OS focus change, browser zoom, or human usability acceptance. '
            + 'Large-text uses 200% root text.',
    };
    await writeFile(path.join(config.out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
        status: report.status, cases: cases.length, failures, errors, out: config.out,
    }, null, 2));
    if (report.status !== 'pass') process.exitCode = 1;
}
