// Track dispose-listener count on three's shared QuadGeometry across theme toggles.
import { chromium } from 'playwright-core';
const THEME = process.argv[2] || 'lunara';
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', () => {});
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
const grabGeo = () => page.evaluate(() => {
  if (window.__quadGeo) return true;
  const t = window.themeManager.activeTheme;
  const post = t && (t.post || t.oceanPost || t.postPipeline);
  const pp = post && (post.postProcessing || post) || (t && t.postProcessing);
  const qm = pp && pp._quadMesh;
  if (qm && qm.geometry) { window.__quadGeo = qm.geometry; return true; }
  return false;
});
const count = () => page.evaluate(() => {
  const g = window.__quadGeo;
  return g && g._listeners && g._listeners.dispose ? g._listeners.dispose.length : null;
});
for (let i = 0; i < 4; i++) {
  await switchTo(THEME);
  await page.waitForTimeout(4000);
  await grabGeo();
  const inTheme = await count();
  await switchTo('forest');
  await page.waitForTimeout(2000);
  console.log(`toggle ${i + 1}: listeners while ${THEME} active: ${inTheme}, after back to forest: ${await count()}`);
}
await browser.close();
