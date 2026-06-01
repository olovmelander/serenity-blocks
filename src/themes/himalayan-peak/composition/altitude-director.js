/**
 * Himalayan Peak AAA — Altitude Director
 *
 * The spine of the day→alpenglow mood arc. Tracks one master scalar
 * `intensity ∈ [0,1]` (read as "ascent"), eased from game activity and decaying
 * back to a calm dawn floor when idle. Every subsystem — sky palette, sun warmth,
 * terrain rim-light, wind/plume, birds, flags, camera, post grade — reads this to
 * drive the 3-act arc:
 *
 *   Cool Dawn → Warming → Alpenglow Ignition → (silence) → Resolution
 *
 * The Himalayan analogue of Winter's StormDirector and Electric Dreams V3's
 * fxState. Intentionally dependency-free (no three.js import) so it stays pure
 * and trivially testable; consumers build THREE.Color from the rgb accents.
 *
 * See docs/HIMALAYAN_PEAK_AAA_PLAN.md §2, §5.
 */

export const ASCENT_ACTS = {
    COOL_DAWN: 'Cool Dawn',
    WARMING: 'Warming',
    ALPENGLOW: 'Alpenglow',
    RESOLUTION: 'Resolution',
};

// Accent palette (hex) the alpenglow rim / sky / post push toward on events.
export const ASCENT_ACCENTS = {
    default: 0xffd9a0, // warm dawn gold (floor)
    single: 0xffc98a, // soft amber
    double: 0xffb878, // amber
    triple: 0xff9d68, // orange-gold
    tetris: 0xff7e6a, // rosy alpenglow flare
    combo: 0xff9d68, // orange-gold (mid combo)
    surge: 0xff6f8a, // fuchsia-rose (high combo / full ignition)
};

function hexToRgb(hex) {
    return {
        r: (Math.floor(hex / 65536) % 256) / 255,
        g: (Math.floor(hex / 256) % 256) / 255,
        b: (hex % 256) / 255,
    };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class AltitudeDirector {
    constructor(opts = {}) {
        // Master arc — what consumers read as "ascentIntensity".
        this.intensity = 0;
        this.idleFloor = opts.idleFloor ?? 0.06; // a touch of dawn warmth even idle
        this.target = this.idleFloor;

        // Easing rates (fast attack so the light "answers" the player; slow decay
        // so alpenglow lingers like real golden-hour light, not a flicker).
        this.attack = opts.attack ?? 5.5;
        this.decay = opts.decay ?? 0.4;
        this.relax = opts.relax ?? 0.18; // target → idle floor when activity stops

        // Transients (decay independently, layered on top of intensity).
        this.gust = 0; // 0..1 directional wind energy (plume + flags + spindrift)
        this.gustDir = 1; // -1 / +1
        this.ignite = 0; // 0..~1.2 alpenglow ignition flash (big clears)
        this.flare = 0; // 0..~1.2 sun lens-flare punch
        this.birdScatter = 0; // 0..1 impulse → boids scatter then re-form
        this.bloomPunch = 0;
        this.chromaPunch = 0;
        this.cameraPunch = 0; // generic intensity for camera dolly/shake

        // Accent color, eased toward target tier.
        this.accentHex = ASCENT_ACCENTS.default;
        this.accent = hexToRgb(ASCENT_ACCENTS.default);
        this._targetAccent = hexToRgb(ASCENT_ACCENTS.default);

        this.time = 0;
        this.timeSinceActivity = 999;
    }

    /** Eased mood warmth 0..1 — what the sky/grade read. Currently = intensity. */
    get warmth() {
        return this.intensity;
    }

    get act() {
        if (this.intensity <= this.idleFloor + 0.04 && this.timeSinceActivity > 5) {
            return this.timeSinceActivity > 14 ? ASCENT_ACTS.COOL_DAWN : ASCENT_ACTS.RESOLUTION;
        }
        if (this.intensity < 0.34) return ASCENT_ACTS.COOL_DAWN;
        if (this.intensity < 0.7) return ASCENT_ACTS.WARMING;
        return ASCENT_ACTS.ALPENGLOW;
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

    /** Raise the ascent. Core entry point all event pokes funnel through. */
    bump(amount = 0, opts = {}) {
        this.target = clamp01(this.target + amount);
        this.timeSinceActivity = 0;
        if (opts.gustDir !== undefined) {
            this.gust = clamp01(this.gust + (opts.gust ?? 0.6));
            this.gustDir = opts.gustDir;
        }
        if (opts.ignite) this.ignite = Math.min(1.2, this.ignite + opts.ignite);
        if (opts.flare) this.flare = Math.min(1.2, this.flare + opts.flare);
        if (opts.birdScatter) this.birdScatter = clamp01(this.birdScatter + opts.birdScatter);
        if (opts.bloom) this.bloomPunch = Math.min(1.0, this.bloomPunch + opts.bloom);
        if (opts.chroma) this.chromaPunch = Math.min(1.0, this.chromaPunch + opts.chroma);
        if (opts.camera) this.cameraPunch = Math.min(1.0, this.cameraPunch + opts.camera);
        this._setAccent(opts.accent);
    }

    // --- Game-event pokes (called from the theme's event handlers) ---

    onPieceLock() {
        // Subtle breeze + a touch of flag flutter; barely moves the arc.
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
            birdScatter: isTetris ? 0.9 : lines * 0.12,
            bloom: 0.18 + lines * 0.08,
            camera: isTetris ? 0.7 : 0.25,
            accent: ASCENT_ACCENTS[tier],
        });
    }

    onCombo(combo = 0) {
        if (combo <= 0) return;
        let accent;
        if (combo >= 7) accent = ASCENT_ACCENTS.surge;
        else if (combo >= 4) accent = ASCENT_ACCENTS.combo;
        const big = combo >= 7;
        this.bump(Math.min(0.55, combo * 0.07), {
            ignite: big ? 0.7 : 0,
            flare: Math.min(0.9, combo * 0.09),
            birdScatter: big ? 0.7 : combo * 0.06,
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

    /** Game over → exhale: drive the light back to calm dawn over a few seconds. */
    onGameOver() {
        this.target = this.idleFloor;
        this.timeSinceActivity = 0;
        this.cameraPunch = Math.max(this.cameraPunch, 0.5);
    }

    update(delta = 0) {
        const dt = Math.min(0.1, Math.max(0, delta));
        this.time += dt;
        this.timeSinceActivity += dt;

        // Relax target back toward the idle dawn floor when activity stops.
        this.target += (this.idleFloor - this.target) * Math.min(1, dt * this.relax);
        this.target = Math.max(this.idleFloor, Math.min(1, this.target));

        // Ease intensity toward target: fast up, slow down (golden-hour light, not a switch).
        const rate = this.intensity < this.target ? this.attack : this.decay;
        this.intensity += (this.target - this.intensity) * Math.min(1, dt * rate);
        this.intensity = clamp01(this.intensity);

        // Decay transients.
        this.gust = Math.max(0, this.gust - dt * 0.7);
        this.ignite = Math.max(0, this.ignite - dt * 1.1);
        this.flare = Math.max(0, this.flare - dt * 0.9);
        this.birdScatter = Math.max(0, this.birdScatter - dt * 0.6);
        this.bloomPunch = Math.max(0, this.bloomPunch - dt * 1.4);
        this.chromaPunch = Math.max(0, this.chromaPunch - dt * 2.0);
        this.cameraPunch = Math.max(0, this.cameraPunch - dt * 1.6);

        // When calm for a while, let accent drift back to the dawn-gold default.
        if (this.intensity <= this.idleFloor + 0.05 && this.timeSinceActivity > 4) {
            this._setAccent(ASCENT_ACCENTS.default);
        }
        const k = Math.min(1, dt * 3.5);
        this.accent.r += (this._targetAccent.r - this.accent.r) * k;
        this.accent.g += (this._targetAccent.g - this.accent.g) * k;
        this.accent.b += (this._targetAccent.b - this.accent.b) * k;
    }

    /** Snapshot for consumers / debug. */
    getState() {
        return {
            intensity: this.intensity,
            warmth: this.warmth,
            act: this.act,
            actProgress: this.actProgress,
            gust: this.gust,
            gustDir: this.gustDir,
            ignite: this.ignite,
            flare: this.flare,
            birdScatter: this.birdScatter,
            bloomPunch: this.bloomPunch,
            chromaPunch: this.chromaPunch,
            cameraPunch: this.cameraPunch,
            accent: this.accent,
            accentHex: this.accentHex,
        };
    }

    reset() {
        this.intensity = 0;
        this.target = this.idleFloor;
        this.gust = 0;
        this.ignite = 0;
        this.flare = 0;
        this.birdScatter = 0;
        this.bloomPunch = 0;
        this.chromaPunch = 0;
        this.cameraPunch = 0;
        this.timeSinceActivity = 999;
        this._setAccent(ASCENT_ACCENTS.default);
        this.accent = hexToRgb(ASCENT_ACCENTS.default);
    }
}
