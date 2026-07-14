import {
    describe, expect, it, vi,
} from 'vitest';
import { FFAGameStateP2P } from '../../src/core/multiplayer/ffa-p2p-game-state.js';

function makeTarget(overrides = {}) {
    return Object.assign(Object.create(FFAGameStateP2P.prototype), {
        localPlayerId: 'A',
        players: new Map([['A', {}]]),
        roundGeneration: 4,
        migrationEpoch: 2,
        matchConfig: { marker: 'before' },
        _recordNetEvent: vi.fn(),
        _transitionSimulationClock: vi.fn(),
        _applySnapshotState: vi.fn(),
        ...overrides,
    });
}

function incoming(overrides = {}) {
    return {
        players: [{ steamId: 'A' }],
        roundGeneration: 4,
        migrationEpoch: 2,
        matchConfig: { marker: 'after' },
        ...overrides,
    };
}

describe('FFA resync application preflight', () => {
    it('rejects invalid round seeds before mutating any live resync state', () => {
        [false, true, '', 'not-a-seed', Number.NaN, Number.POSITIVE_INFINITY, [], {}]
            .forEach((sharedSeed) => {
                const target = makeTarget({ sharedSeed: 91 });

                expect(target._applyResyncState(incoming({ sharedSeed }))).toBe(false);

                expect(target.sharedSeed).toBe(91);
                expect(target.matchConfig).toEqual({ marker: 'before' });
                expect(target._transitionSimulationClock).not.toHaveBeenCalled();
                expect(target._applySnapshotState).not.toHaveBeenCalled();
                expect(target._recordNetEvent).toHaveBeenCalledWith(
                    'resync_apply_rejected',
                    { reason: 'invalid_round_seed' },
                );
            });
    });

    it('canonicalizes a compatible resync seed before committing it to live state', () => {
        const target = makeTarget({
            sharedSeed: 91,
            renderAllPlayers: vi.fn(),
            _downloadJoinEnabled: false,
            gamePhase: 'finished',
        });

        expect(target._applyResyncState(incoming({ sharedSeed: ' 0 ' }))).toBe(true);

        expect(target.sharedSeed).toBe(0);
        expect(typeof target.sharedSeed).toBe('number');
        expect(target._applySnapshotState).toHaveBeenCalledOnce();
    });

    it('rejects an unmet local input acknowledgement before mutating snapshot state', () => {
        const target = makeTarget({
            inputSequence: 7,
            pendingInputs: [{ seq: 7 }],
            inputHistory: [{ seq: 7 }],
            resyncInputFrozen: true,
            _resyncInputBarrierNow: () => 1000,
            peerResyncInputBarrier: {
                requestId: 'REQ_1',
                roundGeneration: 4,
                deadlineAt: 5000,
                localDeadlineAt: 6000,
                inputFencePlayerId: 'A',
                inputFence: 7,
                preparedAt: 900,
                readySentAt: 950,
                wasInputFrozen: false,
            },
        });
        const inputBarrier = {
            requestId: 'REQ_1',
            roundGeneration: 4,
            deadlineAt: 5000,
            inputFencePlayerId: 'A',
            inputFence: 7,
            inputAck: 7,
        };

        expect(target._applyResyncState(incoming({
            inputBarrier,
            resyncSidecar: {
                players: [{ steamId: 'A', wrapper: { lastInputSeq: 6 } }],
            },
        }))).toBe(false);

        expect(target.matchConfig).toEqual({ marker: 'before' });
        expect(target._transitionSimulationClock).not.toHaveBeenCalled();
        expect(target._applySnapshotState).not.toHaveBeenCalled();
        expect(target.pendingInputs).toEqual([{ seq: 7 }]);
        expect(target.resyncInputFrozen).toBe(true);
        expect(target._recordNetEvent).toHaveBeenCalledWith(
            'resync_apply_rejected',
            { accepted: false, reason: 'authoritative_input_ack_unmet' },
        );
    });

    it.each([
        ['previous round', { roundGeneration: 3 }, 'stale_round_generation'],
        ['previous host epoch', { migrationEpoch: 1 }, 'stale_migration_epoch'],
    ])('rejects a delayed %s before mutating live state', (_label, override, reason) => {
        const target = makeTarget();

        expect(target._applyResyncState(incoming(override))).toBe(false);

        expect(target.matchConfig).toEqual({ marker: 'before' });
        expect(target._transitionSimulationClock).not.toHaveBeenCalled();
        expect(target._applySnapshotState).not.toHaveBeenCalled();
        expect(target._recordNetEvent).toHaveBeenCalledWith(
            'resync_apply_rejected',
            expect.objectContaining({ accepted: false, reason }),
        );
    });

    it('rejects a source roster that would leave a stale target-only player alive', () => {
        const target = makeTarget({
            players: new Map([['A', {}], ['STALE', {}]]),
        });

        expect(target._applyResyncState(incoming())).toBe(false);

        expect(target.players.has('STALE')).toBe(true);
        expect(target.matchConfig).toEqual({ marker: 'before' });
        expect(target._applySnapshotState).not.toHaveBeenCalled();
        expect(target._recordNetEvent).toHaveBeenCalledWith(
            'resync_apply_rejected',
            expect.objectContaining({
                reason: 'target_roster_extra',
                details: { playerIds: ['STALE'] },
            }),
        );
    });

    it('commits deterministic state without letting an observer render failure fail the transfer', () => {
        const target = makeTarget({
            renderAllPlayers: vi.fn(() => { throw new Error('renderer failed'); }),
            _downloadJoinEnabled: false,
            gamePhase: 'finished',
        });

        expect(target._applyResyncState(incoming())).toBe(true);

        expect(target._applySnapshotState).toHaveBeenCalledWith(
            expect.objectContaining({ roundGeneration: 4, migrationEpoch: 2 }),
            { forceLocal: true, render: false },
        );
        expect(target._recordNetEvent).toHaveBeenCalledWith('resync_render_failed', {
            message: 'renderer failed',
        });
    });

    it('clears fixed-clock projection debt even when the authoritative clock kind is unchanged', () => {
        const reset = vi.fn();
        const target = makeTarget({
            _fixedTickEnabled: true,
            _simTickAccumulatorMs: 92,
            _fixedInputTimeMs: 7000,
            _peerFixedInputSimTick: 500,
            _activeFixedInputStamp: { simTick: 500, ordinal: 4 },
            localInputHooks: { reset },
            renderAllPlayers: vi.fn(),
            _downloadJoinEnabled: false,
            gamePhase: 'finished',
        });

        expect(target._applyResyncState(incoming({
            matchConfig: { marker: 'after', simulationClock: 'fixed60-v1' },
            simTick: 450,
        }))).toBe(true);

        expect(target._transitionSimulationClock).toHaveBeenCalledWith('fixed60-v1');
        expect(target._simTickAccumulatorMs).toBe(0);
        expect(target._fixedInputTimeMs).toBeNull();
        expect(target._peerFixedInputSimTick).toBeNull();
        expect(target._activeFixedInputStamp).toBeNull();
        expect(reset).toHaveBeenCalledOnce();
    });
});
