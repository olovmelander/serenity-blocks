// The historical human-pace panel from the level-design audit, with today's shipped rivals.
import { appendFileSync, writeFileSync } from 'node:fs';
import { runAttempt } from '../../scripts/odyssey-benchmark/runtime.mjs';

const [levelIds, profile, cadence, output] = process.argv.slice(2);
writeFileSync(output, '', { flag: 'wx' });
console.debug = () => {};
console.log = () => {};
for (const levelId of levelIds.split(',').map(Number)) {
    const seeds = Array.from({ length: 5 }, (_, i) => 15001 + i);
    if (levelId >= 48) seeds.push(...Array.from({ length: 10 }, (_, i) => 17001 + i));
    for (const seed of seeds) {
        const attempt = await runAttempt({ levelId, seed, profile, cadenceId: 'human-' + cadence, wallBudgetMs: 180000 });
        const { outcome, reason, elapsedSeconds } = attempt;
        if (outcome === 'error' || reason === 'wall-budget') throw Error(JSON.stringify({ levelId, seed, outcome, reason }));
        appendFileSync(output, JSON.stringify({ levelId, seed, profile, cadence, outcome, reason, elapsedSeconds }) + '\n');
    }
}
