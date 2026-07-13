// @ts-check

import { MessageTypes } from '../../network/message-types.js';

/** @typedef {'download'|'busy'|'idle'} JoinSyncpointStatus */

/**
 * @typedef {Object} JoinSyncpointPlayer
 * @property {string} [steamId]
 * @property {string} [id]
 * @property {{isProcessingPhysics?: boolean}} [gameState]
 */

/**
 * @typedef {Object} PacketApplicationBlocker
 * @property {'packet_application'} kind
 * @property {number} depth
 */

/**
 * @typedef {Object} FixedTickApplicationBlocker
 * @property {'fixed_tick_application'} kind
 * @property {number} depth
 */

/**
 * @typedef {Object} ActivePhysicsBlocker
 * @property {'active_physics'} kind
 * @property {string} playerId
 */

/**
 * @typedef {Object} PendingRoundStartBlocker
 * @property {'pending_round_start'} kind
 */

/** @typedef {PacketApplicationBlocker|FixedTickApplicationBlocker|ActivePhysicsBlocker|PendingRoundStartBlocker} JoinSyncpointBlocker */

/**
 * @typedef {Object} JoinSyncpointInput
 * @property {string} [gamePhase]
 * @property {number} [simTick]
 * @property {number} [roundGeneration]
 * @property {Map<unknown, JoinSyncpointPlayer>|Iterable<JoinSyncpointPlayer>} [players]
 * @property {number} [packetApplicationDepth]
 * @property {number} [fixedTickApplicationDepth]
 * @property {boolean} [roundStartPending]
 */

/**
 * @typedef {Object} JoinSyncpointMarker
 * @property {JoinSyncpointStatus} status
 * @property {boolean} safe
 * @property {number} simTick
 * @property {number} roundGeneration
 * @property {JoinSyncpointBlocker[]} blockers
 */

/** @param {unknown} value */
function normalizeCounter(value) {
    return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/** @param {unknown} value */
function normalizeDepth(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.max(1, Math.floor(numeric));
}

/**
 * @param {JoinSyncpointInput['players']} players
 * @returns {Array<{key: unknown, player: JoinSyncpointPlayer}>}
 */
function normalizePlayers(players) {
    if (!players) return [];
    if (players instanceof Map) {
        return Array.from(players, ([key, player]) => ({ key, player }));
    }
    return Array.from(players, (player, index) => ({ key: index, player }));
}

/**
 * Compute a stable marker for the only windows in which join/resync snapshots
 * may be captured. The evaluator is deliberately pure: callers own the
 * application-depth counters and must recompute immediately before capture.
 *
 * `latestPhysicsPromise` and current-piece presence are intentionally not
 * consulted. The online path retains settled physics promises, while dead,
 * waiting, and line-clear states may legitimately have no current piece.
 * `isProcessingPhysics` is the live cascade/async-physics ownership signal.
 *
 * @param {JoinSyncpointInput} input
 * @returns {JoinSyncpointMarker}
 */
export function computeJoinSyncpoint(input = {}) {
    const packetApplicationDepth = normalizeDepth(input.packetApplicationDepth);
    const fixedTickApplicationDepth = normalizeDepth(input.fixedTickApplicationDepth);
    /** @type {JoinSyncpointBlocker[]} */
    const blockers = [];

    if (packetApplicationDepth > 0) {
        blockers.push({ kind: 'packet_application', depth: packetApplicationDepth });
    }
    if (fixedTickApplicationDepth > 0) {
        blockers.push({ kind: 'fixed_tick_application', depth: fixedTickApplicationDepth });
    }
    if (input.roundStartPending === true) {
        blockers.push({ kind: 'pending_round_start' });
    }

    const activePhysicsPlayers = normalizePlayers(input.players)
        .filter(({ player }) => player?.gameState?.isProcessingPhysics === true)
        .map(({ key, player }) => String(player.steamId ?? player.id ?? key))
        .sort((left, right) => left.localeCompare(right));
    activePhysicsPlayers.forEach((playerId) => {
        blockers.push({ kind: 'active_physics', playerId });
    });

    /** @type {JoinSyncpointStatus} */
    let status = input.gamePhase === 'playing' ? 'idle' : 'download';
    if (blockers.length > 0) status = 'busy';

    return {
        status,
        safe: status !== 'busy',
        simTick: normalizeCounter(input.simTick),
        roundGeneration: normalizeCounter(input.roundGeneration),
        blockers,
    };
}

/** @param {Record<string, any>} game */
export function computeFfaJoinSyncpoint(game) {
    return computeJoinSyncpoint({
        gamePhase: game.gamePhase,
        simTick: game.simTick,
        roundGeneration: game.roundGeneration,
        players: game.players,
        packetApplicationDepth: game._networkDispatch?.depth,
        fixedTickApplicationDepth: game._fixedTickApplicationDepth,
        roundStartPending: typeof game._pendingRoundStart === 'function',
    });
}

/** @param {Record<string, any>} game */
export function refreshFfaJoinSyncpoint(game) {
    const marker = computeFfaJoinSyncpoint(game);
    game.joinSyncpoint = marker;
    game.syncpoint = marker.status;
    return marker;
}

/** @param {Record<string, any>} game */
export function publishFfaJoinSyncpoint(game) {
    const previous = game.syncpoint;
    const marker = refreshFfaJoinSyncpoint(game);
    if (marker.status !== previous) {
        game.network?.broadcastToAll?.(MessageTypes.GAME_SYNCPOINT, {
            syncpoint: marker.status,
            tick: game.hostTick,
            simTick: marker.simTick,
            roundGeneration: marker.roundGeneration,
            blockers: marker.blockers,
            reason: 'state_change',
        });
    }
    return marker;
}

/** @param {Record<string, any>} game @param {Record<string, any>} [data] */
export function adoptFfaJoinSyncpoint(game, data = {}) {
    /** @type {JoinSyncpointStatus} */
    let status = game.syncpoint === 'busy' || game.syncpoint === 'idle'
        ? game.syncpoint : 'download';
    if (data.syncpoint === 'download' || data.syncpoint === 'busy' || data.syncpoint === 'idle') {
        status = data.syncpoint;
    }
    const marker = {
        status,
        safe: status !== 'busy',
        simTick: normalizeCounter(data.simTick ?? game.joinSyncpoint?.simTick ?? game.simTick),
        roundGeneration: normalizeCounter(
            data.roundGeneration ?? game.joinSyncpoint?.roundGeneration ?? game.roundGeneration,
        ),
        blockers: Array.isArray(data.blockers) ? data.blockers : [],
    };
    game.joinSyncpoint = marker;
    game.syncpoint = status;
    return marker;
}

/**
 * Drain at most one queued peer after recomputing the live eligibility marker.
 * @param {Record<string, any>} game
 * @param {(steamId: string, marker: JoinSyncpointMarker, inputBarrier: Record<string, any>|null) => boolean|void} send
 */
export function drainFfaPendingResyncs(game, send) {
    if (!game.isHost || !Array.isArray(game.pendingResyncs)
        || game.pendingResyncs.length === 0) return null;
    const marker = refreshFfaJoinSyncpoint(game);
    if (!marker.safe) return null;
    let selectedIndex = -1;
    let inputBarrier = null;
    for (let index = 0; index < game.pendingResyncs.length; index += 1) {
        const candidateId = game.pendingResyncs[index];
        const hasInputBarrier = game.hostResyncInputBarriers instanceof Map
            && game.hostResyncInputBarriers.has(candidateId);
        const candidateBarrier = hasInputBarrier
            ? game._getSatisfiedResyncInputRequirement?.(candidateId) ?? null
            : null;
        if (hasInputBarrier && !candidateBarrier) continue;
        selectedIndex = index;
        inputBarrier = candidateBarrier;
        break;
    }
    if (selectedIndex < 0) return null;
    const steamId = game.pendingResyncs[selectedIndex];
    if (!steamId) return null;
    if (send(steamId, marker, inputBarrier) === false) return null;
    game.pendingResyncs.splice(selectedIndex, 1);
    return { steamId, marker, inputBarrier };
}

/**
 * Queue first, then attempt a fresh safe-window drain. Queue-first is
 * load-bearing when called from inside a tracked network handler: the packet
 * depth blocks capture until NetworkHandlerRegistry reports the stack drained.
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {(steamId: string, marker: JoinSyncpointMarker, inputBarrier: Record<string, any>|null) => boolean|void} send
 */
export function queueFfaResync(game, steamId, send) {
    if (game._disposed || !game.isHost || !steamId || steamId === game.localPlayerId) return false;
    if (!Array.isArray(game.pendingResyncs)) game.pendingResyncs = [];
    if (!game.pendingResyncs.includes(steamId)) game.pendingResyncs.push(steamId);
    const marker = refreshFfaJoinSyncpoint(game);
    game._recordNetEvent?.('resync_queued', {
        steamId,
        phase: game.gamePhase,
        syncpoint: marker.status,
        syncpointSimTick: marker.simTick,
        syncpointRoundGeneration: marker.roundGeneration,
        syncpointBlockers: marker.blockers,
    });
    drainFfaPendingResyncs(game, send);
    return true;
}
