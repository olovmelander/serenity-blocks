/**
 * Pyrestorm — the ridge shakes (three-free).
 *
 * The eye stands on a tephra ridge fifteen kilometres from the eruption, under its storm, and what
 * play does to the mountain reaches the ridge as small shakes of the view. Each has its cause in
 * the scene and its own feel:
 *
 *   hard drop    a thud in the ground: the view sinks a hair with the slam and springs back, with a
 *                short tremble; the further the piece fell, the harder. (A soft lock is a burst
 *                fifteen kilometres off: the ridge does not feel it.)
 *   lightning    thunder: each cloud-to-ground stroke cracks a beat after its flash, sound crossing
 *                the plain in time-lapse as the bombs fly under a time-lapsed gravity (SOUND), a
 *                short tremble and a little roll of the ground. A stroke on the near plain (a clear
 *                low on the board) is closer and louder than one high on the cone; the great
 *                discharge from the anvil is the loudest of all.
 *   four lines   the Vulcanian blast: the ground jolts at once; the blast's air wave reaches the
 *                ridge a third of a second later and knocks the view, then rolls on.
 *   T-spin       the vortex ring's soft whump: a little roll.
 *   perfect      the sheet lightning's long thunder: the ground swells into a slow roll under the
 *                crown's cracks.
 *   level up     the mountain groans as fresh lava surges down every channel: a slow, low sway
 *                (and again, softer, each time a fever pours fresh lava).
 *
 * Small on purpose: the biggest hit, a blast with its bolts, moves the frame about 3-4 px at
 * 1080p, a thunderclap 1-2 px, a hard drop 1-1.5 px; the whole never passes CAP. The view only
 * turns (and rolls a little): at fifteen kilometres a shaken eye that moved would move nothing.
 *
 * ── How it is built ──────────────────────────────────────────────────────────────────
 * Three bands of motion, each an accumulating envelope (shared/swell.js) times a smooth noise on
 * the clock: the tremble (fast, ~9 Hz: a crack, a thud), the roll (~3.4 Hz: thunder rolling, a
 * blast's after-shake) and the groan (~1.7 Hz, slow to swell: the lava's surge). Every hit ADDS to
 * what is still shaking and never restarts it, and the noise runs on the clock, not from each hit,
 * so overlapping hits never jump. Kicks are the directed part: one damped bounce each (the slam
 * sinking the view, the air wave knocking it), the same shape every time, so a thud always reads as
 * a thud whatever the noise is doing.
 *
 * Pure function of the clock and the hits (no per-frame state): a seeked or fixed-time capture
 * lands on the same pose every run, at any frame rate. Units are fractions of the viewport's height
 * at the subject, as in shared/camera-breath.js, so it looks the same size at every aspect and lens;
 * the roll is in radians (a thousandth of a radian moves a 16:9 frame's corners about a pixel at
 * 1080p). Reduced motion: disabled, it records nothing and reads zero.
 */
import { Swell } from '../shared/swell.js';

const TAU = Math.PI * 2;

export const SHAKE = Object.freeze({
    /** Every amount here is in these: a thousandth of the viewport's height (about 1 px at 1080p). */
    UNIT: 0.001,
    /**
     * The bands: noise frequency (Hz), rise and fall of a hit (s), and the soft ceiling (units).
     * Axis weights: how much of a band turns the view across (x), up (y) and rolls it.
     */
    TREMBLE: Object.freeze({
        hz: 9, attack: 0.02, release: 0.14, knee: 2.5, ceiling: 4, x: 0.75, y: 1, roll: 0.45,
    }),
    ROLL: Object.freeze({
        hz: 3.4, attack: 0.12, release: 0.7, knee: 2, ceiling: 3.5, x: 1, y: 0.55, roll: 0.8,
    }),
    GROAN: Object.freeze({
        hz: 1.7, attack: 0.7, release: 1.6, knee: 1.5, ceiling: 2.5, x: 1, y: 0.45, roll: 0.7,
    }),
    /** A kick: one damped bounce, its ring frequency (Hz) and decay (s); this many in flight. */
    KICK: Object.freeze({ hz: 4.5, decay: 0.09, slots: 8 }),
    /** The whole shake never moves the frame further than this (units), on any axis. */
    CAP: 6,
    /** Sound across the plain, time-lapsed (m/s): a stroke 8 km out cracks 0.18 s after its flash. */
    SOUND: 45000,
    /** A stroke this far from the eye (m) is the faintest; one NEAR_SPAN closer, the loudest. */
    FAR: 15000,
    NEAR_SPAN: 8000,
});

/**
 * What each cause is worth (units at its peak, before the noise's luck and the unrest's gain).
 * Tuned at 1080p against the board: felt, never in the way.
 */
export const RIDGE = Object.freeze({
    /** A hard drop: kick and tremble, from a one-row drop to a full-height slam. */
    drop: Object.freeze({ kick: [0.5, 1.5], tremble: [0.4, 1.1] }),
    /** A thunderclap at loudness 1 (a ground stroke, power 1, about 11 km out). */
    thunder: Object.freeze({ tremble: 1.2, roll: 0.5 }),
    /** The discharge from the anvil: this much louder, its roll this much longer. */
    discharge: Object.freeze({ loud: 1.5, roll: 2 }),
    /** The blast: the ground's jolt at once, then the air wave's kick, tremble and roll. */
    blast: Object.freeze({
        jolt: 1, kick: 1.6, tremble: 1.6, roll: 2,
    }),
    /** A T-spin's vortex ring: the roll it starts (one that cleared no line, the smaller). */
    ring: Object.freeze({ roll: 0.7, small: 0.4 }),
    /** A perfect clear's sheet lightning: a groan and a roll under the crown's own cracks. */
    sheet: Object.freeze({ groan: 1.6, roll: 1.2 }),
    /** A level-up's surge of fresh lava: the groan. */
    surge: Object.freeze({ groan: 1.4 }),
    /** The unrest: at full fever every hit is this much stronger. */
    fever: 0.25,
});

/** The noise's typical peak over a short shake is ~0.31: scaled so one unit reads as one unit. */
const NOISE_GAIN = 3.2;

/** An integer hash to [-1, 1). */
function hash1(i, seed) {
    let h = Math.imul(i ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
}

/** One octave of 1D gradient noise (zero at every lattice point, smooth through it). */
function gradient(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * f * (f * (f * 6 - 15) + 10);
    const a = hash1(i, seed) * f;
    const b = hash1(i + 1, seed) * (f - 1);
    return a + (b - a) * u;
}

/**
 * The shake's noise: two octaves of gradient noise at `x` lattice steps, scaled to read as one unit.
 * Exported for the tests.
 */
export function shakeNoise(x, seed) {
    return (gradient(x, seed) + 0.5 * gradient(x * 2.07 + 17.3, seed + 101)) * NOISE_GAIN;
}

const clamp01 = (v) => (v > 0 ? Math.min(1, v) : 0); // NaN reads as 0
/** Soft cap: linear for small values, never past `cap`. */
const soft = (v, cap) => cap * Math.tanh(v / cap);

/** How loud a thunderclap `distance` metres from the eye is (0.55 far … 1.45 near), at power 1. */
export function thunderLoudness(distance) {
    const d = Number.isFinite(distance) ? distance : SHAKE.FAR;
    return 0.55 + 0.9 * clamp01((SHAKE.FAR - d) / SHAKE.NEAR_SPAN);
}

const BANDS = [
    { key: 'tremble', spec: SHAKE.TREMBLE, seeds: [11, 23, 37] },
    { key: 'roll', spec: SHAKE.ROLL, seeds: [41, 53, 67] },
    { key: 'groan', spec: SHAKE.GROAN, seeds: [71, 83, 97] },
];

export class RidgeShake {
    constructor() {
        this.tremble = this.band(SHAKE.TREMBLE);
        this.roll = this.band(SHAKE.ROLL);
        this.groan = this.band(SHAKE.GROAN);
        const { hz, decay, slots } = SHAKE.KICK;
        this.omega = TAU * hz;
        this.decay = decay;
        // Normalised so one kick of 1 peaks at 1 (the bounce's first swing).
        const peakAt = Math.atan(this.omega * decay) / this.omega;
        this.kickGain = 1 / (Math.exp(-peakAt / decay) * Math.sin(this.omega * peakAt));
        this.kickSpan = decay * 7;
        this.kicks = Array.from({ length: slots }, () => ({
            at: -Infinity, amount: 0, x: 0, y: 0, roll: 0,
        }));
        /** Off under reduced motion: it records nothing and reads zero. */
        this.enabled = true;
        /** The unrest's lift on every new hit (1 calm … 1 + RIDGE.fever at full fever). */
        this.gain = 1;
    }

    band(spec) {
        return new Swell({
            attack: spec.attack, release: spec.release, ceiling: spec.ceiling, knee: spec.knee,
        });
    }

    setEnabled(value) {
        const on = value !== false;
        if (!on && this.enabled) this.reset();
        this.enabled = on;
    }

    /** The fever (0..1) of the unrest: the hotter play runs, the harder every new hit. */
    setFever(fever) {
        this.gain = 1 + RIDGE.fever * clamp01(fever);
    }

    hit(swell, amount, at) {
        if (!this.enabled || !(amount > 0) || !Number.isFinite(at)) return;
        swell.hit(amount * this.gain, at);
    }

    /** A directed bounce at `at`: `amount` units at its first swing, along (x, y, roll). */
    kick(amount, at, x = 0, y = 1, roll = 0) {
        if (!this.enabled || !(amount > 0) || !Number.isFinite(at)) return;
        // The slot whose bounce is over (else the oldest, nearly settled by then).
        let slot = this.kicks[0];
        for (const k of this.kicks) {
            if (k.at < slot.at) slot = k;
        }
        slot.at = at;
        slot.amount = amount * this.gain;
        slot.x = x;
        slot.y = y;
        slot.roll = roll;
    }

    // ── The causes ──────────────────────────────────────────────────────────────────

    /** A hard drop: `drop` 0 (a row) … 1 (the board's height). The world sinks with the slam. */
    hardDrop(drop, at) {
        const d = clamp01(drop);
        const { kick, tremble } = RIDGE.drop;
        this.kick(kick[0] + (kick[1] - kick[0]) * d, at, 0, 1, 0.15);
        this.hit(this.tremble, tremble[0] + (tremble[1] - tremble[0]) * d, at);
    }

    /**
     * Thunder from a stroke that reaches the ground at `at`, `distance` metres from the eye: it
     * cracks once its sound has crossed the plain. `share` scales it (the fever's own strokes).
     */
    thunder(distance, power, at, { discharge = false, share = 1 } = {}) {
        const d = Number.isFinite(distance) ? Math.max(0, distance) : SHAKE.FAR;
        const loud = thunderLoudness(d) * Math.max(0, power) * share * (discharge ? RIDGE.discharge.loud : 1);
        const heard = at + d / SHAKE.SOUND;
        this.hit(this.tremble, RIDGE.thunder.tremble * loud, heard);
        this.hit(this.roll, RIDGE.thunder.roll * loud * (discharge ? RIDGE.discharge.roll : 1), heard);
    }

    /**
     * The Vulcanian blast at `at`, `distance` metres away: the ground jolts at once; the air wave
     * arrives with the sound and knocks the view (up, a touch of roll), then rolls on.
     */
    blast(power, distance, at) {
        const p = Math.max(0, power);
        const b = RIDGE.blast;
        this.hit(this.tremble, b.jolt * p, at);
        const wave = at + Math.max(0, distance) / SHAKE.SOUND;
        this.kick(b.kick * p, wave, 0.25, 1, 0.35);
        this.hit(this.tremble, b.tremble * p, wave);
        this.hit(this.roll, b.roll * p, wave);
    }

    /** A T-spin's vortex ring (`small`: it cleared no line). */
    ring(small, at) {
        this.hit(this.roll, small ? RIDGE.ring.small : RIDGE.ring.roll, at);
    }

    /** A perfect clear's sheet lightning: the long thunder under the crown's cracks. */
    sheet(at) {
        this.hit(this.groan, RIDGE.sheet.groan, at);
        this.hit(this.roll, RIDGE.sheet.roll, at);
    }

    /** Fresh lava surging down the channels (`share` 1 a level-up, less the fever's own pours). */
    surge(at, share = 1) {
        this.hit(this.groan, RIDGE.surge.groan * share, at);
    }

    // ── Reading ─────────────────────────────────────────────────────────────────────

    /**
     * The shake at `time`: `x` turns the view right and `y` up (fractions of the viewport's
     * height), `roll` in radians. All exactly 0 at rest.
     */
    sample(time, out = { x: 0, y: 0, roll: 0 }) {
        let x = 0;
        let y = 0;
        let roll = 0;
        if (this.enabled && Number.isFinite(time)) {
            for (const { key, spec, seeds } of BANDS) {
                const a = this[key].valueAt(time);
                if (!(a > 0)) continue;
                const f = spec.hz * time;
                x += a * spec.x * shakeNoise(f, seeds[0]);
                y += a * spec.y * shakeNoise(f, seeds[1]);
                roll += a * spec.roll * shakeNoise(f, seeds[2]);
            }
            for (const k of this.kicks) {
                const tau = time - k.at;
                if (!(tau > 0) || tau >= this.kickSpan) continue;
                const v = k.amount * this.kickGain * Math.exp(-tau / this.decay) * Math.sin(this.omega * tau);
                x += v * k.x;
                y += v * k.y;
                roll += v * k.roll;
            }
        }
        const { UNIT, CAP } = SHAKE;
        out.x = x === 0 ? 0 : soft(x, CAP) * UNIT;
        out.y = y === 0 ? 0 : soft(y, CAP) * UNIT;
        out.roll = roll === 0 ? 0 : soft(roll, CAP) * UNIT;
        return out;
    }

    reset() {
        this.tremble.reset();
        this.roll.reset();
        this.groan.reset();
        for (const k of this.kicks) {
            k.at = -Infinity;
            k.amount = 0;
        }
    }
}
