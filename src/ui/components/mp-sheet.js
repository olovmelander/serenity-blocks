/**
 * @fileoverview Shared Keystone pieces for the multiplayer screens — local setup,
 * lobby browser, create match, waiting room and results: line icons, the Escape /
 * back stack, an in-app confirmation sheet and plain-language match descriptions.
 *
 * Styles: public/styles/keystone-multiplayer.css. Record: docs/MENU_UI_OVERHAUL_2026-10.md.
 *
 * Escape: every open multiplayer surface registers itself with `openLayer()`. One
 * window capture listener gives Escape to the top-most open surface and stops it
 * there, so the global gameplay handler no longer opens Settings on top of a
 * multiplayer menu. Settings, the Serenity Hub and an open dropdown keep their own
 * Escape.
 */

import { COSMIC_ICON_NAMES, csIconInner } from './cosmic-icons.js';

/**
 * A glyph from the game's one icon set (cosmic-icons.js) in the multiplayer screens' own
 * element, so their CSS (`.sb-mp-icon`) keeps working.
 * @param {string} name icon key
 * @param {number} [size=18] px
 * @param {string} [cls=''] extra class
 * @returns {string} inline, decorative <svg> markup
 */
export function mpIcon(name, size = 18, cls = '') {
    const inner = csIconInner(COSMIC_ICON_NAMES.includes(name) ? name : 'check');
    return `<svg class="sb-mp-icon${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" `
        + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
        + `focusable="false">${inner}</svg>`;
}

/* ---- Plain-language match descriptions ------------------------------------------ */

const CONDITION_LABELS = {
    frags: 'Frags',
    time: 'Time limit',
    points: 'Score target',
    lines: 'Lines',
    never: 'Endless',
    survival: 'Last standing',
    'infinity-lms': 'Last standing',
};

/** "frags" → "Frags": the human name of a win condition key. */
export function conditionLabel(condition) {
    return CONDITION_LABELS[condition] || 'Frags';
}

/**
 * One sentence for a goal, the same on every online surface (lobby list, waiting room,
 * match bar, scoreboard, results): "First to 10 frags", "3-minute match", "Endless".
 */
export function describeGoal(condition, value) {
    const amount = Number(value);
    const known = Number.isFinite(amount) && amount > 0;
    const plural = (word) => `${word}${amount === 1 ? '' : 's'}`;
    switch (condition) {
    case 'frags': return known ? `First to ${amount} ${plural('frag')}` : 'Most frags wins';
    case 'time': return known ? `${amount}-minute match` : 'Timed match';
    case 'points': return known ? `First to ${(amount * 1000).toLocaleString()} points` : 'Score target';
    case 'lines': return known ? `First to ${amount} ${plural('line')}` : 'Lines target';
    case 'never': return 'Endless';
    default: return conditionLabel(condition);
    }
}

/* ---- Escape / back stack --------------------------------------------------------- */

const layers = [];
let escapeInstalled = false;

const TEXT_FIELD = 'input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea';

function isOpen(element) {
    return Boolean(element?.isConnected) && !element.classList.contains('hidden');
}

function topLayer() {
    for (let i = layers.length - 1; i >= 0; i -= 1) {
        if (isOpen(layers[i].element)) return layers[i];
    }
    return null;
}

function onEscape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (document.getElementById('settings-modal')?.classList.contains('visible')) return;
    if (document.body?.classList.contains('serenity-hub-open')) return;
    // An open dropdown closes itself first (its trigger handles Escape).
    if (event.target?.closest?.('.cosmic-select.is-open')) return;
    const layer = topLayer();
    if (!layer) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // On full screens with chat, the first Escape only leaves the text field.
    if (layer.fieldsFirst && event.target?.matches?.(TEXT_FIELD)) {
        event.target.blur();
        return;
    }
    layer.onBack();
}

/**
 * Give Escape to a multiplayer surface while it is open. Re-opening moves it to the
 * top. Call `closeLayer` (or the returned function) when it hides.
 * @param {HTMLElement} element the surface root (open while it lacks `.hidden`)
 * @param {Function} onBack what Escape does (the same as the surface's Back button)
 * @param {{fieldsFirst?: boolean}} [options]
 */
export function openLayer(element, onBack, { fieldsFirst = false } = {}) {
    if (typeof window === 'undefined' || !element) return () => {};
    if (!escapeInstalled) {
        escapeInstalled = true;
        window.addEventListener('keydown', onEscape, true);
    }
    closeLayer(element);
    layers.push({ element, onBack, fieldsFirst });
    return () => closeLayer(element);
}

export function closeLayer(element) {
    const index = layers.findIndex((layer) => layer.element === element);
    if (index >= 0) layers.splice(index, 1);
}

/** The open multiplayer surface on top, if any (controller navigation scopes to it). */
export function getTopLayerElement() {
    return topLayer()?.element || null;
}

/** Controller B: the same as Escape on the top surface. True when a surface took it. */
export function goBackFromTopLayer() {
    const layer = topLayer();
    if (!layer) return false;
    layer.onBack();
    return true;
}

/** Focus a control without scrolling the page, once the surface has painted. */
export function focusSoon(getTarget) {
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
        const target = typeof getTarget === 'function' ? getTarget() : getTarget;
        if (target && typeof target.focus === 'function' && !target.disabled) target.focus({ preventScroll: true });
    });
}

/* ---- Confirmation sheet ------------------------------------------------------------ */

let confirmRoot = null;
let settleConfirm = null;

function buildConfirm() {
    const root = document.createElement('div');
    root.className = 'sb-confirm hidden';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'sb-confirm-title');
    root.setAttribute('aria-describedby', 'sb-confirm-message');
    root.innerHTML = `
        <div class="sb-confirm__scrim" data-confirm="cancel"></div>
        <div class="sb-confirm__panel">
            <p class="sb-eyebrow sb-confirm__eyebrow"></p>
            <h2 class="sb-confirm__title" id="sb-confirm-title"></h2>
            <p class="sb-confirm__message" id="sb-confirm-message"></p>
            <div class="sb-confirm__actions">
                <button type="button" class="sb-btn sb-btn--quiet" data-confirm="cancel"></button>
                <button type="button" class="sb-btn sb-confirm__ok" data-confirm="ok"></button>
            </div>
        </div>`;
    root.addEventListener('click', (event) => {
        const choice = event.target.closest?.('[data-confirm]')?.dataset.confirm;
        if (choice) settleConfirm?.(choice === 'ok');
    });
    root.addEventListener('keydown', (event) => {
        // Keys stay inside the sheet: Tab cycles its two buttons, nothing reaches the game.
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const buttons = Array.from(root.querySelectorAll('button'));
        const index = buttons.indexOf(document.activeElement);
        event.preventDefault();
        const next = buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
        next?.focus();
    });
    document.body.appendChild(root);
    return root;
}

/**
 * An in-app replacement for window.confirm(): resolves true when the person confirms.
 * The safe choice has focus; Escape and the scrim cancel.
 * @param {{eyebrow?: string, title: string, message?: string, confirmLabel: string, cancelLabel?: string}} options
 * @returns {Promise<boolean>}
 */
export function confirmSheet({
    eyebrow = '', title, message = '', confirmLabel, cancelLabel = 'Cancel',
}) {
    if (typeof document === 'undefined') return Promise.resolve(false);
    if (!confirmRoot || !confirmRoot.isConnected) confirmRoot = buildConfirm();
    settleConfirm?.(false);
    const root = confirmRoot;
    const eyebrowEl = root.querySelector('.sb-confirm__eyebrow');
    eyebrowEl.textContent = eyebrow;
    eyebrowEl.hidden = !eyebrow;
    root.querySelector('.sb-confirm__title').textContent = title;
    root.querySelector('.sb-confirm__message').textContent = message;
    const cancelBtn = root.querySelector('.sb-confirm__actions [data-confirm="cancel"]');
    const okBtn = root.querySelector('.sb-confirm__actions [data-confirm="ok"]');
    cancelBtn.textContent = cancelLabel;
    okBtn.textContent = confirmLabel;
    const returnFocus = document.activeElement;
    root.classList.remove('hidden');
    focusSoon(cancelBtn);
    return new Promise((resolve) => {
        const release = openLayer(root, () => settleConfirm?.(false));
        settleConfirm = (confirmed) => {
            settleConfirm = null;
            release();
            root.classList.add('hidden');
            if (!confirmed && returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
            resolve(confirmed);
        };
    });
}
