// @ts-check

import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../../events/multiplayer-events.js';
import { MessageTypes } from '../../network/message-types.js';
import { cancelFfaRoundRestart } from '../ffa-round-policy.js';
import { routeFfaResync } from './resync-request-handler.js';

/**
 * Who is still in the match, and what becomes of those who are not.
 *
 * Every packet a peer sends is a sign of life (SteamNetworking.peerLiveness). In every
 * phase the host beats to everyone once a second and each peer pings the host once a
 * second; a peer that leaves on purpose says so (LOBBY_PLAYER_LEFT); Steam reports lobby
 * departures and failed sessions. A player the host has not heard from in
 * DEPARTED_AFTER_MS mid-round (DEPARTED_IDLE_AFTER_MS otherwise) has departed:
 * - outside a round they leave the roster at once;
 * - mid-round they are knocked out, credited to their last attacker, and their seat is
 *   held for DEPARTED_SEAT_HOLD_MS in case they come back;
 * - a match left with one player is over, and that player wins it: in a duel, leaving
 *   loses.
 * Peers adopt the host's roster whole, so everyone sees the same players.
 *
 * Nothing used to do any of this. Nobody sent LOBBY_PLAYER_LEFT, the transport's
 * disconnect monitor had no callers, and peers never removed anyone, so a player who
 * left stayed on every roster: alive, taking garbage, revived each round. A duel whose
 * other player left never ended.
 */

/** Silence after which the host takes a player for gone mid-round. */
export const DEPARTED_AFTER_MS = 5000;
/**
 * The same outside a round, where nothing is urgent and a busy peer (loading the match)
 * must not lose its place. Leaves are announced, so this is only the backstop.
 */
export const DEPARTED_IDLE_AFTER_MS = 15_000;
/** How long a departed player's seat is held mid-match. */
export const DEPARTED_SEAT_HOLD_MS = 10_000;
/** The session pulse: the host's beat, each peer's ping. */
export const SESSION_PULSE_MS = 1000;

/** @param {Record<string, any>|null|undefined} player */
export const isDeparted = (player) => player?.isDisconnected === true;

/**
 * The roster players still in the match.
 * @param {Record<string, any>} game
 * @returns {Array<Record<string, any>>}
 */
export function presentPlayers(game) {
    return Array.from(game.players?.values?.() || []).filter((player) => player && !isDeparted(player));
}

/**
 * Host: a match is on (its start countdown, a round, a round's ready barrier, or the beat
 * between rounds). A player who joins then waits for the next round: added from the
 * phase alone, one who arrived during a countdown or a beat was a live player with no
 * board who never got the match start, and the round could not end without them.
 * @param {Record<string, any>} game
 */
export function matchIsOn(game) {
    if (game.gamePhase === 'playing' || game._matchStarting === true) return true;
    if (typeof game._pendingRoundStart === 'function') return true;
    return game.gamePhase === 'finished' && game._roundRestartTimer != null;
}

/**
 * The session pulse, on every side and in every phase: the host beats to everyone and
 * looks for departures; a peer pings the host (which answers, for the round trip).
 * @param {Record<string, any>} game
 * @param {number} now
 */
export function pulseFfaSession(game, now) {
    const { network } = game;
    if (game._disposed || !network) return;
    if (game.isHost) {
        network.broadcastToAll(MessageTypes.NET_HEARTBEAT, { timestamp: now });
        noteSilentPeers(game, now);
    } else if (network.hostSteamId && network.sessionProtocolVersion) {
        network.sendUnreliable?.(network.hostSteamId, MessageTypes.NET_PING, { sentAt: now });
    }
}

/**
 * Host: answer a peer's ping on the unreliable lane, so the round trip is not inflated
 * by reliable resends.
 * @param {Record<string, any>} game
 * @param {{from?: string, data?: Record<string, any>}} msg
 */
export function answerPing(game, msg) {
    const sentAt = msg?.data?.sentAt;
    if (!game.isHost || game._disposed || !msg.from || !Number.isFinite(sentAt)) return;
    game.network.sendUnreliable?.(msg.from, MessageTypes.NET_PONG, { sentAt });
}

/**
 * Host: players and watchers silent for DEPARTED_AFTER_MS are gone. A player held after
 * a silence whose packets came back (a blip, not a leave) is back.
 * @param {Record<string, any>} game
 * @param {number} now
 */
export function noteSilentPeers(game, now) {
    const { network } = game;
    if (typeof network?.peerSilenceMs !== 'function') return;
    const limit = game.gamePhase === 'playing' ? DEPARTED_AFTER_MS : DEPARTED_IDLE_AFTER_MS;
    Array.from(game.players.entries()).forEach(([steamId, player]) => {
        if (steamId === game.localPlayerId) return;
        const silence = network.peerSilenceMs(steamId, now);
        if (!isDeparted(player)) {
            if (silence > limit) game.removePlayer(steamId, 'timeout');
        } else if (player.departedReason === 'timeout' && silence < SESSION_PULSE_MS * 2) {
            welcomeBack(game, steamId, 'reconnect');
        }
    });
    Array.from(game.spectators || []).forEach((steamId) => {
        if (network.peerSilenceMs(steamId, now) > limit) game.removePlayer(steamId, 'timeout');
    });
}

/**
 * Mid-round departure: the player is knocked out and their seat held. The session stays
 * open meanwhile, so the packets after a blip bring them back (noteSilentPeers).
 * @param {Record<string, any>} game
 * @param {Record<string, any>} player
 * @param {string} reason
 */
export function holdDepartedSeat(game, player, reason) {
    player.isDisconnected = true;
    player.departedReason = reason;
    if (!game.isHost) return;
    const { steamId } = player;
    clearTimeout(player.disconnectTimeout);
    player.disconnectTimeout = setTimeout(() => releaseHeldSeat(game, steamId), DEPARTED_SEAT_HOLD_MS);
    game.broadcastPlayerList();
    if (player.isAlive) knockOutDeparted(game, player);
}

/**
 * A leaver counts as knocked out, credited to whoever attacked them last.
 * @param {Record<string, any>} game
 * @param {Record<string, any>} player
 */
function knockOutDeparted(game, player) {
    const { steamId, lastAttackerId } = player;
    const attacker = lastAttackerId ? game.players.get(lastAttackerId) : null;
    if (player.gameState) player.gameState.isGameOver = true;
    game.fragTracker?.recordDeath(steamId, lastAttackerId || null);
    game._recordNetEvent?.('death', {
        deadSteamId: steamId,
        deadName: player.name,
        killerSteamId: lastAttackerId || null,
        killerName: attacker?.name || null,
        reason: 'departed',
    });
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
        steamId,
        playerName: player.name,
        killer: lastAttackerId || null,
        killerId: lastAttackerId || null,
        killerName: attacker?.name || null,
        isSelfKill: !lastAttackerId,
        isLocal: false,
        departed: true,
    });
}

/**
 * The hold ran out: free the seat. One who went silent may still be running, so they
 * are told, before their session closes, rather than left talking to nobody.
 * @param {Record<string, any>} game
 * @param {string} steamId
 */
function releaseHeldSeat(game, steamId) {
    const player = game.players.get(steamId);
    if (game._disposed || !isDeparted(player)) return;
    player.disconnectTimeout = null;
    if (player.departedReason === 'timeout' || player.departedReason === 'p2p_failed') {
        game.network?.sendP2PMessage?.(steamId, MessageTypes.PLAYER_KICKED, { reason: 'connection_lost' });
    }
    game._finalizeRemovePlayer(steamId);
}

/**
 * A held player is back (a new join, or packets after a blip): the seat is theirs again.
 * Knocked out for this round, they play from the next one.
 * @param {Record<string, any>} game
 * @param {string} steamId
 * @param {string} reason
 */
export function welcomeBack(game, steamId, reason) {
    const player = game.players.get(steamId);
    if (!isDeparted(player)) return false;
    clearTimeout(player.disconnectTimeout);
    player.disconnectTimeout = null;
    player.isDisconnected = false;
    player.departedReason = null;
    if (!player.isAlive) player.awaitingSpawn = true;
    game.broadcastPlayerList();
    routeFfaResync(game, steamId, reason);
    return true;
}

/**
 * Host: a departure between rounds (the round-over beat) can leave one player. The next
 * round is not started; the match is over and that player wins it.
 * @param {Record<string, any>} game
 */
export function endMatchIfAlone(game) {
    if (!game.isHost || game._disposed || game.gamePhase !== 'finished' || !game._roundRestartTimer) return false;
    const present = presentPlayers(game);
    if (present.length >= 2) return false;
    cancelFfaRoundRestart(game);
    game.fragTracker?.endMatch(present[0] || { steamId: null, name: 'Draw' });
    return true;
}

/**
 * Peer: the host's roster is the roster. Players it no longer lists are gone and its
 * departed flags are adopted. A peer the host no longer lists, once it has been listed,
 * has lost its seat (a silence the host gave up on) and leaves.
 * @param {Record<string, any>} game
 * @param {Array<Record<string, any>>} list
 */
export function adoptHostRoster(game, list) {
    const listed = new Set(list.map((entry) => entry?.steamId).filter(Boolean));
    if (!game.isSpectator && game.localPlayerId) {
        if (listed.has(game.localPlayerId)) {
            game._listedByHost = true;
        } else if (game._listedByHost) {
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.KICKED, { reason: 'connection_lost' });
            return;
        }
    }
    list.forEach((entry) => adoptRosterEntry(game, entry));
    Array.from(game.players.keys()).forEach((steamId) => {
        if (listed.has(steamId) || steamId === game.localPlayerId) return;
        game.players.delete(steamId);
        game.unifiedLoop?.unregisterPlayer?.(steamId);
    });
}

/**
 * @param {Record<string, any>} game
 * @param {Record<string, any>} entry
 */
function adoptRosterEntry(game, entry) {
    if (!entry?.steamId) return;
    let player = game.players.get(entry.steamId);
    if (!player) {
        game.addPlayer(entry.steamId, entry.name, entry.steamId === game.localPlayerId);
        player = game.players.get(entry.steamId);
        if (!player) return;
        // The host's alive and late-joiner state from the start, so a drop-in is not
        // shown alive and then knocked out before the first snapshot.
        if (entry.isAlive !== undefined) player.isAlive = entry.isAlive;
    } else {
        player.isReady = entry.isReady;
        player.isAlive = entry.isAlive;
    }
    if (entry.awaitingSpawn !== undefined) player.awaitingSpawn = entry.awaitingSpawn === true;
    // Never ourselves: if the host is holding our seat, our pings are bringing us back.
    player.isDisconnected = entry.steamId !== game.localPlayerId && entry.isDisconnected === true;
    if (entry.color) player.color = entry.color;
}
