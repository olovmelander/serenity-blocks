// Pass 4 prototype: tabulate rival-run.mjs outputs. Usage: node rival-table.mjs <label=file.jsonl>... [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { summarize } from './rival-summary.mjs';

const NAMES = { 5: 'Cinder', 10: 'Coral', 18: 'Willow', 26: 'Frost', 34: 'Zephyr', 48: 'Nova', 56: 'Prism', 60: 'Neon' };
const GATE = { 'stacker/deliberate': 'novice', 'stacker/native': 'regular', 'cascade/steady': 'skilled', 'expert/native': 'expert', 'quad/native': 'quad' };
const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const median = (values) => {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const sum = (values) => values.reduce((a, b) => a + (b || 0), 0);

const fmt = (c) => `${c.wins}/${c.two}/${c.three}`.padEnd(9);
const sets = args.map((arg) => {
    const [label, file] = arg.split('=');
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { label, summary: summarize(rows), count: rows.length };
});
for (const { label, summary, count } of sets) {
    console.log(`\n== ${label} (${count} matches) ==`);
    console.log('orb rival   | casual /30 | regular /30 | strong /30 | nov reg skl exp quad /15 | min reg | rival p/min rows/pc big/100 max | rival deaths: all, by rows, side tower | player by rows');
    for (const [orb, s] of Object.entries(summary)) {
        const g = s.gates;
        const gate = ['novice', 'regular', 'skilled', 'expert', 'quad'].map((k) => (g[k].n ? String(g[k].wins).padStart(2) : ' -')).join('  ');
        const d = s.deaths;
        console.log(`${String(orb).padStart(2)} ${s.name.padEnd(7)} | ${fmt(s.paces.casual)}  | ${fmt(s.paces.regular)}   | ${fmt(s.paces.strong)}  | ${gate}      | ${(s.paces.regular.minutes ?? 0).toFixed(1).padStart(5)}   | ${(s.style.piecesPerMinute ?? 0).toFixed(0).padStart(4)}  ${(s.style.rowsPerPiece ?? 0).toFixed(2)}  ${(s.style.bigPer100 ?? 0).toFixed(1).padStart(4)}  ${String(s.style.biggest).padStart(2)}       | ${String(d.rival).padStart(3)} ${String(d.rivalByRows).padStart(3)} ${String(d.rivalBySideTower).padStart(3)}                         | ${d.playerByRows}/${d.player}`);
    }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(Object.fromEntries(sets.map((s) => [s.label, s.summary])), null, 1));
