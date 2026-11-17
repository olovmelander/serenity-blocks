// @ts-check
/**
 * Wolfhour — what the night does: its weather by the hour, and its answer to play.
 *
 * Plain numbers and no three.js: the theme and the playground each keep one director, tell it
 * what happened (`lock`, `clear`, `twist`, `backToBack`, `perfect`, `levelUp`, `over`, `begin`) and
 * read `sample(time, phase)` every frame for what the sky, the ranges and the air wear. Each
 * event has a mark of its own, and the bigger the play the more of the night answers:
 *
 *   lock           a ring of sparkle runs out over the snow from where the piece came down
 *   hard drop      the same, stronger and wider (the theme adds the gust off the summits)
 *   1 line         a band of moonlight sweeps across the ranges, left to right
 *   2 lines        two bands, the second coming back the other way
 *   3 lines        and a ribbon of northern lights low over the far range
 *   4 lines        the howl: the northern lights hang their curtains for as long as it sounds,
 *                  and the air glitters (the theme sets the pack howling and calls the white wolf)
 *   chain          every step past the second feeds the lights a little more
 *   twist          a breath of diamond dust (the theme raises the snow devil)
 *   back to back   the answer: a band of moonlight comes back from the right, the lights flicker
 *   perfect clear  the crown: the lights over the whole sky, the air full of diamond dust
 *   level up       an hour passes in a breath: the stars wheel and streak, the cloud is swept on
 *   fever          the lights and the glitter stay up while it lasts
 *   run over       the night settles: snow begins to fall, and stops when the next run begins
 *
 * Between events the night keeps its own weather, by the hour (wolfhour-hours.js): a faint ribbon
 * of northern lights and glitter at deep midnight, snow in the wolf's hour, a few flakes on the
 * wind in the alpenglow, gold dust under the hunter's moon; each breathes slowly, so no two minutes
 * are quite the same. Everything accumulates (shared/swell.js): fast play never restarts a light,
 * it lifts it.
 */
import { wheelAt } from '../shared/mood-clock.js';
import { Swell } from '../shared/swell.js';

/** The night's own weather by hour (wolfhour-hours.js WOLFHOUR_HOURS, in order). */
export const WOLFHOUR_WEATHER = Object.freeze([
    // silver moon: clear and still
    Object.freeze({
        aurora: 0, reach: 0, dust: 0.1, fall: 0, wind: 0.1,
    }),
    // deep midnight: a low ribbon of northern lights, the air glittering (silver against the
    // night's blue needs more light than the green did to show at all)
    Object.freeze({
        aurora: 0.7, reach: 0.12, dust: 0.3, fall: 0, wind: 0.05,
    }),
    // the wolf's hour: snow
    Object.freeze({
        aurora: 0, reach: 0, dust: 0, fall: 0.8, wind: 0.35,
    }),
    // alpenglow: a few flakes on the wind
    Object.freeze({
        aurora: 0, reach: 0, dust: 0.12, fall: 0.14, wind: 0.22,
    }),
    // hunter's moon: gold dust in the air
    Object.freeze({
        aurora: 0.1, reach: 0.04, dust: 0.45, fall: 0, wind: 0.1,
    }),
]);
const WEATHER_KEYS = Object.freeze(['aurora', 'reach', 'dust', 'fall', 'wind']);

/** A band of moonlight crossing the ranges: how long (seconds), from how far to how far, how wide. */
export const SWEEP = Object.freeze({ life: 2.7, span: 1500, width: 210 });
/** The sparkle ripple: how long it runs (seconds) and how far (world units). */
export const RIPPLE = Object.freeze({ life: 1.5, reach: 620 });
/** A level's wheel of the stars: how far the sky turns (radians), and how far the cloud is swept. */
export const WHEEL = Object.freeze({ turn: 0.12, rush: 520, length: 2.6 });
/**
 * A band of moonlight or a sparkle ripple still lit when a newer one needs its slot is not cut
 * off: it fades over this long (seconds) and the newer one begins as it goes.
 */
export const HANDOVER = Object.freeze({ sweep: 0.35, ripple: 0.18 });
/** How long the run's-end snow takes to set in, and to stop once the next run begins (seconds). */
const REST = Object.freeze({ settle: 5, clear: 3 });

const AT = { a: 0, b: 0, melt: 0 };
const smooth = (/** @type {number} */ t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};
/** The inverse of `smooth` on 0..1: how far along its ease a value lies. */
const inverseSmooth = (/** @type {number} */ value) => {
    const v = Math.min(1, Math.max(0, value));
    return 0.5 - Math.sin(Math.asin(1 - 2 * v) / 3);
};
/** How far a band or ripple cut at `cut` has faded out by `t` (1: not cut). */
const handedOver = (/** @type {number} */ t, /** @type {number} */ cut, /** @type {number} */ over) => (
    t > cut ? 1 - smooth((t - cut) / over) : 1);

/**
 * @typedef {{ at: number, dir: number, strength: number }} SweepBand
 *   a band of moonlight: when it sets off, which way, how bright
 * @typedef {{ at: number, x: number, y: number, strength: number }} SparkleRipple
 *   a ring of sparkle: when and where it starts, how bright
 */

/**
 * The night's own weather `phase` hours in at `time`: the hour's (melting into the next as the
 * colours do), breathing slowly. A pure function of both.
 * @param {number} phase
 * @param {number} time
 * @param {Record<string, number>} [out]
 */
export function wolfhourWeatherAt(phase, time, out = {}) {
    wheelAt(Number.isFinite(phase) ? phase : 0, WOLFHOUR_WEATHER.length, AT);
    const a = WOLFHOUR_WEATHER[AT.a];
    const b = WOLFHOUR_WEATHER[AT.b];
    for (const key of WEATHER_KEYS) {
        // eslint-disable-next-line no-param-reassign
        out[key] = a[key] + (b[key] - a[key]) * AT.melt;
    }
    const t = Number.isFinite(time) ? time : 0;
    // Each breathes on its own slow beat: the lights come and go, the snow thickens and thins.
    /* eslint-disable no-param-reassign */
    out.aurora *= 0.55 + 0.45 * Math.sin(t * 0.047 + 1.3);
    out.reach *= 0.7 + 0.3 * Math.sin(t * 0.031 + 0.4);
    out.dust *= 0.7 + 0.3 * Math.sin(t * 0.039 + 2.6);
    out.fall *= 0.72 + 0.28 * Math.sin(t * 0.027 + 4.1);
    out.wind *= 0.75 + 0.25 * Math.sin(t * 0.021 + 0.9) + 0.2 * Math.max(0, Math.sin(t * 0.13 + 2));
    /* eslint-enable no-param-reassign */
    return out;
}

export class WolfhourNightDirector {
    constructor() {
        this.aurora = new Swell({ attack: 1.1, release: 6, ceiling: 1.5 });
        this.reach = new Swell({ attack: 1.6, release: 8, ceiling: 1 });
        this.dust = new Swell({ attack: 0.5, release: 5.5, ceiling: 1.5 });
        this.wheel = new Swell({ attack: 0.9, release: 45, ceiling: 0.3 });
        /**
         * Two bands of moonlight at a time. A band still lit when a newer one needs its slot fades
         * out from `cut` (HANDOVER) and the newer one waits in `next` until it has gone.
         * @type {Array<SweepBand & { cut: number, next: SweepBand | null }>}
         */
        this.sweeps = [
            {
                at: -Infinity, dir: 1, strength: 0, cut: Infinity, next: null,
            },
            {
                at: -Infinity, dir: 1, strength: 0, cut: Infinity, next: null,
            },
        ];
        /**
         * The sparkle ripple (one at a time, handed over the same way).
         * @type {SparkleRipple & { cut: number, next: SparkleRipple | null }}
         */
        this.ripple = {
            at: -Infinity, x: 0, y: 0, strength: 0, cut: Infinity, next: null,
        };
        this.rush = { count: 0, at: -Infinity };
        this.heat = { level: 0, fever: 0 };
        this.rest = { over: false, at: -Infinity };
        /** The wheel's last reading, for how fast the sky is turning. */
        this.turned = { at: -Infinity, spin: 0 };
        this.weather = {
            aurora: 0, reach: 0, dust: 0, fall: 0, wind: 0,
        };
        /** What sample() fills (kept and returned: no allocation per frame). */
        this.night = {
            aurora: 0,
            reach: 0,
            dust: 0,
            fall: 0,
            wind: 0,
            /** Each [x, strength, width] in the ranges' own units. */
            sweeps: [[0, 0, SWEEP.width], [0, 0, SWEEP.width]],
            /** [x, y, radius, strength] in world units. */
            ripple: [0, 0, 0, 0],
            /** How much moonlight the bands add to the valley's air as they pass (0..1.5). */
            glow: 0,
            spin: 0,
            streak: 0,
            rush: 0,
        };
    }

    /**
     * A band of moonlight sets off at `time` from the left (`dir` 1) or the right (-1); `now` is
     * when it was asked for (`time` may be a moment ahead: a double's second band).
     */
    sweep(time, dir = 1, strength = 0.7, now = time) {
        if (!Number.isFinite(time)) return;
        const band = { at: time, dir: dir < 0 ? -1 : 1, strength: Math.max(0, Math.min(1.5, strength)) };
        const asked = Number.isFinite(now) ? Math.min(now, time) : time;
        // When each slot is free: its band over (or faded out), and none waiting in it.
        const freeAt = (/** @type {(typeof this.sweeps)[number]} */ slot) => (slot.next ? Infinity
            : Math.min(slot.at + SWEEP.life, slot.cut + HANDOVER.sweep));
        const [a, b] = this.sweeps;
        let slot = freeAt(a) <= freeAt(b) ? a : b;
        const free = freeAt(slot);
        if (free === Infinity) {
            // Both have a band waiting: the one waiting longest gives its place (it was never seen).
            slot = a.next.at >= b.next.at ? a : b;
            slot.next = { ...band, at: Math.max(band.at, slot.next.at) };
            return;
        }
        if (slot.at > asked || free <= asked) {
            // Not yet begun (never seen) or already gone: the slot is the new band's now.
            Object.assign(slot, band, { cut: Infinity, next: null });
            return;
        }
        // Still lit: if it is over before the new band begins, the new one waits for it; if not,
        // it fades out (as late as lets the new one begin on time) and the new one follows.
        if (free > band.at) slot.cut = Math.max(asked, Math.min(slot.cut, band.at - HANDOVER.sweep));
        slot.next = { ...band, at: Math.max(band.at, Math.min(free, slot.cut + HANDOVER.sweep)) };
    }

    /** A piece came down at world (x, y): the sparkle ripple runs out from there. */
    lock(time, { x = 0, y = 0, hardDrop = false } = {}) {
        if (!Number.isFinite(time)) return;
        const { ripple } = this;
        const strength = hardDrop ? 1 : 0.6;
        const fresh = {
            at: time, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, strength,
        };
        // One already waiting to follow the last: this one takes its place (it was never seen).
        if (ripple.next) {
            if (strength >= ripple.next.strength) ripple.next = { ...fresh, at: ripple.next.at };
            return;
        }
        // A ripple still young is not cut off by a weaker one: it is let run.
        const age = time - ripple.at;
        if (age >= 0 && age < RIPPLE.life * 0.35 && ripple.strength > strength) return;
        const lit = age >= 0 && age < RIPPLE.life && time < ripple.cut + HANDOVER.ripple;
        if (!lit) {
            Object.assign(ripple, fresh, { cut: Infinity, next: null });
            return;
        }
        // The one still running fades out as the new one sets off.
        ripple.cut = time;
        ripple.next = { ...fresh, at: time + HANDOVER.ripple };
    }

    /**
     * Lines cleared: `lines` 1..4, `combo` the true combo (a run of clearing locks), `cascade` the
     * depth of this lock's chain reaction.
     */
    clear(time, { lines = 1, combo = 1, cascade = 1 } = {}) {
        if (!Number.isFinite(time)) return;
        const n = Math.max(1, Math.min(4, Math.round(lines)));
        this.sweep(time, 1, 0.72 + n * 0.12);
        if (n >= 2) this.sweep(time + 0.3, -1, 0.6 + n * 0.12, time);
        if (n === 3) {
            this.aurora.hit(0.42, time);
            this.reach.hit(0.14, time);
        }
        if (n >= 4) {
            this.aurora.hit(1, time);
            this.reach.hit(0.55, time);
            this.dust.hit(0.45, time);
        }
        const run = Math.max(0, Math.round(combo) - 2) + Math.max(0, Math.round(cascade) - 1);
        if (run > 0) {
            this.aurora.hit(Math.min(0.45, 0.12 * run), time);
            this.reach.hit(Math.min(0.2, 0.05 * run), time);
        }
    }

    /** A twist: a breath of diamond dust (with lines, more). */
    twist(time, lines = 0) {
        if (Number.isFinite(time)) this.dust.hit(lines > 0 ? 0.5 : 0.25, time);
    }

    /** Back to back: the answer comes back across the valley from the right. */
    backToBack(time) {
        if (!Number.isFinite(time)) return;
        this.sweep(time + 0.15, -1, 0.95, time);
        this.aurora.hit(0.38, time);
        this.reach.hit(0.12, time);
    }

    /** The perfect clear: the lights over the whole sky, the air full of diamond dust. */
    perfect(time) {
        if (!Number.isFinite(time)) return;
        this.aurora.hit(1.5, time);
        this.reach.hit(1, time);
        this.dust.hit(1.5, time);
    }

    /** A level: an hour passes in a breath. */
    levelUp(time) {
        if (!Number.isFinite(time)) return;
        this.wheel.hit(WHEEL.turn, time);
        // (The cloud's sweep counts from where the last one left it.)
        const { rush } = this;
        rush.count += smooth((time - rush.at) / WHEEL.length);
        rush.at = time;
    }

    /** How hot play runs (gameplay-surge.js): `level` 0..1, `fever` 0..1. */
    setHeat({ level = 0, fever = 0 } = {}) {
        this.heat.level = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
        this.heat.fever = Math.max(0, Math.min(1, Number.isFinite(fever) ? fever : 0));
    }

    /** How far the run's-end snow has set in at `t` (0..1). */
    restAt(t) {
        const { rest } = this;
        return rest.over ? smooth((t - rest.at) / REST.settle) : 1 - smooth((t - rest.at) / REST.clear);
    }

    /** The run is over: the night settles under falling snow (from wherever it stands). */
    over(time) {
        if (this.rest.over || !Number.isFinite(time)) return;
        const now = this.restAt(time);
        this.rest.over = true;
        this.rest.at = time - REST.settle * inverseSmooth(now);
    }

    /** A run begins: the snow of the last one's end stops (from wherever it has got to). */
    begin(time) {
        if (!this.rest.over || !Number.isFinite(time)) return;
        const now = this.restAt(time);
        this.rest.over = false;
        this.rest.at = time - REST.clear * inverseSmooth(1 - now);
    }

    /**
     * The night at `time`, `phase` hours in (wolfhour-hours.js): its weather and its answers to
     * play. `motion` (0..1): below 0.5 the stars do not wheel and the bands of light do not travel
     * (they brighten the ranges in place and fade).
     * @param {number} time
     * @param {number} [phase]
     * @param {number} [motion]
     */
    sample(time, phase = 0, motion = 1) {
        const t = Number.isFinite(time) ? time : 0;
        const calm = motion < 0.5;
        const w = wolfhourWeatherAt(phase, t, this.weather);
        const { night, heat } = this;
        const settled = this.restAt(t);
        // The fever holds the lights and the glitter up; the run's end lets the snow fall.
        night.aurora = Math.min(1.6, w.aurora + this.aurora.valueAt(t) + heat.fever * 0.75);
        night.reach = Math.min(1, w.reach + this.reach.valueAt(t) + heat.fever * 0.5);
        const glitter = heat.fever * 0.4 + Math.max(0, heat.level - 0.4) * 0.3;
        night.dust = Math.min(1.5, w.dust + this.dust.valueAt(t) + glitter);
        night.fall = Math.min(1, w.fall + settled * 0.6);
        night.wind = Math.min(1.2, w.wind + heat.level * 0.3);
        this.sweeps.forEach((slot, i) => {
            // A band waiting for this slot takes it once the one before has gone.
            if (slot.next && t >= slot.next.at) Object.assign(slot, slot.next, { cut: Infinity, next: null });
            const u = (t - slot.at) / SWEEP.life;
            const out = night.sweeps[i];
            if (!(u >= 0 && u <= 1)) {
                out[1] = 0;
                return;
            }
            out[0] = calm ? 0 : slot.dir * (u * 2 - 1) * SWEEP.span;
            out[1] = slot.strength * Math.sin(Math.PI * u) ** 0.8 * (calm ? 0.5 : 1)
                * handedOver(t, slot.cut, HANDOVER.sweep);
            out[2] = calm ? SWEEP.span : SWEEP.width;
        });
        night.glow = Math.min(1.5, night.sweeps[0][1] + night.sweeps[1][1]);
        const { ripple } = this;
        if (ripple.next && t >= ripple.next.at) Object.assign(ripple, ripple.next, { cut: Infinity, next: null });
        const age = (t - ripple.at) / RIPPLE.life;
        if (age >= 0 && age <= 1) {
            night.ripple[0] = ripple.x;
            night.ripple[1] = ripple.y;
            night.ripple[2] = 30 + RIPPLE.reach * (1 - Math.exp(-2.4 * age));
            night.ripple[3] = ripple.strength * (1 - age) ** 1.4 * smooth(age / 0.08)
                * handedOver(t, ripple.cut, HANDOVER.ripple);
        } else night.ripple[3] = 0;
        if (calm) {
            night.spin = 0;
            night.streak = 0;
        } else {
            const spin = this.wheel.valueAt(t);
            const { turned } = this;
            const dt = t - turned.at;
            // While the sky turns each star is drawn out over what it travels in a third of a
            // second (read from the last frame's turn; a seek or a pause shows none).
            if (dt > 1e-3 && dt < 0.25) night.streak = Math.max(0, (spin - turned.spin) / dt) * 0.33;
            else if (dt !== 0) night.streak = 0;
            turned.at = t;
            turned.spin = spin;
            night.spin = spin;
        }
        night.rush = (this.rush.count + smooth((t - this.rush.at) / WHEEL.length)) * WHEEL.rush;
        return night;
    }

    /** Back to a quiet night (a new scene, the theme stopped). */
    reset() {
        this.aurora.reset();
        this.reach.reset();
        this.dust.reset();
        this.wheel.reset();
        for (const slot of [...this.sweeps, this.ripple]) {
            slot.at = -Infinity;
            slot.cut = Infinity;
            slot.next = null;
        }
        this.rush.count = 0;
        this.rush.at = -Infinity;
        this.heat.level = 0;
        this.heat.fever = 0;
        this.rest.over = false;
        this.rest.at = -Infinity;
        this.turned.at = -Infinity;
        this.turned.spin = 0;
    }
}
