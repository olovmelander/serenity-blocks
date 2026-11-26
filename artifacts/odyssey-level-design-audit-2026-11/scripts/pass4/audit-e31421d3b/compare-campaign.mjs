// Pass 4: compare a fresh measure.py run's skill-bands.csv with pass 3's published table, cell by cell.
// Usage: node compare-campaign.mjs <new skill-bands.csv> <baseline.csv>
import { readFileSync } from 'node:fs';

const parse = (file) => {
    const [head, ...lines] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const cols = head.split(',');
    return new Map(lines.map((line) => {
        // Names never hold a comma in these tables except inside quotes.
        const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
        const row = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
        return [`${row.orb}/${row.profile}/${row.cadence}`, row];
    }));
};
const [freshFile, baseFile] = process.argv.slice(2);
const fresh = parse(freshFile);
const base = parse(baseFile);
const RIVALS = new Set(['5', '10', '18', '26', '34', '48', '56', '60']);
const FIELDS = ['attempts', 'clears', 'at_least_2_stars', 'three_stars', 'primary_censored', 'lap_censored',
    'median_seconds_to_goal_on_clears', 'median_pieces_to_goal_on_clears'];
let same = 0;
const differing = [];
for (const [key, row] of base) {
    const mine = fresh.get(key);
    if (!mine) { differing.push([key, 'missing']); continue; }
    const cols = Object.keys(row).filter((c) => !['name', 'chapter'].includes(c));
    const changed = cols.filter((c) => String(row[c]) !== String(mine[c]));
    if (changed.length) differing.push([key, changed.map((c) => `${c}: ${row[c]} -> ${mine[c]}`).join('; ')]);
    else same++;
}
const solo = differing.filter(([key]) => !RIVALS.has(key.split('/')[0]));
const rival = differing.filter(([key]) => RIVALS.has(key.split('/')[0]));
console.log(`cells in baseline ${base.size}, in fresh ${fresh.size}, identical ${same}, differing ${differing.length} (solo ${solo.length}, rival ${rival.length})`);
for (const [key, what] of [...solo, ...rival].slice(0, 60)) console.log(`  ${key}: ${what}`);
void FIELDS;
