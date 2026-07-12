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
