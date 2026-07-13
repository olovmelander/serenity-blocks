// @ts-check

import { JOIN_LIFECYCLE_EVENTS } from './join-lifecycle.js';
import {
    rejectInboundResync,
    replayInboundResyncRejection,
    resetInboundResyncRejections,
    RESYNC_REJECTION_REASONS,
} from './resync-retry-policy.js';

/**
 * Resync transfer primitives (remediation plan §6A.2).
 *
 * Byte framing, transfer defaults, bounded send/retry state, acknowledgements,
 * and receive assembly live here. Protocol transport and snapshot semantics are
 * injected so this module stays independent of FFAGameStateP2P and the codec.
 */

export const RESYNC_CHUNK_SIZE = 16 * 1024;
export const RESYNC_WINDOW = 4;
export const RESYNC_TIMEOUT_MS = 300;
export const RESYNC_MAX_RETRIES = 5;
export const DOWNLOAD_JOIN_TIMEOUT_MS = 15000;
export const RESYNC_COMPLETION_TTL_MS = 30000;
export const RESYNC_COMPLETION_LIMIT = 64;
export const RESYNC_MAX_TRANSFER_BYTES = 4 * 1024 * 1024;
export const RESYNC_MAX_CHUNK_BYTES = 64 * 1024;
export const RESYNC_MAX_CHUNKS = 256;
export const RESYNC_INBOUND_TIMEOUT_MS = 15000;
export const RESYNC_APPLY_RETRY_MS = 16;

/**
 * @typedef {Object} ResyncChunkOptions
 * @property {string} resyncId
 * @property {string|null} [downloadEpoch]
 * @property {number} [chunkSize]
 * @property {Record<string, any>|null} [inputBarrier]
 * @property {number} baselineSnapshotSeq
 * @property {number} baselineSimTick
 * @property {number} roundGeneration
 */

/**
 * @typedef {Object} ResyncWireChunk
 * @property {string} resyncId
 * @property {number} chunkIndex
 * @property {number} chunkCount
 * @property {number} byteOffset
 * @property {number} crc32
 * @property {string} data
 * @property {string|null} downloadEpoch
 * @property {number} baselineSnapshotSeq
 * @property {number} baselineSimTick
 * @property {number} roundGeneration
 */

/** @typedef {{bytes: Uint8Array, byteOffset: number}} ResyncBufferChunk */

/**
 * @typedef {Object} ResyncTransfer
 * @property {string} resyncId
 * @property {string|null} downloadEpoch
 * @property {string} steamId
 * @property {ResyncWireChunk[]} chunks
 * @property {Set<number>} inFlight
 * @property {Map<number, number>} retries
 * @property {Map<number, number>} lastSentAt
 * @property {number} cursor
 * @property {ReturnType<typeof setInterval>|null} timer
 * @property {number|null} awaitingFinalSince
 * @property {Record<string, any>|null} inputBarrier
 */

/**
 * @typedef {Object} ResyncBuffer
 * @property {string} from
 * @property {number} chunkCount
 * @property {Map<number, ResyncBufferChunk>} chunks
 * @property {number} received
 * @property {number} receivedBytes
 * @property {number} startedAt
 * @property {string|null|undefined} downloadEpoch
 * @property {number|undefined} baselineSnapshotSeq
 * @property {number|undefined} baselineSimTick
 * @property {number|undefined} roundGeneration
 */

/**
 * @typedef {Object} ResyncFence
 * @property {number} migrationEpoch
 * @property {number} roundGeneration
 * @property {number} snapshotSeq
 * @property {number} simTick
 */

/**
 * @typedef {Object} PendingInboundResyncApply
 * @property {string} from
 * @property {string} resyncId
 * @property {string} completionKey
 * @property {string|null|undefined} downloadEpoch
 * @property {Record<string, any>} stateToApply
 * @property {unknown} decodedSnapshot
 * @property {boolean} hasBinaryBaseline
 * @property {ResyncFence|null} fence
 * @property {number} queuedAt
 * @property {ReturnType<typeof setTimeout>|null} timer
 */

/**
 * Mutable transfer state retained by FFAGameStateP2P during the staged
 * extraction. The coordinator receives runtime work through ResyncContext, so
 * it has no dependency back into the god class, protocol enum, or snapshot
 * implementation.
 * @typedef {Object} ResyncState
 * @property {boolean} isHost
 * @property {string} localPlayerId
 * @property {Map<string, ResyncTransfer>} resyncTransfers
 * @property {Map<string, ResyncBuffer>} resyncBuffers
 * @property {Map<string, {completedAt: number}>} [completedResyncs]
 * @property {string[]} [pendingResyncs]
 * @property {PendingInboundResyncApply|null} [pendingInboundResyncApply]
 * @property {ResyncFence|null} [lastAppliedResyncFence]
 * @property {number} resyncChunkSize
 * @property {number} resyncWindow
 * @property {number} resyncTimeoutMs
 * @property {number} resyncMaxRetries
 * @property {boolean} _downloadJoinEnabled
 * @property {Map<string, {resyncId: string, downloadEpoch: string|null, startedAt: number, snapshotSeq: number, simTick: number, roundGeneration: number}>} downloadJoinPeers
 * @property {{resyncId: string, downloadEpoch: string, startedAt: number, snapshotSeq?: number, simTick?: number, roundGeneration?: number}|null} downloadJoinInProgress
 */

/**
 * @typedef {Object} ResyncContext
 * @property {ResyncState} state
 * @property {() => number} now
 * @property {() => string} createTransferId
 * @property {(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>} scheduleInterval
 * @property {(timer: ReturnType<typeof setInterval>|null) => void} clearInterval
 * @property {(callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>} [scheduleTimeout]
 * @property {(timer: ReturnType<typeof setTimeout>|null) => void} [clearTimeout]
 * @property {(meta: {resyncId: string, downloadEpoch: string|null, inputBarrier: Record<string, any>|null}) => {header: {snapshotSeq: number, simTick: number, roundGeneration: number, joinSyncpoint?: unknown}, [key: string]: unknown}} buildPayload
 * @property {(transfer: ResyncTransfer) => void} sendWindow
 * @property {(transfer: ResyncTransfer, chunk: ResyncWireChunk) => void} dispatchChunk
 * @property {(steamId: string, chunk: ResyncWireChunk) => void} sendChunkMessage
 * @property {(transfer: ResyncTransfer) => void} tickTransfer
 * @property {(details: {resyncId: string, chunkIndex: number|null, isFinal: boolean}) => void} sendAck
 * @property {(buffer: ArrayBuffer) => unknown} decodeSnapshot
 * @property {(snapshot: unknown, metadata: Record<string, unknown>) => Record<string, any>} hydrateSnapshot
 * @property {(sidecar: unknown, context: {header: Record<string, any>, packedSnapshot: unknown}) => unknown} [validateSidecar]
 * @property {(from: string, snapshot: unknown) => void} setIncomingBaseline
 * @property {(state: Record<string, any>) => unknown} applyState
 * @property {() => boolean} [canApplyState]
 * @property {(event: string, details: Record<string, unknown>) => void} recordEvent
 * @property {(event: string, details: Record<string, unknown>) => void} [transitionJoin]
 * @property {(steamId: string) => void} [forceNextKeyframe]
 * @property {(transfer: ResyncTransfer) => void} [onTransferCompleted]
 */

/**
 * @typedef {Object} ResyncDisposableState
 * @property {Map<unknown, {timer?: unknown}>} [resyncTransfers]
 * @property {Map<unknown, unknown>} [resyncBuffers]
 * @property {Map<unknown, unknown>} [completedResyncs]
 * @property {{timer?: unknown}|null} [pendingInboundResyncApply]
 * @property {unknown} [lastAppliedResyncFence]
 * @property {Array<unknown>} [pendingResyncs]
 * @property {Map<unknown, unknown>} [resyncRequestAtByPeer]
 * @property {Map<unknown, unknown>} [downloadJoinPeers]
 * @property {unknown} [downloadJoinInProgress]
 */

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[i] = c >>> 0;
    }
    return table;
})();

/** @param {Uint8Array} bytes */
export function crc32(bytes) {
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

/** @param {string} value */
export function encodeUtf8(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'utf8'));
    return Uint8Array.from(unescape(encodeURIComponent(value)).split('')
        .map((character) => character.charCodeAt(0)));
}

/** @param {Uint8Array} bytes */
export function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    return decodeURIComponent(escape(String.fromCharCode(...bytes)));
}

/** @param {Uint8Array} bytes */
export function encodeBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
}

/** @param {string} base64 */
export function decodeBase64(base64) {
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(base64, 'base64'));
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Build exact wire chunks without taking ownership of the snapshot envelope.
 * @param {Uint8Array} bytes
 * @param {ResyncChunkOptions} options
 * @returns {ResyncWireChunk[]}
 */
export function createResyncChunks(bytes, {
    resyncId,
    downloadEpoch = null,
    chunkSize = RESYNC_CHUNK_SIZE,
    baselineSnapshotSeq,
    baselineSimTick,
    roundGeneration,
}) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0
        || bytes.length > RESYNC_MAX_TRANSFER_BYTES) {
        throw new RangeError('Resync payload exceeds the bounded transfer size');
    }
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > RESYNC_MAX_CHUNK_BYTES) {
        throw new RangeError('Resync chunk size is outside the supported range');
    }
    const chunkCount = Math.ceil(bytes.length / chunkSize);
    if (chunkCount > RESYNC_MAX_CHUNKS) {
        throw new RangeError('Resync payload requires too many chunks');
    }
    const chunks = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const byteOffset = chunkIndex * chunkSize;
        const slice = bytes.slice(byteOffset, Math.min(bytes.length, byteOffset + chunkSize));
        chunks.push({
            resyncId,
            chunkIndex,
            chunkCount,
            byteOffset,
            crc32: crc32(slice),
            data: encodeBase64(slice),
            downloadEpoch,
            baselineSnapshotSeq,
            baselineSimTick,
            roundGeneration,
        });
    }
    return chunks;
}

/**
 * Decode one wire chunk, rejecting corruption before it enters an assembly buffer.
 * @param {string|undefined} data
 * @param {number|undefined} expectedCrc
 * @returns {Uint8Array|null}
 */
export function decodeResyncChunk(data, expectedCrc) {
    if (typeof data !== 'string' || data.length === 0
        || data.length > Math.ceil(RESYNC_MAX_CHUNK_BYTES / 3) * 4 + 4
        || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
    try {
        const bytes = decodeBase64(data);
        if (bytes.length === 0 || bytes.length > RESYNC_MAX_CHUNK_BYTES) return null;
        return expectedCrc === crc32(bytes) ? bytes : null;
    } catch {
        return null;
    }
}

/** @param {ResyncBuffer} buffer */
function hasContiguousBoundedAssembly(buffer) {
    const chunks = Array.from(buffer.chunks.values())
        .sort((left, right) => left.byteOffset - right.byteOffset);
    let expectedOffset = 0;
    for (const chunk of chunks) {
        if (chunk.byteOffset !== expectedOffset) return false;
        expectedOffset += chunk.bytes.length;
        if (expectedOffset > RESYNC_MAX_TRANSFER_BYTES) return false;
    }
    return expectedOffset > 0;
}

/**
 * Merge offset-stamped chunks after the receiver has collected the full set.
 * @param {Iterable<ResyncBufferChunk>} chunks
 */
export function mergeResyncChunks(chunks) {
    const ordered = Array.from(chunks);
    const totalLength = ordered.reduce(
        (max, chunk) => Math.max(max, chunk.byteOffset + chunk.bytes.length),
        0,
    );
    const merged = new Uint8Array(totalLength);
    ordered.forEach((chunk) => { merged.set(chunk.bytes, chunk.byteOffset); });
    return merged;
}

/**
 * Start one bounded host-to-peer transfer. Active transfers are coalesced per
 * peer so repeated divergence reports cannot fan out into parallel snapshots.
 * @param {ResyncContext} context
 * @param {string} steamId
 * @param {{inputBarrier?: Record<string, any>|null}} [options]
 */
export function startResyncTransfer(context, steamId, options = {}) {
    const { state: owner } = context;
    if (!owner.isHost) return false;
    for (const transfer of owner.resyncTransfers.values()) {
        if (transfer.steamId === steamId) return false;
    }

    const resyncId = context.createTransferId();
    const downloadEpoch = owner._downloadJoinEnabled ? resyncId : null;
    const inputBarrier = options.inputBarrier ?? null;
    const payload = context.buildPayload({ resyncId, downloadEpoch, inputBarrier });
    const { header } = payload;
    const bytes = encodeUtf8(JSON.stringify(payload));
    const chunks = createResyncChunks(bytes, {
        resyncId,
        downloadEpoch,
        chunkSize: owner.resyncChunkSize,
        baselineSnapshotSeq: header.snapshotSeq,
        baselineSimTick: header.simTick,
        roundGeneration: header.roundGeneration,
    });

    /** @type {ResyncTransfer} */
    const transfer = {
        resyncId,
        downloadEpoch,
        steamId,
        chunks,
        inFlight: new Set(),
        retries: new Map(),
        lastSentAt: new Map(),
        cursor: 0,
        timer: null,
        awaitingFinalSince: null,
        inputBarrier,
    };

    owner.resyncTransfers.set(resyncId, transfer);
    if (owner._downloadJoinEnabled) {
        owner.downloadJoinPeers.set(steamId, {
            resyncId,
            downloadEpoch,
            startedAt: context.now(),
            snapshotSeq: header.snapshotSeq,
            simTick: header.simTick,
            roundGeneration: header.roundGeneration,
        });
    }
    context.recordEvent('resync_started', {
        steamId,
        resyncId,
        downloadEpoch,
        chunkCount: chunks.length,
        bytes: bytes.length,
        joinSyncpoint: header.joinSyncpoint ?? null,
    });
    context.sendWindow(transfer);
    transfer.timer = context.scheduleInterval(() => context.tickTransfer(transfer), 50);
    return true;
}

/** @param {ResyncContext} context @param {ResyncTransfer} transfer */
export function sendResyncWindow(context, transfer) {
    const { state: owner } = context;
    while (transfer.inFlight.size < owner.resyncWindow && transfer.cursor < transfer.chunks.length) {
        const chunk = transfer.chunks[transfer.cursor];
        context.dispatchChunk(transfer, chunk);
        transfer.cursor += 1;
    }
}

/**
 * @param {ResyncContext} context
 * @param {ResyncTransfer} transfer
 * @param {ResyncWireChunk} chunk
 */
export function sendResyncChunk(context, transfer, chunk) {
    context.sendChunkMessage(transfer.steamId, chunk);
    transfer.inFlight.add(chunk.chunkIndex);
    transfer.lastSentAt.set(chunk.chunkIndex, context.now());
    const retryCount = transfer.retries.get(chunk.chunkIndex) || 0;
    transfer.retries.set(chunk.chunkIndex, retryCount + 1);
}

/**
 * Retire every outbound transfer and queued capture owned by one peer. This is
 * used when connection identity changes, before a reconnect may create a fresh
 * request-specific input fence.
 * @param {ResyncContext} context
 * @param {string} steamId
 * @param {string} [reason]
 */
export function abortResyncTransfersForPeer(context, steamId, reason = 'peer_retired') {
    const { state: owner } = context;
    if (!steamId) return 0;
    if (Array.isArray(owner.pendingResyncs)) {
        owner.pendingResyncs = owner.pendingResyncs.filter((peerId) => peerId !== steamId);
    }
    if (!(owner.resyncTransfers instanceof Map)) return 0;
    let aborted = 0;
    for (const transfer of Array.from(owner.resyncTransfers.values())) {
        if (transfer.steamId !== steamId) continue;
        if (transfer.timer !== null) context.clearInterval(transfer.timer);
        transfer.timer = null;
        owner.resyncTransfers.delete(transfer.resyncId);
        if (owner.downloadJoinPeers?.get?.(steamId)?.resyncId === transfer.resyncId) {
            owner.downloadJoinPeers.delete(steamId);
        }
        context.recordEvent('resync_aborted', {
            steamId, resyncId: transfer.resyncId, reason,
        });
        aborted += 1;
    }
    return aborted;
}

/** @param {ResyncContext} context @param {ResyncTransfer} transfer */
export function tickResyncTransfer(context, transfer) {
    const { state: owner } = context;
    if (owner.resyncTransfers.get(transfer.resyncId) !== transfer) return;
    const now = context.now();
    let abort = false;
    transfer.inFlight.forEach((chunkIndex) => {
        const lastSent = transfer.lastSentAt.get(chunkIndex) || 0;
        if (now - lastSent < owner.resyncTimeoutMs) return;
        const retryCount = transfer.retries.get(chunkIndex) || 0;
        if (retryCount >= owner.resyncMaxRetries) {
            abort = true;
            return;
        }
        const chunk = transfer.chunks[chunkIndex];
        if (chunk) context.dispatchChunk(transfer, chunk);
    });

    if (abort) {
        context.clearInterval(transfer.timer);
        transfer.timer = null;
        owner.resyncTransfers.delete(transfer.resyncId);
        if (owner._downloadJoinEnabled
            && owner.downloadJoinPeers.get(transfer.steamId)?.resyncId === transfer.resyncId) {
            owner.downloadJoinPeers.delete(transfer.steamId);
        }
        context.recordEvent('resync_aborted', {
            steamId: transfer.steamId,
            resyncId: transfer.resyncId,
            inFlight: transfer.inFlight.size,
        });
        return;
    }

    if (transfer.inFlight.size !== 0 || transfer.cursor < transfer.chunks.length) return;
    if (!transfer.awaitingFinalSince) {
        transfer.awaitingFinalSince = now;
        return;
    }
    if (now - transfer.awaitingFinalSince < owner.resyncTimeoutMs * owner.resyncMaxRetries) return;

    context.clearInterval(transfer.timer);
    transfer.timer = null;
    owner.resyncTransfers.delete(transfer.resyncId);
    if (owner._downloadJoinEnabled
        && owner.downloadJoinPeers.get(transfer.steamId)?.resyncId === transfer.resyncId) {
        owner.downloadJoinPeers.delete(transfer.steamId);
    }
    context.recordEvent('resync_aborted', {
        steamId: transfer.steamId,
        resyncId: transfer.resyncId,
        reason: 'final_ack_timeout',
    });
}

/**
 * Apply host-side chunk/final acknowledgements. Resync requests remain at the
 * FFA semantic boundary where roster authorization and rate limits are known.
 * @param {ResyncContext} context
 * @param {{from: string, data?: Record<string, any>}} msg
 */
export function handleResyncAck(context, msg) {
    const { state: owner } = context;
    if (msg.data?.requestResync === true || msg.data?.rejected === true) return false;
    const { resyncId, chunkIndex, isFinal } = msg.data || {};
    const transfer = owner.resyncTransfers.get(resyncId);
    if (!transfer || transfer.steamId !== msg.from) return false;

    if (Number.isSafeInteger(chunkIndex) && chunkIndex >= 0
        && chunkIndex < transfer.cursor && chunkIndex < transfer.chunks.length
        && isFinal !== true) {
        transfer.inFlight.delete(chunkIndex);
        context.sendWindow(transfer);
        return false;
    }

    if (isFinal === true && (chunkIndex === null || chunkIndex === undefined)
        && transfer.cursor === transfer.chunks.length) {
        context.clearInterval(transfer.timer);
        transfer.timer = null;
        owner.resyncTransfers.delete(resyncId);
        if (owner._downloadJoinEnabled
            && owner.downloadJoinPeers.get(msg.from)?.resyncId === resyncId) {
            owner.downloadJoinPeers.delete(msg.from);
        }
        context.forceNextKeyframe?.(msg.from);
        context.recordEvent('resync_completed', {
            steamId: msg.from,
            resyncId,
            downloadEpoch: transfer.downloadEpoch || null,
        });
        context.onTransferCompleted?.(transfer);
        return true;
    }
    return false;
}

/** @param {unknown} value */
function isNonNegativeSafeInteger(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** @param {unknown} value */
function isValidDownloadEpoch(value) {
    return value === null || value === undefined
        || (typeof value === 'string' && value.length > 0 && value.length <= 128);
}

/**
 * Compare authoritative fences in epoch, round, snapshot, then simulation order.
 * @param {ResyncFence} left
 * @param {ResyncFence} right
 */
function compareResyncFences(left, right) {
    const fields = ['migrationEpoch', 'roundGeneration', 'snapshotSeq', 'simTick'];
    for (const field of fields) {
        if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
    }
    return 0;
}

/**
 * The chunk envelope does not carry migration epoch in the compatibility lane,
 * but transfers from one live host are still strictly ordered by these fields.
 * @param {{roundGeneration?: unknown, baselineSnapshotSeq?: unknown, baselineSimTick?: unknown}} value
 */
function transferOrder(value) {
    return {
        roundGeneration: Number(value.roundGeneration),
        snapshotSeq: Number(value.baselineSnapshotSeq),
        simTick: Number(value.baselineSimTick),
    };
}

/** @param {ReturnType<typeof transferOrder>} left @param {ReturnType<typeof transferOrder>} right */
function compareTransferOrder(left, right) {
    for (const field of ['roundGeneration', 'snapshotSeq', 'simTick']) {
        if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
    }
    return 0;
}

/** @param {Record<string, any>} state */
function readResyncFence(state) {
    const fence = {
        migrationEpoch: state.migrationEpoch ?? 0,
        roundGeneration: state.roundGeneration,
        snapshotSeq: state.snapshotSeq,
        simTick: state.simTick,
    };
    return Object.values(fence).every(isNonNegativeSafeInteger)
        ? /** @type {ResyncFence} */ (fence)
        : null;
}

/** @param {Uint8Array} left @param {Uint8Array} right */
function equalBytes(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

/** @param {ResyncBuffer} buffer @param {number} byteOffset @param {Uint8Array} bytes */
function chunkFitsBuffer(buffer, byteOffset, bytes) {
    const end = byteOffset + bytes.length;
    if (buffer.receivedBytes + bytes.length > RESYNC_MAX_TRANSFER_BYTES) return false;
    for (const chunk of buffer.chunks.values()) {
        const existingEnd = chunk.byteOffset + chunk.bytes.length;
        if (byteOffset < existingEnd && chunk.byteOffset < end) return false;
    }
    return true;
}

/** @param {ResyncContext} context @param {PendingInboundResyncApply} pending */
function clearPendingApplyTimer(context, pending) {
    if (pending.timer === null) return;
    (context.clearTimeout || clearTimeout)(pending.timer);
    pending.timer = null;
}

/** @param {ResyncContext} context */
function schedulePendingInboundApply(context) {
    const pending = context.state.pendingInboundResyncApply;
    if (!pending || pending.timer !== null || !context.scheduleTimeout) return;
    pending.timer = context.scheduleTimeout(() => {
        pending.timer = null;
        drainPendingInboundResyncApply(context);
    }, RESYNC_APPLY_RETRY_MS);
}

/** @param {ResyncContext} context @param {PendingInboundResyncApply} pending */
function rememberCompletedResync(context, pending) {
    const { state: owner } = context;
    if (!owner.completedResyncs) owner.completedResyncs = new Map();
    owner.completedResyncs.set(pending.completionKey, { completedAt: context.now() });
    while (owner.completedResyncs.size > RESYNC_COMPLETION_LIMIT) {
        const oldestKey = owner.completedResyncs.keys().next().value;
        if (oldestKey === undefined) break;
        owner.completedResyncs.delete(oldestKey);
    }
}

/**
 * Apply one fully decoded transfer only after the receiver owns an idle window.
 * Returns true only when an authoritative state was committed.
 * @param {ResyncContext} context
 */
export function drainPendingInboundResyncApply(context) {
    const { state: owner } = context;
    const pending = owner.pendingInboundResyncApply;
    if (!pending) return false;

    if (context.now() - pending.queuedAt > RESYNC_INBOUND_TIMEOUT_MS) {
        clearPendingApplyTimer(context, pending);
        owner.pendingInboundResyncApply = null;
        if (owner.downloadJoinInProgress?.resyncId === pending.resyncId) {
            owner.downloadJoinInProgress = null;
        }
        context.recordEvent('resync_apply_timeout', {
            resyncId: pending.resyncId,
            from: pending.from,
        });
        context.transitionJoin?.(JOIN_LIFECYCLE_EVENTS.DOWNLOAD_TIMED_OUT, {
            resyncId: pending.resyncId,
            downloadEpoch: pending.downloadEpoch || null,
        });
        rejectInboundResync(context, pending, RESYNC_REJECTION_REASONS.APPLY_TIMEOUT);
        return false;
    }

    if (pending.fence && owner.lastAppliedResyncFence
        && compareResyncFences(pending.fence, owner.lastAppliedResyncFence) <= 0) {
        clearPendingApplyTimer(context, pending);
        owner.pendingInboundResyncApply = null;
        rememberCompletedResync(context, pending);
        context.recordEvent('resync_superseded', {
            resyncId: pending.resyncId,
            from: pending.from,
            fence: pending.fence,
            lastAppliedFence: owner.lastAppliedResyncFence,
        });
        context.transitionJoin?.(JOIN_LIFECYCLE_EVENTS.APPLY_STARTED, {
            resyncId: pending.resyncId,
            downloadEpoch: pending.downloadEpoch || null,
        });
        context.transitionJoin?.(JOIN_LIFECYCLE_EVENTS.APPLY_SUCCEEDED, {
            resyncId: pending.resyncId,
            downloadEpoch: pending.downloadEpoch || null,
            superseded: true,
        });
        context.sendAck({ resyncId: pending.resyncId, chunkIndex: null, isFinal: true });
        return false;
    }

    if (context.canApplyState && context.canApplyState() !== true) {
        schedulePendingInboundApply(context);
        return false;
    }

    clearPendingApplyTimer(context, pending);
    owner.pendingInboundResyncApply = null;
    let applySucceeded = false;
    /** @type {string} */
    let rejectionReason = RESYNC_REJECTION_REASONS.APPLY_FAILED;
    context.transitionJoin?.(JOIN_LIFECYCLE_EVENTS.APPLY_STARTED, {
        resyncId: pending.resyncId,
        downloadEpoch: pending.downloadEpoch || null,
    });
    try {
        if (context.applyState(pending.stateToApply) === false) {
            rejectionReason = RESYNC_REJECTION_REASONS.APPLY_REJECTED;
            throw new Error('Resync state rejected by application fence');
        }
        if (pending.hasBinaryBaseline) {
            context.setIncomingBaseline(pending.from, pending.decodedSnapshot);
        }
        applySucceeded = true;
    } catch (err) {
        context.transitionJoin?.(JOIN_LIFECYCLE_EVENTS.APPLY_FAILED, {
            resyncId: pending.resyncId,
            downloadEpoch: pending.downloadEpoch || null,
        });
        console.error('Failed to apply resync payload:', err);
        rejectInboundResync(context, pending, rejectionReason);
    }

    if (!applySucceeded) return false;
    if (pending.fence) owner.lastAppliedResyncFence = pending.fence;
    owner.resyncBuffers.forEach((buffer, bufferedId) => {
        if (pending.fence && compareTransferOrder(transferOrder(buffer), {
            roundGeneration: pending.fence.roundGeneration,
            snapshotSeq: pending.fence.snapshotSeq,
            simTick: pending.fence.simTick,
        }) <= 0) owner.resyncBuffers.delete(bufferedId);
    });
    rememberCompletedResync(context, pending);
    context.transitionJoin?.(JOIN_LIFECYCLE_EVENTS.APPLY_SUCCEEDED, {
        resyncId: pending.resyncId,
        downloadEpoch: pending.downloadEpoch || null,
    });
    context.sendAck({ resyncId: pending.resyncId, chunkIndex: null, isFinal: true });
    return true;
}

/**
 * Collect and apply one peer-side transfer. Corrupt chunks are rejected before
 * buffering; exact duplicate chunks are ACKed without double-counting.
 * @param {ResyncContext} context
 * @param {{from: string, data?: Record<string, any>}} msg
 */
export function handleResyncChunk(context, msg) {
    const { state: owner } = context;
    const {
        resyncId, chunkIndex, chunkCount, byteOffset, crc32: expectedCrc, data,
        downloadEpoch, baselineSnapshotSeq, baselineSimTick, roundGeneration,
    } = msg.data || {};
    if (typeof msg.from !== 'string' || msg.from.length === 0
        || typeof resyncId !== 'string' || resyncId.length === 0 || resyncId.length > 128
        || !Number.isSafeInteger(chunkIndex)) return;

    const completionKey = `${msg.from}\u0000${resyncId}`;
    if (replayInboundResyncRejection(context, completionKey, resyncId)) return;
    const completedAt = owner.completedResyncs?.get(completionKey)?.completedAt;
    if (completedAt !== undefined) {
        if (context.now() - completedAt <= RESYNC_COMPLETION_TTL_MS) {
            context.sendAck({ resyncId, chunkIndex: null, isFinal: true });
            return;
        }
        owner.completedResyncs?.delete(completionKey);
    }

    if (!Number.isSafeInteger(chunkCount) || chunkCount <= 0 || chunkCount > RESYNC_MAX_CHUNKS
        || chunkIndex < 0 || chunkIndex >= chunkCount
        || !Number.isSafeInteger(byteOffset) || byteOffset < 0
        || !Number.isSafeInteger(expectedCrc) || expectedCrc < 0 || expectedCrc > 0xFFFFFFFF
        || !isValidDownloadEpoch(downloadEpoch)
        || !isNonNegativeSafeInteger(baselineSnapshotSeq)
        || !isNonNegativeSafeInteger(baselineSimTick)
        || !isNonNegativeSafeInteger(roundGeneration)) return;

    const bytes = decodeResyncChunk(data, expectedCrc);
    if (!bytes || byteOffset + bytes.length > RESYNC_MAX_TRANSFER_BYTES) return;
    const candidateOrder = transferOrder({
        roundGeneration, baselineSnapshotSeq, baselineSimTick,
    });
    const lastFence = owner.lastAppliedResyncFence;
    if (lastFence && compareTransferOrder(candidateOrder, {
        roundGeneration: lastFence.roundGeneration,
        snapshotSeq: lastFence.snapshotSeq,
        simTick: lastFence.simTick,
    }) <= 0) {
        owner.resyncBuffers.delete(resyncId);
        context.recordEvent('resync_superseded', { resyncId, from: msg.from });
        context.sendAck({ resyncId, chunkIndex: null, isFinal: true });
        return;
    }

    const now = context.now();
    owner.resyncBuffers.forEach((buffer, bufferedId) => {
        if (now - buffer.startedAt > RESYNC_INBOUND_TIMEOUT_MS) {
            owner.resyncBuffers.delete(bufferedId);
            context.recordEvent('resync_buffer_expired', {
                resyncId: bufferedId,
                from: buffer.from,
            });
        }
    });

    const pending = owner.pendingInboundResyncApply;
    if (pending?.resyncId === resyncId && pending.from === msg.from) {
        context.sendAck({ resyncId, chunkIndex, isFinal: false });
        return;
    }
    if (pending && pending.resyncId !== resyncId) {
        const pendingOrder = transferOrder({
            roundGeneration: pending.fence?.roundGeneration,
            baselineSnapshotSeq: pending.fence?.snapshotSeq,
            baselineSimTick: pending.fence?.simTick,
        });
        if (!pending.fence || compareTransferOrder(candidateOrder, pendingOrder) <= 0) return;
        clearPendingApplyTimer(context, pending);
        owner.pendingInboundResyncApply = null;
        context.recordEvent('resync_pending_superseded', {
            resyncId: pending.resyncId,
            byResyncId: resyncId,
        });
    }

    let existingBuffer = owner.resyncBuffers.get(resyncId);
    for (const [bufferedId, otherBuffer] of owner.resyncBuffers) {
        if (bufferedId === resyncId) continue;
        if (compareTransferOrder(candidateOrder, transferOrder(otherBuffer)) <= 0) return;
        owner.resyncBuffers.delete(bufferedId);
        context.recordEvent('resync_buffer_superseded', {
            resyncId: bufferedId,
            byResyncId: resyncId,
        });
    }
    existingBuffer = owner.resyncBuffers.get(resyncId);
    if (existingBuffer && (
        existingBuffer.from !== msg.from
        || existingBuffer.chunkCount !== chunkCount
        || existingBuffer.downloadEpoch !== downloadEpoch
        || existingBuffer.baselineSnapshotSeq !== baselineSnapshotSeq
        || existingBuffer.baselineSimTick !== baselineSimTick
        || existingBuffer.roundGeneration !== roundGeneration
    )) return;
    context.transitionJoin?.(JOIN_LIFECYCLE_EVENTS.DOWNLOAD_STARTED, {
        resyncId,
        downloadEpoch: downloadEpoch || null,
        snapshotSeq: baselineSnapshotSeq,
        simTick: baselineSimTick,
        roundGeneration,
    });

    if (owner._downloadJoinEnabled && downloadEpoch) {
        if (!owner.downloadJoinInProgress
            || owner.downloadJoinInProgress.downloadEpoch !== downloadEpoch) {
            owner.downloadJoinInProgress = {
                resyncId,
                downloadEpoch,
                startedAt: context.now(),
                snapshotSeq: baselineSnapshotSeq,
                simTick: baselineSimTick,
                roundGeneration,
            };
            context.recordEvent('download_started', {
                resyncId,
                downloadEpoch,
                snapshotSeq: baselineSnapshotSeq,
                simTick: baselineSimTick,
                roundGeneration,
            });
        }
    }

    /** @type {ResyncBuffer} */
    const buffer = existingBuffer || {
        from: msg.from,
        chunkCount,
        chunks: new Map(),
        received: 0,
        receivedBytes: 0,
        startedAt: now,
        downloadEpoch,
        baselineSnapshotSeq,
        baselineSimTick,
        roundGeneration,
    };

    const duplicate = buffer.chunks.get(chunkIndex);
    if (duplicate && (duplicate.byteOffset !== byteOffset || !equalBytes(duplicate.bytes, bytes))) {
        return;
    }
    if (!duplicate) {
        if (!chunkFitsBuffer(buffer, byteOffset, bytes)) return;
        buffer.chunks.set(chunkIndex, { bytes, byteOffset });
        buffer.received += 1;
        buffer.receivedBytes += bytes.length;
    }
    owner.resyncBuffers.set(resyncId, buffer);

    if (buffer.received !== buffer.chunkCount) {
        context.sendAck({ resyncId, chunkIndex, isFinal: false });
        return;
    }
    if (!hasContiguousBoundedAssembly(buffer)) {
        owner.resyncBuffers.delete(resyncId);
        context.recordEvent('resync_assembly_rejected', { resyncId, from: msg.from });
        rejectInboundResync(context, {
            completionKey, resyncId, from: msg.from,
        }, RESYNC_REJECTION_REASONS.ASSEMBLY_INVALID);
        return;
    }
    /** @type {string} */
    let rejectionReason = RESYNC_REJECTION_REASONS.PAYLOAD_INVALID;
    try {
        const merged = mergeResyncChunks(buffer.chunks.values());
        const payload = JSON.parse(decodeUtf8(merged));
        let stateToApply;
        let decodedSnapshot = null;
        if (payload?.encoding === 'binary-v1') {
            const header = payload.header || {};
            if (header.resyncId !== resyncId
                || header.downloadEpoch !== (downloadEpoch ?? null)
                || header.snapshotSeq !== baselineSnapshotSeq
                || header.simTick !== baselineSimTick
                || header.roundGeneration !== roundGeneration) {
                throw new Error('Resync envelope header does not match chunk metadata');
            }
            const snapshotBytes = decodeBase64(payload.snapshot || '');
            const snapshotBuffer = snapshotBytes.buffer.slice(
                snapshotBytes.byteOffset,
                snapshotBytes.byteOffset + snapshotBytes.byteLength,
            );
            const snapshot = context.decodeSnapshot(snapshotBuffer);
            if (!snapshot) throw new Error('Decoded resync snapshot is empty');
            decodedSnapshot = snapshot;
            const hydrated = context.hydrateSnapshot(snapshot, {
                roundGeneration: header.roundGeneration,
                migrationEpoch: header.migrationEpoch,
            });
            let validatedSidecar;
            if (payload.sidecar !== undefined) {
                if (!context.validateSidecar) {
                    throw new Error('Resync sidecar received without a validator');
                }
                rejectionReason = RESYNC_REJECTION_REASONS.SIDECAR_INVALID;
                validatedSidecar = context.validateSidecar(
                    payload.sidecar,
                    { header, packedSnapshot: snapshot },
                );
                rejectionReason = RESYNC_REJECTION_REASONS.PAYLOAD_INVALID;
            } else {
                context.recordEvent('resync_sidecar_missing', {
                    resyncId,
                    from: msg.from,
                    encoding: payload.encoding,
                });
            }
            stateToApply = {
                ...hydrated,
                ...header,
                ...(validatedSidecar === undefined ? {} : { resyncSidecar: validatedSidecar }),
            };
        } else {
            stateToApply = payload;
        }
        const fence = readResyncFence(stateToApply);
        /** @type {PendingInboundResyncApply} */
        const queuedApply = {
            from: msg.from,
            resyncId,
            completionKey,
            downloadEpoch,
            stateToApply,
            decodedSnapshot,
            hasBinaryBaseline: payload?.encoding === 'binary-v1',
            fence,
            queuedAt: context.now(),
            timer: null,
        };
        owner.resyncBuffers.delete(resyncId);
        owner.pendingInboundResyncApply = queuedApply;
        context.sendAck({ resyncId, chunkIndex, isFinal: false });
        drainPendingInboundResyncApply(context);
    } catch (err) {
        owner.resyncBuffers.delete(resyncId);
        rejectInboundResync(context, {
            completionKey, resyncId, from: msg.from,
        }, rejectionReason);
        console.error('Failed to parse resync payload:', err);
    }
}

/**
 * Retire only peer-side partial state when host authority changes. Outbound
 * transfers belong to the newly promoted host and must not be disposed here.
 * @param {Partial<Pick<ResyncState, 'resyncBuffers'|'completedResyncs'|'pendingInboundResyncApply'|'lastAppliedResyncFence'|'downloadJoinInProgress'>>} state
 */
export function resetInboundResyncState(state) {
    const discardedBuffers = state.resyncBuffers?.size || 0;
    const discardedDownload = state.downloadJoinInProgress != null;
    if (state.pendingInboundResyncApply?.timer != null) {
        clearTimeout(state.pendingInboundResyncApply.timer);
    }
    state.resyncBuffers?.clear();
    state.completedResyncs?.clear();
    state.pendingInboundResyncApply = null;
    state.lastAppliedResyncFence = null;
    state.downloadJoinInProgress = null;
    resetInboundResyncRejections(/** @type {object} */ (state));
    return { discardedBuffers, discardedDownload };
}

/**
 * Compute the host's live-snapshot exclusion set and expire abandoned joins.
 * @param {Pick<ResyncState, '_downloadJoinEnabled'|'downloadJoinPeers'>} state
 * @param {{now: () => number, recordEvent: (event: string, details: Record<string, unknown>) => void, timeoutMs?: number}} context
 */
export function getDownloadJoinBlockedPeers(state, {
    now,
    recordEvent,
    timeoutMs = DOWNLOAD_JOIN_TIMEOUT_MS,
}) {
    if (!state._downloadJoinEnabled || state.downloadJoinPeers.size === 0) return new Set();

    const currentTime = now();
    const blocked = new Set();
    state.downloadJoinPeers.forEach((download, steamId) => {
        if (download?.startedAt && currentTime - download.startedAt > timeoutMs) {
            state.downloadJoinPeers.delete(steamId);
            recordEvent('download_timeout', {
                steamId,
                resyncId: download.resyncId,
                downloadEpoch: download.downloadEpoch,
            });
            return;
        }
        blocked.add(steamId);
    });
    return blocked;
}

/**
 * Fence live peer snapshots until the downloaded baseline applies or expires.
 * @param {Pick<ResyncState, '_downloadJoinEnabled'|'downloadJoinInProgress'>} state
 * @param {Record<string, any>|null|undefined} snapshot
 * @param {{from?: string}} message
 * @param {{now: () => number, recordEvent: (event: string, details: Record<string, unknown>) => void, onDownloadTimeout?: (details: Record<string, unknown>) => void, timeoutMs?: number}} context
 */
export function shouldDropLiveSnapshotDuringDownload(state, snapshot, message, {
    now,
    recordEvent,
    onDownloadTimeout,
    timeoutMs = DOWNLOAD_JOIN_TIMEOUT_MS,
}) {
    if (!state._downloadJoinEnabled || !state.downloadJoinInProgress) return false;

    const download = state.downloadJoinInProgress;
    if (download.startedAt && now() - download.startedAt > timeoutMs) {
        recordEvent('download_timeout', {
            resyncId: download.resyncId,
            downloadEpoch: download.downloadEpoch,
            peerSide: true,
        });
        state.downloadJoinInProgress = null;
        onDownloadTimeout?.({
            resyncId: download.resyncId,
            downloadEpoch: download.downloadEpoch,
        });
        return false;
    }

    recordEvent('download_live_snapshot_dropped', {
        resyncId: download.resyncId,
        downloadEpoch: download.downloadEpoch,
        snapshotSeq: snapshot?.snapshotSeq,
        simTick: snapshot?.simTick,
        from: message.from,
    });
    return true;
}

/**
 * Cancel transfer owners and discard partial resync state during match cleanup.
 * @param {ResyncDisposableState} state
 * @param {(timer: unknown) => void} [clearTimer]
 */
export function disposeResyncState(state, clearTimer = clearInterval) {
    state.resyncTransfers?.forEach((transfer) => {
        if (transfer.timer !== null && transfer.timer !== undefined) clearTimer(transfer.timer);
        transfer.timer = null;
    });
    state.resyncTransfers?.clear();
    state.resyncBuffers?.clear();
    state.completedResyncs?.clear();
    if (state.pendingInboundResyncApply?.timer !== null
        && state.pendingInboundResyncApply?.timer !== undefined) {
        clearTimer(state.pendingInboundResyncApply.timer);
    }
    state.pendingInboundResyncApply = null;
    state.lastAppliedResyncFence = null;
    if (state.pendingResyncs) state.pendingResyncs.length = 0;
    state.resyncRequestAtByPeer?.clear();
    state.downloadJoinPeers?.clear();
    state.downloadJoinInProgress = null;
    resetInboundResyncRejections(/** @type {object} */ (state));
}
