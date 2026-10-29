// Six-tier matrix: each theme's worst-window frame time per tier, relative to its own High.
import fs from 'node:fs';
const SP = process.env.BENCH_OUT;
if (!SP) throw new Error('set BENCH_OUT to the results directory');
const tiers = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];
// usage: BENCH_OUT=<dir> node tier-matrix.mjs [High=<tag>] [Ultra=<tag>] ... (defaults tier-<Tier>)
const dirs = Object.fromEntries(tiers.map((t) => [t, `tier-${t}`]));
for (const a of process.argv.slice(2)) { const [k, v] = a.split('='); if (dirs[k] && v) dirs[k] = v; }
const data = {};
for (const t of tiers) {
  const s = JSON.parse(fs.readFileSync(`${SP}/${dirs[t]}/summary.json`, 'utf8'));
  for (const r of s.rows) {
    if (!r.ok) continue;
    const worstFps = Math.min(r.rest?.fps ?? Infinity, r.storm1?.fps ?? Infinity, r.storm2?.fps ?? Infinity);
    (data[r.theme] ??= {})[t] = { ms: 1000 / worstFps, fps: worstFps, pr: r.rest?.pixelRatio };
  }
}
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const rows = [];
const counts = { inverted: 0, flatLow: 0, flatHigh: 0, bigJump: 0 };
for (const [theme, v] of Object.entries(data)) {
  const h = v.High?.ms; if (!h) continue;
  const rel = Object.fromEntries(tiers.map((t) => [t, v[t] ? v[t].ms / h : NaN]));
  const flags = [];
  for (let i = 1; i < tiers.length; i += 1) {
    const a = rel[tiers[i - 1]]; const b = rel[tiers[i]];
    if (b < a * 0.97) flags.push(`${tiers[i]} cheaper than ${tiers[i - 1]}`);
  }
  if (rel.Medium > 0.9) flags.push('Medium saves <10%');
  if (rel.Low > 0.6) flags.push('Low saves <40%');
  if (rel.Ultra < 1.05) flags.push('Ultra adds <5%');
  if (rel.Extreme / rel.Ultra < 1.05) flags.push('Extreme ≈ Ultra');
  if (rel.Ultra > 2) flags.push('Ultra >2× High');
  if (rel.Extreme > 3) flags.push('Extreme >3× High');
  if (rel.Minimal > rel.Low * 0.97 && rel.Minimal <= rel.Low * 1.03) flags.push('Minimal ≈ Low');
  rows.push({ theme, rel, highFps: v.High.fps, flags });
}
rows.sort((a, b) => b.flags.length - a.flags.length || a.theme.localeCompare(b.theme));
const med = (k) => { const v = rows.map((r) => r.rel[k]).filter(Number.isFinite).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
console.log(`Median cost vs High (worst window): ${tiers.map((t) => `${t} ${f(med(t))}×`).join(', ')}`);
console.log('');
console.log('| Theme | High worst fps | Minimal | Low | Medium | Ultra | Extreme | Out of step |');
console.log('|---|---:|---:|---:|---:|---:|---:|---|');
for (const r of rows) console.log(`| ${r.theme} | ${f(r.highFps, 0)} | ${f(r.rel.Minimal)}× | ${f(r.rel.Low)}× | ${f(r.rel.Medium)}× | ${f(r.rel.Ultra)}× | ${f(r.rel.Extreme)}× | ${r.flags.join('; ') || '-'} |`);
console.log('');
console.log(`themes with at least one flag: ${rows.filter((r) => r.flags.length).length}/${rows.length}`);
