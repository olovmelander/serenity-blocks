// @ts-check
/**
 * @fileoverview The arrow keys walk an open menu the way a controller's D-pad does
 * (gamepad-controller.js `navigateMenu`): focus moves to the nearest control in that
 * direction inside the top sheet (sheet-input.js), the open multiplayer screen
 * (components/mp-sheet.js), the Serenity Hub or the main menu. Tab, Enter, Space and
 * Escape keep their jobs; Enter also turns a toggle and opens a dropdown, as A does.
 * Without it the keyboard reached most menus only by Tab.
 *
 * It runs last (bubble phase) and only where nothing else took the key: surfaces with
 * their own arrow keys (the main menu's mode list, the tab strips, open option lists,
 * the Odyssey navigator, the Stillfall atlas) call preventDefault first. Walking a menu
 * never changes a setting by accident: up and down always move on, and only a control's
 * own axis adjusts it (left and right on a slider, a segmented toggle or a tab strip).
 */
import { SpatialNavigation } from './spatial-navigation.js';
import { getOpenSheet, getSheetInitialFocus } from './sheet-input.js';
import { getTopLayerElement } from './components/mp-sheet.js';

const DIRECTIONS = Object.freeze({
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
});

/** Inputs that take typed text: every arrow key moves the caret there. */
const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'date', 'time']);

/** Widgets whose every arrow key is their own (WAI-ARIA composite roles). */
const ARROW_OWNING_ROLES = '[role="listbox"], [role="menu"], [role="menubar"], [role="grid"], '
    + '[role="tree"], [role="treegrid"], [role="slider"], [role="spinbutton"]';

/** Full-screen surfaces that run their own keys (a Hale session's flow, the breathing guide). */
const OWN_KEYS_SURFACES = '.hale-flow:not([hidden]), #breathing-guide:not([hidden])';

/**
 * Whether the focused control uses this arrow key itself.
 * @param {Element|null} element
 * @param {'up'|'down'|'left'|'right'} direction
 */
export function controlOwnsArrow(element, direction) {
    if (!element || typeof element.matches !== 'function') return false;
    const horizontal = direction === 'left' || direction === 'right';
    if (element.matches('textarea, [contenteditable=""], [contenteditable="true"]')) return true;
    if (element.matches('input')) {
        const type = String(element.getAttribute('type') || '').toLowerCase();
        if (TEXT_INPUT_TYPES.has(type)) return true;
        // A slider or a radio moves along left and right, a number field's caret too; up and
        // down leave them (as on the D-pad). A number still changes by typing or its +/- buttons.
        return (type === 'range' || type === 'radio' || type === 'number') && horizontal;
    }
    // A closed dropdown keeps its value: the arrows walk past it, Enter or Space opens it.
    if (element.matches('select')) return false;
    if (element.closest?.(ARROW_OWNING_ROLES)) return true;
    const group = element.closest?.('[role="tablist"], [role="radiogroup"]');
    if (group) {
        const vertical = group.getAttribute('aria-orientation') === 'vertical';
        return vertical ? !horizontal : horizontal;
    }
    return false;
}

function isShown(element) {
    if (!element) return false;
    if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
    }
    return Boolean(element.getClientRects?.().length);
}

/**
 * The menu the arrow keys walk now, or null (in play the arrows are the game's).
 * @param {Document} doc
 * @returns {{ element: HTMLElement, container: HTMLElement, sheet: any }|null}
 */
export function getKeyboardMenuScope(doc = globalThis.document) {
    const { body } = doc;
    if (doc.querySelector?.(OWN_KEYS_SURFACES)) return null;
    if (body?.classList?.contains('serenity-hub-open')) {
        const panel = doc.getElementById?.('serenity-hub-panel');
        return panel && isShown(panel) ? { element: panel, container: panel, sheet: {} } : null;
    }
    const open = getOpenSheet(doc);
    if (open) {
        // Odyssey's inert cue still owns input, but nothing in it can take focus.
        if (open.element.inert) return null;
        const container = /** @type {HTMLElement} */ (open.element.querySelector?.('.modal-content')) || open.element;
        return { element: open.element, container, sheet: open.sheet };
    }
    const layer = getTopLayerElement();
    if (layer && isShown(layer)) return { element: layer, container: layer, sheet: {} };
    const start = doc.getElementById?.('start-modal');
    if (start?.classList?.contains('visible') && !body?.classList?.contains('start-modal-covered')) {
        return { element: start, container: start, sheet: {} };
    }
    return null;
}

/**
 * Enter on a toggle or a dropdown does what A does: turns the toggle, opens the list.
 * @param {KeyboardEvent} event
 * @param {any} active the focused control (an input or a select)
 */
function pressControl(event, active) {
    if (active.matches('input[type="checkbox"]') && !active.disabled) {
        event.preventDefault();
        active.click();
        return true;
    }
    if (active.matches('select') && !active.disabled && typeof active.showPicker === 'function') {
        event.preventDefault();
        try {
            active.showPicker();
        } catch { /* no user activation: Space and Alt+Down still open it */ }
        return true;
    }
    return false;
}

/**
 * Handle one keydown. Exported for tests; installKeyboardMenuNavigation wires it.
 * @param {KeyboardEvent} event
 * @param {Document} [doc]
 * @returns {boolean} whether the key was used
 */
export function handleMenuKey(event, doc = globalThis.document) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
    const direction = DIRECTIONS[/** @type {keyof typeof DIRECTIONS} */ (event.key)];
    if (!direction && event.key !== 'Enter') return false;
    if (direction && event.shiftKey) return false;

    const scope = getKeyboardMenuScope(doc);
    if (!scope) return false;
    const active = /** @type {HTMLElement|null} */ (doc.activeElement);
    const inside = Boolean(active && active !== doc.body && scope.element.contains(active));

    if (!direction) return inside && !event.repeat && pressControl(event, active);

    // Focus outside the menu (or on nothing): the first arrow puts it on the menu's own
    // first control, as the D-pad does.
    if (!inside) {
        const first = getSheetInitialFocus(scope.sheet, scope.element);
        if (!first) return false;
        event.preventDefault();
        first.focus({ preventScroll: true });
        return true;
    }
    if (controlOwnsArrow(active, direction)) return false;

    const next = SpatialNavigation.findNextElement(active, direction, scope.container);
    if (!next) {
        // Nothing further that way. A dropdown still keeps its value; anything else keeps
        // the key's native job (scrolling a long sheet).
        if (active?.matches?.('select')) event.preventDefault();
        return false;
    }
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView?.({ block: 'nearest' });
    return true;
}

let installed = false;

/**
 * Install the arrow-key menu navigation. Idempotent.
 * @param {Document} [doc]
 */
export function installKeyboardMenuNavigation(doc = globalThis.document) {
    if (installed || !doc?.addEventListener) return;
    installed = true;
    doc.addEventListener('keydown', (event) => {
        try {
            handleMenuKey(event, doc);
        } catch (error) {
            console.error('[Keyboard] Menu navigation failed:', error);
        }
    });
}
