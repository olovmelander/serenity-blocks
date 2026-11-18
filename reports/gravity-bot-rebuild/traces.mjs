// Run each render cadence in a different process, with one captured six-row packet.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { calculateGarbage } from '../../src/core/garbage.js';
import { gravityBoardKey, readGravityBoard } from '../../src/core/ai/gravity-search.js';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { recordedSeat } from './recorded-seat.mjs';

const [out, hz] = process.argv.slice(2);
if (!hz) {
    const runs = [60,165].map(rate => {
        const dest = out + '.' + rate + '.json';
        execFileSync(process.execPath, [fileURLToPath(import.meta.url), dest, String(rate)]);
        return JSON.parse(readFileSync(dest, 'utf8'));
    });
    if (JSON.stringify(runs[0]) !== JSON.stringify(runs[1])) throw Error('Cold-process decision or outcome mismatch');
    writeFileSync(out, JSON.stringify(runs[0]), { flag: 'wx' });
} else {
    console.log = () => {}; console.debug = () => {};
    const packet = await captureGarbage(), rows = [];
    for (const tier of [1,4,7,10]) for (const seed of [1006,1022,92104]) {
        const events = [];
        const seat = recordedSeat(tier, seed, null, {
            onLineClear: (n, _c, _m, _r, wave) => events.push(['wave',seat.state.simFrame,wave,n]),
            onGarbageReady: summary => events.push(['out',seat.state.simFrame,calculateGarbage(summary).getTotalLines()]),
        });
        const { state, bot } = seat;
        const adopt = bot.adoptPlan.bind(bot);
        bot.adoptPlan = plan => {
            events.push(['decision',state.simFrame,plan.candidate.shapeKey,plan.candidate.x,plan.candidate.rotation,plan.actions]);
            return adopt(plan);
        };
        const quantum = 1000 / 60;
        let credit = 0, render = 0;
        while (!state.isGameOver && state.simFrame < 3600) {
            credit += render++ === 350 ? 50 : 1000 / Number(hz);
            while (credit + 1e-7 >= quantum && !state.isGameOver && state.simFrame < 3600) {
                credit = Math.max(0, credit - quantum);
                if (state.simFrame === 850) seat.queue.enqueue(packet);
                const result = seat.step();
                for (const e of result.input) events.push(['input',result.tick,e.command.action,e.command.value,e.disposition]);
                if (result.tick % 300 === 0) events.push(['board',result.tick,state.score,state.piecesPlaced,
                    gravityBoardKey(readGravityBoard(state.boardGrid).cells),seat.queue.getTotalLines()]);
            }
        }
        rows.push({ tier, seed, locks: state.piecesPlaced, gameOver: state.isGameOver, score: state.score,
            digests: Object.fromEntries(['decision','input','wave','out','board'].map(kind => {
                const sequence = events.filter(row => row[0] === kind);
                return [kind, { count: sequence.length, sha256: createHash('sha256').update(JSON.stringify(sequence)).digest('hex') }];
            })) });
        seat.close();
    }
    writeFileSync(out, JSON.stringify(rows), { flag: 'wx' });
}
