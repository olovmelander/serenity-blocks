/**
 * Theme perf lane — the in-page instrument, as pure source strings plus a pure reducer.
 *
 * No Electron import, no `three` import, no filesystem: everything here is a string the worker
 * injects, or a function over the payload that comes back. That keeps the lane unit-testable
 * without a GPU (same reason `scripts/lib/hitch-stats.mjs` is pure).
 *
 * Design constraints that are NOT negotiable, each with the reason:
 *
 *  - THE PIPELINE HOOK MUST BE INSTALLED BEFORE THE PAGE'S FIRST SCRIPT. The app builds a theme
 *    during boot (`main.js` prepareFirstThemeBeforeIntro -> loadInitialTheme -> switchTheme), so an
 *    `executeJavaScript` after `loadURL` has already missed a whole theme's pipeline set. The worker
 *    injects `THEME_PERF_BOOTSTRAP` through CDP `Page.addScriptToEvaluateOnNewDocument`, which runs
 *    in the MAIN world at document start. A `preload` script cannot do this: the worker sets
 *    `contextIsolation: true`, and an isolated world has its own copies of the built-in prototypes,
 *    so a `GPUDevice.prototype` patch there would never be seen by page code.
 *
 *  - GPU SAMPLES ARE RECORDED ONCE PER RESOLVED QUERY, NEVER ONCE PER FRAME (ADR-0016). three's
 *    `Info.reset()` clears drawCalls/triangles but deliberately NOT `render.timestamp`
 *    (three/src/renderers/common/Info.js) — only `dispose()` does. Reading the field per frame
 *    records one resolved value repeated for however many frames it lingered, and a slower theme
 *    resolves less often, so its samples weigh more. The bias lands hardest on exactly the theme
 *    being judged.
 *
 *  - SYNC PIPELINE CREATIONS GET `ms: null`, NEVER A NUMBER. `createRenderPipeline` returns at once
 *    and the GPU process blocks at first draw, so any duration measured around the call is a lie.
 *    They are recorded because they are the post-reveal stall candidates.
 *
 *  - RENDERER KIND, NOT BACKEND (ADR-0019). `renderer.isWebGPURenderer` is true on BOTH the WebGPU
 *    and the WebGL2 backend. A classic `THREE.WebGLRenderer` has no timestamp API at all in
 *    0.185.1, so its `gpuMs` is null with a reason — that is a property of the renderer kind, not
 *    a defect and not debt (ADR-0008).
 */

/** GPU timestamps land on 65.536 µs boundaries. Below this, "difference below resolution". */
export const GPU_QUANTUM_MS = 0.065536;

/**
 * Document-start bootstrap. Installs the device-level pipeline hook, the canvas-context census,
 * and the theme/renderer traps that `src/themes/base-theme.js` arms.
 *
 * Written as a string because it must be injected before any page script exists.
 */
export const THEME_PERF_BOOTSTRAP = `(() => {
  if (window.__THEME_PERF__) return;
  const S = {
    t0: performance.now(),
    pipes: [],
    contexts: [],
    marks: {},
    epoch: 0,
    laneFrameId: 0,
    latchedFrameId: -1,
    renderer: null,
    theme: null,
    kind: null,
    backend: null,
    trackTimestampArmed: false,
    timestampUnavailableReason: null,
    infoResetsByTheme: 0,
    infoOwned: false,
    cpuAccumMs: 0,
    wrapped: [],
    rings: { wall: [], cpu: [], gpu: [], calls: [], tris: [] },
    gpuPending: false,
    lastFrameAt: 0,
    heap: [],
    longTasks: { count: 0, totalMs: 0, maxMs: 0 },
  };
  window.__THEME_PERF__ = S;

  const now = () => performance.now();
  const rel = (t) => +((t === undefined ? now() : t) - S.t0).toFixed(2);

  // ---- 1) DEVICE-LEVEL PIPELINE HOOK -------------------------------------------------------
  // Must be the first thing that touches WebGPU. Patching the PROTOTYPE means it applies to every
  // GPUDevice, created before or after — the real requirement is "installed before the first
  // createRenderPipeline* CALL", which document-start satisfies.
  if (typeof GPUDevice !== 'undefined') {
    const shape = (d) => ({
      targets: ((d && d.fragment && d.fragment.targets) || [])
        .map((t) => (t ? t.format : null)).join(','),
      samples: (d && d.multisample && d.multisample.count) || 1,
      depth: (d && d.depthStencil && d.depthStencil.format) || null,
    });
    const A = GPUDevice.prototype.createRenderPipelineAsync;
    GPUDevice.prototype.createRenderPipelineAsync = function (desc) {
      const t = now();
      // Capture label + shape SYNCHRONOUSLY: three reuses one module-level descriptor object and
      // resets it immediately after the call, before this promise resolves.
      const label = (desc && desc.label) || '?';
      const shp = shape(desc);
      const p = A.call(this, desc);
      p.then(
        () => S.pipes.push({ label, ms: +(now() - t).toFixed(2), atMs: rel(t), async: true, ...shp }),
        () => S.pipes.push({ label, ms: null, atMs: rel(t), async: true, failed: true, ...shp }),
      );
      return p;
    };
    const Sy = GPUDevice.prototype.createRenderPipeline;
    GPUDevice.prototype.createRenderPipeline = function (desc) {
      // ms is ALWAYS null: the call returns at once, the GPU process blocks at first draw.
      S.pipes.push({ label: (desc && desc.label) || '?', ms: null, atMs: rel(), async: false, ...shape(desc) });
      return Sy.call(this, desc);
    };
  }

  // ---- 2) CANVAS CONTEXT CENSUS ------------------------------------------------------------
  // Renderer-kind ground truth that does not depend on three at all.
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const ctx = gc.call(this, kind, ...rest);
    if (ctx) S.contexts.push({ kind, atMs: rel() });
    return ctx;
  };

  // ---- 3) LONG TASKS -----------------------------------------------------------------------
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        S.longTasks.count += 1;
        S.longTasks.totalMs += e.duration;
        if (e.duration > S.longTasks.maxMs) S.longTasks.maxMs = e.duration;
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch (_) { /* not all builds expose longtask */ }

  // ---- 4) THEME + RENDERER TRAPS -----------------------------------------------------------
  S.mark = (name) => { if (S.marks[name] === undefined) S.marks[name] = rel(); };

  S.noteThemeStart = (theme) => {
    S.theme = theme;
    S.mark('t2_createSceneEnter');
    if (theme.__themePerfTrapped) return;
    theme.__themePerfTrapped = true;
    // A setter trap, not a poll: theme.renderer is assigned in ~50 different files and the manager
    // gives no earlier handle. A 1 ms poll starves under the startup's long tasks.
    let held = theme.renderer;
    try {
      Object.defineProperty(theme, 'renderer', {
        configurable: true,
        get() { return held; },
        set(v) { held = v; if (v) S.onRenderer(v); },
      });
    } catch (_) { /* non-configurable: fall back to the next-frame sweep */ }
    if (held) S.onRenderer(held);
  };

  S.noteThemeStop = () => {
    // Disarm BEFORE BaseTheme's own dispose path collects in-flight resolves, and never re-arm.
    try {
      if (S.renderer && S.renderer.backend) S.renderer.backend.trackTimestamp = false;
    } catch (_) { /* torn down */ }
    S.trackTimestampArmed = false;
  };

  S.onRenderer = (renderer) => {
    if (!renderer || S.renderer === renderer) return;
    S.renderer = renderer;
    S.mark('t3_rendererCreated');
    // ADR-0019: gate on renderer KIND. isWebGPURenderer is true on BOTH backends.
    S.kind = renderer.isWebGPURenderer === true ? 'WebGPURenderer' : 'WebGLRenderer';
    S.wrapRenderEntries(renderer);
    S.armWhenReady(renderer, 0);
  };

  // Wrapping info.reset is what tells countAround which read is correct, so it must happen for
  // EVERY renderer kind. It used to sit below the backend guard — and a classic
  // THREE.WebGLRenderer has no .backend at all, so that guard bailed forever and all 20 classic
  // themes reported 0 draws. Ownership first, backend-specific arming second.
  S.ownInfo = (renderer) => {
    if (S.infoOwned) return;
    try {
      const origReset = renderer.info.reset.bind(renderer.info);
      renderer.info.reset = function () {
        S.infoResetsByTheme += 1;
        S.resetDuringCall = true;
        return origReset();
      };
      S.infoResetsByTheme = 0;
      S.infoOwned = true;
    } catch (_) { /* frozen or unusual info shape */ }
  };

  S.armWhenReady = (renderer, attempt) => {
    if (S.renderer !== renderer || attempt > 600) return;
    S.ownInfo(renderer);

    // A classic renderer is fully armed at this point: it has no backend and no timestamp API in
    // 0.185.1 (ADR-0019 — a property of the renderer KIND, not a defect and not debt).
    if (S.kind !== 'WebGPURenderer') {
      S.timestampUnavailableReason = 'classic-webgl-renderer-has-no-timestamp-api';
      return;
    }

    let ready = true;
    try { ready = renderer.hasInitialized ? renderer.hasInitialized() !== false : true; } catch (_) { ready = true; }
    const backend = renderer.backend;
    if (!ready || !backend) { requestAnimationFrame(() => S.armWhenReady(renderer, attempt + 1)); return; }

    S.backend = backend.isWebGPUBackend ? 'webgpu' : (backend.isWebGLBackend ? 'webgl2' : null);

    if (backend.isWebGPUBackend) {
      // WebGPUBackend.init collapses trackTimestamp against feature support ONCE and never
      // re-checks, so flipping it back on without this guard would arm timestamp writes on a
      // device that cannot serve them.
      let has = false;
      try { has = !!(backend.device && backend.device.features && backend.device.features.has('timestamp-query')); } catch (_) { has = false; }
      if (has) { backend.trackTimestamp = true; S.trackTimestampArmed = true; }
      else S.timestampUnavailableReason = 'device-lacks-timestamp-query-feature';
    } else if (backend.isWebGLBackend) {
      let has = false;
      try { has = !!backend.disjoint; } catch (_) { has = false; }
      if (has) { backend.trackTimestamp = true; S.trackTimestampArmed = true; }
      else S.timestampUnavailableReason = 'no-EXT_disjoint_timer_query_webgl2';
    } else {
      S.timestampUnavailableReason = 'unknown-backend';
    }

  };

  S.wrapRenderEntries = (renderer) => {
    // Same owner set the lifecycle lane's probeRenderActivity enumerates, so the two lanes cannot
    // disagree about what "the theme's render entry" means.
    const owners = [renderer, S.theme && S.theme.post, S.theme && S.theme.postProcessing,
      S.theme && S.theme.postComposer, S.theme && S.theme.composer];
    for (const owner of owners) {
      if (!owner || owner.__themePerfWrapped) continue;
      for (const m of ['render', 'renderAsync']) {
        if (typeof owner[m] !== 'function') continue;
        const orig = owner[m].bind(owner);
        owner[m] = function (...args) {
          S.mark('t6_firstRenderCall');
          const t = now();
          const out = S.countAround(() => orig(...args));
          S.cpuAccumMs += now() - t;
          return out;
        };
      }
      try { owner.__themePerfWrapped = true; } catch (_) { /* frozen */ }
      S.wrapped.push(owner === renderer ? 'renderer' : 'post');
    }
  };

  // Draw counting by DELTA across each render call, accumulated per lane frame.
  //
  // The obvious implementation — read info.render at frame start and reset it ourselves — fights
  // every theme that already owns Info (cosmic-noir, ocean and stillwater all set autoReset=false
  // and reset manually), and the first measured cell came back 0 draws / "contested" because of
  // exactly that. A delta across the call is owner-agnostic: if the theme reset in between, the
  // post value IS this call's count, so fall back to it rather than to a negative.
  S.frameDraws = 0;
  S.frameTris = 0;
  // Whether Info was reset DURING the call decides how to read the counters, and the two renderer
  // kinds differ:
  //   classic WebGLRenderer — resets at the top of every render() (WebGLRenderer.js:1702), so the
  //     post value IS this call's count and a delta would read ~0 whenever consecutive frames draw
  //     the same amount. That is exactly what happened: all 20 classic themes reported 0 draws
  //     against ~1300 CPU samples.
  //   WebGPURenderer — only three's own animation loop resets (common/Animation.js:75), and most
  //     themes run their own rAF, so the counters accumulate and the delta is the per-call figure.
  // Rather than branch on kind, observe it: the wrapped info.reset sets a flag.
  S.resetDuringCall = false;
  // The two renderer kinds do not even name the counter the same thing: classic WebGLInfo exposes
  // calls and has NO drawCalls (webgl/WebGLInfo.js:10-16), while r185 common/Info has both
  // (common/Info.js:67-75). Reading drawCalls alone yielded undefined -> NaN on every classic
  // theme, and NaN > 0 is false, so nothing was ever recorded and the cell published null.
  S.drawsOf = (rr) => (Number.isFinite(rr.drawCalls) ? rr.drawCalls : rr.calls);
  S.countAround = (fn) => {
    const rr = S.renderer && S.renderer.info && S.renderer.info.render;
    if (!rr) return fn();
    const preD = S.drawsOf(rr); const preT = rr.triangles;
    S.resetDuringCall = false;
    try {
      return fn();
    } finally {
      const reset = S.resetDuringCall;
      const postD = S.drawsOf(rr); const postT = rr.triangles;
      const d = reset ? postD : Math.max(0, postD - preD);
      const tri = reset ? postT : Math.max(0, postT - preT);
      // Never let a non-finite read poison the accumulator into silence.
      if (Number.isFinite(d)) S.frameDraws += d;
      if (Number.isFinite(tri)) S.frameTris += tri;
    }
  };

  // ---- 5) GPU RESOLVE — ONE PUSH PER RESOLVED QUERY ----------------------------------------
  S.resolveRender = () => {
    const r = S.renderer;
    if (!r || typeof r.resolveTimestampsAsync !== 'function') return;
    if (S.gpuPending || !S.trackTimestampArmed) return;
    const epoch = S.epoch;
    S.gpuPending = true;
    r.resolveTimestampsAsync('render')
      .then(() => {
        const ts = r.info && r.info.render && r.info.render.timestamp;
        // The epoch check is what stops a settle-phase resolve still in flight from landing
        // inside the measurement window.
        if (epoch === S.epoch && Number.isFinite(ts) && ts > 0) S.rings.gpu.push(ts);
      })
      .catch(() => {})
      .finally(() => { S.gpuPending = false; });
  };

  // ---- 6) LANE rAF -------------------------------------------------------------------------
  S.laneRunning = false;
  S.laneTick = (t) => {
    if (!S.laneRunning) return;
    S.laneFrameId += 1;
    if (S.renderer) S.wrapRenderEntries(S.renderer);
    if (S.lastFrameAt) S.rings.wall.push(t - S.lastFrameAt);
    S.lastFrameAt = t;
    if (S.cpuAccumMs > 0) { S.rings.cpu.push(S.cpuAccumMs); S.cpuAccumMs = 0; }
    if (S.frameDraws > 0) { S.rings.calls.push(S.frameDraws); S.rings.tris.push(S.frameTris); }
    S.frameDraws = 0; S.frameTris = 0;
    S.resolveRender();
    requestAnimationFrame(S.laneTick);
  };
  S.startLane = () => {
    if (S.laneRunning) return;
    S.laneRunning = true; S.lastFrameAt = 0; S.cpuAccumMs = 0;
    requestAnimationFrame(S.laneTick);
  };
  S.stopLane = () => { S.laneRunning = false; };

  // ---- 7) RESET ----------------------------------------------------------------------------
  window.__THEME_PERF_RESET__ = () => {
    // Bump the epoch BEFORE clearing, so an in-flight resolve cannot land in the new window.
    S.epoch += 1;
    S.rings.wall.length = 0; S.rings.cpu.length = 0; S.rings.gpu.length = 0;
    S.rings.calls.length = 0; S.rings.tris.length = 0;
    S.heap.length = 0;
    S.longTasks = { count: 0, totalMs: 0, maxMs: 0 };
    S.laneFrameId = 0; S.latchedFrameId = -1; S.lastFrameAt = 0; S.cpuAccumMs = 0;
    S.frameDraws = 0; S.frameTris = 0;
    S.infoResetsByTheme = 0;
    return true;
  };
})();`;

/**
 * The in-page driver for one visit to the target theme. Returns the raw payload for that visit.
 *
 * @param {object} options
 * @param {string} options.themeId       theme to switch to
 * @param {string} options.anchorTheme   theme to return to between visits
 * @param {number} options.idleMs        length of the measured idle window
 * @param {number} options.settleMs      quiet time after the switch, before the window
 * @param {number} options.quietPipelineMs  no new pipeline for this long = compile finished
 * @param {number} options.compileCapMs  hard cap on the compile wait
 * @returns {string} an async IIFE source string
 */
export function buildPerfVisitSource({
    themeId, anchorTheme, idleMs, settleMs, quietPipelineMs = 2_000, compileCapMs = 90_000,
    switchCapMs = 120_000, criticalCapMs = 60_000,
}) {
    return `(async () => {
  const S = window.__THEME_PERF__;
  if (!S) return { error: 'instrument-not-installed' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // EVERY page-side await is bounded. An unbounded one cannot fail: it hangs until the ORCHESTRATOR
  // kills the worker, which loses the whole report — exactly how the first smoke run was lost.
  const bounded = (promise, ms, label) => Promise.race([
    Promise.resolve(promise).catch((e) => ({ __err: String(e && e.message || e) })),
    sleep(ms).then(() => ({ __timeout: label })),
  ]);
  // Progress is written to a global the worker can read after a timeout, so a hang says WHERE.
  const stage = (name) => { window.__THEME_PERF_STAGE__ = name; };
  stage('start');
  const manager = window.serenityBlocks && window.serenityBlocks.themeManager;
  if (!manager) return { error: 'theme-manager-missing' };

  S.marks = {};
  S.pipes.length = 0;
  window.__THEME_PERF_RESET__();

  S.mark('t0_requested');
  stage('switch');
  const t0 = performance.now();
  // switchTheme directly, not the hub card: the card path adds hub DOM construction and a settle
  // poll to the measured interval, and reaches the same manager entry point anyway.
  const switchOutcome = await bounded(
    manager.switchTheme(${JSON.stringify(themeId)}, true), ${switchCapMs}, 'switchTheme',
  );
  S.mark('t4_startResolved');
  stage('criticalReady');

  const theme = manager.activeTheme || manager.currentTheme || S.theme;
  let criticalOutcome = null;
  if (theme && typeof theme.whenCriticalReady === 'function') {
    criticalOutcome = await bounded(theme.whenCriticalReady(), ${criticalCapMs}, 'whenCriticalReady');
  }
  S.mark('t5_criticalReady');

  // Wait for the compile to go quiet rather than for a fixed time: a theme that compiles
  // synchronously on its first frames is exactly the case a fixed wait would truncate.
  // TRUE first-frame fence, taken BEFORE the compile-quiet wait.
  //
  // The mark below it (t7) sits after a loop that sleeps 2000-2100 ms with no new pipeline, so it
  // answers "when had everything quiesced", not "when did the first frame land". Both are worth
  // having, but only this one is a latency a player experiences. Kept separate rather than
  // reinterpreted, because a mark whose name does not match what it brackets is how a wrong number
  // gets quoted as fact (ADR-0016).
  stage('firstFrameFence');
  let firstFrameMethod = null;
  try {
    const r0 = S.renderer;
    if (r0 && r0.backend && r0.backend.isWebGPUBackend && r0.backend.device) {
      const d0 = await bounded(r0.backend.device.queue.onSubmittedWorkDone(), 60000, 'firstFrameFence');
      firstFrameMethod = (d0 && d0.__timeout) ? 'onSubmittedWorkDone-timeout' : 'queue.onSubmittedWorkDone';
    } else {
      const gl0 = (r0 && r0.backend && r0.backend.gl)
        || (r0 && typeof r0.getContext === 'function' ? r0.getContext() : null);
      if (gl0 && typeof gl0.fenceSync === 'function') {
        const s0 = gl0.fenceSync(gl0.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl0.flush();
        for (let i = 0; i < 600; i += 1) {
          const st = gl0.clientWaitSync(s0, 0, 0);
          if (st === gl0.ALREADY_SIGNALED || st === gl0.CONDITION_SATISFIED) break;
          await new Promise((res) => requestAnimationFrame(res));
        }
        gl0.deleteSync(s0);
        firstFrameMethod = 'fenceSync';
      } else {
        firstFrameMethod = gl0 ? 'webgl1-no-fence-sync' : 'no-gpu-context';
      }
    }
  } catch (_) { firstFrameMethod = 'probe-threw'; }
  S.mark('t6b_firstFrameGpuDone');

  stage('compileQuiet');
  const capAt = performance.now() + ${compileCapMs};
  let lastCount = -1;
  let quietSince = performance.now();
  while (performance.now() < capAt) {
    if (S.pipes.length !== lastCount) { lastCount = S.pipes.length; quietSince = performance.now(); }
    else if (performance.now() - quietSince > ${quietPipelineMs}) break;
    await sleep(100);
  }

  // First GPU-work completion. NOT "presented" — a page cannot observe scanout.
  stage('firstGpuWork');
  let gpuDoneMethod = null;
  try {
    const r = S.renderer;
    if (r && r.backend && r.backend.isWebGPUBackend && r.backend.device) {
      // Bounded: a lost device never settles this, and an unbounded wait here loses the report.
      const done = await bounded(r.backend.device.queue.onSubmittedWorkDone(), 30000, 'onSubmittedWorkDone');
      gpuDoneMethod = (done && done.__timeout) ? 'onSubmittedWorkDone-timeout' : 'queue.onSubmittedWorkDone';
    } else {
      const gl = (r && r.backend && r.backend.gl)
        || (r && typeof r.getContext === 'function' ? r.getContext() : null);
      if (gl && typeof gl.fenceSync === 'function') {
        const s = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        for (let i = 0; i < 240; i += 1) {
          const st = gl.clientWaitSync(s, 0, 0);
          if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) break;
          await new Promise((res) => requestAnimationFrame(res));
        }
        gl.deleteSync(s);
        gpuDoneMethod = 'fenceSync';
      } else {
        gpuDoneMethod = gl ? 'webgl1-no-fence-sync' : 'no-gpu-context';
      }
    }
  } catch (_) { gpuDoneMethod = 'probe-threw'; }
  S.mark('t7_firstGpuWorkDone');
  await new Promise((res) => requestAnimationFrame(res));
  S.mark('t8_firstRafAfterGpu');

  stage('settle');
  const compilePipes = S.pipes.slice();

  await sleep(${settleMs});

  // Discard the compile window from the idle rings: a cold compile is a real cost, but it is a
  // STARTUP cost, and averaging it into steady state hides both.
  window.__THEME_PERF_RESET__();
  const heapTimer = setInterval(() => {
    try { if (performance.memory) S.heap.push(performance.memory.usedJSHeapSize); } catch (_) {}
  }, 250);
  stage('idle');
  S.startLane();
  const windowStart = performance.now();
  const pinsAtStart = window.__THEME_PERF_PINS__ ? window.__THEME_PERF_PINS__() : null;
  await sleep(${idleMs});
  const pinsAtEnd = window.__THEME_PERF_PINS__ ? window.__THEME_PERF_PINS__() : null;
  S.stopLane();
  stage('collect');
  clearInterval(heapTimer);
  const windowMs = performance.now() - windowStart;

  // Material id -> class, from the live scene graph. The pipeline label carries material.name when
  // a theme set one, so the class is unrecoverable from the string alone.
  const byId = {};
  try {
    const note = (m) => { if (m) byId[m.id] = { type: m.type, name: m.name || null, isNodeMaterial: !!m.isNodeMaterial }; };
    const sc = theme && theme.scene;
    if (sc && typeof sc.traverse === 'function') {
      sc.traverse((o) => { const m = o.material; if (!m) return; Array.isArray(m) ? m.forEach(note) : note(m); });
    }
  } catch (_) {}

  let info = null;
  try {
    const i = S.renderer && S.renderer.info;
    if (i) info = { geometries: i.memory && i.memory.geometries, textures: i.memory && i.memory.textures, programs: i.programs ? i.programs.length : null };
  } catch (_) {}

  stage('done');
  return {
    themeId: ${JSON.stringify(themeId)},
    switchOutcome: (switchOutcome && (switchOutcome.__timeout || switchOutcome.__err)) || null,
    criticalOutcome: (criticalOutcome && (criticalOutcome.__timeout || criticalOutcome.__err)) || null,
    anchorTheme: ${JSON.stringify(anchorTheme)},
    marks: S.marks,
    switchWallMs: +(S.marks.t4_startResolved || 0) - +(S.marks.t0_requested || 0),
    managerReportedMs: (() => {
      try {
        const rep = window.perfMonitor && window.perfMonitor.report ? window.perfMonitor.report() : null;
        const sw = rep && rep.themeSwitches;
        if (!sw) return null;
        return typeof sw.lastMs === 'number' ? sw.lastMs : (typeof sw.last === 'number' ? sw.last : null);
      } catch (_) { return null; }
    })(),
    gpuDoneMethod,
    firstFrameMethod,
    compilePipes,
    idlePipes: S.pipes.length - compilePipes.length,
    rings: {
      wall: S.rings.wall.slice(),
      cpu: S.rings.cpu.slice(),
      gpu: S.rings.gpu.slice(),
      calls: S.rings.calls.slice(),
      tris: S.rings.tris.slice(),
    },
    framesObserved: S.laneFrameId,
    windowMs,
    longTasks: S.longTasks,
    heap: S.heap.slice(),
    infoResetsByTheme: S.infoResetsByTheme,
    renderer: {
      kind: S.kind,
      backend: S.backend,
      trackTimestampArmed: S.trackTimestampArmed,
      timestampUnavailableReason: S.timestampUnavailableReason,
      canvasContexts: S.contexts.slice(),
      wrapped: S.wrapped.slice(),
      usesMrtScenePass: (() => { try { return theme && typeof theme.usesMrtScenePass === 'function' ? !!theme.usesMrtScenePass() : null; } catch (_) { return null; } })(),
    },
    info,
    materialsById: byId,
    pins: { atStart: pinsAtStart, atEnd: pinsAtEnd },
    t0,
  };
})()`;
}

/** Source for the pin-and-observe helper, injected once before the first visit. */
export function buildPinSource({ quality, targetFps }) {
    return `(() => {
  const q = ${JSON.stringify(quality)};
  window.settings = { ...(window.settings || {}),
    effectQuality: q, graphicsQuality: q,
    targetFrameRate: ${Number(targetFps)},
    adaptiveResolution: false, dynamicResolution: false };
  try {
    window.settingsManager && window.settingsManager.update && window.settingsManager.update({
      effectQuality: q, graphicsQuality: q, targetFrameRate: ${Number(targetFps)},
    });
  } catch (_) {}
  // Observe rather than assume: a pin that silently did not hold makes every timing inadmissible.
  window.__THEME_PERF_PINS__ = () => {
    const S = window.__THEME_PERF__;
    const r = S && S.renderer;
    let pixelRatio = null;
    try { pixelRatio = r && typeof r.getPixelRatio === 'function' ? r.getPixelRatio() : null; } catch (_) {}
    return {
      quality: (window.settings && window.settings.effectQuality) || null,
      targetFrameRate: (window.settings && window.settings.targetFrameRate) || null,
      devicePixelRatio: window.devicePixelRatio,
      rendererPixelRatio: pixelRatio,
    };
  };
  return true;
})()`;
}

// ---------------------------------------------------------------------------------------------
// Pure reducers
// ---------------------------------------------------------------------------------------------

/** Nearest-rank percentile over a copy. Returns null for an empty series. */
export function quantile(values, p) {
    const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
    return s[i];
}

function seriesStats(values) {
    const s = values.filter(Number.isFinite);
    if (!s.length) {
        return {
            samples: 0, p50: null, p95: null, p99: null, min: null, max: null,
        };
    }
    return {
        samples: s.length,
        p50: +quantile(s, 0.5).toFixed(3),
        p95: +quantile(s, 0.95).toFixed(3),
        p99: +quantile(s, 0.99).toFixed(3),
        min: +Math.min(...s).toFixed(3),
        max: +Math.max(...s).toFixed(3),
    };
}

/** Join a pipeline label's trailing `_<id>` against the scene's material map. Never guesses. */
export function classifyPipelines(pipes, materialsById) {
    return pipes.map((p) => {
        const m = /_(\d+)$/.exec(p.label || '');
        const id = m ? Number(m[1]) : null;
        const hit = id !== null ? materialsById[String(id)] : null;
        return {
            label: p.label,
            materialId: id,
            materialClass: hit ? hit.type : null,
            materialClassReason: hit ? null : 'not-in-scene-at-collection',
            materialName: hit ? hit.name : null,
            async: !!p.async,
            failed: !!p.failed,
            ms: p.ms ?? null,
            atMs: p.atMs ?? null,
            targets: p.targets ?? null,
            samples: p.samples ?? null,
            depth: p.depth ?? null,
        };
    });
}

/**
 * Reduce a visit payload to the committed shape. Pure.
 * Applies the void rules: a null always travels with a `*Reason` sibling.
 */
export function reduceVisit(raw, { targetFps = 60 } = {}) {
    if (!raw || raw.error) return { error: raw ? raw.error : 'no-payload' };
    const rows = classifyPipelines(raw.compilePipes || [], raw.materialsById || {});
    const asyncRows = rows.filter((r) => r.async && !r.failed);
    const syncRows = rows.filter((r) => !r.async);
    const budgetMs = 1000 / targetFps;
    const wall = seriesStats(raw.rings?.wall || []);
    const cpu = seriesStats(raw.rings?.cpu || []);
    const gpu = seriesStats(raw.rings?.gpu || []);
    const calls = raw.rings?.calls || [];
    const tris = raw.rings?.tris || [];
    const heap = raw.heap || [];
    let heapDrops = 0;
    for (let i = 1; i < heap.length; i += 1) if (heap[i] < heap[i - 1]) heapDrops += 1;
    const framesObserved = raw.framesObserved || 0;
    const heapDeltaBytes = heap.length > 1 ? heap[heap.length - 1] - heap[0] : null;

    const overBudget = (raw.rings?.wall || []).filter((v) => v > budgetMs).length;
    const gpuNullReason = gpu.samples === 0
        ? (raw.renderer?.timestampUnavailableReason || 'no-resolved-timestamp-in-window')
        : null;
    // A sample count equal to the frame count is the sticky-sampler signature (ADR-0016).
    const stickySampler = gpu.samples > 0 && framesObserved > 0 && gpu.samples >= framesObserved;

    return {
        theme: raw.themeId,
        anchorTheme: raw.anchorTheme,
        renderer: raw.renderer,
        switchTimings: {
            switchWallMs: round(raw.switchWallMs),
            managerReportedMs: raw.managerReportedMs ?? null,
            queueDrainMs: Number.isFinite(raw.managerReportedMs)
                ? round(raw.switchWallMs - raw.managerReportedMs) : null,
            createSceneEnterMs: round(delta(raw.marks, 't2_createSceneEnter')),
            rendererCreatedMs: round(delta(raw.marks, 't3_rendererCreated')),
            criticalReadyMs: round(delta(raw.marks, 't5_criticalReady')),
            firstRenderCallMs: round(delta(raw.marks, 't6_firstRenderCall')),
            // The player-facing one: GPU work for the first frame done, no quiesce wait in it.
            firstFrameGpuDoneMs: round(delta(raw.marks, 't6b_firstFrameGpuDone')),
            firstFrameGpuDoneMethod: raw.firstFrameMethod ?? null,
            // Includes the 2000-2100 ms compile-quiet wait BY CONSTRUCTION. Useful for "when did
            // this theme stop creating pipelines and finish them", useless as a latency.
            allQuiescedGpuDoneMs: round(delta(raw.marks, 't7_firstGpuWorkDone')),
            allQuiescedGpuDoneMethod: raw.gpuDoneMethod ?? null,
            quietWaitFloorMs: 2000,
            firstFrameRafMs: round(delta(raw.marks, 't8_firstRafAfterGpu')),
        },
        pipelines: {
            count: rows.length,
            asyncCount: asyncRows.length,
            syncCount: syncRows.length,
            failedCount: rows.filter((r) => r.failed).length,
            // SUM of per-object awaited compiles (r185 awaits per object), NOT a wall-clock.
            asyncSumMs: round(asyncRows.reduce((a, r) => a + (r.ms || 0), 0)),
            asyncMaxMs: asyncRows.length ? round(Math.max(...asyncRows.map((r) => r.ms || 0))) : 0,
            shapes: [...new Set(rows.map((r) => [r.targets, r.samples, r.depth].join('|')))],
            rows: asyncRows.slice().sort((a, b) => (b.ms || 0) - (a.ms || 0)).slice(0, 25),
            syncRows: syncRows.slice().sort((a, b) => (a.atMs || 0) - (b.atMs || 0)).slice(0, 25),
            pipelinesAfterFirstFrame: raw.idlePipes ?? null,
        },
        idle: {
            windowMs: round(raw.windowMs),
            framesObserved,
            wall: { ...wall, budgetMs: +budgetMs.toFixed(3), overBudget },
            cpuSubmitMs: cpu,
            gpuMs: {
                ...gpu,
                quantumMs: GPU_QUANTUM_MS,
                sampleDiscipline: 'one-push-per-resolved-query',
                stickySamplerSuspected: stickySampler,
            },
            gpuNullReason,
            longTasks: raw.longTasks || null,
        },
        content: {
            drawCalls: { p50: quantile(calls, 0.5), min: calls.length ? Math.min(...calls) : null, max: calls.length ? Math.max(...calls) : null },
            triangles: { p50: quantile(tris, 0.5), min: tris.length ? Math.min(...tris) : null, max: tris.length ? Math.max(...tris) : null },
            steadyState: calls.length > 0 && Math.min(...calls) === Math.max(...calls),
            infoOwnership: (raw.infoResetsByTheme || 0) > 0 ? 'contested' : 'lane',
            geometries: raw.info?.geometries ?? null,
            textures: raw.info?.textures ?? null,
        },
        memory: {
            peakHeapMB: heap.length ? +(Math.max(...heap) / 1048576).toFixed(2) : null,
            p50HeapMB: heap.length ? +(quantile(heap, 0.5) / 1048576).toFixed(2) : null,
            heapSamples: heap.length,
            heapDrops,
            // Only an upper bound, and only if no GC ran inside the window. A drop is not the
            // collected size, so a run with a drop publishes null rather than a "corrected" figure.
            allocBytesPerFrame: heapDrops === 0 && framesObserved > 0 && heapDeltaBytes !== null
                ? Math.round(heapDeltaBytes / framesObserved) : null,
            allocVoidReason: allocVoidReason(heapDrops, framesObserved),
            // A GC inside the window voids the byte figure, but the GC COUNT is itself a directly
            // measured signal — and 'GC hitches' is the thing the ranking actually cares about.
            // Sampled every 250 ms, so this is a floor on the true rate, never an over-count.
            gcPerSecond: raw.windowMs > 0 ? +((heapDrops / (raw.windowMs / 1000)).toFixed(3)) : null,
            gcCount: heapDrops,
        },
        pins: raw.pins || null,
    };
}

/** Why the allocation figure is null, or null when it is a real number. */
function allocVoidReason(heapDrops, framesObserved) {
    if (heapDrops > 0) return `${heapDrops} GC(s) inside the window`;
    if (!framesObserved) return 'no frames observed';
    return null;
}

function delta(marks, name) {
    if (!marks || marks[name] === undefined || marks.t0_requested === undefined) return null;
    return marks[name] - marks.t0_requested;
}
function round(v) { return Number.isFinite(v) ? +v.toFixed(2) : null; }

/** Content-match guard, verbatim rule from odyssey-gpu-split.mjs: draws exact, triangles within 2 %. */
export function contentMismatch(v1, v2) {
    const c1 = v1?.content?.drawCalls?.p50;
    const c2 = v2?.content?.drawCalls?.p50;
    const t1 = v1?.content?.triangles?.p50;
    const t2 = v2?.content?.triangles?.p50;
    if (!Number.isFinite(c1) || !Number.isFinite(c2)) return 'draw calls unavailable in one visit';
    if (c1 !== c2) return `draw calls differ (v1=${c1}, v2=${c2})`;
    if (Number.isFinite(t1) && Number.isFinite(t2) && t1 > 0) {
        const drift = Math.abs(t2 - t1) / t1;
        if (drift > 0.02) return `triangles differ by ${(drift * 100).toFixed(1)}% (v1=${t1}, v2=${t2})`;
    }
    return null;
}

/** Did the pins hold across the window? Returns a reason string, or null when they held. */
export function pinsBrokenReason(pins) {
    if (!pins || !pins.atStart || !pins.atEnd) return 'pins were not observed';
    const keys = ['quality', 'targetFrameRate', 'devicePixelRatio', 'rendererPixelRatio'];
    for (const k of keys) {
        const a = pins.atStart[k];
        const b = pins.atEnd[k];
        if (a === null || a === undefined) continue;
        if (a !== b) return `${k} moved ${a} -> ${b} during the window`;
    }
    return null;
}
