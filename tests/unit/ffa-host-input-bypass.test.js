/**
 * @fileoverview Pinning tests for P0-1 (ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18
 * §2.1): on the legacy (live default) clock, the HOST'S OWN input must bypass
 * the host-side jitter buffer and apply synchronously inside sendInput —
 * buffering it cost the host ~2-3 display frames of self-latency while peers
 * predict locally. Remote peers' inputs MUST keep buffering, and a bypassed
 * input must never double-apply on a later tick advance. The dark fixed-tick
 * path keeps buffering host input (tick-aligned application) — pinned too.
 */

import {
    describe, expect, it, vi,
} from 'vitest';
import { GameState } from '../../src/core/game.js';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { InputJitterBuffer } from '../../src/core/network/input-jitter-buffer.js';

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

function createPlayer(name) {
    const gameState = new GameState();
    gameState.currentPiece = createPiece();
    gameState.hitStopRemaining = 0;
    return {
        name, isAlive: true, lastInputSeq: 0, gameState,
    };
}

function createHostState(overrides = {}) {
    const host = createPlayer('Host');
    const remote = createPlayer('Remote');
    const state = Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: true,
        isSpectator: false,
        resyncInputFrozen: false,
        gamePhase: 'playing',
        _fixedTickEnabled: false,
        _adaptiveInputJitterEnabled: false,
        localPlayerId: 'HOST',
        useJitterBuffer: true,
        inputJitterBuffer: new InputJitterBuffer({
            bufferDepth: 2, tickRate: 30, adaptive: false,
        }),
        players: new Map([['HOST', host], ['REMOTE', remote]]),
        inputValidator: {
            validateInput: vi.fn(() => ({ valid: true })),
            trackInput: vi.fn(),
        },
        _recordNetEvent: vi.fn(),
        buildRemotePlayerCallbacks: vi.fn(() => ({})),
        buildPhysicsCallbacks: vi.fn(() => ({})),
        renderAllPlayers: vi.fn(),
        ...overrides,
    });
    return { state, host, remote };
}

const TICK_MS = 1000 / 30;

describe('FFA host-local input bypasses the jitter buffer (§2.1)', () => {
    it('applies the host\'s own sendInput synchronously, without touching the buffer', () => {
        const { state, host } = createHostState();
        const addInput = vi.spyOn(state.inputJitterBuffer, 'addInput');

        state.sendInput('move', { direction: -1 });

        // Piece moved DURING the call — no buffer, no tick wait.
        expect(host.gameState.currentPiece.x).toBe(3);
        expect(addInput).not.toHaveBeenCalled();
        expect(state.inputJitterBuffer.getPlayerBufferStatus('HOST').pendingInputs).toBe(0);
        expect(state._recordNetEvent).toHaveBeenCalledWith('input_applied', expect.objectContaining({
            steamId: 'HOST',
            buffered: false,
        }));
        // Local (full) callbacks were used, not the remote-player set.
        expect(state.buildPhysicsCallbacks).toHaveBeenCalledWith('HOST');
        expect(state.buildRemotePlayerCallbacks).not.toHaveBeenCalled();
    });

    it('never double-applies a bypassed input on later tick advances', () => {
        const { state, host } = createHostState();

        state.sendInput('move', { direction: -1 });
        expect(host.gameState.currentPiece.x).toBe(3);

        // Advance well past bufferDepth (150ms -> capped 4 wall-clock ticks).
        state.processBufferedInputs(150);
        state.processBufferedInputs(150);

        expect(host.gameState.currentPiece.x).toBe(3); // applied exactly once
    });

    it('runs inputValidator.trackInput exactly once for a bypassed input', () => {
        const { state } = createHostState();

        state.sendInput('move', { direction: -1 });
        state.processBufferedInputs(150);

        const hostTracks = state.inputValidator.trackInput.mock.calls
            .filter(([steamId]) => steamId === 'HOST');
        expect(hostTracks).toHaveLength(1);
    });

    it('still buffers a remote peer\'s input and applies it only after tick advances', () => {
        const { state, remote } = createHostState();

        state.processPlayerInput('REMOTE', 'move', { direction: -1, seq: 1 }, 1234);

        // NOT applied synchronously — parked in the buffer.
        expect(remote.gameState.currentPiece.x).toBe(4);
        expect(state.inputJitterBuffer.getPlayerBufferStatus('REMOTE').pendingInputs).toBe(1);

        // Scheduled at currentTick(0); cursor starts at -bufferDepth(-2): two
        // wall-clock ticks reach it, the third drains it.
        state.processBufferedInputs(TICK_MS);
        state.processBufferedInputs(TICK_MS);
        expect(remote.gameState.currentPiece.x).toBe(4); // still waiting
        state.processBufferedInputs(TICK_MS);

        expect(remote.gameState.currentPiece.x).toBe(3);
        expect(remote.lastInputSeq).toBe(1); // acked on the buffered-apply path
        // Applied exactly once — further advances change nothing.
        state.processBufferedInputs(150);
        expect(remote.gameState.currentPiece.x).toBe(3);
    });

    it('keeps buffering the host\'s own input on the dark fixed-tick path', () => {
        const { state, host } = createHostState({ _fixedTickEnabled: true });
        const addInput = vi.spyOn(state.inputJitterBuffer, 'addInput');

        state.sendInput('move', { direction: -1 });

        expect(addInput).toHaveBeenCalledTimes(1);
        expect(host.gameState.currentPiece.x).toBe(4); // not applied in-call
    });
});
