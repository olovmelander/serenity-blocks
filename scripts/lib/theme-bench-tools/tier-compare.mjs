// Frame-time ratio of a tier against High per theme (uncapped): rest and worst storm.
import fs from 'node:fs';
const [base, tier, label] = process.argv.slice(2);
const read = (p) => Object.fromEntries(JSON.parse(fs.readFileSync(p, 'utf8')).rows.filter((r) => r.ok).map((r) => [r.theme, r]));
const H = read(base); const T = read(tier);
const worst = (r) => Math.min(r.storm1?.fps ?? Infinity, r.storm2?.fps ?? Infinity);
const rows = [];
for (const [k, h] of Object.entries(H)) {
  const t = T[k]; if (!t) continue;
  const rest = (1000 / t.rest.fps) / (1000 / h.rest.fps);
  const storm = (1000 / worst(t)) / (1000 / worst(h));
  rows.push({ k, hRest: h.rest.fps, tRest: t.rest.fps, hStorm: worst(h), tStorm: worst(t), rest, storm, prH: h.rest.pixelRatio, prT: t.rest.pixelRatio });
}
rows.sort((a, b) => b.storm - a.storm);
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const med = (a) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
console.log(`${label}: median frame-time ratio vs High: rest ${f(med(rows.map((r) => r.rest)), 2)}x, storm ${f(med(rows.map((r) => r.storm)), 2)}x; below 240 fps somewhere: ${rows.filter((r) => Math.min(r.tRest, r.tStorm) < 240).length}/${rows.length}`);
console.log('| Theme | High rest / storm fps | ' + label + ' rest / storm fps | Cost vs High (rest / storm) | Pixel ratio |');
console.log('|---|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.k} | ${f(r.hRest)} / ${f(r.hStorm)} | ${f(r.tRest)} / ${f(r.tStorm)} | ${f(r.rest, 2)}x / ${f(r.storm, 2)}x | ${f(r.prH, 2)} → ${f(r.prT, 2)} |`);
