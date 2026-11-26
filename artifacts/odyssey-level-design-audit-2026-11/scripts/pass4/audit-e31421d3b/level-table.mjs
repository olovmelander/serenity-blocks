// Pass 4: how a local versus bot of each level, seated in the player's well, fares against each rival.
// Usage: node level-table.mjs "label=file.jsonl" ...   (rows from rival-run.mjs with cells "levels:…")
// Each cell is wins-losses-undecided. A match is undecided when it reaches 30 simulated minutes or 3,000 pieces.
import { readFileSync } from 'node:fs';

const NAMES = { 5: 'Cinder', 10: 'Coral', 18: 'Willow', 26: 'Frost', 34: 'Zephyr', 48: 'Nova', 56: 'Prism', 60: 'Neon' };
const median = (values) => {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
for (const arg of process.argv.slice(2)) {
    const at = arg.indexOf('=');
    const rows = readFileSync(arg.slice(at + 1), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
        .filter((r) => r.profile === 'local');
    const levels = [...new Set(rows.map((r) => Number(r.cadence.split('-')[1])))].sort((a, b) => a - b);
    const orbs = [...new Set(rows.map((r) => r.orb))].sort((a, b) => a - b);
    console.log(`\n== ${arg.slice(0, at)} (${rows.length} matches): wins-losses-undecided by the player's local level ==`);
    console.log(`rival      | ${levels.map((n) => `L${n}`.padStart(8)).join(' ')} | median minutes ${levels.map((n) => `L${n}`).join('/')} | minutes a knockout`);
    for (const orb of orbs) {
        const cells = levels.map((n) => {
            const m = rows.filter((r) => r.orb === orb && r.cadence === `level-${n}`);
            const knockouts = m.reduce((s, r) => s + (r.frags[0] || 0) + (r.frags[1] || 0), 0);
            return {
                wins: m.filter((r) => r.outcome === 'win').length,
                losses: m.filter((r) => r.outcome === 'loss').length,
                undecided: m.filter((r) => r.outcome === 'censored').length,
                minutes: median(m.map((r) => r.seconds / 60)),
                perKnockout: m.reduce((s, r) => s + r.seconds / 60, 0) / Math.max(1, knockouts),
            };
        });
        console.log(`${String(orb).padStart(2)} ${NAMES[orb].padEnd(7)} | ${cells.map((c) => `${c.wins}-${c.losses}-${c.undecided}`.padStart(8)).join(' ')} | ${cells.map((c) => c.minutes.toFixed(0)).join('/')} | ${cells.map((c) => c.perKnockout.toFixed(1)).join('/')}`);
    }
}
