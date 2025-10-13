// =================================================================================
// MAIN.JS - Application Entry Point for Serenity Blocks
// =================================================================================

/**
 * Main application entry point that coordinates all modular systems
 * Integrates: Game Core, UI, Audio, Themes, Settings, Controls, High Scores
 */

// Core imports
import {
    COLS,
    ROWS,
    HIDDEN_ROWS,
    BLOCK_SIZE,
    setBlockSize,
    DEFAULT_SETTINGS,
    GAME_MODES,
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
} from './core/game.js';
import { initPieceSystem } from './core/pieces.js';
import { MultiplayerGameState } from './core/multiplayer.js';

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

// UI imports
import {
    ModalManager,
    setupModalUI,
    showSettingsModal,
    showHighScoresModal,
    toggleFullScreen,
    closeHighScoresModal,
} from './ui/modals.js';
import { SettingsManager, initializeSettingsUI } from './ui/settings.js';
import { InputController, setupKeyboardControls, setupTouchControls } from './ui/controls.js';
import { HighScoreManager } from './ui/high-scores.js';
import { GameModeUI } from './ui/game-mode-ui.js';

// Audio imports
import { SoundManager } from './audio/sound-manager.js';

// Theme imports
import { ThemeManager } from './themes/theme-manager.js';

// Utility imports
import { initGridCache, clearThemeCaches } from './utils/cache.js';
import { seededRandom } from './utils/helpers.js';

const RIPPLE_BORDER_ALPHA = 0.8;
const RIPPLE_SHADOW_ALPHA = 0.6;

function hexToRgb(hex) {
    if (!hex) {
        return null;
    }

    let value = hex.trim();
    if (value.startsWith('#')) {
        value = value.slice(1);
    }

    if (value.length === 3) {
        value = value
            .split('')
            .map((char) => char + char)
            .join('');
    }

    if (value.length !== 6) {
        return null;
    }

    const r = parseInt(value.substring(0, 2), 16);
    const g = parseInt(value.substring(2, 4), 16);
    const b = parseInt(value.substring(4, 6), 16);

    if ([r, g, b].some((component) => Number.isNaN(component))) {
        return null;
    }

    return { r, g, b };
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
    constructor() {
        // Core systems
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
        this.soundManager = null;
        this.themeManager = null;
        this.webglRenderer = null;
        this.phaserGame = null;
        this.boardScene = null;
        this.multiplayerBoardScenes = [];
        this.gameModeUI = null;
        this.cleanupHandlers = [];
        this.currentEffectQuality = normalizeQuality(DEFAULT_SETTINGS.effectQuality);

        // Game loop
        this.lastTime = 0;
        this.animationFrameId = null;

        // Initialization flag
        this.isInitialized = false;
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

            // 6. Initialize game state
            this.gameState = new GameState();

            // 7. Setup event listeners
            this.setupEventListeners();

            // 8. Load initial theme
            await this.loadInitialTheme();

            // 9. Setup UI
            this.setupUI();

            // 10. Initialize canvas grid
            generateGridCache(this.canvas);

            // 12. Expose game controls as globals for controls.js
            this.exposeGlobalControls();

            // 13. Start background scene now that everything is ready
            this.startBackgroundScene();

            this.isInitialized = true;
            console.log('✅ Serenity Blocks initialized successfully!');

            // Show start modal
            this.modalManager.show('start');
        } catch (error) {
            console.error('Failed to initialize application:', error);
            throw error;
        }
    }

    /**
     * Initialize canvas and context
     */
    initializeCanvas() {
        // Single player canvas
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        if (!this.canvas || !this.ctx) {
            throw new Error('Failed to get canvas or context');
        }

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
        // The previous `calculateBlockSize` was unreliable.
        const calculatedBlockSize = 30;
        setBlockSize(calculatedBlockSize);

        // Set canvas dimensions to match visible playfield
        const boardWidth = COLS * BLOCK_SIZE;
        const boardHeight = ROWS * BLOCK_SIZE;
        this.canvas.width = boardWidth;
        this.canvas.height = boardHeight;

        // Ensure parent container matches canvas size for tight fit
        const phaserContainer = document.getElementById('phaser-game-container');
        if (phaserContainer) {
            phaserContainer.style.width = `${boardWidth}px`;
            phaserContainer.style.height = `${boardHeight}px`;
        }

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
            `Canvas initialized: ${this.canvas.width}x${this.canvas.height}, block size: ${BLOCK_SIZE}px`,
        );
    }

    /**
     * Calculate optimal block size based on viewport
     */

    /**
     * Initialize Phaser game instance
     */
    initializePhaserGame() {
        // Wait for Phaser to be available from CDN
        if (typeof window.Phaser === 'undefined') {
            console.warn('Phaser not loaded yet, waiting...');
            return;
        }

        const PhaserRef = window.Phaser;

        // Create scene classes once Phaser is loaded
        const BackgroundScene = createBackgroundScene(PhaserRef);
        const BoardScene = createBoardScene(PhaserRef);
        const MultiplayerBoardScene = createMultiplayerBoardScene(PhaserRef);

        const singleBoardWidth = COLS * BLOCK_SIZE;
        // Use only visible playfield for Phaser world
        const singleBoardHeight = ROWS * BLOCK_SIZE;

        this.singleBoardWidth = singleBoardWidth;
        this.phaserBaseWidth = singleBoardWidth;
        this.phaserBaseHeight = singleBoardHeight;

        const config = {
            type: PhaserRef.WEBGL,
            width: singleBoardWidth,
            height: singleBoardHeight,
            parent: 'phaser-game-container', // Parent container for Phaser canvas
            transparent: true, // Transparent to show themes behind
            audio: { noAudio: true },
            scene: [BoardScene, BackgroundScene],
            scale: {
                mode: PhaserRef.Scale.FIT,
                autoCenter: PhaserRef.Scale.CENTER_BOTH,
                width: singleBoardWidth,
                height: singleBoardHeight,
            },
            resolution: window.devicePixelRatio || 1,
            physics: {
                default: false, // We handle physics ourselves
            },
            render: {
                antialias: true,
                pixelArt: false,
            },
            callbacks: {
                postBoot: (game) => {
                    // Phaser is ready
                    this.backgroundScene = game.scene.getScene('BackgroundScene');
                    this.boardScene = game.scene.getScene('BoardScene');
                    
                    // Store the multiplayer scene class for later use
                    this.MultiplayerBoardSceneClass = MultiplayerBoardScene;
                    
                    console.log('\u2705 Phaser game initialized with BoardScene');
                    console.log('Canvas dimensions:', game.canvas.width, 'x', game.canvas.height);
                    console.log('Expected height:', ROWS * BLOCK_SIZE);
                    console.log('ROWS:', ROWS, 'HIDDEN_ROWS:', HIDDEN_ROWS);
                    console.log(
                        'Container:',
                        document.getElementById('phaser-game-container').offsetHeight,
                    );
                    document.body.classList.add('phaser-hud-ready');
                    if (this.gameState) {
                        this.updatePhaserStats();
                        this.refreshNextQueue();
                    }
                    // this.startBackgroundScene(); // Moved to end of init
                    this.applyEffectQuality(
                        this.settingsManager?.get().effectQuality ?? this.currentEffectQuality,
                    );
                },
            },
        };

        console.log('Creating Phaser game with config:', {
            width: config.width,
            height: config.height,
            parent: config.parent,
        });
        this.phaserGame = new PhaserRef.Game(config);
        console.log('Phaser game instance created:', this.phaserGame);
    }

    /**
     * Update Phaser HUD (score, level, lines).
     */
    updatePhaserStats() {
        if (this.boardScene && typeof this.boardScene.updateStats === 'function') {
            this.boardScene.updateStats(this.gameState);
        }
    }

    /**
     * Update the next piece display via Phaser, falling back to canvas previews when necessary.
     */
    refreshNextQueue() {
        if (this.boardScene && typeof this.boardScene.updateNextQueue === 'function') {
            this.boardScene.updateNextQueue(this.gameState.nextPieces);
        }
        updateNextQueue(this.gameState.nextPieces);
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
            const PhaserRef = window.Phaser;
            
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
        
        // Viewports define where on the canvas each scene renders
        // Keep them at full size - the SVG clip-path handles the border inset
        const viewports = [
            {
                x: 0,
                y: 0,
                width,
                height,
            },
            {
                x: width + gap,
                y: 0,
                width,
                height,
            },
        ];
        console.log('[Multiplayer] Calculated viewports:', viewports);
        console.log('[Multiplayer] Board width:', width, 'height:', height, 'gap:', gap);
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
            console.log('[Multiplayer] Active scenes:', 
                sceneManager.isActive('MultiplayerBoardScene1'),
                sceneManager.isActive('MultiplayerBoardScene2')
            );

            // Scenes are created synchronously, so they're already ready!
            // Just do the setup immediately
            console.log('[Multiplayer] Both scenes created successfully');
            
            // Debug: Check canvas state
            if (this.phaserGame.canvas) {
                const canvas = this.phaserGame.canvas;
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
                console.log('[Multiplayer] Scene 1 viewport:', scene1.cameras?.main?.x, scene1.cameras?.main?.y, 
                    scene1.cameras?.main?.width, scene1.cameras?.main?.height);
                console.log('[Multiplayer] Scene 2 viewport:', scene2.cameras?.main?.x, scene2.cameras?.main?.y,
                    scene2.cameras?.main?.width, scene2.cameras?.main?.height);
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

        // Settings
        this.settingsManager = new SettingsManager();
        this.settingsManager.load(); // Load from localStorage
        setPieceLockRippleCss(this.settingsManager.get().pieceLockRippleColor);

        // Modal manager
        this.modalManager = new ModalManager(this.highScoreManager, this.settingsManager);

        // Audio
        this.soundManager = new SoundManager();
        // this.soundManager.init(); // Deferred to user gesture
        await this.soundManager.initializeTracks();
        this.soundManager.startBackgroundMusic();

        const resumeAudio = () => {
            this.soundManager.resumeAudioContext();
            document.removeEventListener('click', resumeAudio);
            document.removeEventListener('keydown', resumeAudio);
        };

        document.addEventListener('click', resumeAudio);
        document.addEventListener('keydown', resumeAudio);

        // Theme manager
        this.themeManager = new ThemeManager(this.webglRenderer);

        // Set cross-references between managers
        this.soundManager.settingsManager = this.settingsManager;
        this.soundManager.themeManager = this.themeManager;

        this.cleanupHandlers.push(
            eventBus.on(EVENTS.THEME_CHANGED, ({ themeName }) => {
                const settings = this.settingsManager.get();
                if (settings.themeLinkedMode) {
                    this.soundManager.applyThemeLinkedMusic(themeName);
                }
            }),
        );

        // Input controller
        this.inputController = new InputController();

        // Game mode UI
        this.gameModeUI = new GameModeUI();

        // Set initial mode from settings
        const savedMode = this.settingsManager.get().gameMode || 'single';
        this.gameModeUI.setModeFromSettings(savedMode);

        console.log('✅ All managers initialized');

        // this.startBackgroundScene(); // Moved to end of init
        this.applyEffectQuality(this.settingsManager.get().effectQuality);
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
        const resizeHandler = () => this.handleResize();
        window.addEventListener('resize', resizeHandler);

        // Theme change events (from event bus)
        const unsubscribeThemeChanged = eventBus.on(EVENTS.THEME_CHANGED, ({ themeName }) => {
            console.log(`Theme changed to: ${themeName}`);

            // Update music if theme-linked mode is enabled
            const settings = this.settingsManager.get();
            if (settings.themeLinkedMode) {
                this.soundManager.setThemeLinkedTrack(themeName);
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

        // Global key press and tap to start game
        const handleStartInput = (e) => {
            // Don't process input until fully initialized
            if (!this.isInitialized) {
                return;
            }

            if (this.modalManager.isVisible('start') || this.modalManager.isVisible('gameOver')) {
                this.startGame();
            }
        };

        document.addEventListener('keydown', handleStartInput);
        document.addEventListener('touchstart', handleStartInput);
        document.addEventListener('click', handleStartInput);

        this.cleanupHandlers.push(() => {
            unsubscribeThemeChanged();
            document.removeEventListener('keydown', handleStartInput);
            document.removeEventListener('touchstart', handleStartInput);
            document.removeEventListener('click', handleStartInput);
            window.removeEventListener('resize', resizeHandler);
            window.removeEventListener('settingsChanged', settingsHandler);
            window.removeEventListener('gameModeChanged', gameModeHandler);
        });
    }

    /**
     * Setup UI buttons and interactions
     */
    setupUI() {
        // Setup modal UI with callbacks
        setupModalUI(this.modalManager, {
            onSettingsOpen: () => {
                this.pauseGame();
            },
            onSettingsClose: () => {
                this.resumeGame();
            },
            onHighScoresOpen: () => {
                showHighScoresModal(this.modalManager, this.highScoreManager);
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
        });

        // Initialize settings UI (includes tab switching)
        initializeSettingsUI(this.settingsManager, {
            onMusicVolumeChange: (volume) => {
                this.soundManager.setMusicVolume(volume);
            },
            onSfxVolumeChange: (volume) => {
                this.soundManager.setSFXVolume(volume);
            },
            onMusicTrackChange: (track) => {
                console.log('[Main] Music track changed to:', track);
                this.soundManager.setTrack(track);
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
            onBackgroundThemeChange: (theme) => {
                console.log('[Main] Theme changed to:', theme);
                this.themeManager.switchTheme(theme);
            },
            onGameModeChange: (mode) => {
                console.log('[Main] Game mode changed to:', mode);

                // Stop current game if running
                const wasGameActive = (this.gameState && !this.gameState.isGameOver)
                    || (this.multiplayerState && !this.multiplayerState.isGameOver);

                if (wasGameActive) {
                    // Stop the current game
                    if (this.animationFrameId) {
                        cancelAnimationFrame(this.animationFrameId);
                        this.animationFrameId = null;
                    }
                    if (this.multiplayerState && this.multiplayerState.animationId) {
                        cancelAnimationFrame(this.multiplayerState.animationId);
                        this.multiplayerState.animationId = null;
                    }

                    // Clear game states
                    this.gameState = new GameState();
                    this.multiplayerState = null;

                    console.log('[Main] Stopped current game to switch modes');
                }

                // Update UI mode
                this.gameModeUI.setModeFromSettings(mode);

                // If game was active, show start modal to begin new game
                if (wasGameActive) {
                    this.modalManager.show('start');
                    console.log('[Main] Showing start modal for new game mode');
                }
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
        return {
            draw: () => {
                if (!this.boardScene) {
                    draw(this.canvas, this.ctx, this.gameState);
                }
            },
            onLevelUp: (level) => {
                updateStats(this.gameState);
                this.updatePhaserStats();
            },
            onScoreAdd: (points) => {
                updateStats(this.gameState);
                this.updatePhaserStats();
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
                const settings = this.settingsManager.get();
                if (settings.pieceLockRipple) {
                    if (this.boardScene) {
                        this.boardScene.createPieceLockRipple(piece);
                    } else {
                        createPieceLockRipple(piece, this.gameState.lockedPieces);
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
                spawnPiece(
                    this.gameState,
                    () => this.refreshNextQueue(),
                    () => this.endGame(),
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

        // Expose game actions object
        window.gameActions = this.gameState;

        // Expose input controller
        window.inputController = this.inputController;

        // Expose game control functions
        window.move = (dir) => {
            // In multiplayer mode, control player 1
            if (this.gameModeUI.getMode() === GAME_MODES.MULTIPLAYER && this.multiplayerState) {
                coreMove(
                    this.multiplayerState.player1,
                    dir,
                    () => this.soundManager.sfxPlayer.playMove(),
                    addPieceTrail,
                );
            } else {
                coreMove(
                    this.gameState,
                    dir,
                    () => this.soundManager.sfxPlayer.playMove(),
                    addPieceTrail,
                );
            }
        };

        window.rotate = (dir) => {
            // In multiplayer mode, control player 1
            if (this.gameModeUI.getMode() === GAME_MODES.MULTIPLAYER && this.multiplayerState) {
                coreRotate(
                    this.multiplayerState.player1,
                    dir,
                    () => this.soundManager.sfxPlayer.playRotate(),
                    addPieceTrail,
                );
            } else {
                coreRotate(
                    this.gameState,
                    dir,
                    () => this.soundManager.sfxPlayer.playRotate(),
                    addPieceTrail,
                );
            }
        };

        window.softDrop = () => {
            // In multiplayer mode, control player 1
            if (this.gameModeUI.getMode() === GAME_MODES.MULTIPLAYER && this.multiplayerState) {
                coreSoftDrop(
                    this.multiplayerState.player1,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(1),
                );
            } else {
                coreSoftDrop(
                    this.gameState,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getPhysicsCallbacks(),
                );
            }
        };

        window.hardDrop = () => {
            // In multiplayer mode, control player 1
            if (this.gameModeUI.getMode() === GAME_MODES.MULTIPLAYER && this.multiplayerState) {
                coreHardDrop(
                    this.multiplayerState.player1,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(1),
                );
            } else {
                coreHardDrop(
                    this.gameState,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getPhysicsCallbacks(),
                );
            }
        };

        window.togglePause = () => {
            this.togglePause();
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
            if (this.modalManager.isVisible('highScores')) {
                closeHighScoresModal(this.modalManager);
            } else {
                showHighScoresModal(this.modalManager, this.highScoreManager);
            }
        };

        // Expose Player 2 controls for multiplayer
        window.moveP2 = (dir) => {
            if (this.multiplayerState && !this.multiplayerState.isGameOver) {
                coreMove(
                    this.multiplayerState.player2,
                    dir,
                    () => this.soundManager.sfxPlayer.playMove(),
                    addPieceTrail,
                );
            }
        };

        window.rotateP2 = (dir) => {
            if (this.multiplayerState && !this.multiplayerState.isGameOver) {
                coreRotate(
                    this.multiplayerState.player2,
                    dir,
                    () => this.soundManager.sfxPlayer.playRotate(),
                    addPieceTrail,
                );
            }
        };

        window.softDropP2 = () => {
            if (this.multiplayerState && !this.multiplayerState.isGameOver) {
                coreSoftDrop(
                    this.multiplayerState.player2,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(2),
                );
            }
        };

        window.hardDropP2 = () => {
            if (this.multiplayerState && !this.multiplayerState.isGameOver) {
                coreHardDrop(
                    this.multiplayerState.player2,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(2),
                );
            }
        };

        // Setup keyboard and touch controls with the exposed gameActions
        const gameActions = {
            move: window.move,
            rotate: window.rotate,
            softDrop: window.softDrop,
            hardDrop: window.hardDrop,
            togglePause: window.togglePause,
            startGame: window.startGame,
            initSound: window.initSound,
            nextTrack: window.nextTrack,
            randomTheme: window.randomTheme,
            toggleFullscreen: window.toggleFullscreen,
            showHighScores: window.showHighScores,
            // Player 2 actions
            moveP2: window.moveP2,
            rotateP2: window.rotateP2,
            softDropP2: window.softDropP2,
            hardDropP2: window.hardDropP2,
        };

        setupKeyboardControls(this.inputController, this.settingsManager.get(), gameActions);
        setupTouchControls(
            this.inputController,
            this.settingsManager.get(),
            gameActions,
            this.canvas,
        );

        // Setup Player 2 keyboard controls
        this.setupPlayer2Controls();
    }

    /**
     * Setup Player 2 keyboard controls
     */
    setupPlayer2Controls() {
        const settings = this.settingsManager.get();
        const p2Keys = settings.player2KeyBindings;

        document.addEventListener('keydown', (e) => {
            // Only process in multiplayer mode
            if (this.gameModeUI.getMode() !== GAME_MODES.MULTIPLAYER) return;
            if (
                !this.multiplayerState
                || this.multiplayerState.isGameOver
                || this.multiplayerState.isPaused
            ) return;

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
     * Handle window resize
     */
    handleResize() {
    // Use fixed block size (30) as elsewhere
        setBlockSize(30);

        this.canvas.width = COLS * BLOCK_SIZE;
        this.canvas.height = ROWS * BLOCK_SIZE;

        generateGridCache(this.canvas);

        if (this.themeManager) {
            this.themeManager.resize(window.innerWidth, window.innerHeight);
        }

        if (this.gameState) {
            draw(this.canvas, this.ctx, this.gameState);
        }
    }

    /**
     * Handle settings changes
     */
    handleSettingsChange(changes) {
        const settings = this.settingsManager.get();

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
    startGame() {
        if (!this.isInitialized) {
            console.error('Application not initialized');
            return;
        }

        // Hide modals
        this.modalManager.hideAll();

        // Play move sound to initialize audio context
        this.soundManager.sfxPlayer.playMove();

        // Check game mode
        const currentMode = this.gameModeUI.getMode();

        if (currentMode === GAME_MODES.MULTIPLAYER) {
            this.startMultiplayerGame();
        } else {
            this.startSinglePlayerGame();
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

        if (this.gameState.isPaused) {
            this.resumeGame();
        } else {
            this.pauseGame();
        }
    }

    /**
     * Pause the game
     */
    pauseGame() {
        if (this.gameState.isGameOver || this.gameState.isPaused) return;

        this.gameState.isPaused = true;
        this.modalManager.show('settings');
    }

    /**
     * Resume the game
     */
    resumeGame() {
        if (this.gameState.isGameOver || !this.gameState.isPaused) return;

        this.gameState.isPaused = false;
        this.modalManager.hideAll();
        this.lastTime = performance.now();
    }

    /**
     * Main game loop
     */
    gameLoop(currentTime) {
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
                if (!this.boardScene) {
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
        if (this.multiplayerState.isGameOver) return;

        if (this.multiplayerState.isPaused) {
            this.multiplayerState.animationId = requestAnimationFrame((t) => this.multiplayerGameLoop(t));
            return;
        }

        const delta = currentTime - this.multiplayerState.lastTime;
        this.multiplayerState.lastTime = currentTime;

        // Update both players
        [1, 2].forEach((playerNum) => {
            const playerState = playerNum === 1 ? this.multiplayerState.player1 : this.multiplayerState.player2;

            if (!playerState.isProcessingPhysics && playerState.currentPiece) {
                playerState.dropCounter += delta;
                if (playerState.dropCounter > playerState.dropInterval) {
                    coreSoftDrop(
                        playerState,
                        () => this.soundManager.sfxPlayer.playDrop(),
                        this.getMultiplayerPhysicsCallbacks(playerNum),
                    );
                }
            }
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
        const playerState = playerNum === 1 ? this.multiplayerState.player1 : this.multiplayerState.player2;
        const sceneRef = () => this.multiplayerBoardScenes[playerNum - 1];

        const callbacks = {
            draw: () => this.syncMultiplayerBoardScenes(),
            onLevelUp: (level) => {
                this.syncMultiplayerBoardScenes();
            },
            onScoreAdd: (points) => {
                this.syncMultiplayerBoardScenes();
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
                this.multiplayerState.handleGarbageSummary(
                    playerNum,
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
                if (!settings.lineClearEffects) return;
                const scene = sceneRef();
                if (scene?.playLineClearImpact) {
                    scene.playLineClearImpact(lineCount);
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
                
                // Emit event for theme reactions
                eventBus.emit(EVENTS.PIECE_LOCK, { piece, player: playerNum });
            },
            updateBackground: (level) => {
                // Background updates can be shared between players
            },
        };

        callbacks.spawnPiece = async () => {
            // Insert any pending garbage before spawning next piece (Quadra-style)
            const garbageQueue = this.multiplayerState.getGarbageQueue(playerNum);

            if (!garbageQueue.isEmpty()) {
                const garbageAmount = garbageQueue.getTotalLines();
                console.log(
                    `[Garbage] Inserting ${garbageAmount} garbage lines into Player ${playerNum}'s board`,
                );

                const result = this.multiplayerState.insertPendingGarbage(playerNum, {
                    animated: true,
                });

                if (result.topOut) {
                    console.log(`[Garbage] Player ${playerNum} topped out from garbage!`);
                    this.endMultiplayerGame(playerNum);
                    return; // Don't spawn next piece
                }

                // Start animating the garbage pieces rising from bottom
                if (result.garbagePieces && result.garbagePieces.length > 0) {
                    this.animateGarbageRise(result.garbagePieces);
                }

                if (result.linesAfterInsertion && result.linesAfterInsertion.length > 0) {
                    console.log(
                        `[Garbage] Player ${playerNum} filled ${result.linesAfterInsertion.length} line(s) immediately after garbage insertion`,
                    );
                    await this.multiplayerState.resolveGarbageCascade(playerNum, callbacks);

                    if (playerState.isGameOver) {
                        console.log(
                            `[Garbage] Player ${playerNum} topped out during garbage cascade resolution`,
                        );
                        this.endMultiplayerGame(playerNum);
                        return;
                    }
                }
            }

            // Spawn next piece
            const nextCanvases = playerNum === 1 ? this.p1NextCanvases : this.p2NextCanvases;
            spawnPiece(
                playerState,
                () => drawNextPieces(nextCanvases, playerState.nextPieces),
                () => this.endMultiplayerGame(playerNum),
            );
        };

        return callbacks;
    }

    /**
     * End the game
     */
    async endGame() {
        this.gameState.isGameOver = true;

        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Save high score
        await this.highScoreManager.saveScore({
            score: this.gameState.score,
            level: this.gameState.level,
            lines: this.gameState.lines,
            timestamp: Date.now(),
        });

        // Show game over modal
        this.modalManager.show('gameOver');

        console.log('💀 Game over!');
    }

    /**
     * End multiplayer game
     */
    async endMultiplayerGame(losingPlayer) {
        if (this.multiplayerState.isGameOver) return;

        this.multiplayerState.setGameOver(losingPlayer);

        // Cancel animation frame
        if (this.multiplayerState.animationId) {
            cancelAnimationFrame(this.multiplayerState.animationId);
            this.multiplayerState.animationId = null;
        }

        const { winner } = this.multiplayerState;
        const winnerName = winner === 'player1' ? 'Player 1' : 'Player 2';

        // Show game over modal with winner
        const finalStats = document.getElementById('final-stats');
        finalStats.innerHTML = `
            <div style="font-size:32px;margin-bottom:20px;color:#10b981;font-weight:bold;">
                🏆 ${winnerName} WINS! 🏆
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">
                <div style="border:2px solid rgba(0,255,255,0.5);padding:15px;border-radius:8px;">
                    <div style="font-size:20px;color:#00ffff;margin-bottom:10px;">Player 1</div>
                    <div>Score: ${this.multiplayerState.player1.score}</div>
                    <div>Lines: ${this.multiplayerState.player1.lines}</div>
                    <div>Level: ${this.multiplayerState.player1.level}</div>
                </div>
                <div style="border:2px solid rgba(255,0,255,0.5);padding:15px;border-radius:8px;">
                    <div style="font-size:20px;color:#ff00ff;margin-bottom:10px;">Player 2</div>
                    <div>Score: ${this.multiplayerState.player2.score}</div>
                    <div>Lines: ${this.multiplayerState.player2.lines}</div>
                    <div>Level: ${this.multiplayerState.player2.level}</div>
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

        app = new SerenityBlocks();
        await app.init();

        // Expose to window for debugging (can be removed in production)
        if (typeof window !== 'undefined') {
            window.serenityBlocks = app;
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
