// @ts-check

/**
 * Pure garbage-queue helpers extracted from ffa-p2p-game-state.js (plan §6A.2,
 * the first slice of the future ffa/garbage-system.js). No instance state — safe
 * to import in node tests. The stateful garbage insertion/counter/prediction
 * methods remain in the class until they can be moved with dependency injection.
 */

/**
 * Stable dedup key for a garbage burst entry: `attackId:lineIndex`. Falls back to
 * `seq<attackSeq>` then `a` when no attackId, and lineIndex 0 when absent. Used by
 * the peer's idempotent-adopt set so a host snapshot cannot re-add a burst the peer
 * already predict-consumed.
 * @param {{ attackId?: string|number, attackSeq?: number|null, lineIndex?: number|null }|null|undefined} e
 * @returns {string}
 */
export function garbageBurstKey(e) {
    const id = e && (e.attackId || (e.attackSeq != null ? `seq${e.attackSeq}` : 'a'));
    return `${id}:${e && e.lineIndex != null ? e.lineIndex : 0}`;
}

/**
 * DRAIN-ALL (match local): consume EVERY pending line-burst from the queue in one
 * go and return them as a single combined array. `dequeueLineBurst()` bails on a
 * non-'line' head, so this naturally stops at a blind entry (same boundary as a
 * single dequeue) and can never loop forever (guarded at 64 bursts).
 * @param {{ dequeueLineBurst: () => Array<any>|null|undefined }} garbageQueue
 * @returns {Array<any>}
 */
export function drainAllLineBursts(garbageQueue) {
    const all = [];
    let guard = 0;
    let burst = garbageQueue.dequeueLineBurst();
    while (burst && burst.length > 0 && guard++ < 64) {
        for (const e of burst) all.push(e);
        burst = garbageQueue.dequeueLineBurst();
    }
    return all;
}
