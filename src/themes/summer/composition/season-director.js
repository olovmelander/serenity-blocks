/**
 * Summer "Midsommar Solstice" — Season Director
 *
 * The reactivity spine. Tracks a single master scalar `warmth ∈ [0,1]` (how
 * "alive / golden / festive" the meadow feels) that is eased up by gameplay and
 * decays back toward a calm idle floor — a glow, not a switch. Layered transients
 * (breeze, bloom, sparkle, raise) decay independently and drive specific visuals:
 *   - breeze  → meadow gust + water ripple swell
 *   - bloom   → flower bloom-flash + golden bloom lift on big clears
 *   - sparkle → fireflies / pollen shimmer + water glitter boost
 *   - raise   → the maypole "raise & glow" beat (Tetris / Perfect Clear)
 *
 * Dependency-free (no three.js) so it stays pure and testable; the effect builds
 * THREE.Color from `accent` as needed and feeds these scalars into TSL uniforms
 * as multiply-adds that are 0 at rest (so the shader graph compiles once).
 *
 * Mirrors the shape of winter's StormDirector. See docs/SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md §9.
 */

// Warm accent palette (hex) the grade/bloom push toward on events.
export const SEASON_ACCENTS = {
    default: 0xffd27a, // golden idle
    single: 0xfff4d6, // warm white
    double: 0xf6c324, // buttercup
    triple: 0x8e7cc3, // lupine
    tetris: 0xf39c6b, // sunset coral (the big beat)
    combo: 0xf6c324, // buttercup (mid combo)
    surge: 0xf39c6b, // coral (high combo)
};

function hexToRgb(hex) {
    return {
        r: (Math.floor(hex / 65536) % 256) / 255,
        g: (Math.floor(hex / 256) % 256) / 255,
        b: (hex % 256) / 255,
    };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class SeasonDirector {
    constructor(opts = {}) {
        this.warmth = 0; // smoothed 0..1 — what consumers read
        this.target = opts.idleFloor ?? 0.14;
        this.idleFloor = opts.idleFloor ?? 0.14;

        // Fast attack so the meadow "answers" the player; slow decay (calm).
        this.attack = opts.attack ?? 5.0;
        this.decay = opts.decay ?? 0.5;
        this.relax = opts.relax ?? 0.25;

        // Transients (layered on top of warmth, decay independently).
        this.breeze = 0; // 0..1 gust/ripple energy
        this.breezeDir = 1; // -1 / +1
        this.bloom = 0; // 0..~1.2 flower/bloom flash
        this.sparkle = 0; // 0..~1.2 glitter/firefly shimmer
        this.raise = 0; // 0..1 maypole raise & glow beat

        // Accent color, eased toward target.
        this.accentHex = SEASON_ACCENTS.default;
        this.accent = hexToRgb(SEASON_ACCENTS.default);
        this._targetAccent = hexToRgb(SEASON_ACCENTS.default);

        this.intensityScale = 1; // reduced-motion / disable multiplier
        this.time = 0;
        this.timeSinceActivity = 999;
    }

    _setAccent(hex) {
        if (hex === undefined || hex === null) return;
        this.accentHex = hex;
        this._targetAccent = hexToRgb(hex);
    }

    /** Core entry point all event pokes funnel through. */
    bump(amount = 0, opts = {}) {
        const s = this.intensityScale;
        this.target = clamp01(this.target + amount * s);
        this.timeSinceActivity = 0;
        if (opts.breezeDir !== undefined) {
            this.breeze = clamp01(this.breeze + (opts.breeze ?? 0.6) * s);
            this.breezeDir = opts.breezeDir;
        }
        if (opts.bloom) this.bloom = Math.min(1.2, this.bloom + opts.bloom * s);
        if (opts.sparkle) this.sparkle = Math.min(1.2, this.sparkle + opts.sparkle * s);
        if (opts.raise) this.raise = Math.min(1, this.raise + opts.raise * s);
        this._setAccent(opts.accent);
    }

    // --- Game-event pokes (called from the theme's event handlers) ---

    onPieceLock() {
        this.bump(0.012, { bloom: 0.12 });
    }

    onHardDrop() {
        this.bump(0.03, { breezeDir: Math.random() > 0.5 ? 1 : -1, breeze: 0.35 });
    }

    onLineClear(lines = 1, combo = 0) {
        let tier = 'single';
        if (lines >= 4) tier = 'tetris';
        else if (lines >= 3) tier = 'triple';
        else if (lines >= 2) tier = 'double';
        this.bump(0.1 + lines * 0.05 + combo * 0.03, {
            breezeDir: Math.random() > 0.5 ? 1 : -1,
            breeze: 0.45 + lines * 0.1,
            bloom: 0.4 + lines * 0.16,
            sparkle: 0.3 + lines * 0.12,
            raise: lines >= 4 ? 1 : 0, // Tetris raises the maypole
            accent: SEASON_ACCENTS[tier],
        });
    }

    onCombo(combo = 0) {
        if (combo <= 0) return;
        let accent;
        if (combo >= 7) accent = SEASON_ACCENTS.surge;
        else if (combo >= 4) accent = SEASON_ACCENTS.combo;
        this.bump(Math.min(0.5, combo * 0.06), {
            breezeDir: Math.random() > 0.5 ? 1 : -1,
            breeze: Math.min(1, combo * 0.12),
            sparkle: Math.min(0.9, combo * 0.09),
            accent,
        });
    }

    onTSpin(lines = 0) {
        this.bump(0.08 + lines * 0.04, { sparkle: 0.5, bloom: 0.3, accent: SEASON_ACCENTS.triple });
    }

    onPerfectClear() {
        this.bump(0.4, {
            bloom: 0.9, sparkle: 0.9, raise: 1, accent: SEASON_ACCENTS.tetris,
        });
    }

    onLevelUp() {
        this.bump(0.06, { breezeDir: Math.random() > 0.5 ? 1 : -1, breeze: 0.4, bloom: 0.3 });
    }

    setIntensity(mult = 1) {
        this.intensityScale = clamp01(mult);
        if (this.intensityScale === 0) {
            this.breeze = 0;
            this.bloom = 0;
            this.sparkle = 0;
            this.raise = 0;
        }
    }

    update(delta = 0) {
        const dt = Math.min(0.1, Math.max(0, delta));
        this.time += dt;
        this.timeSinceActivity += dt;

        // Relax target back toward the idle floor when activity stops.
        this.target += (this.idleFloor - this.target) * Math.min(1, dt * this.relax);
        this.target = Math.max(this.idleFloor, Math.min(1, this.target));

        // Ease warmth toward target: fast up, slow down (a glow, not a switch).
        const rate = this.warmth < this.target ? this.attack : this.decay;
        this.warmth += (this.target - this.warmth) * Math.min(1, dt * rate);
        this.warmth = clamp01(this.warmth);

        // Decay transients.
        this.breeze = Math.max(0, this.breeze - dt * 0.7);
        this.bloom = Math.max(0, this.bloom - dt * 1.1);
        this.sparkle = Math.max(0, this.sparkle - dt * 0.9);
        this.raise = Math.max(0, this.raise - dt * 0.55); // slow, savoured beat

        // When calm for a while, let accent drift back to golden idle.
        if (this.warmth <= this.idleFloor + 0.05 && this.timeSinceActivity > 4) {
            this._setAccent(SEASON_ACCENTS.default);
        }
        const k = Math.min(1, dt * 4);
        this.accent.r += (this._targetAccent.r - this.accent.r) * k;
        this.accent.g += (this._targetAccent.g - this.accent.g) * k;
        this.accent.b += (this._targetAccent.b - this.accent.b) * k;
    }

    getState() {
        return {
            warmth: this.warmth,
            breeze: this.breeze,
            breezeDir: this.breezeDir,
            bloom: this.bloom,
            sparkle: this.sparkle,
            raise: this.raise,
            accent: this.accent,
            accentHex: this.accentHex,
        };
    }

    reset() {
        this.warmth = 0;
        this.target = this.idleFloor;
        this.breeze = 0;
        this.bloom = 0;
        this.sparkle = 0;
        this.raise = 0;
        this.timeSinceActivity = 999;
        this._setAccent(SEASON_ACCENTS.default);
        this.accent = hexToRgb(SEASON_ACCENTS.default);
    }
}
