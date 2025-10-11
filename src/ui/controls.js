/**
 * @fileoverview Input Controls for Serenity Blocks
 * Handles keyboard and touch input with DAS (Delayed Auto Shift) support
 */

import { BLOCK_SIZE } from '../core/constants.js';

/**
 * Input controller state
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
    }

    /**
     * Resets touch state
     */
    resetTouch() {
        this.touchStartX = null;
        this.touchStartY = null;
        this.touchStartTime = null;
        this.touchLastX = null;
        this.touchLastY = null;
    }

    /**
     * Clears all input timers
     */
    clearTimers() {
        if (this.dasTimer) clearTimeout(this.dasTimer);
        if (this.dasIntervalTimer) clearInterval(this.dasIntervalTimer);
        if (this.softDropTimer) clearInterval(this.softDropTimer);
        this.dasTimer = null;
        this.dasIntervalTimer = null;
        this.softDropTimer = null;
    }
}

/**
 * Sets up keyboard input handling
 * @param {InputController} inputController - Input controller instance
 * @param {Object} settings - Game settings
 * @param {Object} gameActions - Game action functions
 */
export function setupKeyboardControls(inputController, settings, gameActions) {
    const { move, rotate, softDrop, hardDrop, togglePause, startGame, initSound } = gameActions;

    // Keydown handler
    document.addEventListener('keydown', e => {
        // Escape always toggles pause
        if (e.key === 'Escape') {
            togglePause();
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
            (startModal && startModal.classList.contains('visible')) ||
            (gameOverModal && gameOverModal.classList.contains('visible'))
        ) {
            startGame();
            return;
        }

        // Get action from key binding
        const key = e.key === ' ' ? 'Space' : e.key;
        const action = Object.keys(settings.keyBindings).find(k => settings.keyBindings[k] === key);

        if (!action || inputController.keyMap[action]) return;
        inputController.keyMap[action] = true;

        // Handle input queue during physics processing
        if (gameActions.isProcessingPhysics && gameActions.inputQueue !== undefined) {
            if (
                !gameActions.inputQueue &&
                (action === 'moveLeft' ||
                    action === 'moveRight' ||
                    action.startsWith('rotate') ||
                    action === 'flip')
            ) {
                gameActions.inputQueue = {
                    type: action.startsWith('rotate') || action === 'flip' ? 'rotate' : 'move',
                    dir:
                        action === 'moveLeft'
                            ? -1
                            : action === 'moveRight'
                              ? 1
                              : action === 'rotateLeft'
                                ? 'left'
                                : action === 'flip'
                                  ? 'flip'
                                  : 'right',
                };
            }
            return;
        }

        // Execute actions
        switch (action) {
            case 'moveLeft':
                move(-1);
                inputController.dasTimer = setTimeout(() => {
                    inputController.dasIntervalTimer = setInterval(
                        () => move(-1),
                        settings.dasInterval
                    );
                }, settings.dasDelay);
                break;

            case 'moveRight':
                move(1);
                inputController.dasTimer = setTimeout(() => {
                    inputController.dasIntervalTimer = setInterval(
                        () => move(1),
                        settings.dasInterval
                    );
                }, settings.dasDelay);
                break;

            case 'softDrop':
                softDrop();
                inputController.softDropTimer = setInterval(() => softDrop(), 50);
                break;

            case 'rotateRight':
                rotate('right');
                break;

            case 'rotateLeft':
                rotate('left');
                break;

            case 'flip':
                rotate('flip');
                break;

            case 'hardDrop':
                e.preventDefault();
                hardDrop();
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
        }
    });

    // Keyup handler
    document.addEventListener('keyup', e => {
        const key = e.key === ' ' ? 'Space' : e.key;
        const action = Object.keys(settings.keyBindings).find(k => settings.keyBindings[k] === key);

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
    });
}

/**
 * Sets up touch input handling
 * @param {InputController} inputController - Input controller instance
 * @param {Object} settings - Game settings
 * @param {Object} gameActions - Game action functions
 * @param {HTMLCanvasElement} canvas - Game canvas element
 */
export function setupTouchControls(inputController, settings, gameActions, canvas) {
    const { move, rotate, softDrop, hardDrop, startGame, initSound } = gameActions;

    // Touch start handler
    document.addEventListener('touchstart', e => {
        if (settings.controlScheme !== 'Touch') return;

        // Don't handle touch on UI elements
        if (
            e.target.tagName === 'BUTTON' ||
            e.target.classList.contains('key-input') ||
            e.target.tagName === 'SELECT' ||
            e.target.tagName === 'INPUT'
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
    });

    // Touch move handler
    document.addEventListener('touchmove', e => {
        if (!inputController.touchStartX || settings.controlScheme !== 'Touch') return;
        e.preventDefault();

        const touch = e.touches[0];
        const deltaX = touch.clientX - inputController.touchLastX;
        const deltaY = touch.clientY - inputController.touchLastY;

        const moveThreshold = BLOCK_SIZE;
        const softDropThreshold = BLOCK_SIZE / 2;

        // Horizontal movement check
        if (Math.abs(deltaX) > moveThreshold) {
            move(deltaX > 0 ? 1 : -1);
            inputController.touchLastX = touch.clientX;
        }

        // Vertical movement check
        if (deltaY > softDropThreshold) {
            softDrop();
            inputController.touchLastY = touch.clientY;
        }
    });

    // Touch end handler
    document.addEventListener('touchend', e => {
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
            (startModal && startModal.classList.contains('visible')) ||
            (gameOverModal && gameOverModal.classList.contains('visible'))
        ) {
            startGame();
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
            deltaTime < flickTime &&
            Math.abs(deltaX) < tapThreshold &&
            Math.abs(deltaY) < tapThreshold
        ) {
            const canvasRect = canvas.getBoundingClientRect();
            const touchXonCanvas = touch.clientX - canvasRect.left;

            // Left side = rotate left, right side = rotate right
            if (touchXonCanvas < canvas.width / 2) {
                rotate('left');
            } else {
                rotate('right');
            }
        }
        // Flick detection (quick, large movement)
        else if (deltaTime < flickTime) {
            // Vertical flick for hard drop
            if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY > flickDistY) {
                hardDrop();
            }
        }

        inputController.resetTouch();
    });
}

/**
 * Sets up click handling (for starting game)
 * @param {InputController} inputController - Input controller instance
 * @param {Function} startGame - Start game function
 * @param {Function} initSound - Initialize sound function
 */
export function setupClickControls(inputController, startGame, initSound) {
    document.addEventListener('click', e => {
        // Initialize sound on first interaction
        if (!inputController.soundInitialized) {
            inputController.soundInitialized = true;
            if (initSound) initSound();
        }

        // Don't handle clicks on UI elements
        if (
            e.target.tagName === 'BUTTON' ||
            e.target.classList.contains('key-input') ||
            e.target.tagName === 'SELECT' ||
            e.target.tagName === 'INPUT'
        ) {
            return;
        }

        // Start game if on start/game-over modal
        const startModal = document.getElementById('start-modal');
        const gameOverModal = document.getElementById('game-over-modal');
        if (
            (startModal && startModal.classList.contains('visible')) ||
            (gameOverModal && gameOverModal.classList.contains('visible'))
        ) {
            startGame();
        }
    });
}

/**
 * Initializes all input controls
 * @param {Object} settings - Game settings
 * @param {Object} gameActions - Game action functions
 * @param {HTMLCanvasElement} canvas - Game canvas element
 * @returns {InputController} Input controller instance
 */
export function initializeControls(settings, gameActions, canvas) {
    const inputController = new InputController();

    setupKeyboardControls(inputController, settings, gameActions);
    setupTouchControls(inputController, settings, gameActions, canvas);
    setupClickControls(inputController, gameActions.startGame, gameActions.initSound);

    return inputController;
}
