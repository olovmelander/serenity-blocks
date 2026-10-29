// Timeline of a .cpuprofile: per bucket (ms) the busy ms and the top self functions with their callers.
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bucketMs = Number(process.argv[3]) || 250;
const from = Number(process.argv[4]) || 0; const to = Number(process.argv[5]) || Infinity;
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
let t = p.startTime;
const buckets = new Map();
const name = (n) => `${n.callFrame.functionName || '(anon)'}@${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`;
for (let i = 0; i < p.samples.length; i += 1) {
  t += p.timeDeltas[i];
  const ms = (t - p.startTime) / 1000;
  if (ms < from || ms > to) continue;
  const n = byId.get(p.samples[i]);
  const fn = n.callFrame.functionName;
  const b = Math.floor(ms / bucketMs) * bucketMs;
  const cur = buckets.get(b) || { busy: 0, fns: new Map() };
  const dt = (p.timeDeltas[i + 1] || p.timeDeltas[i]) / 1000;
  if (fn !== '(idle)' && fn !== '(program)') {
    cur.busy += dt;
    // name a frame 3 levels up for context
    let q = n; const chain = [];
    for (let k = 0; k < 6 && q; k += 1) { chain.push(q.callFrame.functionName || '(anon)'); q = byId.get(parent.get(q.id)); }
    const key = chain.slice(0, 6).join(' < ');
    cur.fns.set(key, (cur.fns.get(key) || 0) + dt);
  }
  buckets.set(b, cur);
}
for (const [b, v] of [...buckets].sort((x, y) => x[0] - y[0])) {
  const top = [...v.fns].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, d]) => `${d.toFixed(1)}ms ${k}`).join(' || ');
  console.log(`${String(b).padStart(6)} busy ${v.busy.toFixed(1).padStart(6)}  ${top}`);
}
