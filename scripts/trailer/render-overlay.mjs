/**
 * Render the trailer's title layer (overlay.mjs) to a transparent PNG sequence, one file per
 * frame of the whole trailer. Frames with nothing on them share one blank PNG (hard links), so
 * only the moments with copy cost a screenshot.
 *
 * Usage: node scripts/trailer/render-overlay.mjs [--out=artifacts/trailer] [--still=SECONDS]
 *   --still=12.6   render that one moment to DIR/overlay-still.png (for checking a card)
 */
/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved, no-await-in-loop, no-console */
import { execSync } from 'node:child_process';
import { linkSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAILER } from './trailer-config.mjs';
import { buildOverlayHtml } from './overlay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [key, ...value] = a.slice(2).split('=');
    return [key, value.join('=') || true];
}));
const OUT = path.resolve(ROOT, String(args.out || 'artifacts/trailer'));
const DIR = path.join(OUT, 'overlay');
const { fps, width, height } = TRAILER;

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch {
        const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
        return createRequire(path.join(root, '/'))('playwright');
    }
}

async function main() {
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(buildOverlayHtml(ROOT, TRAILER.overlay, { width, height }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const shoot = (t) => page.evaluate((time) => window.__overlay.render(time), t)
        .then(() => page.screenshot({ omitBackground: true, type: 'png' }));

    if (args.still !== undefined) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(path.join(OUT, 'overlay-still.png'), await shoot(Number(args.still)));
        await browser.close();
        return;
    }

    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const blank = path.join(DIR, 'blank.png');
    await page.evaluate(() => window.__overlay.render(-1));
    writeFileSync(blank, await page.screenshot({ omitBackground: true, type: 'png' }));
    const total = Math.ceil(TRAILER.duration * fps) + 1;
    let drawn = 0;
    for (let i = 0; i < total; i += 1) {
        const t = i / fps;
        const file = path.join(DIR, `${String(i).padStart(5, '0')}.png`);
        if (await page.evaluate((time) => window.__overlay.isBlank(time), t)) {
            linkSync(blank, file);
        } else {
            writeFileSync(file, await shoot(t));
            drawn += 1;
        }
        if (i % 300 === 299) console.log(`overlay ${i + 1}/${total} (${drawn} drawn)`);
    }
    await browser.close();
    console.log(`overlay → ${path.relative(ROOT, DIR)} (${total} frames, ${drawn} with copy)`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
