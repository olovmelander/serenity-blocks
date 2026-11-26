// Level design pass 4: each rival in the game's own levels, from rival-levels.mjs output.
//   node level-gates.mjs <levels.jsonl> [out.json] [--markdown]
// Prints wins-losses-undecided by the player's local level and the level at which a player is even,
// and writes the same as JSON for gates_p4.py.
import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = { 5: 'Cinder', 10: 'Coral', 18: 'Willow', 26: 'Frost', 34: 'Zephyr', 48: 'Nova', 56: 'Prism', 60: 'Neon' };
const args = process.argv.slice(2);
const markdown = args.includes('--markdown');
const [file, outFile] = args.filter((arg) => !arg.startsWith('--'));
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const levels = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b);
const median = (values) => {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
};
const result = {};
for (const orb of Object.keys(NAMES).map(Number)) {
    const mine = rows.filter((r) => r.orb === orb);
    if (!mine.length) continue;
    const cells = {};
    for (const level of levels) {
        const m = mine.filter((r) => r.level === level);
        if (!m.length) continue;
        const knockouts = m.reduce((s, r) => s + r.knockouts[0] + r.knockouts[1], 0);
        cells[level] = {
            n: m.length,
            wins: m.filter((r) => r.outcome === 'win').length,
            losses: m.filter((r) => r.outcome === 'loss').length,
            undecided: m.filter((r) => r.outcome === 'censored').length,
            medianMinutes: +(median(m.map((r) => r.seconds / 60))).toFixed(1),
            minutesAKnockout: +(m.reduce((s, r) => s + r.seconds / 60, 0) / Math.max(1, knockouts)).toFixed(1),
            uncredited: m.reduce((s, r) => s + r.uncredited[0] + r.uncredited[1], 0),
        };
    }
    // The level where the player starts winning half the matches, between neighbours by a straight line.
    const played = Object.keys(cells).map(Number).sort((a, b) => a - b);
    const share = (level) => cells[level].wins / cells[level].n;
    let evenAt = null;
    if (share(played[0]) >= 0.5) evenAt = played[0];
    else {
        for (let i = 1; i < played.length; i++) {
            const a = share(played[i - 1]);
            const b = share(played[i]);
            if (a < 0.5 && b >= 0.5) { evenAt = +(played[i - 1] + (0.5 - a) / (b - a)).toFixed(1); break; }
        }
    }
    result[orb] = { name: NAMES[orb], cells, evenAt, evenBelowLowest: share(played[0]) >= 0.5 };
}
if (outFile) writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);
const cellText = (c) => `${c.wins}–${c.losses}–${c.undecided}`;
const even = (r) => {
    if (r.evenAt === null) return `above ${levels[levels.length - 1]}`;
    return r.evenBelowLowest ? `below ${r.evenAt}` : r.evenAt.toFixed(1);
};
if (markdown) {
    console.log(`| Rival | ${levels.map((l) => `Level ${l}`).join(' | ')} | Even at | Median minutes at levels 5 / 6 / 7 |`);
    console.log(`|---|${levels.map(() => '---:').join('|')}|---:|---|`);
    for (const [orb, r] of Object.entries(result)) {
        console.log(`| ${orb} · ${r.name} | ${levels.map((l) => (r.cells[l] ? cellText(r.cells[l]) : '–')).join(' | ')} | ${even(r)} | ${[5, 6, 7].map((l) => r.cells[l]?.medianMinutes?.toFixed(0) ?? '–').join(' / ')} |`);
    }
} else {
    console.log(`rival      | ${levels.map((l) => `L${l}`.padStart(9)).join(' ')} | even at | median min L5/L6/L7 | no-credit wells`);
    for (const [orb, r] of Object.entries(result)) {
        const none = Object.values(r.cells).reduce((s, c) => s + c.uncredited, 0);
        console.log(`${String(orb).padStart(2)} ${r.name.padEnd(7)} | ${levels.map((l) => (r.cells[l] ? cellText(r.cells[l]) : '-').padStart(9)).join(' ')} | ${even(r).padStart(7)} | ${[5, 6, 7].map((l) => r.cells[l]?.medianMinutes ?? '-').join('/')} | ${none}`);
    }
}
