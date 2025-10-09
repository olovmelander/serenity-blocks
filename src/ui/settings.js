/**
 * @fileoverview Settings Management for Serenity Blocks
 * Handles game settings, persistence to localStorage, and settings UI
 */

import { DEFAULT_SETTINGS } from '../core/constants.js';

/**
 * Default settings configuration
 * @type {Object}
 */
const DEFAULT_CONFIG = {
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
    comboPopupEffect: true,
    controlScheme: 'ontouchstart' in window ? 'Touch' : 'Keyboard',
    keyBindings: {
        moveLeft: 'ArrowLeft',
        moveRight: 'ArrowRight',
        rotateRight: 'ArrowUp',
        rotateLeft: 'z',
        flip: 'a',
        softDrop: 'ArrowDown',
        hardDrop: 'Space'
    }
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
                ...newSettings.keyBindings
            };
        }

        // Emit settings changed event
        if (emit && typeof window !== 'undefined') {
            const changes = this.getChanges(oldSettings, this.settings);
            if (Object.keys(changes).length > 0) {
                window.dispatchEvent(new CustomEvent('settingsChanged', {
                    detail: changes
                }));
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
                this.settings = { ...this.settings, ...loaded };
                if (loaded.keyBindings) {
                    this.settings.keyBindings = {
                        ...this.settings.keyBindings,
                        ...loaded.keyBindings
                    };
                }
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

    const actions = ['moveLeft', 'moveRight', 'rotateRight', 'rotateLeft', 'flip', 'softDrop', 'hardDrop'];

    if (settings.controlScheme === 'Keyboard') {
        document.querySelectorAll('.key-input').forEach(el => {
            if (el.parentElement) el.parentElement.style.display = 'contents';
        });

        actions.forEach(action => {
            if (settings.keyBindings[action]) {
                const title = action.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                list.innerHTML += `<div>${title}: ${settings.keyBindings[action]}</div>`;
            }
        });
    } else {
        document.querySelectorAll('.key-input').forEach(el => {
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

    const action = element.id.substring(4); // Remove 'key-' prefix
    const key = event.key === ' ' ? 'Space' : event.key;
    const settings = settingsManager.get();

    // Check if key is already used for another action
    if (Object.values(settings.keyBindings).includes(key) &&
        settings.keyBindings[action] !== key) {
        // Revert to original key
        element.textContent = settings.keyBindings[action];
        element.classList.remove('listening');
        return;
    }

    // Set new key binding
    settingsManager.setValue('keyBindings', {
        ...settings.keyBindings,
        [action]: key
    });
    element.textContent = key;
    element.classList.remove('listening');

    settingsManager.save();
    if (updateCallback) updateCallback();
}

/**
 * Sets up settings tab switching
 */
export function setupSettingsTabs() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('settings-' + targetTab).classList.add('active');
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
            } else { // 'Level'
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
            bgThemeSelect.innerHTML = THEMES.map(theme =>
                `<option value="${theme}">${theme.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</option>`
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

    // Piece lock ripple toggle
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
            settingsManager.update({ soundSet: soundSet });

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

    // Initialize key bindings listeners
    const keyInputs = document.querySelectorAll('.key-input');
    keyInputs.forEach(input => {
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

    // Update controls display
    updateControlsDisplay(settings);
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
