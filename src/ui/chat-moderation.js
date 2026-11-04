// @ts-check
/**
 * What this player sees of online chat (the lobby, the match and the results): whether chat is
 * on, and which players they have muted.
 *
 * - Chat on or off is the `onlineChat` setting (Settings › General › Online chat). Off, no
 *   player's message is shown or sent: each chat log keeps only the game's own lines and one
 *   saying chat is off, and its message field is hidden.
 * - Muting is this player's alone. The muted player is not told; the host still relays their
 *   messages to everyone else (core/multiplayer/ffa/chat-relay.js does not change); this game
 *   just does not show them. The list stays on this computer (localStorage, by Steam ID with
 *   the name shown when muted, so Settings can list it). It is never sent anywhere and is not
 *   part of the settings Steam Cloud keeps.
 *
 * Every chat log draws through renderChatLog() / appendChatMessage() and redraws on
 * onChatModerationChange(), so a mute also hides what that player already said, and an unmute
 * brings it back. Styles: public/styles/keystone-multiplayer.css (`.chat-mute-btn`,
 * `.is-chat-off`, `.player-mute-btn`).
 */
import { sanitizeCssColor } from '../utils/dom-safety.js';
import { csIconInner } from './components/cosmic-icons.js';

export const CHAT_MUTES_KEY = 'serenityBlocks.chatMutes';
/** Oldest mutes go first past this many (a list nobody will scroll; keeps the save small). */
export const MAX_CHAT_MUTES = 500;
const MAX_NAME_CHARS = 32;
export const CHAT_OFF_NOTE = 'Chat is off. Turn it on in Settings › General.';

/**
 * @typedef {{ steamId: string, name: string, at: number }} ChatMute
 * @typedef {{ kind: 'mute' | 'unmute', steamId: string, name: string } | { kind: 'chat', on: boolean }} ChatModerationChange
 * @typedef {{ system: boolean, steamId: string, name: string, text: string, color: string }} ChatEntry
 */

/** @type {Map<string, { name: string, at: number }> | null} */
let mutes = null;
/** @type {Set<(change: ChatModerationChange) => void>} */
const listeners = new Set();
let listeningToSettings = false;

function storage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/** A Steam ID as the mute list keys it ('' for none). */
function idOf(steamId) {
    if (steamId === null || steamId === undefined) return '';
    const id = String(steamId).trim();
    return id === 'undefined' || id === 'null' ? '' : id;
}

function loadMutes() {
    if (mutes) return mutes;
    mutes = new Map();
    try {
        const raw = storage()?.getItem(CHAT_MUTES_KEY);
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
            for (const entry of list.slice(-MAX_CHAT_MUTES)) {
                const id = idOf(typeof entry?.steamId === 'string' ? entry.steamId : '');
                if (!id) continue;
                mutes.set(id, {
                    name: typeof entry.name === 'string' ? entry.name.slice(0, MAX_NAME_CHARS) : '',
                    at: Number.isFinite(entry.at) ? entry.at : 0,
                });
            }
        }
    } catch {
        // An unreadable list starts empty rather than breaking chat.
    }
    return mutes;
}

function saveMutes() {
    try {
        const list = [...loadMutes()].map(([steamId, entry]) => ({ steamId, ...entry }));
        storage()?.setItem(CHAT_MUTES_KEY, JSON.stringify(list));
    } catch {
        // Full or blocked storage: the mute still holds for this session.
    }
}

/** @param {ChatModerationChange} change */
function notify(change) {
    for (const listener of [...listeners]) {
        try {
            listener(change);
        } catch (error) {
            console.warn('[chat] a chat log failed to redraw', error);
        }
    }
}

function listenToSettings() {
    if (listeningToSettings) return;
    const win = globalThis.window;
    if (!win?.addEventListener) return;
    listeningToSettings = true;
    win.addEventListener('settingsChanged', (event) => {
        const { detail } = /** @type {CustomEvent} */ (event);
        if (detail && Object.prototype.hasOwnProperty.call(detail, 'onlineChat')) {
            notify({ kind: 'chat', on: detail.onlineChat !== false });
        }
    });
}

/** Whether online chat is on (the `onlineChat` setting; on unless turned off). */
export function isChatOn() {
    try {
        return /** @type {any} */ (globalThis.window)?.settingsManager?.get?.()?.onlineChat !== false;
    } catch {
        return true;
    }
}

/** @param {unknown} steamId */
export function isMuted(steamId) {
    const id = idOf(steamId);
    return Boolean(id) && loadMutes().has(id);
}

/**
 * Mute or unmute a player's chat on this computer.
 * @param {unknown} steamId
 * @param {string} [name]  the name to list them by in Settings
 * @param {boolean} [muted]
 * @returns {boolean} whether anything changed
 */
export function setPlayerMuted(steamId, name = '', muted = true) {
    const id = idOf(steamId);
    if (!id || isMuted(id) === muted) return false;
    const list = loadMutes();
    const shownName = String(name || '').slice(0, MAX_NAME_CHARS) || list.get(id)?.name || '';
    if (muted) {
        while (list.size >= MAX_CHAT_MUTES) list.delete(list.keys().next().value);
        list.set(id, { name: shownName, at: Date.now() });
    } else {
        list.delete(id);
    }
    saveMutes();
    notify({ kind: muted ? 'mute' : 'unmute', steamId: id, name: shownName });
    return true;
}

/** @param {unknown} steamId @param {string} [name] */
export function mutePlayer(steamId, name = '') {
    return setPlayerMuted(steamId, name, true);
}

/** @param {unknown} steamId */
export function unmutePlayer(steamId) {
    return setPlayerMuted(steamId, '', false);
}

/** @returns {ChatMute[]} everyone muted on this computer, by name */
export function mutedPlayers() {
    return [...loadMutes()]
        .map(([steamId, entry]) => ({ steamId, name: entry.name, at: entry.at }))
        .sort((a, b) => (a.name || a.steamId).localeCompare(b.name || b.steamId));
}

/**
 * Hear about mutes, unmutes and chat turned on or off.
 * @param {(change: ChatModerationChange) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onChatModerationChange(listener) {
    listeners.add(listener);
    listenToSettings();
    return () => listeners.delete(listener);
}

/**
 * The line a chat log adds when a player is muted or unmuted, or null.
 * @param {ChatModerationChange | null | undefined} change
 */
export function chatModerationNote(change) {
    if (!change || change.kind === 'chat') return null;
    const who = change.name || 'That player';
    return change.kind === 'mute'
        ? `${who} is muted: you won't see their messages. Unmute in Settings › General.`
        : `${who} is unmuted.`;
}

/**
 * Any chat line in the shapes the logs keep: a string or `{ text }` (the game's own line),
 * `{ playerName, message, steamId, color }` (the game state's history and the network), or
 * `{ author, text, isSystem, steamId, color }` (the match panel's own list).
 * @param {unknown} msg
 * @returns {ChatEntry}
 */
export function chatEntry(msg) {
    if (typeof msg === 'string') return systemEntry(msg);
    const m = /** @type {Record<string, any>} */ (msg && typeof msg === 'object' ? msg : {});
    const name = m.author ?? m.playerName;
    const text = String(m.message ?? m.text ?? '');
    if (m.isSystem || !name) return systemEntry(text);
    return {
        system: false,
        steamId: idOf(m.steamId),
        name: String(name),
        text,
        color: typeof m.color === 'string' ? m.color : '',
    };
}

/**
 * @param {string} text
 * @returns {ChatEntry}
 */
function systemEntry(text) {
    return {
        system: true, steamId: '', name: '', text, color: '',
    };
}

/**
 * Whether this player is shown a chat line. The game's own lines (welcome, invites, mutes)
 * always are; a player's line only while chat is on, and never from someone muted.
 * @param {unknown} msg
 * @param {unknown} [localPlayerId]
 */
export function isChatMessageShown(msg, localPlayerId = null) {
    const entry = chatEntry(msg);
    if (entry.system) return true;
    if (!isChatOn()) return false;
    return !entry.steamId || entry.steamId === idOf(localPlayerId) || !isMuted(entry.steamId);
}

/**
 * @typedef {object} ChatLogOptions
 * @property {unknown} [localPlayerId]  this player's Steam ID: their own lines get no mute button
 * @property {(steamId: string) => (string | null | undefined)} [colorOf]  the roster's hue for a
 *   player, which wins over the hue a message carries
 * @property {Document} [doc]
 */

/**
 * One chat line as the logs draw it: the game's own line, or a player's with their hue, name and
 * text and, for anyone but this player, a mute button. Text goes in as text, never as markup.
 * @param {unknown} msg
 * @param {ChatLogOptions} [options]
 * @returns {HTMLElement}
 */
export function createChatMessageElement(msg, { localPlayerId = null, colorOf, doc = globalThis.document } = {}) {
    const entry = chatEntry(msg);
    const el = doc.createElement('div');
    if (entry.system) {
        el.className = 'system-message';
        el.textContent = entry.text;
        return el;
    }
    el.className = 'player-message';
    el.style.setProperty('--player-color', sanitizeCssColor(colorOf?.(entry.steamId) || entry.color, '#a78bfa'));
    if (entry.steamId) el.dataset.steamId = entry.steamId;
    const part = (className, text = '') => {
        const span = doc.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
    };
    const own = Boolean(entry.steamId) && entry.steamId === idOf(localPlayerId);
    const dot = part('color-indicator');
    dot.setAttribute('aria-hidden', 'true');
    el.appendChild(dot);
    // This player's own lines read "You", redrawn from history as when first sent.
    el.appendChild(part('author', own ? 'You' : entry.name));
    el.appendChild(part('text', entry.text));
    if (entry.steamId && !own) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'chat-mute-btn';
        button.setAttribute('aria-label', `Mute ${entry.name}`);
        button.title = `Mute ${entry.name}`;
        button.innerHTML = chatIcon('mute');
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            mutePlayer(entry.steamId, entry.name);
        });
        el.appendChild(button);
    }
    return el;
}

/**
 * Draw a whole chat log: the lines this player is shown and, while chat is off, a last line
 * saying so. Marks the chat panel around it (`.online-chat.is-chat-off`) so its message field
 * hides.
 * @param {HTMLElement | null | undefined} container
 * @param {Iterable<unknown>} messages
 * @param {ChatLogOptions} [options]
 */
export function renderChatLog(container, messages, options = {}) {
    if (!container) return;
    const on = isChatOn();
    markChatPanel(container, on);
    const lines = [...messages].filter((msg) => isChatMessageShown(msg, options.localPlayerId));
    if (!on) lines.push(CHAT_OFF_NOTE);
    container.replaceChildren(...lines.map((msg) => createChatMessageElement(msg, options)));
    container.scrollTop = container.scrollHeight;
}

/**
 * Add one line to a chat log if this player is shown it.
 * @param {HTMLElement | null | undefined} container
 * @param {unknown} msg
 * @param {ChatLogOptions} [options]
 * @returns {boolean} whether it was added
 */
export function appendChatMessage(container, msg, options = {}) {
    if (!container || !isChatMessageShown(msg, options.localPlayerId)) return false;
    container.appendChild(createChatMessageElement(msg, options));
    container.scrollTop = container.scrollHeight;
    return true;
}

/**
 * @param {HTMLElement} container
 * @param {boolean} on
 */
function markChatPanel(container, on) {
    container.closest?.('.online-chat')?.classList?.toggle('is-chat-off', !on);
}

/**
 * A decorative line icon from the game's set.
 * @param {string} name
 * @param {number} [size]
 */
export function chatIcon(name, size = 14) {
    return `<svg class="sb-mp-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" `
        + 'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
        + 'aria-hidden="true" focusable="false">'
        + `${csIconInner(name)}</svg>`;
}

/** Tests only: forget the cached list and every listener. */
export function resetChatModerationForTests() {
    mutes = null;
    listeners.clear();
}
