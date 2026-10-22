/**
 * Sunbraid — the braid (three-free): where the three suns stand, as a pure function of the clock
 * and of what gameplay has done to them.
 *
 * The suns wheel round one another (the phase) on a circle of a given size (the spread). The
 * clock turns the phase at a calm rate; gameplay adds to it:
 *  - a lock ticks it a notch (a hard drop further), so play winds the sundial;
 *  - a T-spin twists it a third of a turn, so the suns change places and every fan's colours turn
 *    (a T-spin that clears nothing, a twelfth);
 *  - a level-up winds it on a sixth of a turn over a few seconds (the era steps on, while the
 *    clock keeps turning it too);
 *  - a chain turns it faster and draws the suns closer (the fans narrow and burn), easing back when
 *    it breaks; the heat of play (the world's `pull`) draws them in further: the triple star
 *    spirals in, wheeling faster the closer it comes, toward the one white sun;
 *  - a clear draws the suns together for a breath and lets them go; each cascade wave breathes
 *    deeper than the last and winds the sundial further;
 *  - four lines bring them into one white sun (the colour leaves the world: every shadow is one
 *    black shadow), hold, and part them wide (the colour floods back, and with it every bit of
 *    the pull: the release), then settle. A second four lines while they are joined holds them
 *    longer and parts them wider; one while they part draws them back from where they stand;
 *  - a perfect clear crowns it: the joined sun holds a beat longer and the cluster climbs a little;
 *  - game over sets them below the rim, a new session brings them back up.
 *
 * Every nudge is a closed-form tween from the moment it was given, and the phase integrates only
 * the rate (which changes): `seek(t)` plus a fixed-step replay reproduces any frame, and nothing
 * here allocates per frame. No answer restarts another: every one continues from what is shown.
 */
import { softCeiling } from '../shared/swell.js';
import {
    BRAID, BRAID_RATE, DEG, TAU, clamp, smooth,
} from './sunbraid-core.js';

/** Timings and sizes of the braid's answers (seconds, radians, spread multipliers). */
export const BRAID_EVENTS = Object.freeze({
    tick: Object.freeze({ step: 2.6 * DEG, hardStep: 5.5 * DEG, ease: 0.7 }),
    twist: Object.freeze({ step: TAU / 3, ease: 1.5, gap: 0.22 }),
    /** A T-spin that cleared nothing: something small, a twelfth of a turn. */
    spin: Object.freeze({ step: TAU / 12, ease: 0.9 }),
    level: Object.freeze({ step: BRAID.levelStep, ease: BRAID.levelEase }),
    /**
     * A chain: per step the rate gains `rate` and the suns draw `draw` closer (a share of the
     * spread); the steps count in full up to `knee`, then ease toward `cap` (never past it).
     */
    chain: Object.freeze({
        rate: 0.55, draw: 0.02, knee: 7, cap: 11, ease: 1.6,
    }),
    /**
     * How close play may draw the suns before four lines join them: the chain's draw and the heat's
     * pull add, linear up to `knee`, easing toward `most` (a share of the spread, never past it), so
     * the one white sun stays the peak.
     */
    draw: Object.freeze({ knee: 0.2, most: 0.32 }),
    /**
     * A clear's breath: depth by lines (1-3), drawn in over `in`, let go over `out`; each cascade
     * wave past the first breathes `wave` deeper (a share of the depth), never past `deepest`.
     * Breaths in a row compound, linear up to `knee`, easing toward `most`; once play has drawn
     * the suns in they breathe shallower (by `drawn` at the full draw): each clear pulses on the
     * inspiral instead of joining the suns before four lines do.
     */
    breath: Object.freeze({
        depth: Object.freeze([0, 0.3, 0.45, 0.6]),
        in: 0.28,
        out: 1.5,
        wave: 0.14,
        deepest: 0.82,
        knee: 0.6,
        most: 0.72,
        drawn: 0.7,
    }),
    /** Each cascade wave past the first winds the sundial on `step` more than the one before it. */
    wave: Object.freeze({ step: 3 * DEG, ease: 0.6 }),
    /**
     * Four lines: close (`close` s), hold one white sun (`hold` s), part wide (`part` s, to `wide`),
     * settle (`settle` s). Each further four lines while it is live parts it `wideStep` wider (up
     * to `widest`); a perfect clear holds the white sun `crown` s longer.
     */
    conjunction: Object.freeze({
        close: 0.75, hold: 0.95, part: 0.55, wide: 1.85, settle: 3.2, wideStep: 0.22, widest: 2.3, crown: 0.55,
    }),
    /** Game over sets the cluster this far below its height over `set` s; a new run raises it in `rise` s. */
    dusk: Object.freeze({ drop: 16 * DEG, set: 6, rise: 4.5 }),
    /**
     * A perfect clear: the suns climb `lift` (radians) in `rise` s, hold, and sink back in `sink` s.
     * (A little: the crowned sun stays in the frame, over the towers.)
     */
    noon: Object.freeze({
        lift: 3.5 * DEG, rise: 2.2, hold: 3.2, sink: 3.6,
    }),
    /**
     * The ribbons braided between the suns: a chain's share per step and a back-to-back's, linear
     * up to `knee`, easing toward `most`.
     */
    ribbons: Object.freeze({
        perChain: 0.18, perB2B: 0.3, ease: 1.2, knee: 1, most: 1.6,
    }),
});

/** Most tweens of the phase in flight (when full, the most finished one makes room). */
const MAX_TWEENS = 24;
/** Most breaths in flight (when full, the one with the least left to give makes room). */
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

/** A conjunction at rest (none live). */
const idleConjunction = () => ({
    closeAt: -1e9, closeFrom: 1, whiteFrom: 0, holdUntil: -1e9, wide: BRAID_EVENTS.conjunction.wide, quads: 0,
});

export class Braid {
    constructor() {
        this.tweens = Array.from({ length: MAX_TWEENS }, () => ({
            at: 0, dur: 1, amount: 0, live: false,
        }));
        this.breaths = Array.from({ length: MAX_BREATHS }, () => ({ at: 0, depth: 0, live: false }));
        /**
         * The live conjunction: when the suns began to close and from what spread and whiteness,
         * how long they stay joined, how wide they part. A single four lines makes exactly the
         * curves of conjunctionSpread / conjunctionWhite.
         */
        this.conj = idleConjunction();
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
        this.chainDraw = 0;
        /** How close the heat of play draws the suns (a share of the spread; the world sets it each frame). */
        this.pull = 0;
        Object.assign(this.conj, idleConjunction());
        this.duskFrom = 0;
        this.duskTo = 0;
        this.duskAt = -1e9;
        this.twistQueue = 0;
        this.lastTwistAt = -1e9;
        this.noonAt = -1e9;
        this.noonFrom = 0;
        this.b2b = 0;
        this.ribbon = 0;
    }

    /** Add `amount` to the phase, eased over `dur` seconds from clock `at`. */
    nudge(amount, dur, at = this.time) {
        let slot = this.tweens.find((tw) => !tw.live);
        let carried = 0;
        if (!slot) {
            // Every slot is busy: the most finished tween makes room. What it shows joins the base
            // and what it still had to give rides on with the new one, so the phase never jumps.
            slot = this.tweens.reduce((a, b) => (
                (this.time - a.at) / a.dur >= (this.time - b.at) / b.dur ? a : b));
            const shown = slot.amount * ease((this.time - slot.at) / slot.dur);
            this.base += shown;
            carried = slot.amount - shown;
        }
        slot.at = at;
        slot.dur = Math.max(1e-3, dur);
        slot.amount = amount + carried;
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

    /** A T-spin that cleared nothing: a twelfth of a turn. */
    spin(at = this.time) {
        const e = BRAID_EVENTS.spin;
        this.nudge(e.step, e.ease, at);
    }

    /** Cascade wave `wave` (2, 3, …): the sundial winds on further each wave. */
    wave(wave, at = this.time) {
        const k = Math.min(12, Math.round(Number(wave) || 1)) - 1;
        if (k > 0) this.nudge(BRAID_EVENTS.wave.step * k, BRAID_EVENTS.wave.ease, at);
    }

    levelUp(steps = 1, at = this.time) {
        const e = BRAID_EVENTS.level;
        if (steps > 0) this.nudge(e.step * steps, e.ease, at);
    }

    /** What a breath still has to give at clock `t` (its full depth until it starts to let go). */
    breathLeft(br, t) {
        const b = BRAID_EVENTS.breath;
        const age = t - br.at;
        if (age < b.in) return br.depth;
        return br.depth * (1 - ease((age - b.in) / b.out));
    }

    /**
     * A clear of `lines` (1..3; four lines are a conjunction instead), on cascade wave `wave`: each
     * wave past the first breathes deeper.
     */
    breathe(lines, at = this.time, wave = 1) {
        const b = BRAID_EVENTS.breath;
        const deeper = 1 + b.wave * Math.max(0, Math.min(11, Math.round(Number(wave) || 1) - 1));
        const depth = Math.min(b.deepest, b.depth[clamp(Math.round(lines), 1, 3)] * deeper);
        let slot = this.breaths.find((br) => !br.live);
        if (!slot) {
            // The one with the least left to give makes room (a breath barely begun keeps its slot).
            slot = this.breaths.reduce((a, c) => (this.breathLeft(a, at) <= this.breathLeft(c, at) ? a : c));
        }
        slot.at = at;
        slot.depth = depth;
        slot.live = true;
    }

    /** The live conjunction's spread multiplier at clock `t` (1 outside it). */
    conjunctionSpreadAt(t) {
        const c = BRAID_EVENTS.conjunction;
        const j = this.conj;
        const age = t - j.closeAt;
        if (!(age >= 0)) return 1;
        if (age < c.close) return j.closeFrom * (1 - ease(age / c.close));
        if (t < j.holdUntil) return 0;
        const after = t - j.holdUntil;
        if (after < c.part) return j.wide * ease(after / c.part);
        if (after < c.part + c.settle) return j.wide + (1 - j.wide) * ease((after - c.part) / c.settle);
        return 1;
    }

    /** How white the live conjunction's light is at clock `t` (0 outside it). */
    conjunctionWhiteAt(t) {
        const c = BRAID_EVENTS.conjunction;
        const j = this.conj;
        const age = t - j.closeAt;
        if (!(age >= 0)) return 0;
        if (age < c.close) return j.whiteFrom + (1 - j.whiteFrom) * smooth(c.close * 0.4, c.close, age);
        if (t < j.holdUntil) return 1;
        return 1 - smooth(j.holdUntil, j.holdUntil + c.part * 0.8, t);
    }

    /**
     * How far the conjunction has let the pull go at clock `t` (0..1): none while the suns close
     * and hold, all of it as they part (the colour floods back as wide as it can), handed back over
     * the settle.
     */
    freedAt(t) {
        const c = BRAID_EVENTS.conjunction;
        const after = t - this.conj.holdUntil;
        if (!(after >= 0)) return 0;
        if (after < c.part) return ease(after / c.part);
        if (after < c.part + c.settle) return 1 - ease((after - c.part) / c.settle);
        return 0;
    }

    /** Whether a conjunction is under way at clock `t` (closing, joined, parting or settling). */
    conjunctionLive(t) {
        const c = BRAID_EVENTS.conjunction;
        return t >= this.conj.closeAt && t < this.conj.holdUntil + c.part + c.settle;
    }

    /**
     * Four lines. From rest: the suns close into one white sun, hold, part wide, settle. While they
     * close or are joined: they stay joined a full hold from now and will part wider. While they
     * part or settle: they close again from where they stand (never a jump back to the start).
     */
    conjoin(at = this.time) {
        const c = BRAID_EVENTS.conjunction;
        const j = this.conj;
        if (!this.conjunctionLive(at)) {
            Object.assign(j, idleConjunction());
            j.closeAt = at;
            j.holdUntil = at + c.close + c.hold;
            j.quads = 1;
            return;
        }
        j.quads += 1;
        const wide = Math.min(c.widest, c.wide + c.wideStep * (j.quads - 1));
        if (at < j.holdUntil) {
            j.holdUntil = Math.max(j.holdUntil, Math.max(at, j.closeAt + c.close) + c.hold);
            j.wide = wide;
            return;
        }
        const from = this.conjunctionSpreadAt(at);
        const white = this.conjunctionWhiteAt(at);
        j.closeFrom = from;
        j.whiteFrom = white;
        j.closeAt = at;
        j.holdUntil = at + c.close + c.hold;
        j.wide = wide;
    }

    /**
     * A perfect clear: the crown on what is playing. A white sun still joined holds a beat longer;
     * the cluster climbs toward noon (from wherever an earlier crown has it).
     */
    crown(at = this.time) {
        const c = BRAID_EVENTS.conjunction;
        const j = this.conj;
        if (at >= j.closeAt && at < j.holdUntil) j.holdUntil += c.crown;
        this.noon(at);
    }

    /** A perfect clear: the suns climb toward noon and sink back, from wherever they stand. */
    noon(at = this.time) {
        this.noonFrom = this.liftAt(at);
        this.noonAt = at;
    }

    setB2B(level) {
        this.b2b = Math.max(0, Math.round(Number(level) || 0));
    }

    /** How far the suns have climbed for a perfect clear (radians) at clock `t`. */
    liftAt(t) {
        const e = BRAID_EVENTS.noon;
        const age = t - this.noonAt;
        if (!(age >= 0)) return this.noonFrom;
        if (age < e.rise) return this.noonFrom + (e.lift - this.noonFrom) * ease(age / e.rise);
        if (age < e.rise + e.hold) return e.lift;
        return e.lift * (1 - ease((age - e.rise - e.hold) / e.sink));
    }

    /** How far the suns have climbed for a perfect clear (radians) at the current clock. */
    liftNow() {
        return this.liftAt(this.time);
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

    /** A chain's steps as they count: in full up to the knee, then easing toward the cap. */
    chainSteps() {
        const e = BRAID_EVENTS.chain;
        return softCeiling(Math.max(0, this.combo - 1), e.knee, e.cap);
    }

    /**
     * Advance to clock `time` by `dt`: the calm rate plus the chain's, integrated; tweens that
     * have ended fold into the base. Returns this.
     */
    step(time, dt) {
        const e = BRAID_EVENTS.chain;
        const k = 1 - Math.exp(-Math.max(0, dt) / e.ease);
        const n = this.chainSteps();
        this.chainRate += (n * e.rate - this.chainRate) * k;
        this.chainDraw += (n * e.draw - this.chainDraw) * k;
        this.phase += BRAID_RATE * (1 + this.chainRate) * Math.max(0, dt);
        // The ribbons between the suns: a chain and a back-to-back run braid them into the sky.
        const r = BRAID_EVENTS.ribbons;
        const want = softCeiling(n * r.perChain + this.b2b * r.perB2B, r.knee, r.most);
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

    /** How close the chain and the heat of play draw the suns now (a share of the spread). */
    drawNow() {
        const d = BRAID_EVENTS.draw;
        const draw = this.chainDraw + Math.max(0, this.pull || 0);
        return draw > 0 ? softCeiling(draw, d.knee, d.most) : 0;
    }

    /** The spread multiplier at the current clock (the draw, breaths, conjunction). */
    spreadNow() {
        const t = this.time;
        const draw = this.drawNow();
        let s = draw > 0 ? 1 - draw * (1 - this.freedAt(t)) : 1;
        const b = BRAID_EVENTS.breath;
        let open = 1;
        for (const br of this.breaths) {
            if (!br.live) continue;
            const age = t - br.at;
            const pull = age < b.in ? ease(age / b.in) : 1 - ease((age - b.in) / b.out);
            open *= 1 - br.depth * pull;
        }
        if (open < 1) {
            const deep = softCeiling(1 - open, b.knee, b.most);
            s *= 1 - deep * (draw > 0 ? 1 - (b.drawn * draw) / BRAID_EVENTS.draw.most : 1);
        }
        return Math.max(0, s * this.conjunctionSpreadAt(t));
    }

    /** How white the light is now (the conjunction's one white sun). */
    whiteNow() {
        return this.conjunctionWhiteAt(this.time);
    }

    exportState() {
        return {
            phase: this.phase,
            base: this.base,
            tweens: this.tweens.map((tw) => ({ ...tw })),
            breaths: this.breaths.map((br) => ({ ...br })),
            combo: this.combo,
            chainRate: this.chainRate,
            chainDraw: this.chainDraw,
            conj: { ...this.conj },
            noonAt: this.noonAt,
            noonFrom: this.noonFrom,
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
        (state.breaths || []).forEach((br, i) => {
            if (this.breaths[i]) Object.assign(this.breaths[i], br);
        });
        this.combo = state.combo ?? 0;
        this.chainRate = state.chainRate ?? 0;
        this.chainDraw = state.chainDraw ?? 0;
        Object.assign(this.conj, idleConjunction(), state.conj || {});
        this.noonAt = state.noonAt ?? -1e9;
        this.noonFrom = state.noonFrom ?? 0;
        this.duskFrom = state.duskFrom ?? 0;
        this.duskTo = state.duskTo ?? 0;
        this.duskAt = state.duskAt ?? -1e9;
        this.b2b = state.b2b ?? 0;
        this.ribbon = state.ribbon ?? 0;
    }
}
