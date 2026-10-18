import {
    describe, expect, it, vi,
} from 'vitest';
import { createBoardGrid } from '../board.js';
import { COLS, HIDDEN_ROWS, SHAPES } from '../constants.js';
import { seededRandom } from '../../utils/helpers.js';
import { canPlaceCandidate } from './reachability-pathfinder.js';
import { PuzzleBotController } from './puzzle-bot-controller.js';

function makeState() {
    const boardGrid = createBoardGrid();
    const bottom = boardGrid.length - 1;
    // A ragged stack, so the placements score differently and the noise has something to pick.
    [3, 1, 4, 1, 0, 2, 3, 0, 2, 1].slice(0, COLS).forEach((height, x) => {
        for (let offset = 0; offset < height; offset++) {
            boardGrid[bottom - offset][x] = { color: 'I', id: `stack-${x}-${offset}`, type: 'I' };
        }
    });
    return {
        boardGrid,
        currentPiece: {
            shape: SHAPES.T.map((row) => row.slice()),
            shapeKey: 'T',
            rotation: 0,
            x: 3,
            y: HIDDEN_ROWS - 2,
        },
        isAlive: true,
        nextPieces: ['S', 'L'],
        piecesPlaced: 3,
    };
}

function makeBot(state, planUnitsPerMs = 0) {
    return new PuzzleBotController({
        actions: {},
        difficulty: 6,
        planUnitsPerMs,
        playerIndex: 1,
        playerState: state,
        rng: seededRandom(1234),
    });
}

/** Tick the bot at 60 Hz until it has a plan; returns the game time it adopted one at. */
function runUntilPlanned(bot, onTick = () => {}) {
    for (let tick = 0, nowMs = 0; tick < 400; tick++, nowMs += 16) {
        onTick(tick);
        bot.update(16, nowMs);
        if (bot.lastPlan) return nowMs;
    }
    return null;
}

describe('puzzle bot sliced planning', () => {
    it('chooses exactly what the one-shot planner chooses, across several frames', () => {
        const oneShot = makeBot(makeState());
        const sliced = makeBot(makeState(), 0.25); // 4 placements a 16 ms tick
        let framesMidPlan = 0;

        runUntilPlanned(oneShot);
        runUntilPlanned(sliced, () => { if (sliced.planJob) framesMidPlan += 1; });

        expect(sliced.lastPlan.candidate).toMatchObject({
            rotation: oneShot.lastPlan.candidate.rotation,
            x: oneShot.lastPlan.candidate.x,
            y: oneShot.lastPlan.candidate.y,
        });
        expect(sliced.lastPlan.actions).toEqual(oneShot.lastPlan.actions);
        expect(sliced.readyAtMs).toBe(oneShot.readyAtMs);
        expect(framesMidPlan).toBeGreaterThan(5);
    });

    it('takes the same game time to plan at 60 Hz as at 165 Hz', () => {
        const adoptAt = (frameMs) => {
            const bot = makeBot(makeState(), 0.25);
            for (let nowMs = 0; nowMs < 5000; nowMs += frameMs) {
                bot.update(frameMs, nowMs);
                if (bot.lastPlan) return nowMs;
            }
            return null;
        };
        const at60 = adoptAt(1000 / 60);
        const at165 = adoptAt(1000 / 165);
        expect(at60).not.toBeNull();
        expect(Math.abs(at60 - at165)).toBeLessThan(1000 / 60 + 1e-6);
    });

    it('never acts before its reaction delay is over', () => {
        const sliced = makeBot(makeState(), 12.5); // a whole plan in one tick
        const adoptedAt = runUntilPlanned(sliced);

        expect(sliced.readyAtMs).toBeGreaterThan(0);
        expect(adoptedAt).toBeGreaterThanOrEqual(sliced.readyAtMs);
        expect(adoptedAt).toBeLessThan(sliced.readyAtMs + 16);
    });

    it("keeps a subclass's own planning stages (the benchmark bots override them)", () => {
        class OwnFuture extends PuzzleBotController {
            evaluateFuture(...args) {
                this.ownFutureCalls = (this.ownFutureCalls || 0) + 1;
                return super.evaluateFuture(...args);
            }
        }
        const bot = new OwnFuture({
            actions: {}, difficulty: 6, playerIndex: 1, playerState: makeState(), rng: seededRandom(1234),
        });
        const plain = makeBot(makeState());
        expect(bot.plan().candidate).toMatchObject({ x: plain.plan().candidate.x });
        expect(bot.ownFutureCalls).toBeGreaterThan(0);
    });

    it('plans again when garbage changes the board mid-plan', () => {
        const state = makeState();
        const sliced = makeBot(state, 0.125); // 2 placements a tick
        const plans = vi.spyOn(sliced, 'planSteps');

        runUntilPlanned(sliced, (tick) => {
            // One update after planning began, a garbage cell lands in column 0.
            if (sliced.planJob && plans.mock.calls.length === 1 && tick > 0) {
                state.boardGrid[state.boardGrid.length - 4][0] = { color: 'G', id: 'garbage', type: 'G' };
            }
        });

        expect(plans).toHaveBeenCalledTimes(2);
        expect(canPlaceCandidate(state.boardGrid, sliced.lastPlan.candidate)).toBe(true);
    });
});
