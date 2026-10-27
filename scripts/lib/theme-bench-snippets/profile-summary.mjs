// Summarise a .cpuprofile: self time per bucket (by script file) and the top self-time functions.
// usage: node profile-summary.mjs <file.cpuprofile> [topN] [--fn=<substring to show callers>]
import fs from 'node:fs';

const file = process.argv[2];
const topN = Number(process.argv[3]) || 25;
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas;
for (let i = 0; i < p.samples.length; i += 1) {
  const id = p.samples[i];
  self.set(id, (self.get(id) || 0) + (dt[i] || 0));
}
const totalUs = dt.reduce((a, b) => a + b, 0);
const bucketOf = (n) => {
  const cf = n.callFrame;
  const url = cf.url || '';
  if (!url) return cf.functionName.startsWith('(') ? cf.functionName : '(native)';
  const f = url.split('/').pop().split('?')[0];
  if (/^three[-.]/.test(f) || url.includes('/node_modules/three/')) return 'three';
  if (/^phaser/.test(f) || url.includes('/node_modules/phaser/')) return 'phaser';
  if (url.includes('/src/themes/')) return `theme:${url.split('/src/themes/')[1].split('/')[0]}`;
  if (url.includes('/src/')) return `app:${url.split('/src/')[1].split('/')[0]}`;
  return `file:${f.replace(/-[A-Za-z0-9_]{8}\.js$/, '.js')}`;
};
const buckets = new Map();
const fns = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  const b = bucketOf(n);
  buckets.set(b, (buckets.get(b) || 0) + us);
  const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'} @ ${(cf.url || '').split('/').pop()}:${cf.lineNumber + 1}`;
  fns.set(key, (fns.get(key) || 0) + us);
}
const ms = (us) => (us / 1000).toFixed(1);
const secs = totalUs / 1e6;
console.log(`profile ${secs.toFixed(2)} s, ${p.samples.length} samples`);
console.log('bucket                         ms/s    %');
for (const [b, us] of [...buckets].sort((a, c) => c[1] - a[1]).slice(0, 20)) {
  console.log(`${b.padEnd(30)} ${(us / 1000 / secs).toFixed(1).padStart(6)} ${((us / totalUs) * 100).toFixed(1).padStart(5)}`);
}
console.log(`\ntop ${topN} self-time functions (ms/s):`);
for (const [k, us] of [...fns].sort((a, c) => c[1] - a[1]).slice(0, topN)) {
  console.log(`${(us / 1000 / secs).toFixed(1).padStart(6)}  ${k}`);
}
