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

        console.log('[SharedEffects] Initialized for scene:', scene.scene?.key || 'unknown');
    }

    /**
     * Trigger line clear flash effect
     * @param {Array<number>} clearedRows - Array of row indices that were cleared
     */
    triggerLineClearFlash(clearedRows) {
        if (!clearedRows || clearedRows.length === 0) return;

        const PhaserRef = window.Phaser;
        const width = this.scene.cols * this.scene.blockSize;

        if (PhaserRef?.GameObjects) {
            clearedRows.forEach((row, index) => {
                const visibleRow = row - this.scene.hiddenRows;
                if (visibleRow < 0) {
                    return;
                }

                const centerY = (visibleRow * this.scene.blockSize) + (this.scene.blockSize / 2);
                const tint = this.getComboTint(this.currentComboCount, index);

                const stripe = this.scene.add.rectangle(
                    width / 2,
                    centerY,
                    width,
                    this.scene.blockSize,
                    tint,
                    0.55,
                );

                stripe.setScrollFactor(0);
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

        // Calculate center of piece
        // piece.y is in grid coordinates (0-23 including hidden rows)
        let centerX = 0;
        let centerY = 0;
        let blockCount = 0;

        piece.shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    centerX += (piece.x + x) * this.scene.blockSize + this.scene.blockSize / 2;
                    // piece.y is in grid coordinates (0-23 including hidden rows)
                    // Convert to screen coordinates by subtracting hidden rows
                    const screenRow = (piece.y + y) - this.scene.hiddenRows;
                    centerY += screenRow * this.scene.blockSize + this.scene.blockSize / 2;
                    blockCount++;
                }
            });
        });

        if (blockCount > 0) {
            centerX /= blockCount;
            centerY /= blockCount;

            console.log('[SharedEffects] Piece lock ripple:', {
                pieceGridY: piece.y,
                hiddenRows: this.scene.hiddenRows,
                screenY: centerY,
                blockSize: this.scene.blockSize,
                calculation: `(piece.y - hiddenRows) * blockSize + blockSize/2`
            });

            // Create expanding circle effect using tweens
            const ripple = this.scene.add.graphics();

            // IMPORTANT: Set the graphics to ignore camera scroll
            // This way we can position it in screen coordinates directly
            ripple.setScrollFactor(0);

            console.log('[SharedEffects] Drawing ripple at screen position:', {x: centerX, y: centerY});

            const colorInt = parseInt(piece.color.replace('#', ''), 16);

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
            },
        );

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

        clearedRows.forEach((row, index) => {
            const zoneY = (row - this.scene.hiddenRows) * this.scene.blockSize;

            console.log('[SharedEffects] Spawning particles for row', row, {
                hiddenRows: this.scene.hiddenRows,
                blockSize: this.scene.blockSize,
                calculation: `(${row} - ${this.scene.hiddenRows}) * ${this.scene.blockSize}`,
                zoneY: zoneY,
                boardWidth: boardWidth
            });

            // Use compatibility layer to create particles
            const emitter = createParticleEmitter(this.scene, 0, zoneY, this.lineClearParticleKey, {
                emitZone: {
                    type: 'random',
                    source: new PhaserRef.Geom.Rectangle(0, 0, boardWidth, this.scene.blockSize),
                },
                speed: { min: 90 * comboMultiplier, max: 220 * totalIntensity },
                angle: { min: -110, max: -70 },
                lifespan: { min: 350, max: RIPPLE_PARTICLE_LIFESPAN * Math.min(comboMultiplier, 2) },
                quantity: 0, // Required for explode
                alpha: { start: 0.9, end: 0 },
                scale: { start: 0.85 * Math.min(comboMultiplier, 1.5), end: 0 },
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

            // Particles ignore camera scroll - they're positioned in screen coordinates
            if (emitter.setScrollFactor) {
                emitter.setScrollFactor(0);
            }

            // More particles for bigger combos
            const burstAmount = Math.round(18 * totalIntensity);
            const emitSuccess = emitParticles(emitter, burstAmount);

            if (!emitSuccess) {
                console.warn('[SharedEffects] Failed to emit particles');
                destroyParticleEmitter(emitter);
                return;
            }

            // The emitter is now the game object to be managed
            this.scene.time.delayedCall(RIPPLE_PARTICLE_LIFESPAN, () => {
                if (emitter) {
                    destroyParticleEmitter(emitter);
                    this.activeParticleSystems.delete(emitter);
                }
            });

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
        if (comboCount === 0) {
            return 0x00ffff; // Default cyan
        } else if (comboCount === 2) {
            return 0x00ff88; // Green-cyan
        } else if (comboCount === 3) {
            return 0xffaa00; // Orange
        } else if (comboCount === 4) {
            return 0xff00ff; // Magenta
        } else if (comboCount >= 5) {
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
                    }
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
            particleCount: 1.0
        };
    }

    /**
     * Show cascade wave indicator
     * Creates a sweeping visual effect to show when a cascade is being detected
     * @param {number} cascadeCount - Current cascade number
     */
    showCascadeWave(cascadeCount) {
        if (cascadeCount < 2) return; // Only show for actual cascades (2+)

        const boardWidth = this.scene.cols * this.scene.blockSize;
        const boardHeight = this.scene.rows * this.scene.blockSize;

        // Create a sweeping gradient wave from top to bottom
        const waveGraphics = this.scene.add.graphics();
        waveGraphics.setScrollFactor(0);

        // Color based on cascade count
        const baseColor = this.getComboTint(cascadeCount);
        const waveHeight = this.scene.blockSize * 2;

        let waveY = -waveHeight;
        const targetY = boardHeight + waveHeight;
        const duration = 400; // Fast sweep

        this.scene.tweens.add({
            targets: { y: waveY },
            y: targetY,
            duration: duration,
            ease: 'Cubic.easeIn',
            onUpdate: (tween, target) => {
                waveGraphics.clear();

                // Draw gradient wave
                const currentY = target.y;

                // Create a gradient effect using multiple rectangles
                for (let i = 0; i < 10; i++) {
                    const alpha = (1 - (i / 10)) * 0.4; // Fade from 0.4 to 0
                    const offsetY = currentY + (i * (waveHeight / 10));

                    waveGraphics.fillStyle(baseColor, alpha);
                    waveGraphics.fillRect(0, offsetY, boardWidth, waveHeight / 10);
                }
            },
            onComplete: () => {
                waveGraphics.destroy();
            }
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

        pieces.forEach(piece => {
            if (!piece.shape || !piece.fallDistance || piece.fallDistance < 2) return;

            // Find bottom blocks of the piece
            const bottomBlocks = [];
            piece.shape.forEach((row, localY) => {
                row.forEach((cell, localX) => {
                    if (cell > 0) {
                        // Check if this is a bottom block (no block below it)
                        const isBottom = localY === piece.shape.length - 1 ||
                                       piece.shape[localY + 1][localX] === 0;
                        if (isBottom) {
                            bottomBlocks.push({
                                x: piece.x + localX,
                                y: piece.finalY + localY
                            });
                        }
                    }
                });
            });

            // Create impact particles at each bottom block
            bottomBlocks.forEach(block => {
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
                        tint: parseInt(piece.color.replace('#', ''), 16) || 0xffffff,
                    }
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
     * Cleanup all active particle systems
     * Should be called when effects are no longer needed
     */
    cleanup() {
        console.log('[SharedEffects] Cleaning up particle systems:', this.activeParticleSystems.size);

        this.activeParticleSystems.forEach(system => {
            destroyParticleEmitter(system);
        });
        this.activeParticleSystems.clear();

        // Reset state
        this.lastImpactIntensity = 0;
        this.currentComboCount = 0;
    }
}
