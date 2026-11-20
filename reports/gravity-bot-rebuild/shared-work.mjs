// Compare aggregate expert decisions, resulting wells and CPU in a real local round.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import { gravityBoardKey, readGravityBoard } from '../../src/core/ai/gravity-search.js';

const [output] = process.argv.slice(2);
const rows = [];
console.log = () => {};
console.debug = () => {};
for (const count of [3, 4]) for (let seed = 83101; seed <= 83108; seed++) {
    let expected;
    for (let pass = 0; pass < 2; pass++) for (const shared of pass % 2 ? [true, false] : [false, true]) {
        const before = process.cpuUsage();
        const digest = createHash('sha256');
        const reads = { total: 0, reused: 0, overlapping: 0 };
        class ObservedCache extends Map {
            get(key) {
                const entry = super.get(key);
                reads.total++;
                if (entry) { reads.reused++; if (entry.job) reads.overlapping++; }
                return entry;
            }
        }
        const cache = new ObservedCache();
        let plannerTime = 0;
        const game = await duel(9, seed, false, 180, {
            tiers: Array(count).fill(10), fixed: true, live: true,
            configure(bot) {
                bot.sharedSearch = shared ? cache : null;
                const plan = bot.stepSlicedPlan.bind(bot);
                bot.stepSlicedPlan = (...args) => {
                    const start = performance.now();
                    try { return plan(...args); } finally { plannerTime += performance.now() - start; }
                };
                const adopt = bot.adoptPlan.bind(bot);
                bot.adoptPlan = decision => {
                    const state = bot.playerState;
                    digest.update(JSON.stringify([bot.playerIndex, state.simFrame, state.score, state.piecesPlaced,
                        bot.getPendingGarbage(), gravityBoardKey(readGravityBoard(state.boardGrid).cells), decision]));
                    return adopt(decision);
                };
            },
        });
        digest.update(JSON.stringify(game));
        const hash = digest.digest('hex');
        if (expected !== undefined && expected !== hash) throw Error('Changed round on ' + seed + '/' + count);
        expected = hash;
        const cost = process.cpuUsage(before);
        rows.push({ count, seed, shared, pass, ticks: game.ticksPlayed, hash, reads, plannerTime,
            cpu: (cost.user + cost.system) / 1000 });
    }
}
writeFileSync(output, JSON.stringify(rows), { flag: 'wx' });
