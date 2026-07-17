import { chromium } from 'playwright-core';
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(`
  window.__lt = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
`);
await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 90000 });
const data = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource')
    .map((r) => ({ name: r.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 80), start: Math.round(r.startTime), dur: Math.round(r.duration), size: r.transferSize || r.decodedBodySize }))
    .sort((a, b) => b.dur - a.dur).slice(0, 25);
  const marks = performance.getEntriesByType('mark').map((m) => ({ n: m.name, t: Math.round(m.startTime) })).slice(0, 40);
  return { res, marks, longtasks: window.__lt, nav: performance.getEntriesByType('navigation').map(n => ({ domInteractive: Math.round(n.domInteractive), domComplete: Math.round(n.domComplete) }))[0] };
});
console.log(JSON.stringify(data, null, 1));
await browser.close();
