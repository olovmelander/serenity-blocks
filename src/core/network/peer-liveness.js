// @ts-check

/**
 * When each peer was last heard from. Every packet that passes the transport's checks
 * counts, whatever it carries, and each peer also pings the host once a second, so a
 * quiet one (waiting, watching, knocked out) is heard too (multiplayer/ffa/presence.js).
 */
export class PeerLiveness {
    constructor() {
        /** @type {Map<string, number>} */
        this.lastHeard = new Map();
    }

    /** @param {string} steamId @param {number} now */
    heard(steamId, now) {
        if (steamId) this.lastHeard.set(steamId, now);
    }

    /**
     * How long a peer has been silent. The first question about a peer starts its
     * clock, so one never heard from (a roster entry seeded by a migration) counts as
     * silent from then on.
     * @param {string} steamId
     * @param {number} now
     */
    silenceMs(steamId, now) {
        const last = this.lastHeard.get(steamId);
        if (last === undefined) {
            this.lastHeard.set(steamId, now);
            return 0;
        }
        return Math.max(0, now - last);
    }

    /** @param {string} steamId */
    forget(steamId) {
        this.lastHeard.delete(steamId);
    }

    clear() {
        this.lastHeard.clear();
    }
}
