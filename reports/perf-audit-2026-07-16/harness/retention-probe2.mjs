import fs from 'fs';
import { chromium } from 'playwright-core';
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(fs.readFileSync(new URL('./instrument.js', import.meta.url).pathname, 'utf8'));
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
page.on('pageerror', () => {});
await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(`window.__gs = () => { const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.(); return m && m.gameState ? m.gameState : null; }`);
await page.click('#single-player-card-btn'); await page.waitForTimeout(1200); await page.keyboard.press('Enter');
await page.waitForFunction(() => { const gs = window.__gs && window.__gs(); return gs && gs.currentPiece; }, null, { timeout: 30000 });
await page.waitForTimeout(3000);
// pin theme control to Specific so level logic stops fighting us
await page.evaluate(() => { window.settingsManager.update({ backgroundMode: 'Specific' }); });

const gc = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(400); await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(400); };
const switchTo = async (tid) => {
  await page.evaluate(async (t) => {
    for (let i = 0; i < 40; i++) {
      if (!window.themeManager.isTransitioning && window.themeManager.activeThemeName !== t) await window.themeManager.switchTheme(t, true);
      if (window.themeManager.activeThemeName === t && window.themeManager.activeTheme && !window.themeManager.isTransitioning) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('activate failed ' + t + ' state=' + window.themeManager.activeThemeName + ' trans=' + window.themeManager.isTransitioning);
  }, tid);
};

for (const theme of ['lunara', 'stellar-drift', 'ocean']) {
  await switchTo(theme);
  await page.waitForTimeout(5000);
  const setup = await page.evaluate((tid) => {
    const t = window.themeManager.activeTheme;
    window.__probe = window.__probe || {};
    const refs = { inst: new WeakRef(t) };
    let n = 0;
    for (const [k, v] of Object.entries(t)) {
      if (v && typeof v === 'object' && n < 25) { refs['f:' + k] = new WeakRef(v); n++; }
    }
    window.__probe[tid] = refs;
    return { ctor: t.constructor.name, fields: Object.keys(refs).length };
  }, theme);
  const before = await page.evaluate(() => ({ heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) }));
  await switchTo('forest');
  await page.waitForTimeout(3000);
  await gc();
  const after = await page.evaluate((tid) => {
    const alive = Object.entries(window.__probe[tid]).filter(([, r]) => r.deref() !== undefined).map(([k]) => k);
    return { alive, heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) };
  }, theme);
  console.log(`== ${theme} ctor=${setup.ctor} tracked=${setup.fields}`);
  console.log(`   ALIVE: ${JSON.stringify(after.alive)}`);
  console.log(`   heap ${before.heap} -> ${after.heap}`);
}
await browser.close();
