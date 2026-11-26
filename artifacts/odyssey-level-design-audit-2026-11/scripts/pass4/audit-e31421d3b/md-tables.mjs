// Pass 4: the audit's rival tables in Markdown, from rival-run.mjs outputs.
// Usage: node md-tables.mjs "<label>=<file.jsonl>" ...   (rows are grouped by rival, one line per label)
import { readFileSync } from 'node:fs';
import { summarize } from './rival-summary.mjs';

const NAMES = { 5: 'Cinder', 10: 'Coral', 18: 'Willow', 26: 'Frost', 34: 'Zephyr', 48: 'Nova', 56: 'Prism', 60: 'Neon' };
// The rung each rival was calibrated to in passes 1-3 (the tier the index formula has always read).
const RUNG = { 5: 1, 10: 2, 18: 3, 26: 4, 34: 5, 48: 6, 56: 6, 60: 8 };
const sets = process.argv.slice(2).map((arg) => {
    const at = arg.indexOf('=');
    const rows = readFileSync(arg.slice(at + 1), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { label: arg.slice(0, at), summary: summarize(rows) };
});
const cell = (c) => (c.n ? `${c.wins}/${c.two}/${c.three}` : '–');
const one = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '–');

console.log('| Rival | Rival plays | Casual | Regular | Strong | Stand-ins N/R/S/E/Q | Regular match, min | Rival rows a piece | Bursts of 4+ rows per 100 pieces | Index |');
console.log('|---|---|---:|---:|---:|---|---:|---:|---:|---:|');
for (const orb of Object.keys(NAMES).map(Number)) {
    sets.forEach(({ label, summary }, i) => {
        const s = summary[orb];
        if (!s) return;
        const g = s.gates;
        const judged = ['novice', 'regular', 'skilled'].filter((k) => g[k].n);
        const loss = judged.length
            ? judged.reduce((sum, k) => sum + g[k].n - g[k].wins, 0) / judged.reduce((sum, k) => sum + g[k].n, 0) : null;
        const index = loss === null ? '–' : Math.min(10, 0.9 * RUNG[orb] + 3 * loss).toFixed(1);
        const stand = ['novice', 'regular', 'skilled', 'expert', 'quad'].map((k) => (g[k].n ? g[k].wins : '–')).join('/');
        console.log(`| ${i ? '' : `**${orb} · ${NAMES[orb]}**`} | ${label} | ${cell(s.paces.casual)} | ${cell(s.paces.regular)} | ${cell(s.paces.strong)} | ${stand} | ${one(s.paces.regular.minutes)} | ${one(s.style.rowsPerPiece, 2)} | ${one(s.style.bigPer100)} | ${index} |`);
    });
}
