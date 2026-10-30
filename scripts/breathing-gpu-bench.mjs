/**
 * GPU and CPU frame cost of the breathing worlds on real hardware (ADR-0016's rules).
 *
 * Electron, on the discrete GPU, loads the playground's breathing host (the shipping host and
 * worlds) at the size the game's stage draws each tier (`stage=1`) with the stage's renderer
 * settings (`antialias=0`), pins the content of every reading (clock `t`, breath, phase, mood,
 * visit seed) and records:
 *   - GPU ms per frame: every frame of every resolved timestamp batch, each frame once. three's
 *     query pool keeps every pass of every frame since its last resolve; the bench sums a frame's
 *     passes (three's own definition of a frame's GPU time). Beside it, the playground's own
 *     reference sample (one per resolved query: the last frame of each batch), as a check.
 *   - GPU ms per pass group (scene, bloom, shafts, output; `direct` on the tier with no lens), as
 *     means over the same frames: timestamps land on a coarse grid, and a mean over many frames
 *     is unbiased where a single pass is one or two steps long.
 *   - CPU ms per frame (the playground's frame callback) and frame intervals.
 *   - draw calls, triangles and render calls per frame, and the drawing-buffer size: all must stay
 *     constant through a reading (otherwise it is void), and runs compared must match exactly.
 *   - nvidia-smi through the window: power, graphics clock, utilisation, P-state.
 * Before each page the GPU must be idle (a blank page, utilisation sampled): a busy GPU is
 * recorded and the page's readings are void. So is a reading whose window size moved.
 *
 * Usage (a Vite dev server must serve the checkout; all settings in a JSON spec file, because
 * Electron drops arguments that carry & or |):
 *   node scripts/run-electron.mjs scripts/breathing-gpu-bench.mjs --spec=path/to/spec.json
 *
 * Spec fields (defaults in DEFAULTS below): baseUrl, out (a .json file), dsf (device scale factor,
 * null keeps the display's), width/height (CSS pixels of the window's content), tiers, worlds,
 * moods (indices), seed, t, lungs ([{name, breath, phase, progress}]), warmMs, windowMs, repeats,
 * maxFps (0: the display's rate), tierMaxFps ({tier: fps}, e.g. the stage's 30 for Low and
 * Minimal), tierWindowMs ({tier: ms}: a 30 fps tier needs a longer window for as many frames),
 * vsync (false: uncapped, see below), variants ([{name, query}]: versions of every page, e.g. a
 * part left out), igpu, userData (the Electron profile: its GPU shader cache), extraQuery.
 *
 * Read the output with --summary=<out.json> (no Electron needed): one row per reading, whether the
 * repeats agree (scripts/lib/breathing-bench-summary.mjs), and the pass split.
 * Record of the measurements: docs/BREATHING_PERF_PASS_2026-10.md ("Measured on hardware").
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop, no-console */
import { execFileSync, spawn } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { printSummary, summarise } from './lib/breathing-bench-summary.mjs';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith('--')).map((arg) => {
    const [key, ...value] = arg.slice(2).split('=');
    return [key, value.join('=') || true];
}));

export const WORLD_IDS = ['deep-relaxation', 'box-breathing', 'calm-sleep', 'energizing', 'coherence', 'triangle',
    'wim-hof', 'ocean-breath', 'zen-garden', 'cosmic-breath', 'forest-breath', 'electric-storm'];

const DEFAULTS = {
    baseUrl: 'http://127.0.0.1:5173',
    out: 'artifacts/breathing-gpu/bench.json',
    dsf: null,
    width: 1280,
    height: 720,
    tiers: ['High'],
    worlds: WORLD_IDS,
    moods: [0],
    seed: 0.5,
    t: 12,
    lungs: [
        {
            name: 'empty', breath: 0, phase: 3, progress: 0.5,
        },
        {
            name: 'mid', breath: 0.5, phase: 0, progress: 0.5,
        },
        {
            name: 'full', breath: 1, phase: 1, progress: 0.5,
        },
    ],
    warmMs: 1500,
    windowMs: 4000,
    repeats: 2,
    maxFps: 0,
    tierMaxFps: null,
    tierWindowMs: null,
    vsync: true,
    variants: [{ name: 'base', query: '' }],
    igpu: false,
    userData: null,
    extraQuery: '',
};

if (args.summary) {
    const data = JSON.parse(await readFile(String(args.summary), 'utf8'));
    printSummary(String(args.summary), summarise(data.readings));
    process.exit(0);
}

// ---------- measuring (Electron main process) ----------

const { default: electron } = await import('electron');
const { app, BrowserWindow, session } = electron;
const spec = { ...DEFAULTS, ...JSON.parse(await readFile(String(args.spec), 'utf8')) };

app.commandLine.appendSwitch(spec.igpu ? 'force_low_power_gpu' : 'force_high_performance_gpu');
// A hidden or occluded window runs requestAnimationFrame at a few hertz.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (spec.dsf) app.commandLine.appendSwitch('force-device-scale-factor', String(spec.dsf));
// vsync: false draws frames back to back, as the theme fleet bench does (THEME_FLEET_240_2026-10.md).
// At the display's rate these worlds are a light load and the driver moves the GPU between power
// states inside a reading, so a world's GPU ms follows the clock more than the shader. Uncapped,
// the GPU runs flat out at its power limit: a steady clock, to rank worlds and to A/B a change.
// Read CPU ms, power and what a player sees from runs with vsync on (uncapped CPU ms include
// waiting on the swap chain).
if (spec.vsync === false) {
    app.commandLine.appendSwitch('disable-gpu-vsync');
    app.commandLine.appendSwitch('disable-frame-rate-limit');
}
if (spec.userData) app.setPath('userData', path.resolve(String(spec.userData)));

const NVSMI_FIELDS = 'power.draw,clocks.gr,clocks.mem,utilization.gpu,pstate,temperature.gpu,enforced.power.limit';
const NVSMI_ARGS = [`--query-gpu=${NVSMI_FIELDS}`, '--format=csv,noheader,nounits'];

function parseSmi(line) {
    const [power, clock, mem, util, pstate, temp, limit] = line.split(',').map((s) => s.trim());
    return {
        powerW: Number(power),
        clockMHz: Number(clock),
        memMHz: Number(mem),
        util: Number(util),
        pstate,
        tempC: Number(temp),
        limitW: Number(limit),
    };
}

function nvidiaSmiOnce() {
    try {
        return parseSmi(execFileSync('nvidia-smi', NVSMI_ARGS, { encoding: 'utf8', timeout: 5000 }).trim());
    } catch {
        return null;
    }
}

/** Sample nvidia-smi every 100 ms until stopped; returns medians. */
function startSmi() {
    const samples = [];
    let child = null;
    try {
        child = spawn('nvidia-smi', [...NVSMI_ARGS, '-lms', '100']);
        let buffer = '';
        child.stdout.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop();
            lines.filter(Boolean).forEach((line) => samples.push(parseSmi(line)));
        });
        child.on('error', () => {});
    } catch { /* no nvidia-smi: the readings carry no power */ }
    return () => {
        child?.kill();
        if (!samples.length) return null;
        const median = (pick) => {
            const values = samples.map(pick).filter(Number.isFinite).sort((a, b) => a - b);
            return values.length ? values[Math.floor(values.length / 2)] : null;
        };
        return {
            samples: samples.length,
            powerW: median((s) => s.powerW),
            clockMHz: median((s) => s.clockMHz),
            memMHz: median((s) => s.memMHz),
            util: median((s) => s.util),
            tempC: median((s) => s.tempC),
            limitW: median((s) => s.limitW),
            pstates: [...new Set(samples.map((s) => s.pstate))],
        };
    };
}

/**
 * The GPU is quiet when nothing renders on it: sampled while our window shows a blank page, a
 * second after the last page went (its teardown is GPU work too). Retried a few times, since
 * another app's burst passes; a page that never finds it quiet is marked so.
 */
async function quietCheck() {
    const attempts = [];
    for (let i = 0; i < 5; i++) {
        await sleep(i ? 4000 : 1000);
        const stop = startSmi();
        await sleep(1600);
        const idle = stop();
        attempts.push(idle);
        if (idle && idle.util <= 5) return { idle, quiet: true, attempts: attempts.length };
    }
    return { idle: attempts[attempts.length - 1], quiet: false, attempts: attempts.length };
}

// Runs in the page once per load: hooks three's timestamp pool and labels every render call.
const INSTALL = `(() => {
    if (window.__BENCH__) return true;
    const P = window.__PLAYGROUND__;
    const renderer = P.renderer();
    const backend = renderer.backend;
    const lab = window.__BREATH_LAB__;
    const B = window.__BENCH__ = {
        on: false, labeling: false, labels: new Map(), frames: [], seen: new Set(),
        minFrame: Infinity, maxFrame: Infinity, resolves: 0, counters: [],
    };
    const labelOf = (target) => {
        const post = lab.host.post;
        if (!post) return 'direct';
        if (!target) return 'output';
        if (target === post.scenePass?.renderTarget) return 'scene';
        if (target === post.shaftsFirst?.renderTarget || target === post.shaftsNode?.renderTarget) return 'shafts';
        if (/^UnrealBloomPass/.test(target.texture?.name || '')) return 'bloom';
        return 'other:' + (target.texture?.name || '?') + '@' + target.width + 'x' + target.height;
    };
    // Each render call's timestamp uid is r:<call index>:<context>:f<frame>: label the calls.
    const begin = backend.beginRender;
    backend.beginRender = function beginRender(context) {
        const result = begin.call(this, context);
        if (B.labeling) {
            const match = /^r:(\\d+):/.exec(this.getTimestampUID(context) || '');
            if (match) B.labels.set(Number(match[1]), labelOf(context.renderTarget));
        }
        return result;
    };
    // Every resolve holds every pass of every frame since the last one: count each frame once.
    const hookPool = () => {
        const pool = backend.timestampQueryPool?.render;
        if (!pool || pool.__benched) return Boolean(pool);
        pool.__benched = true;
        const resolve = pool._resolveQueries;
        pool._resolveQueries = async function resolveQueries() {
            const value = await resolve.call(this);
            if (!B.on) return value;
            const frames = new Map();
            for (const [uid, ms] of this.timestamps) {
                const match = /^r:(\\d+):.*:f(\\d+)$/.exec(uid);
                if (!match) continue;
                const frame = Number(match[2]);
                if (B.seen.has(frame) || frame < B.minFrame || frame > B.maxFrame) continue;
                let entry = frames.get(frame);
                if (!entry) {
                    entry = { frame, total: 0, calls: 0, parts: {} };
                    frames.set(frame, entry);
                }
                entry.total += ms;
                entry.calls += 1;
                const label = B.labels.get(Number(match[1])) || 'unlabelled';
                entry.parts[label] = (entry.parts[label] || 0) + ms;
            }
            frames.forEach((entry, frame) => { B.seen.add(frame); B.frames.push(entry); });
            B.resolves += 1;
            return value;
        };
        return true;
    };
    B.hookPool = hookPool;
    B.counters = () => {
        const info = renderer.info.render;
        return {
            drawCalls: info.drawCalls,
            triangles: info.triangles,
            frameCalls: info.frameCalls,
            frame: renderer.info.frame,
        };
    };
    B.size = () => {
        const target = lab.host.post?.scenePass?.renderTarget;
        return {
            canvas: renderer.domElement.width + 'x' + renderer.domElement.height,
            scene: target ? target.width + 'x' + target.height : null,
            css: innerWidth + 'x' + innerHeight,
            dpr: devicePixelRatio,
            pixelRatio: renderer.getPixelRatio(),
        };
    };
    B.adapter = () => {
        const info = backend.device?.adapterInfo || null;
        if (!info) return null;
        return {
            vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
        };
    };
    return hookPool();
})()`;

// Switch content, wait for frames to flow (a new world compiles on its first frame), label the passes.
const PREPARE = `async (job) => {
    const B = window.__BENCH__;
    const lab = window.__BREATH_LAB__;
    const P = window.__PLAYGROUND__;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const shown = () => ({ labels: [...B.labels.entries()], world: lab.host.worldId, mood: lab.host.mood?.id ?? null });
    if (job.switchWorld) lab.setWorld(job.world, job.mood, job.seed);
    lab.setSession(null);
    lab.setBreath({ breath: job.breath, phase: job.phase, progress: job.progress });
    // Only the breath changed: the same shaders and passes draw, so frames are already flowing and
    // the labels stand (START skips the frames drawn before the new breath reached the uniforms).
    if (!job.fresh) return { settledMs: 0, ...shown() };
    const t0 = performance.now();
    // Frames flow when two quarter-seconds in a row each draw enough frames.
    let calm = 0;
    let last = P.renderer().info.frame;
    while (calm < 2 && performance.now() - t0 < 60000) {
        await wait(250);
        const now = P.renderer().info.frame;
        calm = now - last >= (job.minFramesPerQuarter || 20) ? calm + 1 : 0;
        last = now;
    }
    const settledMs = performance.now() - t0;
    B.hookPool();
    B.labels.clear();
    B.labeling = true;
    await wait(300);
    B.labeling = false;
    await wait(job.warmMs);
    return { settledMs, ...shown() };
}`;

const START = `(() => {
    const B = window.__BENCH__;
    const P = window.__PLAYGROUND__;
    B.frames = [];
    B.seen = new Set();
    B.resolves = 0;
    B.minFrame = P.renderer().info.frame + 2;
    B.maxFrame = Infinity;
    B.on = true;
    B.samples = [];
    P.profile.reset();
    B.sampler = setInterval(() => B.samples.push(B.counters()), 500);
    return B.minFrame;
})()`;

const STOP = `(async () => {
    const B = window.__BENCH__;
    const P = window.__PLAYGROUND__;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    clearInterval(B.sampler);
    B.maxFrame = P.renderer().info.frame;
    const snapshot = P.profile.snapshot();
    // Let the batches in flight resolve.
    await wait(400);
    B.on = false;
    // A frame some of whose passes fell out of the pool (it overflows between resolves at high
    // rates) is left out whole.
    const expected = B.labels.size;
    const frames = B.frames.filter((f) => f.calls === expected);
    const totals = frames.map((f) => f.total).sort((a, b) => a - b);
    const at = (p) => Math.min(totals.length - 1, Math.max(0, Math.ceil(totals.length * p) - 1));
    const q = (p) => (totals.length ? totals[at(p)] : null);
    const parts = {};
    frames.forEach((f) => Object.entries(f.parts).forEach(([name, ms]) => {
        parts[name] = (parts[name] || 0) + ms / frames.length;
    }));
    const counters = B.samples.filter((s) => s.drawCalls > 0);
    const first = counters[0];
    const constant = counters.every((s) => s.drawCalls === first?.drawCalls
        && s.triangles === first?.triangles && s.frameCalls === first?.frameCalls);
    const passMs = B.frames.slice(0, 200).flatMap((f) => Object.values(f.parts));
    const steps = new Set(passMs.map((ms) => Math.round(ms * 1e6)));
    const sum = totals.reduce((a, b) => a + b, 0);
    return {
        frames: frames.length,
        partialFrames: B.frames.length - frames.length,
        resolves: B.resolves,
        gpu: {
            p50: q(0.5), p95: q(0.95), p99: q(0.99), mean: sum / Math.max(totals.length, 1),
            min: totals[0] ?? null, max: totals[totals.length - 1] ?? null,
        },
        parts,
        reference: { gpu: snapshot.gpuMs, gpuStatus: snapshot.gpuTimestamp },
        cpu: snapshot.cpuMs,
        frameMs: snapshot.frameMs,
        counters: first || null,
        countersConstant: constant,
        counterSamples: counters.length,
        size: B.size(),
        diagnostics: window.__PLAYGROUND__.diagnostics(),
        stepSampleNs: [...steps].slice(0, 12),
        heapGrowthMB: snapshot.memory?.growthMB ?? null,
        // Every frame drawn through the window (the frame-interval buffer keeps only the last 1,200).
        drawn: snapshot.droppedFrames?.total ?? null,
        // Every frame's GPU ms in order (µs), to see a power-state change inside a reading.
        series: frames.sort((a, b) => a.frame - b.frame).map((f) => Math.round(f.total * 1000)),
    };
})()`;

/** A tier's frame cap: the spec's per-tier one (the stage draws Low and Minimal at 30 fps), else its own. */
const fpsFor = (tier) => spec.tierMaxFps?.[tier] ?? spec.maxFps ?? 0;

function playgroundUrl(tier, job, variant) {
    const query = new URLSearchParams({
        effect: 'breathing',
        world: job.world,
        mood: String(job.mood),
        seed: String(spec.seed),
        quality: tier,
        breath: String(job.breath),
        phase: String(job.phase),
        progress: String(job.progress),
        t: String(spec.t),
        orbit: '0',
        hud: '0',
        profile: '1',
        trackTimestamp: '1',
        antialias: '0',
        stage: '1',
    });
    if (fpsFor(tier)) query.set('maxFps', String(fpsFor(tier)));
    return `${spec.baseUrl}/playground.html?${query}${spec.extraQuery || ''}${variant?.query || ''}`;
}

async function sizeWindow(win) {
    for (let i = 0; i < 4; i++) {
        const [w, h] = await win.webContents.executeJavaScript('[innerWidth, innerHeight]');
        if (w === spec.width && h === spec.height) return [w, h];
        const [cw, ch] = win.getContentSize();
        win.setContentSize(cw + (spec.width - w), ch + (spec.height - h));
        await sleep(300);
    }
    return win.webContents.executeJavaScript('[innerWidth, innerHeight]');
}

async function loadPlayground(win, tier, job, problems, variant) {
    await win.loadURL(playgroundUrl(tier, job, variant));
    const started = Date.now();
    for (;;) {
        const state = await win.webContents.executeJavaScript(
            '({ ready: window.__PLAYGROUND_READY__ === true, error: window.__PLAYGROUND_ERROR__ || null })',
        ).catch(() => ({ ready: false, error: null }));
        if (state.error) throw new Error(String(state.error).slice(0, 800));
        if (state.ready) break;
        if (Date.now() - started > 120000) throw new Error('playground never became ready');
        await sleep(150);
    }
    await sizeWindow(win);
    const ok = await win.webContents.executeJavaScript(INSTALL);
    if (!ok) problems.push('timestamp pool missing at install (hooked later)');
}

function gitCommit() {
    try {
        const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
        const dirty = git('status', '--porcelain', '--untracked-files=no') ? '+dirty' : '';
        return git('rev-parse', '--short', 'HEAD') + dirty;
    } catch {
        return null;
    }
}

function describe(record) {
    const { gpu, reference, cpu } = record;
    const f = (n) => (Number.isFinite(n) ? n.toFixed(3) : '—');
    const power = record.nvsmi ? ` ${record.nvsmi.powerW} W ${record.nvsmi.pstates.join('/')}` : '';
    return `[r${record.repeat}]${record.variant === 'base' ? '' : ` <${record.variant}>`} `
        + `${record.tier} ${record.world}#${record.mood} ${record.lung}: GPU p50 ${f(gpu.p50)} p95 ${f(gpu.p95)} ms `
        + `(ref ${f(reference.gpu.p50)}, n=${record.frames}/${reference.gpu.samples}) CPU p50 ${f(cpu.p50)} `
        + `draws ${record.drawCalls} buffer ${record.buffer}${power}${record.void ? ` VOID: ${record.void}` : ''}`;
}

async function measure(win, tier, job, prep, variant, repeat, quiet) {
    const sizeBefore = await sizeWindow(win);
    await win.webContents.executeJavaScript(START);
    const stopSmi = startSmi();
    const windowMs = spec.tierWindowMs?.[tier] ?? spec.windowMs;
    await sleep(windowMs);
    const nvsmi = stopSmi();
    const reading = await win.webContents.executeJavaScript(STOP);
    const sizeAfter = reading.size.css;
    const sizeOk = sizeBefore[0] === spec.width && sizeBefore[1] === spec.height
        && sizeAfter === `${spec.width}x${spec.height}`;
    const record = {
        repeat,
        variant: variant.name,
        dsf: spec.dsf,
        width: spec.width,
        height: spec.height,
        maxFps: fpsFor(tier),
        vsync: spec.vsync !== false,
        tier,
        world: job.world,
        mood: job.mood,
        lung: job.lung,
        breath: job.breath,
        buffer: reading.size.scene || reading.size.canvas,
        drawCalls: reading.counters?.drawCalls ?? null,
        triangles: reading.counters?.triangles ?? null,
        renderCalls: reading.counters?.frameCalls ?? null,
        settledMs: prep.settledMs,
        labels: prep.labels,
        ...reading,
        nvsmi,
        quiet: quiet.quiet,
        presentHz: reading.frameMs?.p50 ? 1000 / reading.frameMs.p50 : null,
        // Frames drawn a second through the window (uncapped: how fast it could go).
        fps: reading.drawn ? (reading.drawn * 1000) / windowMs : null,
    };
    const faults = [
        !reading.countersConstant && 'counters changed',
        reading.frames < 30 && 'too few frames',
        !quiet.quiet && 'GPU not idle before the page',
        !sizeOk && `window ${sizeBefore.join('x')} -> ${sizeAfter}`,
    ].filter(Boolean);
    record.void = faults.length ? faults.join(', ') : null;
    return record;
}

async function main() {
    const out = path.resolve(String(spec.out));
    await mkdir(path.dirname(out), { recursive: true });
    const partition = `breathing-bench-${process.pid}`;
    // A save elsewhere must not reload the page mid-measurement.
    session.fromPartition(partition).webRequest.onBeforeRequest(
        { urls: [`${spec.baseUrl.replace('http', 'ws')}/*`] },
        (_details, callback) => callback({ cancel: true }),
    );
    const win = new BrowserWindow({
        width: spec.width,
        height: spec.height,
        useContentSize: true,
        frame: false,
        // At a fractional display scale a frameless window with the thick (resize) frame gets a
        // content size Windows will not set exactly; without it the size holds.
        thickFrame: false,
        resizable: false,
        show: false,
        x: -6000,
        y: -6000,
        webPreferences: { backgroundThrottling: false, partition },
    });
    win.setPosition(-6000, -6000);
    win.showInactive();
    const problems = [];
    win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2 && !/vite\] failed to connect|Security Warning|vite\] connecting/.test(message)) {
            problems.push(message.slice(0, 400));
        }
    });
    const result = {
        spec,
        commit: gitCommit(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        startedAt: new Date().toISOString(),
        gpuBefore: nvidiaSmiOnce(),
        pages: [],
        readings: [],
        problems,
    };
    const save = () => writeFile(out, JSON.stringify(result, null, 1));
    const jobs = spec.worlds.flatMap((world) => spec.moods.flatMap((mood) => spec.lungs.map((lung) => ({
        world, mood, seed: spec.seed, breath: lung.breath, phase: lung.phase, progress: lung.progress, lung: lung.name,
    }))));
    const pages = [];
    for (let repeat = 0; repeat < spec.repeats; repeat++) {
        spec.variants.forEach((variant) => spec.tiers.forEach((tier) => pages.push({ repeat, variant, tier })));
    }
    try {
        for (const { repeat, variant, tier } of pages) {
            await win.loadURL('about:blank');
            const quiet = await quietCheck();
            const page = {
                repeat, variant: variant.name, tier, quiet, startedAt: new Date().toISOString(),
            };
            await loadPlayground(win, tier, jobs[0], problems, variant);
            page.adapter = await win.webContents.executeJavaScript('window.__BENCH__.adapter()');
            if (!spec.igpu && !/nvidia/i.test(page.adapter?.vendor || '')) {
                throw new Error(`not on the NVIDIA GPU: ${JSON.stringify(page.adapter)}`);
            }
            result.pages.push(page);
            let shown = null;
            for (const job of jobs) {
                // A new world (or the page's first) compiles: settle, label the passes, warm up.
                const fresh = `${job.world}#${job.mood}` !== shown;
                const switchWorld = fresh && shown !== null;
                shown = `${job.world}#${job.mood}`;
                const prep = await win.webContents.executeJavaScript(`(${PREPARE})(${JSON.stringify({
                    ...job,
                    fresh,
                    switchWorld,
                    warmMs: spec.warmMs,
                    minFramesPerQuarter: fpsFor(tier) ? Math.floor(fpsFor(tier) * 0.2) : 20,
                })})`);
                const record = await measure(win, tier, job, prep, variant, repeat, quiet);
                result.readings.push(record);
                console.log(describe(record));
                await save();
            }
        }
    } catch (error) {
        result.error = String(error?.stack || error);
        console.error(result.error);
    } finally {
        result.finishedAt = new Date().toISOString();
        result.gpuAfter = nvidiaSmiOnce();
        await save();
        win.destroy();
    }
    printSummary(out, summarise(result.readings));
    app.exit(result.error ? 1 : 0);
}

app.on('window-all-closed', () => { /* one window, kept between pages */ });
app.whenReady().then(main);
