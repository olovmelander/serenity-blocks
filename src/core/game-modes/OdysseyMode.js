/**
 * @fileoverview OdysseyMode - Odyssey Mode game mode implementation
 *
 * Odyssey Mode is a linear progression through the authored Odyssey campaign.
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
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
import {
    spawnPiece,
    fillBag,
    gameLoop,
    updateGame,
} from '../game.js';
import {
    checkInfinityGameOver,
} from '../infinity-grid.js';
import {
    INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
    projectInfinityPresentationCamera,
    synchronizeInfinitySimulationCamera,
} from '../infinity-spawn-policy.js';
import {
    GAME_MODES,
} from '../constants.js';
import { updateStats } from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { emitLineClear, emitCombo } from '../../events/gameplay-events.js';
import { OdysseyStateManager } from '../odyssey/OdysseyStateManager.js';
import { getLevelRegistry } from '../odyssey/LevelRegistry.js';
import { GameplayHybridEngine } from '../odyssey/GameplayHybridEngine.js';
import {
    createOdysseyLevelSession,
    drainOdysseyLevelSession,
    retireOdysseyLevelSession,
} from '../odyssey/odyssey-level-session.js';
import {
    createOdysseyPhysicsCallbacks,
    prefersOdysseyReducedMotion,
} from './odyssey-physics-callbacks.js';
import {
    applyOdysseyFixedCommand,
    createOdysseyFixedTickRuntime,
    startOdysseyModeFixedTickLoop,
} from './odyssey-fixed-tick.js';
import {
    DEMO_FIXED_SIMULATION_CLOCK,
    DEMO_LEGACY_SIMULATION_CLOCK,
} from '../demo/DemoRecorder.js';
import { readFlag } from '../flags.js';
import { canWriteLegacySimulationResults } from './single-player-result-compatibility.js';
import { generateSessionSeed } from '../session-rng.js';
import { ThemeTransitionManager } from '../odyssey/ThemeTransitionManager.js';
import { isEffectWarmEnabled, prewarmActiveThemeEffects } from '../../rendering/odyssey/effect-prewarm.js';
import { OdysseyBoardController } from '../../rendering/odyssey/OdysseyBoardController.js';
import { JourneyEntryTransition } from '../../rendering/transitions/JourneyEntryTransition.js';
import { JourneyReturnTransition } from '../../rendering/transitions/JourneyReturnTransition.js';
import { TRANSITION_LAYERS } from '../../rendering/transitions/transition-layer-constants.js';
import { OdysseyHUD } from '../../ui/odyssey/OdysseyHUD.js';
import { createResultsModal } from '../../ui/odyssey/ResultsModal.js';
import { createFailureModal } from '../../ui/odyssey/FailureModal.js';
import { createGoalCompleteOverlay } from '../../ui/odyssey/GoalCompleteOverlay.js';
import { createBoardInfoOverlay } from '../../ui/odyssey/BoardInfoOverlay.js';
import { createLevelSelectOverlay } from '../../ui/odyssey/LevelSelectOverlay.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';
import {
    showCinematicLoadingOverlay,
    dismissCinematicLoadingOverlay,
    waitForCinematicLoadingOverlayPresented,
} from '../../ui/cinematic-loading-overlay.js';
import { getOdysseyThemePresentationPalette } from '../odyssey/theme-presentation.js';
import { shouldCaptureWheelEvent } from '../../utils/wheel-routing.js';
import { installOdysseyLegacyInputWrapper } from '../../ui/odyssey/legacy-input-wrapper.js';

function isOdysseyLayoutEditorEnabled() {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
        return false;
    }

    try {
        const search = new URLSearchParams(window.location?.search || '');
        return search.get('odysseyEditor') === '1';
    } catch {
        return false;
    }
}

/**
 * Whether to expose the console debug handles (window.odysseyMode / window.testOdysseyLevel).
 * These are DEV/tooling only — testOdysseyLevel unlocks levels into the real save, so it must
 * never ship to players (Steam leaderboard is console-gameable otherwise; masterplan §2 #4).
 * Allowed in a DEV build, or when a capture/validation harness flag is present so the offline
 * screenshot/perf tooling keeps working against any build mode.
 * @returns {boolean}
 */
function isOdysseyDebugExposureEnabled() {
    if (typeof window === 'undefined') return false;
    if (import.meta.env.DEV) return true;
    try {
        const search = new URLSearchParams(window.location?.search || '');
        return search.get('odysseyAAA') === '1'
            || search.get('odysseyDebug') === '1'
            || search.has('odysseyCaptureChapters');
    } catch {
        return false;
    }
}

/**
 * Loading-optimization Phase 1: keep the WebGPU board resident across level
 * entry/return instead of disposing + rebuilding it (the cold-start cost, paid twice).
 * Default ON. Disable with ?odysseyKeepBoard=0 if VRAM/TDR pressure shows up — that
 * restores the exact previous dispose-and-rebuild behaviour.
 */
function readOdysseyKeepBoardFlag() {
    if (typeof window === 'undefined') {
        return true;
    }
    try {
        const search = new URLSearchParams(window.location?.search || '');
        const raw = search.get('odysseyKeepBoard');
        if (raw === '0' || raw === 'false' || raw === 'off') {
            return false;
        }
    } catch {
        // fall through to default
    }
    return true;
}

/**
 * OdysseyMode - Narrative-driven progression through themed levels
 */
export class OdysseyMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Odyssey-specific state
        this.levelRegistry = getLevelRegistry();
        this.odysseyState = new OdysseyStateManager({ levelRegistry: this.levelRegistry });

        // Phase 2: Gameplay Hybrid Engine. A fresh instance replaces this per attempt so
        // late callbacks cannot write metrics into the next run's evaluator.
        this.hybridEngine = new GameplayHybridEngine();

        // Current level state
        this.currentLevelId = null;
        this.currentLevelConfig = null;
        this.gameState = null;
        this.levelStartTime = null;
        // Accumulated paused wall-time for the current level so the level clock does not
        // count time spent in the pause menu (masterplan §2 #2). _pauseStartedAt marks an
        // in-progress pause; levelPausedMs is the total already-accumulated paused time.
        this.levelPausedMs = 0;
        this._pauseStartedAt = null;
        this._levelSessionGeneration = 0;
        this._activeLevelSession = null;
        // Compatibility mirror of the active session's callback cache.
        this._physicsCallbacks = null;
        this._fixedTickEnabled = false;
        this._activationSimulationClock = DEMO_LEGACY_SIMULATION_CLOCK;
        this._simulationClockLatched = false;
        this._fixedTickRuntime = createOdysseyFixedTickRuntime();
        this._fixedTickLoop = null;
        this._fixedTickOwnership = null;
        this._fixedTickInputBinding = null;
        this._lastFixedTickClockWarp = null;
        // Deferred board-park timer after level entry (masterplan §2 #9) — tracked so a fast
        // return-to-map can cancel it before it parks a just-resumed board.
        this._boardParkTimer = null;
        this.levelTimerInterval = null;

        // Phase 3: Odyssey Board Controller
        this.boardController = null;

        // Phase 4: Theme Transition Manager
        this.transitionManager = null; // Initialized in onActivate when themeManager is available
        this.journeyEntryTransition = null;
        this.journeyReturnTransition = null;
        this.isEnteringLevel = false;
        this.levelPrepared = false;
        this.levelRunStarted = false;

        // UI state
        this.isInBoardView = true; // true = level select, false = playing level
        this.cleanupHandlers = [];

        this._legacyInputOwner = null;

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
        this.usingHybridLoop = false;

        // Board-view audio state (restore menu track when returning from level gameplay)
        this.boardTrackKey = null;
        this.boardTrackWasPlaying = false;
        this.transitionMusicPreDuckVolume = null;
        this.transitionMusicDuckActive = false;
        this.currentThemePrefetchPromise = null;
        this.currentThemePrefetchLevelId = null;
        this.selectedLevelId = null;
        this.themeRevealToken = 0;
        this.entryPhase = 'idle';
        this.pendingThemeFullReadyPromise = null;
        this.themeFallbackBackdrop = null;
        this.themeFallbackBackdropRemovalTimer = null;
        this.levelThemePrefetchTimer = null;
        this.gameplayRevealState = null;
        this.levelStartCueState = null;
        this.odysseyNavigatorButton = null;
        this.odysseyNavigatorButtonHandlersBound = false;
        this.boardReturnFallbackVeil = null;
        this.boardReturnFallbackVeilTimer = null;
        this.boardViewReadyPromise = null;
        this.chapterArrivalCueTimer = null;
        this.isTallBoard = false;
        this._boardBuildPromise = null;
        this._deferredWarpPreinitTimer = null;
        this._warpPreinitScheduled = false;
        this._warpPreinitComplete = false;

        // In-place retry: fail -> instant restart of the SAME level, reusing the
        // live gameplay surface/theme/board (no journey-return + journey-entry round-trip).
        this._retryVeil = null;
        this.RETRY_VEIL_FADE_MS = 260;
        this._levelAttemptNumber = 1;

        // Loading optimization Phase 1: keep the board resident (parked) across level
        // entry/return rather than dispose + rebuild it. See docs/ODYSSEY_LOADING_OPTIMIZATION_PLAN.md.
        this._keepBoardAlive = readOdysseyKeepBoardFlag();
        this._boardParked = false;
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

    getStartRuntimePolicy() {
        return {
            resumeThemeLinkedMusic: false,
            resumeThemes: false,
            syncMusicPlayback: false,
        };
    }

    _captureBoardTrack() {
        const soundManager = this.deps?.soundManager;
        if (!soundManager) return;

        const actualTrack = typeof soundManager.getActualTrackKey === 'function'
            ? soundManager.getActualTrackKey()
            : null;
        const selectedTrack = soundManager.musicTrack || null;

        this.boardTrackKey = actualTrack || selectedTrack || this.boardTrackKey;
        this.boardTrackWasPlaying = typeof soundManager.isMusicPlaying === 'function'
            ? soundManager.isMusicPlaying()
            : this.boardTrackWasPlaying;
    }

    async _applyBoardAudioPolicy(options = {}) {
        const { restoreTrack = false } = options;
        const soundManager = this.deps?.soundManager;
        if (!soundManager) return;

        soundManager.suspendThemeLinkedMusic?.();

        if (restoreTrack && this.boardTrackKey && soundManager.musicTrack !== this.boardTrackKey) {
            soundManager.setTrack(this.boardTrackKey);
        }

        const actualTrack = typeof soundManager.getActualTrackKey === 'function'
            ? soundManager.getActualTrackKey()
            : null;
        const trackMismatch = restoreTrack
            && !!this.boardTrackKey
            && actualTrack !== this.boardTrackKey;
        const shouldRecoverPlayback = !soundManager.isMuted
            && this.boardTrackWasPlaying
            && typeof soundManager.isMusicPlaying === 'function'
            && !soundManager.isMusicPlaying();

        if ((trackMismatch || shouldRecoverPlayback) && soundManager.ensureTrackPlaybackSynced) {
            await soundManager.ensureTrackPlaybackSynced({
                reason: 'odyssey-board-view',
                force: true,
            });
        }
    }

    // =============================
    // Lifecycle Methods
    // =============================

    /**
     * Called when Odyssey Mode is selected
     */
    async onActivate() {
        await super.onActivate();

        this._latchSimulationClock();

        console.log('[Odyssey] Activating Odyssey Mode...');

        this._captureBoardTrack();
        await this._applyBoardAudioPolicy({ restoreTrack: false });

        // Load saved progress
        this.odysseyState.load();

        // Show odyssey UI
        this._showOdysseyUI();

        // Legacy campaign telemetry persists wall-clock play time. Experimental
        // clocks stay read-only until results have an explicit sim-version key.
        if (canWriteLegacySimulationResults(this._activationSimulationClock)) {
            this.odysseyState.startSession();
        }

        // Phase 4: Initialize theme transition manager
        if (this.deps?.themeManager && !this.transitionManager) {
            this.transitionManager = new ThemeTransitionManager(this.deps.themeManager);
        }
        if (!this.journeyEntryTransition) {
            this.journeyEntryTransition = new JourneyEntryTransition();
        }
        if (!this.journeyReturnTransition) {
            this.journeyReturnTransition = new JourneyReturnTransition();
        }

        // ═══════════════════════════════════════════════════════════════════
        // PERFORMANCE: Suspend the active theme's render loop while in
        // board view. The Odyssey board has its own Three.js renderer;
        // running two heavy 3D render loops simultaneously crushes FPS.
        // The theme is resumed when entering a level (via resumeThemes).
        // ═══════════════════════════════════════════════════════════════════
        if (this.deps?.themeManager && !this.deps.themeManager.themesSuspended) {
            this.deps.themeManager.suspendThemes();
        }

        // Default to board view (level selection)
        this.isInBoardView = true;
        try {
            // Paint the ODYSSEY overlay + commit its compositor animations before the
            // cold WebGPU board build steals the main thread (else the build runs in the
            // same task and the overlay never paints — user sees a frozen menu).
            await waitForCinematicLoadingOverlayPresented();
            this.boardViewReadyPromise = this._showBoardView();
            await this.boardViewReadyPromise;
        } catch (error) {
            console.error('[Odyssey] Failed to prepare board view:', error);
            this.isActive = false;
            this._disposeOdysseyBoard();
            try {
                await this._dismissCinematicLoadingOverlay();
            } catch {
                // Ignore overlay cleanup failures while surfacing the original startup error.
            }
            throw error;
        } finally {
            this.boardViewReadyPromise = null;
        }

        // Console debug handles — DEV/capture-tooling only. testOdysseyLevel unlocks levels
        // into the real save, so exposing it in the shipped game makes the Steam leaderboard
        // console-gameable (masterplan §2 #4). Gated behind DEV / capture-harness flags.
        if (isOdysseyDebugExposureEnabled()) {
            window.testOdysseyLevel = (levelId) => {
                console.log(`[Odyssey] Testing level ${levelId}...`);
                // Unlock the level for testing (bypasses normal progression)
                this.odysseyState.unlockLevel(levelId);
                return this.enterLevel(levelId);
            };
            window.odysseyMode = this;
            console.log('[Odyssey] Debug: Use window.testOdysseyLevel(levelId) to test a specific level');
        }

        console.log('[Odyssey] Mode activated');
        console.log(`[Odyssey] Progress: ${this.odysseyState.getOverallProgress()}%`);
    }

    /**
     * Called when user starts a level
     */
    async onStart() {
        await super.onStart();
        await this._applyBoardAudioPolicy({ restoreTrack: true });
        console.log('[Odyssey] onStart called - entering level');
    }

    /**
     * Called when game is paused. Sim mirror + hybrid-loop pause live in
     * BaseGameMode (§4.6 slice 2); the countdown guard, level clock, and
     * tall-board camera are Odyssey-specific.
     */
    _getPausableGameState() {
        return this.gameState || null;
    }

    _latchSimulationClock() {
        if (this._simulationClockLatched) return this._activationSimulationClock;

        this._fixedTickEnabled = readFlag('fixedTick', false);
        if (this._fixedTickEnabled && !this.deps.frameRateController?.startHybridLoop) {
            console.warn('[Odyssey] fixedTick requires FrameRateController; using legacy loop');
            this._fixedTickEnabled = false;
        }
        this._activationSimulationClock = this._fixedTickEnabled
            ? DEMO_FIXED_SIMULATION_CLOCK
            : DEMO_LEGACY_SIMULATION_CLOCK;
        this._simulationClockLatched = true;
        return this._activationSimulationClock;
    }

    _isLevelSessionActive(session) {
        return !!session
            && !session.retired
            && this._activeLevelSession === session
            && this.gameState === session.gameState
            && this.hybridEngine === session.hybridEngine;
    }

    _isLevelSessionCurrent(session, retirementGeneration) {
        return !!session
            && this._activeLevelSession === session
            && session.retirementGeneration === retirementGeneration;
    }

    _retireLevelSession(session = this._activeLevelSession) {
        const retirementGeneration = ++this._levelSessionGeneration;
        if (!session) {
            this._stopFixedTickSession();
            return null;
        }

        const ownsDrivers = this._activeLevelSession === session && !session.retired;
        session.retirementGeneration = retirementGeneration;
        if (ownsDrivers) {
            this._stopFixedTickSession();
            this._restoreInputs();
            if (this.deps.frameRateController?.isRunning) {
                this.deps.frameRateController.stopHybridLoop();
            }
            if (this.levelTimerInterval) clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
            this.usingHybridLoop = false;
        }
        return retireOdysseyLevelSession(session);
    }

    async _drainLevelSession(session) {
        try {
            await drainOdysseyLevelSession(session);
        } catch (error) {
            console.warn('[Odyssey] In-flight physics rejected during retirement:', error);
        }
    }

    onPause() {
        if (this.entryPhase === 'countdown') {
            console.log('[Odyssey] Ignoring pause request during level start cue');
            return;
        }

        super.onPause();
        this._fixedTickInputBinding?.clear();

        // Pause level timer + start accumulating paused wall-time so the clock excludes
        // time spent in the pause menu (masterplan §2 #2).
        if (this.levelStartTime && this._pauseStartedAt === null) {
            this._pauseStartedAt = Date.now();
        }
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

        // For tall boards, enable camera navigation during pause
        const boardRows = this.currentLevelConfig?.mechanics?.board?.rows || 20;
        const isTallBoard = boardRows >= this.MINIMAP_ROW_THRESHOLD;
        this.isTallBoard = isTallBoard;

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
        if (this.entryPhase === 'countdown') {
            console.log('[Odyssey] Ignoring resume request during level start cue');
            return;
        }

        super.onResume();

        if (
            this._fixedTickEnabled
            && this._fixedTickOwnership?.gameState === this.gameState
        ) {
            // FrameRateController reanchors wall time; GameState stays in the
            // canonical simulation-time domain.
            this.gameState.lastTime = this.gameState.simTimeMs;
        }

        // Fold the just-ended pause interval into the paused-time accumulator before the
        // clock resumes (masterplan §2 #2).
        if (this._pauseStartedAt !== null) {
            this.levelPausedMs += Date.now() - this._pauseStartedAt;
            this._pauseStartedAt = null;
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
        // Invalidate callbacks and stop every driver before the first await. The captured
        // state is the only state drained below; a replacement attempt remains untouched.
        const session = this._retireLevelSession();
        if (session?.gameState) session.gameState.isGameOver = true;
        await super.onStop();

        console.log('[Odyssey] Stopping...');
        await this._drainLevelSession(session);

        this._restoreTransitionMusicDuck(180);
        this.isEnteringLevel = false;
        this.levelPrepared = false;
        this.levelRunStarted = false;
        this.entryPhase = 'idle';
        this.themeRevealToken += 1;
        this.pendingThemeFullReadyPromise = null;
        this.currentThemePrefetchPromise = null;
        this.currentThemePrefetchLevelId = null;
        this._clearLevelThemePrefetchTimer();
        this._clearNeutralThemeFallbackBackdrop({ immediate: true });
        this._clearGameplayRevealState();
        this._clearLevelStartCue({ resolveValue: false });
        this.journeyEntryTransition?.abort?.('mode-stop');

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
        const writesLegacyResults = canWriteLegacySimulationResults(
            this._activationSimulationClock,
        );
        // Cancel the deferred board-park timer so it can't fire against a torn-down mode (§2 #9).
        this._cancelBoardParkTimer();
        if (this.isRunning || this._activeLevelSession) {
            await this.onStop();
        } else {
            this._retireLevelSession();
        }
        await this._applyBoardAudioPolicy({ restoreTrack: true });
        await super.onDeactivate();

        console.log('[Odyssey] Deactivating...');

        // Fixed/unknown clocks are presentation-only until §5.8 versions the
        // campaign save and Steam result sinks.
        if (writesLegacyResults) {
            this.odysseyState.endSession();
            this.odysseyState.save();
        }

        // Restore inputs
        this._restoreInputs();

        // Clean up cinematic loading overlay if still present
        const loadingOverlay = document.getElementById('odyssey-loading-overlay');
        if (loadingOverlay) loadingOverlay.remove();

        // Hide odyssey UI
        this._hideOdysseyUI();

        // Dispose the 3D Odyssey Board and overlay
        this._disposeOdysseyBoard();
        this._clearDeferredWarpPreinit();

        this.journeyEntryTransition?.dispose?.();
        this.journeyEntryTransition = null;
        this.journeyReturnTransition?.dispose?.();
        this.journeyReturnTransition = null;
        this._restoreTransitionMusicDuck(180);
        this.entryPhase = 'idle';
        this.themeRevealToken += 1;
        this.pendingThemeFullReadyPromise = null;
        this.currentThemePrefetchPromise = null;
        this.currentThemePrefetchLevelId = null;
        this._clearLevelThemePrefetchTimer();
        this._clearNeutralThemeFallbackBackdrop({ immediate: true });
        this._clearGameplayRevealState();
        this._clearLevelStartCue({ resolveValue: false });
        this._clearBoardReturnFallbackVeil({ immediate: true });

        // Clean up BoardJuice
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        // Cleanup
        this.gameState = null;
        this.currentLevelId = null;
        this.currentLevelConfig = null;
        this._fixedTickEnabled = false;
        this._activationSimulationClock = DEMO_LEGACY_SIMULATION_CLOCK;
        this._simulationClockLatched = false;

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
        return this.launchOdysseyLevel(levelId, { source: 'direct' });
    }

    /**
     * Shared Odyssey launcher used by the board panel and secondary navigator.
     * @param {number} levelId - Level to enter
     * @param {{ source?: string }} options
     * @returns {Promise<boolean>}
     */
    async launchOdysseyLevel(levelId, options = {}) {
        const requestedLevelId = Number(levelId);
        const { source = 'board-panel' } = options;

        if (!Number.isFinite(requestedLevelId)) {
            return false;
        }

        this.selectedLevelId = requestedLevelId;

        console.log(`[Odyssey] Entering level ${levelId}...`);
        this._captureBoardTrack();

        if (this.isEnteringLevel) {
            console.warn('[Odyssey] Level entry already in progress');
            return false;
        }

        // Check if level is unlocked
        if (!this.odysseyState.isLevelUnlocked(requestedLevelId)) {
            console.warn(`[Odyssey] Level ${requestedLevelId} is locked`);
            return false;
        }

        // Get level configuration
        const levelConfig = this.levelRegistry.resolveLevelPresentation(requestedLevelId);
        if (!levelConfig) {
            console.error(`[Odyssey] Level ${requestedLevelId} not found in registry`);
            return false;
        }

        this.currentLevelId = requestedLevelId;
        this.currentLevelConfig = levelConfig;
        this._levelAttemptNumber = 1; // fresh entry from the board -> attempt 1
        this.levelPrepared = false;
        this.levelRunStarted = false;
        this.levelStartTime = null;
        this.levelCompleting = false;
        this.entryPhase = 'preparing';
        this.isInBoardView = true;

        // Reset level metrics
        this._resetLevelMetrics();
        this.isEnteringLevel = true;
        this.pendingThemeFullReadyPromise = null;
        this._clearNeutralThemeFallbackBackdrop({ immediate: true });
        this._clearLevelThemePrefetchTimer();
        this._clearGameplayRevealState();
        this._clearLevelStartCue({ resolveValue: false });
        const entryToken = ++this.themeRevealToken;
        const launchAnchor = this._resolveJourneyEntryAnchor(requestedLevelId);
        const palette = this._buildJourneyEntryPalette(levelConfig);
        const transitionTimings = this._buildJourneyEntryTimings(levelConfig);
        const qualityPreset = window.settings?.effectQuality || 'High';

        this._lockOdysseyBoardForLaunch();
        this.closeOdysseyNavigator({ restoreBoardPreview: false });
        this._fadeBoardOverlayForLaunch();

        if (!this.journeyEntryTransition) {
            this.journeyEntryTransition = new JourneyEntryTransition();
        }
        const motionTimer = window.setTimeout(() => {
            if (!this.isEnteringLevel) return;
            this._playJourneyTransitionCue('burst');
            this._startJourneyEntryMotion(requestedLevelId, launchAnchor.worldPosition);
        }, 120);

        this._setTransitionMusicDuck(0.42, 180);
        this._prefetchLevelAssets(levelConfig, { priority: 'high' }).catch((error) => {
            console.warn('[Odyssey] Theme prefetch failed during level entry:', error);
        });

        try {
            const result = await this.journeyEntryTransition.play({
                anchor: launchAnchor,
                palette,
                timings: transitionTimings,
                qualityPreset,
                callbacks: {
                    onBlackoutReached: async () => {
                        this.boardController?.pauseRendering?.();
                        await this._prepareGameplayReveal();

                        const [themeActivated, prepared] = await Promise.all([
                            this._activateLevelThemeVisuals(levelConfig),
                            this.prepareLevelStart(),
                        ]);
                        if (!themeActivated || !prepared) {
                            return false;
                        }

                        return this._waitForEntryRevealReadiness(levelConfig, entryToken);
                    },
                    onRevealStart: async () => {
                        this.isInBoardView = false;
                        this.entryPhase = 'revealing';
                        this._playJourneyTransitionCue('arrival');
                        this._showLevelIntro(levelConfig);
                        this._beginGameplayReveal({ fastReveal: true });
                        return true;
                    },
                    onPlayable: async () => {
                        const revealState = this.gameplayRevealState;
                        const playableShown = await revealState?.playablePromise;
                        if (!playableShown) {
                            return false;
                        }

                        this.entryPhase = 'playable';
                        const startCueComplete = await this.showLevelStartCue(levelConfig, this.gameState);
                        if (!startCueComplete) {
                            return false;
                        }
                        return this.beginLevelRun();
                    },
                    onComplete: async () => {
                        const revealState = this.gameplayRevealState;
                        await revealState?.uiPromise;
                        this._clearGameplayRevealState();
                        this._restoreTransitionMusicDuck(650);
                        // Phase 1: park the board (keep it resident) so returning to the map
                        // is a resume, not a full cold-start rebuild. Falls back to full
                        // dispose when keep-alive is disabled (?odysseyKeepBoard=0).
                        // Tracked + guarded (masterplan §2 #9): a fast return-to-map within 1.2s
                        // would otherwise park a board that _revealOdysseyBoard just resumed.
                        // The timer is cancelled by _cancelBoardParkTimer() on reveal/deactivate,
                        // and the callback bails if the board view was re-entered meanwhile.
                        this._cancelBoardParkTimer();
                        this._boardParkTimer = setTimeout(() => {
                            this._boardParkTimer = null;
                            if (this.isInBoardView) return; // returned to the map — don't re-park
                            if (this._keepBoardAlive) {
                                this._parkOdysseyBoard();
                            } else {
                                this._disposeOdysseyBoard();
                            }
                        }, 1200);
                    },
                    onAbort: async (abortResult) => {
                        console.warn('[Odyssey] Journey entry aborted:', abortResult?.reason || 'unknown', abortResult?.error || '');
                        this.entryPhase = 'aborted';
                        this.themeRevealToken += 1;
                        this.pendingThemeFullReadyPromise = null;
                        this._clearNeutralThemeFallbackBackdrop({ immediate: true });
                        this._clearGameplayRevealState();
                        this._clearLevelStartCue({ resolveValue: false });
                        this._cleanupPreparedLevelStart();
                        this._restoreBoardCameraAfterEntryAbort();
                        this._restoreUIAfterTransitionAbort(requestedLevelId);
                        this.boardController?.resumeRendering?.();
                        this.deps?.themeManager?.suspendThemes?.();
                        await this._applyBoardAudioPolicy({ restoreTrack: true });
                        this._restoreTransitionMusicDuck(250);
                        this.currentLevelId = null;
                        this.currentLevelConfig = null;
                        this.gameState = null;
                        if (source !== 'selector') {
                            this.selectedLevelId = requestedLevelId;
                        }
                    },
                },
            });

            return !!result?.success;
        } catch (error) {
            console.error('[Odyssey] Journey entry transition failed:', error);
            this.journeyEntryTransition?.abort?.('entry-error');
            this._cleanupPreparedLevelStart();
            this.entryPhase = 'aborted';
            return false;
        } finally {
            window.clearTimeout(motionTimer);
            this.isEnteringLevel = false;
        }
    }

    /**
     * Kick off the board-side level-entry pulse + camera zoom.
     * @private
     */
    _startJourneyEntryMotion(levelId, targetPosition) {
        this._pulseJourneyEntryNode(levelId);

        const cameraController = this.boardController?.cameraController;
        if (!cameraController || !targetPosition) return;

        const started = cameraController.playLevelEntryZoom?.({
            targetPosition,
            durationMs: 520,
            fovStart: cameraController.camera?.fov ?? 60,
            fovEnd: 42,
            distanceBias: 0.34,
        });

        if (!started) {
            cameraController.zoomToPosition?.(targetPosition, 520);
        }
    }

    /**
     * Resolve the selected node's screen/world anchor for Journey entry visuals.
     * @private
     */
    _resolveJourneyEntryAnchor(levelId) {
        const camera = this.boardController?.camera;
        const nodeManager = this.boardController?.nodeManager;
        const cinematicMetrics = nodeManager?.getNodeCinematicMetrics?.(levelId, camera);
        const worldPosition = cinematicMetrics?.worldPosition
            || nodeManager?.getNodePosition?.(levelId)
            || null;

        return {
            x: cinematicMetrics?.center?.x ?? 0.5,
            y: cinematicMetrics?.center?.y ?? 0.5,
            radius: cinematicMetrics?.radius ?? 0.14,
            onScreen: cinematicMetrics?.onScreen !== false,
            worldPosition,
        };
    }

    /**
     * Resolve the gameplay playfield center for the reverse transition.
     * @private
     */
    _resolveJourneyReturnDepartureAnchor() {
        const fallback = {
            x: 0.5,
            y: 0.5,
            radius: 0.18,
            onScreen: true,
        };
        const viewportWidth = window?.innerWidth || 1;
        const viewportHeight = window?.innerHeight || 1;
        const surface = document.querySelector('#phaser-game-container canvas')
            || document.getElementById('phaser-game-container')
            || document.getElementById('single-player-container');

        if (!surface?.getBoundingClientRect) {
            return fallback;
        }

        const rect = surface.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return fallback;
        }

        const centerX = rect.left + (rect.width * 0.5);
        const centerY = rect.top + (rect.height * 0.5);
        const radius = Math.max(
            0.08,
            Math.min(
                0.28,
                (Math.min(rect.width, rect.height) * 0.34) / Math.min(viewportWidth, viewportHeight),
            ),
        );

        return {
            x: Math.max(0, Math.min(1, centerX / viewportWidth)),
            y: Math.max(0, Math.min(1, centerY / viewportHeight)),
            radius,
            onScreen: true,
        };
    }

    /**
     * Resolve the completed Odyssey node anchor for the reverse reveal.
     * @private
     */
    _resolveJourneyReturnArrivalAnchor(levelId) {
        return this._resolveJourneyEntryAnchor(levelId);
    }

    /**
     * Build Journey-entry particle palette from the selected level theme.
     * @private
     */
    _buildJourneyEntryPalette(levelConfig) {
        const themeId = levelConfig?.transitionPaletteThemeId
            || levelConfig?.theme?.transitionPalette
            || levelConfig?.theme?.primary
            || null;
        const themePalette = getOdysseyThemePresentationPalette(themeId);
        if (themePalette) {
            return themePalette;
        }

        const chapterId = levelConfig?.chapter || 1;
        const chapterColor = this.boardController?.nodeManager?.getChapterColor?.(chapterId)?.clone?.();
        const primary = chapterColor || null;
        const accent = chapterColor?.clone?.().offsetHSL(0.02, 0.12, 0.22) || null;
        const highlight = chapterColor?.clone?.().offsetHSL(0, 0, 0.38) || '#ffffff';
        const shadow = chapterColor?.clone?.().offsetHSL(0, -0.08, -0.42) || '#05070d';

        return {
            primary,
            accent,
            highlight,
            shadow,
        };
    }

    /**
     * Give heavier Odyssey levels more blackout budget before the entry transition aborts.
     * Theme activation, gameplay prep, and first-frame readiness all happen under blackout.
     * @private
     */
    _buildJourneyEntryTimings(levelConfig) {
        const boardRows = levelConfig?.mechanics?.board?.rows || 20;
        const startingRows = levelConfig?.mechanics?.board?.startingRows || 0;
        const baseMode = levelConfig?.mechanics?.baseMode || 'standard';
        const transitionIn = levelConfig?.theme?.transitionIn || 'warp';
        const themeId = levelConfig?.theme?.primary || null;
        const heavyThemes = new Set([
            'crystal-cave',
            'black-hole',
            'electric-dreams',
            'stellar-velocity',
            'singing-bowl',
            'voltage-storm',
        ]);

        let maxBlackoutHoldMs = 6800;

        if (baseMode === 'infinity') {
            maxBlackoutHoldMs += 700;
        } else if (baseMode === 'hybrid') {
            maxBlackoutHoldMs += 450;
        }

        if (boardRows >= 24) {
            maxBlackoutHoldMs += 500;
        }

        if (boardRows >= 30) {
            maxBlackoutHoldMs += 400;
        }

        if (startingRows >= 8) {
            maxBlackoutHoldMs += 350;
        }

        if (transitionIn === 'warp') {
            maxBlackoutHoldMs += 350;
        }

        if (heavyThemes.has(themeId)) {
            maxBlackoutHoldMs += 900;
        }

        return {
            maxBlackoutHoldMs: Math.min(9800, maxBlackoutHoldMs),
        };
    }

    /**
     * Give the board rebuild enough blackout budget on the reverse trip.
     * @private
     */
    _buildJourneyReturnTimings(levelConfig) {
        const boardRows = levelConfig?.mechanics?.board?.rows || 20;
        const transitionIn = levelConfig?.theme?.transitionIn || 'warp';
        const themeId = levelConfig?.theme?.primary || null;
        const heavyThemes = new Set([
            'crystal-cave',
            'black-hole',
            'electric-dreams',
            'stellar-velocity',
            'singing-bowl',
            'voltage-storm',
        ]);

        let maxBlackoutHoldMs = 7200;
        if (boardRows >= 24) {
            maxBlackoutHoldMs += 500;
        }
        if (boardRows >= 30) {
            maxBlackoutHoldMs += 400;
        }
        if (transitionIn === 'warp') {
            maxBlackoutHoldMs += 250;
        }
        if (heavyThemes.has(themeId)) {
            maxBlackoutHoldMs += 800;
        }

        return {
            blackoutStartMs: 300,
            blackoutFullMs: 620,
            revealDurationMs: 680,
            particleDecayMs: 760,
            maxBlackoutHoldMs: Math.min(9800, maxBlackoutHoldMs),
        };
    }

    /**
     * Brief node pulse before blackout.
     * @private
     */
    _pulseJourneyEntryNode(levelId, durationMs = 620) {
        const node = this.boardController?.nodeManager?.nodes?.get(levelId);
        const group = node?.group;
        if (!group) return;

        const glowMesh = node?.glowMesh || null;
        const baseScale = group.scale.clone();
        const baseGlowScale = glowMesh?.scale?.clone?.() || null;
        const baseZ = group.position.z;
        const startedAt = performance.now();

        const animatePulse = () => {
            const elapsed = performance.now() - startedAt;
            const progress = Math.min(elapsed / durationMs, 1);
            const eased = progress < 0.7
                ? progress / 0.7
                : 1 - ((progress - 0.7) / 0.3);
            const pulse = Math.sin(Math.max(0, eased) * Math.PI);

            group.scale.copy(baseScale).multiplyScalar(1 + (pulse * 0.16));
            group.position.z = baseZ + (pulse * 0.32);

            if (glowMesh && baseGlowScale) {
                glowMesh.scale.copy(baseGlowScale).multiplyScalar(1 + (pulse * 0.34));
            }

            if (progress < 1) {
                requestAnimationFrame(animatePulse);
                return;
            }

            group.scale.copy(baseScale);
            group.position.z = baseZ;
            if (glowMesh && baseGlowScale) {
                glowMesh.scale.copy(baseGlowScale);
            }
        };

        requestAnimationFrame(animatePulse);
    }

    /**
     * Entry audio cues for burst/reveal.
     * @private
     */
    _playJourneyTransitionCue(cue) {
        const sfxPlayer = this.deps?.soundManager?.sfxPlayer;
        if (!sfxPlayer) return;

        if (cue === 'burst') {
            sfxPlayer.playRotate?.();
            sfxPlayer.playDrop?.();
            return;
        }

        if (cue === 'arrival') {
            sfxPlayer.playLevelUp?.();
        }
    }

    _restoreBoardCameraAfterEntryAbort() {
        const cameraController = this.boardController?.cameraController;
        if (!cameraController?.camera) return;

        cameraController.setFollowMode?.();
        cameraController.camera.fov = cameraController.cinematicConfig?.baseFov ?? 60;
        cameraController.camera.updateProjectionMatrix?.();
        cameraController.updateFollowPosition?.({ direct: true });
    }

    _lockOdysseyBoardForLaunch() {
        this.setOdysseyNavigatorButtonVisible(false);
        this.boardController?.teardownInteraction?.();

        const overlay = document.getElementById('odyssey-board-overlay');
        if (overlay) {
            overlay.style.pointerEvents = 'none';
        }
    }

    _unlockOdysseyBoardAfterLaunchAttempt() {
        this.boardController?.setupInteraction?.();

        const overlay = document.getElementById('odyssey-board-overlay');
        if (overlay) {
            overlay.style.pointerEvents = '';
        }
    }

    _fadeBoardOverlayForLaunch() {
        const panel = document.getElementById('odyssey-level-panel');
        if (panel) {
            panel.style.transition = 'opacity 120ms ease-out, transform 120ms ease-out';
            panel.style.opacity = '0';
            panel.style.transform = 'translateY(16px) scale(0.98)';
        }

        const overlay = document.getElementById('odyssey-board-overlay');
        if (overlay) {
            overlay.style.transition = 'opacity 140ms ease-out';
            overlay.style.opacity = '0';
        }
    }

    _restoreBoardOverlayAfterLaunchAttempt() {
        const playBtn = document.getElementById('level-panel-play-btn');
        if (playBtn) {
            playBtn.classList.remove('clicked');
            playBtn.textContent = this.selectedLevelId ? '▶ Play' : playBtn.textContent;
        }

        const panel = document.getElementById('odyssey-level-panel');
        if (panel) {
            panel.style.transition = '';
            panel.style.opacity = '';
            panel.style.transform = '';
        }

        const overlay = document.getElementById('odyssey-board-overlay');
        if (overlay) {
            overlay.style.transition = '';
            overlay.style.opacity = '';
            overlay.style.visibility = '';
        }
    }

    async _restoreBoardSurfaceAfterEntryAbort(levelId = null) {
        const restoreLevelId = Number.isFinite(levelId) ? levelId : this.selectedLevelId;

        this.isInBoardView = true;
        this.closeOdysseyNavigator({ restoreBoardPreview: false });
        this._restoreBoardOverlayAfterLaunchAttempt();
        this._unlockOdysseyBoardAfterLaunchAttempt();
        this.setOdysseyNavigatorButtonVisible(true);

        if (Number.isFinite(restoreLevelId)) {
            this.selectedLevelId = restoreLevelId;
            await this._focusBoardLevelForLaunch(restoreLevelId, { updatePreview: true, settle: false });
        }
    }

    _hideBoardBackdropForTransition() {
        const boardContainer = document.getElementById('odyssey-board-3d');
        if (boardContainer) {
            boardContainer.style.display = 'none';
        }
        this._hideLevelSelectUI();
    }

    _hideGameplaySurfaceForBoardReturn() {
        this._clearNeutralThemeFallbackBackdrop({ immediate: true });

        const gameContainer = document.getElementById('single-player-container');
        if (gameContainer) {
            gameContainer.style.visibility = 'hidden';
            gameContainer.style.opacity = '0';
            gameContainer.style.transition = '';
            gameContainer.style.transform = '';
        }

        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.visibility = 'hidden';
            phaserContainer.style.opacity = '0';
            phaserContainer.style.transition = '';
        }

        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.visibility = 'hidden';
            statsBar.style.opacity = '0';
            statsBar.style.transition = '';
        }

        const bgContainer = document.querySelector('.background-container');
        if (bgContainer) {
            bgContainer.style.opacity = '0';
            bgContainer.style.transition = '';
        }
    }

    _mountBoardReturnFallbackVeil() {
        if (this.boardReturnFallbackVeilTimer) {
            clearTimeout(this.boardReturnFallbackVeilTimer);
            this.boardReturnFallbackVeilTimer = null;
        }

        if (this.boardReturnFallbackVeil?.isConnected) {
            this.boardReturnFallbackVeil.style.opacity = '1';
            return this.boardReturnFallbackVeil;
        }

        const veil = document.createElement('div');
        veil.id = 'odyssey-return-fallback-veil';
        veil.dataset.odysseyWheelLock = 'true';
        veil.style.cssText = `
            position: fixed;
            inset: 0;
            pointer-events: auto;
            opacity: 1;
            z-index: ${TRANSITION_LAYERS.JOURNEY_RETURN};
            background:
                radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0) 18%),
                radial-gradient(circle at 50% 50%, rgba(12, 18, 34, 0.86), rgba(0, 0, 0, 0.98) 70%);
            transition: opacity 220ms ease-out;
        `;
        document.body.appendChild(veil);
        this.boardReturnFallbackVeil = veil;
        return veil;
    }

    _clearBoardReturnFallbackVeil(options = {}) {
        const { immediate = false } = options;
        if (this.boardReturnFallbackVeilTimer) {
            clearTimeout(this.boardReturnFallbackVeilTimer);
            this.boardReturnFallbackVeilTimer = null;
        }

        const veil = this.boardReturnFallbackVeil;
        if (!veil) {
            return;
        }

        const removeVeil = () => {
            if (this.boardReturnFallbackVeil === veil) {
                this.boardReturnFallbackVeil = null;
            }
            veil.remove();
        };

        if (immediate) {
            removeVeil();
            return;
        }

        veil.style.opacity = '0';
        this.boardReturnFallbackVeilTimer = setTimeout(() => {
            this.boardReturnFallbackVeilTimer = null;
            removeVeil();
        }, 240);
    }

    async _fallbackToBoardAfterReturnAbort(levelId = null) {
        this._mountBoardReturnFallbackVeil();
        this._hideGameplaySurfaceForBoardReturn();

        try {
            await this.onStop();
        } catch (error) {
            console.warn('[Odyssey] Return fallback stop failed:', error);
        }

        this.currentLevelId = null;
        this.currentLevelConfig = null;
        this.gameState = null;
        this.isInBoardView = true;

        try {
            await this._applyBoardAudioPolicy({ restoreTrack: true });
            await this._showBoardView({
                showLoadingOverlay: false,
                minOverlayDisplayMs: 0,
                focusLevelId: levelId,
                keepBoardLocked: false,
            });
        } catch (error) {
            console.warn('[Odyssey] Return fallback board reveal failed:', error);
        } finally {
            this._clearBoardReturnFallbackVeil();
        }
    }

    _setTransitionMusicDuck(targetVolume = 0.35, fadeMs = 160) {
        const soundManager = this.deps?.soundManager;
        if (!soundManager?.fadeMusicVolume) return;

        if (!this.transitionMusicDuckActive) {
            this.transitionMusicPreDuckVolume = soundManager.getMusicVolume?.() ?? 1;
            this.transitionMusicDuckActive = true;
        }

        soundManager.fadeMusicVolume(targetVolume, fadeMs).catch(() => {
            // Best-effort audio ducking; visual flow must continue.
        });
    }

    _restoreTransitionMusicDuck(fadeMs = 320) {
        const soundManager = this.deps?.soundManager;
        if (!soundManager?.fadeMusicVolume || !this.transitionMusicDuckActive) return;

        const restoreVolume = this.transitionMusicPreDuckVolume ?? 1;
        this.transitionMusicDuckActive = false;
        this.transitionMusicPreDuckVolume = null;

        soundManager.fadeMusicVolume(restoreVolume, fadeMs).catch(() => {
            // Best-effort restore.
        });
    }

    async _prefetchLevelAssets(levelConfig, options = {}) {
        if (!levelConfig) {
            return false;
        }

        if (this.transitionManager?.prefetchLevelTheme) {
            this.currentThemePrefetchLevelId = levelConfig.id ?? null;
            this.currentThemePrefetchPromise = this.transitionManager.prefetchLevelTheme(levelConfig, options);
            return this.currentThemePrefetchPromise;
        }

        return true;
    }

    _clearLevelThemePrefetchTimer() {
        if (this.levelThemePrefetchTimer) {
            clearTimeout(this.levelThemePrefetchTimer);
            this.levelThemePrefetchTimer = null;
        }
    }

    _prefetchLikelyLevelThemes(levelOrId, options = {}) {
        const level = typeof levelOrId === 'object'
            ? levelOrId
            : this.levelRegistry.resolveLevelPresentation(levelOrId);
        const priority = options.priority === 'high' ? 'high' : 'low';
        const includeAdjacent = options.includeAdjacent === true;
        const trackAsCurrent = options.trackAsCurrent !== false;

        if (!level || !this.transitionManager?.prefetchLevelTheme) {
            return Promise.resolve(false);
        }

        this._clearLevelThemePrefetchTimer();

        const prefetchPromise = this.transitionManager.prefetchLevelTheme(level, { priority });
        if (trackAsCurrent) {
            this.currentThemePrefetchLevelId = level.id ?? null;
            this.currentThemePrefetchPromise = prefetchPromise;
        }

        if (includeAdjacent) {
            this.levelThemePrefetchTimer = setTimeout(() => {
                if (this.selectedLevelId !== level.id || this.isEnteringLevel) {
                    return;
                }

                const chapterLevels = this.levelRegistry.getLevelsInChapter(level.chapter)
                    .map((entry) => this.levelRegistry.resolveLevelPresentation(entry))
                    .filter(Boolean);
                const index = chapterLevels.findIndex((entry) => entry.id === level.id);
                if (index < 0) {
                    return;
                }

                [chapterLevels[index - 1], chapterLevels[index + 1]]
                    .filter(Boolean)
                    .forEach((adjacentLevel) => {
                        this.transitionManager.prefetchLevelTheme(adjacentLevel, { priority: 'low' })
                            .catch((error) => {
                                console.warn('[Odyssey] Adjacent theme prewarm failed:', adjacentLevel?.theme?.primary, error);
                            });
                    });
            }, 420);
        }

        return prefetchPromise;
    }

    async _activateLevelThemeVisuals(levelConfig) {
        console.log('[Odyssey] Activating level theme visuals under blackout...');

        const { theme } = levelConfig || {};
        const soundManager = this.deps?.soundManager;

        try {
            if (this.transitionManager?.activatePrefetchedLevelTheme) {
                const activated = await this.transitionManager.activatePrefetchedLevelTheme(levelConfig);
                if (activated === false) {
                    return false;
                }
            } else if (this.deps.themeManager && theme?.primary) {
                if (this.currentThemePrefetchPromise) {
                    await this.currentThemePrefetchPromise;
                } else {
                    await this.deps.themeManager.loadTheme?.(theme.primary, true);
                }

                await this.deps.themeManager.switchTheme(theme.primary, true);

                if (this.deps.themeManager.themesSuspended) {
                    await this.deps.themeManager.resumeThemes();
                }
            }

            soundManager?.resumeThemeLinkedMusic?.(true);
            if (soundManager?.ensureTrackPlaybackSynced) {
                await soundManager.ensureTrackPlaybackSynced({
                    reason: 'odyssey-level-entry',
                    force: true,
                }).catch((error) => {
                    console.warn('[Odyssey] Theme music sync drift during level entry:', error);
                });
            }

            return true;
        } catch (error) {
            console.error('[Odyssey] Level theme activation failed:', error);
            return false;
        } finally {
            this.currentThemePrefetchPromise = null;
            this.currentThemePrefetchLevelId = null;
        }
    }

    async _waitForEntryRevealReadiness(levelConfig, entryToken) {
        const firstGameplayFramePromise = this._confirmFirstGameplayComposite(2600);
        const criticalReadyPromise = this.transitionManager?.waitForThemeCriticalReady
            ? this.transitionManager.waitForThemeCriticalReady(levelConfig, 900)
            : Promise.resolve(true);

        let [firstGameplayFrameReady, themeCriticalReady] = await Promise.all([ // eslint-disable-line prefer-const
            firstGameplayFramePromise,
            criticalReadyPromise,
        ]);

        if (entryToken !== this.themeRevealToken) {
            return false;
        }

        if (!firstGameplayFrameReady) {
            firstGameplayFrameReady = await this._confirmFirstGameplayComposite(2200);
        }

        if (entryToken !== this.themeRevealToken) {
            return false;
        }

        if (!firstGameplayFrameReady) {
            console.warn('[Odyssey] Gameplay frame missed reveal window, continuing with guarded reveal');
            this._showNeutralThemeFallbackBackdrop();
            this._scheduleThemeFullReadySettlement(levelConfig, entryToken, { safePresentation: true });
            return true;
        }

        if (themeCriticalReady) {
            this._scheduleThemeFullReadySettlement(levelConfig, entryToken, { safePresentation: false });
            return true;
        }

        const extendedCriticalReady = this.transitionManager?.waitForThemeCriticalReady
            ? await this.transitionManager.waitForThemeCriticalReady(levelConfig, 1400)
            : true;

        if (entryToken !== this.themeRevealToken) {
            return false;
        }

        if (extendedCriticalReady) {
            this._scheduleThemeFullReadySettlement(levelConfig, entryToken, { safePresentation: false });
            return true;
        }

        console.warn('[Odyssey] Theme critical readiness missed reveal window, using safe fallback backdrop');
        this._showNeutralThemeFallbackBackdrop();
        this._scheduleThemeFullReadySettlement(levelConfig, entryToken, { safePresentation: true });
        return true;
    }

    _scheduleThemeFullReadySettlement(levelConfig, entryToken, { safePresentation = false } = {}) {
        const settlePromise = Promise.resolve()
            .then(async () => {
                const ready = this.transitionManager?.waitForThemeFullReady
                    ? await this.transitionManager.waitForThemeFullReady(levelConfig, 6000)
                    : true;

                if (entryToken !== this.themeRevealToken) {
                    return false;
                }

                if (!ready) {
                    console.warn('[Odyssey] Theme full readiness did not settle before timeout');
                    return false;
                }

                const activeTheme = this.deps?.themeManager?.activeTheme;
                const postRevealTasks = [];

                if (typeof activeTheme?.promoteToFullQuality === 'function') {
                    postRevealTasks.push(Promise.resolve(activeTheme.promoteToFullQuality(1600)));
                }

                if (typeof activeTheme?.onPostRevealStart === 'function') {
                    postRevealTasks.push(Promise.resolve(activeTheme.onPostRevealStart({
                        durationMs: 1600,
                        safePresentation,
                    })));
                }

                if (postRevealTasks.length > 0) {
                    await Promise.allSettled(postRevealTasks);
                }

                if (entryToken === this.themeRevealToken) {
                    this._clearNeutralThemeFallbackBackdrop();
                }

                return true;
            })
            .catch((error) => {
                if (entryToken === this.themeRevealToken) {
                    console.warn('[Odyssey] Theme full-ready settlement failed:', error);
                }
                return false;
            });

        this.pendingThemeFullReadyPromise = settlePromise;
        settlePromise.finally(() => {
            if (this.pendingThemeFullReadyPromise === settlePromise) {
                this.pendingThemeFullReadyPromise = null;
            }
        });
        return settlePromise;
    }

    _showNeutralThemeFallbackBackdrop() {
        const backgroundContainer = document.querySelector('.background-container');
        if (!backgroundContainer) {
            return false;
        }

        if (this.themeFallbackBackdropRemovalTimer) {
            clearTimeout(this.themeFallbackBackdropRemovalTimer);
            this.themeFallbackBackdropRemovalTimer = null;
        }

        if (this.themeFallbackBackdrop?.isConnected) {
            this.themeFallbackBackdrop.style.opacity = '1';
            return true;
        }

        if (getComputedStyle(backgroundContainer).position === 'static') {
            backgroundContainer.style.position = 'relative';
        }

        const backdrop = document.createElement('div');
        backdrop.id = 'odyssey-theme-fallback-backdrop';
        backdrop.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            opacity: 0;
            transition: opacity 360ms ease;
            background:
                radial-gradient(circle at 50% 34%, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.01) 14%, rgba(0, 0, 0, 0) 24%),
                radial-gradient(circle at 50% 58%, rgba(26, 38, 66, 0.78), rgba(6, 10, 18, 0.96) 62%, rgba(0, 0, 0, 1) 100%);
            z-index: 2;
        `;

        backgroundContainer.appendChild(backdrop);
        this.themeFallbackBackdrop = backdrop;

        requestAnimationFrame(() => {
            if (this.themeFallbackBackdrop === backdrop) {
                backdrop.style.opacity = '1';
            }
        });

        return true;
    }

    _clearNeutralThemeFallbackBackdrop(options = {}) {
        const { immediate = false } = options;

        if (this.themeFallbackBackdropRemovalTimer) {
            clearTimeout(this.themeFallbackBackdropRemovalTimer);
            this.themeFallbackBackdropRemovalTimer = null;
        }

        const backdrop = this.themeFallbackBackdrop;
        if (!backdrop) {
            return;
        }

        const removeBackdrop = () => {
            if (this.themeFallbackBackdrop === backdrop) {
                this.themeFallbackBackdrop = null;
            }
            backdrop.remove();
        };

        if (immediate) {
            removeBackdrop();
            return;
        }

        backdrop.style.opacity = '0';
        this.themeFallbackBackdropRemovalTimer = setTimeout(() => {
            this.themeFallbackBackdropRemovalTimer = null;
            removeBackdrop();
        }, 380);
    }

    async _prepareGameplayReveal() {
        console.log('[Odyssey] Preparing gameplay reveal under blackout...');
        this.isInBoardView = false;
        this._hideBoardBackdropForTransition();
        this._clearNeutralThemeFallbackBackdrop({ immediate: true });

        const gameContainer = document.getElementById('single-player-container');
        if (gameContainer) {
            gameContainer.style.visibility = 'hidden';
            gameContainer.style.opacity = '0';
            gameContainer.style.transform = 'scale(1.02)';
            gameContainer.style.transition = '';
        }

        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.visibility = 'hidden';
            phaserContainer.style.opacity = '0';
            phaserContainer.style.transition = '';
        }

        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.visibility = 'hidden';
            statsBar.style.opacity = '0';
            statsBar.style.transition = '';
        }

        const bgContainer = document.querySelector('.background-container');
        if (bgContainer) {
            bgContainer.style.opacity = '0';
            bgContainer.style.transition = '';
        }

        return true;
    }

    _restoreUIAfterTransitionAbort(levelId = null) {
        this._clearNeutralThemeFallbackBackdrop({ immediate: true });

        const gameContainer = document.getElementById('single-player-container');
        if (gameContainer) {
            gameContainer.style.opacity = '';
            gameContainer.style.visibility = 'hidden';
            gameContainer.style.transition = '';
            gameContainer.style.transform = '';
        }

        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.opacity = '';
            phaserContainer.style.visibility = 'hidden';
            phaserContainer.style.transition = '';
        }

        const bgContainer = document.querySelector('.background-container');
        if (bgContainer) {
            bgContainer.style.opacity = '1';
            bgContainer.style.transition = '';
        }

        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.opacity = '';
            statsBar.style.visibility = 'hidden';
            statsBar.style.transition = '';
        }

        const boardContainer = document.getElementById('odyssey-board-3d');
        if (boardContainer) {
            boardContainer.style.display = '';
        }

        this._restoreBoardSurfaceAfterEntryAbort(levelId).catch((error) => {
            console.warn('[Odyssey] Failed to restore board surface after abort:', error);
        });
    }

    _clearGameplayRevealState() {
        this.gameplayRevealState = null;
    }

    _getLevelStartCueTimings(gameState = this.gameState) {
        const dropInterval = Number(gameState?.dropInterval);

        if (Number.isFinite(dropInterval) && dropInterval <= 500) {
            return {
                readyMs: 800,
                goMs: 280,
                dropInterval,
            };
        }

        if (Number.isFinite(dropInterval) && dropInterval <= 799) {
            return {
                readyMs: 650,
                goMs: 240,
                dropInterval,
            };
        }

        return {
            readyMs: 500,
            goMs: 200,
            dropInterval: Number.isFinite(dropInterval) ? dropInterval : null,
        };
    }

    _createLevelStartCue(levelConfig, gameState) {
        const existingCue = document.getElementById('odyssey-level-start-cue');
        if (existingCue) {
            existingCue.remove();
        }

        const cueState = {
            overlay: document.createElement('div'),
            panel: document.createElement('div'),
            label: document.createElement('div'),
            subtitle: document.createElement('div'),
            timings: this._getLevelStartCueTimings(gameState),
            timers: new Set(),
            pendingSettlers: new Set(),
        };

        cueState.overlay.id = 'odyssey-level-start-cue';
        cueState.overlay.setAttribute('aria-live', 'assertive');
        cueState.overlay.setAttribute('role', 'status');
        const cueBackdrop = [
            'radial-gradient(',
            'circle at 50% 50%, ',
            'rgba(10, 18, 34, 0.06), ',
            'rgba(2, 6, 18, 0.28) 70%, ',
            'rgba(0, 0, 0, 0.36) 100%',
            ')',
        ].join('');
        Object.assign(cueState.overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '13000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'auto',
            background: cueBackdrop,
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
        });

        const cuePanelBackground = [
            'linear-gradient(',
            '180deg, ',
            'rgba(8, 15, 28, 0.32), ',
            'rgba(4, 10, 22, 0.16)',
            ')',
        ].join('');
        Object.assign(cueState.panel.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            minWidth: '220px',
            padding: '18px 28px',
            borderRadius: '22px',
            background: cuePanelBackground,
            border: '1px solid rgba(120, 255, 224, 0.16)',
            boxShadow: '0 0 40px rgba(0, 0, 0, 0.22)',
        });

        const readyTextShadow = [
            '0 0 18px rgba(142, 249, 236, 0.92), ',
            '0 0 48px rgba(20, 210, 196, 0.55)',
        ].join('');
        cueState.label.id = 'odyssey-level-start-cue-label';
        Object.assign(cueState.label.style, {
            fontFamily: '"Orbitron", "Eurostile", sans-serif',
            fontSize: 'clamp(48px, 7vw, 92px)',
            fontWeight: '700',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#8ef9ec',
            textShadow: readyTextShadow,
            transform: 'scale(1)',
            transition: [
                'transform 140ms ease-out, ',
                'opacity 140ms ease-out, ',
                'color 140ms ease-out, ',
                'text-shadow 140ms ease-out',
            ].join(''),
            opacity: '1',
        });
        cueState.label.textContent = 'READY';

        cueState.subtitle.id = 'odyssey-level-start-cue-subtitle';
        Object.assign(cueState.subtitle.style, {
            fontFamily: '"Rajdhani", "Orbitron", sans-serif',
            fontSize: 'clamp(12px, 1.2vw, 16px)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(214, 247, 255, 0.86)',
            textAlign: 'center',
        });
        cueState.subtitle.textContent = levelConfig?.name || 'Odyssey';

        cueState.panel.appendChild(cueState.label);
        cueState.panel.appendChild(cueState.subtitle);
        cueState.overlay.appendChild(cueState.panel);
        document.body.appendChild(cueState.overlay);

        return cueState;
    }

    _setLevelStartCuePhase(cueState, phase) {
        if (!cueState?.label) {
            return;
        }

        const isGo = phase === 'go';
        cueState.label.textContent = isGo ? 'GO' : 'READY';
        cueState.label.style.color = isGo ? '#ffd86a' : '#8ef9ec';
        cueState.label.style.textShadow = isGo
            ? '0 0 18px rgba(255, 216, 106, 0.95), 0 0 48px rgba(255, 169, 60, 0.58)'
            : '0 0 18px rgba(142, 249, 236, 0.92), 0 0 48px rgba(20, 210, 196, 0.55)';
        cueState.label.style.transform = isGo ? 'scale(1.08)' : 'scale(1)';
        cueState.label.style.opacity = '1';

        if (cueState.subtitle) {
            cueState.subtitle.textContent = isGo ? 'Now' : (this.currentLevelConfig?.name || 'Odyssey');
            cueState.subtitle.style.color = isGo
                ? 'rgba(255, 239, 191, 0.92)'
                : 'rgba(214, 247, 255, 0.86)';
        }
    }

    _waitForLevelStartCueDelay(cueState, delayMs) {
        return new Promise((resolve) => {
            let timerId = null;
            let settled = false;

            const finish = (value) => {
                if (settled) {
                    return;
                }

                settled = true;
                cueState.pendingSettlers.delete(finish);
                if (timerId !== null) {
                    clearTimeout(timerId);
                    cueState.timers.delete(timerId);
                }
                resolve(value);
            };

            cueState.pendingSettlers.add(finish);
            timerId = setTimeout(() => {
                finish(this.levelStartCueState === cueState);
            }, delayMs);
            cueState.timers.add(timerId);
        });
    }

    _clearLevelStartCue(options = {}) {
        const {
            resolveValue = false,
        } = options;

        const cueState = this.levelStartCueState;
        if (!cueState) {
            return;
        }

        this.levelStartCueState = null;
        cueState.timers.forEach((timerId) => clearTimeout(timerId));
        cueState.timers.clear();

        Array.from(cueState.pendingSettlers).forEach((settle) => settle(resolveValue));
        cueState.pendingSettlers.clear();
        cueState.overlay?.remove?.();
    }

    async showLevelStartCue(levelConfig = this.currentLevelConfig, gameState = this.gameState) {
        if (!gameState) {
            return false;
        }

        this._clearLevelStartCue({ resolveValue: false });

        const cueState = this._createLevelStartCue(levelConfig, gameState);
        this.levelStartCueState = cueState;
        this.entryPhase = 'countdown';

        this.deps?.soundManager?.sfxPlayer?.playMove?.();

        const readyElapsed = await this._waitForLevelStartCueDelay(cueState, cueState.timings.readyMs);
        if (!readyElapsed || this.levelStartCueState !== cueState) {
            return false;
        }

        this._setLevelStartCuePhase(cueState, 'go');
        this.deps?.soundManager?.sfxPlayer?.playDrop?.();

        const goElapsed = await this._waitForLevelStartCueDelay(cueState, cueState.timings.goMs);
        if (!goElapsed || this.levelStartCueState !== cueState) {
            return false;
        }

        this._clearLevelStartCue({ resolveValue: true });
        return true;
    }

    async _waitForFirstGameplayFrame(timeoutMs = 1800) {
        const boardScene = this._getBoardScene();
        if (!boardScene) {
            return false;
        }

        if (boardScene._firstRenderEmitted) {
            return true;
        }

        return new Promise((resolve) => {
            let settled = false;
            let timeoutId = null;
            let rafId = null;
            const currentWindow = typeof window !== 'undefined' ? window : null;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                }
                if (rafId !== null && typeof cancelAnimationFrame === 'function') {
                    cancelAnimationFrame(rafId);
                }
                if (currentWindow?.removeEventListener) {
                    currentWindow.removeEventListener('phaser-board-first-render', handleWindowRender); // eslint-disable-line no-use-before-define
                }
                resolve(value);
            };

            const handleSceneRender = () => finish(true);
            const handleWindowRender = (event) => {
                if (!event?.detail?.sceneKey || event.detail.sceneKey === 'BoardScene') {
                    finish(true);
                }
            };
            const pollRenderState = () => {
                if (settled) return;
                const activeBoardScene = this._getBoardScene();
                if (activeBoardScene?._firstRenderEmitted) {
                    finish(true);
                    return;
                }
                if (typeof requestAnimationFrame === 'function') {
                    rafId = requestAnimationFrame(pollRenderState);
                }
            };

            timeoutId = setTimeout(() => finish(false), timeoutMs);
            boardScene.events?.once?.('first-render', handleSceneRender);
            currentWindow?.addEventListener?.('phaser-board-first-render', handleWindowRender);
            pollRenderState();
        });
    }

    async _confirmFirstGameplayComposite(timeoutMs = 1800) {
        return this._waitForFirstGameplayFrame(timeoutMs);
    }

    /**
     * Complete the current level
     * @param {Object} results - Level results
     */
    async completeLevel(results) {
        // Prevent multiple completions
        const session = this._activeLevelSession;
        if (this.levelCompleting || !this._isLevelSessionActive(session)) return;
        this.levelCompleting = true;
        const { retirementGeneration } = this._retireLevelSession(session);
        const { gameState, hybridEngine, levelId } = session;
        const writesLegacyResults = canWriteLegacySimulationResults(session.simulationClock);

        console.log(`[Odyssey] Level ${levelId} completed!`, results);
        await this._drainLevelSession(session);
        if (!this._isLevelSessionCurrent(session, retirementGeneration)) return;

        // Calculate final metrics
        hybridEngine?.updateScore(gameState.score || 0);
        const metrics = hybridEngine?.getMetrics() || {};
        const finalResults = {
            score: gameState.score,
            time: metrics.time,
            lines: metrics.lines,
            cascades: metrics.cascades,
            maxCascadeDepth: metrics.maxCascadeDepth,
            combo: metrics.combos,
            tetrises: metrics.tetrises,
            ...results,
        };

        // Calculate stars
        const stars = this._calculateStars(finalResults, hybridEngine);
        finalResults.stars = stars;

        // Evaluate bonuses
        const bonuses = this._evaluateBonuses(finalResults, hybridEngine);
        finalResults.bonuses = bonuses;

        if (writesLegacyResults) {
            // The campaign save and Steam boards do not yet carry a simulation
            // version. Unknown clocks fail closed alongside fixed60-v1.
            this.odysseyState.completeLevel(levelId, finalResults);
            this._syncSteamStats(finalResults, session).catch((err) => {
                console.warn('[Odyssey] Steam stats sync failed:', err.message);
            });
        }

        // Show results
        await this._showLevelResults({
            ...finalResults,
            ...(!writesLegacyResults ? {
                simulationClock: session.simulationClock,
                unranked: true,
            } : {}),
        }, session);
        if (!this._isLevelSessionCurrent(session, retirementGeneration)) return;

        // Return to board view
        await this.returnToBoard();
    }

    /**
     * Fail the current level
     * @param {string} reason - Failure reason
     */
    async failLevel(reason = 'top-out') {
        // Prevent multiple completions/failures
        const session = this._activeLevelSession;
        if (this.levelCompleting || !this._isLevelSessionActive(session)) return;
        this.levelCompleting = true;
        const { retirementGeneration } = this._retireLevelSession(session);

        console.log(`[Odyssey] Level ${session.levelId} failed: ${reason}`);
        await this._drainLevelSession(session);
        if (!this._isLevelSessionCurrent(session, retirementGeneration)) return;

        // Victory Lap System: Clean up (in case of time failure during victory lap)
        this._hideGoalCompleteOverlay();
        this._removeVictoryLapInputs();

        if (canWriteLegacySimulationResults(session.simulationClock)) {
            this.odysseyState.recordAttempt(session.levelId);
        }

        // Show failure screen and honor the player's choice.
        const { choice, modal } = await this._showLevelFailure(reason, session);
        if (!this._isLevelSessionCurrent(session, retirementGeneration)) {
            modal?.remove?.();
            return;
        }

        if (choice === 'retry') {
            // Instant in-place restart of the same level — no board round-trip.
            await this._restartLevelInPlace(modal);
            return;
        }

        // "Back to Map" (or dismissed): tear down the modal and return to the board.
        modal?.remove?.();
        await this.returnToBoard();
    }

    /**
     * Restart the just-failed level instantly, in place.
     *
     * Reuses the gameplay surface, theme, and 3D board that are already live, so
     * there is NO journey-return + journey-entry round-trip (the slow ~10-14s path).
     * A short veil masks the board reset, then the standard "Ready… Go!" cue leads
     * into the fresh run — the same hand-off the normal level entry uses.
     * @private
     * @param {HTMLElement|null} failureModal - Failure modal to tear down under the veil.
     */
    async _restartLevelInPlace(failureModal = null) {
        if (!this.currentLevelConfig) {
            console.warn('[Odyssey] Retry requested without an active level — returning to board');
            failureModal?.remove?.();
            await this.returnToBoard();
            return;
        }

        this._levelAttemptNumber = (Number(this._levelAttemptNumber) || 1) + 1;
        console.log(`[Odyssey] Retrying level ${this.currentLevelId} in place (attempt ${this._levelAttemptNumber})`);

        this.entryPhase = 'preparing';

        // Fade an opaque veil in over the failure modal so the board reset is unseen.
        const veil = this._mountRetryVeil();
        veil.getBoundingClientRect(); // force reflow so the opacity transition actually plays
        veil.style.opacity = '1';
        await this._wait(this.RETRY_VEIL_FADE_MS);

        // Modal is now hidden beneath the veil — safe to remove without a flash.
        failureModal?.remove?.();

        // Rebuild gameplay state for the same level (no theme/board/shader recompile).
        const prepared = await this.prepareLevelStart();
        if (!prepared) {
            console.warn('[Odyssey] Retry failed to prepare level — returning to board');
            this._clearRetryVeil();
            await this.returnToBoard();
            return;
        }

        // Reveal the fresh board.
        veil.style.opacity = '0';
        await this._wait(this.RETRY_VEIL_FADE_MS);
        this._clearRetryVeil();

        // Standard "Ready… Go!" beat, then hand control back to the player.
        await this.showLevelStartCue(this.currentLevelConfig, this.gameState);
        this.beginLevelRun();
    }

    /**
     * Mount the dark veil used to mask an in-place retry's board reset.
     * @private
     */
    _mountRetryVeil() {
        this._clearRetryVeil();
        const veil = document.createElement('div');
        veil.id = 'odyssey-retry-veil';
        veil.dataset.odysseyWheelLock = 'true';
        veil.style.cssText = `
            position: fixed;
            inset: 0;
            pointer-events: auto;
            opacity: 0;
            z-index: 10001;
            background:
                radial-gradient(circle at 50% 42%, rgba(255, 150, 120, 0.05), rgba(0, 0, 0, 0) 22%),
                radial-gradient(circle at 50% 50%, rgba(16, 10, 16, 0.94), rgba(0, 0, 0, 0.99) 72%);
            transition: opacity ${this.RETRY_VEIL_FADE_MS}ms ease-out;
        `;
        document.body.appendChild(veil);
        this._retryVeil = veil;
        return veil;
    }

    /**
     * Remove the retry veil if present.
     * @private
     */
    _clearRetryVeil() {
        if (this._retryVeil) {
            this._retryVeil.remove();
            this._retryVeil = null;
        }
    }

    /**
     * Resolve after `ms` milliseconds.
     * @private
     */
    _wait(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, Math.max(0, ms));
        });
    }

    /**
     * Return to the board view (level selection)
     */
    async returnToBoard() {
        console.log('[Odyssey] Returning to board view...');
        this._perfMark('odyssey-return-start');
        const completedLevelId = this.currentLevelId;
        const completedLevelConfig = this.currentLevelConfig;
        const departureAnchor = this._resolveJourneyReturnDepartureAnchor();
        const palette = this._buildJourneyEntryPalette(completedLevelConfig);
        const timings = this._buildJourneyReturnTimings(completedLevelConfig);
        const qualityPreset = window.settings?.effectQuality || 'High';
        const session = this._retireLevelSession();
        const retirementGeneration = session?.retirementGeneration;
        if (session?.gameState?.latestPhysicsPromise) {
            await this._drainLevelSession(session);
        }
        if (session && !this._isLevelSessionCurrent(session, retirementGeneration)) return false;

        this.entryPhase = 'idle';
        this.themeRevealToken += 1;
        this.pendingThemeFullReadyPromise = null;
        this._clearNeutralThemeFallbackBackdrop({ immediate: true });
        this._clearLevelThemePrefetchTimer();
        this._clearGameplayRevealState();
        this._clearLevelStartCue({ resolveValue: false });
        this._clearBoardReturnFallbackVeil({ immediate: true });

        if (!this.journeyReturnTransition) {
            this.journeyReturnTransition = new JourneyReturnTransition();
        }

        const transitionResult = await this.journeyReturnTransition.play({
            departureAnchor,
            arrivalAnchor: {
                x: 0.5, y: 0.5, radius: 0.14, onScreen: true,
            },
            palette,
            timings,
            qualityPreset,
            callbacks: {
                onBlackoutReached: async () => {
                    this._hideGameplaySurfaceForBoardReturn();
                    this.deps?.themeManager?.suspendThemes?.();

                    await this.onStop();

                    this.currentLevelId = null;
                    this.currentLevelConfig = null;
                    this.gameState = null;
                    this.isInBoardView = true;

                    await this._applyBoardAudioPolicy({ restoreTrack: true });
                    await this._showBoardView({
                        showLoadingOverlay: false,
                        minOverlayDisplayMs: 0,
                        focusLevelId: completedLevelId,
                        keepBoardLocked: true,
                    });
                    // Phase 0 metric: how long the board took to become ready on return.
                    // Parked (kept-alive) = a few hundred ms; full rebuild = ~3.5-4.2s.
                    this._perfMeasure('odyssey-return-board-ready', 'odyssey-return-start');

                    return {
                        arrivalAnchor: this._resolveJourneyReturnArrivalAnchor(completedLevelId),
                    };
                },
                onRevealStart: async () => {
                    this._unlockOdysseyBoardAfterLaunchAttempt();
                    this.setOdysseyNavigatorButtonVisible(true);
                    return true;
                },
                onComplete: async () => {
                    this.entryPhase = 'idle';
                    this._clearBoardReturnFallbackVeil({ immediate: true });
                    this._restoreInputs();
                },
                onAbort: async (abortResult) => {
                    console.warn('[Odyssey] Journey return aborted:', abortResult?.reason || 'unknown', abortResult?.error || '');
                    this.entryPhase = 'idle';
                    await this._fallbackToBoardAfterReturnAbort(completedLevelId);
                    this._restoreInputs();
                },
            },
        });

        return !!transitionResult?.success;
    }

    async _focusBoardLevelForLaunch(levelId, options = {}) {
        const {
            updatePreview = true,
            settle = true,
        } = options;

        const requestedLevelId = Number(levelId);
        if (!Number.isFinite(requestedLevelId)) {
            return false;
        }

        if (settle && this.boardController?.travelToLevel) {
            try {
                await this.boardController.travelToLevel(requestedLevelId);
            } catch (error) {
                console.warn('[Odyssey] Board focus failed before launch:', error);
            }
        } else if (this.boardController?.focusOnLevel) {
            this.boardController.focusOnLevel(requestedLevelId);
        }

        this.selectedLevelId = requestedLevelId;
        if (updatePreview) {
            this._updateLevelPreview(requestedLevelId);
        }

        return true;
    }

    async _launchLevelFromNavigator(levelId) {
        const requestedLevelId = Number(levelId);
        if (!Number.isFinite(requestedLevelId) || this.isEnteringLevel) {
            return false;
        }

        await this._focusBoardLevelForLaunch(requestedLevelId, {
            updatePreview: true,
            settle: true,
        });
        this.closeOdysseyNavigator({ restoreBoardPreview: false });
        return this.launchOdysseyLevel(requestedLevelId, { source: 'selector' });
    }

    /**
     * Navigate to a specific chapter
     * @param {number} chapterId
     */
    async navigateToChapter(chapterId) {
        console.log(`[Odyssey] Navigating to chapter ${chapterId}`);
        await this.boardController?.panToChapter?.(chapterId, 1800);
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
    _createGameStateForLevel(levelConfig, generation = this._levelSessionGeneration, seed = undefined) {
        const { mechanics } = levelConfig;
        const simulationClock = this._latchSimulationClock();
        const usesFixedRules = simulationClock === DEMO_FIXED_SIMULATION_CLOCK;

        // New level → the hybridEngine is reconfigured below, so the cached physics-callback
        // wrapper (bound to the previous level's engine) must be rebuilt (masterplan §2 #9).
        this._physicsCallbacks = null;

        // Phase 2: Use GameplayHybridEngine to create configured GameState.
        // NOTE: createGameState() already seeds starting garbage rows deterministically
        // via seedStartingRows() (GameplayHybridEngine.js). A previous mode-side
        // _addStartingRows() call here double-seeded the board — the two hole patterns
        // intersected so most seeded rows started completely full and the first lock
        // mass-cleared them, gutting the dig/boss level design. Removed 2026-07 (masterplan §2 #1).
        const hybridEngine = new GameplayHybridEngine();
        hybridEngine.configure(levelConfig);
        let gameState;
        if (usesFixedRules) {
            const settings = this.deps.settingsManager?.get?.() || {};
            const prefersReducedMotion = prefersOdysseyReducedMotion(this, settings);
            const isInfinityBased = mechanics.baseMode === 'infinity'
                || mechanics.baseMode === 'hybrid';
            const startingRows = Math.max(0, Number(mechanics.board.startingRows) || 0);
            gameState = hybridEngine.createGameState({
                inputHandling: settings,
                hitStopEnabled: !prefersReducedMotion,
                rngSeed: seed === undefined ? generateSessionSeed() : seed,
                ...(isInfinityBased ? {
                    infinitySpawnPolicy: INFINITY_SPAWN_POLICY_BOARD_ANCHOR_V1,
                    // Include authored garbage below the presentation viewport.
                    // This preserves legacy's first spawn anchor without allowing
                    // Phaser camera interpolation to own simulation state.
                    infinityVisibleRows: this.visibleRows + startingRows,
                } : {}),
            });
            // Publish the virtual window's deterministic initial bottom anchor.
            synchronizeInfinitySimulationCamera(gameState, gameState.board.length);
        } else {
            // Preserve the exact legacy HybridEngine call contract while flag-off.
            gameState = hybridEngine.createGameState();
        }
        const session = createOdysseyLevelSession({
            gameState,
            generation,
            hybridEngine,
            levelConfig,
            levelId: this.currentLevelId ?? levelConfig.id,
            rngDescriptor: gameState.rngDescriptor,
            simulationClock,
        });
        this.hybridEngine = hybridEngine;
        this.gameState = gameState;
        this._activeLevelSession = session;

        console.log(`[Odyssey] GameState created via HybridEngine: mode=${mechanics.baseMode}, rows=${mechanics.board.rows}, startLevel=${this.gameState.level}`);
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
     * Prepare the gameplay scene so the first visible frame is already stable.
     * @private
     */
    async prepareLevelStart() {
        if (!this.currentLevelConfig) {
            console.warn('[Odyssey] Cannot prepare level start without a level config');
            return false;
        }

        console.log('[Odyssey] Preparing level gameplay under blackout...');
        const levelConfig = this.currentLevelConfig;
        const previousSession = this._retireLevelSession();
        const preparationGeneration = this._levelSessionGeneration;
        await this._drainLevelSession(previousSession);
        if (
            preparationGeneration !== this._levelSessionGeneration
            || this.currentLevelConfig !== levelConfig
        ) return false;

        // Reset completion flag for new level
        this.levelCompleting = false;
        this.levelPrepared = false;
        this.levelRunStarted = false;
        this.levelStartTime = null;
        this.isRunning = false;
        this.isPaused = false;
        this.entryPhase = 'preparing';

        this._restoreInputs();
        this._cleanupOdysseyHUD();
        this._cleanupMinimap();
        this._createGameStateForLevel(levelConfig, preparationGeneration);
        const session = this._activeLevelSession;

        // Check if this is a tall board level
        const boardRows = this.currentLevelConfig?.mechanics?.board?.rows || 20;
        const isTallBoard = boardRows >= this.MINIMAP_ROW_THRESHOLD;

        // Apply infinity layout for tall boards
        this._applyInfinityLayout(isTallBoard);
        if (isTallBoard) {
            console.log(`[Odyssey] Applied infinity layout for ${boardRows}-row board`);
        }

        // Show Phaser board scene and store reference
        this._startPhaserBoardScene();
        this.boardScene = this._getBoardScene();
        this._clearPhaserBoard();
        this.boardScene?.syncFromGameState?.(this.gameState);

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
            projectInfinityPresentationCamera(this.gameState, spawnRow);
            console.log(`[Odyssey] Camera configured for ${boardRows}-row board, garbage=${startingGarbageRows}, positioned at row ${spawnRow}`);
        }

        // Initialize piece bag
        fillBag(this.gameState.nextPieces, this.gameState.randomGenerator);

        // Spawn first piece
        this.gameState.lastTime = performance.now();
        spawnPiece(
            session.gameState,
            () => {
                if (this._isLevelSessionActive(session)) this._refreshNextQueue();
            },
            () => this._handleGameOver(session),
        );
        this.boardScene?.syncFromGameState?.(this.gameState);

        // Update UI
        this._refreshNextQueue();
        this._updateStats();

        // Phase 6: Initialize and show Odyssey HUD
        this._initializeOdysseyHUD();

        // Initialize minimap for tall boards
        this._initializeMinimap();

        // Prewarm the active theme's gameplay-effect pipelines under the blackout (flag
        // ?odysseyEffectWarm=1, default OFF) so they don't compile on first-use during play — the
        // recurring frame-tail spikes. See src/rendering/odyssey/effect-prewarm.js. Byte-identical
        // to today until the flag is set + verified in-game.
        if (isEffectWarmEnabled()) {
            await prewarmActiveThemeEffects(this.deps?.themeManager?.activeTheme);
        }

        this.levelPrepared = true;
        this.entryPhase = 'prepared';
        console.log('[Odyssey] Gameplay prepared and waiting for reveal');
        return true;
    }

    /**
     * Start the live gameplay loop once the reveal is actually playable.
     * @private
     */
    beginLevelRun() {
        const session = this._activeLevelSession;
        if (
            !this.levelPrepared
            || this.levelRunStarted
            || !this._isLevelSessionActive(session)
        ) {
            return false;
        }

        console.log('[Odyssey] Beginning level run...');
        try {
            this._hookInputs();
            session.gameState.isPaused = false;
            session.gameState.lastTime = session.simulationClock === DEMO_FIXED_SIMULATION_CLOCK
                ? session.gameState.simTimeMs
                : performance.now();
            this.levelStartTime = Date.now();
            this.levelPausedMs = 0;
            this._pauseStartedAt = null;
            this._startLevelTimer(session);
            this._startGameLoop(session);
        } catch (error) {
            this._retireLevelSession(session);
            this._drainLevelSession(session);
            throw error;
        }
        this.isRunning = true;
        this.isPaused = false;
        this.levelRunStarted = true;
        this.entryPhase = 'running';
        return true;
    }

    /**
     * Backward-compatible wrapper for older callsites.
     * @private
     */
    async _startLevel() {
        const prepared = await this.prepareLevelStart();
        if (!prepared) {
            return false;
        }

        return this.beginLevelRun();
    }

    _cleanupPreparedLevelStart() {
        const session = this._retireLevelSession();
        this._drainLevelSession(session);

        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        this._cleanupOdysseyHUD();
        this._cleanupMinimap();
        this._applyInfinityLayout(false);
        this.isTallBoard = false;
        this._restoreInputs();
        this._stopPhaserBoardScene();
        this.boardScene = null;
        this._clearLevelStartCue({ resolveValue: false });
        this.levelPrepared = false;
        this.levelRunStarted = false;
        this.levelStartTime = null;
        this.isRunning = false;
        this.isPaused = false;
        this.entryPhase = 'idle';
    }

    /**
     * Start the game loop
     * @private
     */
    _startGameLoop(session = this._activeLevelSession) {
        if (!this._isLevelSessionActive(session)) return;
        const { gameState, levelConfig } = session;
        const usesFixedLoop = this._fixedTickEnabled
            && session.simulationClock === DEMO_FIXED_SIMULATION_CLOCK;

        // Cancel any existing loop
        if (gameState.animationId) {
            cancelAnimationFrame(gameState.animationId);
            gameState.animationId = null;
        }
        this._stopFixedTickSession();

        const { frameRateController } = this.deps;
        if (frameRateController?.isRunning) {
            frameRateController.stopHybridLoop();
        }

        this.lastStatsUpdateTime = performance.now();

        const drawCallback = () => {
            if (!this._isLevelSessionActive(session)) return;
            const boardScene = this._getBoardScene();
            if (boardScene) {
                boardScene.syncFromGameState(gameState);

                // Update camera position for tall boards
                if (
                    !usesFixedLoop
                    && boardScene.cameraSettings
                    && !boardScene.cameraSettings.manualControl
                ) {
                    this._updateCameraPosition();
                }
            }
        };

        const statsCallback = () => {
            if (!this._isLevelSessionActive(session)) return;
            const now = performance.now();
            if (now - this.lastStatsUpdateTime >= this.statsUpdateInterval) {
                this.lastStatsUpdateTime = now;
                if (usesFixedLoop) {
                    // Fixed render is presentation-only; score evaluation occurs at
                    // the canonical tick boundary below.
                    updateStats(gameState);
                } else {
                    this._updateStats();
                }

                // Phase 6: Update Odyssey HUD with current metrics
                this._updateOdysseyHUD();

                // Update minimap for tall boards
                this._updateMinimap();
            }

            if (usesFixedLoop) return;

            // Legacy simulation decisions retain their established render cadence.
            this._checkVictoryConditions();

            // Check failure conditions for tall boards (Infinity Mode logic)
            if (levelConfig?.mechanics?.baseMode === 'infinity' || this.isTallBoard) {
                if (!gameState.isGameOver && checkInfinityGameOver(gameState)) {
                    console.log('[Odyssey] Game over condition met (Board Full)');
                    gameState.isGameOver = true;
                    this._handleGameOver(session);
                }
            }
        };

        const playDropCallback = () => this.deps.soundManager?.sfxPlayer?.playDrop();
        const physicsCallbacks = this._getPhysicsCallbacks(session);

        if (usesFixedLoop) {
            this.usingHybridLoop = true;
            console.log('[Odyssey] Using canonical 60 Hz simulation clock');
            gameState.lastTime = gameState.simTimeMs;
            const loop = startOdysseyModeFixedTickLoop(this, session, {
                physicsCallbacks,
                playDropCallback,
                render: () => {
                    drawCallback();
                    statsCallback();
                },
            });
            this._fixedTickLoop = loop;
            this._fixedTickOwnership = loop.ownership;
            this._fixedTickInputBinding = loop.inputBinding;
        } else if (frameRateController?.needsHybridMode()) {
            this.usingHybridLoop = true;
            console.log('[Odyssey] Using hybrid loop for high FPS target');

            const logicUpdate = (time, _delta) => { // eslint-disable-line no-unused-vars -- preserve legacy callback arity
                if (!this._isLevelSessionActive(session) || gameState.isGameOver || gameState.isPaused) return;

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
            console.log('[Odyssey] Using standard RAF loop');

            gameLoop(
                performance.now(),
                gameState,
                drawCallback,
                statsCallback,
                playDropCallback,
                physicsCallbacks,
            );
        }
    }

    _applyFixedCommand(command, context) {
        const { gameState, session } = context;
        return applyOdysseyFixedCommand(command, {
            ...context,
            isEnabled: () => (
                this._fixedTickEnabled
                && this.isRunning
                && !this.isPaused
                && this._isLevelSessionActive(session)
                && this._fixedTickOwnership?.gameState === gameState
            ),
            juice: this.boardJuice,
            soundPlayer: this.deps.soundManager?.sfxPlayer,
        });
    }

    _stopFixedTickSession() {
        const loop = this._fixedTickLoop;
        this._fixedTickLoop = null;
        this._fixedTickOwnership = null;
        this._fixedTickInputBinding = null;
        loop?.stop();
    }

    /**
     * Get physics callbacks
     * @private
     */
    _getPhysicsCallbacks(session = this._activeLevelSession) {
        if (!this._isLevelSessionActive(session)) return {};
        if (session.physicsCallbacks) return session.physicsCallbacks;
        session.physicsCallbacks = createOdysseyPhysicsCallbacks(this, session);
        this._physicsCallbacks = session.physicsCallbacks;
        return session.physicsCallbacks;
    }

    // =============================
    // Private: Victory/Failure
    // =============================

    /**
     * Check if victory conditions are met
     * @private
     */
    _checkVictoryConditions(session = this._activeLevelSession) {
        // Skip if already completing or no level config
        if (this.levelCompleting || !this._isLevelSessionActive(session)) return;
        const { gameState, hybridEngine } = session;

        // Phase 2: Use hybridEngine for victory/failure checking
        if (hybridEngine.checkVictory()) {
            // Victory Lap System: Don't end level immediately, enter victory lap
            if (!gameState.goalComplete) {
                console.log('[Odyssey] Goal complete! Entering Victory Lap...');
                this._enterVictoryLap(session);
            }
            // During victory lap, victory conditions are already met - just keep playing
            return;
        }

        if (hybridEngine.checkFailure()) {
            this.failLevel('time');
        }
    }

    /**
     * Enter victory lap mode - goal is complete but player can keep playing for stars
     * @private
     */
    _enterVictoryLap(session = this._activeLevelSession) {
        if (!this._isLevelSessionActive(session)) return;
        session.gameState.goalComplete = true;
        session.gameState.victoryLapActive = true;
        session.gameState.victoryLapStartTime = performance.now();

        // Show goal complete overlay
        this._showGoalCompleteOverlay();

        // Trigger theme combo effects for victory celebration
        emitCombo({ comboCount: 10 });
        emitLineClear({ lineCount: 4, comboCount: 10 });

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
        const session = this._activeLevelSession;
        if (!this._isLevelSessionActive(session) || !session.gameState.victoryLapActive) return;

        console.log('[Odyssey] Victory lap finished, completing level...');
        session.gameState.victoryLapActive = false;

        // Hide overlay
        this._hideGoalCompleteOverlay();

        // Remove victory lap input handler
        this._removeVictoryLapInputs();

        // Emit event
        eventBus.emit(EVENTS.ODYSSEY_VICTORY_LAP_END, {
            levelId: session.levelId,
            metrics: session.hybridEngine.getMetrics(),
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
        // View extracted to ui/odyssey/GoalCompleteOverlay.js (E1). OdysseyMode keeps the
        // lifecycle (stores the element so _hideGoalCompleteOverlay can remove it).
        this._hideGoalCompleteOverlay();
        this._goalCompleteOverlay = createGoalCompleteOverlay();
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
    _calculateStars(_results, hybridEngine = this.hybridEngine) {
        // Phase 2: Use hybridEngine for star calculation
        return hybridEngine.calculateStars();
    }

    /**
     * Evaluate bonus objectives
     * @private
     */
    _evaluateBonuses(_results, hybridEngine = this.hybridEngine) {
        // Phase 2: Use hybridEngine for bonus evaluation
        return hybridEngine.evaluateBonuses();
    }

    /**
     * Handle game over (top-out)
     * @private
     */
    async _handleGameOver(session = this._activeLevelSession) {
        if (!this._isLevelSessionActive(session)) return;
        console.log('[Odyssey] Game over (top-out)');

        // Victory Lap System: During victory lap, top-out completes the level (not a failure)
        if (session.gameState.victoryLapActive) {
            console.log('[Odyssey] Top-out during victory lap - completing level with current progress');
            this._finishVictoryLap();
            return;
        }

        // Top-out fails the level. (E5: the former per-level `failureType` branch was dead — both
        // arms called failLevel('top-out') — so it collapses to this single call. Re-introduce a
        // real branch here if a level ever needs a non-failure top-out.)
        await this.failLevel('top-out');
    }

    // =============================
    // Private: UI
    // =============================

    /**
     * Show odyssey-specific UI
     * @private
     */
    _showOdysseyUI() {
        this._ensureOdysseyNavigatorButton();

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

        // ═══════════════════════════════════════════════════════════════════
        // IMMEDIATELY hide game-specific UI elements so they don't flash
        // while the 3D Odyssey board is loading asynchronously.
        // These are revealed later by _showGameplayView() when entering a level.
        // ═══════════════════════════════════════════════════════════════════
        const gameContainer = document.getElementById('single-player-container');
        if (gameContainer) {
            gameContainer.style.opacity = '0';
            gameContainer.style.visibility = 'hidden';
        }

        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.opacity = '0';
            phaserContainer.style.visibility = 'hidden';
        }

        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.opacity = '0';
            statsBar.style.visibility = 'hidden';
        }

        const bgContainer = document.querySelector('.background-container');
        if (bgContainer) {
            bgContainer.style.opacity = '0';
        }

        // ═══════════════════════════════════════════════════════════════════
        // CINEMATIC LOADING OVERLAY
        // Shows an animated starfield + title while the 3D board loads.
        // Removed by _onBoardReady() with a smooth crossfade.
        // ═══════════════════════════════════════════════════════════════════
        this._showCinematicLoadingOverlay();
    }

    _ensureOdysseyNavigatorButton() {
        if (this.odysseyNavigatorButton?.isConnected) {
            return this.odysseyNavigatorButton;
        }

        let button = document.getElementById('odyssey-navigator-btn');
        if (!button) {
            button = document.createElement('div');
            button.id = 'odyssey-navigator-btn';
            button.className = 'odyssey-navigator-icon';
            button.setAttribute('role', 'button');
            button.setAttribute('aria-label', 'Open Odyssey Navigator');
            button.setAttribute('tabindex', '0');
            button.innerHTML = `
                <svg class="odyssey-navigator-icon-svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 20L8 10L13 15L21 4" fill="none" stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" stroke-linejoin="round" />
                    <polyline points="16 4 21 4 21 9" fill="none" stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="8" cy="10" r="1.5" fill="currentColor" />
                    <circle cx="13" cy="15" r="1.5" fill="currentColor" />
                    <circle cx="21" cy="4" r="1.5" fill="currentColor" />
                </svg>
                <div class="odyssey-navigator-icon-glow"></div>
            `;
            document.body.appendChild(button);
        }

        if (!this.odysseyNavigatorButtonHandlersBound) {
            button.addEventListener('click', () => {
                if (this._isOdysseyNavigatorOpen()) {
                    this.closeOdysseyNavigator();
                    return;
                }

                this.openOdysseyNavigator();
            });
            button.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    button.click();
                }
            });
            this.odysseyNavigatorButtonHandlersBound = true;
        }

        this.odysseyNavigatorButton = button;
        return button;
    }

    _isOdysseyNavigatorOpen() {
        const selector = document.getElementById('odyssey-level-select');
        return !!selector && selector.style.display !== 'none';
    }

    setOdysseyNavigatorButtonVisible(isVisible) {
        const button = this._ensureOdysseyNavigatorButton();
        button.classList.toggle('visible', !!isVisible);
        if (!isVisible) {
            button.classList.remove('active');
        }
    }

    openOdysseyNavigator() {
        if (!this.isInBoardView || this.isEnteringLevel) {
            return;
        }

        this._showLevelSelectUI();
        this._setBoardOverlaySuppressed(true);
        this.setOdysseyNavigatorButtonVisible(true);
        this.odysseyNavigatorButton?.classList.add('active');
    }

    closeOdysseyNavigator(options = {}) {
        const { restoreBoardPreview = true } = options;

        this._hideLevelSelectUI();
        this._setBoardOverlaySuppressed(false);
        this.odysseyNavigatorButton?.classList.remove('active');

        if (restoreBoardPreview && Number.isFinite(this.selectedLevelId)) {
            this._updateLevelPreview(this.selectedLevelId);
        }
    }

    _setBoardOverlaySuppressed(isSuppressed) {
        const overlay = document.getElementById('odyssey-board-overlay');
        if (!overlay) {
            return;
        }

        if (isSuppressed) {
            overlay.style.visibility = 'hidden';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            return;
        }

        overlay.style.visibility = '';
        overlay.style.opacity = '';
        overlay.style.pointerEvents = '';
    }

    /**
     * Show cinematic loading overlay with animated stars and title
     * @private
     */
    _showCinematicLoadingOverlay() {
        const result = showCinematicLoadingOverlay('ODYSSEY');
        this._overlayShownAt = result.shownAt;
    }

    /**
     * Smoothly remove the cinematic loading overlay (crossfade to 3D board).
     * @private
     */
    _dismissCinematicLoadingOverlay({ minVisibleMs = 800 } = {}) { // OD-07: options form avoids the 2000ms floor
        return dismissCinematicLoadingOverlay({ fadeOutMs: 800, minVisibleMs });
    }

    /**
     * Hide odyssey UI
     * @private
     */
    _hideOdysseyUI() {
        this.closeOdysseyNavigator({ restoreBoardPreview: false });
        this.setOdysseyNavigatorButtonVisible(false);
    }

    /**
     * Show board view (level selection)
     * @private
     */
    async _showBoardView(options = {}) {
        const {
            focusLevelId = this.selectedLevelId,
            keepBoardLocked = false,
            // Startup optimization: was 5000 → 1500 → 800. The board init is the real pacing;
            // the floor only guards against a jarringly instant flash on warm re-entries, and
            // ~800ms is enough for that once the dismiss animation is counted (masterplan A9).
            minOverlayDisplayMs = 800,
            showLoadingOverlay = true,
        } = options;

        console.log('[Odyssey] Showing board view');
        const boardViewMark = 'odyssey:mode:board-view';
        const boardInitMark = 'odyssey:mode:board-init';
        const focusMark = 'odyssey:mode:focus-selected-level';
        const overlayWaitMark = 'odyssey:mode:overlay-wait';
        const overlayDismissMark = 'odyssey:mode:overlay-dismiss';
        this._perfMark(boardViewMark);

        // Initialize Three.js Odyssey Board if not exists
        this._perfMark(boardInitMark);
        await this._initializeOdysseyBoard();
        this._perfMeasure('odyssey:mode:board-init', boardInitMark);
        this.closeOdysseyNavigator({ restoreBoardPreview: true });
        this._restoreBoardOverlayAfterLaunchAttempt();

        this._perfMark(focusMark);
        if (Number.isFinite(focusLevelId)) {
            await this._focusBoardLevelForLaunch(focusLevelId, {
                updatePreview: true,
                settle: false, // OD-08: reveal now, camera travels visibly after (was awaited under overlay)
            });
        } else if (Number.isFinite(this.selectedLevelId)) {
            this._updateLevelPreview(this.selectedLevelId);
        }
        this._perfMeasure('odyssey:mode:focus-selected-level', focusMark);

        if (keepBoardLocked) {
            this._lockOdysseyBoardForLaunch();
        } else {
            this._unlockOdysseyBoardAfterLaunchAttempt();
            this.setOdysseyNavigatorButtonVisible(true);
        }

        // Phase 3: Using 3D board as primary level selector
        // The HTML UI is disabled - 3D board handles level selection via click
        // this._showLevelSelectUI();
        this._stopPhaserBoardScene();

        if (showLoadingOverlay) {
            this._perfMark(overlayWaitMark);
            const elapsed = Date.now() - (this._overlayShownAt || 0);
            const remaining = Math.max(0, minOverlayDisplayMs - elapsed);

            if (remaining > 0) {
                await new Promise((resolve) => { setTimeout(resolve, remaining); });
            }
            this._perfMeasure('odyssey:mode:overlay-wait', overlayWaitMark);

            this._perfMark(overlayDismissMark);
            await this._dismissCinematicLoadingOverlay({ minVisibleMs: minOverlayDisplayMs }); // OD-07: mode floor
            this._perfMeasure('odyssey:mode:overlay-dismiss', overlayDismissMark);
            // Startup trace: the user-perceived "board visible" moment (overlay fully gone).
            if (this._overlayShownAt) {
                console.log(`[OdysseyStartup] board visible ${Date.now() - this._overlayShownAt}ms after overlay show`);
            }
        }
        this._perfMeasure('odyssey:mode:board-visible', boardViewMark);
        this._scheduleDeferredWarpPreinit();
        this.boardController?.startDeferredBackgroundLoading?.();

        return true;
    }

    /**
     * Initialize the Three.js Odyssey Board (build if needed, then reveal).
     * @private
     */
    async _initializeOdysseyBoard() {
        await this._buildOdysseyBoard();
        this._revealOdysseyBoard();
    }

    /**
     * Cold-start optimization: the chapter window to CREATE + COMPILE eagerly before the
     * board reveals — the player's reachable neighbourhood (chapter 1 through one past the
     * furthest unlocked chapter). The locked remainder loads in the background. Returns null
     * (load everything) when progress can't be resolved, so the fallback is the old behaviour.
     * @private
     */
    _computeEagerStartupChapters() {
        try {
            // Eager-CREATE only the reveal neighbourhood: the FOCUS chapter the board reveals
            // into (odysseyState.currentChapter — the same one fast-start warms, see the
            // OdysseyBoardController focusChapter option) ± 1. The rest load PROMPTLY in the
            // background (loadChaptersInBackground) a few seconds after reveal.
            //
            // Previously this was a PREFIX 1..furthest+1, so a late-game player (e.g. chapter 7)
            // eagerly created AND compiled ALL 8 chapters before reveal — cold start regressed with
            // progression (masterplan A1). A focus-centred window keeps the pre-reveal cost constant
            // regardless of how far the player has progressed. Creating all 8 up front was already
            // tried + reverted (it ballooned warm-up to ~22s / board-visible ~38s).
            const focusChapter = this.odysseyState?.currentChapter || 1;
            const chapterCount = (this.levelRegistry?.getPresentationLayout?.()?.chapterPositions?.length || 9) - 1;
            const lo = Math.max(1, focusChapter - 1);
            const hi = Math.min(Math.max(2, chapterCount), focusChapter + 1);
            const eager = [];
            for (let ch = lo; ch <= hi; ch += 1) {
                eager.push(ch);
            }
            return eager;
        } catch {
            return null;
        }
    }

    /**
     * Build the board controller exactly once; duplicate activation calls share the
     * same in-flight promise.
     * @private
     */
    async _buildOdysseyBoard() {
        if (this.boardController) {
            return; // Already built
        }
        if (this._boardBuildPromise) {
            await this._boardBuildPromise;
            return;
        }
        this._boardBuildPromise = this._runOdysseyBoardBuild();
        try {
            await this._boardBuildPromise;
        } finally {
            this._boardBuildPromise = null;
        }
    }

    /**
     * The actual board construction. This is only called from real Odyssey activation,
     * after the Odyssey loading overlay is already visible.
     * @private
     */
    async _runOdysseyBoardBuild() {
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
        this.boardController = new OdysseyBoardController(boardContainer, {
            editorMode: isOdysseyLayoutEditorEnabled(),
            soundManager: this.deps?.soundManager || null,
            // Cold-start: eagerly load only the player's reachable chapter neighbourhood
            // (chapter 1 .. furthest-unlocked + 1); the locked rest load in the background.
            startupChapters: this._computeEagerStartupChapters(),
            // The chapter the board reveals into — fast-start warms only this one.
            focusChapter: this.odysseyState?.currentChapter || 1,
        });

        // Prepare level data with path positions
        const levelData = this.levelRegistry.getAllLevelPresentations();
        const presentationLayout = this.levelRegistry.getPresentationLayout();

        // Get progress data
        // Build level progress from OdysseyStateManager
        const levelProgress = {};
        for (let i = 1; i <= this.levelRegistry.getTotalLevels(); i++) {
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
        await this.boardController.initialize(levelData, progressData, presentationLayout);

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
            if (!levelId || levelId === this.selectedLevelId) {
                return;
            }

            this._prefetchLikelyLevelThemes(levelId, {
                priority: 'low',
                includeAdjacent: false,
                trackAsCurrent: false,
            }).catch((error) => {
                console.warn('[Odyssey] Hover theme prefetch failed:', error);
            });
        };

        // Empty click hides the info panel
        this.boardController.onEmptyClick = () => {
            this.selectedLevelId = null;
            this._clearLevelThemePrefetchTimer();
            const panel = document.getElementById('odyssey-level-panel');
            if (panel) panel.classList.add('hidden');
        };

        this.boardController.onChapterArrival = (arrival) => {
            const track = arrival?.profile?.audioTrack || this.deps?.soundManager?.musicTrack || null;
            if (track) {
                this.boardTrackKey = track;
                this.boardTrackWasPlaying = true;
            }
            this._showChapterArrivalCue(arrival);
        };

        console.log('[Odyssey] Three.js board initialized');
    }

    _resolveWarpPreinitMode() {
        try {
            const raw = new URLSearchParams(window.location?.search || '').get('odysseyWarpPreinit');
            const mode = String(raw || '').trim().toLowerCase();
            if (mode === 'immediate' || mode === 'defer' || mode === 'off') {
                return mode;
            }
        } catch {
            // Default below.
        }
        return 'defer';
    }

    _preInitWarpTransition() {
        if (!this.transitionManager || this._warpPreinitComplete) return false;

        const warpMark = 'odyssey:mode:preinit-warp';
        this._perfMark(warpMark);
        this.transitionManager.preInitWarp();
        this._perfMeasure('odyssey:mode:preinit-warp', warpMark);
        this._warpPreinitComplete = true;
        return true;
    }

    _isBoardIdleForDeferredWarpPreinit() {
        const bc = this.boardController;
        if (!bc) return true;

        const pendingChapterLoads = bc.pendingChapterLoads?.size || 0;
        const pendingPrewarms = bc.prewarmQueue?.length || 0;
        const bgRenderWarmComplete = bc._bgRenderWarmComplete || !bc._bgRenderWarmStarted;
        return pendingChapterLoads === 0
            && pendingPrewarms === 0
            && !bc.isPrewarming
            && bgRenderWarmComplete
            && (!bc._canRunBackgroundTask || bc._canRunBackgroundTask());
    }

    _scheduleDeferredWarpPreinit({ delayMs = 5000 } = {}) {
        if (!this.transitionManager || this._warpPreinitScheduled || this._warpPreinitComplete) return;
        if (this._resolveWarpPreinitMode() !== 'defer') return;

        this._warpPreinitScheduled = true;
        const run = () => {
            this._deferredWarpPreinitTimer = null;
            if (!this.isActive || !this.isInBoardView) {
                this._warpPreinitScheduled = false;
                return;
            }
            if (!this._isBoardIdleForDeferredWarpPreinit()) {
                this._warpPreinitScheduled = false;
                this._scheduleDeferredWarpPreinit({ delayMs: 1200 });
                return;
            }
            this._preInitWarpTransition();
        };

        this._deferredWarpPreinitTimer = window.setTimeout(run, Math.max(0, delayMs));
    }

    _clearDeferredWarpPreinit() {
        if (!this._deferredWarpPreinitTimer) return;

        window.clearTimeout(this._deferredWarpPreinitTimer);
        this._deferredWarpPreinitTimer = null;
        this._warpPreinitScheduled = false;
    }

    /**
     * Bring a built board on screen, create the info overlay, and schedule transition warmup.
     * @private
     */
    _revealOdysseyBoard() {
        // A return-to-map is happening now — cancel any pending post-entry park so it can't
        // re-park the board we're about to resume (masterplan §2 #9).
        this._cancelBoardParkTimer();
        const revealMark = 'odyssey:mode:reveal-board';
        const containerMark = 'odyssey:mode:reveal-container';
        const overlayMark = 'odyssey:mode:create-board-overlay';
        this._perfMark(revealMark);

        this._perfMark(containerMark);
        const boardContainer = document.getElementById('odyssey-board-3d');
        if (boardContainer) {
            // `display` was set to 'none' when the board was parked (or hidden for the
            // entry transition); clear it so a kept-alive board re-appears on return.
            boardContainer.style.display = '';
            boardContainer.style.visibility = '';
            boardContainer.style.pointerEvents = 'auto';
        }

        // Resume a parked (kept-alive) board. No-op on a freshly built board —
        // resumeRendering() early-returns when the loop was never paused.
        if (this._boardParked) {
            this.boardController?.resumeRendering?.();
            this._boardParked = false;
            this._logBoardMemory('board-resumed');
        }
        this._perfMeasure('odyssey:mode:reveal-container', containerMark);

        if (this.deps?.soundManager?.musicTrack) {
            this.boardTrackKey = this.deps.soundManager.musicTrack;
            this.boardTrackWasPlaying = !this.deps.soundManager.isMuted;
        }

        // Create the info overlay (header + level panel)
        this._perfMark(overlayMark);
        this._createBoardInfoOverlay();
        this._perfMeasure('odyssey:mode:create-board-overlay', overlayMark);

        // Pre-initialize warp transition to avoid GPU init freeze later
        const warpPreinitMode = this._resolveWarpPreinitMode();
        if (warpPreinitMode === 'immediate') {
            this._preInitWarpTransition();
        } else if (warpPreinitMode === 'off') {
            console.log('[ThemeTransition] Warp renderer pre-init skipped');
        }
        this._perfMeasure('odyssey:mode:reveal-board', revealMark);
    }

    /**
     * Dispose the Odyssey Board
     * @private
     */
    _disposeOdysseyBoard() {
        this.boardViewReadyPromise = null;
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
     * Park the Odyssey board instead of disposing it (loading-optimization Phase 1).
     *
     * Keeps the WebGPU renderer, compiled pipelines, geometry, and textures GPU-resident
     * (rendering is already paused + the container hidden at the entry blackout) so that
     * returning to the map is a resume rather than a full cold-start rebuild. Only the
     * cheap DOM info overlay is torn down here; it is recreated by _revealOdysseyBoard().
     * @private
     */
    /**
     * Cancel the pending post-entry board-park timer, if any (masterplan §2 #9).
     * @private
     */
    _cancelBoardParkTimer() {
        if (this._boardParkTimer) {
            clearTimeout(this._boardParkTimer);
            this._boardParkTimer = null;
        }
    }

    _parkOdysseyBoard() {
        this.boardViewReadyPromise = null;
        if (!this.boardController) {
            return;
        }

        // Idempotent — rendering was already paused at the entry blackout (onBlackoutReached).
        this.boardController.pauseRendering?.();

        const boardContainer = document.getElementById('odyssey-board-3d');
        if (boardContainer) {
            boardContainer.style.display = 'none';
        }

        this._disposeInfoOverlay();
        this._boardParked = true;
        this._logBoardMemory('board-parked');
    }

    /**
     * Phase 0 instrumentation: log the board's resident GPU resource counts.
     * Counts, not bytes — cross-check chrome://gpu for true VRAM. Never throws.
     * @private
     */
    _logBoardMemory(label) {
        try {
            const info = this.boardController?.getMemorySnapshot?.();
            if (info) {
                console.log(`[OdysseyPerf] ${label} — geometries=${info.geometries} textures=${info.textures} renderCalls=${info.renderCalls}`);
            }
        } catch {
            // instrumentation must never break the flow
        }
    }

    /**
     * Phase 0 instrumentation: drop a User Timing mark. Never throws.
     * @private
     */
    _perfMark(name) {
        try {
            performance.mark(name);
        } catch {
            // ignore
        }
    }

    /**
     * Phase 0 instrumentation: measure from a previously-set mark to now and log it.
     * Never throws.
     * @private
     */
    _perfMeasure(label, startMark) {
        try {
            const measure = performance.measure(label, startMark);
            console.log(`[OdysseyPerf] ${label}: ${Math.round(measure.duration)}ms`);
        } catch {
            // ignore (e.g. start mark missing)
        }
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

        // View extracted to ui/odyssey/BoardInfoOverlay.js (E1); the wiring below needs mode
        // state (selectedLevelId / launchOdysseyLevel / header progress) so it stays here.
        const { overlay, style } = createBoardInfoOverlay();
        document.head.appendChild(style);
        document.body.appendChild(overlay);

        // Update header with current progress
        this._updateHeaderProgress();

        // Setup play button
        const playBtn = document.getElementById('level-panel-play-btn');
        playBtn.addEventListener('click', () => {
            const launchLevelId = this.selectedLevelId;
            if (!launchLevelId) {
                return;
            }

            playBtn.classList.add('clicked');
            playBtn.textContent = 'Launching...';
            this.launchOdysseyLevel(launchLevelId, { source: 'board-panel' });
        });
    }

    _showChapterArrivalCue(arrival = {}) {
        const chapterId = Number(arrival.chapterId);
        if (!Number.isFinite(chapterId)) return;

        const chapter = this.levelRegistry.getChapter(chapterId);
        const profile = arrival.profile || {};
        const card = document.getElementById('odyssey-chapter-arrival-card');
        if (!card || !chapter) return;

        const kicker = document.getElementById('odyssey-arrival-kicker');
        const title = document.getElementById('odyssey-arrival-title');
        const subtitle = document.getElementById('odyssey-arrival-subtitle');

        if (kicker) kicker.textContent = `Chapter ${chapterId}`;
        if (title) title.textContent = profile.name || chapter.name;
        if (subtitle) subtitle.textContent = chapter.subtitle || '';

        if (this.chapterArrivalCueTimer) {
            clearTimeout(this.chapterArrivalCueTimer);
            this.chapterArrivalCueTimer = null;
        }

        card.classList.remove('visible');
        requestAnimationFrame(() => {
            card.classList.add('visible');
        });

        this.chapterArrivalCueTimer = setTimeout(() => {
            card.classList.remove('visible');
            this.chapterArrivalCueTimer = null;
        }, 1900);
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

        const level = this.levelRegistry.resolveLevelPresentation(levelId);
        if (!level) {
            panel.classList.add('hidden');
            return;
        }

        // Store selected level
        this.selectedLevelId = levelId;

        // Preload selected level theme and likely neighbors while browsing.
        this._prefetchLikelyLevelThemes(level, {
            priority: 'low',
            includeAdjacent: true,
            trackAsCurrent: true,
        }).catch((error) => {
            console.warn('[Odyssey] Selected level theme prefetch failed:', error);
        });

        // Check if level is unlocked
        const isUnlocked = this.odysseyState.isLevelUnlocked(levelId);
        const completion = this.odysseyState.getLevelCompletion(levelId);
        const stars = completion?.stars || 0;

        // Update panel content
        document.getElementById('level-panel-number').textContent = `LEVEL ${levelId}`;
        document.getElementById('level-panel-name').textContent = level.pathLabel || level.name;
        document.getElementById('level-panel-chapter').textContent = `Chapter ${level.chapter}: ${this._getChapterName(level.chapter)}`;
        document.getElementById('level-panel-description').textContent = level.description || 'Complete the objectives to progress.';

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
        return this.levelRegistry.getChapterName(chapterId);
    }

    /**
     * Dispose the info overlay
     * @private
     */
    _disposeInfoOverlay() {
        if (this.chapterArrivalCueTimer) {
            clearTimeout(this.chapterArrivalCueTimer);
            this.chapterArrivalCueTimer = null;
        }
        const overlay = document.getElementById('odyssey-board-overlay');
        if (overlay) overlay.remove();
        const styles = document.getElementById('odyssey-board-overlay-styles');
        if (styles) styles.remove();
    }

    /**
     * Show gameplay view with smooth reveal animation
     * @private
     */
    _beginGameplayReveal(options = {}) {
        const fastReveal = !!(options.fastReveal ?? options.underPortalFlash);
        const revealDurationMs = fastReveal ? 420 : 1200;
        const revealDelayMs = fastReveal ? 0 : 50;
        const revealScaleStart = fastReveal ? 1.02 : 1.05;
        const statsDelayMs = fastReveal ? 120 : 300;
        const statsTransitionMs = Math.max(220, revealDurationMs - 80);
        const gameplayStartOpacity = 0;
        const phaserStartOpacity = 0;
        const backgroundStartOpacity = 0;
        const statsStartOpacity = 0;

        console.log('[Odyssey] Showing gameplay view with reveal animation');
        this.closeOdysseyNavigator({ restoreBoardPreview: false });
        this.setOdysseyNavigatorButtonVisible(false);

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
            gameContainer.style.opacity = String(gameplayStartOpacity);
            gameContainer.style.transform = `scale(${revealScaleStart})`;
            gameContainer.style.transition = `opacity ${revealDurationMs}ms ease-out, transform ${revealDurationMs}ms ease-out`;
        }

        // Also reveal Phaser container
        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.visibility = 'visible';
            phaserContainer.style.opacity = String(phaserStartOpacity);
            phaserContainer.style.transition = `opacity ${revealDurationMs}ms ease-out`;
        }

        if (statsBar) {
            statsBar.style.visibility = 'visible';
            statsBar.style.opacity = String(statsStartOpacity);
            statsBar.style.setProperty('display', 'flex', 'important');
            statsBar.style.transition = `opacity ${statsTransitionMs}ms ease-out ${statsDelayMs}ms`;
        }

        if (bgContainer) {
            bgContainer.style.opacity = String(backgroundStartOpacity);
            bgContainer.style.transition = `opacity ${revealDurationMs}ms ease-out`;
        }

        const revealState = {
            bgContainer,
            fastReveal,
            gameContainer,
            phaserContainer,
            revealDelayMs,
            revealDurationMs,
            revealScaleStart,
            statsBar,
            statsDelayMs,
            statsTransitionMs,
        };

        revealState.playablePromise = this._showGameplayPlayableReveal(revealState);
        revealState.uiPromise = this._finishGameplayUiReveal(revealState);
        this.gameplayRevealState = revealState;

        return revealState;
    }

    async _showGameplayPlayableReveal(revealState) {
        if (!revealState) {
            return false;
        }

        await new Promise((resolve) => { setTimeout(resolve, revealState.revealDelayMs); });
        if (this.gameplayRevealState !== revealState) {
            return false;
        }

        const {
            bgContainer,
            gameContainer,
            phaserContainer,
            statsBar,
        } = revealState;

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

        await new Promise((resolve) => { setTimeout(resolve, revealState.revealDurationMs); });
        if (this.gameplayRevealState !== revealState) {
            return false;
        }

        if (gameContainer) {
            gameContainer.style.transition = '';
            gameContainer.style.transform = '';
        }
        if (phaserContainer) {
            phaserContainer.style.transition = '';
        }
        if (bgContainer) {
            bgContainer.style.transition = '';
        }

        return true;
    }

    async _finishGameplayUiReveal(revealState) {
        if (!revealState) {
            return false;
        }

        const playableShown = await revealState.playablePromise;
        if (!playableShown || this.gameplayRevealState !== revealState) {
            return false;
        }

        const statsTailMs = Math.max(
            0,
            (revealState.statsDelayMs + revealState.statsTransitionMs) - revealState.revealDurationMs,
        );
        if (statsTailMs > 0) {
            await new Promise((resolve) => { setTimeout(resolve, statsTailMs); });
            if (this.gameplayRevealState !== revealState) {
                return false;
            }
        }

        if (revealState.statsBar) {
            revealState.statsBar.style.transition = '';
        }

        return true;
    }

    async _showGameplayView(options = {}) {
        const revealState = this._beginGameplayReveal(options);
        if (!revealState) {
            return false;
        }

        const playableShown = await revealState.playablePromise;
        if (!playableShown) {
            return false;
        }

        await revealState.uiPromise;
        return true;
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
        // View shell extracted to ui/odyssey/LevelSelectOverlay.js (E1). Only the back-button
        // handler needs mode state (_exitToMenu); _updateLevelSelectUI still fills the data.
        const container = createLevelSelectOverlay();

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
        const progressFill = document.getElementById('odyssey-progress-fill');
        if (progressFill) progressFill.style.width = `${progress.overallProgress}%`;

        // Build chapters
        const chaptersContainer = document.getElementById('odyssey-chapters');
        chaptersContainer.innerHTML = '';

        const chapters = this.levelRegistry.getAllChapters();

        for (const chapter of chapters) {
            const chapterProgress = this.odysseyState.getChapterProgress(chapter.id);
            const levels = this.levelRegistry.getLevelsInChapter(chapter.id);

            const chapterEl = document.createElement('div');
            chapterEl.className = 'odyssey-chapter';
            if (focusChapter === chapter.id) {
                chapterEl.classList.add('current');
            }
            if (chapterProgress.maxStars > 0 && chapterProgress.stars === chapterProgress.maxStars) {
                chapterEl.classList.add('complete');
            }
            chapterEl.innerHTML = `
                <div class="odyssey-chapter-header">
                    <span class="odyssey-chapter-name">Chapter ${chapter.id}: ${chapter.name}</span>
                    <span class="odyssey-chapter-stars">${chapterProgress.stars}/${chapterProgress.maxStars} ★</span>
                </div>
                <div class="odyssey-levels" id="odyssey-chapter-${chapter.id}-levels"></div>
            `;

            chaptersContainer.appendChild(chapterEl);

            const header = chapterEl.querySelector('.odyssey-chapter-header');
            if (header) {
                header.style.cursor = 'pointer';
                header.addEventListener('click', () => {
                    this.navigateToChapter(chapter.id).catch((error) => {
                        console.warn(`[Odyssey] Chapter navigation failed for ${chapter.id}:`, error);
                    });
                });
            }

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
                    btn.addEventListener('click', () => {
                        this._launchLevelFromNavigator(level.id).catch((error) => {
                            console.warn(`[Odyssey] Navigator launch failed for ${level.id}:`, error);
                        });
                    });
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
    }

    /**
     * Show level results
     * @private
     */
    async _showLevelResults(results, session = null) {
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
            const modal = this._createResultsModal(results, resolve, session);
            document.body.appendChild(modal);
        });
    }

    /**
     * Sync Steam stats and leaderboards (best-effort, non-blocking)
     * @private
     */
    async _syncSteamStats(results, session) {
        if (
            !results
            || !session?.levelId
            || !canWriteLegacySimulationResults(session.simulationClock)
        ) {
            return;
        }
        const { levelId } = session;

        const totalStars = this.odysseyState.getTotalStars();
        const durationSeconds = Math.max(1, Math.round(results.time || 0));
        const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
        const levelTimeMs = Math.max(1, Math.round((results.time || 0) * 1000));
        const levelBoard = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}${levelId}`;

        const baseDetails = {
            score: results.score,
            duration: durationSeconds,
            linesCleared: results.lines,
            highestLevel: levelId,
            stars: results.stars,
            totalStars,
            mode: 'odyssey',
            version: '1.0.0',
        };

        await Promise.all([
            steamService.uploadScore(
                STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS,
                totalStars,
                {
                    ...baseDetails,
                    extraValue: totalStars,
                    leaderboard: 'odyssey_total_stars',
                },
            ),
            steamService.uploadScore(
                levelBoard,
                levelTimeMs,
                {
                    ...baseDetails,
                    timeMs: levelTimeMs,
                    extraValue: levelTimeMs,
                    leaderboard: 'odyssey_level_time',
                },
            ),
            steamService.setStat('odyssey_stars', totalStars),
            steamService.incrementStat('total_lines_cleared', results.lines),
            steamService.incrementStat('playtime_minutes', durationMinutes),
        ]);
    }

    /**
     * Create a styled results modal
     * @private
     */
    _createResultsModal(results, onClose, session = null) {
        // View extracted to ui/odyssey/ResultsModal.js (E1). Thread the few pieces of
        // mode state it needs; caller contract (returns the modal element) is unchanged.
        return createResultsModal({
            results,
            onClose,
            levelConfig: session?.levelConfig || this.currentLevelConfig,
            levelId: session?.levelId || this.currentLevelId,
            totalStars: this.odysseyState.getTotalStars(),
            formatTime: (ms) => this._formatTime(ms),
            includeLegacyResults: session
                ? canWriteLegacySimulationResults(session.simulationClock)
                : true,
        });
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
    async _showLevelFailure(reason, session = null) {
        console.log(`[Odyssey] === Level Failed: ${reason} ===`);

        // Hide Odyssey HUD
        this._cleanupOdysseyHUD();

        // Phase 6: Show proper failure modal
        const reasonText = reason === 'time' ? 'Time ran out!' : 'You topped out!';

        // Resolve with the chosen action + the modal handle. The caller owns removing
        // the modal so a retry can keep its dark backdrop on-screen during the reset.
        return new Promise((resolve) => {
            let modal = null;
            modal = this._createFailureModal(reasonText, (choice) => {
                resolve({ choice, modal });
            }, session);
            document.body.appendChild(modal);
        });
    }

    /**
     * Create a styled failure modal
     * @private
     */
    _createFailureModal(reasonText, onChoose, session = null) {
        // View extracted to ui/odyssey/FailureModal.js (E1). Caller contract unchanged
        // (returns the modal element; the caller owns removing it so a retry keeps the
        // backdrop up during the board reset).
        return createFailureModal({
            reasonText,
            onChoose,
            attemptNumber: this._levelAttemptNumber,
            includeLegacyResults: session
                ? canWriteLegacySimulationResults(session.simulationClock)
                : true,
        });
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
    /**
     * True elapsed level time in ms, excluding time spent paused (masterplan §2 #2).
     * @returns {number}
     * @private
     */
    _elapsedLevelMs() {
        if (!this.levelStartTime) return 0;
        const pausedInProgress = this._pauseStartedAt !== null
            ? (Date.now() - this._pauseStartedAt) : 0;
        return Math.max(0, Date.now() - this.levelStartTime - this.levelPausedMs - pausedInProgress);
    }

    _startLevelTimer(session = this._activeLevelSession) {
        if (!this._isLevelSessionActive(session)) return;
        if (session.simulationClock !== DEMO_LEGACY_SIMULATION_CLOCK) return;
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
        }

        this.levelTimerInterval = setInterval(() => {
            if (
                this._isLevelSessionActive(session)
                && this.levelStartTime
                && !session.gameState.isPaused
            ) {
                const elapsedTime = this._elapsedLevelMs() / 1000;
                // Phase 2: Update time via hybridEngine
                session.hybridEngine.updateTime(elapsedTime);
            }
        }, 100);
    }

    /**
     * Hook input functions
     * @private
     */
    _hookInputs() {
        const session = this._activeLevelSession;
        if (!this._isLevelSessionActive(session)) return;
        this._initBoardJuice();
        this._legacyInputOwner?.dispose();
        this._legacyInputOwner = null;
        if (session.simulationClock !== DEMO_LEGACY_SIMULATION_CLOCK) return;
        this._legacyInputOwner = installOdysseyLegacyInputWrapper({
            gameState: session.gameState,
            isActive: () => this._isLevelSessionActive(session),
            juice: this.boardJuice,
            physicsCallbacks: this._getPhysicsCallbacks(session),
            soundPlayer: this.deps.soundManager?.sfxPlayer,
        });
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
     * Restore original inputs
     * @private
     */
    _restoreInputs() {
        this._legacyInputOwner?.dispose();
        this._legacyInputOwner = null;
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
            this.hybridEngine?.updateScore(this.gameState.score || 0);
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

        // Update time (excludes paused time — masterplan §2 #2)
        if (this.levelStartTime) {
            const session = this._activeLevelSession;
            const elapsedMs = session?.simulationClock === DEMO_FIXED_SIMULATION_CLOCK
                ? Number(session.gameState.simTimeMs) || 0
                : this._elapsedLevelMs();
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
        projectInfinityPresentationCamera(this.gameState, currentCameraRow);

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
                projectInfinityPresentationCamera(this.gameState, targetCameraRow);
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
                projectInfinityPresentationCamera(this.gameState, targetRow);
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

        // Don't capture wheel when an overlay (hub, settings) is above the game canvas.
        // Uses elementFromPoint to handle Electron compositor hit-testing differences.
        if (!shouldCaptureWheelEvent({ event })) return;

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
