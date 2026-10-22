/**
 * Thermal Bloom — the fed column: a geyser's eruption that accumulates instead of restarting.
 *
 * The world's eruptions (the Chalice's four-line column, the Consort's double eruption and its
 * back-to-back burst, the Sleeper's column) were once read off "the last clear": any later clear
 * cut a running eruption in one frame. Each is a FedColumn now (thermal-bloom-world.js
 * writeColumns): a running eruption finishes, or is held up and raised by what comes next.
 */
import { lerp, smooth } from './thermal-bloom-core.js';

/** A fed column's crown eases to its new height over this long, and a refill runs back up (s). */
const CROWN_EASE = 0.9;
const REFILL = 0.45;
/** The four-line steam phase starts this long before the column's fall-back. */
export const STEAM_LEAD = 0.6;

/**
 * A column of water that is FED, never restarted (§3.10, §3.5, §3.12). Its first event runs its
 * schedule (an ERUPTIONS entry: the surge before the launch, the rise, the hold, the fall-back);
 * a feed while it stands holds it up longer and raises its crown (eased, so the crown climbs);
 * a feed while it falls back refills it from the vent (the fall-back runs back up to the crown).
 * Only a feed after its water is down launches a new column. Between feeds it is closed form in
 * the clock, so a seek plus the same fixed steps replays it. The steam phases a feed overtook
 * (started, then pushed later by the longer hold) are kept in `overtaken` to roll on to their end.
 */
export class FedColumn {
    /**
     * @param {object} schedule an ERUPTIONS entry
     * @param {object} [options]
     * @param {number} [options.gain] the crown a full feed adds (fraction of the schedule's height)
     * @param {number} [options.most] the crown's ceiling (multiple of the schedule's height)
     */
    constructor(schedule, { gain = 0.25, most = 1.5 } = {}) {
        this.e = schedule;
        this.gain = gain;
        this.most = most;
        this.overtaken = new Float64Array(2);
        this.reset();
    }

    reset() {
        /** The event that launched it, the latest feed, and when its fall-back begins. */
        this.at = -1e6;
        this.kickAt = -1e6;
        this.holdEnd = -1e6;
        /** The crown, easing from `peakFrom` to `peakTo` after the feed at `peakAt`. */
        this.peakFrom = this.e.height;
        this.peakTo = this.e.height;
        this.peakAt = -1e6;
        /** A refill: when, and how far through the fall-back it found the column. */
        this.refillAt = -1e6;
        this.refillFrom = 0;
        this.feeds = 0;
        this.overtaken.fill(-1e6);
    }

    /** When its water is down. */
    get end() {
        return this.holdEnd + this.e.fall;
    }

    /** From its event until its water is down. */
    live(t) {
        return t >= this.at && t < this.end;
    }

    /** The crown's height at t. */
    peak(t) {
        return lerp(this.peakFrom, this.peakTo, smooth(this.peakAt, this.peakAt + CROWN_EASE, t));
    }

    /**
     * An event feeds it at t: `amount` 1 is a full feed (a crown step and the schedule's hold);
     * smaller events hold it up a little and raise it a little. `launch` false: only a standing
     * column is fed (nothing launches). Returns true when a new column launched.
     */
    feed(t, amount = 1, { launch = true, lead = STEAM_LEAD } = {}) {
        const { e } = this;
        if (!this.live(t)) {
            if (!launch) return false;
            this.keepSteam(t, lead);
            this.at = t;
            this.kickAt = t;
            this.holdEnd = t + e.delay + e.rise + e.hold;
            this.peakFrom = e.height;
            this.peakTo = e.height;
            this.peakAt = t;
            this.refillAt = -1e6;
            this.refillFrom = 0;
            this.feeds = 0;
            return true;
        }
        // A small feed (a clear under the column) holds it a little and lifts it a little; only
        // a full one (another four) refills a column already falling back.
        const falling = t >= this.holdEnd;
        if (falling && amount < 0.5) return false;
        this.peakFrom = this.peak(t);
        this.peakTo = Math.min(e.height * this.most, this.peakTo + e.height * this.gain * amount);
        this.peakAt = t;
        const hold = t + (e.delay + e.rise * 0.5 + e.hold) * Math.min(1, amount * 3);
        if (hold > this.holdEnd) {
            this.keepSteam(t, lead);
            if (falling) {
                // Falling back: the vent pours in again and the column refills from its foot.
                this.refillFrom = (t - this.holdEnd) / e.fall;
                this.refillAt = t;
            }
            this.holdEnd = hold;
        }
        this.kickAt = t;
        this.feeds += 1;
        return false;
    }

    /** A steam phase already rolling (it starts `lead` before the fall-back) is kept to its end. */
    keepSteam(t, lead) {
        const { e } = this;
        const start = this.holdEnd - lead;
        if (!(e.steam > 0) || !(t >= start) || t - start > e.steam + lead) return;
        const o = this.overtaken;
        const slot = o[0] <= o[1] ? 0 : 1;
        o[slot] = start;
    }

    /** What the shaders draw at t (as columnState: crown height and fall-back); `surge` the age before the launch. */
    state(t, out) {
        const { e } = this;
        out.height = 0;
        out.fall = 0;
        out.surge = -1;
        const age = t - this.at;
        if (!(age >= 0) || t >= this.end) return out;
        if (age < e.delay) {
            out.surge = age;
            return out;
        }
        const peak = this.peak(t);
        if (t < this.holdEnd) {
            const k = Math.min(1, (age - e.delay) / e.rise);
            out.height = peak * (1 - (1 - k) * (1 - k));
            const r = t - this.refillAt;
            if (r >= 0 && r < REFILL) out.fall = this.refillFrom * (1 - smooth(0, REFILL, r));
            return out;
        }
        out.height = peak;
        out.fall = Math.max((t - this.holdEnd) / e.fall, 1e-3);
        return out;
    }
}
