// =================================================================================
// MAIN.JS - Application Entry Point for Serenity Blocks
// =================================================================================

/**
 * Main application entry point that coordinates all modular systems
 * Integrates: Game Core, UI, Audio, Themes, Settings, Controls, High Scores
 */

// Phaser 4 Framework (imported from npm)
import Phaser from 'phaser';

// Core imports
import {
    COLS,
    ROWS,
    HIDDEN_ROWS,
    BLOCK_SIZE,
    setBlockSize,
    DEFAULT_SETTINGS,
    GAME_MODES,
    THEME_SFX_MAP,
} from './core/constants.js';
import {
    GameState,
    gameLoop as coreGameLoop,
    startGame as coreStartGame,
    spawnPiece,
    fillBag,
    move as coreMove,
    rotate as coreRotate,
    hardDrop as coreHardDrop,
    softDrop as coreSoftDrop,
    processAutoDrop as coreProcessAutoDrop,
    markBoardDirty,
} from './core/game.js';
import { insertGarbageEntries } from './core/garbage.js';
import { rebuildBoardGridFromPieces } from './core/board.js';
import { initPieceSystem } from './core/pieces.js';
import { MultiplayerGameState } from './core/multiplayer.js';
import { GameModeManager } from './core/game-modes/GameModeManager.js';
import steamService from './core/steam/steam-service.js';
import { richPresenceManager } from './core/steam/rich-presence-manager.js';
import { SteamInviteManager } from './core/steam/steam-invite-manager.js';
import SteamCloudSyncManager from './core/steam/steam-cloud-sync.js';
import { initializeMainMenuPlayerCard } from './ui/components/main-menu-player-card.js';

// Rendering imports
import { generateGridCache, drawBlock, drawGhostPiece } from './rendering/canvas-utils.js';
import {
    draw,
    updateStats,
    triggerLineClearFlash,
    createPieceLockRipple,
    triggerBackgroundPulse,
    addPieceTrail,
    showComboPopup,
    drawNextPieces,
} from './rendering/draw.js';
import { updateNextQueue, drawPiece as drawNextPiece } from './ui/next-queue-ui.js';
import { WebGLRenderer } from './rendering/renderer.js';
import { createBoardScene } from './rendering/phaser/board-scene.js';
import { createBackgroundScene } from './rendering/phaser/background-scene.js';
import { createMultiplayerBoardScene } from './rendering/phaser/multiplayer/board-panel.js';
import { eventBus, EVENTS } from './events/event-bus.js';
import { normalizeQuality } from './utils/quality.js';
import { DisplayManager } from './core/display-manager.js';
import { FrameRateController } from './core/frame-rate-controller.js';
import { setGlobalRenderScale, setGlobalAntialias } from './themes/base-theme.js';

// UI imports
import {
    ModalManager,
    setupModalUI,
    showSettingsModal,
    showGameOverModal,
    showHighScoresModal,
    toggleFullScreen,
    closeHighScoresModal,
} from './ui/modals.js';
import { SettingsManager, initializeSettingsUI, updateGamepadControlsDisplay } from './ui/settings.js';
import { InputController, setupKeyboardControls } from './ui/controls.js';
import { GamepadController } from './ui/gamepad-controller.js';
import { HighScoreManager } from './ui/high-scores.js';
import { GameModeUI } from './ui/game-mode-ui.js';
import { introAnimation } from './ui/intro-animation.js';
import { SerenityHub } from './ui/serenity-hub/SerenityHub.js';
import { DemoManager } from './core/demo/DemoManager.js';
import { DemoBrowser } from './ui/demo-browser.js';
import { showCinematicLoadingOverlay, dismissCinematicLoadingOverlay } from './ui/cinematic-loading-overlay.js';

// Audio imports
import { SoundManager } from './audio/sound-manager.js';

// Theme imports
import { ThemeManager } from './themes/theme-manager.js';

// Utility imports
import { initGridCache, clearThemeCaches } from './utils/cache.js';
import { seededRandom, hexToRgb } from './utils/helpers.js';
import { performanceMonitor } from './utils/performance-monitor.js';

// Serenity Mode imports
import { initEnhancedBreathingIndicator } from './ui/effects/enhanced-breathing-indicator.js';

const RIPPLE_BORDER_ALPHA = 0.8;
const RIPPLE_SHADOW_ALPHA = 0.6;

const INTRO_MUSIC_TRACK_KEY = 'CosmicChimes';
const INTRO_MUSIC_PATH = './assets/music/Cosmic Chimes.mp3';
const sharedSoundManager = new SoundManager();
let introMusicInitialized = false;

async function ensureIntroMusicIsPlaying() {
    sharedSoundManager.suspendThemeLinkedMusic();
    if (!introMusicInitialized) {
        await sharedSoundManager.initializeTracks();
        introMusicInitialized = true;
    }

    const hasTrackList = Array.isArray(sharedSoundManager.trackNames)
        && sharedSoundManager.trackNames.length > 0;

    if (hasTrackList && sharedSoundManager.trackNames.includes(INTRO_MUSIC_TRACK_KEY)) {
        if (sharedSoundManager.musicTrack !== INTRO_MUSIC_TRACK_KEY) {
            sharedSoundManager.setTrack(INTRO_MUSIC_TRACK_KEY);
        } else if (!sharedSoundManager.isMusicPlaying()) {
            sharedSoundManager.startBackgroundMusic();
        }
        return;
    }

    if (!sharedSoundManager.isMusicPlaying()) {
        sharedSoundManager.musicTrack = INTRO_MUSIC_TRACK_KEY;
        sharedSoundManager.playAudioFile(INTRO_MUSIC_PATH);
    }
}

function setPieceLockRippleCss(colorHex) {
    if (typeof document === 'undefined') {
        return;
    }

    const fallback = DEFAULT_SETTINGS.pieceLockRippleColor || '#64c8ff';
    const rgb = hexToRgb(colorHex) || hexToRgb(fallback);
    if (!rgb) {
        return;
    }

    const root = document.documentElement;
    root.style.setProperty(
        '--lock-ripple-border-color',
        `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${RIPPLE_BORDER_ALPHA})`,
    );
    root.style.setProperty(
        '--lock-ripple-shadow-color',
        `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${RIPPLE_SHADOW_ALPHA})`,
    );
}

/**
 * Main application class that orchestrates all systems
 */
class SerenityBlocks {
    constructor(soundManager = null) {
        // Core systems (deprecated - will be managed by GameModeManager)
        this.gameState = null;
        this.multiplayerState = null;
        this.canvas = null;
        this.ctx = null;
        this.nextCanvases = [];

        // Managers
        this.modalManager = null;
        this.settingsManager = null;
        this.inputController = null;
        this.highScoreManager = null;
        this.soundManager = soundManager;
        this.themeManager = null;
        this.webglRenderer = null;
        this.phaserGame = null;
        this.boardScene = null;
        this.multiplayerBoardScenes = [];
        this.gameModeUI = null;
        this.gameModeManager = null; // NEW: Central game mode orchestrator
        this.serenityHub = null; // Global Serenity Hub (accessible from all modes)
        this.demoManager = null;
        this.demoBrowser = null;
        this.displayManager = null; // Phase 1: Display management
        this.cloudSyncManager = null;
        this.frameRateController = new FrameRateController(); // Phase 2: FPS & VSync control
        this.cleanupHandlers = [];
        this.currentEffectQuality = normalizeQuality(DEFAULT_SETTINGS.effectQuality);
        this._handledPreloadError = false;

        // Game loop (deprecated - will be managed by individual modes)
        this.lastTime = 0;
        this.animationFrameId = null;

        // Initialization flag
        this.isInitialized = false;

        // FPS Counter
        this.fpsCounter = {
            element: null,
            frames: 0,
            lastTime: performance.now(),
            fps: 0,
            rafId: null,
        };

        // Background Tab Throttling
        this.isTabVisible = true;
        this.backgroundTabBehavior = 'reduce'; // 'pause' | 'reduce' | 'continue'
        this.reducedFrameInterval = 100; // 10 FPS when reduced (1000ms / 10)
        this.lastReducedFrameTime = 0;
    }

    /**
     * Initialize the application
     */
    async init() {
        if (this.isInitialized) {
            console.warn('Application already initialized');
            return;
        }

        console.log('🎮 Initializing Serenity Blocks...');

        try {
            // 1. Initialize canvas
            this.initializeCanvas();

            // 2. Initialize WebGL renderer for backgrounds (must be done before Phaser)
            const backgroundCanvas = document.getElementById('background-canvas');
            this.webglRenderer = new WebGLRenderer(backgroundCanvas);

            // 3. Initialize Phaser game instance
            this.initializePhaserGame();

            // 4. Initialize caches
            // Grid cache initialized when needed

            // 5. Initialize piece system
            initPieceSystem();

            // 6. Initialize managers
            await this.initializeManagers();

            // 7. Initialize GameModeManager (NEW: replaces direct gameState creation)
            this.initializeGameModeManager();

            // 8. Setup event listeners
            this.setupEventListeners();

            // 8. Initial theme loading is now deferred until after intro dismissal
            // to ensure smooth transition without CPU/GPU initialization spikes.

            // 9. Setup UI
            this.setupUI();

            // 10. Initialize canvas grid (for legacy fallback rendering if needed)
            if (this.canvas) {
                generateGridCache(this.canvas);
            }

            // 12. Expose game controls as globals for controls.js
            this.exposeGlobalControls();

            // 13. Start background scene now that everything is ready
            this.startBackgroundScene();

            // 14. Initialize enhanced breathing indicator (for Serenity Mode)
            window.breathingIndicator = initEnhancedBreathingIndicator();

            // 15. Setup background tab throttling for performance
            this.setupVisibilityThrottling();
            this.setupBuildResilienceHandlers();
            this.setupObservabilityHooks();

            this.isInitialized = true;
            console.log('✅ Serenity Blocks initialized successfully!');

            // Start modal visibility is orchestrated by bootstrap/intro handshake.
            // Showing it here causes a startup flash before intro dismissal.
        } catch (error) {
            console.error('Failed to initialize application:', error);
            throw error;
        }
    }

    setupBuildResilienceHandlers() {
        if (typeof window === 'undefined') return;

        const handlePreloadError = (event) => {
            console.error('[BuildResilience] Dynamic preload failed:', event);
            event.preventDefault?.();

            if (this._handledPreloadError) return;
            this._handledPreloadError = true;
            window.location.reload();
        };

        window.addEventListener('vite:preloadError', handlePreloadError);
        this.cleanupHandlers.push(() => {
            window.removeEventListener('vite:preloadError', handlePreloadError);
        });
    }

    setupObservabilityHooks() {
        if (typeof window === 'undefined') return;

        const runtimeUnsubscribe = window.electronAPI?.onRuntimeEvent?.((payload) => {
            performanceMonitor.recordEvent(`desktop_${payload.type}`, payload);
        });

        if (runtimeUnsubscribe) {
            this.cleanupHandlers.push(runtimeUnsubscribe);
        }

        window.runtimeValidation = {
            runThemeSwitchSoak: async ({
                themes = null,
                iterations = 20,
                delayMs = 250,
            } = {}) => {
                const cycleThemes = themes || this.themeManager?.getAvailableThemes?.() || [];
                const startedAt = performance.now();

                for (let i = 0; i < iterations; i += 1) {
                    const themeName = cycleThemes[i % cycleThemes.length];
                    if (!themeName) break;
                    await this.themeManager.switchTheme(themeName);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }

                const summary = {
                    iterations,
                    elapsedMs: performance.now() - startedAt,
                    releaseGates: performanceMonitor.getReleaseGateSnapshot(),
                };
                console.log('[RuntimeValidation] Theme switch soak complete', summary);
                return summary;
            },
            getReleaseGates: () => performanceMonitor.getReleaseGateSnapshot(),
        };
    }

    /**
     * Apply frame rate settings (Phase 2)
     * @param {Object} settings
     */
    async applyFrameRateSettings(settings = {}) {
        if (!this.frameRateController) {
            this.frameRateController = new FrameRateController();
        }

        const {
            vsyncEnabled = true,
            targetFrameRate = 60,
        } = settings;

        try {
            this.frameRateController.setVSync(vsyncEnabled);
            this.frameRateController.setTargetFPS(targetFrameRate || 0);
            this.frameRateController.resetStats();

            // Update Phaser game FPS target if game exists
            if (this.phaserGame && this.phaserGame.loop) {
                const actualTarget = targetFrameRate || 60; // Default to 60 if unlimited
                this.phaserGame.loop.targetFps = actualTarget;
                console.log(`[FrameRate] Updated Phaser FPS target to ${actualTarget}`);
            }

            if (this.displayManager?.isElectron) {
                try {
                    await window.electronDisplay?.setVSync?.(!!vsyncEnabled);
                } catch (ipcError) {
                    console.warn('[FrameRate] Failed to sync VSync with Electron main process:', ipcError);
                }
            }

            console.log('[Settings] Frame rate settings applied:', {
                vsyncEnabled,
                targetFrameRate,
            });
        } catch (error) {
            console.error('[FrameRate] Failed to apply frame settings:', error);
        }
    }

    /**
     * Setup visibility change detection for background tab throttling
     */
    setupVisibilityThrottling() {
        // Load behavior from settings
        const settings = this.settingsManager.get();
        this.backgroundTabBehavior = settings.backgroundTabBehavior || 'reduce';

        // Setup visibility change listener
        const handleVisibilityChange = () => {
            this.isTabVisible = !document.hidden;
            this.handleVisibilityChange(this.isTabVisible);
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Add to cleanup
        this.cleanupHandlers.push(() => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        });

        console.log('[Visibility] Background tab throttling initialized:', this.backgroundTabBehavior);
    }

    /**
     * Update background tab behavior setting
     * @param {string} behavior - 'pause' | 'reduce' | 'continue'
     */
    updateBackgroundTabBehavior(behavior) {
        this.backgroundTabBehavior = behavior;
        console.log('[Visibility] Background tab behavior updated to:', behavior);

        // If tab is currently hidden, apply the new behavior immediately
        if (!this.isTabVisible) {
            this.handleVisibilityChange(false);
        }
    }

    /**
     * Handle tab visibility change
     * @param {boolean} isVisible - Whether tab is visible
     */
    handleVisibilityChange(isVisible) {
        console.log(`[Visibility] Tab ${isVisible ? 'visible' : 'hidden'}, behavior: ${this.backgroundTabBehavior}`);

        if (isVisible) {
            // Tab became visible - resume full rendering
            this.resumeFullRendering();
        } else {
            // Tab became hidden - apply throttling based on behavior
            switch (this.backgroundTabBehavior) {
                case 'pause':
                    this.pauseAllRendering();
                    break;
                case 'reduce':
                    this.reduceRenderingFrameRate();
                    break;
                case 'continue':
                default:
                    // Do nothing - continue as normal
                    break;
            }
        }

        // Emit event for other systems to respond
        window.dispatchEvent(new CustomEvent('tabVisibilityChanged', {
            detail: { isVisible, behavior: this.backgroundTabBehavior },
        }));
    }

    /**
     * Pause all rendering when tab is hidden (maximum battery savings)
     */
    pauseAllRendering() {
        console.log('[Visibility] Pausing all rendering');

        // Pause theme animations (stops Three.js RAF loops to save GPU)
        if (this.themeManager?.activeTheme?.pause) {
            this.themeManager.activeTheme.pause();
        }

        // Pause any active game loops
        const currentMode = this.gameModeManager?.getCurrentMode();
        if (currentMode?.pauseRendering) {
            currentMode.pauseRendering();
        }

        // Set a flag that will be checked by animation loops
        window.isRenderingPaused = true;
    }

    /**
     * Reduce rendering to 10 FPS when tab is hidden (balanced approach)
     */
    reduceRenderingFrameRate() {
        console.log('[Visibility] Reducing rendering to 10 FPS');

        // Pause theme RAF loops (Three.js scenes) — they check shouldRenderFrame() anyway,
        // but stopping their RAF chains fully prevents GPU work in background tabs
        if (this.themeManager?.activeTheme?.pause) {
            this.themeManager.activeTheme.pause();
        }

        // Set a flag that animation loops can check
        window.isRenderingReduced = true;
        window.reducedFrameInterval = this.reducedFrameInterval;
        window.isRenderingPaused = false;
    }

    /**
     * Resume full rendering when tab becomes visible
     */
    resumeFullRendering() {
        console.log('[Visibility] Resuming full rendering');

        // Clear throttling flags
        window.isRenderingPaused = false;
        window.isRenderingReduced = false;

        // Resume theme animations (restarts Three.js RAF loops)
        if (this.themeManager?.activeTheme) {
            const theme = this.themeManager.activeTheme;
            if (typeof theme.resume === 'function') {
                theme.resume();
            }
            // Restart the animation loop if the theme has one
            if (typeof theme.animate === 'function' && theme._wasPaused) {
                theme._wasPaused = false;
                theme.animate();
            }
        }

        // Resume any paused game loops
        const currentMode = this.gameModeManager?.getCurrentMode();
        if (currentMode?.resumeRendering) {
            currentMode.resumeRendering();
        }
    }

    /**
     * Check if current frame should be rendered (for use in animation loops)
     * @returns {boolean} True if frame should be rendered
     */
    shouldRenderFrame() {
        // Always render if tab is visible
        if (this.isTabVisible) return true;

        // Check behavior
        if (this.backgroundTabBehavior === 'continue') return true;
        if (this.backgroundTabBehavior === 'pause') return false;

        // For 'reduce' mode, check if enough time has passed
        const now = performance.now();
        if (now - this.lastReducedFrameTime >= this.reducedFrameInterval) {
            this.lastReducedFrameTime = now;
            return true;
        }
        return false;
    }

    /**
     * Initialize canvas and context
     */
    initializeCanvas() {
        // Initialize next piece preview canvases
        this.nextCanvases = Array.from({ length: 5 }, (_, i) => document.getElementById(`next-${i}`));

        // Multiplayer canvases
        this.p1Canvas = document.getElementById('p1-canvas');
        this.p1Ctx = this.p1Canvas ? this.p1Canvas.getContext('2d') : null;
        this.p2Canvas = document.getElementById('p2-canvas');
        this.p2Ctx = this.p2Canvas ? this.p2Canvas.getContext('2d') : null;

        // Multiplayer next piece canvases
        this.p1NextCanvases = Array.from({ length: 3 }, (_, i) => document.getElementById(`p1-next-${i}`));
        this.p2NextCanvases = Array.from({ length: 3 }, (_, i) => document.getElementById(`p2-next-${i}`));

        // Block size is now fixed, and scaling is handled by Phaser's Scale.FIT mode.
        const calculatedBlockSize = 40;
        setBlockSize(calculatedBlockSize);

        // Phaser board sizing is driven by CSS (player card variables) and is 400x800
        const boardWidth = COLS * BLOCK_SIZE;
        const boardHeight = ROWS * BLOCK_SIZE;

        // Set multiplayer canvas dimensions (same size as single player)
        if (this.p1Canvas && this.p2Canvas) {
            this.p1Canvas.width = boardWidth;
            this.p1Canvas.height = boardHeight;
            this.p2Canvas.width = boardWidth;
            this.p2Canvas.height = boardHeight;

            console.log(
                `Multiplayer canvases: ${this.p1Canvas.width}x${this.p1Canvas.height}, block size: ${BLOCK_SIZE}px`,
            );
        }

        console.log(
            `Canvas initialized: Phaser container ready, block size: ${BLOCK_SIZE}px`,
        );
    }

    /**
     * Calculate optimal block size based on viewport
     */

    /**
     * Initialize Phaser 4 game instance with WebGL rendering
     */
    initializePhaserGame() {
        // Phaser 4 is now imported as ES module
        if (!Phaser) {
            console.error('[Phaser 4 Init] Phaser module not loaded');
            return;
        }

        // Validate required Phaser APIs for Phaser 4 compatibility
        if (!Phaser.Game || !Phaser.Scene) {
            console.error('[Phaser 4 Init] Phaser core classes not available');
            return;
        }

        const PhaserRef = Phaser;
        console.log('[Phaser 4 Init] Starting initialization...', {
            version: PhaserRef.VERSION || 'Unknown',
            webglSupport: typeof PhaserRef.WEBGL !== 'undefined',
        });

        // Create scene classes with Phaser 4 reference
        let BackgroundScene; let BoardScene; let
            MultiplayerBoardScene;
        try {
            BackgroundScene = createBackgroundScene(PhaserRef);
            BoardScene = createBoardScene(PhaserRef);
            MultiplayerBoardScene = createMultiplayerBoardScene(PhaserRef);
        } catch (error) {
            console.error('[Phaser 4 Init] Failed to create scene classes:', error);
            return;
        }

        const singleBoardWidth = COLS * BLOCK_SIZE;
        // Use only visible playfield for Phaser world (excludes hidden rows)
        const singleBoardHeight = ROWS * BLOCK_SIZE;

        this.singleBoardWidth = singleBoardWidth;
        this.phaserBaseWidth = singleBoardWidth;
        this.phaserBaseHeight = singleBoardHeight;

        // Phaser 4 Game Configuration
        const config = {
            // Renderer: Phaser 4 is WebGL-only (no Canvas renderer)
            type: PhaserRef.WEBGL,

            // Canvas dimensions: 10 blocks × 20 blocks (300×600 px)
            width: singleBoardWidth,
            height: singleBoardHeight,

            // Parent DOM container for Phaser canvas
            parent: 'phaser-game-container',

            // Transparent canvas to show WebGL theme backgrounds
            transparent: true,

            // Disable Phaser audio system (using custom SoundManager)
            audio: { noAudio: true },

            // Frame rate target
            fps: {
                target: 60,
                forceSetTimeOut: false,
            },

            // Register initial scenes (multiplayer scenes added dynamically)
            scene: [BoardScene, BackgroundScene],

            // Scale Manager: NONE mode for pixel-perfect rendering
            scale: {
                mode: PhaserRef.Scale?.NONE ?? 0, // NONE = 0 (no scaling, exact pixel size)
                autoCenter: PhaserRef.Scale?.NO_CENTER ?? 0, // NO_CENTER = 0 (CSS handles positioning)
                width: singleBoardWidth,
                height: singleBoardHeight,
            },

            // High DPI support for crisp rendering on Retina displays
            resolution: window.devicePixelRatio || 1,

            // Disable Phaser physics (using custom physics system)
            physics: {
                default: false,
            },

            // WebGL render settings
            render: {
                antialias: true, // Smooth edges for blocks
                pixelArt: false, // Not pixel art style
                powerPreference: 'high-performance', // Prefer discrete GPU (e.g., NVIDIA over integrated)
            },

            // Post-boot callback for scene initialization
            callbacks: {
                postBoot: (game) => {
                    console.log('[Phaser 4 Init] Post-boot callback started');

                    // Validate scene manager
                    if (!game.scene) {
                        console.error('[Phaser 4 Init] Scene manager not available');
                        return;
                    }

                    // Get scene references
                    this.backgroundScene = game.scene.getScene('BackgroundScene');
                    this.boardScene = game.scene.getScene('BoardScene');

                    // Validate scenes loaded correctly
                    if (!this.boardScene || !this.backgroundScene) {
                        console.error('[Phaser 4 Init] Scenes not found:', {
                            boardScene: !!this.boardScene,
                            backgroundScene: !!this.backgroundScene,
                        });
                        return;
                    }

                    // Store scene classes for dynamic instantiation
                    // Store on both game object (for mode access) and this (for internal use)
                    game.BoardSceneClass = BoardScene;
                    this.BoardSceneClass = BoardScene;
                    game.MultiplayerBoardSceneClass = MultiplayerBoardScene;
                    this.MultiplayerBoardSceneClass = MultiplayerBoardScene;

                    // Log successful initialization
                    console.log('✅ Phaser 4 game initialized successfully');
                    console.log('  ├─ Canvas dimensions:', game.canvas.width, 'x', game.canvas.height);
                    console.log('  ├─ Logical size:', singleBoardWidth, 'x', singleBoardHeight);
                    console.log('  ├─ Device pixel ratio:', window.devicePixelRatio || 1);
                    console.log('  ├─ Board config: ROWS:', ROWS, 'HIDDEN_ROWS:', HIDDEN_ROWS);
                    console.log('  └─ Scenes loaded: BoardScene, BackgroundScene');

                    // Add CSS class for HUD styling
                    document.body.classList.add('phaser-hud-ready');

                    // Initialize HUD if game already started
                    if (this.gameState) {
                        this.updatePhaserStats();
                        this.refreshNextQueue();
                    }

                    // Apply quality settings to all scenes
                    this.applyEffectQuality(
                        this.settingsManager?.get().effectQuality ?? this.currentEffectQuality,
                    );
                },
            },
        };

        console.log('[Phaser 4 Init] Creating game with config:', {
            width: config.width,
            height: config.height,
            parent: config.parent,
            type: 'WEBGL',
            transparent: config.transparent,
        });

        try {
            this.phaserGame = new PhaserRef.Game(config);
            console.log('[Phaser 4 Init] Game instance created successfully');
        } catch (error) {
            console.error('[Phaser 4 Init] Failed to create game instance:', error);
            // Fallback to canvas rendering if Phaser fails
            console.warn('[Phaser 4 Init] Falling back to canvas rendering');
        }
    }

    /**
     * Safely retrieve the active game state.
     * Prefers the current game mode, falls back to the legacy single-player state.
     * @returns {GameState|null}
     */
    getActiveGameState() {
        const currentMode = this.gameModeManager?.getCurrentMode?.();
        return currentMode?.gameState ?? this.gameState ?? null;
    }

    /**
     * Update Phaser HUD (score, level, lines).
     * @param {GameState|null} gameState
     */
    updatePhaserStats(gameState = this.getActiveGameState()) {
        if (!gameState) return;
        if (this.boardScene && typeof this.boardScene.updateStats === 'function') {
            this.boardScene.updateStats(gameState);
        }
    }

    /**
     * Update the next piece display via Phaser, falling back to canvas previews when necessary.
     * @param {GameState|null} gameState
     */
    refreshNextQueue(gameState = this.getActiveGameState()) {
        if (!gameState) return;
        if (this.boardScene && typeof this.boardScene.updateNextQueue === 'function') {
            this.boardScene.updateNextQueue(gameState.nextPieces);
        }
        updateNextQueue(gameState.nextPieces);
    }

    applyEffectQuality(level) {
        const quality = normalizeQuality(level || this.currentEffectQuality);
        this.currentEffectQuality = quality;

        if (this.boardScene?.setEffectQuality) {
            this.boardScene.setEffectQuality(quality);
        }

        if (this.multiplayerBoardScenes?.length) {
            this.multiplayerBoardScenes.forEach((scene) => scene?.setEffectQuality?.(quality));
        }

        if (this.webglRenderer?.setEffectQuality) {
            this.webglRenderer.setEffectQuality(quality);
        }

        if (this.backgroundScene) {
            this.backgroundScene.effectQuality = quality;
        }
    }

    /**
     * Apply display settings (Phase 1)
     * Resolution is always auto (native) - use renderScale for performance tuning
     * @param {Object} settings - Settings object with display configuration
     */
    async applyDisplaySettings(settings) {
        console.log('[Display] Applying display settings:', settings);

        const {
            displayMode, showFPSCounter, renderScale, enableAntialiasing,
        } = settings;

        // Apply render scale for Three.js themes (affects GPU load significantly)
        if (renderScale !== undefined) {
            setGlobalRenderScale(renderScale);
            console.log(`[Display] Render scale set to: ${renderScale} (effective DPR: ${this.displayManager.getEffectivePixelRatio(renderScale)})`);
        }

        // Apply antialiasing setting for Three.js themes
        if (enableAntialiasing !== undefined) {
            setGlobalAntialias(enableAntialiasing);
            console.log(`[Display] Antialiasing set to: ${enableAntialiasing}`);
        }

        try {
            // Always use native display resolution (auto mode)
            const displays = await this.displayManager.getAvailableDisplays();
            const primary = displays[0];
            const width = primary?.workArea?.width ?? 1920;
            const height = primary?.workArea?.height ?? 1080;

            // Apply internal render resolution based on renderScale
            // This allows performance tuning without changing actual display size
            if (this.webglRenderer) {
                this.webglRenderer.setInternalResolution(width, height, 'auto');
            }

            // Apply display mode
            await this.displayManager.setDisplayMode(displayMode, { width, height });

            // Apply FPS counter visibility
            if (showFPSCounter !== undefined) {
                if (showFPSCounter) {
                    this.showFPSCounter();
                } else {
                    this.hideFPSCounter();
                }
            }

            // Emit event for other systems to respond
            window.dispatchEvent(new CustomEvent('displaySettingsChanged', {
                detail: { displayMode, width, height },
            }));

            console.log('[Display] Display settings applied successfully');
            return true;
        } catch (error) {
            console.error('[Display] Failed to apply display settings:', error);
            return false;
        }
    }

    /**
     * Show FPS counter
     */
    showFPSCounter() {
        // Use enhanced performance monitor instead of legacy FPS counter
        performanceMonitor.enable();
        performanceMonitor.showPerformanceOverlay();

        // Update quality mode in performance monitor
        const settings = this.settingsManager?.settings;
        if (settings?.effectQuality) {
            performanceMonitor.setQualityMode(settings.effectQuality);
        }

        // Legacy FPS counter (keep for compatibility)
        if (!this.fpsCounter.element) {
            this.fpsCounter.element = document.getElementById('fps-counter');
        }

        if (this.fpsCounter.element) {
            this.fpsCounter.element.classList.add('hidden'); // Hide legacy counter
            this.updateFPSCounter(performance.now());
            this.startFPSMonitor();
            console.log('[FPS] Enhanced performance monitor shown');
        }
    }

    /**
     * Hide FPS counter
     */
    hideFPSCounter() {
        // Hide enhanced performance monitor
        performanceMonitor.hidePerformanceOverlay();

        // Legacy FPS counter (keep for compatibility)
        if (!this.fpsCounter.element) {
            this.fpsCounter.element = document.getElementById('fps-counter');
        }

        if (this.fpsCounter.element) {
            this.fpsCounter.element.classList.add('hidden');
            this.stopFPSMonitor();
            console.log('[FPS] Performance monitor hidden');
        }
    }

    /**
     * Update FPS counter
     */
    updateFPSCounter(currentTime = performance.now()) {
        if (!this.fpsCounter.element) {
            this.fpsCounter.element = document.getElementById('fps-counter');
        }

        let stats = null;

        if (this.frameRateController) {
            stats = this.frameRateController.recordFrame(currentTime);
            const currentFPS = stats.current;

            if (Number.isFinite(currentFPS) && currentFPS > 0) {
                this.fpsCounter.fps = currentFPS;
            }
        } else {
            this.fpsCounter.frames++;
            const elapsed = currentTime - this.fpsCounter.lastTime;

            if (elapsed >= 1000) {
                this.fpsCounter.fps = Math.round((this.fpsCounter.frames * 1000) / elapsed);
                this.fpsCounter.frames = 0;
                this.fpsCounter.lastTime = currentTime;
            }
        }

        this.fpsCounter.lastTime = currentTime;

        if (this.fpsCounter.element && !this.fpsCounter.element.classList.contains('hidden')) {
            const displayFPS = Number.isFinite(this.fpsCounter.fps) && this.fpsCounter.fps > 0
                ? Math.round(this.fpsCounter.fps)
                : '--';

            let gpuText = '';
            if (window.activeGPURenderer) {
                // Shorten renderer string for display
                // remove ANGLE (...) wrapper if present
                let simpleName = window.activeGPURenderer;
                const angleMatch = simpleName.match(/ANGLE \((.+)\)/);
                if (angleMatch) simpleName = angleMatch[1];

                // take first part if comma separated (often "Vendor, Card")
                const parts = simpleName.split(',');
                if (parts.length > 1) simpleName = parts[1].trim(); // Usually the card name is second
                else simpleName = parts[0];

                gpuText = ` | ${simpleName}`;
            }

            this.fpsCounter.element.textContent = `${displayFPS} FPS${gpuText}`;
        }
    }

    startFPSMonitor() {
        if (this.fpsCounter.rafId != null) {
            return;
        }

        const tick = (time) => {
            this.updateFPSCounter(time);
            this.fpsCounter.rafId = requestAnimationFrame(tick);
        };

        this.fpsCounter.rafId = requestAnimationFrame(tick);
    }

    stopFPSMonitor() {
        if (this.fpsCounter.rafId != null) {
            cancelAnimationFrame(this.fpsCounter.rafId);
            this.fpsCounter.rafId = null;
        }
    }

    startBackgroundScene() {
        if (!this.phaserGame || !this.backgroundScene || !this.webglRenderer) {
            return;
        }

        if (!this.phaserGame.scene.isActive('BackgroundScene')) {
            this.phaserGame.scene.start('BackgroundScene', {
                webglRenderer: this.webglRenderer,
                themeManager: this.themeManager,
                effectQuality: this.currentEffectQuality,
            });
        }
    }

    activatePhaserMultiplayerUI() {
        if (typeof document !== 'undefined') {
            document.body.classList.add('phaser-multiplayer-active');
        }
    }

    deactivatePhaserMultiplayerUI() {
        if (typeof document !== 'undefined') {
            document.body.classList.remove('phaser-multiplayer-active');
        }
    }

    resizePhaserGame(width, height, disableAutoCenter = false) {
        if (this.phaserGame) {
            const PhaserRef = Phaser;

            // Disable auto-centering for multiplayer mode to allow proper viewport positioning
            if (disableAutoCenter && PhaserRef) {
                this.phaserGame.scale.autoCenter = PhaserRef.Scale.NO_CENTER;
            } else if (PhaserRef) {
                // Re-enable auto-centering for single-player mode
                this.phaserGame.scale.autoCenter = PhaserRef.Scale.CENTER_BOTH;
            }

            this.phaserGame.scale.resize(width, height);
        }
    }

    movePhaserGameToContainer(containerId) {
        if (!this.phaserGame || !this.phaserGame.canvas) return;

        const targetContainer = document.getElementById(containerId);
        if (targetContainer && this.phaserGame.canvas.parentElement) {
            // Move the Phaser canvas to the new container
            targetContainer.appendChild(this.phaserGame.canvas);
            console.log(`[Phaser] Moved game canvas to ${containerId}`);
        }
    }

    pauseSinglePlayerScene() {
        if (this.phaserGame && this.phaserGame.scene.isActive('BoardScene')) {
            this.phaserGame.scene.pause('BoardScene');
        }
    }

    resumeSinglePlayerScene() {
        if (this.phaserGame && !this.phaserGame.scene.isActive('BoardScene')) {
            this.phaserGame.scene.resume('BoardScene');
        }
    }

    getMultiplayerViewports() {
        const width = this.singleBoardWidth;
        const height = this.phaserBaseHeight;
        const gap = this.multiplayerBoardGap;
        const borderWidth = 4; // Border width from CSS

        // Viewports define where on the canvas each scene renders
        // The borders are overlays on top of the content, so we need to position
        // the viewports to account for the border width to prevent clipping
        const viewports = [
            {
                x: borderWidth, // Start after left border
                y: 0,
                width: width - (borderWidth * 2), // Account for both left and right borders
                height,
            },
            {
                x: width + gap + borderWidth, // Start after left border for second player
                y: 0,
                width: width - (borderWidth * 2), // Account for both left and right borders
                height,
            },
        ];
        console.log('[Multiplayer] Calculated viewports:', viewports);
        console.log('[Multiplayer] Board width:', width, 'height:', height, 'gap:', gap, 'border width:', borderWidth);
        return viewports;
    }

    ensureMultiplayerBoardScenes() {
        return new Promise((resolve, reject) => {
            if (!this.phaserGame || !this.MultiplayerBoardSceneClass) {
                console.error('[Multiplayer] Phaser game or MultiplayerBoardScene class not available');
                reject(new Error('Phaser game or scene class not available'));
                return;
            }

            const sceneManager = this.phaserGame.scene;
            const viewports = this.getMultiplayerViewports();

            // Stop and remove existing scenes if they exist
            ['MultiplayerBoardScene1', 'MultiplayerBoardScene2'].forEach((key) => {
                const existingScene = sceneManager.getScene(key);
                if (existingScene) {
                    if (sceneManager.isActive(key)) {
                        sceneManager.stop(key);
                    }
                    sceneManager.remove(key);
                }
            });

            console.log('[Multiplayer] Creating multiplayer board scene instances...');

            // Create scene instances manually with unique keys
            const scene1 = new this.MultiplayerBoardSceneClass('MultiplayerBoardScene1');
            const scene2 = new this.MultiplayerBoardSceneClass('MultiplayerBoardScene2');

            console.log('[Multiplayer] Scene instances created:', scene1, scene2);
            console.log('[Multiplayer] Scene keys:', scene1.scene?.key, scene2.scene?.key);

            // Add the scene instances to Phaser
            const addResult1 = sceneManager.add('MultiplayerBoardScene1', scene1, false);
            const addResult2 = sceneManager.add('MultiplayerBoardScene2', scene2, false);

            console.log('[Multiplayer] Add results:', addResult1, addResult2);

            // Store scene references
            this.multiplayerBoardScenes = [scene1, scene2];

            // Configuration data for init()
            const scene1Config = {
                playerId: 1,
                viewport: viewports[0],
                playerLabel: 'PLAYER 1',
                getPendingGarbage: () => this.multiplayerState?.getGarbageQueue(1).getTotalLines() ?? 0,
            };

            const scene2Config = {
                playerId: 2,
                viewport: viewports[1],
                playerLabel: 'PLAYER 2',
                getPendingGarbage: () => this.multiplayerState?.getGarbageQueue(2).getTotalLines() ?? 0,
            };

            console.log('[Multiplayer] About to start scenes...');
            console.log('[Multiplayer] Scene manager keys:', sceneManager.keys);

            // Start the scenes with their configuration
            sceneManager.start('MultiplayerBoardScene1', scene1Config);
            sceneManager.start('MultiplayerBoardScene2', scene2Config);

            console.log('[Multiplayer] Scenes started');
            console.log(
                '[Multiplayer] Active scenes:',
                sceneManager.isActive('MultiplayerBoardScene1'),
                sceneManager.isActive('MultiplayerBoardScene2'),
            );

            // Scenes are created synchronously, so they're already ready!
            // Just do the setup immediately
            console.log('[Multiplayer] Both scenes created successfully');

            // Debug: Check canvas state
            if (this.phaserGame.canvas) {
                const { canvas } = this.phaserGame;
                const computedStyle = window.getComputedStyle(canvas);
                const rect = canvas.getBoundingClientRect();

                console.log('[Multiplayer] Canvas dimensions:', canvas.width, 'x', canvas.height);
                console.log('[Multiplayer] Canvas style:', canvas.style.width, 'x', canvas.style.height);
                console.log('[Multiplayer] Canvas parent:', canvas.parentElement?.id);
                console.log('[Multiplayer] Canvas display:', computedStyle.display);
                console.log('[Multiplayer] Canvas visibility:', computedStyle.visibility);
                console.log('[Multiplayer] Canvas opacity:', computedStyle.opacity);
                console.log('[Multiplayer] Canvas position on screen:', rect);
                console.log('[Multiplayer] Canvas z-index:', computedStyle.zIndex);

                // Check viewport settings
                console.log(
                    '[Multiplayer] Scene 1 viewport:',
                    scene1.cameras?.main?.x,
                    scene1.cameras?.main?.y,
                    scene1.cameras?.main?.width,
                    scene1.cameras?.main?.height,
                );
                console.log(
                    '[Multiplayer] Scene 2 viewport:',
                    scene2.cameras?.main?.x,
                    scene2.cameras?.main?.y,
                    scene2.cameras?.main?.width,
                    scene2.cameras?.main?.height,
                );
            }

            // Set effect quality
            this.multiplayerBoardScenes.forEach((sceneInstance) => {
                sceneInstance?.setEffectQuality?.(this.currentEffectQuality);
            });

            // Initial sync
            this.syncMultiplayerBoardScenes();

            // Resolve immediately
            resolve();
        });
    }

    teardownMultiplayerBoardScenes() {
        if (!this.phaserGame) return;
        const sceneManager = this.phaserGame.scene;
        ['MultiplayerBoardScene1', 'MultiplayerBoardScene2'].forEach((key) => {
            if (sceneManager.isActive(key)) {
                sceneManager.stop(key);
            }
        });
        this.multiplayerBoardScenes = [];
    }

    syncMultiplayerBoardScenes() {
        if (!this.multiplayerBoardScenes || this.multiplayerBoardScenes.length === 0) return;
        const [scene1, scene2] = this.multiplayerBoardScenes;
        if (scene1 && this.multiplayerState?.player1) {
            scene1.syncFromGameState(this.multiplayerState.player1);
        }
        if (scene2 && this.multiplayerState?.player2) {
            scene2.syncFromGameState(this.multiplayerState.player2);
        }
    }

    /**
     * Initialize all manager systems
     */
    async initializeManagers() {
        // High scores (needs to be first for async DB init)
        this.highScoreManager = new HighScoreManager();
        await this.highScoreManager.init();

        // Demo Manager
        this.demoManager = new DemoManager();
        await this.demoManager.init();

        // Settings
        this.settingsManager = new SettingsManager();
        this.settingsManager.load(); // Load from localStorage
        if (typeof window !== 'undefined') {
            window.settingsManager = this.settingsManager;
        }
        const currentSettings = this.settingsManager.get();
        setPieceLockRippleCss(currentSettings.pieceLockRippleColor);

        // Display manager (Phase 1)
        this.displayManager = new DisplayManager();
        console.log('[DisplayManager] Initialized', {
            isElectron: this.displayManager.isElectron,
        });

        // Initialize FPS counter element
        this.fpsCounter.element = document.getElementById('fps-counter');

        // Apply display/frame settings immediately
        await this.applyDisplaySettings(currentSettings);
        await this.applyFrameRateSettings(currentSettings);

        // Modal manager (gamepad controller will be set after it's created)
        this.modalManager = new ModalManager();

        // Audio
        if (!this.soundManager) {
            this.soundManager = new SoundManager();
        }
        // Sync volume settings immediately after creation/loading
        if (this.soundManager) {
            this.soundManager.setMusicVolume(currentSettings.musicVolume);
            this.soundManager.setSFXVolume(currentSettings.sfxVolume);
        }
        if (!Array.isArray(this.soundManager.songsData) || this.soundManager.songsData.length === 0) {
            await this.soundManager.initializeTracks();
        } else {
            this.soundManager.populateMusicDropdown();
        }
        if (typeof this.soundManager.isMusicPlaying === 'function'
            && !this.soundManager.isMusicPlaying()) {
            this.soundManager.startBackgroundMusic();
        }

        const resumeAudio = () => {
            this.soundManager.resumeAudioContext();
            if (this.soundManager?.ensureTrackPlaybackSynced) {
                this.soundManager.ensureTrackPlaybackSynced({
                    reason: 'user-gesture-audio-unlock',
                    force: true,
                }).catch((error) => {
                    console.warn('[Audio] Failed to resync background music after user gesture:', error);
                });
            } else if (this.soundManager?.startBackgroundMusic) {
                this.soundManager.startBackgroundMusic();
            }
            document.removeEventListener('click', resumeAudio);
            document.removeEventListener('keydown', resumeAudio);
        };

        document.addEventListener('click', resumeAudio);
        document.addEventListener('keydown', resumeAudio);

        // Theme manager
        this.themeManager = new ThemeManager(this.webglRenderer, {
            audioManager: this.soundManager,
        });
        if (typeof window !== 'undefined') {
            window.themeManager = this.themeManager;
        }
        if (this.themeManager?.suspendThemes) {
            this.themeManager.suspendThemes();
        }

        // Set cross-references between managers
        this.soundManager.settingsManager = this.settingsManager;
        this.soundManager.themeManager = this.themeManager;

        // Input controller
        this.inputController = new InputController();

        // Gamepad controller
        this.gamepadController = new GamepadController();
        this.gamepadController.initialize();

        // Connect gamepad controller to modal manager
        this.modalManager.setGamepadController(this.gamepadController);

        // Set pause/resume callbacks for gamepad
        this.gamepadController.setPauseCallbacks(
            () => this.pauseGame(),
            () => this.resumeGame(),
        );

        // Initialize gamepad with custom bindings from settings
        const settings = this.settingsManager.get();
        this.gamepadController.updateBindings(
            settings.gamepadBindings,
            settings.player2GamepadBindings,
            settings.player3GamepadBindings,
            settings.player4GamepadBindings,
        );
        if (settings.gamepadDeadzone !== undefined) {
            this.gamepadController.updateDeadzone(settings.gamepadDeadzone);
        }
        if (settings.gamepadEnabled) {
            this.gamepadController.enable();
        }

        // Game mode UI
        this.gameModeUI = new GameModeUI();

        // Set initial mode from settings
        const savedMode = this.settingsManager.get().gameMode || 'single';
        this.gameModeUI.setModeFromSettings(savedMode);

        console.log('✅ All managers initialized');

        // Steam Cloud Sync (Phase 5) - non-blocking
        this.cloudSyncManager = new SteamCloudSyncManager({
            settingsManager: this.settingsManager,
            highScoreManager: this.highScoreManager,
        });
        this.cloudSyncManager.initialize();
        if (typeof window !== 'undefined') {
            window.cloudSyncManager = this.cloudSyncManager;
        }

        // Initialize global Serenity Hub (accessible from all game modes)
        this.initializeGlobalSerenityHub();

        // this.startBackgroundScene(); // Moved to end of init
        this.applyEffectQuality(this.settingsManager.get().effectQuality);
    }

    /**
     * Initialize global Serenity Hub (works in all game modes)
     */
    initializeGlobalSerenityHub() {
        console.log('[Main] Initializing global Serenity Hub...');

        // Create a minimal wrapper object that provides the deps SerenityHub needs
        const hubWrapper = {
            deps: {
                soundManager: this.soundManager,
                themeManager: this.themeManager,
                settingsManager: this.settingsManager,
                gamepadController: this.gamepadController,
            },
            // Provide stub methods for Serenity Mode-specific features
            _toggleBreathingIndicator: () => {
                console.log('[SerenityHub] Breathing indicator only available in Serenity Mode');
            },
            _randomTheme: () => {
                this.switchToRandomTheme();
            },
            _toggleFullscreen: () => {
                toggleFullScreen();
            },
        };

        this.serenityHub = new SerenityHub(hubWrapper);

        // Set pause/resume callbacks - only pause for single player, local MP, and infinity
        this.serenityHub.setPauseResumeCallbacks(
            () => {
                // Only pause if in a pausable mode
                const currentMode = this.gameModeManager?.getCurrentModeId();
                const pausableModes = ['single', 'local-multiplayer', 'infinity'];

                if (pausableModes.includes(currentMode)) {
                    console.log('[SerenityHub] Pausing game for mode:', currentMode);
                    // Use pauseGameOnly to avoid opening settings modal
                    this.pauseGameOnly();
                } else {
                    console.log('[SerenityHub] Not pausing - mode does not require pause:', currentMode);
                }
            },
            () => {
                // Only resume if in a pausable mode
                const currentMode = this.gameModeManager?.getCurrentModeId();
                const pausableModes = ['single', 'local-multiplayer', 'infinity'];

                if (pausableModes.includes(currentMode)) {
                    console.log('[SerenityHub] Resuming game for mode:', currentMode);
                    this.resumeGame();
                } else {
                    console.log('[SerenityHub] Not resuming - mode does not require resume:', currentMode);
                }
            },
        );

        console.log('✅ Global Serenity Hub initialized');
    }

    /**
     * Initialize GameModeManager with all dependencies
     */
    initializeGameModeManager() {
        console.log('[Main] Initializing GameModeManager...');

        // Create GameModeManager with all shared dependencies
        this.gameModeManager = new GameModeManager({
            phaserGame: this.phaserGame,
            soundManager: this.soundManager,
            themeManager: this.themeManager,
            settingsManager: this.settingsManager,
            highScoreManager: this.highScoreManager,
            modalManager: this.modalManager,
            gamepadController: this.gamepadController,
            frameRateController: this.frameRateController,
            BoardSceneClass: this.BoardSceneClass || null,
            MultiplayerBoardSceneClass: this.MultiplayerBoardSceneClass || null,
            getMultiplayerPhysicsCallbacks: (playerNum) => this.getMultiplayerPhysicsCallbacks(playerNum),
        });

        // Initialize RichPresenceManager with GameModeManager for automatic updates
        richPresenceManager.initialize(this.gameModeManager);

        // Subscribe to mode events
        this.gameModeManager.on('modeActivated', ({ modeId }) => {
            console.log(`[Main] Mode activated: ${modeId}`);
        });

        this.gameModeManager.on('modeStarted', ({ modeId }) => {
            console.log(`[Main] Mode started: ${modeId}`);
        });

        this.gameModeManager.on('modeStopped', ({ modeId }) => {
            console.log(`[Main] Mode stopped: ${modeId}`);
        });

        // Setup start button click handler (for old button-based UI)
        const startGameBtn = document.getElementById('start-game-btn');
        if (startGameBtn) {
            startGameBtn.addEventListener('click', async () => {
                try {
                    // Get the currently selected mode from UI
                    const selectedMode = this.gameModeUI.getMode();

                    // Activate the mode (if not already active)
                    await this.gameModeManager.activateMode(selectedMode);

                    // Start the game
                    await this.gameModeManager.startCurrentMode();
                    if (this.soundManager?.ensureTrackPlaybackSynced) {
                        await this.soundManager.ensureTrackPlaybackSynced({
                            reason: 'legacy-start-button',
                            force: true,
                        });
                    }

                    // Hide start modal
                    this.modalManager.hideAll();
                } catch (error) {
                    console.error('[Main] Failed to start game:', error);
                    alert(`Failed to start game: ${error.message}`);
                }
            });
        }

        // Deprecated: Keep legacy gameState for backward compatibility
        // This will be removed once all code is migrated to use GameModeManager
        this.gameState = new GameState();

        console.log('✅ GameModeManager initialized');
    }

    /**
     * Load initial theme based on settings
     */
    async loadInitialTheme() {
        const settings = this.settingsManager.get();
        let initialTheme = 'forest'; // default

        switch (settings.backgroundMode) {
            case 'Specific':
                initialTheme = settings.backgroundTheme || 'forest';
                break;
            case 'Level':
                initialTheme = this.themeManager.getThemeForLevel(1);
                break;
            case 'Random':
                initialTheme = this.themeManager.getRandomTheme();
                this.themeManager.startRandomThemeInterval(settings.randomThemeInterval / 60);
                break;
        }

        await this.themeManager.switchTheme(initialTheme);
        console.log(`✅ Initial theme loaded: ${initialTheme}`);
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Window resize
        const resizeHandler = () => {
            console.log('[Main] Window resized, notifying GameModeManager');
            this.handleResize();
        };
        window.addEventListener('resize', resizeHandler);

        // Theme change events (from event bus)
        const unsubscribeThemeChanged = eventBus.on(EVENTS.THEME_CHANGED, ({ themeName }) => {
            console.log(`Theme changed to: ${themeName}`);

            // Update music if theme-linked mode is enabled
            const settings = this.settingsManager.get();
            if (settings.themeLinkedMode) {
                this.soundManager.applyThemeLinkedMusic(themeName);
            }

            // Update sound set based on theme (only if theme-linked SFX is enabled)
            if (settings.themeLinkedSfx) {
                const soundSet = THEME_SFX_MAP[themeName] || 'Zen';
                console.log(`[Main] Theme-Linked SFX: Switching to ${soundSet} for theme ${themeName}`);
                this.soundManager.setSoundSet(soundSet);
            }
        });

        // Settings change events
        const settingsHandler = (e) => {
            this.handleSettingsChange(e.detail);
        };
        window.addEventListener('settingsChanged', settingsHandler);

        const gameModeHandler = (e) => {
            console.log('[Main] Game mode changed from UI:', e.detail.mode);
            this.settingsManager.update({ gameMode: e.detail.mode });
            this.settingsManager.save();
        };
        window.addEventListener('gameModeChanged', gameModeHandler);

        // Handle card-based mode selection (new UI)
        const MODE_DISPLAY_NAMES = {
            [GAME_MODES.SINGLE_PLAYER]: 'SINGLE PLAYER',
            [GAME_MODES.INFINITY]: 'INFINITY',
        };

        const startGameWithModeHandler = async (e) => {
            try {
                const { mode } = e.detail;
                console.log('[Main] Starting game with mode from card selection:', mode);

                this.soundManager?.resumeAudioContext?.();

                // Disable gamepad mode selection
                if (this.gamepadController) {
                    this.gamepadController.disableGameModeSelection();
                }

                // --- Phase 1: Show cinematic loading overlay + fade out intro music ---
                const displayName = MODE_DISPLAY_NAMES[mode];
                if (displayName) {
                    showCinematicLoadingOverlay(displayName);
                }

                // Music fade-out is handled by performTrackSwitch when the
                // theme-linked track change triggers — no separate fade needed here.

                // --- Phase 2: Wait for overlay to cover screen, then do heavy work ---
                await new Promise((r) => setTimeout(r, 500));

                // Now safe to hide modal (invisible behind overlay)
                this.modalManager.hideAll();

                // Activate the mode (sets up UI/DOM elements)
                await this.gameModeManager.activateMode(mode);

                // Start the game (includes theme resume)
                await this.gameModeManager.startCurrentMode();

                // --- Phase 3: Wait for theme to be ready ---
                if (this.themeManager?.waitForThemeReady) {
                    const themeReady = await this.themeManager.waitForThemeReady(3000);
                    console.log('[Main] Theme ready:', themeReady);
                }

                // --- Phase 4: Sync music (theme music fades in via 1200ms fade) ---
                if (this.soundManager?.ensureTrackPlaybackSynced) {
                    await this.soundManager.ensureTrackPlaybackSynced({
                        reason: 'card-start',
                        force: true,
                    });
                }

                // --- Phase 5: Dismiss cinematic overlay + dismiss intro ---
                dismissCinematicLoadingOverlay(800);

                const activeMode = this.gameModeManager.getCurrentMode();
                const modeStarted = !!activeMode
                    && activeMode.getModeId() === mode
                    && activeMode.isRunning;

                const shouldDismissIntroHere = modeStarted && mode !== GAME_MODES.LOCAL_MULTIPLAYER;
                if (shouldDismissIntroHere && introAnimation) {
                    introAnimation.dismiss();
                }
            } catch (error) {
                console.error('[Main] Failed to start game from card selection:', error);
                dismissCinematicLoadingOverlay(300);
                alert(`Failed to start game: ${error.message}`);
            }
        };
        window.addEventListener('startGameWithMode', startGameWithModeHandler);

        const startModalShownHandler = (event) => {
            if (event?.detail?.modalName === 'start' && this.themeManager?.suspendThemes) {
                this.themeManager.suspendThemes();
            }
        };
        window.addEventListener('modalShown', startModalShownHandler);

        // REMOVED: "Press any key" auto-start mechanism
        // Now using explicit "START GAME" button for better UX
        // No game modes start automatically - user must explicitly click start button

        this.cleanupHandlers.push(() => {
            unsubscribeThemeChanged();
            window.removeEventListener('resize', resizeHandler);
            window.removeEventListener('settingsChanged', settingsHandler);
            window.removeEventListener('startGameWithMode', startGameWithModeHandler);
            window.removeEventListener('gameModeChanged', gameModeHandler);
            window.removeEventListener('modalShown', startModalShownHandler);
        });
    }

    /**
     * Setup UI buttons and interactions
     */
    setupUI() {
        // Demo Browser
        this.demoBrowser = new DemoBrowser(this.demoManager, this.gameModeManager);

        const replaysBtn = document.getElementById('open-replays-btn');
        if (replaysBtn) {
            replaysBtn.addEventListener('click', () => {
                this.demoBrowser.show();
            });
        }

        // Listen for global open requests (e.g. from Game Over screens)
        eventBus.on(EVENTS.OPEN_DEMO_BROWSER, () => {
            if (this.demoBrowser) {
                this.demoBrowser.show();
            }
        });

        // Listen for return to main menu requests
        eventBus.on(EVENTS.EXIT_TO_MAIN_MENU, () => {
            this._returnToMainMenu();
        });

        // Setup modal UI with callbacks (pass gameModeManager for Serenity Hub icon)
        setupModalUI(this.modalManager, {
            onSettingsOpen: () => {
                this.pauseGame();
            },
            onSettingsClose: () => {
                this.resumeGame();
            },
            onHighScoresOpen: () => {
                showHighScoresModal(this.modalManager, this.highScoreManager, (demoId) => this._playDemoById(demoId));
            },
            onHighScoresClose: () => {
                // Modal closes automatically
            },
            onFullscreenToggle: () => {
                toggleFullScreen();
            },
            onNextTrack: () => {
                this.soundManager.nextTrack();
            },
            onRandomTheme: () => {
                this.switchToRandomTheme();
            },
        }, this.gameModeManager);

        // Initialize settings UI (includes tab switching)
        initializeSettingsUI(this.settingsManager, {
            onMusicVolumeChange: (volume) => {
                this.soundManager.setMusicVolume(volume);
            },
            onSfxVolumeChange: (volume) => {
                this.soundManager.setSFXVolume(volume);
            },
            onSoundSetChange: (soundSet) => {
                console.log('[Main] Sound set changed to:', soundSet);
                this.soundManager.setSoundSet(soundSet);
            },
            onThemeLinkedModeChange: (enabled) => {
                console.log('[Main] Theme-linked mode:', enabled);
                // Theme-linked mode is handled automatically by sound manager
            },
            onAutoThemeChangeToggle: (enabled) => {
                console.log('[Main] Auto theme change:', enabled);
                // Auto theme change is handled automatically by sound manager
            },
            onGamepadEnabledChange: (enabled) => {
                console.log('[Main] Gamepad enabled:', enabled);
                if (enabled) {
                    this.gamepadController.enable();
                } else {
                    this.gamepadController.disable();
                }
            },
            onGamepadDeadzoneChange: (deadzone) => {
                console.log('[Main] Gamepad deadzone:', deadzone);
                this.gamepadController.updateDeadzone(deadzone);
            },
            onGamepadRescan: () => {
                this.gamepadController.rescan();
                this.updateGamepadStatusDisplay();
            },
            onResetGamepadBindings: () => {
                const defaults = DEFAULT_SETTINGS;
                this.settingsManager.update({
                    gamepadBindings: { ...defaults.gamepadBindings },
                    player2GamepadBindings: { ...defaults.player2GamepadBindings },
                    player3GamepadBindings: { ...defaults.player3GamepadBindings },
                    player4GamepadBindings: { ...defaults.player4GamepadBindings },
                });
                this.settingsManager.save();
                const refreshedSettings = this.settingsManager.get();
                updateGamepadControlsDisplay(refreshedSettings);
                this.gamepadController.updateBindings(
                    refreshedSettings.gamepadBindings,
                    refreshedSettings.player2GamepadBindings,
                    refreshedSettings.player3GamepadBindings,
                    refreshedSettings.player4GamepadBindings,
                );
                this.updateGamepadStatusDisplay();
            },
            onBackgroundModeChange: (mode) => {
                const settings = this.settingsManager.get();
                if (mode === 'Specific') {
                    this.themeManager.switchTheme(settings.backgroundTheme);
                    this.themeManager.stopRandomThemeInterval();
                } else if (mode === 'Random') {
                    if (settings.autoThemeChange) {
                        this.themeManager.startRandomThemeInterval(
                            settings.randomThemeInterval / 60,
                        );
                    }
                } else if (mode === 'Level') {
                    const levelTheme = this.themeManager.getThemeForLevel(
                        this.gameState?.level || 1,
                    );
                    this.themeManager.switchTheme(levelTheme);
                    this.themeManager.stopRandomThemeInterval();
                }
            },
            onThemeLinkedSfxChange: (enabled) => {
                console.log('[Main] Theme-Linked SFX toggled:', enabled);
                if (enabled) {
                    // Immediately apply sound set based on current theme
                    const currentTheme = this.themeManager.activeThemeName;
                    if (currentTheme) {
                        const soundSet = THEME_SFX_MAP[currentTheme] || 'Zen';
                        console.log(`[Main] Theme-Linked SFX enabled: Setting ${soundSet} for theme ${currentTheme}`);
                        this.soundManager.setSoundSet(soundSet);
                    }
                }
            },
            onGameModeChange: async (mode) => {
                console.log('[Main] Game mode changed to:', mode);

                // Map settings mode values to GAME_MODES constants
                const modeMap = {
                    single: GAME_MODES.SINGLE_PLAYER,
                    'local-multiplayer': GAME_MODES.LOCAL_MULTIPLAYER,
                    'online-multiplayer': GAME_MODES.ONLINE_MULTIPLAYER,
                    serenity: GAME_MODES.SERENITY,
                };

                const targetMode = modeMap[mode] || GAME_MODES.SINGLE_PLAYER;
                const currentMode = this.gameModeManager.getCurrentModeId();

                // Check if a game is currently running
                const currentModeInstance = this.gameModeManager.getCurrentMode();
                const isGameActive = currentModeInstance && currentModeInstance.isRunning;

                // Stop and deactivate current mode if active
                if (currentMode) {
                    console.log(`[Main] Stopping current mode: ${currentMode}`);
                    await this.gameModeManager.stopCurrentMode();
                    await this.gameModeManager.deactivateCurrentMode();
                }

                // Activate the new mode
                try {
                    console.log(`[Main] Activating new mode: ${targetMode}`);
                    await this.gameModeManager.activateMode(targetMode);

                    // Update UI to reflect the new mode
                    this.gameModeUI.setModeFromSettings(mode);

                    // Show a notification about the mode switch
                    const modeNames = {
                        single: 'Single Player',
                        'local-multiplayer': 'Local MP',
                        'online-multiplayer': 'Online Multiplayer',
                        serenity: 'Serenity Mode',
                    };
                    const modeName = modeNames[mode] || mode;

                    // If a game was active, automatically start the new mode
                    if (isGameActive) {
                        console.log(`[Main] Auto-starting new mode: ${targetMode}`);
                        await this.gameModeManager.startCurrentMode();
                        this.modalManager.hideAll();

                        // Show a brief notification (if the mode has this feature)
                        const activeMode = this.gameModeManager.getMode(targetMode);
                        if (activeMode && activeMode._showNotification) {
                            activeMode._showNotification(`Switched to ${modeName}`);
                        }
                    } else {
                        // Otherwise show the start modal
                        this.modalManager.show('start');
                        console.log('[Main] Showing start modal for new game mode');
                    }
                } catch (error) {
                    console.error('[Main] Failed to switch game mode:', error);
                    this.modalManager.show('start');
                }
            },
            onChangeGameMode: async () => {
                console.log('[Main] Change Game Mode button clicked - returning to start modal');

                // Stop and deactivate current game mode if active
                const currentMode = this.gameModeManager?.getCurrentMode();
                if (currentMode) {
                    console.log('[Main] Stopping and deactivating current mode');
                    await this.gameModeManager.stopCurrentMode();
                    await this.gameModeManager.deactivateCurrentMode();
                }

                // Hide all game UI containers
                const singlePlayerContainer = document.getElementById('single-player-container');
                if (singlePlayerContainer) singlePlayerContainer.style.display = 'none';

                const multiplayerContainer = document.getElementById('multiplayer-container');
                if (multiplayerContainer) multiplayerContainer.style.display = 'none';

                const statsBar = document.querySelector('.single-player-stats-bar');
                if (statsBar) statsBar.style.display = 'none';

                const singlePlayerStage = document.querySelector('.single-player-stage');
                if (singlePlayerStage) singlePlayerStage.style.display = 'none';

                // Show intro animation background (without title text)
                if (introAnimation) {
                    await introAnimation.showBackgroundOnly(this.soundManager);
                    await introAnimation.waitForMenuBgReady?.(1500);
                }

                // Close settings modal and show start modal
                this.modalManager.hide('settings');
                this.modalManager.show('start');
            },
            // Display Settings (Phase 1)
            onDisplaySettingsApply: async (settings) => {
                console.log('[Settings] Applying display settings:', settings);
                await this.applyDisplaySettings(settings);
            },
            onFrameRateSettingsApply: async (settings) => {
                console.log('[Settings] Applying frame rate settings:', settings);
                await this.applyFrameRateSettings(settings);
            },
            onBackgroundTabBehaviorChange: (behavior) => {
                console.log('[Settings] Background tab behavior changed to:', behavior);
                // Update the visibility manager with new behavior
                this.updateBackgroundTabBehavior(behavior);
            },
        });

        // Start button
        document.getElementById('start-btn')?.addEventListener('click', () => {
            this.startGame();
        });

        // Random theme button (already handled in setupModalUI, but keeping for backwards compatibility)
        document.getElementById('random-theme-btn')?.addEventListener('click', () => {
            this.switchToRandomTheme();
        });

        // Next track button (already handled in setupModalUI, but keeping for backwards compatibility)
        document.getElementById('next-track-btn')?.addEventListener('click', () => {
            this.soundManager.nextTrack();
        });
    }

    /**
     * Get physics callbacks for piece locking
     */
    getPhysicsCallbacks() {
        const currentMode = this.gameModeManager?.getCurrentMode();
        if (currentMode && typeof currentMode.getPhysicsCallbacks === 'function') {
            const modeCallbacks = currentMode.getPhysicsCallbacks();
            if (modeCallbacks) {
                return modeCallbacks;
            }
        }

        const getState = () => this.getActiveGameState();

        return {
            draw: () => {
                const gameState = getState();
                if (!gameState) return;
                // Fallback to canvas rendering if Phaser scene not available
                if (!this.boardScene && this.canvas && this.ctx) {
                    draw(this.canvas, this.ctx, gameState);
                }
            },
            onLevelUp: (level) => {
                const gameState = getState();
                if (!gameState) return;
                updateStats(gameState);
                this.updatePhaserStats(gameState);
            },
            onScoreAdd: (points) => {
                const gameState = getState();
                if (!gameState) return;
                updateStats(gameState);
                this.updatePhaserStats(gameState);
            },
            onLineClear: (count, holeColumns) => {
                // Visual feedback handled in draw
                // holeColumns parameter not used in single-player mode

                // Emit event for theme reactions
                console.log('[Main] Emitting LINE_CLEAR event, count:', count);
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: count });
            },
            updateBoard: (boardData) => {
                // Board updates handled in draw
            },
            playLineClear: () => this.soundManager.sfxPlayer.playLineClear(),
            playLevelUp: () => this.soundManager.sfxPlayer.playLevelUp(),
            triggerFlash: (clearedRows) => {
                const settings = this.settingsManager.get();
                if (settings.lineClearEffects) {
                    if (this.boardScene) {
                        this.boardScene.triggerLineClearFlash(clearedRows);
                    } else {
                        triggerLineClearFlash(clearedRows);
                    }
                }
            },
            triggerBackgroundPulse: (lineCount) => triggerBackgroundPulse(lineCount),
            onLineClearImpact: (lineCount) => {
                const settings = this.settingsManager.get();
                if (
                    settings.lineClearEffects
                    && this.boardScene
                    && typeof this.boardScene.playLineClearImpact === 'function'
                ) {
                    this.boardScene.playLineClearImpact(lineCount);
                }
            },
            triggerCombo: (comboCount) => {
                const settings = this.settingsManager.get();
                if (settings.comboPopupEffect) {
                    if (this.boardScene) {
                        this.boardScene.showComboPopup(comboCount);
                    } else {
                        showComboPopup(comboCount);
                    }
                }

                // Emit event for theme reactions
                console.log('[Main] Emitting COMBO event, comboCount:', comboCount);
                eventBus.emit(EVENTS.COMBO, { comboCount });
            },
            onPieceLock: (piece) => {
                const gameState = getState();
                if (!gameState) return;
                const settings = this.settingsManager.get();
                if (settings.pieceLockRipple) {
                    if (this.boardScene) {
                        this.boardScene.createPieceLockRipple(piece);
                    } else {
                        createPieceLockRipple(piece, gameState.lockedPieces);
                    }
                }

                // Emit event for theme reactions
                eventBus.emit(EVENTS.PIECE_LOCK, { piece });
            },
            updateBackground: (level) => {
                const settings = this.settingsManager.get();
                if (settings.backgroundMode === 'Level') {
                    const levelTheme = this.themeManager.getThemeForLevel(level);
                    this.themeManager.switchTheme(levelTheme);
                }
            },
            spawnPiece: () => {
                const gameState = getState();
                if (!gameState) return;
                spawnPiece(
                    gameState,
                    () => this.refreshNextQueue(gameState),
                    () => this.endGame(gameState),
                );
            },
        };
    }

    /**
     * Expose game controls as globals for controls.js
     */
    exposeGlobalControls() {
        // Game functions are already imported at the top

        // Expose settings
        window.settings = this.settingsManager.get();

        // Expose game actions object (legacy - use gameModeManager instead)
        window.gameActions = this.gameState;

        // Expose input controller
        window.inputController = this.inputController;

        // Helper to get current game state from active mode
        const getCurrentGameState = () => {
            const currentMode = this.gameModeManager?.getCurrentMode();
            // For local multiplayer, return player1
            if (currentMode && currentMode.multiplayerState) {
                const { multiplayerState } = currentMode;
                // Support both new (players array) and old (player1/player2) structure
                return multiplayerState.players ? multiplayerState.players[0] : multiplayerState.player1;
            }
            // For other modes, return gameState
            if (currentMode && currentMode.gameState) {
                return currentMode.gameState;
            }
            // Fallback to legacy state
            return this.gameState;
        };

        // Expose game control functions
        window.move = (dir) => {
            const gameState = getCurrentGameState();
            if (!gameState || !gameState.currentPiece) return;

            // Check if game is paused (important for multiplayer round transitions)
            const currentMode = this.gameModeManager?.getCurrentMode();
            if (currentMode?.multiplayerState?.isPaused || gameState.isPaused) return;
            if (isPlayerPaused(currentMode?.multiplayerState, 1)) return;

            coreMove(
                gameState,
                dir,
                () => this.soundManager.sfxPlayer.playMove(),
                addPieceTrail,
            );
        };

        window.rotate = (dir) => {
            const gameState = getCurrentGameState();
            if (!gameState || !gameState.currentPiece) return;

            // Check if game is paused (important for multiplayer round transitions)
            const currentMode = this.gameModeManager?.getCurrentMode();
            if (currentMode?.multiplayerState?.isPaused || gameState.isPaused) return;
            if (isPlayerPaused(currentMode?.multiplayerState, 1)) return;

            coreRotate(
                gameState,
                dir,
                () => this.soundManager.sfxPlayer.playRotate(),
                addPieceTrail,
            );
        };

        window.softDrop = () => {
            const gameState = getCurrentGameState();
            if (!gameState || !gameState.currentPiece) return;

            // Check if we're in multiplayer mode and use appropriate callbacks
            const currentMode = this.gameModeManager?.getCurrentMode();

            // Check if game is paused (important for multiplayer round transitions)
            if (currentMode?.multiplayerState?.isPaused || gameState.isPaused) return;
            if (isPlayerPaused(currentMode?.multiplayerState, 1)) return;

            const callbacks = (currentMode && currentMode.multiplayerState)
                ? this.getMultiplayerPhysicsCallbacks(1)
                : this.getPhysicsCallbacks();

            coreSoftDrop(
                gameState,
                () => this.soundManager.sfxPlayer.playDrop(),
                callbacks,
            );
        };

        window.hardDrop = () => {
            const gameState = getCurrentGameState();
            if (!gameState || !gameState.currentPiece) return;

            // Check if we're in multiplayer mode and use appropriate callbacks
            const currentMode = this.gameModeManager?.getCurrentMode();

            // Check if game is paused (important for multiplayer round transitions)
            if (currentMode?.multiplayerState?.isPaused || gameState.isPaused) return;
            if (isPlayerPaused(currentMode?.multiplayerState, 1)) return;

            const callbacks = (currentMode && currentMode.multiplayerState)
                ? this.getMultiplayerPhysicsCallbacks(1)
                : this.getPhysicsCallbacks();

            coreHardDrop(
                gameState,
                () => this.soundManager.sfxPlayer.playDrop(),
                callbacks,
            );
        };

        window.togglePause = () => {
            this.togglePause();
        };

        window.openSettingsMenu = () => {
            this.openSettingsMenu();
        };

        window.startGame = () => {
            this.startGame();
        };

        window.initSound = () => {
            // Sound is already initialized
        };

        window.nextTrack = () => {
            this.soundManager.nextTrack();
        };

        window.randomTheme = () => {
            this.switchToRandomTheme();
        };

        window.toggleFullscreen = () => {
            toggleFullScreen();
        };

        window.showHighScores = () => {
            // Don't show high scores in Serenity Mode (it has its own hub)
            const currentMode = this.gameModeManager?.getCurrentMode();
            if (currentMode && currentMode.getModeId() === GAME_MODES.SERENITY) {
                return;
            }

            if (this.modalManager.isVisible('highScores')) {
                closeHighScoresModal(this.modalManager);
            } else {
                showHighScoresModal(this.modalManager, this.highScoreManager, (demoId) => this._playDemoById(demoId));
            }
        };

        // Helper to get multiplayer state from active mode
        const getMultiplayerState = () => {
            const currentMode = this.gameModeManager?.getCurrentMode();
            if (currentMode && currentMode.multiplayerState) {
                return currentMode.multiplayerState;
            }
            // Fallback to legacy state
            return this.multiplayerState;
        };

        // Helper to get player state (supports both old and new structure)
        const getPlayerState = (playerNum) => {
            const multiplayerState = getMultiplayerState();
            if (!multiplayerState) return null;

            // New structure uses players array (0-based), old structure uses player1/player2
            if (multiplayerState.players) {
                return multiplayerState.players[playerNum - 1];
            }
            return playerNum === 1 ? multiplayerState.player1 : multiplayerState.player2;
        };

        const isPlayerPaused = (multiplayerState, playerNum) => (
            Boolean(multiplayerState?.playerPaused?.[playerNum - 1])
        );

        // Expose Player 2 controls for multiplayer
        window.moveP2 = (dir) => {
            const multiplayerState = getMultiplayerState();
            const player2State = getPlayerState(2);
            // Check if game is paused or game over
            if (!multiplayerState || !player2State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 2)) return;

            coreMove(
                player2State,
                dir,
                () => this.soundManager.sfxPlayer.playMove(),
                addPieceTrail,
            );
        };

        window.rotateP2 = (dir) => {
            const multiplayerState = getMultiplayerState();
            const player2State = getPlayerState(2);
            // Check if game is paused or game over
            if (!multiplayerState || !player2State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 2)) return;

            coreRotate(
                player2State,
                dir,
                () => this.soundManager.sfxPlayer.playRotate(),
                addPieceTrail,
            );
        };

        window.softDropP2 = () => {
            const multiplayerState = getMultiplayerState();
            const player2State = getPlayerState(2);
            // Check if game is paused or game over
            if (!multiplayerState || !player2State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 2)) return;

            coreSoftDrop(
                player2State,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getMultiplayerPhysicsCallbacks(2),
            );
        };

        window.hardDropP2 = () => {
            const multiplayerState = getMultiplayerState();
            const player2State = getPlayerState(2);
            // Check if game is paused or game over
            if (!multiplayerState || !player2State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 2)) return;

            coreHardDrop(
                player2State,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getMultiplayerPhysicsCallbacks(2),
            );
        };

        // Expose Player 3 controls for multiplayer (Gamepad only)
        window.moveP3 = (dir) => {
            const multiplayerState = getMultiplayerState();
            const player3State = getPlayerState(3);
            // Check if game is paused or game over
            if (!multiplayerState || !player3State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 3)) return;

            coreMove(
                player3State,
                dir,
                () => this.soundManager.sfxPlayer.playMove(),
                addPieceTrail,
            );
        };

        window.rotateP3 = (dir) => {
            const multiplayerState = getMultiplayerState();
            const player3State = getPlayerState(3);
            // Check if game is paused or game over
            if (!multiplayerState || !player3State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 3)) return;

            coreRotate(
                player3State,
                dir,
                () => this.soundManager.sfxPlayer.playRotate(),
                addPieceTrail,
            );
        };

        window.softDropP3 = () => {
            const multiplayerState = getMultiplayerState();
            const player3State = getPlayerState(3);
            // Check if game is paused or game over
            if (!multiplayerState || !player3State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 3)) return;

            coreSoftDrop(
                player3State,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getMultiplayerPhysicsCallbacks(3),
            );
        };

        window.hardDropP3 = () => {
            const multiplayerState = getMultiplayerState();
            const player3State = getPlayerState(3);
            // Check if game is paused or game over
            if (!multiplayerState || !player3State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 3)) return;

            coreHardDrop(
                player3State,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getMultiplayerPhysicsCallbacks(3),
            );
        };

        // Expose Player 4 controls for multiplayer (Gamepad only)
        window.moveP4 = (dir) => {
            const multiplayerState = getMultiplayerState();
            const player4State = getPlayerState(4);
            // Check if game is paused or game over
            if (!multiplayerState || !player4State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 4)) return;

            coreMove(
                player4State,
                dir,
                () => this.soundManager.sfxPlayer.playMove(),
                addPieceTrail,
            );
        };

        window.rotateP4 = (dir) => {
            const multiplayerState = getMultiplayerState();
            const player4State = getPlayerState(4);
            // Check if game is paused or game over
            if (!multiplayerState || !player4State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 4)) return;

            coreRotate(
                player4State,
                dir,
                () => this.soundManager.sfxPlayer.playRotate(),
                addPieceTrail,
            );
        };

        window.softDropP4 = () => {
            const multiplayerState = getMultiplayerState();
            const player4State = getPlayerState(4);
            // Check if game is paused or game over
            if (!multiplayerState || !player4State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 4)) return;

            coreSoftDrop(
                player4State,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getMultiplayerPhysicsCallbacks(4),
            );
        };

        window.hardDropP4 = () => {
            const multiplayerState = getMultiplayerState();
            const player4State = getPlayerState(4);
            // Check if game is paused or game over
            if (!multiplayerState || !player4State || multiplayerState.isGameOver || multiplayerState.isPaused) return;
            if (isPlayerPaused(multiplayerState, 4)) return;

            coreHardDrop(
                player4State,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getMultiplayerPhysicsCallbacks(4),
            );
        };

        this.gameplayInputQueue = [];

        const enqueueGameplayCommand = (command) => {
            if (typeof command === 'function') {
                this.gameplayInputQueue.push(command);
            }
        };

        const runGameplayCommand = (command) => {
            if (typeof command !== 'function') return;
            try {
                command();
            } catch (error) {
                console.error('[Main] Gameplay command failed:', error);
            }
        };

        const enqueueSinglePlayerCommand = (command) => {
            const execute = () => {
                if (this.gameState?.isProcessingPhysics) {
                    if (!this.gameState.inputQueue && (command.type === 'move' || command.type === 'rotate')) {
                        this.gameState.inputQueue = {
                            type: command.type,
                            dir: command.value,
                        };
                    }
                    return;
                }

                if (command.type === 'move') {
                    window.move?.(command.value);
                } else if (command.type === 'rotate') {
                    window.rotate?.(command.value);
                } else if (command.type === 'softDrop') {
                    window.softDrop?.();
                } else if (command.type === 'hardDrop') {
                    window.hardDrop?.();
                }
            };

            // Execute immediately so input works across mode-specific loops.
            // Only the physics-busy branch above defers by writing to gameState.inputQueue.
            runGameplayCommand(execute);
        };

        // Setup keyboard and touch controls with the exposed gameActions
        // Use arrow functions to ensure we always call the CURRENT window functions (allows modes to hook them)
        const gameActions = {
            move: (...args) => window.move?.(...args),
            rotate: (...args) => window.rotate?.(...args),
            softDrop: (...args) => window.softDrop?.(...args),
            hardDrop: (...args) => window.hardDrop?.(...args),
            requestMove: (dir) => enqueueSinglePlayerCommand({ type: 'move', value: dir }),
            requestRotate: (dir) => enqueueSinglePlayerCommand({ type: 'rotate', value: dir }),
            requestSoftDrop: () => enqueueSinglePlayerCommand({ type: 'softDrop' }),
            requestHardDrop: () => enqueueSinglePlayerCommand({ type: 'hardDrop' }),
            togglePause: (...args) => window.togglePause?.(...args),
            openSettingsMenu: (...args) => window.openSettingsMenu?.(...args),
            startGame: (...args) => window.startGame?.(...args),
            initSound: (...args) => window.initSound?.(...args),
            nextTrack: (...args) => window.nextTrack?.(...args),
            randomTheme: (...args) => window.randomTheme?.(...args),
            toggleFullscreen: (...args) => window.toggleFullscreen?.(...args),
            showHighScores: (...args) => window.showHighScores?.(...args),
            // Player 2 actions
            moveP2: (...args) => window.moveP2?.(...args),
            rotateP2: (...args) => window.rotateP2?.(...args),
            softDropP2: (...args) => window.softDropP2?.(...args),
            hardDropP2: (...args) => window.hardDropP2?.(...args),
            requestMoveP2: (dir) => runGameplayCommand(() => window.moveP2?.(dir)),
            requestRotateP2: (dir) => runGameplayCommand(() => window.rotateP2?.(dir)),
            requestSoftDropP2: () => runGameplayCommand(() => window.softDropP2?.()),
            requestHardDropP2: () => runGameplayCommand(() => window.hardDropP2?.()),
            // Player 3 actions (Gamepad only)
            moveP3: (...args) => window.moveP3?.(...args),
            rotateP3: (...args) => window.rotateP3?.(...args),
            softDropP3: (...args) => window.softDropP3?.(...args),
            hardDropP3: (...args) => window.hardDropP3?.(...args),
            requestMoveP3: (dir) => runGameplayCommand(() => window.moveP3?.(dir)),
            requestRotateP3: (dir) => runGameplayCommand(() => window.rotateP3?.(dir)),
            requestSoftDropP3: () => runGameplayCommand(() => window.softDropP3?.()),
            requestHardDropP3: () => runGameplayCommand(() => window.hardDropP3?.()),
            // Player 4 actions (Gamepad only)
            moveP4: (...args) => window.moveP4?.(...args),
            rotateP4: (...args) => window.rotateP4?.(...args),
            softDropP4: (...args) => window.softDropP4?.(...args),
            hardDropP4: (...args) => window.hardDropP4?.(...args),
            requestMoveP4: (dir) => runGameplayCommand(() => window.moveP4?.(dir)),
            requestRotateP4: (dir) => runGameplayCommand(() => window.rotateP4?.(dir)),
            requestSoftDropP4: () => runGameplayCommand(() => window.softDropP4?.()),
            requestHardDropP4: () => runGameplayCommand(() => window.hardDropP4?.()),
        };

        this.flushGameplayInputQueue = () => {
            if (!this.gameplayInputQueue?.length) return;

            const queue = this.gameplayInputQueue.splice(0, this.gameplayInputQueue.length);
            queue.forEach((command) => {
                try {
                    command();
                } catch (error) {
                    console.error('[Main] Gameplay input command failed:', error);
                }
            });
        };

        setupKeyboardControls(this.inputController, this.settingsManager.get(), gameActions);

        // Setup gamepad controls
        this.gamepadController.setGameActions(gameActions);
        const settings = this.settingsManager.get();
        if (settings.gamepadEnabled) {
            this.gamepadController.enable();
        }
        if (settings.gamepadDeadzone !== undefined) {
            this.gamepadController.deadzone = settings.gamepadDeadzone;
        }
        if (settings.dasDelay !== undefined && settings.dasInterval !== undefined) {
            this.gamepadController.updateDasSettings(settings.dasDelay, settings.dasInterval);
        }

        // Listen for gamepad status changes to update UI
        window.addEventListener('gamepadStatusChanged', (e) => {
            this.updateGamepadStatusDisplay();
        });

        // Initial gamepad status update
        this.updateGamepadStatusDisplay();

        // Setup Player 2 keyboard controls
        this.setupPlayer2Controls();
    }

    /**
     * Get multiplayer state from active mode
     * @returns {Object|null} Multiplayer state
     */
    getMultiplayerState() {
        const currentMode = this.gameModeManager?.getCurrentMode();
        if (currentMode && currentMode.multiplayerState) {
            return currentMode.multiplayerState;
        }
        return this.multiplayerState; // Fallback
    }

    /**
     * Setup Player 2 keyboard controls
     */
    setupPlayer2Controls() {
        if (this.inputController) {
            console.log('[Main] Skipping legacy Player 2 keyboard controls (handled by InputController)');
            return;
        }

        document.addEventListener('keydown', (e) => {
            // Only process in local multiplayer mode
            const currentGameMode = this.gameModeUI.getMode();
            if (currentGameMode !== GAME_MODES.LOCAL_MULTIPLAYER) return;

            // Get multiplayer state from active mode
            const multiplayerState = this.getMultiplayerState();
            if (
                !multiplayerState
                || multiplayerState.isGameOver
                || multiplayerState.isPaused
            ) return;

            // Get current player 2 keybindings dynamically
            const settings = this.settingsManager.get();
            const p2Keys = settings.player2KeyBindings;
            if (!p2Keys) return;

            const key = e.key === ' ' ? 'Space' : e.key;

            // Player 2 controls
            if (key === p2Keys.moveLeft) {
                e.preventDefault();
                window.moveP2(-1);
            } else if (key === p2Keys.moveRight) {
                e.preventDefault();
                window.moveP2(1);
            } else if (key === p2Keys.rotateRight) {
                e.preventDefault();
                window.rotateP2('right');
            } else if (key === p2Keys.rotateLeft) {
                e.preventDefault();
                window.rotateP2('left');
            } else if (key === p2Keys.flip) {
                e.preventDefault();
                window.rotateP2('flip');
            } else if (key === p2Keys.softDrop) {
                e.preventDefault();
                window.softDropP2();
            } else if (key === p2Keys.hardDrop) {
                e.preventDefault();
                window.hardDropP2();
            }
        });
    }

    /**
     * Update gamepad status display in settings UI
     */
    updateGamepadStatusDisplay() {
        const status = this.gamepadController.getConnectionStatus();
        const controllerStatuses = [
            {
                element: document.getElementById('controller-1-status'),
                summary: status.controller1,
            },
            {
                element: document.getElementById('controller-2-status'),
                summary: status.controller2,
            },
            {
                element: document.getElementById('controller-3-status'),
                summary: status.controller3,
            },
            {
                element: document.getElementById('controller-4-status'),
                summary: status.controller4,
            },
        ];

        const accentColors = ['#38bdf8', '#a78bfa', '#fbbf24', '#f472b6'];

        controllerStatuses.forEach((entry, index) => {
            const { element, summary } = entry;
            if (!element || !summary) return;

            const connected = Boolean(summary.connected);
            element.textContent = connected
                ? `Controller ${index + 1}: ${summary.name ?? 'Connected'}`
                : `Controller ${index + 1}: Not connected`;
            element.style.color = connected ? accentColors[index] : 'rgba(224, 231, 255, 0.5)';

            const statusDot = document.querySelector(`.controls-status-dot[data-controller-status="${index + 1}"]`);
            if (statusDot) {
                statusDot.classList.toggle('connected', connected);
            }
        });
    }

    /**
     * Handle window resize
     */
    handleResize() {
        // Use fixed block size (40) as elsewhere
        setBlockSize(40);

        // Update legacy canvas if it exists (for fallback rendering)
        if (this.canvas) {
            this.canvas.width = COLS * BLOCK_SIZE;
            this.canvas.height = ROWS * BLOCK_SIZE;
            generateGridCache(this.canvas);
        }

        if (this.themeManager) {
            this.themeManager.resize(window.innerWidth, window.innerHeight);
        }

        // Forward resize to GameModeManager so multiplayer boards scale correctly
        if (this.gameModeManager) {
            this.gameModeManager.handleResize();
        }

        // Redraw using legacy canvas fallback if available
        if (this.gameState && this.canvas && this.ctx) {
            draw(this.canvas, this.ctx, this.gameState);
        }
    }

    /**
     * Handle settings changes
     */
    handleSettingsChange(changes) {
        const settings = this.settingsManager.get();

        // Update global settings reference
        window.settings = settings;

        // Handle theme mode changes
        if (changes.backgroundMode || changes.backgroundTheme) {
            if (settings.backgroundMode === 'Specific') {
                this.themeManager.switchTheme(settings.backgroundTheme);
                this.themeManager.stopRandomThemeInterval();
            } else if (settings.backgroundMode === 'Random') {
                this.themeManager.startRandomThemeInterval(settings.randomThemeInterval / 60);
            }
        }

        if (changes.randomThemeInterval !== undefined && settings.backgroundMode === 'Random') {
            this.themeManager.startRandomThemeInterval(settings.randomThemeInterval / 60);
        }

        if (changes.effectQuality) {
            this.applyEffectQuality(settings.effectQuality);
        }

        // Handle audio changes
        if (changes.musicVolume !== undefined) {
            this.soundManager.setMusicVolume(settings.musicVolume);
        }
        if (changes.sfxVolume !== undefined) {
            this.soundManager.setSFXVolume(settings.sfxVolume);
        }
        if (changes.musicTrack) {
            this.soundManager.setTrack(settings.musicTrack);
        }
        if (changes.soundSet) {
            this.soundManager.sfxPlayer.setSoundSet(settings.soundSet);
        }

        if (changes.pieceLockRippleColor) {
            setPieceLockRippleCss(settings.pieceLockRippleColor);
        }

        // Handle gamepad binding changes
        if (
            changes.gamepadBindings
            || changes.player2GamepadBindings
            || changes.player3GamepadBindings
            || changes.player4GamepadBindings
        ) {
            this.gamepadController.updateBindings(
                settings.gamepadBindings,
                settings.player2GamepadBindings,
                settings.player3GamepadBindings,
                settings.player4GamepadBindings,
            );
        }
    }

    /**
     * Switch to a random theme
     */
    async switchToRandomTheme() {
        const newTheme = this.themeManager.getRandomTheme();
        await this.themeManager.switchTheme(newTheme);

        // Update settings if in specific mode
        const settings = this.settingsManager.get();
        if (settings.backgroundMode === 'Specific') {
            settings.backgroundTheme = newTheme;
            this.settingsManager.save();
            // Update dropdown
            const themeSelect = document.getElementById('background-theme');
            if (themeSelect) {
                themeSelect.value = newTheme;
            }
        }
    }

    /**
     * Start a new game
     */
    async startGame() {
        if (!this.isInitialized) {
            console.error('Application not initialized');
            return;
        }

        this.gameplayInputQueue = [];
        this.inputController?.clearTimers?.();
        this.gamepadController?.clearAllDasTimers?.();

        // Hide modals
        this.modalManager.hideAll();

        // Resume audio context without emitting a synthetic click sound.
        this.soundManager?.resumeAudioContext?.();
        this.soundManager?.startBackgroundMusic?.({
            reason: 'start-game-bootstrap',
        });

        // Check game mode
        const currentMode = this.gameModeUI.getMode();

        // Use GameModeManager for all game modes
        try {
            const activeMode = this.gameModeManager.getCurrentMode();

            // Special handling for demo playback:
            // If user presses Space/Enter (Restart) during demo playback game over,
            // we want to return to demo browser, not start a new game.
            if (activeMode && activeMode.getModeId() === 'single' && activeMode.isPlayingDemo) {
                console.log('[Main] In demo playback mode, showing demo browser instead of starting new game');
                // Navigate to demo browser (with Start screen under)
                this.modalManager.show('start');
                if (this.demoBrowser) {
                    this.demoBrowser.show();
                }
                return;
            }

            // If a mode is already running, stop it first
            if (activeMode?.isRunning) {
                console.log('[Main] Stopping active game before restart');
                await this.gameModeManager.stopCurrentMode();
            }

            // Activate and start the selected mode
            await this.gameModeManager.activateMode(currentMode);
            await this.gameModeManager.startCurrentMode();
            if (this.soundManager?.ensureTrackPlaybackSynced) {
                await this.soundManager.ensureTrackPlaybackSynced({
                    reason: 'start-game',
                    force: true,
                });
            }

            console.log(`[Main] Started game mode: ${currentMode}`);
        } catch (error) {
            console.error('[Main] Failed to start game:', error);

            // Fallback to legacy mode for multiplayer (not yet migrated)
            if (currentMode === GAME_MODES.MULTIPLAYER || currentMode === GAME_MODES.LOCAL_MULTIPLAYER) {
                console.warn('[Main] Falling back to legacy multiplayer mode');
                if (currentMode === GAME_MODES.MULTIPLAYER) {
                    this.startMultiplayerGame();
                } else {
                    this.startSinglePlayerGame();
                }
            }
        }
    }

    /**
     * Start single player game
     */
    startSinglePlayerGame() {
        this.deactivatePhaserMultiplayerUI();
        this.teardownMultiplayerBoardScenes();

        // Ensure Phaser canvas is in single-player container
        this.movePhaserGameToContainer('phaser-game-container');

        // Ensure single-player dimensions
        const singleBoardWidth = COLS * BLOCK_SIZE;
        const singleBoardHeight = ROWS * BLOCK_SIZE;
        this.resizePhaserGame(singleBoardWidth, singleBoardHeight);

        this.resumeSinglePlayerScene();
        this.applyEffectQuality(this.currentEffectQuality);

        // Reset game state
        this.gameState.reset();

        // Fill the piece bag
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
            () => {
                // Draw next pieces callback
                this.refreshNextQueue();
            },
            () => {
                // Game over callback
                this.endGame();
            },
        );

        // Draw initial next pieces display
        this.refreshNextQueue();
        this.updatePhaserStats();

        // Start game loop
        this.gameLoop(this.gameState.lastTime);

        console.log('🎮 Single player game started!');
    }

    /**
     * Start multiplayer game
     */
    async startMultiplayerGame() {
        console.log('[Multiplayer] Starting multiplayer game...');
        const singleBoardWidth = COLS * BLOCK_SIZE;
        const boardGap = Math.round(singleBoardWidth * 0.3);
        this.multiplayerBoardGap = boardGap;
        const multiBoardWidth = singleBoardWidth * 2 + boardGap;
        const multiBoardHeight = ROWS * BLOCK_SIZE;

        // Move Phaser canvas to multiplayer container
        this.movePhaserGameToContainer('phaser-multiplayer-container');

        this.resizePhaserGame(multiBoardWidth, multiBoardHeight, true); // Disable auto-center for multiplayer
        console.log('[Multiplayer] Resizing Phaser game to:', multiBoardWidth, multiBoardHeight);

        // Initialize multiplayer state if needed
        if (!this.multiplayerState) {
            this.multiplayerState = new MultiplayerGameState();
        }

        this.pauseSinglePlayerScene();
        this.activatePhaserMultiplayerUI();
        console.log('[Multiplayer] Activating multiplayer UI...');

        // Reset multiplayer state
        this.multiplayerState.reset();
        this.multiplayerState.isPaused = true;

        // Wait for multiplayer board scenes to be fully created
        console.log('[Multiplayer] Ensuring multiplayer board scenes...');
        try {
            await this.ensureMultiplayerBoardScenes();
            console.log('[Multiplayer] Board scenes ready:', this.multiplayerBoardScenes);
        } catch (error) {
            console.error('[Multiplayer] Failed to create board scenes:', error);
            return;
        }

        // Ensure both players share the exact same random sequence for fairness
        const sharedSeed = Math.floor(Math.random() * 1000000) || 1;
        this.multiplayerState.sharedPieceSeed = sharedSeed;
        this.multiplayerState.player1.randomGenerator = seededRandom(sharedSeed);
        this.multiplayerState.player2.randomGenerator = seededRandom(sharedSeed);
        console.log(`[Multiplayer] Shared tetromino seed: ${sharedSeed}`);

        // Fill piece bags for both players
        fillBag(
            this.multiplayerState.player1.nextPieces,
            this.multiplayerState.player1.randomGenerator,
        );
        fillBag(
            this.multiplayerState.player2.nextPieces,
            this.multiplayerState.player2.randomGenerator,
        );

        // Draw initial next pieces preview (before countdown)
        drawNextPieces(this.p1NextCanvases, this.multiplayerState.player1.nextPieces);
        drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);

        // Update stats display to reflect reset state
        this.updateMultiplayerStats();

        // Show countdown before the match begins
        await this.showMultiplayerCountdown();

        // Spawn first pieces for both players after countdown completes
        this.multiplayerState.lastTime = performance.now();

        spawnPiece(
            this.multiplayerState.player1,
            () => {
                drawNextPieces(this.p1NextCanvases, this.multiplayerState.player1.nextPieces);
                this.syncMultiplayerBoardScenes();
            },
            () => {
                this.endMultiplayerGame(1); // Player 1 lost
            },
        );

        spawnPiece(
            this.multiplayerState.player2,
            () => {
                drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);
                this.syncMultiplayerBoardScenes();
            },
            () => {
                this.endMultiplayerGame(2); // Player 2 lost
            },
        );

        this.syncMultiplayerBoardScenes();

        // Start multiplayer game loop
        this.multiplayerState.isPaused = false;
        this.multiplayerState.lastTime = performance.now();
        this.multiplayerGameLoop(this.multiplayerState.lastTime);

        console.log('🎮 Multiplayer game started!');
    }

    /**
     * Display a quick countdown overlay before multiplayer rounds begin
     * @returns {Promise<void>} Resolves when countdown completes
     */
    async showMultiplayerCountdown() {
        const element = document.getElementById('multiplayer-countdown');
        if (!element) return;

        const sequence = ['3', '2', '1', 'START'];
        const tickDuration = 750;
        const finalDuration = 900;

        element.setAttribute('aria-hidden', 'false');
        element.classList.add('active');

        for (let i = 0; i < sequence.length; i++) {
            element.textContent = sequence[i];

            element.classList.remove('countdown-pulse');
            // Force reflow to restart animation
            void element.offsetWidth;
            element.classList.add('countdown-pulse');

            await new Promise((resolve) => setTimeout(resolve, i === sequence.length - 1 ? finalDuration : tickDuration));
        }

        element.classList.remove('countdown-pulse', 'active');
        element.textContent = '';
        element.setAttribute('aria-hidden', 'true');
    }

    /**
     * Toggle pause state
     */
    togglePause() {
        if (this.gameState.isGameOver) return;

        // If we're on the start modal, open settings
        if (this.modalManager.isVisible('start')) {
            console.log('[Main] Start modal visible, opening settings');
            this.pauseGame();
            return;
        }

        const currentMode = this.gameModeManager?.getCurrentMode();

        if (currentMode && currentMode.isRunning) {
            if (currentMode.isPaused) {
                this.resumeGame();
            } else {
                this.pauseGame();
            }
            return;
        }

        if (this.gameState.isPaused) {
            this.resumeGame();
        } else {
            this.pauseGame();
        }
    }

    /**
     * Pause the game without opening settings modal (used by Serenity Hub)
     */
    pauseGameOnly() {
        console.log('[Main] Pausing game only (no settings modal)');
        this.gameplayInputQueue = [];
        this.inputController?.clearTimers?.();
        this.gamepadController?.clearAllDasTimers?.();

        // Check if GameModeManager has a running mode
        if (this.gameModeManager && this.gameModeManager.getCurrentMode()?.isRunning) {
            this.gameModeManager.pauseCurrentMode();
            return;
        }

        // Fallback to old game state for classic modes
        if (!this.gameState.isGameOver && !this.gameState.isPaused) {
            this.gameState.isPaused = true;
        }
    }

    /**
     * Play a demo by its ID (used by high scores modal)
     * @param {number} demoId - The demo ID to play
     */
    async _playDemoById(demoId) {
        try {
            const demo = await this.demoManager.loadDemo(demoId);
            if (!demo) {
                console.error('[Main] Demo not found:', demoId);
                return;
            }

            // Close all modals
            this.modalManager.hideAll();

            // Switch to single player mode and start playback
            await this.gameModeManager.activateMode('single');
            await this.gameModeManager.startCurrentMode({ demo });
        } catch (err) {
            console.error('[Main] Failed to play demo:', err);
        }
    }

    /**
     * Return to main menu (exit current mode and show start screen)
     */
    async _returnToMainMenu() {
        console.log('[Main] Returning to main menu');

        try {
            // Stop and deactivate current game mode if active
            const currentMode = this.gameModeManager.getCurrentMode();
            if (currentMode) {
                console.log('[Main] Deactivating current mode:', currentMode.getModeId());
                await this.gameModeManager.stopCurrentMode();
                await this.gameModeManager.deactivateCurrentMode();
            }

            // Hide UI containers explicitly (safeguard)
            const singlePlayerContainer = document.getElementById('single-player-container');
            if (singlePlayerContainer) singlePlayerContainer.style.display = 'none';

            const multiplayerContainer = document.getElementById('multiplayer-container');
            if (multiplayerContainer) multiplayerContainer.style.display = 'none';

            const statsBar = document.querySelector('.single-player-stats-bar');
            if (statsBar) statsBar.style.display = 'none';

            // Hide performance overlay (if active)
            if (performanceMonitor) {
                performanceMonitor.hidePerformanceOverlay();
            }

            // Hide lingering demo indicator
            const demoIndicator = document.getElementById('demo-indicator');
            if (demoIndicator) {
                demoIndicator.classList.remove('visible');
            }

            // Show intro animation background
            // Use the top-level import 'introAnimation' instead of dynamic import if possible,
            // or stick to dynamic if main.js structure requires it.
            // Step 448 shows 'import { introAnimation } from ./ui/intro-animation.js' at line 80.
            // So we can use it directly.
            if (introAnimation) {
                await introAnimation.showBackgroundOnly(this.soundManager);
                await introAnimation.waitForMenuBgReady?.(1500);
            }

            // Show start modal
            this.modalManager.hideAll();
            this.modalManager.show('start');
        } catch (err) {
            console.error('[Main] Error returning to main menu:', err);
            // Fallback
            this.modalManager.show('start');
        }
    }

    /**
     * Pause the game
     */
    pauseGame() {
        this.gameplayInputQueue = [];
        this.inputController?.clearTimers?.();
        this.gamepadController?.clearAllDasTimers?.();

        // Check if settings modal is already open to avoid double-show
        if (this.modalManager.isVisible('settings')) {
            console.log('[Main] Settings already open, just pausing game');
            // Just pause the game without showing modal again
            if (this.gameModeManager && this.gameModeManager.getCurrentMode()?.isRunning) {
                this.gameModeManager.pauseCurrentMode();
                return;
            }
            if (!this.gameState.isPaused) {
                this.gameState.isPaused = true;
            }
            return;
        }

        // If we're on the start modal, just open settings without changing game state
        if (this.modalManager.isVisible('start')) {
            console.log('[Main] Opening settings from start modal');
            this.modalManager.show('settings');
            return;
        }

        // Check if GameModeManager has a running mode (Serenity, etc.)
        if (this.gameModeManager && this.gameModeManager.getCurrentMode()?.isRunning) {
            const currentMode = this.gameModeManager.getCurrentMode();

            // In Infinity Mode, check if we're in exploration mode (minimap drag)
            // If so, ignore P key since the game is already paused during exploration
            if (currentMode.getModeId && currentMode.getModeId() === 'infinity') {
                if (currentMode.isInExplorationMode) {
                    console.log('[Main] Infinity Mode in exploration mode - P key ignored');
                    return;
                }
            }

            // Pause and show settings modal (same behavior for all modes)
            this.gameModeManager.pauseCurrentMode();
            this.modalManager.show('settings');
            return;
        }

        // Fallback to old game state for classic modes
        if (this.gameState.isGameOver || this.gameState.isPaused) return;

        this.gameState.isPaused = true;
        this.modalManager.show('settings');
    }

    /**
     * Open settings menu (used by Escape key)
     */
    openSettingsMenu() {
        if (this.gameState.isGameOver) return;

        this.gameplayInputQueue = [];
        this.inputController?.clearTimers?.();
        this.gamepadController?.clearAllDasTimers?.();

        // Pause the game if not already paused
        if (this.gameModeManager && this.gameModeManager.getCurrentMode()?.isRunning) {
            const currentMode = this.gameModeManager.getCurrentMode();

            // In Infinity Mode, check if we're in exploration mode
            // If so, end exploration and open settings
            if (currentMode.getModeId && currentMode.getModeId() === 'infinity') {
                if (currentMode.isInExplorationMode) {
                    // End exploration (game will stay paused)
                    currentMode.isInExplorationMode = false;
                    if (currentMode.minimap) {
                        currentMode.minimap.isExploring = false;
                        currentMode.minimap.isDragging = false;
                        currentMode.minimap.onUnpause();
                    }
                    if (currentMode.boardScene) {
                        currentMode.boardScene.disableManualCameraControl();
                    }
                    console.log('[Main] Ending exploration mode and opening settings');
                }
            }

            if (!currentMode.isPaused) {
                this.gameModeManager.pauseCurrentMode();
            }
        } else if (!this.gameState.isPaused) {
            this.gameState.isPaused = true;
        }

        // Always show settings modal
        this.modalManager.show('settings');
        console.log('[Main] Settings menu opened');
    }

    /**
     * Resume the game
     */
    resumeGame() {
        // Check if settings modal is still open - don't resume if it is
        if (this.modalManager.isVisible('settings')) {
            console.log('[Main] Settings still open, not resuming yet');
            return;
        }

        // If start modal is visible, we're in the initial menu - don't resume game
        if (this.modalManager.isVisible('start')) {
            console.log('[Main] Start modal visible, not resuming game');
            return;
        }

        // Check if GameModeManager has a paused mode (Serenity, etc.)
        if (this.gameModeManager && this.gameModeManager.getCurrentMode()?.isPaused) {
            this.gameModeManager.resumeCurrentMode();
            this.modalManager.hideAll();
            return;
        }

        // Fallback to old game state for classic modes
        if (this.gameState.isGameOver || !this.gameState.isPaused) return;

        this.gameState.isPaused = false;
        this.gameplayInputQueue = [];
        this.inputController?.clearTimers?.();
        this.gamepadController?.clearAllDasTimers?.();
        this.modalManager.hideAll();
        this.lastTime = performance.now();
    }

    /**
     * Main game loop
     */
    gameLoop(currentTime) {
        // Update FPS counter
        this.updateFPSCounter(currentTime);

        if (!this.gameState.isPaused && !this.gameState.isGameOver) {
            this.inputController?.update(currentTime);
            this.gamepadController?.advanceGameplayInput(currentTime);
            this.flushGameplayInputQueue?.();
        }

        // Sync game state to Phaser scene
        if (this.boardScene) {
            this.boardScene.syncFromGameState(this.gameState);
        }

        // Use the core game loop
        coreGameLoop(
            currentTime,
            this.gameState,
            () => {
                // Draw callback - now handled by Phaser scene
                // Keep fallback to canvas for compatibility
                if (!this.boardScene && this.canvas && this.ctx) {
                    draw(this.canvas, this.ctx, this.gameState);
                }
            },
            () => {
                // Update stats callback
                updateStats(this.gameState);
                this.updatePhaserStats();

                // Check for level-based theme changes
                const settings = this.settingsManager.get();
                if (settings.backgroundMode === 'Level') {
                    const levelTheme = this.themeManager.getThemeForLevel(this.gameState.level);
                    if (levelTheme !== this.themeManager.activeThemeName) {
                        this.themeManager.switchTheme(levelTheme);
                    }
                }
            },
            () => this.soundManager.sfxPlayer.playDrop(),
            this.getPhysicsCallbacks(),
        );
    }

    /**
     * Multiplayer game loop
     */
    multiplayerGameLoop(currentTime) {
        // Update FPS counter
        this.updateFPSCounter(currentTime);

        if (this.multiplayerState.isGameOver) return;

        if (!this.multiplayerState.isPaused) {
            this.inputController?.update(currentTime);
            this.gamepadController?.advanceGameplayInput(currentTime);
            this.flushGameplayInputQueue?.();
        }

        if (this.multiplayerState.isPaused) {
            this.multiplayerState.animationId = requestAnimationFrame((t) => this.multiplayerGameLoop(t));
            return;
        }

        const delta = currentTime - this.multiplayerState.lastTime;
        this.multiplayerState.lastTime = currentTime;

        // Update both players
        [1, 2].forEach((playerNum) => {
            const playerState = playerNum === 1 ? this.multiplayerState.player1 : this.multiplayerState.player2;

            coreProcessAutoDrop(
                playerState,
                delta,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getMultiplayerPhysicsCallbacks(playerNum),
            );
        });

        this.syncMultiplayerBoardScenes();

        this.multiplayerState.animationId = requestAnimationFrame((t) => this.multiplayerGameLoop(t));
    }

    /**
     * Update multiplayer stats display
     */
    updateMultiplayerStats() {
        // Player 1 stats
        document.getElementById('p1-score').textContent = this.multiplayerState.player1.score;
        document.getElementById('p1-lines').textContent = this.multiplayerState.player1.lines;
        document.getElementById('p1-level').textContent = this.multiplayerState.player1.level;
        document.getElementById('p1-garbage').textContent = this.multiplayerState
            .getGarbageQueue(1)
            .getTotalLines();

        // Player 2 stats
        document.getElementById('p2-score').textContent = this.multiplayerState.player2.score;
        document.getElementById('p2-lines').textContent = this.multiplayerState.player2.lines;
        document.getElementById('p2-level').textContent = this.multiplayerState.player2.level;
        document.getElementById('p2-garbage').textContent = this.multiplayerState
            .getGarbageQueue(2)
            .getTotalLines();
    }

    /**
     * Get physics callbacks for multiplayer (with garbage system)
     */
    getMultiplayerPhysicsCallbacks(playerNum) {
        // Get multiplayerState from the active mode
        const currentMode = this.gameModeManager?.getCurrentMode();
        const multiplayerState = currentMode?.multiplayerState || this.multiplayerState;

        if (!multiplayerState) {
            console.error('[Main] getMultiplayerPhysicsCallbacks called but no multiplayerState available');
            return this.getPhysicsCallbacks(); // Fallback to single player callbacks
        }

        // Support both old structure (player1/player2) and new structure (players array)
        const playerState = multiplayerState.players
            ? multiplayerState.players[playerNum - 1] // New array-based structure
            : (playerNum === 1 ? multiplayerState.player1 : multiplayerState.player2); // Old structure
        const sceneRef = () => {
            // Get board scenes from the current mode or fallback to main.js
            const boardScenes = currentMode?.boardScenes || this.multiplayerBoardScenes;
            return boardScenes[playerNum - 1];
        };

        const callbacks = {
            draw: () => {
                // Sync board scenes from the active mode
                if (currentMode?._syncBoardScenes) {
                    currentMode._syncBoardScenes();
                }
            },
            onLevelUp: (level) => {
                if (currentMode?._syncBoardScenes) {
                    currentMode._syncBoardScenes();
                }
            },
            onScoreAdd: (points) => {
                if (currentMode?._syncBoardScenes) {
                    currentMode._syncBoardScenes();
                }
            },
            onLineClear: (count, holeColumns, rowMasks = []) => {
                const holes = Array.isArray(holeColumns) ? holeColumns : [];
                const maskSummary = rowMasks
                    .map((mask, index) => `#${index + 1}[${mask.join(', ')}]`)
                    .join(' ');
                console.log(
                    `[Multiplayer] Player ${playerNum} cascade wave cleared ${count} line(s) → holes [${holes.join(', ')}] ${maskSummary ? `masks ${maskSummary}` : ''}`,
                );

                // Emit event for theme reactions
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: count, player: playerNum });
            },
            onGarbageReady: (summary) => {
                // Convert playerNum to appropriate format based on multiplayerState structure
                const playerIdentifier = multiplayerState.players
                    ? playerNum - 1 // New structure uses 0-based index
                    : playerNum; // Old structure uses 1-based player number

                multiplayerState.handleGarbageSummary(
                    playerIdentifier,
                    summary,
                    (player, garbageAmount) => {
                        if (garbageAmount > 0) {
                            this.soundManager.sfxPlayer.playGarbageSend();
                            console.log(
                                `[Garbage] Player ${player} CASCADE attack ready: ${garbageAmount} line(s), depth=${summary.totalLines}, combo=${summary.comboStages}, clean=${summary.cleanField}`,
                            );
                        }
                    },
                );
            },
            updateBoard: (boardData) => {
                // Board updates handled in draw
            },
            playLineClear: () => this.soundManager.sfxPlayer.playLineClear(),
            playLevelUp: () => this.soundManager.sfxPlayer.playLevelUp(),
            onHardDrop: (dropData) => {
                this.soundManager.sfxPlayer.playDrop();
                const scene = sceneRef();
                console.log(`[Main] onHardDrop for player ${playerNum}, scene exists: ${!!scene}, playHardDropEffect exists: ${!!scene?.playHardDropEffect}`, dropData);
                if (scene?.playHardDropEffect) {
                    scene.playHardDropEffect(dropData);
                }
            },
            triggerFlash: (clearedRows) => {
                const settings = this.settingsManager.get();
                const scene = sceneRef();
                console.log(`[Multiplayer] Player ${playerNum} triggerFlash called for rows:`, clearedRows, 'scene:', !!scene);
                if (settings.lineClearEffects && scene?.triggerLineClearFlash) {
                    scene.triggerLineClearFlash(clearedRows);
                }
            },
            triggerBackgroundPulse: (lineCount) => {
                // Optional: could add background pulse per player
            },
            onLineClearImpact: (lineCount) => {
                const settings = this.settingsManager.get();
                console.log(`[Multiplayer] Player ${playerNum} onLineClearImpact called for ${lineCount} lines, effects enabled:`, settings.lineClearEffects);
                if (settings.lineClearEffects) {
                    const scene = sceneRef();
                    if (scene?.playLineClearImpact) {
                        scene.playLineClearImpact(lineCount);
                    }
                }

                // Trigger BoardJuice (pulse) for the player
                if (currentMode && playerNum) {
                    const juice = currentMode[`boardJuiceP${playerNum}`];
                    if (juice && !juice.disabled) {
                        const intensity = 1 + (Math.min(lineCount, 4) * 0.004);
                        juice.pulse(intensity);
                    }
                }
            },
            triggerCombo: (comboCount) => {
                const settings = this.settingsManager.get();
                if (settings.comboPopupEffect) {
                    const scene = sceneRef();
                    if (scene?.showComboPopup) {
                        scene.showComboPopup(comboCount);
                    }
                }

                // Emit event for theme reactions
                eventBus.emit(EVENTS.COMBO, { comboCount, player: playerNum });
            },
            onPieceLock: (piece) => {
                const settings = this.settingsManager.get();
                const scene = sceneRef();
                if (settings.pieceLockRipple && scene?.createPieceLockRipple) {
                    scene.createPieceLockRipple(piece);
                }

                // Trigger BoardJuice (dip + bounce/pulse) for the player
                if (currentMode && playerNum) {
                    const juice = currentMode[`boardJuiceP${playerNum}`];
                    if (juice && !juice.disabled) {
                        juice.dip(1);
                        juice.pulse(1.005);
                    }
                }

                // Emit event for theme reactions
                eventBus.emit(EVENTS.PIECE_LOCK, { piece, player: playerNum });
            },
            updateBackground: (level) => {
                // Background updates can be shared between players
            },
        };

        const drainGarbageEntries = (queue, drainAll) => {
            if (!queue || queue.isEmpty()) {
                return [];
            }
            if (!drainAll) {
                return queue.dequeueLineBurst();
            }

            const entries = [];
            let burst = queue.dequeueLineBurst();
            while (burst.length > 0) {
                entries.push(...burst);
                burst = queue.dequeueLineBurst();
            }
            return entries;
        };

        callbacks.spawnPiece = async () => {
            // Convert playerNum to appropriate format based on multiplayerState structure
            const playerIdentifier = multiplayerState.players
                ? playerNum - 1 // New structure uses 0-based index
                : playerNum; // Old structure uses 1-based player number

            // Insert any pending garbage before spawning next piece (Quadra-style)
            const garbageQueue = multiplayerState.getGarbageQueue(playerIdentifier);

            if (!garbageQueue.isEmpty()) {
                const queuedEntries = drainGarbageEntries(garbageQueue, !!multiplayerState.players);

                if (queuedEntries.length > 0) {
                    console.log(
                        `[Garbage] Inserting ${queuedEntries.length} garbage lines into Player ${playerNum}'s board`,
                    );

                    // Insert garbage directly into locked pieces (becomes part of board foundation)
                    const result = insertGarbageEntries(playerState.lockedPieces, queuedEntries, {
                        boardGrid: playerState.boardGrid,
                    });

                    if (result?.topOut) {
                        console.log(`[Garbage] Player ${playerNum} topped out from garbage!`);
                        this.endMultiplayerGame(playerNum);
                        return; // Don't spawn next piece
                    }

                    if (result && result.garbagePieces) {
                        // Mark board as dirty to trigger re-render
                        markBoardDirty(playerState);
                        rebuildBoardGridFromPieces(playerState.lockedPieces, playerState.boardGrid);

                        // Start animating the garbage pieces rising from bottom
                        if (result.garbagePieces.length > 0 && this.animateGarbageRise) {
                            this.animateGarbageRise(result.garbagePieces);
                        }
                    }

                    // Check if garbage caused top-out
                    // (Note: insertGarbageEntries doesn't return topOut, we check board height)
                    const topRowOccupied = playerState.lockedPieces.some((piece) => piece.y < HIDDEN_ROWS);
                    if (topRowOccupied) {
                        console.log(`[Garbage] Player ${playerNum} topped out from garbage!`);
                        this.endMultiplayerGame(playerNum);
                        return; // Don't spawn next piece
                    }
                }
            }

            // Spawn next piece
            const nextCanvases = playerNum === 1
                ? (currentMode?.p1NextCanvases || this.p1NextCanvases)
                : (currentMode?.p2NextCanvases || this.p2NextCanvases);

            spawnPiece(
                playerState,
                () => {
                    drawNextPieces(nextCanvases, playerState.nextPieces);
                    if (currentMode?._syncBoardScenes) {
                        currentMode._syncBoardScenes();
                    }
                },
                () => this.endMultiplayerGame(playerNum),
            );
        };

        return callbacks;
    }

    /**
     * End the game
     */
    async endGame(gameState = this.getActiveGameState()) {
        if (!gameState) return;

        gameState.isGameOver = true;

        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Save high score
        await this.highScoreManager.saveScore({
            score: gameState.score,
            level: gameState.level,
            lines: gameState.lines,
            timestamp: Date.now(),
        });

        // Show game over modal with stats
        await showGameOverModal(this.modalManager, gameState, this.highScoreManager);

        console.log('💀 Game over!');
    }

    /**
     * End multiplayer game
     */
    async endMultiplayerGame(losingPlayer) {
        // Get multiplayerState from the current mode or fallback to legacy
        const currentMode = this.gameModeManager?.getCurrentMode();
        const multiplayerState = currentMode?.multiplayerState || this.multiplayerState;

        if (!multiplayerState) {
            console.error('[Main] endMultiplayerGame called but no multiplayerState exists!');
            return;
        }

        if (multiplayerState.isGameOver) return;

        // New MultiPlayerState uses handlePlayerDeath with 0-based index
        // Old MultiplayerGameState uses setGameOver with 1-based playerNum
        if (multiplayerState.players && typeof multiplayerState.handlePlayerDeath === 'function') {
            // New structure: Convert 1-based losingPlayer to 0-based index
            const losingPlayerIndex = losingPlayer - 1;
            multiplayerState.handlePlayerDeath(losingPlayerIndex);

            // If using new game mode system, call its handler
            if (currentMode && typeof currentMode._handleGameOver === 'function') {
                // Call LocalMultiplayerMode's round-end handler
                await currentMode._handleGameOver(losingPlayerIndex);
                return;
            }
        } else if (typeof multiplayerState.setGameOver === 'function') {
            // Old structure
            multiplayerState.setGameOver(losingPlayer);
        }

        // Cancel animation frame
        if (multiplayerState.animationId) {
            cancelAnimationFrame(multiplayerState.animationId);
            multiplayerState.animationId = null;
        }

        const { winner } = multiplayerState;
        const winnerName = winner === 'player1' ? 'Player 1' : 'Player 2';

        console.log(`🏆 Round over! ${winnerName} wins this round!`);

        // If using new game mode system, let it handle the round end
        if (currentMode && typeof currentMode.handleRoundEnd === 'function') {
            await currentMode.handleRoundEnd(winner);
            return;
        }

        // Legacy fallback: Show game over modal with winner
        const finalStats = document.getElementById('final-stats');
        finalStats.innerHTML = `
            <div style="font-size:32px;margin-bottom:20px;color:#10b981;font-weight:bold;">
                🏆 ${winnerName} WINS! 🏆
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">
                <div style="border:2px solid rgba(0,255,255,0.5);padding:15px;border-radius:8px;">
                    <div style="font-size:20px;color:#00ffff;margin-bottom:10px;">Player 1</div>
                    <div>Score: ${multiplayerState.player1.score}</div>
                    <div>Lines: ${multiplayerState.player1.lines}</div>
                    <div>Level: ${multiplayerState.player1.level}</div>
                </div>
                <div style="border:2px solid rgba(255,0,255,0.5);padding:15px;border-radius:8px;">
                    <div style="font-size:20px;color:#ff00ff;margin-bottom:10px;">Player 2</div>
                    <div>Score: ${multiplayerState.player2.score}</div>
                    <div>Lines: ${multiplayerState.player2.lines}</div>
                    <div>Level: ${multiplayerState.player2.level}</div>
                </div>
            </div>
        `;

        this.modalManager.show('gameOver');

        console.log(`💀 Multiplayer game over! ${winnerName} wins!`);

        this.deactivatePhaserMultiplayerUI();
        this.teardownMultiplayerBoardScenes();

        // Move Phaser canvas back to single-player container
        this.movePhaserGameToContainer('phaser-game-container');

        // Resize back to single-player dimensions
        const singleBoardWidth = COLS * BLOCK_SIZE;
        const singleBoardHeight = ROWS * BLOCK_SIZE;
        this.resizePhaserGame(singleBoardWidth, singleBoardHeight);

        this.resumeSinglePlayerScene();
        this.applyEffectQuality(this.currentEffectQuality);
    }

    /**
     * Animate garbage lines rising from the bottom
     * @param {Array<Object>} garbagePieces - Array of garbage pieces to animate
     */
    animateGarbageRise(garbagePieces) {
        if (!garbagePieces || garbagePieces.length === 0) return;

        const animationDuration = 300; // 300ms total animation
        const startTime = Date.now();
        const initialOffset = garbagePieces[0].animationOffset || 0;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / animationDuration, 1.0);

            // Ease-out cubic function for smooth deceleration
            const easeOut = 1 - (1 - progress) ** 3;

            // Update offset for all garbage pieces
            garbagePieces.forEach((piece) => {
                if (piece.isAnimating) {
                    piece.animationOffset = initialOffset * (1 - easeOut);

                    // Stop animation when complete
                    if (progress >= 1.0) {
                        piece.animationOffset = 0;
                        piece.isAnimating = false;
                    }
                }
            });

            // Continue animation if not complete
            if (progress < 1.0) {
                requestAnimationFrame(animate);
            }
        };

        // Start the animation
        requestAnimationFrame(animate);
    }

    /**
     * Cleanup and destroy application
     */
    cleanup() {
        // Stop game loop
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        // Cleanup Phaser
        if (this.phaserGame) {
            this.phaserGame.destroy(true);
            this.phaserGame = null;
            this.boardScene = null;
        }

        // Cleanup managers
        if (this.themeManager) {
            this.themeManager.cleanup();
        }
        if (this.inputController) {
            this.inputController.cleanup();
        }
        if (this.soundManager) {
            this.soundManager.cleanup();
        }

        this.isInitialized = false;
        console.log('🧹 Application cleaned up');
    }
}

// =================================================================================
// Application Bootstrap
// =================================================================================

// Global app instance
let app = null;

/**
 * Initialize and start the application
 */
async function bootstrap() {
    try {
        console.log('🚀 Bootstrapping Serenity Blocks...');

        const earlyStartModal = document.getElementById('start-modal');
        if (earlyStartModal) {
            earlyStartModal.classList.remove('visible');
        }
        document.body.classList.remove('start-modal-open');

        // Initialize Steam service (non-blocking)
        steamService.initialize().then(() => {
            const status = steamService.getStatus();
            if (status.isOnline) {
                console.log(`🎮 SteamService ready: ${status.playerName} (${status.steamId})`);
            } else {
                console.log('🎮 SteamService: Running in offline mode');
            }
        }).catch(err => {
            console.warn('🎮 SteamService init error:', err.message);
        });

        // Listen for Steam connection events
        steamService.on('steam:disconnected', () => {
            console.log('⚠️ Steam disconnected - playing offline');
        });
        steamService.on('steam:reconnected', () => {
            console.log('✅ Steam reconnected');
        });

        await ensureIntroMusicIsPlaying();

        const appInitPromise = (async () => {
            const nextApp = new SerenityBlocks(sharedSoundManager);
            await nextApp.init();
            return nextApp;
        })();
        introAnimation.setLoadingPromise?.(appInitPromise, 'LOADING SYSTEMS');

        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
        const skipIntro = urlParams.get('skipIntro') === '1' || urlParams.get('wolfhourBaseline') === '1' || urlParams.get('swedishForestBaseline') === '1';

        if (skipIntro) {
            console.log('⏭️ Skipping intro animation due to URL flag...');
            if (introAnimation?.skip) {
                introAnimation.skip();
            } else if (introAnimation?.dismiss) {
                introAnimation.dismiss();
            }
        } else {
            // Show epic intro animation
            console.log('✨ Playing intro animation...');
            await introAnimation.show(sharedSoundManager);
            console.log('✨ Intro animation complete!');
        }

        app = await appInitPromise;

        // Tiny delay to allow local interaction animations (burst/shrink) to gain momentum
        // before the main thread hitch of theme loading.
        await new Promise(resolve => setTimeout(resolve, 150));

        // Load initial theme now that intro is dismissing to avoid transition hitch.
        // This hides the heavy initialization hitch behind the high-intensity animation.
        if (app?.loadInitialTheme) {
            app.loadInitialTheme().catch(err => console.error('Failed to load initial theme:', err));
        }

        await introAnimation.waitForMenuBgReady?.(2200);

        // Show the start modal only after intro transitions into menu background.
        if (app?.modalManager) {
            app.modalManager.show('start');
        } else {
            const startModal = document.getElementById('start-modal');
            if (startModal) {
                startModal.classList.add('visible');
            }
        }

        // Initialize main menu player card (shows Steam avatar/name in top-right)
        initializeMainMenuPlayerCard().catch(err => {
            console.warn('Failed to initialize main menu player card:', err.message);
        });

        // Initialize Steam invite handling (Phase 3: Friends & Social)
        const steamInviteManager = new SteamInviteManager(app.gameModeManager);

        // Enable gamepad navigation for game mode selection
        if (app.gamepadController) {
            app.gamepadController.enableGameModeSelection();
        }

        // Expose to window for debugging (can be removed in production)
        if (typeof window !== 'undefined') {
            window.serenityBlocks = app;
            window.performanceMonitor = performanceMonitor;
            window.steamService = steamService;
            window.steamInviteManager = steamInviteManager;

            console.log('💡 Steam service available: window.steamService.getStatus()');

            // Add test/debug functions
            const prepareForMatchStart = async () => {
                const startModal = document.getElementById('start-modal');
                if (startModal) {
                    startModal.classList.remove('visible');
                }
                document.body.classList.remove('start-modal-open');

                if (app.modalManager) {
                    app.modalManager.hideAll();
                }
                if (app.gamepadController?.disableMenuNavigation) {
                    app.gamepadController.disableMenuNavigation();
                }
                if (app.gamepadController?.disableGameModeSelection) {
                    app.gamepadController.disableGameModeSelection();
                }

                if (introAnimation?.dismiss) {
                    introAnimation.dismiss();
                }

                await new Promise((resolve) => setTimeout(resolve, 100));
            };

            const ensureOnlineMultiplayerMode = async () => {
                const currentMode = app.gameModeManager.getCurrentModeId();
                if (currentMode !== GAME_MODES.ONLINE_MULTIPLAYER) {
                    console.log('🧪 [TEST] Switching to online multiplayer mode...');
                    await app.gameModeManager.stopCurrentMode();
                    await app.gameModeManager.deactivateCurrentMode();
                    await prepareForMatchStart();
                    await app.gameModeManager.activateMode(GAME_MODES.ONLINE_MULTIPLAYER);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                } else {
                    await prepareForMatchStart();
                }

                const activeMode = app.gameModeManager.getCurrentMode();
                if (activeMode && !activeMode.isRunning) {
                    await app.gameModeManager.startCurrentMode();
                }

                const onlineMode = app.gameModeManager.getMode(GAME_MODES.ONLINE_MULTIPLAYER);
                if (!onlineMode) {
                    throw new Error('Online multiplayer mode not available');
                }

                return onlineMode;
            };

            const populateTestPlayers = (ffaGameState, numPlayers) => {
                const dummyNames = [
                    'TestBot_Alpha',
                    'TestBot_Beta',
                    'TestBot_Gamma',
                    'TestBot_Delta',
                    'TestBot_Epsilon',
                    'TestBot_Zeta',
                    'TestBot_Eta',
                    'TestBot_Theta',
                    'TestBot_Iota',
                ];

                for (let i = 1; i < numPlayers; i++) {
                    const dummyId = `dummy_${i}_${Date.now()}`;
                    const dummyName = dummyNames[i - 1] || `DummyPlayer_${i}`;

                    ffaGameState.addPlayer(dummyId, dummyName, false);

                    const player = ffaGameState.players.get(dummyId);
                    if (player) {
                        player.isReady = true;
                    }
                }

                const localPlayer = ffaGameState.getLocalPlayer?.();
                if (localPlayer) {
                    localPlayer.isReady = true;
                }
            };

            window.testMultiplayer = async (numPlayers = 4) => {
                try {
                    console.log(`🧪 [TEST] Creating test lobby with ${numPlayers} players...`);
                    const onlineMode = await ensureOnlineMultiplayerMode();
                    const playerCount = Math.max(2, Math.min(8, numPlayers));

                    console.log('🧪 [TEST] Creating test lobby...');
                    const config = {
                        gameName: 'TEST LOBBY',
                        maxPlayers: playerCount,
                        lobbyType: 'public',
                        endCondition: 'frags',
                        endConditionValue: 10,
                        boringRules: false,
                    };

                    await onlineMode.handleCreateLobby(config);
                    await prepareForMatchStart();

                    if (onlineMode.lobbyBrowser?.hide) {
                        onlineMode.lobbyBrowser.hide();
                    }
                    if (onlineMode.matchConfigModal?.hide) {
                        onlineMode.matchConfigModal.hide();
                    }

                    const { ffaGameState } = onlineMode;
                    if (!ffaGameState) {
                        throw new Error('Failed to create game state');
                    }

                    console.log('🧪 [TEST] Adding dummy players...');
                    populateTestPlayers(ffaGameState, playerCount);

                    if (ffaGameState.isHost) {
                        ffaGameState.broadcastPlayerList();
                    }

                    if (onlineMode.lobbyWaitingRoom?.startMatch) {
                        onlineMode.lobbyWaitingRoom.startMatch();
                    } else if (ffaGameState.startMatch) {
                        ffaGameState.startMatch();
                    }

                    console.log(`✅ [TEST] Test lobby created with ${playerCount} players!`);
                    console.log('📋 [TEST] All dummy players are auto-ready');
                    console.log('🎮 [TEST] Match starting automatically (lobby flow)');

                    return {
                        lobbyId: onlineMode.currentLobbyId,
                        players: Array.from(ffaGameState.players.values()).map((p) => ({
                            name: p.name,
                            steamId: p.steamId,
                            isReady: p.isReady,
                            color: p.color,
                        })),
                    };
                } catch (err) {
                    console.error('❌ [TEST] Failed to create test lobby:', err);
                    throw err;
                }
            };

            window.testLobby = async (numPlayers = 4) => {
                try {
                    const onlineMode = await ensureOnlineMultiplayerMode();
                    const playerCount = Math.max(2, Math.min(8, numPlayers));
                    console.log(`🧪 [TEST] Creating ready lobby with ${playerCount} players...`);

                    const config = {
                        gameName: 'READY LOBBY',
                        maxPlayers: playerCount,
                        lobbyType: 'public',
                        endCondition: 'frags',
                        endConditionValue: 10,
                        boringRules: false,
                    };

                    await onlineMode.handleCreateLobby(config);
                    await prepareForMatchStart();

                    if (onlineMode.lobbyBrowser?.hide) {
                        onlineMode.lobbyBrowser.hide();
                    }
                    if (onlineMode.matchConfigModal?.hide) {
                        onlineMode.matchConfigModal.hide();
                    }

                    const { ffaGameState } = onlineMode;
                    if (!ffaGameState) {
                        throw new Error('Failed to create game state');
                    }

                    populateTestPlayers(ffaGameState, playerCount);

                    if (ffaGameState.isHost) {
                        ffaGameState.broadcastPlayerList();
                    }

                    console.log(`✅ [TEST] Ready lobby created with ${playerCount} players.`);
                    console.log('📋 [TEST] All players are ready. Start the match from the lobby UI.');

                    return {
                        lobbyId: onlineMode.currentLobbyId,
                        players: Array.from(ffaGameState.players.values()).map((p) => ({
                            name: p.name,
                            steamId: p.steamId,
                            isReady: p.isReady,
                            color: p.color,
                        })),
                    };
                } catch (err) {
                    console.error('❌ [TEST] Failed to create ready lobby:', err);
                    throw err;
                }
            };

            window.testPostMatch = async (numPlayers = 4) => {
                try {
                    const onlineMode = await ensureOnlineMultiplayerMode();
                    if (onlineMode._ensureMatchResultsModal) {
                        onlineMode._ensureMatchResultsModal();
                    }

                    const playerCount = Math.max(2, numPlayers);
                    const now = Date.now();
                    const dummyNames = [
                        'Nova',
                        'Pulse',
                        'Vortex',
                        'Blaze',
                        'Echo',
                        'Quanta',
                        'Flux',
                        'Zenith',
                        'Comet',
                        'Rift',
                    ];

                    const finalStats = Array.from({ length: playerCount }).map((_, index) => {
                        const placement = index + 1;
                        const frags = Math.max(0, (playerCount - index) * 2);
                        return {
                            steamId: `post_${index}_${now}`,
                            name: dummyNames[index] || `Player_${index + 1}`,
                            placement,
                            frags,
                            deaths: Math.max(0, index - 1),
                            score: frags * 1000 + (playerCount - index) * 250,
                            lines: 12 + index * 3,
                            bpm: 90 + index * 6,
                            ppm: 40 + index * 4,
                            apm: 70 + index * 5,
                            color: `hsl(${(index * 45) % 360}, 70%, 55%)`,
                        };
                    });

                    const winner = finalStats[0];
                    const killFeed = finalStats.slice(1, Math.min(finalStats.length, 6)).map((entry, idx) => ({
                        killer: winner.name,
                        victim: entry.name,
                        timestamp: now - idx * 15000,
                    }));

                    const results = {
                        isGameOver: true,
                        winner: winner.steamId,
                        winnerName: winner.name,
                        endCondition: 'frags',
                        endConditionValue: 10,
                        duration: 6 * 60 * 1000 + 32000,
                        finalStats,
                        killFeed,
                    };

                    const localPlayerId = finalStats[0]?.steamId;
                    onlineMode.matchResultsModal?.show(results, {
                        isHost: true,
                        localPlayerId,
                        gameState: {
                            chatHistory: [
                                { playerName: winner.name, text: 'GGs!' },
                                { playerName: finalStats[1]?.name, text: 'Nice match.' },
                                { text: 'Match ended. Returning to lobby soon.' },
                            ],
                        },
                    });

                    console.log(`✅ [TEST] Match results shown for ${playerCount} players.`);
                    return results;
                } catch (err) {
                    console.error('❌ [TEST] Failed to show post-match modal:', err);
                    throw err;
                }
            };

            console.log('🧪 Test functions available:');
            console.log('  - window.testMultiplayer(numPlayers) - Create test lobby with dummy players');
            console.log('    Example: testMultiplayer(5)');
            console.log('  - window.testLobby(numPlayers) - Create ready lobby without auto-start');
            console.log('    Example: testLobby(8)');
            console.log('  - window.testPostMatch(numPlayers) - Show match results modal');
            console.log('    Example: testPostMatch(9)');
        }
    } catch (error) {
        console.error('❌ Failed to bootstrap application:', error);

        // Show error to user
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(239, 68, 68, 0.9); color: white; padding: 20px; border-radius: 8px; font-family: Arial, sans-serif; max-width: 500px; z-index: 10000;';
        errorDiv.innerHTML = `
            <h2 style="margin: 0 0 10px 0;">Failed to Start Game</h2>
            <p style="margin: 0;">${error.message}</p>
            <p style="margin: 10px 0 0 0; font-size: 12px; opacity: 0.8;">Check the browser console for more details.</p>
        `;
        document.body.appendChild(errorDiv);
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}

// Export for module usage
export { SerenityBlocks, bootstrap };
