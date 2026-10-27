// Fleet at the panel's cadence: frames missed against the achieved cadence, worst windows, loads.
import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rows = s.rows.filter((r) => r.ok);
const errs = s.rows.filter((r) => !r.ok).map((r) => `${r.theme}: ${r.error}`);
const cad = 1000 / 178.2;
const out = rows.map((r) => {
  const w = [r.rest, r.storm1, r.storm2].filter(Boolean);
  const worst = w.reduce((a, b) => (a.fps <= b.fps ? a : b));
  // frames over 1.5x the panel-cadence interval = a visibly repeated frame
  const missed = w.reduce((n, x) => n + (x.janks || 0), 0);
  const frames = w.reduce((n, x) => n + (x.frames || 0), 0);
  return { theme: r.theme, restFps: r.rest?.fps, worstFps: worst.fps, worstP99: Math.max(...w.map((x) => x.p99 || 0)), missedPct: +((missed / frames) * 100).toFixed(2), coldShown: r.load1?.shown, coldFull: r.load1?.full, coldFreeze: r.load1?.longestFrameMs, warmShown: r.load2?.shown, warmFreeze: r.load2?.longestFrameMs, gpuUtil: worst.gpuUtil?.util };
});
out.sort((a, b) => a.worstFps - b.worstFps);
console.log('errors:', errs.join('; ') || 'none');
console.log('| Theme | Rest fps | Worst window fps | Worst p99 ms | Late frames % | GPU % (worst) | Cold: shown s | Cold freeze ms | Warm: shown s | Warm freeze ms |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');
for (const r of out) console.log(`| ${r.theme} | ${f(r.restFps)} | ${f(r.worstFps)} | ${f(r.worstP99, 1)} | ${f(r.missedPct, 2)} | ${f(r.gpuUtil)} | ${f(r.coldShown / 1000, 2)} | ${f(r.coldFreeze)} | ${f(r.warmShown / 1000, 2)} | ${f(r.warmFreeze)} |`);
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
console.log(`\nmedian cold shown ${f(med(out.map((r) => r.coldShown)) / 1000, 2)} s, warm ${f(med(out.map((r) => r.warmShown)) / 1000, 2)} s; themes under 175 fps in a window: ${out.filter((r) => r.worstFps < 175).map((r) => r.theme).join(', ')}`);
