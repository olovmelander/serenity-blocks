// =================================================================================
// MAIN.JS - Application Entry Point for Serenity Blocks
// =================================================================================

/**
 * Main application entry point that coordinates all modular systems
 * Integrates: Game Core, UI, Audio, Themes, Settings, Controls, High Scores
 */

// Core imports
import { COLS, ROWS, BLOCK_SIZE, setBlockSize } from './core/constants.js';
import { GameState, gameLoop as coreGameLoop, startGame as coreStartGame, spawnPiece, fillBag, move as coreMove, rotate as coreRotate, hardDrop as coreHardDrop, softDrop as coreSoftDrop } from './core/game.js';
import { initPieceSystem } from './core/pieces.js';

// Rendering imports
import { generateGridCache, drawBlock, drawGhostPiece } from './rendering/canvas-utils.js';
import { draw, updateStats, drawNextPieces, triggerLineClearFlash, createPieceLockRipple, triggerBackgroundPulse, addPieceTrail, showComboPopup } from './rendering/draw.js';
import { WebGLRenderer } from './rendering/renderer.js';

// UI imports
import { ModalManager, setupModalUI, showSettingsModal, showHighScoresModal, toggleFullScreen } from './ui/modals.js';
import { SettingsManager, initializeSettingsUI } from './ui/settings.js';
import { InputController, setupKeyboardControls, setupTouchControls } from './ui/controls.js';
import { HighScoreManager } from './ui/high-scores.js';

// Audio imports
import { SoundManager } from './audio/sound-manager.js';

// Theme imports
import { ThemeManager } from './themes/theme-manager.js';

// Utility imports
import { initGridCache, clearThemeCaches } from './utils/cache.js';

/**
 * Main application class that orchestrates all systems
 */
class SerenityBlocks {
    constructor() {
        // Core systems
        this.gameState = null;
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
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        if (!this.canvas || !this.ctx) {
            throw new Error('Failed to get canvas or context');
        }

        // Initialize next piece preview canvases
        this.nextCanvases = Array.from({length: 5}, (_, i) => document.getElementById(`next-${i}`));

        // Calculate and set block size
        const calculatedBlockSize = this.calculateBlockSize();
        setBlockSize(calculatedBlockSize);

        // Set canvas dimensions
        this.canvas.width = COLS * BLOCK_SIZE;
        this.canvas.height = ROWS * BLOCK_SIZE;

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
            onLineClear: (count) => {
                // Visual feedback handled in draw
            },
            updateBoard: (boardData) => {
                // Board updates handled in draw
            },
            playLineClear: () => this.soundManager.sfxPlayer.playLineClear(),
            playLevelUp: () => this.soundManager.sfxPlayer.playLevelUp(),
            triggerFlash: (clearedRows) => triggerLineClearFlash(clearedRows),
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
            coreMove(this.gameState, dir, () => this.soundManager.sfxPlayer.playMove(), addPieceTrail);
        };

        window.rotate = (dir) => {
            coreRotate(this.gameState, dir, () => this.soundManager.sfxPlayer.playRotate(), addPieceTrail);
        };

        window.softDrop = () => {
            coreSoftDrop(
                this.gameState,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getPhysicsCallbacks()
            );
        };

        window.hardDrop = () => {
            coreHardDrop(
                this.gameState,
                () => this.soundManager.sfxPlayer.playDrop(),
                this.getPhysicsCallbacks()
            );
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

        // Setup keyboard and touch controls with the exposed gameActions
        const gameActions = {
            move: window.move,
            rotate: window.rotate,
            softDrop: window.softDrop,
            hardDrop: window.hardDrop,
            togglePause: window.togglePause,
            startGame: window.startGame,
            initSound: window.initSound
        };

        setupKeyboardControls(this.inputController, this.settingsManager.get(), gameActions);
        setupTouchControls(this.inputController, this.settingsManager.get(), gameActions, this.canvas);
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

        // Reset game state
        this.gameState.reset();

        // Play move sound to initialize audio context
        this.soundManager.sfxPlayer.playMove();

        // Fill the piece bag
        fillBag(this.gameState.nextPieces);

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

        console.log('🎮 Game started!');
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
