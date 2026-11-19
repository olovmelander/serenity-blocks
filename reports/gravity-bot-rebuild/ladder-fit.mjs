// Each adjacent pairing depends only on its two native action rates. Measure the
// edges once so the ten rates can be selected together without replaying whole ladders.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const initialRates = [[115,150], [130,165], [145,180], [190,240], [270,330], [265,320], [310,375],
    [430,530], [570,700], [850]];
// Better judgment can allow a player to act more deliberately than a faster
// neighbour. This trial measures that trade directly at each pair of hand speeds.
const independentRates = [[145,200,265], [115,170,225], [155,205,265], [230,290,360], [230,310,390],
    [255,335,405], [285,350,420], [390,470,550], [540,640,730], [850]];
const [poolPath, output, count = '12', safeRoom = '0', rateFamily = 'ordered'] = process.argv.slice(2);

function choose(records) {
    const independent = records[0].task.rateFamily === 'independent';
    const options = independent ? independentRates : initialRates;
    const edges = new Map();
    for (const { task, row } of records) {
        const { tier } = task;
        const edge = [tier, task.nativeApm[tier], task.nativeApm[tier + 1]].join('/');
        const sample = edges.get(edge) || { games: 0, first: 0, frags: 0 };
        const first = row.rounds[0];
        const points = winner => winner === null ? 0.5 : Number(winner === tier + 1);
        sample.first += first.ticksPlayed > 9000 ? 0.5 : points(first.winner);
        sample.frags += points(row.winner);
        sample.games++;
        edges.set(edge, sample);
    }
    function loss(p) {
        const outside = Math.max(0, 0.55 - p, p - 0.70);
        return (p - 0.625) ** 2 + 8 * outside ** 2;
    }
    // Each successive choice depends only on the preceding action rate. Keep
    // the least costly partial ladder ending at each available rate.
    let chains = new Map(options[0].map(rate => [rate, { rates: [rate], penalty: 0, panel: [] }]));
    for (let tier = 1; tier < options.length; tier++) {
        const next = new Map();
        for (const high of options[tier]) for (const [low, prev] of chains) {
            if (!independent && low > high) continue;
            const sample = edges.get([tier, low, high].join('/'));
            if (!sample || sample.games < 24) throw Error('Incomplete calibration edge');
            const first = sample.first / sample.games, frags = sample.frags / sample.games;
            const penalty = prev.penalty + loss(first) + loss(frags);
            if (!next.has(high) || penalty < next.get(high).penalty) {
                next.set(high, { rates: [...prev.rates, high], penalty,
                    panel: [...prev.panel, { tier, first, frags, games: sample.games }] });
            }
        }
        chains = next;
    }
    const best = chains.get(850);
    return { ...best, nativeApm: Object.fromEntries(best.rates.map((rate, i) => [i + 1, rate])), steadyExpert: true,
        safeRoom: records[0].task.safeRoom || 0 };
}

if (poolPath === 'select') {
    const rows = readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
    writeFileSync(count, JSON.stringify(choose(rows), null, 2), { flag: 'wx' });
    process.exit(0);
}
const { createPool } = await import(pathToFileURL(resolve(poolPath)));
const options = rateFamily === 'independent' ? independentRates : initialRates;
const pool = createPool(4, fileURLToPath(new URL('./validation.mjs', import.meta.url)), process.env);
const key = task => [task.tier, task.seed, task.swap, task.nativeApm[task.tier], task.nativeApm[task.tier + 1]].join('/');
const done = new Set(existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean)
    .map(line => key(JSON.parse(line).task)) : []);
const file = openSync(output, 'a');
try {
    const jobs = [];
    for (let index = 0; index < +count; index++) for (let tier = 1; tier <= 9; tier++) {
        for (const low of options[tier - 1]) for (const high of options[tier]) {
            if (rateFamily !== 'independent' && low > high) continue;
            for (const swap of [false, true]) {
                const task = { mode: 'frags', tier, seed: 86001 + index, swap, limit: 600,
                    nativeApm: { [tier]: low, [tier + 1]: high }, tempoSpread: -1.15, steadyExpert: true,
                    safeRoom: +safeRoom, rateFamily };
                if (!done.has(key(task))) jobs.push(pool.run(task).then(row =>
                    appendFileSync(file, JSON.stringify({ task, row }) + '\n')));
            }
        }
    }
    await Promise.all(jobs);
} finally { pool.close(); closeSync(file); }
