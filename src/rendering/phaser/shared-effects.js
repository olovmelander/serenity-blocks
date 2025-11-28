/**
 * @fileoverview Shared Effects Module for Phaser 4
 *
 * This module contains all visual effects logic that can be reused across
 * both single-player (BoardScene) and FFA multiplayer (MultiplayerEffectsManager).
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

// Constants
const RIPPLE_PARTICLE_LIFESPAN = 650;
const CAMERA_SHAKE_BASE_INTENSITY = 0.0025;
const CAMERA_SHAKE_BASE_DURATION = 120;

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
     * Trigger line clear flash effect
     * @param {Array<number>} clearedRows - Array of row indices that were cleared
     */
    triggerLineClearFlash(clearedRows) {
        if (!clearedRows || clearedRows.length === 0) return;

        const PhaserRef = window.Phaser;
        const width = this.scene.cols * this.scene.blockSize;
        const isInfinityMode = Boolean(this.scene.gameState?.isInfinityMode);

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
                    0.55,
                );

                // In infinity mode, follow camera (scrollFactor=1); in standard mode, stay in screen space (scrollFactor=0)
                stripe.setScrollFactor(isInfinityMode ? 1 : 0);
                stripe.setBlendMode(PhaserRef.BlendModes.ADD);

                this.scene.tweens.add({
                    targets: stripe,
                    alpha: { from: 0.65, to: 0 },
                    scaleY: { from: 1, to: 1.25 },
                    y: centerY + 4,
                    duration: 220 + index * 40,
                    ease: 'Cubic.easeOut',
                    delay: index * 50,
                    onComplete: () => stripe.destroy(),
                });
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

        this.spawnLineClearParticles(clearedRows);
    }

    /**
     * Create piece lock ripple effect
     * @param {Object} piece - The locked piece
     */
    createPieceLockRipple(piece) {
        if (!piece) return;

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

            const rippleHex = this.getPieceColor(piece, '#ffffff');
            const colorInt = parseInt(rippleHex.replace('#', ''), 16) || 0xffffff;

            // Create a data object to tween
            const rippleData = { radius: 0, alpha: 0.6 };

            this.scene.tweens.add({
                targets: rippleData,
                radius: this.scene.blockSize * 3,
                alpha: 0,
                duration: 400,
                ease: 'Cubic.easeOut',
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
     * Show combo popup effect
     * @param {number} comboCount - Combo count
     */
    showComboPopup(comboCount) {
        // Store combo count for enhanced particle effects
        this.currentComboCount = comboCount;

        // Create text popup (center of visible canvas)
        // This should be in screen coordinates (visible area only, no hidden rows)
        const text = this.scene.add.text(
            (this.scene.cols * this.scene.blockSize) / 2,
            (this.scene.rows * this.scene.blockSize) / 2,
            `${comboCount}x COMBO!`,
            {
                fontSize: '32px',
                fontFamily: 'Orbitron',
                color: '#fff',
                stroke: '#000',
                strokeThickness: 4,
                backgroundColor: 'transparent', // No background
            },
        );

        // PERFORMANCE: Track text object for cleanup
        this._trackText(text);

        text.setOrigin(0.5);
        // Text ignores camera scroll - positioned in screen coordinates
        text.setScrollFactor(0);

        // Animate popup
        this.scene.tweens.add({
            targets: text,
            y: text.y - 50,
            alpha: { from: 1, to: 0 },
            scale: { from: 0.8, to: 1.2 },
            duration: 800,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                text.destroy();
            },
        });

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
        const clampedLineCount = Math.max(1, Math.min(4, lineCount));
        const duration = CAMERA_SHAKE_BASE_DURATION + clampedLineCount * 40;

        // Call shakeCamera on the scene (defined in base-board-scene.js)
        // The base scene's shakeCamera method already handles quality multiplier
        if (this.scene.shakeCamera) {
            this.scene.shakeCamera(clampedLineCount, duration);
        }

        // Increase particle intensity for this frame
        this.lastImpactIntensity = clampedLineCount;
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

            const emitter = createParticleEmitter(this.scene, 0, zoneY, this.lineClearParticleKey, {
                emitZone: {
                    type: 'random',
                    source: new PhaserRef.Geom.Rectangle(0, 0, boardWidth, this.scene.blockSize),
                },
                speed: { min: 90 * comboMultiplier * intensityBoost, max: 220 * finalIntensity },
                angle: { min: -110, max: -70 },
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

            // More particles for bigger combos, scaled by intensity boost
            const burstAmount = Math.round(18 * finalIntensity);
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
        const centerY = boardHeight / 2;

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
     * Spawn a radial wave effect for extreme combos
     * Uses compatibility layer for Phaser 3/4 support
     * @param {number} comboCount - Current combo count
     */
    spawnRadialWave(comboCount) {
        if (!this.scene.textures.exists(this.lineClearParticleKey)) return;
        if (!this.getQualityConfig()?.particles) return;

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;
        const centerX = boardWidth / 2;
        const centerY = boardHeight / 2;

        const ringParticleCount = Math.round(60 + (comboCount * 10));
        const waveSpeed = 200 + (comboCount * 20);

        // Create expanding ring of particles
        for (let i = 0; i < ringParticleCount; i++) {
            const angle = (i / ringParticleCount) * Math.PI * 2;
            const dirX = Math.cos(angle);
            const dirY = Math.sin(angle);

            // Use compatibility layer
            const emitter = createParticleEmitter(this.scene, centerX, centerY, this.lineClearParticleKey, {
                speedX: dirX * waveSpeed,
                speedY: dirY * waveSpeed,
                lifespan: { min: 500, max: 800 },
                quantity: 1,
                alpha: { start: 1, end: 0 },
                scale: { start: 1.5, end: 0.3 },
                gravityY: 0, // No gravity for clean ring expansion
                blendMode: 'ADD',
                on: false,
                tint: this.getComboTint(comboCount, i),
            });

            if (!emitter) {
                console.warn('[SharedEffects] Failed to create radial wave particle', i);
                continue;
            }

            if (emitter.setDepth) {
                emitter.setDepth(3);
            }

            // Particles ignore camera scroll - positioned in screen coordinates
            if (emitter.setScrollFactor) {
                emitter.setScrollFactor(0);
            }

            emitParticles(emitter, 1);

            this.scene.time.delayedCall(900, () => {
                if (emitter) {
                    destroyParticleEmitter(emitter);
                    this.activeParticleSystems.delete(emitter);
                }
            });

            this.activeParticleSystems.add(emitter);
        }
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
        if (cascadeCount < 2) return; // Only show for actual cascades (2+)

        // For mega cascades (10+), show special effect instead
        if (cascadeCount >= 10) {
            this.showMegaCascadeEffect(cascadeCount);
        }

        // DISABLED: Cascade wave effect removed per user request
        // The sweeping gradient wave is disabled to reduce visual clutter
    }

    /**
     * Show mega cascade special effect for 10+ cascades
     * Creates an intense screen-filling effect to celebrate massive combos
     * @param {number} cascadeCount - Current cascade number
     */
    showMegaCascadeEffect(cascadeCount) {
        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;

        debugLog(`[SharedEffects] MEGA CASCADE x${cascadeCount}!`);

        const centerX = boardWidth / 2;
        const centerY = boardHeight / 2;

        // Display cascade count text (no background flash or rings)
        const megaText = this.scene.add.text(
            centerX,
            centerY,
            `${cascadeCount}x CASCADE!`,
            {
                fontSize: cascadeCount >= 20 ? '48px' : '40px',
                fontFamily: 'Orbitron',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 6,
                fontStyle: 'bold',
                backgroundColor: 'transparent', // No background
            },
        );

        megaText.setOrigin(0.5);
        megaText.setScrollFactor(0);
        megaText.setDepth(11);

        // Intense scale and bounce animation
        this.scene.tweens.add({
            targets: megaText,
            scale: { from: 0.5, to: 1.4 },
            alpha: { from: 1, to: 0 },
            y: centerY - 80,
            duration: 1000,
            ease: 'Back.easeOut',
            onComplete: () => {
                megaText.destroy();
            },
        });

        // Camera shake - more intense for mega cascades
        if (this.scene.shakeCamera) {
            const shakeDuration = 400 + (cascadeCount * 20);
            this.scene.shakeCamera(Math.min(cascadeCount / 2, 8), shakeDuration);
        }
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
            ease: 'Quad.easeOut',
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
     * Create landing impact effect when blocks settle after falling
     * @param {Array<Object>} pieces - Array of pieces that just landed
     */
    createLandingImpact(pieces) {
        if (!pieces || pieces.length === 0) return;
        if (!this.scene.textures.exists(this.lineClearParticleKey)) return;
        if (!this.getQualityConfig()?.particles) return;

        const PhaserRef = window.Phaser;
        if (!PhaserRef || !PhaserRef.Geom || !PhaserRef.Geom.Rectangle) return;

        pieces.forEach((piece) => {
            if (!piece.shape || !piece.fallDistance || piece.fallDistance < 2) return;

            // Find bottom blocks of the piece
            const bottomBlocks = [];
            piece.shape.forEach((row, localY) => {
                row.forEach((cell, localX) => {
                    if (cell > 0) {
                        // Check if this is a bottom block (no block below it)
                        const isBottom = localY === piece.shape.length - 1
                                       || piece.shape[localY + 1][localX] === 0;
                        if (isBottom) {
                            bottomBlocks.push({
                                x: piece.x + localX,
                                y: piece.finalY + localY,
                            });
                        }
                    }
                });
            });

            // Create impact particles at each bottom block
            bottomBlocks.forEach((block) => {
                const screenY = (block.y - this.scene.hiddenRows) * this.scene.blockSize;
                const screenX = block.x * this.scene.blockSize;

                // Only spawn if visible
                if (screenY < 0) return;

                const emitter = createParticleEmitter(
                    this.scene,
                    screenX + this.scene.blockSize / 2,
                    screenY + this.scene.blockSize,
                    this.lineClearParticleKey,
                    {
                        speed: { min: 30, max: 80 },
                        angle: { min: -180, max: 0 },
                        lifespan: { min: 200, max: 400 },
                        quantity: 0,
                        alpha: { start: 0.7, end: 0 },
                        scale: { start: 0.6, end: 0.1 },
                        gravityY: 200,
                        blendMode: 'ADD',
                        on: false,
                        tint: parseInt(this.getPieceColor(piece, '#ffffff').replace('#', ''), 16) || 0xffffff,
                    },
                );

                if (!emitter) return;

                if (emitter.setDepth) {
                    emitter.setDepth(2);
                }

                if (emitter.setScrollFactor) {
                    emitter.setScrollFactor(0);
                }

                // More particles for longer falls
                const particleCount = Math.min(Math.floor(piece.fallDistance / 2) * 2, 8);
                emitParticles(emitter, particleCount);

                this.scene.time.delayedCall(500, () => {
                    if (emitter) {
                        destroyParticleEmitter(emitter);
                        this.activeParticleSystems.delete(emitter);
                    }
                });

                this.activeParticleSystems.add(emitter);
            });
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

        // Reset state
        this.lastImpactIntensity = 0;
        this.currentComboCount = 0;
    }
}
