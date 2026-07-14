import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    RESYNC_INPUT_BARRIER_MAX_FENCE_LEAD,
    RESYNC_INPUT_BARRIER_MAX_HOST_ENTRIES,
    RESYNC_INPUT_BARRIER_COMPLETION_TIMEOUT_MS,
    RESYNC_INPUT_BARRIER_RETRY_MS,
    RESYNC_INPUT_BARRIER_TIMEOUT_MS,
    acceptHostResyncReady,
    beginPeerResyncBarrier,
    cancelResyncInputBarriers,
    commitValidatedPeerResyncCompletion,
    completePeerResyncBarrier,
    drainPeerResyncBarrier,
    getSatisfiedHostResyncRequirement,
    prepareHostResyncBarrier,
    validatePeerResyncCompletion,
} from '../../src/core/multiplayer/ffa/resync-input-barrier.js';
import { acknowledgeFfaInput } from '../../src/core/multiplayer/ffa-input-batching.js';

const HOST = 'HOST';
const PEER = 'PEER';

function makeHost(overrides = {}) {
    let clock = 1000;
    const game = {
        isHost: true,
        localPlayerId: HOST,
        roundGeneration: 3,
        players: new Map([[PEER, { lastInputSeq: 4 }]]),
        _resyncInputBarrierNow: () => clock,
        _createResyncInputBarrierId: ({ serial }) => `REQ_${serial}`,
        _resyncInputBarrierScheduleTimeout: vi.fn(() => ({})),
        _resyncInputBarrierClearTimeout: vi.fn(),
        _recordNetEvent: vi.fn(),
        ...overrides,
    };
    return {
        game,
        advance(ms) { clock += ms; },
    };
}

function installHostTimerHarness(game) {
    const timers = [];
    game._resyncInputBarrierScheduleTimeout = vi.fn((callback, delayMs) => {
        const timer = { callback, delayMs, cleared: false };
        timers.push(timer);
        return timer;
    });
    game._resyncInputBarrierClearTimeout = vi.fn((timer) => {
        timer.cleared = true;
    });
    return timers;
}

function makePeer(overrides = {}) {
    let clock = 2000;
    const game = {
        isHost: false,
        localPlayerId: PEER,
        roundGeneration: 3,
        gamePhase: 'playing',
        simTick: 18,
        inputSequence: 7,
        pendingInputs: [{ seq: 6 }, { seq: 7 }],
        inputHistory: [{ seq: 5 }, { seq: 6 }, { seq: 7 }],
        players: new Map([[
            PEER,
            { steamId: PEER, gameState: { isProcessingPhysics: false } },
        ]]),
        _networkDispatch: { depth: 0 },
        _fixedTickApplicationDepth: 0,
        _resyncInputBarrierNow: () => clock,
        _recordNetEvent: vi.fn(),
        ...overrides,
    };
    return {
        game,
        advance(ms) { clock += ms; },
    };
}

function preparePayload(overrides = {}) {
    return {
        requestId: 'REQ_1',
        roundGeneration: 3,
        deadlineAt: 16000,
        inputFencePlayerId: PEER,
        ...overrides,
    };
}

function beginAndReady(peer, overrides = {}) {
    beginPeerResyncBarrier(peer, preparePayload(overrides), { flush: vi.fn() });
    return drainPeerResyncBarrier(peer, { sendReady: vi.fn() });
}

describe('FFA exact-resync input barrier', () => {
    it('stores PREPARE before sending and lets only the peer declare its fence', () => {
        const { game } = makeHost();
        const sendPrepare = vi.fn((steamId, payload) => {
            const stored = game.hostResyncInputBarriers.get(steamId);
            expect(stored.requestId).toBe(payload.requestId);
            expect(stored.status).toBe('prepare');
        });

        const payload = prepareHostResyncBarrier(game, PEER, 'desync', sendPrepare);

        expect(payload).toEqual({
            requestId: 'REQ_1',
            roundGeneration: 3,
            deadlineAt: 1000 + RESYNC_INPUT_BARRIER_TIMEOUT_MS,
            inputFencePlayerId: PEER,
        });
        expect(payload).not.toHaveProperty('inputFence');
        expect(sendPrepare).toHaveBeenCalledWith(PEER, payload);
        expect(game.hostResyncInputBarriers.get(PEER)).toMatchObject({
            status: 'prepare', reason: 'desync', inputFence: null,
        });
    });

    it('rolls back host storage if PREPARE delivery throws', () => {
        const { game } = makeHost();
        const failure = new Error('transport down');

        expect(() => prepareHostResyncBarrier(game, PEER, 'desync', () => {
            throw failure;
        })).toThrow(failure);
        expect(game.hostResyncInputBarriers.has(PEER)).toBe(false);
    });

    it('reuses a live host token instead of superseding an in-flight snapshot tuple', () => {
        const { game } = makeHost();
        const sendPrepare = vi.fn();
        const first = prepareHostResyncBarrier(game, PEER, 'digest', sendPrepare);
        const stored = game.hostResyncInputBarriers.get(PEER);

        expect(prepareHostResyncBarrier(game, PEER, 'retry', sendPrepare)).toEqual(first);
        expect(sendPrepare).toHaveBeenCalledTimes(2);
        expect(game.hostResyncInputBarriers.get(PEER)).toBe(stored);
        expect(game._resyncInputBarrierSerial).toBe(1);

        acceptHostResyncReady(game, PEER, { ...first, inputFence: 7 });
        sendPrepare.mockClear();
        expect(prepareHostResyncBarrier(game, PEER, 'during_transfer', sendPrepare))
            .toEqual(first);
        expect(sendPrepare).not.toHaveBeenCalled();
    });

    it('retries one identical PREPARE through lost PREPARE and READY delivery', () => {
        const host = makeHost();
        const peer = makePeer();
        const timers = installHostTimerHarness(host.game);
        const prepareAttempts = [];
        const readyAttempts = [];
        const flush = vi.fn();
        const sendPrepare = (_steamId, payload) => {
            prepareAttempts.push(payload);
            if (prepareAttempts.length === 1) return;
            beginPeerResyncBarrier(peer.game, payload, { flush });
            drainPeerResyncBarrier(peer.game, {
                sendReady: (ready) => {
                    readyAttempts.push(ready);
                    if (readyAttempts.length === 2) {
                        acceptHostResyncReady(host.game, PEER, ready);
                    }
                },
            });
        };

        const prepare = prepareHostResyncBarrier(host.game, PEER, 'gap', sendPrepare);
        expect(timers).toHaveLength(1);
        expect(timers[0].delayMs).toBe(RESYNC_INPUT_BARRIER_RETRY_MS);

        host.advance(RESYNC_INPUT_BARRIER_RETRY_MS);
        peer.advance(RESYNC_INPUT_BARRIER_RETRY_MS);
        timers[0].callback();
        expect(readyAttempts).toHaveLength(1);
        expect(timers).toHaveLength(2);

        host.advance(RESYNC_INPUT_BARRIER_RETRY_MS);
        peer.advance(RESYNC_INPUT_BARRIER_RETRY_MS);
        timers[1].callback();

        expect(prepareAttempts).toEqual([prepare, prepare, prepare]);
        expect(readyAttempts[1]).toEqual(readyAttempts[0]);
        expect(flush).toHaveBeenCalledOnce();
        expect(host.game.hostResyncInputBarriers.get(PEER)).toMatchObject({
            requestId: prepare.requestId,
            status: 'requirement',
        });
        expect(host.game.hostResyncInputBarriers.get(PEER).retryTimer).toBeNull();
        expect(timers).toHaveLength(2);
    });

    it('retires PREPARE exactly at its deadline without another external read', () => {
        const host = makeHost();
        const timers = installHostTimerHarness(host.game);
        const sendPrepare = vi.fn();
        prepareHostResyncBarrier(host.game, PEER, 'gap', sendPrepare);

        host.advance(RESYNC_INPUT_BARRIER_TIMEOUT_MS);
        timers[0].callback();

        expect(sendPrepare).toHaveBeenCalledOnce();
        expect(host.game.hostResyncInputBarriers.has(PEER)).toBe(false);
        expect(host.game._recordNetEvent).toHaveBeenCalledWith(
            'resync_input_barrier_cancelled',
            expect.objectContaining({ role: 'host', steamId: PEER, reason: 'timeout' }),
        );
    });

    it('fences cleared retry callbacks from replacement and restart', () => {
        const { game } = makeHost();
        const timers = installHostTimerHarness(game);
        const firstSend = vi.fn();
        const secondSend = vi.fn();
        prepareHostResyncBarrier(game, PEER, 'first', firstSend);
        const firstTimer = timers[0];

        game.roundGeneration = 4;
        const replacement = prepareHostResyncBarrier(game, PEER, 'replacement', secondSend);
        const secondTimer = timers[1];
        expect(firstTimer.cleared).toBe(true);

        firstTimer.callback();
        expect(game.hostResyncInputBarriers.get(PEER).requestId).toBe(replacement.requestId);
        expect(firstSend).toHaveBeenCalledOnce();
        expect(secondSend).toHaveBeenCalledOnce();

        cancelResyncInputBarriers(game, 'restart');
        expect(secondTimer.cleared).toBe(true);
        secondTimer.callback();
        expect(game.hostResyncInputBarriers.size).toBe(0);
        expect(secondSend).toHaveBeenCalledOnce();
    });

    it('bounds the host table and rejects invalid roles, peers, counters, and ids', () => {
        const { game } = makeHost();
        game.hostResyncInputBarriers = new Map(Array.from(
            { length: RESYNC_INPUT_BARRIER_MAX_HOST_ENTRIES },
            (_, index) => [`P${index}`, {
                requestId: `OLD_${index}`,
                deadlineAt: 99999,
            }],
        ));
        expect(prepareHostResyncBarrier(game, 'NEW', 'desync', vi.fn())).toBeNull();

        game.hostResyncInputBarriers.clear();
        game._createResyncInputBarrierId = () => 'bad id with spaces';
        expect(() => prepareHostResyncBarrier(game, PEER, 'desync', vi.fn()))
            .toThrow(/request id/i);
        expect(prepareHostResyncBarrier({ ...game, isHost: false }, PEER, 'x', vi.fn()))
            .toBeNull();
        expect(prepareHostResyncBarrier(game, HOST, 'x', vi.fn())).toBeNull();
        expect(prepareHostResyncBarrier({ ...game, roundGeneration: -1 }, PEER, 'x', vi.fn()))
            .toBeNull();
    });

    it('freezes before flushing and captures the post-flush local sequence', () => {
        const { game } = makePeer();
        const flush = vi.fn(() => {
            expect(game.resyncInputFrozen).toBe(true);
            game.inputSequence = 8;
            game.pendingInputs = [];
        });

        const barrier = beginPeerResyncBarrier(game, preparePayload(), { flush });

        expect(flush).toHaveBeenCalledOnce();
        expect(barrier).toMatchObject({
            requestId: 'REQ_1',
            roundGeneration: 3,
            inputFencePlayerId: PEER,
            inputFence: 8,
            readySentAt: null,
        });
        expect(game.resyncInputFrozen).toBe(true);
        expect(game.peerResyncInputBarrier).toBe(barrier);
    });

    it('keeps invalid PREPARE packets side-effect free and unwinds a failed flush', () => {
        const { game } = makePeer();
        const flush = vi.fn();
        expect(beginPeerResyncBarrier(game, preparePayload({ roundGeneration: 2 }), { flush }))
            .toBeNull();
        expect(beginPeerResyncBarrier(game, preparePayload({ inputFencePlayerId: 'OTHER' }), { flush }))
            .toBeNull();
        expect(flush).not.toHaveBeenCalled();
        expect(game.resyncInputFrozen).toBeUndefined();

        const failure = new Error('flush failed');
        expect(() => beginPeerResyncBarrier(game, preparePayload(), {
            flush: () => { throw failure; },
        })).toThrow(failure);
        expect(game.resyncInputFrozen).toBe(false);
        expect(game.peerResyncInputBarrier).toBeUndefined();
    });

    it('deduplicates only an identical active PREPARE tuple', () => {
        const { game } = makePeer();
        const flush = vi.fn();
        const first = beginPeerResyncBarrier(game, preparePayload(), { flush });

        expect(beginPeerResyncBarrier(game, preparePayload(), { flush })).toBe(first);
        expect(beginPeerResyncBarrier(game, preparePayload({ deadlineAt: 17000 }), { flush }))
            .toBeNull();
        expect(flush).toHaveBeenCalledOnce();
        expect(game.peerResyncInputBarrier).toBe(first);
        expect(game.resyncInputFrozen).toBe(true);
    });

    it('drains READY only at a freshly computed playing-idle syncpoint', () => {
        const { game } = makePeer();
        beginPeerResyncBarrier(game, preparePayload(), { flush: vi.fn() });
        const sendReady = vi.fn();

        game.players.get(PEER).gameState.isProcessingPhysics = true;
        expect(drainPeerResyncBarrier(game, { sendReady })).toBeNull();
        game.players.get(PEER).gameState.isProcessingPhysics = false;
        game._networkDispatch.depth = 1;
        expect(drainPeerResyncBarrier(game, { sendReady })).toBeNull();
        game._networkDispatch.depth = 0;
        game.gamePhase = 'waiting';
        expect(drainPeerResyncBarrier(game, { sendReady })).toBeNull();
        game.gamePhase = 'playing';

        const ready = drainPeerResyncBarrier(game, { sendReady });
        expect(ready).toEqual({ ...preparePayload(), inputFence: 7 });
        expect(sendReady).toHaveBeenCalledOnce();
        expect(drainPeerResyncBarrier(game, { sendReady })).toBeNull();
    });

    it('does not consume READY if its sender throws, so delivery can retry', () => {
        const { game } = makePeer();
        beginPeerResyncBarrier(game, preparePayload(), { flush: vi.fn() });
        const failure = new Error('send failed');
        expect(() => drainPeerResyncBarrier(game, {
            sendReady: () => { throw failure; },
        })).toThrow(failure);
        expect(game.peerResyncInputBarrier.readySentAt).toBeNull();
        expect(drainPeerResyncBarrier(game, { sendReady: vi.fn() })).not.toBeNull();
    });

    it('retries the identical READY when the host retransmits PREPARE', () => {
        const { game } = makePeer();
        const flush = vi.fn();
        const first = beginPeerResyncBarrier(game, preparePayload(), { flush });
        const firstReady = drainPeerResyncBarrier(game, { sendReady: vi.fn() });

        expect(beginPeerResyncBarrier(game, preparePayload(), { flush })).toBe(first);
        expect(game.peerResyncInputBarrier.readySentAt).toBeNull();
        const retriedReady = drainPeerResyncBarrier(game, { sendReady: vi.fn() });

        expect(retriedReady).toEqual(firstReady);
        expect(flush).toHaveBeenCalledOnce();
        expect(game.resyncInputFrozen).toBe(true);
    });

    it('validates READY against the token, round, peer, host ack, and fence-lead bound', () => {
        const { game } = makeHost();
        const prepare = prepareHostResyncBarrier(game, PEER, 'desync', vi.fn());
        const ready = { ...prepare, inputFence: 7 };

        expect(acceptHostResyncReady(game, PEER, { ...ready, requestId: 'FORGED' }))
            .toBeNull();
        expect(acceptHostResyncReady(game, PEER, { ...ready, roundGeneration: 2 }))
            .toBeNull();
        expect(acceptHostResyncReady(game, PEER, {
            ...ready, inputFencePlayerId: 'OTHER',
        })).toBeNull();
        expect(acceptHostResyncReady(game, PEER, { ...ready, inputFence: 3 }))
            .toBeNull();
        expect(acceptHostResyncReady(game, PEER, {
            ...ready,
            inputFence: 4 + RESYNC_INPUT_BARRIER_MAX_FENCE_LEAD + 1,
        })).toBeNull();
        expect(game.hostResyncInputBarriers.get(PEER).status).toBe('prepare');

        const requirement = acceptHostResyncReady(game, PEER, ready);
        expect(requirement).toMatchObject({ status: 'requirement', inputFence: 7 });
        expect(game._resyncInputBarrierClearTimeout).toHaveBeenCalledOnce();
        expect(acceptHostResyncReady(game, PEER, ready)).toBe(requirement);
        expect(acceptHostResyncReady(game, PEER, { ...ready, inputFence: 8 })).toBeNull();
    });

    it('releases a host requirement only after authoritative input catches up', () => {
        const { game } = makeHost();
        const prepare = prepareHostResyncBarrier(game, PEER, 'desync', vi.fn());
        acceptHostResyncReady(game, PEER, { ...prepare, inputFence: 7 });

        expect(getSatisfiedHostResyncRequirement(game, PEER)).toBeNull();
        game.players.get(PEER).lastInputSeq = 7;
        expect(getSatisfiedHostResyncRequirement(game, PEER)).toEqual({
            ...prepare,
            inputFence: 7,
            inputAck: 7,
        });
        game.players.get(PEER).lastInputSeq = 9;
        expect(getSatisfiedHostResyncRequirement(game, PEER)).toEqual({
            ...prepare,
            inputFence: 7,
            inputAck: 9,
        });
    });

    it('does not satisfy a fence from a non-contiguous maximum sequence', () => {
        const { game } = makeHost({
            players: new Map([[PEER, { lastInputSeq: 0 }]]),
        });
        const prepare = prepareHostResyncBarrier(game, PEER, 'gap', vi.fn());
        acceptHostResyncReady(game, PEER, { ...prepare, inputFence: 2 });
        const player = game.players.get(PEER);

        acknowledgeFfaInput(player, 2);
        expect(getSatisfiedHostResyncRequirement(game, PEER)).toBeNull();
        acknowledgeFfaInput(player, 1);
        expect(getSatisfiedHostResyncRequirement(game, PEER)).toMatchObject({
            inputFence: 2, inputAck: 2,
        });
    });

    it('validates the authoritative completion before pruning and releasing input', () => {
        const { game } = makePeer({
            pendingInputs: [{ seq: 6 }, { seq: 8 }, { malformed: true }],
            inputHistory: [{ seq: 5 }, { seq: 7 }, { seq: 8 }],
        });
        const ready = beginAndReady(game);
        const beforePending = game.pendingInputs;
        const beforeHistory = game.inputHistory;

        expect(validatePeerResyncCompletion(game, { ...ready, inputAck: 9 })).toEqual({
            ...ready,
            inputAck: 9,
        });
        expect(completePeerResyncBarrier(game, { ...ready, inputAck: 6 })).toBeNull();
        expect(completePeerResyncBarrier(game, {
            ...ready, requestId: 'FORGED', inputAck: 7,
        })).toBeNull();
        expect(game.pendingInputs).toBe(beforePending);
        expect(game.inputHistory).toBe(beforeHistory);
        expect(game.resyncInputFrozen).toBe(true);

        expect(completePeerResyncBarrier(game, { ...ready, inputAck: 9 })).toEqual({
            inputAck: 9,
            prunedPendingInputs: 3,
            prunedInputHistory: 3,
        });
        expect(game.pendingInputs).toEqual([]);
        expect(game.inputHistory).toEqual([]);
        expect(game.inputSequence).toBe(9);
        expect(game.peerResyncInputBarrier).toBeNull();
        expect(game.resyncInputFrozen).toBe(false);
    });

    it('preflights completion without mutating the barrier or command queues', () => {
        const { game } = makePeer();
        const ready = beginAndReady(game);
        const barrier = game.peerResyncInputBarrier;
        const { pendingInputs, inputHistory } = game;

        expect(validatePeerResyncCompletion(game, {
            ...ready, requestId: 'FORGED', inputAck: 7,
        })).toBeNull();
        expect(validatePeerResyncCompletion(game, { ...ready, inputAck: 7 }))
            .toEqual({ ...ready, inputAck: 7 });
        expect(game.peerResyncInputBarrier).toBe(barrier);
        expect(game.pendingInputs).toBe(pendingInputs);
        expect(game.inputHistory).toBe(inputHistory);
        expect(game.resyncInputFrozen).toBe(true);
    });

    it('retains commands newer than an authoritative acknowledgement', () => {
        const { game } = makePeer({
            inputSequence: 8,
            pendingInputs: [{ seq: 7 }, { seq: 8 }],
            inputHistory: [{ seq: 6 }, { seq: 7 }, { seq: 8 }],
        });
        const ready = beginAndReady(game);

        expect(completePeerResyncBarrier(game, { ...ready, inputAck: 7 })).toBeNull();
        // The fence is 8, so an acknowledgement below it can never complete.
        expect(game.pendingInputs.map(({ seq }) => seq)).toEqual([7, 8]);

        expect(completePeerResyncBarrier(game, { ...ready, inputAck: 8 })).toMatchObject({
            inputAck: 8,
        });
        expect(game.pendingInputs).toEqual([]);
    });

    it('cancels expired and restarted peer barriers and discards host tokens on restart', () => {
        const peer = makePeer();
        beginAndReady(peer.game);
        peer.advance(RESYNC_INPUT_BARRIER_COMPLETION_TIMEOUT_MS + 1);
        expect(drainPeerResyncBarrier(peer.game, { sendReady: vi.fn() })).toBeNull();
        expect(peer.game.peerResyncInputBarrier).toBeNull();
        expect(peer.game.resyncInputFrozen).toBe(false);

        beginPeerResyncBarrier(peer.game, preparePayload(), { flush: vi.fn() });
        peer.game.roundGeneration = 4;
        expect(drainPeerResyncBarrier(peer.game, { sendReady: vi.fn() })).toBeNull();
        expect(peer.game.peerResyncInputBarrier).toBeNull();
        expect(peer.game.resyncInputFrozen).toBe(false);

        const host = makeHost().game;
        prepareHostResyncBarrier(host, PEER, 'desync', vi.fn());
        cancelResyncInputBarriers(host, 'restart');
        expect(host.hostResyncInputBarriers.size).toBe(0);
    });

    it('expires a host token before accepting READY or satisfying a requirement', () => {
        const host = makeHost();
        const prepare = prepareHostResyncBarrier(host.game, PEER, 'desync', vi.fn());
        expect(acceptHostResyncReady(host.game, PEER, { ...prepare, inputFence: 7 }))
            .not.toBeNull();
        host.game.pendingResyncs = [PEER, 'OTHER'];
        host.advance(RESYNC_INPUT_BARRIER_COMPLETION_TIMEOUT_MS + 1);

        expect(acceptHostResyncReady(host.game, PEER, { ...prepare, inputFence: 7 }))
            .toBeNull();
        expect(getSatisfiedHostResyncRequirement(host.game, PEER)).toBeNull();
        expect(host.game.hostResyncInputBarriers.has(PEER)).toBe(false);
        expect(host.game.pendingResyncs).toEqual(['OTHER']);
    });

    it('uses a short READY deadline and a longer atomic completion deadline', () => {
        const waiting = makePeer();
        beginPeerResyncBarrier(waiting.game, preparePayload(), { flush: vi.fn() });
        waiting.advance(RESYNC_INPUT_BARRIER_TIMEOUT_MS + 1);
        expect(drainPeerResyncBarrier(waiting.game, { sendReady: vi.fn() })).toBeNull();
        expect(waiting.game.peerResyncInputBarrier).toBeNull();

        const applying = makePeer();
        const ready = beginAndReady(applying.game);
        const completion = validatePeerResyncCompletion(applying.game, {
            ...ready, inputAck: 7,
        });
        applying.advance(RESYNC_INPUT_BARRIER_COMPLETION_TIMEOUT_MS + 1);
        expect(commitValidatedPeerResyncCompletion(applying.game, completion)).toMatchObject({
            inputAck: 7,
        });
        expect(applying.game.resyncInputFrozen).toBe(false);
    });
});
