/**
 * Regression gates for the three frame-tail defects diagnosed in
 * docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md.
 *
 * The reported symptom was "laggy stacking and slow cascades at 100+ FPS". None
 * of the three causes were about average frame rate; all three were about what
 * the code does with a *slow* frame:
 *
 *  §1 the FPS readout averaged reciprocals, so it reported ~2x the real rate and
 *     hid the stalls entirely;
 *  §4 the simulation delta was unclamped, so DAS replayed a stall as a burst of
 *     moves and the piece teleported;
 *  §3 the clear/cascade animation spent a whole frame per step, so its duration
 *     scaled with the worst frames instead of the wall clock.
 *
 * These tests pin the fixed behaviour at a *bad* frame rate, which is the only
 * regime where any of it is observable.
 */
import {
    describe, it, expect, vi, afterEach,
} from 'vitest';
import { PerformanceMonitor } from '../../src/utils/performance-monitor.js';
import { updateGame, processAutoDrop } from '../../src/core/game.js';
import { applyGravity, processPhysicsLegacy } from '../../src/core/physics.js';
import { createBoardGrid, rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { ROWS, HIDDEN_ROWS } from '../../src/core/constants.js';

const BOTTOM = ROWS + HIDDEN_ROWS - 1;

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.window;
});

/** Drive a virtual clock that only advances when a frame is served. */
function installFrameClock({ frameMs }) {
    const state = { now: 0, frames: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => state.now);
    globalThis.window = {
        requestAnimationFrame: (cb) => {
            state.frames += 1;
            state.now += frameMs;
            // Async so an await between frames cannot recurse the stack.
            queueMicrotask(() => cb(state.now));
            return state.frames;
        },
    };
    return state;
}

describe('§1 FPS readout reports throughput, not the mean of per-frame rates', () => {
    /** 57 healthy frames + 3 stalls — the bimodal shape from the bug report. */
    function feedBimodalTrace(monitor) {
        let clock = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        monitor.enabled = true;
        monitor.lastFrameTime = 0;
        [...Array(57).fill(8), 100, 100, 100].forEach((dt) => {
            clock += dt;
            monitor.frameStart();
        });
    }

    it('reports 1000 / mean(frameTime) rather than mean(1000 / frameTime)', () => {
        const monitor = new PerformanceMonitor();
        feedBimodalTrace(monitor);

        // mean frame time = (57*8 + 3*100) / 60 = 12.6ms  ->  79.4 fps of throughput
        expect(monitor.metrics.avgFrameTime).toBeCloseTo(12.6, 5);
        expect(monitor.metrics.avgFPS).toBeCloseTo(1000 / 12.6, 5);

        // The old reciprocal mean was (57*125 + 3*10) / 60 = 119.25 fps — nearly
        // 1.5x the truth on this trace, and ~2x on the one from the report.
        expect(monitor.metrics.avgFPS).not.toBeCloseTo(119.25, 1);
        expect(monitor.metrics.avgFPS).toBeLessThan(90);
    });

    it('is internally consistent: the headline rate matches the frame time beside it', () => {
        const monitor = new PerformanceMonitor();
        feedBimodalTrace(monitor);

        // The panel showed "114.0 FPS" directly above "Frame: 17.2ms" (= 58 fps).
        // Those two must now describe the same thing.
        expect(monitor.metrics.avgFPS * monitor.metrics.avgFrameTime).toBeCloseTo(1000, 5);
    });

    it('surfaces the tail as a 1% low instead of a max-of-instantaneous "range"', () => {
        const monitor = new PerformanceMonitor();
        feedBimodalTrace(monitor);

        const lows = monitor.getLowFPS();
        expect(lows.low1Pct).toBeCloseTo(10, 5); // p99 = 100ms stall
        expect(lows.low1Pct).toBeLessThan(monitor.metrics.avgFPS);
    });

    it('does not report a rate before any frame has been sampled', () => {
        const monitor = new PerformanceMonitor();
        expect(monitor.metrics.avgFPS).toBe(0);
        expect(monitor.getLowFPS()).toEqual({ low1Pct: 0, low5Pct: 0 });
    });
});

describe('§4 a stalled frame is not replayed as a burst of input', () => {
    function makeState(overrides = {}) {
        return {
            isGameOver: false,
            isPaused: false,
            lastTime: 0,
            simTimeMs: 0,
            simTickMs: 1000 / 60,
            hitStopRemaining: 0,
            currentPiece: null,
            dropCounter: 0,
            dropInterval: 1000,
            ...overrides,
        };
    }

    it('clamps the delta handed to DAS so a 108ms GPU stall cannot fire catch-up repeats', () => {
        const updateDAS = vi.fn();
        globalThis.window = { inputController: { updateDAS } };

        const gameState = makeState();
        updateGame(108, gameState, {});

        // Raw 108ms at the default 40ms ARR would have moved the piece 3 columns.
        expect(updateDAS).toHaveBeenCalledTimes(1);
        expect(updateDAS.mock.calls[0][0]).toBe(50);
    });

    it('leaves ordinary frames untouched', () => {
        const updateDAS = vi.fn();
        globalThis.window = { inputController: { updateDAS } };

        updateGame(16.7, makeState(), {});

        expect(updateDAS.mock.calls[0][0]).toBeCloseTo(16.7, 5);
    });

    it('clamps gravity accumulation by the same bound', () => {
        globalThis.window = {};
        const gameState = makeState({
            currentPiece: { shape: [[1]], x: 0, y: 0 },
            boardGrid: createBoardGrid(),
            lockedPieces: [],
        });

        updateGame(500, gameState, {});

        // 500ms of owed gravity would have stepped the piece down repeatedly.
        expect(gameState.dropCounter).toBeLessThanOrEqual(50);
    });

    it('still advances the wall-clock sim clock by the real elapsed time', () => {
        globalThis.window = {};
        const gameState = makeState();

        updateGame(108, gameState, {});

        // Only player-visible motion is clamped; the clock itself stays honest.
        expect(gameState.simTimeMs).toBe(108);
        expect(gameState.lastTime).toBe(108);
    });

    it('expires hit-stop on real elapsed time, not the clamped delta', () => {
        globalThis.window = {};
        const gameState = makeState({ hitStopRemaining: 70 });

        updateGame(108, gameState, {});

        expect(gameState.hitStopRemaining).toBe(0);
    });

    it('processAutoDrop itself is unchanged — the clamp lives at the loop boundary', () => {
        const gameState = makeState({
            currentPiece: { shape: [[1]], x: 0, y: 0 },
            boardGrid: createBoardGrid(),
            lockedPieces: [],
        });

        processAutoDrop(gameState, 30, null, null);

        expect(gameState.dropCounter).toBe(30);
    });
});

describe('§3 the cascade animation catches up instead of stretching', () => {
    /** One block that must fall `distance` rows to the floor. */
    function makeFallState(distance) {
        const piece = {
            pieceId: 'faller', color: '#888', type: 'block', x: 0, y: BOTTOM - distance, shape: [[1]],
        };
        const gameState = {
            lockedPieces: [piece],
            boardGrid: createBoardGrid(),
            isSeeking: false,
            boardDirty: false,
        };
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        return { gameState, piece };
    }

    it('falls at the Quadra rate of 20ms per row when frames are healthy', async () => {
        const clock = installFrameClock({ frameMs: 4 });
        const { gameState, piece } = makeFallState(10);

        await applyGravity(gameState, null, null, {});

        expect(piece.y).toBe(BOTTOM);
        // Quadra: Player_check_link takes 2 ticks x 10ms per row = 20ms/row.
        // 10 rows => ~200ms, quantised up by at most one 4ms frame per row.
        expect(clock.now).toBeGreaterThanOrEqual(195);
        expect(clock.now).toBeLessThanOrEqual(240);
    });

    it('does not burn a whole frame per row when frames are slow', async () => {
        const clock = installFrameClock({ frameMs: 100 });
        const { gameState, piece } = makeFallState(10);

        await applyGravity(gameState, null, null, {});

        expect(piece.y).toBe(BOTTOM);
        // Old behaviour: 10 rows x 1 frame each = 10 frames = 1000ms of stall.
        // Paced: the overshoot of each slow frame pays for the following rows.
        expect(clock.frames).toBeLessThanOrEqual(4);
        expect(clock.now).toBeLessThan(450);
    });

    it('keeps cascade duration bounded as frames get worse', async () => {
        const durations = [];
        for (const frameMs of [16, 50, 100]) {
            const clock = installFrameClock({ frameMs });
            const { gameState } = makeFallState(12);
            // eslint-disable-next-line no-await-in-loop
            await applyGravity(gameState, null, null, {});
            durations.push(clock.now);
            vi.restoreAllMocks();
        }

        // The whole point: a 6x worse frame time must not mean a 6x longer
        // cascade. Allow one frame of quantisation slack at each step.
        const [fast, , slow] = durations;
        expect(slow).toBeLessThan(fast * 3);
    });

    it('fires exactly one onGravityStep per row regardless of pacing', async () => {
        installFrameClock({ frameMs: 100 });
        const onGravityStep = vi.fn();
        const { gameState } = makeFallState(7);

        await applyGravity(gameState, null, null, { onGravityStep });

        // Sim-deterministic contract pinned by physics-callback-schedule.test.js:
        // catching up must skip *frames*, never gravity steps.
        expect(onGravityStep).toHaveBeenCalledTimes(7);
    });

    it('holds the clear flash for Quadra\'s 160ms before anything falls', async () => {
        const clock = installFrameClock({ frameMs: 4 });
        const gameState = {
            boardGrid: createBoardGrid(),
            lockedPieces: [],
            score: 0,
            lines: 0,
            level: 1,
            linesUntilNextLevel: 15,
            isSeeking: false,
            comboState: { lockFootprint: [], manualColumns: [] },
        };
        // One full bottom row to clear, nothing above it — isolates the flash.
        gameState.lockedPieces = [{
            pieceId: 'row', color: '#666', type: 'garbage', x: 0, y: BOTTOM, shape: [Array(10).fill(1)],
        }];
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);

        let holdStartedAt = null;
        let firstRowMovedAt = null;
        const callbacks = {
            updateBoard: () => { if (holdStartedAt === null) holdStartedAt = clock.now; },
            onGravityStep: () => { if (firstRowMovedAt === null) firstRowMovedAt = clock.now; },
        };

        // A block two rows above the cleared row, so gravity has work to do.
        gameState.lockedPieces.push({
            pieceId: 'float', color: '#888', type: 'block', x: 0, y: BOTTOM - 3, shape: [[1]],
        });
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);

        await processPhysicsLegacy(gameState, callbacks);

        expect(gameState.lines).toBe(1);
        // Quadra: 16 ticks of flash hold (160ms) then a connectivity-scan tick
        // (20ms here) before the first row actually moves.
        const beforeFirstMove = firstRowMovedAt - holdStartedAt;
        expect(beforeFirstMove).toBeGreaterThanOrEqual(170);
        expect(beforeFirstMove).toBeLessThanOrEqual(215);
    });

    it('still resolves synchronously when seeking', async () => {
        const clock = installFrameClock({ frameMs: 100 });
        const { gameState, piece } = makeFallState(10);
        gameState.isSeeking = true;

        await applyGravity(gameState, null, null, {});

        expect(piece.y).toBe(BOTTOM);
        expect(clock.frames).toBe(0);
    });
});
