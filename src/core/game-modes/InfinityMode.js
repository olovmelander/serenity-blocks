import { BaseGameMode } from './BaseGameMode.js';
import { GAME_MODES, COLS, ROWS, BLOCK_SIZE } from '../constants.js';
import { GameState, spawnPiece, fillBag, gameLoop } from '../game.js';
import { expandGridIfNeeded, calculateTopRow, getGridStats, checkInfinityGameOver } from '../infinity-grid.js';
import { updateStats } from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import { InfinityHUD } from '../../ui/infinity/InfinityHUD.js';
import { TranceStateEffects } from '../../rendering/phaser/trance-state-effects.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    triggerLineClearFlash as triggerLineClearFlashCanvas,
    triggerBackgroundPulse as triggerBackgroundPulseCanvas
} from '../../rendering/draw.js';

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

        // Event handlers (bound for proper cleanup)
        this.handleKeyPress = this._onKeyPress.bind(this);
        this.handleWheel = this._onWheel.bind(this);

        // Trance state effects for pause
        this.tranceEffects = null;

        // Track if we were following a soft-dropping piece
        this.wasFollowingPiece = false;
        this.followMemoryFrames = 0;
        this.followMemoryDuration = 12;

        // Cooldown to prevent camera follow immediately after snapping
        this.snapCooldownFrames = 0;
        this.snapCooldownDuration = 18;

        // Track whether the last drop action was a hard drop
        this.lastDropWasHard = false;
        this.suppressFollowUntilLock = false;

        // Cascade camera following configuration
        // Use faster lerp during cascades to keep up with falling blocks
        this.cascadeCameraLerpSpeed = 0.15; // Faster to track cascading blocks (was 0.02)
        this.normalCameraLerpSpeed = 0.08;  // Default camera lerp speed

        // Track cleared line positions for camera following
        this.lastClearedLines = null;       // Array of cleared line Y coordinates
        this.lastClearedLinesCenter = null; // Center position of cleared lines
        this.lowestFallingBlock = null;     // Track the lowest block that's falling

        // PERFORMANCE: Throttle camera updates during rapid gravity steps
        // Update camera every N gravity steps instead of every single step
        this.gravityStepCount = 0;
        this.cameraUpdateInterval = 3; // Update camera every 3 gravity steps (configurable)
        this.lastCameraUpdateTime = 0;
        this.minCameraUpdateInterval = 32; // Minimum 32ms between updates (~30fps camera tracking)

        // Cache physics callbacks so input handlers can reuse them
        this.physicsCallbacks = null;
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
            initialInfinityRows: 44
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
                : Math.random
        );

        // Spawn first piece
        this.gameState.lastTime = performance.now();
        spawnPiece(
            this.gameState,
            () => this._refreshNextQueue(),
            () => this._handleGameOver()
        );

        // Draw initial UI
        this._refreshNextQueue();
        this._updateStats();

        // Initialize minimap (scale height to match playfield)
        this.minimap = new InfinityMinimap({
            width: 180,
            height: ROWS * BLOCK_SIZE + 20,
        });
        this.minimap.show();

        // Setup minimap click-to-jump handler
        this.minimap.container.addEventListener('minimap-jump', (event) => {
            if (this.boardScene && this.gameState.isPaused) {
                const centerRow = event.detail.targetRow;
                const visibleRows = this.boardScene.cameraSettings?.visibleRows || this.visibleRows;
                const totalRows = this.gameState.board.length;

                // Calculate target top row (centerRow - half viewport)
                let targetTopRow = centerRow - Math.floor(visibleRows / 2);

                // Clamp to valid camera range
                // Min: 0 (show rows 0-20 at the top)
                // Max: totalRows - visibleRows (show bottom rows)
                const maxCameraRow = Math.max(0, totalRows - visibleRows);
                targetTopRow = Math.max(0, Math.min(maxCameraRow, targetTopRow));

                this.boardScene.updateCameraPosition(targetTopRow);
                this._updateMinimapView();
                console.log('[Infinity] Minimap jump: clicked row', centerRow, '→ camera top row:', targetTopRow);
            }
        });

        console.log('[Infinity] Minimap initialized');

        // Initialize height HUD
        this.heightHUD = new InfinityHUD();
        this.heightHUD.show();
        console.log('[Infinity] HUD initialized');

        // Start game loop
        this._startGameLoop();

        console.log('[Infinity] Game started! Phase 3-5 Complete: ✅ Camera + Minimap + HUD');
    }

    /**
     * Called when game is paused
     */
    onPause(options = {}) {
        super.onPause();
        console.log('[Infinity] Game paused', options);

        // Sync pause state to gameState
        if (this.gameState) {
            this.gameState.isPaused = true;
        }

        // Enable camera navigation during pause
        if (this.boardScene) {
            this.boardScene.enableManualCameraControl();
            this._setupCameraControls();
            console.log('[Infinity] Camera controls enabled - Use arrow keys, Page Up/Down, or mouse wheel to navigate');
        }

        // Start trance state visual effects only if enableTranceState is true (default for 'P' key)
        // When opening settings menu with Escape, we don't want trance state
        const shouldEnableTranceState = options.enableTranceState !== false;
        if (shouldEnableTranceState && this.boardScene && !this.tranceEffects) {
            this.tranceEffects = new TranceStateEffects(this.boardScene);
            this.tranceEffects.start();
            console.log('[Infinity] Trance state effects activated');
        } else if (!shouldEnableTranceState) {
            console.log('[Infinity] Trance state skipped (settings menu opened)');
        }

        // Trigger minimap pause highlight effect
        if (this.minimap) {
            this.minimap.onPause();
        }
    }

    /**
     * Called when game is resumed
     */
    onResume() {
        super.onResume();
        console.log('[Infinity] Game resumed');

        // Sync pause state to gameState
        if (this.gameState) {
            this.gameState.isPaused = false;
        }

        // Stop trance state visual effects
        if (this.tranceEffects) {
            this.tranceEffects.stop();
            this.tranceEffects.destroy();
            this.tranceEffects = null;
            console.log('[Infinity] Trance state effects deactivated');
        }

        // Disable camera navigation, return to auto-follow
        if (this.boardScene) {
            this.boardScene.disableManualCameraControl();
            this._removeCameraControls();
        }

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

        // Cancel game loop
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
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

        this.boardScene = null;

        // Clean up trance effects if active
        if (this.tranceEffects) {
            this.tranceEffects.stop();
            this.tranceEffects.destroy();
            this.tranceEffects = null;
        }

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
        const phaserGame = this.deps.phaserGame;
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

        gameLoop(
            performance.now(),
            this.gameState,
            drawCallback,
            statsCallback,
            () => this.deps.soundManager.sfxPlayer.playDrop(),
            this.getPhysicsCallbacks(),
        );

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
                const visibleRows = this.boardScene.cameraSettings.visibleRows;
                const centerY = newCameraRow * blockSize + (visibleRows * blockSize) / 2;
                const { width } = this.boardScene.getBoardDimensions();
                this.boardScene.cameras.main.centerOn(width / 2, centerY);

                console.log('[Infinity] Camera smoothly adjusted for grid expansion:', oldCameraRow, '→', newCameraRow);
            }

            if (this.gameState.infinityStats) {
                this.gameState.infinityStats.rowsReached = Math.max(
                    this.gameState.infinityStats.rowsReached,
                    this.gameState.board.length
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
            onLineClear: (lineCount) => {
                // Play sound effects
                this.deps.soundManager.sfxPlayer.playLineClear();

                // Emit event for theme reactions
                console.log('[Infinity] Emitting LINE_CLEAR event, count:', lineCount);
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount });

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
            onLevelUp: () => {
                // Level up disabled in infinity mode, but keep callback for compatibility
            },
            onHardDrop: () => {
                this.lastDropWasHard = true;
                this.suppressFollowUntilLock = true;

                const sfxPlayer = this.deps.soundManager?.sfxPlayer;
                if (sfxPlayer?.playHardDrop) {
                    sfxPlayer.playHardDrop();
                } else if (sfxPlayer?.playDrop) {
                    sfxPlayer.playDrop();
                }
            },
            // Trigger combo visual effects
            triggerCombo: (comboCount) => {
                // Emit event for theme reactions
                console.log('[Infinity] Emitting COMBO event, comboCount:', comboCount);
                eventBus.emit(EVENTS.COMBO, { comboCount });

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
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.playLineClearImpact) {
                    boardScene.playLineClearImpact(lineCount);
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
                eventBus.emit(EVENTS.PIECE_LOCK, { piece });

                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.createPieceLockRipple) {
                    boardScene.createPieceLockRipple(piece);
                    console.log('[Infinity] Piece lock ripple triggered for piece:', piece.type);
                } else {
                    console.warn('[Infinity] BoardScene or createPieceLockRipple not available');
                }

                // Update infinity stats
                if (this.gameState.infinityStats) {
                    this.gameState.infinityStats.blocksPlaced += 4; // Approximate blocks per piece
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
            // Update camera during each gravity step to follow falling blocks
            onGravityStep: () => {
                // PERFORMANCE: Throttle camera updates to reduce overhead during rapid cascades
                // Only update camera every N steps or after minimum time interval
                this.gravityStepCount++;
                const now = performance.now();
                const timeSinceLastUpdate = now - this.lastCameraUpdateTime;

                // Update if either: enough steps have passed OR enough time has passed
                const shouldUpdate = (this.gravityStepCount >= this.cameraUpdateInterval) ||
                    (timeSinceLastUpdate >= this.minCameraUpdateInterval);

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
                    if (this.gameState.infinityStats && cascadeCount >= 2) {
                        // Only count actual cascades (2+), not the initial clear
                        this.gameState.infinityStats.totalCascades++;
                        console.log(`[Infinity] Cascade completed: count=${cascadeCount}, total cascades=${this.gameState.infinityStats.totalCascades}`);
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
                    () => this._handleGameOver()
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

        // Show game over modal
        this.deps.modalManager.show('gameOver');

        // Trigger game over event
        window.dispatchEvent(new CustomEvent('gameOver', {
            detail: {
                gameState: this.gameState,
                mode: 'infinity',
                infinityStats: this.gameState.infinityStats,
            }
        }));
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
     * Setup camera controls for manual navigation during pause
     * @private
     */
    _setupCameraControls() {
        // Keyboard controls
        document.addEventListener('keydown', this.handleKeyPress, true);

        // Mouse wheel control
        const canvas = document.querySelector('#phaser-game-container canvas');
        if (canvas) {
            canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        }

        // Track cleanup
        this.cleanupHandlers.push(() => {
            document.removeEventListener('keydown', this.handleKeyPress, true);
            if (canvas) {
                canvas.removeEventListener('wheel', this.handleWheel);
            }
        });
    }

    /**
     * Remove camera controls
     * @private
     */
    _removeCameraControls() {
        document.removeEventListener('keydown', this.handleKeyPress, true);
        const canvas = document.querySelector('#phaser-game-container canvas');
        if (canvas) {
            canvas.removeEventListener('wheel', this.handleWheel);
        }
    }

    /**
     * Handle keyboard input for camera control
     * @private
     */
    _onKeyPress(event) {
        if (!this.boardScene) return;

        // Don't handle if typing in input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }

        let deltaRows = 0;

        switch (event.key) {
            case 'ArrowUp':
                deltaRows = -3; // Move camera up (show higher rows)
                event.preventDefault();
                event.stopPropagation(); // Prevent global controls from handling
                break;
            case 'ArrowDown':
                deltaRows = 3; // Move camera down (show lower rows)
                event.preventDefault();
                event.stopPropagation(); // Prevent global controls from handling
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                // Block left/right arrows too during manual camera control
                event.preventDefault();
                event.stopPropagation();
                return;
            case 'PageUp':
                deltaRows = -10; // Jump up faster
                event.preventDefault();
                event.stopPropagation();
                break;
            case 'PageDown':
                deltaRows = 10; // Jump down faster
                event.preventDefault();
                event.stopPropagation();
                break;
            case 'p':
            case 'P':
                // Allow P key to propagate so it can toggle pause/resume
                // Don't preventDefault or stopPropagation - let global handler manage pause state
                return;
            case 'Escape':
                // Allow Escape to propagate so it can open settings menu
                // Don't preventDefault or stopPropagation
                return;
            case ' ': // Space bar
                // Block space bar (hard drop) during pause
                event.preventDefault();
                event.stopPropagation();
                return;
            case 'Home':
                // Jump to top of build
                if (this.gameState) {
                    const topRow = this.gameState.currentTopRow || 0;
                    this.boardScene.updateCameraPosition(topRow);
                    this._updateMinimapView();
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            case 'End':
                // Jump to bottom (spawn area)
                if (this.gameState) {
                    const visibleRows = this.boardScene.cameraSettings?.visibleRows || this.visibleRows;
                    const bottomTopRow = Math.max(0, this.gameState.board.length - visibleRows);
                    this.boardScene.updateCameraPosition(bottomTopRow);
                    this._updateMinimapView();
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            default:
                // Block ALL other keys during manual camera control to prevent piece movement
                if (event.key.length === 1 || event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
        }

        if (deltaRows !== 0) {
            this.boardScene.moveCamera(deltaRows);
            this._updateMinimapView();
        }
    }

    /**
     * Handle mouse wheel for camera control
     * @private
     */
    _onWheel(event) {
        if (!this.boardScene) return;

        event.preventDefault();

        // Scroll up = show higher rows (negative delta)
        // Scroll down = show lower rows (positive delta)
        const deltaRows = Math.sign(event.deltaY) * 2;
        this.boardScene.moveCamera(deltaRows);
        this._updateMinimapView();
    }

    /**
     * Determine if the locked piece finished below the current viewport.
     * @param {Object} piece
     * @private
     */
    _didPieceLockBelowViewport(piece) {
        if (!piece || !this.boardScene?.cameraSettings) return false;

        const cameraSettings = this.boardScene.cameraSettings;
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
        if (!this.boardScene || !this.boardScene.cameraSettings) return;

        const cameraSettings = this.boardScene.cameraSettings;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const highestBlockRow = this._findHighestBlockRow();

        let targetTopRow;

        if (highestBlockRow >= this.gameState.board.length) {
            targetTopRow = Math.max(0, this.gameState.board.length - visibleRows);
            console.log(`[Infinity] Camera snapped to bottom: row ${targetTopRow}`);
        } else {
            const preferredRow = highestBlockRow - Math.floor(visibleRows * 0.3);
            const maxCameraRow = Math.max(0, this.gameState.board.length - visibleRows);
            targetTopRow = Math.max(0, Math.min(maxCameraRow, preferredRow));
            console.log(`[Infinity] Camera snapped back to top area: row ${targetTopRow} (highest block: ${highestBlockRow})`);
        }

        this.boardScene.updateCameraPosition(targetTopRow, true);
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
     * Updates camera to follow player's building progress upward and falling pieces downward
     * Camera scrolls UP (toward row 0) as blocks fill the viewport
     * Camera scrolls DOWN to follow soft-dropping pieces
     * @private
     */
    _updateCameraPosition() {
        if (!this.boardScene || !this.boardScene.cameraSettings) return;

        const camera = this.boardScene.cameras.main;
        const cameraSettings = this.boardScene.cameraSettings;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;

        // Get block size from board config
        const blockSize = this.boardScene.boardConfig?.blockSize || 30;

        // Calculate current viewport in row coordinates
        const currentCameraRow = Math.floor(camera.scrollY / blockSize);
        const viewportBottomRow = currentCameraRow + visibleRows;

        // Check if we need to follow a falling piece
        const currentPiece = this.gameState.currentPiece;
        if (this.snapCooldownFrames > 0) {
            this.snapCooldownFrames--;
            return;
        }

        if (currentPiece && !this.suppressFollowUntilLock) {
            // Calculate the bottom of the current piece
            const pieceBottomRow = currentPiece.y + currentPiece.shape.length;

            // Define the threshold - when piece goes below 50% of viewport, follow it
            const followThreshold = currentCameraRow + Math.floor(visibleRows * 0.5);

            // If piece is below the follow threshold, smoothly follow it down
            if (pieceBottomRow > followThreshold) {
                // Calculate the maximum camera position (bottom of grid)
                const maxCameraRow = Math.max(0, this.gameState.board.length - visibleRows);

                // Target: keep piece at 50% position in viewport (center)
                const targetCameraRow = pieceBottomRow - Math.floor(visibleRows * 0.5);

                // Clamp to valid range
                const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));

                // Update camera (lerp handles smooth transition)
                this.boardScene.updateCameraPosition(clampedCameraRow);

                // Store for minimap
                this.gameState.cameraRow = clampedCameraRow;

                // Mark that we're following a piece (and remember it for a few frames)
                this.wasFollowingPiece = true;
                this.followMemoryFrames = this.followMemoryDuration;

                return; // Exit early - we're following the piece
            }
        }

        if (this.followMemoryFrames > 0) {
            this.followMemoryFrames--;
            if (this.followMemoryFrames === 0) {
                this.wasFollowingPiece = false;
            }
        } else {
            this.wasFollowingPiece = false;
        }

        // Find highest block (smallest row number where blocks exist)
        const highestBlockRow = this._findHighestBlockRow();

        // If no blocks exist yet (highestBlockRow == board.length), don't move camera
        // This prevents the camera from jumping at game start
        if (highestBlockRow >= this.gameState.board.length) {
            // No blocks placed yet, keep camera at initial position (bottom)
            this.gameState.cameraRow = currentCameraRow;
            return;
        }

        // CRITICAL: Camera should stay at bottom until blocks reach near the TOP of viewport
        // Calculate the maximum bottom position (where camera should stay initially)
        const maxCameraRow = Math.max(0, this.gameState.board.length - visibleRows);

        // Only start scrolling UP when blocks reach the top 30% of the viewport
        // This keeps the bottom visible as long as possible
        const scrollThreshold = currentCameraRow + Math.floor(visibleRows * 0.3);

        // If we're at the bottom position and blocks haven't reached the scroll threshold yet,
        // stay at the bottom to keep all placed blocks visible
        if (currentCameraRow >= maxCameraRow - 1 && highestBlockRow >= scrollThreshold) {
            // Still at bottom, blocks haven't filled enough of the viewport yet
            this.gameState.cameraRow = currentCameraRow;
            return;
        }

        // If blocks have built UP past the threshold (smaller row number than threshold)
        // then scroll camera UP (decrease camera row)
        if (highestBlockRow < scrollThreshold) {
            // Target: keep highest blocks at 30% position in viewport (closer to top)
            // This ensures bottom blocks remain visible longer
            const targetCameraRow = highestBlockRow - Math.floor(visibleRows * 0.3);

            // Clamp to valid range
            // Min: 0 (can show rows 0-20 at the very top)
            // Max: (totalRows - visibleRows) (can show bottom rows)
            const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));

            // Update camera (lerp handles smooth transition)
            this.boardScene.updateCameraPosition(clampedCameraRow);

            // Store for minimap
            this.gameState.cameraRow = clampedCameraRow;

            if (highestBlockRow < currentCameraRow + 5) { // Only log when significantly changed
                console.log(`[Infinity] Camera following: highest block at row ${highestBlockRow}, camera at row ${clampedCameraRow}`);
            }
        } else {
            // Not past threshold yet, keep current camera position
            this.gameState.cameraRow = currentCameraRow;
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

        const cameraSettings = this.boardScene.cameraSettings;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const board = this.gameState.board;
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
        const cameraSettings = this.boardScene.cameraSettings;
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
        // When following highest block, use the existing 30%/70% thresholds
        let targetCameraRow;
        if (clearedLineCenter !== null) {
            // Position camera so cleared lines appear at 55% from top
            targetCameraRow = targetRow - Math.floor(visibleRows * 0.55);
        } else {
            // Original logic for highest block tracking
            const topThreshold = currentCameraRow + Math.floor(visibleRows * 0.25);
            const bottomThreshold = currentCameraRow + Math.floor(visibleRows * 0.75);

            if (targetRow < topThreshold) {
                // Blocks moved upward - keep them at 30% from top
                targetCameraRow = targetRow - Math.floor(visibleRows * 0.3);
            } else if (targetRow > bottomThreshold) {
                // Blocks cascaded downward - keep them at 70% from top
                targetCameraRow = targetRow - Math.floor(visibleRows * 0.7);
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
}
