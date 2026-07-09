/**
 * @fileoverview Settings Management for Serenity Blocks
 * Handles game settings, persistence to localStorage, and settings UI
 */

import { DEFAULT_SETTINGS } from '../core/constants.js';
import { eventBus, EVENTS } from '../events/event-bus.js';
import { normalizeCursorSettings } from './components/custom-cursor.js';

const DEFAULT_CONFIG = {
    gameMode: 'single',
    dasDelay: 120,
    dasInterval: 40,
    softDropInterval: 50,
    musicTrack: 'Ambient',
    soundSet: 'Zen',
    musicVolume: 1.0,
    sfxVolume: 1.0,
    backgroundMode: 'Level', // 'Level', 'Specific', 'Random'
    backgroundTheme: 'forest',
    themeLinkedMode: false,
    themeLinkedSfx: false,
    autoThemeChange: false,
    randomThemeInterval: 60,
    pieceLockRipple: true,
    pieceLockRippleColor: '#64c8ff',
    comboPopupEffect: true,
    lineClearEffects: true,
    backgroundComboEffects: true,
    customCursorEnabled: true,
    customCursorIntensity: 'standard',
    customCursorVisibilityPreset: 'standard',
    customCursorReducedMotion: 'system',
    tornadoThemeParams: {
        emissiveColor: '#ff8a3b',
        timeScale: 1.0,
        ribbonWidth: 1.0,
        parabolaStrength: 1.0,
        parabolaOffset: 0.35,
        parabolaAmplitude: 0.45,
        bloomStrength: 1.0,
        bloomRadius: 0.2,
    },
    // Tetromino Visual Settings
    themeBasedTetrominos: true, // Use theme-specific tetromino colors and effects
    controlScheme: 'Keyboard',
    gamepadEnabled: true,
    gamepadDeadzone: 0.25,
    // Display Settings (Phase 1)
    displayMode: 'windowed', // 'windowed' | 'fullscreen' | 'borderless'
    // Resolution is always auto - use renderScale for performance tuning
    renderScale: 1.0, // 0.5 | 0.75 | 1.0 | 1.25 - controls background theme render resolution
    vsyncEnabled: true,
    targetFrameRate: 60, // 30 | 60 | 120 | 144 | 240 | 0 (unlimited)
    effectQuality: 'High', // 'Minimal' | 'Low' | 'Medium' | 'High' | 'Ultra' | 'Extreme' | 'Custom'
    // Advanced Graphics Settings
    enableAntialiasing: true,
    enableMotionBlur: false,
    enableBloom: true,
    enableShadows: true,
    particleQuality: 'high', // 'low' | 'medium' | 'high' | 'ultra'
    textureQuality: 'high', // 'low' | 'medium' | 'high' | 'ultra'
    showFPSCounter: false,
    // Background Tab Behavior - throttle rendering when tab is hidden
    backgroundTabBehavior: 'reduce', // 'pause' | 'reduce' | 'continue'
    keyBindings: {
        moveLeft: 'ArrowLeft',
        moveRight: 'ArrowRight',
        rotateRight: 'ArrowUp',
        rotateLeft: 'z',
        flip: 'a',
        softDrop: 'ArrowDown',
        hardDrop: 'Space',
    },
    player2KeyBindings: {
        moveLeft: 'a',
        moveRight: 'd',
        rotateRight: 'w',
        rotateLeft: 'q',
        flip: 'e',
        softDrop: 's',
        hardDrop: 'Shift',
    },
    serenityKeyBindings: {
        toggleHub: 'h',
        toggleBreathing: 'Space',
        cycleBreathingTechnique: 't',
        randomTheme: 'b',
        toggleFullscreen: 'f',
        toggleControlHints: '/',
        exitToMenu: 'Escape',
    },
    gamepadBindings: {
        moveLeft: 14, // D-pad Left
        moveRight: 15, // D-pad Right
        rotateRight: 0, // A Button
        rotateLeft: 3, // Y Button
        flip: 2, // X Button
        softDrop: 13, // D-pad Down
        hardDrop: 1, // B Button
        pause: 9, // Start Button
    },
    player2GamepadBindings: {
        moveLeft: 14, // D-pad Left
        moveRight: 15, // D-pad Right
        rotateRight: 0, // A Button
        rotateLeft: 3, // Y Button
        flip: 2, // X Button
        softDrop: 13, // D-pad Down
        hardDrop: 1, // B Button
        pause: 9, // Start Button
    },
    player3GamepadBindings: {
        moveLeft: 14,
        moveRight: 15,
        rotateRight: 0,
        rotateLeft: 3,
        flip: 2,
        softDrop: 13,
        hardDrop: 1,
        pause: 9,
    },
    player4GamepadBindings: {
        moveLeft: 14,
        moveRight: 15,
        rotateRight: 0,
        rotateLeft: 3,
        flip: 2,
        softDrop: 13,
        hardDrop: 1,
        pause: 9,
    },
    serenityGamepadBindings: {
        toggleHub: 3, // Y Button
        toggleBreathing: 2, // X Button
        randomTheme: 10, // Left stick click
        toggleFullscreen: 11, // Right stick click
        previousTrack: 4, // Left bumper
        nextTrack: 5, // Right bumper
        volumeDown: 6, // Left trigger
        volumeUp: 7, // Right trigger
        toggleControlHints: 8, // Select/Share
        openSettings: 9, // Start/Options
        previousBreathingTechnique: 12, // D-pad Up
        nextBreathingTechnique: 13, // D-pad Down
        confirmSelection: 0, // A Button
        closeHub: 1, // B Button
        navigateLeft: 14, // D-pad Left
        navigateRight: 15, // D-pad Right
    },
};

const KEYBOARD_BINDING_ACTIONS = [
    'moveLeft',
    'moveRight',
    'rotateRight',
    'rotateLeft',
    'flip',
    'softDrop',
    'hardDrop',
];

const SERENITY_KEYBOARD_BINDING_ACTIONS = [
    'toggleHub',
    'toggleBreathing',
    'cycleBreathingTechnique',
    'randomTheme',
    'toggleFullscreen',
    'toggleControlHints',
    'exitToMenu',
];

const SERENITY_GAMEPAD_BINDING_ACTIONS = [
    'toggleHub',
    'toggleBreathing',
    'randomTheme',
    'toggleFullscreen',
    'previousTrack',
    'nextTrack',
    'volumeDown',
    'volumeUp',
    'toggleControlHints',
    'openSettings',
    'previousBreathingTechnique',
    'nextBreathingTechnique',
    'confirmSelection',
    'closeHub',
    'navigateLeft',
    'navigateRight',
];

function sanitizeBindings(bindings, fallbackBindings, actions = KEYBOARD_BINDING_ACTIONS) {
    const source = (bindings && typeof bindings === 'object') ? bindings : {};
    const sanitized = {};

    actions.forEach((action) => {
        const value = source[action];
        if (typeof value === 'string' && value.length > 0) {
            sanitized[action] = value;
        } else {
            sanitized[action] = fallbackBindings[action];
        }
    });

    return sanitized;
}

const sanitizePlayer1KeyBindings = (bindings) => sanitizeBindings(bindings, DEFAULT_CONFIG.keyBindings);
const sanitizePlayer2KeyBindings = (bindings) => sanitizeBindings(bindings, DEFAULT_CONFIG.player2KeyBindings);
const sanitizeSerenityKeyBindings = (bindings) => sanitizeBindings(
    bindings,
    DEFAULT_CONFIG.serenityKeyBindings,
    SERENITY_KEYBOARD_BINDING_ACTIONS,
);

function sanitizeButtonBindings(bindings, fallbackBindings, actions) {
    const source = (bindings && typeof bindings === 'object') ? bindings : {};
    const sanitized = {};

    actions.forEach((action) => {
        const value = source[action];
        if (Number.isInteger(value) && value >= 0) {
            sanitized[action] = value;
        } else {
            sanitized[action] = fallbackBindings[action];
        }
    });

    return sanitized;
}

const sanitizeSerenityGamepadBindings = (bindings) => sanitizeButtonBindings(
    bindings,
    DEFAULT_CONFIG.serenityGamepadBindings,
    SERENITY_GAMEPAD_BINDING_ACTIONS,
);

const GAMEPAD_BINDING_KEYS = [
    'gamepadBindings',
    'player2GamepadBindings',
    'player3GamepadBindings',
    'player4GamepadBindings',
];

const DEFAULT_GAMEPAD_BINDINGS = [
    DEFAULT_CONFIG.gamepadBindings,
    DEFAULT_CONFIG.player2GamepadBindings,
    DEFAULT_CONFIG.player3GamepadBindings,
    DEFAULT_CONFIG.player4GamepadBindings,
];

function applyCursorSettingDefaults(settings) {
    return {
        ...settings,
        ...normalizeCursorSettings(settings),
    };
}

/**
 * Settings manager class
 */
export class SettingsManager {
    constructor() {
        this.settings = applyCursorSettingDefaults({ ...DEFAULT_CONFIG });
        this.STORAGE_KEY = 'serenityBlocksSettings';
        this.didLoadFromStorage = false;
    }

    /**
     * Gets current settings
     * @returns {Object} Current settings
     */
    get() {
        return this.settings;
    }

    /**
     * Updates settings
     * @param {Object} newSettings - Settings to update
     * @param {boolean} emit - Whether to emit change event
     */
    update(newSettings, emit = true) {
        const oldSettings = { ...this.settings };
        const previousSettings = this.settings;
        this.settings = { ...this.settings, ...newSettings };

        if (newSettings.keyBindings) {
            this.settings.keyBindings = sanitizePlayer1KeyBindings({
                ...previousSettings.keyBindings,
                ...newSettings.keyBindings,
            });
        } else {
            this.settings.keyBindings = sanitizePlayer1KeyBindings(this.settings.keyBindings);
        }

        if (newSettings.player2KeyBindings) {
            this.settings.player2KeyBindings = sanitizePlayer2KeyBindings({
                ...previousSettings.player2KeyBindings,
                ...newSettings.player2KeyBindings,
            });
        } else {
            this.settings.player2KeyBindings = sanitizePlayer2KeyBindings(this.settings.player2KeyBindings);
        }

        if (newSettings.serenityKeyBindings) {
            this.settings.serenityKeyBindings = sanitizeSerenityKeyBindings({
                ...previousSettings.serenityKeyBindings,
                ...newSettings.serenityKeyBindings,
            });
        } else {
            this.settings.serenityKeyBindings = sanitizeSerenityKeyBindings(this.settings.serenityKeyBindings);
        }

        if (newSettings.serenityGamepadBindings) {
            this.settings.serenityGamepadBindings = sanitizeSerenityGamepadBindings({
                ...previousSettings.serenityGamepadBindings,
                ...newSettings.serenityGamepadBindings,
            });
        } else {
            this.settings.serenityGamepadBindings = sanitizeSerenityGamepadBindings(this.settings.serenityGamepadBindings);
        }

        this.settings = applyCursorSettingDefaults(this.settings);

        // Emit settings changed event
        if (emit && typeof window !== 'undefined') {
            const changes = this.getChanges(oldSettings, this.settings);
            if (Object.keys(changes).length > 0) {
                window.dispatchEvent(
                    new CustomEvent('settingsChanged', {
                        detail: changes,
                    }),
                );
            }
        }
    }

    /**
     * Get changes between old and new settings
     * @param {Object} oldSettings - Old settings
     * @param {Object} newSettings - New settings
     * @returns {Object} Changed keys and values
     */
    getChanges(oldSettings, newSettings) {
        const changes = {};
        for (const key in newSettings) {
            if (JSON.stringify(oldSettings[key]) !== JSON.stringify(newSettings[key])) {
                changes[key] = newSettings[key];
            }
        }
        return changes;
    }

    /**
     * Saves settings to localStorage
     */
    save({ emitEvent = true } = {}) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
            if (emitEvent) {
                eventBus.emit(EVENTS.SETTINGS_CHANGED, {
                    settings: { ...this.settings },
                    source: 'local',
                });
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    /**
     * Loads settings from localStorage
     * @returns {Object} Loaded settings
     */
    load() {
        this.didLoadFromStorage = false;
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const loaded = JSON.parse(saved);
                const loadedKeyBindings = loaded.keyBindings || {};
                const loadedP2KeyBindings = loaded.player2KeyBindings || {};
                const loadedSerenityKeyBindings = loaded.serenityKeyBindings || {};
                const loadedSerenityGamepadBindings = loaded.serenityGamepadBindings || {};
                const sanitizedKeyBindings = sanitizePlayer1KeyBindings({
                    ...DEFAULT_CONFIG.keyBindings,
                    ...loadedKeyBindings,
                });
                const sanitizedP2KeyBindings = sanitizePlayer2KeyBindings({
                    ...DEFAULT_CONFIG.player2KeyBindings,
                    ...loadedP2KeyBindings,
                });
                const sanitizedSerenityKeyBindings = sanitizeSerenityKeyBindings({
                    ...DEFAULT_CONFIG.serenityKeyBindings,
                    ...loadedSerenityKeyBindings,
                });
                const sanitizedSerenityGamepadBindings = sanitizeSerenityGamepadBindings({
                    ...DEFAULT_CONFIG.serenityGamepadBindings,
                    ...loadedSerenityGamepadBindings,
                });
                const sanitizedCursorSettings = normalizeCursorSettings(loaded);

                this.settings = {
                    ...DEFAULT_CONFIG,
                    ...loaded,
                    keyBindings: sanitizedKeyBindings,
                    player2KeyBindings: sanitizedP2KeyBindings,
                    serenityKeyBindings: sanitizedSerenityKeyBindings,
                    serenityGamepadBindings: sanitizedSerenityGamepadBindings,
                };
                this.settings = applyCursorSettingDefaults(this.settings);
                this.didLoadFromStorage = true;

                const keyBindingsChanged = JSON.stringify(loadedKeyBindings) !== JSON.stringify(sanitizedKeyBindings);
                const player2BindingsChanged = JSON.stringify(loadedP2KeyBindings) !== JSON.stringify(sanitizedP2KeyBindings);
                const serenityKeyBindingsChanged = (
                    JSON.stringify(loadedSerenityKeyBindings) !== JSON.stringify(sanitizedSerenityKeyBindings)
                );
                const serenityGamepadBindingsChanged = (
                    JSON.stringify(loadedSerenityGamepadBindings) !== JSON.stringify(sanitizedSerenityGamepadBindings)
                );
                const cursorSettingsChanged = (
                    loaded.customCursorEnabled !== sanitizedCursorSettings.customCursorEnabled
                    || loaded.customCursorIntensity !== sanitizedCursorSettings.customCursorIntensity
                    || loaded.customCursorVisibilityPreset !== sanitizedCursorSettings.customCursorVisibilityPreset
                    || loaded.customCursorReducedMotion !== sanitizedCursorSettings.customCursorReducedMotion
                );
                if (
                    keyBindingsChanged
                    || player2BindingsChanged
                    || serenityKeyBindingsChanged
                    || serenityGamepadBindingsChanged
                    || cursorSettingsChanged
                ) {
                    this.save({ emitEvent: false });
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        return this.settings;
    }

    /**
     * Check whether a prior settings payload existed in storage during the most recent load.
     * @returns {boolean}
     */
    hasPersistedSettings() {
        return this.didLoadFromStorage;
    }

    /**
     * Resets settings to defaults
     */
    reset() {
        this.settings = applyCursorSettingDefaults({ ...DEFAULT_CONFIG });
        this.save();
    }

    /**
     * Gets a specific setting value
     * @param {string} key - Setting key
     * @returns {*} Setting value
     */
    getValue(key) {
        return this.settings[key];
    }

    /**
     * Sets a specific setting value
     * @param {string} key - Setting key
     * @param {*} value - Setting value
     */
    setValue(key, value) {
        this.settings[key] = value;
    }
}

/**
 * Updates the controls display in the settings modal
 * @param {Object} settings - Current settings
 */
export function updateControlsDisplay(settings) {
    const list = document.getElementById('controls-list');
    if (!list) return;

    list.innerHTML = '';

    const actions = [
        'moveLeft',
        'moveRight',
        'rotateRight',
        'rotateLeft',
        'flip',
        'softDrop',
        'hardDrop',
    ];

    if (settings.controlScheme === 'Keyboard') {
        document.querySelectorAll('.key-input').forEach((el) => {
            if (el.parentElement) el.parentElement.style.display = 'contents';
        });

        actions.forEach((action) => {
            if (settings.keyBindings[action]) {
                const title = action.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
                list.innerHTML += `<div>${title}: ${settings.keyBindings[action]}</div>`;
            }
        });
    } else {
        document.querySelectorAll('.key-input').forEach((el) => {
            if (el.parentElement) el.parentElement.style.display = 'none';
        });
        list.innerHTML = '<div>Swipe to move</div><div>Tap to rotate</div><div>Flick down to drop</div>';
    }
}

/**
 * Handles key binding input
 * @param {KeyboardEvent} event - Keyboard event
 * @param {HTMLElement} element - Input element
 * @param {SettingsManager} settingsManager - Settings manager instance
 * @param {Function} updateCallback - Callback to update controls display
 */
function getKeyboardBindingContext(elementId) {
    if (elementId.startsWith('key-serenity-')) {
        return {
            action: elementId.substring('key-serenity-'.length),
            bindingsKey: 'serenityKeyBindings',
            defaultBindings: DEFAULT_CONFIG.serenityKeyBindings,
        };
    }

    if (elementId.startsWith('key-p2-')) {
        return {
            action: elementId.substring(7),
            bindingsKey: 'player2KeyBindings',
            defaultBindings: DEFAULT_CONFIG.player2KeyBindings,
        };
    }

    return {
        action: elementId.substring(4),
        bindingsKey: 'keyBindings',
        defaultBindings: DEFAULT_CONFIG.keyBindings,
    };
}

export function handleKeybinding(event, element, settingsManager, updateCallback) {
    event.preventDefault();

    const elementId = element.id;
    const key = event.key === ' ' ? 'Space' : event.key;
    const settings = settingsManager.get();
    const { action, bindingsKey, defaultBindings } = getKeyboardBindingContext(elementId);
    const currentBindings = settings[bindingsKey] || defaultBindings;

    // Check if key is already used for another action in the same player's bindings
    if (Object.values(currentBindings).includes(key) && currentBindings[action] !== key) {
        // Revert to original key
        element.textContent = currentBindings[action];
        element.classList.remove('listening');
        return;
    }

    // Set new key binding
    const newBindings = {
        ...currentBindings,
        [action]: key,
    };

    settingsManager.update({ [bindingsKey]: newBindings });
    element.textContent = key;
    element.classList.remove('listening');

    settingsManager.save();
    if (updateCallback) updateCallback();
}

/**
 * Button names for gamepad display
 */
const GAMEPAD_BUTTON_NAMES = {
    0: 'A (Cross)',
    1: 'B (Circle)',
    2: 'X (Square)',
    3: 'Y (Triangle)',
    4: 'LB (L1)',
    5: 'RB (R1)',
    6: 'LT (L2)',
    7: 'RT (R2)',
    8: 'Select (Share)',
    9: 'Start (Options)',
    10: 'L3',
    11: 'R3',
    12: 'D-Up',
    13: 'D-Down',
    14: 'D-Left',
    15: 'D-Right',
    16: 'Home',
};

function getGamepadBindingContext(elementId) {
    if (elementId.startsWith('gamepad-serenity-')) {
        return {
            playerIndex: null,
            action: elementId.substring('gamepad-serenity-'.length),
            bindingsKey: 'serenityGamepadBindings',
            defaultBindings: DEFAULT_CONFIG.serenityGamepadBindings,
        };
    }

    const match = /^gamepad(?:-p(\d))?-(.+)$/.exec(elementId);
    const rawIndex = match && match[1] ? parseInt(match[1], 10) - 1 : 0;
    const playerIndex = Number.isNaN(rawIndex) ? 0 : Math.min(Math.max(rawIndex, 0), GAMEPAD_BINDING_KEYS.length - 1);
    const action = match ? match[2] : elementId;

    return {
        playerIndex,
        action,
        bindingsKey: GAMEPAD_BINDING_KEYS[playerIndex],
        defaultBindings: DEFAULT_GAMEPAD_BINDINGS[playerIndex],
    };
}

/**
 * Handles gamepad binding input
 * @param {HTMLElement} element - Input element
 * @param {SettingsManager} settingsManager - Settings manager instance
 * @param {Function} updateCallback - Callback to update controls display
 */
export function handleGamepadBinding(element, settingsManager, updateCallback) {
    const elementId = element.id;
    let settings = settingsManager.get();

    const { action, bindingsKey, defaultBindings } = getGamepadBindingContext(elementId);
    let currentBindings = settings[bindingsKey];

    if (!currentBindings) {
        currentBindings = { ...defaultBindings };
        settingsManager.update({ [bindingsKey]: currentBindings }, false);
        settingsManager.save();
        settings = settingsManager.get();
    }

    // Listen for gamepad button press
    const pollInterval = setInterval(() => {
        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad) continue;

            // Check all buttons
            for (let btnIndex = 0; btnIndex < gamepad.buttons.length; btnIndex++) {
                const button = gamepad.buttons[btnIndex];
                if (button.pressed || button.value > 0.3) {
                    // Check if button is already used for another action
                    if (Object.values(currentBindings).includes(btnIndex) && currentBindings[action] !== btnIndex) {
                        // Revert to original button
                        const originalButton = currentBindings[action];
                        element.textContent = GAMEPAD_BUTTON_NAMES[originalButton] || `Button ${originalButton}`;
                        element.classList.remove('listening');
                        clearInterval(pollInterval);
                        return;
                    }

                    // Set new button binding
                    const newBindings = {
                        ...settings[bindingsKey],
                        [action]: btnIndex,
                    };

                    settingsManager.update({ [bindingsKey]: newBindings });
                    element.textContent = GAMEPAD_BUTTON_NAMES[btnIndex] || `Button ${btnIndex}`;
                    element.classList.remove('listening');
                    clearInterval(pollInterval);

                    settingsManager.save();
                    if (updateCallback) updateCallback();
                    return;
                }
            }
        }
    }, 50); // Poll at 20 FPS

    // Timeout after 10 seconds
    setTimeout(() => {
        if (element.classList.contains('listening')) {
            const latestBindings = settingsManager.get()[bindingsKey] || currentBindings;
            const fallbackButton = latestBindings[action];
            element.textContent = GAMEPAD_BUTTON_NAMES[fallbackButton] || `Button ${fallbackButton}`;
            element.classList.remove('listening');
            clearInterval(pollInterval);
        }
    }, 10000);
}

/**
 * Updates gamepad controls display
 * @param {Object} settings - Current settings
 */
export function updateGamepadControlsDisplay(settings) {
    const actions = ['moveLeft', 'moveRight', 'rotateRight', 'rotateLeft', 'flip', 'softDrop', 'hardDrop', 'pause'];
    const descriptors = [
        { key: 'gamepadBindings', prefix: 'gamepad-' },
        { key: 'player2GamepadBindings', prefix: 'gamepad-p2-' },
        { key: 'player3GamepadBindings', prefix: 'gamepad-p3-' },
        { key: 'player4GamepadBindings', prefix: 'gamepad-p4-' },
    ];

    descriptors.forEach((descriptor, index) => {
        const bindings = settings[descriptor.key] || DEFAULT_GAMEPAD_BINDINGS[index];
        actions.forEach((action) => {
            const element = document.getElementById(`${descriptor.prefix}${action}`);
            if (!element || bindings?.[action] === undefined) return;

            const buttonIndex = bindings[action];
            element.textContent = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
        });
    });
}

function updateSerenityControlsDisplay(settings) {
    const keyBindings = settings.serenityKeyBindings || DEFAULT_CONFIG.serenityKeyBindings;
    SERENITY_KEYBOARD_BINDING_ACTIONS.forEach((action) => {
        const element = document.getElementById(`key-serenity-${action}`);
        if (element && keyBindings[action]) {
            element.textContent = keyBindings[action];
        }
    });

    const gamepadBindings = settings.serenityGamepadBindings || DEFAULT_CONFIG.serenityGamepadBindings;
    SERENITY_GAMEPAD_BINDING_ACTIONS.forEach((action) => {
        const element = document.getElementById(`gamepad-serenity-${action}`);
        const buttonIndex = gamepadBindings[action];
        if (element && buttonIndex !== undefined) {
            element.textContent = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
        }
    });
}

/**
 * Sets up settings tab switching
 */
export function activateSettingsTab(settingsModal, targetTab) {
    if (!settingsModal || !targetTab) {
        return false;
    }

    const tab = settingsModal.querySelector(`.settings-tab[data-tab="${targetTab}"]`);
    if (!tab || tab.classList.contains('active')) {
        return false;
    }

    settingsModal.querySelectorAll('.settings-tab').forEach((item) => item.classList.remove('active'));
    settingsModal.querySelectorAll('.settings-tab-content').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    settingsModal.querySelector(`#settings-${targetTab}`)?.classList.add('active');
    return true;
}

export function setupSettingsTabs() {
    const tabsContainer = document.querySelector('#settings-modal .settings-tabs');
    if (!tabsContainer) return;

    // Guard against duplicate listener registration.
    if (tabsContainer.dataset.delegatedClick === 'true') return;
    tabsContainer.dataset.delegatedClick = 'true';

    tabsContainer.addEventListener('click', (event) => {
        const tab = event.target.closest('.settings-tab');
        if (!tab || !tabsContainer.contains(tab)) return;

        const targetTab = tab.getAttribute('data-tab');
        if (!targetTab) return;

        const settingsModal = document.getElementById('settings-modal');
        activateSettingsTab(settingsModal, targetTab);
    });
}

/**
 * Sets up controls sub-tab switching
 */
export function activateControlsSubtab(controlsTab, targetSubtab) {
    if (!controlsTab || !targetSubtab) {
        return false;
    }

    const subtab = controlsTab.querySelector(`.controls-subtab[data-subtab="${targetSubtab}"]`);
    if (!subtab || subtab.classList.contains('active')) {
        return false;
    }

    controlsTab.querySelectorAll('.controls-subtab').forEach((item) => item.classList.remove('active'));
    controlsTab.querySelectorAll('.controls-subtab-content').forEach((item) => item.classList.remove('active'));
    subtab.classList.add('active');
    controlsTab.querySelector(`#controls-${targetSubtab}`)?.classList.add('active');
    return true;
}

export function setupControlsSubTabs() {
    const controlsNav = document.querySelector('#settings-modal .controls-nav');
    if (!controlsNav) return;

    // Guard against duplicate listener registration.
    if (controlsNav.dataset.delegatedClick === 'true') return;
    controlsNav.dataset.delegatedClick = 'true';

    controlsNav.addEventListener('click', (event) => {
        const subtab = event.target.closest('.controls-subtab');
        if (!subtab || !controlsNav.contains(subtab)) return;

        const targetSubtab = subtab.getAttribute('data-subtab');
        if (!targetSubtab) return;

        const controlsTab = document.getElementById('settings-controls');
        activateControlsSubtab(controlsTab, targetSubtab);
    });
}

/**
 * Initializes settings UI elements
 * @param {SettingsManager} settingsManager - Settings manager instance
 * @param {Object} callbacks - Callback functions
 */
export function initializeSettingsUI(settingsManager, callbacks) {
    let settings = settingsManager.get();

    let bindingsUpdated = false;
    GAMEPAD_BINDING_KEYS.forEach((key, index) => {
        if (!settings[key]) {
            settingsManager.update({ [key]: { ...DEFAULT_GAMEPAD_BINDINGS[index] } }, false);
            bindingsUpdated = true;
        }
    });
    if (bindingsUpdated) {
        settings = settingsManager.get();
        settingsManager.save();
    }

    // Setup tab switching
    setupSettingsTabs();

    // Setup controls sub-tab switching
    setupControlsSubTabs();

    const detectControllersBtn = document.getElementById('detect-controllers');
    if (detectControllersBtn) {
        detectControllersBtn.addEventListener('click', () => {
            if (callbacks && typeof callbacks.onGamepadRescan === 'function') {
                callbacks.onGamepadRescan();
            }
        });
    }

    const resetBindingsBtn = document.getElementById('reset-all-bindings');
    if (resetBindingsBtn) {
        resetBindingsBtn.addEventListener('click', () => {
            if (callbacks && typeof callbacks.onResetGamepadBindings === 'function') {
                callbacks.onResetGamepadBindings();
            }
        });
    }

    const applyKeyDefaults = (key) => {
        const defaults = DEFAULT_SETTINGS[key] || DEFAULT_CONFIG[key];
        if (!defaults) return;
        settingsManager.update({ [key]: { ...defaults } });
        settingsManager.save();
        updateControlsDisplay(settingsManager.get());
        updateSerenityControlsDisplay(settingsManager.get());
    };

    const applyGamepadDefaults = (key) => {
        const defaults = DEFAULT_SETTINGS[key] || DEFAULT_CONFIG[key];
        if (!defaults) return;
        settingsManager.update({ [key]: { ...defaults } });
        settingsManager.save();
        updateGamepadControlsDisplay(settingsManager.get());
        updateSerenityControlsDisplay(settingsManager.get());
    };

    const bindingResetHandlers = {
        'keyboard-player1': () => applyKeyDefaults('keyBindings'),
        'keyboard-player2': () => applyKeyDefaults('player2KeyBindings'),
        'keyboard-serenity': () => applyKeyDefaults('serenityKeyBindings'),
        'gamepad-player1': () => applyGamepadDefaults('gamepadBindings'),
        'gamepad-player2': () => applyGamepadDefaults('player2GamepadBindings'),
        'gamepad-player3': () => applyGamepadDefaults('player3GamepadBindings'),
        'gamepad-player4': () => applyGamepadDefaults('player4GamepadBindings'),
        'gamepad-serenity': () => applyGamepadDefaults('serenityGamepadBindings'),
    };

    document.querySelectorAll('[data-reset-target]').forEach((button) => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-reset-target');
            const handler = bindingResetHandlers[target];
            if (handler) {
                handler();
                button.blur();
            }
        });
    });

    // Change Game Mode button - returns to start modal
    const changeGameModeBtn = document.getElementById('change-game-mode-btn');
    if (changeGameModeBtn) {
        changeGameModeBtn.addEventListener('click', () => {
            console.log('[Settings] Change Game Mode button clicked');
            if (callbacks && callbacks.onChangeGameMode) {
                callbacks.onChangeGameMode();
            }
        });
    }

    const bindTimingSlider = (sliderId, valueId, settingKey, fallbackValue) => {
        const slider = document.getElementById(sliderId);
        const value = document.getElementById(valueId);
        if (!slider || !value) return;

        const initialValue = Number(settings[settingKey] ?? fallbackValue);
        slider.value = Number.isFinite(initialValue) ? initialValue : fallbackValue;
        value.textContent = slider.value;

        slider.addEventListener('input', (event) => {
            const parsedValue = parseInt(event.target.value, 10);
            const numericValue = Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
            settingsManager.update({ [settingKey]: numericValue });
            value.textContent = String(numericValue);
            settingsManager.save();
        });
    };

    bindTimingSlider('das-delay', 'das-delay-value', 'dasDelay', DEFAULT_CONFIG.dasDelay);
    bindTimingSlider('das-interval', 'das-interval-value', 'dasInterval', DEFAULT_CONFIG.dasInterval);
    bindTimingSlider('soft-drop-interval', 'soft-drop-interval-value', 'softDropInterval', DEFAULT_CONFIG.softDropInterval);

    // Music volume slider
    const musicVolumeSlider = document.getElementById('music-volume');
    const musicVolumeValue = document.getElementById('music-volume-value');
    if (musicVolumeSlider && musicVolumeValue) {
        musicVolumeSlider.value = settings.musicVolume * 100;
        musicVolumeValue.textContent = Math.round(settings.musicVolume * 100);

        musicVolumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value) / 100;
            settingsManager.update({ musicVolume: volume });
            if (callbacks.onMusicVolumeChange) {
                callbacks.onMusicVolumeChange(volume);
            }
            musicVolumeValue.textContent = e.target.value;
            settingsManager.save();
        });
    }

    // SFX volume slider
    const sfxVolumeSlider = document.getElementById('sfx-volume');
    const sfxVolumeValue = document.getElementById('sfx-volume-value');
    if (sfxVolumeSlider && sfxVolumeValue) {
        sfxVolumeSlider.value = settings.sfxVolume * 100;
        sfxVolumeValue.textContent = Math.round(settings.sfxVolume * 100);

        sfxVolumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value) / 100;
            settingsManager.update({ sfxVolume: volume });
            if (callbacks.onSfxVolumeChange) {
                callbacks.onSfxVolumeChange(volume);
            }
            sfxVolumeValue.textContent = e.target.value;
            settingsManager.save();
        });
    }

    // Random theme interval slider
    const randomThemeIntervalSlider = document.getElementById('random-theme-interval');
    const randomThemeIntervalValue = document.getElementById('random-theme-interval-value');
    if (randomThemeIntervalSlider && randomThemeIntervalValue) {
        randomThemeIntervalSlider.value = settings.randomThemeInterval;
        randomThemeIntervalValue.textContent = settings.randomThemeInterval;

        randomThemeIntervalSlider.addEventListener('input', (e) => {
            const interval = parseInt(e.target.value);
            settingsManager.update({ randomThemeInterval: interval });
            randomThemeIntervalValue.textContent = e.target.value;
            settingsManager.save();
        });
    }

    // Background mode selector
    const bgModeSelect = document.getElementById('background-mode');
    if (bgModeSelect) {
        bgModeSelect.value = settings.backgroundMode;

        const handleModeChange = (mode) => {
            if (mode === 'Random') {
                setRandomIntervalVisibility(true);
            } else {
                // 'Level' or 'Specific'
                setRandomIntervalVisibility(false);
            }
        };

        handleModeChange(settings.backgroundMode);

        bgModeSelect.addEventListener('change', (e) => {
            const mode = e.target.value;
            settingsManager.update({ backgroundMode: mode });

            if (callbacks.onBackgroundModeChange) {
                callbacks.onBackgroundModeChange(mode);
            }

            handleModeChange(mode);
            settingsManager.save();
        });

        // Sync UI with external settings changes
        if (typeof window !== 'undefined') {
            window.addEventListener('settingsChanged', (e) => {
                const changes = e.detail;
                const currentSettings = settingsManager.get();
                if (changes.backgroundMode !== undefined) {
                    bgModeSelect.value = currentSettings.backgroundMode;
                    handleModeChange(currentSettings.backgroundMode);
                }
            });
        }
    }

    // Theme-Linked SFX toggle
    const themeLinkedSfxSelect = document.getElementById('theme-linked-sfx');
    if (themeLinkedSfxSelect) {
        themeLinkedSfxSelect.checked = !!(settings.themeLinkedSfx ?? false);

        themeLinkedSfxSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ themeLinkedSfx: enabled });
            settingsManager.save();
            console.log(`[Settings] Theme-linked SFX ${enabled ? 'enabled' : 'disabled'}`);

            if (callbacks.onThemeLinkedSfxChange) {
                callbacks.onThemeLinkedSfxChange(enabled);
            }
        });
    }

    // Piece lock ripple toggle & custom color picker
    const pieceLockRippleSelect = document.getElementById('piece-lock-ripple');

    if (pieceLockRippleSelect) {
        pieceLockRippleSelect.checked = !!settings.pieceLockRipple;

        pieceLockRippleSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ pieceLockRipple: enabled });
            settingsManager.save();
        });
    }

    // Combo popup effect toggle
    const comboPopupSelect = document.getElementById('combo-popup-effect');
    if (comboPopupSelect) {
        comboPopupSelect.checked = !!settings.comboPopupEffect;

        comboPopupSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ comboPopupEffect: enabled });
            settingsManager.save();
        });
    }

    // Line clear effects toggle
    const lineClearEffectsSelect = document.getElementById('line-clear-effects');
    if (lineClearEffectsSelect) {
        lineClearEffectsSelect.checked = !!settings.lineClearEffects;

        lineClearEffectsSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ lineClearEffects: enabled });
            settingsManager.save();
        });
    }

    // Background combo effects toggle
    const backgroundComboEffectsSelect = document.getElementById('background-combo-effects');
    if (backgroundComboEffectsSelect) {
        backgroundComboEffectsSelect.checked = !!settings.backgroundComboEffects;

        backgroundComboEffectsSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ backgroundComboEffects: enabled });
            settingsManager.save();
        });
    }

    // Theme-based tetrominos toggle
    const themeBasedTetrominosSelect = document.getElementById('theme-based-tetrominos');
    if (themeBasedTetrominosSelect) {
        themeBasedTetrominosSelect.checked = !!(settings.themeBasedTetrominos ?? true);

        themeBasedTetrominosSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ themeBasedTetrominos: enabled });
            settingsManager.save();
            console.log(`[Settings] Theme-based tetrominos ${enabled ? 'enabled' : 'disabled'}`);
        });
    }

    // Sound effects selector
    const sfxSetSelect = document.getElementById('sfx-set');
    if (sfxSetSelect) {
        sfxSetSelect.value = settings.soundSet || 'Zen';

        sfxSetSelect.addEventListener('change', (e) => {
            const soundSet = e.target.value;
            settingsManager.update({ soundSet });

            if (callbacks.onSoundSetChange) {
                callbacks.onSoundSetChange(soundSet);
            }

            settingsManager.save();
        });
    }

    // Theme-linked music toggle
    const themeLinkedSelect = document.getElementById('theme-linked-mode');
    if (themeLinkedSelect) {
        themeLinkedSelect.checked = !!settings.themeLinkedMode;

        themeLinkedSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ themeLinkedMode: enabled });

            if (callbacks.onThemeLinkedModeChange) {
                callbacks.onThemeLinkedModeChange(enabled);
            }

            settingsManager.save();
        });
    }

    // Auto theme change toggle
    const autoThemeChangeSelect = document.getElementById('auto-theme-change');
    if (autoThemeChangeSelect) {
        autoThemeChangeSelect.checked = !!settings.autoThemeChange;

        autoThemeChangeSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ autoThemeChange: enabled });

            if (callbacks.onAutoThemeChangeToggle) {
                callbacks.onAutoThemeChangeToggle(enabled);
            }

            settingsManager.save();
        });
    }

    // Gamepad enabled toggle
    const gamepadEnabledSelect = document.getElementById('gamepad-enabled');
    if (gamepadEnabledSelect) {
        gamepadEnabledSelect.value = settings.gamepadEnabled ? 'true' : 'false';

        gamepadEnabledSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ gamepadEnabled: enabled });

            if (callbacks.onGamepadEnabledChange) {
                callbacks.onGamepadEnabledChange(enabled);
            }

            settingsManager.save();
        });
    }

    // Display Settings (Phase 1)
    // Resolution is always auto - use Render Quality for performance tuning

    // Display mode selector
    const displayModeSelect = document.getElementById('display-mode');
    if (displayModeSelect) {
        displayModeSelect.value = settings.displayMode || 'windowed';

        displayModeSelect.addEventListener('change', (e) => {
            const displayMode = e.target.value;
            settingsManager.update({ displayMode });
            settingsManager.save();

            // Apply settings immediately
            if (callbacks.onDisplaySettingsApply) {
                callbacks.onDisplaySettingsApply(settingsManager.get());
            }
        });
    }

    // Graphics quality selector
    const graphicsQualitySelect = document.getElementById('graphics-quality');
    if (graphicsQualitySelect) {
        graphicsQualitySelect.value = settings.effectQuality || 'High';

        graphicsQualitySelect.addEventListener('change', (e) => {
            const quality = e.target.value;
            settingsManager.update({ effectQuality: quality });
            settingsManager.save();

            // Update performance monitor quality mode if it's active
            if (typeof window !== 'undefined' && window.perfMonitor) {
                import('../utils/performance-monitor.js').then(({ performanceMonitor }) => {
                    performanceMonitor.setQualityMode(quality);
                });
            }

            console.log(`[Settings] Graphics quality changed to: ${quality}`);
        });
    }

    // FPS target selector
    const fpsTargetSelect = document.getElementById('fps-target');
    if (fpsTargetSelect) {
        fpsTargetSelect.value = String(settings.targetFrameRate || 60);

        fpsTargetSelect.addEventListener('change', (e) => {
            const fps = parseInt(e.target.value);
            settingsManager.update({ targetFrameRate: fps });
            settingsManager.save();

            console.log(`[Settings] Target frame rate changed to: ${fps}`);

            if (callbacks.onFrameRateSettingsApply) {
                callbacks.onFrameRateSettingsApply(settingsManager.get());
            }
        });
    }

    // VSync toggle
    const vsyncToggle = document.getElementById('vsync-toggle');
    if (vsyncToggle) {
        vsyncToggle.checked = (settings.vsyncEnabled ?? true);

        vsyncToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ vsyncEnabled: enabled });
            settingsManager.save();

            console.log(`[Settings] VSync ${enabled ? 'enabled' : 'disabled'}`);

            if (callbacks.onFrameRateSettingsApply) {
                callbacks.onFrameRateSettingsApply(settingsManager.get());
            }
        });
    }

    // Anti-aliasing toggle
    const antialiasToggle = document.getElementById('antialiasing-toggle');
    if (antialiasToggle) {
        antialiasToggle.checked = (settings.enableAntialiasing ?? true);

        antialiasToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ enableAntialiasing: enabled });
            settingsManager.save();

            console.log(`[Settings] Anti-aliasing ${enabled ? 'enabled' : 'disabled'}`);

            // Apply immediately - affects newly created theme renderers
            if (callbacks.onDisplaySettingsApply) {
                callbacks.onDisplaySettingsApply(settingsManager.get());
            }
        });
    }

    // FPS counter toggle
    const showFPSCounter = document.getElementById('show-fps-counter');
    if (showFPSCounter) {
        showFPSCounter.checked = !!settings.showFPSCounter;

        showFPSCounter.addEventListener('change', (e) => {
            const show = e.target.checked;
            settingsManager.update({ showFPSCounter: show });
            settingsManager.save();

            console.log(`[Settings] FPS counter ${show ? 'shown' : 'hidden'}`);

            // Apply immediately
            if (callbacks.onDisplaySettingsApply) {
                callbacks.onDisplaySettingsApply(settingsManager.get());
            }
        });
    }

    const customCursorEnabledSelect = document.getElementById('custom-cursor-enabled');
    const customCursorIntensitySelect = document.getElementById('custom-cursor-intensity');
    const customCursorVisibilitySelect = document.getElementById('custom-cursor-visibility');
    const customCursorMotionSelect = document.getElementById('custom-cursor-motion');

    const syncCustomCursorControlAvailability = (enabled) => {
        [customCursorIntensitySelect, customCursorVisibilitySelect, customCursorMotionSelect].forEach((control) => {
            if (!control) return;
            control.disabled = !enabled;
        });
    };

    if (customCursorEnabledSelect) {
        customCursorEnabledSelect.checked = (settings.customCursorEnabled ?? true);
        syncCustomCursorControlAvailability(customCursorEnabledSelect.checked);

        customCursorEnabledSelect.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ customCursorEnabled: enabled });
            settingsManager.save();
            syncCustomCursorControlAvailability(enabled);
        });
    }

    if (customCursorIntensitySelect) {
        customCursorIntensitySelect.value = settings.customCursorIntensity || 'standard';
        customCursorIntensitySelect.addEventListener('change', (e) => {
            settingsManager.update({ customCursorIntensity: e.target.value });
            settingsManager.save();
        });
    }

    if (customCursorVisibilitySelect) {
        customCursorVisibilitySelect.value = settings.customCursorVisibilityPreset || 'standard';
        customCursorVisibilitySelect.addEventListener('change', (e) => {
            settingsManager.update({ customCursorVisibilityPreset: e.target.value });
            settingsManager.save();
        });
    }

    if (customCursorMotionSelect) {
        customCursorMotionSelect.value = settings.customCursorReducedMotion || 'system';
        customCursorMotionSelect.addEventListener('change', (e) => {
            settingsManager.update({ customCursorReducedMotion: e.target.value });
            settingsManager.save();
        });
    }

    // Render quality slider (controls background theme render resolution)
    const renderQualitySlider = document.getElementById('render-quality');
    const renderQualityValue = document.getElementById('render-quality-value');

    // Helper function to get descriptive label for render quality
    const getRenderQualityLabel = (percent) => {
        if (percent <= 50) return 'Performance';
        if (percent <= 65) return 'Low';
        if (percent <= 80) return 'Balanced';
        if (percent <= 95) return 'High';
        if (percent <= 105) return 'Native';
        if (percent <= 125) return 'Quality';
        return 'Ultra';
    };

    if (renderQualitySlider && renderQualityValue) {
        const currentScale = settings.renderScale ?? 1.0;
        const currentPercent = Math.round(currentScale * 100);
        renderQualitySlider.value = currentPercent;
        renderQualityValue.textContent = `${currentPercent}% (${getRenderQualityLabel(currentPercent)})`;

        renderQualitySlider.addEventListener('input', (e) => {
            const percent = parseInt(e.target.value);
            const scale = percent / 100;
            renderQualityValue.textContent = `${percent}% (${getRenderQualityLabel(percent)})`;

            settingsManager.update({ renderScale: scale });
            settingsManager.save();

            console.log(`[Settings] Render quality changed to: ${percent}% (${getRenderQualityLabel(percent)})`);

            // Apply immediately - will affect newly created theme renderers
            if (callbacks.onDisplaySettingsApply) {
                callbacks.onDisplaySettingsApply(settingsManager.get());
            }
        });
    }

    // Background Tab Behavior (throttling when tab is hidden)
    const backgroundTabBehaviorSelect = document.getElementById('background-tab-behavior');
    if (backgroundTabBehaviorSelect) {
        backgroundTabBehaviorSelect.value = settings.backgroundTabBehavior || 'reduce';

        backgroundTabBehaviorSelect.addEventListener('change', (e) => {
            const behavior = e.target.value;
            settingsManager.update({ backgroundTabBehavior: behavior });
            settingsManager.save();

            console.log(`[Settings] Background tab behavior changed to: ${behavior}`);

            // Apply immediately
            if (callbacks.onBackgroundTabBehaviorChange) {
                callbacks.onBackgroundTabBehaviorChange(behavior);
            }
        });
    }

    const desktopDevToolsSetting = document.getElementById('desktop-devtools-setting');
    const openDevToolsBtn = document.getElementById('open-devtools-btn');
    const openDevToolsStatus = document.getElementById('open-devtools-status');
    const openDesktopDebugTool = window.electronAPI?.openRendererDebugger || window.electronAPI?.openDevTools;
    if (desktopDevToolsSetting && openDevToolsBtn && openDesktopDebugTool) {
        const DEVTOOLS_BUTTON_TIMEOUT_MS = 5000;
        let pendingDevToolsRequestId = null;
        let pendingDevToolsTimeoutId = null;
        let remoteDebuggingUrl = null;
        let usesExternalDebugger = false;

        const getPrimaryButtonLabel = () => (
            usesExternalDebugger ? 'Open Renderer Debugger' : 'Open DevTools'
        );

        const setStatus = (message, tone = 'info') => {
            if (!openDevToolsStatus) {
                return;
            }

            openDevToolsStatus.hidden = !message;
            openDevToolsStatus.textContent = message || '';

            if (tone === 'error') {
                openDevToolsStatus.style.color = 'rgba(255, 120, 120, 0.92)';
            } else if (tone === 'success') {
                openDevToolsStatus.style.color = 'rgba(120, 255, 185, 0.92)';
            } else {
                openDevToolsStatus.style.color = 'rgba(255, 255, 255, 0.72)';
            }
        };

        const clearPendingDevToolsRequest = () => {
            if (pendingDevToolsTimeoutId !== null) {
                clearTimeout(pendingDevToolsTimeoutId);
                pendingDevToolsTimeoutId = null;
            }
            pendingDevToolsRequestId = null;
        };

        const queueButtonReset = (delayMs = 1800) => {
            window.setTimeout(() => {
                openDevToolsBtn.disabled = false;
                openDevToolsBtn.textContent = getPrimaryButtonLabel();
            }, delayMs);
        };

        const applyDiagnosticsSnapshot = (diagnostics) => {
            if (diagnostics?.remoteDebuggingUrl) {
                remoteDebuggingUrl = diagnostics.remoteDebuggingUrl;
            }
            if (diagnostics?.debugToolsStatus?.packagedExternalDebugger) {
                usesExternalDebugger = true;
                openDevToolsBtn.textContent = getPrimaryButtonLabel();
            }
            return diagnostics;
        };

        const formatFailureMessage = (payload = {}, diagnostics = null) => {
            const logPath = payload.logPath || diagnostics?.logPath || null;
            const failureKind = payload.failureKind || 'error';
            let message = usesExternalDebugger
                ? 'Renderer debugger open failed.'
                : 'DevTools open failed.';

            if (failureKind === 'timeout') {
                message = usesExternalDebugger
                    ? 'Renderer debugger did not report a successful launch before the timeout.'
                    : 'DevTools did not report a successful open before the timeout.';
            } else if (failureKind === 'closed-before-open') {
                message = 'DevTools closed before the open request completed.';
            } else if (payload.errorMessage) {
                message = `${usesExternalDebugger ? 'Renderer debugger' : 'DevTools'} open failed: ${payload.errorMessage}`;
            }

            const lastEntry = diagnostics?.entries?.[diagnostics.entries.length - 1];
            const lastEntryHint = lastEntry?.type ? ` Last event: ${lastEntry.type}.` : '';
            const logHint = logPath ? ` See ${logPath}.` : '';
            const remoteHint = remoteDebuggingUrl
                ? ` Renderer debugger base URL: ${remoteDebuggingUrl}.`
                : '';

            return `${message}${lastEntryHint}${logHint}${remoteHint}`;
        };

        desktopDevToolsSetting.hidden = false;
        Promise.all([
            window.electronAPI.getDevToolsDiagnostics?.(),
            window.electronAPI.getDebugToolsStatus?.(),
        ]).then(([diagnostics, debugToolsStatus]) => {
            applyDiagnosticsSnapshot({
                ...diagnostics,
                debugToolsStatus: debugToolsStatus || diagnostics?.debugToolsStatus,
            });
            if (debugToolsStatus?.packagedExternalDebugger) {
                usesExternalDebugger = true;
                openDevToolsBtn.textContent = getPrimaryButtonLabel();
            }
            if (remoteDebuggingUrl) {
                setStatus(
                    usesExternalDebugger
                        ? `Renderer debugger available at ${remoteDebuggingUrl}.`
                        : `Remote inspector available at ${remoteDebuggingUrl}.`,
                    'info',
                );
            }
        }).catch((error) => {
            console.warn('[Settings] Failed to load DevTools diagnostics:', error);
        });

        if (!openDevToolsBtn.dataset.devtoolsBound) {
            openDevToolsBtn.dataset.devtoolsBound = 'true';

            window.electronAPI.onRuntimeEvent?.(async (payload) => {
                if (!payload?.type || payload.requestId !== pendingDevToolsRequestId) {
                    return;
                }

                if (payload.type === 'devtools-opened') {
                    clearPendingDevToolsRequest();
                    openDevToolsBtn.textContent = payload.alreadyOpen
                        ? 'Already Open'
                        : (payload.external || usesExternalDebugger ? 'Debugger Opened' : 'DevTools Open');
                    setStatus(
                        payload.external || usesExternalDebugger
                            ? `Renderer debugger opened. ${payload.debuggerUrl || remoteDebuggingUrl || ''}`.trim()
                            : (
                                remoteDebuggingUrl
                                    ? `DevTools opened. Remote inspector available at ${remoteDebuggingUrl}.`
                                    : 'DevTools opened.'
                            ),
                        'success',
                    );
                    queueButtonReset();
                    return;
                }

                if (payload.type === 'devtools-open-failed') {
                    clearPendingDevToolsRequest();
                    openDevToolsBtn.textContent = payload.failureKind === 'timeout' ? 'Timed Out' : 'Open Failed';

                    try {
                        const diagnostics = applyDiagnosticsSnapshot(
                            await window.electronAPI.getDevToolsDiagnostics?.(),
                        );
                        setStatus(formatFailureMessage(payload, diagnostics), 'error');
                    } catch (error) {
                        setStatus(formatFailureMessage(payload), 'error');
                    }

                    queueButtonReset(2200);
                }
            });

            openDevToolsBtn.addEventListener('click', async () => {
                clearPendingDevToolsRequest();
                openDevToolsBtn.disabled = true;
                openDevToolsBtn.textContent = usesExternalDebugger ? 'Opening Debugger...' : 'Opening...';
                setStatus(
                    usesExternalDebugger
                        ? 'Request accepted. Waiting for the external renderer debugger to launch...'
                        : 'Request accepted. Waiting for the main process to report the result...',
                    'info',
                );

                try {
                    const result = await openDesktopDebugTool();
                    if (!result?.accepted || !result?.requestId) {
                        throw new Error('Main process did not accept the DevTools request.');
                    }

                    pendingDevToolsRequestId = result.requestId;
                    if (result.alreadyOpen) {
                        clearPendingDevToolsRequest();
                        openDevToolsBtn.textContent = 'Already Open';
                        setStatus(
                            remoteDebuggingUrl
                                ? `DevTools already open. Remote inspector available at ${remoteDebuggingUrl}.`
                                : 'DevTools already open.',
                            'success',
                        );
                        queueButtonReset();
                        return;
                    }

                    pendingDevToolsTimeoutId = window.setTimeout(async () => {
                        if (pendingDevToolsRequestId !== result.requestId) {
                            return;
                        }

                        clearPendingDevToolsRequest();
                        openDevToolsBtn.textContent = 'Timed Out';

                        try {
                            const diagnostics = applyDiagnosticsSnapshot(
                                await window.electronAPI.getDevToolsDiagnostics?.(),
                            );
                            setStatus(formatFailureMessage({ failureKind: 'timeout' }, diagnostics), 'error');
                        } catch (error) {
                            setStatus(formatFailureMessage({ failureKind: 'timeout' }), 'error');
                        }

                        queueButtonReset(2200);
                    }, DEVTOOLS_BUTTON_TIMEOUT_MS);
                } catch (error) {
                    clearPendingDevToolsRequest();
                    console.error('[Settings] Error opening DevTools:', error);
                    openDevToolsBtn.textContent = 'Open Failed';

                    try {
                        const diagnostics = applyDiagnosticsSnapshot(
                            await window.electronAPI.getDevToolsDiagnostics?.(),
                        );
                        setStatus(
                            formatFailureMessage({ failureKind: 'error', errorMessage: error.message }, diagnostics),
                            'error',
                        );
                    } catch (diagnosticsError) {
                        setStatus(
                            formatFailureMessage({ failureKind: 'error', errorMessage: error.message }),
                            'error',
                        );
                    }

                    queueButtonReset(2200);
                }
            });
        }
    }

    // Gamepad deadzone slider
    const gamepadDeadzoneSlider = document.getElementById('gamepad-deadzone');
    const gamepadDeadzoneValue = document.getElementById('gamepad-deadzone-value');
    if (gamepadDeadzoneSlider && gamepadDeadzoneValue) {
        gamepadDeadzoneSlider.value = Math.round(settings.gamepadDeadzone * 100);
        gamepadDeadzoneValue.textContent = Math.round(settings.gamepadDeadzone * 100);

        gamepadDeadzoneSlider.addEventListener('input', (e) => {
            const deadzone = parseInt(e.target.value) / 100;
            settingsManager.update({ gamepadDeadzone: deadzone });

            if (callbacks.onGamepadDeadzoneChange) {
                callbacks.onGamepadDeadzoneChange(deadzone);
            }

            gamepadDeadzoneValue.textContent = e.target.value;
            settingsManager.save();
        });
    }

    // Initialize key bindings listeners
    const keyInputs = document.querySelectorAll('.key-input:not(.gamepad-input)');
    keyInputs.forEach((input) => {
        const context = getKeyboardBindingContext(input.id);
        const currentBindings = settings[context.bindingsKey] || context.defaultBindings;

        if (currentBindings && currentBindings[context.action]) {
            input.textContent = currentBindings[context.action];
        }

        input.addEventListener('click', () => {
            input.classList.add('listening');
            input.textContent = 'Press a key...';

            // Add temporary keydown listener
            const keydownHandler = (event) => {
                if (input.classList.contains('listening')) {
                    handleKeybinding(event, input, settingsManager, () => {
                        const refreshedSettings = settingsManager.get();
                        updateControlsDisplay(refreshedSettings);
                        updateSerenityControlsDisplay(refreshedSettings);
                    });
                    document.removeEventListener('keydown', keydownHandler);
                }
            };

            document.addEventListener('keydown', keydownHandler);
        });
    });

    // Initialize gamepad bindings listeners
    const gamepadInputs = document.querySelectorAll('.gamepad-input');
    gamepadInputs.forEach((input) => {
        const context = getGamepadBindingContext(input.id);
        const currentBindings = settings[context.bindingsKey] || context.defaultBindings;

        if (currentBindings && currentBindings[context.action] !== undefined) {
            const buttonIndex = currentBindings[context.action];
            input.textContent = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
        }

        input.addEventListener('click', () => {
            // Clear other listening inputs
            document.querySelectorAll('.gamepad-input.listening').forEach((el) => {
                const otherContext = getGamepadBindingContext(el.id);
                const latestSettings = settingsManager.get();
                const otherBindings = latestSettings[otherContext.bindingsKey] || otherContext.defaultBindings;
                const otherButtonIndex = otherBindings?.[otherContext.action];
                if (otherButtonIndex !== undefined) {
                    el.textContent = GAMEPAD_BUTTON_NAMES[otherButtonIndex] || `Button ${otherButtonIndex}`;
                }
                el.classList.remove('listening');
            });

            input.classList.add('listening');
            input.textContent = 'Press a button...';

            handleGamepadBinding(input, settingsManager, () => {
                const refreshedSettings = settingsManager.get();
                updateGamepadControlsDisplay(refreshedSettings);
                updateSerenityControlsDisplay(refreshedSettings);
            });
        });
    });

    // Update controls display
    settings = settingsManager.get();
    updateControlsDisplay(settings);
    updateGamepadControlsDisplay(settings);
    updateSerenityControlsDisplay(settings);
}

/**
 * Sets random interval visibility based on background mode
 * @param {boolean} visible - Whether random interval should be visible
 */
export function setRandomIntervalVisibility(visible) {
    const intervalControl = document.getElementById('random-theme-interval-setting');
    if (intervalControl) {
        intervalControl.style.display = visible ? '' : 'none';
    }
}
