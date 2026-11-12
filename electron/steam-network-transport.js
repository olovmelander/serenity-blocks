/**
 * How online play reaches other players, as electron/steam-integration.js reports it to the
 * game's page (`steam:getNetworkTransport`):
 *
 * - `relay`: through Steam's relays only (electron/steam-relay-transport.js). No player sees
 *   another's IP address. The only way a store build plays online.
 * - `unavailable`: Steam runs, but the relay transport could not open. Lobbies cannot be created
 *   or joined, and the page shows `message`.
 * - `direct`: a development run that set SERENITY_ALLOW_DIRECT_P2P (electron/debug-flags.js)
 *   after the relay failed: the legacy P2P calls, which connect directly and show IP addresses.
 * - `none`: Steam is not running.
 *
 * Pure: the unit tests pin it.
 */

export const RELAY_UNAVAILABLE_MESSAGE = 'Online play needs Steam\'s relay network, which could not be '
    + 'started on this computer. Restart Steam and the game, then try again.';

/** @typedef {'relay' | 'unavailable' | 'direct' | 'none'} NetworkMode */

/**
 * @param {object} state
 * @param {NetworkMode} state.mode
 * @param {string | null} [state.reason]        why the relay is not in use (logged, not shown)
 * @param {string | null} [state.relayNetwork]  Steam's relay network status, when known
 */
export function describeNetworkTransport({ mode, reason = null, relayNetwork = null }) {
    return {
        mode,
        relayOnly: mode === 'relay',
        reason: mode === 'relay' ? null : reason,
        message: mode === 'unavailable' ? RELAY_UNAVAILABLE_MESSAGE : null,
        relayNetwork,
    };
}

/** Whether lobbies may be created or joined (and packets sent) in this mode. */
export function lobbyAllowed(mode) {
    return mode === 'relay' || mode === 'direct';
}
