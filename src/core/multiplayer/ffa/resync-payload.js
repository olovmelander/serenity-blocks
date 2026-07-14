// @ts-check

import { getBinaryEncoder } from '../../network/binary-encoding.js';
import { computeFfaJoinSyncpoint } from './join-syncpoint.js';
import { normalizeFfaRoundSeed } from '../ffa-round-policy.js';
import { encodeBase64 } from './resync-coordinator.js';
import { captureFfaResyncSidecar } from './resync-sidecar.js';

/**
 * @typedef {Object} ResyncPayloadMeta
 * @property {string|null} [downloadEpoch]
 * @property {string|null} [resyncId]
 * @property {Record<string, any>|null} [inputBarrier]
 */

/** @param {import('./join-syncpoint.js').JoinSyncpointMarker} marker */
function serializeSyncpoint(marker) {
    return JSON.stringify({
        status: marker.status,
        safe: marker.safe,
        simTick: marker.simTick,
        roundGeneration: marker.roundGeneration,
        blockers: marker.blockers,
    });
}

/** @param {unknown} value */
function normalizeCounter(value) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/** @param {Record<string, any>} game @param {import('./join-syncpoint.js').JoinSyncpointMarker} syncpoint */
function captureFence(game, syncpoint) {
    return {
        simTick: syncpoint.simTick,
        roundGeneration: syncpoint.roundGeneration,
        snapshotSeq: normalizeCounter(game.snapshotSeq),
        hostTick: normalizeCounter(game.hostTick),
        migrationEpoch: normalizeCounter(game.migrationEpoch),
    };
}

/** @param {Record<string, any>} snapshot @param {ReturnType<typeof captureFence>} fence */
function snapshotMatchesFence(snapshot, fence) {
    return snapshot.simTick === fence.simTick
        && snapshot.roundGeneration === fence.roundGeneration
        && snapshot.snapshotSeq === fence.snapshotSeq
        && snapshot.tick === fence.hostTick
        && normalizeCounter(snapshot.migrationEpoch) === fence.migrationEpoch;
}

/**
 * Capture one reliable resync envelope at a stable simulation boundary. The
 * compact binary-v1 body remains unchanged for gameplay-wire compatibility;
 * the versioned sidecar carries the exact continuation state only resyncs need.
 *
 * The fence is intentionally checked both before and after both captures. A
 * synchronous callback that advances a tick, starts physics, or enters packet
 * application invalidates the entire envelope instead of producing a torn
 * binary/sidecar pair.
 *
 * @param {Record<string, any>} game
 * @param {ResyncPayloadMeta} [meta]
 */
export function buildFfaResyncPayload(game, meta = {}) {
    const sharedSeed = normalizeFfaRoundSeed(game.sharedSeed);
    if (sharedSeed === null) throw new TypeError('Cannot capture resync with an invalid round seed');
    const before = computeFfaJoinSyncpoint(game);
    if (!before.safe) {
        throw new Error(`Cannot capture resync while syncpoint is ${before.status}`);
    }
    const previousSnapshotSeq = normalizeCounter(game.snapshotSeq);
    if (previousSnapshotSeq >= 0xFFFFFFFF) {
        throw new RangeError('Resync snapshot sequence exhausted');
    }
    game.snapshotSeq = previousSnapshotSeq + 1;
    const beforeFence = captureFence(game, before);

    const authoritativeSnapshot = game.buildStateSnapshot();
    const sidecar = captureFfaResyncSidecar(game, before);
    const after = computeFfaJoinSyncpoint(game);
    const fenceChanged = serializeSyncpoint(after) !== serializeSyncpoint(before)
        || JSON.stringify(captureFence(game, after)) !== JSON.stringify(beforeFence);
    const sidecarFence = sidecar?.capture;
    if (!after.safe || fenceChanged
        || !snapshotMatchesFence(authoritativeSnapshot, beforeFence)
        || !snapshotMatchesFence({ ...sidecarFence, tick: sidecarFence?.hostTick }, beforeFence)) {
        throw new Error('Resync syncpoint changed during capture');
    }

    const snapshotBytes = new Uint8Array(
        getBinaryEncoder().encodeSnapshot(authoritativeSnapshot),
    );
    return {
        encoding: 'binary-v1',
        header: {
            matchConfig: game.matchConfig,
            sharedSeed,
            matchStartTime: game.matchStartTime,
            roundGeneration: beforeFence.roundGeneration,
            simTick: beforeFence.simTick,
            snapshotSeq: beforeFence.snapshotSeq,
            hostTick: beforeFence.hostTick,
            migrationEpoch: beforeFence.migrationEpoch,
            downloadEpoch: meta.downloadEpoch ?? null,
            resyncId: meta.resyncId ?? null,
            inputBarrier: meta.inputBarrier ?? null,
            sentAt: Date.now(),
            joinSyncpoint: before,
        },
        sidecar,
        snapshot: encodeBase64(snapshotBytes),
    };
}
