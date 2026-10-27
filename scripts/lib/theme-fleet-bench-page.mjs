/**
 * Theme fleet bench: the in-page half, as source strings plus pure reducers.
 *
 * The bench plays the real game the way a player does (Single Player, a window the size of the
 * display, the chosen quality tier) and measures, per theme:
 *   - load: an in-play switch to the theme (the path a level-up or a theme pick takes), cold on a
 *     fresh profile and again warm on a second visit: time to running, to first frame, to fully
 *     shown, and the longest freeze the player sees meanwhile;
 *   - rest: frame rate and frame-time percentiles with the game running and no events;
 *   - storm: the same while locks, drops, clears, combos, T-spins and perfect clears fire;
 *   - gpu: a short window with GPU timestamps armed (they cost CPU, so the fps windows run
 *     without them).
 *
 * No Electron and no three import here: everything is a string the worker injects or a function
 * over plain numbers, so the reducers are unit-testable.
 */

/**
 * Document-start bootstrap. Runs AFTER the theme perf lane's bootstrap (same injection), which
 * supplies the pipeline hook, the renderer traps and the GPU timestamp rings.
 */
export const BENCH_BOOTSTRAP = `(() => {
  if (window.__BENCH__) return;
  // The perf lane's bootstrap forces the classic switch; the bench measures the real in-play
  // path (build behind, then a crossfade), so take that override back out.
  try { window.localStorage && window.localStorage.removeItem('serenity.themeSwitchBehind'); } catch (_) {}
  const now = () => performance.now();
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const B = {
    rec: false,
    frameId: 0,
    frameTimes: [],
    busyByT: new Map(),
    presents: new Map(),
    lastPresentFrame: new Map(),
    canvasIds: new WeakMap(),
    nextCanvasId: 1,
    longTasks: [],
    loafs: [],
    errors: [],
    nativeRaf,
  };
  window.__BENCH__ = B;

  // Every rAF callback is timed and summed per frame (keyed by the frame's rAF timestamp, which
  // all callbacks of one frame share): the page's main-thread work inside animation frames.
  window.requestAnimationFrame = function (cb) {
    return nativeRaf((t) => {
      const s = now();
      try { cb(t); } finally {
        if (B.rec) B.busyByT.set(t, (B.busyByT.get(t) || 0) + (now() - s));
      }
    });
  };

  const tick = (t) => {
    B.frameId += 1;
    if (B.rec) B.frameTimes.push(t);
    nativeRaf(tick);
  };
  nativeRaf(tick);

  // Presents: one getCurrentTexture per canvas per frame is one frame shown on that canvas.
  const labelOf = (canvas) => {
    try {
      const host = canvas.closest && canvas.closest('.theme-container');
      if (host && host.id) return host.id;
      if (canvas.id) return '#' + canvas.id;
      const p = canvas.parentElement;
      return p ? ('in:' + (p.id || p.className || p.tagName)) : 'detached';
    } catch (_) { return '?'; }
  };
  if (typeof GPUCanvasContext !== 'undefined') {
    const g = GPUCanvasContext.prototype.getCurrentTexture;
    GPUCanvasContext.prototype.getCurrentTexture = function () {
      if (B.rec) {
        const c = this.canvas;
        let id = B.canvasIds.get(c);
        if (!id) { id = B.nextCanvasId++; B.canvasIds.set(c, id); }
        if (B.lastPresentFrame.get(id) !== B.frameId) {
          B.lastPresentFrame.set(id, B.frameId);
          const key = id + '|' + labelOf(c);
          const cur = B.presents.get(key);
          if (cur) { cur.n += 1; cur.last = now(); }
          else B.presents.set(key, { n: 1, first: now(), last: now(), w: c.width, h: c.height });
        }
      }
      return g.call(this);
    };
  }

  try {
    new PerformanceObserver((list) => {
      if (!B.rec) return;
      for (const e of list.getEntries()) B.longTasks.push([+e.startTime.toFixed(1), +e.duration.toFixed(1)]);
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) {}
  try {
    new PerformanceObserver((list) => {
      if (!B.rec) return;
      for (const e of list.getEntries()) {
        const scripts = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration).slice(0, 4)
          .map((s) => ({ d: +s.duration.toFixed(1), fn: s.sourceFunctionName || '', url: (s.sourceURL || '').split('/').pop(), inv: s.invoker || '' }));
        B.loafs.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1), block: +(e.blockingDuration || 0).toFixed(1), render: +((e.renderStart ? (e.startTime + e.duration - e.renderStart) : 0)).toFixed(1), scripts });
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch (_) {}
  window.addEventListener('error', (e) => { if (B.errors.length < 50) B.errors.push(String(e.message || e)); });

  // The perf lane arms GPU timestamps on every renderer it traps. At 300-500 fps three's query
  // pool overflows and resets between resolves (so the per-frame figure undercounts), and a
  // revisit armed that way raised cross-device QuerySet errors. Timestamps stay off unless a
  // window asks for them (B.allowTimestamps); GPU load comes from nvidia-smi instead.
  const PS = window.__THEME_PERF__;
  if (PS && typeof PS.armWhenReady === 'function') {
    const arm = PS.armWhenReady;
    PS.armWhenReady = (renderer, attempt) => {
      arm(renderer, attempt);
      try {
        if (!B.allowTimestamps && PS.trackTimestampArmed && renderer && renderer.backend) {
          renderer.backend.trackTimestamp = false;
          PS.trackTimestampArmed = false;
        }
      } catch (_) {}
    };
  }

  // Device census: which GPUDevice each renderer runs on (a shared warm device, or its own), and
  // what requestAdapter + requestDevice cost a theme start.
  B.devices = [];
  B.adapters = [];
  if (typeof GPU !== 'undefined' && GPU.prototype.requestAdapter) {
    const ra = GPU.prototype.requestAdapter;
    GPU.prototype.requestAdapter = function (opts) {
      const at = now();
      return ra.call(this, opts).then((a) => { try { B.adapters.push({ at: +at.toFixed(1), ms: +(now() - at).toFixed(1) }); } catch (_) {} return a; });
    };
  }
  B.devicesDestroyed = 0;
  if (typeof GPUDevice !== 'undefined' && GPUDevice.prototype.destroy) {
    const ds = GPUDevice.prototype.destroy;
    GPUDevice.prototype.destroy = function () { if (!this.__benchDestroyed) { this.__benchDestroyed = true; B.devicesDestroyed += 1; } return ds.call(this); };
  }
  if (typeof GPUAdapter !== 'undefined') {
    const rd = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = function (desc) {
      const at = now();
      return rd.call(this, desc).then((d) => {
        try { d.__benchId = B.devices.length + 1; B.devices.push({ id: d.__benchId, at: +at.toFixed(1), ms: +(now() - at).toFixed(1) }); } catch (_) {}
        return d;
      });
    };
  }

  B.reset = () => {
    B.frameTimes = []; B.busyByT = new Map(); B.presents = new Map(); B.lastPresentFrame = new Map();
    B.longTasks = []; B.loafs = [];
  };
  B.take = () => {
    const busy = [];
    for (const t of B.frameTimes) busy.push(+(B.busyByT.get(t) || 0).toFixed(3));
    const presents = [];
    for (const [key, v] of B.presents) presents.push({ key, n: v.n, first: +v.first.toFixed(1), last: +v.last.toFixed(1), w: v.w, h: v.h });
    return { frameTimes: B.frameTimes.map((t) => +t.toFixed(3)), busy, presents, longTasks: B.longTasks.slice(), loafs: B.loafs.slice() };
  };
})();`;

/** Waits for the app to boot, applies the bench settings and starts Single Player on the anchor. */
export function buildStartSource({ quality, targetFps, anchorTheme, introWaitMs }) {
    return `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  while (!(window.serenityBlocks && window.serenityBlocks.gameModeManager && window.serenityBlocks.themeManager && window.serenityBlocks.settingsManager)) {
    if (performance.now() - t0 > 60000) return { error: 'app-not-ready' };
    await sleep(100);
  }
  const app = window.serenityBlocks;
  const bootMs = performance.now();
  app.settingsManager.update({
    effectQuality: ${JSON.stringify(quality)},
    targetFrameRate: ${Number(targetFps)},
    renderScale: 1,
    backgroundMode: 'Specific',
    backgroundTheme: ${JSON.stringify(anchorTheme)},
  });
  window.dispatchEvent(new CustomEvent('startGameWithMode', { detail: { mode: 'single' } }));
  const t1 = performance.now();
  const tm = app.themeManager;
  while (performance.now() - t1 < 60000) {
    const a = tm.activeTheme;
    const overlay = document.getElementById('cinematic-loading-overlay');
    const overlayUp = overlay && overlay.offsetParent !== null && getComputedStyle(overlay).opacity !== '0';
    if (a && a.lifecycleState === 'running' && !tm.isTransitioning && !overlayUp) break;
    await sleep(100);
  }
  if (!tm.activeTheme || tm.activeTheme.name !== ${JSON.stringify(anchorTheme)}) {
    try { await tm.switchTheme(${JSON.stringify(anchorTheme)}, true); } catch (_) {}
  }
  await sleep(${Number(introWaitMs)});
  if (!tm.activeTheme || tm.activeTheme.name !== ${JSON.stringify(anchorTheme)}) {
    try { await tm.switchTheme(${JSON.stringify(anchorTheme)}, true); } catch (_) {}
    await sleep(2000);
  }
  let adapter = null;
  try {
    const ad = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (ad && ad.info) adapter = { vendor: ad.info.vendor, architecture: ad.info.architecture, description: ad.info.description || '' };
  } catch (_) {}
  const s = app.settingsManager.get();
  return {
    bootMs: +bootMs.toFixed(0),
    anchor: tm.activeTheme && tm.activeTheme.name,
    mode: app.gameModeManager.getCurrentModeId && app.gameModeManager.getCurrentModeId(),
    dpr: window.devicePixelRatio, inner: [window.innerWidth, window.innerHeight],
    settings: { effectQuality: s.effectQuality, targetFrameRate: s.targetFrameRate, renderScale: s.renderScale, backgroundMode: s.backgroundMode },
    adapter,
  };
})()`;
}

/**
 * An in-play switch to `themeId` through the settings, as a player's pick does. Records the
 * frames (freezes), long tasks and presents from the request until the switch is settled and the
 * pipelines have been quiet for `quietMs`.
 */
export function buildLoadSource({ themeId, quietMs = 1500, capMs = 60000 }) {
    return `(async () => {
  const B = window.__BENCH__; const S = window.__THEME_PERF__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.serenityBlocks; const tm = app.themeManager;
  const target = ${JSON.stringify(themeId)};
  const containerId = target + '-theme';
  B.reset(); B.rec = true;
  if (S) S.marks = {}; // the lane's marks are first-wins: clear them so they belong to this start
  const pipesBefore = S ? S.pipes.length : 0;
  const t0 = performance.now();
  const marks = {};
  let done = false;
  const presentsOf = (id) => { let n = 0; for (const [k, v] of B.presents) if (k.endsWith('|' + id)) n += v.n; return n; };
  const poll = () => {
    if (done) return;
    const tt = +(performance.now() - t0).toFixed(1);
    const a = tm.activeTheme;
    const el = document.getElementById(containerId);
    if (marks.running === undefined && a && a.name === target && a.lifecycleState === 'running') marks.running = tt;
    if (marks.firstPresent === undefined && presentsOf(containerId) > 0) marks.firstPresent = tt;
    if (el) {
      const cs = getComputedStyle(el);
      const op = parseFloat(cs.opacity);
      const shown = el.classList.contains('active') || (cs.visibility !== 'hidden' && op > 0.02);
      if (marks.shown === undefined && shown && op > 0.02 && cs.visibility !== 'hidden') marks.shown = tt;
      if (marks.full === undefined && marks.shown !== undefined && op >= 0.995) marks.full = tt;
    }
    if (marks.settled === undefined && marks.running !== undefined && !tm.isTransitioning
        && !(tm.pendingThemeInstance)) marks.settled = tt;
    B.nativeRaf(poll);
  };
  B.nativeRaf(poll);
  app.settingsManager.update({ backgroundMode: 'Specific', backgroundTheme: target });
  let lastPipes = S ? S.pipes.length : 0; let quietSince = performance.now();
  while (performance.now() - t0 < ${Number(capMs)}) {
    await sleep(100);
    const n = S ? S.pipes.length : 0;
    if (n !== lastPipes) { lastPipes = n; quietSince = performance.now(); }
    if (marks.settled !== undefined && marks.full !== undefined && performance.now() - quietSince > ${Number(quietMs)}) break;
  }
  done = true;
  B.rec = false;
  const took = B.take();
  // Timelines relative to the request, gathered after the window closed (they cost nothing in it).
  const base = S ? (t0 - S.t0) : 0;
  const pipes = S ? S.pipes.slice(pipesBefore).map((p) => ({ label: p.label, ms: p.ms, at: +(p.atMs - base).toFixed(1), async: p.async })) : [];
  let resources = [];
  try {
    resources = performance.getEntriesByType('resource').filter((e) => e.startTime >= t0)
      .map((e) => ({ name: e.name.split('/').pop().split('?')[0], at: +(e.startTime - t0).toFixed(1), ms: +e.duration.toFixed(1), kb: Math.round((e.transferSize || e.encodedBodySize || 0) / 1024), type: e.initiatorType }));
  } catch (_) {}
  const themeMarks = {};
  try { for (const [k, v] of Object.entries(S ? S.marks : {})) themeMarks[k] = +(v - base).toFixed(1); } catch (_) {}
  const gpuInit = {
    adapters: (B.adapters || []).filter((a) => a.at >= t0).map((a) => ({ at: +(a.at - t0).toFixed(1), ms: a.ms })),
    devices: (B.devices || []).filter((d) => d.at >= t0).map((d) => ({ at: +(d.at - t0).toFixed(1), ms: d.ms })),
  };
  const active = tm.activeTheme;
  return {
    pipeList: pipes, resources, themeMarks, gpuInit,
    t0: +t0.toFixed(1), marks, timedOut: performance.now() - t0 >= ${Number(capMs)},
    active: active && active.name, state: active && active.lifecycleState,
    pipelines: pipes.length, syncPipelines: pipes.filter((p) => !p.async).length,
    pipeLast: pipes.length ? Math.max(...pipes.map((p) => p.at)) : null,
    ...took,
  };
})()`;
}

/** Fires one storm event every `everyMs` while the window records. */
const STORM_FN = `
  const E = window.__serenityGameplayEvents;
  const gs = window.serenityBlocks && window.serenityBlocks.gameState;
  const piece = () => {
    const p = gs && gs.currentPiece;
    if (p && p.shape) return p;
    return { type: 'T', shape: [[0, 1, 0], [1, 1, 1]], x: 4, y: 18, color: 0xa000f0 };
  };
  let level = 2;
  const rows = (n) => Array.from({ length: n }, (_, i) => 19 - i);
  const seq = [
    () => { E.emitPieceLock({ piece: piece() }); },
    () => { E.emitHardDrop({ piece: piece(), startY: 0, endY: 18, distance: 18 }); E.emitPieceLock({ piece: piece() }); },
    () => { E.emitHardDrop({ piece: piece(), startY: 0, endY: 18, distance: 18 }); E.emitPieceLock({ piece: piece() }); E.emitLineClear({ lineCount: 1, clearedRows: rows(1) }); },
    () => { E.emitPieceLock({ piece: piece() }); E.emitLineClear({ lineCount: 2, clearedRows: rows(2), comboCount: 1 }); E.emitCombo({ comboCount: 1 }); },
    () => { E.emitPieceLock({ piece: piece() }); E.emitTSpin({ lineCount: 2 }); E.emitLineClear({ lineCount: 2, clearedRows: rows(2), comboCount: 2 }); E.emitCombo({ comboCount: 2 }); E.emitB2B({ active: true }); },
    () => { E.emitHardDrop({ piece: piece(), startY: 0, endY: 18, distance: 18 }); E.emitPieceLock({ piece: piece() }); E.emitLineClear({ lineCount: 3, clearedRows: rows(3), comboCount: 3 }); E.emitCombo({ comboCount: 3 }); },
    () => { E.emitHardDrop({ piece: piece(), startY: 0, endY: 18, distance: 18 }); E.emitPieceLock({ piece: piece() }); E.emitLineClear({ lineCount: 4, clearedRows: rows(4), comboCount: 4 }); E.emitCombo({ comboCount: 4 }); E.emitB2B({ active: true }); },
    () => { E.emitPieceLock({ piece: piece() }); E.emitLineClear({ lineCount: 4, clearedRows: rows(4), comboCount: 5 }); E.emitCombo({ comboCount: 5 }); E.emitPerfectClear({ depth: 4, perfectClearBonus: 3000 }); },
    () => { E.emitLevelUp({ level: level++ }); },
  ];
  let k = 0;
  const fire = () => { try { seq[k % seq.length](); } catch (e) { B.errors.push('storm:' + String(e && e.message || e)); } k += 1; };
`;

/**
 * One measured window. kind: 'rest' (no events), 'storm' (events every everyMs), 'gpu' (rest with
 * GPU timestamps armed). The fps windows run with timestamps disarmed.
 */
export function buildWindowSource({ kind, ms, everyMs = 350 }) {
    return `(async () => {
  const B = window.__BENCH__; const S = window.__THEME_PERF__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const kind = ${JSON.stringify(kind)};
  const wantGpu = kind === 'gpu';
  let gpuArmed = false;
  try {
    const be = S && S.renderer && S.renderer.backend;
    if (be) {
      if (wantGpu) {
        const has = be.isWebGPUBackend ? !!(be.device && be.device.features && be.device.features.has('timestamp-query')) : !!be.disjoint;
        if (has) { B.allowTimestamps = true; be.trackTimestamp = true; S.trackTimestampArmed = true; gpuArmed = true; }
      } else { be.trackTimestamp = false; S.trackTimestampArmed = false; }
    }
  } catch (_) {}
  if (wantGpu) await sleep(500);
  ${STORM_FN}
  if (kind === 'storm' && !E) return { error: 'no-gameplay-events-handle' };
  if (window.__THEME_PERF_RESET__) window.__THEME_PERF_RESET__();
  if (S) S.startLane();
  B.reset(); B.rec = true;
  const t0 = performance.now();
  let timer = null;
  if (kind === 'storm') { fire(); timer = setInterval(fire, ${Number(everyMs)}); }
  await sleep(${Number(ms)});
  if (timer) clearInterval(timer);
  B.rec = false;
  if (S) S.stopLane();
  const took = B.take();
  const rings = S ? { cpu: S.rings.cpu.slice(), gpu: S.rings.gpu.slice(), calls: S.rings.calls.slice(), tris: S.rings.tris.slice() } : null;
  let pr = null;
  try { pr = S && S.renderer && typeof S.renderer.getPixelRatio === 'function' ? S.renderer.getPixelRatio() : null; } catch (_) {}
  let size = null;
  try { const c = S && S.renderer && S.renderer.domElement; if (c) size = [c.width, c.height]; } catch (_) {}
  const a = window.serenityBlocks.themeManager.activeTheme;
  if (wantGpu) { B.allowTimestamps = false; try { const be = S.renderer.backend; be.trackTimestamp = false; S.trackTimestampArmed = false; } catch (_) {} }
  return {
    kind, ms: +(performance.now() - t0).toFixed(1), gpuArmed, events: kind === 'storm' ? k : 0,
    active: a && a.name, pixelRatio: pr, canvasSize: size,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    errors: B.errors.splice(0),
    rings, ...took,
  };
})()`;
}

// ---------------------------------------------------------------------------------------------
// Pure reducers
// ---------------------------------------------------------------------------------------------

/** Linear-interpolated percentile of a numeric array (copy sorted inside). */
export function percentile(values, p) {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    if (v.length === 1) return v[0];
    const idx = (p / 100) * (v.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

const round = (x, d = 2) => (Number.isFinite(x) ? Number(x.toFixed(d)) : null);

/**
 * Frame statistics from rAF timestamps. `budgetMs` is the frame budget the target implies
 * (4.17 ms at 240 fps). Intervals over 1.5x the median count as janks.
 */
export function frameStats(frameTimes, { budgetMs = 1000 / 240 } = {}) {
    if (!Array.isArray(frameTimes) || frameTimes.length < 3) return null;
    const iv = [];
    for (let i = 1; i < frameTimes.length; i += 1) iv.push(frameTimes[i] - frameTimes[i - 1]);
    const span = frameTimes[frameTimes.length - 1] - frameTimes[0];
    const p50 = percentile(iv, 50);
    return {
        frames: iv.length,
        fps: round((iv.length / span) * 1000, 1),
        p50: round(p50),
        p95: round(percentile(iv, 95)),
        p99: round(percentile(iv, 99)),
        max: round(Math.max(...iv)),
        overBudget: iv.filter((x) => x > budgetMs * 1.05).length,
        overBudgetPct: round((iv.filter((x) => x > budgetMs * 1.05).length / iv.length) * 100, 1),
        janks: iv.filter((x) => x > p50 * 1.5 && x > budgetMs).length,
        over16: iv.filter((x) => x > 16.7).length,
        over33: iv.filter((x) => x > 33.4).length,
    };
}

/** p50/p95 of a ring of per-frame samples (ms). */
export function ringStats(ring) {
    if (!Array.isArray(ring) || !ring.length) return null;
    return { n: ring.length, p50: round(percentile(ring, 50), 3), p95: round(percentile(ring, 95), 3) };
}

/** Freeze metrics of a load window: what a player sees while the switch runs. */
export function loadFreeze(frameTimes, longTasks = []) {
    const iv = [];
    for (let i = 1; i < (frameTimes || []).length; i += 1) iv.push(frameTimes[i] - frameTimes[i - 1]);
    const longest = iv.length ? Math.max(...iv) : null;
    const frozen = iv.filter((x) => x > 50).reduce((sum, x) => sum + x, 0);
    const ltMax = longTasks.length ? Math.max(...longTasks.map((t) => t[1])) : 0;
    const ltSum = longTasks.reduce((sum, t) => sum + t[1], 0);
    return {
        longestFrameMs: round(longest, 1),
        framesOver50: iv.filter((x) => x > 50).length,
        framesOver100: iv.filter((x) => x > 100).length,
        frozenMs: round(frozen, 0),
        longTaskMaxMs: round(ltMax, 0),
        longTaskSumMs: round(ltSum, 0),
        longTasks: longTasks.length,
    };
}

/** The theme canvas's presents per second in a window (the theme's own frame rate). */
export function themePresentRate(presents, themeId, windowMs) {
    const mine = (presents || []).filter((p) => p.key.endsWith(`|${themeId}-theme`));
    if (!mine.length || !windowMs) return null;
    const n = mine.reduce((s, p) => s + p.n, 0);
    return round((n / windowMs) * 1000, 1);
}

/**
 * What limits a window's frame rate. 'ok' when it holds the budget; else 'gpu' when the GPU is
 * near-saturated, 'main' when the page's main thread fills the frame, otherwise 'other' (the GPU
 * process, the compositor or the hand-off between them).
 */
export function classifyBottleneck({ fps, p50, busyP50, gpuUtil }, { budgetMs = 1000 / 240 } = {}) {
    if (!Number.isFinite(fps)) return null;
    if (p50 <= budgetMs * 1.02 && fps >= (1000 / budgetMs) * 0.98) return 'ok';
    if (Number.isFinite(gpuUtil) && gpuUtil >= 90) return 'gpu';
    if (Number.isFinite(busyP50) && busyP50 >= p50 * 0.75) return 'main';
    return 'other';
}

/** Reduce one worker cell (raw phases) to the numbers the fleet table shows. */
export function summarizeCell(cell, { budgetMs = 1000 / 240 } = {}) {
    const out = { theme: cell.themeId, quality: cell.quality, ok: !cell.error, error: cell.error || null };
    const win = (name) => cell.phases?.[name] || null;
    const cores = cell.cores || 1;
    for (const name of ['rest', 'storm1', 'storm2', 'gpu']) {
        const w = win(name);
        if (!w || w.error) { out[name] = w?.error ? { error: w.error } : null; continue; }
        const fs = frameStats(w.frameTimes, { budgetMs });
        const util = w.gpuUtil?.util;
        const busyP50 = round(percentile(w.busy, 50), 2);
        out[name] = {
            ...fs,
            gpuMsEst: fs && Number.isFinite(util) ? round((util / 100) * (1000 / fs.fps), 2) : null,
            limit: fs ? classifyBottleneck({ fps: fs.fps, p50: fs.p50, busyP50, gpuUtil: util }, { budgetMs }) : null,
            procCores: w.procCpu ? Object.fromEntries(Object.entries(w.procCpu).map(([k, v]) => [k, round((v * cores) / 100, 2)])) : null,
            presentFps: themePresentRate(w.presents, cell.themeId, w.ms),
            busyP50,
            busyP95: round(percentile(w.busy, 95), 2),
            cpuInRender: ringStats(w.rings?.cpu),
            gpu: ringStats(w.rings?.gpu),
            draws: ringStats(w.rings?.calls),
            longTasks: w.longTasks?.length || 0,
            pixelRatio: w.pixelRatio,
            canvasSize: w.canvasSize,
            active: w.active,
            gpuUtil: w.gpuUtil ?? null,
            procCpu: w.procCpu ?? null,
        };
    }
    for (const name of ['load1', 'load2']) {
        const l = win(name);
        if (!l || l.error) { out[name] = l?.error ? { error: l.error } : null; continue; }
        out[name] = {
            ...l.marks,
            timedOut: l.timedOut,
            pipelines: l.pipelines,
            syncPipelines: l.syncPipelines,
            pipeLast: l.pipeLast,
            ...loadFreeze(l.frameTimes, l.longTasks),
            topLoafs: (l.loafs || []).slice().sort((a, b) => b.dur - a.dur).slice(0, 3),
        };
    }
    return out;
}
