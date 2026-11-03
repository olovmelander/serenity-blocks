/**
 * Which Steam P2P session requests the game accepts (legacy ISteamNetworking).
 *
 * Accepting a session lets Steam connect the two machines, directly when it can, which shows
 * each player the other's IP address. So the game accepts a session only from a member of the
 * lobby it is in: anyone else (a stranger who knows a SteamID) is never connected. A request can
 * arrive a moment before the lobby's member list lists its sender (they joined just now), so it
 * waits up to `waitMs` for a member-list change and is then accepted or dropped. Outside a lobby
 * nothing is accepted.
 *
 * Pure (no Electron, no steamworks): electron/steam-integration.js wires it to the callbacks.
 */

export const P2P_SESSION_WAIT_MS = 15_000;

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
                log(`Refused P2P session from ${steamId}: not a member of this lobby`);
            }
        }
    };

    return {
        /** A peer asked to open a session. Returns whether it was accepted now. */
        onRequest(steamId) {
            const id = steamId == null ? '' : String(steamId);
            if (!id) return false;
            expire();
            if (isMember(id)) {
                pending.delete(id);
                tryAccept(id);
                return true;
            }
            if (!pending.has(id)) {
                pending.set(id, now());
                log(`Holding P2P session request from ${id} until it is in the lobby`);
            }
            return false;
        },
        /** The lobby's members changed (or we entered a lobby): accept those who are in it now. */
        onMembersChanged() {
            for (const steamId of [...pending.keys()]) {
                if (isMember(steamId)) {
                    pending.delete(steamId);
                    tryAccept(steamId);
                }
            }
            expire();
        },
        /** We left the lobby: drop every held request. */
        clear() {
            pending.clear();
        },
        get pendingCount() {
            return pending.size;
        },
    };
}
