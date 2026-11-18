// Audit-only alternative. Learn local support arrangements from real training fires,
// then try them as a tie breaker on the existing shortlist at the same work allowance.
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';

const width = 4;
const reverse = Array.from({ length: 16 }, (_, x) => ((x & 1) << 3) | ((x & 2) << 1) | ((x & 4) >> 1) | ((x & 8) >> 3));
function codes(rows) {
    const found = new Set();
    for (let y = Math.max(2, rows.length - 6); y < rows.length; y++) {
        for (let x = 0; x <= 10 - width; x++) {
            const a = (rows[y - 2] >> x) & 15, b = (rows[y - 1] >> x) & 15, c = (rows[y] >> x) & 15;
            if (!a || !b || !c) continue;
            const forward = (a << 8) | (b << 4) | c;
            const mirrored = (reverse[a] << 8) | (reverse[b] << 4) | reverse[c];
            found.add(Math.min(forward, mirrored));
        }
    }
    return found;
}
const scores = new Map();
globalThis.rankLearnedSetup = rows => {
    let best = 0;
    for (const code of codes(rows)) best = Math.max(best, scores.get(code) || 0);
    return best;
};
// Restrict the experimental scoring hook to this Node process. The game loads the production module.
const hook = registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/src/core/ai/gravity-search.js')) return result;
    const original = String(result.source), marker = 'node.quality += reachableTrigger(';
    if (!original.includes(marker)) throw Error('Search shortlist changed');
    return { ...result, source: original.replace(marker,
        'if (config.learnedSetups) node.quality += globalThis.rankLearnedSetup(node.board.rows); ' + marker) };
} });
const { play } = await import('./run.mjs');
hook.deregister();
const observations = [], counts = [new Map(), new Map()], totals = [0, 0];
for (let seed = 77251; seed <= 77290; seed++) {
    const run = await play(seed, 10, 36, { trace: true });
    for (let i = 0; i < run.track.length - 3; i++) {
        if (run.track[i].waves.length) continue;
        const nextFire = run.track.slice(i + 1, i + 4).find(x => x.waves.length);
        const group = Number((nextFire?.waves.length || 0) >= 4);
        const rows = run.track[i].rows.map(row => [...row].reduce((mask, c, x) => mask | (Number(c !== '.') << x), 0));
        totals[group]++;
        for (const code of codes(rows)) counts[group].set(code, (counts[group].get(code) || 0) + 1);
    }
}
const trained = [...counts[1]].filter(([, n]) => n >= 8).map(([code, n]) => ({
    code, positive: n, other: counts[0].get(code) || 0,
    lift: ((n + 1) / (totals[1] + 2)) / (((counts[0].get(code) || 0) + 1) / (totals[0] + 2)),
})).filter(r => r.lift > 1).sort((a, b) => b.lift - a.lift).slice(0, 12);
for (const r of trained) scores.set(r.code, 24 * Math.log(r.lift));
for (let seed = 62001; seed <= 62040; seed++) {
    for (const enabled of [false, true]) observations.push({ enabled, ...await play(seed, 10, 16, { search: { learnedSetups: enabled } }) });
}
writeFileSync(process.argv[2], JSON.stringify({ totals, trained, observations }), { flag: 'wx' });
