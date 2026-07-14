/**
 * Summer "Midsommar Solstice" — Season Director
 *
 * The reactivity spine. Tracks a single master scalar `warmth ∈ [0,1]` (how
 * "alive / golden / festive" the meadow feels) that is eased up by gameplay and
 * decays back toward a calm idle floor — a glow, not a switch. Layered transients
 * (breeze, sparkle, raise) decay independently and drive specific visuals:
 *   - breeze  → meadow gust + water ripple swell
 *   - sparkle → fireflies / pollen shimmer + water glitter boost
 *   - raise   → the maypole "raise & glow" beat (Tetris / Perfect Clear)
 *
 * The former `bloom` channel drove no shader node; the discrete "Midsummer
 * Promise" gameplay FX (summer-gameplay-fx.js) now own the bloom-flash beat.
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

        // Transients (layered on top of warmth, decay independently). The former
        // `bloom` channel drove no shader node and is gone; the discrete Midsummer
        // Promise FX (dew seal + flower ring dance) now own the bloom-flash beat.
        this.breeze = 0; // 0..1 gust/ripple energy
        this.breezeDir = 1; // deterministic ±1 gust direction (internal)
        this.sparkle = 0; // 0..~1.2 glitter/firefly shimmer
        this.raise = 0; // 0..1 maypole raise & glow beat

        // Scene-symbiosis reactions (the meadow ITSELF answers the player — plan §4).
        // `flare` is a fast sun/god-ray startle fired on a NEW combo milestone;
        // `flowerBloom` is accumulating combo energy that HOLDS to a cap and decays
        // slowly, so the real wildflowers keep shimmering through a hot streak.
        this.flare = 0; // 0..~1.2 sun-disk + shaft pulse
        this.flowerBloom = 0; // 0..~1.2 wildflower bloom-shimmer (accumulates)
        this._comboTier = 0; // last crossed combo milestone (0/1/2/3/4)

        // Accent color, eased toward target.
        this.accentHex = SEASON_ACCENTS.default;
        this.accent = hexToRgb(SEASON_ACCENTS.default);
        this._targetAccent = hexToRgb(SEASON_ACCENTS.default);

        this.intensityScale = 1; // reduced-motion / disable multiplier
        this.time = 0;
        this.timeSinceActivity = 999;

        // Deterministic event sequence → gust direction (plan §7.3: no Math.random
        // in effect-critical paths, so a fixed event stream reproduces the frame).
        this._seq = 0;

        // Reused output buffer so getState() allocates nothing per frame (§3, §8).
        this._stateOut = {
            warmth: 0,
            breeze: 0,
            sparkle: 0,
            raise: 0,
            flare: 0,
            flowerBloom: 0,
            accent: this.accent,
            accentHex: this.accentHex,
        };
    }

    /** Combo milestone tier (borrowed from Sky Children's MoodDirector 4/7/10). */
    static comboTier(combo) {
        if (combo >= 10) return 4;
        if (combo >= 7) return 3;
        if (combo >= 4) return 2;
        if (combo >= 2) return 1;
        return 0;
    }

    /** Deterministic ±1 gust direction from an incrementing event counter. */
    _nextDir() {
        this._seq = (this._seq + 1) | 0;
        let h = Math.imul(this._seq ^ 0x9e3779b9, 2654435761);
        h ^= h >>> 16;
        return (h & 1) ? 1 : -1;
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
        if (opts.sparkle) this.sparkle = Math.min(1.2, this.sparkle + opts.sparkle * s);
        if (opts.raise) this.raise = Math.min(1, this.raise + opts.raise * s);
        this._setAccent(opts.accent);
    }

    // --- Game-event pokes (called from the theme's event handlers) ---

    onPieceLock() {
        this.bump(0.012);
    }

    onHardDrop() {
        this.bump(0.03, { breezeDir: this._nextDir(), breeze: 0.35 });
    }

    // Line clears own LINE warmth; combos own COMBO warmth (onCombo). Keeping the
    // combo term out of here prevents the same cascade wave double-bumping the
    // ambient envelope when COMBO and LINE_CLEAR both fire (plan §7.5).
    onLineClear(lines = 1) {
        let tier = 'single';
        if (lines >= 4) tier = 'tetris';
        else if (lines >= 3) tier = 'triple';
        else if (lines >= 2) tier = 'double';
        this.bump(0.1 + lines * 0.05, {
            breezeDir: this._nextDir(),
            breeze: 0.45 + lines * 0.1,
            sparkle: 0.3 + lines * 0.12,
            raise: lines >= 4 ? 1 : 0, // Tetris raises the maypole
            accent: SEASON_ACCENTS[tier],
        });
        // The clear opens the meadow: a sun flare + flower bloom scaled by lines.
        this.flare = Math.min(1.2, this.flare + 0.18 + lines * 0.12);
        this.flowerBloom = Math.min(1.2, Math.max(this.flowerBloom, 0.2 + lines * 0.14));
    }

    // Combos make the SCENE answer: continuous flower-bloom accumulation (holds,
    // no rewind) plus a one-shot sun-flare startle each time a NEW milestone
    // (2/4/7/10) is crossed. Mirrors Sky Children's tier-gated onCombo + Vesper's
    // accumulate-with-hold.
    onCombo(combo = 0) {
        if (combo <= 0) { this._comboTier = 0; return; } // dropped chain re-arms
        let accent;
        if (combo >= 7) accent = SEASON_ACCENTS.surge;
        else if (combo >= 4) accent = SEASON_ACCENTS.combo;

        const energy = Math.min(1, combo * 0.13) * this.intensityScale;
        this.flowerBloom = Math.min(1.1, Math.max(this.flowerBloom, energy)); // hold
        this.bump(Math.min(0.5, combo * 0.06), {
            breezeDir: this._nextDir(),
            breeze: Math.min(1, combo * 0.12),
            sparkle: Math.min(0.9, combo * 0.09),
            accent,
        });

        const tier = SeasonDirector.comboTier(combo);
        if (tier > this._comboTier) {
            this._comboTier = tier;
            const s = this.intensityScale;
            this.flare = Math.min(1.2, this.flare + (0.45 + tier * 0.13) * s);
            this.sparkle = Math.min(1.2, this.sparkle + 0.28 * s);
            this.flowerBloom = Math.min(1.2, this.flowerBloom + 0.14 * s);
        }
    }

    onTSpin(lines = 0) {
        this.bump(0.08 + lines * 0.04, { sparkle: 0.5, accent: SEASON_ACCENTS.triple });
        this.flare = Math.min(1.2, this.flare + 0.3);
        this.flowerBloom = Math.min(1.2, Math.max(this.flowerBloom, 0.35));
    }

    onPerfectClear() {
        this.bump(0.4, {
            sparkle: 0.9, raise: 1, accent: SEASON_ACCENTS.tetris,
        });
        this.flare = Math.min(1.3, this.flare + 0.9);
        this.flowerBloom = Math.min(1.3, Math.max(this.flowerBloom, 1.0));
    }

    onLevelUp() {
        this.bump(0.06, { breezeDir: this._nextDir(), breeze: 0.4 });
    }

    setIntensity(mult = 1) {
        this.intensityScale = clamp01(mult);
        if (this.intensityScale === 0) {
            this.breeze = 0;
            this.sparkle = 0;
            this.raise = 0;
            this.flare = 0;
            this.flowerBloom = 0;
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

        // Decay transients — flare is a fast startle, flowerBloom is a slow "hold"
        // so a combo keeps the meadow shimmering after the burst.
        this.breeze = Math.max(0, this.breeze - dt * 0.7);
        this.sparkle = Math.max(0, this.sparkle - dt * 0.9);
        this.raise = Math.max(0, this.raise - dt * 0.55); // slow, savoured beat
        this.flare = Math.max(0, this.flare - dt * 1.7);
        this.flowerBloom = Math.max(0, this.flowerBloom - dt * 0.4);

        // When calm for a while, let accent drift back to golden idle.
        if (this.warmth <= this.idleFloor + 0.05 && this.timeSinceActivity > 4) {
            this._setAccent(SEASON_ACCENTS.default);
        }
        const k = Math.min(1, dt * 4);
        this.accent.r += (this._targetAccent.r - this.accent.r) * k;
        this.accent.g += (this._targetAccent.g - this.accent.g) * k;
        this.accent.b += (this._targetAccent.b - this.accent.b) * k;
    }

    /**
     * Allocation-free: fills and returns a reused buffer (the wrapper reads it
     * immediately each frame and never retains it). Pass `out` to target another
     * object. `accent` is the director's own persistent object, so no per-frame
     * allocation occurs.
     */
    getState(out = this._stateOut) {
        out.warmth = this.warmth;
        out.breeze = this.breeze;
        out.sparkle = this.sparkle;
        out.raise = this.raise;
        out.flare = this.flare;
        out.flowerBloom = this.flowerBloom;
        out.accent = this.accent;
        out.accentHex = this.accentHex;
        return out;
    }

    reset() {
        this.warmth = 0;
        this.target = this.idleFloor;
        this.breeze = 0;
        this.sparkle = 0;
        this.raise = 0;
        this.flare = 0;
        this.flowerBloom = 0;
        this._comboTier = 0;
        this.timeSinceActivity = 999;
        this._seq = 0;
        this._setAccent(SEASON_ACCENTS.default);
        this.accent = hexToRgb(SEASON_ACCENTS.default);
        this._stateOut.accent = this.accent;
    }
}
