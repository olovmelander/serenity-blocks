/**
 * @fileoverview Settings Management for Serenity Blocks
 * Handles game settings, persistence to localStorage, and settings UI
 */

import { DEFAULT_SETTINGS } from '../core/constants.js';
import { DisplayManager } from '../core/display-manager.js';

const DEFAULT_CONFIG = {
    gameMode: 'single',
    dasDelay: 120,
    dasInterval: 40,
    musicTrack: 'Ambient',
    soundSet: 'Zen',
    musicVolume: 1.0,
    sfxVolume: 1.0,
    backgroundMode: 'Level', // 'Level', 'Specific', 'Random'
    backgroundTheme: 'forest',
    themeLinkedMode: false,
    autoThemeChange: false,
    randomThemeInterval: 60,
    pieceLockRipple: true,
    pieceLockRippleColor: '#64c8ff',
    comboPopupEffect: true,
    lineClearEffects: true,
    backgroundComboEffects: true,
    sunsetFlareIntensity: 'full',
    // Tetromino Visual Settings
    themeBasedTetrominos: true, // Use theme-specific tetromino colors and effects
    controlScheme: 'Keyboard',
    gamepadEnabled: true,
    gamepadDeadzone: 0.25,
    // Display Settings (Phase 1)
    displayMode: 'windowed', // 'windowed' | 'fullscreen' | 'borderless'
    resolution: 'auto', // 'auto' | '1280x720' | '1920x1080' | etc.
    customResolution: null, // { width: number, height: number } or null
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
    keyBindings: {
        moveLeft: 'ArrowLeft',
        moveRight: 'ArrowRight',
        rotateRight: 'ArrowUp',
        rotateLeft: 'z',
        flip: 'a',
        softDrop: 'ArrowDown',
        hardDrop: 'Space',
        nextTrack: 'm',
        randomTheme: 'b',
        togglePause: 'p',
        toggleFullscreen: 'f',
        showHighScores: 'h',
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
};

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

const SERENITY_GAMEPAD_DEFAULTS = [
    'Y (Triangle)',
    'X (Square)',
    'L3 (L-Stick Click)',
    'R3 (R-Stick Click)',
    'LB (L1)',
    'RB (R1)',
    'LT (L2)',
    'RT (R2)',
    'Select (Share)',
    'Start (Options)',
    'D-Pad Down',
    'D-Pad Up',
    'A (Cross)',
    'B (Circle)',
    'D-Left / L-Stick Left',
    'D-Right / L-Stick Right',
    'D-Up / L-Stick Up',
    'D-Down / L-Stick Down',
    'R-Stick Up/Down',
];

const SERENITY_KEYBOARD_DEFAULTS = [
    'H',
    'Space',
    'T',
    'M',
    'B',
    'F',
    '/ or ?',
    'ESC',
    'Click',
    'H or ESC',
    'Click Tab Button',
    'Mouse Wheel',
    'Mouse / Click',
];

/**
 * Settings manager class
 */
export class SettingsManager {
    constructor() {
        this.settings = { ...DEFAULT_CONFIG };
        this.STORAGE_KEY = 'serenityBlocksSettings';
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
        this.settings = { ...this.settings, ...newSettings };
        if (newSettings.keyBindings) {
            this.settings.keyBindings = {
                ...this.settings.keyBindings,
                ...newSettings.keyBindings,
            };
        }

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
    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    /**
     * Loads settings from localStorage
     * @returns {Object} Loaded settings
     */
    load() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const loaded = JSON.parse(saved);
                const loadedKeyBindings = loaded.keyBindings || {};
                const loadedP2KeyBindings = loaded.player2KeyBindings || {};

                this.settings = {
                    ...DEFAULT_CONFIG,
                    ...loaded,
                    keyBindings: {
                        ...DEFAULT_CONFIG.keyBindings,
                        ...loadedKeyBindings,
                    },
                    player2KeyBindings: {
                        ...DEFAULT_CONFIG.player2KeyBindings,
                        ...loadedP2KeyBindings,
                    },
                };
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        return this.settings;
    }

    /**
     * Resets settings to defaults
     */
    reset() {
        this.settings = { ...DEFAULT_CONFIG };
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
        'nextTrack',
        'randomTheme',
        'toggleFullscreen',
        'showHighScores',
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
export function handleKeybinding(event, element, settingsManager, updateCallback) {
    event.preventDefault();

    const elementId = element.id;
    const key = event.key === ' ' ? 'Space' : event.key;
    const settings = settingsManager.get();

    // Determine if this is player 2 binding
    const isPlayer2 = elementId.startsWith('key-p2-');
    const action = isPlayer2
        ? elementId.substring(7) // Remove 'key-p2-' prefix
        : elementId.substring(4); // Remove 'key-' prefix

    const bindingsKey = isPlayer2 ? 'player2KeyBindings' : 'keyBindings';
    const currentBindings = isPlayer2 ? settings.player2KeyBindings : settings.keyBindings;

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
    const match = /^gamepad(?:-p(\d))?-(.+)$/.exec(elementId);
    const rawIndex = match && match[1] ? parseInt(match[1], 10) - 1 : 0;
    const playerIndex = Number.isNaN(rawIndex) ? 0 : Math.min(Math.max(rawIndex, 0), GAMEPAD_BINDING_KEYS.length - 1);
    const action = match ? match[2] : elementId;

    return {
        playerIndex,
        action,
        bindingsKey: GAMEPAD_BINDING_KEYS[playerIndex],
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

    const { playerIndex, action, bindingsKey } = getGamepadBindingContext(elementId);
    let currentBindings = settings[bindingsKey];

    if (!currentBindings) {
        currentBindings = { ...DEFAULT_GAMEPAD_BINDINGS[playerIndex] };
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
                if (gamepad.buttons[btnIndex].pressed) {
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

/**
 * Sets up settings tab switching
 */
export function setupSettingsTabs() {
    document.querySelectorAll('.settings-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            document.querySelectorAll('.settings-tab').forEach((t) => t.classList.remove('active'));
            document
                .querySelectorAll('.settings-tab-content')
                .forEach((c) => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`settings-${targetTab}`).classList.add('active');
        });
    });
}

/**
 * Sets up controls sub-tab switching
 */
export function setupControlsSubTabs() {
    document.querySelectorAll('.controls-subtab').forEach((subtab) => {
        subtab.addEventListener('click', () => {
            const targetSubtab = subtab.getAttribute('data-subtab');
            document.querySelectorAll('.controls-subtab').forEach((t) => t.classList.remove('active'));
            document
                .querySelectorAll('.controls-subtab-content')
                .forEach((c) => c.classList.remove('active'));
            subtab.classList.add('active');
            document.getElementById(`controls-${targetSubtab}`).classList.add('active');
        });
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

    const resetSerenityGamepadDisplay = () => {
        const nodes = document.querySelectorAll('#controls-serenity-gamepad .gamepad-display');
        nodes.forEach((node, index) => {
            const value = SERENITY_GAMEPAD_DEFAULTS[index];
            if (value !== undefined) {
                node.textContent = value;
            }
        });
    };

    const resetSerenityKeyboardDisplay = () => {
        const nodes = document.querySelectorAll('#controls-serenity-keyboard .gamepad-display');
        nodes.forEach((node, index) => {
            const value = SERENITY_KEYBOARD_DEFAULTS[index];
            if (value !== undefined) {
                node.textContent = value;
            }
        });
    };

    const applyKeyDefaults = (key) => {
        if (!DEFAULT_SETTINGS[key]) return;
        settingsManager.update({ [key]: { ...DEFAULT_SETTINGS[key] } });
        settingsManager.save();
        updateControlsDisplay(settingsManager.get());
    };

    const applyGamepadDefaults = (key) => {
        if (!DEFAULT_SETTINGS[key]) return;
        settingsManager.update({ [key]: { ...DEFAULT_SETTINGS[key] } });
        settingsManager.save();
        updateGamepadControlsDisplay(settingsManager.get());
    };

    const bindingResetHandlers = {
        'keyboard-player1': () => applyKeyDefaults('keyBindings'),
        'keyboard-player2': () => applyKeyDefaults('player2KeyBindings'),
        'keyboard-serenity': () => resetSerenityKeyboardDisplay(),
        'gamepad-player1': () => applyGamepadDefaults('gamepadBindings'),
        'gamepad-player2': () => applyGamepadDefaults('player2GamepadBindings'),
        'gamepad-player3': () => applyGamepadDefaults('player3GamepadBindings'),
        'gamepad-player4': () => applyGamepadDefaults('player4GamepadBindings'),
        'gamepad-serenity': () => resetSerenityGamepadDisplay(),
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
            if (mode === 'Specific') {
                setThemeSelectorVisibility(true);
                setRandomIntervalVisibility(false);
            } else if (mode === 'Random') {
                setThemeSelectorVisibility(false);
                setRandomIntervalVisibility(true);
            } else {
                // 'Level'
                setThemeSelectorVisibility(false);
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
    }

    // Background theme selector - populate dropdown and handle changes
    const bgThemeSelect = document.getElementById('background-theme');
    if (bgThemeSelect && callbacks.onBackgroundThemeChange) {
        // Import themes list
        import('../core/constants.js').then(({ THEMES }) => {
            // Populate dropdown with available themes
            bgThemeSelect.innerHTML = THEMES.map(
                (theme) => `<option value="${theme}">${theme
                    .split('-')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ')}</option>`,
            ).join('');

            // Set current value
            bgThemeSelect.value = settings.backgroundTheme || 'forest';

            // Handle theme changes
            bgThemeSelect.addEventListener('change', (e) => {
                const theme = e.target.value;
                settingsManager.update({ backgroundTheme: theme });

                if (callbacks.onBackgroundThemeChange) {
                    callbacks.onBackgroundThemeChange(theme);
                }

                settingsManager.save();
            });
        });
    }

    // Piece lock ripple toggle & custom color picker
    const pieceLockRippleSelect = document.getElementById('piece-lock-ripple');

    if (pieceLockRippleSelect) {
        pieceLockRippleSelect.value = settings.pieceLockRipple ? 'true' : 'false';

        pieceLockRippleSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ pieceLockRipple: enabled });
            settingsManager.save();
        });
    }

    // Combo popup effect toggle
    const comboPopupSelect = document.getElementById('combo-popup-effect');
    if (comboPopupSelect) {
        comboPopupSelect.value = settings.comboPopupEffect ? 'true' : 'false';

        comboPopupSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ comboPopupEffect: enabled });
            settingsManager.save();
        });
    }

    // Line clear effects toggle
    const lineClearEffectsSelect = document.getElementById('line-clear-effects');
    if (lineClearEffectsSelect) {
        lineClearEffectsSelect.value = settings.lineClearEffects ? 'true' : 'false';

        lineClearEffectsSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ lineClearEffects: enabled });
            settingsManager.save();
        });
    }

    // Background combo effects toggle
    const backgroundComboEffectsSelect = document.getElementById('background-combo-effects');
    if (backgroundComboEffectsSelect) {
        backgroundComboEffectsSelect.value = settings.backgroundComboEffects ? 'true' : 'false';

        backgroundComboEffectsSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ backgroundComboEffects: enabled });
            settingsManager.save();
        });
    }

    // Theme-based tetrominos toggle
    const themeBasedTetrominosSelect = document.getElementById('theme-based-tetrominos');
    if (themeBasedTetrominosSelect) {
        themeBasedTetrominosSelect.value = (settings.themeBasedTetrominos ?? true) ? 'true' : 'false';

        themeBasedTetrominosSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ themeBasedTetrominos: enabled });
            settingsManager.save();
            console.log(`[Settings] Theme-based tetrominos ${enabled ? 'enabled' : 'disabled'}`);
        });
    }

    const sunsetFlareSelect = document.getElementById('sunset-flare-intensity');
    if (sunsetFlareSelect) {
        sunsetFlareSelect.value = settings.sunsetFlareIntensity || 'full';
        sunsetFlareSelect.addEventListener('change', (e) => {
            settingsManager.update({ sunsetFlareIntensity: e.target.value });
            settingsManager.save();
        });
    }

    // Music track selector
    const musicTrackSelect = document.getElementById('music-track');
    if (musicTrackSelect) {
        musicTrackSelect.value = settings.musicTrack || 'Ambient';

        musicTrackSelect.addEventListener('change', (e) => {
            const track = e.target.value;
            settingsManager.update({ musicTrack: track });

            if (callbacks.onMusicTrackChange) {
                callbacks.onMusicTrackChange(track);
            }

            settingsManager.save();
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
        themeLinkedSelect.value = settings.themeLinkedMode ? 'true' : 'false';

        themeLinkedSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
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
        autoThemeChangeSelect.value = settings.autoThemeChange ? 'true' : 'false';

        autoThemeChangeSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
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
    // Resolution selector
    const resolutionSelect = document.getElementById('resolution-select');
    if (resolutionSelect) {
        // Populate with common resolutions
        const displayMgr = new DisplayManager();
        // Allow up to 4K options regardless of current screen (downscaling or windowed mode)
        const resolutions = displayMgr.getCommonResolutions(4096, 4096);

        let optionsHtml = '<option value="auto">Auto (Native)</option>';
        resolutions.forEach((res) => {
            optionsHtml += `<option value="${res.width}x${res.height}">${res.label}</option>`;
        });
        resolutionSelect.innerHTML = optionsHtml;

        resolutionSelect.value = settings.resolution || 'auto';

        resolutionSelect.addEventListener('change', (e) => {
            const resolution = e.target.value;
            settingsManager.update({ resolution });
            settingsManager.save();

            // Apply settings immediately
            if (callbacks.onDisplaySettingsApply) {
                callbacks.onDisplaySettingsApply(settingsManager.get());
            }
        });
    }

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
        vsyncToggle.value = String(settings.vsyncEnabled ?? true);

        vsyncToggle.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ vsyncEnabled: enabled });
            settingsManager.save();

            console.log(`[Settings] VSync ${enabled ? 'enabled' : 'disabled'}`);

            if (callbacks.onFrameRateSettingsApply) {
                callbacks.onFrameRateSettingsApply(settingsManager.get());
            }
        });
    }

    // FPS counter toggle
    const showFPSCounter = document.getElementById('show-fps-counter');
    if (showFPSCounter) {
        showFPSCounter.value = String(settings.showFPSCounter || false);

        showFPSCounter.addEventListener('change', (e) => {
            const show = e.target.value === 'true';
            settingsManager.update({ showFPSCounter: show });
            settingsManager.save();

            console.log(`[Settings] FPS counter ${show ? 'shown' : 'hidden'}`);

            // Apply immediately
            if (callbacks.onDisplaySettingsApply) {
                callbacks.onDisplaySettingsApply(settingsManager.get());
            }
        });
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
    const keyInputs = document.querySelectorAll('.key-input');
    keyInputs.forEach((input) => {
        const elementId = input.id;
        const isPlayer2 = elementId.startsWith('key-p2-');
        const action = isPlayer2
            ? elementId.substring(7) // Remove 'key-p2-' prefix
            : elementId.substring(4); // Remove 'key-' prefix

        const currentBindings = isPlayer2 ? settings.player2KeyBindings : settings.keyBindings;

        if (currentBindings && currentBindings[action]) {
            input.textContent = currentBindings[action];
        }

        input.addEventListener('click', () => {
            input.classList.add('listening');
            input.textContent = 'Press a key...';

            // Add temporary keydown listener
            const keydownHandler = (event) => {
                if (input.classList.contains('listening')) {
                    handleKeybinding(event, input, settingsManager, () => {
                        updateControlsDisplay(settingsManager.get());
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
        const currentBindings = settings[context.bindingsKey] || DEFAULT_GAMEPAD_BINDINGS[context.playerIndex];

        if (currentBindings && currentBindings[context.action] !== undefined) {
            const buttonIndex = currentBindings[context.action];
            input.textContent = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
        }

        input.addEventListener('click', () => {
            // Clear other listening inputs
            document.querySelectorAll('.gamepad-input.listening').forEach((el) => {
                const otherContext = getGamepadBindingContext(el.id);
                const latestSettings = settingsManager.get();
                const otherBindings = latestSettings[otherContext.bindingsKey] || DEFAULT_GAMEPAD_BINDINGS[otherContext.playerIndex];
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
            });
        });
    });

    // Update controls display
    settings = settingsManager.get();
    updateControlsDisplay(settings);
    updateGamepadControlsDisplay(settings);
}

/**
 * Sets theme selector visibility based on background mode
 * @param {boolean} visible - Whether theme selector should be visible
 */
export function setThemeSelectorVisibility(visible) {
    const selector = document.getElementById('theme-setting');
    if (selector) {
        selector.style.display = visible ? '' : 'none';
    }
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
