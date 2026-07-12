import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function createLoopMock(callOrder) {
    let fixedTick = 0;
    return {
        onRender: null,
        onUpdate: null,
        externalPlayerUpdate: false,
        clearPlayers: vi.fn(() => callOrder.push('clearPlayers')),
        registerPlayer: vi.fn(() => callOrder.push('registerPlayer')),
        updatePlayers: vi.fn(() => callOrder.push('loopUpdatePlayers')),
        updatePlayersFixedTick: vi.fn((inputAdapter) => {
            callOrder.push('loopUpdatePlayersFixed');
            fixedTick += 1;
            const advanceInput = typeof inputAdapter === 'function'
                ? inputAdapter
                : inputAdapter?.advanceInput;
            advanceInput?.('local-player', { tick: fixedTick, tickMs: 10 });
        }),
        setExternalPlayerUpdate: vi.fn(function setExternalPlayerUpdate(enabled) {
            this.externalPlayerUpdate = enabled === true;
        }),
        start: vi.fn(() => callOrder.push('start')),
        stop: vi.fn(() => callOrder.push('stop')),
    };
}

function createBareGameState({ isHost = false, gamePhase = 'playing' } = {}) {
    const callOrder = [];
    const state = Object.create(FFAGameStateP2P.prototype);

    state.isHost = isHost;
    state.gamePhase = gamePhase;
    state.loopCallbacksConfigured = false;
    state.loopRunning = false;
    state.simTick = 0;
    state._fixedTickEnabled = false;
    state._simTickAccumulatorMs = 0;
    state.SIM_TICK_MS = 1000 / 60;
    state.MAX_SIM_STEPS_PER_FRAME = 5;
    state.localPlayerId = 'local-player';
    state.matchConfig = { simulationClock: 'legacy-variable-v1' };
    state.players = new Map([
        ['local-player', { gameState: { currentPiece: {} } }],
    ]);
    state.localInputHooks = {
        advance: vi.fn(() => callOrder.push('advance')),
        reset: vi.fn(() => callOrder.push('reset')),
    };
    state.unifiedLoop = createLoopMock(callOrder);
    state.flushInputBatch = vi.fn(() => callOrder.push('flush'));
    state.processBufferedInputs = vi.fn(() => callOrder.push('buffer'));
    state.updateAllPlayers = vi.fn(() => callOrder.push('update'));
    state.maybeBroadcastPostPhysics = vi.fn(() => callOrder.push('broadcast'));
    state.renderAllPlayers = vi.fn(() => callOrder.push('render'));
    state.syncUnifiedLoopPlayers = vi.fn(() => callOrder.push('syncUnifiedLoopPlayers'));
    state._recordNetEvent = vi.fn(() => callOrder.push('recordNetEvent'));
    state.buildLocalPredictionCallbacks = vi.fn(() => ({ prediction: true }));
    state.stopStateSyncLoop = vi.fn(() => callOrder.push('stopStateSyncLoop'));
    state.inputValidator = { reset: vi.fn(() => callOrder.push('inputValidator.reset')) };
    state.fragTracker = { reset: vi.fn(() => callOrder.push('fragTracker.reset')) };
    state.attackRouter = {
        clearHistory: vi.fn(() => callOrder.push('attackRouter.clearHistory')),
        updateHotPotato: vi.fn(() => callOrder.push('attackRouter.updateHotPotato')),
    };
    state.setLocalInputHooks = FFAGameStateP2P.prototype.setLocalInputHooks;

    return { state, callOrder };
}

describe('FFAGameStateP2P local input hooks', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('advances held input before flushing peer input batches', () => {
        const { state, callOrder } = createBareGameState({ isHost: false });

        state.configureUnifiedLoopCallbacks();
        state.unifiedLoop.onUpdate(1000, 16);

        expect(callOrder).toEqual(['advance', 'flush']);
        expect(state.localInputHooks.advance).toHaveBeenCalledWith(1000, 16);
        expect(state.flushInputBatch).toHaveBeenCalledOnce();
        expect(state.processBufferedInputs).not.toHaveBeenCalled();
        expect(state.updateAllPlayers).not.toHaveBeenCalled();
    });

    it('advances held input before host-side simulation updates', () => {
        const { state, callOrder } = createBareGameState({ isHost: true });

        state.configureUnifiedLoopCallbacks();
        state.unifiedLoop.onUpdate(1000, 16);

        expect(callOrder).toEqual(['advance', 'buffer', 'update', 'attackRouter.updateHotPotato', 'broadcast']);
        expect(state.localInputHooks.advance).toHaveBeenCalledWith(1000, 16);
        expect(state.processBufferedInputs).toHaveBeenCalledOnce();
        expect(state.updateAllPlayers).toHaveBeenCalledWith();
        expect(state.flushInputBatch).not.toHaveBeenCalled();
        expect(state.simTick).toBe(1);
        expect(state.unifiedLoop.externalPlayerUpdate).toBe(false);
    });

    it('runs host simulation at fixed sim ticks when fixedTick is enabled', () => {
        const { state, callOrder } = createBareGameState({ isHost: true });
        state._fixedTickEnabled = true;
        state.SIM_TICK_MS = 10;
        state.MAX_SIM_STEPS_PER_FRAME = 10;

        state.configureUnifiedLoopCallbacks();
        state.unifiedLoop.onUpdate(1000, 35);

        expect(state.unifiedLoop.externalPlayerUpdate).toBe(true);
        expect(state.simTick).toBe(3);
        expect(state._simTickAccumulatorMs).toBe(5);
        expect(callOrder).toEqual([
            'loopUpdatePlayersFixed', 'advance', 'update', 'attackRouter.updateHotPotato',
            'loopUpdatePlayersFixed', 'advance', 'update', 'attackRouter.updateHotPotato',
            'loopUpdatePlayersFixed', 'advance', 'update', 'attackRouter.updateHotPotato',
            'broadcast',
        ]);
        expect(state.processBufferedInputs).not.toHaveBeenCalled();
        expect(state.unifiedLoop.updatePlayersFixedTick).toHaveBeenCalledTimes(3);
        expect(state.unifiedLoop.updatePlayers).not.toHaveBeenCalled();
        expect(state.updateAllPlayers).toHaveBeenCalledTimes(3);
        expect(state.updateAllPlayers).toHaveBeenNthCalledWith(1);
        expect(state.maybeBroadcastPostPhysics).toHaveBeenCalledOnce();
        expect(state.maybeBroadcastPostPhysics).toHaveBeenCalledWith(35);
    });

    it('runs peer prediction on the same fixed-step clock', () => {
        const { state, callOrder } = createBareGameState({ isHost: false });
        state._fixedTickEnabled = true;
        state.SIM_TICK_MS = 10;
        state.MAX_SIM_STEPS_PER_FRAME = 10;

        state.configureUnifiedLoopCallbacks();
        state.unifiedLoop.onUpdate(1000, 25);

        expect(state.unifiedLoop.externalPlayerUpdate).toBe(true);
        expect(state.simTick).toBe(0);
        expect(state._simTickAccumulatorMs).toBe(5);
        expect(callOrder).toEqual([
            'loopUpdatePlayersFixed', 'advance', 'loopUpdatePlayersFixed', 'advance', 'flush',
        ]);
        expect(state.processBufferedInputs).not.toHaveBeenCalled();
        expect(state.updateAllPlayers).not.toHaveBeenCalled();
    });

    it('stamps peer inputs from separate catch-up ticks distinctly', () => {
        const { state } = createBareGameState({ isHost: false });
        state._fixedTickEnabled = true;
        state.SIM_TICK_MS = 10;
        state.MAX_SIM_STEPS_PER_FRAME = 10;
        state.isSpectator = false;
        state.hostTick = 7;
        state.inputSequence = 0;
        state.pendingInputs = [];
        state.inputHistory = [];
        state._applyLocalPrediction = vi.fn();
        state.localInputHooks.advance = vi.fn(() => {
            state.sendInput('move', { direction: -1 });
        });

        state.configureUnifiedLoopCallbacks();
        state.unifiedLoop.onUpdate(1000, 25);

        expect(state.pendingInputs).toEqual([
            expect.objectContaining({ simTick: 1, fixedTickOrdinal: 1, seq: 1 }),
            expect.objectContaining({ simTick: 2, fixedTickOrdinal: 2, seq: 2 }),
        ]);
        expect(state._applyLocalPrediction).toHaveBeenCalledTimes(2);
        expect(state._applyLocalPrediction).toHaveBeenNthCalledWith(
            1,
            'move',
            { direction: -1 },
        );
        expect(state._activeFixedInputStamp).toBeNull();
        expect(state._peerFixedInputSimTick).toBe(2);
    });

    it('marks peer prediction fixed only while the canonical input stamp is active', () => {
        const { state } = createBareGameState({ isHost: false });
        state._applyInputToPlayer = vi.fn(() => false);

        state._applyLocalPrediction('drop', { type: 'hard' });
        state._activeFixedInputStamp = { simTick: 4, ordinal: 1 };
        state._applyLocalPrediction('drop', { type: 'hard' });

        expect(state._applyInputToPlayer).toHaveBeenNthCalledWith(
            1,
            state.localPlayerId,
            'drop',
            { type: 'hard' },
            { prediction: true },
            undefined,
        );
        expect(state._applyInputToPlayer).toHaveBeenNthCalledWith(
            2,
            state.localPlayerId,
            'drop',
            { type: 'hard' },
            { prediction: true },
            { fixedTick: true, inputPhase: true },
        );
    });

    it('transitions the live loop clock atomically and is idempotent', () => {
        const { state } = createBareGameState({ isHost: false });
        state.loopCallbacksConfigured = true;
        state._simTickAccumulatorMs = 12;
        state._fixedInputTimeMs = 240;
        state._peerFixedInputSimTick = 42;
        state._activeFixedInputStamp = { simTick: 42, ordinal: 9 };

        expect(state._transitionSimulationClock('fixed60-v1')).toBe(true);
        expect(state._fixedTickEnabled).toBe(true);
        expect(state.matchConfig.simulationClock).toBe('fixed60-v1');
        expect(state.unifiedLoop.externalPlayerUpdate).toBe(true);
        expect(state._simTickAccumulatorMs).toBe(0);
        expect(state._fixedInputTimeMs).toBeNull();
        expect(state._peerFixedInputSimTick).toBeNull();
        expect(state._activeFixedInputStamp).toBeNull();
        expect(state.localInputHooks.reset).toHaveBeenCalledOnce();

        state.localInputHooks.reset.mockClear();
        state._simTickAccumulatorMs = 7;
        state._fixedInputTimeMs = 300;

        expect(state._transitionSimulationClock('fixed60-v1')).toBe(false);
        expect(state._simTickAccumulatorMs).toBe(7);
        expect(state._fixedInputTimeMs).toBe(300);
        expect(state.localInputHooks.reset).not.toHaveBeenCalled();
        expect(state.unifiedLoop.externalPlayerUpdate).toBe(true);
    });

    it('adopts the host-stamped simulation clock over the peer-local flag', () => {
        const { state } = createBareGameState({ isHost: false, gamePhase: 'waiting' });
        state._fixedTickEnabled = false;
        state._simTickAccumulatorMs = 9;
        state._fixedInputTimeMs = 120;
        state.isSpectator = true;
        state.matchConfig = {
            endCondition: 'frags',
            endConditionValue: 10,
            simulationClock: 'legacy-variable-v1',
        };
        state._advertiseLobbyState = vi.fn();

        state.startMatch(123, { simulationClock: 'fixed60-v1' }, { inProgress: true });

        expect(state._fixedTickEnabled).toBe(true);
        expect(state.matchConfig.simulationClock).toBe('fixed60-v1');
        expect(state._simTickAccumulatorMs).toBe(0);
        expect(state._fixedInputTimeMs).toBeNull();
        expect(state.localInputHooks.reset).toHaveBeenCalledOnce();
        expect(state.gamePhase).toBe('playing');
    });

    it('retargets a running fixed loop when an authoritative resync rolls back the clock', () => {
        const { state } = createBareGameState({ isHost: false });
        state._fixedTickEnabled = true;
        state.matchConfig.simulationClock = 'fixed60-v1';
        state.loopCallbacksConfigured = true;
        state.loopRunning = true;
        state.unifiedLoop.externalPlayerUpdate = true;
        state._simTickAccumulatorMs = 8;
        state._fixedInputTimeMs = 180;
        state.roundGeneration = 0;
        state._downloadJoinEnabled = false;
        state._applySnapshotState = vi.fn();

        state._applyResyncState({
            matchConfig: { simulationClock: 'legacy-variable-v1' },
            roundGeneration: 0,
            players: [],
        });

        expect(state._fixedTickEnabled).toBe(false);
        expect(state.unifiedLoop.externalPlayerUpdate).toBe(false);
        expect(state._simTickAccumulatorMs).toBe(0);
        expect(state._fixedInputTimeMs).toBeNull();
        expect(state.localInputHooks.reset).toHaveBeenCalledOnce();
        expect(state._applySnapshotState).toHaveBeenCalledOnce();
    });

    it('clamps fixed sim catch-up after a long host frame', () => {
        const { state } = createBareGameState({ isHost: true });
        state._fixedTickEnabled = true;
        state.SIM_TICK_MS = 10;
        state.MAX_SIM_STEPS_PER_FRAME = 2;

        state.configureUnifiedLoopCallbacks();
        state.unifiedLoop.onUpdate(1000, 55);

        expect(state.simTick).toBe(2);
        expect(state.unifiedLoop.updatePlayersFixedTick).toHaveBeenCalledTimes(2);
        expect(state._simTickAccumulatorMs).toBe(10);
        expect(state._recordNetEvent).toHaveBeenCalledWith('sim_tick_clamped', expect.objectContaining({
            maxSteps: 2,
            tickMs: 10,
        }));
    });

    it('falls back to 30 Hz legacy timing when a fixed host is promoted', () => {
        const { state } = createBareGameState({ isHost: false });
        state._fixedTickEnabled = true;
        state._simTickAccumulatorMs = 6;
        state._fixedInputTimeMs = 90;
        state.loopRunning = true;
        state.loopCallbacksConfigured = true;
        state.network = {};
        state._adaptiveInputJitterEnabled = false;
        state.inputJitterBuffer = {
            adaptiveEnabled: true,
            tickRate: 60,
            tickInterval: 1000 / 60,
            clear: vi.fn(),
            addPlayer: vi.fn(),
        };
        state.startHeartbeatLoop = vi.fn();
        state.startStateSyncLoop = vi.fn();

        state.promoteToHost();

        expect(state._fixedTickEnabled).toBe(false);
        expect(state.matchConfig.simulationClock).toBe('legacy-variable-v1');
        expect(state.inputJitterBuffer.tickRate).toBe(30);
        expect(state.inputJitterBuffer.tickInterval).toBe(1000 / 30);
        expect(state.unifiedLoop.externalPlayerUpdate).toBe(false);
        expect(state._simTickAccumulatorMs).toBe(0);
        expect(state._fixedInputTimeMs).toBeNull();
        expect(state.localInputHooks.reset).toHaveBeenCalledOnce();
        expect(state.inputJitterBuffer.clear).toHaveBeenCalledOnce();
        expect(state._recordNetEvent).toHaveBeenCalledWith('fixed_tick_rollback', {
            reason: 'migration_missing_continuation',
        });
    });

    it('does not advance held input outside the playing phase', () => {
        const { state } = createBareGameState({ isHost: false, gamePhase: 'waiting' });

        state.configureUnifiedLoopCallbacks();
        state.unifiedLoop.onUpdate(1000, 16);

        expect(state.localInputHooks.advance).not.toHaveBeenCalled();
        expect(state.flushInputBatch).not.toHaveBeenCalled();
        expect(state.processBufferedInputs).not.toHaveBeenCalled();
        expect(state.updateAllPlayers).not.toHaveBeenCalled();
    });

    it('resets held input before starting the unified loop', () => {
        const { state, callOrder } = createBareGameState({ isHost: false });

        state.startGameLoop();

        expect(callOrder.slice(0, 4)).toEqual(['clearPlayers', 'registerPlayer', 'reset', 'start']);
        expect(state.localInputHooks.reset).toHaveBeenCalledOnce();
        expect(state.unifiedLoop.start).toHaveBeenCalledOnce();
        expect(state.loopRunning).toBe(true);
    });

    it('preserves the peer input projection across a fixed-loop restart', () => {
        const { state } = createBareGameState({ isHost: false });
        state._fixedTickEnabled = true;
        state.SIM_TICK_MS = 10;
        state.simTick = 98;
        state._peerFixedInputSimTick = 100;

        state.startGameLoop();
        expect(state._peerFixedInputSimTick).toBe(100);

        state.unifiedLoop.onUpdate(1000, 10);
        expect(state._peerFixedInputSimTick).toBe(101);
    });

    it('resets held input during cleanup and clears hook references', () => {
        const { state, callOrder } = createBareGameState({ isHost: true });
        state.loopRunning = true;

        state.cleanup();

        expect(callOrder).toContain('stop');
        expect(callOrder).toContain('reset');
        expect(callOrder).toContain('clearPlayers');
        expect(callOrder).toContain('stopStateSyncLoop');
        expect(state.localInputHooks).toEqual({
            advance: null,
            advanceFixed: null,
            applyFixed: null,
            reset: null,
        });
        expect(state.players.size).toBe(0);
        expect(state.gamePhase).toBe('waiting');
        expect(state.winner).toBeNull();
    });
});
