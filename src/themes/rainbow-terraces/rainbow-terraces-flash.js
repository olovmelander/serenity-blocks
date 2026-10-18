/**
 * Rainbow Terraces: the flash governor (CPU only, three-free).
 *
 * Every flash the world wants (a surge down the falls, a splash crown, the toll, the spray
 * burst, the closing light round the bow, and the scripted set pieces: the hush's dip, the
 * glory's flare, the great pour) is REQUESTED here first, and the world plays what it is
 * granted: when it may start, how strong it may be, how slowly it must rise and fall, and how
 * much of it may stay saturated red. The rules are WCAG 2.3.1's, with margin:
 *
 *   onsets  at most 3 flash onsets in any 1 s, globally; an extra one is queued after the one
 *           before (≥ 0.11 s), and after the oldest of the last three has left the window
 *   ramps   every envelope rises over ≥ 60 ms (≥ 0.6 s under reduced motion, where a flash
 *           becomes a glow) and falls over ≥ 150 ms (≥ 0.6 s reduced)
 *   routine all routine flashes alive together may move the frame-mean luminance by ≤ 10 %
 *           (the world estimates each as areaFraction × strength, strength being the relative
 *           brightening of that area); the iris then only ever takes some of it back
 *   set     a scripted set piece gets one transition pair of ≤ 35 %, ramps ≥ 80 ms
 *   red     saturated red flash area stays ≤ 25 % of the frame: what would pass it is granted
 *           a smaller red share (the world turns the rest of that flash toward gold)
 *   folded  a flash with no allowance left, or one that would wait more than a second, is
 *           granted at no strength and spends no onset (the world plays its glow, no flash)
 *
 * The iris closes on surges, exposure × 1/(1 + 0.6·energy), and reopens with approach(1.5, dt).
 *
 * Grants live in a small ring of preallocated slots: request() returns one of them, so copy what
 * you keep before the ring comes round (32 requests later).
 */
import {
    approach, clamp, clamp01, smooth,
} from './rainbow-terraces-core.js';

export const FLASH_LIMITS = Object.freeze({
    /** At most `onsets` flash onsets in any `window` seconds, globally. */
    onsets: 3,
    window: 1,
    /** An onset never follows the one before by less than this (seconds). */
    gap: 0.11,
    /** Envelope minimums (seconds): the rise, normally and under reduced motion, and the fall. */
    rise: 0.06,
    riseReduced: 0.6,
    decay: 0.15,
    decayReduced: 0.6,
    /** Routine flashes alive together move the frame-mean luminance by at most this. */
    routine: 0.1,
    /** A scripted set piece: one transition pair of at most this, rising over at least setRise. */
    set: 0.35,
    setRise: 0.08,
    /** The most of the frame a saturated red flash may cover. */
    red: 0.25,
    /** The iris: exposure × 1/(1 + irisGain · energy), reopening at irisRecover per second. */
    irisGain: 0.6,
    irisRecover: 1.5,
    /** How long a flash holds its peak when the request does not say (seconds). */
    hold: 0.4,
    /** The longest a flash may be queued before it is folded into no flash at all (seconds). */
    maxDelay: 1,
});

const SLOTS = 32;
/** A hair past the window, so even a closed 1 s window never holds a fourth onset. */
const WINDOW_EPS = 1e-3;

/**
 * A flash's envelope at a time, 0..1: rises over `ramp`, holds for `hold`, falls over `decay`.
 * @param {{at: number, ramp: number, hold: number, decay: number}} grant
 * @param {number} now
 */
export function flashEnvelope(grant, now) {
    const t = now - grant.at;
    if (!(t > 0)) return 0;
    if (t < grant.ramp) return smooth(0, grant.ramp, t);
    const fall = t - grant.ramp - grant.hold;
    if (fall <= 0) return 1;
    return 1 - smooth(0, grant.decay, fall);
}

const lifeEnd = (g) => g.at + g.ramp + g.hold + g.decay;

export class FlashGovernor {
    /**
     * @param {{reducedMotion?: boolean}} [options]
     */
    constructor({ reducedMotion = false } = {}) {
        this.reducedMotion = Boolean(reducedMotion);
        this.slots = Array.from({ length: SLOTS }, () => ({
            kind: 'routine', at: 0, strength: 0, area: 0, red: 0, ramp: 0, hold: 0, decay: 0, live: false,
        }));
        this.onsetTimes = new Float64Array(FLASH_LIMITS.onsets);
        this.reset();
    }

    /** Forgets every flash and opens the iris (a seek, a new world). */
    reset() {
        this.slots.forEach((s) => {
            s.live = false;
            s.strength = 0;
            s.area = 0;
            s.red = 0;
        });
        this.next = 0;
        this.onsetTimes.fill(-Infinity);
        this.irisValue = 1;
        this.irisTime = -Infinity;
    }

    setReducedMotion(on) {
        this.reducedMotion = Boolean(on);
    }

    /**
     * Asks for a flash.
     * @param {'routine'|'set'} kind a set piece (the hush, the glory's flare, the great pour) or not
     * @param {number} strength the relative brightening of the area it covers (negative: a dip)
     * @param {number} areaFraction the share of the frame it covers, 0..1
     * @param {number|boolean} red the share of it that is saturated red, 0..1 (true = all)
     * @param {number} now the world's clock (seconds)
     * @param {number} [hold] how long it holds its peak (seconds)
     * @returns {{kind: string, at: number, strength: number, area: number, red: number,
     *   ramp: number, hold: number, decay: number}} the grant (a reused slot)
     */
    request(kind, strength, areaFraction, red, now, hold = FLASH_LIMITS.hold) {
        const L = FLASH_LIMITS;
        const set = kind === 'set';
        const t = Number.isFinite(now) ? now : 0;
        const area = clamp01(Number(areaFraction) || 0);
        const wanted = Number(strength) || 0;
        const redShare = red === true ? 1 : clamp01(Number(red) || 0);

        // When: never sooner than the gap after the last onset, nor while the last three are
        // all still inside one window.
        const times = this.onsetTimes;
        const queued = Math.max(t, times[times.length - 1] + L.gap, times[0] + L.window + WINDOW_EPS);

        const g = this.slots[this.next];
        this.next = (this.next + 1) % SLOTS;
        g.live = false; // the slot is not counted against itself below
        g.kind = set ? 'set' : 'routine';
        g.at = queued;
        g.area = area;
        const riseFloor = this.reducedMotion ? L.riseReduced : L.rise;
        g.ramp = set ? Math.max(riseFloor, L.setRise) : riseFloor;
        g.decay = this.reducedMotion ? L.decayReduced : L.decay;
        g.hold = Math.max(0, Number.isFinite(hold) ? hold : L.hold);

        // How strong: a set piece alone under its own allowance; a routine flash under what the
        // routine flashes already alive during its life have left.
        const allowed = set ? L.set : Math.max(0, L.routine - this.overlap(g, 'routine'));
        const magnitude = area > 0 ? Math.min(Math.abs(wanted), allowed / area) : 0;
        g.strength = Math.sign(wanted) * magnitude;

        // A flash with nothing left to give, or one that would have to wait too long to still
        // belong to its event, is folded: granted now at no strength, spending no onset.
        if (Math.abs(g.strength) * area < 1e-6 || queued - t > L.maxDelay) {
            g.at = t;
            g.strength = 0;
            g.red = 0;
            return g;
        }
        for (let i = 0; i < times.length - 1; i++) times[i] = times[i + 1];
        times[times.length - 1] = queued;

        // How red: the red share that keeps saturated red within its area.
        const redLeft = Math.max(0, L.red - this.overlap(g, 'red'));
        g.red = g.strength > 0 ? Math.min(redShare, redLeft / area) : 0;
        g.live = true;
        return g;
    }

    /**
     * The sum, over every live grant whose life overlaps g's, of its peak (|strength|·area for
     * 'routine', red·area for 'red'): what is already spent while g would be alive.
     */
    overlap(g, what) {
        const start = g.at;
        const end = lifeEnd(g);
        let sum = 0;
        for (let i = 0; i < SLOTS; i++) {
            const s = this.slots[i];
            if (!s.live || s === g || s.at >= end || lifeEnd(s) <= start) continue;
            if (what === 'red') sum += s.red * s.area;
            else if (s.kind === 'routine') sum += Math.abs(s.strength) * s.area;
        }
        return sum;
    }

    /** The light the live flashes add at a time (brightenings only), as frame-mean energy. */
    energy(now, kind = null) {
        let sum = 0;
        for (let i = 0; i < SLOTS; i++) {
            const s = this.slots[i];
            if (!s.live || s.strength <= 0 || (kind && s.kind !== kind)) continue;
            sum += flashEnvelope(s, now) * s.strength * s.area;
        }
        return sum;
    }

    /**
     * The iris at a time (an exposure multiplier, ≤ 1): it closes at once on the light the
     * flashes add and reopens slowly. Call it once a frame with the world's clock.
     * @param {number} now
     */
    iris(now) {
        const t = Number.isFinite(now) ? now : 0;
        const target = 1 / (1 + FLASH_LIMITS.irisGain * this.energy(t));
        const dt = t - this.irisTime;
        if (!(dt >= 0)) this.irisValue = target; // time ran back (a seek): start afresh
        else if (target < this.irisValue) this.irisValue = target; // closes at once
        else this.irisValue += (target - this.irisValue) * approach(FLASH_LIMITS.irisRecover, dt);
        this.irisTime = t;
        this.irisValue = clamp(this.irisValue, 0, 1);
        return this.irisValue;
    }

    /**
     * The estimated move of the frame-mean luminance the routine flashes make at a time, after
     * the iris (the last value iris() gave).
     */
    swing(now) {
        return this.energy(now, 'routine') * this.irisValue;
    }

    /** The saturated red area the live flashes cover at a time (share of the frame). */
    redArea(now) {
        let sum = 0;
        for (let i = 0; i < SLOTS; i++) {
            const s = this.slots[i];
            if (s.live && flashEnvelope(s, now) > 0) sum += s.red * s.area;
        }
        return sum;
    }
}
