import {
    describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import {
    createFfaFixedInputAdapter,
    finishFfaFixedBufferedInputs,
    takeFfaFixedBufferedInputs,
} from '../../src/core/multiplayer/ffa-fixed-input-adapter.js';
import { runFfaFixedTicks } from '../../src/core/multiplayer/ffa-fixed-tick-runner.js';
import { resetFfaFixedClockProjection } from '../../src/core/multiplayer/ffa-fixed-tick-policy.js';
import { computeFfaJoinSyncpoint } from '../../src/core/multiplayer/ffa/join-syncpoint.js';
import { processFfaInputBatch } from '../../src/core/multiplayer/ffa-input-batching.js';
import { UnifiedMultiplayerLoop } from '../../src/core/multiplayer/unified-game-loop.js';
import { advanceTick, INPUT_DISPOSITIONS } from '../../src/core/simulation-tick.js';

function createPiece() {
    return {
        type: 'O',
        shapeKey: 'O',
        shape: [[1]],
        color: '#fff',
        x: 4,
        y: 0,
        rotation: 0,
    };
}

function createHarness({ local = false } = {}) {
    const gameState = new GameState();
    gameState.currentPiece = createPiece();
    gameState.dropInterval = 100000;
    const player = {
        isAlive: true,
        lastInputSeq: 0,
        gameState,
    };
    const playerId = 'PEER';
    const order = [];
    const game = {
        isHost: true,
        _fixedTickEnabled: true,
        localPlayerId: local ? playerId : 'HOST',
        players: new Map([[playerId, player]]),
        inputValidator: { trackInput: vi.fn() },
        buildPhysicsCallbacks: vi.fn(() => ({ local: true })),
        buildRemotePlayerCallbacks: vi.fn(() => ({ remote: true })),
        _recordNetEvent: vi.fn(),
        _fixedInputTimeMs: 0,
        _activeFixedInputStamp: null,
        localInputHooks: {
            advance: vi.fn(() => order.push('held')),
        },
        _applyInputToPlayer: vi.fn((_id, inputType, data) => {
            order.push(`apply:${inputType}`);
            if (gameState.isProcessingPhysics || !gameState.currentPiece) {
                if (inputType === 'move' || inputType === 'rotate') {
                    gameState.inputQueue = { type: inputType, dir: data.direction };
                }
                return false;
            }
            if (inputType === 'move') gameState.currentPiece.x += data.direction;
            return true;
        }),
    };
    return {
        game, gameState, order, player, playerId,
    };
}

function runAdapterTick(game, gameState, playerId, adapter, advancePhysics = vi.fn()) {
    const result = advanceTick(gameState, {
        advanceInput: (context) => adapter.advanceInput(playerId, context),
        applyInput: (command) => adapter.applyInput(playerId, command),
        advancePhysics,
    });
    adapter.onTickResult(playerId, result);
    return result;
}

describe('FFA fixed buffered input adapter', () => {
    it('applies after clock/blind advancement and before physics, then acknowledges once', () => {
        const {
            game, gameState, order, player, playerId,
        } = createHarness({ local: true });
        gameState.blindTimers.pending = 1;
        gameState.blindTimers.pendingMax = 1;
        player.lastInputSeq = 8;
        game._applyInputToPlayer.mockImplementation((_id, inputType, data) => {
            order.push(`apply:${gameState.simFrame}:${gameState.blindTimers.pendingTicks}:${gameState.currentPiece.y}`);
            gameState.currentPiece.x += data.direction;
            return inputType === 'move';
        });
        const bufferedInput = {
            type: 'move',
            data: { direction: -1, seq: 9 },
            _tick: 42,
        };
        const adapter = createFfaFixedInputAdapter(game, {
            bufferedInputs: new Map([[playerId, [bufferedInput]]]),
        });
        const advancePhysics = vi.fn(() => order.push(`physics:${gameState.currentPiece.x}`));

        const result = runAdapterTick(game, gameState, playerId, adapter, advancePhysics);

        expect(order).toEqual(['apply:1:59:0', 'held', 'physics:3']);
        expect(result.input.map((entry) => entry.disposition)).toEqual([
            INPUT_DISPOSITIONS.APPLIED,
        ]);
        expect(player.lastInputSeq).toBe(9);
        expect(game.inputValidator.trackInput).toHaveBeenCalledWith(
            playerId,
            'move',
            bufferedInput.data,
        );
        expect(game._applyInputToPlayer).toHaveBeenCalledWith(
            playerId,
            'move',
            { direction: -1 },
            { local: true },
            { fixedTick: true, inputPhase: true },
        );
        expect(game._recordNetEvent).toHaveBeenCalledWith('input_applied', {
            steamId: playerId,
            inputType: 'move',
            seq: 9,
            buffered: true,
            tick: 42,
        });
        expect(game.buildPhysicsCallbacks).toHaveBeenCalledWith(playerId);
        expect(game.buildRemotePlayerCallbacks).not.toHaveBeenCalled();
    });

    it('reports physics-busy moves as deferred and drops as rejected', () => {
        const {
            game, gameState, player, playerId,
        } = createHarness();
        gameState.isProcessingPhysics = true;
        const adapter = createFfaFixedInputAdapter(game, {
            bufferedInputs: new Map([[playerId, [
                { type: 'move', data: { direction: -1, seq: 1 }, _tick: 3 },
                { type: 'drop', data: { type: 'hard', seq: 2 }, _tick: 3 },
            ]]]),
        });

        const result = runAdapterTick(game, gameState, playerId, adapter);

        expect(result.input.map((entry) => entry.disposition)).toEqual([
            INPUT_DISPOSITIONS.DEFERRED_PHYSICS,
            INPUT_DISPOSITIONS.REJECTED_PHYSICS,
        ]);
        expect(gameState.inputQueue).toEqual({ type: 'move', dir: -1 });
        expect(player.lastInputSeq).toBe(2);
        expect(game._recordNetEvent).toHaveBeenCalledWith('input_deferred', {
            steamId: playerId,
            inputType: 'move',
            seq: 1,
            reason: 'physics_busy',
        });
        expect(game._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: playerId,
            inputType: 'drop',
            seq: 2,
            reason: 'physics_busy',
        });
        expect(game._recordNetEvent).not.toHaveBeenCalledWith(
            'input_applied',
            expect.anything(),
        );
    });

    it('acknowledges a hit-stop rejection without invoking the FFA mutator', () => {
        const {
            game, gameState, player, playerId,
        } = createHarness();
        gameState.hitStopRemaining = 30;
        player.lastInputSeq = 6;
        const adapter = createFfaFixedInputAdapter(game, {
            bufferedInputs: new Map([[playerId, [{
                type: 'move', data: { direction: -1, seq: 7 }, _tick: 11,
            }]]]),
        });
        const advancePhysics = vi.fn();

        const result = runAdapterTick(game, gameState, playerId, adapter, advancePhysics);

        expect(result.input[0].disposition).toBe(INPUT_DISPOSITIONS.REJECTED_HIT_STOP);
        expect(game._applyInputToPlayer).not.toHaveBeenCalled();
        expect(player.lastInputSeq).toBe(7);
        expect(game._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: playerId,
            inputType: 'move',
            seq: 7,
            reason: 'hit_stop',
        });
        expect(advancePhysics).not.toHaveBeenCalled();
    });

    it('keeps same-tick command order when an applied command creates hit-stop', () => {
        const {
            game, gameState, player, playerId,
        } = createHarness();
        player.lastInputSeq = 3;
        game._applyInputToPlayer.mockImplementation((_id, inputType, data) => {
            if (inputType === 'drop' && data.type === 'hard') {
                gameState.hitStopRemaining = 30;
                return true;
            }
            throw new Error('later command must be rejected before mutation');
        });
        const adapter = createFfaFixedInputAdapter(game, {
            bufferedInputs: new Map([[playerId, [
                { type: 'drop', data: { type: 'hard', seq: 4 }, _tick: 8 },
                { type: 'move', data: { direction: 1, seq: 5 }, _tick: 8 },
            ]]]),
        });

        const result = runAdapterTick(game, gameState, playerId, adapter);

        expect(result.input.map((entry) => entry.disposition)).toEqual([
            INPUT_DISPOSITIONS.APPLIED,
            INPUT_DISPOSITIONS.REJECTED_HIT_STOP,
        ]);
        expect(game._applyInputToPlayer).toHaveBeenCalledOnce();
        expect(player.lastInputSeq).toBe(5);
    });

    it('routes an unbuffered local command through the fixed producer hook exactly once', () => {
        const {
            game, gameState, playerId,
        } = createHarness({ local: true });
        const command = {
            tick: 1,
            subframe: 0,
            source: 'edge',
            edgeSequence: 1,
            action: 'move',
            value: -1,
        };
        game.localInputHooks.advanceFixed = vi.fn((context) => context.emit(command));
        game.localInputHooks.applyFixed = vi.fn(() => true);
        const adapter = createFfaFixedInputAdapter(game);

        const result = runAdapterTick(game, gameState, playerId, adapter);

        expect(game.localInputHooks.advanceFixed).toHaveBeenCalledOnce();
        expect(game.localInputHooks.applyFixed).toHaveBeenCalledOnce();
        expect(game.localInputHooks.applyFixed).toHaveBeenCalledWith(command);
        expect(game._applyInputToPlayer).not.toHaveBeenCalled();
        expect(result.input[0].disposition).toBe(INPUT_DISPOSITIONS.APPLIED);
    });

    it('skips malformed buffered entries and still applies the next valid command', () => {
        const {
            game, gameState, player, playerId,
        } = createHarness();
        player.lastInputSeq = 2;
        const validInput = {
            type: 'move', data: { direction: 1, seq: 3 }, _tick: 2,
        };
        const adapter = createFfaFixedInputAdapter(game, {
            bufferedInputs: new Map([[playerId, [null, {}, validInput]]]),
        });

        const result = runAdapterTick(game, gameState, playerId, adapter);

        expect(result.input).toHaveLength(1);
        expect(result.input[0].disposition).toBe(INPUT_DISPOSITIONS.APPLIED);
        expect(game._applyInputToPlayer).toHaveBeenCalledOnce();
        expect(game.inputValidator.trackInput).toHaveBeenCalledOnce();
        expect(game.inputValidator.trackInput).toHaveBeenCalledWith(
            playerId,
            validInput.type,
            validInput.data,
        );
        expect(player.lastInputSeq).toBe(3);
    });

    it('takes and advances one jitter frame without applying it early', () => {
        const frame = new Map([['PEER', []]]);
        const game = {
            isHost: true,
            useJitterBuffer: true,
            inputJitterBuffer: {
                getInputsForTick: vi.fn(() => frame),
                advanceTick: vi.fn(),
            },
        };

        const taken = takeFfaFixedBufferedInputs(game);
        expect(taken).toBe(frame);
        expect(game.inputJitterBuffer.advanceTick).not.toHaveBeenCalled();

        finishFfaFixedBufferedInputs(game, taken);
        expect(game.inputJitterBuffer.advanceTick).toHaveBeenCalledOnce();

        finishFfaFixedBufferedInputs(game, null);
        expect(game.inputJitterBuffer.advanceTick).toHaveBeenCalledOnce();
    });

    it('lets the fixed runner apply one host frame inside the board tick', () => {
        const {
            game, gameState, order, playerId,
        } = createHarness();
        const loop = new UnifiedMultiplayerLoop();
        loop.players = [{
            id: playerId,
            state: gameState,
            physics: {},
            sound: null,
        }];
        const frame = new Map([[playerId, [{
            type: 'move', data: { direction: -1, seq: 3 }, _tick: 0,
        }]]]);
        game.unifiedLoop = loop;
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => {
                order.push('take');
                return frame;
            }),
            advanceTick: vi.fn(() => order.push('finish')),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;
        game.updateAllPlayers = vi.fn(() => order.push('bookkeeping'));
        game.attackRouter = { updateHotPotato: vi.fn(() => order.push('hot-potato')) };
        game._applyInputToPlayer.mockImplementation((_id, _type, data) => {
            order.push(`apply:${gameState.simFrame}`);
            gameState.currentPiece.x += data.direction;
            return true;
        });

        expect(runFfaFixedTicks(game, 10, 10)).toBe(1);

        expect(order).toEqual([
            'take', 'apply:1', 'finish', 'bookkeeping', 'hot-potato',
        ]);
        expect(gameState.currentPiece.x).toBe(3);
        expect(game.simTick).toBe(1);
        expect(game.inputJitterBuffer.getInputsForTick).toHaveBeenCalledOnce();
        expect(game.inputJitterBuffer.advanceTick).toHaveBeenCalledOnce();
    });

    it('keeps reentrant resync capture busy through the entire canonical tick', () => {
        const { game } = createHarness();
        const observed = [];
        game.gamePhase = 'playing';
        game.roundGeneration = 0;
        game._networkDispatch = { depth: 0 };
        game.unifiedLoop = {
            runGeneration: 1,
            updatePlayersFixedTick: vi.fn(() => {
                observed.push(computeFfaJoinSyncpoint(game));
            }),
        };
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => new Map()),
            advanceTick: vi.fn(),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 1;
        game._simTickAccumulatorMs = 0;
        game._fixedTickApplicationDepth = 0;
        game.simTick = 0;
        game.updateAllPlayers = vi.fn(() => {
            observed.push(computeFfaJoinSyncpoint(game));
        });
        game._processPendingResyncs = vi.fn(() => {
            observed.push(computeFfaJoinSyncpoint(game));
        });

        expect(runFfaFixedTicks(game, 10, 10)).toBe(1);

        expect(observed.slice(0, 2).map((marker) => marker)).toEqual([
            expect.objectContaining({
                status: 'busy',
                safe: false,
                blockers: [{ kind: 'fixed_tick_application', depth: 1 }],
            }),
            expect.objectContaining({
                status: 'busy',
                safe: false,
                blockers: [{ kind: 'fixed_tick_application', depth: 1 }],
            }),
        ]);
        expect(observed[2]).toEqual(expect.objectContaining({
            status: 'idle', safe: true, blockers: [],
        }));
        expect(game._fixedTickApplicationDepth).toBe(0);
        expect(game._processPendingResyncs).toHaveBeenCalledOnce();
    });

    it('rebases the peer input projection after a same-clock authoritative rewind', () => {
        const { game, playerId } = createHarness({ local: true });
        const observedStamps = [];
        game.isHost = false;
        game.gamePhase = 'playing';
        game.roundGeneration = 2;
        game.simTick = 450;
        game.useJitterBuffer = true;
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 1;
        game._simTickAccumulatorMs = 87;
        game._peerFixedInputSimTick = 500;
        game._fixedInputTimeMs = 9000;
        game._activeFixedInputStamp = { simTick: 500, ordinal: 9 };
        game.localInputHooks.reset = vi.fn();
        game.localInputHooks.advanceFixed = vi.fn(() => {
            observedStamps.push({ ...game._activeFixedInputStamp });
        });
        game.localInputHooks.advance = null;
        game.unifiedLoop = {
            runGeneration: 1,
            updatePlayersFixedTick: vi.fn((adapter) => {
                adapter.advanceInput(playerId, {
                    tick: 451,
                    tickMs: 10,
                    emit: vi.fn(),
                });
            }),
        };

        resetFfaFixedClockProjection(game);

        expect(game._simTickAccumulatorMs).toBe(0);
        expect(game._peerFixedInputSimTick).toBeNull();
        expect(game._fixedInputTimeMs).toBeNull();
        expect(game._activeFixedInputStamp).toBeNull();
        expect(runFfaFixedTicks(game, 10, 10)).toBe(1);
        expect(observedStamps).toEqual([{ simTick: 451, ordinal: 451 }]);
        expect(game._peerFixedInputSimTick).toBe(451);
        expect(game.localInputHooks.reset).toHaveBeenCalledOnce();
    });

    it('rolls back before simulation when fixed tick has no jitter buffer', () => {
        const { game } = createHarness();
        game.unifiedLoop = { updatePlayersFixedTick: vi.fn() };
        game.useJitterBuffer = false;
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game._transitionSimulationClock = vi.fn();

        expect(runFfaFixedTicks(game, 10, 10)).toBe(0);
        expect(game._transitionSimulationClock).toHaveBeenCalledWith('legacy-variable-v1');
        expect(game._recordNetEvent).toHaveBeenCalledWith('fixed_tick_rollback', {
            reason: 'jitter_buffer_required',
        });
        expect(game.unifiedLoop.updatePlayersFixedTick).not.toHaveBeenCalled();
    });

    it('finishes the owned jitter frame and consumes the partial tick before rethrowing', () => {
        const {
            game, gameState, order, playerId,
        } = createHarness();
        const error = new Error('tick failed');
        game.unifiedLoop = {
            updatePlayersFixedTick: vi.fn(() => {
                order.push('tick');
                throw error;
            }),
        };
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => {
                order.push('take');
                return new Map([[playerId, []]]);
            }),
            advanceTick: vi.fn(() => order.push('finish')),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game._fixedTickApplicationDepth = 0;
        game._processPendingInboundResyncApply = vi.fn();
        game._processPendingResyncs = vi.fn();
        game.simTick = 0;
        game.updateAllPlayers = vi.fn(() => order.push('bookkeeping'));
        game.attackRouter = { updateHotPotato: vi.fn(() => order.push('hot-potato')) };

        expect(() => runFfaFixedTicks(game, 10, 10)).toThrow(error);

        expect(order).toEqual(['take', 'tick', 'finish']);
        expect(gameState.simFrame).toBe(0);
        expect(game.simTick).toBe(1);
        expect(game._simTickAccumulatorMs).toBe(0);
        expect(game.inputJitterBuffer.getInputsForTick).toHaveBeenCalledOnce();
        expect(game.inputJitterBuffer.advanceTick).toHaveBeenCalledOnce();
        expect(game.updateAllPlayers).not.toHaveBeenCalled();
        expect(game.attackRouter.updateHotPotato).not.toHaveBeenCalled();
        expect(game._fixedTickApplicationDepth).toBe(0);
        expect(game._processPendingInboundResyncApply).not.toHaveBeenCalled();
        expect(game._processPendingResyncs).not.toHaveBeenCalled();
    });

    it('records discarded wall-time debt before a canonical tick can throw', () => {
        const { game } = createHarness();
        const error = new Error('tick failed');
        game.unifiedLoop = {
            updatePlayersFixedTick: vi.fn(() => {
                throw error;
            }),
        };
        game.useJitterBuffer = true;
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;

        expect(() => runFfaFixedTicks(game, 1000, 1000)).toThrow(error);

        expect(game._recordNetEvent).toHaveBeenCalledWith('sim_clock_warp', {
            requestedDebtMs: 1000,
            retainedDebtMs: 300,
            warpedMs: 700,
            maxDebtMs: 300,
            maxSteps: 5,
            tickMs: 10,
        });
        expect(game.simTick).toBe(1);
        expect(game._simTickAccumulatorMs).toBe(290);
    });

    it('does not start or consume a tick when jitter-frame ingress throws', () => {
        const { game } = createHarness();
        const error = new Error('take failed');
        game.unifiedLoop = { updatePlayersFixedTick: vi.fn() };
        game.useJitterBuffer = true;
        game.inputJitterBuffer = { getInputsForTick: vi.fn(() => { throw error; }) };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;

        expect(() => runFfaFixedTicks(game, 10, 10)).toThrow(error);

        expect(game.simTick).toBe(0);
        expect(game._simTickAccumulatorMs).toBe(10);
        expect(game.unifiedLoop.updatePlayersFixedTick).not.toHaveBeenCalled();
    });

    it('consumes an applied tick even when jitter-frame finalization throws', () => {
        const { game } = createHarness();
        const error = new Error('finish failed');
        game.unifiedLoop = { updatePlayersFixedTick: vi.fn() };
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => new Map()),
            advanceTick: vi.fn(() => { throw error; }),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;

        expect(() => runFfaFixedTicks(game, 10, 10)).toThrow(error);

        expect(game.simTick).toBe(1);
        expect(game._simTickAccumulatorMs).toBe(0);
        expect(game.unifiedLoop.updatePlayersFixedTick).toHaveBeenCalledOnce();
    });

    it('stops a catch-up plan when the first tick ends the match', () => {
        const { game } = createHarness();
        game.gamePhase = 'playing';
        game.unifiedLoop = { updatePlayersFixedTick: vi.fn() };
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => new Map()),
            advanceTick: vi.fn(),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;
        game.updateAllPlayers = vi.fn(() => { game.gamePhase = 'finished'; });

        expect(runFfaFixedTicks(game, 50, 50)).toBe(1);

        expect(game.simTick).toBe(1);
        expect(game._simTickAccumulatorMs).toBe(40);
        expect(game.unifiedLoop.updatePlayersFixedTick).toHaveBeenCalledOnce();
        expect(game.inputJitterBuffer.advanceTick).toHaveBeenCalledOnce();
    });

    it('does not carry old-round debt or input finalization across a synchronous restart', () => {
        const { game } = createHarness();
        game.gamePhase = 'playing';
        game.roundGeneration = 4;
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => new Map()),
            advanceTick: vi.fn(),
        };
        game.unifiedLoop = {
            runGeneration: 7,
            updatePlayersFixedTick: vi.fn((_adapter, shouldContinue) => {
                game.roundGeneration = 5;
                game.unifiedLoop.runGeneration = 9;
                game._simTickAccumulatorMs = 0;
                game.simTick = 0;
                expect(shouldContinue()).toBe(false);
            }),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;
        game.updateAllPlayers = vi.fn();

        expect(runFfaFixedTicks(game, 50, 50)).toBe(1);

        expect(game.unifiedLoop.updatePlayersFixedTick).toHaveBeenCalledOnce();
        expect(game.inputJitterBuffer.advanceTick).not.toHaveBeenCalled();
        expect(game.updateAllPlayers).not.toHaveBeenCalled();
        expect(game.simTick).toBe(0);
        expect(game._simTickAccumulatorMs).toBe(0);
    });

    it('stops the real adapter batch and held-input hooks at a synchronous restart', () => {
        const {
            game, gameState, player, playerId,
        } = createHarness({ local: true });
        const loop = new UnifiedMultiplayerLoop();
        loop.runGeneration = 7;
        loop.players = [{
            id: playerId,
            state: gameState,
            physics: {},
            sound: null,
        }];
        game.gamePhase = 'playing';
        game.roundGeneration = 4;
        game.unifiedLoop = loop;
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => new Map([[playerId, [
                { type: 'drop', data: { type: 'hard', seq: 1 }, _tick: 1 },
                { type: 'move', data: { direction: 1, seq: 2 }, _tick: 1 },
            ]]])),
            advanceTick: vi.fn(),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;
        game.updateAllPlayers = vi.fn();
        game.attackRouter = { updateHotPotato: vi.fn() };
        game.localInputHooks.advanceFixed = vi.fn();
        game.localInputHooks.advance = vi.fn();
        game._applyInputToPlayer.mockImplementation(() => {
            game.roundGeneration = 5;
            loop.runGeneration = 8;
            game._fixedInputTimeMs = null;
            game._activeFixedInputStamp = null;
            game._simTickAccumulatorMs = 0;
            game.simTick = 0;
            gameState.simFrame = 0;
            gameState.simTimeMs = 0;
            gameState.lastTime = 0;
            gameState.currentPiece = null;
            gameState.hitStopTicks = 0;
            gameState.hitStopRemaining = 30;
            return true;
        });

        expect(runFfaFixedTicks(game, 50, 50)).toBe(1);

        expect(game._applyInputToPlayer).toHaveBeenCalledOnce();
        expect(game.inputValidator.trackInput).toHaveBeenCalledOnce();
        expect(game.localInputHooks.advanceFixed).not.toHaveBeenCalled();
        expect(game.localInputHooks.advance).not.toHaveBeenCalled();
        expect(game._fixedInputTimeMs).toBeNull();
        expect(game._activeFixedInputStamp).toBeNull();
        expect(gameState.hitStopRemaining).toBe(30);
        expect(gameState.hitStopTicks).toBe(0);
        expect(player.lastInputSeq).toBe(0);
        expect(game.inputJitterBuffer.advanceTick).not.toHaveBeenCalled();
        expect(game.updateAllPlayers).not.toHaveBeenCalled();
    });

    it('does not advance a tick when pending-group drain throws', () => {
        const { game, playerId } = createHarness();
        game.gamePhase = 'playing';
        game.roundGeneration = 0;
        game.unifiedLoop = { updatePlayersFixedTick: vi.fn() };
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            currentTick: 0,
            processCursor: -2,
            clockEpoch: 0,
            getInputsForTick: vi.fn(() => new Map()),
            advanceTick: vi.fn(),
        };
        game.processPlayerInput = vi.fn();
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;
        const packet = (id) => ({
            inputs: [{
                type: 'drop', data: { type: 'soft' }, seq: id, fixedTickOrdinal: id, simTick: id,
            }],
            fixedTickBaseOrdinal: id,
            fixedTickGroupId: id,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });
        for (let id = 1; id <= 34; id += 1) {
            processFfaInputBatch(game, playerId, packet(id), 1000);
        }
        const error = new Error('drain failed');
        game.processPlayerInput.mockImplementation(() => { throw error; });
        game.inputJitterBuffer.currentTick = 1;
        game.inputJitterBuffer.processCursor = -1;

        expect(() => runFfaFixedTicks(game, 10, 10)).toThrow(error);

        expect(game.simTick).toBe(0);
        expect(game._simTickAccumulatorMs).toBe(10);
        expect(game.inputJitterBuffer.getInputsForTick).not.toHaveBeenCalled();
        expect(game.unifiedLoop.updatePlayersFixedTick).not.toHaveBeenCalled();
    });

    it('pins host-held input to the current jitter slot before cursor advance', () => {
        const {
            game, gameState, order, playerId,
        } = createHarness({ local: true });
        const loop = new UnifiedMultiplayerLoop();
        loop.players = [{
            id: playerId,
            state: gameState,
            physics: {},
            sound: null,
        }];
        game.unifiedLoop = loop;
        game.useJitterBuffer = true;
        game.inputJitterBuffer = {
            currentTick: 0,
            getInputsForTick: vi.fn(function getInputsForTick() {
                order.push(`take:${this.currentTick}`);
                return new Map([[playerId, []]]);
            }),
            advanceTick: vi.fn(function advanceBufferTick() {
                this.currentTick += 1;
                order.push(`finish:${this.currentTick}`);
            }),
        };
        game.SIM_TICK_MS = 10;
        game.MAX_SIM_STEPS_PER_FRAME = 5;
        game._simTickAccumulatorMs = 0;
        game.simTick = 0;
        game.updateAllPlayers = vi.fn();
        game.attackRouter = { updateHotPotato: vi.fn() };
        game.localInputHooks.advance = vi.fn(() => {
            order.push(`held:${game.inputJitterBuffer.currentTick}`);
        });

        expect(runFfaFixedTicks(game, 20, 20)).toBe(2);

        expect(order).toEqual([
            'take:0', 'held:0', 'finish:1',
            'take:1', 'held:1', 'finish:2',
        ]);
    });
});
