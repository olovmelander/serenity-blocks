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
} from '../constants.js';
import { updateStats } from '../../rendering/draw.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { OdysseyStateManager } from '../odyssey/OdysseyStateManager.js';
import { getLevelRegistry } from '../odyssey/LevelRegistry.js';
import { GameplayHybridEngine } from '../odyssey/GameplayHybridEngine.js';
import { ThemeTransitionManager } from '../odyssey/ThemeTransitionManager.js';
import { OdysseyBoardController } from '../../rendering/odyssey/OdysseyBoardController.js';
import { JourneyEntryTransition } from '../../rendering/transitions/JourneyEntryTransition.js';
import { JourneyReturnTransition } from '../../rendering/transitions/JourneyReturnTransition.js';
import { TRANSITION_LAYERS } from '../../rendering/transitions/transition-layer-constants.js';
import { OdysseyHUD } from '../../ui/odyssey/OdysseyHUD.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';
import {
    SteamLeaderboardPanel,
    formatMilliseconds,
    formatNumber,
} from '../../ui/components/steam-leaderboard-panel.js';
import { showCinematicLoadingOverlay, dismissCinematicLoadingOverlay } from '../../ui/cinematic-loading-overlay.js';
import { getOdysseyThemePresentationPalette } from '../odyssey/theme-presentation.js';
import { shouldCaptureWheelEvent } from '../../utils/wheel-routing.js';

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
 * OdysseyMode - Narrative-driven progression through themed levels
 */
export class OdysseyMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Odyssey-specific state
        this.levelRegistry = getLevelRegistry();
        this.odysseyState = new OdysseyStateManager({ levelRegistry: this.levelRegistry });

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
        this.journeyEntryTransition = null;
        this.journeyReturnTransition = null;
        this.isEnteringLevel = false;
        this.levelPrepared = false;
        this.levelRunStarted = false;

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

        console.log('[Odyssey] Activating Odyssey Mode...');

        this._captureBoardTrack();
        await this._applyBoardAudioPolicy({ restoreTrack: false });

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
        await this._applyBoardAudioPolicy({ restoreTrack: true });
        console.log('[Odyssey] onStart called - entering level');
    }

    /**
     * Called when game is paused
     */
    onPause(options = {}) {
        if (this.entryPhase === 'countdown') {
            console.log('[Odyssey] Ignoring pause request during level start cue');
            return;
        }

        super.onPause();

        if (this.gameState) {
            this.gameState.isPaused = true;
        }

        if (this.usingHybridLoop) {
            this.deps.frameRateController?.pauseHybridLoop();
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
        if (this.entryPhase === 'countdown') {
            console.log('[Odyssey] Ignoring resume request during level start cue');
            return;
        }

        super.onResume();

        if (this.gameState) {
            this.gameState.isPaused = false;
            this.gameState.lastTime = performance.now();
        }

        if (this.usingHybridLoop) {
            this.deps.frameRateController?.resumeHybridLoop();
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

        // Stop standard RAF loop
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        // Stop hybrid loop if active
        if (this.deps.frameRateController?.isRunning) {
            this.deps.frameRateController.stopHybridLoop();
        }
        this.usingHybridLoop = false;

        // Stop level timer
        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

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
        await this._applyBoardAudioPolicy({ restoreTrack: true });
        await super.onDeactivate();

        console.log('[Odyssey] Deactivating...');

        // End session and save
        this.odysseyState.endSession();
        this.odysseyState.save();

        // Restore inputs
        this._restoreInputs();

        // Clean up cinematic loading overlay if still present
        const loadingOverlay = document.getElementById('odyssey-loading-overlay');
        if (loadingOverlay) loadingOverlay.remove();

        // Hide odyssey UI
        this._hideOdysseyUI();

        // Dispose the 3D Odyssey Board and overlay
        this._disposeOdysseyBoard();

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
                        setTimeout(() => this._disposeOdysseyBoard(), 1200);
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

        let [firstGameplayFrameReady, themeCriticalReady] = await Promise.all([
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
                    currentWindow.removeEventListener('phaser-board-first-render', handleWindowRender);
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

        // Sync Steam stats/leaderboards in the background (best-effort)
        this._syncSteamStats(finalResults).catch((err) => {
            console.warn('[Odyssey] Steam stats sync failed:', err.message);
        });

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
        const completedLevelId = this.currentLevelId;
        const completedLevelConfig = this.currentLevelConfig;
        const departureAnchor = this._resolveJourneyReturnDepartureAnchor();
        const palette = this._buildJourneyEntryPalette(completedLevelConfig);
        const timings = this._buildJourneyReturnTimings(completedLevelConfig);
        const qualityPreset = window.settings?.effectQuality || 'High';

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
            arrivalAnchor: { x: 0.5, y: 0.5, radius: 0.14, onScreen: true },
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
                type: 'garbage', // Explicit type for consistent rendering
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

        // Reset completion flag for new level
        this.levelCompleting = false;
        this.levelPrepared = false;
        this.levelRunStarted = false;
        this.levelStartTime = null;
        this.isRunning = false;
        this.isPaused = false;
        this.entryPhase = 'preparing';

        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        if (this.deps.frameRateController?.isRunning) {
            this.deps.frameRateController.stopHybridLoop();
        }
        this.usingHybridLoop = false;

        this._restoreInputs();
        this._cleanupOdysseyHUD();
        this._cleanupMinimap();
        this._createGameStateForLevel(this.currentLevelConfig);

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
        this.boardScene?.syncFromGameState?.(this.gameState);

        // Update UI
        this._refreshNextQueue();
        this._updateStats();

        // Phase 6: Initialize and show Odyssey HUD
        this._initializeOdysseyHUD();

        // Initialize minimap for tall boards
        this._initializeMinimap();

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
        if (!this.levelPrepared || this.levelRunStarted || !this.gameState) {
            return false;
        }

        console.log('[Odyssey] Beginning level run...');
        this._hookInputs();
        this.gameState.isPaused = false;
        this.gameState.lastTime = performance.now();
        this.levelStartTime = Date.now();
        this._startLevelTimer();
        this._startGameLoop();
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
        if (this.gameState?.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
            this.gameState.animationId = null;
        }

        if (this.deps.frameRateController?.isRunning) {
            this.deps.frameRateController.stopHybridLoop();
        }
        this.usingHybridLoop = false;

        if (this.levelTimerInterval) {
            clearInterval(this.levelTimerInterval);
            this.levelTimerInterval = null;
        }

        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        this._cleanupOdysseyHUD();
        this._cleanupMinimap();
        this._applyInfinityLayout(false);
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
    _startGameLoop() {
        if (!this.gameState) return;

        // Cancel any existing loop
        if (this.gameState.animationId) {
            cancelAnimationFrame(this.gameState.animationId);
        }

        const { frameRateController } = this.deps;
        if (frameRateController?.isRunning) {
            frameRateController.stopHybridLoop();
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

        const playDropCallback = () => this.deps.soundManager?.sfxPlayer?.playDrop();
        const physicsCallbacks = this._getPhysicsCallbacks();

        if (frameRateController?.needsHybridMode()) {
            this.usingHybridLoop = true;
            console.log('[Odyssey] Using hybrid loop for high FPS target');

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
            console.log('[Odyssey] Using standard RAF loop');

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
     * Get physics callbacks
     * @private
     */
    _getPhysicsCallbacks() {
        // Phase 2: Build base callbacks, then wrap with hybridEngine for metric tracking
        const baseCallbacks = {
            onMove: () => this.deps.soundManager?.sfxPlayer?.playMove(),
            onRotate: () => this.deps.soundManager?.sfxPlayer?.playRotate(),
            onLineClear: (lineCount, ...rest) => {
                const clearedRows = Array.isArray(rest[2]) ? rest[2] : [];
                this.deps.soundManager?.sfxPlayer?.playLineClear();
                // Metrics are tracked by hybridEngine.buildPhysicsCallbacks() wrapper

                // Emit event
                eventBus.emit(EVENTS.LINE_CLEAR, {
                    lineCount,
                    clearedRows,
                    source: 'odyssey',
                    levelId: this.currentLevelId,
                });
            },
            onLevelUp: () => this.deps.soundManager?.sfxPlayer?.playLevelUp(),
            onHardDrop: (dropData) => {
                this.deps.soundManager?.sfxPlayer?.playDrop();
                const boardScene = this._getBoardScene();
                if (boardScene?.playHardDropEffect) {
                    boardScene.playHardDropEffect(dropData);
                }
                // Board juice: dip + bounce on hard drop
                if (this.boardJuice) {
                    this.boardJuice.dip(3);
                    this.boardJuice.bounce();
                }
            },
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
                // Board juice: pulse on line clear
                if (this.boardJuice) {
                    const intensity = 1 + (Math.min(lineCount, 4) * 0.004);
                    this.boardJuice.pulse(intensity);
                }
            },
            triggerBackgroundPulse: (lineCount) => {
                const boardScene = this._getBoardScene();
                if (boardScene?.triggerBackgroundPulse) {
                    boardScene.triggerBackgroundPulse(lineCount);
                }
            },
            onPieceLock: (piece) => {
                eventBus.emit(EVENTS.PIECE_LOCK, { piece });

                const boardScene = this._getBoardScene();
                if (boardScene?.createPieceLockRipple) {
                    boardScene.createPieceLockRipple(piece);
                }
                // Board juice: gentle dip + pulse on piece lock
                if (this.boardJuice) {
                    this.boardJuice.dip(1);
                    this.boardJuice.pulse(1.005);
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

        // Trigger theme combo effects for victory celebration
        eventBus.emit(EVENTS.COMBO, { comboCount: 10 });
        eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: 4, comboCount: 10 });

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
     * Smoothly remove the cinematic loading overlay (crossfade to 3D board)
     * @private
     */
    _dismissCinematicLoadingOverlay() {
        return dismissCinematicLoadingOverlay(800);
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
            minOverlayDisplayMs = 5000,
            showLoadingOverlay = true,
        } = options;

        console.log('[Odyssey] Showing board view');

        // Initialize Three.js Odyssey Board if not exists
        await this._initializeOdysseyBoard();
        this.closeOdysseyNavigator({ restoreBoardPreview: true });
        this._restoreBoardOverlayAfterLaunchAttempt();

        if (Number.isFinite(focusLevelId)) {
            await this._focusBoardLevelForLaunch(focusLevelId, {
                updatePreview: true,
                settle: true,
            });
        } else if (Number.isFinite(this.selectedLevelId)) {
            this._updateLevelPreview(this.selectedLevelId);
        }

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
            const elapsed = Date.now() - (this._overlayShownAt || 0);
            const remaining = Math.max(0, minOverlayDisplayMs - elapsed);

            if (remaining > 0) {
                await new Promise((resolve) => setTimeout(resolve, remaining));
            }

            await this._dismissCinematicLoadingOverlay();
        }

        return true;
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
        this.boardController = new OdysseyBoardController(boardContainer, {
            editorMode: isOdysseyLayoutEditorEnabled(),
            soundManager: this.deps?.soundManager || null,
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
                <div id="level-panel-number" class="level-number-badge">LEVEL 1</div>
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
            .level-number-badge {
                display: inline-block;
                padding: 0.35rem 0.75rem;
                background: linear-gradient(135deg, rgba(0, 170, 255, 0.2), rgba(0, 255, 204, 0.2));
                border: 1px solid rgba(0, 255, 204, 0.4);
                border-radius: 6px;
                font-family: 'Orbitron', sans-serif;
                font-size: 0.7rem;
                font-weight: 600;
                letter-spacing: 1.5px;
                color: #00ffcc;
                text-shadow: 0 0 8px rgba(0, 255, 204, 0.5);
                margin-bottom: 0.75rem;
                box-shadow: 0 0 15px rgba(0, 255, 204, 0.15);
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

        await new Promise((resolve) => setTimeout(resolve, revealState.revealDelayMs));
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

        await new Promise((resolve) => setTimeout(resolve, revealState.revealDurationMs));
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
            await new Promise((resolve) => setTimeout(resolve, statsTailMs));
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
                <div class="odyssey-progress-bar"><div class="odyssey-progress-fill" id="odyssey-progress-fill"></div></div>
            </div>
            <div class="odyssey-chapters" id="odyssey-chapters"></div>
            <div class="odyssey-actions">
                <button id="odyssey-back-btn" class="odyssey-btn">Back to Menu</button>
            </div>
        `;

        // Add styles (Cosmic Serenity — gold "Odyssey" accent; guard against dupes)
        const styleId = 'odyssey-level-select-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
            .odyssey-level-select {
                --cs-accent: #fcd17a;
                --cs-accent-rgb: 252, 209, 122;
                --cs-accent-2: #ffb75e;
                --cs-done-rgb: 94, 234, 212;
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                background:
                    radial-gradient(120% 80% at 50% -10%, rgba(var(--cs-accent-rgb), 0.10), transparent 60%),
                    radial-gradient(90% 70% at 12% 0%, rgba(142, 162, 255, 0.08), transparent 60%),
                    linear-gradient(180deg, #0c0e1c 0%, #07080f 100%);
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 2.4rem 2rem;
                z-index: 1002;
                overflow-y: auto;
                box-sizing: border-box;
                animation: ods-fade 0.4s ease both;
                scrollbar-width: thin;
                scrollbar-color: rgba(var(--cs-accent-rgb), 0.6) rgba(0, 0, 0, 0.2);
            }

            .odyssey-level-select::-webkit-scrollbar { width: 10px; }
            .odyssey-level-select::-webkit-scrollbar-track { background: transparent; }
            .odyssey-level-select::-webkit-scrollbar-thumb {
                background: linear-gradient(180deg, rgba(var(--cs-accent-rgb), 0.7), rgba(255, 183, 94, 0.5));
                border: 2px solid transparent;
                background-clip: padding-box;
                border-radius: 6px;
            }

            .odyssey-header {
                text-align: center;
                margin-bottom: 2rem;
            }

            .odyssey-header h1 {
                font-family: 'Orbitron', monospace;
                font-size: clamp(2rem, 4vw, 2.6rem);
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: transparent;
                -webkit-text-fill-color: transparent;
                background: linear-gradient(100deg,
                        #fff3d6 0%, var(--cs-accent) 38%, var(--cs-accent-2) 64%, #fffaf0 100%);
                background-size: 220% auto;
                -webkit-background-clip: text;
                background-clip: text;
                filter: drop-shadow(0 0 20px rgba(var(--cs-accent-rgb), 0.32));
                margin: 0 0 0.6rem;
                animation: ods-shimmer 8s ease-in-out infinite;
            }

            .odyssey-progress {
                display: flex;
                gap: 1.6rem;
                justify-content: center;
                font-family: 'Space Mono', monospace;
                font-size: 0.95rem;
                color: rgba(211, 219, 245, 0.55);
            }

            .odyssey-stars {
                color: var(--cs-accent);
                font-weight: 700;
            }

            .odyssey-progress-bar {
                width: 260px;
                height: 6px;
                margin: 0.85rem auto 0;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(var(--cs-accent-rgb), 0.18);
                overflow: hidden;
            }

            .odyssey-progress-fill {
                height: 100%;
                width: 0%;
                border-radius: 999px;
                background: linear-gradient(90deg, var(--cs-accent), var(--cs-accent-2));
                box-shadow: 0 0 12px rgba(var(--cs-accent-rgb), 0.5);
                transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
            }

            .odyssey-chapters {
                display: flex;
                flex-direction: column;
                gap: 1.1rem;
                max-width: 840px;
                width: 100%;
            }

            .odyssey-chapter {
                position: relative;
                background:
                    radial-gradient(120% 100% at 0% 0%, rgba(var(--cs-accent-rgb), 0.05), transparent 55%),
                    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(8, 10, 23, 0.45));
                border: 1px solid rgba(150, 180, 255, 0.10);
                border-radius: 16px;
                padding: 1.1rem 1.2rem;
                box-shadow:
                    inset 0 1px 0 rgba(255, 255, 255, 0.04),
                    0 14px 32px rgba(0, 0, 0, 0.18);
                transition: border-color 0.25s ease, box-shadow 0.25s ease;
            }

            .odyssey-chapter:hover {
                border-color: rgba(var(--cs-accent-rgb), 0.28);
                box-shadow:
                    inset 0 1px 0 rgba(255, 255, 255, 0.05),
                    0 18px 40px rgba(0, 0, 0, 0.24),
                    0 0 26px rgba(var(--cs-accent-rgb), 0.08);
            }

            .odyssey-chapter.current {
                border-color: rgba(var(--cs-accent-rgb), 0.45);
                box-shadow:
                    inset 0 1px 0 rgba(255, 255, 255, 0.05),
                    0 0 28px rgba(var(--cs-accent-rgb), 0.14);
            }

            .odyssey-chapter.complete {
                border-color: rgba(var(--cs-accent-rgb), 0.22);
            }

            .odyssey-chapter-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                margin-bottom: 0.9rem;
            }

            .odyssey-chapter-name {
                font-family: 'Orbitron', monospace;
                font-size: 1.05rem;
                color: #eef3ff;
                letter-spacing: 0.01em;
            }

            .odyssey-chapter-stars {
                flex-shrink: 0;
                color: var(--cs-accent);
                font-family: 'Space Mono', monospace;
                font-size: 0.82rem;
                font-weight: 700;
                white-space: nowrap;
                padding: 3px 11px;
                border-radius: 999px;
                background: rgba(var(--cs-accent-rgb), 0.10);
                border: 1px solid rgba(var(--cs-accent-rgb), 0.28);
            }

            .odyssey-chapter.complete .odyssey-chapter-stars {
                background: rgba(var(--cs-accent-rgb), 0.20);
                border-color: rgba(var(--cs-accent-rgb), 0.50);
                color: #fff3d6;
                box-shadow: 0 0 14px rgba(var(--cs-accent-rgb), 0.25);
            }

            .odyssey-levels {
                display: flex;
                flex-wrap: wrap;
                gap: 0.55rem;
            }

            .odyssey-level-btn {
                width: 52px;
                height: 52px;
                border-radius: 11px;
                border: 1px solid rgba(150, 180, 255, 0.18);
                background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(10, 13, 27, 0.55));
                color: #eef3ff;
                font-family: 'Orbitron', monospace;
                font-size: 0.95rem;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 1px;
            }

            .odyssey-level-btn:hover:not(.locked) {
                border-color: rgba(var(--cs-accent-rgb), 0.60);
                background: rgba(var(--cs-accent-rgb), 0.12);
                transform: translateY(-2px) scale(1.04);
                box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35), 0 0 16px rgba(var(--cs-accent-rgb), 0.30);
            }

            .odyssey-level-btn:focus-visible {
                outline: none;
                box-shadow:
                    0 0 0 2px rgba(var(--cs-accent-rgb), 0.90),
                    0 0 0 5px rgba(var(--cs-accent-rgb), 0.20);
            }

            .odyssey-level-btn.locked {
                opacity: 0.4;
                cursor: not-allowed;
                border-color: rgba(150, 180, 255, 0.08);
                background: rgba(10, 13, 27, 0.40);
                color: rgba(211, 219, 245, 0.45);
            }

            .odyssey-level-btn.completed {
                border-color: rgba(var(--cs-done-rgb), 0.50);
                background: linear-gradient(180deg, rgba(var(--cs-done-rgb), 0.12), rgba(10, 13, 27, 0.50));
                color: #d8fff5;
            }

            .odyssey-level-btn.completed:hover {
                border-color: rgba(var(--cs-done-rgb), 0.80);
                box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35), 0 0 16px rgba(var(--cs-done-rgb), 0.35);
            }

            .odyssey-level-btn.current {
                border-color: rgba(var(--cs-accent-rgb), 0.85);
                background: linear-gradient(180deg, rgba(var(--cs-accent-rgb), 0.20), rgba(10, 13, 27, 0.50));
                color: #ffffff;
                animation: ods-pulse 2s ease-in-out infinite;
            }

            .odyssey-level-stars {
                font-size: 0.55rem;
                letter-spacing: 0.5px;
                margin-top: 1px;
                color: var(--cs-accent);
            }

            .odyssey-level-btn.locked .odyssey-level-stars { color: rgba(211, 219, 245, 0.30); }
            .odyssey-level-btn.completed .odyssey-level-stars { color: var(--cs-accent); }

            .odyssey-actions {
                margin: 2rem 0 1rem;
            }

            .odyssey-btn {
                padding: 0.8rem 2rem;
                font-family: 'Space Mono', monospace;
                font-size: 0.95rem;
                font-weight: 600;
                letter-spacing: 0.04em;
                border: 1px solid rgba(var(--cs-accent-rgb), 0.45);
                background:
                    linear-gradient(180deg, rgba(var(--cs-accent-rgb), 0.14), rgba(var(--cs-accent-rgb), 0.05)),
                    rgba(8, 10, 23, 0.50);
                color: #ffe9c2;
                border-radius: 12px;
                cursor: pointer;
                transition: all 0.22s ease;
                box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
            }

            .odyssey-btn:hover {
                border-color: rgba(var(--cs-accent-rgb), 0.70);
                color: #ffffff;
                transform: translateY(-1px);
                box-shadow: 0 0 20px rgba(var(--cs-accent-rgb), 0.25);
            }

            .odyssey-btn:focus-visible {
                outline: none;
                box-shadow: 0 0 0 3px rgba(var(--cs-accent-rgb), 0.28);
            }

            @keyframes ods-shimmer {
                0%, 100% { background-position: 0% center; }
                50% { background-position: 200% center; }
            }

            @keyframes ods-pulse {
                0%, 100% { box-shadow: 0 0 0 1px rgba(var(--cs-accent-rgb), 0.50), 0 0 10px rgba(var(--cs-accent-rgb), 0.40); }
                50% { box-shadow: 0 0 0 1px rgba(var(--cs-accent-rgb), 0.80), 0 0 22px rgba(var(--cs-accent-rgb), 0.70); }
            }

            @keyframes ods-fade {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @media (prefers-reduced-motion: reduce) {
                .odyssey-level-select,
                .odyssey-header h1,
                .odyssey-level-btn.current {
                    animation: none !important;
                }
            }
        `;
            document.head.appendChild(style);
        }

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
     * Sync Steam stats and leaderboards (best-effort, non-blocking)
     * @private
     */
    async _syncSteamStats(results) {
        if (!results || !this.currentLevelId) {
            return;
        }

        const totalStars = this.odysseyState.getTotalStars();
        const durationSeconds = Math.max(1, Math.round(results.time || 0));
        const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
        const levelTimeMs = Math.max(1, Math.round((results.time || 0) * 1000));
        const levelBoard = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}${this.currentLevelId}`;

        const baseDetails = {
            score: results.score,
            duration: durationSeconds,
            linesCleared: results.lines,
            highestLevel: this.currentLevelId,
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
            max-width: 520px;
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

        stats.forEach((stat) => {
            const statDiv = document.createElement('div');
            statDiv.innerHTML = `
                <div style="font-size: 11px; color: rgba(180, 200, 220, 0.6); letter-spacing: 1px; margin-bottom: 5px;">${stat.label.toUpperCase()}</div>
                <div style="font-size: 20px; font-weight: 700; color: #fff;">${stat.value}</div>
            `;
            statsContainer.appendChild(statDiv);
        });
        content.appendChild(statsContainer);

        // Steam leaderboard panel (level time + total stars)
        const leaderboardHost = document.createElement('div');
        leaderboardHost.className = 'steam-leaderboard-panel';
        leaderboardHost.style.marginBottom = '24px';
        content.appendChild(leaderboardHost);

        const levelBoard = `${STEAM_LEADERBOARDS.ODYSSEY_LEVEL_TIME_PREFIX}${this.currentLevelId}`;
        const totalStars = this.odysseyState.getTotalStars();
        const levelTimeMs = Math.max(1, Math.round((results.time || 0) * 1000));

        const leaderboardPanel = new SteamLeaderboardPanel({
            title: 'Odyssey Leaderboards',
            boards: [
                {
                    id: 'level-time',
                    label: 'Level Time',
                    name: levelBoard,
                    currentScore: levelTimeMs,
                    formatScore: formatMilliseconds,
                },
                {
                    id: 'total-stars',
                    label: 'Total Stars',
                    name: STEAM_LEADERBOARDS.ODYSSEY_TOTAL_STARS,
                    currentScore: totalStars,
                    formatScore: formatNumber,
                },
            ],
            defaultBoardId: 'level-time',
            pageSize: 8,
        });

        leaderboardPanel.mount(leaderboardHost);

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
        modal.dataset.odysseyWheelLock = 'true';
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

        // Initialize BoardJuice for reactive board motion
        this._initBoardJuice();

        window.move = (dir) => {
            if (!this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;
            const moved = coreMove(this.gameState, dir, () => this.deps.soundManager?.sfxPlayer?.playMove());
            if (this.boardJuice) {
                if (moved) {
                    this.boardJuice.nudge(dir * 1.5, 0);
                    this.boardJuice.tilt(dir * 0.4);
                } else {
                    this.boardJuice.nudge(dir * 0.8, 0);
                }
            }
        };

        window.rotate = (dir) => {
            if (!this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;
            coreRotate(this.gameState, dir, () => this.deps.soundManager?.sfxPlayer?.playRotate());
            if (this.boardJuice) {
                this.boardJuice.tilt(dir === 'left' ? -0.3 : 0.3);
            }
        };

        window.hardDrop = () => {
            if (!this.gameState || this.gameState.isPaused || this.gameState.isGameOver) return;
            if (this.boardJuice) {
                this.boardJuice.dip(3);
                this.boardJuice.bounce();
            }
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
