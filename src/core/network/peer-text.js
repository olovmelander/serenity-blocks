// @ts-check

import { sanitizeCssColor } from '../../utils/dom-safety.js';

/** The longest player name kept (Steam persona names are at most 32 characters). */
export const MAX_NAME_CHARS = 32;
/** The longest chat message kept. */
export const MAX_CHAT_CHARS = 200;

// Invisible characters that reorder or hide text: bidi marks, embeddings, overrides and
// isolates, zero-width spaces and joiners-that-are-not (word joiner, BOM). With them a
// name can read as another player's ("Alice" + U+202E...). ZWJ and ZWNJ stay: emoji
// sequences and several scripts need them.
const HIDDEN_FORMAT_CHARS = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;

/**
 * Text from a peer, made safe to keep and pass on: a string, without control or hidden
 * format characters, at most `max` characters. Anything else becomes ''. Names and chat
 * were unbounded: a 50 KB name was accepted, and one of about 60 KB made roster and
 * match-end packets too big to deliver.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function capPeerText(value, max) {
    if (typeof value !== 'string') return '';
    let out = '';
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;
        if (code >= 32 && code !== 127 && !HIDDEN_FORMAT_CHARS.test(char)) out += char;
        if (out.length >= max) break;
    }
    return out.slice(0, max).trim();
}

/**
 * A player colour from a peer, or null. Colours reach CSS (`background`, the
 * `--player-primary` variable), where `url(https://...)` would make every viewer fetch an
 * address the sender chose and reveal their IP, so only a hex colour is kept.
 * @param {unknown} value
 * @returns {string | null}
 */
export function peerColor(value) {
    return sanitizeCssColor(value, '') || null;
}
