import { BaseGameMode } from './BaseGameMode.js';
import {
    GameState,
    spawnPiece,
    fillBag,
    gameLoop,
    updateGame,
    move as coreMove,
    rotate as coreRotate,
    hardDrop as coreHardDrop,
    softDrop as coreSoftDrop,
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
import { DemoRecorder } from '../demo/DemoRecorder.js';
import { DemoPlayer } from '../demo/DemoPlayer.js';
import { DemoManager } from '../demo/DemoManager.js';
import { PlaybackControls } from '../../ui/playback-controls.js';
import { seededRandom } from '../../utils/helpers.js';
import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';
import { buildReplayProof } from '../anti-cheat/replay-proof.js';
import { SCORE_DETAIL_FLAGS } from '../steam/leaderboard-score-details.js';

/**
 * SinglePlayerMode - Classic single-player Tetris experience
 *
 * Manages:
 * - Single GameState instance
 * - Single Phaser board scene
 * - Classic game loop
 * - Score tracking and high scores
 * - Demo recording and playback
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

        // Demo system
        this.demoRecorder = new DemoRecorder();
        this.demoPlayer = new DemoPlayer(dependencies);
        this.demoManager = new DemoManager();
        this.playbackControls = new PlaybackControls(this.demoPlayer);
        this.isRecording = false;
        this.isPlayingDemo = false;
        this.lastRecordedDemo = null;

        // Input overrides
        this.originalInputs = {};

        // Hybrid loop state (for high FPS targets)
        this.usingHybridLoop = false;
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

        // Show single player stage and container
        const singlePlayerStage = document.querySelector('.single-player-stage');
        console.log('[SinglePlayer] Found stage element:', !!singlePlayerStage);
        if (singlePlayerStage) {
            console.log('[SinglePlayer] Stage current display:', singlePlayerStage.style.display);
            console.log('[SinglePlayer] Stage computed display:', window.getComputedStyle(singlePlayerStage).display);

            // Remove inline display:none from HTML
            singlePlayerStage.removeAttribute('style');

            // Force display with !important
            singlePlayerStage.style.setProperty('display', 'flex', 'important');
            singlePlayerStage.style.setProperty('visibility', 'visible', 'important');
            singlePlayerStage.style.setProperty('opacity', '1', 'important');
            singlePlayerStage.style.setProperty('z-index', '100', 'important');

            console.log('[SinglePlayer] Stage display after set:', singlePlayerStage.style.display);
            console.log('[SinglePlayer] Stage computed after set:', window.getComputedStyle(singlePlayerStage).display);
        }

        const singlePlayerContainer = document.getElementById('single-player-container');
        console.log('[SinglePlayer] Found container element:', !!singlePlayerContainer);
        if (singlePlayerContainer) {
            singlePlayerContainer.style.setProperty('display', 'flex', 'important');
            singlePlayerContainer.style.setProperty('visibility', 'visible', 'important');
            singlePlayerContainer.style.setProperty('opacity', '1', 'important');
        }

        // Hide multiplayer container
        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'none';
        }

        // Also show stats bar
        const statsBar = document.querySelector('.single-player-stats-bar');
        console.log('[SinglePlayer] Found stats bar:', !!statsBar);
        if (statsBar) {
            statsBar.style.setProperty('display', 'flex', 'important');
            statsBar.style.setProperty('visibility', 'visible', 'important');
        }

        // Hide intro animation container
        const introAnimation = document.getElementById('intro-animation');
        if (introAnimation) {
            introAnimation.style.setProperty('display', 'none', 'important');
            console.log('[SinglePlayer] Hid intro animation');
        } else {
            console.log('[SinglePlayer] Intro animation not found');
        }

        // Hide any existing multiplayer Phaser scenes
        this._hideMultiplayerScenes();

        // Show single player Phaser scene
        this._showSinglePlayerScene();

        // Set single-player dimensions
        const boardWidth = COLS * BLOCK_SIZE;
        const boardHeight = ROWS * BLOCK_SIZE;
        this._resizePhaserGame(boardWidth, boardHeight);

        // Hook inputs
        this._hookInputs();

        console.log('[SinglePlayer] Mode activated, ready to start');
    }

    /**
     * Called when user clicks "Start Game"
     */
    async onStart(options = {}) {
        await super.onStart();

        console.log('[SinglePlayer] ========== ONSTART CALLED ==========');
        console.log('[SinglePlayer] Starting game...', options);

        // Initialize game state (lazy initialization)
        this.gameState = new GameState();

        // Reset game over processing flag so game over can trigger again
        this.isProcessingGameOver = false;

        // Handle Demo Playback
        if (options.demo) {
            console.log('[SinglePlayer] Demo playback mode detected');
            console.log('[SinglePlayer] Demo data:', options.demo);

            this.isPlayingDemo = true;
            this.isRecording = false;

            // Load the demo data into the DemoPlayer
            if (!this.demoPlayer.loadDemo(options.demo)) {
                console.error('[SinglePlayer] Failed to load demo data');
                return;
            }
            console.log('[SinglePlayer] Demo loaded successfully');

            // Store demo for "Watch Again" functionality
            this.currentDemo = options.demo;

            // Wire demo end callback - triggers when demo naturally completes
            this.demoPlayer.onPlaybackEnd = () => {
                console.log('[SinglePlayer] Demo playback ended naturally');
                this._handleGameOver();
            };

            this.playbackControls.show();

            // Show "Watching Replay" indicator
            const demoIndicator = document.getElementById('demo-indicator');
            if (demoIndicator) {
                demoIndicator.classList.add('visible');
            }

            // Start Phaser board scene
            this._startPhaserBoardScene();
            this._clearPhaserBoard();
            this._applyEffectQuality(this.deps.settingsManager.get().effectQuality || 'high');

            // Create callbacks for DemoPlayer to drive the game loop
            const drawCallback = () => {
                const boardScene = this._getBoardScene();
                if (boardScene) {
                    boardScene.syncFromGameState(this.gameState);
                } else if (this.canvas && this.ctx) {
                    draw(this.canvas, this.ctx, this.gameState);
                }
            };

            const statsCallback = () => {
                // Update stats directly without throttling for smoother demo playback
                this._updateStats();

                // Handle theme switching if needed
                const settings = this.deps.settingsManager.get();
                if (settings.backgroundMode === 'Level') {
                    const levelTheme = this.deps.themeManager.getThemeForLevel(this.gameState.level);
                    if (levelTheme !== this.deps.themeManager.activeThemeName) {
                        this.deps.themeManager.switchTheme(levelTheme);
                    }
                }
            };

            // Start playback
            this.demoPlayer.startPlayback(
                {
                    ...this._getPhysicsCallbacks(),
                    spawnPiece: () => {
                        console.log('[SinglePlayer] Demo spawnPiece called');
                        spawnPiece(this.gameState);
                        updateNextQueue(this.gameState);
                    },
                    updateStats: statsCallback, // For DemoPlayer direct calls
                    updateStatsCallback: statsCallback, // For updateGame() in game.js
                    drawCallback,
                    onStart: () => { },
                    playDropCallback: () => this.deps.soundManager.sfxPlayer.playDrop(),
                    playSoundCallback: () => { },
                    addTrailCallback: () => { },
                    physicsCallbacks: this._getPhysicsCallbacks(),
                },
                this.gameState,
            );

            // We need to hook into the game loop for rendering
            // this._startGameLoop(); // DISABLED: DemoPlayer will drive the loop to ensure determinism
            return;
        }

        this.isPlayingDemo = false;

        // Handle Recording
        // Check settings if auto-recording is enabled (default to true for now for testing)
        const settings = this.deps.settingsManager.get();
        console.log('[SinglePlayer] Settings autoRecordDemos:', settings.autoRecordDemos);

        // FORCE TRUE to ensure buttons appear while debugging settings
        const shouldRecord = true; // settings.autoRecordDemos !== false;

        if (shouldRecord) {
            console.log('[SinglePlayer] Auto-recording enabled');
            this.isRecording = true;
            const seed = Date.now(); // Generate seed
            this.gameState.randomGenerator = seededRandom(seed);
            this.demoRecorder.startRecording(this.gameState, settings, seed);
            console.log('[SinglePlayer] Recording started with seed:', seed, 'isRecording:', this.isRecording);
        } else {
            this.isRecording = false;
        }

        // Start Phaser board scene (triggers create() for fresh state)
        this._startPhaserBoardScene();

        // Clear board graphics to ensure clean slate
        this._clearPhaserBoard();

        // Apply effect quality from settings
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

        // Pause hybrid loop (stops setTimeout scheduling but keeps RAF for render)
        if (this.usingHybridLoop) {
            this.deps.frameRateController?.pauseHybridLoop();
        }

        if (this.isPlayingDemo) {
            this.demoPlayer.pausePlayback();
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

        // Resume hybrid loop
        if (this.usingHybridLoop) {
            this.deps.frameRateController?.resumeHybridLoop();
        }

        if (this.isPlayingDemo) {
            this.demoPlayer.resumePlayback();
        }
    }

    /**
     * Called when game ends
     */
    async onStop() {
        await super.onStop();

        console.log('[SinglePlayer] Stopping game...');

        // Stop game loop (handles both hybrid and standard loops)
        this._stopGameLoop();

        if (this.isPlayingDemo) {
            this.demoPlayer.stopPlayback();
            this.isPlayingDemo = false;
            this.playbackControls.hide();
        }

        // Stop recording if active and auto-save the demo (like Quadra)
        this.lastSavedDemoId = null;
        if (this.isRecording) {
            const demo = this.demoRecorder.stopRecording({
                score: this.gameState?.score,
                lines: this.gameState?.lines,
                level: this.gameState?.level,
            });
            this.lastRecordedDemo = demo;
            this.isRecording = false;
            console.log('[SinglePlayer] Recording stopped. Demo captured:', !!demo, 'Inputs:', demo?.inputs?.length);

            // Auto-save the demo to IndexedDB (like Quadra's automatic last.qrec)
            // Await to ensure we have the demoId before saving high score
            if (demo && demo.inputs?.length > 0) {
                this.lastSavedDemoId = await this._autoSaveDemo(demo);
            }
        } else {
            console.log('[SinglePlayer] Not recording, so no demo saved.');
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

        // Restore inputs
        this._restoreInputs();

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

    /**
     * Start playing a demo
     * @param {Object} demo - Demo object
     */
    startDemoPlayback(demo) {
        if (!this.demoPlayer.loadDemo(demo)) {
            console.error('Failed to load demo');
            return;
        }
        this.onStart({ demo: true });
    }

    // ===== Private Methods =====

    /**
     * Hook into global input functions to capture inputs
     * @private
     */
    _hookInputs() {
        console.log('[SinglePlayer] Hooking input functions with mode-specific callbacks');
        console.log('[SinglePlayer] window.hardDrop exists?', !!window.hardDrop);
        console.log('[SinglePlayer] window.move exists?', !!window.move);
        console.log('[SinglePlayer] window.rotate exists?', !!window.rotate);

        // Save original functions for restoration
        this.originalInputs = {
            move: window.move,
            rotate: window.rotate,
            hardDrop: window.hardDrop,
            softDrop: window.softDrop,
            hold: window.hold,
        };

        // Replace with mode-specific functions that use THIS mode's physics callbacks
        window.move = (dir) => {
            if (this.isPlayingDemo || !this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;

            coreMove(
                this.gameState,
                dir,
                () => this.deps.soundManager.sfxPlayer.playMove(),
                () => { }, // addPieceTrail - no trail for now
            );

            // Record input
            if (this.isRecording) {
                this.demoRecorder.recordInput('move', dir);
            }
        };

        window.rotate = (dir) => {
            if (this.isPlayingDemo || !this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;

            coreRotate(
                this.gameState,
                dir,
                () => this.deps.soundManager.sfxPlayer.playRotate(),
                () => { }, // addPieceTrail
            );

            // Record input
            if (this.isRecording) {
                this.demoRecorder.recordInput('rotate', dir);
            }
        };

        window.hardDrop = () => {
            console.log('[SinglePlayer] >>> HOOKED hardDrop called! <<<');
            if (this.isPlayingDemo || !this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;

            console.log('[SinglePlayer] Calling coreHardDrop with mode physics callbacks');
            coreHardDrop(
                this.gameState,
                () => this.deps.soundManager.sfxPlayer.playDrop(),
                this._getPhysicsCallbacks(), // ← USE MODE'S PHYSICS CALLBACKS!
            );

            // Record input
            if (this.isRecording) {
                this.demoRecorder.recordInput('hardDrop');
            }
        };

        window.softDrop = () => {
            if (this.isPlayingDemo || !this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;

            coreSoftDrop(
                this.gameState,
                () => this.deps.soundManager.sfxPlayer.playDrop(),
                this._getPhysicsCallbacks(), // ← USE MODE'S PHYSICS CALLBACKS!
            );

            // Record input
            if (this.isRecording) {
                this.demoRecorder.recordInput('softDrop');
            }
        };

        window.hold = () => {
            if (this.isPlayingDemo || !this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;

            // Call original hold if it exists (hold not in core game.js)
            if (this.originalInputs.hold) {
                this.originalInputs.hold();
            }

            // Record input
            if (this.isRecording) {
                this.demoRecorder.recordInput('hold');
            }
        };

        console.log('[SinglePlayer] Input functions hooked successfully');
    }

    /**
     * Restore original input functions
     * @private
     */
    _restoreInputs() {
        Object.keys(this.originalInputs).forEach((fnName) => {
            window[fnName] = this.originalInputs[fnName];
        });
        this.originalInputs = {};
    }

    /**
     * Start the game loop
     * Uses hybrid loop (setTimeout for logic, RAF for render) when target FPS exceeds monitor refresh rate
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

        // Stop any existing hybrid loop
        const { frameRateController } = this.deps;
        if (frameRateController?.isRunning) {
            frameRateController.stopHybridLoop();
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

        const physicsCallbacks = this._getPhysicsCallbacks();
        const playDropCallback = () => this.deps.soundManager.sfxPlayer.playDrop();

        // Check if we need hybrid mode (target FPS > monitor refresh rate)
        if (frameRateController?.needsHybridMode()) {
            console.log('[SinglePlayer] Using hybrid loop for high FPS target');
            this.usingHybridLoop = true;

            // Logic update function (runs at target FPS)
            const logicUpdate = (time, delta) => {
                if (this.gameState.isGameOver || this.gameState.isPaused) return;

                updateGame(time, this.gameState, {
                    drawCallback: null, // Don't draw in logic update
                    updateStatsCallback: null,
                    playDropCallback,
                    physicsCallbacks,
                });
            };

            // Render function (runs at monitor refresh rate)
            const renderUpdate = (time, alpha) => {
                // Always render, even when paused (for pause screen)
                drawCallback();
                statsCallback();
            };

            frameRateController.startHybridLoop(logicUpdate, renderUpdate);
        } else {
            console.log('[SinglePlayer] Using standard RAF loop');
            this.usingHybridLoop = false;

            // Use standard requestAnimationFrame loop
            gameLoop(
                performance.now(),
                this.gameState,
                drawCallback,
                statsCallback,
                playDropCallback,
                physicsCallbacks,
            );
        }
    }

    /**
     * Stop the game loop (both hybrid and standard)
     * @private
     */
    _stopGameLoop() {
        // Stop hybrid loop if active
        const { frameRateController } = this.deps;
        if (frameRateController?.isRunning) {
            frameRateController.stopHybridLoop();
        }

        // Cancel standard RAF loop
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        this.usingHybridLoop = false;
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
            onHardDrop: () => this.deps.soundManager.sfxPlayer.playDrop(),
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
        console.log('[SinglePlayer] _handleGameOver() called!');
        console.log('[SinglePlayer] Game over!');
        console.log('[SinglePlayer] isPlayingDemo:', this.isPlayingDemo);

        // Prevent re-entry if already processing
        if (this.isProcessingGameOver) return;
        this.isProcessingGameOver = true;

        // Special handling for demo playback
        if (this.isPlayingDemo) {
            console.log('[SinglePlayer] Demo finished, showing Demo Complete modal');

            await this.onStop();

            // Show Demo Complete modal with navigation options
            const { showDemoCompleteModal } = await import('../../ui/modals.js');

            showDemoCompleteModal(
                this.deps.modalManager,
                this.gameState,
                this.deps.highScoreManager,
                {
                    onWatchAgain: () => {
                        console.log('[SinglePlayer] Watch Again - replaying demo');
                        // No need to hideAll here as showDemoCompleteModal hides itself
                        // and we want to stay in "demo context" potentially?
                        // Actually better to restart clean.
                        if (this.onRestart) this.onRestart();
                    },
                    onBrowseReplays: () => {
                        console.log('[SinglePlayer] Browse Replays - showing demo browser');

                        // Clean slate navigation
                        this.deps.modalManager.hideAll();
                        this.deps.modalManager.show('start');
                        eventBus.emit(EVENTS.OPEN_DEMO_BROWSER);
                    },
                    onMainMenu: () => {
                        console.log('[SinglePlayer] Main Menu - exiting to main menu');
                        eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
                    },
                },
            );

            this.isProcessingGameOver = false;
            return;
        }

        // Normal game over handling (not demo playback)
        await this.onStop();

        // Save high score (with linked demo ID if available)
        await this.deps.highScoreManager.addScore({
            score: this.gameState.score,
            lines: this.gameState.lines,
            level: this.gameState.level,
            demoId: this.lastSavedDemoId,
        });

        // Sync Steam stats/leaderboards in the background (best-effort)
        this._syncSteamStats().catch((err) => {
            console.warn('[SinglePlayer] Steam stats sync failed:', err.message);
        });

        // Show game over modal with stats
        const { showGameOverModal } = await import('../../ui/modals.js');

        // Show game over modal (demos are auto-saved, no need to pass them here)
        console.log('[SinglePlayer] Showing Game Over modal.');
        await showGameOverModal(
            this.deps.modalManager,
            this.gameState,
            this.deps.highScoreManager,
            {
                onMainMenu: () => {
                    console.log('[SinglePlayer] Main Menu - exiting to main menu');
                    eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
                },
            },
        );

        // Trigger game over event
        window.dispatchEvent(new CustomEvent('gameOver', {
            detail: { gameState: this.gameState },
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

        const durationMs = Date.now() - (this.gameState.startTime || Date.now());
        const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
        const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

        const replayProof = await buildReplayProof({
            demo: this.lastRecordedDemo,
            expectedScore: this.gameState.score,
            expectedLines: this.gameState.lines,
            expectedLevel: this.gameState.level,
            expectedDurationMs: durationMs,
        });

        let flags = SCORE_DETAIL_FLAGS.NONE;
        if (this.lastRecordedDemo?.inputs?.length) {
            flags |= SCORE_DETAIL_FLAGS.REPLAY_PRESENT;
        }
        if (replayProof.verified) {
            flags |= SCORE_DETAIL_FLAGS.REPLAY_VERIFIED;
        } else if (replayProof.issues?.length) {
            flags |= SCORE_DETAIL_FLAGS.REPLAY_MISMATCH;
        }

        const scoreDetails = {
            score: this.gameState.score,
            duration: durationSeconds,
            linesCleared: this.gameState.lines,
            highestLevel: this.gameState.level,
            checksum32: replayProof.checksum32,
            replayHash: replayProof.hash,
            replayVerified: replayProof.verified,
            replayIssues: replayProof.issues,
            replayInputCount: replayProof.inputCount,
            replayDurationMs: replayProof.durationMs,
            replayId: this.lastSavedDemoId,
            flags,
            version: '1.0.0',
        };

        await Promise.all([
            steamService.uploadScore(STEAM_LEADERBOARDS.SINGLE_PLAYER_HIGH_SCORE, this.gameState.score, scoreDetails),
            steamService.uploadScore(STEAM_LEADERBOARDS.SINGLE_PLAYER_LINES, this.gameState.lines, scoreDetails),
            steamService.incrementStat('total_games_played', 1),
            steamService.incrementStat('total_lines_cleared', this.gameState.lines),
            steamService.incrementStat('playtime_minutes', durationMinutes),
        ]);
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
     * Auto-save demo to IndexedDB (like Quadra's automatic last.qrec saving)
     * @private
     * @param {Object} demo - Demo object to save
     * @returns {Promise<number|null>} The saved demo ID, or null if save failed
     */
    async _autoSaveDemo(demo) {
        try {
            if (!this.demoManager) {
                this.demoManager = new DemoManager();
            }
            const savedId = await this.demoManager.saveDemo(demo);
            console.log('[SinglePlayer] Demo auto-saved with ID:', savedId);

            // Store the saved ID on the demo object for reference
            demo.id = savedId;
            return savedId;
        } catch (error) {
            console.error('[SinglePlayer] Failed to auto-save demo:', error);
            return null;
        }
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
            boardScene.scene.setVisible(true);
        }
    }
}
