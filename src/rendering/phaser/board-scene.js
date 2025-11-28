/**
 * @fileoverview Phaser 4 Board Scene for Serenity Blocks
 * Migrated from Phaser 3 - handles rendering game board, pieces, and visual effects
 *
 * Key Phaser 4 Changes:
 * - Particle system API completely rewritten
 * - Graphics API modernized
 * - WebGL-only rendering
 */

import { ensureCircleTexture } from './utils/index.js';
import { createBaseBoardScene } from './base-board-scene.js';
import {
    createParticleEmitter,
    emitParticles,
    destroyParticleEmitter,
    logParticleSystemInfo,
} from './utils/particle-compat.js';
import { SharedEffects } from './shared-effects.js';

const LINE_CLEAR_PARTICLE_KEY = 'line-clear-particle';
const RIPPLE_PARTICLE_LIFESPAN = 650;
const CAMERA_SHAKE_BASE_INTENSITY = 0.0025;
const CAMERA_SHAKE_BASE_DURATION = 120;

/**
 * Create and return the BoardScene class for Phaser 4.
 * Factory function that generates scene class with Phaser reference
 *
 * @param {typeof Phaser} phaserLib - Phaser 4 library reference
 * @returns {typeof Phaser.Scene} BoardScene class
 */
export function createBoardScene(phaserLib = typeof window !== 'undefined' ? window.Phaser : null) {
    const PhaserRef = phaserLib;

    // Validate Phaser 4 availability
    if (!PhaserRef?.Scene) {
        throw new Error('[BoardScene] Phaser 4 not available');
    }

    console.log('[BoardScene] Creating scene class for Phaser 4');

    const BaseBoardScene = createBaseBoardScene(phaserLib);

    return class BoardScene extends BaseBoardScene {
        constructor() {
            super('BoardScene');

            // Graphics layers
            this.boardGraphics = null;
            this.pieceGraphics = null;
            this.effectsGraphics = null;

            // Particle emitters for effects
            this.lineClearEmitters = [];
            this.pieceLockEmitters = [];

            // Cached block sprites for performance
            this.blockPool = [];

            this.activeParticleSystems = new Set();
            this.lineClearParticleKey = LINE_CLEAR_PARTICLE_KEY;
            this.lastImpactIntensity = 0;
            this.currentComboCount = 0; // Track current combo for enhanced effects
            this.hudElements = null;

            // Track active tweens and timers for cleanup
            this.activeTweens = [];
            this.activeTimers = [];
            this.activeGraphics = [];
            this.sharedEffects = null;
        }

        createHud() {
            // This is now handled by the main HTML/CSS UI
            this.hudElements = null;
        }

        applyDefaultViewport() {
            // This logic is now handled by the Phaser Scale Manager (mode: FIT)
            // and the camera configuration in the base scene.
            // Keeping the method for now to avoid breaking calls, but it should be empty.
            this.configureCamera();
        }

        updateHud() {
            // This is now handled by the main HTML/CSS UI
        }

        updateStats(gameState) {
            this.updateHud(gameState);
        }

        /**
         * Phaser preload - load assets if needed
         */
        preload() {
            super.preload();

            // Currently using procedural graphics, but could load sprite assets here
            console.log('[BoardScene] Preload complete');

            // Generate a small circular texture for particle bursts (only once)
            ensureCircleTexture(this, this.lineClearParticleKey, 4, 0xffffff, 1);

            // Log particle system availability for debugging
            logParticleSystemInfo(this);
        }

        /**
         * Phaser create - initialize scene objects
         */
        create() {
            super.create();
            this.attachGraphicsLayerAliases();
            this.sharedEffects = new SharedEffects(this);
            this.effects = this.sharedEffects;

            console.log('[BoardScene] Creating scene...');
            this.drawGrid();
            console.log('[BoardScene] Scene created successfully');
        }

        /**
         * Trigger line clear flash effect
         * @param {Array<number>} clearedRows - Array of row indices that were cleared
         */
        triggerLineClearFlash(clearedRows) {
            if (this.sharedEffects) {
                this.sharedEffects.triggerLineClearFlash(clearedRows);
                return;
            }
            if (!clearedRows || clearedRows.length === 0) return;

            // Flash effect for cleared lines
            clearedRows.forEach((row) => {
                // Use (row - HIDDEN_ROWS) * BLOCK_SIZE for visible playfield
                const y = (row - this.hiddenRows) * this.blockSize;
                if (row >= this.hiddenRows) {
                    const flash = this.effectsGraphics;
                    flash.fillStyle(0xffffff, 0.6);
                    flash.fillRect(0, y, this.cols * this.blockSize, this.blockSize);
                }
            });

            this.spawnLineClearParticles(clearedRows);

            // Fade out over time (handled in update loop)
            const timer = this.time.delayedCall(100, () => {
                this.effectsGraphics.clear();
                // Remove from tracking
                const timerIndex = this.activeTimers.indexOf(timer);
                if (timerIndex > -1) this.activeTimers.splice(timerIndex, 1);
            });
            this.activeTimers.push(timer);
        }

        /**
         * Create piece lock ripple effect
         * @param {Object} piece - The locked piece
         */
        createPieceLockRipple(piece) {
            if (this.sharedEffects) {
                this.sharedEffects.createPieceLockRipple(piece);
                return;
            }
            if (!piece) return;

            // Calculate center of piece
            let centerX = 0;
            let centerY = 0;
            let blockCount = 0;

            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        centerX += (piece.x + x) * this.blockSize + this.blockSize / 2;
                        // Use world coordinates (same as blocks are drawn)
                        centerY += (piece.y + y) * this.blockSize + this.blockSize / 2;
                        blockCount++;
                    }
                });
            });

            if (blockCount > 0) {
                centerX /= blockCount;
                centerY /= blockCount;

                // Create expanding circle effect using tweens
                const ripple = this.add.graphics();
                ripple.setDepth(10); // Above all other graphics layers
                const colorInt = parseInt(piece.color.replace('#', ''), 16);

                // Track graphics object for cleanup
                this.activeGraphics.push(ripple);

                // Create a data object to tween
                const rippleData = { radius: 0, alpha: 0.6 };

                const tween = this.tweens.add({
                    targets: rippleData,
                    radius: this.blockSize * 3,
                    alpha: 0,
                    duration: 400,
                    ease: 'Cubic.easeOut',
                    onUpdate: () => {
                        ripple.clear();
                        ripple.lineStyle(3, colorInt, rippleData.alpha);
                        ripple.strokeCircle(centerX, centerY, rippleData.radius);
                    },
                    onComplete: () => {
                        // Remove from tracking arrays
                        const graphicsIndex = this.activeGraphics.indexOf(ripple);
                        if (graphicsIndex > -1) this.activeGraphics.splice(graphicsIndex, 1);

                        const tweenIndex = this.activeTweens.indexOf(tween);
                        if (tweenIndex > -1) this.activeTweens.splice(tweenIndex, 1);

                        ripple.destroy();
                    },
                });

                // Track tween for cleanup
                this.activeTweens.push(tween);
            }
        }

        /**
         * Show combo popup effect
         * @param {number} comboCount - Combo count
         */
        showComboPopup(comboCount) {
            if (this.sharedEffects) {
                this.sharedEffects.showComboPopup(comboCount);
                return;
            }
            // Store combo count for enhanced particle effects
            this.currentComboCount = comboCount;

            // Create text popup (center of visible canvas)
            const text = this.add.text(
                (this.cols * this.blockSize) / 2,
                (this.rows * this.blockSize) / 2,
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

            // Animate popup
            const tween = this.tweens.add({
                targets: text,
                y: text.y - 50,
                alpha: { from: 1, to: 0 },
                scale: { from: 0.8, to: 1.2 },
                duration: 800,
                ease: 'Cubic.easeOut',
                onComplete: () => {
                    // Remove from tracking
                    const tweenIndex = this.activeTweens.indexOf(tween);
                    if (tweenIndex > -1) this.activeTweens.splice(tweenIndex, 1);

                    text.destroy();
                },
            });

            // Track tween for cleanup
            this.activeTweens.push(tween);

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
            if (this.sharedEffects) {
                this.sharedEffects.playLineClearImpact(lineCount);
                return;
            }
            const clampedLineCount = Math.max(1, Math.min(4, lineCount));
            const qualityMultiplier = this.getQualityConfig()?.shakeMultiplier ?? 1;
            const intensity = CAMERA_SHAKE_BASE_INTENSITY * clampedLineCount * qualityMultiplier;
            const duration = CAMERA_SHAKE_BASE_DURATION + clampedLineCount * 40;

            this.shakeCamera(intensity / CAMERA_SHAKE_BASE_INTENSITY, duration);

            // Increase particle intensity for this frame
            this.lastImpactIntensity = clampedLineCount;
        }

        /**
         * Create transient particle bursts across cleared rows
         * Uses compatibility layer for Phaser 3/4 support
         * @param {Array<number>} clearedRows - World row indices that were cleared
         */
        spawnLineClearParticles(clearedRows) {
            if (this.sharedEffects) {
                this.sharedEffects.spawnLineClearParticles(clearedRows);
                return;
            }
            if (!clearedRows || clearedRows.length === 0) return;
            if (!this.textures.exists(this.lineClearParticleKey)) return;

            // Optimization: Skip if particles disabled or budget exceeded
            if (!this.shouldCreateParticles()) return;

            // Check budget for line clear particles specifically
            const budget = this.getParticleBudgetRemaining('lineClear');
            if (budget <= 0) return;

            const intensity = Math.max(1, this.lastImpactIntensity || clearedRows.length);
            // Apply combo multiplier to make effects more dramatic
            const comboMultiplier = this.currentComboCount > 0 ? (1 + (this.currentComboCount * 0.5)) : 1;
            const totalIntensity = intensity * comboMultiplier;

            const boardWidth = this.cols * this.blockSize;
            const PhaserRef = window.Phaser;

            if (!PhaserRef || !PhaserRef.Geom || !PhaserRef.Geom.Rectangle) {
                console.warn('[BoardScene] Phaser.Geom.Rectangle not available, particles disabled');
                return;
            }

            clearedRows.forEach((row, index) => {
                const zoneY = (row - this.hiddenRows) * this.blockSize;

                // Use compatibility layer to create particles
                const emitter = createParticleEmitter(this, 0, zoneY, this.lineClearParticleKey, {
                    emitZone: {
                        type: 'random',
                        source: new PhaserRef.Geom.Rectangle(0, 0, boardWidth, this.blockSize),
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
                    console.warn('[BoardScene] Failed to create line clear particles for row', row);
                    return;
                }

                if (emitter.setDepth) {
                    emitter.setDepth(5);
                }

                // More particles for bigger combos
                const burstAmount = Math.round(18 * totalIntensity);
                const emitSuccess = emitParticles(emitter, burstAmount);

                if (!emitSuccess) {
                    console.warn('[BoardScene] Failed to emit particles');
                    destroyParticleEmitter(emitter);
                    return;
                }

                // The emitter is now the game object to be managed
                this.time.delayedCall(RIPPLE_PARTICLE_LIFESPAN, () => {
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
            return super.getComboTint(comboCount, index);
        }

        /**
         * Spawn background explosion particles for combo effects
         * Uses compatibility layer for Phaser 3/4 support
         * @param {number} comboCount - Current combo count
         */
        spawnComboExplosionParticles(comboCount) {
            if (this.sharedEffects) {
                this.sharedEffects.spawnComboExplosionParticles(comboCount);
                return;
            }
            if (!this.textures.exists(this.lineClearParticleKey)) return;

            // Optimization: Skip if particles disabled or budget exceeded
            if (!this.shouldCreateParticles()) return;

            // Check budget for combo particles specifically
            const budget = this.getParticleBudgetRemaining('combo');
            if (budget <= 0) return;

            const boardWidth = this.cols * this.blockSize;
            const boardHeight = this.rows * this.blockSize;
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
                this.time.delayedCall(burst * 100, () => {
                    // Random position near center for variety
                    const offsetX = (Math.random() - 0.5) * boardWidth * 0.3;
                    const offsetY = (Math.random() - 0.5) * boardHeight * 0.3;

                    // Use compatibility layer
                    const emitter = createParticleEmitter(
                        this,
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
                        console.warn('[BoardScene] Failed to create combo explosion particles');
                        return;
                    }

                    if (emitter.setDepth) {
                        emitter.setDepth(4); // Behind line clear particles but above board
                    }

                    // Explode with scaled particle count
                    emitParticles(emitter, Math.round(particleCount / burstCount));

                    this.time.delayedCall(1200, () => {
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
                this.time.delayedCall(150, () => {
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
            if (this.sharedEffects) {
                this.sharedEffects.spawnRadialWave(comboCount);
                return;
            }
            if (!this.textures.exists(this.lineClearParticleKey)) return;
            if (!this.getQualityConfig()?.particles) return;

            const boardWidth = this.cols * this.blockSize;
            const boardHeight = this.rows * this.blockSize;
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
                const emitter = createParticleEmitter(this, centerX, centerY, this.lineClearParticleKey, {
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
                    console.warn('[BoardScene] Failed to create radial wave particle', i);
                    continue;
                }

                if (emitter.setDepth) {
                    emitter.setDepth(3);
                }

                emitParticles(emitter, 1);

                this.time.delayedCall(900, () => {
                    if (emitter) {
                        destroyParticleEmitter(emitter);
                        this.activeParticleSystems.delete(emitter);
                    }
                });

                this.activeParticleSystems.add(emitter);
            }
        }

        /**
         * Update game state reference
         * @param {Object} gameState - The game state object
         */
        syncFromGameState(gameState) {
            super.syncFromGameState(gameState);
            this.gameState = gameState;
            this.updateHud(gameState);
        }

        /**
         * Clear all graphics layers
         * Call this when starting a new game to ensure clean slate
         */
        clearBoard() {
            this.boardGraphics?.clear();
            this.pieceGraphics?.clear();
            this.effectsGraphics?.clear();

            // Clear any active particle systems
            this.activeParticleSystems?.forEach((system) => {
                destroyParticleEmitter(system);
            });
            this.activeParticleSystems?.clear();

            console.log('[BoardScene] Board cleared');
        }

        /**
         * Resize handler
         */
        resize(width, height) {
            // Handle resize if needed
            console.log('[BoardScene] Resize:', width, height);
        }

        /**
         * Cleanup - called when scene is stopped
         * This is CRITICAL for preventing memory leaks in single player mode
         */
        shutdown() {
            console.log('[BoardScene] Starting comprehensive shutdown and cleanup...');

            if (this.sharedEffects) {
                this.sharedEffects.cleanup?.();
                this.sharedEffects = null;
                this.effects = null;
            }

            // Destroy ALL particle emitters (both tracked and any stragglers)
            if (this.activeParticleSystems) {
                this.activeParticleSystems.forEach((system) => {
                    if (system && system.destroy) {
                        system.destroy();
                    }
                });
                this.activeParticleSystems.clear();
            }

            // Destroy line clear emitters
            if (this.lineClearEmitters) {
                this.lineClearEmitters.forEach((emitter) => {
                    if (emitter && emitter.destroy) {
                        emitter.destroy();
                    }
                });
                this.lineClearEmitters = [];
            }

            // Destroy piece lock emitters
            if (this.pieceLockEmitters) {
                this.pieceLockEmitters.forEach((emitter) => {
                    if (emitter && emitter.destroy) {
                        emitter.destroy();
                    }
                });
                this.pieceLockEmitters = [];
            }

            // Clear ALL tweens (very important - tweens can accumulate quickly)
            if (this.tweens) {
                this.tweens.killAll();
            }

            // Destroy tracked tweens
            if (this.activeTweens) {
                this.activeTweens.forEach((tween) => {
                    if (tween && tween.stop) {
                        tween.stop();
                    }
                });
                this.activeTweens = [];
            }

            // Destroy tracked timers
            if (this.activeTimers) {
                this.activeTimers.forEach((timer) => {
                    if (timer && timer.destroy) {
                        timer.destroy();
                    }
                });
                this.activeTimers = [];
            }

            // Destroy tracked graphics objects
            if (this.activeGraphics) {
                this.activeGraphics.forEach((graphic) => {
                    if (graphic && graphic.destroy) {
                        graphic.destroy();
                    }
                });
                this.activeGraphics = [];
            }

            // Remove custom textures from cache
            const customTextures = [
                'blockTexture',
                'ghostTexture',
                'gridTexture',
                this.lineClearParticleKey,
                this.commonParticleKey,
                'common-circle-4px',
            ];
            customTextures.forEach((key) => {
                if (key && this.textures && this.textures.exists(key)) {
                    this.textures.remove(key);
                }
            });

            // Destroy graphics layers
            if (this.boardGraphics) {
                this.boardGraphics.clear();
                this.boardGraphics.destroy();
                this.boardGraphics = null;
            }
            if (this.pieceGraphics) {
                this.pieceGraphics.clear();
                this.pieceGraphics.destroy();
                this.pieceGraphics = null;
            }
            if (this.effectsGraphics) {
                this.effectsGraphics.clear();
                this.effectsGraphics.destroy();
                this.effectsGraphics = null;
            }

            // Clear block pool
            if (this.blockPool) {
                this.blockPool.forEach((block) => {
                    if (block && block.destroy) {
                        block.destroy();
                    }
                });
                this.blockPool = [];
            }

            // Clear any other resources
            this.hudElements = null;
            this.currentComboCount = 0;
            this.lastImpactIntensity = 0;

            // Call parent shutdown
            super.shutdown();

            console.log('[BoardScene] Comprehensive cleanup complete');
        }
    };
}
