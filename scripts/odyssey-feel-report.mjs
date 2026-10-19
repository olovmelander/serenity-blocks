// Compact report of one or more odyssey-feel-probe runs: node scripts/odyssey-feel-report.mjs <runDir> [<runDir>...] [--bins] [--v]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BINS = process.argv.includes('--bins');
const VERBOSE = process.argv.includes('--v');
const fmtCanvas = (c) => (c ? `${String(c.fps).padStart(5)}fps miss ${String(c.missed).padStart(3)} >20 ${String(c.over20).padStart(2)} >50 ${String(c.over50).padStart(2)} max ${String(c.max).padStart(6)}` : '-');
for (const dir of dirs) {
    let r;
    try { r = JSON.parse(readFileSync(join(dir, 'feel.json'), 'utf8')); } catch (e) { console.log(dir, 'no feel.json'); continue; }
    console.log(`\n== ${dir}  quality ${r.quality} cap ${r.fps} ${r.query || ''} ${r.error ? 'ERROR ' + r.error : ''}`);
    const rows = [];
    const add = (name, s) => {
        if (!s || !s.raf) return;
        const ody = s.canvases && s.canvases.odyssey;
        const other = s.canvases && Object.entries(s.canvases).filter(([k]) => k !== "odyssey").map(([k, v]) => `${k}${v.name ? "(" + v.name.slice(0, 40) + ")" : ""}:${fmtCanvas(v)}`).join(" ");
        rows.push(`${name.padEnd(16)} main p50 ${String(s.mainMs.p50).padStart(4)} p99 ${String(s.mainMs.p99).padStart(5)} max ${String(s.mainMs.max).padStart(6)} | ody ${fmtCanvas(ody)} | pipes s${s.pipes.sync}/a${s.pipes.async} | pr ${s.pixelRatio}${other ? ' | ' + other : ''}`);
        if (VERBOSE && s.loaf && s.loaf.length) rows.push(`${''.padEnd(16)} loaf ${s.loaf.slice(0, 4).map((l) => `${l.at}:${l.ms}ms(b${l.block})[${l.scripts.map((x) => x.inv.replace('FrameRequestCallback', 'rAF').replace('TimerHandler:', '') + ' ' + x.ms).join(',')}]`).join('  ')}`);
        if (VERBOSE && s.pipes.syncAt && s.pipes.syncAt.length) {
            const counts = {};
            for (const [, l] of s.pipes.syncAt) counts[l] = (counts[l] || 0) + 1;
            rows.push(`${''.padEnd(16)} sync ${Object.entries(counts).map(([l, n]) => `${l.replace('renderPipeline_', '')}x${n}`).join(' ')}`);
        }
    };
    for (const [name, s] of Object.entries(r.phases || {})) {
        if (s && s.raf) { add(name, s); if (s.afterReveal) add(`${name}.reveal`, s.afterReveal); } else if (s && typeof s === 'object') for (const [k, v] of Object.entries(s)) add(`${name}.${k}`, v);
        if (name === 'travel' && s.gpuTravel && s.gpuTravel.length) rows.push(`  gpu/s: ${s.gpuTravel.map((g) => `${g.p}:${g.p50}/${g.p95}${g.pr !== 1 ? '@' + g.pr : ''}`).join(' ')}`);
    }
    for (const row of rows) console.log(row);
    if (r.phases.start) console.log(`boardActiveMs ${r.phases.start.boardActiveMs}`);
    if (BINS && r.phases.travel && r.phases.travel.bins) {
        const b = r.phases.travel.bins;
        console.log('bins (p: missed/worst ms, work avg/max):', Object.keys(b).sort().filter((k) => b[k].missed || b[k].workMax > 7).map((k) => `${k}:${b[k].missed}/${b[k].worst} w${b[k].work}/${b[k].workMax}`).join('  '));
    }
}
