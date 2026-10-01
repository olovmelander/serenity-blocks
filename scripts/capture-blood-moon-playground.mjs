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
app.setPath('userData', path.join(app.getPath('temp'), 'serenity-blood-moon-capture'));
async function run() {
    // Parse after app.ready so Electron's promise rejection handler always reports
    // malformed arguments instead of losing a top-level ESM exception on Windows.
    const output = path.resolve(arg('out', 'reports/blood-moon-overhaul/playground'));
    const url = arg('url', 'http://localhost:5173/playground.html?effect=blood-moon&t=8');
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
    console.log(`[Blood Moon capture] ${width}x${height}; times=${times.join(',') || 'default'}; ${url}`);
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
        console.error('Blood Moon capture timed out');
        app.exit(1);
    }, 60000 + times.length * 8000);
    try {
        await mkdir(output, { recursive: true });
        const evaluate = (source) => win.webContents.executeJavaScript(source, true);
        const loadAndSettle = async (captureUrl) => {
            await win.loadURL(captureUrl);
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
        const result = await evaluate(`({backend:window.__PLAYGROUND__.backend(),
        diagnostics:window.__PLAYGROUND__.diagnostics(),profile:window.__PLAYGROUND__.profile.snapshot()})`);
        await writeFile(path.join(output, 'capture.png'), (await win.webContents.capturePage()).toPNG());
        const captures = [];
        for (const time of times) {
            const phaseUrl = new URL(url);
            phaseUrl.searchParams.set('t', String(time));
            // Hidden Electron windows can suspend RAF or expose an old compositor
            // frame after seek(). Start each phase as a normal fixed-time capture.
            await loadAndSettle(phaseUrl.href);
            const diagnostics = await evaluate('window.__PLAYGROUND__.diagnostics()');
            const file = `time-${time}.png`;
            await writeFile(path.join(output, file), (await win.webContents.capturePage()).toPNG());
            captures.push({
                time, file, url: phaseUrl.href, diagnostics,
            });
            console.log(`[Blood Moon capture] Saved ${file}`);
        }
        const phases = captures.length ? { captures } : {};
        await writeFile(path.join(output, 'result.json'), JSON.stringify({
            url, width, height, ...result, ...phases, messages,
        }, null, 2));
        console.log(JSON.stringify({
            output, ...result, ...phases, messages,
        }));
        await evaluate('window.__PLAYGROUND__.renderer().setAnimationLoop(null)');
        win.destroy(); clearTimeout(deadline); app.exit(0);
    } catch (error) {
        console.error(error);
        console.error(JSON.stringify(messages));
        clearTimeout(deadline); win.destroy(); app.exit(1);
    }
}

app.whenReady().then(run).catch((error) => {
    console.error('[Blood Moon capture] Startup failed:', error?.stack || error);
    console.error('[Blood Moon capture] argv:', JSON.stringify(process.argv));
    app.exit(1);
});
