/**
 * @fileoverview Input Controls for Serenity Blocks (Phaser 4 Compatible)
 * Handles keyboard input with DAS (Delayed Auto Shift) support
 *
 * **Architecture:** This input system uses native DOM events (keydown, etc.)
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
import { performanceMonitor } from '../utils/performance-monitor.js';

/**
 * Input controller state management
 * Tracks keyboard keys and input timers for DAS (Delayed Auto Shift)
 *
 * @class InputController
 */
export class InputController {
    constructor() {
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
 * Handles player 2 actions for local multiplayer
 * @private
 */
function handlePlayer2Action(action, gameActions, inputController, settings) {
    const {
        moveP2, rotateP2, softDropP2, hardDropP2,
    } = gameActions;

    performanceMonitor.recordInputAction();

    switch (action) {
        case 'moveLeft':
            if (moveP2) {
                moveP2(-1);
                inputController.dasTimerP2 = setTimeout(() => {
                    inputController.dasIntervalTimerP2 = setInterval(
                        () => moveP2(-1),
                        settings.dasInterval,
                    );
                }, settings.dasDelay);
            }
            break;

        case 'moveRight':
            if (moveP2) {
                moveP2(1);
                inputController.dasTimerP2 = setTimeout(() => {
                    inputController.dasIntervalTimerP2 = setInterval(
                        () => moveP2(1),
                        settings.dasInterval,
                    );
                }, settings.dasDelay);
            }
            break;

        case 'softDrop':
            if (softDropP2) {
                softDropP2();
                inputController.softDropTimerP2 = setInterval(() => softDropP2(), 50);
            }
            break;

        case 'rotateRight':
            if (rotateP2) rotateP2('right');
            break;

        case 'rotateLeft':
            if (rotateP2) rotateP2('left');
            break;

        case 'flip':
            if (rotateP2) rotateP2('flip');
            break;

        case 'hardDrop':
            if (hardDropP2) hardDropP2();
            break;

        default:
            break;
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
            // Performance monitoring: Record input timestamp
            performanceMonitor.recordInput();

            // Check if settings modal is open - block ALL input if it is
            const settingsModal = document.getElementById('settings-modal');
            const settingsModalVisible = settingsModal?.classList.contains('visible');

            // Escape key behavior depends on context
            if (e.key === 'Escape') {
                if (settingsModalVisible) {
                    // Settings modal is open - do nothing here, let modal handler close it
                    console.log('[Controls] Settings modal open, Escape will close modal');
                    return;
                }
                // Open settings menu (pauses game and shows settings)
                console.log('[Controls] Opening settings menu with Escape');
                if (gameActions.openSettingsMenu) gameActions.openSettingsMenu();
                return;
            }

            // Block all other input if settings modal is open
            if (settingsModalVisible) {
                console.log('[Controls] Settings modal open, ignoring input');
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

            // Get action from key binding (check this before auto-starting game)
            const key = e.key === ' ' ? 'Space' : e.key;
            const action = Object.keys(settings.keyBindings).find((k) => settings.keyBindings[k] === key);

            // Also check player 2 bindings (for local multiplayer)
            let actionP2 = null;
            if (settings.player2KeyBindings) {
                actionP2 = Object.keys(settings.player2KeyBindings).find((k) => settings.player2KeyBindings[k] === key);
            }

            // Allow global actions (fullscreen, high scores) to work even on start modal
            const globalActions = ['toggleFullscreen', 'showHighScores'];
            const isGlobalAction = globalActions.includes(action);

            // Start game if on start/game-over modal (but only for non-global actions)
            const startModal = document.getElementById('start-modal');
            const gameOverModal = document.getElementById('game-over-modal');
            if (
                !isGlobalAction
                && ((startModal && startModal.classList.contains('visible'))
                    || (gameOverModal && gameOverModal.classList.contains('visible')))
            ) {
                // Only start game on Space or Enter
                if (e.key === ' ' || e.key === 'Enter') {
                    if (startGame) startGame();
                }
                return;
            }

            // Handle player 2 input first (if applicable)
            if (actionP2 && !inputController.keyMap[`p2-${actionP2}`]) {
                inputController.keyMap[`p2-${actionP2}`] = true;
                handlePlayer2Action(actionP2, gameActions, inputController, settings);
            }

            // Then handle player 1 input
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
                        performanceMonitor.recordInputAction();
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
                        performanceMonitor.recordInputAction();
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
                        performanceMonitor.recordInputAction();
                        inputController.softDropTimer = setInterval(() => softDrop(), 50);
                    }
                    break;

                case 'rotateRight':
                    if (rotate) {
                        rotate('right');
                        performanceMonitor.recordInputAction();
                    }
                    break;

                case 'rotateLeft':
                    if (rotate) {
                        rotate('left');
                        performanceMonitor.recordInputAction();
                    }
                    break;

                case 'flip':
                    if (rotate) {
                        rotate('flip');
                        performanceMonitor.recordInputAction();
                    }
                    break;

                case 'hardDrop':
                    e.preventDefault();
                    if (hardDrop) {
                        hardDrop();
                        performanceMonitor.recordInputAction();
                    }
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

                case 'togglePause':
                    if (togglePause) {
                        togglePause();
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
            // Block all input if settings modal is open
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal?.classList.contains('visible')) {
                return;
            }

            const key = e.key === ' ' ? 'Space' : e.key;
            const action = Object.keys(settings.keyBindings).find((k) => settings.keyBindings[k] === key);

            // Also check player 2 bindings (for local multiplayer)
            let actionP2 = null;
            if (settings.player2KeyBindings) {
                actionP2 = Object.keys(settings.player2KeyBindings).find((k) => settings.player2KeyBindings[k] === key);
            }

            if (action) {
                inputController.keyMap[action] = false;
            }

            if (actionP2) {
                inputController.keyMap[`p2-${actionP2}`] = false;
            }

            // Clear DAS timers for movement (Player 1)
            if (action === 'moveLeft' || action === 'moveRight') {
                clearTimeout(inputController.dasTimer);
                clearInterval(inputController.dasIntervalTimer);
                inputController.dasTimer = null;
                inputController.dasIntervalTimer = null;
            }

            // Clear DAS timers for movement (Player 2)
            if (actionP2 === 'moveLeft' || actionP2 === 'moveRight') {
                clearTimeout(inputController.dasTimerP2);
                clearInterval(inputController.dasIntervalTimerP2);
                inputController.dasTimerP2 = null;
                inputController.dasIntervalTimerP2 = null;
            }

            // Clear soft drop timer (Player 1)
            if (action === 'softDrop') {
                clearInterval(inputController.softDropTimer);
                inputController.softDropTimer = null;
            }

            // Clear soft drop timer (Player 2)
            if (actionP2 === 'softDrop') {
                clearInterval(inputController.softDropTimerP2);
                inputController.softDropTimerP2 = null;
            }
        } catch (error) {
            console.error('[Keyboard] Error in keyup handler:', error);
        }
    });

    console.log('[Keyboard] Keyboard controls initialized');
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
                e.target.closest('button')
                || e.target.closest('.key-input')
                || e.target.closest('select')
                || e.target.closest('input')
                || e.target.closest('.clickable')
                || e.target.closest('#demo-browser-modal')
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
 * Initializes all input controls (keyboard, click)
 * This is the main entry point for setting up DOM-based input handling
 *
 * @param {Object} settings - Game settings (must include keyBindings, controlScheme)
 * @param {Object} gameActions - Game action callbacks (move, rotate, hardDrop, etc.)
 * @returns {InputController} Input controller instance
 */
export function initializeControls(settings, gameActions) {
    console.log('[Input] Initializing all input controls...');

    const inputController = new InputController();

    setupKeyboardControls(inputController, settings, gameActions);
    setupClickControls(inputController, gameActions.startGame, gameActions.initSound);

    console.log('[Input] ✅ All input controls initialized successfully');
    return inputController;
}
