/**
 * Winter AAA — Storm Director
 *
 * The spine of the "Living Blizzard". Tracks a single master scalar
 * `intensity ∈ [0,1]` that is eased from game activity and decays back toward a
 * calm idle floor when nothing is happening. Every visual subsystem (snow field,
 * aurora volume, post) reads this to drive the 3-act storm arc:
 *
 *   Still Night  → Rising Wind → Whiteout → (silence) → Resolution
 *
 * This is the winter analogue of Electric Dreams V3's `fxState` + `CameraDirector`.
 * It is intentionally dependency-free (no three.js import) so it stays pure and
 * trivially testable; consumers build THREE.Color from `accent` as needed.
 *
 * Phase 0: only computes + exposes state (+ debug overlay). Phases 1–3 consume it.
 *
 * See docs/WINTER_AAA_PLAN.md §2, §5.
 */

export const STORM_ACTS = {
    STILL_NIGHT: 'Still Night',
    RISING_WIND: 'Rising Wind',
    WHITEOUT: 'Whiteout',
    RESOLUTION: 'Resolution',
};

// Accent palette (hex) the aurora/post push toward on events.
export const STORM_ACCENTS = {
    default: 0x6ff2d6, // calm teal
    single: 0x7fd9ff, // ice blue
    double: 0x86f0c0, // mint
    triple: 0xb98cff, // violet
    tetris: 0xff7ce0, // magenta flare
    combo: 0xb98cff, // violet (mid combo)
    surge: 0xff7ce0, // magenta (high combo / whiteout)
};

function hexToRgb(hex) {
    return {
        r: (Math.floor(hex / 65536) % 256) / 255,
        g: (Math.floor(hex / 256) % 256) / 255,
        b: (hex % 256) / 255,
    };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class StormDirector {
    constructor(opts = {}) {
        // Master arc
        this.intensity = 0; // smoothed 0..1 — what consumers read
        this.target = opts.idleFloor ?? 0.12; // where intensity is easing toward
        this.idleFloor = opts.idleFloor ?? 0.12;

        // Easing rates (fast attack so the storm "answers" the player; slow decay)
        this.attack = opts.attack ?? 6.0;
        this.decay = opts.decay ?? 0.55;
        this.relax = opts.relax ?? 0.22; // how fast target falls back to idle floor

        // Transients (decay independently, layered on top of intensity)
        this.gust = 0; // 0..1 directional gust energy
        this.gustDir = 1; // -1 / +1
        this.whiteout = 0; // 0..~1.2 whiteout flash
        this.flare = 0; // 0..~1.2 aurora flare
        this.kick = 0; // 0..~1.2 camera dolly-push punch (fast decay)
        this.trauma = 0; // 0..1 screen-shake energy (rotational, decaying)
        this.vortex = 0; // 0..~1.2 centered swirl burst (T-spin / combo×6)

        // Accent color, eased toward target
        this.accentHex = STORM_ACCENTS.default;
        this.accent = hexToRgb(STORM_ACCENTS.default);
        this._targetAccent = hexToRgb(STORM_ACCENTS.default);

        // Bookkeeping
        this.time = 0;
        this.timeSinceActivity = 999;
    }

    get act() {
        if (this.intensity <= this.idleFloor + 0.04 && this.timeSinceActivity > 5) {
            return this.timeSinceActivity > 14 ? STORM_ACTS.STILL_NIGHT : STORM_ACTS.RESOLUTION;
        }
        if (this.intensity < 0.34) return STORM_ACTS.STILL_NIGHT;
        if (this.intensity < 0.7) return STORM_ACTS.RISING_WIND;
        return STORM_ACTS.WHITEOUT;
    }

    /** Normalized 0..1 act progress, useful for crossfades. */
    get actProgress() {
        const i = this.intensity;
        if (i < 0.34) return i / 0.34;
        if (i < 0.7) return (i - 0.34) / 0.36;
        return (i - 0.7) / 0.3;
    }

    _setAccent(hex) {
        if (hex === undefined || hex === null) return;
        this.accentHex = hex;
        this._targetAccent = hexToRgb(hex);
    }

    /**
     * Raise the storm. Core entry point all event pokes funnel through.
     */
    bump(amount = 0, opts = {}) {
        this.target = clamp01(this.target + amount);
        this.timeSinceActivity = 0;
        if (opts.gustDir !== undefined) {
            this.gust = clamp01(this.gust + (opts.gust ?? 0.6));
            this.gustDir = opts.gustDir;
        }
        if (opts.whiteout) this.whiteout = Math.min(1.2, this.whiteout + opts.whiteout);
        if (opts.flare) this.flare = Math.min(1.2, this.flare + opts.flare);
        if (opts.kick) this.kick = Math.min(1.2, this.kick + opts.kick);
        if (opts.trauma) this.trauma = Math.min(1.0, this.trauma + opts.trauma);
        if (opts.vortex) this.vortex = Math.min(1.2, this.vortex + opts.vortex);
        this._setAccent(opts.accent);
    }

    // --- Game-event pokes (called from the theme's event handlers) ---

    onPieceLock() {
        this.bump(0.015);
    }

    onHardDrop() {
        this.bump(0.045, {
            gustDir: Math.random() > 0.5 ? 1 : -1, gust: 0.4, kick: 0.4, trauma: 0.16,
        });
    }

    onLineClear(lines = 1, combo = 0) {
        let tier = 'single';
        if (lines >= 4) tier = 'tetris';
        else if (lines >= 3) tier = 'triple';
        else if (lines >= 2) tier = 'double';
        this.bump(0.12 + lines * 0.06 + combo * 0.04, {
            gustDir: Math.random() > 0.5 ? 1 : -1,
            gust: 0.5 + lines * 0.1,
            whiteout: lines >= 4 ? 0.7 : 0,
            flare: 0.3 + lines * 0.12,
            kick: 0.28 + lines * 0.16, // tetris ≈ 0.9 dolly-push
            trauma: lines >= 4 ? 0.45 : lines * 0.06,
            accent: STORM_ACCENTS[tier],
        });
    }

    onCombo(combo = 0) {
        if (combo <= 0) return;
        let accent;
        if (combo >= 7) accent = STORM_ACCENTS.surge;
        else if (combo >= 4) accent = STORM_ACCENTS.combo;
        let kick = 0;
        if (combo >= 7) kick = 0.5;
        else if (combo >= 4) kick = 0.25;
        this.bump(Math.min(0.5, combo * 0.06), {
            whiteout: combo >= 7 ? 0.6 : 0,
            flare: Math.min(0.85, combo * 0.08),
            kick,
            accent,
        });
    }

    onLevelUp() {
        this.bump(0.08, { gustDir: Math.random() > 0.5 ? 1 : -1, gust: 0.5, flare: 0.4 });
    }

    onTSpin(lines = 0) {
        // The signature "twist" — a swirling vortex burst + violet accent.
        this.bump(0.18 + lines * 0.05, {
            flare: 0.5, kick: 0.35, vortex: 1.2, trauma: 0.25, accent: STORM_ACCENTS.triple,
        });
    }

    onPerfectClear() {
        // The reserved crescendo — whiteout bloom + aurora flare + the biggest shake.
        this.bump(0.4, {
            whiteout: 1.0, flare: 1.0, kick: 0.6, trauma: 0.55, accent: STORM_ACCENTS.tetris,
        });
    }

    update(delta = 0) {
        const dt = Math.min(0.1, Math.max(0, delta));
        this.time += dt;
        this.timeSinceActivity += dt;

        // Relax target back toward the idle floor when activity stops.
        this.target += (this.idleFloor - this.target) * Math.min(1, dt * this.relax);
        this.target = Math.max(this.idleFloor, Math.min(1, this.target));

        // Ease intensity toward target: fast up, slow down (weather, not a switch).
        const rate = this.intensity < this.target ? this.attack : this.decay;
        this.intensity += (this.target - this.intensity) * Math.min(1, dt * rate);
        this.intensity = clamp01(this.intensity);

        // Decay transients.
        this.gust = Math.max(0, this.gust - dt * 0.8);
        this.whiteout = Math.max(0, this.whiteout - dt * 1.4);
        this.flare = Math.max(0, this.flare - dt * 0.9);
        this.kick = Math.max(0, this.kick - dt * 3.2); // fast ~0.3s punch
        this.trauma = Math.max(0, this.trauma - dt * 0.8);
        this.vortex = Math.max(0, this.vortex - dt * 1.2);

        // When calm for a while, let accent drift back to the default teal.
        if (this.intensity <= this.idleFloor + 0.05 && this.timeSinceActivity > 4) {
            this._setAccent(STORM_ACCENTS.default);
        }
        const k = Math.min(1, dt * 4);
        this.accent.r += (this._targetAccent.r - this.accent.r) * k;
        this.accent.g += (this._targetAccent.g - this.accent.g) * k;
        this.accent.b += (this._targetAccent.b - this.accent.b) * k;
    }

    /** Snapshot for consumers / debug. Reuses ONE object (mutated in place) so the
     * per-frame theme→effect push allocates nothing — avoids steady GC pressure / stutter.
     * Consumers read it the same frame, so in-place reuse is safe. */
    getState() {
        const s = this._stateOut || (this._stateOut = {});
        s.intensity = this.intensity;
        s.act = this.act;
        s.actProgress = this.actProgress;
        s.gust = this.gust;
        s.gustDir = this.gustDir;
        s.whiteout = this.whiteout;
        s.flare = this.flare;
        s.kick = this.kick;
        s.trauma = this.trauma;
        s.vortex = this.vortex;
        s.accent = this.accent;
        s.accentHex = this.accentHex;
        return s;
    }

    reset() {
        this.intensity = 0;
        this.target = this.idleFloor;
        this.gust = 0;
        this.whiteout = 0;
        this.flare = 0;
        this.kick = 0;
        this.trauma = 0;
        this.vortex = 0;
        this.timeSinceActivity = 999;
        this._setAccent(STORM_ACCENTS.default);
        this.accent = hexToRgb(STORM_ACCENTS.default);
    }
}
