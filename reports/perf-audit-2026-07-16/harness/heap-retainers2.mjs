// Pin-free retainer analysis: locate the disposed theme via window.__ref (WeakRef weak edge),
// then BFS upward over non-weak edges printing external retainer paths.
import { chromium } from 'playwright-core';

const THEME = process.argv[2] || 'lunara';
const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
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

await switchTo(THEME);
await page.waitForTimeout(5000);
await page.evaluate(() => { window.__ref = new WeakRef(window.themeManager.activeTheme); });
await switchTo('forest');
await page.waitForTimeout(3000);
await cdp.send('HeapProfiler.collectGarbage');
await page.waitForTimeout(400);
await cdp.send('HeapProfiler.collectGarbage');
await page.waitForTimeout(600);

let chunks = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
const raw = chunks.join('');
console.log('snapshot bytes:', raw.length);
await browser.close();

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

const firstEdge = new Float64Array(nodeCount + 1);
for (let i = 0; i < nodeCount; i++) firstEdge[i + 1] = firstEdge[i] + nodes[i * NF + F.edge_count];

const nodeName = (i) => strings[nodes[i * NF + F.name]];
const nodeType = (i) => nodeTypes[nodes[i * NF + F.type]];
const edgeType = (e) => edgeTypes[edges[e * EF + E.type]];
const edgeLabel = (e) => {
  const t = edgeType(e);
  const ni = edges[e * EF + E.name_or_index];
  return t === 'element' || t === 'hidden' ? `${t}[${ni}]` : `${t}:${strings[ni]}`;
};

// find window.__ref WeakRef, then its weak target
const refStr = strings.indexOf('__ref');
let target = -1;
for (let e = 0; e < edgeCount && target < 0; e++) {
  if (edges[e * EF + E.name_or_index] === refStr && edgeType(e) === 'property') {
    const weakRefNode = edges[e * EF + E.to_node] / NF;
    for (let e2 = firstEdge[weakRefNode]; e2 < firstEdge[weakRefNode + 1]; e2++) {
      if (edgeType(e2) === 'weak') { target = edges[e2 * EF + E.to_node] / NF; break; }
    }
  }
}
if (target < 0) { console.log('target not found (instance may have been collected — good sign if alive=false)'); process.exit(1); }
console.log('target class:', nodeName(target), 'self+edges ok');

// reverse edges
const revCount = new Uint32Array(nodeCount);
for (let e = 0; e < edgeCount; e++) revCount[edges[e * EF + E.to_node] / NF]++;
const revStart = new Float64Array(nodeCount + 1);
for (let i = 0; i < nodeCount; i++) revStart[i + 1] = revStart[i] + revCount[i];
const revFrom = new Uint32Array(edgeCount);
const revEdge = new Uint32Array(edgeCount);
const cursor = Float64Array.from(revStart.subarray(0, nodeCount));
for (let n = 0; n < nodeCount; n++) {
  for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
    const to = edges[e * EF + E.to_node] / NF;
    revFrom[cursor[to]] = n; revEdge[cursor[to]] = e; cursor[to]++;
  }
}

// Dijkstra-ish BFS upward from target, avoiding weak edges; collect distinct root paths.
const parent = new Int32Array(nodeCount).fill(-2);
const parentEdge = new Int32Array(nodeCount).fill(-1);
parent[target] = -1;
let frontier = [target];
const roots = [];
while (frontier.length && roots.length < 12) {
  const next = [];
  for (const n of frontier) {
    for (let r = revStart[n]; r < revStart[n + 1]; r++) {
      const from = revFrom[r]; const e = revEdge[r];
      if (edgeType(e) === 'weak') continue;
      if (parent[from] !== -2) continue;
      parent[from] = n; parentEdge[from] = e;
      if (nodeType(from) === 'synthetic' || from === 0) { roots.push(from); continue; }
      next.push(from);
    }
  }
  frontier = next;
}
console.log('=== root paths:');
for (const root of roots) {
  const parts = [];
  let cur = root;
  let guard = 0;
  while (cur !== target && guard++ < 30) {
    const child = parent[cur];
    const e = parentEdge[cur];
    parts.push(`${nodeType(cur)}:${nodeName(cur).slice(0, 55)}`);
    parts.push(` --${edgeLabel(e)}--> `);
    cur = child;
  }
  parts.push(`TARGET:${nodeName(target)}`);
  console.log(' *', parts.join(''));
}
