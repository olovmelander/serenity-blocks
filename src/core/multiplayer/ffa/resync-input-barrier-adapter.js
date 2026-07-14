// @ts-check

import { MessageTypes } from '../../network/message-types.js';
import { stageFfaInputRecovery } from '../ffa-input-batching.js';
import {
    abortResyncTransfersForPeer,
    handleResyncAck,
    startResyncTransfer,
} from './resync-coordinator.js';
import { createFfaResyncContext } from './resync-context.js';
import {
    handleFfaResyncRequest,
    routeFfaResync,
} from './resync-request-handler.js';
import {
    acceptHostResyncReady,
    beginPeerResyncBarrier,
    cancelHostResyncBarrier,
    cancelResyncInputBarriers as cancelCoreResyncInputBarriers,
    commitValidatedPeerResyncCompletion,
    drainPeerResyncBarrier,
    getSatisfiedHostResyncRequirement,
    validatePeerResyncCompletion,
} from './resync-input-barrier.js';
import {
    handleHostResyncRejection,
    isResyncRejectionReason,
    resetHostResyncRetries,
} from './resync-retry-policy.js';

/** @param {Record<string, any>|undefined} data */
export function classifyFfaResyncAck(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'invalid';
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(data, key);
    if ((hasOwn('requestResync') && typeof data.requestResync !== 'boolean')
        || (hasOwn('rejected') && typeof data.rejected !== 'boolean')
        || (hasOwn('isFinal') && typeof data.isFinal !== 'boolean')) return 'invalid';

    const requestsResync = data.requestResync === true;
    const rejectsTransfer = data.rejected === true;
    const completesTransfer = data.isFinal === true;
    const acknowledgesChunk = data.chunkIndex !== null && data.chunkIndex !== undefined;
    const variants = Number(requestsResync) + Number(rejectsTransfer)
        + Number(completesTransfer) + Number(acknowledgesChunk);
    if (variants !== 1) return 'invalid';
    if (requestsResync) return 'request';
    if (typeof data.resyncId !== 'string' || data.resyncId.length === 0) return 'invalid';
    if (rejectsTransfer) {
        return isResyncRejectionReason(data.reason) ? 'rejection' : 'invalid';
    }
    if (completesTransfer) return 'final';
    return Number.isSafeInteger(data.chunkIndex) && data.chunkIndex >= 0
        ? 'chunk' : 'invalid';
}

/** @param {Record<string, any>} game @param {{register: Function}} registry */
export function registerFfaResyncInputBarrierHandlers(game, registry) {
    registry.register(MessageTypes.GAME_STATE_RESYNC_PREPARE, (msg) => {
        if (game.isHost || !msg?.from || msg.from !== game.network?.hostSteamId) return;
        beginPeerResyncBarrier(game, msg.data, {
            flush: () => {
                stageFfaInputRecovery(game);
                game.flushInputBatch();
            },
        });
    });
    registry.register(MessageTypes.GAME_STATE_RESYNC_READY, (msg) => {
        if (!game.isHost) return;
        if (acceptHostResyncReady(game, msg.from, msg.data)) game.queueResync(msg.from);
    });
}

/** @param {Record<string, any>} game */
export function drainFfaPeerResyncInputBarrier(game) {
    return drainPeerResyncBarrier(game, {
        sendReady: (payload) => game.network.sendP2PMessage(
            game.network.hostSteamId,
            MessageTypes.GAME_STATE_RESYNC_READY,
            payload,
        ),
    });
}

/** @param {Record<string, any>} game @param {string} steamId */
export function getFfaSatisfiedResyncInputRequirement(game, steamId) {
    return getSatisfiedHostResyncRequirement(game, steamId);
}

/** @param {Record<string, any>} game @param {Record<string, any>} state */
export function preflightFfaResyncInputBarrier(game, state) {
    if (!game.peerResyncInputBarrier) {
        return state.inputBarrier == null
            ? { accepted: true, completion: null }
            : { accepted: false, reason: 'unexpected_input_barrier' };
    }
    const completion = validatePeerResyncCompletion(game, state.inputBarrier);
    const authoritativePlayer = state.resyncSidecar?.players?.find?.(
        (player) => player.steamId === game.localPlayerId,
    );
    const authoritativeAck = authoritativePlayer?.wrapper?.lastInputSeq;
    if (completion && (!Number.isSafeInteger(authoritativeAck)
        || authoritativeAck < completion.inputAck)) {
        return { accepted: false, reason: 'authoritative_input_ack_unmet' };
    }
    return completion
        ? { accepted: true, completion }
        : { accepted: false, reason: 'local_input_fence_unmet' };
}

/** @param {Record<string, any>} game @param {Record<string, any>|null} completion */
export function completeFfaResyncInputBarrier(game, completion) {
    return completion
        ? commitValidatedPeerResyncCompletion(game, /** @type {any} */ (completion)) : null;
}

/** @param {Record<string, any>} game @param {string} steamId @param {string} reason */
export function retireFfaPeerResync(game, steamId, reason) {
    const context = createFfaResyncContext(/** @type {any} */ (game));
    const abortedTransfers = abortResyncTransfersForPeer(context, steamId, reason);
    const barrier = cancelHostResyncBarrier(game, steamId, reason);
    resetHostResyncRetries(game, steamId);
    return { abortedTransfers, barrier };
}

/** @param {Record<string, any>} game @param {Record<string, any>} transfer @param {string} reason */
export function retireFfaTransferBarrier(game, transfer, reason) {
    const requestId = transfer?.inputBarrier?.requestId;
    const barrier = requestId
        ? cancelHostResyncBarrier(game, transfer.steamId, reason, requestId) : null;
    if (barrier) resetHostResyncRetries(game, transfer.steamId);
    return barrier;
}

/** @param {Record<string, any>} game @param {{from?: string, data?: Record<string, any>}} msg */
export function handleFfaResyncRejection(game, msg) {
    return handleHostResyncRejection(game, msg, {
        clearTimer: (timer) => clearInterval(
            /** @type {ReturnType<typeof setInterval>} */ (timer),
        ),
        cancelBarrier: (steamId, requestId) => cancelHostResyncBarrier(
            game,
            steamId,
            'receiver_rejected',
            requestId,
        ),
        routeResync: (steamId, reason) => routeFfaResync(game, steamId, reason),
        failPeer: (steamId, reason) => game.kickPlayer?.(steamId, reason),
    });
}

/**
 * Default-deny the overloaded ACK envelope before routing one exclusive
 * request, chunk ACK, final ACK, or terminal rejection variant.
 * @param {Record<string, any>} game
 * @param {{from?: string, data?: Record<string, any>}} msg
 */
export function handleFfaResyncAck(game, msg) {
    const variant = typeof msg?.from === 'string'
        ? classifyFfaResyncAck(msg?.data) : 'invalid';
    if (variant === 'invalid') {
        game._recordNetEvent?.('resync_ack_rejected', {
            steamId: msg?.from || null,
            reason: 'invalid_variant',
        });
        return false;
    }
    if (variant === 'request') return handleFfaResyncRequest(game, msg);
    if (game.isHost !== true) {
        game._recordNetEvent?.('resync_ack_rejected', {
            steamId: msg?.from || null,
            reason: 'non_host_receiver',
        });
        return false;
    }
    if (variant === 'rejection') return handleFfaResyncRejection(game, msg);

    const transfer = game.resyncTransfers?.get?.(msg.data?.resyncId);
    const completed = handleResyncAck(
        createFfaResyncContext(/** @type {any} */ (game)),
        /** @type {any} */ (msg),
    );
    if (completed && transfer?.steamId === msg.from) {
        retireFfaTransferBarrier(game, transfer, 'completed');
    }
    return completed || variant === 'chunk';
}

/** @param {Record<string, any>} game @param {string} reason */
export function cancelResyncInputBarriers(game, reason) {
    resetHostResyncRetries(game);
    return cancelCoreResyncInputBarriers(game, reason);
}

/** @param {Record<string, any>} game @param {string} steamId @param {Record<string, any>|null} barrier */
export function startFfaResyncTransfer(game, steamId, barrier) {
    const context = createFfaResyncContext(/** @type {any} */ (game));
    return startResyncTransfer(context, steamId, { inputBarrier: barrier });
}

export { cancelHostResyncBarrier };
