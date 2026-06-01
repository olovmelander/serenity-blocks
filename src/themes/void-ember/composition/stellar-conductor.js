/**
 * Void Ember AAA — Stellar Conductor
 *
 * The spine of the "living star in the void". Tracks a single master scalar
 * `intensity ∈ [0,1]` eased from gameplay (fast attack, slow decay) that falls
 * back toward a calm idle floor when nothing happens, and derives the star's
 * physical life-state from it:
 *
 *   Ember  →  Kindling  →  Inferno   (and a slow cool-down when silent)
 *
 * From `intensity` + a handful of transients it exposes the channels every
 * visual subsystem will read in later phases:
 *
 *   temperature  black-body ramp position (deep-red ember → blue-white)
 *   agitation    surface boil speed + filament turbulence
 *   coronaEnergy corona reach + prominence whip
 *   breath       always-on slow idle pulse (amplitude shrinks as it rages)
 *   cmePulse     coronal-mass-ejection ring (line clears)
 *   novaFlash    full flare-nova (tetris / level-up)
 *   flare/flash/shock  legacy fast transients (kept for parity)
 *   cameraPush   virtual-camera shove on impacts
 *
 * This is the Void Ember analogue of Winter's `StormDirector` and Electric
 * Dreams V3's `StageConductor`. It is intentionally dependency-free (no
 * three.js, no DOM, no window) so it stays pure and trivially node-testable.
 *
 * Phase 0: computes + exposes state (+ debug overlay). Phases 1+ consume it via
 * the uniform block; the WGSL render path is untouched until then.
 *
 * See docs/VOID_EMBER_AAA_PLAN.md §3.
 */

export const STELLAR_ACTS = {
    DORMANT: 'Dormant Ember',
    EMBER: 'Ember',
    KINDLING: 'Kindling',
    INFERNO: 'Inferno',
    COOLING: 'Cooling',
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class StellarConductor {
    constructor(opts = {}) {
        // --- Master arc ---
        this.intensity = 0; // smoothed 0..1 — the spine consumers read
        this.idleFloor = opts.idleFloor ?? 0.1; // calm resting energy
        this.target = this.idleFloor; // where intensity eases toward

        // Easing rates: fast attack so the star "answers" the player; slow decay.
        this.attack = opts.attack ?? 5.5;
        this.decay = opts.decay ?? 0.5;
        this.relax = opts.relax ?? 0.25; // how fast target falls back to idle floor

        // --- Temperature (own thermal inertia: heats fast, cools slow) ---
        this.temperature = opts.idleTemp ?? 0.12; // 0 = deep-red ember, 1 = blue-white
        this.idleTemp = opts.idleTemp ?? 0.12;

        // --- Transients (decay independently, layered on top of intensity) ---
        this.flare = 0; // 0..~1.5 prominence/corona flare
        this.flash = 0; // 0..1 hard-drop snap flash
        this.shock = 0; // 0..1 expanding shockwave ring
        this.cmePulse = 0; // 0..1 coronal-mass-ejection ring (line clears)
        this.novaFlash = 0; // 0..~1.5 full flare-nova (tetris / level up)
        this.cameraPush = 0; // 0..1 virtual-camera shove

        // --- Always-on idle breath ---
        this.breathPhase = 0;
        this.breath = 0.5; // 0..1 slow pulse (amplitude folded in)

        // --- Bookkeeping ---
        this.time = 0;
        this.timeSinceActivity = 999;
    }

    get act() {
        if (this.intensity <= this.idleFloor + 0.04 && this.timeSinceActivity > 5) {
            return this.timeSinceActivity > 14 ? STELLAR_ACTS.DORMANT : STELLAR_ACTS.COOLING;
        }
        if (this.intensity < 0.34) return STELLAR_ACTS.EMBER;
        if (this.intensity < 0.7) return STELLAR_ACTS.KINDLING;
        return STELLAR_ACTS.INFERNO;
    }

    /** Normalized 0..1 progress within the current act — useful for crossfades. */
    get actProgress() {
        const i = this.intensity;
        if (i < 0.34) return i / 0.34;
        if (i < 0.7) return (i - 0.34) / 0.36;
        return clamp01((i - 0.7) / 0.3);
    }

    // --- Derived life-state channels (functions of the smoothed spine) ---

    /** Surface boil speed + filament turbulence (instantaneous; spine is pre-smoothed). */
    get agitation() {
        return clamp01(0.15 + this.intensity * 0.9 + this.flare * 0.5
            + this.cmePulse * 0.4 + this.novaFlash * 0.6);
    }

    /** Corona reach + prominence whip. */
    get coronaEnergy() {
        return clamp01(0.1 + this.intensity * 0.6 + this.flare * 1.0
            + this.novaFlash * 0.9 + this.cmePulse * 0.6);
    }

    /**
     * Raise the star. Core entry point all event pokes funnel through.
     */
    bump(amount = 0, opts = {}) {
        this.target = clamp01(this.target + amount);
        this.timeSinceActivity = 0;
        if (opts.flare) this.flare = Math.min(1.5, this.flare + opts.flare);
        if (opts.flash) this.flash = Math.min(1, this.flash + opts.flash);
        if (opts.shock) this.shock = Math.min(1, this.shock + opts.shock);
        if (opts.cme) this.cmePulse = Math.min(1, this.cmePulse + opts.cme);
        if (opts.nova) this.novaFlash = Math.min(1.5, this.novaFlash + opts.nova);
        if (opts.push) this.cameraPush = Math.min(1, this.cameraPush + opts.push);
        if (opts.heat) this.temperature = clamp01(this.temperature + opts.heat);
    }

    // --- Game-event pokes (called from the theme's event handlers) ---

    onPieceLock() {
        this.bump(0.018, { flare: 0.12, push: 0.04 });
    }

    onHardDrop() {
        this.bump(0.05, {
            flash: 1.0, shock: 0.85, flare: 0.18, push: 0.18,
        });
    }

    onLineClear(lines = 1, combo = 0) {
        const n = Math.max(1, Math.min(4, lines));
        const isTetris = n >= 4;
        this.bump(0.1 + n * 0.06 + combo * 0.03, {
            cme: 0.55 + n * 0.12,
            flare: 0.35 + n * 0.18,
            shock: 0.4 + n * 0.1,
            nova: isTetris ? 0.9 : 0,
            push: isTetris ? 0.5 : 0.18,
            heat: 0.04 + n * 0.02,
        });
    }

    onCombo(combo = 0) {
        if (combo <= 1) return;
        const surge = combo >= 7;
        this.bump(Math.min(0.5, combo * 0.06), {
            flare: Math.min(1.2, combo * 0.1),
            nova: surge ? 0.5 : 0,
            cme: surge ? 0.4 : 0,
            push: surge ? 0.3 : 0.1,
            heat: Math.min(0.3, combo * 0.025),
        });
    }

    onLevelUp() {
        this.bump(0.14, {
            nova: 1.0, flare: 0.6, shock: 1.0, push: 0.4, heat: 0.1,
        });
    }

    /** Goal complete / victory-lap end / exit-to-menu → slow collapse + cool-down. */
    onCollapse() {
        this.bump(0.06, { flare: 0.4, shock: 0.9, push: 0.3 });
        // Pull the resting target down so the star visibly cools and settles.
        this.target = this.idleFloor;
    }

    update(delta = 0) {
        const dt = Math.min(0.1, Math.max(0, delta));
        this.time += dt;
        this.timeSinceActivity += dt;

        // Relax the target back toward the idle floor when activity stops.
        this.target += (this.idleFloor - this.target) * Math.min(1, dt * this.relax);
        this.target = Math.max(this.idleFloor, Math.min(1, this.target));

        // Ease intensity toward target: fast up, slow down (a fire, not a switch).
        const rate = this.intensity < this.target ? this.attack : this.decay;
        this.intensity += (this.target - this.intensity) * Math.min(1, dt * rate);
        this.intensity = clamp01(this.intensity);

        // Temperature has thermal mass: climbs quickly under load, cools slowly.
        const tempTarget = clamp01(this.idleTemp + this.intensity * 0.72
            + this.flare * 0.18 + this.novaFlash * 0.4);
        const heating = tempTarget > this.temperature;
        this.temperature += (tempTarget - this.temperature)
            * Math.min(1, dt * (heating ? 3.2 : 0.45));
        this.temperature = clamp01(this.temperature);

        // Always-on breath: slow at idle, quicker (and shallower) when raging.
        this.breathPhase += dt * (0.85 + this.intensity * 0.9);
        const breathAmp = 1 - this.intensity * 0.7; // calm breathes deep, inferno barely
        this.breath = clamp01(0.5 + 0.5 * Math.sin(this.breathPhase) * breathAmp);

        // Decay transients.
        this.flare = Math.max(0, this.flare - dt * 0.95);
        this.flash = Math.max(0, this.flash - dt * 4.0);
        this.shock = Math.max(0, this.shock - dt * 2.6);
        this.cmePulse = Math.max(0, this.cmePulse - dt * 1.3);
        this.novaFlash = Math.max(0, this.novaFlash - dt * 1.1);
        this.cameraPush = Math.max(0, this.cameraPush - dt * 3.0);
    }

    /** Snapshot for consumers / debug overlay. */
    getState() {
        return {
            intensity: this.intensity,
            act: this.act,
            actProgress: this.actProgress,
            temperature: this.temperature,
            agitation: this.agitation,
            coronaEnergy: this.coronaEnergy,
            breath: this.breath,
            flare: this.flare,
            flash: this.flash,
            shock: this.shock,
            cmePulse: this.cmePulse,
            novaFlash: this.novaFlash,
            cameraPush: this.cameraPush,
            time: this.time,
            timeSinceActivity: this.timeSinceActivity,
        };
    }

    reset() {
        this.intensity = 0;
        this.target = this.idleFloor;
        this.temperature = this.idleTemp;
        this.flare = 0;
        this.flash = 0;
        this.shock = 0;
        this.cmePulse = 0;
        this.novaFlash = 0;
        this.cameraPush = 0;
        this.breathPhase = 0;
        this.breath = 0.5;
        this.time = 0;
        this.timeSinceActivity = 999;
    }
}
