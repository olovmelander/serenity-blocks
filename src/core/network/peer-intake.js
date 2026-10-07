// @ts-check

/**
 * The transport's first look at a packet, before any parsing: a per-sender budget, so a
 * flooding peer cannot make this side parse and dispatch without end, and a size cap for
 * what the sender's role ever needs to send.
 */

/** Packets a sender may burst, and per second after: snapshots (about 34 a second), inputs (60 at most) and resync bursts fit with room to spare. */
export const INTAKE_BURST = 400;
export const INTAKE_PER_SECOND = 200;
/** The largest packet a peer sends the host (inputs, acks, chat). */
export const MAX_PEER_PACKET_BYTES = 16 * 1024;
/** The largest packet the host (or a successor's sync) sends a peer: a resync chunk, a snapshot. */
export const MAX_HOST_PACKET_BYTES = 256 * 1024;

export class PeerIntake {
    constructor() {
        /** @type {Map<string, {tokens: number, at: number}>} */
        this.buckets = new Map();
    }

    /**
     * @param {string} steamId
     * @param {number} now
     * @param {number} [bytes] the packet's size, when cheaply known
     * @param {number} [maxBytes]
     * @returns {boolean} whether to look at the packet at all
     */
    admit(steamId, now, bytes = 0, maxBytes = Infinity) {
        if (bytes > maxBytes) return false;
        let bucket = this.buckets.get(steamId);
        if (!bucket) {
            bucket = { tokens: INTAKE_BURST, at: now };
            this.buckets.set(steamId, bucket);
        } else if (now > bucket.at) {
            bucket.tokens = Math.min(INTAKE_BURST, bucket.tokens + ((now - bucket.at) * INTAKE_PER_SECOND) / 1000);
            bucket.at = now;
        }
        if (bucket.tokens < 1) return false;
        bucket.tokens -= 1;
        return true;
    }

    clear() {
        this.buckets.clear();
    }
}
