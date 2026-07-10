import { BaseGameMode } from './BaseGameMode.js';
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
import {
    GAME_MODES, COLS, ROWS, BLOCK_SIZE,
} from '../constants.js';
import {
    GameState, spawnPiece, fillBag, gameLoop, updateGame,
} from '../game.js';
import {
    expandGridIfNeeded, calculateTopRow, getGridStats, checkInfinityGameOver,
} from '../infinity-grid.js';
import {
    updateStats,
    triggerLineClearFlash as triggerLineClearFlashCanvas,
    triggerBackgroundPulse as triggerBackgroundPulseCanvas,
} from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import { InfinityHUD } from '../../ui/infinity/InfinityHUD.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    emitLineClear, emitCombo, emitPieceLock, emitPerfectClear, emitTSpin, emitB2B,
} from '../../events/gameplay-events.js';
import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';
import { normalizeWheelDeltaToPixels, shouldCaptureWheelEvent } from '../../utils/wheel-routing.js';

/**
 * InfinityMode - Endurance mode with 1000-row vertical playfield
 *
 * Features:
 * - 1000-row vertical playfield (starts at 20 rows, expands dynamically)
 * - Dynamic camera following player progress upward
 * - Minimap overview of entire build
 * - Goal: Create the largest possible combo cascade
 * - Tracks height milestones and combo records
 */
export class InfinityMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Infinity mode configuration
        this.maxRows = 1000;
        this.visibleRows = 20;
        this.currentTopRow = 0; // Tracks highest row with blocks
        this.cameraPosition = 0; // Current camera viewport offset

        // Game state
        this.gameState = null;

        // Minimap component (will be initialized in onStart)
        this.minimap = null;

        // Board scene reference
        this.boardScene = null;

        // Cleanup handlers
        this.cleanupHandlers = [];

        // Exploration mode state (for minimap drag-to-explore)
        this.isInExplorationMode = false;
        this.explorationStartCameraRow = 0;

        // Track if we were following a soft-dropping piece
        this.wasFollowingPiece = false;
        this.followMemoryFrames = 0;
        this.followMemoryDuration = 12;

        // Cooldown to prevent camera follow immediately after snapping
        this.snapCooldownFrames = 0;
        this.snapCooldownDuration = 8;

        // Track whether the last drop action was a hard drop
        this.lastDropWasHard = false;
        this.suppressFollowUntilLock = false;

        // Cascade camera following configuration
        // Use faster lerp during cascades to keep up with falling blocks
        this.cascadeCameraLerpSpeed = 0.15; // Faster to track cascading blocks (was 0.02)
        this.normalCameraLerpSpeed = 0.08; // Default camera lerp speed

        // Track cleared line positions for camera following
        this.lastClearedLines = null; // Array of cleared line Y coordinates
        this.lastClearedLinesCenter = null; // Center position of cleared lines
        this.lowestFallingBlock = null; // Track the lowest block that's falling

        // PERFORMANCE: Throttle camera updates during rapid gravity steps
        // Update camera every N gravity steps instead of every single step
        this.gravityStepCount = 0;
        this.cameraUpdateInterval = 3; // Update camera every 3 gravity steps (configurable)
        this.lastCameraUpdateTime = 0;
        this.minCameraUpdateInterval = 32; // Minimum 32ms between updates (~30fps camera tracking)

        // Scroll-to-explore state (two-phase: buffer → explore)
        this._scrollIdleTimer = null;
        this._scrollAccumulator = 0;
        this._scrollBufferAccumulator = 0;
        this._scrollBufferTimer = null;
        this.isScrollExploring = false;
        this.isScrollBuffering = false;
        this._wheelHandler = null;
        this._scrollExitKeyHandler = null;

        // Cache physics callbacks so input handlers can reuse them
        this.physicsCallbacks = null;
        this.usingHybridLoop = false;
    }

    /**
     * Get the unique identifier for this mode
     * @returns {string}
     */
    getModeId() {
        return GAME_MODES.INFINITY;
    }

    /**
     * Get the display name for this mode
     * @returns {string}
     */
    getDisplayName() {
        return 'Infinity Mode';
    }

    /**
     * Called when Infinity mode is selected in UI
     */
    async onActivate() {
        await super.onActivate();

        console.log('[Infinity] Activating Infinity mode...');

        // Hide multiplayer container
        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'none';
        }

        // Show single player container
        const singlePlayerContainer = document.getElementById('single-player-container');
        if (singlePlayerContainer) {
            singlePlayerContainer.style.display = 'flex';
        }

        // Ensure single player stage (canvas + stats) is visible
        const singlePlayerStage = document.querySelector('.single-player-stage');
        if (singlePlayerStage) {
            singlePlayerStage.style.display = '';
        }

        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.display = '';
        }

        // Apply Infinity-specific layout classes
        this._applyInfinityLayout(true);

        this._movePhaserToSinglePlayerContainer();
        this._resizePhaserGame(COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);

        console.log('[Infinity] Mode activated, ready to start');
    }

    /**
     * Called when user clicks "Start Game"
     */
    async onStart() {
        await super.onStart();

        console.log('[Infinity] Starting Infinity mode...');

        // Initialize game state with infinity mode options
        this.gameState = new GameState({
            isInfinityMode: true,
            maxRows: this.maxRows,
            disableLevelProgression: true, // Option A from plan: Fixed speed
            disableGarbage: true, // No garbage in infinity mode
            initialInfinityRows: 44,
        });

        console.log('[Infinity] Game state initialized with infinity mode configuration');
        console.log('[Infinity] Initial grid size:', this.gameState.board.length, 'rows');

        // Log grid stats
        const stats = getGridStats(this.gameState);
        console.log('[Infinity] Grid stats:', stats);

        this._preparePhaserScene();
        this.boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');

        if (this.boardScene) {
            // Sync game state to scene (camera needs this for configuration)
            this.boardScene.syncFromGameState(this.gameState);

            // Configure camera for infinity mode
            this.boardScene.configureCamera();

            console.log('[Infinity] BoardScene configured for infinity mode');
        }

        // Apply effect quality from settings
        const settings = this.deps.settingsManager.get();
        if (this.boardScene?.setEffectQuality) {
            this.boardScene.setEffectQuality(settings.effectQuality || 'high');
        }

        // Fill piece bag
        fillBag(
            this.gameState.nextPieces,
            typeof this.gameState.randomGenerator === 'function'
                ? this.gameState.randomGenerator
                : Math.random,
        );

        // Spawn first piece
        this.gameState.lastTime = performance.now();
        spawnPiece(
            this.gameState,
            () => this._refreshNextQueue(),
            () => this._handleGameOver(),
        );

        // Draw initial UI
        this._refreshNextQueue();
        this._updateStats();

        // Initialize minimap (scaling height and width for responsive CSS layout)
        // With scale transforms removed in CSS, the actual generated pixels need to be sharp
        this.minimap = new InfinityMinimap({
            width: 140, // Base width, CSS will constrain/scale it with object-fit
            height: ROWS * BLOCK_SIZE + 20,
        });
        this.minimap.show();

        // Setup minimap exploration event handlers
        this.minimap.container.addEventListener('minimap-exploration-start', async () => {
            if (this.gameState && !this.gameState.isPaused && !this.isInExplorationMode) {
                console.log('[Infinity] Minimap exploration started - pausing game');

                // Store current camera position for potential smooth return
                this.explorationStartCameraRow = this.boardScene?.cameraSettings?.currentTopRow ?? 0;
                this.isInExplorationMode = true;
                this._lastExplorationTime = performance.now();

                // Pause the game
                this.gameState.isPaused = true;

                // Enable manual camera control for exploration
                if (this.boardScene) {
                    this.boardScene.enableManualCameraControl();
                }

                // Trigger minimap pause visual feedback
                if (this.minimap) {
                    this.minimap.onPause();
                }

                // Lazy init cosmic exploration effect
                if (!this.cosmicExploration) {
                    try {
                        const { CosmicExplorationEffect } = await import('../../ui/effects/CosmicExplorationEffect.js');
                        this.cosmicExploration = new CosmicExplorationEffect({
                            quality: this.deps.settingsManager.get('graphicsQuality') || 'High',
                            gameState: this.gameState,
                        });
                    } catch (err) {
                        console.error('[Infinity] Failed to load cosmic exploration effect:', err);
                    }
                }
                if (this.cosmicExploration) {
                    this.cosmicExploration.start();
                }
            }
        });

        this.minimap.container.addEventListener('minimap-exploration-end', () => {
            if (this.isInExplorationMode) {
                console.log('[Infinity] Minimap exploration ended - resuming game');

                this.isInExplorationMode = false;

                // Stop cosmic exploration effect
                if (this.cosmicExploration) {
                    this.cosmicExploration.stop();
                }

                // Calculate where the active piece currently is
                const pieceTargetRow = this._calculatePieceCameraPosition();

                // Smoothly return camera to gameplay position
                if (this.boardScene) {
                    this.boardScene.disableManualCameraControl();

                    // Increase lerp speed temporarily for smooth but visible return
                    const originalLerpSpeed = this.boardScene.cameraSettings?.lerpSpeed || 0.08;
                    if (this.boardScene.cameraSettings) {
                        this.boardScene.cameraSettings.lerpSpeed = 0.15; // Faster for smooth return
                    }

                    // Update camera to target gameplay position
                    this.boardScene.updateCameraPosition(pieceTargetRow);

                    // Restore normal lerp speed after a short delay
                    setTimeout(() => {
                        if (this.boardScene?.cameraSettings) {
                            this.boardScene.cameraSettings.lerpSpeed = originalLerpSpeed;
                        }
                    }, 400);
                }

                // Resume game — reset lastTime so gravity doesn't accumulate
                // the entire exploration duration as one massive delta
                this.gameState.isPaused = false;
                this.gameState.lastTime = performance.now();

                if (this.usingHybridLoop) {
                    this.deps.frameRateController?.resumeHybridLoop();
                }

                // Trigger minimap unpause visual feedback
                if (this.minimap) {
                    this.minimap.onUnpause();
                }
            }
        });

        // Setup minimap jump handler (used during exploration)
        this.minimap.container.addEventListener('minimap-jump', (event) => {
            // Only process jumps when in exploration mode
            if (this.boardScene && this.isInExplorationMode) {
                const centerRow = event.detail.targetRow;
                const visibleRows = this.boardScene.cameraSettings?.visibleRows || this.visibleRows;
                const totalRows = this.gameState.board.length;

                // Calculate target top row (centerRow - half viewport)
                let targetTopRow = centerRow - Math.floor(visibleRows / 2);

                // Clamp to valid camera range
                const maxCameraRow = Math.max(0, totalRows - visibleRows);
                targetTopRow = Math.max(0, Math.min(maxCameraRow, targetTopRow));

                // During exploration, update camera position directly (responsive drag)
                this.boardScene.updateCameraPosition(targetTopRow, true);
                this._updateMinimapView();

                // Update cosmic exploration effect with camera position
                if (this.cosmicExploration) {
                    const now = performance.now();
                    const deltaTime = (now - (this._lastExplorationTime || now)) / 1000;
                    this._lastExplorationTime = now;
                    this.cosmicExploration.updateCameraPosition(targetTopRow, deltaTime);
                }
            }
        });

        console.log('[Infinity] Minimap initialized');

        // Initialize height HUD
        this.heightHUD = new InfinityHUD();
        this.heightHUD.show();
        console.log('[Infinity] HUD initialized');

        // Start game loop
        this._startGameLoop();

        // Initialize BoardJuice for reactive board motion
        this._initBoardJuice();

        // Wrap move/rotate to add board juice on piece movement
        if (this.boardJuice) {
            this._originalMove = window.move;
            this._originalRotate = window.rotate;

            const juice = this.boardJuice;
            const origMove = this._originalMove;
            const origRotate = this._originalRotate;

            window.move = (dir) => {
                if (this.gameState?.hitStopRemaining > 0) return false;
                const result = origMove?.(dir);
                if (juice && !juice.disabled) {
                    juice.nudge(dir * 1.5, 0);
                    juice.tilt(dir * 0.4);
                }
                return result;
            };

            window.rotate = (dir) => {
                if (this.gameState?.hitStopRemaining > 0) return;
                const result = origRotate?.(dir);
                if (juice && !juice.disabled) {
                    juice.tilt(dir === 'left' ? -0.3 : 0.3);
                }
                return result;
            };
        }

        // Enable gamepad exploration control
        this._enableGamepadExploration();

        // Enable scroll-to-explore on the game canvas
        this._enableScrollExploration();

        console.log('[Infinity] Game started! Phase 3-5 Complete: ✅ Camera + Minimap + HUD + 🎮 Gamepad');
    }

    /**
     * Called when game is paused. Sim mirror + hybrid-loop pause live in
     * BaseGameMode (§4.6 slice 2); minimap/exploration are mode-specific.
     */
    _getPausableGameState() {
        return this.gameState || null;
    }

    onPause(options = {}) {
        super.onPause();
        console.log('[Infinity] Game paused');

        // Trigger minimap pause highlight effect (only if not in exploration mode)
        if (this.minimap && !this.isInExplorationMode) {
            this.minimap.onPause();
        }
    }

    /**
     * Called when game is resumed
     */
    onResume() {
        super.onResume();
        console.log('[Infinity] Game resumed');

        // Reset exploration mode flag if somehow still set
        this.isInExplorationMode = false;
        this._cleanupScrollState();

        // Trigger minimap unpause effect
        if (this.minimap) {
            this.minimap.onUnpause();
        }
    }

    /**
     * Called when game ends
     */
    async onStop() {
        await super.onStop();

        console.log('[Infinity] Stopping game...');

        if (this.gameState) {
            this.gameState.isGameOver = true;
            this.gameState.isStopped = true;
        }

        // Reset exploration mode
        this.isInExplorationMode = false;
        this._cleanupScrollState();
        this._disableGamepadExploration();

        // Cancel standard RAF loop
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Stop hybrid loop if active
        if (this.deps.frameRateController?.isRunning) {
            this.deps.frameRateController.stopHybridLoop();
        }
        this.usingHybridLoop = false;

        if (this.gameState?.latestPhysicsPromise) {
            try {
                await this.gameState.latestPhysicsPromise;
            } catch (error) {
                console.warn('[Infinity] In-flight physics rejected during stop:', error);
            } finally {
                this.gameState.latestPhysicsPromise = null;
                this.gameState.isProcessingPhysics = false;
            }
        }

        // Hide minimap
        if (this.minimap) {
            this.minimap.hide();
        }

        // Hide height HUD
        if (this.heightHUD) {
            this.heightHUD.hide();
        }

        // TODO: Show results modal with stats
        // this._showResultsModal();

        console.log('[Infinity] Game stopped');

        this.boardScene = null;
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[Infinity] Deactivating mode...');

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);

        // Disable gamepad exploration
        this._disableGamepadExploration();

        // Destroy minimap component
        if (this.minimap) {
            this.minimap.destroy();
            this.minimap = null;
        }

        // Destroy height HUD
        if (this.heightHUD) {
            this.heightHUD.destroy();
            this.heightHUD = null;
        }

        // Dispose cosmic exploration effect
        if (this.cosmicExploration) {
            this.cosmicExploration.dispose();
            this.cosmicExploration = null;
        }

        // Restore wrapped inputs
        if (this._originalMove) { window.move = this._originalMove; this._originalMove = null; }
        if (this._originalRotate) { window.rotate = this._originalRotate; this._originalRotate = null; }

        // Clean up BoardJuice
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        this.boardScene = null;

        // Reset exploration mode
        this.isInExplorationMode = false;

        // Remove Infinity layout styling
        this._applyInfinityLayout(false);

        // Clear game state
        this.gameState = null;
        this.boardScene = null;

        console.log('[Infinity] Mode deactivated');
    }

    /**
     * Handle window resize
     */
    onResize() {
        // TODO: Update camera bounds and minimap size
        console.log('[Infinity] Handling resize...');
    }

    /**
     * Handle theme change
     */
    onThemeChange(theme) {
        console.log('[Infinity] Theme changed to:', theme);
    }

    /**
     * Handle settings change
     */
    onSettingsChange(settings) {
        console.log('[Infinity] Settings changed:', settings);
    }

    // ===== Private Methods =====

    /**
     * Prepare Phaser scene for single board rendering
     * @private
     */
    /**
     * Apply or remove Infinity-specific layout styling
     * @param {boolean} enable
     * @private
     */
    _applyInfinityLayout(enable) {
        const stage = document.querySelector('.single-player-stage');
        const container = document.getElementById('single-player-container');

        if (!stage || !container) return;

        if (enable) {
            stage.classList.add('infinity-mode-active');
            container.classList.add('infinity-mode-active');
        } else {
            stage.classList.remove('infinity-mode-active');
            container.classList.remove('infinity-mode-active');

            const statsBar = document.querySelector('.single-player-stats-bar');
            if (statsBar) {
                statsBar.style.display = '';
            }
        }
    }

    _movePhaserToSinglePlayerContainer() {
        const phaserCanvas = this.deps.phaserGame?.canvas;
        const container = document.getElementById('phaser-game-container');

        if (phaserCanvas && container && phaserCanvas.parentElement !== container) {
            container.appendChild(phaserCanvas);
        }
    }

    /**
     * Resize Phaser game viewport to standard single player dimensions
     * @private
     */
    _resizePhaserGame(width, height) {
        if (this.deps.phaserGame?.resize) {
            this.deps.phaserGame.resize(width, height);
        }
    }

    _preparePhaserScene() {
        const { phaserGame } = this.deps;
        if (!phaserGame?.scene) return;

        // Clear cached physics callbacks so they get recreated with fresh BoardScene references
        this.physicsCallbacks = null;

        this.boardScene = phaserGame.scene.getScene('BoardScene');

        if (this.boardScene) {
            this.boardScene.scene.setVisible(true);
            if (this.boardScene.scene.isActive()) {
                console.log('[Infinity] BoardScene already active, restarting...');
                this.boardScene.scene.restart();
            } else {
                console.log('[Infinity] Starting stopped BoardScene...');
                this.boardScene.scene.start();
            }
            console.log('[Infinity] Phaser BoardScene prepared');
        } else {
            console.warn('[Infinity] BoardScene not found');
        }

        ['BoardPanel1', 'BoardPanel2'].forEach((sceneKey) => {
            const scene = phaserGame.scene.getScene(sceneKey);
            if (scene) {
                scene.scene.setVisible(false);
                scene.scene.stop();
            }
        });
    }

    /**
     * Start the game loop
     * @private
     */
    _startGameLoop() {
        if (!this.gameState) {
            console.warn('[Infinity] Cannot start game loop without game state');
            return;
        }

        console.log('[Infinity] Starting game loop...');

        // Performance optimization: Throttle stats updates
        this.lastStatsUpdateTime = performance.now();
        this.statsUpdateInterval = 250; // Update stats every 250ms instead of every frame

        // Ensure no legacy RAF loop is still running
        if (this.gameState.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Stop any existing hybrid loop from prior runs
        const { frameRateController } = this.deps;
        if (frameRateController?.isRunning) {
            frameRateController.stopHybridLoop();
        }

        const drawCallback = () => {
            if (!this.isRunning) {
                return;
            }

            this._syncBoardSceneFromState();

            this.gameState.currentTopRow = calculateTopRow(this.gameState);
            this._maybeExpandGrid();

            if (this.boardScene?.cameraSettings && !this.boardScene.cameraSettings.manualControl) {
                this._updateCameraPosition();
            }

            this._updateMinimapView();

            if (!this.gameState.isGameOver && checkInfinityGameOver(this.gameState)) {
                console.log('[Infinity] Game over condition met');
                this.gameState.isGameOver = true;
                this._handleGameOver();
            }
        };

        const statsCallback = () => {
            const now = performance.now();
            if (now - this.lastStatsUpdateTime >= this.statsUpdateInterval) {
                this.lastStatsUpdateTime = now;
                this._updateStats();
            }
        };

        const playDropCallback = () => this.deps.soundManager.sfxPlayer.playDrop();
        const physicsCallbacks = this.getPhysicsCallbacks();

        if (frameRateController?.needsHybridMode()) {
            this.usingHybridLoop = true;
            console.log('[Infinity] Using hybrid loop for high FPS target');

            const logicUpdate = (time, _delta) => {
                if (this.gameState.isGameOver || this.gameState.isPaused) return;

                updateGame(time, this.gameState, {
                    drawCallback: null,
                    updateStatsCallback: null,
                    playDropCallback,
                    physicsCallbacks,
                });
            };

            const renderUpdate = () => {
                drawCallback();
                statsCallback();
            };

            frameRateController.startHybridLoop(logicUpdate, renderUpdate);
        } else {
            this.usingHybridLoop = false;
            console.log('[Infinity] Using standard RAF loop');

            gameLoop(
                performance.now(),
                this.gameState,
                drawCallback,
                statsCallback,
                playDropCallback,
                physicsCallbacks,
            );
        }

        console.log('[Infinity] Game loop started');
    }

    _maybeExpandGrid() {
        if (!this.boardScene || !this.boardScene.cameraSettings) return;
        if (this.boardScene.cameraSettings.manualControl) return;
        if (!this.gameState || !this.gameState.board) return;
        if (this.gameState.board.length >= this.gameState.maxRows) return;

        // Find the highest row with PLACED blocks (smallest row number)
        const highestBlockRow = this._findHighestBlockRow();

        // Expansion threshold: only expand if PLACED blocks are within 30 rows of the top (row 0)
        const EXPANSION_THRESHOLD = 30;

        // Only expand if PLACED blocks (not the falling piece) are getting close to row 0
        // highestBlockRow returns board.length if no blocks are placed yet
        if (highestBlockRow > EXPANSION_THRESHOLD) {
            // No blocks near the top yet, no need to expand
            return;
        }

        const currentSize = this.gameState.board.length;
        const requiredRows = Math.min(this.gameState.maxRows, currentSize + 10);

        // Store current camera position before expansion
        const oldCameraRow = this.boardScene.cameraSettings.currentTopRow || 0;
        const oldTargetRow = this.boardScene.cameraSettings.targetTopRow || 0;

        if (expandGridIfNeeded(this.gameState, requiredRows)) {
            const rowsAdded = this.gameState.board.length - currentSize;
            console.log('[Infinity] Grid expanded:', currentSize, '→', this.gameState.board.length, 'rows');
            console.log('[Infinity] Rows added at top:', rowsAdded);

            // SMOOTH CAMERA TRANSITION FIX: Update both current and target camera positions
            // When rows are added at the top, all existing content shifts down by rowsAdded
            // We update both positions so the lerp system can smoothly transition
            const newCameraRow = oldCameraRow + rowsAdded;
            const newTargetRow = oldTargetRow + rowsAdded;

            if (this.boardScene) {
                this.boardScene.updateCameraBounds();

                // Update the current position directly to maintain visual continuity
                // This prevents the jump by keeping the viewport stable
                this.boardScene.cameraSettings.currentTopRow = newCameraRow;
                this.boardScene.cameraSettings.activeTopRow = newCameraRow;

                // Update target position for smooth lerping to the correct position
                this.boardScene.cameraSettings.targetTopRow = newTargetRow;

                // Immediately update camera to the new position (no jump because we're compensating)
                const blockSize = this.boardScene.boardConfig?.blockSize || 30;
                const { visibleRows } = this.boardScene.cameraSettings;
                const centerY = newCameraRow * blockSize + (visibleRows * blockSize) / 2;
                const { width } = this.boardScene.getBoardDimensions();
                this.boardScene.cameras.main.centerOn(width / 2, centerY);

                console.log('[Infinity] Camera smoothly adjusted for grid expansion:', oldCameraRow, '→', newCameraRow);
            }

            if (this.gameState.infinityStats) {
                this.gameState.infinityStats.rowsReached = Math.max(
                    this.gameState.infinityStats.rowsReached,
                    this.gameState.board.length,
                );
            }
        }
    }

    /**
     * Get BoardScene (fresh reference each time to ensure sharedEffects is available)
     * @private
     */
    _getBoardScene() {
        const scene = this.deps.phaserGame?.scene?.getScene('BoardScene') || null;

        // Debug logging (only log if scene state changed or sharedEffects missing)
        if (!scene) {
            if (!this._lastSceneCheckFailed) {
                console.warn('[Infinity] _getBoardScene: scene is NULL');
                this._lastSceneCheckFailed = true;
            }
        } else {
            this._lastSceneCheckFailed = false;
            if (!scene.sharedEffects && !this._lastSharedEffectsWarning) {
                console.warn('[Infinity] _getBoardScene: scene exists but sharedEffects is NULL');
                this._lastSharedEffectsWarning = true;
            } else if (scene.sharedEffects) {
                this._lastSharedEffectsWarning = false;
            }
        }

        return scene;
    }

    /**
     * Get physics callbacks for sound effects and piece spawning
     * @private
     */
    getPhysicsCallbacks() {
        return this._getPhysicsCallbacks();
    }

    _getPhysicsCallbacks() {
        if (this.physicsCallbacks) {
            return this.physicsCallbacks;
        }

        this.physicsCallbacks = {
            onMove: () => this.deps.soundManager.sfxPlayer.playMove(),
            onRotate: () => this.deps.soundManager.sfxPlayer.playRotate(),
            onLineClear: (lineCount, ...rest) => {
                const clearedRows = Array.isArray(rest[2]) ? rest[2] : [];
                const cascadeCount = rest[3] ?? 1;
                // Play sound effects
                this.deps.soundManager.sfxPlayer.playLineClear(cascadeCount);

                // Emit event for theme reactions
                console.log('[Infinity] Emitting LINE_CLEAR event, count:', lineCount);
                emitLineClear({ lineCount, clearedRows, cascadeCount });

                // Track combo stats for infinity mode
                if (this.gameState.infinityStats && this.gameState.comboState) {
                    const comboDepth = this.gameState.comboState.depth || 0;
                    const comboComplexity = this.gameState.comboState.complexity || 0;

                    // Update max combo depth
                    if (comboDepth > this.gameState.infinityStats.maxComboDepth) {
                        this.gameState.infinityStats.maxComboDepth = comboDepth;
                    }

                    // Update max combo complexity
                    if (comboComplexity > this.gameState.infinityStats.maxComboComplexity) {
                        this.gameState.infinityStats.maxComboComplexity = comboComplexity;
                    }

                    console.log(`[Infinity] Line clear: depth=${comboDepth}, complexity=${comboComplexity}, maxDepth=${this.gameState.infinityStats.maxComboDepth}, maxComplexity=${this.gameState.infinityStats.maxComboComplexity}`);
                }
            },
            onTSpin: (lineCount) => {
                emitTSpin({ lineCount, source: 'infinity' });
                this.deps.soundManager.sfxPlayer.playTSpin?.();
                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects?.playTSpinEffect) {
                    boardScene.sharedEffects.playTSpinEffect(lineCount);
                }
            },
            onB2B: () => {
                emitB2B({ source: 'infinity' });
                this.deps.soundManager.sfxPlayer.playB2B?.();
                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects?.playB2BChange) {
                    boardScene.sharedEffects.playB2BChange(true);
                }
            },
            onLevelUp: () => {
                // Level up disabled in infinity mode, but keep callback for compatibility
            },
            onHardDrop: (dropData) => {
                const settings = this.deps.settingsManager?.get() || {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if (!prefersReducedMotion && this.gameState) {
                    this.gameState.hitStopRemaining = Math.max(this.gameState.hitStopRemaining || 0, 30);
                }

                this.lastDropWasHard = true;
                this.suppressFollowUntilLock = true;

                const sfxPlayer = this.deps.soundManager?.sfxPlayer;
                if (sfxPlayer?.playHardDrop) {
                    sfxPlayer.playHardDrop();
                } else if (sfxPlayer?.playDrop) {
                    sfxPlayer.playDrop();
                }

                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.playHardDropEffect) {
                    boardScene.playHardDropEffect(dropData);
                }

                // Board juice: dip + bounce on hard drop
                if (this.boardJuice) {
                    this.boardJuice.dip(3);
                    this.boardJuice.bounce();
                }
            },
            // Trigger combo visual effects
            triggerCombo: (comboCount) => {
                // Emit event for theme reactions
                console.log('[Infinity] Emitting COMBO event, comboCount:', comboCount);
                emitCombo({ comboCount });

                // Track max combo
                if (this.gameState.infinityStats && comboCount > this.gameState.infinityStats.maxCombo) {
                    this.gameState.infinityStats.maxCombo = comboCount;
                    console.log(`[Infinity] New max combo: ${comboCount}`);
                }

                const settings = this.deps.settingsManager.get();
                const boardScene = this._getBoardScene();
                if (settings.comboPopupEffect && boardScene) {
                    boardScene.showComboPopup(comboCount);
                    console.log(`[Infinity] Combo popup triggered: ${comboCount}x`);
                }
            },
            // Trigger cascade wave visual effect
            triggerCascadeWave: (cascadeCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.sharedEffects) {
                    boardScene.sharedEffects.showCascadeWave(cascadeCount);
                    console.log(`[Infinity] Cascade wave ${cascadeCount} triggered`);
                }

                // Update HUD cascade counter
                if (this.heightHUD && this.heightHUD.updateCascadeCounter) {
                    this.heightHUD.updateCascadeCounter(cascadeCount);
                }
            },
            // Line clear flash effect
            triggerFlash: (fullLines) => {
                console.log('[Infinity] triggerFlash called with fullLines:', fullLines);

                // Store cleared line positions for camera following
                this.lastClearedLines = fullLines;
                if (fullLines && fullLines.length > 0) {
                    // Calculate center of cleared lines for camera targeting
                    const minRow = Math.min(...fullLines);
                    const maxRow = Math.max(...fullLines);
                    this.lastClearedLinesCenter = (minRow + maxRow) / 2;

                    console.log(`[Infinity] Lines cleared at rows ${minRow}-${maxRow}, center: ${this.lastClearedLinesCenter}`);
                }

                const boardScene = this._getBoardScene();
                console.log('[Infinity] triggerFlash: boardScene:', !!boardScene, 'triggerLineClearFlash:', !!boardScene?.triggerLineClearFlash);

                // Trigger flash effect with Phaser or Canvas fallback
                if (boardScene && boardScene.triggerLineClearFlash) {
                    console.log('[Infinity] Calling boardScene.triggerLineClearFlash');
                    boardScene.triggerLineClearFlash(fullLines);
                } else {
                    console.log('[Infinity] Using canvas fallback for line clear flash');
                    triggerLineClearFlashCanvas(fullLines);
                }
            },
            // Line clear impact (camera shake and particles)
            onLineClearImpact: (lineCount, _cascadeCount) => {
                const settings = this.deps.settingsManager?.get() || {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if (!prefersReducedMotion && this.gameState) {
                    const boardScene = this._getBoardScene();
                    let hitStop = 0;
                    if (boardScene?.sharedEffects) {
                        const tier = boardScene.sharedEffects.getClearTier(lineCount);
                        hitStop = tier?.hitStop || 0;
                    } else if (lineCount >= 4) {
                        hitStop = 70;
                    }
                    if (hitStop > 0) {
                        this.gameState.hitStopRemaining = hitStop;
                    }
                }

                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.playLineClearImpact) {
                    boardScene.playLineClearImpact(lineCount);
                }

                // Board juice: pulse on line clear
                if (this.boardJuice) {
                    const intensity = 1 + (Math.min(lineCount, 4) * 0.004);
                    this.boardJuice.pulse(intensity);
                }
            },
            // Background pulse effect
            triggerBackgroundPulse: (lineCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.triggerBackgroundPulse) {
                    boardScene.triggerBackgroundPulse(lineCount);
                } else {
                    triggerBackgroundPulseCanvas(lineCount);
                }
            },
            // Score addition animation
            onScoreAdd: (points) => {
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.showScorePopup) {
                    boardScene.showScorePopup(points);
                }
            },
            // Background update (keep level-based themes disabled for infinity mode)
            updateBackground: (_level) => {
                // Infinity mode doesn't change backgrounds by level
            },
            // Piece lock ripple effect
            onPieceLock: (piece) => {
                // Emit event for theme reactions
                emitPieceLock({ piece });

                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.createPieceLockRipple) {
                    boardScene.createPieceLockRipple(piece);
                } else {
                    console.warn('[Infinity] BoardScene or createPieceLockRipple not available');
                }

                // Board juice: gentle dip + pulse on piece lock
                if (this.boardJuice) {
                    this.boardJuice.dip(1);
                    this.boardJuice.pulse(1.005);
                }

                // Update infinity stats
                if (this.gameState.infinityStats) {
                    this.gameState.infinityStats.blocksPlaced += 4; // Approximate blocks per piece
                    // Track score at the start of cascade to calculate cascade score
                    this.gameState.infinityStats._cascadeStartScore = this.gameState.score;
                }

                const lockedBelowViewport = this._didPieceLockBelowViewport(piece);
                const hardDropSnap = this.lastDropWasHard && lockedBelowViewport;

                // If we were (recently) following a soft- or hard-dropped piece that landed out of view, snap back to the top
                if (this.wasFollowingPiece || lockedBelowViewport || hardDropSnap) {
                    this._snapCameraToTopArea();
                    this.wasFollowingPiece = false;
                    this.followMemoryFrames = 0;
                    this.snapCooldownFrames = this.snapCooldownDuration;
                }
                // Reset hard drop tracking flags after handling the lock event
                this.lastDropWasHard = false;
                this.suppressFollowUntilLock = false;
            },
            onPerfectClear: (depth, perfectClearBonus) => {
                const settings = this.deps.settingsManager?.get() || {};
                const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                if (!prefersReducedMotion && this.gameState) {
                    this.gameState.hitStopRemaining = 110;
                }

                emitPerfectClear({ depth, perfectClearBonus, source: 'infinity' });
                // Restored by the §4.6 duplicate-key fix: this object literal
                // defined onPerfectClear TWICE; the shadowed first copy carried
                // the SFX, so perfect clears had been silent in this mode.
                this.deps.soundManager.sfxPlayer.playPerfectClear?.();

                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects?.playPerfectClear) {
                    boardScene.sharedEffects.playPerfectClear(depth);
                }
            },
            // Update camera during each gravity step to follow falling blocks
            onGravityStep: () => {
                // PERFORMANCE: Throttle camera updates to reduce overhead during rapid cascades
                // Only update camera every N steps or after minimum time interval
                this.gravityStepCount++;
                const now = performance.now();
                const timeSinceLastUpdate = now - this.lastCameraUpdateTime;

                // Update if either: enough steps have passed OR enough time has passed
                const shouldUpdate = (this.gravityStepCount >= this.cameraUpdateInterval)
                    || (timeSinceLastUpdate >= this.minCameraUpdateInterval);

                if (shouldUpdate && this.boardScene?.cameraSettings) {
                    this.boardScene.cameraSettings.lerpSpeed = this.cascadeCameraLerpSpeed;
                    // Track the falling blocks and cleared lines to position camera optimally
                    this._updateCameraDuringCascade();

                    // Reset throttle counters
                    this.gravityStepCount = 0;
                    this.lastCameraUpdateTime = now;
                }
            },
            // Update camera after cascade completes
            onCascadeComplete: (cascadeCount) => {
                if (cascadeCount > 0) {
                    // Track cascade statistics for infinity mode
                    if (this.gameState.infinityStats) {
                        // Calculate cascade score (points earned during this cascade sequence)
                        const startScore = this.gameState.infinityStats._cascadeStartScore || 0;
                        const cascadeScore = this.gameState.score - startScore;

                        // Update max cascade score if this is a new record
                        if (cascadeScore > this.gameState.infinityStats.maxCascadeScore) {
                            this.gameState.infinityStats.maxCascadeScore = cascadeScore;
                            console.log(`[Infinity] New max cascade score: ${cascadeScore} points`);
                        }

                        // Only count actual cascades (2+), not the initial clear
                        if (cascadeCount >= 2) {
                            this.gameState.infinityStats.totalCascades++;
                        }
                        console.log(`[Infinity] Cascade completed: count=${cascadeCount}, score=${cascadeScore}, max=${this.gameState.infinityStats.maxCascadeScore}`);
                    }

                    // PERFORMANCE: Reset camera update throttle counters
                    this.gravityStepCount = 0;
                    this.lastCameraUpdateTime = 0;

                    // Restore normal camera lerp speed after cascade
                    if (this.boardScene?.cameraSettings) {
                        this.boardScene.cameraSettings.lerpSpeed = this.normalCameraLerpSpeed;
                    }
                    // Do final camera position adjustment (no cleared lines, use highest block)
                    this._updateCameraAfterCascade();

                    // Clear stored cleared line positions
                    this.lastClearedLines = null;
                    this.lastClearedLinesCenter = null;
                }
            },
            // Spawn next piece after physics completes
            spawnPiece: () => {
                spawnPiece(
                    this.gameState,
                    () => this._refreshNextQueue(),
                    () => this._handleGameOver(),
                );
            },
            // Handle combo finalization (no garbage in infinity mode, but track combo stats)
            onGarbageReady: (summary) => {
                // Even though garbage is disabled in infinity mode, this callback is used
                // to finalize combo tracking and update stats
                if (this.gameState.infinityStats && summary) {
                    const { depth, complexity } = summary;

                    // Update max combo depth
                    if (depth > this.gameState.infinityStats.maxComboDepth) {
                        this.gameState.infinityStats.maxComboDepth = depth;
                        console.log(`[Infinity] New max combo depth: ${depth} lines`);
                    }

                    // Update max combo complexity (cascade count)
                    if (complexity > this.gameState.infinityStats.maxComboComplexity) {
                        this.gameState.infinityStats.maxComboComplexity = complexity;
                        console.log(`[Infinity] New max combo complexity: ${complexity} stages`);
                    }

                    // Log combo summary
                    console.log(`[Infinity] Combo finished: ${depth} lines across ${complexity} cascades`);
                }
            },
        };

        return this.physicsCallbacks;
    }

    /**
     * Refresh next piece queue display
     * @private
     */
    _refreshNextQueue() {
        updateNextQueue(this.gameState.nextPieces);
    }

    /**
     * Update stats display
     * @private
     */
    _updateStats() {
        updateStats(this.gameState);

        // Update infinity-specific HUD
        if (this.heightHUD) {
            this.heightHUD.update(this.gameState);
        }
    }

    _syncBoardSceneFromState() {
        if (this.boardScene && this.gameState) {
            this.boardScene.syncFromGameState(this.gameState);
        }
    }

    _updateMinimapView() {
        if (!this.minimap || !this.boardScene?.cameraSettings) {
            return;
        }

        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;

        // Minimap expects the TOP row of the viewport, not the center
        const cameraTopRow = cameraSettings.currentTopRow || 0;

        this.minimap.update(this.gameState, cameraTopRow, visibleRows);
    }

    /**
     * Handle game over
     * @private
     */
    async _handleGameOver() {
        console.log('[Infinity] Game over!');

        // Log final stats
        const stats = getGridStats(this.gameState);
        console.log('[Infinity] Final stats:', stats);
        console.log('[Infinity] Build height reached:', this.gameState.currentTopRow, 'rows from top');

        await this.onStop();

        // Save high score (using standard system for now)
        await this.deps.highScoreManager.addScore({
            score: this.gameState.score,
            lines: this.gameState.lines,
            level: this.gameState.level,
            mode: 'infinity', // Tag as infinity mode
        });

        // Sync Steam stats/leaderboards in the background (best-effort)
        this._syncSteamStats().catch((err) => {
            console.warn('[Infinity] Steam stats sync failed:', err.message);
        });

        // Show game over modal with stats/leaderboards
        const { showGameOverModal } = await import('../../ui/modals.js');
        await showGameOverModal(
            this.deps.modalManager,
            this.gameState,
            this.deps.highScoreManager,
            {
                onMainMenu: () => {
                    console.log('[Infinity] Main Menu - exiting to main menu');
                    eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
                },
            },
        );

        // Trigger game over event
        window.dispatchEvent(new CustomEvent('gameOver', {
            detail: {
                gameState: this.gameState,
                mode: 'infinity',
                infinityStats: this.gameState.infinityStats,
            },
        }));
    }

    /**
     * Sync Steam stats and leaderboards (best-effort, non-blocking)
     * @private
     */
    async _syncSteamStats() {
        if (!this.gameState) {
            return;
        }

        const startTime = this.gameState.infinityStats?.sessionStartTime || this.gameState.startTime || Date.now();
        const durationMs = Date.now() - startTime;
        const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
        const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

        const bestCascade = this.gameState.infinityStats?.maxComboDepth || 0;

        const scoreDetails = {
            score: this.gameState.score,
            duration: durationSeconds,
            linesCleared: this.gameState.lines,
            highestLevel: this.gameState.level,
            bestCascade,
            version: '1.0.0',
        };

        await Promise.all([
            steamService.uploadScore(STEAM_LEADERBOARDS.INFINITY_HIGH_SCORE, this.gameState.score, scoreDetails),
            steamService.uploadScore(STEAM_LEADERBOARDS.INFINITY_SURVIVAL_TIME, durationSeconds, scoreDetails),
            steamService.uploadScore(STEAM_LEADERBOARDS.INFINITY_BEST_CASCADE, bestCascade, scoreDetails),
            steamService.incrementStat('total_games_played', 1),
            steamService.incrementStat('total_lines_cleared', this.gameState.lines),
            steamService.incrementStat('playtime_minutes', durationMinutes),
            steamService.setStatMax('best_cascade', bestCascade),
            steamService.setStatMax('infinity_best_time', durationSeconds),
        ]);
    }

    /**
     * Show results modal (placeholder for Phase 8)
     * @private
     */
    _showResultsModal() {
        console.log('[Infinity] Would show results modal here (Phase 8)');

        // TODO: Implement in Phase 8
        // const resultsModal = new InfinityResultsModal();
        // resultsModal.show(this.gameState);
    }

    /**
     * Determine if the locked piece finished below the current viewport.
     * @param {Object} piece
     * @private
     */
    _didPieceLockBelowViewport(piece) {
        if (!piece || !this.boardScene?.cameraSettings) return false;

        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const cameraTopRow = Math.floor(cameraSettings.activeTopRow ?? cameraSettings.currentTopRow ?? 0);
        const cameraBottomRow = cameraTopRow + visibleRows - 1;

        const pieceBottomRow = piece.y + (piece.shape?.length || 0) - 1;

        return pieceBottomRow >= cameraBottomRow;
    }

    /**
     * Quickly snap camera back to the top area after locking a soft-dropped piece
     * @private
     */
    _snapCameraToTopArea() {
        if (!this.boardScene?.cameraSettings) return;

        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const highestBlockRow = this._findHighestBlockRow();

        let targetTopRow;

        if (highestBlockRow >= this.gameState.board.length) {
            targetTopRow = Math.max(0, this.gameState.board.length - visibleRows);
        } else {
            const preferredRow = highestBlockRow - Math.floor(visibleRows * 0.2);
            const maxCameraRow = Math.max(0, this.gameState.board.length - visibleRows);
            targetTopRow = Math.max(0, Math.min(maxCameraRow, preferredRow));
        }

        // Use fast lerp instead of instant jump for smoother feel
        const originalLerpSpeed = cameraSettings.lerpSpeed || 0.08;
        cameraSettings.lerpSpeed = 0.25;
        this.boardScene.updateCameraPosition(targetTopRow);
        setTimeout(() => {
            if (this.boardScene?.cameraSettings) {
                this.boardScene.cameraSettings.lerpSpeed = originalLerpSpeed;
            }
        }, 300);
    }

    /**
     * Finds the highest block position (smallest row number with blocks)
     * @returns {number} Row number (0-999), or maxRows if no blocks exist
     * @private
     */
    _findHighestBlockRow() {
        const board = this.gameState?.board;
        if (!board) return this.maxRows;

        // Scan from TOP (row 0) downward to find first block
        for (let row = 0; row < board.length; row++) {
            for (let col = 0; col < board[row].length; col++) {
                if (board[row][col] !== null) {
                    return row; // Found highest block
                }
            }
        }

        // No blocks found - return bottom
        return board.length;
    }

    /**
     * Calculate the optimal camera position to show the active piece
     * This is where the camera should return after exploration ends
     * @returns {number} Target camera top row
     * @private
     */
    _calculatePieceCameraPosition() {
        if (!this.boardScene?.cameraSettings) {
            return 0;
        }

        const visibleRows = this.boardScene.cameraSettings.visibleRows || this.visibleRows;
        const totalRows = this.gameState?.board?.length || 1000;
        const maxCameraRow = Math.max(0, totalRows - visibleRows);

        // Use unified smart target: tower top at 20%, piece at 80%
        const highestBlockRow = this._findHighestBlockRow();
        let targetCameraRow = highestBlockRow < totalRows
            ? highestBlockRow - Math.floor(visibleRows * 0.2)
            : maxCameraRow;

        const { currentPiece } = this.gameState;
        if (currentPiece) {
            const pieceBottomRow = currentPiece.y + (currentPiece.shape?.length || 0);
            const pieceTarget = pieceBottomRow - Math.floor(visibleRows * 0.8);
            targetCameraRow = Math.max(targetCameraRow, pieceTarget);
        }

        if (targetCameraRow <= maxCameraRow) {
            return Math.max(0, Math.min(maxCameraRow, targetCameraRow));
        }

        // Ultimate fallback: bottom of grid
        return maxCameraRow;
    }

    /**
     * Updates camera to follow player's building progress upward and falling pieces downward
     * Camera scrolls UP (toward row 0) as blocks fill the viewport
     * Camera scrolls DOWN to follow soft-dropping pieces
     * @private
     */
    _updateCameraPosition() {
        if (!this.boardScene?.cameraSettings) return;

        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const { board } = this.gameState;
        const maxCameraRow = Math.max(0, board.length - visibleRows);
        const { currentPiece } = this.gameState;

        // Brief cooldown after snap to prevent jitter
        if (this.snapCooldownFrames > 0) {
            this.snapCooldownFrames--;
            return;
        }

        // Find tower top
        const highestBlockRow = this._findHighestBlockRow();

        // No blocks yet — stay at bottom
        if (highestBlockRow >= board.length) return;

        // --- Unified smart target ---
        // Base target: tower top at 20% from viewport top (maximize placement area below)
        let targetCameraRow = highestBlockRow - Math.floor(visibleRows * 0.2);

        // If piece exists, ensure it stays visible (bottom at ~80% of viewport)
        if (currentPiece && !this.suppressFollowUntilLock) {
            const pieceBottomRow = currentPiece.y + currentPiece.shape.length;
            const pieceTarget = pieceBottomRow - Math.floor(visibleRows * 0.8);
            targetCameraRow = Math.max(targetCameraRow, pieceTarget);
        }

        // Clamp to valid range
        targetCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));

        // Stay at bottom until tower actually needs scrolling
        const currentCameraRow = cameraSettings.currentTopRow ?? 0;
        if (currentCameraRow >= maxCameraRow - 1 && highestBlockRow >= currentCameraRow + Math.floor(visibleRows * 0.2)) {
            return;
        }

        // Smooth lerp to target
        this.boardScene.updateCameraPosition(targetCameraRow);
        this.gameState.cameraRow = targetCameraRow;

        // Track piece following for snap-on-lock logic
        if (currentPiece && !this.suppressFollowUntilLock) {
            const pieceBottomRow = currentPiece.y + currentPiece.shape.length;
            const pieceTarget = pieceBottomRow - Math.floor(visibleRows * 0.8);
            if (pieceTarget > highestBlockRow - Math.floor(visibleRows * 0.2)) {
                this.wasFollowingPiece = true;
                this.followMemoryFrames = this.followMemoryDuration;
            }
        }

        // Decay follow memory
        if (this.followMemoryFrames > 0) {
            this.followMemoryFrames--;
            if (this.followMemoryFrames === 0) this.wasFollowingPiece = false;
        } else {
            this.wasFollowingPiece = false;
        }
    }

    /**
     * Update camera during cascade to follow falling blocks and show line clears
     * This method is called on every gravity step during cascades
     * @private
     */
    _updateCameraDuringCascade() {
        if (!this.boardScene || !this.boardScene.cameraSettings) return;
        if (this.boardScene.cameraSettings.manualControl) return;

        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const { board } = this.gameState;
        const maxCameraRow = Math.max(0, this.gameState.board.length - visibleRows);

        // Strategy: Follow the "action zone" where blocks are falling and lines are clearing
        // Priority 1: If we have cleared lines, focus on that area
        // Priority 2: Track the falling blocks in that region

        let targetRow;

        if (this.lastClearedLinesCenter !== null) {
            // We know where lines were just cleared - that's the focal point
            // Find blocks around this area to track the falling action
            const searchStart = Math.max(0, Math.floor(this.lastClearedLinesCenter) - 10);
            const searchEnd = Math.min(board.length, Math.ceil(this.lastClearedLinesCenter) + 10);

            let highestInZone = searchEnd;
            let lowestInZone = searchStart;

            // Find the extent of blocks in the action zone
            for (let row = searchStart; row < searchEnd; row++) {
                for (let col = 0; col < board[row].length; col++) {
                    if (board[row][col] !== null) {
                        highestInZone = Math.min(highestInZone, row);
                        lowestInZone = Math.max(lowestInZone, row);
                    }
                }
            }

            // Target the center of the active falling zone, weighted towards cleared lines
            // This keeps both the cleared line flash AND the falling blocks visible
            if (lowestInZone > searchStart) {
                targetRow = (highestInZone + lowestInZone) / 2;
            } else {
                // No blocks found, just use cleared line center
                targetRow = this.lastClearedLinesCenter;
            }
        } else {
            // Fallback: track overall highest and lowest blocks
            targetRow = this._findHighestBlockRow();
        }

        // Position camera to center the action zone at 50% viewport
        // This ensures maximum visibility of both line clears and falling blocks
        const targetCameraRow = Math.floor(targetRow - visibleRows * 0.5);

        // Clamp and update camera position
        const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));
        this.boardScene.updateCameraPosition(clampedCameraRow);
        this.gameState.cameraRow = clampedCameraRow;
    }

    /**
     * Update camera after a cascade completes to follow new highest block position
     * @param {number|null} clearedLineCenter - Center position of cleared lines (if available)
     * @private
     */
    _updateCameraAfterCascade(clearedLineCenter = null) {
        if (!this.boardScene || !this.boardScene.cameraSettings) return;
        if (this.boardScene.cameraSettings.manualControl) return; // Don't interfere with manual control

        const camera = this.boardScene.cameras.main;
        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const blockSize = this.boardScene.boardConfig?.blockSize || 30;

        // Determine target row: use cleared line center if available, otherwise highest block
        let targetRow;
        if (clearedLineCenter !== null) {
            // Follow the center of cleared lines (the action)
            targetRow = clearedLineCenter;
        } else {
            // Fall back to highest block tracking
            targetRow = this._findHighestBlockRow();
        }

        if (targetRow >= this.gameState.board.length) {
            // No blocks left, return
            return;
        }

        // Get current camera position
        const currentCameraRow = Math.floor(camera.scrollY / blockSize);
        const maxCameraRow = Math.max(0, this.gameState.board.length - visibleRows);

        // When following cleared lines, center them at 50-60% from top
        // When following highest block, use the unified 20%/80% thresholds
        let targetCameraRow;
        if (clearedLineCenter !== null) {
            // Position camera so cleared lines appear at 55% from top
            targetCameraRow = targetRow - Math.floor(visibleRows * 0.55);
        } else {
            // Unified logic for highest block tracking (matches _updateCameraPosition)
            const topThreshold = currentCameraRow + Math.floor(visibleRows * 0.2);
            const bottomThreshold = currentCameraRow + Math.floor(visibleRows * 0.8);

            if (targetRow < topThreshold) {
                // Blocks moved upward - keep them at 20% from top
                targetCameraRow = targetRow - Math.floor(visibleRows * 0.2);
            } else if (targetRow > bottomThreshold) {
                // Blocks cascaded downward - keep them at 80% from top
                targetCameraRow = targetRow - Math.floor(visibleRows * 0.8);
            } else {
                // Within viewport, no adjustment needed
                return;
            }
        }

        // Clamp and update camera position
        const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));
        this.boardScene.updateCameraPosition(clampedCameraRow);
        this.gameState.cameraRow = clampedCameraRow;

        const target = clearedLineCenter !== null ? 'cleared lines' : 'highest block';
        console.log(`[Infinity] Camera updated after cascade: ${target} at row ${Math.floor(targetRow)}, camera → row ${clampedCameraRow}`);
    }

    /**
     * Get current state for debugging
     * @returns {Object}
     */
    getState() {
        return {
            ...super.getState(),
            maxRows: this.maxRows,
            visibleRows: this.visibleRows,
            currentTopRow: this.currentTopRow,
            cameraPosition: this.cameraPosition,
            hasGameState: !!this.gameState,
            hasMinimap: !!this.minimap,
        };
    }

    /**
     * Initialize BoardJuice for reactive board motion
     * @private
     */
    _initBoardJuice() {
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        const container = document.getElementById('phaser-game-container');
        const boardSection = container?.closest('.player-board-section');
        if (boardSection) {
            this.boardJuice = new BoardJuice(boardSection);
        }
    }

    /**
     * Enable gamepad exploration controls
     * @private
     */
    _enableGamepadExploration() {
        const { gamepadController } = this.deps;
        if (!gamepadController) return;

        console.log('[Infinity] Enabling gamepad exploration mode...');

        gamepadController.enableExplorationMode({
            onStart: () => {
                // Trigger start exploration event (handled by existing listener)
                if (this.minimap && this.minimap.container) {
                    this.minimap.container.dispatchEvent(new CustomEvent('minimap-exploration-start'));
                }
            },
            onInput: (value) => {
                // Handle scrolling
                // value is -1 (up) to 1 (down)
                this._handleGamepadScroll(value);
            },
            onEnd: () => {
                // Trigger end exploration event
                if (this.minimap && this.minimap.container) {
                    this.minimap.container.dispatchEvent(new CustomEvent('minimap-exploration-end'));
                }
            },
        });
    }

    /**
     * Disable gamepad exploration controls
     * @private
     */
    _disableGamepadExploration() {
        const { gamepadController } = this.deps;
        if (gamepadController) {
            gamepadController.disableExplorationMode();
        }
    }

    /**
     * Enable scroll-to-explore on the game board
     * @private
     */
    _enableScrollExploration() {
        this._wheelHandler = this._onWheelScroll.bind(this);
        document.addEventListener('wheel', this._wheelHandler, { passive: false });

        this.cleanupHandlers.push(() => {
            document.removeEventListener('wheel', this._wheelHandler);
            this._wheelHandler = null;
            this._cleanupScrollState();
        });

        console.log('[Infinity] Scroll exploration enabled');
    }

    /**
     * Normalize wheel deltaY to pixels across all deltaMode types
     * @param {WheelEvent} event
     * @returns {number} deltaY in pixels
     * @private
     */
    _normalizeWheelDelta(event) {
        return normalizeWheelDeltaToPixels(event, {
            lineHeight: 20,
            pageHeight: 400,
            clampPx: null,
        });
    }

    /**
     * Handle wheel/trackpad scroll — two-phase buffer then explore
     * @param {WheelEvent} event
     * @private
     */
    _onWheelScroll(event) {
        if (!this.gameState || this.gameState.isGameOver || !this.boardScene) return;

        if (!shouldCaptureWheelEvent({ event })) {
            return;
        }

        // Block if externally paused (not by our own exploration) — let the
        // event propagate so settings/hub menus can still scroll normally
        if (!this.isInExplorationMode && !this.isScrollBuffering && this.gameState.isPaused) return;

        // Only prevent default page scroll when we're handling the event
        event.preventDefault();

        const PIXELS_PER_ROW = 30;
        const BUFFER_THRESHOLD_ROWS = 3;
        const MAX_DELTA_ROWS = 10;
        const IDLE_TIMEOUT_MS = 1500;

        const deltaY = this._normalizeWheelDelta(event);
        const deltaRows = deltaY / PIXELS_PER_ROW;

        // === PHASE 1: BUFFERING (game still running) ===
        if (!this.isInExplorationMode && !this.isScrollExploring) {
            if (!this.isScrollBuffering) {
                this.isScrollBuffering = true;
                this._scrollBufferAccumulator = 0;
            }

            this._scrollBufferAccumulator += deltaRows;

            // Reset buffer timeout — if no scroll for 300ms, reset buffer
            clearTimeout(this._scrollBufferTimer);
            this._scrollBufferTimer = setTimeout(() => {
                this.isScrollBuffering = false;
                this._scrollBufferAccumulator = 0;
            }, 300);

            // Check if buffer threshold reached → commit to exploration
            if (Math.abs(this._scrollBufferAccumulator) >= BUFFER_THRESHOLD_ROWS) {
                clearTimeout(this._scrollBufferTimer);
                this._scrollBufferTimer = null;
                const bufferedDelta = this._scrollBufferAccumulator;
                this._scrollBufferAccumulator = 0;
                this.isScrollBuffering = false;

                this._startScrollExploration();

                // Apply the buffered scroll offset immediately
                this._applyScrollDelta(Math.trunc(bufferedDelta));
            }
            return;
        }

        // === PHASE 2: EXPLORING (game paused, free scroll) ===
        this._scrollAccumulator += deltaRows;

        const wholeRows = Math.sign(this._scrollAccumulator)
            * Math.min(Math.abs(Math.trunc(this._scrollAccumulator)), MAX_DELTA_ROWS);

        if (wholeRows !== 0) {
            this._scrollAccumulator -= wholeRows;
            this._applyScrollDelta(wholeRows);
        }

        // Reset idle timer — exit exploration after 1.5s of no scrolling
        clearTimeout(this._scrollIdleTimer);
        this._scrollIdleTimer = setTimeout(() => this._endScrollExploration(), IDLE_TIMEOUT_MS);
    }

    /**
     * Commit to scroll exploration mode (from buffer phase)
     * @private
     */
    _startScrollExploration() {
        this.isScrollExploring = true;
        this._scrollAccumulator = 0;

        // Dispatch exploration-start (reuses existing pause/cosmic/minimap logic)
        if (this.minimap?.container) {
            this.minimap.container.dispatchEvent(
                new CustomEvent('minimap-exploration-start', { bubbles: true }),
            );
        }

        // Register game-key exit: any game action key instantly exits exploration
        this._scrollExitKeyHandler = (e) => {
            const key = e.key === ' ' ? 'Space' : e.key;
            const bindings = window.settings?.keyBindings || {};
            const action = Object.keys(bindings).find((k) => bindings[k] === key);
            const exitActions = ['moveLeft', 'moveRight', 'rotateLeft', 'rotateRight', 'softDrop', 'hardDrop', 'flip'];
            if (action && exitActions.includes(action)) {
                this._endScrollExploration();
            }
        };
        document.addEventListener('keydown', this._scrollExitKeyHandler);
    }

    /**
     * Apply a scroll delta to the camera during exploration
     * @param {number} deltaRows - Number of rows to scroll (positive = down)
     * @private
     */
    _applyScrollDelta(deltaRows) {
        if (!this.boardScene || !this.isInExplorationMode) return;

        const currentTop = this.boardScene.cameraSettings?.currentTopRow ?? 0;
        const visibleRows = this.boardScene.cameraSettings?.visibleRows || this.visibleRows;
        const totalRows = this.gameState?.board?.length || 0;
        const maxCameraRow = Math.max(0, totalRows - visibleRows);

        const targetTopRow = Math.max(0, Math.min(maxCameraRow, currentTop + deltaRows));

        this.boardScene.updateCameraPosition(targetTopRow, true);
        this._updateMinimapView();

        if (this.cosmicExploration) {
            const now = performance.now();
            const dt = Math.max((now - (this._lastExplorationTime || now)) / 1000, 0.016);
            this._lastExplorationTime = now;
            this.cosmicExploration.updateCameraPosition(targetTopRow, dt);
        }
    }

    /**
     * End scroll-triggered exploration mode
     * @private
     */
    _endScrollExploration() {
        if (!this.isScrollExploring) return;

        this._cleanupScrollState();

        // Dispatch exploration-end (reuses existing resume/snap-back logic)
        if (this.minimap?.container) {
            this.minimap.container.dispatchEvent(
                new CustomEvent('minimap-exploration-end', { bubbles: true }),
            );
        }
    }

    /**
     * Clean up all scroll exploration state and listeners
     * @private
     */
    _cleanupScrollState() {
        this.isScrollExploring = false;
        this.isScrollBuffering = false;
        this._scrollAccumulator = 0;
        this._scrollBufferAccumulator = 0;

        if (this._scrollIdleTimer) {
            clearTimeout(this._scrollIdleTimer);
            this._scrollIdleTimer = null;
        }
        if (this._scrollBufferTimer) {
            clearTimeout(this._scrollBufferTimer);
            this._scrollBufferTimer = null;
        }
        if (this._scrollExitKeyHandler) {
            document.removeEventListener('keydown', this._scrollExitKeyHandler);
            this._scrollExitKeyHandler = null;
        }
    }

    /**
     * Handle gamepad scroll input
     * @param {number} value - Input value from -1 to 1
     * @private
     */
    _handleGamepadScroll(value) {
        if (!this.boardScene || !this.isInExplorationMode) return;

        // Configuration
        const SCROLL_SPEED = 2.0; // Rows per frame (approx)

        // Calculate delta (stick down = positive = increase row index = scroll down)
        const delta = value * SCROLL_SPEED;

        // Get current position
        const currentTop = this.boardScene.cameraSettings?.currentTopRow ?? 0;
        let targetTopRow = currentTop + delta;

        // Clamp to valid range
        const visibleRows = this.boardScene.cameraSettings?.visibleRows || this.visibleRows;
        const totalRows = this.gameState?.board?.length || 0;
        const maxCameraRow = Math.max(0, totalRows - visibleRows);

        targetTopRow = Math.max(0, Math.min(maxCameraRow, targetTopRow));

        // Update camera immediately for responsive control
        this.boardScene.updateCameraPosition(targetTopRow, true);
        this._updateMinimapView();

        // Update cosmic effect
        if (this.cosmicExploration) {
            // Use fixed delta time invocation for smoothness, or track actual time
            const now = performance.now();
            const dt = (now - (this._lastExplorationTime || now)) / 1000;
            this._lastExplorationTime = now;
            // Provide a minimum dt to ensure updates happen even if very fast
            const safeDt = Math.max(dt, 0.016);
            this.cosmicExploration.updateCameraPosition(targetTopRow, safeDt);
        }
    }
}
