import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function createLoopMock(callOrder) {
    return {
        onRender: null,
        onUpdate: null,
        clearPlayers: vi.fn(() => callOrder.push('clearPlayers')),
        registerPlayer: vi.fn(() => callOrder.push('registerPlayer')),
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
    state.localPlayerId = 'local-player';
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
    state.renderAllPlayers = vi.fn(() => callOrder.push('render'));
    state.syncUnifiedLoopPlayers = vi.fn(() => callOrder.push('syncUnifiedLoopPlayers'));
    state.buildLocalPredictionCallbacks = vi.fn(() => ({ prediction: true }));
    state.stopStateSyncLoop = vi.fn(() => callOrder.push('stopStateSyncLoop'));
    state.inputValidator = { reset: vi.fn(() => callOrder.push('inputValidator.reset')) };
    state.fragTracker = { reset: vi.fn(() => callOrder.push('fragTracker.reset')) };
    state.attackRouter = { clearHistory: vi.fn(() => callOrder.push('attackRouter.clearHistory')) };
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

        expect(callOrder).toEqual(['advance', 'buffer', 'update']);
        expect(state.localInputHooks.advance).toHaveBeenCalledWith(1000, 16);
        expect(state.processBufferedInputs).toHaveBeenCalledOnce();
        expect(state.updateAllPlayers).toHaveBeenCalledWith(16);
        expect(state.flushInputBatch).not.toHaveBeenCalled();
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

    it('resets held input during cleanup and clears hook references', () => {
        const { state, callOrder } = createBareGameState({ isHost: true });
        state.loopRunning = true;

        state.cleanup();

        expect(callOrder).toContain('stop');
        expect(callOrder).toContain('reset');
        expect(callOrder).toContain('clearPlayers');
        expect(callOrder).toContain('stopStateSyncLoop');
        expect(state.localInputHooks).toEqual({ advance: null, reset: null });
        expect(state.players.size).toBe(0);
        expect(state.gamePhase).toBe('waiting');
        expect(state.winner).toBeNull();
    });
});
