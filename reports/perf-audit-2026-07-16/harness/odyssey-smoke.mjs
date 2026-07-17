// Odyssey mode smoke: enter Odyssey, observe load, chapter warm, frame stats, console errors.
import fs from 'fs';
import { chromium } from 'playwright-core';
import { summarize } from './lib.mjs';

const OUTDIR = new URL('./results/', import.meta.url).pathname;
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const sink = [];
page.on('console', (m) => { if (m.type() === 'error') { const loc = m.location() || {}; sink.push({ t: Date.now(), text: m.text().slice(0, 220), src: String(loc.url || '').split('/').pop() + ':' + loc.lineNumber }); } });
page.on('pageerror', (e) => sink.push({ t: Date.now(), text: 'PAGEERROR: ' + String(e).slice(0, 300) }));

await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 90000 });
await page.waitForTimeout(4000);

const t0 = Date.now();
await page.click('#odyssey-card-btn').catch(async () => { await page.click('text=ODYSSEY'); });
await page.waitForTimeout(2000);
await page.screenshot({ path: OUTDIR + 'odyssey-1.png' });
// try to enter first level: press Enter a couple times
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
await page.keyboard.press('Enter');

// wait until an Odyssey board/mode running or 90s
const started = await page.waitForFunction(() => {
  const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.();
  return m && /odyssey/i.test(window.serenityBlocks.gameModeManager.getCurrentModeId() || '') && m.isRunning === true;
}, null, { timeout: 90000 }).then(() => true).catch(() => false);
const bootMs = Date.now() - t0;
await page.screenshot({ path: OUTDIR + 'odyssey-2.png' });

let frame = null; let counters = null;
if (started) {
  await page.waitForTimeout(5000);
  await page.evaluate(`(() => {
    const c = window.__ft = { deltas: [], last: null, stop: false };
    const tick = (t) => { if (c.last !== null) c.deltas.push(t - c.last); c.last = t; if (!c.stop) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })()`);
  await page.waitForTimeout(20000);
  const deltas = await page.evaluate(() => { const c = window.__ft; c.stop = true; return c.deltas; });
  frame = summarize(deltas);
  counters = await page.evaluate(() => window.perfMonitor && window.perfMonitor.getCounters ? window.perfMonitor.getCounters() : null);
}
const heap = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
fs.writeFileSync(OUTDIR + 'odyssey-smoke.json', JSON.stringify({ started, bootMs, frame, counters, heapMB: heap, consoleErrors: sink.slice(0, 40) }, null, 1));
console.log(JSON.stringify({ started, bootMs, frame, heapMB: heap, errors: sink.length }));
await browser.close();
