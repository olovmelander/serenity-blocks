// @ts-check
/**
 * The notice a player reads once before online play: what an online match shares with the
 * players this computer is connected to. A match is a star through its host: everyone in it is
 * connected to the host, and the host to everyone (electron/p2p-session-gate.js).
 *
 * Shown the first time Online Versus is opened, before a match can be created or joined
 * (core/game-modes/OnlineMultiplayerMode.js; not in a test lobby without Steam, which connects
 * to no other computer). "I understand" is remembered on this device
 * (localStorage, not part of the settings Steam Cloud keeps); Escape or B goes back to the
 * menu without it, and the notice shows again next time.
 *
 * The sheet is the multiplayer confirmation sheet's frame (`.sb-confirm`,
 * public/styles/keystone-multiplayer.css) with one button.
 */
import { focusSoon, openLayer } from './components/mp-sheet.js';

export const ONLINE_NOTICE_KEY = 'serenityBlocks.onlinePlayNotice';

/** For the player creating a public match, who hosts it (ui/match-config-modal.js). */
export const HOST_IP_NOTE = 'Everyone who joins can see your IP address, as in most online games.';
export const ONLINE_NOTICE_TITLE = 'Before you play online';
export const ONLINE_NOTICE_TEXT = 'An online match connects your computer directly to the match\'s host, '
    + 'and the host\'s computer to everyone in the match. The players you are connected to can see your '
    + 'IP address, as in most online games. Play with friends only if you would rather not share it with '
    + 'strangers.';
export const ONLINE_NOTICE_BUTTON = 'I understand';

/** Read on a device whose storage cannot keep it: holds for this session. */
let acknowledgedThisSession = false;
/** @type {Promise<boolean> | null} */
let open = null;

function storage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** Whether this player has read the notice on this device. */
export function hasSeenOnlinePlayNotice() {
    if (acknowledgedThisSession) return true;
    try {
        return storage()?.getItem(ONLINE_NOTICE_KEY) === '1';
    } catch {
        return false;
    }
}

function remember() {
    acknowledgedThisSession = true;
    try {
        storage()?.setItem(ONLINE_NOTICE_KEY, '1');
    } catch {
        // Full or blocked storage: the notice shows again next launch.
    }
}

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 */
function element(doc, tag, className, text = '') {
    const el = doc.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    return el;
}

/**
 * Show the notice unless it has been read. Resolves true once the player has read it (now or
 * before), false when they backed out (Escape, B) or there is no page to show it on.
 * @param {{ doc?: Document }} [options]
 * @returns {Promise<boolean>}
 */
export function ensureOnlinePlayNotice({ doc = globalThis.document } = {}) {
    if (hasSeenOnlinePlayNotice()) return Promise.resolve(true);
    if (open) return open;
    if (!doc?.body || typeof doc.createElement !== 'function') return Promise.resolve(false);

    const root = element(doc, 'div', 'sb-confirm sb-confirm--notice');
    root.id = 'online-play-notice';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'online-play-notice-title');
    root.setAttribute('aria-describedby', 'online-play-notice-text');
    const scrim = element(doc, 'div', 'sb-confirm__scrim');
    const panel = element(doc, 'div', 'sb-confirm__panel');
    const title = element(doc, 'h2', 'sb-confirm__title', ONLINE_NOTICE_TITLE);
    title.id = 'online-play-notice-title';
    const text = element(doc, 'p', 'sb-confirm__message', ONLINE_NOTICE_TEXT);
    text.id = 'online-play-notice-text';
    const actions = element(doc, 'div', 'sb-confirm__actions');
    const button = /** @type {HTMLButtonElement} */ (
        element(doc, 'button', 'sb-btn sb-btn--primary', ONLINE_NOTICE_BUTTON));
    button.type = 'button';
    button.id = 'online-play-notice-ok';
    actions.appendChild(button);
    panel.appendChild(element(doc, 'p', 'sb-eyebrow sb-confirm__eyebrow', 'Online versus'));
    panel.appendChild(title);
    panel.appendChild(text);
    panel.appendChild(actions);
    root.appendChild(scrim);
    root.appendChild(panel);

    open = new Promise((resolve) => {
        /** @type {() => void} */
        let release = () => {};
        const settle = (/** @type {boolean} */ understood) => {
            if (!open) return;
            open = null;
            if (understood) remember();
            release();
            root.remove();
            resolve(understood);
        };
        button.addEventListener('click', () => settle(true));
        // Keys stay in the sheet: its one button keeps the focus, nothing reaches the game.
        root.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key !== 'Tab') return;
            event.preventDefault();
            button.focus();
        });
        doc.body.appendChild(root);
        release = openLayer(root, () => settle(false));
        focusSoon(button);
    });
    return open;
}

/** Tests only: forget what this session remembers. */
export function resetOnlinePlayNoticeForTests() {
    acknowledgedThisSession = false;
    open = null;
}
