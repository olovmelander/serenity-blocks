/* Odyssey feel probe (2026-10-19; record: docs/ODYSSEY_SMOOTHNESS_PASS_2026-10.md).
 * Plays Odyssey the way the owner does: Extreme quality,
 * his frame-rate setting (default cap 144, which renders every display frame here), a window the size
 * of the display's work area, WebGPU on the RTX. ONE Electron process, phases in order:
 *   start   menu -> Odyssey (startGameWithMode), from the click to board-active + START_TAIL ms
 *   idle    IDLE ms at the arrival position
 *   travel  real wheel events along the path, p from -> to over TRAVEL ms (and back if --back=1)
 *   orb     glide to an orb, enter it, play PLAY ms, return to the map, settle
 *   jump    glide across a chapter boundary (travelToLevel of the next chapter's first orb)
 * Per phase: presents of the Odyssey canvas (GPUCanvasContext.getCurrentTexture hook) and of every
 * other canvas, rAF frames with the main-thread time of their callbacks (rAF wrapper), long
 * animation frames (>= 50 ms, with script attribution), sync/async pipeline creations, the camera
 * progress per frame, the renderer pixel ratio and the adaptive-quality state.
 * Needs a dev server for the tree under test (VITE_CACHE_DIR=.cache/vite-<port> npx vite --host 127.0.0.1
 * --port <port> --strictPort), mains power, and the shared GPU lock (repos/odyssey-gpu/gpu-run.sh).
 * Read a run with scripts/odyssey-feel-report.mjs <dir> [--v] [--bins]; compare arms with
 * scripts/odyssey-feel-ab.mjs; profiles with scripts/cpuprofile-bursts.mjs; traces with
 * scripts/trace-long-slices.mjs. Every URL-like argument must be --key=value (Electron).
 * Usage: node scripts/run-electron.mjs <this> --baseUrl=http://127.0.0.1:5431 --out=<dir>
 *        --profile=<abs dir> [--phases=start,idle,travel,orb,jump] [--fps=144] [--quality=Extreme]
 *        [--query=a=1&b=2] [--travel=40000] [--from=0.02] [--to=0.99] [--back=1] [--orbs=12,40]
 *        [--cpuprofile=start,travel] [--gpu=1]
 */
import electron from 'electron';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

const { app, BrowserWindow, screen, contentTracing } = electron;
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('='); return i > 2 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), '1'];
}));
const BASE = args.baseUrl || 'http://127.0.0.1:5431';
const QUERY = args.query ? `&${args.query}` : '';
const OUT = args.out;
const FPS = Number(args.fps ?? 144);
const QUALITY = args.quality || 'Extreme';
const PHASES = String(args.phases || 'start,idle,travel,orb,jump').split(',').filter(Boolean);
const TRAVEL_MS = Number(args.travel || 40000);
const FROM = Number(args.from ?? 0.02);
const TO = Number(args.to ?? 0.99);
const BACK = args.back === '1';
const ORBS = String(args.orbs || '').split(',').filter(Boolean).map(Number);
const CPU = new Set(String(args.cpuprofile || '').split(',').filter(Boolean));
const TRACE = new Set(String(args.trace || '').split(',').filter(Boolean));
const GPU = args.gpu === '1';
const START_TAIL = Number(args.startTail || 10000);
const IDLE = Number(args.idle || 6000);
const PLAY = Number(args.play || 6000);
const WATCHDOG = Number(args.watchdog || 600000);
if (!OUT) { console.error('need --out'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, 'session.log');
const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); try { appendFileSync(LOG, `${l}\n`); } catch { /* */ } };

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (args.profile) app.setPath('userData', isAbsolute(args.profile) ? args.profile : resolve(args.profile));
app.on('window-all-closed', () => {});
setTimeout(() => { log('WATCHDOG fired'); app.exit(3); }, WATCHDOG);

/** Document start: frame, present, pipeline and long-frame recorders. */
const HOOK = `(() => {
  if (window.__F) return;
  const F = window.__F = { frames: [], presents: [], pipes: [], loaf: [], marks: [], on: true };
  const now = () => performance.now();
  // rAF wrapper: main-thread time of every callback, grouped by the frame's timestamp.
  const raf = window.requestAnimationFrame.bind(window);
  let cur = null;
  window.requestAnimationFrame = function (cb) {
    return raf((t) => {
      if (!cur || cur.t !== t) {
        if (cur) F.frames.push(cur);
        if (F.frames.length > 60000) F.frames.splice(0, 30000);
        cur = { t, ms: 0, n: 0, s: now(), p: null };
      }
      const s = now();
      try { cb(t); } finally { cur.ms += now() - s; cur.n += 1; cur.e = now(); }
    });
  };
  // Own frame ticker records camera progress (and closes frames even when nobody else asks for rAF).
  const tick = (t) => {
    try { const bc = window.__bc && window.__bc(); if (bc && cur && cur.t === t) cur.p = bc.cameraController ? bc.cameraController.currentPosition : null; } catch (e) {}
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
  if (window.GPUCanvasContext) {
    const gct = GPUCanvasContext.prototype.getCurrentTexture;
    const ids = new WeakMap(); let next = 1;
    F.canvasId = (c) => { if (!ids.has(c)) ids.set(c, next++); return ids.get(c); };
    F.canvasNames = {};
    GPUCanvasContext.prototype.getCurrentTexture = function () {
      const id = F.canvasId(this.canvas); const t = now();
      if (!F.canvasNames[id]) { const c = this.canvas; const p = c && c.parentElement; F.canvasNames[id] = ((c && c.id) || '') + '<' + ((p && (p.id || p.className)) || '?') + '>' + (c ? c.width + 'x' + c.height : ''); }
      const last = F.presents.length ? F.presents[F.presents.length - 1] : null;
      if (!(last && last[1] === id && t - last[0] < 2)) F.presents.push([t, id]);
      if (F.presents.length > 120000) F.presents.splice(0, 60000);
      return gct.apply(this, arguments);
    };
  }
  if (window.GPUDevice) {
    for (const [n, k] of [['createRenderPipeline', 'sync'], ['createRenderPipelineAsync', 'async'], ['createComputePipeline', 'csync'], ['createComputePipelineAsync', 'casync']]) {
      const o = GPUDevice.prototype[n]; if (typeof o !== 'function') continue;
      GPUDevice.prototype[n] = function (d) { F.pipes.push([now(), k, String((d && d.label) || '').slice(0, 60)]); return o.apply(this, arguments); };
    }
  }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) {
    F.loaf.push({ at: e.startTime, ms: e.duration, block: e.blockingDuration, render: e.renderStart ? e.duration - (e.renderStart - e.startTime) : 0,
      scripts: (e.scripts || []).slice(0, 6).map((s) => ({ ms: Math.round(s.duration), inv: String(s.invoker || '').slice(0, 80), fn: String(s.sourceFunctionName || '').slice(0, 60), src: String(s.sourceURL || '').split('/').slice(-2).join('/').slice(0, 80) + ':' + (s.sourceCharPosition ?? '') })) });
  } }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) {}
  // A showInactive window never has focus; the orb's Ready cue waits for it.
  try { document.hasFocus = () => true; } catch (e) {}
  window.__bc = () => { const m = window.odysseyMode || (window.serenityBlocks && window.serenityBlocks.gameModeManager && window.serenityBlocks.gameModeManager.getCurrentMode && window.serenityBlocks.gameModeManager.getCurrentMode()); return m && m.boardController; };
  F.mark = (name) => F.marks.push([now(), name]);
})();`;

/** In-page: summarise frames/presents in [t0, t1]. */
const SUMMARY_FN = `window.__summ = (t0, t1, label) => {
  const F = window.__F; const bc = window.__bc && window.__bc();
  const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))].toFixed(2); };
  const frames = F.frames.filter((f) => f.t >= t0 && f.t <= t1);
  const rafGaps = []; for (let i = 1; i < frames.length; i++) rafGaps.push(frames[i].t - frames[i - 1].t);
  const odyCanvas = bc && bc.renderer && bc.renderer.domElement;
  const odyId = odyCanvas && F.canvasId ? F.canvasId(odyCanvas) : -1;
  const byCanvas = {};
  for (const [t, id] of F.presents) { if (t < t0 || t > t1) continue; (byCanvas[id] || (byCanvas[id] = [])).push(t); }
  const canvases = {};
  const secs = (t1 - t0) / 1000;
  for (const [id, ts] of Object.entries(byCanvas)) {
    const gaps = []; for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
    const worst = [];
    for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g > 11.4) worst.push([+(ts[i - 1] - t0).toFixed(0), +g.toFixed(1)]); }
    worst.sort((a, b) => b[1] - a[1]);
    canvases[Number(id) === odyId ? 'odyssey' : 'c' + id] = { name: (F.canvasNames && F.canvasNames[id]) || null, fps: +(ts.length / secs).toFixed(1), p50: q(gaps, 0.5), p95: q(gaps, 0.95), p99: q(gaps, 0.99), max: gaps.length ? +Math.max(...gaps).toFixed(1) : null,
      missed: gaps.filter((g) => g > 11.4).length, over20: gaps.filter((g) => g > 20).length, over50: gaps.filter((g) => g > 50).length, worst: worst.slice(0, 12) };
  }
  const work = frames.map((f) => f.ms);
  const heavy = frames.map((f, i) => [f, i]).filter(([f]) => f.ms > 7).sort((a, b) => b[0].ms - a[0].ms).slice(0, 15).map(([f]) => [+(f.t - t0).toFixed(0), +f.ms.toFixed(1), f.p == null ? null : +f.p.toFixed(4)]);
  const pipes = F.pipes.filter(([t]) => t >= t0 && t <= t1);
  const loaf = F.loaf.filter((e) => e.at >= t0 && e.at <= t1).sort((a, b) => b.ms - a.ms).slice(0, 10).map((e) => ({ at: +(e.at - t0).toFixed(0), ms: Math.round(e.ms), block: Math.round(e.block), scripts: e.scripts }));
  let pr = null; try { pr = bc && bc.renderer && bc.renderer.getPixelRatio(); } catch (e) {}
  const aq = bc && (bc.adaptiveQuality || bc._adaptiveQuality);
  return { label, secs: +secs.toFixed(1), raf: { fps: +(frames.length / secs).toFixed(1), p50: q(rafGaps, 0.5), p95: q(rafGaps, 0.95), p99: q(rafGaps, 0.99), max: rafGaps.length ? +Math.max(...rafGaps).toFixed(1) : null, missed: rafGaps.filter((g) => g > 11.4).length },
    mainMs: { p50: q(work, 0.5), p90: q(work, 0.9), p95: q(work, 0.95), p99: q(work, 0.99), max: work.length ? +Math.max(...work).toFixed(1) : null, over7: work.filter((w) => w > 7).length, over12: work.filter((w) => w > 12).length },
    canvases, heavy, pipes: { sync: pipes.filter((p) => p[1] === 'sync').length, async: pipes.filter((p) => p[1] === 'async').length, compute: pipes.filter((p) => p[1][0] === 'c').length, syncAt: pipes.filter((p) => p[1] === 'sync').slice(0, 20).map((p) => [+(p[0] - t0).toFixed(0), p[2]]) },
    loaf, pixelRatio: pr, quality: bc && bc.qualityName, frameMsEma: bc && bc.frameMsEma && +bc.frameMsEma.toFixed(2),
    aq: aq ? { tier: aq.currentTier ?? aq.tier ?? null, scale: aq.resolutionScale ?? aq.scale ?? null } : null,
    p: bc && bc.cameraController ? +bc.cameraController.currentPosition.toFixed(4) : null,
    gpu: window.__ODYSSEY_GPU_PROFILE__ ? { p50: window.__ODYSSEY_GPU_PROFILE__.p50, p95: window.__ODYSSEY_GPU_PROFILE__.p95, n: window.__ODYSSEY_GPU_PROFILE__.samples, draws: window.__ODYSSEY_GPU_PROFILE__.drawCalls, tris: window.__ODYSSEY_GPU_PROFILE__.triangles, passes: window.__ODYSSEY_GPU_PROFILE__.passes } : null };
}; true;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    await app.whenReady();
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    log(`display work area ${width}x${height} scale ${display.scaleFactor} refresh ${display.displayFrequency} Hz; cap ${FPS}; quality ${QUALITY}; phases ${PHASES.join(',')}; query '${QUERY}'`);
    const win = new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#000',
        webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    win.showInactive();
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['ws://*/*'] }, (details, done) => done({ cancel: true }));
    const consoleLines = [];
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2 || /WebGPU|GPU|error|Error|OdysseyWarmup|ThemeManager] Pre-warm|warm-up/.test(message)) consoleLines.push(`[${level}] ${String(message).slice(0, 300)}`); });
    win.webContents.on('render-process-gone', (_e, d) => log(`render-process-gone ${d && d.reason}`));
    const result = { fps: FPS, quality: QUALITY, query: QUERY, display: { width, height, hz: display.displayFrequency }, phases: {} };
    const save = () => { result.console = consoleLines.slice(-80); writeFileSync(join(OUT, 'feel.json'), JSON.stringify(result, null, 1)); };
    try {
        await win.loadURL('about:blank');
        const dbg = win.webContents.debugger; dbg.attach('1.3');
        await dbg.sendCommand('Page.enable');
        await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
        const settings = { pauseOnFocusLoss: false, reducedMotion: false, targetFrameRate: FPS, effectQuality: QUALITY };
        await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
          try { const key = 'serenityBlocksSettings'; const s = JSON.parse(localStorage.getItem(key) || '{}') || {};
            Object.assign(s, ${JSON.stringify(settings)}); localStorage.setItem(key, JSON.stringify(s)); } catch (e) {} })();` });
        const ev = (src, ms = 30000) => Promise.race([win.webContents.executeJavaScript(src, true), new Promise((_, rej) => setTimeout(() => rej(new Error(`eval timeout ${ms}`)), ms))]);
        const evq = (src) => ev(src, 4000).catch(() => null);
        const profiled = async (name, run) => {
            if (TRACE.has(name)) {
                await contentTracing.startRecording({
                    included_categories: ['toplevel', 'gpu', 'gpu.dawn', 'disabled-by-default-gpu.dawn', 'viz', 'gpu.capture', 'benchmark', 'cc', 'disabled-by-default-devtools.timeline', 'devtools.timeline', 'v8.execute'],
                });
                try { return await run(); } finally {
                    const file = await contentTracing.stopRecording(join(OUT, `${name}.trace.json`));
                    log(`trace ${name} -> ${file}`);
                }
            }
            if (!CPU.has(name)) return run();
            await dbg.sendCommand('Profiler.enable');
            await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 200 });
            await dbg.sendCommand('Profiler.start');
            try { return await run(); } finally {
                const { profile } = await dbg.sendCommand('Profiler.stop');
                writeFileSync(join(OUT, `${name}.cpuprofile`), JSON.stringify(profile));
            }
        };
        const url = `${BASE}/?skipIntro=1&odysseyDebug=1${GPU ? '&odysseyGpuProfile=1' : ''}${QUERY}`;
        log(`load ${url}`);
        win.loadURL(url).catch((e) => log(`loadURL ${e.message}`));
        const tb = Date.now();
        for (;;) {
            if (await evq('!!(window.serenityBlocks && window.serenityBlocks.gameModeManager && window.serenityBlocks.themeManager)')) break;
            if (Date.now() - tb > 120000) throw new Error('managers not ready');
            await sleep(300);
        }
        await ev(SUMMARY_FN);
        await sleep(2500); // menu dwell
        const summ = async (t0, t1, label) => ev(`window.__summ(${t0}, ${t1}, ${JSON.stringify(label)})`, 20000);
        const nowIn = () => ev('performance.now()');

        if (PHASES.includes('start')) {
            const r = await profiled('start', async () => {
                const t0 = await ev(`(() => { const t = performance.now(); window.__F.mark('click');
                  window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'odyssey' } })); return t; })()`);
                let active = null; const te = Date.now();
                while (Date.now() - te < 120000) {
                    const st = await evq(`(() => { const m = window.odysseyMode; const bc = window.__bc(); if (m && m._firstArrival && m._firstArrival.cancel) { try { m._firstArrival.cancel(); } catch (e) {} }
                      return { active: !!(bc && bc.isActive), at: performance.now() }; })()`);
                    if (st && st.active) { active = st.at; break; }
                    await sleep(100);
                }
                if (active == null) throw new Error('board never active');
                await sleep(START_TAIL);
                const t1 = await nowIn();
                const s = await summ(t0, t1, 'start');
                s.boardActiveMs = +(active - t0).toFixed(0);
                // Split: the reveal tail (after board active) is what the player sees moving.
                s.afterReveal = await summ(active, t1, 'start.afterReveal');
                return s;
            });
            result.phases.start = r; save();
            log(`start ${JSON.stringify(r).slice(0, 1500)}`);
            await ev('(() => { const m = window.odysseyMode; if (m && m._firstArrival && m._firstArrival.cancel) m._firstArrival.cancel(); if (m && m.odysseyState) m.odysseyState.isLevelUnlocked = () => true; return true; })()').catch(() => null);
        }
        const runners = {};
        runners.idle = async () => {
            const t0 = await nowIn(); await sleep(IDLE); const t1 = await nowIn();
            const name = result.phases.idle ? `idle${Object.keys(result.phases).length}` : 'idle';
            result.phases[name] = await summ(t0, t1, name); save();
            log(`${name} ${JSON.stringify(result.phases[name]).slice(0, 1500)}`);
        };
        const drive = (label, from, to, ms) => ev(`(async () => {
          const bc = window.__bc(); const cc = bc.cameraController;
          const el = bc.renderer && bc.renderer.domElement || bc.container;
          const rect = (bc.container || el).getBoundingClientRect();
          const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
          const under = document.elementFromPoint(cx, cy);
          window.__F.under = under ? (under.id || under.className || under.tagName).toString().slice(0, 80) : null;
          window.__F.fallbacks = 0;
          const wheel = (deltaY) => {
            const e = new WheelEvent('wheel', { deltaY, deltaMode: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true });
            el.dispatchEvent(e);
            // Unhandled (an overlay under the pointer, a sheet): make the call the handler makes.
            if (!e.defaultPrevented) { window.__F.fallbacks += 1; cc.scroll(deltaY * 0.001); }
          };
          const t0 = performance.now();
          // GPU per second of travel (only with ?odysseyGpuProfile=1): one window per sample.
          const gpu = window.__F.gpuTravel = [];
          if (window.__ODYSSEY_GPU_RESET__) window.__ODYSSEY_GPU_RESET__();
          const gpuTimer = window.__ODYSSEY_GPU_RESET__ ? setInterval(() => {
            const s = window.__ODYSSEY_GPU_PROFILE__;
            if (s && s.samples) gpu.push({ p: +cc.currentPosition.toFixed(3), p50: s.p50, p95: s.p95, n: s.samples, draws: s.drawCalls, tris: s.triangles, pr: bc.renderer.getPixelRatio() });
            window.__ODYSSEY_GPU_RESET__();
          }, 1000) : null;
          await new Promise((resolve) => {
            const step = () => {
              const k = Math.min(1, (performance.now() - t0) / ${ms});
              const want = ${from} + (${to} - ${from}) * k;
              const err = want - (cc.targetPosition ?? cc.currentPosition ?? 0);
              const px = err / (0.001 * ((cc.config && cc.config.scrollSpeed) || 0.09));
              const clamped = Math.max(-240, Math.min(240, px));
              if (Math.abs(clamped) > 0.5) wheel(clamped);
              if (k >= 1) { resolve(true); return; }
              requestAnimationFrame(step);
            };
            step();
          });
          await new Promise((r) => setTimeout(r, 1500));
          if (gpuTimer) clearInterval(gpuTimer);
          return [t0, performance.now(), cc.currentPosition];
        })()`, ms + 60000);
        runners.travel = async () => {
            // Settle at the start of the ramp first (not measured).
            await ev(`(() => { const m = window.odysseyMode; try { m._firstArrival && m._firstArrival.cancel && m._firstArrival.cancel(); } catch (e) {} const cc = window.__bc().cameraController; cc.setCurrentPosition ? cc.setCurrentPosition(${FROM}) : (cc.currentPosition = ${FROM}); cc.targetPosition = ${FROM}; return true; })()`).catch((e) => log(`seek ${e.message}`));
            await sleep(3000);
            const r = await profiled('travel', async () => {
                // Screenshots during the travel itself (--travelShots=<ms>): pop-in checks at seams.
                let shotTimer = null; let shotN = 0;
                if (Number(args.travelShots) > 0) {
                    shotTimer = setInterval(async () => {
                        try {
                            const img = await win.webContents.capturePage();
                            const p = await evq('window.__bc().cameraController.currentPosition');
                            writeFileSync(join(OUT, `travel-${String(shotN++).padStart(3, '0')}-p${Number(p).toFixed(3)}.png`), img.toPNG());
                        } catch (e) { /* a busy frame */ }
                    }, Number(args.travelShots));
                }
                const [t0, t1, endP] = await drive('travel', FROM, TO, TRAVEL_MS);
                if (shotTimer) clearInterval(shotTimer);
                const s = await summ(t0, t1, 'travel'); s.endP = endP;
                // Per-progress bins: worst present gap and missed frames per 0.02 of the path.
                s.bins = await ev(`(() => { const F = window.__F; const bins = {}; const fr = F.frames.filter((f) => f.t >= ${t0} && f.t <= ${t1} && f.p != null);
                  for (let i = 1; i < fr.length; i++) { const g = fr[i].t - fr[i - 1].t; const b = (Math.floor(fr[i].p * 50) / 50).toFixed(2); const o = bins[b] || (bins[b] = { n: 0, missed: 0, worst: 0, workMax: 0, work: 0 }); o.n++; if (g > 11.4) o.missed++; o.worst = Math.max(o.worst, Math.round(g)); o.workMax = Math.max(o.workMax, Math.round(fr[i].ms)); o.work += fr[i].ms; }
                  for (const o of Object.values(bins)) o.work = +(o.work / o.n).toFixed(2); return bins; })()`);
                s.gpuTravel = await ev('window.__F.gpuTravel || null').catch(() => null);
                s.drive = await ev('({ under: window.__F.under, fallbacks: window.__F.fallbacks })').catch(() => null);
                return s;
            });
            result.phases.travel = r; save();
            log(`travel ${JSON.stringify(r).slice(0, 2500)}`);
            if (BACK) {
                const [t0, t1] = await drive('back', TO, FROM, TRAVEL_MS);
                result.phases.travelBack = await summ(t0, t1, 'travelBack'); save();
                log(`travelBack ${JSON.stringify(result.phases.travelBack).slice(0, 1500)}`);
            }
        };
        // Orb plan: levels by chapter from the node manager.
        let nodes = [];
        const loadNodes = async () => { nodes = await ev(`(() => { const bc = window.__bc(); const out = []; for (const [id, n] of bc.nodeManager.nodes) out.push([id, n.config && n.config.chapter, n.pathPosition]); return out; })()`).catch(() => []); };
        const firstOf = (ch) => (nodes.filter((n) => n[1] === ch).sort((a, b) => a[2] - b[2])[0] || [])[0];
        runners.orb = async () => {
            await loadNodes();
            const orbs = ORBS.length ? ORBS : [firstOf(1) ?? 1];
            for (const orb of orbs) {
                const rec = {};
                let t0 = await nowIn();
                await ev(`window.__bc().travelToLevel(${orb}).then(() => true)`, 30000).catch((e) => log(`travel ${orb}: ${e.message}`));
                await sleep(1500);
                let t1 = await nowIn(); rec.glide = await summ(t0, t1, `orb${orb}.glide`);
                let running = null;
                await profiled(`orb${orb}-enter`, async () => {
                    t0 = await nowIn();
                    await ev(`(() => { const m = window.odysseyMode; m.odysseyState.isLevelUnlocked = () => true; window.__F.mark('enter'); m.enterLevel(${orb}); return true; })()`);
                    const te = Date.now();
                    while (Date.now() - te < 60000) {
                        const st = await evq('(() => ({ phase: window.odysseyMode.entryPhase, at: performance.now() }))()');
                        if (st && (st.phase === 'playable' || st.phase === 'running')) { running = st.at; break; }
                        if (st && st.phase === 'aborted') break;
                        await sleep(100);
                    }
                    await sleep(1000);
                });
                t1 = await nowIn(); rec.enter = await summ(t0, t1, `orb${orb}.enter`); rec.enter.playableMs = running && +(running - t0).toFixed(0);
                t0 = await nowIn(); await sleep(PLAY); t1 = await nowIn();
                rec.play = await summ(t0, t1, `orb${orb}.play`);
                rec.play.theme = await evq('(() => { const tm = window.serenityBlocks.themeManager; return tm.activeThemeName; })()');
                let back = null;
                await profiled(`orb${orb}-exit`, async () => {
                    t0 = await nowIn();
                    await ev(`(() => { window.__F.mark('return'); window.odysseyMode.returnToBoard({ focusLevelId: ${orb} }); return true; })()`);
                    const tr = Date.now();
                    while (Date.now() - tr < 60000) {
                        const st = await evq('(() => { const bc = window.__bc(); return { active: !!(bc && bc.isActive && !bc.isRenderingPaused) && !window.odysseyMode.isEnteringLevel, at: performance.now() }; })()');
                        if (st && st.active) { back = st.at; break; }
                        await sleep(100);
                    }
                    await sleep(4000);
                });
                t1 = await nowIn(); rec.exit = await summ(t0, t1, `orb${orb}.exit`); rec.exit.mapMs = back && +(back - t0).toFixed(0);
                result.phases[`orb${orb}`] = rec; save();
                log(`orb ${orb} ${JSON.stringify(rec).slice(0, 3000)}`);
                await sleep(1500);
            }
        };
        runners.jump = async () => {
            await loadNodes();
            const here = await ev('window.__bc().cameraController.currentPosition');
            const chOfP = nodes.filter((n) => n[2] <= here).sort((a, b) => b[2] - a[2])[0];
            const ch = (chOfP && chOfP[1]) || 1;
            const targets = String(args.jumps || '').split(',').filter(Boolean).map(Number);
            const list = targets.length ? targets : [firstOf(ch + 1)].filter(Boolean);
            for (const orb of list) {
                const t0 = await nowIn();
                await ev(`window.__bc().travelToLevel(${orb}).then(() => true)`, 60000).catch((e) => log(`jump ${orb}: ${e.message}`));
                await sleep(2000);
                const t1 = await nowIn();
                result.phases[`jump${orb}`] = await summ(t0, t1, `jump${orb}`); save();
                log(`jump ${orb} ${JSON.stringify(result.phases[`jump${orb}`]).slice(0, 1500)}`);
            }
        };
        // Screenshots at fixed path positions (visual check): --shots=0.05,0.3,...
        runners.shots = async () => {
            const list = String(args.shots || '').split(',').filter(Boolean).map(Number);
            for (const p of list) {
                await ev(`(() => { const cc = window.__bc().cameraController; cc.setFollowMode && cc.setFollowMode(); const tm = cc.travelModel; if (tm) { tm.velocity = 0; tm.inputVelocity = 0; }
                  cc.setCurrentPosition ? cc.setCurrentPosition(${p}) : (cc.currentPosition = ${p}); cc.targetPosition = ${p}; return true; })()`).catch((e) => log(`shot seek ${e.message}`));
                await sleep(Number(args.shotSettle || 2500));
                const repeat = Number(args.shotRepeat || 1);
                for (let k = 0; k < repeat; k += 1) {
                    try {
                        const img = await win.webContents.capturePage();
                        writeFileSync(join(OUT, `shot-p${p.toFixed(3)}${repeat > 1 ? `-${k}` : ''}.png`), img.toPNG());
                        const st = await evq('(() => { const bc = window.__bc(); return { pr: bc.renderer.getPixelRatio(), t: +bc.time.toFixed(2), v: bc.postProcessingStack && bc.postProcessingStack._activeVariantKey }; })()');
                        log(`shot p=${p}#${k} ${JSON.stringify(st)}`);
                    } catch (e) { log(`shot ${p}: ${e.message}`); }
                    if (k + 1 < repeat) await sleep(Number(args.shotGap || 800));
                }
            }
        };
        for (const name of PHASES) {
            if (name === 'start') continue;
            if (!runners[name]) { log(`unknown phase ${name}`); continue; }
            try { await runners[name](); } catch (e) { log(`phase ${name} ERROR ${e && e.stack || e}`); result.phases[`${name}Error`] = String(e && e.message || e); save(); }
        }
        try { dbg.detach(); } catch { /* */ }
    } catch (e) { log(`ERROR ${e && e.stack || e}`); result.error = String(e && e.message || e); }
    save();
    win.destroy();
    await sleep(500);
    app.exit(0);
}
main().catch((e) => { log(`FATAL ${e && e.stack}`); app.exit(1); });
