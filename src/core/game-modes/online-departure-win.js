// @ts-check

/**
 * A win because everyone else left, and whose connection it was that broke.
 *
 * When the link between two players breaks, each side sees the other fall silent, and a match
 * left with one present player is over with that player its winner (multiplayer/frag-tracker.js,
 * ffa/presence.js). So both sides of a broken link won, with the same match ID, and a player
 * whose own internet died was shown a victory. Without a server neither side can know who
 * dropped, with one exception: a side whose own connection to Steam is down knows it was the
 * one. That side is told its connection was lost and records no win. When both are still
 * connected, both keep their result.
 */

import { relayNetworkUnreachableNow } from '../steam/relay-network.js';

/** The exit reason of a player whose own connection broke (ui/online-session-exit.js words it). */
export const OWN_CONNECTION_LOST = 'own_connection_lost';

/** How long the question "is my own connection down?" may hold up the results. */
export const OWN_CONNECTION_CHECK_MS = 600;

/**
 * Whether this player won because no other player was left in the match.
 * @param {{ winner?: { steamId?: unknown } | string | null } | null | undefined} result the match result
 * @param {{ localSteamId?: unknown, players?: Map<string, { isDisconnected?: boolean } | null> | null }} match
 */
export function wonBecauseEveryoneLeft(result, { localSteamId, players } = {}) {
    const winner = result?.winner;
    const winnerId = winner && typeof winner === 'object' ? winner.steamId : winner;
    if (!localSteamId || !winnerId || String(winnerId) !== String(localSteamId)) return false;
    if (!(players instanceof Map)) return false;
    let present = 0;
    players.forEach((player) => { if (player && !player.isDisconnected) present += 1; });
    return present < 2;
}

/**
 * Whether this computer's own connection is down right now: the operating system reports no
 * network, or Steam's relay network cannot be reached. The answer is bounded in time, and an
 * answer that does not come counts as connected, so a slow reply never takes a real win away.
 * @param {import('../steam/relay-network.js').RelayNetworkSource} network
 * @param {{ timeoutMs?: number, online?: boolean | undefined }} [options]
 */
export async function ownConnectionLost(network, {
    timeoutMs = OWN_CONNECTION_CHECK_MS,
    online = typeof navigator !== 'undefined' ? navigator.onLine : undefined,
} = {}) {
    if (online === false) return true;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const givenUp = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    try {
        return Boolean(await Promise.race([relayNetworkUnreachableNow(network), givenUp]));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Settle a finished match for this player. A win because everyone else left waits for the
 * answer about this computer's own connection: lost, and the player leaves the match with that
 * reason and no win recorded; otherwise the result is recorded and shown like any other.
 * @param {any} mode the online mode
 * @param {any} detail the match result
 */
export function settleMatchResult(mode, detail) {
    if (mode._ownConnectionCheck) return; // the same result again while the check runs
    const everyoneLeft = wonBecauseEveryoneLeft(detail, {
        localSteamId: mode.steamNetworking?.steamId,
        players: mode.ffaGameState?.players,
    });
    if (!everyoneLeft) {
        mode._recordAndShowResults(detail);
        return;
    }
    const check = ownConnectionLost(mode.steamNetworking).catch(() => false).then((lost) => {
        if (mode._ownConnectionCheck !== check) return undefined; // the session was torn down meanwhile
        mode._ownConnectionCheck = null;
        // The mode leaves the match with the reason (its exit path owns teardown and the notice).
        if (lost) return mode._handleKicked({ reason: OWN_CONNECTION_LOST });
        return mode._recordAndShowResults(detail);
    });
    mode._ownConnectionCheck = check;
}
