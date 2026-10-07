// @ts-check

/** The longest player name kept (Steam persona names are at most 32 characters). */
export const MAX_NAME_CHARS = 32;
/** The longest chat message kept. */
export const MAX_CHAT_CHARS = 200;

/**
 * Text from a peer, made safe to keep and pass on: a string, without control characters,
 * at most `max` characters. Anything else becomes ''. Names and chat were unbounded: a
 * 50 KB name was accepted, and one of about 60 KB made roster and match-end packets too
 * big to deliver.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function capPeerText(value, max) {
    if (typeof value !== 'string') return '';
    let out = '';
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;
        if (code >= 32 && code !== 127) out += char;
        if (out.length >= max) break;
    }
    return out.slice(0, max).trim();
}
