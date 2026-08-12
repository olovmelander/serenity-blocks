/**
 * WAVE −1 — GPU-time split for the Odyssey board, published to reports/odyssey-perf/.
 *
 * Usage:
 *   node scripts/run-electron.mjs scripts/odyssey-gpu-split.mjs --lane A
 *   node scripts/run-electron.mjs scripts/odyssey-gpu-split.mjs --lane B --low-power
 *
 * WHY A MATRIX AND NOT NESTED SCOPES. The plan asks for a split across scene / shadow / post /
 * bloom. three r181's WebGPU backend exposes exactly one timestamp scope per render type —
 * `renderer.info.render.timestamp` is a single aggregate — and `PostProcessing` renders its
 * whole graph inside one call, so there is nowhere to hang a per-pass query without forking
 * the renderer. The split is therefore obtained DIFFERENTIALLY: each configuration removes one
 * system, and the delta against the baseline is that system's cost. That is a weaker
 * instrument than per-pass scopes (it cannot see overlap between systems) and the report says
 * so, but it is a real measurement rather than an assumed one.
 *
 * Discipline (the wave's exit criterion): p50/p99 only, never a mean; fixed-size ring; draw
 * calls latched once per frame. All of that lives in src/utils/perf-ring.js and the board's
 * _sampleGpuProfile; this script only drives configurations and writes the file.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */

import electron from 'electron';
import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const { app, BrowserWindow } = electron;
const ROOT = process.cwd();
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 4179);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const LANE = String(args.lane || 'A').toUpperCase();
const LOW_POWER = args['low-power'] === true || args.lowPower === true;
const QUALITY = String(args.quality || (LANE === 'B' ? 'Medium' : 'High'));
const SETTLE_MS = Number(args.settle || 9000);
const SAMPLE_MS = Number(args.sample || 14000);
// §8 specifies Lane A at 1920x1080 and Lane B at 1280x720. Measuring Lane A at 720p put the
// whole scene at ~1 ms on a 5080, where every configuration's p50 landed within ONE tick of
// the GPU timer's ~0.065 ms quantization and no system could be told apart from the drift.
// Measure the lane the budget is written against, or the numbers answer a different question.
const WIDTH = Math.max(320, Number(args.width || (LANE === 'B' ? 1280 : 1920)));
const HEIGHT = Math.max(240, Number(args.height || (LANE === 'B' ? 720 : 1080)));
const OUT_DIR = path.join(ROOT, 'reports', 'odyssey-perf');

// Each configuration removes ONE system. baseline must run first and last: a drifting
// baseline (thermal throttling, a background compile) invalidates every delta between them,
// and the only way to know is to measure it twice.
const CONFIGURATIONS = [
    { id: 'baseline', flags: {}, note: 'everything on' },
    { id: 'no-bloom', flags: { odysseyPerfDisableBloom: '1' }, note: 'bloom node detached from the post graph' },
    {
        id: 'no-level-nodes',
        flags: { odysseyHideLevelNodes: '1' },
        note: '55 nodes x 3 nested transparent shells hidden',
    },
    {
        id: 'one-world',
        flags: { odysseyOneWorld: '1' },
        note: 'chapters 2-5 replaced by the continuous world',
    },
    {
        id: 'one-world-no-level-nodes',
        flags: { odysseyOneWorld: '1', odysseyHideLevelNodes: '1' },
        note: 'both',
    },
    { id: 'baseline-repeat', flags: {}, note: 'drift check against the first baseline' },
];

// Lane B is an iGPU, and CLAUDE.md records that long WebGPU sessions have TDR-crashed this
// machine's integrated part. --only lets that lane run the two configurations that actually
// answer §8's open question (baseline, and the level-node group) instead of all six.
const ONLY = args.only ? String(args.only).split(',').map((t) => t.trim()) : null;

let devServer = null;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const fmt = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}ms` : '—');

async function startDevServer() {
    return new Promise((resolve, reject) => {
        devServer = spawn(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['vite', '--port', String(PORT), '--strictPort'],
            { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
        );
        const timer = setTimeout(() => reject(new Error('dev server did not start in 90s')), 90000);
        devServer.stdout.on('data', (chunk) => {
            if (String(chunk).includes('ready in') || String(chunk).includes(String(PORT))) {
                clearTimeout(timer);
                setTimeout(resolve, 1200);
            }
        });
        devServer.on('error', reject);
    });
}

function urlFor(flags) {
    const params = new URLSearchParams({
        skipIntro: '1',
        odysseyGpuProfile: '1',
        odysseyOverlay: '0',
        odysseyPixelRatio: '1',
        odysseyDisableAdaptiveQuality: '1',
        odysseyDisableBackgroundLoading: '1',
        // Load only the Act II window. Without this the board creates and warms all EIGHT
        // chapters before isActive flips, which on a cold shader cache runs past the readiness
        // wait — and it was One World, the heaviest boot, that always lost that race and
        // recorded null. Applied to EVERY configuration so they stay comparable, and it also
        // makes the measured frame the Act II frame, which is the one One World changes.
        odysseyCaptureChapters: '3,4,5',
        // Chromium's switch alone is not enough: the board asks the renderer for
        // 'high-performance', which hands back the discrete part regardless.
        ...(LOW_POWER ? { odysseyLowPowerGpu: '1' } : {}),
        quality: QUALITY,
        bust: String(Date.now()),
        ...flags,
    });
    return `${BASE_URL}/?${params.toString()}`;
}

async function loadWithRetry(win, url, attempts = 4) {
    for (let i = 0; i < attempts; i += 1) {
        try {
            await win.loadURL(url);
            return;
        } catch (error) {
            if (i === attempts - 1) throw error;
            process.stdout.write(`[gpu-split]   load retry ${i + 1} (${error?.message ?? error})
`);
            await wait(2500 * (i + 1));
        }
    }
}

async function runConfiguration(config) {
    const win = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: true, // GPU timestamps are unavailable to an occluded surface.
        webPreferences: { backgroundThrottling: false, offscreen: false },
    });
    try {
        // Vite re-runs its dependency optimizer when a new query string shows up, and serves a
        // 504 for the second or so it takes — which Electron reports as a flat ERR_FAILED and
        // which killed configuration 2 of 6 on three consecutive runs. Retry rather than treat
        // a transient dev-server hiccup as a measurement failure.
        await loadWithRetry(win, urlFor(config.flags));
        // Loading the page is not entering the mode: without this the harness would settle,
        // sample, and publish a confident GPU-time split of the main menu.
        await win.webContents.executeJavaScript(`(async () => {
            const waitFor = async (fn, ms = 240000) => {
                const until = Date.now() + ms;
                while (Date.now() < until) {
                    try { if (await fn()) return true; } catch (e) { /* still booting */ }
                    await new Promise((r) => setTimeout(r, 250));
                }
                return false;
            };
            await waitFor(() => window.serenityBlocks?.gameModeManager);
            window.settings = {
                ...(window.settings || {}),
                effectQuality: ${JSON.stringify(QUALITY)},
                graphicsQuality: ${JSON.stringify(QUALITY)},
            };
            window.settingsManager?.update?.({
                effectQuality: ${JSON.stringify(QUALITY)},
                graphicsQuality: ${JSON.stringify(QUALITY)},
            });
            const gm = window.serenityBlocks.gameModeManager;
            if (gm.getCurrentModeId?.() !== 'odyssey') await gm.activateMode('odyssey');
            if (!gm.getCurrentMode?.()?.isRunning) await gm.startCurrentMode?.();
            return waitFor(() => window.odysseyMode?.boardController?.isActive === true);
        })()`, true);
        await wait(SETTLE_MS);
        // Discard everything sampled while pipelines were still compiling — a cold compile is
        // a real cost, but it is a STARTUP cost and averaging it into steady state hides both.
        await win.webContents.executeJavaScript(
            'window.__ODYSSEY_GPU_RESET__?.(); true',
        ).catch(() => {});
        await wait(SAMPLE_MS);
        const summary = await win.webContents.executeJavaScript(
            'window.__ODYSSEY_GPU_PROFILE__ ?? null',
        );
        return { ...config, summary };
    } finally {
        win.destroy();
        await wait(2000);
    }
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) out[key] = true;
        else { out[key] = next; i += 1; }
    }
    return out;
}

function buildSplit(results) {
    const byId = Object.fromEntries(results.map((r) => [r.id, r.summary?.p50 ?? null]));
    const delta = (from, to) => (
        Number.isFinite(byId[from]) && Number.isFinite(byId[to])
            ? +(byId[from] - byId[to]).toFixed(3)
            : null
    );
    return {
        bloomMs: delta('baseline', 'no-bloom'),
        levelNodesMs: delta('baseline', 'no-level-nodes'),
        oneWorldDeltaMs: delta('baseline', 'one-world'),
        baselineDriftMs: delta('baseline', 'baseline-repeat'),
        note: 'Differential, not per-pass: each figure is baseline p50 minus that '
            + 'configuration p50. Overlapping costs are attributed to whichever system is '
            + 'removed first, and baselineDriftMs bounds how much of any figure could be '
            + 'drift rather than signal.',
    };
}

app.commandLine.appendSwitch(LOW_POWER ? 'force_low_power_gpu' : 'force_high_performance_gpu');
app.disableHardwareAcceleration = false;
// Electron quits the app when the last window closes. This harness deliberately runs one
// window per configuration and destroys each when its samples are in — so without this the
// process exits, silently and with status 0, the moment configuration 1 finishes. It read as
// three different failures (an ERR_FAILED on the next load, then a run that just stopped) and
// it was one cause: the app was already shutting down.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
    const results = [];
    try {
        process.stdout.write(`[gpu-split] lane ${LANE} (${QUALITY}), starting dev server...\n`);
        await startDevServer();
        const selected = ONLY
            ? CONFIGURATIONS.filter((c) => ONLY.includes(c.id))
            : CONFIGURATIONS;
        if (ONLY) {
            process.stdout.write(`[gpu-split] restricted to: ${selected.map((c) => c.id).join(', ')}
`);
        }
        for (const config of selected) {
            process.stdout.write(`[gpu-split] ${config.id}...\n`);
            // A configuration that never becomes ready must not take the whole run with it:
            // one stall previously cost five measured configurations and produced no report at
            // all. Record it as a null row and carry on — an absent number is information.
            const result = await Promise.race([
                runConfiguration(config),
                wait(320000).then(() => ({ ...config, summary: null, timedOut: true })),
            ]);
            const s = result.summary;
            process.stdout.write(
                s
                    ? `[gpu-split]   p50 ${fmt(s.p50)} p95 ${fmt(s.p95)} p99 ${fmt(s.p99)} `
                      + `max ${fmt(s.max)} over ${s.samples} frames, ${s.drawCalls} draws\n`
                    : '[gpu-split]   NO SAMPLES (timestamps unavailable on this surface)\n',
            );
            results.push(result);
        }

        const adapter = await probeAdapter();
        const report = {
            wave: -1,
            generatedAt: new Date().toISOString(),
            lane: LANE,
            configurationsRun: (ONLY ? 'restricted' : 'full'),
            quality: QUALITY,
            adapter,
            resolution: `${WIDTH}x${HEIGHT}`,
            discipline: 'p50/p99 from a fixed 600-sample ring; no mean is recorded anywhere',
            configurations: results.map((r) => ({ id: r.id, note: r.note, ...r.summary })),
            split: buildSplit(results),
        };
        await mkdir(OUT_DIR, { recursive: true });
        const file = path.join(OUT_DIR, `gpu-split-lane${LANE.toLowerCase()}.json`);
        await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        process.stdout.write(`[gpu-split] wrote ${path.relative(ROOT, file)}\n`);
        process.stdout.write(`[gpu-split] split: ${JSON.stringify(report.split)}\n`);
    } catch (error) {
        process.stderr.write(`[gpu-split] FAILED: ${error?.stack || error}\n`);
        process.exitCode = 1;
    } finally {
        devServer?.kill();
        app.quit();
    }
});

async function probeAdapter() {
    const win = new BrowserWindow({ width: 320, height: 240, show: false });
    try {
        // about:blank has no WebGPU in Electron, so the first version of this probe recorded
        // {"error":"no navigator.gpu"} into a report whose entire purpose is to say WHICH GPU
        // produced the numbers. Load a real page from the dev server instead.
        await win.loadURL(`${BASE_URL}/?adapterProbe=1`);
        return await win.webContents.executeJavaScript(`
            (async () => {
                if (!navigator.gpu) return { error: 'no navigator.gpu' };
                const a = await navigator.gpu.requestAdapter(
                    { powerPreference: ${LOW_POWER ? "'low-power'" : "'high-performance'"} },
                );
                if (!a) return { error: 'no adapter' };
                const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
                return {
                    vendor: info.vendor ?? null,
                    architecture: info.architecture ?? null,
                    device: info.device ?? null,
                    description: info.description ?? null,
                };
            })()
        `);
    } catch (error) {
        return { error: String(error?.message || error) };
    } finally {
        win.destroy();
    }
}
