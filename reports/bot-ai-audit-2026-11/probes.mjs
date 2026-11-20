// Point-in-time calibration against legal tetromino drops and live flood/score results.
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SHAPES, COLS, HIDDEN_ROWS } from '../../src/core/constants.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { analyzeCascadePreparation } from '../../src/core/ai/board-evaluator.js';
import { estimateLatentDischarge } from '../../src/core/ai/latent-chain.js';
import { reachableLandings } from '../../src/core/stillfall/stillfall-reach.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { applyGarbage } from '../../src/core/game.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { calculateGarbage } from '../../src/core/garbage.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { deal, pose, replay, spawn } from './solo.mjs';

function observer(state, seed, tier = 10) {
    return new PuzzleBotController({ playerIndex: 0, playerState: state, actions: {}, difficulty: tier,
        rng: seededRandom((seed ^ 0x85ebca6b) >>> 0) });
}

function reachableFire(state, key) {
    const shape = SHAPES[key];
    const start = { shape, shapeKey: key, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: HIDDEN_ROWS - 2, rotation: 0 };
    let waves = 0;
    let lines = 0;
    for (const p of reachableLandings(state.boardGrid, start)) {
        const result = resolveCascade([...state.lockedPieces, { ...p, shapeKey: key, pieceId: 'next-trigger' }],
            { level: 1, disableLevelProgression: true });
        waves = Math.max(waves, result.cascadeCount);
        lines = Math.max(lines, result.linesClearedThisTurn);
    }
    return { waves, lines };
}

async function probe(seed) {
    const state = deal(seed);
    const bot = observer(state, seed);
    const rows = [];
    for (let i = 0; i < 16 && !state.isGameOver; i++) {
        const key = state.currentPiece.shapeKey;
        const all = Object.fromEntries(Object.keys(SHAPES).map(k => [k, reachableFire(state, k)]));
        const before = analyzeCascadePreparation(state.boardGrid, state.nextPieces);
        const latent = estimateLatentDischarge(state.boardGrid, before.sideLanes, state.nextPieces);
        const queue = [key, ...state.nextPieces.slice(0, 3)];
        const selected = bot.plan();
        const score = state.score;
        await replay(state, selected.actions, { spawnPiece: () => spawn(state) });
        rows.push({ latent: latent.latentComplexity, claimedLines: latent.latentDepth, current: all[key].waves,
            currentLines: all[key].lines, any: Math.max(...Object.values(all).map(r => r.waves)),
            visible: Math.max(...queue.map(k => all[k].waves)), anyLines: Math.max(...Object.values(all).map(r => r.lines)),
            selected: selected.candidate.cascadeCount, estimatedScore: selected.candidate.evaluation.metrics.projectedScore,
            earnedClearScore: state.score - score - 50 });
    }
    state.reset();
    return { seed, rows };
}

async function breadth(seed, depth, width) {
    const state = deal(seed);
    const bot = observer(state, seed);
    bot.config.lookaheadDepth = depth;
    bot.config.lookaheadBreadth = width;
    let max = 0;
    let attack = 0;
    let simulations = 0;
    for (let i = 0; i < 16 && !state.isGameOver; i++) {
        const steps = bot.planSteps();
        let item = steps.next();
        while (!item.done) { simulations++; item = steps.next(); }
        const waves = [];
        await replay(state, item.value.actions, { spawnPiece: () => spawn(state), onLineClear: n => waves.push(n),
            onGarbageReady: s => { attack += calculateGarbage(s).getTotalLines(); } });
        max = Math.max(max, waves.length);
    }
    const result = { seed, depth, width, max, attack, score: state.score, simulations, topOut: state.isGameOver };
    state.reset();
    return result;
}

export async function captureGarbage() {
    const state = deal(1001);
    const bot = observer(state, 1001);
    const packets = [];
    for (let i = 0; i < 120 && packets.length < 2; i++) {
        await replay(state, bot.plan().actions, {
            spawnPiece: () => spawn(state),
            onGarbageReady: s => {
                const a = calculateGarbage(s).withId('packet-' + packets.length);
                if (a.rows === 3 && !a.cleanRowBonus) packets.push(a.expandEntries());
            },
        });
    }
    state.reset();
    if (packets.length !== 2) throw Error('Missing reference attack');
    return packets.flat();
}

function rubble(state) {
    return state.boardGrid.flat().filter(c => c?.type === 'GARBAGE' || c?.type === 'CLEAN_GARBAGE').length;
}

async function dig(seed, tier, packet) {
    const state = deal(seed);
    const bot = observer(state, seed, tier);
    const mp = new MultiPlayerState(2);
    mp.players[0] = state;
    const queue = mp.getGarbageQueue(0);
    let initialCells = 0;
    let halfAt = null;
    let allAt = null;
    let queued;
    let after = 0;
    let finalCells;
    for (let i = 0; i < 37 && !state.isGameOver; i++) {
        let wired;
        if (i === 12) {
            queue.enqueue(packet);
            // Compare the normal wiring with an empty queue on precisely the same decision state.
            const assessment = () => bot.assessTactics(state.boardGrid, analyzeCascadePreparation(state.boardGrid, state.nextPieces));
            const before = assessment();
            const restored = queue.entries;
            queue.entries = [];
            const empty = assessment();
            queue.entries = restored;
            queued = { incoming: queue.getTotalLines(), seen: bot.getPendingGarbage(), danger: before.danger,
                sameAsEmpty: JSON.stringify(before) === JSON.stringify(empty) };
            if (tier === 10) {
                const other = observer(state, seed, tier);
                other.machinePlan = structuredClone(bot.machinePlan);
                other.getPendingGarbage = () => queue.getTotalLines();
                wired = other.plan();
                queued.wiredDanger = wired.tactics.danger;
            }
        }
        const plan = bot.plan();
        if (wired) queued.wiredMoveChanged = pose(wired.candidate) !== pose(plan.candidate);
        await replay(state, plan.actions, { spawnPiece: () => {
            if (i === 12) {
                const entries = [];
                for (let burst = queue.dequeueLineBurst(); burst.length; burst = queue.dequeueLineBurst()) entries.push(...burst);
                const insertion = applyGarbage(state, entries);
                if (insertion.topOut) { state.isGameOver = true; return; }
                initialCells = rubble(state);
            }
            spawn(state);
        } });
        if (i > 12) {
            after++;
            finalCells = rubble(state);
            if (initialCells > 0 && halfAt === null && finalCells <= initialCells / 2) halfAt = after;
            if (initialCells > 0 && allAt === null && finalCells === 0) allAt = after;
        }
    }
    const result = { seed, tier, queued, initialCells, halfAt, allAt, after, finalCells, topOut: state.isGameOver };
    state.reset();
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [mode, first, count, out, arg1, arg2] = process.argv.slice(2);
    if (!['probe', 'dig', 'breadth'].includes(mode)) throw new RangeError('Unknown probe ' + mode);
    writeFileSync(out, '', { flag: 'wx' });
    const packet = mode === 'dig' ? await captureGarbage() : null;
    for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
        const result = mode === 'probe' ? await probe(seed) : mode === 'dig' ? await dig(seed, Number(arg1), packet)
            : await breadth(seed, Number(arg1), Number(arg2));
        appendFileSync(out, JSON.stringify(result) + '\n');
    }
}
