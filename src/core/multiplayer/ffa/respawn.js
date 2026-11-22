// @ts-check

/**
 * Free-for-all respawn, online (versus-rules.js: the 'ffa' game type).
 *
 * A knocked-out player presses any of their keys, RESPAWN_AFTER_MS or more after the
 * knock-out, and plays on at once on an empty well at the match's start level, keeping
 * score, lines and frags (respawnVersusBoard). The host decides; every client follows.
 *
 * - A peer asks for its own player (GAME_RESPAWN_REQUEST). The host takes the request only
 *   from that player (the transport names the sender), only in a free-for-all match being
 *   played, only for the round being played, only while the player is out, and not while
 *   a resync is on its way to them (its capture would put them back out). A refused request
 *   is dropped; the player's next key asks again.
 * - The host resets its copy of the board, drops the player's waiting garbage, frag credit
 *   and stamps, deals the first piece and tells everyone (GAME_PLAYER_RESPAWN), then sends
 *   the boards as usual. The host's own player comes back the same way, with no request.
 * - Every client resets that board the same way. The event carries:
 *   - respawnSeq, one more for each respawn of the player: a repeat changes nothing;
 *   - roundGeneration: an event from another round is dropped;
 *   - snapshotSeq, the host's last snapshot before the respawn. A snapshot no newer (an
 *     unreliable frame still on the wire) shows the player still out, so it is not applied
 *     to them (predatesRespawn);
 *   - pieces, the board's piece stream: the generator's seed and state, and the preview.
 *     A peer deals its own pieces, so from here it deals exactly the host copy's.
 * - A peer's own player comes back only through that event. A snapshot that shows them in
 *   play can overtake it on the wire, and the board it would wake is the knocked-out one
 *   (keepsOwnPlayerOut).
 *
 * A player who joined during the match (awaitingSpawn) is out in the same way and joins
 * in with a key. Survivor keeps its rounds: nobody comes back until the next one.
 */

import { MessageTypes } from '../../network/message-types.js';
import { spawnPiece } from '../../game.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../../events/multiplayer-events.js';
import { seededRandom } from '../../../utils/helpers.js';
import { normalizeFfaRoundSeed } from '../ffa-round-policy.js';
import {
    RESPAWN_AFTER_MS, readVersusGameType, resetVersusCredit, respawnVersusBoard,
} from '../versus-rules.js';
import { isDeparted } from './presence.js';
import { wallClockNow } from '../frag-tracker.js';

/** A player out of play asks at most this often, however fast the keys come. */
export const RESPAWN_REQUEST_EVERY_MS = 250;

/** The piece generator's states (utils/helpers.js seededRandom). */
const LCG_MODULUS = 233280;
const PIECE_KEYS = new Set(['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
const MAX_PREVIEW = 64;
const MAX_ID_CHARS = 128;

/**
 * @typedef {{ seed: number, state: number, next: string[] }} PieceStream
 * @typedef {{
 *   playerSteamId: string,
 *   respawnSeq: number,
 *   roundGeneration: number,
 *   snapshotSeq: number,
 *   pieces: PieceStream|null,
 * }} RespawnEvent
 */

/** @param {unknown} state */
const isLcgState = (state) => typeof state === 'number' && Number.isFinite(state)
    && state >= 0 && state < LCG_MODULUS;

/** @param {unknown} value @param {number} [min] */
const isCount = (value, min = 0) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= min;

/**
 * A board's piece stream, when its generator can say where it stands.
 * @param {Record<string, any>|null|undefined} gameState
 * @returns {PieceStream|null}
 */
export function capturePieceStream(gameState) {
    const rng = gameState?.randomGenerator;
    if (typeof rng?.getState !== 'function' || !Array.isArray(gameState?.nextPieces)) return null;
    const seed = normalizeFfaRoundSeed(rng.seed);
    const state = rng.getState();
    if (seed === null || !isLcgState(state)) return null;
    return { seed, state, next: gameState.nextPieces.slice() };
}

/**
 * A piece stream from the wire, or null.
 * @param {unknown} value
 * @returns {PieceStream|null}
 */
export function readPieceStream(value) {
    if (!value || typeof value !== 'object') return null;
    const raw = /** @type {Record<string, unknown>} */ (value);
    const seed = normalizeFfaRoundSeed(raw.seed);
    if (seed === null || !isLcgState(raw.state)) return null;
    const { next } = raw;
    if (!Array.isArray(next) || next.length === 0 || next.length > MAX_PREVIEW
        || !next.every((key) => typeof key === 'string' && PIECE_KEYS.has(key))) return null;
    return { seed, state: /** @type {number} */ (raw.state), next: next.slice() };
}

/**
 * Deal from this stream from now on.
 * @param {Record<string, any>} gameState
 * @param {PieceStream} stream
 */
function adoptPieceStream(gameState, stream) {
    const rng = /** @type {any} */ (seededRandom(stream.seed));
    rng.setState(stream.state);
    gameState.randomGenerator = rng;
    gameState.nextPieces.length = 0;
    gameState.nextPieces.push(...stream.next);
}

/**
 * Host: a board whose generator cannot say where it stands (a player who joined during the
 * match, a board adopted from another host) deals from the round's seed instead, from a
 * fresh preview, so the event can name the stream.
 * @param {Record<string, any>} game
 * @param {Record<string, any>} gameState
 */
function ensurePieceStream(game, gameState) {
    if (capturePieceStream(gameState)) return;
    gameState.randomGenerator = game.createSeededRNG(game.sharedSeed);
    gameState.nextPieces.length = 0;
}

/**
 * A respawn event from the wire, or null.
 * @param {unknown} data
 * @returns {RespawnEvent|null}
 */
export function readRespawnEvent(data) {
    if (!data || typeof data !== 'object') return null;
    const raw = /** @type {Record<string, unknown>} */ (data);
    const { playerSteamId } = raw;
    if (typeof playerSteamId !== 'string' || playerSteamId.length === 0
        || playerSteamId.length > MAX_ID_CHARS) return null;
    if (!isCount(raw.respawnSeq, 1) || !isCount(raw.roundGeneration) || !isCount(raw.snapshotSeq)) return null;
    return {
        playerSteamId,
        respawnSeq: /** @type {number} */ (raw.respawnSeq),
        roundGeneration: /** @type {number} */ (raw.roundGeneration),
        snapshotSeq: /** @type {number} */ (raw.snapshotSeq),
        pieces: readPieceStream(raw.pieces),
    };
}

/**
 * Whether a host snapshot predates this player's last respawn: it shows them still out,
 * so none of it is applied to them.
 * @param {Record<string, any>|null|undefined} player
 * @param {{ snapshotSeq?: unknown, roundGeneration?: unknown }|null|undefined} state
 */
export function predatesRespawn(player, state) {
    const fence = player?._respawnFence;
    if (!fence || typeof state?.snapshotSeq !== 'number') return false;
    if (typeof state.roundGeneration === 'number' && state.roundGeneration !== fence.roundGeneration) return false;
    return state.snapshotSeq <= fence.snapshotSeq;
}

/**
 * Whether the local player is out of a free-for-all match being played, so their keys ask
 * to play again.
 * @param {Record<string, any>|null|undefined} game
 */
export function waitsToRespawn(game) {
    if (!game || game.isSpectator || game.gamePhase !== 'playing') return false;
    if (readVersusGameType(game.matchConfig) !== 'ffa') return false;
    const player = game.players?.get?.(game.localPlayerId);
    return Boolean(player) && player.isAlive === false && !isDeparted(player);
}

/**
 * Peer: a host snapshot shows this client's own player in play while they are out here.
 * In a free-for-all only the host's respawn event brings them back (see the header).
 * @param {Record<string, any>} game
 * @param {Record<string, any>} playerData the snapshot's entry for the local player
 */
export function keepsOwnPlayerOut(game, playerData) {
    return !game.isHost && playerData?.isAlive === true && waitsToRespawn(game);
}

/**
 * Why the host will not put this player back in play now, or null when it will.
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {{ roundGeneration?: unknown, afterRespawnSeq?: unknown, now?: number }} [request]
 * @returns {string|null}
 */
export function respawnRefusal(game, steamId, request = {}) {
    if (!game?.isHost) return 'not_host';
    if (readVersusGameType(game.matchConfig) !== 'ffa') return 'not_free_for_all';
    if (game.gamePhase !== 'playing') return 'not_playing';
    if (request.roundGeneration !== game.roundGeneration) return 'stale_round';
    const player = game.players?.get?.(steamId);
    if (!player?.gameState) return 'unknown_player';
    if (player.isAlive !== false) return 'in_play';
    if (isDeparted(player)) return 'departed';
    // Asked before a respawn the host already made (a second key on the way, say).
    const askedAfter = request.afterRespawnSeq;
    if (isCount(askedAfter) && /** @type {number} */ (askedAfter) < (Number(player._respawnSeq) || 0)) {
        return 'already_respawned';
    }
    const now = request.now ?? wallClockNow();
    if (Number.isFinite(player._outAt) && now - player._outAt < RESPAWN_AFTER_MS) return 'too_soon';
    for (const transfer of game.resyncTransfers?.values?.() || []) {
        if (transfer?.steamId === steamId) return 'resync_on_the_way';
    }
    return null;
}

/**
 * Back in play, on every client: no waiting garbage, no frag credit, no stamps.
 * @param {Record<string, any>} player
 */
function returnToPlay(player) {
    player.garbageQueue?.clear?.();
    resetVersusCredit(player);
    player.gameState.handicaps = {};
    // A hard drop pressed through the last life's final cascade (ffa/input-defer.js) is not
    // the new life's; both sides drop it alike.
    player.gameState._deferredHardDrop = false;
    player.isAlive = true;
    player.awaitingSpawn = false;
    player._outAt = null;
}

/**
 * @param {Record<string, any>} game
 * @param {Record<string, any>} player
 */
function announceRespawn(game, player) {
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_RESPAWNED, {
        steamId: player.steamId,
        playerName: player.name,
        isLocal: player.steamId === game.localPlayerId,
    });
}

/**
 * Host: put a knocked-out player back in play and tell everyone. The caller has checked
 * respawnRefusal.
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @returns {boolean}
 */
export function performFfaRespawn(game, steamId) {
    const player = game.players?.get?.(steamId);
    if (!game?.isHost || !player?.gameState) return false;
    const { gameState } = player;
    ensurePieceStream(game, gameState);
    respawnVersusBoard(gameState, game.matchConfig);
    const pieces = capturePieceStream(gameState);
    returnToPlay(player);
    const respawnSeq = (Number(player._respawnSeq) || 0) + 1;
    player._respawnSeq = respawnSeq;
    spawnPiece(gameState, null, null);

    /** @type {RespawnEvent} */
    const event = {
        playerSteamId: steamId,
        respawnSeq,
        roundGeneration: game.roundGeneration,
        snapshotSeq: Number(game.snapshotSeq) || 0,
        pieces,
    };
    game._recordNetEvent?.('respawn', {
        steamId, respawnSeq, snapshotSeq: event.snapshotSeq, roundGeneration: event.roundGeneration,
    });
    game.network.broadcastToAll(MessageTypes.GAME_PLAYER_RESPAWN, event);
    announceRespawn(game, player);
    // Then the boards as usual, the fresh one included.
    if (game._lockEventsEnabled) game._emitAuthoritativeLock?.(steamId);
    game.broadcastGameState?.();
    game.renderAllPlayers?.();
    return true;
}

/**
 * Host: a peer asks to play again.
 * @param {Record<string, any>} game
 * @param {{ from?: string, data?: any }} msg
 * @returns {boolean} whether the player came back
 */
export function handleFfaRespawnRequest(game, msg) {
    if (!game?.isHost) return false;
    const data = msg?.data;
    const steamId = typeof data?.playerSteamId === 'string' ? data.playerSteamId : null;
    if (!steamId) return false;
    // A peer asks for its own player only; the host's own player never asks over the wire.
    if ((msg.from && msg.from !== steamId) || steamId === game.localPlayerId) {
        game._rejectSpoof?.('GAME_RESPAWN_REQUEST', msg);
        return false;
    }
    const refusal = respawnRefusal(game, steamId, {
        roundGeneration: data.roundGeneration,
        afterRespawnSeq: data.afterRespawnSeq,
    });
    if (refusal) {
        game._respawnRefusals = (Number(game._respawnRefusals) || 0) + 1;
        game._recordNetEvent?.('respawn_refused', { steamId, reason: refusal });
        return false;
    }
    return performFfaRespawn(game, steamId);
}

/**
 * Peer: the host put a player back in play. Reset that board the host's way.
 * @param {Record<string, any>} game
 * @param {{ from?: string, data?: any }} msg
 * @returns {boolean} whether the event was applied
 */
export function handleFfaPlayerRespawn(game, msg) {
    if (!game || game.isHost) return false;
    if (!game._isFromHost?.(msg)) {
        game._rejectSpoof?.('GAME_PLAYER_RESPAWN', msg);
        return false;
    }
    const event = readRespawnEvent(msg?.data);
    if (!event || event.roundGeneration !== game.roundGeneration) return false;
    const player = game.players?.get?.(event.playerSteamId);
    if (!player?.gameState) return false;
    // Seen already, unless the player is out here: a new host after a migration counts on
    // from what it had seen, which can be one short of what the old host told this client.
    if (event.respawnSeq <= (Number(player._respawnSeq) || 0) && player.isAlive !== false) return false;

    const { gameState } = player;
    respawnVersusBoard(gameState, game.matchConfig);
    if (event.pieces) adoptPieceStream(gameState, event.pieces);
    returnToPlay(player);
    player._respawnSeq = Math.max(event.respawnSeq, Number(player._respawnSeq) || 0);
    player._respawnFence = { roundGeneration: event.roundGeneration, snapshotSeq: event.snapshotSeq };
    spawnPiece(gameState, null, null);
    if (player.steamId === game.localPlayerId) {
        // Nothing from the last life carries over: consumed garbage, the board hold, held keys.
        game._peerConsumedBursts?.clear?.();
        game._localBoardHoldCount = 0;
        game._lastLocalLockTime = 0;
        game.localInputHooks?.reset?.();
    }
    announceRespawn(game, player);
    game.renderAllPlayers?.();
    return true;
}

/**
 * The local player pressed one of their keys. In a free-for-all match, while they are out,
 * the key asks to play again and does nothing else.
 * @param {Record<string, any>} game
 * @param {number} [now]
 * @returns {boolean} whether the key went to the respawn
 */
export function requestFfaRespawn(game, now = wallClockNow()) {
    if (!waitsToRespawn(game)) return false;
    const player = game.players.get(game.localPlayerId);
    if (game.resyncInputFrozen) return true;
    if (Number.isFinite(player._outAt) && now - player._outAt < RESPAWN_AFTER_MS) return true;
    if (now - (Number(game._respawnRequestedAt) || 0) < RESPAWN_REQUEST_EVERY_MS) return true;
    game._respawnRequestedAt = now;

    if (game.isHost) {
        const refusal = respawnRefusal(game, game.localPlayerId, { roundGeneration: game.roundGeneration, now });
        if (refusal) game._recordNetEvent?.('respawn_refused', { steamId: game.localPlayerId, reason: refusal });
        else performFfaRespawn(game, game.localPlayerId);
        return true;
    }
    const hostId = game.network?.hostSteamId;
    if (hostId) {
        game.network.sendP2PMessage(hostId, MessageTypes.GAME_RESPAWN_REQUEST, {
            playerSteamId: game.localPlayerId,
            roundGeneration: game.roundGeneration,
            afterRespawnSeq: Number(player._respawnSeq) || 0,
        });
    }
    return true;
}
