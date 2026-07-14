// @ts-check

/** Terminal reasons a receiver may report without exposing parser details. */
export const RESYNC_REJECTION_REASONS = Object.freeze({
    ASSEMBLY_INVALID: 'assembly_invalid',
    PAYLOAD_INVALID: 'payload_invalid',
    SIDECAR_INVALID: 'sidecar_invalid',
    APPLY_REJECTED: 'apply_rejected',
    APPLY_FAILED: 'apply_failed',
    APPLY_TIMEOUT: 'apply_timeout',
});

export const RESYNC_FRESH_CAPTURE_RETRY_LIMIT = 2;
export const RESYNC_REJECTION_TTL_MS = 30000;
export const RESYNC_REJECTION_CACHE_LIMIT = 64;

/** @type {Set<string>} */
const VALID_REASONS = new Set(Object.values(RESYNC_REJECTION_REASONS));
/** @type {WeakMap<object, Map<string, {rejectedAt: number, reason: string}>>} */
const inboundRejectionsByOwner = new WeakMap();
/** @type {WeakMap<object, Map<string, {roundGeneration: number, attempts: number}>>} */
const hostRetriesByOwner = new WeakMap();

/** @param {unknown} reason @returns {reason is string} */
export function isResyncRejectionReason(reason) {
    return typeof reason === 'string' && VALID_REASONS.has(reason);
}

/** @param {object} owner */
function getInboundRejections(owner) {
    let entries = inboundRejectionsByOwner.get(owner);
    if (!entries) {
        entries = new Map();
        inboundRejectionsByOwner.set(owner, entries);
    }
    return entries;
}

/**
 * Remember one terminal receiver verdict and send its idempotent wire response.
 * Replayed chunks may replay the response, but never re-run validation/apply.
 * @param {{state: object, now: () => number, sendAck: Function, recordEvent: Function}} context
 * @param {{completionKey: string, resyncId: string, from: string}} transfer
 * @param {unknown} reason
 */
export function rejectInboundResync(context, transfer, reason) {
    const normalizedReason = isResyncRejectionReason(reason)
        ? reason : RESYNC_REJECTION_REASONS.PAYLOAD_INVALID;
    const entries = getInboundRejections(context.state);
    let rejection = entries.get(transfer.completionKey);
    if (!rejection) {
        rejection = {
            rejectedAt: context.now(),
            reason: normalizedReason,
        };
        entries.set(transfer.completionKey, rejection);
        while (entries.size > RESYNC_REJECTION_CACHE_LIMIT) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            entries.delete(oldest);
        }
        context.recordEvent('resync_rejected', {
            resyncId: transfer.resyncId,
            from: transfer.from,
            reason: normalizedReason,
        });
    }
    context.sendAck({
        resyncId: transfer.resyncId,
        rejected: true,
        reason: rejection.reason,
    });
    return rejection.reason;
}

/**
 * Replay a cached terminal verdict for a late chunk without rebuilding state.
 * @param {{state: object, now: () => number, sendAck: Function}} context
 * @param {string} completionKey
 * @param {string} resyncId
 */
export function replayInboundResyncRejection(context, completionKey, resyncId) {
    const entries = inboundRejectionsByOwner.get(context.state);
    const rejection = entries?.get(completionKey);
    if (!rejection) return false;
    if (context.now() - rejection.rejectedAt > RESYNC_REJECTION_TTL_MS) {
        entries.delete(completionKey);
        return false;
    }
    context.sendAck({ resyncId, rejected: true, reason: rejection.reason });
    return true;
}

/** @param {object} owner */
export function resetInboundResyncRejections(owner) {
    inboundRejectionsByOwner.delete(owner);
}

/**
 * Retire a transfer-bound rejection and either start a fresh capture or fail
 * the peer closed after the bounded retry budget.
 * @param {Record<string, any>} game
 * @param {{from?: string, data?: Record<string, any>}} msg
 * @param {{
 *   clearTimer: (timer: unknown) => void,
 *   cancelBarrier: (steamId: string, requestId: string|undefined) => unknown,
 *   routeResync: (steamId: string, reason: string) => boolean,
 *   failPeer: (steamId: string, reason: string) => void,
 * }} actions
 */
export function handleHostResyncRejection(game, msg, actions) {
    const { resyncId, rejected, reason } = msg.data || {};
    if (game.isHost !== true || rejected !== true || typeof resyncId !== 'string'
        || !isResyncRejectionReason(reason)) return false;
    const transfer = game.resyncTransfers?.get?.(resyncId);
    if (!transfer || transfer.steamId !== msg.from) return false;

    if (transfer.timer != null) actions.clearTimer(transfer.timer);
    transfer.timer = null;
    game.resyncTransfers.delete(resyncId);
    if (game.downloadJoinPeers?.get?.(transfer.steamId)?.resyncId === resyncId) {
        game.downloadJoinPeers.delete(transfer.steamId);
    }
    const requestId = transfer.inputBarrier?.requestId;
    if (typeof requestId === 'string') actions.cancelBarrier(transfer.steamId, requestId);
    game._recordNetEvent?.('resync_transfer_rejected', {
        steamId: transfer.steamId,
        resyncId,
        reason,
    });

    let byPeer = hostRetriesByOwner.get(game);
    if (!byPeer) {
        byPeer = new Map();
        hostRetriesByOwner.set(game, byPeer);
    }
    const roundGeneration = Math.max(0, Math.floor(Number(game.roundGeneration) || 0));
    const previous = byPeer.get(transfer.steamId);
    const attempts = previous?.roundGeneration === roundGeneration
        ? previous.attempts + 1 : 1;
    byPeer.set(transfer.steamId, { roundGeneration, attempts });

    if (attempts <= RESYNC_FRESH_CAPTURE_RETRY_LIMIT) {
        game._recordNetEvent?.('resync_retry_scheduled', {
            steamId: transfer.steamId,
            rejectedResyncId: resyncId,
            reason,
            attempt: attempts,
        });
        if (actions.routeResync(transfer.steamId, `retry_${reason}`) === true) return true;
    }

    byPeer.delete(transfer.steamId);
    game._recordNetEvent?.('resync_retry_exhausted', {
        steamId: transfer.steamId,
        rejectedResyncId: resyncId,
        reason,
        attempts,
    });
    actions.failPeer(transfer.steamId, 'resync_retry_exhausted');
    return true;
}

/** @param {object} owner @param {string|null} [steamId] */
export function resetHostResyncRetries(owner, steamId = null) {
    const entries = hostRetriesByOwner.get(owner);
    if (!entries) return;
    if (steamId !== null) {
        entries.delete(steamId);
        if (entries.size === 0) hostRetriesByOwner.delete(owner);
        return;
    }
    hostRetriesByOwner.delete(owner);
}

/** @param {object} owner @param {string} steamId */
export function getHostResyncRetryCount(owner, steamId) {
    return hostRetriesByOwner.get(owner)?.get(steamId)?.attempts || 0;
}
