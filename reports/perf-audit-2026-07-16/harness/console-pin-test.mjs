// Toggle test with console object-args neutralized: if heap goes flat, console retention is the leak.
import { chromium } from 'playwright-core';
const THEME = process.argv[2] || 'lunara';
const NEUTRALIZE = process.env.NEUTRALIZE !== '0';
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (NEUTRALIZE) {
  await page.addInitScript(`(() => {
    for (const m of ['log', 'info', 'debug', 'warn']) {
      const orig = console[m].bind(console);
      console[m] = (...args) => orig(...args.map((a) => (a !== null && typeof a === 'object') ? '[' + ((a.constructor && a.constructor.name) || 'object') + ']' : a));
    }
  })()`);
}
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
let errCount = 0; let lastErr = '';
page.on('pageerror', (e) => { errCount++; lastErr = String(e).slice(0, 120); });
page.on('console', (m) => { if (m.type() === 'error' && !/No stack defined|css2/.test(m.text())) { errCount++; lastErr = m.text().slice(0, 120); } });
await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(`window.__gs = () => { const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.(); return m && m.gameState ? m.gameState : null; }`);
await page.click('#single-player-card-btn'); await page.waitForTimeout(1200); await page.keyboard.press('Enter');
await page.waitForFunction(() => { const gs = window.__gs && window.__gs(); return gs && gs.currentPiece; }, null, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { window.settingsManager.update({ backgroundMode: 'Specific' }); });
const switchTo = async (tid) => {
  await page.evaluate(async (t) => {
    for (let i = 0; i < 40; i++) {
      if (!window.themeManager.isTransitioning && window.themeManager.activeThemeName !== t) await window.themeManager.switchTheme(t, true);
      if (window.themeManager.activeThemeName === t && window.themeManager.activeTheme && !window.themeManager.isTransitioning) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('activate failed ' + t);
  }, tid);
};
const gc = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(400); await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(300); };
console.log('NEUTRALIZE console objects:', NEUTRALIZE);
await switchTo('forest'); await page.waitForTimeout(1500); await gc();
console.log('baseline', await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)));
for (let i = 0; i < 5; i++) {
  await switchTo(THEME); await page.waitForTimeout(4000);
  await switchTo('forest'); await page.waitForTimeout(1500); await gc();
  console.log('after toggle', i + 1, await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)), 'errs:', errCount, lastErr);
}
await browser.close();
