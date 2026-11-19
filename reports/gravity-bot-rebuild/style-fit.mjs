// Play every combination of two local judgment styles on both seats of the
// same deal. Estimate the effect of overlapping skills without fitting the
// specific style draw of a player on a training bag.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seededRandom } from '../../src/utils/helpers.js';

const [poolPath, output, argument, extension, ...prefixFiles] = process.argv.slice(2);
const fraction = Array.from({ length: 21 }, (_, i) => i / 20);
const styleKey = task => [task.seed,task.tier,task.swap,...task.practicedSlots].join('/');
const readRows = file => readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
function fit(rows, shorter = null, fixedRates = null) {
    if (![2176,4480].includes(rows.length)) throw Error('Incomplete judgment training panel');
    const cells = new Map();
    for (const { task, row } of rows) {
        const [low, high] = task.swap ? [...task.practicedSlots].reverse() : task.practicedSlots;
        const key = [task.tier, Number(low), Number(high)].join('/');
        const first = row.rounds[0];
        const wins = [first.ticksPlayed <= 9000 ? first.winner : null, row.winner];
        if (shorter) wins.splice(1, 0, shorter.get(styleKey(task)).winner);
        const sample = cells.get(key) || { n: 0, sums: wins.map(() => 0) };
        wins.forEach((winner, i) => { sample.sums[i] += winner == null ? 0.5 : Number(winner === task.tier + 1); });
        sample.n++;
        cells.set(key, sample);
    }
    const firstOdds = fixedRates ? [fixedRates[0]] : fraction;
    let paths = new Map(firstOdds.map(p => [p, { rates: [p], misses: 0, loss: 0, panel: [] }]));
    for (let tier = 1; tier < 10; tier++) {
        const next = new Map();
        const upperOdds = fixedRates ? [fixedRates[tier]] : (tier === 9 ? [0] : fraction);
        for (const high of upperOdds) for (const [low, previous] of paths) {
            const mean = shorter ? [0, 0, 0] : [0, 0];
            for (const l of [0, 1]) for (const h of (tier === 9 ? [0] : [0, 1])) {
                const cell = cells.get([tier, l, h].join('/'));
                const expected = rows.length === 2176 ? 64 : tier === 9 ? 192 : 128;
                if (cell?.n !== expected) throw Error('Incomplete matched style cell');
                const mass = (l ? low : 1-low) * (h ? high : 1-high);
                for (let i = 0; i < mean.length; i++) mean[i] += mass * cell.sums[i] / cell.n;
            }
            const outside = mean.map(p => Math.max(0, 0.55-p, p-0.70));
            const misses = previous.misses + outside.filter(d => d > 0).length;
            const loss = previous.loss + mean.reduce((sum,p,i) => sum + (p-0.625)**2 + 8*outside[i]**2, 0);
            const best = next.get(high);
            if (!best || misses < best.misses || (misses === best.misses && loss < best.loss)) {
                next.set(high, { rates: [...previous.rates, high], misses, loss, panel: [...previous.panel, mean] });
            }
        }
        paths = next;
    }
    const best = paths.get(0);
    const { nativeApm, safeRoom, checkBeforeDrop } = rows[0].task;
    return { ...best, judgmentOdds: Object.fromEntries(best.rates.map((p, i) => [i + 1, p])),
        steadyExpert: true, nativeApm, safeRoom, checkBeforeDrop };
}
if (poolPath === 'default-seven') {
    const races = readRows(output);
    const shorter = new Map(prefixFiles.flatMap(readRows).map(r => [styleKey(r.task),r.row]));
    if (races.length !== 4480 || shorter.size !== races.length) throw Error('Incomplete default-match training panel');
    for (const {task,row} of races) {
        const prefix = shorter.get(styleKey(task));
        if (task.fragTarget !== 7 || !prefix
            || JSON.stringify(row.rounds.slice(0, prefix.rounds.length)) !== JSON.stringify(prefix.rounds)) {
            throw Error('Changed real rounds in the default-match comparison');
        }
    }
    const committed = JSON.parse(readFileSync(extension,'utf8')).rates;
    const result = { committed: fit(races, shorter, committed), optimumOnTraining: fit(races, shorter) };
    writeFileSync(argument, JSON.stringify(result, null, 2), { flag: 'wx' });
} else if (poolPath === 'select') {
    const files = extension ? [output, extension] : [output];
    const rows = files.flatMap(readRows);
    writeFileSync(argument, JSON.stringify(fit(rows), null, 2), { flag: 'wx' });
} else {
    const hands = argument ? JSON.parse(readFileSync(argument, 'utf8')) : { safeRoom: 10 };
    const spread = hands.checkBeforeDrop ? -1.65 : -1.15;
    const { createPool } = await import(pathToFileURL(resolve(poolPath)));
    const pool = createPool(4, fileURLToPath(new URL('./validation.mjs', import.meta.url)), process.env);
    const done = new Set(existsSync(output) ? readFileSync(output,'utf8').trim().split('\n').filter(Boolean)
        .map(line => styleKey(JSON.parse(line).task)) : []);
    const file = openSync(output, 'a');
    const jobs = [];
    try {
        const balanced = extension === 'balanced';
        const start = balanced ? 86101 : 86001;
        const count = balanced ? 128 : 32;
        for (let offset = 0; offset < count; offset++) for (let tier = 1; tier <= 9; tier++) {
            const seed = start + offset;
            const order = [0,1,2,3];
            if (balanced) {
                // Each group of four fresh bags assigns every style pairing once.
                // Both seats get that assignment; the pairing lottery has its own seed.
                const rng = seededRandom((Math.imul(1 + (offset >> 2),0x9e3779b1) ^ Math.imul(tier,0x27d4eb2d)) >>> 0);
                for (let k = 3; k > 0; k--) {
                    const j = Math.floor(rng() * (k + 1));
                    [order[j],order[k]] = [order[k],order[j]];
                }
            }
            for (const low of [false,true]) for (const high of (tier === 9 ? [false] : [false,true])) {
                const assigned = order[offset % 4];
                if (balanced && (low !== Boolean(assigned & 1) || (tier !== 9 && high !== Boolean(assigned & 2)))) continue;
                for (const swap of [false,true]) {
                    const task = { ...hands, mode: 'frags', tier, seed, swap, limit: 600, tempoSpread: spread,
                        steadyExpert: true, practicedSlots: swap ? [high, low] : [low, high] };
                    if (!done.has(styleKey(task))) jobs.push(pool.run(task).then(row =>
                        appendFileSync(file, JSON.stringify({ task, row }) + '\n')));
                }
            }
        }
        await Promise.all(jobs);
    } finally { pool.close(); closeSync(file); }
}
