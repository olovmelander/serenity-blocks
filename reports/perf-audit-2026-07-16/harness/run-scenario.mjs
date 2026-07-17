// Scenario runner for Serenity Blocks perf/stability audit.
// Usage: node run-scenario.mjs <scenario> [runs] [durationMs]
// Env: BASE_URL (default http://localhost:4173), WEBGPU=0 to disable WebGPU flags.
import fs from 'fs';
import { execSync } from 'child_process';
import { chromium } from 'playwright-core';
import { summarize } from './lib.mjs';

const scenario = process.argv[2];
const RUNS = Number(process.argv[3] || 1);
const DUR = Number(process.argv[4] || 30000);
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUTDIR = new URL('./results/', import.meta.url).pathname;
fs.mkdirSync(OUTDIR, { recursive: true });

const GPU_ARGS = process.env.WEBGPU === '0'
  ? ['--no-sandbox']
  : ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
if (process.env.BLOCK_FONTS === '1') GPU_ARGS.push('--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1');

const INSTRUMENT = `(() => {
  const A = window.__audit = {
    listeners: {}, listenersTotal: 0,
    intervalsActive: new Set(), timeoutsActive: new Set(),
    rafCalls: 0, audioContexts: 0, contexts: { webgl: 0, webgpu: 0 },
    intervalsById: {},
  };
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    A.listeners[type] = (A.listeners[type] || 0) + 1; A.listenersTotal++;
    return origAdd.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (A.listeners[type]) { A.listeners[type]--; A.listenersTotal--; }
    return origRemove.call(this, type, fn, opts);
  };
  const oSI = window.setInterval, oCI = window.clearInterval;
  window.setInterval = function (...args) { const id = oSI.apply(window, args); A.intervalsActive.add(id); try { A.intervalsById[id] = String(args[0]).slice(0, 80) + ' @' + (args[1] ?? ''); } catch (e) {} return id; };
  window.clearInterval = function (id) { A.intervalsActive.delete(id); delete A.intervalsById[id]; return oCI.call(window, id); };
  const oRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) { A.rafCalls++; return oRAF.call(window, fn); };
  const OAC = window.AudioContext;
  if (OAC) window.AudioContext = class extends OAC { constructor(...a) { super(...a); A.audioContexts++; } };
  const oGC = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const ctx = oGC.call(this, kind, ...rest);
    if (ctx && /webgl/.test(kind) && !this.__auditCounted) { this.__auditCounted = true; A.contexts.webgl++; }
    return ctx;
  };
})()`;

const COLLECT_START = `(() => {
  const c = window.__ft = { deltas: [], last: null, longtasks: [], rafStart: window.__audit ? window.__audit.rafCalls : 0, t0: performance.now() };
  const tick = (t) => { if (c.last !== null) c.deltas.push(t - c.last); c.last = t; if (!c.stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { c.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) c.longtasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }); c.po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
})()`;

async function snapshotState(page) {
  return page.evaluate(() => {
    const A = window.__audit || {};
    return {
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      heapTotalMB: performance.memory ? +(performance.memory.totalJSHeapSize / 1048576).toFixed(1) : null,
      domNodes: document.getElementsByTagName('*').length,
      canvases: document.querySelectorAll('canvas').length,
      listenersTotal: A.listenersTotal,
      listenersTop: Object.fromEntries(Object.entries(A.listeners || {}).filter(([, v]) => v > 3).sort((a, b) => b[1] - a[1]).slice(0, 15)),
      intervalsActive: A.intervalsActive ? A.intervalsActive.size : null,
      intervalsById: A.intervalsById ? Object.values(A.intervalsById).slice(0, 20) : null,
      audioContexts: A.audioContexts,
      webglContexts: A.contexts ? A.contexts.webgl : null,
      rafCalls: A.rafCalls,
      t: Math.round(performance.now()),
    };
  });
}

async function collectWindow(page, ms, label) {
  await page.evaluate(COLLECT_START);
  const s0 = await snapshotState(page);
  await page.waitForTimeout(ms);
  const data = await page.evaluate(() => {
    const c = window.__ft; c.stop = true; if (c.po) c.po.disconnect();
    return { deltas: c.deltas, longtasks: c.longtasks, rafDelta: window.__audit ? window.__audit.rafCalls - c.rafStart : null, wallMs: performance.now() - c.t0 };
  });
  const s1 = await snapshotState(page);
  const frames = data.deltas.length;
  return {
    label,
    frame: summarize(data.deltas),
    longtasks: { count: data.longtasks.length, totalMs: data.longtasks.reduce((a, b) => a + b.d, 0), top: data.longtasks.sort((a, b) => b.d - a.d).slice(0, 8) },
    rafCallbacksPerFrame: frames ? +(data.rafDelta / frames).toFixed(2) : null,
    before: s0, after: s1,
  };
}

async function boot(browser, { url = '/?skipIntro=1' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleSink = [];
  page.on('console', (m) => { const t = m.type(); if (t === 'error') { const loc = m.location() || {}; consoleSink.push(m.text().slice(0, 200) + ' @' + String(loc.url || '').split('/').pop() + ':' + loc.lineNumber); } });
  page.on('pageerror', (e) => consoleSink.push('PAGEERROR: ' + String(e).slice(0, 200)));
  await page.addInitScript(INSTRUMENT);
  if (process.env.BLOCK_FONTS === '1') await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort('connectionrefused'));
  const navStart = Date.now();
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 90000 });
  const menuReadyWall = Date.now() - navStart;
  return { page, consoleSink, menuReadyWall };
}

async function startSinglePlayer(page) {
  await page.evaluate(`window.__gs = () => { const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.(); return m && m.gameState ? m.gameState : null; }`);
  await page.click('#single-player-card-btn');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => { const gs = window.__gs && window.__gs(); return gs && gs.currentPiece && !gs.isGameOver; }, null, { timeout: 30000 });
  await page.waitForTimeout(3000); // theme settle
}

// Deterministic input bot: seeded LCG choosing actions.
const BOT_SNIPPET = `(() => {
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const keys = ['ArrowLeft','ArrowLeft','ArrowRight','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','ArrowUp',' '];
  const dispatch = (key, type) => document.dispatchEvent(new KeyboardEvent(type, { key: key === ' ' ? ' ' : key, code: key === ' ' ? 'Space' : key, bubbles: true }));
  const bot = window.__bot = { moves: 0, stop: false };
  const step = () => {
    if (bot.stop) return;
    const gs = window.__gs && window.__gs();
    if (gs && gs.isGameOver) { try { window.startGame(); } catch (e) {} setTimeout(step, 800); return; }
    const key = keys[Math.floor(rnd() * keys.length)];
    dispatch(key, 'keydown');
    setTimeout(() => dispatch(key, 'keyup'), 30 + rnd() * 40);
    bot.moves++;
    setTimeout(step, 90 + rnd() * 160);
  };
  step();
})()`;

let gitState = 'unknown';
try {
  const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
  gitState = sha + (dirty ? '+dirty' : '');
} catch (e) { /* not a git checkout */ }
const results = { scenario, runs: [], meta: { base: BASE, webgpu: process.env.WEBGPU !== '0', date: new Date().toISOString(), viewport: '1280x720', commit: gitState } };

async function withBrowser(fn) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
  try { return await fn(browser); } finally { await browser.close().catch(() => {}); }
}

for (let run = 0; run < RUNS; run++) {
  const r = await withBrowser(async (browser) => {
    const out = { run };
    if (scenario === 'startup') {
      const { page, consoleSink, menuReadyWall } = await boot(browser);
      out.menuReadyWallMs = menuReadyWall;
      out.trace = await page.evaluate(() => (window.__serenityStartupTrace || []).map((e) => ({ t: Math.round(e.t || e.time || 0), p: e.phase || e.label || '' })).filter((e) => e.p).slice(0, 30));
      out.consoleErrors = consoleSink.slice(0, 10);
      return out;
    }
    if (scenario === 'menu-idle') {
      const { page, consoleSink } = await boot(browser);
      await page.waitForTimeout(5000); // warm-up
      out.window = await collectWindow(page, DUR, 'menu-idle');
      out.consoleErrors = consoleSink.slice(0, 10);
      return out;
    }
    if (scenario === 'gameplay' || scenario === 'rapid-input') {
      const { page, consoleSink } = await boot(browser);
      await startSinglePlayer(page);
      if (scenario === 'gameplay') {
        await page.evaluate(BOT_SNIPPET);
      } else {
        await page.evaluate(`(${rapidInput.toString()})()`);
      }
      await page.waitForTimeout(3000); // warm-up under input
      out.window = await collectWindow(page, DUR, scenario);
      out.botMoves = await page.evaluate(() => (window.__bot || {}).moves || null);
      out.inApp = await page.evaluate(() => window.perfMonitor && window.perfMonitor.getFrameTimeSummary ? window.perfMonitor.getFrameTimeSummary(16.7) : null);
      out.score = await page.evaluate(() => { const gs = window.__gs && window.__gs(); return gs && { score: gs.score, lines: gs.lines }; });
      out.consoleErrors = consoleSink.slice(0, 10);
      await page.evaluate(() => { if (window.__bot) window.__bot.stop = true; });
      return out;
    }
    if (scenario === 'input-latency') {
      const { page, consoleSink } = await boot(browser);
      await startSinglePlayer(page);
      out.latency = await page.evaluate(async () => {
        const samples = [];
        for (let i = 0; i < 60; i++) {
          await new Promise((res) => setTimeout(res, 250));
          const gs = window.__gs();
          if (!gs || !gs.currentPiece || gs.isGameOver) { try { window.startGame(); } catch (e) {} await new Promise((res) => setTimeout(res, 1200)); continue; }
          const dir = gs.currentPiece.x > 4 ? 'ArrowLeft' : 'ArrowRight';
          const x0 = gs.currentPiece.x;
          const t0 = performance.now();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: dir, code: dir, bubbles: true }));
          const applied = gs.currentPiece.x !== x0;
          const tPaint = await new Promise((res) => {
            const check = () => {
              const g = window.__gs();
              if (g && g.currentPiece && g.currentPiece.x !== x0) requestAnimationFrame(() => res(performance.now() - t0));
              else if (performance.now() - t0 > 500) res(null);
              else requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          });
          document.dispatchEvent(new KeyboardEvent('keyup', { key: dir, code: dir, bubbles: true }));
          samples.push({ syncApplied: applied, toNextFrameMs: tPaint === null ? null : +tPaint.toFixed(2) });
        }
        return samples;
      });
      out.consoleErrors = consoleSink.slice(0, 10);
      return out;
    }
    if (scenario === 'restart-cycle') {
      const { page, consoleSink } = await boot(browser);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.enable');
      await startSinglePlayer(page);
      out.cycles = [];
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.startGame());
        await page.waitForTimeout(2500);
        await cdp.send('HeapProfiler.collectGarbage');
        await page.waitForTimeout(300);
        const s = await snapshotState(page);
        const rafRate = await page.evaluate(async () => {
          const c0 = window.__audit.rafCalls; const f0 = await new Promise((r) => requestAnimationFrame(r));
          await new Promise((r) => setTimeout(r, 1000));
          const frames = await new Promise((r) => { let n = 0; const t0 = performance.now(); const cb = () => { n++; if (performance.now() - t0 < 500) requestAnimationFrame(cb); else r(n); }; requestAnimationFrame(cb); });
          return +((window.__audit.rafCalls - c0) / ((frames / 0.5) * 1.5)).toFixed(2);
        });
        out.cycles.push({ i, ...s, rafPerFrameApprox: rafRate });
      }
      out.consoleErrors = consoleSink.slice(0, 15);
      return out;
    }
    if (scenario === 'theme-cycle') {
      const { page, consoleSink } = await boot(browser);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.enable');
      await startSinglePlayer(page); // themes are suspended at menu; activate during gameplay
      out.suspended = await page.evaluate(() => window.themeManager.themesSuspended);
      const themeList = JSON.parse(process.env.THEMES || '["winter","ocean","sunset","singing-bowl","neon-district","stellar-drift"]');
      out.cycles = [];
      for (let cycle = 0; cycle < Number(process.env.CYCLES || 2); cycle++) {
        for (const id of themeList) {
          const t0 = Date.now();
          const ok = await page.evaluate(async (tid) => { try { await window.themeManager.switchTheme(tid, true); return true; } catch (e) { return String(e).slice(0, 120); } }, id);
          const switchWallMs = Date.now() - t0;
          await page.waitForTimeout(4000);
          await cdp.send('HeapProfiler.collectGarbage');
          await page.waitForTimeout(300);
          const s = await snapshotState(page);
          out.cycles.push({ cycle, id, ok, switchWallMs, ...s });
        }
      }
      out.consoleErrors = consoleSink.slice(0, 25);
      return out;
    }
    if (scenario === 'visibility') {
      const { page, consoleSink } = await boot(browser);
      await startSinglePlayer(page);
      await page.evaluate(BOT_SNIPPET);
      await page.waitForTimeout(3000);
      out.visible1 = await collectWindow(page, 8000, 'visible-before');
      // simulate hidden
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      out.hidden = await collectWindow(page, 8000, 'hidden');
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(1000);
      out.visible2 = await collectWindow(page, 8000, 'visible-after');
      await page.evaluate(() => { if (window.__bot) window.__bot.stop = true; });
      out.consoleErrors = consoleSink.slice(0, 15);
      return out;
    }
    if (scenario === 'resize') {
      const { page, consoleSink } = await boot(browser);
      await startSinglePlayer(page);
      const sizes = [[1280, 720], [1920, 1080], [800, 600], [1366, 768], [1280, 720]];
      out.cycles = [];
      for (let i = 0; i < 4; i++) {
        for (const [w, h] of sizes) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(700);
        }
        const s = await snapshotState(page);
        out.cycles.push({ i, ...s });
      }
      out.consoleErrors = consoleSink.slice(0, 15);
      return out;
    }
    throw new Error('unknown scenario ' + scenario);
  });
  results.runs.push(r);
  console.log(`run ${run} done`);
}

function rapidInput() {
  const dispatch = (key, type) => document.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true }));
  const bot = (window.__bot = { moves: 0, stop: false });
  let dir = 'ArrowLeft';
  const step = () => {
    if (bot.stop) return;
    const gs = window.__gs && window.__gs();
    if (gs && gs.isGameOver) { try { window.startGame(); } catch (e) {} setTimeout(step, 500); return; }
    dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    dispatch(dir, 'keydown');
    setTimeout(() => { dispatch(dir, 'keyup'); bot.moves++; }, 220); // hold through DAS
    setTimeout(step, 260);
  };
  step();
}

const file = OUTDIR + scenario + (process.env.WEBGPU === '0' ? '-webgl' : '') + (process.env.TAG ? '-' + process.env.TAG : '') + '.json';
fs.writeFileSync(file, JSON.stringify(results, null, 1));
console.log('wrote', file);
