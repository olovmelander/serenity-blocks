import { appendFileSync, writeFileSync } from 'node:fs';
import { runAttempt } from '../../scripts/odyssey-benchmark/runtime.mjs';

const [policy, id, file] = process.argv.slice(2);
writeFileSync(file, '', { flag: 'wx' });
console.log = () => {}; console.debug = () => {};
for (let seed = 85301; seed < 85316; seed++) {
    const { outcome, reason } = await runAttempt({ levelId: +id, seed, profile: 'cascade',
        cadenceId: 'human-regular', gravityGoalPolicy: policy, wallBudgetMs: 240000 });
    if (outcome === 'error' || reason === 'wall-budget') throw Error(JSON.stringify({ policy, id, seed, outcome, reason }));
    appendFileSync(file, JSON.stringify({ policy, id, seed, outcome, reason }) + '\n');
}
