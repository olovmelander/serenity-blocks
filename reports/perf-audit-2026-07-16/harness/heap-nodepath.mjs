// After N toggles, find retainer paths for sampled TSL Node objects (class given as arg2).
import { chromium } from 'playwright-core';
const THEME = process.argv[2] || 'lunara';
const CLS = process.argv[3] || 'Fh';
const TOGGLES = Number(process.argv[4] || 2);
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (process.env.NEUTRALIZE !== '0') await page.addInitScript(`(() => {
  for (const m of ['log', 'info', 'debug', 'warn', 'error']) {
    const orig = console[m].bind(console);
    console[m] = (...args) => orig(...args.map((a) => (a !== null && typeof a === 'object') ? '[' + ((a.constructor && a.constructor.name) || 'object') + ']' : a));
  }
})()`);
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
await switchTo('forest'); await page.waitForTimeout(1500);
for (let i = 0; i < TOGGLES; i++) { await switchTo(THEME); await page.waitForTimeout(4000); await switchTo('forest'); await page.waitForTimeout(1500); }
await gc();
let chunks = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
const raw = chunks.join('');
await browser.close();
console.log('snapshot bytes:', raw.length);

const snap = JSON.parse(raw);
const { snapshot, nodes, edges, strings } = snap;
const NF = snapshot.meta.node_fields.length;
const EF = snapshot.meta.edge_fields.length;
const nodeTypes = snapshot.meta.node_types[0];
const edgeTypes = snapshot.meta.edge_types[0];
const F = Object.fromEntries(snapshot.meta.node_fields.map((f, i) => [f, i]));
const E = Object.fromEntries(snapshot.meta.edge_fields.map((f, i) => [f, i]));
const nodeCount = nodes.length / NF;
const edgeCount = edges.length / EF;
const nodeName = (i) => strings[nodes[i * NF + F.name]];
const nodeType = (i) => nodeTypes[nodes[i * NF + F.type]];
const edgeType = (e) => edgeTypes[edges[e * EF + E.type]];
const edgeLabel = (e) => { const t = edgeType(e); const ni = edges[e * EF + E.name_or_index]; return t === 'element' || t === 'hidden' ? `${t}[${ni}]` : `${t}:${strings[ni]}`; };
const firstEdge = new Float64Array(nodeCount + 1);
for (let i = 0; i < nodeCount; i++) firstEdge[i + 1] = firstEdge[i] + nodes[i * NF + F.edge_count];
const revCount = new Uint32Array(nodeCount);
for (let e = 0; e < edgeCount; e++) revCount[edges[e * EF + E.to_node] / NF]++;
const revStart = new Float64Array(nodeCount + 1);
for (let i = 0; i < nodeCount; i++) revStart[i + 1] = revStart[i] + revCount[i];
const revFrom = new Uint32Array(edgeCount); const revEdge = new Uint32Array(edgeCount);
const cursor = Float64Array.from(revStart.subarray(0, nodeCount));
for (let n = 0; n < nodeCount; n++) for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) { const to = edges[e * EF + E.to_node] / NF; revFrom[cursor[to]] = n; revEdge[cursor[to]] = e; cursor[to]++; }

// sample class instances (spread through the snapshot), print shortest root path for 3 of them
const clsIdx = strings.indexOf(CLS);
const samples = [];
for (let i = nodeCount - 1; i >= 0 && samples.length < 3; i--) if (nodes[i * NF + F.type] === nodeTypes.indexOf('object') && nodes[i * NF + F.name] === clsIdx && i % 7 === 0) samples.push(i);
console.log('samples of', CLS, ':', samples.length);
for (const target of samples) {
  const parent = new Int32Array(nodeCount).fill(-2);
  const parentEdge2 = new Int32Array(nodeCount).fill(-1);
  parent[target] = -1;
  let frontier = [target]; let root = -1;
  while (frontier.length && root < 0) {
    const next = [];
    for (const n of frontier) {
      for (let r = revStart[n]; r < revStart[n + 1]; r++) {
        const from = revFrom[r]; const e = revEdge[r];
        if (edgeType(e) === 'weak') continue;
        if (edgeLabel(e).includes('pair in WeakMap')) continue;
        if (parent[from] !== -2) continue;
        parent[from] = n; parentEdge2[from] = e;
        if (nodeType(from) === 'synthetic' || from === 0) { root = from; break; }
        next.push(from);
      }
      if (root >= 0) break;
    }
    frontier = next;
  }
  if (root < 0) { console.log(' * no non-weak root path (only weakly held)'); continue; }
  const parts = []; let cur = root; let guard = 0;
  while (cur !== target && guard++ < 30) { const e = parentEdge2[cur]; parts.push(`${nodeType(cur)}:${nodeName(cur).slice(0, 50)} --${edgeLabel(e)}--> `); cur = parent[cur]; }
  console.log(' *', parts.join(''), `TARGET:${CLS}`);
}

// Optional: dump classes pinned by DevTools-console global handles
if (process.env.DUMP_CONSOLE === '1') {
  const counts = {};
  for (let n = 0; n < nodeCount; n++) {
    if (nodeType(n) !== 'synthetic' || !/Global handles/.test(nodeName(n))) continue;
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
      const lbl = edgeLabel(e);
      if (!/DevTools console/.test(lbl)) continue;
      const to = edges[e * EF + E.to_node] / NF;
      const key = `${nodeType(to)}:${nodeName(to).slice(0, 40)}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  console.log('=== DevTools-console pinned objects:', JSON.stringify(counts, null, 1));
}
