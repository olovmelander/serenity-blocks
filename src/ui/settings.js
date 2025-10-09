/**
 * @fileoverview Settings Management for Serenity Blocks
 * Handles game settings, persistence to localStorage, and settings UI
 */

import { DEFAULT_SETTINGS } from '../core/constants.js';

/**
 * Default settings configuration
 * @type {Object}
 */
const DEFAULT_RIPPLE_COLOR = DEFAULT_SETTINGS.pieceLockRippleColor || '#64c8ff';
function normalizeHexColor(value) {
    if (!value) return null;

    let hex = value.trim().toLowerCase();

    if (!hex.startsWith('#')) {
        hex = `#${hex}`;
    }

    if (hex.length === 4) {
        hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }

    if (!/^#[0-9a-f]{6}$/.test(hex)) {
        return null;
    }

    return hex;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;

    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);

    if ([r, g, b].some((component) => Number.isNaN(component))) {
        return null;
    }

    return { r, g, b };
}

function rgbToHex(r, g, b) {
    const toHex = (value) => {
        const clamped = clamp(Math.round(value), 0, 255);
        const hex = clamped.toString(16).padStart(2, '0');
        return hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r, g, b) {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const delta = max - min;
        s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

        switch (max) {
        case rNorm:
            h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0));
            break;
        case gNorm:
            h = ((bNorm - rNorm) / delta + 2);
            break;
        case bNorm:
            h = ((rNorm - gNorm) / delta + 4);
            break;
        default:
            break;
        }

        h /= 6;
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function hexToHsl(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) {
        return { h: 200, s: 70, l: 60 };
    }
    return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

function hslToRgb(h, s, l) {
    const hue = clamp(h, 0, 360) / 360;
    const sat = clamp(s, 0, 100) / 100;
    const light = clamp(l, 0, 100) / 100;

    if (sat === 0) {
        const value = Math.round(light * 255);
        return { r: value, g: value, b: value };
    }

    const hueToRgb = (p, q, t) => {
        let temp = t;
        if (temp < 0) temp += 1;
        if (temp > 1) temp -= 1;
        if (temp < 1 / 6) return p + (q - p) * 6 * temp;
        if (temp < 1 / 2) return q;
        if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
        return p;
    };

    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;

    const r = hueToRgb(p, q, hue + 1 / 3);
    const g = hueToRgb(p, q, hue);
    const b = hueToRgb(p, q, hue - 1 / 3);

    return {
        r: Math.round(r * 255),
        g: Math.round(g * 255),
        b: Math.round(b * 255)
    };
}

function hslToHex(h, s, l) {
    const { r, g, b } = hslToRgb(h, s, l);
    return rgbToHex(r, g, b);
}

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
    pieceLockRippleColor: DEFAULT_RIPPLE_COLOR,
    comboPopupEffect: true,
    lineClearEffects: true,
    controlScheme: 'ontouchstart' in window ? 'Touch' : 'Keyboard',
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
        showHighScores: 'h'
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
                const loadedKeyBindings = loaded.keyBindings || {};

                this.settings = {
                    ...DEFAULT_CONFIG,
                    ...loaded,
                    keyBindings: {
                        ...DEFAULT_CONFIG.keyBindings,
                        ...loadedKeyBindings
                    }
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
        'showHighScores'
    ];

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

    // Piece lock ripple toggle & custom color picker
    const pieceLockRippleSelect = document.getElementById('piece-lock-ripple');
    const rippleColorInput = document.getElementById('piece-lock-ripple-color');
    const rippleColorResetButton = document.getElementById('piece-lock-ripple-reset');
    const rippleColorTrigger = document.getElementById('piece-lock-ripple-trigger');
    const rippleColorPreview = document.getElementById('piece-lock-ripple-preview');
    const ripplePickerWrapper = rippleColorTrigger?.closest('.color-picker-wrapper');
    const ripplePanel = document.getElementById('piece-lock-ripple-panel');
    const ripplePanelPreview = document.getElementById('piece-lock-ripple-panel-preview');
    const ripplePanelHex = document.getElementById('piece-lock-ripple-hex');
    const rippleHueSlider = document.getElementById('piece-lock-hue');
    const rippleSaturationSlider = document.getElementById('piece-lock-saturation');
    const rippleLightnessSlider = document.getElementById('piece-lock-lightness');
    const ripplePanelClose = document.getElementById('piece-lock-ripple-close');
    const ripplePanelDone = document.getElementById('piece-lock-ripple-done');

    const rippleColorState = {
        hex: normalizeHexColor(settings.pieceLockRippleColor) || DEFAULT_RIPPLE_COLOR,
        h: 200,
        s: 70,
        l: 60
    };

    let isRipplePanelOpen = false;

    const updateSliderBackgrounds = () => {
        if (rippleHueSlider) {
            rippleHueSlider.style.backgroundImage = 'linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)';
        }
        if (rippleSaturationSlider) {
            const desaturated = hslToHex(rippleColorState.h, 0, rippleColorState.l);
            const saturated = hslToHex(rippleColorState.h, 100, rippleColorState.l);
            rippleSaturationSlider.style.backgroundImage = `linear-gradient(90deg, ${desaturated}, ${saturated})`;
        }
        if (rippleLightnessSlider) {
            const dark = hslToHex(rippleColorState.h, rippleColorState.s, 0);
            const mid = hslToHex(rippleColorState.h, rippleColorState.s, 50);
            const light = hslToHex(rippleColorState.h, rippleColorState.s, 100);
            rippleLightnessSlider.style.backgroundImage = `linear-gradient(90deg, ${dark}, ${mid}, ${light})`;
        }
    };

    const updateRipplePreviewUI = () => {
        if (rippleColorPreview) {
            rippleColorPreview.style.setProperty('--preview-color', rippleColorState.hex);
        }
        if (ripplePanelPreview) {
            ripplePanelPreview.style.setProperty('--panel-preview-color', rippleColorState.hex);
        }
        if (ripplePanelHex) {
            ripplePanelHex.textContent = rippleColorState.hex.toUpperCase();
        }
        if (rippleColorTrigger) {
            rippleColorTrigger.title = `Ripple color: ${rippleColorState.hex.toUpperCase()}`;
        }
        if (rippleColorInput) {
            rippleColorInput.value = rippleColorState.hex;
        }
    };

    const applyRippleColorState = ({ persist = true, save = false } = {}) => {
        rippleColorState.hex = hslToHex(rippleColorState.h, rippleColorState.s, rippleColorState.l);
        updateRipplePreviewUI();
        updateSliderBackgrounds();

        if (persist) {
            settingsManager.update({ pieceLockRippleColor: rippleColorState.hex });
            if (save) {
                settingsManager.save();
            }
        }
    };

    const setRippleStateFromHex = (hex, { persist = false, updateSliders = true, save = persist } = {}) => {
        const normalized = normalizeHexColor(hex) || DEFAULT_RIPPLE_COLOR;
        const { h, s, l } = hexToHsl(normalized);
        rippleColorState.hex = normalized;
        rippleColorState.h = h;
        rippleColorState.s = s;
        rippleColorState.l = l;

        if (updateSliders) {
            if (rippleHueSlider) rippleHueSlider.value = h;
            if (rippleSaturationSlider) rippleSaturationSlider.value = s;
            if (rippleLightnessSlider) rippleLightnessSlider.value = l;
        }

        updateRipplePreviewUI();
        updateSliderBackgrounds();

        if (persist) {
            settingsManager.update({ pieceLockRippleColor: normalized });
            if (save) {
                settingsManager.save();
            }
        }
    };

    const handleSliderInput = () => {
        if (rippleHueSlider) {
            rippleColorState.h = parseInt(rippleHueSlider.value, 10) || 0;
        }
        if (rippleSaturationSlider) {
            rippleColorState.s = parseInt(rippleSaturationSlider.value, 10) || 0;
        }
        if (rippleLightnessSlider) {
            rippleColorState.l = parseInt(rippleLightnessSlider.value, 10) || 0;
        }
        applyRippleColorState({ persist: true, save: false });
    };

    const handleSliderChange = () => {
        applyRippleColorState({ persist: true, save: true });
    };

    const closeRipplePanel = () => {
        if (!isRipplePanelOpen) return;
        isRipplePanelOpen = false;
        rippleColorTrigger?.setAttribute('aria-expanded', 'false');
        if (ripplePanel) {
            ripplePanel.hidden = true;
        }
        document.removeEventListener('mousedown', handleDocumentMouseDown);
        document.removeEventListener('keydown', handleKeydown);
        settingsManager.save();
        ripplePickerWrapper?.classList.remove('panel-open');
        if (rippleColorTrigger && !rippleColorTrigger.disabled) {
            rippleColorTrigger.focus();
        }
    };

    const openRipplePanel = () => {
        if (!ripplePanel || !rippleColorTrigger || isRipplePanelOpen || rippleColorTrigger.disabled) {
            return;
        }
        setRippleStateFromHex(rippleColorState.hex, { persist: false, updateSliders: true });
        ripplePanel.hidden = false;
        rippleColorTrigger.setAttribute('aria-expanded', 'true');
        isRipplePanelOpen = true;
        ripplePickerWrapper?.classList.add('panel-open');
        ripplePanel.focus({ preventScroll: true });
        document.addEventListener('mousedown', handleDocumentMouseDown);
        document.addEventListener('keydown', handleKeydown);
        rippleHueSlider?.focus();
    };

    const handleDocumentMouseDown = (event) => {
        if (!isRipplePanelOpen) return;
        if (!ripplePanel?.contains(event.target) && !rippleColorTrigger?.contains(event.target)) {
            closeRipplePanel();
        }
    };

    const handleKeydown = (event) => {
        if (event.key === 'Escape') {
            closeRipplePanel();
        }
    };

    const setRippleControlsEnabled = (enabled) => {
        if (rippleColorInput) {
            rippleColorInput.disabled = !enabled;
        }
        if (rippleColorResetButton) {
            rippleColorResetButton.disabled = !enabled;
        }
        if (rippleColorTrigger) {
            rippleColorTrigger.disabled = !enabled;
            rippleColorTrigger.setAttribute('aria-disabled', enabled ? 'false' : 'true');
            rippleColorTrigger.setAttribute('aria-expanded', 'false');
        }
        if (ripplePickerWrapper) {
            ripplePickerWrapper.classList.toggle('disabled', !enabled);
        }
        if (!enabled) {
            closeRipplePanel();
        }
    };

    if (pieceLockRippleSelect) {
        pieceLockRippleSelect.value = settings.pieceLockRipple ? 'true' : 'false';
        setRippleControlsEnabled(settings.pieceLockRipple);

        pieceLockRippleSelect.addEventListener('change', (e) => {
            const enabled = e.target.value === 'true';
            settingsManager.update({ pieceLockRipple: enabled });
            setRippleControlsEnabled(enabled);
            settingsManager.save();
        });
    }

    if (rippleColorTrigger) {
        rippleColorTrigger.addEventListener('click', () => {
            if (isRipplePanelOpen) {
                closeRipplePanel();
            } else {
                openRipplePanel();
            }
        });
    }

    if (ripplePanelClose) {
        ripplePanelClose.addEventListener('click', () => {
            closeRipplePanel();
        });
    }

    if (ripplePanelDone) {
        ripplePanelDone.addEventListener('click', () => {
            closeRipplePanel();
        });
    }

    if (rippleColorResetButton) {
        rippleColorResetButton.addEventListener('click', () => {
            setRippleStateFromHex(DEFAULT_RIPPLE_COLOR, { persist: true, updateSliders: true });
        });
    }

    if (rippleColorInput) {
        rippleColorInput.value = rippleColorState.hex;
        rippleColorInput.addEventListener('input', (e) => {
            setRippleStateFromHex(e.target.value, { persist: true, updateSliders: true });
        });
        rippleColorInput.addEventListener('change', (e) => {
            setRippleStateFromHex(e.target.value, { persist: true, updateSliders: true });
        });
    }

    if (rippleHueSlider) {
        rippleHueSlider.addEventListener('input', handleSliderInput);
        rippleHueSlider.addEventListener('change', handleSliderChange);
    }

    if (rippleSaturationSlider) {
        rippleSaturationSlider.addEventListener('input', handleSliderInput);
        rippleSaturationSlider.addEventListener('change', handleSliderChange);
    }

    if (rippleLightnessSlider) {
        rippleLightnessSlider.addEventListener('input', handleSliderInput);
        rippleLightnessSlider.addEventListener('change', handleSliderChange);
    }

    setRippleStateFromHex(rippleColorState.hex, { persist: false, updateSliders: true });

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
        const action = input.id.substring(4);
        if (settings.keyBindings[action]) {
            input.textContent = settings.keyBindings[action];
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
