/**
 * Sunbraid — the braid (three-free): where the three suns stand, as a pure function of the clock
 * and of what gameplay has done to them.
 *
 * The suns wheel round one another (the phase) on a circle of a given size (the spread). The
 * clock turns the phase at a calm rate; gameplay adds to it:
 *  - a lock ticks it a notch (a hard drop further), so play winds the sundial;
 *  - a T-spin twists it a third of a turn, so the suns change places and every fan's colours turn;
 *  - a level-up winds it on a sixth of a turn over a few seconds (the era steps on, while the
 *    clock keeps turning it too);
 *  - a chain turns it faster and opens the spread (the fans fan out wider), easing back when it
 *    breaks;
 *  - a clear draws the suns together for a breath (the fans narrow toward one dark shadow) and
 *    lets them go;
 *  - four lines bring them into one white sun (the colour leaves the world: every shadow is one
 *    black shadow), hold, and part them wide (the colour floods back), then settle;
 *  - game over sets them below the rim, a new session brings them back up.
 *
 * Every nudge is a closed-form tween from the moment it was given, and the phase integrates only
 * the rate (which changes): `seek(t)` plus a fixed-step replay reproduces any frame, and nothing
 * here allocates per frame.
 */
import {
    BRAID, BRAID_RATE, DEG, TAU, clamp, smooth,
} from './sunbraid-core.js';

/** Timings and sizes of the braid's answers (seconds, radians, spread multipliers). */
export const BRAID_EVENTS = Object.freeze({
    tick: Object.freeze({ step: 2.6 * DEG, hardStep: 5.5 * DEG, ease: 0.7 }),
    twist: Object.freeze({ step: TAU / 3, ease: 1.5, gap: 0.22 }),
    level: Object.freeze({ step: BRAID.levelStep, ease: BRAID.levelEase }),
    /** A chain: the rate gains `rate` per step (up to `cap` steps), the spread `open` per step. */
    chain: Object.freeze({
        rate: 0.55, open: 0.13, cap: 8, ease: 1.6,
    }),
    /** A clear's breath: depth by lines (1-3), drawn in over `in`, let go over `out`. */
    breath: Object.freeze({ depth: Object.freeze([0, 0.3, 0.45, 0.6]), in: 0.28, out: 1.5 }),
    /** Four lines: close (`close` s), hold one white sun (`hold` s), part wide (`part` s, to `wide`), settle (`settle` s). */
    conjunction: Object.freeze({
        close: 0.75, hold: 0.95, part: 0.55, wide: 1.85, settle: 3.2,
    }),
    /** Game over sets the cluster this far below its height over `set` s; a new run raises it in `rise` s. */
    dusk: Object.freeze({ drop: 16 * DEG, set: 6, rise: 4.5 }),
    /** A perfect clear: the suns climb `lift` (radians) in `rise` s, hold, and sink back in `sink` s. */
    noon: Object.freeze({
        lift: 24 * DEG, rise: 2.2, hold: 3.2, sink: 3.6,
    }),
    /** The ribbons braided between the suns: a chain's share per step (up to 1) and a back-to-back's. */
    ribbons: Object.freeze({ perChain: 0.18, perB2B: 0.3, ease: 1.2 }),
});

/** Most tweens of the phase in flight (older ones are folded into the base when they end). */
const MAX_TWEENS = 24;
/** Most breaths in flight. */
const MAX_BREATHS = 6;

const ease = (x) => {
    const t = clamp(x, 0, 1);
    return t * t * (3 - 2 * t);
};

/** The conjunction's spread multiplier `age` seconds after four lines (1 outside it). */
export function conjunctionSpread(age) {
    const c = BRAID_EVENTS.conjunction;
    if (!(age >= 0)) return 1;
    const a1 = c.close;
    const a2 = a1 + c.hold;
    const a3 = a2 + c.part;
    const a4 = a3 + c.settle;
    if (age < a1) return 1 - ease(age / a1);
    if (age < a2) return 0;
    if (age < a3) return c.wide * ease((age - a2) / c.part);
    if (age < a4) return c.wide + (1 - c.wide) * ease((age - a3) / c.settle);
    return 1;
}

/** How white the light is (0..1) `age` seconds after four lines: the one white sun. */
export function conjunctionWhite(age) {
    const c = BRAID_EVENTS.conjunction;
    if (!(age >= 0)) return 0;
    const a1 = c.close;
    const a2 = a1 + c.hold;
    if (age < a1) return smooth(a1 * 0.4, a1, age);
    if (age < a2) return 1;
    return 1 - smooth(a2, a2 + c.part * 0.8, age);
}

export class Braid {
    constructor() {
        this.tweens = Array.from({ length: MAX_TWEENS }, () => ({
            at: 0, dur: 1, amount: 0, live: false,
        }));
        this.breaths = Array.from({ length: MAX_BREATHS }, () => ({ at: 0, depth: 0, live: false }));
        this.reset(0);
    }

    /** Back to the calm braid at clock `time` (captures, a new sitting). */
    reset(time, phase0 = 0) {
        this.time = time;
        this.phase = phase0 + BRAID_RATE * time;
        this.base = 0;
        for (const tw of this.tweens) tw.live = false;
        for (const br of this.breaths) br.live = false;
        this.combo = 0;
        this.chainRate = 0;
        this.chainOpen = 0;
        this.conjunctionAt = -1e9;
        this.duskFrom = 0;
        this.duskTo = 0;
        this.duskAt = -1e9;
        this.twistQueue = 0;
        this.lastTwistAt = -1e9;
        this.noonAt = -1e9;
        this.b2b = 0;
        this.ribbon = 0;
    }

    /** Add `amount` to the phase, eased over `dur` seconds from clock `at`. */
    nudge(amount, dur, at = this.time) {
        let slot = this.tweens.find((tw) => !tw.live);
        if (!slot) {
            // Fold the oldest into the base, so the newest always has a slot.
            slot = this.tweens.reduce((a, b) => (a.at <= b.at ? a : b));
            this.base += slot.amount;
        }
        slot.at = at;
        slot.dur = Math.max(1e-3, dur);
        slot.amount = amount;
        slot.live = true;
    }

    tick(hard = false, at = this.time) {
        const e = BRAID_EVENTS.tick;
        this.nudge(hard ? e.hardStep : e.step, e.ease, at);
    }

    /** A T-spin: a third of a turn per spin-turn (doubles and triples queue a little apart). */
    twist(turns = 1, at = this.time) {
        const e = BRAID_EVENTS.twist;
        const n = Math.max(1, Math.min(3, Math.round(turns)));
        for (let i = 0; i < n; i++) this.nudge(e.step, e.ease, at + i * e.gap);
        this.lastTwistAt = at;
    }

    levelUp(steps = 1, at = this.time) {
        const e = BRAID_EVENTS.level;
        if (steps > 0) this.nudge(e.step * steps, e.ease, at);
    }

    /** A clear of `lines` (1..3; four lines are a conjunction instead). */
    breathe(lines, at = this.time) {
        const depth = BRAID_EVENTS.breath.depth[clamp(Math.round(lines), 1, 3)];
        let slot = this.breaths.find((b) => !b.live);
        if (!slot) slot = this.breaths.reduce((a, b) => (a.at <= b.at ? a : b));
        slot.at = at;
        slot.depth = depth;
        slot.live = true;
    }

    conjoin(at = this.time) {
        this.conjunctionAt = at;
    }

    /** A perfect clear: the suns climb toward noon and sink back. */
    noon(at = this.time) {
        this.noonAt = at;
    }

    setB2B(level) {
        this.b2b = Math.max(0, Math.round(Number(level) || 0));
    }

    /** How far the suns have climbed for a perfect clear (radians) at the current clock. */
    liftNow() {
        const e = BRAID_EVENTS.noon;
        const age = this.time - this.noonAt;
        if (!(age >= 0)) return 0;
        if (age < e.rise) return e.lift * ease(age / e.rise);
        if (age < e.rise + e.hold) return e.lift;
        return e.lift * (1 - ease((age - e.rise - e.hold) / e.sink));
    }

    setCombo(n) {
        this.combo = Math.max(0, Math.round(Number(n) || 0));
    }

    /** Game over (true) or a new session (false): the suns set or rise. */
    setDusk(down, at = this.time) {
        const now = this.duskLevel(at);
        this.duskFrom = now;
        this.duskTo = down ? 1 : 0;
        this.duskAt = at;
    }

    /** How far the suns have set (0 up .. 1 below the rim) at clock `t`. */
    duskLevel(t = this.time) {
        const e = BRAID_EVENTS.dusk;
        const dur = this.duskTo > this.duskFrom ? e.set : e.rise;
        return this.duskFrom + (this.duskTo - this.duskFrom) * ease((t - this.duskAt) / dur);
    }

    /**
     * Advance to clock `time` by `dt`: the calm rate plus the chain's, integrated; tweens that
     * have ended fold into the base. Returns this.
     */
    step(time, dt) {
        const e = BRAID_EVENTS.chain;
        const k = 1 - Math.exp(-Math.max(0, dt) / e.ease);
        const n = Math.min(e.cap, Math.max(0, this.combo - 1));
        this.chainRate += (n * e.rate - this.chainRate) * k;
        this.chainOpen += (n * e.open - this.chainOpen) * k;
        this.phase += BRAID_RATE * (1 + this.chainRate) * Math.max(0, dt);
        // The ribbons between the suns: a chain and a back-to-back run braid them into the sky.
        const r = BRAID_EVENTS.ribbons;
        const want = Math.min(1, n * r.perChain + this.b2b * r.perB2B);
        this.ribbon += (want - this.ribbon) * (1 - Math.exp(-Math.max(0, dt) / r.ease));
        // Keep the integrated phase small (the shaders' trig must not lose precision).
        if (this.phase > TAU * 1024) this.phase -= TAU * 1024;
        this.time = time;
        for (const tw of this.tweens) {
            if (tw.live && time >= tw.at + tw.dur) {
                this.base += tw.amount;
                tw.live = false;
            }
        }
        for (const br of this.breaths) {
            if (br.live && time >= br.at + BRAID_EVENTS.breath.in + BRAID_EVENTS.breath.out) br.live = false;
        }
        return this;
    }

    /** The phase at the current clock (calm turn + every nudge so far). */
    phaseNow() {
        let p = this.phase + this.base;
        for (const tw of this.tweens) if (tw.live) p += tw.amount * ease((this.time - tw.at) / tw.dur);
        return p;
    }

    /** The spread multiplier at the current clock (chain, breaths, conjunction). */
    spreadNow() {
        let s = 1 + this.chainOpen;
        const b = BRAID_EVENTS.breath;
        for (const br of this.breaths) {
            if (!br.live) continue;
            const age = this.time - br.at;
            const pull = age < b.in ? ease(age / b.in) : 1 - ease((age - b.in) / b.out);
            s *= 1 - br.depth * pull;
        }
        return Math.max(0, s * conjunctionSpread(this.time - this.conjunctionAt));
    }

    /** How white the light is now (the conjunction's one white sun). */
    whiteNow() {
        return conjunctionWhite(this.time - this.conjunctionAt);
    }

    exportState() {
        return {
            phase: this.phase,
            base: this.base,
            tweens: this.tweens.map((tw) => ({ ...tw })),
            combo: this.combo,
            chainRate: this.chainRate,
            chainOpen: this.chainOpen,
            duskFrom: this.duskFrom,
            duskTo: this.duskTo,
            duskAt: this.duskAt,
            b2b: this.b2b,
            ribbon: this.ribbon,
        };
    }

    importState(state) {
        if (!state) return;
        this.phase = state.phase ?? this.phase;
        this.base = state.base ?? 0;
        (state.tweens || []).forEach((tw, i) => {
            if (this.tweens[i]) Object.assign(this.tweens[i], tw);
        });
        this.combo = state.combo ?? 0;
        this.chainRate = state.chainRate ?? 0;
        this.chainOpen = state.chainOpen ?? 0;
        this.duskFrom = state.duskFrom ?? 0;
        this.duskTo = state.duskTo ?? 0;
        this.duskAt = state.duskAt ?? -1e9;
        this.b2b = state.b2b ?? 0;
        this.ribbon = state.ribbon ?? 0;
    }
}
