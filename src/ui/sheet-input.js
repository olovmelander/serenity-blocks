/**
 * @fileoverview Keyboard behaviour shared by the Keystone sheets: Settings, Records,
 * Replays, game over and replay complete.
 *
 * - Escape is the way back on every sheet: Records and Replays close, game over and
 *   replay complete return to the main menu (Settings keeps its own handler in
 *   modals.js). Without this the global Escape handler opened Settings on top.
 * - Opening a sheet moves focus into it (its primary control), Tab stays inside the
 *   sheet while it is open, and closing it hands focus back to where it was.
 * - `getOpenSheet()` names the top sheet, so gamepad navigation (gamepad-controller.js)
 *   scopes itself to it.
 *
 * Styles: public/styles/keystone-modals.css. Record: docs/MENU_UI_OVERHAUL_2026-10.md.
 */

/** Sheets from the top layer down (Settings sits above the others). */
export const SHEETS = Object.freeze([
    {
        name: 'settings',
        id: 'settings-modal',
        focus: ['#settings-resume-btn', '.settings-tab.active'],
    },
    {
        name: 'demoBrowser',
        id: 'demo-browser-modal',
        back: 'close-demo-browser',
        focus: ['.demo-card .btn-play', '#import-demo-btn'],
    },
    {
        name: 'highScores',
        id: 'high-scores-modal',
        back: 'close-high-scores',
        focus: ['.play-demo-btn', '#close-high-scores'],
    },
    {
        name: 'demoComplete',
        id: 'demo-complete-modal',
        back: 'demo-main-menu',
        focus: ['#demo-watch-again'],
    },
    {
        name: 'gameOver',
        id: 'game-over-modal',
        back: 'game-over-main-menu',
        focus: ['#game-over-play-again'],
    },
]);

const FOCUSABLE = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisible(element) {
    if (!element) return false;
    if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
    }
    return element.offsetParent !== null;
}

function sheetElement(sheet, doc) {
    return doc?.getElementById?.(sheet.id) || null;
}

function isOpen(element) {
    return Boolean(element?.classList?.contains?.('visible'));
}

/**
 * The topmost open sheet, or null.
 * @param {Document} [doc]
 * @param {{exclude?: string[]}} [options] sheet names to ignore
 * @returns {{name: string, element: HTMLElement, sheet: Object}|null}
 */
export function getOpenSheet(doc = globalThis.document, { exclude = [] } = {}) {
    for (const sheet of SHEETS) {
        if (exclude.includes(sheet.name)) continue;
        const element = sheetElement(sheet, doc);
        if (isOpen(element)) return { name: sheet.name, element, sheet };
    }
    return null;
}

/** Visible, focusable controls inside a sheet, in document order. */
export function getSheetFocusables(element) {
    if (!element?.querySelectorAll) return [];
    return Array.from(element.querySelectorAll(FOCUSABLE)).filter(isVisible);
}

/** The control a sheet should focus when it opens. */
export function getSheetInitialFocus(sheet, element) {
    for (const selector of sheet?.focus || []) {
        const candidate = Array.from(element?.querySelectorAll?.(selector) || []).find(isVisible);
        if (candidate) return candidate;
    }
    return getSheetFocusables(element)[0] || null;
}

let installed = false;

/**
 * Install Escape / Tab / focus handling for the Keystone sheets. Idempotent.
 * @param {Document} [doc]
 */
export function installSheetInput(doc = globalThis.document) {
    if (installed || !doc?.addEventListener || typeof window === 'undefined') return;
    installed = true;
    const returnFocus = new Map();

    const hubOwnsInput = () => Boolean(doc.body?.classList?.contains('serenity-hub-open'));

    doc.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || hubOwnsInput()) return;
        const open = getOpenSheet(doc);
        if (!open) return;

        // An open option list (cosmic-select) closes on this Escape; the sheet stays.
        if (event.key === 'Escape' && doc.activeElement?.classList?.contains('cosmic-open')) {
            event.preventDefault();
            return;
        }

        if (event.key === 'Escape') {
            // Settings closes itself (modals.js); a binding capture owns its own Escape.
            if (open.name === 'settings' || !open.sheet.back) return;
            const back = doc.getElementById(open.sheet.back);
            if (!back || back.disabled) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            back.click();
            return;
        }

        if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const focusables = getSheetFocusables(open.element);
            if (!focusables.length) return;
            const active = doc.activeElement;
            const inside = open.element.contains(active);
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            let target = null;
            if (!inside) target = event.shiftKey ? last : first;
            else if (event.shiftKey && active === first) target = last;
            else if (!event.shiftKey && active === last) target = first;
            if (target) {
                event.preventDefault();
                target.focus();
            }
        }
    }, true);

    window.addEventListener('modalShown', (event) => {
        const name = event?.detail?.modalName;
        const sheet = SHEETS.find((entry) => entry.name === name);
        const element = sheet && sheetElement(sheet, doc);
        if (!element) return;
        const active = doc.activeElement;
        if (active && active !== doc.body && !element.contains(active)) returnFocus.set(name, active);
        // After every modalShown listener has run: Settings decides between its pause and
        // menu layouts in its own listener, and that decides which control comes first.
        const placeFocus = (retry) => {
            if (!isOpen(element) || element.contains(doc.activeElement)) return;
            getSheetInitialFocus(sheet, element)?.focus({ preventScroll: true });
            // A sheet still fading in can refuse focus for a frame; try once more.
            if (retry && !element.contains(doc.activeElement) && typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => placeFocus(false));
            }
        };
        queueMicrotask(() => placeFocus(true));
    });

    window.addEventListener('modalHidden', (event) => {
        const name = event?.detail?.modalName;
        const sheet = SHEETS.find((entry) => entry.name === name);
        const element = sheet && sheetElement(sheet, doc);
        const previous = returnFocus.get(name);
        returnFocus.delete(name);
        if (!element) return;
        const active = doc.activeElement;
        const focusLeftBehind = !active || active === doc.body || element.contains(active);
        if (!focusLeftBehind) return;
        if (previous?.isConnected && isVisible(previous)) {
            previous.focus({ preventScroll: true });
        } else if (element.contains(active)) {
            active.blur();
        }
    });
}
