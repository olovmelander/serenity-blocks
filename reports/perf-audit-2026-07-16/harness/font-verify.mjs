import { launch } from './lib.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 60000 });
await page.waitForTimeout(5000);
const res = await page.evaluate(async () => {
  await document.fonts.ready;
  const checks = {};
  for (const [w, fam] of [[400, 'Orbitron'], [700, 'Orbitron'], [900, 'Orbitron'], [400, 'Space Mono'], [700, 'Space Mono']]) {
    checks[`${fam} ${w}`] = document.fonts.check(`${w} 16px '${fam}'`);
  }
  const fontRequests = performance.getEntriesByType('resource').filter((r) => /fonts|woff/.test(r.name)).map((r) => ({ name: r.name.replace(/^https?:\/\/[^/]+/, ''), dur: Math.round(r.duration), external: !r.name.includes('localhost') }));
  const title = document.querySelector('h1, .game-title, [class*=title]');
  const titleFont = title ? getComputedStyle(title).fontFamily : null;
  return { checks, fontRequests, titleFont, loadedFaces: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`) };
});
console.log(JSON.stringify(res, null, 1));
await page.screenshot({ path: 'results/menu-selfhosted-fonts.png' });
await browser.close();
