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
import { advanceDas, advanceSoftDrop } from '../core/das.js';
import {
    clearPlayerInput,
    enqueueInputEdge,
} from '../core/player-input-state.js';
import { performanceMonitor } from '../utils/performance-monitor.js';

const INSTANT_DAS_REPEAT_LIMIT = COLS;
const INSTANT_SOFT_DROP_REPEAT_LIMIT = ROWS;

const FIXED_TICK_ACTIONS = Object.freeze({
    moveLeft: { action: 'move', value: -1, held: true },
    moveRight: { action: 'move', value: 1, held: true },
    softDrop: { action: 'softDrop', value: null, held: true },
    rotateRight: { action: 'rotate', value: 'right', held: false },
    rotateLeft: { action: 'rotate', value: 'left', held: false },
    flip: { action: 'rotate', value: 'flip', held: false },
    hardDrop: { action: 'hardDrop', value: null, held: false },
});

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
            moveLeft: {
                active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false,
            },
            moveRight: {
                active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false,
            },
            softDrop: { active: false, intervalAccumulator: 0 },

            p2_moveLeft: {
                active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false,
            },
            p2_moveRight: {
                active: false, delayAccumulator: 0, intervalAccumulator: 0, isRepeating: false,
            },
            p2_softDrop: { active: false, intervalAccumulator: 0 },
        };

        this.lastTime = performance.now();
        this.gameActions = null; // Injected during setup
        this.settings = null; // Injected during setup
        this.handleKeyDown = null;
        this.handleKeyUp = null;
        this.handleVisibilityChange = null;
        this.handleClick = null;
        this.fixedTickInputAdapter = null;
        this.fixedTickHeldKeys = new Map();
        this.fixedTickTouchedStates = new Set();

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

        if (!this.isFixedTickPlayerClaimed(0)) {
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
        }

        if (!this.isFixedTickPlayerClaimed(1)) {
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
    }

    setFixedTickInputAdapter(adapter = null) {
        // Keep physical latches until keyup. Swapping modes while a key is
        // physically held must not let a browser repeat re-arm either path.
        this.clearFixedTickInput();
        this.fixedTickInputAdapter = adapter
            && typeof adapter.isEnabled === 'function'
            && typeof adapter.resolveGameState === 'function'
            ? adapter
            : null;
    }

    resolveFixedTickOwnership(playerIndex) {
        const adapter = this.fixedTickInputAdapter;
        if (!adapter) return { claimed: false, gameState: null };

        let gameState = null;
        try {
            gameState = adapter.resolveGameState(playerIndex) || null;
            const claimed = adapter.isEnabled({ playerIndex, gameState }) === true;
            return { claimed, gameState };
        } catch (error) {
            console.error('[Keyboard] Fixed-tick input adapter failed:', error);
            return { claimed: true, gameState: null };
        }
    }

    isFixedTickPlayerClaimed(playerIndex) {
        return this.resolveFixedTickOwnership(playerIndex).claimed;
    }

    getFixedTickStamp(gameState, event, playerIndex) {
        const adapter = this.fixedTickInputAdapter;
        const fallback = {
            tick: Math.max(0, Math.floor(Number(gameState?.simFrame) || 0)) + 1,
            subframe: 0,
        };
        if (typeof adapter?.stamp !== 'function') return fallback;

        try {
            const stamp = adapter.stamp({
                gameState, event, playerIndex, fallback,
            }) || fallback;
            return {
                tick: Number.isInteger(stamp.tick) && stamp.tick >= fallback.tick
                    ? stamp.tick
                    : fallback.tick,
                subframe: Number.isInteger(stamp.subframe)
                    ? Math.min(9, Math.max(0, stamp.subframe))
                    : 0,
            };
        } catch (error) {
            console.error('[Keyboard] Fixed-tick input stamp failed:', error);
            return fallback;
        }
    }

    acceptFixedTickSource(gameState, playerIndex) {
        const { fixedTickInputAdapter: adapter } = this;
        if (typeof adapter?.acceptSource !== 'function') return true;
        try {
            return adapter.acceptSource({ gameState, playerIndex }) === true;
        } catch (error) {
            console.error('[Keyboard] Fixed-tick source policy failed:', error);
            return false;
        }
    }

    releaseFixedTickSource() {
        const { fixedTickInputAdapter: adapter } = this;
        if (typeof adapter?.releaseSource !== 'function') return;
        try {
            adapter.releaseSource();
        } catch (error) {
            console.error('[Keyboard] Fixed-tick source release failed:', error);
        }
    }

    enqueueFixedTickAction({
        playerIndex,
        logicalAction,
        physicalKey,
        event,
        keyMapKey,
    }) {
        const descriptor = FIXED_TICK_ACTIONS[logicalAction];
        if (!descriptor) return { handled: false, accepted: false };

        const { claimed, gameState } = this.resolveFixedTickOwnership(playerIndex);
        if (!claimed) return { handled: false, accepted: false };

        const records = this.fixedTickHeldKeys.get(physicalKey) || [];
        const alreadyLatched = records.some((record) => (
            record.playerIndex === playerIndex && record.keyMapKey === keyMapKey
        ));
        if (alreadyLatched) return { handled: true, accepted: false };

        const rememberPhysicalLatch = (cleared) => {
            records.push({
                playerIndex,
                gameState,
                action: descriptor.action,
                value: descriptor.value,
                held: descriptor.held,
                keyMapKey,
                cleared,
            });
            this.fixedTickHeldKeys.set(physicalKey, records);
        };

        if (event?.repeat === true) {
            rememberPhysicalLatch(true);
            return { handled: true, accepted: false };
        }
        if (
            !gameState?.playerInput
            || gameState.isPaused
            || gameState.isGameOver
            || gameState.isStopped
            || gameState.isAlive === false
            || gameState.isReplay
            || gameState.isSeeking
            || gameState.suppressExternalInput
        ) {
            rememberPhysicalLatch(true);
            return { handled: true, accepted: false };
        }
        if (!this.acceptFixedTickSource(gameState, playerIndex)) {
            rememberPhysicalLatch(true);
            return { handled: true, accepted: false };
        }

        const stamp = this.getFixedTickStamp(gameState, event, playerIndex);
        const edge = enqueueInputEdge(gameState.playerInput, {
            ...stamp,
            action: descriptor.action,
            value: descriptor.value,
            phase: 'down',
        });
        this.fixedTickTouchedStates.add(gameState.playerInput);
        rememberPhysicalLatch(!edge);
        return { handled: true, accepted: Boolean(edge) };
    }

    releaseFixedTickKey(physicalKey, event) {
        const records = this.fixedTickHeldKeys.get(physicalKey);
        if (!records?.length) return { handled: false, accepted: 0 };
        this.fixedTickHeldKeys.delete(physicalKey);

        let accepted = 0;
        records.forEach((record) => {
            this.keyMap[record.keyMapKey] = false;
            const { gameState } = record;
            if (!record.held || record.cleared || !gameState?.playerInput) return;

            const ownership = this.resolveFixedTickOwnership(record.playerIndex);
            if (
                !ownership.claimed
                || ownership.gameState !== gameState
                || gameState.isPaused
                || gameState.isGameOver
                || gameState.isStopped
                || gameState.isAlive === false
                || gameState.isReplay
                || gameState.isSeeking
                || gameState.suppressExternalInput
            ) {
                clearPlayerInput(gameState.playerInput);
                return;
            }

            const stamp = this.getFixedTickStamp(gameState, event, record.playerIndex);
            const edge = enqueueInputEdge(gameState.playerInput, {
                ...stamp,
                action: record.action,
                value: record.value,
                phase: 'up',
            });
            if (edge) accepted += 1;
        });
        return { handled: true, accepted };
    }

    clearFixedTickInput({ dropPhysicalLatches = false } = {}) {
        this.fixedTickTouchedStates.forEach((state) => clearPlayerInput(state));
        this.fixedTickTouchedStates.clear();
        this.releaseFixedTickSource();
        if (dropPhysicalLatches) {
            this.fixedTickHeldKeys.forEach((records) => {
                records.forEach((record) => {
                    this.keyMap[record.keyMapKey] = false;
                });
            });
            this.fixedTickHeldKeys.clear();
        } else {
            this.fixedTickHeldKeys.forEach((records) => {
                records.forEach((record) => { record.cleared = true; });
            });
        }
    }

    processDasDirection(state, dasDelay, dasInterval, delta, actionCallback) {
        advanceDas(state, delta, {
            dasDelay,
            dasInterval,
            instantLimit: INSTANT_DAS_REPEAT_LIMIT,
        }, actionCallback);
    }

    processSoftDrop(state, dropInterval, delta, actionCallback) {
        advanceSoftDrop(state, delta, {
            softDropInterval: dropInterval,
            instantLimit: INSTANT_SOFT_DROP_REPEAT_LIMIT,
        }, actionCallback);
    }

    /**
     * Clears all input timers (DAS, soft drop)
     * Call this when pausing or resetting the game
     */
    clearTimers() {
        this.clearFixedTickInput();
        // Reset all DAS states
        Object.keys(this.dasState).forEach((key) => {
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
        this.clearFixedTickInput({ dropPhysicalLatches: true });
        this.fixedTickInputAdapter = null;
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
function handlePlayer2Action(action, gameActions, inputController) {
    const {
        moveP2, rotateP2, softDropP2, hardDropP2,
        requestMoveP2, requestRotateP2, requestSoftDropP2, requestHardDropP2,
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
    inputController.clearTimers();
    inputController.removeKeyboardControls();

    const {
        move, rotate, softDrop, hardDrop, startGame, initSound,
        requestMove, requestRotate, requestSoftDrop, requestHardDrop,
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
                // The Hub's document handler owns Escape while its top-layer
                // panel is open. Opening Settings underneath it leaves two
                // modal owners active and can resume/stop the wrong mode when
                // either layer subsequently closes.
                if (document.body?.classList?.contains('serenity-hub-open')) {
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

            // Serenity Hub owns keyboard/gamepad activation while it is open.
            // The start/game-over modal can remain visible underneath the hub;
            // allowing this global handler through would turn Enter/Space on a
            // theme card into an unrelated game restart.
            if (document.body?.classList?.contains('serenity-hub-open')) {
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
            const action = Object.keys(currentSettings.keyBindings)
                .find((k) => currentSettings.keyBindings[k] === key);

            // Also check player 2 bindings (for local multiplayer)
            let actionP2 = null;
            if (currentSettings.player2KeyBindings) {
                actionP2 = Object.keys(currentSettings.player2KeyBindings)
                    .find((k) => currentSettings.player2KeyBindings[k] === key);
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
                    // Game-mode cards own Enter/Space to launch THEIR focused mode;
                    // don't let the generic handler start the default mode instead.
                    const active = document.activeElement;
                    if (active?.classList?.contains('game-mode-card')) {
                        return;
                    }
                    if (startGame) startGame();
                }
                return;
            }

            // Handle player 2 input first (if applicable)
            if (actionP2 && !inputController.keyMap[`p2-${actionP2}`]) {
                inputController.keyMap[`p2-${actionP2}`] = true;
                const fixedResult = inputController.enqueueFixedTickAction({
                    playerIndex: 1,
                    logicalAction: actionP2,
                    physicalKey: key,
                    event: e,
                    keyMapKey: `p2-${actionP2}`,
                });
                if (fixedResult.handled) {
                    if (fixedResult.accepted) performanceMonitor.recordInputAction();
                } else {
                    handlePlayer2Action(actionP2, gameActions, inputController);
                }
            }

            // Then handle player 1 input
            if (!action || inputController.keyMap[action]) return;
            inputController.keyMap[action] = true;

            const fixedResult = inputController.enqueueFixedTickAction({
                playerIndex: 0,
                logicalAction: action,
                physicalKey: key,
                event: e,
                keyMapKey: action,
            });
            if (fixedResult.handled) {
                if (action === 'hardDrop') e.preventDefault();
                if (fixedResult.accepted) performanceMonitor.recordInputAction();
                return;
            }

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
            const key = e.key === ' ' ? 'Space' : e.key;
            inputController.releaseFixedTickKey(key, e);

            // Block all input if settings modal is open
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal?.classList.contains('visible')) {
                return;
            }

            // Get current settings dynamically to pick up keybinding changes
            const currentSettings = getCurrentSettings();

            const action = Object.keys(currentSettings.keyBindings)
                .find((k) => currentSettings.keyBindings[k] === key);

            // Also check player 2 bindings (for local multiplayer)
            let actionP2 = null;
            if (currentSettings.player2KeyBindings) {
                actionP2 = Object.keys(currentSettings.player2KeyBindings)
                    .find((k) => currentSettings.player2KeyBindings[k] === key);
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
                || e.target.closest('[role="button"]')
                || e.target.closest('.key-input')
                || e.target.closest('select')
                || e.target.closest('input')
                || e.target.closest('.clickable')
                || e.target.closest('#demo-browser-modal')
                || e.target.closest('#serenity-hub-panel')
                || document.body?.classList?.contains('serenity-hub-open')
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
