// @ts-check
/**
 * Steam's relay network as the page reads it (ADR-0023). Online play runs only through Valve's
 * relays. When this computer cannot reach them (a firewall that blocks them, say), lobbies still
 * work but no session connects. Before, every join then ended "The host did not answer", and a
 * host's waiting room just stayed empty.
 *
 * Steam reports the relay network's state (`relayNetwork` in `steam:getNetworkTransport`, its
 * values named in electron/steam-relay-transport.js), but no answer is final: Steam tries again
 * when the network is next needed, a status query included. So the status never stops play
 * (steam-networking.js refuses only a relay transport that did not open). It explains a join or a
 * session that failed (ui/online-session-exit.js) and warns a host (ui/lobby-waiting-room.js),
 * asked afresh each time.
 */

/**
 * The statuses Steam counts as a problem, its negative availability values: it cannot try, it
 * tried and never succeeded, it lost a relay network it had, or it is retrying after one of those.
 */
export const RELAY_NETWORK_TROUBLE = Object.freeze(['cannot-try', 'failed', 'previously', 'retrying']);

/** What a player reads when a join or a session failed while the relay network was out of reach. */
export const RELAY_UNREACHABLE_MESSAGE = 'Steam\'s relay network cannot be reached from this computer, '
    + 'so online matches cannot connect. Check your firewall or network connection, then try again.';

/** What a host reads, once for each lobby, while it is out of reach. */
export const RELAY_UNREACHABLE_HOST_NOTICE = 'Players may not be able to join: Steam\'s relay network '
    + 'cannot be reached from this computer. Check your firewall or network connection.';

/** A host's lobby asks again this often while the relay network is still starting, this many times in all. */
export const HOST_RELAY_CHECK_EVERY_MS = 5000;
export const HOST_RELAY_CHECKS = 6;

/** @typedef {{ relayNetworkStatus?: () => Promise<string | null> } | null | undefined} RelayNetworkSource */

/** @param {unknown} status */
export function relayNetworkUnreachable(status) {
    return typeof status === 'string' && RELAY_NETWORK_TROUBLE.includes(status);
}

/**
 * Steam's relay network status now, or null when it cannot be had.
 * @param {RelayNetworkSource} network
 */
async function statusNow(network) {
    try {
        return (await network?.relayNetworkStatus?.()) ?? null;
    } catch {
        return null;
    }
}

/**
 * Whether the relay network is out of reach now.
 * @param {RelayNetworkSource} network
 */
export async function relayNetworkUnreachableNow(network) {
    return relayNetworkUnreachable(await statusNow(network));
}

/**
 * Tell a host, once, that the relay network is out of reach: its lobby is listed, but no join can
 * arrive. Hosting goes on. While the relay network is still starting it asks again, up to
 * HOST_RELAY_CHECKS times in all; it stops at a settled answer, or once this lobby is no longer
 * hosted.
 * @param {RelayNetworkSource} network
 * @param {{ hosting: () => boolean, notify: (message: string) => void }} options
 * @param {number} [checksLeft]
 * @returns {Promise<boolean>} whether the host was told
 */
export async function warnHostIfRelayUnreachable(network, { hosting, notify }, checksLeft = HOST_RELAY_CHECKS) {
    if (!hosting()) return false;
    const status = await statusNow(network);
    if (!hosting()) return false;
    if (relayNetworkUnreachable(status)) {
        notify(RELAY_UNREACHABLE_HOST_NOTICE);
        return true;
    }
    // No answer (a test lobby, an older main process), or the relay network is up.
    if (status === null || status === 'current' || checksLeft <= 1) return false;
    await new Promise((resolve) => { setTimeout(resolve, HOST_RELAY_CHECK_EVERY_MS); });
    return warnHostIfRelayUnreachable(network, { hosting, notify }, checksLeft - 1);
}
