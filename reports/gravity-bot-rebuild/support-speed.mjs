// Native local timing, including a seat's ordinary seeded reading and hand style.
// One bot and one idle human isolate hand speed from incoming attacks.
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, output, first = '21420200', count = '16', seconds = '60'] = process.argv.slice(2);
if (!checkout || !output) throw Error('Pass CHECKOUT OUTPUT.jsonl [FIRST_SEED COUNT GAME_SECONDS]');
const seatModule = pathToFileURL(resolve(checkout, 'reports/gravity-bot-rebuild/recorded-seat.mjs'));
const { betweenTickFrames, recordedSeat } = await import(seatModule);
writeFileSync(output, '', { flag: 'wx' });
console.log = () => {};
console.debug = () => {};
for (const tier of [8, 9, 10]) {
    for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
        const seat = recordedSeat(tier, seed);
        const { scheduler } = seat.bot;
        const perform = scheduler.perform.bind(scheduler);
        let actions = 0, drops = 0, firstActionTick = null, tick = 0;
        const executionTicks = [];
        scheduler.perform = action => {
            const ok = perform(action);
            if (ok) {
                actions++;
                firstActionTick ??= tick;
                if (action.type === 'hardDrop') {
                    drops++;
                    executionTicks.push(tick - firstActionTick);
                    firstActionTick = null;
                }
            }
            return ok;
        };
        try {
            for (; tick < Number(seconds) * 60 && !seat.state.isGameOver; tick++) {
                seat.step();
                betweenTickFrames(165, tick + 1, (ms, step) => seat.precompute(ms, step));
            }
            appendFileSync(output, JSON.stringify({ tier, seed, ticks: tick, actions, drops,
                spawned: seat.state.piecesPlaced, executionTicks }) + '\n');
        } finally { seat.close(); }
    }
}
