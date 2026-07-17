// 30-minute gameplay soak with periodic sampling (heap after forced GC, counters, frame stats window).
import fs from 'fs';
import { chromium } from 'playwright-core';
import { summarize } from './lib.mjs';

const MINUTES = Number(process.argv[2] || 30);
const OUTDIR = new URL('./results/', import.meta.url).pathname;
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleSink = [];
page.on('console', (m) => { if (m.type() === 'error') consoleSink.push({ t: Date.now(), text: m.text().slice(0, 200) }); });
page.on('pageerror', (e) => consoleSink.push({ t: Date.now(), text: 'PAGEERROR: ' + String(e).slice(0, 300) }));

await page.addInitScript(fs.readFileSync(new URL('./instrument.js', import.meta.url).pathname, 'utf8'));
await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(`window.__gs = () => { const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.(); return m && m.gameState ? m.gameState : null; }`);
await page.click('#single-player-card-btn');
await page.waitForTimeout(1200);
await page.keyboard.press('Enter');
await page.waitForFunction(() => { const gs = window.__gs && window.__gs(); return gs && gs.currentPiece; }, null, { timeout: 30000 });
await page.evaluate(fs.readFileSync(new URL('./bot-snippet.js', import.meta.url).pathname, 'utf8'));

const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');

const samples = [];
const t0 = Date.now();
for (let i = 0; i < MINUTES * 2; i++) {
  // 20s frame collection + 10s gap ≈ 30s cadence
  await page.evaluate(`(() => {
    const c = window.__ft = { deltas: [], last: null, stop: false };
    const tick = (t) => { if (c.last !== null) c.deltas.push(t - c.last); c.last = t; if (!c.stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })()`);
  await page.waitForTimeout(20000);
  const deltas = await page.evaluate(() => { const c = window.__ft; c.stop = true; return c.deltas; });
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => {
    const A = window.__audit || {};
    const gs = window.__gs && window.__gs();
    return {
      heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
      domNodes: document.getElementsByTagName('*').length,
      listenersTotal: A.listenersTotal,
      intervalsActive: A.intervalsActive ? A.intervalsActive.size : null,
      canvases: document.querySelectorAll('canvas').length,
      score: gs && gs.score, lines: gs && gs.lines, over: gs && gs.isGameOver,
      moves: (window.__bot || {}).moves,
    };
  });
  samples.push({ minute: +((Date.now() - t0) / 60000).toFixed(1), frame: summarize(deltas), ...s });
  console.log(JSON.stringify(samples[samples.length - 1]));
  await page.waitForTimeout(9500);
}
fs.writeFileSync(OUTDIR + 'soak.json', JSON.stringify({ minutes: MINUTES, samples, consoleErrors: consoleSink.slice(0, 60) }, null, 1));
console.log('soak done');
await browser.close();
