import { BaseGameMode } from './BaseGameMode.js';
import {
    GameState,
    spawnPiece,
    fillBag,
    gameLoop,
} from '../game.js';
import {
    GAME_MODES,
    COLS,
    ROWS,
    BLOCK_SIZE,
} from '../constants.js';
import {
    draw,
    updateStats,
    triggerLineClearFlash as triggerLineClearFlashCanvas,
    triggerBackgroundPulse as triggerBackgroundPulseCanvas,
} from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

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
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Mark game as over
        if (this.gameState) {
            this.gameState.isGameOver = true;
        }

        this._stopPhaserBoardScene();
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[SinglePlayer] Deactivating...');

        this._stopPhaserBoardScene();

        // Clean up state
        this.gameState = null;

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
        if (!this.gameState) {
            console.warn('[SinglePlayer] Cannot start game loop without game state');
            return;
        }

        // Cancel any legacy loop that might still be running to avoid duplicates
        if (this.gameState.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Ensure stats throttling starts fresh for this session
        this.lastStatsUpdateTime = performance.now();

        const drawCallback = () => {
            const boardScene = this._getBoardScene();
            if (boardScene) {
                boardScene.syncFromGameState(this.gameState);
            } else if (this.canvas && this.ctx) {
                draw(this.canvas, this.ctx, this.gameState);
            }
        };

        const statsCallback = () => {
            const now = performance.now();
            if (now - this.lastStatsUpdateTime >= this.statsUpdateInterval) {
                this.lastStatsUpdateTime = now;
                updateStats(this.gameState);
            }

            const settings = this.deps.settingsManager.get();
            if (settings.backgroundMode === 'Level') {
                const levelTheme = this.deps.themeManager.getThemeForLevel(this.gameState.level);
                if (levelTheme !== this.deps.themeManager.activeThemeName) {
                    this.deps.themeManager.switchTheme(levelTheme);
                }
            }
        };

        gameLoop(
            performance.now(),
            this.gameState,
            drawCallback,
            statsCallback,
            () => this.deps.soundManager.sfxPlayer.playDrop(),
            this._getPhysicsCallbacks(),
        );
    }

    /**
     * Get physics callbacks for sound effects and piece spawning
     * @private
     */
    _getPhysicsCallbacks() {
        return {
            onMove: () => this.deps.soundManager.sfxPlayer.playMove(),
            onRotate: () => this.deps.soundManager.sfxPlayer.playRotate(),
            onLineClear: (lineCount) => {
                this.deps.soundManager.sfxPlayer.playLineClear();

                // Emit event for theme reactions
                console.log('[SinglePlayer] Emitting LINE_CLEAR event, count:', lineCount);
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount });
            },
            onLevelUp: () => this.deps.soundManager.sfxPlayer.playLevelUp(),
            onHardDrop: () => this.deps.soundManager.sfxPlayer.playHardDrop(),
            // Trigger combo visual effects
            triggerCombo: (comboCount) => {
                // Emit event for theme reactions
                console.log('[SinglePlayer] Emitting COMBO event, comboCount:', comboCount);
                eventBus.emit(EVENTS.COMBO, { comboCount });

                const settings = this.deps.settingsManager.get();
                const boardScene = this._getBoardScene();
                if (settings.comboPopupEffect && boardScene) {
                    boardScene.showComboPopup(comboCount);
                    console.log(`[SinglePlayer] Combo popup triggered: ${comboCount}x`);
                }
            },
            // Trigger cascade wave visual effect
            triggerCascadeWave: (cascadeCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.sharedEffects) {
                    boardScene.sharedEffects.showCascadeWave(cascadeCount);
                    console.log(`[SinglePlayer] Cascade wave ${cascadeCount} triggered`);
                }
            },
            // Line clear flash effect
            triggerFlash: (fullLines) => {
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.triggerLineClearFlash) {
                    boardScene.triggerLineClearFlash(fullLines);
                } else {
                    triggerLineClearFlashCanvas(fullLines);
                }
            },
            // Camera shake + particle impact
            onLineClearImpact: (lineCount, cascadeCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.playLineClearImpact) {
                    boardScene.playLineClearImpact(lineCount, cascadeCount);
                }
            },
            // Background pulse / ambience
            triggerBackgroundPulse: (lineCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.triggerBackgroundPulse) {
                    boardScene.triggerBackgroundPulse(lineCount);
                } else {
                    triggerBackgroundPulseCanvas(lineCount);
                }
            },
            // Piece lock ripple effect
            onPieceLock: (piece) => {
                // Emit event for theme reactions
                eventBus.emit(EVENTS.PIECE_LOCK, { piece });

                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.createPieceLockRipple) {
                    boardScene.createPieceLockRipple(piece);
                }
            },
            // CRITICAL: Spawn next piece after physics completes (after piece lock)
            spawnPiece: () => {
                spawnPiece(
                    this.gameState,
                    () => this._refreshNextQueue(),
                    () => this._handleGameOver(),
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
            detail: { gameState: this.gameState },
        }));
    }

    /**
     * Move Phaser canvas to single player container
     * @private
     */
    /**
     * Resize Phaser game
     * @private
     */
    _resizePhaserGame(width, height) {
        if (this.boardHost?.game?.resize) {
            this.boardHost.game.resize(width, height);
            return;
        }
        if (this.deps.phaserGame?.resize) {
            this.deps.phaserGame.resize(width, height);
        }
    }

    /**
     * Start Phaser board scene (triggers create() for fresh state)
     * @private
     */
    _startPhaserBoardScene() {
        const { phaserGame } = this.deps;
        if (!phaserGame?.scene) return;

        const boardScene = phaserGame.scene.getScene('BoardScene');
        if (boardScene) {
            if (boardScene.scene.isActive()) {
                console.log('[SinglePlayer] BoardScene already active, restarting...');
                boardScene.scene.restart();
            } else {
                console.log('[SinglePlayer] Starting stopped BoardScene...');
                boardScene.scene.start();
            }
        } else {
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
        const boardScene = this._getBoardScene();
        if (boardScene?.clearBoard) {
            boardScene.clearBoard();
        }
    }

    /**
     * Apply effect quality setting
     * @private
     */
    _applyEffectQuality(quality) {
        const boardScene = this._getBoardScene();
        if (boardScene?.setEffectQuality) {
            boardScene.setEffectQuality(quality);
        }
    }

    _getBoardScene() {
        return this.deps.phaserGame?.scene?.getScene('BoardScene') || null;
    }

    /**
     * Hide multiplayer Phaser scenes
     * @private
     */
    _hideMultiplayerScenes() {
        const { phaserGame } = this.deps;
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
        const { phaserGame } = this.deps;
        if (!phaserGame?.scene) return;

        const boardScene = phaserGame.scene.getScene('BoardScene');
        if (boardScene) {
            boardScene.scene.setVisible(false);
        }
    }
}
