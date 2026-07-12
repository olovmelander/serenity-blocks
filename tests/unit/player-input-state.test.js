import {
    describe, expect, it,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { startDas } from '../../src/core/das.js';
import {
    advancePlayerInputTick,
    clearPlayerInput,
    createPlayerInputState,
    drainInputEdgesThroughTick,
    enqueueInputEdge,
    normalizeInputHandlingConfig,
    PLAYER_INPUT_EDGE_CAPACITY,
    resetPlayerInputState,
    restorePlayerInputState,
    updateInputHandlingConfig,
} from '../../src/core/player-input-state.js';

describe('per-player input state', () => {
    it('copies and normalizes explicit handling without retaining the source', () => {
        const source = { dasDelay: 90, dasInterval: 0, softDropInterval: -4 };
        const config = normalizeInputHandlingConfig(source);
        source.dasDelay = 999;

        expect(config).toEqual({
            dasDelay: 90,
            dasInterval: 0,
            softDropInterval: 0,
        });
        expect(normalizeInputHandlingConfig({ dasDelay: Number.NaN })).toEqual({
            dasDelay: 120,
            dasInterval: 40,
            softDropInterval: 50,
        });
    });

    it('never aliases state, config, or queues across GameStates', () => {
        const first = new GameState({ inputHandling: { dasDelay: 75 } });
        const second = new GameState({ inputHandling: { dasDelay: 75 } });

        startDas(first.playerInput.das.moveLeft);
        enqueueInputEdge(first.playerInput, {
            tick: 1, subframe: 0, action: 'move', value: -1, phase: 'down',
        });
        first.playerInput.config.dasDelay = 10;

        expect(second.playerInput).not.toBe(first.playerInput);
        expect(second.playerInput.das.moveLeft.active).toBe(false);
        expect(second.playerInput.pendingEdges).toEqual([]);
        expect(second.playerInput.config.dasDelay).toBe(75);
    });

    it('orders canonical edges by tick, subframe, then insertion sequence', () => {
        const state = createPlayerInputState();
        enqueueInputEdge(state, {
            tick: 4, subframe: 8, action: 'move', value: 1, phase: 'down',
        });
        enqueueInputEdge(state, {
            tick: 2, subframe: 3, action: 'rotate', value: 'left', phase: 'down',
        });
        enqueueInputEdge(state, {
            tick: 4, subframe: 2, action: 'softDrop', phase: 'down',
        });
        enqueueInputEdge(state, {
            tick: 4, subframe: 2, action: 'hardDrop', phase: 'down',
        });

        expect(drainInputEdgesThroughTick(state, 3).map((edge) => edge.sequence)).toEqual([1]);
        expect(drainInputEdgesThroughTick(state, 4).map((edge) => edge.sequence)).toEqual([2, 3, 0]);
        expect(state.pendingEdges).toEqual([]);
        expect(state.nextEdgeSequence).toBe(4);
    });

    it('rejects non-canonical edges without consuming a sequence', () => {
        const state = createPlayerInputState();

        expect(enqueueInputEdge(state, {
            tick: 0, subframe: 0, action: 'hardDrop', phase: 'up',
        })).toBeNull();
        expect(enqueueInputEdge(state, {
            tick: 0, subframe: 0, action: 'move', value: 0, phase: 'down',
        })).toBeNull();
        expect(enqueueInputEdge(state, {
            subframe: 0, action: 'move', value: -1, phase: 'down',
        })).toBeNull();
        expect(enqueueInputEdge(state, {
            tick: Number.NaN, subframe: 0, action: 'move', value: -1, phase: 'down',
        })).toBeNull();
        expect(enqueueInputEdge(state, {
            tick: Number.POSITIVE_INFINITY, subframe: 0, action: 'move', value: -1, phase: 'down',
        })).toBeNull();
        expect(state.nextEdgeSequence).toBe(0);
    });

    it.each(['left', 'right', 'flip'])('round-trips the live %s rotation command', (value) => {
        const state = createPlayerInputState();
        expect(enqueueInputEdge(state, {
            tick: 3, subframe: 1, action: 'rotate', value, phase: 'down',
        })).toMatchObject({ action: 'rotate', value });
        expect(drainInputEdgesThroughTick(state, 3)[0].value).toBe(value);
    });

    it('fails closed on queue overflow so a lost release cannot leave a hold active', () => {
        const state = createPlayerInputState();
        startDas(state.das.moveLeft);
        for (let index = 0; index < PLAYER_INPUT_EDGE_CAPACITY; index += 1) {
            enqueueInputEdge(state, {
                tick: index,
                subframe: 0,
                action: 'move',
                value: index % 2 === 0 ? -1 : 1,
                phase: 'down',
            });
        }

        expect(enqueueInputEdge(state, {
            tick: 65, subframe: 0, action: 'move', value: -1, phase: 'up',
        })).toBeNull();
        expect(state.pendingEdges).toEqual([]);
        expect(state.das.moveLeft.active).toBe(false);
        expect(state.overflowCount).toBe(1);
        expect(state.nextEdgeSequence).toBe(PLAYER_INPUT_EDGE_CAPACITY);
    });

    it('does not flush a full valid queue when the next candidate is malformed', () => {
        const state = createPlayerInputState();
        for (let index = 0; index < PLAYER_INPUT_EDGE_CAPACITY; index += 1) {
            enqueueInputEdge(state, {
                tick: index,
                subframe: 0,
                action: 'softDrop',
                phase: 'down',
            });
        }

        expect(enqueueInputEdge(state, {
            tick: 65, subframe: 0, action: 'hardDrop', phase: 'up',
        })).toBeNull();
        expect(state.pendingEdges).toHaveLength(PLAYER_INPUT_EDGE_CAPACITY);
        expect(state.overflowCount).toBe(0);
    });

    it('clears and resets in place with distinct sequence semantics', () => {
        const state = createPlayerInputState({ dasDelay: 80 });
        const identity = state;
        startDas(state.das.moveRight);
        state.das.moveRight.delayAccumulator = 42;
        enqueueInputEdge(state, {
            tick: 1, subframe: 0, action: 'move', value: 1, phase: 'up',
        });

        clearPlayerInput(state);
        expect(state).toBe(identity);
        expect(state.config.dasDelay).toBe(80);
        expect(state.nextEdgeSequence).toBe(1);
        expect(state.das.moveRight).toEqual({
            active: false,
            delayAccumulator: 0,
            intervalAccumulator: 0,
            isRepeating: false,
            clock: 'input60k',
        });

        state.overflowCount = 3;
        resetPlayerInputState(state);
        expect(state).toBe(identity);
        expect(state.config.dasDelay).toBe(80);
        expect(state.nextEdgeSequence).toBe(0);
        expect(state.overflowCount).toBe(0);
    });

    it('deep-restores active accumulators, config, edges, and sequence in place', () => {
        const source = createPlayerInputState({ dasDelay: 70, dasInterval: 15 });
        startDas(source.das.moveLeft);
        source.das.moveLeft.delayAccumulator = 55;
        source.das.softDrop.active = true;
        source.das.softDrop.intervalAccumulator = 9;
        enqueueInputEdge(source, {
            tick: 7, subframe: 2, action: 'move', value: -1, phase: 'up',
        });
        source.overflowCount = 2;

        const target = createPlayerInputState();
        const identity = target;
        restorePlayerInputState(target, structuredClone(source));

        expect(target).toBe(identity);
        expect(target).toEqual(source);
        source.config.dasDelay = 999;
        source.pendingEdges[0].tick = 999;
        expect(target.config.dasDelay).toBe(70);
        expect(target.pendingEdges[0].tick).toBe(7);

        updateInputHandlingConfig(target, { dasInterval: 0 });
        expect(target.config).toEqual({
            dasDelay: 70,
            dasInterval: 0,
            softDropInterval: 50,
        });
    });

    it('fails closed when a restored edge is malformed', () => {
        const target = createPlayerInputState({ dasDelay: 77 });
        const snapshot = structuredClone(target);
        snapshot.das.moveLeft.active = true;
        snapshot.pendingEdges = [{
            tick: Number.NaN,
            subframe: 0,
            sequence: 4,
            action: 'move',
            value: -1,
            phase: 'up',
        }];

        restorePlayerInputState(target, snapshot);

        expect(target.config.dasDelay).toBe(77);
        expect(target.das.moveLeft.active).toBe(false);
        expect(target.pendingEdges).toEqual([]);
        expect(target.overflowCount).toBe(1);
    });

    it('rejects unbranded clocks and missing or duplicate restored sequences', () => {
        const assertRejected = (mutate) => {
            const target = createPlayerInputState();
            const snapshot = structuredClone(target);
            startDas(snapshot.das.moveLeft);
            mutate(snapshot);

            restorePlayerInputState(target, snapshot);

            expect(target.das.moveLeft.active).toBe(false);
            expect(target.pendingEdges).toEqual([]);
            expect(target.overflowCount).toBe(1);
        };

        assertRejected((snapshot) => { delete snapshot.clock; });
        assertRejected((snapshot) => {
            snapshot.pendingEdges = [{
                tick: 1,
                subframe: 0,
                action: 'move',
                value: -1,
                phase: 'up',
            }];
        });
        assertRejected((snapshot) => {
            snapshot.pendingEdges = [
                {
                    tick: 1,
                    subframe: 0,
                    sequence: 2,
                    action: 'move',
                    value: -1,
                    phase: 'down',
                },
                {
                    tick: 1,
                    subframe: 0,
                    sequence: 2,
                    action: 'move',
                    value: -1,
                    phase: 'up',
                },
            ];
        });
    });

    it('GameState.reset clears input in place while preserving handling', () => {
        const gameState = new GameState({ inputHandling: { dasDelay: 66 } });
        const identity = gameState.playerInput;
        startDas(gameState.playerInput.das.moveRight);
        enqueueInputEdge(gameState.playerInput, {
            tick: 2, subframe: 0, action: 'move', value: 1, phase: 'up',
        });
        gameState.playerInput.overflowCount = 2;

        gameState.reset();

        expect(gameState.playerInput).toBe(identity);
        expect(gameState.playerInput.config.dasDelay).toBe(66);
        expect(gameState.playerInput.das.moveRight.active).toBe(false);
        expect(gameState.playerInput.pendingEdges).toEqual([]);
        expect(gameState.playerInput.nextEdgeSequence).toBe(0);
        expect(gameState.playerInput.overflowCount).toBe(0);
    });

    it('advances repeats as integer tick counters with quantized handling', () => {
        const state = createPlayerInputState({
            dasDelay: 120,
            dasInterval: 40,
            softDropInterval: 50,
        });
        enqueueInputEdge(state, {
            tick: 1, subframe: 2, action: 'move', value: -1, phase: 'down',
        });
        enqueueInputEdge(state, {
            tick: 18, subframe: 2, action: 'move', value: -1, phase: 'up',
        });
        const commands = [];

        for (let tick = 1; tick <= 20; tick += 1) {
            advancePlayerInputTick(state, {
                tick,
                tickMs: 1000 / 60,
                emit: (command) => {
                    commands.push(command);
                    return true;
                },
            });
            expect(Number.isInteger(state.das.moveLeft.delayAccumulator)).toBe(true);
            expect(Number.isInteger(state.das.moveLeft.intervalAccumulator)).toBe(true);
        }

        expect(commands.map((command) => [command.tick, command.source])).toEqual([
            [1, 'edge'],
            [8, 'repeat'],
            [10, 'repeat'],
            [12, 'repeat'],
            [15, 'repeat'],
            [17, 'repeat'],
        ]);
        expect(state.das.moveLeft.active).toBe(false);
    });
});
