// Pass 4 prototype: player wins per pace, a target run beside candidate runs, on the same seeds.
// Usage: node compare.mjs <target.jsonl> <label=candidate.jsonl>...
import { readFileSync } from 'node:fs';

const NAMES = { 5: 'Cinder', 10: 'Coral', 18: 'Willow', 26: 'Frost', 34: 'Zephyr', 48: 'Nova', 56: 'Prism', 60: 'Neon' };
const PACES = ['human-casual', 'human-regular', 'human-strong'];
const read = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const [targetFile, ...rest] = process.argv.slice(2);
const target = read(targetFile);
const median = (values) => {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : NaN;
};

function cells(rows, orb) {
    return PACES.map((pace) => {
        const rs = rows.filter((r) => r.orb === orb && r.cadence === pace);
        return { n: rs.length, wins: rs.filter((r) => r.outcome === 'win').length, minutes: median(rs.map((r) => r.seconds / 60)) };
    });
}

/** Matches both runs played: the same orb, seed, policy and pace. */
function paired(a, b, orb) {
    const key = (r) => [r.seed, r.profile, r.cadence].join('/');
    const mine = new Map(b.filter((r) => r.orb === orb).map((r) => [key(r), r]));
    return a.filter((r) => r.orb === orb && mine.has(key(r))).map((r) => [r, mine.get(key(r))]);
}

const orbs = [...new Set(target.map((r) => r.orb))].sort((a, b) => a - b);
for (const orb of orbs) {
    const t = cells(target, orb);
    console.log(`\n${orb} ${NAMES[orb]}: target wins casual/regular/strong ${t.map((c) => `${c.wins}/${c.n}`).join('  ')}   minutes ${t.map((c) => c.minutes.toFixed(1)).join(' ')}`);
    for (const arg of rest) {
        const [label, file] = arg.split('=');
        const rows = read(file).filter((r) => r.orb === orb);
        if (!rows.length) continue;
        const pairs = paired(target, rows, orb);
        const per = PACES.map((pace) => {
            const ps = pairs.filter(([a]) => a.cadence === pace);
            const tw = ps.filter(([a]) => a.outcome === 'win').length;
            const cw = ps.filter(([, b]) => b.outcome === 'win').length;
            return { n: ps.length, tw, cw, minutes: median(ps.map(([, b]) => b.seconds / 60)) };
        });
        const distance = per.reduce((s, p) => s + (p.n ? Math.abs(p.cw - p.tw) / p.n : 0), 0);
        console.log(`   ${label.padEnd(22)} ${per.map((p) => `${String(p.cw).padStart(2)}/${p.n} (${p.cw - p.tw >= 0 ? '+' : ''}${p.cw - p.tw})`).join('  ')}   minutes ${per.map((p) => (Number.isFinite(p.minutes) ? p.minutes.toFixed(1) : '-')).join(' ')}   off ${(100 * distance / 3).toFixed(1)} pts`);
    }
}
