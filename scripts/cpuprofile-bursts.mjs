// Long main-thread bursts in a .cpuprofile and what ran inside each.
// node scripts/cpuprofile-bursts.mjs <file.cpuprofile> [--min=30] [--gap=4] [--top=8] [--match=<regex on url>] [--steady=1]
//   A burst = consecutive non-idle samples with idle gaps under --gap ms, lasting >= --min ms.
//   --steady=1 also prints the whole-profile inclusive table (steady-state cost per function).
import { readFileSync } from 'node:fs';

const [file, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const i = a.indexOf('='); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), '1']; }));
const MIN = Number(args.min || 30);
const GAP = Number(args.gap || 4);
const TOP = Number(args.top || 8);
const match = new RegExp(args.match || '/src/|three|/deps/');
const p = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const short = (cf) => `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/^.*\/(src|deps|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
const IDLE = new Set(['(idle)', '(program)']);
// Sample times.
const times = []; let t = p.startTime;
for (let i = 0; i < p.samples.length; i += 1) { t += p.timeDeltas[i] || 0; times.push(t); }
const isIdle = (i) => IDLE.has(byId.get(p.samples[i]).callFrame.functionName);
const bursts = [];
let start = -1; let lastBusy = -1;
for (let i = 0; i < p.samples.length; i += 1) {
    if (isIdle(i)) {
        if (start >= 0 && (times[i] - times[lastBusy]) / 1000 > GAP) {
            bursts.push([start, lastBusy]); start = -1;
        }
        continue;
    }
    if (start < 0) start = i;
    lastBusy = i;
}
if (start >= 0) bursts.push([start, lastBusy]);
const tables = (from, to) => {
    const incl = new Map(); const selfBy = new Map(); let busy = 0;
    for (let i = from; i <= to; i += 1) {
        const dt = (p.timeDeltas[i + 1] || p.timeDeltas[i] || 0);
        const id = p.samples[i]; const n = byId.get(id);
        if (IDLE.has(n.callFrame.functionName)) continue;
        busy += dt;
        const k = short(n.callFrame); selfBy.set(k, (selfBy.get(k) || 0) + dt);
        const seen = new Set();
        for (let q = id; q !== undefined; q = parent.get(q)) {
            const cf = byId.get(q).callFrame;
            if (!match.test(cf.url)) continue;
            const key = short(cf); if (seen.has(key)) continue; seen.add(key);
            incl.set(key, (incl.get(key) || 0) + dt);
        }
    }
    return { incl, selfBy, busy };
};
const ms = (us) => (us / 1000).toFixed(1).padStart(7);
const long = bursts.map(([a, b]) => [a, b, (times[b] - times[a]) / 1000]).filter((x) => x[2] >= MIN);
console.log(`${file}: ${((p.endTime - p.startTime) / 1e6).toFixed(1)} s, ${long.length} bursts >= ${MIN} ms`);
for (const [a, b, dur] of long) {
    const { incl, selfBy, busy } = tables(a, b);
    console.log(`\n-- burst at +${((times[a] - p.startTime) / 1000).toFixed(0)} ms, ${dur.toFixed(0)} ms long, busy ${ms(busy)} ms`);
    // Inclusive table, skipping entries that equal their single child chain (keep the informative ones).
    [...incl].sort((x, y) => y[1] - x[1]).slice(0, TOP * 2).forEach(([k, us]) => console.log(`  ${ms(us)}  ${k}`));
    console.log('   self:', [...selfBy].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, us]) => `${(us / 1000).toFixed(1)} ${k}`).join(' | '));
}
if (args.steady) {
    const { incl, selfBy, busy } = tables(0, p.samples.length - 1);
    console.log(`\n== whole profile busy ${ms(busy)} ms`);
    [...incl].sort((x, y) => y[1] - x[1]).slice(0, Number(args.steadyTop || 40)).forEach(([k, us]) => console.log(`  ${ms(us)}  ${k}`));
    console.log('  self:'); [...selfBy].sort((x, y) => y[1] - x[1]).slice(0, 25).forEach(([k, us]) => console.log(`  ${ms(us)}  ${k}`));
}
