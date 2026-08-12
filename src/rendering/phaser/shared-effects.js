/**
 * @fileoverview Shared Effects Module for Phaser 4
 *
 * This module contains all visual effects logic that can be reused across
 * board scenes (single-player BoardScene today; designed for reuse).
 *
 * Benefits:
 * - Single source of truth for all effects
 * - No code duplication between single-player and multiplayer
 * - Easier to maintain and extend
 * - Consistent behavior across game modes
 */

import {
    createParticleEmitter,
    emitParticles,
    destroyParticleEmitter,
} from './utils/particle-compat.js';
import { ensureSquareTexture, ensureStreakTexture } from './utils/graphics.js';

// Constants
const RIPPLE_PARTICLE_LIFESPAN = 650;

// Density of the upward spark fountain on a line clear.
//
// The fountain used to be the ONLY thing selling a clear, so it was tuned loud:
// a quad emitted ~630 additive particles (18 x lineCount x 2.2 per row, x4 rows)
// and read as a wall of colour. It now shares the moment with per-cell debris and
// a landing impact, and at full density it drowned both of them out. Turn this
// back up to 1 to restore the original wall.
const FOUNTAIN_DENSITY = 0.45;

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
const SHARD_LIFESPAN = 760;
const SHARDS_PER_CELL = 3;
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

        // PERFORMANCE: Track graphics objects and text objects for proper cleanup
        // Prevents accumulation of orphaned display objects
        this.activeGraphics = [];
        this.activeTextObjects = [];
        this.maxGraphicsObjects = 25; // Limit concurrent graphics objects
        this.maxTextObjects = 15; // Limit concurrent text objects

        // PERFORMANCE: Track timers for cleanup
        this.activeTimers = [];

        debugLog('[SharedEffects] Initialized for scene:', scene.scene?.key || 'unknown');
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

        const prevTime = timeClock.timeScale || 1;
        const prevTween = tweenMgr.timeScale || 1;

        this._hitStopActive = true;
        try {
            timeClock.timeScale = 0.0001;
            tweenMgr.timeScale = 0.0001;
        } catch (e) {
            this._hitStopActive = false;
            return;
        }

        // Real-clock restore: scene timers are frozen, so delayedCall can't fire here.
        setTimeout(() => {
            this._hitStopActive = false;
            try {
                if (scene && scene.time && typeof scene.time.timeScale === 'number') {
                    scene.time.timeScale = prevTime;
                }
                if (scene && scene.tweens && typeof scene.tweens.timeScale === 'number') {
                    scene.tweens.timeScale = prevTween;
                }
            } catch (e) {
                // Scene torn down mid-freeze - nothing to restore
            }
        }, Math.max(16, durationMs));
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
    _screenFlash(color = 0xffffff, peakAlpha = 0.5, holdMs = 40, fadeMs = 240, depth = 50) {
        if (!this.scene?.add?.rectangle) return;
        const PhaserRef = window.Phaser;
        const width = this.scene.cols * this.scene.blockSize;
        const height = this.scene.rows * this.scene.blockSize;

        const flash = this.scene.add.rectangle(width / 2, height / 2, width, height, color, peakAlpha);
        flash.setScrollFactor(0);
        flash.setDepth(depth);
        if (flash.setBlendMode && PhaserRef?.BlendModes?.ADD) {
            flash.setBlendMode(PhaserRef.BlendModes.ADD);
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
        if (!this.scene?.add?.graphics) return;
        const PhaserRef = window.Phaser;
        const width = this.scene.cols * this.scene.blockSize;
        const height = this.scene.rows * this.scene.blockSize;

        const g = this.scene.add.graphics();
        g.setScrollFactor(0);
        g.setDepth(9);
        if (g.setBlendMode && PhaserRef?.BlendModes?.ADD) {
            g.setBlendMode(PhaserRef.BlendModes.ADD);
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
        const width = this.scene.cols * this.scene.blockSize;
        const isInfinityMode = Boolean(this.scene.gameState?.isInfinityMode);
        const tier = this.getClearTier(clearedRows.length);

        if (PhaserRef?.GameObjects) {
            clearedRows.forEach((row, index) => {
                // In infinity mode, use world coordinates; in standard mode, use screen coordinates
                let centerY;
                if (isInfinityMode) {
                    // World coordinates: row * blockSize (will follow camera)
                    centerY = (row * this.scene.blockSize) + (this.scene.blockSize / 2);
                } else {
                    // Screen coordinates: (row - hiddenRows) * blockSize
                    const visibleRow = row - this.scene.hiddenRows;
                    if (visibleRow < 0) {
                        return;
                    }
                    centerY = (visibleRow * this.scene.blockSize) + (this.scene.blockSize / 2);
                }

                const tint = this.getComboTint(this.currentComboCount, index);

                const stripe = this.scene.add.rectangle(
                    width / 2,
                    centerY,
                    width,
                    this.scene.blockSize,
                    tint,
                    tier.flashAlpha,
                );

                // In infinity mode, follow camera (scrollFactor=1); in standard mode, stay in screen space (scrollFactor=0)
                stripe.setScrollFactor(isInfinityMode ? 1 : 0);
                stripe.setBlendMode(PhaserRef.BlendModes.ADD);

                this.scene.tweens.add({
                    targets: stripe,
                    alpha: { from: Math.min(tier.flashAlpha + 0.1, 1), to: 0 },
                    scaleY: { from: 1, to: tier.whiteCore ? 1.5 : 1.25 },
                    y: centerY + 4,
                    duration: 220 + index * 40,
                    ease: 'Expo.easeOut', // destruction, not a soft fade
                    delay: index * 50,
                    onComplete: () => stripe.destroy(),
                });

                // White-hot inner core for triple/quad clears - reads as raw energy
                if (tier.whiteCore) {
                    const core = this.scene.add.rectangle(
                        width / 2,
                        centerY,
                        width,
                        this.scene.blockSize * 0.4,
                        0xffffff,
                        0.85,
                    );
                    core.setScrollFactor(isInfinityMode ? 1 : 0);
                    core.setBlendMode(PhaserRef.BlendModes.ADD);
                    this.scene.tweens.add({
                        targets: core,
                        alpha: { from: 0.9, to: 0 },
                        scaleY: { from: 1, to: 2.2 },
                        duration: 260 + index * 40,
                        ease: 'Expo.easeOut',
                        delay: index * 50,
                        onComplete: () => core.destroy(),
                    });
                }
            });
        } else if (this.scene.effectsGraphics) {
            clearedRows.forEach((row) => {
                const y = (row - this.scene.hiddenRows) * this.scene.blockSize;
                if (row >= this.scene.hiddenRows) {
                    const flash = this.scene.effectsGraphics;
                    flash.fillStyle(0xffffff, 0.6);
                    flash.fillRect(0, y, width, this.scene.blockSize);
                }
            });

            this.scene.time.delayedCall(120, () => {
                this.scene.effectsGraphics.clear();
            });
        }

        // Tetris (4-line) clears blow out the whole playfield with a brief flash.
        if (tier.fullscreen) {
            this._screenFlash(0xffffff, this._reducedMotion() ? 0.22 : 0.42, 30, 240, 50);
        }

        // Remember where the clear HAPPENED, so the reactions to it can radiate from
        // there instead of from the middle of the board. Cleared lines span the
        // full width, so only the vertical anchor is meaningful.
        const visibleRows = isInfinityMode
            ? clearedRows
            : clearedRows.filter((r) => r >= this.scene.hiddenRows);
        if (visibleRows.length) {
            const mean = visibleRows.reduce((a, b) => a + b, 0) / visibleRows.length;
            const screenMean = isInfinityMode ? mean : mean - this.scene.hiddenRows;
            this._clearOriginY = screenMean * this.scene.blockSize + this.scene.blockSize / 2;
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
                centerY,
                blockSize: this.scene.blockSize,
            });

            // Create expanding circle effect using tweens
            const ripple = this.scene.add.graphics();

            // PERFORMANCE NOTE: Don't track ripple graphics because they self-destruct
            // after 400ms via tween onComplete. Tracking them causes premature cleanup
            // when activeGraphics limit is reached, making ripples get stuck.

            // In infinity mode, follow camera (scrollFactor=1); in standard mode, stay in screen space (scrollFactor=0)
            ripple.setScrollFactor(isInfinityMode ? 1 : 0);

            debugLog('[SharedEffects] Drawing ripple at screen position:', { x: centerX, y: centerY });

            const rippleHex = this._lockRippleColor(piece);
            const colorInt = parseInt(rippleHex.replace('#', ''), 16) || 0xffffff;

            // Stamp the piece's OWN silhouette, not just a generic ping. A circle
            // from the centroid makes an I-bar and an O-block read identically;
            // the stamp says "this shape landed here". Kept very quiet on purpose:
            // this fires on every lock, dozens of times a minute, so anything
            // showy here would wear thin and flatten the contrast with clears.
            this._playLockStamp(piece, colorInt, isInfinityMode);

            // Create a data object to tween
            const rippleData = { radius: 0, alpha: 0.6 };

            this.scene.tweens.add({
                targets: rippleData,
                radius: this.scene.blockSize * 3,
                alpha: 0,
                duration: 400,
                ease: 'Expo.easeOut', // shockwaves expand fast then settle
                onUpdate: () => {
                    ripple.clear();
                    ripple.lineStyle(3, colorInt, rippleData.alpha);
                    // Draw at screen coordinates (centerX, centerY already calculated correctly)
                    ripple.strokeCircle(centerX, centerY, rippleData.radius);
                },
                onComplete: () => {
                    ripple.destroy();
                },
            });
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
        if (g.setBlendMode && PhaserRef?.BlendModes?.ADD) g.setBlendMode(PhaserRef.BlendModes.ADD);
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
     * This was the one moment in the game with NO playfield reaction at all: you
     * lost, and the results modal simply appeared over a still board. Every other
     * beat had treatment.
     *
     * Deliberately no banner: the modal carries the words a moment later, and a
     * banner would just be in its way. The board itself does the talking — a hard
     * red flash, the longest freeze in the game, then a dark veil that wipes down
     * the well and stays down.
     */
    playGameOver() {
        if (!this.scene?.add?.graphics) return;

        const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const reduced = this._reducedMotion();

        this._screenFlash(0xff2b3d, reduced ? 0.28 : 0.55, 40, 300, 62);
        this._boardEdgePulse(0xff2b3d, reduced ? 0.3 : 0.6);

        // The longest hit-stop in the game. A defeat should land heavier than a
        // perfect clear (110ms), which is the current maximum.
        if (!reduced) this.triggerHitStop(170);
        if (this.scene.shakeCamera) this.scene.shakeCamera(reduced ? 2 : 7, reduced ? 200 : 420);
        this._zoomPunch(reduced ? 0 : 0.03, 420);

        // Veil wipes DOWN the well and holds — the board going dark under you.
        const veil = this.scene.add.graphics();
        veil.setScrollFactor?.(0);
        veil.setDepth?.(58);
        if (veil.setBlendMode && PhaserRef?.BlendModes?.NORMAL) {
            veil.setBlendMode(PhaserRef.BlendModes.NORMAL);
        }
        const wipe = { h: 0 };
        this.scene.tweens.add({
            targets: wipe,
            h: boardHeight,
            duration: reduced ? 260 : 520,
            ease: 'Quart.easeIn', // accelerates downward, like the stack giving way
            onUpdate: () => {
                veil.clear();
                veil.fillStyle(0x120008, 0.62);
                veil.fillRect(0, 0, boardWidth, wipe.h);
            },
        });

        // Held, not faded — the results modal arrives over it.
        const timer = this.scene.time.delayedCall(1600, () => veil.destroy());
        this._trackTimer(timer);
    }

    /**
     * Incoming garbage — rows shoving your stack upward.
     *
     * One of the most consequential things that can happen to you in versus, and
     * it had no playfield reaction: online MP flashed a HUD indicator, local MP
     * played a sound and nothing else. The board never reacted to being hit.
     *
     * Reads from the BOTTOM, because that is where the rows arrive from.
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

        // Warning rail along the floor, flaring upward as the rows land.
        const rail = this.scene.add.graphics();
        rail.setScrollFactor?.(0);
        rail.setDepth?.(7);
        if (rail.setBlendMode && PhaserRef?.BlendModes?.ADD) rail.setBlendMode(PhaserRef.BlendModes.ADD);
        const data = { alpha: reduced ? 0.35 : 0.8, height: bs * rows };
        this.scene.tweens.add({
            targets: data,
            alpha: 0,
            height: bs * rows * 1.6,
            duration: 340,
            ease: 'Expo.easeOut',
            onUpdate: () => {
                rail.clear();
                rail.fillStyle(0xff5a3c, data.alpha * 0.5);
                rail.fillRect(0, boardHeight - data.height, boardWidth, data.height);
                rail.fillStyle(0xffb08a, data.alpha);
                rail.fillRect(0, boardHeight - data.height - 3, boardWidth, 3);
            },
            onComplete: () => rail.destroy(),
        });

        // Dust forced upward out of the floor as the rows shove in.
        if (this.getQualityConfig()?.particles) {
            const emitter = createParticleEmitter(this.scene, 0, boardHeight, this._sparkTextureKey(), {
                emitZone: PhaserRef?.Geom?.Rectangle
                    ? { type: 'random', source: new PhaserRef.Geom.Rectangle(0, -4, boardWidth, 6) }
                    : undefined,
                speed: { min: 70 * power, max: 220 * power },
                angle: { min: -150, max: -30 },
                rotate: -90,
                gravityY: 620,
                lifespan: { min: 260, max: 520 },
                quantity: 0,
                alpha: { start: 0.85, end: 0 },
                scale: { start: 0.75, end: 0.1 },
                blendMode: 'ADD',
                on: false,
                tint: 0xff7a4d,
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

        this._boardEdgePulse(0xff5a3c, Math.min(0.2 + rows * 0.08, 0.5));
        if (this.scene.shakeCamera && !reduced) this.scene.shakeCamera(1.1 * power, 130);
    }

    /**
     * Level up — a light sweep UP the well.
     *
     * The mirror of the game-over wipe, and deliberately not a banner: the HUD
     * already shows the level, and a sixth banner competing for screen space would
     * work against the ones that carry real weight.
     *
     * @param {number} [level=1]
     */
    playLevelUp(level = 1) {
        if (!this.scene?.add?.graphics) return;

        const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const reduced = this._reducedMotion();
        const band = Math.max(60, boardHeight * 0.16);

        const sweep = this.scene.add.graphics();
        sweep.setScrollFactor?.(0);
        sweep.setDepth?.(8);
        if (sweep.setBlendMode && PhaserRef?.BlendModes?.ADD) sweep.setBlendMode(PhaserRef.BlendModes.ADD);

        // Driven off ONE progress value, with alpha held rather than tweened.
        //
        // Tweening alpha on the same easeOut curve as the position made the sweep
        // invisible: easeOut front-loads its change, so alpha was down to ~0.10 by
        // the halfway point and ~0.03 at three-quarters. The band faded out near
        // the bottom of the well — behind the stack — and never read at all.
        // It now holds full strength for the first 70% of the travel and fades
        // only on the way out.
        const peak = reduced ? 0.3 : 0.6;
        const travel = boardHeight + band * 2;
        const state = { t: 0 };
        this.scene.tweens.add({
            targets: state,
            t: 1,
            duration: 720,
            ease: 'Sine.easeOut',
            onUpdate: () => {
                const y = boardHeight + band - state.t * travel;
                const fade = state.t < 0.7 ? 1 : 1 - (state.t - 0.7) / 0.3;
                const a = peak * fade;
                sweep.clear();
                sweep.fillStyle(0x7fe8ff, a * 0.5);
                sweep.fillRect(0, y, boardWidth, band);
                sweep.fillStyle(0xd8fbff, a);
                sweep.fillRect(0, y + band - 4, boardWidth, 4);
            },
            onComplete: () => sweep.destroy(),
        });

        this._boardEdgePulse(0x7fe8ff, 0.4);
        this._zoomPunch(0.008, 200);
        debugLog(`[SharedEffects] Level up -> ${level}`);
    }

    /**
     * Shared banner: snap → hold → release, with a skewed band behind it.
     *
     * The combo popup was rebuilt on this timeline while T-spin, back-to-back,
     * mega cascade and perfect clear were left on the original pattern — a single
     * tween fading from frame one. That left the game's BIGGEST moment (perfect
     * clear) with a weaker banner than a 2x combo, and four near-identical copies
     * of the same thirty lines. This is that shape, once.
     *
     * @param {Object} cfg
     * @param {string} cfg.title - Main line.
     * @param {string} [cfg.lead] - Optional oversized lead (e.g. a cascade count).
     * @param {string} [cfg.subtitle] - Optional small line under the title.
     * @param {number} cfg.y - Screen-space vertical anchor.
     * @param {string} [cfg.fill] @param {string} [cfg.stroke] @param {number} [cfg.accent]
     * @param {number} [cfg.titleSize] @param {number} [cfg.leadSize] @param {number} [cfg.subtitleSize]
     * @param {number} [cfg.bandAlpha] @param {number} [cfg.hold] @param {number} [cfg.depth]
     * @returns {Object|null} the container, or null if one could not be made
     * @private
     */
    _showBanner({
        title,
        lead = null,
        subtitle = null,
        y,
        fill = '#ffffff',
        stroke = '#000000',
        accent = 0xffffff,
        titleSize = 34,
        leadSize = 72,
        subtitleSize = 20,
        bandAlpha = 0.34,
        hold = 260,
        depth = 55,
    }) {
        const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const u = (this.scene.blockSize || 40) / 40;
        const reduced = this._reducedMotion();
        const originX = boardWidth / 2;

        const container = this.scene.add.container?.(originX, y);
        if (!container) {
            // Stubbed scene: a plain label beats nothing at all.
            const plain = this.scene.add.text(originX, y, lead ? `${lead} ${title}` : title, {
                fontSize: `${Math.round(titleSize * u)}px`, fontFamily: 'Orbitron', color: fill,
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

        const mk = (text, size, thick) => {
            const t = this.scene.add.text(0, 0, text, {
                fontSize: `${Math.round(size * u)}px`,
                fontFamily: 'Orbitron',
                fontStyle: 'bold',
                color: fill,
                stroke,
                strokeThickness: Math.max(2, Math.round(thick * u)),
                align: 'center',
            });
            t.setOrigin(0.5);
            return t;
        };

        // Lead first when present, so the band can be sized off the tallest text.
        const head = lead ? mk(lead, leadSize, 7) : mk(title, titleSize, 5);
        const boxH = head.height || titleSize * 1.2 * u;
        const bandCenterY = -boxH * 0.19; // glyphs ride high in the text box
        const bandH = Math.round(boxH * 0.72);
        const bandW = Math.round(Math.max(head.width * 1.35, titleSize * 4 * u));
        const skew = Math.round(14 * u);
        const top = bandCenterY - bandH / 2;
        const bottom = bandCenterY + bandH / 2;

        const band = this.scene.add.graphics();
        band.fillStyle(accent, bandAlpha);
        band.fillPoints([
            { x: -bandW / 2 + skew, y: top },
            { x: bandW / 2, y: top },
            { x: bandW / 2 - skew, y: bottom },
            { x: -bandW / 2, y: bottom },
        ], true);
        band.lineStyle(Math.max(2, Math.round(2.5 * u)), accent, Math.min(1, bandAlpha + 0.45));
        band.beginPath();
        band.moveTo(-bandW / 2 + skew, top);
        band.lineTo(bandW / 2, top);
        band.strokePath();
        band.beginPath();
        band.moveTo(-bandW / 2, bottom);
        band.lineTo(bandW / 2 - skew, bottom);
        band.strokePath();
        if (band.setBlendMode && PhaserRef?.BlendModes?.ADD) band.setBlendMode(PhaserRef.BlendModes.ADD);
        band.scaleX = 0;
        container.add(band);
        container.add(head);

        let nextY = bottom + 4 * u;
        if (lead) {
            const caption = mk(title, titleSize, 4);
            caption.setOrigin(0.5, 0);
            caption.y = Math.round(nextY);
            container.add(caption);
            nextY += (caption.height || titleSize * u) * 0.9;
        }
        if (subtitle) {
            const sub = mk(subtitle, subtitleSize, 4);
            sub.setOrigin(0.5, 0);
            sub.y = Math.round(nextY);
            container.add(sub);
        }

        // ─── snap → settle → HOLD → release (same beats as the combo popup) ───
        const SNAP = 50;
        const SETTLE = 60;
        const EXIT = 120;
        container.setScale(0);
        this.scene.tweens.add({
            targets: container, scale: reduced ? 1 : 1.28, duration: SNAP, ease: 'Back.easeOut',
        });
        this.scene.tweens.add({
            targets: container, scale: 1, delay: SNAP, duration: SETTLE, ease: 'Quad.easeOut',
        });
        this.scene.tweens.add({
            targets: container,
            scale: 0.9,
            alpha: 0,
            y: y - 22 * u,
            delay: SNAP + SETTLE + hold,
            duration: EXIT,
            ease: 'Quint.easeIn',
            onComplete: () => container.destroy(),
        });
        this.scene.tweens.add({
            targets: band, scaleX: 1, duration: 90, ease: 'Expo.easeOut',
        });

        return container;
    }

    _comboTier(comboCount) {
        if (comboCount >= 10) {
            return {
                numberSize: 84, labelSize: 22, fill: '#ffffff', stroke: '#5a0030', accent: 0xff2d6f, bandAlpha: 0.5, shake: 2.2,
            };
        }
        if (comboCount >= 7) {
            return {
                numberSize: 72, labelSize: 20, fill: '#ffe9d6', stroke: '#5a1500', accent: 0xff6a1a, bandAlpha: 0.42, shake: 1.4,
            };
        }
        if (comboCount >= 4) {
            return {
                numberSize: 64, labelSize: 19, fill: '#fff3c4', stroke: '#4a3200', accent: 0xffc400, bandAlpha: 0.36, shake: 0,
            };
        }
        return {
            numberSize: 56, labelSize: 18, fill: '#ffffff', stroke: '#0a3f53', accent: 0x7ff3ff, bandAlpha: 0.3, shake: 0,
        };
    }

    /**
     * Combo popup — arcade-style snap → hold → release.
     *
     * The previous popup was a single 800ms Cubic fade that began dying on frame
     * one, centred directly over the stack. Three things changed:
     *
     *  - TIMING. Arcade juice holds. Snap in with overshoot (50ms), settle (60ms),
     *    HOLD at full alpha (270ms), then exit fast (120ms). Shorter overall than
     *    before, but the hold is what makes it read as a decided hit rather than
     *    a drift, and it is what makes the number legible.
     *  - HIERARCHY. A big number with a small COMBO caption; the digits are the
     *    payload, the word is just a label.
     *  - PLACEMENT. Moved out of dead centre into the upper third, so it stops
     *    covering the stack you are reading. (The canvas is exactly the playfield
     *    — cols * blockSize wide — so there is no side gutter to use instead.)
     *
     * Sizes scale with blockSize so the popup holds up on any board size.
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

        // Guarded (unlike the older methods in this file) so the popup can be
        // exercised headlessly — every use below is already optional-chained.
        const PhaserRef = typeof window !== 'undefined' ? window.Phaser : null;
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const u = (this.scene.blockSize || 40) / 40; // scale with board size
        const reduced = this._reducedMotion();
        const tier = this._comboTier(comboCount);

        // Upper third: clear of the stack in normal play, and clear of the
        // cascade/perfect-clear banners which own the centre.
        const originX = boardWidth / 2;
        const originY = boardHeight * 0.28;

        const container = this.scene.add.container?.(originX, originY);
        if (!container) {
            // Very old/stubbed scene: fall back to a plain label rather than nothing.
            const plain = this.scene.add.text(originX, originY, `${comboCount}x COMBO`, {
                fontSize: `${Math.round(tier.numberSize * u * 0.6)}px`, fontFamily: 'Orbitron', color: tier.fill,
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
            fontFamily: 'Orbitron',
            fontStyle: 'bold',
            color: tier.fill,
            stroke: tier.stroke,
            strokeThickness: Math.max(4, Math.round(7 * u)),
        };

        // 1. The number first, so the band can be sized from its MEASURED box
        //    rather than a guessed multiple of the font size. Phaser's text box is
        //    much taller than the glyphs (103px box for an 84px font) and the
        //    glyphs sit high inside it — a band centred on the box lands ~20% low
        //    and the digits spill out of the top.
        const number = this.scene.add.text(0, 0, String(comboCount), numFont);
        number.setOrigin(0.5);
        const boxH = number.height || tier.numberSize * 1.2 * u;
        const bandCenterY = -boxH * 0.19; // glyph centre, not box centre
        const bandH = Math.round(boxH * 0.72);
        const bandW = Math.round(Math.max(number.width * 1.9, tier.numberSize * 2.4 * u));
        const skew = Math.round(14 * u);

        // 2. Skewed band — a graphic anchor so the text is not floating on nothing.
        //    Bright edge rails top and bottom; the fill alone reads muddy.
        const band = this.scene.add.graphics();
        const top = bandCenterY - bandH / 2;
        const bottom = bandCenterY + bandH / 2;
        band.fillStyle(tier.accent, tier.bandAlpha);
        band.fillPoints([
            { x: -bandW / 2 + skew, y: top },
            { x: bandW / 2, y: top },
            { x: bandW / 2 - skew, y: bottom },
            { x: -bandW / 2, y: bottom },
        ], true);
        band.lineStyle(Math.max(2, Math.round(2.5 * u)), tier.accent, Math.min(1, tier.bandAlpha + 0.45));
        band.beginPath();
        band.moveTo(-bandW / 2 + skew, top);
        band.lineTo(bandW / 2, top);
        band.strokePath();
        band.beginPath();
        band.moveTo(-bandW / 2, bottom);
        band.lineTo(bandW / 2 - skew, bottom);
        band.strokePath();
        if (band.setBlendMode && PhaserRef?.BlendModes?.ADD) band.setBlendMode(PhaserRef.BlendModes.ADD);
        band.scaleX = 0; // wipes in
        container.add(band);

        // 3. Echo — an expanding low-alpha duplicate. Cheap, and very arcade.
        const echo = this.scene.add.text(0, 0, String(comboCount), { ...numFont, stroke: undefined, strokeThickness: 0 });
        echo.setOrigin(0.5);
        echo.setAlpha(0.3);
        if (echo.setBlendMode && PhaserRef?.BlendModes?.ADD) echo.setBlendMode(PhaserRef.BlendModes.ADD);
        container.add(echo);

        // 4. Fake chromatic aberration. There is no post-FX pipeline on the board
        // canvas, so the fringe is drawn: red/cyan copies offset behind the number.
        if (!reduced) {
            [[-1.6 * u, '#ff0040'], [1.6 * u, '#00d4ff']].forEach(([dx, color]) => {
                const ghost = this.scene.add.text(dx, 0, String(comboCount), {
                    ...numFont, color, stroke: undefined, strokeThickness: 0,
                });
                ghost.setOrigin(0.5);
                ghost.setAlpha(0.55);
                if (ghost.setBlendMode && PhaserRef?.BlendModes?.ADD) ghost.setBlendMode(PhaserRef.BlendModes.ADD);
                container.add(ghost);
            });
        }

        container.add(number); // in front of the ghosts it fringes

        // 5. Caption, top-aligned just under the band so the two never collide.
        const label = this.scene.add.text(0, Math.round(bottom + 4 * u), 'COMBO', {
            fontSize: `${Math.round(tier.labelSize * u)}px`,
            fontFamily: 'Orbitron',
            fontStyle: 'bold',
            color: tier.fill,
            stroke: tier.stroke,
            strokeThickness: Math.max(2, Math.round(4 * u)),
        });
        label.setOrigin(0.5, 0);
        container.add(label);

        // ─── Timeline: snap → settle → HOLD → release ───────────────────────
        const SNAP = 50;
        const SETTLE = 60;
        const HOLD = 270;
        const EXIT = 120;
        const holdStart = SNAP + SETTLE;
        const exitStart = holdStart + HOLD;

        container.setScale(0);
        this.scene.tweens.add({
            targets: container,
            scale: reduced ? 1 : 1.3,
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

        // Band wipe, timed to arrive just behind the snap.
        this.scene.tweens.add({
            targets: band,
            scaleX: 1,
            duration: 90,
            ease: 'Expo.easeOut',
        });

        // Echo expands out of the number and dissolves.
        this.scene.tweens.add({
            targets: echo,
            scale: 1.6,
            alpha: 0,
            delay: SNAP,
            duration: 320,
            ease: 'Cubic.easeOut',
        });

        // Micro-jitter during the hold sells weight at high tiers only.
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

        // Trigger background explosion particles for combos
        if (comboCount >= 2) {
            this.spawnComboExplosionParticles(comboCount);
        }
    }

    /**
     * Play a subtle camera shake and intensify particle bursts based on line count
     * @param {number} lineCount - Number of lines cleared simultaneously
     */
    playLineClearImpact(lineCount = 1) {
        if (!this._effectEnabled('lineClearEffects')) return;
        const clampedLineCount = Math.max(1, Math.min(4, lineCount));
        const tier = this.getClearTier(lineCount);
        const reduced = this._reducedMotion();

        // Call shakeCamera on the scene (defined in base-board-scene.js).
        // The base scene's shakeCamera method already handles quality multiplier.
        // Shake magnitude + duration now escalate with the clear tier.
        if (this.scene.shakeCamera) {
            const magnitude = reduced ? tier.shake * 0.4 : tier.shake;
            this.scene.shakeCamera(magnitude, tier.shakeDur);
        }

        // Hit-stop punch on the biggest clears (Tetris+) for a visceral impact.
        if (tier.hitStop && !reduced) {
            this.triggerHitStop(tier.hitStop);
        }

        // Zoom kick scaled to the clear. Unlike the hit-stop this is purely
        // visual, so every tier gets one — a single reads as a tap, a quad as a hit.
        this._zoomPunch(0.004 + (tier.shake / 4.2) * 0.014, 120 + tier.shakeDur * 0.2);

        // Increase particle intensity for this frame, boosted by the clear tier.
        this.lastImpactIntensity = clampedLineCount * tier.particleBoost;
    }

    /**
     * Create transient particle bursts across cleared rows
     * Uses compatibility layer for Phaser 3/4 support
     * @param {Array<number>} clearedRows - World row indices that were cleared
     */
    spawnLineClearParticles(clearedRows) {
        if (!clearedRows || clearedRows.length === 0) return;
        if (!this.scene.textures.exists(this.lineClearParticleKey)) return;
        if (!this.getQualityConfig()?.particles) return;

        const intensity = Math.max(1, this.lastImpactIntensity || clearedRows.length);
        // Apply combo multiplier to make effects more dramatic
        const comboMultiplier = this.currentComboCount > 0 ? (1 + (this.currentComboCount * 0.5)) : 1;
        const totalIntensity = intensity * comboMultiplier;

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const PhaserRef = window.Phaser;

        if (!PhaserRef || !PhaserRef.Geom || !PhaserRef.Geom.Rectangle) {
            console.warn('[SharedEffects] Phaser.Geom.Rectangle not available, particles disabled');
            return;
        }

        // PARTICLE BATCHING: For mega cascades (10+ lines), reduce particle count to prevent lag
        // Instead of spawning particles for every row, sample rows and increase intensity
        let processedRows = clearedRows;
        let intensityBoost = 1;

        if (clearedRows.length >= 20) {
            // 20+ lines: Only spawn particles for every 3rd row, triple intensity
            processedRows = clearedRows.filter((_, i) => i % 3 === 0);
            intensityBoost = 2.5;
            debugLog(`[SharedEffects] Mega cascade batching: ${clearedRows.length} → ${processedRows.length} rows (3x sampling)`);
        } else if (clearedRows.length >= 10) {
            // 10-19 lines: Only spawn particles for every 2nd row, double intensity
            processedRows = clearedRows.filter((_, i) => i % 2 === 0);
            intensityBoost = 1.8;
            debugLog(`[SharedEffects] Large cascade batching: ${clearedRows.length} → ${processedRows.length} rows (2x sampling)`);
        }

        const isInfinityMode = Boolean(this.scene.gameState?.isInfinityMode);
        const sparkKey = this._sparkTextureKey();

        processedRows.forEach((row, index) => {
            // In infinity mode, use world coordinates; in standard mode, use screen coordinates
            let zoneY;
            if (isInfinityMode) {
                // World coordinates: row * blockSize (will follow camera)
                zoneY = row * this.scene.blockSize;
            } else {
                // Screen coordinates: (row - hiddenRows) * blockSize
                zoneY = (row - this.scene.hiddenRows) * this.scene.blockSize;
            }

            debugLog('[SharedEffects] Spawning particles for row', row, {
                mode: isInfinityMode ? 'infinity' : 'standard',
                hiddenRows: this.scene.hiddenRows,
                blockSize: this.scene.blockSize,
                zoneY,
                boardWidth,
            });

            // Use compatibility layer to create particles
            // Apply intensity boost for batched mega cascades
            const finalIntensity = totalIntensity * intensityBoost;

            const emitter = createParticleEmitter(this.scene, 0, zoneY, sparkKey, {
                emitZone: {
                    type: 'random',
                    source: new PhaserRef.Geom.Rectangle(0, 0, boardWidth, this.scene.blockSize),
                },
                speed: { min: 90 * comboMultiplier * intensityBoost, max: 220 * finalIntensity },
                angle: { min: -110, max: -70 },
                // Streaks point up, matching the centre of that 40° cone. A round
                // dot has no direction, so the burst read as a cloud however fast
                // it moved; an aligned streak reads as speed.
                rotate: -90,
                lifespan: { min: 350, max: RIPPLE_PARTICLE_LIFESPAN * Math.min(comboMultiplier * intensityBoost, 2) },
                quantity: 0, // Required for explode
                alpha: { start: 0.9, end: 0 },
                scale: { start: 0.85 * Math.min(comboMultiplier * intensityBoost, 1.8), end: 0 },
                gravityY: 400,
                blendMode: 'ADD',
                on: false, // Emitter is not started automatically
                tint: this.getComboTint(this.currentComboCount, index),
            });

            // If particle creation failed, skip this row
            if (!emitter) {
                console.warn('[SharedEffects] Failed to create line clear particles for row', row);
                return;
            }

            if (emitter.setDepth) {
                emitter.setDepth(5);
            }

            // In infinity mode, follow camera (scrollFactor=1); in standard mode, stay in screen space (scrollFactor=0)
            if (emitter.setScrollFactor) {
                emitter.setScrollFactor(isInfinityMode ? 1 : 0);
            }

            // More particles for bigger combos, scaled by intensity boost.
            // Density-scaled so the fountain supports the debris instead of burying it.
            const burstAmount = Math.max(4, Math.round(18 * finalIntensity * FOUNTAIN_DENSITY));
            const emitSuccess = emitParticles(emitter, burstAmount);

            if (!emitSuccess) {
                console.warn('[SharedEffects] Failed to emit particles');
                destroyParticleEmitter(emitter);
                return;
            }

            // The emitter is now the game object to be managed
            const timer = this.scene.time.delayedCall(RIPPLE_PARTICLE_LIFESPAN, () => {
                if (emitter) {
                    destroyParticleEmitter(emitter);
                    this.activeParticleSystems.delete(emitter);
                }
            });

            // PERFORMANCE: Track timer for cleanup
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
            return this.scene.colorToInt(colorValue) || 0xffffff;
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

        ensureSquareTexture(this.scene, SHARD_TEXTURE_KEY, SHARD_TEXTURE_SIZE, 0xffffff, 1);
        if (!this.scene.textures?.exists?.(SHARD_TEXTURE_KEY)) return;

        const bs = this.scene.blockSize;
        // A shard must read as a FRAGMENT OF A BLOCK. At a fixed 6px it vanished
        // against 40px cells, so scale it off the block size (~1/3 of a cell).
        const shardScale = (bs / 40) * ((bs * 0.3) / SHARD_TEXTURE_SIZE);
        const isInfinityMode = Boolean(this.scene.gameState?.isInfinityMode);
        const reduced = this._reducedMotion();
        const perCell = reduced ? 1 : SHARDS_PER_CELL;

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

        byColor.forEach((cells, colorInt) => {
            const emitter = createParticleEmitter(this.scene, 0, 0, SHARD_TEXTURE_KEY, {
                speed: { min: 60 * (reduced ? 0.5 : 1), max: 230 * (reduced ? 0.5 : 1) },
                angle: { min: -170, max: -10 }, // upward fan; gravity brings them down
                gravityY: 900, // heavy, so chunks fall like debris instead of drifting like embers
                lifespan: { min: 380, max: SHARD_LIFESPAN },
                quantity: 0,
                alpha: { start: 1, end: 0 },
                // Stays chunky — shards are debris, they do not evaporate.
                scale: { start: shardScale, end: shardScale * 0.35 },
                rotate: { min: 0, max: 360 },
                blendMode: 'NORMAL', // NOT additive: the cell's own colour must read true
                on: false,
                tint: colorInt,
            });
            if (!emitter) return;

            emitter.setDepth?.(6); // above the stack, below the flash stripes
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
        if (!this.scene.textures.exists(this.lineClearParticleKey)) return;
        if (!this.getQualityConfig()?.particles) return;

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const centerX = boardWidth / 2;
        // Radiate from the clear that caused this, not from mid-board.
        const centerY = this._effectOriginY();

        // Scale effect intensity with combo count
        const explosionIntensity = Math.min(comboCount, 8);
        const particleCount = Math.round(40 * explosionIntensity);
        const explosionSpeed = 150 + (comboCount * 30);

        // Create multiple explosion bursts for higher combos
        const burstCount = Math.min(Math.floor(comboCount / 2), 5);

        for (let burst = 0; burst < burstCount; burst++) {
            // Delay each burst slightly for cascade effect
            this.scene.time.delayedCall(burst * 100, () => {
                // Random position near center for variety
                const offsetX = (Math.random() - 0.5) * boardWidth * 0.3;
                const offsetY = (Math.random() - 0.5) * boardHeight * 0.3;

                // Use compatibility layer
                const emitter = createParticleEmitter(
                    this.scene,
                    centerX + offsetX,
                    centerY + offsetY,
                    this.lineClearParticleKey,
                    {
                        speed: { min: explosionSpeed * 0.5, max: explosionSpeed },
                        angle: { min: 0, max: 360 }, // Full 360-degree explosion
                        lifespan: { min: 600, max: 1000 },
                        quantity: 0,
                        alpha: { start: 0.95, end: 0 },
                        scale: { start: 1.2 * Math.min(explosionIntensity / 4, 2), end: 0.1 },
                        gravityY: 200,
                        blendMode: 'ADD',
                        on: false,
                        tint: this.getComboTint(comboCount, burst),
                    },
                );

                if (!emitter) {
                    console.warn('[SharedEffects] Failed to create combo explosion particles');
                    return;
                }

                if (emitter.setDepth) {
                    emitter.setDepth(4); // Behind line clear particles but above board
                }

                // Particles ignore camera scroll - positioned in screen coordinates
                if (emitter.setScrollFactor) {
                    emitter.setScrollFactor(0);
                }

                // Explode with scaled particle count
                emitParticles(emitter, Math.round(particleCount / burstCount));

                this.scene.time.delayedCall(1200, () => {
                    if (emitter) {
                        destroyParticleEmitter(emitter);
                        this.activeParticleSystems.delete(emitter);
                    }
                });

                this.activeParticleSystems.add(emitter);
            });
        }

        // Add extra radial burst for very high combos (5+)
        if (comboCount >= 5) {
            this.scene.time.delayedCall(150, () => {
                this.spawnRadialWave(comboCount);
            });
        }
    }

    /**
     * Spawn a radial wave effect for extreme combos.
     *
     * ONE emitter for the whole ring. This used to allocate an emitter *per
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
        if (!this.scene.textures.exists(this.lineClearParticleKey)) return;
        if (!this.getQualityConfig()?.particles) return;

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const centerX = boardWidth / 2;
        // Radiate from the clear that caused this, not from mid-board.
        const centerY = Number.isFinite(originY) ? originY : this._effectOriginY();

        const ringParticleCount = Math.round(60 + (comboCount * 10));
        const waveSpeed = 200 + (comboCount * 20);

        // Per-particle tint: an array cycles across the burst the same way the
        // old loop's `getComboTint(comboCount, i)` did. Built via getComboTint so
        // a scene-level palette override still applies.
        const tint = comboCount >= 5
            ? Array.from({ length: 7 }, (_, i) => this.getComboTint(comboCount, i))
            : this.getComboTint(comboCount, 0);

        const emitter = createParticleEmitter(this.scene, centerX, centerY, this._sparkTextureKey(), {
            angle: { start: 0, end: 360, steps: ringParticleCount },
            // Same start/end/steps as `angle`, so both ops walk the sequence in
            // lockstep and every streak points exactly along its own travel
            // direction — an aligned ring rather than a ring of tumbling dashes.
            rotate: { start: 0, end: 360, steps: ringParticleCount },
            speed: waveSpeed, // exact, not a range — constant speed keeps the ring circular
            lifespan: { min: 500, max: 800 },
            quantity: 0, // required for explode()
            alpha: { start: 1, end: 0 },
            scale: { start: 1.5, end: 0.3 },
            gravityY: 0, // No gravity for clean ring expansion
            blendMode: 'ADD',
            on: false,
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
        // combo 0.28, T-spin 0.375, perfect clear 0.50, cascade 0.62.
        this._showBanner({
            lead: `${cascadeCount}`,
            title: 'CASCADE',
            y: boardHeight * 0.62,
            leadSize: cascadeCount >= 20 ? 86 : 74,
            titleSize: 24,
            fill: '#ffffff',
            stroke: '#20104a',
            accent: 0x9a6bff,
            bandAlpha: 0.42,
            hold: 320,
            depth: 56,
        });

        // Camera shake - more intense for mega cascades
        if (this.scene.shakeCamera) {
            const shakeDuration = 400 + (cascadeCount * 20);
            this.scene.shakeCamera(Math.min(cascadeCount / 2, 8), shakeDuration);
        }
    }

    /**
     * Perfect Clear ("All Clear") celebration - the game's flagship moment.
     * A white supernova flash, concentric shockwaves, a radial particle burst,
     * a strong shake + hit-stop, and a celebratory banner.
     * @param {number} [depth=0] - Total lines cleared in the run that emptied the board
     */
    playPerfectClear(depth = 0) {
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const centerX = boardWidth / 2;
        const centerY = boardHeight / 2;
        const reduced = this._reducedMotion();

        // Supernova core flash.
        this._screenFlash(0xffffff, reduced ? 0.35 : 0.72, 60, 460, 60);

        // Concentric shockwave rings expanding outward together.
        const ringColor = 0x9ff7ff;
        for (let i = 0; i < 3; i++) {
            this.createShockwaveRing(centerX, centerY, ringColor, 1 + i);
        }

        // Radial particle burst (reuses the high-combo wave, scaled by depth).
        if (this.getQualityConfig()?.particles
            && this.scene.textures?.exists?.(this.lineClearParticleKey)) {
            // Board centre, explicitly: an emptied board has no clear to radiate
            // from, and this keeps the wave concentric with the rings and flash.
            this.spawnRadialWave(Math.max(6, Math.min(depth + 4, 14)), centerY);
        }

        // Strong shake + hit-stop for weight.
        if (this.scene.shakeCamera) {
            this.scene.shakeCamera(reduced ? 2 : 6, reduced ? 240 : 460);
        }
        if (!reduced) {
            this.triggerHitStop(110);
        }
        this._zoomPunch(0.028, 320); // the flagship moment gets the biggest kick

        // Celebration banner. The longest hold in the game — this is the moment
        // the whole effect stack exists to sell.
        this._showBanner({
            title: 'PERFECT',
            subtitle: 'CLEAR',
            y: centerY,
            titleSize: 46,
            subtitleSize: 26,
            fill: '#ffffff',
            stroke: '#0a3f53',
            accent: 0x9ff7ff,
            bandAlpha: 0.5,
            hold: 520,
            depth: 60,
        });
    }

    /**
     * Create a single shockwave ring effect
     * @param {number} centerX - Center X position
     * @param {number} centerY - Center Y position
     * @param {number} color - Ring color
     * @param {number} index - Ring index for delay
     */
    createShockwaveRing(centerX, centerY, color, index) {
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;

        const ringGraphics = this.scene.add.graphics();
        ringGraphics.setScrollFactor(0);
        ringGraphics.setDepth(8);

        const ringData = { radius: 20 * index, alpha: 0.6, thickness: 4 };

        this.scene.tweens.add({
            targets: ringData,
            radius: Math.max(boardWidth, boardHeight) * 1.2,
            alpha: 0,
            thickness: 1,
            duration: 600,
            ease: 'Expo.easeOut', // shockwaves expand fast then settle
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
            if (old && !old.scene) { // Check if not already destroyed
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
            if (old && !old.scene) { // Check if not already destroyed
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
     * Play hard drop visual effect
     * @param {Object} dropData - Data about the hard drop
     * @param {Object} dropData.piece - The piece that was dropped
     * @param {number} dropData.startY - The start Y grid coordinate
     * @param {number} dropData.endY - The end Y grid coordinate
     */
    playHardDropEffect(dropData) {
        if (!dropData || !dropData.piece || dropData.startY === dropData.endY) return;

        const { piece, startY, endY } = dropData;
        const colorHex = this.getPieceColor(piece, '#ffffff');
        const colorInt = parseInt(colorHex.replace('#', ''), 16) || 0xffffff;

        const isInfinityMode = Boolean(this.scene.gameState?.isInfinityMode);

        let startScreenY, endScreenY;

        if (isInfinityMode) {
            startScreenY = startY * this.scene.blockSize;
            endScreenY = endY * this.scene.blockSize;
        } else {
            startScreenY = (startY - this.scene.hiddenRows) * this.scene.blockSize;
            endScreenY = (endY - this.scene.hiddenRows) * this.scene.blockSize;
        }

        const screenX = piece.x * this.scene.blockSize;

        // Calculate the actual visual width and offset of the piece within its matrix
        let minX = 4, maxX = -1;
        piece.shape.forEach((row) => {
            row.forEach((cell, cX) => {
                if (cell > 0) {
                    minX = Math.min(minX, cX);
                    maxX = Math.max(maxX, cX);
                }
            });
        });

        const pieceWidth = (maxX - minX + 1) * this.scene.blockSize;
        const displayScreenX = screenX + (minX * this.scene.blockSize);
        const displayCenterX = displayScreenX + pieceWidth / 2;
        const dropHeight = endScreenY - startScreenY;
        const finalDropHeight = dropHeight + this.scene.blockSize;

        if (typeof window !== 'undefined' && /[?&]debugEffects=1\b/.test(window.location?.search || '')) {
            console.log('[SharedEffects] Rendering playHardDropEffect: ', {
                pieceShape: piece.shape,
                isInfinityMode,
                hiddenRows: this.scene.hiddenRows,
                startY,
                endY,
                startScreenY,
                endScreenY,
                dropHeight,
                finalDropHeight,
                displayCenterX,
                pieceWidth,
                colorHex,
                colorInt,
            });
        }

        const PhaserRef = window.Phaser;

        // 1. Drop Path Beam Effect (Masterpiece Layered Gradient)
        const beamGraphics = this.scene.add.graphics();
        this._trackGraphics(beamGraphics);
        beamGraphics.setScrollFactor(isInfinityMode ? 1 : 0);
        beamGraphics.setPosition(displayCenterX, startScreenY);

        if (beamGraphics.setBlendMode && PhaserRef?.BlendModes?.ADD) {
            beamGraphics.setBlendMode(PhaserRef.BlendModes.ADD);
        }

        // Draw Outer Glow (wide, colored, vertical gradient)
        if (beamGraphics.fillGradientStyle) {
            beamGraphics.fillGradientStyle(colorInt, colorInt, colorInt, colorInt, 0.0, 0.0, 0.6, 0.6);
        } else {
            beamGraphics.fillStyle(colorInt, 0.3);
        }
        beamGraphics.fillRect(-pieceWidth * 0.8, 0, pieceWidth * 1.6, finalDropHeight);

        // Draw Inner Core (narrow, hot white, vertical gradient)
        if (beamGraphics.fillGradientStyle) {
            beamGraphics.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 0.0, 0.0, 1.0, 1.0);
        } else {
            beamGraphics.fillStyle(0xffffff, 0.8);
        }
        beamGraphics.fillRect(-pieceWidth * 0.2, 0, pieceWidth * 0.4, finalDropHeight);

        this.scene.tweens.add({
            targets: beamGraphics,
            alpha: { from: 1, to: 0 },
            scaleX: { from: 1, to: 0.1 },
            duration: 350,
            ease: 'Expo.easeOut', // Sharp, punchy decay
            onComplete: () => {
                beamGraphics.destroy();
            },
        });

        // 2. Impact Burst (Masterpiece Shockwave + Flash)
        const burstGraphics = this.scene.add.graphics();
        this._trackGraphics(burstGraphics);
        burstGraphics.setScrollFactor(isInfinityMode ? 1 : 0);

        // Bottom of the piece grid area
        let maxY = -1;
        piece.shape.forEach((row, rY) => {
            row.forEach((cell) => {
                if (cell > 0) maxY = Math.max(maxY, rY);
            });
        });
        const burstY = endScreenY + (maxY + 1) * this.scene.blockSize;
        burstGraphics.setPosition(displayCenterX, burstY);

        if (burstGraphics.setBlendMode && PhaserRef?.BlendModes?.ADD) {
            burstGraphics.setBlendMode(PhaserRef.BlendModes.ADD);
        }

        const burstData = {
            radius: pieceWidth * 0.5, alpha: 0.6, thickness: 4, coreScale: 1,
        };

        this.scene.tweens.add({
            targets: burstData,
            radius: pieceWidth * 1.5,
            alpha: 0,
            thickness: 1, // NOT 0: sub-pixel strokes antialias into a shimmering hairline
            coreScale: 0,
            duration: 300,
            ease: 'Expo.easeOut', // impact decay
            onUpdate: () => {
                burstGraphics.clear();

                // Expanding shockwave ring. Alpha carries the fade; the stroke
                // never thins past a whole pixel.
                burstGraphics.lineStyle(Math.max(1, burstData.thickness), colorInt, burstData.alpha * 0.8);
                burstGraphics.strokeEllipse(0, 0, burstData.radius * 2, burstData.radius * 0.8);

                // Subtle central flash
                burstGraphics.fillStyle(0xffffff, burstData.alpha * 0.5);
                burstGraphics.fillEllipse(0, 0, (pieceWidth * 0.6) * burstData.coreScale, (pieceWidth * 0.25) * burstData.coreScale);
            },
            onComplete: () => {
                burstGraphics.destroy();
            },
        });
    }

    /**
     * T-spin celebration: floaty "T-SPIN" banner + swirling vortex particles.
     * @param {number} [lineCount=0] - Lines cleared with the T-spin (0 = T-spin mini/zero).
     */
    playTSpinEffect(lineCount = 0) {
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const centerX = boardWidth / 2;
        const centerY = boardHeight / 2;

        // "T-SPIN" leads; the line count is the qualifier beneath it.
        const qualifiers = [null, 'SINGLE', 'DOUBLE', 'TRIPLE'];
        this._showBanner({
            title: 'T-SPIN',
            subtitle: qualifiers[Math.min(lineCount, 3)],
            y: centerY * 0.75,
            titleSize: lineCount >= 2 ? 38 : 32,
            subtitleSize: 22,
            fill: '#e8ccff',
            stroke: '#220044',
            accent: 0xaa33ff,
            bandAlpha: 0.4,
            hold: 280,
            depth: 55,
        });

        // Swirl: expanding ring in purple/violet.
        //
        // The banner and ring stay — a T-spin is skill and deserves to be marked.
        // The full-board border pulse and the purple screen flash do not: they
        // tint the entire frame for a single piece placement, which is the class
        // of flourish that made single player read as busy against local MP.
        this.createShockwaveRing(centerX, centerY, 0xcc44ff, 1);
    }

    /**
     * Back-to-Back indicator: a charged "B2B" banner that pops in.
     * @param {boolean} [active=true] - Whether a B2B was just scored (always true when called).
     */
    playB2BChange(active = true) {
        if (!active) return;

        const boardHeight = this.scene.rows * this.scene.blockSize;

        // Sits high, out of the way of the combo popup and the centre banners.
        this._showBanner({
            title: 'BACK-TO-BACK',
            y: boardHeight * 0.18,
            titleSize: 26,
            fill: '#fff0b8',
            stroke: '#553300',
            accent: 0xffcc00,
            bandAlpha: 0.38,
            hold: 240,
            depth: 54,
        });

        // The gold banner carries it. No border pulse — see playTSpinEffect.
    }

    /**
     * Cleanup all active particle systems, graphics, text, and timers
     * Should be called when effects are no longer needed
     */
    cleanup() {
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
