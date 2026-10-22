/**
 * Bioluminescence — an envelope that accumulates and may be hit ahead of time.
 *
 * A thin wrapper round the shared Swell (src/themes/shared/swell.js): every hit adds to what is
 * still lit and nothing restarts. The grotto schedules a lot of its light a moment ahead (a four's
 * bloom waits out the hush, a jelly flash waits for the wave), often several hits in one frame;
 * a Swell given a second hit at or after one still waiting folds both into its history at that
 * future time, and is then read early. Here a hit that is not due yet waits in a short queue and
 * joins the Swell only once the world's clock has reached it (`advance`), and a reading counts
 * every waiting hit that is due by the time read — so a reading is a pure function of the hits
 * and the time it is read at, whatever order the hits came in.
 *
 * Instant rise only (attack 0): a waiting hit's share of a reading is a plain exponential fall.
 */

import { Swell, softCeiling } from '../shared/swell.js';

/** Hits that may wait at once; a full queue merges a new one into the nearest in time. */
const QUEUE = 8;

export class Envelope {
    /**
     * @param {object} [options]  Swell options (release, ceiling, knee, headroom; no attack)
     */
    constructor(options = {}) {
        this.swell = new Swell({ ...options, attack: 0 });
        this.now = -Infinity;
        this.at = new Float64Array(QUEUE).fill(Infinity);
        this.amount = new Float64Array(QUEUE);
    }

    /** Add `amount` at `at` (seconds; may be ahead of the clock). */
    hit(amount, at) {
        if (!(amount > 0) || !Number.isFinite(at)) return;
        if (at <= this.now) {
            this.swell.hit(amount, at);
            return;
        }
        let free = -1;
        let nearest = 0;
        for (let k = 0; k < QUEUE; k++) {
            if (this.at[k] === at) {
                this.amount[k] += amount;
                return;
            }
            if (this.at[k] === Infinity) {
                if (free < 0) free = k;
            } else if (Math.abs(this.at[k] - at) < Math.abs(this.at[nearest] - at)) nearest = k;
        }
        if (free < 0) {
            // (Full: it lands with the nearest one waiting, the earlier of the two times.)
            this.amount[nearest] += amount;
            this.at[nearest] = Math.min(this.at[nearest], at);
            return;
        }
        this.at[free] = at;
        this.amount[free] = amount;
    }

    /** The clock has reached `now`: every waiting hit due by then joins the swell, oldest first. */
    advance(now) {
        if (!(now > this.now)) return;
        this.now = now;
        for (;;) {
            let first = -1;
            for (let k = 0; k < QUEUE; k++) {
                if (this.at[k] <= now && (first < 0 || this.at[k] < this.at[first])) first = k;
            }
            if (first < 0) return;
            this.swell.hit(this.amount[first], this.at[first]);
            this.at[first] = Infinity;
            this.amount[first] = 0;
        }
    }

    /** The reading at `time` (no earlier than the clock), every hit due by then counted. */
    valueAt(time) {
        if (!Number.isFinite(time)) return 0;
        const { swell } = this;
        let raw = swell.rawAt(time);
        for (let k = 0; k < QUEUE; k++) {
            if (this.at[k] <= time) raw += this.amount[k] * Math.exp(-(time - this.at[k]) / swell.release);
        }
        raw = Math.min(raw, swell.limit);
        return raw > 1e-5 ? softCeiling(raw, swell.knee, swell.ceiling) : 0;
    }

    /** Forget everything (the clock too: a seek may go back). */
    reset() {
        this.swell.reset();
        this.now = -Infinity;
        this.at.fill(Infinity);
        this.amount.fill(0);
    }
}
