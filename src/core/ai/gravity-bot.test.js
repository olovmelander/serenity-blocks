import { describe, expect, it } from 'vitest';
import { COLS, HIDDEN_ROWS } from '../constants.js';
import { resolveCascade } from '../cascade-resolver.js';
import { calculateGarbage } from '../garbage.js';
import { findConnectedComponents } from '../cascade-helpers.js';
import { settleLabelledBoard } from '../stillfall/stillfall-cascade.js';
import { seededRandom } from '../../utils/helpers.js';
import { GravityBotController, gravityPlanningRate } from './gravity-bot-controller.js';
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
        expect(settleLabelledBoard(board.cells, HIDDEN_ROWS)).toEqual(ref.waves.map((w) => w.fullLines.length));
        expect(gravityBoardKey(board.cells)).toBe(gravityBoardKey(readGravityBoard(ref.boardAfter).cells));
        expect(gravityReward([1, 2, 1], false, { level: 1, disableLevelProgression: true }).attack).toBe(3);
        state.reset();
    });

    it('shares a bounded aggregate amount of planning among local slots', () => {
        expect(gravityPlanningRate(4) * 4).toBeLessThanOrEqual(gravityPlanningRate(1));
        expect(gravityPlanningRate(3) * 3).toBeCloseTo(gravityPlanningRate(4) * 4);
    });
});
