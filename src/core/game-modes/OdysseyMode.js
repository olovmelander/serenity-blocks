/**
 * @fileoverview OdysseyMode - Odyssey Mode game mode implementation
 *
 * Odyssey Mode is a linear progression through 56 levels organized in 7 chapters.
 * Each level has unique victory conditions, theme settings, and gameplay modifiers
 * that mix mechanics from Standard Single Player and Infinity modes.
 *
 * Phase 1 Implementation:
 * - Basic level selection and launching
 * - Progress tracking via OdysseyStateManager
 * - Level configuration via LevelRegistry
 * - Standard gameplay with level-specific settings
 */

import { BaseGameMode } from './BaseGameMode.js';
import {
    GameState,
    spawnPiece,
    fillBag,
    gameLoop,
    move as coreMove,
    rotate as coreRotate,
    hardDrop as coreHardDrop,
    softDrop as coreSoftDrop,
} from '../game.js';
import {
    checkInfinityGameOver,
} from '../infinity-grid.js';
import {
    GAME_MODES,
    COLS,
    ROWS,
    HIDDEN_ROWS,
    BLOCK_SIZE,
    LEVEL_SPEEDS,
} from '../constants.js';
import { draw, updateStats } from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { OdysseyStateManager } from '../odyssey/OdysseyStateManager.js';
import { getLevelRegistry } from '../odyssey/LevelRegistry.js';
import { GameplayHybridEngine } from '../odyssey/GameplayHybridEngine.js';
import { ThemeTransitionManager } from '../odyssey/ThemeTransitionManager.js';
import { OdysseyBoardController } from '../../rendering/odyssey/OdysseyBoardController.js';
import { getLevelPathPosition } from '../../rendering/odyssey/path-data.js';
import { OdysseyHUD } from '../../ui/odyssey/OdysseyHUD.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';

/**
 * OdysseyMode - Narrative-driven progression through themed levels
 */
export class OdysseyMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Odyssey-specific state
        this.odysseyState = new OdysseyStateManager();
        this.levelRegistry = getLevelRegistry();

        // Phase 2: Gameplay Hybrid Engine
        this.hybridEngine = new GameplayHybridEngine();

        // Current level state
        this.currentLevelId = null;
        this.currentLevelConfig = null;
        this.gameState = null;
        this.levelStartTime = null;
        this.levelTimerInterval = null;

        // Phase 3: Odyssey Board Controller
        this.boardController = null;

        // Phase 4: Theme Transition Manager
        this.transitionManager = null; // Initialized in onActivate when themeManager is available

        // UI state
        this.isInBoardView = true; // true = level select, false = playing level
        this.cleanupHandlers = [];

        // Input overrides
        this.originalInputs = {};

        // Performance throttling
        this.lastStatsUpdateTime = 0;
        this.statsUpdateInterval = 250;

        // Phase 6: Odyssey HUD
        this.odysseyHUD = null;

        // Minimap for tall boards (30+ rows)
        this.minimap = null;
        this.MINIMAP_ROW_THRESHOLD = 30;

        // Tall board camera system (ported from InfinityMode)
        this.visibleRows = 20;
        this.boardScene = null;

        // Event handlers for camera control during pause (bound for cleanup)
        this.handleKeyPress = this._onKeyPress.bind(this);
        this.handleWheel = this._onWheel.bind(this);

        // Prevent multiple level completions
        this.levelCompleting = false;
    }

    /**
     * Get level metrics from hybrid engine
     * @returns {Object} Current level metrics
     */
    get levelMetrics() {
        return this.hybridEngine?.getMetrics() || {
            lines: 0,
            score: 0,
            time: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            combos: 0,
            tetrises: 0,
            singles: 0,
            maxCombo: 0,
        };
    }

    getModeId() {
        return GAME_MODES.ODYSSEY;
    }

    getDisplayName() {
        return 'Odyssey Mode';
    }

    // =============================
    // Lifecycle Methods
    // =============================

    /**
     * Called when Odyssey Mode is selected
     */
    async onActivate() {
        await super.onActivate();

        console.log('[Odyssey] Activating Odyssey Mode...');

        // Load saved progress
        this.odysseyState.load();

        // Show odyssey UI
        this._showOdysseyUI();

        // Start session tracking
        this.odysseyState.startSession();

        // Phase 4: Initialize theme transition manager
        if (this.deps?.themeManager && !this.transitionManager) {
            this.transitionManager = new ThemeTransitionManager(this.deps.themeManager);
        }

        // Default to board view (level selection)
        this.isInBoardView = true;
        this._showBoardView();

        // Expose for console testing: window.testOdysseyLevel(3) to test level 3
        window.testOdysseyLevel = (levelId) => {
            console.log(`[Odyssey] Testing level ${levelId}...`);
            // Unlock the level for testing (bypasses normal progression)
            this.odysseyState.unlockLevel(levelId);
            return this.enterLevel(levelId);
        };
        window.odysseyMode = this;

        console.log('[Odyssey] Mode activated');
        console.log(`[Odyssey] Progress: ${this.odysseyState.getOverallProgress()}%`);
        console.log('[Odyssey] Debug: Use window.testOdysseyLevel(levelId) to test a specific level');
    }

    /**
     * Called when user starts a level
     */
    async onStart() {
        await super.onStart();
        console.log('[Odyssey] onStart called - entering level');
    }

    /**
     * Called when game is paused
     */
    onPause(options = {}) {
        super.onPause();

        if (this.gameState) {
            this.gameState.isPaused = true;
        }

        // Pause level timer
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

        // For tall boards, enable camera navigation during pause
        const boardRows = this.currentLevelConfig?.mechanics?.board?.rows || 20;
        const isTallBoard = boardRows >= this.MINIMAP_ROW_THRESHOLD;

        if (isTallBoard) {
            if (this.boardScene) {
                this.boardScene.enableManualCameraControl();
                this._setupCameraControls();
                console.log('[Odyssey] Camera controls enabled for tall board - Use arrow keys or mouse wheel');
            }

            // Trigger minimap pause highlight effect
            if (this.minimap) {
                this.minimap.onPause();
            }
        }
    }

    /**
     * Called when game is resumed
     */
    onResume() {
        super.onResume();

        if (this.gameState) {
            this.gameState.isPaused = false;
            this.gameState.lastTime = performance.now();
        }

        // Resume level timer
        if (this.currentLevelConfig && !this.isInBoardView) {
            this._startLevelTimer();
        }

        // For tall boards, disable manual camera control
        const boardRows = this.currentLevelConfig?.mechanics?.board?.rows || 20;
        const isTallBoard = boardRows >= this.MINIMAP_ROW_THRESHOLD;

        if (isTallBoard) {
            if (this.boardScene) {
                this.boardScene.disableManualCameraControl();
                this._removeCameraControls();
            }

            // Trigger minimap unpause effect
            if (this.minimap) {
                this.minimap.onUnpause();
            }
        }
    }

    /**
     * Called when game ends
     */
    async onStop() {
        await super.onStop();

        console.log('[Odyssey] Stopping...');

        // Stop game loop
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Stop level timer
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

        // Victory Lap System: Clean up
        this._hideGoalCompleteOverlay();
        this._removeVictoryLapInputs();

        // Phase 6: Clean up Odyssey HUD
        this._cleanupOdysseyHUD();

        // Clean up minimap
        this._cleanupMinimap();

        // Remove infinity layout if it was applied
        this._applyInfinityLayout(false);

        this._stopPhaserBoardScene();
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[Odyssey] Deactivating...');

        // End session and save
        this.odysseyState.endSession();
        this.odysseyState.save();

        // Restore inputs
        this._restoreInputs();

        // Hide odyssey UI
        this._hideOdysseyUI();

        // Cleanup
        this.gameState = null;
        this.currentLevelId = null;
        this.currentLevelConfig = null;

        this._cleanupEventListeners(this.cleanupHandlers);

        this._stopPhaserBoardScene();
    }

    // =============================
    // Odyssey-Specific Methods
    // =============================

    /**
     * Enter a specific level
     * @param {number} levelId - Level to enter
     */
    async enterLevel(levelId) {
        console.log(`[Odyssey] Entering level ${levelId}...`);

        // Check if level is unlocked
        if (!this.odysseyState.isLevelUnlocked(levelId)) {
            console.warn(`[Odyssey] Level ${levelId} is locked`);
            return false;
        }

        // Get level configuration
        const levelConfig = this.levelRegistry.getLevel(levelId);
        if (!levelConfig) {
            console.error(`[Odyssey] Level ${levelId} not found in registry`);
            return false;
        }

        this.currentLevelId = levelId;
        this.currentLevelConfig = levelConfig;

        // Reset level metrics
        this._resetLevelMetrics();

        // Create game state based on level config
        this._createGameStateForLevel(levelConfig);

        // Phase 4: Cinematic transition with background loading
        // Total duration: ~10.5 seconds
        // 1. Camera zoom starts (7s)
        // 2. Warp starts at 2.5s (halfway through zoom), runs for 8s
        // 3. Theme + board load in BACKGROUND (start at 6.0s)
        // 4. Gameplay reveals smoothly at 6.5s (4s overlap with warp end)
        // 5. Level starts (pieces fall) at 9.5s (1s before warp fully ends)

        console.log('[Odyssey] Starting 10-second cinematic transition...');

        // Start camera zoom (non-blocking) -- ZOOM FOR 7 SECONDS
        const zoomDuration = 7000;
        this._startCameraZoom(levelId, zoomDuration);

        // Wait 2.5s before starting warp (allow significant camera movement)
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // CRITICAL: Hide all game UI BEFORE warp starts (warp is transparent)
        this._hideGameUIForTransition();

        // Start warp animation
        const warpDuration = 8000;
        const warpPromise = this.transitionManager?.playWarp?.(warpDuration)
            || new Promise((resolve) => setTimeout(resolve, warpDuration));

        // Wait 3.5s for warp to fade in and cover the screen before hiding board
        // Warp starts at 2.5s. Fully opaque at ~5.7s. 
        // We hide board at T = 2.5 + 3.5 = 6.0s.
        await new Promise((resolve) => setTimeout(resolve, 3500));

        // Load theme and prepare board IN BACKGROUND (now hidden behind opaque warp)
        const loadingPromise = this._loadLevelInBackground(levelConfig);

        // Wait for loading to complete (it should be fast)
        await loadingPromise;

        // Reveal gameplay view EARLY (4s before warp ends) to blend with warp fade-out
        // Warp duration is 8000ms. Warp start 2.5s. Warp ends 10.5s.
        // Current time is T = 6.0s.
        // We want to trigger reveal at 6.5s (4s before warp ends).
        // So we wait another 500ms.
        console.log('[Odyssey] Waiting to trigger early reveal...');
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Switch to gameplay view (starts fade-in animation)
        console.log('[Odyssey] Triggering early gameplay reveal (4s before warp ends)');
        this.isInBoardView = false;
        this._showGameplayView(); // Async, don't await full completion yet

        // Warp finishes at T+10.5s. We are at T+6.5s.
        // We want to start level at T+9.5s (1s before warp ends).
        // Wait 3000ms.
        console.log('[Odyssey] Waiting to start level...');
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Start the level EARLY (1s before warp ends)
        console.log('[Odyssey] Starting level early (1s before warp ends)');
        this._showLevelIntro(levelConfig);
        this._startLevel();

        // Wait remaining 1000ms for warp to finish completely
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Ensure warp promise is settled nicely
        warpPromise.catch(e => console.error(e));

        // Clean up the Odyssey Board now that transition is fully complete
        // Doing this at the end prevents stutters during the animation
        setTimeout(() => this._disposeOdysseyBoard(), 2000);

        return true;
    }

    /**
     * Start camera zoom animation (non-blocking)
     * @private
     */
    _startCameraZoom(levelId, duration) {
        if (!this.boardController?.cameraController) return;

        const nodePosition = this.boardController.nodeManager?.getNodePosition?.(levelId);

        if (nodePosition) {
            this.boardController.cameraController.zoomToPosition(nodePosition, duration);
        } else {
            this.boardController.cameraController.zoomIn?.(5, duration);
        }
    }

    /**
     * Hide all game UI elements before warp starts
     * This ensures nothing shows through the transparent warp
     * @private
     */
    _hideGameUIForTransition() {
        console.log('[Odyssey] Hiding game UI before warp...');

        // Hide game container (Correct ID: single-player-container)
        const gameContainer = document.getElementById('single-player-container');
        if (gameContainer) {
            gameContainer.style.opacity = '0';
            gameContainer.style.visibility = 'hidden';
        }

        // Hide Phaser container
        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.opacity = '0';
            phaserContainer.style.visibility = 'hidden';
        }

        // Hide background container
        const bgContainer = document.querySelector('.background-container');
        if (bgContainer) {
            bgContainer.style.opacity = '0';
        }

        // Hide stats bar
        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.opacity = '0';
            statsBar.style.visibility = 'hidden';
        }
    }

    /**
     * Load theme and prepare board in background during transition
     * @private
     */
    async _loadLevelInBackground(levelConfig) {
        console.log('[Odyssey] Loading theme and board in background...');

        const { theme } = levelConfig;

        try {
            // Load theme silently in background
            if (this.deps.themeManager) {
                // Check if we already started loading during the "Launching..." delay
                if (this.currentThemeSwitchPromise) {
                    console.log('[Odyssey] Waiting for pre-loaded theme...');
                    await this.currentThemeSwitchPromise;
                    this.currentThemeSwitchPromise = null;
                } else {
                    // Fallback if not pre-loaded (e.g. debug start)
                    // Yield to main thread before heavy theme switch to allow warp frame to render
                    await new Promise(resolve => setTimeout(resolve, 0));
                    await this.deps.themeManager.switchTheme(theme.primary, true);
                }

                // CRITICAL: Resume themes if they were suspended (e.g., after returning from board)
                // When returnToBoard() is called, themes get suspended. switchTheme() then defers
                // theme activation. We must explicitly resume to activate the pending theme.
                if (this.deps.themeManager.themesSuspended) {
                    console.log('[Odyssey] Resuming suspended themes after switch...');
                    await this.deps.themeManager.resumeThemes();
                }
            }

            // HIDE the odyssey board (don't dispose yet to avoid stutter)
            const boardContainer = document.getElementById('odyssey-board-3d');
            if (boardContainer) {
                boardContainer.style.display = 'none';
            }
            this._hideLevelSelectUI();

            // Note: Game UI is already hidden by _hideGameUIForTransition
            // so we don't need to redundantly hide everything here.

            console.log('[Odyssey] Background loading complete (hidden until warp ends)');
        } catch (error) {
            console.error('[Odyssey] Background loading failed:', error);
        }
    }

    /**
     * Complete the current level
     * @param {Object} results - Level results
     */
    async completeLevel(results) {
        // Prevent multiple completions
        if (this.levelCompleting) return;
        this.levelCompleting = true;

        console.log(`[Odyssey] Level ${this.currentLevelId} completed!`, results);

        // Stop game loop immediately
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Stop level timer
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

        // Calculate final metrics
        const finalResults = {
            score: this.gameState.score,
            time: this.levelMetrics.time,
            lines: this.levelMetrics.lines,
            cascades: this.levelMetrics.cascades,
            maxCascadeDepth: this.levelMetrics.maxCascadeDepth,
            combo: this.levelMetrics.combos,
            tetrises: this.levelMetrics.tetrises,
            ...results,
        };

        // Calculate stars
        const stars = this._calculateStars(finalResults);
        finalResults.stars = stars;

        // Evaluate bonuses
        const bonuses = this._evaluateBonuses(finalResults);
        finalResults.bonuses = bonuses;

        // Save completion to odyssey state
        this.odysseyState.completeLevel(this.currentLevelId, finalResults);

        // Show results
        await this._showLevelResults(finalResults);

        // Return to board view
        await this.returnToBoard();
    }

    /**
     * Fail the current level
     * @param {string} reason - Failure reason
     */
    async failLevel(reason = 'top-out') {
        // Prevent multiple completions/failures
        if (this.levelCompleting) return;
        this.levelCompleting = true;

        console.log(`[Odyssey] Level ${this.currentLevelId} failed: ${reason}`);

        // Stop game loop immediately
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Stop level timer
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

        // Victory Lap System: Clean up (in case of time failure during victory lap)
        this._hideGoalCompleteOverlay();
        this._removeVictoryLapInputs();

        // Record attempt
        this.odysseyState.recordAttempt(this.currentLevelId);

        // Show failure screen
        await this._showLevelFailure(reason);

        // Return to board view
        await this.returnToBoard();
    }

    /**
     * Return to the board view (level selection)
     */
    async returnToBoard() {
        console.log('[Odyssey] Returning to board view...');

        // Phase 4: Transition effect when returning to board
        if (this.transitionManager) {
            await this.transitionManager.transitionToBoard(600);
        }

        // Stop current gameplay
        await this.onStop();

        // Clear current level
        this.currentLevelId = null;
        this.currentLevelConfig = null;
        this.gameState = null;

        // Switch to board view
        this.isInBoardView = true;
        this._showBoardView();

        // Restore inputs
        this._restoreInputs();
    }

    /**
     * Navigate to a specific chapter
     * @param {number} chapterId
     */
    navigateToChapter(chapterId) {
        console.log(`[Odyssey] Navigating to chapter ${chapterId}`);
        // Phase 3: Camera navigation on 3D board
        // For now, just update UI to show chapter's levels
        this._updateLevelSelectUI(chapterId);
    }

    /**
     * Get progress summary for UI
     */
    getProgress() {
        return this.odysseyState.getProgressSummary();
    }

    // =============================
    // Private: Game State Setup
    // =============================

    /**
     * Create GameState configured for the level
     * @private
     */
    _createGameStateForLevel(levelConfig) {
        const { mechanics } = levelConfig;

        // Phase 2: Use GameplayHybridEngine to create configured GameState
        this.hybridEngine.configure(levelConfig);
        this.gameState = this.hybridEngine.createGameState();

        // Add starting rows if configured
        if (mechanics.board.startingRows > 0) {
            this._addStartingRows(mechanics.board.startingRows);
        }

        console.log(`[Odyssey] GameState created via HybridEngine: mode=${mechanics.baseMode}, rows=${mechanics.board.rows}, startLevel=${this.gameState.level}`);
    }

    /**
     * Add pre-filled garbage rows to the board
     * Creates solid garbage rows with one random gap per row, matching multiplayer garbage format.
     * @private
     */
    _addStartingRows(rowCount) {
        const { lockedPieces, boardGrid } = this.gameState;
        const cols = COLS;
        const totalRows = boardGrid.length;

        for (let row = 0; row < rowCount; row++) {
            const boardRow = totalRows - row - 1;
            // Create a row with one random gap (matching Quadra-style garbage)
            const gapCol = Math.floor(Math.random() * cols);

            // Build the row shape: 1 = solid block, 0 = hole
            const rowShape = [];
            for (let col = 0; col < cols; col++) {
                const isHole = col === gapCol;
                rowShape.push(isHole ? 0 : 1);

                // Also add to boardGrid for immediate rendering
                if (!isHole && boardGrid[boardRow]) {
                    boardGrid[boardRow][col] = {
                        color: '#666666',
                        type: 'garbage',
                        id: `starting_garbage_${boardRow}_${col}`,
                    };
                }
            }

            // Create a full-row garbage piece (like multiplayer garbage.js does)
            const garbagePiece = {
                shapeKey: 'GARBAGE',
                shape: [rowShape],
                x: 0,
                y: boardRow,
                color: '#666666',
                type: 'garbage',  // Explicit type for consistent rendering
                pieceId: `starting_garbage_${boardRow}`,
                isGarbage: true,
                garbageMeta: {
                    variant: 'normal',
                    connectTop: row < rowCount - 1,
                    connectBottom: row > 0,
                },
            };

            lockedPieces.push(garbagePiece);
        }

        console.log(`[Odyssey] Added ${rowCount} starting garbage rows`);
    }

    /**
     * Zoom the Odyssey Board camera into the selected level node
     * Creates a slow, cinematic zoom effect that overlaps with warp
     * @private
     */
    async _zoomIntoLevel(levelId) {
        if (!this.boardController?.cameraController) {
            console.log('[Odyssey] No camera controller for zoom');
            return;
        }

        console.log(`[Odyssey] Cinematic zoom into level ${levelId}...`);

        // Get the node position from the board
        const nodePosition = this.boardController.nodeManager?.getNodePosition?.(levelId);

        const zoomDuration = 2500; // Slow, dramatic zoom for seamless feel

        if (nodePosition) {
            // Slow, dramatic zoom into the node
            this.boardController.cameraController.zoomToPosition(nodePosition, zoomDuration);
        } else {
            // Fallback: zoom forward
            this.boardController.cameraController.zoomIn?.(3, zoomDuration);
        }

        // Start warp effect at 40% of zoom - warp fades in gradually, blending with camera zoom
        await new Promise((resolve) => setTimeout(resolve, zoomDuration * 0.4));

        // Start warp while zoom is still finishing - handled by transitionManager
    }

    /**
     * Apply level's theme
     * @private
     */
    async _applyLevelTheme(levelConfig) {
        const { theme } = levelConfig;

        console.log(`[Odyssey] Applying theme: ${theme.primary}`);

        // Phase 4: Use transition manager if available
        if (this.transitionManager) {
            await this.transitionManager.setupLevel(theme);
        } else if (this.deps.themeManager) {
            // Fallback to direct switch
            await this.deps.themeManager.switchTheme(theme.primary);
        }
    }

    // =============================
    // Private: Gameplay
    // =============================

    /**
     * Start the level gameplay
     * @private
     */
    async _startLevel() {
        console.log('[Odyssey] Starting level gameplay...');

        // Reset completion flag for new level
        this.levelCompleting = false;

        // Hook inputs
        this._hookInputs();

        // Check if this is a tall board level
        const boardRows = this.currentLevelConfig?.mechanics?.board?.rows || 20;
        const isTallBoard = boardRows >= this.MINIMAP_ROW_THRESHOLD;

        // Apply infinity layout for tall boards
        if (isTallBoard) {
            this._applyInfinityLayout(true);
            console.log(`[Odyssey] Applied infinity layout for ${boardRows}-row board`);
        }

        // Show Phaser board scene and store reference
        this._startPhaserBoardScene();
        this.boardScene = this._getBoardScene();
        this._clearPhaserBoard();

        // For tall boards, sync game state and configure camera
        if (isTallBoard && this.boardScene) {
            this.boardScene.syncFromGameState(this.gameState);
            this.boardScene.configureCamera();

            // Calculate camera position accounting for garbage rows
            // With HIDDEN_ROWS=4, board has totalRows+4 rows (e.g., 104 for 100-row board)
            // Garbage fills bottom startingRows rows
            // Camera should show the area just above the garbage
            const totalBoardRows = boardRows + 4; // Include hidden rows
            const startingGarbageRows = this.currentLevelConfig?.mechanics?.board?.startingRows || 0;
            const visibleRows = 20;

            // Position camera so visible area is just above garbage
            // Garbage is at rows (totalBoardRows - startingGarbageRows) to (totalBoardRows - 1)
            // Camera should show the 20 rows just above the garbage top
            const garbageTopRow = totalBoardRows - startingGarbageRows;
            const spawnRow = Math.max(0, garbageTopRow - visibleRows);

            this.boardScene.updateCameraPosition(spawnRow);
            // CRITICAL: Set gameState.cameraRow for proper piece spawning
            this.gameState.cameraRow = spawnRow;
            console.log(`[Odyssey] Camera configured for ${boardRows}-row board, garbage=${startingGarbageRows}, positioned at row ${spawnRow}`);
        }

        // Initialize piece bag
        fillBag(this.gameState.nextPieces, this.gameState.randomGenerator);

        // Spawn first piece
        this.gameState.lastTime = performance.now();
        spawnPiece(
            this.gameState,
            () => this._refreshNextQueue(),
            () => this._handleGameOver(),
        );

        // Update UI
        this._refreshNextQueue();
        this._updateStats();

        // Phase 6: Initialize and show Odyssey HUD
        this._initializeOdysseyHUD();

        // Initialize minimap for tall boards
        this._initializeMinimap();

        // Start level timer
        this.levelStartTime = Date.now();
        this._startLevelTimer();

        // Start game loop
        this._startGameLoop();

        // Mark as running
        this.isRunning = true;

        console.log('[Odyssey] Level started!');
    }

    /**
     * Start the game loop
     * @private
     */
    _startGameLoop() {
        if (!this.gameState) return;

        // Cancel any existing loop
        if (this.gameState.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
        }

        this.lastStatsUpdateTime = performance.now();

        const drawCallback = () => {
            const boardScene = this._getBoardScene();
            if (boardScene) {
                boardScene.syncFromGameState(this.gameState);

                // Update camera position for tall boards
                if (boardScene.cameraSettings && !boardScene.cameraSettings.manualControl) {
                    this._updateCameraPosition();
                }
            }
        };

        const statsCallback = () => {
            const now = performance.now();
            if (now - this.lastStatsUpdateTime >= this.statsUpdateInterval) {
                this.lastStatsUpdateTime = now;
                this._updateStats();

                // Phase 6: Update Odyssey HUD with current metrics
                this._updateOdysseyHUD();

                // Update minimap for tall boards
                this._updateMinimap();
            }

            // Check victory conditions
            this._checkVictoryConditions();

            // Check failure conditions for tall boards (Infinity Mode logic)
            if (this.currentLevelConfig?.mechanics?.baseMode === 'infinity' || this.isTallBoard) {
                if (!this.gameState.isGameOver && checkInfinityGameOver(this.gameState)) {
                    console.log('[Odyssey] Game over condition met (Board Full)');
                    this.gameState.isGameOver = true;
                    this._handleGameOver();
                }
            }
        };

        gameLoop(
            performance.now(),
            this.gameState,
            drawCallback,
            statsCallback,
            () => this.deps.soundManager?.sfxPlayer?.playDrop(),
            this._getPhysicsCallbacks(),
        );
    }

    /**
     * Get physics callbacks
     * @private
     */
    _getPhysicsCallbacks() {
        // Phase 2: Build base callbacks, then wrap with hybridEngine for metric tracking
        const baseCallbacks = {
            onMove: () => this.deps.soundManager?.sfxPlayer?.playMove(),
            onRotate: () => this.deps.soundManager?.sfxPlayer?.playRotate(),
            onLineClear: (lineCount) => {
                this.deps.soundManager?.sfxPlayer?.playLineClear();
                // Metrics are tracked by hybridEngine.buildPhysicsCallbacks() wrapper

                // Emit event
                eventBus.emit(EVENTS.LINE_CLEAR, {
                    lineCount,
                    source: 'odyssey',
                    levelId: this.currentLevelId,
                });
            },
            onLevelUp: () => this.deps.soundManager?.sfxPlayer?.playLevelUp(),
            onHardDrop: () => this.deps.soundManager?.sfxPlayer?.playDrop(),
            triggerCombo: (comboCount) => {
                // Metrics are tracked by hybridEngine.buildPhysicsCallbacks() wrapper

                eventBus.emit(EVENTS.COMBO, {
                    comboCount,
                    source: 'odyssey',
                    levelId: this.currentLevelId,
                });

                const boardScene = this._getBoardScene();
                if (boardScene?.showComboPopup) {
                    boardScene.showComboPopup(comboCount);
                }
            },
            triggerCascadeWave: (cascadeCount) => {
                // Metrics are tracked by hybridEngine.buildPhysicsCallbacks() wrapper

                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects) {
                    boardScene.sharedEffects.showCascadeWave(cascadeCount);
                }
            },
            triggerFlash: (fullLines) => {
                const boardScene = this._getBoardScene();
                if (boardScene?.triggerLineClearFlash) {
                    boardScene.triggerLineClearFlash(fullLines);
                }
            },
            onLineClearImpact: (lineCount, cascadeCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene?.playLineClearImpact) {
                    boardScene.playLineClearImpact(lineCount, cascadeCount);
                }
            },
            triggerBackgroundPulse: (lineCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene?.triggerBackgroundPulse) {
                    boardScene.triggerBackgroundPulse(lineCount);
                }
            },
            onPieceLock: (piece) => {
                // Metrics (piece placed) are tracked by hybridEngine.buildPhysicsCallbacks()
                eventBus.emit(EVENTS.PIECE_LOCK, { piece });

                const boardScene = this._getBoardScene();
                if (boardScene?.createPieceLockRipple) {
                    boardScene.createPieceLockRipple(piece);
                }
            },
            spawnPiece: () => {
                spawnPiece(
                    this.gameState,
                    () => this._refreshNextQueue(),
                    () => this._handleGameOver(),
                );
            },
        };

        // Wrap callbacks with hybridEngine metric tracking
        return this.hybridEngine.buildPhysicsCallbacks(baseCallbacks);
    }

    // =============================
    // Private: Victory/Failure
    // =============================

    /**
     * Check if victory conditions are met
     * @private
     */
    _checkVictoryConditions() {
        // Skip if already completing or no level config
        if (this.levelCompleting || !this.currentLevelConfig || !this.gameState) return;

        // Phase 2: Use hybridEngine for victory/failure checking
        if (this.hybridEngine.checkVictory()) {
            // Victory Lap System: Don't end level immediately, enter victory lap
            if (!this.gameState.goalComplete) {
                console.log('[Odyssey] Goal complete! Entering Victory Lap...');
                this._enterVictoryLap();
            }
            // During victory lap, victory conditions are already met - just keep playing
            return;
        }

        if (this.hybridEngine.checkFailure()) {
            this.failLevel('time');
        }
    }

    /**
     * Enter victory lap mode - goal is complete but player can keep playing for stars
     * @private
     */
    _enterVictoryLap() {
        this.gameState.goalComplete = true;
        this.gameState.victoryLapActive = true;
        this.gameState.victoryLapStartTime = performance.now();

        // Show goal complete overlay
        this._showGoalCompleteOverlay();

        // Update HUD to show victory lap state
        if (this.odysseyHUD) {
            this.odysseyHUD.enterVictoryLap();
        }

        // Play celebration sound
        this.deps?.soundManager?.sfxPlayer?.playLevelUp?.();

        // Emit event for other systems
        eventBus.emit(EVENTS.ODYSSEY_GOAL_COMPLETE, {
            levelId: this.currentLevelId,
            metrics: this.levelMetrics,
        });

        // Set up victory lap input handler
        this._setupVictoryLapInputs();

        console.log('[Odyssey] Victory lap started - press Enter to finish or keep playing for more stars');
    }

    /**
     * Finish victory lap and complete the level
     * @private
     */
    _finishVictoryLap() {
        if (!this.gameState?.victoryLapActive) return;

        console.log('[Odyssey] Victory lap finished, completing level...');
        this.gameState.victoryLapActive = false;

        // Hide overlay
        this._hideGoalCompleteOverlay();

        // Remove victory lap input handler
        this._removeVictoryLapInputs();

        // Emit event
        eventBus.emit(EVENTS.ODYSSEY_VICTORY_LAP_END, {
            levelId: this.currentLevelId,
            metrics: this.levelMetrics,
        });

        // Complete the level with final metrics
        this.completeLevel({});
    }

    /**
     * Set up input handling for victory lap (Enter/Escape to finish)
     * @private
     */
    _setupVictoryLapInputs() {
        this._victoryLapKeyHandler = (e) => {
            if (!this.gameState?.victoryLapActive) return;
            if (this.gameState?.isPaused) return;

            // Enter or Escape to finish
            if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this._finishVictoryLap();
            }
        };

        document.addEventListener('keydown', this._victoryLapKeyHandler);
    }

    /**
     * Remove victory lap input handler
     * @private
     */
    _removeVictoryLapInputs() {
        if (this._victoryLapKeyHandler) {
            document.removeEventListener('keydown', this._victoryLapKeyHandler);
            this._victoryLapKeyHandler = null;
        }
    }

    /**
     * Show goal complete overlay during victory lap
     * @private
     */
    _showGoalCompleteOverlay() {
        // Remove existing overlay if any
        this._hideGoalCompleteOverlay();

        this._goalCompleteOverlay = document.createElement('div');
        this._goalCompleteOverlay.id = 'goal-complete-overlay';
        this._goalCompleteOverlay.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, rgba(20, 60, 40, 0.95), rgba(10, 40, 30, 0.95));
            border: 2px solid rgba(100, 255, 150, 0.6);
            border-radius: 16px;
            padding: 16px 32px;
            z-index: 1000;
            text-align: center;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 60px rgba(100, 255, 150, 0.3);
            animation: goalCompleteSlideIn 0.5s ease-out;
        `;

        this._goalCompleteOverlay.innerHTML = `
            <style>
                @keyframes goalCompleteSlideIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes goalCompletePulse {
                    0%, 100% { opacity: 0.7; }
                    50% { opacity: 1; }
                }
                .goal-complete-title {
                    font-family: 'Orbitron', sans-serif;
                    font-size: 24px;
                    font-weight: 700;
                    color: #4ade80;
                    text-shadow: 0 0 20px rgba(100, 255, 150, 0.8);
                    margin-bottom: 8px;
                }
                .goal-complete-subtitle {
                    font-family: 'Segoe UI', sans-serif;
                    font-size: 14px;
                    color: rgba(255, 255, 255, 0.8);
                }
                .goal-complete-hint {
                    font-family: 'Segoe UI', sans-serif;
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.6);
                    margin-top: 8px;
                    animation: goalCompletePulse 2s ease-in-out infinite;
                }
                .goal-complete-hint kbd {
                    background: rgba(255, 255, 255, 0.2);
                    padding: 2px 8px;
                    border-radius: 4px;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                }
            </style>
            <div class="goal-complete-title">GOAL COMPLETE!</div>
            <div class="goal-complete-subtitle">Keep playing for more stars</div>
            <div class="goal-complete-hint">Press <kbd>Enter</kbd> to finish</div>
        `;

        document.body.appendChild(this._goalCompleteOverlay);
    }

    /**
     * Hide goal complete overlay
     * @private
     */
    _hideGoalCompleteOverlay() {
        if (this._goalCompleteOverlay) {
            this._goalCompleteOverlay.remove();
            this._goalCompleteOverlay = null;
        }
    }

    /**
     * Calculate stars for level completion
     * @private
     */
    _calculateStars() {
        // Phase 2: Use hybridEngine for star calculation
        return this.hybridEngine.calculateStars();
    }

    /**
     * Check if results meet a star condition
     * @private
     * @deprecated Use hybridEngine.calculateStars() instead
     */
    _meetsCondition(results, condition) {
        // Kept for backwards compatibility
        for (const [key, target] of Object.entries(condition)) {
            if (key === 'bonuses') {
                const completedBonuses = results.bonuses?.filter((b) => b).length || 0;
                if (completedBonuses < target) return false;
            } else {
                const value = results[key] ?? this.levelMetrics[key] ?? this.gameState?.[key] ?? 0;
                if (value < target) return false;
            }
        }
        return true;
    }

    /**
     * Evaluate bonus objectives
     * @private
     */
    _evaluateBonuses() {
        // Phase 2: Use hybridEngine for bonus evaluation
        return this.hybridEngine.evaluateBonuses();
    }

    /**
     * Handle game over (top-out)
     * @private
     */
    async _handleGameOver() {
        console.log('[Odyssey] Game over (top-out)');

        // Victory Lap System: During victory lap, top-out completes the level (not a failure)
        if (this.gameState?.victoryLapActive) {
            console.log('[Odyssey] Top-out during victory lap - completing level with current progress');
            this._finishVictoryLap();
            return;
        }

        // Check failure condition
        const failureType = this.currentLevelConfig?.victory?.failure?.type;

        if (failureType === 'top-out' || failureType === undefined) {
            await this.failLevel('top-out');
        } else {
            // Top-out might not be a failure for some levels
            // For now, treat it as failure
            await this.failLevel('top-out');
        }
    }

    // =============================
    // Private: UI
    // =============================

    /**
     * Show odyssey-specific UI
     * @private
     */
    _showOdysseyUI() {
        // Show single player stage and container (reuse for now)
        const singlePlayerStage = document.querySelector('.single-player-stage');
        if (singlePlayerStage) {
            singlePlayerStage.style.setProperty('display', 'flex', 'important');
            singlePlayerStage.style.setProperty('visibility', 'visible', 'important');
        }

        const singlePlayerContainer = document.getElementById('single-player-container');
        if (singlePlayerContainer) {
            singlePlayerContainer.style.setProperty('display', 'flex', 'important');
            singlePlayerContainer.style.setProperty('visibility', 'visible', 'important');
        }

        // Hide multiplayer container
        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'none';
        }

        // Hide intro animation
        const introAnimation = document.getElementById('intro-animation');
        if (introAnimation) {
            introAnimation.style.setProperty('display', 'none', 'important');
        }
    }

    /**
     * Hide odyssey UI
     * @private
     */
    _hideOdysseyUI() {
        this._hideLevelSelectUI();
    }

    /**
     * Show board view (level selection)
     * @private
     */
    async _showBoardView() {
        console.log('[Odyssey] Showing board view');

        // Initialize Three.js Odyssey Board if not exists
        await this._initializeOdysseyBoard();

        // Phase 3: Using 3D board as primary level selector
        // The HTML UI is disabled - 3D board handles level selection via click
        // this._showLevelSelectUI();
        this._stopPhaserBoardScene();
    }

    /**
     * Initialize the Three.js Odyssey Board
     * @private
     */
    async _initializeOdysseyBoard() {
        if (this.boardController) {
            return; // Already initialized
        }

        // Create container for the 3D board
        let boardContainer = document.getElementById('odyssey-board-3d');
        if (!boardContainer) {
            boardContainer = document.createElement('div');
            boardContainer.id = 'odyssey-board-3d';
            Object.assign(boardContainer.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100vw',
                height: '100vh',
                zIndex: '999', // Below level select UI
                pointerEvents: 'auto',
            });
            document.body.appendChild(boardContainer);
        }

        // Create board controller
        this.boardController = new OdysseyBoardController(boardContainer);

        // Prepare level data with path positions
        const allLevels = this.levelRegistry.getAllLevels();
        const levelData = allLevels.map((level) => ({
            ...level,
            pathPosition: getLevelPathPosition(level.id),
        }));

        // Get progress data
        // Build level progress from OdysseyStateManager
        const levelProgress = {};
        for (let i = 1; i <= 56; i++) {
            const completion = this.odysseyState.getLevelCompletion(i);
            if (completion) {
                levelProgress[i] = {
                    completed: true,
                    stars: completion.stars || 0,
                };
            }
        }

        const progressData = {
            furthestLevel: Math.max(...Array.from(this.odysseyState.unlockedLevels)),
            levelProgress,
        };

        // Initialize the board
        await this.boardController.initialize(levelData, progressData);

        // Connect level selection callback - now shows info panel first
        // Click once to select (shows info), click again or use Play button to enter
        this.boardController.onLevelSelect = (levelId) => {
            console.log(`[Odyssey] Board clicked level: ${levelId}`);
            // Always show info panel - do NOT auto-start level on second click
            // User must press the "Play" button in the panel
            this._updateLevelPreview(levelId);
        };

        // Hover just updates cursor, doesn't change panel
        this.boardController.onLevelHover = (levelId) => {
            // Visual feedback only (cursor change handled in board controller)
            // Panel stays showing the selected level
        };

        // Empty click hides the info panel
        this.boardController.onEmptyClick = () => {
            this.selectedLevelId = null;
            const panel = document.getElementById('odyssey-level-panel');
            if (panel) panel.classList.add('hidden');
        };

        // Create the info overlay (header + level panel)
        this._createBoardInfoOverlay();

        // Pre-initialize warp transition to avoid GPU init freeze later
        if (this.transitionManager) {
            this.transitionManager.preInitWarp();
        }

        console.log('[Odyssey] Three.js board initialized');
    }

    /**
     * Dispose the Odyssey Board
     * @private
     */
    _disposeOdysseyBoard() {
        if (this.boardController) {
            this.boardController.dispose();
            this.boardController = null;
        }

        const boardContainer = document.getElementById('odyssey-board-3d');
        if (boardContainer) {
            boardContainer.remove();
        }

        // Also dispose the info overlay
        this._disposeInfoOverlay();
    }

    /**
     * Create the Odyssey Board info overlay (header + level panel)
     * @private
     */
    _createBoardInfoOverlay() {
        // Check if already exists
        if (document.getElementById('odyssey-board-overlay')) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'odyssey-board-overlay';
        overlay.innerHTML = `
            <div class="odyssey-header-bar">
                <h1>Odyssey Mode</h1>
                <div class="odyssey-progress-info">
                    <span id="odyssey-header-stars">⭐ 0/168</span>
                    <span id="odyssey-header-progress">Progress: 0%</span>
                </div>
            </div>
            <div id="odyssey-level-panel" class="odyssey-level-panel hidden">
                <h2 id="level-panel-name">Level Name</h2>
                <p id="level-panel-chapter" class="level-chapter">Chapter 1</p>
                <p id="level-panel-description" class="level-description">Description...</p>
                <div id="level-panel-stars" class="level-stars">☆☆☆</div>
                <div id="level-panel-objectives" class="level-objectives"></div>
                <button id="level-panel-play-btn" class="level-play-btn">▶ Play</button>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.id = 'odyssey-board-overlay-styles';
        style.textContent = `
            #odyssey-board-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 1001;
            }
            .odyssey-header-bar {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 1rem 2rem;
                background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%);
                pointer-events: auto;
            }
            .odyssey-header-bar h1 {
                font-family: 'Orbitron', sans-serif;
                font-size: 1.5rem;
                color: #00ffcc;
                text-shadow: 0 0 10px #00ffcc;
                margin: 0;
            }
            .odyssey-progress-info {
                display: flex;
                gap: 2rem;
                font-size: 1rem;
                color: #88aaff;
            }
            .odyssey-level-panel {
                position: absolute;
                right: 2rem;
                top: 50%;
                transform: translateY(-50%);
                width: 320px;
                background: rgba(10, 20, 40, 0.95);
                border: 1px solid rgba(100, 150, 255, 0.3);
                border-radius: 12px;
                padding: 1.5rem;
                pointer-events: auto;
                box-shadow: 0 0 30px rgba(0, 100, 255, 0.2);
            }
            .odyssey-level-panel.hidden {
                display: none;
            }
            .odyssey-level-panel h2 {
                margin: 0 0 0.5rem 0;
                font-size: 1.4rem;
                color: #00ffcc;
                font-family: 'Orbitron', sans-serif;
            }
            .level-chapter {
                color: #88aaff;
                font-size: 0.9rem;
                margin: 0 0 1rem 0;
            }
            .level-description {
                color: #aabbcc;
                font-size: 0.95rem;
                line-height: 1.4;
                margin: 0 0 1rem 0;
            }
            .level-stars {
                font-size: 2rem;
                text-align: center;
                margin: 1rem 0;
                letter-spacing: 0.5rem;
            }
            .level-objectives {
                margin: 1rem 0;
                padding: 0.75rem;
                background: rgba(0,0,0,0.3);
                border-radius: 6px;
            }
            .level-objectives div {
                padding: 0.3rem 0;
                font-size: 0.9rem;
                color: #aabbcc;
            }
            .level-play-btn {
                width: 100%;
                padding: 1rem;
                background: linear-gradient(135deg, #00aa88, #0088aa);
                border: none;
                border-radius: 8px;
                color: white;
                font-size: 1.2rem;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.2s;
            }
            .level-play-btn:hover {
                background: linear-gradient(135deg, #00ccaa, #00aacc);
                transform: scale(1.02);
            }
            .level-play-btn:disabled {
                background: #444;
                cursor: not-allowed;
            }
            @keyframes btn-click-pulse {
                0% { transform: scale(1); box-shadow: 0 0 0 rgba(255, 255, 255, 0); }
                20% { transform: scale(0.92); box-shadow: 0 0 20px rgba(0, 255, 200, 0.8); background: #ffffff; color: #000; }
                50% { transform: scale(1.05); box-shadow: 0 0 10px rgba(0, 255, 200, 0.5); background: #ccffee; }
                100% { transform: scale(1); box-shadow: 0 0 15px rgba(0, 255, 200, 0.4); }
            }
            @keyframes btn-launch-shimmer {
                0% { background-position: 0% 50%; }
                100% { background-position: 200% 50%; }
            }
            .level-play-btn:active {
                transform: scale(0.95);
            }
            .level-play-btn.clicked {
                /* Dynamic gradient background */
                background: linear-gradient(110deg, #00aa88 20%, #00ffcc 30%, #ffffff 50%, #00ffcc 70%, #00aa88 80%);
                background-size: 200% 100%;
                color: #003322;
                text-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
                font-weight: 800;
                
                /* Sequence: Pulse (0.6s) then Shimmer (loop) */
                animation: 
                    btn-click-pulse 0.6s ease-out forwards,
                    btn-launch-shimmer 2s linear infinite;
                
                pointer-events: none;
                border: 1px solid #ffffff;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(overlay);

        // Update header with current progress
        this._updateHeaderProgress();

        // Setup play button
        const playBtn = document.getElementById('level-panel-play-btn');
        playBtn.addEventListener('click', async () => {
            if (this.selectedLevelId) {
                // Add click feedback animation
                playBtn.classList.add('clicked');
                playBtn.textContent = 'Launching...';

                // Wait for animation and linger (3.5s total as requested)
                console.log('[Odyssey] Play clicked. Waiting 3.5s...');

                // Pre-load the theme NOW while the user waits
                // This prevents lag during the actual cinematic transition
                const levelConfig = this.levelRegistry.getLevel(this.selectedLevelId);
                if (levelConfig && levelConfig.theme && this.deps.themeManager) {
                    console.log(`[Odyssey] Pre-loading theme ${levelConfig.theme.primary} during delay...`);
                    this.currentThemeSwitchPromise = this.deps.themeManager.switchTheme(levelConfig.theme.primary, true);
                }

                await new Promise(resolve => setTimeout(resolve, 3500));

                // Close the panel explicitly
                const panel = document.getElementById('odyssey-level-panel');
                if (panel) {
                    panel.style.transition = 'opacity 0.5s ease';
                    panel.style.opacity = '0';
                    // We don't remove it yet, enterLevel will eventually call _hideLevelSelectUI
                }

                this.enterLevel(this.selectedLevelId);
            }
        });
    }

    /**
     * Update header with current progress
     * @private
     */
    _updateHeaderProgress() {
        const stars = document.getElementById('odyssey-header-stars');
        const progress = document.getElementById('odyssey-header-progress');
        if (stars) {
            const totalStars = this.odysseyState.getTotalStars();
            stars.textContent = `⭐ ${totalStars}/168`;
        }
        if (progress) {
            const pct = this.odysseyState.getOverallProgress();
            progress.textContent = `Progress: ${pct}%`;
        }
    }

    /**
     * Handle back button
     * @private
     */
    _handleBackButton() {
        // Return to main menu
        this.deps.gameManager?.returnToMenu?.();
        window.dispatchEvent(new CustomEvent('return-to-menu'));
    }

    /**
     * Update level preview panel
     * @private
     */
    _updateLevelPreview(levelId) {
        // Ensure overlay exists
        this._createBoardInfoOverlay();

        const panel = document.getElementById('odyssey-level-panel');
        if (!panel) return;

        if (!levelId) {
            panel.classList.add('hidden');
            return;
        }

        const level = this.levelRegistry.getLevel(levelId);
        if (!level) {
            panel.classList.add('hidden');
            return;
        }

        // Store selected level
        this.selectedLevelId = levelId;

        // Check if level is unlocked
        const isUnlocked = this.odysseyState.isLevelUnlocked(levelId);
        const completion = this.odysseyState.getLevelCompletion(levelId);
        const stars = completion?.stars || 0;

        // Update panel content
        document.getElementById('level-panel-name').textContent = level.name;
        document.getElementById('level-panel-chapter').textContent =
            `Chapter ${level.chapter}: ${this._getChapterName(level.chapter)}`;
        document.getElementById('level-panel-description').textContent =
            level.metadata?.description || 'Complete the objectives to progress.';

        // Stars display
        const starsEl = document.getElementById('level-panel-stars');
        starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
        starsEl.style.color = stars > 0 ? '#ffdd00' : '#555';

        // Objectives
        const objectivesEl = document.getElementById('level-panel-objectives');
        const primary = level.victory?.primary;
        objectivesEl.innerHTML = `
            <div><strong>Goal:</strong> ${this._formatObjective(primary)}</div>
            ${level.metadata?.tip ? `<div style="color: #88ff88; margin-top: 0.5rem;">💡 ${level.metadata.tip}</div>` : ''}
        `;

        // Play button
        const playBtn = document.getElementById('level-panel-play-btn');
        playBtn.disabled = !isUnlocked;
        playBtn.textContent = isUnlocked ? '▶ Play' : '🔒 Locked';

        // Show panel
        panel.classList.remove('hidden');
    }

    /**
     * Format objective for display
     * @private
     */
    _formatObjective(primary) {
        if (!primary) return 'Complete the level';
        switch (primary.type) {
            case 'lines': return `Clear ${primary.target} lines`;
            case 'score': return `Score ${primary.target.toLocaleString()} points`;
            case 'cascade': return `Trigger ${primary.target} cascades`;
            case 'time': return `Clear in ${primary.target} seconds`;
            case 'combo': return `Achieve ${primary.target}x combo`;
            default: return `Complete: ${primary.type} (${primary.target})`;
        }
    }

    /**
     * Get chapter name
     * @private
     */
    _getChapterName(chapterId) {
        const names = [
            'Earth Core & Subterranean Origins',
            'Deep Ocean & Liquid Worlds',
            'Surface World & Living Landscapes',
            'Mountains & Thin-Air Ascension',
            'Sky & Atmospheric Drift',
            'Space & Cosmic Expanse',
            'Black Hole & Abstract Transcendence',
        ];
        return names[chapterId - 1] || 'Unknown';
    }

    /**
     * Dispose the info overlay
     * @private
     */
    _disposeInfoOverlay() {
        const overlay = document.getElementById('odyssey-board-overlay');
        if (overlay) overlay.remove();
        const styles = document.getElementById('odyssey-board-overlay-styles');
        if (styles) styles.remove();
    }

    /**
     * Show gameplay view with smooth reveal animation
     * @private
     */
    async _showGameplayView() {
        console.log('[Odyssey] Showing gameplay view with reveal animation');
        this._hideLevelSelectUI();

        // Note: We do NOT dispose the Odyssey Board here anymore.
        // It is disposed at the end of enterLevel() to prevent frame drops during the reveal.


        // Get elements for animation
        // Fix: Use correct ID for the game container
        const gameContainer = document.getElementById('single-player-container');
        const statsBar = document.querySelector('.single-player-stats-bar');
        const bgContainer = document.querySelector('.background-container');

        // Prepare for reveal (elements were hidden during background loading)
        if (gameContainer) {
            gameContainer.style.visibility = 'visible';
            gameContainer.style.opacity = '0';
            gameContainer.style.transform = 'scale(1.05)';
            gameContainer.style.transition = 'opacity 1.2s ease-out, transform 1.2s ease-out';
        }

        // Also reveal Phaser container
        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.visibility = 'visible';
            phaserContainer.style.opacity = '0';
            phaserContainer.style.transition = 'opacity 1.2s ease-out';
        }

        if (statsBar) {
            statsBar.style.visibility = 'visible';
            statsBar.style.opacity = '0';
            statsBar.style.setProperty('display', 'flex', 'important');
            statsBar.style.transition = 'opacity 1s ease-out 0.3s';
        }

        if (bgContainer) {
            bgContainer.style.transition = 'opacity 1.2s ease-out';
        }

        // Trigger the reveal after a tiny delay to ensure styles are applied
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Animate in - reveal everything together
        if (bgContainer) {
            bgContainer.style.opacity = '1';
        }

        if (phaserContainer) {
            phaserContainer.style.opacity = '1';
        }

        if (gameContainer) {
            gameContainer.style.opacity = '1';
            gameContainer.style.transform = 'scale(1)';
        }

        if (statsBar) {
            statsBar.style.opacity = '1';
        }

        // Wait for animation to complete
        await new Promise((resolve) => setTimeout(resolve, 1200));

        // Clean up transition styles
        if (gameContainer) {
            gameContainer.style.transition = '';
            gameContainer.style.transform = '';
        }
        if (phaserContainer) {
            phaserContainer.style.transition = '';
        }
        if (statsBar) {
            statsBar.style.transition = '';
        }
        if (bgContainer) {
            bgContainer.style.transition = '';
        }
    }

    /**
     * Show level selection UI
     * @private
     */
    _showLevelSelectUI() {
        // Create level select UI if it doesn't exist
        let levelSelectUI = document.getElementById('odyssey-level-select');
        if (!levelSelectUI) {
            levelSelectUI = this._createLevelSelectUI();
        }
        levelSelectUI.style.display = 'flex';

        // Update with current progress
        this._updateLevelSelectUI();
    }

    /**
     * Hide level selection UI
     * @private
     */
    _hideLevelSelectUI() {
        const levelSelectUI = document.getElementById('odyssey-level-select');
        if (levelSelectUI) {
            levelSelectUI.style.display = 'none';
        }
    }

    /**
     * Create the level selection UI
     * @private
     */
    _createLevelSelectUI() {
        const container = document.createElement('div');
        container.id = 'odyssey-level-select';
        container.className = 'odyssey-level-select';
        container.innerHTML = `
            <div class="odyssey-header">
                <h1>Odyssey Mode</h1>
                <div class="odyssey-progress">
                    <span class="odyssey-stars">Stars: <span id="odyssey-total-stars">0</span>/<span id="odyssey-max-stars">168</span></span>
                    <span class="odyssey-completion">Progress: <span id="odyssey-progress-pct">0</span>%</span>
                </div>
            </div>
            <div class="odyssey-chapters" id="odyssey-chapters"></div>
            <div class="odyssey-actions">
                <button id="odyssey-back-btn" class="odyssey-btn">Back to Menu</button>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .odyssey-level-select {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 100%);
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 2rem;
                z-index: 1000;
                overflow-y: auto;
                box-sizing: border-box;
            }

            .odyssey-header {
                text-align: center;
                margin-bottom: 2rem;
            }

            .odyssey-header h1 {
                font-family: 'Orbitron', monospace;
                font-size: 2.5rem;
                color: #00ffff;
                text-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
                margin-bottom: 0.5rem;
            }

            .odyssey-progress {
                display: flex;
                gap: 2rem;
                justify-content: center;
                font-family: 'Orbitron', monospace;
                color: #888;
            }

            .odyssey-stars {
                color: #ffd700;
            }

            .odyssey-chapters {
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                max-width: 800px;
                width: 100%;
            }

            .odyssey-chapter {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 1rem;
            }

            .odyssey-chapter-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0.75rem;
            }

            .odyssey-chapter-name {
                font-family: 'Orbitron', monospace;
                font-size: 1.1rem;
                color: #fff;
            }

            .odyssey-chapter-stars {
                color: #ffd700;
                font-size: 0.9rem;
            }

            .odyssey-levels {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
            }

            .odyssey-level-btn {
                width: 50px;
                height: 50px;
                border-radius: 8px;
                border: 2px solid rgba(255, 255, 255, 0.2);
                background: rgba(0, 0, 0, 0.3);
                color: #fff;
                font-family: 'Orbitron', monospace;
                font-size: 1rem;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }

            .odyssey-level-btn:hover:not(.locked) {
                background: rgba(0, 255, 255, 0.2);
                border-color: #00ffff;
                transform: scale(1.05);
            }

            .odyssey-level-btn.locked {
                opacity: 0.3;
                cursor: not-allowed;
            }

            .odyssey-level-btn.completed {
                border-color: #00ff00;
                background: rgba(0, 255, 0, 0.1);
            }

            .odyssey-level-btn.current {
                border-color: #00ffff;
                background: rgba(0, 255, 255, 0.2);
                animation: pulse 2s infinite;
            }

            .odyssey-level-stars {
                font-size: 0.6rem;
                margin-top: 2px;
            }

            .odyssey-actions {
                margin-top: 2rem;
            }

            .odyssey-btn {
                padding: 0.75rem 2rem;
                font-family: 'Orbitron', monospace;
                font-size: 1rem;
                border: 2px solid #00ffff;
                background: transparent;
                color: #00ffff;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .odyssey-btn:hover {
                background: rgba(0, 255, 255, 0.2);
            }

            @keyframes pulse {
                0%, 100% { box-shadow: 0 0 5px rgba(0, 255, 255, 0.5); }
                50% { box-shadow: 0 0 20px rgba(0, 255, 255, 0.8); }
            }
        `;
        document.head.appendChild(style);

        // Add to DOM
        document.body.appendChild(container);

        // Add event listeners
        document.getElementById('odyssey-back-btn').addEventListener('click', () => {
            this._exitToMenu();
        });

        return container;
    }

    /**
     * Update the level select UI with current progress
     * @private
     */
    _updateLevelSelectUI(focusChapter = null) {
        const progress = this.odysseyState.getProgressSummary();

        // Update header stats
        document.getElementById('odyssey-total-stars').textContent = progress.totalStars;
        document.getElementById('odyssey-max-stars').textContent = progress.maxStars;
        document.getElementById('odyssey-progress-pct').textContent = progress.overallProgress;

        // Build chapters
        const chaptersContainer = document.getElementById('odyssey-chapters');
        chaptersContainer.innerHTML = '';

        const chapters = this.levelRegistry.getAllChapters();

        for (const chapter of chapters) {
            const chapterProgress = this.odysseyState.getChapterProgress(chapter.id);
            const levels = this.levelRegistry.getLevelsInChapter(chapter.id);

            const chapterEl = document.createElement('div');
            chapterEl.className = 'odyssey-chapter';
            chapterEl.innerHTML = `
                <div class="odyssey-chapter-header">
                    <span class="odyssey-chapter-name">Chapter ${chapter.id}: ${chapter.name}</span>
                    <span class="odyssey-chapter-stars">${chapterProgress.stars}/${chapterProgress.maxStars} ★</span>
                </div>
                <div class="odyssey-levels" id="odyssey-chapter-${chapter.id}-levels"></div>
            `;

            chaptersContainer.appendChild(chapterEl);

            // Add level buttons
            const levelsContainer = document.getElementById(`odyssey-chapter-${chapter.id}-levels`);

            for (const level of levels) {
                const isUnlocked = this.odysseyState.isLevelUnlocked(level.id);
                const isCompleted = this.odysseyState.isLevelCompleted(level.id);
                const stars = this.odysseyState.getLevelStars(level.id);
                const isCurrent = level.id === progress.currentLevel;

                const btn = document.createElement('button');
                btn.className = 'odyssey-level-btn';
                if (!isUnlocked) btn.classList.add('locked');
                if (isCompleted) btn.classList.add('completed');
                if (isCurrent && isUnlocked && !isCompleted) btn.classList.add('current');

                btn.innerHTML = `
                    <span>${level.id}</span>
                    <span class="odyssey-level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
                `;

                btn.title = `${level.name}\n${level.metadata.description}`;

                if (isUnlocked) {
                    btn.addEventListener('click', () => this.enterLevel(level.id));
                }

                levelsContainer.appendChild(btn);
            }
        }
    }

    /**
     * Show level intro screen
     * @private
     */
    async _showLevelIntro(levelConfig) {
        // Simple intro for Phase 1 - just log it
        console.log(`[Odyssey] === Level ${levelConfig.id}: ${levelConfig.name} ===`);
        console.log(`[Odyssey] ${levelConfig.metadata.description}`);
        console.log(`[Odyssey] Goal: ${levelConfig.victory.primary.type} >= ${levelConfig.victory.primary.target}`);
        console.log(`[Odyssey] Tip: ${levelConfig.metadata.tip}`);

        // Small delay for transition
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    /**
     * Show level results
     * @private
     */
    async _showLevelResults(results) {
        console.log('[Odyssey] === Level Complete! ===');
        console.log(`[Odyssey] Stars: ${'★'.repeat(results.stars)}${'☆'.repeat(3 - results.stars)}`);
        console.log(`[Odyssey] Score: ${results.score}`);
        console.log(`[Odyssey] Time: ${Math.floor(results.time)}s`);
        console.log(`[Odyssey] Lines: ${results.lines}`);

        // Hide Odyssey HUD
        this._cleanupOdysseyHUD();

        // Hide minimap
        this._cleanupMinimap();

        // Phase 6: Show proper results modal
        return new Promise((resolve) => {
            const modal = this._createResultsModal(results, resolve);
            document.body.appendChild(modal);
        });
    }

    /**
     * Create a styled results modal
     * @private
     */
    _createResultsModal(results, onClose) {
        const modal = document.createElement('div');
        modal.id = 'odyssey-results-modal';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            animation: fadeIn 0.3s ease-out;
        `;

        // Add keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            @keyframes starPop { 0% { transform: scale(0); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
        `;
        modal.appendChild(style);

        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(165deg, rgba(20, 15, 40, 0.95) 0%, rgba(12, 10, 30, 0.98) 100%);
            border: 1px solid rgba(180, 130, 255, 0.4);
            border-radius: 24px;
            padding: 40px 50px;
            text-align: center;
            max-width: 400px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 80px rgba(140, 80, 255, 0.2);
            animation: slideUp 0.4s ease-out;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
        `;

        // Title
        const title = document.createElement('h2');
        title.textContent = 'Level Complete!';
        title.style.cssText = `
            margin: 0 0 20px 0;
            font-size: 28px;
            font-weight: 700;
            color: #fff;
            text-shadow: 0 0 30px rgba(100, 255, 150, 0.5);
        `;
        content.appendChild(title);

        // Level name
        if (this.currentLevelConfig) {
            const levelName = document.createElement('div');
            levelName.textContent = this.currentLevelConfig.name;
            levelName.style.cssText = `
                font-size: 16px;
                color: rgba(180, 150, 255, 0.8);
                margin-bottom: 25px;
            `;
            content.appendChild(levelName);
        }

        // Stars
        const starsContainer = document.createElement('div');
        starsContainer.style.cssText = `
            display: flex;
            justify-content: center;
            gap: 12px;
            margin-bottom: 30px;
        `;

        for (let i = 0; i < 3; i++) {
            const star = document.createElement('div');
            const isFilled = i < results.stars;
            star.innerHTML = `
                <svg width="48" height="48" viewBox="0 0 24 24" fill="${isFilled ? 'rgba(255, 200, 100, 1)' : 'rgba(255, 200, 100, 0.1)'}" stroke="${isFilled ? 'rgba(255, 220, 150, 1)' : 'rgba(255, 200, 100, 0.3)'}" stroke-width="2">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                </svg>
            `;
            star.style.cssText = `
                animation: starPop 0.3s ease-out ${0.2 + i * 0.15}s backwards;
                filter: ${isFilled ? 'drop-shadow(0 0 12px rgba(255, 200, 100, 0.8))' : 'none'};
            `;
            starsContainer.appendChild(star);
        }
        content.appendChild(starsContainer);

        // Stats
        const stats = [
            { label: 'Score', value: results.score.toLocaleString() },
            { label: 'Lines', value: results.lines },
            { label: 'Time', value: this._formatTime(results.time * 1000) },
        ];

        const statsContainer = document.createElement('div');
        statsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        `;

        stats.forEach(stat => {
            const statDiv = document.createElement('div');
            statDiv.innerHTML = `
                <div style="font-size: 11px; color: rgba(180, 200, 220, 0.6); letter-spacing: 1px; margin-bottom: 5px;">${stat.label.toUpperCase()}</div>
                <div style="font-size: 20px; font-weight: 700; color: #fff;">${stat.value}</div>
            `;
            statsContainer.appendChild(statDiv);
        });
        content.appendChild(statsContainer);

        // Continue button
        const button = document.createElement('button');
        button.textContent = 'Continue';
        button.style.cssText = `
            padding: 14px 40px;
            font-size: 16px;
            font-weight: 600;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            color: #fff;
            background: linear-gradient(135deg, rgba(100, 180, 255, 0.3) 0%, rgba(180, 130, 255, 0.3) 100%);
            border: 1px solid rgba(180, 130, 255, 0.6);
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        button.onmouseenter = () => {
            button.style.background = 'linear-gradient(135deg, rgba(100, 180, 255, 0.5) 0%, rgba(180, 130, 255, 0.5) 100%)';
            button.style.transform = 'scale(1.05)';
        };
        button.onmouseleave = () => {
            button.style.background = 'linear-gradient(135deg, rgba(100, 180, 255, 0.3) 0%, rgba(180, 130, 255, 0.3) 100%)';
            button.style.transform = 'scale(1)';
        };
        button.onclick = () => {
            modal.remove();
            onClose();
        };
        content.appendChild(button);

        modal.appendChild(content);
        return modal;
    }

    /**
     * Format time in mm:ss format
     * @private
     */
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    /**
     * Show level failure
     * @private
     */
    async _showLevelFailure(reason) {
        console.log(`[Odyssey] === Level Failed: ${reason} ===`);

        // Hide Odyssey HUD
        this._cleanupOdysseyHUD();

        // Phase 6: Show proper failure modal
        const reasonText = reason === 'time' ? 'Time ran out!' : 'You topped out!';

        return new Promise((resolve) => {
            const modal = this._createFailureModal(reasonText, resolve);
            document.body.appendChild(modal);
        });
    }

    /**
     * Create a styled failure modal
     * @private
     */
    _createFailureModal(reasonText, onClose) {
        const modal = document.createElement('div');
        modal.id = 'odyssey-failure-modal';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            animation: fadeIn 0.3s ease-out;
        `;

        // Add keyframes
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        `;
        modal.appendChild(style);

        const content = document.createElement('div');
        content.style.cssText = `
            background: linear-gradient(165deg, rgba(40, 15, 20, 0.95) 0%, rgba(30, 10, 15, 0.98) 100%);
            border: 1px solid rgba(255, 100, 100, 0.4);
            border-radius: 24px;
            padding: 40px 50px;
            text-align: center;
            max-width: 400px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 80px rgba(255, 80, 80, 0.2);
            animation: slideUp 0.4s ease-out;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
        `;

        // Title
        const title = document.createElement('h2');
        title.textContent = 'Level Failed';
        title.style.cssText = `
            margin: 0 0 15px 0;
            font-size: 28px;
            font-weight: 700;
            color: rgba(255, 100, 100, 1);
            text-shadow: 0 0 30px rgba(255, 80, 80, 0.5);
        `;
        content.appendChild(title);

        // Reason
        const reason = document.createElement('div');
        reason.textContent = reasonText;
        reason.style.cssText = `
            font-size: 16px;
            color: rgba(255, 200, 200, 0.8);
            margin-bottom: 30px;
        `;
        content.appendChild(reason);

        // Try again button
        const button = document.createElement('button');
        button.textContent = 'Try Again';
        button.style.cssText = `
            padding: 14px 40px;
            font-size: 16px;
            font-weight: 600;
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            color: #fff;
            background: linear-gradient(135deg, rgba(255, 100, 100, 0.3) 0%, rgba(255, 150, 100, 0.3) 100%);
            border: 1px solid rgba(255, 100, 100, 0.6);
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        button.onmouseenter = () => {
            button.style.background = 'linear-gradient(135deg, rgba(255, 100, 100, 0.5) 0%, rgba(255, 150, 100, 0.5) 100%)';
            button.style.transform = 'scale(1.05)';
        };
        button.onmouseleave = () => {
            button.style.background = 'linear-gradient(135deg, rgba(255, 100, 100, 0.3) 0%, rgba(255, 150, 100, 0.3) 100%)';
            button.style.transform = 'scale(1)';
        };
        button.onclick = () => {
            modal.remove();
            onClose();
        };
        content.appendChild(button);

        modal.appendChild(content);
        return modal;
    }

    /**
     * Exit to main menu
     * @private
     */
    async _exitToMenu() {
        await this.onDeactivate();
        window.dispatchEvent(new CustomEvent('returnToMenu'));
    }

    // =============================
    // Private: Helpers
    // =============================

    /**
     * Reset level metrics
     * @private
     */
    _resetLevelMetrics() {
        // Phase 2: Reset via hybridEngine
        this.hybridEngine?.victoryEvaluator?.reset();
    }

    /**
     * Start the level timer
     * @private
     */
    _startLevelTimer() {
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
        }

        this.levelTimerInterval = setInterval(() => {
            if (this.levelStartTime && !this.gameState?.isPaused) {
                const elapsedTime = (Date.now() - this.levelStartTime) / 1000;
                // Phase 2: Update time via hybridEngine
                this.hybridEngine?.updateTime(elapsedTime);
            }
        }, 100);
    }

    /**
     * Hook input functions
     * @private
     */
    _hookInputs() {
        this.originalInputs = {
            move: window.move,
            rotate: window.rotate,
            hardDrop: window.hardDrop,
            softDrop: window.softDrop,
        };

        window.move = (dir) => {
            if (!this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;
            coreMove(this.gameState, dir, () => this.deps.soundManager?.sfxPlayer?.playMove());
        };

        window.rotate = (dir) => {
            if (!this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;
            coreRotate(this.gameState, dir, () => this.deps.soundManager?.sfxPlayer?.playRotate());
        };

        window.hardDrop = () => {
            if (!this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;
            coreHardDrop(
                this.gameState,
                () => this.deps.soundManager?.sfxPlayer?.playDrop(),
                this._getPhysicsCallbacks(),
            );
        };

        window.softDrop = () => {
            if (!this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;
            coreSoftDrop(
                this.gameState,
                () => this.deps.soundManager?.sfxPlayer?.playDrop(),
                this._getPhysicsCallbacks(),
            );
        };
    }

    /**
     * Restore original inputs
     * @private
     */
    _restoreInputs() {
        Object.keys(this.originalInputs).forEach((fnName) => {
            if (this.originalInputs[fnName]) {
                window[fnName] = this.originalInputs[fnName];
            }
        });
        this.originalInputs = {};
    }

    /**
     * Refresh next piece queue display
     * @private
     */
    _refreshNextQueue() {
        if (this.gameState) {
            updateNextQueue(this.gameState.nextPieces);
        }
    }

    /**
     * Update stats display
     * @private
     */
    _updateStats() {
        if (this.gameState) {
            updateStats(this.gameState);
        }
    }

    // =============================
    // Phase 6: Odyssey HUD Methods
    // =============================

    /**
     * Initialize and show the Odyssey HUD
     * @private
     */
    _initializeOdysseyHUD() {
        // Clean up existing HUD if any
        if (this.odysseyHUD) {
            this.odysseyHUD.destroy();
            this.odysseyHUD = null;
        }

        // Create new HUD instance
        this.odysseyHUD = new OdysseyHUD({
            levelId: this.currentLevelId,
        });

        // Set level configuration
        this.odysseyHUD.setLevel(this.currentLevelId);

        // Show the HUD
        this.odysseyHUD.show();

        console.log('[Odyssey] HUD initialized for level', this.currentLevelId);
    }

    /**
     * Update the Odyssey HUD with current metrics
     * @private
     */
    _updateOdysseyHUD() {
        if (!this.odysseyHUD) return;

        // Get current metrics from hybrid engine
        const metrics = this.levelMetrics;

        // Update HUD metrics
        this.odysseyHUD.updateMetrics({
            lines: metrics.lines,
            score: this.gameState?.score || 0,
            cascades: metrics.cascades,
            maxCascadeDepth: metrics.maxCascadeDepth,
            tetrises: metrics.tetrises,
            singles: metrics.singles,
            combo: metrics.maxCombo,
        });

        // Update time
        if (this.levelStartTime) {
            const elapsedMs = Date.now() - this.levelStartTime;
            this.odysseyHUD.updateTime(elapsedMs);
        }
    }

    /**
     * Clean up the Odyssey HUD
     * @private
     */
    _cleanupOdysseyHUD() {
        if (this.odysseyHUD) {
            this.odysseyHUD.destroy();
            this.odysseyHUD = null;
            console.log('[Odyssey] HUD cleaned up');
        }
    }

    /**
     * Initialize minimap for tall boards (30+ rows)
     * @private
     */
    _initializeMinimap() {
        const boardRows = this.currentLevelConfig?.mechanics?.board?.rows || 20;

        // Only show minimap for tall boards
        if (boardRows < this.MINIMAP_ROW_THRESHOLD) {
            console.log(`[Odyssey] Minimap skipped (${boardRows} rows < ${this.MINIMAP_ROW_THRESHOLD} threshold)`);
            return;
        }

        // Clean up existing minimap
        this._cleanupMinimap();

        // Create minimap with board dimensions
        this.minimap = new InfinityMinimap({
            totalRows: boardRows,
            columns: this.currentLevelConfig?.mechanics?.board?.columns || 10,
        });
        this.minimap.show();

        // FIX: Position minimap absolutely to the right of the stats bar
        // Stats bar is at ~60px offset, we place minimap at ~230px offset
        if (this.minimap.container) {
            this.minimap.container.style.position = 'absolute';
            this.minimap.container.style.left = '50%';
            this.minimap.container.style.top = '50%';
            this.minimap.container.style.transform = 'translate(calc(var(--board-width) / 2 + 230px), -50%)';
            this.minimap.container.style.margin = '0';
            this.minimap.container.style.zIndex = '5'; // Below stats bar if they inadvertently overlap
        }

        // Setup minimap click-to-jump handler
        this.minimap.container.addEventListener('minimap-jump', (event) => {
            const { row } = event.detail;
            if (this.boardScene?.cameraSettings) {
                this.boardScene.updateCameraPosition(row);
            }
        });

        console.log(`[Odyssey] Minimap initialized for ${boardRows}-row board`);
    }

    /**
     * Update minimap with current game state
     * @private
     */
    _updateMinimap() {
        if (!this.minimap || !this.gameState) return;

        // Get camera info from Phaser scene
        const boardScene = this._getBoardScene();
        if (!boardScene?.cameraSettings) return;

        const cameraTopRow = boardScene.cameraSettings.currentTopRow || 0;
        const visibleRows = boardScene.cameraSettings.visibleRows || 20;

        this.minimap.update(this.gameState, cameraTopRow, visibleRows);
    }

    /**
     * Clean up minimap
     * @private
     */
    _cleanupMinimap() {
        if (this.minimap) {
            this.minimap.hide();
            this.minimap.destroy();
            this.minimap = null;
            console.log('[Odyssey] Minimap cleaned up');
        }
    }

    /**
     * Apply or remove infinity mode layout styling for tall boards
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
            console.log('[Odyssey] Infinity layout applied');
        } else {
            stage.classList.remove('infinity-mode-active');
            container.classList.remove('infinity-mode-active');
            console.log('[Odyssey] Infinity layout removed');
        }
    }

    /**
     * Update camera position for tall boards - follows piece through viewport
     * Ported from InfinityMode for proper tall board camera tracking
     * @private
     */
    _updateCameraPosition() {
        if (!this.boardScene?.cameraSettings) return;
        if (this.boardScene.cameraSettings.manualControl) return;

        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const blockSize = this.boardScene.boardConfig?.blockSize || 30;

        // Get current camera position
        const camera = this.boardScene.cameras?.main;
        if (!camera) return;

        const currentCameraRow = Math.floor(camera.scrollY / blockSize);

        // CRITICAL: Update gameState.cameraRow for spawn position
        this.gameState.cameraRow = currentCameraRow;

        // Follow the current piece
        const { currentPiece } = this.gameState;
        if (currentPiece) {
            const pieceBottomRow = currentPiece.y + (currentPiece.shape?.length || 0);

            // When piece goes below 60% of viewport, follow it
            const followThreshold = currentCameraRow + Math.floor(visibleRows * 0.6);

            if (pieceBottomRow > followThreshold) {
                // Calculate target camera position
                const maxCameraRow = Math.max(0, this.gameState.board.length - visibleRows);
                const targetCameraRow = Math.min(maxCameraRow, pieceBottomRow - Math.floor(visibleRows * 0.3));

                this.boardScene.updateCameraPosition(targetCameraRow);
                // Update gameState.cameraRow for spawn position
                this.gameState.cameraRow = targetCameraRow;
            }
        }

        // Also check if we should follow upward (piece near top of viewport)
        const highestBlockRow = this._findHighestBlockRow();
        if (highestBlockRow < currentCameraRow + Math.floor(visibleRows * 0.4)) {
            // Blocks are building up high, follow upward
            const targetRow = Math.max(0, highestBlockRow - Math.floor(visibleRows * 0.3));
            if (targetRow < currentCameraRow) {
                this.boardScene.updateCameraPosition(targetRow);
                // Update gameState.cameraRow for spawn position
                this.gameState.cameraRow = targetRow;
            }
        }
    }

    /**
     * Find the highest row with placed blocks
     * @returns {number} Row number, or board.length if no blocks
     * @private
     */
    _findHighestBlockRow() {
        const board = this.gameState?.board;
        if (!board) return 999;

        for (let row = 0; row < board.length; row++) {
            for (let col = 0; col < board[row].length; col++) {
                if (board[row][col] !== null) {
                    return row;
                }
            }
        }
        return board.length;
    }

    /**
     * Setup camera controls for manual navigation during pause
     * @private
     */
    _setupCameraControls() {
        document.addEventListener('keydown', this.handleKeyPress, true);

        const canvas = document.querySelector('#phaser-game-container canvas');
        if (canvas) {
            canvas.addEventListener('wheel', this.handleWheel, { passive: false });
        }

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
     * Handle keyboard input for camera control during pause
     * @private
     */
    _onKeyPress(event) {
        if (!this.boardScene) return;
        if (!this.gameState?.isPaused) return;

        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }

        let deltaRows = 0;

        switch (event.key) {
            case 'ArrowUp':
                deltaRows = -3;
                event.preventDefault();
                event.stopPropagation();
                break;
            case 'ArrowDown':
                deltaRows = 3;
                event.preventDefault();
                event.stopPropagation();
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                event.preventDefault();
                event.stopPropagation();
                return;
            case 'PageUp':
                deltaRows = -10;
                event.preventDefault();
                event.stopPropagation();
                break;
            case 'PageDown':
                deltaRows = 10;
                event.preventDefault();
                event.stopPropagation();
                break;
            case 'p':
            case 'P':
            case 'Escape':
                return; // Let pause/settings propagate
            default:
                return;
        }

        if (deltaRows !== 0 && this.boardScene.cameraSettings) {
            const currentRow = this.boardScene.cameraSettings.currentTopRow || 0;
            const maxRow = Math.max(0, this.gameState.board.length - this.visibleRows);
            const newRow = Math.max(0, Math.min(maxRow, currentRow + deltaRows));
            this.boardScene.updateCameraPosition(newRow);
            this._updateMinimap();
        }
    }

    /**
     * Handle mouse wheel for camera scrolling during pause
     * @private
     */
    _onWheel(event) {
        if (!this.boardScene) return;
        if (!this.gameState?.isPaused) return;

        event.preventDefault();

        const deltaRows = event.deltaY > 0 ? 5 : -5;

        if (this.boardScene.cameraSettings) {
            const currentRow = this.boardScene.cameraSettings.currentTopRow || 0;
            const maxRow = Math.max(0, this.gameState.board.length - this.visibleRows);
            const newRow = Math.max(0, Math.min(maxRow, currentRow + deltaRows));
            this.boardScene.updateCameraPosition(newRow);
            this._updateMinimap();
        }
    }

    // =============================
    // Private: Phaser Integration
    // =============================

    _getBoardScene() {
        return this.deps.phaserGame?.scene?.getScene('BoardScene') || null;
    }

    _startPhaserBoardScene() {
        const { phaserGame } = this.deps;
        if (!phaserGame?.scene) return;

        const boardScene = phaserGame.scene.getScene('BoardScene');
        if (boardScene) {
            if (boardScene.scene.isActive()) {
                boardScene.scene.restart();
            } else {
                boardScene.scene.start();
            }
        } else {
            phaserGame.scene.start('BoardScene');
        }
    }

    _stopPhaserBoardScene() {
        const boardScene = this._getBoardScene();
        if (boardScene) {
            boardScene.scene.stop();
        }
    }

    _clearPhaserBoard() {
        const boardScene = this._getBoardScene();
        if (boardScene?.clearBoard) {
            boardScene.clearBoard();
        }
    }
}

export default OdysseyMode;
