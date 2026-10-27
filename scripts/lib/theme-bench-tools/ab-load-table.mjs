import fs from 'node:fs';
import { summarizeCell } from '../theme-fleet-bench-page.mjs';
const SP = process.env.BENCH_OUT;
if (!SP) throw new Error('set BENCH_OUT to the results directory');
const [tag, rounds] = [process.argv[2], Number(process.argv[3] || 2)];
const data = {};
for (const arm of ['A', 'B']) for (let r = 1; r <= rounds; r += 1) {
  const dir = `${SP}/${tag}-${arm}-r${r}/cells`;
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const raw = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
    const s = summarizeCell(raw);
    const k = s.theme; data[k] ??= { A: [], B: [] };
    const gi = (l) => (l?.gpuInit ? l.gpuInit.adapters.reduce((t, x) => t + x.ms, 0) + l.gpuInit.devices.reduce((t, x) => t + x.ms, 0) : null);
    data[k][arm].push({ c: s.load1?.shown, cr: s.load1?.running, w: s.load2?.shown, wr: s.load2?.running, cf: s.load1?.longestFrameMs, wf: s.load2?.longestFrameMs, gi1: gi(raw.phases.load1), gi2: gi(raw.phases.load2) });
  }
}
const mean = (a) => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
const f = (x) => (Number.isFinite(x) ? Math.round(x) : '-');
console.log('| Theme | Cold shown ms A -> B | Warm shown ms A -> B | Cold running A -> B | GPU init in load ms A -> B | Freeze cold/warm A -> B |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const [k, v] of Object.entries(data).sort()) {
  const g = (arm, key) => mean(v[arm].map((x) => x[key]));
  console.log(`| ${k} | ${f(g('A', 'c'))} -> ${f(g('B', 'c'))} | ${f(g('A', 'w'))} -> ${f(g('B', 'w'))} | ${f(g('A', 'cr'))} -> ${f(g('B', 'cr'))} | ${f(g('A', 'gi1'))}/${f(g('A', 'gi2'))} -> ${f(g('B', 'gi1'))}/${f(g('B', 'gi2'))} | ${f(g('A', 'cf'))}/${f(g('A', 'wf'))} -> ${f(g('B', 'cf'))}/${f(g('B', 'wf'))} |`);
}
