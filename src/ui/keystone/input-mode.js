/**
 * @fileoverview Which input the player is using right now — keyboard, pointer or
 * gamepad — published as one body class (`sb-input-keyboard`, `sb-input-pointer`,
 * `sb-input-gamepad`) and an `sb:inputmode` window event.
 *
 * Menus use it to show the matching key or button hints, and the keystone focus
 * marker uses it to know when to appear: a controller moves focus with `.focus()`,
 * which never matches `:focus-visible` once the mouse has been used.
 */

const CLASS_PREFIX = 'sb-input-';
const MODES = new Set(['keyboard', 'pointer', 'gamepad']);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS']);

let currentMode = null;
let installed = false;

/** @returns {'keyboard'|'pointer'|'gamepad'|null} */
export function getInputMode() {
    return currentMode;
}

/**
 * Record the input the player just used. Cheap when the mode is unchanged.
 * @param {'keyboard'|'pointer'|'gamepad'} mode
 */
export function markInputMode(mode) {
    if (mode === currentMode || !MODES.has(mode)) return;
    const classList = typeof document !== 'undefined' ? document.body?.classList : null;
    if (typeof classList?.add !== 'function') return;
    // Presentation only: it must never break the input path that reports it.
    try {
        if (currentMode) classList.remove(`${CLASS_PREFIX}${currentMode}`);
        classList.add(`${CLASS_PREFIX}${mode}`);
        currentMode = mode;
        if (typeof window?.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('sb:inputmode', { detail: { mode } }));
        }
    } catch { /* a detached or stubbed document */ }
}

/**
 * True when any button is down or a stick is past the deadzone. Used by the gamepad
 * poll only while the mode is not already 'gamepad', so gameplay pays nothing.
 * @param {Gamepad} gamepad
 * @param {number} [deadzone]
 */
export function hasGamepadActivity(gamepad, deadzone = 0.5) {
    if (!gamepad) return false;
    const { buttons = [], axes = [] } = gamepad;
    for (let i = 0; i < buttons.length; i += 1) {
        if (buttons[i]?.pressed) return true;
    }
    for (let i = 0; i < axes.length; i += 1) {
        if (Math.abs(axes[i] || 0) > deadzone) return true;
    }
    return false;
}

export function installInputModeTracking() {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    window.addEventListener('keydown', (event) => {
        if (!MODIFIER_KEYS.has(event.key)) markInputMode('keyboard');
    }, { capture: true, passive: true });

    window.addEventListener('pointerdown', () => markInputMode('pointer'), { capture: true, passive: true });

    // A resting mouse should not steal the mode from a controller: only real movement counts.
    let lastX = null;
    let lastY = null;
    window.addEventListener('pointermove', (event) => {
        if (currentMode === 'pointer') return;
        if (lastX !== null && Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) > 6) {
            markInputMode('pointer');
        }
        lastX = event.clientX;
        lastY = event.clientY;
    }, { capture: true, passive: true });

    window.addEventListener('gamepadconnected', () => markInputMode('gamepad'));
}
