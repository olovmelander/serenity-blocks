/**
 * @fileoverview Settings Management for Serenity Blocks
 * Handles game settings, persistence to localStorage, and settings UI.
 * The Settings sheet (also the pause sheet in a game) is a Keystone sheet:
 * public/styles/keystone-settings.css, docs/MENU_UI_OVERHAUL_2026-10.md.
 */

import { DEFAULT_SETTINGS } from '../core/constants.js';
import { eventBus, EVENTS } from '../events/event-bus.js';
import { normalizeCursorSettings } from './components/custom-cursor.js';
import { resolveThemeId } from '../themes/theme-registry.js';

const DEFAULT_CONFIG = {
    gameMode: 'single',
    odysseyAutoContinue: true,
    dasDelay: 120,
    dasInterval: 40,
    softDropInterval: 50,
    musicTrack: DEFAULT_SETTINGS.musicTrack,
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

const BINDING_SANITIZERS = {
    keyBindings: sanitizePlayer1KeyBindings,
    player2KeyBindings: sanitizePlayer2KeyBindings,
    serenityKeyBindings: sanitizeSerenityKeyBindings,
    serenityGamepadBindings: sanitizeSerenityGamepadBindings,
};

const CURSOR_SETTING_KEYS = [
    'customCursorEnabled', 'customCursorIntensity',
    'customCursorVisibilityPreset', 'customCursorReducedMotion',
];

// Settings contain scalar values and flat binding maps. Compare only changed
// fields without serializing unrelated controls on every slider input.
function settingValuesEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

function snapshotSettings(settings) {
    return Object.fromEntries(Object.entries(settings).map(([key, value]) => [
        key, value && typeof value === 'object' ? { ...value } : value,
    ]));
}

const captureSessions = new WeakMap();

// The tile whose capture just ended, so the press that finished it (a controller's
// A, read by menu navigation a frame later) cannot start a new capture at once.
let lastCapture = { element: null, at: 0 };
const CAPTURE_SETTLE_MS = 300;

function noteCaptureEnded(element) {
    const now = Date.now();
    lastCapture = { element, at: now };
    const modal = typeof document !== 'undefined' ? document.getElementById?.('settings-modal') : null;
    modal?.setAttribute?.('data-capture-ended', String(now));
}

function captureJustEnded(element) {
    return lastCapture.element === element && Date.now() - lastCapture.at < CAPTURE_SETTLE_MS;
}

const KEY_NAMES = {
    ' ': ['Space', 'Space'],
    Space: ['Space', 'Space'],
    ArrowLeft: ['\u2190', 'Left arrow'],
    ArrowRight: ['\u2192', 'Right arrow'],
    ArrowUp: ['\u2191', 'Up arrow'],
    ArrowDown: ['\u2193', 'Down arrow'],
    Escape: ['Esc', 'Escape'],
    Control: ['Ctrl', 'Control'],
    Backspace: ['\u232b', 'Backspace'],
};

/**
 * How a bound key is drawn on its keycap, and how it is read aloud.
 * @param {string} key - KeyboardEvent.key as stored in the bindings
 * @returns {{text: string, spoken: string}}
 */
export function describeKey(key) {
    if (KEY_NAMES[key]) return { text: KEY_NAMES[key][0], spoken: KEY_NAMES[key][1] };
    const name = String(key ?? '');
    if (name.length === 1) return { text: name.toUpperCase(), spoken: name.toUpperCase() };
    return { text: name, spoken: name };
}

function nameBinding(element, spoken) {
    const label = element.dataset?.actionLabel;
    if (label) element.setAttribute?.('aria-label', `${label}: ${spoken}`);
}

function renderKeyBinding(element, key) {
    const { text, spoken } = describeKey(key);
    element.textContent = text;
    nameBinding(element, spoken);
}

export function cancelSettingsCapture(settingsManager) {
    const cancel = captureSessions.get(settingsManager);
    if (cancel) cancel();
}

/**
 * Settings manager class
 */
export class SettingsManager {
    constructor() {
        this.settings = applyCursorSettingDefaults({ ...DEFAULT_CONFIG });
        this.STORAGE_KEY = 'serenityBlocksSettings';
        this.didLoadFromStorage = false;
        this.dirtyKeys = new Set();
        this.saveTimer = null;
        this.lastSavedJSON = null;
        this.lastSavedSettings = null;
        this.normalizedBindings = Object.fromEntries(
            Object.entries(BINDING_SANITIZERS).map(([key, sanitize]) => {
                this.settings[key] = sanitize(this.settings[key]);
                return [key, this.settings[key]];
            }),
        );
        this.uiAbortController = null;
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
        const previousSettings = this.settings;
        const nextSettings = { ...previousSettings, ...newSettings };
        const touchedKeys = new Set(Object.keys(newSettings));

        Object.entries(BINDING_SANITIZERS).forEach(([key, sanitize]) => {
            if (Object.prototype.hasOwnProperty.call(newSettings, key)
                || previousSettings[key] !== this.normalizedBindings[key]) {
                nextSettings[key] = sanitize({ ...previousSettings[key], ...newSettings[key] });
                this.normalizedBindings[key] = nextSettings[key];
                touchedKeys.add(key);
            }
        });
        if (CURSOR_SETTING_KEYS.some((key) => touchedKeys.has(key))) {
            Object.assign(nextSettings, normalizeCursorSettings(nextSettings));
            CURSOR_SETTING_KEYS.forEach((key) => touchedKeys.add(key));
        }

        const changes = {};
        touchedKeys.forEach((key) => {
            if (!settingValuesEqual(previousSettings[key], nextSettings[key])) {
                changes[key] = nextSettings[key];
                this.dirtyKeys.add(key);
            }
        });
        this.settings = nextSettings;
        if (emit && typeof window !== 'undefined' && Object.keys(changes).length > 0) {
            window.dispatchEvent(new CustomEvent('settingsChanged', { detail: changes }));
        }
        return changes;
    }

    /**
     * Get changes between old and new settings
     * @param {Object} oldSettings - Old settings
     * @param {Object} newSettings - New settings
     * @returns {Object} Changed keys and values
     */
    getChanges(oldSettings, newSettings) {
        const changes = {};
        Object.keys(newSettings).forEach((key) => {
            if (!settingValuesEqual(oldSettings[key], newSettings[key])) {
                changes[key] = newSettings[key];
            }
        });
        return changes;
    }

    /**
     * Saves settings to localStorage
     */
    save({ emitEvent = true } = {}) {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        try {
            const json = JSON.stringify(this.settings);
            if (json === this.lastSavedJSON) {
                this.dirtyKeys.clear();
                return false;
            }
            const dirtyKeys = this.lastSavedSettings
                ? Object.keys(this.getChanges(this.lastSavedSettings, this.settings))
                : Object.keys(this.settings);
            localStorage.setItem(this.STORAGE_KEY, json);
            this.lastSavedJSON = json;
            this.lastSavedSettings = snapshotSettings(this.settings);
            this.dirtyKeys.clear();
            if (emitEvent) {
                eventBus.emit(EVENTS.SETTINGS_CHANGED, {
                    settings: { ...this.settings },
                    dirtyKeys,
                    categories: [...new Set(dirtyKeys.map((key) => (
                        key.endsWith('Bindings') ? 'keybinds' : 'settings'
                    )))],
                    source: 'local',
                });
            }
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return false;
        }
    }

    /** Apply controls live; persist one final value after the drag settles. */
    scheduleSave(delay = 180) {
        if (this.saveTimer !== null) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.save();
        }, delay);
    }

    flushPendingSave() {
        if (this.saveTimer !== null || this.dirtyKeys.size > 0) return this.save();
        return false;
    }

    dispose() {
        cancelSettingsCapture(this);
        this.flushPendingSave();
        this.uiAbortController?.abort();
        this.uiAbortController = null;
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
                this.lastSavedJSON = saved;
                this.lastSavedSettings = { ...loaded };
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
                // A saved background theme can name an id the registry has since
                // retired (e.g. `sky-children-v2`); heal it to the published id
                // so the picker and startup switch both resolve.
                const sanitizedBackgroundTheme = resolveThemeId(
                    loaded.backgroundTheme ?? DEFAULT_CONFIG.backgroundTheme,
                );

                this.settings = {
                    ...DEFAULT_CONFIG,
                    ...loaded,
                    backgroundTheme: sanitizedBackgroundTheme,
                    keyBindings: sanitizedKeyBindings,
                    player2KeyBindings: sanitizedP2KeyBindings,
                    serenityKeyBindings: sanitizedSerenityKeyBindings,
                    serenityGamepadBindings: sanitizedSerenityGamepadBindings,
                };
                this.settings = applyCursorSettingDefaults(this.settings);
                this.didLoadFromStorage = true;
                this.normalizedBindings = Object.fromEntries(
                    Object.keys(BINDING_SANITIZERS).map((key) => [key, this.settings[key]]),
                );

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
                const backgroundThemeChanged = (
                    typeof loaded.backgroundTheme === 'string'
                    && loaded.backgroundTheme !== sanitizedBackgroundTheme
                );
                if (
                    keyBindingsChanged
                    || player2BindingsChanged
                    || serenityKeyBindingsChanged
                    || serenityGamepadBindingsChanged
                    || cursorSettingsChanged
                    || backgroundThemeChanged
                ) {
                    this.save({ emitEvent: false });
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        if (this.didLoadFromStorage) this.lastSavedSettings = snapshotSettings(this.settings);
        this.dirtyKeys.clear();
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
        renderKeyBinding(element, currentBindings[action]);
        element.classList.remove('listening');
        return;
    }

    // Set new key binding
    const newBindings = {
        ...currentBindings,
        [action]: key,
    };

    settingsManager.update({ [bindingsKey]: newBindings });
    renderKeyBinding(element, key);
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

function renderPadBinding(element, buttonIndex) {
    const name = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
    element.textContent = name;
    nameBinding(element, name);
}

/** Buttons already down when a capture starts (the press that opened it). */
function readHeldButtons() {
    const held = new Set();
    const gamepads = (typeof navigator !== 'undefined' && navigator.getGamepads?.()) || [];
    Array.from(gamepads).forEach((gamepad) => {
        gamepad?.buttons?.forEach((button, index) => {
            if (button?.pressed || button?.value > 0.3) held.add(`${gamepad.index}:${index}`);
        });
    });
    return held;
}

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
    cancelSettingsCapture(settingsManager);
    const { action, bindingsKey, defaultBindings } = getGamepadBindingContext(element.id);
    const currentBindings = settingsManager.get()[bindingsKey] || defaultBindings;
    // A press that is still held from opening the capture (A on the tile) is not an answer.
    const heldAtStart = readHeldButtons();
    let pollInterval = null;
    let timeout = null;
    const cancel = () => {
        clearInterval(pollInterval);
        clearTimeout(timeout);
        element.classList.remove('listening');
        renderPadBinding(element, (settingsManager.get()[bindingsKey] || defaultBindings)[action]);
        noteCaptureEnded(element);
        if (captureSessions.get(settingsManager) === cancel) captureSessions.delete(settingsManager);
    };
    captureSessions.set(settingsManager, cancel);
    element.classList.add('listening');
    element.textContent = 'Press a button\u2026';
    pollInterval = setInterval(() => {
        const gamepads = navigator.getGamepads?.() || [];
        for (const gamepad of gamepads) {
            if (!gamepad) continue;
            for (let index = 0; index < gamepad.buttons.length; index++) {
                const button = gamepad.buttons[index];
                const heldKey = `${gamepad.index}:${index}`;
                if (!(button.pressed || button.value > 0.3)) {
                    heldAtStart.delete(heldKey);
                    continue;
                }
                if (heldAtStart.has(heldKey)) continue;
                if (!Object.values(currentBindings).includes(index) || currentBindings[action] === index) {
                    settingsManager.update({
                        [bindingsKey]: {
                            ...(settingsManager.get()[bindingsKey] || defaultBindings), [action]: index,
                        },
                    });
                    settingsManager.save();
                    if (updateCallback) updateCallback();
                }
                cancel();
                return;
            }
        }
    }, 50);
    timeout = setTimeout(cancel, 10000);
    return cancel;
}

export function startKeyboardBindingCapture(element, settingsManager, updateCallback) {
    cancelSettingsCapture(settingsManager);
    const { action, bindingsKey, defaultBindings } = getKeyboardBindingContext(element.id);
    let timeout = null;
    let onKeydown = null;
    const cancel = () => {
        document.removeEventListener('keydown', onKeydown, { capture: true });
        clearTimeout(timeout);
        element.classList.remove('listening');
        renderKeyBinding(element, (settingsManager.get()[bindingsKey] || defaultBindings)[action]);
        noteCaptureEnded(element);
        if (captureSessions.get(settingsManager) === cancel) captureSessions.delete(settingsManager);
    };
    onKeydown = (event) => {
        // The capture owns this press: Escape cancels the capture only (it no longer
        // also closes Settings), and no other key handler sees the new binding.
        event.stopImmediatePropagation?.();
        if (event.key === 'Escape') event.preventDefault();
        else handleKeybinding(event, element, settingsManager, updateCallback);
        cancel();
    };
    captureSessions.set(settingsManager, cancel);
    element.classList.add('listening');
    element.textContent = 'Press a key\u2026';
    // Capture phase, so it runs before the document handlers that close Settings.
    document.addEventListener('keydown', onKeydown, { capture: true });
    timeout = setTimeout(cancel, 10000);
    return cancel;
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

            renderPadBinding(element, bindings[action]);
        });
    });
}

/** Refresh the Player 1 and Player 2 keyboard tiles (after a reset or a capture). */
function updateKeyboardControlsDisplay(settings) {
    [
        ['keyBindings', 'key-', DEFAULT_CONFIG.keyBindings],
        ['player2KeyBindings', 'key-p2-', DEFAULT_CONFIG.player2KeyBindings],
    ].forEach(([key, prefix, fallback]) => {
        const bindings = settings[key] || fallback;
        KEYBOARD_BINDING_ACTIONS.forEach((action) => {
            const element = document.getElementById(`${prefix}${action}`);
            if (element && bindings[action]) renderKeyBinding(element, bindings[action]);
        });
    });
}

function updateSerenityControlsDisplay(settings) {
    const keyBindings = settings.serenityKeyBindings || DEFAULT_CONFIG.serenityKeyBindings;
    SERENITY_KEYBOARD_BINDING_ACTIONS.forEach((action) => {
        const element = document.getElementById(`key-serenity-${action}`);
        if (element && keyBindings[action]) {
            renderKeyBinding(element, keyBindings[action]);
        }
    });

    const gamepadBindings = settings.serenityGamepadBindings || DEFAULT_CONFIG.serenityGamepadBindings;
    SERENITY_GAMEPAD_BINDING_ACTIONS.forEach((action) => {
        const element = document.getElementById(`gamepad-serenity-${action}`);
        const buttonIndex = gamepadBindings[action];
        if (element && buttonIndex !== undefined) {
            renderPadBinding(element, buttonIndex);
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

    settingsModal.querySelectorAll('.settings-tab').forEach((item) => {
        item.classList.remove('active');
        // Tab pattern: one tab in the Tab order, the selection announced.
        item.setAttribute?.('aria-selected', 'false');
        item.setAttribute?.('tabindex', '-1');
    });
    settingsModal.querySelectorAll('.settings-tab-content').forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute?.('aria-selected', 'true');
    tab.setAttribute?.('tabindex', '0');
    settingsModal.querySelector(`#settings-${targetTab}`)?.classList.add('active');
    // A new section starts at its top, not where the last one was scrolled to.
    const scroller = settingsModal.querySelector('.settings-scroll-container');
    if (scroller) scroller.scrollTop = 0;
    settingsModal.dispatchEvent?.(new CustomEvent('settingsSectionChanged', { detail: { tab: targetTab } }));
    return true;
}

/**
 * Move to the previous or next settings section (Q/E, LB/RB, arrow keys on the tabs).
 * @param {HTMLElement} settingsModal
 * @param {number} direction - -1 or 1
 * @returns {HTMLElement|null} the newly selected tab
 */
export function stepSettingsTab(settingsModal, direction) {
    const tabs = Array.from(settingsModal?.querySelectorAll?.('.settings-tab') || []);
    if (!tabs.length) return null;
    const current = tabs.findIndex((tab) => tab.classList.contains('active'));
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    activateSettingsTab(settingsModal, next.getAttribute('data-tab'));
    return next;
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

    controlsTab.querySelectorAll('.controls-subtab').forEach((item) => {
        item.classList.remove('active');
        item.removeAttribute?.('aria-current');
    });
    controlsTab.querySelectorAll('.controls-subtab-content').forEach((item) => item.classList.remove('active'));
    subtab.classList.add('active');
    subtab.setAttribute?.('aria-current', 'true');
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

/** Fill a range input's track up to its value (the spectrum part of the slider). */
export function syncRangeFill(slider) {
    if (!slider) return;
    const min = Number(slider.min);
    const max = Number(slider.max);
    const value = Number(slider.value);
    const low = Number.isFinite(min) ? min : 0;
    const high = Number.isFinite(max) && max > low ? max : 100;
    const ratio = Number.isFinite(value) ? (value - low) / (high - low) : 0;
    slider.style?.setProperty?.('--sb-fill', `${Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10}%`);
}

/** A binding tile is a button: named by its row, and Enter or Space starts a capture. */
function prepareBindingTile(input, listen) {
    input.setAttribute?.('role', 'button');
    const label = document.querySelector?.(`label[for="${input.id}"]`)?.textContent?.trim();
    if (label && input.dataset) input.dataset.actionLabel = label;
    listen(input, 'keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        input.click();
    });
}

const PAUSED_MODE_NAMES = {
    single: 'Single Player',
    infinity: 'Infinity',
    serenity: 'Serenity',
    odyssey: 'Odyssey',
    'local-multiplayer': 'Local Versus',
    'online-multiplayer': 'Online Versus',
};

/**
 * Settings doubles as the pause sheet: from the main menu it is just Settings; while a
 * game is in progress it gains the Paused strip with Resume and Main menu.
 * @param {HTMLElement} settingsModal
 * @returns {'pause'|'menu'}
 */
export function applySettingsContext(settingsModal) {
    if (!settingsModal) return 'menu';
    const onMainMenu = Boolean(document.body?.classList?.contains('start-modal-open'));
    const app = typeof window !== 'undefined' ? window.serenityBlocks : null;
    const mode = onMainMenu ? null : app?.gameModeManager?.getCurrentMode?.();
    const context = mode?.isRunning ? 'pause' : 'menu';
    settingsModal.setAttribute?.('data-context', context);
    if (context !== 'pause') return context;

    const modeId = mode.getModeId?.();
    const online = modeId === 'online-multiplayer';
    const name = PAUSED_MODE_NAMES[modeId];
    const set = (selector, text) => {
        const element = settingsModal.querySelector?.(selector);
        if (element) element.textContent = text;
    };
    set('.settings-pause__title', online ? 'Match in progress' : 'Paused');
    let note = name ? `${name} waits where you left it.` : 'Your game waits where you left it.';
    if (online) note = 'Online matches keep going while Settings is open.';
    set('#settings-pause-note', note);
    set('#settings-resume-btn > span', online ? 'Back to the match' : 'Resume');
    return context;
}

/** Sheet behaviour: section keys, the pause strip, slider fills. */
function setupSettingsSheet(listen) {
    const settingsModal = document.getElementById('settings-modal');
    if (!settingsModal) return;

    // Arrow keys move along the tab strip and select as they go (WAI-ARIA tabs).
    const tabList = settingsModal.querySelector?.('.settings-tabs');
    if (tabList) {
        listen(tabList, 'keydown', (event) => {
            const tab = event.target?.closest?.('.settings-tab');
            if (!tab) return;
            const tabs = Array.from(tabList.querySelectorAll('.settings-tab'));
            let next = null;
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                next = stepSettingsTab(settingsModal, event.key === 'ArrowRight' ? 1 : -1);
            } else if (event.key === 'Home' || event.key === 'End') {
                next = event.key === 'Home' ? tabs[0] : tabs[tabs.length - 1];
                activateSettingsTab(settingsModal, next.getAttribute('data-tab'));
            } else {
                return;
            }
            event.preventDefault();
            next?.focus();
        });
    }

    // Q and E switch sections from anywhere in the sheet (LB and RB on a controller).
    if (typeof document.addEventListener === 'function') {
        listen(document, 'keydown', (event) => {
            if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
            const key = String(event.key || '').toLowerCase();
            if ((key !== 'q' && key !== 'e') || !settingsModal.classList.contains('visible')) return;
            if (event.target?.closest?.('select, textarea, input:not([type="range"]):not([type="checkbox"])')) return;
            event.preventDefault();
            stepSettingsTab(settingsModal, key === 'e' ? 1 : -1)?.focus({ preventScroll: true });
        });
    }

    // Resume does exactly what Close does (modals.js closes, main.js resumes the game).
    const resume = document.getElementById('settings-resume-btn');
    if (resume) {
        listen(resume, 'click', () => document.getElementById('close-settings')?.click());
    }

    // Serenity Hub: close as Resume does, then open the Hub as its tile does. Both happen in
    // this task, so no frame of play runs between them; the Hub pauses again in the modes it
    // pauses. This is how a controller reaches the Hub outside Serenity (Start, then here).
    const hub = document.getElementById('settings-hub-btn');
    if (hub) {
        listen(hub, 'click', () => {
            document.getElementById('close-settings')?.click();
            document.getElementById('serenity-hub-icon')?.click();
        });
    }

    listen(settingsModal, 'input', (event) => {
        if (event.target?.type === 'range') syncRangeFill(event.target);
    });

    if (typeof window !== 'undefined') {
        listen(window, 'modalShown', (event) => {
            if (event.detail?.modalName !== 'settings') return;
            applySettingsContext(settingsModal);
            settingsModal.querySelectorAll?.('input[type="range"]').forEach(syncRangeFill);
        });
    }
}

/** Optional development reference; loaded only when its tab is first selected. */
function setupUrlParameterReference(listen, signal) {
    const modal = document.getElementById('settings-modal');
    const panel = document.getElementById('settings-url-parameters');
    if (!modal || !panel) return;
    let loading = null;
    const load = () => {
        if (loading || signal.aborted) return;
        panel.innerHTML = '<p class="setting-help" role="status">Loading URL parameter reference…</p>';
        loading = import('./url-parameters/UrlParametersView.js').then(({ UrlParametersView }) => {
            if (signal.aborted) return null;
            return new UrlParametersView(panel, { signal });
        }).catch((error) => {
            if (signal.aborted) return;
            loading = null;
            panel.innerHTML = '<p class="setting-help" role="status">The reference could not load. '
                + 'Switch sections and return to try again.</p>';
            console.warn('[Settings] URL parameter reference failed to load:', error);
        });
    };
    listen(modal, 'settingsSectionChanged', (event) => { if (event.detail?.tab === 'url-parameters') load(); });
    if (panel.classList.contains('active')) load();
}

/**
 * Initializes settings UI elements
 * @param {SettingsManager} settingsManager - Settings manager instance
 * @param {Object} callbacks - Callback functions
 */
export function initializeSettingsUI(settingsManager, callbacks) {
    cancelSettingsCapture(settingsManager);
    settingsManager.uiAbortController?.abort();
    const controller = new AbortController();
    settingsManager.uiAbortController = controller;
    const listen = (target, type, handler, options = {}) => {
        target.addEventListener(type, handler, { ...options, signal: controller.signal });
    };
    const finishInteraction = () => {
        cancelSettingsCapture(settingsManager);
        settingsManager.flushPendingSave?.();
    };
    if (typeof window !== 'undefined') {
        listen(window, 'modalHidden', (event) => {
            if (event.detail?.modalName === 'settings') finishInteraction();
        });
        listen(window, 'pagehide', finishInteraction);
    }
    const persistSlider = () => {
        if (settingsManager.scheduleSave) settingsManager.scheduleSave();
        else settingsManager.save();
    };
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
    setupUrlParameterReference(listen, controller.signal);

    // Setup controls sub-tab switching
    setupControlsSubTabs();

    const detectControllersBtn = document.getElementById('detect-controllers');
    if (detectControllersBtn) {
        listen(detectControllersBtn, 'click', () => {
            if (callbacks && typeof callbacks.onGamepadRescan === 'function') {
                callbacks.onGamepadRescan();
            }
        });
    }

    const resetBindingsBtn = document.getElementById('reset-all-bindings');
    if (resetBindingsBtn) {
        listen(resetBindingsBtn, 'click', () => {
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
        updateKeyboardControlsDisplay(settingsManager.get());
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
        listen(button, 'click', () => {
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
        listen(changeGameModeBtn, 'click', () => {
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

        listen(slider, 'input', (event) => {
            const parsedValue = parseInt(event.target.value, 10);
            const numericValue = Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
            settingsManager.update({ [settingKey]: numericValue });
            value.textContent = String(numericValue);
            persistSlider();
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

        listen(musicVolumeSlider, 'input', (e) => {
            const volume = parseInt(e.target.value, 10) / 100;
            settingsManager.update({ musicVolume: volume });
            musicVolumeValue.textContent = e.target.value;
            persistSlider();
        });
    }

    // SFX volume slider
    const sfxVolumeSlider = document.getElementById('sfx-volume');
    const sfxVolumeValue = document.getElementById('sfx-volume-value');
    if (sfxVolumeSlider && sfxVolumeValue) {
        sfxVolumeSlider.value = settings.sfxVolume * 100;
        sfxVolumeValue.textContent = Math.round(settings.sfxVolume * 100);

        listen(sfxVolumeSlider, 'input', (e) => {
            const volume = parseInt(e.target.value, 10) / 100;
            settingsManager.update({ sfxVolume: volume });
            sfxVolumeValue.textContent = e.target.value;
            persistSlider();
        });
    }

    const syncVolumeControls = () => {
        const latest = settingsManager.get();
        [[musicVolumeSlider, musicVolumeValue, latest.musicVolume],
            [sfxVolumeSlider, sfxVolumeValue, latest.sfxVolume]].forEach(([slider, value, volume]) => {
            const percent = String(Math.round(volume * 100));
            if (slider && String(slider.value) !== percent) slider.value = percent;
            if (value && value.textContent !== percent) value.textContent = percent;
        });
    };
    if (typeof window !== 'undefined') {
        listen(window, 'modalShown', (event) => {
            if (event.detail?.modalName === 'settings') syncVolumeControls();
        });
        listen(window, 'settingsChanged', (event) => {
            const changes = event.detail || {};
            if ((changes.musicVolume !== undefined || changes.sfxVolume !== undefined)
                && document.getElementById('settings-modal')?.classList.contains('visible')) {
                syncVolumeControls();
            }
        });
    }

    // Random theme interval slider
    const randomThemeIntervalSlider = document.getElementById('random-theme-interval');
    const randomThemeIntervalValue = document.getElementById('random-theme-interval-value');
    if (randomThemeIntervalSlider && randomThemeIntervalValue) {
        randomThemeIntervalSlider.value = settings.randomThemeInterval;
        randomThemeIntervalValue.textContent = settings.randomThemeInterval;

        listen(randomThemeIntervalSlider, 'input', (e) => {
            const interval = parseInt(e.target.value, 10);
            settingsManager.update({ randomThemeInterval: interval });
            randomThemeIntervalValue.textContent = e.target.value;
            persistSlider();
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

        listen(bgModeSelect, 'change', (e) => {
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
            listen(window, 'settingsChanged', (e) => {
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

        listen(themeLinkedSfxSelect, 'change', (e) => {
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

        listen(pieceLockRippleSelect, 'change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ pieceLockRipple: enabled });
            settingsManager.save();
        });
    }

    // Combo popup effect toggle
    const comboPopupSelect = document.getElementById('combo-popup-effect');
    if (comboPopupSelect) {
        comboPopupSelect.checked = !!settings.comboPopupEffect;

        listen(comboPopupSelect, 'change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ comboPopupEffect: enabled });
            settingsManager.save();
        });
    }

    // Line clear effects toggle
    const lineClearEffectsSelect = document.getElementById('line-clear-effects');
    if (lineClearEffectsSelect) {
        lineClearEffectsSelect.checked = !!settings.lineClearEffects;

        listen(lineClearEffectsSelect, 'change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ lineClearEffects: enabled });
            settingsManager.save();
        });
    }

    // Background combo effects toggle
    const backgroundComboEffectsSelect = document.getElementById('background-combo-effects');
    if (backgroundComboEffectsSelect) {
        backgroundComboEffectsSelect.checked = !!settings.backgroundComboEffects;

        listen(backgroundComboEffectsSelect, 'change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ backgroundComboEffects: enabled });
            settingsManager.save();
        });
    }

    // Theme-based tetrominos toggle
    const themeBasedTetrominosSelect = document.getElementById('theme-based-tetrominos');
    if (themeBasedTetrominosSelect) {
        themeBasedTetrominosSelect.checked = !!(settings.themeBasedTetrominos ?? true);

        listen(themeBasedTetrominosSelect, 'change', (e) => {
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

        listen(sfxSetSelect, 'change', (e) => {
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

        listen(themeLinkedSelect, 'change', (e) => {
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

        listen(autoThemeChangeSelect, 'change', (e) => {
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

        listen(gamepadEnabledSelect, 'change', (e) => {
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

        listen(displayModeSelect, 'change', (e) => {
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

        listen(graphicsQualitySelect, 'change', (e) => {
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

        listen(fpsTargetSelect, 'change', (e) => {
            const fps = parseInt(e.target.value, 10);
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

        listen(vsyncToggle, 'change', (e) => {
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

        listen(antialiasToggle, 'change', (e) => {
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

        listen(showFPSCounter, 'change', (e) => {
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

        listen(customCursorEnabledSelect, 'change', (e) => {
            const enabled = e.target.checked;
            settingsManager.update({ customCursorEnabled: enabled });
            settingsManager.save();
            syncCustomCursorControlAvailability(enabled);
        });
    }

    if (customCursorIntensitySelect) {
        customCursorIntensitySelect.value = settings.customCursorIntensity || 'standard';
        listen(customCursorIntensitySelect, 'change', (e) => {
            settingsManager.update({ customCursorIntensity: e.target.value });
            settingsManager.save();
        });
    }

    if (customCursorVisibilitySelect) {
        customCursorVisibilitySelect.value = settings.customCursorVisibilityPreset || 'standard';
        listen(customCursorVisibilitySelect, 'change', (e) => {
            settingsManager.update({ customCursorVisibilityPreset: e.target.value });
            settingsManager.save();
        });
    }

    if (customCursorMotionSelect) {
        customCursorMotionSelect.value = settings.customCursorReducedMotion || 'system';
        listen(customCursorMotionSelect, 'change', (e) => {
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

        listen(renderQualitySlider, 'input', (e) => {
            const percent = parseInt(e.target.value, 10);
            const scale = percent / 100;
            renderQualityValue.textContent = `${percent}% (${getRenderQualityLabel(percent)})`;

            settingsManager.update({ renderScale: scale });
            persistSlider();

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

        listen(backgroundTabBehaviorSelect, 'change', (e) => {
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
            usesExternalDebugger ? 'Open renderer debugger' : 'Open DevTools'
        );

        const setStatus = (message, tone = 'info') => {
            if (!openDevToolsStatus) {
                return;
            }

            openDevToolsStatus.hidden = !message;
            openDevToolsStatus.textContent = message || '';

            // Colour by tone lives in keystone-settings.css.
            openDevToolsStatus.dataset.tone = tone;
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
                ({ remoteDebuggingUrl } = diagnostics);
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
                    const external = payload.external || usesExternalDebugger;
                    let openedLabel = external ? 'Debugger opened' : 'DevTools open';
                    if (payload.alreadyOpen) openedLabel = 'Already open';
                    openDevToolsBtn.textContent = openedLabel;
                    let openedStatus = remoteDebuggingUrl
                        ? `DevTools opened. Remote inspector available at ${remoteDebuggingUrl}.`
                        : 'DevTools opened.';
                    if (external) {
                        const debuggerUrl = payload.debuggerUrl || remoteDebuggingUrl || '';
                        openedStatus = `Renderer debugger opened. ${debuggerUrl}`.trim();
                    }
                    setStatus(openedStatus, 'success');
                    queueButtonReset();
                    return;
                }

                if (payload.type === 'devtools-open-failed') {
                    clearPendingDevToolsRequest();
                    openDevToolsBtn.textContent = payload.failureKind === 'timeout' ? 'Timed out' : 'Could not open';

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

            listen(openDevToolsBtn, 'click', async () => {
                clearPendingDevToolsRequest();
                openDevToolsBtn.disabled = true;
                openDevToolsBtn.textContent = usesExternalDebugger ? 'Opening debugger…' : 'Opening…';
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
                        openDevToolsBtn.textContent = 'Already open';
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
                        openDevToolsBtn.textContent = 'Timed out';

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
                    openDevToolsBtn.textContent = 'Could not open';

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

        listen(gamepadDeadzoneSlider, 'input', (e) => {
            const deadzone = parseInt(e.target.value, 10) / 100;
            settingsManager.update({ gamepadDeadzone: deadzone });

            if (callbacks.onGamepadDeadzoneChange) {
                callbacks.onGamepadDeadzoneChange(deadzone);
            }

            gamepadDeadzoneValue.textContent = e.target.value;
            persistSlider();
        });
    }

    // Initialize key bindings listeners
    const keyInputs = document.querySelectorAll('.key-input:not(.gamepad-input)');
    keyInputs.forEach((input) => {
        prepareBindingTile(input, listen);
        const context = getKeyboardBindingContext(input.id);
        const currentBindings = settings[context.bindingsKey] || context.defaultBindings;

        if (currentBindings && currentBindings[context.action]) {
            renderKeyBinding(input, currentBindings[context.action]);
        }

        listen(input, 'click', () => {
            if (input.classList.contains('listening') || captureJustEnded(input)) return;
            startKeyboardBindingCapture(input, settingsManager, () => {
                const refreshedSettings = settingsManager.get();
                updateControlsDisplay(refreshedSettings);
                updateKeyboardControlsDisplay(refreshedSettings);
                updateSerenityControlsDisplay(refreshedSettings);
            });
        });
    });

    const gamepadInputs = document.querySelectorAll('.gamepad-input');
    gamepadInputs.forEach((input) => {
        prepareBindingTile(input, listen);
        const context = getGamepadBindingContext(input.id);
        const currentBindings = settings[context.bindingsKey] || context.defaultBindings;
        renderPadBinding(input, currentBindings[context.action]);
        listen(input, 'click', () => {
            if (input.classList.contains('listening') || captureJustEnded(input)) return;
            handleGamepadBinding(input, settingsManager, () => {
                const refreshedSettings = settingsManager.get();
                updateGamepadControlsDisplay(refreshedSettings);
                updateSerenityControlsDisplay(refreshedSettings);
            });
        });
    });

    setupSettingsSheet(listen);

    document.querySelectorAll('#settings-modal input[type="range"]').forEach((slider) => {
        listen(slider, 'change', () => settingsManager.flushPendingSave?.());
        syncRangeFill(slider);
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
        intervalControl.hidden = !visible;
    }
}
