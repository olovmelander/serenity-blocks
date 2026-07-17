// CDP CPU profile of a scenario: menu-idle or gameplay. Outputs top self-time functions.
import fs from 'fs';
import { chromium } from 'playwright-core';

const scenario = process.argv[2] || 'gameplay';
const DUR = Number(process.argv[3] || 25000);
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUTDIR = new URL('./results/', import.meta.url).pathname;

const GPU_ARGS = ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, ignoreDefaultArgs: ['--disable-gpu'], args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE + '/?skipIntro=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => (window.__serenityStartupTrace || []).some((e) => /menu-ready/.test(e.phase || e.label || '')), null, { timeout: 90000 });
await page.waitForTimeout(4000);

if (scenario === 'gameplay') {
  await page.evaluate(`window.__gs = () => { const m = window.serenityBlocks?.gameModeManager?.getCurrentMode?.(); return m && m.gameState ? m.gameState : null; }`);
  await page.click('#single-player-card-btn');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => { const gs = window.__gs && window.__gs(); return gs && gs.currentPiece; }, null, { timeout: 30000 });
  await page.evaluate(fs.readFileSync(new URL('./bot-snippet.js', import.meta.url).pathname, 'utf8'));
  await page.waitForTimeout(3000);
}

const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const t0 = Date.now();
await page.waitForTimeout(DUR);
const { profile } = await cdp.send('Profiler.stop');
const wallMs = Date.now() - t0;

fs.writeFileSync(OUTDIR + `cpuprofile-${scenario}.cpuprofile`, JSON.stringify(profile));

// Aggregate self time per node
const totalSamples = profile.samples.length;
const selfMicros = new Map();
const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
const hitByNode = new Map();
for (const s of profile.samples) hitByNode.set(s, (hitByNode.get(s) || 0) + 1);
const totalTimeMicros = profile.endTime - profile.startTime;
const rows = [...hitByNode.entries()].map(([id, hits]) => {
  const n = nodeById.get(id);
  const f = n.callFrame;
  return {
    fn: f.functionName || '(anonymous)',
    url: (f.url || '').replace(/^https?:\/\/[^/]+/, '').slice(-70),
    line: f.lineNumber,
    selfPct: +((hits / totalSamples) * 100).toFixed(2),
    hits,
  };
}).sort((a, b) => b.hits - a.hits);

// Busy fraction: samples not in (idle/program/GC named nodes)
const idleNames = new Set(['(idle)', '(program)', '(garbage collector)', '(root)']);
const idleHits = rows.filter((r) => idleNames.has(r.fn)).reduce((a, r) => a + r.hits, 0);
const gc = rows.find((r) => r.fn === '(garbage collector)');
console.log(JSON.stringify({
  scenario, wallMs, totalSamples, totalTimeMicros,
  busyPct: +(((totalSamples - idleHits) / totalSamples) * 100).toFixed(1),
  gcPct: gc ? gc.selfPct : 0,
  top: rows.filter((r) => !idleNames.has(r.fn)).slice(0, 30),
}, null, 1));
await browser.close();
