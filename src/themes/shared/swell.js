// @ts-check

/**
 * Swell — an envelope that ACCUMULATES. The building block of src/themes/shared/gameplay-surge.js
 * (read its header for why): one hit rises over `attack` seconds and falls away over `release`
 * (a difference of two exponentials, normalised so one hit of 1 peaks at 1; with `attack` 0 it
 * is a plain exponential fall from the hit). A new hit ADDS to what is still there and never
 * restarts it, so a weak hit after a strong one can only lift the light. Rapid hits ride up to a
 * plateau (hits every Δ seconds settle near amount × release / Δ) under a soft ceiling: linear to
 * the knee, then easing toward the ceiling. What is stored is bounded too (`headroom` × ceiling),
 * so after a frenzy the glow lingers a moment and then falls away like any other.
 *
 * Exponentials forget their past, so the whole history is two numbers rebased to the last folded
 * hit: no lists, no allocation. A hit may be scheduled a little ahead (a theme that holds its
 * breath before a quad lands); up to PENDING of them wait and join on time. Reading is a pure
 * function of the hits and the time, as long as it is not earlier than the last folded hit.
 *
 * The usual fix for a single-slot envelope (`x.at = now; x.strength = s`, read as
 * `strength * exp(-(now - at) * k)`) is a Swell with `release: 1 / k` and `hit(s, now)`.
 */

/** Late hits waiting for their time, per swell. */
const PENDING = 4;
/** Below this a swell reads as at rest. */
const REST = 1e-5;

/**
 * The soft ceiling: linear up to `knee`, then easing toward `ceiling` (never past it).
 * @param {number} x
 * @param {number} knee
 * @param {number} ceiling
 */
export function softCeiling(x, knee, ceiling) {
    if (!(x > knee)) return x;
    if (!Number.isFinite(ceiling)) return x;
    const room = ceiling - knee;
    if (room <= 0) return ceiling;
    return knee + room * (1 - Math.exp(-(x - knee) / room));
}

export class Swell {
    /**
     * @param {object} [options]
     * @param {number} [options.attack] seconds a hit takes to rise (0: at once)
     * @param {number} [options.release] seconds a hit takes to fall to 1/e of where it was
     * @param {number} [options.ceiling] the reading never passes this (Infinity: no ceiling)
     * @param {number} [options.knee] the reading is linear up to here (default 0.7 × ceiling)
     * @param {number} [options.headroom] what is stored is at most this × the ceiling
     */
    constructor({
        attack = 0, release = 0.6, ceiling = Infinity, knee, headroom = 1.8,
    } = {}) {
        this.release = Math.max(1e-3, release);
        this.attack = Math.max(0, Math.min(attack, this.release * 0.95));
        this.ceiling = ceiling;
        const bounded = Number.isFinite(ceiling);
        this.knee = knee ?? (bounded ? ceiling * 0.7 : Infinity);
        this.limit = Number.isFinite(ceiling) ? ceiling * Math.max(1, headroom) : Infinity;
        // Unit response h(τ) = gain · (e^{-rτ} − e^{-qτ}), peaking at exactly 1.
        this.r = 1 / this.release;
        if (this.attack > 0) {
            this.q = 1 / this.attack;
            const peakAt = Math.log(this.q / this.r) / (this.q - this.r);
            this.gain = 1 / (Math.exp(-this.r * peakAt) - Math.exp(-this.q * peakAt));
        } else {
            this.q = 0;
            this.gain = 1;
        }
        /** Coefficients of e^{-r(t-t0)} and e^{-q(t-t0)}: the whole folded history. */
        this.slow = 0;
        this.fast = 0;
        this.t0 = -Infinity;
        this.pendingAt = new Float64Array(PENDING).fill(Infinity);
        this.pendingAmount = new Float64Array(PENDING);
    }

    /** Folded history alone at time `t` (≥ t0), unsoftened. */
    _base(t) {
        if (this.slow === 0 && this.fast === 0) return 0;
        const dt = Math.max(0, t - this.t0);
        const value = this.slow * Math.exp(-this.r * dt) - (this.q > 0 ? this.fast * Math.exp(-this.q * dt) : 0);
        return value > 0 ? value : 0;
    }

    /** One hit of `amount` started at `at`, read at `t`. */
    _single(amount, at, t) {
        const dt = t - at;
        if (dt < 0) return 0;
        if (this.q === 0) return amount * Math.exp(-this.r * dt);
        return amount * this.gain * (Math.exp(-this.r * dt) - Math.exp(-this.q * dt));
    }

    /** Fold one hit into the history at `at` (≥ t0). Hits were bounded when they came in. */
    _fold(amount, at) {
        if (this.t0 > -Infinity && at > this.t0) {
            const dt = at - this.t0;
            this.slow *= Math.exp(-this.r * dt);
            this.fast *= this.q > 0 ? Math.exp(-this.q * dt) : 0;
        }
        if (at > this.t0) this.t0 = at;
        if (this.slow < 1e-6 && this.fast < 1e-6) {
            this.slow = 0;
            this.fast = 0;
        }
        this.slow += amount * this.gain;
        if (this.q > 0) this.fast += amount * this.gain;
    }

    /** The highest a curve (slow, fast), counted from its own start, climbs from there on. */
    _peak(slow, fast) {
        const start = slow - fast;
        // Rising at its start only while the attack still has more to give than the release takes.
        if (this.q === 0 || fast <= 0 || this.q * fast <= this.r * slow) return Math.max(0, start);
        const tau = Math.log((this.q * fast) / (this.r * slow)) / (this.q - this.r);
        return slow * Math.exp(-this.r * tau) - fast * Math.exp(-this.q * tau);
    }

    /**
     * Bounded memory: a frenzy may hold the light a moment longer, not for a minute. The NEW hit
     * gives up what would carry the curve past the bound (`headroom` × ceiling) from `at` on; the
     * history is never rescaled, so the reading never steps down when a hit arrives.
     */
    _bounded(amount, at) {
        if (!Number.isFinite(this.limit)) return amount;
        const dt = this.t0 > -Infinity ? Math.max(0, at - this.t0) : 0;
        const slow = this.slow * Math.exp(-this.r * dt);
        const fast = this.q > 0 ? this.fast * Math.exp(-this.q * dt) : 0;
        const g = this.gain;
        const withHit = (a) => this._peak(slow + a * g, fast + (this.q > 0 ? a * g : 0));
        if (withHit(amount) <= this.limit) return amount;
        if (withHit(0) >= this.limit) return 0;
        let lo = 0;
        let hi = amount;
        for (let i = 0; i < 16; i += 1) {
            const mid = (lo + hi) * 0.5;
            if (withHit(mid) <= this.limit) lo = mid;
            else hi = mid;
        }
        return lo;
    }

    /** Fold every waiting hit due by `t`, oldest first. */
    _settle(t) {
        for (;;) {
            let first = -1;
            for (let i = 0; i < PENDING; i += 1) {
                if (this.pendingAt[i] <= t && (first < 0 || this.pendingAt[i] < this.pendingAt[first])) first = i;
            }
            if (first < 0) return;
            this._fold(this.pendingAmount[first], this.pendingAt[first]);
            this.pendingAt[first] = Infinity;
            this.pendingAmount[first] = 0;
        }
    }

    /**
     * Add a hit. It joins whatever is still lit; it never restarts it.
     * @param {number} amount 1 peaks at 1 on its own
     * @param {number} at seconds on the caller's clock (may be a little ahead of now)
     */
    hit(amount, at) {
        if (!(amount > 0) || !Number.isFinite(at)) return;
        // Hits never go back in time: one stamped before the last joins it there.
        const when = Math.max(at, this.t0);
        // Time only moves forward: every waiting hit due by then joins the history first, so only
        // hits still ahead of this one wait.
        this._settle(when);
        const bounded = this._bounded(amount, when);
        if (!(bounded > 0)) return;
        if (when <= this.t0) {
            this._fold(bounded, when);
            return;
        }
        let slot = -1;
        for (let i = 0; i < PENDING; i += 1) {
            if (this.pendingAt[i] === Infinity) {
                slot = i;
                break;
            }
        }
        if (slot < 0) {
            // Queue full: the earliest waiting hit joins now, making room.
            let first = 0;
            for (let i = 1; i < PENDING; i += 1) if (this.pendingAt[i] < this.pendingAt[first]) first = i;
            this._fold(this.pendingAmount[first], this.pendingAt[first]);
            this.pendingAt[first] = Infinity;
            slot = first;
        }
        this.pendingAt[slot] = when;
        this.pendingAmount[slot] = bounded;
    }

    /** Unsoftened value at `now` (history plus every waiting hit already due). */
    rawAt(now) {
        if (!Number.isFinite(now)) return 0;
        let value = now >= this.t0 ? this._base(now) : this._base(this.t0);
        for (let i = 0; i < PENDING; i += 1) {
            if (this.pendingAt[i] <= now) value += this._single(this.pendingAmount[i], this.pendingAt[i], now);
        }
        // Never more than the bound (a hit scheduled ahead of a later one can overlap it); spent: a
        // hit that has fallen this far is at rest, exactly.
        value = Math.min(value, this.limit);
        return value > REST ? value : 0;
    }

    /** The reading at `now`, under the soft ceiling. */
    valueAt(now) {
        return softCeiling(this.rawAt(now), this.knee, this.ceiling);
    }

    /** Forget everything. */
    reset() {
        this.slow = 0;
        this.fast = 0;
        this.t0 = -Infinity;
        this.pendingAt.fill(Infinity);
        this.pendingAmount.fill(0);
    }
}
