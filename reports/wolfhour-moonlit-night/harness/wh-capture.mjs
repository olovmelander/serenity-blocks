// Single-effect playground capture (Wolfhour). Settings come from env vars:
// CAP_URL, CAP_OUT, CAP_W, CAP_H, CAP_SETTLE. Writes <out>.png and <out>.log.
import { app, BrowserWindow } from 'electron';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const url = process.env.CAP_URL;
const out = process.env.CAP_OUT;
const width = Number(process.env.CAP_W || 1280);
const height = Number(process.env.CAP_H || 720);
const settle = Number(process.env.CAP_SETTLE || 600);
const logFile = `${out}.log`;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(logFile, `url ${url}\n`);
const log = (line) => appendFileSync(logFile, `${line}\n`);

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.setPath('userData', path.join(app.getPath('temp'), 'serenity-wolfhour-capture'));

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width,
        height,
        // Profiling only: a shown window (placed off screen) is not throttled to 1 fps.
        ...(process.env.CAP_SHOW === '1' ? { show: true, x: -6000, y: -6000 } : { show: false }),
        useContentSize: true,
        backgroundColor: '#000000',
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: false,
            sandbox: false,
            nodeIntegration: false,
            preload: path.join(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), 'wh-preload.cjs'),
        },
    });
    win.webContents.on('console-message', (event, level, message, line, source) => {
        const e = event?.message !== undefined ? event : null;
        log(`[console:${e ? e.level : level}] ${e ? e.message : message} (${e ? e.sourceId : source}:${e ? e.lineNumber : line})`);
    });
    win.webContents.on('render-process-gone', (_e, d) => log(`[gone] ${JSON.stringify(d)}`));
    try {
        await win.loadURL(url);
        const started = Date.now();
        let state = null;
        while (Date.now() - started < 90000) {
            state = await win.webContents.executeJavaScript(`({
                ready: window.__PLAYGROUND_READY__ === true,
                error: window.__PLAYGROUND_ERROR__ ? String(window.__PLAYGROUND_ERROR__) : null,
                backend: window.__PLAYGROUND__?.backend?.() || null,
            })`);
            if (state.error || state.ready) break;
            await wait(250);
        }
        log(`[state] ${JSON.stringify(state)}`);
        if (!state?.ready) throw new Error(`not ready: ${JSON.stringify(state)}`);
        await wait(settle);
        if (process.env.CAP_EVAL) {
            const value = await win.webContents.executeJavaScript(process.env.CAP_EVAL);
            log(`[eval] ${JSON.stringify(value)}`);
        }
        const rect = process.env.CAP_RECT ? process.env.CAP_RECT.split(',').map(Number) : null;
        const image = rect
            ? await win.webContents.capturePage({ x: rect[0], y: rect[1], width: rect[2], height: rect[3] })
            : await win.webContents.capturePage();
        writeFileSync(out, image.toPNG());
        log('[done]');
        win.destroy();
        app.quit();
    } catch (error) {
        log(`[fail] ${error?.stack || error}`);
        win.destroy();
        app.exit(1);
    }
});
