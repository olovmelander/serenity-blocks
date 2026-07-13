import { BaseGameMode } from './BaseGameMode.js';
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
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
import {
    emitLineClear, emitCombo, emitPieceLock, emitPerfectClear, emitTSpin, emitB2B,
} from '../../events/gameplay-events.js';
import {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
    DemoRecorder,
} from '../demo/DemoRecorder.js';
import { DemoPlayer } from '../demo/DemoPlayer.js';
import { DemoManager } from '../demo/DemoManager.js';
import { PlaybackControls } from '../../ui/playback-controls.js';
import { seededRandom } from '../../utils/helpers.js';
import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';
import { buildReplayProof } from '../anti-cheat/replay-proof.js';
import { SCORE_DETAIL_FLAGS } from '../steam/leaderboard-score-details.js';
import { readFlag } from '../flags.js';
import {
    applyFixedHardDropHitStop,
    applyFixedLineImpactHitStop,
    applyFixedPerfectClearHitStop,
} from '../fixed-hit-stop-policy.js';
import {
    createSinglePlayerFixedInputBinding,
    createSinglePlayerFixedTickRuntime,
    ownsSinglePlayerFixedTickRuntime,
    runSinglePlayerFixedTicks,
    startSinglePlayerFixedTickRuntime,
    stopSinglePlayerFixedTickRuntime,
} from './single-player-fixed-tick.js';
import { canWriteLegacySinglePlayerResults } from './single-player-result-compatibility.js';

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

        // Default-off canonical clock (§5.3). FrameRateController still owns
        // wall time; this state only fences one normal single-player session.
        this._fixedTickEnabled = false;
        this._fixedTickRuntime = createSinglePlayerFixedTickRuntime();
        this._fixedTickOwnership = null;
        this._fixedTickInputBinding = null;
        this._lastFixedTickClockWarp = null;
        // Latched separately from _fixedTickEnabled because onStop retires the
        // runtime before game-over persistence is evaluated.
        this._sessionSimulationClock = DEMO_LEGACY_SIMULATION_CLOCK;

        // Lifecycle ownership. A stop owns the exact state/clock/recording it
        // captured at entry, and a replacement start waits for that teardown
        // to publish one immutable result bundle.
        this._sessionGeneration = 0;
        this._activeSession = null;
        this._stoppedSession = null;
        this._stopPromise = null;
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

        // Intro animation dismissal is handled by the game start transition in main.js.
        // The transition overlay masks the visual handoff.

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
        // BaseGameMode marks a session non-running before SinglePlayer teardown
        // has drained physics and saved its demo. Do not let that public flag
        // make a replacement GameState eligible until the full stop resolves.
        const pendingStop = this._stopPromise;
        if (pendingStop) {
            await pendingStop;
        }

        if (this.isRunning) {
            await super.onStart();
            return;
        }

        if (options.demo && !this.demoPlayer.loadDemo(options.demo)) {
            throw new Error(this.demoPlayer.lastLoadError || 'Unsupported or invalid demo data');
        }
        await super.onStart();

        // A concurrent deactivation can retire the mode while BaseGameMode's
        // async hook yields. In that case there is no session to initialize.
        if (!this.isActive || !this.isRunning) {
            return;
        }

        console.log('[SinglePlayer] ========== ONSTART CALLED ==========');
        console.log('[SinglePlayer] Starting game...', options);

        const replaySettings = options.demo
            ? this.demoPlayer.demo.initialState.settings
            : null;
        const inputHandlingSettings = replaySettings || this.deps.settingsManager.get();
        const hitStopEnabled = replaySettings
            ? replaySettings.hitStopEnabled
            : !this._prefersReducedMotion();
        // Input handling is match state, not a live UI dependency. Replays
        // latch their recorded handling; new matches latch current settings.
        this.gameState = new GameState({
            inputHandling: inputHandlingSettings,
            hitStopEnabled,
        });
        this._fixedTickEnabled = !options.demo && readFlag('fixedTick', false);
        if (this._fixedTickEnabled && !this.deps.frameRateController?.startHybridLoop) {
            console.warn('[SinglePlayer] fixedTick requires FrameRateController; using legacy loop');
            this._fixedTickEnabled = false;
        }
        this._sessionSimulationClock = this._fixedTickEnabled
            ? DEMO_FIXED_SIMULATION_CLOCK
            : DEMO_LEGACY_SIMULATION_CLOCK;
        const sessionGeneration = ++this._sessionGeneration;
        this._activeSession = Object.freeze({
            generation: sessionGeneration,
            gameState: this.gameState,
            simulationClock: this._sessionSimulationClock,
        });
        this._stoppedSession = null;

        // Reset game over processing flag so game over can trigger again
        this.isProcessingGameOver = false;

        // Handle Demo Playback
        if (options.demo) {
            console.log('[SinglePlayer] Demo playback mode detected');
            console.log('[SinglePlayer] Demo data:', options.demo);

            this.isPlayingDemo = true;
            this.isRecording = false;

            console.log('[SinglePlayer] Demo loaded successfully');

            // Store demo for "Watch Again" functionality
            this.currentDemo = options.demo;

            // Wire demo end callback - triggers when demo naturally completes
            this.demoPlayer.onPlaybackEnd = () => {
                console.log('[SinglePlayer] Demo playback ended naturally');
                this._handleGameOver(sessionGeneration);
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
                        spawnPiece(
                            this.gameState,
                            () => this._refreshNextQueue(),
                            undefined,
                        );
                        this._refreshNextQueue();
                    },
                    applyCommand: (command, commandOptions = {}) => this._applyCommand(command, {
                        ...commandOptions,
                        record: false,
                    }),
                    updateStats: statsCallback, // For DemoPlayer direct calls
                    updateStatsCallback: statsCallback, // For updateGame() in game.js
                    drawCallback,
                    onStart: () => { },
                    replayTimingCallbacks: {
                        onHardDrop: () => this._applyHardDropTiming(),
                        onLineClearImpact: (lineCount, cascadeCount) => (
                            this._applyLineClearImpactTiming(lineCount, cascadeCount)
                        ),
                        onPerfectClear: () => this._applyPerfectClearTiming(),
                    },
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

        let recordingSeed = null;
        if (shouldRecord) {
            console.log('[SinglePlayer] Auto-recording enabled');
            recordingSeed = Date.now(); // Generate seed
            this.gameState.randomGenerator = seededRandom(recordingSeed);
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
            () => this._handleGameOver(sessionGeneration),
        );

        if (shouldRecord) {
            this.demoRecorder.startRecording(
                this.gameState,
                settings,
                recordingSeed,
                'single-player',
                this._sessionSimulationClock,
            );
            this.isRecording = true;
            console.log('[SinglePlayer] Recording started with seed:', recordingSeed, 'isRecording:', this.isRecording);
        }

        // Draw initial UI
        this._refreshNextQueue();
        this._updateStats();

        // Start game loop
        this._startGameLoop();

        console.log('[SinglePlayer] Game started!');
    }

    /**
     * Called when game is paused. Sim mirror + hybrid-loop pause live in
     * BaseGameMode (§4.6 slice 2); only demo playback is mode-specific.
     */
    _getPausableGameState() {
        return this.gameState || null;
    }

    onPause() {
        super.onPause();

        this._fixedTickInputBinding?.clear();

        if (this.isPlayingDemo) {
            this.demoPlayer.pausePlayback();
        }
    }

    /**
     * Called when game is resumed
     */
    onResume() {
        super.onResume();

        if (
            this._fixedTickEnabled
            && this.gameState
            && ownsSinglePlayerFixedTickRuntime(
                this._fixedTickRuntime,
                this._fixedTickOwnership,
            )
        ) {
            // BaseGameMode reanchors variable-delta loops to wall time. The
            // canonical clock keeps lastTime on its simulation-time domain.
            this.gameState.lastTime = this.gameState.simTimeMs;
        }

        if (this.isPlayingDemo) {
            this.demoPlayer.resumePlayback();
        }
    }

    /**
     * Called when game ends
     */
    onStop() {
        if (this._stopPromise) {
            return this._stopPromise;
        }
        if (!this._activeSession) {
            if (!this.isRunning) {
                return Promise.resolve(this._stoppedSession);
            }

            // onStart awaits BaseGameMode before publishing _activeSession.
            // A deactivation in that narrow window must still retire the base
            // running flag instead of leaving a zombie mode behind.
            const baseStop = super.onStop();
            const trackedStop = baseStop
                .then(() => this._stoppedSession)
                .finally(() => {
                    if (this._stopPromise === trackedStop) {
                        this._stopPromise = null;
                    }
                });
            this._stopPromise = trackedStop;
            return trackedStop;
        }

        const session = this._activeSession;
        const teardown = Object.freeze({
            session,
            wasPlayingDemo: this.isPlayingDemo,
            wasRecording: this.isRecording,
        });

        // BaseGameMode's async method has no await: invoking it marks the mode
        // non-running synchronously. The returned promise is still joined by
        // the captured teardown so a future base implementation stays ordered.
        const baseStopPromise = super.onStop();
        const completion = this._stopCapturedSession(teardown, baseStopPromise);
        const trackedStop = completion
            .then((stoppedSession) => {
                if (this._activeSession === session) {
                    this._activeSession = null;
                    this._stoppedSession = stoppedSession;
                    this.lastRecordedDemo = stoppedSession.demo;
                    this.lastSavedDemoId = stoppedSession.demoId;
                }
                return stoppedSession;
            })
            .finally(() => {
                if (this._stopPromise === trackedStop) {
                    this._stopPromise = null;
                }
            });
        this._stopPromise = trackedStop;
        return trackedStop;
    }

    /**
     * Finish one captured session without consulting replacement mode state.
     * @param {{
     *   session: { generation: number, gameState: GameState, simulationClock: string },
     *   wasPlayingDemo: boolean,
     *   wasRecording: boolean
     * }} teardown
     * @param {Promise<void>} baseStopPromise
     * @returns {Promise<Readonly<{
     *   generation: number,
     *   gameState: GameState,
     *   simulationClock: string,
     *   demo: Object|null,
     *   demoId: number|null
     * }>>}
     * @private
     */
    async _stopCapturedSession(teardown, baseStopPromise) {
        const { session, wasPlayingDemo, wasRecording } = teardown;
        const { gameState, generation, simulationClock } = session;

        console.log('[SinglePlayer] Stopping game...');

        // Mark the captured state over before draining its queued physics.
        // Never read this.gameState after an await in this transaction.
        gameState.isGameOver = true;
        gameState.isStopped = true;
        this._stopGameLoop();
        this._fixedTickEnabled = false;

        await baseStopPromise;

        const physicsPromise = gameState.latestPhysicsPromise;
        if (physicsPromise) {
            try {
                await physicsPromise;
            } catch (error) {
                console.warn('[SinglePlayer] In-flight physics rejected during stop:', error);
            } finally {
                gameState.latestPhysicsPromise = null;
                gameState.isProcessingPhysics = false;
            }
        }

        if (wasPlayingDemo) {
            this.isPlayingDemo = false;
            // Suppress the natural-end callback during teardown to avoid
            // a recursive _handleGameOver via onPlaybackEnd → _handleGameOver.
            this.demoPlayer.onPlaybackEnd = null;
            this.demoPlayer.stopPlayback();
            this.playbackControls.hide();
        }

        let demo = null;
        let demoId = null;
        if (wasRecording) {
            demo = this.demoRecorder.stopRecording({
                score: gameState.score,
                lines: gameState.lines,
                level: gameState.level,
                durationMs: gameState.simTimeMs,
                durationFrames: gameState.simFrame,
                piecesPlaced: gameState.piecesPlaced,
            }, gameState); // terminal checkpoint + final board digest (§5.0)
            this.isRecording = false;
            console.log('[SinglePlayer] Recording stopped. Demo captured:', !!demo, 'Inputs:', demo?.inputs?.length);

            // Auto-save the demo to IndexedDB (like Quadra's automatic last.qrec).
            if (demo && demo.inputs?.length > 0) {
                demoId = await this._autoSaveDemo(demo);
            }
        } else {
            console.log('[SinglePlayer] Not recording, so no demo saved.');
        }

        this._stopPhaserBoardScene();

        return Object.freeze({
            generation,
            gameState,
            simulationClock,
            demo,
            demoId,
        });
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        // Retire activation immediately so a start queued behind the stop
        // cannot initialize a replacement state while cleanup is in progress.
        this.isActive = false;
        const pendingStop = this._stopPromise || (this._activeSession ? this.onStop() : null);
        if (pendingStop) {
            await pendingStop;
        }
        await super.onDeactivate();

        console.log('[SinglePlayer] Deactivating...');

        this._stopFixedTickSession();
        this._fixedTickEnabled = false;

        this._stopPhaserBoardScene();

        // Clean up board juice
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        // Restore inputs
        this._restoreInputs();

        // The stop above has drained every captured-state await, so clearing
        // this reference cannot null out a teardown finally block.
        if (!this._activeSession) {
            this.gameState = null;
        }

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
        return this.onStart({ demo });
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
            singlePlayerCommandDispatcher: window.singlePlayerCommandDispatcher,
        };

        // Replace with mode-specific functions that use THIS mode's physics callbacks
        // Initialize BoardJuice for reactive board motion
        this._initBoardJuice();

        window.move = (dir) => this._applyCommand({ type: 'move', value: dir });

        window.rotate = (dir) => this._applyCommand({ type: 'rotate', value: dir });

        window.hardDrop = () => this._applyCommand({ type: 'hardDrop' });

        window.softDrop = () => this._applyCommand({ type: 'softDrop' });

        window.singlePlayerCommandDispatcher = (command, options = {}) => this._applyCommand(command, options);

        console.log('[SinglePlayer] Input functions hooked successfully');
    }

    _normalizeCommand(command) {
        return {
            type: command?.type || command?.a || command?.action,
            value: command?.value ?? command?.d ?? command?.data ?? null,
        };
    }

    _queueBufferedCommand(type, value) {
        if (!this.gameState || (type !== 'move' && type !== 'rotate')) return false;

        const queued = { type, dir: value };
        if (Array.isArray(this.gameState.inputQueue)) {
            if (this.gameState.inputQueue.length >= 4) return false;
            this.gameState.inputQueue.push(queued);
            return true;
        }

        if (this.gameState.inputQueue) {
            this.gameState.inputQueue = [this.gameState.inputQueue, queued].slice(0, 4);
            return true;
        }

        this.gameState.inputQueue = queued;
        return true;
    }

    _recordAcceptedCommand(type, value, options = {}) {
        if (options.record === false || !this.isRecording || !this.demoRecorder) return;
        this.demoRecorder.recordCommand({
            a: type,
            d: value,
            q: Boolean(options.queued),
        }, this.gameState);
    }

    _applyCommand(command, options = {}) {
        const { type, value } = this._normalizeCommand(command);
        if (!type || !this.gameState) return false;

        const replayCommand = options.record === false || this.gameState.isReplay;
        if (this.isPlayingDemo && !replayCommand) return false;
        if (
            this.gameState.isPaused
            || this.gameState.isGameOver
            || this.gameState.hitStopRemaining > 0
        ) {
            return false;
        }

        if (this.gameState.isProcessingPhysics) {
            const queued = this._queueBufferedCommand(type, value);
            if (queued) {
                this._recordAcceptedCommand(type, value, { ...options, queued: true });
            }
            return queued;
        }

        const muted = Boolean(options.muted);
        const suppliedCallbacks = options.callbacks || {};
        const physicsCallbacks = suppliedCallbacks.physicsCallbacks || this._getPhysicsCallbacks();
        const playDropCallback = suppliedCallbacks.playDropCallback
            || (muted ? (() => { }) : (() => this.deps.soundManager.sfxPlayer.playDrop()));
        const playSoundCallback = suppliedCallbacks.playSoundCallback || null;
        const moveSound = playSoundCallback
            || (muted ? (() => { }) : (() => this.deps.soundManager.sfxPlayer.playMove()));
        const rotateSound = playSoundCallback
            || (muted ? (() => { }) : (() => this.deps.soundManager.sfxPlayer.playRotate()));
        const addTrailCallback = suppliedCallbacks.addTrailCallback || (() => { });

        let accepted = false;

        if (type === 'move') {
            accepted = coreMove(this.gameState, value, moveSound, addTrailCallback);
            if (this.boardJuice && !muted) {
                if (accepted) {
                    this.boardJuice.nudge(value * 1.5, 0);
                    this.boardJuice.tilt(value * 0.4);
                } else {
                    this.boardJuice.nudge(value * 0.8, 0);
                }
            }
        } else if (type === 'rotate') {
            accepted = coreRotate(this.gameState, value, rotateSound, addTrailCallback);
            if (accepted && this.boardJuice && !muted) {
                this.boardJuice.tilt(value === 'left' ? -0.3 : 0.3);
            }
        } else if (type === 'hardDrop') {
            accepted = options.fixedTick === true
                ? coreHardDrop(
                    this.gameState,
                    playDropCallback,
                    physicsCallbacks,
                    { fixedTick: true, inputPhase: options.inputPhase === true },
                )
                : coreHardDrop(this.gameState, playDropCallback, physicsCallbacks);
            if (accepted && this.boardJuice && !muted) {
                this.boardJuice.dip(3);
                this.boardJuice.bounce();
            }
        } else if (type === 'softDrop') {
            const beforeProcessing = this.gameState.isProcessingPhysics;
            const beforePiece = this.gameState.currentPiece;
            const moved = options.fixedTick === true
                ? coreSoftDrop(
                    this.gameState,
                    playDropCallback,
                    physicsCallbacks,
                    { fixedTick: true, inputPhase: options.inputPhase === true },
                )
                : coreSoftDrop(this.gameState, playDropCallback, physicsCallbacks);
            accepted = Boolean(moved)
                || (!beforeProcessing && this.gameState.isProcessingPhysics)
                || (beforePiece && beforePiece !== this.gameState.currentPiece);
        }

        if (accepted) {
            this._recordAcceptedCommand(type, value, options);
        }

        return accepted;
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
        this._stopFixedTickSession();

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

            if (this.isRecording) {
                this.demoRecorder.recordCheckpoint(this.gameState);
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

        if (this._fixedTickEnabled) {
            if (!frameRateController?.startHybridLoop) {
                console.warn('[SinglePlayer] fixedTick requires FrameRateController; using legacy loop');
                this._fixedTickEnabled = false;
            } else {
                console.log('[SinglePlayer] Using canonical 60 Hz simulation clock');
                this.usingHybridLoop = true;
                const ownership = this._startFixedTickSession();
                const fixedState = this.gameState;
                const inputBinding = this._fixedTickInputBinding;
                const sessionContinues = () => (
                    this._fixedTickEnabled
                    && this.isRunning
                    && !this.isPaused
                    && !this.isPlayingDemo
                    && this.gameState === fixedState
                    && fixedState.isPaused !== true
                    && fixedState.isGameOver !== true
                    && fixedState.isStopped !== true
                    && ownsSinglePlayerFixedTickRuntime(this._fixedTickRuntime, ownership)
                );
                const inputCallbacks = {
                    playDropCallback,
                    physicsCallbacks,
                };
                const logicUpdate = (_time, delta) => {
                    runSinglePlayerFixedTicks(this._fixedTickRuntime, delta, {
                        ownership,
                        advanceInput: inputBinding?.advanceInput,
                        applyInput: (command) => this._applyCommand({
                            type: command.action,
                            value: command.value,
                        }, {
                            fixedTick: true,
                            inputPhase: true,
                            callbacks: inputCallbacks,
                        }),
                        playDropCallback,
                        physicsCallbacks,
                        shouldContinue: sessionContinues,
                        onClockWarp: (clockWarp) => {
                            this._lastFixedTickClockWarp = clockWarp;
                            console.warn('[SinglePlayer] Fixed simulation clock rebased:', clockWarp);
                        },
                    });
                };
                const renderUpdate = () => {
                    if (
                        !this._fixedTickEnabled
                        || !this.isRunning
                        || this.gameState !== fixedState
                        || !ownsSinglePlayerFixedTickRuntime(this._fixedTickRuntime, ownership)
                    ) return;
                    drawCallback();
                    statsCallback();
                };

                try {
                    frameRateController.startHybridLoop(logicUpdate, renderUpdate);
                } catch (error) {
                    frameRateController.stopHybridLoop?.();
                    this._stopFixedTickSession();
                    this.usingHybridLoop = false;
                    throw error;
                }
                return;
            }
        }

        // Check if we need hybrid mode (target FPS > monitor refresh rate)
        if (frameRateController?.needsHybridMode()) {
            console.log('[SinglePlayer] Using hybrid loop for high FPS target');
            this.usingHybridLoop = true;

            // Logic update function (runs at target FPS)
            // eslint-disable-next-line no-unused-vars
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
            // eslint-disable-next-line no-unused-vars
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
        this._stopFixedTickSession();

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

    _startFixedTickSession() {
        const ownership = startSinglePlayerFixedTickRuntime(
            this._fixedTickRuntime,
            this.gameState,
        );
        this._fixedTickOwnership = ownership;
        this._fixedTickInputBinding = createSinglePlayerFixedInputBinding({
            gameState: this.gameState,
            inputController: this.deps.inputController,
            gamepadController: this.deps.gamepadController,
            isEnabled: () => (
                this._fixedTickEnabled
                && this.isRunning
                && !this.isPaused
                && !this.isPlayingDemo
                && this.gameState === ownership.gameState
                && ownsSinglePlayerFixedTickRuntime(this._fixedTickRuntime, ownership)
            ),
        });
        this._fixedTickInputBinding.install();
        return ownership;
    }

    _stopFixedTickSession() {
        this._fixedTickInputBinding?.dispose();
        this._fixedTickInputBinding = null;
        stopSinglePlayerFixedTickRuntime(this._fixedTickRuntime);
        this._fixedTickOwnership = null;
    }

    _prefersReducedMotion() {
        const settings = this.deps.settingsManager.get();
        return settings.reducedMotion
            || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    }

    _applyHardDropTiming(gameState = this.gameState, fixedPolicy = false) {
        if (fixedPolicy) {
            applyFixedHardDropHitStop(gameState);
        } else if (gameState?.hitStopEnabled) {
            gameState.hitStopRemaining = Math.max(gameState.hitStopRemaining || 0, 30);
        }
    }

    _applyLineClearImpactTiming(lineCount, gameState = this.gameState, fixedPolicy = false) {
        if (fixedPolicy) {
            applyFixedLineImpactHitStop(gameState, lineCount);
            return;
        }
        if (!gameState?.hitStopEnabled) return;

        const boardScene = this._getBoardScene();
        let hitStop = 0;
        if (boardScene?.sharedEffects) {
            const tier = boardScene.sharedEffects.getClearTier(lineCount);
            hitStop = tier?.hitStop || 0;
        } else if (lineCount >= 4) {
            hitStop = 70;
        }
        if (hitStop > 0) {
            gameState.hitStopRemaining = hitStop;
        }
    }

    _applyPerfectClearTiming(gameState = this.gameState, fixedPolicy = false) {
        if (fixedPolicy) {
            applyFixedPerfectClearHitStop(gameState);
        } else if (gameState?.hitStopEnabled) {
            gameState.hitStopRemaining = 110;
        }
    }

    /**
     * Get physics callbacks for sound effects and piece spawning
     * @private
     */
    _getPhysicsCallbacks() {
        const callbackSession = this._activeSession;
        const sessionGeneration = callbackSession?.generation;
        const timingState = callbackSession?.gameState || this.gameState;
        const usesFixedTiming = callbackSession?.simulationClock === DEMO_FIXED_SIMULATION_CLOCK;
        return {
            onMove: () => this.deps.soundManager.sfxPlayer.playMove(),
            onRotate: () => this.deps.soundManager.sfxPlayer.playRotate(),
            onLineClear: (lineCount, ...rest) => {
                const clearedRows = Array.isArray(rest[2]) ? rest[2] : [];
                const cascadeCount = rest[3] ?? 1;
                this.deps.soundManager.sfxPlayer.playLineClear(cascadeCount);

                // Emit event for theme reactions
                console.log('[SinglePlayer] Emitting LINE_CLEAR event, count:', lineCount);
                emitLineClear({ lineCount, clearedRows, cascadeCount });
            },
            onTSpin: (lineCount) => {
                emitTSpin({ lineCount });
                this.deps.soundManager.sfxPlayer.playTSpin?.();
                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects?.playTSpinEffect) {
                    boardScene.sharedEffects.playTSpinEffect(lineCount);
                }
            },
            onB2B: () => {
                emitB2B();
                this.deps.soundManager.sfxPlayer.playB2B?.();
                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects?.playB2BChange) {
                    boardScene.sharedEffects.playB2BChange(true);
                }
            },
            onLevelUp: () => this.deps.soundManager.sfxPlayer.playLevelUp(),
            onHardDrop: (dropData) => {
                this._applyHardDropTiming(timingState, usesFixedTiming);

                this.deps.soundManager.sfxPlayer.playDrop();
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.playHardDropEffect) {
                    boardScene.playHardDropEffect(dropData);
                }
            },
            // Trigger combo visual effects
            triggerCombo: (comboCount) => {
                // Emit event for theme reactions
                console.log('[SinglePlayer] Emitting COMBO event, comboCount:', comboCount);
                emitCombo({ comboCount });

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
                this._applyLineClearImpactTiming(lineCount, timingState, usesFixedTiming);

                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.playLineClearImpact) {
                    boardScene.playLineClearImpact(lineCount, cascadeCount);
                }

                // Board juice: pulse on line clear, scaled by count
                if (this.boardJuice) {
                    const intensity = 1 + (Math.min(lineCount, 4) * 0.004);
                    this.boardJuice.pulse(intensity);
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
            // Perfect clear / all-clear celebration (flagship moment)
            onPerfectClear: (depth, perfectClearBonus) => {
                this._applyPerfectClearTiming(timingState, usesFixedTiming);

                emitPerfectClear({ depth, perfectClearBonus });
                this.deps.soundManager.sfxPlayer.playPerfectClear?.();

                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects?.playPerfectClear) {
                    boardScene.sharedEffects.playPerfectClear(depth);
                }

                // Extra board juice for the showstopper.
                if (this.boardJuice) {
                    this.boardJuice.dip(2);
                    this.boardJuice.bounce();
                }
            },
            // Piece lock ripple effect
            onPieceLock: (piece) => {
                // Emit event for theme reactions
                emitPieceLock({ piece });

                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.createPieceLockRipple) {
                    boardScene.createPieceLockRipple(piece);
                }

                // Board juice: gentle dip + pulse on piece lock
                if (this.boardJuice) {
                    this.boardJuice.dip(1);
                    this.boardJuice.pulse(1.005);
                }
            },
            // CRITICAL: Spawn next piece after physics completes (after piece lock)
            spawnPiece: () => {
                spawnPiece(
                    this.gameState,
                    () => this._refreshNextQueue(),
                    this.isPlayingDemo
                        ? undefined
                        : () => this._handleGameOver(sessionGeneration),
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
    async _handleGameOver(expectedGeneration = this._activeSession?.generation) {
        console.log('[SinglePlayer] _handleGameOver() called!');
        console.log('[SinglePlayer] Game over!');
        console.log('[SinglePlayer] isPlayingDemo:', this.isPlayingDemo);

        const activeSession = this._activeSession;
        if (!activeSession || activeSession.generation !== expectedGeneration) {
            return;
        }

        if (this.isPlayingDemo && (this.demoPlayer?.isSeeking || this.gameState?.isSeeking)) {
            return;
        }

        // Prevent re-entry if already processing
        if (this.isProcessingGameOver) return;
        this.isProcessingGameOver = true;

        // Special handling for demo playback
        if (this.isPlayingDemo) {
            console.log('[SinglePlayer] Demo finished, showing Demo Complete modal');

            const { currentDemo } = this;
            const stoppedSession = await this.onStop();
            if (!this._ownsStoppedSessionUi(stoppedSession)) {
                return;
            }

            // Show Demo Complete modal with navigation options
            const { showDemoCompleteModal } = await import('../../ui/modals.js');
            if (!this._ownsStoppedSessionUi(stoppedSession)) {
                return;
            }

            await showDemoCompleteModal(
                this.deps.modalManager,
                stoppedSession.gameState,
                this.deps.highScoreManager,
                {
                    onWatchAgain: () => {
                        console.log('[SinglePlayer] Watch Again - replaying demo');
                        this.deps.modalManager.hideAll();
                        eventBus.emit(EVENTS.PLAY_DEMO, { demo: currentDemo });
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
                {
                    shouldPresent: () => this._ownsStoppedSessionUi(stoppedSession),
                },
            );

            if (this._ownsStoppedSessionUi(stoppedSession)) {
                this.isProcessingGameOver = false;
            }
            return;
        }

        // Normal game over handling (not demo playback). Teardown publishes
        // the complete immutable result source; no later session field is read.
        const stoppedSession = await this.onStop();
        if (!stoppedSession) {
            return;
        }
        const { gameState, simulationClock, demoId } = stoppedSession;
        const writesLegacyResults = canWriteLegacySinglePlayerResults(simulationClock);

        if (writesLegacyResults) {
            // Save high score (with linked demo ID if available)
            await this.deps.highScoreManager.addScore({
                score: gameState.score,
                lines: gameState.lines,
                level: gameState.level,
                demoId,
            });

            // Sync Steam stats/leaderboards in the background (best-effort)
            this._syncSteamStats(stoppedSession).catch((err) => {
                console.warn('[SinglePlayer] Steam stats sync failed:', err.message);
            });
        } else {
            console.info(
                '[SinglePlayer] Experimental simulation clock; legacy score/stat writes skipped:',
                simulationClock,
            );
        }

        if (!this._ownsStoppedSessionUi(stoppedSession)) {
            return;
        }

        // Show game over modal with stats
        const { showGameOverModal } = await import('../../ui/modals.js');
        if (!this._ownsStoppedSessionUi(stoppedSession)) {
            return;
        }

        // Show game over modal (demos are auto-saved, no need to pass them here)
        console.log('[SinglePlayer] Showing Game Over modal.');
        await showGameOverModal(
            this.deps.modalManager,
            gameState,
            this.deps.highScoreManager,
            {
                onMainMenu: () => {
                    console.log('[SinglePlayer] Main Menu - exiting to main menu');
                    eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
                },
            },
            {
                includeLegacyResults: writesLegacyResults,
                shouldPresent: () => this._ownsStoppedSessionUi(stoppedSession),
            },
        );

        if (!this._ownsStoppedSessionUi(stoppedSession)) {
            return;
        }

        // Trigger game over event
        window.dispatchEvent(new CustomEvent('gameOver', {
            detail: { gameState },
        }));
    }

    /**
     * Whether one stopped generation still owns the mode's result UI.
     * @param {Object|null} stoppedSession
     * @returns {boolean}
     * @private
     */
    _ownsStoppedSessionUi(stoppedSession) {
        return Boolean(
            stoppedSession
            && this.isActive
            && !this.isRunning
            && !this._activeSession
            && this._stoppedSession === stoppedSession
            && this._sessionGeneration === stoppedSession.generation,
        );
    }

    /**
     * Sync Steam stats and leaderboards (best-effort, non-blocking)
     * @private
     * @param {Readonly<{
     *   gameState: GameState,
     *   simulationClock: string,
     *   demo: Object|null,
     *   demoId: number|null
     * }>|null} stoppedSession
     */
    async _syncSteamStats(stoppedSession) {
        const gameState = stoppedSession?.gameState;
        const simulationClock = stoppedSession?.simulationClock;
        if (
            !gameState
            || !canWriteLegacySinglePlayerResults(simulationClock)
        ) {
            return;
        }

        const {
            demo: recordedDemo,
            demoId: replayId,
        } = stoppedSession;
        const durationMs = Number.isFinite(gameState.simTimeMs)
            ? gameState.simTimeMs
            : Date.now() - (gameState.startTime || Date.now());
        const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
        const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

        const replayProof = await buildReplayProof({
            demo: recordedDemo,
            expectedScore: gameState.score,
            expectedLines: gameState.lines,
            expectedLevel: gameState.level,
            expectedDurationMs: durationMs,
        });

        let flags = SCORE_DETAIL_FLAGS.NONE;
        if (recordedDemo?.inputs?.length) {
            flags |= SCORE_DETAIL_FLAGS.REPLAY_PRESENT;
        }
        if (replayProof.verified) {
            flags |= SCORE_DETAIL_FLAGS.REPLAY_VERIFIED;
        } else if (replayProof.issues?.length) {
            flags |= SCORE_DETAIL_FLAGS.REPLAY_MISMATCH;
        }

        const scoreDetails = {
            score: gameState.score,
            duration: durationSeconds,
            linesCleared: gameState.lines,
            highestLevel: gameState.level,
            checksum32: replayProof.checksum32,
            replayHash: replayProof.hash,
            replayVerified: replayProof.verified,
            replayIssues: replayProof.issues,
            replayInputCount: replayProof.inputCount,
            replayDurationMs: replayProof.durationMs,
            replayId,
            flags,
            version: '1.0.0',
        };

        await Promise.all([
            steamService.uploadScore(STEAM_LEADERBOARDS.SINGLE_PLAYER_HIGH_SCORE, gameState.score, scoreDetails),
            steamService.uploadScore(STEAM_LEADERBOARDS.SINGLE_PLAYER_LINES, gameState.lines, scoreDetails),
            steamService.incrementStat('total_games_played', 1),
            steamService.incrementStat('total_lines_cleared', gameState.lines),
            steamService.incrementStat('playtime_minutes', durationMinutes),
        ]);
    }

    /**
     * Initialize BoardJuice for reactive board motion
     * Targets .player-board-section so the entire board frame moves as a unit
     * (canvas is inside overflow:hidden containers, so transforms on it get clipped)
     * @private
     */
    _initBoardJuice() {
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        // Target the board section — parent of the overflow:hidden containers
        const container = document.getElementById('phaser-game-container');
        const boardSection = container?.closest('.player-board-section');
        if (boardSection) {
            this.boardJuice = new BoardJuice(boardSection);
        } else {
            console.warn('[SinglePlayer] Could not find .player-board-section for BoardJuice');
        }
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
