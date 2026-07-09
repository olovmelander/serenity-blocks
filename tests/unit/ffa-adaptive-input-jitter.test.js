import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function makeState(overrides = {}) {
    const inputJitterBuffer = {
        currentTick: 100,
        processCursor: 98,
        bufferDepth: 2,
        stats: { inputsDropped: 0 },
        addInput: vi.fn(() => true),
    };

    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        isHost: true,
        localPlayerId: 'HOST',
        _adaptiveInputJitterEnabled: true,
        useJitterBuffer: true,
        inputJitterBuffer,
        players: new Map([['PEER', { name: 'Peer', isAlive: true, lastInputSeq: 0 }]]),
        inputValidator: {
            validateInput: vi.fn(() => ({ valid: true })),
            trackInput: vi.fn(),
        },
        _recordNetEvent: vi.fn(),
        buildRemotePlayerCallbacks: vi.fn(() => ({})),
        buildPhysicsCallbacks: vi.fn(() => ({})),
        _applyInputToPlayer: vi.fn(() => true),
        renderAllPlayers: vi.fn(),
        ...overrides,
    });
}

describe('FFA adaptive input jitter scheduling', () => {
    it('uses the legacy buffer clock when adaptiveInputJitter is disabled', () => {
        const state = makeState({ _adaptiveInputJitterEnabled: false });

        const schedule = state._resolveBufferedInputTick('PEER', { simTick: 90 });

        expect(schedule).toMatchObject({
            tick: 100,
            rawTick: 100,
            source: 'buffer',
            reject: false,
        });
    });

    it('schedules valid remote sim ticks directly', () => {
        const state = makeState();

        const schedule = state._resolveBufferedInputTick('PEER', { simTick: 99 });

        expect(schedule).toMatchObject({
            tick: 99,
            rawTick: 99,
            source: 'sim_tick',
            lateClamped: false,
            reject: false,
        });
    });

    it('clamps slightly late remote sim ticks to the next process cursor', () => {
        const state = makeState();

        const schedule = state._resolveBufferedInputTick('PEER', { simTick: 95 });

        expect(schedule).toMatchObject({
            tick: 98,
            rawTick: 95,
            source: 'sim_tick_clamped_late',
            lateClamped: true,
            reject: false,
            lateBy: 3,
        });
    });

    it('rejects extremely stale remote sim ticks', () => {
        const state = makeState();

        const schedule = state._resolveBufferedInputTick('PEER', { simTick: 60 });

        expect(schedule).toMatchObject({
            tick: 60,
            rawTick: 60,
            source: 'stale_sim_tick',
            reject: true,
        });
    });

    it('falls back to the buffer clock for future or missing sim ticks', () => {
        const state = makeState();

        expect(state._resolveBufferedInputTick('PEER', { simTick: 120 })).toMatchObject({
            tick: 100,
            rawTick: 120,
            source: 'fallback_future_sim_tick',
            reject: false,
        });
        expect(state._resolveBufferedInputTick('PEER', {})).toMatchObject({
            tick: 100,
            rawTick: 100,
            source: 'fallback_missing_sim_tick',
            reject: false,
        });
    });

    it('enqueues remote inputs with scheduled and raw tick metadata', () => {
        const state = makeState();

        state.processPlayerInput('PEER', 'move', { seq: 7, simTick: 95 }, 12345);

        expect(state.inputJitterBuffer.addInput).toHaveBeenCalledWith(
            'PEER',
            98,
            expect.objectContaining({
                type: 'move',
                data: expect.objectContaining({ seq: 7, simTick: 95 }),
                timestamp: 12345,
            }),
            expect.objectContaining({
                jitterTick: 95,
                scheduleSource: 'sim_tick_clamped_late',
                lateClamped: true,
            }),
        );
        expect(state._recordNetEvent).toHaveBeenCalledWith('input_buffered', expect.objectContaining({
            tick: 98,
            rawTick: 95,
            schedule: 'sim_tick_clamped_late',
            lateClamped: true,
        }));
    });
});
