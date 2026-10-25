/* eslint-disable import/no-extraneous-dependencies */
// Writes the app mark everywhere it ships (scripts/app-icon/app-mark.mjs, docs/desktop-icons.md):
//   public/favicon.svg                                  the 16 px cut, crisp in a tab at 1x and 2x
//   public/assets/branding/serenity-blocks-app-icon.svg the 256 px master, for store and promo art
//   public/assets/branding/serenity-blocks.ico          every Windows size, read by scripts/build-win.mjs
// Run with: node scripts/generate-app-icon.mjs (the .ico is drawn in Electron's Chromium).
import {
    mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { APP_ICON_SIZES, appMarkSvg } from './app-icon/app-mark.mjs';
import { packIco, readPngSize } from './app-icon/ico.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const branding = path.join(root, 'public', 'assets', 'branding');

writeFileSync(path.join(root, 'public', 'favicon.svg'), appMarkSvg(16));
writeFileSync(path.join(branding, 'serenity-blocks-app-icon.svg'), appMarkSvg(256));

const work = mkdtempSync(path.join(tmpdir(), 'sb-app-icon-'));
try {
    const jobs = APP_ICON_SIZES.map((size) => ({ size, svg: appMarkSvg(size), out: path.join(work, `${size}.png`) }));
    const jobsFile = path.join(work, 'jobs.json');
    writeFileSync(jobsFile, JSON.stringify(jobs));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(electronPath, [path.join(root, 'scripts', 'app-icon', 'rasterize.cjs'), jobsFile], { stdio: 'inherit', env });
    if (run.status !== 0) throw new Error(`Electron rasterizer exited with ${run.status}`);
    const pngs = jobs.map((job) => {
        const png = readFileSync(job.out);
        const { width } = readPngSize(png);
        if (width !== job.size) throw new Error(`${job.size} px came out ${width} px wide`);
        return png;
    });
    writeFileSync(path.join(branding, 'serenity-blocks.ico'), packIco(pngs));
    console.log(`[app-icon] favicon.svg, serenity-blocks-app-icon.svg and serenity-blocks.ico (${APP_ICON_SIZES.join(', ')} px)`);
} finally {
    rmSync(work, { recursive: true, force: true });
}
