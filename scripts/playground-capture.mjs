/**
 * Screenshot a single WebGPU playground effect through Electron.
 *
 * Usage:
 *   node scripts/run-electron.mjs scripts/playground-capture.mjs \
 *     --url "/playground.html?effect=mountain-range&t=8" --out artifacts/playground/mountain-range.png
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const { app, BrowserWindow } = electron;
const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl || 'http://127.0.0.1:5173';
const TARGET_URL = resolveTargetUrl(args.url || '/playground.html');
const OUT = path.resolve(ROOT, args.out || path.join('artifacts', 'playground', 'capture.png'));
const WIDTH = Math.max(320, Number.parseInt(args.width || '1280', 10));
const HEIGHT = Math.max(240, Number.parseInt(args.height || '720', 10));
const TIMEOUT_MS = Math.max(1000, Number.parseInt(args.timeout || '60000', 10));
const SETTLE_MS = Math.max(0, Number.parseInt(args.settle || '350', 10));
const SHOW_WINDOW = args.show || process.env.PLAYGROUND_CAPTURE_SHOW === '1';
const consoleLines = [];

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const [key, inlineValue] = token.slice(2).split('=', 2);
        const next = argv[index + 1];
        if (inlineValue !== undefined) {
            result[key] = inlineValue;
        } else if (next && !next.startsWith('--')) {
            result[key] = next;
            index += 1;
        } else {
            result[key] = true;
        }
    }
    return result;
}

function resolveTargetUrl(raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    return new URL(raw, BASE_URL).toString();
}

function createWindow() {
    return new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: SHOW_WINDOW,
        backgroundColor: '#000000',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
}

async function waitForPlaygroundReady(win) {
    const started = Date.now();
    while (Date.now() - started < TIMEOUT_MS) {
        const state = await win.webContents.executeJavaScript(`(() => ({
            ready: window.__PLAYGROUND_READY__ === true,
            error: window.__PLAYGROUND_ERROR__ || null,
            backend: window.__PLAYGROUND__?.backend?.() || null,
            title: document.title,
            canvasCount: document.querySelectorAll('canvas').length,
        }))()`);
        if (state.error) throw new Error(`Playground error: ${state.error}`);
        if (state.ready) return state;
        await new Promise((resolve) => {
            setTimeout(resolve, 250);
        });
    }
    throw new Error(`Timed out waiting for window.__PLAYGROUND_READY__ at ${TARGET_URL}`);
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function run() {
    await mkdir(path.dirname(OUT), { recursive: true });
    const win = createWindow();
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        consoleLines.push(`[renderer:${level}] ${sourceId}:${line} ${message}`);
    });

    await win.loadURL(TARGET_URL);
    const state = await waitForPlaygroundReady(win);
    if (SETTLE_MS > 0) await delay(SETTLE_MS);
    const image = await win.webContents.capturePage();
    await writeFile(OUT, image.toPNG());
    await writeFile(`${OUT}.json`, JSON.stringify({
        url: TARGET_URL,
        width: WIDTH,
        height: HEIGHT,
        state,
        timestamp: new Date().toISOString(),
    }, null, 2), 'utf8');
    await writeFile(`${OUT}.console.log`, consoleLines.slice(-300).join('\n'), 'utf8');
    win.destroy();
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
    try {
        await run();
        app.quit();
    } catch (error) {
        console.error('[playground-capture] FAILED:', error?.message || error);
        if (consoleLines.length) console.error(consoleLines.slice(-30).join('\n'));
        app.exit(1);
    }
});

app.on('window-all-closed', () => app.quit());
