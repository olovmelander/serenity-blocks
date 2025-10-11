// =================================================================================
// MAIN.JS - Application Entry Point for Serenity Blocks
// =================================================================================

/**
 * Main application entry point that coordinates all modular systems
 * Integrates: Game Core, UI, Audio, Themes, Settings, Controls, High Scores
 */

// Core imports
import { COLS, ROWS, BLOCK_SIZE, setBlockSize, DEFAULT_SETTINGS, GAME_MODES } from './core/constants.js';
import { GameState, gameLoop as coreGameLoop, startGame as coreStartGame, spawnPiece, fillBag, move as coreMove, rotate as coreRotate, hardDrop as coreHardDrop, softDrop as coreSoftDrop } from './core/game.js';
import { initPieceSystem } from './core/pieces.js';
import { MultiplayerGameState } from './core/multiplayer.js';

// Rendering imports
import { generateGridCache, drawBlock, drawGhostPiece } from './rendering/canvas-utils.js';
import { draw, updateStats, drawNextPieces, triggerLineClearFlash, createPieceLockRipple, triggerBackgroundPulse, addPieceTrail, showComboPopup } from './rendering/draw.js';
import { WebGLRenderer } from './rendering/renderer.js';

// UI imports
import { ModalManager, setupModalUI, showSettingsModal, showHighScoresModal, toggleFullScreen, closeHighScoresModal } from './ui/modals.js';
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
        value = value.split('').map((char) => char + char).join('');
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
    root.style.setProperty('--lock-ripple-border-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${RIPPLE_BORDER_ALPHA})`);
    root.style.setProperty('--lock-ripple-shadow-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${RIPPLE_SHADOW_ALPHA})`);
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
        this.gameModeUI = null;

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

            // 2. Initialize WebGL renderer
            const backgroundCanvas = document.getElementById('background-canvas');
            this.webglRenderer = new WebGLRenderer(backgroundCanvas);

            // 3. Initialize caches
            // Grid cache initialized when needed

            // 4. Initialize piece system
            initPieceSystem();

            // 5. Initialize managers
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

            // 11. Expose game controls as globals for controls.js
            this.exposeGlobalControls();

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
        this.nextCanvases = Array.from({length: 5}, (_, i) => document.getElementById(`next-${i}`));

        // Multiplayer canvases
        this.p1Canvas = document.getElementById('p1-canvas');
        this.p1Ctx = this.p1Canvas ? this.p1Canvas.getContext('2d') : null;
        this.p2Canvas = document.getElementById('p2-canvas');
        this.p2Ctx = this.p2Canvas ? this.p2Canvas.getContext('2d') : null;

        // Multiplayer next piece canvases
        this.p1NextCanvases = Array.from({length: 3}, (_, i) => document.getElementById(`p1-next-${i}`));
        this.p2NextCanvases = Array.from({length: 3}, (_, i) => document.getElementById(`p2-next-${i}`));

        // Calculate and set block size
        const calculatedBlockSize = this.calculateBlockSize();
        setBlockSize(calculatedBlockSize);

        // Set canvas dimensions
        this.canvas.width = COLS * BLOCK_SIZE;
        this.canvas.height = ROWS * BLOCK_SIZE;

        // Set multiplayer canvas dimensions (same size as single player)
        if (this.p1Canvas && this.p2Canvas) {
            this.p1Canvas.width = COLS * BLOCK_SIZE;
            this.p1Canvas.height = ROWS * BLOCK_SIZE;
            this.p2Canvas.width = COLS * BLOCK_SIZE;
            this.p2Canvas.height = ROWS * BLOCK_SIZE;

            console.log(`Multiplayer canvases: ${this.p1Canvas.width}x${this.p1Canvas.height}, block size: ${BLOCK_SIZE}px`);
        }

        console.log(`Canvas initialized: ${this.canvas.width}x${this.canvas.height}, block size: ${BLOCK_SIZE}px`);
    }

    /**
     * Calculate optimal block size based on viewport
     */
    calculateBlockSize() {
        const maxWidth = window.innerWidth * 0.4;
        const maxHeight = window.innerHeight * 0.8;
        const blockSizeWidth = Math.floor(maxWidth / COLS);
        const blockSizeHeight = Math.floor(maxHeight / ROWS);
        return Math.min(blockSizeWidth, blockSizeHeight, 40);
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
        this.modalManager = new ModalManager(
            this.highScoreManager,
            this.settingsManager
        );

        // Audio
        this.soundManager = new SoundManager();
        this.soundManager.init();
        await this.soundManager.initializeTracks();
        this.soundManager.startBackgroundMusic();

        // Theme manager
        this.themeManager = new ThemeManager(this.webglRenderer);

        // Set cross-references between managers
        this.soundManager.settingsManager = this.settingsManager;
        this.soundManager.themeManager = this.themeManager;

        // Input controller
        this.inputController = new InputController();

        // Game mode UI
        this.gameModeUI = new GameModeUI();

        // Set initial mode from settings
        const savedMode = this.settingsManager.get().gameMode || 'single';
        this.gameModeUI.setModeFromSettings(savedMode);

        console.log('✅ All managers initialized');
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
        window.addEventListener('resize', () => this.handleResize());

        // Theme change events
        window.addEventListener('themeChanged', (e) => {
            console.log(`Theme changed to: ${e.detail.themeName}`);

            // Update music if theme-linked mode is enabled
            const settings = this.settingsManager.get();
            if (settings.themeLinkedMode) {
                this.soundManager.setThemeLinkedTrack(e.detail.themeName);
            }
        });

        // Settings change events
        window.addEventListener('settingsChanged', (e) => {
            this.handleSettingsChange(e.detail);
        });

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
            }
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
                        this.themeManager.startRandomThemeInterval(settings.randomThemeInterval / 60);
                    }
                } else if (mode === 'Level') {
                    const levelTheme = this.themeManager.getThemeForLevel(this.gameState?.level || 1);
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
                const wasGameActive = (this.gameState && !this.gameState.isGameOver) ||
                                     (this.multiplayerState && !this.multiplayerState.isGameOver);

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
            }
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

        // Listen for theme changes to apply theme-linked music
        window.addEventListener('themeChanged', (e) => {
            console.log('[Main] Theme changed event:', e.detail.themeName);
            this.soundManager.applyThemeLinkedMusic(e.detail.themeName);
        });

        // Listen for game mode changes from UI
        window.addEventListener('gameModeChanged', (e) => {
            console.log('[Main] Game mode changed from UI:', e.detail.mode);
            this.settingsManager.update({ gameMode: e.detail.mode });
            this.settingsManager.save();
        });
    }

    /**
     * Get physics callbacks for piece locking
     */
    getPhysicsCallbacks() {
        return {
            draw: () => draw(this.canvas, this.ctx, this.gameState),
            onLevelUp: (level) => {
                updateStats(this.gameState);
            },
            onScoreAdd: (points) => {
                updateStats(this.gameState);
            },
            onLineClear: (count, holeColumns) => {
                // Visual feedback handled in draw
                // holeColumns parameter not used in single-player mode
            },
            updateBoard: (boardData) => {
                // Board updates handled in draw
            },
            playLineClear: () => this.soundManager.sfxPlayer.playLineClear(),
            playLevelUp: () => this.soundManager.sfxPlayer.playLevelUp(),
            triggerFlash: (clearedRows) => {
                const settings = this.settingsManager.get();
                if (settings.lineClearEffects) {
                    triggerLineClearFlash(clearedRows);
                }
            },
            triggerBackgroundPulse: (lineCount) => triggerBackgroundPulse(lineCount),
            triggerCombo: (comboCount) => {
                const settings = this.settingsManager.get();
                if (settings.comboPopupEffect) {
                    showComboPopup(comboCount);
                }
            },
            onPieceLock: (piece) => {
                const settings = this.settingsManager.get();
                if (settings.pieceLockRipple) {
                    createPieceLockRipple(piece, this.gameState.lockedPieces);
                }
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
                    () => drawNextPieces(this.nextCanvases, this.gameState.nextPieces),
                    () => this.endGame()
                );
            }
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
                coreMove(this.multiplayerState.player1, dir, () => this.soundManager.sfxPlayer.playMove(), addPieceTrail);
            } else {
                coreMove(this.gameState, dir, () => this.soundManager.sfxPlayer.playMove(), addPieceTrail);
            }
        };

        window.rotate = (dir) => {
            // In multiplayer mode, control player 1
            if (this.gameModeUI.getMode() === GAME_MODES.MULTIPLAYER && this.multiplayerState) {
                coreRotate(this.multiplayerState.player1, dir, () => this.soundManager.sfxPlayer.playRotate(), addPieceTrail);
            } else {
                coreRotate(this.gameState, dir, () => this.soundManager.sfxPlayer.playRotate(), addPieceTrail);
            }
        };

        window.softDrop = () => {
            // In multiplayer mode, control player 1
            if (this.gameModeUI.getMode() === GAME_MODES.MULTIPLAYER && this.multiplayerState) {
                coreSoftDrop(
                    this.multiplayerState.player1,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(1)
                );
            } else {
                coreSoftDrop(
                    this.gameState,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getPhysicsCallbacks()
                );
            }
        };

        window.hardDrop = () => {
            // In multiplayer mode, control player 1
            if (this.gameModeUI.getMode() === GAME_MODES.MULTIPLAYER && this.multiplayerState) {
                coreHardDrop(
                    this.multiplayerState.player1,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(1)
                );
            } else {
                coreHardDrop(
                    this.gameState,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getPhysicsCallbacks()
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
                coreMove(this.multiplayerState.player2, dir, () => this.soundManager.sfxPlayer.playMove(), addPieceTrail);
            }
        };

        window.rotateP2 = (dir) => {
            if (this.multiplayerState && !this.multiplayerState.isGameOver) {
                coreRotate(this.multiplayerState.player2, dir, () => this.soundManager.sfxPlayer.playRotate(), addPieceTrail);
            }
        };

        window.softDropP2 = () => {
            if (this.multiplayerState && !this.multiplayerState.isGameOver) {
                coreSoftDrop(
                    this.multiplayerState.player2,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(2)
                );
            }
        };

        window.hardDropP2 = () => {
            if (this.multiplayerState && !this.multiplayerState.isGameOver) {
                coreHardDrop(
                    this.multiplayerState.player2,
                    () => this.soundManager.sfxPlayer.playDrop(),
                    this.getMultiplayerPhysicsCallbacks(2)
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
            hardDropP2: window.hardDropP2
        };

        setupKeyboardControls(this.inputController, this.settingsManager.get(), gameActions);
        setupTouchControls(this.inputController, this.settingsManager.get(), gameActions, this.canvas);

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
            if (!this.multiplayerState || this.multiplayerState.isGameOver || this.multiplayerState.isPaused) return;

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
        const newBlockSize = this.calculateBlockSize();
        setBlockSize(newBlockSize);

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
        // Reset game state
        this.gameState.reset();

        // Fill the piece bag
        fillBag(this.gameState.nextPieces, typeof this.gameState.randomGenerator === 'function' ? this.gameState.randomGenerator : Math.random);

        // Spawn first piece
        this.gameState.lastTime = performance.now();
        spawnPiece(
            this.gameState,
            () => {
                // Draw next pieces callback
                drawNextPieces(this.nextCanvases, this.gameState.nextPieces);
            },
            () => {
                // Game over callback
                this.endGame();
            }
        );

        // Draw initial next pieces display
        drawNextPieces(this.nextCanvases, this.gameState.nextPieces);

        // Start game loop
        this.gameLoop(this.gameState.lastTime);

        console.log('🎮 Single player game started!');
    }

    /**
     * Start multiplayer game
     */
    async startMultiplayerGame() {
        // Initialize multiplayer state if needed
        if (!this.multiplayerState) {
            this.multiplayerState = new MultiplayerGameState();
        }

        // Reset multiplayer state
        this.multiplayerState.reset();
        this.multiplayerState.isPaused = true;

        // Ensure both players share the exact same random sequence for fairness
        const sharedSeed = Math.floor(Math.random() * 1000000) || 1;
        this.multiplayerState.sharedPieceSeed = sharedSeed;
        this.multiplayerState.player1.randomGenerator = seededRandom(sharedSeed);
        this.multiplayerState.player2.randomGenerator = seededRandom(sharedSeed);
        console.log(`[Multiplayer] Shared tetromino seed: ${sharedSeed}`);

        // Fill piece bags for both players
        fillBag(
            this.multiplayerState.player1.nextPieces,
            this.multiplayerState.player1.randomGenerator
        );
        fillBag(
            this.multiplayerState.player2.nextPieces,
            this.multiplayerState.player2.randomGenerator
        );

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
            },
            () => {
                this.endMultiplayerGame(1); // Player 1 lost
            }
        );

        spawnPiece(
            this.multiplayerState.player2,
            () => {
                drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);
            },
            () => {
                this.endMultiplayerGame(2); // Player 2 lost
            }
        );

        // Draw initial next pieces
        drawNextPieces(this.p1NextCanvases, this.multiplayerState.player1.nextPieces);
        drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);

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

            await new Promise(resolve =>
                setTimeout(resolve, i === sequence.length - 1 ? finalDuration : tickDuration)
            );
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
        // Use the core game loop
        coreGameLoop(
            currentTime,
            this.gameState,
            () => {
                // Draw callback
                draw(this.canvas, this.ctx, this.gameState);
            },
            () => {
                // Update stats callback
                updateStats(this.gameState);

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
            this.getPhysicsCallbacks()
        );
    }

    /**
     * Multiplayer game loop
     */
    multiplayerGameLoop(currentTime) {
        if (this.multiplayerState.isGameOver) return;

        if (this.multiplayerState.isPaused) {
            this.multiplayerState.animationId = requestAnimationFrame((t) =>
                this.multiplayerGameLoop(t)
            );
            return;
        }

        const delta = currentTime - this.multiplayerState.lastTime;
        this.multiplayerState.lastTime = currentTime;

        // Update both players
        [1, 2].forEach(playerNum => {
            const playerState = playerNum === 1 ? this.multiplayerState.player1 : this.multiplayerState.player2;

            if (!playerState.isProcessingPhysics && playerState.currentPiece) {
                playerState.dropCounter += delta;
                if (playerState.dropCounter > playerState.dropInterval) {
                    coreSoftDrop(
                        playerState,
                        () => this.soundManager.sfxPlayer.playDrop(),
                        this.getMultiplayerPhysicsCallbacks(playerNum)
                    );
                }
            }
        });

        // Draw both boards
        draw(this.p1Canvas, this.p1Ctx, this.multiplayerState.player1);
        draw(this.p2Canvas, this.p2Ctx, this.multiplayerState.player2);

        // Update stats
        this.updateMultiplayerStats();

        this.multiplayerState.animationId = requestAnimationFrame((t) =>
            this.multiplayerGameLoop(t)
        );
    }

    /**
     * Update multiplayer stats display
     */
    updateMultiplayerStats() {
        // Player 1 stats
        document.getElementById('p1-score').textContent = this.multiplayerState.player1.score;
        document.getElementById('p1-lines').textContent = this.multiplayerState.player1.lines;
        document.getElementById('p1-level').textContent = this.multiplayerState.player1.level;
        document.getElementById('p1-garbage').textContent = this.multiplayerState.getGarbageQueue(1).getTotalLines();

        // Player 2 stats
        document.getElementById('p2-score').textContent = this.multiplayerState.player2.score;
        document.getElementById('p2-lines').textContent = this.multiplayerState.player2.lines;
        document.getElementById('p2-level').textContent = this.multiplayerState.player2.level;
        document.getElementById('p2-garbage').textContent = this.multiplayerState.getGarbageQueue(2).getTotalLines();
    }

    /**
     * Get physics callbacks for multiplayer (with garbage system)
     */
    getMultiplayerPhysicsCallbacks(playerNum) {
        const playerState = playerNum === 1 ? this.multiplayerState.player1 : this.multiplayerState.player2;
        const canvas = playerNum === 1 ? this.p1Canvas : this.p2Canvas;
        const ctx = playerNum === 1 ? this.p1Ctx : this.p2Ctx;

        const callbacks = {
            draw: () => draw(canvas, ctx, playerState),
            onLevelUp: (level) => {
                this.updateMultiplayerStats();
            },
            onScoreAdd: (points) => {
                this.updateMultiplayerStats();
            },
            onLineClear: (count, holeColumns, rowMasks = []) => {
                const holes = Array.isArray(holeColumns) ? holeColumns : [];
                const maskSummary = rowMasks
                    .map((mask, index) => `#${index + 1}[${mask.join(', ')}]`)
                    .join(' ');
                console.log(`[Multiplayer] Player ${playerNum} cascade wave cleared ${count} line(s) → holes [${holes.join(', ')}] ${maskSummary ? `masks ${maskSummary}` : ''}`);
            },
            onGarbageReady: (summary) => {
                this.multiplayerState.handleGarbageSummary(playerNum, summary, (player, garbageAmount) => {
                    if (garbageAmount > 0) {
                        this.soundManager.sfxPlayer.playGarbageSend();
                        console.log(`[Garbage] Player ${player} CASCADE attack ready: ${garbageAmount} line(s), depth=${summary.totalLines}, combo=${summary.comboStages}, clean=${summary.cleanField}`);
                    }
                });
            },
            updateBoard: (boardData) => {
                // Board updates handled in draw
            },
            playLineClear: () => this.soundManager.sfxPlayer.playLineClear(),
            playLevelUp: () => this.soundManager.sfxPlayer.playLevelUp(),
            triggerFlash: (clearedRows) => {
                const settings = this.settingsManager.get();
                if (settings.lineClearEffects) {
                    const flashId = playerNum === 1 ? 'p1-line-clear-flash' : 'p2-line-clear-flash';
                    triggerLineClearFlash(clearedRows, document.getElementById(flashId));
                }
            },
            triggerBackgroundPulse: (lineCount) => {
                // Optional: could add background pulse per player
            },
            triggerCombo: (comboCount) => {
                const settings = this.settingsManager.get();
                if (settings.comboPopupEffect) {
                    const popupsId = playerNum === 1 ? 'p1-score-popups' : 'p2-score-popups';
                    showComboPopup(comboCount, document.getElementById(popupsId));
                }
            },
            onPieceLock: (piece) => {
                const settings = this.settingsManager.get();
                if (settings.pieceLockRipple) {
                    const flashId = playerNum === 1 ? 'p1-line-clear-flash' : 'p2-line-clear-flash';
                    createPieceLockRipple(piece, playerState.lockedPieces, document.getElementById(flashId));
                }
            },
            updateBackground: (level) => {
                // Background updates can be shared between players
            }
        };

        callbacks.spawnPiece = async () => {
            // Insert any pending garbage before spawning next piece (Quadra-style)
            const garbageQueue = this.multiplayerState.getGarbageQueue(playerNum);

            if (!garbageQueue.isEmpty()) {
                const garbageAmount = garbageQueue.getTotalLines();
                console.log(`[Garbage] Inserting ${garbageAmount} garbage lines into Player ${playerNum}'s board`);

                const result = this.multiplayerState.insertPendingGarbage(playerNum, { animated: true });

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
                    console.log(`[Garbage] Player ${playerNum} filled ${result.linesAfterInsertion.length} line(s) immediately after garbage insertion`);
                    await this.multiplayerState.resolveGarbageCascade(playerNum, callbacks);

                    if (playerState.isGameOver) {
                        console.log(`[Garbage] Player ${playerNum} topped out during garbage cascade resolution`);
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
                () => this.endMultiplayerGame(playerNum)
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
            timestamp: Date.now()
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

        const winner = this.multiplayerState.winner;
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
            const easeOut = 1 - Math.pow(1 - progress, 3);

            // Update offset for all garbage pieces
            garbagePieces.forEach(piece => {
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
