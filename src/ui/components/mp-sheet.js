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

/* Line icons in the same hand as cosmic-icons.js (24-unit grid, 1.8 stroke, round). */
const ICON_PATHS = {
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back: '<path d="M19 12H5.5"/><path d="M11 18l-6-6 6-6"/>',
    chevron: '<path d="M9.5 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
    watch: '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.7"/>',
    join: '<path d="M13.5 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4"/><path d="M9.5 16l4-4-4-4"/><path d="M13.5 12h-9"/>',
    dropin: '<path d="M12 3.5v9"/><path d="M8.2 9l3.8 3.8L15.8 9"/><rect x="4.5" y="16" width="15" height="4.5" rx="1.2"/>',
    copy: '<rect x="9" y="9" width="10.5" height="10.5" rx="2"/><path d="M5.5 14.5V6.5a2 2 0 0 1 2-2h8"/>',
    check: '<path d="M19.5 7 9.8 16.7 4.5 11.4"/>',
    send: '<path d="M20.5 3.5 3.5 10.6l6.8 2.6 2.6 6.8 7.6-16.5Z"/><path d="M10.3 13.2l4.4-4.4"/>',
    human: '<circle cx="12" cy="8" r="3.5"/><path d="M5 19.8c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
    bot: '<rect x="5" y="8.2" width="14" height="11" rx="3"/><path d="M12 4.6v3.6"/><circle cx="12" cy="3.7" r=".9"/><path d="M9.4 13.2h.01M14.6 13.2h.01"/><path d="M10 16.3h4"/>',
    crown: '<path d="M5.2 18h13.6l1.1-9.3-4.2 3.2L12 4.7l-3.7 7.2-4.2-3.2L5.2 18Z"/><path d="M6.1 20.3h11.8"/>',
    invite: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3.5 19.8c.7-3.4 3.2-5.3 6-5.3 1.4 0 2.7.4 3.8 1.2"/><path d="M18 12.5v6M15 15.5h6"/>',
    leave: '<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10"/><path d="M15 16l4-4-4-4"/><path d="M19 12H9.5"/>',
    remove: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3.5 19.8c.7-3.4 3.2-5.3 6-5.3 1.6 0 3 .5 4.1 1.5"/><path d="M16 13.5l5 5M21 13.5l-5 5"/>',
    search: '<circle cx="11" cy="11" r="6.3"/><path d="M15.8 15.8 20.5 20.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5Z"/>',
    people: '<circle cx="9" cy="8.5" r="3.1"/><path d="M3.2 19.5c.6-3.1 2.9-5 5.8-5s5.2 1.9 5.8 5"/><circle cx="16.6" cy="9.4" r="2.5"/><path d="M15.8 14.6c2.6-.3 4.6 1.2 5.2 4"/>',
    trophy: '<path d="M7 4.5h10v4.2c0 3-2.1 5.4-5 5.4s-5-2.4-5-5.4V4.5Z"/><path d="M7 7H4.8a2.2 2.2 0 0 0 0 4.4H7M17 7h2.2a2.2 2.2 0 0 1 0 4.4H17"/><path d="M12 14.1v3.2M8.7 20h6.6M10 17.3h4"/>',
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.3V20h13V9.3"/><path d="M9.8 20v-5.5h4.4V20"/>',
    rematch: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15"/><path d="M4.5 19.5V15H9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

/**
 * @param {string} name icon key
 * @param {number} [size=18] px
 * @param {string} [cls=''] extra class
 * @returns {string} inline, decorative <svg> markup
 */
export function mpIcon(name, size = 18, cls = '') {
    const inner = ICON_PATHS[name] || ICON_PATHS.check;
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
