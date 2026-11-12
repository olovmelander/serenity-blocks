/**
 * Which Steam P2P sessions the game opens and accepts (legacy ISteamNetworking).
 *
 * Opening a session lets Steam connect the two machines, directly when it can, which shows
 * each player the other's IP address. So the game connects to as few players as it needs:
 *
 * - Outside a lobby nothing is accepted, and never anyone who is not a member of the lobby it
 *   is in (a stranger who knows a SteamID is never connected).
 * - A match is a star through its host: every player and spectator talks to the host only.
 *   So a host accepts any lobby member, and everyone else accepts, and sends to, the host
 *   alone. Another member asking for a session is held and then refused.
 * - The one time a player who is not the host hears from another is a host handover: when the
 *   host drops out mid-match, the player who takes over announces it to the others
 *   (src/core/network/host-migration.js). While the game says its host looks gone
 *   (`hostSuspected`), any lobby member is accepted, as before; once the new host is followed,
 *   the allowed player is that host.
 *
 * The game's page tells the main process its role (`setPolicy`): whether it hosts, who its host
 * is, and whether that host looks gone. The host is the game's own: it starts as the lobby's
 * owner and follows the game's handover, which Steam's choice of a new lobby owner need not
 * match. Until a role is set, any lobby member is accepted, as before.
 *
 * A request can arrive a moment before its sender is allowed (they joined just now, or the
 * handover is a moment ahead of this player's own view of it), so it waits up to `waitMs` for
 * a member-list or role change and is then accepted or dropped.
 *
 * Pure (no Electron, no steamworks): electron/steam-integration.js wires it to the callbacks.
 */

export const P2P_SESSION_WAIT_MS = 15_000;

/**
 * @typedef {{ isHost: boolean, hostSteamId: string | null, hostSuspected: boolean }} P2PPeerPolicy
 */

/**
 * The role the game's page reports, made safe to use: anything malformed reads as a player
 * with no host, who is connected to nobody.
 * @param {unknown} raw
 * @returns {P2PPeerPolicy | null} null to forget the role (any lobby member, as before)
 */
export function normalizeP2PPeerPolicy(raw) {
    if (raw === null || raw === undefined) return null;
    const value = /** @type {Record<string, unknown>} */ (typeof raw === 'object' ? raw : {});
    const host = typeof value.hostSteamId === 'string' || typeof value.hostSteamId === 'bigint'
        ? String(value.hostSteamId) : '';
    return {
        isHost: value.isHost === true,
        hostSteamId: /^\d{1,20}$/.test(host) ? host : null,
        hostSuspected: value.hostSuspected === true,
    };
}

/**
 * @param {object} options
 * @param {(steamId: string) => void} options.accept      accept the session (steamworks)
 * @param {(steamId: string) => boolean} options.isMember  in the lobby we are in right now
 * @param {() => number} [options.now]
 * @param {number} [options.waitMs]
 * @param {(message: string) => void} [options.log]
 */
export function createP2PSessionGate({
    accept, isMember, now = Date.now, waitMs = P2P_SESSION_WAIT_MS, log = () => {},
}) {
    /** steamId -> when its request arrived */
    const pending = new Map();
    /** @type {P2PPeerPolicy | null} */
    let policy = null;
    /** Players a refused send was already logged for (one line each, not one per packet). */
    const refusedSends = new Set();

    /** Whether the game's role lets it talk to this player (lobby membership aside). */
    const roleAllows = (steamId) => {
        if (!policy || policy.isHost) return true;
        return steamId === policy.hostSteamId || policy.hostSuspected;
    };

    const allows = (steamId) => isMember(steamId) && roleAllows(steamId);

    const tryAccept = (steamId) => {
        try {
            accept(steamId);
            log(`Accepted P2P session from lobby member ${steamId}`);
        } catch (error) {
            log(`WARN: failed to accept P2P session from ${steamId}: ${error?.message || error}`);
        }
    };

    const expire = () => {
        const t = now();
        for (const [steamId, at] of pending) {
            if (t - at > waitMs) {
                pending.delete(steamId);
                log(`Refused P2P session from ${steamId}: ${isMember(steamId)
                    ? 'not the host of this match' : 'not a member of this lobby'}`);
            }
        }
    };

    const acceptAllowedPending = () => {
        for (const steamId of [...pending.keys()]) {
            if (allows(steamId)) {
                pending.delete(steamId);
                tryAccept(steamId);
            }
        }
        expire();
    };

    return {
        /** A peer asked to open a session. Returns whether it was accepted now. */
        onRequest(steamId) {
            const id = steamId == null ? '' : String(steamId);
            if (!id) return false;
            expire();
            if (allows(id)) {
                pending.delete(id);
                tryAccept(id);
                return true;
            }
            if (!pending.has(id)) {
                pending.set(id, now());
                log(`Holding P2P session request from ${id} until it is ${isMember(id)
                    ? 'the host of this match' : 'in the lobby'}`);
            }
            return false;
        },
        /** The lobby's members changed (or we entered a lobby): accept those allowed now. */
        onMembersChanged() {
            acceptAllowedPending();
        },
        /**
         * The game's role changed: it hosts, it follows a (new) host, or its host looks gone.
         * @param {unknown} next  see normalizeP2PPeerPolicy
         */
        setPolicy(next) {
            policy = normalizeP2PPeerPolicy(next);
            refusedSends.clear();
            acceptAllowedPending();
        },
        /**
         * Whether the game may send to this player. Sending opens a session, so everyone but
         * the host sends to the host alone (and, during a handover, to the other members). A
         * host's sends are not narrowed: it answers whoever is in its match.
         * @param {unknown} steamId
         */
        allowsSend(steamId) {
            const id = steamId == null ? '' : String(steamId);
            if (!id) return false;
            if (roleAllows(id)) return true;
            if (!refusedSends.has(id) && refusedSends.size < 64) {
                refusedSends.add(id);
                log(`Refused to send to ${id}: not the host of this match`);
            }
            return false;
        },
        /** We left the lobby: drop every held request and forget the role. */
        clear() {
            pending.clear();
            refusedSends.clear();
            policy = null;
        },
        get pendingCount() {
            return pending.size;
        },
        /** The role in force, or null before the game has set one. */
        get policy() {
            return policy ? { ...policy } : null;
        },
    };
}
