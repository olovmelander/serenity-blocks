/**
 * @fileoverview Multiplayer Board Scene for Serenity Blocks (Phaser 4 Compatible)
 * Handles dual viewport rendering for multiplayer mode
 *
 * **Key Features:**
 * - Extends BaseBoardScene for shared rendering logic
 * - Viewport-based rendering for side-by-side boards
 * - Independent camera configuration per player
 * - Particle effects with Phaser 3/4 compatibility layer
 * - Combo popups and line clear effects
 *
 * **Phaser 4 Migration Status:** ✅ Updated
 * - Camera API: ✅ Compatible (setViewport, setBounds, centerOn)
 * - Graphics API: ✅ Compatible (fillRect, strokeCircle)
 * - Tweens API: ✅ Compatible (add, ease functions)
 * - Text API: ✅ Compatible (add.text)
 * - Particle API: ✅ Using compatibility layer
 */

import { createBaseBoardScene } from '../base-board-scene.js';
import { logParticleSystemInfo } from '../utils/particle-compat.js';
import { SharedEffects } from '../shared-effects.js';

const HUD_LABEL_STYLE = {
    fontFamily: 'Orbitron',
    fontSize: '14px',
    color: '#00ffff',
};

const HUD_VALUE_STYLE = {
    fontFamily: 'Space Mono',
    fontSize: '16px',
    color: '#ffffff',
};

const HUD_SECONDARY_STYLE = {
    fontFamily: 'Space Mono',
    fontSize: '12px',
    color: '#a5b4fc',
};

/**
 * Creates a Phaser 4 compatible multiplayer board scene class
 * This scene handles rendering for one player in a multiplayer game
 *
 * @param {typeof Phaser} phaserLib - Phaser library reference (Phaser 4)
 * @returns {class} MultiplayerBoardScene class
 */
export function createMultiplayerBoardScene(
    phaserLib = typeof window !== 'undefined' ? window.Phaser : null,
) {
    const PhaserRef = phaserLib;
    if (!PhaserRef?.Scene) {
        throw new Error('[MultiplayerBoardScene] Phaser 4 not available');
    }

    console.log('[MultiplayerBoardScene] Creating scene class for Phaser 4');
    const BaseBoardScene = createBaseBoardScene(phaserLib);

    return class MultiplayerBoardScene extends BaseBoardScene {
        constructor(key, boardConfig = {}) {
            super(key || 'MultiplayerBoardScene', boardConfig);
            console.log(`[MultiplayerBoardScene] Constructor called with key: ${key}, blockSize: ${boardConfig.blockSize}`);

            // SharedEffects instance (will be initialized in create())
            this.effects = null;

            // Keep these for backward compatibility
            this.activeParticleSystems = new Set();

            // Performance optimization: Focus state and throttling
            this.isFocused = true; // Active player board
            this.lastUpdateTime = 0;
            this.updateInterval = 16; // 60fps by default
            this.throttledUpdateInterval = 33; // 30fps for background boards
        }

        /**
         * Initialize scene with multiplayer-specific data
         * @param {Object} data - Initialization data
         * @param {number} data.playerId - Player ID (1 or 2)
         * @param {Object} data.viewport - Viewport configuration {x, y, width, height}
         * @param {string} data.playerLabel - Player label text
         * @param {Function} data.getPendingGarbage - Callback to get pending garbage count
         */
        init(data = {}) {
            try {
                console.log(`[MultiplayerBoardScene] init() called for ${this.scene?.key || 'unknown'}`, data);
                this.playerId = data.playerId ?? 1;
                this.viewport = data.viewport;
                this.label = data.playerLabel ?? `PLAYER ${this.playerId}`;
                this.getPendingGarbage = data.getPendingGarbage;

                if (!this.viewport) {
                    console.warn(`[MultiplayerBoardScene] No viewport provided for player ${this.playerId}`);
                }
            } catch (error) {
                console.error('[MultiplayerBoardScene] Error in init():', error);
            }
        }

        /**
         * Preload assets (delegates to BaseBoardScene)
         */
        preload() {
            try {
                console.log(`[MultiplayerBoardScene] preload() called for ${this.scene?.key || 'unknown'}`);
                super.preload();

                // Log particle system availability for debugging
                logParticleSystemInfo(this);
            } catch (error) {
                console.error('[MultiplayerBoardScene] Error in preload():', error);
            }
        }

        /**
         * Create scene objects and configure viewport
         */
        create() {
            try {
                console.log(`[MultiplayerBoardScene] create() called for ${this.scene?.key || 'unknown'}, viewport:`, this.viewport);
                super.create();
                this.attachGraphicsLayerAliases();

                // Initialize SharedEffects
                this.effects = new SharedEffects(this);
                console.log(`[MultiplayerBoardScene] SharedEffects initialized for ${this.scene?.key || 'unknown'}`);

                this.applyViewport();
                this.createHud();
                console.log(`[MultiplayerBoardScene] create() complete for ${this.scene?.key || 'unknown'}`);
            } catch (error) {
                console.error('[MultiplayerBoardScene] Error in create():', error);
            }
        }

        /**
         * Performance-optimized update loop with throttling
         * Active player: 60fps, opponent boards: 30fps
         * @param {number} time - Total elapsed time since game start (ms)
         * @param {number} delta - Time elapsed since last frame (ms)
         */
        update(time, delta) {
            // Performance optimization: Throttle non-focused boards
            const targetInterval = this.isFocused ? this.updateInterval : this.throttledUpdateInterval;

            if (time - this.lastUpdateTime < targetInterval) {
                return; // Skip this frame for throttled boards
            }

            this.lastUpdateTime = time;

            // Call parent update (which has dirty flag optimization)
            super.update(time, delta);
        }

        /**
         * Set focus state for this board
         * @param {boolean} focused - True if this is the active player's board
         */
        setFocused(focused) {
            this.isFocused = focused;
            if (focused) {
                console.log(`[MultiplayerBoardScene] Player ${this.playerId} board now focused (60fps)`);
            } else {
                console.log(`[MultiplayerBoardScene] Player ${this.playerId} board unfocused (30fps)`);
            }
        }

        /**
         * Apply viewport configuration to camera for dual-board rendering
         * This creates side-by-side viewports for multiplayer mode
         *
         * **Phaser 4 Compatibility:** ✅ Camera API unchanged
         * - setViewport: Defines render region on canvas
         * - setBounds: Defines world space limits
         * - centerOn: Positions camera in world
         */
        applyViewport() {
            try {
                if (!this.cameras || !this.cameras.main) {
                    console.error('[MultiplayerBoardScene] Camera system not available');
                    return;
                }

                const camera = this.cameras.main;
                console.log(`[MultiplayerBoardScene] applyViewport for ${this.scene?.key || 'unknown'}`, this.viewport);

                // Set the viewport (where on the canvas this camera renders)
                if (this.viewport) {
                    camera.setViewport(
                        this.viewport.x,
                        this.viewport.y,
                        this.viewport.width,
                        this.viewport.height,
                    );
                } else {
                    console.log('[MultiplayerBoardScene] No viewport provided, using full canvas (default)');
                    // Reset viewport to full canvas if previously set
                    camera.setViewport(0, 0, this.scale.width, this.scale.height);
                }

                // Each scene has its own independent world space starting at (0, 0)
                // The viewport determines WHERE on the canvas the scene renders
                const { width, height } = this.getBoardDimensions();

                // Set camera bounds to the full board size (including hidden rows)
                camera.setBounds(0, 0, width, height);

                // Position camera to show only the visible area (hide the top hidden rows)
                const { hiddenRows, blockSize } = this.boardConfig;
                const visibleHeight = height - (hiddenRows * blockSize);

                // Center the camera on the visible portion
                camera.centerOn(width / 2, visibleHeight / 2 + (hiddenRows * blockSize));

                console.log(
                    '[MultiplayerBoardScene] Camera configured:',
                    'bounds:',
                    0,
                    0,
                    width,
                    height,
                    'centerOn:',
                    width / 2,
                    visibleHeight / 2 + (hiddenRows * blockSize),
                );
            } catch (error) {
                console.error('[MultiplayerBoardScene] Error in applyViewport():', error);
            }
        }

        createHud() {
            // HUD is now handled by DOM elements in the sidebar
            // No need to render text inside the Phaser scene
            this.labelText = null;
            this.scoreText = null;
            this.linesText = null;
            this.garbageText = null;
        }

        updateHud(state) {
            if (!state) return;
            if (this.scoreText) this.scoreText.setText(state.score.toLocaleString());
            if (this.linesText) this.linesText.setText(`LINES ${state.lines}`);
            if (this.garbageText) {
                const pending = typeof state.pendingGarbage === 'number' ? state.pendingGarbage : 0;
                this.garbageText.setText(`GARBAGE ${pending}`);
            }
        }

        updateStats(stats) {
            super.updateStats?.(stats);
            this.updateHud(stats);
        }

        syncFromGameState(gameState) {
            super.syncFromGameState(gameState);
            this.updateHud({
                score: gameState?.score ?? 0,
                lines: gameState?.lines ?? 0,
                pendingGarbage: this.getPendingGarbage ? this.getPendingGarbage(gameState) : 0,
            });
        }

        /**
         * Trigger line clear flash effect
         * DELEGATED to SharedEffects
         */
        triggerLineClearFlash(clearedRows) {
            if (this.effects) {
                this.effects.triggerLineClearFlash(clearedRows);
            }
        }

        /**
         * Play line clear impact (camera shake + particles)
         * DELEGATED to SharedEffects
         */
        playLineClearImpact(lineCount = 1) {
            if (this.effects) {
                this.effects.playLineClearImpact(lineCount);
            }
        }

        /**
         * Create piece lock ripple effect
         * DELEGATED to SharedEffects
         */
        createPieceLockRipple(piece) {
            if (this.effects) {
                this.effects.createPieceLockRipple(piece);
            }
        }

        /**
         * Show combo popup
         * DELEGATED to SharedEffects
         */
        showComboPopup(comboCount) {
            if (this.effects) {
                this.effects.showComboPopup(comboCount);
            }
        }

        /**
         * Cleanup scene resources on shutdown
         * **Phaser 4 Compatibility:** ✅ shutdown() lifecycle method unchanged
         */
        shutdown() {
            try {
                console.log(`[MultiplayerBoardScene] Shutting down ${this.scene?.key || 'unknown'}`);

                // Cleanup SharedEffects
                if (this.effects) {
                    this.effects.cleanup();
                    this.effects = null;
                }

                super.shutdown();
                this.labelText?.destroy();
                this.scoreText?.destroy();
                this.linesText?.destroy();
                this.garbageText?.destroy();

                // Clean up active particle systems (backup cleanup)
                this.activeParticleSystems.forEach((emitter) => {
                    try {
                        emitter.destroy();
                    } catch (error) {
                        console.warn('[MultiplayerBoardScene] Error destroying particle emitter:', error);
                    }
                });
                this.activeParticleSystems.clear();
            } catch (error) {
                console.error('[MultiplayerBoardScene] Error in shutdown():', error);
            }
        }
    };
}
