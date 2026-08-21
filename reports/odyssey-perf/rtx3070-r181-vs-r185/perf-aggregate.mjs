// Aggregate process-per-run perf sessions: median/min/max across repeats, r181 vs r185.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const DIR = process.argv[2];
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const cells = {};
for (const f of files) {
  const m = /^(r18[15])-(load|idle)-(cold|warm)-(\d+)\.json$/.exec(f); if (!m) continue;
  const [, tag, scenario, cache] = m;
  const r = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
  const key = `${scenario}-${cache}`;
  cells[key] ??= { r181: [], r185: [] };
  const metrics = r.aggregate.metrics; const run = r.runs[0];
  const pick = (k) => metrics[k]?.values?.[0];
  cells[key][tag].push({
    startupTotal: pick('startup.totalMs'), boardVisible: pick('boardVisibleMs'),
    buckets: run.parsedConsole?.startup?.buckets || {},
    p50: pick('frame.p50'), p95: pick('frame.p95'), p99: pick('frame.p99'), fmax: pick('frame.max'),
    spikes: pick('spikes'), ltCount: pick('longTasks.count'), ltTotal: pick('longTasks.totalMs'), ltMax: pick('longTasks.maxMs'),
    draws: pick('drawCalls.p50'), tris: pick('triangles.p50'), mem: pick('memory.usedJSHeapSizeMB'),
    backend: run.browser?.backend?.name,
  });
}
const row = (label, f, d = 0) => {
  const out = [label];
  for (const tag of ['r181', 'r185']) { const vals = cur[tag].map(f).filter((v) => typeof v === 'number'); out.push(vals.length ? `${fmt(med(vals), d)} (${fmt(Math.min(...vals), d)}–${fmt(Math.max(...vals), d)}, n=${vals.length})` : '—'); }
  const a = med(cur.r181.map(f).filter((v) => typeof v === 'number')), b = med(cur.r185.map(f).filter((v) => typeof v === 'number'));
  out.push(Number.isFinite(a) && Number.isFinite(b) && a !== 0 ? `${(((b - a) / a) * 100).toFixed(0)}%` : '—');
  return `| ${out.join(' | ')} |`;
};
let cur;
for (const key of Object.keys(cells).sort()) {
  cur = cells[key];
  console.log(`\n### ${key}  (median (min–max, n) — delta r185 vs r181)\n`);
  console.log('| metric | r181 | r185 | Δ |\n|---|---|---|---|');
  if (key.startsWith('load')) {
    console.log(row('startup total ms', (x) => x.startupTotal));
    for (const b of ['renderer', 'world', 'creates', 'nodes', 'post+director', 'compiles', 'warmup']) console.log(row(`  startup bucket: ${b}`, (x) => x.buckets[b]));
    console.log(row('board visible ms', (x) => x.boardVisible));
  }
  console.log(row('frame p50 ms', (x) => x.p50, 2)); console.log(row('frame p95 ms', (x) => x.p95, 2)); console.log(row('frame p99 ms', (x) => x.p99, 2)); console.log(row('frame max ms', (x) => x.fmax, 1));
  console.log(row('spikes', (x) => x.spikes)); console.log(row('long tasks (count)', (x) => x.ltCount)); console.log(row('long tasks total ms', (x) => x.ltTotal)); console.log(row('long task max ms', (x) => x.ltMax));
  console.log(row('draw calls p50', (x) => x.draws)); console.log(row('triangles p50', (x) => x.tris)); console.log(row('JS heap MB', (x) => x.mem, 1));
  console.log(`backend: r181=${[...new Set(cur.r181.map((x) => x.backend))]} r185=${[...new Set(cur.r185.map((x) => x.backend))]}`);
}
