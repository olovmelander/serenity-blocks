/**
 * @fileoverview Shared Effects Module for Phaser 4 — every board's event effects
 * (single player, Infinity, local and online versus all draw boards with BoardScene,
 * which owns one of these).
 *
 * The language (docs/MENU_UI_OVERHAUL_2026-10.md §5.8): light, weight, grace.
 * - Light, never paint: additive light from soft textures (fx/fx-kit.js) in the
 *   piece's colour or the event's tone — no opaque or full-board fills, no camera
 *   flashes.
 * - No vertical lines: speed is a short smear and sparks at the landing, never a
 *   beam down the well.
 * - Grounded: every effect starts where its event happened (the contact edge, the
 *   cleared rows, the roof, the floor) and escalates with the event (lines, combo,
 *   chain depth) in the same vocabulary.
 * - Keystone callouts: Unbounded words with a Manrope kicker, cream with a tone glow
 *   and a light underline; tones are cream (impact), gold (achievement), aqua
 *   (chains), lavender (spin, level), coral (danger, loss).
 * - The big moments (knock-out, round and match won) live in fx/fx-moments.js.
 * Scenes that cannot make textures or images (headless tests) keep the effects'
 * timing and budgets and skip the light.
 */

import {
    createParticleEmitter,
    emitParticles,
    destroyParticleEmitter,
} from './utils/particle-compat.js';
import { ensureSquareTexture, ensureStreakTexture } from './utils/graphics.js';
import {
    FX, TONE, addLight, destroyOnComplete, ensureFxTextures, lightBlend, mixColor, toColorInt, toneCss,
} from './fx/fx-kit.js';
import {
    playKnockoutFx, playRoundWinFx, playVictoryFx, restoreKnockoutFx,
} from './fx/fx-moments.js';
import { wellGarbageColor } from './well-board-style.js';

// Constants
const RIPPLE_PARTICLE_LIFESPAN = 650;

// Density of the embers that rise off a line clear.
//
// They used to be the ONLY thing selling a clear, so they were tuned loud: a quad
// emitted ~630 additive particles (18 x lineCount x 2.2 per row, x4 rows) and read
// as a wall of colour. They share the moment with the row light, the debris and
// the landing, and only support it.
const FOUNTAIN_DENSITY = 0.22;

const randIn = (min, max) => min + Math.random() * (max - min);

// Keystone type for the board's words (public/styles/fonts.css).
const DISPLAY_FONT = '"Unbounded", "Orbitron", "Segoe UI", sans-serif';
const TEXT_FONT = '"Manrope", "Segoe UI", sans-serif';
const CREAM_CSS = '#fff6e9';

// Cleared-cell debris. Square, because in a block game the block IS the shard.
const SHARD_TEXTURE_KEY = 'line-clear-shard';
const SHARD_TEXTURE_SIZE = 12;

// The shipped default for pieceLockRippleColor. Treated as "match the piece"
// rather than as a literal colour, so wiring the setting up preserves the look.
const LOCK_RIPPLE_MATCH_PIECE = '#64c8ff';

// Directional spark. Points along +X so a particle's `rotate` maps straight onto
// Phaser's angle convention and can be aligned to its direction of travel.
const SPARK_TEXTURE_KEY = 'fx-spark';
const SPARK_LENGTH = 20;
const SPARK_THICKNESS = 4;
const SHARD_LIFESPAN = 720;
const SHARDS_PER_CELL = 2;
// One callout per word in this window: a cascade can clear four rows wave after wave.
const CALLOUT_REPEAT_MS = 1200;
// A top-out plays out before the results arrive over it (playGameOver returns it).
const GAME_OVER_BEAT_MS = 760;
const GAME_OVER_BEAT_REDUCED_MS = 320;
// Mega cascades can clear 20+ rows at once; cap the debris so a chain does not
// turn into a particle storm. Cells are sampled, never silently truncated.
const SHARD_CELL_BUDGET = 60;

/**
 * Lightweight debug logger for shared effects. Enable via
 * `window.__SHARED_EFFECTS_DEBUG__ = true` in devtools when needed.
 */
const sharedEffectsDebugEnabled = () => (
    typeof window !== 'undefined' && Boolean(window.__SHARED_EFFECTS_DEBUG__)
);

const debugLog = (...args) => {
    if (sharedEffectsDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.log(...args);
    }
};

/**
 * SharedEffects class - manages all visual effects for a Phaser scene
 *
 * This class is designed to be instantiated by any Phaser scene that wants
 * to use effects (single-player, multiplayer, etc.)
 */
export class SharedEffects {
    /**
     * Create a new SharedEffects instance
     * @param {Phaser.Scene} scene - The Phaser scene that will host these effects
     */
    constructor(scene) {
        this.scene = scene;

        // State tracking
        this.activeParticleSystems = new Set();
        this.lineClearParticleKey = 'line-clear-particle';
        this.lastImpactIntensity = 0;
        this.currentComboCount = 0;

        // Hit-stop (impact freeze) guard so overlapping big clears don't stack freezes
        this._hitStopActive = false;
        this._hitStopTimer = null;
        this._hitStopRestore = null;

        // PERFORMANCE: Track graphics objects and text objects for proper cleanup
        // Prevents accumulation of orphaned display objects
        this.activeGraphics = [];
        this.activeTextObjects = [];
        this.maxGraphicsObjects = 25; // Limit concurrent graphics objects
        this.maxTextObjects = 15; // Limit concurrent text objects

        // PERFORMANCE: Track timers for cleanup
        this.activeTimers = [];

        // When each callout word last showed (one per CALLOUT_REPEAT_MS), and the
        // colour filter a knock-out leaves on the camera until the next round.
        this._calloutAt = new Map();
        this._knockoutFilter = null;

        // The current wave's depth in its cascade (1 = the lock's own clear). The
        // impact records it and the flash and embers right after it read it.
        this._waveDepth = 1;

        debugLog('[SharedEffects] Initialized for scene:', scene.scene?.key || 'unknown');
    }

    /** True when the scene can draw the kit's light (its textures and images). */
    _lit() {
        return typeof this.scene?.add?.image === 'function' && ensureFxTextures(this.scene);
    }

    _isInfinity() {
        return Boolean(this.scene?.gameState?.isInfinityMode);
    }

    /** Top of a board row in this scene's space (Infinity draws in world space). */
    _rowTop(row) {
        return (this._isInfinity() ? row : row - this.scene.hiddenRows) * this.scene.blockSize;
    }

    /** Scroll factor for effects anchored to the board: world space in Infinity. */
    _scroll() {
        return this._isInfinity() ? 1 : 0;
    }

    /** The tone of a clear: cream for small ones, warming to gold for a quad. */
    _clearTone(lineCount) {
        if (lineCount >= 4) return TONE.GOLD;
        if (lineCount === 3) return mixColor(TONE.CREAM, TONE.GOLD, 0.45);
        return TONE.CREAM;
    }

    /** A chain's tone: aqua, then gold, coral, and a hot pink at 10 and up. */
    _comboTone(count) {
        if (count >= 10) return TONE.DANGER;
        if (count >= 7) return TONE.CORAL;
        if (count >= 4) return TONE.GOLD;
        return TONE.AQUA;
    }

    /**
     * The chain a clear belongs to: a cascade's depth while one is running (the
     * waves of one lock), else the consecutive-clear combo. 0/1 = no chain.
     */
    _chainCount() {
        return this._waveDepth >= 2 ? this._waveDepth : this.currentComboCount;
    }

    /** How much a cascade's depth lifts a wave: 1 for the first, up to 1.6. */
    _depthLift() {
        return 1 + 0.1 * Math.min(Math.max(this._waveDepth - 1, 0), 6);
    }

    /**
     * Resolve the correct color for a piece, honoring theme-based tetrominos
     * @param {Object} piece - Piece reference
     * @param {string} fallback - Optional fallback color
     * @returns {string} Hex color string (e.g. '#00ffaa')
     */
    getPieceColor(piece, fallback = '#ffffff') {
        if (!piece) {
            return fallback;
        }

        const baseColor = typeof piece.color === 'string' ? piece.color : fallback;

        if (typeof this.scene?.getThemedColor === 'function' && (piece.type || piece.shapeKey)) {
            const themed = this.scene.getThemedColor(piece.type || piece.shapeKey, baseColor);
            if (typeof themed === 'string') {
                return themed;
            }
        }

        return baseColor || fallback;
    }

    /**
     * Resolve a line-clear "tier" from the number of lines cleared in one drop.
     * Drives an escalating crescendo: a single clears cleanly, a quad (Tetris)
     * gets a white-hot flash, big shake, full-screen pop and a hit-stop.
     * @param {number} lineCount - Lines cleared simultaneously (this cascade stage)
     * @returns {{name:string, flashAlpha:number, whiteCore:boolean, fullscreen:boolean, shake:number, shakeDur:number, particleBoost:number, hitStop:number}}
     */
    getClearTier(lineCount) {
        const n = Math.max(1, lineCount || 1);
        if (n >= 4) {
            return {
                name: 'quad', flashAlpha: 0.9, whiteCore: true, fullscreen: true, shake: 4.2, shakeDur: 320, particleBoost: 2.2, hitStop: 70,
            };
        }
        if (n === 3) {
            return {
                name: 'triple', flashAlpha: 0.7, whiteCore: true, fullscreen: false, shake: 2.4, shakeDur: 220, particleBoost: 1.7, hitStop: 0,
            };
        }
        if (n === 2) {
            return {
                name: 'double', flashAlpha: 0.58, whiteCore: false, fullscreen: false, shake: 1.6, shakeDur: 170, particleBoost: 1.3, hitStop: 0,
            };
        }
        return {
            name: 'single', flashAlpha: 0.45, whiteCore: false, fullscreen: false, shake: 1.0, shakeDur: 140, particleBoost: 1.0, hitStop: 0,
        };
    }

    /**
     * Whether to soften aggressive juice (shake/freeze/full-screen flashes) for
     * accessibility. Honors an explicit game setting and the OS reduced-motion pref.
     * @returns {boolean}
     */
    _reducedMotion() {
        try {
            if (this.scene?.gameState?.settings?.reducedMotion) return true;
            if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
                return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            }
        } catch (e) {
            // matchMedia unavailable / restricted - fall through to "not reduced"
        }
        return false;
    }

    /**
     * Read a player-facing effect toggle.
     *
     * The gates live here rather than in each mode's physics callbacks for two
     * reasons: every caller (5 game modes plus the legacy main.js path) gets them
     * for free — previously only main.js honoured lineClearEffects/pieceLockRipple,
     * so both toggles were dead in real play — and the callbacks stay free of live
     * settings reads, which the fixed-tick determinism guards depend on.
     *
     * Defaults to enabled when no settings source is reachable (headless tests,
     * capture harnesses) so effects never silently vanish.
     *
     * @param {string} key
     * @returns {boolean}
     * @private
     */
    _effectEnabled(key) {
        const settings = this._settings();
        if (settings && key in settings) return Boolean(settings[key]);
        return true;
    }

    /**
     * Live settings object, or null when none is reachable.
     * @returns {Object|null}
     * @private
     */
    _settings() {
        try {
            return (typeof window !== 'undefined' && window.settingsManager?.get?.())
                || this.scene?.gameState?.settings
                || null;
        } catch (e) {
            return null; // torn down / restricted
        }
    }

    /**
     * Colour for the lock ripple.
     *
     * `pieceLockRippleColor` has been a setting with no effect: it is persisted
     * and cloud-synced, and written into CSS variables that nothing reads. It also
     * has NO UI control — index.html only exposes the on/off toggle. Honour it
     * here so the value is real if a picker is ever added, while treating the
     * shipped default as "match the piece", which is the current look.
     *
     * @param {Object} piece
     * @returns {string} '#rrggbb'
     * @private
     */
    _lockRippleColor(piece) {
        const chosen = this._settings()?.pieceLockRippleColor;
        if (typeof chosen === 'string'
            && /^#[0-9a-f]{6}$/i.test(chosen)
            && chosen.toLowerCase() !== LOCK_RIPPLE_MATCH_PIECE) {
            return chosen;
        }
        return this.getPieceColor(piece, '#ffffff');
    }

    /**
     * Impact freeze ("hit-stop"): briefly halts the scene clock + tweens so a big
     * hit reads as a punch. Phaser timers are frozen during the stop, so the
     * restore MUST run on the real wall-clock via setTimeout.
     * @param {number} [durationMs=50]
     */
    triggerHitStop(durationMs = 50) {
        if (this._hitStopActive) return;
        if (this._reducedMotion()) return;

        const { scene } = this;
        if (!scene || !scene.tweens || !scene.time) return;

        const timeClock = scene.time;
        const tweenMgr = scene.tweens;
        if (typeof timeClock.timeScale !== 'number' || typeof tweenMgr.timeScale !== 'number') {
            return; // Phaser build doesn't expose timeScale - skip gracefully
        }

        const prevTime = timeClock.timeScale;
        const prevTween = tweenMgr.timeScale;

        this._hitStopActive = true;
        const restore = () => {
            if (this._hitStopRestore !== restore) return;
            this._hitStopActive = false;
            this._hitStopRestore = null;
            this._hitStopTimer = null;
            // Restore captured owners, even if a restarted scene replaced them.
            try { timeClock.timeScale = prevTime; } catch (e) { /* owner disposed */ }
            try { tweenMgr.timeScale = prevTween; } catch (e) { /* owner disposed */ }
        };
        this._hitStopRestore = restore;
        try {
            timeClock.timeScale = 0.0001;
            tweenMgr.timeScale = 0.0001;
        } catch (e) {
            restore();
            return;
        }

        // Real-clock restore: scene timers are frozen, so delayedCall can't fire here.
        this._hitStopTimer = setTimeout(restore, Math.max(16, durationMs));
    }

    /**
     * Zoom punch — a fast camera kick that snaps back.
     *
     * The screen-space partner to the shake: shake says "something rattled", a
     * zoom kick says "the screen took the hit". Together they carry impacts that
     * a shake alone leaves flat.
     *
     * NOT paired with a hit-stop on the smaller beats, deliberately. This class's
     * triggerHitStop() only freezes scene timers and tweens; the freeze reads as
     * an impact ONLY because the modes pause the simulation at the same instant
     * via gameState.hitStopRemaining, which they derive from getClearTier().hitStop.
     * Freezing the effect layer on its own would just stutter the animation while
     * the board kept moving. Extending micro-stops to triples/T-spins therefore
     * means changing gameplay timing, which is a game-feel decision rather than a
     * visual one — so it is left alone here.
     *
     * @param {number} [amount=0.015] - Peak zoom, as a fraction above resting.
     * @param {number} [duration=130] - Snap-back time in ms.
     */
    _zoomPunch(amount = 0.015, duration = 130) {
        if (this._reducedMotion()) return;
        const cam = this.scene?.cameras?.main;
        if (!cam || typeof cam.zoom !== 'number') return;
        // Overlapping punches must not compound, and must not capture an already
        // punched zoom as the resting value.
        if (this._zoomPunchActive) return;

        const base = cam.zoom;
        this._zoomPunchBase = base;
        this._zoomPunchActive = true;
        cam.zoom = base * (1 + amount);

        this.scene.tweens.add({
            targets: cam,
            zoom: base,
            duration,
            ease: 'Quint.easeOut',
            onComplete: () => {
                cam.zoom = base;
                this._zoomPunchActive = false;
                this._zoomPunchBase = null;
            },
        });
    }

    /**
     * Full-screen additive flash that holds at peak then fades. The hold pairs
     * naturally with a hit-stop (the freeze holds the bright frame).
     * @param {number} [color=0xffffff]
     * @param {number} [peakAlpha=0.5]
     * @param {number} [holdMs=40]
     * @param {number} [fadeMs=240]
     * @param {number} [depth=50]
     */
    _screenFlash(color = 0xffffff, peakAlpha = 0.5, holdMs = 40, fadeMs = 240, depth = 50, originY = null) {
        const width = this.scene.cols * this.scene.blockSize;
        const height = this.scene.rows * this.scene.blockSize;
        if (this._lit()) {
            // A soft bloom from where it happened, not a flat sheet over the board.
            const bloom = addLight(this.scene, FX.GLOW, width / 2, Number.isFinite(originY) ? originY : height / 2, {
                tint: color, width: width * 2, height: height * 1.25, alpha: peakAlpha * 0.7, depth,
            });
            if (bloom) {
                this.scene.tweens.add({
                    targets: bloom,
                    alpha: 0,
                    delay: holdMs,
                    duration: fadeMs,
                    ease: 'Expo.easeOut',
                    onComplete: destroyOnComplete(bloom),
                });
                return;
            }
        }
        if (!this.scene?.add?.rectangle) return;
        const PhaserRef = window.Phaser;

        const flash = this.scene.add.rectangle(width / 2, height / 2, width, height, color, peakAlpha);
        flash.setScrollFactor(0);
        flash.setDepth(depth);
        if (flash.setBlendMode && PhaserRef?.BlendModes?.ADD) {
            flash.setBlendMode(lightBlend(this.scene));
        }

        // Self-destructs via tween (not tracked, mirrors the ripple pattern).
        this.scene.tweens.add({
            targets: flash,
            alpha: 0,
            delay: holdMs,
            duration: fadeMs,
            ease: 'Expo.easeOut', // impact decay: sharp drop, long tail
            onComplete: () => flash.destroy(),
        });
    }

    /**
     * Brief glowing border pulse around the playfield - used to register cascade
     * energy without adding center-screen text clutter.
     * @param {number} [color=0xffffff]
     * @param {number} [alpha=0.4]
     */
    _boardEdgePulse(color = 0xffffff, alpha = 0.4) {
        const width = this.scene.cols * this.scene.blockSize;
        const height = this.scene.rows * this.scene.blockSize;
        if (this._lit()) {
            // The walls and floor light from inside the well: a wide, faint haze up
            // the walls (a narrow one reads as a line down the board) and a brighter floor.
            const bs = this.scene.blockSize;
            const glows = [
                [0, height / 2, bs * 2.8, height * 1.08, 0.55],
                [width, height / 2, bs * 2.8, height * 1.08, 0.55],
                [width / 2, height, width * 1.1, bs * 1.6, 0.9],
            ].map(([x, y, w, h, k]) => addLight(this.scene, FX.GLOW, x, y, {
                tint: color, width: w, height: h, alpha: alpha * k, depth: 9,
            })).filter(Boolean);
            glows.forEach((glow) => this.scene.tweens.add({
                targets: glow, alpha: 0, duration: 460, ease: 'Expo.easeOut', onComplete: destroyOnComplete(glow),
            }));
            if (glows.length) return;
        }
        if (!this.scene?.add?.graphics) return;
        const PhaserRef = window.Phaser;

        const g = this.scene.add.graphics();
        g.setScrollFactor(0);
        g.setDepth(9);
        if (g.setBlendMode && PhaserRef?.BlendModes?.ADD) {
            g.setBlendMode(lightBlend(this.scene));
        }

        const data = { alpha, thickness: 6 };
        this.scene.tweens.add({
            targets: data,
            alpha: 0,
            thickness: 1,
            duration: 260,
            ease: 'Expo.easeOut', // impact decay
            onUpdate: () => {
                g.clear();
                g.lineStyle(data.thickness, color, data.alpha);
                g.strokeRect(0, 0, width, height);
            },
            onComplete: () => g.destroy(),
        });
    }

    /**
     * Trigger line clear flash effect
     * @param {Array<number>} clearedRows - Array of row indices that were cleared
     */
    triggerLineClearFlash(clearedRows) {
        if (!clearedRows || clearedRows.length === 0) return;
        if (!this._effectEnabled('lineClearEffects')) return;

        const PhaserRef = window.Phaser;
        const bs = this.scene.blockSize;
        const width = this.scene.cols * bs;
        const isInfinityMode = this._isInfinity();
        const tier = this.getClearTier(clearedRows.length);
        const count = clearedRows.length;
        // Rows on screen, the lowest first.
        const visible = (isInfinityMode ? clearedRows : clearedRows.filter((r) => r >= this.scene.hiddenRows))
            .slice().sort((a, b) => b - a);
        const tone = this._clearTone(count);
        // Wave after wave a cascade's light takes more of the chain's tone and
        // holds longer, its cut grows, and from the third wave it blooms.
        const depth = this._waveDepth;
        const chainCount = this._chainCount();
        const chain = chainCount >= 2 ? this._comboTone(chainCount) : null;
        const bandTint = chain ? mixColor(tone, chain, depth >= 2 ? Math.min(0.4 + 0.05 * (depth - 2), 0.65) : 0.45) : tone;
        const lift = this._depthLift();

        if (this._lit()) {
            // The cleared rows turn to light the instant they clear (not on a ramp:
            // a tween can start a frame late, after the rows are gone): one even slab
            // per run of adjacent rows, so a quad is one block of light rather than
            // four stripes. It holds, then blooms away; a bright cut runs across it.
            const peak = Math.min(1, 0.78 + 0.06 * Math.min(count, 4));
            const blocks = [];
            visible.forEach((row) => {
                const block = blocks[blocks.length - 1];
                if (block && block.top === row + 1) block.top = row;
                else blocks.push({ top: row, bottom: row });
            });
            blocks.slice(0, 12).forEach(({ top, bottom }, i) => {
                const rows = bottom - top + 1;
                const y = this._rowTop(top) + (rows * bs) / 2;
                const slab = addLight(this.scene, FX.SLAB, width / 2, y, {
                    tint: bandTint, width: width * 1.02, height: (rows * bs) / 0.7, alpha: peak, depth: 7, scroll: this._scroll(),
                });
                if (slab) {
                    this.scene.tweens.add({
                        targets: slab,
                        alpha: 0,
                        scaleY: slab.scaleY * (1 + 0.5 / rows),
                        delay: 120 + 25 * Math.min(depth - 1, 6) + i * 40,
                        duration: 300,
                        ease: 'Sine.easeOut',
                        onComplete: destroyOnComplete(slab),
                    });
                }
                const blade = addLight(this.scene, FX.FLARE, width / 2, y, {
                    tint: mixColor(bandTint, TONE.CREAM, 0.6),
                    width: width * 1.2,
                    height: bs * (0.5 + 0.18 * Math.min(rows, 4)) * lift,
                    alpha: 1,
                    depth: 8,
                    scroll: this._scroll(),
                });
                if (blade) {
                    this.scene.tweens.add({
                        targets: blade,
                        alpha: 0,
                        scaleX: blade.scaleX * 1.12,
                        scaleY: blade.scaleY * 0.5,
                        delay: 90 + i * 40,
                        duration: 240,
                        ease: 'Quad.easeIn',
                        onComplete: destroyOnComplete(blade),
                    });
                }
            });
        } else if (PhaserRef?.GameObjects && this.scene.add?.rectangle) {
            visible.forEach((row, index) => {
                const centerY = this._rowTop(row) + bs / 2;
                const stripe = this.scene.add.rectangle(width / 2, centerY, width, bs, bandTint, tier.flashAlpha);
                stripe.setScrollFactor?.(this._scroll());
                stripe.setBlendMode?.(lightBlend(this.scene));
                this.scene.tweens.add({
                    targets: stripe,
                    alpha: { from: Math.min(tier.flashAlpha + 0.1, 1), to: 0 },
                    scaleY: { from: 1, to: 0.3 },
                    duration: 260 + index * 40,
                    ease: 'Expo.easeOut',
                    delay: index * 40,
                    onComplete: () => stripe.destroy(),
                });
            });
        }

        // Remember where the clear HAPPENED (on screen), so the reactions to it can
        // radiate from there instead of from the middle of the board.
        if (visible.length) {
            const mean = visible.reduce((a, b) => a + b, 0) / visible.length;
            const scrollY = isInfinityMode ? (this.scene.cameras?.main?.scrollY || 0) : 0;
            this._clearOriginY = this._rowTop(mean) + bs / 2 - scrollY;
        }

        // A quad blooms warm from where it happened, a cascade's third wave and on
        // in the chain's tone; nothing smaller lights the frame.
        if (tier.fullscreen) {
            this._screenFlash(TONE.GOLD, this._reducedMotion() ? 0.22 : 0.4, 40, 460, 6, this._clearOriginY);
        } else if (depth >= 3 && chain) {
            const bloom = Math.min(0.16 + 0.03 * (depth - 3), 0.32) * (this._reducedMotion() ? 0.6 : 1);
            this._screenFlash(chain, bloom, 30, 380, 6, this._clearOriginY);
        }

        // Debris FIRST: it must read the cells while the rows are still on the
        // grid (the pinned schedule clears them after this callback's flash hold).
        this.spawnLineClearShards(clearedRows);
        this.spawnLineClearParticles(clearedRows);
    }

    /**
     * Vertical anchor for effects that react to a line clear.
     *
     * A cascade resolving at the bottom of the well used to pulse from mid-board,
     * which reads as an unrelated screen effect rather than a consequence of what
     * just happened. Falls back to board centre when there is no recent clear
     * (e.g. an effect fired directly).
     *
     * @returns {number} screen-space Y
     * @private
     */
    _effectOriginY() {
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const y = this._clearOriginY;
        if (!Number.isFinite(y)) return boardHeight / 2;
        // Keep it inside the playfield so a clear near an edge cannot throw the
        // effect off-screen.
        return Math.min(Math.max(y, boardHeight * 0.12), boardHeight * 0.88);
    }

    /**
     * Create piece lock ripple effect
     * @param {Object} piece - The locked piece
     */
    createPieceLockRipple(piece) {
        if (!piece) return;
        if (!this._effectEnabled('pieceLockRipple')) return;
        // Quality tiers declare `ripples: false` at Low/Minimal. Nothing read that
        // until now, so those tiers kept drawing ripples anyway — the one effect
        // the flag covers that isn't already gated by the `particles` boolean.
        if (this.getQualityConfig()?.effectsEnabled?.ripples === false) return;

        const isInfinityMode = Boolean(this.scene.gameState?.isInfinityMode);

        // Calculate center of piece
        let centerX = 0;
        let centerY = 0;
        let blockCount = 0;

        piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    centerX += (piece.x + x) * this.scene.blockSize + this.scene.blockSize / 2;

                    // In infinity mode, use world coordinates; in standard mode, use screen coordinates
                    if (isInfinityMode) {
                        // World coordinates: piece.y * blockSize (will follow camera)
                        centerY += (piece.y + y) * this.scene.blockSize + this.scene.blockSize / 2;
                    } else {
                        // Screen coordinates: (piece.y - hiddenRows) * blockSize
                        const screenRow = (piece.y + y) - this.scene.hiddenRows;
                        centerY += screenRow * this.scene.blockSize + this.scene.blockSize / 2;
                    }
                    blockCount++;
                }
            });
        });

        if (blockCount > 0) {
            centerX /= blockCount;
            centerY /= blockCount;

            debugLog('[SharedEffects] Piece lock ripple:', {
                mode: isInfinityMode ? 'infinity' : 'standard',
                pieceGridY: piece.y,
                hiddenRows: this.scene.hiddenRows,
                centerX,
                centerY,
                blockSize: this.scene.blockSize,
            });

            const rippleHex = this._lockRippleColor(piece);
            const colorInt = parseInt(rippleHex.replace('#', ''), 16) || 0xffffff;

            // Stamp the piece's OWN silhouette, not just a generic ping. A circle
            // from the centroid makes an I-bar and an O-block read identically;
            // the stamp says "this shape landed here". Kept very quiet on purpose:
            // this fires on every lock, dozens of times a minute, so anything
            // showy here would wear thin and flatten the contrast with clears.
            this._playLockStamp(piece, colorInt, isInfinityMode);
        }
    }

    /**
     * Set the combo level that drives particle tints and intensity multipliers.
     *
     * This is deliberately separate from showComboPopup(): the popup is optional
     * (settings.comboPopupEffect) and only appears from 2x upward, whereas the
     * tint/multiplier state must track every clear — including the reset back to
     * 0 when a chain breaks. Wiring them together left currentComboCount pinned
     * at the last announced value for the rest of the run, permanently inflating
     * particle speed/scale/lifespan/count and rainbow-tinting ordinary clears.
     *
     * @param {number} comboCount - Current consecutive-clear combo (0 = no chain).
     */
    setComboCount(comboCount) {
        const next = Number(comboCount);
        this.currentComboCount = Number.isFinite(next) && next > 0 ? next : 0;
    }

    /**
     * Visual identity for a combo tier.
     *
     * Escalation goes MORE saturated and MORE white-hot rather than through more
     * hues — a rainbow reads as confetti (a reward), a white-hot core reads as
     * force (a display of power), which is what a combo is.
     *
     * @param {number} comboCount
     * @returns {{numberSize:number, labelSize:number, fill:string, stroke:string,
     *   accent:number, bandAlpha:number, shake:number}}
     * @private
     */
    /**
     * Brief flash of the locked piece's own silhouette.
     *
     * Drawn cell-by-cell around the piece centroid so the graphic can be scaled
     * from its middle, then faded fast. Peak alpha is deliberately low — this is
     * the single most frequent effect in the game, so anything showy would wear
     * thin and flatten the contrast with a line clear.
     *
     * @param {Object} piece
     * @param {number} colorInt
     * @param {boolean} isInfinityMode
     * @private
     */
    _playLockStamp(piece, colorInt, isInfinityMode) {
        if (this._reducedMotion()) return;
        if (!this.scene?.add?.graphics) return;

        const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
        const bs = this.scene.blockSize;

        const cells = [];
        piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) cells.push({ x: piece.x + x, y: piece.y + y });
            });
        });
        if (!cells.length) return;

        const originRow = (r) => (isInfinityMode ? r : r - this.scene.hiddenRows);
        const cx = (cells.reduce((a, c) => a + c.x, 0) / cells.length) * bs + bs / 2;
        const cy = (cells.reduce((a, c) => a + originRow(c.y), 0) / cells.length) * bs + bs / 2;

        const g = this.scene.add.graphics();
        g.setScrollFactor?.(isInfinityMode ? 1 : 0);
        g.setDepth?.(9);
        if (g.setBlendMode && PhaserRef?.BlendModes?.ADD) g.setBlendMode(lightBlend(this.scene));
        g.setPosition?.(cx, cy);

        // OUTLINE, not fill. An additive fill lifts whatever is beneath it toward
        // white, and a lock always lands on the stack — so the fill version read
        // as a grey wash over the blocks rather than a stamp. A stroked perimeter
        // stays crisp over anything, and echoes the ripple's own line language.
        //
        // Only edges without a neighbouring cell are drawn, so the piece reads as
        // one fused silhouette instead of a grid of boxes.
        const occupied = new Set(cells.map((c) => `${c.x},${c.y}`));
        const has = (x, y) => occupied.has(`${x},${y}`);
        g.lineStyle(Math.max(2, Math.round(bs * 0.075)), colorInt, 1);
        g.beginPath();
        cells.forEach((c) => {
            const px = c.x * bs - cx;
            const py = originRow(c.y) * bs - cy;
            if (!has(c.x, c.y - 1)) { g.moveTo(px, py); g.lineTo(px + bs, py); }
            if (!has(c.x, c.y + 1)) { g.moveTo(px, py + bs); g.lineTo(px + bs, py + bs); }
            if (!has(c.x - 1, c.y)) { g.moveTo(px, py); g.lineTo(px, py + bs); }
            if (!has(c.x + 1, c.y)) { g.moveTo(px + bs, py); g.lineTo(px + bs, py + bs); }
        });
        g.strokePath();
        g.setAlpha?.(0.85); // an outline can carry more punch than a fill without smearing

        this.scene.tweens.add({
            targets: g,
            alpha: 0,
            scaleX: 1.12,
            scaleY: 1.12,
            duration: 170,
            ease: 'Expo.easeOut',
            onComplete: () => g.destroy(),
        });
    }

    /**
     * Top-out — the board dies.
     *
     * The roof flares coral, the stack goes dark under a tide that wipes down the
     * well with a coral seam on its edge, and its colour drains away (the camera's
     * colour filter, as a knock-out in versus). The longest freeze in the game holds
     * the first beat. No banner: the results modal carries the words a moment
     * later, and arrives over the veil, which is held rather than faded.
     *
     * @returns {number} ms the results should wait for the tide (0 when nothing played)
     */
    playGameOver() {
        if (!this.scene?.add?.graphics) return 0;

        const bs = this.scene.blockSize;
        const boardWidth = this.scene.cols * bs;
        const boardHeight = this.scene.rows * bs;
        const reduced = this._reducedMotion();

        this._screenFlash(TONE.CORAL, reduced ? 0.3 : 0.6, 60, 560, 62, 0);
        this._boardEdgePulse(TONE.CORAL, reduced ? 0.3 : 0.6);

        // The longest hit-stop in the game. A defeat should land heavier than a
        // perfect clear (110ms), which is the current maximum.
        if (!reduced) this.triggerHitStop(170);
        if (this.scene.shakeCamera) this.scene.shakeCamera(reduced ? 1.5 : 4.5, reduced ? 200 : 380);
        this._zoomPunch(reduced ? 0 : 0.02, 420);

        // The tide wipes DOWN the well and holds, a coral seam riding its edge.
        const veil = this.scene.add.graphics();
        veil.setScrollFactor?.(0);
        veil.setDepth?.(58);
        const seam = this._lit() ? addLight(this.scene, FX.BAND, boardWidth / 2, 0, {
            tint: TONE.CORAL, width: boardWidth * 1.04, height: bs * 1.7, alpha: 0.95, depth: 59,
        }) : null;
        const wipe = { h: 0 };
        this.scene.tweens.add({
            targets: wipe,
            h: boardHeight,
            duration: reduced ? 260 : 620,
            ease: 'Sine.easeIn', // gathers pace down the well, like the stack giving way
            onUpdate: () => {
                veil.clear();
                veil.fillStyle(TONE.NIGHT, 0.6);
                veil.fillRect(0, 0, boardWidth, wipe.h);
                if (seam) seam.y = wipe.h;
            },
            onComplete: () => {
                if (!seam) return;
                this.scene.tweens.add({
                    targets: seam, alpha: 0, duration: 300, onComplete: destroyOnComplete(seam),
                });
            },
        });
        this._drainColour(0.85, 0.72, 900);

        // Held, not faded — the results modal arrives over it.
        const timer = this.scene.time.delayedCall(1600, () => {
            veil.destroy();
            this._clearDrain();
        });
        this._trackTimer(timer);
        // How long the results should wait: the tide reaching the floor.
        return reduced ? GAME_OVER_BEAT_REDUCED_MS : GAME_OVER_BEAT_MS;
    }

    /**
     * Drains the board's colour with a Phaser 4 camera colour filter (game over).
     * @param {number} saturation share of colour taken (0–1)
     * @param {number} brightness what the light falls to (0–1)
     * @param {number} duration ms
     * @private
     */
    _drainColour(saturation, brightness, duration) {
        const camera = this.scene?.cameras?.main;
        if (typeof camera?.filters?.internal?.addColorMatrix !== 'function') return;
        this._clearDrain();
        let filter = null;
        try {
            filter = camera.filters.internal.addColorMatrix();
        } catch (e) {
            return;
        }
        this._drainFilter = filter;
        const drain = { t: 0 };
        this.scene.tweens.add({
            targets: drain,
            t: 1,
            duration,
            ease: 'Sine.easeInOut',
            onUpdate: () => {
                const m = filter?.colorMatrix;
                if (!m) return;
                m.saturate?.(-saturation * drain.t);
                m.brightness?.(1 - (1 - brightness) * drain.t, true);
            },
        });
    }

    /** @private */
    _clearDrain() {
        const filter = this._drainFilter;
        this._drainFilter = null;
        if (!filter) return;
        try {
            this.scene?.cameras?.main?.filters?.internal?.remove?.(filter);
        } catch (e) {
            // camera torn down
        }
    }

    /**
     * Incoming garbage — rows shoving your stack upward.
     *
     * Reads from the BOTTOM, because that is where the rows arrive from: light
     * presses up out of the floor to the height the rows reach, a coral edge rides
     * its top, the walls flush and dust kicks up from the floor.
     *
     * @param {number} [rowCount=1] - Rows inserted; scales the shove.
     */
    playGarbageArrival(rowCount = 1) {
        if (!this.scene?.add?.graphics) return;

        const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
        const bs = this.scene.blockSize;
        const boardWidth = this.scene.cols * bs;
        const boardHeight = this.scene.rows * bs;
        const reduced = this._reducedMotion();
        const rows = Math.max(1, Math.min(rowCount, 6));
        const power = 1 + (rows - 1) * 0.3;
        const lit = this._lit();
        const heave = mixColor(TONE.CORAL, TONE.SLATE, 0.3);

        const data = { alpha: reduced ? 0.35 : 0.8, height: bs * rows };
        const rise = lit ? addLight(this.scene, FX.RISE, boardWidth / 2, boardHeight, {
            tint: heave, width: boardWidth, height: data.height * 1.4, alpha: 0, originY: 1, depth: 7,
        }) : null;
        const edge = lit ? addLight(this.scene, FX.FLARE, boardWidth / 2, boardHeight - data.height, {
            tint: mixColor(TONE.CORAL, TONE.CREAM, 0.35), width: boardWidth * 1.2, height: bs * 0.6, alpha: 0, depth: 8,
        }) : null;
        // Without the kit's light, a plain rail does the same job.
        const rail = lit ? null : this.scene.add.graphics();
        rail?.setScrollFactor?.(0);
        rail?.setDepth?.(7);
        if (rail?.setBlendMode && PhaserRef?.BlendModes?.ADD) rail.setBlendMode(lightBlend(this.scene));
        this.scene.tweens.add({
            targets: data,
            alpha: 0,
            height: bs * rows * 1.6,
            duration: 380,
            ease: 'Expo.easeOut',
            onUpdate: () => {
                if (rise) {
                    rise.setAlpha?.(data.alpha * 0.75);
                    rise.setDisplaySize?.(boardWidth, data.height * 1.4);
                }
                if (edge) {
                    edge.setAlpha?.(data.alpha);
                    edge.y = boardHeight - data.height;
                }
                if (rail) {
                    rail.clear();
                    rail.fillStyle(heave, data.alpha * 0.5);
                    rail.fillRect(0, boardHeight - data.height, boardWidth, data.height);
                    rail.fillStyle(TONE.CORAL, data.alpha);
                    rail.fillRect(0, boardHeight - data.height - 3, boardWidth, 3);
                }
            },
            onComplete: () => {
                rise?.destroy?.();
                edge?.destroy?.();
                rail?.destroy?.();
            },
        });

        // Dust forced upward out of the floor as the rows shove in: motes, not streaks.
        if (this.getQualityConfig()?.particles) {
            const key = lit ? FX.EMBER : this.lineClearParticleKey;
            const emitter = createParticleEmitter(this.scene, 0, boardHeight, key, {
                emitZone: PhaserRef?.Geom?.Rectangle
                    ? { type: 'random', source: new PhaserRef.Geom.Rectangle(0, -4, boardWidth, 6) }
                    : undefined,
                speed: { min: 60 * power, max: 200 * power },
                angle: { min: -150, max: -30 },
                gravityY: 520,
                lifespan: { min: 280, max: 560 },
                quantity: 0,
                alpha: { start: 0.9, end: 0 },
                scale: { start: (bs / 40) * 0.55, end: 0 },
                blendMode: lightBlend(this.scene),
                emitting: false,
                tint: [heave, TONE.CORAL, TONE.CREAM],
            });
            if (emitter) {
                emitter.setDepth?.(6);
                emitter.setScrollFactor?.(0);
                if (emitParticles(emitter, Math.round((reduced ? 8 : 20) * power))) {
                    const timer = this.scene.time.delayedCall(700, () => {
                        destroyParticleEmitter(emitter);
                        this.activeParticleSystems.delete(emitter);
                    });
                    this._trackTimer(timer);
                    this.activeParticleSystems.add(emitter);
                } else {
                    destroyParticleEmitter(emitter);
                }
            }
        }

        this._boardEdgePulse(TONE.CORAL, Math.min(0.18 + rows * 0.06, 0.42));
        if (this.scene.shakeCamera && !reduced) this.scene.shakeCamera(1.1 * power, 130);
    }

    /**
     * Level up — a band of light sweeps UP the well, and the level is called out.
     *
     * The band holds full strength for the first 70% of its travel and fades only
     * on the way out (an easeOut alpha made it invisible behind the stack).
     *
     * @param {number} [level=1]
     */
    playLevelUp(level = 1) {
        const bs = this.scene.blockSize;
        const boardWidth = this.scene.cols * bs;
        const boardHeight = this.scene.rows * bs;
        const reduced = this._reducedMotion();
        const band = Math.max(60, boardHeight * 0.16);
        const tone = mixColor(TONE.LAVENDER, TONE.AQUA, 0.45);
        const light = this._lit() ? addLight(this.scene, FX.BAND, boardWidth / 2, boardHeight + band * 1.5, {
            tint: tone, width: boardWidth * 1.04, height: band * 1.6, alpha: 0, depth: 8,
        }) : null;
        const sweep = light ? null : this.scene.add?.graphics?.();
        if (!light && !sweep) return;
        const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
        sweep?.setScrollFactor?.(0);
        sweep?.setDepth?.(8);
        if (sweep?.setBlendMode && PhaserRef?.BlendModes?.ADD) sweep.setBlendMode(lightBlend(this.scene));

        // Driven off ONE progress value, with alpha held rather than tweened.
        const peak = reduced ? 0.3 : 0.6;
        const travel = boardHeight + band * 2;
        const state = { t: 0 };
        this.scene.tweens.add({
            targets: state,
            t: 1,
            duration: 760,
            ease: 'Sine.easeOut',
            onUpdate: () => {
                const y = boardHeight + band - state.t * travel;
                const fade = state.t < 0.7 ? 1 : 1 - (state.t - 0.7) / 0.3;
                const a = peak * fade;
                if (light) {
                    light.y = y + band / 2;
                    light.setAlpha?.(Math.min(1, a * 1.5));
                }
                if (sweep) {
                    sweep.clear();
                    sweep.fillStyle(tone, a * 0.5);
                    sweep.fillRect(0, y, boardWidth, band);
                    sweep.fillStyle(TONE.CREAM, a);
                    sweep.fillRect(0, y + band - 4, boardWidth, 4);
                }
            },
            onComplete: () => (light || sweep).destroy?.(),
        });

        this._boardEdgePulse(tone, 0.32);
        this._zoomPunch(0.008, 200);
        this._showBanner({
            kicker: 'Level up', lead: String(level), y: boardHeight * 0.44, accent: tone, leadSize: 64, hold: 420, depth: 53,
        });
        debugLog(`[SharedEffects] Level up -> ${level}`);
    }

    /**
     * Keystone callout: snap → hold → release.
     *
     * Every word the board says uses this one shape: an optional kicker (Manrope,
     * tracked capitals in the tone), an optional oversized lead (a count), the title
     * (Unbounded, cream with a glow in the tone), an optional subtitle, a light
     * underline that wipes out from the middle, and a soft dark scrim behind so the
     * words read over any stack. Each banner has its own lane down the board.
     *
     * @param {Object} cfg
     * @param {string} [cfg.title] - Main line.
     * @param {string} [cfg.lead] - Optional oversized lead (e.g. a cascade count).
     * @param {string} [cfg.subtitle] - Optional small line under the title.
     * @param {string} [cfg.kicker] - Optional small line above.
     * @param {number} cfg.y - Screen-space vertical anchor.
     * @param {number} [cfg.accent] - The tone (0xRRGGBB).
     * @param {number} [cfg.titleSize] @param {number} [cfg.leadSize] @param {number} [cfg.subtitleSize]
     * @param {number} [cfg.hold] @param {number} [cfg.depth]
     * @returns {Object|null} the container, or null if one could not be made
     * @private
     */
    _showBanner({
        title = null,
        lead = null,
        subtitle = null,
        kicker = null,
        y,
        accent = TONE.CREAM,
        titleSize = 34,
        leadSize = 72,
        subtitleSize = 18,
        hold = 260,
        depth = 55,
    }) {
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const u = (this.scene.blockSize || 40) / 40;
        const reduced = this._reducedMotion();
        const originX = boardWidth / 2;
        const tone = toColorInt(accent);
        const glow = toneCss(tone);

        const container = this.scene.add.container?.(originX, y);
        if (!container) {
            // Stubbed scene: a plain label beats nothing at all.
            const words = [lead, title].filter(Boolean).join(' ');
            const plain = this.scene.add.text(originX, y, words, {
                fontSize: `${Math.round(titleSize * u)}px`, fontFamily: DISPLAY_FONT, color: CREAM_CSS,
            });
            plain.setOrigin(0.5);
            this._trackText(plain);
            this.scene.tweens.add({
                targets: plain, alpha: 0, delay: hold, duration: 200, onComplete: () => plain.destroy(),
            });
            return null;
        }

        container.setDepth(depth);
        container.setScrollFactor?.(0);
        this._trackGraphics(container);

        const mk = (text, size, display = true, color = CREAM_CSS) => {
            const t = this.scene.add.text(0, 0, text, {
                fontSize: `${Math.round(size * u)}px`,
                fontFamily: display ? DISPLAY_FONT : TEXT_FONT,
                fontStyle: '800',
                color,
                align: 'center',
            });
            t.setOrigin(0.5);
            if (display) t.setShadow?.(0, 0, glow, Math.round(16 * u), false, true);
            return t;
        };

        // The head is the lead when there is one, else the title.
        const head = lead ? mk(lead, leadSize) : mk(title || '', titleSize);
        const headH = head.height || (lead ? leadSize : titleSize) * 1.2 * u;
        const parts = [head];
        let top = -headH / 2;
        let bottom = headH / 2;
        if (kicker) {
            const k = mk(String(kicker).toUpperCase(), Math.max(10, titleSize * 0.36), false, glow);
            k.setLetterSpacing?.(Math.round(2.4 * u));
            k.setOrigin(0.5, 1);
            k.y = Math.round(top + 2 * u);
            top = k.y - (k.height || 12 * u);
            parts.unshift(k);
        }
        if (lead && title) {
            const caption = mk(title, titleSize);
            caption.setOrigin(0.5, 0);
            caption.y = Math.round(bottom - 6 * u);
            bottom = caption.y + (caption.height || titleSize * u) * 0.9;
            parts.push(caption);
        }
        // The underline: light that wipes out from the middle under the words.
        const widest = Math.max(...parts.map((p) => p.width || 0), titleSize * 3 * u);
        const line = this._lit() ? addLight(this.scene, FX.FLARE, 0, Math.round(bottom + 4 * u), {
            tint: tone, width: widest * 1.25, height: Math.max(6, 10 * u), alpha: 0.9, depth,
        }) : null;
        if (subtitle) {
            const sub = mk(subtitle, subtitleSize, false, 'rgba(255, 246, 233, 0.86)');
            sub.setOrigin(0.5, 0);
            sub.y = Math.round(bottom + 10 * u);
            bottom = sub.y + (sub.height || subtitleSize * u);
            parts.push(sub);
        }
        // A soft dark scrim, so the words read over any stack.
        const scrim = this._lit() ? addLight(this.scene, FX.GLOW, 0, (top + bottom) / 2, {
            tint: TONE.NIGHT, width: widest * 1.9, height: (bottom - top) * 2.1, alpha: 0.62, normal: true, depth,
        }) : null;
        if (scrim) container.add(scrim);
        parts.forEach((p) => container.add(p));
        if (line) {
            container.add(line);
            const { scaleX } = line;
            line.scaleX = 0;
            this.scene.tweens.add({
                targets: line, scaleX, delay: 30, duration: 180, ease: 'Expo.easeOut',
            });
        }

        // ─── snap → settle → HOLD → release ───
        const SNAP = 50;
        const SETTLE = 60;
        const EXIT = 120;
        container.setScale(0.86);
        container.setAlpha?.(0);
        this.scene.tweens.add({
            targets: container, scale: reduced ? 1 : 1.06, alpha: 1, duration: SNAP, ease: 'Back.easeOut',
        });
        this.scene.tweens.add({
            targets: container, scale: 1, delay: SNAP, duration: SETTLE, ease: 'Quad.easeOut',
        });
        this.scene.tweens.add({
            targets: container,
            scale: 0.9,
            alpha: 0,
            y: y - 16 * u,
            delay: SNAP + SETTLE + hold,
            duration: EXIT,
            ease: 'Quint.easeIn',
            onComplete: () => container.destroy(),
        });

        return container;
    }

    /**
     * A word the board calls out at most once per CALLOUT_REPEAT_MS.
     * @private
     */
    _calloutOnce(word, cfg) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const last = this._calloutAt.get(word);
        if (last !== undefined && now - last < CALLOUT_REPEAT_MS) return null;
        this._calloutAt.set(word, now);
        return this._showBanner(cfg);
    }

    _comboTier(comboCount) {
        if (comboCount >= 10) {
            return {
                numberSize: 82, labelSize: 17, accent: TONE.DANGER, shake: 2.2,
            };
        }
        if (comboCount >= 7) {
            return {
                numberSize: 72, labelSize: 16, accent: TONE.CORAL, shake: 1.4,
            };
        }
        if (comboCount >= 4) {
            return {
                numberSize: 64, labelSize: 15, accent: TONE.GOLD, shake: 0,
            };
        }
        return {
            numberSize: 56, labelSize: 14, accent: TONE.AQUA, shake: 0,
        };
    }

    /**
     * Combo popup — the chain's depth, called out in its tone.
     *
     * The number is the payload and leads (Unbounded, cream with a glow in the
     * chain's tone: aqua, gold, coral, then a hot pink); COMBO is a small tracked
     * caption under it. Timing is snap (50ms) → settle (60) → HOLD (270) → exit
     * (120): the hold is what makes it read as a decided hit. It sits in the upper
     * third, clear of the stack and of the centre lanes.
     *
     * @param {number} comboCount - Combo count
     */
    showComboPopup(comboCount) {
        // Deliberately does NOT touch currentComboCount. The popup number is
        // CASCADE DEPTH (fired per cascade wave), while tint/intensity state is
        // the true consecutive-clear combo owned by ComboTracker via
        // setComboCount(). When this method synced the two, a deep cascade pinned
        // the tint at its depth forever in local MP (which has no tracker reset),
        // permanently inflating particle speed/scale/count.

        if (!this._effectEnabled('comboPopupEffect')) return;

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const u = (this.scene.blockSize || 40) / 40; // scale with board size
        const reduced = this._reducedMotion();
        const tier = this._comboTier(comboCount);
        const glow = toneCss(tier.accent);

        const originX = boardWidth / 2;
        const originY = boardHeight * 0.28;

        const container = this.scene.add.container?.(originX, originY);
        if (!container) {
            // Very old/stubbed scene: fall back to a plain label rather than nothing.
            const plain = this.scene.add.text(originX, originY, `${comboCount}x COMBO`, {
                fontSize: `${Math.round(tier.numberSize * u * 0.6)}px`, fontFamily: DISPLAY_FONT, color: CREAM_CSS,
            });
            plain.setOrigin(0.5);
            this._trackText(plain);
            this.scene.tweens.add({
                targets: plain, alpha: 0, duration: 500, delay: 300, onComplete: () => plain.destroy(),
            });
            if (comboCount >= 2) this.spawnComboExplosionParticles(comboCount);
            return;
        }

        container.setDepth(12);
        container.setScrollFactor?.(0);
        this._trackGraphics(container);

        const numFont = {
            fontSize: `${Math.round(tier.numberSize * u)}px`,
            fontFamily: DISPLAY_FONT,
            fontStyle: '800',
            color: CREAM_CSS,
        };
        const number = this.scene.add.text(0, 0, String(comboCount), numFont);
        number.setOrigin(0.5);
        number.setShadow?.(0, 0, glow, Math.round(18 * u), false, true);
        const boxH = number.height || tier.numberSize * 1.2 * u;

        // An echo of the number swells out of it and dissolves (not under reduced motion).
        const echo = reduced ? null : this.scene.add.text(0, 0, String(comboCount), { ...numFont, color: glow });
        if (echo) {
            echo.setOrigin(0.5);
            echo.setAlpha(0.35);
            const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
            if (echo.setBlendMode && PhaserRef?.BlendModes?.ADD) echo.setBlendMode(lightBlend(this.scene));
        }

        // The caption sits under the glyphs (they ride high in the text box).
        const label = this.scene.add.text(0, Math.round(boxH * 0.34), 'COMBO', {
            fontSize: `${Math.round(tier.labelSize * u)}px`,
            fontFamily: TEXT_FONT,
            fontStyle: '800',
            color: glow,
        });
        label.setOrigin(0.5, 0);
        label.setLetterSpacing?.(Math.round(3 * u));

        const lit = this._lit();
        const scrim = lit ? addLight(this.scene, FX.GLOW, 0, boxH * 0.1, {
            tint: TONE.NIGHT, width: Math.max(number.width || 0, 80 * u) * 2.2, height: boxH * 1.9, alpha: 0.6, normal: true,
        }) : null;
        const line = lit ? addLight(this.scene, FX.FLARE, 0, Math.round(boxH * 0.34 + (label.height || 16 * u) + 6 * u), {
            tint: tier.accent, width: Math.max(number.width || 0, 80 * u) * 1.4, height: Math.max(6, 10 * u), alpha: 0.9,
        }) : null;
        [scrim, echo, number, label, line].filter(Boolean).forEach((part) => container.add(part));

        // ─── Timeline: snap → settle → HOLD → release ───────────────────────
        const SNAP = 50;
        const SETTLE = 60;
        const HOLD = 270;
        const EXIT = 120;
        const holdStart = SNAP + SETTLE;
        const exitStart = holdStart + HOLD;

        container.setScale(0.86);
        this.scene.tweens.add({
            targets: container,
            scale: reduced ? 1 : 1.08,
            duration: SNAP,
            ease: 'Back.easeOut',
        });
        this.scene.tweens.add({
            targets: container,
            scale: 1,
            delay: SNAP,
            duration: SETTLE,
            ease: 'Quad.easeOut',
        });
        // The hold is the point: nothing animates here, it just sits at full alpha.
        this.scene.tweens.add({
            targets: container,
            scale: 0.9,
            alpha: 0,
            y: originY - 20 * u,
            delay: exitStart,
            duration: EXIT,
            ease: 'Quint.easeIn',
            onComplete: () => container.destroy(),
        });
        if (line) {
            const { scaleX } = line;
            line.scaleX = 0;
            this.scene.tweens.add({
                targets: line, scaleX, delay: 30, duration: 180, ease: 'Expo.easeOut',
            });
        }
        if (echo) {
            this.scene.tweens.add({
                targets: echo,
                scale: 1.6,
                alpha: 0,
                delay: SNAP,
                duration: 340,
                ease: 'Cubic.easeOut',
            });
        }

        // A little weight during the hold at the high tiers only.
        if (!reduced && tier.shake > 0) {
            this.scene.tweens.add({
                targets: container,
                x: originX + tier.shake * u,
                delay: holdStart,
                duration: 40,
                yoyo: true,
                repeat: Math.floor(HOLD / 80),
                ease: 'Sine.easeInOut',
            });
        }

        if (comboCount >= 2) {
            this.spawnComboExplosionParticles(comboCount);
        }
    }

    /**
     * Play a subtle camera shake and intensify particle bursts based on line count,
     * lifted by the wave's depth when a lock cascades.
     * @param {number} lineCount - Number of lines cleared simultaneously
     * @param {number} [cascadeCount=1] - This wave's depth in its cascade (1 = the lock's own clear)
     */
    playLineClearImpact(lineCount = 1, cascadeCount = 1) {
        this._waveDepth = Math.max(1, Math.floor(Number(cascadeCount)) || 1);
        if (!this._effectEnabled('lineClearEffects')) return;
        const clampedLineCount = Math.max(1, Math.min(4, lineCount));
        const tier = this.getClearTier(lineCount);
        const reduced = this._reducedMotion();

        // Call shakeCamera on the scene (defined in base-board-scene.js).
        // The base scene's shakeCamera method already handles quality multiplier.
        // Shake magnitude + duration escalate with the clear tier; the light carries
        // the clear, so the shake only gives it weight.
        const lift = this._depthLift();
        if (this.scene.shakeCamera) {
            const magnitude = (reduced ? 0.4 : 0.8) * tier.shake * lift;
            this.scene.shakeCamera(magnitude, tier.shakeDur);
        }

        // Hit-stop punch on the biggest clears for a visceral impact.
        if (tier.hitStop && !reduced) {
            this.triggerHitStop(tier.hitStop);
        }

        // Zoom kick scaled to the clear. Unlike the hit-stop this is purely
        // visual, so every tier gets one — a single reads as a tap, a quad as a hit.
        this._zoomPunch(0.004 + (tier.shake / 4.2) * 0.014, 120 + tier.shakeDur * 0.2);

        // Four lines at once is called by its name (once, however a cascade repeats it).
        if (lineCount >= 4) {
            const boardHeight = this.scene.rows * this.scene.blockSize;
            this._calloutOnce('quad', {
                kicker: 'Four lines', title: 'Quad', y: boardHeight * 0.375, accent: TONE.GOLD, titleSize: 44, hold: 380, depth: 54,
            });
        }

        // From a cascade's third wave the well's walls glow in the chain's tone,
        // brighter each wave: the board charges up as the chain runs.
        if (this._waveDepth >= 3) {
            this._boardEdgePulse(this._comboTone(this._waveDepth), Math.min(0.34 + 0.06 * (this._waveDepth - 3), 0.62));
        }

        // Increase particle intensity for this frame, boosted by the clear tier and
        // the wave's depth.
        this.lastImpactIntensity = clampedLineCount * tier.particleBoost * lift;
    }

    /**
     * Create transient particle bursts across cleared rows
     * Uses compatibility layer for Phaser 3/4 support
     * @param {Array<number>} clearedRows - World row indices that were cleared
     */
    spawnLineClearParticles(clearedRows) {
        if (!clearedRows || clearedRows.length === 0) return;
        if (!this.getQualityConfig()?.particles) return;
        const lit = this._lit();
        const key = lit ? FX.EMBER : this.lineClearParticleKey;
        if (!this.scene.textures.exists(key)) return;

        const intensity = Math.max(1, this.lastImpactIntensity || clearedRows.length);
        // Apply combo multiplier to make effects more dramatic
        const comboMultiplier = this.currentComboCount > 0 ? (1 + (this.currentComboCount * 0.5)) : 1;
        const totalIntensity = intensity * comboMultiplier;

        const bs = this.scene.blockSize;
        const boardWidth = this.scene.cols * bs;
        const PhaserRef = window.Phaser;

        if (!PhaserRef || !PhaserRef.Geom || !PhaserRef.Geom.Rectangle) {
            console.warn('[SharedEffects] Phaser.Geom.Rectangle not available, particles disabled');
            return;
        }

        // PARTICLE BATCHING: for mega cascades (10+ lines) sample the rows and
        // raise the intensity instead of spawning for every row.
        let processedRows = clearedRows;
        let intensityBoost = 1;
        if (clearedRows.length >= 20) {
            processedRows = clearedRows.filter((_, i) => i % 3 === 0);
            intensityBoost = 2.5;
        } else if (clearedRows.length >= 10) {
            processedRows = clearedRows.filter((_, i) => i % 2 === 0);
            intensityBoost = 1.8;
        }

        const isInfinityMode = this._isInfinity();
        const tone = this._clearTone(clearedRows.length);
        const chainCount = this._chainCount();
        const chain = chainCount >= 2 ? this._comboTone(chainCount) : null;
        const tints = [tone, TONE.CREAM, chain ?? mixColor(tone, TONE.CREAM, 0.5)];

        processedRows.forEach((row) => {
            if (!isInfinityMode && row < this.scene.hiddenRows) return;
            const zoneY = this._rowTop(row);
            const finalIntensity = totalIntensity * intensityBoost;

            // Embers lift off the row and drift: soft motes, never streaks.
            const emitter = createParticleEmitter(this.scene, 0, zoneY, key, {
                emitZone: {
                    type: 'random',
                    source: new PhaserRef.Geom.Rectangle(0, 0, boardWidth, bs * 0.15),
                },
                speed: { min: 30, max: 70 + 40 * Math.min(finalIntensity, 4) },
                angle: { min: -150, max: -30 },
                gravityY: -30,
                lifespan: { min: 420, max: RIPPLE_PARTICLE_LIFESPAN + 260 },
                quantity: 0, // Required for explode
                alpha: { start: 0.95, end: 0 },
                scale: { start: (bs / 40) * (lit ? 0.7 : 0.85), end: 0 },
                blendMode: lightBlend(this.scene),
                emitting: false,
                tint: tints,
            });
            if (!emitter) return;
            emitter.setDepth?.(5);
            emitter.setScrollFactor?.(isInfinityMode ? 1 : 0);

            // Density-scaled so the embers support the light instead of burying it.
            const burstAmount = Math.max(4, Math.round(18 * finalIntensity * FOUNTAIN_DENSITY));
            if (!emitParticles(emitter, burstAmount)) {
                destroyParticleEmitter(emitter);
                return;
            }
            const timer = this.scene.time.delayedCall(RIPPLE_PARTICLE_LIFESPAN + 400, () => {
                destroyParticleEmitter(emitter);
                this.activeParticleSystems.delete(emitter);
            });
            this._trackTimer(timer);
            this.activeParticleSystems.add(emitter);
        });

        this.lastImpactIntensity = 0;
    }

    /**
     * Lazily register the spark streak and return its key.
     *
     * Falls back to the round particle if texture creation is unavailable, so a
     * stubbed/headless scene degrades instead of losing the effect entirely.
     *
     * @returns {string} texture key
     * @private
     */
    _sparkTextureKey() {
        try {
            ensureStreakTexture(this.scene, SPARK_TEXTURE_KEY, SPARK_LENGTH, SPARK_THICKNESS, 0xffffff);
            if (this.scene.textures?.exists?.(SPARK_TEXTURE_KEY)) return SPARK_TEXTURE_KEY;
        } catch (e) {
            // Texture manager unavailable — fall through to the round particle.
        }
        return this.lineClearParticleKey;
    }

    /**
     * Resolve a grid cell's on-screen colour, matching how the board draws it.
     *
     * Mirrors drawBoardFromGrid's resolveColor: named COLORS keys map through,
     * custom-coloured garbage keeps its own colour, everything else goes through
     * the theme. Shards that do not match the block they came from read as
     * unrelated confetti, which defeats the point.
     *
     * @param {{color?: string, type?: string}} cell
     * @returns {number} 0xRRGGBB
     * @private
     */
    _cellColorInt(cell) {
        let colorValue = cell?.color;
        const isGarbage = cell?.type === 'GARBAGE' || cell?.type === 'CLEAN_GARBAGE';
        const isCustomColor = cell?.color && cell.color !== '#808080';
        if (typeof this.scene?.getThemedColor === 'function' && (!isGarbage || !isCustomColor)) {
            colorValue = this.scene.getThemedColor(cell?.type, colorValue);
        }
        if (typeof this.scene?.colorToInt === 'function') {
            const int = this.scene.colorToInt(colorValue) || 0xffffff;
            return isGarbage && this.scene.wellStyle ? wellGarbageColor(int) : int;
        }
        if (typeof colorValue === 'string') {
            return parseInt(colorValue.replace('#', ''), 16) || 0xffffff;
        }
        return 0xffffff;
    }

    /**
     * Per-cell debris for a line clear.
     *
     * The stripe + upward fountain read as a lighting change: the blocks never
     * participate in their own destruction. This launches chunks FROM each cleared
     * cell, tinted with that cell's own colour, so the row visibly comes apart.
     *
     * Allocation is one emitter PER DISTINCT COLOUR (≤8 for a full board), not per
     * cell — positions come from emitParticleAt. A quad clear is ~4 emitters and
     * ~120 shards rather than 40 emitters.
     *
     * @param {Array<number>} clearedRows - World row indices being cleared
     */
    spawnLineClearShards(clearedRows) {
        if (!clearedRows || clearedRows.length === 0) return;
        if (!this.getQualityConfig()?.particles) return;
        const grid = this.scene?.gameState?.boardGrid;
        if (!grid) return;

        const lit = this._lit();
        if (!lit) ensureSquareTexture(this.scene, SHARD_TEXTURE_KEY, SHARD_TEXTURE_SIZE, 0xffffff, 1);
        const key = lit ? FX.SHARD : SHARD_TEXTURE_KEY;
        if (!this.scene.textures?.exists?.(key)) return;

        const bs = this.scene.blockSize;
        const boardWidth = this.scene.cols * bs;
        // A shard must read as a FRAGMENT OF A BLOCK: about a third of a cell.
        const shardScale = (bs / 40) * ((bs * 0.3) / SHARD_TEXTURE_SIZE);
        const isInfinityMode = this._isInfinity();
        const reduced = this._reducedMotion();
        const perCell = reduced ? 1 : SHARDS_PER_CELL;
        const speed = reduced ? 0.5 : 1;

        // Sample rows rather than truncating, so debris still spans the whole clear.
        const stride = Math.max(1, Math.ceil((clearedRows.length * this.scene.cols) / SHARD_CELL_BUDGET));
        const rows = clearedRows.filter((_, i) => i % stride === 0);
        if (stride > 1) {
            debugLog(`[SharedEffects] Shard sampling: ${clearedRows.length} rows -> ${rows.length} (stride ${stride})`);
        }

        // Group cells by colour: one emitter per colour, not per cell.
        const byColor = new Map();
        rows.forEach((row) => {
            const gridRow = grid[row];
            if (!gridRow) return;
            const screenRow = isInfinityMode ? row : row - this.scene.hiddenRows;
            if (!isInfinityMode && screenRow < 0) return;
            for (let col = 0; col < this.scene.cols; col++) {
                const cell = gridRow[col];
                if (!cell) continue;
                const colorInt = this._cellColorInt(cell);
                if (!byColor.has(colorInt)) byColor.set(colorInt, []);
                byColor.get(colorInt).push({
                    x: col * bs + bs / 2,
                    y: screenRow * bs + bs / 2,
                });
            }
        });
        if (byColor.size === 0) return;

        // The row comes apart from the middle: each half's debris flies out to its
        // own side, a little upward, then falls.
        const outward = (particle) => (particle.x < boardWidth / 2
            ? randIn(-178, -128)
            : randIn(-52, -2));

        byColor.forEach((cells, colorInt) => {
            const emitter = createParticleEmitter(this.scene, 0, 0, key, {
                speed: { min: 80 * speed, max: 220 * speed },
                angle: outward,
                gravityY: 820, // heavy, so chunks fall like debris instead of drifting like embers
                lifespan: { min: 380, max: SHARD_LIFESPAN },
                quantity: 0,
                alpha: { start: 1, end: 0 },
                // Stays chunky — shards are debris, they do not evaporate.
                scale: { start: shardScale, end: shardScale * 0.35 },
                rotate: { min: 0, max: 360 },
                blendMode: 'NORMAL', // NOT additive: the cell's own colour must read true
                emitting: false,
                tint: colorInt,
            });
            if (!emitter) return;

            emitter.setDepth?.(6); // above the stack, below the row light
            emitter.setScrollFactor?.(isInfinityMode ? 1 : 0);

            if (typeof emitter.emitParticleAt === 'function') {
                cells.forEach((c) => emitter.emitParticleAt(c.x, c.y, perCell));
            } else if (!emitParticles(emitter, cells.length * perCell)) {
                destroyParticleEmitter(emitter);
                return;
            }

            const timer = this.scene.time.delayedCall(SHARD_LIFESPAN + 120, () => {
                destroyParticleEmitter(emitter);
                this.activeParticleSystems.delete(emitter);
            });
            this._trackTimer(timer);
            this.activeParticleSystems.add(emitter);
        });
    }

    /**
     * Get particle tint color based on combo count
     * @param {number} comboCount - Current combo count
     * @param {number} index - Row index for variation
     * @returns {number} Hex color value
     */
    getComboTint(comboCount, index = 0) {
        if (typeof this.scene?.getComboTint === 'function') {
            return this.scene.getComboTint(comboCount, index);
        }

        if (comboCount === 0) {
            return 0x00ffff; // Default cyan
        } if (comboCount === 2) {
            return 0x00ff88; // Green-cyan
        } if (comboCount === 3) {
            return 0xffaa00; // Orange
        } if (comboCount === 4) {
            return 0xff00ff; // Magenta
        } if (comboCount >= 5) {
            // Rainbow effect for high combos
            const colors = [0xff0000, 0xff8800, 0xffff00, 0x00ff00, 0x00ffff, 0x0088ff, 0xff00ff];
            return colors[index % colors.length];
        }
        return 0x00ffff;
    }

    /**
     * Spawn background explosion particles for combo effects
     * Uses compatibility layer for Phaser 3/4 support
     * @param {number} comboCount - Current combo count
     */
    spawnComboExplosionParticles(comboCount) {
        if (!this.getQualityConfig()?.particles) return;
        const key = this._lit() ? FX.EMBER : this.lineClearParticleKey;
        if (!this.scene.textures.exists(key)) return;

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const u = (this.scene.blockSize || 40) / 40;
        // Radiate from the clear that caused this, not from mid-board.
        const centerX = boardWidth / 2;
        const centerY = this._effectOriginY();
        const depth = Math.min(comboCount, 8);
        const count = 14 + depth * 5;
        const tone = this._comboTone(comboCount);

        // One even ring of motes that opens out and fades, in the chain's tone.
        const emitter = createParticleEmitter(this.scene, centerX, centerY, key, {
            angle: { start: 0, end: 360, steps: count },
            speed: { min: (150 + depth * 14) * u, max: (190 + depth * 18) * u },
            lifespan: { min: 460, max: 680 },
            quantity: 0,
            alpha: { start: 0.95, end: 0 },
            scale: { start: u * 0.6, end: 0 },
            gravityY: 0,
            blendMode: lightBlend(this.scene),
            emitting: false,
            tint: [tone, TONE.CREAM, mixColor(tone, TONE.CREAM, 0.5)],
        });
        if (!emitter) return;
        emitter.setDepth?.(4);
        emitter.setScrollFactor?.(0);
        if (!emitParticles(emitter, count)) {
            destroyParticleEmitter(emitter);
            return;
        }
        const timer = this.scene.time.delayedCall(900, () => {
            destroyParticleEmitter(emitter);
            this.activeParticleSystems.delete(emitter);
        });
        this._trackTimer(timer);
        this.activeParticleSystems.add(emitter);

        // Add extra radial burst for very high combos (5+)
        if (comboCount >= 5) {
            const wave = this.scene.time.delayedCall(150, () => this.spawnRadialWave(comboCount));
            this._trackTimer(wave);
        }
    }

    /**
     * Spawn a radial wave effect for extreme combos: a soft ring of light in the
     * chain's tone where the kit's light is available, else a ring of streaks.
     *
     * The streak fallback is ONE emitter for the whole ring. It used to allocate an emitter *per
     * particle* — `60 + comboCount * 10` game objects, each with its own
     * destroy timer (≈140 at combo 8), rebuilt on every high combo and on every
     * perfect clear. The even angular spacing that loop produced is reproduced
     * by a stepped `angle` op, which walks start→end across successive
     * particles of a single burst, so the look is unchanged.
     *
     * @param {number} comboCount - Current combo count
     * @param {number} [originY] - Override the vertical anchor. Perfect clear
     *   passes board centre so its rings, flash and banner stay concentric; the
     *   board is empty by then, so there is no clear location to radiate from.
     */
    spawnRadialWave(comboCount, originY) {
        if (!this.getQualityConfig()?.particles) return;

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const centerX = boardWidth / 2;
        // Radiate from the clear that caused this, not from mid-board.
        const centerY = Number.isFinite(originY) ? originY : this._effectOriginY();
        const tone = this._comboTone(comboCount);

        // Lit: one soft ring of light in the chain's tone. (A burst of a hundred
        // streaks starts as a white disc where they overlap and opens into a
        // bristled hoop.)
        if (this._lit()) {
            this.createShockwaveRing(centerX, centerY, tone, 1);
            return;
        }
        if (!this.scene.textures.exists(this.lineClearParticleKey)) return;

        const ringParticleCount = Math.round(60 + (comboCount * 10));
        const waveSpeed = 200 + (comboCount * 20);

        // Per-particle tint: an array cycles across the burst the same way the
        // old loop's `getComboTint(comboCount, i)` did. Built via getComboTint so
        // a scene-level palette override still applies.
        const tint = [tone, TONE.CREAM, mixColor(tone, TONE.CREAM, 0.5)];

        const emitter = createParticleEmitter(this.scene, centerX, centerY, this._sparkTextureKey(), {
            angle: { start: 0, end: 360, steps: ringParticleCount },
            // Same start/end/steps as `angle`, so both ops walk the sequence in
            // lockstep and every streak points exactly along its own travel
            // direction — an aligned ring rather than a ring of tumbling dashes.
            rotate: { start: 0, end: 360, steps: ringParticleCount },
            speed: waveSpeed, // exact, not a range — constant speed keeps the ring circular
            lifespan: { min: 500, max: 800 },
            quantity: 0, // required for explode()
            alpha: { start: 0.9, end: 0 },
            scale: { start: 1.1, end: 0.2 },
            gravityY: 0, // No gravity for clean ring expansion
            blendMode: lightBlend(this.scene),
            emitting: false,
            tint,
        });

        if (!emitter) {
            console.warn('[SharedEffects] Failed to create radial wave emitter');
            return;
        }

        if (emitter.setDepth) {
            emitter.setDepth(3);
        }

        // Particles ignore camera scroll - positioned in screen coordinates
        if (emitter.setScrollFactor) {
            emitter.setScrollFactor(0);
        }

        if (!emitParticles(emitter, ringParticleCount)) {
            destroyParticleEmitter(emitter);
            return;
        }

        const timer = this.scene.time.delayedCall(900, () => {
            if (emitter) {
                destroyParticleEmitter(emitter);
                this.activeParticleSystems.delete(emitter);
            }
        });
        this._trackTimer(timer);

        this.activeParticleSystems.add(emitter);
    }

    /**
     * Get quality configuration from scene
     * @returns {Object} Quality config object
     */
    getQualityConfig() {
        if (this.scene.getQualityConfig) {
            return this.scene.getQualityConfig();
        }
        // Fallback to medium quality
        return {
            particles: true,
            shakeMultiplier: 1.0,
            particleCount: 1.0,
        };
    }

    /**
     * Show cascade wave indicator
     * Creates a sweeping visual effect to show when a cascade is being detected
     * @param {number} cascadeCount - Current cascade number
     */
    showCascadeWave(cascadeCount) {
        // MEGA-ONLY, matching local MP's read (which the player prefers). A chain
        // below 10 already carries the clear's own flash, debris, sparks, shake
        // and the per-wave combo popup; the former ring/banner/shake step at 3-9
        // was the layer that made single player feel cluttered next to local MP.
        if (cascadeCount >= 10) {
            this.showMegaCascadeEffect(cascadeCount);
        }
    }

    /**
     * Show mega cascade special effect for 10+ cascades
     * Creates an intense screen-filling effect to celebrate massive combos
     * @param {number} cascadeCount - Current cascade number
     */
    showMegaCascadeEffect(cascadeCount) {
        const boardHeight = this.scene.rows * this.scene.blockSize;

        debugLog(`[SharedEffects] MEGA CASCADE x${cascadeCount}!`);

        // The depth is the payload, so it leads at size with CASCADE as caption.
        //
        // Sits BELOW centre on purpose. A deep cascade can end in a perfect clear,
        // and both banners used to anchor at centreY — drawing one exactly on top
        // of the other. Every banner now has its own lane: back-to-back 0.18,
        // combo 0.28, T-spin and quad 0.375, level 0.44, perfect clear 0.50,
        // cascade 0.62.
        this._showBanner({
            kicker: 'Chain',
            lead: `\u00d7${cascadeCount}`,
            title: 'Cascade',
            y: boardHeight * 0.62,
            leadSize: cascadeCount >= 20 ? 84 : 72,
            titleSize: 24,
            accent: cascadeCount >= 20 ? TONE.GOLD : TONE.AQUA,
            hold: 320,
            depth: 56,
        });
        this.createShockwaveRing((this.scene.cols * this.scene.blockSize) / 2, boardHeight * 0.62, TONE.AQUA, 2);

        // Camera shake - more intense for mega cascades
        if (this.scene.shakeCamera) {
            const shakeDuration = 400 + (cascadeCount * 20);
            const reduced = this._reducedMotion();
            this.scene.shakeCamera(Math.min(cascadeCount / 2, 8) * (reduced ? 0.3 : 0.75), shakeDuration);
        }
    }

    /**
     * Perfect Clear — the game's flagship moment, as a dawn in the empty well.
     *
     * Gold light rises from the floor and fills the well, a warm bloom opens from
     * its middle, two rings go out, motes of gold drift up through the empty board,
     * and the longest-held callout in the game names it. The flagship gets the
     * biggest zoom kick and a hit-stop, but no white-out.
     *
     * @param {number} [depth=0] - Total lines cleared in the run that emptied the board
     */
    playPerfectClear(depth = 0) {
        const bs = this.scene.blockSize;
        const boardWidth = this.scene.cols * bs;
        const boardHeight = this.scene.rows * bs;
        const centerX = boardWidth / 2;
        const centerY = boardHeight / 2;
        const reduced = this._reducedMotion();

        // Celebration callout first, so it owns the centre lane.
        this._showBanner({
            kicker: 'Board clear',
            title: 'Perfect',
            y: centerY,
            titleSize: 50,
            accent: TONE.GOLD,
            hold: 620,
            depth: 60,
        });

        this._screenFlash(TONE.GOLD, reduced ? 0.3 : 0.55, 80, 620, 5, centerY);
        if (this._lit()) {
            // The dawn: light rising from the floor through the whole well.
            const dawn = addLight(this.scene, FX.RISE, centerX, boardHeight, {
                tint: TONE.GOLD, width: boardWidth, height: boardHeight, alpha: 0, originY: 1, depth: 4,
            });
            if (dawn) {
                const { scaleY } = dawn;
                dawn.scaleY = scaleY * 0.2;
                this.scene.tweens.add({
                    targets: dawn, alpha: 0.42, scaleY, duration: 520, ease: 'Sine.easeOut',
                });
                this.scene.tweens.add({
                    targets: dawn, alpha: 0, delay: 760, duration: 900, ease: 'Sine.easeIn', onComplete: destroyOnComplete(dawn),
                });
            }
        }
        for (let i = 0; i < 2; i++) {
            this.createShockwaveRing(centerX, centerY, i ? TONE.CREAM : TONE.GOLD, 1 + i);
        }

        // Motes of gold drift up through the emptied board.
        if (this.getQualityConfig()?.particles && !reduced) {
            const key = this._lit() ? FX.EMBER : this.lineClearParticleKey;
            const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
            if (this.scene.textures?.exists?.(key) && PhaserRef?.Geom?.Rectangle) {
                const motes = createParticleEmitter(this.scene, 0, 0, key, {
                    emitZone: { type: 'random', source: new PhaserRef.Geom.Rectangle(0, boardHeight * 0.45, boardWidth, boardHeight * 0.55) },
                    speed: { min: 20, max: 70 },
                    angle: { min: -120, max: -60 },
                    gravityY: -40,
                    lifespan: { min: 900, max: 1700 },
                    quantity: 0,
                    alpha: { start: 0.9, end: 0 },
                    scale: { start: (bs / 40) * 0.55, end: 0 },
                    blendMode: lightBlend(this.scene),
                    emitting: false,
                    tint: [TONE.GOLD, TONE.CREAM, mixColor(TONE.GOLD, TONE.CORAL, 0.3)],
                });
                if (motes) {
                    motes.setDepth?.(5);
                    motes.setScrollFactor?.(0);
                    emitParticles(motes, Math.round(36 + Math.min(depth, 12) * 3));
                    const timer = this.scene.time.delayedCall(1900, () => {
                        destroyParticleEmitter(motes);
                        this.activeParticleSystems.delete(motes);
                    });
                    this._trackTimer(timer);
                    this.activeParticleSystems.add(motes);
                }
            }
        }

        if (this.scene.shakeCamera) {
            this.scene.shakeCamera(reduced ? 1.2 : 3.2, reduced ? 200 : 380);
        }
        if (!reduced) {
            this.triggerHitStop(110);
        }
        this._zoomPunch(0.028, 320); // the flagship moment gets the biggest kick
    }

    /**
     * A soft ring of light opening out from a point.
     * @param {number} centerX - Center X position
     * @param {number} centerY - Center Y position
     * @param {number} color - Ring color
     * @param {number} index - Ring index (later rings start wider and later)
     */
    createShockwaveRing(centerX, centerY, color, index) {
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const reach = Math.max(boardWidth, boardHeight) * 1.2;

        if (this._lit()) {
            const ring = addLight(this.scene, FX.RING, centerX, centerY, {
                tint: color, width: 40 * index, height: 40 * index, alpha: 0.7, depth: 8,
            });
            if (ring) {
                const grow = reach / (40 * index);
                this.scene.tweens.add({
                    targets: ring,
                    scale: ring.scale * grow,
                    alpha: 0,
                    delay: (index - 1) * 70,
                    duration: 680,
                    ease: 'Expo.easeOut', // shockwaves expand fast then settle
                    onComplete: destroyOnComplete(ring),
                });
                return;
            }
        }

        const ringGraphics = this.scene.add.graphics();
        ringGraphics.setScrollFactor(0);
        ringGraphics.setDepth(8);
        const ringData = { radius: 20 * index, alpha: 0.6, thickness: 4 };
        this.scene.tweens.add({
            targets: ringData,
            radius: reach,
            alpha: 0,
            thickness: 1,
            duration: 600,
            ease: 'Expo.easeOut',
            onUpdate: () => {
                ringGraphics.clear();
                ringGraphics.lineStyle(ringData.thickness, color, ringData.alpha);
                ringGraphics.strokeCircle(centerX, centerY, ringData.radius);
            },
            onComplete: () => {
                ringGraphics.destroy();
            },
        });
    }

    /**
     * PERFORMANCE: Register a graphics object for tracking
     * Automatically destroys oldest graphics when limit is reached
     * @param {Phaser.GameObjects.Graphics} graphics - Graphics object to track
     */
    _trackGraphics(graphics) {
        if (!graphics) return;

        // Remove oldest graphics if we've hit the limit
        while (this.activeGraphics.length >= this.maxGraphicsObjects) {
            const old = this.activeGraphics.shift();
            if (old?.scene) { // A live Phaser object still belongs to its scene.
                try {
                    old.destroy();
                } catch (e) {
                    // Already destroyed, ignore
                }
            }
        }

        this.activeGraphics.push(graphics);
    }

    /**
     * PERFORMANCE: Register a text object for tracking
     * Automatically destroys oldest text when limit is reached
     * @param {Phaser.GameObjects.Text} text - Text object to track
     */
    _trackText(text) {
        if (!text) return;

        // Remove oldest text if we've hit the limit
        while (this.activeTextObjects.length >= this.maxTextObjects) {
            const old = this.activeTextObjects.shift();
            if (old?.scene) { // A live Phaser object still belongs to its scene.
                try {
                    old.destroy();
                } catch (e) {
                    // Already destroyed, ignore
                }
            }
        }

        this.activeTextObjects.push(text);
    }

    /**
     * PERFORMANCE: Register a timer for tracking and cleanup with size limit
     * @param {Phaser.Time.TimerEvent} timer - Timer to track
     */
    _trackTimer(timer) {
        if (!timer) return;

        // PERFORMANCE FIX: Add limit to prevent unbounded growth
        const MAX_TIMERS = 50;
        if (this.activeTimers.length >= MAX_TIMERS) {
            // Remove completed timers first
            this.activeTimers = this.activeTimers.filter((t) => t && !t.hasFinished);

            // If still at limit, remove oldest
            if (this.activeTimers.length >= MAX_TIMERS) {
                this.activeTimers.shift();
            }
        }

        this.activeTimers.push(timer);
    }

    /**
     * PERFORMANCE: Clean up destroyed objects from tracking arrays
     * Call this periodically to prevent memory leaks
     * @private
     */
    _cleanupTrackedObjects() {
        // Remove destroyed graphics
        this.activeGraphics = this.activeGraphics.filter((g) => g && g.scene);

        // Remove destroyed text
        this.activeTextObjects = this.activeTextObjects.filter((t) => t && t.scene);

        // Remove completed timers
        this.activeTimers = this.activeTimers.filter((t) => t && !t.hasDispatched);
    }

    /**
     * Hard drop — weight, not a laser.
     *
     * The piece slams into its place: a short smear of its colour above it (a
     * couple of cells at most, soft and tapered, gone in under 200ms: speed, never a
     * beam down the well), a flash on the piece itself, light spreading along the
     * edge where it met the stack, and sparks kicked out sideways from that edge.
     * Distance scales it. Under reduced motion only the flash and the edge light
     * remain.
     *
     * @param {Object} dropData - Data about the hard drop
     * @param {Object} dropData.piece - The piece that was dropped
     * @param {number} dropData.startY - The start Y grid coordinate
     * @param {number} dropData.endY - The end Y grid coordinate
     */
    playHardDropEffect(dropData) {
        if (!dropData || !dropData.piece || dropData.startY === dropData.endY) return;
        if (!this._lit()) return;

        const { piece, startY, endY } = dropData;
        const { scene } = this;
        const bs = scene.blockSize;
        const colorInt = toColorInt(this.getPieceColor(piece, '#ffffff'));
        const scroll = this._scroll();
        const reduced = this._reducedMotion();
        const distance = Math.max(1, Math.abs(endY - startY));
        const weight = Math.min(1, Math.max(0.3, distance / 14));

        // The landed cells, and which of them touch whatever stopped the piece.
        const cells = [];
        piece.shape.forEach((row, ry) => row.forEach((v, rx) => {
            if (v > 0) cells.push({ c: piece.x + rx, r: endY + ry });
        }));
        if (!cells.length) return;
        const occupied = new Set(cells.map(({ c, r }) => `${c},${r}`));
        // Only edges that rest on something (the floor or the stack) take the hit.
        const grid = scene.gameState?.boardGrid || scene.gameState?.board;
        const floor = Array.isArray(grid) ? grid.length : Infinity;
        const bottoms = cells.filter(({ c, r }) => !occupied.has(`${c},${r + 1}`)
            && (r + 1 >= floor || Boolean(grid?.[r + 1]?.[c])));

        // 1. The smear: one per run of columns whose top cells share a row, rising
        //    from the piece's top edge, short and soft. One sprite per run, so
        //    neighbouring columns never leave a seam between them.
        if (!reduced) {
            const tops = new Map();
            cells.forEach(({ c, r }) => { if (!tops.has(c) || r < tops.get(c)) tops.set(c, r); });
            const runs = [];
            [...tops.keys()].sort((a, b) => a - b).forEach((c) => {
                const last = runs[runs.length - 1];
                if (last && last.r === tops.get(c) && last.c1 === c - 1) last.c1 = c;
                else runs.push({ r: tops.get(c), c0: c, c1: c });
            });
            const length = bs * Math.min(2.2, 0.7 + distance * 0.11);
            runs.forEach(({ r, c0, c1 }) => {
                const span = (c1 - c0 + 1) * bs;
                const smear = addLight(scene, FX.SMEAR, c0 * bs + span / 2, this._rowTop(r), {
                    tint: mixColor(colorInt, TONE.CREAM, 0.3),
                    width: span + bs * 0.12,
                    height: length,
                    alpha: 0.5 + 0.3 * weight,
                    originY: 1,
                    depth: 6,
                    scroll,
                });
                if (!smear) return;
                scene.tweens.add({
                    targets: smear,
                    alpha: 0,
                    scaleY: smear.scaleY * 0.3,
                    duration: 170,
                    ease: 'Cubic.easeOut',
                    onComplete: destroyOnComplete(smear),
                });
            });
        }

        // 2. The piece flashes as it lands.
        const flash = scene.add?.graphics?.();
        if (flash) {
            const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
            flash.setScrollFactor?.(scroll);
            flash.setDepth?.(9);
            if (flash.setBlendMode && PhaserRef?.BlendModes?.ADD) flash.setBlendMode(lightBlend(this.scene));
            flash.fillStyle(mixColor(colorInt, TONE.CREAM, 0.7), 1);
            cells.forEach(({ c, r }) => flash.fillRect(c * bs, this._rowTop(r), bs, bs));
            flash.setAlpha?.(0.5 + 0.2 * weight);
            scene.tweens.add({
                targets: flash, alpha: 0, duration: 150, ease: 'Quad.easeOut', onComplete: destroyOnComplete(flash),
            });
        }

        // 3. Light spreads along each run of the contact edge.
        const runs = [];
        bottoms.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c)).forEach((cell) => {
            const run = runs[runs.length - 1];
            if (run && run.r === cell.r && run.c1 === cell.c - 1) run.c1 = cell.c;
            else runs.push({ r: cell.r, c0: cell.c, c1: cell.c });
        });
        runs.forEach(({ r, c0, c1 }) => {
            const span = (c1 - c0 + 1) * bs;
            const x = c0 * bs + span / 2;
            const y = this._rowTop(r) + bs;
            // A pool of light where it struck, and a bright edge spreading from it:
            // both reach further the further the piece fell.
            const pool = addLight(scene, FX.GLOW, x, y, {
                tint: mixColor(colorInt, TONE.CREAM, 0.4),
                width: span + bs * (2.4 + 1.2 * weight),
                height: bs * (1.5 + 0.5 * weight),
                alpha: 0.35 + 0.45 * weight,
                depth: 5,
                scroll,
            });
            if (pool) {
                const { scaleX } = pool;
                scene.tweens.add({
                    targets: pool,
                    scaleX: scaleX * 1.3,
                    alpha: 0,
                    duration: 360,
                    ease: 'Quad.easeOut',
                    onComplete: destroyOnComplete(pool),
                });
            }
            const edge = addLight(scene, FX.FLARE, x, y, {
                tint: mixColor(colorInt, TONE.CREAM, 0.55),
                width: span + bs * (1.4 + 1.2 * weight),
                height: bs * 0.6,
                alpha: 1,
                depth: 9,
                scroll,
            });
            if (!edge) return;
            const { scaleX } = edge;
            edge.scaleX = scaleX * 0.7;
            scene.tweens.add({
                targets: edge,
                scaleX: scaleX * (1.3 + 0.6 * weight),
                alpha: 0,
                duration: 380,
                ease: 'Quad.easeOut',
                onComplete: destroyOnComplete(edge),
            });
        });

        // 4. Sparks kick out sideways from the ends of each contact edge, then fall.
        if (!reduced && this.getQualityConfig()?.particles && runs.length) {
            const fan = (angle) => createParticleEmitter(scene, 0, 0, FX.EMBER, {
                speed: { min: 80 * weight + 50, max: 230 * weight + 70 },
                angle,
                gravityY: 760,
                lifespan: { min: 220, max: 440 },
                quantity: 0,
                alpha: { start: 1, end: 0 },
                scale: { start: (bs / 40) * 0.62, end: 0 },
                blendMode: lightBlend(this.scene),
                emitting: false,
                tint: [colorInt, TONE.CREAM, mixColor(colorInt, TONE.CREAM, 0.5)],
            });
            const per = Math.max(2, Math.round(5 * weight));
            [[fan({ min: -176, max: -146 }), ({ c0 }) => c0 * bs + 2],
                [fan({ min: -34, max: -4 }), ({ c1 }) => (c1 + 1) * bs - 2]].forEach(([sparks, xOf]) => {
                if (!sparks) return;
                sparks.setDepth?.(10);
                sparks.setScrollFactor?.(scroll);
                runs.forEach((run) => sparks.emitParticleAt?.(xOf(run), this._rowTop(run.r) + bs - 2, per));
                const timer = scene.time.delayedCall(560, () => {
                    destroyParticleEmitter(sparks);
                    this.activeParticleSystems.delete(sparks);
                });
                this._trackTimer(timer);
                this.activeParticleSystems.add(sparks);
            });
        }
    }

    /**
     * T-spin: the spin named in lavender, with a ring opening behind it.
     * @param {number} [lineCount=0] - Lines cleared with the T-spin (0 = T-spin mini/zero).
     */
    playTSpinEffect(lineCount = 0) {
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const centerX = boardWidth / 2;
        const centerY = boardHeight / 2;

        // "T-spin" leads; the line count is the qualifier beneath it.
        const qualifiers = [null, 'Single', 'Double', 'Triple'];
        this._showBanner({
            title: 'T-spin',
            subtitle: qualifiers[Math.min(lineCount, 3)],
            y: centerY * 0.75,
            titleSize: lineCount >= 2 ? 40 : 34,
            subtitleSize: 18,
            accent: TONE.LAVENDER,
            hold: 300,
            depth: 55,
        });

        // The banner and ring stay — a T-spin is skill and deserves to be marked.
        // No border pulse or screen flash: they tint the entire frame for a single
        // piece placement.
        this.createShockwaveRing(centerX, centerY * 0.75, TONE.LAVENDER, 1);
    }

    /**
     * Back-to-back: a small gold callout high on the board.
     * @param {boolean} [active=true] - Whether a B2B was just scored (always true when called).
     */
    playB2BChange(active = true) {
        if (!active) return;

        const boardHeight = this.scene.rows * this.scene.blockSize;

        // Sits high, out of the way of the combo popup and the centre banners.
        this._showBanner({
            title: 'Back to back',
            y: boardHeight * 0.18,
            titleSize: 24,
            accent: TONE.GOLD,
            hold: 260,
            depth: 54,
        });
    }

    /**
     * Knock-out (versus): the roof flares coral, the stack goes dark and loses its
     * colour, pieces break off and fall, and the board settles back dim until
     * clearKnockout() (fx/fx-moments.js).
     */
    playKnockout() {
        this.clearKnockout();
        this._knockoutFilter = playKnockoutFx(this.scene, {
            colorOf: (cell) => this._cellColorInt(cell),
            reduced: this._reducedMotion(),
        });
    }

    /** A new round: the board's colour and light come back. */
    clearKnockout() {
        restoreKnockoutFx(this.scene, this._knockoutFilter);
        this._knockoutFilter = null;
    }

    /**
     * Round won on this board: gold light from the floor and fireworks.
     * @param {Object} [opts]
     * @param {number|string} [opts.color] - The seat's colour.
     */
    playRoundWin({ color = TONE.GOLD } = {}) {
        playRoundWinFx(this.scene, { color: toColorInt(color, TONE.GOLD), reduced: this._reducedMotion() });
    }

    /**
     * Match won on this board: the round's light, longer, with more fireworks and
     * a glow behind the well.
     * @param {Object} [opts]
     * @param {number|string} [opts.color] - The seat's colour.
     */
    playVictory({ color = TONE.GOLD } = {}) {
        playVictoryFx(this.scene, { color: toColorInt(color, TONE.GOLD), reduced: this._reducedMotion() });
    }

    /**
     * Cleanup all active particle systems, graphics, text, and timers
     * Should be called when effects are no longer needed
     */
    cleanup() {
        if (this._hitStopTimer !== null) clearTimeout(this._hitStopTimer);
        this._hitStopRestore?.();
        this._clearDrain();
        if (this._knockoutFilter) this.clearKnockout();
        debugLog('[SharedEffects] Cleaning up all resources:', {
            particles: this.activeParticleSystems.size,
            graphics: this.activeGraphics.length,
            text: this.activeTextObjects.length,
            timers: this.activeTimers.length,
        });

        // Clean up particle systems
        this.activeParticleSystems.forEach((system) => {
            destroyParticleEmitter(system);
        });
        this.activeParticleSystems.clear();

        // PERFORMANCE: Clean up all graphics objects
        this.activeGraphics.forEach((graphics) => {
            if (graphics && graphics.scene) {
                try {
                    graphics.destroy();
                } catch (e) {
                    // Already destroyed, ignore
                }
            }
        });
        this.activeGraphics = [];

        // PERFORMANCE: Clean up all text objects
        this.activeTextObjects.forEach((text) => {
            if (text && text.scene) {
                try {
                    text.destroy();
                } catch (e) {
                    // Already destroyed, ignore
                }
            }
        });
        this.activeTextObjects = [];

        // PERFORMANCE: Cancel all timers
        this.activeTimers.forEach((timer) => {
            if (timer && !timer.hasDispatched) {
                try {
                    timer.remove();
                } catch (e) {
                    // Already removed, ignore
                }
            }
        });
        this.activeTimers = [];

        // A punch in flight when the scene tears down would otherwise leave the
        // camera zoomed in for whatever reuses it.
        if (this._zoomPunchActive && Number.isFinite(this._zoomPunchBase)) {
            const cam = this.scene?.cameras?.main;
            if (cam) cam.zoom = this._zoomPunchBase;
        }
        this._zoomPunchActive = false;
        this._zoomPunchBase = null;

        // Reset state
        this.lastImpactIntensity = 0;
        this.currentComboCount = 0;
        this._clearOriginY = null;
    }
}
