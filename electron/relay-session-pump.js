/**
 * The relayed sessions' upkeep (ADR-0023): which players the game has a session with, accepting
 * the sessions it may, and closing the ones it must.
 *
 * - Steam's session-request callback is not available through steamworks.js 0.4.0, so as packets
 *   are read (at most every RELAY_ACCEPT_EVERY_MS) the pump asks the relay transport to accept the
 *   pending session of every lobby member the session gate allows
 *   (electron/p2p-session-gate.js). Steam accepts a request that is pending and ignores a peer who
 *   has not asked. A member the gate does not allow is never accepted.
 * - Every RELAY_CHECK_EVERY_MS it reads the state of each session it knows of, and acts on a
 *   change only: a session that reaches Connected is logged, and closed and reported if it is not
 *   relayed (with ICE off this should never happen); a session that ended is reported.
 * - Leaving a lobby (or Steam going) closes every session it knows of.
 *
 * A player whose session was closed for not being relayed is still a lobby member the gate allows:
 * if they keep sending, their session is accepted again and, found not relayed again, closed and
 * reported again.
 *
 * The log lines are the ones the two-account test looks for
 * (docs/ONLINE_RELAY_TRANSPORT_2026-11.md).
 *
 * Pure (no Electron, no steamworks, no koffi): electron/steam-integration.js wires it to the relay
 * transport (electron/steam-relay-transport.js), the gate, the lobby and the page.
 */
import { SESSION_STATE, relayPumpDue } from './steam-relay-transport.js';

export const RELAY_ACCEPT_EVERY_MS = 200;
export const RELAY_CHECK_EVERY_MS = 1000;

/**
 * @param {object} options
 * @param {() => import('./steam-relay-transport.js').RelayTransport | null} options.transport
 *   the relay transport while it is open
 * @param {() => { allowsSession: (steamId: string) => boolean } | null} options.gate
 *   the session gate, once there is one
 * @param {() => boolean} options.inLobby  whether we are in a lobby
 * @param {() => string[]} options.members  the lobby's members other than us, as SteamID64s
 * @param {() => number} options.now  a monotonic clock (performance.now()): a wall clock set back
 *   would stall the accepts and checks until it caught up
 * @param {(failure: { steamId: string, error: number | 'not-relayed' }) => void} options.report
 *   a session that ended (its state) or was closed for not being relayed
 * @param {(message: string) => void} [options.log]
 */
export function createRelaySessionPump({
    transport, gate, inLobby, members, now, report, log = () => {},
}) {
    /** steamId -> the state its session was last seen in */
    const peers = new Map();
    let acceptedAt = 0;
    let checkedAt = 0;

    const closeSession = (relay, steamId) => {
        try {
            relay.close(String(steamId));
        } catch (error) {
            log(`WARN: closing the relayed session with ${steamId} failed: ${error?.message || error}`);
        }
    };

    return {
        /** We sent to, or heard from, this player: watch their session. */
        notePeer(steamId) {
            const id = String(steamId);
            if (!peers.has(id)) peers.set(id, SESSION_STATE.none);
        },
        /** Accept and check, each when it is due. Called as packets are read. */
        pump() {
            const relay = transport();
            if (!relay || !inLobby()) return;
            const at = now();
            if (relayPumpDue(at, acceptedAt, RELAY_ACCEPT_EVERY_MS)) {
                acceptedAt = at;
                for (const steamId of members()) {
                    const accepted = gate()?.allowsSession(steamId) && relay.acceptFrom(steamId);
                    if (accepted && !peers.has(steamId)) {
                        peers.set(steamId, SESSION_STATE.none);
                        log(`Accepted a relayed session from lobby member ${steamId}`);
                    }
                }
            }
            if (!relayPumpDue(at, checkedAt, RELAY_CHECK_EVERY_MS)) return;
            checkedAt = at;
            for (const [steamId, before] of peers) {
                const session = relay.session(steamId);
                if (session.state === before) continue;
                peers.set(steamId, session.state);
                if (session.state === SESSION_STATE.connected) {
                    log(`Session with ${steamId}: connected, relayed=${session.relayed}, `
                        + `peer address known=${session.addressKnown}`);
                    if (session.layoutOk && !session.relayed) {
                        log(`WARN: session with ${steamId} is not relayed; closing it`);
                        relay.close(steamId);
                        peers.delete(steamId);
                        report({ steamId, error: 'not-relayed' });
                    }
                } else if (session.state === SESSION_STATE.closedByPeer || session.state === SESSION_STATE.problem) {
                    log(`WARN: relayed session with ${steamId} ended (state ${session.state})`);
                    report({ steamId, error: session.state });
                }
            }
        },
        /** The game is done with this player: close their session at once. */
        close(steamId) {
            const relay = transport();
            if (!relay || steamId == null) return;
            closeSession(relay, steamId);
            peers.delete(String(steamId));
        },
        /** We left the lobby (or Steam is going): close every session. */
        closeAll() {
            const relay = transport();
            if (!relay) return;
            for (const steamId of peers.keys()) closeSession(relay, steamId);
            peers.clear();
        },
        /** The transport the sessions were on is gone: forget them without closing. */
        forgetAll() {
            peers.clear();
        },
    };
}
