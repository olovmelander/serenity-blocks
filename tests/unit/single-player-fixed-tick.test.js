import {
    describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { FIXED_TICK_MS } from '../../src/core/fixed-tick-clock.js';
import { enqueueInputEdge } from '../../src/core/player-input-state.js';
import {
    createSinglePlayerFixedInputBinding,
    createSinglePlayerFixedTickRuntime,
    runSinglePlayerFixedTicks,
    startSinglePlayerFixedTickRuntime,
    stopSinglePlayerFixedTickRuntime,
} from '../../src/core/game-modes/single-player-fixed-tick.js';

function startRuntime(gameState = new GameState()) {
    const runtime = createSinglePlayerFixedTickRuntime();
    const ownership = startSinglePlayerFixedTickRuntime(runtime, gameState);
    return { gameState, ownership, runtime };
}

function run(runtime, ownership, elapsedMs, options = {}) {
    return runSinglePlayerFixedTicks(runtime, elapsedMs, {
        ownership,
        shouldContinue: () => true,
        ...options,
    });
}

function createController() {
    return {
        fixedTickInputAdapter: null,
        setFixedTickInputAdapter: vi.fn(function setFixedTickInputAdapter(adapter) {
            this.fixedTickInputAdapter = adapter;
        }),
        clearFixedTickInput: vi.fn(),
    };
}

describe('single-player fixed-tick runtime', () => {
    it.each([30, 60, 144])(
        'advances exactly 60 canonical ticks over one second at %i Hz owner cadence',
        (ownerRate) => {
            const { gameState, ownership, runtime } = startRuntime();

            for (let update = 0; update < ownerRate; update += 1) {
                run(runtime, ownership, 1000 / ownerRate);
            }

            expect(gameState.simFrame).toBe(60);
            expect(gameState.simTimeMs).toBeCloseTo(1000, 8);
            expect(runtime.accumulatorMs).toBeCloseTo(0, 8);
        },
    );

    it.each([
        [299, false, 0],
        [300, false, 0],
        [301, true, 1],
    ])('rebases only wall-time debt beyond 300 ms (%i ms)', (elapsedMs, warped, warpedMs) => {
        const { gameState, ownership, runtime } = startRuntime();
        const onClockWarp = vi.fn();

        const result = run(runtime, ownership, elapsedMs, { onClockWarp });

        expect(result.executedSteps).toBe(5);
        expect(result.tickPlan).toMatchObject({
            requestedAccumulatedMs: elapsedMs,
            accumulatedMs: warped ? 300 : elapsedMs,
            debtWasClamped: warped,
            warpedMs,
        });
        expect(runtime.accumulatorMs).toBeCloseTo(
            (warped ? 300 : elapsedMs) - (5 * FIXED_TICK_MS),
            8,
        );
        expect(gameState.simFrame).toBe(5);

        if (warped) {
            expect(onClockWarp).toHaveBeenCalledOnce();
            expect(result.clockWarp).toEqual({
                requestedDebtMs: 301,
                retainedDebtMs: 300,
                warpedMs: 1,
                maxDebtMs: 300,
                maxSteps: 5,
                tickMs: 16.667,
            });
            expect(runtime.lastClockWarp).toEqual(result.clockWarp);
        } else {
            expect(onClockWarp).not.toHaveBeenCalled();
            expect(result.clockWarp).toBeNull();
        }
    });

    it('does not accrue pause-gap debt', () => {
        const { gameState, ownership, runtime } = startRuntime();
        let paused = false;
        const options = { shouldContinue: () => !paused };

        run(runtime, ownership, FIXED_TICK_MS, options);
        paused = true;
        const pausedResult = run(runtime, ownership, 1000, options);
        paused = false;
        run(runtime, ownership, FIXED_TICK_MS, options);

        expect(pausedResult).toMatchObject({ executedSteps: 0, plannedSteps: 0 });
        expect(gameState.simFrame).toBe(2);
        expect(runtime.accumulatorMs).toBeCloseTo(0, 8);
    });

    it('rejects stale owners without mutating the replacement session', () => {
        const firstState = new GameState();
        const { ownership: firstOwnership, runtime } = startRuntime(firstState);
        const secondState = new GameState();
        const secondOwnership = startSinglePlayerFixedTickRuntime(runtime, secondState);

        const staleResult = run(runtime, firstOwnership, 1000);

        expect(staleResult).toMatchObject({ executedSteps: 0, plannedSteps: 0 });
        expect(firstState.simFrame).toBe(0);
        expect(secondState.simFrame).toBe(0);
        expect(runtime.accumulatorMs).toBe(0);

        run(runtime, secondOwnership, FIXED_TICK_MS);
        expect(secondState.simFrame).toBe(1);

        stopSinglePlayerFixedTickRuntime(runtime);
        run(runtime, secondOwnership, 1000);
        expect(secondState.simFrame).toBe(1);
        expect(runtime.accumulatorMs).toBe(0);
    });

    it('runs afterTick with each completed result before the next catch-up tick', () => {
        const { gameState, ownership, runtime } = startRuntime();
        const order = [];
        gameState.maintenanceFrame = 0;

        const result = run(runtime, ownership, 3 * FIXED_TICK_MS, {
            advanceInput: ({ tick }) => {
                order.push(`input:${tick}:after-${gameState.maintenanceFrame}`);
            },
            afterTick: (tickResult) => {
                order.push(`after:${tickResult.tick}`);
                expect(tickResult.simTimeMs).toBe(gameState.simTimeMs);
                gameState.maintenanceFrame = tickResult.tick;
            },
        });

        expect(result.executedSteps).toBe(3);
        expect(order).toEqual([
            'input:1:after-0',
            'after:1',
            'input:2:after-1',
            'after:2',
            'input:3:after-2',
            'after:3',
        ]);
        expect(runtime.accumulatorMs).toBeCloseTo(0, 8);
    });

    it('skips afterTick when the canonical tick stops its owner', () => {
        const { gameState, ownership, runtime } = startRuntime();
        const afterTick = vi.fn();

        const result = run(runtime, ownership, 3 * FIXED_TICK_MS, {
            advanceInput: ({ emit }) => emit({ action: 'move', value: -1 }),
            applyInput: () => {
                stopSinglePlayerFixedTickRuntime(runtime);
                return true;
            },
            afterTick,
        });

        expect(result.executedSteps).toBe(1);
        expect(gameState.simFrame).toBe(1);
        expect(afterTick).not.toHaveBeenCalled();
        expect(runtime.accumulatorMs).toBe(0);
    });

    it('lets afterTick stop the owner before another catch-up tick begins', () => {
        const { gameState, ownership, runtime } = startRuntime();
        const afterTick = vi.fn(() => stopSinglePlayerFixedTickRuntime(runtime));

        const result = run(runtime, ownership, 3 * FIXED_TICK_MS, { afterTick });

        expect(result.executedSteps).toBe(1);
        expect(gameState.simFrame).toBe(1);
        expect(afterTick).toHaveBeenCalledOnce();
        expect(afterTick).toHaveBeenCalledWith(expect.objectContaining({ tick: 1 }));
        expect(runtime.accumulatorMs).toBe(0);
    });

    it('fences replacement ownership created by afterTick', () => {
        const firstState = new GameState();
        const { ownership, runtime } = startRuntime(firstState);
        const replacementState = new GameState();
        let replacementOwnership = null;

        const result = run(runtime, ownership, 3 * FIXED_TICK_MS, {
            afterTick: () => {
                replacementOwnership = startSinglePlayerFixedTickRuntime(
                    runtime,
                    replacementState,
                );
            },
        });

        expect(result.executedSteps).toBe(1);
        expect(firstState.simFrame).toBe(1);
        expect(replacementState.simFrame).toBe(0);
        expect(runtime.accumulatorMs).toBe(0);

        run(runtime, replacementOwnership, FIXED_TICK_MS);
        expect(replacementState.simFrame).toBe(1);
    });

    it('consumes exactly one tick of debt when afterTick throws', () => {
        const { gameState, ownership, runtime } = startRuntime();
        const failure = new Error('maintenance failed');

        expect(() => run(runtime, ownership, 3 * FIXED_TICK_MS, {
            afterTick: () => {
                throw failure;
            },
        })).toThrow(failure);

        expect(gameState.simFrame).toBe(1);
        expect(runtime.accumulatorMs).toBeCloseTo(2 * FIXED_TICK_MS, 8);

        const recovery = run(runtime, ownership, 0);
        expect(recovery.executedSteps).toBe(2);
        expect(gameState.simFrame).toBe(3);
        expect(runtime.accumulatorMs).toBeCloseTo(0, 8);
    });
});

describe('single-player fixed input binding', () => {
    it('claims only player 0 and locks gameplay to the first active device', () => {
        const gameState = new GameState();
        const inputController = createController();
        const gamepadController = createController();
        let enabled = true;
        const binding = createSinglePlayerFixedInputBinding({
            gameState,
            inputController,
            gamepadController,
            isEnabled: () => enabled,
        });

        expect(binding.install()).toBe(true);
        const keyboard = inputController.fixedTickInputAdapter;
        const gamepad = gamepadController.fixedTickInputAdapter;

        expect(keyboard.resolveGameState(0)).toBe(gameState);
        expect(keyboard.resolveGameState(1)).toBeNull();
        expect(gamepad.resolveGameState(0)).toBe(gameState);
        expect(gamepad.resolveGameState(1)).toBeNull();
        expect(keyboard.isEnabled({ playerIndex: 0, gameState })).toBe(true);
        expect(keyboard.isEnabled({ playerIndex: 1, gameState: null })).toBe(false);

        expect(keyboard.acceptSource()).toBe(true);
        expect(gamepad.acceptSource()).toBe(false);
        expect(binding.getActiveDevice()).toBe('keyboard');

        binding.clear();
        expect(binding.getActiveDevice()).toBeNull();
        expect(gamepad.acceptSource()).toBe(true);
        expect(keyboard.acceptSource()).toBe(false);

        enabled = false;
        expect(keyboard.isEnabled({ playerIndex: 0, gameState })).toBe(false);
        gameState.isPaused = true;
        enabled = true;
        expect(gamepad.isEnabled({ playerIndex: 0, gameState })).toBe(false);
    });

    it('fails closed when either controller has a replacement owner', () => {
        const gameState = new GameState();
        const inputController = createController();
        const gamepadController = createController();
        const binding = createSinglePlayerFixedInputBinding({
            gameState,
            inputController,
            gamepadController,
            isEnabled: () => true,
        });
        binding.install();

        enqueueInputEdge(gameState.playerInput, {
            tick: 1,
            action: 'move',
            value: -1,
            phase: 'down',
        });
        const inputSetCalls = inputController.setFixedTickInputAdapter.mock.calls.length;
        const gamepadSetCalls = gamepadController.setFixedTickInputAdapter.mock.calls.length;
        const replacement = { external: true };
        inputController.fixedTickInputAdapter = replacement;
        binding.dispose();

        expect(inputController.fixedTickInputAdapter).toBe(replacement);
        expect(gamepadController.fixedTickInputAdapter).toBe(binding.gamepadAdapter);
        expect(gameState.playerInput.pendingEdges).toEqual([
            expect.objectContaining({ action: 'move', value: -1, phase: 'down' }),
        ]);
        expect(inputController.clearFixedTickInput).not.toHaveBeenCalled();
        expect(gamepadController.clearFixedTickInput).not.toHaveBeenCalled();
        expect(inputController.setFixedTickInputAdapter).toHaveBeenCalledTimes(inputSetCalls);
        expect(gamepadController.setFixedTickInputAdapter).toHaveBeenCalledTimes(gamepadSetCalls);
        expect(binding.keyboardAdapter.isEnabled({ playerIndex: 0, gameState })).toBe(false);
        expect(binding.gamepadAdapter.isEnabled({ playerIndex: 0, gameState })).toBe(false);
    });

    it('removes its own adapters on normal disposal', () => {
        const inputController = createController();
        const gamepadController = createController();
        const binding = createSinglePlayerFixedInputBinding({
            gameState: new GameState(),
            inputController,
            gamepadController,
            isEnabled: () => true,
        });
        binding.install();

        binding.dispose();

        expect(inputController.fixedTickInputAdapter).toBeNull();
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
    });
});
