// Count actual prior forecasts at local input speed. Preserve an unchosen
// ordinary placement only when the sampled mistake reached its real lock.
import { appendFileSync, writeFileSync } from 'node:fs';
import { simulatePlacement } from '../../src/core/ai/cascade-simulator.js';
import { gravityLandings } from '../../src/core/ai/gravity-search.js';
import { canMatchWaves, pose } from '../bot-ai-audit-2026-11/solo.mjs';
import { liveOpening } from './live-openings.mjs';

const [out, policy, first = '1001', count = '8', limit = '120'] = process.argv.slice(2);
writeFileSync(out, '', { flag: 'wx' });
for (let tier = 1; tier <= 10; tier++) for (let i = 0; i < Number(count); i++) {
    const seed = Number(first) + i;
    const spawnPose = new Map(), alternative = new Map();
    function observe(bot) {
        const state = bot.playerState;
        let sampled = null;
        const update = bot.update.bind(bot);
        bot.update = (...args) => {
            const lock = state.piecesPlaced + 1, piece = state.currentPiece;
            if (piece && !state.isProcessingPhysics && !spawnPose.has(lock)) {
                spawnPose.set(lock, { ...piece, shape: piece.shape.map(row => [...row]) });
            }
            return update(...args);
        };
        const select = bot.chooseSelection.bind(bot);
        bot.chooseSelection = (ranked, ...args) => {
            const choice = select(ranked, ...args);
            const best = ranked[0];
            sampled = ranked.indexOf(choice) > 0 && !choice.totalLines && !best.totalLines
                ? { lock: state.piecesPlaced + 1, pose: pose(choice), board: best.boardGrid } : null;
            return choice;
        };
        if (bot.chooseGravityMove) {
            const choose = bot.chooseGravityMove.bind(bot);
            bot.chooseGravityMove = (best, alternatives) => {
                const choice = choose(best, alternatives);
                sampled = null;
                if (choice !== best && !choice.lines && !best.lines) {
                    const piece = spawnPose.get(state.piecesPlaced + 1);
                    const landing = gravityLandings(state.boardGrid, piece).find(p =>
                        p.x === best.x && p.y === best.y && p.rotation === best.rotation);
                    if (!landing) throw Error('Unreachable unchosen lock on ' + seed);
                    const result = simulatePlacement(state, { ...landing, shapeKey: best.shapeKey,
                        type: best.shapeKey, simulationId: 'unselected-' + state.piecesPlaced });
                    sampled = { lock: state.piecesPlaced + 1, pose: pose(choice), board: result.boardGrid };
                }
                return choice;
            };
        }
        const adopt = bot.adoptPlan.bind(bot);
        bot.adoptPlan = plan => {
            const lock = state.piecesPlaced + 1;
            if (sampled?.lock === lock && plan?.candidate && sampled.pose === pose(plan.candidate)) alternative.set(lock, sampled);
            else alternative.delete(lock);
            sampled = null;
            return adopt(plan);
        };
    }
    const { track, topOut, score, attack, rejected } = liveOpening(seed, Number(limit), 'proof', policy === 'control', tier, observe);
    let forecast = 0, mistakeEnabled = 0, opportunity = 0;
    let pending = [];
    for (const [index, lock] of track.entries()) {
        const actual = pose({ ...lock, shapeKey: lock.shape });
        pending = pending.filter(route => route.steps.shift() === actual);
        if (lock.waves.length >= 2) {
            if (pending.some(route => !route.steps.length && route.rows.join() === lock.waves.join())) forecast++;
            else {
                const previous = track[index - 1], slip = alternative.get(lock.lock - 1);
                if (previous && !previous.waves.length && slip && slip.pose === pose({ ...previous, shapeKey: previous.shape })
                    && !canMatchWaves(slip.board, spawnPose.get(lock.lock), lock.waves.length)) mistakeEnabled++;
                else opportunity++;
            }
        }
        pending = pending.filter(route => route.steps.length);
        if (!lock.waves.length) {
            const steps = [];
            for (const prediction of lock.expected) {
                steps.push(prediction.pose);
                if (prediction.waves >= 2) {
                    if (prediction.rows) pending.push({ steps, rows: prediction.rows });
                    break;
                }
            }
        }
    }
    appendFileSync(out, JSON.stringify({ tier, seed, locks: track.length, topOut, score, attack, rejected,
        forecast, mistakeEnabled, opportunity }) + '\n');
}
