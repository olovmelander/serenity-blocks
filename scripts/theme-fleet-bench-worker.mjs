/**
 * Theme fleet bench, Electron worker: one theme, one fresh profile, one process.
 *
 * Run by scripts/theme-fleet-bench.mjs, never directly by a player. Usage:
 *   node scripts/run-electron.mjs scripts/theme-fleet-bench-worker.mjs --spec=<spec.json>
 * Every setting travels in the JSON spec: Electron exits silently on some URL arguments.
 *
 * The window is shown inactive and parked off-screen, at the display's size and scale factor, so
 * its frames run at full rate without covering the desktop. With `vsync: false` Chromium's vsync
 * and frame-rate limit are off, so the frame rate is what the machine can do, not the panel's.
 */
import { app, BrowserWindow, contentTracing } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { THEME_PERF_BOOTSTRAP } from './lib/theme-perf-instrument.mjs';
import {
    BENCH_BOOTSTRAP, buildLoadSource, buildStartSource, buildWindowSource,
} from './lib/theme-fleet-bench-page.mjs';

/** What --trace-load records: frames, the GPU process and its WebGPU work, the page's tasks. */
const TRACE_CATEGORIES = [
    'toplevel', 'benchmark', 'gpu', 'gpu.dawn', 'disabled-by-default-gpu.dawn', 'disabled-by-default-gpu.service',
    'disabled-by-default-gpu.device', 'viz', 'cc', 'blink', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.frame', 'v8.execute', 'mojom', 'ipc', 'skia', 'gpu.capture',
];
/** What --trace-gpu records: the GPU process's command handling and Dawn's pipeline work, nothing else. */
const TRACE_GPU_CATEGORIES = ['gpu', 'disabled-by-default-gpu.dawn'];

const specArg = process.argv.find((a) => a.startsWith('--spec='));
if (!specArg) {
    console.error('[bench-worker] missing --spec=<file>');
    process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specArg.slice('--spec='.length), 'utf8'));

app.setPath('userData', spec.userDataDir);
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-webgl');
if (spec.vsync === false) {
    app.commandLine.appendSwitch('disable-gpu-vsync');
    app.commandLine.appendSwitch('disable-frame-rate-limit');
}
if (spec.lowPowerGpu) app.commandLine.appendSwitch('force_low_power_gpu');
// Extra Chromium switches for A/B arms, e.g. { "disable-direct-composition": true }.
for (const [k, v] of Object.entries(spec.extraSwitches || {})) {
    if (v === true) app.commandLine.appendSwitch(k);
    else app.commandLine.appendSwitch(k, String(v));
}
if (spec.scaleFactor) app.commandLine.appendSwitch('force-device-scale-factor', String(spec.scaleFactor));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.on('window-all-closed', () => {});

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const t0Wall = Date.now();
let phaseNow = 'boot';
const log = (...a) => console.log(`[bench-worker ${spec.themeId}]`, ...a);

/** nvidia-smi at 200 ms while a window records; null when the tool is missing. */
function startGpuSampler() {
    if (spec.gpuSampler === false) return { stop: async () => null };
    const rows = [];
    let child;
    try {
        child = spawn('nvidia-smi', [
            '--query-gpu=utilization.gpu,clocks.gr,power.draw,temperature.gpu',
            '--format=csv,noheader,nounits', '-lms', '200',
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
        return { stop: async () => null };
    }
    child.on('error', () => {});
    let buf = '';
    child.stdout.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
            const v = line.split(',').map((x) => Number(x.trim()));
            if (v.length === 4 && v.every(Number.isFinite)) rows.push(v);
        }
    });
    return {
        stop: async () => {
            try { child.kill(); } catch { /* gone */ }
            if (!rows.length) return null;
            const mean = (i) => Number((rows.reduce((s, r) => s + r[i], 0) / rows.length).toFixed(1));
            return { n: rows.length, util: mean(0), clockMHz: mean(1), powerW: mean(2), tempC: mean(3) };
        },
    };
}

/** Per-process CPU % over the window (Electron's metrics are "since the last call"). */
function procCpuSnapshot() {
    const out = {};
    for (const m of app.getAppMetrics()) {
        const key = m.type === 'Tab' ? 'renderer' : m.type.toLowerCase();
        out[key] = Number(((out[key] || 0) + (m.cpu?.percentCPUUsage || 0)).toFixed(1));
    }
    return out;
}

async function main() {
    const cell = {
        themeId: spec.themeId, anchorTheme: spec.anchorTheme, quality: spec.quality,
        targetFps: spec.targetFps, vsync: spec.vsync !== false, startedAt: new Date().toISOString(),
        size: [spec.width, spec.height], scaleFactor: spec.scaleFactor || null, phases: {}, console: [],
        cores: os.cpus().length,
    };
    const writeCell = () => {
        fs.mkdirSync(path.dirname(spec.outPath), { recursive: true });
        fs.writeFileSync(spec.outPath, JSON.stringify(cell));
    };
    const hardTimer = setTimeout(() => {
        cell.error = cell.error || 'worker-hard-timeout';
        writeCell();
        app.exit(3);
    }, spec.hardTimeoutMs || 240_000);

    const win = new BrowserWindow({
        x: -spec.width - 600,
        y: 0,
        width: spec.width,
        height: spec.height,
        useContentSize: true,
        frame: false,
        show: false,
        backgroundColor: '#000000',
        webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win.webContents.on('console-message', (...args) => {
        const e = args[0];
        const level = e?.level ?? args[1];
        const message = e?.message ?? args[2];
        const isProblem = level === 'warning' || level === 'error' || level === 2 || level === 3;
        if (isProblem && cell.console.length < 200) {
            cell.console.push(`[${((Date.now() - t0Wall) / 1000).toFixed(1)}s ${phaseNow}] ${level}: ${String(message).slice(0, 400)}`);
        }
    });
    win.webContents.on('render-process-gone', (_e, d) => { cell.error = `render-process-gone:${d?.reason}`; });
    win.showInactive();
    // The debugger needs a live page target before it can take Page.* commands.
    await win.loadURL('about:blank');

    const dbg = win.webContents.debugger;
    dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        // --build-trace=1: the loads' first-time render-object builds (async-render-pipelines.js traceBuild).
        source: `${THEME_PERF_BOOTSTRAP};\n${BENCH_BOOTSTRAP}${spec.buildTrace ? ';\nwindow.__serenityBuildTrace = [];' : ''}`,
    });

    const exec = async (src, timeoutMs = 120_000) => {
        let timer;
        const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('exec-timeout')), timeoutMs); });
        try {
            return await Promise.race([win.webContents.executeJavaScript(src, true), timeout]);
        } finally { clearTimeout(timer); }
    };
    const windowPhase = async (name, kind, ms) => {
        phaseNow = name;
        const sampler = startGpuSampler();
        procCpuSnapshot();
        let profile = null;
        if (spec.profile && name === 'storm1') {
            await dbg.sendCommand('Profiler.enable');
            await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 200 });
            await dbg.sendCommand('Profiler.start');
        }
        const res = await exec(buildWindowSource({ kind, ms }), ms + 30_000);
        if (spec.profile && name === 'storm1') {
            profile = (await dbg.sendCommand('Profiler.stop')).profile;
            const p = spec.outPath.replace(/\.json$/, '.storm1.cpuprofile');
            fs.writeFileSync(p, JSON.stringify(profile));
        }
        res.procCpu = procCpuSnapshot();
        res.gpuUtil = await sampler.stop();
        cell.phases[name] = res;
        log(name, `${res.frameTimes?.length || 0} frames`);
    };
    const shot = async (suffix) => {
        if (!spec.shotDir) return;
        try {
            const img = await win.webContents.capturePage();
            fs.mkdirSync(spec.shotDir, { recursive: true });
            fs.writeFileSync(path.join(spec.shotDir, `${spec.themeId}.${suffix}.jpg`), img.toJPEG(82));
        } catch (e) { cell.console.push(`shot-failed:${e.message}`); }
    };

    try {
        const query = new URLSearchParams({ skipIntro: '1', unlockAll: '1', ...(spec.query || {}) });
        await win.loadURL(`${spec.baseUrl.replace(/\/$/, '')}/?${query.toString()}`);
        phaseNow = 'start';
        cell.phases.start = await exec(buildStartSource({
            quality: spec.quality, targetFps: spec.targetFps, anchorTheme: spec.anchorTheme,
            introWaitMs: spec.introWaitMs ?? 12_000,
        }));
        if (cell.phases.start?.error) throw new Error(cell.phases.start.error);
        log('start', JSON.stringify({ dpr: cell.phases.start.dpr, adapter: cell.phases.start.adapter, anchor: cell.phases.start.anchor }));

        phaseNow = 'load1';
        if (spec.profileLoad) {
            await dbg.sendCommand('Profiler.enable');
            await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 250 });
            await dbg.sendCommand('Profiler.start');
        }
        if (spec.buildTrace) await exec('window.__serenityBuildTrace = []; true');
        // --trace-load=1: a Chrome trace of every process (the GPU process included) over the first switch.
        // --trace-gpu=1: only the GPU process's WebGPU work (small), from the switch to the end of the storms.
        if (spec.traceLoad) await contentTracing.startRecording({ included_categories: TRACE_CATEGORIES, excluded_categories: ['*'] });
        else if (spec.traceGpu) await contentTracing.startRecording({ included_categories: TRACE_GPU_CATEGORIES, excluded_categories: ['*'] });
        cell.phases.load1 = await exec(buildLoadSource({ themeId: spec.themeId }), 90_000);
        if (spec.buildTrace) {
            const trace = await exec('JSON.stringify(window.__serenityBuildTrace || [])');
            fs.writeFileSync(spec.outPath.replace(/.json$/, '.load1.buildtrace.json'), trace);
        }
        if (spec.traceLoad) await contentTracing.stopRecording(spec.outPath.replace(/.json$/, '.load1.trace.json'));
        if (spec.profileLoad) {
            const { profile } = await dbg.sendCommand('Profiler.stop');
            fs.writeFileSync(spec.outPath.replace(/.json$/, '.load1.cpuprofile'), JSON.stringify(profile));
        }
        log('load1', JSON.stringify(cell.phases.load1.marks));
        await sleep(spec.settleMs ?? 3000);
        phaseNow = 'settled';
        if (spec.evalAfterLoad) {
            // An A/B arm or a probe without a code change: a snippet run in the page once the
            // theme is up; whatever it returns lands in the cell.
            cell.phases.evalAfterLoad = await exec(spec.evalAfterLoad, spec.evalTimeoutMs || 60_000);
            log('evalAfterLoad', JSON.stringify(cell.phases.evalAfterLoad)?.slice(0, 600));
            if (spec.exitAfterEval) throw new Error('exit-after-eval');
        }

        await windowPhase('rest', 'rest', spec.restMs ?? 6000);
        await shot('rest');
        if (spec.gpuWindow) await windowPhase('gpu', 'gpu', spec.gpuMs ?? 4000);
        await windowPhase('storm1', 'storm', spec.stormMs ?? 8000);
        await windowPhase('storm2', 'storm', spec.stormMs ?? 8000);
        if (spec.traceGpu && !spec.traceLoad) await contentTracing.stopRecording(spec.outPath.replace(/.json$/, '.gpu.trace.json'));
        await shot('storm');

        if (spec.secondVisit !== false) {
            phaseNow = 'to-anchor';
            await exec(buildLoadSource({ themeId: spec.anchorTheme }), 90_000);
            await sleep(2000);
            phaseNow = 'load2';
            if (spec.buildTrace) await exec('window.__serenityBuildTrace = []; true');
            cell.phases.load2 = await exec(buildLoadSource({ themeId: spec.themeId }), 90_000);
            if (spec.buildTrace) {
                const trace = await exec('JSON.stringify(window.__serenityBuildTrace || [])');
                fs.writeFileSync(spec.outPath.replace(/.json$/, '.load2.buildtrace.json'), trace);
            }
            log('load2', JSON.stringify(cell.phases.load2.marks));
        }
    } catch (e) {
        cell.error = cell.error || String(e?.message || e);
        log('error', cell.error);
    }
    cell.endedAt = new Date().toISOString();
    clearTimeout(hardTimer);
    writeCell();
    try { dbg.detach(); } catch { /* closed */ }
    win.destroy();
    app.exit(cell.error ? 1 : 0);
}

app.whenReady().then(main).catch((e) => {
    console.error('[bench-worker] fatal', e);
    try {
        fs.mkdirSync(path.dirname(spec.outPath), { recursive: true });
        fs.writeFileSync(spec.outPath, JSON.stringify({ themeId: spec.themeId, quality: spec.quality, error: `fatal:${e?.message || e}` }));
    } catch { /* best effort */ }
    app.exit(4);
    setTimeout(() => process.exit(4), 1000);
});
