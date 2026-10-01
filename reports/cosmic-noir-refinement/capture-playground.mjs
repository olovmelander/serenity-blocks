/**
 * Bounded, single-effect Electron capture when the browser MCP profile is occupied.
 * --times 0,4,8,16 adds independent fixed-time page captures of this one effect.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const flag = `--${name}`;
    const inline = args.find((value) => value.startsWith(`${flag}=`));
    if (inline !== undefined) return inline.slice(flag.length + 1);
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return value;
};
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', path.join(app.getPath('temp'), 'serenity-cosmic-noir-playground-capture'));
app.on('window-all-closed', (event) => event.preventDefault());

async function bounded(operation, label, timeoutMs = 5000) {
    let timer;
    try {
        return await Promise.race([
            operation,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function drainPlayground() {
    // Vite may replace the document while a screenshot is being saved. The API is
    // not guaranteed to exist during terminal shutdown, and window.renderer is the
    // playground's documented fallback after its first rendered frame.
    const playground = window.__PLAYGROUND__;
    const renderer = playground?.renderer?.() ?? window.renderer;
    playground?.pause?.(true);
    if (!renderer) return { stopped: true, rendererPresent: false };
    renderer.setAnimationLoop?.(null);
    if (renderer.backend) renderer.backend.trackTimestamp = false;
    const queue = renderer.backend?.device?.queue;
    if (queue?.onSubmittedWorkDone) {
        let timer;
        try {
            await Promise.race([
                queue.onSubmittedWorkDone(),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('GPU queue drain timed out')), 3000);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
    return { stopped: true, rendererPresent: true, gpuDrained: Boolean(queue) };
}

async function run() {
    // Parse after app.ready so Electron's promise rejection handler always reports
    // malformed arguments instead of losing a top-level ESM exception on Windows.
    const output = path.resolve(arg('out', 'reports/cosmic-noir-refinement/playground'));
    const url = arg('url', 'http://localhost:5173/playground.html?effect=cosmic-noir&t=12');
    const width = Number(arg('width', 1280));
    const height = Number(arg('height', 800));
    const timesArgument = arg('times', null);
    const times = timesArgument === null ? [] : timesArgument.split(',').map((value) => Number(value.trim()));
    if (times.length > 16 || times.some((time) => !Number.isFinite(time) || time < 0)
        || (timesArgument !== null && timesArgument.split(',').some((value) => !value.trim()))) {
        throw new Error('--times expects 1–16 comma-separated, finite, nonnegative seconds.');
    }
    if (![width, height].every((value) => Number.isInteger(value) && value > 0)) {
        throw new Error('--width and --height must be positive integer pixel dimensions.');
    }
    console.log(`[Cosmic Noir playground] ${width}x${height}; times=${times.join(',') || 'default'}; ${url}`);
    const win = new BrowserWindow({
        width,
        height,
        show: false,
        useContentSize: true,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    const messages = [];
    win.webContents.on('console-message', (event) => {
        if (event.level === 'warning' || event.level === 'error') {
            messages.push({ level: event.level, message: event.message });
        }
    });
    const deadline = setTimeout(() => {
        console.error('Cosmic Noir playground capture timed out');
        app.exit(1);
    }, 60000 + times.length * 8000);
    const evaluate = (source) => bounded(win.webContents.executeJavaScript(source, true), 'Page evaluation', 10000);
    let result = {};
    const captures = [];
    let failure = null;
    let shutdown = null;
    try {
        await mkdir(output, { recursive: true });
        const loadAndSettle = async (captureUrl) => {
            console.log(`[Cosmic Noir playground] Loading ${captureUrl}`);
            await bounded(win.loadURL(captureUrl), 'Page load', 30000);
            for (let attempt = 0; attempt < 160; attempt += 1) {
                const consoleError = messages.find((entry) => entry.level === 'error');
                if (consoleError) throw new Error(consoleError.message);
                const state = await evaluate(`({ready:window.__PLAYGROUND_READY__,error:window.__PLAYGROUND_ERROR__,
                    loaded:window.__PLAYGROUND__?.diagnostics()?.loaded})`);
                if (state.error) throw new Error(state.error);
                if (state.ready && state.loaded !== false) break;
                if (attempt === 159) throw new Error('Playground never became ready');
                await new Promise((resolve) => { setTimeout(resolve, 200); });
            }
            await evaluate(`document.querySelectorAll('#hud, .hud, #drop-hint').forEach(e => e.style.display='none');
                window.__PLAYGROUND__.profile.reset();`);
            await new Promise((resolve) => { setTimeout(resolve, 4500); });
            const consoleError = messages.find((entry) => entry.level === 'error');
            if (consoleError) throw new Error(consoleError.message);
        };
        await loadAndSettle(url);
        result = await evaluate(`({backend:window.__PLAYGROUND__.backend(),
        diagnostics:window.__PLAYGROUND__.diagnostics(),profile:window.__PLAYGROUND__.profile.snapshot()})`);
        // Stop submissions before capture, while the proven ready document is still
        // present. Fixed-time content remains in the compositor for capturePage().
        await evaluate(`(${drainPlayground.toString()})()`);
        await writeFile(path.join(output, 'capture.png'), (await win.webContents.capturePage()).toPNG());
        for (const time of times) {
            const phaseUrl = new URL(url);
            phaseUrl.searchParams.set('t', String(time));
            // Hidden Electron windows can suspend RAF or expose an old compositor
            // frame after seek(). Start each phase as a normal fixed-time capture.
            await loadAndSettle(phaseUrl.href);
            const diagnostics = await evaluate('window.__PLAYGROUND__.diagnostics()');
            await evaluate(`(${drainPlayground.toString()})()`);
            const file = `time-${time}.png`;
            await writeFile(path.join(output, file), (await win.webContents.capturePage()).toPNG());
            captures.push({
                time, file, url: phaseUrl.href, diagnostics,
            });
            console.log(`[Cosmic Noir playground] Saved ${file}`);
        }
    } catch (error) {
        failure = error.stack || String(error);
        console.error(failure);
    } finally {
        try {
            console.log('[Cosmic Noir playground] Draining and unloading the capture page');
            shutdown = await evaluate(`(${drainPlayground.toString()})()`);
            // The playground does not expose its effect disposer or the unsubscribe
            // returned by the device-loss monitor. Unload after draining rather than
            // destroying its device explicitly (which would report an intentional
            // dispose as a TDR). This retires the whole isolated document and its GPU
            // ownership before BrowserWindow teardown.
            await bounded(win.loadURL('about:blank'), 'Playground unload', 5000);
            await new Promise((resolve) => { setTimeout(resolve, 150); });
        } catch (error) {
            shutdown = { stopped: false, error: error.stack || String(error) };
            failure ??= shutdown.error;
        }
        const phases = captures.length ? { captures } : {};
        const errors = messages.filter((entry) => entry.level === 'error');
        const ok = !failure && errors.length === 0;
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, 'result.json'), JSON.stringify({
            ok, url, width, height, ...result, ...phases, messages, shutdown, error: failure,
        }, null, 2));
        console.log(JSON.stringify({
            output, ok, backend: result.backend, captures: captures.length, shutdown,
        }));
        clearTimeout(deadline);
        if (!win.isDestroyed()) win.destroy();
        app.exit(ok ? 0 : 1);
    }
}

app.whenReady().then(run).catch((error) => {
    console.error('[Cosmic Noir playground] Startup failed:', error?.stack || error);
    console.error('[Cosmic Noir playground] argv:', JSON.stringify(process.argv));
    app.exit(1);
});
