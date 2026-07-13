// @ts-check

import { MessageTypes } from '../../network/message-types.js';
import { JOIN_LIFECYCLE_STATES } from './join-lifecycle.js';
import { prepareHostResyncBarrier } from './resync-input-barrier.js';

/**
 * Ask the current authority to replace one live peer's warped/predicted state.
 * PREPARE remains the only owner of input freeze/flush; this guard merely
 * prevents duplicate requests while any exact recovery phase is active.
 * @param {Record<string, any>} game
 * @param {unknown} [reason]
 */
export function requestFfaAuthoritativeResync(game, reason = 'desync_detected') {
    const localPlayer = game?.players?.get?.(game.localPlayerId);
    const hostSteamId = game?.network?.hostSteamId;
    const eligible = game?.isHost === false
        && game._disposed !== true
        && game.isSpectator !== true
        && game.gamePhase === 'playing'
        && game.joinState === JOIN_LIFECYCLE_STATES.LIVE
        && localPlayer?.isAlive === true
        && localPlayer.awaitingSpawn !== true
        && localPlayer.isDisconnected !== true
        && typeof hostSteamId === 'string'
        && hostSteamId.length > 0
        && hostSteamId !== game.localPlayerId
        && game.resyncInputFrozen !== true
        && !game.peerResyncInputBarrier
        && !game.pendingInboundResyncApply
        && !game.downloadJoinInProgress
        && typeof game.network?.requestResync === 'function';
    if (!eligible) return false;
    const normalizedReason = typeof reason === 'string' && reason.length > 0
        ? reason : 'desync_detected';
    return game.network.requestResync(hostSteamId, normalizedReason) === true;
}

/**
 * Route a trusted recovery target. A live player must fence its locally-owned
 * command stream; peers without a live board can take a direct snapshot.
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {unknown} [reason]
 */
export function routeFfaResync(game, steamId, reason = 'resync') {
    const player = game.players?.get?.(steamId);
    if (game.gamePhase === 'playing' && player?.isAlive === true) {
        return prepareHostResyncBarrier(game, steamId, String(reason), (targetId, payload) => {
            game.network.sendP2PMessage(
                targetId,
                MessageTypes.GAME_STATE_RESYNC_PREPARE,
                payload,
            );
        }) !== null;
    }
    game.queueResync(steamId);
    return true;
}

/**
 * Authorize and route a peer-authored recovery request. Live players enter the
 * input barrier; spectators/waiting players have no command stream to fence.
 * @param {Record<string, any>} game
 * @param {{from?: string, data?: Record<string, any>}} msg
 */
export function handleFfaResyncRequest(game, msg) {
    if (msg.data?.requestResync !== true) return false;
    const steamId = msg.from;
    const player = game.players?.get?.(steamId);
    const knownPeer = Boolean(
        steamId && steamId !== game.localPlayerId
        && (player || game.spectators?.has?.(steamId)),
    );
    if (!game.isHost || !knownPeer) {
        game._recordNetEvent?.('resync_request_rejected', {
            steamId: steamId || null,
            reason: 'unknown_peer',
        });
        return true;
    }

    const timestamp = Date.now();
    const configuredCooldown = Number(game.network.fullSnapshotIntervalMs);
    const cooldownMs = Number.isFinite(configuredCooldown) && configuredCooldown >= 0
        ? configuredCooldown : 250;
    const lastRequestAt = game.resyncRequestAtByPeer.get(steamId);
    if (lastRequestAt !== undefined && timestamp - lastRequestAt < cooldownMs) {
        game._recordNetEvent?.('resync_request_rejected', {
            steamId,
            reason: 'cooldown',
            retryAfterMs: cooldownMs - (timestamp - lastRequestAt),
        });
        return true;
    }

    game.resyncRequestAtByPeer.set(steamId, timestamp);
    const reason = msg.data?.reason || 'unknown';
    game._recordNetEvent?.('resync_requested', { steamId, reason });
    routeFfaResync(game, steamId, reason);
    return true;
}
