// The owner's process pool runs bounded, seeded joint perturbations in the background.
// Supply its path to keep private tooling and its historical results outside the game.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { seededRandom } from '../../src/utils/helpers.js';
import { play } from './run.mjs';

if (process.send) {
    process.on('message', async ({ id, task }) => {
        try {
            const row = await play(task.seed, 10, task.limit, { weights: task.weights });
            process.send({ id, result: row });
        } catch (error) { process.send({ id, error: String(error.stack) }); }
    });
} else {
    const [poolPath, output] = process.argv.slice(2);
    const { createPool } = await import(pathToFileURL(resolve(poolPath)));
    const pool = createPool(4, fileURLToPath(import.meta.url), process.env);
    const random = seededRandom(20261118);
    const initial = { balance: 12, density: 0.14, material: 1.5, height: 1.8, danger: 6, holes: 0.65,
        virtualWaves: 65, virtualLines: 5, virtualGap: 8, triggerWaves: 32, triggerLines: 4, unseen: 0.65,
        score: 0.018, attack: 9, waves: 11, garbage: 18, effort: 0.18 };
    const vectors = Array.from({ length: 28 }, (_, i) => Object.fromEntries(Object.entries(initial)
        .map(([term, v]) => [term, i ? +(v * Math.exp((random() - 0.5) * 1.6)).toFixed(4) : v])));
    function utility(rows, mode) {
        const n = rows.reduce((v, r) => v + r.locks, 0);
        const total = rows.reduce((v, r) => v + (mode === 'score' ? r.score : r.attack * 900)
            - 20000 * Number(r.topOut) + 3200 * Number(r.fires.some(f => f[0] <= 16 && f.length >= 5)), 0);
        return total / n;
    }
    async function sample(id, first, count, limit, stage) {
        const rows = await Promise.all(Array.from({ length: count }, (_, i) =>
            pool.run({ seed: first + i, limit, weights: vectors[id] })));
        const result = { id, stage, weights: vectors[id], scoreUtility: utility(rows, 'score'),
            versusUtility: utility(rows, 'versus'), rows };
        appendFileSync(output, JSON.stringify(result) + '\n');
        return result;
    }
    writeFileSync(output, '', { flag: 'wx' });
    try {
        const trained = [];
        for (let i = 0; i < vectors.length; i++) trained.push(await sample(i, 77201, 8, 56, 'training'));
        const finalists = new Set([0]);
        for (const key of ['scoreUtility', 'versusUtility']) {
            trained.sort((a, b) => b[key] - a[key]).slice(0, 4).forEach(r => finalists.add(r.id));
        }
        for (const i of finalists) await sample(i, 78401, 12, 72, 'selection');
    } finally { pool.close(); }
}
