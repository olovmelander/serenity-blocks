import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import { runAttempt } from '../../scripts/odyssey-benchmark/runtime.mjs';

const [mode, ids, first, count, output, configFile] = process.argv.slice(2);
const config = configFile ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
writeFileSync(output, '', { flag: 'wx' });
console.log = () => {}; console.debug = () => {};
for (const id of ids.split(',').map(Number)) {
    for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
        if (mode === 'ladder') {
            for (const swap of [false, true]) {
                const result = await duel(id, seed, swap, 150, { live: true, configure: (bot, tier) => {
                    if (config.pace?.[tier]) {
                        const [apm, min, max] = config.pace[tier];
                        bot.config.reactionMs = [min, max];
                        bot.config.actionIntervalMs = 60000 / apm;
                    }
                } });
                appendFileSync(output, JSON.stringify(result) + '\n');
            }
        } else if (mode === 'rivals') {
            for (const profile of ['stacker', 'cascade']) for (const cadence of ['regular', 'strong']) {
                const { outcome, reason } = await runAttempt({ levelId: id, seed, profile, cadenceId: 'human-' + cadence,
                    liveRival: true, rivalTier: config.rivalTiers?.[id], wallBudgetMs: 240000 });
                if (outcome === 'error' || reason === 'wall-budget') throw Error(JSON.stringify({ id, seed, outcome, reason }));
                appendFileSync(output, JSON.stringify({ id, seed, profile, cadence, outcome, reason }) + '\n');
            }
        } else throw Error('Unknown match panel ' + mode);
    }
}
