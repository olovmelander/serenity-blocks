// Allocation-rate sampling while a theme is active in-game (CDP HeapProfiler sampling).
import { chromium } from 'playwright-core';
const THEME = process.argv[2];
const SECONDS = Number(process.argv[3] || 20);
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', () => {});
await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(`window.__gs = () => { const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.(); return m && m.gameState ? m.gameState : null; }`);
await page.click('#single-player-card-btn'); await page.waitForTimeout(1200); await page.keyboard.press('Enter');
await page.waitForFunction(() => { const gs = window.__gs && window.__gs(); return gs && gs.currentPiece; }, null, { timeout: 30000 });
await page.waitForTimeout(2000);
await page.evaluate(() => { window.settingsManager.update({ backgroundMode: 'Specific' }); });
await page.evaluate(async (t) => {
  for (let i = 0; i < 40; i++) {
    if (!window.themeManager.isTransitioning && window.themeManager.activeThemeName !== t) await window.themeManager.switchTheme(t, true);
    if (window.themeManager.activeThemeName === t && window.themeManager.activeTheme && !window.themeManager.isTransitioning) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('activate failed ' + t);
}, THEME);
await page.waitForTimeout(6000); // theme settle/warm

const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
// frame counter during the window so we can normalize per frame
await page.evaluate(`(() => { window.__fc = 0; const tick = () => { window.__fc++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192 });
await page.waitForTimeout(SECONDS * 1000);
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const frames = await page.evaluate(() => window.__fc);
let total = 0;
const walk = (n) => { total += n.selfSize || 0; (n.children || []).forEach(walk); };
walk(profile.head);
console.log(JSON.stringify({ theme: THEME, seconds: SECONDS, frames, totalSampledBytes: total, bytesPerSec: Math.round(total / SECONDS), bytesPerFrame: Math.round(total / Math.max(1, frames)) }));
await browser.close();
