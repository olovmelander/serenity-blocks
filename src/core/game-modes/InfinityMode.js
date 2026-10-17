import { BaseGameMode } from './BaseGameMode.js';
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
import { ComboTracker } from '../combo-tracker.js';
import { createBoardEffectHandlers } from './board-effect-callbacks.js';
import {
    GAME_MODES, COLS, ROWS, BLOCK_SIZE,
} from '../constants.js';
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
    expandGridIfNeeded, calculateTopRow, getGridStats, checkInfinityGameOver,
} from '../infinity-grid.js';
import {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
    projectInfinityPresentationCamera,
} from '../infinity-spawn-policy.js';
import { maintainInfinitySimulation } from '../infinity-simulation-maintenance.js';
import { updateStats } from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import { InfinityHUD } from '../../ui/infinity/InfinityHUD.js';
import { InfinityAscent } from '../../ui/infinity/ascent/infinity-ascent.js';
import { installLegacyBoardJuiceInputWrapper } from '../../ui/infinity/legacy-board-juice-input-wrapper.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    emitLineClear, emitCombo, emitPieceLock, emitPerfectClear, emitTSpin, emitB2B,
    emitHardDrop,
} from '../../events/gameplay-events.js';
import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';
import {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
} from '../demo/DemoRecorder.js';
import { readFlag } from '../flags.js';
import {
    createSinglePlayerFixedInputBinding,
    createSinglePlayerFixedTickRuntime,
    ownsSinglePlayerFixedTickRuntime,
    runSinglePlayerFixedTicks,
    startSinglePlayerFixedTickRuntime,
    stopSinglePlayerFixedTickRuntime,
} from './single-player-fixed-tick.js';
import {
    applyFixedHardDropHitStop,
    applyFixedLineImpactHitStop,
    applyFixedPerfectClearHitStop,
} from '../fixed-hit-stop-policy.js';
import { INPUT_DISPOSITIONS } from '../simulation-tick.js';
import { canWriteLegacySimulationResults } from './single-player-result-compatibility.js';
import { saveRunScore } from '../progression/run-score.js';
import { bindLegacySessionRng, generateSessionSeed } from '../session-rng.js';

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

        // Exploration: looking around the tower (the wheel, the right stick, the tower map). The
        // ascent director (src/ui/infinity/ascent/) owns the motion, the world and the senses;
        // the mode owns the pause it asks for.
        this.isInExplorationMode = false;
        this.explorationStartCameraRow = 0;
        this.ascent = null;

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

        this._explorationSession = null;
        this._explorationOwnsPause = false;
        this._explorationTransitionGeneration = 0;
        this._cameraSnapGeneration = 0;

        // Cache physics callbacks so input handlers can reuse them
        this.physicsCallbacks = null;
        this.usingHybridLoop = false;

        // Default-off canonical clock. FrameRateController remains the sole
        // wall-time owner; this runtime fences one Infinity session.
        this._fixedTickEnabled = false;
        this._fixedTickRuntime = createSinglePlayerFixedTickRuntime();
        this._fixedTickOwnership = null;
        this._fixedTickInputBinding = null;
        this._lastFixedTickClockWarp = null;

        // Legacy window input decoration is session-owned. Fixed input bypasses
        // these globals entirely and writes through the canonical dispatcher.
        this._legacyBoardJuiceInputOwner = null;

        // True consecutive-clear combo (physics' triggerCombo is cascade depth).
        this._comboTracker = new ComboTracker();

        // One immutable session owns every async stop/result continuation. The
        // clock identity is latched so experimental clocks fail closed.
        this._sessionSimulationClock = DEMO_LEGACY_SIMULATION_CLOCK;
        this._sessionGeneration = 0;
        this._activeSession = null;
        this._stoppedSession = null;
        this._stopPromise = null;
        this.isProcessingGameOver = false;
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
    async onStart(options = {}) {
        // BaseGameMode exposes isRunning=false before an async Infinity teardown
        // has drained physics. A replacement state cannot publish until that
        // exact captured stop transaction completes.
        const pendingStop = this._stopPromise;
        if (pendingStop) {
            await pendingStop;
        }

        if (this.isRunning) {
            await super.onStart();
            return;
        }

        await super.onStart();

        // Deactivation can win the microtask boundary inside BaseGameMode.
        // In that case its stop owns the base running flag and this start must
        // not construct a state after the mode has retired.
        if (!this.isActive || !this.isRunning) {
            return;
        }

        console.log('[Infinity] Starting Infinity mode...');

        const settings = this.deps.settingsManager.get();
        const flagRequestedFixedTick = options.simulationClock === undefined
            && readFlag('fixedTick', false);
        this._fixedTickEnabled = flagRequestedFixedTick;
        if (this._fixedTickEnabled && !this.deps.frameRateController?.startHybridLoop) {
            console.warn('[Infinity] fixedTick requires FrameRateController; using legacy loop');
            this._fixedTickEnabled = false;
        }
        if (options.simulationClock === undefined) {
            this._sessionSimulationClock = this._fixedTickEnabled
                ? DEMO_FIXED_SIMULATION_CLOCK
                : DEMO_LEGACY_SIMULATION_CLOCK;
        } else {
            this._sessionSimulationClock = options.simulationClock;
        }
        const usesFixedRules = this._sessionSimulationClock === DEMO_FIXED_SIMULATION_CLOCK;

        // Initialize game state with infinity mode options
        this.gameState = new GameState({
            isInfinityMode: true,
            maxRows: this.maxRows,
            disableLevelProgression: true, // Option A from plan: Fixed speed
            disableGarbage: true, // No garbage in infinity mode
            initialInfinityRows: 44,
            ...(this._fixedTickEnabled ? {
                infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
                infinityVisibleRows: this.visibleRows,
                inputHandling: settings,
            } : {}),
            ...(usesFixedRules ? {
                hitStopEnabled: !this._prefersReducedMotion(settings),
            } : {}),
        });
        const rngDescriptor = usesFixedRules
            ? bindLegacySessionRng(
                this.gameState,
                options.seed === undefined ? generateSessionSeed() : options.seed,
            )
            : null;
        const sessionGeneration = ++this._sessionGeneration;
        this._activeSession = Object.freeze({
            generation: sessionGeneration,
            gameState: this.gameState,
            rngDescriptor,
            simulationClock: this._sessionSimulationClock,
        });
        this._stoppedSession = null;
        this.isProcessingGameOver = false;

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
        const sessionState = this.gameState;
        spawnPiece(
            sessionState,
            () => {
                if (
                    this._activeSession?.generation !== sessionGeneration
                    || this._activeSession.gameState !== sessionState
                ) return;
                this._refreshNextQueue(sessionState);
            },
            () => this._handleGameOver(sessionGeneration),
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
        console.log('[Infinity] Minimap initialized');

        // Initialize height HUD
        this.heightHUD = new InfinityHUD();
        this.heightHUD.show();
        console.log('[Infinity] HUD initialized');

        // Start game loop
        this._startGameLoop();

        // Initialize BoardJuice for reactive board motion
        this._initBoardJuice();

        // Fixed input is applied directly at tick boundaries. Preserve the
        // established global decoration only for the flag-off legacy path.
        if (this.boardJuice && !this._fixedTickEnabled) {
            this._installLegacyBoardJuiceInputWrappers();
        }

        // Looking around the tower: the wheel, the right stick and the tower map.
        this._startAscent();

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
        const explorationOwnsThisPause = options.owner === 'infinity-exploration'
            && options.session === this._explorationSession;
        if (this.isInExplorationMode && !explorationOwnsThisPause) {
            // A settings/modal pause layered over exploration must outlive the
            // R3/scroll release that ends exploration.
            this._explorationOwnsPause = false;
        }
        super.onPause();
        this._fixedTickInputBinding?.clear();
        console.log('[Infinity] Game paused');

        // Trigger minimap pause highlight effect (only if not in exploration mode)
        if (this.minimap && !this.isInExplorationMode) {
            this.minimap.onPause();
        }
    }

    /**
     * Called when game is resumed
     */
    onResume(options = {}) {
        const explorationOwnsThisResume = options.owner === 'infinity-exploration'
            && options.session === this._explorationSession;
        if (this.isInExplorationMode && !explorationOwnsThisResume) {
            // External resume wins the pause stack. Retire manual camera/effect
            // ownership before the simulation becomes live again.
            this._endExploration({ resumeMode: false });
        }
        super.onResume();

        if (
            this._fixedTickEnabled
            && this.gameState
            && ownsSinglePlayerFixedTickRuntime(
                this._fixedTickRuntime,
                this._fixedTickOwnership,
            )
        ) {
            // The canonical clock remains in simulation-time space; paused
            // wall time is discarded by FrameRateController's reanchor.
            this.gameState.lastTime = this.gameState.simTimeMs;
        }
        console.log('[Infinity] Game resumed');

        // Reset exploration mode flag if somehow still set
        this.isInExplorationMode = false;
        this._explorationSession = null;
        this._explorationOwnsPause = false;

        // Trigger minimap unpause effect
        if (this.minimap) {
            this.minimap.onUnpause();
        }
    }

    /**
     * Enter exploration (the ascent's pull gave way, or the tower map was pressed) through the
     * mode pause template so the hybrid timer, simulation state, and future fixed input binding
     * share one owner. Async for its callers; it settles at once.
     * @returns {Promise<boolean>}
     * @private
     */
    async _beginExploration() {
        const session = this._activeSession;
        const gameState = session?.gameState;
        if (
            !session
            || !gameState
            || !this.isRunning
            || gameState.isPaused
            || gameState.isGameOver
            || gameState.isStopped
            || this.isInExplorationMode
        ) {
            return false;
        }

        console.log('[Infinity] Exploration started - pausing game');
        this._explorationTransitionGeneration += 1;
        this._explorationSession = session;
        this._explorationOwnsPause = true;
        this.explorationStartCameraRow = this.boardScene?.cameraSettings?.currentTopRow ?? 0;
        this.isInExplorationMode = true;

        this.onPause({ owner: 'infinity-exploration', session });
        this.boardScene?.enableManualCameraControl?.();
        this.minimap?.onPause?.();
        return true;
    }

    /**
     * Leave exploration for a menu opened over it (Escape): the camera goes home and the game
     * stays paused under the menu, whose own resume ends the pause.
     * @returns {boolean}
     */
    endExplorationForMenu() {
        if (!this.isInExplorationMode) return false;
        if (this.minimap) {
            this.minimap.isExploring = false;
            this.minimap.isDragging = false;
        }
        return this._endExploration({ resumeMode: false });
    }

    /**
     * Leave exploration through the matching resume template. Camera easing is
     * presentation-only and its delayed restore cannot target a replacement
     * scene or a later exploration transition.
     * @param {{resumeMode?: boolean}} [options]
     * @returns {boolean}
     * @private
     */
    _endExploration(options = {}) {
        const session = this._explorationSession;
        if (
            !session
            || !this.isInExplorationMode
            || this._activeSession !== session
            || this.gameState !== session.gameState
        ) {
            return false;
        }

        console.log('[Infinity] Exploration ended - resuming game');
        const shouldResumeMode = options.resumeMode !== false && this._explorationOwnsPause;
        this.isInExplorationMode = false;
        this._explorationOwnsPause = false;
        const transitionGeneration = ++this._explorationTransitionGeneration;
        this.ascent?.onExplorationEnded();

        const pieceTargetRow = this._calculatePieceCameraPosition();
        const returnScene = this.boardScene;
        if (returnScene) {
            returnScene.disableManualCameraControl();
            const originalLerpSpeed = returnScene.cameraSettings?.lerpSpeed || 0.08;
            if (returnScene.cameraSettings) {
                returnScene.cameraSettings.lerpSpeed = 0.15;
            }
            returnScene.updateCameraPosition(pieceTargetRow);
            setTimeout(() => {
                if (
                    this._activeSession === session
                    && this.boardScene === returnScene
                    && this._explorationTransitionGeneration === transitionGeneration
                    && !this.isInExplorationMode
                    && returnScene.cameraSettings
                ) {
                    returnScene.cameraSettings.lerpSpeed = originalLerpSpeed;
                }
            }, 400);
        }

        if (shouldResumeMode) {
            this.onResume({ owner: 'infinity-exploration', session });
        } else {
            this._explorationSession = null;
        }
        return true;
    }

    /**
     * Start the ascent director for this session: it moves the camera while the player looks
     * around and asks the mode for the pause.
     * @private
     */
    _startAscent() {
        if (!this._activeSession) return;
        if (!this.ascent) {
            // One director for the mode; every callback reads the live session.
            this.ascent = new InfinityAscent({
                getBoardScene: () => this.boardScene,
                getGameState: () => this.gameState,
                getMinimap: () => this.minimap,
                getBoardJuice: () => this.boardJuice,
                isRunning: () => this.isRunning && Boolean(this.gameState) && !this.gameState.isGameOver,
                isExternallyPaused: () => this.isPaused && !this.isInExplorationMode,
                isExploring: () => this.isInExplorationMode,
                beginExploration: () => this._beginExploration(),
                endExploration: () => this._endExploration(),
                homeTop: () => this._calculatePieceCameraPosition(),
                summitRow: () => this._findHighestBlockRow(),
                updateMinimapView: (top) => this._updateMinimapView(top),
                settings: () => this.deps.settingsManager?.get?.() || {},
                soundManager: this.deps.soundManager,
                themeManager: this.deps.themeManager,
                gamepadController: this.deps.gamepadController,
            });
        }
        this.ascent.start();
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

            // onStart awaits BaseGameMode before publishing its active bundle.
            // Deactivation in that narrow window still has to retire the base
            // running flag instead of leaving a zombie mode.
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
        // BaseGameMode has no await today, so this retires the public running
        // flag synchronously. The captured transaction still joins its promise.
        const baseStopPromise = super.onStop();
        const completion = this._stopCapturedSession(session, baseStopPromise);
        const trackedStop = completion
            .then((stoppedSession) => {
                if (this._activeSession === session) {
                    this._activeSession = null;
                    this._stoppedSession = stoppedSession;
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
     * Stop one exact Infinity session without consulting replacement state.
     * @param {Readonly<{
     *   generation: number,
     *   gameState: GameState,
     *   simulationClock: unknown,
     *   rngDescriptor: Object|null
     * }>} session
     * @param {Promise<void>} baseStopPromise
     * @returns {Promise<Readonly<{
     *   generation: number,
     *   gameState: GameState,
     *   simulationClock: unknown,
     *   rngDescriptor: Object|null
     * }>>}
     * @private
     */
    async _stopCapturedSession(session, baseStopPromise) {
        const {
            gameState, generation, rngDescriptor, simulationClock,
        } = session;

        console.log('[Infinity] Stopping game...');

        // Invalidate simulation ownership before the first await. Never read
        // this.gameState inside the remainder of this transaction.
        gameState.isGameOver = true;
        gameState.isStopped = true;
        this._stopGameLoop(gameState);
        this._fixedTickEnabled = false;

        // Reset exploration state while the captured UI still owns the mode.
        this.isInExplorationMode = false;
        this._explorationSession = null;
        this._explorationOwnsPause = false;
        this._explorationTransitionGeneration += 1;
        this._cleanupEventListeners(this.cleanupHandlers);
        this.ascent?.stop();
        this._cameraSnapGeneration += 1;
        this._restoreLegacyBoardJuiceInputWrappers();

        await baseStopPromise;

        const physicsPromise = gameState.latestPhysicsPromise;
        if (physicsPromise) {
            try {
                await physicsPromise;
            } catch (error) {
                console.warn('[Infinity] In-flight physics rejected during stop:', error);
            } finally {
                gameState.latestPhysicsPromise = null;
                gameState.isProcessingPhysics = false;
            }
        }

        if (this.minimap) {
            this.minimap.destroy();
            this.minimap = null;
        }
        if (this.heightHUD) {
            this.heightHUD.destroy();
            this.heightHUD = null;
        }

        console.log('[Infinity] Game stopped');
        this.boardScene = null;

        return Object.freeze({
            generation,
            gameState,
            rngDescriptor,
            simulationClock,
        });
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        // Retire activation first so a start queued behind teardown cannot
        // publish a replacement while cleanup is in progress.
        this.isActive = false;
        const pendingStop = this._stopPromise
            || ((this._activeSession || this.isRunning) ? this.onStop() : null);
        if (pendingStop) {
            await pendingStop;
        }
        await super.onDeactivate();

        console.log('[Infinity] Deactivating mode...');

        this._stopFixedTickSession();
        this._fixedTickEnabled = false;

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);

        // The ascent: its listeners, its sky and its signal.
        this.ascent?.dispose();
        this.ascent = null;

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

        // Stop normally retires these synchronously; this is idempotent for a
        // partial start/deactivation path.
        this._restoreLegacyBoardJuiceInputWrappers();

        // Clean up BoardJuice
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        this.boardScene?.setWellStyle?.(false);
        this.boardScene = null;

        // Reset exploration mode
        this.isInExplorationMode = false;

        // Remove Infinity layout styling
        this._applyInfinityLayout(false);

        // Stop has drained every captured-state await before this reference is
        // cleared, so no teardown finally block can target a replacement/null.
        if (!this._activeSession) {
            this.gameState = null;
        }
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
            // The well: an open-top board between the HUD and the tower (keystone-solo.css).
            stage.dataset.board = 'well';
        } else {
            stage.classList.remove('infinity-mode-active');
            container.classList.remove('infinity-mode-active');
            delete stage.dataset.board;

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
        // Clear cached physics callbacks so they get recreated with fresh BoardScene references
        this.physicsCallbacks = null;
        if (!phaserGame?.scene) return;

        this.boardScene = phaserGame.scene.getScene('BoardScene');

        if (this.boardScene) {
            // The well's look: a coloured ghost (well-board-style.js).
            this.boardScene.setWellStyle?.(true);
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
        const session = this._activeSession;
        if (!session || this.gameState !== session.gameState) {
            console.warn('[Infinity] Cannot start game loop without game state');
            return;
        }
        const { gameState, generation } = session;
        const usesFixedLoop = this._fixedTickEnabled
            && session.simulationClock === DEMO_FIXED_SIMULATION_CLOCK;

        console.log('[Infinity] Starting game loop...');

        // Performance optimization: Throttle stats updates
        this.lastStatsUpdateTime = performance.now();
        this.statsUpdateInterval = 250; // Update stats every 250ms instead of every frame

        // Ensure no legacy RAF loop is still running
        if (gameState.animationId) {
            cancelAnimationFrame(gameState.animationId);
            gameState.animationId = null;
        }
        this._stopFixedTickSession();

        // Stop any existing hybrid loop from prior runs
        const { frameRateController } = this.deps;
        if (frameRateController?.isRunning) {
            frameRateController.stopHybridLoop();
        }

        const drawCallback = () => {
            if (!this.isRunning || this._activeSession !== session || this.gameState !== gameState) {
                return;
            }

            this._syncBoardSceneFromState();

            if (!usesFixedLoop) {
                gameState.currentTopRow = calculateTopRow(gameState);
                this._maybeExpandGrid();
            }

            if (this.boardScene?.cameraSettings && !this.boardScene.cameraSettings.manualControl) {
                this._updateCameraPosition();
            }

            this._updateMinimapView();

            if (!usesFixedLoop && !gameState.isGameOver && checkInfinityGameOver(gameState)) {
                console.log('[Infinity] Game over condition met');
                gameState.isGameOver = true;
                this._handleGameOver(generation);
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

        if (usesFixedLoop) {
            this.usingHybridLoop = true;
            console.log('[Infinity] Using canonical 60 Hz simulation clock');
            const ownership = this._startFixedTickSession(gameState);
            const inputBinding = this._fixedTickInputBinding;
            const ownsFixedSession = () => (
                this._fixedTickEnabled
                && this.isRunning
                && this._activeSession === session
                && this.gameState === gameState
                && ownsSinglePlayerFixedTickRuntime(this._fixedTickRuntime, ownership)
            );
            const sessionContinues = () => (
                ownsFixedSession()
                && !this.isPaused
                && gameState.isPaused !== true
                && gameState.isGameOver !== true
                && gameState.isStopped !== true
            );
            const commandContext = {
                session,
                gameState,
                playDropCallback,
                physicsCallbacks,
            };
            const logicUpdate = (_time, delta) => {
                runSinglePlayerFixedTicks(this._fixedTickRuntime, delta, {
                    ownership,
                    advanceInput: inputBinding?.advanceInput,
                    applyInput: (command) => this._applyFixedCommand(command, commandContext),
                    playDropCallback,
                    physicsCallbacks,
                    shouldContinue: sessionContinues,
                    onClockWarp: (clockWarp) => {
                        this._lastFixedTickClockWarp = clockWarp;
                        console.warn('[Infinity] Fixed simulation clock rebased:', clockWarp);
                    },
                    afterTick: () => {
                        // Async cascade replay owns pre-expansion row indices.
                        // The first stable canonical boundary performs the
                        // deferred Infinity maintenance exactly once.
                        if (gameState.isProcessingPhysics) return;
                        const maintenance = maintainInfinitySimulation(gameState);
                        if (maintenance.rowsAdded > 0) {
                            this._compensateCameraForGridExpansion(
                                maintenance.rowsAdded,
                                session,
                            );
                        }
                        if (maintenance.gameOverTransitioned) {
                            this._handleGameOver(generation);
                        }
                    },
                });
            };
            const renderUpdate = () => {
                if (!ownsFixedSession()) return;
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
            console.log('[Infinity] Game loop started');
            return;
        }

        if (frameRateController?.needsHybridMode()) {
            this.usingHybridLoop = true;
            console.log('[Infinity] Using hybrid loop for high FPS target');

            // Keep the two-argument FrameRateController callback contract.
            // eslint-disable-next-line no-unused-vars
            const logicUpdate = (time, delta) => {
                if (
                    this._activeSession !== session
                    || gameState.isGameOver
                    || gameState.isPaused
                ) return;

                updateGame(time, gameState, {
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
                gameState,
                drawCallback,
                statsCallback,
                playDropCallback,
                physicsCallbacks,
            );
        }

        console.log('[Infinity] Game loop started');
    }

    /**
     * Retire the timer owners for one captured GameState synchronously.
     * @param {GameState|null} gameState
     * @private
     */
    _stopGameLoop(gameState) {
        this._stopFixedTickSession();

        if (gameState?.animationId) {
            cancelAnimationFrame(gameState.animationId);
            gameState.animationId = null;
        }

        if (this.deps.frameRateController?.isRunning) {
            this.deps.frameRateController.stopHybridLoop();
        }
        this.usingHybridLoop = false;
    }

    _startFixedTickSession(gameState) {
        const ownership = startSinglePlayerFixedTickRuntime(
            this._fixedTickRuntime,
            gameState,
        );
        this._fixedTickOwnership = ownership;
        this._fixedTickInputBinding = createSinglePlayerFixedInputBinding({
            gameState,
            inputController: this.deps.inputController,
            gamepadController: this.deps.gamepadController,
            isEnabled: () => (
                this._fixedTickEnabled
                && this.isRunning
                && !this.isPaused
                && this.gameState === gameState
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

    _prefersReducedMotion(settings = this.deps.settingsManager?.get?.() || {}) {
        return Boolean(
            settings.reducedMotion
            || (typeof window !== 'undefined'
                && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
        );
    }

    /**
     * Apply one canonical Infinity command to one captured session. Movement
     * and rotation may use the existing post-cascade buffer; drop commands
     * never cross an active physics boundary.
     *
     * @param {InputCommand} command
     * @param {{
     *   session: Readonly<Object>,
     *   gameState: GameState,
     *   playDropCallback: Function,
     *   physicsCallbacks: Object,
     * }} context
     * @returns {InputDisposition}
     * @private
     */
    _applyFixedCommand(command, context) {
        const {
            session, gameState, playDropCallback, physicsCallbacks,
        } = context;
        if (
            !this._fixedTickEnabled
            || !this.isRunning
            || this.isPaused
            || this._activeSession !== session
            || this.gameState !== gameState
            || gameState.isPaused
            || gameState.isGameOver
            || gameState.isStopped
        ) {
            return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
        }
        if (gameState.hitStopRemaining > 0 || gameState.hitStopTicks > 0) {
            return INPUT_DISPOSITIONS.REJECTED_HIT_STOP;
        }

        const { action, value } = command;
        if (gameState.isProcessingPhysics) {
            if (action !== 'move' && action !== 'rotate') {
                return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
            }
            const queued = { type: action, dir: value };
            if (Array.isArray(gameState.inputQueue)) {
                if (gameState.inputQueue.length >= 4) {
                    return INPUT_DISPOSITIONS.REJECTED_PHYSICS;
                }
                gameState.inputQueue.push(queued);
            } else if (gameState.inputQueue) {
                gameState.inputQueue = [gameState.inputQueue, queued].slice(0, 4);
            } else {
                gameState.inputQueue = queued;
            }
            return INPUT_DISPOSITIONS.DEFERRED_PHYSICS;
        }

        const sfxPlayer = this.deps.soundManager?.sfxPlayer;
        const moveSound = () => sfxPlayer?.playMove?.();
        const rotateSound = () => sfxPlayer?.playRotate?.();
        const addTrailCallback = () => {};
        let accepted = false;

        if (action === 'move') {
            accepted = coreMove(gameState, value, moveSound, addTrailCallback);
            if (this.boardJuice) {
                if (accepted) {
                    this.boardJuice.nudge(value * 1.5, 0);
                    this.boardJuice.tilt(value * 0.4);
                } else {
                    this.boardJuice.nudge(value * 0.8, 0);
                }
            }
        } else if (action === 'rotate') {
            accepted = coreRotate(gameState, value, rotateSound, addTrailCallback);
            if (accepted && this.boardJuice) {
                this.boardJuice.tilt(value === 'left' ? -0.3 : 0.3);
            }
        } else if (action === 'hardDrop') {
            accepted = coreHardDrop(
                gameState,
                playDropCallback,
                physicsCallbacks,
                { fixedTick: true, inputPhase: true },
            );
        } else if (action === 'softDrop') {
            const beforeProcessing = gameState.isProcessingPhysics;
            const beforePiece = gameState.currentPiece;
            const moved = coreSoftDrop(
                gameState,
                playDropCallback,
                physicsCallbacks,
                { fixedTick: true, inputPhase: true },
            );
            accepted = Boolean(moved)
                || (!beforeProcessing && gameState.isProcessingPhysics)
                || (beforePiece && beforePiece !== gameState.currentPiece);
        }

        return accepted
            ? INPUT_DISPOSITIONS.APPLIED
            : INPUT_DISPOSITIONS.REJECTED_PHYSICS;
    }

    /**
     * Shift presentation camera rows after simulation adds rows above the
     * existing Infinity board. This never writes simulation camera truth.
     * @param {number} rowsAdded
     * @param {Readonly<Object>} [session]
     * @returns {boolean}
     * @private
     */
    _compensateCameraForGridExpansion(rowsAdded, session = this._activeSession) {
        const { boardScene } = this;
        if (
            !Number.isInteger(rowsAdded)
            || rowsAdded <= 0
            || !session
            || this._activeSession !== session
            || this.gameState !== session.gameState
            || !boardScene?.cameraSettings
        ) {
            return false;
        }

        const { cameraSettings } = boardScene;
        const oldCameraRow = cameraSettings.currentTopRow || 0;
        const oldTargetRow = cameraSettings.targetTopRow || 0;
        const newCameraRow = oldCameraRow + rowsAdded;
        const newTargetRow = oldTargetRow + rowsAdded;

        boardScene.updateCameraBounds();
        cameraSettings.currentTopRow = newCameraRow;
        cameraSettings.activeTopRow = newCameraRow;
        cameraSettings.targetTopRow = newTargetRow;

        const blockSize = boardScene.boardConfig?.blockSize || 30;
        const { visibleRows } = cameraSettings;
        const centerY = newCameraRow * blockSize + (visibleRows * blockSize) / 2;
        const { width } = boardScene.getBoardDimensions();
        boardScene.cameras.main.centerOn(width / 2, centerY);
        console.log(
            '[Infinity] Camera smoothly adjusted for grid expansion:',
            oldCameraRow,
            '→',
            newCameraRow,
        );
        return true;
    }

    _maybeExpandGrid() {
        if (!this.boardScene || !this.boardScene.cameraSettings) return;
        if (this.boardScene.cameraSettings.manualControl) return;
        if (!this.gameState || !this.gameState.board) return;
        if (this.gameState.board.length >= this.gameState.maxRows) return;
        // An in-flight cascade owns pre-expansion row indices: its full-line list
        // and gravity grid were captured before the clear animation. Expanding now
        // shifts every piece down by the added rows underneath it, so it deletes the
        // wrong row and then clears the real one as a phantom extra wave. The draw
        // callback runs every frame; the first one after the cascade settles expands.
        // (The fixed-tick path defers the same way in afterTick.)
        if (this.gameState.isProcessingPhysics) return;

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

        if (expandGridIfNeeded(this.gameState, requiredRows)) {
            const rowsAdded = this.gameState.board.length - currentSize;
            console.log('[Infinity] Grid expanded:', currentSize, '→', this.gameState.board.length, 'rows');
            console.log('[Infinity] Rows added at top:', rowsAdded);

            this._compensateCameraForGridExpansion(rowsAdded);

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

        const callbackSession = this._activeSession;
        const callbackState = callbackSession?.gameState || null;
        const callbackGeneration = callbackSession?.generation;
        const usesFixedTiming = callbackSession?.simulationClock === DEMO_FIXED_SIMULATION_CLOCK;
        const ownsCallbackSession = () => Boolean(
            callbackSession
            && this._activeSession === callbackSession
            && this.gameState === callbackState,
        );

        // One session = one combo chain.
        this._comboTracker.reset();

        // Shared four-beat visual wiring — identical to local MP / SP / Odyssey.
        // Infinity wraps each beat with its own session guard and camera work.
        const effectHandlers = createBoardEffectHandlers({
            getScene: () => this._getBoardScene(),
            getJuice: () => this.boardJuice,
            comboTracker: this._comboTracker,
        });

        this.physicsCallbacks = {
            onMove: () => {
                if (ownsCallbackSession()) {
                    this.deps.soundManager.sfxPlayer.playMove();
                }
            },
            onRotate: () => {
                if (ownsCallbackSession()) {
                    this.deps.soundManager.sfxPlayer.playRotate();
                }
            },
            onLineClear: (lineCount, ...rest) => {
                if (!ownsCallbackSession()) return;
                const clearedRows = Array.isArray(rest[2]) ? rest[2] : [];
                const cascadeCount = rest[3] ?? 1;
                // Play sound effects
                this.deps.soundManager.sfxPlayer.playLineClear(cascadeCount);

                // Emit event for theme reactions. Pass the ON-SCREEN clear origin so theme
                // clear effects track the scrolling viewport instead of pinning to the bottom
                // (clearedRows are absolute rows in Infinity's tall grid).
                emitLineClear({
                    lineCount,
                    clearedRows,
                    cascadeCount,
                    viewportOrigin: this._lineClearViewportOrigin(clearedRows),
                });

                // Track combo stats for infinity mode
                if (callbackState.infinityStats && callbackState.comboState) {
                    const comboDepth = callbackState.comboState.depth || 0;
                    const comboComplexity = callbackState.comboState.complexity || 0;

                    // Update max combo depth
                    if (comboDepth > callbackState.infinityStats.maxComboDepth) {
                        callbackState.infinityStats.maxComboDepth = comboDepth;
                    }

                    // Update max combo complexity
                    if (comboComplexity > callbackState.infinityStats.maxComboComplexity) {
                        callbackState.infinityStats.maxComboComplexity = comboComplexity;
                    }

                    console.log(`[Infinity] Line clear: depth=${comboDepth}, complexity=${comboComplexity}, maxDepth=${callbackState.infinityStats.maxComboDepth}, maxComplexity=${callbackState.infinityStats.maxComboComplexity}`);
                }
            },
            onTSpin: (lineCount) => {
                if (!ownsCallbackSession()) return;
                emitTSpin({ lineCount, source: 'infinity' });
                this.deps.soundManager.sfxPlayer.playTSpin?.();
                const boardScene = this._getBoardScene();
                if (boardScene?.sharedEffects?.playTSpinEffect) {
                    boardScene.sharedEffects.playTSpinEffect(lineCount);
                }
            },
            onB2B: () => {
                if (!ownsCallbackSession()) return;
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
                if (!ownsCallbackSession()) return;
                emitHardDrop({
                    piece: dropData?.piece || null,
                    startY: dropData?.startY,
                    endY: dropData?.endY,
                    viewportOrigin: this._pieceLockViewportOrigin(dropData?.piece),
                    source: 'infinity',
                });
                if (usesFixedTiming) {
                    applyFixedHardDropHitStop(callbackState);
                } else {
                    const settings = this.deps.settingsManager?.get() || {};
                    const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                    if (!prefersReducedMotion) {
                        callbackState.hitStopRemaining = Math.max(callbackState.hitStopRemaining || 0, 30);
                    }
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

                // Board juice: dip + bounce on hard drop (MP's weight)
                if (this.boardJuice) {
                    this.boardJuice.dip(4);
                    this.boardJuice.bounce();
                }
            },
            // Combo popup, local-MP semantics: the number is cascade depth.
            triggerCombo: (comboCount) => {
                if (!ownsCallbackSession()) return;
                effectHandlers.comboBeat(comboCount);
                emitCombo({ comboCount });

                // Track max combo (Steam best_cascade feeds off this)
                if (callbackState.infinityStats && comboCount > callbackState.infinityStats.maxCombo) {
                    callbackState.infinityStats.maxCombo = comboCount;
                }
            },
            // The board's own callout (SharedEffects) counts the chain.
            triggerCascadeWave: (cascadeCount) => {
                if (!ownsCallbackSession()) return;
                effectHandlers.cascadeWaveBeat(cascadeCount);
            },
            // Line clear flash effect
            triggerFlash: (fullLines) => {
                if (!ownsCallbackSession()) return;
                console.log('[Infinity] triggerFlash called with fullLines:', fullLines);

                // Store cleared line positions for camera following
                this.lastClearedLines = fullLines;
                if (fullLines && fullLines.length > 0) {
                    // Calculate center of cleared lines for camera targeting
                    const minRow = Math.min(...fullLines);
                    const maxRow = Math.max(...fullLines);
                    this.lastClearedLinesCenter = (minRow + maxRow) / 2;
                }

                effectHandlers.clearFlashBeat(fullLines);
            },
            // Line clear impact (camera shake and particles)
            onLineClearImpact: (lineCount, cascadeCount) => {
                if (!ownsCallbackSession()) return;
                if (usesFixedTiming) {
                    applyFixedLineImpactHitStop(callbackState, lineCount);
                } else {
                    const settings = this.deps.settingsManager?.get() || {};
                    const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                    if (!prefersReducedMotion) {
                        const timingScene = this._getBoardScene();
                        let hitStop = 0;
                        if (timingScene?.sharedEffects) {
                            const tier = timingScene.sharedEffects.getClearTier(lineCount);
                            hitStop = tier?.hitStop || 0;
                        } else if (lineCount >= 4) {
                            hitStop = 70;
                        }
                        if (hitStop > 0) {
                            callbackState.hitStopRemaining = hitStop;
                        }
                    }
                }

                effectHandlers.clearImpactBeat(lineCount, cascadeCount);
            },
            // Parity with local MP: no background pulse. Key kept for shape.
            triggerBackgroundPulse: () => {},
            // Score addition animation
            onScoreAdd: (points) => {
                if (!ownsCallbackSession()) return;
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.showScorePopup) {
                    boardScene.showScorePopup(points);
                }
            },
            // Background update (keep level-based themes disabled for infinity mode)
            updateBackground: () => {
                // Infinity mode doesn't change backgrounds by level
            },
            // Piece lock ripple effect
            onPieceLock: (piece) => {
                if (!ownsCallbackSession()) return;
                // Emit event for theme reactions. Infinity scrolls a fixed camera window over
                // a tall grid, so pass the ON-SCREEN lock origin — otherwise theme lock effects
                // (e.g. Serenity Warp's Phase Seal) pin to the bottom, since piece.y is an
                // absolute row in a board that grows into the hundreds.
                emitPieceLock({ piece, viewportOrigin: this._pieceLockViewportOrigin(piece) });

                effectHandlers.lockBeat(piece);

                // Update infinity stats
                if (callbackState.infinityStats) {
                    callbackState.infinityStats.blocksPlaced += 4; // Approximate blocks per piece
                    // Track score at the start of cascade to calculate cascade score
                    callbackState.infinityStats._cascadeStartScore = callbackState.score;
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
                if (!ownsCallbackSession()) return;
                if (usesFixedTiming) {
                    applyFixedPerfectClearHitStop(callbackState);
                } else {
                    const settings = this.deps.settingsManager?.get() || {};
                    const prefersReducedMotion = settings.reducedMotion || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
                    if (!prefersReducedMotion) {
                        callbackState.hitStopRemaining = 110;
                    }
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
                if (!ownsCallbackSession()) return;
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
            // Update camera after cascade completes. No settle visual — parity
            // with local MP; the non-visual work (camera, stats) stays.
            onCascadeComplete: (cascadeCount) => {
                if (!ownsCallbackSession()) return;
                if (cascadeCount > 0) {
                    // Track cascade statistics for infinity mode
                    if (callbackState.infinityStats) {
                        // Calculate cascade score (points earned during this cascade sequence)
                        const startScore = callbackState.infinityStats._cascadeStartScore || 0;
                        const cascadeScore = callbackState.score - startScore;

                        // Update max cascade score if this is a new record
                        if (cascadeScore > callbackState.infinityStats.maxCascadeScore) {
                            callbackState.infinityStats.maxCascadeScore = cascadeScore;
                            console.log(`[Infinity] New max cascade score: ${cascadeScore} points`);
                        }

                        // Only count actual cascades (2+), not the initial clear
                        if (cascadeCount >= 2) {
                            callbackState.infinityStats.totalCascades++;
                        }
                        console.log(`[Infinity] Cascade completed: count=${cascadeCount}, score=${cascadeScore}, max=${callbackState.infinityStats.maxCascadeScore}`);
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
                if (!ownsCallbackSession()) return;
                spawnPiece(
                    callbackState,
                    () => {
                        if (ownsCallbackSession()) {
                            this._refreshNextQueue(callbackState);
                        }
                    },
                    () => this._handleGameOver(callbackGeneration),
                );
            },
            // Handle combo finalization (no garbage in infinity mode, but track combo stats)
            onGarbageReady: (summary) => {
                if (!ownsCallbackSession()) return;
                // Even though garbage is disabled in infinity mode, this callback is used
                // to finalize combo tracking and update stats
                if (callbackState.infinityStats && summary) {
                    const { depth, complexity } = summary;

                    // Update max combo depth
                    if (depth > callbackState.infinityStats.maxComboDepth) {
                        callbackState.infinityStats.maxComboDepth = depth;
                        console.log(`[Infinity] New max combo depth: ${depth} lines`);
                    }

                    // Update max combo complexity (cascade count)
                    if (complexity > callbackState.infinityStats.maxComboComplexity) {
                        callbackState.infinityStats.maxComboComplexity = complexity;
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
    _refreshNextQueue(gameState = this.gameState) {
        if (!gameState) return;
        updateNextQueue(gameState.nextPieces);
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

    /**
     * @param {number} [topRow] the rows on screen when the ascent moves the view; by default the
     *   camera's, plus the peek's presentation offset
     */
    _updateMinimapView(topRow) {
        if (!this.minimap || !this.boardScene?.cameraSettings) {
            return;
        }

        const { cameraSettings } = this.boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;

        // Minimap expects the TOP row of the viewport, not the center
        const cameraTopRow = Number.isFinite(topRow)
            ? topRow
            : (cameraSettings.currentTopRow || 0) + (cameraSettings.viewOffsetRows || 0);

        this.minimap.update(this.gameState, cameraTopRow, visibleRows);
    }

    /**
     * Handle game over
     * @private
     */
    async _handleGameOver(expectedGeneration = this._activeSession?.generation) {
        const activeSession = this._activeSession;
        if (!activeSession || activeSession.generation !== expectedGeneration) {
            return;
        }

        // Multiple Infinity paths can observe the terminal board during the
        // same frame. Only the first callback owns this generation's result.
        if (this.isProcessingGameOver) return;
        this.isProcessingGameOver = true;

        // The board dies before the results screen arrives over it: the death
        // plays out while the run is saved, and the results wait for the rest.
        const beatMs = this._getBoardScene()?.sharedEffects?.playGameOver?.();
        const deathBeat = beatMs > 0 ? new Promise((resolve) => { setTimeout(resolve, beatMs); }) : null;

        const resultState = activeSession.gameState;
        console.log('[Infinity] Game over!');

        // Log final stats from the captured generation, never replacement state.
        const stats = getGridStats(resultState);
        console.log('[Infinity] Final stats:', stats);
        console.log('[Infinity] Build height reached:', resultState.currentTopRow, 'rows from top');

        const stoppedSession = await this.onStop();
        if (!stoppedSession) {
            return;
        }
        const { gameState, simulationClock } = stoppedSession;
        const writesLegacyResults = canWriteLegacySimulationResults(simulationClock);

        let scoreSaved = true;
        if (writesLegacyResults) {
            // Save high score (using standard system for now). A storage failure still
            // shows the results, marked unsaved.
            // Records shows a run by its deepest cascade and its length (timed as on Steam).
            const runStart = gameState.infinityStats?.sessionStartTime || gameState.startTime || Date.now();
            scoreSaved = await saveRunScore(this.deps.highScoreManager, {
                score: gameState.score,
                lines: gameState.lines,
                level: gameState.level,
                mode: 'infinity', // Tag as infinity mode
                cascade: gameState.infinityStats?.maxComboDepth || 0,
                duration: Math.max(1, Math.round((Date.now() - runStart) / 1000)),
            }, '[Infinity]');

            // Sync Steam stats/leaderboards in the background (best-effort).
            this._syncSteamStats(stoppedSession).catch((err) => {
                console.warn('[Infinity] Steam stats sync failed:', err.message);
            });
        } else {
            console.info(
                '[Infinity] Experimental simulation clock; legacy score/stat writes skipped:',
                simulationClock,
            );
        }

        if (deathBeat) await deathBeat;
        if (!this._ownsStoppedSessionUi(stoppedSession)) {
            return;
        }

        // Show game over modal with stats/leaderboards. The modal rechecks the
        // predicate around its own awaits so a restart cannot publish stale UI.
        const { showGameOverModal } = await import('../../ui/modals.js');
        if (!this._ownsStoppedSessionUi(stoppedSession)) {
            return;
        }
        await showGameOverModal(
            this.deps.modalManager,
            gameState,
            this.deps.highScoreManager,
            {
                onMainMenu: () => {
                    if (!this._ownsStoppedSessionUi(stoppedSession)) {
                        return;
                    }
                    console.log('[Infinity] Main Menu - exiting to main menu');
                    eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
                },
            },
            {
                includeLegacyResults: writesLegacyResults,
                scoreSaved,
                shouldPresent: () => this._ownsStoppedSessionUi(stoppedSession),
            },
        );

        if (!this._ownsStoppedSessionUi(stoppedSession)) {
            return;
        }

        // Trigger game over event for the exact stopped generation.
        window.dispatchEvent(new CustomEvent('gameOver', {
            detail: {
                gameState,
                mode: 'infinity',
                infinityStats: gameState.infinityStats,
            },
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
     *   generation: number,
     *   gameState: GameState,
     *   simulationClock: unknown
     * }>|null} stoppedSession
     */
    async _syncSteamStats(stoppedSession) {
        const gameState = stoppedSession?.gameState;
        const simulationClock = stoppedSession?.simulationClock;
        if (!gameState || !canWriteLegacySimulationResults(simulationClock)) {
            return;
        }

        const startTime = gameState.infinityStats?.sessionStartTime || gameState.startTime || Date.now();
        const durationMs = Date.now() - startTime;
        const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
        const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

        const bestCascade = gameState.infinityStats?.maxComboDepth || 0;

        const scoreDetails = {
            score: gameState.score,
            duration: durationSeconds,
            linesCleared: gameState.lines,
            highestLevel: gameState.level,
            bestCascade,
            version: '1.0.0',
        };

        await Promise.all([
            steamService.uploadScore(STEAM_LEADERBOARDS.INFINITY_HIGH_SCORE, gameState.score, scoreDetails),
            steamService.uploadScore(STEAM_LEADERBOARDS.INFINITY_SURVIVAL_TIME, durationSeconds, scoreDetails),
            steamService.uploadScore(STEAM_LEADERBOARDS.INFINITY_BEST_CASCADE, bestCascade, scoreDetails),
            steamService.incrementStat('total_games_played', 1),
            steamService.incrementStat('total_lines_cleared', gameState.lines),
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
     * On-screen normalized origin (0 = top of the viewport, 1 = bottom / left → right) of a
     * locked piece, using the SAME camera transform the Phaser board draws with
     * (screenRowFraction = (row - activeTopRow) / visibleRows). Themes consume this via the
     * PIECE_LOCK payload so lock effects follow the scrolling window instead of the fixed
     * 10×20 board math. Returns undefined when camera/piece state is unavailable so the theme
     * falls back to its own normalization.
     * @private
     */
    _pieceLockViewportOrigin(piece) {
        const shape = piece?.shape;
        if (!Array.isArray(shape)
            || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) {
            return undefined;
        }
        let sumRow = 0;
        let sumCol = 0;
        let filled = 0;
        for (let r = 0; r < shape.length; r += 1) {
            const row = shape[r];
            if (!Array.isArray(row)) continue;
            for (let c = 0; c < row.length; c += 1) {
                if (row[c]) { sumRow += r; sumCol += c; filled += 1; }
            }
        }
        if (filled === 0) return undefined;

        const cameraSettings = this.boardScene?.cameraSettings;
        const visibleRows = cameraSettings?.visibleRows || this.visibleRows;
        if (!(visibleRows > 0)) return undefined;
        // Float top row (not floored) for exact alignment with the lerped camera centre.
        // Prefer activeTopRow (this frame's clamped value) → currentTopRow → gameState mirror.
        let topRow = this.gameState?.cameraRow ?? 0;
        if (Number.isFinite(cameraSettings?.currentTopRow)) topRow = cameraSettings.currentTopRow;
        if (Number.isFinite(cameraSettings?.activeTopRow)) topRow = cameraSettings.activeTopRow;

        const centroidRow = piece.y + sumRow / filled + 0.5;
        const centroidCol = piece.x + sumCol / filled + 0.5;
        return {
            x: Math.max(0, Math.min(1, centroidCol / COLS)),
            y: Math.max(0, Math.min(1, (centroidRow - topRow) / visibleRows)),
        };
    }

    /**
     * On-screen normalized origin of a set of cleared rows (full-width clears are horizontally
     * centered, so x=0.5). Uses the same camera-window transform as _pieceLockViewportOrigin so
     * theme clear effects follow the scrolling window. Returns undefined when camera/rows are
     * unavailable → theme falls back to its own row normalization.
     * @private
     */
    _lineClearViewportOrigin(clearedRows) {
        if (!Array.isArray(clearedRows) || clearedRows.length === 0) return undefined;
        let sum = 0;
        let count = 0;
        for (let i = 0; i < clearedRows.length; i += 1) {
            const row = clearedRows[i];
            if (Number.isFinite(row)) { sum += row; count += 1; }
        }
        if (count === 0) return undefined;

        const cameraSettings = this.boardScene?.cameraSettings;
        const visibleRows = cameraSettings?.visibleRows || this.visibleRows;
        if (!(visibleRows > 0)) return undefined;
        let topRow = this.gameState?.cameraRow ?? 0;
        if (Number.isFinite(cameraSettings?.currentTopRow)) topRow = cameraSettings.currentTopRow;
        if (Number.isFinite(cameraSettings?.activeTopRow)) topRow = cameraSettings.activeTopRow;

        const meanRow = sum / count + 0.5;
        return {
            x: 0.5,
            y: Math.max(0, Math.min(1, (meanRow - topRow) / visibleRows)),
        };
    }

    /**
     * Quickly snap camera back to the top area after locking a soft-dropped piece
     * @private
     */
    _snapCameraToTopArea() {
        const session = this._activeSession;
        const gameState = session?.gameState;
        const { boardScene } = this;
        if (!session || !gameState || !boardScene?.cameraSettings) return;

        const { cameraSettings } = boardScene;
        const visibleRows = cameraSettings.visibleRows || this.visibleRows;
        const highestBlockRow = this._findHighestBlockRow();

        let targetTopRow;

        if (highestBlockRow >= gameState.board.length) {
            targetTopRow = Math.max(0, gameState.board.length - visibleRows);
        } else {
            const preferredRow = highestBlockRow - Math.floor(visibleRows * 0.2);
            const maxCameraRow = Math.max(0, gameState.board.length - visibleRows);
            targetTopRow = Math.max(0, Math.min(maxCameraRow, preferredRow));
        }

        // Use fast lerp instead of instant jump for smoother feel
        const originalLerpSpeed = cameraSettings.lerpSpeed || 0.08;
        const snapGeneration = ++this._cameraSnapGeneration;
        cameraSettings.lerpSpeed = 0.25;
        boardScene.updateCameraPosition(targetTopRow);
        setTimeout(() => {
            if (
                this._activeSession === session
                && this.gameState === gameState
                && this.boardScene === boardScene
                && this._cameraSnapGeneration === snapGeneration
                && boardScene.cameraSettings === cameraSettings
            ) {
                cameraSettings.lerpSpeed = originalLerpSpeed;
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
        projectInfinityPresentationCamera(this.gameState, targetCameraRow);

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
        projectInfinityPresentationCamera(this.gameState, clampedCameraRow);
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
        projectInfinityPresentationCamera(this.gameState, clampedCameraRow);

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
     * Decorate the legacy global movement entry points for BoardJuice without
     * letting a stopped generation wrap a replacement owner.
     * @private
     */
    _installLegacyBoardJuiceInputWrappers() {
        if (!this.boardJuice) return;
        this._restoreLegacyBoardJuiceInputWrappers();

        const session = this._activeSession;
        const gameState = session?.gameState;
        if (!session || !gameState) return;
        this._legacyBoardJuiceInputOwner = installLegacyBoardJuiceInputWrapper({
            gameState,
            juice: this.boardJuice,
            isActive: () => (
                this._activeSession === session
                && this.gameState === gameState
                && this.isRunning
            ),
        });
    }

    /** @private */
    _restoreLegacyBoardJuiceInputWrappers() {
        this._legacyBoardJuiceInputOwner?.dispose();
        this._legacyBoardJuiceInputOwner = null;
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
}
