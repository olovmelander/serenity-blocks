import fs from 'fs';
import { chromium } from 'playwright-core';
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(fs.readFileSync(new URL('./instrument.js', import.meta.url).pathname, 'utf8'));
await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(`window.__gs = () => { const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.(); return m && m.gameState ? m.gameState : null; }`);
await page.click('#single-player-card-btn'); await page.waitForTimeout(1200); await page.keyboard.press('Enter');
await page.waitForFunction(() => { const gs = window.__gs && window.__gs(); return gs && gs.currentPiece; }, null, { timeout: 30000 });
await page.evaluate(fs.readFileSync(new URL('./bot-snippet.js', import.meta.url).pathname, 'utf8'));
let prev = null;
for (let i = 0; i <= 7; i++) {
  const snap = await page.evaluate(() => ({ total: window.__audit.listenersTotal, byType: { ...window.__audit.listeners } }));
  if (prev) {
    const deltas = Object.entries(snap.byType).map(([k, v]) => [k, v - (prev.byType[k] || 0)]).filter(([, d]) => d !== 0);
    console.log(`min ${i}: total ${snap.total} (Δ${snap.total - prev.total})`, JSON.stringify(Object.fromEntries(deltas)));
  } else console.log(`min ${i}: total ${snap.total}`);
  prev = snap;
  if (i < 7) await page.waitForTimeout(60000);
}
await browser.close();
