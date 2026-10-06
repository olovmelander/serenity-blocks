/**
 * @fileoverview Shared builders for Odyssey's Keystone sheets (results, failure).
 *
 * A sheet is a night panel with an open top-right corner and the coral keystone in it
 * (public/styles/keystone-overlays.css, docs/MENU_UI_OVERHAUL_2026-10.md). Only plain
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
 * The modal root, its scrim and the sheet (panel + keystone).
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
    const key = el('span', 'sb-ody-sheet__key');
    key.ariaHidden = 'true';
    sheet.appendChild(panel);
    sheet.appendChild(key);
    modal.appendChild(sheet);
    return { modal, panel };
}
