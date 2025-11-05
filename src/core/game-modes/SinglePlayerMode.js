import { BaseGameMode } from './BaseGameMode.js';
import { GameState } from '../game.js';
import { GAME_MODES, COLS, ROWS, BLOCK_SIZE } from '../constants.js';
import { spawnPiece, fillBag, gameLoop } from '../game.js';
import { draw, updateStats } from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';

/**
 * SinglePlayerMode - Classic single-player Tetris experience
 *
 * Manages:
 * - Single GameState instance
 * - Single Phaser board scene
 * - Classic game loop
 * - Score tracking and high scores
 */
export class SinglePlayerMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Single player specific state
        this.gameState = null;
        this.animationFrameId = null;
        this.cleanupHandlers = [];

        // Canvas references (set during activation)
        this.canvas = null;
        this.ctx = null;
        this.nextCanvases = [];

        // Performance optimization: Throttle stats updates
        this.lastStatsUpdateTime = 0;
        this.statsUpdateInterval = 250; // Update stats every 250ms instead of every frame (16ms)
    }

    getModeId() {
        return GAME_MODES.SINGLE_PLAYER;
    }

    getDisplayName() {
        return 'Single Player';
    }

    /**
     * Called when single player mode is selected
     */
    async onActivate() {
        await super.onActivate();

        console.log('[SinglePlayer] Activating single player mode...');

        // Get next piece canvas references (for preview display)
        this.nextCanvases = Array.from({ length: 5 }, (_, i) => document.getElementById(`next-${i}`));

        // Show single player container (flex for proper layout)
        // Show single player stage and container
        const singlePlayerStage = document.querySelector('.single-player-stage');
        if (singlePlayerStage) {
            singlePlayerStage.style.display = '';
        }

        const singlePlayerContainer = document.getElementById('single-player-container');
        if (singlePlayerContainer) {
            singlePlayerContainer.style.display = 'flex';
        }

        // Hide multiplayer container
        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'none';
        }

        // Show single player stats bar
        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.display = 'flex';
        }

        // Hide any existing multiplayer Phaser scenes
        this._hideMultiplayerScenes();

        // Show single player Phaser scene
        this._showSinglePlayerScene();

        // Ensure Phaser canvas is in correct container
        this._movePhaserToSinglePlayerContainer();

        // Set single-player dimensions
        const boardWidth = COLS * BLOCK_SIZE;
        const boardHeight = ROWS * BLOCK_SIZE;
        this._resizePhaserGame(boardWidth, boardHeight);

        console.log('[SinglePlayer] Mode activated, ready to start');
    }

    /**
     * Called when user clicks "Start Game"
     */
    async onStart() {
        await super.onStart();

        console.log('[SinglePlayer] Starting game...');

        // Initialize game state (lazy initialization)
        this.gameState = new GameState();

        // Start Phaser board scene (triggers create() for fresh state)
        this._startPhaserBoardScene();

        // Clear board graphics to ensure clean slate
        this._clearPhaserBoard();

        // Apply effect quality from settings
        const settings = this.deps.settingsManager.get();
        this._applyEffectQuality(settings.effectQuality || 'high');

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

        // Start game loop
        this._startGameLoop();

        console.log('[SinglePlayer] Game started!');
    }

    /**
     * Called when game is paused
     */
    onPause() {
        super.onPause();

        if (this.gameState) {
            this.gameState.isPaused = true;
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
    }

    /**
     * Called when game ends
     */
    async onStop() {
        await super.onStop();

        console.log('[SinglePlayer] Stopping game...');

        // Stop game loop
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Mark game as over
        if (this.gameState) {
            this.gameState.isGameOver = true;
        }

        // Stop Phaser scene (triggers shutdown() for cleanup)
        this._stopPhaserBoardScene();
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[SinglePlayer] Deactivating...');

        // Stop Phaser scene (triggers shutdown() for cleanup)
        this._stopPhaserBoardScene();

        // Clean up state
        this.gameState = null;
        this.animationFrameId = null;

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);
    }

    /**
     * Handle window resize
     */
    onResize() {
        const boardWidth = COLS * BLOCK_SIZE;
        const boardHeight = ROWS * BLOCK_SIZE;
        this._resizePhaserGame(boardWidth, boardHeight);
    }

    /**
     * Handle theme change
     */
    onThemeChange(theme) {
        // Level-based theme changes are handled in game loop
        // This is for manual theme changes
        console.log('[SinglePlayer] Theme changed to:', theme);
    }

    /**
     * Get current state
     */
    getState() {
        return {
            ...super.getState(),
            score: this.gameState?.score || 0,
            lines: this.gameState?.lines || 0,
            level: this.gameState?.level || 1,
        };
    }

    // ===== Private Methods =====

    /**
     * Start the game loop
     * @private
     */
    _startGameLoop() {
        const loop = (currentTime) => {
            if (!this.isRunning) {
                return;
            }

            // Sync to Phaser scene
            const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
            if (boardScene) {
                boardScene.syncFromGameState(this.gameState);
            }

            // Run core game loop
            gameLoop(
                currentTime,
                this.gameState,
                () => {
                    // Draw callback - Phaser handles rendering, canvas is fallback
                    if (!boardScene) {
                        draw(this.canvas, this.ctx, this.gameState);
                    }
                },
                () => {
                    // Update stats callback - THROTTLED for performance
                    // Only update stats every 250ms instead of every frame (16ms)
                    // This reduces BPM calculations from 60/sec to 4/sec
                    if (currentTime - this.lastStatsUpdateTime >= this.statsUpdateInterval) {
                        this.lastStatsUpdateTime = currentTime;
                        updateStats(this.gameState);
                    }

                    // Check for level-based theme changes
                    const settings = this.deps.settingsManager.get();
                    if (settings.backgroundMode === 'Level') {
                        const levelTheme = this.deps.themeManager.getThemeForLevel(this.gameState.level);
                        if (levelTheme !== this.deps.themeManager.activeThemeName) {
                            this.deps.themeManager.switchTheme(levelTheme);
                        }
                    }
                },
                () => this.deps.soundManager.sfxPlayer.playDrop(),
                this._getPhysicsCallbacks()
            );

            // Continue loop
            this.animationFrameId = requestAnimationFrame(loop);
        };

        this.animationFrameId = requestAnimationFrame(loop);
    }

    /**
     * Get physics callbacks for sound effects and piece spawning
     * @private
     */
    _getPhysicsCallbacks() {
        return {
            onMove: () => this.deps.soundManager.sfxPlayer.playMove(),
            onRotate: () => this.deps.soundManager.sfxPlayer.playRotate(),
            onLineClear: (lines) => {
                if (lines === 4) {
                    this.deps.soundManager.sfxPlayer.playTetris();
                } else {
                    this.deps.soundManager.sfxPlayer.playLineClear();
                }
            },
            onLevelUp: () => this.deps.soundManager.sfxPlayer.playLevelUp(),
            onHardDrop: () => this.deps.soundManager.sfxPlayer.playHardDrop(),
            // Trigger combo visual effects
            triggerCombo: (comboCount) => {
                const settings = this.deps.settingsManager.get();
                const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
                if (settings.comboPopupEffect && boardScene) {
                    boardScene.showComboPopup(comboCount);
                    console.log(`[SinglePlayer] Combo popup triggered: ${comboCount}x`);
                }
            },
            // Piece lock ripple effect
            onPieceLock: (piece) => {
                const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
                if (boardScene && boardScene.createPieceLockRipple) {
                    boardScene.createPieceLockRipple(piece);
                }
            },
            // CRITICAL: Spawn next piece after physics completes (after piece lock)
            spawnPiece: () => {
                spawnPiece(
                    this.gameState,
                    () => this._refreshNextQueue(),
                    () => this._handleGameOver()
                );
            },
        };
    }

    /**
     * Refresh next piece queue display
     * @private
     */
    _refreshNextQueue() {
        // Update next piece preview canvases
        updateNextQueue(this.gameState.nextPieces);
    }

    /**
     * Update stats display
     * @private
     */
    _updateStats() {
        // Update stats in DOM
        updateStats(this.gameState);
    }

    /**
     * Handle game over
     * @private
     */
    async _handleGameOver() {
        console.log('[SinglePlayer] Game over!');

        await this.onStop();

        // Save high score
        await this.deps.highScoreManager.addScore({
            score: this.gameState.score,
            lines: this.gameState.lines,
            level: this.gameState.level,
        });

        // Show game over modal
        this.deps.modalManager.show('gameOver');

        // Trigger game over event
        window.dispatchEvent(new CustomEvent('gameOver', {
            detail: { gameState: this.gameState }
        }));
    }

    /**
     * Move Phaser canvas to single player container
     * @private
     */
    _movePhaserToSinglePlayerContainer() {
        const phaserCanvas = this.deps.phaserGame?.canvas;
        const container = document.getElementById('phaser-game-container');

        if (phaserCanvas && container && phaserCanvas.parentElement !== container) {
            container.appendChild(phaserCanvas);
        }
    }

    /**
     * Resize Phaser game
     * @private
     */
    _resizePhaserGame(width, height) {
        if (this.deps.phaserGame?.resize) {
            this.deps.phaserGame.resize(width, height);
        }
    }

    /**
     * Start Phaser board scene (triggers create() for fresh state)
     * @private
     */
    _startPhaserBoardScene() {
        const phaserGame = this.deps.phaserGame;
        if (!phaserGame?.scene) return;

        const boardScene = phaserGame.scene.getScene('BoardScene');
        if (boardScene) {
            // Check if scene is already running
            if (boardScene.scene.isActive()) {
                console.log('[SinglePlayer] BoardScene already active, restarting...');
                boardScene.scene.restart();
            } else {
                // Scene exists but is stopped, start it (triggers create())
                console.log('[SinglePlayer] Starting stopped BoardScene...');
                boardScene.scene.start();
            }
        } else {
            // Scene doesn't exist, start it for the first time
            console.log('[SinglePlayer] Starting BoardScene for first time...');
            phaserGame.scene.start('BoardScene');
        }
    }

    /**
     * Stop Phaser board scene (triggers shutdown() for cleanup)
     * @private
     */
    _stopPhaserBoardScene() {
        const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
        if (boardScene) {
            boardScene.scene.stop();
        }
    }

    /**
     * Clear Phaser board graphics
     * @private
     */
    _clearPhaserBoard() {
        const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
        if (boardScene && boardScene.clearBoard) {
            boardScene.clearBoard();
        }
    }

    /**
     * Apply effect quality setting
     * @private
     */
    _applyEffectQuality(quality) {
        const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
        if (boardScene && boardScene.setEffectQuality) {
            boardScene.setEffectQuality(quality);
        }
    }

    /**
     * Hide multiplayer Phaser scenes
     * @private
     */
    _hideMultiplayerScenes() {
        const phaserGame = this.deps.phaserGame;
        if (!phaserGame?.scene) return;

        // Hide, stop, and remove multiplayer board panel scenes if they exist
        ['BoardPanel1', 'BoardPanel2'].forEach((key) => {
            const scene = phaserGame.scene.getScene(key);
            if (scene) {
                console.log(`[SinglePlayer] Removing multiplayer scene: ${key}`);
                
                // Clear the scene's camera viewport to prevent rendering
                if (scene.cameras?.main) {
                    scene.cameras.main.setViewport(0, 0, 0, 0);
                }
                
                // Hide the scene first
                scene.scene.setVisible(false);
                
                // Stop the scene
                scene.scene.stop();
                
                // Remove the scene completely
                phaserGame.scene.remove(key);
            }
        });
    }

    /**
     * Show single player Phaser scene
     * @private
     */
    _showSinglePlayerScene() {
        const phaserGame = this.deps.phaserGame;
        if (!phaserGame?.scene) return;

        const boardScene = phaserGame.scene.getScene('BoardScene');
        if (boardScene) {
            // Reset camera viewport to full canvas
            if (boardScene.cameras?.main) {
                const boardWidth = COLS * BLOCK_SIZE;
                const boardHeight = ROWS * BLOCK_SIZE;
                boardScene.cameras.main.setViewport(0, 0, boardWidth, boardHeight);
            }

            boardScene.scene.setVisible(true);
            // Note: Don't call start() here - scene will be started in onStart()
            // This method is only for initial activation setup
        }
    }
}
