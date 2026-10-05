/**
 * Capture the breathing worlds through Electron from the playground (`?effect=breathing`).
 *
 * Usage (a Vite dev server must be running; pass every option as --key=value):
 *   node scripts/run-electron.mjs scripts/capture-breathing.mjs --baseUrl=http://127.0.0.1:5173 --posters
 *   node scripts/run-electron.mjs scripts/capture-breathing.mjs --baseUrl=... --sheet=pairs --out=artifacts/breathing
 *
 *   --posters          write public/assets/breathing/<id>.webp, the stills the Hub's cards show
 *   --sheet=pairs      every world empty and full, on contact sheets (default)
 *   --sheet=portrait   every world at 390x844 on the Low tier
 *   --sheet=webgl      every world on the WebGL2 backend
 *   --worlds=a,b       limit to these technique ids
 *   --igpu             ask for the integrated GPU instead of the discrete one
 *
 * One page renders every tile: the effect's window.__BREATH_LAB__ switches world and breath,
 * __PLAYGROUND__.seek() draws a deterministic frame, and the canvas is copied in the same task.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const { app, BrowserWindow, session } = electron;
const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.join('=') || true];
}));
app.commandLine.appendSwitch(args.igpu ? 'force_low_power_gpu' : 'force_high_performance_gpu');
// A hidden or occluded window runs requestAnimationFrame at a few hertz.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const ROOT = process.cwd();
const BASE = String(args.baseUrl || 'http://127.0.0.1:5173');
const OUT = path.resolve(ROOT, String(args.out || path.join('artifacts', 'breathing')));
const POSTER_DIR = path.join(ROOT, 'public', 'assets', 'breathing');
const WORLDS = [
    ['deep-relaxation', 'Aurora Dreams'], ['box-breathing', 'Sacred Geometry'], ['calm-sleep', 'Moonlit Waters'],
    ['energizing', 'Solar Flare'], ['coherence', 'Heart Glow'], ['triangle', 'Crystal Prism'],
    ['wim-hof', 'Volcanic Fire'], ['ocean-breath', 'Ocean Tide'], ['zen-garden', 'Zen Garden'],
    ['cosmic-breath', 'Cosmic Nebula'], ['forest-breath', 'Ancient Forest'], ['electric-storm', 'Electric Storm'],
].filter(([id]) => !args.worlds || String(args.worlds).split(',').includes(id));

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const withTimeout = (promise, ms, label) => Promise.race([
    promise, new Promise((_, reject) => { setTimeout(() => reject(new Error(`timeout: ${label}`)), ms); }),
]);

// Runs in the page. Returns one data URL per tile, or one contact sheet when `cols` is set.
const RENDER_TILES = `async (tiles, cols, tileWidth, type, quality) => {
    const source = document.querySelector('#stage canvas');
    const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const draw = async (tile) => {
        const lab = window.__BREATH_LAB__;
        lab.setWorld(tile.world);
        lab.setSession(tile.session || null);
        lab.setBreath({ breath: tile.breath, phase: tile.phase, progress: tile.progress });
        window.__PLAYGROUND__.seek(tile.t);
        await raf(); await raf();
        window.__PLAYGROUND__.seek(tile.t);
    };
    if (!cols) {
        const stills = [];
        for (const tile of tiles) {
            await draw(tile);
            stills.push(source.toDataURL(type, quality));
        }
        return stills;
    }
    const height = Math.round(tileWidth * source.height / source.width);
    const sheet = document.createElement('canvas');
    sheet.width = cols * tileWidth;
    sheet.height = Math.ceil(tiles.length / cols) * height;
    const context = sheet.getContext('2d');
    for (let i = 0; i < tiles.length; i++) {
        await draw(tiles[i]);
        const x = (i % cols) * tileWidth;
        const y = Math.floor(i / cols) * height;
        context.drawImage(source, x, y, tileWidth, height);
        context.font = '600 13px system-ui';
        context.fillStyle = 'rgba(0,0,0,.55)';
        context.fillRect(x, y, context.measureText(tiles[i].label).width + 14, 22);
        context.fillStyle = '#fff';
        context.fillText(tiles[i].label, x + 7, y + 15);
    }
    return [sheet.toDataURL(type, quality)];
}`;

const tile = (world, label, breath, phase = 0, progress = 0.8) => ({
    world, label, breath, phase, progress, t: 12,
});
const JOBS = {
    posters: {
        width: 720, height: 450, query: '', type: 'image/webp', quality: 0.8, tiles: WORLDS.map(([id, name]) => tile(id, name, 0.85)),
    },
    pairs: {
        width: 1280, height: 720, query: '', cols: 4, tileWidth: 480, tiles: WORLDS.flatMap(([id, name]) => [tile(id, `${name} · empty`, 0, 3, 0.5), tile(id, `${name} · full`, 1, 1, 0.5)]),
    },
    portrait: {
        width: 390, height: 844, query: '&focus=0.24&quality=Low', cols: 6, tileWidth: 300, tiles: WORLDS.map(([id, name]) => tile(id, name, 0.7)),
    },
    webgl: {
        width: 1280, height: 720, query: '&forceWebGL=1&quality=Medium', cols: 4, tileWidth: 480, tiles: WORLDS.map(([id, name]) => tile(id, name, 0.7)),
    },
};

async function run(name) {
    const job = JOBS[name];
    const win = new BrowserWindow({
        width: job.width,
        height: job.height,
        useContentSize: true,
        frame: false,
        show: false,
        webPreferences: { backgroundThrottling: false, partition: 'breathing-capture' },
    });
    win.showInactive();
    const problems = [];
    win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2 && !/vite\] failed to connect|Security Warning/.test(message)) problems.push(message.slice(0, 500));
    });
    const report = { name, problems };
    try {
        await withTimeout(win.loadURL(`${BASE}/playground.html?effect=breathing&orbit=0&hud=0&t=12&world=${job.tiles[0].world}&breath=0.5${job.query}`), 45000, 'load');
        const started = Date.now();
        for (;;) {
            const state = await withTimeout(win.webContents.executeJavaScript(
                '({ ready: window.__PLAYGROUND_READY__ === true, error: window.__PLAYGROUND_ERROR__ || null })',
            ), 8000, 'poll').catch(() => ({ ready: false, error: null }));
            if (state.error) throw new Error(String(state.error).slice(0, 800));
            if (state.ready) break;
            if (Date.now() - started > 60000) throw new Error('playground never became ready');
            await sleep(150);
        }
        report.backend = await win.webContents.executeJavaScript('window.__PLAYGROUND__.backend()');
        const type = job.type || 'image/jpeg';
        const images = await withTimeout(win.webContents.executeJavaScript(
            `(${RENDER_TILES})(${JSON.stringify(job.tiles)}, ${job.cols || 0}, ${job.tileWidth || 0}, '${type}', ${job.quality || 0.88})`,
        ), 180000, 'render');
        const bytes = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');
        if (job.cols) {
            await mkdir(OUT, { recursive: true });
            await writeFile(path.join(OUT, `breathing-${name}.jpg`), bytes(images[0]));
            report.files = [path.join(OUT, `breathing-${name}.jpg`)];
        } else {
            await mkdir(POSTER_DIR, { recursive: true });
            report.files = [];
            for (let i = 0; i < images.length; i++) {
                const file = path.join(POSTER_DIR, `${job.tiles[i].world}.webp`);
                await writeFile(file, bytes(images[i]));
                report.files.push(file);
            }
        }
        report.diagnostics = await win.webContents.executeJavaScript('window.__PLAYGROUND__.diagnostics()');
    } catch (error) {
        report.error = String(error?.message || error);
    } finally {
        win.destroy();
    }
    return report;
}

app.on('window-all-closed', () => { /* keep running between jobs */ });
app.whenReady().then(async () => {
    // A peer's save must not reload the page mid-capture.
    session.fromPartition('breathing-capture').webRequest.onBeforeRequest(
        { urls: [`${BASE.replace('http', 'ws')}/*`] },
        (_details, callback) => callback({ cancel: true }),
    );
    const names = [];
    if (args.posters) names.push('posters');
    if (args.sheet) names.push(...String(args.sheet).split(',').filter((name) => JOBS[name]));
    if (!names.length) names.push('pairs');
    const reports = [];
    for (const name of names) reports.push(await run(name));
    console.log(JSON.stringify(reports, null, 1));
    app.exit(reports.some((report) => report.error) ? 1 : 0);
});
