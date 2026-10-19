// Markdown A/B table of odyssey-feel-probe runs: node scripts/odyssey-feel-ab.mjs --dir=<runs dir> --base=runA,runB --fix=runC,runD
// Per phase and canvas: fps, missed refreshes (> 1.5 frames), frames over 50 ms, worst frame,
// sync pipeline creations, render scale. Cells show each run of the arm, "a / b".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return [a.slice(2, i), a.slice(i + 1)]; }));
const load = (names) => String(names || '').split(',').filter(Boolean).map((n) => {
    try { return JSON.parse(readFileSync(join(args.dir || 'runs', n, 'feel.json'), 'utf8')); } catch { return null; }
}).filter(Boolean);
const base = load(args.base); const fix = load(args.fix);
const rows = [];
const phasesOf = (r) => {
    const out = {};
    for (const [name, s] of Object.entries(r.phases || {})) {
        if (s && s.raf) {
            if (name === 'start' && s.afterReveal) out['start (after reveal)'] = s.afterReveal; else out[name] = s;
        } else if (s && typeof s === 'object') {
            for (const [k, v] of Object.entries(s)) if (v && v.raf) out[`${name}.${k}`] = v;
        }
    }
    return out;
};
const names = [...new Set([...base, ...fix].flatMap((r) => Object.keys(phasesOf(r))))];
const canvasOf = (s, which) => {
    if (!s || !s.canvases) return null;
    if (which === 'map') return s.canvases.odyssey || null;
    const theme = Object.entries(s.canvases).find(([k]) => k !== 'odyssey');
    return theme ? theme[1] : null;
};
const cell = (arm, name, fn) => arm.map((r) => { const s = phasesOf(r)[name]; const v = s ? fn(s) : null; return v == null ? '-' : v; }).join(' / ');
console.log('| Phase | surface | fps base | fps fix | >50 ms base | >50 ms fix | worst base | worst fix | sync base | sync fix | scale base | scale fix |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const name of names) {
    for (const which of ['map', 'theme']) {
        const any = [...base, ...fix].some((r) => canvasOf(phasesOf(r)[name], which));
        if (!any) continue;
        const f = (k) => (s) => { const c = canvasOf(s, which); return c ? c[k] : null; };
        rows.push(`| ${name} | ${which} | ${cell(base, name, f('fps'))} | ${cell(fix, name, f('fps'))} | ${cell(base, name, f('over50'))} | ${cell(fix, name, f('over50'))} | ${cell(base, name, f('max'))} | ${cell(fix, name, f('max'))} | ${cell(base, name, (s) => s.pipes.sync)} | ${cell(fix, name, (s) => s.pipes.sync)} | ${cell(base, name, (s) => s.pixelRatio)} | ${cell(fix, name, (s) => s.pixelRatio)} |`);
    }
}
console.log(rows.join('\n'));
