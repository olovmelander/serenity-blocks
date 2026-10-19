// Descendants of the longest slices on a thread of a Chromium trace (odyssey-feel-probe --trace=<phase>):
// node scripts/trace-long-slices.mjs <trace> --thread=CrGpuMain --min=60 --kid=1.5
import { readFileSync } from 'node:fs';
const [file, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const MIN = Number(args.min || 60) * 1000; const KID = Number(args.kid || 1.5) * 1000;
const events = (() => { const r = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(r) ? r : r.traceEvents; })();
const tn = new Map(); for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') tn.set(`${e.pid}:${e.tid}`, e.args?.name);
let t0 = Infinity; for (const e of events) if (e.ph === 'X' && e.ts > 0 && e.ts < t0) t0 = e.ts;
const list = events.filter((e) => e.ph === 'X' && (tn.get(`${e.pid}:${e.tid}`) || '').startsWith(args.thread || 'CrGpuMain')).sort((a, b) => a.ts - b.ts);
const tops = list.filter((e) => e.dur >= MIN && e.name === 'RunTask');
for (const e of tops) {
  console.log(`\n+${((e.ts - t0) / 1000).toFixed(0)} ms  ${(e.dur / 1000).toFixed(1)} ms ${e.name}`);
  const kids = list.filter((k) => k !== e && k.ts >= e.ts && k.ts + k.dur <= e.ts + e.dur && k.dur >= KID);
  const agg = new Map();
  for (const k of kids) { const key = k.name + (k.args && (k.args.label || k.args.name) ? `(${String(k.args.label || k.args.name).slice(0, 40)})` : ''); const a = agg.get(key) || { n: 0, ms: 0 }; a.n += 1; a.ms += k.dur / 1000; agg.set(key, a); }
  [...agg].sort((a, b) => b[1].ms - a[1].ms).slice(0, 18).forEach(([k, a]) => console.log(`   ${a.ms.toFixed(1).padStart(7)} ms  x${a.n}  ${k}`));
}
