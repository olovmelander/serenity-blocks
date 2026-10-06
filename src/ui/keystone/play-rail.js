/**
 * @fileoverview The play rail: every mode's in-game controls in one row in the
 * bottom-right corner — Levels (Odyssey's board view), the Serenity Hub, and Pause
 * (Settings in an online match, which cannot pause) in the corner itself, where the gear
 * always was. On the main menu the dock replaces it.
 *
 * The rail adopts the existing controls (#odyssey-navigator-btn, #serenity-hub-icon,
 * #settings-btn-global): their ids, handlers and the code that shows, hides or activates
 * them keep working; the rail only gives them one home, one look, a label and their keys
 * for the mode being played. Controls created later (the Odyssey navigator) are adopted
 * when they reach <body>.
 *
 * Styles: public/styles/keystone-overlays.css (`#sb-play-rail`). Record:
 * docs/MENU_UI_OVERHAUL_2026-10.md.
 */

const RAIL_ID = 'sb-play-rail';
const SETTINGS_ID = 'settings-btn-global';
const HUB_ID = 'serenity-hub-icon';
const NAVIGATOR_ID = 'odyssey-navigator-btn';
/** Left to right; the corner belongs to Pause. */
const TILE_IDS = [NAVIGATOR_ID, HUB_ID, SETTINGS_ID];
const MODE_EVENTS = ['modeActivated', 'modeStarted', 'modeStopped', 'modeDeactivated'];

let rail = null;
let modeWatchBound = false;
const labels = new WeakMap();

function keycap(text, kind) {
    return `<kbd class="sb-kbd" data-${kind}>${text}</kbd>`;
}

function currentModeId() {
    if (document.body?.classList.contains('start-modal-open')) return '';
    const manager = window.serenityBlocks?.gameModeManager;
    return manager?.currentModeId || manager?.getCurrentMode?.()?.getModeId?.() || '';
}

/** What a tile says, and which keys reach it, in the mode being played. */
function describe(id, modeId) {
    const serenity = modeId === 'serenity';
    if (id === SETTINGS_ID) {
        // Serenity gives Escape to "back to the menu"; Start opens this in every mode.
        return {
            text: modeId === 'online-multiplayer' ? 'Settings' : 'Pause',
            keys: (serenity ? '' : keycap('Esc', 'key')) + keycap('&#9776;', 'pad'),
        };
    }
    if (id === HUB_ID) {
        return { text: 'Serenity Hub', keys: serenity ? keycap('H', 'key') + keycap('Y', 'pad') : '' };
    }
    return { text: 'Levels', keys: '' };
}

function labelOf(tile) {
    let label = labels.get(tile);
    if (!label) {
        label = document.createElement('span');
        label.className = 'sb-play-rail__label';
        // The tile's own accessible name says it; the label is what sighted players read.
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
    MODE_EVENTS.forEach((event) => manager.on(event, () => onChange()));
}

/** Re-label the tiles for the mode now being played. Cheap; safe to call often. */
export function refreshPlayRail() {
    if (!rail) return;
    bindModeWatch(refreshPlayRail);
    const modeId = currentModeId();
    rail.dataset.mode = modeId || 'menu';
    TILE_IDS.forEach((id) => {
        const tile = document.getElementById(id);
        if (!tile || tile.parentElement !== rail) return;
        const { text, keys } = describe(id, modeId);
        const html = `<span class="sb-play-rail__text">${text}</span>${keys}`;
        const label = labelOf(tile);
        if (label.innerHTML !== html) label.innerHTML = html;
        if (id === SETTINGS_ID) tile.setAttribute('aria-label', text);
    });
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
 * Create the rail once and keep it furnished.
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
    return rail;
}
