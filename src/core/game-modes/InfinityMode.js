import { BaseGameMode } from './BaseGameMode.js';
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
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
import {
    updateStats,
    triggerLineClearFlash as triggerLineClearFlashCanvas,
    triggerBackgroundPulse as triggerBackgroundPulseCanvas,
} from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import { InfinityHUD } from '../../ui/infinity/InfinityHUD.js';
import { installLegacyBoardJuiceInputWrapper } from '../../ui/infinity/legacy-board-juice-input-wrapper.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    emitLineClear, emitCombo, emitPieceLock, emitPerfectClear, emitTSpin, emitB2B,
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
import { normalizeWheelDeltaToPixels, shouldCaptureWheelEvent } from '../../utils/wheel-routing.js';
import { canWriteLegacySimulationResults } from './single-player-result-compatibility.js';

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
        const sessionGeneration = ++this._sessionGeneration;
        this._activeSession = Object.freeze({
            generation: sessionGeneration,
            gameState: this.gameState,
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

        // Setup minimap exploration event handlers
        this.minimap.container.addEventListener('minimap-exploration-start', () => {
            this._beginMinimapExploration();
        });

        this.minimap.container.addEventListener('minimap-exploration-end', () => {
            this._endMinimapExploration();
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

        // Fixed input is applied directly at tick boundaries. Preserve the
        // established global decoration only for the flag-off legacy path.
        if (this.boardJuice && !this._fixedTickEnabled) {
            this._installLegacyBoardJuiceInputWrappers();
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
            this._endMinimapExploration({ resumeMode: false });
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
        this._cleanupScrollState();

        // Trigger minimap unpause effect
        if (this.minimap) {
            this.minimap.onUnpause();
        }
    }

    /**
     * Enter minimap exploration through the mode pause template so the hybrid
     * timer, simulation state, and future fixed input binding share one owner.
     * The lazy effect import is fenced against end/stop/restart.
     * @returns {Promise<boolean>}
     * @private
     */
    async _beginMinimapExploration() {
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

        console.log('[Infinity] Minimap exploration started - pausing game');
        const transitionGeneration = ++this._explorationTransitionGeneration;
        this._explorationSession = session;
        this._explorationOwnsPause = true;
        this.explorationStartCameraRow = this.boardScene?.cameraSettings?.currentTopRow ?? 0;
        this.isInExplorationMode = true;
        this._lastExplorationTime = performance.now();

        this.onPause({ owner: 'infinity-exploration', session });
        this.boardScene?.enableManualCameraControl?.();
        this.minimap?.onPause?.();

        const stillOwnsExploration = () => (
            this._activeSession === session
            && this.gameState === gameState
            && this._explorationSession === session
            && this._explorationTransitionGeneration === transitionGeneration
            && this.isInExplorationMode
        );

        if (!this.cosmicExploration) {
            try {
                const { CosmicExplorationEffect } = await import('../../ui/effects/CosmicExplorationEffect.js');
                if (!stillOwnsExploration()) return false;
                this.cosmicExploration = new CosmicExplorationEffect({
                    quality: this.deps.settingsManager.get('graphicsQuality') || 'High',
                    gameState,
                });
            } catch (err) {
                console.error('[Infinity] Failed to load cosmic exploration effect:', err);
            }
        }
        if (stillOwnsExploration()) {
            this.cosmicExploration?.start?.();
            return true;
        }
        return false;
    }

    /**
     * Leave exploration through the matching resume template. Camera easing is
     * presentation-only and its delayed restore cannot target a replacement
     * scene or a later exploration transition.
     * @param {{resumeMode?: boolean}} [options]
     * @returns {boolean}
     * @private
     */
    _endMinimapExploration(options = {}) {
        const session = this._explorationSession;
        if (
            !session
            || !this.isInExplorationMode
            || this._activeSession !== session
            || this.gameState !== session.gameState
        ) {
            return false;
        }

        console.log('[Infinity] Minimap exploration ended - resuming game');
        const shouldResumeMode = options.resumeMode !== false && this._explorationOwnsPause;
        this.isInExplorationMode = false;
        this._explorationOwnsPause = false;
        const transitionGeneration = ++this._explorationTransitionGeneration;
        this.cosmicExploration?.stop?.();

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
            this._cleanupScrollState();
        }
        return true;
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
     *   simulationClock: unknown
     * }>} session
     * @param {Promise<void>} baseStopPromise
     * @returns {Promise<Readonly<{
     *   generation: number,
     *   gameState: GameState,
     *   simulationClock: unknown
     * }>>}
     * @private
     */
    async _stopCapturedSession(session, baseStopPromise) {
        const { gameState, generation, simulationClock } = session;

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
        this._cleanupScrollState();
        this._cleanupEventListeners(this.cleanupHandlers);
        this._disableGamepadExploration();
        this.cosmicExploration?.stop?.();
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
        if (this.cosmicExploration) {
            this.cosmicExploration.dispose?.();
            this.cosmicExploration = null;
        }

        console.log('[Infinity] Game stopped');
        this.boardScene = null;

        return Object.freeze({
            generation,
            gameState,
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

        // Stop normally retires these synchronously; this is idempotent for a
        // partial start/deactivation path.
        this._restoreLegacyBoardJuiceInputWrappers();

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
        // Clear cached physics callbacks so they get recreated with fresh BoardScene references
        this.physicsCallbacks = null;
        if (!phaserGame?.scene) return;

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

                // Emit event for theme reactions
                console.log('[Infinity] Emitting LINE_CLEAR event, count:', lineCount);
                emitLineClear({ lineCount, clearedRows, cascadeCount });

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

                // Board juice: dip + bounce on hard drop
                if (this.boardJuice) {
                    this.boardJuice.dip(3);
                    this.boardJuice.bounce();
                }
            },
            // Trigger combo visual effects
            triggerCombo: (comboCount) => {
                if (!ownsCallbackSession()) return;
                // Emit event for theme reactions
                console.log('[Infinity] Emitting COMBO event, comboCount:', comboCount);
                emitCombo({ comboCount });

                // Track max combo
                if (callbackState.infinityStats && comboCount > callbackState.infinityStats.maxCombo) {
                    callbackState.infinityStats.maxCombo = comboCount;
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
                if (!ownsCallbackSession()) return;
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
                if (!ownsCallbackSession()) return;
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
            onLineClearImpact: (lineCount) => {
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
                if (!ownsCallbackSession()) return;
                const boardScene = this._getBoardScene();
                if (boardScene && boardScene.triggerBackgroundPulse) {
                    boardScene.triggerBackgroundPulse(lineCount);
                } else {
                    triggerBackgroundPulseCanvas(lineCount);
                }
            },
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
            // Update camera after cascade completes
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
    async _handleGameOver(expectedGeneration = this._activeSession?.generation) {
        const activeSession = this._activeSession;
        if (!activeSession || activeSession.generation !== expectedGeneration) {
            return;
        }

        // Multiple Infinity paths can observe the terminal board during the
        // same frame. Only the first callback owns this generation's result.
        if (this.isProcessingGameOver) return;
        this.isProcessingGameOver = true;

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

        if (writesLegacyResults) {
            // Save high score (using standard system for now).
            await this.deps.highScoreManager.addScore({
                score: gameState.score,
                lines: gameState.lines,
                level: gameState.level,
                mode: 'infinity', // Tag as infinity mode
            });

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
        if (this._wheelHandler) {
            document.removeEventListener('wheel', this._wheelHandler);
        }
        const wheelHandler = this._onWheelScroll.bind(this);
        this._wheelHandler = wheelHandler;
        document.addEventListener('wheel', wheelHandler, { passive: false });

        this.cleanupHandlers.push(() => {
            document.removeEventListener('wheel', wheelHandler);
            if (this._wheelHandler === wheelHandler) {
                this._wheelHandler = null;
            }
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
