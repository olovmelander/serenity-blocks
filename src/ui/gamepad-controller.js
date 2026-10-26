/**
 * @fileoverview Gamepad Controller for Serenity Blocks
 * Handles Xbox controllers and other Bluetooth gamepads
 * Supports up to 4 controllers for local multiplayer
 */

import { performanceMonitor } from '../utils/performance-monitor.js';
import { FOCUSABLE_SELECTOR, SpatialNavigation } from './spatial-navigation.js';
import { getInputMode, hasGamepadActivity, markInputMode } from './keystone/input-mode.js';
import {
    getOpenSheet, getSheetBackControl, getSheetFocusables, getSheetInitialFocus,
} from './sheet-input.js';
import { getTopLayerElement, goBackFromTopLayer } from './components/mp-sheet.js';
import { COLS, ROWS } from '../core/constants.js';
import { advanceDas, advanceSoftDrop } from '../core/das.js';
import { clearPlayerInput, enqueueInputEdge } from '../core/player-input-state.js';
import { createOdysseyShowcasePadControls } from './odyssey/odyssey-showcase-input.js';
import { createOdysseyMapPadControls } from './odyssey/odyssey-map-input.js';
import { createOdysseyCharmPadControls } from './odyssey/odyssey-charm-input.js';
import { isGameOverArmed } from './game-over-arm.js';

const INSTANT_DAS_REPEAT_LIMIT = COLS;
const INSTANT_SOFT_DROP_REPEAT_LIMIT = ROWS;
/** One menu press from two controllers this close together is one press (claimMenuAction). */
const MENU_PRESS_MERGE_MS = 60;
/** The stick's deadzone stays in this range whatever was saved: 0 let a resting stick drift. */
const MIN_DEADZONE = 0.1;
const MAX_DEADZONE = 0.9;

/**
 * Button mappings for standard gamepad (Xbox layout)
 * Based on the W3C Gamepad API standard mapping
 */
const BUTTON_MAP = {
    A: 0, // Bottom button (A on Xbox, Cross on PS)
    B: 1, // Right button (B on Xbox, Circle on PS)
    X: 2, // Left button (X on Xbox, Square on PS)
    Y: 3, // Top button (Y on Xbox, Triangle on PS)
    LB: 4, // Left bumper
    RB: 5, // Right bumper
    LT: 6, // Left trigger
    RT: 7, // Right trigger
    SELECT: 8, // Select/Back/Share button
    START: 9, // Start/Menu/Options button
    L_STICK: 10, // Left stick press
    R_STICK: 11, // Right stick press
    D_UP: 12, // D-pad up
    D_DOWN: 13, // D-pad down
    D_LEFT: 14, // D-pad left
    D_RIGHT: 15, // D-pad right
};

/**
 * Axis mappings for standard gamepad
 */
const AXIS_MAP = {
    LEFT_STICK_X: 0,
    LEFT_STICK_Y: 1,
    RIGHT_STICK_X: 2,
    RIGHT_STICK_Y: 3,
};

/** Buttons that play the game: pressed while looking around Infinity's tower, the view goes home. */
const EXPLORATION_GAME_BUTTONS = Object.freeze([
    BUTTON_MAP.A, BUTTON_MAP.B, BUTTON_MAP.X, BUTTON_MAP.Y, BUTTON_MAP.LB, BUTTON_MAP.RB,
    BUTTON_MAP.D_UP, BUTTON_MAP.D_DOWN, BUTTON_MAP.D_LEFT, BUTTON_MAP.D_RIGHT,
]);

/**
 * Default gamepad configuration for each player
 * (Used as fallback if custom bindings are not available)
 */
const DEFAULT_GAMEPAD_CONFIG = {
    moveLeft: { type: 'button', index: BUTTON_MAP.D_LEFT, axisNegative: AXIS_MAP.LEFT_STICK_X },
    moveRight: { type: 'button', index: BUTTON_MAP.D_RIGHT, axisPositive: AXIS_MAP.LEFT_STICK_X },
    rotateRight: { type: 'button', index: BUTTON_MAP.A },
    rotateLeft: { type: 'button', index: BUTTON_MAP.Y },
    flip: { type: 'button', index: BUTTON_MAP.X },
    softDrop: { type: 'button', index: BUTTON_MAP.D_DOWN, axisPositive: AXIS_MAP.LEFT_STICK_Y },
    hardDrop: { type: 'button', index: BUTTON_MAP.B },
    pause: { type: 'button', index: BUTTON_MAP.START },
};

const DEFAULT_SERENITY_GAMEPAD_BINDINGS = {
    toggleHub: BUTTON_MAP.Y,
    toggleBreathing: BUTTON_MAP.X,
    randomTheme: BUTTON_MAP.L_STICK,
    toggleFullscreen: BUTTON_MAP.R_STICK,
    previousTrack: BUTTON_MAP.LB,
    nextTrack: BUTTON_MAP.RB,
    volumeDown: BUTTON_MAP.LT,
    volumeUp: BUTTON_MAP.RT,
    toggleControlHints: BUTTON_MAP.SELECT,
    openSettings: BUTTON_MAP.START,
    previousBreathingTechnique: BUTTON_MAP.D_UP,
    nextBreathingTechnique: BUTTON_MAP.D_DOWN,
    confirmSelection: BUTTON_MAP.A,
    closeHub: BUTTON_MAP.B,
    navigateLeft: BUTTON_MAP.D_LEFT,
    navigateRight: BUTTON_MAP.D_RIGHT,
};

const GAMEPLAY_BINDING_ACTIONS = Object.freeze(Object.keys(DEFAULT_GAMEPAD_CONFIG));

function ownBindingsMatch(bindings, cached) {
    const snapshot = cached.values;
    let keyCount = 0;
    for (const key of Reflect.ownKeys(Object(bindings))) {
        if (!Object.prototype.propertyIsEnumerable.call(bindings, key)) continue;
        keyCount += 1;
        if (!Object.hasOwn(snapshot, key) || !Object.is(bindings[key], snapshot[key])) return false;
    }
    return keyCount === cached.keyCount;
}

/**
 * Convert custom bindings to gamepad config format
 */
function convertBindingsToConfig(bindings) {
    if (!bindings) return DEFAULT_GAMEPAD_CONFIG;

    return {
        moveLeft: { type: 'button', index: bindings.moveLeft ?? BUTTON_MAP.D_LEFT, axisNegative: AXIS_MAP.LEFT_STICK_X },
        moveRight: { type: 'button', index: bindings.moveRight ?? BUTTON_MAP.D_RIGHT, axisPositive: AXIS_MAP.LEFT_STICK_X },
        rotateRight: { type: 'button', index: bindings.rotateRight ?? BUTTON_MAP.A },
        rotateLeft: { type: 'button', index: bindings.rotateLeft ?? BUTTON_MAP.Y },
        flip: { type: 'button', index: bindings.flip ?? BUTTON_MAP.X },
        softDrop: { type: 'button', index: bindings.softDrop ?? BUTTON_MAP.D_DOWN, axisPositive: AXIS_MAP.LEFT_STICK_Y },
        hardDrop: { type: 'button', index: bindings.hardDrop ?? BUTTON_MAP.B },
        pause: { type: 'button', index: bindings.pause ?? BUTTON_MAP.START },
    };
}

/**
 * Gamepad Controller Manager
 * Handles gamepad connection, input polling, and action mapping
 */
export class GamepadController {
    constructor() {
        this.gamepads = [null, null, null, null]; // Support for 4 gamepads
        this.previousStates = [{}, {}, {}, {}]; // Previous button/axis states for edge detection
        this.odysseySheetElements = [null, null, null, null];
        // Gameplay buttons held while an Odyssey sheet or any menu owned the pad: they stay
        // latched after it lets go until released (preserveOdysseyInputRelease).
        this.odysseyHeldInputs = [null, null, null, null];
        this.menuOwners = [null, null, null, null]; // the menu that owned each pad last poll
        this.odysseyShowcaseControls = null;
        this.odysseyMapControls = null;
        this.odysseyCharmControls = null;
        // A panel over the board that owns the first pad while it wants it (the Stillfall
        // puzzle list): its process() returning true takes the whole poll from gameplay.
        this.panelControls = null;
        this.connected = [false, false, false, false];
        this.deadzone = 0.25; // Analog stick deadzone
        this.pollInterval = null;
        this.gameActions = null;
        this.enabled = false;
        this.fixedTickInputAdapter = null;
        this.fixedTickTouchedStates = Array.from({ length: 4 }, () => new Set());
        this.fixedTickHeldActions = Array.from({ length: 4 }, () => new Map());

        // Serenity Mode support
        this.serenityModeActive = false;
        this.serenityModeCallbacks = null;
        // RB / LB: the next or previous theme in play (src/ui/theme-keys.js)
        this.themeStepper = null;

        // DAS (Delayed Auto Shift) states for each gamepad
        this.dasState = [
            {
                left: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                right: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                down: { active: false, intervalAccumulators: 0 },
            },
            {
                left: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                right: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                down: { active: false, intervalAccumulators: 0 },
            },
            {
                left: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                right: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                down: { active: false, intervalAccumulators: 0 },
            },
            {
                left: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                right: {
                    active: false, delayAccumulators: 0, intervalAccumulators: 0, isRepeating: false,
                },
                down: { active: false, intervalAccumulators: 0 },
            },
        ];
        this.dasActions = [
            { left: null, right: null, down: null },
            { left: null, right: null, down: null },
            { left: null, right: null, down: null },
            { left: null, right: null, down: null },
        ];
        this.dasDelay = 120;
        this.dasInterval = 40;
        this.softDropInterval = 50;

        // Custom bindings for each player
        this.customBindings = [null, null, null, null];
        this.bindingConfigCache = [null, null, null, null];
        this.serenityBindingCache = null;

        // Menu navigation state
        this.menuNavigationEnabled = false;
        // A direction held in a menu repeats: once on the press, then after this delay at
        // this rate (menuDirectionFires), as on the Odyssey map and the Stillfall atlas.
        // Without it a long list took one press per row.
        this.menuNavigationRepeatDelay = 420; // ms before repeat starts
        this.menuNavigationRepeatInterval = 180; // ms between repeats
        this.menuRepeat = [{}, {}, {}, {}];

        // Game mode selection state
        this.gameModeSelectionEnabled = false;
        this.gameModeCards = [];
        this.selectedGameModeIndex = -1;

        // Callback functions
        this.onPauseCallback = null;
        this.onResumeCallback = null;
        this.handleGamepadConnected = (event) => this.onGamepadConnected(event);
        this.handleGamepadDisconnected = (event) => this.onGamepadDisconnected(event);
        this.handleVisibilityChange = () => {
            if (document.hidden) {
                this.clearAllDasTimers();
            }
        };
        this.isInitialized = false;
        // Gate menu toggles until Start is released after a press
        this.waitingForStartRelease = [false, false, false, false];
        this.selectEditState = {
            active: false,
            element: null,
            overlay: null,
            highlightIndex: -1,
            originalIndex: -1,
            options: [],
            cleanup: null,
        };

        console.log('[Gamepad] Controller manager initialized');
    }

    /**
     * Initialize gamepad support
     * Sets up connection event listeners
     */
    initialize() {
        if (!navigator.getGamepads) {
            console.warn('[Gamepad] Gamepad API not supported in this browser');
            return false;
        }

        if (this.isInitialized) {
            this.checkConnectedGamepads();
            return true;
        }

        // Listen for gamepad connections
        window.addEventListener('gamepadconnected', this.handleGamepadConnected);
        window.addEventListener('gamepaddisconnected', this.handleGamepadDisconnected);

        // Clear DAS timers when tab loses focus (gamepad polling stops but timers persist)
        document.addEventListener('visibilitychange', this.handleVisibilityChange);

        // Check for already connected gamepads
        this.checkConnectedGamepads();

        this.isInitialized = true;
        console.log('[Gamepad] Gamepad support initialized');
        return true;
    }

    /**
     * Check for already connected gamepads on initialization
     */
    checkConnectedGamepads() {
        const gamepads = navigator.getGamepads();
        const activeSlots = new Set();

        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad) continue;

            const slot = this.assignGamepadToSlot(gamepad);
            if (slot !== -1) {
                activeSlots.add(slot);
            }
        }

        for (let slot = 0; slot < this.gamepads.length; slot++) {
            if (!activeSlots.has(slot) && this.connected[slot]) {
                this.handleSlotDisconnect(slot);
            }
        }
    }

    /**
     * Assign a connected gamepad to a slot
     * @param {Gamepad} gamepad - Connected gamepad
     * @returns {number} Slot index or -1 if no slot available
     */
    assignGamepadToSlot(gamepad) {
        if (!gamepad) return -1;

        // Check if this gamepad is already tracked
        let slot = this.gamepads.findIndex((existing) => existing && existing.index === gamepad.index);
        if (slot === -1) {
            slot = this.connected.findIndex((isConnected) => !isConnected);
        }

        if (slot === -1) {
            console.warn(`[Gamepad] Maximum controllers (${this.gamepads.length}) already connected`);
            return -1;
        }

        const wasConnected = this.connected[slot];
        this.gamepads[slot] = gamepad;
        this.connected[slot] = true;
        if (!this.previousStates[slot]) {
            this.previousStates[slot] = {};
        }

        if (!wasConnected) {
            this.clearDasTimers(slot);
            console.log(`[Gamepad] Controller ${slot + 1} connected:`, gamepad.id);
            window.dispatchEvent(new CustomEvent('gamepadStatusChanged', {
                detail: {
                    slot,
                    connected: true,
                    name: gamepad.id,
                },
            }));

            // Update game mode card focus if in selection mode
            if (this.gameModeSelectionEnabled && this.gameModeCards) {
                this.updateGameModeCardFocus();
            }
        }

        if (!this.pollInterval && this.enabled) {
            this.startPolling();
        }

        return slot;
    }

    /**
     * Cleanup when a gamepad slot disconnects
     * @param {number} slot - Slot index
     */
    handleSlotDisconnect(slot) {
        const gamepad = this.gamepads[slot];
        if (gamepad) {
            console.log(`[Gamepad] Controller ${slot + 1} disconnected:`, gamepad.id);
        }

        this.gamepads[slot] = null;
        this.connected[slot] = false;
        this.previousStates[slot] = {};
        this.odysseySheetElements[slot] = null;
        this.odysseyHeldInputs[slot] = null;
        this.menuOwners[slot] = null;
        if (slot === 0) {
            this.odysseyShowcaseControls?.reset();
            this.odysseyMapControls?.reset();
            this.odysseyCharmControls?.reset();
        }
        this.clearFixedTickInput({ dropPhysicalLatches: true, slot });
        this.clearDasTimers(slot);

        window.dispatchEvent(new CustomEvent('gamepadStatusChanged', {
            detail: {
                slot,
                connected: false,
            },
        }));

        // Update game mode card focus if in selection mode
        if (this.gameModeSelectionEnabled && this.gameModeCards) {
            this.updateGameModeCardFocus();
        }

        if (!this.connected.some(Boolean)) {
            this.stopPolling();
        }
    }

    /**
     * Force refresh of connected gamepads (manual rescan)
     */
    rescan() {
        this.checkConnectedGamepads();
    }

    /**
     * Handle gamepad connection
     */
    onGamepadConnected(event) {
        const { gamepad } = event;
        this.assignGamepadToSlot(gamepad);
    }

    /**
     * Handle gamepad disconnection
     */
    onGamepadDisconnected(event) {
        const { gamepad } = event;

        // Find which slot this gamepad was in
        const slot = this.gamepads.findIndex((existing) => existing && existing.index === gamepad.index);
        if (slot !== -1) {
            this.handleSlotDisconnect(slot);
        }
    }

    /**
     * Set game actions for input handling
     */
    setGameActions(gameActions) {
        this.gameActions = gameActions;
    }

    setFixedTickInputAdapter(adapter = null) {
        this.clearFixedTickInput();
        for (let slot = 0; slot < this.dasState.length; slot += 1) {
            this.clearDasTimers(slot);
        }
        this.fixedTickInputAdapter = adapter
            && typeof adapter.isEnabled === 'function'
            && typeof adapter.resolveGameState === 'function'
            ? adapter
            : null;
    }

    resolveFixedTickOwnership(slot) {
        const adapter = this.fixedTickInputAdapter;
        if (!adapter) return { claimed: false, gameState: null };

        let gameState = null;
        try {
            gameState = adapter.resolveGameState(slot) || null;
            return {
                claimed: adapter.isEnabled({ playerIndex: slot, gameState }) === true,
                gameState,
            };
        } catch (error) {
            console.error('[Gamepad] Fixed-tick input adapter failed:', error);
            return { claimed: true, gameState: null };
        }
    }

    isFixedTickPlayerClaimed(slot) {
        return this.resolveFixedTickOwnership(slot).claimed;
    }

    getFixedTickStamp(gameState, slot) {
        const adapter = this.fixedTickInputAdapter;
        const fallback = {
            tick: Math.max(0, Math.floor(Number(gameState?.simFrame) || 0)) + 1,
            subframe: 0,
        };
        if (typeof adapter?.stamp !== 'function') return fallback;

        try {
            const stamp = adapter.stamp({
                gameState, playerIndex: slot, fallback,
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
            console.error('[Gamepad] Fixed-tick input stamp failed:', error);
            return fallback;
        }
    }

    acceptFixedTickSource(gameState, slot) {
        const { fixedTickInputAdapter: adapter } = this;
        if (typeof adapter?.acceptSource !== 'function') return true;
        try {
            return adapter.acceptSource({ gameState, playerIndex: slot }) === true;
        } catch (error) {
            console.error('[Gamepad] Fixed-tick source policy failed:', error);
            return false;
        }
    }

    releaseFixedTickSource(slot) {
        const { fixedTickInputAdapter: adapter } = this;
        if (typeof adapter?.releaseSource !== 'function') return;
        try {
            adapter.releaseSource({ playerIndex: slot });
        } catch (error) {
            console.error('[Gamepad] Fixed-tick source release failed:', error);
        }
    }

    enqueueFixedTickEdge(gameState, slot, action, value, phase) {
        if (!gameState?.playerInput) return null;
        const edge = enqueueInputEdge(gameState.playerInput, {
            ...this.getFixedTickStamp(gameState, slot),
            action,
            value,
            phase,
        });
        this.fixedTickTouchedStates[slot].add(gameState.playerInput);
        return edge;
    }

    pressFixedTickAction(slot, holdKey, action, value) {
        const { claimed, gameState } = this.resolveFixedTickOwnership(slot);
        if (!claimed) return { handled: false, accepted: false };
        const held = this.fixedTickHeldActions[slot];
        if (holdKey && held.has(holdKey)) return { handled: true, accepted: false };
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
            if (holdKey) {
                held.set(holdKey, {
                    gameState, action, value, cleared: true,
                });
            }
            return { handled: true, accepted: false };
        }
        if (!this.acceptFixedTickSource(gameState, slot)) {
            if (holdKey) {
                held.set(holdKey, {
                    gameState, action, value, cleared: true,
                });
            }
            return { handled: true, accepted: false };
        }

        const edge = this.enqueueFixedTickEdge(gameState, slot, action, value, 'down');
        if (holdKey) {
            held.set(holdKey, {
                gameState, action, value, cleared: !edge,
            });
        }
        return { handled: true, accepted: Boolean(edge) };
    }

    releaseFixedTickAction(slot, holdKey) {
        const held = this.fixedTickHeldActions[slot];
        const record = held.get(holdKey);
        held.delete(holdKey);
        if (!record) {
            return {
                handled: this.resolveFixedTickOwnership(slot).claimed,
                accepted: false,
            };
        }
        if (record.cleared || !record.gameState?.playerInput) {
            return { handled: true, accepted: false };
        }

        const ownership = this.resolveFixedTickOwnership(slot);
        if (!ownership.claimed || ownership.gameState !== record.gameState) {
            clearPlayerInput(record.gameState.playerInput);
            return { handled: true, accepted: false };
        }
        const edge = this.enqueueFixedTickEdge(
            record.gameState,
            slot,
            record.action,
            record.value,
            'up',
        );
        return { handled: true, accepted: Boolean(edge) };
    }

    clearFixedTickInput({ dropPhysicalLatches = false, slot = null } = {}) {
        const slots = Number.isInteger(slot)
            ? [slot]
            : this.fixedTickTouchedStates.map((_, index) => index);
        slots.forEach((slotIndex) => {
            this.fixedTickTouchedStates[slotIndex].forEach((state) => clearPlayerInput(state));
            this.fixedTickTouchedStates[slotIndex].clear();
            this.releaseFixedTickSource(slotIndex);
        });
        slots.map((slotIndex) => this.fixedTickHeldActions[slotIndex]).forEach((held) => {
            if (dropPhysicalLatches) held.clear();
            else held.forEach((record) => { record.cleared = true; });
        });
    }

    /**
     * Set pause/resume callbacks
     */
    setPauseCallbacks(onPause, onResume) {
        this.onPauseCallback = onPause;
        this.onResumeCallback = onResume;
    }

    /**
     * Enable gamepad input
     */
    enable() {
        this.enabled = true;
        if (this.connected.some(Boolean) && !this.pollInterval) {
            this.startPolling();
        }
    }

    /**
     * Disable gamepad input
     */
    disable() {
        this.enabled = false;
        this.stopPolling();
        this.clearAllDasTimers();
        this.lastGameplayTime = null;
    }

    /**
     * Start polling gamepads
     */
    startPolling() {
        if (this.pollInterval) return;

        this.lastPollTime = performance.now();
        const loop = (timestamp) => {
            this.lastPollTime = timestamp;
            this.poll();
            this.pollInterval = requestAnimationFrame(loop);
        };

        this.pollInterval = requestAnimationFrame(loop);

        console.log('[Gamepad] Started polling via requestAnimationFrame');
    }

    /**
     * Stop polling gamepads
     */
    stopPolling() {
        if (this.pollInterval) {
            cancelAnimationFrame(this.pollInterval);
            this.pollInterval = null;
            console.log('[Gamepad] Stopped polling');
        }
    }

    /**
     * Poll connected gamepads and process input
     */
    poll() {
        if (!this.enabled) return;

        const gamepads = navigator.getGamepads();

        // Chromium keeps reporting pads while the window is in the background: presses
        // made in another app moved pieces and closed the pause sheet. While unfocused
        // nothing acts and held input lets go; back in focus, what is still held waits
        // for its release.
        const focused = typeof document === 'undefined' || typeof document.hasFocus !== 'function'
            || document.hasFocus();
        if (!focused) {
            if (!this.windowUnfocused) {
                this.windowUnfocused = true;
                for (let slot = 0; slot < this.gamepads.length; slot++) {
                    this.clearFixedTickInput({ dropPhysicalLatches: true, slot });
                    this.clearDasTimers(slot);
                }
            }
            return;
        }
        if (this.windowUnfocused) {
            this.windowUnfocused = false;
            for (let slot = 0; slot < this.gamepads.length; slot++) {
                const fresh = this.connected[slot] && this.gamepads[slot] ? gamepads[this.gamepads[slot].index] : null;
                if (fresh) this.latchAllHeld(fresh, slot);
            }
            return;
        }

        for (let slot = 0; slot < this.gamepads.length; slot++) {
            if (!this.connected[slot]) continue;

            const gamepad = this.gamepads[slot];
            if (!gamepad) continue;

            // Get fresh gamepad state
            const freshGamepad = gamepads[gamepad.index];
            if (!freshGamepad) continue;
            if (getInputMode() !== 'gamepad' && hasGamepadActivity(freshGamepad, this.deadzone)) {
                markInputMode('gamepad');
            }

            if (this.odysseyShowcaseControls?.process(freshGamepad, slot)) continue;
            // An orb's charms on spare buttons; the ordinary gameplay poll still runs this frame.
            this.odysseyCharmControls?.process(freshGamepad, slot);
            if (this.panelControls?.process(freshGamepad, slot)) continue;

            // The Serenity Hub is a top-layer input owner. Start/game-over
            // modals and game-mode cards can remain visible underneath it, so
            // routing A/B/Start to those first can restart or replace the
            // active game while the player is confirming a theme selection.
            const hubIsOpen = this.serenityModeActive
                && this.serenityModeCallbacks
                && this.serenityModeCallbacks.isHubOpen?.() === true;
            if (hubIsOpen) {
                this.processGamepadInput(freshGamepad, slot);

                // A Hub action can close the panel during this call (notably B).
                // Latch the same physical buttons for the hidden modal/menu
                // owners so a still-held close/confirm press cannot become a
                // fresh restart or game-mode activation on the next poll.
                const previousState = this.previousStates[slot];
                const mainButtons = [
                    BUTTON_MAP.A,
                    BUTTON_MAP.B,
                    BUTTON_MAP.X,
                    BUTTON_MAP.Y,
                    BUTTON_MAP.START,
                ];
                previousState.gameOverButton = mainButtons.some(
                    (buttonIndex) => freshGamepad.buttons[buttonIndex]?.pressed,
                );
                previousState.gameOverBack = freshGamepad.buttons[BUTTON_MAP.B]?.pressed;
                previousState.gameModeSelect = freshGamepad.buttons[BUTTON_MAP.A]?.pressed;
                previousState.gameModeBack = freshGamepad.buttons[BUTTON_MAP.B]?.pressed;
                // ...and for the menu and the game: B that closes the Hub over a menu must
                // not also close that menu, nor hard-drop when it closes over a run; A
                // that confirms must not also rotate.
                this.latchMenuButtons(freshGamepad, slot);
                this.odysseyHeldInputs[slot] = this.getGameplayPressedState(freshGamepad, slot);
                continue;
            }

            // Defensive DOM fallback for the short interval where the panel is
            // open but its controller callbacks are not yet available.
            if (document.body?.classList?.contains('serenity-hub-open')) {
                continue;
            }

            const menuSheet = this.getMenuSheet();
            if (menuSheet?.sheet.odyssey) {
                this.processOdysseySheetInput(freshGamepad, slot, menuSheet);
                continue;
            }
            this.odysseySheetElements[slot] = null;
            // The Odyssey map: D-pad and stick step the path, A plays; Start still falls through.
            this.odysseyMapControls?.process(freshGamepad, slot);

            // Check for game over modal - any button press restarts (only for player 1)
            if (slot === 0) {
                const gameOverModal = document.getElementById('game-over-modal');
                if (gameOverModal && gameOverModal.classList.contains('visible')) {
                    this.processGameOverInput(freshGamepad, slot);
                    continue; // Don't process other input while game over modal is visible
                }
                this.previousStates[slot].gameOverArmed = false;
            }

            // Process game mode selection, menu navigation, or game input. A sheet open
            // over the main menu (Settings, Records, Replays) owns the pad: without this
            // the D-pad walked the mode list behind it and A could start a game.
            if (this.gameModeSelectionEnabled && !menuSheet) {
                this.processGameModeSelection(freshGamepad, slot);
            } else if (this.menuNavigationEnabled || menuSheet) {
                this.processMenuOwnedInput(freshGamepad, slot, menuSheet);
            } else {
                this.menuOwners[slot] = null;
                // Always check for Start button to open settings, even without gameActions
                this.processGamepadInput(freshGamepad, slot);
            }
        }
    }

    /** Physical gameplay state, including custom bindings and the analogue stick. */
    getGameplayPressedState(gamepad, slot) {
        const config = this.getGameplayBindingConfig(slot);
        const pressed = {};
        for (const action of GAMEPLAY_BINDING_ACTIONS) {
            pressed[action] = Boolean(this.isButtonPressed(gamepad, config[action]));
        }
        pressed.moveLeft ||= this.isAxisNegative(gamepad, config.moveLeft.axisNegative);
        pressed.moveRight ||= this.isAxisPositive(gamepad, config.moveRight.axisPositive);
        pressed.softDrop ||= this.isAxisPositive(gamepad, config.softDrop.axisPositive);
        pressed.menuStart = Boolean(gamepad.buttons[BUTTON_MAP.START]?.pressed);
        return pressed;
    }

    setOdysseyShowcaseControls(callbacks) {
        const controls = createOdysseyShowcasePadControls(this, callbacks);
        this.odysseyShowcaseControls = controls;
        controls.dispose = () => {
            if (this.odysseyShowcaseControls === controls) this.odysseyShowcaseControls = null;
        };
        return controls;
    }

    /** One attempt's charms on the first controller's spare buttons; dispose() releases them. */
    setOdysseyCharmControls(callbacks) {
        const controls = createOdysseyCharmPadControls(this, callbacks);
        this.odysseyCharmControls = controls;
        controls.dispose = () => {
            if (this.odysseyCharmControls === controls) this.odysseyCharmControls = null;
        };
        return controls;
    }

    /** A board panel's pad owner (see panelControls); dispose() releases it. */
    setPanelControls(controls) {
        this.panelControls = controls;
        controls.dispose = () => {
            if (this.panelControls === controls) this.panelControls = null;
        };
        return controls;
    }

    /** The Odyssey map on the first controller: D-pad and stick travel, A plays. */
    setOdysseyMapControls(callbacks) {
        const controls = createOdysseyMapPadControls(this, callbacks);
        this.odysseyMapControls = controls;
        controls.dispose = () => {
            if (this.odysseyMapControls === controls) this.odysseyMapControls = null;
        };
        return controls;
    }

    /** A completed orb owns the pad; its finishing press cannot also choose a destination. */
    processOdysseySheetInput(gamepad, slot, open) {
        this.odysseyHeldInputs[slot] = this.getGameplayPressedState(gamepad, slot);
        // The transparent portal/Ready cue still owns input until the next board
        // is ready. Its inert controls cannot receive focus or activate, but Start
        // must not open Settings behind it and held buttons must remain latched.
        if (open.element.inert) {
            this.odysseySheetElements[slot] = null;
            this.clearFixedTickInput({ slot });
            this.clearDasTimers(slot);
            return;
        }
        if (slot === 0 && !open.element.contains(document.activeElement)) {
            getSheetInitialFocus(open.sheet, open.element)?.focus({ preventScroll: true });
        }
        if (this.odysseySheetElements[slot] !== open.element) {
            this.odysseySheetElements[slot] = open.element;
            this.clearFixedTickInput({ slot });
            this.clearDasTimers(slot);
            this.latchMenuButtons(gamepad, slot);
            return;
        }
        this.processMenuNavigation(gamepad, slot, { blockGlobalShortcuts: true });
    }

    /**
     * Whether a menu direction acts this poll: on the press, then while it is held after
     * menuNavigationRepeatDelay, every menuNavigationRepeatInterval. A direction already
     * held when the menu took the pad (latched) waits for its release and never repeats.
     * @param {number} slot
     * @param {string} key previousStates flag (menuUp, gameModeDown...)
     * @param {boolean} pressed
     * @param {boolean} wasPressed
     */
    menuDirectionFires(slot, key, pressed, wasPressed) {
        const holds = this.menuRepeat[slot] || (this.menuRepeat[slot] = {});
        if (!pressed) {
            delete holds[key];
            return false;
        }
        const now = performance.now();
        if (!wasPressed) {
            holds[key] = { next: now + this.menuNavigationRepeatDelay };
            return true;
        }
        const hold = holds[key];
        if (!hold) {
            holds[key] = { latched: true };
            return false;
        }
        if (hold.latched || now < hold.next) return false;
        hold.next = now + this.menuNavigationRepeatInterval;
        return true;
    }

    /**
     * Everything held now waits for its release: the menu buttons, the game's, Start and
     * the main menu's. For a press that changes what owns the pad (a restart, the window
     * coming back to the front), whichever owner comes next.
     */
    latchAllHeld(gamepad, slot) {
        this.latchMenuButtons(gamepad, slot);
        this.odysseyHeldInputs[slot] = this.getGameplayPressedState(gamepad, slot);
        const previous = this.previousStates[slot];
        const down = (index) => Boolean(gamepad.buttons[index]?.pressed);
        Object.assign(previous, {
            gameOverButton: [BUTTON_MAP.A, BUTTON_MAP.B, BUTTON_MAP.X, BUTTON_MAP.Y, BUTTON_MAP.START].some(down),
            gameOverBack: down(BUTTON_MAP.B),
            gameModeSelect: down(BUTTON_MAP.A),
            gameModeBack: down(BUTTON_MAP.B),
            gameModeStart: down(BUTTON_MAP.START),
            gameModeUp: previous.menuUp,
            gameModeDown: previous.menuDown,
            gameModeLeft: previous.menuLeft,
            gameModeRight: previous.menuRight,
        });
        if (down(BUTTON_MAP.START)) this.waitingForStartRelease[slot] = true;
    }

    /** Mark every menu button held now as already down, so it acts only after a release. */
    latchMenuButtons(gamepad, slot) {
        this.menuRepeat[slot] = {};
        const previous = this.previousStates[slot];
        const buttons = {
            menuUp: BUTTON_MAP.D_UP,
            menuDown: BUTTON_MAP.D_DOWN,
            menuLeft: BUTTON_MAP.D_LEFT,
            menuRight: BUTTON_MAP.D_RIGHT,
            menuLB: BUTTON_MAP.LB,
            menuRB: BUTTON_MAP.RB,
            menuSelect: BUTTON_MAP.A,
            menuBack: BUTTON_MAP.B,
            menuStart: BUTTON_MAP.START,
        };
        for (const [key, index] of Object.entries(buttons)) {
            previous[key] = Boolean(gamepad.buttons[index]?.pressed);
        }
        previous.menuUp ||= this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_Y);
        previous.menuDown ||= this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_Y);
        previous.menuLeft ||= this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_X);
        previous.menuRight ||= this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_X);
    }

    /**
     * A menu (Settings, the pause sheet, local results, the lobby screens) owns the pad.
     * Buttons held when it takes over or lets go stay latched until released. B or A that
     * closes the pause sheet used to also hard-drop or rotate on the next poll, and a mash
     * at a knock-out could choose on a results screen that had just appeared (audit
     * INPUT-03).
     */
    processMenuOwnedInput(gamepad, slot, menuSheet) {
        // Kept current while the menu is up; gameplay holds these until they are released.
        this.odysseyHeldInputs[slot] = this.getGameplayPressedState(gamepad, slot);
        const owner = menuSheet?.element || 'menu';
        if (this.menuOwners[slot] !== owner) {
            // The first poll of a new menu only latches what is already held.
            this.menuOwners[slot] = owner;
            this.latchMenuButtons(gamepad, slot);
            return;
        }
        this.processMenuNavigation(gamepad, slot);
    }

    /** Menu resets cannot turn a held confirmation or direction into a new gameplay press. */
    preserveOdysseyInputRelease(gamepad, slot) {
        const held = this.odysseyHeldInputs[slot];
        if (!held) return;
        const pressed = this.getGameplayPressedState(gamepad, slot);
        let waiting = false;
        for (const action of Object.keys(held)) {
            if (held[action] && pressed[action]) {
                this.previousStates[slot][action] = true;
                waiting = true;
            } else {
                held[action] = false;
            }
        }
        if (!waiting) this.odysseyHeldInputs[slot] = null;
    }

    advanceGameplayInput(timestamp = performance.now()) {
        if (this.lastGameplayTime === timestamp) return;
        const delta = Math.max(0, Math.min(100, timestamp - (this.lastGameplayTime ?? timestamp)));
        this.lastGameplayTime = timestamp;

        if (!this.enabled || !this.gameActions) return;

        for (let slot = 0; slot < this.gamepads.length; slot++) {
            if (!this.connected[slot]) continue;
            this.processDasTimers(slot, delta);
        }
    }

    /**
     * Process gamepad input when game over modal is visible.
     * B goes to the main menu (like Escape on the sheet); A, X, Y or Start play again.
     */
    processGameOverInput(gamepad, slot) {
        const prevState = this.previousStates[slot];

        const aPressed = gamepad.buttons[BUTTON_MAP.A]?.pressed;
        const bPressed = Boolean(gamepad.buttons[BUTTON_MAP.B]?.pressed);
        const xPressed = gamepad.buttons[BUTTON_MAP.X]?.pressed;
        const yPressed = gamepad.buttons[BUTTON_MAP.Y]?.pressed;
        const startPressed = gamepad.buttons[BUTTON_MAP.START]?.pressed;

        const anyButtonPressed = aPressed || bPressed || xPressed || yPressed || startPressed;
        const wasAnyButtonPressed = prevState.gameOverButton;

        // The first poll with the sheet up only latches: a button still held from play
        // (rotate is often B) must be released and pressed again.
        if (!prevState.gameOverArmed) {
            prevState.gameOverArmed = true;
            prevState.gameOverBack = bPressed;
            prevState.gameOverButton = anyButtonPressed;
            return;
        }

        // A press as the sheet opens is still play (rotate is often B): only track it (LIFE-12).
        if (!isGameOverArmed(document.getElementById('game-over-modal'))) {
            prevState.gameOverBack = bPressed;
            prevState.gameOverButton = anyButtonPressed;
            return;
        }

        if (bPressed && !prevState.gameOverBack && !wasAnyButtonPressed) {
            prevState.gameOverBack = true;
            prevState.gameOverButton = anyButtonPressed;
            this.latchAllHeld(gamepad, slot);
            document.getElementById('game-over-main-menu')?.click();
            return;
        }
        prevState.gameOverBack = bPressed;

        // Trigger restart on button press (rising edge)
        if (anyButtonPressed && !bPressed && !wasAnyButtonPressed) {
            console.log('[Gamepad] Button pressed on game over screen - restarting');
            // The press that restarts is not the new run's first move: Start reopened
            // Settings over it, and A, X or Y rotated the first piece.
            this.latchAllHeld(gamepad, slot);

            // Call the global startGame function if available
            if (window.startGame) {
                window.startGame();
            } else {
                // Fallback: dispatch a custom event
                window.dispatchEvent(new CustomEvent('gamepadRestart'));
            }
        }

        prevState.gameOverButton = anyButtonPressed;
    }

    /**
     * Enable game mode selection mode
     */
    enableGameModeSelection() {
        this.gameModeSelectionEnabled = true;
        console.log('[Gamepad] Game mode selection enabled');

        // Get all game mode cards
        this.gameModeCards = Array.from(document.querySelectorAll('.game-mode-card'));

        // Make cards focusable
        this.gameModeCards.forEach((card) => {
            const isDisabled = this.isGameModeCardDisabled(card);
            card.setAttribute('tabindex', isDisabled ? '-1' : '0');
        });

        // Clear all previous button states
        for (let i = 0; i < this.previousStates.length; i++) {
            this.previousStates[i] = {};
            this.menuRepeat[i] = {};
        }

        // Focus the first card or the previously selected one
        if (this.isAnyGamepadConnected() && this.gameModeCards.length > 0) {
            // Default to first card if no selection
            // const index = this.selectedGameModeIndex >= 0 ? this.selectedGameModeIndex : 0;
            // Don't auto-focus immediately to avoid overriding mouse/hover state
            // The first input will trigger focus
            // this.selectedGameModeIndex = index;
        }
    }

    /**
     * Disable game mode selection mode
     */
    disableGameModeSelection() {
        this.gameModeSelectionEnabled = false;
        console.log('[Gamepad] Game mode selection disabled');

        // Remove focus from all cards
        this.gameModeCards.forEach((card) => {
            card.classList.remove('gamepad-focused');
        });

        // Clear all previous button states
        for (let i = 0; i < this.previousStates.length; i++) {
            this.previousStates[i] = {};
            this.menuRepeat[i] = {};
        }
    }

    /**
     * Update visual focus on game mode cards
     */
    updateGameModeCardFocus() {
        // Only update focus if a gamepad is connected
        if (!this.isAnyGamepadConnected()) {
            // Remove all focus if no gamepad connected
            this.gameModeCards.forEach((card) => {
                card.classList.remove('gamepad-focused');
            });
            return;
        }

        this.gameModeCards.forEach((card, index) => {
            if (index === this.selectedGameModeIndex) {
                card.classList.add('gamepad-focused');
            } else {
                card.classList.remove('gamepad-focused');
            }
        });
    }

    isGameModeCardDisabled(card) {
        return !card
            || card.dataset?.disabled === 'true'
            || card.classList.contains('steam-disabled');
    }

    findNextEnabledCard(current, direction, container) {
        if (!current) return null;
        let candidate = SpatialNavigation.findNextElement(current, direction, container);
        const maxTries = this.gameModeCards.length;
        let tries = 0;
        while (candidate && candidate.classList.contains('game-mode-card') && this.isGameModeCardDisabled(candidate)) {
            tries += 1;
            if (tries >= maxTries) {
                return null;
            }
            candidate = SpatialNavigation.findNextElement(candidate, direction, container);
        }
        return candidate && candidate.classList.contains('game-mode-card') ? candidate : null;
    }

    /**
     * Check if any gamepad is currently connected
     */
    isAnyGamepadConnected() {
        return this.connected.some((isConnected) => isConnected);
    }

    /**
     * Process gamepad input for game mode selection
     */
    processGameModeSelection(gamepad, slot) {
        const prevState = this.previousStates[slot];

        // Every controller walks the menu; one press acts once (claimMenuAction).

        // Get current focused element
        let current = document.activeElement;

        // Check for direction inputs
        const leftPressed = gamepad.buttons[BUTTON_MAP.D_LEFT]?.pressed
            || this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_X);
        const rightPressed = gamepad.buttons[BUTTON_MAP.D_RIGHT]?.pressed
            || this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_X);
        const upPressed = gamepad.buttons[BUTTON_MAP.D_UP]?.pressed
            || this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_Y);
        const downPressed = gamepad.buttons[BUTTON_MAP.D_DOWN]?.pressed
            || this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_Y);

        // Check for Select button (A)
        const aPressed = gamepad.buttons[BUTTON_MAP.A]?.pressed;
        const bPressed = Boolean(gamepad.buttons[BUTTON_MAP.B]?.pressed);

        // The menu: the mode list, its stage (Play) and the dock (Hub, Records, Replays,
        // Settings, Quit). The pad walks all of it as the arrow keys do (main-menu.js).
        const menuRoot = document.getElementById('start-modal') || document.body;
        const stage = menuRoot.querySelector?.('.sb-stage') || null;
        const isCard = (element) => Boolean(element?.classList?.contains('game-mode-card'));
        const inMenu = (element) => Boolean(element && element !== document.body && menuRoot.contains(element));
        const currentCard = () => this.gameModeCards[this.selectedGameModeIndex]
            || this.gameModeCards.find((card) => card.classList.contains('is-current'))
            || null;

        // Ensure we are focused inside the menu
        if (!inMenu(current)) {
            // If any direction or Select is pressed, focus the selected/default card
            if ((leftPressed || rightPressed || upPressed || downPressed || aPressed) && this.gameModeCards.length > 0) {
                const index = this.selectedGameModeIndex >= 0 ? this.selectedGameModeIndex : 0;
                let candidate = this.gameModeCards[index];
                if (this.isGameModeCardDisabled(candidate)) {
                    candidate = this.gameModeCards.find((card) => !this.isGameModeCardDisabled(card)) || null;
                }
                if (candidate) {
                    candidate.focus();
                    this.selectedGameModeIndex = this.gameModeCards.indexOf(candidate);
                    current = candidate;
                }
            }
        }

        // Helper to handle navigation
        const handleDirection = (direction, pressed, prevKey) => {
            if (!this.menuDirectionFires(slot, prevKey, pressed, Boolean(prevState[prevKey]))
                || !this.claimMenuAction(slot, direction)) return pressed;
            if (isCard(current)) {
                // Right goes to the stage's Play, as the → key does.
                const play = direction === 'right' ? stage?.querySelector('[data-action="play"]') : null;
                if (play && play.offsetParent !== null) {
                    play.focus();
                    current = play;
                    return pressed;
                }
                const container = document.querySelector('.game-mode-cards-container') || document.body;
                const next = this.findNextEnabledCard(current, direction, container);
                if (next) {
                    next.focus();
                    this.selectedGameModeIndex = this.gameModeCards.indexOf(next);
                    current = next;
                }
                return pressed;
            }
            if (!inMenu(current)) return pressed;
            // Left from the stage goes back to the mode it shows, as the ← key does.
            if (direction === 'left' && stage?.contains(current)) {
                const card = currentCard();
                if (card) {
                    card.focus();
                    current = card;
                    return pressed;
                }
            }
            const next = SpatialNavigation.findNextElement(current, direction, menuRoot);
            if (next && !(isCard(next) && this.isGameModeCardDisabled(next))) {
                next.focus();
                next.scrollIntoView?.({ block: 'nearest' });
                if (isCard(next)) this.selectedGameModeIndex = this.gameModeCards.indexOf(next);
                current = next;
            }
            return pressed;
        };

        // D-pad / Left stick navigation
        prevState.gameModeLeft = handleDirection('left', leftPressed, 'gameModeLeft');
        prevState.gameModeRight = handleDirection('right', rightPressed, 'gameModeRight');
        prevState.gameModeUp = handleDirection('up', upPressed, 'gameModeUp');
        prevState.gameModeDown = handleDirection('down', downPressed, 'gameModeDown');

        // A button - Select game mode, or press the focused Play / dock button
        if (aPressed && !prevState.gameModeSelect && this.claimMenuAction(slot, 'select')) {
            if (isCard(current)) {
                if (this.isGameModeCardDisabled(current)) {
                    prevState.gameModeSelect = aPressed;
                    return;
                }
                console.log('[Gamepad] Selecting game mode card:', current.id);
                current.click();
            } else if (inMenu(current) && current.getAttribute?.('aria-disabled') !== 'true') {
                current.click();
            }
        }
        prevState.gameModeSelect = aPressed;

        // B button - from the stage or the dock, back to the mode list
        if (bPressed && !prevState.gameModeBack && inMenu(current) && !isCard(current)
            && this.claimMenuAction(slot, 'back')) {
            currentCard()?.focus();
        }
        prevState.gameModeBack = bPressed;

        // START button - Open settings
        const startPressed = gamepad.buttons[BUTTON_MAP.START]?.pressed;
        if (this.waitingForStartRelease[slot]) {
            if (!startPressed) {
                this.waitingForStartRelease[slot] = false;
            }
        } else if (startPressed && !prevState.gameModeStart && this.claimMenuAction(slot, 'start')) {
            console.log('[Gamepad] START pressed in game mode selection - opening settings');
            this.toggleSettings(slot);
        }
        prevState.gameModeStart = startPressed;

        // SELECT button - Toggle Serenity Hub (if available)
        if (this.serenityModeActive && this.serenityModeCallbacks) {
            const selectPressed = gamepad.buttons[BUTTON_MAP.SELECT]?.pressed;
            const wasSelectPressed = prevState.gameModeSelect_hub;

            // Check cooldown to prevent double-triggering
            const now = performance.now();
            if (!this._serenitySelectCooldown) this._serenitySelectCooldown = 0;
            const cooldownActive = now - this._serenitySelectCooldown < 500;

            if (selectPressed && !wasSelectPressed && !cooldownActive) {
                const hubIsOpen = this.serenityModeCallbacks.isHubOpen?.();
                console.log('[Gamepad] SELECT pressed in game mode selection - Hub is:', hubIsOpen ? 'OPEN' : 'CLOSED');
                this.serenityModeCallbacks.toggleHub?.();
                this._serenitySelectCooldown = now;
            }
            prevState.gameModeSelect_hub = selectPressed;
        }
    }

    /**
     * Enable menu navigation mode
     */
    enableMenuNavigation() {
        this.menuNavigationEnabled = true;
        console.log('[Gamepad] Menu navigation enabled');

        this.exitSelectEditMode();

        // Clear all previous button states to prevent double-triggering
        // when switching from game mode to menu mode
        for (let i = 0; i < this.previousStates.length; i++) {
            this.previousStates[i] = {};
        }
        console.log('[Gamepad] Cleared previous button states');

        // Focus first element after a short delay to ensure modal is rendered
        setTimeout(() => {
            // Only focus if we're still in menu navigation mode
            if (!this.menuNavigationEnabled) {
                console.log('[Gamepad] Menu navigation disabled before focus, skipping');
                return;
            }

            const firstFocusable = this.getFirstFocusableElement();
            if (firstFocusable) {
                // Don't focus the settings button itself to avoid recursion
                if (firstFocusable.id === 'settings-btn-global') {
                    console.log('[Gamepad] Skipping settings button, finding next element');
                    const focusables = this.getFocusableElements();
                    const nextElement = focusables[1] || focusables[0];
                    if (nextElement) {
                        nextElement.focus();
                        console.log('[Gamepad] Focused element:', nextElement);
                    }
                } else {
                    firstFocusable.focus();
                    console.log('[Gamepad] Focused first element:', firstFocusable);
                }
            }
        }, 100);
    }

    /**
     * Disable menu navigation mode
     */
    disableMenuNavigation() {
        this.menuNavigationEnabled = false;
        console.log('[Gamepad] Menu navigation disabled');

        this.exitSelectEditMode({ cancel: true });

        // Clear all previous button states to prevent double-triggering
        // when switching from menu mode back to game mode
        for (let i = 0; i < this.previousStates.length; i++) {
            this.previousStates[i] = {};
        }
        console.log('[Gamepad] Cleared previous button states');
    }

    /**
     * Process gamepad input for menu navigation
     */
    processMenuNavigation(gamepad, slot, { blockGlobalShortcuts = false } = {}) {
        const prevState = this.previousStates[slot];
        const inputSheet = blockGlobalShortcuts ? this.getMenuSheet()?.element : null;

        // A binding tile is listening: the press is its answer (settings.js), not a move,
        // a tab change or the Hub. Held buttons stay latched until released.
        if (document.querySelector?.('#settings-modal .key-input.listening')) {
            this.latchMenuButtons(gamepad, slot);
            return;
        }

        // Exit select editing if focus changed away
        if (this.selectEditState.active
            && document.activeElement !== this.selectEditState.element) {
            this.exitSelectEditMode({ cancel: true });
        }

        // Every controller drives the menus: a second player can resume the match their
        // Start paused, and a pad that is not the first still reaches the menu. One press
        // acts once, whichever pad it came from (claimMenuAction).
        const pressed = (index) => Boolean(gamepad.buttons[index]?.pressed);
        const fires = (key, isPressed, action) => this.menuDirectionFires(slot, key, isPressed, prevState[key])
            && this.claimMenuAction(slot, action);
        const edge = (key, isPressed, action) => isPressed && !prevState[key] && this.claimMenuAction(slot, action);

        const upPressed = pressed(BUTTON_MAP.D_UP) || this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_Y);
        const downPressed = pressed(BUTTON_MAP.D_DOWN) || this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_Y);
        const leftPressed = pressed(BUTTON_MAP.D_LEFT) || this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_X);
        const rightPressed = pressed(BUTTON_MAP.D_RIGHT) || this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_X);

        // An open dropdown (a combobox on the local setup and match screens) takes the pad:
        // up and down walk its options, A chooses, B closes it. The D-pad used to move focus
        // off it, so bot skill, handicap and team could not be chosen.
        const combo = this.getOpenCombobox();
        if (combo) {
            if (fires('menuUp', upPressed, 'up')) this.stepCombobox(combo, 'ArrowUp');
            if (fires('menuDown', downPressed, 'down')) this.stepCombobox(combo, 'ArrowDown');
            const aPressed = pressed(BUTTON_MAP.A);
            const bPressed = pressed(BUTTON_MAP.B);
            if (edge('menuSelect', aPressed, 'select')) this.chooseComboboxOption(combo);
            if (edge('menuBack', bPressed, 'back')) combo.click();
            Object.assign(prevState, {
                menuUp: upPressed,
                menuDown: downPressed,
                menuLeft: leftPressed,
                menuRight: rightPressed,
                menuSelect: aPressed,
                menuBack: bPressed,
                menuLB: pressed(BUTTON_MAP.LB),
                menuRB: pressed(BUTTON_MAP.RB),
                menuStart: pressed(BUTTON_MAP.START),
            });
            return;
        }

        // D-pad Up / Left stick up - Navigate up
        if (fires('menuUp', upPressed, 'up')) {
            if (!(this.selectEditState.active
                && this.handleControlAdjustment('up'))) {
                this.navigateMenu('up');
            }
        }
        prevState.menuUp = upPressed;

        // D-pad Down / Left stick down - Navigate down
        if (fires('menuDown', downPressed, 'down')) {
            if (!(this.selectEditState.active
                && this.handleControlAdjustment('down'))) {
                this.navigateMenu('down');
            }
        }
        prevState.menuDown = downPressed;

        // D-pad Left / Left stick left - Navigate left (tabs)
        if (fires('menuLeft', leftPressed, 'left')) {
            if (!this.handleControlAdjustment('left')) {
                this.navigateMenu('left');
            }
        }
        prevState.menuLeft = leftPressed;

        // D-pad Right / Left stick right - Navigate right (tabs/subtabs)
        if (fires('menuRight', rightPressed, 'right')) {
            if (!this.handleControlAdjustment('right')) {
                this.navigateMenu('right');
            }
        }
        prevState.menuRight = rightPressed;

        // LB - Previous Main Tab
        const lbPressed = pressed(BUTTON_MAP.LB);
        if (edge('menuLB', lbPressed, 'lb')) {
            this.switchMainTab(-1);
        }
        prevState.menuLB = lbPressed;

        // RB - Next Main Tab
        const rbPressed = pressed(BUTTON_MAP.RB);
        if (edge('menuRB', rbPressed, 'rb')) {
            this.switchMainTab(1);
        }
        prevState.menuRB = rbPressed;

        // A button - Select/Activate
        const aPressed = pressed(BUTTON_MAP.A);
        if (edge('menuSelect', aPressed, 'select')) {
            this.activateMenuItem();
        }
        prevState.menuSelect = aPressed;
        if (blockGlobalShortcuts && this.getMenuSheet()?.element !== inputSheet) return;

        // B button - Back/Close
        const bPressed = pressed(BUTTON_MAP.B);
        if (edge('menuBack', bPressed, 'back')) {
            if (this.selectEditState.active) {
                this.exitSelectEditMode({ cancel: true });
            } else {
                this.navigateMenuBack();
            }
        }
        prevState.menuBack = bPressed;

        // Odyssey's visible controls own its pause/continue rhythm. Global shortcuts
        // must not open Settings or the Serenity Hub behind a journey transition.
        if (blockGlobalShortcuts) return;

        // Start button - Open/Close settings
        const startPressed = pressed(BUTTON_MAP.START);
        if (this.waitingForStartRelease[slot]) {
            if (!startPressed) {
                this.waitingForStartRelease[slot] = false;
            }
        } else if (edge('menuStart', startPressed, 'start')) {
            this.toggleSettings(slot);
        }
        prevState.menuStart = startPressed;

        // SELECT button - Toggle Serenity Hub (if available)
        if (this.serenityModeActive && this.serenityModeCallbacks) {
            const selectPressed = gamepad.buttons[BUTTON_MAP.SELECT]?.pressed;
            const wasSelectPressed = prevState.menuSelect_hub;

            // Check cooldown to prevent double-triggering
            const now = performance.now();
            if (!this._serenitySelectCooldown) this._serenitySelectCooldown = 0;
            const cooldownActive = now - this._serenitySelectCooldown < 500;

            if (selectPressed && !wasSelectPressed && !cooldownActive) {
                const hubIsOpen = this.serenityModeCallbacks.isHubOpen?.();
                console.log('[Gamepad] SELECT pressed in menu navigation - Hub is:', hubIsOpen ? 'OPEN' : 'CLOSED');
                this.serenityModeCallbacks.toggleHub?.();
                this._serenitySelectCooldown = now;
            }
            prevState.menuSelect_hub = selectPressed;
        }
    }

    /**
     * Whether a menu press acts: the same action from another controller a moment ago was
     * the same press (Steam Input can expose one pad twice), so it acts once.
     * @param {number} slot
     * @param {string} action
     */
    claimMenuAction(slot, action) {
        const now = performance.now();
        const claims = this.menuActionClaims || (this.menuActionClaims = {});
        const last = claims[action];
        if (last && last.slot !== slot && now - last.at < MENU_PRESS_MERGE_MS) return false;
        claims[action] = { slot, at: now };
        return true;
    }

    /** The open dropdown that has focus (an enhanced select's combobox), or null. */
    getOpenCombobox() {
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        return active?.matches?.('[role="combobox"][aria-expanded="true"]') ? active : null;
    }

    /** Walk an open dropdown's options with its own keys. */
    stepCombobox(combo, key) {
        if (typeof KeyboardEvent !== 'function') return;
        combo.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }

    /** Choose the option an open dropdown has highlighted (A), as a click on it does. */
    chooseComboboxOption(combo) {
        const listbox = document.getElementById(combo.getAttribute('aria-controls') || '');
        const option = listbox?.querySelector('.cosmic-select__option.is-active');
        if (option) option.click();
        else combo.click();
    }

    /**
     * Navigate menu in a direction
     */
    /**
     * Navigate menu in a direction
     */
    navigateMenu(direction) {
        // Get currently focused element
        const current = document.activeElement;
        const sheet = this.getMenuSheet();

        // If nothing is focused, focus the first focusable element
        if (!current || current === document.body || (sheet && !sheet.element.contains(current))) {
            const firstFocusable = this.getFirstFocusableElement();
            if (firstFocusable) {
                firstFocusable.focus();
            }
            return;
        }

        // Use Spatial Navigation to find the best next element
        // We restrict the search to the open sheet if there is one
        const container = sheet?.element.querySelector('.modal-content') || sheet?.element || document.body;

        const nextElement = SpatialNavigation.findNextElement(current, direction, container);

        // Nothing further that way: stay put. Tabs change with LB/RB (switchMainTab).
        if (nextElement) {
            nextElement.focus();
            nextElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    /**
     * Switch main tabs (LB/RB)
     */
    switchMainTab(direction) {
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('visible')) {
            const tabs = Array.from(document.querySelectorAll('.settings-tab'));
            const activeTab = document.querySelector('.settings-tab.active');

            if (activeTab && tabs.length > 0) {
                const currentIndex = tabs.indexOf(activeTab);
                let nextIndex = currentIndex + direction;

                if (nextIndex < 0) nextIndex = tabs.length - 1;
                if (nextIndex >= tabs.length) nextIndex = 0;

                tabs[nextIndex].click();
                // Focus follows from a tab to the new tab, and out of content the old
                // tab hid (it was lost to the page: no ring, and the D-pad started again
                // from the top). Elsewhere, in the header, it stays where it is.
                const active = document.activeElement;
                if (!active || active === document.body || !settingsModal.contains(active)
                    || active.offsetParent === null || tabs.includes(active)) {
                    tabs[nextIndex].focus({ preventScroll: true });
                }
            }
        }

        // The Odyssey navigator: LB and RB climb down and up the chapters.
        const navigator = document.getElementById('odyssey-level-select');
        if (navigator && navigator.style.display === 'flex') {
            navigator.querySelector(`[data-navigator-step="${direction < 0 ? -1 : 1}"]:not(:disabled)`)?.click();
        }

        // The charm guide: LB and RB walk the four charms.
        document.getElementById('odyssey-charm-guide')?.stepCharm?.(direction);

        // Records: one tab per mode.
        const recordsModal = document.getElementById('high-scores-modal');
        if (recordsModal && recordsModal.classList.contains('visible')) {
            const tabs = Array.from(recordsModal.querySelectorAll('.hs-tab'));
            const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
            if (tabs.length > 0) {
                const next = tabs[(current + direction + tabs.length) % tabs.length];
                next.click();
                const active = document.activeElement;
                if (!active || active === document.body || active.offsetParent === null || tabs.includes(active)) {
                    next.focus({ preventScroll: true });
                }
            }
        }
    }

    /**
     * Navigate between tabs (D-pad)
     */
    navigateTab(direction) {
        // Check if in settings modal
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('visible')) {
            // Check if we are in the Controls tab
            const controlsTab = document.querySelector('.settings-tab[data-tab="controls"]');
            const isControlsActive = controlsTab && controlsTab.classList.contains('active');

            // If Controls tab is active, try to navigate subtabs first
            if (isControlsActive) {
                const controlsSubtabs = Array.from(document.querySelectorAll('.controls-subtab'));
                const activeSubtab = document.querySelector('.controls-subtab.active');

                if (activeSubtab && controlsSubtabs.length > 0) {
                    // Check if we are focused on the subtabs or inside the content
                    // If we are focused on a subtab, navigate subtabs
                    // If we are focused on a main tab, navigate main tabs
                    // For now, let's assume if we are in controls, we want to navigate subtabs with D-pad
                    // unless we implement a way to switch focus between main tabs and content.

                    // Actually, let's stick to the plan: LB/RB for main tabs, D-pad for content/subtabs.
                    // But this function is called by D-pad Left/Right in the current implementation.
                    // I will update processMenuNavigation to use LB/RB for main tabs.
                    // So here, if called by D-pad (which calls this function), we should navigate subtabs if in controls.

                    const currentIndex = controlsSubtabs.indexOf(activeSubtab);
                    let nextIndex = currentIndex + direction;

                    if (nextIndex < 0) nextIndex = controlsSubtabs.length - 1;
                    if (nextIndex >= controlsSubtabs.length) nextIndex = 0;

                    controlsSubtabs[nextIndex].click();
                    controlsSubtabs[nextIndex].focus();
                    return; // Handled subtab navigation
                }
            }

            // Navigate main tabs
            const tabs = Array.from(document.querySelectorAll('.settings-tab'));
            const activeTab = document.querySelector('.settings-tab.active');

            if (activeTab && tabs.length > 0) {
                const currentIndex = tabs.indexOf(activeTab);
                let nextIndex = currentIndex + direction;

                if (nextIndex < 0) nextIndex = tabs.length - 1;
                if (nextIndex >= tabs.length) nextIndex = 0;

                tabs[nextIndex].click();
                tabs[nextIndex].focus();
            }
        }
    }

    /**
     * Activate the currently focused menu item
     */
    activateMenuItem() {
        let current = document.activeElement;
        const sheet = this.getMenuSheet();
        // Chapter arrivals focus a static heading for reading. Resolve its action
        // only when the player presses A, without moving idle reading focus.
        const readingFocus = sheet?.sheet.odyssey && !getSheetFocusables(sheet.element).includes(current);
        if (sheet && (!sheet.element.contains(current) || readingFocus)) {
            current = getSheetInitialFocus(sheet.sheet, sheet.element);
            current?.focus({ preventScroll: !sheet.sheet.odyssey });
        }
        if (current && current !== document.body) {
            if (current.matches('input[type="range"]')) {
                // Range sliders respond to directional adjustments instead of click
                return;
            }
            if (current.matches('select')) {
                if (this.selectEditState.active && this.selectEditState.element === current) {
                    this.exitSelectEditMode({ confirm: true });
                } else {
                    this.enterSelectEditMode(current);
                }
                return;
            }
            current.click();
        }
    }

    /**
     * Navigate back / close menu
     */
    navigateMenuBack() {
        const sheet = this.getMenuSheet();
        if (!sheet) return;

        // Multiplayer surfaces share one back stack with Escape (mp-sheet.js).
        if (sheet.name === 'multiplayer') {
            goBackFromTopLayer();
            return;
        }

        if (sheet.name === 'settings') {
            // B while a binding listens is the answer to the capture, not a way out — and
            // so is the B that a capture took a moment ago.
            const settingsModal = sheet.element;
            const endedAt = Number(settingsModal.getAttribute?.('data-capture-ended')) || 0;
            if (settingsModal.querySelector?.('.listening') || Date.now() - endedAt < 300) return;
            document.getElementById('close-settings')?.click();
            return;
        }

        // Records and Replays close; replay complete goes back to the main menu.
        getSheetBackControl(sheet)?.click();
    }

    /**
     * The open Keystone sheet that menu navigation is scoped to (game over keeps its
     * own any-button restart in processGameOverInput).
     * @returns {{name: string, element: HTMLElement, sheet: Object}|null}
     */
    getMenuSheet() {
        if (typeof document === 'undefined') return null;
        const sheet = getOpenSheet(document, { exclude: ['gameOver'] });
        if (sheet) return sheet;
        // Local setup, the lobby screens and match results: the pad stays inside them.
        const layer = getTopLayerElement();
        if (!layer || !layer.getClientRects?.().length) return null;
        return { name: 'multiplayer', element: layer, sheet: {} };
    }

    /**
     * Toggle settings menu
     */
    toggleSettings(slot = 0) {
        console.log('[Gamepad] toggleSettings called');

        if (typeof slot === 'number' && slot >= 0 && slot < this.waitingForStartRelease.length) {
            this.waitingForStartRelease[slot] = true;
        }

        const settingsModal = document.getElementById('settings-modal');

        if (settingsModal && settingsModal.classList.contains('visible')) {
            // Settings is open, close it
            console.log('[Gamepad] Settings is open, closing...');
            const closeBtn = document.getElementById('close-settings');
            if (closeBtn) {
                closeBtn.click();
            }
        } else {
            // Settings is closed, open it
            console.log('[Gamepad] Settings is closed, opening...');

            // Prevent rapid toggling by adding a small delay flag
            if (this._toggleCooldown) {
                console.log('[Gamepad] Toggle on cooldown, ignoring');
                return;
            }
            this._toggleCooldown = true;
            setTimeout(() => { this._toggleCooldown = false; }, 500);

            // Try clicking the settings button first
            const settingsBtn = document.getElementById('settings-btn-global');
            if (settingsBtn) {
                console.log('[Gamepad] Clicking settings button');
                settingsBtn.click();
            } else {
                // Fallback: directly show the modal
                console.log('[Gamepad] Settings button not found, showing modal directly');
                if (settingsModal) {
                    settingsModal.classList.add('visible');
                    window.dispatchEvent(new CustomEvent('modalShown', { detail: { modalName: 'settings' } }));
                    this.enableMenuNavigation();
                }
            }
        }
    }

    /**
     * Get all focusable elements in the current view
     */
    getFocusableElements() {
        const sheet = this.getMenuSheet();
        if (sheet) return getSheetFocusables(sheet.element);
        const elements = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR));

        // Filter out hidden elements
        return elements.filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && el.offsetParent !== null;
        });
    }

    /**
     * Get the first focusable element
     */
    getFirstFocusableElement() {
        // Inside an open sheet: keep the focus it already placed, or its primary control.
        const sheet = this.getMenuSheet();
        if (sheet) {
            const active = document.activeElement;
            if (active && active !== document.body && sheet.element.contains(active)) return active;
            return getSheetInitialFocus(sheet.sheet, sheet.element);
        }
        const focusable = this.getFocusableElements();
        return focusable.length > 0 ? focusable[0] : null;
    }

    /**
     * Handle adjustments for focused controls (sliders, selects, etc.)
     * @param {'left'|'right'|'up'|'down'} direction
     * @returns {boolean} True if the control handled the input
     */
    handleControlAdjustment(direction) {
        const current = document.activeElement;
        if (!current || current === document.body) {
            return false;
        }

        // Adjust sliders with left/right
        if (current.matches('input[type="range"]')) {
            if (direction !== 'left' && direction !== 'right') {
                return false;
            }

            const stepAttr = Number(current.step);
            const step = !Number.isNaN(stepAttr) && stepAttr > 0 ? stepAttr : 1;
            const minAttr = Number(current.min);
            const maxAttr = Number(current.max);
            const min = !Number.isNaN(minAttr) ? minAttr : 0;
            const max = !Number.isNaN(maxAttr) ? maxAttr : 100;
            const currentValue = Number(current.value);
            const value = Number.isNaN(currentValue) ? min : currentValue;
            const delta = direction === 'left' ? -step : step;
            const nextValue = Math.min(max, Math.max(min, value + delta));

            // Even if the value doesn't change, consume the input to stay on the control
            if (nextValue === value) {
                return true;
            }

            current.value = nextValue;
            current.dispatchEvent(new Event('input', { bubbles: true }));
            current.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        if (this.selectEditState.active
            && current === this.selectEditState.element
            && current.matches('select')) {
            if (!['left', 'right', 'up', 'down'].includes(direction)) {
                return true;
            }

            const delta = (direction === 'left' || direction === 'up') ? -1 : 1;
            this.moveSelectHighlight(delta);
            return true;
        }

        return false;
    }

    enterSelectEditMode(selectElement) {
        // Clean up any prior state
        this.exitSelectEditMode();

        const options = Array.from(selectElement.options);
        if (options.length === 0) {
            return;
        }

        const overlay = this.createSelectOverlay(selectElement, options);

        this.selectEditState.active = true;
        this.selectEditState.element = selectElement;
        this.selectEditState.overlay = overlay;
        this.selectEditState.options = options;
        this.selectEditState.originalIndex = selectElement.selectedIndex;
        this.selectEditState.highlightIndex = this.findNextSelectableIndex(
            selectElement.selectedIndex >= 0 ? selectElement.selectedIndex : 0,
            options,
            0,
        );

        selectElement.focus();

        const blurHandler = () => {
            if (this.selectEditState.active && this.selectEditState.element === selectElement) {
                this.exitSelectEditMode({ cancel: true });
            }
        };
        selectElement.addEventListener('blur', blurHandler, { once: true });
        this.selectEditState.cleanup = () => {
            selectElement.removeEventListener('blur', blurHandler);
        };

        this.updateSelectOverlayHighlight();
    }

    exitSelectEditMode(opts = {}) {
        if (!this.selectEditState.active) {
            return;
        }

        const { cancel = false, confirm = false } = opts;
        const {
            element,
            overlay,
            cleanup,
            highlightIndex,
            originalIndex,
            options,
        } = this.selectEditState;

        if (cleanup) {
            cleanup();
        }

        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }

        if (element) {
            if (confirm && highlightIndex >= 0 && highlightIndex < options.length) {
                if (element.selectedIndex !== highlightIndex) {
                    element.selectedIndex = highlightIndex;
                    element.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else if (cancel && originalIndex !== -1 && element.selectedIndex !== originalIndex) {
                element.selectedIndex = originalIndex;
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }
            element.focus();
        }

        this.selectEditState.active = false;
        this.selectEditState.element = null;
        this.selectEditState.overlay = null;
        this.selectEditState.highlightIndex = -1;
        this.selectEditState.originalIndex = -1;
        this.selectEditState.options = [];
        this.selectEditState.cleanup = null;
    }

    createSelectOverlay(selectElement, options) {
        const overlay = document.createElement('div');
        overlay.className = 'gamepad-select-overlay';
        overlay.dataset.gamepadSelectOverlay = 'true';

        const rect = selectElement.getBoundingClientRect();
        overlay.style.position = 'fixed';
        overlay.style.left = `${rect.left}px`;
        overlay.style.minWidth = `${rect.width}px`;
        overlay.style.maxWidth = `${Math.max(rect.width, 220)}px`;
        overlay.style.maxHeight = '280px';
        overlay.style.overflowY = 'auto';
        overlay.style.zIndex = '9999';
        overlay.style.background = 'rgba(15, 23, 42, 0.95)';
        overlay.style.border = '1px solid rgba(148, 163, 184, 0.4)';
        overlay.style.borderRadius = '8px';
        overlay.style.boxShadow = '0 12px 24px rgba(15, 23, 42, 0.45)';
        overlay.style.padding = '6px 0';
        overlay.style.fontFamily = 'inherit';
        overlay.style.fontSize = '14px';
        overlay.style.color = '#e2e8f0';
        overlay.style.visibility = 'hidden';

        options.forEach((option, index) => {
            const item = document.createElement('div');
            item.dataset.optionIndex = String(index);
            item.textContent = option.textContent;
            item.style.padding = '10px 16px';
            item.style.cursor = option.disabled ? 'not-allowed' : 'pointer';
            item.style.opacity = option.disabled ? '0.4' : '1';
            item.style.transition = 'background 120ms ease, color 120ms ease';

            item.addEventListener('mouseenter', () => {
                if (option.disabled) return;
                this.selectEditState.highlightIndex = index;
                this.updateSelectOverlayHighlight();
            });

            item.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });

            item.addEventListener('click', () => {
                if (!option.disabled) {
                    this.selectEditState.highlightIndex = index;
                    this.updateSelectOverlayHighlight();
                    this.exitSelectEditMode({ confirm: true });
                }
            });

            overlay.appendChild(item);
        });

        document.body.appendChild(overlay);
        const overlayHeight = overlay.offsetHeight;
        const overlayWidth = overlay.offsetWidth;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        let top = rect.bottom + 6;
        let { left } = rect;

        if (top + overlayHeight > viewportHeight && rect.top > overlayHeight) {
            top = Math.max(12, rect.top - overlayHeight - 6);
        }

        if (left + overlayWidth > viewportWidth - 12) {
            left = Math.max(12, viewportWidth - overlayWidth - 12);
        }

        overlay.style.top = `${Math.max(12, top)}px`;
        overlay.style.left = `${Math.max(12, left)}px`;
        overlay.style.visibility = 'visible';
        return overlay;
    }

    updateSelectOverlayHighlight() {
        const { overlay, highlightIndex } = this.selectEditState;
        if (!overlay) return;

        const items = overlay.querySelectorAll('[data-option-index]');
        items.forEach((item, index) => {
            if (index === highlightIndex) {
                item.style.background = 'rgba(59, 130, 246, 0.25)';
                item.style.color = '#f9fafb';
            } else {
                item.style.background = 'transparent';
                item.style.color = '#e2e8f0';
            }
        });

        if (highlightIndex >= 0 && highlightIndex < items.length) {
            const activeItem = items[highlightIndex];
            if (activeItem && typeof activeItem.scrollIntoView === 'function') {
                activeItem.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    moveSelectHighlight(delta) {
        const state = this.selectEditState;
        if (!state.active || !state.overlay || state.options.length === 0) {
            return;
        }

        if (state.highlightIndex < 0) {
            state.highlightIndex = this.findNextSelectableIndex(0, state.options, 0);
            this.updateSelectOverlayHighlight();
            return;
        }

        const { options } = state;
        let nextIndex = state.highlightIndex;
        const optionCount = options.length;

        for (let i = 0; i < optionCount; i++) {
            nextIndex = (nextIndex + delta + optionCount) % optionCount;
            const option = options[nextIndex];
            if (!option.disabled) {
                state.highlightIndex = nextIndex;
                this.updateSelectOverlayHighlight();
                return;
            }
        }
    }

    findNextSelectableIndex(startIndex, options, fallbackIndex = 0) {
        if (!options.length) return -1;

        let index = startIndex;
        if (index < 0 || index >= options.length) {
            index = fallbackIndex;
        }

        for (let i = 0; i < options.length; i++) {
            const option = options[(index + i) % options.length];
            if (!option.disabled) {
                return (index + i) % options.length;
            }
        }

        return -1;
    }

    /**
     * Process input from a gamepad
     */
    processGamepadInput(gamepad, slot) {
        this.preserveOdysseyInputRelease(gamepad, slot);
        const prevState = this.previousStates[slot];
        const hubIsOpen = this.serenityModeActive
            && this.serenityModeCallbacks
            && this.serenityModeCallbacks.isHubOpen?.() === true;

        // The Hub owns every button while visible, including Start. Route it
        // before the global Settings shortcut so Settings cannot open beneath
        // a theme card confirmation.
        if (hubIsOpen) {
            this.processSerenityModeInput(gamepad, slot);
            return;
        }

        // Handle START button for settings (for player 1 only)
        // BUT skip if menu navigation is enabled (menus handle their own START button)
        if (slot === 0 && !this.menuNavigationEnabled) {
            const settingsButton = this.serenityShortcutsLive()
                ? this.getSerenityGamepadBindings().openSettings
                : BUTTON_MAP.START;
            const startPressed = Number.isInteger(settingsButton) && gamepad.buttons[settingsButton]?.pressed;

            if (this.waitingForStartRelease[slot]) {
                if (!startPressed) {
                    this.waitingForStartRelease[slot] = false;
                }
            } else if (startPressed && !prevState.menuStart) {
                this.toggleSettings(slot);
            }
            prevState.menuStart = startPressed;
        }

        // In Serenity Mode its shortcuts (Hub, breathing, music...) run alongside game input;
        // with the hub open, the early return above already gave it every button.
        if (this.serenityShortcutsLive()) {
            this.processSerenityModeInput(gamepad, slot);
        }

        // Infinity's exploration (InfinityAscent): the right stick looks around the tower (a pull
        // first, then the game pauses); pressed in (R3) it looks at once. While looking, a game
        // button sends the view home, and that press is held back from the game until released
        // (pressing B to return must not hard-drop).
        if (slot === 0 && this.explorationCallbacks) {
            const callbacks = this.explorationCallbacks;
            const held = Boolean(gamepad.buttons[BUTTON_MAP.R_STICK]?.pressed);
            callbacks.onStick?.(gamepad.axes[AXIS_MAP.RIGHT_STICK_Y] ?? 0, { held, index: gamepad.index });
            const gameInput = EXPLORATION_GAME_BUTTONS.some((index) => gamepad.buttons[index]?.pressed)
                || Math.abs(gamepad.axes[AXIS_MAP.LEFT_STICK_X] ?? 0) > 0.6
                || Math.abs(gamepad.axes[AXIS_MAP.LEFT_STICK_Y] ?? 0) > 0.6;
            if (callbacks.isExploring?.()) {
                if (gameInput && !prevState.explorationGameInput) {
                    prevState.explorationLatch = true;
                    callbacks.onGameInput?.();
                }
                prevState.explorationGameInput = gameInput;
                return;
            }
            prevState.explorationGameInput = gameInput;
            if (prevState.explorationLatch) {
                if (gameInput) return;
                prevState.explorationLatch = false;
            }
            // R3 held keeps its old meaning in Infinity: the stick looks, play waits.
            if (held) return;
        }

        if (slot === 0 && !this.serenityShortcutsLive()) this.processThemeStepInput(gamepad, slot);

        // Use custom bindings if available, otherwise use default
        const config = this.getGameplayBindingConfig(slot);

        // If no game actions set, we're done (START button handling is already done above)
        if (!this.gameActions) {
            return;
        }

        // Get appropriate action functions based on player slot (0-3 = P1-P4)
        let actions;
        switch (slot) {
        case 0: // Player 1
            actions = {
                move: this.gameActions.move,
                rotate: this.gameActions.rotate,
                softDrop: this.gameActions.softDrop,
                hardDrop: this.gameActions.hardDrop,
                requestMove: this.gameActions.requestMove,
                requestRotate: this.gameActions.requestRotate,
                requestSoftDrop: this.gameActions.requestSoftDrop,
                requestHardDrop: this.gameActions.requestHardDrop,
                pause: this.gameActions.togglePause,
            };
            break;
        case 1: // Player 2
            actions = {
                move: this.gameActions.moveP2,
                rotate: this.gameActions.rotateP2,
                softDrop: this.gameActions.softDropP2,
                hardDrop: this.gameActions.hardDropP2,
                requestMove: this.gameActions.requestMoveP2,
                requestRotate: this.gameActions.requestRotateP2,
                requestSoftDrop: this.gameActions.requestSoftDropP2,
                requestHardDrop: this.gameActions.requestHardDropP2,
                pause: this.gameActions.togglePause,
            };
            break;
        case 2: // Player 3
            actions = {
                move: this.gameActions.moveP3,
                rotate: this.gameActions.rotateP3,
                softDrop: this.gameActions.softDropP3,
                hardDrop: this.gameActions.hardDropP3,
                requestMove: this.gameActions.requestMoveP3,
                requestRotate: this.gameActions.requestRotateP3,
                requestSoftDrop: this.gameActions.requestSoftDropP3,
                requestHardDrop: this.gameActions.requestHardDropP3,
                pause: this.gameActions.togglePause,
            };
            break;
        case 3: // Player 4
            actions = {
                move: this.gameActions.moveP4,
                rotate: this.gameActions.rotateP4,
                softDrop: this.gameActions.softDropP4,
                hardDrop: this.gameActions.hardDropP4,
                requestMove: this.gameActions.requestMoveP4,
                requestRotate: this.gameActions.requestRotateP4,
                requestSoftDrop: this.gameActions.requestSoftDropP4,
                requestHardDrop: this.gameActions.requestHardDropP4,
                pause: this.gameActions.togglePause,
            };
            break;
        default:
            console.warn(`[Gamepad] Invalid player slot: ${slot}`);
            return;
        }

        const fixedTickClaimed = this.isFixedTickPlayerClaimed(slot);

        // Process movement (D-pad left/right or left stick X)
        const leftPressed = this.isButtonPressed(gamepad, config.moveLeft)
            || this.isAxisNegative(gamepad, config.moveLeft.axisNegative);
        const rightPressed = this.isButtonPressed(gamepad, config.moveRight)
            || this.isAxisPositive(gamepad, config.moveRight.axisPositive);

        const prevLeft = prevState.moveLeft || false;
        const prevRight = prevState.moveRight || false;

        // Handle left movement
        if (leftPressed && !prevLeft) {
            // Initial press
            if (fixedTickClaimed) {
                const result = this.pressFixedTickAction(slot, 'left', 'move', -1);
                if (result.accepted) performanceMonitor.recordInputAction();
                this.stopDas(slot, 'left');
            } else if (actions.requestMove || actions.move) {
                (actions.requestMove || actions.move)(-1);
                performanceMonitor.recordInputAction();
                this.startDas(slot, 'left', () => (actions.requestMove || actions.move)?.(-1));
            }
        } else if (!leftPressed && prevLeft) {
            // Release
            if (fixedTickClaimed || this.fixedTickHeldActions[slot].has('left')) {
                this.releaseFixedTickAction(slot, 'left');
            }
            this.stopDas(slot, 'left');
        }

        // Handle right movement
        if (rightPressed && !prevRight) {
            // Initial press
            if (fixedTickClaimed) {
                const result = this.pressFixedTickAction(slot, 'right', 'move', 1);
                if (result.accepted) performanceMonitor.recordInputAction();
                this.stopDas(slot, 'right');
            } else if (actions.requestMove || actions.move) {
                (actions.requestMove || actions.move)(1);
                performanceMonitor.recordInputAction();
                this.startDas(slot, 'right', () => (actions.requestMove || actions.move)?.(1));
            }
        } else if (!rightPressed && prevRight) {
            // Release
            if (fixedTickClaimed || this.fixedTickHeldActions[slot].has('right')) {
                this.releaseFixedTickAction(slot, 'right');
            }
            this.stopDas(slot, 'right');
        }

        prevState.moveLeft = leftPressed;
        prevState.moveRight = rightPressed;

        // Process soft drop (D-pad down or left stick Y)
        const downPressed = this.isButtonPressed(gamepad, config.softDrop)
            || this.isAxisPositive(gamepad, config.softDrop.axisPositive);
        const prevDown = prevState.softDrop || false;

        if (downPressed && !prevDown) {
            if (fixedTickClaimed) {
                const result = this.pressFixedTickAction(slot, 'down', 'softDrop', null);
                if (result.accepted) performanceMonitor.recordInputAction();
                this.stopDas(slot, 'down');
            } else if (actions.requestSoftDrop || actions.softDrop) {
                (actions.requestSoftDrop || actions.softDrop)();
                performanceMonitor.recordInputAction();
                this.startDas(slot, 'down', () => (actions.requestSoftDrop || actions.softDrop)?.());
            }
        } else if (!downPressed && prevDown) {
            if (fixedTickClaimed || this.fixedTickHeldActions[slot].has('down')) {
                this.releaseFixedTickAction(slot, 'down');
            }
            this.stopDas(slot, 'down');
        }

        prevState.softDrop = downPressed;

        // Process rotation buttons (edge-triggered)
        if (this.isButtonJustPressed(gamepad, config.rotateRight, prevState, 'rotateRight')) {
            if (fixedTickClaimed) {
                const result = this.pressFixedTickAction(slot, null, 'rotate', 'right');
                if (result.accepted) performanceMonitor.recordInputAction();
            } else if (actions.requestRotate || actions.rotate) {
                (actions.requestRotate || actions.rotate)('right');
                performanceMonitor.recordInputAction();
            }
        }

        if (this.isButtonJustPressed(gamepad, config.rotateLeft, prevState, 'rotateLeft')) {
            if (fixedTickClaimed) {
                const result = this.pressFixedTickAction(slot, null, 'rotate', 'left');
                if (result.accepted) performanceMonitor.recordInputAction();
            } else if (actions.requestRotate || actions.rotate) {
                (actions.requestRotate || actions.rotate)('left');
                performanceMonitor.recordInputAction();
            }
        }

        if (this.isButtonJustPressed(gamepad, config.flip, prevState, 'flip')) {
            if (fixedTickClaimed) {
                const result = this.pressFixedTickAction(slot, null, 'rotate', 'flip');
                if (result.accepted) performanceMonitor.recordInputAction();
            } else if (actions.requestRotate || actions.rotate) {
                (actions.requestRotate || actions.rotate)('flip');
                performanceMonitor.recordInputAction();
            }
        }

        // Process hard drop (edge-triggered)
        if (this.isButtonJustPressed(gamepad, config.hardDrop, prevState, 'hardDrop')) {
            if (fixedTickClaimed) {
                const result = this.pressFixedTickAction(slot, null, 'hardDrop', null);
                if (result.accepted) performanceMonitor.recordInputAction();
            } else if (actions.requestHardDrop || actions.hardDrop) {
                (actions.requestHardDrop || actions.hardDrop)();
                performanceMonitor.recordInputAction();
            }
        }

        // Process pause (edge-triggered)
        if (this.waitingForStartRelease[slot]) {
            // Keep pause state in sync while ignoring the action
            prevState.pause = this.isButtonPressed(gamepad, config.pause);
        } else if (this.isButtonJustPressed(gamepad, config.pause, prevState, 'pause')) {
            if (actions.pause) {
                actions.pause();
            }
        }
    }

    /**
     * Check if a button is currently pressed
     */
    isButtonPressed(gamepad, config) {
        if (!config || config.type !== 'button') return false;
        const button = gamepad.buttons[config.index];
        return button && button.pressed;
    }

    /**
     * Check if an axis is in the negative direction beyond deadzone
     */
    isAxisNegative(gamepad, axisIndex) {
        return this.stickAxisValue(gamepad, axisIndex) < 0;
    }

    /**
     * Check if an axis is in the positive direction beyond deadzone
     */
    isAxisPositive(gamepad, axisIndex) {
        return this.stickAxisValue(gamepad, axisIndex) > 0;
    }

    /**
     * One axis of a stick as play and the menus read it: 0 inside the deadzone, which is a
     * circle (the stick's distance from centre, not each axis alone), and 0 unless this is
     * the stick's stronger axis. A stick pushed left and a little down moved and soft-dropped
     * at once, and a diagonal in a menu moved focus twice (audit INPUT-14).
     * @param {Gamepad} gamepad
     * @param {number} axisIndex 0-1 left stick, 2-3 right stick (x, y)
     */
    stickAxisValue(gamepad, axisIndex) {
        if (!Number.isInteger(axisIndex) || axisIndex < 0) return 0;
        const axes = gamepad?.axes || [];
        const value = Number(axes[axisIndex]) || 0;
        const horizontal = axisIndex % 2 === 0;
        const other = Number(axes[horizontal ? axisIndex + 1 : axisIndex - 1]) || 0;
        if (Math.hypot(value, other) <= this.deadzone) return 0;
        // An exact diagonal reads as horizontal.
        const dominant = horizontal ? Math.abs(value) >= Math.abs(other) : Math.abs(value) > Math.abs(other);
        return dominant ? value : 0;
    }

    /**
     * Check if a button was just pressed (edge detection)
     */
    isButtonJustPressed(gamepad, config, prevState, stateKey) {
        const pressed = this.isButtonPressed(gamepad, config);
        const wasPressed = prevState[stateKey] || false;
        prevState[stateKey] = pressed;
        return pressed && !wasPressed;
    }

    /**
     * Start DAS (Delayed Auto Shift) for continuous movement
     */
    startDas(slot, direction, action) {
        this.dasActions[slot][direction] = action;
        const state = this.dasState[slot][direction];
        state.active = true;
        state.delayAccumulator = 0;
        state.intervalAccumulator = 0;
        state.isRepeating = false;
    }

    /**
     * Process high-precision DAS timers on the poll loop
     */
    processDasTimers(slot, delta) {
        if (!this.gameActions || !this.enabled) return;
        if (this.isFixedTickPlayerClaimed(slot)) {
            this.clearDasTimers(slot);
            return;
        }

        const processDirection = (dir) => {
            const state = this.dasState[slot][dir];
            const action = this.dasActions[slot][dir];
            if (!state.active || !action) return;

            // For downward movement map to continuous softDrop, custom interval or 50ms default
            if (dir === 'down') {
                advanceSoftDrop(state, delta, {
                    softDropInterval: this.softDropInterval,
                    instantLimit: INSTANT_SOFT_DROP_REPEAT_LIMIT,
                }, action);
                return;
            }

            // For left/right movement
            advanceDas(state, delta, {
                dasDelay: this.dasDelay,
                dasInterval: this.dasInterval,
                instantLimit: INSTANT_DAS_REPEAT_LIMIT,
            }, action);
        };

        processDirection('left');
        processDirection('right');
        processDirection('down', true);
    }

    /**
     * Stop DAS for a specific direction
     */
    stopDas(slot, direction) {
        const state = this.dasState[slot][direction];
        if (state) {
            state.active = false;
        }
    }

    /**
     * Clear all DAS timers for a specific gamepad
     */
    clearDasTimers(slot) {
        this.stopDas(slot, 'left');
        this.stopDas(slot, 'right');
        this.stopDas(slot, 'down');
    }

    /**
     * Clear all DAS timers for all gamepads
     */
    clearAllDasTimers() {
        this.odysseyShowcaseControls?.reset();
        this.odysseyMapControls?.reset();
        this.odysseyCharmControls?.reset();
        this.clearFixedTickInput();
        for (let i = 0; i < this.gamepads.length; i++) {
            this.clearDasTimers(i);
        }
    }

    /**
     * Get the first connected gamepad (for simple use cases)
     * @returns {Gamepad|null} The first connected gamepad or null
     */
    getGamepad() {
        // Return the first connected gamepad
        const slot = this.connected.findIndex((isConnected) => isConnected);
        if (slot === -1) return null;

        const gamepad = this.gamepads[slot];
        if (!gamepad) return null;

        // Get fresh gamepad state from the browser API
        const gamepads = navigator.getGamepads();
        return gamepads[gamepad.index] || null;
    }

    /**
     * Get connection status
     */
    getConnectionStatus() {
        return {
            controller1: {
                connected: this.connected[0],
                name: this.gamepads[0]?.id || null,
                standard: this.gamepads[0] ? this.gamepads[0].mapping === 'standard' : null,
            },
            controller2: {
                connected: this.connected[1],
                name: this.gamepads[1]?.id || null,
                standard: this.gamepads[1] ? this.gamepads[1].mapping === 'standard' : null,
            },
            controller3: {
                connected: this.connected[2],
                name: this.gamepads[2]?.id || null,
                standard: this.gamepads[2] ? this.gamepads[2].mapping === 'standard' : null,
            },
            controller4: {
                connected: this.connected[3],
                name: this.gamepads[3]?.id || null,
                standard: this.gamepads[3] ? this.gamepads[3].mapping === 'standard' : null,
            },
        };
    }

    /**
     * Update DAS settings
     */
    updateDasSettings(dasDelay, dasInterval, softDropInterval = this.softDropInterval) {
        this.dasDelay = dasDelay;
        this.dasInterval = dasInterval;
        this.softDropInterval = softDropInterval;
    }

    /**
     * Update custom bindings for players
     * @param {Object} player1Bindings - Player 1 gamepad bindings
     * @param {Object} player2Bindings - Player 2 gamepad bindings
     */
    updateBindings(player1Bindings, player2Bindings, player3Bindings = null, player4Bindings = null) {
        this.customBindings[0] = player1Bindings;
        this.customBindings[1] = player2Bindings;
        this.customBindings[2] = player3Bindings;
        this.customBindings[3] = player4Bindings;
        this.bindingConfigCache.fill(null);
        console.log('[Gamepad] Updated custom bindings');
    }

    getGameplayBindingConfig(slot) {
        const bindings = this.customBindings[slot];
        if (!bindings) {
            this.bindingConfigCache[slot] = null;
            return DEFAULT_GAMEPAD_CONFIG;
        }

        const cached = this.bindingConfigCache[slot];
        let unchanged = cached?.source === bindings;
        if (unchanged) {
            for (const action of GAMEPLAY_BINDING_ACTIONS) {
                if (!Object.is(bindings[action], cached.values[action])) {
                    unchanged = false;
                    break;
                }
            }
        }
        if (unchanged) return cached.config;

        // Callers can mutate saved binding objects in place before saving. A
        // value snapshot keeps those edits live without allocating eight nested
        // configuration objects for each unchanged controller poll.
        const values = {};
        for (const action of GAMEPLAY_BINDING_ACTIONS) values[action] = bindings[action];
        const config = convertBindingsToConfig(values);
        this.bindingConfigCache[slot] = { source: bindings, values, config };
        return config;
    }

    /**
     * Update deadzone setting
     * @param {number} deadzone - New deadzone value (0-1)
     */
    get deadzone() {
        return this._deadzone;
    }

    set deadzone(value) {
        const number = Number(value);
        this._deadzone = Number.isFinite(number)
            ? Math.min(MAX_DEADZONE, Math.max(MIN_DEADZONE, number))
            : 0.25;
    }

    updateDeadzone(deadzone) {
        this.deadzone = deadzone;
        console.log('[Gamepad] Updated deadzone to', deadzone);
    }

    /**
     * Enable Serenity Mode gamepad input
     * @param {Object} callbacks - Callback functions for Serenity Mode actions
     */
    enableSerenityMode(callbacks) {
        this.serenityModeActive = true;
        this.serenityModeCallbacks = callbacks;
        console.log('[Gamepad] Serenity Mode enabled');
    }

    /**
     * Whether Serenity's pad shortcuts apply during play. The always-loaded Hub registers
     * them at startup, but they belong to Serenity Mode: everywhere else those buttons
     * play the game (Y rotates left, and used to open the Hub mid-run as well).
     * @returns {boolean}
     */
    serenityShortcutsLive() {
        if (!this.serenityModeActive || !this.serenityModeCallbacks) return false;
        const body = typeof document !== 'undefined' ? document.body : null;
        return Boolean(body?.classList?.contains?.('serenity-mode'));
    }

    getSerenityGamepadBindings() {
        const savedBindings = window.settingsManager?.get?.()?.serenityGamepadBindings
            || window.settings?.serenityGamepadBindings
            || null;

        const cached = this.serenityBindingCache;
        if (cached?.source === savedBindings
            && (!savedBindings || ownBindingsMatch(savedBindings, cached))) {
            return cached.bindings;
        }

        const values = { ...savedBindings };
        const bindings = {
            ...DEFAULT_SERENITY_GAMEPAD_BINDINGS,
            ...values,
        };
        this.serenityBindingCache = {
            source: savedBindings,
            values,
            bindings,
            keyCount: Reflect.ownKeys(values).length,
        };
        return bindings;
    }

    isSerenityButtonPressed(gamepad, bindings, action) {
        const buttonIndex = bindings[action];
        const button = Number.isInteger(buttonIndex) ? gamepad.buttons[buttonIndex] : null;
        return button ? button.pressed === true || button.value > 0.3 : false;
    }

    /**
     * Disable Serenity Mode gamepad input
     */
    disableSerenityMode() {
        this.serenityModeActive = false;
        this.serenityModeCallbacks = null;
        console.log('[Gamepad] Serenity Mode disabled');
    }

    /** @param {((direction: number) => boolean)|null} step RB / LB in play (src/ui/theme-keys.js) */
    setThemeStepper(step) {
        this.themeStepper = step;
    }

    /**
     * RB the next theme, LB the previous, unless a game control is bound there. They keep the
     * menu's last state of the shoulders: a press begun in Settings (where they change tabs)
     * does not step the theme when Settings closes under it.
     */
    processThemeStepInput(gamepad, slot) {
        if (!this.themeStepper) return;
        const prevState = this.previousStates[slot];
        const bound = new Set(Object.values(this.getGameplayBindingConfig(slot)).map((binding) => binding.index));
        const shoulders = [[BUTTON_MAP.RB, 'menuRB', 1], [BUTTON_MAP.LB, 'menuLB', -1]];
        for (const [index, stateKey, direction] of shoulders) {
            const pressed = !bound.has(index) && Boolean(gamepad.buttons[index]?.pressed);
            if (pressed && !prevState[stateKey]) this.themeStepper(direction);
            prevState[stateKey] = pressed;
        }
    }

    /**
     * Enable Exploration Mode (Infinity: the right stick looks around the tower).
     * @param {{onStick?: (value: number, options: {held: boolean, index: number}) => void,
     *   onGameInput?: () => void, isExploring?: () => boolean}} callbacks
     */
    enableExplorationMode(callbacks) {
        this.explorationCallbacks = callbacks;
        console.log('[Gamepad] Exploration Mode enabled');
    }

    disableExplorationMode() {
        this.explorationCallbacks = null;
        this.previousStates?.forEach?.((state) => {
            if (!state) return;
            state.explorationGameInput = false;
            state.explorationLatch = false;
        });
        console.log('[Gamepad] Exploration Mode disabled');
    }

    /**
     * Process Serenity Mode specific gamepad input
     */
    processSerenityModeInput(gamepad, slot) {
        // Only allow first gamepad to control Serenity Mode
        if (slot !== 0 || !this.serenityModeCallbacks) return;

        // Don't process Serenity input if menu navigation is active (e.g., settings open),
        // unless the Hub is open above that menu: it owns the pad then, and the early return
        // left every button dead until a mouse closed it.
        if (this.menuNavigationEnabled && this.serenityModeCallbacks.isHubOpen?.() !== true) {
            // Log this to debug - this might be why SELECT doesn't work
            const selectPressed = gamepad.buttons[BUTTON_MAP.SELECT]?.pressed;
            if (selectPressed) {
                console.log('[Gamepad] SELECT pressed but menuNavigationEnabled=true, skipping Serenity input!');
            }
            return;
        }

        const prevState = this.previousStates[slot];
        const callbacks = this.serenityModeCallbacks;
        const bindings = this.getSerenityGamepadBindings();
        const buttonActive = (action) => this.isSerenityButtonPressed(gamepad, bindings, action);

        // Resting (Serenity's rest timer has dimmed the screen): any button only wakes it, and
        // nothing else acts until every button is let go.
        const anyPressed = Array.from(gamepad.buttons || []).some((button) => button?.pressed);
        if (callbacks.isResting?.()) {
            if (anyPressed && !prevState.serenityRestWake) callbacks.wakeFromRest?.();
            prevState.serenityRestWake = anyPressed;
            this._serenityHeldAfterWake = true;
            return;
        }
        if (this._serenityHeldAfterWake) {
            if (anyPressed) return;
            this._serenityHeldAfterWake = false;
        }
        prevState.serenityRestWake = anyPressed;
        const onButtonPress = (action, stateKey, handler) => {
            const pressed = buttonActive(action);
            if (pressed && !prevState[stateKey]) {
                handler();
            }
            prevState[stateKey] = pressed;
            return pressed;
        };

        const now = performance.now();
        if (!this._serenityHubToggleCooldown) this._serenityHubToggleCooldown = 0;

        const hubTogglePressed = buttonActive('toggleHub');
        const hubToggleCooldownActive = now - this._serenityHubToggleCooldown < 500;
        if (hubTogglePressed && !prevState.serenityToggleHub && !hubToggleCooldownActive) {
            const hubIsOpen = callbacks.isHubOpen?.();
            console.log('[Gamepad] Serenity hub toggle pressed - Hub is:', hubIsOpen ? 'OPEN' : 'CLOSED');
            callbacks.toggleHub?.();
            this._serenityHubToggleCooldown = now;
        }
        prevState.serenityToggleHub = hubTogglePressed;

        onButtonPress('toggleBreathing', 'serenityToggleBreathing', () => {
            callbacks.toggleBreathing?.();
        });

        onButtonPress('randomTheme', 'serenityRandomTheme', () => {
            callbacks.randomTheme?.();
        });

        onButtonPress('toggleFullscreen', 'serenityToggleFullscreen', () => {
            if (!this.explorationCallbacks) {
                callbacks.toggleFullscreen?.();
            }
        });

        onButtonPress('toggleControlHints', 'serenityToggleControlHints', () => {
            callbacks.toggleHints?.();
        });

        onButtonPress('previousTrack', 'serenityPreviousTrack', () => {
            if (callbacks.isHubOpen?.()) {
                callbacks.switchTabLeft?.();
            } else {
                callbacks.previousTrack?.();
            }
        });

        onButtonPress('nextTrack', 'serenityNextTrack', () => {
            if (callbacks.isHubOpen?.()) {
                callbacks.switchTabRight?.();
            } else {
                callbacks.nextTrack?.();
            }
        });

        onButtonPress('previousBreathingTechnique', 'serenityPreviousBreathingTechnique', () => {
            if (callbacks.isHubOpen?.()) {
                callbacks.navigate?.('up');
            } else {
                callbacks.previousBreathingTechnique?.();
            }
        });

        onButtonPress('nextBreathingTechnique', 'serenityNextBreathingTechnique', () => {
            if (callbacks.isHubOpen?.()) {
                callbacks.navigate?.('down');
            } else {
                callbacks.nextBreathingTechnique?.();
            }
        });

        if (buttonActive('volumeDown')) {
            callbacks.volumeDown?.();
        }

        if (buttonActive('volumeUp')) {
            callbacks.volumeUp?.();
        }

        // Hub-specific controls (only when hub is open)
        if (callbacks.isHubOpen?.()) {
            onButtonPress('confirmSelection', 'serenityConfirmSelection', () => {
                callbacks.confirmSelection?.();
            });

            onButtonPress('closeHub', 'serenityCloseHub', () => {
                callbacks.closeHub?.();
            });

            onButtonPress('navigateLeft', 'serenityNavigateLeft', () => {
                callbacks.navigate?.('left');
            });

            onButtonPress('navigateRight', 'serenityNavigateRight', () => {
                callbacks.navigate?.('right');
            });

            // D-Pad for navigation
            const stickLeft = this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_X);
            if (stickLeft && !prevState.serenityStickLeft) {
                callbacks.navigate?.('left');
            }
            prevState.serenityStickLeft = stickLeft;

            const stickRight = this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_X);
            if (stickRight && !prevState.serenityStickRight) {
                callbacks.navigate?.('right');
            }
            prevState.serenityStickRight = stickRight;

            const stickUp = this.isAxisNegative(gamepad, AXIS_MAP.LEFT_STICK_Y);
            if (stickUp && !prevState.serenityStickUp) {
                callbacks.navigate?.('up');
            }
            prevState.serenityStickUp = stickUp;

            const stickDown = this.isAxisPositive(gamepad, AXIS_MAP.LEFT_STICK_Y);
            if (stickDown && !prevState.serenityStickDown) {
                callbacks.navigate?.('down');
            }
            prevState.serenityStickDown = stickDown;

            // Right stick for scrolling
            const rightStickY = gamepad.axes[AXIS_MAP.RIGHT_STICK_Y];
            if (Math.abs(rightStickY) > this.deadzone) {
                callbacks.scrollContent?.(rightStickY * 15);
            }
            // A press that closes the Hub must not also reach the session behind it.
            prevState.serenitySessionPrimary = buttonActive('confirmSelection');
            prevState.serenitySessionBack = buttonActive('closeHub');
            prevState.serenityWorldLeft = buttonActive('navigateLeft');
            prevState.serenityWorldRight = buttonActive('navigateRight');
        } else {
            // With the Hub closed, A and B belong to a Hale session: A breathes in during an open
            // hold (or pauses), B asks to end; on the session screens they press and step back.
            // With no session, A touches the world.
            onButtonPress('confirmSelection', 'serenitySessionPrimary', () => {
                callbacks.sessionPrimary?.();
            });
            onButtonPress('closeHub', 'serenitySessionBack', () => {
                callbacks.sessionBack?.();
            });
            // The D-pad's left and right change the theme (or, in a practice, its world).
            onButtonPress('navigateLeft', 'serenityWorldLeft', () => {
                callbacks.stepWorld?.(-1);
            });
            onButtonPress('navigateRight', 'serenityWorldRight', () => {
                callbacks.stepWorld?.(1);
            });
            prevState.serenityConfirmSelection = buttonActive('confirmSelection');
            prevState.serenityCloseHub = buttonActive('closeHub');
            prevState.serenityNavigateLeft = buttonActive('navigateLeft');
            prevState.serenityNavigateRight = buttonActive('navigateRight');
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.disable();
        this.clearFixedTickInput({ dropPhysicalLatches: true });
        this.fixedTickInputAdapter = null;
        this.disableSerenityMode();
        this.bindingConfigCache.fill(null);
        this.serenityBindingCache = null;
        window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
        window.removeEventListener('gamepaddisconnected', this.handleGamepadDisconnected);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        this.isInitialized = false;
        console.log('[Gamepad] Controller manager destroyed');
    }
}
