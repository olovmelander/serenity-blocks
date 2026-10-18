/**
 * Photographs the game for the main menu's stage art (public/assets/menu-art/, see
 * docs/MENU_UI_OVERHAUL_2026-10.md §3.1). Each mode is played for real on a dev server,
 * staged by scripts/menu-art/stage.js (a generated stack, a tall Infinity tower, four bots,
 * the dev mock lobby), framed by scaling its board inside the world, cropped to 2.5 : 1 and
 * encoded as webp.
 *
 *   npm run dev -- --host 127.0.0.1 --port 5947 --strictPort
 *   node scripts/run-electron.mjs scripts/capture-menu-art.mjs --baseUrl=http://127.0.0.1:5947 [--only=single,serenity]
 *
 * Odyssey's pictures come from the chapter capture, then this script bakes them:
 *   node scripts/run-electron.mjs scripts/odyssey-chapter-capture.mjs --chapter=<n> --frames=6 --settle=2500 --port=5947
 *   node scripts/run-electron.mjs scripts/capture-menu-art.mjs --odyssey=artifacts/odyssey/wave-v [--only=odyssey-3]
 *
 * Other flags: --out=<dir> (default public/assets/menu-art), --png (keep the full captures),
 * --takes=<n> (n moments 4 s apart; the bots' boards differ every run, so choose a take),
 * --software (a lock-free dry run of the staging: SwiftShader WebGL2, Forest at Low; the
 * pictures are for checking, never for shipping).
 * Pass values as --key=value: Electron reads a bare URL argument as a page to open. Run it on
 * the dedicated GPU, one GPU job at a time; a theme rebuild is the time to retake its picture.
 */
import electron from 'electron';
import { existsSync, readdirSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const { app, BrowserWindow, nativeImage, session } = electron;

const args = {};
process.argv.slice(2).forEach((token) => {
    if (!token.startsWith('--')) return;
    const eq = token.indexOf('=');
    if (eq < 0) args[token.slice(2)] = true;
    else args[token.slice(2, eq)] = token.slice(eq + 1);
});

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, args.out || 'public/assets/menu-art');
const ONLY = args.only ? new Set(String(args.only).split(',')) : null;
const WIDTH = 1600;
const HEIGHT = 852; // fits a 900 px work area: windows are clamped to the screen
const ASPECT = 2.5;
const QUALITY = 0.86;
const PROFILE = path.join(os.tmpdir(), `serenity-menu-art-${process.pid}`);

/**
 * One photograph per mode. `frame` scales the board's stage inside its world (the theme
 * composes around the smaller board); `cropTop` is where the 2.5 : 1 crop starts, as a share of
 * the capture's height; `settleMs` runs from the staging to the shot.
 */
const SCENES = [
    {
        name: 'single', theme: 'waves', mode: 'single', stage: 'single', options: { seed: 9 }, settleMs: 10000,
        frame: '.single-player-stage { transform: translate(210px, -70px) scale(0.55) !important; }', cropTop: 0.176,
    },
    {
        name: 'infinity', theme: 'galaxy', mode: 'infinity', stage: 'infinity', options: { seed: 5 }, settleMs: 10000,
        frame: '.single-player-stage { transform: translate(230px, -70px) scale(0.55) !important; }', cropTop: 0.117,
    },
    {
        name: 'local-versus', theme: 'sakura-twilight', mode: 'local-multiplayer', stage: 'local', settleMs: 12000,
        frame: '#multiplayer-container { transform: translate(60px, -40px) scale(0.64) !important; }', cropTop: 0.082,
    },
    {
        name: 'online-versus', theme: 'rainbow-terraces', mode: 'online-multiplayer', stage: 'online', settleMs: 7000,
        frame: '#online-multiplayer-container { transform: translate(180px, -40px) scale(0.72) !important; }', cropTop: 0.07,
    },
    { name: 'serenity', theme: 'golden-forest', mode: 'serenity', settleMs: 15000, cropTop: 0.047 },
];

/** Odyssey: the chapter-capture station to use (its `local-NNNN` part) and where to crop it. */
const ODYSSEY = {
    1: { station: '0000', cropTop: 0.185 },
    2: { station: '0200', cropTop: 0.074 },
    3: { station: '0000', cropTop: 0.111 },
    4: { station: '0800', cropTop: 0.074 },
    5: { station: '0600', cropTop: 0.1 },
    6: { station: '0400', cropTop: 0.074 },
    7: { station: '0000', cropTop: 0.05 },
    8: { station: '0800', cropTop: 0.074 },
};

const SOFTWARE = Boolean(args.software);

app.setPath('userData', PROFILE);
if (SOFTWARE) {
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
} else {
    app.commandLine.appendSwitch('force_high_performance_gpu');
}
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disk-cache-size', '1');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => { setTimeout(() => reject(new Error(`timeout: ${label}`)), ms); }),
]);

let win = null;
const report = [];
const js = (code, ms = 15000, label = 'eval') => withTimeout(win.webContents.executeJavaScript(code), ms, label);
/** Calls an export of scripts/menu-art/stage.js in the page. */
const stage = (fn, options = {}) => js(`import('/scripts/menu-art/stage.js').then((s) => s.${fn}(${JSON.stringify(options)}))`, 45000, fn);

async function waitFor(code, ms, label) {
    const started = Date.now();
    while (Date.now() - started < ms) {
        if (await js(code, 8000, label).catch(() => false)) return true;
        await delay(250);
    }
    throw new Error(`never: ${label}`);
}

const startMode = (mode) => js(`window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: '${mode}' } })); true`);
const modeRunning = (mode) => waitFor(`(() => { const gm = window.serenityBlocks?.gameModeManager;
    return gm?.getCurrentModeId?.() === '${mode}' && Boolean(gm.getCurrentMode()?.gameState?.currentPiece); })()`, 30000, `mode ${mode}`);
const themeRunning = (theme) => waitFor(`(() => { const t = window.serenityBlocks?.themeManager?.activeTheme;
    return t?.name === '${theme}' && t?.lifecycleState === 'running'; })()`, 30000, `theme ${theme}`);
const pinTheme = (theme) => js(`window.settingsManager.update({ backgroundMode: 'Specific', backgroundTheme: '${theme}',
    effectQuality: '${SOFTWARE ? 'Low' : 'Ultra'}' }); true`);

/** How each mode starts, and what is staged once its theme runs. */
const STAGES = {
    async single(scene) {
        await startMode('single');
        await modeRunning('single');
        return () => stage('stageSingle', scene.options);
    },
    async infinity(scene) {
        await startMode('infinity');
        await modeRunning('infinity');
        return () => stage('stageInfinity', scene.options);
    },
    async local(scene) {
        await startMode('local-multiplayer');
        await waitFor(`(() => { const gm = window.serenityBlocks.gameModeManager;
            return gm.getCurrentModeId() === 'local-multiplayer' && Boolean(gm.getCurrentMode()?.configModal); })()`, 30000, 'local setup');
        await stage('startLocalBots', scene.options);
        // The match opens with a cover and a countdown; the bots play once pieces spawn.
        return async () => {
            await waitFor(`(() => { const m = window.serenityBlocks.gameModeManager.getCurrentMode();
                const players = m?.multiplayerState?.players || [];
                return !m.matchStartLoadingOverlay && players.length > 0 && players.every((p) => p?.currentPiece); })()`, 90000, 'local countdown');
            await delay(1500);
            return stage('stageLocal', scene.options);
        };
    },
    async online(scene) {
        await stage('startOnlineMock', scene.options);
        return async () => { await delay(6000); return stage('stageOnline', scene.options); };
    },
    async plain(scene) {
        await startMode(scene.mode);
        return null;
    },
};

/** Chromium encodes webp; Electron's nativeImage does not. Runs in whatever page is open. */
const ENCODE_WEBP = `async (url, quality) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', quality);
}`;

/** The 2.5 : 1 band of a capture, from `cropTop` down, written as webp. */
async function bake(image, cropTop, name) {
    const { width, height } = image.getSize();
    const cropHeight = Math.round(width / ASPECT);
    const y = Math.max(0, Math.min(height - cropHeight, Math.round(cropTop * height)));
    const band = image.crop({ x: 0, y, width, height: cropHeight });
    const webp = await js(`(${ENCODE_WEBP})(${JSON.stringify(band.toDataURL())}, ${QUALITY})`, 30000, 'encode');
    const bytes = Buffer.from(webp.split(',')[1], 'base64');
    await writeFile(path.join(OUT, `${name}.webp`), bytes);
    return { width, height: cropHeight, kb: Math.round(bytes.length / 1024) };
}

function openWindow() {
    win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        useContentSize: true,
        frame: false,
        resizable: false,
        show: false,
        backgroundColor: '#000000',
        // No preload: without window.electronAPI the online mode uses its mock transport.
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // A hidden window draws a few frames a second; shown inactive it runs at full rate.
    win.showInactive();
}

async function openGame() {
    openWindow();
    const errors = [];
    win.webContents.on('console-message', (event) => {
        if (event.level === 'error' && !/websocket/i.test(event.message)) errors.push(event.message.slice(0, 300));
    });
    await withTimeout(win.loadURL(`${args.baseUrl}/?skipIntro=1&unlockAll=1${SOFTWARE ? '&forceWebGL=1' : ''}`), 90000, 'load');
    await waitFor('Boolean(window.serenityBlocks?.gameModeManager && window.settingsManager && window.serenityBlocks?.themeManager)', 90000, 'boot');
    return errors;
}

async function captureScene(sceneSpec) {
    const scene = SOFTWARE ? { ...sceneSpec, theme: 'forest' } : sceneSpec;
    const entry = { name: scene.name, theme: scene.theme };
    report.push(entry);
    const errors = await openGame();
    try {
        await stage('prepare');
        await pinTheme(scene.theme);
        await delay(400);
        const arrange = await STAGES[scene.stage || 'plain'](scene);
        await themeRunning(scene.theme).catch(async () => {
            // The boot's own theme load can land after the pin: pin again.
            await pinTheme(scene.theme);
            await themeRunning(scene.theme);
        });
        if (arrange) entry.staged = await arrange();
        await stage('frame', scene.frame || '');
        await delay(scene.settleMs);
        entry.adapter = await js(`(() => { const i = window.serenityBlocks.themeManager.activeTheme?.renderer?.backend?.device?.adapterInfo;
            return i ? i.vendor + ' ' + i.architecture : 'webgl2'; })()`).catch(() => null);
        // Bots and worlds move: --takes=<n> shoots n moments 4 s apart (<name>.take2.webp, ...) to choose from.
        const takes = Math.max(1, Number(args.takes) || 1);
        entry.files = [];
        for (let take = 1; take <= takes; take += 1) {
            if (take > 1) await delay(4000);
            for (let i = 0; i < 3; i += 1) await js('new Promise((r) => requestAnimationFrame(() => r(true)))', 2000, 'frame');
            const image = await withTimeout(win.webContents.capturePage(), 15000, 'capture');
            const name = take === 1 ? scene.name : `${scene.name}.take${take}`;
            if (args.png) await writeFile(path.join(OUT, `${name}.capture.png`), image.toPNG());
            entry.files.push(await bake(image, scene.cropTop, name));
        }
    } catch (error) {
        entry.error = String(error?.message || error);
    }
    entry.errors = errors.slice(0, 8);
    win.destroy();
    await delay(500);
}

/** Odyssey: bakes `odyssey-<n>.webp` from scripts/odyssey-chapter-capture.mjs stations. */
async function bakeOdyssey(dir) {
    openWindow();
    await win.loadURL('data:text/html,<!doctype html><title>menu art</title>');
    for (const [chapter, pick] of Object.entries(ODYSSEY)) {
        const name = `odyssey-${chapter}`;
        if (ONLY && !ONLY.has(name)) continue;
        const entry = { name };
        report.push(entry);
        const folder = path.join(dir, `chapter-${String(chapter).padStart(2, '0')}-high-webgpu`);
        const file = existsSync(folder) && readdirSync(folder).find((f) => f.endsWith(`-local-${pick.station}.png`));
        if (!file) {
            entry.error = `no station ${pick.station} in ${folder}`;
            continue;
        }
        entry.source = file;
        entry.file = await bake(nativeImage.createFromBuffer(await readFile(path.join(folder, file))), pick.cropTop, name);
    }
    win.destroy();
}

async function run() {
    await mkdir(OUT, { recursive: true });
    if (args.odyssey) {
        await bakeOdyssey(path.resolve(ROOT, args.odyssey));
        return;
    }
    if (!args.baseUrl) throw new Error('Pass --baseUrl=http://127.0.0.1:<port> (a dev server: the staging imports /src modules)');
    const port = new URL(args.baseUrl).port;
    // A file saved during the run would reload the page under the staging.
    session.defaultSession.webRequest.onBeforeRequest({ urls: [`ws://127.0.0.1:${port}/*`] }, (_d, cb) => cb({ cancel: true }));
    for (const scene of SCENES) {
        if (!ONLY || ONLY.has(scene.name)) await captureScene(scene);
    }
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => app.exit(3), 12 * 60 * 1000);
    let code = 0;
    try {
        await run();
    } catch (error) {
        report.push({ fatal: String(error?.message || error) });
    }
    report.forEach((entry) => {
        if (entry.error || entry.fatal) code = 1;
        console.log(`[menu-art] ${JSON.stringify(entry)}`);
    });
    clearTimeout(watchdog);
    await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
    app.exit(code);
});
