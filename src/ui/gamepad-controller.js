/**
 * @fileoverview Gamepad Controller for Serenity Blocks
 * Handles Xbox controllers and other Bluetooth gamepads
 * Supports up to 4 controllers for local multiplayer
 */

import { performanceMonitor } from '../utils/performance-monitor.js';

/**
 * Button mappings for standard gamepad (Xbox layout)
 * Based on the W3C Gamepad API standard mapping
 */
const BUTTON_MAP = {
    A: 0,           // Bottom button (A on Xbox, Cross on PS)
    B: 1,           // Right button (B on Xbox, Circle on PS)
    X: 2,           // Left button (X on Xbox, Square on PS)
    Y: 3,           // Top button (Y on Xbox, Triangle on PS)
    LB: 4,          // Left bumper
    RB: 5,          // Right bumper
    LT: 6,          // Left trigger
    RT: 7,          // Right trigger
    SELECT: 8,      // Select/Back/Share button
    START: 9,       // Start/Menu/Options button
    L_STICK: 10,    // Left stick press
    R_STICK: 11,    // Right stick press
    D_UP: 12,       // D-pad up
    D_DOWN: 13,     // D-pad down
    D_LEFT: 14,     // D-pad left
    D_RIGHT: 15,    // D-pad right
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
        this.connected = [false, false, false, false];
        this.deadzone = 0.25; // Analog stick deadzone
        this.pollInterval = null;
        this.gameActions = null;
        this.enabled = false;
        
        // Serenity Mode support
        this.serenityModeActive = false;
        this.serenityModeCallbacks = null;

        // DAS (Delayed Auto Shift) timers for each gamepad
        this.dasTimers = [
            { left: null, right: null, down: null },
            { left: null, right: null, down: null },
            { left: null, right: null, down: null },
            { left: null, right: null, down: null }
        ];
        this.dasDelay = 120;
        this.dasInterval = 40;

        // Custom bindings for each player
        this.customBindings = [null, null, null, null];

        // Menu navigation state
        this.menuNavigationEnabled = false;
        this.menuNavigationRepeatDelay = 300; // ms before repeat starts
        this.menuNavigationRepeatInterval = 150; // ms between repeats

        // Callback functions
        this.onPauseCallback = null;
        this.onResumeCallback = null;
        // Gate menu toggles until Start is released after a press
        this.waitingForStartRelease = [false, false];
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

        // Listen for gamepad connections
        window.addEventListener('gamepadconnected', (e) => this.onGamepadConnected(e));
        window.addEventListener('gamepaddisconnected', (e) => this.onGamepadDisconnected(e));

        // Check for already connected gamepads
        this.checkConnectedGamepads();

        console.log('[Gamepad] Gamepad support initialized');
        return true;
    }

    /**
     * Check for already connected gamepads on initialization
     */
    checkConnectedGamepads() {
        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length && i < 2; i++) {
            if (gamepads[i]) {
                this.onGamepadConnected({ gamepad: gamepads[i] });
            }
        }
    }

    /**
     * Handle gamepad connection
     */
    onGamepadConnected(event) {
        const gamepad = event.gamepad;
        const index = gamepad.index;

        // Assign to first available slot (0 or 1)
        let slot = -1;
        if (!this.connected[0]) {
            slot = 0;
        } else if (!this.connected[1]) {
            slot = 1;
        }

        if (slot !== -1) {
            this.gamepads[slot] = gamepad;
            this.connected[slot] = true;
            this.previousStates[slot] = {};

            console.log(`[Gamepad] Controller ${slot + 1} connected:`, gamepad.id);

            // Dispatch custom event for UI updates
            window.dispatchEvent(new CustomEvent('gamepadStatusChanged', {
                detail: {
                    slot,
                    connected: true,
                    name: gamepad.id,
                }
            }));

            // Start polling if not already running
            if (!this.pollInterval && this.enabled) {
                this.startPolling();
            }
        } else {
            console.warn('[Gamepad] Maximum controllers (2) already connected');
        }
    }

    /**
     * Handle gamepad disconnection
     */
    onGamepadDisconnected(event) {
        const gamepad = event.gamepad;

        // Find which slot this gamepad was in
        for (let i = 0; i < 2; i++) {
            if (this.gamepads[i] && this.gamepads[i].index === gamepad.index) {
                console.log(`[Gamepad] Controller ${i + 1} disconnected:`, gamepad.id);

                this.gamepads[i] = null;
                this.connected[i] = false;
                this.previousStates[i] = {};
                this.clearDasTimers(i);

                // Dispatch custom event for UI updates
                window.dispatchEvent(new CustomEvent('gamepadStatusChanged', {
                    detail: {
                        slot: i,
                        connected: false,
                    }
                }));

                break;
            }
        }

        // Stop polling if no gamepads connected
        if (!this.connected[0] && !this.connected[1]) {
            this.stopPolling();
        }
    }

    /**
     * Set game actions for input handling
     */
    setGameActions(gameActions) {
        this.gameActions = gameActions;
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
        if ((this.connected[0] || this.connected[1]) && !this.pollInterval) {
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
    }

    /**
     * Start polling gamepads
     */
    startPolling() {
        if (this.pollInterval) return;

        this.pollInterval = setInterval(() => {
            this.poll();
        }, 16); // ~60 FPS

        console.log('[Gamepad] Started polling');
    }

    /**
     * Stop polling gamepads
     */
    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
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

        for (let slot = 0; slot < 2; slot++) {
            if (!this.connected[slot]) continue;

            const gamepad = this.gamepads[slot];
            if (!gamepad) continue;

            // Get fresh gamepad state
            const freshGamepad = gamepads[gamepad.index];
            if (!freshGamepad) continue;

            // Process menu navigation if enabled, otherwise process game input
            if (this.menuNavigationEnabled) {
                this.processMenuNavigation(freshGamepad, slot);
            } else {
                // Always check for Start button to open settings, even without gameActions
            this.processGamepadInput(freshGamepad, slot);
            }
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
                if (firstFocusable.id === 'settings-btn' || firstFocusable.id === 'settings-btn-mp') {
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
    processMenuNavigation(gamepad, slot) {
        const prevState = this.previousStates[slot];

        // Only allow first gamepad to navigate menus
        if (slot !== 0) return;

        // Exit select editing if focus changed away
        if (this.selectEditState.active &&
            document.activeElement !== this.selectEditState.element) {
            this.exitSelectEditMode({ cancel: true });
        }

        // D-pad Up / Left stick up - Navigate up
        const upPressed = gamepad.buttons[BUTTON_MAP.D_UP]?.pressed || 
                         gamepad.axes[AXIS_MAP.LEFT_STICK_Y] < -this.deadzone;
        if (upPressed && !prevState.menuUp) {
            if (!(this.selectEditState.active &&
                this.handleControlAdjustment('up'))) {
                this.navigateMenu('up');
            }
        }
        prevState.menuUp = upPressed;

        // D-pad Down / Left stick down - Navigate down
        const downPressed = gamepad.buttons[BUTTON_MAP.D_DOWN]?.pressed || 
                           gamepad.axes[AXIS_MAP.LEFT_STICK_Y] > this.deadzone;
        if (downPressed && !prevState.menuDown) {
            if (!(this.selectEditState.active &&
                this.handleControlAdjustment('down'))) {
                this.navigateMenu('down');
            }
        }
        prevState.menuDown = downPressed;

        // D-pad Left / Left stick left - Navigate left (tabs)
        const leftPressed = gamepad.buttons[BUTTON_MAP.D_LEFT]?.pressed || 
                           gamepad.axes[AXIS_MAP.LEFT_STICK_X] < -this.deadzone;
        if (leftPressed && !prevState.menuLeft) {
            if (!this.handleControlAdjustment('left')) {
                this.navigateMenu('left');
            }
        }
        prevState.menuLeft = leftPressed;

        // D-pad Right / Left stick right - Navigate right (tabs)
        const rightPressed = gamepad.buttons[BUTTON_MAP.D_RIGHT]?.pressed || 
                            gamepad.axes[AXIS_MAP.LEFT_STICK_X] > this.deadzone;
        if (rightPressed && !prevState.menuRight) {
            if (!this.handleControlAdjustment('right')) {
                this.navigateMenu('right');
            }
        }
        prevState.menuRight = rightPressed;

        // A button - Select/Activate
        const aPressed = gamepad.buttons[BUTTON_MAP.A]?.pressed;
        if (aPressed && !prevState.menuSelect) {
            this.activateMenuItem();
        }
        prevState.menuSelect = aPressed;

        // B button - Back/Close
        const bPressed = gamepad.buttons[BUTTON_MAP.B]?.pressed;
        if (bPressed && !prevState.menuBack) {
            if (this.selectEditState.active) {
                this.exitSelectEditMode({ cancel: true });
            } else {
                this.navigateMenuBack();
            }
        }
        prevState.menuBack = bPressed;

        // Start button - Open/Close settings
        const startPressed = gamepad.buttons[BUTTON_MAP.START]?.pressed;
        if (this.waitingForStartRelease[slot]) {
            if (!startPressed) {
                this.waitingForStartRelease[slot] = false;
            }
        } else if (startPressed && !prevState.menuStart) {
            this.toggleSettings(slot);
        }
        prevState.menuStart = startPressed;
    }

    /**
     * Navigate menu in a direction
     */
    navigateMenu(direction) {
        // Get currently focused element
        let current = document.activeElement;
        
        // If nothing is focused, focus the first focusable element
        if (!current || current === document.body) {
            const firstFocusable = this.getFirstFocusableElement();
            if (firstFocusable) {
                firstFocusable.focus();
            }
            return;
        }

        const focusable = this.getFocusableElements();
        const currentIndex = focusable.indexOf(current);

        if (currentIndex === -1) {
            if (focusable.length > 0) {
                focusable[0].focus();
            }
            return;
        }

        let nextIndex = currentIndex;

        if (direction === 'up') {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : focusable.length - 1;
        } else if (direction === 'down') {
            nextIndex = currentIndex < focusable.length - 1 ? currentIndex + 1 : 0;
        } else if (direction === 'left') {
            // Navigate to previous tab
            this.navigateTab(-1);
            return;
        } else if (direction === 'right') {
            // Navigate to next tab
            this.navigateTab(1);
            return;
        }

        if (focusable[nextIndex]) {
            focusable[nextIndex].focus();
            focusable[nextIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    /**
     * Navigate between tabs
     */
    navigateTab(direction) {
        // Check if in settings modal
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('active')) {
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
        
        // Check if in controls subtabs
        const controlsSubtabs = Array.from(document.querySelectorAll('.controls-subtab'));
        const activeSubtab = document.querySelector('.controls-subtab.active');
        
        if (activeSubtab && controlsSubtabs.length > 0) {
            const currentIndex = controlsSubtabs.indexOf(activeSubtab);
            let nextIndex = currentIndex + direction;
            
            if (nextIndex < 0) nextIndex = controlsSubtabs.length - 1;
            if (nextIndex >= controlsSubtabs.length) nextIndex = 0;
            
            controlsSubtabs[nextIndex].click();
            controlsSubtabs[nextIndex].focus();
        }
    }

    /**
     * Activate the currently focused menu item
     */
    activateMenuItem() {
        const current = document.activeElement;
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
        // Check if settings modal is open
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('active')) {
            const closeBtn = document.getElementById('close-settings');
            if (closeBtn) {
                closeBtn.click();
            }
            return;
        }

        // Check if high scores modal is open
        const highScoresModal = document.getElementById('high-scores-modal');
        if (highScoresModal && highScoresModal.classList.contains('active')) {
            const closeBtn = document.getElementById('close-high-scores');
            if (closeBtn) {
                closeBtn.click();
            }
            return;
        }
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
            // Settings is closed, open it via settings button (which handles pause)
            console.log('[Gamepad] Settings is closed, opening via button...');
            
            // Prevent rapid toggling by adding a small delay flag
            if (this._toggleCooldown) {
                console.log('[Gamepad] Toggle on cooldown, ignoring');
                return;
            }
            this._toggleCooldown = true;
            setTimeout(() => { this._toggleCooldown = false; }, 500);
            
            const settingsBtn = document.getElementById('settings-btn') || 
                               document.getElementById('settings-btn-mp');
            if (settingsBtn) {
                console.log('[Gamepad] Clicking settings button');
                settingsBtn.click();
            } else {
                console.error('[Gamepad] Settings button not found!');
            }
        }
    }

    /**
     * Get all focusable elements in the current view
     */
    getFocusableElements() {
        const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const elements = Array.from(document.querySelectorAll(selector));
        
        // Filter out hidden elements
        return elements.filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   el.offsetParent !== null;
        });
    }

    /**
     * Get the first focusable element
     */
    getFirstFocusableElement() {
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

        if (this.selectEditState.active &&
            current === this.selectEditState.element &&
            current.matches('select')) {
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
        let left = rect.left;

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
        const prevState = this.previousStates[slot];
        
        // Handle START button for settings (for player 1 only)
        // BUT skip if menu navigation is enabled (menus handle their own START button)
        if (slot === 0 && !this.menuNavigationEnabled) {
            const startPressed = gamepad.buttons[BUTTON_MAP.START]?.pressed;
            
            if (this.waitingForStartRelease[slot]) {
                if (!startPressed) {
                    this.waitingForStartRelease[slot] = false;
                }
            } else if (startPressed && !prevState.menuStart) {
                this.toggleSettings(slot);
            }
            prevState.menuStart = startPressed;
        }
        
        // If in Serenity Mode, use Serenity Mode input handling
        if (this.serenityModeActive && this.serenityModeCallbacks) {
            this.processSerenityModeInput(gamepad, slot);
            return;
        }
        
        // Use custom bindings if available, otherwise use default
        const customBinding = this.customBindings[slot];
        const config = convertBindingsToConfig(customBinding);

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
                    pause: this.gameActions.togglePause,
                };
                break;
            case 1: // Player 2
                actions = {
                    move: this.gameActions.moveP2,
                    rotate: this.gameActions.rotateP2,
                    softDrop: this.gameActions.softDropP2,
                    hardDrop: this.gameActions.hardDropP2,
                    pause: this.gameActions.togglePause,
                };
                break;
            case 2: // Player 3
                actions = {
                    move: this.gameActions.moveP3,
                    rotate: this.gameActions.rotateP3,
                    softDrop: this.gameActions.softDropP3,
                    hardDrop: this.gameActions.hardDropP3,
                    pause: this.gameActions.togglePause,
                };
                break;
            case 3: // Player 4
                actions = {
                    move: this.gameActions.moveP4,
                    rotate: this.gameActions.rotateP4,
                    softDrop: this.gameActions.softDropP4,
                    hardDrop: this.gameActions.hardDropP4,
                    pause: this.gameActions.togglePause,
                };
                break;
            default:
                console.warn(`[Gamepad] Invalid player slot: ${slot}`);
                return;
        }

        // Process movement (D-pad left/right or left stick X)
        const leftPressed = this.isButtonPressed(gamepad, config.moveLeft) ||
                          this.isAxisNegative(gamepad, config.moveLeft.axisNegative);
        const rightPressed = this.isButtonPressed(gamepad, config.moveRight) ||
                           this.isAxisPositive(gamepad, config.moveRight.axisPositive);

        const prevLeft = prevState.moveLeft || false;
        const prevRight = prevState.moveRight || false;

        // Handle left movement
        if (leftPressed && !prevLeft) {
            // Initial press
            if (actions.move) {
                actions.move(-1);
                performanceMonitor.recordInputAction();
                this.startDas(slot, 'left', () => actions.move(-1));
            }
        } else if (!leftPressed && prevLeft) {
            // Release
            this.stopDas(slot, 'left');
        }

        // Handle right movement
        if (rightPressed && !prevRight) {
            // Initial press
            if (actions.move) {
                actions.move(1);
                performanceMonitor.recordInputAction();
                this.startDas(slot, 'right', () => actions.move(1));
            }
        } else if (!rightPressed && prevRight) {
            // Release
            this.stopDas(slot, 'right');
        }

        prevState.moveLeft = leftPressed;
        prevState.moveRight = rightPressed;

        // Process soft drop (D-pad down or left stick Y)
        const downPressed = this.isButtonPressed(gamepad, config.softDrop) ||
                          this.isAxisPositive(gamepad, config.softDrop.axisPositive);
        const prevDown = prevState.softDrop || false;

        if (downPressed && !prevDown) {
            if (actions.softDrop) {
                actions.softDrop();
                performanceMonitor.recordInputAction();
                this.startDas(slot, 'down', () => actions.softDrop(), 50);
            }
        } else if (!downPressed && prevDown) {
            this.stopDas(slot, 'down');
        }

        prevState.softDrop = downPressed;

        // Process rotation buttons (edge-triggered)
        if (this.isButtonJustPressed(gamepad, config.rotateRight, prevState, 'rotateRight')) {
            if (actions.rotate) {
                actions.rotate('right');
                performanceMonitor.recordInputAction();
            }
        }

        if (this.isButtonJustPressed(gamepad, config.rotateLeft, prevState, 'rotateLeft')) {
            if (actions.rotate) {
                actions.rotate('left');
                performanceMonitor.recordInputAction();
            }
        }

        if (this.isButtonJustPressed(gamepad, config.flip, prevState, 'flip')) {
            if (actions.rotate) {
                actions.rotate('flip');
                performanceMonitor.recordInputAction();
            }
        }

        // Process hard drop (edge-triggered)
        if (this.isButtonJustPressed(gamepad, config.hardDrop, prevState, 'hardDrop')) {
            if (actions.hardDrop) {
                actions.hardDrop();
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
        if (axisIndex === undefined) return false;
        const value = gamepad.axes[axisIndex];
        return value < -this.deadzone;
    }

    /**
     * Check if an axis is in the positive direction beyond deadzone
     */
    isAxisPositive(gamepad, axisIndex) {
        if (axisIndex === undefined) return false;
        const value = gamepad.axes[axisIndex];
        return value > this.deadzone;
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
    startDas(slot, direction, action, interval = null) {
        const timers = this.dasTimers[slot];
        if (timers[direction]) return; // Already running

        const dasInterval = interval || this.dasInterval;

        timers[direction] = setTimeout(() => {
            timers[direction] = setInterval(action, dasInterval);
        }, this.dasDelay);
    }

    /**
     * Stop DAS for a specific direction
     */
    stopDas(slot, direction) {
        const timers = this.dasTimers[slot];
        if (timers[direction]) {
            clearTimeout(timers[direction]);
            clearInterval(timers[direction]);
            timers[direction] = null;
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
        for (let i = 0; i < 2; i++) {
            this.clearDasTimers(i);
        }
    }

    /**
     * Get connection status
     */
    getConnectionStatus() {
        return {
            controller1: {
                connected: this.connected[0],
                name: this.gamepads[0]?.id || null,
            },
            controller2: {
                connected: this.connected[1],
                name: this.gamepads[1]?.id || null,
            }
        };
    }

    /**
     * Update DAS settings
     */
    updateDasSettings(dasDelay, dasInterval) {
        this.dasDelay = dasDelay;
        this.dasInterval = dasInterval;
    }

    /**
     * Update custom bindings for players
     * @param {Object} player1Bindings - Player 1 gamepad bindings
     * @param {Object} player2Bindings - Player 2 gamepad bindings
     */
    updateBindings(player1Bindings, player2Bindings) {
        this.customBindings[0] = player1Bindings;
        this.customBindings[1] = player2Bindings;
        console.log('[Gamepad] Updated custom bindings');
    }

    /**
     * Update deadzone setting
     * @param {number} deadzone - New deadzone value (0-1)
     */
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
     * Disable Serenity Mode gamepad input
     */
    disableSerenityMode() {
        this.serenityModeActive = false;
        this.serenityModeCallbacks = null;
        console.log('[Gamepad] Serenity Mode disabled');
    }

    /**
     * Process Serenity Mode specific gamepad input
     */
    processSerenityModeInput(gamepad, slot) {
        // Only allow first gamepad to control Serenity Mode
        if (slot !== 0 || !this.serenityModeCallbacks) return;

        // Don't process Serenity input if menu navigation is active (e.g., settings open)
        if (this.menuNavigationEnabled) {
            return;
        }

        const prevState = this.previousStates[slot];
        const callbacks = this.serenityModeCallbacks;

        // Y button - Toggle Serenity Hub
        const yPressed = gamepad.buttons[BUTTON_MAP.Y]?.pressed;
        if (yPressed && !prevState.serenityY) {
            callbacks.toggleHub?.();
        }
        prevState.serenityY = yPressed;

        // X button - Toggle Breathing
        const xPressed = gamepad.buttons[BUTTON_MAP.X]?.pressed;
        if (xPressed && !prevState.serenityX) {
            callbacks.toggleBreathing?.();
        }
        prevState.serenityX = xPressed;

        // L3 (Left stick click) - Random Theme
        const l3Pressed = gamepad.buttons[BUTTON_MAP.L_STICK]?.pressed;
        if (l3Pressed && !prevState.serenityL3) {
            callbacks.randomTheme?.();
        }
        prevState.serenityL3 = l3Pressed;

        // R3 (Right stick click) - Toggle Fullscreen
        const r3Pressed = gamepad.buttons[BUTTON_MAP.R_STICK]?.pressed;
        if (r3Pressed && !prevState.serenityR3) {
            callbacks.toggleFullscreen?.();
        }
        prevState.serenityR3 = r3Pressed;

        // LB - Previous Track
        const lbPressed = gamepad.buttons[BUTTON_MAP.LB]?.pressed;
        if (lbPressed && !prevState.serenityLB) {
            callbacks.previousTrack?.();
        }
        prevState.serenityLB = lbPressed;

        // RB - Next Track
        const rbPressed = gamepad.buttons[BUTTON_MAP.RB]?.pressed;
        if (rbPressed && !prevState.serenityRB) {
            callbacks.nextTrack?.();
        }
        prevState.serenityRB = rbPressed;

        // SELECT - Toggle Button Hints
        const selectPressed = gamepad.buttons[BUTTON_MAP.SELECT]?.pressed;
        if (selectPressed && !prevState.serenitySelect) {
            callbacks.toggleHints?.();
        }
        prevState.serenitySelect = selectPressed;

        // D-Pad Up - Previous Breathing Technique (when hub is closed)
        const dpadUpPressed = gamepad.buttons[BUTTON_MAP.D_UP]?.pressed;
        if (dpadUpPressed && !prevState.serenityDPadUp) {
            const hubOpen = callbacks.isHubOpen?.();
            console.log('[Gamepad] D-Pad Up pressed, hub open:', hubOpen);
            if (!hubOpen) {
                console.log('[Gamepad] Calling previousBreathingTechnique');
                callbacks.previousBreathingTechnique?.();
            }
        }
        prevState.serenityDPadUp = dpadUpPressed;

        // D-Pad Down - Next Breathing Technique (when hub is closed)
        const dpadDownPressed = gamepad.buttons[BUTTON_MAP.D_DOWN]?.pressed;
        if (dpadDownPressed && !prevState.serenityDPadDown) {
            const hubOpen = callbacks.isHubOpen?.();
            console.log('[Gamepad] D-Pad Down pressed, hub open:', hubOpen);
            if (!hubOpen) {
                console.log('[Gamepad] Calling nextBreathingTechnique');
                callbacks.nextBreathingTechnique?.();
            }
        }
        prevState.serenityDPadDown = dpadDownPressed;

        // NOTE: START button is handled by the global toggleSettings function,
        // not here in Serenity Mode to avoid conflicts

        // Triggers for volume (analog)
        const ltValue = gamepad.buttons[BUTTON_MAP.LT].value;
        const rtValue = gamepad.buttons[BUTTON_MAP.RT].value;

        if (ltValue > 0.3) {
            callbacks.volumeDown?.();
        }

        if (rtValue > 0.3) {
            callbacks.volumeUp?.();
        }

        // Hub-specific controls (only when hub is open)
        if (callbacks.isHubOpen?.()) {
            // A button - Confirm selection
            const aPressed = gamepad.buttons[BUTTON_MAP.A]?.pressed;
            if (aPressed && !prevState.serenityA) {
                callbacks.confirmSelection?.();
            }
            prevState.serenityA = aPressed;

            // B button - Close hub
            const bPressed = gamepad.buttons[BUTTON_MAP.B]?.pressed;
            if (bPressed && !prevState.serenityB) {
                callbacks.closeHub?.();
            }
            prevState.serenityB = bPressed;

            // D-Pad for navigation
            const dpadLeft = gamepad.buttons[BUTTON_MAP.D_LEFT]?.pressed ||
                           gamepad.axes[AXIS_MAP.LEFT_STICK_X] < -this.deadzone;
            if (dpadLeft && !prevState.serenityDLeft) {
                callbacks.switchTabLeft?.();
            }
            prevState.serenityDLeft = dpadLeft;

            const dpadRight = gamepad.buttons[BUTTON_MAP.D_RIGHT]?.pressed ||
                            gamepad.axes[AXIS_MAP.LEFT_STICK_X] > this.deadzone;
            if (dpadRight && !prevState.serenityDRight) {
                callbacks.switchTabRight?.();
            }
            prevState.serenityDRight = dpadRight;

            const dpadUp = gamepad.buttons[BUTTON_MAP.D_UP]?.pressed ||
                         gamepad.axes[AXIS_MAP.LEFT_STICK_Y] < -this.deadzone;
            if (dpadUp && !prevState.serenityDUp) {
                callbacks.navigateUp?.();
            }
            prevState.serenityDUp = dpadUp;

            const dpadDown = gamepad.buttons[BUTTON_MAP.D_DOWN]?.pressed ||
                           gamepad.axes[AXIS_MAP.LEFT_STICK_Y] > this.deadzone;
            if (dpadDown && !prevState.serenityDDown) {
                callbacks.navigateDown?.();
            }
            prevState.serenityDDown = dpadDown;

            // Right stick for scrolling
            const rightStickY = gamepad.axes[AXIS_MAP.RIGHT_STICK_Y];
            if (Math.abs(rightStickY) > this.deadzone) {
                callbacks.scrollContent?.(rightStickY * 15);
            }
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.disable();
        this.disableSerenityMode();
        window.removeEventListener('gamepadconnected', this.onGamepadConnected);
        window.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected);
        console.log('[Gamepad] Controller manager destroyed');
    }
}
