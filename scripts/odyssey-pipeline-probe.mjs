/**
 * Per-pipeline compile-time probe for the Odyssey cold start, inside THIS Electron.
 *
 * Wraps `GPUDevice.prototype.createRenderPipelineAsync` before the mode starts, starts Odyssey,
 * waits until pipeline creation goes quiet, and prints the slowest pipelines by label together
 * with the `[OdysseyStartup] compile-breakdown` line. Fresh userData dir per run (cold Dawn
 * cache) unless `--keep-profile`.
 *
 * Why it exists: the shader-compile diagnosis of 2026-08-21 was made in Chrome 151; Electron 38
 * is Chromium 140 with a different Dawn / DXC vintage, and the perf driver measured the same
 * change the other way round. The label → material mapping is the same as in the browser
 * (`renderPipeline_<MaterialType>_<material.id>`).
 *
 * Usage (dev server already on the port):
 *   node scripts/run-electron.mjs scripts/odyssey-pipeline-probe.mjs [--port 4177] [--url-flag odysseySimplex=0] [--top 12] [--low-power]
 *
 * GPU: defaults to `force_high_performance_gpu` like the perf session and capture harness. WITHOUT
 * a switch Electron on the 82JU lands on the Vega 8 iGPU (no UserGpuPreferences entry for
 * electron.exe) — `--low-power` asks for it explicitly (Lane B). The adapter is in the output.
 */
/* eslint-disable import/no-extraneous-dependencies, no-await-in-loop */
import electron from 'electron';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const { app, BrowserWindow } = electron;
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => {
    if (!a.startsWith('--')) return null;
    const key = a.slice(2);
    const next = arr[i + 1];
    return [key, next && !next.startsWith('--') ? next : '1'];
}).filter(Boolean));

const PORT = Number(args.port || 4177);
const TOP = Number(args.top || 12);
const params = new URLSearchParams({
    skipIntro: '1', noThemeWarm: '1', odysseyOverlay: '0', odysseyDisableAdaptiveQuality: '1', odysseyPixelRatio: '1',
});
String(args['url-flag'] || '').split(',').filter(Boolean).forEach((pair) => {
    const [k, v = '1'] = pair.split('=');
    params.set(k, v);
});
const URL = `http://127.0.0.1:${PORT}/?${params.toString()}`;

app.commandLine.appendSwitch(args['low-power'] ? 'force_low_power_gpu' : 'force_high_performance_gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const HOOK = `
(() => {
  const rec = []; window.__pipes = rec;
  const orig = GPUDevice.prototype.createRenderPipelineAsync;
  GPUDevice.prototype.createRenderPipelineAsync = function (desc) {
    const t = performance.now();
    const p = orig.call(this, desc);
    const label = desc.label || '?';
    p.then(() => rec.push({ label, ms: Math.round(performance.now() - t), at: Math.round(t) }), () => {});
    return p;
  };
  return true;
})()`;

const RUN = `
(async () => {
  const until = async (fn, ms = 120000) => { const t = performance.now(); while (performance.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
  const lines = []; const origLog = console.log; console.log = (...a) => { try { lines.push(a.map(String).join(' ')); } catch {} return origLog.apply(console, a); };
  await until(() => window.serenityBlocks?.gameModeManager && window.serenityBlocks?.themeManager);
  const tStart = performance.now();
  window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'odyssey' } }));
  await until(() => window.odysseyMode?.boardController?.renderer, 120000);
  let last = -1; let quietSince = performance.now();
  while (performance.now() - tStart < 150000) {
    const n = window.__pipes.length;
    if (n !== last) { last = n; quietSince = performance.now(); }
    else if (performance.now() - quietSince > 5000 && lines.some(l => l.includes('compile-breakdown'))) break;
    await new Promise(r => setTimeout(r, 250));
  }
  const pipes = window.__pipes.slice().sort((a, b) => b.ms - a.ms);
  const total = window.__pipes.reduce((s, p) => s + p.ms, 0);
  const adapter = await navigator.gpu.requestAdapter();
  return {
    calls: pipes.length, sumMs: total, slowest: pipes.slice(0, ${TOP}),
    breakdown: lines.filter(l => /compile-breakdown|\\[OdysseyStartup\\] total|board visible/.test(l)),
    adapter: adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null,
    ua: navigator.userAgent,
  };
})()`;

app.whenReady().then(async () => {
    let profile = null;
    if (!args['keep-profile']) {
        profile = await mkdtemp(path.join(os.tmpdir(), 'odyssey-pipeline-probe-'));
        app.setPath('userData', profile);
    }
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        useContentSize: true,
        show: !!args.show,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
    });
    try {
        await win.loadURL(URL);
        await win.webContents.executeJavaScript(HOOK, true);
        const result = await win.webContents.executeJavaScript(RUN, true);
        result.electron = process.versions.electron;
        result.chrome = process.versions.chrome;
        result.url = URL;
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`[pipeline-probe] FAILED: ${error?.stack || error}\n`);
        process.exitCode = 1;
    } finally {
        win.destroy();
        if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
        app.quit();
    }
});
