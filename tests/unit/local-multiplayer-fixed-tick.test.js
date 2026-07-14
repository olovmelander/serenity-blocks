import {
    describe, expect, it, vi,
} from 'vitest';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { enqueueInputEdge } from '../../src/core/player-input-state.js';
import {
    createLocalMultiplayerFixedInputBinding,
    createLocalMultiplayerFixedTickRuntime,
    ownsLocalMultiplayerFixedTickRuntime,
    runLocalMultiplayerFixedTicks,
    resetLocalMultiplayerFixedMatchClock,
    startLocalMultiplayerFixedTickRuntime,
    stopLocalMultiplayerFixedTickRuntime,
} from '../../src/core/game-modes/local-multiplayer-fixed-tick.js';

function createRound(numPlayers = 2) {
    const multiplayerState = new MultiPlayerState(numPlayers);
    multiplayerState.reset();
    multiplayerState.isPaused = false;
    return multiplayerState;
}

function runAtRenderRate(renderRate) {
    const multiplayerState = createRound(3);
    const runtime = createLocalMultiplayerFixedTickRuntime();
    const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
    const order = [];
    for (let frame = 0; frame < renderRate; frame += 1) {
        runLocalMultiplayerFixedTicks(runtime, 1000 / renderRate, {
            ownership,
            afterPlayerTick: (playerIndex) => order.push(`${runtime.simFrame}:${playerIndex}`),
        });
    }
    return { multiplayerState, order, runtime };
}

function createController() {
    return {
        fixedTickInputAdapter: null,
        clearFixedTickInput: vi.fn(),
        setFixedTickInputAdapter(adapter = null) {
            this.fixedTickInputAdapter = adapter;
        },
    };
}

describe('Local Multiplayer shared fixed-tick scheduler', () => {
    it.each([30, 60, 144])('advances every board on one 60 Hz clock at %i Hz render input', (rate) => {
        const { multiplayerState, order, runtime } = runAtRenderRate(rate);

        expect(runtime.simFrame).toBe(60);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([60, 60, 60]);
        expect(multiplayerState.players.map((player) => player.simTimeMs))
            .toEqual([runtime.simTimeMs, runtime.simTimeMs, runtime.simTimeMs]);
        expect(order.slice(0, 6)).toEqual(['1:0', '1:1', '1:2', '2:0', '2:1', '2:2']);
        expect(order).toHaveLength(180);
    });

    it('interleaves players by stable index instead of batching catch-up per board', () => {
        const multiplayerState = createRound(3);
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        const order = [];

        const result = runLocalMultiplayerFixedTicks(runtime, 1000 / 30, {
            ownership,
            afterPlayerTick: (playerIndex) => order.push(`${runtime.simFrame}:${playerIndex}`),
        });

        expect(result.executedSteps).toBe(2);
        expect(order).toEqual(['1:0', '1:1', '1:2', '2:0', '2:1', '2:2']);
    });

    it('keeps the match clock moving while dead and explicitly explored boards stay frozen', () => {
        const multiplayerState = createRound(3);
        multiplayerState.players[1].isAlive = false;
        multiplayerState.playerPaused[2] = true;
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);

        runLocalMultiplayerFixedTicks(runtime, 1000 / 60, { ownership });

        expect(runtime.simFrame).toBe(1);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 0, 0]);
    });

    it('fences a predecessor even when the same MultiPlayerState and GameStates are reset in place', () => {
        const multiplayerState = createRound();
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const predecessor = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        const replacement = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);

        expect(ownsLocalMultiplayerFixedTickRuntime(runtime, predecessor)).toBe(false);
        expect(runLocalMultiplayerFixedTicks(runtime, 1000 / 60, { ownership: predecessor }).executedSteps)
            .toBe(0);
        expect(runLocalMultiplayerFixedTicks(runtime, 1000 / 60, { ownership: replacement }).executedSteps)
            .toBe(1);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1]);
    });

    it('rejects boards that do not share one tick duration', () => {
        const multiplayerState = createRound();
        multiplayerState.players[1].simTickMs = 1000 / 30;
        const runtime = createLocalMultiplayerFixedTickRuntime();

        expect(() => startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState))
            .toThrow('one canonical clock');
    });

    it('stops between boards when a synchronous callback retires the round', () => {
        const multiplayerState = createRound();
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        const visited = [];

        runLocalMultiplayerFixedTicks(runtime, 1000 / 60, {
            ownership,
            afterPlayerTick: (playerIndex) => {
                visited.push(playerIndex);
                stopLocalMultiplayerFixedTickRuntime(runtime);
            },
        });

        expect(visited).toEqual([0]);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 0]);
        expect(runtime.active).toBe(false);
    });

    it('finishes the current player barrier when an elimination pauses the match', () => {
        const multiplayerState = createRound();
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        const visited = [];

        const result = runLocalMultiplayerFixedTicks(runtime, 1000 / 30, {
            ownership,
            afterPlayerTick: (playerIndex) => {
                visited.push(`${runtime.simFrame}:${playerIndex}`);
                if (playerIndex === 0) multiplayerState.isPaused = true;
            },
        });

        expect(result.executedSteps).toBe(1);
        expect(visited).toEqual(['1:0', '1:1']);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1]);
    });

    it('does not turn wall time spent paused into simulation debt or a clock warp', () => {
        const multiplayerState = createRound();
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        const onClockWarp = vi.fn();
        multiplayerState.isPaused = true;

        const paused = runLocalMultiplayerFixedTicks(runtime, 5000, {
            ownership,
            onClockWarp,
        });

        expect(paused.executedSteps).toBe(0);
        expect(paused.tickPlan).toBeNull();
        expect(runtime.accumulatorMs).toBe(0);
        expect(runtime.simFrame).toBe(0);
        expect(onClockWarp).not.toHaveBeenCalled();

        multiplayerState.isPaused = false;
        const resumed = runLocalMultiplayerFixedTicks(runtime, 1000 / 60, {
            ownership,
            onClockWarp,
        });
        expect(resumed.executedSteps).toBe(1);
        expect(runtime.simFrame).toBe(1);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1]);
        expect(onClockWarp).not.toHaveBeenCalled();
    });

    it('retires a partially applied barrier when a player tick throws', () => {
        const multiplayerState = createRound();
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);

        expect(() => runLocalMultiplayerFixedTicks(runtime, 1000 / 60, {
            ownership,
            afterPlayerTick: (playerIndex) => {
                if (playerIndex === 0) throw new Error('player tick failed');
            },
        })).toThrow('player tick failed');
        expect(runtime.active).toBe(false);
        expect(ownsLocalMultiplayerFixedTickRuntime(runtime, ownership)).toBe(false);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 0]);
    });

    it('keeps the match clock across round rebinds while player clocks restart', () => {
        const multiplayerState = createRound();
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const firstRound = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        runLocalMultiplayerFixedTicks(runtime, 1000 / 30, { ownership: firstRound });
        stopLocalMultiplayerFixedTickRuntime(runtime);
        multiplayerState.reset();
        multiplayerState.isPaused = false;

        const secondRound = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        runLocalMultiplayerFixedTicks(runtime, 1000 / 60, { ownership: secondRound });
        expect(runtime.simFrame).toBe(3);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([1, 1]);

        stopLocalMultiplayerFixedTickRuntime(runtime);
        resetLocalMultiplayerFixedMatchClock(runtime);
        expect(runtime.simFrame).toBe(0);
        expect(runtime.simTimeMs).toBe(0);
    });

    it('retains bounded overload debt and reports only discarded excess wall time', () => {
        const multiplayerState = createRound();
        const runtime = createLocalMultiplayerFixedTickRuntime();
        const ownership = startLocalMultiplayerFixedTickRuntime(runtime, multiplayerState);
        const onClockWarp = vi.fn();

        const overloaded = runLocalMultiplayerFixedTicks(runtime, 1000, {
            ownership,
            onClockWarp,
        });
        expect(overloaded.executedSteps).toBe(5);
        expect(runtime.simFrame).toBe(5);
        expect(runtime.accumulatorMs).toBeGreaterThan(0);
        expect(runtime.accumulatorMs).toBeLessThanOrEqual(300);
        expect(onClockWarp).toHaveBeenCalledOnce();
        expect(onClockWarp.mock.calls[0][0].warpedMs).toBeGreaterThan(0);

        for (let turn = 0; turn < 4; turn += 1) {
            runLocalMultiplayerFixedTicks(runtime, 0, { ownership });
        }
        expect(runtime.simFrame).toBe(18);
        expect(multiplayerState.players.map((player) => player.simFrame)).toEqual([18, 18]);
    });
});

describe('Local Multiplayer per-player fixed input binding', () => {
    it('routes keyboard and gamepad slots to exact GameStates with per-player device claims', () => {
        const multiplayerState = createRound(3);
        const inputController = createController();
        const gamepadController = createController();
        const binding = createLocalMultiplayerFixedInputBinding({
            players: multiplayerState.players,
            inputController,
            gamepadController,
            isEnabled: () => true,
        });
        binding.install();

        expect(inputController.fixedTickInputAdapter.resolveGameState(0))
            .toBe(multiplayerState.players[0]);
        expect(gamepadController.fixedTickInputAdapter.resolveGameState(2))
            .toBe(multiplayerState.players[2]);
        expect(inputController.fixedTickInputAdapter.resolveGameState(3)).toBeNull();

        const player0 = { playerIndex: 0, gameState: multiplayerState.players[0] };
        const player1 = { playerIndex: 1, gameState: multiplayerState.players[1] };
        expect(inputController.fixedTickInputAdapter.acceptSource(player0)).toBe(true);
        expect(gamepadController.fixedTickInputAdapter.acceptSource(player0)).toBe(false);
        expect(gamepadController.fixedTickInputAdapter.acceptSource(player1)).toBe(true);
        expect(binding.getActiveDevice(0)).toBe('keyboard');
        expect(binding.getActiveDevice(1)).toBe('gamepad');
    });

    it('drains each GameState-owned queue only through that player tick', () => {
        const multiplayerState = createRound();
        const binding = createLocalMultiplayerFixedInputBinding({
            players: multiplayerState.players,
            isEnabled: () => true,
        });
        enqueueInputEdge(multiplayerState.players[0].playerInput, {
            tick: 1, subframe: 0, action: 'move', value: -1, phase: 'down',
        });
        enqueueInputEdge(multiplayerState.players[1].playerInput, {
            tick: 1, subframe: 0, action: 'move', value: 1, phase: 'down',
        });
        const player0 = [];
        const player1 = [];

        binding.advanceInput(0, { tick: 1, tickMs: 1000 / 60, emit: (command) => player0.push(command) });
        expect(player0.map((command) => command.value)).toEqual([-1]);
        expect(multiplayerState.players[1].playerInput.pendingEdges).toHaveLength(1);

        binding.advanceInput(1, { tick: 1, tickMs: 1000 / 60, emit: (command) => player1.push(command) });
        expect(player1.map((command) => command.value)).toEqual([1]);
    });

    it('claims disabled players so their input cannot fall through to legacy globals', () => {
        const multiplayerState = createRound();
        multiplayerState.players[1].isAlive = false;
        const binding = createLocalMultiplayerFixedInputBinding({
            players: multiplayerState.players,
            isEnabled: () => true,
        });
        const context = { playerIndex: 1, gameState: multiplayerState.players[1] };

        expect(binding.keyboardAdapter.isEnabled(context)).toBe(true);
        expect(binding.keyboardAdapter.acceptSource(context)).toBe(false);
        expect(binding.advanceInput(1, {
            tick: 1,
            tickMs: 1000 / 60,
            emit: vi.fn(),
        })).toEqual([]);
    });

    it('clears every owned player queue on pause and preserves a replacement adapter on stale disposal', () => {
        const multiplayerState = createRound();
        const inputController = createController();
        const gamepadController = createController();
        const binding = createLocalMultiplayerFixedInputBinding({
            players: multiplayerState.players,
            inputController,
            gamepadController,
            isEnabled: () => true,
        });
        binding.install();
        multiplayerState.players.forEach((player, playerIndex) => {
            enqueueInputEdge(player.playerInput, {
                tick: 1, subframe: 0, action: 'move', value: playerIndex ? 1 : -1, phase: 'down',
            });
        });

        binding.clear();
        expect(multiplayerState.players.every((player) => player.playerInput.pendingEdges.length === 0))
            .toBe(true);

        const replacement = { resolveGameState: vi.fn(), isEnabled: vi.fn() };
        inputController.fixedTickInputAdapter = replacement;
        binding.dispose();
        expect(inputController.fixedTickInputAdapter).toBe(replacement);
        expect(gamepadController.fixedTickInputAdapter).toBeNull();
    });
});
