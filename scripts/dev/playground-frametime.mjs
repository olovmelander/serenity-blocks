/**
 * Measure GPU time per frame for a playground effect through Electron.
 *
 * Two traps this exists to avoid:
 *
 * 1. The screenshot harness (scripts/playground-capture.mjs) creates its
 *    BrowserWindow with `show: false` unless `--show` is passed, and a hidden
 *    window has requestAnimationFrame throttled to roughly 1 Hz. Any "1 fps"
 *    reading taken through that path is the throttle, not the scene.
 * 2. Wall-clock rAF deltas measure CPU scheduling as much as rendering. With any
 *    other load on the machine they are worthless for A/B: an early run of this
 *    script produced a cheaper configuration reading SLOWER than a more expensive
 *    one, twice, because background work moved more than the effect did.
 *
 * So this drives the playground's own bounded profiler (`?profile=1&trackTimestamp=1`,
 * `__PLAYGROUND__.profile`), which drains WebGPU timestamp queries. `gpuMs` is
 * measured on the device and is immune to host contention. `frameMs` is reported
 * alongside it precisely so the two can be compared — if they disagree, the host
 * was busy and only `gpuMs` should be believed.
 *
 * Usage:
 *   node scripts/run-electron.mjs scripts/dev/playground-frametime.mjs \
 *     --url "/playground.html?effect=stillwater-masterpiece&quality=High" \
 *     --label shipped --repeats 3
 *
 * Emits one `FRAMETIME <json>` line per repeat, so callers can grep it out of
 * Electron's own noise.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';

const { app, BrowserWindow } = electron;
const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.baseUrl || 'http://127.0.0.1:5173';
const TARGET_URL = resolveTargetUrl(args.url || '/playground.html');
const WIDTH = Math.max(320, Number.parseInt(args.width || '1600', 10));
const HEIGHT = Math.max(240, Number.parseInt(args.height || '1000', 10));
const READY_TIMEOUT_MS = Math.max(1000, Number.parseInt(args.timeout || '180000', 10));
// Pipelines compile on the first frames that touch them; sampling through that
// measures the shader compiler, not the frame.
const WARMUP_MS = Math.max(0, Number.parseInt(args.warmup || '12000', 10));
const SAMPLE_MS = Math.max(1000, Number.parseInt(args.sample || '8000', 10));
const REPEATS = Math.max(1, Number.parseInt(args.repeats || '3', 10));
const LABEL = args.label || 'run';

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;
        const option = token.slice(2);
        const separator = option.indexOf('=');
        const key = separator >= 0 ? option.slice(0, separator) : option;
        const inlineValue = separator >= 0 ? option.slice(separator + 1) : undefined;
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

/** Force the profiler on regardless of what the caller put in --url. */
function resolveTargetUrl(raw) {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw, BASE_URL);
    url.searchParams.set('profile', '1');
    url.searchParams.set('trackTimestamp', '1');
    url.searchParams.set('hud', '0');
    return url.toString();
}

async function waitForReady(win) {
    const started = Date.now();
    while (Date.now() - started < READY_TIMEOUT_MS) {
        const state = await win.webContents.executeJavaScript(`(() => ({
            ready: window.__PLAYGROUND_READY__ === true,
            error: window.__PLAYGROUND_ERROR__ || null,
            backend: window.__PLAYGROUND__?.backend?.() || null,
        }))()`);
        if (state.error) throw new Error(`Playground error: ${state.error}`);
        if (state.ready) return state;
        await new Promise((resolve) => { setTimeout(resolve, 250); });
    }
    throw new Error(`Timed out waiting for playground ready: ${TARGET_URL}`);
}

/** Keep rAF pumping in the page for `ms`, resolving when the window elapses. */
const RUN_FOR = (ms) => `new Promise((resolve) => {
    const deadline = performance.now() + ${ms};
    const tick = (now) => { if (now < deadline) requestAnimationFrame(tick); else resolve(true); };
    requestAnimationFrame(tick);
})`;

async function main() {
    const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        // Visible and un-throttled, or the numbers are meaningless.
        show: true,
        backgroundColor: '#000000',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });

    try {
        await win.loadURL(TARGET_URL);
        const state = await waitForReady(win);
        if (WARMUP_MS > 0) await win.webContents.executeJavaScript(RUN_FOR(WARMUP_MS));

        for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
            await win.webContents.executeJavaScript('window.__PLAYGROUND__.profile.reset(), true');
            await win.webContents.executeJavaScript(RUN_FOR(SAMPLE_MS));
            const snapshot = await win.webContents.executeJavaScript(
                'window.__PLAYGROUND__.profile.snapshot()',
            );
            process.stdout.write(`FRAMETIME ${JSON.stringify({
                label: LABEL,
                repeat,
                backend: state.backend,
                gpuStatus: snapshot?.gpuTimestamp?.renderStatus ?? null,
                gpuError: snapshot?.gpuTimestamp?.error ?? null,
                gpuMs: snapshot?.gpuMs ?? null,
                frameMs: snapshot?.frameMs ?? null,
                cpuMs: snapshot?.cpuMs ?? null,
                internal: snapshot?.internalResolution
                    ? `${snapshot.internalResolution.width}x${snapshot.internalResolution.height}`
                    : null,
            })}\n`);
        }
    } finally {
        win.destroy();
    }
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('force_high_performance_gpu');

app.whenReady().then(async () => {
    let code = 0;
    try {
        await main();
    } catch (error) {
        process.stderr.write(`frametime failed: ${error?.stack || error}\n`);
        code = 1;
    }
    app.exit(code);
});
