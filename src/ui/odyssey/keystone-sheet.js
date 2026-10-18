/**
 * @fileoverview Shared builders for Odyssey's Keystone sheets (results, failure).
 *
 * A sheet is a night panel (public/styles/keystone-overlays.css,
 * docs/MENU_UI_OVERHAUL_2026-10.md). Only plain
 * DOM properties are used (className, textContent, ARIA reflection) so the builders
 * stay testable against minimal element stubs.
 */

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/**
 * Settings opened over a sheet owns the keyboard: a sheet's capture-phase key handler stands
 * down, or Escape meant for Settings chose "Back to map" underneath and Enter on a Settings
 * control started a retry (audit 2026-10-18).
 * @returns {boolean}
 */
export function isSettingsOverSheet() {
    const settings = typeof document !== 'undefined' ? document.getElementById?.('settings-modal') : null;
    return settings?.classList?.contains('visible') === true;
}

/** Set a data attribute when the element supports it (real DOM, not every test stub). */
function setData(node, name, value) {
    if (node.dataset) node.dataset[name] = value;
}

/**
 * Keycap hints for a button: the keyboard key and the matching controller button.
 * @param {HTMLElement} button
 * @param {string} key
 * @param {string} pad
 */
export function appendKeyHint(button, key, pad) {
    const keyCap = el('kbd', 'sb-kbd', key);
    setData(keyCap, 'key', '');
    keyCap.ariaHidden = 'true';
    const padCap = el('kbd', 'sb-kbd', pad);
    setData(padCap, 'pad', '');
    padCap.ariaHidden = 'true';
    button.appendChild(keyCap);
    button.appendChild(padCap);
}

/**
 * The modal root, its scrim and the sheet (its panel).
 * @param {{id: string, label: string, variant?: string}} options
 * @returns {{modal: HTMLElement, panel: HTMLElement}}
 */
export function createKeystoneSheet({ id, label, variant = '' }) {
    const modal = el('div', `sb-ody-modal${variant ? ` sb-ody-modal--${variant}` : ''}`);
    modal.id = id;
    setData(modal, 'odysseyWheelLock', 'true');
    modal.role = 'dialog';
    modal.ariaModal = 'true';
    modal.ariaLabel = label;

    const sheet = el('div', 'sb-ody-sheet');
    const panel = el('div', 'sb-ody-sheet__panel');
    sheet.appendChild(panel);
    modal.appendChild(sheet);
    return { modal, panel };
}
