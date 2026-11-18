// Run with the repository's Electron binary. Output one JSON record per lane per repeat.
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

app.setPath('userData', mkdtempSync(join(tmpdir(), 'serenity-audit-renderer-')));

async function run() {
    const { deal, replay, spawn } = await import('./solo.mjs');
    const { PuzzleBotController } = await import('../../src/core/ai/puzzle-bot-controller.js');
    const { seededRandom } = await import('../../src/utils/helpers.js');
    const fixtures = [];
    for (let seed = 1001; seed <= 1006; seed++) {
        const s = deal(seed);
        const feeder = new PuzzleBotController({ difficulty: 10, playerState: s, actions: {},
            rng: seededRandom((seed ^ 0x85ebca6b) >>> 0) });
        for (let lock = 0; lock <= 32; lock++) {
            if ([0, 12, 32].includes(lock)) fixtures.push({ seed, lock, state: structuredClone({
                boardGrid: s.boardGrid, currentPiece: s.currentPiece, nextPieces: s.nextPieces,
                isAlive: true, piecesPlaced: s.piecesPlaced,
            }) });
            if (lock < 32) await replay(s, feeder.plan().actions, { spawnPiece: () => spawn(s) });
        }
        s.reset();
    }
    const bundle = buildSync({ entryPoints: [process.argv[3] || join(__dirname, 'timing.mjs')], bundle: true, format: 'iife',
        globalName: 'AuditTiming', platform: 'browser', write: false,
        define: { 'import.meta.env': '{}' }, logLevel: 'silent' }).outputFiles[0].text;
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await window.loadURL('about:blank');
    await window.webContents.executeJavaScript(bundle);
    const rows = [];
    for (let repeat = 0; repeat < 2; repeat++) {
        const lanes = await window.webContents.executeJavaScript('AuditTiming.sample(' + JSON.stringify(fixtures) + ',' + repeat + ')');
        for (const lane of lanes) rows.push({ repeat, ...lane });
    }
    writeFileSync(process.argv[2], JSON.stringify({ chromium: process.versions.chrome, electron: process.versions.electron,
        fixtures: fixtures.map(({ seed, lock }) => [seed, lock]), rows }), { flag: 'wx' });
    window.destroy();
}

app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
