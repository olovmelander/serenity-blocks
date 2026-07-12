import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import {
    GameState, hardDrop, processAutoDrop, softDrop, spawnPiece,
} from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { computeBoardDigest } from '../../src/core/demo/demo-state.js';
import { planFixedTicks } from '../../src/core/fixed-tick-clock.js';
import { advanceTick, INPUT_DISPOSITIONS } from '../../src/core/simulation-tick.js';
import {
    getCascadeShadowStats, resetCascadeShadowStats,
} from '../../src/core/cascade-shadow.js';

const QUEUE = ['O', 'T', 'I', 'S', 'Z', 'J', 'L', 'O', 'T', 'I'];

function createState() {
    const state = new GameState();
    let rngCalls = 0;
    state.randomGenerator = () => {
        rngCalls += 1;
        return 0.5;
    };
    state.nextPieces = QUEUE.slice();
    spawnPiece(state);
    state.dropInterval = state.simTickMs;
    return { state, getRngCalls: () => rngCalls };
}

async function runNoClearAtRate(renderRate) {
    const { state, getRngCalls } = createState();
    const spawns = [];
    const tickY = [];
    let lockFrame = null;
    let issued = false;
    let accumulatorMs = 0;
    const callbacks = {
        spawnPiece: vi.fn(() => {
            const processing = state.isProcessingPhysics;
            const piece = spawnPiece(state);
            spawns.push({ frame: state.simFrame, processing, y: piece?.y });
            return piece;
        }),
    };
    const tickOptions = {
        advanceInput: ({ emit }) => {
            if (!issued) {
                issued = true;
                emit({ action: 'hardDrop' });
            }
        },
        applyInput: () => {
            lockFrame = state.simFrame;
            return hardDrop(state, null, callbacks, {
                fixedTick: true,
                inputPhase: true,
            });
        },
        advancePhysics: (tickMs) => processAutoDrop(
            state,
            tickMs,
            null,
            callbacks,
            { fixedTick: true },
        ),
    };

    async function advanceRenderFrame(renderFrame = 0) {
        if (state.simFrame >= 4 || renderFrame >= 100) return;
        const plan = planFixedTicks(accumulatorMs, 1000 / renderRate, { maxSteps: 5 });
        accumulatorMs = plan.remainderMs;
        for (let step = 0; step < plan.steps && state.simFrame < 4; step += 1) {
            advanceTick(state, tickOptions);
            tickY.push(state.currentPiece?.y ?? null);
        }
        // Model browser microtasks only between render frames. A 30 Hz frame
        // therefore owns two canonical ticks before any Promise continuation.
        await Promise.resolve();
        await advanceRenderFrame(renderFrame + 1);
    }
    await advanceRenderFrame();

    return {
        boardDigest: computeBoardDigest(state.boardGrid),
        currentPiece: state.currentPiece && {
            type: state.currentPiece.type,
            x: state.currentPiece.x,
            y: state.currentPiece.y,
            rotation: state.currentPiece.rotation,
        },
        dropCounter: state.dropCounter,
        inputQueue: state.inputQueue,
        latestPhysicsPromise: state.latestPhysicsPromise ?? null,
        lines: state.lines,
        lockFrame,
        nextPieces: state.nextPieces.slice(),
        rngCalls: getRngCalls(),
        score: state.score,
        simFrame: state.simFrame,
        spawn: spawns[0],
        spawnCount: spawns.length,
        tickY,
    };
}

describe('fixed-tick zero-wave lock continuation', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        resetCascadeShadowStats();
    });

    it('spawns on the lock tick with identical state at 30/60/144 Hz', async () => {
        const at30 = await runNoClearAtRate(30);
        const at60 = await runNoClearAtRate(60);
        const at144 = await runNoClearAtRate(144);

        expect(at30).toEqual(at60);
        expect(at60).toEqual(at144);
        expect(at60.lockFrame).toBe(1);
        expect(at60.spawn).toEqual({ frame: 1, processing: false, y: 2 });
        expect(at60.spawnCount).toBe(1);
        expect(at60.latestPhysicsPromise).toBeNull();
        expect(at60.tickY[0]).toBe(2);
        expect(at60.tickY[1]).toBe(3);
    });

    it('keeps the variable-delta rollback path on its Promise continuation', async () => {
        const { state } = createState();
        const spawn = vi.fn(() => spawnPiece(state));

        expect(hardDrop(state, null, { spawnPiece: spawn })).toBe(true);
        expect(state.isProcessingPhysics).toBe(true);
        expect(state.currentPiece).toBeNull();
        expect(spawn).not.toHaveBeenCalled();

        await state.latestPhysicsPromise;

        expect(state.isProcessingPhysics).toBe(false);
        expect(state.currentPiece).not.toBeNull();
        expect(spawn).toHaveBeenCalledOnce();
    });

    it('clears the same-tick gravity guard across a round reset', () => {
        const { state } = createState();
        state._fixedInputSpawnFrame = 1;

        state.reset();
        state.nextPieces = ['O'];
        spawnPiece(state);
        state.dropInterval = state.simTickMs;
        state.simFrame = 1;
        const startY = state.currentPiece.y;

        processAutoDrop(state, state.simTickMs, null, null, { fixedTick: true });

        expect(state._fixedInputSpawnFrame).toBeNull();
        expect(state.currentPiece.y).toBe(startY + 1);
    });

    it('rejects every remaining command after an input-phase spawn', () => {
        const { state } = createState();
        state.lockDelay = 0;
        state.currentPiece.y = state.boardGrid.length - state.currentPiece.shape.length;
        const spawn = vi.fn(() => spawnPiece(state));
        let applyCount = 0;

        const result = advanceTick(state, {
            advanceInput: ({ emit }) => {
                for (let repeat = 0; repeat < 21; repeat += 1) {
                    emit({ action: 'softDrop', repeat });
                }
            },
            applyInput: () => {
                applyCount += 1;
                softDrop(state, null, { spawnPiece: spawn }, {
                    fixedTick: true,
                    inputPhase: true,
                });
                return true;
            },
            advancePhysics: (tickMs) => processAutoDrop(
                state,
                tickMs,
                null,
                { spawnPiece: spawn },
                { fixedTick: true },
            ),
        });

        expect(result.input[0].disposition).toBe(INPUT_DISPOSITIONS.APPLIED);
        expect(result.input.slice(1).every(
            ({ disposition }) => disposition === INPUT_DISPOSITIONS.REJECTED_PHYSICS,
        )).toBe(true);
        expect(applyCount).toBe(1);
        expect(spawn).toHaveBeenCalledOnce();
        expect(state.currentPiece.y).toBe(2);
    });

    it('settles cascade shadow before a synchronous spawn can top out', () => {
        vi.stubGlobal('window', {
            location: { search: '?cascadeShadow=1' },
            localStorage: { getItem: () => null },
        });
        const { state } = createState();
        const spawn = vi.fn(() => {
            state.isGameOver = true;
        });

        hardDrop(state, null, { spawnPiece: spawn }, {
            fixedTick: true,
            inputPhase: true,
        });

        expect(spawn).toHaveBeenCalledOnce();
        expect(state.isGameOver).toBe(true);
        expect(getCascadeShadowStats()).toMatchObject({
            armed: 1, clean: 1, discarded: 0, divergent: 0,
        });
    });

    it.each([
        ['legacy', ''],
        ['cascadeV2', '?cascadeV2=1'],
    ])('leaves a full-row lock on the %s async cascade replay', async (_path, search) => {
        if (search) {
            vi.stubGlobal('window', {
                location: { search },
                localStorage: { getItem: () => null },
            });
        }
        const { state } = createState();
        const bottom = state.boardGrid.length - 1;
        state.lockedPieces = [{
            shapeKey: 'I',
            type: 'I',
            shape: [Array(9).fill(1)],
            color: '#fff',
            x: 0,
            y: bottom,
            rotation: 0,
            pieceId: 100,
        }];
        Object.assign(state.currentPiece, {
            shapeKey: 'I',
            type: 'I',
            shape: [[1]],
            color: '#fff',
            x: 9,
            y: 0,
            rotation: 0,
        });
        rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
        state.isSeeking = true;
        const spawn = vi.fn(() => spawnPiece(state));

        expect(hardDrop(state, null, { spawnPiece: spawn }, {
            fixedTick: true,
            inputPhase: true,
        })).toBe(true);
        expect(state.isProcessingPhysics).toBe(true);
        expect(state.currentPiece).toBeNull();
        expect(state.latestPhysicsPromise).toBeInstanceOf(Promise);
        expect(spawn).not.toHaveBeenCalled();

        await state.latestPhysicsPromise;

        expect(state.lines).toBe(1);
        expect(state.isProcessingPhysics).toBe(false);
        expect(state.currentPiece).not.toBeNull();
        expect(spawn).toHaveBeenCalledOnce();
    });
});
