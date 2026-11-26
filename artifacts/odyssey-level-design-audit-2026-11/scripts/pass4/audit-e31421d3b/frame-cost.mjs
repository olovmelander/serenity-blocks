// Pass 4 prototype: what the rival's planning costs per 60 Hz duel tick, in this process (Node, one thread).
// Usage: node frame-cost.mjs <orb> <seeds e.g. 12001+3> <classic|versus> [odyssey|versus planning] [tier]
// A comparison between plays on one machine, not the packaged game's frame budget.
import { runAttempt } from '../../../../scripts/odyssey-benchmark/runtime.mjs';
import { readMinAttackLines } from '../../../../src/core/garbage.js';
import { VERSUS_WEIGHTS, rowsToBlockSpawn } from '../../../../src/core/ai/versus-evaluation.js';
import { gravityPlanningRate, VERSUS_ROOF_PLANNING } from '../../../../src/core/ai/gravity-bot-controller.js';

const [orb, seeds, play, planning = 'versus', tier] = process.argv.slice(2);
const [start, count] = seeds.split('+').map(Number);
const log = console.log;
console.log = () => {};
console.debug = () => {};
const samples = [];
for (let seed = start; seed < start + count; seed++) {
    await runAttempt({
        levelId: Number(orb),
        seed,
        profile: 'stacker',
        cadenceId: 'human-regular',
        liveRival: true,
        rivalTier: tier ? Number(tier) : undefined,
        wallBudgetMs: 3600000,
        maxSimSeconds: 600,
        maxPieces: 3000,
        configureRival: (duel) => {
            const { bot } = duel;
            if (play === 'versus') {
                bot.versusWeights = VERSUS_WEIGHTS;
                bot.versusOutlook = () => ({
                    minAttackLines: readMinAttackLines(duel.multiplayer.matchConfig?.minAttackLines),
                    worth: 1,
                    flat: false,
                    killRows: rowsToBlockSpawn(duel.players[0].boardGrid, duel.multiplayer.getGarbageQueue(0).getTotalLines()),
                });
                if (planning === 'versus') {
                    bot.planUnitsPerMs = gravityPlanningRate(2, bot.config.tier, true);
                    bot.roofPlanningRate = VERSUS_ROOF_PLANNING;
                }
            }
            const update = bot.update.bind(bot);
            bot.update = (delta, time) => {
                const before = process.hrtime.bigint();
                update(delta, time);
                samples.push(Number(process.hrtime.bigint() - before) / 1e6);
            };
        },
    });
}
samples.sort((a, b) => a - b);
const at = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
log(JSON.stringify({
    orb: Number(orb), play, planning: play === 'versus' ? planning : 'odyssey', tier: tier ? Number(tier) : 'authored',
    ticks: samples.length, meanMs: +mean.toFixed(4), p95: +at(0.95).toFixed(3), p99: +at(0.99).toFixed(3),
    max: +samples[samples.length - 1].toFixed(3),
}));
