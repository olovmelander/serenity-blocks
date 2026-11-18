import { appendFileSync, writeFileSync } from 'node:fs';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { applyGarbage } from '../../src/core/game.js';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';
import { reachableTrigger, readGravityBoard } from '../../src/core/ai/gravity-search.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { deal, replay, spawn } from '../bot-ai-audit-2026-11/solo.mjs';

const [mode, first, count, file, tierArg = '10'] = process.argv.slice(2);
const packet = mode === 'dig' ? await captureGarbage() : null;
writeFileSync(file, '', { flag: 'wx' });
for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
    const state = deal(seed);
    const mp = new MultiPlayerState(2), queue = mp.getGarbageQueue(0);
    const Controller = mode === 'dig' ? GravityBotController : PuzzleBotController;
    const bot = new Controller({ playerState: state, difficulty: Number(tierArg), actions: {},
        pendingRows: () => queue.getTotalLines(), rng: seededRandom((seed ^ 0x85ebca6b) >>> 0) });
    const result = { seed, probes: [], initial: 0, half: null, all: null, seen: null };
    const rubble = () => state.boardGrid.flat().filter(c => c?.type === 'GARBAGE' || c?.type === 'CLEAN_GARBAGE').length;
    for (let i = 0; i < (packet ? 37 : 16) && !state.isGameOver; i++) {
        if (i === 12 && packet) { queue.enqueue(packet); result.seen = bot.getPendingGarbage(); }
        if (!packet) {
            const keys = [state.currentPiece.shapeKey, ...state.nextPieces.slice(0, 3)];
            const strength = reachableTrigger(readGravityBoard(state.boardGrid), keys, {
                triggerWaves: 1, triggerLines: 0, unseen: 0 }, false);
            result.probes.push(Math.round(Math.sqrt(strength)));
        }
        await replay(state, bot.plan().actions, { spawnPiece: () => {
            if (i === 12 && packet) {
                const entries = [];
                for (let burst = queue.dequeueLineBurst(); burst.length; burst = queue.dequeueLineBurst()) entries.push(...burst);
                if (applyGarbage(state, entries).topOut) { state.isGameOver = true; return; }
                result.initial = rubble();
            }
            spawn(state);
        } });
        if (packet && i > 12 && result.initial) {
            const n = rubble();
            if (result.half == null && n <= result.initial / 2) result.half = i - 12;
            if (result.all == null && !n) result.all = i - 12;
        }
    }
    result.topOut = state.isGameOver;
    state.reset();
    appendFileSync(file, JSON.stringify(result) + '\n');
}
