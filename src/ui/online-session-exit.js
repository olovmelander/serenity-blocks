// The toast region listens for the `serenity:toast` events dispatched below.
import './components/toast.js';
import { RELAY_UNREACHABLE_MESSAGE, relayNetworkUnreachableNow } from '../core/steam/relay-network.js';

const EXIT_MESSAGES = Object.freeze({
    update_required: 'Update Serenity Blocks to join this match.',
    host_update_required: 'This host is using an older version. Ask the host to update Serenity Blocks.',
    invalid_protocol_range: 'The match version could not be verified. Update Serenity Blocks and try again.',
    invalid_protocol_selection: 'The host returned an invalid network version. The join was stopped.',
    envelope_mismatch: 'This match uses an incompatible network envelope. Update Serenity Blocks and try again.',
    protocol_mismatch: 'This match uses an incompatible version of Serenity Blocks.',
    lobby_full: 'This lobby is full. Choose another match or try again later.',
    join_failed: 'The host could not add you to this match.',
    host_unreachable: 'The host did not answer. The lobby may have closed, so try another match.',
    kicked: 'You were removed from the match by the host.',
    connection_lost: 'The host lost contact with you, so you left the match.',
    host_left: 'The host left, so the lobby closed.',
    // The match seemed won because everyone else fell silent, but it was this computer that
    // dropped (core/game-modes/online-departure-win.js).
    own_connection_lost: 'Your connection to Steam was lost, so the match ended.',
    // The host gave up resending the match state. It used to read "removed by the host".
    resync_retry_exhausted: 'The match could not be kept in sync with the host, so you left it.',
});

/**
 * A host change mid-match (core/network/host-migration.js) in words for the player.
 * @param {{ newHostId?: unknown, localSteamId?: unknown, name?: string | null }} change
 * @returns {string} empty when there is no new host to name
 */
export function describeNewHost({ newHostId, localSteamId, name } = {}) {
    if (!newHostId) return '';
    if (localSteamId && String(newHostId) === String(localSteamId)) return 'You are now hosting this match.';
    return name ? `${name} is now hosting this match.` : 'This match has a new host.';
}

/**
 * Tell the player who hosts now. The match carries on, so this is a note, not a warning.
 * @param {any} mode the online mode: nothing is said once its match is gone
 * @param {{ newHostId?: unknown }} [change]
 */
export function announceNewHost(mode, change = {}) {
    if (!mode?.ffaGameState) return;
    const message = describeNewHost({
        newHostId: change.newHostId,
        localSteamId: mode.steamNetworking?.steamId,
        name: mode._getPlayerName?.(change.newHostId),
    });
    if (!message) return;
    try {
        window.dispatchEvent(new CustomEvent('serenity:toast', { detail: { message, type: 'info' } }));
    } catch (error) { /* no-op outside the browser */ }
}

/**
 * Ways out of a match that arrive as a "kicked" event and have words of their own. Any other
 * reason a host sends reads as a plain removal: the host's text is never shown.
 */
export const KNOWN_EXIT_REASONS = Object.freeze([
    'connection_lost', 'host_left', 'own_connection_lost', 'resync_retry_exhausted',
]);

/** Why a host can be gone that this computer's relay network would explain (core/network/host-migration.js). */
const RELAY_EXPLAINS_HOST_GONE = new Set(['p2p_failed', 'timeout']);

/**
 * Exits a relay network this computer cannot reach explains better than their own words: the
 * host never answered the join, or the session with it failed or fell silent outside a match.
 * A host who left on purpose is not one.
 */
function relayMayExplain(reason, detail) {
    return reason === 'host_unreachable'
        || (reason === 'host_left' && RELAY_EXPLAINS_HOST_GONE.has(detail.hostGone));
}

/**
 * Terminal join failures arrive redundantly as WELCOME(false) and
 * JOIN_REJECTED. Teardown and notification are deliberately one-shot.
 * @param {any} mode
 * @param {any} detail
 */
export async function handleOnlineSessionExit(mode, detail = {}) {
    const reason = typeof detail.reason === 'string' ? detail.reason : 'protocol_mismatch';
    if (mode._handledSessionExit) return;
    mode._handledSessionExit = reason;
    // Asked now, before the teardown lets the networking go, and never from an earlier answer:
    // asking is what makes Steam try a failed relay network again (core/steam/relay-network.js).
    const relayUnreachable = relayMayExplain(reason, detail)
        ? relayNetworkUnreachableNow(mode.steamNetworking)
        : false;
    try { await mode._handleExitToMenu(); } catch (error) { /* best-effort teardown */ }
    const message = (await relayUnreachable)
        ? RELAY_UNREACHABLE_MESSAGE
        : (EXIT_MESSAGES[reason] ?? 'Unable to join this match.');
    try {
        window.dispatchEvent(new CustomEvent('serenity:toast', {
            detail: { message, type: 'warning' },
        }));
    } catch (error) { /* no-op outside the browser */ }
}
