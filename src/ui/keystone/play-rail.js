/**
 * @fileoverview The play rail: every mode's in-game controls — Levels (Odyssey's board
 * view), the Serenity Hub and Settings, in that order, Settings outermost — as one small
 * tray in the top-right corner, identical in every mode: the same place, size, icons,
 * names and keys. The bottom of the screen belongs to the game: boards, chat, stats,
 * touch controls and toasts; each mode keeps the corner free (online versus reserves the
 * top of its info column, level with the spectator toolbar).
 *
 * The tray rests dimmed while you play; the first runs of each mode open it once to name
 * its controls.
 *
 * The rail adopts the existing controls (#odyssey-navigator-btn, #serenity-hub-icon,
 * #settings-btn-global): their ids, handlers and the code that shows, hides or activates
 * them keep working; the rail only gives them one home, one look, their names and keys.
 *
 * Keys: Esc (Start on a pad) opens Settings in every mode but Serenity, where Esc goes
 * back to the menu and Start opens it. The Hub key (H unless rebound) opens the Hub in
 * every mode; Serenity Mode handles its own (and Y on a pad, which elsewhere plays).
 *
 * Styles: public/styles/keystone-overlays.css (`#sb-play-rail`). Record:
 * docs/MENU_UI_OVERHAUL_2026-10.md §5.5.
 */

import { escapeHtml } from '../../utils/dom-safety.js';

const RAIL_ID = 'sb-play-rail';
const SETTINGS_ID = 'settings-btn-global';
const HUB_ID = 'serenity-hub-icon';
const NAVIGATOR_ID = 'odyssey-navigator-btn';
/** Left to right; the corner belongs to Settings. */
const TILE_IDS = [NAVIGATOR_ID, HUB_ID, SETTINGS_ID];
const MODE_EVENTS = ['modeActivated', 'modeStarted', 'modeStopped', 'modeDeactivated'];
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', '&#9776;', 'L3', 'R3',
    '&uarr;', '&darr;', '&larr;', '&rarr;'];

/** How many runs of each mode open the tray to name its controls, and for how long. */
const PEEK_RUNS = 3;
const PEEK_MS = 3600;
const FOLD_MS = 520;
const PEEK_DELAY_MS = 3200;
const PEEK_WAIT_MS = 450;
const PEEK_WAIT_TRIES = 24;
const PEEK_STORE = 'serenity.playRail.peeks';

let rail = null;
let modeWatchBound = false;
let peekTimer = null;
const labels = new WeakMap();

function keycap(text, kind) {
    return `<kbd class="sb-kbd" data-${kind}>${text}</kbd>`;
}

function currentSettings() {
    const app = typeof window !== 'undefined' ? window : null;
    return app?.settingsManager?.get?.() || app?.settings || {};
}

/** The key that opens the Hub: Serenity's binding, so it is one key everywhere. */
function hubKey() {
    const key = currentSettings().serenityKeyBindings?.toggleHub;
    return typeof key === 'string' && key ? key : 'h';
}

/** A binding as its keycap reads; a rebound key is the player's text, so it is escaped. */
function keyName(key) {
    return escapeHtml(key.length === 1 ? key.toUpperCase() : key);
}

function currentModeId() {
    if (document.body?.classList.contains('start-modal-open')) return '';
    const manager = window.serenityBlocks?.gameModeManager;
    return manager?.currentModeId || manager?.getCurrentMode?.()?.getModeId?.() || '';
}

/** What a tile is called, and which keys reach it, in the mode being played. */
function describe(id, modeId) {
    const serenity = modeId === 'serenity';
    if (id === SETTINGS_ID) {
        // Serenity gives Escape to "back to the menu"; Start opens Settings in every mode.
        return { text: 'Settings', keys: (serenity ? '' : keycap('Esc', 'key')) + keycap('&#9776;', 'pad') };
    }
    if (id === HUB_ID) {
        const pad = PAD_NAMES[currentSettings().serenityGamepadBindings?.toggleHub ?? 3] || 'Y';
        // Outside Serenity the pad reaches the Hub through Settings (Start, then Serenity Hub).
        return { text: 'Serenity Hub', keys: keycap(keyName(hubKey()), 'key') + (serenity ? keycap(pad, 'pad') : '') };
    }
    return { text: 'Levels', keys: '' };
}

function labelOf(tile) {
    let label = labels.get(tile);
    if (!label) {
        label = document.createElement('span');
        label.className = 'sb-play-rail__label';
        // The tile's accessible name says it; the label is what sighted players read.
        label.setAttribute('aria-hidden', 'true');
        tile.appendChild(label);
        labels.set(tile, label);
    }
    return label;
}

function bindModeWatch(onChange) {
    const manager = window.serenityBlocks?.gameModeManager;
    if (modeWatchBound || typeof manager?.on !== 'function') return;
    modeWatchBound = true;
    MODE_EVENTS.forEach((event) => manager.on(event, () => onChange(event)));
}

/** Re-label the tiles for the mode now being played. Cheap; safe to call often. */
export function refreshPlayRail() {
    if (!rail) return;
    bindModeWatch(onModeEvent);
    const modeId = currentModeId();
    rail.dataset.mode = modeId || 'menu';
    if (!modeId) stopPeek();
    TILE_IDS.forEach((id) => {
        const tile = document.getElementById(id);
        if (!tile || tile.parentElement !== rail) return;
        const { text, keys } = describe(id, modeId);
        const html = `<span class="sb-play-rail__text">${text}</span>${keys}`;
        const label = labelOf(tile);
        if (label.innerHTML !== html) label.innerHTML = html;
        if (tile.getAttribute('aria-label') !== text) tile.setAttribute('aria-label', text);
    });
}

function onModeEvent(event) {
    refreshPlayRail();
    if (event === 'modeStarted') peekForNewcomers();
}

/** Counts this run against the mode's peeks; true while it still has one to give. */
function takePeek(modeId) {
    try {
        const seen = JSON.parse(window.localStorage.getItem(PEEK_STORE) || '{}');
        const runs = Number(seen[modeId]) || 0;
        if (runs >= PEEK_RUNS) return false;
        seen[modeId] = runs + 1;
        window.localStorage.setItem(PEEK_STORE, JSON.stringify(seen));
    } catch { /* no storage: name the controls every run rather than never */ }
    return true;
}

function stopPeek() {
    clearTimeout(peekTimer);
    peekTimer = null;
    rail?.classList.remove('is-peek', 'is-folding');
}

/** Fold the named tray back to its icons, unless the pointer or focus is on it. */
function fold() {
    if (!rail?.classList.contains('is-peek')) return;
    if (rail.matches?.(':hover, :focus-within')) {
        peekTimer = setTimeout(fold, 700);
        return;
    }
    rail.classList.replace('is-peek', 'is-folding');
    peekTimer = setTimeout(stopPeek, FOLD_MS);
}

/** True when the tray is what the player sees at its own centre (no loading veil on it). */
function trayIsSeen() {
    const box = rail.getBoundingClientRect?.();
    if (!box?.width || typeof document.elementFromPoint !== 'function') return Boolean(box?.width);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && rail.contains(hit));
}

/**
 * The first runs of each mode open the tray for a moment so its controls are named
 * where they live. Touch has no keys to teach.
 */
function peekForNewcomers() {
    const modeId = currentModeId();
    if (!rail || !modeId || peekTimer) return;
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return;
    let tries = 0;
    const attempt = () => {
        peekTimer = null;
        if (!rail || currentModeId() !== modeId) return;
        // Odyssey's board view is not play, and its header chips sit beside the tray.
        if (document.getElementById(NAVIGATOR_ID)?.classList.contains('visible')) return;
        // A mode can start behind its loading veil or countdown: wait until the tray is in view.
        if (!trayIsSeen()) {
            tries += 1;
            if (tries < PEEK_WAIT_TRIES) peekTimer = setTimeout(attempt, PEEK_WAIT_MS);
            return;
        }
        if (!takePeek(modeId)) return;
        // Opened from its folded width so the names unroll instead of appearing at once.
        rail.classList.add('is-folding');
        peekTimer = setTimeout(() => {
            rail.classList.replace('is-folding', 'is-peek');
            peekTimer = setTimeout(fold, PEEK_MS);
        }, 60);
    };
    // After the countdown most modes open with, while the first pieces fall.
    peekTimer = setTimeout(attempt, PEEK_DELAY_MS);
}

/** True when the key already plays the game for someone (rebound controls). */
function keyPlaysTheGame(key) {
    const { keyBindings, player2KeyBindings } = currentSettings();
    const wanted = key.toLowerCase();
    return [keyBindings, player2KeyBindings].some((bindings) => Object.values(bindings || {})
        .some((bound) => typeof bound === 'string' && bound.toLowerCase() === wanted));
}

/** The Hub key, in every mode Serenity does not already handle. */
function onKeyDown(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = hubKey();
    if (String(event.key || '').toLowerCase() !== key.toLowerCase()) return;
    const modeId = currentModeId();
    if (!modeId || modeId === 'serenity') return;
    if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (keyPlaysTheGame(key)) return;

    const hub = window.serenityBlocks?.serenityHub;
    if (document.body.classList.contains('serenity-hub-open')) {
        if (!hub?.hide) return;
        event.preventDefault();
        hub.hide();
        return;
    }
    // Settings (and anything else modal) owns the keyboard while it is open.
    if (document.querySelector('.modal.visible')) return;
    const tile = document.getElementById(HUB_ID);
    if (!tile || !rail?.contains(tile)) return;
    event.preventDefault();
    tile.click();
}

/** Move the controls into the rail, in order, wherever they were created. A tile already
 * in its place is left alone, so a focused control never loses focus. */
function adoptTiles() {
    let previous = null;
    TILE_IDS.forEach((id) => {
        const tile = document.getElementById(id);
        if (!tile) return;
        const slot = previous ? previous.nextElementSibling : rail.firstElementChild;
        if (tile !== slot) rail.insertBefore(tile, slot);
        previous = tile;
    });
    refreshPlayRail();
}

/**
 * Create the rail once and keep it furnished and in place.
 * @returns {HTMLElement|null}
 */
export function installPlayRail() {
    if (rail || typeof document === 'undefined' || !document.body) return rail;
    rail = document.createElement('nav');
    rail.id = RAIL_ID;
    rail.className = 'sb-play-rail';
    rail.setAttribute('aria-label', 'Game controls');
    document.body.appendChild(rail);
    adoptTiles();

    if (typeof MutationObserver === 'function') {
        new MutationObserver((records) => {
            const arrived = records.some((record) => Array.from(record.addedNodes)
                .some((node) => TILE_IDS.includes(node.id)));
            if (arrived) adoptTiles();
        }).observe(document.body, { childList: true });
    }
    window.addEventListener('modalShown', refreshPlayRail);
    window.addEventListener('modalHidden', refreshPlayRail);
    document.addEventListener('keydown', onKeyDown);
    return rail;
}
