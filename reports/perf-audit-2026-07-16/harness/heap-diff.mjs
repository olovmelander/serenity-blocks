// Class-histogram heap diff: snapshot at forest baseline, N theme toggles, snapshot at forest again.
// Prints top growers by retained self_size and count. Usage: node heap-diff.mjs <theme> [toggles]
import { chromium } from 'playwright-core';

const THEME = process.argv[2] || 'lunara';
const TOGGLES = Number(process.argv[3] || 4);
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
const gc = async () => { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(400); await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(400); };

async function takeHistogram() {
  let chunks = [];
  const onChunk = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const snap = JSON.parse(chunks.join(''));
  const { snapshot, nodes, strings } = snap;
  const NF = snapshot.meta.node_fields.length;
  const F = Object.fromEntries(snapshot.meta.node_fields.map((f, i) => [f, i]));
  const nodeTypes = snapshot.meta.node_types[0];
  const hist = new Map();
  const nodeCount = nodes.length / NF;
  for (let i = 0; i < nodeCount; i++) {
    const type = nodeTypes[nodes[i * NF + F.type]];
    let key;
    if (type === 'object') key = 'obj:' + strings[nodes[i * NF + F.name]];
    else if (type === 'native') key = 'native:' + strings[nodes[i * NF + F.name]].split(' ')[0].slice(0, 40);
    else key = type;
    const h = hist.get(key) || { n: 0, size: 0 };
    h.n++; h.size += nodes[i * NF + F.self_size];
    hist.set(key, h);
  }
  return { hist, totalMB: +(nodes.reduce ? 0 : 0) };
}

// baseline at forest
await switchTo('forest');
await page.waitForTimeout(2000);
await gc();
const base = await takeHistogram();
const heap0 = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));

for (let i = 0; i < TOGGLES; i++) {
  await switchTo(THEME);
  await page.waitForTimeout(4000);
  await switchTo('forest');
  await page.waitForTimeout(2000);
}
await gc();
const after = await takeHistogram();
const heap1 = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
await browser.close();

console.log(`heap ${heap0} -> ${heap1} MB after ${TOGGLES} ${THEME} toggles`);
const keys = new Set([...base.hist.keys(), ...after.hist.keys()]);
const rows = [];
for (const k of keys) {
  const a = base.hist.get(k) || { n: 0, size: 0 };
  const b = after.hist.get(k) || { n: 0, size: 0 };
  if (b.size - a.size !== 0 || b.n - a.n !== 0) rows.push({ k, dn: b.n - a.n, dsize: b.size - a.size });
}
rows.sort((x, y) => y.dsize - x.dsize);
console.log('=== top growers (Δself_size bytes, Δcount):');
for (const r of rows.slice(0, 25)) console.log(`  ${String(r.dsize).padStart(10)}  ${String(r.dn).padStart(7)}  ${r.k}`);
console.log('=== top shrinkers:');
for (const r of rows.slice(-5)) console.log(`  ${String(r.dsize).padStart(10)}  ${String(r.dn).padStart(7)}  ${r.k}`);
