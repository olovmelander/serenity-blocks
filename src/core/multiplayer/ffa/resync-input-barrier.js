// @ts-check

import { computeFfaJoinSyncpoint } from './join-syncpoint.js';
import { abortResyncTransfersForPeer } from './resync-coordinator.js';
import { createFfaResyncContext } from './resync-context.js';

/**
 * Two-phase input barrier for an exact peer resync.
 *
 * PREPARE deliberately does not contain an input fence: only the peer knows
 * which locally-owned commands exist. The peer freezes command production,
 * flushes what was already queued, and reports its final sequence in READY.
 * The host may capture only after its authoritative player has applied that
 * sequence. The resulting resync echoes the tuple and acknowledgement before
 * the peer discards acknowledged history and releases input.
 */

export const RESYNC_INPUT_BARRIER_TIMEOUT_MS = 5000;
export const RESYNC_INPUT_BARRIER_COMPLETION_TIMEOUT_MS = 20000;
export const RESYNC_INPUT_BARRIER_RETRY_MS = 500;
export const RESYNC_INPUT_BARRIER_MAX_ID_LENGTH = 128;
export const RESYNC_INPUT_BARRIER_MAX_PLAYER_ID_LENGTH = 128;
export const RESYNC_INPUT_BARRIER_MAX_COUNTER = 0xFFFFFFFF;
export const RESYNC_INPUT_BARRIER_MAX_FENCE_LEAD = 4096;
export const RESYNC_INPUT_BARRIER_MAX_HOST_ENTRIES = 64;

/** @typedef {'prepare'|'requirement'} HostBarrierStatus */

/**
 * @typedef {Object} ResyncInputPrepare
 * @property {string} requestId
 * @property {number} roundGeneration
 * @property {number} deadlineAt
 * @property {string} inputFencePlayerId
 */

/**
 * @typedef {ResyncInputPrepare & {inputFence: number}} ResyncInputReady
 */

/**
 * @typedef {ResyncInputReady & {inputAck: number}} ResyncInputCompletion
 */

/**
 * @typedef {Object} HostResyncInputBarrier
 * @property {HostBarrierStatus} status
 * @property {string} steamId
 * @property {string} requestId
 * @property {number} roundGeneration
 * @property {number} deadlineAt
 * @property {number} expiresAt
 * @property {string} inputFencePlayerId
 * @property {string} reason
 * @property {number} preparedAt
 * @property {number|null} inputFence
 * @property {number|null} readyAt
 * @property {((steamId: string, payload: ResyncInputPrepare) => void)} sendPrepare
 * @property {any} retryTimer
 * @property {number} retryGeneration
 */

/**
 * @typedef {Object} PeerResyncInputBarrier
 * @property {string} requestId
 * @property {number} roundGeneration
 * @property {number} deadlineAt
 * @property {number} localDeadlineAt
 * @property {string} inputFencePlayerId
 * @property {number} inputFence
 * @property {number} preparedAt
 * @property {number|null} readySentAt
 * @property {boolean} wasInputFrozen
 */

/** @param {unknown} value */
function isCounter(value) {
    return Number.isInteger(value)
        && Number(value) >= 0
        && Number(value) <= RESYNC_INPUT_BARRIER_MAX_COUNTER;
}

/** @param {unknown} value */
function isTimestamp(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** @param {unknown} value */
function isRequestId(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= RESYNC_INPUT_BARRIER_MAX_ID_LENGTH
        && /^[A-Za-z0-9._:-]+$/.test(value);
}

/** @param {unknown} value */
function isPlayerId(value) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= RESYNC_INPUT_BARRIER_MAX_PLAYER_ID_LENGTH
        && Array.from(value).every((character) => {
            const code = character.charCodeAt(0);
            return code > 31 && code !== 127;
        });
}

/** @param {Record<string, any>} game */
function now(game) {
    const value = game._resyncInputBarrierNow?.();
    return isTimestamp(value) ? value : Date.now();
}

/** @param {Record<string, any>} game */
function getHostBarriers(game) {
    if (!(game.hostResyncInputBarriers instanceof Map)) {
        game.hostResyncInputBarriers = new Map();
    }
    /** @type {Map<string, HostResyncInputBarrier>} */
    return game.hostResyncInputBarriers;
}

/** @param {Record<string, any>} game @param {string} event @param {Record<string, unknown>} details */
function record(game, event, details) {
    game._recordNetEvent?.(event, details);
}

/** @param {unknown} reason */
function normalizeReason(reason) {
    return typeof reason === 'string' && reason.length > 0
        ? reason.slice(0, 128) : 'resync';
}

/** @param {Record<string, any>} game */
function createRequestId(game) {
    const previous = isCounter(game._resyncInputBarrierSerial)
        ? game._resyncInputBarrierSerial : 0;
    const serial = previous >= RESYNC_INPUT_BARRIER_MAX_COUNTER ? 1 : previous + 1;
    game._resyncInputBarrierSerial = serial;
    const supplied = game._createResyncInputBarrierId?.({ serial });
    const requestId = supplied ?? `rib_${now(game).toString(36)}_${serial.toString(36)}`;
    if (!isRequestId(requestId)) {
        throw new TypeError('Invalid resync input barrier request id');
    }
    return requestId;
}

/** @param {Record<string, any>} game @param {string} steamId */
function removePendingResync(game, steamId) {
    if (!Array.isArray(game.pendingResyncs)) return;
    game.pendingResyncs = game.pendingResyncs.filter((candidate) => candidate !== steamId);
}

/** @param {Record<string, any>} game @param {() => void} callback @param {number} delayMs */
function scheduleTimeout(game, callback, delayMs) {
    if (typeof game._resyncInputBarrierScheduleTimeout === 'function') {
        return game._resyncInputBarrierScheduleTimeout(callback, delayMs);
    }
    const timer = setTimeout(callback, delayMs);
    /** @type {any} */ (timer)?.unref?.();
    return timer;
}

/** @param {Record<string, any>} game @param {any} timer */
function clearScheduledTimeout(game, timer) {
    if (timer == null) return;
    if (typeof game._resyncInputBarrierClearTimeout === 'function') {
        game._resyncInputBarrierClearTimeout(timer);
        return;
    }
    clearTimeout(timer);
}

/** @param {Record<string, any>} game @param {HostResyncInputBarrier} barrier */
function clearHostPrepareRetry(game, barrier) {
    const timer = barrier.retryTimer;
    barrier.retryTimer = null;
    barrier.retryGeneration += 1;
    clearScheduledTimeout(game, timer);
}

/** @param {HostResyncInputBarrier} barrier @returns {ResyncInputPrepare} */
function hostPreparePayload(barrier) {
    return {
        requestId: barrier.requestId,
        roundGeneration: barrier.roundGeneration,
        deadlineAt: barrier.deadlineAt,
        inputFencePlayerId: barrier.inputFencePlayerId,
    };
}

/** Keep one PREPARE token live without allowing an old callback to own its replacement. */
function scheduleHostPrepareRetry(game, barrier) {
    if (getHostBarriers(game).get(barrier.steamId) !== barrier
        || barrier.status !== 'prepare') return;
    clearHostPrepareRetry(game, barrier);
    const remainingMs = barrier.deadlineAt - now(game);
    if (remainingMs <= 0) {
        cancelHostResyncBarrier(game, barrier.steamId, 'timeout', barrier.requestId);
        return;
    }

    const { retryGeneration } = barrier;
    barrier.retryTimer = scheduleTimeout(game, () => {
        const active = getHostBarriers(game).get(barrier.steamId);
        if (active !== barrier || active.requestId !== barrier.requestId
            || active.retryGeneration !== retryGeneration || active.status !== 'prepare') return;
        active.retryTimer = null;
        const timestamp = now(game);
        if (timestamp >= active.deadlineAt) {
            cancelHostResyncBarrier(game, active.steamId, 'timeout', active.requestId);
            return;
        }
        record(game, 'resync_input_prepare_retried', {
            steamId: active.steamId,
            requestId: active.requestId,
        });
        try {
            active.sendPrepare(active.steamId, hostPreparePayload(active));
        } catch (error) {
            record(game, 'resync_input_prepare_retry_failed', {
                steamId: active.steamId,
                requestId: active.requestId,
                message: String(error?.message || error),
            });
        }
        scheduleHostPrepareRetry(game, active);
    }, Math.min(RESYNC_INPUT_BARRIER_RETRY_MS, remainingMs));
}

/**
 * Remove expired host entries. Callers also invoke this before reading a
 * requirement so a missed external timeout callback cannot revive it.
 * @param {Record<string, any>} game
 * @param {number} timestamp
 */
function expireHostBarriers(game, timestamp) {
    if (!(game.hostResyncInputBarriers instanceof Map)) return;
    for (const [steamId, barrier] of game.hostResyncInputBarriers) {
        const expiresAt = isTimestamp(barrier?.expiresAt)
            ? barrier.expiresAt : barrier?.deadlineAt;
        if (!isTimestamp(expiresAt) || timestamp >= expiresAt) {
            cancelHostResyncBarrier(game, steamId, 'timeout', barrier?.requestId);
        }
    }
}

/**
 * Start the host half of the handshake and send a PREPARE token. The record is
 * installed before the callback so a synchronous mock transport can reply.
 *
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {string} reason
 * @param {(steamId: string, payload: ResyncInputPrepare) => void} sendPrepare
 * @returns {ResyncInputPrepare|null}
 */
export function prepareHostResyncBarrier(game, steamId, reason, sendPrepare) {
    if (game.isHost !== true || !isPlayerId(steamId)
        || steamId === game.localPlayerId || typeof sendPrepare !== 'function') return null;
    const timestamp = now(game);
    expireHostBarriers(game, timestamp);
    const barriers = getHostBarriers(game);
    if (!isCounter(game.roundGeneration)) return null;
    const existing = barriers.get(steamId);
    if (existing?.roundGeneration === game.roundGeneration) {
        const payload = hostPreparePayload(existing);
        record(game, 'resync_input_prepare_reused', {
            steamId, requestId: existing.requestId, status: existing.status,
        });
        if (existing.status === 'prepare') {
            sendPrepare(steamId, payload);
            existing.sendPrepare = sendPrepare;
            scheduleHostPrepareRetry(game, existing);
        }
        return payload;
    }
    if (existing) cancelHostResyncBarrier(game, steamId, 'stale_round');
    if (barriers.size >= RESYNC_INPUT_BARRIER_MAX_HOST_ENTRIES) {
        record(game, 'resync_input_barrier_rejected', {
            role: 'host', steamId, reason: 'capacity',
        });
        return null;
    }

    const requestId = createRequestId(game);
    const deadlineAt = Math.min(
        Number.MAX_SAFE_INTEGER,
        timestamp + RESYNC_INPUT_BARRIER_TIMEOUT_MS,
    );
    /** @type {ResyncInputPrepare} */
    const payload = {
        requestId,
        roundGeneration: game.roundGeneration,
        deadlineAt,
        inputFencePlayerId: steamId,
    };
    /** @type {HostResyncInputBarrier} */
    const barrier = {
        status: 'prepare',
        steamId,
        ...payload,
        reason: normalizeReason(reason),
        preparedAt: timestamp,
        expiresAt: deadlineAt,
        inputFence: null,
        readyAt: null,
        sendPrepare,
        retryTimer: null,
        retryGeneration: 0,
    };
    barriers.set(steamId, barrier);
    record(game, 'resync_input_prepare', {
        steamId, requestId, roundGeneration: payload.roundGeneration, reason: barrier.reason,
    });
    try {
        sendPrepare(steamId, payload);
    } catch (error) {
        if (barriers.get(steamId) === barrier) {
            clearHostPrepareRetry(game, barrier);
            barriers.delete(steamId);
        }
        throw error;
    }
    scheduleHostPrepareRetry(game, barrier);
    return payload;
}

/**
 * Freeze peer input, flush commands that predate the freeze, then capture the
 * only sequence the peer will advertise in READY.
 *
 * @param {Record<string, any>} game
 * @param {Record<string, any>} data
 * @param {{flush: () => void}} options
 * @returns {PeerResyncInputBarrier|null}
 */
export function beginPeerResyncBarrier(game, data, { flush } = /** @type {any} */ ({})) {
    if (game.isHost === true || typeof flush !== 'function' || !data
        || !isRequestId(data.requestId)
        || !isCounter(data.roundGeneration)
        || data.roundGeneration !== game.roundGeneration
        || !isTimestamp(data.deadlineAt)
        || !isPlayerId(data.inputFencePlayerId)
        || data.inputFencePlayerId !== game.localPlayerId
        || !isCounter(game.inputSequence)) return null;

    const current = game.peerResyncInputBarrier;
    if (current?.requestId === data.requestId) {
        const identical = current.roundGeneration === data.roundGeneration
            && current.deadlineAt === data.deadlineAt
            && current.inputFencePlayerId === data.inputFencePlayerId;
        if (!identical) return null;
        current.readySentAt = null;
        return current;
    }
    if (current) cancelPeerResyncBarrier(game, 'superseded');

    const timestamp = now(game);
    const wasInputFrozen = game.resyncInputFrozen === true;
    game.resyncInputFrozen = true;
    try {
        flush();
    } catch (error) {
        game.resyncInputFrozen = wasInputFrozen;
        throw error;
    }
    if (!isCounter(game.inputSequence)) {
        game.resyncInputFrozen = wasInputFrozen;
        return null;
    }

    /** @type {PeerResyncInputBarrier} */
    const barrier = {
        requestId: data.requestId,
        roundGeneration: data.roundGeneration,
        deadlineAt: data.deadlineAt,
        localDeadlineAt: Math.min(
            Number.MAX_SAFE_INTEGER,
            timestamp + RESYNC_INPUT_BARRIER_TIMEOUT_MS,
        ),
        inputFencePlayerId: data.inputFencePlayerId,
        inputFence: game.inputSequence,
        preparedAt: timestamp,
        readySentAt: null,
        wasInputFrozen,
    };
    game.peerResyncInputBarrier = barrier;
    record(game, 'resync_input_frozen', {
        requestId: barrier.requestId,
        inputFence: barrier.inputFence,
        roundGeneration: barrier.roundGeneration,
    });
    return barrier;
}

/**
 * Send READY once the peer is in a freshly computed playing/idle syncpoint.
 * Packet/fixed-tick application and active physics therefore delay READY.
 *
 * @param {Record<string, any>} game
 * @param {{sendReady: (payload: ResyncInputReady) => void}} options
 * @returns {ResyncInputReady|null}
 */
export function drainPeerResyncBarrier(game, { sendReady } = /** @type {any} */ ({})) {
    const barrier = game.peerResyncInputBarrier;
    if (!barrier) return null;
    const timestamp = now(game);
    if (timestamp > barrier.localDeadlineAt) {
        cancelPeerResyncBarrier(game, 'timeout');
        return null;
    }
    if (game.roundGeneration !== barrier.roundGeneration) {
        cancelPeerResyncBarrier(game, 'restart');
        return null;
    }
    if (typeof sendReady !== 'function' || barrier.readySentAt !== null) return null;
    const marker = computeFfaJoinSyncpoint(game);
    if (!marker.safe || marker.status !== 'idle'
        || marker.roundGeneration !== barrier.roundGeneration) return null;

    /** @type {ResyncInputReady} */
    const payload = {
        requestId: barrier.requestId,
        roundGeneration: barrier.roundGeneration,
        deadlineAt: barrier.deadlineAt,
        inputFencePlayerId: barrier.inputFencePlayerId,
        inputFence: barrier.inputFence,
    };
    sendReady(payload);
    barrier.readySentAt = timestamp;
    barrier.localDeadlineAt = Math.min(
        Number.MAX_SAFE_INTEGER,
        timestamp + RESYNC_INPUT_BARRIER_COMPLETION_TIMEOUT_MS,
    );
    record(game, 'resync_input_ready', {
        requestId: barrier.requestId,
        inputFence: barrier.inputFence,
        roundGeneration: barrier.roundGeneration,
    });
    return payload;
}

/**
 * Adopt a peer READY as a host-side resync requirement. Forged fences are
 * bounded relative to the host's applied input acknowledgement.
 *
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {Record<string, any>} data
 * @returns {HostResyncInputBarrier|null}
 */
export function acceptHostResyncReady(game, steamId, data) {
    if (game.isHost !== true || !isPlayerId(steamId) || !data) return null;
    const timestamp = now(game);
    expireHostBarriers(game, timestamp);
    const barrier = getHostBarriers(game).get(steamId);
    if (!barrier
        || data.requestId !== barrier.requestId
        || data.roundGeneration !== barrier.roundGeneration
        || data.deadlineAt !== barrier.deadlineAt
        || data.inputFencePlayerId !== steamId
        || !isCounter(data.inputFence)
        || game.roundGeneration !== barrier.roundGeneration) return null;

    const player = game.players?.get?.(steamId);
    const applied = player?.lastInputSeq;
    if (!isCounter(applied)
        || data.inputFence < applied
        || data.inputFence - applied > RESYNC_INPUT_BARRIER_MAX_FENCE_LEAD) return null;

    if (barrier.status === 'requirement') {
        return barrier.inputFence === data.inputFence ? barrier : null;
    }
    clearHostPrepareRetry(game, barrier);
    barrier.status = 'requirement';
    barrier.inputFence = data.inputFence;
    barrier.readyAt = timestamp;
    barrier.expiresAt = Math.min(
        Number.MAX_SAFE_INTEGER,
        timestamp + RESYNC_INPUT_BARRIER_COMPLETION_TIMEOUT_MS,
    );
    record(game, 'resync_input_requirement', {
        steamId,
        requestId: barrier.requestId,
        inputFence: barrier.inputFence,
        appliedInputSeq: applied,
    });
    return barrier;
}

/**
 * Return the exact tuple to stamp into a resync once the host has applied the
 * peer's final command. The requirement remains installed until its caller
 * completes or explicitly cancels the transfer.
 *
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @returns {ResyncInputCompletion|null}
 */
export function getSatisfiedHostResyncRequirement(game, steamId) {
    if (game.isHost !== true || !isPlayerId(steamId)) return null;
    const timestamp = now(game);
    expireHostBarriers(game, timestamp);
    const barrier = getHostBarriers(game).get(steamId);
    if (!barrier || barrier.status !== 'requirement'
        || !isCounter(barrier.inputFence)
        || barrier.roundGeneration !== game.roundGeneration) return null;
    const inputAck = game.players?.get?.(steamId)?.lastInputSeq;
    if (!isCounter(inputAck) || inputAck < barrier.inputFence) return null;
    return {
        requestId: barrier.requestId,
        roundGeneration: barrier.roundGeneration,
        deadlineAt: barrier.deadlineAt,
        inputFencePlayerId: barrier.inputFencePlayerId,
        inputFence: barrier.inputFence,
        inputAck,
    };
}

/** @param {any[]} entries @param {number} inputAck */
function pruneAcknowledged(entries, inputAck) {
    return entries.filter((entry) => isCounter(entry?.seq) && entry.seq > inputAck);
}

/**
 * Side-effect-free preflight for an incoming authoritative resync. Call this
 * before applying its board/sidecar state; only a matching live READY tuple is
 * eligible to mutate the peer. The returned copy is safe to retain while the
 * resync transaction commits.
 *
 * @param {Record<string, any>} game
 * @param {Record<string, any>} state
 * @returns {ResyncInputCompletion|null}
 */
export function validatePeerResyncCompletion(game, state) {
    const barrier = game.peerResyncInputBarrier;
    if (!barrier || barrier.readySentAt === null || !state
        || now(game) > barrier.localDeadlineAt
        || game.roundGeneration !== barrier.roundGeneration
        || state.requestId !== barrier.requestId
        || state.roundGeneration !== barrier.roundGeneration
        || state.deadlineAt !== barrier.deadlineAt
        || state.inputFencePlayerId !== barrier.inputFencePlayerId
        || state.inputFence !== barrier.inputFence
        || !isCounter(state.inputAck)
        || state.inputAck < barrier.inputFence
        || state.inputAck - barrier.inputFence > RESYNC_INPUT_BARRIER_MAX_FENCE_LEAD) return null;
    return {
        requestId: barrier.requestId,
        roundGeneration: barrier.roundGeneration,
        deadlineAt: barrier.deadlineAt,
        inputFencePlayerId: barrier.inputFencePlayerId,
        inputFence: barrier.inputFence,
        inputAck: state.inputAck,
    };
}

/**
 * Validate the authoritative resync tuple before releasing input. Invalid or
 * stale state leaves the barrier frozen and all command history untouched.
 *
 * @param {Record<string, any>} game
 * @param {Record<string, any>} state
 * @returns {{inputAck: number, prunedPendingInputs: number, prunedInputHistory: number}|null}
 */
export function completePeerResyncBarrier(game, state) {
    const barrier = game.peerResyncInputBarrier;
    if (!barrier) return null;
    const timestamp = now(game);
    if (timestamp > barrier.localDeadlineAt) {
        cancelPeerResyncBarrier(game, 'timeout');
        return null;
    }
    if (game.roundGeneration !== barrier.roundGeneration) {
        cancelPeerResyncBarrier(game, 'restart');
        return null;
    }
    const completion = validatePeerResyncCompletion(game, state);
    if (!completion) return null;
    return commitValidatedPeerResyncCompletion(game, completion);
}

/**
 * Commit a tuple already accepted by `validatePeerResyncCompletion`. The
 * synchronous authoritative apply may cross the wall-clock deadline, so this
 * phase checks token identity but deliberately does not open a second timeout
 * boundary after state mutation has begun.
 * @param {Record<string, any>} game
 * @param {ResyncInputCompletion} completion
 */
export function commitValidatedPeerResyncCompletion(game, completion) {
    const barrier = game.peerResyncInputBarrier;
    if (!barrier || barrier.readySentAt === null
        || completion.requestId !== barrier.requestId
        || completion.roundGeneration !== barrier.roundGeneration
        || completion.deadlineAt !== barrier.deadlineAt
        || completion.inputFencePlayerId !== barrier.inputFencePlayerId
        || completion.inputFence !== barrier.inputFence
        || !isCounter(completion.inputAck)
        || completion.inputAck < barrier.inputFence) return null;
    const pendingInputs = Array.isArray(game.pendingInputs) ? game.pendingInputs : [];
    const inputHistory = Array.isArray(game.inputHistory) ? game.inputHistory : [];
    const nextPendingInputs = pruneAcknowledged(pendingInputs, completion.inputAck);
    const nextInputHistory = pruneAcknowledged(inputHistory, completion.inputAck);
    const result = {
        inputAck: completion.inputAck,
        prunedPendingInputs: pendingInputs.length - nextPendingInputs.length,
        prunedInputHistory: inputHistory.length - nextInputHistory.length,
    };
    game.pendingInputs = nextPendingInputs;
    game.inputHistory = nextInputHistory;
    game.inputSequence = Math.max(
        isCounter(game.inputSequence) ? game.inputSequence : 0,
        completion.inputAck,
    );
    game.peerResyncInputBarrier = null;
    game.resyncInputFrozen = barrier.wasInputFrozen;
    record(game, 'resync_input_completed', {
        requestId: barrier.requestId,
        inputFence: barrier.inputFence,
        inputAck: completion.inputAck,
    });
    return result;
}

/**
 * Cancel one peer barrier on timeout, restart, disconnect, or supersession.
 * @param {Record<string, any>} game
 * @param {string} [reason]
 * @returns {PeerResyncInputBarrier|null}
 */
export function cancelPeerResyncBarrier(game, reason = 'cancelled') {
    const barrier = game.peerResyncInputBarrier;
    if (!barrier) return null;
    game.peerResyncInputBarrier = null;
    game.resyncInputFrozen = barrier.wasInputFrozen === true;
    record(game, 'resync_input_barrier_cancelled', {
        role: 'peer',
        requestId: barrier.requestId,
        reason: normalizeReason(reason),
    });
    return barrier;
}

/**
 * Cancel one host prepare/requirement.
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {string} [reason]
 * @param {string} [expectedRequestId]
 * @returns {HostResyncInputBarrier|null}
 */
export function cancelHostResyncBarrier(game, steamId, reason = 'cancelled', expectedRequestId = undefined) {
    if (!(game.hostResyncInputBarriers instanceof Map)) return null;
    const barrier = game.hostResyncInputBarriers.get(steamId);
    if (!barrier) return null;
    if (expectedRequestId !== undefined && barrier.requestId !== expectedRequestId) return null;
    clearHostPrepareRetry(game, barrier);
    const context = createFfaResyncContext(/** @type {any} */ (game));
    abortResyncTransfersForPeer(context, steamId, normalizeReason(reason));
    game.hostResyncInputBarriers.delete(steamId);
    removePendingResync(game, steamId);
    record(game, 'resync_input_barrier_cancelled', {
        role: 'host', steamId, requestId: barrier.requestId, reason: normalizeReason(reason),
    });
    return barrier;
}

/**
 * Round-restart/disposal helper: release peer input and discard every host
 * token so an old READY cannot authorize a new-round capture.
 * @param {Record<string, any>} game
 * @param {string} [reason]
 */
export function cancelResyncInputBarriers(game, reason = 'restart') {
    cancelPeerResyncBarrier(game, reason);
    if (!(game.hostResyncInputBarriers instanceof Map)) return;
    for (const steamId of Array.from(game.hostResyncInputBarriers.keys())) {
        cancelHostResyncBarrier(game, steamId, reason);
    }
}
