import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

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

function createState({
    hitStopRemaining = 30,
    isHost = true,
    fixedTickEnabled = true,
} = {}) {
    const gameState = new GameState();
    gameState.currentPiece = createPiece();
    gameState.hitStopRemaining = hitStopRemaining;
    const player = {
        name: 'Peer',
        isAlive: true,
        lastInputSeq: 0,
        gameState,
    };
    const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost,
        _fixedTickEnabled: fixedTickEnabled,
        localPlayerId: 'HOST',
        players: new Map([['PEER', player]]),
        _recordNetEvent: vi.fn(),
        buildRemotePlayerCallbacks: vi.fn(() => ({})),
        buildPhysicsCallbacks: vi.fn(() => ({})),
    });
    return { state, player, gameState };
}

describe('FFA deterministic hit-stop input policy', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        ['move', { direction: -1, seq: 1 }],
        ['rotate', { direction: 'left', seq: 2 }],
        ['drop', { type: 'soft', seq: 3 }],
        ['drop', { type: 'hard', seq: 4 }],
    ])('rejects %s without mutating the frozen player', (inputType, data) => {
        const { state, player, gameState } = createState();
        const pieceBefore = structuredClone(gameState.currentPiece);

        expect(state._applyInputToPlayer('PEER', inputType, data, {})).toBe(false);

        expect(gameState.currentPiece).toEqual(pieceBefore);
        expect(gameState.inputQueue).toBeNull();
        expect(player.lastInputSeq).toBe(data.seq);
        expect(state._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER',
            inputType,
            seq: data.seq,
            reason: 'hit_stop',
        });
    });

    it('gives hit-stop precedence over the physics-busy move queue', () => {
        const { state, gameState } = createState();
        gameState.isProcessingPhysics = true;

        expect(state._applyInputToPlayer('PEER', 'move', { direction: -1, seq: 7 }, {}))
            .toBe(false);
        expect(gameState.inputQueue).toBeNull();
    });

    it('applies the same move on the first thawed tick', () => {
        const { state, gameState } = createState({ hitStopRemaining: 0 });

        expect(state._applyInputToPlayer('PEER', 'move', { direction: -1, seq: 1 }, {}))
            .toBe(true);
        expect(gameState.currentPiece.x).toBe(3);
    });

    it('blocks direct input-phase repeats after a synchronous spawn', () => {
        const { state, gameState } = createState({ hitStopRemaining: 0 });
        gameState._fixedInputSpawnFrame = gameState.simFrame;

        expect(state._applyInputToPlayer(
            'PEER',
            'move',
            { direction: -1 },
            {},
            { fixedTick: true, inputPhase: true },
        )).toBe(false);
        expect(gameState.currentPiece.x).toBe(4);

        expect(state._applyInputToPlayer(
            'PEER',
            'move',
            { direction: -1 },
            {},
            { fixedTick: true },
        )).toBe(true);
        expect(gameState.currentPiece.x).toBe(3);
    });

    it('preserves legacy delayed-input behavior while hit-stop is active', () => {
        const { state, gameState } = createState({ fixedTickEnabled: false });

        expect(state._applyInputToPlayer('PEER', 'move', { direction: -1, seq: 1 }, {}))
            .toBe(true);
        expect(gameState.currentPiece.x).toBe(3);
        expect(state._recordNetEvent).not.toHaveBeenCalledWith(
            'input_rejected',
            expect.objectContaining({ reason: 'hit_stop' }),
        );
    });

    it('rejects a delayed jitter-buffer input on the host and acknowledges its sequence', () => {
        const { state, player, gameState } = createState();
        state.useJitterBuffer = true;
        state.inputValidator = { trackInput: vi.fn() };
        state.inputJitterBuffer = {
            getInputsForTick: vi.fn(() => new Map([['PEER', [{
                type: 'move',
                data: { direction: -1, seq: 9 },
                _tick: 42,
            }]]])),
            advanceTick: vi.fn(),
        };

        state.processBufferedInputs();

        expect(gameState.currentPiece.x).toBe(4);
        expect(player.lastInputSeq).toBe(9);
        expect(state._recordNetEvent).toHaveBeenCalledWith('input_rejected', expect.objectContaining({
            steamId: 'PEER',
            seq: 9,
            reason: 'hit_stop',
        }));
        expect(state.inputJitterBuffer.advanceTick).toHaveBeenCalledOnce();
    });

    it.each([
        ['onHardDrop', [{}], 30],
        ['onLineClearImpact', [4], 70],
        ['onPerfectClear', [1, 1000], 110],
    ])('keeps %s deterministic under reduced motion in fixed mode', (name, args, expected) => {
        vi.stubGlobal('window', {
            settingsManager: { get: () => ({ reducedMotion: true }) },
            matchMedia: () => ({ matches: true }),
        });
        const { state, gameState } = createState({ hitStopRemaining: 0 });
        state._fixedTickEnabled = true;
        const callbacks = FFAGameStateP2P.prototype.buildPhysicsCallbacks.call(state, 'PEER');

        callbacks[name](...args);

        expect(gameState.hitStopRemaining).toBe(expected);
    });

    it('preserves reduced-motion suppression on the legacy rollback path', () => {
        vi.stubGlobal('window', {
            settingsManager: { get: () => ({ reducedMotion: true }) },
            matchMedia: () => ({ matches: true }),
        });
        const { state, gameState } = createState({
            hitStopRemaining: 0,
            fixedTickEnabled: false,
        });

        FFAGameStateP2P.prototype.buildPhysicsCallbacks.call(state, 'PEER').onHardDrop({});

        expect(gameState.hitStopRemaining).toBe(0);
    });
});
