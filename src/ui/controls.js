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

import { COLS, ROWS } from '../core/constants.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

const INSTANT_DAS_REPEAT_LIMIT = COLS;
const INSTANT_SOFT_DROP_REPEAT_LIMIT = ROWS;

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

        // DAS timing state (high-precision delta accumulation)
        this.dasState = {
            moveLeft: { active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false },
            moveRight: { active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false },
            softDrop: { active: false, intervalAccumulator: 0 },

            p2_moveLeft: { active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false },
            p2_moveRight: { active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false },
            p2_softDrop: { active: false, intervalAccumulator: 0 }
        };

        this.lastTime = performance.now();
        this.gameActions = null; // Injected during setup
        this.settings = null;    // Injected during setup
        this.handleKeyDown = null;
        this.handleKeyUp = null;
        this.handleVisibilityChange = null;
        this.handleClick = null;

        // Sound initialization flag
        this.soundInitialized = false;

        console.log('[InputController] Initialized High-Precision DAS');
    }

    /**
     * Advance keyboard DAS using the authoritative gameplay timing.
     * @param {number} timestamp - Current frame timestamp
     */
    update(timestamp = performance.now()) {
        const delta = Math.max(0, Math.min(100, timestamp - this.lastTime));
        this.lastTime = timestamp;
        this.updateDAS(delta);
    }

    /**
     * Process high precision input repeating based on accumulated delta
     * @param {number} delta - Milliseconds since last frame
     */
    updateDAS(delta) {
        if (!this.gameActions || !this.settings) return;

        const currentSettings = window.settings || this.settings;
        const delay = currentSettings.dasDelay;
        const interval = currentSettings.dasInterval;
        const softDropInterval = currentSettings.softDropInterval ?? 50;

        // Process Player 1
        this.processDasDirection(this.dasState.moveLeft, delay, interval, delta, () => {
            if (this.gameActions.move) return this.gameActions.move(-1);
            return false;
        });
        this.processDasDirection(this.dasState.moveRight, delay, interval, delta, () => {
            if (this.gameActions.move) return this.gameActions.move(1);
            return false;
        });
        this.processSoftDrop(this.dasState.softDrop, softDropInterval, delta, () => {
            if (this.gameActions.softDrop) return this.gameActions.softDrop();
            return false;
        });

        // Process Player 2
        this.processDasDirection(this.dasState.p2_moveLeft, delay, interval, delta, () => {
            if (this.gameActions.moveP2) return this.gameActions.moveP2(-1);
            return false;
        });
        this.processDasDirection(this.dasState.p2_moveRight, delay, interval, delta, () => {
            if (this.gameActions.moveP2) return this.gameActions.moveP2(1);
            return false;
        });
        this.processSoftDrop(this.dasState.p2_softDrop, softDropInterval, delta, () => {
            if (this.gameActions.softDropP2) return this.gameActions.softDropP2();
            return false;
        });
    }

    processDasDirection(state, dasDelay, dasInterval, delta, actionCallback) {
        if (!state.active) return;

        const runInstantRepeat = () => {
            for (let i = 0; i < INSTANT_DAS_REPEAT_LIMIT; i++) {
                if (actionCallback() === false) {
                    break;
                }
            }
            state.intervalAccumulator = 0;
        };

        if (!state.isRepeating) {
            state.delayAccumulator += delta;
            if (state.delayAccumulator >= dasDelay) {
                state.isRepeating = true;
                // Execute first repeat exactly at the delay threshold
                state.intervalAccumulator = state.delayAccumulator - dasDelay;

                if (dasInterval <= 0) {
                    runInstantRepeat();
                    return;
                }

                actionCallback();

                // If the lag spike was massive, execute multiple times
                while (state.intervalAccumulator >= dasInterval) {
                    state.intervalAccumulator -= dasInterval;
                    actionCallback();
                }
            }
        } else {
            if (dasInterval <= 0) {
                runInstantRepeat();
                return;
            }

            state.intervalAccumulator += delta;
            while (state.intervalAccumulator >= dasInterval) {
                state.intervalAccumulator -= dasInterval;
                actionCallback();
            }
        }
    }

    processSoftDrop(state, dropInterval, delta, actionCallback) {
        if (!state.active) return;
        if (dropInterval <= 0) {
            for (let i = 0; i < INSTANT_SOFT_DROP_REPEAT_LIMIT; i++) {
                if (actionCallback() === false) {
                    break;
                }
            }
            state.intervalAccumulator = 0;
            return;
        }
        state.intervalAccumulator += delta;
        while (state.intervalAccumulator >= dropInterval) {
            state.intervalAccumulator -= dropInterval;
            actionCallback();
        }
    }

    /**
     * Clears all input timers (DAS, soft drop)
     * Call this when pausing or resetting the game
     */
    clearTimers() {
        // Reset all DAS states
        Object.keys(this.dasState).forEach(key => {
            this.dasState[key].active = false;
            this.dasState[key].delayAccumulator = 0;
            this.dasState[key].intervalAccumulator = 0;
            this.dasState[key].isRepeating = false;
        });
        this.lastTime = performance.now();
    }

    removeKeyboardControls() {
        if (typeof document === 'undefined') return;

        if (this.handleKeyDown) {
            document.removeEventListener('keydown', this.handleKeyDown);
            this.handleKeyDown = null;
        }
        if (this.handleKeyUp) {
            document.removeEventListener('keyup', this.handleKeyUp);
            this.handleKeyUp = null;
        }
        if (this.handleVisibilityChange) {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
            this.handleVisibilityChange = null;
        }
    }

    removeClickControls() {
        if (typeof document === 'undefined') return;

        if (this.handleClick) {
            document.removeEventListener('click', this.handleClick);
            this.handleClick = null;
        }
    }

    cleanup() {
        this.removeKeyboardControls();
        this.removeClickControls();
        this.clearTimers();
        this.keyMap = {};
        this.gameActions = null;
        this.settings = null;
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
        moveP2, rotateP2, softDropP2, hardDropP2, holdP2,
        requestMoveP2, requestRotateP2, requestSoftDropP2, requestHardDropP2, requestHoldP2,
    } = gameActions;

    performanceMonitor.recordInputAction();

    switch (action) {
        case 'moveLeft':
            if (requestMoveP2 || moveP2) {
                (requestMoveP2 || moveP2)(-1);
                inputController.dasState.p2_moveLeft.active = true;
                inputController.dasState.p2_moveLeft.delayAccumulator = 0;
                inputController.dasState.p2_moveLeft.intervalAccumulator = 0;
                inputController.dasState.p2_moveLeft.isRepeating = false;
            }
            break;

        case 'moveRight':
            if (requestMoveP2 || moveP2) {
                (requestMoveP2 || moveP2)(1);
                inputController.dasState.p2_moveRight.active = true;
                inputController.dasState.p2_moveRight.delayAccumulator = 0;
                inputController.dasState.p2_moveRight.intervalAccumulator = 0;
                inputController.dasState.p2_moveRight.isRepeating = false;
            }
            break;

        case 'softDrop':
            if (requestSoftDropP2 || softDropP2) {
                (requestSoftDropP2 || softDropP2)();
                inputController.dasState.p2_softDrop.active = true;
                inputController.dasState.p2_softDrop.intervalAccumulator = 0;
            }
            break;

        case 'rotateRight':
            if (requestRotateP2 || rotateP2) (requestRotateP2 || rotateP2)('right');
            break;

        case 'rotateLeft':
            if (requestRotateP2 || rotateP2) (requestRotateP2 || rotateP2)('left');
            break;

        case 'flip':
            if (requestRotateP2 || rotateP2) (requestRotateP2 || rotateP2)('flip');
            break;

        case 'hardDrop':
            if (requestHardDropP2 || hardDropP2) (requestHardDropP2 || hardDropP2)();
            break;

        case 'hold':
            if (requestHoldP2 || holdP2) (requestHoldP2 || holdP2)();
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
    inputController.removeKeyboardControls();

    const {
        move, rotate, softDrop, hardDrop, startGame, initSound,
        hold,
        requestMove, requestRotate, requestSoftDrop, requestHardDrop, requestHold,
    } = gameActions;

    // Inject dependencies for the update loop
    inputController.gameActions = gameActions;
    inputController.settings = settings;

    // Helper function to get current settings (reads from window.settings for live updates)
    const getCurrentSettings = () => window.settings || settings;

    // Keydown handler
    const handleKeyDown = (e) => {
        try {
            // Performance monitoring: Record input timestamp
            performanceMonitor.recordInput();

            // Get current settings dynamically to pick up keybinding changes
            const currentSettings = getCurrentSettings();

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
            const action = Object.keys(currentSettings.keyBindings).find((k) => currentSettings.keyBindings[k] === key);

            // Also check player 2 bindings (for local multiplayer)
            let actionP2 = null;
            if (currentSettings.player2KeyBindings) {
                actionP2 = Object.keys(currentSettings.player2KeyBindings).find((k) => currentSettings.player2KeyBindings[k] === key);
            }

            // Start game if on start/game-over modal
            const startModal = document.getElementById('start-modal');
            const gameOverModal = document.getElementById('game-over-modal');
            if (
                (startModal && startModal.classList.contains('visible'))
                || (gameOverModal && gameOverModal.classList.contains('visible'))
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
                handlePlayer2Action(actionP2, gameActions, inputController, currentSettings);
            }

            // Then handle player 1 input
            if (!action || inputController.keyMap[action]) return;
            inputController.keyMap[action] = true;

            // Execute actions
            switch (action) {
                case 'moveLeft':
                    if (requestMove || move) {
                        (requestMove || move)(-1);
                        performanceMonitor.recordInputAction();
                        inputController.dasState.moveLeft.active = true;
                        inputController.dasState.moveLeft.delayAccumulator = 0;
                        inputController.dasState.moveLeft.intervalAccumulator = 0;
                        inputController.dasState.moveLeft.isRepeating = false;
                    }
                    break;

                case 'moveRight':
                    if (requestMove || move) {
                        (requestMove || move)(1);
                        performanceMonitor.recordInputAction();
                        inputController.dasState.moveRight.active = true;
                        inputController.dasState.moveRight.delayAccumulator = 0;
                        inputController.dasState.moveRight.intervalAccumulator = 0;
                        inputController.dasState.moveRight.isRepeating = false;
                    }
                    break;

                case 'softDrop':
                    if (requestSoftDrop || softDrop) {
                        (requestSoftDrop || softDrop)();
                        performanceMonitor.recordInputAction();
                        inputController.dasState.softDrop.active = true;
                        inputController.dasState.softDrop.intervalAccumulator = 0;
                    }
                    break;

                case 'rotateRight':
                    if (requestRotate || rotate) {
                        (requestRotate || rotate)('right');
                        performanceMonitor.recordInputAction();
                    }
                    break;

                case 'rotateLeft':
                    if (requestRotate || rotate) {
                        (requestRotate || rotate)('left');
                        performanceMonitor.recordInputAction();
                    }
                    break;

                case 'flip':
                    if (requestRotate || rotate) {
                        (requestRotate || rotate)('flip');
                        performanceMonitor.recordInputAction();
                    }
                    break;

                case 'hardDrop':
                    e.preventDefault();
                    if (requestHardDrop || hardDrop) {
                        (requestHardDrop || hardDrop)();
                        performanceMonitor.recordInputAction();
                    }
                    break;

                case 'hold':
                    if (requestHold || hold) {
                        (requestHold || hold)();
                        performanceMonitor.recordInputAction();
                    }
                    break;

                default:
                    // No action for unrecognized key binding
                    break;
            }
        } catch (error) {
            console.error('[Keyboard] Error in keydown handler:', error);
        }
    };
    inputController.handleKeyDown = handleKeyDown;
    document.addEventListener('keydown', handleKeyDown);

    // Keyup handler
    const handleKeyUp = (e) => {
        try {
            // Block all input if settings modal is open
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal?.classList.contains('visible')) {
                return;
            }

            // Get current settings dynamically to pick up keybinding changes
            const currentSettings = getCurrentSettings();

            const key = e.key === ' ' ? 'Space' : e.key;
            const action = Object.keys(currentSettings.keyBindings).find((k) => currentSettings.keyBindings[k] === key);

            // Also check player 2 bindings (for local multiplayer)
            let actionP2 = null;
            if (currentSettings.player2KeyBindings) {
                actionP2 = Object.keys(currentSettings.player2KeyBindings).find((k) => currentSettings.player2KeyBindings[k] === key);
            }

            if (action) {
                inputController.keyMap[action] = false;
            }

            if (actionP2) {
                inputController.keyMap[`p2-${actionP2}`] = false;
            }

            // Clear DAS states for movement (Player 1)
            if (action === 'moveLeft') {
                inputController.dasState.moveLeft.active = false;
            } else if (action === 'moveRight') {
                inputController.dasState.moveRight.active = false;
            }

            // Clear DAS states for movement (Player 2)
            if (actionP2 === 'moveLeft') {
                inputController.dasState.p2_moveLeft.active = false;
            } else if (actionP2 === 'moveRight') {
                inputController.dasState.p2_moveRight.active = false;
            }

            // Clear soft drop state (Player 1)
            if (action === 'softDrop') {
                inputController.dasState.softDrop.active = false;
            }

            // Clear soft drop state (Player 2)
            if (actionP2 === 'softDrop') {
                inputController.dasState.p2_softDrop.active = false;
            }
        } catch (error) {
            console.error('[Keyboard] Error in keyup handler:', error);
        }
    };
    inputController.handleKeyUp = handleKeyUp;
    document.addEventListener('keyup', handleKeyUp);

    // Clear all DAS/soft-drop timers when tab loses focus (keyup won't fire)
    const handleVisibilityChange = () => {
        if (document.hidden) {
            inputController.clearTimers();
            inputController.keyMap = {};
        }
    };
    inputController.handleVisibilityChange = handleVisibilityChange;
    document.addEventListener('visibilitychange', handleVisibilityChange);

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
    inputController.removeClickControls();

    const handleClick = (e) => {
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
    };
    inputController.handleClick = handleClick;
    document.addEventListener('click', handleClick);

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
