/**
 * @fileoverview Input Controls for Serenity Blocks (Phaser 4 Compatible)
 * Handles keyboard and touch input with DAS (Delayed Auto Shift) support
 *
 * **Architecture:** This input system uses native DOM events (keydown, touchstart, etc.)
 * and is completely decoupled from Phaser APIs. This makes it compatible with Phaser 3,
 * Phaser 4, and any other game engine or framework.
 *
 * **Benefits:**
 * - Framework-agnostic: Works with any rendering system
 * - Global input: Captures events even when focus is outside the canvas
 * - Portable: Can be reused in non-Phaser projects
 * - Testable: Easy to unit test without Phaser runtime
 *
 * **Phaser 4 Migration Status:** ✅ No changes required - already compatible
 */

import { BLOCK_SIZE } from '../core/constants.js';

/**
 * Input controller state management
 * Tracks keyboard keys, touch gestures, and input timers for DAS (Delayed Auto Shift)
 *
 * @class InputController
 */
export class InputController {
    constructor() {
        // Touch state
        this.touchStartX = null;
        this.touchStartY = null;
        this.touchStartTime = null;
        this.lastTap = 0;
        this.touchLastX = null;
        this.touchLastY = null;

        // Keyboard state
        this.keyMap = {};
        this.dasTimer = null;
        this.dasIntervalTimer = null;
        this.softDropTimer = null;

        // Sound initialization flag
        this.soundInitialized = false;

        console.log('[InputController] Initialized');
    }

    /**
     * Resets touch state
     * Call this when a touch gesture ends or is cancelled
     */
    resetTouch() {
        this.touchStartX = null;
        this.touchStartY = null;
        this.touchStartTime = null;
        this.touchLastX = null;
        this.touchLastY = null;
    }

    /**
     * Clears all input timers (DAS, soft drop)
     * Call this when pausing or resetting the game
     */
    clearTimers() {
        if (this.dasTimer) clearTimeout(this.dasTimer);
        if (this.dasIntervalTimer) clearInterval(this.dasIntervalTimer);
        if (this.softDropTimer) clearInterval(this.softDropTimer);
        this.dasTimer = null;
        this.dasIntervalTimer = null;
        this.softDropTimer = null;
    }

    /**
     * Validates that a game action callback exists and is callable
     * @param {Object} gameActions - Game actions object
     * @param {string} actionName - Name of the action to validate
     * @returns {boolean} True if the action exists and is a function
     */
    static isValidAction(gameActions, actionName) {
        return gameActions && typeof gameActions[actionName] === 'function';
    }
}

/**
 * Sets up keyboard input handling with DAS (Delayed Auto Shift) support
 * Uses native DOM events - compatible with Phaser 3, Phaser 4, and any framework
 *
 * @param {InputController} inputController - Input controller instance
 * @param {Object} settings - Game settings (must include keyBindings, dasDelay, dasInterval)
 * @param {Object} gameActions - Game action callbacks (move, rotate, hardDrop, etc.)
 */
export function setupKeyboardControls(inputController, settings, gameActions) {
    // Defensive validation
    if (!inputController) {
        console.error('[Keyboard] InputController is required');
        return;
    }
    if (!settings || !settings.keyBindings) {
        console.error('[Keyboard] Settings with keyBindings are required');
        return;
    }
    if (!gameActions) {
        console.error('[Keyboard] Game actions are required');
        return;
    }

    console.log('[Keyboard] Setting up keyboard controls');

    const {
        move, rotate, softDrop, hardDrop, togglePause, startGame, initSound,
    } = gameActions;

    // Keydown handler
    document.addEventListener('keydown', (e) => {
        try {
            // Escape always toggles pause
            if (e.key === 'Escape') {
                if (togglePause) togglePause();
                return;
            }

            // Initialize sound on first interaction
            if (!inputController.soundInitialized) {
                inputController.soundInitialized = true;
                if (initSound) initSound();
            }

            // Don't handle input if typing in key binding input
            if (document.activeElement && document.activeElement.classList.contains('key-input')) {
                return;
            }

            // Start game if on start/game-over modal
            const startModal = document.getElementById('start-modal');
            const gameOverModal = document.getElementById('game-over-modal');
            if (
                (startModal && startModal.classList.contains('visible'))
                || (gameOverModal && gameOverModal.classList.contains('visible'))
            ) {
                if (startGame) startGame();
                return;
            }

            // Get action from key binding
            const key = e.key === ' ' ? 'Space' : e.key;
            const action = Object.keys(settings.keyBindings).find((k) => settings.keyBindings[k] === key);

            if (!action || inputController.keyMap[action]) return;
            inputController.keyMap[action] = true;

            // Handle input queue during physics processing
            if (gameActions.isProcessingPhysics && gameActions.inputQueue !== undefined) {
                if (
                    !gameActions.inputQueue
                    && (action === 'moveLeft'
                        || action === 'moveRight'
                        || action.startsWith('rotate')
                        || action === 'flip')
                ) {
                    const isRotate = action.startsWith('rotate') || action === 'flip';
                    let dir;
                    if (action === 'moveLeft') {
                        dir = -1;
                    } else if (action === 'moveRight') {
                        dir = 1;
                    } else if (action === 'rotateLeft') {
                        dir = 'left';
                    } else if (action === 'flip') {
                        dir = 'flip';
                    } else {
                        dir = 'right';
                    }

                    gameActions.inputQueue = {
                        type: isRotate ? 'rotate' : 'move',
                        dir,
                    };
                }
                return;
            }

            // Execute actions
            switch (action) {
            case 'moveLeft':
                if (move) {
                    move(-1);
                    inputController.dasTimer = setTimeout(() => {
                        inputController.dasIntervalTimer = setInterval(
                            () => move(-1),
                            settings.dasInterval,
                        );
                    }, settings.dasDelay);
                }
                break;

            case 'moveRight':
                if (move) {
                    move(1);
                    inputController.dasTimer = setTimeout(() => {
                        inputController.dasIntervalTimer = setInterval(
                            () => move(1),
                            settings.dasInterval,
                        );
                    }, settings.dasDelay);
                }
                break;

            case 'softDrop':
                if (softDrop) {
                    softDrop();
                    inputController.softDropTimer = setInterval(() => softDrop(), 50);
                }
                break;

            case 'rotateRight':
                if (rotate) rotate('right');
                break;

            case 'rotateLeft':
                if (rotate) rotate('left');
                break;

            case 'flip':
                if (rotate) rotate('flip');
                break;

            case 'hardDrop':
                e.preventDefault();
                if (hardDrop) hardDrop();
                break;

            case 'nextTrack':
                if (gameActions.nextTrack) {
                    gameActions.nextTrack();
                }
                break;

            case 'randomTheme':
                if (gameActions.randomTheme) {
                    gameActions.randomTheme();
                }
                break;

            case 'toggleFullscreen':
                if (gameActions.toggleFullscreen) {
                    gameActions.toggleFullscreen();
                }
                break;

            case 'showHighScores':
                if (gameActions.showHighScores) {
                    gameActions.showHighScores();
                }
                break;

            default:
                // No action for unrecognized key binding
                break;
            }
        } catch (error) {
            console.error('[Keyboard] Error in keydown handler:', error);
        }
    });

    // Keyup handler
    document.addEventListener('keyup', (e) => {
        try {
            const key = e.key === ' ' ? 'Space' : e.key;
            const action = Object.keys(settings.keyBindings).find((k) => settings.keyBindings[k] === key);

            if (action) {
                inputController.keyMap[action] = false;
            }

            // Clear DAS timers for movement
            if (action === 'moveLeft' || action === 'moveRight') {
                clearTimeout(inputController.dasTimer);
                clearInterval(inputController.dasIntervalTimer);
                inputController.dasTimer = null;
                inputController.dasIntervalTimer = null;
            }

            // Clear soft drop timer
            if (action === 'softDrop') {
                clearInterval(inputController.softDropTimer);
                inputController.softDropTimer = null;
            }
        } catch (error) {
            console.error('[Keyboard] Error in keyup handler:', error);
        }
    });

    console.log('[Keyboard] Keyboard controls initialized');
}

/**
 * Sets up touch input handling with gesture detection (tap, drag, flick)
 * Uses native DOM events - compatible with Phaser 3, Phaser 4, and any framework
 *
 * @param {InputController} inputController - Input controller instance
 * @param {Object} settings - Game settings (must include controlScheme)
 * @param {Object} gameActions - Game action callbacks
 * @param {HTMLCanvasElement} canvas - Game canvas element (for tap region detection)
 */
export function setupTouchControls(inputController, settings, gameActions, canvas) {
    // Defensive validation
    if (!inputController) {
        console.error('[Touch] InputController is required');
        return;
    }
    if (!settings) {
        console.error('[Touch] Settings are required');
        return;
    }
    if (!gameActions) {
        console.error('[Touch] Game actions are required');
        return;
    }
    if (!canvas) {
        console.warn('[Touch] Canvas not provided - tap region detection disabled');
    }

    console.log('[Touch] Setting up touch controls');

    const {
        move, rotate, softDrop, hardDrop, startGame, initSound,
    } = gameActions;

    // Touch start handler
    document.addEventListener('touchstart', (e) => {
        try {
            if (settings.controlScheme !== 'Touch') return;

            // Don't handle touch on UI elements
            if (
                e.target.tagName === 'BUTTON'
                || e.target.classList.contains('key-input')
                || e.target.tagName === 'SELECT'
                || e.target.tagName === 'INPUT'
            ) {
                return;
            }

            e.preventDefault();

            const touch = e.touches[0];
            inputController.touchStartX = touch.clientX;
            inputController.touchStartY = touch.clientY;
            inputController.touchLastX = touch.clientX;
            inputController.touchLastY = touch.clientY;
            inputController.touchStartTime = Date.now();
        } catch (error) {
            console.error('[Touch] Error in touchstart handler:', error);
        }
    });

    // Touch move handler
    document.addEventListener('touchmove', (e) => {
        try {
            if (!inputController.touchStartX || settings.controlScheme !== 'Touch') return;
            e.preventDefault();

            const touch = e.touches[0];
            const deltaX = touch.clientX - inputController.touchLastX;
            const deltaY = touch.clientY - inputController.touchLastY;

            const moveThreshold = BLOCK_SIZE;
            const softDropThreshold = BLOCK_SIZE / 2;

            // Horizontal movement check
            if (Math.abs(deltaX) > moveThreshold) {
                if (move) move(deltaX > 0 ? 1 : -1);
                inputController.touchLastX = touch.clientX;
            }

            // Vertical movement check
            if (deltaY > softDropThreshold) {
                if (softDrop) softDrop();
                inputController.touchLastY = touch.clientY;
            }
        } catch (error) {
            console.error('[Touch] Error in touchmove handler:', error);
        }
    });

    // Touch end handler
    document.addEventListener('touchend', (e) => {
        try {
            if (!inputController.touchStartX || settings.controlScheme !== 'Touch') return;
            e.preventDefault();

            // Initialize sound on first interaction
            if (!inputController.soundInitialized) {
                inputController.soundInitialized = true;
                if (initSound) initSound();
            }

            // Start game if on start/game-over modal
            const startModal = document.getElementById('start-modal');
            const gameOverModal = document.getElementById('game-over-modal');
            if (
                (startModal && startModal.classList.contains('visible'))
                || (gameOverModal && gameOverModal.classList.contains('visible'))
            ) {
                if (startGame) startGame();
                inputController.resetTouch();
                return;
            }

            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - inputController.touchStartX;
            const deltaY = touch.clientY - inputController.touchStartY;
            const deltaTime = Date.now() - inputController.touchStartTime;

            const tapThreshold = 25;
            const flickTime = 300;
            const flickDistY = 60;

            // Tap detection (quick, small movement)
            if (
                deltaTime < flickTime
                && Math.abs(deltaX) < tapThreshold
                && Math.abs(deltaY) < tapThreshold
            ) {
                // Only handle tap if canvas is available
                if (canvas) {
                    const canvasRect = canvas.getBoundingClientRect();
                    const touchXonCanvas = touch.clientX - canvasRect.left;

                    // Left side = rotate left, right side = rotate right
                    if (touchXonCanvas < canvas.width / 2) {
                        if (rotate) rotate('left');
                    } else if (rotate) {
                        rotate('right');
                    }
                }
            } else if (deltaTime < flickTime) {
                // Flick detection (quick, large movement)
                // Vertical flick for hard drop
                if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY > flickDistY) {
                    if (hardDrop) hardDrop();
                }
            }

            inputController.resetTouch();
        } catch (error) {
            console.error('[Touch] Error in touchend handler:', error);
        }
    });

    console.log('[Touch] Touch controls initialized');
}

/**
 * Sets up click handling (for starting game and sound initialization)
 * Uses native DOM events - compatible with Phaser 3, Phaser 4, and any framework
 *
 * @param {InputController} inputController - Input controller instance
 * @param {Function} startGame - Start game callback
 * @param {Function} initSound - Initialize sound callback
 */
export function setupClickControls(inputController, startGame, initSound) {
    // Defensive validation
    if (!inputController) {
        console.error('[Click] InputController is required');
        return;
    }

    console.log('[Click] Setting up click controls');

    document.addEventListener('click', (e) => {
        try {
            // Initialize sound on first interaction
            if (!inputController.soundInitialized) {
                inputController.soundInitialized = true;
                if (initSound) initSound();
            }

            // Don't handle clicks on UI elements
            if (
                e.target.tagName === 'BUTTON'
                || e.target.classList.contains('key-input')
                || e.target.tagName === 'SELECT'
                || e.target.tagName === 'INPUT'
            ) {
                return;
            }

            // Start game if on start/game-over modal
            const startModal = document.getElementById('start-modal');
            const gameOverModal = document.getElementById('game-over-modal');
            if (
                (startModal && startModal.classList.contains('visible'))
                || (gameOverModal && gameOverModal.classList.contains('visible'))
            ) {
                if (startGame) startGame();
            }
        } catch (error) {
            console.error('[Click] Error in click handler:', error);
        }
    });

    console.log('[Click] Click controls initialized');
}

/**
 * Initializes all input controls (keyboard, touch, click)
 * This is the main entry point for setting up DOM-based input handling
 *
 * @param {Object} settings - Game settings (must include keyBindings, controlScheme)
 * @param {Object} gameActions - Game action callbacks (move, rotate, hardDrop, etc.)
 * @param {HTMLCanvasElement} canvas - Game canvas element (for touch tap region detection)
 * @returns {InputController} Input controller instance
 */
export function initializeControls(settings, gameActions, canvas) {
    console.log('[Input] Initializing all input controls...');

    const inputController = new InputController();

    setupKeyboardControls(inputController, settings, gameActions);
    setupTouchControls(inputController, settings, gameActions, canvas);
    setupClickControls(inputController, gameActions.startGame, gameActions.initSound);

    console.log('[Input] ✅ All input controls initialized successfully');
    return inputController;
}
