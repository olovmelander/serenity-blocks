/**
 * @fileoverview Settings Management for Serenity Blocks
 * Handles game settings, persistence to localStorage, and settings UI
 */

import { DEFAULT_SETTINGS } from '../core/constants.js';


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
    controlScheme: 'ontouchstart' in window ? 'Touch' : 'Keyboard',
    gamepadEnabled: true,
    gamepadDeadzone: 0.25,
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
        moveLeft: 14,      // D-pad Left
        moveRight: 15,     // D-pad Right
        rotateRight: 0,    // A Button
        rotateLeft: 3,     // Y Button
        flip: 2,           // X Button
        softDrop: 13,      // D-pad Down
        hardDrop: 1,       // B Button
        pause: 9,          // Start Button
    },
    player2GamepadBindings: {
        moveLeft: 14,      // D-pad Left
        moveRight: 15,     // D-pad Right
        rotateRight: 0,    // A Button
        rotateLeft: 3,     // Y Button
        flip: 2,           // X Button
        softDrop: 13,      // D-pad Down
        hardDrop: 1,       // B Button
        pause: 9,          // Start Button
    },
};

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

/**
 * Handles gamepad binding input
 * @param {HTMLElement} element - Input element
 * @param {SettingsManager} settingsManager - Settings manager instance
 * @param {Function} updateCallback - Callback to update controls display
 */
export function handleGamepadBinding(element, settingsManager, updateCallback) {
    const elementId = element.id;
    const settings = settingsManager.get();
    
    // Determine if this is player 2 binding
    const isPlayer2 = elementId.startsWith('gamepad-p2-');
    const action = isPlayer2
        ? elementId.substring(11) // Remove 'gamepad-p2-' prefix
        : elementId.substring(8); // Remove 'gamepad-' prefix

    const bindingsKey = isPlayer2 ? 'player2GamepadBindings' : 'gamepadBindings';
    const currentBindings = isPlayer2 ? settings.player2GamepadBindings : settings.gamepadBindings;

    // Listen for gamepad button press
    let pollInterval = setInterval(() => {
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
                        ...currentBindings,
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
            element.textContent = GAMEPAD_BUTTON_NAMES[currentBindings[action]] || `Button ${currentBindings[action]}`;
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
    
    // Update Player 1 gamepad bindings
    actions.forEach((action) => {
        const element = document.getElementById(`gamepad-${action}`);
        if (element && settings.gamepadBindings && settings.gamepadBindings[action] !== undefined) {
            const buttonIndex = settings.gamepadBindings[action];
            element.textContent = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
        }
    });

    // Update Player 2 gamepad bindings
    actions.forEach((action) => {
        const element = document.getElementById(`gamepad-p2-${action}`);
        if (element && settings.player2GamepadBindings && settings.player2GamepadBindings[action] !== undefined) {
            const buttonIndex = settings.player2GamepadBindings[action];
            element.textContent = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
        }
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
    const settings = settingsManager.get();

    // Setup tab switching
    setupSettingsTabs();

    // Setup controls sub-tab switching
    setupControlsSubTabs();

    // Game mode selector
    const gameModeSelect = document.getElementById('game-mode');
    if (gameModeSelect) {
        gameModeSelect.value = settings.gameMode || 'single';

        gameModeSelect.addEventListener('change', async (e) => {
            const mode = e.target.value;
            console.log('[Settings] Game mode changed to:', mode);
            settingsManager.update({ gameMode: mode });

            if (callbacks && callbacks.onGameModeChange) {
                console.log('[Settings] Calling onGameModeChange callback');
                try {
                    await callbacks.onGameModeChange(mode);
                } catch (error) {
                    console.error('[Settings] Error in onGameModeChange callback:', error);
                }
            } else {
                console.warn('[Settings] No onGameModeChange callback registered');
            }

            settingsManager.save();
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
        const elementId = input.id;
        const isPlayer2 = elementId.startsWith('gamepad-p2-');
        const action = isPlayer2
            ? elementId.substring(11) // Remove 'gamepad-p2-' prefix
            : elementId.substring(8); // Remove 'gamepad-' prefix

        const currentBindings = isPlayer2 ? settings.player2GamepadBindings : settings.gamepadBindings;

        if (currentBindings && currentBindings[action] !== undefined) {
            const buttonIndex = currentBindings[action];
            input.textContent = GAMEPAD_BUTTON_NAMES[buttonIndex] || `Button ${buttonIndex}`;
        }

        input.addEventListener('click', () => {
            // Clear other listening inputs
            document.querySelectorAll('.gamepad-input.listening').forEach((el) => {
                const elId = el.id;
                const elIsPlayer2 = elId.startsWith('gamepad-p2-');
                const elAction = elIsPlayer2 ? elId.substring(11) : elId.substring(8);
                const elBindings = elIsPlayer2 ? settings.player2GamepadBindings : settings.gamepadBindings;
                const elButtonIndex = elBindings[elAction];
                el.textContent = GAMEPAD_BUTTON_NAMES[elButtonIndex] || `Button ${elButtonIndex}`;
                el.classList.remove('listening');
            });

            input.classList.add('listening');
            input.textContent = 'Press a button...';

            handleGamepadBinding(input, settingsManager, () => {
                updateGamepadControlsDisplay(settingsManager.get());
            });
        });
    });

    // Update controls display
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
        selector.style.display = visible ? 'contents' : 'none';
    }
}

/**
 * Sets random interval visibility based on background mode
 * @param {boolean} visible - Whether random interval should be visible
 */
export function setRandomIntervalVisibility(visible) {
    const intervalControl = document.getElementById('random-theme-interval-setting');
    if (intervalControl) {
        intervalControl.style.display = visible ? 'contents' : 'none';
    }
}
