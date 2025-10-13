/**
 * @fileoverview Phaser 3 Board Scene for Serenity Blocks
 * This scene handles rendering the game board, pieces, and visual effects using Phaser
 */

import { ensureCircleTexture } from './utils/index.js';
import { createBaseBoardScene } from './base-board-scene.js';

const LINE_CLEAR_PARTICLE_KEY = 'line-clear-particle';
const RIPPLE_PARTICLE_LIFESPAN = 650;
const CAMERA_SHAKE_BASE_INTENSITY = 0.0025;
const CAMERA_SHAKE_BASE_DURATION = 120;

/**
 * Create and return the BoardScene class.
 * @param {typeof Phaser} phaserLib
 */
export function createBoardScene(phaserLib = typeof window !== 'undefined' ? window.Phaser : null) {
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
        }

        /**
         * Phaser create - initialize scene objects
         */
        create() {
            super.create();
            this.attachGraphicsLayerAliases();

            console.log('[BoardScene] Creating scene...');
            this.drawGrid();
            console.log('[BoardScene] Scene created successfully');
        }

        /**
         * Trigger line clear flash effect
         * @param {Array<number>} clearedRows - Array of row indices that were cleared
         */
        triggerLineClearFlash(clearedRows) {
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
            this.time.delayedCall(100, () => {
                this.effectsGraphics.clear();
            });
        }

        /**
         * Create piece lock ripple effect
         * @param {Object} piece - The locked piece
         */
        createPieceLockRipple(piece) {
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
                const colorInt = parseInt(piece.color.replace('#', ''), 16);

                // Create a data object to tween
                const rippleData = { radius: 0, alpha: 0.6 };

                this.tweens.add({
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
            this.tweens.add({
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
            const qualityMultiplier = this.getQualityConfig()?.shakeMultiplier ?? 1;
            const intensity = CAMERA_SHAKE_BASE_INTENSITY * clampedLineCount * qualityMultiplier;
            const duration = CAMERA_SHAKE_BASE_DURATION + clampedLineCount * 40;

            this.shakeCamera(intensity / CAMERA_SHAKE_BASE_INTENSITY, duration);

            // Increase particle intensity for this frame
            this.lastImpactIntensity = clampedLineCount;
        }

        /**
         * Create transient particle bursts across cleared rows
         * @param {Array<number>} clearedRows - World row indices that were cleared
         */
        spawnLineClearParticles(clearedRows) {
            if (!clearedRows || clearedRows.length === 0) return;
            if (!this.textures.exists(this.lineClearParticleKey)) return;
            if (!this.getQualityConfig()?.particles) return;

            const intensity = Math.max(1, this.lastImpactIntensity || clearedRows.length);
            // Apply combo multiplier to make effects more dramatic
            const comboMultiplier = this.currentComboCount > 0 ? (1 + (this.currentComboCount * 0.5)) : 1;
            const totalIntensity = intensity * comboMultiplier;
            
            const boardWidth = this.cols * this.blockSize;

            clearedRows.forEach((row, index) => {
                const zoneY = (row - this.hiddenRows) * this.blockSize;

                // The emitZone source is relative to the emitter's coordinates.
                // So, we create the emitter at the zone's top-left corner (0, zoneY)
                // and define the zone source relative to that point.
                const emitter = this.add.particles(0, zoneY, this.lineClearParticleKey, {
                    emitZone: {
                        type: 'random',
                        source: new Phaser.Geom.Rectangle(0, 0, boardWidth, this.blockSize),
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

                emitter.setDepth(5);

                // More particles for bigger combos
                const burstAmount = Math.round(18 * totalIntensity);
                emitter.explode(burstAmount);

                // The emitter is now the game object to be managed
                this.time.delayedCall(RIPPLE_PARTICLE_LIFESPAN, () => {
                    if (emitter) {
                        emitter.destroy();
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
         * @param {number} comboCount - Current combo count
         */
        spawnComboExplosionParticles(comboCount) {
            if (!this.textures.exists(this.lineClearParticleKey)) return;
            if (!this.getQualityConfig()?.particles) return;

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
                    
                    const emitter = this.add.particles(
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

                    emitter.setDepth(4); // Behind line clear particles but above board

                    // Explode with scaled particle count
                    emitter.explode(Math.round(particleCount / burstCount));

                    this.time.delayedCall(1200, () => {
                        if (emitter) {
                            emitter.destroy();
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
         * @param {number} comboCount - Current combo count
         */
        spawnRadialWave(comboCount) {
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

                const emitter = this.add.particles(centerX, centerY, this.lineClearParticleKey, {
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

                emitter.setDepth(3);
                emitter.explode(1);

                this.time.delayedCall(900, () => {
                    if (emitter) {
                        emitter.destroy();
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
         * Resize handler
         */
        resize(width, height) {
            // Handle resize if needed
            console.log('[BoardScene] Resize:', width, height);
        }

        /**
         * Cleanup
         */
        shutdown() {
            super.shutdown();
            console.log('[BoardScene] Shutdown');
            this.boardGraphics?.destroy();
            this.pieceGraphics?.destroy();
            this.effectsGraphics?.destroy();
            this.activeParticleSystems?.forEach((system) => system.destroy());
            this.activeParticleSystems?.clear();
            this.hudElements = null;
        }
    };
}
