import { appendFileSync, writeFileSync } from 'node:fs';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { applyGarbage } from '../../src/core/game.js';
import { calculateGarbage } from '../../src/core/garbage.js';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';
import { reachableTrigger, readGravityBoard } from '../../src/core/ai/gravity-search.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { deal, replay, spawn } from '../bot-ai-audit-2026-11/solo.mjs';
import { recordedSeat } from './recorded-seat.mjs';

const [mode, first, count, file, tierArg = '10'] = process.argv.slice(2);
const scheduled = ['scheduledDig', 'scheduledBlind', 'scheduledControl'].includes(mode);
const packet = (scheduled || mode === 'dig' || mode === 'digBlind') ? await captureGarbage() : null;

function scheduledDig(seed) {
    let locks = 0, checked = 0, delivered = false;
    const record = { seed, initial: 0, half: null, all: null, seen: null, postAttack: 0, sent: 0 };
    const seat = recordedSeat(Number(tierArg), seed, () => { locks++; }, {
        control: mode === 'scheduledControl',
        onGarbageReady: summary => {
            const rows = calculateGarbage(summary).getTotalLines();
            record.sent += rows;
            if (delivered) record.postAttack += rows;
        },
    });
    const { state, bot, queue } = seat;
    if (mode === 'scheduledBlind') bot.pendingRows = () => 0;
    const adopt = bot.adoptPlan.bind(bot);
    bot.adoptPlan = plan => {
        if (delivered && locks === 12) {
            record.seen = bot.getPendingGarbage();
            record.onQueue = { x: plan.candidate.x, rotation: plan.candidate.rotation, waves: plan.candidate.cascadeCount };
        }
        return adopt(plan);
    };
    try {
        for (let tick = 0; tick < 18000 && !state.isGameOver; tick++) {
            if (locks === 12 && !state.isProcessingPhysics && !delivered) { queue.enqueue(packet); delivered = true; }
            seat.step();
            if (state.isProcessingPhysics || checked === locks) continue;
            checked = locks;
            const rubble = state.boardGrid.flat().filter(c => c?.type === 'GARBAGE' || c?.type === 'CLEAN_GARBAGE').length;
            if (locks === 13) record.initial = rubble;
            if (locks > 13 && record.initial) {
                if (record.half === null && rubble <= record.initial / 2) record.half = locks - 13;
                if (record.all === null && rubble === 0) record.all = locks - 13;
            }
            if (locks === 37) break;
        }
        if (!state.isGameOver && checked !== 37) throw Error('Incomplete scheduled dig ' + seed);
        return { ...record, topOut: state.isGameOver, locks };
    } finally { seat.close(); }
}

writeFileSync(file, '', { flag: 'wx' });
for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
    if (scheduled) {
        appendFileSync(file, JSON.stringify(scheduledDig(seed)) + '\n');
        continue;
    }
    const state = deal(seed);
    const mp = new MultiPlayerState(2), queue = mp.getGarbageQueue(0);
    const Controller = packet ? GravityBotController : PuzzleBotController;
    const bot = new Controller({ playerState: state, difficulty: Number(tierArg), actions: {},
        pendingRows: () => mode === 'digBlind' ? 0 : queue.getTotalLines(), rng: seededRandom((seed ^ 0x85ebca6b) >>> 0) });
    const result = { seed, probes: [], initial: 0, half: null, all: null, seen: null, sent: 0, postAttack: 0 };
    const rubble = () => state.boardGrid.flat().filter(c => c?.type === 'GARBAGE' || c?.type === 'CLEAN_GARBAGE').length;
    for (let i = 0; i < (packet ? 37 : 16) && !state.isGameOver; i++) {
        if (i === 12 && packet) { queue.enqueue(packet); result.seen = bot.getPendingGarbage(); }
        if (!packet) {
            const keys = [state.currentPiece.shapeKey, ...state.nextPieces.slice(0, 3)];
            const strength = reachableTrigger(readGravityBoard(state.boardGrid), keys, {
                triggerWaves: 1, triggerLines: 0, unseen: 0 }, false);
            result.probes.push(Math.round(Math.sqrt(strength)));
        }
        const choice = bot.plan();
        if (packet && i === 12) {
            const { x, y, rotation, waves } = choice.candidate;
            result.onQueue = { x, y, rotation, waves };
        }
        await replay(state, choice.actions, { onGarbageReady: summary => {
            const credit = calculateGarbage(summary).getTotalLines();
            result.sent += credit;
            if (i >= 12) result.postAttack += credit;
        }, spawnPiece: () => {
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
