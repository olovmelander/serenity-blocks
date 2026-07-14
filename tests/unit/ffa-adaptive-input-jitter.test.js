import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';
import { flushFfaInputBatches } from '../../src/core/multiplayer/ffa-input-batching.js';

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

    it('preserves bounded canonical spacing for a fixed catch-up batch', () => {
        const state = makeState({
            _adaptiveInputJitterEnabled: false,
            _fixedTickEnabled: true,
        });

        expect(state._resolveBufferedInputTick('PEER', { fixedTickOffset: 0 })).toMatchObject({
            tick: 100,
            source: 'fixed_tick_ordinal',
        });
        expect(state._resolveBufferedInputTick('PEER', { fixedTickOffset: 2 })).toMatchObject({
            tick: 102,
            source: 'fixed_tick_ordinal',
        });
        expect(state._resolveBufferedInputTick('PEER', { fixedTickOffset: 99 })).toMatchObject({
            tick: 104,
            source: 'fixed_tick_ordinal',
        });
    });

    it('anchors a branded group once instead of trusting each absolute peer tick', () => {
        const state = makeState({
            _adaptiveInputJitterEnabled: true,
            _fixedTickEnabled: true,
        });

        expect(state._resolveBufferedInputTick('PEER', {
            fixedTickCanonical: true,
            fixedTickOffset: 2,
            fixedTickTargetTick: 102,
            fixedTickFutureAllowance: 32,
            simTick: 100,
        }, { fixedTickCanonical: true })).toMatchObject({
            tick: 102,
            rawTick: 100,
            source: 'fixed_tick_progression',
            maxFutureTicks: 32,
            reject: false,
        });
    });

    it('derives per-input offsets from wire ordinals without changing legacy batches', () => {
        const processPlayerInput = vi.fn();
        const state = makeState({
            _fixedTickEnabled: true,
            processPlayerInput,
        });
        const inputs = [
            {
                type: 'move', data: { direction: -1 }, seq: 1, fixedTickOrdinal: 40,
            },
            {
                type: 'move', data: { direction: -1 }, seq: 2, fixedTickOrdinal: 42,
            },
        ];

        state.processInputBatch('PEER', { inputs, simTick: 100 }, 1234);

        expect(processPlayerInput).toHaveBeenNthCalledWith(
            1,
            'PEER',
            'move',
            expect.objectContaining({ fixedTickOrdinal: 40, fixedTickOffset: 0 }),
            1234,
            { fixedTickCanonical: false },
        );
        expect(processPlayerInput).toHaveBeenNthCalledWith(
            2,
            'PEER',
            'move',
            expect.objectContaining({ fixedTickOrdinal: 42, fixedTickOffset: 2 }),
            1234,
            { fixedTickCanonical: false },
        );

        const legacyProcessPlayerInput = vi.fn();
        const legacyState = makeState({
            _fixedTickEnabled: false,
            processPlayerInput: legacyProcessPlayerInput,
        });
        legacyState.processInputBatch('PEER', { inputs, simTick: 100 }, 1234);
        expect(legacyProcessPlayerInput).toHaveBeenNthCalledWith(
            1,
            'PEER',
            'move',
            expect.objectContaining({ fixedTickOffset: undefined }),
            1234,
            { fixedTickCanonical: false },
        );
    });

    it('preserves catch-up offsets when the wire cap splits one flush', () => {
        const pendingInputs = Array.from({ length: 42 }, (_, index) => ({
            type: 'drop',
            data: { type: 'soft' },
            seq: index + 1,
            fixedTickOrdinal: index < 21 ? 40 : 41,
            simTick: index < 21 ? 100 : 101,
        }));
        const peer = {
            pendingInputs,
            hostTick: 7,
            lastAckedTick: 3,
            simTick: 100,
            network: {
                hostSteamId: 'HOST',
                sendP2PMessage: vi.fn(),
            },
        };
        flushFfaInputBatches(peer);
        const scheduled = [];
        const host = makeState({
            _adaptiveInputJitterEnabled: false,
            _fixedTickEnabled: true,
        });
        const processPlayerInput = vi.fn((_steamId, _type, data, _timestamp, policy) => {
            scheduled.push(host._resolveBufferedInputTick('PEER', data, policy));
        });
        host.processPlayerInput = processPlayerInput;

        const payloads = peer.network.sendP2PMessage.mock.calls.map(([, , payload]) => payload);
        payloads.forEach((payload, index) => {
            if (index > 0) {
                host.inputJitterBuffer.currentTick += 1;
                host.inputJitterBuffer.processCursor += 1;
            }
            host.processInputBatch('PEER', payload, 1234);
            if (index < payloads.length - 1) {
                expect(processPlayerInput).not.toHaveBeenCalled();
            }
        });

        expect(processPlayerInput).toHaveBeenCalledTimes(42);
        expect(processPlayerInput.mock.calls.every(
            (call) => call[4]?.fixedTickCanonical === true,
        )).toBe(true);
        expect(scheduled.slice(0, 21).every(({ tick }) => tick === 102)).toBe(true);
        expect(scheduled.slice(21).every(({ tick }) => tick === 103)).toBe(true);
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
