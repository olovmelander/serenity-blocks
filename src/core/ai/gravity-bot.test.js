import { describe, expect, it } from 'vitest';
import { COLS, HIDDEN_ROWS } from '../constants.js';
import { resolveCascade } from '../cascade-resolver.js';
import { calculateGarbage } from '../garbage.js';
import { findConnectedComponents } from '../cascade-helpers.js';
import { settleLabelledBoard } from '../stillfall/stillfall-cascade.js';
import { seededRandom } from '../../utils/helpers.js';
import { GravityBotController, gravityPlanningRate } from './gravity-bot-controller.js';
import { findReachablePlacements } from './reachability-pathfinder.js';
import { gravityBoardKey, gravityReward, readGravityBoard } from './gravity-search.js';
import { deal, replay, spawn } from '../../../reports/bot-ai-audit-2026-11/solo.mjs';

function controller(state, rows = () => 0) {
    return new GravityBotController({
        playerState: state, difficulty: 10, actions: {}, rng: seededRandom(71), pendingRows: rows,
    });
}

describe('live gravity policy', () => {
    it('replays the predicted waves, gross attack and per-wave score through the controls', async () => {
        const state = deal(1003);
        const bot = controller(state);
        const actual = [];
        for (let i = 0; i < 16; i++) {
            const before = state.score;
            const plan = bot.plan();
            const waves = [];
            let sent = 0;
            // Each observed spawn depends on the previous live lock and its physics.
            // eslint-disable-next-line no-await-in-loop
            await replay(state, plan.actions, {
                spawnPiece: () => spawn(state),
                onLineClear: (n) => waves.push(n),
                onGarbageReady: (s) => { sent += calculateGarbage(s).getTotalLines(); },
            });
            expect(plan.candidate.waves).toEqual(waves);
            expect(plan.candidate.projectedAttack).toBe(sent);
            expect(plan.candidate.score).toBe(state.score - before - 50);
            actual.push(waves.length);
        }
        expect(Math.max(...actual)).toBeGreaterThanOrEqual(2);
        state.reset();
    });

    it('has identical decisions under a permutation of the hidden bag tail', () => {
        const a = deal(1011);
        const b = deal(1011);
        b.nextPieces.splice(3, Infinity, ...b.nextPieces.slice(3).reverse());
        const first = controller(a).plan();
        const second = controller(b).plan();
        expect(first.actions).toEqual(second.actions);
        expect(first.candidate.futurePlan).toEqual(second.candidate.futurePlan);
        expect(controller(a).nextShapeKeys({ nextPieces: ['I', null, 'T', 'O'] })).toEqual(['I', 'T']);
        a.reset(); b.reset();
    });

    it('selects the same public route when its search is sliced across ticks', () => {
        const a = deal(1013);
        const b = deal(1013);
        const whole = controller(a).plan();
        const sliced = controller(b);
        for (let tick = 1; tick <= 90 && !sliced.lastPlan; tick++) sliced.update(1000 / 60, tick * (1000 / 60));
        expect(sliced.lastPlan.actions).toEqual(whole.actions);
        expect(sliced.lastPlan.candidate.futurePlan).toEqual(whole.candidate.futurePlan);
        a.reset();
        b.reset();
    });

    it.each([1, 2, 3, 5, 6, 10])('preserves tier %i judgment draws with synchronous and sliced input', (tier) => {
        const states = [deal(1011), deal(1011)];
        const decisions = states.map((state, index) => {
            const bot = new GravityBotController({
                playerState: state,
                difficulty: tier,
                actions: {},
                rng: seededRandom(71),
                planUnitsPerMs: index ? gravityPlanningRate() : 0,
            });
            const tick = 1000 / 60;
            for (let n = 1; n <= 120 && !bot.lastPlan; n++) bot.update(tick, n * tick);
            expect(bot.lastPlan).toBeTruthy();
            return [bot.lastPlan.actions, bot.lastPlan.candidate.futurePlan, bot.readyAtMs];
        });
        states.forEach((state) => state.reset());
        expect(decisions[0]).toEqual(decisions[1]);
    });

    it('invalidates a proved route as soon as a real incoming burst changes', () => {
        const state = deal(1001);
        let pending = 0;
        const bot = controller(state, () => pending);
        bot.update(1, 1);
        bot.proof = [{ before: 'old', move: { shapeKey: 'I' } }];
        pending = 6;
        bot.update(1, 2);
        expect(bot.proof).toEqual([]);
        expect(bot.getPendingGarbage()).toBe(6);
        state.reset();
    });

    it('pays a proved fire before the incoming rows enter at the next spawn', async () => {
        const state = deal(1011);
        let incoming = 0;
        const bot = new GravityBotController({
            playerState: state,
            actions: {},
            difficulty: 10,
            rng: seededRandom((1011 ^ 0x85ebca6b) >>> 0),
            pendingRows: () => incoming,
        });
        for (let i = 0; i < 12; i++) {
            // eslint-disable-next-line no-await-in-loop
            await replay(state, bot.plan().actions, { spawnPiece: () => spawn(state) });
        }
        expect(bot.proof[0].move.waves).toEqual([1, 1, 1, 1]);
        incoming = 6;
        const shot = bot.plan();
        expect(shot.tactics.fireBeforeGarbage).toBe(true);
        const actual = [];
        await replay(state, shot.actions, { spawnPiece: () => spawn(state), onLineClear: (n) => actual.push(n) });
        expect(actual).toEqual([1, 1, 1, 1]);
        expect(bot.proof).toEqual([]);
        state.reset();
    });

    it('revalidates a restored grid even if its version number is reused', () => {
        const state = deal(1006);
        state.useFixedCascade = true;
        state.boardVersion = 7;
        const bot = controller(state);
        const tick = 1000 / 60;
        for (let i = 1; i <= 60 && !bot.lastPlan; i++) bot.update(tick, i * tick);
        expect(bot.refreshRoute(bot.lastPlan)).toBe(true);
        state.boardGrid = state.boardGrid.map((row) => row.slice());
        state.boardGrid.at(-1)[2] = { id: 7, type: 'T' };
        expect(bot.refreshRoute(bot.lastPlan)).toBe(false);
        state.reset();
    });

    it('keeps garbage and body connectivity in the key and the compact gravity resolver', () => {
        const state = deal(42);
        const grid = state.boardGrid;
        const last = grid.length - 1;
        for (let x = 0; x < COLS; x++) grid[last][x] = { id: 'row', type: 'GARBAGE' };
        grid[last - 2][0] = { id: 'left', type: 'T' };
        grid[last - 2][1] = { id: 'left', type: 'T' };
        const before = readGravityBoard(grid);
        const key = gravityBoardKey(before.cells);
        grid[last - 2][1] = { id: 'other', type: 'T' };
        expect(gravityBoardKey(readGravityBoard(grid).cells)).not.toBe(key);
        const board = readGravityBoard(grid);
        const ref = resolveCascade(findConnectedComponents(grid), { disableLevelProgression: true });
        const allRows = board.cells.slice();
        const waves = settleLabelledBoard(board.cells, HIDDEN_ROWS, board.top);
        expect(waves).toEqual(settleLabelledBoard(allRows, HIDDEN_ROWS));
        expect(board.cells).toEqual(allRows);
        expect(waves).toEqual(ref.waves.map((w) => w.fullLines.length));
        expect(gravityBoardKey(board.cells)).toBe(gravityBoardKey(readGravityBoard(ref.boardAfter).cells));
        expect(gravityReward([1, 2, 1], false, { level: 1, disableLevelProgression: true }).attack).toBe(3);
        state.reset();
    });

    it('shares a bounded aggregate amount of planning among local slots', () => {
        expect(gravityPlanningRate(4) * 4).toBeLessThanOrEqual(gravityPlanningRate(1));
        expect(gravityPlanningRate(3) * 3).toBeCloseTo(gravityPlanningRate(4) * 4);
    });

    it('copies identical search work between seats without advancing either decision tick', () => {
        const cache = new Map();
        const states = Array.from({ length: 4 }, () => deal(1006));
        const make = (state, shared) => new GravityBotController({
            playerState: state,
            difficulty: 10,
            actions: {},
            rng: seededRandom(71),
            sharedSearch: shared,
            planUnitsPerMs: gravityPlanningRate(3),
        });
        const original = make(states[0], cache).planSteps();
        original.next();
        // The first seat leaves after its first batch. A second identical seat can
        // finish its job from the captured pieces and original scoring context.
        states[0].level = 12;
        states[0].nextPieces.splice(0, 3, 'O', 'O', 'O');
        original.return();
        const second = make(states[1], cache).planSteps();
        const separate = make(states[2], null).planSteps();
        let expected;
        do {
            expected = separate.next();
            expect(second.next()).toEqual(expected);
        } while (!expected.done);
        expect(cache.size).toBe(1);
        const hit = make(states[1], cache).planSteps();
        const uncached = make(states[2], null).planSteps();
        do {
            expected = uncached.next();
            expect(hit.next()).toEqual(expected);
        } while (!expected.done);
        states[3].level = 3;
        make(states[3], cache).plan();
        expect(cache.size).toBe(2);
        const bottom = states[3].boardGrid.at(-1);
        bottom[0] = { id: 7, type: 'I' };
        bottom[1] = { id: 7, type: 'I' };
        make(states[3], cache).plan();
        bottom[1] = { id: 8, type: 'I' };
        make(states[3], cache).plan();
        expect(cache.size).toBe(4);
        states.forEach((state) => state.reset());
    });

    it('has a legal escape before the reaction deadline on a clean, high stack', async () => {
        const state = deal(1006);
        for (let y = HIDDEN_ROWS + 2; y < state.boardGrid.length; y++) {
            state.boardGrid[y][1] = { id: 'left', type: 'I' };
        }
        state.lockedPieces = findConnectedComponents(state.boardGrid);
        const immediate = new GravityBotController({
            playerState: state, difficulty: 10, actions: {}, rng: seededRandom(71), planUnitsPerMs: 0,
        }).plan();
        const bot = controller(state);
        const tick = 1000 / 60;
        let elapsed = 0;
        while (!bot.lastPlan && elapsed < 400) {
            elapsed += tick;
            bot.update(tick, elapsed);
        }
        expect(elapsed).toBeLessThanOrEqual(bot.readyAtMs + tick);
        expect(bot.lastPlan.tactics.protectSpawn).toBe(true);
        const plan = bot.lastPlan;
        expect(plan.actions).toEqual(immediate.actions);
        expect(immediate.tactics.protectSpawn).toBe(true);
        const waves = [];
        await replay(state, plan.actions, { spawnPiece: () => spawn(state), onLineClear: (n) => waves.push(n) });
        expect(waves).toEqual(plan.candidate.waves);
        expect(state.isGameOver).toBe(false);
        state.reset();
    });

    it('preserves reachable poses and input paths on an expanded Infinity well', () => {
        const state = deal(1006);
        state.isInfinityMode = true;
        state.boardGrid = Array.from({ length: 112 }, () => Array(COLS).fill(null));
        state.currentPiece.y = 89;
        for (let y = 104; y < 112; y++) state.boardGrid[y][2] = { id: 7, type: 'I' };
        const poses = (list) => list.map(({
            x, y, rotation, actions,
        }) => [x, y, rotation, actions]);
        expect(poses(controller(state).reachablePlacements(state))).toEqual(poses(findReachablePlacements(state)));
        state.reset();
    });
});
