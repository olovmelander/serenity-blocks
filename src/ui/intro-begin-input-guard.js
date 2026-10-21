/**
 * The input that begins the intro must not also choose on the menu it reveals. The menu
 * becomes hit-testable under the pointer within the same task as "begin", while its cards
 * are still fading in from nothing (sb-menu-arrive, sb-rise-in), so:
 * - a key held from "press any key" auto-repeats into the menu and launches a mode;
 * - a tap begins on touchstart, and the click that follows the release lands on the card
 *   under the finger;
 * - a second click (a double-click, or clicking again because the first seemed slow)
 *   lands on a card the player cannot see yet.
 * Until the menu has visibly arrived, clicks and Enter/Space are swallowed, a burst of
 * them keeps the guard up until it pauses, and the key that began stays latched until it
 * is released. Held gamepad buttons are latched by GamepadController when the menu takes
 * the pad.
 */

/** The cards are clearly visible (~0.8 opacity) by here; they finish arriving by ~1.1s. */
export const MENU_ARRIVAL_GUARD_MS = 700;
/** A tap's click follows its release, up to ~300ms later where double-tap zoom applies. */
const RELEASE_CLICK_MS = 400;
/** Presses closer together than this belong to the burst that began, not to a choice. */
const BURST_GAP_MS = 350;

const ACTIVATION_KEYS = new Set(['Enter', ' ']);
const CAPTURE = { capture: true };

/**
 * @param {Event|null} beginEvent the input that began the intro (none for a gamepad press)
 * @param {object} [options]
 * @param {number} [options.durationMs]
 * @param {EventTarget} [options.target] where to listen; window, so the guard runs before
 *   every other listener in the capture phase
 * @param {() => number} [options.now]
 * @returns {() => void} releases the guard early
 */
export function guardMenuArrival(beginEvent, {
    durationMs = MENU_ARRIVAL_GUARD_MS,
    target = typeof window !== 'undefined' ? window : null,
    now = () => performance.now(),
} = {}) {
    if (!target?.addEventListener) return () => {};

    let until = now() + durationMs;
    let heldKey = beginEvent?.type === 'keydown' ? (beginEvent.code || beginEvent.key || null) : null;
    let pointerHeld = beginEvent?.type === 'touchstart' || beginEvent?.type === 'pointerdown';
    let timer = null;
    let released = false;

    const swallow = (event) => {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
    };
    const swallowPress = (event) => {
        swallow(event);
        until = Math.max(until, now() + BURST_GAP_MS);
    };
    const guarding = () => pointerHeld || now() < until;

    const onClick = (event) => {
        if (guarding()) swallowPress(event);
    };
    const onPointerRelease = () => {
        if (!pointerHeld) return;
        pointerHeld = false;
        until = Math.max(until, now() + RELEASE_CLICK_MS);
        scheduleRelease();
    };
    const onKeyDown = (event) => {
        const key = event.code || event.key;
        if (heldKey && key === heldKey) {
            // A fresh press means the release was missed (e.g. focus left mid-hold).
            if (event.repeat) {
                swallow(event);
                return;
            }
            heldKey = null;
        }
        if (now() < until && ACTIVATION_KEYS.has(event.key)) swallowPress(event);
    };
    const onKeyUp = (event) => {
        if (heldKey && (event.code || event.key) === heldKey) {
            heldKey = null;
            scheduleRelease();
        }
    };
    const onBlur = (event) => {
        // The window losing focus drops the key and pointer releases (capture also sees element blurs).
        if (event.target !== target) return;
        heldKey = null;
        onPointerRelease();
        scheduleRelease();
    };

    const listeners = [
        ['click', onClick],
        ['dblclick', onClick],
        ['pointerup', onPointerRelease],
        ['pointercancel', onPointerRelease],
        ['touchend', onPointerRelease],
        ['touchcancel', onPointerRelease],
        ['keydown', onKeyDown],
        ['keyup', onKeyUp],
        ['blur', onBlur],
    ];

    function release() {
        if (released) return;
        released = true;
        clearTimeout(timer);
        listeners.forEach(([type, listener]) => target.removeEventListener(type, listener, CAPTURE));
    }

    function scheduleRelease() {
        if (released) return;
        clearTimeout(timer);
        if (pointerHeld || heldKey) return; // their release reschedules
        const wait = until - now();
        if (wait <= 0) {
            release();
            return;
        }
        timer = setTimeout(scheduleRelease, wait);
    }

    listeners.forEach(([type, listener]) => target.addEventListener(type, listener, CAPTURE));
    scheduleRelease();
    return release;
}
