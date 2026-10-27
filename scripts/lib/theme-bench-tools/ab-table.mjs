// usage: node ab-table.mjs <tag> <rounds>
import fs from 'node:fs';
import { summarizeCell } from '../theme-fleet-bench-page.mjs';
const SP = process.env.BENCH_OUT;
if (!SP) throw new Error('set BENCH_OUT to the results directory');
const [tag, rounds] = [process.argv[2], Number(process.argv[3] || 2)];
const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : NaN; };
const data = {};
for (const arm of ['A', 'B']) for (let r = 1; r <= rounds; r += 1) {
  const dir = `${SP}/${tag}-${arm}-r${r}/cells`;
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const s = summarizeCell(JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
    const k = s.theme; data[k] ??= { A: { rest: [], storm: [], gpu: [] }, B: { rest: [], storm: [], gpu: [] } };
    data[k][arm].rest.push(s.rest?.fps); data[k][arm].storm.push(Math.min(s.storm1?.fps ?? NaN, s.storm2?.fps ?? NaN));
    data[k][arm].gpu.push(s.rest?.gpuMsEst);
  }
}
console.log('| Theme | Rest fps A -> B | Worst storm fps A -> B | Rest frame ms A -> B | runs |');
console.log('|---|---:|---:|---:|---|');
for (const [k, v] of Object.entries(data).sort()) {
  const ra = med(v.A.rest), rb = med(v.B.rest), sa = med(v.A.storm), sb = med(v.B.storm);
  console.log(`| ${k} | ${ra.toFixed(0)} -> ${rb.toFixed(0)} (${((rb / ra - 1) * 100).toFixed(1)}%) | ${sa.toFixed(0)} -> ${sb.toFixed(0)} (${((sb / sa - 1) * 100).toFixed(1)}%) | ${(1000 / ra).toFixed(2)} -> ${(1000 / rb).toFixed(2)} | A ${v.A.rest.map((x) => x?.toFixed(0)).join('/')} B ${v.B.rest.map((x) => x?.toFixed(0)).join('/')} |`);
}
