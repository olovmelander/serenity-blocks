/**
 * Sky Children V2 AAA — Mood Director
 *
 * The spine of the cool-cloud-sea → golden-hour-triumph mood arc. Tracks one
 * master scalar `radiance ∈ [0,1]` ("how triumphant is the light right now"),
 * eased up fast from game activity and decaying slowly back to a calm Reverie
 * floor when idle — so the warm/cool split is ALWAYS visible (look-bible anchor
 * #6), and the light "answers" the player like real golden-hour light rather
 * than a switch.
 *
 * Every subsystem reads this to drive the 3-act arc through the look bible's
 * mood buckets:
 *
 *   Reverie (cool cloud sea) → Warming → Triumph (full sunset ignition) → (silence) → Resolution
 *
 * The Sky analogue of Himalayan's AltitudeDirector / Winter's StormDirector /
 * Void Ember's StellarConductor. Intentionally dependency-free (no three.js
 * import) so it stays pure and trivially testable; consumers build THREE.Color
 * from the rgb accents.
 *
 * See docs/SKY_CHILDREN_V2_AAA_PLAN.md §2.2, §5.
 */

export const MOOD_ACTS = {
    REVERIE: 'Reverie', // cool cloud-sea, idle
    WARMING: 'Warming',
    TRIUMPH: 'Triumph', // full golden-hour ignition
    RESOLUTION: 'Resolution',
};

// Accent palette (hex) the sunset rim / sky / post push toward on events.
// Recolored from the look bible's Sunset palette (#F6C063 #E58D4A … #6A71B8).
export const RADIANCE_ACCENTS = {
    default: 0xf6c063, // warm pale gold (Reverie floor)
    single: 0xf6c063, // soft gold
    double: 0xf0b25a, // gold
    triple: 0xe58d4a, // amber-orange
    tetris: 0xee7a52, // rosy-orange flare
    combo: 0xe58d4a, // amber-orange (mid combo)
    surge: 0xf06a8a, // fuchsia-rose (high combo / full triumph)
};

function hexToRgb(hex) {
    return {
        r: (Math.floor(hex / 65536) % 256) / 255,
        g: (Math.floor(hex / 256) % 256) / 255,
        b: (hex % 256) / 255,
    };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class MoodDirector {
    constructor(opts = {}) {
        // Master arc — what consumers read as "radiance" / "warmth".
        this.radiance = 0;
        // Sunset is the PRIMARY mood (look bible): rest at a gentle golden hour,
        // not a cold dawn. Combos push toward full ignition; colored shadows + cool
        // sky zenith keep the warm/cool split alive even at this warmer floor.
        // Rest in the BRIGHT BLUE DAY (reverie palette = blue sky / white sun /
        // white clouds / green hills — the Sky-COTL daylight look). Combos push
        // toward the warm Triumph sunset; colored shadows keep the warm/cool split.
        this.idleFloor = opts.idleFloor ?? 0.1;
        this.target = this.idleFloor;

        // Easing rates (fast attack so the light answers the player; slow decay
        // so the sunset lingers like real golden-hour light, not a flicker).
        this.attack = opts.attack ?? 5.5;
        this.decay = opts.decay ?? 0.4;
        this.relax = opts.relax ?? 0.18; // target → idle floor when activity stops

        // Transients (decay independently, layered on top of radiance).
        this.gust = 0; // 0..1 directional wind energy (clouds + grass + glints)
        this.gustDir = 1; // -1 / +1
        this.ignite = 0; // 0..~1.2 sunset ignition flash (big clears)
        this.flare = 0; // 0..~1.2 sun lens-flare / god-ray punch
        this.sparkle = 0; // 0..~1 glitter burst (lifts the glitter threshold briefly)
        this.scatter = 0; // 0..1 impulse → sky-manta / birds scatter then re-form
        this.bloomPunch = 0;
        this.chromaPunch = 0;
        this.cameraPunch = 0; // generic intensity for camera dolly/shake

        // Accent color, eased toward target tier.
        this.accentHex = RADIANCE_ACCENTS.default;
        this.accent = hexToRgb(RADIANCE_ACCENTS.default);
        this._targetAccent = hexToRgb(RADIANCE_ACCENTS.default);

        this.time = 0;
        this.timeSinceActivity = 999;
    }

    /** Eased mood warmth 0..1 — what the sky/grade read. Alias of radiance. */
    get warmth() {
        return this.radiance;
    }

    get act() {
        if (this.radiance <= this.idleFloor + 0.04 && this.timeSinceActivity > 5) {
            return this.timeSinceActivity > 14 ? MOOD_ACTS.REVERIE : MOOD_ACTS.RESOLUTION;
        }
        if (this.radiance < 0.34) return MOOD_ACTS.REVERIE;
        if (this.radiance < 0.7) return MOOD_ACTS.WARMING;
        return MOOD_ACTS.TRIUMPH;
    }

    /** Normalized 0..1 act progress, useful for crossfades. */
    get actProgress() {
        const r = this.radiance;
        if (r < 0.34) return r / 0.34;
        if (r < 0.7) return (r - 0.34) / 0.36;
        return clamp01((r - 0.7) / 0.3);
    }

    _setAccent(hex) {
        if (hex === undefined || hex === null) return;
        this.accentHex = hex;
        this._targetAccent = hexToRgb(hex);
    }

    /** Raise the radiance. Core entry point all event pokes funnel through. */
    bump(amount = 0, opts = {}) {
        this.target = clamp01(this.target + amount);
        this.timeSinceActivity = 0;
        if (opts.gustDir !== undefined) {
            this.gust = clamp01(this.gust + (opts.gust ?? 0.6));
            this.gustDir = opts.gustDir;
        }
        if (opts.ignite) this.ignite = Math.min(1.2, this.ignite + opts.ignite);
        if (opts.flare) this.flare = Math.min(1.2, this.flare + opts.flare);
        if (opts.sparkle) this.sparkle = clamp01(this.sparkle + opts.sparkle);
        if (opts.scatter) this.scatter = clamp01(this.scatter + opts.scatter);
        if (opts.bloom) this.bloomPunch = Math.min(1.0, this.bloomPunch + opts.bloom);
        if (opts.chroma) this.chromaPunch = Math.min(1.0, this.chromaPunch + opts.chroma);
        if (opts.camera) this.cameraPunch = Math.min(1.0, this.cameraPunch + opts.camera);
        this._setAccent(opts.accent);
    }

    // --- Game-event pokes (called from the theme's event handlers) ---

    onPieceLock() {
        // Subtle breeze over the sea; barely moves the arc.
        this.bump(0.012, { gustDir: Math.random() > 0.5 ? 1 : -1, gust: 0.12 });
    }

    onHardDrop() {
        this.bump(0.04, {
            gustDir: Math.random() > 0.5 ? 1 : -1,
            gust: 0.4,
            camera: 0.4,
            chroma: 0.25,
        });
    }

    onLineClear(lines = 1, combo = 0) {
        let tier = 'single';
        if (lines >= 4) tier = 'tetris';
        else if (lines >= 3) tier = 'triple';
        else if (lines >= 2) tier = 'double';
        const isTetris = lines >= 4;
        this.bump(0.12 + lines * 0.07 + combo * 0.04, {
            gustDir: Math.random() > 0.5 ? 1 : -1,
            gust: 0.45 + lines * 0.12,
            ignite: isTetris ? 0.8 : lines * 0.12,
            flare: 0.25 + lines * 0.14,
            sparkle: isTetris ? 0.9 : lines * 0.14,
            bloom: 0.18 + lines * 0.08,
            camera: isTetris ? 0.7 : 0.25,
            accent: RADIANCE_ACCENTS[tier],
        });
    }

    onCombo(combo = 0) {
        if (combo <= 0) return;
        let accent;
        if (combo >= 7) accent = RADIANCE_ACCENTS.surge;
        else if (combo >= 4) accent = RADIANCE_ACCENTS.combo;
        const big = combo >= 7;
        this.bump(Math.min(0.55, combo * 0.07), {
            ignite: big ? 0.7 : 0,
            flare: Math.min(0.9, combo * 0.09),
            sparkle: big ? 0.8 : combo * 0.07,
            bloom: Math.min(0.5, combo * 0.06),
            camera: big ? 0.6 : 0.2,
            accent,
        });
    }

    onLevelUp() {
        this.bump(0.08, {
            gustDir: Math.random() > 0.5 ? 1 : -1, gust: 0.5, flare: 0.4,
        });
    }

    /** Game over → exhale: drive the light back to calm Reverie over a few seconds. */
    onGameOver() {
        this.target = this.idleFloor;
        this.timeSinceActivity = 0;
        this.cameraPunch = Math.max(this.cameraPunch, 0.5);
    }

    update(delta = 0) {
        const dt = Math.min(0.1, Math.max(0, delta));
        this.time += dt;
        this.timeSinceActivity += dt;

        // Relax target back toward the idle Reverie floor when activity stops.
        this.target += (this.idleFloor - this.target) * Math.min(1, dt * this.relax);
        this.target = Math.max(this.idleFloor, Math.min(1, this.target));

        // Ease radiance toward target: fast up, slow down (golden hour, not a switch).
        const rate = this.radiance < this.target ? this.attack : this.decay;
        this.radiance += (this.target - this.radiance) * Math.min(1, dt * rate);
        this.radiance = clamp01(this.radiance);

        // Decay transients.
        this.gust = Math.max(0, this.gust - dt * 0.7);
        this.ignite = Math.max(0, this.ignite - dt * 1.1);
        this.flare = Math.max(0, this.flare - dt * 0.9);
        this.sparkle = Math.max(0, this.sparkle - dt * 1.3);
        this.scatter = Math.max(0, this.scatter - dt * 0.6);
        this.bloomPunch = Math.max(0, this.bloomPunch - dt * 1.4);
        this.chromaPunch = Math.max(0, this.chromaPunch - dt * 2.0);
        this.cameraPunch = Math.max(0, this.cameraPunch - dt * 1.6);

        // When calm for a while, let accent drift back to the dawn-gold default.
        if (this.radiance <= this.idleFloor + 0.05 && this.timeSinceActivity > 4) {
            this._setAccent(RADIANCE_ACCENTS.default);
        }
        const k = Math.min(1, dt * 3.5);
        this.accent.r += (this._targetAccent.r - this.accent.r) * k;
        this.accent.g += (this._targetAccent.g - this.accent.g) * k;
        this.accent.b += (this._targetAccent.b - this.accent.b) * k;
    }

    /** Snapshot for consumers / debug. */
    getState() {
        return {
            radiance: this.radiance,
            warmth: this.warmth,
            act: this.act,
            actProgress: this.actProgress,
            gust: this.gust,
            gustDir: this.gustDir,
            ignite: this.ignite,
            flare: this.flare,
            sparkle: this.sparkle,
            scatter: this.scatter,
            bloomPunch: this.bloomPunch,
            chromaPunch: this.chromaPunch,
            cameraPunch: this.cameraPunch,
            accent: this.accent,
            accentHex: this.accentHex,
        };
    }

    reset() {
        this.radiance = 0;
        this.target = this.idleFloor;
        this.gust = 0;
        this.ignite = 0;
        this.flare = 0;
        this.sparkle = 0;
        this.scatter = 0;
        this.bloomPunch = 0;
        this.chromaPunch = 0;
        this.cameraPunch = 0;
        this.timeSinceActivity = 999;
        this._setAccent(RADIANCE_ACCENTS.default);
        this.accent = hexToRgb(RADIANCE_ACCENTS.default);
    }
}
