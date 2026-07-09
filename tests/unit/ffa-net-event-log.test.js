import { describe, expect, it, vi } from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function makeEventLogStub(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: true,
        _netEventLogEnabled: true,
        _netEventLogLimit: 8,
        _netEventLogSeq: 0,
        _netEventLog: [],
        hostTick: 12,
        roundGeneration: 2,
        gamePhase: 'playing',
        ...overrides,
    });
}

describe('FFA host net event log', () => {
    it('records a bounded host-only event ring with compact metadata', () => {
        const state = makeEventLogStub({ _netEventLogLimit: 2 });

        state._recordNetEvent('first', { nested: { keep: true } });
        state._recordNetEvent('second', { list: [1, 2, 3] });
        state._recordNetEvent('third', { fn: () => 'ignored', value: 9 });

        const log = state.getNetEventLogSnapshot();
        expect(log.map((event) => event.type)).toEqual(['second', 'third']);
        expect(log.map((event) => event.id)).toEqual([2, 3]);
        expect(log[1]).toMatchObject({
            tick: 12,
            gen: 2,
            phase: 'playing',
            data: { value: 9 },
        });
        expect(log[1].data.fn).toBeUndefined();
    });

    it('does not record peer-side events', () => {
        const state = makeEventLogStub({ isHost: false });

        expect(state._recordNetEvent('peer_event', {})).toBeNull();
        expect(state.getNetEventLogSnapshot()).toEqual([]);
    });

    it('records accepted input batches and applied inputs', () => {
        const player = { name: 'Peer', isAlive: true, lastInputSeq: 0 };
        const state = makeEventLogStub({
            localPlayerId: 'HOST',
            players: new Map([['PEER', player]]),
            inputValidator: {
                validateInput: vi.fn(() => ({ valid: true })),
                trackInput: vi.fn(),
            },
            useJitterBuffer: false,
            buildRemotePlayerCallbacks: vi.fn(() => ({})),
            buildPhysicsCallbacks: vi.fn(() => ({})),
            _applyInputToPlayer: vi.fn(() => true),
            renderAllPlayers: vi.fn(),
        });

        state.processInputBatch('PEER', {
            tick: 99,
            lastAck: 4,
            inputs: [{
                type: 'move',
                seq: 7,
                tick: 99,
                data: { direction: -1 },
                timestamp: 1234,
            }],
        }, 1234);

        expect(state.getNetEventLogSnapshot().map((event) => event.type)).toEqual([
            'input_batch_accepted',
            'input_applied',
        ]);
        expect(state.getNetEventLogSnapshot()[0].data).toMatchObject({
            steamId: 'PEER',
            count: 1,
            minSeq: 7,
            maxSeq: 7,
            clientTick: 99,
            lastAck: 4,
        });
        expect(player.lastInputSeq).toBe(7);
    });

    it('records authoritative lock events with occupied-cell counts', () => {
        const network = { broadcastToAll: vi.fn() };
        const state = makeEventLogStub({
            players: new Map([['PEER', {
                gameState: {
                    boardGrid: [[null, { type: 'I', color: '#fff' }]],
                    currentPiece: null,
                    isGameOver: false,
                },
            }]]),
            network,
        });

        state._emitAuthoritativeLock('PEER');

        const log = state.getNetEventLogSnapshot();
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({
            type: 'lock',
            data: {
                playerSteamId: 'PEER',
                lockSeq: 1,
                topOut: false,
                occupiedCells: 1,
            },
        });
        expect(network.broadcastToAll).toHaveBeenCalledTimes(1);
        expect(network.broadcastToAll.mock.calls[0][1]).toMatchObject({
            playerSteamId: 'PEER',
            lockSeq: 1,
        });
    });

    it('authoritativeAttacks switches remote host callbacks from peer-hint mode to host-derived routing', () => {
        const hostDerived = vi.fn();
        const state = makeEventLogStub({
            _authoritativeAttacksEnabled: true,
            buildPhysicsCallbacks: vi.fn(() => ({ onGarbageReady: hostDerived })),
        });

        state.buildRemotePlayerCallbacks('PEER').onGarbageReady({ depth: 4 });
        expect(hostDerived).toHaveBeenCalledWith({ depth: 4 });

        const peerHintMode = makeEventLogStub({
            _authoritativeAttacksEnabled: false,
            buildPhysicsCallbacks: vi.fn(() => ({ onGarbageReady: hostDerived })),
        });
        hostDerived.mockClear();
        peerHintMode.buildRemotePlayerCallbacks('PEER').onGarbageReady({ depth: 4 });
        expect(hostDerived).not.toHaveBeenCalled();
    });
});
