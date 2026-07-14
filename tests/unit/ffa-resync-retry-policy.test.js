import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    RESYNC_FRESH_CAPTURE_RETRY_LIMIT,
    RESYNC_REJECTION_REASONS,
    getHostResyncRetryCount,
    handleHostResyncRejection,
    rejectInboundResync,
    replayInboundResyncRejection,
    resetHostResyncRetries,
    resetInboundResyncRejections,
} from '../../src/core/multiplayer/ffa/resync-retry-policy.js';

const PEER = 'PEER';

function makeTransfer(resyncId = 'RESYNC_1', requestId = 'REQUEST_1', steamId = PEER) {
    return {
        resyncId,
        steamId,
        timer: null,
        inputBarrier: { requestId },
    };
}

function makeGame(transfer = makeTransfer()) {
    return {
        isHost: true,
        roundGeneration: 4,
        resyncTransfers: new Map([[transfer.resyncId, transfer]]),
        downloadJoinPeers: new Map([[
            transfer.steamId,
            { resyncId: transfer.resyncId },
        ]]),
        _recordNetEvent: vi.fn(),
    };
}

function makeActions(overrides = {}) {
    return {
        clearTimer: vi.fn((timer) => clearInterval(timer)),
        cancelBarrier: vi.fn(),
        routeResync: vi.fn(() => true),
        failPeer: vi.fn(),
        ...overrides,
    };
}

function rejectionMessage({
    from = PEER,
    resyncId = 'RESYNC_1',
    reason = RESYNC_REJECTION_REASONS.APPLY_FAILED,
} = {}) {
    return {
        from,
        data: {
            resyncId,
            rejected: true,
            reason,
        },
    };
}

describe('FFA resync retry policy', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each([
        ['wrong sender', { from: 'STRANGER' }],
        ['stale transfer id', { resyncId: 'RESYNC_OLD' }],
        ['invalid rejection reason', { reason: 'raw_parser_stack' }],
    ])('ignores a rejection with a %s', (_label, messageOverrides) => {
        const transfer = makeTransfer();
        const game = makeGame(transfer);
        const actions = makeActions();

        expect(handleHostResyncRejection(
            game,
            rejectionMessage(messageOverrides),
            actions,
        )).toBe(false);

        expect(game.resyncTransfers.get(transfer.resyncId)).toBe(transfer);
        expect(game.downloadJoinPeers.get(PEER)).toEqual({ resyncId: transfer.resyncId });
        expect(actions.clearTimer).not.toHaveBeenCalled();
        expect(actions.cancelBarrier).not.toHaveBeenCalled();
        expect(actions.routeResync).not.toHaveBeenCalled();
        expect(actions.failPeer).not.toHaveBeenCalled();
        expect(game._recordNetEvent).not.toHaveBeenCalled();
        expect(getHostResyncRetryCount(game, PEER)).toBe(0);
    });

    it('retires the exact transfer and barrier before routing a fresh capture', () => {
        vi.useFakeTimers();
        const transfer = makeTransfer();
        transfer.timer = setInterval(() => {}, 1000);
        const game = makeGame(transfer);
        const actions = makeActions();

        expect(handleHostResyncRejection(
            game,
            rejectionMessage(),
            actions,
        )).toBe(true);

        expect(transfer.timer).toBeNull();
        expect(actions.clearTimer).toHaveBeenCalledOnce();
        expect(game.resyncTransfers.has(transfer.resyncId)).toBe(false);
        expect(game.downloadJoinPeers.has(PEER)).toBe(false);
        expect(actions.cancelBarrier).toHaveBeenCalledOnce();
        expect(actions.cancelBarrier).toHaveBeenCalledWith(PEER, 'REQUEST_1');
        expect(actions.routeResync).toHaveBeenCalledOnce();
        expect(actions.routeResync).toHaveBeenCalledWith(PEER, 'retry_apply_failed');
        expect(actions.failPeer).not.toHaveBeenCalled();
        expect(getHostResyncRetryCount(game, PEER)).toBe(1);
        expect(game._recordNetEvent).toHaveBeenCalledWith('resync_transfer_rejected', {
            steamId: PEER,
            resyncId: 'RESYNC_1',
            reason: RESYNC_REJECTION_REASONS.APPLY_FAILED,
        });
        expect(game._recordNetEvent).toHaveBeenCalledWith('resync_retry_scheduled', {
            steamId: PEER,
            rejectedResyncId: 'RESYNC_1',
            reason: RESYNC_REJECTION_REASONS.APPLY_FAILED,
            attempt: 1,
        });
    });

    it('allows two fresh captures, then fails the peer closed', () => {
        const game = makeGame();
        const actions = makeActions();

        for (let attempt = 1; attempt <= RESYNC_FRESH_CAPTURE_RETRY_LIMIT + 1; attempt += 1) {
            const transfer = makeTransfer(`RESYNC_${attempt}`, `REQUEST_${attempt}`);
            game.resyncTransfers.set(transfer.resyncId, transfer);
            game.downloadJoinPeers.set(PEER, { resyncId: transfer.resyncId });

            expect(handleHostResyncRejection(
                game,
                rejectionMessage({ resyncId: transfer.resyncId }),
                actions,
            )).toBe(true);
        }

        expect(actions.cancelBarrier).toHaveBeenCalledTimes(3);
        expect(actions.routeResync).toHaveBeenCalledTimes(RESYNC_FRESH_CAPTURE_RETRY_LIMIT);
        expect(actions.routeResync.mock.calls).toEqual([
            [PEER, 'retry_apply_failed'],
            [PEER, 'retry_apply_failed'],
        ]);
        expect(actions.failPeer).toHaveBeenCalledOnce();
        expect(actions.failPeer).toHaveBeenCalledWith(PEER, 'resync_retry_exhausted');
        expect(getHostResyncRetryCount(game, PEER)).toBe(0);
        expect(game.resyncTransfers.size).toBe(0);
        expect(game.downloadJoinPeers.size).toBe(0);
        expect(game._recordNetEvent).toHaveBeenCalledWith('resync_retry_exhausted', {
            steamId: PEER,
            rejectedResyncId: 'RESYNC_3',
            reason: RESYNC_REJECTION_REASONS.APPLY_FAILED,
            attempts: 3,
        });
    });

    it('resets host retry counters per peer or for the whole owner', () => {
        const first = makeTransfer('RESYNC_A', 'REQUEST_A', 'A');
        const game = makeGame(first);
        const actions = makeActions();
        game.downloadJoinPeers.set('A', { resyncId: first.resyncId });
        handleHostResyncRejection(
            game,
            rejectionMessage({ from: 'A', resyncId: first.resyncId }),
            actions,
        );

        const second = makeTransfer('RESYNC_B', 'REQUEST_B', 'B');
        game.resyncTransfers.set(second.resyncId, second);
        game.downloadJoinPeers.set('B', { resyncId: second.resyncId });
        handleHostResyncRejection(
            game,
            rejectionMessage({ from: 'B', resyncId: second.resyncId }),
            actions,
        );

        expect(getHostResyncRetryCount(game, 'A')).toBe(1);
        expect(getHostResyncRetryCount(game, 'B')).toBe(1);

        resetHostResyncRetries(game, 'A');
        expect(getHostResyncRetryCount(game, 'A')).toBe(0);
        expect(getHostResyncRetryCount(game, 'B')).toBe(1);

        resetHostResyncRetries(game);
        expect(getHostResyncRetryCount(game, 'B')).toBe(0);
    });

    it('clears cached inbound rejection verdicts on reset', () => {
        const owner = {};
        let now = 1000;
        const context = {
            state: owner,
            now: () => now,
            sendAck: vi.fn(),
            recordEvent: vi.fn(),
        };
        const transfer = {
            completionKey: 'HOST\u0000RESYNC_1',
            resyncId: 'RESYNC_1',
            from: 'HOST',
        };

        rejectInboundResync(context, transfer, RESYNC_REJECTION_REASONS.SIDECAR_INVALID);
        context.sendAck.mockClear();
        now += 1;

        expect(replayInboundResyncRejection(
            context,
            transfer.completionKey,
            transfer.resyncId,
        )).toBe(true);
        expect(context.sendAck).toHaveBeenCalledWith({
            resyncId: transfer.resyncId,
            rejected: true,
            reason: RESYNC_REJECTION_REASONS.SIDECAR_INVALID,
        });

        resetInboundResyncRejections(owner);
        context.sendAck.mockClear();
        expect(replayInboundResyncRejection(
            context,
            transfer.completionKey,
            transfer.resyncId,
        )).toBe(false);
        expect(context.sendAck).not.toHaveBeenCalled();
    });

    it('keeps the first terminal reason stable across duplicate rejection calls', () => {
        const context = {
            state: {},
            now: () => 1000,
            sendAck: vi.fn(),
            recordEvent: vi.fn(),
        };
        const transfer = {
            completionKey: 'HOST\u0000RESYNC_1',
            resyncId: 'RESYNC_1',
            from: 'HOST',
        };

        rejectInboundResync(context, transfer, RESYNC_REJECTION_REASONS.SIDECAR_INVALID);
        rejectInboundResync(context, transfer, RESYNC_REJECTION_REASONS.APPLY_FAILED);

        expect(context.sendAck.mock.calls.map(([ack]) => ack)).toEqual([
            { resyncId: 'RESYNC_1', rejected: true, reason: 'sidecar_invalid' },
            { resyncId: 'RESYNC_1', rejected: true, reason: 'sidecar_invalid' },
        ]);
        expect(context.recordEvent).toHaveBeenCalledOnce();
    });
});
