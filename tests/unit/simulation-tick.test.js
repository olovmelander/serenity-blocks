import {
    describe, expect, it, vi,
} from 'vitest';
import { planFixedTicks } from '../../src/core/fixed-tick-clock.js';
import { GameState } from '../../src/core/game.js';
import {
    advancePlayerInputTick,
    enqueueInputEdge,
} from '../../src/core/player-input-state.js';
import {
    advanceTick,
    INPUT_DISPOSITIONS,
} from '../../src/core/simulation-tick.js';

const command = (tick, action = 'move', value = -1) => ({
    tick,
    subframe: 0,
    action,
    value,
    source: 'edge',
    edgeSequence: tick,
});

describe('canonical simulation advanceTick', () => {
    it.each([
        [30, 2],
        [70, 5],
        [110, 7],
    ])('rejects every input batch across a %ims / %i-tick hit-stop, then accepts', (
        durationMs,
        expectedFrozenTicks,
    ) => {
        const state = new GameState();
        state.hitStopRemaining = durationMs;
        const applyInput = vi.fn(() => INPUT_DISPOSITIONS.APPLIED);
        const advancePhysics = vi.fn();
        const results = [];

        for (let index = 0; index <= expectedFrozenTicks; index += 1) {
            results.push(advanceTick(state, {
                advanceInput: ({ tick, emit }) => emit(command(tick)),
                applyInput,
                advancePhysics,
            }));
        }

        expect(results.slice(0, expectedFrozenTicks).every((result) => result.frozen)).toBe(true);
        expect(results.slice(0, expectedFrozenTicks).map((result) => (
            result.input[0].disposition
        ))).toEqual(Array(expectedFrozenTicks).fill(INPUT_DISPOSITIONS.REJECTED_HIT_STOP));
        expect(results.at(-1).frozen).toBe(false);
        expect(results.at(-1).input[0].disposition).toBe(INPUT_DISPOSITIONS.APPLIED);
        expect(applyInput).toHaveBeenCalledOnce();
        expect(advancePhysics).toHaveBeenCalledOnce();
        expect(state.simFrame).toBe(expectedFrozenTicks + 1);
    });

    it('rejects later commands when an accepted command creates hit-stop mid-batch', () => {
        const state = new GameState();
        const applied = [];
        const advancePhysics = vi.fn();

        const result = advanceTick(state, {
            advanceInput: ({ tick, emit }) => {
                emit(command(tick, 'hardDrop', null));
                emit(command(tick, 'move', 1));
            },
            applyInput: (input) => {
                applied.push(input.action);
                if (input.action === 'hardDrop') state.hitStopRemaining = 30;
                return INPUT_DISPOSITIONS.APPLIED;
            },
            advancePhysics,
        });

        expect(result.input.map((entry) => entry.disposition)).toEqual([
            INPUT_DISPOSITIONS.APPLIED,
            INPUT_DISPOSITIONS.REJECTED_HIT_STOP,
        ]);
        expect(applied).toEqual(['hardDrop']);
        expect(result.frozen).toBe(true);
        expect(state.hitStopTicks).toBe(1);
        expect(advancePhysics).not.toHaveBeenCalled();
    });

    it('advances a restored non-grid clock without rewinding it', () => {
        const state = new GameState();
        state.simFrame = 9;
        state.simTimeMs = 12.5;
        state.lastTime = 999;

        const result = advanceTick(state);

        expect(result.tick).toBe(10);
        expect(result.simTimeMs).toBeCloseTo(12.5 + (1000 / 60), 10);
        expect(state.lastTime).toBe(result.simTimeMs);
        expect(result.physicsAdvanced).toBe(false);
    });

    it('fails fast when an input adapter mutates without returning a disposition', () => {
        const state = new GameState();

        expect(() => advanceTick(state, {
            advanceInput: ({ tick, emit }) => emit(command(tick)),
            applyInput: () => undefined,
        })).toThrow('applyInput must return a boolean or InputDisposition');
    });

    it('cancels post-input hit-stop and physics when lifecycle ownership changes', () => {
        const state = new GameState();
        let ownsTick = true;
        const advancePhysics = vi.fn();

        const result = advanceTick(state, {
            advanceInput: () => {
                state.reset();
                state.hitStopRemaining = 30;
                ownsTick = false;
            },
            advancePhysics,
            shouldContinue: () => ownsTick,
        });

        expect(result.physicsAdvanced).toBe(false);
        expect(result.frozen).toBe(false);
        expect(state.hitStopRemaining).toBe(30);
        expect(state.hitStopTicks).toBe(0);
        expect(advancePhysics).not.toHaveBeenCalled();
    });

    it('ingests a release during hit-stop and produces no ghost repeat after thaw', () => {
        const state = new GameState({ inputHandling: { dasDelay: 0, dasInterval: 0 } });
        state.hitStopRemaining = 30;
        enqueueInputEdge(state.playerInput, {
            tick: 1, subframe: 0, action: 'move', value: -1, phase: 'down',
        });
        enqueueInputEdge(state.playerInput, {
            tick: 2, subframe: 0, action: 'move', value: -1, phase: 'up',
        });
        const applied = [];
        const results = [];

        for (let tick = 0; tick < 3; tick += 1) {
            results.push(advanceTick(state, {
                advanceInput: (context) => advancePlayerInputTick(state.playerInput, context),
                applyInput: (input) => {
                    applied.push(input);
                    return INPUT_DISPOSITIONS.APPLIED;
                },
            }));
        }

        expect(results[0].input.every((entry) => (
            entry.disposition === INPUT_DISPOSITIONS.REJECTED_HIT_STOP
        ))).toBe(true);
        expect(results[1].frozen).toBe(true);
        expect(results[2].frozen).toBe(false);
        expect(state.playerInput.das.moveLeft.active).toBe(false);
        expect(applied).toEqual([]);
    });

    it('produces identical input/disposition logs at 30, 60, and 144 Hz render rates', () => {
        const runAtRate = (renderHz) => {
            const state = new GameState({
                inputHandling: { dasDelay: 50, dasInterval: 33, softDropInterval: 40 },
            });
            [
                {
                    tick: 1, subframe: 0, action: 'move', value: 1, phase: 'down',
                },
                {
                    tick: 5, subframe: 4, action: 'rotate', value: 'flip', phase: 'down',
                },
                {
                    tick: 8, subframe: 1, action: 'softDrop', phase: 'down',
                },
                {
                    tick: 15, subframe: 1, action: 'softDrop', phase: 'up',
                },
                {
                    tick: 20, subframe: 0, action: 'move', value: 1, phase: 'up',
                },
            ].forEach((edge) => enqueueInputEdge(state.playerInput, edge));

            const log = [];
            let accumulatorMs = 0;
            let renderFrames = 0;
            while (state.simFrame < 40 && renderFrames < 10000) {
                const plan = planFixedTicks(accumulatorMs, 1000 / renderHz, {
                    maxSteps: 5,
                    maxCarryTicks: 5,
                });
                accumulatorMs = plan.remainderMs;
                for (let step = 0; step < plan.steps && state.simFrame < 40; step += 1) {
                    const result = advanceTick(state, {
                        advanceInput: (context) => advancePlayerInputTick(
                            state.playerInput,
                            context,
                        ),
                        applyInput: () => INPUT_DISPOSITIONS.APPLIED,
                    });
                    result.input.forEach(({ command: input, disposition }) => {
                        log.push([
                            input.tick,
                            input.action,
                            input.value,
                            input.source,
                            disposition,
                        ]);
                    });
                }
                renderFrames += 1;
            }

            expect(state.simFrame).toBe(40);
            return log;
        };

        const at30 = runAtRate(30);
        expect(runAtRate(60)).toEqual(at30);
        expect(runAtRate(144)).toEqual(at30);
    });
});
