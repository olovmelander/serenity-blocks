/**
 * @fileoverview Phaser 3 Board Scene for Serenity Blocks
 * This scene handles rendering the game board, pieces, and visual effects using Phaser
 */

import {
    COLS, ROWS, HIDDEN_ROWS, BLOCK_SIZE,
} from '../../core/constants.js';
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
            this.hudElements = null;
        }

        createHud() {
            // This is now handled by the main HTML/CSS UI
            this.hudElements = null;
        }

        applyDefaultViewport() {
            const boardWidth = this.cols * this.blockSize;
            const boardHeight = this.rows * this.blockSize;
            const gameWidth = this.scale.gameSize?.width ?? boardWidth;
            const gameHeight = this.scale.gameSize?.height ?? boardHeight;

            const topOffset = 100; // Adjust this value to make space for the next queue
            const availableHeight = gameHeight - topOffset;
            const scale = Math.min(
                (gameWidth * 0.9) / boardWidth,
                (availableHeight * 0.9) / boardHeight,
            );

            const newBoardWidth = boardWidth * scale;
            const newBoardHeight = boardHeight * scale;

            const viewportX = Math.max(0, (gameWidth - newBoardWidth) / 2);
            const viewportY = topOffset + Math.max(0, (availableHeight - newBoardHeight) / 2);

            const camera = this.cameras?.main;
            camera.setViewport(viewportX, viewportY, newBoardWidth, newBoardHeight);
            camera.setOrigin(0, 0);
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

            this.applyDefaultViewport();

            // Draw initial grid background
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
                // Convert world row to canvas Y
                const y = (row - this.hiddenRows) * this.blockSize;

                // Create a flashing rectangle
                const flash = this.effectsGraphics;
                flash.fillStyle(0xffffff, 0.6);
                flash.fillRect(0, y, this.cols * this.blockSize, this.blockSize);
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
                        // Convert world Y to canvas Y
                        centerY
                            += (piece.y + y - this.hiddenRows) * this.blockSize + this.blockSize / 2;
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
            const boardWidth = this.cols * this.blockSize;

            clearedRows.forEach((row) => {
                const zoneTop = (row - this.hiddenRows) * this.blockSize;
                const zone = new Phaser.Geom.Rectangle(0, zoneTop, boardWidth, this.blockSize);

                const particles = this.add.particles(this.lineClearParticleKey);
                particles.setDepth(5);

                const emitter = particles.createEmitter({
                    emitZone: { type: 'random', source: zone },
                    speed: { min: 90, max: 220 * intensity },
                    angle: { min: -110, max: -70 },
                    lifespan: { min: 350, max: RIPPLE_PARTICLE_LIFESPAN },
                    quantity: 0,
                    alpha: { start: 0.9, end: 0 },
                    scale: { start: 0.85, end: 0 },
                    gravityY: 400,
                    blendMode: 'ADD',
                    on: false,
                });

                const burstAmount = Math.round(18 * intensity);
                emitter.explode(burstAmount);
                this.time.delayedCall(RIPPLE_PARTICLE_LIFESPAN, () => {
                    particles.destroy();
                    this.activeParticleSystems.delete(particles);
                });

                this.activeParticleSystems.add(particles);
            });

            this.lastImpactIntensity = 0;
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
