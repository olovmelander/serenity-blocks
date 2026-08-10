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
    destroyParticleEmitter,
    logParticleSystemInfo,
} from './utils/particle-compat.js';
import { SharedEffects } from './shared-effects.js';

const LINE_CLEAR_PARTICLE_KEY = 'line-clear-particle';

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
            this.sharedEffects?.triggerLineClearFlash(clearedRows);
        }

        /**
         * Create piece lock ripple effect
         * @param {Object} piece - The locked piece
         */
        createPieceLockRipple(piece) {
            this.sharedEffects?.createPieceLockRipple(piece);
        }

        /**
         * Show combo popup effect
         * @param {number} comboCount - Combo count
         */
        showComboPopup(comboCount) {
            this.sharedEffects?.showComboPopup(comboCount);
        }

        /**
         * Play a subtle camera shake and intensify particle bursts based on line count
         * @param {number} lineCount - Number of lines cleared simultaneously
         */
        playLineClearImpact(lineCount = 1) {
            this.sharedEffects?.playLineClearImpact(lineCount);
        }

        /**
         * Create transient particle bursts across cleared rows
         * Uses compatibility layer for Phaser 3/4 support
         * @param {Array<number>} clearedRows - World row indices that were cleared
         */
        spawnLineClearParticles(clearedRows) {
            this.sharedEffects?.spawnLineClearParticles(clearedRows);
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
            this.sharedEffects?.spawnComboExplosionParticles(comboCount);
        }

        /**
         * Spawn a radial wave effect for extreme combos
         * Uses compatibility layer for Phaser 3/4 support
         * @param {number} comboCount - Current combo count
         */
        spawnRadialWave(comboCount) {
            this.sharedEffects?.spawnRadialWave(comboCount);
        }

        /**
         * Play hard drop visual effect
         * @param {Object} dropData - Data about the hard drop
         */
        playHardDropEffect(dropData) {
            if (this.sharedEffects) {
                this.sharedEffects.playHardDropEffect(dropData);
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
