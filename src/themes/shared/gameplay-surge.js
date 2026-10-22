// @ts-check

/**
 * Shared gameplay surge — how a theme's reactions BUILD instead of popping and resetting.
 *
 * A theme answers every lock, clear, cascade wave and combo step. Written the obvious way, each
 * answer restarts an envelope: `flash.at = now; flash.strength = s`. Under fast play that is
 * exactly wrong. A single right after a quad cuts the quad's glow from 0.9 to 0.3 in one frame;
 * ten clears in a row look like the first one ten times, each snapping back to nothing before
 * the next; and the world has no memory that the player has been on fire for twenty seconds.
 * What the player should feel is the opposite: every hit adds to what is still lit, the light
 * rides up as the pace rises, and the whole world leans in until it sings, then breathes out
 * when the hands rest.
 *
 * Two pieces, both renderer-free and pure functions of the clock they are given (a seeked or
 * fixed-time capture lands on the same values every run):
 *
 * ── Swell: an envelope that accumulates (src/themes/shared/swell.js) ─────────────────
 * A new hit ADDS to what is still lit; it never restarts it, so a weak hit after a strong one can
 * only lift the light. Rapid hits ride up to a plateau under a soft ceiling. The drop-in fix for
 * any single-slot `x.at = now; x.strength = s` envelope.
 *
 * ── GameplaySurge: the intensity of play ────────────────────────────────────────────
 * The canonical events feed three swells:
 *
 *   punch  fast (instant rise, ~0.5 s fall): every event's hit, for flashes, kicks, shakes.
 *          Under rapid locks it rides on a floor rather than flickering to zero.
 *   level  the heat of play (0..1; climbs at most 0.22 a second, falls over ~3.5 s): what the world
 *          wears — bloom, exposure, saturation, wind, the creatures' excitement. A lock
 *          alone barely moves it; a steady hand warms it; a combo chain fills it.
 *   fever  the slow tide (0..1; fills over ~4 s of hot play, empties over ~2.5 s once it
 *          cools): it follows the level, so it only climbs while intensity is SUSTAINED.
 *          The theme's crescendo: the sky opening, the storm breaking.
 *
 * `stage` turns level and fever into the four acts a theme can stage (calm, warm, hot, fever)
 * with hysteresis, so a reading that hovers on a threshold never flickers between two looks.
 *
 * The weights (SURGE_WEIGHTS) are tuned so casual play (a lock every ~1.5 s, a clear now and
 * then) sits near 0.1–0.2, a quick steady hand near 0.4–0.6, and a long combo with cascades
 * reaches 0.9+ and lights the fever within a few seconds. Every theme reads the same numbers,
 * so the same play feels the same size in every world; what each world DOES with them is its
 * own.
 *
 * Reduced motion and Reduce flashing are the theme's to apply where it spends these numbers
 * (scale motion by its own calm factor, flashes by `flashScale()`, ADR-0021). A swell that
 * holds the frame bright instead of strobing it is already the gentler answer to fast play.
 */

import { Swell } from './swell.js';

export { Swell, softCeiling } from './swell.js';

/**
 * What each event is worth. `punch` is the momentary hit (a quad on its own ≈ 0.85); `heat` is
 * what it adds to the level of play. Line clears are indexed by line count.
 */
export const SURGE_WEIGHTS = Object.freeze({
    punch: Object.freeze({
        lock: 0.07,
        hardDrop: 0.14,
        lines: Object.freeze([0, 0.3, 0.45, 0.6, 0.85]),
        wave: 0.12, // each cascade wave past the first
        comboStep: 0.04, // per step of the true combo, up to COMBO_CAP
        tspin: 0.35,
        b2b: 0.3,
        perfect: 1.1,
        levelUp: 0.45,
    }),
    heat: Object.freeze({
        lock: 0.02,
        hardDrop: 0.015,
        lines: Object.freeze([0, 0.12, 0.2, 0.3, 0.5]),
        wave: 0.1,
        comboStep: 0.035,
        tspin: 0.3,
        b2b: 0.25,
        perfect: 0.9,
        levelUp: 0.3,
    }),
});

/** Combo steps past this add no more weight (the chain is already in full voice). */
const COMBO_CAP = 10;

/** The acts a theme can stage, from the level and the fever. */
export const SURGE_STAGES = Object.freeze(['calm', 'warm', 'hot', 'fever']);

/** Level thresholds to rise into warm and hot; fever to rise into fever. */
const RISE = Object.freeze({ warm: 0.22, hot: 0.5, fever: 0.55 });
/** How far below a threshold the reading must fall before the act steps back down. */
const HYSTERESIS = 0.1;

/**
 * The act for this level and fever, held where it was until the reading clearly crosses.
 * @param {number} level
 * @param {number} fever
 * @param {number} [previous] the act index last time
 * @returns {number} index into SURGE_STAGES
 */
export function surgeStage(level, fever, previous = 0) {
    let target = 0;
    if (level >= RISE.warm) target = 1;
    if (level >= RISE.hot) target = 2;
    if (fever >= RISE.fever && level >= RISE.hot) target = 3;
    if (target >= previous) return target;
    // Stepping down: only once the reading is clearly under the act it is leaving.
    let held = previous;
    while (held > target) {
        let stays = level >= RISE.warm - HYSTERESIS;
        if (held === 2) stays = level >= RISE.hot - HYSTERESIS;
        if (held === 3) stays = fever >= RISE.fever - HYSTERESIS && level >= RISE.hot - HYSTERESIS;
        if (stays) break;
        held -= 1;
    }
    return held;
}

/**
 * @typedef {{ punch: number, level: number, fever: number, stage: number }} SurgeSample
 */

export class GameplaySurge {
    /**
     * @param {object} [options]
     * @param {number} [options.punchRelease] seconds
     * @param {number} [options.levelAttack] seconds
     * @param {number} [options.levelRelease] seconds
     * @param {number} [options.feverRise] seconds the fever takes to fill from nothing at full heat
     * @param {number} [options.feverFall] seconds it takes to empty once play has cooled
     * @param {number} [options.punchCeiling] the punch's soft ceiling (a frame-wide flash scale)
     * @param {number} [options.riseRate] the most the level may climb per second (it falls freely)
     */
    constructor({
        punchRelease = 0.5,
        levelAttack = 0.35,
        levelRelease = 3.5,
        feverRise = 4,
        feverFall = 2.5,
        punchCeiling = 1,
        riseRate = 0.22,
    } = {}) {
        this.punch = new Swell({
            attack: 0, release: punchRelease, ceiling: punchCeiling, knee: 0.7, headroom: 1.25,
        });
        this.level = new Swell({
            attack: levelAttack, release: levelRelease, ceiling: 1, knee: 0.6, headroom: 1.15,
        });
        this.riseRate = Math.max(1e-3, riseRate);
        /** The level as shown: it climbs at most `riseRate` a second (see sample()). */
        this.shown = 0;
        this.shownAt = Number.NaN;
        this.feverRise = Math.max(1e-3, feverRise);
        this.feverFall = Math.max(1e-3, feverFall);
        /** The fever follows the level it is sampled at (see sample()). */
        this.fever = 0;
        this.feverAt = Number.NaN;
        this.stage = 0;
        /** @type {SurgeSample} */
        this._sample = {
            punch: 0, level: 0, fever: 0, stage: 0,
        };
    }

    /** One event's worth, at `at`. */
    _add(punch, heat, at) {
        this.punch.hit(punch, at);
        this.level.hit(heat, at);
    }

    /**
     * A piece locked.
     * @param {{ hardDrop?: boolean }} [lock]
     * @param {number} at seconds
     */
    lock(lock, at) {
        const W = SURGE_WEIGHTS;
        const hard = lock?.hardDrop === true;
        this._add(
            W.punch.lock + (hard ? W.punch.hardDrop : 0),
            W.heat.lock + (hard ? W.heat.hardDrop : 0),
            at,
        );
    }

    /**
     * Lines cleared (one call per resolved clear; `cascade` is its deepest wave).
     * @param {{ lines?: number, cascade?: number, combo?: number, tspin?: boolean,
     *   perfect?: boolean, b2b?: boolean }} clear
     * @param {number} at seconds
     */
    clear(clear, at) {
        const W = SURGE_WEIGHTS;
        const lines = Math.max(1, Math.min(4, Math.round(Number(clear?.lines) || 1)));
        const waves = Math.max(0, Math.min(12, Math.round(Number(clear?.cascade) || 1) - 1));
        const steps = Math.max(0, Math.min(COMBO_CAP, Math.round(Number(clear?.combo) || 1) - 1));
        let punch = W.punch.lines[lines] + W.punch.wave * waves + W.punch.comboStep * steps;
        let heat = W.heat.lines[lines] + W.heat.wave * waves + W.heat.comboStep * steps;
        if (clear?.tspin) {
            punch += W.punch.tspin;
            heat += W.heat.tspin;
        }
        if (clear?.b2b) {
            punch += W.punch.b2b;
            heat += W.heat.b2b;
        }
        if (clear?.perfect) {
            punch += W.punch.perfect;
            heat += W.heat.perfect;
        }
        this._add(punch, heat, at);
    }

    /**
     * A perfect clear settled after its clear's last wave (physics sends it ~360 ms later): the
     * crown on a clear already counted, worth the perfect clear's own weight only.
     * @param {number} at seconds
     */
    crown(at) {
        this._add(SURGE_WEIGHTS.punch.perfect, SURGE_WEIGHTS.heat.perfect, at);
    }

    /**
     * For a theme that hears the parts of a clear one by one rather than as one resolved clear:
     * one more cascade wave, a T-spin, a back-to-back, each worth what clear() adds for it.
     * @param {number} at seconds
     */
    wave(at) {
        this._add(SURGE_WEIGHTS.punch.wave, SURGE_WEIGHTS.heat.wave, at);
    }

    /** @param {number} at seconds */
    tspin(at) {
        this._add(SURGE_WEIGHTS.punch.tspin, SURGE_WEIGHTS.heat.tspin, at);
    }

    /** @param {number} at seconds */
    b2b(at) {
        this._add(SURGE_WEIGHTS.punch.b2b, SURGE_WEIGHTS.heat.b2b, at);
    }

    /** A T-spin that cleared nothing: a little over half a T-spin's worth. @param {number} at seconds */
    spin(at) {
        this._add(SURGE_WEIGHTS.punch.tspin * 0.6, SURGE_WEIGHTS.heat.tspin * 0.5, at);
    }

    /** The level rose. @param {number} at seconds */
    levelUp(at) {
        this._add(SURGE_WEIGHTS.punch.levelUp, SURGE_WEIGHTS.heat.levelUp, at);
    }

    /**
     * Where play stands at `now`. Reuses one object: copy what you keep. Call once a frame with
     * the theme's clock: punch and level are pure functions of the events and the time; the
     * fever and the act follow the calls. The fever eases toward how hot play is (nothing below
     * a level of 0.55, all of it at 0.95) — filling over `feverRise` seconds, emptying over
     * `feverFall` — so it only climbs while intensity is SUSTAINED and lets go soon after the
     * hands rest. A clock that stood still, went back or jumped (a pause, a seek) holds it.
     * @param {number} now seconds
     * @returns {SurgeSample}
     */
    sample(now) {
        const s = this._sample;
        s.punch = this.punch.valueAt(now);
        // The level climbs no faster than `riseRate` a second, so a burst of play builds over
        // seconds instead of saturating in two clears; it falls with the swell. A clock that
        // stood still, went back or jumped lands on the swell (captures and seeks repeat).
        const level = this.level.valueAt(now);
        const step = now - this.shownAt;
        this.shownAt = now;
        this.shown = step > 0 && step <= 0.5 && level > this.shown
            ? Math.min(level, this.shown + step * this.riseRate)
            : level;
        s.level = this.shown;
        const dt = now - this.feverAt;
        this.feverAt = now;
        if (dt > 0 && dt <= 0.5) {
            const x = Math.max(0, Math.min(1, (s.level - 0.55) / 0.4));
            const target = x * x * (3 - 2 * x);
            this.fever = target > this.fever
                ? Math.min(target, this.fever + dt / this.feverRise)
                : Math.max(target, this.fever - dt / this.feverFall);
        }
        s.fever = this.fever;
        this.stage = surgeStage(s.level, s.fever, this.stage);
        s.stage = this.stage;
        return s;
    }

    /** The whole state as plain numbers (a theme that rebuilds in place carries on mid-surge). */
    exportState() {
        const num = (v) => (Number.isFinite(v) ? v : null);
        return {
            punch: this.punch.exportState(),
            level: this.level.exportState(),
            shown: this.shown,
            shownAt: num(this.shownAt),
            fever: this.fever,
            feverAt: num(this.feverAt),
            stage: this.stage,
        };
    }

    /** Take up a state exportState() wrote (anything missing reads as at rest). */
    importState(o) {
        this.reset();
        if (!o || typeof o !== 'object') return;
        const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);
        this.punch.importState(o.punch);
        this.level.importState(o.level);
        this.shown = Math.max(0, finite(o.shown, 0));
        this.shownAt = finite(o.shownAt, Number.NaN);
        this.fever = Math.max(0, Math.min(1, finite(o.fever, 0)));
        this.feverAt = finite(o.feverAt, Number.NaN);
        this.stage = Math.max(0, Math.min(SURGE_STAGES.length - 1, Math.round(finite(o.stage, 0))));
    }

    /** A new run: everything at rest. */
    reset() {
        this.punch.reset();
        this.level.reset();
        this.shown = 0;
        this.shownAt = Number.NaN;
        this.fever = 0;
        this.feverAt = Number.NaN;
        this.stage = 0;
    }
}
